#!/usr/bin/env python3
"""Assemble and strictly validate public/data/geography_100.json from scripts/geo_sources/*.json.

Also optionally generates high-resolution visual verification PNGs using headless Chrome
when invoked with `--render-verify <output_dir>`.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
GEO_JSON_PATH = ROOT / "public" / "data" / "geography_100.json"
PREFS_JSON_PATH = ROOT / "public" / "data" / "japan_prefs.json"
SOURCES_DIR = ROOT / "scripts" / "geo_sources"

CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

EXPECTED_COUNTS = {
    "lake": 22,
    "river": 16,
    "mountain": 21,
    "mountains": 24,
    "plain": 17,
}

# Japan main SVG coordinate bounds required by verification spec
BOUNDS_X = (40.0, 950.0)
BOUNDS_Y = (30.0, 920.0)

# Expected prefecture codes (JIS X 0401) for every mountain summit
MOUNTAIN_PREFS: dict[str, list[str]] = {
    "geo_000": ["20", "21"],  # 御嶽山 (長野・岐阜)
    "geo_001": ["25", "26"],  # 比叡山 (滋賀・京都)
    "geo_002": ["10", "20"],  # 浅間山 (群馬・長野)
    "geo_005": ["01"],        # 羊蹄山 (北海道)
    "geo_006": ["19", "22"],  # 富士山 (山梨・静岡)
    "geo_007": ["43"],        # 阿蘇山 (熊本)
    "geo_008": ["03"],        # 岩手山 (岩手)
    "geo_009": ["07"],        # 磐梯山 (福島)
    "geo_011": ["24", "29"],  # 大台ケ原山 (三重・奈良)
    "geo_014": ["05", "06"],  # 鳥海山 (秋田・山形)
    "geo_015": ["21", "25"],  # 伊吹山 (岐阜・滋賀)
    "geo_019": ["04"],        # 日和山 (宮城・仙台市)
    "geo_022": ["01"],        # 大雪山 (北海道)
    "geo_023": ["46"],        # 桜島 (鹿児島)
    "geo_025": ["09"],        # 男体山 (栃木)
    "geo_027": ["36"],        # 剣山 (徳島)
    "geo_028": ["31"],        # 大山 (鳥取)
    "geo_036": ["19", "20"],  # 八ヶ岳 (山梨・長野)
    "geo_038": ["42"],        # 雲仙岳 (長崎)
    "geo_039": ["38"],        # 石鎚山 (愛媛)
    "geo_042": ["28"],        # 六甲山 (兵庫)
}

# Expected prefecture codes for every lake
LAKE_PREFS: dict[str, list[str]] = {
    "geo_003": ["01"],        # 洞爺湖
    "geo_004": ["08", "12"],  # 霞ヶ浦
    "geo_010": ["22"],        # 浜名湖
    "geo_012": ["02"],        # 小川原湖
    "geo_013": ["01"],        # 風蓮湖
    "geo_016": ["01"],        # 網走湖
    "geo_017": ["01"],        # 阿寒湖
    "geo_018": ["01"],        # サロマ湖
    "geo_020": ["31", "32"],  # 中海
    "geo_021": ["25"],        # 琵琶湖
    "geo_024": ["01"],        # 能取湖
    "geo_026": ["05"],        # 田沢湖
    "geo_029": ["01"],        # 朱鞠内湖
    "geo_030": ["02", "05"],  # 十和田湖
    "geo_031": ["07"],        # 猪苗代湖
    "geo_032": ["32"],        # 宍道湖
    "geo_033": ["07"],        # 桧原湖
    "geo_034": ["09"],        # 中禅寺湖
    "geo_035": ["01"],        # 屈斜路湖
    "geo_037": ["20"],        # 諏訪湖
    "geo_040": ["01"],        # 支笏湖
    "geo_041": ["01"],        # 摩周湖
}

# Expected prefecture codes for every plain
PLAIN_PREFS: dict[str, list[str]] = {
    "geo_076": ["27", "28"],                                      # 大阪平野
    "geo_077": ["15"],                                            # 越後平野
    "geo_078": ["40", "41"],                                      # 筑紫平野
    "geo_079": ["01"],                                            # 十勝平野
    "geo_080": ["37"],                                            # 讃岐平野
    "geo_081": ["08", "09", "10", "11", "12", "13", "14"],        # 関東平野
    "geo_082": ["21", "23", "24"],                                # 濃尾平野
    "geo_083": ["33"],                                            # 岡山平野
    "geo_084": ["43"],                                            # 八代平野
    "geo_085": ["31"],                                            # 鳥取平野
    "geo_086": ["02"],                                            # 津軽平野
    "geo_087": ["01"],                                            # 石狩平野
    "geo_088": ["05"],                                            # 秋田平野
    "geo_089": ["39"],                                            # 高知平野
    "geo_090": ["45"],                                            # 宮崎平野
    "geo_091": ["06"],                                            # 庄内平野
    "geo_092": ["04"],                                            # 仙台平野
}

# Expected prefecture codes for mountain ranges (where ridge/zone primarily lies)
RANGE_PREFS: dict[str, list[str]] = {
    "geo_043": ["15", "16", "20", "21"],              # 飛騨山脈
    "geo_044": ["01"],                                # 天塩山地
    "geo_045": ["01"],                                # 夕張山地
    "geo_046": ["36", "38", "39"],                    # 四国山地
    "geo_047": ["36", "37"],                          # 讃岐山脈
    "geo_048": ["02", "05"],                          # 白神山地
    "geo_051": ["24", "27", "29", "30"],              # 紀伊山地
    "geo_052": ["02", "03", "04"],                    # 北上山地
    "geo_053": ["02", "03", "04", "05", "06", "07", "09"],  # 奥羽山脈
    "geo_056": ["01"],                                # 石狩山地
    "geo_057": ["16", "17", "18", "21"],              # 両白山地
    "geo_059": ["43", "44", "45", "46"],              # 九州山地
    "geo_060": ["07", "09", "10", "15", "20"],        # 越後山脈
    "geo_063": ["20", "21"],                          # 木曽山脈
    "geo_064": ["40", "41", "42", "44"],              # 筑紫山地
    "geo_065": ["01"],                                # 日高山脈
    "geo_066": ["02", "05", "06", "15"],              # 出羽山地
    "geo_068": ["19", "20", "22"],                    # 赤石山脈
    "geo_069": ["01"],                                # 北見山地
    "geo_071": ["04", "07", "08"],                    # 阿武隈高地
    "geo_072": ["10", "11", "13", "14", "19", "20"],  # 関東山地
    "geo_073": ["25", "26", "27", "28"],              # 丹波高地
    "geo_093": ["28", "31", "32", "33", "34", "35"],  # 中国山地
    "geo_096": ["21", "24", "25"],                    # 鈴鹿山脈
}

TOKEN_RE = re.compile(r"[MLZmlz]|[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?")


def is_finite_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def parse_svg_path(d: str) -> list[tuple[list[tuple[float, float]], bool]]:
    """Parse M/L/Z SVG path into list of (points, is_closed) subpaths."""
    tokens = TOKEN_RE.findall(d)
    subpaths: list[tuple[list[tuple[float, float]], bool]] = []
    cur: list[tuple[float, float]] = []
    closed = False
    cmd = ""
    i = 0
    cx = cy = 0.0
    while i < len(tokens):
        tok = tokens[i]
        if tok in ("M", "L", "Z", "m", "l", "z"):
            cmd = tok
            i += 1
            if cmd in ("Z", "z"):
                closed = True
                if cur:
                    subpaths.append((cur, True))
                    cur = []
                    closed = False
            continue
        if cmd in ("M", "L", "m", "l"):
            if i + 1 >= len(tokens):
                raise ValueError(f"Odd coordinate pair in SVG path near token {i}")
            x = float(tokens[i])
            y = float(tokens[i + 1])
            i += 2
            if cmd in ("m", "l"):
                x += cx
                y += cy
            if cmd in ("M", "m"):
                if cur:
                    subpaths.append((cur, closed))
                cur = [(x, y)]
                closed = False
                cmd = "L" if cmd == "M" else "l"
            else:
                cur.append((x, y))
            cx, cy = x, y
        else:
            raise ValueError(f"Unsupported SVG path command: {cmd!r}")
    if cur:
        subpaths.append((cur, closed))
    return subpaths


def ring_bbox(pts: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def point_in_ring(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    if n < 3:
        return False
    x1, y1 = ring[-1]
    for x2, y2 in ring:
        if (y1 > y) != (y2 > y):
            x_int = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < x_int:
                inside = not inside
        x1, y1 = x2, y2
    return inside


def point_in_evenodd(
    x: float,
    y: float,
    rings_with_bbox: list[tuple[list[tuple[float, float]], tuple[float, float, float, float]]],
) -> bool:
    inside = False
    for ring, (minx, miny, maxx, maxy) in rings_with_bbox:
        if x < minx or x > maxx or y < miny or y > maxy:
            continue
        if point_in_ring(x, y, ring):
            inside = not inside
    return inside


def point_to_segment_dist_sq(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> float:
    dx = bx - ax
    dy = by - ay
    l2 = dx * dx + dy * dy
    if l2 == 0.0:
        return (px - ax) ** 2 + (py - ay) ** 2
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    projx = ax + t * dx
    projy = ay + t * dy
    return (px - projx) ** 2 + (py - projy) ** 2


def point_to_polyline_dist(
    px: float, py: float, pts: list[tuple[float, float]], closed: bool = False
) -> float:
    best = float("inf")
    n = len(pts)
    if n == 0:
        return best
    if n == 1:
        return math.hypot(px - pts[0][0], py - pts[0][1])
    for i in range(n - 1):
        d2 = point_to_segment_dist_sq(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
        if d2 < best:
            best = d2
    if closed and n >= 3:
        d2 = point_to_segment_dist_sq(px, py, pts[-1][0], pts[-1][1], pts[0][0], pts[0][1])
        if d2 < best:
            best = d2
    return math.sqrt(best)


def ring_signed_area(ring: list[tuple[float, float]]) -> float:
    n = len(ring)
    if n < 3:
        return 0.0
    s = 0.0
    x1, y1 = ring[-1]
    for x2, y2 in ring:
        s += x1 * y2 - x2 * y1
        x1, y1 = x2, y2
    return 0.5 * s


def ring_perimeter(ring: list[tuple[float, float]]) -> float:
    n = len(ring)
    if n < 2:
        return 0.0
    p = 0.0
    x1, y1 = ring[-1]
    for x2, y2 in ring:
        p += math.hypot(x2 - x1, y2 - y1)
        x1, y1 = x2, y2
    return p


class JapanLandIndex:
    """Fast pure-Python spatial index over all 47 prefectures in japan_prefs.json."""

    def __init__(self, prefs_data: dict[str, Any]) -> None:
        self.pref_names: dict[str, str] = {p["code"]: p["name"] for p in prefs_data["prefs"]}
        self.pref_rings: dict[
            str, list[tuple[list[tuple[float, float]], tuple[float, float, float, float]]]
        ] = {}
        self.pref_bboxes: dict[str, tuple[float, float, float, float]] = {}
        for code, d in prefs_data["paths"].items():
            subpaths = parse_svg_path(d)
            rlist = []
            minx = miny = float("inf")
            maxx = maxy = float("-inf")
            for pts, _ in subpaths:
                if len(pts) < 3:
                    continue
                bb = ring_bbox(pts)
                rlist.append((pts, bb))
                minx = min(minx, bb[0])
                miny = min(miny, bb[1])
                maxx = max(maxx, bb[2])
                maxy = max(maxy, bb[3])
            self.pref_rings[code] = rlist
            self.pref_bboxes[code] = (minx, miny, maxx, maxy)

    def pref_at_point(self, x: float, y: float) -> str | None:
        for code, (minx, miny, maxx, maxy) in self.pref_bboxes.items():
            if x < minx or x > maxx or y < miny or y > maxy:
                continue
            if point_in_evenodd(x, y, self.pref_rings[code]):
                return code
        return None

    def is_on_land(self, x: float, y: float) -> bool:
        return self.pref_at_point(x, y) is not None

    def dist_to_pref(self, x: float, y: float, code: str) -> float:
        rlist = self.pref_rings[code]
        if point_in_evenodd(x, y, rlist):
            return 0.0
        best = float("inf")
        for ring, (minx, miny, maxx, maxy) in rlist:
            dx = max(minx - x, 0.0, x - maxx)
            dy = max(miny - y, 0.0, y - maxy)
            if math.hypot(dx, dy) >= best:
                continue
            d = point_to_polyline_dist(x, y, ring, closed=True)
            if d < best:
                best = d
        return best

    def dist_to_any_land(self, x: float, y: float) -> float:
        if self.is_on_land(x, y):
            return 0.0
        best = float("inf")
        for code, (minx, miny, maxx, maxy) in self.pref_bboxes.items():
            dx = max(minx - x, 0.0, x - maxx)
            dy = max(miny - y, 0.0, y - maxy)
            if math.hypot(dx, dy) >= best:
                continue
            d = self.dist_to_pref(x, y, code)
            if d < best:
                best = d
        return best

    def is_inside_outer_pref_ring(self, x: float, y: float, code: str) -> bool:
        """True if point is inside ANY single ring of pref (ignoring lake cutouts)."""
        for ring, (minx, miny, maxx, maxy) in self.pref_rings[code]:
            if x < minx or x > maxx or y < miny or y > maxy:
                continue
            if point_in_ring(x, y, ring):
                return True
        return False


def sample_polygon_land_overlap(
    rings_with_bbox: list[tuple[list[tuple[float, float]], tuple[float, float, float, float]]],
    bbox: list[float],
    land: JapanLandIndex,
    target_samples_axis: int = 55,
) -> tuple[int, int, Counter[str]]:
    """Sample a dense grid inside polygon and count (total_in_poly, ocean_count, pref_counts)."""
    minx, miny, maxx, maxy = bbox
    w = max(maxx - minx, 1e-3)
    h = max(maxy - miny, 1e-3)
    step = max(0.25, min(w, h) / target_samples_axis)
    # Keep total grid checks bounded while still dense
    while (w / step) * (h / step) > 25000:
        step *= 1.2
    nx = max(1, int(math.ceil(w / step)))
    ny = max(1, int(math.ceil(h / step)))
    dx = w / nx
    dy = h / ny

    total = 0
    ocean = 0
    pref_counts: Counter[str] = Counter()
    for iy in range(ny):
        y = miny + (iy + 0.5) * dy
        for ix in range(nx):
            x = minx + (ix + 0.5) * dx
            if point_in_evenodd(x, y, rings_with_bbox):
                total += 1
                p = land.pref_at_point(x, y)
                if p is None:
                    ocean += 1
                else:
                    pref_counts[p] += 1
    return total, ocean, pref_counts


def validate_and_assemble() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    with open(GEO_JSON_PATH, encoding="utf-8") as f:
        existing: list[dict[str, Any]] = json.load(f)
    with open(PREFS_JSON_PATH, encoding="utf-8") as f:
        prefs_data = json.load(f)

    land = JapanLandIndex(prefs_data)

    sources: dict[str, dict[str, Any]] = {}
    for src_name in ("lakes.json", "rivers.json", "mountains.json", "plains.json"):
        src_path = SOURCES_DIR / src_name
        if not src_path.exists():
            raise FileNotFoundError(f"Missing source file: {src_path}")
        with open(src_path, encoding="utf-8") as f:
            data = json.load(f)
        for k, v in data.items():
            if k in sources:
                raise ValueError(f"Duplicate id {k} across source files!")
            sources[k] = v

    assert len(existing) == 100, f"Existing geography_100.json has {len(existing)} items, expected 100"
    assert len(sources) == 100, f"Combined geo_sources has {len(sources)} items, expected 100"

    rebuilt: list[dict[str, Any]] = []
    errors: list[str] = []
    warnings: list[str] = []
    metrics: dict[str, Any] = {
        "counts": Counter(),
        "lakes": [],
        "rivers": [],
        "mountains": [],
        "ranges": [],
        "plains": [],
    }

    for idx, orig in enumerate(existing):
        expected_id = f"geo_{idx:03d}"
        fid = orig["id"]
        if fid != expected_id:
            errors.append(f"Order mismatch at index {idx}: got {fid}, expected {expected_id}")
        name = orig["name"]
        cat = orig["category"]
        metrics["counts"][cat] += 1

        if fid not in sources:
            errors.append(f"Missing geometry source for {fid} ({name}, {cat})")
            continue
        src = sources[fid]
        if src.get("name") != name:
            errors.append(f"Name mismatch for {fid}: orig={name!r}, src={src.get('name')!r}")

        gtype = src.get("geometryType")
        pts = src.get("pts")
        path = src.get("path")
        center = src.get("center")
        bbox = src.get("bbox")

        # 1. Basic structural & finite checks
        if gtype not in ("polygon", "line"):
            errors.append(f"{fid} {name}: invalid geometryType={gtype!r}")
        if not isinstance(pts, list) or len(pts) == 0:
            errors.append(f"{fid} {name}: empty pts")
            continue
        if not (isinstance(center, list) and len(center) == 2 and all(is_finite_num(c) for c in center)):
            errors.append(f"{fid} {name}: invalid center={center!r}")
            continue
        if not (isinstance(bbox, list) and len(bbox) == 4 and all(is_finite_num(b) for b in bbox)):
            errors.append(f"{fid} {name}: invalid bbox={bbox!r}")
            continue
        if bbox[0] > bbox[2] or bbox[1] > bbox[3]:
            errors.append(f"{fid} {name}: inverted bbox={bbox}")

        all_coords: list[tuple[float, float]] = [(float(center[0]), float(center[1]))]
        for pt in pts:
            if not (isinstance(pt, list) and len(pt) == 2 and all(is_finite_num(c) for c in pt)):
                errors.append(f"{fid} {name}: invalid pt {pt!r}")
                break
            all_coords.append((float(pt[0]), float(pt[1])))

        subpaths: list[tuple[list[tuple[float, float]], bool]] = []
        if path is not None:
            if not isinstance(path, str) or not path.strip():
                errors.append(f"{fid} {name}: empty path string")
            else:
                try:
                    subpaths = parse_svg_path(path)
                except Exception as exc:
                    errors.append(f"{fid} {name}: failed to parse SVG path: {exc}")
                for sp, _ in subpaths:
                    for x, y in sp:
                        if not (math.isfinite(x) and math.isfinite(y)):
                            errors.append(f"{fid} {name}: non-finite coord in path")
                        all_coords.append((x, y))

        # 2. Japan bounds check
        min_x = min(c[0] for c in all_coords)
        max_x = max(c[0] for c in all_coords)
        min_y = min(c[1] for c in all_coords)
        max_y = max(c[1] for c in all_coords)
        if min_x < BOUNDS_X[0] or max_x > BOUNDS_X[1] or min_y < BOUNDS_Y[0] or max_y > BOUNDS_Y[1]:
            errors.append(
                f"{fid} {name}: coords out of Japan bounds: "
                f"x=[{min_x:.2f},{max_x:.2f}] y=[{min_y:.2f},{max_y:.2f}]"
            )
        if bbox[0] < BOUNDS_X[0] or bbox[2] > BOUNDS_X[1] or bbox[1] < BOUNDS_Y[0] or bbox[3] > BOUNDS_Y[1]:
            errors.append(f"{fid} {name}: bbox out of Japan bounds: {bbox}")

        # 3. Category-specific rigorous checks
        cx, cy = float(center[0]), float(center[1])

        if cat == "mountain":
            if gtype != "polygon":
                errors.append(f"{fid} {name}: mountain geometryType should be 'polygon', got {gtype}")
            expected_prefs = MOUNTAIN_PREFS[fid]
            min_d = min(land.dist_to_pref(cx, cy, p) for p in expected_prefs)
            actual_pref = land.pref_at_point(cx, cy)
            on_land = actual_pref is not None or land.dist_to_any_land(cx, cy) <= 1.2
            if not on_land:
                errors.append(f"{fid} {name}: summit center ({cx},{cy}) is NOT on land (dist={land.dist_to_any_land(cx,cy):.2f}px)")
            if min_d > 1.5:
                errors.append(
                    f"{fid} {name}: summit ({cx},{cy}) dist={min_d:.2f}px from expected prefs {expected_prefs} "
                    f"(actual pref={actual_pref})"
                )
            metrics["mountains"].append(
                {"id": fid, "name": name, "center": center, "pref": actual_pref, "dist_expected": round(min_d, 3)}
            )

        elif cat == "lake":
            if gtype != "polygon":
                errors.append(f"{fid} {name}: lake geometryType should be 'polygon', got {gtype}")
            if not path or not subpaths:
                errors.append(f"{fid} {name}: lake missing SVG path")
            if len(pts) < 12:
                errors.append(f"{fid} {name}: lake has too few outer pts ({len(pts)})")
            expected_prefs = LAKE_PREFS[fid]
            rings_wb = [(sp, ring_bbox(sp)) for sp, _ in subpaths if len(sp) >= 3]
            if rings_wb and not point_in_evenodd(cx, cy, rings_wb):
                # Allow if inside primary outer ring (e.g. Nakajima island at exact center of Toya/Kussharo)
                if not point_in_ring(cx, cy, rings_wb[0][0]):
                    errors.append(f"{fid} {name}: lake center ({cx},{cy}) outside primary outer ring")
            # Check lake alignment with expected prefecture(s)
            # Every lake vertex should be either inside one of expected_prefs' outer rings OR within 2.5px of expected pref land
            outer_pts = [(float(p[0]), float(p[1])) for p in pts]
            far_verts = 0
            max_v_dist = 0.0
            for vx, vy in outer_pts:
                inside_any = any(land.is_inside_outer_pref_ring(vx, vy, p) for p in expected_prefs)
                if inside_any:
                    d = 0.0
                else:
                    d = min(land.dist_to_pref(vx, vy, p) for p in expected_prefs)
                if d > max_v_dist:
                    max_v_dist = d
                if d > 2.5:
                    far_verts += 1
            center_ok = any(land.is_inside_outer_pref_ring(cx, cy, p) for p in expected_prefs) or (
                min(land.dist_to_pref(cx, cy, p) for p in expected_prefs) <= 2.0
            )
            if not center_ok:
                errors.append(f"{fid} {name}: lake center ({cx},{cy}) not aligned with expected prefs {expected_prefs}")
            if far_verts > max(2, int(len(outer_pts) * 0.1)):
                errors.append(
                    f"{fid} {name}: {far_verts}/{len(outer_pts)} vertices >2.5px outside expected prefs {expected_prefs} (max={max_v_dist:.2f}px)"
                )
            metrics["lakes"].append(
                {
                    "id": fid,
                    "name": name,
                    "pts": len(pts),
                    "rings": len(rings_wb),
                    "max_pref_dist": round(max_v_dist, 2),
                }
            )

        elif cat == "river":
            if gtype != "line":
                errors.append(f"{fid} {name}: river geometryType should be 'line', got {gtype}")
            if not path or not subpaths:
                errors.append(f"{fid} {name}: river missing SVG path")
            total_pts = sum(len(sp) for sp, _ in subpaths)
            if len(pts) < 15 or total_pts < 15:
                errors.append(f"{fid} {name}: river has too few vertices (pts={len(pts)}, path_pts={total_pts})")
            max_step = 0.0
            for sp, _ in subpaths:
                for i in range(len(sp) - 1):
                    step = math.hypot(sp[i + 1][0] - sp[i][0], sp[i + 1][1] - sp[i][1])
                    if step > max_step:
                        max_step = step
            if max_step > 12.0:
                errors.append(f"{fid} {name}: river has jumping step={max_step:.2f}px")
            # Check center lies directly on river path
            center_dist = min(point_to_polyline_dist(cx, cy, sp, closed=False) for sp, _ in subpaths)
            if center_dist > 1.5:
                errors.append(f"{fid} {name}: river center ({cx},{cy}) is {center_dist:.2f}px off polyline")
            # Check endpoints aren't floating far out in sea
            main_pts = [(float(p[0]), float(p[1])) for p in pts]
            d_start = land.dist_to_any_land(*main_pts[0])
            d_end = land.dist_to_any_land(*main_pts[-1])
            if d_start > 3.0 or d_end > 3.0:
                errors.append(f"{fid} {name}: endpoint floating in sea (start={d_start:.2f}px, end={d_end:.2f}px)")
            metrics["rivers"].append(
                {
                    "id": fid,
                    "name": name,
                    "pts": len(pts),
                    "subpaths": len(subpaths),
                    "max_step": round(max_step, 2),
                    "center_dist": round(center_dist, 3),
                }
            )

        elif cat == "plain":
            if gtype != "polygon":
                errors.append(f"{fid} {name}: plain geometryType MUST be 'polygon', got {gtype}")
            if not path or not subpaths:
                errors.append(f"{fid} {name}: plain missing SVG path")
            rings_wb = [(sp, ring_bbox(sp)) for sp, _ in subpaths if len(sp) >= 3]
            if not rings_wb:
                errors.append(f"{fid} {name}: plain has no valid polygon rings")
                continue
            if len(pts) < 20:
                errors.append(f"{fid} {name}: plain outer ring too coarse ({len(pts)} pts)")
            # Circularity check on largest ring
            outer_ring = max((r for r, _ in rings_wb), key=lambda r: abs(ring_signed_area(r)))
            area = abs(ring_signed_area(outer_ring))
            perim = ring_perimeter(outer_ring)
            circ = (4.0 * math.pi * area) / (perim * perim) if perim > 0 else 1.0
            if circ > 0.72:
                errors.append(f"{fid} {name}: plain looks too circular/oval (circularity={circ:.3f})")
            if area < 5.0:
                errors.append(f"{fid} {name}: plain area suspiciously tiny ({area:.2f} px^2)")
            # Center inside polygon and on land
            if not point_in_evenodd(cx, cy, rings_wb):
                errors.append(f"{fid} {name}: plain center ({cx},{cy}) outside polygon")
            if not land.is_on_land(cx, cy):
                errors.append(f"{fid} {name}: plain center ({cx},{cy}) is in ocean!")
            # Ocean overlap check
            total_s, ocean_s, pref_counts = sample_polygon_land_overlap(rings_wb, bbox, land)
            ocean_pct = (100.0 * ocean_s / total_s) if total_s > 0 else 100.0
            if ocean_pct > 1.5:
                errors.append(f"{fid} {name}: plain ocean overlap too high ({ocean_pct:.2f}%)")
            expected_prefs = set(PLAIN_PREFS[fid])
            land_s = total_s - ocean_s
            in_expected = sum(cnt for p, cnt in pref_counts.items() if p in expected_prefs)
            expected_pct = (100.0 * in_expected / land_s) if land_s > 0 else 0.0
            if expected_pct < 80.0:
                errors.append(
                    f"{fid} {name}: only {expected_pct:.1f}% inside expected prefs {sorted(expected_prefs)}; "
                    f"got {dict(pref_counts)}"
                )
            metrics["plains"].append(
                {
                    "id": fid,
                    "name": name,
                    "pts": len(pts),
                    "rings": len(rings_wb),
                    "area": round(area, 1),
                    "circ": round(circ, 3),
                    "ocean_pct": round(ocean_pct, 2),
                    "expected_pref_pct": round(expected_pct, 1),
                }
            )

        elif cat == "mountains":
            if gtype != "line":
                errors.append(f"{fid} {name}: mountain range geometryType should be 'line', got {gtype}")
            if len(pts) < 6:
                errors.append(f"{fid} {name}: mountain range has fewer than 6 ridge points ({len(pts)})")
            if not path or not subpaths:
                errors.append(f"{fid} {name}: mountain range missing land-clipped zone polygon path")
                continue
            rings_wb = [(sp, ring_bbox(sp)) for sp, _ in subpaths if len(sp) >= 3]
            if not rings_wb:
                errors.append(f"{fid} {name}: mountain range path has no valid polygon rings")
                continue
            # Check ridge points on land & within expected prefs
            ridge_pts = [(float(p[0]), float(p[1])) for p in pts]
            expected_prefs = set(RANGE_PREFS[fid])
            ridge_off_land = sum(1 for rx, ry in ridge_pts if land.dist_to_any_land(rx, ry) > 1.5)
            if ridge_off_land > 0:
                errors.append(f"{fid} {name}: {ridge_off_land}/{len(ridge_pts)} ridge pts off land")
            # Ocean overlap of zone polygon
            total_s, ocean_s, pref_counts = sample_polygon_land_overlap(rings_wb, bbox, land)
            ocean_pct = (100.0 * ocean_s / total_s) if total_s > 0 else 100.0
            if ocean_pct > 2.0:
                errors.append(f"{fid} {name}: mountain range zone ocean overlap={ocean_pct:.2f}%")
            land_s = total_s - ocean_s
            in_expected = sum(cnt for p, cnt in pref_counts.items() if p in expected_prefs)
            expected_pct = (100.0 * in_expected / land_s) if land_s > 0 else 0.0
            if expected_pct < 60.0:
                warnings.append(
                    f"{fid} {name}: range zone {expected_pct:.1f}% in expected prefs {sorted(expected_prefs)}; "
                    f"got {dict(pref_counts)}"
                )
            center_dist = point_to_polyline_dist(cx, cy, ridge_pts, closed=False)
            if center_dist > 3.0:
                warnings.append(f"{fid} {name}: range center is {center_dist:.2f}px from ridge polyline")
            metrics["ranges"].append(
                {
                    "id": fid,
                    "name": name,
                    "ridge_pts": len(pts),
                    "zone_rings": len(rings_wb),
                    "ocean_pct": round(ocean_pct, 2),
                    "expected_pref_pct": round(expected_pct, 1),
                }
            )

        # Build clean output item preserving exact metadata
        item: dict[str, Any] = {
            "id": orig["id"],
            "name": orig["name"],
            "ruby": orig["ruby"],
            "category": orig["category"],
            "geometryType": gtype,
            "pts": pts,
        }
        if path:
            item["path"] = path
        item["center"] = center
        item["bbox"] = bbox
        item["wiki"] = orig["wiki"]
        item["desc"] = orig["desc"]
        rebuilt.append(item)

    # Check exact category counts
    for cat, exp in EXPECTED_COUNTS.items():
        if metrics["counts"][cat] != exp:
            errors.append(f"Category {cat!r}: got {metrics['counts'][cat]}, expected {exp}")
    if len(rebuilt) != 100:
        errors.append(f"Total rebuilt count={len(rebuilt)}, expected 100")

    metrics["errors"] = errors
    metrics["warnings"] = warnings
    return rebuilt, metrics


def escape_xml(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def render_svg_to_png(html_content: str, out_png: Path, width: int, height: int) -> None:
    out_png.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as tf:
        tf.write(html_content)
        tmp_html = tf.name
    try:
        cmd = [
            CHROME_BIN,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            f"--window-size={width},{height}",
            "--force-device-scale-factor=1",
            f"--screenshot={str(out_png)}",
            f"file://{tmp_html}",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if res.returncode != 0 or not out_png.exists():
            raise RuntimeError(
                f"Chrome screenshot failed for {out_png}: rc={res.returncode}\nstderr={res.stderr}"
            )
    finally:
        if os.path.exists(tmp_html):
            os.remove(tmp_html)


def build_base_map_svg(prefs_data: dict[str, Any], land_fill: str = "#f3f4f6", stroke: str = "#9ca3af", stroke_w: float = 0.65) -> str:
    parts = [f'<g fill="{land_fill}" stroke="{stroke}" stroke-width="{stroke_w}" stroke-linejoin="round">']
    for code, d in prefs_data["paths"].items():
        if code == "47":
            continue  # Okinawa outside main map bbox
        parts.append(f'<path d="{d}" fill-rule="evenodd"/>')
    parts.append("</g>")
    return "\n".join(parts)


def make_html_page(title: str, subtitle: str, body_html: str, width: int, height: int) -> str:
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    width: {width}px;
    height: {height}px;
    background: #dbeafe;
    font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "YuGothic", sans-serif;
    color: #0f172a;
    overflow: hidden;
  }}
  .header {{
    height: 54px;
    background: #0f172a;
    color: #f8fafc;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
  }}
  .header h1 {{ font-size: 20px; font-weight: 700; }}
  .header .sub {{ font-size: 13px; color: #94a3b8; }}
  .main {{
    position: relative;
    width: {width}px;
    height: {height - 54}px;
  }}
  .panel {{
    background: #dbeafe;
    border: 2px solid #475569;
    border-radius: 6px;
    overflow: hidden;
    position: relative;
  }}
  .panel-title {{
    position: absolute;
    top: 6px;
    left: 8px;
    background: rgba(15, 23, 42, 0.86);
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 4px;
    z-index: 2;
  }}
  svg {{ display: block; width: 100%; height: 100%; }}
  text.lbl {{
    font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif;
    font-weight: 700;
    paint-order: stroke;
    stroke: rgba(255,255,255,0.95);
    stroke-linejoin: round;
  }}
</style>
</head>
<body>
  <div class="header">
    <h1>{escape_xml(title)}</h1>
    <div class="sub">{escape_xml(subtitle)}</div>
  </div>
  <div class="main">{body_html}</div>
</body>
</html>"""


def render_verification_pngs(rebuilt: list[dict[str, Any]], out_dir: Path) -> list[Path]:
    with open(PREFS_JSON_PATH, encoding="utf-8") as f:
        prefs_data = json.load(f)

    out_dir.mkdir(parents=True, exist_ok=True)
    generated: list[Path] = []
    base_full = build_base_map_svg(prefs_data, "#f8fafc", "#64748b", 0.65)
    base_inset = build_base_map_svg(prefs_data, "#f8fafc", "#475569", 0.45)

    by_cat: dict[str, list[dict[str, Any]]] = {k: [] for k in EXPECTED_COUNTS}
    for item in rebuilt:
        by_cat[item["category"]].append(item)

    # ------------------------------------------------------------------
    # 1. verify_lakes.png (Full Japan + 4 zoomed insets)
    # ------------------------------------------------------------------
    lakes = by_cat["lake"]

    def lakes_overlay(font_size: float, stroke_w: float, show_labels: bool = True) -> str:
        out = []
        for f in lakes:
            d = f.get("path", "")
            cx, cy = f["center"]
            out.append(
                f'<path d="{d}" fill="#0284c7" fill-opacity="0.78" stroke="#0c4a6e" '
                f'stroke-width="{stroke_w}" fill-rule="evenodd"/>'
            )
            out.append(f'<circle cx="{cx}" cy="{cy}" r="{stroke_w * 1.4}" fill="#ef4444" stroke="#fff" stroke-width="{stroke_w * 0.5}"/>')
        if show_labels:
            # Slight deterministic offsets to prevent collisions in Hokkaido east & Fukushima/Shimane
            offsets = {
                "網走湖": (10, -4),
                "能取湖": (-10, -10),
                "サロマ湖": (-14, -12),
                "屈斜路湖": (-14, 10),
                "摩周湖": (12, 2),
                "阿寒湖": (-12, 12),
                "風蓮湖": (6, -8),
                "洞爺湖": (-12, 10),
                "支笏湖": (12, -4),
                "猪苗代湖": (12, 10),
                "桧原湖": (-12, -6),
                "中禅寺湖": (-10, -6),
                "宍道湖": (-14, 10),
                "中海": (12, -6),
            }
            for f in lakes:
                cx, cy = f["center"]
                ox, oy = offsets.get(f["name"], (0, -font_size * 0.8))
                # Scale offset proportionally to font_size
                sc = font_size / 8.0
                out.append(
                    f'<text class="lbl" x="{cx + ox * sc:.2f}" y="{cy + oy * sc:.2f}" '
                    f'font-size="{font_size:.2f}" stroke-width="{font_size * 0.32:.2f}" '
                    f'fill="#0c4a6e" text-anchor="middle">{escape_xml(f["name"])}</text>'
                )
        return "\n".join(out)

    insets = [
        ("Hokkaido (10 lakes)", "555 100 250 155", 6.2, 0.35),
        ("Tohoku & Nikko (6 lakes)", "520 305 125 250", 5.8, 0.32),
        ("Kanto & Chubu (3 lakes: 霞ヶ浦・諏訪湖・浜名湖)", "425 535 190 125", 5.8, 0.35),
        ("Kansai & Chugoku (3 lakes: 琵琶湖・宍道湖・中海)", "235 565 195 105", 5.8, 0.32),
    ]
    inset_rects = [
        (555, 100, 250, 155, "#dc2626"),
        (520, 305, 125, 250, "#2563eb"),
        (425, 535, 190, 125, "#16a34a"),
        (235, 565, 195, 105, "#9333ea"),
    ]
    rect_svg = "\n".join(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="{c}" stroke-width="1.6" stroke-dasharray="5,3"/>'
        for x, y, w, h, c in inset_rects
    )
    lakes_body = f"""
    <div style="display:flex; gap:12px; padding:12px; width:1920px; height:1346px;">
      <div class="panel" style="width:860px; height:1322px; flex-shrink:0;">
        <div class="panel-title">Full Japan — 22 Lakes (with 4 regional inset boxes)</div>
        <svg width="860" height="1322" viewBox="100 40 760 800" preserveAspectRatio="xMidYMid meet">
          {base_full}
          {lakes_overlay(9.0, 0.70, show_labels=False)}
          {rect_svg}
        </svg>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:12px; width:1024px; height:1322px;">
        {"".join(
            f'''<div class="panel" style="width:506px; height:655px;">
              <div class="panel-title">{escape_xml(t)}</div>
              <svg width="506" height="655" viewBox="{vb}" preserveAspectRatio="xMidYMid meet">
                {base_inset}
                {lakes_overlay(fs, sw, show_labels=True)}
              </svg>
            </div>'''
            for t, vb, fs, sw in insets
        )}
      </div>
    </div>
    """
    p_lakes = out_dir / "verify_lakes.png"
    render_svg_to_png(
        make_html_page(
            "Verification: 22 Japanese Lakes (geography_100.json)",
            "Blue fill = rebuilt OSM evenodd polygons | Red dots = interior center | Base = japan_prefs.json",
            lakes_body,
            1920,
            1400,
        ),
        p_lakes,
        1920,
        1400,
    )
    generated.append(p_lakes)

    # ------------------------------------------------------------------
    # 2. verify_rivers.png (All 16 rivers with labels + source/mouth dots)
    # ------------------------------------------------------------------
    rivers = by_cat["river"]
    river_colors = [
        "#0284c7", "#2563eb", "#7c3aed", "#0d9488",
        "#0369a1", "#1d4ed8", "#4f46e5", "#0f766e",
    ]
    river_svg_parts = []
    for i, f in enumerate(rivers):
        col = river_colors[i % len(river_colors)]
        d = f.get("path", "")
        pts = f["pts"]
        cx, cy = f["center"]
        sx, sy = pts[0]
        ex, ey = pts[-1]
        # White casing + river stroke
        river_svg_parts.append(
            f'<path d="{d}" fill="none" stroke="#ffffff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>'
        )
        river_svg_parts.append(
            f'<path d="{d}" fill="none" stroke="{col}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>'
        )
        # Source (green) and mouth (red) dots + midpoint dot (amber)
        river_svg_parts.append(f'<circle cx="{sx}" cy="{sy}" r="2.6" fill="#16a34a" stroke="#fff" stroke-width="0.8"/>')
        river_svg_parts.append(f'<circle cx="{ex}" cy="{ey}" r="2.6" fill="#dc2626" stroke="#fff" stroke-width="0.8"/>')
        river_svg_parts.append(f'<circle cx="{cx}" cy="{cy}" r="1.9" fill="#f59e0b" stroke="#fff" stroke-width="0.6"/>')

    river_lbl_offsets = {
        "信濃川": (-18, -10),
        "利根川": (24, 14),
        "富士川": (18, 12),
        "木曽川": (-14, 14),
        "神通川": (-18, -8),
        "淀川": (-18, 12),
        "斐伊川": (-16, -10),
        "江の川": (-20, 12),
        "吉野川": (16, -10),
        "四万十川": (-22, 16),
        "筑後川": (-22, -8),
        "球磨川": (20, 14),
        "石狩川": (-22, -10),
        "十勝川": (22, 10),
        "北上川": (24, -4),
        "最上川": (-24, 4),
    }
    for i, f in enumerate(rivers):
        col = river_colors[i % len(river_colors)]
        cx, cy = f["center"]
        ox, oy = river_lbl_offsets.get(f["name"], (0, -10))
        river_svg_parts.append(
            f'<text class="lbl" x="{cx + ox:.2f}" y="{cy + oy:.2f}" font-size="11.5" '
            f'stroke-width="3.5" fill="{col}" text-anchor="middle">{escape_xml(f["name"])} ({len(f["pts"])})</text>'
        )

    rivers_body = f"""
    <div style="padding:12px; height:100%;">
      <div class="panel" style="height:100%;">
        <div class="panel-title">All 16 Rivers — Green=Start, Red=End, Amber=Midpoint (n=pts)</div>
        <svg viewBox="100 40 760 790" preserveAspectRatio="xMidYMid meet">
          {base_full}
          {"".join(river_svg_parts)}
        </svg>
      </div>
    </div>
    """
    p_rivers = out_dir / "verify_rivers.png"
    render_svg_to_png(
        make_html_page(
            "Verification: 16 Japanese Rivers (geography_100.json)",
            "Rebuilt OSM river centerlines over japan_prefs.json",
            rivers_body,
            1600,
            1650,
        ),
        p_rivers,
        1600,
        1650,
    )
    generated.append(p_rivers)

    # ------------------------------------------------------------------
    # 3. verify_mountains.png (All 21 peaks with labels)
    # ------------------------------------------------------------------
    mountains = by_cat["mountain"]
    mtn_parts = []
    mtn_lbl_offsets = {
        "羊蹄山": (-24, 2),
        "大雪山": (0, -14),
        "岩手山": (22, -6),
        "鳥海山": (-24, -4),
        "日和山": (24, 4),
        "磐梯山": (22, -6),
        "男体山": (22, -4),
        "浅間山": (20, -8),
        "八ヶ岳": (22, -2),
        "富士山": (24, 10),
        "御嶽山": (-22, -8),
        "伊吹山": (22, -8),
        "比叡山": (-22, -8),
        "六甲山": (-22, 12),
        "大台ケ原山": (30, 8),
        "大山": (0, -14),
        "剣山": (20, 8),
        "石鎚山": (-22, 6),
        "阿蘇山": (24, -4),
        "雲仙岳": (-26, 6),
        "桜島": (22, 6),
    }
    for f in mountains:
        cx, cy = f["center"]
        # Draw crisp peak triangle centered on exact summit (cx, cy) + crosshair dot
        mtn_parts.append(
            f'<polygon points="{cx},{cy - 7.0} {cx - 6.0},{cy + 3.8} {cx + 6.0},{cy + 3.8}" '
            f'fill="#b45309" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>'
        )
        mtn_parts.append(
            f'<polygon points="{cx},{cy - 7.0} {cx - 2.2},{cy - 2.8} {cx + 2.2},{cy - 2.8}" fill="#ffffff"/>'
        )
        mtn_parts.append(f'<circle cx="{cx}" cy="{cy}" r="1.4" fill="#dc2626"/>')
    for f in mountains:
        cx, cy = f["center"]
        ox, oy = mtn_lbl_offsets.get(f["name"], (0, -12))
        mtn_parts.append(
            f'<line x1="{cx}" y1="{cy}" x2="{cx + ox * 0.7:.2f}" y2="{cy + oy * 0.7:.2f}" '
            f'stroke="#78350f" stroke-width="0.6" stroke-dasharray="2,1"/>'
        )
        mtn_parts.append(
            f'<text class="lbl" x="{cx + ox:.2f}" y="{cy + oy:.2f}" font-size="11.5" '
            f'stroke-width="3.4" fill="#78350f" text-anchor="middle">{escape_xml(f["name"])}</text>'
        )

    mtn_body = f"""
    <div style="padding:12px; height:100%;">
      <div class="panel" style="height:100%;">
        <div class="panel-title">All 21 Mountain Peaks — Red dot = exact projected GSI summit coordinate</div>
        <svg viewBox="100 40 760 790" preserveAspectRatio="xMidYMid meet">
          {base_full}
          {"".join(mtn_parts)}
        </svg>
      </div>
    </div>
    """
    p_mtn = out_dir / "verify_mountains.png"
    render_svg_to_png(
        make_html_page(
            "Verification: 21 Japanese Mountains (geography_100.json)",
            "Exact summit coordinates projected onto japan_prefs.json",
            mtn_body,
            1600,
            1650,
        ),
        p_mtn,
        1600,
        1650,
    )
    generated.append(p_mtn)

    # ------------------------------------------------------------------
    # 4. verify_ranges.png (All 24 mountain ranges: zone polygon + ridge)
    # ------------------------------------------------------------------
    ranges = by_cat["mountains"]
    range_palette = [
        "#b45309", "#9a3412", "#a16207", "#c2410c",
        "#92400e", "#7c2d12", "#b91c1c", "#854d0e",
    ]
    rng_parts = []
    # Draw zones first, ridges second, labels third
    for i, f in enumerate(ranges):
        col = range_palette[i % len(range_palette)]
        d = f.get("path", "")
        rng_parts.append(
            f'<path d="{d}" fill="{col}" fill-opacity="0.30" stroke="{col}" '
            f'stroke-width="1.0" stroke-opacity="0.75" fill-rule="evenodd"/>'
        )
    for i, f in enumerate(ranges):
        col = range_palette[i % len(range_palette)]
        pts_str = " ".join(f"{p[0]},{p[1]}" for p in f["pts"])
        rng_parts.append(
            f'<polyline points="{pts_str}" fill="none" stroke="#ffffff" stroke-width="3.0" stroke-linecap="round" stroke-linejoin="round"/>'
        )
        rng_parts.append(
            f'<polyline points="{pts_str}" fill="none" stroke="{col}" stroke-width="1.8" stroke-dasharray="4,2" stroke-linecap="round" stroke-linejoin="round"/>'
        )
        cx, cy = f["center"]
        rng_parts.append(f'<circle cx="{cx}" cy="{cy}" r="2.2" fill="#dc2626" stroke="#fff" stroke-width="0.7"/>')

    rng_lbl_offsets = {
        "天塩山地": (-28, -4),
        "北見山地": (28, -6),
        "石狩山地": (32, -4),
        "夕張山地": (-28, 6),
        "日高山脈": (26, 12),
        "白神山地": (-26, -6),
        "北上山地": (34, -4),
        "奥羽山脈": (24, -18),
        "出羽山地": (-30, 2),
        "阿武隈高地": (36, 4),
        "越後山脈": (-28, -10),
        "関東山地": (30, 8),
        "飛騨山脈": (-24, -14),
        "両白山地": (-28, -2),
        "木曽山脈": (-24, 10),
        "赤石山脈": (26, 14),
        "鈴鹿山脈": (28, 4),
        "丹波高地": (-22, -12),
        "紀伊山地": (26, 16),
        "中国山地": (-8, -14),
        "讃岐山脈": (24, -10),
        "四国山地": (8, 16),
        "筑紫山地": (-18, -14),
        "九州山地": (26, 10),
    }
    for i, f in enumerate(ranges):
        col = range_palette[i % len(range_palette)]
        cx, cy = f["center"]
        ox, oy = rng_lbl_offsets.get(f["name"], (0, -10))
        rng_parts.append(
            f'<text class="lbl" x="{cx + ox:.2f}" y="{cy + oy:.2f}" font-size="10.5" '
            f'stroke-width="3.2" fill="{col}" text-anchor="middle">{escape_xml(f["name"])}</text>'
        )

    rng_body = f"""
    <div style="padding:12px; height:100%;">
      <div class="panel" style="height:100%;">
        <div class="panel-title">All 24 Mountain Ranges — Shaded zone polygon + dashed ridge polyline</div>
        <svg viewBox="100 40 760 790" preserveAspectRatio="xMidYMid meet">
          {base_full}
          {"".join(rng_parts)}
        </svg>
      </div>
    </div>
    """
    p_rng = out_dir / "verify_ranges.png"
    render_svg_to_png(
        make_html_page(
            "Verification: 24 Japanese Mountain Ranges (geography_100.json)",
            "Land-clipped range zone polygons + peak-to-peak ridge polylines over japan_prefs.json",
            rng_body,
            1600,
            1650,
        ),
        p_rng,
        1600,
        1650,
    )
    generated.append(p_rng)

    # ------------------------------------------------------------------
    # 5. verify_plains.png (All 17 alluvial plains: full map + 4 insets)
    # ------------------------------------------------------------------
    plains = by_cat["plain"]
    plain_palette = [
        "#16a34a", "#65a30d", "#059669", "#15803d", "#4d7c0f", "#0d9488",
    ]

    def plains_overlay(font_size: float, stroke_w: float, show_labels: bool = True) -> str:
        out = []
        for i, f in enumerate(plains):
            col = plain_palette[i % len(plain_palette)]
            d = f.get("path", "")
            cx, cy = f["center"]
            out.append(
                f'<path d="{d}" fill="{col}" fill-opacity="0.55" stroke="#14532d" '
                f'stroke-width="{stroke_w}" fill-rule="evenodd"/>'
            )
            out.append(f'<circle cx="{cx}" cy="{cy}" r="{stroke_w * 1.5}" fill="#dc2626" stroke="#fff" stroke-width="{stroke_w * 0.5}"/>')
        if show_labels:
            p_offsets = {
                "石狩平野": (-16, -6),
                "十勝平野": (0, -8),
                "津軽平野": (-14, -8),
                "秋田平野": (-16, 4),
                "庄内平野": (-16, 4),
                "仙台平野": (18, 4),
                "越後平野": (-16, -6),
                "関東平野": (0, 2),
                "濃尾平野": (0, -10),
                "大阪平野": (16, 6),
                "鳥取平野": (14, -8),
                "岡山平野": (0, -10),
                "讃岐平野": (0, 12),
                "高知平野": (0, 12),
                "筑紫平野": (-14, -8),
                "八代平野": (-16, 8),
                "宮崎平野": (16, 6),
            }
            for f in plains:
                cx, cy = f["center"]
                ox, oy = p_offsets.get(f["name"], (0, -8))
                sc = font_size / 8.5
                out.append(
                    f'<text class="lbl" x="{cx + ox * sc:.2f}" y="{cy + oy * sc:.2f}" '
                    f'font-size="{font_size:.2f}" stroke-width="{font_size * 0.34:.2f}" '
                    f'fill="#14532d" text-anchor="middle">{escape_xml(f["name"])}</text>'
                )
        return "\n".join(out)

    plain_insets = [
        ("Hokkaido & Tohoku (6 plains)", "520 115 240 365", 7.8, 0.42),
        ("Kanto, Echigo & Nobi (3 plains)", "395 445 215 195", 7.4, 0.40),
        ("Kansai, Chugoku & Shikoku (5 plains)", "250 570 155 155", 6.5, 0.35),
        ("Kyushu (3 plains)", "115 675 115 130", 6.5, 0.35),
    ]
    plains_body = f"""
    <div style="display:flex; gap:12px; padding:12px; width:1920px; height:1346px;">
      <div class="panel" style="width:860px; height:1322px; flex-shrink:0;">
        <div class="panel-title">Full Japan — 17 DEM Land-Clipped Alluvial Plains</div>
        <svg width="860" height="1322" viewBox="100 40 760 800" preserveAspectRatio="xMidYMid meet">
          {base_full}
          {plains_overlay(10.5, 0.65, show_labels=True)}
        </svg>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:12px; width:1024px; height:1322px;">
        {"".join(
            f'''<div class="panel" style="width:506px; height:655px;">
              <div class="panel-title">{escape_xml(t)}</div>
              <svg width="506" height="655" viewBox="{vb}" preserveAspectRatio="xMidYMid meet">
                {base_inset}
                {plains_overlay(fs, sw, show_labels=True)}
              </svg>
            </div>'''
            for t, vb, fs, sw in plain_insets
        )}
      </div>
    </div>
    """
    p_plains = out_dir / "verify_plains.png"
    render_svg_to_png(
        make_html_page(
            "Verification: 17 Japanese Alluvial Plains (geography_100.json)",
            "Green fill = land-clipped DEM alluvial plains | Red dots = interior center | Base = japan_prefs.json",
            plains_body,
            1920,
            1400,
        ),
        p_plains,
        1920,
        1400,
    )
    generated.append(p_plains)
    return generated


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild & validate public/data/geography_100.json")
    parser.add_argument("--dry-run", action="store_true", help="Validate without overwriting public/data/geography_100.json")
    parser.add_argument("--render-verify", type=str, default="", help="Output directory for 5 verification PNGs")
    args = parser.parse_args()

    rebuilt, metrics = validate_and_assemble()

    print("=== Category Counts ===")
    for cat, cnt in sorted(metrics["counts"].items()):
        print(f"  {cat:12s}: {cnt}")

    print("\n=== Summary Accuracy Metrics ===")
    if metrics["lakes"]:
        max_ld = max(x["max_pref_dist"] for x in metrics["lakes"])
        print(f"  Lakes (22):     max vertex dist from expected pref = {max_ld:.2f} px")
    if metrics["rivers"]:
        min_rp = min(x["pts"] for x in metrics["rivers"])
        max_st = max(x["max_step"] for x in metrics["rivers"])
        max_cd = max(x["center_dist"] for x in metrics["rivers"])
        print(f"  Rivers (16):    min pts = {min_rp}, max step = {max_st:.2f} px, max center err = {max_cd:.3f} px")
    if metrics["mountains"]:
        max_md = max(x["dist_expected"] for x in metrics["mountains"])
        print(f"  Mountains (21): max summit dist from expected pref = {max_md:.3f} px")
    if metrics["ranges"]:
        min_gp = min(x["ridge_pts"] for x in metrics["ranges"])
        max_go = max(x["ocean_pct"] for x in metrics["ranges"])
        print(f"  Ranges (24):    min ridge pts = {min_gp}, max zone ocean overlap = {max_go:.2f}%")
    if metrics["plains"]:
        max_po = max(x["ocean_pct"] for x in metrics["plains"])
        max_pc = max(x["circ"] for x in metrics["plains"])
        print(f"  Plains (17):    max ocean overlap = {max_po:.2f}%, max circularity = {max_pc:.3f}")

    if metrics["warnings"]:
        print(f"\n=== WARNINGS ({len(metrics['warnings'])}) ===")
        for w in metrics["warnings"]:
            print(f"  [WARN] {w}")

    if metrics["errors"]:
        print(f"\n=== ERRORS ({len(metrics['errors'])}) ===")
        for e in metrics["errors"]:
            print(f"  [ERR] {e}")
        return 1

    compact_json = json.dumps(rebuilt, ensure_ascii=False, separators=(",", ":"))
    size_bytes = len(compact_json.encode("utf-8"))
    print(f"\nCompact JSON size: {size_bytes:,} bytes ({size_bytes / 1024:.1f} KB)")
    if size_bytes >= 500 * 1024:
        print(f"ERROR: JSON size {size_bytes} exceeds 500 KB limit!", file=sys.stderr)
        return 1

    if not args.dry_run:
        with open(GEO_JSON_PATH, "w", encoding="utf-8") as f:
            f.write(compact_json)
        print(f"Wrote {GEO_JSON_PATH}")

    if args.render_verify:
        out_dir = Path(args.render_verify)
        pngs = render_verification_pngs(rebuilt, out_dir)
        print("\n=== Generated Verification PNGs ===")
        for p in pngs:
            print(f"  {p} ({p.stat().st_size / 1024:.1f} KB)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
