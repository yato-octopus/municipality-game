import React, { useMemo, useState } from 'react';
import { shuffleArray } from '../services/mapDataLoader';
import type { MapPieceItem } from '../types/game';

interface QuizGameProps {
  activePiece: MapPieceItem;
  allPoolPieces: MapPieceItem[];
  isGeographyQuiz: boolean;
  onFocusPiece: (piece: MapPieceItem) => void;
  onAnswerResult: (correct: boolean) => void;
}

export const QuizGame: React.FC<QuizGameProps> = ({
  activePiece,
  allPoolPieces,
  isGeographyQuiz,
  onFocusPiece,
  onAnswerResult,
}) => {
  const [disabledChoiceIds, setDisabledChoiceIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<'ok' | 'ng' | null>(null);

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

  const handleChoose = (opt: MapPieceItem) => {
    if (disabledChoiceIds.has(opt.id) || feedback === 'ok') return;
    if (opt.id === activePiece.id) {
      setFeedback('ok');
      onAnswerResult(true);
    } else {
      setFeedback('ng');
      setDisabledChoiceIds((prev) => new Set(prev).add(opt.id));
      onAnswerResult(false);
    }
  };

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
        <button
          type="button"
          className="btn-secondary btn-xs"
          onClick={() => onFocusPiece(activePiece)}
        >
          📍 場所へフォーカス
        </button>
      </div>

      <div className="quiz-choices-grid">
        {choices.map((opt) => {
          const disabled = disabledChoiceIds.has(opt.id);
          const kanji = opt.answerKanji ?? opt.name;
          const ruby = opt.answerRuby ?? opt.ruby;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              className={`quiz-choice-btn ${disabled ? 'is-wrong-disabled' : ''}`}
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
