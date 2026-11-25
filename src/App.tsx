import { useCallback, useEffect, useMemo, useState } from 'react';
import { GameSessionShell } from './components/GameSessionShell';
import { TitleScreen } from './components/TitleScreen';
import { ViewModeScreen } from './components/ViewModeScreen';
import { buildAreaCatalog } from './data/gameCatalog';
import {
  loadJapanPrefs,
  loadMuniIndex,
  loadWorldMap,
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
  ConfigState,
  GameSessionSpec,
  JapanPrefsData,
  MapTag,
  MistakeEntry,
  ModeBestRecord,
  SavedProgress,
} from './types/game';

type AppView =
  | { kind: 'title' }
  | { kind: 'play'; spec: GameSessionSpec; restored: SavedProgress | null }
  | { kind: 'view'; areaId: string };

export function App() {
  const [prefsData, setPrefsData] = useState<JapanPrefsData | null>(null);
  const [totalMunis, setTotalMunis] = useState(1747);
  const [totalWorld, setTotalWorld] = useState(284);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const [view, setView] = useState<AppView>({ kind: 'title' });

  useEffect(() => {
    void Promise.all([loadJapanPrefs(), loadMuniIndex(), loadWorldMap()])
      .then(([jp, munis, world]) => {
        setPrefsData(jp);
        setTotalMunis(munis.length);
        setTotalWorld(world.regions.length);
      })
      .catch((err: unknown) => {
        setLoadError(
          err instanceof Error ? err.message : '地図データの読み込みに失敗しました',
        );
      });
  }, []);

  const areas = useMemo(() => {
    if (!prefsData) return [];
    return buildAreaCatalog(prefsData.prefs, totalMunis, totalWorld);
  }, [prefsData, totalMunis, totalWorld]);

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
    ) => {
      const res = recordModeClear(
        modeId,
        elapsedMs,
        misses,
        questionCount,
        maxCount,
        isCustomOrRandom,
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

  if (loadError) {
    return (
      <div className="app-fatal-error">
        <h2>読み込みエラー</h2>
        <p>{loadError}</p>
      </div>
    );
  }

  if (!prefsData) {
    return <div className="map-loading-state">全国地図データを準備中...</div>;
  }

  if (view.kind === 'play') {
    return (
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
          setView({ kind: 'play', spec: s.spec, restored: s })
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
          setView({ kind: 'play', spec: nextSpec, restored: null })
        }
        onExitToTitle={() => setView({ kind: 'title' })}
      />
    );
  }

  if (view.kind === 'view') {
    return (
      <ViewModeScreen
        initialAreaId={view.areaId}
        areas={areas}
        config={config}
        tags={tags}
        onConfigChange={handleConfigChange}
        onTogglePieceTag={handleTogglePieceTag}
        onCreateTag={handleCreateTag}
        onRenameTag={handleRenameTag}
        onToggleLockTag={handleToggleLockTag}
        onDeleteTag={handleDeleteTag}
        onGoTitle={() => setView({ kind: 'title' })}
      />
    );
  }

  return (
    <TitleScreen
      areas={areas}
      prefsData={prefsData}
      totalMunis={totalMunis}
      totalWorld={totalWorld}
      config={config}
      records={records}
      autoSave={autoSave}
      manualSaves={manualSaves}
      mistakes={mistakes}
      onConfigChange={handleConfigChange}
      onStartGame={(spec, restore) =>
        setView({ kind: 'play', spec, restored: restore ?? null })
      }
      onStartView={(areaId) => setView({ kind: 'view', areaId })}
      onDeleteManualSave={handleDeleteManual}
      onDeleteMistakeEntry={handleDeleteMistakeEntry}
      onClearModeMistakes={handleClearModeMistakes}
      onClearAllMistakes={handleClearAllMistakes}
    />
  );
}

export default App;
