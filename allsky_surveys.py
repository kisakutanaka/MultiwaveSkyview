"""
Shared configuration for the all-sky HiPS texture pipeline.

Used by both download_allsky_fits.py and convert_allsky_png.py so the
survey list and WCS stay in sync between the download and conversion steps.
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

WIDTH: Final[int] = 8192
HEIGHT: Final[int] = 4096

# Exported PNG texture resolution - deliberately smaller than the
# downloaded raw (FITS/color) resolution above to keep what ships to the
# browser light. convert_allsky_png.py area-downsamples the raw data to
# this size during conversion; it is never re-fetched at this resolution,
# so retuning stretch parameters per survey never needs network access.
# Must evenly divide WIDTH/HEIGHT (downsample_mean() requires an exact
# integer factor).
PNG_WIDTH: Final[int] = 2048
PNG_HEIGHT: Final[int] = 1024

OUTPUT_DIR = Path("allsky_textures")
FITS_DIR = OUTPUT_DIR / "fits"
PNG_DIR = OUTPUT_DIR / "png"

# "kind" is "scalar" (default) or "color".
# - scalar: a single-band float32 FITS HiPS. min_percentile/max_percentile/
#   stretch/strength control the PNG conversion step and can be overridden
#   per-run via convert_allsky_png.py's CLI flags.
# - color: a pre-rendered RGB (jpeg-tiled) HiPS. Fetched directly as PNG;
#   no stretch is applied since the source is already tone-mapped.
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
    # "02b_visible_gaia_dr3_color": {
    #     "kind": "color",
    #     "hips": "CDS/P/DM/flux-color-Rp-G-Bp/I/355/gaiadr3",
    # },
    "02c_visible_dss2_red": {
        "hips": "CDS/P/DSS2/red",
        "min_percentile": 5.0,
        "max_percentile": 99.8,
        "stretch": "asinh",
    },
    "02d_visible_dss2_blue": {
        "hips": "CDS/P/DSS2/blue",
        "min_percentile": 5.0,
        "max_percentile": 99.8,
        "stretch": "asinh",
    },
    # No "hips" key: not fetched via hips2fits. Built from a direct Gaia TAP
    # catalog query (download_gaia_catalog.py) rasterized with a
    # magnitude-weighted PSF (rasterize_gaia_catalog.py), see
    # docs/gaia-magnitude-pipeline-plan.md. download_allsky_fits.py skips
    # entries without "hips".
    "02e_visible_gaia_dr3_mag": {
        "min_percentile": 1.0,
        "max_percentile": 99.9,
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
    # No "hips" key: not fetched via hips2fits. Built from GWOSC/GWTC
    # confirmed-event skymaps (download_gw_skymaps.py) reprojected and
    # summed onto the sky (rasterize_gw_skymaps.py). download_allsky_fits.py
    # skips entries without "hips".
    "06_gravitational_gwtc_skymap": {
        "min_percentile": 1.0,
        "max_percentile": 99.9,
        "stretch": "asinh",
    },
    # No "hips" key: not fetched via hips2fits. Built from the IceCube
    # ICECAT-1 Gold/Bronze alert-track catalog (download_icecube_catalog.py)
    # splatted as SIGNAL-weighted Gaussian PSFs (rasterize_icecube_catalog.py).
    "07_neutrino_icecat1_gold_bronze": {
        "min_percentile": 1.0,
        "max_percentile": 99.9,
        "stretch": "asinh",
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
