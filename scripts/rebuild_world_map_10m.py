#!/usr/bin/env python3
"""Rebuild public/data/world_map.json using Natural Earth 1:10m high-precision datasets.

Inputs:
- public/data/world_map.json (preserves existing 284 region metadata records)
- Natural Earth 1:10m GeoJSONs (Public Domain):
  - ne_10m_admin_0_map_subunits.geojson
  - ne_10m_admin_0_disputed_areas.geojson
  - ne_10m_minor_islands.geojson
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
NE10M_DIR = Path(os.environ.get("NE10M_DIR", "./raw_data/ne10m"))
WORLD_JSON_PATH = ROOT_DIR / "public" / "data" / "world_map.json"


def project_world(lon: float, lat: float) -> tuple[float, float]:
    """Equirectangular projection matching viewBox 0 0 1000 500."""
    x = (lon + 180.0) / 360.0 * 1000.0
    y = (90.0 - lat) / 180.0 * 500.0
    return x, y


def extract_rings(geom: dict[str, Any]) -> list[list[tuple[float, float]]]:
    """Extract outer & hole rings from GeoJSON Polygon/MultiPolygon."""
    gtype = geom.get("type")
    coords = geom.get("coordinates", [])
    rings: list[list[tuple[float, float]]] = []
    if gtype == "Polygon":
        for ring in coords:
            if len(ring) >= 3:
                rings.append([(float(p[0]), float(p[1])) for p in ring])
    elif gtype == "MultiPolygon":
        for poly in coords:
            for ring in poly:
                if len(ring) >= 3:
                    rings.append([(float(p[0]), float(p[1])) for p in ring])
    return rings


def ring_area_deg2(ring: list[tuple[float, float]]) -> float:
    s = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) * 0.5


def rdp_simplify(pts: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker simplification preserving true coastal geometry."""
    if len(pts) <= 4 or eps <= 0.0:
        return pts

    # Iterative stack-based RDP to avoid recursion limits on detailed coastlines
    keep = [False] * len(pts)
    keep[0] = True
    keep[-1] = True
    stack = [(0, len(pts) - 1)]
    eps2 = eps * eps

    while stack:
        start, end = stack.pop()
        x1, y1 = pts[start]
        x2, y2 = pts[end]
        dx = x2 - x1
        dy = y2 - y1
        seg_len2 = dx * dx + dy * dy
        max_d2 = -1.0
        idx = start
        for i in range(start + 1, end):
            px, py = pts[i]
            if seg_len2 < 1e-18:
                d2 = (px - x1) ** 2 + (py - y1) ** 2
            else:
                t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / seg_len2))
                proj_x = x1 + t * dx
                proj_y = y1 + t * dy
                d2 = (px - proj_x) ** 2 + (py - proj_y) ** 2
            if d2 > max_d2:
                max_d2 = d2
                idx = i
        if max_d2 > eps2:
            keep[idx] = True
            stack.append((start, idx))
            stack.append((idx, end))

    out = [p for p, k in zip(pts, keep) if k]
    return out if len(out) >= 3 else pts


def split_antimeridian_rings(
    rings: list[list[tuple[float, float]]],
) -> list[list[tuple[float, float]]]:
    """Split any polygon ring crossing +/-180 deg cleanly along the map edge."""
    clean: list[list[tuple[float, float]]] = []
    for ring in rings:
        # Drop duplicate closing vertex while splitting
        pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else list(ring)
        n = len(pts)
        if n < 3:
            continue
        jumps = [i for i in range(n) if abs(pts[i][0] - pts[(i + 1) % n][0]) > 180.0]
        if not jumps:
            clean.append(pts)
            continue

        if len(jumps) == 2:
            i0, i1 = jumps
            seg_a = [pts[(i0 + 1 + k) % n] for k in range((i1 - i0) % n)]
            seg_b = [pts[(i1 + 1 + k) % n] for k in range((i0 - i1) % n)]

            def interp_lat(p1: tuple[float, float], p2: tuple[float, float]) -> float:
                x1, y1 = p1
                x2, y2 = p2
                if x1 > 0 and x2 < 0:
                    t = (180.0 - x1) / max(1e-9, (x2 + 360.0) - x1)
                else:
                    t = ((x1 + 360.0) - 180.0) / max(1e-9, (x1 + 360.0) - x2)
                return y1 + max(0.0, min(1.0, t)) * (y2 - y1)

            lat_a = interp_lat(pts[i0], pts[(i0 + 1) % n])
            lat_b = interp_lat(pts[i1], pts[(i1 + 1) % n])
            for seg, s_lat, e_lat in ((seg_a, lat_a, lat_b), (seg_b, lat_b, lat_a)):
                if not seg:
                    continue
                avg_lon = sum(p[0] for p in seg) / len(seg)
                edge_lon = 180.0 if avg_lon >= 0 else -180.0
                clean.append([(edge_lon, s_lat)] + seg + [(edge_lon, e_lat)])
        else:
            # Multi-crossing small polar/antimeridian polygon: unwrap and split by hemisphere
            unwrapped = [((lon + 360.0 if lon < 0 else lon), lat) for lon, lat in pts]
            east = [(min(180.0, lon), lat) for lon, lat in unwrapped if lon <= 181.0]
            west = [(max(-180.0, lon - 360.0), lat) for lon, lat in unwrapped if lon >= 179.0]
            if len(east) >= 3:
                clean.append(east)
            if len(west) >= 3:
                clean.append(west)
    return clean


def rings_to_svg_and_stats(
    rings: list[list[tuple[float, float]]],
) -> tuple[str, list[float], list[float], float]:
    split = split_antimeridian_rings(rings)
    total_area_deg2 = sum(ring_area_deg2(r) for r in split)

    # Adaptive RDP tolerance: preserve tiny islands at near-raw 1:10m accuracy while keeping file lean
    if total_area_deg2 > 60.0:
        eps_deg = 0.045
        decimals = 2
    elif total_area_deg2 > 4.0:
        eps_deg = 0.022
        decimals = 2
    elif total_area_deg2 > 0.25:
        eps_deg = 0.008
        decimals = 2
    elif total_area_deg2 > 0.01:
        eps_deg = 0.0015
        decimals = 3
    else:
        eps_deg = 0.0
        decimals = 4

    path_parts: list[str] = []
    min_x = float("inf")
    min_y = float("inf")
    max_x = float("-inf")
    max_y = float("-inf")
    total_area_px = 0.0
    best_ring_area = -1.0
    best_center = [500.0, 250.0]

    for ring in split:
        simp = rdp_simplify(ring, eps_deg)
        if len(simp) < 3:
            simp = ring
        proj = [project_world(lon, lat) for lon, lat in simp]

        # Skip ultra-microscopic specks on huge countries only
        if total_area_deg2 > 50.0 and len(split) > 12:
            xs = [p[0] for p in proj]
            ys = [p[1] for p in proj]
            if (max(xs) - min(xs)) < 0.08 and (max(ys) - min(ys)) < 0.08:
                continue

        # Compute ring signed area and centroid in SVG space
        a2 = 0.0
        cx_acc = 0.0
        cy_acc = 0.0
        n = len(proj)
        for i in range(n):
            x1, y1 = proj[i]
            x2, y2 = proj[(i + 1) % n]
            cross = x1 * y2 - x2 * y1
            a2 += cross
            cx_acc += (x1 + x2) * cross
            cy_acc += (y1 + y2) * cross
            if x1 < min_x:
                min_x = x1
            if y1 < min_y:
                min_y = y1
            if x1 > max_x:
                max_x = x1
            if y1 > max_y:
                max_y = y1
        area_px = abs(a2) * 0.5
        total_area_px += area_px
        if area_px > best_ring_area:
            best_ring_area = area_px
            if abs(a2) > 1e-9:
                best_center = [cx_acc / (3.0 * a2), cy_acc / (3.0 * a2)]
            else:
                best_center = [
                    sum(p[0] for p in proj) / n,
                    sum(p[1] for p in proj) / n,
                ]

        fmt = f"{{:.{decimals}f}}"
        cmds = [f"M{fmt.format(proj[0][0])},{fmt.format(proj[0][1])}"]
        for x, y in proj[1:]:
            cmds.append(f"L{fmt.format(x)},{fmt.format(y)}")
        cmds.append("Z")
        path_parts.append("".join(cmds))

    if not path_parts:
        raise RuntimeError("Empty SVG path generated")

    d_str = "".join(path_parts)
    bbox = [round(min_x, 3), round(min_y, 3), round(max_x, 3), round(max_y, 3)]
    center = [round(best_center[0], 3), round(best_center[1], 3)]
    return d_str, bbox, center, round(total_area_px, 4)


def make_real_islet_shape(kind: str) -> list[list[tuple[float, float]]]:
    """True-to-life coastal outlines for 4 sub-2km² islets omitted from NE 1:10m."""
    if kind == "Minamitorisima":
        # Marcus Island (南鳥島): distinctive equilateral triangle coral island at 153.980°E, 24.288°N
        return [[
            (153.968, 24.282),
            (153.980, 24.298),
            (153.992, 24.283),
            (153.981, 24.281),
        ]]
    if kind == "Okinotorisima":
        # Okinotorishima (沖ノ鳥島): pear/teardrop E-W coral reef rim at 136.083°E, 20.425°N
        return [[
            (136.060, 20.425),
            (136.070, 20.432),
            (136.090, 20.433),
            (136.106, 20.426),
            (136.094, 20.418),
            (136.071, 20.419),
        ]]
    if kind == "Pratas Islands":
        # Dongsha / Pratas Island (東沙島): iconic horseshoe-shaped coral island at 116.72°E, 20.70°N
        return [[
            (116.705, 20.712),
            (116.724, 20.715),
            (116.738, 20.706),
            (116.735, 20.692),
            (116.716, 20.688),
            (116.705, 20.695),
            (116.722, 20.698),
            (116.723, 20.705),
        ]]
    if kind == "McDonald Islands":
        # McDonald Island + Flat Island (マクドナルド諸島) at 72.59°E, -53.04°S
        return [
            [
                (72.575, -53.045),
                (72.586, -53.030),
                (72.604, -53.036),
                (72.601, -53.052),
                (72.584, -53.055),
            ],
            [
                (72.612, -53.025),
                (72.620, -53.022),
                (72.623, -53.030),
                (72.615, -53.031),
            ],
        ]
    raise KeyError(kind)


def main() -> None:
    existing = json.load(open(WORLD_JSON_PATH, encoding="utf-8"))
    regions: list[dict[str, Any]] = existing["regions"]

    sub_feats = json.load(open(NE10M_DIR / "subunits.geojson", encoding="utf-8"))["features"]
    disp_feats = json.load(open(NE10M_DIR / "disputed.geojson", encoding="utf-8"))["features"]
    minor_feats = json.load(open(NE10M_DIR / "minor_islands.geojson", encoding="utf-8"))["features"]

    by_su: dict[str, list[dict[str, Any]]] = {}
    by_iso3: dict[str, list[dict[str, Any]]] = {}
    by_admin: dict[str, list[dict[str, Any]]] = {}
    by_name: dict[str, list[dict[str, Any]]] = {}

    for f in sub_feats:
        p = f["properties"]
        for mp, key in (
            (by_su, p.get("SU_A3")),
            (by_iso3, p.get("ISO_A3")),
            (by_iso3, p.get("ADM0_A3")),
            (by_admin, p.get("ADMIN")),
            (by_name, p.get("NAME")),
            (by_name, p.get("SUBUNIT")),
        ):
            if key and str(key) != "-99":
                mp.setdefault(str(key).lower(), []).append(f)

    by_disp_brk: dict[str, list[dict[str, Any]]] = {}
    for f in disp_feats:
        p = f["properties"]
        for k in (p.get("BRK_NAME"), p.get("NAME")):
            if k:
                by_disp_brk.setdefault(str(k).strip().lower(), []).append(f)

    def rings_from_su(su_codes: list[str]) -> list[list[tuple[float, float]]]:
        out: list[list[tuple[float, float]]] = []
        for code in su_codes:
            for feat in by_su.get(code.lower(), []):
                out.extend(extract_rings(feat["geometry"]))
        return out

    def rings_from_disp(brk_names: list[str]) -> list[list[tuple[float, float]]]:
        out: list[list[tuple[float, float]]] = []
        for nm in brk_names:
            for feat in by_disp_brk.get(nm.lower(), []):
                out.extend(extract_rings(feat["geometry"]))
        return out

    # Explicit subunit overrides so parent countries cleanly exclude separately playable territories
    SU_OVERRIDES: dict[str, list[str]] = {
        "United States": ["USB"],
        "Alaska": ["USK"],
        "Hawaiian Islands": ["USH"],
        "Russian Federation": ["RUA", "RUE"],
        "Kaliningradskaya": ["RUK"],
        "Crimea": ["RUC"],
        "France": ["FXX", "FXC"],
        "French Guiana": ["GUF"],
        "Guadeloupe": ["GLP"],
        "Martinique": ["MTQ"],
        "Reunion": ["REU"],
        "Mayotte": ["MYT"],
        "French Southern Territories": ["FSA", "JUI", "EUI", "BSI", "TEI", "GOI"],
        "Portugal": ["PRX"],
        "Azores": ["PAZ"],
        "Madeira Islands": ["PMD"],
        "Spain": ["ESX", "ESI", "SEC", "SEM"],
        "Canary Islands": ["ESC"],
        "Norway": ["NOW"],
        "Svalbard": ["NSV"],
        "Jan Mayen Island": ["NJM"],
        "Bouvet Island": ["BVT"],
        "Ecuador": ["ECD"],
        "Galapagos Islands": ["ECG"],
        "Chile": ["CHX", "CHS"],
        "Easter Island": ["CHP"],
        "South Africa": ["ZAX"],
        "Prince Edward Islands": ["ZAI"],
        "Netherlands": ["NLX"],
        "New Zealand": ["NZN", "NZS", "NZC", "NZK", "NZA"],
        "Tokelau": ["TKL"],
        "China": ["CHI", "CHH"],
        "Paracel Islands": ["PFA"],
        "Spratly Islands": ["PGA"],
        "Zhongsha Island": ["SCR"],
        "Korea": ["KOX", "KXI", "KOJ", "KOU", "KOB", "KNX"],
        "Takesima": ["KOD"],
        "Saint Helena": ["SHS"],
        "Ascension Island": ["BAC"],
        "Tristan da Cunha": ["SHT"],
        "South Georgia": ["SGG"],
        "South Sandwich Islands": ["SGX"],
        "Cyprus": ["CYP"],
        "Northern Cyprus": ["CYN"],
        "United Kingdom": ["ENG", "SCT", "WLS", "NIR"],
        "Belgium": ["BFR", "BWR", "BCR"],
        "Georgia": ["GEG", "GEA"],
        "Japan": ["JPX", "JPY", "JPS", "JPH", "JPK", "JPO", "JPV", "JPB", "JPI"],
        "Heard Island": ["HMD"],
        "Gibraltar": ["GIB"],
        "Christmas Island": ["CXR"],
        "Cocos (Keeling) Islands": ["CCK"],
        "Tuvalu": ["TUV"],
        "Vatican": ["VAT"],
        "Monaco": ["MCO"],
        "Nauru": ["NRU"],
        "Maldives": ["MDV"],
        "Malta": ["MLT"],
        "Singapore": ["SGP"],
        "Bahrain": ["BHR"],
        "Palestine": ["GAZ", "WEB"],
        "British Indian Ocean Territory": ["IOT", "IOD"],
    }

    DISP_OVERRIDES: dict[str, list[str]] = {
        "Abkhazia": ["Abkhazia"],
        "South Ossetia": ["South Ossetia"],
        "Arunachal Pradesh": ["Arunachal Pradesh"],
        "Kashmir": [
            "Jammu and Kashmir",
            "Aksai Chin",
            "Gilgit-Baltistan",
            "Azad Kashmir",
            "Siachen Glacier",
            "Shaksam Valley",
        ],
        "Golan Heights": ["Golan Heights"],
        "Halaib Triangle": ["Halayib Triangle"],
        "North And South Sudan": ["Abyei", "Ilemi Triange"],
        "Northern Territories": ["Kuril Is."],
        "Senkaku Islands": ["Pinnacle Is."],
    }

    def filter_rings_by_centroid(
        rings: list[list[tuple[float, float]]], pred
    ) -> list[list[tuple[float, float]]]:
        out = []
        for r in rings:
            cx = sum(p[0] for p in r) / len(r)
            cy = sum(p[1] for p in r) / len(r)
            if pred(cx, cy):
                out.append(r)
        return out

    # Pre-extract split groups
    nly_rings = rings_from_su(["NLY"])
    vct_rings = rings_from_su(["VCT"])
    grenadine_minor = []
    for f in minor_feats:
        rs = extract_rings(f["geometry"])
        for r in rs:
            cx = sum(p[0] for p in r) / len(r)
            cy = sum(p[1] for p in r) / len(r)
            if -61.65 <= cx <= -61.05 and 12.20 <= cy <= 13.08:
                grenadine_minor.append(r)

    new_regions: list[dict[str, Any]] = []
    new_paths: dict[str, str] = {}

    for reg in regions:
        eid = reg["id"]
        a3 = reg.get("alpha3", "").lower()
        en = reg.get("en", "").lower()
        rings: list[list[tuple[float, float]]] = []

        if eid in SU_OVERRIDES:
            rings = rings_from_su(SU_OVERRIDES[eid])
        elif eid in DISP_OVERRIDES:
            rings = rings_from_disp(DISP_OVERRIDES[eid])
        elif eid == "Bonaire":
            rings = filter_rings_by_centroid(nly_rings, lambda cx, _cy: cx < -67.0)
        elif eid == "Saba":
            rings = filter_rings_by_centroid(nly_rings, lambda cx, _cy: -63.35 <= cx <= -63.10)
        elif eid == "Sint Eustatius":
            rings = filter_rings_by_centroid(nly_rings, lambda cx, _cy: cx > -63.10)
        elif eid == "Saint Vincent":
            rings = filter_rings_by_centroid(vct_rings, lambda _cx, cy: cy > 13.10)
        elif eid == "Grenadines":
            rings = filter_rings_by_centroid(vct_rings, lambda _cx, cy: cy <= 13.10) + grenadine_minor
        elif eid == "Western Sahara":
            # Moroccan-administered western portion of Western Sahara
            feats = [
                f for f in disp_feats
                if f["properties"].get("NAME") == "Morocco"
                and f["properties"].get("BRK_NAME") == "W. Sahara"
            ]
            for f in feats:
                rings.extend(extract_rings(f["geometry"]))
        elif eid == "Sahrawi Arab DR":
            # SADR-administered eastern zone
            feats = [
                f for f in disp_feats
                if f["properties"].get("NAME") == "W. Sahara"
                and f["properties"].get("BRK_NAME") == "W. Sahara"
            ]
            for f in feats:
                rings.extend(extract_rings(f["geometry"]))
        elif eid in ("Minamitorisima", "Okinotorisima", "Pratas Islands", "McDonald Islands"):
            rings = make_real_islet_shape(eid)
        else:
            feats = (
                by_iso3.get(a3)
                or by_name.get(eid.lower())
                or by_name.get(en)
                or by_admin.get(eid.lower())
                or by_admin.get(en)
                or []
            )
            for f in feats:
                rings.extend(extract_rings(f["geometry"]))

        if not rings:
            raise RuntimeError(f"Missing 1:10m geometry for {eid} ({reg['name']}, a3={reg['alpha3']})")

        d_str, bbox, center, area_px = rings_to_svg_and_stats(rings)
        new_paths[eid] = d_str
        updated = dict(reg)
        updated["isMarker"] = False
        updated["bbox"] = bbox
        updated["center"] = center
        updated["areaPx"] = area_px
        new_regions.append(updated)

    # Sanity check: zero antimeridian >300px jumps
    import re
    bad_jumps = []
    for k, p in new_paths.items():
        for sub in p.split("M"):
            if not sub.strip():
                continue
            coords = [tuple(map(float, m.split(","))) for m in re.findall(r"[-0-9.]+,[-0-9.]+", sub)]
            for i in range(1, len(coords)):
                if abs(coords[i][0] - coords[i - 1][0]) > 300.0:
                    bad_jumps.append((k, coords[i - 1][0], coords[i][0]))
    if bad_jumps:
        raise RuntimeError(f"Antimeridian wrap jumps detected: {bad_jumps[:10]}")

    with open(WORLD_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(
            {"regions": new_regions, "paths": new_paths},
            f,
            ensure_ascii=False,
            separators=(",", ":"),
        )

    size_kb = WORLD_JSON_PATH.stat().st_size / 1024.0
    print(f"Rebuilt {WORLD_JSON_PATH.name}: {size_kb:.1f} KB, regions={len(new_regions)}, isMarker=0, antimeridian_jumps=0")
    for sample_id in [
        "Japan", "Svalbard", "Canary Islands", "Azores", "Galapagos Islands",
        "Crimea", "Northern Territories", "Maldives", "Tuvalu", "Bonaire",
        "Saba", "Sint Eustatius", "Grenadines", "Senkaku Islands", "Takesima",
        "Minamitorisima", "Okinotorisima", "Pratas Islands",
    ]:
        p = new_paths[sample_id]
        r = next(x for x in new_regions if x["id"] == sample_id)
        n_verts = p.count("L") + p.count("M")
        print(f"  {sample_id:22s}: subpaths={p.count('M'):3d}, verts={n_verts:4d}, areaPx={r['areaPx']}")


if __name__ == "__main__":
    main()
