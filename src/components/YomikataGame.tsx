import React, { useEffect, useState } from 'react';
import { normalizeKana } from '../services/mapDataLoader';
import { cycleKanaModifier } from '../utils/formatters';
import type { ConfigState, MapPieceItem } from '../types/game';
import { KeypadJp } from './KeypadJp';

interface YomikataGameProps {
  activePiece: MapPieceItem;
  isCapitalYomikata: boolean;
  config: ConfigState;
  onConfigChange: (next: ConfigState) => void;
  onFocusPiece: (piece: MapPieceItem) => void;
  onAnswerResult: (correct: boolean) => void;
  onMarkMistake: () => void;
}

export const YomikataGame: React.FC<YomikataGameProps> = ({
  activePiece,
  isCapitalYomikata,
  config,
  onConfigChange,
  onFocusPiece,
  onAnswerResult,
  onMarkMistake,
}) => {
  const [typed, setTyped] = useState('');
  const [feedback, setFeedback] = useState<'ok' | 'ng' | null>(null);

  const expected = normalizeKana(activePiece.answerRuby ?? activePiece.ruby);

  const commitTyped = (nextVal: string) => {
    setTyped(nextVal);
    if (normalizeKana(nextVal) === expected) {
      setFeedback('ok');
      onAnswerResult(true);
    } else {
      setFeedback(null);
    }
  };

  const handleInputChar = (ch: string) => {
    if (feedback === 'ok') return;
    if (typed.length >= expected.length + 2) return;
    commitTyped(typed + ch);
  };

  const handleMutateLast = () => {
    if (feedback === 'ok' || typed.length === 0) return;
    const head = typed.slice(0, -1);
    const last = typed.slice(-1);
    commitTyped(head + cycleKanaModifier(last));
  };

  const handleBackspace = () => {
    if (feedback === 'ok' || typed.length === 0) return;
    setTyped(typed.slice(0, -1));
    setFeedback(null);
  };

  const handleSubmit = () => {
    if (feedback === 'ok') return;
    if (normalizeKana(typed) === expected) {
      setFeedback('ok');
      onAnswerResult(true);
    } else {
      setFeedback('ng');
      onAnswerResult(false);
    }
  };

  const handleSkipWithAnswer = () => {
    setTyped(expected);
    setFeedback('ng');
    onMarkMistake();
  };

  // Support optional hardware keyboard hiragana typing
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

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
        </div>

        <div className="yomi-answer-display">
          <div className="yomi-typed-box">
            <span className="yomi-typed-text">{typed || 'ひらがなで入力'}</span>
            <span className="yomi-char-count">
              {typed.length} / {expected.length}文字
            </span>
          </div>
          <div className="yomi-quick-btns">
            <button
              type="button"
              className="btn-secondary btn-xs"
              onClick={() => onFocusPiece(activePiece)}
            >
              📍 場所へフォーカス
            </button>
            {!config.disableHelpButton && (
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={handleSkipWithAnswer}
              >
                答えを見る
              </button>
            )}
          </div>
        </div>
      </div>

      <KeypadJp
        mode={config.keypadMode}
        onModeChange={(keypadMode) => onConfigChange({ ...config, keypadMode })}
        onInputChar={handleInputChar}
        onMutateLastChar={handleMutateLast}
        onBackspace={handleBackspace}
        onClear={() => {
          setTyped('');
          setFeedback(null);
        }}
        onSubmit={handleSubmit}
      />

      {feedback && (
        <div className={`judge-badge ${feedback === 'ok' ? 'is-ok' : 'is-ng'}`}>
          {feedback === 'ok' ? '○' : '×'}
        </div>
      )}
    </div>
  );
};
