"""One-shot inference for Studio camera tests; never touches FarmGuard datasets."""

import argparse
import json
from pathlib import Path

import cv2
import torch
from ultralytics import YOLO


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--confidence", type=float, required=True)
    parser.add_argument("--iou", type=float, required=True)
    parser.add_argument("--imgsz", type=int, default=1280)
    parser.add_argument("--max-det", type=int, default=1000)
    args = parser.parse_args()

    device = 0 if torch.cuda.is_available() else "mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available() else "cpu"
    result = YOLO(args.model).predict(
        source=args.image, imgsz=args.imgsz, conf=args.confidence,
        iou=args.iou, max_det=args.max_det, device=device, verbose=False,
    )[0]
    annotated = result.plot(line_width=2, font_size=12)
    if not cv2.imwrite(args.output, annotated, [cv2.IMWRITE_JPEG_QUALITY, 92]):
        raise RuntimeError("Não foi possível salvar a visualização da predição.")
    boxes = result.boxes
    print(json.dumps({
        "width": result.orig_shape[1], "height": result.orig_shape[0],
        "detections": len(boxes),
        "boxes": [
            {"xyxy": [round(float(v), 2) for v in xyxy], "confidence": round(float(conf), 4)}
            for xyxy, conf in zip(boxes.xyxy.cpu().tolist(), boxes.conf.cpu().tolist())
        ],
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
