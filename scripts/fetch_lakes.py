#!/usr/bin/env python3
"""Fetch and build high-precision shoreline polygons for all 22 Japanese lakes.

Data source:
- OpenStreetMap (ODbL) via Nominatim /lookup GeoJSON (with OSM API v0.6 fallback)
  pinned to verified OSM multipolygon relations / closed ways for each lake.

Output:
- scripts/geo_sources/lakes.json keyed by geography_100.json feature id.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path
from typing import Any

import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
GEO_100_PATH = ROOT_DIR / "public" / "data" / "geography_100.json"
JAPAN_PREFS_PATH = ROOT_DIR / "public" / "data" / "japan_prefs.json"
MUNI_INDEX_PATH = ROOT_DIR / "public" / "data" / "muni" / "index.json"
MUNI_PATHS_PATH = ROOT_DIR / "public" / "data" / "muni" / "all_paths.json"
OUT_PATH = Path(__file__).resolve().parent / "geo_sources" / "lakes.json"

USER_AGENT = "municipality-game-geo-builder/1.0"

# Exact Japan Mercator projection (verbatim from scripts/build_map_data.py)
JP_REF_LON_MIN = 128.2
JP_REF_LON_MAX = 149.2
JP_REF_LAT_MAX = 45.75
JP_SCALE = 880.0 / (JP_REF_LON_MAX - JP_REF_LON_MIN)
JP_ORIGIN_X = 60.0
JP_ORIGIN_Y = 30.0


def merc_y(lat_deg: float) -> float:
    lat_rad = math.radians(max(-85.0, min(85.0, lat_deg)))
    return math.log(math.tan(math.pi / 4.0 + lat_rad / 2.0))


JP_MERC_Y_MAX = merc_y(JP_REF_LAT_MAX)
JP_MERC_SCALE = JP_SCALE * (180.0 / math.pi)


def project_jp(lon: float, lat: float) -> tuple[float, float]:
    x = JP_ORIGIN_X + (lon - JP_REF_LON_MIN) * JP_SCALE
    y = JP_ORIGIN_Y + (JP_MERC_Y_MAX - merc_y(lat)) * JP_MERC_SCALE
    return round(x, 2), round(y, 2)


def _project_jp_raw(lon: float, lat: float) -> tuple[float, float]:
    x = JP_ORIGIN_X + (lon - JP_REF_LON_MIN) * JP_SCALE
    y = JP_ORIGIN_Y + (JP_MERC_Y_MAX - merc_y(lat)) * JP_MERC_SCALE
    return x, y


# All 22 lakes in public/data/geography_100.json (category == "lake")
# Each entry maps geography_100 id -> exact name, pinned OSM IDs, expected pref codes,
# and Douglas-Peucker tolerance (SVG px).
LAKE_SPECS: list[dict[str, Any]] = [
    {"id": "geo_003", "name": "洞爺湖", "osm_ids": ["R7658552"], "prefs": ["01"], "eps": 0.09, "min_hole_area": 0.015},
    # 霞ヶ浦 = 西浦 (R253637) + 北浦 (R19725922) + 外浪逆浦 (R19725923)
    {"id": "geo_004", "name": "霞ヶ浦", "osm_ids": ["R253637", "R19725922", "R19725923"], "prefs": ["08", "12"], "eps": 0.13, "min_hole_area": 0.02},
    {"id": "geo_010", "name": "浜名湖", "osm_ids": ["R2344533"], "prefs": ["22"], "eps": 0.13, "min_hole_area": 0.085},
    {"id": "geo_012", "name": "小川原湖", "osm_ids": ["R253961"], "prefs": ["02"], "eps": 0.12, "min_hole_area": 0.02},
    {"id": "geo_013", "name": "風蓮湖", "osm_ids": ["R1341602"], "prefs": ["01"], "eps": 0.12, "min_hole_area": 0.02},
    {"id": "geo_016", "name": "網走湖", "osm_ids": ["R1341592"], "prefs": ["01"], "eps": 0.12, "min_hole_area": 0.02},
    {"id": "geo_017", "name": "阿寒湖", "osm_ids": ["R282182"], "prefs": ["01"], "eps": 0.10, "min_hole_area": 0.02},
    {"id": "geo_018", "name": "サロマ湖", "osm_ids": ["R1341598"], "prefs": ["01"], "eps": 0.12, "min_hole_area": 0.02},
    {"id": "geo_020", "name": "中海", "osm_ids": ["R2420244"], "prefs": ["31", "32"], "eps": 0.13, "min_hole_area": 0.03},
    {"id": "geo_021", "name": "琵琶湖", "osm_ids": ["R63499"], "prefs": ["25"], "eps": 0.13, "min_hole_area": 0.02},
    {"id": "geo_024", "name": "能取湖", "osm_ids": ["R1344683"], "prefs": ["01"], "eps": 0.08, "min_hole_area": 0.02},
    {"id": "geo_026", "name": "田沢湖", "osm_ids": ["R10387454"], "prefs": ["05"], "eps": 0.12, "min_hole_area": 0.02},
    {"id": "geo_029", "name": "朱鞠内湖", "osm_ids": ["R284851"], "prefs": ["01"], "eps": 0.15, "min_hole_area": 0.02},
    {"id": "geo_030", "name": "十和田湖", "osm_ids": ["R253938"], "prefs": ["02", "05"], "eps": 0.12, "min_hole_area": 0.02},
    {"id": "geo_031", "name": "猪苗代湖", "osm_ids": ["R253753"], "prefs": ["07"], "eps": 0.12, "min_hole_area": 0.015},
    {"id": "geo_032", "name": "宍道湖", "osm_ids": ["R2416328"], "prefs": ["32"], "eps": 0.12, "min_hole_area": 0.02},
    {"id": "geo_033", "name": "桧原湖", "osm_ids": ["R254418"], "prefs": ["07"], "eps": 0.10, "min_hole_area": 0.02},
    {"id": "geo_034", "name": "中禅寺湖", "osm_ids": ["R2314063"], "prefs": ["09"], "eps": 0.10, "min_hole_area": 0.02},
    {"id": "geo_035", "name": "屈斜路湖", "osm_ids": ["R284148"], "prefs": ["01"], "eps": 0.12, "min_hole_area": 0.02},
    {"id": "geo_037", "name": "諏訪湖", "osm_ids": ["R2314068"], "prefs": ["20"], "eps": 0.06, "min_hole_area": 0.02},
    {"id": "geo_040", "name": "支笏湖", "osm_ids": ["W41889876"], "prefs": ["01"], "eps": 0.09, "min_hole_area": 0.02},
    {"id": "geo_041", "name": "摩周湖", "osm_ids": ["R284145"], "prefs": ["01"], "eps": 0.10, "min_hole_area": 0.02},
]


def _stitch_osm_ways(way_node_lists: list[list[int]], nodes: dict[int, tuple[float, float]]) -> list[list[tuple[float, float]]]:
    """Stitch OSM way node chains into closed lon/lat rings."""
    segments = [list(w) for w in way_node_lists if len(w) >= 2]
    rings: list[list[tuple[float, float]]] = []
    while segments:
        chain = segments.pop(0)
        changed = True
        while changed and chain[0] != chain[-1]:
            changed = False
            for i, seg in enumerate(segments):
                if seg[0] == chain[-1]:
                    chain.extend(seg[1:])
                    segments.pop(i)
                    changed = True
                    break
                if seg[-1] == chain[-1]:
                    chain.extend(reversed(seg[:-1]))
                    segments.pop(i)
                    changed = True
                    break
                if seg[-1] == chain[0]:
                    chain = seg[:-1] + chain
                    segments.pop(i)
                    changed = True
                    break
                if seg[0] == chain[0]:
                    chain = list(reversed(seg[1:])) + chain
                    segments.pop(i)
                    changed = True
                    break
        coords = [nodes[nid] for nid in chain if nid in nodes]
        if len(coords) >= 3:
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            rings.append(coords)
    return rings


def fetch_osm_api_fallback(osm_code: str) -> dict[str, Any]:
    """Fallback fetcher using OpenStreetMap API v0.6 full JSON."""
    kind = "relation" if osm_code[0] == "R" else "way"
    oid = osm_code[1:]
    url = f"https://api.openstreetmap.org/api/0.6/{kind}/{oid}/full.json"
    r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    r.raise_for_status()
    payload = r.json()
    nodes: dict[int, tuple[float, float]] = {}
    ways: dict[int, list[int]] = {}
    rel_members: list[dict[str, Any]] = []
    for el in payload.get("elements", []):
        if el["type"] == "node":
            nodes[el["id"]] = (float(el["lon"]), float(el["lat"]))
        elif el["type"] == "way":
            ways[el["id"]] = el.get("nodes", [])
        elif el["type"] == "relation" and str(el["id"]) == oid:
            rel_members = el.get("members", [])

    if kind == "way":
        ring = [nodes[nid] for nid in ways.get(int(oid), []) if nid in nodes]
        if ring and ring[0] != ring[-1]:
            ring.append(ring[0])
        return {"type": "Polygon", "coordinates": [ring]}

    outer_ways = [ways[m["ref"]] for m in rel_members if m.get("type") == "way" and m.get("role") in ("outer", "") and m["ref"] in ways]
    inner_ways = [ways[m["ref"]] for m in rel_members if m.get("type") == "way" and m.get("role") == "inner" and m["ref"] in ways]
    outers = _stitch_osm_ways(outer_ways, nodes)
    inners = _stitch_osm_ways(inner_ways, nodes)
    if not outers:
        raise RuntimeError(f"No outer ring stitched for {osm_code}")
    if len(outers) == 1:
        return {"type": "Polygon", "coordinates": [outers[0]] + inners}
    # Assign holes to containing outer ring
    polys = [[o] for o in outers]
    for hole in inners:
        hx, hy = hole[0]
        for poly in polys:
            if point_in_ring(hx, hy, poly[0]):
                poly.append(hole)
                break
    return {"type": "MultiPolygon", "coordinates": polys}


def fetch_osm_geometries(osm_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Fetch GeoJSON Polygon/MultiPolygon geometries from Nominatim /lookup (with OSM API fallback)."""
    result: dict[str, dict[str, Any]] = {}
    headers = {"User-Agent": USER_AGENT}
    batch_size = 6
    for i in range(0, len(osm_ids), batch_size):
        batch = osm_ids[i : i + batch_size]
        r = requests.get(
            "https://nominatim.openstreetmap.org/lookup",
            params={
                "osm_ids": ",".join(batch),
                "format": "jsonv2",
                "polygon_geojson": 1,
            },
            headers=headers,
            timeout=30,
        )
        if r.status_code == 200:
            for item in r.json():
                prefix = "R" if item.get("osm_type") == "relation" else "W" if item.get("osm_type") == "way" else "N"
                code = f"{prefix}{item.get('osm_id')}"
                geom = item.get("geojson", {})
                if geom.get("type") in ("Polygon", "MultiPolygon"):
                    result[code] = geom
        if i + batch_size < len(osm_ids):
            time.sleep(1.1)

    for code in osm_ids:
        if code not in result:
            print(f"  Fallback to OSM API v0.6 for {code} ...")
            result[code] = fetch_osm_api_fallback(code)
            time.sleep(0.5)

    return result


def rdp_open(pts: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    """Iterative Ramer-Douglas-Peucker simplification for an open polyline."""
    if len(pts) <= 2 or eps <= 0.0:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = True
    keep[-1] = True
    stack = [(0, len(pts) - 1)]
    eps2 = eps * eps
    while stack:
        s, e = stack.pop()
        x1, y1 = pts[s]
        x2, y2 = pts[e]
        dx = x2 - x1
        dy = y2 - y1
        l2 = dx * dx + dy * dy
        max_d2 = -1.0
        idx = s
        for i in range(s + 1, e):
            px, py = pts[i]
            if l2 < 1e-18:
                d2 = (px - x1) ** 2 + (py - y1) ** 2
            else:
                t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / l2))
                d2 = (px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2
            if d2 > max_d2:
                max_d2 = d2
                idx = i
        if max_d2 > eps2:
            keep[idx] = True
            stack.append((s, idx))
            stack.append((idx, e))
    return [p for p, k in zip(pts, keep) if k]


def rdp_closed_ring(ring: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    """Seam-free Ramer-Douglas-Peucker simplification for a closed ring."""
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else list(ring)
    n = len(pts)
    if n <= 4:
        return pts
    # Split ring at leftmost vertex and its farthest antipodal vertex
    i0 = min(range(n), key=lambda i: (pts[i][0], pts[i][1]))
    x0, y0 = pts[i0]
    i1 = max(range(n), key=lambda i: (pts[i][0] - x0) ** 2 + (pts[i][1] - y0) ** 2)
    if i0 < i1:
        half1 = pts[i0 : i1 + 1]
        half2 = pts[i1:] + pts[: i0 + 1]
    else:
        half1 = pts[i0:] + pts[: i1 + 1]
        half2 = pts[i1 : i0 + 1]
    s1 = rdp_open(half1, eps)
    s2 = rdp_open(half2, eps)
    out = s1[:-1] + s2[:-1]
    return out if len(out) >= 3 else pts


def round_dedup_ring(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for x, y in pts:
        rx, ry = round(x, 2), round(y, 2)
        if not out or out[-1] != (rx, ry):
            out.append((rx, ry))
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def signed_ring_area(pts: list[tuple[float, float]]) -> float:
    n = len(pts)
    if n < 3:
        return 0.0
    a2 = 0.0
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        a2 += x0 * y1 - x1 * y0
    return a2 * 0.5


def ring_centroid(pts: list[tuple[float, float]]) -> tuple[float, float]:
    n = len(pts)
    if n < 3:
        return (pts[0][0], pts[0][1]) if pts else (0.0, 0.0)
    a2 = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        cross = x0 * y1 - x1 * y0
        a2 += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a2) < 1e-9:
        return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)
    return (cx / (3.0 * a2), cy / (3.0 * a2))


def point_in_ring(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / (y2 - y1) + x1):
            inside = not inside
    return inside


def point_in_rings(x: float, y: float, rings: list[list[tuple[float, float]]]) -> bool:
    inside = False
    for r in rings:
        if point_in_ring(x, y, r):
            inside = not inside
    return inside


def dist_point_to_ring_edges(px: float, py: float, ring: list[tuple[float, float]]) -> float:
    best = float("inf")
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        l2 = dx * dx + dy * dy
        if l2 < 1e-12:
            d = math.hypot(px - x1, py - y1)
        else:
            t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / l2))
            d = math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
        if d < best:
            best = d
    return best


def guaranteed_interior_center(outer: list[tuple[float, float]]) -> tuple[float, float]:
    """Return shoelace centroid if strictly interior to outer ring, else pole of inaccessibility."""
    cx, cy = ring_centroid(outer)
    xs = [p[0] for p in outer]
    ys = [p[1] for p in outer]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span = max(max_x - min_x, max_y - min_y)

    if point_in_ring(cx, cy, outer) and dist_point_to_ring_edges(cx, cy, outer) >= span * 0.04:
        return (round(cx, 2), round(cy, 2))

    # Grid search + local refinement for deepest interior point (pole of inaccessibility)
    best_pt = (cx, cy)
    best_d = -1.0
    steps = 24
    for ix in range(steps + 1):
        gx = min_x + (max_x - min_x) * (ix + 0.5) / (steps + 1)
        for iy in range(steps + 1):
            gy = min_y + (max_y - min_y) * (iy + 0.5) / (steps + 1)
            if point_in_ring(gx, gy, outer):
                d = dist_point_to_ring_edges(gx, gy, outer)
                if d > best_d:
                    best_d = d
                    best_pt = (gx, gy)

    # Local fine refinement around best grid candidate
    step_x = (max_x - min_x) / (steps + 1)
    step_y = (max_y - min_y) / (steps + 1)
    for _ in range(3):
        bx, by = best_pt
        for dx_i in (-1, 0, 1):
            for dy_i in (-1, 0, 1):
                gx = bx + dx_i * step_x * 0.5
                gy = by + dy_i * step_y * 0.5
                if point_in_ring(gx, gy, outer):
                    d = dist_point_to_ring_edges(gx, gy, outer)
                    if d > best_d:
                        best_d = d
                        best_pt = (gx, gy)
        step_x *= 0.5
        step_y *= 0.5

    return (round(best_pt[0], 2), round(best_pt[1], 2))


def orient_ring(pts: list[tuple[float, float]], want_positive: bool) -> list[tuple[float, float]]:
    area = signed_ring_area(pts)
    if want_positive and area < 0:
        return list(reversed(pts))
    if not want_positive and area > 0:
        return list(reversed(pts))
    return pts


def simplify_adaptive(
    raw_pts: list[tuple[float, float]],
    base_eps: float,
    min_verts: int,
    max_verts: int | None = None,
) -> list[tuple[float, float]]:
    eps = base_eps
    pts = round_dedup_ring(rdp_closed_ring(raw_pts, eps))
    # Ensure compact round/caldera lakes stay smooth rather than collapsing to coarse polygons
    while len(pts) < min_verts and eps > 0.025 and len(raw_pts) > min_verts:
        eps *= 0.72
        pts = round_dedup_ring(rdp_closed_ring(raw_pts, eps))
    if max_verts is not None:
        while len(pts) > max_verts and eps < 0.30:
            eps *= 1.15
            pts = round_dedup_ring(rdp_closed_ring(raw_pts, eps))
    return pts


def extract_polygons(geom: dict[str, Any]) -> list[list[list[tuple[float, float]]]]:
    gtype = geom.get("type")
    coords = geom.get("coordinates", [])
    if gtype == "Polygon":
        return [[[(float(p[0]), float(p[1])) for p in ring] for ring in coords if len(ring) >= 3]]
    if gtype == "MultiPolygon":
        out = []
        for poly in coords:
            rings = [[(float(p[0]), float(p[1])) for p in ring] for ring in poly if len(ring) >= 3]
            if rings:
                out.append(rings)
        return out
    return []


def ring_to_svg_subpath(pts: list[tuple[float, float]]) -> str:
    return f"M{pts[0][0]},{pts[0][1]}" + "".join(f"L{x},{y}" for x, y in pts[1:]) + "Z"


def parse_svg_path_rings(d: str) -> list[list[tuple[float, float]]]:
    rings: list[list[tuple[float, float]]] = []
    for part in d.split("M")[1:]:
        part = part.strip().rstrip("Z")
        pts = []
        for tok in part.split("L"):
            x_s, y_s = tok.split(",")
            pts.append((float(x_s), float(y_s)))
        if len(pts) >= 3:
            rings.append(pts)
    return rings


def build_lakes(raw_geoms: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    lakes_out: dict[str, dict[str, Any]] = {}

    for spec in LAKE_SPECS:
        gid = spec["id"]
        name = spec["name"]
        base_eps = spec["eps"]
        min_hole_area = spec["min_hole_area"]

        all_polys: list[tuple[float, list[tuple[float, float]], list[list[tuple[float, float]]]]] = []
        for oid in spec["osm_ids"]:
            geom = raw_geoms[oid]
            for poly_rings in extract_polygons(geom):
                outer_raw = [_project_jp_raw(lon, lat) for lon, lat in poly_rings[0]]
                outer_area = abs(signed_ring_area(outer_raw))
                if outer_area < 0.05:
                    continue
                is_subpart = len(spec["osm_ids"]) > 1 and outer_area < 3.0
                min_v = 8 if is_subpart else 20
                outer_pts = simplify_adaptive(outer_raw, base_eps, min_verts=min_v)
                outer_pts = orient_ring(outer_pts, want_positive=True)
                if len(outer_pts) < 3:
                    continue

                holes_pts: list[list[tuple[float, float]]] = []
                for h_ring in poly_rings[1:]:
                    h_raw = [_project_jp_raw(lon, lat) for lon, lat in h_ring]
                    h_area = abs(signed_ring_area(h_raw))
                    if h_area < min_hole_area:
                        continue
                    h_eps = min(base_eps * 0.75, 0.08)
                    h_simp = simplify_adaptive(h_raw, h_eps, min_verts=6, max_verts=40)
                    h_simp = orient_ring(h_simp, want_positive=False)
                    if len(h_simp) >= 3 and abs(signed_ring_area(h_simp)) >= min_hole_area * 0.5:
                        holes_pts.append(h_simp)

                all_polys.append((outer_area, outer_pts, holes_pts))

        if not all_polys:
            raise RuntimeError(f"No valid polygons built for {gid} ({name})")

        # Sort polygons largest-first so primary outer ring is first
        all_polys.sort(key=lambda t: t[0], reverse=True)
        primary_outer = all_polys[0][1]

        subpaths: list[str] = []
        all_x: list[float] = []
        all_y: list[float] = []
        total_outer_pts = 0
        total_hole_rings = 0
        total_hole_pts = 0

        for _, outer_pts, holes_pts in all_polys:
            subpaths.append(ring_to_svg_subpath(outer_pts))
            total_outer_pts += len(outer_pts)
            for x, y in outer_pts:
                all_x.append(x)
                all_y.append(y)
            for h_pts in holes_pts:
                subpaths.append(ring_to_svg_subpath(h_pts))
                total_hole_rings += 1
                total_hole_pts += len(h_pts)

        cx, cy = guaranteed_interior_center(primary_outer)
        bbox = [round(min(all_x), 2), round(min(all_y), 2), round(max(all_x), 2), round(max(all_y), 2)]

        lakes_out[gid] = {
            "name": name,
            "geometryType": "polygon",
            "path": "".join(subpaths),
            "pts": [[x, y] for x, y in primary_outer],
            "center": [cx, cy],
            "bbox": bbox,
            "source": "osm",
        }
        print(
            f"Built {gid} {name:6s} | polys={len(all_polys)} holes={total_hole_rings:2d} "
            f"| outer_pts={total_outer_pts:3d} hole_pts={total_hole_pts:3d} "
            f"| center=({cx:6.2f},{cy:6.2f}) bbox={bbox}"
        )

    return lakes_out


def verify_lakes(lakes_out: dict[str, dict[str, Any]]) -> None:
    """Verify schema, completeness, interior centers, and alignment against japan_prefs.json."""
    geo100 = json.loads(GEO_100_PATH.read_text(encoding="utf-8"))
    expected_lakes = {x["id"]: x["name"] for x in geo100 if x["category"] == "lake"}
    assert set(lakes_out.keys()) == set(expected_lakes.keys()), (
        f"ID mismatch: missing={set(expected_lakes) - set(lakes_out)}, extra={set(lakes_out) - set(expected_lakes)}"
    )
    for gid, exp_name in expected_lakes.items():
        assert lakes_out[gid]["name"] == exp_name, f"Name mismatch for {gid}: {lakes_out[gid]['name']} != {exp_name}"

    jp = json.loads(JAPAN_PREFS_PATH.read_text(encoding="utf-8"))
    pref_rings = {p["code"]: parse_svg_path_rings(jp["paths"][p["code"]]) for p in jp["prefs"]}
    pref_names = {p["code"]: p["name"] for p in jp["prefs"]}

    spec_by_id = {s["id"]: s for s in LAKE_SPECS}
    print("\n=== Alignment Verification vs public/data/japan_prefs.json ===")
    for gid in sorted(lakes_out.keys()):
        rec = lakes_out[gid]
        spec = spec_by_id[gid]
        cx, cy = rec["center"]
        primary = [(p[0], p[1]) for p in rec["pts"]]
        assert len(primary) >= 15, f"{gid} {rec['name']} has too few vertices: {len(primary)}"
        assert point_in_ring(cx, cy, primary), f"{gid} {rec['name']} center {rec['center']} is NOT inside outer ring!"

        # Check bbox exactness against all vertices in path
        path_rings = parse_svg_path_rings(rec["path"])
        all_pts = [pt for r in path_rings for pt in r]
        xs = [p[0] for p in all_pts]
        ys = [p[1] for p in all_pts]
        exact_bbox = [round(min(xs), 2), round(min(ys), 2), round(max(xs), 2), round(max(ys), 2)]
        assert rec["bbox"] == exact_bbox, f"{gid} bbox mismatch: {rec['bbox']} != {exact_bbox}"

        # Verify center inside expected prefecture(s)
        codes = spec["prefs"]
        center_ok = any(point_in_rings(cx, cy, pref_rings[c]) for c in codes)
        assert center_ok, f"{gid} {rec['name']} center {rec['center']} not inside expected prefs {codes}!"

        # Verify outer vertices inside expected prefecture(s) or within 1.5px of border
        in_count = 0
        max_out = 0.0
        for x, y in primary:
            if any(point_in_rings(x, y, pref_rings[c]) for c in codes):
                in_count += 1
            else:
                md = min(dist_point_to_ring_edges(x, y, r) for c in codes for r in pref_rings[c])
                if md > max_out:
                    max_out = md
        assert max_out <= 1.5, f"{gid} {rec['name']} protrudes {max_out:.2f}px outside prefs {codes}"
        p_label = "/".join(pref_names[c] for c in codes)
        print(
            f"  PASS {gid} {rec['name']:6s} ({p_label:9s}): "
            f"center_in_pref=OK, inside_verts={in_count}/{len(primary)} ({100*in_count/len(primary):5.1f}%), "
            f"max_outside={max_out:.2f}px"
        )

    # Secondary shoreline alignment check against municipality coastlines (cutouts) for major lakes
    if MUNI_INDEX_PATH.exists() and MUNI_PATHS_PATH.exists():
        muni_idx = json.loads(MUNI_INDEX_PATH.read_text(encoding="utf-8"))
        muni_paths = json.loads(MUNI_PATHS_PATH.read_text(encoding="utf-8"))
        check_lakes = [
            ("geo_021", "琵琶湖", "25"),
            ("geo_004", "霞ヶ浦", "08"),
            ("geo_010", "浜名湖", "22"),
            ("geo_032", "宍道湖", "32"),
            ("geo_020", "中海", "32"),
            ("geo_018", "サロマ湖", "01"),
            ("geo_013", "風蓮湖", "01"),
            ("geo_024", "能取湖", "01"),
        ]
        print("\n=== Shoreline Cutout Alignment vs public/data/muni/all_paths.json ===")
        for gid, name, pref_code in check_lakes:
            rec = lakes_out[gid]
            b0, b1, b2, b3 = rec["bbox"]
            # Find neighboring municipalities whose bbox overlaps the lake bbox (padded 2px)
            nearby_rings: list[list[tuple[float, float]]] = []
            for m in muni_idx:
                if m["prefCode"] != pref_code:
                    continue
                mb = m["bbox"]
                if mb[2] >= b0 - 2 and mb[0] <= b2 + 2 and mb[3] >= b1 - 2 and mb[1] <= b3 + 2:
                    nearby_rings.extend(parse_svg_path_rings(muni_paths[m["code"]]))
            # Measure distance from lake shoreline vertices to nearest municipality boundary edge
            dists = [
                min(dist_point_to_ring_edges(x, y, r) for r in nearby_rings)
                for x, y in [(p[0], p[1]) for p in rec["pts"]]
            ]
            dists.sort()
            med = dists[len(dists) // 2]
            p90 = dists[int(len(dists) * 0.90)]
            print(f"  {gid} {name:5s}: median shoreline-to-muni-edge={med:.2f}px, p90={p90:.2f}px")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch and build high-precision Japanese lake polygons.")
    parser.add_argument(
        "--cache",
        type=Path,
        default=None,
        help="Optional JSON cache path for raw OSM GeoJSON geometries.",
    )
    args = parser.parse_args()

    all_osm_ids: list[str] = []
    for spec in LAKE_SPECS:
        for oid in spec["osm_ids"]:
            if oid not in all_osm_ids:
                all_osm_ids.append(oid)

    if args.cache and args.cache.exists():
        print(f"Loading raw OSM geometries from cache: {args.cache}")
        raw_geoms = json.loads(args.cache.read_text(encoding="utf-8"))
    else:
        print(f"Fetching {len(all_osm_ids)} OSM lake geometries from OpenStreetMap ...")
        raw_geoms = fetch_osm_geometries(all_osm_ids)
        if args.cache:
            args.cache.parent.mkdir(parents=True, exist_ok=True)
            args.cache.write_text(json.dumps(raw_geoms, ensure_ascii=False), encoding="utf-8")

    lakes_out = build_lakes(raw_geoms)
    verify_lakes(lakes_out)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(lakes_out, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    size_kb = OUT_PATH.stat().st_size / 1024.0
    print(f"\nWrote {OUT_PATH.relative_to(ROOT_DIR)} ({len(lakes_out)} lakes, {size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
