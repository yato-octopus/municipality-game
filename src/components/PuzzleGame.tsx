import React, { useEffect, useRef, useState } from 'react';
import type { LoadedSessionMap } from '../services/mapDataLoader';
import type { ConfigState, MapPieceItem } from '../types/game';

interface PuzzleGameProps {
  loadedMap: LoadedSessionMap;
  remainingPieces: MapPieceItem[];
  config: ConfigState;
  selectedPieceId: string | null;
  onSelectPiece: (piece: MapPieceItem | null) => void;
  onPlaceAttempt: (pieceId: string, hitSuccess: boolean) => void;
  onHoverTargetChange: (pieceId: string | null) => void;
  onHelp: () => void;
  clientToSvg: (cx: number, cy: number) => [number, number];
  svgScalePxPerUnit: () => number;
}

function getPieceTransformAttr(piece: MapPieceItem, loadedMap: LoadedSessionMap): string | undefined {
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
  const w = Math.max(2, x2 - x1);
  const h = Math.max(2, y2 - y1);
  const pad = Math.max(w, h) * 0.14;
  return `${(x1 - pad).toFixed(2)} ${(y1 - pad).toFixed(2)} ${(w + pad * 2).toFixed(2)} ${(h + pad * 2).toFixed(2)}`;
}

export const PuzzleGame: React.FC<PuzzleGameProps> = ({
  loadedMap,
  remainingPieces,
  config,
  selectedPieceId,
  onSelectPiece,
  onPlaceAttempt,
  onHoverTargetChange,
  onHelp,
  clientToSvg,
  svgScalePxPerUnit,
}) => {
  const trayRef = useRef<HTMLDivElement | null>(null);
  const scrollWrapRef = useRef<HTMLDivElement | null>(null);
  const [minimized, setMinimized] = useState(false);

  const [dragState, setDragState] = useState<{
    piece: MapPieceItem;
    clientX: number;
    clientY: number;
  } | null>(null);

  const pendingPressRef = useRef<{
    piece: MapPieceItem;
    startX: number;
    startY: number;
    pointerId: number;
  } | null>(null);

  const dragStateRef = useRef(dragState);
  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  const isTargetMatchAtClientPoint = (
    piece: MapPieceItem,
    clientX: number,
    clientY: number,
  ): boolean => {
    const elements = document.elementsFromPoint(clientX, clientY);
    for (const el of elements) {
      if (el.getAttribute('data-piece-id') === piece.id) {
        return true;
      }
    }
    const [sx, sy] = clientToSvg(clientX, clientY);
    const scalePx = svgScalePxPerUnit();
    const screenDist = Math.hypot(sx - piece.center[0], sy - piece.center[1]) * scalePx;
    return screenDist <= 38;
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const pending = pendingPressRef.current;
      if (pending && pending.pointerId === e.pointerId) {
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        const isUpwardPull = dy < -10 && Math.abs(dy) >= Math.abs(dx) * 0.7;
        const isMouseMovedFar = e.pointerType === 'mouse' && Math.hypot(dx, dy) > 8 && dy < 4;
        if (isUpwardPull || isMouseMovedFar) {
          const piece = pending.piece;
          pendingPressRef.current = null;
          onSelectPiece(piece);
          setDragState({ piece, clientX: e.clientX, clientY: e.clientY });
          const match = isTargetMatchAtClientPoint(piece, e.clientX, e.clientY);
          onHoverTargetChange(match ? piece.id : null);
        }
        return;
      }
      const cur = dragStateRef.current;
      if (cur) {
        setDragState({ piece: cur.piece, clientX: e.clientX, clientY: e.clientY });
        const match = isTargetMatchAtClientPoint(cur.piece, e.clientX, e.clientY);
        onHoverTargetChange(match ? cur.piece.id : null);
      }
    };

    const handleUp = (e: PointerEvent) => {
      if (pendingPressRef.current && pendingPressRef.current.pointerId === e.pointerId) {
        const piece = pendingPressRef.current.piece;
        pendingPressRef.current = null;
        onSelectPiece(selectedPieceId === piece.id ? null : piece);
        return;
      }
      const cur = dragStateRef.current;
      if (cur) {
        setDragState(null);
        onHoverTargetChange(null);
        const trayRect = trayRef.current?.getBoundingClientRect();
        // Returning piece back onto tray cancels cleanly without Miss
        if (trayRect && e.clientY >= trayRect.top) {
          return;
        }
        const matched = isTargetMatchAtClientPoint(cur.piece, e.clientX, e.clientY);
        onPlaceAttempt(cur.piece.id, matched);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPieceId]);

  if (!config.showPieceList) {
    if (config.disableHelpButton) return null;
    return (
      <button type="button" className="floating-hint-btn" onClick={onHelp}>
        ？ヒント
      </button>
    );
  }

  return (
    <>
      <div ref={trayRef} className={`puzzle-tray ${minimized ? 'is-minimized' : ''}`}>
        <div className="puzzle-tray-header">
          <span>
            残りピース: <strong>{remainingPieces.length}</strong> 件
            {selectedPieceId &&
              (() => {
                const p = remainingPieces.find((x) => x.id === selectedPieceId);
                return p ? ` ・ 選択中「${config.nameInList ? p.name : '？'}」（地図上の位置をタップでも配置可）` : '';
              })()}
          </span>
          <div className="puzzle-tray-ctrls">
            {!config.disableHelpButton && (
              <button
                type="button"
                className="btn-warning btn-xs"
                onClick={onHelp}
              >
                ？ヒント
              </button>
            )}
            <button
              type="button"
              className="tray-nav-btn"
              onClick={() =>
                scrollWrapRef.current?.scrollBy({ left: -240, behavior: 'smooth' })
              }
            >
              ◀
            </button>
            <button
              type="button"
              className="tray-nav-btn"
              onClick={() =>
                scrollWrapRef.current?.scrollBy({ left: 240, behavior: 'smooth' })
              }
            >
              ▶
            </button>
            <button
              type="button"
              className="tray-toggle-btn"
              onClick={() => setMinimized((m) => !m)}
            >
              {minimized ? '▲ 開く' : '▼ 隠す'}
            </button>
          </div>
        </div>

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
            {remainingPieces.map((piece) => {
              const isSelected = selectedPieceId === piece.id;
              const transformAttr = getPieceTransformAttr(piece, loadedMap);
              return (
                <div
                  key={piece.id}
                  className={`puzzle-piece-card ${isSelected ? 'selected' : ''}`}
                  onPointerDown={(e) => {
                    if (e.pointerType === 'mouse' && e.button !== 0) return;
                    pendingPressRef.current = {
                      piece,
                      startX: e.clientX,
                      startY: e.clientY,
                      pointerId: e.pointerId,
                    };
                  }}
                >
                  <svg viewBox={getPaddedViewBox(piece)} className="puzzle-piece-thumb">
                    <g transform={transformAttr}>
                      <path
                        d={piece.path}
                        fill="#f97316"
                        fillRule="evenodd"
                        stroke="#7c2d12"
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
                      </>
                    ) : (
                      <span className="pk">？？？</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Silhouette under pointer while dragging */}
      {dragState && (
        <div
          className="puzzle-drag-ghost"
          style={{
            left: dragState.clientX,
            top: dragState.clientY,
          }}
        >
          <svg viewBox={getPaddedViewBox(dragState.piece)} className="drag-ghost-svg">
            <g transform={getPieceTransformAttr(dragState.piece, loadedMap)}>
              <path
                d={dragState.piece.path}
                fill="#fb923c"
                fillOpacity={0.85}
                fillRule="evenodd"
                stroke="#9a3412"
                strokeWidth={1.6}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          </svg>
          {config.nameOnDrag && (
            <div className="drag-ghost-name">{dragState.piece.name}</div>
          )}
        </div>
      )}
    </>
  );
};
