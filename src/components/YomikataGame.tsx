import React, { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeKana } from '../services/mapDataLoader';
import type { ConfigState, MapPieceItem } from '../types/game';

interface YomikataGameProps {
  activePiece: MapPieceItem;
  isCapitalYomikata: boolean;
  isPrefectureMode?: boolean;
  showPrefContext?: boolean;
  config: ConfigState;
  modalOpen?: boolean;
  onFocusPiece: (piece: MapPieceItem) => void;
  onUseHint: () => void;
  onToggleNameOnFix: () => void;
  onAnswerResult: (correct: boolean) => void;
  onGiveUp: () => void;
  onAdvanceAfterGiveUp: () => void;
}

const MUNI_SUFFIX_RE = /(し|ちょう|まち|むら|そん|く)$/;

const YomikataGameInner: React.FC<YomikataGameProps> = ({
  activePiece,
  isCapitalYomikata,
  isPrefectureMode = false,
  showPrefContext = false,
  config,
  modalOpen = false,
  onFocusPiece,
  onUseHint,
  onToggleNameOnFix,
  onAnswerResult,
  onGiveUp,
  onAdvanceAfterGiveUp,
}) => {
  const [prevPieceId, setPrevPieceId] = useState(activePiece.id);
  const [typed, setTyped] = useState('');
  const [feedback, setFeedback] = useState<'ok' | 'ng' | null>(null);
  const [missNonce, setMissNonce] = useState(0);
  const [missNote, setMissNote] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2>(0);

  // Reset per-question state during render while keeping <input> continuously mounted & focused
  if (prevPieceId !== activePiece.id) {
    setPrevPieceId(activePiece.id);
    setTyped('');
    setFeedback(null);
    setMissNote(null);
    setRevealed(false);
    setHintLevel(0);
  }

  const inputRef = useRef<HTMLInputElement | null>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef<number>(0);
  const ngClearTimerRef = useRef<number | null>(null);
  const prevModalOpenRef = useRef(modalOpen);

  const expected = normalizeKana(activePiece.answerRuby ?? activePiece.ruby);
  const answerKanji = activePiece.answerKanji ?? activePiece.name;
  const canAdvanceOnEnter = revealed;

  const acceptedReadings = useMemo(() => {
    const set = new Set<string>([expected]);
    if (isPrefectureMode && !isCapitalYomikata) {
      if (activePiece.name.endsWith('県')) {
        if (expected.endsWith('けん')) {
          set.add(expected.slice(0, -2));
        } else {
          set.add(`${expected}けん`);
        }
      } else if (activePiece.name.endsWith('府')) {
        if (expected.endsWith('ふ')) {
          set.add(expected.slice(0, -1));
        } else {
          set.add(`${expected}ふ`);
        }
      } else if (activePiece.name.endsWith('都')) {
        if (expected.endsWith('と')) {
          set.add(expected.slice(0, -1));
        } else {
          set.add(`${expected}と`);
        }
      }
    }
    return set;
  }, [expected, isPrefectureMode, isCapitalYomikata, activePiece.name]);

  // Keep <input> focused and clear transient timers/composition flags on question change
  useEffect(() => {
    if (ngClearTimerRef.current != null) {
      window.clearTimeout(ngClearTimerRef.current);
      ngClearTimerRef.current = null;
    }
    isComposingRef.current = false;
    if (!modalOpen) {
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePiece.id]);

  // Restore focus when closing Config/Save/Tag modals
  useEffect(() => {
    if (prevModalOpenRef.current && !modalOpen) {
      inputRef.current?.focus();
    }
    prevModalOpenRef.current = modalOpen;
  }, [modalOpen]);

  useEffect(() => {
    return () => {
      if (ngClearTimerRef.current != null) window.clearTimeout(ngClearTimerRef.current);
    };
  }, []);

  const triggerCorrect = () => {
    if (feedback === 'ok') return;
    if (ngClearTimerRef.current != null) {
      window.clearTimeout(ngClearTimerRef.current);
      ngClearTimerRef.current = null;
    }
    setMissNote(null);
    setFeedback('ok');
    onAnswerResult(true);
  };

  const judgeValue = (rawVal: string) => {
    if (feedback === 'ok') return;
    if (canAdvanceOnEnter) {
      onAdvanceAfterGiveUp();
      return;
    }
    const normalized = normalizeKana(rawVal);
    if (!normalized) return;
    if (acceptedReadings.has(normalized)) {
      triggerCorrect();
    } else {
      setFeedback('ng');
      setMissNonce((n) => n + 1);
      // Helpful diagnostic cue so the learner can self-correct
      const stripped = expected.replace(MUNI_SUFFIX_RE, '');
      if (
        !isPrefectureMode &&
        stripped.length > 0 &&
        stripped !== expected &&
        normalized === stripped
      ) {
        setMissNote('「市・町・村・区」の読みも含めて入力してください');
      } else if (normalized.length !== expected.length && !isPrefectureMode) {
        setMissNote(`入力 ${normalized.length}文字（正解は ${expected.length}文字）`);
      } else {
        setMissNote(null);
      }
      onAnswerResult(false);
      inputRef.current?.select();
      if (ngClearTimerRef.current != null) window.clearTimeout(ngClearTimerRef.current);
      ngClearTimerRef.current = window.setTimeout(() => {
        setFeedback((cur) => (cur === 'ng' ? null : cur));
        ngClearTimerRef.current = null;
      }, 900);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    // Wait for Japanese IME composition confirmation before judging (also guards Safari post-compositionend Enter)
    if (
      isComposingRef.current ||
      e.nativeEvent.isComposing ||
      e.keyCode === 229 ||
      performance.now() - lastCompositionEndAtRef.current < 80
    ) {
      return;
    }
    e.preventDefault();
    judgeValue(e.currentTarget.value);
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    isComposingRef.current = false;
    lastCompositionEndAtRef.current = performance.now();
    const val = e.currentTarget.value;
    setTyped(val);
    // If IME Enter confirmation already matches an accepted reading, advance right away
    if (feedback !== 'ok' && !revealed && acceptedReadings.has(normalizeKana(val))) {
      triggerCorrect();
    }
  };

  const handleRevealAnswer = () => {
    if (!revealed) {
      setRevealed(true);
      onGiveUp();
    }
    setTyped(expected);
    setFeedback(null);
    setMissNote(null);
    inputRef.current?.focus();
  };

  const maxHintLevel: 1 | 2 = expected.length >= 3 ? 2 : 1;
  const hintPrefixLen =
    hintLevel === 1 ? 1 : Math.max(2, Math.ceil(expected.length / 2));

  const handleStepHint = () => {
    if (revealed || hintLevel >= maxHintLevel) return;
    const nextLevel = (hintLevel + 1) as 1 | 2;
    setHintLevel(nextLevel);
    onUseHint();
    inputRef.current?.focus();
  };

  const showPrefBadge =
    showPrefContext &&
    !isCapitalYomikata &&
    !isPrefectureMode &&
    Boolean(activePiece.prefName) &&
    activePiece.prefName !== activePiece.name;

  const revealPrefSuffix =
    !isCapitalYomikata &&
    !isPrefectureMode &&
    activePiece.prefName &&
    activePiece.prefName !== answerKanji
      ? `・${activePiece.prefName}`
      : '';

  return (
    <div className="bottom-play-panel yomikata-panel">
      <div className="yomi-header-row">
        <div className="yomi-question-box">
          {isCapitalYomikata ? (
            <>
              <span className="yomi-tag">県庁所在地の読み方</span>
              <strong className="yomi-kanji">
                {config.showYomikataKanji
                  ? `${activePiece.name} → ${activePiece.answerKanji}`
                  : `${activePiece.name} の県庁所在地`}
              </strong>
            </>
          ) : (
            <>
              <span className="yomi-tag">地名の読み方</span>
              <strong className="yomi-kanji">
                {config.showYomikataKanji
                  ? activePiece.name
                  : '（漢字非表示：地図の地形・場所から入力）'}
              </strong>
              {showPrefBadge && (
                <span className="pref-homonym-badge">{activePiece.prefName}</span>
              )}
            </>
          )}
          <span className="yomi-length-pill">
            {isPrefectureMode
              ? '県・府・都 あり/なし両対応'
              : `${expected.length}文字（市町村区含む）`}
          </span>
        </div>

        <div className="yomi-quick-btns">
          <button
            type="button"
            className="btn-secondary btn-xs"
            onClick={() => {
              onFocusPiece(activePiece);
              inputRef.current?.focus();
            }}
          >
            📍 フォーカス
          </button>
          {!config.disableHelpButton && (
            <>
              <button
                type="button"
                className="btn-hint1 btn-xs"
                title={
                  hintLevel === 0
                    ? '読みの最初の1文字を表示'
                    : '読みの前半を表示'
                }
                disabled={hintLevel >= maxHintLevel || revealed}
                onClick={handleStepHint}
              >
                💡 {hintLevel === 0 ? 'ヒント1' : hintLevel === 1 && maxHintLevel === 2 ? 'ヒント2' : 'ヒント済'}
              </button>
              <button
                type="button"
                className="btn-ghost btn-xs"
                title="漢字と読みを表示（ミス扱い・復習登録）"
                onClick={handleRevealAnswer}
              >
                答えを見る
              </button>
            </>
          )}
          <button
            type="button"
            className={`hud-toggle-btn btn-xs ${config.nameOnFix ? '' : 'is-off'}`}
            title="回答後に白地図上へ名前を表示／非表示"
            onClick={() => {
              onToggleNameOnFix();
              inputRef.current?.focus();
            }}
          >
            🏷 回答後の名前: {config.nameOnFix ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {revealed ? (
        <div className="yomi-reveal-banner" role="status" aria-live="polite">
          答え：<strong>{answerKanji}</strong>（<strong>{expected}</strong>）
          {revealPrefSuffix}（Enter キーで次の問題へ）
        </div>
      ) : hintLevel > 0 ? (
        <div className="yomi-reveal-banner" role="status" aria-live="polite">
          ヒント：最初の{hintPrefixLen}文字「
          <strong>{expected.slice(0, hintPrefixLen)}</strong>」
          {missNote ? ` ／ ${missNote}` : ''}
        </div>
      ) : missNote ? (
        <div className="yomi-reveal-banner" role="status" aria-live="polite">
          {missNote}
        </div>
      ) : null}

      <div className="yomi-input-row">
        <input
          ref={inputRef}
          type="text"
          enterKeyHint={canAdvanceOnEnter ? 'next' : 'send'}
          className={`yomi-text-input ${feedback === 'ok' ? 'is-ok' : feedback === 'ng' ? 'is-ng' : ''}`}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (feedback === 'ng') setFeedback(null);
            if (missNote) setMissNote(null);
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={handleCompositionEnd}
          onKeyDown={handleKeyDown}
          placeholder="ひらがなで入力して Enter（カタカナ可）"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="読み方の回答入力"
        />
        <button
          type="button"
          className="btn-primary yomi-submit-btn"
          onClick={() => judgeValue(typed)}
        >
          {canAdvanceOnEnter ? '次へ (Enter)' : '回答 (Enter)'}
        </button>
      </div>

      {feedback && (
        <div
          key={`judge-${feedback}-${missNonce}`}
          className={`judge-badge ${feedback === 'ok' ? 'is-ok' : 'is-ng'}`}
          role="status"
          aria-live="polite"
        >
          {feedback === 'ok' ? '○' : '×'}
        </div>
      )}
    </div>
  );
};

export const YomikataGame = React.memo(YomikataGameInner);
