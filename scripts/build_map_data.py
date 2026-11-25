#!/usr/bin/env python3
"""Generate accurate Japan blank-map vector datasets and metadata JSONs.

Data sources:
- Geography: smartnews-smri/japan-topography (N03-21, MIT/CC0)
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


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "muni").mkdir(parents=True, exist_ok=True)

    pref_out, pref_paths, muni_out, muni_paths = build_japan_prefs_and_munis()
    geo_100 = build_geography_100(pref_out)

    json.dump({"prefs": pref_out, "paths": pref_paths}, open(OUT_DIR / "japan_prefs.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(muni_out, open(OUT_DIR / "muni" / "index.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(muni_paths, open(OUT_DIR / "muni" / "all_paths.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(geo_100, open(OUT_DIR / "geography_100.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    for p in [OUT_DIR / "japan_prefs.json", OUT_DIR / "muni" / "index.json", OUT_DIR / "muni" / "all_paths.json", OUT_DIR / "geography_100.json"]:
        print(f"Wrote {p.relative_to(OUT_DIR.parent.parent)}: {p.stat().st_size / 1024:.1f} KB")
    print(f"Summary: prefs={len(pref_out)}, munis={len(muni_out)}, geo100={len(geo_100)}")


if __name__ == "__main__":
    main()
