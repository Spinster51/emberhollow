import * as THREE from 'three';
import { TUNING } from '../config';
import type { Input } from '../core/Input';
import type { Box, WallHit, World } from '../world/World';
import { Poise, type CombatFx, type Hit, type HitResult } from '../combat/combat';
import type { StaggerKind } from '../config';
import { Inventory, type Derived } from '../items/Inventory';
import { mulberry32 } from '../core/noise';
import { Progression } from '../classes/Progression';
import type { ClassId, ComboStep, SkillDef } from '../classes/classes';

export type MoveState =
  | 'ground' | 'air' | 'roll' | 'climb' | 'climbJump' | 'mantle' | 'glide'
  | 'attack' | 'skill' | 'stagger' | 'dead';

/** A sword strike that reached its hit point this step; the game resolves it against enemies. */
export interface Strike {
  index: number;
  damage: number;
  poise: number;
  knockback: number;
  crit: boolean;
  /** Extra fire damage per hit (affix). */
  fire: number;
  /** Sets the target alight (Emberfang). */
  burn: boolean;
  /** Mage bolt: the game launches a projectile instead of a melee arc. */
  projectile?: boolean;
  reach?: number;
  arc?: number;
}

/** Result of rolling one hit's damage. */
export interface HitRoll {
  damage: number;
  crit: boolean;
}

const C = TUNING.combat;

const T = TUNING;

/**
 * Player movement state machine: walk / sprint / jump / dodge-roll / climb / glide.
 * `pos` is the point between the feet.
 */
export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  /** Facing direction (yaw, radians; 0 = facing -Z). */
  facing = 0;
  state: MoveState = 'air';
  stateTime = 0;

  readonly inv = new Inventory();
  readonly prog = new Progression();
  /** Stats from class, level, attributes, tree and gear; see `refreshStats()`. */
  stats: Derived = this.inv.derive(this.prog);
  private statsKey = '';
  /** Seeded so crits are repeatable in tests. */
  rand = mulberry32(1234);

  stamina = T.stamina.max;
  exhausted = false;
  private sinceStaminaUse = 0;

  hp = T.maxHp;
  mana = 50;

  // Buffs and class mechanics
  /** War Cry: seconds of +damage left. */
  damageBuffTime = 0;
  damageBuff = 0.25;
  /** Bulwark: seconds of damage reduction left (no staggers). */
  guardTime = 0;
  /** Vanish: seconds of stealth left. */
  stealthTime = 0;
  /** Shadowstep: next hit is a guaranteed crit. */
  nextCrit = false;
  /** Spider poison: damage per second for a few seconds. */
  poisonTime = 0;
  private poisonDps = 0;
  private poisonAcc = 0;
  /** Where you come back after dying (last campfire or bed). */
  readonly respawnPoint = new THREE.Vector3(NaN, 0, 0);
  /** Tank counter meter, 0–100: blocks and parries fill it. */
  counter = 0;
  /** Seconds since the last parry (Riposte window). */
  sinceParry = 99;
  /** Mage: right click held = aiming (slow walk, face the crosshair). */
  aiming = false;
  /** Where ranged attacks go (set by the game every step: lock target or crosshair). */
  readonly aimPoint = new THREE.Vector3();
  // Skill state
  skill: SkillDef | null = null;
  /** Untouchable while the current skill runs (blink). */
  skillInvulnerable = false;
  /** Velocity drag during skills; 0 = keep the velocity the skill set. */
  skillDrag = 12;

  get level(): number {
    return this.prog.level;
  }

  get cls(): ClassId {
    return this.prog.cls;
  }
  gliderUnlocked = true; // test map: unlocked from the start
  sprinting = false;
  invulnerable = false;

  // Climb data
  wallNormal = new THREE.Vector3(0, 0, 1);
  private wallBox: Box | null = null;
  climbMove = new THREE.Vector2();
  private climbFrom = new THREE.Vector3();
  private climbTo = new THREE.Vector3();

  // Roll data
  private rollDir = new THREE.Vector3();

  // Combat data
  readonly poise = new Poise(C.poise.max, C.poise.regen, C.poise.regenDelay);
  /** Index into the combo of the current strike. */
  comboIndex = 0;
  /** Seconds left on a buffered attack press. */
  private attackBuffer = 0;
  private chainQueued = false;
  private strikeDone = false;
  /** Set on the step a strike lands; read and cleared by the game. */
  strike: Strike | null = null;
  blocking = false;
  /** Seconds the block has been held (0 when not blocking); the model raises the shield with it. */
  blockTime = 0;
  staggerKind: StaggerKind | null = null;
  private staggerTime = 0;
  deaths = 0;
  /** Hit feedback for the HUD/camera; drained by the game. */
  readonly fx: CombatFx[] = [];

  private airTime = 0;
  private lowestVy = 0;
  /** Seconds the player has been pushing into a low wall on the ground. */
  private pushTime = 0;

  /** Events the HUD can show (e.g. "-12 fall damage"). */
  readonly events: string[] = [];

  constructor(private world: World) {
    this.respawn();
  }

  /** Start a fresh character of the given class. */
  setClass(cls: ClassId): void {
    this.prog.reset(cls);
    this.inv.resetFor(cls);
    this.respawn();
  }

  /** Poison (spiders): `dps` damage each second for `time` seconds. */
  poison(time: number, dps: number): void {
    this.poisonTime = Math.max(this.poisonTime, time);
    this.poisonDps = dps;
  }

  respawn(): void {
    this.pos.copy(Number.isNaN(this.respawnPoint.x) ? this.world.spawn : this.respawnPoint);
    this.poisonTime = 0;
    this.vel.set(0, 0, 0);
    this.refreshStats();
    this.hp = this.stats.maxHp;
    this.stamina = this.stats.maxStamina;
    this.mana = this.stats.maxMana;
    this.damageBuffTime = this.guardTime = this.stealthTime = 0;
    this.nextCrit = false;
    this.counter = 0;
    this.sinceParry = 99;
    this.aiming = false;
    this.skill = null;
    this.exhausted = false;
    this.poise.reset();
    this.blocking = false;
    this.blockTime = 0;
    this.strike = null;
    this.attackBuffer = 0;
    this.setState('ground');
  }

  private setState(s: MoveState): void {
    if (this.state === 'air' && s !== 'air') this.airTime = 0;
    if (s !== 'stagger') this.staggerKind = null;
    this.state = s;
    this.stateTime = 0;
  }

  /** Spend stamina; returns false (and spends nothing) if not allowed. */
  private spend(amount: number): boolean {
    if (this.exhausted) return false;
    this.sinceStaminaUse = 0;
    this.stamina -= amount;
    if (this.stamina <= 0) {
      this.stamina = 0;
      this.exhausted = true;
    }
    return true;
  }

  private canUseStamina(min = 0.01): boolean {
    return !this.exhausted && this.stamina >= min;
  }

  /** Remember presses that must survive a few frames (also called during hit-stop). */
  readInput(input: Input, dt: number): void {
    if (input.consumePress('attack')) this.attackBuffer = C.buffer;
    else this.attackBuffer = Math.max(0, this.attackBuffer - dt);
  }

  /**
   * @param aim lock-on target position, if any. Attacks face it; otherwise they face the camera.
   */
  update(dt: number, input: Input, camYaw: number, aim: THREE.Vector3 | null = null): void {
    this.stateTime += dt;
    this.sinceStaminaUse += dt;
    this.strike = null;
    this.readInput(input, dt);
    this.poise.update(dt);
    this.refreshStats();
    if (this.stats.uniques.has('regen')) this.heal(C.regen * dt);
    if (this.stats.hpRegen > 0) this.heal(this.stats.hpRegen * dt);
    if (this.state !== 'dead') this.mana = Math.min(this.stats.maxMana, this.mana + this.stats.manaRegen * dt);
    this.damageBuffTime = Math.max(0, this.damageBuffTime - dt);
    this.guardTime = Math.max(0, this.guardTime - dt);
    this.stealthTime = Math.max(0, this.stealthTime - dt);
    this.sinceParry += dt;
    if (this.poisonTime > 0 && this.state !== 'dead') {
      this.poisonTime -= dt;
      this.poisonAcc += dt;
      if (this.poisonAcc >= 1) {
        this.poisonAcc -= 1;
        this.hp -= this.poisonDps;
        this.fx.push({ pos: this.pos.clone().setY(this.pos.y + 1.6), amount: this.poisonDps, target: 'player', result: 'hit', stagger: null, dot: true });
        if (this.hp <= 0) this.die('Poison got you.');
      }
    }
    this.aim = aim;
    this.camYaw = camYaw;

    // Camera-relative wish direction.
    const fx = -Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw);
    const rz = -Math.sin(camYaw);
    const wish = new THREE.Vector3(
      fx * input.moveY + rx * input.moveX,
      0,
      fz * input.moveY + rz * input.moveX,
    );

    switch (this.state) {
      case 'ground':
        this.updateGround(dt, input, wish);
        break;
      case 'air':
        this.updateAir(dt, input, wish);
        break;
      case 'roll':
        this.updateRoll(dt, input);
        break;
      case 'climb':
        this.updateClimb(dt, input, camYaw);
        break;
      case 'climbJump':
        this.updateClimbJump(dt);
        break;
      case 'mantle':
        this.updateMantle(dt);
        break;
      case 'glide':
        this.updateGlide(dt, input, wish);
        break;
      case 'attack':
        this.updateAttack(dt, input, wish);
        break;
      case 'skill':
        this.updateSkill(dt);
        break;
      case 'stagger':
        this.updateStagger(dt);
        break;
      case 'dead':
        if (this.stateTime >= C.deathTime) this.respawn();
        break;
    }
    if (this.state !== 'ground') {
      this.blocking = false;
      this.blockTime = 0;
      if (this.state !== 'attack') this.aiming = false;
    }

    this.world.clampToWorld(this.pos);
    this.regenStamina(dt);
    this.invulnerable =
      this.state === 'dead' ||
      (this.state === 'skill' && this.skillInvulnerable) ||
      (this.state === 'roll' && this.stateTime < T.roll.buildup + T.roll.move);
  }

  private aim: THREE.Vector3 | null = null;
  private camYaw = 0;

  private regenStamina(dt: number): void {
    const draining =
      this.state === 'climb' || this.state === 'glide' || this.state === 'climbJump' || this.sprinting;
    if (draining || this.sinceStaminaUse < T.stamina.regenDelay) return;
    if (!['ground', 'roll', 'mantle', 'attack', 'skill', 'stagger'].includes(this.state)) return;
    this.stamina = Math.min(this.stats.maxStamina, this.stamina + T.stamina.regen * dt);
    if (this.exhausted && this.stamina >= this.stats.maxStamina * T.stamina.recoverFraction) {
      this.exhausted = false;
    }
  }

  // ---------------------------------------------------------------- ground

  private updateGround(dt: number, input: Input, wish: THREE.Vector3): void {
    const moving = wish.lengthSq() > 0.01;

    // Dodge on press; keep holding to sprint afterwards.
    if (input.consumePress('dodge') && this.canUseStamina(1) && this.spend(this.rollCost(0))) {
      this.startRoll(moving ? wish : this.facingVector());
      return;
    }
    if (input.consumePress('jump')) {
      this.vel.y = T.jumpVelocity;
      this.setState('air');
      this.pos.y += 0.01;
      return;
    }
    if (this.attackBuffer > 0 && this.canUseStamina(1)) {
      this.startAttack(0);
      return;
    }

    // Right click: block (melee classes) or aim (mage).
    const secondary = input.isHeld('block');
    const mage = this.prog.def.secondary === 'aim';
    this.blocking = secondary && !mage;
    this.aiming = secondary && mage;
    this.blockTime = this.blocking ? this.blockTime + dt : 0;
    this.sprinting = moving && !secondary && input.isHeld('dodge') && this.canUseStamina();
    if (this.sprinting) this.spend(T.stamina.sprint * dt);

    let speed = (this.sprinting ? T.sprintSpeed : T.walkSpeed) * this.stats.moveSpeed;
    if (this.blocking) speed *= C.block.moveFactor;
    if (this.aiming) speed *= 0.6;
    const target = wish.clone().multiplyScalar(speed);
    this.accelerate(target, T.groundAccel, dt);
    // Locked on (and not sprinting), blocking or aiming: keep facing the target / camera and strafe.
    if (this.aim && !this.sprinting) this.turnTowards(this.aim.clone().sub(this.pos), 12, dt);
    else if (this.blocking || this.aiming) this.turnTowards(this.cameraForward(), 12, dt);
    else if (moving) this.turnTowards(wish, 12, dt);

    const wall = this.moveHorizontal(dt, true);
    if (wall && moving && wish.dot(wall.normal) < -0.5) {
      this.pushTime += dt;
      const height = wall.top - this.pos.y;
      if (height <= T.climb.vaultMax) {
        this.startMantle(wall, wall.top);
        return;
      }
      if (this.pushTime > 0.12 && this.canUseStamina(1) && !wall.box?.noClimb) {
        this.startClimb(wall);
        return;
      }
    } else {
      this.pushTime = 0;
    }

    // Stick to the ground, or start falling.
    const g = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (g < this.pos.y - 0.6) {
      this.vel.y = 0;
      this.setState('air');
      return;
    }
    this.pos.y = g;
    this.vel.y = 0;

    // Too steep to stand on: slide off.
    if (this.world.slopeAt(this.pos.x, this.pos.z) > T.maxWalkSlope * 1.15 && this.onTerrain()) {
      this.setState('air');
    }
  }

  private onTerrain(): boolean {
    return this.world.groundAt(this.pos.x, this.pos.z, this.pos.y) - this.world.heightAt(this.pos.x, this.pos.z) < 0.01;
  }

  private startRoll(dir: THREE.Vector3): void {
    this.rollDir.copy(dir).setY(0).normalize();
    this.facing = Math.atan2(-this.rollDir.x, -this.rollDir.z);
    this.sprinting = false;
    this.setState('roll');
  }

  private updateRoll(dt: number, input: Input): void {
    const { buildup, move, recover, startSpeed, endSpeed } = T.roll;
    const t = this.stateTime;
    let speed = 0;
    if (t < buildup) speed = startSpeed * 0.3;
    else if (t < buildup + move) {
      const k = (t - buildup) / move;
      speed = startSpeed + (endSpeed - startSpeed) * k;
    } else speed = endSpeed * 0.5;
    this.vel.x = this.rollDir.x * speed;
    this.vel.z = this.rollDir.z * speed;
    this.moveHorizontal(dt, true);

    const g = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (g < this.pos.y - 0.6) {
      this.vel.y = 0;
      this.setState('air');
      return;
    }
    this.pos.y = g;

    // Jump can cancel the recovery.
    if (t > buildup + move && input.consumePress('jump')) {
      this.vel.y = T.jumpVelocity;
      this.setState('air');
      return;
    }
    if (t >= buildup + move + recover) this.setState('ground');
  }

  // ---------------------------------------------------------------- air

  private updateAir(dt: number, input: Input, wish: THREE.Vector3): void {
    this.airTime += dt;
    this.sprinting = false;

    if (input.consumePress('jump') && this.canOpenGlider()) {
      this.vel.y = Math.max(this.vel.y, -T.glide.sinkSpeed);
      this.setState('glide');
      return;
    }

    const target = wish.clone().multiplyScalar(Math.max(T.walkSpeed, Math.hypot(this.vel.x, this.vel.z)));
    this.accelerate(target, T.airAccel, dt);
    if (wish.lengthSq() > 0.01) this.turnTowards(wish, 4, dt);

    this.vel.y -= T.gravity * dt;
    this.lowestVy = Math.min(this.lowestVy, this.vel.y);
    this.pos.y += this.vel.y * dt;

    const wall = this.moveHorizontal(dt, false);
    if (wall && !wall.box?.noClimb && this.wantsClimb(wall, wish)) {
      this.startClimb(wall);
      return;
    }
    this.checkLanding();
  }

  private canOpenGlider(): boolean {
    if (!this.gliderUnlocked || !this.canUseStamina(1)) return false;
    const above = this.pos.y - this.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    return above > T.glide.minHeight && (this.vel.y < 2 || this.airTime > 0.25);
  }

  private wantsClimb(wall: WallHit, wish: THREE.Vector3): boolean {
    if (!this.canUseStamina(1)) return false;
    if (wall.top - this.pos.y < 0.3) return false;
    const into = wish.lengthSq() > 0.01 ? wish.dot(wall.normal) < -0.3 : false;
    const flyingInto = new THREE.Vector3(this.vel.x, 0, this.vel.z).dot(wall.normal) < -1;
    return into || flyingInto;
  }

  private checkLanding(): void {
    const g = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3);
    if (this.pos.y > g) return;
    const steep = this.world.slopeAt(this.pos.x, this.pos.z) > T.maxWalkSlope * 1.15 && g - this.world.heightAt(this.pos.x, this.pos.z) < 0.01;
    if (steep) {
      // Slide down steep terrain instead of landing on it.
      const grad = this.world.gradientAt(this.pos.x, this.pos.z);
      const n = new THREE.Vector3(-grad.x, 0, -grad.y).normalize();
      this.pos.y = g;
      this.pos.addScaledVector(n, 0.05);
      this.vel.y = Math.max(this.vel.y, -6);
      this.vel.addScaledVector(n, 1);
      return;
    }
    this.pos.y = g;
    this.applyFallDamage(this.lowestVy);
    if (this.state === 'dead') return;
    this.lowestVy = 0;
    this.vel.y = 0;
    this.setState('ground');
  }

  private applyFallDamage(vy: number): void {
    const over = -vy - T.fall.safeSpeed;
    if (over <= 0) return;
    const dmg = Math.round(over * T.fall.damagePerSpeed);
    this.hp -= dmg;
    this.events.push(`-${dmg} fall damage`);
    if (this.hp <= 0) this.die('You fell.');
  }

  // ---------------------------------------------------------------- combat

  private cameraForward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
  }

  /** The class's primary-attack combo. */
  combo(): ComboStep[] {
    return this.prog.def.combo;
  }

  private startAttack(index: number): void {
    const a = this.combo()[index];
    if (!this.spend(a.stamina)) return;
    this.attackBuffer = 0;
    this.comboIndex = index;
    this.chainQueued = false;
    this.strikeDone = false;
    this.sprinting = false;
    this.blocking = false;
    // Face the lock-on target, the crosshair (ranged) or where the camera looks.
    const dir = this.aim
      ? this.aim.clone().sub(this.pos).setY(0)
      : a.projectile ? this.aimPoint.clone().sub(this.pos).setY(0) : this.cameraForward();
    if (dir.lengthSq() > 1e-4) this.facing = Math.atan2(-dir.x, -dir.z);
    this.setState('attack');
  }

  /** Current phase of the attack: 'windup' | 'swing' | 'recover'. */
  attackPhase(): 'windup' | 'swing' | 'recover' {
    const a = this.attackTimes();
    if (this.stateTime < a.windup) return 'windup';
    if (this.stateTime < a.windup + a.swing) return 'swing';
    return 'recover';
  }

  private updateAttack(dt: number, input: Input, wish: THREE.Vector3): void {
    const a = this.attackTimes();
    const t = this.stateTime;
    const phase = this.attackPhase();

    // Roll out of the wind-up or recovery (never the swing), for extra stamina.
    if (phase !== 'swing' && input.consumePress('dodge')) {
      const cost = this.rollCost(C.rollCancelExtra);
      if (this.canUseStamina(1) && this.spend(cost)) {
        this.startRoll(wish.lengthSq() > 0.01 ? wish : this.facingVector());
        return;
      }
    }

    if (phase === 'windup' && this.aim) this.turnTowards(this.aim.clone().sub(this.pos), 20, dt);
    else if (phase === 'windup' && a.projectile) this.turnTowards(this.aimPoint.clone().sub(this.pos), 20, dt);

    // Pressing attack during the swing (or just before it, via the buffer) chains the combo.
    if (phase !== 'recover' && this.attackBuffer > 0 && t >= a.windup) {
      this.chainQueued = true;
      this.attackBuffer = 0;
    }

    // Lunge forward during the swing, slowing to a stop.
    const f = this.facingVector();
    const lunge = phase === 'swing' ? a.lunge * (1 - (t - a.windup) / a.swing) : 0;
    const k = 1 - Math.exp(-20 * dt);
    this.vel.x += (f.x * lunge - this.vel.x) * k;
    this.vel.z += (f.z * lunge - this.vel.z) * k;
    this.moveHorizontal(dt, true);
    if (this.stickToGround()) return;

    if (!this.strikeDone && t >= a.windup + a.swing * a.hitAt) {
      this.strikeDone = true;
      const roll = this.rollHit(a.mult);
      this.strike = {
        index: this.comboIndex,
        damage: roll.damage,
        poise: a.poise,
        knockback: a.knockback,
        crit: roll.crit,
        fire: this.stats.fireDamage,
        burn: this.stats.uniques.has('burn'),
        projectile: a.projectile,
        reach: a.reach,
        arc: a.arc,
      };
    }

    if (t >= a.windup + a.swing && this.chainQueued) {
      if (this.comboIndex < this.combo().length - 1 && this.canUseStamina(1)) {
        this.startAttack(this.comboIndex + 1);
        if (this.state === 'attack') return;
      }
      this.chainQueued = false;
    }
    if (t >= a.windup + a.swing + a.recover) this.setState('ground');
  }

  /** Follow the ground; returns true if the player started falling. */
  private stickToGround(): boolean {
    const g = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (g < this.pos.y - 0.6) {
      this.vel.y = 0;
      this.setState('air');
      return true;
    }
    this.pos.y = g;
    this.vel.y = 0;
    return false;
  }

  private updateStagger(dt: number): void {
    const k = Math.exp(-6 * dt);
    this.vel.x *= k;
    this.vel.z *= k;
    this.moveHorizontal(dt, true);
    if (this.stickToGround()) return;
    if (this.stateTime >= this.staggerTime) {
      this.staggerKind = null;
      this.setState('ground');
    }
  }

  /**
   * Roll one hit's damage: weapon × `mult` × damage bonuses (attributes, War Cry), crit
   * (Shadowstep makes it certain) and the stealth opener bonus (+100%, ends stealth).
   */
  rollHit(mult: number): HitRoll {
    const st = this.stats;
    const crit = this.nextCrit || this.rand() < st.crit;
    this.nextCrit = false;
    let dmg = st.weaponDamage * mult * st.damageMult * (crit ? st.critMult : 1);
    if (this.damageBuffTime > 0) dmg *= 1 + this.damageBuff;
    if (this.stealthTime > 0) {
      dmg *= 2;
      this.stealthTime = 0;
    }
    return { damage: Math.round(dmg), crit };
  }

  spendMana(n: number): boolean {
    if (this.mana < n) return false;
    this.mana -= n;
    return true;
  }

  /** Enter the skill state (the SkillSystem drives what happens). */
  startSkill(def: SkillDef, invulnerable = false, drag = 12): void {
    this.skill = def;
    this.skillInvulnerable = invulnerable;
    this.skillDrag = drag;
    this.sprinting = false;
    this.blocking = false;
    this.setState('skill');
  }

  /** Can a skill start now? (on the ground, idle, attacking or blocking) */
  canAct(): boolean {
    return this.state === 'ground' || (this.state === 'attack' && this.attackPhase() !== 'swing');
  }

  private updateSkill(dt: number): void {
    if (this.skillDrag > 0) {
      const k = Math.exp(-this.skillDrag * dt);
      this.vel.x *= k;
      this.vel.z *= k;
    }
    this.moveHorizontal(dt, true);
    if (this.stickToGround()) return;
    if (this.skill && this.stateTime >= this.skill.time) {
      this.skill = null;
      this.setState('ground');
    }
  }

  /** Teleport (blink / shadowstep): keeps out of walls and onto the ground. */
  teleport(to: THREE.Vector3): void {
    this.pos.x = to.x;
    this.pos.z = to.z;
    this.world.clampToWorld(this.pos);
    this.pos.y = this.world.groundAt(this.pos.x, this.pos.z, Math.max(this.pos.y, to.y) + 2);
    this.world.resolveBoxes(this.pos, T.radius, T.height);
  }

  /** Face a point. */
  faceTowards(p: THREE.Vector3): void {
    const d = p.clone().sub(this.pos);
    if (d.x * d.x + d.z * d.z > 1e-6) this.facing = Math.atan2(-d.x, -d.z);
  }

  /** Apply an enemy hit: rolls dodge it, blocks reduce it, an early block parries it. */
  takeHit(hit: Hit): HitResult {
    if (this.state === 'dead') return 'ignored';
    const fxPos = this.pos.clone().setY(this.pos.y + 1.6);
    if (this.invulnerable) {
      this.fx.push({ pos: fxPos, amount: 0, target: 'player', result: 'dodged', stagger: null });
      return 'dodged';
    }
    const away = this.pos.clone().sub(hit.from).setY(0);
    if (away.lengthSq() < 1e-6) away.copy(this.facingVector()).negate();
    away.normalize();

    let damage = hit.damage;
    let poise = hit.poise;
    let result: HitResult = 'hit';
    const facesAttacker = this.facingVector().dot(away) <= -Math.cos(((C.block.arc / 2) * Math.PI) / 180);
    if (this.blocking && facesAttacker) {
      const tank = this.cls === 'tank';
      if (this.blockTime <= C.block.parryWindow) {
        this.fx.push({ pos: fxPos, amount: 0, target: 'player', result: 'parried', stagger: null });
        this.sinceParry = 0;
        if (tank) this.counter = Math.min(100, this.counter + 35);
        return 'parried';
      }
      damage *= 1 - this.stats.blockStrength;
      poise *= 1 - this.stats.blockStrength;
      if (tank) this.counter = Math.min(100, this.counter + 10);
      result = 'blocked';
    }
    if (this.state === 'stagger') damage *= C.staggeredDamageBonus;
    if (this.guardTime > 0) damage *= 0.5;
    damage = Math.round(damage * (1 - this.stats.armourReduction));
    this.hp -= damage;
    this.stealthTime = 0;
    const stagger = this.guardTime > 0 ? null : this.poise.apply(poise);
    this.fx.push({ pos: fxPos, amount: damage, target: 'player', result, stagger: stagger?.kind ?? null });

    if (this.hp <= 0) {
      this.die('You died.');
      return result;
    }
    const push = result === 'blocked' ? hit.knockback * 0.4 : hit.knockback;
    if (stagger) {
      // A stagger knocks you out of climbing and closes the glider.
      this.staggerKind = stagger.kind;
      this.staggerTime = stagger.time;
      this.vel.set(away.x * push, 0, away.z * push);
      if (['ground', 'attack', 'skill', 'stagger', 'roll'].includes(this.state)) {
        this.skill = null;
        this.setState('stagger');
      } else {
        this.setState('air');
      }
    } else if (this.state === 'ground') {
      this.vel.x += away.x * push;
      this.vel.z += away.z * push;
    }
    return result;
  }

  /** Combo step timings, shortened by attack speed. */
  attackTimes(): ComboStep {
    const a = this.combo()[Math.min(this.comboIndex, this.combo().length - 1)];
    const k = 1 / this.stats.attackSpeed;
    return { ...a, windup: a.windup * k, swing: a.swing * k, recover: a.recover * k };
  }

  private rollCost(extra: number): number {
    return this.stats.uniques.has('freeRoll') ? 0 : Math.max(1, T.stamina.roll + extra - this.stats.rollDiscount);
  }

  /** Recompute stats from gear if the equipment changed. Keeps HP/stamina within the new maximums. */
  refreshStats(): void {
    const key = `${this.inv.version}:${this.prog.version}`;
    if (this.statsKey === key) return;
    this.statsKey = key;
    this.stats = this.inv.derive(this.prog);
    this.inv.cls = this.prog.cls;
    this.hp = Math.min(this.hp, this.stats.maxHp);
    this.stamina = Math.min(this.stamina, this.stats.maxStamina);
    this.mana = Math.min(this.mana, this.stats.maxMana);
  }

  /** Gain XP; on level-up, heal fully and announce it. */
  gainXp(n: number): number {
    const levels = this.prog.addXp(n);
    if (levels > 0) {
      this.refreshStats();
      this.hp = this.stats.maxHp;
      this.mana = this.stats.maxMana;
      this.events.push(`Level ${this.level}! +${levels * 5} attribute points, +${levels} skill point${levels > 1 ? 's' : ''} (K)`);
    }
    return levels;
  }

  heal(amount: number): void {
    if (this.state === 'dead') return;
    this.hp = Math.min(this.stats.maxHp, this.hp + amount);
  }

  private die(message: string): void {
    this.hp = 0;
    this.deaths++;
    this.vel.set(0, 0, 0);
    this.lowestVy = 0;
    this.sprinting = false;
    this.events.push(`${message} Respawning at the campfire…`);
    this.setState('dead');
  }

  // ---------------------------------------------------------------- glide

  private updateGlide(dt: number, input: Input, wish: THREE.Vector3): void {
    if (input.consumePress('jump') || !this.spend(T.stamina.glide * dt) || this.exhausted) {
      this.lowestVy = 0; // gliding resets the fall
      this.setState('air');
      return;
    }
    // Steer the heading toward the input; keep drifting forward without input.
    const desired = wish.lengthSq() > 0.01 ? wish.clone().normalize() : this.facingVector();
    this.turnTowards(desired, T.glide.turnRate, dt);
    const f = this.facingVector();
    const speed = wish.lengthSq() > 0.01 ? T.glide.speed : T.glide.speed * 0.6;
    const k = 1 - Math.exp(-3 * dt);
    this.vel.x += (f.x * speed - this.vel.x) * k;
    this.vel.z += (f.z * speed - this.vel.z) * k;
    this.vel.y += (-T.glide.sinkSpeed - this.vel.y) * (1 - Math.exp(-4 * dt));
    this.pos.y += this.vel.y * dt;
    this.lowestVy = 0;

    const wall = this.moveHorizontal(dt, false);
    if (wall && !wall.box?.noClimb && wall.top - this.pos.y > 0.3 && this.canUseStamina(1)) {
      this.startClimb(wall);
      return;
    }
    const g = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3);
    if (this.pos.y <= g) {
      this.pos.y = g;
      this.vel.set(0, 0, 0);
      this.setState('ground');
    }
  }

  // ---------------------------------------------------------------- climb

  private startClimb(wall: WallHit): void {
    this.wallNormal.copy(wall.normal);
    this.wallBox = wall.box;
    this.vel.set(0, 0, 0);
    this.lowestVy = 0;
    this.sprinting = false;
    this.facing = Math.atan2(this.wallNormal.x, this.wallNormal.z);
    this.setState('climb');
    this.snapToWall();
  }

  private updateClimb(dt: number, input: Input, camYaw: number): void {
    const n = this.wallNormal;
    // Up/down on the stick climbs; left/right moves along the wall (relative to the wall,
    // flipped if the camera looks at the wall from behind the player).
    const tangent = new THREE.Vector3(n.z, 0, -n.x); // right when facing the wall
    const camRight = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const side = input.moveX * (tangent.dot(camRight) >= 0 ? 1 : -1);
    const up = input.moveY;
    this.climbMove.set(side, up);

    if (input.consumePress('jump')) {
      if (up < -0.5) {
        // Jump off, away from the wall.
        this.vel.copy(n).multiplyScalar(T.climb.jumpOffSpeed).setY(5);
        this.facing = Math.atan2(-n.x, -n.z);
        this.setState('air');
        return;
      }
      if (this.canUseStamina(1) && this.spend(T.stamina.climbJump)) {
        this.climbFrom.copy(this.pos);
        this.setState('climbJump');
        return;
      }
    }

    const cost = Math.max(
      T.stamina.climbIdle,
      Math.max(up, 0) * T.stamina.climbUp + Math.abs(side) * T.stamina.climbSide,
    );
    if (!this.spend(cost * dt) || this.exhausted) {
      this.letGo();
      return;
    }

    this.pos.addScaledVector(tangent, side * T.climb.speed * dt);
    this.pos.y += up * T.climb.speed * dt;
    this.snapToWall();
  }

  private letGo(): void {
    this.vel.copy(this.wallNormal).multiplyScalar(1).setY(0);
    this.setState('air');
  }

  /**
   * Keep the chest against the wall. Handles reaching the top (mantle), reaching the
   * ground (stand) and running out of wall (fall).
   */
  private snapToWall(): void {
    if (this.state !== 'climb') return;
    const r = T.radius;
    const chestY = this.pos.y + T.chest;

    if (this.wallBox) {
      const b = this.wallBox;
      const n = this.wallNormal;
      // Clamp along the face and stick to it.
      if (n.x !== 0) {
        this.pos.x = n.x > 0 ? b.maxX + r : b.minX - r;
        this.pos.z = Math.min(b.maxZ - 0.15, Math.max(b.minZ + 0.15, this.pos.z));
      } else {
        this.pos.z = n.z > 0 ? b.maxZ + r : b.minZ - r;
        this.pos.x = Math.min(b.maxX - 0.15, Math.max(b.minX + 0.15, this.pos.x));
      }
      if (chestY >= b.maxY) {
        this.startMantle({ normal: n.clone(), top: b.maxY, box: b }, b.maxY);
        return;
      }
    } else {
      // Terrain: find the point where the surface is at chest height (Newton steps along the
      // downhill direction), then hang the body just outside it.
      const c = this.pos.clone().addScaledVector(this.wallNormal, -r);
      let g = new THREE.Vector2();
      let n = this.wallNormal.clone();
      for (let i = 0; i < 4; i++) {
        const f = this.world.heightAt(c.x, c.z) - chestY;
        g = this.world.gradientAt(c.x, c.z, g);
        const gl = g.length();
        if (gl < 0.05) break;
        n.set(-g.x / gl, 0, -g.y / gl);
        const step = Math.max(-0.5, Math.min(0.5, f / gl));
        c.addScaledVector(n, step);
      }
      const gl = this.world.gradientAt(c.x, c.z).length();
      const f = this.world.heightAt(c.x, c.z) - chestY;
      if (gl < T.maxWalkSlope * 0.8 && f > -0.6) {
        // The wall has flattened out at chest height: climb over the top.
        const top = this.world.heightAt(c.x - n.x * 0.5, c.z - n.z * 0.5);
        this.startMantle({ normal: n.clone(), top, box: null }, top);
        return;
      }
      if (f < -0.8) {
        // Nothing to hold on to (overhang or the wall ended).
        this.letGo();
        return;
      }
      this.wallNormal.lerp(n, 0.5).setY(0).normalize();
      this.pos.x = c.x + this.wallNormal.x * r;
      this.pos.z = c.z + this.wallNormal.z * r;
    }
    this.facing = Math.atan2(this.wallNormal.x, this.wallNormal.z);

    // Climbed down to the ground.
    const ground = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.1);
    if (this.pos.y <= ground + 0.02 && this.climbMove.y <= 0 && this.stateTime > 0.2) {
      this.pos.y = ground;
      this.setState('ground');
    } else if (this.pos.y < ground) {
      this.pos.y = ground;
    }
  }

  private updateClimbJump(dt: number): void {
    const t = Math.min(1, this.stateTime / T.climb.jumpUpTime);
    const eased = 1 - (1 - t) * (1 - t);
    const prevY = this.pos.y;
    this.pos.y = this.climbFrom.y + T.climb.jumpUp * eased;
    this.climbMove.set(0, (this.pos.y - prevY) / Math.max(dt, 1e-4) / T.climb.speed);
    this.state = 'climb';
    this.snapToWall();
    if ((this.state as MoveState) !== 'climb') return; // mantled or let go
    this.state = 'climbJump';
    if (t >= 1) this.setState('climb');
  }

  private startMantle(wall: WallHit, top: number): void {
    this.climbFrom.copy(this.pos);
    this.climbTo.copy(this.pos).addScaledVector(wall.normal, -(T.radius + 0.55));
    this.climbTo.y = Math.max(top, this.world.groundAt(this.climbTo.x, this.climbTo.z, top + 0.1));
    this.vel.set(0, 0, 0);
    this.facing = Math.atan2(wall.normal.x, wall.normal.z);
    this.sprinting = false;
    this.setState('mantle');
  }

  private updateMantle(_dt: number): void {
    const t = Math.min(1, this.stateTime / T.climb.mantleTime);
    // Rise first, then move forward over the edge.
    const up = Math.min(1, t * 1.6);
    const fwd = Math.max(0, (t - 0.4) / 0.6);
    this.pos.y = this.climbFrom.y + (this.climbTo.y - this.climbFrom.y) * (1 - (1 - up) * (1 - up));
    this.pos.x = this.climbFrom.x + (this.climbTo.x - this.climbFrom.x) * fwd;
    this.pos.z = this.climbFrom.z + (this.climbTo.z - this.climbFrom.z) * fwd;
    if (t >= 1) {
      this.pos.copy(this.climbTo);
      this.setState('ground');
    }
  }

  // ---------------------------------------------------------------- helpers

  facingVector(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.facing), 0, -Math.cos(this.facing));
  }

  private turnTowards(dir: THREE.Vector3, rate: number, dt: number): void {
    const target = Math.atan2(-dir.x, -dir.z);
    let d = target - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, rate * dt);
  }

  private accelerate(target: THREE.Vector3, accel: number, dt: number): void {
    const dx = target.x - this.vel.x;
    const dz = target.z - this.vel.z;
    const len = Math.hypot(dx, dz);
    const max = accel * dt;
    if (len <= max) {
      this.vel.x = target.x;
      this.vel.z = target.z;
    } else {
      this.vel.x += (dx / len) * max;
      this.vel.z += (dz / len) * max;
    }
  }

  /**
   * Move horizontally by vel*dt, stopping at walls (terrain cliffs or boxes).
   * Returns the wall that blocked the move, if any.
   */
  private moveHorizontal(dt: number, grounded: boolean): WallHit | null {
    const prev = this.pos.clone();
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    let hit: WallHit | null = null;

    // Terrain cliffs: probe at the body edge in the direction of travel.
    const dir = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    if (dir.lengthSq() > 1e-6) {
      dir.normalize();
      const px = this.pos.x + dir.x * T.radius;
      const pz = this.pos.z + dir.z * T.radius;
      const limit = this.pos.y + (grounded ? T.stepUp : 0.05);
      const w = this.world.terrainWall(px, pz, limit);
      if (w) {
        this.pos.x = prev.x;
        this.pos.z = prev.z;
        // Slide along the wall.
        const into = dir.dot(w.normal);
        const slide = new THREE.Vector3(this.vel.x, 0, this.vel.z).addScaledVector(w.normal, -into * Math.hypot(this.vel.x, this.vel.z));
        const sx = this.pos.x + slide.x * dt;
        const sz = this.pos.z + slide.z * dt;
        if (!this.world.terrainWall(sx + dir.x * T.radius * 0.5, sz + dir.z * T.radius * 0.5, limit)) {
          this.pos.x = sx;
          this.pos.z = sz;
        }
        hit = w;
      }
    }

    const boxHit = this.world.resolveBoxes(this.pos, T.radius, T.height);
    if (boxHit) {
      const into = this.vel.x * boxHit.normal.x + this.vel.z * boxHit.normal.z;
      if (into < 0) {
        this.vel.x -= boxHit.normal.x * into;
        this.vel.z -= boxHit.normal.z * into;
      }
      hit = boxHit;
    }
    return hit;
  }

}
