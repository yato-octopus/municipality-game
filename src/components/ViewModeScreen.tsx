import React, { useMemo, useState } from 'react';
import {
  JAPAN_REGION_JUMPS,
  WORLD_REGION_JUMPS,
} from '../data/gameCatalog';
import { useMapViewport } from '../hooks/useMapViewport';
import { loadSessionMap } from '../services/mapDataLoader';
import { getJapanRegionBBox } from '../services/regionJumpUtils';
import type { LoadedSessionMap } from '../services/mapDataLoader';
import type {
  AreaDefinition,
  ConfigState,
  GameSessionSpec,
  MapPieceItem,
  MapTag,
} from '../types/game';
import { DataTableModal } from './DataTableModal';
import { MapCanvas } from './MapCanvas';
import { TagManagerModal } from './TagManagerModal';

interface ViewModeScreenProps {
  initialAreaId: string;
  areas: AreaDefinition[];
  config: ConfigState;
  tags: MapTag[];
  onConfigChange: (next: ConfigState) => void;
  onTogglePieceTag: (tagId: string, pieceId: string) => void;
  onCreateTag: (name: string) => void;
  onRenameTag: (tagId: string, name: string) => void;
  onToggleLockTag: (tagId: string) => void;
  onDeleteTag: (tagId: string) => void;
  onGoTitle: () => void;
}

export const ViewModeScreen: React.FC<ViewModeScreenProps> = ({
  initialAreaId,
  areas,
  config,
  tags,
  onConfigChange,
  onTogglePieceTag,
  onCreateTag,
  onRenameTag,
  onToggleLockTag,
  onDeleteTag,
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

  const area = useMemo(
    () => areas.find((a) => a.id === selectedAreaId) ?? areas[0],
    [areas, selectedAreaId],
  );

  const loadedMap = loadedState?.areaId === area.id ? loadedState.map : null;
  const loading = loadedMap === null;

  React.useEffect(() => {
    let active = true;
    const spec: GameSessionSpec = {
      sessionId: `view_${area.id}`,
      areaId: area.id,
      areaName: area.name,
      modeId: `view_${area.id}`,
      modeLabel: '閲覧',
      playKind: 'view',
      mapScope:
        area.id === 'world'
          ? 'world'
          : area.id === '00_japan'
            ? 'japan_prefs'
            : 'japan_munis',
      prefFilterCodes: area.prefCode ? [area.prefCode] : undefined,
      questionCount: area.totalCount,
      maxCount: area.totalCount,
      isCustomOrRandom: false,
    };
    void loadSessionMap(spec).then((res) => {
      if (!active) return;
      setLoadedState({ areaId: area.id, map: res });
    });
    return () => {
      active = false;
    };
  }, [area]);

  const initialBBox = loadedMap?.viewBBox ?? [22, 34, 940, 920];
  const {
    svgRef,
    viewBox,
    viewBoxString,
    fitBBox,
    animateToBBox,
    zoomByFactor,
    panByScreenDelta,
    finishPan,
  } = useMapViewport({
    initialBBox,
    dragInertia: config.dragInertia,
    fpsMode: config.fpsMode,
  });

  const completedSet = useMemo(() => new Set<string>(), []);

  const focusPiece = (p: MapPieceItem) => {
    setSelectedPiece(p);
    const w = Math.max(12, (p.bbox[2] - p.bbox[0]) * 3.5);
    const h = Math.max(12, (p.bbox[3] - p.bbox[1]) * 3.5);
    const cx = p.center[0];
    const cy = p.center[1];
    animateToBBox([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]);
  };

  const jumpKind =
    area.id === 'world'
      ? 'world'
      : area.id === '00_japan' || area.id === '00_japan_all'
        ? 'japan'
        : 'none';

  const japanJumps = config.reverseJumpButtons
    ? [...JAPAN_REGION_JUMPS].reverse()
    : JAPAN_REGION_JUMPS;
  const worldJumps = config.reverseJumpButtons
    ? [...WORLD_REGION_JUMPS].reverse()
    : WORLD_REGION_JUMPS;

  return (
    <div className="map-screen-root">
      <header className="view-topbar">
        <div className="view-left">
          <button type="button" className="hud-btn hud-btn-ghost" onClick={onGoTitle}>
            ← タイトル
          </button>
          <select
            className="view-area-select"
            value={area.id}
            onChange={(e) => {
              setSelectedAreaId(e.target.value);
              setSelectedPiece(null);
            }}
            aria-label="閲覧エリア選択"
          >
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}（{a.totalCount.toLocaleString()}件）
              </option>
            ))}
          </select>
        </div>

        <div className="view-controls-row">
          <button
            type="button"
            className={`view-toggle-btn ${config.showBorder ? 'on' : ''}`}
            onClick={() => onConfigChange({ ...config, showBorder: !config.showBorder })}
          >
            {config.showBorder ? '境界線有り' : '境界線なし'}
          </button>
          <button
            type="button"
            className={`view-toggle-btn ${!config.silhouette ? 'on' : ''}`}
            onClick={() => onConfigChange({ ...config, silhouette: !config.silhouette })}
          >
            {config.silhouette ? 'シルエット' : '標高図'}
          </button>
          <button
            type="button"
            className={`view-toggle-btn ${showNames ? 'on' : ''}`}
            onClick={() => setShowNames((v) => !v)}
          >
            {showNames ? '名前あり' : '名前なし'}
          </button>
          {area.id === '00_japan' && (
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
                className={`view-toggle-btn ${swapCapitalLabel ? 'on' : ''}`}
                onClick={() => setSwapCapitalLabel((v) => !v)}
              >
                {swapCapitalLabel ? '県庁名表示中' : '県庁←→都道府県'}
              </button>
            </>
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
          >
            🏷 タグ一覧
          </button>
        </div>
      </header>

      {jumpKind !== 'none' && (
        <div className="hud-jump-bar view-jump-bar">
          {jumpKind === 'japan'
            ? japanJumps.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  className="jump-chip-btn"
                  onClick={() => animateToBBox(getJapanRegionBBox(j.id))}
                >
                  {j.short}
                </button>
              ))
            : worldJumps.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  className="jump-chip-btn"
                  onClick={() => animateToBBox(j.bbox)}
                >
                  {j.label}
                </button>
              ))}
        </div>
      )}

      {/* Left-side Zoom Control */}
      <div className="hud-zoom-rail">
        <button
          type="button"
          className="zoom-step-btn"
          onClick={() => zoomByFactor(1.4)}
        >
          ＋
        </button>
        <button
          type="button"
          className="zoom-step-btn"
          onClick={() => zoomByFactor(1 / 1.4)}
        >
          −
        </button>
        <button
          type="button"
          className="zoom-reset-btn"
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
          showCapitalMarks={showCapitalMarks}
          swapCapitalLabel={swapCapitalLabel}
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
                onClick={() => setSelectedPiece(null)}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="hud-info-meta">
            <span>コード: {selectedPiece.id.replace('pref_', '')}</span>
            {selectedPiece.population > 0 && (
              <span>人口: {selectedPiece.population.toLocaleString()}人</span>
            )}
            {selectedPiece.areaKm2 > 0 && (
              <span>面積: {selectedPiece.areaKm2.toLocaleString()} km²</span>
            )}
            {selectedPiece.adminAreaLabel && (
              <span>
                {area.id === '00_japan' ? '県庁:' : '区分:'} {selectedPiece.adminAreaLabel}
              </span>
            )}
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

      {showDataModal && loadedMap && (
        <DataTableModal
          title={area.name}
          pieces={loadedMap.targetPieces}
          onSelectPiece={focusPiece}
          onClose={() => setShowDataModal(false)}
        />
      )}

      {showTagModal && loadedMap && (
        <TagManagerModal
          tags={tags}
          allPieces={loadedMap.targetPieces}
          onCreateTag={onCreateTag}
          onRenameTag={onRenameTag}
          onToggleLock={onToggleLockTag}
          onDeleteTag={onDeleteTag}
          onSelectPiece={focusPiece}
          onClose={() => setShowTagModal(false)}
        />
      )}
    </div>
  );
};
