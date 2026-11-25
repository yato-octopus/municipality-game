import React, { useMemo, useState } from 'react';
import { JAPAN_REGION_JUMPS } from '../data/gameCatalog';
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
import { DataTableModal } from './DataTableModal';
import { MistakeReviewModal } from './MistakeReviewModal';
import { SaveSlotsModal } from './SaveSlotsModal';

interface TitleScreenProps {
  areas: AreaDefinition[];
  prefsData: JapanPrefsData | null;
  totalMunis: number;
  totalWorld: number;
  config: ConfigState;
  records: Record<string, ModeBestRecord>;
  autoSave: SavedProgress | null;
  manualSaves: SavedProgress[];
  mistakes: MistakeEntry[];
  onConfigChange: (next: ConfigState) => void;
  onStartGame: (spec: GameSessionSpec, restore?: SavedProgress | null) => void;
  onStartView: (areaId: string) => void;
  onDeleteManualSave: (slotId: string) => void;
  onDeleteMistakeEntry: (key: string) => void;
  onClearModeMistakes: (modeId: string) => void;
  onClearAllMistakes: () => void;
}

const CHANGELOG_ITEMS: { ver: string; notes: string[] }[] = [
  { ver: 'Ver 1.2.0', notes: ['間違えた問題の自動記憶＆復習モードを追加', '左クリックドラッグによるGoogleマップ風の滑らかな地図移動に対応'] },
  { ver: 'Ver 1.1.0', notes: ['単一都道府県プレイ時にも周囲の都道府県白地図を表示', '世界地図モードに沖ノ鳥島・南鳥島等の地名を追加'] },
  { ver: 'Ver 1.0.0', notes: ['全国1,747市区町村・47都道府県・自然地理100選・世界284国地域の精巧白地図パズル＆クイズ、データ12タブ集計、カスタム・ランダム、タグ管理を公開'] },
];

export const TitleScreen: React.FC<TitleScreenProps> = ({
  areas,
  prefsData,
  totalMunis,
  totalWorld,
  config,
  records,
  autoSave,
  manualSaves,
  mistakes,
  onConfigChange,
  onStartGame,
  onStartView,
  onDeleteManualSave,
  onDeleteMistakeEntry,
  onClearModeMistakes,
  onClearAllMistakes,
}) => {
  const [screenMode, setScreenMode] = useState<'title' | 'areas'>('title');
  const [categoryTab, setCategoryTab] = useState<AreaCategory>('japan');
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedSubMode, setSelectedSubMode] = useState<AreaSubMode | null>(null);
  const [questionCount, setQuestionCount] = useState<number>(47);
  const [maxCountForSub, setMaxCountForSub] = useState<number>(47);

  const [showManualModal, setShowManualModal] = useState(false);
  const [showMistakeModal, setShowMistakeModal] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [showRandomModal, setShowRandomModal] = useState(false);
  const [showOtherModal, setShowOtherModal] = useState(false);
  const [otherTab, setOtherTab] = useState<
    'changelog' | 'sound' | 'quality' | 'autosave' | 'fps' | 'source' | 'credit'
  >('changelog');

  // GameInfo quick DataTable preview
  const [dataModalPieces, setDataModalPieces] = useState<{
    title: string;
    pieces: MapPieceItem[];
  } | null>(null);

  // Custom (Training2) state
  const [customSelectedPrefs, setCustomSelectedPrefs] = useState<Set<string>>(
    () => new Set(['11', '12', '13', '14']),
  );
  const [customPlayKind, setCustomPlayKind] = useState<'puzzle' | 'quiz' | 'yomikata'>(
    'puzzle',
  );
  const [customScope, setCustomScope] = useState<'municipalities' | 'prefectures'>(
    'municipalities',
  );
  const [customCount, setCustomCount] = useState(20);

  // Random mode state
  const [randomPool, setRandomPool] = useState<
    'japan_munis' | 'japan_prefs' | 'world' | 'geography_100'
  >('japan_munis');
  const [randomPlayKind, setRandomPlayKind] = useState<'puzzle' | 'quiz' | 'yomikata'>(
    'puzzle',
  );
  const [randomCount, setRandomCount] = useState(15);

  const selectedArea = useMemo(
    () => areas.find((a) => a.id === selectedAreaId) ?? null,
    [areas, selectedAreaId],
  );

  const customMaxAvailable = useMemo(() => {
    if (!prefsData) return 47;
    if (customScope === 'prefectures') {
      return Math.max(1, customSelectedPrefs.size || 47);
    }
    const sel = customSelectedPrefs.size > 0 ? customSelectedPrefs : new Set(prefsData.prefs.map((p) => p.code));
    return prefsData.prefs
      .filter((p) => sel.has(p.code))
      .reduce((acc, p) => acc + p.muniCount, 0);
  }, [prefsData, customScope, customSelectedPrefs]);

  const randomMaxAvailable = useMemo(() => {
    if (randomPool === 'japan_prefs') return 47;
    if (randomPool === 'world') return totalWorld || 284;
    if (randomPool === 'geography_100') return 100;
    return totalMunis || 1747;
  }, [randomPool, totalMunis, totalWorld]);

  const filteredAreas = useMemo(() => {
    if (categoryTab === 'japan') return areas.filter((a) => a.category === 'japan');
    if (categoryTab === 'municipalities')
      return areas.filter((a) => a.category === 'municipalities');
    if (categoryTab === 'world') return areas.filter((a) => a.category === 'world');
    return areas.filter((a) => a.category === 'prefecture');
  }, [areas, categoryTab]);

  const inferSpecBase = (area: AreaDefinition, mode: AreaSubMode): Omit<GameSessionSpec, 'sessionId' | 'questionCount' | 'maxCount'> => {
    const mapScope: GameSessionSpec['mapScope'] =
      area.id === 'world'
        ? 'world'
        : mode.geoCategory &&
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
      regionFilter: mode.regionFilter,
      isCustomOrRandom: false,
    };
  };

  const openAreaModal = async (area: AreaDefinition) => {
    playUiClick(config.seVolume);
    setSelectedAreaId(area.id);
    const defaultMode = area.modes[0] ?? null;
    setSelectedSubMode(defaultMode);
    if (defaultMode) {
      const base = inferSpecBase(area, defaultMode);
      const ids = await getModePoolIds(
        base.mapScope,
        base.prefFilterCodes,
        base.regionFilter,
        base.geoCategory,
      );
      const cnt = Math.max(1, ids.length);
      setMaxCountForSub(cnt);
      setQuestionCount(cnt);
    }
  };

  const handleSelectSubMode = async (area: AreaDefinition, mode: AreaSubMode) => {
    playUiClick(config.seVolume);
    setSelectedSubMode(mode);
    const base = inferSpecBase(area, mode);
    const ids = await getModePoolIds(
      base.mapScope,
      base.prefFilterCodes,
      base.regionFilter,
      base.geoCategory,
    );
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
    onStartGame(spec, null);
  };

  const handleStartCustom = async () => {
    const codes =
      customSelectedPrefs.size > 0
        ? Array.from(customSelectedPrefs)
        : prefsData?.prefs.map((p) => p.code) ?? [];
    const mapScope: GameSessionSpec['mapScope'] =
      customScope === 'prefectures' ? 'japan_prefs' : 'japan_munis';
    const poolIds = await getModePoolIds(mapScope, codes);
    const qCnt = Math.max(1, Math.min(poolIds.length, customCount));
    const fixedPieceIds = shuffleArray(poolIds).slice(0, qCnt);
    setShowCustomModal(false);
    onStartGame({
      sessionId: `custom_${Date.now()}`,
      areaId: 'custom',
      areaName: `カスタム（${codes.length}都道府県）`,
      modeId: `custom_${customPlayKind}`,
      modeLabel:
        customPlayKind === 'puzzle'
          ? 'パズル'
          : customPlayKind === 'quiz'
            ? 'クイズ'
            : '読み方',
      playKind: customPlayKind,
      mapScope,
      prefFilterCodes: codes,
      questionCount: qCnt,
      maxCount: poolIds.length,
      isCustomOrRandom: true,
      fixedPieceIds,
    });
  };

  const handleStartRandom = async () => {
    const effectivePlayKind =
      randomPool === 'world'
        ? 'puzzle'
        : randomPool === 'geography_100'
          ? 'geography_quiz'
          : randomPlayKind;
    const poolIds = await getModePoolIds(randomPool);
    const qCnt = Math.max(1, Math.min(poolIds.length, randomCount));
    const fixedPieceIds = shuffleArray(poolIds).slice(0, qCnt);
    const labelMap = {
      japan_munis: 'ランダム（全国市区町村）',
      japan_prefs: 'ランダム（47都道府県）',
      world: 'ランダム（世界地図）',
      geography_100: 'ランダム（自然地理100）',
    };
    setShowRandomModal(false);
    onStartGame({
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
      mapScope: randomPool,
      questionCount: qCnt,
      maxCount: poolIds.length,
      isCustomOrRandom: true,
      fixedPieceIds,
    });
  };

  const handleOpenDataFromGameInfo = async (area: AreaDefinition) => {
    const mode = selectedSubMode ?? area.modes[0];
    const base = mode
      ? inferSpecBase(area, mode)
      : {
          areaId: area.id,
          areaName: area.name,
          modeId: `${area.id}_data`,
          modeLabel: 'データ',
          playKind: 'view' as const,
          mapScope: (area.id === 'world'
            ? 'world'
            : area.id === '00_japan'
              ? 'japan_prefs'
              : 'japan_munis') as GameSessionSpec['mapScope'],
          prefFilterCodes: area.prefCode ? [area.prefCode] : undefined,
          isCustomOrRandom: false,
        };
    const loaded = await loadSessionMap({
      ...base,
      sessionId: `data_preview_${area.id}`,
      questionCount: area.totalCount,
      maxCount: area.totalCount,
    });
    setDataModalPieces({ title: area.name, pieces: loaded.allPoolPieces });
  };

  return (
    <div className="title-screen-shell">
      {screenMode === 'title' ? (
        <main className="title-hero-container">
          <div className="title-visual-card">
            <div className="title-badge">精巧白地図版 ・ 日本＆世界地理学習ゲーム</div>
            <h1 className="title-main-heading">
              全国市区町村パズル＆地理クイズ
            </h1>
            <p className="title-subtitle">
              全国 {totalMunis.toLocaleString()} 市区町村（北方領土6村・政令指定都市対応）、47都道府県・県庁所在地、日本の自然地理100選、世界{' '}
              {totalWorld} カ国地域の精巧白地図学習ゲーム
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
                          d={prefsData.paths[p.code]}
                          fill="#fbfaf6"
                          stroke="#475569"
                          strokeWidth={1.1}
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    ) : (
                      <path
                        key={p.code}
                        d={prefsData.paths[p.code]}
                        fill="#fbfaf6"
                        stroke="#475569"
                        strokeWidth={1.0}
                        vectorEffect="non-scaling-stroke"
                      />
                    ),
                  )}
                </g>
                <rect
                  x={28}
                  y={46}
                  width={280}
                  height={158}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
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
              <span className="menu-btn-sub">日本・都道府県・全市区町村・世界の国</span>
            </button>

            {autoSave && (
              <button
                type="button"
                className="menu-btn menu-btn-resume"
                onClick={() => {
                  playUiClick(config.seVolume);
                  onStartGame(autoSave.spec, autoSave);
                }}
              >
                <span className="menu-btn-title">前回のオートセーブから</span>
                <span className="menu-btn-sub">
                  {autoSave.title}（{autoSave.completedIds.length}/
                  {autoSave.targetPieceIds.length}）
                </span>
              </button>
            )}

            <button
              type="button"
              className={`menu-btn ${mistakes.length > 0 ? 'menu-btn-mistakes' : ''}`}
              onClick={() => {
                playUiClick(config.seVolume);
                setShowMistakeModal(true);
              }}
            >
              <span className="menu-btn-title">
                間違えた問題を復習（{mistakes.length}件）
              </span>
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
              <span className="menu-btn-sub">
                保存済みデータ: {manualSaves.length}件
              </span>
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
                  onStartView('00_japan');
                }}
              >
                <span className="menu-btn-title">白地図閲覧・データ</span>
                <span className="menu-btn-sub">標高図切替・12種集計テーブル</span>
              </button>
              <button
                type="button"
                className="menu-btn"
                onClick={() => {
                  playUiClick(config.seVolume);
                  setShowOtherModal(true);
                }}
              >
                <span className="menu-btn-title">その他・設定・出典</span>
                <span className="menu-btn-sub">更新履歴 / 画質 / AutoSave / FPS</span>
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
              onClick={() => setCategoryTab('japan')}
            >
              日本（国・自然地理・県庁）
            </button>
            <button
              type="button"
              className={categoryTab === 'prefecture' ? 'active' : ''}
              onClick={() => setCategoryTab('prefecture')}
            >
              都道府県別（47都道府県）
            </button>
            <button
              type="button"
              className={categoryTab === 'municipalities' ? 'active' : ''}
              onClick={() => setCategoryTab('municipalities')}
            >
              全国・地方別 市町村
            </button>
            <button
              type="button"
              className={categoryTab === 'world' ? 'active' : ''}
              onClick={() => setCategoryTab('world')}
            >
              世界の国と地名
            </button>
          </div>

          <div className="area-cards-grid">
            {filteredAreas.map((a) => {
              const clearedModes = a.modes.filter((m) => (records[m.id]?.clearCount ?? 0) > 0).length;
              return (
                <button
                  key={a.id}
                  type="button"
                  className="area-card-btn"
                  onClick={() => void openAreaModal(a)}
                >
                  <div className="area-card-top">
                    <span className="area-card-ruby">{a.ruby}</span>
                    {clearedModes > 0 && (
                      <span className="area-card-clear-badge">
                        ✓ {clearedModes}/{a.modes.length}
                      </span>
                    )}
                  </div>
                  <div className="area-card-name">{a.name}</div>
                  <div className="area-card-sub">{a.subTitle}</div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* GameInfo Modal */}
      {selectedArea && (
        <div className="modal-backdrop" onClick={() => setSelectedAreaId(null)}>
          <div
            className="modal-card gameinfo-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="gameinfo-nav-row">
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  onClick={() => {
                    const idx = areas.findIndex((a) => a.id === selectedArea.id);
                    const prev = areas[(idx - 1 + areas.length) % areas.length];
                    void openAreaModal(prev);
                  }}
                >
                  ◀ Prev
                </button>
                <div>
                  <span className="gameinfo-ruby">{selectedArea.ruby}</span>
                  <h3>{selectedArea.name}</h3>
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  onClick={() => {
                    const idx = areas.findIndex((a) => a.id === selectedArea.id);
                    const next = areas[(idx + 1) % areas.length];
                    void openAreaModal(next);
                  }}
                >
                  Next ▶
                </button>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSelectedAreaId(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="gameinfo-meta-strip">
                <span>人口: {selectedArea.population.toLocaleString()}人</span>
                {selectedArea.electionTurnout != null && (
                  <span>参院選投票率: {selectedArea.electionTurnout.toFixed(2)}%</span>
                )}
                <div className="gameinfo-quick-links">
                  <button
                    type="button"
                    className="btn-secondary btn-xs"
                    onClick={() => {
                      const id = selectedArea.id;
                      setSelectedAreaId(null);
                      onStartView(id);
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

              <h4>モード一覧</h4>
              <div className="submode-list">
                {selectedArea.modes.map((m) => {
                  const rec = records[m.id];
                  const modeMistakeCount = mistakes.filter((x) => x.modeId === m.id).length;
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
                          <span className="submode-mistake-pill">
                            復習 {modeMistakeCount}
                          </span>
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
                      問題数: <strong>{questionCount}</strong> / {maxCountForSub}
                    </span>
                    <div className="qcount-step-btns">
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        onClick={() => setQuestionCount((c) => Math.max(1, c - 1))}
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
                    </div>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={maxCountForSub}
                    value={questionCount}
                    onChange={(e) => setQuestionCount(Number(e.target.value))}
                  />
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
                        onStartGame({
                          ...base,
                          sessionId: `review_${selectedSubMode.id}_${Date.now()}`,
                          modeLabel: `${selectedSubMode.label}（復習）`,
                          questionCount: uniqueIds.length,
                          maxCount: uniqueIds.length,
                          isCustomOrRandom: true,
                          isReviewMode: true,
                          reviewSourceKeys,
                          fixedPieceIds: uniqueIds,
                        });
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
                      onStartGame(autoSave.spec, autoSave);
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
            onStartGame(s.spec, s);
          }}
          onDeleteSave={onDeleteManualSave}
          onClose={() => setShowManualModal(false)}
        />
      )}

      {/* Custom Mode Modal (Training2) */}
      {showCustomModal && (
        <div className="modal-backdrop" onClick={() => setShowCustomModal(false)}>
          <div className="modal-card custom-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>カスタムモード（複数エリア組み合わせ）</h3>
              <button
                type="button"
                className="modal-close-btn"
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
                {JAPAN_REGION_JUMPS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="btn-secondary btn-xs"
                    onClick={() => {
                      setCustomSelectedPrefs((prev) => {
                        const next = new Set(prev);
                        const allOn = r.prefCodes.every((c) => next.has(c));
                        for (const c of r.prefCodes) {
                          if (allOn) next.delete(c);
                          else next.add(c);
                        }
                        return next;
                      });
                    }}
                  >
                    {r.short}
                  </button>
                ))}
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
                          fill={active ? '#fb923c' : '#fbfaf6'}
                          stroke={active ? '#9a3412' : '#475569'}
                          strokeWidth={active ? 1.5 : 0.9}
                          vectorEffect="non-scaling-stroke"
                          className="map-piece-clickable"
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
                    出題数: <strong>{Math.min(customCount, customMaxAvailable)}</strong> /{' '}
                    {customMaxAvailable}
                  </span>
                  <div className="qcount-step-btns">
                    <button
                      type="button"
                      className="btn-ghost btn-xs"
                      onClick={() => setCustomCount((c) => Math.max(1, c - 5))}
                    >
                      −5
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-xs"
                      onClick={() =>
                        setCustomCount((c) => Math.min(customMaxAvailable, c + 5))
                      }
                    >
                      ＋5
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={1}
                  max={Math.max(1, customMaxAvailable)}
                  value={Math.min(customCount, customMaxAvailable)}
                  onChange={(e) => setCustomCount(Number(e.target.value))}
                />
                <div className="qcount-note">
                  ※カスタムモードでは途中セーブ・クリア記録は残りません
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-primary" onClick={() => void handleStartCustom()}>
                カスタム開始
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Random Mode Modal */}
      {showRandomModal && (
        <div className="modal-backdrop" onClick={() => setShowRandomModal(false)}>
          <div className="modal-card confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>ランダムモード</h3>
              <button
                type="button"
                className="modal-close-btn"
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
                    className={randomPool === 'japan_prefs' ? 'active' : ''}
                    onClick={() => setRandomPool('japan_prefs')}
                  >
                    47都道府県
                  </button>
                  <button
                    type="button"
                    className={randomPool === 'world' ? 'active' : ''}
                    onClick={() => setRandomPool('world')}
                  >
                    世界の国と地名 ({totalWorld})
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

              {randomPool !== 'world' && randomPool !== 'geography_100' && (
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
                    問題数: <strong>{Math.min(randomCount, randomMaxAvailable)}</strong> /{' '}
                    {randomMaxAvailable}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={randomMaxAvailable}
                  value={Math.min(randomCount, randomMaxAvailable)}
                  onChange={(e) => setRandomCount(Number(e.target.value))}
                />
                <div className="qcount-note">
                  ※ランダムモードでは途中セーブ・クリア記録は残りません
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-primary" onClick={() => void handleStartRandom()}>
                ランダム開始
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Other Settings / Info Modal */}
      {showOtherModal && (
        <div className="modal-backdrop" onClick={() => setShowOtherModal(false)}>
          <div className="modal-card other-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>その他・環境設定・情報</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowOtherModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="other-tabs-bar">
              {(
                [
                  ['changelog', '更新履歴'],
                  ['sound', 'サウンド'],
                  ['quality', '画質設定'],
                  ['autosave', 'オートセーブ'],
                  ['fps', 'FPS設定'],
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

              {otherTab === 'sound' && (
                <div className="other-pane">
                  <label className="config-slider-row">
                    <span>SE音量 ({config.seVolume}%)</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={config.seVolume}
                      onChange={(e) =>
                        onConfigChange({ ...config, seVolume: Number(e.target.value) })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => playUiClick(config.seVolume)}
                  >
                    テスト音を鳴らす
                  </button>
                </div>
              )}

              {otherTab === 'quality' && (
                <div className="other-pane">
                  <p>地図ベクター描画・操作アニメーション品質を選択します。</p>
                  <div className="btn-group">
                    {(
                      [
                        ['high', '高画質'],
                        ['medium', '標準'],
                        ['low', '軽量'],
                      ] as const
                    ).map(([q, lbl]) => (
                      <button
                        key={q}
                        type="button"
                        className={config.quality === q ? 'active' : ''}
                        onClick={() => onConfigChange({ ...config, quality: q })}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {otherTab === 'autosave' && (
                <div className="other-pane radio-stack">
                  <label className="radio-card">
                    <input
                      type="radio"
                      name="autosave"
                      checked={config.autoSaveTiming === 'every_answer'}
                      onChange={() =>
                        onConfigChange({ ...config, autoSaveTiming: 'every_answer' })
                      }
                    />
                    <div>
                      <strong>正解ごとにセーブする</strong>
                      <p>突然終了しても直前までの進行が残ります</p>
                    </div>
                  </label>
                  <label className="radio-card">
                    <input
                      type="radio"
                      name="autosave"
                      checked={config.autoSaveTiming === 'on_exit'}
                      onChange={() =>
                        onConfigChange({ ...config, autoSaveTiming: 'on_exit' })
                      }
                    />
                    <div>
                      <strong>タイトルにもどる、アプリ切替時にセーブする</strong>
                      <p>解答毎の書込負荷を抑えます</p>
                    </div>
                  </label>
                </div>
              )}

              {otherTab === 'fps' && (
                <div className="other-pane radio-stack">
                  <label className="radio-card">
                    <input
                      type="radio"
                      name="fps"
                      checked={config.fpsMode === 'high'}
                      onChange={() => onConfigChange({ ...config, fpsMode: 'high' })}
                    />
                    <div>
                      <strong>FPSを高くする（滑らか / 60fps）</strong>
                    </div>
                  </label>
                  <label className="radio-card">
                    <input
                      type="radio"
                      name="fps"
                      checked={config.fpsMode === 'low'}
                      onChange={() => onConfigChange({ ...config, fpsMode: 'low' })}
                    />
                    <div>
                      <strong>FPSを低くする（省電力 / 30fps）</strong>
                    </div>
                  </label>
                </div>
              )}

              {otherTab === 'source' && (
                <div className="other-pane">
                  <h4>収録数値データの出典</h4>
                  <ul className="source-list">
                    <li>人口：総務省「平成31年住民基本台帳人口・世帯数」</li>
                    <li>投票率：総務省「令和元年7月21日執行 参議院議員通常選挙 速報結果」</li>
                    <li>面積：国土地理院「令和元年全国都道府県市区町村別面積調（7月1日時点）」</li>
                  </ul>
                </div>
              )}

              {otherTab === 'credit' && (
                <div className="other-pane">
                  <h4>地図・OSS クレジット</h4>
                  <p>
                    この地図の作成にあたっては、国土地理院長の承認を得て、同院発行の「白地図」「自分で作る色別標高図」に準拠した公開地理空間データ（国土数値情報 N03-21 / Natural Earth 50m）を加工して使用しています。
                  </p>
                  <ul className="source-list">
                    <li>smartnews-smri/japan-topography (MIT / CC0, 国土数値情報 N03-21 加工)</li>
                    <li>world-atlas / Natural Earth 50m (ISC License)</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showMistakeModal && (
        <MistakeReviewModal
          mistakes={mistakes}
          onStartReview={(spec) => {
            setShowMistakeModal(false);
            onStartGame(spec, null);
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
          onSelectPiece={() => {
            // Switch straight to ViewMode of current area if inspecting from GameInfo
            if (selectedArea) {
              const id = selectedArea.id;
              setDataModalPieces(null);
              setSelectedAreaId(null);
              onStartView(id);
            }
          }}
          onClose={() => setDataModalPieces(null)}
        />
      )}
    </div>
  );
};
