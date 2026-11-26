import React, { useState } from 'react';
import { formatTimeMs } from '../utils/formatters';
import type { MapPieceItem } from '../types/game';

interface ResultOverlayProps {
  areaName: string;
  modeLabel: string;
  elapsedMs: number;
  misses: number;
  hintsUsed: number;
  questionCount: number;
  maxCount: number;
  isNewBest: boolean;
  isCustomOrRandom: boolean;
  isReviewMode: boolean;
  wrongPieces: MapPieceItem[];
  inspectingCompleted: boolean;
  onToggleInspectCompleted: () => void;
  onInspectMissedPiece?: (piece: MapPieceItem) => void;
  onReviewMistakes?: () => void;
  onRetrySame: () => void;
  onRetryRandom?: () => void;
  onGoAreas?: () => void;
  onGoTitle: () => void;
}

export const ResultOverlay: React.FC<ResultOverlayProps> = ({
  areaName,
  modeLabel,
  elapsedMs,
  misses,
  hintsUsed,
  questionCount,
  maxCount,
  isNewBest,
  isCustomOrRandom,
  isReviewMode,
  wrongPieces,
  inspectingCompleted,
  onToggleInspectCompleted,
  onInspectMissedPiece,
  onReviewMistakes,
  onRetrySame,
  onRetryRandom,
  onGoAreas,
  onGoTitle,
}) => {
  const [copied, setCopied] = useState(false);

  if (inspectingCompleted) {
    return (
      <div className="inspect-complete-bar" role="region" aria-label="完成図閲覧コントロール">
        <span>
          完成図を閲覧中（ドラッグ・ズーム・タップで詳細確認
          {wrongPieces.length > 0 ? '／黄枠＝今回間違えた場所' : ''}）
        </span>
        <button type="button" className="btn-primary" onClick={onToggleInspectCompleted}>
          リザルトへ戻る
        </button>
      </div>
    );
  }

  const timeStr = formatTimeMs(elapsedMs);
  const cleanCount = Math.max(0, questionCount - wrongPieces.length);
  const accuracyPct =
    questionCount > 0 ? Math.round((cleanCount / questionCount) * 100) : 100;
  const shareText = `${areaName} ${modeLabel} を ${timeStr}（初回正答率 ${accuracyPct}%）でクリア！ #市区町村パズル #市町村パズル`;

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText });
        return;
      } catch {
        // Fallback to copy
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore
    }
  };

  const starRating =
    misses === 0 && wrongPieces.length === 0 && hintsUsed === 0
      ? 3
      : misses <= 3 && wrongPieces.length <= 3
        ? 2
        : 1;

  return (
    <div className="modal-backdrop result-backdrop">
      <div className="confetti-layer" aria-hidden="true">
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            key={i}
            className="confetti-piece"
            style={{
              left: `${(i * 41) % 98}%`,
              animationDelay: `${(i % 6) * 0.14}s`,
              backgroundColor: [
                'var(--confetti-0, #f59e0b)',
                'var(--confetti-1, #10b981)',
                'var(--confetti-2, #3b82f6)',
                'var(--confetti-3, #ec4899)',
                'var(--confetti-4, #8b5cf6)',
              ][i % 5],
            }}
          />
        ))}
      </div>

      <div
        className="modal-card result-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-modal-title"
      >
        <div className="result-complete-badge">COMPLETE!</div>
        {isNewBest && <div className="result-new-record">★ NEW RECORD ★</div>}

        <h2 id="result-modal-title" className="result-title">
          {areaName} — {modeLabel}
        </h2>

        <div className="result-stars" aria-label={`評価 ${starRating} / 3`}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= starRating ? 'star-on' : 'star-off'}>
              ★
            </span>
          ))}
        </div>

        <div className="result-stats-grid">
          <div className="result-stat-box">
            <span>クリアタイム</span>
            <strong>{timeStr}</strong>
          </div>
          <div className="result-stat-box">
            <span>初回正答率</span>
            <strong>
              {accuracyPct}% ({cleanCount}/{questionCount})
            </strong>
          </div>
          <div className="result-stat-box">
            <span>ミス回数</span>
            <strong>{misses} 回</strong>
          </div>
          <div className="result-stat-box">
            <span>ヒント使用</span>
            <strong>{hintsUsed} 回</strong>
          </div>
        </div>

        {wrongPieces.length > 0 && (
          <div className="result-mistakes-box">
            <div className="result-mistakes-header">
              今回間違えた問題（{wrongPieces.length}件・タップで地図上の場所を確認）
            </div>
            <div className="result-missed-scroll">
              {wrongPieces.map((p) => {
                const kanji = p.answerKanji ?? p.name;
                const ruby = p.answerRuby ?? p.ruby;
                const prefSuffix =
                  p.prefName && p.prefName !== kanji ? `・${p.prefName}` : '';
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="result-missed-item"
                    title={`${kanji}の場所を地図で確認`}
                    onClick={() => onInspectMissedPiece?.(p)}
                  >
                    <strong>{kanji}</strong>
                    {ruby && <span>（{ruby}）</span>}
                    {prefSuffix && <span>{prefSuffix}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {isReviewMode && wrongPieces.length === 0 && (
          <div className="result-review-cleared">
            ✓ 復習した問題をすべてノーミスで克服しました！（復習リストから解除済み）
          </div>
        )}

        {!isCustomOrRandom && questionCount < maxCount && (
          <p className="result-note">
            ※問題数が最大未満のため、クリアタイム記録は保存されません
          </p>
        )}

        <div className="result-actions">
          {wrongPieces.length > 0 && onReviewMistakes && (
            <button type="button" className="btn-warning" onClick={onReviewMistakes}>
              🔁 間違えた問題だけ復習する（{wrongPieces.length}問）
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onToggleInspectCompleted}>
            🗺 完成図をみる
          </button>
          <button type="button" className="btn-secondary" onClick={handleShare}>
            {copied ? '✓ 記録をコピーしました' : '📤 記録をシェアする'}
          </button>
          {isCustomOrRandom && onRetryRandom ? (
            <>
              <button type="button" className="btn-primary" onClick={onRetrySame}>
                ↻ 同じ場所でリトライ
              </button>
              <button type="button" className="btn-primary" onClick={onRetryRandom}>
                🎲 ランダムでリトライ
              </button>
            </>
          ) : (
            <button type="button" className="btn-primary" onClick={onRetrySame}>
              ↻ リトライ
            </button>
          )}
          {onGoAreas && (
            <button type="button" className="btn-secondary" onClick={onGoAreas}>
              🗺 エリア選択へ戻る
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onGoTitle}>
            タイトルへ戻る
          </button>
        </div>
      </div>
    </div>
  );
};
