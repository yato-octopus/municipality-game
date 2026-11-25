export function formatTimeMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  const tenths = Math.floor((ms % 1000) / 10);
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(remMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(tenths).padStart(2, '0')}`;
  }
  return `${String(remMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(tenths).padStart(2, '0')}`;
}

const MUTATION_CYCLES: Record<string, string[]> = {
  か: ['か', 'が'],
  が: ['か', 'が'],
  き: ['き', 'ぎ'],
  ぎ: ['き', 'ぎ'],
  く: ['く', 'ぐ'],
  ぐ: ['く', 'ぐ'],
  け: ['け', 'げ'],
  げ: ['け', 'げ'],
  こ: ['こ', 'ご'],
  ご: ['こ', 'ご'],
  さ: ['さ', 'ざ'],
  ざ: ['さ', 'ざ'],
  し: ['し', 'じ'],
  じ: ['し', 'じ'],
  す: ['す', 'ず'],
  ず: ['す', 'ず'],
  せ: ['せ', 'ぜ'],
  ぜ: ['せ', 'ぜ'],
  そ: ['そ', 'ぞ'],
  ぞ: ['そ', 'ぞ'],
  た: ['た', 'だ'],
  だ: ['た', 'だ'],
  ち: ['ち', 'ぢ'],
  ぢ: ['ち', 'ぢ'],
  つ: ['つ', 'づ', 'っ'],
  づ: ['つ', 'づ', 'っ'],
  っ: ['つ', 'づ', 'っ'],
  て: ['て', 'で'],
  で: ['て', 'で'],
  と: ['と', 'ど'],
  ど: ['と', 'ど'],
  は: ['は', 'ば', 'ぱ'],
  ば: ['は', 'ば', 'ぱ'],
  ぱ: ['は', 'ば', 'ぱ'],
  ひ: ['ひ', 'び', 'ぴ'],
  び: ['ひ', 'び', 'ぴ'],
  ぴ: ['ひ', 'び', 'ぴ'],
  ふ: ['ふ', 'ぶ', 'ぷ'],
  ぶ: ['ふ', 'ぶ', 'ぷ'],
  ぷ: ['ふ', 'ぶ', 'ぷ'],
  へ: ['へ', 'べ', 'ぺ'],
  べ: ['へ', 'べ', 'ぺ'],
  ぺ: ['へ', 'べ', 'ぺ'],
  ほ: ['ほ', 'ぼ', 'ぽ'],
  ぼ: ['ほ', 'ぼ', 'ぽ'],
  ぽ: ['ほ', 'ぼ', 'ぽ'],
  あ: ['あ', 'ぁ'],
  ぁ: ['あ', 'ぁ'],
  い: ['い', 'ぃ'],
  ぃ: ['い', 'ぃ'],
  う: ['う', 'ぅ', 'ゔ'],
  ぅ: ['う', 'ぅ', 'ゔ'],
  ゔ: ['う', 'ぅ', 'ゔ'],
  え: ['え', 'ぇ'],
  ぇ: ['え', 'ぇ'],
  お: ['お', 'ぉ'],
  ぉ: ['お', 'ぉ'],
  や: ['や', 'ゃ'],
  ゃ: ['や', 'ゃ'],
  ゆ: ['ゆ', 'ゅ'],
  ゅ: ['ゆ', 'ゅ'],
  よ: ['よ', 'ょ'],
  ょ: ['よ', 'ょ'],
  わ: ['わ', 'ゎ'],
  ゎ: ['わ', 'ゎ'],
};

export function cycleKanaModifier(lastChar: string): string {
  const cycle = MUTATION_CYCLES[lastChar];
  if (!cycle) return lastChar;
  const idx = cycle.indexOf(lastChar);
  return cycle[(idx + 1) % cycle.length];
}

export function createSessionId(prefix: string): string {
  return `${prefix}_${Date.now()}`;
}
