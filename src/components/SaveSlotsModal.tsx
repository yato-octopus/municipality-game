import React, { useEffect, useState } from 'react';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { formatTimeMs } from '../utils/formatters';
import type { SavedProgress } from '../types/game';

interface SaveSlotsModalProps {
  mode: 'in_game' | 'load_only';
  saves: SavedProgress[];
  onSaveNew?: () => void;
  onOverwriteSave?: (slotId: string) => void;
  onLoadSave: (save: SavedProgress) => void;
  onDeleteSave: (slotId: string) => void;
  onClose: () => void;
}

export const SaveSlotsModal: React.FC<SaveSlotsModalProps> = ({
  mode,
  saves,
  onSaveNew,
  onOverwriteSave,
  onLoadSave,
  onDeleteSave,
  onClose,
}) => {
  useEscapeClose(true, onClose);

  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmKey) return;
    const t = window.setTimeout(() => setConfirmKey(null), 3000);
    return () => window.clearTimeout(t);
  }, [confirmKey]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = window.setTimeout(() => setToastMsg(null), 2600);
    return () => window.clearTimeout(t);
  }, [toastMsg]);

  const title = mode === 'in_game' ? 'セーブ / ロード' : 'つづきから（手動セーブ一覧）';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card save-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button
            type="button"
            className="modal-close-btn"
            aria-label="閉じる"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {toastMsg && (
            <div className="save-toast" role="status" aria-live="polite">
              {toastMsg}
            </div>
          )}

          {mode === 'in_game' && onSaveNew && (
            <div className="save-new-row">
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  onSaveNew();
                  setConfirmKey(null);
                  setToastMsg('新規セーブデータに保存しました ✓');
                }}
              >
                ＋ 新規にセーブデータを作成する
              </button>
            </div>
          )}

          {saves.length === 0 ? (
            <p className="empty-hint">手動保存されたセーブデータはありません。</p>
          ) : (
            <div className="save-list">
              {saves.map((s) => {
                const loadKey = `load:${s.slotId}`;
                const owKey = `ow:${s.slotId}`;
                const delKey = `del:${s.slotId}`;
                const confirmingLoad = confirmKey === loadKey;
                const confirmingOw = confirmKey === owKey;
                const confirmingDel = confirmKey === delKey;

                return (
                  <div key={s.slotId} className="save-slot-row">
                    <div className="save-slot-meta">
                      <div className="save-slot-title">{s.title}</div>
                      <div className="save-slot-sub">
                        進捗 {s.completedIds.length}/{s.targetPieceIds.length} ・ Miss {s.misses} ・
                        ヒント {s.hintsUsed} ・ Time {formatTimeMs(s.elapsedMs)}
                      </div>
                      <div className="save-slot-date">
                        {new Date(s.savedAt).toLocaleString('ja-JP')}
                      </div>
                    </div>
                    <div className="save-slot-actions">
                      <button
                        type="button"
                        className={
                          confirmingLoad
                            ? 'btn-warning btn-sm confirm-inline-btn'
                            : 'btn-primary btn-sm'
                        }
                        onClick={() => {
                          if (mode === 'in_game' && !confirmingLoad) {
                            setConfirmKey(loadKey);
                            return;
                          }
                          setConfirmKey(null);
                          onLoadSave(s);
                        }}
                      >
                        {confirmingLoad ? '進行破棄してロード' : 'ロード'}
                      </button>
                      {mode === 'in_game' && onOverwriteSave && (
                        <button
                          type="button"
                          className={
                            confirmingOw
                              ? 'btn-warning btn-sm confirm-inline-btn'
                              : 'btn-secondary btn-sm'
                          }
                          onClick={() => {
                            if (!confirmingOw) {
                              setConfirmKey(owKey);
                              return;
                            }
                            setConfirmKey(null);
                            onOverwriteSave(s.slotId);
                            setToastMsg('セーブデータを上書き保存しました ✓');
                          }}
                        >
                          {confirmingOw ? 'もう一度押して上書き' : '上書き'}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`btn-danger btn-sm ${confirmingDel ? 'confirm-inline-btn' : ''}`}
                        onClick={() => {
                          if (!confirmingDel) {
                            setConfirmKey(delKey);
                            return;
                          }
                          setConfirmKey(null);
                          onDeleteSave(s.slotId);
                        }}
                      >
                        {confirmingDel ? 'もう一度押して削除' : '削除'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
