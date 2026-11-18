// Sound effects, synthesised with WebAudio: no audio files, so nothing to credit.
// The audio context is created on the first play() (browsers need a user gesture first).

export type Sfx =
  | 'swing' | 'hit' | 'crit' | 'block' | 'parry' | 'roll' | 'hurt' | 'death'
  | 'pickup' | 'levelUp' | 'chest' | 'craft' | 'ui' | 'error';

type Ctx = AudioContext;

class Sound {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<Sfx, number>();
  private volume = 0.6;
  private muted = false;

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.value = this.level();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = this.level();
  }

  private level(): number {
    return this.muted ? 0 : this.volume * 0.5;
  }

  /** Play a sound now. Repeats of the same sound closer than 30 ms are dropped. */
  play(name: Sfx): void {
    if (this.muted || this.volume <= 0) return;
    const now = performance.now();
    if (now - (this.last.get(name) ?? -1e9) < 30) return;
    this.last.set(name, now);
    const ctx = this.context();
    if (!ctx || !this.master) return;
    if (ctx.state === 'suspended') void ctx.resume();
    RECIPES[name](ctx, this.master, ctx.currentTime + 0.001, this.noiseBuffer(ctx));
  }

  private context(): Ctx | null {
    if (this.ctx) return this.ctx;
    try {
      const Ac = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ac();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.level();
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null; // no audio support: stay silent
    }
    return this.ctx;
  }

  private noiseBuffer(ctx: Ctx): AudioBuffer {
    if (!this.noise) {
      const n = ctx.sampleRate;
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    return this.noise;
  }
}

export const sound = new Sound();

// ---------------------------------------------------------------- recipes

type Recipe = (ctx: Ctx, out: AudioNode, t: number, noise: AudioBuffer) => void;

/** A tone that slides from f0 to f1 and fades out over dur seconds. */
function tone(ctx: Ctx, out: AudioNode, t: number, f0: number, f1: number, dur: number, peak: number, type: OscillatorType = 'sine'): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A short filtered burst of noise. */
function burst(ctx: Ctx, out: AudioNode, t: number, noise: AudioBuffer, filter: BiquadFilterType, freq: number, q: number, dur: number, peak: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.5, dur + 0.02);
}

const RECIPES: Record<Sfx, Recipe> = {
  swing: (c, o, t, n) => burst(c, o, t, n, 'bandpass', 1400, 1.2, 0.12, 0.35),
  hit: (c, o, t, n) => {
    tone(c, o, t, 220, 70, 0.14, 0.6);
    burst(c, o, t, n, 'lowpass', 1800, 0.7, 0.07, 0.4);
  },
  crit: (c, o, t, n) => {
    tone(c, o, t, 220, 70, 0.16, 0.6);
    tone(c, o, t, 1400, 700, 0.12, 0.14, 'square');
    burst(c, o, t, n, 'highpass', 3000, 0.7, 0.05, 0.35);
  },
  block: (c, o, t, n) => {
    tone(c, o, t, 300, 240, 0.1, 0.4, 'triangle');
    burst(c, o, t, n, 'highpass', 2000, 0.7, 0.05, 0.25);
  },
  parry: (c, o, t) => {
    tone(c, o, t, 1400, 2100, 0.18, 0.35);
    tone(c, o, t + 0.05, 2100, 2100, 0.14, 0.12, 'triangle');
  },
  roll: (c, o, t, n) => burst(c, o, t, n, 'lowpass', 900, 0.5, 0.2, 0.2),
  hurt: (c, o, t) => tone(c, o, t, 160, 90, 0.18, 0.25, 'sawtooth'),
  death: (c, o, t) => tone(c, o, t, 220, 40, 0.8, 0.3, 'sawtooth'),
  pickup: (c, o, t) => {
    tone(c, o, t, 660, 660, 0.08, 0.25);
    tone(c, o, t + 0.07, 990, 990, 0.1, 0.25);
  },
  levelUp: (c, o, t) => {
    [523, 659, 784, 1046].forEach((f, i) => tone(c, o, t + i * 0.09, f, f, 0.16, 0.3));
  },
  chest: (c, o, t, n) => {
    tone(c, o, t, 300, 900, 0.35, 0.3, 'triangle');
    burst(c, o, t + 0.2, n, 'highpass', 3000, 0.7, 0.2, 0.1);
  },
  craft: (c, o, t, n) => {
    burst(c, o, t, n, 'bandpass', 2500, 2, 0.1, 0.2);
    tone(c, o, t, 900, 900, 0.08, 0.15, 'triangle');
  },
  ui: (c, o, t) => tone(c, o, t, 880, 880, 0.035, 0.08, 'square'),
  error: (c, o, t) => tone(c, o, t, 150, 150, 0.12, 0.12, 'square'),
};
