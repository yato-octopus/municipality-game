import type {
  ConfigState,
  MapTag,
  MistakeEntry,
  ModeBestRecord,
  SavedProgress,
} from '../types/game';

const KEYS = {
  CONFIG: 'municipality_game_config',
  RECORDS: 'municipality_game_records',
  AUTO_SAVE: 'municipality_game_auto_save',
  MANUAL_SAVES: 'municipality_game_manual_saves',
  TAGS: 'municipality_game_tags',
  MISTAKES: 'municipality_game_mistakes',
} as const;

export const DEFAULT_CONFIG: ConfigState = {
  seVolume: 70,
  quality: 'high',
  autoSaveTiming: 'every_answer',
  fpsMode: 'high',
  silhouette: true,
  showTime: true,
  showBorder: true,
  showPieceInfo: true,
  showTag: true,
  disableHelpButton: false,
  showPieceList: true,
  showYomikataKanji: true,
  reverseJumpButtons: false,
  fixActionSound: true,
  fixActionVibration: false,
  nameInList: true,
  nameOnDrag: true,
  nameOnFix: true,
  dragInertia: 0.65,
};

const DEFAULT_TAGS: MapTag[] = [
  {
    id: 'tag_interesting',
    name: '面白い形',
    locked: true,
    pieceIds: [],
  },
];

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota errors
  }
}

export function loadConfig(): ConfigState {
  const saved = safeRead<Partial<ConfigState>>(KEYS.CONFIG, {});
  return { ...DEFAULT_CONFIG, ...saved };
}

export function saveConfig(config: ConfigState): void {
  safeWrite(KEYS.CONFIG, config);
}

export function loadAllRecords(): Record<string, ModeBestRecord> {
  return safeRead<Record<string, ModeBestRecord>>(KEYS.RECORDS, {});
}

export function recordModeClear(
  modeId: string,
  elapsedMs: number,
  misses: number,
  questionCount: number,
  maxCount: number,
  isCustomOrRandom: boolean,
): { record: ModeBestRecord | null; isNewBest: boolean } {
  // クリアタイムは最大問題数のときのみ保存します
  if (isCustomOrRandom || questionCount < maxCount) {
    return { record: null, isNewBest: false };
  }
  const all = loadAllRecords();
  const prev = all[modeId];
  const isNewBest = prev?.bestTimeMs == null || elapsedMs < prev.bestTimeMs;
  const minMisses =
    prev?.minMisses == null ? misses : Math.min(prev.minMisses, misses);
  const next: ModeBestRecord = {
    bestTimeMs: isNewBest ? elapsedMs : (prev?.bestTimeMs ?? elapsedMs),
    minMisses,
    clearCount: (prev?.clearCount ?? 0) + 1,
    noMissCleared: Boolean(prev?.noMissCleared || misses === 0),
  };
  all[modeId] = next;
  safeWrite(KEYS.RECORDS, all);
  return { record: next, isNewBest };
}

export function loadAutoSave(): SavedProgress | null {
  return safeRead<SavedProgress | null>(KEYS.AUTO_SAVE, null);
}

export function writeAutoSave(progress: SavedProgress | null): void {
  if (!progress) {
    try {
      window.localStorage.removeItem(KEYS.AUTO_SAVE);
    } catch {
      // Ignore
    }
    return;
  }
  safeWrite(KEYS.AUTO_SAVE, progress);
}

export function loadManualSaves(): SavedProgress[] {
  return safeRead<SavedProgress[]>(KEYS.MANUAL_SAVES, []);
}

export function upsertManualSave(save: SavedProgress): SavedProgress[] {
  const list = loadManualSaves();
  const idx = list.findIndex((s) => s.slotId === save.slotId);
  const next = idx >= 0 ? list.map((s) => (s.slotId === save.slotId ? save : s)) : [save, ...list];
  safeWrite(KEYS.MANUAL_SAVES, next);
  return next;
}

export function deleteManualSave(slotId: string): SavedProgress[] {
  const next = loadManualSaves().filter((s) => s.slotId !== slotId);
  safeWrite(KEYS.MANUAL_SAVES, next);
  return next;
}

export function loadTags(): MapTag[] {
  const tags = safeRead<MapTag[]>(KEYS.TAGS, []);
  if (tags.length === 0) {
    safeWrite(KEYS.TAGS, DEFAULT_TAGS);
    return DEFAULT_TAGS;
  }
  return tags;
}

export function saveTags(tags: MapTag[]): void {
  safeWrite(KEYS.TAGS, tags);
}

export function loadMistakes(): MistakeEntry[] {
  return safeRead<MistakeEntry[]>(KEYS.MISTAKES, []);
}

export function saveMistakes(entries: MistakeEntry[]): void {
  safeWrite(KEYS.MISTAKES, entries);
}

export function makeMistakeKey(modeId: string, pieceId: string): string {
  return `${modeId}::${pieceId}`;
}

export function recordMistakeEntry(
  input: Omit<MistakeEntry, 'key' | 'missCount' | 'lastMissedAt'>,
): MistakeEntry[] {
  const list = loadMistakes();
  const key = makeMistakeKey(input.modeId, input.pieceId);
  const existing = list.find((e) => e.key === key);
  const updated: MistakeEntry = {
    ...input,
    key,
    missCount: (existing?.missCount ?? 0) + 1,
    lastMissedAt: Date.now(),
  };
  const next = [updated, ...list.filter((e) => e.key !== key)];
  saveMistakes(next);
  return next;
}

export function clearMistakeByModeAndPiece(modeId: string, pieceId: string): MistakeEntry[] {
  const key = makeMistakeKey(modeId, pieceId);
  const list = loadMistakes();
  if (!list.some((e) => e.key === key)) return list;
  const next = list.filter((e) => e.key !== key);
  saveMistakes(next);
  return next;
}

export function clearMistakeKeys(keys: string[]): MistakeEntry[] {
  if (keys.length === 0) return loadMistakes();
  const keySet = new Set(keys);
  const list = loadMistakes();
  const next = list.filter((e) => !keySet.has(e.key));
  if (next.length !== list.length) {
    saveMistakes(next);
  }
  return next;
}

export function clearMistakesForMode(modeId: string): MistakeEntry[] {
  const next = loadMistakes().filter((e) => e.modeId !== modeId);
  saveMistakes(next);
  return next;
}

export function clearAllMistakes(): MistakeEntry[] {
  saveMistakes([]);
  return [];
}
