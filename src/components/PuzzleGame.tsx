import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeKana } from '../services/mapDataLoader';
import type { LoadedSessionMap } from '../services/mapDataLoader';
import type { ConfigState, MapPieceItem } from '../types/game';

type TraySortMode = 'shuffle' | 'kana' | 'pref' | 'area';

interface PuzzleGameProps {
  loadedMap: LoadedSessionMap;
  remainingPieces: MapPieceItem[];
  config: ConfigState;
  selectedPieceId: string | null;
  hint1Active?: boolean;
  onSelectPiece: (piece: MapPieceItem | null) => void;
  onPlaceAttempt: (pieceId: string, hitSuccess: boolean) => void;
  onHoverTargetChange: (pieceId: string | null) => void;
  onHint1: () => void;
  onHint2: () => void;
  onToggleNameOnFix: () => void;
  clientToSvg: (cx: number, cy: number) => [number, number];
  svgScalePxPerUnit: () => number;
}

const VIRTUALIZE_THRESHOLD = 60;
const VIRTUALIZE_OVERSCAN = 16;

function getPieceTransformAttr(
  piece: MapPieceItem,
  loadedMap: LoadedSessionMap,
): string | undefined {
  if (piece.isOkinawa && loadedMap.okinawaTransform) {
    const tr = loadedMap.okinawaTransform;
    return `translate(${tr.tx.toFixed(3)}, ${tr.ty.toFixed(3)}) scale(${tr.scale.toFixed(5)})`;
  }
  if (piece.id >= '13361' && piece.id <= '13402' && loadedMap.tokyoInsetTransforms.izu) {
    const tr = loadedMap.tokyoInsetTransforms.izu;
    return `translate(${tr.tx.toFixed(3)}, ${tr.ty.toFixed(3)}) scale(${tr.scale.toFixed(5)})`;
  }
  if (piece.id === '13421' && loadedMap.tokyoInsetTransforms.ogasawara) {
    const tr = loadedMap.tokyoInsetTransforms.ogasawara;
    return `translate(${tr.tx.toFixed(3)}, ${tr.ty.toFixed(3)}) scale(${tr.scale.toFixed(5)})`;
  }
  return undefined;
}

function getPaddedViewBox(piece: MapPieceItem): string {
  const [x1, y1, x2, y2] = piece.bbox;
  const rawW = Math.max(0.08, x2 - x1);
  const rawH = Math.max(0.08, y2 - y1);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const pad = Math.max(rawW, rawH) * 0.16;
  const w = rawW + pad * 2;
  const h = rawH + pad * 2;
  return `${(cx - w / 2).toFixed(3)} ${(cy - h / 2).toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)}`;
}

function isDropOverUiOverlay(clientX: number, clientY: number): boolean {
  const els = document.elementsFromPoint(clientX, clientY);
  for (const el of els) {
    if (
      el.closest(
        '.hud-topbar, .hud-zoom-rail, .hud-jump-bar, .hud-info-card, .hud-last-answer-pill, .puzzle-tray, .puzzle-single-prompt, .modal-backdrop',
      )
    ) {
      return true;
    }
  }
  return false;
}

const PuzzleGameInner: React.FC<PuzzleGameProps> = ({
  loadedMap,
  remainingPieces,
  config,
  selectedPieceId,
  hint1Active = false,
  onSelectPiece,
  onPlaceAttempt,
  onHoverTargetChange,
  onHint1,
  onHint2,
  onToggleNameOnFix,
  clientToSvg,
  svgScalePxPerUnit,
}) => {
  const trayRef = useRef<HTMLDivElement | null>(null);
  const scrollWrapRef = useRef<HTMLDivElement | null>(null);
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<TraySortMode>('shuffle');
  const [draggingInfo, setDraggingInfo] = useState<{
    piece: MapPieceItem;
    initX: number;
    initY: number;
    pointerType: string;
  } | null>(null);
  const [scrollMetrics, setScrollMetrics] = useState<{ left: number; width: number }>({
    left: 0,
    width: 1000,
  });

  // Authoritative refs so global pointer listeners NEVER hold stale closures
  const onSelectPieceRef = useRef(onSelectPiece);
  const onPlaceAttemptRef = useRef(onPlaceAttempt);
  const onHoverTargetChangeRef = useRef(onHoverTargetChange);
  const selectedPieceIdRef = useRef(selectedPieceId);
  const clientToSvgRef = useRef(clientToSvg);
  const svgScalePxPerUnitRef = useRef(svgScalePxPerUnit);
  const showPieceListRef = useRef(config.showPieceList);

  useEffect(() => {
    onSelectPieceRef.current = onSelectPiece;
    onPlaceAttemptRef.current = onPlaceAttempt;
    onHoverTargetChangeRef.current = onHoverTargetChange;
    selectedPieceIdRef.current = selectedPieceId;
    clientToSvgRef.current = clientToSvg;
    svgScalePxPerUnitRef.current = svgScalePxPerUnit;
    showPieceListRef.current = config.showPieceList;
  });

  const pendingPressRef = useRef<{
    piece: MapPieceItem;
    startX: number;
    startY: number;
    pointerId: number;
    pointerType: string;
  } | null>(null);

  const activeDragRef = useRef<{
    piece: MapPieceItem;
    pointerId: number;
    pointerType: string;
    x: number;
    y: number;
  } | null>(null);

  const suppressClickUntilRef = useRef<number>(0);

  // Auto-select next remaining piece when piece tray is hidden so the mode remains playable
  useEffect(() => {
    if (config.showPieceList || remainingPieces.length === 0) return;
    if (!selectedPieceId || !remainingPieces.some((p) => p.id === selectedPieceId)) {
      onSelectPieceRef.current(remainingPieces[0]);
    }
  }, [config.showPieceList, remainingPieces, selectedPieceId]);

  const homonymNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of remainingPieces) {
      counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
    }
    const dups = new Set<string>();
    for (const [name, c] of counts) {
      if (c > 1) dups.add(name);
    }
    return dups;
  }, [remainingPieces]);

  const showFilterBar =
    remainingPieces.length > 12 || searchQuery.trim().length > 0 || sortMode !== 'shuffle';

  const displayedPieces = useMemo(() => {
    const q = searchQuery.trim();
    const normQ = q ? normalizeKana(q.toLowerCase()) : '';
    let list = remainingPieces;
    if (q) {
      const lowerQ = q.toLowerCase();
      list = remainingPieces.filter((p) => {
        if (p.name.toLowerCase().includes(lowerQ)) return true;
        if (p.prefName && p.prefName.toLowerCase().includes(lowerQ)) return true;
        if (p.regionLabel && p.regionLabel.toLowerCase().includes(lowerQ)) return true;
        if (normQ && normalizeKana(p.ruby).includes(normQ)) return true;
        return false;
      });
    }
    if (sortMode === 'shuffle') return list;
    const sorted = [...list];
    if (sortMode === 'kana') {
      sorted.sort((a, b) => a.ruby.localeCompare(b.ruby, 'ja'));
    } else if (sortMode === 'pref') {
      sorted.sort((a, b) => {
        const pa = a.prefCode ?? '99';
        const pb = b.prefCode ?? '99';
        if (pa !== pb) return pa.localeCompare(pb);
        return a.ruby.localeCompare(b.ruby, 'ja');
      });
    } else if (sortMode === 'area') {
      sorted.sort((a, b) => (b.areaKm2 || b.areaPx) - (a.areaKm2 || a.areaPx));
    }
    return sorted;
  }, [remainingPieces, searchQuery, sortMode]);

  const isTargetMatchAtClientPoint = useCallback(
    (piece: MapPieceItem, clientX: number, clientY: number): boolean => {
      const elements = document.elementsFromPoint(clientX, clientY);
      for (const el of elements) {
        if (el.getAttribute('data-piece-id') === piece.id) {
          return true;
        }
      }
      const [sx, sy] = clientToSvgRef.current(clientX, clientY);
      const scalePx = svgScalePxPerUnitRef.current();
      const screenDist = Math.hypot(sx - piece.center[0], sy - piece.center[1]) * scalePx;
      return screenDist <= 38;
    },
    [],
  );

  const positionGhostDom = useCallback((x: number, y: number, pointerType: string) => {
    const el = ghostElRef.current;
    if (!el) return;
    const yShift = pointerType === 'touch' ? '-85%' : '-65%';
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, ${yShift})`;
  }, []);

  // Ensure freshly mounted drag ghost starts at exact pointer position
  useEffect(() => {
    if (draggingInfo && activeDragRef.current) {
      const d = activeDragRef.current;
      positionGhostDom(d.x, d.y, d.pointerType);
    }
  }, [draggingInfo, positionGhostDom]);

  useEffect(() => {
    const getHitY = (clientY: number, pointerType: string) =>
      pointerType === 'touch' ? clientY - 28 : clientY;

    const handleMove = (e: PointerEvent) => {
      const pending = pendingPressRef.current;
      if (pending && pending.pointerId === e.pointerId) {
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        const isUpwardPull = dy < -10 && Math.abs(dy) >= Math.abs(dx) * 0.7;
        const isMouseMovedFar = e.pointerType === 'mouse' && Math.hypot(dx, dy) > 8 && dy < 4;
        if (isUpwardPull || isMouseMovedFar) {
          const piece = pending.piece;
          const pType = pending.pointerType;
          pendingPressRef.current = null;
          onSelectPieceRef.current(piece);
          activeDragRef.current = {
            piece,
            pointerId: e.pointerId,
            pointerType: pType,
            x: e.clientX,
            y: e.clientY,
          };
          setDraggingInfo({
            piece,
            initX: Math.round(e.clientX),
            initY: Math.round(e.clientY),
            pointerType: pType,
          });
          const match = isTargetMatchAtClientPoint(piece, e.clientX, getHitY(e.clientY, pType));
          onHoverTargetChangeRef.current(match ? piece.id : null);
        }
        return;
      }

      const cur = activeDragRef.current;
      if (cur && cur.pointerId === e.pointerId) {
        cur.x = e.clientX;
        cur.y = e.clientY;
        positionGhostDom(e.clientX, e.clientY, cur.pointerType);
        const match = isTargetMatchAtClientPoint(
          cur.piece,
          e.clientX,
          getHitY(e.clientY, cur.pointerType),
        );
        onHoverTargetChangeRef.current(match ? cur.piece.id : null);
      }
    };

    const handleUp = (e: PointerEvent) => {
      if (pendingPressRef.current && pendingPressRef.current.pointerId === e.pointerId) {
        const piece = pendingPressRef.current.piece;
        pendingPressRef.current = null;
        suppressClickUntilRef.current = performance.now() + 400;
        if (!showPieceListRef.current) {
          onSelectPieceRef.current(piece);
        } else {
          onSelectPieceRef.current(selectedPieceIdRef.current === piece.id ? null : piece);
        }
        return;
      }

      const cur = activeDragRef.current;
      if (cur && cur.pointerId === e.pointerId) {
        activeDragRef.current = null;
        setDraggingInfo(null);
        onHoverTargetChangeRef.current(null);
        suppressClickUntilRef.current = performance.now() + 300;
        const trayRect = trayRef.current?.getBoundingClientRect();
        // Returning piece back onto tray or any HUD control cancels cleanly without Miss
        if (
          (trayRect && e.clientY >= trayRect.top) ||
          isDropOverUiOverlay(e.clientX, e.clientY)
        ) {
          return;
        }
        const matched = isTargetMatchAtClientPoint(
          cur.piece,
          e.clientX,
          getHitY(e.clientY, cur.pointerType),
        );
        onPlaceAttemptRef.current(cur.piece.id, matched);
      }
    };

    // Dedicated clean cancel handler so mobile OS gesture interruption NEVER fires a false Miss
    const handleCancel = (e: PointerEvent) => {
      if (pendingPressRef.current && pendingPressRef.current.pointerId === e.pointerId) {
        pendingPressRef.current = null;
      }
      if (activeDragRef.current && activeDragRef.current.pointerId === e.pointerId) {
        activeDragRef.current = null;
        setDraggingInfo(null);
        onHoverTargetChangeRef.current(null);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
    };
  }, [isTargetMatchAtClientPoint, positionGhostDom]);

  // Track horizontal scroll viewport for windowing large trays (>60 pieces)
  useEffect(() => {
    const el = scrollWrapRef.current;
    if (!el || minimized) return;
    let rafId: number | null = null;
    const sync = () => {
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setScrollMetrics({ left: el.scrollLeft, width: el.clientWidth || 1000 });
      });
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', sync);
      ro?.disconnect();
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [minimized, config.showPieceList]);

  // Auto-scroll newly selected piece (e.g. via Hint 1) into view inside the tray
  useEffect(() => {
    if (!selectedPieceId || minimized || !config.showPieceList) return;
    const wrap = scrollWrapRef.current;
    if (!wrap) return;
    const idx = displayedPieces.findIndex((p) => p.id === selectedPieceId);
    if (idx < 0) return;
    const stride = window.innerWidth <= 640 ? 88 : 104;
    const targetLeft = idx * stride;
    const viewLeft = wrap.scrollLeft;
    const viewRight = viewLeft + wrap.clientWidth;
    if (targetLeft < viewLeft + 12 || targetLeft + stride > viewRight - 12) {
      wrap.scrollTo({
        left: Math.max(0, targetLeft - wrap.clientWidth / 2 + stride / 2),
        behavior: 'smooth',
      });
    }
  }, [selectedPieceId, minimized, config.showPieceList, displayedPieces]);

  const selectedPieceObj = useMemo(
    () => remainingPieces.find((x) => x.id === selectedPieceId) ?? remainingPieces[0] ?? null,
    [remainingPieces, selectedPieceId],
  );

  const renderGhost = () => {
    if (!draggingInfo) return null;
    const { piece, initX, initY, pointerType } = draggingInfo;
    const yShift = pointerType === 'touch' ? '-85%' : '-65%';
    return (
      <div
        ref={ghostElRef}
        className="puzzle-drag-ghost"
        style={{
          left: 0,
          top: 0,
          transform: `translate3d(${initX}px, ${initY}px, 0) translate(-50%, ${yShift})`,
        }}
      >
        <svg viewBox={getPaddedViewBox(piece)} className="drag-ghost-svg">
          <g transform={getPieceTransformAttr(piece, loadedMap)}>
            <path
              d={piece.path}
              fill="var(--puzzle-ghost-fill, #fb923c)"
              fillOpacity={0.85}
              fillRule="evenodd"
              stroke="var(--puzzle-ghost-stroke, #9a3412)"
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </svg>
        {config.nameOnDrag && (
          <div className="drag-ghost-name">
            {piece.name}
            {homonymNames.has(piece.name) && piece.prefName
              ? `（${piece.prefName}）`
              : ''}
          </div>
        )}
      </div>
    );
  };

  // Compact playable single-piece prompt when tray list is hidden in Config
  if (!config.showPieceList) {
    const cur = selectedPieceObj;
    const isHomonym = cur ? homonymNames.has(cur.name) && Boolean(cur.prefName) : false;
    return (
      <>
        <div className="puzzle-single-prompt" role="region" aria-label="次のパズルピース">
          {cur && (
            <button
              type="button"
              className="puzzle-piece-card selected"
              aria-label={`配置対象: ${config.nameInList ? cur.name : '名前非表示'}`}
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                pendingPressRef.current = {
                  piece: cur,
                  startX: e.clientX,
                  startY: e.clientY,
                  pointerId: e.pointerId,
                  pointerType: e.pointerType,
                };
              }}
            >
              <svg viewBox={getPaddedViewBox(cur)} className="puzzle-piece-thumb">
                <g transform={getPieceTransformAttr(cur, loadedMap)}>
                  <path
                    d={cur.path}
                    fill="var(--puzzle-piece-fill, #f97316)"
                    fillRule="evenodd"
                    stroke="var(--puzzle-piece-stroke, #7c2d12)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              </svg>
              <div className="puzzle-piece-label">
                {config.nameInList ? (
                  <>
                    <span className="pk">{cur.name}</span>
                    <span className="pr">{cur.ruby}</span>
                    {isHomonym && (
                      <span className="pref-homonym-badge">{cur.prefName}</span>
                    )}
                  </>
                ) : (
                  <span className="pk">？？？</span>
                )}
              </div>
            </button>
          )}
          <div className="puzzle-single-meta">
            <div className="puzzle-single-status">
              残り <strong>{remainingPieces.length}</strong> 件 ・ 地図上の場所をタップまたはドラッグ
            </div>
            <div className="hint-btn-group">
              <button
                type="button"
                className={`hud-toggle-btn btn-xs ${config.nameOnFix ? '' : 'is-off'}`}
                title="はめた後に白地図上へ名前を表示／非表示"
                onClick={onToggleNameOnFix}
              >
                🏷 回答後の名前: {config.nameOnFix ? 'ON' : 'OFF'}
              </button>
              {!config.disableHelpButton && (
                <>
                  <button
                    type="button"
                    className={`btn-hint1 btn-xs ${hint1Active ? 'is-active' : ''}`}
                    aria-pressed={hint1Active}
                    title="この辺の大きな範囲を表示／非表示"
                    disabled={remainingPieces.length === 0}
                    onClick={onHint1}
                  >
                    💡 {hint1Active ? '範囲ヒント表示中' : '範囲ヒント'}
                  </button>
                  <button
                    type="button"
                    className="btn-hint2 btn-xs"
                    title="その場所へ直接当てはめる（ミス扱い・復習登録）"
                    disabled={remainingPieces.length === 0}
                    onClick={onHint2}
                  >
                    🎯 答えをはめる
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        {renderGhost()}
      </>
    );
  }

  const cardStride =
    typeof window !== 'undefined' && window.innerWidth <= 640 ? 88 : 104;
  const shouldVirtualize = displayedPieces.length > VIRTUALIZE_THRESHOLD;
  let startIdx = 0;
  let endIdx = displayedPieces.length;
  let leftSpacerPx = 0;
  let rightSpacerPx = 0;
  if (shouldVirtualize) {
    startIdx = Math.max(
      0,
      Math.floor(scrollMetrics.left / cardStride) - VIRTUALIZE_OVERSCAN,
    );
    endIdx = Math.min(
      displayedPieces.length,
      Math.ceil((scrollMetrics.left + scrollMetrics.width) / cardStride) +
        VIRTUALIZE_OVERSCAN,
    );
    leftSpacerPx = startIdx * cardStride;
    rightSpacerPx = Math.max(0, (displayedPieces.length - endIdx) * cardStride);
  }
  const visiblePieces = shouldVirtualize
    ? displayedPieces.slice(startIdx, endIdx)
    : displayedPieces;

  const selectedLabelPiece = selectedPieceId
    ? remainingPieces.find((x) => x.id === selectedPieceId) ?? null
    : null;

  return (
    <>
      <div ref={trayRef} className={`puzzle-tray ${minimized ? 'is-minimized' : ''}`}>
        <div className="puzzle-tray-header">
          <span>
            残りピース: <strong>{remainingPieces.length}</strong> 件
            {selectedLabelPiece
              ? ` ・ 選択中「${config.nameInList ? selectedLabelPiece.name : '？'}」（地図をタップで配置 / Escで解除）`
              : ' ・ ドラッグまたはタップして地図に配置'}
          </span>
          <div className="puzzle-tray-ctrls">
            <button
              type="button"
              className={`hud-toggle-btn btn-xs ${config.nameOnFix ? '' : 'is-off'}`}
              title="はめた後に白地図上へ名前を表示／非表示"
              onClick={onToggleNameOnFix}
            >
              🏷 回答後の名前: {config.nameOnFix ? 'ON' : 'OFF'}
            </button>
            {!config.disableHelpButton && (
              <div className="hint-btn-group">
                <button
                  type="button"
                  className={`btn-hint1 btn-xs ${hint1Active ? 'is-active' : ''}`}
                  aria-pressed={hint1Active}
                  title="この辺の大きな範囲を表示／非表示"
                  disabled={remainingPieces.length === 0}
                  onClick={onHint1}
                >
                  💡 {hint1Active ? '範囲ヒント表示中' : '範囲ヒント'}
                </button>
                <button
                  type="button"
                  className="btn-hint2 btn-xs"
                  title="その場所へ直接当てはめる（ミス扱い・復習登録）"
                  disabled={remainingPieces.length === 0}
                  onClick={onHint2}
                >
                  🎯 答えをはめる
                </button>
              </div>
            )}
            <button
              type="button"
              className="tray-nav-btn"
              aria-label="トレイを左へスクロール"
              onClick={() =>
                scrollWrapRef.current?.scrollBy({ left: -280, behavior: 'smooth' })
              }
            >
              ◀
            </button>
            <button
              type="button"
              className="tray-nav-btn"
              aria-label="トレイを右へスクロール"
              onClick={() =>
                scrollWrapRef.current?.scrollBy({ left: 280, behavior: 'smooth' })
              }
            >
              ▶
            </button>
            <button
              type="button"
              className="tray-toggle-btn"
              aria-expanded={!minimized}
              onClick={() => setMinimized((m) => !m)}
            >
              {minimized ? '▲ 開く' : '▼ 隠す'}
            </button>
          </div>
        </div>

        {!minimized && showFilterBar && (
          <div className="tray-filter-bar">
            {config.nameInList && (
              <input
                type="search"
                className="tray-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="名前・よみ・都道府県で検索..."
                aria-label="残りピースを検索"
              />
            )}
            <select
              className="tray-sort-select"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as TraySortMode)}
              aria-label="ピースの並び順"
            >
              <option value="shuffle">並び: シャッフル</option>
              <option value="kana">並び: 50音順</option>
              <option value="pref">並び: 都道府県順</option>
              <option value="area">並び: 面積が大きい順</option>
            </select>
            {searchQuery.trim() && (
              <span className="tray-filter-count">
                {displayedPieces.length} / {remainingPieces.length}件
              </span>
            )}
          </div>
        )}

        {!minimized && (
          <div
            ref={scrollWrapRef}
            className="puzzle-tray-scroll"
            onWheel={(e) => {
              if (scrollWrapRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                scrollWrapRef.current.scrollLeft += e.deltaY;
              }
            }}
          >
            {leftSpacerPx > 0 && (
              <div style={{ flex: `0 0 ${leftSpacerPx}px` }} aria-hidden="true" />
            )}
            {visiblePieces.length === 0 ? (
              <div className="empty-hint" style={{ padding: '8px 12px' }}>
                一致するピースがありません
              </div>
            ) : (
              visiblePieces.map((piece) => {
                const isSelected = selectedPieceId === piece.id;
                const transformAttr = getPieceTransformAttr(piece, loadedMap);
                const showHomonym =
                  config.nameInList && homonymNames.has(piece.name) && Boolean(piece.prefName);
                return (
                  <button
                    key={piece.id}
                    type="button"
                    aria-pressed={isSelected}
                    className={`puzzle-piece-card ${isSelected ? 'selected' : ''}`}
                    onPointerDown={(e) => {
                      if (e.pointerType === 'mouse' && e.button !== 0) return;
                      pendingPressRef.current = {
                        piece,
                        startX: e.clientX,
                        startY: e.clientY,
                        pointerId: e.pointerId,
                        pointerType: e.pointerType,
                      };
                    }}
                    onClick={() => {
                      // Keyboard activation (Enter/Space) when not already handled by pointerup
                      if (performance.now() < suppressClickUntilRef.current) return;
                      onSelectPieceRef.current(
                        selectedPieceIdRef.current === piece.id ? null : piece,
                      );
                    }}
                  >
                    <svg viewBox={getPaddedViewBox(piece)} className="puzzle-piece-thumb">
                      <g transform={transformAttr}>
                        <path
                          d={piece.path}
                          fill="var(--puzzle-piece-fill, #f97316)"
                          fillRule="evenodd"
                          stroke="var(--puzzle-piece-stroke, #7c2d12)"
                          strokeWidth={1}
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    </svg>
                    <div className="puzzle-piece-label">
                      {config.nameInList ? (
                        <>
                          <span className="pk">{piece.name}</span>
                          <span className="pr">{piece.ruby}</span>
                          {showHomonym && (
                            <span className="pref-homonym-badge">{piece.prefName}</span>
                          )}
                        </>
                      ) : (
                        <span className="pk">？？？</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
            {rightSpacerPx > 0 && (
              <div style={{ flex: `0 0 ${rightSpacerPx}px` }} aria-hidden="true" />
            )}
          </div>
        )}
      </div>

      {renderGhost()}
    </>
  );
};

export const PuzzleGame = React.memo(PuzzleGameInner);
