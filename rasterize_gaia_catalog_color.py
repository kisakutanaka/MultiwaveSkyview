#!/usr/bin/env python3
"""
Same pipeline as rasterize_gaia_catalog.py, but colored by each star's color
index (Gaia BP-RP, or Johnson B-V for the bright-star supplement) instead of
a single grayscale channel - blue-white for hot stars, orange-red for cool
ones, roughly following the classic OBAFGKM color sequence.

Requires download_gaia_catalog.py to have been run with the bp_rp column
(current version always fetches it) and, optionally,
download_bright_star_catalog.py for the bright-star color/magnitude fix
(see rasterize_gaia_catalog.py's docstring).

Install:
    python -m pip install astropy numpy pillow

Run:
    python rasterize_gaia_catalog_color.py
    python rasterize_gaia_catalog_color.py --mag-limit 10

Output goes straight to a PNG (allsky_textures/png_colored/), not a raw
FITS: color stretching needs all 3 channels normalized together (see
stretch_rgb below), which doesn't fit convert_allsky_png.py's single-channel
pipeline. This mirrors how fits_studio.py's DSS2 red+blue composite mode
also goes straight from arrays to PNG.
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np
from astropy.coordinates import SkyCoord
from astropy.table import Table
from astropy.wcs import WCS
import astropy.units as u
from PIL import Image

from allsky_surveys import HEIGHT, PNG_HEIGHT, PNG_WIDTH, WIDTH, build_car_wcs
from download_bright_star_catalog import catalog_path_for as bright_star_catalog_path_for
from download_gaia_catalog import catalog_path_for
from image_processing import resize_to
from rasterize_gaia_catalog import BRIGHT_STAR_MATCH_RADIUS_ARCSEC

OUTPUT_DIR = Path("allsky_textures") / "png_colored"
DEFAULT_OUTPUT_NAME = "02f_visible_gaia_dr3_color"
DEFAULT_SIGMA_BASE = 0.9
DEFAULT_SIGMA_SCALE = 0.4
DEFAULT_SIGMA_MAX = 6.0

# Rough OBAFGKM color sequence, (color_index, (r, g, b) in 0-1) sorted
# ascending. Two separate breakpoint sets because BP-RP (Gaia) and B-V
# (Johnson, used by the bright-star supplement) are different scales that
# aren't worth precisely reconciling for what is ultimately an aesthetic
# rendering, not photometric science.
BP_RP_BREAKPOINTS = [
    (-0.4, (0.61, 0.70, 1.00)),
    (0.2, (0.83, 0.88, 1.00)),
    (0.8, (1.00, 1.00, 1.00)),  # Sun-like, bp_rp ~ 0.82
    (1.4, (1.00, 0.85, 0.65)),
    (2.2, (1.00, 0.65, 0.40)),
    (3.5, (1.00, 0.45, 0.35)),
]
BV_BREAKPOINTS = [
    (-0.3, (0.61, 0.70, 1.00)),
    (0.0, (0.83, 0.88, 1.00)),
    (0.65, (1.00, 1.00, 1.00)),  # Sun, B-V = 0.65
    (1.0, (1.00, 0.85, 0.65)),
    (1.5, (1.00, 0.65, 0.40)),
    (2.5, (1.00, 0.45, 0.35)),
]


def color_index_to_rgb(color_index: np.ndarray, breakpoints: list[tuple[float, tuple[float, float, float]]]) -> np.ndarray:
    xs = np.array([bp[0] for bp in breakpoints])
    channels = np.array([bp[1] for bp in breakpoints])  # (n_stops, 3)
    rgb = np.stack([np.interp(color_index, xs, channels[:, c]) for c in range(3)], axis=-1)
    return rgb


def apply_saturation(rgb: np.ndarray, saturation: float = 1.0) -> np.ndarray:
    """0 = white/no color, 1 = as mapped by color_index_to_rgb, >1 exaggerates
    each star's own color (a red star gets redder, a blue star gets bluer,
    white/Sun-like stars stay white) - scales distance from white, doesn't
    shift the whole population toward one hue."""
    adjusted = 1.0 + saturation * (rgb - 1.0)
    return np.clip(adjusted, 0.0, 1.0)


def load_and_merge_color_stars(
    mag_limit: float,
    bright_star_mag_limit: float | None,
    match_radius_arcsec: float = BRIGHT_STAR_MATCH_RADIUS_ARCSEC,
    saturation: float = 1.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Loads the downloaded Gaia catalog for mag_limit, colors each star by
    its BP-RP (or the bright-star supplement's B-V), and returns
    (ra, dec, mag, rgb). Shared by this script's CLI and fits_studio.py's
    Gaia mode."""
    catalog_path = catalog_path_for(mag_limit)
    if not catalog_path.exists():
        raise FileNotFoundError(f"Catalog not found: {catalog_path}\nRun download_gaia_catalog.py --mag-limit {mag_limit} first.")
    table = Table.read(catalog_path, format="csv")
    ra, dec, mag = np.asarray(table["ra"]), np.asarray(table["dec"]), np.asarray(table["phot_g_mean_mag"])
    bp_rp = np.asarray(table["bp_rp"], dtype=np.float64)
    bp_rp[~np.isfinite(bp_rp)] = 0.8  # Sun-like default for the ~0.06% missing bp_rp
    rgb = color_index_to_rgb(bp_rp, BP_RP_BREAKPOINTS)

    if bright_star_mag_limit is not None:
        bright_path = bright_star_catalog_path_for(bright_star_mag_limit)
        if bright_path.exists():
            bright_table = Table.read(bright_path, format="csv")
            bright_ra = np.asarray(bright_table["ra"])
            bright_dec = np.asarray(bright_table["dec"])
            bright_mag = np.asarray(bright_table["vmag"])
            bright_bv = np.asarray(bright_table["bv"], dtype=np.float64)
            bright_bv[~np.isfinite(bright_bv)] = 0.65
            bright_rgb = color_index_to_rgb(bright_bv, BV_BREAKPOINTS)

            gaia_coords = SkyCoord(ra=ra * u.deg, dec=dec * u.deg)
            bright_coords = SkyCoord(ra=bright_ra * u.deg, dec=bright_dec * u.deg)
            idx, sep2d, _ = bright_coords.match_to_catalog_sky(gaia_coords)
            matched = sep2d.arcsec < match_radius_arcsec
            keep_mask = np.ones(len(ra), dtype=bool)
            keep_mask[idx[matched]] = False

            ra = np.concatenate([ra[keep_mask], bright_ra])
            dec = np.concatenate([dec[keep_mask], bright_dec])
            mag = np.concatenate([mag[keep_mask], bright_mag])
            rgb = np.concatenate([rgb[keep_mask], bright_rgb])

    rgb = apply_saturation(rgb, saturation)
    return ra, dec, mag, rgb


def rasterize_color(
    ra_deg: np.ndarray,
    dec_deg: np.ndarray,
    mag: np.ndarray,
    rgb: np.ndarray,
    mag_limit: float,
    sigma_base: float = DEFAULT_SIGMA_BASE,
    sigma_scale: float = DEFAULT_SIGMA_SCALE,
    sigma_max: float = DEFAULT_SIGMA_MAX,
) -> np.ndarray:
    wcs = WCS(build_car_wcs(WIDTH, HEIGHT))
    coords = SkyCoord(ra=ra_deg * u.deg, dec=dec_deg * u.deg, frame="icrs")
    gal = coords.galactic
    x, y = wcs.world_to_pixel_values(gal.l.deg, gal.b.deg)

    flux = 10 ** (-0.4 * (mag - mag_limit))
    sigma = np.clip(sigma_base + sigma_scale * (mag_limit - mag), sigma_base, sigma_max)

    canvas = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float32)
    yy_full, xx_full = np.mgrid[0:HEIGHT, 0:WIDTH]

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
        gauss = f * np.exp(-(gx**2 + gy**2) / (2 * s**2))
        canvas[y0:y1, x0:x1, :] += gauss[:, :, None] * rgb[i][None, None, :]

        if (i + 1) % 100_000 == 0:
            print(f"[rasterize] {i + 1:,}/{n:,}")

    return canvas


def stretch_rgb(canvas: np.ndarray, percentile: float = 99.9, strength: float = 10.0) -> np.ndarray:
    """Normalize + asinh-stretch all 3 channels by one shared scale (not
    per-channel independently), so hue is preserved except where a star is
    bright enough to genuinely saturate to white - which is the same
    "blooms to white" behavior real astrophotos show."""
    peak = canvas.max(axis=-1)
    scale = np.percentile(peak[peak > 0], percentile)
    norm = np.clip(canvas / max(scale, np.finfo(np.float32).eps), 0.0, 1.0)
    stretched = np.arcsinh(strength * norm) / np.arcsinh(strength)
    return np.round(np.clip(stretched, 0.0, 1.0) * 255.0).astype(np.uint8)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mag-limit", type=float, default=10.0, help="Must match the downloaded catalog's cutoff (default: 10.0).")
    parser.add_argument("--bright-star-mag-limit", type=float, default=3.5, help="Must match the downloaded bright-star catalog's cutoff (default: 3.5).")
    parser.add_argument("--no-bright-stars", action="store_true", help="Skip merging the Yale BSC bright-star supplement even if downloaded.")
    parser.add_argument("--output-name", default=DEFAULT_OUTPUT_NAME, help=f"Output PNG filename stem (default: {DEFAULT_OUTPUT_NAME}).")
    parser.add_argument("--force", action="store_true", help="Re-render even if the output PNG already exists.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    output_path = OUTPUT_DIR / f"{args.output_name}.png"
    if output_path.exists() and not args.force:
        print(f"[skip] exists: {output_path}")
        return

    print(f"[load] {catalog_path_for(args.mag_limit)}")
    ra, dec, mag, rgb = load_and_merge_color_stars(args.mag_limit, None if args.no_bright_stars else args.bright_star_mag_limit)
    print(f"[load] {len(ra):,} stars (after bright-star merge)")

    start = time.monotonic()
    canvas = rasterize_color(ra, dec, mag, rgb, args.mag_limit)
    print(f"[rasterize] done in {time.monotonic() - start:.1f}s")

    small = np.stack([resize_to(canvas[:, :, c], PNG_WIDTH, PNG_HEIGHT) for c in range(3)], axis=-1)
    img = stretch_rgb(small)
    img = np.flipud(img)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.with_name(output_path.name + ".part")
    Image.fromarray(img).save(temp_path, format="PNG")
    temp_path.replace(output_path)
    print(f"[saved] {output_path}")


if __name__ == "__main__":
    main()
