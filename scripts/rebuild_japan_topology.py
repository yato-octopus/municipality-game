#!/usr/bin/env python3
"""Rebuild topology-exact Japan prefecture and municipality SVG vector datasets.

Guarantees:
1. Single authoritative planar TopoJSON source (smartnews-smri/japan-topography N03-21 s0010 designated-city).
2. Arc-level projection (3-decimal precision, 0.001 SVG px) with ZERO per-ring vertex dropping:
   - Every shared arc is projected once in its canonical direction and reversed verbatim for ~a.
   - Adjacent municipalities share 100.000% bit-for-bit identical boundary vertices and edges.
3. All 47 prefectures in `japan_prefs.json` are dissolved directly from the EXACT same
   municipality arc set via full directed-arc cancellation (outer + hole rings) and
   angle-aware planar ring stitching at multi-way junctions:
   - Internal enclave holes within the same prefecture cancel cleanly.
   - Real lake cutouts (Biwa, Kasumigaura, Hamana, Shinji, etc.) and cross-prefecture exclaves
     (e.g. Kitayama-mura) are preserved with 100% shared edges.
   - Adjacent prefectures share 100.000% identical boundary edges (0 gaps, 0 overlaps).
   - Every prefecture outline matches its constituent municipalities 100.000% bit-for-bit.
4. Preserves all existing metadata fields in `public/data/japan_prefs.json` and
   `public/data/muni/index.json` 1:1.
"""

from __future__ import annotations

import json
import math
import os
import sys
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "public" / "data"
DEFAULT_TOPO_URL = (
    "https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/"
    "data/municipality/topojson/s0010/N03-21_210101_designated_city.json"
)
DEFAULT_TOPO_CACHE = Path(os.environ.get("JP_TOPO_PATH", "/tmp/jp_topo/muni_s0010_dc.topojson"))

# Unified Japan Mercator projection (identical to build_map_data.py & geography_100.json)
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


def project_jp_exact(lon: float, lat: float) -> tuple[float, float]:
    x = JP_ORIGIN_X + (lon - JP_REF_LON_MIN) * JP_SCALE
    y = JP_ORIGIN_Y + (JP_MERC_Y_MAX - merc_y(lat)) * JP_MERC_SCALE
    return round(x, 3), round(y, 3)


def fmt_num(v: float) -> str:
    """Format up to 3 decimal places without trailing zeros (exact round-trip to float)."""
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def ensure_topojson(path: Path) -> dict[str, Any]:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {DEFAULT_TOPO_URL} -> {path} ...")
        req = urllib.request.Request(
            DEFAULT_TOPO_URL,
            headers={"User-Agent": "municipality-game-topology-builder/1.0"},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            path.write_bytes(resp.read())
    return json.loads(path.read_text(encoding="utf-8"))


def decode_and_project_arcs(
    tj: dict[str, Any],
) -> tuple[list[list[tuple[float, float]]], list[tuple[tuple[int, int], tuple[int, int]]]]:
    """Decode every TopoJSON arc once and project it to canonical SVG coordinates.

    Returns:
      proj_arcs: canonical projected SVG coordinate sequence per arc (deduped only on
                 identical consecutive rounded points while preserving endpoints).
      quant_endpoints: exact integer (start_q, end_q) quantized TopoJSON endpoint pair
                       for rock-solid topological stitching.
    """
    sx, sy = tj["transform"]["scale"]
    tx, ty = tj["transform"]["translate"]

    proj_arcs: list[list[tuple[float, float]]] = []
    quant_endpoints: list[tuple[tuple[int, int], tuple[int, int]]] = []

    for arc in tj["arcs"]:
        qx = 0
        qy = 0
        q_pts: list[tuple[int, int]] = []
        raw_proj: list[tuple[float, float]] = []
        for dx, dy in arc:
            qx += dx
            qy += dy
            q_pts.append((qx, qy))
            lon = qx * sx + tx
            lat = qy * sy + ty
            raw_proj.append(project_jp_exact(lon, lat))

        # Remove consecutive identical projected points without ever dropping endpoints
        dedup: list[tuple[float, float]] = [raw_proj[0]]
        for pt in raw_proj[1:]:
            if pt != dedup[-1]:
                dedup.append(pt)
        if len(dedup) == 1 and len(raw_proj) >= 2:
            dedup.append(raw_proj[-1])

        proj_arcs.append(dedup)
        quant_endpoints.append((q_pts[0], q_pts[-1]))

    return proj_arcs, quant_endpoints


def get_directed_arc_pts(
    proj_arcs: list[list[tuple[float, float]]],
    arc_idx: int,
) -> list[tuple[float, float]]:
    if arc_idx >= 0:
        return proj_arcs[arc_idx]
    return list(reversed(proj_arcs[~arc_idx]))


def get_directed_quant_endpoints(
    quant_endpoints: list[tuple[tuple[int, int], tuple[int, int]]],
    arc_idx: int,
) -> tuple[tuple[int, int], tuple[int, int]]:
    if arc_idx >= 0:
        return quant_endpoints[arc_idx]
    s, e = quant_endpoints[~arc_idx]
    return e, s


def iter_geom_rings(geom: dict[str, Any]) -> list[list[int]]:
    """Return every ring (outer and hole) of a Polygon or MultiPolygon TopoJSON geometry."""
    gtype = geom.get("type")
    rings: list[list[int]] = []
    if gtype == "Polygon":
        for ring in geom["arcs"]:
            rings.append(ring)
    elif gtype == "MultiPolygon":
        for poly in geom["arcs"]:
            for ring in poly:
                rings.append(ring)
    return rings


def stitch_directed_arcs(
    arc_indices: list[int],
    proj_arcs: list[list[tuple[float, float]]],
    quant_endpoints: list[tuple[tuple[int, int], tuple[int, int]]],
) -> list[list[tuple[float, float]]]:
    """Stitch surviving directed arcs into simple closed planar rings.

    Uses quantized TopoJSON endpoints for exact junction matching and chooses
    the minimum-turn continuation at any vertex with degree >= 4 to prevent
    figure-8 self-crossings.
    """
    n = len(arc_indices)
    if n == 0:
        return []

    outgoing: dict[tuple[int, int], list[int]] = {}
    arc_ends: list[tuple[tuple[int, int], tuple[int, int]]] = []
    arc_pts_cache: list[list[tuple[float, float]]] = []

    for i, a in enumerate(arc_indices):
        s_q, e_q = get_directed_quant_endpoints(quant_endpoints, a)
        arc_ends.append((s_q, e_q))
        arc_pts_cache.append(get_directed_arc_pts(proj_arcs, a))
        outgoing.setdefault(s_q, []).append(i)

    used = [False] * n
    rings: list[list[tuple[float, float]]] = []

    def out_angle(pts: list[tuple[float, float]]) -> float:
        p0 = pts[0]
        for p in pts[1:]:
            if p != p0:
                return math.atan2(p[1] - p0[1], p[0] - p0[0])
        return 0.0

    def in_angle(pts: list[tuple[float, float]]) -> float:
        pn = pts[-1]
        for p in reversed(pts[:-1]):
            if p != pn:
                return math.atan2(p[1] - pn[1], p[0] - pn[0])
        return 0.0

    for start_i in range(n):
        if used[start_i]:
            continue
        used[start_i] = True
        start_q, cur_q = arc_ends[start_i]
        cur_pts = arc_pts_cache[start_i]
        ring: list[tuple[float, float]] = list(cur_pts)

        while cur_q != start_q:
            cands = [idx for idx in outgoing.get(cur_q, []) if not used[idx]]
            if not cands:
                raise RuntimeError(
                    f"Open boundary ring while stitching at quantized vertex {cur_q}"
                )
            if len(cands) == 1:
                nxt = cands[0]
            else:
                # Choose sharpest clockwise turn from incoming direction (standard planar face walk)
                back_dir = in_angle(cur_pts)
                best_idx = cands[0]
                best_turn = 1e9
                for idx in cands:
                    ang = out_angle(arc_pts_cache[idx])
                    turn = (ang - back_dir) % (2.0 * math.pi)
                    if turn < 1e-12:
                        turn = 2.0 * math.pi
                    if turn < best_turn:
                        best_turn = turn
                        best_idx = idx
                nxt = best_idx

            used[nxt] = True
            _, cur_q = arc_ends[nxt]
            cur_pts = arc_pts_cache[nxt]
            ring.extend(cur_pts[1:])

        # Drop redundant closing vertex if equal to start
        if len(ring) >= 2 and ring[-1] == ring[0]:
            ring.pop()

        if len(ring) >= 3:
            rings.append(ring)

    return rings


def build_rings_for_geoms(
    geoms: list[dict[str, Any]],
    proj_arcs: list[list[tuple[float, float]]],
    quant_endpoints: list[tuple[tuple[int, int], tuple[int, int]]],
) -> list[list[tuple[float, float]]]:
    """Build exact SVG rings for one or more TopoJSON geometries.

    - Single geometry: preserve exact outer & hole rings verbatim from canonical arcs.
    - Multiple geometries (e.g. dissolving all municipalities of a prefecture):
      cancel all shared +a / ~a directed arcs across BOTH outer and hole rings, then
      stitch remaining arcs into clean planar rings.
    """
    if len(geoms) == 1:
        rings: list[list[tuple[float, float]]] = []
        for arc_seq in iter_geom_rings(geoms[0]):
            ring: list[tuple[float, float]] = []
            for a in arc_seq:
                seg = get_directed_arc_pts(proj_arcs, a)
                ring.extend(seg if not ring else seg[1:])
            if len(ring) >= 2 and ring[-1] == ring[0]:
                ring.pop()
            if len(ring) >= 3:
                rings.append(ring)
        return rings

    # Full directed-arc cancellation across ALL rings (outer + holes)
    counts: dict[int, list[int]] = {}
    for g in geoms:
        for arc_seq in iter_geom_rings(g):
            for a in arc_seq:
                base = a if a >= 0 else ~a
                counts.setdefault(base, []).append(a)

    surviving: list[int] = []
    for base, occ in counts.items():
        pos = sum(1 for a in occ if a >= 0)
        neg = len(occ) - pos
        diff = pos - neg
        if diff > 0:
            surviving.extend([base] * diff)
        elif diff < 0:
            surviving.extend([~base] * (-diff))

    return stitch_directed_arcs(surviving, proj_arcs, quant_endpoints)


def ring_signed_area_and_centroid(pts: list[tuple[float, float]]) -> tuple[float, float, float]:
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
    if abs(area) < 1e-12:
        return 0.0, sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
    return area, cx / (3.0 * a2), cy / (3.0 * a2)


def rings_to_svg_and_stats(
    rings: list[list[tuple[float, float]]],
) -> tuple[str, list[float], list[float], float]:
    """Serialize exact rings to compact SVG d-path without dropping any vertex."""
    cmds: list[str] = []
    min_x = float("inf")
    min_y = float("inf")
    max_x = float("-inf")
    max_y = float("-inf")
    best_abs_area = -1.0
    best_center = [0.0, 0.0]
    net_area = 0.0

    for ring in rings:
        if len(ring) < 3:
            continue
        signed_area, cx, cy = ring_signed_area_and_centroid(ring)
        abs_area = abs(signed_area)
        net_area += signed_area
        if abs_area > best_abs_area:
            best_abs_area = abs_area
            best_center = [round(cx, 2), round(cy, 2)]
        for px, py in ring:
            if px < min_x:
                min_x = px
            if py < min_y:
                min_y = py
            if px > max_x:
                max_x = px
            if py > max_y:
                max_y = py

        parts = [f"M{fmt_num(ring[0][0])},{fmt_num(ring[0][1])}"]
        for px, py in ring[1:]:
            parts.append(f"L{fmt_num(px)},{fmt_num(py)}")
        parts.append("Z")
        cmds.append("".join(parts))

    if not cmds:
        return "", [0.0, 0.0, 0.0, 0.0], [0.0, 0.0], 0.0

    bbox = [round(min_x, 2), round(min_y, 2), round(max_x, 2), round(max_y, 2)]
    return "".join(cmds), bbox, best_center, round(abs(net_area), 2)


def extract_edges(path_d: str) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    edges: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for sub in path_d.split("M"):
        sub = sub.strip()
        if not sub:
            continue
        sub = sub.rstrip("Z")
        pts: list[tuple[float, float]] = []
        for tok in sub.split("L"):
            if "," in tok:
                xs, ys = tok.split(",")
                pts.append((float(xs), float(ys)))
        for i in range(len(pts)):
            a = pts[i]
            b = pts[(i + 1) % len(pts)]
            if a != b:
                edges.append((a, b))
    return edges


def verify_topology(
    muni_paths: dict[str, str],
    pref_paths: dict[str, str],
    muni_to_pref: dict[str, str],
) -> None:
    """Strictly verify 100.000% shared-edge topological consistency."""
    # 1. Municipality directed edge cancellation check
    muni_edge_owners: dict[tuple[tuple[float, float], tuple[float, float]], list[tuple[str, bool]]] = {}
    for code, d in muni_paths.items():
        for a, b in extract_edges(d):
            if a < b:
                key = (a, b)
                fwd = True
            else:
                key = (b, a)
                fwd = False
            muni_edge_owners.setdefault(key, []).append((code, fwd))

    same_dir_conflicts = 0
    over_used = 0
    cross_pref_muni_edges: set[tuple[tuple[float, float], tuple[float, float]]] = set()
    outer_coast_muni_edges: set[tuple[tuple[float, float], tuple[float, float]]] = set()
    same_pref_shared_edges = 0

    for key, owners in muni_edge_owners.items():
        if len(owners) == 1:
            outer_coast_muni_edges.add(key)
        elif len(owners) == 2:
            (c1, f1), (c2, f2) = owners
            if f1 == f2:
                same_dir_conflicts += 1
            if muni_to_pref[c1] == muni_to_pref[c2]:
                same_pref_shared_edges += 1
            else:
                cross_pref_muni_edges.add(key)
        else:
            over_used += 1

    # 2. Prefecture edge check vs dissolved municipality edges
    pref_edge_owners: dict[tuple[tuple[float, float], tuple[float, float]], list[tuple[str, bool]]] = {}
    for pcode, d in pref_paths.items():
        for a, b in extract_edges(d):
            if a < b:
                key = (a, b)
                fwd = True
            else:
                key = (b, a)
                fwd = False
            pref_edge_owners.setdefault(key, []).append((pcode, fwd))

    pref_keys = set(pref_edge_owners.keys())
    expected_pref_keys = cross_pref_muni_edges | outer_coast_muni_edges

    missing_in_pref = expected_pref_keys - pref_keys
    extra_in_pref = pref_keys - expected_pref_keys
    pref_same_dir_conflicts = sum(
        1 for owners in pref_edge_owners.values() if len(owners) == 2 and owners[0][1] == owners[1][1]
    )
    pref_shared_exact = sum(
        1 for owners in pref_edge_owners.values() if len(owners) == 2 and owners[0][0] != owners[1][0]
    )
    pref_matching_muni = len(pref_keys & set(muni_edge_owners.keys()))

    print("=== TOPOLOGY VERIFICATION REPORT ===")
    print(f"Municipalities: {len(muni_paths)}, Prefectures: {len(pref_paths)}")
    print(
        f"Muni edges: same-pref shared={same_pref_shared_edges}, "
        f"cross-pref shared={len(cross_pref_muni_edges)}, "
        f"coast/lake outer={len(outer_coast_muni_edges)}"
    )
    print(
        f"Muni topology defects: same_dir_conflicts={same_dir_conflicts}, over_used(>2)={over_used}"
    )
    print(
        f"Pref edges: total unique={len(pref_keys)}, "
        f"exact inter-pref shared={pref_shared_exact}, "
        f"matching muni edges={pref_matching_muni}/{len(pref_keys)} "
        f"({pref_matching_muni / max(1, len(pref_keys)) * 100:.4f}%)"
    )
    print(
        f"Pref vs dissolved-muni diff: missing={len(missing_in_pref)}, "
        f"extra={len(extra_in_pref)}, pref_same_dir_conflicts={pref_same_dir_conflicts}"
    )

    assert same_dir_conflicts == 0, f"Found {same_dir_conflicts} same-direction municipality edge conflicts!"
    assert over_used == 0, f"Found {over_used} edges used >2 times across municipalities!"
    assert pref_same_dir_conflicts == 0, f"Found {pref_same_dir_conflicts} same-direction prefecture edge conflicts!"
    assert len(missing_in_pref) == 0 and len(extra_in_pref) == 0, (
        f"Prefecture boundary mismatch vs municipalities: missing={len(missing_in_pref)}, extra={len(extra_in_pref)}"
    )
    assert pref_shared_exact == len(cross_pref_muni_edges), (
        f"Inter-prefecture shared edges ({pref_shared_exact}) != cross-pref muni edges ({len(cross_pref_muni_edges)})"
    )
    print("PASS: 100.0000% bit-for-bit topological consistency verified across all 47 prefectures and 1,747 municipalities!")


def main() -> None:
    tj = ensure_topojson(DEFAULT_TOPO_CACHE)
    obj_name = list(tj["objects"].keys())[0]
    geoms = tj["objects"][obj_name]["geometries"]

    proj_arcs, quant_endpoints = decode_and_project_arcs(tj)
    print(f"Decoded & projected {len(proj_arcs)} canonical TopoJSON arcs ({sum(len(a) for a in proj_arcs)} vertices).")

    # Load existing metadata to preserve 100% of attributes verbatim
    existing_prefs_doc = json.loads((DATA_DIR / "japan_prefs.json").read_text(encoding="utf-8"))
    existing_munis: list[dict[str, Any]] = json.loads(
        (DATA_DIR / "muni" / "index.json").read_text(encoding="utf-8")
    )

    # Index TopoJSON geometries by normalized 5-digit code (Nakagawa 40231 -> 40305)
    geoms_by_code: dict[str, list[dict[str, Any]]] = {}
    skipped_unassigned = 0
    for g in geoms:
        raw_c = str(g.get("properties", {}).get("N03_007") or "").strip()
        if not raw_c:
            skipped_unassigned += 1
            continue
        code = raw_c.zfill(5)
        if code == "40231":
            code = "40305"
        geoms_by_code.setdefault(code, []).append(g)

    print(f"Indexed {len(geoms_by_code)} municipality codes (skipped {skipped_unassigned} unassigned sea-edge polygons).")

    # 1. Build all 1,747 municipalities from canonical arcs
    muni_paths: dict[str, str] = {}
    muni_out: list[dict[str, Any]] = []
    muni_to_pref: dict[str, str] = {}
    pref_muni_geoms: dict[str, list[dict[str, Any]]] = {}

    for row in existing_munis:
        code = row["code"]
        pcode = row["prefCode"]
        muni_to_pref[code] = pcode
        g_list = geoms_by_code.get(code)
        if not g_list:
            raise RuntimeError(f"Missing TopoJSON geometry for municipality {code} ({row['name']})")
        pref_muni_geoms.setdefault(pcode, []).extend(g_list)

        rings = build_rings_for_geoms(g_list, proj_arcs, quant_endpoints)
        d_str, bbox, center, area_px = rings_to_svg_and_stats(rings)
        if not d_str:
            raise RuntimeError(f"Empty SVG path for municipality {code} ({row['name']})")

        muni_paths[code] = d_str
        updated = dict(row)
        updated["bbox"] = bbox
        updated["center"] = center
        updated["areaPx"] = area_px
        muni_out.append(updated)

    # 2. Dissolve all 47 prefectures directly from the exact same municipality geometries & arcs
    muni_by_pref_and_name = {(m["prefCode"], m["name"]): m for m in muni_out}
    pref_paths: dict[str, str] = {}
    pref_out: list[dict[str, Any]] = []

    for pref in existing_prefs_doc["prefs"]:
        pcode = pref["code"]
        g_list = pref_muni_geoms.get(pcode, [])
        if not g_list:
            raise RuntimeError(f"Missing municipality geometries for prefecture {pcode} ({pref['name']})")

        rings = build_rings_for_geoms(g_list, proj_arcs, quant_endpoints)
        d_str, bbox, center, area_px = rings_to_svg_and_stats(rings)
        if not d_str:
            raise RuntimeError(f"Empty SVG path for prefecture {pcode} ({pref['name']})")

        pref_paths[pcode] = d_str
        cap_muni = muni_by_pref_and_name.get((pcode, pref["capital"]))
        cap_center = cap_muni["center"] if cap_muni else center

        main_munis = [
            m for m in muni_out
            if m["prefCode"] == pcode and not (pcode == "13" and m["code"] >= "13360")
        ]
        if main_munis:
            bbox_main = [
                round(min(m["bbox"][0] for m in main_munis), 2),
                round(min(m["bbox"][1] for m in main_munis), 2),
                round(max(m["bbox"][2] for m in main_munis), 2),
                round(max(m["bbox"][3] for m in main_munis), 2),
            ]
        else:
            bbox_main = bbox

        updated = dict(pref)
        updated["bbox"] = bbox
        updated["bboxMain"] = bbox_main
        updated["center"] = center
        updated["capitalCenter"] = cap_center
        updated["areaPx"] = area_px
        updated["muniCount"] = sum(1 for m in muni_out if m["prefCode"] == pcode)
        pref_out.append(updated)

    # 3. Run strict mathematical topology verification BEFORE writing outputs
    verify_topology(muni_paths, pref_paths, muni_to_pref)

    # 4. Write rebuilt JSON files
    out_prefs = DATA_DIR / "japan_prefs.json"
    out_muni_idx = DATA_DIR / "muni" / "index.json"
    out_muni_paths = DATA_DIR / "muni" / "all_paths.json"

    out_prefs.write_text(
        json.dumps({"prefs": pref_out, "paths": pref_paths}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    out_muni_idx.write_text(
        json.dumps(muni_out, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    out_muni_paths.write_text(
        json.dumps(muni_paths, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    for p in (out_prefs, out_muni_idx, out_muni_paths):
        print(f"Wrote {p.relative_to(ROOT_DIR)}: {p.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
