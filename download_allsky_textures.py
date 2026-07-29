#!/usr/bin/env python3
"""
Download six all-sky HiPS surveys as Galactic-coordinate CAR FITS files,
then convert them to 8192x4096 equirectangular PNG sphere textures.

Install:
    python -m pip install requests astropy numpy pillow

Run:
    python download_allsky_textures.py

Notes:
- Output projection is Galactic longitude/latitude, plate carrée (CAR).
- The textures are 2:1 equirectangular images suitable for sphere mapping.
- GALEX does not cover 100% of the sky; uncovered areas become black.
- Each FITS file can be ~130 MB at 8192x4096 float32.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Final

import numpy as np
import requests
from astropy.io import fits
from PIL import Image


WIDTH: Final[int] = 8192
HEIGHT: Final[int] = 4096

OUTPUT_DIR = Path("allsky_textures")
FITS_DIR = OUTPUT_DIR / "fits"
PNG_DIR = OUTPUT_DIR / "png"

HIPS2FITS_ENDPOINTS = [
    "https://alasky.cds.unistra.fr/hips-image-services/hips2fits",
    "https://alaskybis.cds.unistra.fr/hips-image-services/hips2fits",
]

# All six entries use scalar FITS HiPS datasets.
# min_percentile/max_percentile/stretch control only the local PNG conversion.
SURVEYS = {
    "00_radio_haslam_408mhz": {
        "hips": "CDS/P/Haslam408/v2",
        "min_percentile": 1.0,
        "max_percentile": 99.7,
        "stretch": "asinh",
    },
    "01_infrared_akari_90um": {
        "hips": "CDS/P/AKARI/FIS/WideS",
        "min_percentile": 1.0,
        "max_percentile": 99.7,
        "stretch": "asinh",
    },
    "02_visible_gaia_dr3_density": {
        "hips": "CDS/P/DM/I/355/gaiadr3",
        "min_percentile": 0.5,
        "max_percentile": 99.8,
        "stretch": "asinh",
    },
#    "02_visible_dss2_red": {
#        "hips": "CDS/P/DSS2/red",
#        "min_percentile": 5.0,
#        "max_percentile": 99.8,
#        "stretch": "asinh",
#    },
    "02d_visible_dss2_blue": {
        "hips": "CDS/P/DSS2/blue",
        "min_percentile": 5.0,
        "max_percentile": 99.8,
        "stretch": "asinh",
    },
    "03_ultraviolet_galex_nuv": {
        "hips": "CDS/P/GALEXGR6_7/NUV",
        "min_percentile": 1.0,
        "max_percentile": 99.8,
        "stretch": "asinh",
    },
    "04_xray_rosat_rass": {
        "hips": "ov-gso/P/RASS",
        "min_percentile": 1.0,
        "max_percentile": 99.7,
        "stretch": "sqrt",
    },
    "05_gamma_fermi_300_1000mev": {
        "hips": "CDS/P/Fermi/3",
        "min_percentile": 1.0,
        "max_percentile": 99.7,
        "stretch": "sqrt",
    },
}


def build_car_wcs(width: int, height: int) -> dict[str, object]:
    """Create a full-sky Galactic plate-carrée WCS."""
    return {
        "NAXIS": 2,
        "NAXIS1": width,
        "NAXIS2": height,
        "WCSAXES": 2,
        "CRPIX1": width / 2.0 + 0.5,
        "CRPIX2": height / 2.0 + 0.5,
        # Negative longitude makes the texture orientation work naturally
        # when viewed from inside many common 3D sphere implementations.
        "CDELT1": -360.0 / width,
        "CDELT2": 180.0 / height,
        "CUNIT1": "deg",
        "CUNIT2": "deg",
        "CTYPE1": "GLON-CAR",
        "CTYPE2": "GLAT-CAR",
        "CRVAL1": 0.0,
        "CRVAL2": 0.0,
    }


def download_fits(hips_id: str, output_path: Path) -> None:
    if output_path.exists() and output_path.stat().st_size > 1024:
        print(f"[skip] FITS exists: {output_path}")
        return

    params = {
        "hips": hips_id,
        "wcs": json.dumps(build_car_wcs(WIDTH, HEIGHT)),
        "format": "fits",
    }

    last_error: Exception | None = None

    for endpoint in HIPS2FITS_ENDPOINTS:
        for attempt in range(1, 4):
            temp_path = output_path.with_suffix(".fits.part")
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

                    content_type = response.headers.get("Content-Type", "")
                    if "fits" not in content_type.lower() and "octet-stream" not in content_type.lower():
                        preview = response.text[:500]
                        raise RuntimeError(
                            f"Unexpected response type {content_type}: {preview}"
                        )

                    with temp_path.open("wb") as file:
                        for chunk in response.iter_content(chunk_size=1024 * 1024):
                            if chunk:
                                file.write(chunk)

                # Validate before renaming.
                with fits.open(temp_path, memmap=True) as hdul:
                    _ = hdul[0].data.shape

                temp_path.replace(output_path)
                print(f"[saved] {output_path}")
                return

            except Exception as exc:
                last_error = exc
                print(f"[retry] {exc}")
                temp_path.unlink(missing_ok=True)
                time.sleep(attempt * 3)

    raise RuntimeError(f"Failed to download {hips_id}") from last_error


def stretch_image(
    data: np.ndarray,
    min_percentile: float,
    max_percentile: float,
    stretch: str,
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
        strength = 10.0
        normalized = np.arcsinh(strength * normalized) / np.arcsinh(strength)
    elif stretch == "sqrt":
        normalized = np.sqrt(normalized)
    elif stretch == "log":
        strength = 1000.0
        normalized = np.log1p(strength * normalized) / np.log1p(strength)
    elif stretch != "linear":
        raise ValueError(f"Unknown stretch: {stretch}")

    normalized[~finite] = 0.0
    return np.round(normalized * 255.0).astype(np.uint8)


def fits_to_png(
    fits_path: Path,
    png_path: Path,
    min_percentile: float,
    max_percentile: float,
    stretch: str,
) -> None:
    if png_path.exists() and png_path.stat().st_size > 1024:
        print(f"[skip] PNG exists: {png_path}")
        return

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
        )

    # FITS/WCS vertical direction and image texture direction can differ.
    # This flip produces north at the top in the exported PNG.
    image_data = np.flipud(image_data)

    image = Image.fromarray(image_data, mode="L")
    image.save(png_path, optimize=False, compress_level=4)
    print(f"[saved] {png_path}")


def main() -> None:
    FITS_DIR.mkdir(parents=True, exist_ok=True)
    PNG_DIR.mkdir(parents=True, exist_ok=True)

    for name, config in SURVEYS.items():
        fits_path = FITS_DIR / f"{name}.fits"
        png_path = PNG_DIR / f"{name}.png"

        download_fits(config["hips"], fits_path)
        fits_to_png(
            fits_path,
            png_path,
            min_percentile=config["min_percentile"],
            max_percentile=config["max_percentile"],
            stretch=config["stretch"],
        )

    print()
    print("Completed.")
    print(f"FITS: {FITS_DIR.resolve()}")
    print(f"PNG : {PNG_DIR.resolve()}")


if __name__ == "__main__":
    main()
