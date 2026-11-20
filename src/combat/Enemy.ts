import * as THREE from 'three';
import { ENEMY_STATS, TUNING, type EnemyKind, type EnemyStats, type StaggerKind } from '../config';
import type { World } from '../world/World';
import type { Player } from '../player/Player';
import { mulberry32 } from '../core/noise';
import { Poise, inArc, type CombatFx, type Hit, type HitResult } from './combat';

export type EnemyState = 'idle' | 'chase' | 'windup' | 'active' | 'recover' | 'stagger' | 'return' | 'dead' | 'phase';

/** Boss attacks (the Cinder Warden). */
export type BossMove = 'sweep' | 'slam' | 'charge' | 'volley' | 'nova';
export const BOSS_MOVES: Record<BossMove, { windup: number; active: number; recover: number }> = {
  sweep: { windup: 0.75, active: 0.2, recover: 0.7 },
  slam: { windup: 1.1, active: 0.2, recover: 1.1 },
  charge: { windup: 0.8, active: 0.9, recover: 1.0 },
  volley: { windup: 0.9, active: 0.4, recover: 0.8 },
  nova: { windup: 1.6, active: 0.25, recover: 1.2 },
};
/** Seconds the boss roars between phases (it cannot be hurt meanwhile). */
export const PHASE_ROAR = 1.6;

const C = TUNING.combat;
const E = TUNING.enemies;
const B = E.boss;
const STEP_UP = 0.5;

/** What an enemy can ask the world for: projectiles and area effects. */
export interface EnemyHooks {
  shoot(e: Enemy, kind: 'arrow' | 'orb', from: THREE.Vector3, vel: THREE.Vector3): void;
  blast(at: THREE.Vector3, radius: number, color: number): void;
  /** Boss phase 2 calls in helpers. */
  summon?(boss: Enemy, kind: EnemyKind, x: number, z: number, level: number): void;
}

let nextId = 1;

/**
 * One enemy, run by a small state machine:
 * idle (wander) → chase → windup → active → recover → chase …; stagger and dead interrupt;
 * return walks home (and heals) when the player escapes past the leash.
 *
 * Attack styles (config `style`): lunge (slime, wolf, spider: leap into you), charge (boar: a
 * long straight run), melee (bandit, skeleton: 2-hit sword combo, circles you between attacks),
 * ranged (goblin archer, cultist: keep their distance and shoot), slam (golem: area smash).
 * Stats scale with level above the kind's base level.
 */
export class Enemy {
  readonly id = nextId++;
  readonly stats: EnemyStats;
  readonly level: number;
  readonly maxHp: number;
  /** Damage after level scaling. */
  readonly damage: number;
  hooks: EnemyHooks | null = null;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly home = new THREE.Vector3();
  facing = 0;
  state: EnemyState = 'idle';
  stateTime = 0;
  hp: number;
  readonly poise: Poise;
  staggerKind: StaggerKind | null = null;
  private staggerTime = 0;
  private cooldown = 0;
  hitDone = false;
  /** Strike number within the bandit's 2-hit combo. */
  comboStep = 0;
  private wander = new THREE.Vector3();
  private wanderTimer = 0;
  /** +1 / -1: which way the bandit circles. */
  private circleDir = 1;
  private chargeDir = new THREE.Vector3();
  /** Seeded so tests are repeatable. */
  private rand = mulberry32(this.id * 7919);
  /** Status effects from skills. */
  slowTime = 0;
  slowFactor = 1;
  tauntTime = 0;
  /** Set on death; cleared once the loot has been dropped. */
  lootPending = false;
  /** Seconds of burning left (Emberfang). */
  burnTime = 0;
  private burnAcc = 0;
  /** Burn ticks produce feedback here; drained by Enemies. */
  readonly fx: CombatFx[] = [];
  /** Test hook: a frozen enemy skips its AI (it can still be hit). */
  frozen = false;
  /** Damage taken by the last hit (after bonuses). */
  lastDamage = 0;
  /** Seconds since the last hit taken (drives the HP bar). */
  sinceHit = 99;
  /** Boss: 1 or 2. */
  phase = 1;
  /** Boss: the attack being made. */
  move: BossMove | null = null;
  /** Summoned helpers vanish after death and never respawn. */
  summoner: Enemy | null = null;

  constructor(
    readonly kind: EnemyKind,
    home: THREE.Vector3,
    private world: World,
    level?: number,
  ) {
    this.stats = ENEMY_STATS[kind];
    this.level = level ?? this.stats.baseLevel;
    const up = Math.max(0, this.level - this.stats.baseLevel);
    const per = TUNING.enemies.perLevel;
    this.maxHp = Math.round(this.stats.hp * (1 + per.hp * up));
    this.damage = Math.round(this.stats.damage * (1 + per.damage * up));
    this.hp = this.maxHp;
    this.poise = new Poise(this.stats.poise * (1 + per.poise * up));
    this.home.copy(home);
    this.reset();
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  reset(): void {
    this.pos.copy(this.home);
    this.pos.y = this.world.groundAt(this.pos.x, this.pos.z, 1e9);
    this.vel.set(0, 0, 0);
    this.hp = this.maxHp;
    this.poise.reset();
    this.cooldown = 0;
    this.sinceHit = 99;
    this.burnTime = 0;
    this.slowTime = 0;
    this.tauntTime = 0;
    this.phase = 1;
    this.move = null;
    this.setState('idle');
    this.lootPending = false;
  }

  get isBoss(): boolean {
    return this.stats.style === 'boss';
  }

  /** Phase 2 bosses move faster and wind up quicker. */
  rage(): number {
    return this.phase === 2 ? 1.3 : 1;
  }

  /** Cross the phase-2 threshold: roar (untouchable), then fight harder. */
  private checkPhase(): void {
    if (!this.isBoss || this.phase !== 1 || this.hp <= 0) return;
    if (this.hp > this.maxHp * (this.stats.phase2 ?? 0.5)) return;
    this.phase = 2;
    this.move = null;
    this.vel.set(0, 0, 0);
    this.poise.reset();
    this.staggerKind = null;
    this.hooks?.blast(this.pos.clone().setY(this.pos.y + 0.3), 6, 0xff6a2a);
    this.setState('phase');
  }

  /** Burning: one tick of damage per second. Works even while frozen (tests). */
  updateBurn(dt: number): void {
    if (this.burnTime <= 0 || !this.alive) return;
    this.burnTime -= dt;
    this.burnAcc += dt;
    if (this.burnAcc >= 1) {
      this.burnAcc -= 1;
      const dmg = C.burn.dps;
      this.hp -= dmg;
      this.sinceHit = 0;
      this.fx.push({ pos: this.centre(), amount: dmg, target: 'enemy', result: 'hit', stagger: null, dot: true });
      if (this.hp <= 0) {
        this.hp = 0;
        this.vel.set(0, 0, 0);
        this.setState('dead');
      } else this.checkPhase();
    }
  }

  private setState(s: EnemyState): void {
    if (s === 'dead' && this.state !== 'dead') this.lootPending = true;
    this.state = s;
    this.stateTime = 0;
    this.hitDone = false;
  }

  facingVector(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.facing), 0, -Math.cos(this.facing));
  }

  /** Point a little above the feet: lock-on reticle and damage numbers. */
  centre(): THREE.Vector3 {
    return this.pos.clone().setY(this.pos.y + this.stats.centreY);
  }

  topY(): number {
    return this.pos.y + this.stats.topY;
  }

  update(dt: number, player: Player): void {
    this.stateTime += dt;
    this.sinceHit += dt;
    this.poise.update(dt);
    this.slowTime = Math.max(0, this.slowTime - dt);
    this.tauntTime = Math.max(0, this.tauntTime - dt);
    // Slowed enemies also recover their attacks more slowly.
    this.cooldown -= dt * this.speedMult();
    const s = this.stats;
    const toPlayer = player.pos.clone().sub(this.pos).setY(0);
    const dist = toPlayer.length();
    // A stealthed player can't be seen unless right next to them; a taunt overrides everything.
    const hidden = player.stealthTime > 0 && dist > 1.5;
    const playerReachable =
      player.state !== 'dead' && !hidden && (this.tauntTime > 0 || Math.abs(player.pos.y - this.pos.y) < 6);
    const fromHome = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);

    switch (this.state) {
      case 'idle': {
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0) {
          const a = this.rand() * Math.PI * 2;
          const r = this.rand() * 4;
          this.wander.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
          this.wanderTimer = 2 + this.rand() * 3;
        }
        const d = this.wander.clone().sub(this.pos).setY(0);
        this.steer(d.length() > 0.3 ? d : null, s.speed * 0.35, dt, 4);
        if (playerReachable && (dist < s.aggro || this.tauntTime > 0)) this.setState('chase');
        break;
      }
      case 'chase': {
        if (!playerReachable || (fromHome > s.leash && this.tauntTime <= 0)) {
          this.setState('return');
          break;
        }
        if (this.isBoss) {
          this.chaseBoss(dt, toPlayer, dist);
          break;
        }
        if (dist <= s.range && this.cooldown <= 0) {
          this.comboStep = 0;
          this.setState('windup');
          break;
        }
        if (s.style === 'ranged') {
          // Keep a good shooting distance: back off when close, close in when far, else strafe.
          const keep = s.keep ?? 10;
          if (this.rand() < dt * 0.3) this.circleDir *= -1;
          const side = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).normalize().multiplyScalar(this.circleDir * 0.6);
          const radial = toPlayer.clone().normalize().multiplyScalar(dist > keep + 3 ? 1 : dist < keep - 3 ? -1 : 0);
          this.steer(side.add(radial), s.speed * (dist < keep - 3 ? 0.9 : 0.6), dt, 0);
          this.turnTo(toPlayer, 10, dt);
        } else if (s.style === 'melee' && dist < s.range + E.meleeCircleRange && this.cooldown > 0) {
          // Circle the player while waiting for the next attack.
          if (this.rand() < dt * 0.4) this.circleDir *= -1;
          const side = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).normalize().multiplyScalar(this.circleDir);
          const keep = toPlayer.clone().normalize().multiplyScalar(dist - (s.range + E.meleeCircleKeep));
          this.steer(side.add(keep), s.speed * 0.5, dt, 0);
          this.turnTo(toPlayer, 10, dt);
        } else {
          this.steer(toPlayer, s.speed, dt, 8);
        }
        break;
      }
      case 'windup': {
        let windup = s.combo && this.comboStep > 0 ? s.windup * 0.6 : s.windup;
        if (this.move) windup = BOSS_MOVES[this.move].windup / this.rage();
        const charging = s.style === 'charge' || this.move === 'charge';
        this.brake(dt);
        this.turnTo(toPlayer, charging ? 3 : 10, dt);
        if (this.stateTime >= windup) {
          this.chargeDir.copy(this.facingVector());
          if (s.style === 'lunge' || charging) this.vel.copy(this.chargeDir).multiplyScalar(s.lunge);
          this.setState('active');
        }
        break;
      }
      case 'phase':
        this.brake(dt);
        this.turnTo(toPlayer, 4, dt);
        if (this.stateTime >= PHASE_ROAR) {
          // Two skeletons climb out beside the boss.
          const side = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).normalize().multiplyScalar(5);
          for (const k of [1, -1]) {
            this.hooks?.summon?.(this, 'skeleton', this.pos.x + side.x * k, this.pos.z + side.z * k, this.level - 2);
          }
          this.cooldown = 0.8;
          this.setState('chase');
        }
        break;
      case 'active':
        this.updateActive(dt, player, dist);
        break;
      case 'recover':
        this.brake(dt);
        if (this.move) {
          if (this.stateTime >= BOSS_MOVES[this.move].recover / this.rage()) {
            this.move = null;
            this.cooldown = s.cooldown * (this.phase === 2 ? 0.7 : 1) * (0.8 + this.rand() * 0.4);
            this.setState('chase');
          }
          break;
        }
        if (this.stateTime >= s.recover) {
          if (s.combo && this.comboStep === 0 && dist < s.range + E.meleeComboRange) {
            this.comboStep = 1;
            this.setState('windup');
          } else {
            this.cooldown = s.cooldown * (0.8 + this.rand() * 0.4);
            this.setState('chase');
          }
        }
        break;
      case 'stagger': {
        const k = Math.exp(-6 * dt);
        this.vel.x *= k;
        this.vel.z *= k;
        this.walk(dt);
        if (this.stateTime >= this.staggerTime) {
          this.staggerKind = null;
          this.setState('chase');
        }
        break;
      }
      case 'return': {
        const d = this.home.clone().sub(this.pos).setY(0);
        this.steer(d, s.speed, dt, 8);
        if (d.length() < 0.8) {
          this.hp = this.maxHp;
          this.poise.reset();
          this.phase = 1;
          this.setState('idle');
        } else if (playerReachable && ((dist < s.aggro * 0.5 && fromHome < s.leash * 0.8) || this.tauntTime > 0)) {
          this.setState('chase');
        }
        break;
      }
      case 'dead':
        break;
    }
  }

  /** Boss: walk in and pick an attack for the distance. */
  private chaseBoss(dt: number, toPlayer: THREE.Vector3, dist: number): void {
    const s = this.stats;
    if (this.cooldown <= 0) {
      let m: BossMove | null = null;
      const r = this.rand();
      if (dist <= B.closeRange) m = this.phase === 2 && r < 0.25 ? 'nova' : r < 0.6 ? 'sweep' : 'slam';
      else if (dist > B.longRangeMin && dist < B.longRangeMax) m = this.phase === 2 && r < 0.5 ? 'volley' : 'charge';
      if (m) {
        this.move = m;
        this.setState('windup');
        return;
      }
    }
    if (dist > B.stopDistance) this.steer(toPlayer, s.speed * this.rage(), dt, 6);
    else {
      this.brake(dt);
      this.turnTo(toPlayer, 6, dt);
    }
  }

  private updateBoss(dt: number, player: Player, dist: number): void {
    const s = this.stats;
    const move = this.move!;
    const near = Math.abs(player.pos.y - this.pos.y) < B.hitY;
    if (move === 'charge') {
      this.vel.copy(this.chargeDir).multiplyScalar(s.lunge * this.speedMult());
      const blocked = this.walk(dt);
      if (!this.hitDone && dist < s.radius + B.chargeMargin && near) {
        this.hitDone = true;
        this.hitPlayer(player);
      }
      if (blocked) {
        // Slammed into the arena wall: a long opening.
        this.vel.set(0, 0, 0);
        this.move = null;
        this.hooks?.blast(this.pos.clone().setY(this.pos.y + 0.5), 2, 0x9a8a70);
        this.stagger({ kind: 'dazed', time: 1.4 });
        return;
      }
    } else {
      this.brake(dt);
      if (!this.hitDone && this.stateTime >= BOSS_MOVES[move].active * 0.5) {
        this.hitDone = true;
        const at = this.pos.clone().setY(this.pos.y + 0.3);
        if (move === 'sweep') {
          if (near && inArc(this.pos, this.facingVector(), player.pos, B.sweepReach, B.sweepArc)) this.hitPlayer(player);
        } else if (move === 'slam' || move === 'nova') {
          const r = move === 'nova' ? B.novaRadius : (s.aoe ?? 4.8);
          this.hooks?.blast(at, r, move === 'nova' ? 0xff6a2a : 0x9a8a70);
          if (near && dist < r + TUNING.radius) this.hitPlayer(player);
        } else if (move === 'volley') {
          const from = this.pos.clone().setY(this.pos.y + (s.projectileY ?? B.volleyY));
          const aim = player.pos.clone().setY(player.pos.y + 1).sub(from).normalize();
          const speed = s.projectileSpeed ?? 14;
          for (let i = -2; i <= 2; i++) {
            const v = aim.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), i * B.volleySpread).multiplyScalar(speed);
            this.hooks?.shoot(this, 'orb', from.clone(), v);
          }
        }
      }
    }
    if (this.stateTime >= BOSS_MOVES[move].active) this.setState('recover');
  }

  private updateActive(dt: number, player: Player, dist: number): void {
    const s = this.stats;
    if (this.move) {
      this.updateBoss(dt, player, dist);
      return;
    }
    const touch = s.radius + TUNING.radius + E.lungeMargin;
    if (s.style === 'melee') {
      this.brake(dt);
      if (!this.hitDone && this.stateTime >= s.active * 0.5) {
        this.hitDone = true;
        if (inArc(this.pos, this.facingVector(), player.pos, s.range + E.meleeMargin, E.meleeArc)) this.hitPlayer(player);
      }
    } else if (s.style === 'ranged') {
      this.brake(dt);
      if (!this.hitDone) {
        this.hitDone = true;
        // Lead the target a little.
        const from = this.pos.clone().setY(this.pos.y + (s.projectileY ?? s.centreY + E.projectileYOffset)).addScaledVector(this.facingVector(), E.projectileFwd);
        const speed = s.projectileSpeed ?? 20;
        const t = Math.min(1, from.distanceTo(player.pos) / speed);
        const aim = player.pos.clone().addScaledVector(player.vel.clone().setY(0), t * 0.6).setY(player.pos.y + 1.0);
        this.hooks?.shoot(this, s.projectile ?? 'arrow', from, aim.sub(from).normalize().multiplyScalar(speed));
      }
    } else if (s.style === 'slam') {
      this.brake(dt);
      if (!this.hitDone) {
        this.hitDone = true;
        const r = s.aoe ?? 3;
        this.hooks?.blast(this.pos.clone().setY(this.pos.y + 0.3), r, 0x9a8a70);
        if (dist < r + TUNING.radius && Math.abs(player.pos.y - this.pos.y) < E.slamY) this.hitPlayer(player);
      }
    } else {
      // Lunge / charge: keep going in a straight line, hurt on contact.
      if (s.style === 'lunge') {
        this.vel.x *= Math.exp(-3 * dt);
        this.vel.z *= Math.exp(-3 * dt);
      } else {
        this.vel.copy(this.chargeDir).multiplyScalar(s.lunge * this.speedMult());
      }
      const blocked = this.walk(dt);
      if (!this.hitDone && dist < touch) {
        this.hitDone = true;
        const r = this.hitPlayer(player);
        if (r === 'hit' && s.poison) player.poison(3, 4);
        if (s.style === 'charge' && r !== 'dodged') {
          this.vel.set(0, 0, 0);
          this.setState('recover');
          return;
        }
      }
      if (blocked && s.style === 'charge') {
        // Ran into a wall: dazed.
        this.vel.set(0, 0, 0);
        this.stagger({ kind: 'dazed', time: 0.75 });
        return;
      }
    }
    if (this.stateTime >= s.active) this.setState('recover');
  }

  /** A projectile from this enemy reached the player (called by Projectiles). */
  projectileHit(player: Player, from: THREE.Vector3): HitResult {
    const s = this.stats;
    // Boss orbs come five at a time: each one stings less.
    const k = this.isBoss ? 0.55 : 1;
    return player.takeHit({ damage: Math.round(this.damage * k), poise: s.poiseDamage * k, knockback: s.knockback, from });
  }

  private hitPlayer(player: Player): HitResult {
    const s = this.stats;
    const r = player.takeHit({ damage: this.damage, poise: s.poiseDamage, knockback: s.knockback, from: this.pos.clone() });
    if (r === 'parried') {
      // A parry cancels the hit and leaves the attacker open.
      this.vel.set(0, 0, 0);
      this.stagger({ kind: 'interrupted', time: 0.2 });
    }
    return r;
  }

  takeHit(hit: Hit, fx: CombatFx[], crit = false): HitResult {
    if (!this.alive || this.state === 'phase') return 'ignored';
    let damage = hit.damage;
    if (this.state === 'stagger') damage *= C.staggeredDamageBonus;
    damage = Math.round(damage);
    this.lastDamage = Math.min(damage, this.hp);
    this.hp -= damage;
    this.sinceHit = 0;
    const st = this.poise.apply(hit.poise);
    fx.push({ pos: this.centre(), amount: damage, target: 'enemy', result: 'hit', stagger: st?.kind ?? null, crit });

    const away = this.pos.clone().sub(hit.from).setY(0);
    if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
    away.normalize();
    if (this.hp <= 0) {
      this.hp = 0;
      this.vel.copy(away).multiplyScalar(hit.knockback);
      this.setState('dead');
      return 'hit';
    }
    this.checkPhase();
    if ((this.state as EnemyState) === 'phase') return 'hit';
    if (st) {
      this.vel.copy(away).multiplyScalar(hit.knockback);
      this.stagger(st);
    } else {
      // Light hits only nudge; a charging boar keeps going.
      if (!(this.stats.style === 'charge' && this.state === 'active') && this.stats.style !== 'slam' && !this.isBoss) {
        this.pos.addScaledVector(away, hit.knockback * 0.04);
      }
      if (this.state === 'idle' || this.state === 'return') this.setState('chase');
    }
    return 'hit';
  }

  speedMult(): number {
    return this.slowTime > 0 ? this.slowFactor : 1;
  }

  slow(factor: number, time: number): void {
    this.slowFactor = factor;
    this.slowTime = Math.max(this.slowTime, time);
  }

  /** Frozen solid / stunned for `time` seconds (frost nova, shield bash). */
  freeze(time: number, kind: StaggerKind = 'dazed'): void {
    if (!this.alive) return;
    this.vel.set(0, 0, 0);
    this.stagger({ kind, time });
  }

  taunt(time: number): void {
    if (!this.alive) return;
    this.tauntTime = time;
    if (this.state === 'idle' || this.state === 'return') this.setState('chase');
  }

  private stagger(st: { kind: StaggerKind; time: number }): void {
    if (this.state === 'phase') return;
    this.move = null;
    this.staggerKind = st.kind;
    this.staggerTime = st.time;
    this.setState('stagger');
  }

  // ---------------------------------------------------------------- movement

  private turnTo(dir: THREE.Vector3, rate: number, dt: number): void {
    if (dir.lengthSq() < 1e-6) return;
    const target = Math.atan2(-dir.x, -dir.z);
    let d = target - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, rate * dt);
  }

  private brake(dt: number): void {
    const k = Math.exp(-12 * dt);
    this.vel.x *= k;
    this.vel.z *= k;
    this.walk(dt);
  }

  /** Accelerate toward `dir` at `speed` (null = stop) and move; turns to face the motion. */
  private steer(dir: THREE.Vector3 | null, speed: number, dt: number, turnRate: number): void {
    const target = dir && dir.lengthSq() > 1e-6 ? dir.clone().normalize().multiplyScalar(speed * this.speedMult()) : new THREE.Vector3();
    const k = 1 - Math.exp(-8 * dt);
    this.vel.x += (target.x - this.vel.x) * k;
    this.vel.z += (target.z - this.vel.z) * k;
    if (turnRate > 0 && target.lengthSq() > 0.01) this.turnTo(target, turnRate, dt);
    this.walk(dt);
  }

  /** Move by vel*dt on the ground. Enemies never climb or step off cliffs. Returns true if blocked. */
  private walk(dt: number): boolean {
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const g = this.world.groundAt(nx, nz, this.pos.y + STEP_UP);
    const wall = this.world.terrainWall(nx, nz, this.pos.y + STEP_UP);
    let blocked = false;
    if (wall || g < this.pos.y - 2.5 || g > this.pos.y + STEP_UP) {
      blocked = true;
    } else {
      this.pos.x = nx;
      this.pos.z = nz;
    }
    if (this.world.resolveBoxes(this.pos, this.stats.radius, 1.5)) blocked = true;
    this.world.clampToWorld(this.pos);
    this.pos.y = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + STEP_UP);
    return blocked;
  }
}
