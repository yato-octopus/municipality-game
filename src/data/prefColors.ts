/**
 * Low-saturation 5-color cartographic pastel palette for Japanese prefectures.
 * Verified against `public/data/japan_prefs.json` so that no two land-adjacent
 * or strait-adjacent prefectures share the same color index.
 */
export const PREF_MUTED_PALETTE = [
  '#f7f0df', // Warm Cream Sand
  '#e4f2e6', // Fresh Sage Mist
  '#f7e8ec', // Soft Blossom Rose
  '#e8ecfa', // Clear Periwinkle Mist
  '#f6f4d8', // Soft Butter Cream
] as const;

export const PREF_MUTED_CONTEXT_PALETTE = [
  '#dce1e8', // Cool Slate Neutral 1
  '#d8dfe6', // Cool Slate Neutral 2
  '#dee1e8', // Cool Slate Neutral 3
  '#d9dfe9', // Cool Slate Neutral 4
  '#dde1e6', // Cool Slate Neutral 5
] as const;

export const PREF_COLOR_INDEX: Record<string, number> = {
  '01': 4, // 北海道
  '02': 1, // 青森県
  '03': 2, // 岩手県
  '04': 3, // 宮城県
  '05': 4, // 秋田県
  '06': 0, // 山形県
  '07': 2, // 福島県
  '08': 1, // 茨城県
  '09': 3, // 栃木県
  '10': 0, // 群馬県
  '11': 2, // 埼玉県
  '12': 4, // 千葉県
  '13': 3, // 東京都
  '14': 0, // 神奈川県
  '15': 4, // 新潟県
  '16': 2, // 富山県
  '17': 1, // 石川県
  '18': 4, // 福井県
  '19': 4, // 山梨県
  '20': 1, // 長野県
  '21': 0, // 岐阜県
  '22': 2, // 静岡県
  '23': 3, // 愛知県
  '24': 4, // 三重県
  '25': 1, // 滋賀県
  '26': 3, // 京都府
  '27': 2, // 大阪府
  '28': 1, // 兵庫県
  '29': 0, // 奈良県
  '30': 3, // 和歌山県
  '31': 2, // 鳥取県
  '32': 1, // 島根県
  '33': 4, // 岡山県
  '34': 0, // 広島県
  '35': 3, // 山口県
  '36': 0, // 徳島県
  '37': 2, // 香川県
  '38': 1, // 愛媛県
  '39': 3, // 高知県
  '40': 0, // 福岡県
  '41': 3, // 佐賀県
  '42': 2, // 長崎県
  '43': 1, // 熊本県
  '44': 4, // 大分県
  '45': 2, // 宮崎県
  '46': 0, // 鹿児島県
  '47': 1, // 沖縄県
};

export function getPrefMutedFill(prefCode?: string, mutedContext = false): string {
  const palette = mutedContext ? PREF_MUTED_CONTEXT_PALETTE : PREF_MUTED_PALETTE;
  if (!prefCode) return palette[0];
  const normalized = prefCode.startsWith('pref_') ? prefCode.slice(5) : prefCode;
  const idx = PREF_COLOR_INDEX[normalized];
  if (idx == null) return palette[0];
  return palette[idx % palette.length];
}
