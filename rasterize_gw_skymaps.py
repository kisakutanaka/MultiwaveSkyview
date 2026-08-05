#!/usr/bin/env python3
"""
Rasterizes the downloaded GW event skymaps (see download_gw_skymaps.py) into
a single all-sky "gravitational-wave source density" raster, in the same
Galactic-coordinate CAR format as the other surveys (see
allsky_surveys.build_car_wcs), so it can be tuned/exported like any other
scalar survey via fits_studio.py.

Install:
    python -m pip install ligo.skymap astropy-healpix numpy

Run:
    python rasterize_gw_skymaps.py

Each event's probability-density skymap (a full PDF over the sphere,
integrating to ~1) is reprojected onto the CAR grid and summed into the
output - so well-localized events (tight 3+ detector triangulation) show up
as brighter, more concentrated spots, while poorly-localized ones
(2-detector arcs) contribute a fainter, more diffuse band. GW170817 (no
downloadable skymap, see download_gw_skymaps.py) is added as a small
Gaussian at its known electromagnetic-counterpart position instead.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import astropy.units as u
import healpy as hp
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS
from ligo.skymap.bayestar import rasterize as ligo_rasterize
from ligo.skymap.io.fits import read_sky_map

from allsky_surveys import FITS_DIR, HEIGHT, WIDTH, build_car_wcs

CATALOG_DIR = Path("allsky_textures") / "gw_catalog"
MANIFEST_PATH = CATALOG_DIR / "manifest.json"
DEFAULT_SURVEY_NAME = "06_gravitational_gwtc_skymap"
POINT_SOURCE_SIGMA_DEG = 0.5  # arbitrary small "marker" size for GW170817, which has no downloadable skymap


def precompute_icrs_grid() -> tuple[np.ndarray, np.ndarray]:
    """Returns (theta, phi) in radians (healpy ANG convention) for every
    pixel of the WIDTH x HEIGHT Galactic CAR grid, computed once and reused
    for every event - only the target nside changes per event, not the
    underlying RA/Dec of each grid cell."""
    wcs = WCS(build_car_wcs(WIDTH, HEIGHT))
    xx, yy = np.meshgrid(np.arange(WIDTH), np.arange(HEIGHT))
    lon, lat = wcs.wcs_pix2world(xx, yy, 0)
    gal = SkyCoord(l=lon * u.deg, b=lat * u.deg, frame="galactic")
    icrs = gal.icrs
    theta = np.radians(90.0 - icrs.dec.deg)
    phi = np.radians(icrs.ra.deg)
    return theta, phi


def add_point_source(canvas: np.ndarray, ra_deg: float, dec_deg: float, sigma_deg: float) -> None:
    wcs = WCS(build_car_wcs(WIDTH, HEIGHT))
    gal = SkyCoord(ra=ra_deg * u.deg, dec=dec_deg * u.deg, frame="icrs").galactic
    cx, cy = wcs.world_to_pixel_values(gal.l.deg, gal.b.deg)
    cx, cy = float(cx), float(cy)
    sigma_px = sigma_deg * (WIDTH / 360.0)
    r = int(np.ceil(4 * sigma_px))
    x0, x1 = max(0, int(cx) - r), min(WIDTH, int(cx) + r + 1)
    y0, y1 = max(0, int(cy) - r), min(HEIGHT, int(cy) + r + 1)
    if x1 <= x0 or y1 <= y0:
        return
    yy, xx = np.mgrid[y0:y1, x0:x1]
    canvas[y0:y1, x0:x1] += np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * sigma_px**2))


def main() -> None:
    if not MANIFEST_PATH.exists():
        raise SystemExit(f"Manifest not found: {MANIFEST_PATH}\nRun download_gw_skymaps.py first.")
    manifest = json.loads(MANIFEST_PATH.read_text())
    print(f"[load] {len(manifest)} events in manifest")

    print("[grid] precomputing ICRS coordinates for the output grid...")
    theta, phi = precompute_icrs_grid()

    canvas = np.zeros((HEIGHT, WIDTH), dtype=np.float64)
    start = time.monotonic()
    n_ok, n_fail = 0, 0

    for i, (event_name, info) in enumerate(manifest.items()):
        if "point_source_deg" in info:
            ra_deg, dec_deg = info["point_source_deg"]
            add_point_source(canvas, ra_deg, dec_deg, POINT_SOURCE_SIGMA_DEG)
            n_ok += 1
            continue

        try:
            table = read_sky_map(info["skymap_fits"], moc=True)
            flat = ligo_rasterize(table)
            nside = int(round((len(flat) / 12) ** 0.5))
            ipix = hp.ang2pix(nside, theta, phi, nest=True)
            canvas += np.asarray(flat["PROB"])[ipix].reshape(HEIGHT, WIDTH)
            n_ok += 1
        except Exception as exc:
            print(f"[warn] failed to rasterize {event_name}: {exc}")
            n_fail += 1

        if (i + 1) % 50 == 0:
            print(f"[rasterize] {i + 1}/{len(manifest)} ({time.monotonic() - start:.0f}s elapsed)")

    print(f"[rasterize] done in {time.monotonic() - start:.1f}s: {n_ok} ok, {n_fail} failed, sum={canvas.sum():.1f}")

    FITS_DIR.mkdir(parents=True, exist_ok=True)
    header = WCS(build_car_wcs(WIDTH, HEIGHT)).to_header()
    hdu = fits.PrimaryHDU(canvas.astype(np.float32), header=header)
    output_path = FITS_DIR / f"{DEFAULT_SURVEY_NAME}.fits"
    temp_path = output_path.with_name(output_path.name + ".part")
    hdu.writeto(temp_path, overwrite=True)
    temp_path.replace(output_path)
    print(f"[saved] {output_path}")


if __name__ == "__main__":
    main()
