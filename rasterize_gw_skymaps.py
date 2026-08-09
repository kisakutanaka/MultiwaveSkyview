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

Units matter here: ligo_rasterize()'s PROB column is probability *mass* per
HEALPix pixel (all pixels at a map's native nside sum to 1), not a density -
and different events are published at very different native nside depending
on how finely their own localization was sampled (observed range in this
catalog: nside 64 for the most diffuse events up to 4096 for the tightest).
Accumulating PROB directly would actually get the visual story backwards:
a tightly-localized event's probability is divided across many small
high-nside pixels, so its raw per-pixel PROB is *smaller* than a diffuse
event's per-pixel PROB at coarse low-nside pixels, even though the tight
event's true probability *density* (mass per unit solid angle) is orders of
magnitude higher. Dividing by each pixel's solid angle (4*pi / (12*nside^2))
converts mass to a density that's directly comparable across events
regardless of native nside, which is what actually makes tight vs. diffuse
events visually distinguishable in the final map.
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
    """Adds a small Gaussian normalized to integrate to 1 over the sphere
    (i.e. a proper probability *density*, peak = 1/(2*pi*sigma_rad^2)) - the
    same units as the density-converted PROB values from real skymaps, so
    GW170817's precise EM-counterpart position lands in the same brightness
    scale as (and appropriately outshines) the tightest real GW-only
    localizations rather than using an arbitrary fixed amplitude."""
    wcs = WCS(build_car_wcs(WIDTH, HEIGHT))
    gal = SkyCoord(ra=ra_deg * u.deg, dec=dec_deg * u.deg, frame="icrs").galactic
    cx, cy = wcs.world_to_pixel_values(gal.l.deg, gal.b.deg)
    cx, cy = float(cx), float(cy)
    sigma_px = sigma_deg * (WIDTH / 360.0)
    sigma_rad = np.radians(sigma_deg)
    peak_density = 1.0 / (2 * np.pi * sigma_rad**2)
    r = int(np.ceil(4 * sigma_px))
    x0, x1 = max(0, int(cx) - r), min(WIDTH, int(cx) + r + 1)
    y0, y1 = max(0, int(cy) - r), min(HEIGHT, int(cy) + r + 1)
    if x1 <= x0 or y1 <= y0:
        return
    yy, xx = np.mgrid[y0:y1, x0:x1]
    canvas[y0:y1, x0:x1] += peak_density * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * sigma_px**2))


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
            pixel_solid_angle_sr = 4 * np.pi / (12 * nside**2)
            density = np.asarray(flat["PROB"]) / pixel_solid_angle_sr
            ipix = hp.ang2pix(nside, theta, phi, nest=True)
            canvas += density[ipix].reshape(HEIGHT, WIDTH)
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
