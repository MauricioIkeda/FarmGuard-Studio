"""Evaluate one user-chosen threshold pair on the current Unimar validation split."""

import argparse
import csv
from pathlib import Path

import torch
from ultralytics import YOLO


def ground_truth(label_path, width, height):
    result = []
    for line in label_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        _, x, y, w, h = map(float, line.split())
        result.append(((x - w / 2) * width, (y - h / 2) * height,
                       (x + w / 2) * width, (y + h / 2) * height))
    return result


def overlap(a, b):
    left, top = max(a[0], b[0]), max(a[1], b[1])
    right, bottom = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0, right - left) * max(0, bottom - top)
    if not intersection:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return intersection / (area_a + area_b - intersection)


def matches(truth, predictions):
    candidates = sorted(((overlap(a, b), i, j)
                         for i, a in enumerate(truth)
                         for j, b in enumerate(predictions)), reverse=True)
    used_truth, used_predictions = set(), set()
    for score, i, j in candidates:
        if score < 0.30:
            break
        if i not in used_truth and j not in used_predictions:
            used_truth.add(i)
            used_predictions.add(j)
    tp = len(used_truth)
    return tp, len(predictions) - tp, len(truth) - tp


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--confidence", required=True, type=float)
    parser.add_argument("--iou", required=True, type=float)
    args = parser.parse_args()
    if not (0.01 <= args.confidence <= 0.99 and 0.01 <= args.iou <= 0.99):
        raise ValueError("Confidence e IoU devem estar entre 0,01 e 0,99.")
    root = Path(args.dataset)
    images = sorted((root / "images" / "val").glob("*.jpg"))
    if not images:
        raise ValueError("O conjunto de validação está vazio.")
    device = 0 if torch.cuda.is_available() else "mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available() else "cpu"
    model = YOLO(args.model)
    tp = fp = fn = total_truth = total_predictions = 0
    for index, image in enumerate(images, 1):
        result = model.predict(source=str(image), imgsz=1280, conf=args.confidence,
                               iou=args.iou, max_det=1000, device=device, verbose=False)[0]
        height, width = result.orig_shape
        truth = ground_truth(root / "labels" / "val" / f"{image.stem}.txt", width, height)
        predictions = [tuple(map(float, box)) for box in result.boxes.xyxy.cpu().tolist()]
        a, b, c = matches(truth, predictions)
        tp, fp, fn = tp + a, fp + b, fn + c
        total_truth += len(truth)
        total_predictions += len(predictions)
        print(f"{index}/{len(images)} · {image.name}: TP {a}, FP {b}, FN {c}", flush=True)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    row = {"confidence": args.confidence, "nms_iou": args.iou, "match_iou": 0.30,
           "ground_truth": total_truth, "predictions": total_predictions,
           "tp": tp, "fp": fp, "fn": fn, "precision": precision,
           "recall": recall, "f1": f1, "edit_proxy": fp + fn}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=row.keys())
        writer.writeheader()
        writer.writerow(row)
    print(f"Ajuste manual avaliado: confiança {args.confidence:.2f}, NMS IoU {args.iou:.2f}; {fp + fn} correções estimadas.", flush=True)


if __name__ == "__main__":
    main()
