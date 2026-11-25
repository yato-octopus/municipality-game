import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMapViewport } from '../hooks/useMapViewport';
import { loadSessionMap, shuffleArray } from '../services/mapDataLoader';
import {
  playCompleteFanfare,
  playCorrectChime,
  playSnapBell,
  playWrongBuzz,
  triggerVibrate,
} from '../services/soundService';
import type { LoadedSessionMap } from '../services/mapDataLoader';
import type {
  BBox,
  ConfigState,
  GameSessionSpec,
  HintAreaOverlay,
  MapPieceItem,
  MapTag,
  MistakeEntry,
  SavedProgress,
} from '../types/game';
import { ConfigModal } from './ConfigModal';
import { HudOverlay } from './HudOverlay';
import { MapCanvas } from './MapCanvas';
import { PuzzleGame } from './PuzzleGame';
import { QuizGame } from './QuizGame';
import { ResultOverlay } from './ResultOverlay';
import { SaveSlotsModal } from './SaveSlotsModal';
import { TagManagerModal } from './TagManagerModal';
import { YomikataGame } from './YomikataGame';

interface GameSessionShellProps {
  spec: GameSessionSpec;
  restoredProgress: SavedProgress | null;
  config: ConfigState;
  tags: MapTag[];
  manualSaves: SavedProgress[];
  onConfigChange: (next: ConfigState) => void;
  onSaveAuto: (progress: SavedProgress | null) => void;
  onUpsertManualSave: (save: SavedProgress) => void;
  onDeleteManualSave: (slotId: string) => void;
  onLoadManualSave: (save: SavedProgress) => void;
  onRecordClear: (
    modeId: string,
    elapsedMs: number,
    misses: number,
    questionCount: number,
    maxCount: number,
    isCustomOrRandom: boolean,
  ) => { isNewBest: boolean };
  onRecordMistake: (
    entry: Omit<MistakeEntry, 'key' | 'missCount' | 'lastMissedAt'>,
  ) => void;
  onClearMistake: (modeId: string, pieceId: string) => void;
  onClearMistakeKeys: (keys: string[]) => void;
  onTogglePieceTag: (tagId: string, pieceId: string) => void;
  onCreateTag: (name: string) => void;
  onRenameTag: (tagId: string, name: string) => void;
  onToggleLockTag: (tagId: string) => void;
  onDeleteTag: (tagId: string) => void;
  onRestartSession: (nextSpec: GameSessionSpec) => void;
  onExitToTitle: () => void;
}

function computeHint1Area(
  piece: MapPieceItem,
  loadedMap: LoadedSessionMap,
  spec: GameSessionSpec,
): HintAreaOverlay {
  const vb = loadedMap.viewBBox;
  const mapSpan = Math.max(vb[2] - vb[0], vb[3] - vb[1], 16);
  const pieceSpan = Math.max(
    piece.bbox[2] - piece.bbox[0],
    piece.bbox[3] - piece.bbox[1],
    2,
  );

  let r: number;
  if (spec.mapScope === 'japan_prefs') {
    r = Math.min(130, Math.max(pieceSpan * 1.45, 88));
  } else if (mapSpan > 400) {
    r = Math.min(95, Math.max(pieceSpan * 2.6, 58));
  } else {
    r = Math.min(mapSpan * 0.28, Math.max(pieceSpan * 2.6, mapSpan * 0.16, 18));
  }

  let hash = 2166136261;
  for (let i = 0; i < piece.id.length; i += 1) {
    hash ^= piece.id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const angle = (((hash >>> 0) % 360) * Math.PI) / 180;
  const cx = piece.center[0] + Math.cos(angle) * r * 0.36;
  const cy = piece.center[1] + Math.sin(angle) * r * 0.36;

  return {
    pieceId: piece.id,
    cx,
    cy,
    r,
  };
}

export const GameSessionShell: React.FC<GameSessionShellProps> = ({
  spec,
  restoredProgress,
  config,
  tags,
  manualSaves,
  onConfigChange,
  onSaveAuto,
  onUpsertManualSave,
  onDeleteManualSave,
  onLoadManualSave,
  onRecordClear,
  onRecordMistake,
  onClearMistake,
  onClearMistakeKeys,
  onTogglePieceTag,
  onCreateTag,
  onRenameTag,
  onToggleLockTag,
  onDeleteTag,
  onRestartSession,
  onExitToTitle,
}) => {
  const [loadedMap, setLoadedMap] = useState<LoadedSessionMap | null>(null);
  const [orderedTargets, setOrderedTargets] = useState<MapPieceItem[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [sessionWrongIds, setSessionWrongIds] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [misses, setMisses] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);

  const [readyStage, setReadyStage] = useState<'ready' | 'go' | 'playing'>('ready');
  const [isCompleted, setIsCompleted] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);
  const [inspectingCompleted, setInspectingCompleted] = useState(false);

  const [selectedPiece, setSelectedPiece] = useState<MapPieceItem | null>(null);
  const [inspectedPiece, setInspectedPiece] = useState<MapPieceItem | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const [hintState, setHintState] = useState<{
    pieceId: string;
    stage: 0 | 1 | 2;
    area: HintAreaOverlay | null;
  } | null>(null);
  const [hintFittedPieceId, setHintFittedPieceId] = useState<string | null>(null);

  const hint2TimerRef = useRef<number | null>(null);
  const hintFittedTimerRef = useRef<number | null>(null);
  const hint2AdvancingPieceIdRef = useRef<string | null>(null);

  const [showConfig, setShowConfig] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);

  const svgElRef = useRef<SVGSVGElement | null>(null);
  const liveViewBoxListenersRef = useRef<Set<() => void>>(new Set());

  const handleLiveViewBoxChange = useCallback(() => {
    for (const listener of liveViewBoxListenersRef.current) {
      listener();
    }
  }, []);

  const subscribeLiveViewBox = useCallback((listener: () => void) => {
    liveViewBoxListenersRef.current.add(listener);
    return () => {
      liveViewBoxListenersRef.current.delete(listener);
    };
  }, []);

  const getSvgRect = useCallback(
    () => svgElRef.current?.getBoundingClientRect() ?? null,
    [],
  );

  useEffect(() => {
    return () => {
      if (hint2TimerRef.current != null) window.clearTimeout(hint2TimerRef.current);
      if (hintFittedTimerRef.current != null) window.clearTimeout(hintFittedTimerRef.current);
    };
  }, []);

  // Load session map geometry once per mounted session (App keys this component by spec.sessionId)
  useEffect(() => {
    let mounted = true;
    void loadSessionMap(spec).then((res) => {
      if (!mounted) return;
      setLoadedMap(res);

      let ordered: MapPieceItem[];
      if (restoredProgress && restoredProgress.spec.sessionId === spec.sessionId) {
        const mapById = new Map(res.targetPieces.map((p) => [p.id, p]));
        ordered = restoredProgress.targetPieceIds
          .map((id) => mapById.get(id))
          .filter((x): x is MapPieceItem => Boolean(x));
        if (ordered.length === 0) ordered = shuffleArray(res.targetPieces);
        const comp = new Set(restoredProgress.completedIds);
        setCompletedIds(comp);
        setSessionWrongIds(new Set(restoredProgress.sessionWrongIds ?? []));
        setElapsedMs(restoredProgress.elapsedMs);
        setMisses(restoredProgress.misses);
        setHintsUsed(restoredProgress.hintsUsed);
        const firstUn = ordered.findIndex((p) => !comp.has(p.id));
        setCurrentIndex(firstUn >= 0 ? firstUn : 0);
      } else {
        ordered = shuffleArray(res.targetPieces);
        setCompletedIds(new Set());
        setSessionWrongIds(new Set());
        setElapsedMs(0);
        setMisses(0);
        setHintsUsed(0);
        setCurrentIndex(0);
      }
      setOrderedTargets(ordered);
    });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.sessionId]);

  // Ready -> Go! transition once loaded
  useEffect(() => {
    if (!loadedMap) return;
    const t1 = window.setTimeout(() => setReadyStage('go'), 550);
    const t2 = window.setTimeout(() => setReadyStage('playing'), 950);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [loadedMap]);

  // Game stopwatch paused during overlays, countdown, and after completion
  const paused =
    !loadedMap ||
    readyStage !== 'playing' ||
    isCompleted ||
    showConfig ||
    showSaveModal ||
    showTagModal;

  useEffect(() => {
    if (paused) return;
    let last = performance.now();
    const intervalMs = config.fpsMode === 'low' ? 100 : 50;
    const id = window.setInterval(() => {
      const now = performance.now();
      setElapsedMs((prev) => prev + (now - last));
      last = now;
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [paused, config.fpsMode]);

  const initialBBox: BBox = loadedMap?.viewBBox ?? [22, 34, 940, 920];
  const {
    svgRef,
    viewBox,
    viewBoxString,
    zoomRatio,
    fitBBox,
    animateToBBox,
    zoomByFactor,
    setZoomAtPoint,
    panByScreenDelta,
    finishPan,
    clientToSvg,
    svgToContainerPoint,
    svgScalePxPerUnit,
  } = useMapViewport({
    initialBBox,
    dragInertia: config.dragInertia,
    fpsMode: config.fpsMode,
    onLiveViewBoxChange: handleLiveViewBoxChange,
  });

  const handleSvgRef = useCallback(
    (node: SVGSVGElement | null) => {
      svgElRef.current = node;
      svgRef(node);
    },
    [svgRef],
  );

  const elapsedMsRef = useRef(elapsedMs);
  useEffect(() => {
    elapsedMsRef.current = elapsedMs;
  }, [elapsedMs]);

  const buildProgressSnapshot = useCallback(
    (
      nextCompleted: Set<string>,
      nextWrong: Set<string>,
      nextIdx: number,
      nextMisses: number,
      nextHints: number,
      slotId = 'auto',
    ): SavedProgress => ({
      saveType: slotId === 'auto' ? 'auto' : 'manual',
      slotId,
      savedAt: Date.now(),
      title: `${spec.areaName} — ${spec.modeLabel}`,
      spec: {
        ...spec,
        fixedPieceIds: orderedTargets.map((p) => p.id),
      },
      targetPieceIds: orderedTargets.map((p) => p.id),
      completedIds: Array.from(nextCompleted),
      sessionWrongIds: Array.from(nextWrong),
      currentIndex: nextIdx,
      elapsedMs: elapsedMsRef.current,
      misses: nextMisses,
      hintsUsed: nextHints,
    }),
    [spec, orderedTargets],
  );

  // Auto-save on page hide/unload when setting is active or exiting
  const snapshotRef = useRef<() => SavedProgress | null>(() => null);
  useEffect(() => {
    snapshotRef.current = () => {
      if (spec.isCustomOrRandom || isCompleted || orderedTargets.length === 0) return null;
      return buildProgressSnapshot(
        completedIds,
        sessionWrongIds,
        currentIndex,
        misses,
        hintsUsed,
      );
    };
  });

  useEffect(() => {
    const flushAutoSave = () => {
      if (config.autoSaveTiming === 'on_exit') {
        const snap = snapshotRef.current();
        if (snap) onSaveAuto(snap);
      }
    };
    const onVisChange = () => {
      if (document.hidden) flushAutoSave();
    };
    document.addEventListener('visibilitychange', onVisChange);
    window.addEventListener('beforeunload', flushAutoSave);
    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
      window.removeEventListener('beforeunload', flushAutoSave);
    };
  }, [config.autoSaveTiming, onSaveAuto]);

  const activePiece = orderedTargets[currentIndex] ?? null;

  const focusPieceSmooth = useCallback(
    (piece: MapPieceItem) => {
      const vb = loadedMap?.viewBBox;
      const mapSpan = vb ? Math.max(vb[2] - vb[0], vb[3] - vb[1], 16) : 900;
      const pieceSpan = Math.max(
        piece.bbox[2] - piece.bbox[0],
        piece.bbox[3] - piece.bbox[1],
        1,
      );
      const minSpan = Math.min(115, mapSpan * 0.18);
      const maxSpan = mapSpan * 0.72;
      const targetSpan = Math.min(maxSpan, Math.max(pieceSpan * 4.2, minSpan));
      const [cx, cy] = piece.center;
      animateToBBox([
        cx - targetSpan / 2,
        cy - targetSpan / 2,
        cx + targetSpan / 2,
        cy + targetSpan / 2,
      ]);
    },
    [animateToBBox, loadedMap],
  );

  // Automatically focus active target on every question across all Quiz / GeographyQuiz / Yomikata modes
  useEffect(() => {
    if (
      !loadedMap ||
      !activePiece ||
      readyStage !== 'playing' ||
      spec.playKind === 'puzzle' ||
      isCompleted
    ) {
      return;
    }
    focusPieceSmooth(activePiece);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePiece?.id, loadedMap, readyStage, spec.playKind, isCompleted]);

  const persistMistakePiece = useCallback(
    (piece: MapPieceItem | null) => {
      if (!piece || spec.playKind === 'view') return;
      setSessionWrongIds((prev) => {
        if (prev.has(piece.id)) return prev;
        const next = new Set(prev);
        next.add(piece.id);
        return next;
      });
      onRecordMistake({
        pieceId: piece.id,
        pieceName: piece.answerKanji ?? piece.name,
        pieceRuby: piece.answerRuby ?? piece.ruby,
        prefCode: piece.prefCode,
        prefName: piece.prefName,
        areaId: spec.areaId,
        areaName: spec.areaName,
        modeId: spec.modeId,
        modeLabel: spec.modeLabel.replace(/（復習）$/, ''),
        playKind: spec.playKind,
        mapScope: spec.mapScope,
        geoCategory: spec.geoCategory,
        prefFilterCodes: spec.prefFilterCodes,
        regionFilter: spec.regionFilter,
      });
    },
    [spec, onRecordMistake],
  );

  const handlePieceSuccess = useCallback(
    (pieceId: string, options?: { keepHintFitted?: boolean }) => {
      if (completedIds.has(pieceId)) return;
      if (hint2TimerRef.current != null) {
        window.clearTimeout(hint2TimerRef.current);
        hint2TimerRef.current = null;
      }
      if (hint2AdvancingPieceIdRef.current === pieceId) {
        hint2AdvancingPieceIdRef.current = null;
      }
      const nextCompleted = new Set(completedIds);
      nextCompleted.add(pieceId);
      setCompletedIds(nextCompleted);
      setSelectedPiece(null);
      setHintState(null);
      if (!options?.keepHintFitted) {
        setHintFittedPieceId((cur) => (cur === pieceId ? null : cur));
      }

      // If answered cleanly (no mistake on this piece during this session), remove from saved mistake bank!
      if (!sessionWrongIds.has(pieceId)) {
        const sourceKeys = spec.reviewSourceKeys?.[pieceId];
        if (sourceKeys && sourceKeys.length > 0) {
          onClearMistakeKeys(sourceKeys);
        } else {
          onClearMistake(spec.modeId, pieceId);
        }
      }

      const pieceObj = orderedTargets.find((p) => p.id === pieceId) ?? null;
      if (pieceObj) setInspectedPiece(pieceObj);

      if (spec.playKind === 'puzzle') {
        playSnapBell(config.seVolume, config.fixActionSound);
      } else {
        playCorrectChime(config.seVolume, config.fixActionSound);
      }
      triggerVibrate(config.fixActionVibration, 35);

      if (nextCompleted.size >= orderedTargets.length) {
        setIsCompleted(true);
        playCompleteFanfare(config.seVolume, config.fixActionSound);
        const { isNewBest: newRec } = onRecordClear(
          spec.modeId,
          elapsedMsRef.current,
          misses,
          spec.questionCount,
          spec.maxCount,
          spec.isCustomOrRandom,
        );
        setIsNewBest(newRec);
        if (!spec.isCustomOrRandom) {
          onSaveAuto(null);
        }
        return;
      }

      const nextUnfinished = orderedTargets.findIndex(
        (p, idx) => idx > currentIndex && !nextCompleted.has(p.id),
      );
      const fallbackIdx =
        nextUnfinished >= 0
          ? nextUnfinished
          : orderedTargets.findIndex((p) => !nextCompleted.has(p.id));
      const resolvedNextIdx = Math.max(0, fallbackIdx);
      setCurrentIndex(resolvedNextIdx);

      if (!spec.isCustomOrRandom && config.autoSaveTiming === 'every_answer') {
        onSaveAuto(
          buildProgressSnapshot(
            nextCompleted,
            sessionWrongIds,
            resolvedNextIdx,
            misses,
            hintsUsed,
          ),
        );
      }
    },
    [
      completedIds,
      sessionWrongIds,
      orderedTargets,
      spec,
      config.seVolume,
      config.fixActionSound,
      config.fixActionVibration,
      config.autoSaveTiming,
      misses,
      hintsUsed,
      currentIndex,
      onClearMistake,
      onClearMistakeKeys,
      onRecordClear,
      onSaveAuto,
      buildProgressSnapshot,
    ],
  );

  const handlePieceSuccessRef = useRef(handlePieceSuccess);
  useEffect(() => {
    handlePieceSuccessRef.current = handlePieceSuccess;
  }, [handlePieceSuccess]);

  const handleMiss = useCallback(
    (piece: MapPieceItem | null) => {
      playWrongBuzz(config.seVolume);
      setMisses((m) => m + 1);
      persistMistakePiece(piece);
    },
    [config.seVolume, persistMistakePiece],
  );

  const remainingPieces = useMemo(
    () => orderedTargets.filter((p) => !completedIds.has(p.id)),
    [orderedTargets, completedIds],
  );

  const wrongPieces = useMemo(
    () => orderedTargets.filter((p) => sessionWrongIds.has(p.id)),
    [orderedTargets, sessionWrongIds],
  );

  const currentHintTargetId =
    spec.playKind === 'puzzle'
      ? (selectedPiece?.id ?? remainingPieces[0]?.id ?? null)
      : (activePiece?.id ?? null);

  const activeHintMatch =
    hintState && currentHintTargetId && hintState.pieceId === currentHintTargetId
      ? hintState
      : null;
  const hintStage: 0 | 1 | 2 = activeHintMatch?.stage ?? 0;
  const hintArea: HintAreaOverlay | null = activeHintMatch?.area ?? null;

  const handleHint1 = () => {
    if (config.disableHelpButton || isCompleted || !loadedMap) return;
    const hintTarget =
      spec.playKind === 'puzzle'
        ? selectedPiece ?? remainingPieces[0]
        : activePiece;
    if (!hintTarget) return;
    if (hintStage >= 1 && hintState?.pieceId === hintTarget.id) return;

    setHintsUsed((h) => h + 1);
    if (spec.playKind === 'puzzle' && !selectedPiece) {
      setSelectedPiece(hintTarget);
      setInspectedPiece(hintTarget);
    }
    setHintState({
      pieceId: hintTarget.id,
      stage: 1,
      area: computeHint1Area(hintTarget, loadedMap, spec),
    });
  };

  const handleHint2 = () => {
    if (config.disableHelpButton || isCompleted || !loadedMap) return;
    const hintTarget =
      spec.playKind === 'puzzle'
        ? selectedPiece ?? remainingPieces[0]
        : activePiece;
    if (!hintTarget || completedIds.has(hintTarget.id)) return;
    if (hintStage >= 2 && hintState?.pieceId === hintTarget.id) return;
    if (hint2AdvancingPieceIdRef.current === hintTarget.id) return;

    setHintsUsed((h) => h + 1);
    setHintState({
      pieceId: hintTarget.id,
      stage: 2,
      area: null,
    });
    setHintFittedPieceId(hintTarget.id);

    if (spec.playKind === 'puzzle') {
      if (hintFittedTimerRef.current != null) {
        window.clearTimeout(hintFittedTimerRef.current);
      }
      handlePieceSuccess(hintTarget.id, { keepHintFitted: true });
      hintFittedTimerRef.current = window.setTimeout(() => {
        setHintFittedPieceId((cur) => (cur === hintTarget.id ? null : cur));
        hintFittedTimerRef.current = null;
      }, 1500);
      return;
    }

    if (spec.playKind === 'quiz' || spec.playKind === 'geography_quiz') {
      hint2AdvancingPieceIdRef.current = hintTarget.id;
      if (hint2TimerRef.current != null) {
        window.clearTimeout(hint2TimerRef.current);
      }
      hint2TimerRef.current = window.setTimeout(() => {
        hint2TimerRef.current = null;
        handlePieceSuccessRef.current(hintTarget.id);
      }, 850);
    }
  };

  const handleBackConfirmExit = () => {
    if (!spec.isCustomOrRandom && !isCompleted && orderedTargets.length > 0) {
      onSaveAuto(
        buildProgressSnapshot(
          completedIds,
          sessionWrongIds,
          currentIndex,
          misses,
          hintsUsed,
        ),
      );
    }
    onExitToTitle();
  };

  const handleMapPieceClick = useCallback(
    (clicked: MapPieceItem) => {
      if (isCompleted) {
        setInspectedPiece(clicked);
        return;
      }
      if (spec.playKind === 'puzzle') {
        if (selectedPiece) {
          if (clicked.id === selectedPiece.id) {
            handlePieceSuccess(clicked.id);
          } else if (!completedIds.has(clicked.id)) {
            handleMiss(selectedPiece);
          }
          return;
        }
        if (completedIds.has(clicked.id)) {
          setInspectedPiece(clicked);
        }
        return;
      }
      if (completedIds.has(clicked.id)) {
        setInspectedPiece(clicked);
      }
    },
    [isCompleted, spec.playKind, selectedPiece, completedIds, handlePieceSuccess, handleMiss],
  );

  const handleStartMistakeReviewFromResult = () => {
    if (wrongPieces.length === 0) return;
    const ids = wrongPieces.map((p) => p.id);
    const cleanModeLabel = spec.modeLabel.replace(/（復習）$/, '');
    onRestartSession({
      ...spec,
      sessionId: `review_${spec.modeId}_${Date.now()}`,
      modeLabel: `${cleanModeLabel}（復習）`,
      questionCount: ids.length,
      maxCount: ids.length,
      isCustomOrRandom: true,
      isReviewMode: true,
      fixedPieceIds: ids,
    });
  };

  const showJumpButtons: 'japan' | 'none' =
    spec.areaId === '00_japan' ||
    spec.areaId === '00_japan_all' ||
    spec.areaId === '00_japan_cities' ||
    spec.mapScope === 'geography_100'
      ? 'japan'
      : 'none';

  const isTerrainMode = spec.mapScope === 'geography_100';
  const isPrefGuessMode = spec.mapScope === 'japan_prefs' && !spec.geoCategory;

  return (
    <div className={`map-screen-root ${spec.playKind === 'puzzle' ? 'has-tray' : 'has-bottom-panel'}`}>
      <HudOverlay
        title={spec.areaName}
        modeLabel={spec.modeLabel}
        elapsedMs={elapsedMs}
        misses={misses}
        hintsUsed={hintsUsed}
        completedCount={completedIds.size}
        totalCount={orderedTargets.length}
        config={config}
        zoomRatio={zoomRatio}
        showJumpButtons={showJumpButtons}
        isCustomOrRandom={spec.isCustomOrRandom}
        inspectedPiece={inspectedPiece}
        tags={tags}
        readyStage={readyStage}
        onZoomChange={(z) => setZoomAtPoint(z)}
        onJumpToBBox={(bbox) => animateToBBox(bbox)}
        onResetZoom={() => loadedMap && fitBBox(loadedMap.viewBBox)}
        onToggleNameOnFix={() =>
          onConfigChange({ ...config, nameOnFix: !config.nameOnFix })
        }
        onOpenConfig={() => setShowConfig(true)}
        onOpenSave={() => setShowSaveModal(true)}
        onBack={handleBackConfirmExit}
        onCloseInfo={() => setInspectedPiece(null)}
        onTogglePieceTag={onTogglePieceTag}
        onOpenTagManager={() => setShowTagModal(true)}
      />

      {!loadedMap ? (
        <div className="map-loading-state">精巧な白地図を生成中...</div>
      ) : (
        <MapCanvas
          svgRef={handleSvgRef}
          viewBox={viewBox}
          viewBoxString={viewBoxString}
          targetPieces={loadedMap.targetPieces}
          poolPieces={loadedMap.allPoolPieces}
          contextPieces={loadedMap.contextPieces}
          bgPrefPieces={loadedMap.bgPrefPieces}
          insets={loadedMap.insets}
          completedIds={completedIds}
          activePieceId={
            !isCompleted && spec.playKind !== 'puzzle' && activePiece ? activePiece.id : null
          }
          hintPieceId={null}
          hintArea={hintArea}
          hintFittedPieceId={hintFittedPieceId}
          selectedPieceId={isCompleted ? inspectedPiece?.id ?? null : null}
          config={config}
          tags={tags}
          showCapitalMarks={
            spec.geoCategory === 'capital_q' || spec.geoCategory === 'capital_y'
          }
          enablePrefHoverTooltip={!isPrefGuessMode}
          enablePrefTint={!isPrefGuessMode}
          hoverTargetId={hoverTargetId}
          isTerrainMode={isTerrainMode}
          onPieceClick={handleMapPieceClick}
          onPanBy={panByScreenDelta}
          onFinishPan={finishPan}
          onZoomByFactor={zoomByFactor}
        />
      )}

      {/* Play mode interaction panel */}
      {loadedMap && !isCompleted && readyStage === 'playing' && (
        <>
          {spec.playKind === 'puzzle' && (
            <PuzzleGame
              loadedMap={loadedMap}
              remainingPieces={remainingPieces}
              config={config}
              selectedPieceId={selectedPiece?.id ?? null}
              onSelectPiece={(p) => {
                if (p?.id !== selectedPiece?.id) {
                  setHintState(null);
                }
                setSelectedPiece(p);
                if (p) setInspectedPiece(p);
              }}
              onPlaceAttempt={(pieceId, hitSuccess) => {
                if (hitSuccess) {
                  handlePieceSuccess(pieceId);
                } else {
                  const p = orderedTargets.find((x) => x.id === pieceId) ?? null;
                  handleMiss(p);
                }
              }}
              onHoverTargetChange={setHoverTargetId}
              onHint1={handleHint1}
              onHint2={handleHint2}
              clientToSvg={clientToSvg}
              svgScalePxPerUnit={svgScalePxPerUnit}
            />
          )}

          {(spec.playKind === 'quiz' || spec.playKind === 'geography_quiz') && activePiece && (
            <QuizGame
              key={activePiece.id}
              activePiece={activePiece}
              allPoolPieces={loadedMap.allPoolPieces}
              isGeographyQuiz={spec.playKind === 'geography_quiz'}
              disableHelpButton={config.disableHelpButton}
              hintStage={hintStage}
              quizChoiceLayout={config.quizChoiceLayout}
              hasJumpBar={showJumpButtons !== 'none'}
              svgToContainerPoint={svgToContainerPoint}
              getSvgRect={getSvgRect}
              subscribeLiveViewBox={subscribeLiveViewBox}
              onFocusPiece={focusPieceSmooth}
              onHint1={handleHint1}
              onHint2={handleHint2}
              onToggleQuizChoiceLayout={() =>
                onConfigChange({
                  ...config,
                  quizChoiceLayout:
                    config.quizChoiceLayout === 'pointing' ? 'bottom' : 'pointing',
                })
              }
              onAnswerResult={(correct) => {
                if (correct) {
                  window.setTimeout(() => handlePieceSuccessRef.current(activePiece.id), 180);
                } else {
                  handleMiss(activePiece);
                }
              }}
            />
          )}

          {spec.playKind === 'yomikata' && activePiece && (
            <YomikataGame
              key={activePiece.id}
              activePiece={activePiece}
              isCapitalYomikata={spec.geoCategory === 'capital_y'}
              config={config}
              hintStage={hintStage}
              onFocusPiece={focusPieceSmooth}
              onHint1={handleHint1}
              onHint2={handleHint2}
              onAnswerResult={(correct) => {
                if (correct) {
                  window.setTimeout(() => handlePieceSuccessRef.current(activePiece.id), 120);
                } else {
                  handleMiss(activePiece);
                }
              }}
              onMarkMistake={() => persistMistakePiece(activePiece)}
            />
          )}
        </>
      )}

      {showConfig && (
        <ConfigModal
          config={config}
          onChange={onConfigChange}
          onRetry={() => {
            setShowConfig(false);
            onRestartSession({
              ...spec,
              sessionId: `${spec.modeId}_${Date.now()}`,
            });
          }}
          onGoHome={() => {
            setShowConfig(false);
            handleBackConfirmExit();
          }}
          onClose={() => setShowConfig(false)}
        />
      )}

      {showSaveModal && (
        <SaveSlotsModal
          mode="in_game"
          saves={manualSaves}
          onSaveNew={() => {
            const slotId = `slot_${Date.now()}`;
            onUpsertManualSave(
              buildProgressSnapshot(
                completedIds,
                sessionWrongIds,
                currentIndex,
                misses,
                hintsUsed,
                slotId,
              ),
            );
          }}
          onOverwriteSave={(slotId) => {
            onUpsertManualSave(
              buildProgressSnapshot(
                completedIds,
                sessionWrongIds,
                currentIndex,
                misses,
                hintsUsed,
                slotId,
              ),
            );
          }}
          onLoadSave={(s) => {
            setShowSaveModal(false);
            onLoadManualSave(s);
          }}
          onDeleteSave={onDeleteManualSave}
          onClose={() => setShowSaveModal(false)}
        />
      )}

      {showTagModal && loadedMap && (
        <TagManagerModal
          tags={tags}
          allPieces={loadedMap.allPoolPieces}
          onCreateTag={onCreateTag}
          onRenameTag={onRenameTag}
          onToggleLock={onToggleLockTag}
          onDeleteTag={onDeleteTag}
          onSelectPiece={(p) => {
            setInspectedPiece(p);
            focusPieceSmooth(p);
          }}
          onClose={() => setShowTagModal(false)}
        />
      )}

      {isCompleted && (
        <ResultOverlay
          areaName={spec.areaName}
          modeLabel={spec.modeLabel}
          elapsedMs={elapsedMs}
          misses={misses}
          hintsUsed={hintsUsed}
          questionCount={orderedTargets.length}
          maxCount={spec.maxCount}
          isNewBest={isNewBest}
          isCustomOrRandom={spec.isCustomOrRandom}
          isReviewMode={Boolean(spec.isReviewMode)}
          wrongPieces={wrongPieces}
          inspectingCompleted={inspectingCompleted}
          onToggleInspectCompleted={() => setInspectingCompleted((v) => !v)}
          onReviewMistakes={
            wrongPieces.length > 0 ? handleStartMistakeReviewFromResult : undefined
          }
          onRetrySame={() => {
            onRestartSession({
              ...spec,
              sessionId: `${spec.modeId}_${Date.now()}`,
              fixedPieceIds: orderedTargets.map((p) => p.id),
            });
          }}
          onRetryRandom={
            spec.isCustomOrRandom && !spec.isReviewMode
              ? () => {
                  onRestartSession({
                    ...spec,
                    sessionId: `${spec.modeId}_rand_${Date.now()}`,
                    fixedPieceIds: undefined,
                  });
                }
              : undefined
          }
          onGoTitle={onExitToTitle}
        />
      )}
    </div>
  );
};
