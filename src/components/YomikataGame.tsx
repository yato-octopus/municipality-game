import React, { useEffect, useRef, useState } from 'react';
import { normalizeKana } from '../services/mapDataLoader';
import type { ConfigState, MapPieceItem } from '../types/game';

interface YomikataGameProps {
  activePiece: MapPieceItem;
  isCapitalYomikata: boolean;
  config: ConfigState;
  hintStage: 0 | 1 | 2;
  onFocusPiece: (piece: MapPieceItem) => void;
  onHint1: () => void;
  onHint2: () => void;
  onAnswerResult: (correct: boolean) => void;
  onMarkMistake: () => void;
}

export const YomikataGame: React.FC<YomikataGameProps> = ({
  activePiece,
  isCapitalYomikata,
  config,
  hintStage,
  onFocusPiece,
  onHint1,
  onHint2,
  onAnswerResult,
  onMarkMistake,
}) => {
  const [typed, setTyped] = useState('');
  const [feedback, setFeedback] = useState<'ok' | 'ng' | null>(null);
  const [revealed, setRevealed] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const isComposingRef = useRef(false);

  const expected = normalizeKana(activePiece.answerRuby ?? activePiece.ruby);
  const canAdvanceOnEnter = revealed || hintStage >= 2;

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
              <div className="hint-btn-group">
                <button
                  type="button"
                  className="btn-hint1 btn-xs"
                  title="この辺の大きな範囲を表示"
                  onClick={() => {
                    onHint1();
                    inputRef.current?.focus();
                  }}
                >
                  💡 ヒント1
                </button>
                <button
                  type="button"
                  className="btn-hint2 btn-xs"
                  title="その場所へ直接当てはめる"
                  onClick={() => {
                    onHint2();
                    setTyped(expected);
                    setFeedback(null);
                    inputRef.current?.focus();
                  }}
                >
                  💡 ヒント2
                </button>
              </div>
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={handleRevealAnswer}
              >
                答えを見る
              </button>
            </>
          )}
        </div>
      </div>

      {hintStage >= 2 ? (
        <div className="yomi-reveal-banner">
          ヒント2：地図上に当てはめました ・ 読み「<strong>{expected}</strong>」（Enter キーで次の問題へ進めます）
        </div>
      ) : revealed ? (
        <div className="yomi-reveal-banner">
          答え：<strong>{expected}</strong>（Enter キーで次の問題へ進めます）
        </div>
      ) : hintStage === 1 ? (
        <div className="yomi-reveal-banner">
          ヒント1：最初の文字「<strong>{expected.slice(0, 1)}</strong>」
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
