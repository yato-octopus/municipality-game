import React, { useEffect, useRef, useState } from 'react';
import { JAPAN_REGION_JUMPS } from '../data/gameCatalog';
import { MAX_ZOOM_RATIO, MIN_ZOOM_RATIO } from '../hooks/useMapViewport';
import { getJapanRegionBBox } from '../services/regionJumpUtils';
import { formatTimeShortMs } from '../utils/formatters';
import type { BBox, ConfigState, MapPieceItem, MapTag } from '../types/game';

interface LiveClockProps {
  baseElapsedMs: number;
  runningSinceMs: number | null;
  running: boolean;
}

const LiveClock: React.FC<LiveClockProps> = React.memo(
  ({ baseElapsedMs, runningSinceMs, running }) => {
    const [nowMs, setNowMs] = useState<number>(() =>
      runningSinceMs != null ? runningSinceMs : 0,
    );

    useEffect(() => {
      if (!running || runningSinceMs == null) return;
      const id = window.setInterval(() => {
        setNowMs(performance.now());
      }, 500);
      return () => window.clearInterval(id);
    }, [running, runningSinceMs]);

    const displayMs =
      running && runningSinceMs != null
        ? baseElapsedMs + Math.max(0, nowMs - runningSinceMs)
        : baseElapsedMs;

    return (
      <div className="hud-stat">
        <span className="hud-stat-label">Time</span>
        <strong className="hud-stat-val hud-time-val">{formatTimeShortMs(displayMs)}</strong>
      </div>
    );
  },
);

export interface HudOverlayProps {
  title: string;
  modeLabel: string;
  elapsedMs?: number;
  baseElapsedMs?: number;
  runningSinceMs?: number | null;
  timerRunning?: boolean;
  misses: number;
  hintsUsed: number;
  completedCount: number;
  cleanCompletedCount?: number;
  wrongCompletedCount?: number;
  totalCount: number;
  config: ConfigState;
  zoomRatio: number;
  minZoomRatio?: number;
  showJumpButtons: 'japan' | 'none';
  isCustomOrRandom: boolean;
  requireBackConfirm?: boolean;
  inspectedPiece: MapPieceItem | null;
  lastAnsweredPiece?: MapPieceItem | null;
  tags: MapTag[];
  readyStage: 'ready' | 'go' | 'playing';
  stageRef?: React.RefCallback<HTMLDivElement>;
  children?: React.ReactNode;
  onZoomChange: (nextZoom: number) => void;
  onZoomByFactor?: (factor: number) => void;
  onJumpToBBox: (bbox: BBox) => void;
  onResetZoom: () => void;
  onToggleMute?: () => void;
  onOpenConfig: () => void;
  onOpenSave?: () => void;
  onBack: () => void;
  onCloseInfo: () => void;
  onOpenLastAnswerInfo?: () => void;
  onDismissLastAnswer?: () => void;
  onSkipReady?: () => void;
  onTogglePieceTag: (tagId: string, pieceId: string) => void;
  onOpenTagManager: () => void;
}

export const HudOverlay: React.FC<HudOverlayProps> = ({
  title,
  modeLabel,
  elapsedMs = 0,
  baseElapsedMs,
  runningSinceMs = null,
  timerRunning = false,
  misses,
  hintsUsed,
  completedCount,
  cleanCompletedCount,
  wrongCompletedCount,
  totalCount,
  config,
  zoomRatio,
  minZoomRatio = MIN_ZOOM_RATIO,
  showJumpButtons,
  isCustomOrRandom,
  requireBackConfirm = false,
  inspectedPiece,
  lastAnsweredPiece = null,
  tags,
  readyStage,
  stageRef,
  children,
  onZoomChange,
  onZoomByFactor,
  onJumpToBBox,
  onResetZoom,
  onToggleMute,
  onOpenConfig,
  onOpenSave,
  onBack,
  onCloseInfo,
  onOpenLastAnswerInfo,
  onDismissLastAnswer,
  onSkipReady,
  onTogglePieceTag,
  onOpenTagManager,
}) => {
  const [confirmingBack, setConfirmingBack] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current != null) window.clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const showConfirmBack = requireBackConfirm && confirmingBack;

  const handleBackClick = () => {
    if (!requireBackConfirm) {
      onBack();
      return;
    }
    if (showConfirmBack) {
      if (confirmTimerRef.current != null) {
        window.clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
      setConfirmingBack(false);
      onBack();
      return;
    }
    setConfirmingBack(true);
    if (confirmTimerRef.current != null) window.clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = window.setTimeout(() => {
      setConfirmingBack(false);
      confirmTimerRef.current = null;
    }, 4500);
  };

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
    onZoomChange(nextZoom);
  };

  const isMuted = config.seVolume <= 0 || !config.fixActionSound;
  const resolvedBaseMs = baseElapsedMs ?? elapsedMs;
  const safeTotal = Math.max(1, totalCount);
  const wrongPct =
    totalCount > 0 ? Math.min(100, ((wrongCompletedCount ?? 0) / safeTotal) * 100) : 0;
  const cleanCount =
    cleanCompletedCount != null
      ? cleanCompletedCount
      : Math.max(0, completedCount - (wrongCompletedCount ?? 0));
  const cleanPct =
    totalCount > 0 ? Math.min(100 - wrongPct, (cleanCount / safeTotal) * 100) : 0;

  const zoomReadoutText =
    zoomRatio >= 10 ? `${Math.round(zoomRatio)}×` : `${zoomRatio.toFixed(1)}×`;
  const atMaxZoom = zoomRatio >= MAX_ZOOM_RATIO * 0.99;
  const atMinZoom = zoomRatio <= effectiveMinZoom * 1.01;

  const hasCapitalAnswer = Boolean(
    inspectedPiece &&
      inspectedPiece.answerKanji &&
      inspectedPiece.answerKanji !== inspectedPiece.name,
  );
  const infoDesc =
    inspectedPiece?.desc && !inspectedPiece.desc.endsWith('の県庁所在地は？')
      ? inspectedPiece.desc
      : null;

  const lastDisplayKanji = lastAnsweredPiece
    ? (lastAnsweredPiece.answerKanji ?? lastAnsweredPiece.name)
    : '';
  const lastDisplayRuby = lastAnsweredPiece
    ? (lastAnsweredPiece.answerRuby ?? lastAnsweredPiece.ruby)
    : '';
  const lastPrefSuffix =
    lastAnsweredPiece?.prefName && lastAnsweredPiece.prefName !== lastDisplayKanji
      ? `・${lastAnsweredPiece.prefName}`
      : '';

  return (
    <>
      {/* Top HUD Bar */}
      <header className="hud-topbar">
        <div className="hud-left-group">
          {showConfirmBack ? (
            <>
              <button
                type="button"
                className="hud-btn confirm-inline-btn"
                onClick={handleBackClick}
              >
                途中終了する？
              </button>
              <button
                type="button"
                className="hud-btn hud-btn-ghost"
                aria-label="終了をキャンセル"
                onClick={() => setConfirmingBack(false)}
              >
                ✕
              </button>
            </>
          ) : (
            <button type="button" className="hud-btn hud-btn-ghost" onClick={handleBackClick}>
              ← 戻る
            </button>
          )}
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
          <div className="hud-stat">
            <span className="hud-stat-label">ヒント</span>
            <strong className="hud-stat-val hud-hint-val">{hintsUsed}</strong>
          </div>
          {config.showTime && (
            <LiveClock
              baseElapsedMs={resolvedBaseMs}
              runningSinceMs={runningSinceMs}
              running={timerRunning}
            />
          )}
        </div>

        <div className="hud-actions-group">
          {onToggleMute && (
            <button
              type="button"
              className={`hud-btn hud-mute-btn ${isMuted ? 'is-muted' : ''}`}
              aria-label={isMuted ? '効果音をオンにする' : '効果音をミュートする'}
              aria-pressed={isMuted}
              title={isMuted ? '効果音OFF（タップでON）' : '効果音ON（タップでミュート）'}
              onClick={onToggleMute}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
          )}
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

      {/* Slim ambient progress bar */}
      <div
        className="hud-progress-track"
        role="progressbar"
        aria-label="学習進捗"
        aria-valuemin={0}
        aria-valuemax={totalCount}
        aria-valuenow={completedCount}
      >
        <div className="hud-progress-fill" style={{ width: `${cleanPct}%` }} />
        {wrongPct > 0 && (
          <div className="hud-progress-miss" style={{ width: `${wrongPct}%` }} />
        )}
      </div>

      {/* Relative map stage isolating all overlays below topbar */}
      <div
        ref={stageRef}
        className={`map-stage ${showJumpButtons === 'japan' ? 'has-jump-bar' : ''}`}
      >
        {children}

        {/* Region Jump Bar (Japan) */}
        {showJumpButtons === 'japan' && (
          <div className="hud-jump-bar" role="toolbar" aria-label="地方ジャンプ">
            <button
              type="button"
              className="jump-chip-btn"
              title="日本全体を表示"
              onClick={onResetZoom}
            >
              全国
            </button>
            {japanJumps.map((j) => (
              <button
                key={j.id}
                type="button"
                className="jump-chip-btn"
                onClick={() => onJumpToBBox(getJapanRegionBBox(j.id))}
              >
                {j.short}
              </button>
            ))}
          </div>
        )}

        {/* Left-side Zoom Control */}
        <div className="hud-zoom-rail" role="group" aria-label="マップズーム操作">
          <button
            type="button"
            className="zoom-step-btn"
            aria-label="拡大"
            title="拡大 (+)"
            disabled={atMaxZoom}
            onClick={() =>
              onZoomByFactor ? onZoomByFactor(1.4) : onZoomChange(zoomRatio * 1.4)
            }
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
            aria-label="縮小"
            title="縮小 (-)"
            disabled={atMinZoom}
            onClick={() =>
              onZoomByFactor ? onZoomByFactor(1 / 1.4) : onZoomChange(zoomRatio / 1.4)
            }
          >
            −
          </button>
          <span className="zoom-readout" aria-live="off">
            {zoomReadoutText}
          </span>
          <button
            type="button"
            className="zoom-reset-btn"
            aria-label="全体表示に戻す"
            title="全体表示に戻す (0)"
            onClick={onResetZoom}
          >
            全体
          </button>
        </div>

        {/* Non-blocking Last-Answer Pill (Quiz / Yomikata) */}
        {config.showPieceInfo && !inspectedPiece && lastAnsweredPiece && (
          <div className="hud-last-answer-pill" role="status" aria-live="polite">
            <span className="hud-last-answer-text">
              直前の正解: <strong>{lastDisplayKanji}</strong>
              {lastDisplayRuby && `（${lastDisplayRuby}）`}
              {lastPrefSuffix}
            </span>
            {onOpenLastAnswerInfo && (
              <button
                type="button"
                className="btn-secondary btn-xs"
                onClick={onOpenLastAnswerInfo}
              >
                詳細
              </button>
            )}
            {onDismissLastAnswer && (
              <button
                type="button"
                className="hud-info-close"
                aria-label="直前の正解表示を閉じる"
                onClick={onDismissLastAnswer}
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Piece Info + MemoTag Window */}
        {config.showPieceInfo && inspectedPiece && (
          <div className="hud-info-card" role="region" aria-label="地域詳細情報">
            <div className="hud-info-header">
              <div>
                <div className="hud-info-ruby">
                  {hasCapitalAnswer
                    ? `${inspectedPiece.answerRuby ?? ''} ・ ${inspectedPiece.name}（${inspectedPiece.ruby}）`
                    : inspectedPiece.ruby}
                </div>
                <div className="hud-info-name">
                  {hasCapitalAnswer ? inspectedPiece.answerKanji : inspectedPiece.name}
                  {hasCapitalAnswer ? (
                    <span className="hud-info-pref">（県庁所在地）</span>
                  ) : (
                    inspectedPiece.prefName &&
                    inspectedPiece.prefName !== inspectedPiece.name && (
                      <span className="hud-info-pref">（{inspectedPiece.prefName}）</span>
                    )
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
                <button
                  type="button"
                  className="hud-info-close"
                  aria-label="情報カードを閉じる"
                  onClick={onCloseInfo}
                >
                  ✕
                </button>
              </div>
            </div>

            {infoDesc && <p className="hud-info-desc">{infoDesc}</p>}

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

        {/* Ready -> Go! Countdown (click/key skippable) */}
        {readyStage !== 'playing' && (
          <div
            className="ready-overlay ready-go-overlay"
            role="status"
            aria-live="assertive"
            onClick={onSkipReady}
          >
            <div className={`ready-banner ${readyStage === 'go' ? 'is-go' : ''}`}>
              {readyStage === 'ready' ? 'Ready...' : 'Go!'}
            </div>
          </div>
        )}
      </div>
    </>
  );
};
