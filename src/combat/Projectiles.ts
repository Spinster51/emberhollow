import * as THREE from 'three';
import type { World } from '../world/World';
import type { Player } from '../player/Player';
import type { Enemies } from './Enemies';
import type { Enemy } from './Enemy';
import type { CombatFx } from './combat';

export type ProjectileKind = 'bolt' | 'fireball' | 'knife' | 'meteor';

export interface ProjectileSpec {
  kind: ProjectileKind;
  from: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  crit: boolean;
  poise: number;
  knockback: number;
  /** Explosion radius (0 = single target). */
  aoe?: number;
  burn?: boolean;
  fire?: number;
  /** Seconds before it disappears. */
  life?: number;
  gravity?: number;
}

interface Projectile extends ProjectileSpec {
  pos: THREE.Vector3;
  age: number;
  mesh: THREE.Object3D;
}

interface Blast {
  mesh: THREE.Mesh;
  age: number;
  size: number;
}

const LOOK: Record<ProjectileKind, { color: number; size: number }> = {
  bolt: { color: 0x8fe3ff, size: 0.18 },
  fireball: { color: 0xff7a2a, size: 0.35 },
  knife: { color: 0xd8dde3, size: 0.1 },
  meteor: { color: 0xff5a1a, size: 0.9 },
};

/** Player projectiles (mage bolts and spells, thrown knives) and their explosions. */
export class Projectiles {
  readonly list: Projectile[] = [];
  readonly group = new THREE.Group();
  private blasts: Blast[] = [];

  constructor(private world: World) {}

  spawn(spec: ProjectileSpec): void {
    const look = LOOK[spec.kind];
    const mesh =
      spec.kind === 'knife'
        ? new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.45), new THREE.MeshBasicMaterial({ color: look.color }))
        : new THREE.Mesh(new THREE.IcosahedronGeometry(look.size, 0), new THREE.MeshBasicMaterial({ color: look.color }));
    this.group.add(mesh);
    const p: Projectile = { life: 1.5, ...spec, pos: spec.from.clone(), age: 0, mesh };
    this.list.push(p);
    this.sync(p);
  }

  update(dt: number, enemies: Enemies, player: Player, fx: CombatFx[]): void {
    for (const p of [...this.list]) {
      p.age += dt;
      if (p.gravity) p.vel.y -= p.gravity * dt;
      const prev = p.pos.clone();
      p.pos.addScaledVector(p.vel, dt);
      let hit: Enemy | null = null;
      const r = LOOK[p.kind].size + 0.25;
      for (const e of enemies.list) {
        if (!e.alive) continue;
        // Distance from the enemy body to the segment moved this step (no tunnelling).
        const c = e.centre();
        const seg = p.pos.clone().sub(prev);
        const t = Math.max(0, Math.min(1, c.clone().sub(prev).dot(seg) / Math.max(seg.lengthSq(), 1e-9)));
        const closest = prev.clone().addScaledVector(seg, t);
        const bodyR = e.stats.radius + (e.kind === 'bandit' ? 0.4 : 0.1);
        if (closest.distanceTo(c) < bodyR + r) {
          hit = e;
          p.pos.copy(closest);
          break;
        }
      }
      const ground = this.world.isSolid(p.pos, 0.02);
      if (hit || ground || p.age > (p.life ?? 1.5)) {
        if (p.aoe) this.explode(p, enemies, player, fx);
        else if (hit) {
          enemies.damage(hit, player, p, p.pos.clone().sub(p.vel.clone().setY(0).normalize()), fx);
        }
        this.remove(p);
        continue;
      }
      this.sync(p);
    }
    for (const b of [...this.blasts]) {
      b.age += dt;
      const k = b.age / 0.35;
      // A low dome that grows and fades.
      const r = b.size * (0.3 + k);
      b.mesh.scale.set(r, r * 0.35, r);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.45 * (1 - k));
      if (k >= 1) {
        this.group.remove(b.mesh);
        this.blasts.splice(this.blasts.indexOf(b), 1);
      }
    }
  }

  /** Area damage around a point (fireball, meteor, also used by skills). */
  explode(p: Pick<ProjectileSpec, 'damage' | 'crit' | 'poise' | 'knockback' | 'burn' | 'fire' | 'aoe'> & { pos: THREE.Vector3 }, enemies: Enemies, player: Player, fx: CombatFx[], color = 0xff8a3a): number {
    const radius = p.aoe ?? 3;
    let hits = 0;
    for (const e of enemies.list) {
      if (!e.alive) continue;
      if (e.centre().distanceTo(p.pos) > radius + e.stats.radius) continue;
      enemies.damage(e, player, p, p.pos, fx);
      hits++;
    }
    this.blast(p.pos, radius, color);
    return hits;
  }

  /** Visual ring/sphere for area effects. */
  blast(at: THREE.Vector3, radius: number, color: number): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    mesh.position.copy(at);
    this.group.add(mesh);
    this.blasts.push({ mesh, age: 0, size: radius });
  }

  private sync(p: Projectile): void {
    p.mesh.position.copy(p.pos);
    p.mesh.lookAt(p.pos.clone().add(p.vel));
  }

  private remove(p: Projectile): void {
    this.list.splice(this.list.indexOf(p), 1);
    this.group.remove(p.mesh);
  }
}
