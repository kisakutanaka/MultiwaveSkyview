#!/usr/bin/env python3
"""
Rasterize a downloaded Gaia catalog (see download_gaia_catalog.py) into the
same Galactic-coordinate CAR raw FITS format as the other all-sky surveys
(see allsky_surveys.build_car_wcs / download_allsky_fits.py), so it can be
processed by convert_allsky_png.py / fits_studio.py like any other survey.

Install:
    python -m pip install astropy numpy

Run:
    python rasterize_gaia_catalog.py
    python rasterize_gaia_catalog.py --mag-limit 10 --survey-name 02e_visible_gaia_dr3_mag

Rendering: each star is splatted as a Gaussian PSF whose amplitude (flux)
and width (sigma) both increase for brighter stars, mimicking photographic
blooming - see docs/gaia-magnitude-pipeline-plan.md step 4 for the visual
validation this formula was based on (there it was tested on an Orion crop
only; here it runs over the full catalog).

Bright-star supplement: Gaia's own photometry saturates for the very
brightest naked-eye stars (G ~< 3) - see docs/gaia-data-fields-examples.md.
If allsky_textures/gaia_catalog/bright_stars_v*.csv exists (see
download_bright_star_catalog.py), any Gaia row within
BRIGHT_STAR_MATCH_RADIUS_ARCSEC of a bright-star entry is replaced by that
entry's reliable Johnson V magnitude before rasterizing. Disable with
--no-bright-stars.
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.table import Table
from astropy.wcs import WCS
import astropy.units as u

from allsky_surveys import FITS_DIR, HEIGHT, WIDTH, build_car_wcs
from download_bright_star_catalog import catalog_path_for as bright_star_catalog_path_for
from download_gaia_catalog import catalog_path_for

DEFAULT_SURVEY_NAME = "02e_visible_gaia_dr3_mag"
BRIGHT_STAR_MATCH_RADIUS_ARCSEC = 30.0


def merge_bright_stars(
    ra: np.ndarray,
    dec: np.ndarray,
    mag: np.ndarray,
    bright_ra: np.ndarray,
    bright_dec: np.ndarray,
    bright_mag: np.ndarray,
    match_radius_arcsec: float = BRIGHT_STAR_MATCH_RADIUS_ARCSEC,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Replace any Gaia row within match_radius_arcsec of a bright-star entry
    with that entry (reliable V mag) instead, then append unmatched bright
    stars. Position-based, not ID-based: Gaia's saturated-star rows still
    have good astrometry (confirmed for Sirius in
    docs/gaia-data-fields-examples.md), just bad photometry."""
    gaia_coords = SkyCoord(ra=ra * u.deg, dec=dec * u.deg)
    bright_coords = SkyCoord(ra=bright_ra * u.deg, dec=bright_dec * u.deg)
    idx, sep2d, _ = bright_coords.match_to_catalog_sky(gaia_coords)
    matched = sep2d.arcsec < match_radius_arcsec
    print(f"[bright-stars] {matched.sum()}/{len(bright_ra)} matched an existing Gaia row within {match_radius_arcsec:g}\" (replacing)")

    keep_mask = np.ones(len(ra), dtype=bool)
    keep_mask[idx[matched]] = False

    merged_ra = np.concatenate([ra[keep_mask], bright_ra])
    merged_dec = np.concatenate([dec[keep_mask], bright_dec])
    merged_mag = np.concatenate([mag[keep_mask], bright_mag])
    return merged_ra, merged_dec, merged_mag


def rasterize(ra_deg: np.ndarray, dec_deg: np.ndarray, mag: np.ndarray, mag_limit: float) -> np.ndarray:
    wcs = WCS(build_car_wcs(WIDTH, HEIGHT))
    coords = SkyCoord(ra=ra_deg * u.deg, dec=dec_deg * u.deg, frame="icrs")
    gal = coords.galactic
    x, y = wcs.world_to_pixel_values(gal.l.deg, gal.b.deg)

    flux = 10 ** (-0.4 * (mag - mag_limit))
    sigma = np.clip(0.9 + 0.4 * (mag_limit - mag), 0.9, 6.0)

    canvas = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
    yy_full, xx_full = np.mgrid[0:HEIGHT, 0:WIDTH]  # noqa: reused only for slicing below via indices

    n = len(ra_deg)
    for i in range(n):
        xi, yi, f, s = x[i], y[i], flux[i], sigma[i]
        r = int(np.ceil(4 * s))
        x0, x1 = max(0, int(xi) - r), min(WIDTH, int(xi) + r + 1)
        y0, y1 = max(0, int(yi) - r), min(HEIGHT, int(yi) + r + 1)
        if x1 <= x0 or y1 <= y0:
            continue
        gx = xx_full[y0:y1, x0:x1] - xi
        gy = yy_full[y0:y1, x0:x1] - yi
        canvas[y0:y1, x0:x1] += f * np.exp(-(gx**2 + gy**2) / (2 * s**2))

        if (i + 1) % 100_000 == 0:
            print(f"[rasterize] {i + 1:,}/{n:,}")

    return canvas


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mag-limit", type=float, default=10.0, help="Must match the downloaded catalog's cutoff (default: 10.0).")
    parser.add_argument("--survey-name", default=DEFAULT_SURVEY_NAME, help=f"Output FITS filename stem (default: {DEFAULT_SURVEY_NAME}).")
    parser.add_argument("--bright-star-mag-limit", type=float, default=3.5, help="Must match the downloaded bright-star catalog's cutoff (default: 3.5).")
    parser.add_argument("--no-bright-stars", action="store_true", help="Skip merging the Yale BSC bright-star supplement even if downloaded.")
    parser.add_argument("--force", action="store_true", help="Re-render even if the output FITS already exists.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    catalog_path = catalog_path_for(args.mag_limit)
    if not catalog_path.exists():
        raise SystemExit(f"Catalog not found: {catalog_path}\nRun download_gaia_catalog.py --mag-limit {args.mag_limit} first.")

    output_path = FITS_DIR / f"{args.survey_name}.fits"
    if output_path.exists() and not args.force:
        print(f"[skip] exists: {output_path}")
        return

    print(f"[load] {catalog_path}")
    table = Table.read(catalog_path, format="csv")
    print(f"[load] {len(table):,} stars")
    ra, dec, mag = np.asarray(table["ra"]), np.asarray(table["dec"]), np.asarray(table["phot_g_mean_mag"])

    if not args.no_bright_stars:
        bright_path = bright_star_catalog_path_for(args.bright_star_mag_limit)
        if bright_path.exists():
            print(f"[load] {bright_path}")
            bright_table = Table.read(bright_path, format="csv")
            print(f"[load] {len(bright_table)} bright stars")
            ra, dec, mag = merge_bright_stars(
                ra, dec, mag,
                np.asarray(bright_table["ra"]), np.asarray(bright_table["dec"]), np.asarray(bright_table["vmag"]),
            )
        else:
            print(f"[skip] bright-star supplement not found: {bright_path} (run download_bright_star_catalog.py first)")

    start = time.monotonic()
    canvas = rasterize(ra, dec, mag, args.mag_limit)
    print(f"[rasterize] done in {time.monotonic() - start:.1f}s, max={canvas.max():.1f}, nonzero={np.count_nonzero(canvas):,}")

    FITS_DIR.mkdir(parents=True, exist_ok=True)
    header = WCS(build_car_wcs(WIDTH, HEIGHT)).to_header()
    hdu = fits.PrimaryHDU(canvas, header=header)
    temp_path = output_path.with_name(output_path.name + ".part")
    hdu.writeto(temp_path, overwrite=True)
    temp_path.replace(output_path)
    print(f"[saved] {output_path}")


if __name__ == "__main__":
    main()
