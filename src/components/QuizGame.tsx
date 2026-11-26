import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  quizChoiceLayout: QuizChoiceLayout;
  nameOnFix: boolean;
  hasJumpBar: boolean;
  modalOpen?: boolean;
  mapStageEl?: HTMLDivElement | null;
  svgToContainerPoint: (sx: number, sy: number) => SvgContainerPoint | null;
  getSvgRect: () => DOMRect | null;
  subscribeLiveViewBox: (listener: () => void) => () => void;
  onFocusPiece: (piece: MapPieceItem) => void;
  onUseHint: () => void;
  onHintEliminatedAll?: () => void;
  onGiveUp?: () => void;
  onAdvanceAfterGiveUp?: () => void;
  onToggleQuizChoiceLayout: () => void;
  onToggleNameOnFix: () => void;
  onAnswerResult: (correct: boolean) => void;
}

interface PointingCardPos {
  choice: MapPieceItem;
  choiceIdx: number;
  x: number;
  y: number;
  width: number;
  height: number;
  attachX: number;
  attachY: number;
  isMultiline: boolean;
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

interface IndexedChoice {
  choice: MapPieceItem;
  choiceIdx: number;
}

function placeColumnCards(
  items: IndexedChoice[],
  x: number,
  centerY: number,
  cardW: number,
  cardH: number,
  gapY: number,
  safeTop: number,
  safeBottom: number,
): { choice: MapPieceItem; choiceIdx: number; x: number; y: number; width: number; height: number }[] {
  if (items.length === 0) return [];
  const stackH = items.length * cardH + (items.length - 1) * gapY;
  const startY = clamp(centerY - stackH / 2, safeTop, safeBottom - stackH);
  return items.map((item, idx) => ({
    choice: item.choice,
    choiceIdx: item.choiceIdx,
    x,
    y: startY + idx * (cardH + gapY),
    width: cardW,
    height: cardH,
  }));
}

function placeRowCards(
  items: IndexedChoice[],
  centerX: number,
  y: number,
  cardW: number,
  cardH: number,
  gapX: number,
  safeLeft: number,
  safeRight: number,
): { choice: MapPieceItem; choiceIdx: number; x: number; y: number; width: number; height: number }[] {
  if (items.length === 0) return [];
  const rowW = items.length * cardW + (items.length - 1) * gapX;
  const startX = clamp(centerX - rowW / 2, safeLeft, safeRight - rowW);
  return items.map((item, idx) => ({
    choice: item.choice,
    choiceIdx: item.choiceIdx,
    x: startX + idx * (cardW + gapX),
    y,
    width: cardW,
    height: cardH,
  }));
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

const QuizGameInner: React.FC<QuizGameProps> = ({
  activePiece,
  allPoolPieces,
  isGeographyQuiz,
  disableHelpButton,
  quizChoiceLayout,
  nameOnFix,
  hasJumpBar,
  modalOpen = false,
  mapStageEl = null,
  svgToContainerPoint,
  getSvgRect,
  subscribeLiveViewBox,
  onFocusPiece,
  onUseHint,
  onHintEliminatedAll,
  onGiveUp,
  onAdvanceAfterGiveUp,
  onToggleQuizChoiceLayout,
  onToggleNameOnFix,
  onAnswerResult,
}) => {
  const [disabledChoiceIds, setDisabledChoiceIds] = useState<Set<string>>(new Set());
  const [hintEliminatedIds, setHintEliminatedIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<'ok' | 'ng' | null>(null);
  const [missNonce, setMissNonce] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [hoveredChoiceId, setHoveredChoiceId] = useState<string | null>(null);
  const [pointingLayout, setPointingLayout] = useState<PointingLayout | null>(null);
  const [prevChoiceLayout, setPrevChoiceLayout] = useState<QuizChoiceLayout>(quizChoiceLayout);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const ngClearTimerRef = useRef<number | null>(null);

  // Clear any stale pointing coordinates immediately when switching layout modes
  if (prevChoiceLayout !== quizChoiceLayout) {
    setPrevChoiceLayout(quizChoiceLayout);
    setPointingLayout(null);
  }

  useEffect(() => {
    return () => {
      if (ngClearTimerRef.current != null) window.clearTimeout(ngClearTimerRef.current);
    };
  }, []);

  // Build 6 unique-label choices (duplicate kanji protection)
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

  const remainingWrongChoices = useMemo(
    () =>
      choices.filter(
        (c) =>
          c.id !== activePiece.id &&
          !disabledChoiceIds.has(c.id) &&
          !hintEliminatedIds.has(c.id),
      ),
    [choices, activePiece.id, disabledChoiceIds, hintEliminatedIds],
  );

  const handleUseHint = useCallback(() => {
    if (feedback === 'ok' || revealed || remainingWrongChoices.length === 0) return;
    const sorted = [...remainingWrongChoices].sort(
      (a, b) =>
        hashString(`${activePiece.id}:${a.id}`) - hashString(`${activePiece.id}:${b.id}`),
    );
    const toEliminate = sorted.slice(0, 2);
    setHintEliminatedIds((prev) => {
      const next = new Set(prev);
      for (const item of toEliminate) {
        next.add(item.id);
      }
      return next;
    });
    onUseHint();
    if (remainingWrongChoices.length - toEliminate.length <= 0) {
      onHintEliminatedAll?.();
    }
  }, [
    feedback,
    revealed,
    remainingWrongChoices,
    activePiece.id,
    onUseHint,
    onHintEliminatedAll,
  ]);

  const handleGiveUp = useCallback(() => {
    if (feedback === 'ok' || revealed) return;
    setRevealed(true);
    setFeedback(null);
    if (ngClearTimerRef.current != null) {
      window.clearTimeout(ngClearTimerRef.current);
      ngClearTimerRef.current = null;
    }
    onGiveUp?.();
  }, [feedback, revealed, onGiveUp]);

  const handleChoose = useCallback(
    (opt: MapPieceItem) => {
      if (revealed) {
        if (opt.id === activePiece.id) {
          onAdvanceAfterGiveUp?.();
        }
        return;
      }
      if (
        disabledChoiceIds.has(opt.id) ||
        hintEliminatedIds.has(opt.id) ||
        feedback === 'ok'
      ) {
        return;
      }
      if (opt.id === activePiece.id) {
        if (ngClearTimerRef.current != null) {
          window.clearTimeout(ngClearTimerRef.current);
          ngClearTimerRef.current = null;
        }
        setFeedback('ok');
        onAnswerResult(true);
      } else {
        setFeedback('ng');
        setMissNonce((n) => n + 1);
        setDisabledChoiceIds((prev) => new Set(prev).add(opt.id));
        onAnswerResult(false);
        if (ngClearTimerRef.current != null) window.clearTimeout(ngClearTimerRef.current);
        ngClearTimerRef.current = window.setTimeout(() => {
          setFeedback((cur) => (cur === 'ng' ? null : cur));
          ngClearTimerRef.current = null;
        }, 900);
      }
    },
    [
      revealed,
      activePiece.id,
      onAdvanceAfterGiveUp,
      disabledChoiceIds,
      hintEliminatedIds,
      feedback,
      onAnswerResult,
    ],
  );

  // Keyboard shortcuts: 1-6 select choice, H hint, F focus, L toggle layout, Enter/Space advance on reveal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        modalOpen ||
        e.isComposing ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        isEditableEventTarget(e.target)
      ) {
        return;
      }
      if (revealed && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onAdvanceAfterGiveUp?.();
        return;
      }
      if (e.key >= '1' && e.key <= '6') {
        const idx = Number(e.key) - 1;
        const opt = choices[idx];
        if (opt) {
          e.preventDefault();
          handleChoose(opt);
        }
        return;
      }
      const lower = e.key.toLowerCase();
      if (lower === 'h' && !disableHelpButton) {
        e.preventDefault();
        handleUseHint();
      } else if (lower === 'f') {
        e.preventDefault();
        onFocusPiece(activePiece);
      } else if (lower === 'l') {
        e.preventDefault();
        onToggleQuizChoiceLayout();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    modalOpen,
    revealed,
    choices,
    disableHelpButton,
    activePiece,
    handleChoose,
    handleUseHint,
    onAdvanceAfterGiveUp,
    onFocusPiece,
    onToggleQuizChoiceLayout,
  ]);

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

    const targetHalfW = Math.min(126, Math.max(14, Math.abs(brPt.x - tlPt.x) / 2));
    const targetHalfH = Math.min(106, Math.max(14, Math.abs(brPt.y - tlPt.y) / 2));

    const isNarrow = containerW < 560;
    const safeLeft = isNarrow ? 54 : 68;
    const safeRight = Math.max(safeLeft + 150, containerW - 12);
    const safeTop = Math.max(
      hasJumpBar ? (isNarrow ? 44 : 48) : 10,
      Math.round(offsetY + (hasJumpBar ? 44 : 10)),
    );
    const svgBottomInLayer = svgRect.bottom - layerRect.top;
    const safeBottom = Math.max(
      safeTop + 140,
      Math.min(Math.round(svgBottomInLayer - 10), Math.round(containerH - 10)),
    );

    const safeW = safeRight - safeLeft;
    const safeH = safeBottom - safeTop;
    const cardW = safeW < 390 ? Math.max(108, Math.floor((safeW - 16) / 2)) : 154;
    const cardH = isNarrow ? 48 : 46;
    const gapY = 8;
    const gapX = 8;

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

    const horizOffset = Math.max(38, targetHalfW + 20);
    const idealLeftX = clampedAnchorX - horizOffset - cardW;
    const idealRightX = clampedAnchorX + horizOffset;
    const canPlaceLeft = idealLeftX >= safeLeft;
    const canPlaceRight = idealRightX + cardW <= safeRight;

    const indexed: IndexedChoice[] = choices.map((choice, choiceIdx) => ({
      choice,
      choiceIdx,
    }));
    const n = indexed.length;
    const leftCount = Math.ceil(n / 2);
    const leftSlice = indexed.slice(0, leftCount);
    const rightSlice = indexed.slice(leftCount);

    let rawCards: {
      choice: MapPieceItem;
      choiceIdx: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }[];

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
          indexed,
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
        const rightColX = Math.min(safeRight - cardW, idealRightX);
        const roomAbove = clampedAnchorY - targetHalfH - 16 - safeTop;
        const roomBelow = safeBottom - (clampedAnchorY + targetHalfH + 16);
        const fanY =
          roomAbove >= roomBelow
            ? clamp(clampedAnchorY - targetHalfH - 16 - cardH, safeTop, safeBottom - cardH)
            : clamp(clampedAnchorY + targetHalfH + 16, safeTop, safeBottom - cardH);
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
            Math.min(
              cardW,
              Math.max(
                94,
                Math.floor(
                  (fanMaxRight - safeLeft - gapX * 2) / Math.max(1, leftSlice.length),
                ),
              ),
            ),
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
          indexed,
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
        const roomAbove = clampedAnchorY - targetHalfH - 16 - safeTop;
        const roomBelow = safeBottom - (clampedAnchorY + targetHalfH + 16);
        const fanY =
          roomAbove >= roomBelow
            ? clamp(clampedAnchorY - targetHalfH - 16 - cardH, safeTop, safeBottom - cardH)
            : clamp(clampedAnchorY + targetHalfH + 16, safeTop, safeBottom - cardH);
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
            Math.min(
              cardW,
              Math.max(
                94,
                Math.floor(
                  (safeRight - fanMinLeft - gapX * 2) / Math.max(1, rightSlice.length),
                ),
              ),
            ),
            cardH,
            gapX,
            fanMinLeft,
            safeRight,
          ),
        ];
      }
    } else {
      // Only place left/right edge columns if they truly clear the target shape;
      // otherwise place 3+3 rows above and below the target so cards NEVER cover it!
      const leftEdgeX = safeLeft;
      const rightEdgeX = safeRight - cardW;
      const edgesClearTarget =
        leftEdgeX + cardW + 8 <= clampedAnchorX - targetHalfW &&
        rightEdgeX - 8 >= clampedAnchorX + targetHalfW &&
        leftEdgeX + cardW + gapX <= rightEdgeX;

      if (edgesClearTarget) {
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
        const perRow = Math.max(1, leftSlice.length);
        const rowCardW = Math.max(
          92,
          Math.min(150, Math.floor((safeW - gapX * (perRow - 1)) / perRow)),
        );
        const rowCardH = rowCardW < 126 ? 50 : cardH;
        const centerX = (safeLeft + safeRight) / 2;
        const roomAbove = clampedAnchorY - targetHalfH - 14 - safeTop;
        const roomBelow = safeBottom - (clampedAnchorY + targetHalfH + 14);
        const twoRowsH = rowCardH * 2 + gapY;

        let topRowY: number;
        let bottomRowY: number;
        if (roomAbove >= rowCardH && roomBelow >= rowCardH) {
          topRowY = clamp(
            clampedAnchorY - targetHalfH - 16 - rowCardH,
            safeTop,
            safeBottom - rowCardH,
          );
          bottomRowY = clamp(
            clampedAnchorY + targetHalfH + 16,
            safeTop,
            safeBottom - rowCardH,
          );
        } else if (roomAbove >= roomBelow && roomAbove >= twoRowsH) {
          bottomRowY = clamp(
            clampedAnchorY - targetHalfH - 14 - rowCardH,
            safeTop + rowCardH + gapY,
            safeBottom - rowCardH,
          );
          topRowY = Math.max(safeTop, bottomRowY - rowCardH - gapY);
        } else if (roomBelow >= twoRowsH) {
          topRowY = clamp(
            clampedAnchorY + targetHalfH + 14,
            safeTop,
            safeBottom - twoRowsH,
          );
          bottomRowY = Math.min(safeBottom - rowCardH, topRowY + rowCardH + gapY);
        } else {
          topRowY = safeTop;
          bottomRowY = safeBottom - rowCardH;
        }

        rawCards = [
          ...placeRowCards(
            leftSlice,
            centerX,
            topRowY,
            rowCardW,
            rowCardH,
            gapX,
            safeLeft,
            safeRight,
          ),
          ...placeRowCards(
            rightSlice,
            centerX,
            bottomRowY,
            rowCardW,
            rowCardH,
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
      const kanji = c.choice.answerKanji ?? c.choice.name;
      return {
        ...c,
        attachX,
        attachY,
        isMultiline: c.width < 138 || kanji.length >= 6,
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
  }, [activePiece, choices, getSvgRect, hasJumpBar, svgToContainerPoint]);

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
  }, [quizChoiceLayout, computePointingLayout, subscribeLiveViewBox, mapStageEl]);

  const answerKanji = activePiece.answerKanji ?? activePiece.name;
  const answerRuby = activePiece.answerRuby ?? activePiece.ruby;
  const answerPrefSuffix =
    activePiece.prefName && activePiece.prefName !== answerKanji
      ? `（${activePiece.prefName}）`
      : '';

  const renderActionButtons = () => (
    <div className="quiz-prompt-actions">
      <button
        type="button"
        className="btn-secondary btn-xs"
        title="問題の場所へ移動 (F)"
        onClick={() => onFocusPiece(activePiece)}
      >
        📍 フォーカス
      </button>
      {!disableHelpButton && (
        <>
          <button
            type="button"
            className="btn-hint1 btn-xs"
            title="誤答の選択肢を2つ減らします (H)"
            disabled={feedback === 'ok' || revealed || remainingWrongChoices.length === 0}
            onClick={handleUseHint}
          >
            💡 ヒント
          </button>
          <button
            type="button"
            className="btn-ghost btn-xs"
            title="正解を表示して次へ進む（ミス扱い・復習登録）"
            disabled={feedback === 'ok' || revealed}
            onClick={handleGiveUp}
          >
            答えを見る
          </button>
        </>
      )}
      <button
        type="button"
        className="btn-secondary btn-xs"
        title="選択肢の表示位置を切替 (L)"
        onClick={onToggleQuizChoiceLayout}
      >
        {quizChoiceLayout === 'pointing' ? '📋 下部に選択肢' : '📌 地図上に選択肢'}
      </button>
      <button
        type="button"
        className={`hud-toggle-btn btn-xs ${nameOnFix ? '' : 'is-off'}`}
        title="回答後に白地図上へ名前を表示／非表示"
        onClick={onToggleNameOnFix}
      >
        🏷 回答後の名前: {nameOnFix ? 'ON' : 'OFF'}
      </button>
    </div>
  );

  const renderRevealBanner = () =>
    revealed ? (
      <div className="yomi-reveal-banner" role="status" aria-live="polite">
        <span>
          答え：<strong>{answerKanji}</strong>
          {answerRuby && `（${answerRuby}）`}
          {answerPrefSuffix}
        </span>
        <button
          type="button"
          className="btn-primary btn-xs"
          style={{ marginLeft: 10 }}
          onClick={() => onAdvanceAfterGiveUp?.()}
        >
          次へ (Enter)
        </button>
      </div>
    ) : null;

  const renderJudgeBadge = () =>
    feedback ? (
      <div
        key={`judge-${feedback}-${missNonce}`}
        className={`judge-badge ${feedback === 'ok' ? 'is-ok' : 'is-ng'}`}
        role="status"
        aria-live="polite"
      >
        {feedback === 'ok' ? '○' : '×'}
      </div>
    ) : null;

  if (quizChoiceLayout === 'pointing') {
    const orderedLineCards = pointingLayout
      ? [...pointingLayout.cards].sort((a, b) => {
          const rank = (id: string) =>
            (feedback === 'ok' || revealed) && id === activePiece.id
              ? 3
              : id === hoveredChoiceId
                ? 2
                : disabledChoiceIds.has(id) || hintEliminatedIds.has(id)
                  ? 0
                  : 1;
          return rank(a.choice.id) - rank(b.choice.id);
        })
      : [];

    const pointingLayerNode = (
      <div ref={layerRef} className="quiz-pointing-layer">
        {pointingLayout && (
          <>
            <svg
              className="quiz-pointing-lines"
              width={pointingLayout.containerW}
              height={pointingLayout.containerH}
              aria-hidden="true"
            >
              {orderedLineCards.map((card) => {
                const isWrong = disabledChoiceIds.has(card.choice.id);
                const isElim = !isWrong && hintEliminatedIds.has(card.choice.id);
                const isCorrect =
                  (feedback === 'ok' || revealed) && card.choice.id === activePiece.id;
                const isHovered =
                  !isWrong && !isElim && !isCorrect && hoveredChoiceId === card.choice.id;
                const strokeColor = isCorrect
                  ? '#059669'
                  : isHovered
                    ? '#0284c7'
                    : isWrong || isElim
                      ? '#cbd5e1'
                      : '#d97706';
                const opacity = isWrong || isElim ? 0.4 : isHovered || isCorrect ? 1 : 0.88;
                return (
                  <g key={`line-${card.choice.id}`} opacity={opacity}>
                    <line
                      x1={card.attachX}
                      y1={card.attachY}
                      x2={pointingLayout.lineTargetX}
                      y2={pointingLayout.lineTargetY}
                      stroke="#ffffff"
                      strokeWidth={isCorrect || isHovered ? 5.2 : 3.6}
                      strokeLinecap="round"
                    />
                    <line
                      x1={card.attachX}
                      y1={card.attachY}
                      x2={pointingLayout.lineTargetX}
                      y2={pointingLayout.lineTargetY}
                      stroke={strokeColor}
                      strokeWidth={isCorrect || isHovered ? 2.8 : 1.7}
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
                    fill={feedback === 'ok' || revealed ? '#059669' : '#ea580c'}
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
              const isCorrect = (feedback === 'ok' || revealed) && opt.id === activePiece.id;
              const isDisabled = isWrong || isElim || (revealed && !isCorrect);
              const kanji = opt.answerKanji ?? opt.name;
              const ruby = opt.answerRuby ?? opt.ruby;
              const cls = [
                'quiz-pointing-card',
                card.isMultiline ? 'is-multiline' : '',
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
                  disabled={isDisabled}
                  className={cls}
                  style={{
                    position: 'absolute',
                    left: card.x,
                    top: card.y,
                    width: card.width,
                    minHeight: card.height,
                  }}
                  onMouseEnter={() => setHoveredChoiceId(opt.id)}
                  onMouseLeave={() =>
                    setHoveredChoiceId((cur) => (cur === opt.id ? null : cur))
                  }
                  onFocus={() => setHoveredChoiceId(opt.id)}
                  onBlur={() =>
                    setHoveredChoiceId((cur) => (cur === opt.id ? null : cur))
                  }
                  onClick={() => handleChoose(opt)}
                >
                  <span className="quiz-key-badge" aria-hidden="true">
                    {card.choiceIdx + 1}
                  </span>
                  <span className="choice-ruby">{ruby}</span>
                  <span className="choice-kanji">{kanji}</span>
                </button>
              );
            })}
          </>
        )}
      </div>
    );

    return (
      <>
        {mapStageEl ? createPortal(pointingLayerNode, mapStageEl) : pointingLayerNode}

        <div className="bottom-play-panel quiz-panel quiz-pointing-bar">
          {isGeographyQuiz && activePiece.desc && (
            <div className="geo-text-window">
              <div className="geo-text-badge">{activePiece.regionLabel}</div>
              <p>{activePiece.desc}</p>
            </div>
          )}

          {renderRevealBanner()}

          <div className="quiz-prompt-row">
            <span className="quiz-prompt-text">
              地図上の選択肢（または 1〜6 キー）でハイライト地点を選択
            </span>
            {renderActionButtons()}
          </div>

          {renderJudgeBadge()}
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

      {renderRevealBanner()}

      <div className="quiz-prompt-row">
        <span className="quiz-prompt-text">
          地図でハイライトされている場所の名前を選択（1〜6 キー対応）
        </span>
        {renderActionButtons()}
      </div>

      <div className="quiz-choices-grid">
        {choices.map((opt, idx) => {
          const isWrong = disabledChoiceIds.has(opt.id);
          const isElim = !isWrong && hintEliminatedIds.has(opt.id);
          const isCorrect = (feedback === 'ok' || revealed) && opt.id === activePiece.id;
          const isDisabled = isWrong || isElim || (revealed && !isCorrect);
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
              disabled={isDisabled}
              className={cls}
              onClick={() => handleChoose(opt)}
            >
              <span className="quiz-key-badge" aria-hidden="true">
                {idx + 1}
              </span>
              <span className="choice-ruby">{ruby}</span>
              <span className="choice-kanji">{kanji}</span>
            </button>
          );
        })}
      </div>

      {renderJudgeBadge()}
    </div>
  );
};

export const QuizGame = React.memo(QuizGameInner);
