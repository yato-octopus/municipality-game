import { useCallback, useEffect, useRef, useState } from 'react';
import type { BBox } from '../types/game';

export const MIN_ZOOM_RATIO = 0.65;
export const MAX_ZOOM_RATIO = 120;

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

  const applyDomViewBox = useCallback((vb: ViewBoxRect) => {
    viewBoxRef.current = vb;
    const el = svgNodeRef.current;
    if (el) {
      el.setAttribute('viewBox', formatViewBox(vb));
    }
    onLiveViewBoxChangeRef.current?.(vb);
  }, []);

  const commitViewBox = useCallback(
    (vb: ViewBoxRect) => {
      applyDomViewBox(vb);
      setViewBox(vb);
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
      const nextAspect = r.width / r.height;
      setContainerAspect(nextAspect);
      if (prevW === 0) {
        commitViewBox(bboxToViewBox(baseBBoxRef.current, nextAspect));
      } else if (Math.abs(r.width - prevW) > 1 || Math.abs(r.height - prevH) > 1) {
        const cur = viewBoxRef.current;
        const cx = cur.x + cur.w / 2;
        const cy = cur.y + cur.h / 2;
        const newH = cur.w / nextAspect;
        commitViewBox({ x: cx - cur.w / 2, y: cy - newH / 2, w: cur.w, h: newH });
      }
      prevW = r.width;
      prevH = r.height;
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(svgEl);
    return () => ro.disconnect();
  }, [svgEl, commitViewBox]);

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
      const goal = bboxToViewBox(targetBBox, aspect);
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
  const baseWidth = bboxToViewBox(initialBBox, containerAspect).w;
  const zoomRatio = Math.max(
    0.5,
    Math.min(MAX_ZOOM_RATIO * 1.25, baseWidth / Math.max(0.25, viewBox.w)),
  );

  /** Scale current viewBox relatively (> 1 always zooms in, < 1 always zooms out) */
  const zoomByFactor = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-4) return;
      stopAnimations();
      const el = svgNodeRef.current;
      const r = el?.getBoundingClientRect();
      const aspect = r && r.width > 10 && r.height > 10 ? r.width / r.height : containerAspect;
      const initRect = bboxToViewBox(baseBBoxRef.current, aspect);
      const minW = initRect.w / MAX_ZOOM_RATIO;
      const maxW = initRect.w / MIN_ZOOM_RATIO;

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
        if (m) {
          anchorSvgX = prev.x + (clientX - m.rect.left - m.padX) / m.scale;
          anchorSvgY = prev.y + (clientY - m.rect.top - m.padY) / m.scale;
          fracX = Math.max(0, Math.min(1, (clientX - m.rect.left) / m.rect.width));
          fracY = Math.max(0, Math.min(1, (clientY - m.rect.top) / m.rect.height));
        }
      }

      commitViewBox({
        x: anchorSvgX - nextW * fracX,
        y: anchorSvgY - nextH * fracY,
        w: nextW,
        h: nextH,
      });
    },
    [containerAspect, stopAnimations, commitViewBox],
  );

  const setZoomAtPoint = useCallback(
    (nextZoomRatio: number, clientX?: number, clientY?: number) => {
      stopAnimations();
      const clampedZoom = Math.max(MIN_ZOOM_RATIO, Math.min(MAX_ZOOM_RATIO, nextZoomRatio));
      const el = svgNodeRef.current;
      const r = el?.getBoundingClientRect();
      const aspect = r && r.width > 10 && r.height > 10 ? r.width / r.height : containerAspect;
      const initRect = bboxToViewBox(baseBBoxRef.current, aspect);
      const newW = initRect.w / clampedZoom;
      const newH = initRect.h / clampedZoom;

      const cur = viewBoxRef.current;
      let anchorSvgX = cur.x + cur.w / 2;
      let anchorSvgY = cur.y + cur.h / 2;
      let fracX = 0.5;
      let fracY = 0.5;

      if (el && r && clientX != null && clientY != null) {
        const m = computeSvgMetrics(el, cur);
        if (m) {
          anchorSvgX = cur.x + (clientX - m.rect.left - m.padX) / m.scale;
          anchorSvgY = cur.y + (clientY - m.rect.top - m.padY) / m.scale;
          fracX = Math.max(0, Math.min(1, (clientX - m.rect.left) / m.rect.width));
          fracY = Math.max(0, Math.min(1, (clientY - m.rect.top) / m.rect.height));
        }
      }

      commitViewBox({
        x: anchorSvgX - newW * fracX,
        y: anchorSvgY - newH * fracY,
        w: newW,
        h: newH,
      });
    },
    [containerAspect, stopAnimations, commitViewBox],
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
          applyDomViewBox({
            ...prev,
            x: prev.x - dxScreen / m.scale,
            y: prev.y - dyScreen / m.scale,
          });
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
