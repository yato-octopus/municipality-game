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
import { loadMistakes } from '../services/storageService';
import { createSessionId } from '../utils/formatters';
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
    hintsUsed?: number,
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
  onExitToAreas: () => void;
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

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
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
  onExitToAreas,
  onExitToTitle,
}) => {
  const [loadedMap, setLoadedMap] = useState<LoadedSessionMap | null>(null);
  const [orderedTargets, setOrderedTargets] = useState<MapPieceItem[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [sessionWrongIds, setSessionWrongIds] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);

  // Elapsed timer split into base + anchor so HudOverlay's LiveClock ticks without re-rendering this shell
  const [baseElapsedMs, setBaseElapsedMs] = useState(0);
  const [runningSinceMs, setRunningSinceMs] = useState<number | null>(null);
  const [finalElapsedMs, setFinalElapsedMs] = useState(0);

  const [misses, setMisses] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);

  const [readyStage, setReadyStage] = useState<'ready' | 'go' | 'playing'>('ready');
  const [isCompleted, setIsCompleted] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);
  const [inspectingCompleted, setInspectingCompleted] = useState(false);

  const [selectedPiece, setSelectedPiece] = useState<MapPieceItem | null>(null);
  const [inspectedPiece, setInspectedPiece] = useState<MapPieceItem | null>(null);
  const [lastAnsweredPiece, setLastAnsweredPiece] = useState<MapPieceItem | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const [puzzleMissToast, setPuzzleMissToast] = useState<{
    nonce: number;
    text: string;
  } | null>(null);
  const [hintState, setHintState] = useState<{
    pieceId: string;
    stage: 0 | 1 | 2;
    area: HintAreaOverlay | null;
    areaVisible: boolean;
  } | null>(null);
  const [hintFittedPieceId, setHintFittedPieceId] = useState<string | null>(null);

  const [mapStageEl, setMapStageEl] = useState<HTMLDivElement | null>(null);
  const handleStageRef = useCallback((node: HTMLDivElement | null) => {
    setMapStageEl(node);
  }, []);

  // Synchronous authoritative refs preventing any stale-state race on last question / Hint 2 / give-up
  const completedIdsRef = useRef<Set<string>>(completedIds);
  const sessionWrongIdsRef = useRef<Set<string>>(sessionWrongIds);
  const missesRef = useRef<number>(misses);
  const hintsUsedRef = useRef<number>(hintsUsed);
  const baseElapsedMsRef = useRef<number>(baseElapsedMs);
  const runningSinceMsRef = useRef<number | null>(runningSinceMs);

  const hint1ChargedPieceIdsRef = useRef<Set<string>>(new Set());
  const hintFittedTimerRef = useRef<number | null>(null);
  const advanceTimerRef = useRef<number | null>(null);
  const missToastTimerRef = useRef<number | null>(null);
  const lastNonZeroVolumeRef = useRef<number>(config.seVolume > 0 ? config.seVolume : 70);

  const [showConfig, setShowConfig] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);

  const svgElRef = useRef<SVGSVGElement | null>(null);
  const liveViewBoxListenersRef = useRef<Set<() => void>>(new Set());

  useEffect(() => {
    if (config.seVolume > 0) {
      lastNonZeroVolumeRef.current = config.seVolume;
    }
  }, [config.seVolume]);

  const getCurrentElapsedMs = useCallback(() => {
    const since = runningSinceMsRef.current;
    if (since == null) return baseElapsedMsRef.current;
    return baseElapsedMsRef.current + Math.max(0, performance.now() - since);
  }, []);

  const clearAdvanceTimer = useCallback(() => {
    if (advanceTimerRef.current != null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  }, []);

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
      if (hintFittedTimerRef.current != null) window.clearTimeout(hintFittedTimerRef.current);
      if (advanceTimerRef.current != null) window.clearTimeout(advanceTimerRef.current);
      if (missToastTimerRef.current != null) window.clearTimeout(missToastTimerRef.current);
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
        const wrong = new Set(restoredProgress.sessionWrongIds ?? []);
        completedIdsRef.current = comp;
        sessionWrongIdsRef.current = wrong;
        missesRef.current = restoredProgress.misses;
        hintsUsedRef.current = restoredProgress.hintsUsed;
        baseElapsedMsRef.current = restoredProgress.elapsedMs;
        runningSinceMsRef.current = null;
        setCompletedIds(comp);
        setSessionWrongIds(wrong);
        setBaseElapsedMs(restoredProgress.elapsedMs);
        setRunningSinceMs(null);
        setMisses(restoredProgress.misses);
        setHintsUsed(restoredProgress.hintsUsed);
        const firstUn = ordered.findIndex((p) => !comp.has(p.id));
        setCurrentIndex(firstUn >= 0 ? firstUn : 0);
      } else {
        ordered = shuffleArray(res.targetPieces);
        completedIdsRef.current = new Set();
        sessionWrongIdsRef.current = new Set();
        missesRef.current = 0;
        hintsUsedRef.current = 0;
        baseElapsedMsRef.current = 0;
        runningSinceMsRef.current = null;
        setCompletedIds(new Set());
        setSessionWrongIds(new Set());
        setBaseElapsedMs(0);
        setRunningSinceMs(null);
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

  // Ready -> Go! transition once loaded (shorter on review retries, skippable)
  useEffect(() => {
    if (!loadedMap || readyStage === 'playing') return;
    const goDelay = spec.isReviewMode ? 180 : 450;
    const playDelay = spec.isReviewMode ? 400 : 850;
    const t1 = window.setTimeout(() => setReadyStage('go'), goDelay);
    const t2 = window.setTimeout(() => setReadyStage('playing'), playDelay);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [loadedMap, readyStage, spec.isReviewMode]);

  const handleSkipReady = useCallback(() => {
    if (loadedMap && readyStage !== 'playing') {
      setReadyStage('playing');
    }
  }, [loadedMap, readyStage]);

  const anyModalOpen = showConfig || showSaveModal || showTagModal;

  // Game stopwatch paused during overlays, countdown, and after completion
  const paused = !loadedMap || readyStage !== 'playing' || isCompleted || anyModalOpen;

  useEffect(() => {
    if (paused) {
      if (runningSinceMsRef.current != null) {
        const nextBase =
          baseElapsedMsRef.current + Math.max(0, performance.now() - runningSinceMsRef.current);
        baseElapsedMsRef.current = nextBase;
        runningSinceMsRef.current = null;
        setBaseElapsedMs(nextBase);
        setRunningSinceMs(null);
      }
    } else if (runningSinceMsRef.current == null) {
      const now = performance.now();
      runningSinceMsRef.current = now;
      setRunningSinceMs(now);
    }
  }, [paused]);

  const initialBBox: BBox = loadedMap?.viewBBox ?? [22, 34, 940, 920];
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
      elapsedMs: getCurrentElapsedMs(),
      misses: nextMisses,
      hintsUsed: nextHints,
    }),
    [spec, orderedTargets, getCurrentElapsedMs],
  );

  // Auto-save on page hide/unload when setting is active or exiting
  const snapshotRef = useRef<() => SavedProgress | null>(() => null);
  useEffect(() => {
    snapshotRef.current = () => {
      if (spec.isCustomOrRandom || isCompleted || orderedTargets.length === 0) return null;
      return buildProgressSnapshot(
        completedIdsRef.current,
        sessionWrongIdsRef.current,
        currentIndex,
        missesRef.current,
        hintsUsedRef.current,
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

  const targetIdSet = useMemo(
    () => new Set(orderedTargets.map((p) => p.id)),
    [orderedTargets],
  );

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

  // Global keyboard handler for Ready skip, Escape (info card -> puzzle selection), and map zoom (+/-/0)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (anyModalOpen || e.isComposing) return;
      if (readyStage !== 'playing' && loadedMap) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setReadyStage('playing');
        }
        return;
      }
      if (e.key === 'Escape' && !isCompleted) {
        if (inspectedPiece) {
          e.preventDefault();
          setInspectedPiece(null);
          return;
        }
        if (selectedPiece && config.showPieceList) {
          e.preventDefault();
          setSelectedPiece(null);
          setHintState(null);
          return;
        }
      }
      if (
        !isEditableElement(e.target) &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        loadedMap &&
        !isCompleted
      ) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          zoomByFactor(1.4);
        } else if (e.key === '-') {
          e.preventDefault();
          zoomByFactor(1 / 1.4);
        } else if (e.key === '0') {
          e.preventDefault();
          fitBBox(loadedMap.viewBBox);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    anyModalOpen,
    readyStage,
    loadedMap,
    isCompleted,
    inspectedPiece,
    selectedPiece,
    config.showPieceList,
    zoomByFactor,
    fitBBox,
  ]);

  const persistMistakePiece = useCallback(
    (piece: MapPieceItem | null) => {
      if (!piece || spec.playKind === 'view') return;
      if (!sessionWrongIdsRef.current.has(piece.id)) {
        const nextWrong = new Set(sessionWrongIdsRef.current);
        nextWrong.add(piece.id);
        sessionWrongIdsRef.current = nextWrong;
        setSessionWrongIds(nextWrong);
      }

      // In cross-mode review, bump missCount on original source mistake entries instead of adding a phantom review_munis_* group
      const sourceKeys = spec.isReviewMode ? spec.reviewSourceKeys?.[piece.id] : undefined;
      if (sourceKeys && sourceKeys.length > 0) {
        const existingList = loadMistakes();
        const keySet = new Set(sourceKeys);
        const matched = existingList.filter((entry) => keySet.has(entry.key));
        if (matched.length > 0) {
          for (const orig of matched) {
            onRecordMistake({
              pieceId: orig.pieceId,
              pieceName: orig.pieceName,
              pieceRuby: orig.pieceRuby,
              prefCode: orig.prefCode,
              prefName: orig.prefName,
              areaId: orig.areaId,
              areaName: orig.areaName,
              modeId: orig.modeId,
              modeLabel: orig.modeLabel,
              playKind: orig.playKind,
              mapScope: orig.mapScope,
              geoCategory: orig.geoCategory,
              prefFilterCodes: orig.prefFilterCodes,
              regionFilter: orig.regionFilter,
            });
          }
          return;
        }
      }

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

  const showMissToast = useCallback((text: string) => {
    setPuzzleMissToast({ nonce: Date.now(), text });
    if (missToastTimerRef.current != null) window.clearTimeout(missToastTimerRef.current);
    missToastTimerRef.current = window.setTimeout(() => {
      setPuzzleMissToast(null);
      missToastTimerRef.current = null;
    }, 950);
  }, []);

  const handleMiss = useCallback(
    (piece: MapPieceItem | null) => {
      playWrongBuzz(config.seVolume, config.fixActionSound);
      missesRef.current += 1;
      setMisses(missesRef.current);
      persistMistakePiece(piece);
      if (spec.playKind === 'puzzle') {
        showMissToast('× そこではありません');
      }
    },
    [config.seVolume, config.fixActionSound, persistMistakePiece, spec.playKind, showMissToast],
  );

  // Records a give-up / auto-solve as BOTH a mistake AND a miss so it never grants No-Miss Crown or 3 stars
  const recordGiveUp = useCallback(
    (piece: MapPieceItem | null) => {
      if (!piece) return;
      missesRef.current += 1;
      setMisses(missesRef.current);
      persistMistakePiece(piece);
    },
    [persistMistakePiece],
  );

  const handlePieceSuccess = useCallback(
    (pieceId: string, options?: { keepHintFitted?: boolean }) => {
      if (completedIdsRef.current.has(pieceId)) return;
      clearAdvanceTimer();

      const nextCompleted = new Set(completedIdsRef.current);
      nextCompleted.add(pieceId);
      completedIdsRef.current = nextCompleted;
      setCompletedIds(nextCompleted);
      setSelectedPiece(null);
      setHintState(null);
      if (!options?.keepHintFitted) {
        setHintFittedPieceId((cur) => (cur === pieceId ? null : cur));
      }

      // Only clear from mistake bank if answered cleanly without miss/give-up in this session
      if (!sessionWrongIdsRef.current.has(pieceId)) {
        const sourceKeys = spec.reviewSourceKeys?.[pieceId];
        if (sourceKeys && sourceKeys.length > 0) {
          onClearMistakeKeys(sourceKeys);
        } else {
          onClearMistake(spec.modeId, pieceId);
        }
      }

      const pieceObj = orderedTargets.find((p) => p.id === pieceId) ?? null;
      if (spec.playKind === 'puzzle') {
        if (pieceObj) setInspectedPiece(pieceObj);
      } else {
        // In Quiz & Yomikata: auto-dismiss full info card on advance, show non-blocking pill instead
        setInspectedPiece(null);
        if (pieceObj) setLastAnsweredPiece(pieceObj);
      }

      triggerVibrate(config.fixActionVibration, 35);

      if (nextCompleted.size >= orderedTargets.length) {
        const exactFinalMs = getCurrentElapsedMs();
        baseElapsedMsRef.current = exactFinalMs;
        runningSinceMsRef.current = null;
        setBaseElapsedMs(exactFinalMs);
        setRunningSinceMs(null);
        setFinalElapsedMs(exactFinalMs);
        setIsCompleted(true);
        // Play ONLY completion fanfare on the final piece (no overlapping chime)
        playCompleteFanfare(config.seVolume, config.fixActionSound);
        const recordedMisses = Math.max(
          missesRef.current,
          sessionWrongIdsRef.current.size,
        );
        const { isNewBest: newRec } = onRecordClear(
          spec.modeId,
          exactFinalMs,
          recordedMisses,
          spec.questionCount,
          spec.maxCount,
          spec.isCustomOrRandom,
          hintsUsedRef.current,
        );
        setIsNewBest(newRec);
        if (!spec.isCustomOrRandom) {
          onSaveAuto(null);
        }
        return;
      }

      if (spec.playKind === 'puzzle') {
        playSnapBell(config.seVolume, config.fixActionSound);
      } else {
        playCorrectChime(config.seVolume, config.fixActionSound);
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
            sessionWrongIdsRef.current,
            resolvedNextIdx,
            missesRef.current,
            hintsUsedRef.current,
          ),
        );
      }
    },
    [
      clearAdvanceTimer,
      orderedTargets,
      spec,
      config.seVolume,
      config.fixActionSound,
      config.fixActionVibration,
      config.autoSaveTiming,
      currentIndex,
      getCurrentElapsedMs,
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

  const remainingPieces = useMemo(
    () => orderedTargets.filter((p) => !completedIds.has(p.id)),
    [orderedTargets, completedIds],
  );

  const wrongPieces = useMemo(
    () => orderedTargets.filter((p) => sessionWrongIds.has(p.id)),
    [orderedTargets, sessionWrongIds],
  );

  const wrongCompletedCount = useMemo(() => {
    let count = 0;
    for (const id of sessionWrongIds) {
      if (completedIds.has(id)) count += 1;
    }
    return count;
  }, [sessionWrongIds, completedIds]);

  const cleanCompletedCount = Math.max(0, completedIds.size - wrongCompletedCount);

  const currentHintTargetId =
    spec.playKind === 'puzzle'
      ? (selectedPiece?.id ?? remainingPieces[0]?.id ?? null)
      : (activePiece?.id ?? null);

  const activeHintMatch =
    hintState && currentHintTargetId && hintState.pieceId === currentHintTargetId
      ? hintState
      : null;
  const hintStage: 0 | 1 | 2 = activeHintMatch?.stage ?? 0;
  const hintArea: HintAreaOverlay | null = activeHintMatch?.areaVisible
    ? activeHintMatch.area
    : null;
  const hint1Active = hintStage === 1 && Boolean(activeHintMatch?.areaVisible);

  const focusHintAreaSmooth = useCallback(
    (area: HintAreaOverlay) => {
      const pad = Math.max(18, area.r * 1.45);
      animateToBBox([
        area.cx - pad,
        area.cy - pad,
        area.cx + pad,
        area.cy + pad,
      ]);
    },
    [animateToBBox],
  );

  const handleHint1 = useCallback(() => {
    if (config.disableHelpButton || isCompleted || !loadedMap) return;
    const hintTarget =
      spec.playKind === 'puzzle'
        ? selectedPiece ?? remainingPieces[0]
        : activePiece;
    if (!hintTarget) return;
    if (hintState?.pieceId === hintTarget.id && hintState.stage >= 2) {
      return;
    }
    if (hintState?.pieceId === hintTarget.id && hintState.stage === 1) {
      if (hintState.areaVisible) {
        setHintState({ ...hintState, areaVisible: false });
      } else {
        const nextArea = hintState.area ?? computeHint1Area(hintTarget, loadedMap, spec);
        setHintState({ ...hintState, area: nextArea, areaVisible: true });
        focusHintAreaSmooth(nextArea);
      }
      return;
    }

    const area = computeHint1Area(hintTarget, loadedMap, spec);
    if (!hint1ChargedPieceIdsRef.current.has(hintTarget.id)) {
      hint1ChargedPieceIdsRef.current.add(hintTarget.id);
      hintsUsedRef.current += 1;
      setHintsUsed(hintsUsedRef.current);
    }
    if (spec.playKind === 'puzzle' && !selectedPiece) {
      // Never call setInspectedPiece(hintTarget) here to avoid spoiling unplaced piece details
      setSelectedPiece(hintTarget);
    }
    setHintState({
      pieceId: hintTarget.id,
      stage: 1,
      area,
      areaVisible: true,
    });
    focusHintAreaSmooth(area);
  }, [
    config.disableHelpButton,
    isCompleted,
    loadedMap,
    spec,
    selectedPiece,
    remainingPieces,
    activePiece,
    hintState,
    focusHintAreaSmooth,
  ]);

  const handleHint2 = useCallback(() => {
    if (config.disableHelpButton || isCompleted || !loadedMap) return;
    const hintTarget =
      spec.playKind === 'puzzle'
        ? selectedPiece ?? remainingPieces[0]
        : activePiece;
    if (!hintTarget || completedIdsRef.current.has(hintTarget.id)) return;
    if (hintStage >= 2 && hintState?.pieceId === hintTarget.id) {
      focusPieceSmooth(hintTarget);
      return;
    }

    hintsUsedRef.current += 1;
    setHintsUsed(hintsUsedRef.current);
    setHintState({
      pieceId: hintTarget.id,
      stage: 2,
      area: null,
      areaVisible: false,
    });
    setHintFittedPieceId(hintTarget.id);
    focusPieceSmooth(hintTarget);

    if (spec.playKind === 'puzzle') {
      // Auto-placing via Hint 2 is a give-up: record mistake & increment misses BEFORE solving
      recordGiveUp(hintTarget);
      if (hintFittedTimerRef.current != null) {
        window.clearTimeout(hintFittedTimerRef.current);
      }
      handlePieceSuccessRef.current(hintTarget.id, { keepHintFitted: true });
      hintFittedTimerRef.current = window.setTimeout(() => {
        setHintFittedPieceId((cur) => (cur === hintTarget.id ? null : cur));
        hintFittedTimerRef.current = null;
      }, 1800);
    }
  }, [
    config.disableHelpButton,
    isCompleted,
    loadedMap,
    spec.playKind,
    selectedPiece,
    remainingPieces,
    activePiece,
    hintStage,
    hintState,
    focusPieceSmooth,
    recordGiveUp,
  ]);

  const flushProgressBeforeExit = useCallback(() => {
    clearAdvanceTimer();
    if (!spec.isCustomOrRandom && !isCompleted && orderedTargets.length > 0) {
      onSaveAuto(
        buildProgressSnapshot(
          completedIdsRef.current,
          sessionWrongIdsRef.current,
          currentIndex,
          missesRef.current,
          hintsUsedRef.current,
        ),
      );
    }
  }, [
    clearAdvanceTimer,
    spec.isCustomOrRandom,
    isCompleted,
    orderedTargets.length,
    onSaveAuto,
    buildProgressSnapshot,
    currentIndex,
  ]);

  const handleBackToAreas = useCallback(() => {
    flushProgressBeforeExit();
    onExitToAreas();
  }, [flushProgressBeforeExit, onExitToAreas]);

  const handleBackToTitle = useCallback(() => {
    flushProgressBeforeExit();
    onExitToTitle();
  }, [flushProgressBeforeExit, onExitToTitle]);

  const handleToggleMute = useCallback(() => {
    const currentlyMuted = config.seVolume <= 0 || !config.fixActionSound;
    if (currentlyMuted) {
      onConfigChange({
        ...config,
        seVolume: lastNonZeroVolumeRef.current || 70,
        fixActionSound: true,
      });
    } else {
      lastNonZeroVolumeRef.current = config.seVolume;
      onConfigChange({
        ...config,
        seVolume: 0,
        fixActionSound: false,
      });
    }
  }, [config, onConfigChange]);

  const handleToggleNameOnFix = useCallback(() => {
    onConfigChange({ ...config, nameOnFix: !config.nameOnFix });
  }, [config, onConfigChange]);

  const handleToggleQuizChoiceLayout = useCallback(() => {
    onConfigChange({
      ...config,
      quizChoiceLayout: config.quizChoiceLayout === 'pointing' ? 'bottom' : 'pointing',
    });
  }, [config, onConfigChange]);

  const handleUseSimpleHint = useCallback(() => {
    hintsUsedRef.current += 1;
    setHintsUsed(hintsUsedRef.current);
  }, []);

  const handleSelectPuzzlePiece = useCallback(
    (p: MapPieceItem | null) => {
      setSelectedPiece((prev) => {
        if (p?.id !== prev?.id) {
          setHintState(null);
        }
        return p;
      });
      // Do NOT open HudOverlay info card on unplaced piece selection (prevents spoiling!)
    },
    [],
  );

  const handlePuzzlePlaceAttempt = useCallback(
    (pieceId: string, hitSuccess: boolean) => {
      if (hitSuccess) {
        handlePieceSuccessRef.current(pieceId);
      } else {
        const p = orderedTargets.find((x) => x.id === pieceId) ?? null;
        handleMiss(p);
      }
    },
    [orderedTargets, handleMiss],
  );

  const handleQuizAnswerResult = useCallback(
    (correct: boolean) => {
      if (!activePiece) return;
      if (correct) {
        const targetId = activePiece.id;
        clearAdvanceTimer();
        advanceTimerRef.current = window.setTimeout(() => {
          advanceTimerRef.current = null;
          handlePieceSuccessRef.current(targetId);
        }, 420);
      } else {
        handleMiss(activePiece);
      }
    },
    [activePiece, clearAdvanceTimer, handleMiss],
  );

  const handleQuizHintEliminatedAll = useCallback(() => {
    if (activePiece) {
      recordGiveUp(activePiece);
    }
  }, [activePiece, recordGiveUp]);

  const handleActiveGiveUp = useCallback(() => {
    if (activePiece) {
      recordGiveUp(activePiece);
    }
  }, [activePiece, recordGiveUp]);

  const handleAdvanceAfterGiveUp = useCallback(() => {
    if (activePiece) {
      handlePieceSuccessRef.current(activePiece.id);
    }
  }, [activePiece]);

  const handleYomikataAnswerResult = useCallback(
    (correct: boolean) => {
      if (!activePiece) return;
      if (correct) {
        const targetId = activePiece.id;
        clearAdvanceTimer();
        advanceTimerRef.current = window.setTimeout(() => {
          advanceTimerRef.current = null;
          handlePieceSuccessRef.current(targetId);
        }, 420);
      } else {
        handleMiss(activePiece);
      }
    },
    [activePiece, clearAdvanceTimer, handleMiss],
  );

  const handleMapPieceClick = useCallback(
    (clicked: MapPieceItem) => {
      if (isCompleted) {
        setInspectedPiece(clicked);
        return;
      }
      if (spec.playKind === 'puzzle') {
        if (selectedPiece) {
          if (clicked.id === selectedPiece.id) {
            handlePieceSuccessRef.current(clicked.id);
          } else if (completedIdsRef.current.has(clicked.id)) {
            setInspectedPiece(clicked);
          } else if (targetIdSet.has(clicked.id)) {
            // Only penalize tapping an uncompleted target piece (never muted non-target context land)
            handleMiss(selectedPiece);
          }
          return;
        }
        if (completedIdsRef.current.has(clicked.id)) {
          setInspectedPiece(clicked);
        }
        return;
      }
      if (completedIdsRef.current.has(clicked.id)) {
        setInspectedPiece(clicked);
      }
    },
    [isCompleted, spec.playKind, selectedPiece, targetIdSet, handleMiss],
  );

  const handleStartMistakeReviewFromResult = useCallback(() => {
    if (wrongPieces.length === 0) return;
    clearAdvanceTimer();
    const ids = wrongPieces.map((p) => p.id);
    const cleanModeLabel = spec.modeLabel.replace(/（復習）$/, '');
    onRestartSession({
      ...spec,
      sessionId: createSessionId(`review_${spec.modeId}`),
      modeLabel: `${cleanModeLabel}（復習）`,
      questionCount: ids.length,
      maxCount: ids.length,
      isCustomOrRandom: true,
      isReviewMode: true,
      fixedPieceIds: ids,
    });
  }, [wrongPieces, clearAdvanceTimer, spec, onRestartSession]);

  const showJumpButtons: 'japan' | 'none' =
    spec.areaId === '00_japan' ||
    spec.areaId === '00_japan_all' ||
    spec.areaId === '00_japan_cities' ||
    spec.mapScope === 'geography_100'
      ? 'japan'
      : 'none';

  const isTerrainMode = spec.mapScope === 'geography_100';
  const isPrefGuessMode = spec.mapScope === 'japan_prefs' && !spec.geoCategory;
  const isMultiPrefMuniMode =
    spec.mapScope === 'japan_munis' &&
    (!spec.prefFilterCodes || spec.prefFilterCodes.length !== 1);
  const requireBackConfirm =
    spec.isCustomOrRandom && !isCompleted && completedIds.size > 0;

  return (
    <div
      className={`map-screen-root ${spec.playKind === 'puzzle' ? 'has-tray' : 'has-bottom-panel'}`}
    >
      <HudOverlay
        title={spec.areaName}
        modeLabel={spec.modeLabel}
        baseElapsedMs={baseElapsedMs}
        runningSinceMs={runningSinceMs}
        timerRunning={!paused}
        misses={misses}
        hintsUsed={hintsUsed}
        completedCount={completedIds.size}
        cleanCompletedCount={cleanCompletedCount}
        wrongCompletedCount={wrongCompletedCount}
        totalCount={orderedTargets.length}
        config={config}
        zoomRatio={zoomRatio}
        minZoomRatio={minZoomRatio}
        showJumpButtons={showJumpButtons}
        isCustomOrRandom={spec.isCustomOrRandom}
        requireBackConfirm={requireBackConfirm}
        inspectedPiece={inspectedPiece}
        lastAnsweredPiece={spec.playKind !== 'puzzle' && !isCompleted ? lastAnsweredPiece : null}
        tags={tags}
        readyStage={readyStage}
        stageRef={handleStageRef}
        onZoomChange={(z) => setZoomAtPoint(z)}
        onZoomByFactor={(factor) => zoomByFactor(factor)}
        onJumpToBBox={(bbox) => animateToBBox(bbox)}
        onResetZoom={() => loadedMap && fitBBox(loadedMap.viewBBox)}
        onToggleMute={handleToggleMute}
        onOpenConfig={() => setShowConfig(true)}
        onOpenSave={() => setShowSaveModal(true)}
        onBack={handleBackToAreas}
        onCloseInfo={() => setInspectedPiece(null)}
        onOpenLastAnswerInfo={() => {
          if (lastAnsweredPiece) setInspectedPiece(lastAnsweredPiece);
        }}
        onDismissLastAnswer={() => setLastAnsweredPiece(null)}
        onSkipReady={handleSkipReady}
        onTogglePieceTag={onTogglePieceTag}
        onOpenTagManager={() => setShowTagModal(true)}
      >
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
            missedIds={inspectingCompleted ? sessionWrongIds : undefined}
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

        {puzzleMissToast && (
          <div
            key={puzzleMissToast.nonce}
            className="puzzle-miss-toast"
            role="status"
            aria-live="polite"
          >
            {puzzleMissToast.text}
          </div>
        )}
      </HudOverlay>

      {/* Play mode interaction panel */}
      {loadedMap && !isCompleted && readyStage === 'playing' && (
        <>
          {spec.playKind === 'puzzle' && (
            <PuzzleGame
              loadedMap={loadedMap}
              remainingPieces={remainingPieces}
              config={config}
              selectedPieceId={selectedPiece?.id ?? null}
              hint1Active={hint1Active}
              onSelectPiece={handleSelectPuzzlePiece}
              onPlaceAttempt={handlePuzzlePlaceAttempt}
              onHoverTargetChange={setHoverTargetId}
              onHint1={handleHint1}
              onHint2={handleHint2}
              onToggleNameOnFix={handleToggleNameOnFix}
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
              quizChoiceLayout={config.quizChoiceLayout}
              nameOnFix={config.nameOnFix}
              hasJumpBar={showJumpButtons !== 'none'}
              modalOpen={anyModalOpen}
              mapStageEl={mapStageEl}
              svgToContainerPoint={svgToContainerPoint}
              getSvgRect={getSvgRect}
              subscribeLiveViewBox={subscribeLiveViewBox}
              onFocusPiece={focusPieceSmooth}
              onUseHint={handleUseSimpleHint}
              onHintEliminatedAll={handleQuizHintEliminatedAll}
              onGiveUp={handleActiveGiveUp}
              onAdvanceAfterGiveUp={handleAdvanceAfterGiveUp}
              onToggleQuizChoiceLayout={handleToggleQuizChoiceLayout}
              onToggleNameOnFix={handleToggleNameOnFix}
              onAnswerResult={handleQuizAnswerResult}
            />
          )}

          {spec.playKind === 'yomikata' && activePiece && (
            <YomikataGame
              activePiece={activePiece}
              isCapitalYomikata={spec.geoCategory === 'capital_y'}
              isPrefectureMode={spec.mapScope === 'japan_prefs' && !spec.geoCategory}
              showPrefContext={isMultiPrefMuniMode}
              config={config}
              modalOpen={anyModalOpen}
              onFocusPiece={focusPieceSmooth}
              onUseHint={handleUseSimpleHint}
              onToggleNameOnFix={handleToggleNameOnFix}
              onAnswerResult={handleYomikataAnswerResult}
              onGiveUp={handleActiveGiveUp}
              onAdvanceAfterGiveUp={handleAdvanceAfterGiveUp}
            />
          )}
        </>
      )}

      {showConfig && (
        <ConfigModal
          config={config}
          onChange={onConfigChange}
          onRetry={() => {
            clearAdvanceTimer();
            setShowConfig(false);
            onRestartSession({
              ...spec,
              sessionId: createSessionId(spec.modeId),
            });
          }}
          onGoHome={() => {
            setShowConfig(false);
            handleBackToTitle();
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
                completedIdsRef.current,
                sessionWrongIdsRef.current,
                currentIndex,
                missesRef.current,
                hintsUsedRef.current,
                slotId,
              ),
            );
          }}
          onOverwriteSave={(slotId) => {
            onUpsertManualSave(
              buildProgressSnapshot(
                completedIdsRef.current,
                sessionWrongIdsRef.current,
                currentIndex,
                missesRef.current,
                hintsUsedRef.current,
                slotId,
              ),
            );
          }}
          onLoadSave={(s) => {
            clearAdvanceTimer();
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
          onTogglePieceTag={onTogglePieceTag}
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
          elapsedMs={finalElapsedMs}
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
          onInspectMissedPiece={(piece) => {
            setInspectingCompleted(true);
            setInspectedPiece(piece);
            focusPieceSmooth(piece);
          }}
          onReviewMistakes={
            wrongPieces.length > 0 ? handleStartMistakeReviewFromResult : undefined
          }
          onRetrySame={() => {
            clearAdvanceTimer();
            onRestartSession({
              ...spec,
              sessionId: createSessionId(spec.modeId),
              fixedPieceIds: orderedTargets.map((p) => p.id),
            });
          }}
          onRetryRandom={
            spec.isCustomOrRandom && !spec.isReviewMode
              ? () => {
                  clearAdvanceTimer();
                  onRestartSession({
                    ...spec,
                    sessionId: createSessionId(`${spec.modeId}_rand`),
                    fixedPieceIds: undefined,
                  });
                }
              : undefined
          }
          onGoAreas={onExitToAreas}
          onGoTitle={onExitToTitle}
        />
      )}
    </div>
  );
};
