import { SIMILAR_NAME_GROUPS } from '../data/similarNames';
import type { MapPieceItem } from '../types/game';

export interface SubTableGroup {
  key: string;
  label: string;
  subLabel?: string;
  count: number;
  ratioText?: string;
  items: MapPieceItem[];
}

export interface KanaSummaryItem {
  piece: MapPieceItem;
  kind: 'ひらがな' | 'カタカナ' | '混在';
  chars: string;
}

const KANJI_RE = /[\u4e00-\u9fff\u3400-\u4dbf々ヶ]/g;
const HIRAGANA_RE = /[\u3041-\u3096]/g;
const KATAKANA_RE = /[\u30a1-\u30f6ー]/g;

export function filterPiecesByKeyword(pieces: MapPieceItem[], query: string): MapPieceItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return pieces;
  return pieces.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.ruby.toLowerCase().includes(q) ||
      (p.prefName ?? '').toLowerCase().includes(q) ||
      p.regionLabel.toLowerCase().includes(q) ||
      p.countyLabel.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q),
  );
}

export function sortPiecesByCode(pieces: MapPieceItem[]): MapPieceItem[] {
  return [...pieces].sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

export function sortPiecesByKana(pieces: MapPieceItem[]): MapPieceItem[] {
  return [...pieces].sort((a, b) => a.ruby.localeCompare(b.ruby, 'ja'));
}

export function sortPiecesByPopulation(pieces: MapPieceItem[]): MapPieceItem[] {
  return [...pieces].sort((a, b) => b.population - a.population);
}

export function sortPiecesByArea(pieces: MapPieceItem[]): MapPieceItem[] {
  return [...pieces].sort((a, b) => b.areaKm2 - a.areaKm2);
}

export function sortPiecesByElection(pieces: MapPieceItem[]): MapPieceItem[] {
  return [...pieces].sort((a, b) => (b.electionTurnout ?? -1) - (a.electionTurnout ?? -1));
}

export function analyzeKanzi(pieces: MapPieceItem[]): SubTableGroup[] {
  const map = new Map<string, MapPieceItem[]>();
  for (const piece of pieces) {
    const matches = piece.name.match(KANJI_RE);
    if (!matches) continue;
    const seenInName = new Set<string>();
    for (const ch of matches) {
      if (seenInName.has(ch)) continue;
      seenInName.add(ch);
      const list = map.get(ch) ?? [];
      list.push(piece);
      map.set(ch, list);
    }
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ja'))
    .map(([ch, items]) => ({
      key: `kanji_${ch}`,
      label: `「${ch}」を含む自治体`,
      subLabel: `出現数: ${items.length}件`,
      count: items.length,
      items,
    }));
}

export function analyzeHirakana(pieces: MapPieceItem[]): KanaSummaryItem[] {
  const out: KanaSummaryItem[] = [];
  for (const piece of pieces) {
    const hira = piece.name.match(HIRAGANA_RE) ?? [];
    const kata = piece.name.match(KATAKANA_RE) ?? [];
    if (hira.length === 0 && kata.length === 0) continue;
    const kind: KanaSummaryItem['kind'] =
      hira.length > 0 && kata.length > 0 ? '混在' : kata.length > 0 ? 'カタカナ' : 'ひらがな';
    out.push({
      piece,
      kind,
      chars: [...hira, ...kata].join(''),
    });
  }
  return out.sort((a, b) => a.piece.ruby.localeCompare(b.piece.ruby, 'ja'));
}

export function analyzeMoziCount(pieces: MapPieceItem[]): SubTableGroup[] {
  const map = new Map<number, MapPieceItem[]>();
  for (const piece of pieces) {
    const len = [...piece.name].length;
    const list = map.get(len) ?? [];
    list.push(piece);
    map.set(len, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([len, items]) => ({
      key: `len_${len}`,
      label: `${len}文字`,
      subLabel: `${items.length}件`,
      count: items.length,
      items: sortPiecesByKana(items),
    }));
}

export function analyzeSimilarNames(pieces: MapPieceItem[]): SubTableGroup[] {
  const groups: SubTableGroup[] = [];
  const usedGroupKeys = new Set<string>();

  for (const def of SIMILAR_NAME_GROUPS) {
    const matched = pieces.filter((p) => {
      const stem = p.name.replace(/[市町村区都府県]$/, '');
      return def.stems.some((s) => stem === s || p.name.startsWith(s));
    });
    if (matched.length >= 2) {
      usedGroupKeys.add(def.key);
      groups.push({
        key: `sim_${def.key}`,
        label: def.key,
        subLabel: matched.map((m) => m.name).slice(0, 4).join(' / '),
        count: matched.length,
        items: sortPiecesByCode(matched),
      });
    }
  }

  // Catch any exact same base stem not listed above (e.g. 東京都府中市・広島県府中市・府中町 etc.)
  const byStem = new Map<string, MapPieceItem[]>();
  for (const p of pieces) {
    const stem = p.name.replace(/[市区町村]$/, '');
    if (stem.length < 2) continue;
    const list = byStem.get(stem) ?? [];
    list.push(p);
    byStem.set(stem, list);
  }
  const alreadyCoveredIds = new Set(groups.flatMap((g) => g.items.map((i) => i.id)));
  for (const [stem, list] of byStem.entries()) {
    if (list.length >= 2 && list.some((i) => !alreadyCoveredIds.has(i.id))) {
      groups.push({
        key: `dyn_${stem}`,
        label: `同幹名「${stem}〜」`,
        subLabel: list.map((m) => m.name).join(' / '),
        count: list.length,
        items: sortPiecesByCode(list),
      });
    }
  }

  return groups.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ja'));
}

export interface SuffixEndingSummary {
  total: number;
  primaryLabel: string;
  primaryCount: number;
  secondaryLabel: string;
  secondaryCount: number;
  otherCount: number;
  groups: SubTableGroup[];
}

export function analyzeMatiTyou(pieces: MapPieceItem[]): SuffixEndingSummary {
  const towns = pieces.filter((p) => p.name.endsWith('町'));
  const mati = towns.filter((p) => p.ruby.endsWith('まち'));
  const tyou = towns.filter((p) => p.ruby.endsWith('ちょう'));
  const other = towns.filter((p) => !p.ruby.endsWith('まち') && !p.ruby.endsWith('ちょう'));

  const byPref = new Map<string, MapPieceItem[]>();
  for (const t of towns) {
    const k = `${t.prefCode ?? '00'}_${t.prefName ?? ''}`;
    const list = byPref.get(k) ?? [];
    list.push(t);
    byPref.set(k, list);
  }

  const prefGroups: SubTableGroup[] = Array.from(byPref.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, items]) => {
      const mCnt = items.filter((i) => i.ruby.endsWith('まち')).length;
      const cCnt = items.filter((i) => i.ruby.endsWith('ちょう')).length;
      const pName = k.split('_')[1] || '全国';
      return {
        key: `pref_town_${k}`,
        label: `${pName}（町 ${items.length}）`,
        subLabel: `まち ${mCnt} / ちょう ${cCnt}`,
        count: items.length,
        ratioText: `まち ${Math.round((mCnt / Math.max(1, items.length)) * 100)}%`,
        items: sortPiecesByCode(items),
      };
    });

  const groups: SubTableGroup[] = [
    {
      key: 'ending_mati',
      label: '「〜まち」と読む町',
      subLabel: `${mati.length}件`,
      count: mati.length,
      ratioText: `${towns.length ? ((mati.length / towns.length) * 100).toFixed(1) : '0.0'}%`,
      items: sortPiecesByCode(mati),
    },
    {
      key: 'ending_tyou',
      label: '「〜ちょう」と読む町',
      subLabel: `${tyou.length}件`,
      count: tyou.length,
      ratioText: `${towns.length ? ((tyou.length / towns.length) * 100).toFixed(1) : '0.0'}%`,
      items: sortPiecesByCode(tyou),
    },
    ...prefGroups,
  ];

  return {
    total: towns.length,
    primaryLabel: 'まち',
    primaryCount: mati.length,
    secondaryLabel: 'ちょう',
    secondaryCount: tyou.length,
    otherCount: other.length,
    groups,
  };
}

export function analyzeMuraSon(pieces: MapPieceItem[]): SuffixEndingSummary {
  const villages = pieces.filter((p) => p.name.endsWith('村'));
  const mura = villages.filter((p) => p.ruby.endsWith('むら'));
  const son = villages.filter((p) => p.ruby.endsWith('そん'));
  const other = villages.filter((p) => !p.ruby.endsWith('むら') && !p.ruby.endsWith('そん'));

  const byPref = new Map<string, MapPieceItem[]>();
  for (const v of villages) {
    const k = `${v.prefCode ?? '00'}_${v.prefName ?? ''}`;
    const list = byPref.get(k) ?? [];
    list.push(v);
    byPref.set(k, list);
  }

  const prefGroups: SubTableGroup[] = Array.from(byPref.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, items]) => {
      const mCnt = items.filter((i) => i.ruby.endsWith('むら')).length;
      const sCnt = items.filter((i) => i.ruby.endsWith('そん')).length;
      const pName = k.split('_')[1] || '全国';
      return {
        key: `pref_vil_${k}`,
        label: `${pName}（村 ${items.length}）`,
        subLabel: `むら ${mCnt} / そん ${sCnt}`,
        count: items.length,
        ratioText: `むら ${Math.round((mCnt / Math.max(1, items.length)) * 100)}%`,
        items: sortPiecesByCode(items),
      };
    });

  const groups: SubTableGroup[] = [
    {
      key: 'ending_mura',
      label: '「〜むら」と読む村',
      subLabel: `${mura.length}件`,
      count: mura.length,
      ratioText: `${villages.length ? ((mura.length / villages.length) * 100).toFixed(1) : '0.0'}%`,
      items: sortPiecesByCode(mura),
    },
    {
      key: 'ending_son',
      label: '「〜そん」と読む村',
      subLabel: `${son.length}件`,
      count: son.length,
      ratioText: `${villages.length ? ((son.length / villages.length) * 100).toFixed(1) : '0.0'}%`,
      items: sortPiecesByCode(son),
    },
    ...prefGroups,
  ];

  return {
    total: villages.length,
    primaryLabel: 'むら',
    primaryCount: mura.length,
    secondaryLabel: 'そん',
    secondaryCount: son.length,
    otherCount: other.length,
    groups,
  };
}

export function analyzeSiTyouSonKu(pieces: MapPieceItem[]): SubTableGroup[] {
  const buckets: { key: string; label: string; test: (p: MapPieceItem) => boolean }[] = [
    { key: 'si', label: '市', test: (p) => p.name.endsWith('市') },
    { key: 'tyou', label: '町', test: (p) => p.name.endsWith('町') },
    { key: 'mura', label: '村', test: (p) => p.name.endsWith('村') },
    { key: 'ku', label: '特別区（区）', test: (p) => p.name.endsWith('区') },
  ];
  const matchedIds = new Set<string>();
  const total = Math.max(1, pieces.length);
  const out: SubTableGroup[] = [];

  for (const b of buckets) {
    const items = pieces.filter(b.test);
    items.forEach((i) => matchedIds.add(i.id));
    if (items.length > 0) {
      out.push({
        key: b.key,
        label: b.label,
        subLabel: `${items.length}件`,
        count: items.length,
        ratioText: `${((items.length / total) * 100).toFixed(1)}%`,
        items: sortPiecesByCode(items),
      });
    }
  }
  const others = pieces.filter((p) => !matchedIds.has(p.id));
  if (others.length > 0) {
    out.push({
      key: 'other',
      label: '都道府県・その他地域',
      subLabel: `${others.length}件`,
      count: others.length,
      ratioText: `${((others.length / total) * 100).toFixed(1)}%`,
      items: sortPiecesByCode(others),
    });
  }
  return out;
}

export function groupByTiiki(
  pieces: MapPieceItem[],
  mode: 'tihou' | 'tiiki' | 'gun',
): SubTableGroup[] {
  const map = new Map<string, MapPieceItem[]>();
  for (const p of pieces) {
    const label =
      mode === 'tihou'
        ? p.prefName || p.regionLabel || '未分類'
        : mode === 'tiiki'
          ? p.regionLabel || p.adminAreaLabel || '未分類'
          : p.countyLabel || p.adminAreaLabel || '（郡なし / 市・区・直轄）';
    const list = map.get(label) ?? [];
    list.push(p);
    map.set(label, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ja'))
    .map(([label, items]) => ({
      key: `${mode}_${label}`,
      label,
      subLabel: `${items.length}件`,
      count: items.length,
      items: sortPiecesByCode(items),
    }));
}
