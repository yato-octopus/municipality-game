import type {
  AreaDefinition,
  AreaSubMode,
  GeographySubCategory,
  PrefectureMeta,
} from '../types/game';

/** 地方定義・ジャンプ座標 */
export const JAPAN_REGION_JUMPS: {
  id: string;
  label: string;
  short: string;
  prefCodes: string[];
  center: [number, number];
  zoom: number;
}[] = [
  { id: 'hokkaido', label: '北海道', short: '北海道', prefCodes: ['01'], center: [662, 168], zoom: 2.3 },
  { id: 'tohoku', label: '東北', short: '東北', prefCodes: ['02', '03', '04', '05', '06', '07'], center: [565, 390], zoom: 2.6 },
  { id: 'kantou', label: '関東', short: '関東', prefCodes: ['08', '09', '10', '11', '12', '13', '14'], center: [548, 565], zoom: 4.0 },
  { id: 'tyuubu', label: '中部', short: '中部', prefCodes: ['15', '16', '17', '18', '19', '20', '21', '22', '23'], center: [460, 565], zoom: 3.0 },
  { id: 'kansai', label: '近畿', short: '近畿', prefCodes: ['24', '25', '26', '27', '28', '29', '30'], center: [365, 635], zoom: 3.8 },
  { id: 'tyuugoku', label: '中国', short: '中国', prefCodes: ['31', '32', '33', '34', '35'], center: [248, 638], zoom: 3.6 },
  { id: 'sikoku', label: '四国', short: '四国', prefCodes: ['36', '37', '38', '39'], center: [266, 702], zoom: 4.5 },
  { id: 'kyuusyuu', label: '九州', short: '九州', prefCodes: ['40', '41', '42', '43', '44', '45', '46'], center: [148, 760], zoom: 3.4 },
  { id: 'okinawa', label: '沖縄', short: '沖縄', prefCodes: ['47'], center: [160, 125], zoom: 3.6 },
];

/** 47都道府県 8地方グループ（エリア選択・閲覧セレクト共通） */
export const PREF_REGION_GROUPS: {
  id: string;
  label: string;
  prefCodes: string[];
}[] = [
  { id: 'hokkaido', label: '北海道', prefCodes: ['01'] },
  { id: 'tohoku', label: '東北地方', prefCodes: ['02', '03', '04', '05', '06', '07'] },
  { id: 'kantou', label: '関東地方', prefCodes: ['08', '09', '10', '11', '12', '13', '14'] },
  { id: 'tyuubu', label: '中部地方', prefCodes: ['15', '16', '17', '18', '19', '20', '21', '22', '23'] },
  { id: 'kinki', label: '近畿地方', prefCodes: ['24', '25', '26', '27', '28', '29', '30'] },
  { id: 'tyuugoku', label: '中国地方', prefCodes: ['31', '32', '33', '34', '35'] },
  { id: 'sikoku', label: '四国地方', prefCodes: ['36', '37', '38', '39'] },
  { id: 'kyuusyuu_okinawa', label: '九州・沖縄地方', prefCodes: ['40', '41', '42', '43', '44', '45', '46', '47'] },
];

/** 閲覧モード用・日本の自然地理100選プリセット */
export const GEOGRAPHY_VIEW_AREAS: {
  id: string;
  name: string;
  geoCategory?: Exclude<GeographySubCategory, 'capital_q' | 'capital_y'>;
  modeId?: string;
  approxCount: number;
}[] = [
  { id: 'geo_all', name: '日本の自然地理100選（すべて）', approxCount: 100 },
  { id: 'geo_mountains', name: '主な山脈・山地・高地', geoCategory: 'mountains', modeId: '00_japan_Mountains', approxCount: 24 },
  { id: 'geo_mountain', name: '主な山', geoCategory: 'mountain', modeId: '00_japan_Mountain', approxCount: 21 },
  { id: 'geo_river', name: '主な河川', geoCategory: 'river', modeId: '00_japan_River', approxCount: 16 },
  { id: 'geo_plain', name: '主な平野', geoCategory: 'plain', modeId: '00_japan_Plain', approxCount: 17 },
  { id: 'geo_lake', name: '主な湖', geoCategory: 'lake', modeId: '00_japan_Lake', approxCount: 22 },
];

const TIHOU_MUNI_GROUPS: { key: string; label: string; prefCodes: string[] }[] = [
  { key: 'Touhoku', label: '東北地方', prefCodes: ['02', '03', '04', '05', '06', '07'] },
  { key: 'Kantou', label: '関東地方', prefCodes: ['08', '09', '10', '11', '12', '13', '14'] },
  { key: 'Tyuubu', label: '中部地方', prefCodes: ['15', '16', '17', '18', '19', '20', '21', '22', '23'] },
  { key: 'Kinki', label: '近畿地方', prefCodes: ['24', '25', '26', '27', '28', '29', '30'] },
  { key: 'Tyugoku', label: '中国地方', prefCodes: ['31', '32', '33', '34', '35'] },
  { key: 'Sikoku', label: '四国地方', prefCodes: ['36', '37', '38', '39'] },
  { key: 'Kyuusyu', label: '九州地方', prefCodes: ['40', '41', '42', '43', '44', '45', '46'] },
];

export { TIHOU_MUNI_GROUPS };

export const HOKKAIDO_SUB_REGIONS = [
  { key: 'douou', label: '道央', zoneMatch: '道央' },
  { key: 'dounan', label: '道南', zoneMatch: '道南' },
  { key: 'douhoku', label: '道北', zoneMatch: '道北' },
  { key: 'doutou', label: '道東', zoneMatch: '道東' },
] as const;

export const TOKYO_SUB_REGIONS = [
  { key: 'tokyo23', label: '東京23区' },
  { key: 'tokyo23Other', label: '東京23区外（多摩地域）' },
  { key: 'tokyo_island', label: '東京都島しょ部' },
] as const;

export const JAPAN_MAIN_MODES: AreaSubMode[] = [
  { id: '00_japan_P', label: '都道府県 パズル', shortLabel: 'パズル', playKind: 'puzzle' },
  { id: '00_japan_Q', label: '都道府県 クイズ', shortLabel: 'クイズ', playKind: 'quiz' },
  { id: '00_japan_Y', label: '都道府県 読み方', shortLabel: '読み方', playKind: 'yomikata' },
  { id: '00_japan_PrefecturalCapital_Q', label: '県庁所在地クイズ', shortLabel: '県庁クイズ', playKind: 'geography_quiz', geoCategory: 'capital_q' },
  { id: '00_japan_PrefecturalCapital_Y', label: '県庁所在地読み方', shortLabel: '県庁読み方', playKind: 'yomikata', geoCategory: 'capital_y' },
  { id: '00_japan_Mountains', label: '主な山脈・山地・高地', shortLabel: '山脈・山地', playKind: 'geography_quiz', geoCategory: 'mountains' },
  { id: '00_japan_Mountain', label: '主な山', shortLabel: '主な山', playKind: 'geography_quiz', geoCategory: 'mountain' },
  { id: '00_japan_River', label: '主な河川', shortLabel: '主な河川', playKind: 'geography_quiz', geoCategory: 'river' },
  { id: '00_japan_Plain', label: '主な平野', shortLabel: '主な平野', playKind: 'geography_quiz', geoCategory: 'plain' },
  { id: '00_japan_Lake', label: '主な湖', shortLabel: '主な湖', playKind: 'geography_quiz', geoCategory: 'lake' },
];

export function buildAllMunicipalitiesModes(): AreaSubMode[] {
  const list: AreaSubMode[] = [
    { id: '00_japan_All', label: '全国（全市区町村）パズル', shortLabel: '全国パズル', playKind: 'puzzle' },
    { id: '00_japan_All_Q', label: '全国（全市区町村）クイズ', shortLabel: '全国クイズ', playKind: 'quiz' },
    { id: '00_japan_All_Y', label: '全国（全市区町村）読み方', shortLabel: '全国読み方', playKind: 'yomikata' },
  ];
  for (const t of TIHOU_MUNI_GROUPS) {
    list.push(
      { id: `00_japan_Tihou_${t.key}_P`, label: `${t.label} パズル`, shortLabel: `${t.label.replace('地方', '')} P`, playKind: 'puzzle', regionFilter: t.key },
      { id: `00_japan_Tihou_${t.key}_Q`, label: `${t.label} クイズ`, shortLabel: `${t.label.replace('地方', '')} Q`, playKind: 'quiz', regionFilter: t.key },
      { id: `00_japan_Tihou_${t.key}_Y`, label: `${t.label} 読み方`, shortLabel: `${t.label.replace('地方', '')} 読`, playKind: 'yomikata', regionFilter: t.key },
    );
  }
  return list;
}

export function buildAllCitiesModes(): AreaSubMode[] {
  const list: AreaSubMode[] = [
    { id: '00_japan_Cities_P', label: '全国（全市）パズル', shortLabel: '全国市 P', playKind: 'puzzle', regionFilter: 'cities_all' },
    { id: '00_japan_Cities_Q', label: '全国（全市）クイズ', shortLabel: '全国市 Q', playKind: 'quiz', regionFilter: 'cities_all' },
    { id: '00_japan_Cities_Y', label: '全国（全市）読み方', shortLabel: '全国市 読', playKind: 'yomikata', regionFilter: 'cities_all' },
    { id: '00_japan_Cities_Hokkaido_P', label: '北海道の市 パズル', shortLabel: '北海道市 P', playKind: 'puzzle', regionFilter: 'cities_Hokkaido' },
    { id: '00_japan_Cities_Hokkaido_Q', label: '北海道の市 クイズ', shortLabel: '北海道市 Q', playKind: 'quiz', regionFilter: 'cities_Hokkaido' },
    { id: '00_japan_Cities_Hokkaido_Y', label: '北海道の市 読み方', shortLabel: '北海道市 読', playKind: 'yomikata', regionFilter: 'cities_Hokkaido' },
  ];
  for (const t of TIHOU_MUNI_GROUPS) {
    const shortRegion = t.label.replace('地方', '');
    list.push(
      { id: `00_japan_Cities_${t.key}_P`, label: `${t.label}の市 パズル`, shortLabel: `${shortRegion}市 P`, playKind: 'puzzle', regionFilter: `cities_${t.key}` },
      { id: `00_japan_Cities_${t.key}_Q`, label: `${t.label}の市 クイズ`, shortLabel: `${shortRegion}市 Q`, playKind: 'quiz', regionFilter: `cities_${t.key}` },
      { id: `00_japan_Cities_${t.key}_Y`, label: `${t.label}の市 読み方`, shortLabel: `${shortRegion}市 読`, playKind: 'yomikata', regionFilter: `cities_${t.key}` },
    );
  }
  return list;
}

export function buildPrefectureModes(prefCode: string, prefName: string): AreaSubMode[] {
  const base: AreaSubMode[] = [
    { id: `${prefCode}_P`, label: `${prefName} パズル`, shortLabel: 'パズル', playKind: 'puzzle' },
    { id: `${prefCode}_Q`, label: `${prefName} クイズ`, shortLabel: 'クイズ', playKind: 'quiz' },
    { id: `${prefCode}_Y`, label: `${prefName} 読み方`, shortLabel: '読み方', playKind: 'yomikata' },
  ];
  if (prefCode === '01') {
    for (const sub of HOKKAIDO_SUB_REGIONS) {
      base.push(
        { id: `01_${sub.key}_P`, label: `${sub.label} パズル`, shortLabel: `${sub.label} P`, playKind: 'puzzle', regionFilter: sub.key },
        { id: `01_${sub.key}_Q`, label: `${sub.label} クイズ`, shortLabel: `${sub.label} Q`, playKind: 'quiz', regionFilter: sub.key },
        { id: `01_${sub.key}_Y`, label: `${sub.label} 読み方`, shortLabel: `${sub.label} 読`, playKind: 'yomikata', regionFilter: sub.key },
      );
    }
  } else if (prefCode === '13') {
    base.push(
      { id: '13_tokyo23_P', label: '東京23区 パズル', shortLabel: '23区 P', playKind: 'puzzle', regionFilter: 'tokyo23' },
      { id: '13_tokyo23_Q', label: '東京23区 クイズ', shortLabel: '23区 Q', playKind: 'quiz', regionFilter: 'tokyo23' },
      { id: '13_tokyo23_Y', label: '東京23区 読み方', shortLabel: '23区 読', playKind: 'yomikata', regionFilter: 'tokyo23' },
      { id: '13_tokyo23Other_P', label: '東京23区外 パズル', shortLabel: '23区外 P', playKind: 'puzzle', regionFilter: 'tokyo23Other' },
      { id: '13_tokyo23Other_Q', label: '東京23区外 クイズ', shortLabel: '23区外 Q', playKind: 'quiz', regionFilter: 'tokyo23Other' },
      { id: '13_tokyo23Other_Y', label: '東京23区外 読み方', shortLabel: '23区外 読', playKind: 'yomikata', regionFilter: 'tokyo23Other' },
      { id: '13_tokyo_island_P', label: '東京都島しょ部 パズル', shortLabel: '島しょ P', playKind: 'puzzle', regionFilter: 'tokyo_island' },
      { id: '13_tokyo_island_Q', label: '東京都島しょ部 クイズ', shortLabel: '島しょ Q', playKind: 'quiz', regionFilter: 'tokyo_island' },
      { id: '13_tokyo_island_Y', label: '東京都島しょ部 読み方', shortLabel: '島しょ 読', playKind: 'yomikata', regionFilter: 'tokyo_island' },
    );
  }
  return base;
}

export function buildAreaCatalog(
  prefs: PrefectureMeta[],
  totalMunis: number,
  totalCities: number,
): AreaDefinition[] {
  const japanArea: AreaDefinition = {
    id: '00_japan',
    category: 'japan',
    name: '日本',
    ruby: 'にほん',
    subTitle: '都道府県・県庁所在地・主な山脈/山/河川/平野/湖',
    population: 127443563,
    wiki: 'https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC',
    totalCount: 47,
    modes: JAPAN_MAIN_MODES,
  };

  const allMuniArea: AreaDefinition = {
    id: '00_japan_all',
    category: 'municipalities',
    name: '市区町村',
    ruby: 'しくちょうそん',
    subTitle: `全国${totalMunis.toLocaleString()}市区町村・7地方別`,
    population: 127443563,
    wiki: 'https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E3%81%AE%E5%B8%82%E5%8C%BA%E7%94%BA%E6%9D%91',
    totalCount: totalMunis,
    modes: buildAllMunicipalitiesModes(),
  };

  const allCitiesArea: AreaDefinition = {
    id: '00_japan_cities',
    category: 'cities',
    name: '市（全国・地方別）',
    ruby: 'し',
    subTitle: `全国${totalCities.toLocaleString()}市・北海道＆7地方別`,
    population: 127443563,
    wiki: 'https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E3%81%AE%E5%B8%82',
    totalCount: totalCities,
    modes: buildAllCitiesModes(),
  };

  const prefAreas: AreaDefinition[] = prefs.map((p) => ({
    id: `pref_${p.code}`,
    category: 'prefecture',
    name: p.name,
    ruby: p.ruby,
    prefCode: p.code,
    subTitle: `${p.muniCount}市区町村・県庁: ${p.capital}`,
    population: p.population,
    wiki: p.wiki,
    totalCount: p.muniCount,
    modes: buildPrefectureModes(p.code, p.name),
  }));

  return [japanArea, allMuniArea, allCitiesArea, ...prefAreas];
}
