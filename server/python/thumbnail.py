import sys

from PIL import Image, ImageOps


def main() -> None:
    source, destination = sys.argv[1:3]
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original)
        image.thumbnail((480, 360), Image.Resampling.LANCZOS)
        if image.mode != "RGB":
            image = image.convert("RGB")
        image.save(destination, format="JPEG", quality=80, optimize=True)


if __name__ == "__main__":
    main()
