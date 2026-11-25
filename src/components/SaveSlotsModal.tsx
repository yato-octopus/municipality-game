import React from 'react';
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
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card save-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{mode === 'in_game' ? 'セーブ / ロード' : 'つづきから（手動セーブ一覧）'}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {mode === 'in_game' && onSaveNew && (
            <div className="save-new-row">
              <button type="button" className="btn-primary" onClick={onSaveNew}>
                ＋ 新規にセーブデータを作成する
              </button>
            </div>
          )}

          {saves.length === 0 ? (
            <p className="empty-hint">手動保存されたセーブデータはありません。</p>
          ) : (
            <div className="save-list">
              {saves.map((s) => (
                <div key={s.slotId} className="save-slot-row">
                  <div className="save-slot-meta">
                    <div className="save-slot-title">{s.title}</div>
                    <div className="save-slot-sub">
                      進捗 {s.completedIds.length}/{s.targetPieceIds.length} ・ Miss {s.misses} ・
                      Time {formatTimeMs(s.elapsedMs)}
                    </div>
                    <div className="save-slot-date">
                      {new Date(s.savedAt).toLocaleString('ja-JP')}
                    </div>
                  </div>
                  <div className="save-slot-actions">
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={() => onLoadSave(s)}
                    >
                      ロード
                    </button>
                    {mode === 'in_game' && onOverwriteSave && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => onOverwriteSave?.(s.slotId)}
                      >
                        上書き
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      onClick={() => onDeleteSave(s.slotId)}
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
