#!/usr/bin/env python3
"""Fetch and build geographically accurate SVG river courses for the 16 Japanese rivers
in public/data/geography_100.json (category == "river").

Data source:
- OpenStreetMap waterway=river relations (which incorporate MLIT National-Land
  Numerical Information W05 river centerlines + community refinements), fetched via
  the official OSM API v0.6 (/api/0.6/relation/{id}/full.json) with Overpass fallback.

Output:
- scripts/geo_sources/rivers.json keyed by geography_100.json feature id.
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
GEO_100_PATH = ROOT_DIR / "public" / "data" / "geography_100.json"
PREFS_PATH = ROOT_DIR / "public" / "data" / "japan_prefs.json"
OUT_PATH = Path(__file__).resolve().parent / "geo_sources" / "rivers.json"

USER_AGENT = "municipality-game-rivers-builder/1.0 (+https://www.openstreetmap.org)"

# Exact Japan Mercator projection (verbatim match to public/data/japan_prefs.json & scripts/build_map_data.py)
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


# Verified OSM type=waterway (waterway=river) relations (from Wikidata P402) for all 16 rivers.
# Each relation includes official upper stems where names change:
# - 信濃川 (rel/2354599): 千曲川 (甲武信ヶ岳) -> 信濃川 (新潟港)
# - 淀川   (rel/6071059): 瀬田川 (琵琶湖) -> 宇治川 -> 淀川 (大阪湾)
# - 富士川 (rel/8548849): 釜無川 (鋸岳) -> 富士川 (駿河湾)
# - 神通川 (rel/18514541): 宮川 (川上岳) -> 神通川 (富山湾)
# - 木曽川 (rel/13307146): 味噌川 (鉢盛山) -> 木曽川 (伊勢湾)
# - 斐伊川 (rel/16805575): 斐伊川 (船通山) -> 出雲 -> 宍道湖 (west shore delta mouth)
RIVER_SPECS: list[dict[str, Any]] = [
    {
        "id": "geo_049",
        "name": "吉野川",
        "osm_rel": 7030674,
        "wikidata": "Q979774",
        "expected_src_pref": "高知県",
        "expected_mouth_pref": "徳島県",
        "official_km": 194.0,
    },
    {
        "id": "geo_050",
        "name": "木曽川",
        "osm_rel": 13307146,
        "wikidata": "Q779607",
        "expected_src_pref": "長野県",
        "expected_mouth_pref": "三重県",
        "official_km": 229.0,
    },
    {
        "id": "geo_054",
        "name": "神通川",
        "osm_rel": 18514541,
        "wikidata": "Q1156518",
        "expected_src_pref": "岐阜県",
        "expected_mouth_pref": "富山県",
        "official_km": 120.0,
    },
    {
        "id": "geo_055",
        "name": "球磨川",
        "osm_rel": 18571340,
        "wikidata": "Q1358183",
        "expected_src_pref": "熊本県",
        "expected_mouth_pref": "熊本県",
        "official_km": 115.0,
    },
    {
        "id": "geo_058",
        "name": "石狩川",
        "osm_rel": 2352921,
        "wikidata": "Q1061515",
        "expected_src_pref": "北海道",
        "expected_mouth_pref": "北海道",
        "official_km": 268.0,
    },
    {
        "id": "geo_061",
        "name": "北上川",
        "osm_rel": 7252537,
        "wikidata": "Q1348297",
        "expected_src_pref": "岩手県",
        "expected_mouth_pref": "宮城県",
        "official_km": 249.0,
    },
    {
        "id": "geo_062",
        "name": "富士川",
        "osm_rel": 8548849,
        "wikidata": "Q596110",
        "expected_src_pref": "長野県",
        "expected_mouth_pref": "静岡県",
        "official_km": 128.0,
    },
    {
        "id": "geo_067",
        "name": "利根川",
        "osm_rel": 2771133,
        "wikidata": "Q177452",
        "expected_src_pref": "群馬県",
        "expected_mouth_pref": "茨城県",
        "official_km": 322.0,
    },
    {
        "id": "geo_070",
        "name": "四万十川",
        "osm_rel": 18565654,
        "wikidata": "Q124878",
        "expected_src_pref": "高知県",
        "expected_mouth_pref": "高知県",
        "official_km": 196.0,
    },
    {
        "id": "geo_074",
        "name": "斐伊川",
        "osm_rel": 16805575,
        "wikidata": "Q11500714",
        "expected_src_pref": "島根県",
        "expected_mouth_pref": "島根県",
        "official_km": 84.0,  # Upper Hii-gawa mainstem from Sentsuzan into Lake Shinji
        "stop_at_shinji": True,
    },
    {
        "id": "geo_075",
        "name": "信濃川",
        "osm_rel": 2354599,
        "wikidata": "Q734455",
        "expected_src_pref": "長野県",
        "expected_mouth_pref": "新潟県",
        "official_km": 367.0,
    },
    {
        "id": "geo_094",
        "name": "淀川",
        "osm_rel": 6071059,
        "wikidata": "Q1140505",
        "expected_src_pref": "滋賀県",
        "expected_mouth_pref": "大阪府",
        "official_km": 75.1,
    },
    {
        "id": "geo_095",
        "name": "十勝川",
        "osm_rel": 8900489,
        "wikidata": "Q3491135",
        "expected_src_pref": "北海道",
        "expected_mouth_pref": "北海道",
        "official_km": 156.0,
    },
    {
        "id": "geo_097",
        "name": "最上川",
        "osm_rel": 9048439,
        "wikidata": "Q596120",
        "expected_src_pref": "山形県",
        "expected_mouth_pref": "山形県",
        "official_km": 229.0,
    },
    {
        "id": "geo_098",
        "name": "江の川",
        "osm_rel": 9204769,
        "wikidata": "Q2090210",
        "expected_src_pref": "広島県",
        "expected_mouth_pref": "島根県",
        "official_km": 194.0,
    },
    {
        "id": "geo_099",
        "name": "筑後川",
        "osm_rel": 2431268,
        "wikidata": "Q954320",
        "expected_src_pref": "熊本県",
        "expected_mouth_pref": "佐賀県",
        "official_km": 143.0,
    },
]


def haversine_km(p1: tuple[float, float], p2: tuple[float, float]) -> float:
    lon1, lat1 = p1
    lon2, lat2 = p2
    r_km = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2.0) ** 2
    )
    return 2.0 * r_km * math.asin(min(1.0, math.sqrt(a)))


def fetch_osm_relation_full(rid: int, cache_dir: Path | None = None) -> dict[str, Any]:
    """Fetch complete OSM relation + member ways + nodes via OSM API v0.6 (with Overpass fallback)."""
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_file = cache_dir / f"rel_{rid}.json"
        if cache_file.exists():
            return json.loads(cache_file.read_text(encoding="utf-8"))
    else:
        cache_file = None

    osm_url = f"https://api.openstreetmap.org/api/0.6/relation/{rid}/full.json"
    last_err: Exception | None = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(osm_url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw_text = resp.read().decode("utf-8")
            data = json.loads(raw_text)
            if cache_file is not None:
                cache_file.write_text(raw_text, encoding="utf-8")
            return data
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_err = exc
            time.sleep(1.5 * (attempt + 1))

    # Fallback: Overpass API
    query = f"[out:json][timeout:60];rel({rid});(._;>;);out body;"
    for ep in (
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ):
        try:
            body = urllib.parse.urlencode({"data": query}).encode("utf-8")
            req = urllib.request.Request(ep, data=body, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=70) as resp:
                raw_text = resp.read().decode("utf-8")
            data = json.loads(raw_text)
            if cache_file is not None:
                cache_file.write_text(raw_text, encoding="utf-8")
            return data
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_err = exc
            time.sleep(2.0)

    raise RuntimeError(f"Failed to fetch OSM relation {rid}: {last_err}")


def extract_mainstem_lonlat(
    osm_data: dict[str, Any], spec: dict[str, Any]
) -> tuple[list[tuple[float, float]], float]:
    """Extract a single continuous source->mouth mainstem polyline from OSM waterway relation."""
    rid = spec["osm_rel"]
    stop_at_shinji = bool(spec.get("stop_at_shinji", False))

    nodes: dict[int, tuple[float, float]] = {}
    ways: dict[int, dict[str, Any]] = {}
    rel: dict[str, Any] | None = None
    for el in osm_data.get("elements", []):
        et = el.get("type")
        if et == "node":
            nodes[el["id"]] = (float(el["lon"]), float(el["lat"]))
        elif et == "way":
            ways[el["id"]] = el
        elif et == "relation" and el.get("id") == rid:
            rel = el

    if rel is None:
        raise RuntimeError(f"Relation {rid} not found in OSM payload")

    adj: dict[int, dict[int, float]] = {}
    in_deg: dict[int, int] = {}
    out_deg: dict[int, int] = {}

    for m in rel.get("members", []):
        if m.get("type") != "way":
            continue
        role = m.get("role", "")
        if role in ("side_stream", "tributary", "spring"):
            continue
        w = ways.get(m["ref"])
        if not w or len(w.get("nodes", [])) < 2:
            continue

        nds = w["nodes"]
        if stop_at_shinji:
            # Keep only named 斐伊川 upper course from 船通山 through Izumo to 宍道湖 west delta mouth
            # (excluding unnamed open-lake virtual lines across 宍道湖/中海 and eastern 境水道).
            wname = w.get("tags", {}).get("name", "")
            p0 = nodes[nds[0]]
            if wname != "斐伊川" or p0[0] > 133.19:
                continue

        for i in range(len(nds) - 1):
            u, v = nds[i], nds[i + 1]
            if u not in nodes or v not in nodes or u == v:
                continue
            d_km = haversine_km(nodes[u], nodes[v])
            if v not in adj.get(u, {}) or d_km < adj[u][v]:
                adj.setdefault(u, {})[v] = d_km
                adj.setdefault(v, {})[u] = d_km
            out_deg[u] = out_deg.get(u, 0) + 1
            in_deg[v] = in_deg.get(v, 0) + 1

    # Bridge micro node-gaps (< 100 m) between degree-1 endpoints if present (e.g. 10 m OSM weir break on Hii-gawa)
    deg1_nodes = [u for u, nbrs in adj.items() if len(nbrs) == 1]
    if len(deg1_nodes) > 2:
        pairs: list[tuple[float, int, int]] = []
        for i in range(len(deg1_nodes)):
            for j in range(i + 1, len(deg1_nodes)):
                u, v = deg1_nodes[i], deg1_nodes[j]
                d_km = haversine_km(nodes[u], nodes[v])
                if d_km < 0.1:
                    pairs.append((d_km, u, v))
        pairs.sort()
        bridged: set[int] = set()
        for d_km, u, v in pairs:
            if u in bridged or v in bridged:
                continue
            adj[u][v] = d_km
            adj[v][u] = d_km
            bridged.add(u)
            bridged.add(v)
            # Preserve directed orientation across the bridged gap
            if out_deg.get(u, 0) == 0 and in_deg.get(v, 0) == 0:
                out_deg[u] = 1
                in_deg[v] = 1
            elif out_deg.get(v, 0) == 0 and in_deg.get(u, 0) == 0:
                out_deg[v] = 1
                in_deg[u] = 1

    deg1 = [u for u, nbrs in adj.items() if len(nbrs) == 1]
    if len(deg1) != 2:
        raise RuntimeError(
            f"{spec['name']} (rel/{rid}): expected 2 mainstem endpoints, got {len(deg1)}: "
            f"{[nodes[u] for u in deg1]}"
        )

    a, b = deg1
    if in_deg.get(a, 0) == 0 and out_deg.get(a, 0) > 0:
        src, dst = a, b
    elif in_deg.get(b, 0) == 0 and out_deg.get(b, 0) > 0:
        src, dst = b, a
    else:
        raise RuntimeError(f"{spec['name']}: could not determine source/mouth flow direction")

    # Dijkstra shortest path from source to mouth resolves braided river-island loops cleanly
    pq: list[tuple[float, int]] = [(0.0, src)]
    dist: dict[int, float] = {src: 0.0}
    prev: dict[int, int] = {}
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        if u == dst:
            break
        for v, wlen in adj[u].items():
            nd = d + wlen
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))

    if dst not in dist:
        raise RuntimeError(f"{spec['name']}: source and mouth are disconnected")

    path_ids: list[int] = []
    cur: int | None = dst
    while cur is not None:
        path_ids.append(cur)
        cur = prev.get(cur)
    path_ids.reverse()

    return [nodes[u] for u in path_ids], dist[dst]


def dp_simplify(pts: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    """Iterative Douglas-Peucker simplification preserving exact start and end vertices."""
    n = len(pts)
    if n <= 2:
        return list(pts)
    keep = [False] * n
    keep[0] = True
    keep[-1] = True
    stack = [(0, n - 1)]
    eps2 = eps * eps
    while stack:
        a, b = stack.pop()
        if b - a <= 1:
            continue
        x1, y1 = pts[a]
        x2, y2 = pts[b]
        dx = x2 - x1
        dy = y2 - y1
        l2 = dx * dx + dy * dy
        max_d2 = -1.0
        idx = -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if l2 < 1e-12:
                d2 = (px - x1) ** 2 + (py - y1) ** 2
            else:
                t = ((px - x1) * dx + (py - y1) * dy) / l2
                t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
                qx = x1 + t * dx
                qy = y1 + t * dy
                d2 = (px - qx) ** 2 + (py - qy) ** 2
            if d2 > max_d2:
                max_d2 = d2
                idx = i
        if max_d2 > eps2 and idx != -1:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(pts, keep) if k]


def simplify_river(
    svg_pts: list[tuple[float, float]],
    base_eps: float = 0.25,
    min_pts: int = 36,
    max_pts: int = 180,
) -> tuple[list[tuple[float, float]], float]:
    """Simplify projected river polyline with Douglas-Peucker, gently tightening for short rivers."""
    eps = base_eps
    pts = dp_simplify(svg_pts, eps)
    while len(pts) < min_pts and eps > 0.08:
        eps = round(eps - 0.02, 3)
        pts = dp_simplify(svg_pts, eps)
    while len(pts) > max_pts and eps < 0.60:
        eps = round(eps + 0.03, 3)
        pts = dp_simplify(svg_pts, eps)
    return pts, eps


def arc_length_midpoint(pts: list[tuple[float, float]]) -> tuple[float, float]:
    """Compute the exact arc-length midpoint lying ON the polyline."""
    if len(pts) == 1:
        return pts[0]
    seg_lens = [
        math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        for i in range(len(pts) - 1)
    ]
    total = sum(seg_lens)
    if total <= 1e-9:
        return pts[len(pts) // 2]
    half = total * 0.5
    acc = 0.0
    for i, sl in enumerate(seg_lens):
        if acc + sl >= half:
            t = (half - acc) / sl if sl > 1e-12 else 0.0
            cx = pts[i][0] + t * (pts[i + 1][0] - pts[i][0])
            cy = pts[i][1] + t * (pts[i + 1][1] - pts[i][1])
            return round(cx, 2), round(cy, 2)
        acc += sl
    return pts[-1]


def point_to_polyline_dist(pt: tuple[float, float], poly: list[tuple[float, float]]) -> float:
    px, py = pt
    best = float("inf")
    for i in range(len(poly) - 1):
        x1, y1 = poly[i]
        x2, y2 = poly[i + 1]
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


def verify_against_japan_prefs(
    records: dict[str, dict[str, Any]],
    endpoint_meta: dict[str, dict[str, Any]],
) -> None:
    """Verify all 16 rivers against geography_100.json schema and japan_prefs.json geometry."""
    g100 = json.loads(GEO_100_PATH.read_text(encoding="utf-8"))
    expected_rivers = {x["id"]: x["name"] for x in g100 if x["category"] == "river"}
    if set(records.keys()) != set(expected_rivers.keys()):
        raise RuntimeError(
            f"ID mismatch: got {sorted(records.keys())}, expected {sorted(expected_rivers.keys())}"
        )

    prefs_data = json.loads(PREFS_PATH.read_text(encoding="utf-8"))
    pref_names = {p["code"]: p["name"] for p in prefs_data["prefs"]}

    def parse_rings(d: str) -> list[list[tuple[float, float]]]:
        rings: list[list[tuple[float, float]]] = []
        for seg in d.split("M"):
            seg = seg.strip()
            if not seg:
                continue
            seg = seg.rstrip("Zz")
            pts = []
            for tok in seg.split("L"):
                tok = tok.strip()
                if not tok:
                    continue
                xs, ys = tok.split(",")
                pts.append((float(xs), float(ys)))
            if len(pts) >= 3:
                rings.append(pts)
        return rings

    def pip(px: float, py: float, ring: list[tuple[float, float]]) -> bool:
        inside = False
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if ((yi > py) != (yj > py)) and (
                px < (xj - xi) * (py - yi) / (yj - yi + 1e-18) + xi
            ):
                inside = not inside
            j = i
        return inside

    def pt_seg_dist(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
        dx, dy = x2 - x1, y2 - y1
        l2 = dx * dx + dy * dy
        if l2 < 1e-12:
            return math.hypot(px - x1, py - y1)
        t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / l2))
        return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))

    pref_rings: dict[str, list[list[tuple[float, float]]]] = {}
    pref_bboxes: dict[str, tuple[float, float, float, float]] = {}
    for code, d in prefs_data["paths"].items():
        rs = parse_rings(d)
        pref_rings[code] = rs
        xs = [p[0] for r in rs for p in r]
        ys = [p[1] for r in rs for p in r]
        pref_bboxes[code] = (min(xs), min(ys), max(xs), max(ys))

    def locate_pt(px: float, py: float) -> tuple[list[str], float, str]:
        hits: list[str] = []
        min_d = float("inf")
        nearest = ""
        for code, (x0, y0, x1, y1) in pref_bboxes.items():
            if px < x0 - 15 or px > x1 + 15 or py < y0 - 15 or py > y1 + 15:
                continue
            inside = False
            for r in pref_rings[code]:
                if pip(px, py, r):
                    inside = not inside
                for i in range(len(r)):
                    d = pt_seg_dist(px, py, r[i][0], r[i][1], r[(i + 1) % len(r)][0], r[(i + 1) % len(r)][1])
                    if d < min_d:
                        min_d = d
                        nearest = pref_names[code]
            if inside:
                hits.append(pref_names[code])
        return hits, round(min_d, 2), nearest

    print(
        f"{'ID':7s} {'Name':5s} {'Pts':>4s} {'Eps':>5s} {'Km':>6s} "
        f"{'MaxRaw':>6s} {'MaxSim':>6s} {'CtrD':>5s} | Source -> Mouth (pref check)"
    )
    print("-" * 112)
    for spec in RIVER_SPECS:
        gid = spec["id"]
        rec = records[gid]
        meta = endpoint_meta[gid]
        pts = [(p[0], p[1]) for p in rec["pts"]]
        assert rec["name"] == expected_rivers[gid]
        assert rec["geometryType"] == "line"
        assert rec["source"] == "osm"
        assert 35 <= len(pts) <= 200, f"{gid} {rec['name']}: pts={len(pts)}"
        assert rec["path"].startswith("M") and "L" in rec["path"]

        for x, y in pts:
            assert math.isfinite(x) and math.isfinite(y)
            assert 40.0 <= x <= 950.0 and 30.0 <= y <= 920.0, f"{gid} out of bounds: {(x, y)}"

        ctr = (rec["center"][0], rec["center"][1])
        ctr_d = point_to_polyline_dist(ctr, pts)
        assert ctr_d <= 0.02, f"{gid} center {ctr} not on polyline (dist={ctr_d:.4f})"

        bx0, by0, bx1, by1 = rec["bbox"]
        assert bx0 == min(p[0] for p in pts) and bx1 == max(p[0] for p in pts)
        assert by0 == min(p[1] for p in pts) and by1 == max(p[1] for p in pts)

        max_sim = max(
            math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
            for i in range(len(pts) - 1)
        )
        assert meta["max_raw_px"] < 2.0, f"{gid} raw jump {meta['max_raw_px']}"
        assert max_sim < 15.0, f"{gid} simplified step too large: {max_sim}"

        src_hits, src_db, src_near = locate_pt(*pts[0])
        mth_hits, mth_db, mth_near = locate_pt(*pts[-1])
        exp_src = spec["expected_src_pref"]
        exp_mth = spec["expected_mouth_pref"]
        assert (exp_src in src_hits) or (src_near == exp_src and src_db < 1.5), (
            f"{gid} {rec['name']} src {pts[0]} not in {exp_src}: hits={src_hits}, near={src_near}({src_db})"
        )
        assert (exp_mth in mth_hits) or (mth_near == exp_mth and mth_db < 1.0), (
            f"{gid} {rec['name']} mouth {pts[-1]} not at {exp_mth}: hits={mth_hits}, near={mth_near}({mth_db})"
        )
        # Coastal mouths (all except Hii-gawa into inland Lake Shinji) should sit right on coastline (< 0.5px)
        if not spec.get("stop_at_shinji"):
            assert mth_db < 0.5, f"{gid} {rec['name']} mouth too far from coastline: {mth_db}px"

        src_ll = meta["src_ll"]
        mth_ll = meta["mouth_ll"]
        print(
            f"{gid:7s} {rec['name']:5s} {len(pts):4d} {meta['eps']:5.2f} {meta['len_km']:6.1f} "
            f"{meta['max_raw_px']:6.2f} {max_sim:6.2f} {ctr_d:5.3f} | "
            f"({src_ll[0]:.3f},{src_ll[1]:.3f})[{src_hits[0] if src_hits else src_near}] -> "
            f"({mth_ll[0]:.3f},{mth_ll[1]:.3f})[{mth_near}, d={mth_db:.2f}px]"
        )


def build_rivers(cache_dir: Path | None = None) -> dict[str, dict[str, Any]]:
    def process_one(spec: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        osm_data = fetch_osm_relation_full(spec["osm_rel"], cache_dir=cache_dir)
        lonlat_pts, len_km = extract_mainstem_lonlat(osm_data, spec)

        raw_svg = [project_jp(lon, lat) for lon, lat in lonlat_pts]
        dedup: list[tuple[float, float]] = [raw_svg[0]]
        for p in raw_svg[1:]:
            if p != dedup[-1]:
                dedup.append(p)

        max_raw_px = max(
            math.hypot(dedup[i + 1][0] - dedup[i][0], dedup[i + 1][1] - dedup[i][1])
            for i in range(len(dedup) - 1)
        )
        sim_pts, eps_used = simplify_river(dedup, base_eps=0.25, min_pts=36, max_pts=180)
        cx, cy = arc_length_midpoint(sim_pts)
        xs = [p[0] for p in sim_pts]
        ys = [p[1] for p in sim_pts]
        bbox = [min(xs), min(ys), max(xs), max(ys)]
        d_path = f"M{sim_pts[0][0]},{sim_pts[0][1]}" + "".join(
            f"L{p[0]},{p[1]}" for p in sim_pts[1:]
        )

        rec = {
            "name": spec["name"],
            "geometryType": "line",
            "path": d_path,
            "pts": [[p[0], p[1]] for p in sim_pts],
            "center": [cx, cy],
            "bbox": bbox,
            "source": "osm",
        }
        meta = {
            "len_km": len_km,
            "raw_n": len(dedup),
            "eps": eps_used,
            "max_raw_px": max_raw_px,
            "src_ll": lonlat_pts[0],
            "mouth_ll": lonlat_pts[-1],
        }
        return rec, meta

    records: dict[str, dict[str, Any]] = {}
    endpoint_meta: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(process_one, RIVER_SPECS))

    for spec, (rec, meta) in zip(RIVER_SPECS, results):
        records[spec["id"]] = rec
        endpoint_meta[spec["id"]] = meta

    verify_against_japan_prefs(records, endpoint_meta)
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch and build Japan's 16 major rivers from OSM.")
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=None,
        help="Optional directory to cache raw OSM relation JSON downloads.",
    )
    args = parser.parse_args()

    records = build_rivers(cache_dir=args.cache_dir)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(records, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    size_kb = OUT_PATH.stat().st_size / 1024.0
    total_pts = sum(len(r["pts"]) for r in records.values())
    print(f"\nWrote {OUT_PATH.relative_to(ROOT_DIR)}: {len(records)} rivers, {total_pts} total vertices, {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
