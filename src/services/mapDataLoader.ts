import {
  HOKKAIDO_SUB_REGIONS,
  TIHOU_MUNI_GROUPS,
} from '../data/gameCatalog';
import type {
  BBox,
  GameSessionSpec,
  GeographyFeature,
  JapanPrefsData,
  MapPieceItem,
  MunicipalityMeta,
  PrefectureMeta,
  WorldMapData,
  WorldRegionMeta,
} from '../types/game';

export interface InsetBoxSpec {
  id: 'okinawa' | 'izu' | 'ogasawara';
  label: string;
  box: BBox;
  clipId: string;
  tx: number;
  ty: number;
  scale: number;
}

export interface LoadedSessionMap {
  targetPieces: MapPieceItem[];
  contextPieces: MapPieceItem[];
  allPoolPieces: MapPieceItem[];
  bgPrefPieces: MapPieceItem[];
  viewBBox: BBox;
  insets: InsetBoxSpec[];
  okinawaTransform: { scale: number; tx: number; ty: number } | null;
  tokyoInsetTransforms: {
    izu: InsetBoxSpec | null;
    ogasawara: InsetBoxSpec | null;
  };
}

const DATA_BASE = `${import.meta.env.BASE_URL}data`;

let prefsPromise: Promise<JapanPrefsData> | null = null;
let muniIndexPromise: Promise<MunicipalityMeta[]> | null = null;
let muniPathsPromise: Promise<Record<string, string>> | null = null;
let geo100Promise: Promise<GeographyFeature[]> | null = null;
let worldPromise: Promise<WorldMapData> | null = null;

async function fetchJson<T>(relPath: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${relPath}`);
  if (!res.ok) {
    throw new Error(`地図データの読み込みに失敗しました (${relPath}: ${res.status})`);
  }
  return (await res.json()) as T;
}

export function loadJapanPrefs(): Promise<JapanPrefsData> {
  if (!prefsPromise) prefsPromise = fetchJson<JapanPrefsData>('japan_prefs.json');
  return prefsPromise;
}

export function loadMuniIndex(): Promise<MunicipalityMeta[]> {
  if (!muniIndexPromise) muniIndexPromise = fetchJson<MunicipalityMeta[]>('muni/index.json');
  return muniIndexPromise;
}

export function loadMuniPaths(): Promise<Record<string, string>> {
  if (!muniPathsPromise) muniPathsPromise = fetchJson<Record<string, string>>('muni/all_paths.json');
  return muniPathsPromise;
}

export function loadGeography100(): Promise<GeographyFeature[]> {
  if (!geo100Promise) geo100Promise = fetchJson<GeographyFeature[]>('geography_100.json');
  return geo100Promise;
}

export function loadWorldMap(): Promise<WorldMapData> {
  if (!worldPromise) worldPromise = fetchJson<WorldMapData>('world_map.json');
  return worldPromise;
}

/** Normalize kana for Yomikata checking (keep hiragana + prolonged mark) */
export function normalizeKana(text: string): string {
  return text
    .trim()
    .replace(/[\s・\u3000「」()（）]/g, '')
    .replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function cleanRegionLabel(raw: string): string {
  return raw.replace(/「[^」]*」/g, '');
}

// Nationwide Okinawa inset transform into Sea of Japan box [28, 46, 308, 204]
export const OKINAWA_INSET_BOX: BBox = [28, 46, 308, 204];
const OKINAWA_SCALE = 0.72;
const OKINAWA_TX = 40 - -160.45 * OKINAWA_SCALE;
const OKINAWA_TY = 60 - 973.3 * OKINAWA_SCALE;
export const OKINAWA_NATIONWIDE_TRANSFORM = {
  scale: OKINAWA_SCALE,
  tx: OKINAWA_TX,
  ty: OKINAWA_TY,
};

// Tokyo insets below mainland/Kanagawa when viewing full Tokyo standalone
const TOKYO_IZU_BOX: BBox = [507, 619, 531, 646];
const TOKYO_OGA_BOX: BBox = [533, 619, 555, 646];

function makeTransformFromSrcToDest(src: BBox, dest: BBox, pad = 2): { scale: number; tx: number; ty: number } {
  const sw = Math.max(1e-3, src[2] - src[0]);
  const sh = Math.max(1e-3, src[3] - src[1]);
  const dw = Math.max(1e-3, dest[2] - dest[0] - pad * 2);
  const dh = Math.max(1e-3, dest[3] - dest[1] - pad * 2);
  const scale = Math.min(dw / sw, dh / sh);
  const ox = dest[0] + pad + (dw - sw * scale) / 2;
  const oy = dest[1] + pad + (dh - sh * scale) / 2;
  return {
    scale,
    tx: ox - src[0] * scale,
    ty: oy - src[1] * scale,
  };
}

function transformPt(pt: [number, number], tr: { scale: number; tx: number; ty: number }): [number, number] {
  return [pt[0] * tr.scale + tr.tx, pt[1] * tr.scale + tr.ty];
}

function transformBBox(b: BBox, tr: { scale: number; tx: number; ty: number }): BBox {
  return [
    b[0] * tr.scale + tr.tx,
    b[1] * tr.scale + tr.ty,
    b[2] * tr.scale + tr.tx,
    b[3] * tr.scale + tr.ty,
  ];
}

function unionBBoxes(boxes: BBox[], padRatio = 0.08): BBox {
  if (boxes.length === 0) return [0, 0, 1000, 1000];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b[0] < minX) minX = b[0];
    if (b[1] < minY) minY = b[1];
    if (b[2] > maxX) maxX = b[2];
    if (b[3] > maxY) maxY = b[3];
  }
  const w = Math.max(8, maxX - minX);
  const h = Math.max(8, maxY - minY);
  const px = w * padRatio;
  const py = h * padRatio;
  return [minX - px, minY - py, maxX + px, maxY + py];
}

function isTokyoIzuCode(code: string): boolean {
  return code >= '13361' && code <= '13402';
}

function isTokyoOgasawaraCode(code: string): boolean {
  return code === '13421';
}

function prefToPiece(
  p: PrefectureMeta,
  path: string,
  okiTransform: { scale: number; tx: number; ty: number } | null,
  geoCategory?: GameSessionSpec['geoCategory'],
): MapPieceItem {
  const isOki = p.code === '47';
  const rawBBox = p.bboxMain ?? p.bbox;
  const rawCenter = p.center;
  const rawCapCenter = p.capitalCenter;

  const bbox = isOki && okiTransform ? transformBBox(rawBBox, okiTransform) : rawBBox;
  const center = isOki && okiTransform ? transformPt(rawCenter, okiTransform) : rawCenter;
  const capitalCenter = isOki && okiTransform ? transformPt(rawCapCenter, okiTransform) : rawCapCenter;

  const isCap = geoCategory === 'capital_q' || geoCategory === 'capital_y';
  return {
    id: `pref_${p.code}`,
    name: p.name,
    ruby: p.ruby,
    answerKanji: isCap ? p.capital : p.name,
    answerRuby: isCap ? p.capitalRuby : p.ruby,
    prefCode: p.code,
    prefName: p.name,
    population: p.population,
    areaKm2: p.areaKm2,
    electionTurnout: p.electionTurnout,
    regionLabel: cleanRegionLabel(p.regions[0] ?? ''),
    adminAreaLabel: p.capital,
    countyLabel: '',
    wiki: p.wiki,
    desc: isCap ? `${p.name}（${p.ruby}）の県庁所在地は？` : undefined,
    path,
    geometryType: 'path',
    bbox,
    center,
    capitalCenter,
    areaPx: p.areaPx,
    isOkinawa: isOki,
  };
}

function muniToPiece(
  m: MunicipalityMeta,
  path: string,
  prefNameMap: Map<string, string>,
  okiTransform: { scale: number; tx: number; ty: number } | null,
  tokyoInsets: { izu: InsetBoxSpec | null; ogasawara: InsetBoxSpec | null },
): MapPieceItem {
  const isOki = m.prefCode === '47';
  const isIzu = isTokyoIzuCode(m.code);
  const isOga = isTokyoOgasawaraCode(m.code);

  // Use Chichijima/Hahajima visual center/bbox inside Ogasawara inset (avoids Minami-Torishima 1140,1144 stretching bbox)
  let baseBBox: BBox = isOga ? [640, 982, 652, 1036] : m.bbox;
  let baseCenter: [number, number] = m.center;

  if (isOki && okiTransform) {
    baseBBox = transformBBox(baseBBox, okiTransform);
    baseCenter = transformPt(baseCenter, okiTransform);
  } else if (isIzu && tokyoInsets.izu) {
    baseBBox = transformBBox(baseBBox, tokyoInsets.izu);
    baseCenter = transformPt(baseCenter, tokyoInsets.izu);
  } else if (isOga && tokyoInsets.ogasawara) {
    baseBBox = transformBBox(baseBBox, tokyoInsets.ogasawara);
    baseCenter = transformPt(baseCenter, tokyoInsets.ogasawara);
  }

  return {
    id: m.code,
    name: m.name,
    ruby: m.ruby,
    answerKanji: m.name,
    answerRuby: m.ruby,
    prefCode: m.prefCode,
    prefName: prefNameMap.get(m.prefCode) ?? '',
    population: m.population,
    areaKm2: m.areaKm2,
    regionLabel: cleanRegionLabel(m.areaZone),
    adminAreaLabel: cleanRegionLabel(m.subpref),
    countyLabel: m.county,
    wiki: m.wiki,
    path,
    geometryType: 'path',
    bbox: baseBBox,
    center: baseCenter,
    areaPx: m.areaPx,
    isOkinawa: isOki,
    isTokyoIsland: isIzu || isOga,
  };
}

function geoToPiece(f: GeographyFeature): MapPieceItem {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of f.pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const catLabelMap: Record<GeographyFeature['category'], string> = {
    mountains: '山脈・山地・高地',
    mountain: '山',
    river: '河川',
    plain: '平野',
    lake: '湖',
  };
  return {
    id: f.id,
    name: f.name,
    ruby: f.ruby,
    answerKanji: f.name,
    answerRuby: f.ruby,
    population: 0,
    areaKm2: 0,
    regionLabel: catLabelMap[f.category],
    adminAreaLabel: catLabelMap[f.category],
    countyLabel: '',
    wiki: f.wiki,
    desc: f.desc,
    linePts: f.pts,
    geometryType: f.geometryType === 'line' ? 'line_pts' : 'polygon_pts',
    bbox: [minX - 18, minY - 18, maxX + 18, maxY + 18],
    center: f.center,
    areaPx: 120,
  };
}

function worldToPiece(r: WorldRegionMeta, path: string): MapPieceItem {
  return {
    id: r.id,
    name: r.name,
    ruby: r.ruby,
    answerKanji: r.name,
    answerRuby: r.ruby,
    population: r.population,
    areaKm2: r.areaKm2,
    regionLabel: r.place,
    adminAreaLabel: r.en,
    countyLabel: r.alpha3,
    wiki: r.wiki,
    path,
    geometryType: 'path',
    bbox: r.bbox,
    center: r.center,
    areaPx: r.areaPx,
    isMarker: r.isMarker,
  };
}

export function shuffleArray<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function filterMunisByRegion(
  munis: MunicipalityMeta[],
  prefFilterCodes?: string[],
  regionFilter?: string,
): MunicipalityMeta[] {
  let filtered = munis;
  if (prefFilterCodes && prefFilterCodes.length > 0) {
    const set = new Set(prefFilterCodes);
    filtered = filtered.filter((m) => set.has(m.prefCode));
  }
  if (!regionFilter) return filtered;

  const tihou = TIHOU_MUNI_GROUPS.find((t) => t.key === regionFilter);
  if (tihou) {
    const tSet = new Set(tihou.prefCodes);
    return filtered.filter((m) => tSet.has(m.prefCode));
  }
  const hok = HOKKAIDO_SUB_REGIONS.find((h) => h.key === regionFilter);
  if (hok) {
    return filtered.filter((m) => m.prefCode === '01' && m.areaZone.includes(hok.zoneMatch));
  }
  if (regionFilter === 'tokyo23') {
    return filtered.filter((m) => m.prefCode === '13' && m.code >= '13101' && m.code <= '13123');
  }
  if (regionFilter === 'tokyo23Other') {
    return filtered.filter((m) => m.prefCode === '13' && m.code >= '13201' && m.code < '13361');
  }
  if (regionFilter === 'tokyo_island') {
    return filtered.filter((m) => m.prefCode === '13' && m.code >= '13361');
  }
  return filtered;
}

const WORLD_SUB_VIEWBOX: Record<string, BBox> = {
  world_europe: [425, 32, 635, 178],
  world_africa: [432, 152, 650, 412],
  world_middle_east: [565, 130, 700, 255],
  world_asia: [590, 32, 955, 290],
  world_asia_south_east: [718, 172, 895, 305],
  world_oceania: [780, 232, 995, 455],
  world_america: [25, 32, 418, 458],
};

export async function loadSessionMap(spec: GameSessionSpec): Promise<LoadedSessionMap> {
  if (spec.mapScope === 'world') {
    const world = await loadWorldMap();
    const allPieces = world.regions.map((r) => worldToPiece(r, world.paths[r.id] ?? ''));
    const pool = spec.regionFilter
      ? world.regions
          .filter((r) => r.modes.includes(spec.regionFilter!))
          .map((r) => worldToPiece(r, world.paths[r.id] ?? ''))
      : allPieces;

    const targetIds = spec.fixedPieceIds ? new Set(spec.fixedPieceIds) : null;
    const targets = targetIds
      ? spec.fixedPieceIds!
          .map((id) => pool.find((p) => p.id === id))
          .filter((x): x is MapPieceItem => Boolean(x))
      : pool;

    const viewBBox: BBox =
      spec.regionFilter && WORLD_SUB_VIEWBOX[spec.regionFilter]
        ? WORLD_SUB_VIEWBOX[spec.regionFilter]
        : [0, 12, 1000, 475];

    return {
      targetPieces: targets,
      contextPieces: allPieces,
      allPoolPieces: pool,
      bgPrefPieces: [],
      viewBBox,
      insets: [],
      okinawaTransform: null,
      tokyoInsetTransforms: { izu: null, ogasawara: null },
    };
  }

  const prefsData = await loadJapanPrefs();
  const isOkinawaOnly =
    spec.prefFilterCodes?.length === 1 && spec.prefFilterCodes[0] === '47';
  const okiTransform = isOkinawaOnly ? null : OKINAWA_NATIONWIDE_TRANSFORM;

  if (spec.mapScope === 'japan_prefs') {
    const allPrefs = prefsData.prefs.map((p) =>
      prefToPiece(p, prefsData.paths[p.code] ?? '', okiTransform, spec.geoCategory),
    );
    const pool =
      spec.prefFilterCodes && spec.prefFilterCodes.length > 0
        ? allPrefs.filter((p) => spec.prefFilterCodes!.includes(p.prefCode ?? ''))
        : allPrefs;
    const targets = spec.fixedPieceIds
      ? spec.fixedPieceIds
          .map((id) => pool.find((p) => p.id === id))
          .filter((x): x is MapPieceItem => Boolean(x))
      : pool;

    const insets: InsetBoxSpec[] = okiTransform
      ? [
          {
            id: 'okinawa',
            label: '沖縄県',
            box: OKINAWA_INSET_BOX,
            clipId: 'clip-okinawa-inset',
            ...okiTransform,
          },
        ]
      : [];

    const viewBBox: BBox =
      spec.prefFilterCodes && spec.prefFilterCodes.length > 0 && spec.prefFilterCodes.length < 47
        ? unionBBoxes(targets.map((p) => p.bbox), 0.14)
        : [22, 34, 940, 920];

    return {
      targetPieces: targets,
      contextPieces: allPrefs,
      allPoolPieces: pool,
      bgPrefPieces: allPrefs,
      viewBBox,
      insets,
      okinawaTransform: okiTransform,
      tokyoInsetTransforms: { izu: null, ogasawara: null },
    };
  }

  if (spec.mapScope === 'geography_100') {
    const geo = await loadGeography100();
    const bgPrefs = prefsData.prefs.map((p) =>
      prefToPiece(p, prefsData.paths[p.code] ?? '', okiTransform),
    );
    const cat = spec.geoCategory;
    const filteredGeo =
      cat === 'mountains' || cat === 'mountain' || cat === 'river' || cat === 'plain' || cat === 'lake'
        ? geo.filter((g) => g.category === cat)
        : geo;
    const pool = filteredGeo.map(geoToPiece);
    const targets = spec.fixedPieceIds
      ? spec.fixedPieceIds
          .map((id) => pool.find((p) => p.id === id))
          .filter((x): x is MapPieceItem => Boolean(x))
      : pool;

    return {
      targetPieces: targets,
      contextPieces: pool,
      allPoolPieces: pool,
      bgPrefPieces: bgPrefs,
      viewBBox: [22, 34, 940, 920],
      insets: okiTransform
        ? [
            {
              id: 'okinawa',
              label: '沖縄県',
              box: OKINAWA_INSET_BOX,
              clipId: 'clip-okinawa-inset',
              ...okiTransform,
            },
          ]
        : [],
      okinawaTransform: okiTransform,
      tokyoInsetTransforms: { izu: null, ogasawara: null },
    };
  }

  // japan_munis
  const [muniIndex, muniPaths] = await Promise.all([loadMuniIndex(), loadMuniPaths()]);
  const prefNameMap = new Map(prefsData.prefs.map((p) => [p.code, p.name]));
  const bgPrefs = prefsData.prefs.map((p) =>
    prefToPiece(p, prefsData.paths[p.code] ?? '', okiTransform),
  );

  const isSingleTokyo =
    spec.prefFilterCodes?.length === 1 && spec.prefFilterCodes[0] === '13';
  const isTokyoIslandOnly = isSingleTokyo && spec.regionFilter === 'tokyo_island';

  let tokyoIzuSpec: InsetBoxSpec | null = null;
  let tokyoOgaSpec: InsetBoxSpec | null = null;
  if (isTokyoIslandOnly) {
    const ogaBox: BBox = [556, 634, 590, 696];
    const ogaTr = makeTransformFromSrcToDest([640, 982, 652, 1036], ogaBox, 4);
    tokyoOgaSpec = {
      id: 'ogasawara',
      label: '小笠原村（父島・母島）',
      box: ogaBox,
      clipId: 'clip-ogasawara-inset',
      ...ogaTr,
    };
  } else if (isSingleTokyo) {
    const izuTr = makeTransformFromSrcToDest([516, 632, 550, 754], TOKYO_IZU_BOX, 2.2);
    const ogaTr = makeTransformFromSrcToDest([640, 982, 652, 1036], TOKYO_OGA_BOX, 2.2);
    tokyoIzuSpec = {
      id: 'izu',
      label: '伊豆諸島',
      box: TOKYO_IZU_BOX,
      clipId: 'clip-izu-inset',
      ...izuTr,
    };
    tokyoOgaSpec = {
      id: 'ogasawara',
      label: '小笠原諸島',
      box: TOKYO_OGA_BOX,
      clipId: 'clip-ogasawara-inset',
      ...ogaTr,
    };
  }

  const tokyoInsetTransforms = { izu: tokyoIzuSpec, ogasawara: tokyoOgaSpec };
  const filteredRaw = filterMunisByRegion(muniIndex, spec.prefFilterCodes, spec.regionFilter);
  const pool = filteredRaw.map((m) =>
    muniToPiece(m, muniPaths[m.code] ?? '', prefNameMap, okiTransform, tokyoInsetTransforms),
  );

  // Context pieces = all munis of same pref when zoomed in on a subregion (e.g. 道央 shows all 北海道 munis; 23区 shows all 東京都 munis!)
  const contextRaw =
    spec.regionFilter && spec.prefFilterCodes?.length === 1
      ? muniIndex.filter((m) => m.prefCode === spec.prefFilterCodes![0])
      : filteredRaw;
  const contextPieces =
    contextRaw.length === filteredRaw.length
      ? pool
      : contextRaw.map((m) =>
          muniToPiece(m, muniPaths[m.code] ?? '', prefNameMap, okiTransform, tokyoInsetTransforms),
        );

  const targets = spec.fixedPieceIds
    ? spec.fixedPieceIds
        .map((id) => pool.find((p) => p.id === id))
        .filter((x): x is MapPieceItem => Boolean(x))
    : pool;

  const insets: InsetBoxSpec[] = [];
  if (okiTransform && (!spec.prefFilterCodes || spec.prefFilterCodes.includes('47') || spec.prefFilterCodes.length === 47)) {
    insets.push({
      id: 'okinawa',
      label: '沖縄県',
      box: OKINAWA_INSET_BOX,
      clipId: 'clip-okinawa-inset',
      ...okiTransform,
    });
  }
  if (tokyoIzuSpec) insets.push(tokyoIzuSpec);
  if (tokyoOgaSpec) insets.push(tokyoOgaSpec);

  let viewBBox: BBox;
  if (isTokyoIslandOnly) {
    viewBBox = [510, 626, 598, 760];
  } else if (isSingleTokyo && !spec.regionFilter) {
    viewBBox = [504, 571, 560, 650];
  } else if (isSingleTokyo && (spec.regionFilter === 'tokyo23' || spec.regionFilter === 'tokyo23Other')) {
    viewBBox = unionBBoxes(pool.map((p) => p.bbox), 0.14);
  } else if (!spec.prefFilterCodes && !spec.regionFilter) {
    viewBBox = [22, 34, 940, 920];
  } else {
    viewBBox = unionBBoxes(pool.map((p) => p.bbox), 0.12);
  }

  return {
    targetPieces: targets,
    contextPieces,
    allPoolPieces: pool,
    bgPrefPieces: bgPrefs,
    viewBBox,
    insets,
    okinawaTransform: okiTransform,
    tokyoInsetTransforms,
  };
}

/** Resolve candidate piece ID pool without loading heavy SVG path files */
export async function getModePoolIds(
  mapScope: GameSessionSpec['mapScope'],
  prefFilterCodes?: string[],
  regionFilter?: string,
  geoCategory?: GameSessionSpec['geoCategory'],
): Promise<string[]> {
  if (mapScope === 'world') {
    const world = await loadWorldMap();
    const list = regionFilter
      ? world.regions.filter((r) => r.modes.includes(regionFilter))
      : world.regions;
    return list.map((r) => r.id);
  }
  if (mapScope === 'japan_prefs') {
    const prefs = await loadJapanPrefs();
    const list =
      prefFilterCodes && prefFilterCodes.length > 0
        ? prefs.prefs.filter((p) => prefFilterCodes.includes(p.code))
        : prefs.prefs;
    return list.map((p) => `pref_${p.code}`);
  }
  if (mapScope === 'geography_100') {
    const geo = await loadGeography100();
    const list =
      geoCategory === 'mountains' ||
      geoCategory === 'mountain' ||
      geoCategory === 'river' ||
      geoCategory === 'plain' ||
      geoCategory === 'lake'
        ? geo.filter((g) => g.category === geoCategory)
        : geo;
    return list.map((g) => g.id);
  }
  const munis = await loadMuniIndex();
  return filterMunisByRegion(munis, prefFilterCodes, regionFilter).map((m) => m.code);
}
