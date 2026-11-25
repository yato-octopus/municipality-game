import React, { useMemo } from 'react';
import { createSessionId } from '../utils/formatters';
import type { GameSessionSpec, MistakeEntry } from '../types/game';

interface MistakeReviewModalProps {
  mistakes: MistakeEntry[];
  onStartReview: (spec: GameSessionSpec) => void;
  onDeleteEntry: (key: string) => void;
  onClearMode: (modeId: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

interface ModeMistakeGroup {
  modeId: string;
  areaId: string;
  areaName: string;
  modeLabel: string;
  playKind: MistakeEntry['playKind'];
  mapScope: MistakeEntry['mapScope'];
  geoCategory?: MistakeEntry['geoCategory'];
  prefFilterCodes?: string[];
  regionFilter?: string;
  entries: MistakeEntry[];
  latestAt: number;
}

export const MistakeReviewModal: React.FC<MistakeReviewModalProps> = ({
  mistakes,
  onStartReview,
  onDeleteEntry,
  onClearMode,
  onClearAll,
  onClose,
}) => {
  const groups = useMemo<ModeMistakeGroup[]>(() => {
    const byMode = new Map<string, ModeMistakeGroup>();
    for (const m of mistakes) {
      const existing = byMode.get(m.modeId);
      if (existing) {
        existing.entries.push(m);
        if (m.lastMissedAt > existing.latestAt) existing.latestAt = m.lastMissedAt;
      } else {
        byMode.set(m.modeId, {
          modeId: m.modeId,
          areaId: m.areaId,
          areaName: m.areaName,
          modeLabel: m.modeLabel,
          playKind: m.playKind,
          mapScope: m.mapScope,
          geoCategory: m.geoCategory,
          prefFilterCodes: m.prefFilterCodes,
          regionFilter: m.regionFilter,
          entries: [m],
          latestAt: m.lastMissedAt,
        });
      }
    }
    return Array.from(byMode.values()).sort((a, b) => b.latestAt - a.latestAt);
  }, [mistakes]);

  // Unique missed municipalities across all japan_munis entries for bulk cross-mode review
  const allMuniReviewInfo = useMemo(() => {
    const muniEntries = mistakes.filter((m) => m.mapScope === 'japan_munis');
    const byPiece = new Map<string, MistakeEntry[]>();
    for (const e of muniEntries) {
      const list = byPiece.get(e.pieceId) ?? [];
      list.push(e);
      byPiece.set(e.pieceId, list);
    }
    const pieceIds = Array.from(byPiece.keys());
    const prefCodes = Array.from(
      new Set(muniEntries.map((e) => e.prefCode).filter((c): c is string => Boolean(c))),
    );
    const reviewSourceKeys: Record<string, string[]> = {};
    for (const [pid, list] of byPiece.entries()) {
      reviewSourceKeys[pid] = list.map((x) => x.key);
    }
    return { pieceIds, prefCodes, reviewSourceKeys };
  }, [mistakes]);

  const startGroupReview = (g: ModeMistakeGroup) => {
    const uniquePieceIds: string[] = [];
    const reviewSourceKeys: Record<string, string[]> = {};
    for (const e of g.entries) {
      if (!reviewSourceKeys[e.pieceId]) {
        uniquePieceIds.push(e.pieceId);
        reviewSourceKeys[e.pieceId] = [];
      }
      reviewSourceKeys[e.pieceId].push(e.key);
    }
    const prefCodes =
      g.prefFilterCodes && g.prefFilterCodes.length > 0
        ? g.prefFilterCodes
        : g.mapScope === 'japan_munis'
          ? (() => {
              const pSet = Array.from(
                new Set(g.entries.map((e) => e.prefCode).filter((c): c is string => Boolean(c))),
              );
              return pSet.length === 1 ? pSet : undefined;
            })()
          : undefined;

    onStartReview({
      sessionId: createSessionId(`review_${g.modeId}`),
      areaId: g.areaId,
      areaName: g.areaName,
      modeId: g.modeId,
      modeLabel: `${g.modeLabel}（復習）`,
      playKind: g.playKind,
      mapScope: g.mapScope,
      geoCategory: g.geoCategory,
      prefFilterCodes: prefCodes,
      regionFilter: g.regionFilter,
      questionCount: uniquePieceIds.length,
      maxCount: uniquePieceIds.length,
      isCustomOrRandom: true,
      isReviewMode: true,
      reviewSourceKeys,
      fixedPieceIds: uniquePieceIds,
    });
  };

  const startAllMuniReview = (playKind: 'puzzle' | 'quiz' | 'yomikata') => {
    if (allMuniReviewInfo.pieceIds.length === 0) return;
    const label =
      playKind === 'puzzle' ? 'パズル' : playKind === 'quiz' ? 'クイズ' : '読み方';
    onStartReview({
      sessionId: createSessionId(`review_all_munis_${playKind}`),
      areaId: '00_japan_all',
      areaName: '間違えた市区町村まとめ',
      modeId: `review_munis_${playKind}`,
      modeLabel: `${label}（復習）`,
      playKind,
      mapScope: 'japan_munis',
      prefFilterCodes:
        allMuniReviewInfo.prefCodes.length === 1
          ? allMuniReviewInfo.prefCodes
          : undefined,
      questionCount: allMuniReviewInfo.pieceIds.length,
      maxCount: allMuniReviewInfo.pieceIds.length,
      isCustomOrRandom: true,
      isReviewMode: true,
      reviewSourceKeys: allMuniReviewInfo.reviewSourceKeys,
      fixedPieceIds: allMuniReviewInfo.pieceIds,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card mistake-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>間違えた問題の復習（計 {mistakes.length}件）</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="mistake-guide-note">
            間違えた問題は自動的に記憶されます。復習や通常プレイでミスせず正解すると自動的にリストから解除されます。
          </p>

          {allMuniReviewInfo.pieceIds.length > 0 && groups.filter((g) => g.mapScope === 'japan_munis').length >= 2 && (
            <div className="mistake-bulk-box">
              <div className="mistake-bulk-title">
                間違えた市区町村をまとめて復習（{allMuniReviewInfo.pieceIds.length}市区町村）
              </div>
              <div className="mistake-bulk-actions">
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => startAllMuniReview('puzzle')}
                >
                  🧩 パズルで復習
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => startAllMuniReview('quiz')}
                >
                  ❓ クイズで復習
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => startAllMuniReview('yomikata')}
                >
                  あ 読み方で復習
                </button>
              </div>
            </div>
          )}

          {groups.length === 0 ? (
            <p className="empty-hint">
              現在記憶されている間違えた問題はありません。プレイ中にミスした問題がここに自動登録されます。
            </p>
          ) : (
            <div className="mistake-group-list">
              {groups.map((g) => (
                <div key={g.modeId} className="mistake-group-card">
                  <div className="mistake-group-top">
                    <div>
                      <div className="mistake-group-title">
                        {g.areaName} — {g.modeLabel}
                      </div>
                      <div className="mistake-group-sub">
                        対象: {g.entries.length}問 ・ 最終ミス:{' '}
                        {new Date(g.latestAt).toLocaleString('ja-JP')}
                      </div>
                    </div>
                    <div className="mistake-group-btns">
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => startGroupReview(g)}
                      >
                        🔁 この{g.entries.length}問を復習
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        title="このグループの履歴を削除"
                        onClick={() => onClearMode(g.modeId)}
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  <div className="mistake-chip-list">
                    {g.entries.map((entry) => (
                      <span key={entry.key} className="mistake-item-chip">
                        <strong>{entry.pieceName}</strong>
                        <span className="muted">({entry.pieceRuby})</span>
                        {entry.missCount > 1 && (
                          <span className="mistake-count-pill">×{entry.missCount}</span>
                        )}
                        <button
                          type="button"
                          className="mistake-chip-del"
                          title="復習リストから外す"
                          onClick={() => onDeleteEntry(entry.key)}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {mistakes.length > 0 && (
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={onClearAll}
            >
              すべて消去
            </button>
          )}
          <button type="button" className="btn-primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
