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
    parser.add_argument("--confidence", type=float, required=True)
    parser.add_argument("--iou", type=float, required=True)
    parser.add_argument("--imgsz", type=int, default=1280)
    parser.add_argument("--max-det", type=int, default=1000)
    args = parser.parse_args()

    farmguard_root = Path(
        os.environ.get(
            "FARMGUARD_ROOT",
            str(Path(__file__).resolve().parents[3] / "FarmGuard"),
        )
    )
    ia_root = farmguard_root / "Iazinha"
    model = YOLO(args.model)
    prediction_root = ia_root / "Training" / "predictions"
    results = model.predict(
        source=str(ia_root / "Datasets" / "datasetUnimar" / "DatasetYolo" / "images" / "val"),
        imgsz=args.imgsz,
        conf=args.confidence,
        iou=args.iou,
        max_det=args.max_det,
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
