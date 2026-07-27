#!/usr/bin/env python3
"""
Convert downloaded all-sky raw files (see download_allsky_fits.py) into
8192x4096 equirectangular PNG sphere textures.

Install:
    python -m pip install astropy numpy pillow

Run:
    python convert_allsky_png.py
    python convert_allsky_png.py --survey 02_visible_gaia_dr3_density --stretch asinh --strength 40
    python convert_allsky_png.py --min-percentile 0.1 --force

Notes:
- The textures are 2:1 equirectangular images suitable for sphere mapping.
- GALEX does not cover 100% of the sky; uncovered areas become black.
- CLI overrides apply only to "scalar" surveys; "color" surveys (e.g. the
  Gaia DR3 RGB flux map) are pre-rendered and copied through unchanged
  except for the north-up flip.
- CLI overrides apply to every selected scalar survey for this run;
  per-survey defaults live in allsky_surveys.SURVEYS.
"""

from __future__ import annotations

import argparse

import numpy as np
from astropy.io import fits
from PIL import Image

from allsky_surveys import PNG_DIR, SURVEYS
from download_allsky_fits import raw_path_for

DEFAULT_STRENGTH = {
    "asinh": 10.0,
    "log": 1000.0,
}


def stretch_image(
    data: np.ndarray,
    min_percentile: float,
    max_percentile: float,
    stretch: str,
    strength: float | None = None,
) -> np.ndarray:
    data = np.asarray(data, dtype=np.float32)

    finite = np.isfinite(data)
    if not np.any(finite):
        raise ValueError("FITS image contains no finite pixels.")

    valid_values = data[finite]
    low, high = np.nanpercentile(
        valid_values,
        [min_percentile, max_percentile],
    )

    if not np.isfinite(low) or not np.isfinite(high) or high <= low:
        low = float(np.nanmin(valid_values))
        high = float(np.nanmax(valid_values))

    normalized = (data - low) / max(high - low, np.finfo(np.float32).eps)
    normalized = np.clip(normalized, 0.0, 1.0)

    if stretch == "asinh":
        strength = strength if strength is not None else DEFAULT_STRENGTH["asinh"]
        normalized = np.arcsinh(strength * normalized) / np.arcsinh(strength)
    elif stretch == "sqrt":
        normalized = np.sqrt(normalized)
    elif stretch == "log":
        strength = strength if strength is not None else DEFAULT_STRENGTH["log"]
        normalized = np.log1p(strength * normalized) / np.log1p(strength)
    elif stretch != "linear":
        raise ValueError(f"Unknown stretch: {stretch}")

    normalized[~finite] = 0.0
    return np.round(normalized * 255.0).astype(np.uint8)


def fits_to_png(
    fits_path,
    png_path,
    min_percentile: float,
    max_percentile: float,
    stretch: str,
    strength: float | None = None,
) -> None:
    print(f"[convert] {fits_path.name} -> {png_path.name}")

    with fits.open(fits_path, memmap=True) as hdul:
        data = np.squeeze(hdul[0].data)

        if data.ndim != 2:
            raise ValueError(
                f"Expected a 2D FITS image, got shape {data.shape}: {fits_path}"
            )

        image_data = stretch_image(
            data,
            min_percentile=min_percentile,
            max_percentile=max_percentile,
            stretch=stretch,
            strength=strength,
        )

    # FITS/WCS vertical direction and image texture direction can differ.
    # This flip produces north at the top in the exported PNG.
    image_data = np.flipud(image_data)

    image = Image.fromarray(image_data, mode="L")
    image.save(png_path, optimize=False, compress_level=4)
    print(f"[saved] {png_path}")


def color_to_png(raw_path, png_path) -> None:
    print(f"[convert] {raw_path.name} -> {png_path.name}")

    with Image.open(raw_path) as image:
        image = image.convert("RGB")
        # Matches the flip applied to scalar surveys so north stays up.
        image = image.transpose(Image.FLIP_TOP_BOTTOM)
        image.save(png_path, optimize=False, compress_level=4)

    print(f"[saved] {png_path}")


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
        "--stretch",
        choices=["linear", "sqrt", "asinh", "log"],
        help="Override stretch method for the selected surveys.",
    )
    parser.add_argument(
        "--strength",
        type=float,
        help="Override asinh/log strength (higher = brighter faint stars).",
    )
    parser.add_argument(
        "--min-percentile",
        type=float,
        help="Override the black-point percentile.",
    )
    parser.add_argument(
        "--max-percentile",
        type=float,
        help="Override the white-point percentile.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-convert even if the PNG already exists.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    names = args.survey or list(SURVEYS.keys())

    PNG_DIR.mkdir(parents=True, exist_ok=True)

    for name in names:
        config = SURVEYS[name]
        kind = config.get("kind", "scalar")
        raw_path = raw_path_for(name, config)
        png_path = PNG_DIR / f"{name}.png"

        if not raw_path.exists():
            print(f"[skip] raw file missing, run download_allsky_fits.py first: {raw_path}")
            continue

        if args.force:
            png_path.unlink(missing_ok=True)
        elif png_path.exists() and png_path.stat().st_size > 1024:
            print(f"[skip] PNG exists: {png_path}")
            continue

        if kind == "color":
            if args.stretch or args.strength is not None or args.min_percentile is not None or args.max_percentile is not None:
                print(f"[note] {name} is a pre-rendered color survey; stretch/percentile overrides are ignored.")
            color_to_png(raw_path, png_path)
        else:
            fits_to_png(
                raw_path,
                png_path,
                min_percentile=args.min_percentile if args.min_percentile is not None else config["min_percentile"],
                max_percentile=args.max_percentile if args.max_percentile is not None else config["max_percentile"],
                stretch=args.stretch or config["stretch"],
                strength=args.strength,
            )

    print()
    print("Completed.")
    print(f"PNG: {PNG_DIR.resolve()}")


if __name__ == "__main__":
    main()
