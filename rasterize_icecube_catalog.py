#!/usr/bin/env python3
"""
Rasterize the downloaded ICECAT-1 catalog (see download_icecube_catalog.py)
into the same Galactic-coordinate CAR raw FITS format as the other all-sky
surveys (see allsky_surveys.build_car_wcs), so it can be tuned/exported like
any other scalar survey via fits_studio.py.

Install:
    python -m pip install astropy numpy pandas

Run:
    python rasterize_icecube_catalog.py

Each event is a point (RA, Dec) with an asymmetric 90% CL error box, not a
full likelihood skymap like the GWTC events in rasterize_gw_skymaps.py - so
rather than reprojecting a HEALPix map, this instead splats a Gaussian PSF
per event, the same technique rasterize_gaia_catalog.py uses for stars:
tightly-localized events render as small bright spots, poorly-localized ones
as larger, fainter blobs. The per-axis 90% CL half-widths are converted to a
single circular 1-sigma radius via /1.645 (the 1D normal 90% CI factor) after
projecting the RA error to a true angular size with cos(dec) - an
approximation (the true 90% region is an asymmetric rectangle, not a
circle), acceptable for a visualization that isn't claiming to reproduce the
paper's actual likelihood contours.

Each event's peak amplitude is its SIGNAL value (the catalog's own estimated
probability the event is of genuine astrophysical origin, 0-1) rather than
energy: SIGNAL already folds in energy *and* the background rate at that
particular energy/declination (see FAR in the catalog), so it's a better
single "how much to trust this one" signal than energy alone. Events flagged
CR_VETO (in-time cosmic-ray shower activity at the surface array - the
catalog's own after-the-fact background tag) are dropped by default.
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np
import pandas as pd
import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS

from allsky_surveys import FITS_DIR, HEIGHT, WIDTH, build_car_wcs
from download_icecube_catalog import catalog_path

DEFAULT_SURVEY_NAME = "07_neutrino_icecat1_gold_bronze"
NINETY_PERCENT_CI_FACTOR = 1.645  # 1D normal: 90% CI half-width = 1.645 * sigma
DEFAULT_SIGMA_MIN_DEG = 0.3
DEFAULT_SIGMA_MAX_DEG = 10.0


def load_events(drop_cr_veto: bool = True) -> pd.DataFrame:
    path = catalog_path()
    if not path.exists():
        raise FileNotFoundError(f"Catalog not found: {path}\nRun download_icecube_catalog.py first.")
    df = pd.read_csv(path, sep="\t")
    if drop_cr_veto:
        before = len(df)
        df = df[~df["CR_VETO"]].reset_index(drop=True)
        print(f"[load] dropped {before - len(df)} CR_VETO-flagged events")
    return df


def event_sigma_deg(df: pd.DataFrame, sigma_min_deg: float, sigma_max_deg: float) -> np.ndarray:
    ra_err_deg = (df["RA_ERR_PLUS"] + df["RA_ERR_MINUS"]) / 2.0
    dec_err_deg = (df["DEC_ERR_PLUS"] + df["DEC_ERR_MINUS"]) / 2.0
    ra_err_true_deg = ra_err_deg * np.cos(np.radians(df["DEC"]))
    sigma_deg = 0.5 * (ra_err_true_deg.abs() + dec_err_deg) / NINETY_PERCENT_CI_FACTOR
    return np.clip(sigma_deg.to_numpy(), sigma_min_deg, sigma_max_deg)


def rasterize(
    ra_deg: np.ndarray,
    dec_deg: np.ndarray,
    sigma_deg: np.ndarray,
    amplitude: np.ndarray,
) -> np.ndarray:
    wcs = WCS(build_car_wcs(WIDTH, HEIGHT))
    coords = SkyCoord(ra=ra_deg * u.deg, dec=dec_deg * u.deg, frame="icrs")
    gal = coords.galactic
    x, y = wcs.world_to_pixel_values(gal.l.deg, gal.b.deg)
    sigma_px = sigma_deg * (WIDTH / 360.0)

    canvas = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
    yy_full, xx_full = np.mgrid[0:HEIGHT, 0:WIDTH]

    for i in range(len(ra_deg)):
        xi, yi, s, amp = x[i], y[i], sigma_px[i], amplitude[i]
        r = int(np.ceil(4 * s))
        x0, x1 = max(0, int(xi) - r), min(WIDTH, int(xi) + r + 1)
        y0, y1 = max(0, int(yi) - r), min(HEIGHT, int(yi) + r + 1)
        if x1 <= x0 or y1 <= y0:
            continue
        gx = xx_full[y0:y1, x0:x1] - xi
        gy = yy_full[y0:y1, x0:x1] - yi
        canvas[y0:y1, x0:x1] += amp * np.exp(-(gx**2 + gy**2) / (2 * s**2))

    return canvas


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--survey-name", default=DEFAULT_SURVEY_NAME, help=f"Output FITS filename stem (default: {DEFAULT_SURVEY_NAME}).")
    parser.add_argument("--sigma-min-deg", type=float, default=DEFAULT_SIGMA_MIN_DEG)
    parser.add_argument("--sigma-max-deg", type=float, default=DEFAULT_SIGMA_MAX_DEG)
    parser.add_argument("--keep-cr-veto", action="store_true", help="Keep events flagged CR_VETO (likely background) instead of dropping them.")
    parser.add_argument("--force", action="store_true", help="Re-render even if the output FITS already exists.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    output_path = FITS_DIR / f"{args.survey_name}.fits"
    if output_path.exists() and not args.force:
        print(f"[skip] exists: {output_path}")
        return

    df = load_events(drop_cr_veto=not args.keep_cr_veto)
    print(f"[load] {len(df)} events")

    sigma_deg = event_sigma_deg(df, args.sigma_min_deg, args.sigma_max_deg)
    amplitude = df["SIGNAL"].to_numpy()

    start = time.monotonic()
    canvas = rasterize(df["RA"].to_numpy(), df["DEC"].to_numpy(), sigma_deg, amplitude)
    print(f"[rasterize] done in {time.monotonic() - start:.1f}s, max={canvas.max():.3f}, sum={canvas.sum():.1f}")

    FITS_DIR.mkdir(parents=True, exist_ok=True)
    header = WCS(build_car_wcs(WIDTH, HEIGHT)).to_header()
    hdu = fits.PrimaryHDU(canvas, header=header)
    temp_path = output_path.with_name(output_path.name + ".part")
    hdu.writeto(temp_path, overwrite=True)
    temp_path.replace(output_path)
    print(f"[saved] {output_path}")


if __name__ == "__main__":
    main()
