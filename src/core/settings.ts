// Player settings kept in this browser: sound, graphics preset and pixel scale.
// Storage can be missing (private windows, blocked site data), so every access is guarded.

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  volume: number;
  muted: boolean;
  quality: Quality;
  /** Render resolution as a fraction of the window (0.25–1). */
  pixelScale: number;
}

const KEY = 'emberhollow.settings';
const OLD_PIXEL_KEY = 'emberhollow.pixelScale';

export const DEFAULTS: Settings = { volume: 0.6, muted: false, quality: 'high', pixelScale: 0.5 };

export function loadSettings(): Settings {
  const s: Settings = { ...DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    if (raw && typeof raw === 'object') {
      if (typeof raw.volume === 'number') s.volume = clamp(raw.volume, 0, 1);
      if (typeof raw.muted === 'boolean') s.muted = raw.muted;
      if (raw.quality === 'low' || raw.quality === 'medium' || raw.quality === 'high') s.quality = raw.quality;
      if (typeof raw.pixelScale === 'number') s.pixelScale = clamp(raw.pixelScale, 0.25, 1);
    }
    // The pixel scale used to live under its own key; keep a player's choice.
    const old = Number(localStorage.getItem(OLD_PIXEL_KEY));
    if (!raw && old > 0 && old <= 1) s.pixelScale = old;
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
