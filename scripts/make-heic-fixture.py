"""Generates tests/fixtures/photo.heic and photo-gps.heic (HEIC encoded with x265).

No browser or Node library writes HEIC, so this one fixture comes from Python:

    python -m venv .venv && .venv/bin/pip install pillow==13.0.0 pillow-heif==1.8.1
    .venv/bin/python scripts/make-heic-fixture.py

The output is committed: run this only to change the fixture. `photo-gps.heic` carries the EXIF
block (with a position) of tests/fixtures/jpeg-gps.jpg, to check that no position survives.
"""

from pathlib import Path

from PIL import Image
from pillow_heif import register_heif_opener

register_heif_opener()

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures"


def quarters(width: int, height: int) -> Image.Image:
    image = Image.new("RGB", (width, height), (128, 128, 128))
    w2, h2 = width // 2, height // 2
    for box, color in (
        ((0, 0, w2, h2), (224, 48, 48)),
        ((w2, 0, width, h2), (48, 192, 48)),
        ((0, h2, w2, height), (48, 80, 224)),
        ((w2, h2, width, height), (224, 208, 48)),
    ):
        image.paste(color, box)
    return image


exif = Image.open(FIXTURES / "jpeg-gps.jpg").info["exif"]
quarters(96, 64).save(FIXTURES / "photo.heic", quality=80)
quarters(128, 96).save(FIXTURES / "photo-gps.heic", quality=80, exif=exif)
print("tests/fixtures/photo.heic and photo-gps.heic generated")
