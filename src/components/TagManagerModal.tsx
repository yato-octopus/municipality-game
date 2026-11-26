import React, { useEffect, useMemo, useState } from 'react';
import { useEscapeClose } from '../hooks/useEscapeClose';
import type { MapPieceItem, MapTag } from '../types/game';

interface ExtraPieceLabel {
  name: string;
  ruby: string;
  prefName?: string;
}

interface TagManagerModalProps {
  tags: MapTag[];
  allPieces: MapPieceItem[];
  extraPieceLabels?: Map<string, ExtraPieceLabel>;
  onCreateTag: (name: string) => void;
  onRenameTag: (tagId: string, name: string) => void;
  onToggleLock: (tagId: string) => void;
  onDeleteTag: (tagId: string) => void;
  onTogglePieceTag?: (tagId: string, pieceId: string) => void;
  onSelectPiece?: (piece: MapPieceItem) => void;
  onPracticeTag?: (tag: MapTag, piecesInScope: MapPieceItem[]) => void;
  onClose: () => void;
}

export const TagManagerModal: React.FC<TagManagerModalProps> = ({
  tags,
  allPieces,
  extraPieceLabels,
  onCreateTag,
  onRenameTag,
  onToggleLock,
  onDeleteTag,
  onTogglePieceTag,
  onSelectPiece,
  onPracticeTag,
  onClose,
}) => {
  const [newName, setNewName] = useState('');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [activeTagId, setActiveTagId] = useState<string>(tags[0]?.id ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEscapeClose(true, () => {
    if (editingTagId) {
      setEditingTagId(null);
      return;
    }
    onClose();
  });

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!confirmDeleteId) return;
    const t = window.setTimeout(() => setConfirmDeleteId(null), 3000);
    return () => window.clearTimeout(t);
  }, [confirmDeleteId]);

  const selectedTag = tags.find((t) => t.id === activeTagId) ?? tags[0];
  const pieceMap = useMemo(() => new Map(allPieces.map((p) => [p.id, p])), [allPieces]);

  const { taggedInArea, outOfAreaIds } = useMemo(() => {
    if (!selectedTag) return { taggedInArea: [] as MapPieceItem[], outOfAreaIds: [] as string[] };
    const inArea: MapPieceItem[] = [];
    const outside: string[] = [];
    for (const id of selectedTag.pieceIds) {
      const piece = pieceMap.get(id);
      if (piece) inArea.push(piece);
      else outside.push(id);
    }
    return { taggedInArea: inArea, outOfAreaIds: outside };
  }, [selectedTag, pieceMap]);

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

  const handleRenameSubmit = (e: React.FormEvent, tagId: string) => {
    e.preventDefault();
    const trimmed = editingName.trim();
    if (!trimmed) {
      setNotice('タグの名前を入力してください');
      return;
    }
    if (tags.some((t) => t.id !== tagId && t.name === trimmed)) {
      setNotice(`「${trimmed}」は既に存在します`);
      return;
    }
    onRenameTag(tagId, trimmed);
    setEditingTagId(null);
    setNotice(null);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card tag-modal"
        role="dialog"
        aria-modal="true"
        aria-label="タグ管理 / タグ別一覧"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>タグ管理 / タグ別一覧</h3>
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
          {notice && (
            <p className="tag-notice" role="status">
              {notice}
            </p>
          )}

          <div className="tag-manage-split">
            <div className="tag-list-col">
              {tags.length === 0 ? (
                <p className="empty-hint">タグがありません。上の入力欄から作成できます。</p>
              ) : (
                tags.map((t) => {
                  const inScopeCount = t.pieceIds.filter((id) => pieceMap.has(id)).length;
                  const confirmingDel = confirmDeleteId === t.id;
                  return (
                    <div
                      key={t.id}
                      className={`tag-row-item ${t.id === selectedTag?.id ? 'active' : ''}`}
                      onClick={() => {
                        setActiveTagId(t.id);
                        setNotice(null);
                        setConfirmDeleteId(null);
                      }}
                    >
                      {editingTagId === t.id ? (
                        <form
                          className="tag-edit-inline"
                          onClick={(e) => e.stopPropagation()}
                          onSubmit={(e) => handleRenameSubmit(e, t.id)}
                        >
                          <input
                            type="text"
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            aria-label="新しいタグ名"
                          />
                          <button type="submit" className="btn-primary btn-xs">
                            保存
                          </button>
                          <button
                            type="button"
                            className="btn-ghost btn-xs"
                            onClick={() => setEditingTagId(null)}
                          >
                            戻す
                          </button>
                        </form>
                      ) : (
                        <>
                          <span className="tag-row-name">
                            {t.name} (
                            {inScopeCount !== t.pieceIds.length
                              ? `${inScopeCount}/${t.pieceIds.length}`
                              : t.pieceIds.length}
                            )
                          </span>
                          <div className="tag-row-btns" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              title={t.locked ? 'ロック中（削除不可）' : 'ロックする'}
                              aria-label={t.locked ? 'ロック解除' : 'ロックする'}
                              onClick={() => onToggleLock(t.id)}
                            >
                              {t.locked ? '🔒' : '🔓'}
                            </button>
                            <button
                              type="button"
                              title="名前変更"
                              aria-label={`${t.name}の名前を変更`}
                              onClick={() => {
                                if (t.locked) {
                                  setNotice('ロックされたタグの名前変更はできません');
                                  return;
                                }
                                setEditingTagId(t.id);
                                setEditingName(t.name);
                                setNotice(null);
                              }}
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className={confirmingDel ? 'btn-danger btn-xs confirm-inline-btn' : ''}
                              title="削除"
                              aria-label={`${t.name}を削除`}
                              onClick={() => {
                                if (t.locked) {
                                  setNotice('ロックされたタグの削除はできません');
                                  return;
                                }
                                if (!confirmingDel) {
                                  setConfirmDeleteId(t.id);
                                  return;
                                }
                                setConfirmDeleteId(null);
                                onDeleteTag(t.id);
                              }}
                            >
                              {confirmingDel ? '確定' : '🗑'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="tag-pieces-col">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  flexWrap: 'wrap',
                  marginBottom: '6px',
                }}
              >
                <h4 style={{ margin: 0 }}>
                  {selectedTag ? (
                    <>
                      「{selectedTag.name}」の地域一覧{' '}
                      <span className="muted">
                        （このエリア {taggedInArea.length}件 / 全エリア{' '}
                        {selectedTag.pieceIds.length}件）
                      </span>
                    </>
                  ) : (
                    'タグを選択'
                  )}
                </h4>
                {selectedTag && onPracticeTag && taggedInArea.length > 0 && (
                  <button
                    type="button"
                    className="btn-primary btn-xs"
                    onClick={() => {
                      onPracticeTag(selectedTag, taggedInArea);
                      onClose();
                    }}
                  >
                    🎯 このタグで練習（{taggedInArea.length}件）
                  </button>
                )}
              </div>

              {selectedTag && selectedTag.pieceIds.length === 0 ? (
                <p className="empty-hint">このタグが付いた地域はありません。</p>
              ) : (
                <>
                  {taggedInArea.length === 0 && outOfAreaIds.length > 0 && (
                    <p className="empty-hint" style={{ padding: '10px 8px' }}>
                      現在表示中のエリア内には該当地域がありません（他エリアに{' '}
                      {outOfAreaIds.length} 件登録されています）。
                    </p>
                  )}

                  {taggedInArea.length > 0 && (
                    <ul className="tag-piece-ul">
                      {taggedInArea.map((p) => (
                        <li
                          key={p.id}
                          style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <button
                            type="button"
                            className="tag-piece-link"
                            style={{ flex: 1 }}
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
                          {selectedTag && onTogglePieceTag && (
                            <button
                              type="button"
                              className="mistake-chip-del"
                              title="このタグを外す"
                              aria-label={`${p.name}からタグを外す`}
                              onClick={() => onTogglePieceTag(selectedTag.id, p.id)}
                            >
                              ✕
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {outOfAreaIds.length > 0 && (
                    <div style={{ marginTop: '10px' }}>
                      <div className="muted" style={{ fontWeight: 700, marginBottom: '4px' }}>
                        他エリアに登録中（{outOfAreaIds.length}件）
                      </div>
                      <ul className="tag-piece-ul" style={{ maxHeight: '130px' }}>
                        {outOfAreaIds.map((pid) => {
                          const info = extraPieceLabels?.get(pid);
                          return (
                            <li
                              key={pid}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '6px',
                                padding: '4px 8px',
                                borderBottom: '1px solid var(--bg-muted)',
                                fontSize: '0.82rem',
                              }}
                            >
                              <span>
                                <strong>{info?.name ?? pid.replace('pref_', '')}</strong>
                                {info?.ruby && <span className="muted"> ({info.ruby})</span>}
                                {info?.prefName && info.prefName !== info.name && (
                                  <span className="muted"> ・ {info.prefName}</span>
                                )}
                              </span>
                              {selectedTag && onTogglePieceTag && (
                                <button
                                  type="button"
                                  className="mistake-chip-del"
                                  title="このタグを外す"
                                  aria-label={`${info?.name ?? pid}からタグを外す`}
                                  onClick={() => onTogglePieceTag(selectedTag.id, pid)}
                                >
                                  ✕
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
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
