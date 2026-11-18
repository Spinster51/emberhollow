import * as THREE from 'three';
import { TUNING, type EnemyKind } from '../config';
import type { World } from '../world/World';
import type { Player, Strike } from '../player/Player';
import { Enemy, type EnemyHooks } from './Enemy';
import { EnemyModel } from './EnemyModel';
import { inArc, type CombatFx } from './combat';
import { ENEMY_STATS } from '../config';

const C = TUNING.combat;
const E = TUNING.enemies;


/** All enemies: AI updates, collisions between bodies, sword hits, respawning. */
export class Enemies {
  readonly list: Enemy[] = [];
  readonly models: EnemyModel[] = [];
  readonly group = new THREE.Group();
  private deadFor = new Map<Enemy, number>();
  /** Set by the game: enemy projectiles and area effects. */
  hooks: EnemyHooks | null = null;

  /** Spawns the layout's camps. On the main map, level comes from the region (never below the kind's base). */
  constructor(private world: World) {
    for (const c of world.layout.camps) {
      const base = ENEMY_STATS[c.kind].baseLevel;
      const level = c.level ?? (world.layout.name === 'main' ? Math.max(base, world.regionAt(c.x, c.z).level) : base);
      this.spawn(c.kind, c.x, c.z, level);
    }
  }

  spawn(kind: EnemyKind, x: number, z: number, level?: number): Enemy {
    const e = new Enemy(kind, new THREE.Vector3(x, 0, z), this.world, level);
    e.hooks = {
      shoot: (...a) => this.hooks?.shoot(...a),
      blast: (...a) => this.hooks?.blast(...a),
      summon: (boss, k, x, z, lvl) => {
        const add = this.spawn(k, x, z, lvl);
        add.summoner = boss;
        add.taunt(0.1);
      },
    };
    const m = new EnemyModel(e);
    this.list.push(e);
    this.models.push(m);
    this.group.add(m.root);
    return e;
  }

  update(dt: number, player: Player, fx: CombatFx[]): void {
    const sleep = E.sleepDistance;
    for (const e of this.list) {
      // Far-away enemies sleep (no AI) unless they are chasing.
      const far = Math.abs(e.pos.x - player.pos.x) > sleep || Math.abs(e.pos.z - player.pos.z) > sleep;
      if (!e.frozen && !(far && (e.state === 'idle' || e.state === 'dead'))) e.update(dt, player);
      e.updateBurn(dt);
      fx.push(...e.fx);
      e.fx.length = 0;
    }
    this.separate(player);
    this.respawn(dt, player);
    this.dismiss();
  }

  /** Summoned helpers leave once dead, or when their boss gives up the fight. */
  private dismiss(): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      const boss = e.summoner;
      if (!boss) continue;
      const gone = (!e.alive && (this.deadFor.get(e) ?? 0) > 3 && !e.lootPending) || boss.state === 'idle' || boss.state === 'return';
      if (gone) this.remove(i);
    }
  }

  private remove(i: number): void {
    const e = this.list[i];
    this.list.splice(i, 1);
    const m = this.models.findIndex((x) => x.enemy === e);
    if (m >= 0) {
      this.group.remove(this.models[m].root);
      this.models.splice(m, 1);
    }
    this.deadFor.delete(e);
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
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].summoner) this.remove(i);
    for (const e of this.list) e.reset();
    this.deadFor.clear();
  }

  updateModels(dt: number, view: THREE.Vector3): void {
    for (const m of this.models) {
      const far = m.enemy.pos.distanceToSquared(view) > 160 * 160;
      if (far) {
        m.root.visible = false;
        continue;
      }
      m.update(dt);
    }
  }

  /** Put every enemy back at its camp (resting at a campfire resets the world). */
  respawnAll(): void {
    this.resetAll();
  }
}
