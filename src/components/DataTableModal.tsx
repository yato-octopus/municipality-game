import React, { useMemo, useState } from 'react';
import {
  analyzeHirakana,
  analyzeKanzi,
  analyzeMatiTyou,
  analyzeMoziCount,
  analyzeMuraSon,
  analyzeSimilarNames,
  analyzeSiTyouSonKu,
  filterPiecesByKeyword,
  groupByTiiki,
  sortPiecesByArea,
  sortPiecesByCode,
  sortPiecesByElection,
  sortPiecesByKana,
  sortPiecesByPopulation,
} from '../services/dataAnalyzer';
import type { SubTableGroup } from '../services/dataAnalyzer';
import type { MapPieceItem, SortTabKey, TiikiFilterTab } from '../types/game';

interface DataTableModalProps {
  title: string;
  pieces: MapPieceItem[];
  onSelectPiece: (piece: MapPieceItem) => void;
  onClose: () => void;
}

const SORT_TABS: { key: SortTabKey; label: string }[] = [
  { key: 'code', label: '市町村/コード' },
  { key: 'kana50', label: '50音' },
  { key: 'population', label: '人口' },
  { key: 'area', label: '面積' },
  { key: 'kanzi', label: '漢字' },
  { key: 'hirakana', label: 'ひらカナ' },
  { key: 'moziCount', label: '文字数' },
  { key: 'election', label: '選挙投票率' },
  { key: 'similarName', label: '似た名前' },
  { key: 'matiTyou', label: 'まち・ちょう' },
  { key: 'muraSon', label: 'むら・そん' },
  { key: 'siTyouSonKu', label: '市町村区' },
];

const TIIKI_TABS: { key: TiikiFilterTab; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'tihou', label: '地方・県' },
  { key: 'tiiki', label: '地域区分' },
  { key: 'gun', label: '郡・振興局' },
];

export const DataTableModal: React.FC<DataTableModalProps> = ({
  title,
  pieces,
  onSelectPiece,
  onClose,
}) => {
  const [sortTab, setSortTab] = useState<SortTabKey>('code');
  const [tiikiTab, setTiikiTab] = useState<TiikiFilterTab>('all');
  const [selectedTiikiKey, setSelectedTiikiKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [subGroup, setSubGroup] = useState<SubTableGroup | null>(null);

  const tiikiGroups = useMemo(() => {
    if (tiikiTab === 'all') return [];
    return groupByTiiki(pieces, tiikiTab);
  }, [pieces, tiikiTab]);

  const scopedPieces = useMemo(() => {
    let base = pieces;
    if (tiikiTab !== 'all' && selectedTiikiKey) {
      const grp = tiikiGroups.find((g) => g.key === selectedTiikiKey);
      if (grp) base = grp.items;
    }
    return filterPiecesByKeyword(base, searchQuery);
  }, [pieces, tiikiTab, selectedTiikiKey, tiikiGroups, searchQuery]);

  const sortedFlat = useMemo(() => {
    switch (sortTab) {
      case 'kana50':
        return sortPiecesByKana(scopedPieces);
      case 'population':
        return sortPiecesByPopulation(scopedPieces);
      case 'area':
        return sortPiecesByArea(scopedPieces);
      case 'election':
        return sortPiecesByElection(scopedPieces);
      default:
        return sortPiecesByCode(scopedPieces);
    }
  }, [scopedPieces, sortTab]);

  const kanjiGroups = useMemo(
    () => (sortTab === 'kanzi' ? analyzeKanzi(scopedPieces) : []),
    [scopedPieces, sortTab],
  );
  const hirakanaList = useMemo(
    () => (sortTab === 'hirakana' ? analyzeHirakana(scopedPieces) : []),
    [scopedPieces, sortTab],
  );
  const moziGroups = useMemo(
    () => (sortTab === 'moziCount' ? analyzeMoziCount(scopedPieces) : []),
    [scopedPieces, sortTab],
  );
  const similarGroups = useMemo(
    () => (sortTab === 'similarName' ? analyzeSimilarNames(scopedPieces) : []),
    [scopedPieces, sortTab],
  );
  const matiSummary = useMemo(
    () => (sortTab === 'matiTyou' ? analyzeMatiTyou(scopedPieces) : null),
    [scopedPieces, sortTab],
  );
  const muraSummary = useMemo(
    () => (sortTab === 'muraSon' ? analyzeMuraSon(scopedPieces) : null),
    [scopedPieces, sortTab],
  );
  const suffixGroups = useMemo(
    () => (sortTab === 'siTyouSonKu' ? analyzeSiTyouSonKu(scopedPieces) : []),
    [scopedPieces, sortTab],
  );

  const renderPieceTable = (items: MapPieceItem[], showIndex = false) => (
    <div className="data-table-scroll">
      <table className="data-grid-table">
        <thead>
          <tr>
            <th>{showIndex ? '#' : 'コード'}</th>
            <th>名称</th>
            <th>ふりがな</th>
            <th>所属</th>
            <th>人口</th>
            <th>面積(km²)</th>
            <th>詳細</th>
          </tr>
        </thead>
        <tbody>
          {items.slice(0, 400).map((p, idx) => (
            <tr
              key={p.id}
              onClick={() => {
                onSelectPiece(p);
                onClose();
              }}
              className="data-row-clickable"
            >
              <td className="mono">{showIndex ? idx + 1 : p.id.replace('pref_', '')}</td>
              <td>
                <strong>{p.name}</strong>
              </td>
              <td>{p.ruby}</td>
              <td>{p.prefName && p.prefName !== p.name ? p.prefName : p.regionLabel}</td>
              <td className="num">
                {p.population > 0 ? p.population.toLocaleString() : '-'}
              </td>
              <td className="num">
                {p.areaKm2 > 0 ? p.areaKm2.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
              </td>
              <td>
                {p.electionTurnout != null ? `${p.electionTurnout.toFixed(2)}%` : p.countyLabel || p.adminAreaLabel || '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > 400 && (
        <p className="data-truncate-note">
          全 {items.length.toLocaleString()} 件中 先頭 400 件を表示中（検索・地域で絞り込みできます）
        </p>
      )}
    </div>
  );

  const renderGroupList = (groups: SubTableGroup[], emptyLabel: string) =>
    groups.length === 0 ? (
      <p className="empty-hint">{emptyLabel}</p>
    ) : (
      <div className="data-group-list">
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            className="data-group-card"
            onClick={() => setSubGroup(g)}
          >
            <div className="data-group-title">{g.label}</div>
            <div className="data-group-sub">
              {g.subLabel}
              {g.ratioText ? `（${g.ratioText}）` : ''}
            </div>
            <span className="data-group-count">{g.count}件 →</span>
          </button>
        ))}
      </div>
    );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card data-table-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            データ一覧：{title}（{scopedPieces.length.toLocaleString()}件）
          </h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* 12 Sort Tabs */}
        <div className="data-tabs-bar">
          {SORT_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`data-tab-btn ${sortTab === t.key ? 'active' : ''}`}
              onClick={() => {
                setSortTab(t.key);
                setSubGroup(null);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search + Region Filter Toolbar */}
        <div className="data-filter-toolbar">
          <input
            type="search"
            className="data-search-input"
            placeholder="検索（漢字・ふりがな・県名・郡名）"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSubGroup(null);
            }}
          />
          <div className="tiiki-tabs">
            <span className="tiiki-label">地域:</span>
            {TIIKI_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={tiikiTab === t.key ? 'active' : ''}
                onClick={() => {
                  setTiikiTab(t.key);
                  setSelectedTiikiKey(null);
                  setSubGroup(null);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {tiikiTab !== 'all' && tiikiGroups.length > 0 && (
          <div className="tiiki-chip-strip">
            <button
              type="button"
              className={!selectedTiikiKey ? 'active' : ''}
              onClick={() => setSelectedTiikiKey(null)}
            >
              すべて ({pieces.length})
            </button>
            {tiikiGroups.map((g) => (
              <button
                key={g.key}
                type="button"
                className={selectedTiikiKey === g.key ? 'active' : ''}
                onClick={() => {
                  setSelectedTiikiKey(g.key);
                  setSubGroup(null);
                }}
              >
                {g.label} ({g.count})
              </button>
            ))}
          </div>
        )}

        <div className="modal-body data-modal-body">
          {subGroup ? (
            <div className="subtable-panel">
              <div className="subtable-header">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setSubGroup(null)}
                >
                  ← 集計一覧へ戻る
                </button>
                <strong>
                  {subGroup.label}（{subGroup.count}件）
                </strong>
              </div>
              {renderPieceTable(subGroup.items, true)}
            </div>
          ) : (
            <>
              {(sortTab === 'code' ||
                sortTab === 'kana50' ||
                sortTab === 'population' ||
                sortTab === 'area' ||
                sortTab === 'election') &&
                renderPieceTable(sortedFlat, sortTab !== 'code')}

              {sortTab === 'kanzi' &&
                renderGroupList(kanjiGroups, '該当する漢字データがありません')}

              {sortTab === 'hirakana' &&
                (hirakanaList.length === 0 ? (
                  <p className="empty-hint">ひらがな・カタカナを含む名称はありません</p>
                ) : (
                  <div className="data-table-scroll">
                    <table className="data-grid-table">
                      <thead>
                        <tr>
                          <th>分類</th>
                          <th>名称</th>
                          <th>ふりがな</th>
                          <th>該当文字</th>
                          <th>所属</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hirakanaList.map((row) => (
                          <tr
                            key={row.piece.id}
                            className="data-row-clickable"
                            onClick={() => {
                              onSelectPiece(row.piece);
                              onClose();
                            }}
                          >
                            <td>{row.kind}</td>
                            <td>
                              <strong>{row.piece.name}</strong>
                            </td>
                            <td>{row.piece.ruby}</td>
                            <td>{row.chars}</td>
                            <td>{row.piece.prefName ?? row.piece.regionLabel}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}

              {sortTab === 'moziCount' &&
                renderGroupList(moziGroups, '該当データがありません')}

              {sortTab === 'similarName' &&
                renderGroupList(
                  similarGroups,
                  '現在の表示対象内に「似た名前」グループ（2件以上重複）はありません（全国表示で多く確認できます）',
                )}

              {sortTab === 'matiTyou' && matiSummary && (
                <div>
                  <div className="ratio-summary-banner">
                    <span>総数: {matiSummary.total}町</span>
                    <span>
                      〜{matiSummary.primaryLabel}:{' '}
                      <strong>{matiSummary.primaryCount}</strong> (
                      {matiSummary.total
                        ? ((matiSummary.primaryCount / matiSummary.total) * 100).toFixed(1)
                        : '0'}
                      %)
                    </span>
                    <span>
                      〜{matiSummary.secondaryLabel}:{' '}
                      <strong>{matiSummary.secondaryCount}</strong> (
                      {matiSummary.total
                        ? ((matiSummary.secondaryCount / matiSummary.total) * 100).toFixed(1)
                        : '0'}
                      %)
                    </span>
                  </div>
                  {renderGroupList(matiSummary.groups, '「〜町」がありません')}
                </div>
              )}

              {sortTab === 'muraSon' && muraSummary && (
                <div>
                  <div className="ratio-summary-banner">
                    <span>総数: {muraSummary.total}村</span>
                    <span>
                      〜{muraSummary.primaryLabel}:{' '}
                      <strong>{muraSummary.primaryCount}</strong> (
                      {muraSummary.total
                        ? ((muraSummary.primaryCount / muraSummary.total) * 100).toFixed(1)
                        : '0'}
                      %)
                    </span>
                    <span>
                      〜{muraSummary.secondaryLabel}:{' '}
                      <strong>{muraSummary.secondaryCount}</strong> (
                      {muraSummary.total
                        ? ((muraSummary.secondaryCount / muraSummary.total) * 100).toFixed(1)
                        : '0'}
                      %)
                    </span>
                  </div>
                  {renderGroupList(muraSummary.groups, '「〜村」がありません')}
                </div>
              )}

              {sortTab === 'siTyouSonKu' &&
                renderGroupList(suffixGroups, '該当データがありません')}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
