#!/usr/bin/env python3
"""
Download gravitational-wave event sky-localization maps (probability-density
skymaps) from GWOSC's confirmed-event catalogs, for later rasterization into
an all-sky "where GW events came from" map (see rasterize_gw_skymaps.py).

Install:
    python -m pip install gwosc requests

Run:
    python download_gw_skymaps.py

Notes on catalog deduplication: GWTC releases reanalyze earlier observing
runs, so the same physical event often appears in multiple catalogs (e.g.
GW150914 is in both GWTC-1-confident and GWTC-2.1-confident, which
reanalyzed all of O1/O2). This script keeps only the newest analysis per
event, via a fixed priority order (GWTC-5.0 > GWTC-4.1 > GWTC-3-confident >
GWTC-2.1-confident > GWTC-1-confident) - confirmed empirically that GWTC-4.0
is a full subset of GWTC-4.1 so it's excluded outright.

Not every confirmed event has a public skymap yet: recent GWTC-4.1/5.0
events published only a "search"-pipeline detection (FAR/SNR) without full
parameter-estimation results yet. Those are skipped (see the printed count).

GW170817 is a special case - its skymap tar isn't available the same way as
other events (it has its own legacy release format), but it has an
essentially exact position thanks to its electromagnetic counterpart
(GRB 170817A / AT2017gfo, host galaxy NGC 4993), so it's recorded with a
fixed RA/Dec instead of a downloaded skymap file.
"""

from __future__ import annotations

import gzip
import json
import re
import tarfile
import time
from pathlib import Path

import requests
from gwosc import datasets

CATALOG_DIR = Path("allsky_textures") / "gw_catalog"
RAW_TAR_DIR = CATALOG_DIR / "raw_tars"
SKYMAP_DIR = CATALOG_DIR / "skymaps"
MANIFEST_PATH = CATALOG_DIR / "manifest.json"

# Newest analysis wins when the same event appears in multiple catalogs.
CATALOG_PRIORITY = ["GWTC-5.0", "GWTC-4.1", "GWTC-3-confident", "GWTC-2.1-confident", "GWTC-1-confident"]

# GW170817's real position, from its EM counterpart (host galaxy NGC 4993).
GW170817_RA_DEG = 197.4485
GW170817_DEC_DEG = -23.3839


def resolve_deduplicated_events() -> dict[str, tuple[str, str]]:
    """Returns {event_base_name: (catalog, full_name_with_version)}, keeping
    only the highest-priority catalog's version of each event."""
    by_catalog = {}
    for catalog in CATALOG_PRIORITY:
        events = datasets.find_datasets(type="events", catalog=catalog)
        by_catalog[catalog] = {e.split("-v")[0]: e for e in events}

    resolved: dict[str, tuple[str, str]] = {}
    for catalog in reversed(CATALOG_PRIORITY):
        for base_name, full_name in by_catalog[catalog].items():
            resolved[base_name] = (catalog, full_name)
    return resolved


def zenodo_record_id_from_url(url: str) -> str | None:
    match = re.search(r"/records/(\d+)/", url)
    return match.group(1) if match else None


def find_skymap_tar_in_record(session: requests.Session, record_id: str, cache: dict[str, str | None]) -> str | None:
    if record_id in cache:
        return cache[record_id]
    response = session.get(f"https://zenodo.org/api/records/{record_id}", timeout=30)
    url = None
    if response.status_code == 200:
        files = response.json().get("files", [])
        candidates = [f for f in files if re.search(r"skymap", f.get("key", ""), re.IGNORECASE) and f["key"].endswith((".tar.gz", ".tar"))]
        if candidates:
            url = f"https://zenodo.org/api/records/{record_id}/files/{candidates[0]['key']}/content"
    cache[record_id] = url
    return url


def resolve_skymap_tar_urls(resolved_events: dict[str, tuple[str, str]]) -> dict[str, dict]:
    """For each event, finds the skymap tar URL for its preferred PE
    (parameter estimation) result. Returns {event_base_name: info_dict}.
    Events with no published PE/skymap yet are omitted."""
    session = requests.Session()
    record_cache: dict[str, str | None] = {}
    results: dict[str, dict] = {}
    skipped = []

    items = list(resolved_events.items())
    for i, (base_name, (catalog, full_name)) in enumerate(items):
        if base_name == "GW170817":
            results[base_name] = {"catalog": catalog, "skymap_tar": None, "point_source_deg": [GW170817_RA_DEG, GW170817_DEC_DEG]}
            continue

        response = session.get(f"https://gwosc.org/api/v2/event-versions/{full_name}/parameters", timeout=30)
        response.raise_for_status()
        pe_groups = [g for g in response.json()["results"] if g["pipeline_type"] == "pe"]
        if not pe_groups:
            skipped.append(base_name)
            continue

        preferred = [g for g in pe_groups if g.get("is_preferred")]
        if preferred:
            chosen = preferred[0]
        else:
            def r_number(group: dict) -> int:
                match = re.search(r"_R(\d+)_", group["name"])
                return int(match.group(1)) if match else -1

            chosen = max(pe_groups, key=r_number)

        skymap_url = next((link["url"] for link in chosen["links"] if link["label"] == "skymap"), None)
        if not skymap_url:
            record_id = zenodo_record_id_from_url(chosen["data_url"])
            if record_id:
                skymap_url = find_skymap_tar_in_record(session, record_id, record_cache)

        if not skymap_url:
            skipped.append(base_name)
            continue

        results[base_name] = {"catalog": catalog, "skymap_tar": skymap_url}

        if (i + 1) % 50 == 0:
            print(f"[resolve] ...{i + 1}/{len(items)}")

    print(f"[resolve] {len(results)} events with a skymap, {len(skipped)} skipped (no PE/skymap published yet)")
    return results


def download_tar(url: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    filename = url.split("/files/")[-1].split("/content")[0].replace("/", "_")
    dest_path = dest_dir / filename
    if dest_path.exists():
        print(f"[skip] tar exists: {dest_path}")
        return dest_path
    temp_path = dest_path.with_name(dest_path.name + ".part")

    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            print(f"[download] {url} (attempt {attempt})")
            with requests.get(url, stream=True, timeout=(30, 900)) as response:
                response.raise_for_status()
                with temp_path.open("wb") as f:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        f.write(chunk)
            temp_path.replace(dest_path)
            print(f"[saved] {dest_path} ({dest_path.stat().st_size / 1e6:.1f} MB)")
            return dest_path
        except (requests.exceptions.RequestException, OSError) as exc:
            last_error = exc
            print(f"[retry] {exc}")
            temp_path.unlink(missing_ok=True)
            time.sleep(attempt * 5)

    raise RuntimeError(f"Failed to download {url}") from last_error


def extract_matching_skymaps(tar_path: Path, wanted_event_names: set[str], out_dir: Path) -> dict[str, Path]:
    """Extracts FITS members from tar_path whose filename contains one of
    wanted_event_names, saved as out_dir/{event_name}.fits. Returns
    {event_name: extracted_path} for whichever were found. Members may be
    plain .fits or gzip-compressed .fits.gz (GWTC-4.1/5.0's archives use the
    latter) - either way the output is written decompressed as .fits."""
    out_dir.mkdir(parents=True, exist_ok=True)
    found: dict[str, Path] = {}
    with tarfile.open(tar_path, mode="r:gz") as tf:
        for member in tf:
            if not member.isfile() or not member.name.endswith((".fits", ".fits.gz")):
                continue
            for event_name in wanted_event_names:
                if event_name in member.name:
                    out_path = out_dir / f"{event_name}.fits"
                    if not out_path.exists():
                        data = tf.extractfile(member).read()
                        if data[:2] == b"\x1f\x8b":  # gzip magic; some ".fits.gz" members are actually uncompressed
                            data = gzip.decompress(data)
                        out_path.write_bytes(data)
                    found[event_name] = out_path
                    break
    return found


def main() -> None:
    print("[resolve] enumerating GWTC catalogs and deduplicating events...")
    resolved_events = resolve_deduplicated_events()
    print(f"[resolve] {len(resolved_events)} unique confirmed events across {len(CATALOG_PRIORITY)} catalogs")

    event_info = resolve_skymap_tar_urls(resolved_events)

    # Some events resolve to two different URL forms (a "files/<uuid>/..."
    # legacy form and a "records/<id>/files/.../content" form) that serve
    # the identical archive - dedupe by the actual filename so it isn't
    # downloaded twice under two names.
    tar_to_events: dict[str, set[str]] = {}
    canonical_url_for_key: dict[str, str] = {}
    for event_name, info in event_info.items():
        tar_url = info.get("skymap_tar")
        if not tar_url:
            continue
        key = tar_url.split("/files/")[-1].split("/content")[0]
        canonical_url_for_key.setdefault(key, tar_url)
        tar_to_events.setdefault(key, set()).add(event_name)

    print(f"[download] {len(tar_to_events)} distinct skymap archives to fetch")

    manifest: dict[str, dict] = {}
    for event_name, info in event_info.items():
        if info.get("point_source_deg"):
            manifest[event_name] = {"catalog": info["catalog"], "point_source_deg": info["point_source_deg"]}

    for key, event_names in tar_to_events.items():
        tar_path = download_tar(canonical_url_for_key[key], RAW_TAR_DIR)
        print(f"[extract] {tar_path.name}: looking for {len(event_names)} events...")
        found = extract_matching_skymaps(tar_path, event_names, SKYMAP_DIR)
        print(f"[extract] found {len(found)}/{len(event_names)}")
        for event_name, fits_path in found.items():
            manifest[event_name] = {"catalog": event_info[event_name]["catalog"], "skymap_fits": str(fits_path)}
        missing = event_names - set(found)
        if missing:
            print(f"[warn] not found in archive: {sorted(missing)}")

    CATALOG_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=True))
    print()
    print("Completed.")
    print(f"Manifest: {MANIFEST_PATH.resolve()} ({len(manifest)} events)")
    print(f"Skymaps: {SKYMAP_DIR.resolve()}")


if __name__ == "__main__":
    main()
