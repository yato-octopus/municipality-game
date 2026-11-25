import { useCallback, useEffect, useRef, useState } from 'react';
import type { BBox } from '../types/game';

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
}: UseMapViewportOptions) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [containerAspect, setContainerAspect] = useState(1.4);
  const baseBBoxRef = useRef<BBox>(initialBBox);

  const [viewBox, setViewBox] = useState<ViewBoxRect>(() =>
    bboxToViewBox(initialBBox, 1.4),
  );
  const viewBoxRef = useRef<ViewBoxRect>(viewBox);
  useEffect(() => {
    viewBoxRef.current = viewBox;
  }, [viewBox]);

  const animRafRef = useRef<number | null>(null);

  const stopAnimations = useCallback(() => {
    if (animRafRef.current != null) {
      cancelAnimationFrame(animRafRef.current);
      animRafRef.current = null;
    }
  }, []);

  // Keep SVG viewBox aspect matched 1:1 to rendered container box (prevents letterboxing drift when tray/window resizes)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    let prevW = 0;
    let prevH = 0;
    const updateSize = () => {
      const r = el.getBoundingClientRect();
      if (r.width <= 10 || r.height <= 10) return;
      const nextAspect = r.width / r.height;
      setContainerAspect(nextAspect);
      if (prevW > 10 && prevH > 10 && (Math.abs(r.width - prevW) > 1 || Math.abs(r.height - prevH) > 1)) {
        setViewBox((cur) => {
          const cx = cur.x + cur.w / 2;
          const cy = cur.y + cur.h / 2;
          const newH = cur.w / nextAspect;
          return { x: cx - cur.w / 2, y: cy - newH / 2, w: cur.w, h: newH };
        });
      }
      prevW = r.width;
      prevH = r.height;
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitBBox = useCallback(
    (bbox: BBox) => {
      stopAnimations();
      baseBBoxRef.current = bbox;
      const el = svgRef.current;
      const r = el?.getBoundingClientRect();
      const aspect = r && r.width > 10 && r.height > 10 ? r.width / r.height : containerAspect;
      setViewBox(bboxToViewBox(bbox, aspect));
    },
    [containerAspect, stopAnimations],
  );

  // Refit smoothly when session's initialBBox changes
  useEffect(() => {
    fitBBox(initialBBox);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBBox[0], initialBBox[1], initialBBox[2], initialBBox[3]]);

  const animateToBBox = useCallback(
    (targetBBox: BBox, durationMs = 260) => {
      stopAnimations();
      const el = svgRef.current;
      const r = el?.getBoundingClientRect();
      const aspect = r && r.width > 10 && r.height > 10 ? r.width / r.height : containerAspect;
      const start = { ...viewBoxRef.current };
      const goal = bboxToViewBox(targetBBox, aspect);
      const t0 = performance.now();

      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / durationMs);
        const ease = 1 - (1 - p) * (1 - p) * (1 - p);
        setViewBox({
          x: start.x + (goal.x - start.x) * ease,
          y: start.y + (goal.y - start.y) * ease,
          w: start.w + (goal.w - start.w) * ease,
          h: start.h + (goal.h - start.h) * ease,
        });
        if (p < 1) {
          animRafRef.current = requestAnimationFrame(step);
        } else {
          animRafRef.current = null;
        }
      };
      animRafRef.current = requestAnimationFrame(step);
    },
    [containerAspect, stopAnimations],
  );

  /** Zoom ratio relative to initial bbox width (>= 1 means zoomed in) */
  const baseWidth = bboxToViewBox(initialBBox, containerAspect).w;
  const zoomRatio = Math.max(0.5, Math.min(60, baseWidth / Math.max(1, viewBox.w)));

  const setZoomAtPoint = useCallback(
    (nextZoomRatio: number, clientX?: number, clientY?: number) => {
      stopAnimations();
      const clampedZoom = Math.max(0.65, Math.min(48, nextZoomRatio));
      const el = svgRef.current;
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

      setViewBox({
        x: anchorSvgX - newW * fracX,
        y: anchorSvgY - newH * fracY,
        w: newW,
        h: newH,
      });
    },
    [containerAspect, stopAnimations],
  );

  const panByScreenDelta = useCallback(
    (dxScreen: number, dyScreen: number) => {
      stopAnimations();
      const el = svgRef.current;
      if (!el) return;
      setViewBox((prev) => {
        const m = computeSvgMetrics(el, prev);
        if (!m || m.scale <= 0) return prev;
        return {
          ...prev,
          x: prev.x - dxScreen / m.scale,
          y: prev.y - dyScreen / m.scale,
        };
      });
    },
    [stopAnimations],
  );

  const startInertia = useCallback(
    (vxScreenPerMs: number, vyScreenPerMs: number) => {
      stopAnimations();
      if (dragInertia <= 0.02) return;
      const el = svgRef.current;
      if (!el) return;

      let vx = vxScreenPerMs * dragInertia;
      let vy = vyScreenPerMs * dragInertia;
      let last = performance.now();
      const minInterval = fpsMode === 'low' ? 30 : 0;

      const tick = (now: number) => {
        const dt = now - last;
        if (dt < minInterval) {
          animRafRef.current = requestAnimationFrame(tick);
          return;
        }
        last = now;
        const decay = Math.pow(0.88, Math.max(0.5, dt / 16));
        vx *= decay;
        vy *= decay;
        if (Math.hypot(vx, vy) < 0.015) {
          animRafRef.current = null;
          return;
        }
        setViewBox((prev) => {
          const m = computeSvgMetrics(el, prev);
          if (!m || m.scale <= 0) return prev;
          return {
            ...prev,
            x: prev.x - (vx * dt) / m.scale,
            y: prev.y - (vy * dt) / m.scale,
          };
        });
        animRafRef.current = requestAnimationFrame(tick);
      };
      animRafRef.current = requestAnimationFrame(tick);
    },
    [dragInertia, fpsMode, stopAnimations],
  );

  const clientToSvg = useCallback((clientX: number, clientY: number): [number, number] => {
    const el = svgRef.current;
    if (!el) return [0, 0];
    const vb = viewBoxRef.current;
    const m = computeSvgMetrics(el, vb);
    if (!m || m.scale <= 0) return [vb.x, vb.y];
    return [
      vb.x + (clientX - m.rect.left - m.padX) / m.scale,
      vb.y + (clientY - m.rect.top - m.padY) / m.scale,
    ];
  }, []);

  const svgScalePxPerUnit = useCallback((): number => {
    const el = svgRef.current;
    if (!el) return 1;
    const m = computeSvgMetrics(el, viewBoxRef.current);
    return m ? m.scale : 1;
  }, []);

  useEffect(() => () => stopAnimations(), [stopAnimations]);

  return {
    svgRef,
    viewBox,
    viewBoxString: `${viewBox.x.toFixed(2)} ${viewBox.y.toFixed(2)} ${viewBox.w.toFixed(2)} ${viewBox.h.toFixed(2)}`,
    zoomRatio,
    fitBBox,
    animateToBBox,
    setZoomAtPoint,
    panByScreenDelta,
    startInertia,
    clientToSvg,
    svgScalePxPerUnit,
  };
}
