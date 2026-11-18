import * as THREE from 'three';
import { TUNING } from '../config';
import { mulberry32 } from '../core/noise';
import { toonMaterial } from '../core/toon';
import { buildItemMesh } from '../items/ItemMesh';
import { MATERIALS, RARITY_INFO, rollItem, type Item } from '../items/items';
import type { Enemy } from '../combat/Enemy';
import type { ClassId } from '../classes/classes';
import type { Player } from '../player/Player';
import type { World } from '../world/World';

/** Something the player can use with E: a drop, the chest, a display rack. */
export interface Interactable {
  pos: THREE.Vector3;
  radius: number;
  label: string;
  color?: string;
  act(): void;
}

export interface Drop {
  kind: 'item' | 'gold' | 'material';
  item?: Item;
  material?: string;
  amount: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  settled: boolean;
  age: number;
  group: THREE.Group;
  model: THREE.Object3D;
  beam?: THREE.Mesh;
}

const AUTO_PICKUP = 1.6;
const ITEM_REACH = 2.0;
const GOLD_LIFETIME = 300;

/** Loot on the ground: spawning from kills, bouncing, beams, pick-up. */
export class Loot {
  readonly drops: Drop[] = [];
  readonly group = new THREE.Group();
  /** Pick-up messages for the HUD feed: [text, colour]. */
  readonly feed: [string, string][] = [];
  rand = mulberry32(4242);

  constructor(private world: World) {}

  /** Roll an enemy's loot table and scatter the drops around its body. */
  dropFor(e: Enemy, cls?: ClassId): void {
    const t = TUNING.enemies.loot[e.kind];
    const at = e.pos.clone();
    const gold = t.gold[0] + Math.floor(this.rand() * (t.gold[1] - t.gold[0] + 1));
    if (gold > 0) this.spawn({ kind: 'gold', amount: gold }, at);
    if (this.rand() < t.materialChance) this.spawn({ kind: 'material', material: t.material, amount: 1 }, at);
    // Gear mostly drops for your own class (some for others, for the shared chest).
    const forCls = this.rand() < 0.8 ? cls : undefined;
    if (this.rand() < t.gear) this.spawn({ kind: 'item', item: rollItem(this.rand, t.level, undefined, forCls), amount: 1 }, at);
  }

  dropItem(item: Item, at: THREE.Vector3): Drop {
    return this.spawn({ kind: 'item', item, amount: 1 }, at);
  }

  private spawn(d: Pick<Drop, 'kind' | 'item' | 'material' | 'amount'>, at: THREE.Vector3): Drop {
    const a = this.rand() * Math.PI * 2;
    const speed = 1 + this.rand() * 1.5;
    const group = new THREE.Group();
    let model: THREE.Object3D;
    let beam: THREE.Mesh | undefined;
    if (d.kind === 'item') {
      model = buildItemMesh(d.item!);
      model.scale.setScalar(0.8);
      const color = RARITY_INFO[d.item!.rarity].color;
      const tall = { common: 1.5, uncommon: 3, rare: 4.5, epic: 6, legendary: 9 }[d.item!.rarity];
      beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.12, tall, 6, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      beam.position.y = tall / 2;
      group.add(beam);
    } else if (d.kind === 'gold') {
      model = new THREE.Group();
      const coin = toonMaterial(0xf2c341, { emissive: 0x806010, emissiveIntensity: 0.4 });
      for (let i = 0; i < Math.min(4, 1 + Math.floor(d.amount / 4)); i++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 8), coin);
        c.position.set((i % 2) * 0.12 - 0.06, 0.03 + i * 0.045, 0);
        model.add(c);
      }
    } else {
      model = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.22, 0.22),
        toonMaterial(new THREE.Color(MATERIALS[d.material!].color)),
      );
    }
    model.position.y = 0.3;
    group.add(model);
    this.group.add(group);
    const drop: Drop = {
      ...d,
      pos: at.clone().setY(at.y + 0.8),
      vel: new THREE.Vector3(Math.cos(a) * speed, 4, Math.sin(a) * speed),
      settled: false,
      age: 0,
      group,
      model,
      beam,
    };
    this.drops.push(drop);
    this.sync(drop);
    return drop;
  }

  update(dt: number, player: Player): void {
    for (const d of [...this.drops]) {
      d.age += dt;
      if (!d.settled) {
        d.vel.y -= TUNING.gravity * dt;
        d.pos.addScaledVector(d.vel, dt);
        const g = this.world.groundAt(d.pos.x, d.pos.z, d.pos.y + 0.5);
        if (d.pos.y <= g) {
          d.pos.y = g;
          d.settled = true;
        }
      }
      if (d.kind !== 'item' && d.age > GOLD_LIFETIME) {
        this.remove(d);
        continue;
      }
      // Gold and materials fly to you.
      if (d.kind !== 'item' && d.settled && player.state !== 'dead' && this.dist(d, player) < AUTO_PICKUP) {
        this.collect(d, player);
      }
    }
  }

  /** Visual sync (render time). */
  animate(t: number): void {
    for (const d of this.drops) {
      this.sync(d);
      d.model.rotation.y = t * 1.5;
      d.model.position.y = 0.35 + Math.sin(t * 2.5 + d.pos.x) * 0.08;
      if (d.beam) (d.beam.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(t * 3) * 0.15;
    }
  }

  private sync(d: Drop): void {
    d.group.position.copy(d.pos);
  }

  private dist(d: Drop, p: Player): number {
    return Math.hypot(d.pos.x - p.pos.x, d.pos.z - p.pos.z) + Math.max(0, Math.abs(d.pos.y - p.pos.y) - 1);
  }

  private collect(d: Drop, p: Player): void {
    if (d.kind === 'gold') {
      p.inv.gold += d.amount;
      p.inv.changed();
      this.feed.push([`+${d.amount} gold`, '#f2c341']);
    } else if (d.kind === 'material') {
      p.inv.addMaterial(d.material!, d.amount);
      this.feed.push([`+${d.amount} ${MATERIALS[d.material!].name}`, MATERIALS[d.material!].color]);
    }
    this.remove(d);
  }

  /** Pick up a gear drop into the bag. Returns false if the bag is full. */
  pickUp(d: Drop, p: Player): boolean {
    if (!d.item) return false;
    if (!p.inv.add(d.item)) {
      p.events.push('Your bag is full.');
      return false;
    }
    this.feed.push([d.item.name, RARITY_INFO[d.item.rarity].color]);
    this.remove(d);
    return true;
  }

  remove(d: Drop): void {
    const i = this.drops.indexOf(d);
    if (i >= 0) this.drops.splice(i, 1);
    this.group.remove(d.group);
  }

  /** Gear drops close enough to pick up. */
  interactables(p: Player): Interactable[] {
    return this.drops
      .filter((d) => d.kind === 'item' && this.dist(d, p) < ITEM_REACH)
      .map((d) => ({
        pos: d.pos,
        radius: ITEM_REACH,
        label: `Pick up ${d.item!.name}`,
        color: RARITY_INFO[d.item!.rarity].color,
        act: () => this.pickUp(d, p),
      }));
  }
}
