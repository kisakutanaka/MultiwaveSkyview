#!/usr/bin/env python3
"""
Download a Gaia DR3 star catalog (RA/Dec/G magnitude/BP-RP color) via TAP,
cached as CSV for later rasterization (see
docs/gaia-magnitude-pipeline-plan.md step 7; bp_rp is used for star color,
see rasterize_gaia_catalog_color.py).

Install:
    python -m pip install astroquery

Run:
    python download_gaia_catalog.py
    python download_gaia_catalog.py --mag-limit 10
    python download_gaia_catalog.py --force

Notes:
- Sync TAP queries are capped at MAXREC=2000 rows server-side (confirmed in
  step 1 of the plan doc); this always uses launch_job_async() so the
  catalog isn't silently truncated.
- G<10 (the default) is ~480k rows / ~10MB, taking under a minute - see the
  plan doc's step 5 for sizing of other magnitude cuts (G<12 is ~3.1M rows,
  G<14 is ~16.8M).
"""

from __future__ import annotations

import argparse
from pathlib import Path

from astroquery.gaia import Gaia

CATALOG_DIR = Path("allsky_textures") / "gaia_catalog"


def catalog_path_for(mag_limit: float) -> Path:
    return CATALOG_DIR / f"gaia_dr3_g{mag_limit:g}.csv"


def download_catalog(mag_limit: float, output_path: Path, force: bool) -> None:
    if output_path.exists() and not force:
        print(f"[skip] exists: {output_path}")
        return

    query = f"SELECT ra, dec, phot_g_mean_mag, bp_rp FROM gaiadr3.gaia_source WHERE phot_g_mean_mag < {mag_limit}"
    print(f"[download] Gaia DR3, G < {mag_limit}")
    job = Gaia.launch_job_async(query)
    rows = job.get_results()
    print(f"[download] got {len(rows):,} rows")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.with_name(output_path.name + ".part")
    rows.write(temp_path, format="csv", overwrite=True)
    temp_path.replace(output_path)
    print(f"[saved] {output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mag-limit",
        type=float,
        default=10.0,
        help="Gaia G magnitude cutoff (default: 10.0, see plan doc step 5).",
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
