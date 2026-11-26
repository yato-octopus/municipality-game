import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GEOGRAPHY_VIEW_AREAS,
  JAPAN_REGION_JUMPS,
  PREF_REGION_GROUPS,
} from '../data/gameCatalog';
import { MAX_ZOOM_RATIO, MIN_ZOOM_RATIO, useMapViewport } from '../hooks/useMapViewport';
import { filterPiecesByKeyword } from '../services/dataAnalyzer';
import { loadSessionMap } from '../services/mapDataLoader';
import { getJapanRegionBBox } from '../services/regionJumpUtils';
import type { LoadedSessionMap } from '../services/mapDataLoader';
import type {
  AreaDefinition,
  ConfigState,
  GameSessionSpec,
  JapanPrefsData,
  MapPieceItem,
  MapTag,
} from '../types/game';
import { DataTableModal } from './DataTableModal';
import { MapCanvas } from './MapCanvas';
import { TagManagerModal } from './TagManagerModal';

interface ExtraPieceLabel {
  name: string;
  ruby: string;
  prefName?: string;
}

interface ViewModeScreenProps {
  initialAreaId: string;
  initialFocusPieceId?: string | null;
  returnLabel?: string;
  areas: AreaDefinition[];
  prefsData?: JapanPrefsData | null;
  allKnownPieces?: Map<string, ExtraPieceLabel>;
  config: ConfigState;
  tags: MapTag[];
  onConfigChange: (next: ConfigState) => void;
  onTogglePieceTag: (tagId: string, pieceId: string) => void;
  onCreateTag: (name: string) => void;
  onRenameTag: (tagId: string, name: string) => void;
  onToggleLockTag: (tagId: string) => void;
  onDeleteTag: (tagId: string) => void;
  onStartGame?: (spec: GameSessionSpec) => void;
  onGoTitle: () => void;
}

export const ViewModeScreen: React.FC<ViewModeScreenProps> = ({
  initialAreaId,
  initialFocusPieceId = null,
  returnLabel = '← タイトル',
  areas,
  prefsData = null,
  allKnownPieces,
  config,
  tags,
  onConfigChange,
  onTogglePieceTag,
  onCreateTag,
  onRenameTag,
  onToggleLockTag,
  onDeleteTag,
  onStartGame,
  onGoTitle,
}) => {
  const [selectedAreaId, setSelectedAreaId] = useState(initialAreaId);
  const [loadedState, setLoadedState] = useState<{
    areaId: string;
    map: LoadedSessionMap;
  } | null>(null);
  const [selectedPiece, setSelectedPiece] = useState<MapPieceItem | null>(null);
  const [showNames, setShowNames] = useState(true);
  const [showCapitalMarks, setShowCapitalMarks] = useState(false);
  const [swapCapitalLabel, setSwapCapitalLabel] = useState(false);
  const [showDataModal, setShowDataModal] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const consumedFocusKeyRef = useRef<string | null>(null);

  const geoAreaDef = useMemo(
    () => GEOGRAPHY_VIEW_AREAS.find((g) => g.id === selectedAreaId) ?? null,
    [selectedAreaId],
  );
  const isGeoView = Boolean(geoAreaDef);

  const area = useMemo(
    () => areas.find((a) => a.id === selectedAreaId) ?? areas[0],
    [areas, selectedAreaId],
  );

  const currentViewTitle = geoAreaDef ? geoAreaDef.name : area.name;
  const loadedMap = loadedState?.areaId === selectedAreaId ? loadedState.map : null;
  const loading = loadedMap === null;

  useEffect(() => {
    let active = true;
    const spec: GameSessionSpec = geoAreaDef
      ? {
          sessionId: `view_${geoAreaDef.id}`,
          areaId: '00_japan',
          areaName: geoAreaDef.name,
          modeId: `view_${geoAreaDef.id}`,
          modeLabel: '閲覧',
          playKind: 'view',
          mapScope: 'geography_100',
          geoCategory: geoAreaDef.geoCategory,
          questionCount: geoAreaDef.approxCount,
          maxCount: geoAreaDef.approxCount,
          isCustomOrRandom: false,
        }
      : {
          sessionId: `view_${area.id}`,
          areaId: area.id,
          areaName: area.name,
          modeId: `view_${area.id}`,
          modeLabel: '閲覧',
          playKind: 'view',
          mapScope: area.id === '00_japan' ? 'japan_prefs' : 'japan_munis',
          prefFilterCodes: area.prefCode ? [area.prefCode] : undefined,
          regionFilter: area.id === '00_japan_cities' ? 'cities_all' : undefined,
          questionCount: area.totalCount,
          maxCount: area.totalCount,
          isCustomOrRandom: false,
        };
    void loadSessionMap(spec).then((res) => {
      if (!active) return;
      setLoadedState({ areaId: selectedAreaId, map: res });
    });
    return () => {
      active = false;
    };
  }, [selectedAreaId, geoAreaDef, area]);

  const initialBBox = loadedMap?.viewBBox ?? [22, 34, 940, 920];
  const {
    svgRef,
    viewBox,
    viewBoxString,
    zoomRatio,
    minZoomRatio,
    fitBBox,
    animateToBBox,
    zoomByFactor,
    setZoomAtPoint,
    panByScreenDelta,
    finishPan,
  } = useMapViewport({
    initialBBox,
    dragInertia: config.dragInertia,
    fpsMode: config.fpsMode,
  });

  const completedSet = useMemo(() => new Set<string>(), []);

  const focusPiece = useCallback(
    (p: MapPieceItem) => {
      setSelectedPiece(p);
      const w = Math.max(12, (p.bbox[2] - p.bbox[0]) * 3.5);
      const h = Math.max(12, (p.bbox[3] - p.bbox[1]) * 3.5);
      const cx = p.center[0];
      const cy = p.center[1];
      animateToBBox([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]);
    },
    [animateToBBox],
  );

  // Auto-focus requested piece when opened from GameInfo -> DataTable
  useEffect(() => {
    if (!loadedMap || !initialFocusPieceId || selectedAreaId !== initialAreaId) return;
    const key = `${initialAreaId}::${initialFocusPieceId}`;
    if (consumedFocusKeyRef.current === key) return;
    const target =
      loadedMap.targetPieces.find((p) => p.id === initialFocusPieceId) ??
      loadedMap.contextPieces.find((p) => p.id === initialFocusPieceId);
    if (!target) return;
    consumedFocusKeyRef.current = key;
    const raf = requestAnimationFrame(() => {
      focusPiece(target);
    });
    return () => cancelAnimationFrame(raf);
  }, [loadedMap, initialFocusPieceId, initialAreaId, selectedAreaId, focusPiece]);

  // Keyboard shortcuts (+ / - / 0 / / / Esc)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (showDataModal || showTagModal) return;
      if (e.isComposing || e.keyCode === 229) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      const isInputFocused = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'Escape') {
        if (isInputFocused) {
          (e.target as HTMLElement).blur();
          setSearchOpen(false);
          return;
        }
        if (selectedPiece) {
          e.preventDefault();
          setSelectedPiece(null);
        }
        return;
      }

      if (isInputFocused || e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === '/' && loadedMap) {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchOpen(true);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomByFactor(1.4);
      } else if (e.key === '-') {
        e.preventDefault();
        zoomByFactor(1 / 1.4);
      } else if (e.key === '0' && loadedMap) {
        e.preventDefault();
        fitBBox(loadedMap.viewBBox);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showDataModal, showTagModal, selectedPiece, loadedMap, zoomByFactor, fitBBox]);

  const quickSearchResults = useMemo(() => {
    if (!loadedMap || !quickQuery.trim()) return [];
    return filterPiecesByKeyword(loadedMap.targetPieces, quickQuery).slice(0, 10);
  }, [loadedMap, quickQuery]);

  const jumpKind: 'japan' | 'none' =
    isGeoView ||
    selectedAreaId === '00_japan' ||
    selectedAreaId === '00_japan_all' ||
    selectedAreaId === '00_japan_cities'
      ? 'japan'
      : 'none';

  const japanJumps = config.reverseJumpButtons
    ? [...JAPAN_REGION_JUMPS].reverse()
    : JAPAN_REGION_JUMPS;

  const effectiveMinZoom = Math.max(0.01, Math.min(MIN_ZOOM_RATIO, minZoomRatio));
  const sliderVal = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (Math.log(Math.max(effectiveMinZoom, zoomRatio) / effectiveMinZoom) /
          Math.log(MAX_ZOOM_RATIO / effectiveMinZoom)) *
          100,
      ),
    ),
  );
  const handleSliderChange = (val: number) => {
    const nextZoom =
      effectiveMinZoom * Math.pow(MAX_ZOOM_RATIO / effectiveMinZoom, val / 100);
    setZoomAtPoint(nextZoom);
  };
  const zoomReadout =
    zoomRatio >= 10 ? `${Math.round(zoomRatio)}x` : `${zoomRatio.toFixed(1)}x`;

  const nationalAreas = useMemo(
    () => areas.filter((a) => a.category !== 'prefecture'),
    [areas],
  );
  const prefByCode = useMemo(() => {
    const m = new Map<string, AreaDefinition>();
    for (const a of areas) {
      if (a.prefCode) m.set(a.prefCode, a);
    }
    return m;
  }, [areas]);

  const selectedPrefCapitalRuby = useMemo(() => {
    if (!prefsData || selectedAreaId !== '00_japan' || !selectedPiece?.prefCode) return null;
    const meta = prefsData.prefs.find((p) => p.code === selectedPiece.prefCode);
    return meta?.capitalRuby ?? null;
  }, [prefsData, selectedAreaId, selectedPiece]);

  const handlePlayCurrentArea = () => {
    if (!onStartGame || !loadedMap) return;
    if (geoAreaDef) {
      const count = loadedMap.targetPieces.length;
      onStartGame({
        sessionId: `view_play_${geoAreaDef.id}_${Date.now()}`,
        areaId: '00_japan',
        areaName: geoAreaDef.name,
        modeId: geoAreaDef.modeId ?? 'random_geography_100_geography_quiz',
        modeLabel: geoAreaDef.geoCategory ? geoAreaDef.name : '自然地理クイズ',
        playKind: 'geography_quiz',
        mapScope: 'geography_100',
        geoCategory: geoAreaDef.geoCategory,
        questionCount: count,
        maxCount: count,
        isCustomOrRandom: !geoAreaDef.modeId,
      });
      return;
    }

    const preferredMode =
      area.id === '00_japan' || area.id === '00_japan_all' || area.id === '00_japan_cities'
        ? area.modes.find((m) => m.playKind === 'quiz') ?? area.modes[0]
        : area.modes[0];
    if (!preferredMode) return;
    const count = loadedMap.targetPieces.length;
    onStartGame({
      sessionId: `${preferredMode.id}_${Date.now()}`,
      areaId: area.id,
      areaName: area.name,
      modeId: preferredMode.id,
      modeLabel: preferredMode.label,
      playKind: preferredMode.playKind,
      mapScope: area.id === '00_japan' ? 'japan_prefs' : 'japan_munis',
      geoCategory: preferredMode.geoCategory,
      prefFilterCodes: area.prefCode ? [area.prefCode] : undefined,
      regionFilter:
        area.id === '00_japan_cities'
          ? (preferredMode.regionFilter ?? 'cities_all')
          : preferredMode.regionFilter,
      questionCount: count,
      maxCount: count,
      isCustomOrRandom: false,
    });
  };

  const handlePracticeTag = (tag: MapTag, piecesInScope: MapPieceItem[]) => {
    if (!onStartGame || piecesInScope.length === 0) return;
    const ids = piecesInScope.map((p) => p.id);
    const mapScope: GameSessionSpec['mapScope'] = isGeoView
      ? 'geography_100'
      : selectedAreaId === '00_japan'
        ? 'japan_prefs'
        : 'japan_munis';
    const playKind: GameSessionSpec['playKind'] = isGeoView ? 'geography_quiz' : 'quiz';
    onStartGame({
      sessionId: `tag_${tag.id}_${Date.now()}`,
      areaId: isGeoView ? '00_japan' : area.id,
      areaName: `タグ「${tag.name}」`,
      modeId: `tag_${tag.id}_${playKind}`,
      modeLabel: 'クイズ（タグ練習）',
      playKind,
      mapScope,
      geoCategory: geoAreaDef?.geoCategory,
      prefFilterCodes: !isGeoView && area.prefCode ? [area.prefCode] : undefined,
      regionFilter:
        !isGeoView && area.id === '00_japan_cities' ? 'cities_all' : undefined,
      questionCount: ids.length,
      maxCount: ids.length,
      isCustomOrRandom: true,
      fixedPieceIds: ids,
    });
  };

  return (
    <div className="map-screen-root">
      <header className="view-topbar">
        <div className="view-left">
          <button type="button" className="hud-btn hud-btn-ghost" onClick={onGoTitle}>
            {returnLabel}
          </button>
          <select
            className="view-area-select"
            value={selectedAreaId}
            onChange={(e) => {
              setSelectedAreaId(e.target.value);
              setSelectedPiece(null);
              setQuickQuery('');
              setSearchOpen(false);
            }}
            aria-label="閲覧エリア選択"
          >
            <optgroup label="全国">
              {nationalAreas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}（{a.totalCount.toLocaleString()}件）
                </option>
              ))}
            </optgroup>
            <optgroup label="日本の自然地理100選">
              {GEOGRAPHY_VIEW_AREAS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}（{g.approxCount}件）
                </option>
              ))}
            </optgroup>
            {PREF_REGION_GROUPS.map((rg) => (
              <optgroup key={rg.id} label={rg.label}>
                {rg.prefCodes.map((code) => {
                  const p = prefByCode.get(code);
                  if (!p) return null;
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name}（{p.totalCount.toLocaleString()}件）
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>

          <div className="view-quick-search" style={{ position: 'relative' }}>
            <input
              ref={searchInputRef}
              type="search"
              placeholder="地名検索 (/)"
              aria-label="表示中の地図から地名を検索して移動"
              value={quickQuery}
              disabled={!loadedMap}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => {
                window.setTimeout(() => setSearchOpen(false), 160);
              }}
              onChange={(e) => {
                setQuickQuery(e.target.value);
                setSearchOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && quickSearchResults.length > 0) {
                  e.preventDefault();
                  focusPiece(quickSearchResults[0]);
                  setQuickQuery('');
                  setSearchOpen(false);
                }
              }}
            />
            {searchOpen && quickQuery.trim() && (
              <div
                role="listbox"
                aria-label="検索候補"
                className="view-quick-search-dropdown"
              >
                {quickSearchResults.length === 0 ? (
                  <div className="muted" style={{ padding: '8px 10px' }}>
                    該当なし
                  </div>
                ) : (
                  quickSearchResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      className="tag-piece-link"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        focusPiece(p);
                        setQuickQuery('');
                        setSearchOpen(false);
                      }}
                    >
                      <strong>{p.name}</strong>
                      <span className="muted">{p.ruby}</span>
                      {p.prefName && p.prefName !== p.name && (
                        <span className="muted">({p.prefName})</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="view-controls-row">
          <button
            type="button"
            className={`view-toggle-btn ${config.showBorder ? 'on' : ''}`}
            onClick={() => onConfigChange({ ...config, showBorder: !config.showBorder })}
          >
            {config.showBorder ? '境界線有り' : '境界線なし'}
          </button>
          {!isGeoView && (
            <button
              type="button"
              className={`view-toggle-btn ${!config.silhouette ? 'on' : ''}`}
              onClick={() => onConfigChange({ ...config, silhouette: !config.silhouette })}
            >
              {config.silhouette ? '白地図' : '色分け図'}
            </button>
          )}
          <button
            type="button"
            className={`view-toggle-btn ${showNames ? 'on' : ''}`}
            onClick={() => setShowNames((v) => !v)}
          >
            {showNames ? '名前あり' : '名前なし'}
          </button>
          {selectedAreaId === '00_japan' && (
            <>
              <button
                type="button"
                className={`view-toggle-btn ${showCapitalMarks ? 'on' : ''}`}
                onClick={() => setShowCapitalMarks((v) => !v)}
              >
                {showCapitalMarks ? '県庁マークあり' : '県庁なし'}
              </button>
              <button
                type="button"
                className={`view-toggle-btn ${swapCapitalLabel && showNames ? 'on' : ''}`}
                title={!showNames ? '名前表示をONにして県庁名を表示します' : '都道府県名と県庁名を切替'}
                onClick={() => {
                  if (!showNames) {
                    setShowNames(true);
                    setSwapCapitalLabel(true);
                  } else {
                    setSwapCapitalLabel((v) => !v);
                  }
                }}
              >
                {swapCapitalLabel && showNames ? '県庁名表示中' : '県庁←→都道府県'}
              </button>
            </>
          )}
          {onStartGame && (
            <button
              type="button"
              className="btn-warning btn-sm"
              disabled={!loadedMap}
              onClick={handlePlayCurrentArea}
            >
              ▶ このエリアで挑戦
            </button>
          )}
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => setShowDataModal(true)}
            disabled={!loadedMap}
          >
            📊 データ一覧
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setShowTagModal(true)}
            disabled={!loadedMap}
          >
            🏷 タグ一覧
          </button>
        </div>
      </header>

      <div className={`map-stage ${jumpKind === 'japan' ? 'has-jump-bar' : ''}`}>
        {jumpKind === 'japan' && (
          <div className="hud-jump-bar view-jump-bar">
            <button
              type="button"
              className="jump-chip-btn"
              onClick={() => loadedMap && fitBBox(loadedMap.viewBBox)}
            >
              全国
            </button>
            {japanJumps.map((j) => (
              <button
                key={j.id}
                type="button"
                className="jump-chip-btn"
                onClick={() => animateToBBox(getJapanRegionBBox(j.id))}
              >
                {j.short}
              </button>
            ))}
          </div>
        )}

        {/* Left-side Zoom Control */}
        <div className="hud-zoom-rail">
          <button
            type="button"
            className="zoom-step-btn"
            title="拡大 (+)"
            aria-label="拡大"
            disabled={zoomRatio >= MAX_ZOOM_RATIO * 0.99}
            onClick={() => zoomByFactor(1.4)}
          >
            ＋
          </button>
          <div className="zoom-slider-wrap">
            <input
              type="range"
              min={0}
              max={100}
              value={sliderVal}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              className="zoom-vertical-slider"
              aria-label="ズーム倍率"
            />
          </div>
          <button
            type="button"
            className="zoom-step-btn"
            title="縮小 (-)"
            aria-label="縮小"
            disabled={zoomRatio <= effectiveMinZoom * 1.01}
            onClick={() => zoomByFactor(1 / 1.4)}
          >
            −
          </button>
          <span className="zoom-readout" aria-label="現在のズーム倍率">
            {zoomReadout}
          </span>
          <button
            type="button"
            className="zoom-reset-btn"
            title="全体表示に戻す (0)"
            aria-label="全体表示に戻す"
            onClick={() => loadedMap && fitBBox(loadedMap.viewBBox)}
          >
            全体
          </button>
        </div>

        {loading || !loadedMap ? (
          <div className="map-loading-state">精巧な白地図データを読み込み中...</div>
        ) : (
          <MapCanvas
            svgRef={svgRef}
            viewBox={viewBox}
            viewBoxString={viewBoxString}
            targetPieces={loadedMap.targetPieces}
            contextPieces={loadedMap.contextPieces}
            bgPrefPieces={loadedMap.bgPrefPieces}
            insets={loadedMap.insets}
            completedIds={completedSet}
            activePieceId={null}
            hintPieceId={null}
            selectedPieceId={selectedPiece?.id ?? null}
            config={config}
            tags={tags}
            forceShowNames={showNames}
            showCapitalMarks={selectedAreaId === '00_japan' && showCapitalMarks}
            swapCapitalLabel={selectedAreaId === '00_japan' && swapCapitalLabel}
            isTerrainMode={isGeoView}
            enablePrefHoverTooltip={true}
            enablePrefTint={!isGeoView}
            onPieceClick={setSelectedPiece}
            onPanBy={panByScreenDelta}
            onFinishPan={finishPan}
            onZoomByFactor={zoomByFactor}
          />
        )}

        {selectedPiece && (
          <div className="hud-info-card view-info-card">
            <div className="hud-info-header">
              <div>
                <div className="hud-info-ruby">{selectedPiece.ruby}</div>
                <div className="hud-info-name">
                  {selectedPiece.name}
                  {selectedPiece.prefName && selectedPiece.prefName !== selectedPiece.name && (
                    <span className="hud-info-pref">（{selectedPiece.prefName}）</span>
                  )}
                </div>
              </div>
              <div className="hud-info-head-actions">
                {selectedPiece.wiki && (
                  <a
                    href={selectedPiece.wiki}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hud-wiki-link"
                  >
                    Wikipedia ↗
                  </a>
                )}
                <button
                  type="button"
                  className="hud-info-close"
                  aria-label="情報カードを閉じる"
                  onClick={() => setSelectedPiece(null)}
                >
                  ✕
                </button>
              </div>
            </div>

            {selectedPiece.desc && (
              <div className="hud-info-desc">
                {selectedPiece.desc}
              </div>
            )}

            <div className="hud-info-meta">
              {!isGeoView && (
                <span>コード: {selectedPiece.id.replace('pref_', '')}</span>
              )}
              {selectedPiece.population > 0 && (
                <span>人口: {selectedPiece.population.toLocaleString()}人</span>
              )}
              {selectedPiece.areaKm2 > 0 && (
                <span>面積: {selectedPiece.areaKm2.toLocaleString()} km²</span>
              )}
              {selectedPiece.adminAreaLabel && (
                <span>
                  {selectedAreaId === '00_japan' ? '県庁:' : isGeoView ? '分類:' : '区分:'}{' '}
                  {selectedPiece.adminAreaLabel}
                  {selectedPrefCapitalRuby ? `（${selectedPrefCapitalRuby}）` : ''}
                </span>
              )}
              {selectedPiece.countyLabel && <span>{selectedPiece.countyLabel}</span>}
            </div>

            <div className="hud-tag-row">
              <span className="hud-tag-title">タグ:</span>
              {tags.map((t) => {
                const active = t.pieceIds.includes(selectedPiece.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`hud-tag-chip ${active ? 'active' : ''}`}
                    onClick={() => onTogglePieceTag(t.id, selectedPiece.id)}
                  >
                    {active ? '✓ ' : '+ '}
                    {t.name}
                  </button>
                );
              })}
              <button
                type="button"
                className="hud-tag-manage-btn"
                onClick={() => setShowTagModal(true)}
              >
                タグ管理
              </button>
            </div>
          </div>
        )}
      </div>

      {showDataModal && loadedMap && (
        <DataTableModal
          title={currentViewTitle}
          pieces={loadedMap.targetPieces}
          onSelectPiece={focusPiece}
          onClose={() => setShowDataModal(false)}
        />
      )}

      {showTagModal && loadedMap && (
        <TagManagerModal
          tags={tags}
          allPieces={loadedMap.targetPieces}
          extraPieceLabels={allKnownPieces}
          onCreateTag={onCreateTag}
          onRenameTag={onRenameTag}
          onToggleLock={onToggleLockTag}
          onDeleteTag={onDeleteTag}
          onTogglePieceTag={onTogglePieceTag}
          onSelectPiece={focusPiece}
          onPracticeTag={onStartGame ? handlePracticeTag : undefined}
          onClose={() => setShowTagModal(false)}
        />
      )}
    </div>
  );
};
