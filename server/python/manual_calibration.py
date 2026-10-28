"""Evaluate one user-chosen threshold pair on the current Unimar validation split."""

import argparse
import csv
from pathlib import Path

import torch
from ultralytics import YOLO

from calibration_common import metric_row, sample_truth, threshold_counts, validation_samples


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--confidence", required=True, type=float)
    parser.add_argument("--iou", required=True, type=float)
    parser.add_argument("--imgsz", type=int, default=1280)
    parser.add_argument("--max-det", type=int, default=1000)
    args = parser.parse_args()
    if not (0.01 <= args.confidence <= 0.99 and 0.01 <= args.iou <= 0.99):
        raise ValueError("Confidence e IoU devem estar entre 0,01 e 0,99.")
    root = Path(args.dataset)
    samples = validation_samples(root)
    device = 0 if torch.cuda.is_available() else "mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available() else "cpu"
    model = YOLO(args.model)
    tp = total_truth = total_predictions = total_ignored = 0
    for index, sample in enumerate(samples, 1):
        result = model.predict(source=str(sample.image), imgsz=args.imgsz, conf=args.confidence,
                               iou=args.iou, max_det=args.max_det, device=device, verbose=False)[0]
        height, width = result.orig_shape
        truth = sample_truth(sample, width, height)
        counts, predictions, ignored = threshold_counts(truth, result.boxes.xyxy.cpu().numpy(),
            result.boxes.conf.cpu().numpy(), [args.confidence], sample.regions)
        tp += int(counts[0])
        total_truth += len(truth)
        total_predictions += int(predictions[0])
        total_ignored += int(ignored[0])
        print(f"{index}/{len(samples)} · {sample.image.name}: TP {counts[0]}, ignoradas {ignored[0]}", flush=True)
    row = metric_row(args.confidence, args.iou, total_truth, total_predictions, tp, total_ignored)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=row.keys())
        writer.writeheader()
        writer.writerow(row)
    print(f'Ajuste manual avaliado: confiança {args.confidence:.2f}, NMS IoU {args.iou:.2f}; {row["edit_proxy"]} correções estimadas.', flush=True)


if __name__ == "__main__":
    main()
