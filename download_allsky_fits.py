#!/usr/bin/env python3
"""
Download all-sky HiPS surveys (see allsky_surveys.SURVEYS) as
Galactic-coordinate CAR raw files.

Install:
    python -m pip install requests astropy pillow

Run:
    python download_allsky_fits.py
    python download_allsky_fits.py --survey 02_visible_gaia_dr3_density
    python download_allsky_fits.py --force

Notes:
- Output projection is Galactic longitude/latitude, plate carrée (CAR).
- "scalar" surveys are saved as float32 FITS (~130 MB each at 8192x4096).
- "color" surveys are pre-rendered RGB HiPS and are saved as PNG directly.
- Use convert_allsky_png.py to turn the downloaded raw files into PNG textures.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import requests
from astropy.io import fits
from PIL import Image

from allsky_surveys import FITS_DIR, HEIGHT, SURVEYS, WIDTH, build_car_wcs

HIPS2FITS_ENDPOINTS = [
    "https://alasky.cds.unistra.fr/hips-image-services/hips2fits",
    "https://alaskybis.cds.unistra.fr/hips-image-services/hips2fits",
]

# Per-kind request format, expected Content-Type substrings, and validator.
_KIND_SETTINGS = {
    "scalar": {
        "format": "fits",
        "ext": ".fits",
        "content_type_keywords": ("fits", "octet-stream"),
    },
    "color": {
        "format": "png",
        "ext": ".png",
        "content_type_keywords": ("png", "octet-stream"),
    },
}


def _validate(path: Path, fmt: str) -> None:
    if fmt == "fits":
        with fits.open(path, memmap=True) as hdul:
            _ = hdul[0].data.shape
    else:
        with Image.open(path) as image:
            image.verify()


def raw_path_for(name: str, config: dict) -> Path:
    ext = _KIND_SETTINGS[config.get("kind", "scalar")]["ext"]
    return FITS_DIR / f"{name}{ext}"


def download_hips2fits(hips_id: str, output_path: Path, kind: str) -> None:
    if output_path.exists() and output_path.stat().st_size > 1024:
        print(f"[skip] exists: {output_path}")
        return

    settings = _KIND_SETTINGS[kind]
    params = {
        "hips": hips_id,
        "wcs": json.dumps(build_car_wcs(WIDTH, HEIGHT)),
        "format": settings["format"],
    }

    last_error: Exception | None = None

    for endpoint in HIPS2FITS_ENDPOINTS:
        for attempt in range(1, 4):
            temp_path = output_path.with_name(output_path.name + ".part")
            try:
                print(f"[download] {hips_id}")
                print(f"           endpoint={endpoint}, attempt={attempt}")

                with requests.get(
                    endpoint,
                    params=params,
                    stream=True,
                    timeout=(30, 900),
                    headers={"User-Agent": "allsky-texture-builder/1.0"},
                ) as response:
                    response.raise_for_status()

                    content_type = response.headers.get("Content-Type", "").lower()
                    if not any(keyword in content_type for keyword in settings["content_type_keywords"]):
                        preview = response.text[:500]
                        raise RuntimeError(
                            f"Unexpected response type {content_type}: {preview}"
                        )

                    with temp_path.open("wb") as file:
                        for chunk in response.iter_content(chunk_size=1024 * 1024):
                            if chunk:
                                file.write(chunk)

                # Validate before renaming.
                _validate(temp_path, settings["format"])

                temp_path.replace(output_path)
                print(f"[saved] {output_path}")
                return

            except Exception as exc:
                last_error = exc
                print(f"[retry] {exc}")
                temp_path.unlink(missing_ok=True)
                time.sleep(attempt * 3)

    raise RuntimeError(f"Failed to download {hips_id}") from last_error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--survey",
        action="append",
        choices=list(SURVEYS.keys()),
        metavar="NAME",
        help="Limit to this survey (repeatable). Default: all surveys.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download even if the raw file already exists.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    names = args.survey or list(SURVEYS.keys())

    FITS_DIR.mkdir(parents=True, exist_ok=True)

    for name in names:
        config = SURVEYS[name]
        kind = config.get("kind", "scalar")
        raw_path = raw_path_for(name, config)
        if args.force:
            raw_path.unlink(missing_ok=True)
        download_hips2fits(config["hips"], raw_path, kind)

    print()
    print("Completed.")
    print(f"Raw files: {FITS_DIR.resolve()}")


if __name__ == "__main__":
    main()
