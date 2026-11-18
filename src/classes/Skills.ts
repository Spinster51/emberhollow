import * as THREE from 'three';
import { SKILLS, type SkillDef } from './classes';
import { inArc, type CombatFx } from '../combat/combat';
import type { Enemies } from '../combat/Enemies';
import type { Enemy } from '../combat/Enemy';
import type { Projectiles } from '../combat/Projectiles';
import type { Player } from '../player/Player';
import type { World } from '../world/World';

/** What a skill can see and touch while it runs. */
export interface SkillContext {
  player: Player;
  enemies: Enemies;
  projectiles: Projectiles;
  world: World;
  fx: CombatFx[];
  target: Enemy | null;
  camYaw: number;
  /** Camera-relative move input (for Blink's direction). */
  wish: THREE.Vector3;
  shake(amount: number): void;
  /** Swing the camera to look the way the player faces. */
  faceCamera(): void;
  hitStop(frames: number): void;
}

interface Running {
  def: SkillDef;
  t: number;
  /** Effect times already fired. */
  fired: Set<number>;
  dir: THREE.Vector3;
  hit: Set<Enemy>;
}

/**
 * Skills on keys 1–4. Each class has four (classes.ts); they unlock with level, cost mana,
 * have cooldowns and get stronger with tree ranks.
 */
export class Skills {
  readonly cooldowns: Record<string, number> = {};
  private run: Running | null = null;

  /** Seconds of cooldown left. */
  remaining(id: string): number {
    return Math.max(0, this.cooldowns[id] ?? 0);
  }

  reset(): void {
    for (const k of Object.keys(this.cooldowns)) delete this.cooldowns[k];
    this.run = null;
  }

  /** Why a skill can't be used right now, or null if it can. */
  blocked(slot: number, ctx: SkillContext): string | null {
    const p = ctx.player;
    const id = p.prog.def.skills[slot];
    const def = SKILLS[id];
    if (!def) return 'No skill.';
    if (!p.prog.skillUnlocked(id)) return `${def.name} unlocks at level ${def.unlock}.`;
    if (this.remaining(id) > 0) return `${def.name} is not ready.`;
    if (p.mana < def.mana) return 'Not enough mana.';
    if (!p.canAct()) return 'busy';
    if (id === 'riposte' && p.sinceParry > 1.5) return 'Riposte needs a parry first.';
    if (id === 'shadowstep' && !this.shadowTarget(ctx)) return 'No target in range.';
    return null;
  }

  /** Try to cast the skill in `slot` (0–3). Returns an error message or null. */
  cast(slot: number, ctx: SkillContext): string | null {
    const err = this.blocked(slot, ctx);
    if (err) return err;
    const p = ctx.player;
    const def = SKILLS[p.prog.def.skills[slot]];
    p.spendMana(def.mana);
    let cd = def.cooldown * p.stats.cooldownMult;
    if (def.id === 'shadowstep') cd -= p.prog.rank(def.id);
    this.cooldowns[def.id] = Math.max(0.5, cd);

    // Aim: lock target, crosshair for the mage, else where the camera looks.
    const aimAt = ctx.target ? ctx.target.pos : p.cls === 'mage' ? p.aimPoint : null;
    const dir = aimAt
      ? aimAt.clone().sub(p.pos).setY(0)
      : new THREE.Vector3(-Math.sin(ctx.camYaw), 0, -Math.cos(ctx.camYaw));
    if (dir.lengthSq() < 1e-6) dir.copy(p.facingVector());
    dir.normalize();
    p.faceTowards(p.pos.clone().add(dir));

    const invulnerable = def.id === 'blink';
    const drag = def.id === 'charge' ? 0 : 12;
    p.startSkill(def, invulnerable, drag);
    this.run = { def, t: 0, fired: new Set(), dir, hit: new Set() };
    this.step(0, ctx);
    return null;
  }

  update(dt: number, ctx: SkillContext): void {
    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] -= dt;
    const r = this.run;
    if (!r) return;
    if (ctx.player.state !== 'skill' || ctx.player.skill !== r.def) {
      this.run = null; // interrupted (stagger, death)
      return;
    }
    r.t += dt;
    this.step(dt, ctx);
  }

  /** Fire the skill's effect once when its time comes. */
  private at(time: number): boolean {
    const r = this.run!;
    if (r.t + 1e-9 < time || r.fired.has(time)) return false;
    r.fired.add(time);
    return true;
  }

  private bonus(p: Player, def: SkillDef): number {
    return 1 + def.rankBonus * p.prog.rank(def.id);
  }

  private hit(ctx: SkillContext, e: Enemy, mult: number, poise: number, knockback: number, from = ctx.player.pos): number {
    const p = ctx.player;
    const roll = p.rollHit(mult);
    return ctx.enemies.damage(e, p, { ...roll, poise, knockback, burn: p.stats.uniques.has('burn'), fire: p.stats.fireDamage }, from.clone(), ctx.fx);
  }

  private inFront(ctx: SkillContext, reach: number, arc: number): Enemy[] {
    const p = ctx.player;
    return ctx.enemies.list.filter((e) => e.alive && inArc(p.pos, p.facingVector(), e.pos, reach + e.stats.radius, arc));
  }

  private shadowTarget(ctx: SkillContext): Enemy | null {
    if (ctx.target?.alive) return ctx.target;
    let best: Enemy | null = null;
    let bestD = 12;
    for (const e of ctx.enemies.list) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(ctx.player.pos);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private hand(p: Player): THREE.Vector3 {
    return p.pos.clone().add(new THREE.Vector3(0, 1.4, 0)).addScaledVector(p.facingVector(), 0.6);
  }

  private step(_dt: number, ctx: SkillContext): void {
    const r = this.run!;
    const p = ctx.player;
    const def = r.def;
    const b = this.bonus(p, def);
    switch (def.id) {
      // ------------------------------------------------ warrior
      case 'charge': {
        p.vel.set(r.dir.x * 18, 0, r.dir.z * 18);
        for (const e of ctx.enemies.near(p.pos, 1.4)) {
          if (r.hit.has(e)) continue;
          r.hit.add(e);
          this.hit(ctx, e, 1.5 * b, 25, 6);
          ctx.hitStop(3);
        }
        if (r.t > def.time - 0.05) p.vel.set(0, 0, 0);
        break;
      }
      case 'whirlwind':
        for (const time of [0.1, 0.35, 0.6]) {
          if (!this.at(time)) continue;
          for (const e of ctx.enemies.near(p.pos, 3)) this.hit(ctx, e, 0.7 * b, 8, 2);
          ctx.projectiles.blast(p.pos.clone().setY(p.pos.y + 0.9), 3, 0xd8e2ff);
        }
        break;
      case 'warCry':
        if (this.at(0.15)) {
          p.damageBuffTime = 8 + 2 * p.prog.rank(def.id);
          for (const e of ctx.enemies.near(p.pos, 10)) e.taunt(3);
          ctx.projectiles.blast(p.pos.clone().setY(p.pos.y + 1), 4, 0xff5a3a);
          ctx.shake(0.2);
        }
        break;
      case 'earthsplitter':
        if (this.at(0.55)) {
          const f = p.facingVector();
          for (const e of ctx.enemies.list) {
            if (!e.alive) continue;
            const d = e.pos.clone().sub(p.pos);
            const along = d.dot(f);
            const side = Math.abs(d.x * f.z - d.z * f.x);
            if (along > 0 && along < 7 && side < 1.2 + e.stats.radius && Math.abs(d.y) < 2.5) this.hit(ctx, e, 3 * b, 60, 8);
          }
          for (let i = 1; i <= 6; i++) ctx.projectiles.blast(p.pos.clone().addScaledVector(f, i * 1.1).setY(p.pos.y + 0.3), 0.9, 0xb08a5a);
          ctx.shake(0.5);
          ctx.hitStop(5);
        }
        break;

      // ------------------------------------------------ tank
      case 'riposte':
        if (this.at(0.2)) {
          const mult = (2 + (3 * p.counter) / 100) * b;
          for (const e of this.inFront(ctx, 2.6, 140)) this.hit(ctx, e, mult, 50, 6);
          p.counter = 0;
          ctx.shake(0.35);
          ctx.hitStop(6);
        }
        break;
      case 'taunt':
        if (this.at(0.2)) {
          const time = 5 + p.prog.rank(def.id);
          for (const e of ctx.enemies.near(p.pos, 10)) {
            e.taunt(time);
            e.slow(0.6, time);
          }
          ctx.projectiles.blast(p.pos.clone().setY(p.pos.y + 1), 10, 0xffc04a);
        }
        break;
      case 'shieldBash':
        if (this.at(0.2)) {
          for (const e of this.inFront(ctx, 2.2, 100)) {
            this.hit(ctx, e, 1.2 * b, 45, 5);
            e.freeze(0.75);
          }
          ctx.hitStop(4);
        }
        break;
      case 'bulwark':
        if (this.at(0)) {
          p.guardTime = 5 + p.prog.rank(def.id);
          ctx.projectiles.blast(p.pos.clone().setY(p.pos.y + 1), 1.4, 0x9fb8ff);
        }
        break;

      // ------------------------------------------------ mage
      case 'fireball':
        if (this.at(0.3)) {
          const from = this.hand(p);
          const roll = p.rollHit(2.5 * b);
          ctx.projectiles.spawn({
            kind: 'fireball', from, vel: p.aimPoint.clone().sub(from).normalize().multiplyScalar(20),
            ...roll, poise: 20, knockback: 5, aoe: 3, burn: true, life: 1.6,
          });
        }
        break;
      case 'frostNova':
        if (this.at(0.2)) {
          const time = 2 + 0.4 * p.prog.rank(def.id);
          for (const e of ctx.enemies.near(p.pos, 5)) {
            this.hit(ctx, e, 0.8, 0, 0);
            e.freeze(time, 'dazed');
            e.slow(0.5, time + 2);
          }
          ctx.projectiles.blast(p.pos.clone().setY(p.pos.y + 0.6), 5, 0x9fe8ff);
        }
        break;
      case 'blink':
        if (this.at(0)) {
          const dir = ctx.wish.lengthSq() > 0.01 ? ctx.wish.clone().setY(0).normalize() : p.facingVector();
          const dist = 8 + 1.5 * p.prog.rank(def.id);
          const to = p.pos.clone();
          for (let d = 0.5; d <= dist; d += 0.5) {
            const q = p.pos.clone().addScaledVector(dir, d);
            const chest = q.clone().setY(Math.max(p.pos.y, ctx.world.heightAt(q.x, q.z)) + 1);
            if (ctx.world.isSolid(chest, 0.2)) break;
            to.copy(q);
          }
          ctx.projectiles.blast(p.pos.clone().setY(p.pos.y + 1), 0.8, 0xc9a0ff);
          p.teleport(to);
          p.faceTowards(p.pos.clone().add(dir));
          ctx.projectiles.blast(p.pos.clone().setY(p.pos.y + 1), 0.8, 0xc9a0ff);
        }
        break;
      case 'meteor':
        if (this.at(0.4)) {
          const at = p.aimPoint.clone();
          at.y = ctx.world.groundAt(at.x, at.z, at.y + 1);
          const from = at.clone().add(new THREE.Vector3(3, 16, 3));
          const roll = p.rollHit(6 * b);
          ctx.projectiles.spawn({
            kind: 'meteor', from, vel: at.clone().sub(from), // arrives in 1 s
            ...roll, poise: 60, knockback: 8, aoe: 5, burn: true, life: 1.5,
          });
        }
        break;

      // ------------------------------------------------ assassin
      case 'shadowstep':
        if (this.at(0)) {
          const e = this.shadowTarget(ctx);
          if (e) {
            ctx.projectiles.blast(p.pos.clone().setY(p.pos.y + 1), 0.7, 0x332244);
            p.teleport(e.pos.clone().addScaledVector(e.facingVector(), -(1.1 + e.stats.radius)));
            p.faceTowards(e.pos);
            ctx.faceCamera();
            p.nextCrit = true;
          }
        }
        break;
      case 'fanOfKnives':
        if (this.at(0.15)) {
          const from = this.hand(p);
          const base = Math.atan2(r.dir.x, r.dir.z);
          for (let i = -2; i <= 2; i++) {
            const a = base + (i * 12 * Math.PI) / 180;
            const roll = p.rollHit(0.8 * b);
            ctx.projectiles.spawn({
              kind: 'knife', from: from.clone(), vel: new THREE.Vector3(Math.sin(a) * 25, 0, Math.cos(a) * 25),
              ...roll, poise: 5, knockback: 1, life: 0.6, fire: p.stats.fireDamage,
            });
          }
        }
        break;
      case 'vanish':
        if (this.at(0)) {
          p.stealthTime = 4 + p.prog.rank(def.id);
          ctx.projectiles.blast(p.pos.clone().setY(p.pos.y + 1), 1.5, 0x222233);
        }
        break;
      case 'eviscerate':
        if (this.at(0.3)) {
          const targets = this.inFront(ctx, 2.3, 100);
          targets.sort((a, c) => a.pos.distanceTo(p.pos) - c.pos.distanceTo(p.pos));
          const e = targets[0];
          if (e) {
            const low = e.hp / e.stats.hp < 0.3;
            this.hit(ctx, e, 4 * b * (low ? 2 : 1), 30, 4);
            ctx.hitStop(6);
            ctx.shake(0.3);
          }
        }
        break;
    }
  }
}
