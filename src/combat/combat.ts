import * as THREE from 'three';
import { TUNING, type StaggerKind } from '../config';

/** One landed attack, from either side. */
export interface Hit {
  damage: number;
  /** Poise damage. */
  poise: number;
  /** Horizontal push speed, m/s. */
  knockback: number;
  /** Attacker position: used for block direction and knockback. */
  from: THREE.Vector3;
}

export type HitResult = 'hit' | 'blocked' | 'parried' | 'dodged' | 'ignored';

export interface Stagger {
  kind: StaggerKind;
  time: number;
}

/** Visual/audio feedback the HUD and camera react to. */
export interface CombatFx {
  pos: THREE.Vector3;
  amount: number;
  /** Who took it. */
  target: 'player' | 'enemy';
  result: HitResult;
  stagger: StaggerKind | null;
}

const STAGGERS = TUNING.combat.staggers as { below: number; kind: StaggerKind; time: number }[];

/**
 * Poise: hits drain it; crossing a threshold staggers. After a stagger poise refills and a
 * short grace period stops stun-locks.
 */
export class Poise {
  value: number;
  private sinceHit = 99;
  private grace = 0;

  constructor(
    readonly max: number,
    private regen = max / 3,
    private regenDelay = TUNING.combat.poise.regenDelay,
  ) {
    this.value = max;
  }

  reset(): void {
    this.value = this.max;
    this.grace = 0;
    this.sinceHit = 99;
  }

  update(dt: number): void {
    this.sinceHit += dt;
    this.grace -= dt;
    if (this.sinceHit > this.regenDelay) this.value = Math.min(this.max, this.value + this.regen * dt);
  }

  /** Drain poise; returns the stagger caused, if any. */
  apply(amount: number): Stagger | null {
    this.sinceHit = 0;
    if (this.grace > 0) return null;
    const before = this.value / this.max;
    this.value = Math.max(0, this.value - amount);
    const after = this.value / this.max;
    // Most severe first: knockdown when poise is gone, then dazed, stunned, interrupted.
    for (const s of STAGGERS) {
      const crossed = s.below === 0 ? after <= 0 && before > 0 : after < s.below && before >= s.below;
      if (crossed) {
        this.value = this.max;
        this.grace = TUNING.combat.staggerGrace;
        return { kind: s.kind, time: s.time };
      }
    }
    return null;
  }
}

/** Is `target` inside a horizontal cone in front of `origin`? */
export function inArc(
  origin: THREE.Vector3,
  facing: THREE.Vector3,
  target: THREE.Vector3,
  range: number,
  arcDeg: number,
): boolean {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const d = Math.hypot(dx, dz);
  if (d > range) return false;
  if (d < 0.3) return true;
  if (Math.abs(target.y - origin.y) > 2.2) return false;
  const cos = (dx * facing.x + dz * facing.z) / d;
  return cos >= Math.cos(((arcDeg / 2) * Math.PI) / 180);
}
