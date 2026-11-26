import { useCallback, useEffect, useMemo, useState } from 'react';
import { GameSessionShell } from './components/GameSessionShell';
import { TitleScreen } from './components/TitleScreen';
import { ViewModeScreen } from './components/ViewModeScreen';
import { buildAreaCatalog } from './data/gameCatalog';
import {
  isCityMunicipality,
  loadJapanPrefs,
  loadMuniIndex,
} from './services/mapDataLoader';
import {
  clearAllMistakes,
  clearMistakeByModeAndPiece,
  clearMistakeKeys,
  clearMistakesForMode,
  deleteManualSave,
  loadAllRecords,
  loadAutoSave,
  loadConfig,
  loadManualSaves,
  loadMistakes,
  loadTags,
  recordMistakeEntry,
  recordModeClear,
  saveConfig,
  saveTags,
  upsertManualSave,
  writeAutoSave,
} from './services/storageService';
import type {
  AreaCategory,
  ConfigState,
  GameSessionSpec,
  JapanPrefsData,
  MapTag,
  MistakeEntry,
  ModeBestRecord,
  MunicipalityMeta,
  SavedProgress,
} from './types/game';

type AppView =
  | { kind: 'title'; screen: 'title' | 'areas' }
  | {
      kind: 'play';
      spec: GameSessionSpec;
      restored: SavedProgress | null;
      returnTo: 'title' | 'areas';
    }
  | {
      kind: 'view';
      areaId: string;
      focusPieceId?: string | null;
      returnTo: 'title' | 'areas';
    };

function inferCategoryFromSpec(spec: GameSessionSpec): AreaCategory | null {
  if (spec.areaId === '00_japan') return 'japan';
  if (spec.areaId === '00_japan_all') return 'municipalities';
  if (spec.areaId === '00_japan_cities') return 'cities';
  if (spec.areaId.startsWith('pref_')) return 'prefecture';
  return null;
}

export function App() {
  const [prefsData, setPrefsData] = useState<JapanPrefsData | null>(null);
  const [muniList, setMuniList] = useState<MunicipalityMeta[]>([]);
  const [totalMunis, setTotalMunis] = useState(1747);
  const [totalCities, setTotalCities] = useState(792);
  const [cityCountByPref, setCityCountByPref] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const [config, setConfig] = useState<ConfigState>(() => loadConfig());
  const [records, setRecords] = useState<Record<string, ModeBestRecord>>(() =>
    loadAllRecords(),
  );
  const [autoSave, setAutoSave] = useState<SavedProgress | null>(() => loadAutoSave());
  const [manualSaves, setManualSaves] = useState<SavedProgress[]>(() =>
    loadManualSaves(),
  );
  const [tags, setTags] = useState<MapTag[]>(() => loadTags());
  const [mistakes, setMistakes] = useState<MistakeEntry[]>(() => loadMistakes());

  const [view, setView] = useState<AppView>({ kind: 'title', screen: 'title' });
  const [lastCategoryTab, setLastCategoryTab] = useState<AreaCategory>('japan');

  // Mirror quality setting to <html> as well as .app-root for CSS selectors
  useEffect(() => {
    document.documentElement.dataset.quality = config.quality;
  }, [config.quality]);

  // Prevent browser page zoom when pinching on UI overlays (map SVG still handles its own zoom)
  useEffect(() => {
    const preventPinchWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };
    const preventGesture = (e: Event) => {
      e.preventDefault();
    };
    const preventMultiTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
      }
    };

    window.addEventListener('wheel', preventPinchWheel, { passive: false });
    window.addEventListener('gesturestart', preventGesture, { passive: false });
    window.addEventListener('gesturechange', preventGesture, { passive: false });
    window.addEventListener('gestureend', preventGesture, { passive: false });
    window.addEventListener('touchmove', preventMultiTouchMove, { passive: false });
    return () => {
      window.removeEventListener('wheel', preventPinchWheel);
      window.removeEventListener('gesturestart', preventGesture);
      window.removeEventListener('gesturechange', preventGesture);
      window.removeEventListener('gestureend', preventGesture);
      window.removeEventListener('touchmove', preventMultiTouchMove);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([loadJapanPrefs(), loadMuniIndex()])
      .then(([jp, munis]) => {
        if (!active) return;
        setLoadError(null);
        setPrefsData(jp);
        setMuniList(munis);
        setTotalMunis(munis.length);
        const cityCounts: Record<string, number> = {};
        let cityTotal = 0;
        for (const m of munis) {
          if (isCityMunicipality(m)) {
            cityTotal += 1;
            cityCounts[m.prefCode] = (cityCounts[m.prefCode] ?? 0) + 1;
          }
        }
        setTotalCities(cityTotal);
        setCityCountByPref(cityCounts);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoadError(
          err instanceof Error ? err.message : '地図データの読み込みに失敗しました',
        );
      });
    return () => {
      active = false;
    };
  }, [retryNonce]);

  const areas = useMemo(() => {
    if (!prefsData) return [];
    return buildAreaCatalog(prefsData.prefs, totalMunis, totalCities);
  }, [prefsData, totalMunis, totalCities]);

  const allKnownPieces = useMemo(() => {
    const map = new Map<string, { name: string; ruby: string; prefName?: string }>();
    const prefNameByCode = new Map<string, string>();
    if (prefsData) {
      for (const p of prefsData.prefs) {
        prefNameByCode.set(p.code, p.name);
        map.set(`pref_${p.code}`, { name: p.name, ruby: p.ruby, prefName: p.name });
      }
    }
    for (const m of muniList) {
      map.set(m.code, {
        name: m.name,
        ruby: m.ruby,
        prefName: prefNameByCode.get(m.prefCode),
      });
    }
    return map;
  }, [prefsData, muniList]);

  const handleConfigChange = useCallback((next: ConfigState) => {
    setConfig(next);
    saveConfig(next);
  }, []);

  const handleSaveAuto = useCallback((progress: SavedProgress | null) => {
    writeAutoSave(progress);
    setAutoSave(progress);
  }, []);

  const handleUpsertManual = useCallback((save: SavedProgress) => {
    setManualSaves(upsertManualSave(save));
  }, []);

  const handleDeleteManual = useCallback((slotId: string) => {
    setManualSaves(deleteManualSave(slotId));
  }, []);

  const handleRecordClear = useCallback(
    (
      modeId: string,
      elapsedMs: number,
      misses: number,
      questionCount: number,
      maxCount: number,
      isCustomOrRandom: boolean,
      hintsUsed = 0,
    ) => {
      const res = recordModeClear(
        modeId,
        elapsedMs,
        misses,
        questionCount,
        maxCount,
        isCustomOrRandom,
        hintsUsed,
      );
      setRecords(loadAllRecords());
      return { isNewBest: res.isNewBest };
    },
    [],
  );

  const handleRecordMistake = useCallback(
    (entry: Omit<MistakeEntry, 'key' | 'missCount' | 'lastMissedAt'>) => {
      setMistakes(recordMistakeEntry(entry));
    },
    [],
  );

  const handleClearMistake = useCallback((modeId: string, pieceId: string) => {
    setMistakes(clearMistakeByModeAndPiece(modeId, pieceId));
  }, []);

  const handleClearMistakeKeys = useCallback((keys: string[]) => {
    setMistakes(clearMistakeKeys(keys));
  }, []);

  const handleDeleteMistakeEntry = useCallback((key: string) => {
    setMistakes(clearMistakeKeys([key]));
  }, []);

  const handleClearModeMistakes = useCallback((modeId: string) => {
    setMistakes(clearMistakesForMode(modeId));
  }, []);

  const handleClearAllMistakes = useCallback(() => {
    setMistakes(clearAllMistakes());
  }, []);

  const handleTogglePieceTag = useCallback((tagId: string, pieceId: string) => {
    setTags((prev) => {
      const next = prev.map((t) => {
        if (t.id !== tagId) return t;
        const exists = t.pieceIds.includes(pieceId);
        return {
          ...t,
          pieceIds: exists
            ? t.pieceIds.filter((id) => id !== pieceId)
            : [...t.pieceIds, pieceId],
        };
      });
      saveTags(next);
      return next;
    });
  }, []);

  const handleCreateTag = useCallback((name: string) => {
    setTags((prev) => {
      const next: MapTag[] = [
        ...prev,
        { id: `tag_${Date.now()}`, name, locked: false, pieceIds: [] },
      ];
      saveTags(next);
      return next;
    });
  }, []);

  const handleRenameTag = useCallback((tagId: string, name: string) => {
    setTags((prev) => {
      const next = prev.map((t) =>
        t.id === tagId && !t.locked ? { ...t, name } : t,
      );
      saveTags(next);
      return next;
    });
  }, []);

  const handleToggleLockTag = useCallback((tagId: string) => {
    setTags((prev) => {
      const next = prev.map((t) =>
        t.id === tagId ? { ...t, locked: !t.locked } : t,
      );
      saveTags(next);
      return next;
    });
  }, []);

  const handleDeleteTag = useCallback((tagId: string) => {
    setTags((prev) => {
      const next = prev.filter((t) => !(t.id === tagId && !t.locked));
      saveTags(next);
      return next;
    });
  }, []);

  let content: React.ReactNode;

  if (loadError) {
    content = (
      <div className="app-fatal-error">
        <h2>読み込みエラー</h2>
        <p>{loadError}</p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setLoadError(null);
            setRetryNonce((n) => n + 1);
          }}
        >
          ↻ 再試行
        </button>
      </div>
    );
  } else if (!prefsData) {
    content = <div className="map-loading-state">全国地図データを準備中...</div>;
  } else if (view.kind === 'play') {
    content = (
      <GameSessionShell
        key={view.spec.sessionId}
        spec={view.spec}
        restoredProgress={view.restored}
        config={config}
        tags={tags}
        manualSaves={manualSaves}
        onConfigChange={handleConfigChange}
        onSaveAuto={handleSaveAuto}
        onUpsertManualSave={handleUpsertManual}
        onDeleteManualSave={handleDeleteManual}
        onLoadManualSave={(s) =>
          setView({ kind: 'play', spec: s.spec, restored: s, returnTo: view.returnTo })
        }
        onRecordClear={handleRecordClear}
        onRecordMistake={handleRecordMistake}
        onClearMistake={handleClearMistake}
        onClearMistakeKeys={handleClearMistakeKeys}
        onTogglePieceTag={handleTogglePieceTag}
        onCreateTag={handleCreateTag}
        onRenameTag={handleRenameTag}
        onToggleLockTag={handleToggleLockTag}
        onDeleteTag={handleDeleteTag}
        onRestartSession={(nextSpec) =>
          setView({ kind: 'play', spec: nextSpec, restored: null, returnTo: view.returnTo })
        }
        onExitToAreas={() => {
          const inferred = inferCategoryFromSpec(view.spec);
          if (inferred) setLastCategoryTab(inferred);
          setView({ kind: 'title', screen: view.returnTo });
        }}
        onExitToTitle={() => setView({ kind: 'title', screen: 'title' })}
      />
    );
  } else if (view.kind === 'view') {
    content = (
      <ViewModeScreen
        initialAreaId={view.areaId}
        initialFocusPieceId={view.focusPieceId}
        returnLabel={view.returnTo === 'areas' ? '← エリア選択' : '← タイトル'}
        areas={areas}
        prefsData={prefsData}
        allKnownPieces={allKnownPieces}
        config={config}
        tags={tags}
        onConfigChange={handleConfigChange}
        onTogglePieceTag={handleTogglePieceTag}
        onCreateTag={handleCreateTag}
        onRenameTag={handleRenameTag}
        onToggleLockTag={handleToggleLockTag}
        onDeleteTag={handleDeleteTag}
        onStartGame={(spec) => {
          const inferred = inferCategoryFromSpec(spec);
          if (inferred) setLastCategoryTab(inferred);
          setView({ kind: 'play', spec, restored: null, returnTo: view.returnTo });
        }}
        onGoTitle={() => setView({ kind: 'title', screen: view.returnTo })}
      />
    );
  } else {
    content = (
      <TitleScreen
        initialScreenMode={view.screen}
        initialCategoryTab={lastCategoryTab}
        onCategoryTabChange={setLastCategoryTab}
        areas={areas}
        prefsData={prefsData}
        totalMunis={totalMunis}
        totalCities={totalCities}
        cityCountByPref={cityCountByPref}
        config={config}
        records={records}
        autoSave={autoSave}
        manualSaves={manualSaves}
        mistakes={mistakes}
        onConfigChange={handleConfigChange}
        onStartGame={(spec, restore, callerScreen) => {
          const inferred = inferCategoryFromSpec(spec);
          if (inferred) setLastCategoryTab(inferred);
          setView({
            kind: 'play',
            spec,
            restored: restore ?? null,
            returnTo: callerScreen ?? (view.screen === 'areas' ? 'areas' : 'title'),
          });
        }}
        onStartView={(areaId, options) =>
          setView({
            kind: 'view',
            areaId,
            focusPieceId: options?.focusPieceId ?? null,
            returnTo: options?.returnTo ?? 'title',
          })
        }
        onClearAutoSave={() => handleSaveAuto(null)}
        onDeleteManualSave={handleDeleteManual}
        onDeleteMistakeEntry={handleDeleteMistakeEntry}
        onClearModeMistakes={handleClearModeMistakes}
        onClearAllMistakes={handleClearAllMistakes}
      />
    );
  }

  return (
    <div
      className="app-root"
      data-quality={config.quality}
      style={{ width: '100%', height: '100%' }}
    >
      {content}
    </div>
  );
}

export default App;
