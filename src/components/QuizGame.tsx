import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shuffleArray } from '../services/mapDataLoader';
import type { MapPieceItem, QuizChoiceLayout } from '../types/game';

export interface SvgContainerPoint {
  x: number;
  y: number;
  scale: number;
  width: number;
  height: number;
}

interface QuizGameProps {
  activePiece: MapPieceItem;
  allPoolPieces: MapPieceItem[];
  isGeographyQuiz: boolean;
  disableHelpButton: boolean;
  hintStage: 0 | 1 | 2;
  quizChoiceLayout: QuizChoiceLayout;
  hasJumpBar: boolean;
  svgToContainerPoint: (sx: number, sy: number) => SvgContainerPoint | null;
  getSvgRect: () => DOMRect | null;
  subscribeLiveViewBox: (listener: () => void) => () => void;
  onFocusPiece: (piece: MapPieceItem) => void;
  onHint1: () => void;
  onHint2: () => void;
  onToggleQuizChoiceLayout: () => void;
  onAnswerResult: (correct: boolean) => void;
}

interface PointingCardPos {
  choice: MapPieceItem;
  x: number;
  y: number;
  width: number;
  height: number;
  attachX: number;
  attachY: number;
}

interface PointingLayout {
  containerW: number;
  containerH: number;
  anchorX: number;
  anchorY: number;
  anchorVisible: boolean;
  lineTargetX: number;
  lineTargetY: number;
  cards: PointingCardPos[];
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function getTargetSvgAnchor(piece: MapPieceItem): [number, number] {
  const [cx, cy] = piece.center;
  if (piece.geoCategory === 'river' && piece.linePts && piece.linePts.length > 0) {
    let bestPt: [number, number] = piece.linePts[0];
    let bestDistSq = Infinity;
    for (const pt of piece.linePts) {
      const dx = pt[0] - cx;
      const dy = pt[1] - cy;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestPt = pt;
      }
    }
    return bestPt;
  }
  return [cx, cy];
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function placeColumnCards(
  items: MapPieceItem[],
  x: number,
  centerY: number,
  cardW: number,
  cardH: number,
  gapY: number,
  safeTop: number,
  safeBottom: number,
): { choice: MapPieceItem; x: number; y: number; width: number; height: number }[] {
  if (items.length === 0) return [];
  const stackH = items.length * cardH + (items.length - 1) * gapY;
  const startY = clamp(centerY - stackH / 2, safeTop, safeBottom - stackH);
  return items.map((choice, idx) => ({
    choice,
    x,
    y: startY + idx * (cardH + gapY),
    width: cardW,
    height: cardH,
  }));
}

function placeRowCards(
  items: MapPieceItem[],
  centerX: number,
  y: number,
  cardW: number,
  cardH: number,
  gapX: number,
  safeLeft: number,
  safeRight: number,
): { choice: MapPieceItem; x: number; y: number; width: number; height: number }[] {
  if (items.length === 0) return [];
  const rowW = items.length * cardW + (items.length - 1) * gapX;
  const startX = clamp(centerX - rowW / 2, safeLeft, safeRight - rowW);
  return items.map((choice, idx) => ({
    choice,
    x: startX + idx * (cardW + gapX),
    y,
    width: cardW,
    height: cardH,
  }));
}

export const QuizGame: React.FC<QuizGameProps> = ({
  activePiece,
  allPoolPieces,
  isGeographyQuiz,
  disableHelpButton,
  hintStage,
  quizChoiceLayout,
  hasJumpBar,
  svgToContainerPoint,
  getSvgRect,
  subscribeLiveViewBox,
  onFocusPiece,
  onHint1,
  onHint2,
  onToggleQuizChoiceLayout,
  onAnswerResult,
}) => {
  const [disabledChoiceIds, setDisabledChoiceIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<'ok' | 'ng' | null>(null);
  const [pointingLayout, setPointingLayout] = useState<PointingLayout | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);

  // Build 6 unique-label choices (Ver 3.5.3 duplicate kanji protection)
  const choices = useMemo(() => {
    const answerLabel = activePiece.answerKanji ?? activePiece.name;
    const seenLabels = new Set<string>([answerLabel]);
    const distractors: MapPieceItem[] = [];

    for (const candidate of shuffleArray(allPoolPieces)) {
      if (candidate.id === activePiece.id) continue;
      const lbl = candidate.answerKanji ?? candidate.name;
      if (seenLabels.has(lbl)) continue;
      seenLabels.add(lbl);
      distractors.push(candidate);
      if (distractors.length >= 5) break;
    }

    return shuffleArray([activePiece, ...distractors]);
  }, [activePiece, allPoolPieces]);

  // Deterministically eliminate 2 wrong distractors when Hint 1+ is active
  const hintEliminatedIds = useMemo(() => {
    const eliminated = new Set<string>();
    if (hintStage < 1) return eliminated;
    const wrongs = choices.filter((c) => c.id !== activePiece.id);
    const sorted = [...wrongs].sort(
      (a, b) =>
        hashString(`${activePiece.id}:${a.id}`) - hashString(`${activePiece.id}:${b.id}`),
    );
    for (const item of sorted.slice(0, 2)) {
      eliminated.add(item.id);
    }
    return eliminated;
  }, [hintStage, choices, activePiece.id]);

  const computePointingLayout = useCallback((): PointingLayout | null => {
    const layerEl = layerRef.current;
    const svgRect = getSvgRect();
    if (!layerEl || !svgRect) return null;

    const layerRect = layerEl.getBoundingClientRect();
    const containerW = layerRect.width;
    const containerH = layerRect.height;
    if (containerW < 120 || containerH < 120) return null;

    const [svgAnchorX, svgAnchorY] = getTargetSvgAnchor(activePiece);
    const anchorPt = svgToContainerPoint(svgAnchorX, svgAnchorY);
    const tlPt = svgToContainerPoint(activePiece.bbox[0], activePiece.bbox[1]);
    const brPt = svgToContainerPoint(activePiece.bbox[2], activePiece.bbox[3]);
    if (!anchorPt || !tlPt || !brPt) return null;

    const offsetX = svgRect.left - layerRect.left;
    const offsetY = svgRect.top - layerRect.top;

    const anchorX = anchorPt.x + offsetX;
    const anchorY = anchorPt.y + offsetY;

    const targetHalfW = Math.min(130, Math.max(12, Math.abs(brPt.x - tlPt.x) / 2));
    const targetHalfH = Math.min(110, Math.max(12, Math.abs(brPt.y - tlPt.y) / 2));

    const hasGeoDesc = Boolean(isGeographyQuiz && activePiece.desc);
    const safeLeft = 70;
    const safeRight = Math.max(safeLeft + 150, containerW - 14);
    const safeTop = Math.max(68, Math.round(offsetY + (hasJumpBar ? 42 : 12)));
    const svgBottomInLayer = svgRect.bottom - layerRect.top;
    const safeBottom = Math.max(
      safeTop + 150,
      Math.min(
        Math.round(svgBottomInLayer - 10),
        Math.round(containerH - (hasGeoDesc ? 132 : 84)),
      ),
    );

    const safeW = safeRight - safeLeft;
    const safeH = safeBottom - safeTop;
    const cardW = safeW < 370 ? Math.max(114, Math.floor((safeW - 20) / 2)) : 148;
    const cardH = 44;
    const gapY = 8;
    const gapX = 10;

    const clampedAnchorX = clamp(anchorX, safeLeft + 10, safeRight - 10);
    const clampedAnchorY = clamp(anchorY, safeTop + 10, safeBottom - 10);

    const svgVisLeft = offsetX + 4;
    const svgVisRight = offsetX + svgRect.width - 4;
    const svgVisTop = offsetY + 4;
    const svgVisBottom = offsetY + svgRect.height - 4;

    const anchorVisible =
      anchorX >= svgVisLeft - 12 &&
      anchorX <= svgVisRight + 12 &&
      anchorY >= svgVisTop - 12 &&
      anchorY <= svgVisBottom + 12;

    const lineTargetX = anchorVisible ? anchorX : clamp(anchorX, svgVisLeft, svgVisRight);
    const lineTargetY = anchorVisible ? anchorY : clamp(anchorY, svgVisTop, svgVisBottom);

    const horizOffset = Math.max(46, targetHalfW + 24);
    const idealLeftX = clampedAnchorX - horizOffset - cardW;
    const idealRightX = clampedAnchorX + horizOffset;
    const canPlaceLeft = idealLeftX >= safeLeft;
    const canPlaceRight = idealRightX + cardW <= safeRight;

    const n = choices.length;
    const leftCount = Math.ceil(n / 2);
    const leftSlice = choices.slice(0, leftCount);
    const rightSlice = choices.slice(leftCount);

    let rawCards: { choice: MapPieceItem; x: number; y: number; width: number; height: number }[];

    if (canPlaceLeft && canPlaceRight) {
      rawCards = [
        ...placeColumnCards(
          leftSlice,
          idealLeftX,
          clampedAnchorY,
          cardW,
          cardH,
          gapY,
          safeTop,
          safeBottom,
        ),
        ...placeColumnCards(
          rightSlice,
          idealRightX,
          clampedAnchorY,
          cardW,
          cardH,
          gapY,
          safeTop,
          safeBottom,
        ),
      ];
    } else if (!canPlaceLeft && canPlaceRight) {
      const allStackH = n * cardH + Math.max(0, n - 1) * gapY;
      if (allStackH <= safeH) {
        rawCards = placeColumnCards(
          choices,
          Math.min(safeRight - cardW, idealRightX),
          clampedAnchorY,
          cardW,
          cardH,
          gapY,
          safeTop,
          safeBottom,
        );
      } else if (idealRightX + cardW * 2 + gapX <= safeRight) {
        rawCards = [
          ...placeColumnCards(
            leftSlice,
            idealRightX,
            clampedAnchorY,
            cardW,
            cardH,
            gapY,
            safeTop,
            safeBottom,
          ),
          ...placeColumnCards(
            rightSlice,
            idealRightX + cardW + gapX,
            clampedAnchorY,
            cardW,
            cardH,
            gapY,
            safeTop,
            safeBottom,
          ),
        ];
      } else {
        // Right column + above/below fan so nothing overlaps target or clips viewport
        const rightColX = Math.min(safeRight - cardW, idealRightX);
        const roomAbove = clampedAnchorY - targetHalfH - 18 - safeTop;
        const roomBelow = safeBottom - (clampedAnchorY + targetHalfH + 18);
        const fanY =
          roomAbove >= roomBelow
            ? clamp(clampedAnchorY - targetHalfH - 18 - cardH, safeTop, safeBottom - cardH)
            : clamp(clampedAnchorY + targetHalfH + 18, safeTop, safeBottom - cardH);
        const fanMaxRight = Math.max(safeLeft + cardW, rightColX - gapX);
        rawCards = [
          ...placeColumnCards(
            rightSlice,
            rightColX,
            clampedAnchorY,
            cardW,
            cardH,
            gapY,
            safeTop,
            safeBottom,
          ),
          ...placeRowCards(
            leftSlice,
            clampedAnchorX,
            fanY,
            Math.min(cardW, Math.max(96, Math.floor((fanMaxRight - safeLeft - gapX * 2) / Math.max(1, leftSlice.length)))),
            cardH,
            gapX,
            safeLeft,
            fanMaxRight,
          ),
        ];
      }
    } else if (canPlaceLeft && !canPlaceRight) {
      const allStackH = n * cardH + Math.max(0, n - 1) * gapY;
      if (allStackH <= safeH) {
        rawCards = placeColumnCards(
          choices,
          Math.max(safeLeft, idealLeftX),
          clampedAnchorY,
          cardW,
          cardH,
          gapY,
          safeTop,
          safeBottom,
        );
      } else if (idealLeftX - cardW - gapX >= safeLeft) {
        rawCards = [
          ...placeColumnCards(
            leftSlice,
            idealLeftX - cardW - gapX,
            clampedAnchorY,
            cardW,
            cardH,
            gapY,
            safeTop,
            safeBottom,
          ),
          ...placeColumnCards(
            rightSlice,
            idealLeftX,
            clampedAnchorY,
            cardW,
            cardH,
            gapY,
            safeTop,
            safeBottom,
          ),
        ];
      } else {
        const leftColX = Math.max(safeLeft, idealLeftX);
        const roomAbove = clampedAnchorY - targetHalfH - 18 - safeTop;
        const roomBelow = safeBottom - (clampedAnchorY + targetHalfH + 18);
        const fanY =
          roomAbove >= roomBelow
            ? clamp(clampedAnchorY - targetHalfH - 18 - cardH, safeTop, safeBottom - cardH)
            : clamp(clampedAnchorY + targetHalfH + 18, safeTop, safeBottom - cardH);
        const fanMinLeft = Math.min(safeRight - cardW, leftColX + cardW + gapX);
        rawCards = [
          ...placeColumnCards(
            leftSlice,
            leftColX,
            clampedAnchorY,
            cardW,
            cardH,
            gapY,
            safeTop,
            safeBottom,
          ),
          ...placeRowCards(
            rightSlice,
            clampedAnchorX,
            fanY,
            Math.min(cardW, Math.max(96, Math.floor((safeRight - fanMinLeft - gapX * 2) / Math.max(1, rightSlice.length)))),
            cardH,
            gapX,
            fanMinLeft,
            safeRight,
          ),
        ];
      }
    } else {
      // Narrow screen or wide target: place at left & right safe edges if non-overlapping, else top/bottom rows
      const leftEdgeX = safeLeft;
      const rightEdgeX = safeRight - cardW;
      if (leftEdgeX + cardW + gapX <= rightEdgeX) {
        rawCards = [
          ...placeColumnCards(
            leftSlice,
            leftEdgeX,
            clampedAnchorY,
            cardW,
            cardH,
            gapY,
            safeTop,
            safeBottom,
          ),
          ...placeColumnCards(
            rightSlice,
            rightEdgeX,
            clampedAnchorY,
            cardW,
            cardH,
            gapY,
            safeTop,
            safeBottom,
          ),
        ];
      } else {
        const compactW = Math.max(
          92,
          Math.min(cardW, Math.floor((safeW - gapX * 2) / Math.max(1, leftSlice.length))),
        );
        rawCards = [
          ...placeRowCards(
            leftSlice,
            (safeLeft + safeRight) / 2,
            safeTop,
            compactW,
            cardH,
            gapX,
            safeLeft,
            safeRight,
          ),
          ...placeRowCards(
            rightSlice,
            (safeLeft + safeRight) / 2,
            safeBottom - cardH,
            compactW,
            cardH,
            gapX,
            safeLeft,
            safeRight,
          ),
        ];
      }
    }

    // Clamp inside safe bounds and resolve any residual pairwise overlap
    for (const c of rawCards) {
      c.x = clamp(c.x, safeLeft, safeRight - c.width);
      c.y = clamp(c.y, safeTop, safeBottom - c.height);
    }
    for (let iter = 0; iter < 6; iter += 1) {
      let moved = false;
      for (let i = 0; i < rawCards.length; i += 1) {
        for (let j = i + 1; j < rawCards.length; j += 1) {
          const a = rawCards[i];
          const b = rawCards[j];
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + 4;
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + 4;
          if (overlapX > 0 && overlapY > 0) {
            moved = true;
            if (overlapY <= overlapX) {
              const push = overlapY / 2 + 1;
              if (a.y <= b.y) {
                a.y = clamp(a.y - push, safeTop, safeBottom - a.height);
                b.y = clamp(b.y + push, safeTop, safeBottom - b.height);
              } else {
                b.y = clamp(b.y - push, safeTop, safeBottom - b.height);
                a.y = clamp(a.y + push, safeTop, safeBottom - a.height);
              }
            } else {
              const push = overlapX / 2 + 1;
              if (a.x <= b.x) {
                a.x = clamp(a.x - push, safeLeft, safeRight - a.width);
                b.x = clamp(b.x + push, safeLeft, safeRight - b.width);
              } else {
                b.x = clamp(b.x - push, safeLeft, safeRight - b.width);
                a.x = clamp(a.x + push, safeLeft, safeRight - a.width);
              }
            }
          }
        }
      }
      if (!moved) break;
    }

    const cards: PointingCardPos[] = rawCards.map((c) => {
      let attachX: number;
      let attachY: number;
      if (c.x + c.width <= lineTargetX) {
        attachX = c.x + c.width;
        attachY = c.y + c.height / 2;
      } else if (c.x >= lineTargetX) {
        attachX = c.x;
        attachY = c.y + c.height / 2;
      } else if (c.y + c.height <= lineTargetY) {
        attachX = c.x + c.width / 2;
        attachY = c.y + c.height;
      } else {
        attachX = c.x + c.width / 2;
        attachY = c.y;
      }
      return {
        ...c,
        attachX,
        attachY,
      };
    });

    return {
      containerW,
      containerH,
      anchorX,
      anchorY,
      anchorVisible,
      lineTargetX,
      lineTargetY,
      cards,
    };
  }, [activePiece, choices, getSvgRect, hasJumpBar, isGeographyQuiz, svgToContainerPoint]);

  useEffect(() => {
    if (quizChoiceLayout !== 'pointing') return;
    let rafId: number | null = null;
    const scheduleUpdate = () => {
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setPointingLayout(computePointingLayout());
      });
    };

    scheduleUpdate();
    const unsub = subscribeLiveViewBox(scheduleUpdate);
    window.addEventListener('resize', scheduleUpdate);
    const layerEl = layerRef.current;
    const ro =
      typeof ResizeObserver !== 'undefined' && layerEl
        ? new ResizeObserver(scheduleUpdate)
        : null;
    if (ro && layerEl) ro.observe(layerEl);

    return () => {
      unsub();
      window.removeEventListener('resize', scheduleUpdate);
      ro?.disconnect();
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [quizChoiceLayout, computePointingLayout, subscribeLiveViewBox]);

  const handleChoose = (opt: MapPieceItem) => {
    if (
      disabledChoiceIds.has(opt.id) ||
      hintEliminatedIds.has(opt.id) ||
      feedback === 'ok' ||
      hintStage >= 2
    ) {
      return;
    }
    if (opt.id === activePiece.id) {
      setFeedback('ok');
      onAnswerResult(true);
    } else {
      setFeedback('ng');
      setDisabledChoiceIds((prev) => new Set(prev).add(opt.id));
      onAnswerResult(false);
    }
  };

  const renderActionButtons = () => (
    <div className="quiz-prompt-actions">
      <button
        type="button"
        className="btn-secondary btn-xs"
        onClick={() => onFocusPiece(activePiece)}
      >
        📍 場所へフォーカス
      </button>
      {!disableHelpButton && (
        <div className="hint-btn-group">
          <button
            type="button"
            className="btn-hint1 btn-xs"
            title="この辺の大きな範囲を表示"
            onClick={onHint1}
          >
            💡 ヒント1
          </button>
          <button
            type="button"
            className="btn-hint2 btn-xs"
            title="その場所へ直接当てはめる"
            onClick={onHint2}
          >
            💡 ヒント2
          </button>
        </div>
      )}
      <button
        type="button"
        className="btn-secondary btn-xs"
        onClick={onToggleQuizChoiceLayout}
      >
        {quizChoiceLayout === 'pointing' ? '📋 下部に選択肢' : '📌 地図上に選択肢'}
      </button>
    </div>
  );

  if (quizChoiceLayout === 'pointing') {
    return (
      <>
        <div ref={layerRef} className="quiz-pointing-layer">
          {pointingLayout && (
            <>
              <svg
                className="quiz-pointing-lines"
                width={pointingLayout.containerW}
                height={pointingLayout.containerH}
                aria-hidden="true"
              >
                {pointingLayout.cards.map((card) => {
                  const isWrong = disabledChoiceIds.has(card.choice.id);
                  const isElim = !isWrong && hintEliminatedIds.has(card.choice.id);
                  const isCorrect = hintStage >= 2 && card.choice.id === activePiece.id;
                  const strokeColor = isCorrect
                    ? '#059669'
                    : isWrong || isElim
                      ? '#cbd5e1'
                      : '#d97706';
                  const opacity = isWrong || isElim ? 0.45 : 0.92;
                  return (
                    <g key={`line-${card.choice.id}`} opacity={opacity}>
                      <line
                        x1={card.attachX}
                        y1={card.attachY}
                        x2={pointingLayout.lineTargetX}
                        y2={pointingLayout.lineTargetY}
                        stroke="#ffffff"
                        strokeWidth={isCorrect ? 5 : 3.6}
                        strokeLinecap="round"
                      />
                      <line
                        x1={card.attachX}
                        y1={card.attachY}
                        x2={pointingLayout.lineTargetX}
                        y2={pointingLayout.lineTargetY}
                        stroke={strokeColor}
                        strokeWidth={isCorrect ? 2.6 : 1.7}
                        strokeDasharray={isWrong || isElim ? '4 4' : undefined}
                        strokeLinecap="round"
                      />
                    </g>
                  );
                })}
                {pointingLayout.anchorVisible && (
                  <g>
                    <circle
                      cx={pointingLayout.anchorX}
                      cy={pointingLayout.anchorY}
                      r={8.5}
                      fill="rgba(234, 88, 12, 0.22)"
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                    <circle
                      cx={pointingLayout.anchorX}
                      cy={pointingLayout.anchorY}
                      r={4.8}
                      fill={hintStage >= 2 ? '#059669' : '#ea580c'}
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  </g>
                )}
              </svg>

              {pointingLayout.cards.map((card) => {
                const opt = card.choice;
                const isWrong = disabledChoiceIds.has(opt.id);
                const isElim = !isWrong && hintEliminatedIds.has(opt.id);
                const isCorrect = hintStage >= 2 && opt.id === activePiece.id;
                const kanji = opt.answerKanji ?? opt.name;
                const ruby = opt.answerRuby ?? opt.ruby;
                const cls = [
                  'quiz-pointing-card',
                  isWrong ? 'is-wrong-disabled' : '',
                  isElim ? 'is-hint-eliminated' : '',
                  isCorrect ? 'is-hint-correct' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isWrong || isElim}
                    className={cls}
                    style={{
                      position: 'absolute',
                      left: card.x,
                      top: card.y,
                      width: card.width,
                      minHeight: card.height,
                    }}
                    onClick={() => handleChoose(opt)}
                  >
                    <span className="choice-ruby">{ruby}</span>
                    <span className="choice-kanji">{kanji}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>

        <div className="bottom-play-panel quiz-panel quiz-pointing-bar">
          {isGeographyQuiz && activePiece.desc && (
            <div className="geo-text-window">
              <div className="geo-text-badge">{activePiece.regionLabel}</div>
              <p>{activePiece.desc}</p>
            </div>
          )}

          <div className="quiz-prompt-row">
            <span className="quiz-prompt-text">
              地図上の選択肢からハイライト地点の名前を選択してください
            </span>
            {renderActionButtons()}
          </div>

          {feedback && (
            <div className={`judge-badge ${feedback === 'ok' ? 'is-ok' : 'is-ng'}`}>
              {feedback === 'ok' ? '○' : '×'}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="bottom-play-panel quiz-panel">
      {/* TextWindow for GeographyQuiz (capital_q / mountains / mountain / river / plain / lake) */}
      {isGeographyQuiz && activePiece.desc && (
        <div className="geo-text-window">
          <div className="geo-text-badge">{activePiece.regionLabel}</div>
          <p>{activePiece.desc}</p>
        </div>
      )}

      <div className="quiz-prompt-row">
        <span className="quiz-prompt-text">
          地図でハイライトされている場所の名前を選択してください
        </span>
        {renderActionButtons()}
      </div>

      <div className="quiz-choices-grid">
        {choices.map((opt) => {
          const isWrong = disabledChoiceIds.has(opt.id);
          const isElim = !isWrong && hintEliminatedIds.has(opt.id);
          const isCorrect = hintStage >= 2 && opt.id === activePiece.id;
          const kanji = opt.answerKanji ?? opt.name;
          const ruby = opt.answerRuby ?? opt.ruby;
          const cls = [
            'quiz-choice-btn',
            isWrong ? 'is-wrong-disabled' : '',
            isElim ? 'is-hint-eliminated' : '',
            isCorrect ? 'is-hint-correct' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={opt.id}
              type="button"
              disabled={isWrong || isElim}
              className={cls}
              onClick={() => handleChoose(opt)}
            >
              <span className="choice-ruby">{ruby}</span>
              <span className="choice-kanji">{kanji}</span>
            </button>
          );
        })}
      </div>

      {feedback && (
        <div className={`judge-badge ${feedback === 'ok' ? 'is-ok' : 'is-ng'}`}>
          {feedback === 'ok' ? '○' : '×'}
        </div>
      )}
    </div>
  );
};
