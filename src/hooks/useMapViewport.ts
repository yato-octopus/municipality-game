import { useCallback, useEffect, useRef, useState } from 'react';
import type { BBox } from '../types/game';

export const MIN_ZOOM_RATIO = 0.45;
export const MAX_ZOOM_RATIO = 120;

// Full nationwide Japan viewBox bounds (Hokkaido to Kyushu + Okinawa inset)
const JAPAN_FULL_BBOX: BBox = [22, 34, 940, 920];

export interface ViewBoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface UseMapViewportOptions {
  initialBBox: BBox;
  dragInertia: number; // 0..1
  fpsMode: 'high' | 'low';
  onLiveViewBoxChange?: (vb: ViewBoxRect) => void;
}

function formatViewBox(vb: ViewBoxRect): string {
  return `${vb.x.toFixed(3)} ${vb.y.toFixed(3)} ${vb.w.toFixed(3)} ${vb.h.toFixed(3)}`;
}

function bboxToViewBox(bbox: BBox, aspect: number): ViewBoxRect {
  const bw = Math.max(4, bbox[2] - bbox[0]);
  const bh = Math.max(4, bbox[3] - bbox[1]);
  const safeAspect = Math.max(0.3, Math.min(3.5, aspect));
  let w = bw;
  let h = bh;
  if (w / h > safeAspect) {
    h = w / safeAspect;
  } else {
    w = h * safeAspect;
  }
  const cx = (bbox[0] + bbox[2]) / 2;
  const cy = (bbox[1] + bbox[3]) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function computeSvgMetrics(el: SVGSVGElement, vb: ViewBoxRect) {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0 || vb.w <= 0 || vb.h <= 0) {
    return null;
  }
  const scale = Math.min(r.width / vb.w, r.height / vb.h);
  const padX = (r.width - vb.w * scale) / 2;
  const padY = (r.height - vb.h * scale) / 2;
  return { rect: r, scale, padX, padY };
}

function clampViewBoxToBounds(vb: ViewBoxRect, baseBBox: BBox): ViewBoxRect {
  const minX = Math.min(JAPAN_FULL_BBOX[0], baseBBox[0]);
  const minY = Math.min(JAPAN_FULL_BBOX[1], baseBBox[1]);
  const maxX = Math.max(JAPAN_FULL_BBOX[2], baseBBox[2]);
  const maxY = Math.max(JAPAN_FULL_BBOX[3], baseBBox[3]);
  const bw = Math.max(10, maxX - minX);
  const bh = Math.max(10, maxY - minY);
  const marginX = Math.min(vb.w * 0.28, bw * 0.28, 150);
  const marginY = Math.min(vb.h * 0.28, bh * 0.28, 150);
  const cx = vb.x + vb.w / 2;
  const cy = vb.y + vb.h / 2;
  const clampedCx = Math.max(minX - marginX, Math.min(maxX + marginX, cx));
  const clampedCy = Math.max(minY - marginY, Math.min(maxY + marginY, cy));
  return {
    x: clampedCx - vb.w / 2,
    y: clampedCy - vb.h / 2,
    w: vb.w,
    h: vb.h,
  };
}

export function useMapViewport({
  initialBBox,
  dragInertia,
  fpsMode,
  onLiveViewBoxChange,
}: UseMapViewportOptions) {
  const svgNodeRef = useRef<SVGSVGElement | null>(null);
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const [containerAspect, setContainerAspect] = useState(1.4);
  const baseBBoxRef = useRef<BBox>(initialBBox);
  const onLiveViewBoxChangeRef = useRef(onLiveViewBoxChange);
  useEffect(() => {
    onLiveViewBoxChangeRef.current = onLiveViewBoxChange;
  }, [onLiveViewBoxChange]);

  const [viewBox, setViewBox] = useState<ViewBoxRect>(() =>
    bboxToViewBox(initialBBox, 1.4),
  );
  // Authoritative live viewBox (updated directly during 60/120fps drag & inertia without React re-renders)
  const viewBoxRef = useRef<ViewBoxRect>(viewBox);

  const animRafRef = useRef<number | null>(null);

  const getZoomBounds = useCallback((aspect: number) => {
    const initRect = bboxToViewBox(baseBBoxRef.current, aspect);
    const fullJapanRect = bboxToViewBox(JAPAN_FULL_BBOX, aspect);
    const minW = Math.max(0.5, initRect.w / MAX_ZOOM_RATIO);
    const maxW = Math.max(
      initRect.w / MIN_ZOOM_RATIO,
      fullJapanRect.w / 0.55,
    );
    const minZoom = Math.min(MIN_ZOOM_RATIO, initRect.w / maxW);
    return { initRect, minW, maxW, minZoom };
  }, []);

  const applyDomViewBox = useCallback((vb: ViewBoxRect): ViewBoxRect => {
    const clamped = clampViewBoxToBounds(vb, baseBBoxRef.current);
    viewBoxRef.current = clamped;
    const el = svgNodeRef.current;
    if (el) {
      el.setAttribute('viewBox', formatViewBox(clamped));
    }
    onLiveViewBoxChangeRef.current?.(clamped);
    return clamped;
  }, []);

  const commitViewBox = useCallback(
    (vb: ViewBoxRect) => {
      const clamped = applyDomViewBox(vb);
      setViewBox(clamped);
    },
    [applyDomViewBox],
  );

  const svgRef = useCallback((node: SVGSVGElement | null) => {
    svgNodeRef.current = node;
    if (node) {
      node.setAttribute('viewBox', formatViewBox(viewBoxRef.current));
    }
    setSvgEl(node);
  }, []);

  const stopAnimations = useCallback(() => {
    if (animRafRef.current != null) {
      cancelAnimationFrame(animRafRef.current);
      animRafRef.current = null;
    }
  }, []);

  // Attach ResizeObserver whenever the <svg> element mounts (even after async map load)
  useEffect(() => {
    if (!svgEl) return;
    let prevW = 0;
    let prevH = 0;
    const updateSize = () => {
      const r = svgEl.getBoundingClientRect();
      if (r.width <= 10 || r.height <= 10) return;
      const nextAspect = Math.max(0.3, Math.min(3.5, r.width / r.height));
      setContainerAspect(nextAspect);
      if (prevW === 0) {
        commitViewBox(bboxToViewBox(baseBBoxRef.current, nextAspect));
      } else if (Math.abs(r.width - prevW) > 1 || Math.abs(r.height - prevH) > 1) {
        const prevAspect = Math.max(0.3, Math.min(3.5, prevW / prevH));
        const cur = viewBoxRef.current;
        const prevInit = bboxToViewBox(baseBBoxRef.current, prevAspect);
        const curSpan = Math.sqrt(Math.max(1, cur.w * cur.h));
        const prevInitSpan = Math.sqrt(Math.max(1, prevInit.w * prevInit.h));
        const curCx = cur.x + cur.w / 2;
        const curCy = cur.y + cur.h / 2;
        const prevInitCx = prevInit.x + prevInit.w / 2;
        const prevInitCy = prevInit.y + prevInit.h / 2;
        const nearInitialScale = Math.abs(curSpan / prevInitSpan - 1) < 0.08;
        const nearInitialCenter =
          Math.hypot(curCx - prevInitCx, curCy - prevInitCy) < Math.max(prevInit.w, prevInit.h) * 0.08;

        if (nearInitialScale && nearInitialCenter) {
          commitViewBox(bboxToViewBox(baseBBoxRef.current, nextAspect));
        } else {
          const { minW, maxW } = getZoomBounds(nextAspect);
          const rawW = curSpan * Math.sqrt(nextAspect);
          const newW = Math.max(minW, Math.min(maxW, rawW));
          const newH = newW / nextAspect;
          commitViewBox({
            x: curCx - newW / 2,
            y: curCy - newH / 2,
            w: newW,
            h: newH,
          });
        }
      }
      prevW = r.width;
      prevH = r.height;
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(svgEl);
    return () => ro.disconnect();
  }, [svgEl, commitViewBox, getZoomBounds]);

  const fitBBox = useCallback(
    (bbox: BBox) => {
      stopAnimations();
      baseBBoxRef.current = bbox;
      const el = svgNodeRef.current;
      const r = el?.getBoundingClientRect();
      const aspect = r && r.width > 10 && r.height > 10 ? r.width / r.height : containerAspect;
      commitViewBox(bboxToViewBox(bbox, aspect));
    },
    [containerAspect, stopAnimations, commitViewBox],
  );

  // Refit smoothly when session's initialBBox changes
  useEffect(() => {
    fitBBox(initialBBox);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBBox[0], initialBBox[1], initialBBox[2], initialBBox[3]]);

  const animateToBBox = useCallback(
    (targetBBox: BBox, durationMs = 260) => {
      stopAnimations();
      const el = svgNodeRef.current;
      const r = el?.getBoundingClientRect();
      const aspect = r && r.width > 10 && r.height > 10 ? r.width / r.height : containerAspect;
      const start = { ...viewBoxRef.current };
      const goal = clampViewBoxToBounds(bboxToViewBox(targetBBox, aspect), baseBBoxRef.current);
      const t0 = performance.now();

      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / durationMs);
        const ease = 1 - (1 - p) * (1 - p) * (1 - p);
        const cur: ViewBoxRect = {
          x: start.x + (goal.x - start.x) * ease,
          y: start.y + (goal.y - start.y) * ease,
          w: start.w + (goal.w - start.w) * ease,
          h: start.h + (goal.h - start.h) * ease,
        };
        if (p < 1) {
          applyDomViewBox(cur);
          animRafRef.current = requestAnimationFrame(step);
        } else {
          animRafRef.current = null;
          commitViewBox(goal);
        }
      };
      animRafRef.current = requestAnimationFrame(step);
    },
    [containerAspect, stopAnimations, applyDomViewBox, commitViewBox],
  );

  /** Zoom ratio relative to initial bbox width (>= 1 means zoomed in) */
  const { initRect: currentInitRect, minZoom: minZoomRatio } = (() => {
    const initRect = bboxToViewBox(initialBBox, containerAspect);
    const fullJapanRect = bboxToViewBox(JAPAN_FULL_BBOX, containerAspect);
    const maxW = Math.max(
      initRect.w / MIN_ZOOM_RATIO,
      fullJapanRect.w / 0.55,
    );
    return {
      initRect,
      minZoom: Math.min(MIN_ZOOM_RATIO, initRect.w / maxW),
    };
  })();
  const zoomRatio = Math.max(
    minZoomRatio,
    Math.min(MAX_ZOOM_RATIO, currentInitRect.w / Math.max(0.25, viewBox.w)),
  );

  /** Scale current viewBox relatively (> 1 always zooms in, < 1 always zooms out) */
  const zoomByFactor = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-4) return;
      stopAnimations();
      const el = svgNodeRef.current;
      const r = el?.getBoundingClientRect();
      const aspect = r && r.width > 10 && r.height > 10 ? r.width / r.height : containerAspect;
      const { minW, maxW } = getZoomBounds(aspect);

      const prev = viewBoxRef.current;
      const nextW = Math.max(minW, Math.min(maxW, prev.w / factor));
      const actualFactor = prev.w / nextW;
      const nextH = prev.h / actualFactor;

      let anchorSvgX = prev.x + prev.w / 2;
      let anchorSvgY = prev.y + prev.h / 2;
      let fracX = 0.5;
      let fracY = 0.5;

      if (el && r && clientX != null && clientY != null) {
        const m = computeSvgMetrics(el, prev);
        if (m && m.scale > 0) {
          const renderedW = prev.w * m.scale;
          const renderedH = prev.h * m.scale;
          anchorSvgX = prev.x + (clientX - m.rect.left - m.padX) / m.scale;
          anchorSvgY = prev.y + (clientY - m.rect.top - m.padY) / m.scale;
          fracX =
            renderedW > 0
              ? Math.max(0, Math.min(1, (clientX - m.rect.left - m.padX) / renderedW))
              : 0.5;
          fracY =
            renderedH > 0
              ? Math.max(0, Math.min(1, (clientY - m.rect.top - m.padY) / renderedH))
              : 0.5;
        }
      }

      commitViewBox({
        x: anchorSvgX - nextW * fracX,
        y: anchorSvgY - nextH * fracY,
        w: nextW,
        h: nextH,
      });
    },
    [containerAspect, getZoomBounds, stopAnimations, commitViewBox],
  );

  const setZoomAtPoint = useCallback(
    (nextZoomRatio: number, clientX?: number, clientY?: number) => {
      stopAnimations();
      const el = svgNodeRef.current;
      const r = el?.getBoundingClientRect();
      const aspect = r && r.width > 10 && r.height > 10 ? r.width / r.height : containerAspect;
      const { initRect, minZoom } = getZoomBounds(aspect);
      const clampedZoom = Math.max(minZoom, Math.min(MAX_ZOOM_RATIO, nextZoomRatio));
      const newW = initRect.w / clampedZoom;
      const newH = initRect.h / clampedZoom;

      const cur = viewBoxRef.current;
      let anchorSvgX = cur.x + cur.w / 2;
      let anchorSvgY = cur.y + cur.h / 2;
      let fracX = 0.5;
      let fracY = 0.5;

      if (el && r && clientX != null && clientY != null) {
        const m = computeSvgMetrics(el, cur);
        if (m && m.scale > 0) {
          const renderedW = cur.w * m.scale;
          const renderedH = cur.h * m.scale;
          anchorSvgX = cur.x + (clientX - m.rect.left - m.padX) / m.scale;
          anchorSvgY = cur.y + (clientY - m.rect.top - m.padY) / m.scale;
          fracX =
            renderedW > 0
              ? Math.max(0, Math.min(1, (clientX - m.rect.left - m.padX) / renderedW))
              : 0.5;
          fracY =
            renderedH > 0
              ? Math.max(0, Math.min(1, (clientY - m.rect.top - m.padY) / renderedH))
              : 0.5;
        }
      }

      commitViewBox({
        x: anchorSvgX - newW * fracX,
        y: anchorSvgY - newH * fracY,
        w: newW,
        h: newH,
      });
    },
    [containerAspect, getZoomBounds, stopAnimations, commitViewBox],
  );

  /** Direct DOM viewBox pan during drag — zero React re-renders per pixel */
  const panByScreenDelta = useCallback(
    (dxScreen: number, dyScreen: number) => {
      stopAnimations();
      const el = svgNodeRef.current;
      if (!el) return;
      const prev = viewBoxRef.current;
      const m = computeSvgMetrics(el, prev);
      if (!m || m.scale <= 0) return;
      applyDomViewBox({
        ...prev,
        x: prev.x - dxScreen / m.scale,
        y: prev.y - dyScreen / m.scale,
      });
    },
    [stopAnimations, applyDomViewBox],
  );

  /** Smooth frame-rate-independent inertia on release, committing React state only once settled */
  const finishPan = useCallback(
    (vxScreenPerMs: number, vyScreenPerMs: number) => {
      stopAnimations();
      const el = svgNodeRef.current;
      const speed = Math.hypot(vxScreenPerMs, vyScreenPerMs);
      if (!el || dragInertia <= 0.02 || speed < 0.06) {
        setViewBox({ ...viewBoxRef.current });
        return;
      }

      // Cap extreme flick spikes and apply continuous exponential decay
      const maxSpeed = 3.2;
      const scaleClamp = speed > maxSpeed ? maxSpeed / speed : 1;
      let vx = vxScreenPerMs * scaleClamp;
      let vy = vyScreenPerMs * scaleClamp;
      const tauMs = 95 + dragInertia * 175;
      let last = performance.now();
      const minInterval = fpsMode === 'low' ? 30 : 0;

      const tick = (now: number) => {
        const rawDt = now - last;
        if (rawDt < minInterval) {
          animRafRef.current = requestAnimationFrame(tick);
          return;
        }
        last = now;
        // Clamp dt so a single OS frame drop never causes a jump at the end of glide
        const dt = Math.min(32, Math.max(1, rawDt));
        const decay = Math.exp(-dt / tauMs);
        // Integrate exact analytic distance over [0, dt] for velvety smooth deceleration
        const factor = tauMs * (1 - decay);
        const dxScreen = vx * factor;
        const dyScreen = vy * factor;
        vx *= decay;
        vy *= decay;

        const prev = viewBoxRef.current;
        const m = computeSvgMetrics(el, prev);
        if (m && m.scale > 0) {
          const unclampedX = prev.x - dxScreen / m.scale;
          const unclampedY = prev.y - dyScreen / m.scale;
          const clamped = applyDomViewBox({
            ...prev,
            x: unclampedX,
            y: unclampedY,
          });
          if (Math.abs(clamped.x - unclampedX) > 1e-3) vx = 0;
          if (Math.abs(clamped.y - unclampedY) > 1e-3) vy = 0;
        }

        if (Math.hypot(vx, vy) < 0.005) {
          animRafRef.current = null;
          setViewBox({ ...viewBoxRef.current });
          return;
        }
        animRafRef.current = requestAnimationFrame(tick);
      };
      animRafRef.current = requestAnimationFrame(tick);
    },
    [dragInertia, fpsMode, stopAnimations, applyDomViewBox],
  );

  const clientToSvg = useCallback((clientX: number, clientY: number): [number, number] => {
    const el = svgNodeRef.current;
    if (!el) return [0, 0];
    const vb = viewBoxRef.current;
    const m = computeSvgMetrics(el, vb);
    if (!m || m.scale <= 0) return [vb.x, vb.y];
    return [
      vb.x + (clientX - m.rect.left - m.padX) / m.scale,
      vb.y + (clientY - m.rect.top - m.padY) / m.scale,
    ];
  }, []);

  const svgToContainerPoint = useCallback(
    (
      sx: number,
      sy: number,
    ): { x: number; y: number; scale: number; width: number; height: number } | null => {
      const el = svgNodeRef.current;
      if (!el) return null;
      const vb = viewBoxRef.current;
      const m = computeSvgMetrics(el, vb);
      if (!m || m.scale <= 0) return null;
      return {
        x: m.padX + (sx - vb.x) * m.scale,
        y: m.padY + (sy - vb.y) * m.scale,
        scale: m.scale,
        width: m.rect.width,
        height: m.rect.height,
      };
    },
    [],
  );

  const svgScalePxPerUnit = useCallback((): number => {
    const el = svgNodeRef.current;
    if (!el) return 1;
    const m = computeSvgMetrics(el, viewBoxRef.current);
    return m ? m.scale : 1;
  }, []);

  useEffect(() => () => stopAnimations(), [stopAnimations]);

  return {
    svgRef,
    viewBox,
    viewBoxString: formatViewBox(viewBox),
    zoomRatio,
    minZoomRatio,
    fitBBox,
    animateToBBox,
    zoomByFactor,
    setZoomAtPoint,
    panByScreenDelta,
    finishPan,
    clientToSvg,
    svgToContainerPoint,
    svgScalePxPerUnit,
  };
}
