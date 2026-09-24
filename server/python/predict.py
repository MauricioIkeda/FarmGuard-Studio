import argparse
import json
import os
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
    results = model.predict(
        source=str(ia_root / "DatasetYolo" / "images" / "val"),
        imgsz=int(config.get("imgsz", 1280)),
        conf=args.confidence if args.confidence is not None else float(config.get("confidence", 0.2)),
        iou=args.iou if args.iou is not None else float(config.get("nms_iou", 0.4)),
        max_det=int(config.get("max_det", 1000)),
        device=0,
        save=True,
        project=str(ia_root / "Training" / "predictions"),
        name=args.name,
        exist_ok=True,
    )

    total = 0
    for result in results:
        count = len(result.boxes)
        total += count
        print(f"{Path(result.path).name} -> {count} deteccoes", flush=True)
    print(f"Total: {total} deteccoes", flush=True)


if __name__ == "__main__":
    main()
