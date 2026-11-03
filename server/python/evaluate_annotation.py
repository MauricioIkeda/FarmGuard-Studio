import json
import os
from pathlib import Path
import sys

root = Path(os.environ.get("FARMGUARD_ROOT", Path(__file__).resolve().parents[3] / "FarmGuard"))
sys.path.insert(0, str(root / "Iazinha" / "Training"))

from calibration_metrics import evaluate_predictions


def main():
    request = json.load(sys.stdin)
    annotation = request["annotation"]
    if not annotation.get("reviewed") or annotation.get("excluded"):
        raise ValueError("Conclua a revisão da imagem antes de conferir a IA.")
    result = evaluate_predictions(annotation, request["detections"])
    json.dump(result, sys.stdout, ensure_ascii=False, allow_nan=False)


if __name__ == "__main__":
    main()
