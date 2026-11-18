import * as THREE from 'three';
import { TUNING, type EnemyKind } from '../config';
import type { World } from '../world/World';
import type { Player, Strike } from '../player/Player';
import { Enemy } from './Enemy';
import { EnemyModel } from './EnemyModel';
import { inArc, type CombatFx } from './combat';

const C = TUNING.combat;
const E = TUNING.enemies;

/** Test-map camps: [kind, x, z]. Meadow enemies around the spawn point (0, 12). */
const CAMPS: [EnemyKind, number, number][] = [
  ['slime', -6, 24],
  ['slime', -3, 27],
  ['slime', -9, 28],
  ['boar', 18, 26],
  ['boar', 24, 30],
  ['bandit', -18, 2],
  ['bandit', -22, -3],
];

/** All enemies: AI updates, collisions between bodies, sword hits, respawning. */
export class Enemies {
  readonly list: Enemy[] = [];
  readonly models: EnemyModel[] = [];
  readonly group = new THREE.Group();
  private deadFor = new Map<Enemy, number>();

  constructor(private world: World) {
    for (const [kind, x, z] of CAMPS) this.spawn(kind, x, z);
  }

  spawn(kind: EnemyKind, x: number, z: number): Enemy {
    const e = new Enemy(kind, new THREE.Vector3(x, 0, z), this.world);
    const m = new EnemyModel(e);
    this.list.push(e);
    this.models.push(m);
    this.group.add(m.root);
    return e;
  }

  update(dt: number, player: Player, fx: CombatFx[]): void {
    for (const e of this.list) {
      if (!e.frozen) e.update(dt, player);
      e.updateBurn(dt);
      fx.push(...e.fx);
      e.fx.length = 0;
    }
    this.separate(player);
    this.respawn(dt, player);
  }

  /** Enemies that died since the last call (by any cause); each is reported once. */
  collectKills(): Enemy[] {
    const out = this.list.filter((e) => e.lootPending);
    for (const e of out) e.lootPending = false;
    return out;
  }

  /**
   * Every player hit goes through here: fire damage, backstab bonus (assassin), burn, lifesteal.
   * `from` is where the hit comes from (knockback direction). Returns the damage dealt.
   */
  damage(
    e: Enemy,
    player: Player,
    hit: { damage: number; crit: boolean; poise: number; knockback: number; burn?: boolean; fire?: number },
    from: THREE.Vector3,
    fx: CombatFx[],
  ): number {
    if (!e.alive) return 0;
    let damage = hit.damage + (hit.fire ?? 0);
    if (player.stats.backstab > 0 && this.isBehind(e, player.pos)) damage *= 1 + player.stats.backstab;
    e.takeHit({ damage, poise: hit.poise, knockback: hit.knockback, from }, fx, hit.crit);
    if (hit.burn && e.alive) e.burnTime = TUNING.combat.burn.time;
    if (player.stats.uniques.has('lifesteal')) player.heal(e.lastDamage * TUNING.combat.lifesteal);
    return e.lastDamage;
  }

  /** Is `p` behind the enemy (outside its front 180°… narrowed to the back ~110°)? */
  isBehind(e: Enemy, p: THREE.Vector3): boolean {
    const f = e.facingVector();
    const dx = p.x - e.pos.x;
    const dz = p.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return (dx * f.x + dz * f.z) / d < -0.35;
  }

  /** Resolve a player melee strike against every enemy in the arc. */
  applyStrike(strike: Strike, player: Player, fx: CombatFx[]): { hits: number; dealt: number } {
    let hits = 0;
    let dealt = 0;
    const f = player.facingVector();
    for (const e of this.list) {
      if (!e.alive) continue;
      if (!inArc(player.pos, f, e.pos, (strike.reach ?? C.reach) + e.stats.radius, strike.arc ?? C.arc)) continue;
      dealt += this.damage(e, player, strike, player.pos.clone(), fx);
      hits++;
    }
    return { hits, dealt };
  }

  /** Alive enemies within `r` of a point (skills). */
  near(p: THREE.Vector3, r: number): Enemy[] {
    return this.list.filter((e) => e.alive && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= r + e.stats.radius && Math.abs(e.pos.y - p.y) < 3);
  }

  /** Push overlapping bodies apart (enemy–enemy and enemy–player). */
  private separate(player: Player): void {
    const alive = this.list.filter((e) => e.alive);
    for (let i = 0; i < alive.length; i++) {
      const a = alive[i];
      for (let j = i + 1; j < alive.length; j++) {
        const b = alive[j];
        this.pushApart(a.pos, b.pos, a.stats.radius + b.stats.radius, 0.5);
      }
      // Rolls and skills (Charge) pass through bodies.
      if (player.state !== 'dead' && player.state !== 'roll' && player.state !== 'skill' && Math.abs(player.pos.y - a.pos.y) < 1.5) {
        // The enemy gives way more than the player does.
        this.pushApart(a.pos, player.pos, a.stats.radius + TUNING.radius, 0.8);
      }
    }
  }

  private pushApart(a: THREE.Vector3, b: THREE.Vector3, minDist: number, aShare: number): void {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    const d = Math.hypot(dx, dz);
    if (d >= minDist || d < 1e-5) return;
    const push = minDist - d;
    a.x += (dx / d) * push * aShare;
    a.z += (dz / d) * push * aShare;
    b.x -= (dx / d) * push * (1 - aShare);
    b.z -= (dz / d) * push * (1 - aShare);
  }

  /** Dead enemies come back after a while, once the player is far from their camp. */
  private respawn(dt: number, player: Player): void {
    for (const e of this.list) {
      if (e.alive) {
        this.deadFor.delete(e);
        continue;
      }
      const t = (this.deadFor.get(e) ?? 0) + dt;
      this.deadFor.set(e, t);
      const far = Math.hypot(player.pos.x - e.home.x, player.pos.z - e.home.z) > E.respawnDistance;
      if (t >= E.respawnTime && far) {
        e.reset();
        this.deadFor.delete(e);
      }
    }
  }

  /** Put every enemy back at its camp (e.g. after the player dies). */
  resetAll(): void {
    for (const e of this.list) e.reset();
    this.deadFor.clear();
  }

  updateModels(dt: number): void {
    for (const m of this.models) m.update(dt);
  }
}
