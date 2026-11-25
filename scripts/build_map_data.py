#!/usr/bin/env python3
"""Generate accurate blank-map vector datasets and metadata JSONs.

Data sources:
- Geography: smartnews-smri/japan-topography (N03-21, MIT/CC0) & world-atlas 50m (Natural Earth, ISC)
- Attributes: statistical/geographical CSV & JSON inputs in RAW_DATA_DIR
"""

from __future__ import annotations
import csv
import glob
import json
import math
import os
import re
from pathlib import Path
from typing import Any

RAW_DIR = Path(os.environ.get("RAW_DATA_DIR", "./raw_data"))
GEO_DIR = RAW_DIR / "geo"
TEXT_DIR = RAW_DIR / "out" / "text"
OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "data"

# Unified Japan Mercator projection constants (viewBox space: 0..1000 x 0..1000 for Mainland Japan)
# Spans approx lon 128.0..149.3, lat 29.8..45.7 (Mainland Hokkaido+N.Territories down to Yakushima/Tanegashima/Tokara)
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


# World Equirectangular projection (viewBox 0..1000 x 0..500, lon -180..180, lat -60..84)
def project_world(lon: float, lat: float) -> tuple[float, float]:
    x = (lon + 180.0) / 360.0 * 1000.0
    lat_c = max(-62.0, min(84.0, lat))
    y = (84.0 - lat_c) / 146.0 * 500.0
    return round(x, 2), round(y, 2)


def decode_topojson_arcs(tj: dict[str, Any]) -> list[list[tuple[float, float]]]:
    sx, sy = tj["transform"]["scale"]
    tx, ty = tj["transform"]["translate"]
    out: list[list[tuple[float, float]]] = []
    for arc in tj["arcs"]:
        pts: list[tuple[float, float]] = []
        x = 0
        y = 0
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        out.append(pts)
    return out


def arc_pts(arcs: list[list[tuple[float, float]]], idx: int) -> list[tuple[float, float]]:
    if idx >= 0:
        return arcs[idx]
    return list(reversed(arcs[~idx]))


def dissolve_rings(arcs: list[list[tuple[float, float]]], geom_list: list[dict[str, Any]]) -> list[list[tuple[float, float]]]:
    """Dissolve interior arcs shared by neighboring wards/polygons inside one piece."""
    directed_edges: dict[tuple[int, bool], int] = {}
    hole_rings: list[list[tuple[float, float]]] = []

    # Track directed arc occurrences; in valid planar TopoJSON, shared internal borders appear once as +k and once as ~k
    counts: dict[int, list[int]] = {}
    outer_arc_seqs: list[list[int]] = []

    for g in geom_list:
        poly_list = [g["arcs"]] if g["type"] == "Polygon" else g["arcs"]
        for poly in poly_list:
            outer = poly[0]
            outer_arc_seqs.append(outer)
            for a in outer:
                base = a if a >= 0 else ~a
                counts.setdefault(base, []).append(a)
            for hole in poly[1:]:
                pts: list[tuple[float, float]] = []
                for idx in hole:
                    seg = arc_pts(arcs, idx)
                    pts.extend(seg if not pts else seg[1:])
                if len(pts) >= 3:
                    hole_rings.append(pts)

    # If len(geom_list) == 1, no dissolve needed — keep exact original rings
    if len(geom_list) == 1:
        rings: list[list[tuple[float, float]]] = []
        g = geom_list[0]
        poly_list = [g["arcs"]] if g["type"] == "Polygon" else g["arcs"]
        for poly in poly_list:
            for ring in poly:
                pts = []
                for idx in ring:
                    seg = arc_pts(arcs, idx)
                    pts.extend(seg if not pts else seg[1:])
                if len(pts) >= 3:
                    rings.append(pts)
        return rings

    # Remove arcs cancelled by opposite direction inside the same group
    kept_arcs: list[int] = []
    for base, occ in counts.items():
        pos = [a for a in occ if a >= 0]
        neg = [a for a in occ if a < 0]
        diff = len(pos) - len(neg)
        if diff > 0:
            kept_arcs.extend([base] * diff)
        elif diff < 0:
            kept_arcs.extend([~base] * (-diff))

    # Stitch kept_arcs end-to-end by rounded endpoint key
    def qpt(pt: tuple[float, float]) -> tuple[int, int]:
        return (round(pt[0] * 1_000_000), round(pt[1] * 1_000_000))

    adj: dict[tuple[int, int], list[tuple[int, list[tuple[float, float]]]]] = {}
    for k_i, a in enumerate(kept_arcs):
        pts = arc_pts(arcs, a)
        adj.setdefault(qpt(pts[0]), []).append((k_i, pts))

    used = [False] * len(kept_arcs)
    stitched: list[list[tuple[float, float]]] = []
    for i, a in enumerate(kept_arcs):
        if used[i]:
            continue
        used[i] = True
        ring = list(arc_pts(arcs, a))
        start_key = qpt(ring[0])
        while qpt(ring[-1]) != start_key:
            cands = adj.get(qpt(ring[-1]), [])
            nxt = next(((idx, pts) for idx, pts in cands if not used[idx]), None)
            if nxt is None:
                break
            idx, pts = nxt
            used[idx] = True
            ring.extend(pts[1:])
        if len(ring) >= 3:
            stitched.append(ring)

    return stitched + hole_rings


def ring_area_centroid(pts: list[tuple[float, float]]) -> tuple[float, float, float]:
    n = len(pts)
    if n < 3:
        return 0.0, pts[0][0], pts[0][1]
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
    area = a2 * 0.5
    if abs(area) < 1e-9:
        avg_x = sum(p[0] for p in pts) / n
        avg_y = sum(p[1] for p in pts) / n
        return 0.0, avg_x, avg_y
    return abs(area), cx / (3.0 * a2), cy / (3.0 * a2)


def rings_to_svg_path_and_stats(
    rings_lonlat: list[list[tuple[float, float]]],
    proj_fn,
    min_step_px: float = 0.25,
) -> tuple[str, tuple[float, float, float, float], tuple[float, float], float]:
    cmds: list[str] = []
    min_x = float("inf")
    min_y = float("inf")
    max_x = float("-inf")
    max_y = float("-inf")
    best_area = -1.0
    best_center = (0.0, 0.0)
    total_area = 0.0

    for ring in rings_lonlat:
        projected: list[tuple[float, float]] = []
        last_pt: tuple[float, float] | None = None
        for lon, lat in ring:
            px, py = proj_fn(lon, lat)
            if last_pt is None or abs(px - last_pt[0]) + abs(py - last_pt[1]) >= min_step_px:
                projected.append((px, py))
                last_pt = (px, py)
        if len(projected) < 3:
            if len(ring) >= 3:
                projected = [proj_fn(lon, lat) for lon, lat in ring[:3]]
            else:
                continue
        area, cx, cy = ring_area_centroid(projected)
        total_area += area
        if area > best_area:
            best_area = area
            best_center = (round(cx, 2), round(cy, 2))
        for px, py in projected:
            if px < min_x: min_x = px
            if py < min_y: min_y = py
            if px > max_x: max_x = px
            if py > max_y: max_y = py
        seg = f"M{projected[0][0]},{projected[0][1]}" + "".join(f"L{p[0]},{p[1]}" for p in projected[1:]) + "Z"
        cmds.append(seg)

    if not cmds:
        return "", (0.0, 0.0, 0.0, 0.0), (0.0, 0.0), 0.0
    return "".join(cmds), (round(min_x, 2), round(min_y, 2), round(max_x, 2), round(max_y, 2)), best_center, round(total_area, 2)


def clean_str(s: str | None) -> str:
    return (s or "").replace("\r", "").replace("\n", "").strip()


def parse_int(s: str | None) -> int:
    c = re.sub(r"[^\d]", "", s or "")
    return int(c) if c else 0


def parse_float(s: str | None) -> float:
    c = (s or "").replace(",", "").strip()
    try:
        return float(c)
    except ValueError:
        return 0.0


def build_japan_prefs_and_munis() -> tuple[list[dict[str, Any]], dict[str, str], list[dict[str, Any]], dict[str, str]]:
    # 1. Read 00_japan.txt metadata
    pref_meta: dict[str, dict[str, Any]] = {}
    with open(TEXT_DIR / "00_japan.txt", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))[1:]
    for r in rows:
        if len(r) < 12:
            continue
        code = r[0].strip().zfill(2)
        if code == "00":
            continue
        pref_meta[code] = {
            "code": code,
            "name": clean_str(r[1]),
            "ruby": clean_str(r[2]),
            "population": parse_int(r[3]),
            "areaKm2": parse_float(r[4]),
            "capital": clean_str(r[5]),
            "capitalRuby": clean_str(r[6]),
            "electionTurnout": parse_float(r[7]),
            "regions": [clean_str(x) for x in r[8:11] if clean_str(x)],
            "wiki": clean_str(r[11]),
        }

    # 2. Read all 47 municipality CSV files
    muni_rows: list[dict[str, Any]] = []
    for path in sorted(glob.glob(str(TEXT_DIR / "[0-4][0-9]_*.txt"))):
        bn = os.path.basename(path)
        if bn == "00_japan.txt":
            continue
        pref_code = bn[:2]
        with open(path, encoding="utf-8-sig") as f:
            rows = list(csv.reader(f))[1:]
        for r in rows:
            if len(r) < 9:
                continue
            code = r[0].strip().zfill(5)
            if code.endswith("000"):
                continue
            muni_rows.append({
                "code": code,
                "prefCode": pref_code,
                "name": clean_str(r[1]),
                "ruby": clean_str(r[2]),
                "population": parse_int(r[3]),
                "areaKm2": parse_float(r[4]),
                "areaZone": clean_str(r[5]),   # e.g. 道央「どうおう」地方 / 東京都区部
                "subpref": clean_str(r[6]),    # 支庁・振興局・多摩地域等
                "county": clean_str(r[7]),     # 郡
                "wiki": clean_str(r[8]),
            })

    # 3. Decode municipalities TopoJSON and merge designated city wards + Nakagawa map
    m_tj = json.load(open(GEO_DIR / "municipalities.topojson", encoding="utf-8"))
    m_arcs = decode_topojson_arcs(m_tj)
    m_geoms_by_code: dict[str, list[dict[str, Any]]] = {}

    DESIGNATED_CITY_PREFIXES = {
        "011", "041", "111", "121", "141", "151", "221", "231",
        "261", "271", "281", "331", "341", "401", "431",
    }

    # Exact N03-21 ward -> CSV city code rules (all 20 designated cities + Nakagawa 40231->40305)
    # Note: Tokyo special wards (13101..13123) are individual municipalities and must NOT be merged.
    WARD_TO_CITY_RANGE = [
        ("01101", "01110", "01100"),  # 札幌市
        ("04101", "04105", "04100"),  # 仙台市
        ("11101", "11110", "11100"),  # さいたま市
        ("12101", "12106", "12100"),  # 千葉市
        ("14101", "14118", "14100"),  # 横浜市
        ("14131", "14137", "14130"),  # 川崎市
        ("14151", "14153", "14150"),  # 相模原市
        ("15101", "15108", "15100"),  # 新潟市
        ("22101", "22103", "22100"),  # 静岡市
        ("22131", "22137", "22130"),  # 浜松市
        ("23101", "23116", "23100"),  # 名古屋市
        ("26101", "26111", "26100"),  # 京都市
        ("27102", "27128", "27100"),  # 大阪市
        ("27141", "27147", "27140"),  # 堺市
        ("28101", "28111", "28100"),  # 神戸市
        ("33101", "33104", "33100"),  # 岡山市
        ("34101", "34108", "34100"),  # 広島市
        ("40101", "40109", "40100"),  # 北九州市
        ("40131", "40137", "40130"),  # 福岡市
        ("43101", "43105", "43100"),  # 熊本市
    ]

    for g in list(m_tj["objects"].values())[0]["geometries"]:
        c = str(g.get("properties", {}).get("N03_007") or "").strip()
        if not c:
            continue
        c = c.zfill(5)
        target = "40305" if c == "40231" else c
        for lo, hi, city in WARD_TO_CITY_RANGE:
            if lo <= c <= hi:
                target = city
                break
        m_geoms_by_code.setdefault(target, []).append(g)

    muni_paths: dict[str, str] = {}
    muni_out: list[dict[str, Any]] = []

    for row in muni_rows:
        code = row["code"]
        geoms = m_geoms_by_code.get(code, [])
        if not geoms:
            raise RuntimeError(f"Missing geometry for municipality {code} {row['name']}")
        rings = dissolve_rings(m_arcs, geoms)
        d_str, bbox, center, area_px = rings_to_svg_path_and_stats(rings, project_jp, min_step_px=0.14)
        muni_paths[code] = d_str
        row["bbox"] = bbox
        row["center"] = center
        row["areaPx"] = area_px
        muni_out.append(row)

    # 4. Decode prefectures TopoJSON for 47 prefecture blank-map paths
    p_tj = json.load(open(GEO_DIR / "prefectures.topojson", encoding="utf-8"))
    p_arcs = decode_topojson_arcs(p_tj)
    name_to_pref_code = {v["name"]: k for k, v in pref_meta.items()}
    pref_geoms: dict[str, list[dict[str, Any]]] = {}
    for g in list(p_tj["objects"].values())[0]["geometries"]:
        pname = str(g.get("properties", {}).get("N03_001") or "").strip()
        pcode = name_to_pref_code.get(pname)
        if pcode:
            pref_geoms.setdefault(pcode, []).append(g)

    # Compute capital city center + main bounding box from municipality geometries
    muni_by_name_and_pref = {(m["prefCode"], m["name"]): m for m in muni_out}
    pref_paths: dict[str, str] = {}
    pref_out: list[dict[str, Any]] = []
    for pcode in sorted(pref_meta.keys()):
        meta = pref_meta[pcode]
        geoms = pref_geoms[pcode]
        rings = dissolve_rings(p_arcs, geoms)
        d_str, bbox, center, area_px = rings_to_svg_path_and_stats(rings, project_jp, min_step_px=0.22)
        pref_paths[pcode] = d_str
        cap_muni = muni_by_name_and_pref.get((pcode, meta["capital"]))
        cap_center = cap_muni["center"] if cap_muni else center

        main_munis = [
            m for m in muni_out
            if m["prefCode"] == pcode and not (pcode == "13" and m["code"] >= "13360")
        ]
        if main_munis:
            bbox_main = (
                round(min(m["bbox"][0] for m in main_munis), 2),
                round(min(m["bbox"][1] for m in main_munis), 2),
                round(max(m["bbox"][2] for m in main_munis), 2),
                round(max(m["bbox"][3] for m in main_munis), 2),
            )
        else:
            bbox_main = bbox

        meta["bbox"] = bbox
        meta["bboxMain"] = bbox_main
        meta["center"] = center
        meta["capitalCenter"] = cap_center
        meta["areaPx"] = area_px
        meta["muniCount"] = sum(1 for m in muni_out if m["prefCode"] == pcode)
        pref_out.append(meta)

    return pref_out, pref_paths, muni_out, muni_paths


def build_geography_100(pref_out: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map 100 terrain objects onto our Japan Mercator SVG coordinates."""
    ref_centers: dict[str, list[float]] = json.load(open(RAW_DIR / "pref_centers.json", encoding="utf-8"))
    g100_raw: list[dict[str, Any]] = json.load(open(RAW_DIR / "geography_100_full.json", encoding="utf-8"))

    # Pair mainland prefectures (exclude 47_沖縄 inset and far islands)
    svg_centers = {p["code"]: p["capitalCenter"] for p in pref_out}
    # Use mainland capitals/centers 02..45 (no far Pacific/Okinawa inset skew) for linear least-squares fit
    pairs = []
    for k, (ux, uy) in ref_centers.items():
        code = k[:2]
        if code in svg_centers and "02" <= code <= "45":
            # find preference centroid (capitalCenter approximates well? Even better: weighted ring centroid of mainland rings)
            sx, sy = next(p["center"] for p in pref_out if p["code"] == code)
            pairs.append((ux, uy, sx, sy, code))

    # Solve least-squares: sx = a*ux + b*uy + c, sy = d*ux + e*uy + f
    def solve_affine(pts: list[tuple[float, float, float, float, str]]):
        # Normal equations for 3 unknowns [ux, uy, 1]
        n = len(pts)
        m = [[0.0]*3 for _ in range(3)]
        rx = [0.0]*3
        ry = [0.0]*3
        for ux, uy, sx, sy, _ in pts:
            v = [ux, uy, 1.0]
            for i in range(3):
                for j in range(3):
                    m[i][j] += v[i]*v[j]
                rx[i] += v[i]*sx
                ry[i] += v[i]*sy
        def gauss(mat, vec):
            A = [row[:] + [vec[i]] for i, row in enumerate(mat)]
            for i in range(3):
                piv = max(range(i, 3), key=lambda r: abs(A[r][i]))
                A[i], A[piv] = A[piv], A[i]
                for r in range(i+1, 3):
                    fac = A[r][i] / A[i][i]
                    for c in range(i, 4):
                        A[r][c] -= fac * A[i][c]
            x = [0.0]*3
            for i in range(2, -1, -1):
                x[i] = (A[i][3] - sum(A[i][c]*x[c] for c in range(i+1, 3))) / A[i][i]
            return x
        return gauss(m, rx), gauss(m, ry)

    ax, ay = solve_affine(pairs)
    # Check residuals; refine dropping any outlier > 25px (e.g. Tokyo island skew)
    err_list = []
    for ux, uy, sx, sy, code in pairs:
        px = ax[0]*ux + ax[1]*uy + ax[2]
        py = ay[0]*ux + ay[1]*uy + ay[2]
        err = math.hypot(px - sx, py - sy)
        err_list.append((err, code, (ux, uy, sx, sy)))
    inliers = [x[2] + (x[1],) for x in err_list if x[0] < 30.0]
    ax, ay = solve_affine(inliers)
    max_err = max(math.hypot(ax[0]*ux+ax[1]*uy+ax[2]-sx, ay[0]*ux+ay[1]*uy+ay[2]-sy) for ux,uy,sx,sy,_ in inliers)
    print(f"Geography affine fit inliers={len(inliers)}, max residual={max_err:.1f}px")

    # Compute exact affine fit directly from known Japanese landmarks whose lon/lat are known
    KNOWN_GEO = {
        "富士山": (138.7274, 35.3606),
        "桜島": (130.6572, 31.5806),
        "阿蘇山": (131.0861, 32.8842),
        "雲仙岳": (130.2994, 32.7614),
        "剣山": (134.0942, 33.8536),
        "石鎚山": (133.1147, 33.7675),
        "大山": (133.5419, 35.3711),
        "比叡山": (135.8333, 35.0631),
        "伊吹山": (136.4064, 35.4178),
        "御嶽山": (137.4803, 35.8928),
        "浅間山": (138.5231, 36.4064),
        "磐梯山": (140.0722, 37.6008),
        "鳥海山": (140.0489, 39.0989),
        "岩手山": (141.0008, 39.8528),
        "羊蹄山": (140.8114, 42.8267),
        "大雪山": (142.8542, 43.6636),
        "琵琶湖": (136.05, 35.25),
        "霞ヶ浦": (140.42, 36.04),
        "浜名湖": (137.57, 34.74),
        "諏訪湖": (138.09, 36.05),
        "猪苗代湖": (140.09, 37.47),
        "十和田湖": (140.88, 40.46),
        "洞爺湖": (140.85, 42.60),
        "サロマ湖": (143.88, 44.15),
        "風蓮湖": (145.32, 43.31),
        "宍道湖": (132.96, 35.44),
        "仙台平野": (140.95, 38.20),
        "関東平野": (139.80, 36.10),
        "石狩平野": (141.45, 43.15),
    }

    t_pairs = []
    for item in g100_raw:
        nm = item["name"]
        if nm in KNOWN_GEO and item["pts"]:
            ux = sum(p[0] for p in item["pts"]) / len(item["pts"])
            uy = sum(p[1] for p in item["pts"]) / len(item["pts"])
            sx, sy = project_jp(*KNOWN_GEO[nm])
            t_pairs.append((ux, uy, sx, sy, nm))

    tx, ty = solve_affine(t_pairs)
    t_errs = [(math.hypot(tx[0]*u+tx[1]*v+tx[2]-sx, ty[0]*u+ty[1]*v+ty[2]-sy), nm) for u,v,sx,sy,nm in t_pairs]
    print(f"Terrain affine fit on {len(t_pairs)} landmarks: avg={sum(e for e,_ in t_errs)/len(t_errs):.1f}px, max={max(t_errs)}")

    out = []
    for idx, item in enumerate(g100_raw):
        nm = item["name"]
        ctype = item["collider_type"]
        pts_svg = []
        for u, v in item["pts"]:
            sx = round(tx[0]*u + tx[1]*v + tx[2], 2)
            sy = round(ty[0]*u + ty[1]*v + ty[2], 2)
            pts_svg.append([sx, sy])

        if nm in ("中海", "霞ヶ浦") or nm.endswith("湖"):
            cat = "lake"
        elif ctype == "PolygonCollider2D":
            cat = "mountain"
        elif len(pts_svg) > 20:
            cat = "plain"
        elif nm.endswith("川"):
            cat = "river"
        else:
            cat = "mountains"

        cx = round(sum(p[0] for p in pts_svg) / len(pts_svg), 2) if pts_svg else 0.0
        cy = round(sum(p[1] for p in pts_svg) / len(pts_svg), 2) if pts_svg else 0.0
        out.append({
            "id": f"geo_{idx:03d}",
            "name": nm,
            "ruby": clean_str(item["ruby"]),
            "category": cat,
            "geometryType": "polygon" if ctype == "PolygonCollider2D" else "line",
            "pts": pts_svg,
            "center": [cx, cy],
            "wiki": clean_str(item["wiki"]),
            "desc": clean_str(re.sub(r"<[^>]+>", "", item["desc"])),
        })
    return out


def build_world_map() -> tuple[list[dict[str, Any]], dict[str, str]]:
    w_tj = json.load(open(GEO_DIR / "countries-50m.json", encoding="utf-8"))
    w_arcs = decode_topojson_arcs(w_tj)
    w_geoms = w_tj["objects"]["countries"]["geometries"]

    by_num: dict[str, dict[str, Any]] = {}
    by_name: dict[str, dict[str, Any]] = {}
    for g in w_geoms:
        gid = str(g.get("id") or "").strip()
        if gid.isdigit():
            by_num[str(int(gid))] = g
        pname = str(g.get("properties", {}).get("name") or "").strip().lower()
        if pname:
            by_name[pname] = g

    world_lists = json.load(open(RAW_DIR / "world_lists.json", encoding="utf-8"))
    mode_by_id: dict[str, list[str]] = {}
    for m_key, items in world_lists.items():
        if m_key == "world":
            continue
        for it in items:
            en_id = it.split("_", 1)[0]
            mode_by_id.setdefault(en_id, []).append(m_key)

    # Approximate lon/lat for tiny islands/micro-entities not separated as top-level geometries in 50m
    MICRO_COORDS: dict[str, tuple[float, float]] = {
        "Abkhazia": (41.0, 43.0),
        "Arunachal Pradesh": (94.7, 28.2),
        "Kashmir": (75.5, 34.1),
        "Guadeloupe": (-61.55, 16.25),
        "Christmas Island": (105.63, -10.48),
        "Crimea": (34.4, 45.3),
        "Cocos (Keeling) Islands": (96.83, -12.17),
        "Golan Heights": (35.75, 33.0),
        "Gibraltar": (-5.35, 36.14),
        "Svalbard": (19.0, 78.2),
        "Tuvalu": (179.2, -8.5),
        "Tokelau": (-171.8, -9.2),
        "Halaib Triangle": (36.0, 22.4),
        "French Guiana": (-53.1, 3.9),
        "French Southern Territories": (69.3, -49.3),
        "Bonaire": (-68.27, 12.18),
        "Mayotte": (45.16, -12.82),
        "Martinique": (-61.02, 14.64),
        "Reunion": (55.53, -21.12),
        "Paracel Islands": (112.3, 16.5),
        "Zhongsha Island": (114.5, 15.8),
        "Pratas Islands": (116.72, 20.7),
        "South Ossetia": (44.0, 42.3),
        "Spratly Islands": (114.3, 10.2),
        "North And South Sudan": (28.3, 9.6),
        "Northern Cyprus": (33.6, 35.25),
        "Northern Territories": (146.5, 44.3),
        "Hawaiian Islands": (-155.5, 19.7),
        "Alaska": (-152.0, 64.0),
        "Easter Island": (-109.35, -27.12),
        "Bouvet Island": (3.36, -54.42),
        "Ascension Island": (-14.37, -7.94),
        "Tristan da Cunha": (-12.28, -37.11),
        "Prince Edward Islands": (37.7, -46.9),
        "Galapagos Islands": (-90.35, -0.6),
        "Azores": (-27.2, 38.6),
        "Madeira Islands": (-16.95, 32.75),
        "Canary Islands": (-15.6, 28.1),
        "Jan Mayen Island": (-8.3, 71.03),
        "South Sandwich Islands": (-26.5, -57.8),
        "Grenadines": (-61.25, 12.8),
        "McDonald Islands": (73.5, -53.05),
        "Sint Eustatius": (-62.98, 17.49),
        "Saba": (-63.23, 17.63),
        "Takesima": (131.86, 37.24),
        "Senkaku Islands": (123.47, 25.74),
        "Kaliningradskaya": (21.1, 54.7),
        "Minamitorisima": (153.98, 24.29),
        "Okinotorisima": (136.08, 20.42),
        "Vatican": (12.45, 41.9),
        "Monaco": (7.42, 43.74),
        "Nauru": (166.93, -0.52),
        "Maldives": (73.51, 3.2),
        "Singapore": (103.82, 1.35),
        "Bahrain": (50.55, 26.07),
        "Malta": (14.43, 35.9),
    }

    # Helper: filter rings of US/Russia/France/etc when extracting sub-territories or excluding Alaska/Hawaii/Kaliningrad/French Guiana
    def extract_filtered_rings(base_geom: dict[str, Any], pred) -> list[list[tuple[float, float]]]:
        rings = dissolve_rings(w_arcs, [base_geom])
        out_r = []
        for r in rings:
            cx = sum(p[0] for p in r) / len(r)
            cy = sum(p[1] for p in r) / len(r)
            if pred(cx, cy, r):
                out_r.append(r)
        return out_r

    def make_marker_ring(lon: float, lat: float, radius_deg: float = 1.65) -> list[list[tuple[float, float]]]:
        pts = []
        for k in range(12):
            ang = 2 * math.pi * k / 12
            pts.append((lon + radius_deg * math.cos(ang), lat + radius_deg * 0.72 * math.sin(ang)))
        return [pts]

    world_out: list[dict[str, Any]] = []
    world_paths: dict[str, str] = {}

    with open(TEXT_DIR / "world.txt", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))[2:]

    for r in rows:
        if len(r) < 14:
            continue
        eid = clean_str(r[0])
        name = clean_str(r[1])
        ruby = clean_str(r[2])
        pop = parse_int(r[3])
        area = parse_float(r[4])
        en = clean_str(r[5])
        un = clean_str(r[6]) == "○"
        jp_rec = clean_str(r[7]) == "○"
        a3 = clean_str(r[8])
        a2 = clean_str(r[9])
        place = clean_str(r[10])
        place_en = clean_str(r[11])
        num = clean_str(r[12])
        wiki = clean_str(r[13])

        rings: list[list[tuple[float, float]]] = []
        is_marker = False
        # Special splits from parent multipolygons in Natural Earth 50m:
        if eid == "Alaska" and "840" in by_num:
            rings = extract_filtered_rings(by_num["840"], lambda cx, cy, _: cy > 51.0)
        elif eid == "Hawaiian Islands" and "840" in by_num:
            rings = extract_filtered_rings(by_num["840"], lambda cx, cy, _: cx < -150.0 and cy < 30.0)
        elif eid == "United States" and "840" in by_num:
            rings = extract_filtered_rings(by_num["840"], lambda cx, cy, _: -130.0 < cx < -65.0 and 24.0 < cy < 50.0)
        elif eid == "French Guiana" and "250" in by_num:
            rings = extract_filtered_rings(by_num["250"], lambda cx, cy, _: cx < -40.0 and -10.0 < cy < 15.0)
        elif eid == "France" and "250" in by_num:
            rings = extract_filtered_rings(by_num["250"], lambda cx, cy, _: cx > -10.0 and cy > 35.0)
        elif eid == "Kaliningradskaya" and "643" in by_num:
            rings = extract_filtered_rings(by_num["643"], lambda cx, cy, _: 18.0 < cx < 24.0 and 53.0 < cy < 56.5)
        elif eid == "Russian Federation" and "643" in by_num:
            # Handle antimeridian wrap + exclude Kaliningrad exclave
            rings = extract_filtered_rings(by_num["643"], lambda cx, cy, _: not (18.0 < cx < 24.0 and 53.0 < cy < 56.5))
        elif eid == "Kosovo" and "kosovo" in by_name:
            rings = dissolve_rings(w_arcs, [by_name["kosovo"]])
        elif eid == "Sahrawi Arab DR" and "732" in by_num:
            rings = dissolve_rings(w_arcs, [by_num["732"]])
        elif eid == "Northern Cyprus" and "northern cyprus" in by_name:
            rings = dissolve_rings(w_arcs, [by_name["northern cyprus"]])
        elif num.isdigit() and str(int(num)) in by_num:
            rings = dissolve_rings(w_arcs, [by_num[str(int(num))]])
        elif en.lower() in by_name:
            rings = dissolve_rings(w_arcs, [by_name[en.lower()]])

        # Split antimeridian-crossing rings cleanly along +/-180 deg so no horizontal wrap strokes occur
        clean_rings = []
        for ring in rings:
            n = len(ring)
            jump_indices = [i for i in range(n) if abs(ring[i][0] - ring[(i + 1) % n][0]) > 180.0]
            if not jump_indices:
                clean_rings.append(ring)
            elif len(jump_indices) == 2:
                i0, i1 = jump_indices
                seg_a = [ring[(i0 + 1 + k) % n] for k in range((i1 - i0) % n)]
                seg_b = [ring[(i1 + 1 + k) % n] for k in range((i0 - i1) % n)]
                def interp_lat(p1: tuple[float, float], p2: tuple[float, float]) -> float:
                    x1, y1 = p1
                    x2, y2 = p2
                    if x1 > 0 and x2 < 0:
                        t = (180.0 - x1) / max(1e-9, (x2 + 360.0) - x1)
                    else:
                        t = ((x1 + 360.0) - 180.0) / max(1e-9, (x1 + 360.0) - x2)
                    return y1 + max(0.0, min(1.0, t)) * (y2 - y1)
                lat_a = interp_lat(ring[i0], ring[(i0 + 1) % n])
                lat_b = interp_lat(ring[i1], ring[(i1 + 1) % n])
                for seg, s_lat, e_lat in ((seg_a, lat_a, lat_b), (seg_b, lat_b, lat_a)):
                    if not seg:
                        continue
                    edge_lon = 180.0 if (sum(p[0] for p in seg) / len(seg)) >= 0 else -180.0
                    clean_rings.append([(edge_lon, s_lat)] + seg + [(edge_lon, e_lat)])
            else:
                left = [((lon + 360.0 if lon < 0 else lon), lat) for lon, lat in ring]
                clean_rings.append([(min(179.95, p[0]), p[1]) for p in left])
        rings = clean_rings

        if not rings or (eid in MICRO_COORDS and eid not in ("Alaska", "French Guiana", "Kaliningradskaya")):
            if eid in MICRO_COORDS and not rings:
                lon, lat = MICRO_COORDS[eid]
                rings = make_marker_ring(lon, lat, 1.55)
                is_marker = True
        if not rings:
            raise RuntimeError(f"Missing world geometry for {eid} ({name})")

        d_str, bbox, center, area_px = rings_to_svg_path_and_stats(rings, project_world, min_step_px=0.35)
        world_paths[eid] = d_str
        world_out.append({
            "id": eid,
            "name": name,
            "ruby": ruby,
            "en": en,
            "population": pop,
            "areaKm2": area,
            "unMember": un,
            "jpRecognized": jp_rec,
            "alpha3": a3,
            "alpha2": a2,
            "place": place,
            "placeEn": place_en,
            "wiki": wiki,
            "modes": mode_by_id.get(eid, []),
            "isMarker": is_marker,
            "bbox": bbox,
            "center": center,
            "areaPx": area_px,
        })

    return world_out, world_paths


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "muni").mkdir(parents=True, exist_ok=True)

    pref_out, pref_paths, muni_out, muni_paths = build_japan_prefs_and_munis()
    geo_100 = build_geography_100(pref_out)
    world_out, world_paths = build_world_map()

    json.dump({"prefs": pref_out, "paths": pref_paths}, open(OUT_DIR / "japan_prefs.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(muni_out, open(OUT_DIR / "muni" / "index.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(muni_paths, open(OUT_DIR / "muni" / "all_paths.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(geo_100, open(OUT_DIR / "geography_100.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump({"regions": world_out, "paths": world_paths}, open(OUT_DIR / "world_map.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    for p in [OUT_DIR / "japan_prefs.json", OUT_DIR / "muni" / "index.json", OUT_DIR / "muni" / "all_paths.json", OUT_DIR / "geography_100.json", OUT_DIR / "world_map.json"]:
        print(f"Wrote {p.relative_to(OUT_DIR.parent.parent)}: {p.stat().st_size / 1024:.1f} KB")
    print(f"Summary: prefs={len(pref_out)}, munis={len(muni_out)}, geo100={len(geo_100)}, world={len(world_out)}")


if __name__ == "__main__":
    main()
