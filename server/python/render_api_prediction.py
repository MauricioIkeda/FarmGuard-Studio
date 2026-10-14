"""Render the IA API's boxes without loading YOLO in the Studio process."""

import argparse
import json
from PIL import Image, ImageDraw, ImageFont


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--prediction", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    with open(args.prediction, encoding="utf-8") as source:
        result = json.load(source)
    with Image.open(args.image) as source:
        image = source.convert("RGB")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    for detection in result["detections"]:
        box = detection["box_px"]
        x, y = box["x"], box["y"]
        right, bottom = x + box["width"], y + box["height"]
        draw.rectangle((x, y, right, bottom), outline=(85, 255, 173), width=2)
        label = f'{detection["confidence"]:.2f}'
        label_top = max(0, y - 13)
        label_width = draw.textlength(label, font=font) + 4
        draw.rectangle((x, label_top, x + label_width, label_top + 13), fill=(0, 65, 40))
        draw.text((x + 2, label_top), label, fill="white", font=font)
    image.save(args.output, "JPEG", quality=92)
    print(json.dumps({"width": image.width, "height": image.height, "detections": len(result["detections"])}), flush=True)


if __name__ == "__main__":
    main()
