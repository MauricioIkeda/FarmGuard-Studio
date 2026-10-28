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

from calibration_common import metric_row, sample_truth, threshold_counts, validation_samples

THRESHOLDS = tuple(round(value / 100, 2) for value in range(1, 100))


class RawDetectionPredictor(DetectionPredictor):
    def postprocess(self, preds, img, orig_imgs, **kwargs):
        self.raw_predictions = preds
        self.input_shape = img.shape[2:]
        return super().postprocess(preds, img, orig_imgs, **kwargs)


def main():
    parser = argparse.ArgumentParser(description="Calibrate all centesimal confidence/NMS IoU pairs.")
    parser.add_argument("--model", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--limit-images", type=int, default=0, help=argparse.SUPPRESS)
    parser.add_argument("--imgsz", type=int, default=1280)
    parser.add_argument("--max-det", type=int, default=1000)
    args = parser.parse_args()

    root = Path(args.dataset)
    samples = validation_samples(root)
    if args.limit_images:
        samples = samples[:args.limit_images]
    device = 0 if torch.cuda.is_available() else "mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available() else "cpu"
    model = YOLO(args.model)
    shape = (len(THRESHOLDS), len(THRESHOLDS))
    all_tp = np.zeros(shape, dtype=np.int32)
    all_predictions = np.zeros(shape, dtype=np.int32)
    all_ignored = np.zeros(shape, dtype=np.int32)
    total_truth = 0

    with torch.inference_mode():
        for image_index, sample in enumerate(samples, 1):
            result = model.predict(source=str(sample.image), imgsz=args.imgsz, conf=THRESHOLDS[0],
                                   iou=0.50, max_det=args.max_det, device=device,
                                   predictor=RawDetectionPredictor, verbose=False)[0]
            predictor = model.predictor
            raw = predictor.raw_predictions
            height, width = result.orig_shape
            truth = sample_truth(sample, width, height)
            total_truth += len(truth)

            for iou_index, iou in enumerate(THRESHOLDS):
                detections = nms.non_max_suppression(raw, THRESHOLDS[0], iou,
                                                     max_det=args.max_det, nc=0)[0]
                if len(detections):
                    boxes = ops.scale_boxes(predictor.input_shape, detections[:, :4].clone(),
                                            result.orig_shape).cpu().numpy()
                    scores = detections[:, 4].cpu().numpy()
                    order = np.argsort(-scores, kind="stable")
                    boxes, scores = boxes[order], scores[order]
                else:
                    boxes = np.empty((0, 4), dtype=np.float32)
                    scores = np.empty(0, dtype=np.float32)
                tp, predictions, ignored = threshold_counts(truth, boxes, scores, THRESHOLDS, sample.regions)
                all_ignored[:, iou_index] += ignored
                all_tp[:, iou_index] += tp
                all_predictions[:, iou_index] += predictions
                if (iou_index + 1) % 20 == 0:
                    print(f"Imagem {image_index}/{len(samples)} · NMS IoU {iou:.2f} avaliado", flush=True)
            del raw
            predictor.raw_predictions = None
            print(f"Imagem {image_index}/{len(samples)} concluída: {sample.image.name}", flush=True)

    rows = []
    for conf_index, confidence in enumerate(THRESHOLDS):
        for iou_index, iou in enumerate(THRESHOLDS):
            tp = int(all_tp[conf_index, iou_index])
            predicted = int(all_predictions[conf_index, iou_index])
            rows.append(metric_row(confidence, iou, total_truth, predicted, tp,
                                   all_ignored[conf_index, iou_index]))
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
