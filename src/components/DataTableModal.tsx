import React, { useMemo, useState } from 'react';
import { useEscapeClose } from '../hooks/useEscapeClose';
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
  normalizeSearchText,
  sortPiecesByArea,
  sortPiecesByCode,
  sortPiecesByKana,
  sortPiecesByPopulation,
} from '../services/dataAnalyzer';
import type { SortDirection, SubTableGroup } from '../services/dataAnalyzer';
import type { MapPieceItem, SortTabKey, TiikiFilterTab } from '../types/game';

interface DataTableModalProps {
  title: string;
  pieces: MapPieceItem[];
  onSelectPiece: (piece: MapPieceItem) => void;
  onClose: () => void;
}

const PAGE_SIZE = 400;

const ALL_SORT_TABS: { key: SortTabKey; label: string; muniOnly?: boolean; hideGeo?: boolean }[] = [
  { key: 'code', label: '市区町村/コード' },
  { key: 'kana50', label: '50音' },
  { key: 'population', label: '人口', hideGeo: true },
  { key: 'area', label: '面積', hideGeo: true },
  { key: 'kanzi', label: '漢字' },
  { key: 'hirakana', label: 'ひらカナ' },
  { key: 'moziCount', label: '文字数' },
  { key: 'similarName', label: '似た名前', muniOnly: true },
  { key: 'matiTyou', label: 'まち・ちょう', muniOnly: true },
  { key: 'muraSon', label: 'むら・そん', muniOnly: true },
  { key: 'siTyouSonKu', label: '市町村区', muniOnly: true },
];

function defaultDirForTab(tab: SortTabKey): SortDirection {
  return tab === 'population' || tab === 'area' ? 'desc' : 'asc';
}

export const DataTableModal: React.FC<DataTableModalProps> = ({
  title,
  pieces,
  onSelectPiece,
  onClose,
}) => {
  useEscapeClose(true, onClose);

  const isGeoMode = useMemo(
    () => pieces.length > 0 && pieces.every((p) => Boolean(p.geoCategory)),
    [pieces],
  );
  const isPrefMode = useMemo(
    () => !isGeoMode && pieces.length > 0 && pieces.every((p) => p.id.startsWith('pref_')),
    [pieces, isGeoMode],
  );
  const isMuniMode = !isGeoMode && !isPrefMode;

  const availableSortTabs = useMemo(
    () =>
      ALL_SORT_TABS.filter((t) => {
        if (t.muniOnly && !isMuniMode) return false;
        if (t.hideGeo && isGeoMode) return false;
        if (isPrefMode && t.key === 'hirakana') return false;
        return true;
      }).map((t) => {
        if (t.key === 'code') {
          if (isGeoMode) return { ...t, label: '一覧' };
          if (isPrefMode) return { ...t, label: 'コード順' };
        }
        return t;
      }),
    [isGeoMode, isPrefMode, isMuniMode],
  );

  const availableTiikiTabs = useMemo<{ key: TiikiFilterTab; label: string }[]>(() => {
    if (isGeoMode) {
      return [
        { key: 'all', label: 'すべて' },
        { key: 'tiiki', label: '分類' },
      ];
    }
    if (isPrefMode) {
      return [
        { key: 'all', label: 'すべて' },
        { key: 'tiiki', label: '地方' },
      ];
    }
    return [
      { key: 'all', label: 'すべて' },
      { key: 'tihou', label: '地方・県' },
      { key: 'tiiki', label: '地域区分' },
      { key: 'gun', label: '郡・振興局' },
    ];
  }, [isGeoMode, isPrefMode]);

  const [sortTab, setSortTab] = useState<SortTabKey>('code');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [tiikiTab, setTiikiTab] = useState<TiikiFilterTab>('all');
  const [selectedTiikiKey, setSelectedTiikiKey] = useState<string | null>(null);
  const [tiikiChipFilter, setTiikiChipFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [subGroup, setSubGroup] = useState<SubTableGroup | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const activeSortTab: SortTabKey = availableSortTabs.some((t) => t.key === sortTab)
    ? sortTab
    : 'code';
  const activeTiikiTab: TiikiFilterTab = availableTiikiTabs.some((t) => t.key === tiikiTab)
    ? tiikiTab
    : 'all';

  const tiikiGroups = useMemo(() => {
    if (activeTiikiTab === 'all') return [];
    return groupByTiiki(pieces, activeTiikiTab);
  }, [pieces, activeTiikiTab]);

  const filteredTiikiGroups = useMemo(() => {
    const q = normalizeSearchText(tiikiChipFilter);
    if (!q) return tiikiGroups;
    return tiikiGroups.filter((g) => normalizeSearchText(g.label).includes(q));
  }, [tiikiGroups, tiikiChipFilter]);

  const scopedPieces = useMemo(() => {
    let base = pieces;
    if (activeTiikiTab !== 'all' && selectedTiikiKey) {
      const grp = tiikiGroups.find((g) => g.key === selectedTiikiKey);
      if (grp) base = grp.items;
    }
    return filterPiecesByKeyword(base, searchQuery);
  }, [pieces, activeTiikiTab, selectedTiikiKey, tiikiGroups, searchQuery]);

  const sortedFlat = useMemo(() => {
    switch (activeSortTab) {
      case 'kana50':
        return sortPiecesByKana(scopedPieces, sortDir);
      case 'population':
        return sortPiecesByPopulation(scopedPieces, sortDir);
      case 'area':
        return sortPiecesByArea(scopedPieces, sortDir);
      default:
        return sortPiecesByCode(scopedPieces, sortDir);
    }
  }, [scopedPieces, activeSortTab, sortDir]);

  const kanjiGroups = useMemo(
    () => (activeSortTab === 'kanzi' ? analyzeKanzi(scopedPieces) : []),
    [scopedPieces, activeSortTab],
  );
  const hirakanaList = useMemo(
    () => (activeSortTab === 'hirakana' ? analyzeHirakana(scopedPieces) : []),
    [scopedPieces, activeSortTab],
  );
  const moziGroups = useMemo(
    () => (activeSortTab === 'moziCount' ? analyzeMoziCount(scopedPieces) : []),
    [scopedPieces, activeSortTab],
  );
  const similarGroups = useMemo(
    () => (activeSortTab === 'similarName' ? analyzeSimilarNames(scopedPieces) : []),
    [scopedPieces, activeSortTab],
  );
  const matiSummary = useMemo(
    () => (activeSortTab === 'matiTyou' ? analyzeMatiTyou(scopedPieces) : null),
    [scopedPieces, activeSortTab],
  );
  const muraSummary = useMemo(
    () => (activeSortTab === 'muraSon' ? analyzeMuraSon(scopedPieces) : null),
    [scopedPieces, activeSortTab],
  );
  const suffixGroups = useMemo(
    () => (activeSortTab === 'siTyouSonKu' ? analyzeSiTyouSonKu(scopedPieces) : []),
    [scopedPieces, activeSortTab],
  );

  const handleSortTabClick = (nextTab: SortTabKey) => {
    setSubGroup(null);
    setVisibleCount(PAGE_SIZE);
    if (nextTab === activeSortTab && ['code', 'kana50', 'population', 'area'].includes(nextTab)) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortTab(nextTab);
      setSortDir(defaultDirForTab(nextTab));
    }
  };

  const renderSortArrow = (tab: SortTabKey) => {
    if (activeSortTab !== tab || subGroup) return null;
    return <span aria-hidden="true"> {sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  const renderPieceTable = (items: MapPieceItem[], showIndex = false) => {
    const shown = items.slice(0, visibleCount);
    const remaining = items.length - shown.length;

    return (
      <div className="data-table-scroll">
        <table className="data-grid-table">
          <thead>
            <tr>
              <th
                style={!subGroup ? { cursor: 'pointer' } : undefined}
                onClick={() => !subGroup && handleSortTabClick('code')}
              >
                {showIndex ? '#' : isGeoMode ? '#' : 'コード'}
                {renderSortArrow('code')}
              </th>
              <th
                style={!subGroup ? { cursor: 'pointer' } : undefined}
                onClick={() => !subGroup && handleSortTabClick('kana50')}
              >
                名称
              </th>
              <th
                style={!subGroup ? { cursor: 'pointer' } : undefined}
                onClick={() => !subGroup && handleSortTabClick('kana50')}
              >
                ふりがな{renderSortArrow('kana50')}
              </th>
              <th>{isGeoMode ? '分類' : '所属'}</th>
              {isGeoMode ? (
                <th>説明</th>
              ) : (
                <>
                  <th
                    className="num"
                    style={!subGroup ? { cursor: 'pointer' } : undefined}
                    onClick={() => !subGroup && handleSortTabClick('population')}
                  >
                    人口{renderSortArrow('population')}
                  </th>
                  <th
                    className="num"
                    style={!subGroup ? { cursor: 'pointer' } : undefined}
                    onClick={() => !subGroup && handleSortTabClick('area')}
                  >
                    面積(km²){renderSortArrow('area')}
                  </th>
                  <th>{isPrefMode ? '県庁' : '詳細'}</th>
                </>
              )}
              <th aria-label="地図移動" />
            </tr>
          </thead>
          <tbody>
            {shown.map((p, idx) => (
              <tr
                key={p.id}
                onClick={() => {
                  onSelectPiece(p);
                  onClose();
                }}
                className="data-row-clickable"
              >
                <td className="mono">
                  {showIndex || isGeoMode ? idx + 1 : p.id.replace('pref_', '')}
                </td>
                <td>
                  <strong>{p.name}</strong>
                </td>
                <td>{p.ruby}</td>
                <td>{p.prefName && p.prefName !== p.name ? p.prefName : p.regionLabel}</td>
                {isGeoMode ? (
                  <td>{p.desc || '-'}</td>
                ) : (
                  <>
                    <td className="num">
                      {p.population > 0 ? p.population.toLocaleString() : '-'}
                    </td>
                    <td className="num">
                      {p.areaKm2 > 0
                        ? p.areaKm2.toLocaleString(undefined, { maximumFractionDigits: 2 })
                        : '-'}
                    </td>
                    <td>{p.countyLabel || p.adminAreaLabel || '-'}</td>
                  </>
                )}
                <td>
                  <span className="data-jump-hint">地図へ →</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <p className="empty-hint">条件に一致するデータがありません。</p>
        )}
        {remaining > 0 && (
          <div
            className="data-truncate-note"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
              padding: '10px 4px',
            }}
          >
            <span>
              全 {items.length.toLocaleString()} 件中 {shown.length.toLocaleString()} 件を表示中
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                さらに{Math.min(PAGE_SIZE, remaining).toLocaleString()}件表示（残り{' '}
                {remaining.toLocaleString()}件）
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setVisibleCount(items.length)}
              >
                すべて表示
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

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
            onClick={() => {
              setSubGroup(g);
              setVisibleCount(PAGE_SIZE);
            }}
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
      <div
        className="modal-card data-table-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`データ一覧：${title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>
            データ一覧：{title}（{scopedPieces.length.toLocaleString()}件）
          </h3>
          <button
            type="button"
            className="modal-close-btn"
            aria-label="閉じる"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Sort Tabs */}
        <div className="data-tabs-bar">
          {availableSortTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`data-tab-btn ${activeSortTab === t.key ? 'active' : ''}`}
              onClick={() => handleSortTabClick(t.key)}
            >
              {t.label}
              {renderSortArrow(t.key)}
            </button>
          ))}
        </div>

        {/* Search + Region Filter Toolbar */}
        <div className="data-filter-toolbar">
          <input
            type="search"
            className="data-search-input"
            placeholder={
              isGeoMode
                ? '検索（名称・ふりがな・カタカナ・説明）'
                : '検索（漢字・ふりがな・カタカナ・県名・郡名）'
            }
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSubGroup(null);
              setVisibleCount(PAGE_SIZE);
            }}
          />
          <div className="tiiki-tabs">
            <span className="tiiki-label">{isGeoMode ? '分類:' : '地域:'}</span>
            {availableTiikiTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={activeTiikiTab === t.key ? 'active' : ''}
                onClick={() => {
                  setTiikiTab(t.key);
                  setSelectedTiikiKey(null);
                  setTiikiChipFilter('');
                  setSubGroup(null);
                  setVisibleCount(PAGE_SIZE);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {activeTiikiTab !== 'all' && tiikiGroups.length > 0 && (
          <div className="tiiki-chip-strip">
            {tiikiGroups.length > 20 && (
              <input
                type="search"
                className="tiiki-filter-input"
                placeholder={`絞り込み（全${tiikiGroups.length}件）...`}
                aria-label="地域チップを絞り込み"
                value={tiikiChipFilter}
                onChange={(e) => setTiikiChipFilter(e.target.value)}
              />
            )}
            <button
              type="button"
              className={!selectedTiikiKey ? 'active' : ''}
              onClick={() => {
                setSelectedTiikiKey(null);
                setSubGroup(null);
                setVisibleCount(PAGE_SIZE);
              }}
            >
              すべて ({pieces.length})
            </button>
            {filteredTiikiGroups.map((g) => (
              <button
                key={g.key}
                type="button"
                className={selectedTiikiKey === g.key ? 'active' : ''}
                onClick={() => {
                  setSelectedTiikiKey(g.key);
                  setSubGroup(null);
                  setVisibleCount(PAGE_SIZE);
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
                  onClick={() => {
                    setSubGroup(null);
                    setVisibleCount(PAGE_SIZE);
                  }}
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
              {(activeSortTab === 'code' ||
                activeSortTab === 'kana50' ||
                activeSortTab === 'population' ||
                activeSortTab === 'area') &&
                renderPieceTable(sortedFlat, activeSortTab !== 'code')}

              {activeSortTab === 'kanzi' &&
                renderGroupList(kanjiGroups, '該当する漢字データがありません')}

              {activeSortTab === 'hirakana' &&
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
                          <th aria-label="地図移動" />
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
                            <td>{row.piece.prefName || row.piece.regionLabel}</td>
                            <td>
                              <span className="data-jump-hint">地図へ →</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}

              {activeSortTab === 'moziCount' &&
                renderGroupList(moziGroups, '該当データがありません')}

              {activeSortTab === 'similarName' &&
                renderGroupList(
                  similarGroups,
                  '現在の表示対象内に「似た名前」グループ（2件以上重複）はありません（全国表示で多く確認できます）',
                )}

              {activeSortTab === 'matiTyou' && matiSummary && (
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

              {activeSortTab === 'muraSon' && muraSummary && (
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

              {activeSortTab === 'siTyouSonKu' &&
                renderGroupList(suffixGroups, '該当データがありません')}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
