#!/usr/bin/env python3
"""
Download the Yale Bright Star Catalogue (5th ed., VizieR V/50) via TAP/VizieR,
as a supplement for stars Gaia's own photometry can't be trusted for.

Background (see docs/gaia-data-fields-examples.md and the "future work"
section of docs/gaia-magnitude-pipeline-plan.md): Gaia's detectors saturate
for the very brightest naked-eye stars (G ~< 3) - e.g. Sirius is recorded at
G=8.52 instead of its real V=-1.46. Yale BSC's classic Johnson V magnitudes
are reliable for exactly this bright-star regime.

Install:
    python -m pip install astroquery

Run:
    python download_bright_star_catalog.py
    python download_bright_star_catalog.py --mag-limit 3.5
    python download_bright_star_catalog.py --force

Notes:
- Vizier.ROW_LIMIT must be set to -1 explicitly (per-instance, not just the
  class default) or results silently truncate to 50 rows in whatever the
  catalog's native order is - NOT sorted by brightness, so a truncated
  query can silently drop the brightest stars while keeping fainter ones.
  Confirmed by hand during development.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.table import Table
from astroquery.vizier import Vizier

CATALOG_DIR = Path("allsky_textures") / "gaia_catalog"
BSC_CATALOG_ID = "V/50/catalog"


def catalog_path_for(mag_limit: float) -> Path:
    return CATALOG_DIR / f"bright_stars_v{mag_limit:g}.csv"


def download_catalog(mag_limit: float, output_path: Path, force: bool) -> None:
    if output_path.exists() and not force:
        print(f"[skip] exists: {output_path}")
        return

    print(f"[download] Yale BSC, V < {mag_limit}")
    vizier = Vizier(columns=["HR", "RAJ2000", "DEJ2000", "Vmag", "B-V"])
    vizier.ROW_LIMIT = -1  # see module docstring - required, not just the class default.
    results = vizier.query_constraints(catalog=BSC_CATALOG_ID, Vmag=f"<{mag_limit}")
    table = results[0]
    print(f"[download] got {len(table)} rows")

    coords = SkyCoord(ra=table["RAJ2000"], dec=table["DEJ2000"], unit=(u.hourangle, u.deg))
    out = Table({"ra": coords.ra.deg, "dec": coords.dec.deg, "vmag": table["Vmag"], "bv": table["B-V"]})

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.with_name(output_path.name + ".part")
    out.write(temp_path, format="csv", overwrite=True)
    temp_path.replace(output_path)
    print(f"[saved] {output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mag-limit",
        type=float,
        default=3.5,
        help="Johnson V magnitude cutoff (default: 3.5, comfortably above Gaia's ~G3 saturation floor).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download even if the cached catalog already exists.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_path = catalog_path_for(args.mag_limit)
    download_catalog(args.mag_limit, output_path, args.force)

    print()
    print("Completed.")
    print(f"Catalog: {output_path.resolve()}")


if __name__ == "__main__":
    main()
