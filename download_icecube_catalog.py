#!/usr/bin/env python3
"""
Download ICECAT-1, the IceCube Neutrino Observatory's public catalog of
Gold/Bronze real-time alert tracks (see rasterize_icecube_catalog.py for
turning it into an all-sky map).

Install:
    python -m pip install requests

Run:
    python download_icecube_catalog.py

ICECAT-1 (Abbasi et al. 2023, arXiv:2304.01174) lists every muon-track event
that triggered - or would have triggered, had the real-time alert program
existed yet - IceCube's high-energy (>~100 TeV) neutrino alert since full
detector operation began in 2011: 348 events with best-fit RA/Dec, an
asymmetric 90% CL error box, most-probable neutrino energy, and SIGNAL (the
probability the event is of genuine astrophysical origin rather than an
atmospheric background track). Hosted on Harvard Dataverse
(doi:10.7910/DVN/SCRUCD) under CC0; this script only fetches the single
summary table, not the much larger (~320MB total) per-event FITS/HEALPix
likelihood maps also in that dataset - see rasterize_icecube_catalog.py's
docstring for why the summary table's RA/Dec error box is enough here.
"""

from __future__ import annotations

from pathlib import Path

import requests

CATALOG_DIR = Path("allsky_textures") / "icecube_catalog"
CATALOG_FILENAME = "IceCube_Gold_Bronze_Tracks.tab"
DATASET_PERSISTENT_ID = "doi:10.7910/DVN/SCRUCD"
DATAVERSE_API = "https://dataverse.harvard.edu/api"


def catalog_path() -> Path:
    return CATALOG_DIR / CATALOG_FILENAME


def find_file_id(session: requests.Session, filename: str) -> int:
    """Looks up filename's numeric Dataverse file id via the dataset's file
    listing API, rather than hardcoding it - the id isn't guessable from the
    DOI and could change if the dataset is ever re-versioned."""
    response = session.get(
        f"{DATAVERSE_API}/datasets/:persistentId/versions/:latest/files",
        params={"persistentId": DATASET_PERSISTENT_ID},
        timeout=30,
    )
    response.raise_for_status()
    for entry in response.json()["data"]:
        if entry["dataFile"]["filename"] == filename:
            return entry["dataFile"]["id"]
    raise RuntimeError(f"{filename!r} not found in dataset {DATASET_PERSISTENT_ID}")


def main() -> None:
    output_path = catalog_path()
    if output_path.exists():
        print(f"[skip] exists: {output_path}")
        return

    session = requests.Session()
    file_id = find_file_id(session, CATALOG_FILENAME)
    print(f"[download] {CATALOG_FILENAME} (file id {file_id})")
    response = session.get(f"{DATAVERSE_API}/access/datafile/{file_id}", timeout=60)
    response.raise_for_status()

    CATALOG_DIR.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.with_name(output_path.name + ".part")
    temp_path.write_bytes(response.content)
    temp_path.replace(output_path)
    print(f"[saved] {output_path} ({output_path.stat().st_size / 1e3:.1f} KB)")


if __name__ == "__main__":
    main()
