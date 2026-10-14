import argparse
import json
import os
import shutil
from pathlib import Path

from ultralytics import YOLO


def main():
    parser = argparse.ArgumentParser(description="Predicao configuravel iniciada pelo FarmGuard Studio.")
    parser.add_argument("--model", required=True)
    parser.add_argument("--name", default="studio-predict")
    parser.add_argument("--confidence", type=float, default=None)
    parser.add_argument("--iou", type=float, default=None)
    args = parser.parse_args()

    farmguard_root = Path(
        os.environ.get(
            "FARMGUARD_ROOT",
            str(Path(__file__).resolve().parents[3] / "FarmGuard"),
        )
    )
    ia_root = farmguard_root / "Iazinha"
    config_path = ia_root / "Models" / "insect-detector.json"
    config = {}
    if config_path.exists():
        config = json.loads(config_path.read_text(encoding="utf-8"))

    model = YOLO(args.model)
    prediction_root = ia_root / "Training" / "predictions"
    results = model.predict(
        source=str(ia_root / "Datasets" / "datasetUnimar" / "DatasetYolo" / "images" / "val"),
        imgsz=int(config.get("imgsz", 1280)),
        conf=args.confidence if args.confidence is not None else float(config.get("confidence", 0.2)),
        iou=args.iou if args.iou is not None else float(config.get("nms_iou", 0.4)),
        max_det=int(config.get("max_det", 1000)),
        device=0,
        save=True,
        project=str(prediction_root),
        name=args.name,
        exist_ok=True,
    )

    output_dir = Path(model.predictor.save_dir)
    originals_dir = output_dir / "_originals"
    originals_dir.mkdir(parents=True, exist_ok=True)
    detections = {}
    total = 0
    for result in results:
        image_name = Path(result.path).name
        shutil.copy2(result.path, originals_dir / image_name)
        height, width = result.orig_shape
        detections[image_name] = {
            "width": width,
            "height": height,
            "boxes": [
                {"x1": float(box[0]), "y1": float(box[1]), "x2": float(box[2]), "y2": float(box[3]),
                 "confidence": float(score)}
                for box, score in zip(result.boxes.xyxy.cpu().tolist(), result.boxes.conf.cpu().tolist())
            ],
        }
        count = len(result.boxes)
        total += count
        print(f"{image_name} -> {count} deteccoes", flush=True)
    (output_dir / "detections.json").write_text(json.dumps({
        "schema_version": 1,
        "model": str(Path(args.model).resolve()),
        "images": detections,
    }, ensure_ascii=False), encoding="utf-8")
    print(f"Total: {total} deteccoes", flush=True)


if __name__ == "__main__":
    main()
