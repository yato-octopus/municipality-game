import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  JAPAN_REGION_JUMPS,
  PREF_REGION_GROUPS,
  TIHOU_MUNI_GROUPS,
} from '../data/gameCatalog';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { normalizeSearchText } from '../services/dataAnalyzer';
import {
  getModePoolIds,
  loadSessionMap,
  OKINAWA_NATIONWIDE_TRANSFORM,
  shuffleArray,
} from '../services/mapDataLoader';
import { playUiClick } from '../services/soundService';
import type {
  AreaCategory,
  AreaDefinition,
  AreaSubMode,
  ConfigState,
  GameSessionSpec,
  JapanPrefsData,
  MapPieceItem,
  MistakeEntry,
  ModeBestRecord,
  SavedProgress,
} from '../types/game';
import { formatTimeMs } from '../utils/formatters';
import { APP_VERSION_LABEL } from '../version';
import { ConfigModal } from './ConfigModal';
import { DataTableModal } from './DataTableModal';
import { MistakeReviewModal } from './MistakeReviewModal';
import { SaveSlotsModal } from './SaveSlotsModal';

interface StartViewOptions {
  focusPieceId?: string | null;
  returnTo?: 'title' | 'areas';
}

interface TitleScreenProps {
  initialScreenMode?: 'title' | 'areas';
  initialCategoryTab?: AreaCategory;
  onCategoryTabChange?: (tab: AreaCategory) => void;
  areas: AreaDefinition[];
  prefsData: JapanPrefsData | null;
  totalMunis: number;
  totalCities: number;
  cityCountByPref: Record<string, number>;
  config: ConfigState;
  records: Record<string, ModeBestRecord>;
  autoSave: SavedProgress | null;
  manualSaves: SavedProgress[];
  mistakes: MistakeEntry[];
  onConfigChange: (next: ConfigState) => void;
  onStartGame: (
    spec: GameSessionSpec,
    restore?: SavedProgress | null,
    callerScreen?: 'title' | 'areas',
  ) => void;
  onStartView: (areaId: string, options?: StartViewOptions) => void;
  onClearAutoSave?: () => void;
  onDeleteManualSave: (slotId: string) => void;
  onDeleteMistakeEntry: (key: string) => void;
  onClearModeMistakes: (modeId: string) => void;
  onClearAllMistakes: () => void;
}

interface AreaGridCard {
  key: string;
  area: AreaDefinition;
  name: string;
  ruby: string;
  subTitle: string;
  modes: AreaSubMode[];
  viewAreaId?: string;
}

const CHANGELOG_ITEMS: { ver: string; notes: string[] }[] = [
  {
    ver: 'Ver 2.2.0',
    notes: [
      'マップ描画・操作性を大幅刷新：画面ピクセル基準の地名ラベル衝突回避＆高倍率スケール改善、パン境界クランプ、カーソル中心ズーム補正、自然地理100選の視認性向上、市専用マップのコントラスト強化を実施',
      'モバイル＆レスポンシブUXを刷新：.map-stage レイアウト導入により上部バー折り返し時のジャンプバー・ズーム操作・情報カード重なりを解消、パズルトレイのコンパクト化および狭い画面向けポインティング選択肢（上下3+3配置）を追加',
      '白地図閲覧モードに「日本の自然地理100選」アトラス、地名クイック検索（/）、ズームスライダー＆倍率表示、「このエリアで挑戦」・タグ練習ショートカット、DataTable からの直接フォーカス移動を追加',
      'ホーム・エリア選択・モーダルを改善：ホームに学習進捗サマリー追加、47都道府県の検索・状態フィルタ・8地方見出し整理、日本／市区町村／市タブの直接カード化、DataTable 増分表示・昇降順切替・カタカナ検索・大量チップの絞り込み＆スクロール化、全モーダル Esc キー対応および削除・上書き・リトライの2段階確認を実装',
      'プレイ体験・採点の厳密化：ヒント2／答えを見る使用時の誤答・星評価・ノーミス王冠の整合性修正、パズルのネタバレ防止・トレイ検索＆ソート・軽量ドラッグ最適化、クイズ1〜6キー操作、読み方の Safari IME 誤爆防止＆都府県サフィックス柔軟判定、カスタム復習の取りこぼし修正を実施',
    ],
  },
  {
    ver: 'Ver 2.1.1',
    notes: [
      '地図JSONデータ（japan_prefs.json / muni/* / geography_100.json）の読み込みにバージョン付きキャッシュバスティングを付与し、更新直後に旧キャッシュの都道府県境界と新市区町村境界が混在して県境がズレる問題を解消',
    ],
  },
  {
    ver: 'Ver 2.1.0',
    notes: [
      '47都道府県・1,747市区町村のSVG境界データを共有アーク位相完全一致方式（0.001単位精度）で再構築し、高倍率拡大時の穴開き・境界ズレ・二重線を解消',
    ],
  },
  {
    ver: 'Ver 2.0.3',
    notes: ['UI 部分上でのピンチイン／ピンチアウト時にブラウザ自体の拡大率が変化しないよう修正'],
  },
  {
    ver: 'Ver 2.0.2',
    notes: ['マップ名・タブ表記を「市町村」から「市区町村」へ統一'],
  },
  {
    ver: 'Ver 2.0.1',
    notes: [
      'クイズ選択肢のデフォルトを地図上ポインティング表示に変更',
      '市区町村マップでパン後やピースドラッグ中も都道府県ホバーツールチップが表示されるよう修正',
      'パズルのヒント1・ヒント2にズーム連動とヒント1再押下での表示／非表示切替を追加し、クイズ（誤答2択除外）と読み方（頭文字表示）のヒントを整理',
      '「回答後の名前 ON/OFF」ボタンを下部回答欄へ移動し、プレイ画面の「← 戻る」でマップ選択画面へ戻るよう改善',
      '地図の拡大上限を120倍へ引き上げ、全モードで日本地図全体が見えるまで縮小可能に改善',
    ],
  },
  {
    ver: 'Ver 2.0.0',
    notes: [
      '全国の「市」専用マップ（全国・北海道・7地方別）を追加',
      'クイズに地図上ポインティング選択肢モードを追加',
      'ヒント1（この辺サークル）・ヒント2（そのまま当てはめ）の2段階ヒントとヘッダー回数表示を追加',
      '県当て以外の全モードに都道府県ホバーツールチップと低彩度の隣接県塗り分けを追加',
      '回答後・配置後の地名表示をヘッダーからワンクリック切替に対応',
      '日本の自然地理100選（山脈・山・河川・平野・湖）を実測データで再構築し、日本地理学習に特化した構成へ刷新',
    ],
  },
  {
    ver: 'Ver 1.2.0',
    notes: [
      '間違えた問題の自動記憶＆復習モードを追加',
      '左クリックドラッグによるGoogleマップ風の滑らかな地図移動に対応',
    ],
  },
  {
    ver: 'Ver 1.1.0',
    notes: ['単一都道府県プレイ時にも周囲の都道府県白地図を表示'],
  },
  {
    ver: 'Ver 1.0.0',
    notes: [
      '全国1,747市区町村・47都道府県・日本の自然地理100選の精巧白地図パズル＆クイズ、データ11タブ集計、カスタム・ランダム、タグ管理を公開',
    ],
  },
];

const COUNT_PRESETS = [10, 20, 50] as const;

export const TitleScreen: React.FC<TitleScreenProps> = ({
  initialScreenMode = 'title',
  initialCategoryTab = 'japan',
  onCategoryTabChange,
  areas,
  prefsData,
  totalMunis,
  totalCities,
  cityCountByPref,
  config,
  records,
  autoSave,
  manualSaves,
  mistakes,
  onConfigChange,
  onStartGame,
  onStartView,
  onClearAutoSave,
  onDeleteManualSave,
  onDeleteMistakeEntry,
  onClearModeMistakes,
  onClearAllMistakes,
}) => {
  const [screenMode, setScreenMode] = useState<'title' | 'areas'>(initialScreenMode);
  const [categoryTab, setCategoryTab] = useState<AreaCategory>(initialCategoryTab);
  const handleSelectCategoryTab = (tab: AreaCategory) => {
    setCategoryTab(tab);
    onCategoryTabChange?.(tab);
  };

  // Area select search & filter (47 prefectures tab)
  const [areaSearch, setAreaSearch] = useState('');
  const [areaStatusFilter, setAreaStatusFilter] = useState<'all' | 'uncleared' | 'mistakes'>('all');

  // GameInfo Modal state
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedModeFilterIds, setSelectedModeFilterIds] = useState<string[] | null>(null);
  const [selectedModalTitle, setSelectedModalTitle] = useState<string | null>(null);
  const [selectedSubMode, setSelectedSubMode] = useState<AreaSubMode | null>(null);
  const [questionCount, setQuestionCount] = useState<number>(47);
  const [maxCountForSub, setMaxCountForSub] = useState<number>(47);
  const poolReqIdRef = useRef(0);

  // Modals
  const [showManualModal, setShowManualModal] = useState(false);
  const [showMistakeModal, setShowMistakeModal] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [showRandomModal, setShowRandomModal] = useState(false);
  const [showOtherModal, setShowOtherModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [confirmDismissAutoSave, setConfirmDismissAutoSave] = useState(false);
  const [otherTab, setOtherTab] = useState<
    'settings' | 'changelog' | 'source' | 'credit'
  >('settings');

  // GameInfo quick DataTable preview
  const [dataModalPieces, setDataModalPieces] = useState<{
    title: string;
    viewAreaId: string;
    pieces: MapPieceItem[];
  } | null>(null);

  // Custom Mode state
  const [customSelectedPrefs, setCustomSelectedPrefs] = useState<Set<string>>(
    () => new Set(['11', '12', '13', '14']),
  );
  const [customPlayKind, setCustomPlayKind] = useState<'puzzle' | 'quiz' | 'yomikata'>(
    'puzzle',
  );
  const [customScope, setCustomScope] = useState<'municipalities' | 'cities' | 'prefectures'>(
    'municipalities',
  );
  const [customCount, setCustomCount] = useState(20);

  // Random mode state
  const [randomPool, setRandomPool] = useState<
    'japan_munis' | 'japan_cities' | 'japan_prefs' | 'geography_100'
  >('japan_munis');
  const [randomPlayKind, setRandomPlayKind] = useState<'puzzle' | 'quiz' | 'yomikata'>(
    'puzzle',
  );
  const [randomCount, setRandomCount] = useState(15);

  useEffect(() => {
    if (!confirmDismissAutoSave) return;
    const t = window.setTimeout(() => setConfirmDismissAutoSave(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmDismissAutoSave]);

  // Escape handlers for inline modals (stack-aware!)
  useEscapeClose(Boolean(selectedAreaId), () => {
    setSelectedAreaId(null);
    setSelectedModeFilterIds(null);
    setSelectedModalTitle(null);
  });
  useEscapeClose(showCustomModal, () => setShowCustomModal(false));
  useEscapeClose(showRandomModal, () => setShowRandomModal(false));
  useEscapeClose(showOtherModal, () => setShowOtherModal(false));

  const selectedArea = useMemo(
    () => areas.find((a) => a.id === selectedAreaId) ?? null,
    [areas, selectedAreaId],
  );

  const visibleModalModes = useMemo(() => {
    if (!selectedArea) return [];
    if (!selectedModeFilterIds || selectedModeFilterIds.length === 0) return selectedArea.modes;
    const idSet = new Set(selectedModeFilterIds);
    const filtered = selectedArea.modes.filter((m) => idSet.has(m.id));
    return filtered.length > 0 ? filtered : selectedArea.modes;
  }, [selectedArea, selectedModeFilterIds]);

  const prefMetaByCode = useMemo(() => {
    const m = new Map<string, NonNullable<JapanPrefsData['prefs']>[number]>();
    if (prefsData) {
      for (const p of prefsData.prefs) m.set(p.code, p);
    }
    return m;
  }, [prefsData]);

  // Overall mastery summary for Home screen
  const masteryStats = useMemo(() => {
    let totalModes = 0;
    let clearedModes = 0;
    let noMissCount = 0;
    let clearedPrefs = 0;
    for (const a of areas) {
      let prefHasClear = false;
      for (const m of a.modes) {
        totalModes += 1;
        const rec = records[m.id];
        if ((rec?.clearCount ?? 0) > 0) {
          clearedModes += 1;
          prefHasClear = true;
        }
        if (rec?.noMissCleared) noMissCount += 1;
      }
      if (a.category === 'prefecture' && prefHasClear) {
        clearedPrefs += 1;
      }
    }
    return { totalModes, clearedModes, noMissCount, clearedPrefs };
  }, [areas, records]);

  const mistakesByModeId = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of mistakes) {
      map.set(m.modeId, (map.get(m.modeId) ?? 0) + 1);
    }
    return map;
  }, [mistakes]);

  // Custom available count — returns 0 when no prefectures are selected (explicit empty state!)
  const customMaxAvailable = useMemo(() => {
    if (!prefsData || customSelectedPrefs.size === 0) return 0;
    if (customScope === 'prefectures') {
      return customSelectedPrefs.size;
    }
    if (customScope === 'cities') {
      return prefsData.prefs
        .filter((p) => customSelectedPrefs.has(p.code))
        .reduce((acc, p) => acc + (cityCountByPref[p.code] ?? 0), 0);
    }
    return prefsData.prefs
      .filter((p) => customSelectedPrefs.has(p.code))
      .reduce((acc, p) => acc + p.muniCount, 0);
  }, [prefsData, customScope, customSelectedPrefs, cityCountByPref]);

  const effectiveCustomCount =
    customMaxAvailable > 0 ? Math.max(1, Math.min(customCount, customMaxAvailable)) : 0;

  const randomMaxAvailable = useMemo(() => {
    if (randomPool === 'japan_prefs') return 47;
    if (randomPool === 'japan_cities') return totalCities || 792;
    if (randomPool === 'geography_100') return 100;
    return totalMunis || 1747;
  }, [randomPool, totalMunis, totalCities]);

  const effectiveRandomCount = Math.max(1, Math.min(randomCount, randomMaxAvailable));

  // Direct cards for Japan / Municipalities / Cities tabs (eliminating 1-card empty pages)
  const japanCards = useMemo<AreaGridCard[]>(() => {
    const japanArea = areas.find((a) => a.id === '00_japan');
    if (!japanArea) return [];
    const pick = (ids: string[]) => japanArea.modes.filter((m) => ids.includes(m.id));
    return [
      {
        key: 'jp_prefs',
        area: japanArea,
        name: '47都道府県',
        ruby: 'とどうふけん',
        subTitle: 'パズル・クイズ・読み方（47都道府県）',
        modes: pick(['00_japan_P', '00_japan_Q', '00_japan_Y']),
        viewAreaId: '00_japan',
      },
      {
        key: 'jp_capitals',
        area: japanArea,
        name: '県庁所在地',
        ruby: 'けんちょうしょざいち',
        subTitle: '県庁所在地クイズ・読み方（47都市）',
        modes: pick(['00_japan_PrefecturalCapital_Q', '00_japan_PrefecturalCapital_Y']),
        viewAreaId: '00_japan',
      },
      {
        key: 'jp_mountains',
        area: japanArea,
        name: '主な山脈・山地・高地',
        ruby: 'さんみゃく・さんち',
        subTitle: '日本の自然地理クイズ（24件）',
        modes: pick(['00_japan_Mountains']),
        viewAreaId: 'geo_mountains',
      },
      {
        key: 'jp_mountain',
        area: japanArea,
        name: '主な山',
        ruby: 'おもなやま',
        subTitle: '日本の自然地理クイズ（21座）',
        modes: pick(['00_japan_Mountain']),
        viewAreaId: 'geo_mountain',
      },
      {
        key: 'jp_river',
        area: japanArea,
        name: '主な河川',
        ruby: 'おもなかせん',
        subTitle: '日本の自然地理クイズ（16河川）',
        modes: pick(['00_japan_River']),
        viewAreaId: 'geo_river',
      },
      {
        key: 'jp_plain',
        area: japanArea,
        name: '主な平野',
        ruby: 'おもなへいや',
        subTitle: '日本の自然地理クイズ（17平野）',
        modes: pick(['00_japan_Plain']),
        viewAreaId: 'geo_plain',
      },
      {
        key: 'jp_lake',
        area: japanArea,
        name: '主な湖',
        ruby: 'おもなみずうみ',
        subTitle: '日本の自然地理クイズ（22湖沼）',
        modes: pick(['00_japan_Lake']),
        viewAreaId: 'geo_lake',
      },
    ];
  }, [areas]);

  const municipalityCards = useMemo<AreaGridCard[]>(() => {
    const allMuniArea = areas.find((a) => a.id === '00_japan_all');
    if (!allMuniArea) return [];
    const cards: AreaGridCard[] = [
      {
        key: 'muni_all',
        area: allMuniArea,
        name: '全国（全市区町村）',
        ruby: 'ぜんこくしくちょうそん',
        subTitle: `全国 ${totalMunis.toLocaleString()}市区町村 ・ P / Q / 読`,
        modes: allMuniArea.modes.filter((m) => !m.regionFilter),
      },
    ];
    for (const t of TIHOU_MUNI_GROUPS) {
      const cnt = t.prefCodes.reduce((s, c) => s + (prefMetaByCode.get(c)?.muniCount ?? 0), 0);
      cards.push({
        key: `muni_${t.key}`,
        area: allMuniArea,
        name: `${t.label} 市区町村`,
        ruby: t.label,
        subTitle: `${cnt.toLocaleString()}市区町村（${t.prefCodes.length}県）・ P / Q / 読`,
        modes: allMuniArea.modes.filter((m) => m.regionFilter === t.key),
      });
    }
    return cards;
  }, [areas, totalMunis, prefMetaByCode]);

  const cityCards = useMemo<AreaGridCard[]>(() => {
    const allCitiesArea = areas.find((a) => a.id === '00_japan_cities');
    if (!allCitiesArea) return [];
    const hokkaidoCities = cityCountByPref['01'] ?? 35;
    const cards: AreaGridCard[] = [
      {
        key: 'city_all',
        area: allCitiesArea,
        name: '全国（全市）',
        ruby: 'ぜんこくのし',
        subTitle: `全国 ${totalCities.toLocaleString()}市 ・ P / Q / 読`,
        modes: allCitiesArea.modes.filter((m) => m.regionFilter === 'cities_all'),
      },
      {
        key: 'city_hokkaido',
        area: allCitiesArea,
        name: '北海道の市',
        ruby: 'ほっかいどうのし',
        subTitle: `${hokkaidoCities}市 ・ P / Q / 読`,
        modes: allCitiesArea.modes.filter((m) => m.regionFilter === 'cities_Hokkaido'),
      },
    ];
    for (const t of TIHOU_MUNI_GROUPS) {
      const cnt = t.prefCodes.reduce((s, c) => s + (cityCountByPref[c] ?? 0), 0);
      cards.push({
        key: `city_${t.key}`,
        area: allCitiesArea,
        name: `${t.label}の市`,
        ruby: `${t.label}のし`,
        subTitle: `${cnt}市（${t.prefCodes.length}県）・ P / Q / 読`,
        modes: allCitiesArea.modes.filter((m) => m.regionFilter === `cities_${t.key}`),
      });
    }
    return cards;
  }, [areas, totalCities, cityCountByPref]);

  const prefAreasByCode = useMemo(() => {
    const map = new Map<string, AreaDefinition>();
    for (const a of areas) {
      if (a.category === 'prefecture' && a.prefCode) {
        map.set(a.prefCode, a);
      }
    }
    return map;
  }, [areas]);

  const groupedPrefRegions = useMemo(() => {
    const q = normalizeSearchText(areaSearch);
    return PREF_REGION_GROUPS.map((rg) => {
      const items = rg.prefCodes
        .map((code) => prefAreasByCode.get(code))
        .filter((a): a is AreaDefinition => Boolean(a))
        .filter((a) => {
          if (q) {
            const meta = a.prefCode ? prefMetaByCode.get(a.prefCode) : undefined;
            const hay = normalizeSearchText(
              `${a.name} ${a.ruby} ${meta?.capital ?? ''} ${meta?.capitalRuby ?? ''}`,
            );
            if (!hay.includes(q)) return false;
          }
          if (areaStatusFilter === 'uncleared') {
            const anyCleared = a.modes.some((m) => (records[m.id]?.clearCount ?? 0) > 0);
            if (anyCleared) return false;
          } else if (areaStatusFilter === 'mistakes') {
            const mCnt = a.modes.reduce((s, m) => s + (mistakesByModeId.get(m.id) ?? 0), 0);
            if (mCnt === 0) return false;
          }
          return true;
        });
      return { ...rg, items };
    }).filter((rg) => rg.items.length > 0);
  }, [areaSearch, areaStatusFilter, prefAreasByCode, prefMetaByCode, records, mistakesByModeId]);

  const inferSpecBase = (
    area: AreaDefinition,
    mode: AreaSubMode,
  ): Omit<GameSessionSpec, 'sessionId' | 'questionCount' | 'maxCount'> => {
    const mapScope: GameSessionSpec['mapScope'] =
      mode.geoCategory &&
      ['mountains', 'mountain', 'river', 'plain', 'lake'].includes(mode.geoCategory)
        ? 'geography_100'
        : area.id === '00_japan'
          ? 'japan_prefs'
          : 'japan_munis';
    return {
      areaId: area.id,
      areaName: area.name,
      modeId: mode.id,
      modeLabel: mode.label,
      playKind: mode.playKind,
      mapScope,
      geoCategory: mode.geoCategory,
      prefFilterCodes: area.prefCode ? [area.prefCode] : undefined,
      regionFilter:
        area.id === '00_japan_cities'
          ? (mode.regionFilter ?? 'cities_all')
          : mode.regionFilter,
      isCustomOrRandom: false,
    };
  };

  const resolveViewAreaIdForSelection = (area: AreaDefinition, mode: AreaSubMode | null): string => {
    if (
      mode?.geoCategory &&
      ['mountains', 'mountain', 'river', 'plain', 'lake'].includes(mode.geoCategory)
    ) {
      return `geo_${mode.geoCategory}`;
    }
    return area.id;
  };

  const openAreaModal = async (
    area: AreaDefinition,
    options?: { modeFilterIds?: string[]; modalTitle?: string },
  ) => {
    playUiClick(config.seVolume);
    const reqId = ++poolReqIdRef.current;
    setSelectedAreaId(area.id);
    setSelectedModeFilterIds(options?.modeFilterIds ?? null);
    setSelectedModalTitle(options?.modalTitle ?? null);

    const candidateModes =
      options?.modeFilterIds && options.modeFilterIds.length > 0
        ? area.modes.filter((m) => options.modeFilterIds!.includes(m.id))
        : area.modes;
    const defaultMode = candidateModes[0] ?? area.modes[0] ?? null;
    setSelectedSubMode(defaultMode);

    if (defaultMode) {
      const base = inferSpecBase(area, defaultMode);
      const ids = await getModePoolIds(
        base.mapScope,
        base.prefFilterCodes,
        base.regionFilter,
        base.geoCategory,
      );
      if (poolReqIdRef.current !== reqId) return;
      const cnt = Math.max(1, ids.length);
      setMaxCountForSub(cnt);
      setQuestionCount(cnt);
    }
  };

  const handleSelectSubMode = async (area: AreaDefinition, mode: AreaSubMode) => {
    playUiClick(config.seVolume);
    const reqId = ++poolReqIdRef.current;
    setSelectedSubMode(mode);
    const base = inferSpecBase(area, mode);
    const ids = await getModePoolIds(
      base.mapScope,
      base.prefFilterCodes,
      base.regionFilter,
      base.geoCategory,
    );
    if (poolReqIdRef.current !== reqId) return;
    const cnt = Math.max(1, ids.length);
    setMaxCountForSub(cnt);
    setQuestionCount(cnt);
  };

  const launchStandardSession = async (area: AreaDefinition, mode: AreaSubMode) => {
    const base = inferSpecBase(area, mode);
    const poolIds = await getModePoolIds(
      base.mapScope,
      base.prefFilterCodes,
      base.regionFilter,
      base.geoCategory,
    );
    const qCnt = Math.max(1, Math.min(poolIds.length, questionCount));
    const fixedPieceIds =
      qCnt < poolIds.length ? shuffleArray(poolIds).slice(0, qCnt) : undefined;

    const spec: GameSessionSpec = {
      ...base,
      sessionId: `${mode.id}_${Date.now()}`,
      questionCount: qCnt,
      maxCount: poolIds.length,
      fixedPieceIds,
    };
    setSelectedAreaId(null);
    setSelectedModeFilterIds(null);
    setSelectedModalTitle(null);
    onStartGame(spec, null, 'areas');
  };

  const handleStartCustom = async () => {
    if (customSelectedPrefs.size === 0 || customMaxAvailable === 0) return;
    const codes = Array.from(customSelectedPrefs);
    const mapScope: GameSessionSpec['mapScope'] =
      customScope === 'prefectures' ? 'japan_prefs' : 'japan_munis';
    const regionFilter = customScope === 'cities' ? 'cities_custom' : undefined;
    const poolIds = await getModePoolIds(mapScope, codes, regionFilter);
    if (poolIds.length === 0) return;
    const qCnt = Math.max(1, Math.min(poolIds.length, effectiveCustomCount));
    const fixedPieceIds = shuffleArray(poolIds).slice(0, qCnt);
    const customModeId =
      customScope === 'prefectures'
        ? `custom_prefs_${customPlayKind}`
        : customScope === 'cities'
          ? `custom_cities_${customPlayKind}`
          : `custom_munis_${customPlayKind}`;
    const customAreaName =
      customScope === 'prefectures'
        ? `カスタム・都道府県（${codes.length}都道府県）`
        : customScope === 'cities'
          ? `カスタム・市（${codes.length}都道府県）`
          : `カスタム（${codes.length}都道府県）`;

    setShowCustomModal(false);
    onStartGame(
      {
        sessionId: `custom_${Date.now()}`,
        areaId: 'custom',
        areaName: customAreaName,
        modeId: customModeId,
        modeLabel:
          customPlayKind === 'puzzle'
            ? 'パズル'
            : customPlayKind === 'quiz'
              ? 'クイズ'
              : '読み方',
        playKind: customPlayKind,
        mapScope,
        prefFilterCodes: codes,
        regionFilter,
        questionCount: qCnt,
        maxCount: poolIds.length,
        isCustomOrRandom: true,
        fixedPieceIds,
      },
      null,
      'title',
    );
  };

  const handleStartRandom = async () => {
    const effectivePlayKind =
      randomPool === 'geography_100' ? 'geography_quiz' : randomPlayKind;
    const mapScope: GameSessionSpec['mapScope'] =
      randomPool === 'japan_cities' ? 'japan_munis' : randomPool;
    const regionFilter = randomPool === 'japan_cities' ? 'cities_all' : undefined;
    const poolIds = await getModePoolIds(mapScope, undefined, regionFilter);
    if (poolIds.length === 0) return;
    const qCnt = Math.max(1, Math.min(poolIds.length, effectiveRandomCount));
    const fixedPieceIds = shuffleArray(poolIds).slice(0, qCnt);
    const labelMap: Record<typeof randomPool, string> = {
      japan_munis: 'ランダム（全国市区町村）',
      japan_cities: 'ランダム（全国すべての市）',
      japan_prefs: 'ランダム（47都道府県）',
      geography_100: 'ランダム（自然地理100）',
    };
    setShowRandomModal(false);
    onStartGame(
      {
        sessionId: `random_${Date.now()}`,
        areaId: 'random',
        areaName: labelMap[randomPool],
        modeId: `random_${randomPool}_${effectivePlayKind}`,
        modeLabel:
          effectivePlayKind === 'puzzle'
            ? 'パズル'
            : effectivePlayKind === 'yomikata'
              ? '読み方'
              : 'クイズ',
        playKind: effectivePlayKind,
        mapScope,
        regionFilter,
        questionCount: qCnt,
        maxCount: poolIds.length,
        isCustomOrRandom: true,
        fixedPieceIds,
      },
      null,
      'title',
    );
  };

  const handleOpenDataFromGameInfo = async (area: AreaDefinition) => {
    const mode = selectedSubMode ?? visibleModalModes[0] ?? area.modes[0];
    const base = mode
      ? inferSpecBase(area, mode)
      : {
          areaId: area.id,
          areaName: area.name,
          modeId: `${area.id}_data`,
          modeLabel: 'データ',
          playKind: 'view' as const,
          mapScope: (area.id === '00_japan'
            ? 'japan_prefs'
            : 'japan_munis') as GameSessionSpec['mapScope'],
          prefFilterCodes: area.prefCode ? [area.prefCode] : undefined,
          regionFilter: area.id === '00_japan_cities' ? 'cities_all' : undefined,
          isCustomOrRandom: false,
        };
    const loaded = await loadSessionMap({
      ...base,
      sessionId: `data_preview_${area.id}`,
      questionCount: area.totalCount,
      maxCount: area.totalCount,
    });
    const viewAreaId = resolveViewAreaIdForSelection(area, mode ?? null);
    setDataModalPieces({
      title: selectedModalTitle ?? area.name,
      viewAreaId,
      pieces: loaded.allPoolPieces,
    });
  };

  const renderCardBadges = (modes: AreaSubMode[]) => {
    const clearedModes = modes.filter((m) => (records[m.id]?.clearCount ?? 0) > 0).length;
    const noMissModes = modes.filter((m) => Boolean(records[m.id]?.noMissCleared)).length;
    const cardMistakes = modes.reduce((s, m) => s + (mistakesByModeId.get(m.id) ?? 0), 0);
    const hasAutoSave =
      Boolean(autoSave) && modes.some((m) => m.id === autoSave?.spec.modeId);

    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
        {hasAutoSave && (
          <span className="submode-mistake-pill submode-autosave-pill">途中</span>
        )}
        {cardMistakes > 0 && (
          <span className="submode-mistake-pill" style={{ marginLeft: 0 }}>
            復習 {cardMistakes}
          </span>
        )}
        {noMissModes > 0 && (
          <span className="crown-badge" title={`ノーミス達成 ${noMissModes}/${modes.length}`}>
            ★{noMissModes === modes.length ? '' : noMissModes}
          </span>
        )}
        {clearedModes > 0 && (
          <span className="area-card-clear-badge">
            ✓ {clearedModes}/{modes.length}
          </span>
        )}
      </span>
    );
  };

  const activeDirectCards =
    categoryTab === 'japan'
      ? japanCards
      : categoryTab === 'municipalities'
        ? municipalityCards
        : categoryTab === 'cities'
          ? cityCards
          : null;

  return (
    <div className="title-screen-shell">
      {screenMode === 'title' ? (
        <main className="title-hero-container">
          <div className="title-visual-card">
            <div className="title-badge-row">
              <div className="title-badge">精巧白地図版 ・ 日本地理学習ゲーム</div>
              <span className="title-version-badge">Release {APP_VERSION_LABEL}</span>
            </div>
            <h1 className="title-main-heading">全国市区町村パズル＆地理クイズ</h1>
            <p className="title-subtitle">
              全国 {totalMunis.toLocaleString()} 市区町村（全 {totalCities.toLocaleString()} 市・北方領土6村・政令指定都市対応）、47都道府県・県庁所在地、日本の自然地理100選の精巧白地図学習ゲーム
            </p>

            {prefsData && (
              <svg
                viewBox="25 35 915 885"
                className="title-hero-blankmap"
                aria-label="日本全国白地図"
              >
                <g>
                  {prefsData.prefs.map((p) =>
                    p.code === '47' ? (
                      <g
                        key={p.code}
                        transform={`translate(${OKINAWA_NATIONWIDE_TRANSFORM.tx}, ${OKINAWA_NATIONWIDE_TRANSFORM.ty}) scale(${OKINAWA_NATIONWIDE_TRANSFORM.scale})`}
                      >
                        <path
                          className="hero-map-land"
                          d={prefsData.paths[p.code]}
                          strokeWidth={1.1}
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    ) : (
                      <path
                        key={p.code}
                        className="hero-map-land"
                        d={prefsData.paths[p.code]}
                        strokeWidth={1.0}
                        vectorEffect="non-scaling-stroke"
                      />
                    ),
                  )}
                </g>
                <rect
                  className="hero-map-inset-frame"
                  x={28}
                  y={46}
                  width={280}
                  height={158}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}

            <div className="home-mastery-strip" aria-label="学習進捗サマリー">
              <span>都道府県クリア: <strong>{masteryStats.clearedPrefs}/47</strong></span>
              <span>
                モード制覇: <strong>{masteryStats.clearedModes}/{masteryStats.totalModes}</strong>
              </span>
              <span>
                ノーミス: <strong>★ {masteryStats.noMissCount}</strong>
              </span>
              <span>
                要復習: <strong>{mistakes.length}件</strong>
              </span>
            </div>

            <div className="title-version-footer">Version {APP_VERSION_LABEL}</div>
          </div>

          <nav className="title-menu-panel">
            <button
              type="button"
              className="menu-btn menu-btn-start"
              onClick={() => {
                playUiClick(config.seVolume);
                setScreenMode('areas');
              }}
            >
              <span className="menu-btn-title">ゲームをはじめる</span>
              <span className="menu-btn-sub">日本・都道府県・全市区町村・全国の市</span>
            </button>

            {autoSave && (
              <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch', gap: '6px' }}>
                <button
                  type="button"
                  className="menu-btn menu-btn-resume"
                  style={{ flex: 1 }}
                  onClick={() => {
                    playUiClick(config.seVolume);
                    onStartGame(autoSave.spec, autoSave, 'title');
                  }}
                >
                  <span className="menu-btn-title">前回のオートセーブから</span>
                  <span className="menu-btn-sub">
                    {autoSave.title}（{autoSave.completedIds.length}/
                    {autoSave.targetPieceIds.length} ・ {formatTimeMs(autoSave.elapsedMs)} ・{' '}
                    {new Date(autoSave.savedAt).toLocaleString('ja-JP')}）
                  </span>
                </button>
                {onClearAutoSave && (
                  <button
                    type="button"
                    className={`autosave-dismiss-btn ${confirmDismissAutoSave ? 'confirm-inline-btn' : ''}`}
                    title="オートセーブを破棄"
                    aria-label="オートセーブを破棄"
                    onClick={() => {
                      if (!confirmDismissAutoSave) {
                        setConfirmDismissAutoSave(true);
                        return;
                      }
                      setConfirmDismissAutoSave(false);
                      onClearAutoSave();
                    }}
                  >
                    {confirmDismissAutoSave ? '破棄?' : '✕'}
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              className={`menu-btn ${mistakes.length > 0 ? 'menu-btn-mistakes' : ''}`}
              onClick={() => {
                playUiClick(config.seVolume);
                setShowMistakeModal(true);
              }}
            >
              <span className="menu-btn-title">間違えた問題を復習（{mistakes.length}件）</span>
              <span className="menu-btn-sub">
                {mistakes.length > 0
                  ? 'ミスした市区町村・都道府県・地理問題だけ集中練習'
                  : 'プレイ中に間違えた問題が自動でここに記憶されます'}
              </span>
            </button>

            <button
              type="button"
              className="menu-btn"
              onClick={() => {
                playUiClick(config.seVolume);
                setShowManualModal(true);
              }}
            >
              <span className="menu-btn-title">つづきから（手動セーブ）</span>
              <span className="menu-btn-sub">保存済みデータ: {manualSaves.length}件</span>
            </button>

            <div className="menu-btn-split">
              <button
                type="button"
                className="menu-btn"
                onClick={() => {
                  playUiClick(config.seVolume);
                  setShowCustomModal(true);
                }}
              >
                <span className="menu-btn-title">カスタム</span>
                <span className="menu-btn-sub">複数県組み合わせ・問題数指定</span>
              </button>
              <button
                type="button"
                className="menu-btn"
                onClick={() => {
                  playUiClick(config.seVolume);
                  setShowRandomModal(true);
                }}
              >
                <span className="menu-btn-title">ランダム</span>
                <span className="menu-btn-sub">ランダム出題チャレンジ</span>
              </button>
            </div>

            <div className="menu-btn-split">
              <button
                type="button"
                className="menu-btn"
                onClick={() => {
                  playUiClick(config.seVolume);
                  onStartView('00_japan', { returnTo: 'title' });
                }}
              >
                <span className="menu-btn-title">白地図閲覧・データ</span>
                <span className="menu-btn-sub">自然地理100・標高図・集計テーブル</span>
              </button>
              <button
                type="button"
                className="menu-btn"
                onClick={() => {
                  playUiClick(config.seVolume);
                  setShowOtherModal(true);
                }}
              >
                <span className="menu-btn-title">設定・更新履歴・出典</span>
                <span className="menu-btn-sub">テーマ / 地図・操作設定 / 更新履歴 / 出典</span>
              </button>
            </div>
          </nav>
        </main>
      ) : (
        <section className="area-select-screen">
          <header className="area-select-header">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setScreenMode('title')}
            >
              ← タイトルへ
            </button>
            <h2>エリアを選択してください</h2>
          </header>

          <div className="area-category-tabs">
            <button
              type="button"
              className={categoryTab === 'japan' ? 'active' : ''}
              onClick={() => handleSelectCategoryTab('japan')}
            >
              日本（国・自然地理・県庁）
            </button>
            <button
              type="button"
              className={categoryTab === 'prefecture' ? 'active' : ''}
              onClick={() => handleSelectCategoryTab('prefecture')}
            >
              都道府県別（47都道府県）
            </button>
            <button
              type="button"
              className={categoryTab === 'municipalities' ? 'active' : ''}
              onClick={() => handleSelectCategoryTab('municipalities')}
            >
              全国・地方別 市区町村
            </button>
            <button
              type="button"
              className={categoryTab === 'cities' ? 'active' : ''}
              onClick={() => handleSelectCategoryTab('cities')}
            >
              全国・地方別 市
            </button>
          </div>

          {activeDirectCards && (
            <div className="area-cards-grid">
              {activeDirectCards.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="area-card-btn"
                  onClick={() =>
                    void openAreaModal(c.area, {
                      modeFilterIds: c.modes.map((m) => m.id),
                      modalTitle: c.name,
                    })
                  }
                >
                  <div className="area-card-top">
                    <span className="area-card-ruby">{c.ruby}</span>
                    {renderCardBadges(c.modes)}
                  </div>
                  <div className="area-card-name">{c.name}</div>
                  <div className="area-card-sub">{c.subTitle}</div>
                </button>
              ))}
            </div>
          )}

          {categoryTab === 'prefecture' && (
            <>
              <div className="area-search-bar">
                <input
                  type="search"
                  placeholder="都道府県・ふりがな・県庁所在地で検索..."
                  aria-label="都道府県を検索"
                  value={areaSearch}
                  onChange={(e) => setAreaSearch(e.target.value)}
                />
                <div className="area-filter-pills" role="group" aria-label="状態フィルタ">
                  <button
                    type="button"
                    className={areaStatusFilter === 'all' ? 'active' : ''}
                    onClick={() => setAreaStatusFilter('all')}
                  >
                    すべて
                  </button>
                  <button
                    type="button"
                    className={areaStatusFilter === 'uncleared' ? 'active' : ''}
                    onClick={() => setAreaStatusFilter('uncleared')}
                  >
                    未クリア
                  </button>
                  <button
                    type="button"
                    className={areaStatusFilter === 'mistakes' ? 'active' : ''}
                    onClick={() => setAreaStatusFilter('mistakes')}
                  >
                    復習あり
                  </button>
                </div>
              </div>

              {groupedPrefRegions.length === 0 ? (
                <p className="empty-hint">条件に一致する都道府県はありません。</p>
              ) : (
                groupedPrefRegions.map((rg) => (
                  <div key={rg.id}>
                    <h3 className="area-region-heading">{rg.label}</h3>
                    <div className="area-cards-grid">
                      {rg.items.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className="area-card-btn"
                          onClick={() => void openAreaModal(a)}
                        >
                          <div className="area-card-top">
                            <span className="area-card-ruby">{a.ruby}</span>
                            {renderCardBadges(a.modes)}
                          </div>
                          <div className="area-card-name">{a.name}</div>
                          <div className="area-card-sub">{a.subTitle}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </section>
      )}

      {/* GameInfo Modal */}
      {selectedArea && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setSelectedAreaId(null);
            setSelectedModeFilterIds(null);
            setSelectedModalTitle(null);
          }}
        >
          <div
            className="modal-card gameinfo-modal"
            role="dialog"
            aria-modal="true"
            aria-label={selectedModalTitle ?? selectedArea.name}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="gameinfo-nav-row">
                {selectedArea.category === 'prefecture' && (
                  <button
                    type="button"
                    className="btn-ghost btn-xs"
                    onClick={() => {
                      const prefList = areas.filter((a) => a.category === 'prefecture');
                      const idx = prefList.findIndex((a) => a.id === selectedArea.id);
                      const prev = prefList[(idx - 1 + prefList.length) % prefList.length];
                      if (prev) void openAreaModal(prev);
                    }}
                  >
                    ◀ 前の県
                  </button>
                )}
                <div>
                  <span className="gameinfo-ruby">{selectedArea.ruby}</span>
                  <h3>{selectedModalTitle ?? selectedArea.name}</h3>
                </div>
                {selectedArea.category === 'prefecture' && (
                  <button
                    type="button"
                    className="btn-ghost btn-xs"
                    onClick={() => {
                      const prefList = areas.filter((a) => a.category === 'prefecture');
                      const idx = prefList.findIndex((a) => a.id === selectedArea.id);
                      const next = prefList[(idx + 1) % prefList.length];
                      if (next) void openAreaModal(next);
                    }}
                  >
                    次の県 ▶
                  </button>
                )}
              </div>
              <button
                type="button"
                className="modal-close-btn"
                aria-label="閉じる"
                onClick={() => {
                  setSelectedAreaId(null);
                  setSelectedModeFilterIds(null);
                  setSelectedModalTitle(null);
                }}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="gameinfo-meta-strip">
                <span>人口: {selectedArea.population.toLocaleString()}人</span>
                <div className="gameinfo-quick-links">
                  <button
                    type="button"
                    className="btn-secondary btn-xs"
                    onClick={() => {
                      const viewId = resolveViewAreaIdForSelection(selectedArea, selectedSubMode);
                      setSelectedAreaId(null);
                      setSelectedModeFilterIds(null);
                      setSelectedModalTitle(null);
                      onStartView(viewId, { returnTo: 'areas' });
                    }}
                  >
                    👁 閲覧
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-xs"
                    onClick={() => void handleOpenDataFromGameInfo(selectedArea)}
                  >
                    📊 データ
                  </button>
                  <a
                    href={selectedArea.wiki}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost btn-xs link-btn"
                  >
                    Wikipedia ↗
                  </a>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <h4 style={{ margin: 0 }}>モード一覧</h4>
                {selectedModeFilterIds &&
                  selectedArea.modes.length > visibleModalModes.length && (
                    <button
                      type="button"
                      className="btn-ghost btn-xs"
                      onClick={() => {
                        setSelectedModeFilterIds(null);
                        setSelectedModalTitle(null);
                      }}
                    >
                      全{selectedArea.modes.length}モードを表示
                    </button>
                  )}
              </div>

              <div className="submode-list">
                {visibleModalModes.map((m) => {
                  const rec = records[m.id];
                  const modeMistakeCount = mistakesByModeId.get(m.id) ?? 0;
                  const active = selectedSubMode?.id === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`submode-row-btn ${active ? 'active' : ''}`}
                      onClick={() => void handleSelectSubMode(selectedArea, m)}
                    >
                      <span className="submode-name">
                        {m.label}
                        {modeMistakeCount > 0 && (
                          <span className="submode-mistake-pill">復習 {modeMistakeCount}</span>
                        )}
                      </span>
                      <span className="submode-record">
                        {rec?.bestTimeMs != null ? (
                          <>
                            {rec.noMissCleared && <span className="crown-badge">★</span>}
                            <span>{formatTimeMs(rec.bestTimeMs)}</span>
                            <span className="muted">
                              (Miss {rec.minMisses ?? 0} / クリア {rec.clearCount}回)
                            </span>
                          </>
                        ) : (
                          <span className="muted">未クリア</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              {selectedSubMode && (
                <div className="question-count-box">
                  <div className="qcount-top">
                    <span>
                      問題数: <strong>{Math.min(questionCount, maxCountForSub)}</strong> /{' '}
                      {maxCountForSub}
                    </span>
                    <div className="qcount-step-btns">
                      {maxCountForSub > 10 && (
                        <button
                          type="button"
                          className="btn-ghost btn-xs"
                          onClick={() =>
                            setQuestionCount((c) => Math.max(1, Math.min(c, maxCountForSub) - 5))
                          }
                        >
                          −5
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        onClick={() =>
                          setQuestionCount((c) => Math.max(1, Math.min(c, maxCountForSub) - 1))
                        }
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        onClick={() =>
                          setQuestionCount((c) => Math.min(maxCountForSub, c + 1))
                        }
                      >
                        ＋
                      </button>
                      {maxCountForSub > 10 && (
                        <button
                          type="button"
                          className="btn-ghost btn-xs"
                          onClick={() =>
                            setQuestionCount((c) => Math.min(maxCountForSub, c + 5))
                          }
                        >
                          ＋5
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={maxCountForSub}
                    value={Math.min(questionCount, maxCountForSub)}
                    onChange={(e) => setQuestionCount(Number(e.target.value))}
                    aria-label="出題数"
                  />
                  {maxCountForSub > 10 && (
                    <div className="qcount-step-btns" style={{ flexWrap: 'wrap' }}>
                      {COUNT_PRESETS.filter((n) => n < maxCountForSub).map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={
                            questionCount === n ? 'btn-primary btn-xs' : 'btn-secondary btn-xs'
                          }
                          onClick={() => setQuestionCount(n)}
                        >
                          {n}問
                        </button>
                      ))}
                      <button
                        type="button"
                        className={
                          questionCount >= maxCountForSub
                            ? 'btn-primary btn-xs'
                            : 'btn-secondary btn-xs'
                        }
                        onClick={() => setQuestionCount(maxCountForSub)}
                      >
                        全問 ({maxCountForSub})
                      </button>
                    </div>
                  )}
                  <div className="qcount-note">
                    クリアタイムは最大数（{maxCountForSub}）のときのみ保存します
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer gameinfo-footer">
              {selectedSubMode &&
                (() => {
                  const modeMistakes = mistakes.filter((x) => x.modeId === selectedSubMode.id);
                  if (modeMistakes.length === 0) return null;
                  const uniqueIds = Array.from(new Set(modeMistakes.map((x) => x.pieceId)));
                  const reviewSourceKeys: Record<string, string[]> = {};
                  for (const e of modeMistakes) {
                    reviewSourceKeys[e.pieceId] = [
                      ...(reviewSourceKeys[e.pieceId] ?? []),
                      e.key,
                    ];
                  }
                  return (
                    <button
                      type="button"
                      className="btn-warning"
                      onClick={() => {
                        const base = inferSpecBase(selectedArea, selectedSubMode);
                        setSelectedAreaId(null);
                        setSelectedModeFilterIds(null);
                        setSelectedModalTitle(null);
                        onStartGame(
                          {
                            ...base,
                            sessionId: `review_${selectedSubMode.id}_${Date.now()}`,
                            modeLabel: `${selectedSubMode.label}（復習）`,
                            questionCount: uniqueIds.length,
                            maxCount: uniqueIds.length,
                            isCustomOrRandom: true,
                            isReviewMode: true,
                            reviewSourceKeys,
                            fixedPieceIds: uniqueIds,
                          },
                          null,
                          'areas',
                        );
                      }}
                    >
                      🔁 間違えた問題のみ挑戦（{uniqueIds.length}問）
                    </button>
                  );
                })()}
              {autoSave &&
                selectedSubMode &&
                autoSave.spec.modeId === selectedSubMode.id && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setSelectedAreaId(null);
                      setSelectedModeFilterIds(null);
                      setSelectedModalTitle(null);
                      onStartGame(autoSave.spec, autoSave, 'areas');
                    }}
                  >
                    つづきから再開（{autoSave.completedIds.length}/
                    {autoSave.targetPieceIds.length}）
                  </button>
                )}
              {selectedSubMode && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void launchStandardSession(selectedArea, selectedSubMode)}
                >
                  はじめからスタート
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Manual Save Modal */}
      {showManualModal && (
        <SaveSlotsModal
          mode="load_only"
          saves={manualSaves}
          onLoadSave={(s) => {
            setShowManualModal(false);
            onStartGame(s.spec, s, 'title');
          }}
          onDeleteSave={onDeleteManualSave}
          onClose={() => setShowManualModal(false)}
        />
      )}

      {/* Custom Mode Modal */}
      {showCustomModal && (
        <div className="modal-backdrop" onClick={() => setShowCustomModal(false)}>
          <div
            className="modal-card custom-modal"
            role="dialog"
            aria-modal="true"
            aria-label="カスタムモード"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>カスタムモード（複数エリア組み合わせ）</h3>
              <button
                type="button"
                className="modal-close-btn"
                aria-label="閉じる"
                onClick={() => setShowCustomModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="custom-controls-bar">
                <div className="btn-group">
                  <button
                    type="button"
                    className={customScope === 'municipalities' ? 'active' : ''}
                    onClick={() => setCustomScope('municipalities')}
                  >
                    選択県の市区町村
                  </button>
                  <button
                    type="button"
                    className={customScope === 'cities' ? 'active' : ''}
                    onClick={() => setCustomScope('cities')}
                  >
                    選択県の市のみ
                  </button>
                  <button
                    type="button"
                    className={customScope === 'prefectures' ? 'active' : ''}
                    onClick={() => setCustomScope('prefectures')}
                  >
                    選択都道府県そのもの
                  </button>
                </div>
                <div className="btn-group">
                  {(['puzzle', 'quiz', 'yomikata'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={customPlayKind === k ? 'active' : ''}
                      onClick={() => setCustomPlayKind(k)}
                    >
                      {k === 'puzzle' ? 'パズル' : k === 'quiz' ? 'クイズ' : '読み方'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="custom-region-shortcuts">
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  onClick={() =>
                    prefsData &&
                    setCustomSelectedPrefs(new Set(prefsData.prefs.map((p) => p.code)))
                  }
                >
                  全国全選択
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  onClick={() => setCustomSelectedPrefs(new Set())}
                >
                  クリア
                </button>
                {JAPAN_REGION_JUMPS.map((r) => {
                  const selectedInRegion = r.prefCodes.filter((c) =>
                    customSelectedPrefs.has(c),
                  ).length;
                  const allOn = selectedInRegion === r.prefCodes.length;
                  const partial = selectedInRegion > 0 && !allOn;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={
                        allOn
                          ? 'btn-primary btn-xs'
                          : partial
                            ? 'btn-warning btn-xs'
                            : 'btn-secondary btn-xs'
                      }
                      aria-pressed={allOn}
                      onClick={() => {
                        setCustomSelectedPrefs((prev) => {
                          const next = new Set(prev);
                          const isAll = r.prefCodes.every((c) => next.has(c));
                          for (const c of r.prefCodes) {
                            if (isAll) next.delete(c);
                            else next.add(c);
                          }
                          return next;
                        });
                      }}
                    >
                      {r.short}
                      {partial ? ` (${selectedInRegion}/${r.prefCodes.length})` : ''}
                    </button>
                  );
                })}
                <span className="muted" style={{ marginLeft: 'auto', fontWeight: 700 }}>
                  選択中: {customSelectedPrefs.size}都道府県（対象{' '}
                  {customMaxAvailable.toLocaleString()}件）
                </span>
              </div>

              {prefsData && (
                <div className="custom-picker-split">
                  <svg
                    viewBox="25 35 915 885"
                    className="custom-mini-japan-svg"
                    aria-label="カスタム都道府県地図選択"
                  >
                    {prefsData.prefs.map((p) => {
                      const active = customSelectedPrefs.has(p.code);
                      const toggle = () =>
                        setCustomSelectedPrefs((prev) => {
                          const next = new Set(prev);
                          if (next.has(p.code)) next.delete(p.code);
                          else next.add(p.code);
                          return next;
                        });
                      const pathEl = (
                        <path
                          d={prefsData.paths[p.code]}
                          strokeWidth={active ? 1.5 : 0.9}
                          vectorEffect="non-scaling-stroke"
                          className={`map-piece-clickable custom-mini-land ${active ? 'is-active' : ''}`}
                          onClick={toggle}
                        >
                          <title>{p.name}</title>
                        </path>
                      );
                      return p.code === '47' ? (
                        <g
                          key={p.code}
                          transform={`translate(${OKINAWA_NATIONWIDE_TRANSFORM.tx}, ${OKINAWA_NATIONWIDE_TRANSFORM.ty}) scale(${OKINAWA_NATIONWIDE_TRANSFORM.scale})`}
                        >
                          {pathEl}
                        </g>
                      ) : (
                        <g key={p.code}>{pathEl}</g>
                      );
                    })}
                  </svg>

                  <div className="custom-pref-checklist">
                    {prefsData.prefs.map((p) => {
                      const checked = customSelectedPrefs.has(p.code);
                      return (
                        <label
                          key={p.code}
                          className={`custom-pref-chip ${checked ? 'checked' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setCustomSelectedPrefs((prev) => {
                                const next = new Set(prev);
                                if (next.has(p.code)) next.delete(p.code);
                                else next.add(p.code);
                                return next;
                              });
                            }}
                          />
                          <span>{p.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="question-count-box">
                <div className="qcount-top">
                  <span>
                    出題数: <strong>{effectiveCustomCount}</strong> / {customMaxAvailable}
                  </span>
                  <div className="qcount-step-btns">
                    <button
                      type="button"
                      className="btn-ghost btn-xs"
                      disabled={customMaxAvailable === 0}
                      onClick={() =>
                        setCustomCount((c) =>
                          Math.max(1, Math.min(c, customMaxAvailable) - 5),
                        )
                      }
                    >
                      −5
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-xs"
                      disabled={customMaxAvailable === 0}
                      onClick={() =>
                        setCustomCount((c) =>
                          Math.min(customMaxAvailable, Math.min(c, customMaxAvailable) + 5),
                        )
                      }
                    >
                      ＋5
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={customMaxAvailable > 0 ? 1 : 0}
                  max={Math.max(1, customMaxAvailable)}
                  disabled={customMaxAvailable === 0}
                  value={effectiveCustomCount}
                  onChange={(e) => setCustomCount(Number(e.target.value))}
                  aria-label="カスタム出題数"
                />
                {customMaxAvailable > 0 && (
                  <div className="qcount-step-btns" style={{ flexWrap: 'wrap' }}>
                    {COUNT_PRESETS.filter((n) => n < customMaxAvailable).map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={
                          effectiveCustomCount === n
                            ? 'btn-primary btn-xs'
                            : 'btn-secondary btn-xs'
                        }
                        onClick={() => setCustomCount(n)}
                      >
                        {n}問
                      </button>
                    ))}
                    <button
                      type="button"
                      className={
                        effectiveCustomCount >= customMaxAvailable
                          ? 'btn-primary btn-xs'
                          : 'btn-secondary btn-xs'
                      }
                      onClick={() => setCustomCount(customMaxAvailable)}
                    >
                      全問 ({customMaxAvailable})
                    </button>
                  </div>
                )}
                <div className="qcount-note">
                  {customSelectedPrefs.size === 0
                    ? '1つ以上の都道府県を選択してください（全国全選択ボタンも利用できます）'
                    : '※カスタムモードでは途中セーブ・クリア記録は残りません（ミスした問題は復習リストへ記憶されます）'}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-primary"
                disabled={customSelectedPrefs.size === 0 || customMaxAvailable === 0}
                onClick={() => void handleStartCustom()}
              >
                カスタム開始
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Random Mode Modal */}
      {showRandomModal && (
        <div className="modal-backdrop" onClick={() => setShowRandomModal(false)}>
          <div
            className="modal-card confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-label="ランダムモード"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>ランダムモード</h3>
              <button
                type="button"
                className="modal-close-btn"
                aria-label="閉じる"
                onClick={() => setShowRandomModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="random-field">
                <label>出題プール</label>
                <div className="btn-group wrap">
                  <button
                    type="button"
                    className={randomPool === 'japan_munis' ? 'active' : ''}
                    onClick={() => setRandomPool('japan_munis')}
                  >
                    全市区町村 ({totalMunis})
                  </button>
                  <button
                    type="button"
                    className={randomPool === 'japan_cities' ? 'active' : ''}
                    onClick={() => setRandomPool('japan_cities')}
                  >
                    全国すべての市 ({totalCities})
                  </button>
                  <button
                    type="button"
                    className={randomPool === 'japan_prefs' ? 'active' : ''}
                    onClick={() => setRandomPool('japan_prefs')}
                  >
                    47都道府県
                  </button>
                  <button
                    type="button"
                    className={randomPool === 'geography_100' ? 'active' : ''}
                    onClick={() => setRandomPool('geography_100')}
                  >
                    日本自然地理100
                  </button>
                </div>
              </div>

              {randomPool !== 'geography_100' && (
                <div className="random-field">
                  <label>出題形式</label>
                  <div className="btn-group">
                    {(['puzzle', 'quiz', 'yomikata'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={randomPlayKind === k ? 'active' : ''}
                        onClick={() => setRandomPlayKind(k)}
                      >
                        {k === 'puzzle' ? 'パズル' : k === 'quiz' ? 'クイズ' : '読み方'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="question-count-box">
                <div className="qcount-top">
                  <span>
                    問題数: <strong>{effectiveRandomCount}</strong> / {randomMaxAvailable}
                  </span>
                  <div className="qcount-step-btns">
                    <button
                      type="button"
                      className="btn-ghost btn-xs"
                      onClick={() =>
                        setRandomCount((c) =>
                          Math.max(1, Math.min(c, randomMaxAvailable) - 5),
                        )
                      }
                    >
                      −5
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-xs"
                      onClick={() =>
                        setRandomCount((c) =>
                          Math.min(randomMaxAvailable, Math.min(c, randomMaxAvailable) + 5),
                        )
                      }
                    >
                      ＋5
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={1}
                  max={randomMaxAvailable}
                  value={effectiveRandomCount}
                  onChange={(e) => setRandomCount(Number(e.target.value))}
                  aria-label="ランダム出題数"
                />
                <div className="qcount-step-btns" style={{ flexWrap: 'wrap' }}>
                  {COUNT_PRESETS.filter((n) => n < randomMaxAvailable).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={
                        effectiveRandomCount === n
                          ? 'btn-primary btn-xs'
                          : 'btn-secondary btn-xs'
                      }
                      onClick={() => setRandomCount(n)}
                    >
                      {n}問
                    </button>
                  ))}
                  <button
                    type="button"
                    className={
                      effectiveRandomCount >= randomMaxAvailable
                        ? 'btn-primary btn-xs'
                        : 'btn-secondary btn-xs'
                    }
                    onClick={() => setRandomCount(randomMaxAvailable)}
                  >
                    全問 ({randomMaxAvailable})
                  </button>
                </div>
                <div className="qcount-note">
                  ※ランダムモードでは途中セーブ・クリア記録は残りません（ミスした問題は復習リストへ記憶されます）
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleStartRandom()}
              >
                ランダム開始
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Other Settings / Info Modal */}
      {showOtherModal && (
        <div className="modal-backdrop" onClick={() => setShowOtherModal(false)}>
          <div
            className="modal-card other-modal"
            role="dialog"
            aria-modal="true"
            aria-label="設定・更新履歴・情報"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>設定・更新履歴・情報</h3>
              <button
                type="button"
                className="modal-close-btn"
                aria-label="閉じる"
                onClick={() => setShowOtherModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="other-tabs-bar">
              {(
                [
                  ['settings', '基本設定'],
                  ['changelog', '更新履歴'],
                  ['source', '出典'],
                  ['credit', 'クレジット'],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  className={otherTab === k ? 'active' : ''}
                  onClick={() => setOtherTab(k)}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <div className="modal-body other-body">
              {otherTab === 'settings' && (
                <div className="other-settings-stack">
                  <div className="other-settings-banner">
                    <span>パズル・読み方・境界線などの全項目を設定</span>
                    <button
                      type="button"
                      className="btn-primary btn-xs"
                      onClick={() => {
                        setShowOtherModal(false);
                        setShowSettingsModal(true);
                      }}
                    >
                      ⚙ 詳細設定をすべて開く
                    </button>
                  </div>

                  <section className="other-settings-group">
                    <h4 className="config-section-heading">外観・基本</h4>
                    <div className="config-slider-row">
                      <span>外観テーマ</span>
                      <div className="segmented-control" role="group" aria-label="外観テーマ">
                        <button
                          type="button"
                          className={config.uiTheme === 'google' ? 'active' : ''}
                          aria-pressed={config.uiTheme === 'google'}
                          onClick={() => onConfigChange({ ...config, uiTheme: 'google' })}
                        >
                          モダン
                        </button>
                        <button
                          type="button"
                          className={config.uiTheme === 'classic' ? 'active' : ''}
                          aria-pressed={config.uiTheme === 'classic'}
                          onClick={() => onConfigChange({ ...config, uiTheme: 'classic' })}
                        >
                          クラシック
                        </button>
                      </div>
                    </div>
                    <div className="config-slider-row">
                      <span>地図スタイル</span>
                      <div className="segmented-control" role="group" aria-label="地図スタイル">
                        <button
                          type="button"
                          className={config.silhouette ? 'active' : ''}
                          aria-pressed={config.silhouette}
                          onClick={() => onConfigChange({ ...config, silhouette: true })}
                        >
                          白地図
                        </button>
                        <button
                          type="button"
                          className={!config.silhouette ? 'active' : ''}
                          aria-pressed={!config.silhouette}
                          onClick={() => onConfigChange({ ...config, silhouette: false })}
                        >
                          色分け図
                        </button>
                      </div>
                    </div>
                    <div className="config-slider-row">
                      <span>クイズ選択肢</span>
                      <div className="segmented-control" role="group" aria-label="クイズ選択肢の配置">
                        <button
                          type="button"
                          className={config.quizChoiceLayout === 'pointing' ? 'active' : ''}
                          aria-pressed={config.quizChoiceLayout === 'pointing'}
                          onClick={() =>
                            onConfigChange({ ...config, quizChoiceLayout: 'pointing' })
                          }
                        >
                          地図上
                        </button>
                        <button
                          type="button"
                          className={config.quizChoiceLayout === 'bottom' ? 'active' : ''}
                          aria-pressed={config.quizChoiceLayout === 'bottom'}
                          onClick={() =>
                            onConfigChange({ ...config, quizChoiceLayout: 'bottom' })
                          }
                        >
                          下部パネル
                        </button>
                      </div>
                    </div>
                  </section>

                  <section className="other-settings-group">
                    <h4 className="config-section-heading">サウンド</h4>
                    <div className="config-slider-row">
                      <span>SE音量 ({config.seVolume}%)</span>
                      <div className="config-slider-controls">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={config.seVolume}
                          aria-label="SE音量"
                          onChange={(e) =>
                            onConfigChange({ ...config, seVolume: Number(e.target.value) })
                          }
                        />
                        <button
                          type="button"
                          className="btn-secondary btn-xs"
                          onClick={() => playUiClick(config.seVolume)}
                        >
                          テスト音
                        </button>
                      </div>
                    </div>
                    <div className="config-grid">
                      <label className="config-check">
                        <input
                          type="checkbox"
                          checked={config.fixActionSound}
                          onChange={() =>
                            onConfigChange({
                              ...config,
                              fixActionSound: !config.fixActionSound,
                            })
                          }
                        />
                        <span>効果音を有効にする</span>
                      </label>
                    </div>
                  </section>

                  <section className="other-settings-group">
                    <h4 className="config-section-heading">保存・動作</h4>
                    <div className="config-slider-row">
                      <span>オートセーブ</span>
                      <div className="segmented-control" role="group" aria-label="オートセーブ頻度">
                        <button
                          type="button"
                          className={
                            config.autoSaveTiming === 'every_answer' ? 'active' : ''
                          }
                          aria-pressed={config.autoSaveTiming === 'every_answer'}
                          onClick={() =>
                            onConfigChange({ ...config, autoSaveTiming: 'every_answer' })
                          }
                        >
                          正解ごと
                        </button>
                        <button
                          type="button"
                          className={config.autoSaveTiming === 'on_exit' ? 'active' : ''}
                          aria-pressed={config.autoSaveTiming === 'on_exit'}
                          onClick={() =>
                            onConfigChange({ ...config, autoSaveTiming: 'on_exit' })
                          }
                        >
                          終了・切替時
                        </button>
                      </div>
                    </div>
                    <div className="config-slider-row">
                      <span>描画品質 / アニメ</span>
                      <div className="segmented-control" role="group" aria-label="描画品質">
                        <button
                          type="button"
                          className={config.quality !== 'low' ? 'active' : ''}
                          aria-pressed={config.quality !== 'low'}
                          onClick={() => onConfigChange({ ...config, quality: 'high' })}
                        >
                          標準・高
                        </button>
                        <button
                          type="button"
                          className={config.quality === 'low' ? 'active' : ''}
                          aria-pressed={config.quality === 'low'}
                          onClick={() => onConfigChange({ ...config, quality: 'low' })}
                        >
                          軽量
                        </button>
                      </div>
                    </div>
                    <div className="config-slider-row">
                      <span>FPS設定</span>
                      <div className="segmented-control" role="group" aria-label="FPS設定">
                        <button
                          type="button"
                          className={config.fpsMode === 'high' ? 'active' : ''}
                          aria-pressed={config.fpsMode === 'high'}
                          onClick={() => onConfigChange({ ...config, fpsMode: 'high' })}
                        >
                          60fps
                        </button>
                        <button
                          type="button"
                          className={config.fpsMode === 'low' ? 'active' : ''}
                          aria-pressed={config.fpsMode === 'low'}
                          onClick={() => onConfigChange({ ...config, fpsMode: 'low' })}
                        >
                          30fps（省電力）
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {otherTab === 'changelog' && (
                <div className="changelog-list">
                  {CHANGELOG_ITEMS.map((item) => (
                    <div key={item.ver} className="changelog-item">
                      <strong>{item.ver}</strong>
                      <ul>
                        {item.notes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              {otherTab === 'source' && (
                <div className="other-pane">
                  <h4>収録数値データの出典</h4>
                  <ul className="source-list">
                    <li>人口：総務省「平成31年住民基本台帳人口・世帯数」</li>
                    <li>面積：国土地理院「令和元年全国都道府県市区町村別面積調（7月1日時点）」</li>
                  </ul>
                </div>
              )}

              {otherTab === 'credit' && (
                <div className="other-pane">
                  <h4>地図・OSS クレジット</h4>
                  <p>
                    この地図の作成にあたっては、国土地理院の公開地理空間データ・標高データ、国土数値情報（行政区域データ N03-21）、および OpenStreetMap データを加工して使用しています。
                  </p>
                  <ul className="source-list">
                    <li>smartnews-smri/japan-topography (MIT / CC0, 国土数値情報 N03-21 加工)</li>
                    <li>OpenStreetMap contributors (ODbL, 日本の自然地理・河川・湖沼データ)</li>
                    <li>国土地理院 地理院地図 座標・標高データ（山岳・平野・標高表現）</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <ConfigModal
          config={config}
          onChange={onConfigChange}
          onClose={() => setShowSettingsModal(false)}
        />
      )}

      {showMistakeModal && (
        <MistakeReviewModal
          mistakes={mistakes}
          onStartReview={(spec) => {
            setShowMistakeModal(false);
            onStartGame(spec, null, 'title');
          }}
          onDeleteEntry={onDeleteMistakeEntry}
          onClearMode={onClearModeMistakes}
          onClearAll={onClearAllMistakes}
          onClose={() => setShowMistakeModal(false)}
        />
      )}

      {dataModalPieces && (
        <DataTableModal
          title={dataModalPieces.title}
          pieces={dataModalPieces.pieces}
          onSelectPiece={(piece) => {
            const viewId = dataModalPieces.viewAreaId;
            setDataModalPieces(null);
            setSelectedAreaId(null);
            setSelectedModeFilterIds(null);
            setSelectedModalTitle(null);
            onStartView(viewId, { focusPieceId: piece.id, returnTo: 'areas' });
          }}
          onClose={() => setDataModalPieces(null)}
        />
      )}
    </div>
  );
};
