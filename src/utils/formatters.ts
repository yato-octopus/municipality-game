export function formatTimeMs(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalSec = Math.floor(safeMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  const centis = Math.floor((safeMs % 1000) / 10);
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(remMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
  }
  return `${String(remMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

export function formatTimeShortMs(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalSec = Math.floor(safeMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(remMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(remMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

let sessionSeq = 0;

export function createSessionId(prefix: string): string {
  sessionSeq += 1;
  return `${prefix}_${Date.now()}_${sessionSeq}`;
}
