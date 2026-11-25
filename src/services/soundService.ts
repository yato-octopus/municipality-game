let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(
  freq: number,
  durationSec: number,
  volume01: number,
  type: OscillatorType = 'sine',
  delaySec = 0,
  endFreq?: number,
): void {
  if (volume01 <= 0.005) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const start = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), start + durationSec);
    }
    const peak = Math.min(0.35, volume01 * 0.25);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + durationSec + 0.02);
  } catch {
    // Audio playback may fail before interaction
  }
}

/** Bell-like piece snap chime */
export function playSnapBell(seVolume: number, enabled: boolean): void {
  if (!enabled) return;
  const v = seVolume / 100;
  playTone(880, 0.34, v, 'sine', 0);
  playTone(1318.5, 0.28, v * 0.55, 'triangle', 0.015);
  playTone(1760, 0.22, v * 0.3, 'sine', 0.025);
}

export function playCorrectChime(seVolume: number, enabled: boolean): void {
  if (!enabled) return;
  const v = seVolume / 100;
  playTone(659.25, 0.14, v, 'sine', 0);
  playTone(880, 0.26, v, 'sine', 0.08);
}

export function playWrongBuzz(seVolume: number): void {
  const v = seVolume / 100;
  playTone(210, 0.16, v * 0.85, 'triangle', 0, 145);
}

export function playCompleteFanfare(seVolume: number, enabled: boolean): void {
  if (!enabled) return;
  const v = seVolume / 100;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, idx) => playTone(f, 0.32, v * 0.9, 'sine', idx * 0.075));
}

export function playUiClick(seVolume: number): void {
  const v = seVolume / 100;
  playTone(720, 0.045, v * 0.35, 'sine', 0);
}

export function triggerVibrate(enabled: boolean, ms = 35): void {
  if (!enabled || typeof navigator === 'undefined' || !navigator.vibrate) return;
  try {
    navigator.vibrate(ms);
  } catch {
    // Ignore unsupported platforms
  }
}
