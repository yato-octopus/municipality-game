export type GamePlayKind = 'puzzle' | 'quiz' | 'yomikata' | 'geography_quiz' | 'view';

export type GeographySubCategory =
  | 'capital_q'
  | 'capital_y'
  | 'mountains'
  | 'mountain'
  | 'river'
  | 'plain'
  | 'lake';

export type AreaCategory = 'japan' | 'prefecture' | 'municipalities' | 'cities';

export type QuizChoiceLayout = 'bottom' | 'pointing';

export interface HintAreaOverlay {
  pieceId: string;
  cx: number;
  cy: number;
  r: number;
}

export type BBox = [number, number, number, number]; // [minX, minY, maxX, maxY]

export interface PrefectureMeta {
  code: string;
  name: string;
  ruby: string;
  population: number;
  areaKm2: number;
  capital: string;
  capitalRuby: string;
  regions: string[];
  wiki: string;
  bbox: BBox;
  bboxMain: BBox;
  center: [number, number];
  capitalCenter: [number, number];
  areaPx: number;
  muniCount: number;
}

export interface JapanPrefsData {
  prefs: PrefectureMeta[];
  paths: Record<string, string>;
}

export interface MunicipalityMeta {
  code: string;
  prefCode: string;
  name: string;
  ruby: string;
  population: number;
  areaKm2: number;
  areaZone: string;
  subpref: string;
  county: string;
  wiki: string;
  bbox: BBox;
  center: [number, number];
  areaPx: number;
}

export interface GeographyFeature {
  id: string;
  name: string;
  ruby: string;
  category: 'mountain' | 'mountains' | 'river' | 'plain' | 'lake';
  geometryType: 'polygon' | 'line';
  pts: [number, number][];
  path?: string;
  center: [number, number];
  bbox?: BBox;
  wiki: string;
  desc: string;
}

/** Normalized map item rendered in Play/View/DataTable */
export interface MapPieceItem {
  id: string;
  name: string;
  ruby: string;
  answerRuby?: string; // e.g. capital reading when in capital quiz/yomikata
  answerKanji?: string; // e.g. capital name
  prefCode?: string;
  prefName?: string;
  population: number;
  areaKm2: number;
  regionLabel: string;     // 地方
  adminAreaLabel: string;  // 行政地域 / 振興局
  countyLabel: string;     // 郡 / 場所
  wiki: string;
  desc?: string;
  path?: string;
  linePts?: [number, number][];
  geoCategory?: GeographyFeature['category'];
  geometryType: 'path' | 'polygon_pts' | 'line_pts';
  bbox: BBox;
  center: [number, number];
  capitalCenter?: [number, number];
  areaPx: number;
  isOkinawa?: boolean;
  isTokyoIsland?: boolean;
  isMarker?: boolean;
}

export interface AreaSubMode {
  id: string;
  label: string;
  shortLabel: string;
  playKind: GamePlayKind;
  geoCategory?: GeographySubCategory;
  regionFilter?: string; // e.g. 'Kantou', 'douou', 'tokyo23', 'cities_all'
}

export interface AreaDefinition {
  id: string;
  category: AreaCategory;
  name: string;
  ruby: string;
  prefCode?: string;
  subTitle: string;
  population: number;
  wiki: string;
  totalCount: number;
  modes: AreaSubMode[];
}

export interface GameSessionSpec {
  sessionId: string;
  areaId: string;
  areaName: string;
  modeId: string;
  modeLabel: string;
  playKind: GamePlayKind;
  mapScope: 'japan_prefs' | 'japan_munis' | 'geography_100';
  geoCategory?: GeographySubCategory;
  prefFilterCodes?: string[];
  regionFilter?: string;
  questionCount: number;
  maxCount: number;
  isCustomOrRandom: boolean;
  isReviewMode?: boolean;
  /** pieceId -> MistakeEntry.key[] to clear upon answering without miss */
  reviewSourceKeys?: Record<string, string[]>;
  fixedPieceIds?: string[]; // preserved for "同じ場所でリトライ" & save restore
}

export interface MistakeEntry {
  key: string;
  pieceId: string;
  pieceName: string;
  pieceRuby: string;
  prefCode?: string;
  prefName?: string;
  areaId: string;
  areaName: string;
  modeId: string;
  modeLabel: string;
  playKind: Exclude<GamePlayKind, 'view'>;
  mapScope: GameSessionSpec['mapScope'];
  geoCategory?: GeographySubCategory;
  prefFilterCodes?: string[];
  regionFilter?: string;
  missCount: number;
  lastMissedAt: number;
}

export interface ConfigState {
  seVolume: number;              // 0..100
  quality: 'high' | 'medium' | 'low';
  autoSaveTiming: 'every_answer' | 'on_exit';
  fpsMode: 'high' | 'low';
  silhouette: boolean;           // true=白地図シルエット / false=標高図調
  showTime: boolean;
  showBorder: boolean;
  showPieceInfo: boolean;
  showTag: boolean;
  disableHelpButton: boolean;
  showPieceList: boolean;
  showYomikataKanji: boolean;
  reverseJumpButtons: boolean;
  fixActionSound: boolean;
  fixActionVibration: boolean;
  nameInList: boolean;
  nameOnDrag: boolean;
  nameOnFix: boolean;
  dragInertia: number;           // 0..1.0
  quizChoiceLayout: QuizChoiceLayout;
}

export interface ModeBestRecord {
  bestTimeMs: number | null;
  minMisses: number | null;
  clearCount: number;
  noMissCleared: boolean;
}

export interface SavedProgress {
  saveType: 'auto' | 'manual';
  slotId: string;
  savedAt: number;
  title: string;
  spec: GameSessionSpec;
  targetPieceIds: string[];
  completedIds: string[];
  sessionWrongIds?: string[];
  currentIndex: number;
  elapsedMs: number;
  misses: number;
  hintsUsed: number;
}

export interface MapTag {
  id: string;
  name: string;
  locked: boolean;
  pieceIds: string[];
}

export type SortTabKey =
  | 'code'
  | 'kana50'
  | 'population'
  | 'area'
  | 'kanzi'
  | 'hirakana'
  | 'moziCount'
  | 'similarName'
  | 'matiTyou'
  | 'muraSon'
  | 'siTyouSonKu';

export type TiikiFilterTab = 'all' | 'tihou' | 'tiiki' | 'gun';
