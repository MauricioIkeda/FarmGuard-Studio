"""Sweep confidence and NMS IoU by 0.01 without repeating model inference.

The raw YOLO output is kept only in memory for one validation image at a time.
For each NMS IoU, NMS runs once at the lowest confidence; higher confidence
thresholds are evaluated by filtering its score-sorted detections.
"""

import argparse
import csv
from pathlib import Path

import numpy as np
import torch
from ultralytics import YOLO
from ultralytics.models.yolo.detect import DetectionPredictor
from ultralytics.utils import nms, ops


THRESHOLDS = tuple(round(value / 100, 2) for value in range(1, 100))
MATCH_IOU = 0.30
MAX_DET = 1000


class RawDetectionPredictor(DetectionPredictor):
    def postprocess(self, preds, img, orig_imgs, **kwargs):
        self.raw_predictions = preds
        self.input_shape = img.shape[2:]
        return super().postprocess(preds, img, orig_imgs, **kwargs)


def load_truth(label_file, width, height):
    boxes = []
    for line in label_file.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        _, x, y, w, h = map(float, line.split())
        boxes.append(((x - w / 2) * width, (y - h / 2) * height,
                      (x + w / 2) * width, (y + h / 2) * height))
    return np.asarray(boxes, dtype=np.float32).reshape(-1, 4)


def match_counts(truth, boxes, scores):
    """Return TP/FP for every confidence, using the existing greedy IoU rule."""
    if len(boxes) == 0 or len(truth) == 0:
        counts = np.asarray([(scores > conf).sum() for conf in THRESHOLDS], dtype=np.int32)
        return np.zeros(len(THRESHOLDS), dtype=np.int32), counts

    left_top = np.maximum(truth[:, None, :2], boxes[None, :, :2])
    right_bottom = np.minimum(truth[:, None, 2:], boxes[None, :, 2:])
    intersection = np.prod(np.maximum(right_bottom - left_top, 0), axis=2)
    truth_area = np.prod(truth[:, 2:] - truth[:, :2], axis=1)
    box_area = np.prod(boxes[:, 2:] - boxes[:, :2], axis=1)
    overlap = intersection / np.maximum(truth_area[:, None] + box_area[None, :] - intersection, 1e-9)
    gt_indices, pred_indices = np.where(overlap >= MATCH_IOU)
    order = np.lexsort((-pred_indices, -gt_indices, -overlap[gt_indices, pred_indices]))
    candidates = tuple(zip(gt_indices[order], pred_indices[order]))

    tp = np.zeros(len(THRESHOLDS), dtype=np.int32)
    predictions = np.zeros(len(THRESHOLDS), dtype=np.int32)
    cache = {}
    for index, conf in enumerate(THRESHOLDS):
        count = int((scores > conf).sum())
        predictions[index] = count
        if count not in cache:
            used_truth, used_predictions = set(), set()
            for gt_index, pred_index in candidates:
                if pred_index >= count or gt_index in used_truth or pred_index in used_predictions:
                    continue
                used_truth.add(gt_index)
                used_predictions.add(pred_index)
                if len(used_truth) == min(len(truth), count):
                    break
            cache[count] = len(used_truth)
        tp[index] = cache[count]
    return tp, predictions


def main():
    parser = argparse.ArgumentParser(description="Calibrate all centesimal confidence/NMS IoU pairs.")
    parser.add_argument("--model", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--limit-images", type=int, default=0, help=argparse.SUPPRESS)
    args = parser.parse_args()

    root = Path(args.dataset)
    images = sorted((root / "images" / "val").glob("*.jpg"))
    if args.limit_images:
        images = images[:args.limit_images]
    if not images:
        raise ValueError("O conjunto de validação está vazio.")
    device = 0 if torch.cuda.is_available() else "mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available() else "cpu"
    model = YOLO(args.model)
    shape = (len(THRESHOLDS), len(THRESHOLDS))
    all_tp = np.zeros(shape, dtype=np.int32)
    all_predictions = np.zeros(shape, dtype=np.int32)
    total_truth = 0

    with torch.inference_mode():
        for image_index, image in enumerate(images, 1):
            result = model.predict(source=str(image), imgsz=1280, conf=THRESHOLDS[0],
                                   iou=0.50, max_det=MAX_DET, device=device,
                                   predictor=RawDetectionPredictor, verbose=False)[0]
            predictor = model.predictor
            raw = predictor.raw_predictions
            height, width = result.orig_shape
            truth = load_truth(root / "labels" / "val" / f"{image.stem}.txt", width, height)
            total_truth += len(truth)

            for iou_index, iou in enumerate(THRESHOLDS):
                detections = nms.non_max_suppression(raw, THRESHOLDS[0], iou,
                                                     max_det=MAX_DET, nc=0)[0]
                if len(detections):
                    boxes = ops.scale_boxes(predictor.input_shape, detections[:, :4].clone(),
                                            result.orig_shape).cpu().numpy()
                    scores = detections[:, 4].cpu().numpy()
                    order = np.argsort(-scores, kind="stable")
                    boxes, scores = boxes[order], scores[order]
                else:
                    boxes = np.empty((0, 4), dtype=np.float32)
                    scores = np.empty(0, dtype=np.float32)
                tp, predictions = match_counts(truth, boxes, scores)
                all_tp[:, iou_index] += tp
                all_predictions[:, iou_index] += predictions
                if (iou_index + 1) % 20 == 0:
                    print(f"Imagem {image_index}/{len(images)} · NMS IoU {iou:.2f} avaliado", flush=True)
            del raw
            predictor.raw_predictions = None
            print(f"Imagem {image_index}/{len(images)} concluída: {image.name}", flush=True)

    rows = []
    for conf_index, confidence in enumerate(THRESHOLDS):
        for iou_index, iou in enumerate(THRESHOLDS):
            tp = int(all_tp[conf_index, iou_index])
            predicted = int(all_predictions[conf_index, iou_index])
            fp, fn = predicted - tp, total_truth - tp
            precision = tp / predicted if predicted else 0.0
            recall = tp / total_truth if total_truth else 0.0
            f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
            rows.append({"confidence": confidence, "nms_iou": iou, "match_iou": MATCH_IOU,
                         "ground_truth": total_truth, "predictions": predicted, "tp": tp,
                         "fp": fp, "fn": fn, "precision": precision, "recall": recall,
                         "f1": f1, "edit_proxy": fp + fn})
    # Equal scores should not arbitrarily prefer the most aggressive NMS limit.
    rows.sort(key=lambda row: (row["edit_proxy"], -row["f1"], -row["precision"],
                               abs(row["nms_iou"] - 0.50)))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(f"{len(rows)} combinações avaliadas; melhor: confidence={rows[0]['confidence']:.2f}, "
          f"NMS IoU={rows[0]['nms_iou']:.2f}, correções estimadas={rows[0]['edit_proxy']}.", flush=True)


if __name__ == "__main__":
    main()
