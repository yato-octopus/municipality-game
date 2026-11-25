import React, { useState } from 'react';
import type { MapPieceItem, MapTag } from '../types/game';

interface TagManagerModalProps {
  tags: MapTag[];
  allPieces: MapPieceItem[];
  onCreateTag: (name: string) => void;
  onRenameTag: (tagId: string, name: string) => void;
  onToggleLock: (tagId: string) => void;
  onDeleteTag: (tagId: string) => void;
  onSelectPiece?: (piece: MapPieceItem) => void;
  onClose: () => void;
}

export const TagManagerModal: React.FC<TagManagerModalProps> = ({
  tags,
  allPieces,
  onCreateTag,
  onRenameTag,
  onToggleLock,
  onDeleteTag,
  onSelectPiece,
  onClose,
}) => {
  const [newName, setNewName] = useState('');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [activeTagId, setActiveTagId] = useState<string>(tags[0]?.id ?? '');
  const [notice, setNotice] = useState<string | null>(null);

  const selectedTag = tags.find((t) => t.id === activeTagId) ?? tags[0];
  const pieceMap = new Map(allPieces.map((p) => [p.id, p]));
  const taggedPieces = selectedTag
    ? selectedTag.pieceIds
        .map((id) => pieceMap.get(id))
        .filter((x): x is MapPieceItem => Boolean(x))
    : [];

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      setNotice('タグの名前を入力してください');
      return;
    }
    if (tags.some((t) => t.name === trimmed)) {
      setNotice(`「${trimmed}」は既に存在します`);
      return;
    }
    onCreateTag(trimmed);
    setNewName('');
    setNotice(null);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card tag-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>タグ管理 / タグ別一覧</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <form className="tag-create-form" onSubmit={handleAdd}>
            <input
              type="text"
              placeholder="新しいタグ名（例: 難読・気になる形）"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="submit" className="btn-primary btn-sm">
              追加
            </button>
          </form>
          {notice && <p className="tag-notice">{notice}</p>}

          <div className="tag-manage-split">
            <div className="tag-list-col">
              {tags.map((t) => (
                <div
                  key={t.id}
                  className={`tag-row-item ${t.id === selectedTag?.id ? 'active' : ''}`}
                  onClick={() => setActiveTagId(t.id)}
                >
                  {editingTagId === t.id ? (
                    <div className="tag-edit-inline" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-primary btn-xs"
                        onClick={() => {
                          if (editingName.trim()) {
                            onRenameTag(t.id, editingName.trim());
                          }
                          setEditingTagId(null);
                        }}
                      >
                        保存
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="tag-row-name">
                        {t.name} ({t.pieceIds.length})
                      </span>
                      <div className="tag-row-btns" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          title={t.locked ? 'ロック中（削除不可）' : 'ロックする'}
                          onClick={() => onToggleLock(t.id)}
                        >
                          {t.locked ? '🔒' : '🔓'}
                        </button>
                        <button
                          type="button"
                          title="名前変更"
                          onClick={() => {
                            if (t.locked) {
                              setNotice('ロックされたタグの名前変更はできません');
                              return;
                            }
                            setEditingTagId(t.id);
                            setEditingName(t.name);
                          }}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          title="削除"
                          onClick={() => {
                            if (t.locked) {
                              setNotice('ロックされたタグの削除はできません');
                              return;
                            }
                            onDeleteTag(t.id);
                          }}
                        >
                          🗑
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="tag-pieces-col">
              <h4>
                {selectedTag ? `「${selectedTag.name}」の地域一覧` : 'タグを選択'}
              </h4>
              {taggedPieces.length === 0 ? (
                <p className="empty-hint">このタグが付いた地域はありません。</p>
              ) : (
                <ul className="tag-piece-ul">
                  {taggedPieces.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="tag-piece-link"
                        onClick={() => {
                          onSelectPiece?.(p);
                          onClose();
                        }}
                      >
                        <strong>{p.name}</strong>
                        <span>{p.ruby}</span>
                        {p.prefName && p.prefName !== p.name && (
                          <span className="muted">({p.prefName})</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
