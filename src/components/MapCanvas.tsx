import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { getPrefMutedFill } from '../data/prefColors';
import type { ViewBoxRect } from '../hooks/useMapViewport';
import type { InsetBoxSpec } from '../services/mapDataLoader';
import type {
  ConfigState,
  GeographyFeature,
  HintAreaOverlay,
  MapPieceItem,
  MapTag,
} from '../types/game';

interface SafariGestureEvent extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

interface MapCanvasProps {
  svgRef: React.RefCallback<SVGSVGElement>;
  viewBox: ViewBoxRect;
  viewBoxString: string;
  targetPieces: MapPieceItem[];
  /** Full geographic pool for the active mode so subset/review puzzles don't spoil target holes */
  poolPieces?: MapPieceItem[];
  contextPieces: MapPieceItem[];
  bgPrefPieces: MapPieceItem[];
  insets: InsetBoxSpec[];
  completedIds: Set<string>;
  activePieceId: string | null;
  hintPieceId: string | null;
  selectedPieceId: string | null;
  config: ConfigState;
  tags: MapTag[];
  /** Override showing all piece names (e.g. ViewMode) */
  forceShowNames?: boolean;
  /** ViewMode capital pin display */
  showCapitalMarks?: boolean;
  /** ViewMode swap label from prefecture to capital */
  swapCapitalLabel?: boolean;
  /** Optional custom highlight IDs (e.g. ViewMode selection or Puzzle snap preview) */
  hoverTargetId?: string | null;
  isTerrainMode?: boolean;
  enablePrefHoverTooltip?: boolean;
  enablePrefTint?: boolean;
  hintArea?: HintAreaOverlay | null;
  hintFittedPieceId?: string | null;
  onPieceClick?: (piece: MapPieceItem) => void;
  onPanBy: (dx: number, dy: number) => void;
  onFinishPan: (vx: number, vy: number) => void;
  onZoomByFactor: (factor: number, clientX?: number, clientY?: number) => void;
}

const HYPSOMETRIC_PALETTE = [
  '#a7d996',
  '#bfe19b',
  '#d7e69d',
  '#ebe098',
  '#f0cc7f',
  '#e7b16a',
  '#d7935b',
  '#c47a4d',
];

function getHypsometricColor(piece: MapPieceItem): string {
  // Deterministic topographic tint per piece combining hash + area
  let h = 0;
  for (let i = 0; i < piece.id.length; i += 1) {
    h = (h * 31 + piece.id.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % HYPSOMETRIC_PALETTE.length;
  return HYPSOMETRIC_PALETTE[idx];
}

type TerrainCategory = GeographyFeature['category'];

const LABEL_TO_GEO_CATEGORY: Record<string, TerrainCategory> = {
  山: 'mountain',
  '山脈・山地・高地': 'mountains',
  河川: 'river',
  平野: 'plain',
  湖: 'lake',
};

const TERRAIN_CATEGORY_ORDER: Record<TerrainCategory, number> = {
  plain: 0,
  mountains: 1,
  river: 2,
  lake: 3,
  mountain: 4,
};

function resolveGeoCategory(piece: MapPieceItem): TerrainCategory {
  return piece.geoCategory ?? LABEL_TO_GEO_CATEGORY[piece.regionLabel] ?? 'mountain';
}

function getMountainPeakHalfWidth(viewBoxW: number): number {
  return Math.max(2.6, Math.min(7.5, viewBoxW * 0.0085));
}

function computeTerrainGeomCache(piece: MapPieceItem): { ptsStr: string; rawSpan: number } {
  const pts = piece.linePts ?? [];
  if (pts.length === 0) {
    return {
      ptsStr: '',
      rawSpan: Math.max(piece.bbox[2] - piece.bbox[0], piece.bbox[3] - piece.bbox[1]),
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const parts: string[] = new Array(pts.length);
  for (let i = 0; i < pts.length; i += 1) {
    const [x, y] = pts[i];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    parts[i] = `${x.toFixed(2)},${y.toFixed(2)}`;
  }
  const rawSpan = Number.isFinite(minX)
    ? Math.max(maxX - minX, maxY - minY)
    : Math.max(piece.bbox[2] - piece.bbox[0], piece.bbox[3] - piece.bbox[1]);
  return { ptsStr: parts.join(' '), rawSpan };
}

const MapCanvasInner: React.FC<MapCanvasProps> = ({
  svgRef,
  viewBox,
  viewBoxString,
  targetPieces,
  poolPieces,
  contextPieces,
  bgPrefPieces,
  insets,
  completedIds,
  activePieceId,
  hintPieceId,
  selectedPieceId,
  config,
  tags,
  forceShowNames = false,
  showCapitalMarks = false,
  swapCapitalLabel = false,
  hoverTargetId = null,
  isTerrainMode = false,
  enablePrefHoverTooltip = false,
  enablePrefTint = false,
  hintArea = null,
  hintFittedPieceId = null,
  onPieceClick,
  onPanBy,
  onFinishPan,
  onZoomByFactor,
}) => {
  const localSvgRef = useRef<SVGSVGElement | null>(null);
  const prefTooltipRef = useRef<HTMLDivElement | null>(null);

  const hidePrefTooltip = useCallback(() => {
    const tip = prefTooltipRef.current;
    if (tip && tip.style.opacity !== '0') {
      tip.style.opacity = '0';
    }
  }, []);

  const mergedSvgRef = useCallback(
    (node: SVGSVGElement | null) => {
      localSvgRef.current = node;
      svgRef(node);
    },
    [svgRef],
  );

  // Sync committed viewBoxString to DOM without letting unrelated renders overwrite live pan/inertia viewBox
  useLayoutEffect(() => {
    const el = localSvgRef.current;
    if (el) {
      el.setAttribute('viewBox', viewBoxString);
    }
  }, [viewBoxString]);

  const dragRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    samples: { x: number; y: number; t: number }[];
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    samples: [],
  });

  const suppressClickRef = useRef(false);
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchPrevDistRef = useRef<number | null>(null);

  const onZoomByFactorRef = useRef(onZoomByFactor);
  const onPanByRef = useRef(onPanBy);
  const onFinishPanRef = useRef(onFinishPan);
  useEffect(() => {
    onZoomByFactorRef.current = onZoomByFactor;
    onPanByRef.current = onPanBy;
    onFinishPanRef.current = onFinishPan;
  });

  // Bind non-passive wheel & Safari gesture listeners for accurate trackpad pinch + mouse wheel zoom
  useEffect(() => {
    const el = localSvgRef.current;
    if (!el) return;

    let lastGestureScale = 1;
    let inSafariGesture = false;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (inSafariGesture && e.ctrlKey) return;
      // Ignore horizontal-only / zero-deltaY events (prevents shrinking during trackpad wobble)
      if (e.deltaY === 0) return;

      if (e.ctrlKey) {
        // Trackpad pinch gesture on Chrome/Firefox/Edge:
        // spreading fingers apart (zoom IN) -> deltaY < 0 -> factor > 1
        // pinching fingers together (zoom OUT) -> deltaY > 0 -> factor < 1
        const clamped = Math.max(-60, Math.min(60, e.deltaY));
        const factor = Math.exp(-clamped * 0.012);
        onZoomByFactorRef.current(factor, e.clientX, e.clientY);
      } else {
        // Mouse wheel or 2-finger vertical scroll
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= 400;
        const clamped = Math.max(-120, Math.min(120, dy));
        const factor = Math.exp(-clamped * 0.0028);
        onZoomByFactorRef.current(factor, e.clientX, e.clientY);
      }
    };

    const handleGestureStart = (ev: Event) => {
      const e = ev as SafariGestureEvent;
      e.preventDefault();
      inSafariGesture = true;
      lastGestureScale = e.scale || 1;
    };

    const handleGestureChange = (ev: Event) => {
      const e = ev as SafariGestureEvent;
      e.preventDefault();
      const nextScale = e.scale || 1;
      if (lastGestureScale > 0 && nextScale > 0) {
        const step = nextScale / lastGestureScale;
        lastGestureScale = nextScale;
        onZoomByFactorRef.current(step, e.clientX, e.clientY);
      }
    };

    const handleGestureEnd = (ev: Event) => {
      ev.preventDefault();
      inSafariGesture = false;
      lastGestureScale = 1;
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('gesturestart', handleGestureStart, { passive: false });
    el.addEventListener('gesturechange', handleGestureChange, { passive: false });
    el.addEventListener('gestureend', handleGestureEnd, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('gesturestart', handleGestureStart);
      el.removeEventListener('gesturechange', handleGestureChange);
      el.removeEventListener('gestureend', handleGestureEnd);
    };
  }, []);

  // Google-Maps-style global pointer tracking while left-click/touch dragging the map
  useEffect(() => {
    const handleWinMove = (e: PointerEvent) => {
      if (touchPointersRef.current.has(e.pointerId)) {
        touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (touchPointersRef.current.size === 2 && pinchPrevDistRef.current != null) {
        const pts = Array.from(touchPointersRef.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        if (pinchPrevDistRef.current > 5 && dist > 5) {
          onZoomByFactorRef.current(dist / pinchPrevDistRef.current, midX, midY);
          pinchPrevDistRef.current = dist;
        }
        return;
      }

      const d = dragRef.current;
      if (!d.active || (d.pointerId != null && e.pointerId !== d.pointerId)) return;
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) {
        d.moved = true;
        localSvgRef.current?.classList.add('is-panning');
        if (prefTooltipRef.current && prefTooltipRef.current.style.opacity !== '0') {
          prefTooltipRef.current.style.opacity = '0';
        }
      }
      if (d.moved) {
        onPanByRef.current(dx, dy);
      }
      const now = performance.now();
      d.samples.push({ x: e.clientX, y: e.clientY, t: now });
      // Keep only recent 90ms window for accurate release velocity (zero stale-velocity jerk)
      while (d.samples.length > 2 && now - d.samples[0].t > 90) {
        d.samples.shift();
      }
      d.lastX = e.clientX;
      d.lastY = e.clientY;
    };

    const handleWinUp = (e: PointerEvent) => {
      touchPointersRef.current.delete(e.pointerId);
      if (touchPointersRef.current.size < 2) {
        pinchPrevDistRef.current = null;
      }
      const d = dragRef.current;
      if (d.active && (d.pointerId == null || e.pointerId === d.pointerId)) {
        localSvgRef.current?.classList.remove('is-panning');
        if (d.moved) {
          suppressClickRef.current = true;
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 80);

          const now = performance.now();
          let vx = 0;
          let vy = 0;
          const newest = d.samples[d.samples.length - 1];
          // Only coast if the pointer was still actively moving within the last 45ms
          if (newest && now - newest.t < 45 && d.samples.length >= 2) {
            const oldest = d.samples[0];
            const spanMs = newest.t - oldest.t;
            if (spanMs >= 8) {
              vx = (newest.x - oldest.x) / spanMs;
              vy = (newest.y - oldest.y) / spanMs;
            }
          }
          onFinishPanRef.current(vx, vy);
        }
        d.active = false;
        d.pointerId = null;
        d.samples = [];
      }
    };

    window.addEventListener('pointermove', handleWinMove);
    window.addEventListener('pointerup', handleWinUp);
    window.addEventListener('pointercancel', handleWinUp);
    return () => {
      window.removeEventListener('pointermove', handleWinMove);
      window.removeEventListener('pointerup', handleWinUp);
      window.removeEventListener('pointercancel', handleWinUp);
    };
  }, []);

  const activePoolPieces = poolPieces ?? targetPieces;
  const poolIdSet = useMemo(
    () => new Set(activePoolPieces.map((p) => p.id)),
    [activePoolPieces],
  );
  const taggedIdSet = useMemo(() => {
    const s = new Set<string>();
    if (!config.showTag) return s;
    for (const t of tags) {
      for (const pid of t.pieceIds) s.add(pid);
    }
    return s;
  }, [tags, config.showTag]);

  const insetMap = useMemo(() => {
    const m = new Map<'okinawa' | 'izu' | 'ogasawara', InsetBoxSpec>();
    for (const ins of insets) m.set(ins.id, ins);
    return m;
  }, [insets]);

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    hidePrefTooltip();
    if (e.pointerType === 'mouse') {
      e.preventDefault();
    }
    touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPointersRef.current.size === 2) {
      const pts = Array.from(touchPointersRef.current.values());
      pinchPrevDistRef.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      dragRef.current.active = false;
      localSvgRef.current?.classList.remove('is-panning');
      return;
    }
    const now = performance.now();
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      samples: [{ x: e.clientX, y: e.clientY, t: now }],
    };
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!enablePrefHoverTooltip) return;
    const tip = prefTooltipRef.current;
    if (!tip) return;
    if (dragRef.current.moved || e.pointerType === 'touch') {
      if (tip.style.opacity !== '0') {
        tip.style.opacity = '0';
      }
      return;
    }

    let prefName = '';
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    for (let i = 0; i < els.length; i += 1) {
      const el = els[i];
      const attr = el.getAttribute('data-pref-name');
      if (attr) {
        prefName = attr;
        break;
      }
      if (el.hasAttribute('data-inset-ocean')) {
        break;
      }
    }

    if (!prefName) {
      if (tip.style.opacity !== '0') {
        tip.style.opacity = '0';
      }
      return;
    }

    if (tip.textContent !== prefName) {
      tip.textContent = prefName;
    }
    const tipW = tip.offsetWidth || 84;
    const tipH = tip.offsetHeight || 28;
    const pad = 8;
    const preferredX =
      e.clientX + 14 + tipW + pad > window.innerWidth
        ? e.clientX - tipW - 14
        : e.clientX + 14;
    const preferredY = e.clientY - 34 < pad ? e.clientY + 18 : e.clientY - 34;
    const x = Math.max(pad, Math.min(window.innerWidth - tipW - pad, preferredX));
    const y = Math.max(pad, Math.min(window.innerHeight - tipH - pad, preferredY));
    tip.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    if (tip.style.opacity !== '1') {
      tip.style.opacity = '1';
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    onZoomByFactor(1.65, e.clientX, e.clientY);
  };

  const tryPieceClick = (piece: MapPieceItem) => {
    if (dragRef.current.moved || suppressClickRef.current) return;
    onPieceClick?.(piece);
  };

  // Partition non-terrain context pieces by whether they belong in an inset box
  const { mainPieces, okiPieces, izuPieces, ogaPieces, hidePref13Bg, hidePref47Bg } =
    useMemo(() => {
      const main: MapPieceItem[] = [];
      const oki: MapPieceItem[] = [];
      const izu: MapPieceItem[] = [];
      const oga: MapPieceItem[] = [];
      const okiSpec = insetMap.get('okinawa');
      const izuSpec = insetMap.get('izu');
      const ogaSpec = insetMap.get('ogasawara');

      const hasMainMunisOfTokyo = contextPieces.some((p) => p.prefCode === '13' && p.id === '13101');

      for (const p of contextPieces) {
        if (isTerrainMode) continue;
        if (p.isOkinawa && okiSpec) {
          oki.push(p);
        } else if (p.id >= '13361' && p.id <= '13402' && izuSpec) {
          izu.push(p);
        } else if (p.id === '13421' && ogaSpec) {
          oga.push(p);
        } else {
          main.push(p);
        }
      }
      return {
        mainPieces: main,
        okiPieces: oki,
        izuPieces: izu,
        ogaPieces: oga,
        hidePref13Bg: hasMainMunisOfTokyo && (Boolean(izuSpec) || Boolean(ogaSpec)),
        hidePref47Bg: Boolean(okiSpec) && bgPrefPieces.some((p) => p.id === 'pref_47'),
      };
    }, [contextPieces, insetMap, isTerrainMode, bgPrefPieces]);

  const isPrefDirectMode = useMemo(
    () =>
      !isTerrainMode &&
      bgPrefPieces.length > 0 &&
      contextPieces.length === bgPrefPieces.length &&
      contextPieces.every((p) => p.id.startsWith('pref_')),
    [isTerrainMode, bgPrefPieces.length, contextPieces],
  );

  const showPrefBorderOverlay =
    enablePrefTint &&
    !isTerrainMode &&
    bgPrefPieces.length > 0 &&
    !isPrefDirectMode &&
    config.showBorder;

  const getPieceStyle = (piece: MapPieceItem) => {
    const isCompleted = completedIds.has(piece.id);
    const isActive = activePieceId === piece.id;
    const isHint = hintPieceId === piece.id;
    const isHintFitted = hintFittedPieceId === piece.id;
    const isSelected = selectedPieceId === piece.id;
    const isHover = hoverTargetId === piece.id;
    const isInPool = poolIdSet.has(piece.id);

    let fill = config.silhouette
      ? enablePrefTint
        ? getPrefMutedFill(piece.prefCode, false)
        : '#fbfaf6'
      : getHypsometricColor(piece);
    let stroke = config.showBorder ? '#475569' : fill;
    let strokeWidth = config.showBorder ? 0.9 : 0.65;

    if (!isInPool && contextPieces.length > activePoolPieces.length) {
      // Context piece outside current geographic sub-region or non-city town/village in cities mode
      fill = config.silhouette
        ? enablePrefTint
          ? getPrefMutedFill(piece.prefCode, true)
          : '#ebeae4'
        : '#d6dccb';
      stroke = config.showBorder ? '#94a3b8' : fill;
      strokeWidth = enablePrefTint && config.silhouette ? 0.6 : 0.65;
    }

    if (isCompleted) {
      fill = config.silhouette ? '#bbf7d0' : '#4ade80';
      stroke = config.showBorder ? '#0f766e' : fill;
      strokeWidth = config.showBorder ? 1.05 : 0.7;
    }
    if (isHover) {
      fill = '#fde68a';
      stroke = '#d97706';
      strokeWidth = 1.8;
    }
    if (isSelected) {
      fill = '#bae6fd';
      stroke = '#0284c7';
      strokeWidth = 1.6;
    }
    if (isActive) {
      fill = '#fed7aa';
      stroke = '#ea580c';
      strokeWidth = 2.0;
    }
    if (isHint) {
      fill = '#fca5a5';
      stroke = '#dc2626';
      strokeWidth = 2.4;
    }
    if (isHintFitted) {
      fill = '#86efac';
      stroke = '#059669';
      strokeWidth = 2.4;
    }

    return { fill, stroke, strokeWidth };
  };

  const labelFontSize = Math.max(1.2, Math.min(13, viewBox.w / 62));
  const smallHitRadius = Math.max(1.3, viewBox.w * 0.0085);

  const renderPiecePath = (piece: MapPieceItem) => {
    const st = getPieceStyle(piece);
    const clickable = Boolean(onPieceClick);
    const isTiny = piece.areaPx < 3;
    const isHover = hoverTargetId === piece.id;
    const piecePrefName =
      piece.prefName || (piece.id.startsWith('pref_') ? piece.name : '');
    return (
      <g
        key={piece.id}
        onClick={() => tryPieceClick(piece)}
        className={clickable ? 'map-piece-clickable' : undefined}
      >
        <path
          data-piece-id={piece.id}
          data-pref-name={piecePrefName}
          d={piece.path}
          fill={st.fill}
          fillRule="evenodd"
          stroke={st.stroke}
          strokeWidth={st.strokeWidth}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        {isTiny && (
          <circle
            data-piece-id={piece.id}
            data-pref-name={piecePrefName}
            cx={piece.center[0]}
            cy={piece.center[1]}
            r={smallHitRadius}
            fill="transparent"
            stroke={isHover ? '#d97706' : 'none'}
            strokeWidth={isHover ? 1.4 : 0}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </g>
    );
  };

  const renderPieceRawGroup = (
    pieces: MapPieceItem[],
    inset?: InsetBoxSpec,
  ) => {
    if (pieces.length === 0) return null;
    if (!inset) {
      return pieces.map((piece) => renderPiecePath(piece));
    }
    return (
      <g key={`inset-group-${inset.id}`} clipPath={`url(#${inset.clipId})`}>
        <g transform={`translate(${inset.tx.toFixed(3)}, ${inset.ty.toFixed(3)}) scale(${inset.scale.toFixed(5)})`}>
          {pieces.map((piece) => {
            const st = getPieceStyle(piece);
            const isTiny = piece.areaPx < 3;
            const isHover = hoverTargetId === piece.id;
            const piecePrefName =
              piece.prefName || (piece.id.startsWith('pref_') ? piece.name : '');
            return (
              <g
                key={piece.id}
                onClick={() => tryPieceClick(piece)}
                className={onPieceClick ? 'map-piece-clickable' : undefined}
              >
                <path
                  data-piece-id={piece.id}
                  data-pref-name={piecePrefName}
                  d={piece.path}
                  fill={st.fill}
                  fillRule="evenodd"
                  stroke={st.stroke}
                  strokeWidth={st.strokeWidth}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                />
                {isTiny && (
                  <circle
                    data-piece-id={piece.id}
                    data-pref-name={piecePrefName}
                    cx={
                      piece.id === '13421'
                        ? 647.06
                        : (piece.center[0] - inset.tx) / inset.scale
                    }
                    cy={
                      piece.id === '13421'
                        ? 1011.79
                        : (piece.center[1] - inset.ty) / inset.scale
                    }
                    r={Math.max(1.2, smallHitRadius / inset.scale)}
                    fill="transparent"
                    stroke={isHover ? '#d97706' : 'none'}
                    strokeWidth={isHover ? 1.2 : 0}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            );
          })}
        </g>
      </g>
    );
  };

  const renderBgPrefPath = (pref: MapPieceItem, keyPrefix: string) => {
    const useTint = enablePrefTint && config.silhouette;
    const fill = useTint
      ? getPrefMutedFill(pref.prefCode, false)
      : config.silhouette
        ? '#ecebe4'
        : '#dfe4d5';
    const stroke = config.showBorder
      ? useTint
        ? '#475569'
        : '#94a3b8'
      : fill;
    const strokeWidth = useTint ? 0.9 : 0.7;
    return (
      <path
        key={`${keyPrefix}-${pref.id}`}
        data-pref-name={pref.name}
        d={pref.path}
        fill={fill}
        fillRule="evenodd"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        pointerEvents={enablePrefHoverTooltip ? 'visiblePainted' : 'none'}
      />
    );
  };

  const renderBgPrefectures = () => {
    if (isPrefDirectMode) return null;
    const okiSpec = insetMap.get('okinawa');
    return bgPrefPieces.map((pref) => {
      if (hidePref13Bg && pref.id === 'pref_13') return null;
      if (pref.isOkinawa && hidePref47Bg) return null;
      if (pref.isOkinawa && okiSpec) {
        return (
          <g
            key={`bg-${pref.id}`}
            clipPath={`url(#${okiSpec.clipId})`}
            transform={`translate(${okiSpec.tx.toFixed(3)}, ${okiSpec.ty.toFixed(3)}) scale(${okiSpec.scale.toFixed(5)})`}
          >
            {renderBgPrefPath(pref, 'bg-oki')}
          </g>
        );
      }
      return renderBgPrefPath(pref, 'bg');
    });
  };

  const terrainGeomMap = useMemo(() => {
    const map = new Map<string, { ptsStr: string; rawSpan: number }>();
    if (!isTerrainMode) return map;
    for (const p of contextPieces) {
      map.set(p.id, computeTerrainGeomCache(p));
    }
    return map;
  }, [isTerrainMode, contextPieces]);

  const orderedTerrainPieces = useMemo(() => {
    if (!isTerrainMode) return [];
    const statusRank = (id: string): number => {
      if (id === hintFittedPieceId) return 4;
      if (id === hintPieceId || id === activePieceId) return 3;
      if (id === selectedPieceId) return 2;
      if (completedIds.has(id)) return 1;
      return 0;
    };
    return [...contextPieces].sort((a, b) => {
      const sa = statusRank(a.id);
      const sb = statusRank(b.id);
      if (sa !== sb) return sa - sb;
      return TERRAIN_CATEGORY_ORDER[resolveGeoCategory(a)] - TERRAIN_CATEGORY_ORDER[resolveGeoCategory(b)];
    });
  }, [isTerrainMode, contextPieces, completedIds, activePieceId, hintPieceId, hintFittedPieceId, selectedPieceId]);

  const renderTerrainLayer = () => {
    if (!isTerrainMode) return null;
    const clickableClass = onPieceClick ? 'map-piece-clickable' : undefined;
    const baseMountainHw = getMountainPeakHalfWidth(viewBox.w);

    return (
      <g>
        {orderedTerrainPieces.map((f) => {
          const isCompleted = completedIds.has(f.id);
          const isActive = activePieceId === f.id;
          const isHint = hintPieceId === f.id;
          const isHintFitted = hintFittedPieceId === f.id;
          const isSelected = selectedPieceId === f.id;
          const highlighted = isHintFitted || isActive || isHint;
          const cat = resolveGeoCategory(f);
          const hasPath = Boolean(f.path && f.path.trim().length > 0);
          const pts = f.linePts ?? [];
          const cached = terrainGeomMap.get(f.id);
          const ptsStr = cached?.ptsStr ?? '';
          const rawSpan =
            cached?.rawSpan ?? Math.max(f.bbox[2] - f.bbox[0], f.bbox[3] - f.bbox[1]);

          if (cat === 'mountain') {
            const [cx, cy] = f.center;
            const hw = isHintFitted
              ? baseMountainHw * 1.24
              : highlighted
                ? baseMountainHw * 1.18
                : isSelected
                  ? baseMountainHw * 1.1
                  : baseMountainHw;
            const h = hw * 1.55;
            const apexY = cy - (h * 2) / 3;
            const baseY = cy + h / 3;
            const peakPts = `${cx.toFixed(2)},${apexY.toFixed(2)} ${(cx - hw).toFixed(2)},${baseY.toFixed(2)} ${(cx + hw).toFixed(2)},${baseY.toFixed(2)}`;
            const sY = apexY + h * 0.36;
            const sYLow = apexY + h * 0.44;
            const sW = hw * 0.36;
            const snowPts = `${cx.toFixed(2)},${apexY.toFixed(2)} ${(cx - sW).toFixed(2)},${sY.toFixed(2)} ${(cx - sW * 0.32).toFixed(2)},${sYLow.toFixed(2)} ${cx.toFixed(2)},${(apexY + h * 0.34).toFixed(2)} ${(cx + sW * 0.32).toFixed(2)},${sYLow.toFixed(2)} ${(cx + sW).toFixed(2)},${sY.toFixed(2)}`;

            const fill = isHintFitted
              ? '#10b981'
              : isHint
                ? '#dc2626'
                : isActive
                  ? '#ea580c'
                  : isSelected
                    ? '#0284c7'
                    : isCompleted
                      ? '#15803d'
                      : '#b45309';
            const fillOpacity = highlighted || isSelected ? 1 : isCompleted ? 0.96 : 0.82;
            const outline = isHintFitted
              ? '#059669'
              : isHint
                ? '#7f1d1d'
                : isActive
                  ? '#9a3412'
                  : isSelected
                    ? '#0c4a6e'
                    : isCompleted
                      ? '#14532d'
                      : '#78350f';

            return (
              <g
                key={f.id}
                onClick={() => tryPieceClick(f)}
                className={clickableClass}
              >
                <polygon
                  points={peakPts}
                  fill="#ffffff"
                  stroke="#ffffff"
                  strokeWidth={isHintFitted ? 5.2 : highlighted ? 4.4 : isCompleted || isSelected ? 3.2 : 2.6}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  opacity={highlighted || isCompleted || isSelected ? 0.98 : 0.84}
                />
                <polygon
                  points={peakPts}
                  fill={fill}
                  fillOpacity={fillOpacity}
                  stroke={outline}
                  strokeOpacity={highlighted || isCompleted || isSelected ? 1 : 0.88}
                  strokeWidth={isHintFitted ? 1.8 : highlighted ? 1.5 : 1.0}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                <polygon
                  points={snowPts}
                  fill="#ffffff"
                  fillOpacity={highlighted ? 0.94 : isCompleted ? 0.88 : 0.78}
                  pointerEvents="none"
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={Math.max(hw * 1.5, viewBox.w * 0.012)}
                  fill="transparent"
                />
                {(isHint || isActive) && !isHintFitted && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={Math.max(hw * 2.0, viewBox.w * 0.022)}
                    fill="none"
                    stroke={isHint ? '#dc2626' : '#ea580c'}
                    strokeWidth={2.0}
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                )}
              </g>
            );
          }

          if (cat === 'plain') {
            if (!hasPath && pts.length < 3) return null;
            const fill = isHintFitted
              ? '#10b981'
              : isHint
                ? '#f97316'
                : isActive
                  ? '#84cc16'
                  : isSelected
                    ? '#38bdf8'
                    : isCompleted
                      ? '#22c55e'
                      : '#65a30d';
            const fillOpacity = isHintFitted
              ? 0.62
              : isHint
                ? 0.52
                : isActive
                  ? 0.58
                  : isSelected
                    ? 0.44
                    : isCompleted
                      ? 0.5
                      : 0.26;
            const stroke = isHintFitted
              ? '#059669'
              : isHint
                ? '#dc2626'
                : isActive
                  ? '#ea580c'
                  : isSelected
                    ? '#0284c7'
                    : isCompleted
                      ? '#15803d'
                      : '#4d7c0f';
            const strokeOpacity = highlighted || isSelected ? 1 : isCompleted ? 0.86 : 0.48;
            const strokeWidth = isHintFitted
              ? 2.9
              : isHint
                ? 2.7
                : isActive
                  ? 2.4
                  : isSelected
                    ? 2.0
                    : isCompleted
                      ? 1.35
                      : 0.9;
            const showHalo = highlighted || isSelected;
            const haloWidth = isHintFitted ? 5.8 : isHint ? 5.2 : isActive ? 4.8 : 4.0;

            return (
              <g
                key={f.id}
                onClick={() => tryPieceClick(f)}
                className={clickableClass}
              >
                {showHalo &&
                  (hasPath ? (
                    <path
                      d={f.path}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={0.94}
                      strokeWidth={haloWidth}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ) : (
                    <polygon
                      points={ptsStr}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={0.94}
                      strokeWidth={haloWidth}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ))}
                {hasPath ? (
                  <path
                    d={f.path}
                    fill={fill}
                    fillOpacity={fillOpacity}
                    fillRule="evenodd"
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <polygon
                    points={ptsStr}
                    fill={fill}
                    fillOpacity={fillOpacity}
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            );
          }

          if (cat === 'lake') {
            if (!hasPath && pts.length < 3) return null;
            const isSmallLake = rawSpan < viewBox.w * 0.04;
            const isVerySmallLake = rawSpan < Math.max(12, viewBox.w * 0.025);
            const showHalo = highlighted || isSelected || isVerySmallLake;
            const haloWidth = isHintFitted
              ? isSmallLake
                ? 8.8
                : 7.8
              : isHint
                ? isSmallLake
                  ? 8.4
                  : 7.4
                : isActive
                  ? isSmallLake
                    ? 7.8
                    : 6.8
                  : isSelected
                    ? isSmallLake
                      ? 6.4
                      : 5.6
                    : isCompleted
                      ? 4.0
                      : 3.0;
            const haloOpacity = highlighted
              ? 0.96
              : isSelected
                ? 0.9
                : isCompleted
                  ? 0.78
                  : 0.54;

            const fill = isHintFitted
              ? '#10b981'
              : isHint
                ? '#38bdf8'
                : isActive
                  ? '#0ea5e9'
                  : isSelected
                    ? '#38bdf8'
                    : '#0284c7';
            const fillOpacity = isHintFitted
              ? 0.98
              : isHint
                ? 0.96
                : isActive
                  ? 0.95
                  : isSelected
                    ? 0.92
                    : isCompleted
                      ? 0.88
                      : 0.66;
            const stroke = isHintFitted
              ? '#059669'
              : isHint
                ? '#dc2626'
                : isActive
                  ? '#ea580c'
                  : isSelected
                    ? '#0369a1'
                    : isCompleted
                      ? '#0c4a6e'
                      : '#0369a1';
            const strokeOpacity = highlighted || isSelected ? 1 : isCompleted ? 0.95 : 0.82;
            const strokeWidth = isHintFitted
              ? isSmallLake
                ? 5.2
                : 4.6
              : isHint
                ? isSmallLake
                  ? 5.0
                  : 4.4
                : isActive
                  ? isSmallLake
                    ? 4.6
                    : 4.0
                  : isSelected
                    ? 3.6
                    : isCompleted
                      ? 2.4
                      : isVerySmallLake
                        ? 2.0
                        : 1.6;

            return (
              <g
                key={f.id}
                onClick={() => tryPieceClick(f)}
                className={clickableClass}
              >
                {showHalo &&
                  (hasPath ? (
                    <path
                      d={f.path}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={haloOpacity}
                      strokeWidth={haloWidth}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ) : (
                    <polygon
                      points={ptsStr}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={haloOpacity}
                      strokeWidth={haloWidth}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ))}
                {hasPath ? (
                  <path
                    d={f.path}
                    fill={fill}
                    fillOpacity={fillOpacity}
                    fillRule="evenodd"
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <polygon
                    points={ptsStr}
                    fill={fill}
                    fillOpacity={fillOpacity}
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {isVerySmallLake && (
                  <circle
                    cx={f.center[0]}
                    cy={f.center[1]}
                    r={Math.max(4.5, viewBox.w * 0.014)}
                    fill="transparent"
                  />
                )}
                {(isHint || isActive) && !isHintFitted && isSmallLake && (
                  <circle
                    cx={f.center[0]}
                    cy={f.center[1]}
                    r={Math.max(
                      rawSpan * 0.8 + viewBox.w * 0.008,
                      Math.max(4.5, viewBox.w * 0.02),
                    )}
                    fill="none"
                    stroke={isHint ? '#dc2626' : '#ea580c'}
                    strokeWidth={2.0}
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                )}
              </g>
            );
          }

          if (cat === 'river') {
            if (!hasPath && pts.length < 2) return null;
            const showCasing = highlighted || isSelected || isCompleted;
            const casingWidth = isHintFitted
              ? 7.4
              : isHint
                ? 6.6
                : isActive
                  ? 6.0
                  : isSelected
                    ? 5.2
                    : 4.2;
            const casingOpacity = highlighted ? 0.96 : isSelected ? 0.92 : 0.82;
            const stroke = isHintFitted
              ? '#059669'
              : isHint
                ? '#dc2626'
                : isActive
                  ? '#ea580c'
                  : isSelected
                    ? '#0284c7'
                    : isCompleted
                      ? '#1d4ed8'
                      : '#2563eb';
            const strokeOpacity = highlighted || isSelected ? 1 : isCompleted ? 0.94 : 0.42;
            const strokeWidth = isHintFitted
              ? 4.2
              : isHint
                ? 3.9
                : isActive
                  ? 3.6
                  : isSelected
                    ? 3.1
                    : isCompleted
                      ? 2.4
                      : 1.8;

            return (
              <g
                key={f.id}
                onClick={() => tryPieceClick(f)}
                className={clickableClass}
              >
                {showCasing &&
                  (hasPath ? (
                    <path
                      d={f.path}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={casingOpacity}
                      strokeWidth={casingWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ) : (
                    <polyline
                      points={ptsStr}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={casingOpacity}
                      strokeWidth={casingWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ))}
                {hasPath ? (
                  <path
                    d={f.path}
                    fill="none"
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <polyline
                    points={ptsStr}
                    fill="none"
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {hasPath ? (
                  <path
                    d={f.path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={10}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <polyline
                    points={ptsStr}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={10}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            );
          }

          // mountains (山脈・山地・高地)
          if (!hasPath && pts.length < 2) return null;
          const zoneFill = isHintFitted
            ? '#10b981'
            : isSelected
              ? '#0284c7'
              : '#9a3412';
          const zoneFillOpacity = isHintFitted
            ? 0.48
            : isHint
              ? 0.48
              : isActive
                ? 0.46
                : isSelected
                  ? 0.28
                  : isCompleted
                    ? 0.34
                    : 0.18;
          const zoneStroke = isHintFitted
            ? '#059669'
            : isHint
              ? '#dc2626'
              : isActive
                ? '#ea580c'
                : isSelected
                  ? '#0284c7'
                  : isCompleted
                    ? '#7c2d12'
                    : '#9a3412';
          const zoneStrokeOpacity = highlighted || isSelected ? 0.95 : isCompleted ? 0.55 : 0.28;
          const zoneStrokeWidth = isHintFitted
            ? 2.2
            : isHint
              ? 2.0
              : isActive
                ? 1.7
                : isSelected
                  ? 1.6
                  : isCompleted
                    ? 1.1
                    : 0.8;

          const ridgeStroke = isHintFitted
            ? '#059669'
            : isHint
              ? '#dc2626'
              : isActive
                ? '#ea580c'
                : isSelected
                  ? '#0284c7'
                  : '#7c2d12';
          const ridgeOpacity = highlighted || isSelected ? 1 : isCompleted ? 0.9 : 0.56;
          const ridgeWidth = isHintFitted
            ? 4.0
            : isHint
              ? 3.7
              : isActive
                ? 3.4
                : isSelected
                  ? 3.0
                  : isCompleted
                    ? 2.6
                    : 2.2;
          const showRidgeCasing = highlighted || isSelected;

          return (
            <g
              key={f.id}
              onClick={() => tryPieceClick(f)}
              className={clickableClass}
            >
              {hasPath && (
                <path
                  d={f.path}
                  fill={zoneFill}
                  fillOpacity={zoneFillOpacity}
                  fillRule="evenodd"
                  stroke={zoneStroke}
                  strokeOpacity={zoneStrokeOpacity}
                  strokeWidth={zoneStrokeWidth}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {pts.length >= 2 && showRidgeCasing && (
                <polyline
                  points={ptsStr}
                  fill="none"
                  stroke="#ffffff"
                  strokeOpacity={0.94}
                  strokeWidth={isHintFitted ? 6.8 : isHint ? 6.2 : isActive ? 5.8 : 4.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              )}
              {pts.length >= 2 && (
                <polyline
                  points={ptsStr}
                  fill="none"
                  stroke={ridgeStroke}
                  strokeOpacity={ridgeOpacity}
                  strokeWidth={ridgeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={highlighted || isCompleted ? '7 3' : '6 3'}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {pts.length >= 2 && (
                <polyline
                  points={ptsStr}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={10}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          );
        })}
      </g>
    );
  };

  // Pieces eligible to render names / capital pins / tags
  const overlayPieces = isTerrainMode ? contextPieces : contextPieces;
  const fittedMainPiece =
    !isTerrainMode && hintFittedPieceId
      ? mainPieces.find((p) => p.id === hintFittedPieceId) ?? null
      : null;

  return (
    <>
      <svg
        ref={mergedSvgRef}
        preserveAspectRatio="xMidYMid meet"
        className="map-canvas-svg"
        style={{
          background: config.silhouette ? '#dcebfa' : '#cfe5f7',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={hidePrefTooltip}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          {insets.map((ins) => (
            <clipPath key={ins.clipId} id={ins.clipId}>
              <rect
                x={ins.box[0]}
                y={ins.box[1]}
                width={ins.box[2] - ins.box[0]}
                height={ins.box[3] - ins.box[1]}
              />
            </clipPath>
          ))}
        </defs>

        {/* Background neighboring prefectures / blank map base */}
        {renderBgPrefectures()}

        {/* Main map vector paths */}
        {renderPieceRawGroup(mainPieces)}

        {/* Crisp prefecture borders above municipality maps */}
        {showPrefBorderOverlay && (
          <g className="pref-border-overlay" pointerEvents="none">
            {bgPrefPieces.map((pref) => {
              if (hidePref13Bg && pref.id === 'pref_13') return null;
              if (pref.isOkinawa && hidePref47Bg) return null;
              return (
                <path
                  key={`pref-border-${pref.id}`}
                  d={pref.path}
                  fill="none"
                  stroke="#334155"
                  strokeWidth={1.35}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              );
            })}
          </g>
        )}

        {/* Crisp white halo + emerald highlight for Hint 2 fitted piece above neighbors & borders */}
        {fittedMainPiece && (
          <g className="hint-fitted-shape" pointerEvents="none">
            <path
              d={fittedMainPiece.path}
              fill="none"
              stroke="#ffffff"
              strokeOpacity={0.96}
              strokeWidth={5.2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={fittedMainPiece.path}
              fill="#86efac"
              fillRule="evenodd"
              stroke="#059669"
              strokeWidth={2.4}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )}

        {/* Inset frames + transformed island vector paths */}
        {insets.map((ins) => {
          const w = ins.box[2] - ins.box[0];
          const h = ins.box[3] - ins.box[1];
          const boxPieces =
            ins.id === 'okinawa' ? okiPieces : ins.id === 'izu' ? izuPieces : ogaPieces;
          const insetBgPieces =
            ins.id === 'okinawa' && hidePref47Bg && !isPrefDirectMode
              ? bgPrefPieces.filter((p) => p.isOkinawa)
              : [];
          const fittedInsetPiece =
            !isTerrainMode && hintFittedPieceId
              ? boxPieces.find((p) => p.id === hintFittedPieceId) ?? null
              : null;
          return (
            <g key={`inset-frame-${ins.id}`}>
              <rect
                data-inset-ocean="true"
                x={ins.box[0]}
                y={ins.box[1]}
                width={w}
                height={h}
                fill={config.silhouette ? '#dcebfa' : '#cfe5f7'}
                stroke="#475569"
                strokeWidth={1.1}
                vectorEffect="non-scaling-stroke"
                rx={1.5}
              />
              {insetBgPieces.length > 0 && (
                <g clipPath={`url(#${ins.clipId})`}>
                  <g
                    transform={`translate(${ins.tx.toFixed(3)}, ${ins.ty.toFixed(3)}) scale(${ins.scale.toFixed(5)})`}
                  >
                    {insetBgPieces.map((pref) => renderBgPrefPath(pref, `inset-bg-${ins.id}`))}
                  </g>
                </g>
              )}
              {renderPieceRawGroup(boxPieces, ins)}
              {ins.id === 'okinawa' && showPrefBorderOverlay && insetBgPieces.length > 0 && (
                <g clipPath={`url(#${ins.clipId})`} pointerEvents="none">
                  <g
                    transform={`translate(${ins.tx.toFixed(3)}, ${ins.ty.toFixed(3)}) scale(${ins.scale.toFixed(5)})`}
                  >
                    {insetBgPieces.map((pref) => (
                      <path
                        key={`inset-pref-border-${pref.id}`}
                        d={pref.path}
                        fill="none"
                        stroke="#334155"
                        strokeWidth={1.35}
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                    ))}
                  </g>
                </g>
              )}
              {fittedInsetPiece && (
                <g clipPath={`url(#${ins.clipId})`} pointerEvents="none">
                  <g
                    transform={`translate(${ins.tx.toFixed(3)}, ${ins.ty.toFixed(3)}) scale(${ins.scale.toFixed(5)})`}
                  >
                    <path
                      d={fittedInsetPiece.path}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={0.96}
                      strokeWidth={5.2}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={fittedInsetPiece.path}
                      fill="#86efac"
                      fillRule="evenodd"
                      stroke="#059669"
                      strokeWidth={2.4}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                </g>
              )}
              <text
                x={ins.box[0] + 3}
                y={ins.box[1] + Math.max(3, Math.min(11, h * 0.14))}
                fontSize={Math.max(1.8, Math.min(9, h * 0.11))}
                fill="#334155"
                fontWeight={600}
                pointerEvents="none"
              >
                {ins.label}
              </text>
            </g>
          );
        })}

        {/* Terrain 100 overlay layer */}
        {renderTerrainLayer()}

        {/* Hint 1 approximate "この辺" area circle */}
        {hintArea && (
          <g className="hint-area-group" pointerEvents="none">
            <circle
              className="hint-area-ring"
              cx={hintArea.cx}
              cy={hintArea.cy}
              r={hintArea.r}
              fill="rgba(245, 158, 11, 0.16)"
              stroke="#d97706"
              strokeWidth={2.6}
              strokeDasharray="8 5"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={hintArea.cx}
              y={hintArea.cy - hintArea.r - Math.max(3, viewBox.w * 0.008)}
              textAnchor="middle"
              dominantBaseline="auto"
              fontSize={Math.max(2.5, Math.min(13, viewBox.w / 56))}
              fontWeight={700}
              fill="#b45309"
              stroke="#ffffff"
              strokeWidth={3}
              paintOrder="stroke"
              vectorEffect="non-scaling-stroke"
            >
              ヒント1：この辺
            </text>
          </g>
        )}

        {/* Hint 2 fitted object pulsing ring */}
        {hintFittedPieceId &&
          (() => {
            const p = overlayPieces.find((x) => x.id === hintFittedPieceId);
            if (!p) return null;
            const pieceSpan = Math.max(p.bbox[2] - p.bbox[0], p.bbox[3] - p.bbox[1]);
            const pulseR = Math.max(
              Math.min(pieceSpan * 0.55, viewBox.w * 0.06),
              Math.max(4.5, viewBox.w * 0.024),
            );
            return (
              <g className="hint-fitted-group" pointerEvents="none">
                <circle
                  cx={p.center[0]}
                  cy={p.center[1]}
                  r={pulseR}
                  fill="none"
                  stroke="#ffffff"
                  strokeOpacity={0.92}
                  strokeWidth={4.4}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  className="hint-fitted-pulse"
                  cx={p.center[0]}
                  cy={p.center[1]}
                  r={pulseR}
                  fill="rgba(16, 185, 129, 0.14)"
                  stroke="#059669"
                  strokeWidth={2.4}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })()}

        {/* Pulse halo on active/hint non-terrain piece */}
        {!isTerrainMode &&
          (hintPieceId || activePieceId) &&
          (() => {
            const id = hintPieceId ?? activePieceId;
            if (!id || id === hintFittedPieceId) return null;
            const p = overlayPieces.find((x) => x.id === id);
            if (!p) return null;
            return (
              <circle
                cx={p.center[0]}
                cy={p.center[1]}
                r={Math.max(3.5, viewBox.w * 0.022)}
                fill="none"
                stroke={hintPieceId ? '#dc2626' : '#ea580c'}
                strokeWidth={1.8}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            );
          })()}

        {/* Prefectural capital pin marks ◎ */}
        {showCapitalMarks &&
          overlayPieces.map((p) =>
            p.capitalCenter ? (
              <g key={`cap-${p.id}`} pointerEvents="none">
                <circle
                  cx={p.capitalCenter[0]}
                  cy={p.capitalCenter[1]}
                  r={Math.max(1.5, viewBox.w * 0.0055)}
                  fill="#ef4444"
                  stroke="#ffffff"
                  strokeWidth={0.9}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ) : null,
          )}

        {/* Tag dots */}
        {config.showTag &&
          overlayPieces.map((p) =>
            taggedIdSet.has(p.id) ? (
              <circle
                key={`tag-${p.id}`}
                cx={p.center[0]}
                cy={p.center[1] - Math.max(1.2, viewBox.w * 0.006)}
                r={Math.max(0.9, viewBox.w * 0.004)}
                fill="#7c3aed"
                stroke="#ffffff"
                strokeWidth={0.7}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            ) : null,
          )}

        {/* Completed / ViewMode / Hint2-fitted names */}
        {overlayPieces.map((p) => {
          const isHintFitted = hintFittedPieceId === p.id;
          const shouldDraw =
            isHintFitted ||
            forceShowNames ||
            (config.nameOnFix && completedIds.has(p.id));
          if (!shouldDraw) return null;
          // Skip extremely crowded labels unless zoomed in close enough (always show Hint 2 fitted piece)
          const pieceSpan = Math.max(p.bbox[2] - p.bbox[0], p.bbox[3] - p.bbox[1]);
          if (!isHintFitted && !selectedPieceId && pieceSpan < viewBox.w * 0.012 && !p.isMarker) {
            return null;
          }
          const label =
            swapCapitalLabel && p.adminAreaLabel ? p.adminAreaLabel : p.name;
          const labelY =
            isTerrainMode && resolveGeoCategory(p) === 'mountain'
              ? p.center[1] + getMountainPeakHalfWidth(viewBox.w) * 0.55 + labelFontSize * 0.65
              : p.center[1];
          const thisFontSize = isHintFitted ? Math.max(labelFontSize * 1.12, 3.2) : labelFontSize;
          return (
            <text
              key={`lbl-${p.id}`}
              x={p.center[0]}
              y={labelY}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={thisFontSize}
              fontWeight={isHintFitted ? 800 : 600}
              fill={isHintFitted ? '#065f46' : '#0f172a'}
              stroke={isHintFitted ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.92)'}
              strokeWidth={thisFontSize * (isHintFitted ? 0.34 : 0.28)}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {label}
            </text>
          );
        })}
      </svg>
      {enablePrefHoverTooltip && (
        <div
          ref={prefTooltipRef}
          className="pref-hover-tooltip"
          aria-hidden="true"
        />
      )}
    </>
  );
};

export const MapCanvas = React.memo(MapCanvasInner);
