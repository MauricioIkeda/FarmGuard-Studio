"""Validate a promotion candidate and report the checkpoint's real architecture."""

import argparse
import json
from pathlib import Path

from ultralytics import YOLO


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    model = YOLO(args.model)
    if model.task != "detect" or len(model.names) != 1 or str(next(iter(model.names.values()))).lower() != "insect":
        raise ValueError("O modelo principal precisa detectar a classe única insect.")
    yaml_file = model.model.yaml.get("yaml_file", "")
    architecture = Path(yaml_file).stem if yaml_file else type(model.model).__name__
    print(json.dumps({"architecture": architecture, "class_names": {str(k): str(v) for k, v in model.names.items()}}), flush=True)


if __name__ == "__main__":
    main()
