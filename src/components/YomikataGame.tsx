import React, { useEffect, useRef, useState } from 'react';
import { normalizeKana } from '../services/mapDataLoader';
import type { ConfigState, MapPieceItem } from '../types/game';

interface YomikataGameProps {
  activePiece: MapPieceItem;
  isCapitalYomikata: boolean;
  config: ConfigState;
  onFocusPiece: (piece: MapPieceItem) => void;
  onUseHint: () => void;
  onToggleNameOnFix: () => void;
  onAnswerResult: (correct: boolean) => void;
  onMarkMistake: () => void;
}

export const YomikataGame: React.FC<YomikataGameProps> = ({
  activePiece,
  isCapitalYomikata,
  config,
  onFocusPiece,
  onUseHint,
  onToggleNameOnFix,
  onAnswerResult,
  onMarkMistake,
}) => {
  const [typed, setTyped] = useState('');
  const [feedback, setFeedback] = useState<'ok' | 'ng' | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [hintShown, setHintShown] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const isComposingRef = useRef(false);

  const expected = normalizeKana(activePiece.answerRuby ?? activePiece.ruby);
  const canAdvanceOnEnter = revealed;

  // Auto-focus input immediately on every question so user can type + Enter continuously
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const triggerCorrect = () => {
    if (feedback === 'ok') return;
    setFeedback('ok');
    onAnswerResult(true);
  };

  const judgeValue = (rawVal: string) => {
    if (feedback === 'ok') return;
    if (canAdvanceOnEnter) {
      triggerCorrect();
      return;
    }
    const normalized = normalizeKana(rawVal);
    if (!normalized) return;
    if (normalized === expected) {
      triggerCorrect();
    } else {
      setFeedback('ng');
      onAnswerResult(false);
      inputRef.current?.select();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    // Wait for Japanese IME composition confirmation before judging
    if (isComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    e.preventDefault();
    judgeValue(e.currentTarget.value);
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    isComposingRef.current = false;
    const val = e.currentTarget.value;
    setTyped(val);
    // If IME Enter confirmation already matches the exact answer, advance right away!
    if (feedback !== 'ok' && normalizeKana(val) === expected) {
      triggerCorrect();
    }
  };

  const handleRevealAnswer = () => {
    if (!revealed) {
      setRevealed(true);
      onMarkMistake();
    }
    setTyped(expected);
    setFeedback(null);
    inputRef.current?.focus();
  };

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
            </>
          )}
          <span className="yomi-length-pill">{expected.length}文字</span>
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
            📍 場所へフォーカス
          </button>
          {!config.disableHelpButton && (
            <>
              <button
                type="button"
                className="btn-hint1 btn-xs"
                title="読みの最初の1文字を表示"
                disabled={hintShown || revealed}
                onClick={() => {
                  if (!hintShown) {
                    setHintShown(true);
                    onUseHint();
                  }
                  inputRef.current?.focus();
                }}
              >
                💡 ヒント
              </button>
              <button
                type="button"
                className="btn-ghost btn-xs"
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
        <div className="yomi-reveal-banner">
          答え：<strong>{expected}</strong>（Enter キーで次の問題へ進めます）
        </div>
      ) : hintShown ? (
        <div className="yomi-reveal-banner">
          ヒント：最初の文字「<strong>{expected.slice(0, 1)}</strong>」
        </div>
      ) : null}

      <div className="yomi-input-row">
        <input
          ref={inputRef}
          type="text"
          className={`yomi-text-input ${feedback === 'ok' ? 'is-ok' : feedback === 'ng' ? 'is-ng' : ''}`}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (feedback === 'ng') setFeedback(null);
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
        <div className={`judge-badge ${feedback === 'ok' ? 'is-ok' : 'is-ng'}`}>
          {feedback === 'ok' ? '○' : '×'}
        </div>
      )}
    </div>
  );
};
