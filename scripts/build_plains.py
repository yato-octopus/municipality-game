#!/usr/bin/env python3
"""Build geographically accurate, DEM-derived, land-clipped polygons for all 17 Japanese plains.

Data sources:
- Elevation: GSI (Geospatial Information Authority of Japan) DEM PNG tiles
  https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png (zoom 9, ~275 m/px)
  with AWS Mapzen Terrarium fallback if a GSI tile is unavailable.
- Coastline & Land Mask: public/data/japan_prefs.json (exact Japan Mercator SVG space).

Outputs:
- scripts/geo_sources/plains.json
"""

from __future__ import annotations

import collections
import concurrent.futures
import json
import math
import os
import struct
import tempfile
import urllib.error
import urllib.request
import zlib
from pathlib import Path
from typing import Any, Callable

# ---------------------------------------------------------------------------
# Exact Japan Mercator projection (MUST match scripts/build_map_data.py)
# ---------------------------------------------------------------------------
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


def project_jp_exact(lon: float, lat: float) -> tuple[float, float]:
    x = JP_ORIGIN_X + (lon - JP_REF_LON_MIN) * JP_SCALE
    y = JP_ORIGIN_Y + (JP_MERC_Y_MAX - merc_y(lat)) * JP_MERC_SCALE
    return x, y


def inv_project_jp(x: float, y: float) -> tuple[float, float]:
    lon = JP_REF_LON_MIN + (x - JP_ORIGIN_X) / JP_SCALE
    my = JP_MERC_Y_MAX - (y - JP_ORIGIN_Y) / JP_MERC_SCALE
    lat = math.degrees(2.0 * math.atan(math.exp(my)) - math.pi / 2.0)
    return lon, lat


# ---------------------------------------------------------------------------
# Paths & tile cache
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
PREFS_PATH = REPO_ROOT / "public" / "data" / "japan_prefs.json"
GEO_100_PATH = REPO_ROOT / "public" / "data" / "geography_100.json"
OUT_PATH = REPO_ROOT / "scripts" / "geo_sources" / "plains.json"
TILE_CACHE_DIR = Path(tempfile.gettempdir()) / "municipality_game_gsi_dem_cache"

ZOOM = 9  # 1 pixel = 0.115 SVG px (~275m ground resolution)
TILE_SIZE = 256
WORLD_PX = TILE_SIZE * (1 << ZOOM)
SVG_PER_DEM_PX = (360.0 * JP_SCALE) / WORLD_PX


def global_px_to_svg(gx: float, gy: float) -> tuple[float, float]:
    """Convert global Web Mercator pixel coordinate (at ZOOM) directly to Japan SVG space."""
    lon = (gx / WORLD_PX) * 360.0 - 180.0
    my = math.pi - 2.0 * math.pi * (gy / WORLD_PX)
    x = JP_ORIGIN_X + (lon - JP_REF_LON_MIN) * JP_SCALE
    y = JP_ORIGIN_Y + (JP_MERC_Y_MAX - my) * JP_MERC_SCALE
    return x, y


def svg_to_global_px(x: float, y: float) -> tuple[float, float]:
    lon = JP_REF_LON_MIN + (x - JP_ORIGIN_X) / JP_SCALE
    my = JP_MERC_Y_MAX - (y - JP_ORIGIN_Y) / JP_MERC_SCALE
    gx = ((lon + 180.0) / 360.0) * WORLD_PX
    gy = ((math.pi - my) / (2.0 * math.pi)) * WORLD_PX
    return gx, gy


def lonlat_to_global_px(lon: float, lat: float) -> tuple[float, float]:
    gx = ((lon + 180.0) / 360.0) * WORLD_PX
    gy = ((math.pi - merc_y(lat)) / (2.0 * math.pi)) * WORLD_PX
    return gx, gy


# ---------------------------------------------------------------------------
# Pure-Python PNG decoder + GSI DEM tile fetcher
# ---------------------------------------------------------------------------
def decode_png_rgb(data: bytes) -> tuple[int, int, int, bytearray]:
    """Decode an 8-bit non-interlaced RGB/RGBA PNG without external libraries."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Not a PNG")
    pos = 8
    idat = bytearray()
    w = h = ct = 0
    while pos < len(data):
        ln, ctype = struct.unpack(">I4s", data[pos : pos + 8])
        cdata = data[pos + 8 : pos + 8 + ln]
        if ctype == b"IHDR":
            w, h, bd, ct, _comp, _flt, il = struct.unpack(">IIBBBBB", cdata)
            if bd != 8 or ct not in (2, 6) or il != 0:
                raise ValueError(f"Unsupported PNG format: bd={bd} ct={ct} il={il}")
        elif ctype == b"IDAT":
            idat.extend(cdata)
        elif ctype == b"IEND":
            break
        pos += 12 + ln

    bpp = 3 if ct == 2 else 4
    raw = zlib.decompress(bytes(idat))
    stride = w * bpp
    out = bytearray(w * h * bpp)
    mv = memoryview(raw)
    for y in range(h):
        row_start = y * (stride + 1)
        ftype = raw[row_start]
        row_in = mv[row_start + 1 : row_start + 1 + stride]
        row_out = y * stride
        prev_out = (y - 1) * stride
        if ftype == 0:
            out[row_out : row_out + stride] = row_in
        elif ftype == 1:
            for i in range(bpp):
                out[row_out + i] = row_in[i]
            for i in range(bpp, stride):
                out[row_out + i] = (row_in[i] + out[row_out + i - bpp]) & 0xFF
        elif ftype == 2:
            if y == 0:
                out[row_out : row_out + stride] = row_in
            else:
                for i in range(stride):
                    out[row_out + i] = (row_in[i] + out[prev_out + i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                a = out[row_out + i - bpp] if i >= bpp else 0
                b = out[prev_out + i] if y > 0 else 0
                out[row_out + i] = (row_in[i] + ((a + b) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                a = out[row_out + i - bpp] if i >= bpp else 0
                b = out[prev_out + i] if y > 0 else 0
                c = out[prev_out + i - bpp] if (y > 0 and i >= bpp) else 0
                p = a + b - c
                pa = abs(p - a)
                pb = abs(p - b)
                pc = abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                out[row_out + i] = (row_in[i] + pr) & 0xFF
        else:
            raise ValueError(f"Unknown PNG filter {ftype}")
    return w, h, bpp, out


def fetch_gsi_tile_elev(tx: int, ty: int, z: int = ZOOM) -> list[float | None]:
    """Return 256*256 elevation values in meters (None for NODATA/ocean)."""
    cache_dir = TILE_CACHE_DIR / f"gsi_z{z}"
    cache_dir.mkdir(parents=True, exist_ok=True)
    png_path = cache_dir / f"{tx}_{ty}.png"
    nodata_marker = cache_dir / f"{tx}_{ty}.404"

    if nodata_marker.exists():
        return [None] * (TILE_SIZE * TILE_SIZE)

    if png_path.exists():
        data = png_path.read_bytes()
    else:
        url = f"https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{tx}/{ty}.png"
        req = urllib.request.Request(url, headers={"User-Agent": "municipality-game-geo/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
            png_path.write_bytes(data)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                nodata_marker.write_text("404")
                return [None] * (TILE_SIZE * TILE_SIZE)
            raise

    w, h, bpp, buf = decode_png_rgb(data)
    elevs: list[float | None] = [None] * (w * h)
    idx = 0
    for p in range(w * h):
        r = buf[idx]
        g = buf[idx + 1]
        b = buf[idx + 2]
        idx += bpp
        x = (r << 16) | (g << 8) | b
        if x != 8388608:
            elevs[p] = (x if x < 8388608 else x - 16777216) * 0.01
    return elevs


# ---------------------------------------------------------------------------
# SVG path parsing, scanline rasterization & exact vector point-in-polygon
# ---------------------------------------------------------------------------
def parse_svg_path_rings(d: str) -> list[list[tuple[float, float]]]:
    rings: list[list[tuple[float, float]]] = []
    for sub in d.split("M"):
        sub = sub.strip()
        if not sub:
            continue
        sub = sub.replace("Z", "").replace("z", "").strip()
        pts: list[tuple[float, float]] = []
        for tok in sub.split("L"):
            tok = tok.strip()
            if not tok:
                continue
            sx, sy = tok.split(",")
            pts.append((float(sx), float(sy)))
        if len(pts) >= 3:
            if pts[0] == pts[-1]:
                pts = pts[:-1]
            if len(pts) >= 3:
                rings.append(pts)
    return rings


def ring_bbox(ring: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def ring_signed_area(ring: list[tuple[float, float]]) -> float:
    n = len(ring)
    if n < 3:
        return 0.0
    a2 = 0.0
    x0, y0 = ring[-1]
    for x1, y1 in ring:
        a2 += x0 * y1 - x1 * y0
        x0, y0 = x1, y1
    return 0.5 * a2


def pip_ring(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    x0, y0 = ring[-1]
    for x1, y1 in ring:
        if (y1 > y) != (y0 > y):
            if x < (x0 - x1) * (y - y1) / (y0 - y1) + x1:
                inside = not inside
        x0, y0 = x1, y1
    return inside


class JapanLandIndex:
    """Exact vector point-in-land and scanline rasterizer for public/data/japan_prefs.json."""

    def __init__(self, prefs_json: dict[str, Any]) -> None:
        self.pref_names: dict[str, str] = {p["code"]: p["name"] for p in prefs_json["prefs"]}
        self.pref_rings: dict[str, list[tuple[tuple[float, float, float, float], list[tuple[float, float]]]]] = {}
        self.pref_bboxes: dict[str, tuple[float, float, float, float]] = {}

        for code, d in prefs_json["paths"].items():
            rings = parse_svg_path_rings(d)
            packed = [(ring_bbox(r), r) for r in rings]
            self.pref_rings[code] = packed
            if packed:
                minx = min(b[0] for b, _ in packed)
                miny = min(b[1] for b, _ in packed)
                maxx = max(b[2] for b, _ in packed)
                maxy = max(b[3] for b, _ in packed)
                self.pref_bboxes[code] = (minx, miny, maxx, maxy)

    def prefs_in_bbox(self, bbox: tuple[float, float, float, float]) -> list[str]:
        x0, y0, x1, y1 = bbox
        out = []
        for code, (px0, py0, px1, py1) in self.pref_bboxes.items():
            if px1 >= x0 and px0 <= x1 and py1 >= y0 and py0 <= y1:
                out.append(code)
        return out

    def pref_at(self, x: float, y: float, candidates: list[str] | None = None) -> str | None:
        codes = candidates if candidates is not None else list(self.pref_rings.keys())
        for code in codes:
            px0, py0, px1, py1 = self.pref_bboxes[code]
            if x < px0 or x > px1 or y < py0 or y > py1:
                continue
            cnt = 0
            for (rx0, ry0, rx1, ry1), ring in self.pref_rings[code]:
                if x < rx0 or x > rx1 or y < ry0 or y > ry1:
                    continue
                if pip_ring(x, y, ring):
                    cnt += 1
            if cnt % 2 == 1:
                return code
        return None

    def is_land(self, x: float, y: float, candidates: list[str] | None = None) -> bool:
        return self.pref_at(x, y, candidates) is not None

    def rasterize_land_mask(
        self,
        gx0: int,
        gy0: int,
        width: int,
        height: int,
        allowed_prefs: list[str] | None = None,
    ) -> bytearray:
        """Exact even-odd scanline fill of Japan land onto [gx0..gx0+width, gy0..gy0+height)."""
        svg_x0, svg_y0 = global_px_to_svg(gx0, gy0)
        svg_x1, svg_y1 = global_px_to_svg(gx0 + width, gy0 + height)
        roi_bbox = (min(svg_x0, svg_x1), min(svg_y0, svg_y1), max(svg_x0, svg_x1), max(svg_y0, svg_y1))
        codes = allowed_prefs if allowed_prefs is not None else self.prefs_in_bbox(roi_bbox)

        mask = bytearray(width * height)
        for code in codes:
            px0, py0, px1, py1 = self.pref_bboxes[code]
            if px1 < roi_bbox[0] or px0 > roi_bbox[2] or py1 < roi_bbox[1] or py0 > roi_bbox[3]:
                continue
            # Convert prefecture rings into local pixel coordinates (0..width, 0..height)
            local_edges: list[tuple[float, float, float, float]] = []
            for (rx0, ry0, rx1, ry1), ring in self.pref_rings[code]:
                if rx1 < roi_bbox[0] or rx0 > roi_bbox[2] or ry1 < roi_bbox[1] or ry0 > roi_bbox[3]:
                    continue
                lpts = []
                for sx, sy in ring:
                    gx, gy = svg_to_global_px(sx, sy)
                    lpts.append((gx - gx0, gy - gy0))
                x_prev, y_prev = lpts[-1]
                for x_cur, y_cur in lpts:
                    if y_prev != y_cur:
                        if y_prev < y_cur:
                            local_edges.append((y_prev, y_cur, x_prev, (x_cur - x_prev) / (y_cur - y_prev)))
                        else:
                            local_edges.append((y_cur, y_prev, x_cur, (x_prev - x_cur) / (y_prev - y_cur)))
                    x_prev, y_prev = x_cur, y_cur

            if not local_edges:
                continue

            for row in range(height):
                yf = row + 0.5
                xs_cross: list[float] = []
                for y_lo, y_hi, x_lo, inv_m in local_edges:
                    if y_lo <= yf < y_hi:
                        xs_cross.append(x_lo + (yf - y_lo) * inv_m)
                if not xs_cross:
                    continue
                xs_cross.sort()
                row_off = row * width
                for i in range(0, len(xs_cross) - 1, 2):
                    c0 = max(0, int(math.ceil(xs_cross[i] - 0.5)))
                    c1 = min(width, int(math.floor(xs_cross[i + 1] - 0.5)) + 1)
                    if c0 < c1:
                        mask[row_off + c0 : row_off + c1] = b"\x01" * (c1 - c0)
        return mask


# ---------------------------------------------------------------------------
# Binary raster operations (pure Python, fast on local ROI grids)
# ---------------------------------------------------------------------------
def dilate_disk(mask: bytearray, w: int, h: int, radius: int) -> bytearray:
    if radius <= 0:
        return bytearray(mask)
    offsets = [
        (dx, dy)
        for dy in range(-radius, radius + 1)
        for dx in range(-radius, radius + 1)
        if dx * dx + dy * dy <= radius * radius + 0.25
    ]
    out = bytearray(w * h)
    for y in range(h):
        row = y * w
        for x in range(w):
            if mask[row + x]:
                for dx, dy in offsets:
                    nx = x + dx
                    ny = y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        out[ny * w + nx] = 1
    return out


def erode_disk(mask: bytearray, w: int, h: int, radius: int) -> bytearray:
    if radius <= 0:
        return bytearray(mask)
    offsets = [
        (dx, dy)
        for dy in range(-radius, radius + 1)
        for dx in range(-radius, radius + 1)
        if dx * dx + dy * dy <= radius * radius + 0.25
    ]
    out = bytearray(w * h)
    for y in range(radius, h - radius):
        row = y * w
        for x in range(radius, w - radius):
            if not mask[row + x]:
                continue
            ok = True
            for dx, dy in offsets:
                if not mask[(y + dy) * w + (x + dx)]:
                    ok = False
                    break
            if ok:
                out[row + x] = 1
    return out


def erode_cross1(mask: bytearray, w: int, h: int) -> bytearray:
    """1-pixel 4-neighbor erosion (~0.115 SVG px): trims port-pier spikes & ensures 0% ocean spill."""
    out = bytearray(w * h)
    for y in range(1, h - 1):
        row = y * w
        for x in range(1, w - 1):
            idx = row + x
            if (
                mask[idx]
                and mask[idx - 1]
                and mask[idx + 1]
                and mask[idx - w]
                and mask[idx + w]
            ):
                out[idx] = 1
    return out


def morph_open(mask: bytearray, w: int, h: int, radius: int) -> bytearray:
    if radius <= 0:
        return bytearray(mask)
    return dilate_disk(erode_disk(mask, w, h, radius), w, h, radius)


def morph_close(mask: bytearray, w: int, h: int, radius: int) -> bytearray:
    if radius <= 0:
        return bytearray(mask)
    return erode_disk(dilate_disk(mask, w, h, radius), w, h, radius)


def flood_fill_from_seeds(
    mask: bytearray,
    w: int,
    h: int,
    seeds_px: list[tuple[int, int]],
    search_radius: int = 8,
) -> bytearray:
    out = bytearray(w * h)
    q: collections.deque[int] = collections.deque()

    for sx, sy in seeds_px:
        start = None
        if 0 <= sx < w and 0 <= sy < h and mask[sy * w + sx]:
            start = (sx, sy)
        else:
            # Find nearest active pixel within search_radius
            best_d2 = 10**9
            for r in range(1, search_radius + 1):
                for dy in range(-r, r + 1):
                    for dx in range(-r, r + 1):
                        nx, ny = sx + dx, sy + dy
                        if 0 <= nx < w and 0 <= ny < h and mask[ny * w + nx]:
                            d2 = dx * dx + dy * dy
                            if d2 < best_d2:
                                best_d2 = d2
                                start = (nx, ny)
                if start is not None:
                    break
        if start is None:
            raise RuntimeError(f"Seed ({sx}, {sy}) did not hit active mask!")
        idx = start[1] * w + start[0]
        if not out[idx]:
            out[idx] = 1
            q.append(idx)

    while q:
        idx = q.popleft()
        x = idx % w
        y = idx // w
        if x > 0 and mask[idx - 1] and not out[idx - 1]:
            out[idx - 1] = 1
            q.append(idx - 1)
        if x + 1 < w and mask[idx + 1] and not out[idx + 1]:
            out[idx + 1] = 1
            q.append(idx + 1)
        if y > 0 and mask[idx - w] and not out[idx - w]:
            out[idx - w] = 1
            q.append(idx - w)
        if y + 1 < h and mask[idx + w] and not out[idx + w]:
            out[idx + w] = 1
            q.append(idx + w)
    return out


def fill_small_holes(
    mask: bytearray,
    land_mask: bytearray,
    w: int,
    h: int,
    max_hole_px: int,
) -> bytearray:
    """Fill interior holes smaller than max_hole_px, NEVER filling ocean pixels outside land_mask."""
    visited = bytearray(w * h)
    out = bytearray(mask)
    q: collections.deque[int] = collections.deque()

    # Mark exterior background (reachable from border of grid)
    for x in range(w):
        for y in (0, h - 1):
            idx = y * w + x
            if not out[idx] and not visited[idx]:
                visited[idx] = 1
                q.append(idx)
    for y in range(h):
        for x in (0, w - 1):
            idx = y * w + x
            if not out[idx] and not visited[idx]:
                visited[idx] = 1
                q.append(idx)

    while q:
        idx = q.popleft()
        x = idx % w
        y = idx // w
        for nidx in (
            idx - 1 if x > 0 else -1,
            idx + 1 if x + 1 < w else -1,
            idx - w if y > 0 else -1,
            idx + w if y + 1 < h else -1,
        ):
            if nidx >= 0 and not out[nidx] and not visited[nidx]:
                visited[nidx] = 1
                q.append(nidx)

    # Any remaining unvisited 0-pixel is an interior hole
    for start in range(w * h):
        if out[start] or visited[start]:
            continue
        comp: list[int] = []
        touches_ocean = False
        visited[start] = 1
        q.append(start)
        while q:
            idx = q.popleft()
            comp.append(idx)
            if not land_mask[idx]:
                touches_ocean = True
            x = idx % w
            y = idx // w
            for nidx in (
                idx - 1 if x > 0 else -1,
                idx + 1 if x + 1 < w else -1,
                idx - w if y > 0 else -1,
                idx + w if y + 1 < h else -1,
            ):
                if nidx >= 0 and not out[nidx] and not visited[nidx]:
                    visited[nidx] = 1
                    q.append(nidx)
        # Never fill holes that contain ocean water; fill small land-only hillock holes
        if (not touches_ocean) and len(comp) <= max_hole_px:
            for idx in comp:
                out[idx] = 1
    return out


# ---------------------------------------------------------------------------
# Marching Squares contour extraction (clean closed outer & hole rings)
# ---------------------------------------------------------------------------
def extract_contours_marching_squares(
    mask: bytearray,
    w: int,
    h: int,
    gx0: int,
    gy0: int,
) -> list[list[tuple[float, float]]]:
    """Extract closed contour rings from binary mask using Marching Squares.

    Pixel centers are at (x + 0.5, y + 0.5). Each 2x2 cell spans
    (x+0.5, y+0.5) .. (x+1.5, y+1.5). Edge midpoints are quantized to exact
    half-integer grid coordinates (scaled by 2 -> integer keys) so segments stitch
    deterministically into closed loops with zero floating-point ambiguity.
    """
    # Pad mask with 1-pixel border of zeros so contours always close inside grid
    pw = w + 2
    ph = h + 2
    pm = bytearray(pw * ph)
    for y in range(h):
        pm[(y + 1) * pw + 1 : (y + 1) * pw + 1 + w] = mask[y * w : (y + 1) * w]

    # Directed segments: keeping foreground (1) on the LEFT side of directed edge
    # Vertices in 2x integer pixel space:
    # cell (x, y) has corners TL=(x,y), TR=(x+1,y), BR=(x+1,y+1), BL=(x,y+1) in padded coords
    # where padded (px, py) corresponds to original pixel center (px - 0.5, py - 0.5).
    # In 2x coords: pixel center (px - 0.5, py - 0.5) -> (2*px - 1, 2*py - 1).
    # Midpoints of cell edges:
    #   top    (T): (2*x,     2*y - 1)
    #   right  (R): (2*x + 1, 2*y)
    #   bottom (B): (2*x,     2*y + 1)
    #   left   (L): (2*x - 1, 2*y)
    # Bit encoding: TL=8, TR=4, BR=2, BL=1
    # Consistent orientation: inside (1) on LEFT of directed segment (in screen coords y-down,
    # outer loops run clockwise, holes run counter-clockwise).
    CASE_SEGS: dict[int, list[tuple[str, str]]] = {
        0: [],
        1: [("B", "L")],
        2: [("R", "B")],
        3: [("R", "L")],
        4: [("T", "R")],
        5: [("T", "L"), ("B", "R")],  # saddle: connect 0s (or separate 1s)
        6: [("T", "B")],
        7: [("T", "L")],
        8: [("L", "T")],
        9: [("B", "T")],
        10: [("L", "B"), ("R", "T")],  # saddle: separate 1s
        11: [("R", "T")],
        12: [("L", "R")],
        13: [("B", "R")],
        14: [("L", "B")],
        15: [],
    }

    adj: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for y in range(ph - 1):
        row0 = y * pw
        row1 = (y + 1) * pw
        for x in range(pw - 1):
            code = (
                (pm[row0 + x] << 3)
                | (pm[row0 + x + 1] << 2)
                | (pm[row1 + x + 1] << 1)
                | pm[row1 + x]
            )
            if code == 0 or code == 15:
                continue
            pts_map = {
                "T": (2 * x, 2 * y - 1),
                "R": (2 * x + 1, 2 * y),
                "B": (2 * x, 2 * y + 1),
                "L": (2 * x - 1, 2 * y),
            }
            for s, e in CASE_SEGS[code]:
                ps = pts_map[s]
                pe = pts_map[e]
                adj.setdefault(ps, []).append(pe)

    rings_svg: list[list[tuple[float, float]]] = []
    while adj:
        start = next(iter(adj))
        ring_2x: list[tuple[int, int]] = [start]
        cur = start
        while True:
            nxts = adj.get(cur)
            if not nxts:
                break
            nxt = nxts.pop()
            if not nxts:
                del adj[cur]
            if nxt == start:
                break
            ring_2x.append(nxt)
            cur = nxt

        if len(ring_2x) < 4:
            continue

        # Remove collinear redundant points on grid before converting to SVG space
        cleaned: list[tuple[int, int]] = []
        n = len(ring_2x)
        for i in range(n):
            p0 = ring_2x[i - 1]
            p1 = ring_2x[i]
            p2 = ring_2x[(i + 1) % n]
            if (p1[0] - p0[0]) * (p2[1] - p1[1]) != (p1[1] - p0[1]) * (p2[0] - p1[0]):
                cleaned.append(p1)

        if len(cleaned) < 3:
            continue

        svg_ring: list[tuple[float, float]] = []
        for x2, y2 in cleaned:
            # Map back from 2x padded coords to global pixel space
            gx = gx0 + x2 * 0.5
            gy = gy0 + y2 * 0.5
            svg_ring.append(global_px_to_svg(gx, gy))
        rings_svg.append(svg_ring)

    return rings_svg


# ---------------------------------------------------------------------------
# Land-safe simplification & exact polygon verification
# ---------------------------------------------------------------------------
def point_seg_dist(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx = bx - ax
    dy = by - ay
    len2 = dx * dx + dy * dy
    if len2 < 1e-12:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def chord_on_land(
    a: tuple[float, float],
    b: tuple[float, float],
    land_idx: JapanLandIndex,
    pref_cands: list[str],
    step_px: float = 0.14,
) -> bool:
    dist = math.hypot(b[0] - a[0], b[1] - a[1])
    if dist < step_px:
        return True
    n_samples = max(2, int(math.ceil(dist / step_px)))
    for k in range(1, n_samples):
        t = k / n_samples
        mx = a[0] + (b[0] - a[0]) * t
        my = a[1] + (b[1] - a[1]) * t
        if not land_idx.is_land(mx, my, pref_cands):
            return False
    return True


def simplify_ring_land_safe(
    ring: list[tuple[float, float]],
    eps: float,
    land_idx: JapanLandIndex,
    pref_cands: list[str],
) -> list[tuple[float, float]]:
    """Douglas-Peucker simplification on a closed ring that NEVER lets a chord spill into ocean."""
    n = len(ring)
    if n <= 4:
        return ring

    # Find pair of antipodal/farthest vertices to split closed ring cleanly into 2 chains
    p0 = ring[0]
    far_idx = max(range(1, n), key=lambda i: (ring[i][0] - p0[0]) ** 2 + (ring[i][1] - p0[1]) ** 2)

    def dp_chain(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
        m = len(pts)
        if m <= 2:
            return pts
        a, b = pts[0], pts[-1]
        best_i = 0
        best_d = -1.0
        for i in range(1, m - 1):
            d = point_seg_dist(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1])
            if d > best_d:
                best_d = d
                best_i = i
        if best_d <= eps and chord_on_land(a, b, land_idx, pref_cands):
            return [a, b]
        # Must split at worst deviation vertex (or midpoint if collinear chord crossed water)
        split_i = best_i if best_d > 1e-6 else (m // 2)
        left = dp_chain(pts[: split_i + 1])
        right = dp_chain(pts[split_i:])
        return left[:-1] + right

    chain1 = dp_chain(ring[: far_idx + 1])
    chain2 = dp_chain(ring[far_idx:] + [ring[0]])
    res = chain1[:-1] + chain2[:-1]
    return res


def nudge_ring_inside_land(
    ring: list[tuple[float, float]],
    land_idx: JapanLandIndex,
    pref_cands: list[str],
    is_outer: bool,
) -> list[tuple[float, float]]:
    """Ensure every rounded 2-decimal vertex lies strictly inside Japan land (avoiding 0.01px rounding spill)."""
    n = len(ring)
    out: list[tuple[float, float]] = []
    # Orientation: outer rings have positive or negative area depending on y-axis;
    # determine inward normal direction via signed area
    area = ring_signed_area(ring)
    # In screen coords (y-down): clockwise ring has area < 0? Wait:
    # (0,0)->(1,0)->(1,1)->(0,1): cross = 0*0-1*0 + 1*1-1*0 + 1*1-0*1 + 0*0-0*1 = +2 > 0!
    # So CW in y-down has area > 0, and interior is to the RIGHT of edge (i -> i+1): (-dy, +dx)!
    #Wait: for (0,0)->(1,0), dx=1, dy=0 -> interior is y > 0 -> (-dy, +dx) = (0, +1)! YES!
    sign = 1.0 if area > 0 else -1.0
    if not is_outer:
        # Hole ring: interior of land is OUTSIDE the hole (same side as outer interior)
        # Keep hole vertices on land too!
        sign = -sign

    for i in range(n):
        rx = round(ring[i][0], 2)
        ry = round(ring[i][1], 2)
        if land_idx.is_land(rx, ry, pref_cands):
            out.append((rx, ry))
            continue
        # Try nudging inward along bisector and 8 compass directions
        p_prev = ring[i - 1]
        p_next = ring[(i + 1) % n]
        dx1, dy1 = ring[i][0] - p_prev[0], ring[i][1] - p_prev[1]
        dx2, dy2 = p_next[0] - ring[i][0], p_next[1] - ring[i][1]
        l1 = math.hypot(dx1, dy1) or 1.0
        l2 = math.hypot(dx2, dy2) or 1.0
        nx = sign * (-dy1 / l1 - dy2 / l2)
        ny = sign * (dx1 / l1 + dx2 / l2)
        nl = math.hypot(nx, ny)
        if nl > 1e-6:
            nx /= nl
            ny /= nl
        else:
            nx, ny = 0.0, 0.0

        found = None
        for dist in (0.04, 0.08, 0.14, 0.22):
            if nl > 1e-6:
                cx = round(ring[i][0] + nx * dist, 2)
                cy = round(ring[i][1] + ny * dist, 2)
                if land_idx.is_land(cx, cy, pref_cands):
                    found = (cx, cy)
                    break
            for ang in range(8):
                rad = ang * math.pi / 4.0
                cx = round(ring[i][0] + math.cos(rad) * dist, 2)
                cy = round(ring[i][1] + math.sin(rad) * dist, 2)
                if land_idx.is_land(cx, cy, pref_cands):
                    found = (cx, cy)
                    break
            if found is not None:
                break
        out.append(found if found is not None else (rx, ry))

    # Deduplicate consecutive identical points
    dedup: list[tuple[float, float]] = []
    for p in out:
        if not dedup or p != dedup[-1]:
            dedup.append(p)
    if len(dedup) >= 2 and dedup[0] == dedup[-1]:
        dedup.pop()
    return dedup


def pip_evenodd(x: float, y: float, rings: list[list[tuple[float, float]]]) -> bool:
    cnt = 0
    for r in rings:
        if pip_ring(x, y, r):
            cnt += 1
    return (cnt % 2) == 1


def min_dist_to_rings(x: float, y: float, rings: list[list[tuple[float, float]]]) -> float:
    best = float("inf")
    for r in rings:
        x0, y0 = r[-1]
        for x1, y1 in r:
            d = point_seg_dist(x, y, x0, y0, x1, y1)
            if d < best:
                best = d
            x0, y0 = x1, y1
    return best


def compute_pole_of_inaccessibility(
    rings: list[list[tuple[float, float]]],
    primary_ring: list[tuple[float, float]],
    land_idx: JapanLandIndex,
    pref_cands: list[str],
) -> tuple[float, float]:
    """Guaranteed interior visual center (maximizes clearance from all edges, inside primary ring & on land)."""
    x0, y0, x1, y1 = ring_bbox(primary_ring)
    w = max(0.1, x1 - x0)
    h = max(0.1, y1 - y0)

    # Coarse grid search (24x24) followed by 3 stages of local refinement
    best_pt: tuple[float, float] | None = None
    best_d = -1.0

    steps = 28
    dx = w / steps
    dy = h / steps
    for iy in range(steps + 1):
        py = y0 + iy * dy
        for ix in range(steps + 1):
            px = x0 + ix * dx
            if not pip_ring(px, py, primary_ring):
                continue
            if not pip_evenodd(px, py, rings):
                continue
            if not land_idx.is_land(px, py, pref_cands):
                continue
            d = min_dist_to_rings(px, py, rings)
            if d > best_d:
                best_d = d
                best_pt = (px, py)

    if best_pt is None:
        # Fallback to centroid of primary ring
        cx = sum(p[0] for p in primary_ring) / len(primary_ring)
        cy = sum(p[1] for p in primary_ring) / len(primary_ring)
        return round(cx, 2), round(cy, 2)

    cx, cy = best_pt
    rx, ry = dx, dy
    for _ in range(4):
        for iy in range(-4, 5):
            py = cy + iy * (ry / 4.0)
            for ix in range(-4, 5):
                px = cx + ix * (rx / 4.0)
                if not pip_evenodd(px, py, rings):
                    continue
                if not land_idx.is_land(px, py, pref_cands):
                    continue
                d = min_dist_to_rings(px, py, rings)
                if d > best_d:
                    best_d = d
                    best_pt = (px, py)
        cx, cy = best_pt
        rx /= 3.0
        ry /= 3.0

    return round(best_pt[0], 2), round(best_pt[1], 2)


# ---------------------------------------------------------------------------
# Basin specifications for ALL 17 plains
# Each spec defines:
#   - id, name
#   - basin_poly: (lon, lat) polygon defining the plain's geographic watershed
#                 (cuts occur ONLY at narrow gaps/ridges separating neighboring plains)
#   - elev_fn(lon, lat) -> max elevation (m) for lowland classification
#   - seeds: (lon, lat) list in the heart of the plain
#   - open_r, close_r: morphological smoothing radii in z=9 pixels (~0.115 SVG px)
#   - eps: Douglas-Peucker simplification tolerance in SVG px
#   - min_ring_area_px2: minimum outer ring SVG area to keep (drops tiny specks)
#   - max_hole_fill_px: interior land-only hillock holes <= this pixel count are filled
#   - allowed_prefs: optional list of prefecture codes to keep land clipping crisp
# ---------------------------------------------------------------------------
def const_elev(m: float) -> Callable[[float, float], float]:
    return lambda lon, lat: m


def kanto_elev(lon: float, lat: float) -> float:
    """Spatially adaptive elevation threshold for Kanto Plain.

    Kanto's NW/N piedmont alluvial fans & diluvial terraces (Maebashi/Takasaki/Utsunomiya/
    Musashino/Sagamihara) rise gently to ~125-145m, whereas southern Chiba (Boso Hills)
    and Miura Peninsula hills rise sharply around ~50-65m.
    """
    # Boso Peninsula & southern Chiba (natural transition from Shimosa/Kujukuri to Boso Hills)
    if lon > 139.84 and lat < 35.48:
        return 52.0
    # Miura Peninsula & Yokohama/Kamakura southern hills
    if lon < 139.75 and lat < 35.34:
        return 55.0
    # Western Musashino / Tama / Sagamihara / Gunma / Tochigi gentle piedmont fans
    if lat > 36.15 or lon < 139.50:
        return 145.0
    return 115.0


PLAIN_SPECS: list[dict[str, Any]] = [
    {
        "id": "geo_076",
        "name": "大阪平野",
        "basin_poly": [
            # West: Ashiya/Rokko eastern foot -> South along Osaka Bay -> Misaki/Izumi
            (135.33, 34.86),
            (135.29, 34.72),
            (135.10, 34.40),
            (135.15, 34.27),
            (135.42, 34.30),
            # East: Izumi/Kongo/Ikoma ridge (cuts at Kashiwara/Yamato gorge so no Nara leak!)
            (135.66, 34.43),
            (135.67, 34.56),
            (135.72, 34.72),
            # NE: Yamazaki gorge pinch (cuts cleanly before Kyoto Basin!)
            (135.70, 34.86),
            (135.62, 34.91),
            (135.48, 34.93),
        ],
        "elev_fn": const_elev(60.0),
        "seeds": [(135.50, 34.68)],
        "open_r": 1,
        "close_r": 2,
        "eps": 0.36,
        "min_ring_area_px2": 1.2,
        "max_hole_fill_px": 25,
        "allowed_prefs": ["27", "28"],
    },
    {
        "id": "geo_077",
        "name": "越後平野",
        "basin_poly": [
            # North: Murakami/Arakawa north edge (Kushigata mountains)
            (139.32, 38.22),
            (139.65, 38.18),
            # East: Iide/Gozu/Echigo mountains
            (139.55, 37.72),
            (139.25, 37.45),
            (139.04, 37.33),
            # South: Nagaoka southern end (stops before Ojiya/Uonuma)
            (138.75, 37.33),
            # West: Nishiyama hills ridge (separates cleanly from Kashiwazaki plain!)
            (138.70, 37.55),
            (138.72, 37.75),
            # Coastline outside Sea of Japan
            (138.75, 37.98),
            (139.05, 38.18),
        ],
        "elev_fn": const_elev(55.0),
        "seeds": [(139.02, 37.78), (138.86, 37.46)],
        "open_r": 1,
        "close_r": 2,
        "eps": 0.40,
        "min_ring_area_px2": 1.5,
        "max_hole_fill_px": 40,
        "allowed_prefs": ["15"],
    },
    {
        "id": "geo_078",
        "name": "筑紫平野",
        "basin_poly": [
            # West: Kashima / Takeo-east / Shiroishi
            (129.99, 33.12),
            (129.99, 33.36),
            # North: Sefuri mountains & Futsukaichi Gap cut (lat ~33.455 cuts cleanly before Fukuoka Plain!)
            (130.35, 33.44),
            (130.54, 33.455),
            (130.82, 33.45),
            # East: Asakura / Ukiha / Mino mountains
            (130.84, 33.24),
            (130.72, 33.14),
            # South: Miyama / northern Omuta cut (stops cleanly before Kumamoto Plain!)
            (130.52, 33.08),
            (130.30, 33.02),
            (130.10, 33.02),
        ],
        "elev_fn": const_elev(55.0),
        "seeds": [(130.30, 33.24), (130.52, 33.30)],
        "open_r": 1,
        "close_r": 2,
        "eps": 0.36,
        "min_ring_area_px2": 1.2,
        "max_hole_fill_px": 40,
        "allowed_prefs": ["40", "41"],
    },
    {
        "id": "geo_079",
        "name": "十勝平野",
        "basin_poly": [
            # West: Hidaka Mountains crest
            (142.68, 42.34),
            (142.68, 42.98),
            (142.85, 43.30),
            # North: Ishikari / Shikaribetsu / Daisetsuzan foothills
            (143.35, 43.44),
            (143.88, 43.36),
            # East: Shiranuka Hills crest (natural topographic wall separating from Kushiro Plain!)
            (143.92, 43.02),
            (143.84, 42.76),
            # South/SE: Pacific coast down to Hiroo/Taiki
            (143.55, 42.50),
            (143.30, 42.30),
        ],
        "elev_fn": const_elev(230.0),
        "seeds": [(143.20, 42.92)],
        "open_r": 2,
        "close_r": 3,
        "eps": 0.42,
        "min_ring_area_px2": 2.0,
        "max_hole_fill_px": 95,
        "allowed_prefs": ["01"],
    },
    {
        "id": "geo_080",
        "name": "讃岐平野",
        "basin_poly": [
            # West: Kanonji / Kagawa-Ehime border
            (133.61, 34.04),
            (133.60, 34.36),
            # North: Mainland Kagawa Seto Inland Sea coast (excludes Shodoshima & northern islands!)
            (133.86, 34.41),
            (134.18, 34.43),
            (134.46, 34.31),
            # East: Higashikagawa / Kagawa-Tokushima border
            (134.46, 34.18),
            # South: Sanuki Mountains ridge
            (134.10, 34.13),
            (133.76, 34.05),
        ],
        "elev_fn": const_elev(105.0),
        "seeds": [(134.05, 34.32), (133.81, 34.26), (133.68, 34.13)],
        "open_r": 1,
        "close_r": 2,
        "eps": 0.40,
        "min_ring_area_px2": 1.0,
        "max_hole_fill_px": 45,
        "allowed_prefs": ["37"],
    },
    {
        "id": "geo_081",
        "name": "関東平野",
        "basin_poly": [
            # SW: Sagami Bay / Odawara (excludes Hakone/Izu) -> Tanzawa -> Kanto Mtns
            (139.13, 35.22),
            (139.08, 35.58),
            (138.80, 36.22),
            (138.80, 36.56),
            # North: Gunma / Tochigi northern mountains (includes Maebashi/Utsunomiya/Otawara lowlands)
            (139.40, 36.88),
            (140.25, 36.96),
            # NE: Hitachi/Ibaraki foothills (stops cleanly before narrow Fukushima coastal strip)
            (140.58, 36.74),
            (140.70, 36.58),
            (140.98, 36.32),
            # East: Kashima-nada & Kujukuri Pacific coast
            (140.98, 35.65),
            (140.52, 35.24),
            # South Chiba: Boso Hills natural ridge (DEM <=52m draws organic foothills!)
            (140.28, 35.26),
            (139.96, 35.26),
            (139.80, 35.26),
            # Tokyo Bay -> Shonan/Sagami Bay (excludes Miura southern hilly tip)
            (139.58, 35.24),
        ],
        "elev_fn": kanto_elev,
        "seeds": [(139.75, 35.95)],
        "open_r": 2,
        "close_r": 3,
        "eps": 0.54,
        "min_ring_area_px2": 3.0,
        "max_hole_fill_px": 95,
        "allowed_prefs": ["08", "09", "10", "11", "12", "13", "14"],
    },
    {
        "id": "geo_082",
        "name": "濃尾平野",
        "basin_poly": [
            # West: Yoro & Ibuki Mountains (cuts at Sekigahara pass so no Shiga leak!)
            (136.50, 35.02),
            (136.47, 35.36),
            (136.50, 35.58),
            # North: Mino Mountains
            (136.98, 35.60),
            (137.14, 35.46),
            # East: Owari Hills & Sakai River divide (cuts cleanly before Okazaki Plain & Chita!)
            (137.06, 35.26),
            (137.01, 35.06),
            (136.90, 35.01),
            # South: Ise Bay / Kuwana (stops before Mie southern coast!)
            (136.64, 35.01),
        ],
        "elev_fn": const_elev(65.0),
        "seeds": [(136.80, 35.28), (136.62, 35.36)],
        "open_r": 1,
        "close_r": 2,
        "eps": 0.38,
        "min_ring_area_px2": 1.5,
        "max_hole_fill_px": 40,
        "allowed_prefs": ["21", "23", "24"],
    },
    {
        "id": "geo_083",
        "name": "岡山平野",
        "basin_poly": [
            # West: West of Takahashi River / Kurashiki-Tamashima headland ridge
            (133.635, 34.50),
            (133.635, 34.78),
            # North: Kibi Plateau
            (133.90, 34.82),
            (134.18, 34.78),
            # East: East of Yoshii River / Setouchi
            (134.18, 34.58),
            # South: Seto Inland Sea / Kojima Peninsula northern reclaimed lowlands
            (134.04, 34.53),
            (133.76, 34.48),
        ],
        "elev_fn": const_elev(55.0),
        "seeds": [(133.86, 34.64), (133.88, 34.55)],
        "open_r": 1,
        "close_r": 2,
        "eps": 0.36,
        "min_ring_area_px2": 1.0,
        "max_hole_fill_px": 40,
        "allowed_prefs": ["33"],
    },
    {
        "id": "geo_084",
        "name": "八代平野",
        "basin_poly": [
            # West: Yatsushiro Sea
            (130.48, 32.42),
            (130.52, 32.64),
            # North: Uki / Matsubase low ridge separating cleanly from Kumamoto Plain
            (130.68, 32.63),
            (130.78, 32.60),
            # East: Kyushu Mountains
            (130.78, 32.42),
            # South: Hinagu / Ashikita foothills
            (130.56, 32.42),
        ],
        "elev_fn": const_elev(55.0),
        "seeds": [(130.60, 32.51)],
        "open_r": 1,
        "close_r": 1,
        "eps": 0.25,
        "min_ring_area_px2": 0.8,
        "max_hole_fill_px": 15,
        "allowed_prefs": ["43"],
    },
    {
        "id": "geo_085",
        "name": "鳥取平野",
        "basin_poly": [
            # West: Hakuto headland ridge (separates cleanly from Ketaka plain!)
            (134.115, 35.56),
            (134.135, 35.46),
            (134.135, 35.38),
            # South -> East: Kawahara & Fukube hills
            (134.36, 35.38),
            (134.36, 35.58),
            # North: Sea of Japan coast
            (134.115, 35.58),
        ],
        "elev_fn": const_elev(70.0),
        "seeds": [(134.22, 35.50)],
        "open_r": 1,
        "close_r": 1,
        "eps": 0.26,
        "min_ring_area_px2": 0.5,
        "max_hole_fill_px": 12,
        "allowed_prefs": ["31"],
    },
    {
        "id": "geo_086",
        "name": "津軽平野",
        "basin_poly": [
            # West: Sea of Japan + Mt Iwaki + Ajigasawa
            (140.16, 40.50),
            (140.16, 41.12),
            # North: Lake Jusan / Nakadomari (stops on west side of Tsugaru Mtns crest!)
            (140.46, 41.12),
            # East: Tsugaru Mountains crest (strictly separates from Mutsu Bay / Aomori Plain!)
            (140.53, 40.90),
            (140.60, 40.72),
            (140.68, 40.56),
            # South: Hirosaki/Hirakawa foothills
            (140.54, 40.50),
        ],
        "elev_fn": const_elev(85.0),
        "seeds": [(140.44, 40.81), (140.47, 40.60)],
        "open_r": 1,
        "close_r": 2,
        "eps": 0.32,
        "min_ring_area_px2": 1.2,
        "max_hole_fill_px": 30,
        "allowed_prefs": ["02"],
    },
    {
        "id": "geo_087",
        "name": "石狩平野",
        "basin_poly": [
            # SW: Tomakomai west edge (Tarumae / Shiraoi coast) -> Shikotsu -> Sapporo/Teine Mtns -> Ishikari Bay
            (141.32, 42.56),
            (141.12, 43.02),
            (141.22, 43.38),
            (141.52, 43.76),
            # North: Takikawa / Fukagawa (cuts along Kamui Kotan before Asahikawa / Kamikawa Basin!)
            (141.78, 43.82),
            (142.12, 43.73),
            # East: Yubari Mountains -> Atsuma/Mukawa hills
            (142.14, 43.30),
            (141.98, 42.90),
            (141.98, 42.56),
        ],
        "elev_fn": const_elev(85.0),
        "seeds": [(141.55, 43.10), (141.85, 43.35), (141.65, 42.66)],
        "open_r": 2,
        "close_r": 2,
        "eps": 0.44,
        "min_ring_area_px2": 2.0,
        "max_hole_fill_px": 65,
        "allowed_prefs": ["01"],
    },
    {
        "id": "geo_088",
        "name": "秋田平野",
        "basin_poly": [
            # West: Sea of Japan + eastern neck of Oga Peninsula (excludes Oga Mtns!)
            (139.88, 39.55),
            (139.88, 40.08),
            # North: North edge of Hachirogata / Mitane-south (stops well before Noshiro Plain!)
            (140.25, 40.08),
            # East: Dewa / Taiheizan Mountains
            (140.35, 39.85),
            (140.35, 39.55),
            # South: Southern Akita City / Yuwa (stops before Honjo Plain!)
        ],
        "elev_fn": const_elev(60.0),
        "seeds": [(140.10, 39.72), (140.02, 39.96)],
        "open_r": 1,
        "close_r": 2,
        "eps": 0.36,
        "min_ring_area_px2": 1.2,
        "max_hole_fill_px": 35,
        "allowed_prefs": ["05"],
    },
    {
        "id": "geo_089",
        "name": "高知平野",
        "basin_poly": [
            # West: Tosa City / Niyodo River mouth
            (133.36, 33.44),
            (133.36, 33.66),
            # North: Shikoku Mountains
            (133.80, 33.66),
            # East: Konan / Yasu
            (133.80, 33.48),
            # South: Tosa Bay
            (133.58, 33.44),
        ],
        "elev_fn": const_elev(65.0),
        "seeds": [(133.64, 33.57), (133.54, 33.56)],
        "open_r": 1,
        "close_r": 1,
        "eps": 0.28,
        "min_ring_area_px2": 0.6,
        "max_hole_fill_px": 30,
        "allowed_prefs": ["39"],
    },
    {
        "id": "geo_090",
        "name": "宮崎平野",
        "basin_poly": [
            # South: Kiyotake / Aoshima / Wanitsuka foothills
            (131.12, 31.79),
            # West: Kyushu Mountains
            (131.12, 32.31),
            # North: Tsuno / Mimitsu (stops before Hyuga/Nobeoka!)
            (131.65, 32.31),
            # East: Hyuga-nada Pacific coast
            (131.65, 31.79),
        ],
        "elev_fn": const_elev(105.0),
        "seeds": [(131.42, 31.92), (131.46, 32.08)],
        "open_r": 1,
        "close_r": 2,
        "eps": 0.34,
        "min_ring_area_px2": 1.2,
        "max_hole_fill_px": 35,
        "allowed_prefs": ["45"],
    },
    {
        "id": "geo_091",
        "name": "庄内平野",
        "basin_poly": [
            # West: Sea of Japan
            (139.65, 38.66),
            (139.75, 39.07),
            # North: Foot of Mt. Chokai / Yuza
            (140.08, 39.07),
            # East: Dewa Mountains / Gassan / Mogami Gorge
            (140.08, 38.66),
        ],
        "elev_fn": const_elev(65.0),
        "seeds": [(139.88, 38.86)],
        "open_r": 1,
        "close_r": 2,
        "eps": 0.30,
        "min_ring_area_px2": 1.0,
        "max_hole_fill_px": 25,
        "allowed_prefs": ["06"],
    },
    {
        "id": "geo_092",
        "name": "仙台平野",
        "basin_poly": [
            # South: Miyagi-Fukushima border at Yamamoto/Marumori (stops before Soma/Hamadori!)
            (140.70, 37.89),
            # West: Ou Mountains foothills
            (140.68, 38.45),
            (140.82, 38.87),
            # North: Miyagi-Iwate border / Kurihara-Tome north edge (stops before Kitakami Basin!)
            (141.36, 38.87),
            # East: Kitakami Mountains / Oshika Peninsula / Sendai Bay
            (141.48, 38.42),
            (141.15, 37.89),
        ],
        "elev_fn": const_elev(65.0),
        "seeds": [(140.92, 38.22), (141.06, 38.56), (141.22, 38.48)],
        "open_r": 1,
        "close_r": 2,
        "eps": 0.44,
        "min_ring_area_px2": 1.5,
        "max_hole_fill_px": 50,
        "allowed_prefs": ["04"],
    },
]


# ---------------------------------------------------------------------------
# Main extraction per plain
# ---------------------------------------------------------------------------
def build_single_plain(
    spec: dict[str, Any],
    land_idx: JapanLandIndex,
    tile_cache: dict[tuple[int, int], list[float | None]],
) -> dict[str, Any]:
    basin_lonlat: list[tuple[float, float]] = spec["basin_poly"]
    lons = [p[0] for p in basin_lonlat]
    lats = [p[1] for p in basin_lonlat]

    # Convert basin polygon to global z=9 pixels
    basin_gpx = [lonlat_to_global_px(lon, lat) for lon, lat in basin_lonlat]
    pad = 8
    gx0 = int(math.floor(min(p[0] for p in basin_gpx))) - pad
    gy0 = int(math.floor(min(p[1] for p in basin_gpx))) - pad
    gx1 = int(math.ceil(max(p[0] for p in basin_gpx))) + pad
    gy1 = int(math.ceil(max(p[1] for p in basin_gpx))) + pad
    w = gx1 - gx0
    h = gy1 - gy0

    # 1. Rasterize exact Japan land mask from japan_prefs.json (for allowed_prefs)
    allowed_prefs: list[str] | None = spec.get("allowed_prefs")
    land_mask = land_idx.rasterize_land_mask(gx0, gy0, w, h, allowed_prefs=allowed_prefs)

    # Also build full Japan land mask (for zero ocean spill checks across all prefs)
    svg_x0, svg_y0 = global_px_to_svg(gx0, gy0)
    svg_x1, svg_y1 = global_px_to_svg(gx1, gy1)
    roi_bbox = (min(svg_x0, svg_x1), min(svg_y0, svg_y1), max(svg_x0, svg_x1), max(svg_y0, svg_y1))
    pref_cands = land_idx.prefs_in_bbox(roi_bbox)

    # 2. Rasterize basin_poly into local mask
    basin_local = [(p[0] - gx0, p[1] - gy0) for p in basin_gpx]
    basin_edges = []
    xp, yp = basin_local[-1]
    for xc, yc in basin_local:
        if yp != yc:
            if yp < yc:
                basin_edges.append((yp, yc, xp, (xc - xp) / (yc - yp)))
            else:
                basin_edges.append((yc, yp, xc, (xp - xc) / (yp - yc)))
        xp, yp = xc, yc

    basin_mask = bytearray(w * h)
    for row in range(h):
        yf = row + 0.5
        xs_c = [x_lo + (yf - y_lo) * inv_m for y_lo, y_hi, x_lo, inv_m in basin_edges if y_lo <= yf < y_hi]
        if not xs_c:
            continue
        xs_c.sort()
        off = row * w
        for i in range(0, len(xs_c) - 1, 2):
            c0 = max(0, int(math.ceil(xs_c[i] - 0.5)))
            c1 = min(w, int(math.floor(xs_c[i + 1] - 0.5)) + 1)
            if c0 < c1:
                basin_mask[off + c0 : off + c1] = b"\x01" * (c1 - c0)

    # 3. Sample GSI DEM z=9 elevation across ROI
    elev_fn: Callable[[float, float], float] = spec["elev_fn"]
    raw_lowland = bytearray(w * h)

    # Precompute lon per column and lat per row
    col_lons = [((gx0 + x + 0.5) / WORLD_PX) * 360.0 - 180.0 for x in range(w)]
    row_lats = [
        math.degrees(2.0 * math.atan(math.exp(math.pi - 2.0 * math.pi * ((gy0 + y + 0.5) / WORLD_PX))) - math.pi / 2.0)
        for y in range(h)
    ]

    for y in range(h):
        gy = gy0 + y
        ty = gy // TILE_SIZE
        py = gy % TILE_SIZE
        py_off = py * TILE_SIZE
        lat = row_lats[y]
        row_off = y * w
        for x in range(w):
            idx = row_off + x
            if not basin_mask[idx]:
                continue
            if not land_mask[idx]:
                # Treat ocean inside basin as lowland BEFORE morphological smoothing
                # so opening/closing NEVER erodes away coastal shorelines!
                raw_lowland[idx] = 1
                continue
            gx = gx0 + x
            tx = gx // TILE_SIZE
            px = gx % TILE_SIZE
            tile = tile_cache[(tx, ty)]
            ev = tile[py_off + px]
            # Inside land_mask, GSI NODATA occurs on wide river channels / inland flat water -> treat as 0m lowland
            if ev is None or ev <= elev_fn(col_lons[x], lat):
                raw_lowland[idx] = 1

    # 4. Morphological smoothing on lowland mask (prior to coastline clipping!)
    smoothed = raw_lowland
    if spec["close_r"] > 0:
        smoothed = morph_close(smoothed, w, h, spec["close_r"])
    if spec["open_r"] > 0:
        smoothed = morph_open(smoothed, w, h, spec["open_r"])

    # 5. Exact intersection with 1-px inset Japan land mask (~0.115 SVG px inside exact coast)
    #    This trims tiny industrial port-pier spikes and gives Douglas-Peucker a clean inward
    #    margin along concave bays so simplified chords stay 100% on land with 0.00% ocean spill!
    safe_land_mask = erode_cross1(land_mask, w, h)
    clipped = bytearray(w * h)
    for i in range(w * h):
        if smoothed[i] and safe_land_mask[i] and basin_mask[i]:
            clipped[i] = 1

    # Remove 1-px spiky peninsulas along complex port coastlines (e.g. Tokyo/Osaka/Matsushima)
    clipped = morph_open(clipped, w, h, 1)

    # 6. Flood-fill from geographic seeds to keep ONLY the true plain component(s)
    seeds_px = []
    for slon, slat in spec["seeds"]:
        sgx, sgy = lonlat_to_global_px(slon, slat)
        seeds_px.append((int(round(sgx - gx0)), int(round(sgy - gy0))))
    selected = flood_fill_from_seeds(clipped, w, h, seeds_px)

    # 7. Fill tiny isolated interior land-only hillock holes (never fills ocean!)
    if spec["max_hole_fill_px"] > 0:
        selected = fill_small_holes(selected, land_mask, w, h, spec["max_hole_fill_px"])

    # 8. Extract contour rings via Marching Squares
    raw_rings = extract_contours_marching_squares(selected, w, h, gx0, gy0)
    if not raw_rings:
        raise RuntimeError(f"No contours extracted for {spec['id']} {spec['name']}")

    # Classify rings into outer vs hole via containment test (evenodd parity)
    ring_infos = []
    for r in raw_rings:
        area = abs(ring_signed_area(r))
        ring_infos.append((area, r))
    ring_infos.sort(key=lambda t: t[0], reverse=True)

    # Simplify rings safely (keeping 0% ocean spill)
    eps = spec["eps"]
    min_outer_area = spec["min_ring_area_px2"]
    kept_outer: list[tuple[float, list[tuple[float, float]]]] = []
    kept_holes: list[tuple[float, list[tuple[float, float]]]] = []

    for raw_area, r in ring_infos:
        # Determine if r is nested inside an odd number of larger raw rings -> hole
        sample_pt = r[0]
        depth = 0
        for other_area, other_r in ring_infos:
            if other_area <= raw_area:
                continue
            if pip_ring(sample_pt[0], sample_pt[1], other_r):
                depth += 1
        is_outer = (depth % 2) == 0

        if is_outer and raw_area < min_outer_area:
            continue
        if (not is_outer) and raw_area < 0.8:
            continue

        simp = simplify_ring_land_safe(r, eps, land_idx, pref_cands)
        simp = nudge_ring_inside_land(simp, land_idx, pref_cands, is_outer=is_outer)
        if len(simp) < 3:
            continue
        area_s = abs(ring_signed_area(simp))
        if is_outer and area_s < min_outer_area:
            continue
        if (not is_outer) and area_s < 0.6:
            continue

        if is_outer:
            kept_outer.append((area_s, simp))
        else:
            kept_holes.append((area_s, simp))

    if not kept_outer:
        raise RuntimeError(f"All outer rings filtered out for {spec['id']} {spec['name']}")

    kept_outer.sort(key=lambda t: t[0], reverse=True)
    kept_holes.sort(key=lambda t: t[0], reverse=True)
    all_rings = [r for _, r in kept_outer] + [r for _, r in kept_holes]
    primary_ring = kept_outer[0][1]

    # Build compact SVG d-path (evenodd MultiPolygon)
    d_parts = []
    for ring in all_rings:
        segs = [f"M{ring[0][0]:.2f},{ring[0][1]:.2f}"]
        for px, py in ring[1:]:
            segs.append(f"L{px:.2f},{py:.2f}")
        segs.append("Z")
        d_parts.append("".join(segs))
    svg_path = "".join(d_parts)

    # Exact bbox across all rings
    all_xs = [p[0] for r in all_rings for p in r]
    all_ys = [p[1] for r in all_rings for p in r]
    bbox = [round(min(all_xs), 2), round(min(all_ys), 2), round(max(all_xs), 2), round(max(all_ys), 2)]

    # Guaranteed interior center (Pole of Inaccessibility)
    center = compute_pole_of_inaccessibility(all_rings, primary_ring, land_idx, pref_cands)

    # -----------------------------------------------------------------------
    # Strict verification metrics (dense vector grid against japan_prefs.json)
    # -----------------------------------------------------------------------
    step_v = 0.25
    in_plain = 0
    in_ocean = 0
    pref_hits: dict[str, int] = {}
    vy = bbox[1] + step_v * 0.5
    while vy < bbox[3]:
        vx = bbox[0] + step_v * 0.5
        while vx < bbox[2]:
            if pip_evenodd(vx, vy, all_rings):
                in_plain += 1
                pcode = land_idx.pref_at(vx, vy, pref_cands)
                if pcode is None:
                    in_ocean += 1
                else:
                    pref_hits[pcode] = pref_hits.get(pcode, 0) + 1
            vx += step_v
        vy += step_v

    ocean_pct = (100.0 * in_ocean / in_plain) if in_plain > 0 else 100.0

    # Net area & isoperimetric circularity of primary ring (circle=1.0)
    net_area = sum(a for a, _ in kept_outer) - sum(a for a, _ in kept_holes)
    perim = 0.0
    for i in range(len(primary_ring)):
        p0 = primary_ring[i]
        p1 = primary_ring[(i + 1) % len(primary_ring)]
        perim += math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    circularity = (4.0 * math.pi * kept_outer[0][0]) / (perim * perim) if perim > 0 else 0.0

    # Verify center strictly inside polygon & on land
    assert pip_evenodd(center[0], center[1], all_rings), f"{spec['name']} center not inside polygon!"
    assert land_idx.is_land(center[0], center[1], pref_cands), f"{spec['name']} center not on land!"

    # Top overlapping prefectures
    top_prefs = sorted(pref_hits.items(), key=lambda kv: kv[1], reverse=True)
    pref_summary = ", ".join(
        f"{land_idx.pref_names[c]}({100.0 * n / max(1, in_plain):.0f}%)"
        for c, n in top_prefs
        if (100.0 * n / max(1, in_plain)) >= 1.0
    )

    total_verts = sum(len(r) for r in all_rings)
    stats = {
        "id": spec["id"],
        "name": spec["name"],
        "outer_rings": len(kept_outer),
        "holes": len(kept_holes),
        "primary_verts": len(primary_ring),
        "total_verts": total_verts,
        "area_px2": round(net_area, 2),
        "ocean_pct": round(ocean_pct, 3),
        "circularity": round(circularity, 3),
        "prefs": pref_summary,
    }

    feature = {
        "name": spec["name"],
        "geometryType": "polygon",
        "path": svg_path,
        "pts": [[p[0], p[1]] for p in primary_ring],
        "center": [center[0], center[1]],
        "bbox": bbox,
        "source": "dem_landclip",
    }
    return {"feature": feature, "stats": stats}


def main() -> None:
    print("Loading japan_prefs.json ...")
    prefs_json = json.loads(PREFS_PATH.read_text(encoding="utf-8"))
    land_idx = JapanLandIndex(prefs_json)

    # Verify we match all 17 plains in geography_100.json
    geo100 = json.loads(GEO_100_PATH.read_text(encoding="utf-8"))
    expected_plains = {g["id"]: g["name"] for g in geo100 if g["category"] == "plain"}
    spec_map = {s["id"]: s["name"] for s in PLAIN_SPECS}
    assert spec_map == expected_plains, f"Mismatch between PLAIN_SPECS and geography_100.json: {spec_map} vs {expected_plains}"

    # Collect all unique z=9 GSI DEM tiles needed across all 17 plains
    needed_tiles: set[tuple[int, int]] = set()
    for spec in PLAIN_SPECS:
        basin_gpx = [lonlat_to_global_px(lon, lat) for lon, lat in spec["basin_poly"]]
        pad = 8
        gx0 = int(math.floor(min(p[0] for p in basin_gpx))) - pad
        gy0 = int(math.floor(min(p[1] for p in basin_gpx))) - pad
        gx1 = int(math.ceil(max(p[0] for p in basin_gpx))) + pad
        gy1 = int(math.ceil(max(p[1] for p in basin_gpx))) + pad
        for ty in range(gy0 // TILE_SIZE, (gy1 - 1) // TILE_SIZE + 1):
            for tx in range(gx0 // TILE_SIZE, (gx1 - 1) // TILE_SIZE + 1):
                needed_tiles.add((tx, ty))

    print(f"Fetching/decoding {len(needed_tiles)} GSI dem_png z={ZOOM} tiles ...")
    tile_cache: dict[tuple[int, int], list[float | None]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        fut_map = {ex.submit(fetch_gsi_tile_elev, tx, ty, ZOOM): (tx, ty) for tx, ty in sorted(needed_tiles)}
        for fut in concurrent.futures.as_completed(fut_map):
            key = fut_map[fut]
            tile_cache[key] = fut.result()

    print("Extracting & land-clipping all 17 alluvial plains ...")
    out_data: dict[str, Any] = {}
    all_stats: list[dict[str, Any]] = []

    for spec in PLAIN_SPECS:
        res = build_single_plain(spec, land_idx, tile_cache)
        out_data[spec["id"]] = res["feature"]
        s = res["stats"]
        all_stats.append(s)
        print(
            f"  {s['id']} {s['name']:6s} | rings={s['outer_rings']}+{s['holes']}h "
            f"| verts={s['total_verts']:3d} (main={s['primary_verts']:3d}) "
            f"| area={s['area_px2']:7.1f}px2 | ocean={s['ocean_pct']:5.2f}% "
            f"| circ={s['circularity']:.2f} | {s['prefs']}"
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out_data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    size_kb = OUT_PATH.stat().st_size / 1024.0
    max_ocean = max(s["ocean_pct"] for s in all_stats)
    max_circ = max(s["circularity"] for s in all_stats)
    print(f"\nWrote {OUT_PATH} ({size_kb:.1f} KB), 17 plains, max_ocean={max_ocean:.3f}%, max_circ={max_circ:.3f}")


if __name__ == "__main__":
    main()
