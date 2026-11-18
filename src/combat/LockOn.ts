import { TUNING } from '../config';
import type { Player } from '../player/Player';
import type { Enemy } from './Enemy';

const L = TUNING.combat.lockOn;

/** Lock-on target selection: toggle on the best target, flick the mouse/stick to switch. */
export class LockOn {
  target: Enemy | null = null;
  private flickAcc = 0;
  private flickCooldown = 0;

  /** Toggle: lock the enemy closest to the centre of the view, or release. */
  toggle(player: Player, enemies: Enemy[], camYaw: number): void {
    if (this.target) {
      this.target = null;
      return;
    }
    const fx = -Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - player.pos.x;
      const dz = e.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > L.range) continue;
      const cos = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      // Prefer targets in front of the camera, then nearer ones.
      const score = d * (2 - cos);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    this.target = best;
  }

  /** Drop the target when it dies, the player dies or it gets too far away. */
  update(player: Player, dt: number): void {
    this.flickCooldown -= dt;
    this.flickAcc *= Math.exp(-6 * dt);
    const t = this.target;
    if (!t) return;
    const d = Math.hypot(t.pos.x - player.pos.x, t.pos.z - player.pos.z);
    if (!t.alive || player.state === 'dead' || d > L.range * 1.2) this.target = null;
  }

  /** Feed horizontal look input while locked; a quick flick switches to the next target that side. */
  flick(dx: number, player: Player, enemies: Enemy[]): void {
    if (!this.target || this.flickCooldown > 0) return;
    this.flickAcc += dx;
    if (Math.abs(this.flickAcc) < L.flick) return;
    const side = Math.sign(this.flickAcc);
    this.flickAcc = 0;
    this.flickCooldown = 0.3;
    const cur = this.target;
    const base = Math.atan2(cur.pos.x - player.pos.x, cur.pos.z - player.pos.z);
    let best: Enemy | null = null;
    let bestAngle = Infinity;
    for (const e of enemies) {
      if (e === cur || !e.alive) continue;
      const dx2 = e.pos.x - player.pos.x;
      const dz2 = e.pos.z - player.pos.z;
      if (Math.hypot(dx2, dz2) > L.range) continue;
      let a = Math.atan2(dx2, dz2) - base;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      // Screen-right is a negative angle here (yaw grows counter-clockwise seen from above).
      const onSide = side > 0 ? -a : a;
      if (onSide > 0 && onSide < bestAngle) {
        bestAngle = onSide;
        best = e;
      }
    }
    if (best) this.target = best;
  }
}
