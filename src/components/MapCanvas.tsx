import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ViewBoxRect } from '../hooks/useMapViewport';
import type { InsetBoxSpec } from '../services/mapDataLoader';
import type { ConfigState, MapPieceItem, MapTag } from '../types/game';

interface MapCanvasProps {
  svgRef: React.RefObject<SVGSVGElement | null>;
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
  onPieceClick?: (piece: MapPieceItem) => void;
  onPanBy: (dx: number, dy: number) => void;
  onStartInertia: (vx: number, vy: number) => void;
  onZoomAt: (nextZoom: number, clientX?: number, clientY?: number) => void;
  zoomRatio: number;
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

export const MapCanvas: React.FC<MapCanvasProps> = ({
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
  onPieceClick,
  onPanBy,
  onStartInertia,
  onZoomAt,
  zoomRatio,
}) => {
  const [isPanning, setIsPanning] = useState(false);

  const dragRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    lastTime: number;
    vx: number;
    vy: number;
    moved: boolean;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    vx: 0,
    vy: 0,
    moved: false,
  });

  const suppressClickRef = useRef(false);
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);

  const zoomRef = useRef(zoomRatio);
  const onZoomAtRef = useRef(onZoomAt);
  const onPanByRef = useRef(onPanBy);
  const onStartInertiaRef = useRef(onStartInertia);
  useEffect(() => {
    zoomRef.current = zoomRatio;
    onZoomAtRef.current = onZoomAt;
    onPanByRef.current = onPanBy;
    onStartInertiaRef.current = onStartInertia;
  });

  // Bind non-passive wheel listener to allow smooth cursor-centered zoom without console warnings
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      onZoomAtRef.current(zoomRef.current * factor, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [svgRef]);

  // Google-Maps-style global pointer tracking while left-click/touch dragging the map
  useEffect(() => {
    const handleWinMove = (e: PointerEvent) => {
      if (touchPointersRef.current.has(e.pointerId)) {
        touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (touchPointersRef.current.size === 2 && pinchStartRef.current) {
        const pts = Array.from(touchPointersRef.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        if (pinchStartRef.current.dist > 5) {
          onZoomAtRef.current(
            pinchStartRef.current.zoom * (dist / pinchStartRef.current.dist),
            midX,
            midY,
          );
        }
        return;
      }

      const d = dragRef.current;
      if (!d.active || (d.pointerId != null && e.pointerId !== d.pointerId)) return;
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) {
        d.moved = true;
        setIsPanning(true);
      }
      if (d.moved) {
        onPanByRef.current(dx, dy);
      }
      const now = performance.now();
      const dt = Math.max(4, now - d.lastTime);
      d.vx = d.vx * 0.4 + (dx / dt) * 0.6;
      d.vy = d.vy * 0.4 + (dy / dt) * 0.6;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      d.lastTime = now;
    };

    const handleWinUp = (e: PointerEvent) => {
      touchPointersRef.current.delete(e.pointerId);
      if (touchPointersRef.current.size < 2) {
        pinchStartRef.current = null;
      }
      const d = dragRef.current;
      if (d.active && (d.pointerId == null || e.pointerId === d.pointerId)) {
        if (d.moved) {
          suppressClickRef.current = true;
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 80);
          if (Math.hypot(d.vx, d.vy) > 0.08) {
            onStartInertiaRef.current(d.vx, d.vy);
          }
        }
        d.active = false;
        d.pointerId = null;
        setIsPanning(false);
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
    if (e.pointerType === 'mouse') {
      e.preventDefault();
    }
    touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPointersRef.current.size === 2) {
      const pts = Array.from(touchPointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartRef.current = { dist, zoom: zoomRatio };
      dragRef.current.active = false;
      setIsPanning(false);
      return;
    }
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      lastTime: performance.now(),
      vx: 0,
      vy: 0,
      moved: false,
    };
  };

  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    onZoomAt(zoomRatio * 1.65, e.clientX, e.clientY);
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

  const getPieceStyle = (piece: MapPieceItem) => {
    const isCompleted = completedIds.has(piece.id);
    const isActive = activePieceId === piece.id;
    const isHint = hintPieceId === piece.id;
    const isSelected = selectedPieceId === piece.id;
    const isHover = hoverTargetId === piece.id;
    const isInPool = poolIdSet.has(piece.id);

    let fill = config.silhouette ? '#fbfaf6' : getHypsometricColor(piece);
    let stroke = config.showBorder ? '#475569' : fill;
    let strokeWidth = config.showBorder ? 0.9 : 0.65;

    if (!isInPool && contextPieces.length > activePoolPieces.length) {
      // Context piece outside current geographic sub-region (e.g. non-selected Hokkaido sub-region)
      fill = config.silhouette ? '#ebeae4' : '#d6dccb';
      stroke = config.showBorder ? '#94a3b8' : fill;
      strokeWidth = 0.65;
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

    return { fill, stroke, strokeWidth };
  };

  const labelFontSize = Math.max(1.2, Math.min(13, viewBox.w / 62));
  const smallHitRadius = Math.max(1.3, viewBox.w * 0.0085);

  const renderPiecePath = (piece: MapPieceItem) => {
    const st = getPieceStyle(piece);
    const clickable = Boolean(onPieceClick);
    const isTiny = piece.isMarker || piece.areaPx < 6;
    return (
      <g
        key={piece.id}
        onClick={() => tryPieceClick(piece)}
        className={clickable ? 'map-piece-clickable' : undefined}
      >
        <path
          data-piece-id={piece.id}
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
            cx={piece.center[0]}
            cy={piece.center[1]}
            r={piece.isMarker ? Math.max(1.8, viewBox.w * 0.0055) : smallHitRadius}
            fill={piece.isMarker ? st.fill : 'transparent'}
            stroke={piece.isMarker ? st.stroke : 'rgba(15, 23, 42, 0.28)'}
            strokeWidth={piece.isMarker ? 1.1 : 0.6}
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
            const isTiny = piece.isMarker || piece.areaPx < 6;
            return (
              <g
                key={piece.id}
                onClick={() => tryPieceClick(piece)}
                className={onPieceClick ? 'map-piece-clickable' : undefined}
              >
                <path
                  data-piece-id={piece.id}
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
                    stroke="rgba(15, 23, 42, 0.25)"
                    strokeWidth={0.6}
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

  const renderBgPrefectures = () => {
    const okiSpec = insetMap.get('okinawa');
    return bgPrefPieces.map((pref) => {
      if (hidePref13Bg && pref.id === 'pref_13') return null;
      if (pref.isOkinawa && hidePref47Bg) return null;
      // When bgPrefPieces is used behind single prefecture / terrain mode:
      const isDirectTarget = !isTerrainMode && contextPieces.length === bgPrefPieces.length;
      if (isDirectTarget) return null;
      if (pref.isOkinawa && okiSpec) {
        return (
          <g
            key={`bg-${pref.id}`}
            clipPath={`url(#${okiSpec.clipId})`}
            transform={`translate(${okiSpec.tx.toFixed(3)}, ${okiSpec.ty.toFixed(3)}) scale(${okiSpec.scale.toFixed(5)})`}
          >
            <path
              d={pref.path}
              fill={config.silhouette ? '#ecebe4' : '#dfe4d5'}
              fillRule="evenodd"
              stroke={config.showBorder ? '#94a3b8' : '#ecebe4'}
              strokeWidth={0.7}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          </g>
        );
      }
      return (
        <path
          key={`bg-${pref.id}`}
          d={pref.path}
          fill={config.silhouette ? '#ecebe4' : '#dfe4d5'}
          fillRule="evenodd"
          stroke={config.showBorder ? '#94a3b8' : '#ecebe4'}
          strokeWidth={0.7}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      );
    });
  };

  const renderTerrainLayer = () => {
    if (!isTerrainMode) return null;
    return (
      <g>
        {contextPieces.map((f) => {
          const isCompleted = completedIds.has(f.id);
          const isActive = activePieceId === f.id;
          const isHint = hintPieceId === f.id;
          const pts = f.linePts ?? [];
          if (pts.length === 0) return null;
          const ptsStr = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
          const cat = f.regionLabel;
          let color = '#64748b';
          if (cat === '山') color = '#b45309';
          else if (cat === '湖') color = '#0284c7';
          else if (cat === '河川') color = '#2563eb';
          else if (cat === '平野') color = '#65a30d';
          else if (cat === '山脈・山地・高地') color = '#9a3412';

          const highlighted = isActive || isHint;
          const opacity = highlighted ? 1 : isCompleted ? 0.88 : 0.32;
          const activeStroke = isHint ? '#dc2626' : isActive ? '#ea580c' : color;

          return (
            <g
              key={f.id}
              opacity={opacity}
              onClick={() => tryPieceClick(f)}
              className={onPieceClick ? 'map-piece-clickable' : undefined}
            >
              {f.geometryType === 'polygon_pts' ? (
                <polygon
                  points={ptsStr}
                  fill={highlighted ? (cat === '湖' ? '#38bdf8' : '#f97316') : color}
                  fillOpacity={highlighted ? 0.72 : 0.48}
                  stroke={activeStroke}
                  strokeWidth={highlighted ? 2.4 : 1.1}
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <polyline
                  points={ptsStr}
                  fill="none"
                  stroke={activeStroke}
                  strokeWidth={
                    cat === '河川'
                      ? highlighted
                        ? 4.2
                        : 2.0
                      : highlighted
                        ? 6.5
                        : 3.4
                  }
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={cat === '山脈・山地・高地' ? '4 2' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {highlighted && (
                <circle
                  cx={f.center[0]}
                  cy={f.center[1]}
                  r={Math.max(8, viewBox.w * 0.025)}
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth={2}
                  strokeDasharray="4 3"
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

  return (
    <svg
      ref={svgRef}
      viewBox={viewBoxString}
      preserveAspectRatio="xMidYMid meet"
      className={`map-canvas-svg ${isPanning ? 'is-panning' : ''}`}
      style={{
        background: config.silhouette ? '#dcebfa' : '#cfe5f7',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
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

      {/* Inset frames + transformed island vector paths */}
      {insets.map((ins) => {
        const w = ins.box[2] - ins.box[0];
        const h = ins.box[3] - ins.box[1];
        const boxPieces =
          ins.id === 'okinawa' ? okiPieces : ins.id === 'izu' ? izuPieces : ogaPieces;
        const insetBgPieces =
          ins.id === 'okinawa' && hidePref47Bg
            ? bgPrefPieces.filter((p) => p.isOkinawa)
            : [];
        return (
          <g key={`inset-frame-${ins.id}`}>
            <rect
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
            {insetBgPieces.length > 0 && renderPieceRawGroup(insetBgPieces, ins)}
            {renderPieceRawGroup(boxPieces, ins)}
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

      {/* Pulse halo on active/hint non-terrain piece */}
      {!isTerrainMode &&
        (hintPieceId || activePieceId) &&
        (() => {
          const id = hintPieceId ?? activePieceId;
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

      {/* Completed / ViewMode names */}
      {overlayPieces.map((p) => {
        const shouldDraw =
          forceShowNames || (config.nameOnFix && completedIds.has(p.id));
        if (!shouldDraw) return null;
        // Skip extremely crowded labels unless zoomed in close enough
        const pieceSpan = Math.max(p.bbox[2] - p.bbox[0], p.bbox[3] - p.bbox[1]);
        if (!selectedPieceId && pieceSpan < viewBox.w * 0.012 && !p.isMarker) {
          return null;
        }
        const label =
          swapCapitalLabel && p.adminAreaLabel ? p.adminAreaLabel : p.name;
        return (
          <text
            key={`lbl-${p.id}`}
            x={p.center[0]}
            y={p.center[1]}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={labelFontSize}
            fontWeight={600}
            fill="#0f172a"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth={labelFontSize * 0.28}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
};
