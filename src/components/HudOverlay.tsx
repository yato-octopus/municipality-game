import React from 'react';
import { JAPAN_REGION_JUMPS, WORLD_REGION_JUMPS } from '../data/gameCatalog';
import { getJapanRegionBBox } from '../services/regionJumpUtils';
import { formatTimeMs } from '../utils/formatters';
import type { BBox, ConfigState, MapPieceItem, MapTag } from '../types/game';

interface HudOverlayProps {
  title: string;
  modeLabel: string;
  elapsedMs: number;
  misses: number;
  completedCount: number;
  totalCount: number;
  config: ConfigState;
  zoomRatio: number;
  showJumpButtons: 'japan' | 'world' | 'none';
  isCustomOrRandom: boolean;
  inspectedPiece: MapPieceItem | null;
  tags: MapTag[];
  readyStage: 'ready' | 'go' | 'playing';
  onZoomChange: (nextZoom: number) => void;
  onJumpToBBox: (bbox: BBox) => void;
  onResetZoom: () => void;
  onOpenConfig: () => void;
  onOpenSave?: () => void;
  onBack: () => void;
  onCloseInfo: () => void;
  onTogglePieceTag: (tagId: string, pieceId: string) => void;
  onOpenTagManager: () => void;
}

export const HudOverlay: React.FC<HudOverlayProps> = ({
  title,
  modeLabel,
  elapsedMs,
  misses,
  completedCount,
  totalCount,
  config,
  zoomRatio,
  showJumpButtons,
  isCustomOrRandom,
  inspectedPiece,
  tags,
  readyStage,
  onZoomChange,
  onJumpToBBox,
  onResetZoom,
  onOpenConfig,
  onOpenSave,
  onBack,
  onCloseInfo,
  onTogglePieceTag,
  onOpenTagManager,
}) => {
  const japanJumps = config.reverseJumpButtons
    ? [...JAPAN_REGION_JUMPS].reverse()
    : JAPAN_REGION_JUMPS;
  const worldJumps = config.reverseJumpButtons
    ? [...WORLD_REGION_JUMPS].reverse()
    : WORLD_REGION_JUMPS;

  const sliderVal = Math.max(0, Math.min(100, Math.round((Math.log(Math.max(0.65, zoomRatio) / 0.65) / Math.log(48 / 0.65)) * 100)));

  const handleSliderChange = (val: number) => {
    const nextZoom = 0.65 * Math.pow(48 / 0.65, val / 100);
    onZoomChange(nextZoom);
  };

  return (
    <>
      {/* Top HUD Bar */}
      <header className="hud-topbar">
        <div className="hud-left-group">
          <button type="button" className="hud-btn hud-btn-ghost" onClick={onBack}>
            ← 戻る
          </button>
          <div className="hud-title-block">
            <span className="hud-area-title">{title}</span>
            <span className="hud-mode-badge">{modeLabel}</span>
          </div>
        </div>

        <div className="hud-stats-group">
          <div className="hud-stat">
            <span className="hud-stat-label">進捗</span>
            <strong className="hud-stat-val">
              {completedCount} / {totalCount}
            </strong>
          </div>
          <div className="hud-stat">
            <span className="hud-stat-label">Miss</span>
            <strong className="hud-stat-val hud-miss-val">{misses}</strong>
          </div>
          {config.showTime && (
            <div className="hud-stat">
              <span className="hud-stat-label">Time</span>
              <strong className="hud-stat-val hud-time-val">{formatTimeMs(elapsedMs)}</strong>
            </div>
          )}
        </div>

        <div className="hud-actions-group">
          {!isCustomOrRandom && onOpenSave && (
            <button type="button" className="hud-btn" onClick={onOpenSave}>
              セーブ
            </button>
          )}
          <button type="button" className="hud-btn hud-btn-primary" onClick={onOpenConfig}>
            ⚙ メニュー
          </button>
        </div>
      </header>

      {/* Left-side Zoom Control */}
      <div className="hud-zoom-rail">
        <button
          type="button"
          className="zoom-step-btn"
          title="拡大"
          onClick={() => onZoomChange(zoomRatio * 1.4)}
        >
          ＋
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={sliderVal}
          onChange={(e) => handleSliderChange(Number(e.target.value))}
          className="zoom-vertical-slider"
          aria-label="ズーム倍率"
        />
        <button
          type="button"
          className="zoom-step-btn"
          title="縮小"
          onClick={() => onZoomChange(zoomRatio / 1.4)}
        >
          −
        </button>
        <button
          type="button"
          className="zoom-reset-btn"
          title="全体表示に戻す"
          onClick={onResetZoom}
        >
          全体
        </button>
      </div>

      {/* Region Jump Bar (Japan / World) */}
      {showJumpButtons !== 'none' && (
        <div className="hud-jump-bar">
          {showJumpButtons === 'japan'
            ? japanJumps.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  className="jump-chip-btn"
                  onClick={() => onJumpToBBox(getJapanRegionBBox(j.id))}
                >
                  {j.short}
                </button>
              ))
            : worldJumps.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  className="jump-chip-btn"
                  onClick={() => onJumpToBBox(j.bbox)}
                >
                  {j.label}
                </button>
              ))}
        </div>
      )}

      {/* Piece Info + MemoTag Window */}
      {config.showPieceInfo && inspectedPiece && (
        <div className="hud-info-card">
          <div className="hud-info-header">
            <div>
              <div className="hud-info-ruby">{inspectedPiece.ruby}</div>
              <div className="hud-info-name">
                {inspectedPiece.name}
                {inspectedPiece.prefName && inspectedPiece.prefName !== inspectedPiece.name && (
                  <span className="hud-info-pref">（{inspectedPiece.prefName}）</span>
                )}
              </div>
            </div>
            <div className="hud-info-head-actions">
              {inspectedPiece.wiki && (
                <a
                  href={inspectedPiece.wiki}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hud-wiki-link"
                >
                  Wikipedia ↗
                </a>
              )}
              <button type="button" className="hud-info-close" onClick={onCloseInfo}>
                ✕
              </button>
            </div>
          </div>

          <div className="hud-info-meta">
            {inspectedPiece.population > 0 && (
              <span>人口: {inspectedPiece.population.toLocaleString()}人</span>
            )}
            {inspectedPiece.areaKm2 > 0 && (
              <span>面積: {inspectedPiece.areaKm2.toLocaleString()} km²</span>
            )}
            {inspectedPiece.regionLabel && <span>地域: {inspectedPiece.regionLabel}</span>}
            {inspectedPiece.countyLabel && <span>{inspectedPiece.countyLabel}</span>}
          </div>

          {config.showTag && (
            <div className="hud-tag-row">
              <span className="hud-tag-title">タグ:</span>
              {tags.map((t) => {
                const active = t.pieceIds.includes(inspectedPiece.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`hud-tag-chip ${active ? 'active' : ''}`}
                    onClick={() => onTogglePieceTag(t.id, inspectedPiece.id)}
                  >
                    {active ? '✓ ' : '+ '}
                    {t.name}
                  </button>
                );
              })}
              <button
                type="button"
                className="hud-tag-manage-btn"
                onClick={onOpenTagManager}
              >
                タグ管理
              </button>
            </div>
          )}
        </div>
      )}

      {/* Ready -> Go! Countdown */}
      {readyStage !== 'playing' && (
        <div className="ready-overlay">
          <div className={`ready-banner ${readyStage === 'go' ? 'is-go' : ''}`}>
            {readyStage === 'ready' ? 'Ready...' : 'Go!'}
          </div>
        </div>
      )}
    </>
  );
};
