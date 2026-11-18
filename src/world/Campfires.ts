import * as THREE from 'three';
import { toonMaterial } from '../core/toon';
import type { CampfireSpec } from './layouts';
import type { World } from './World';
import type { Interactable } from '../loot/Loot';

export interface Campfire extends CampfireSpec {
  pos: THREE.Vector3;
  flame: THREE.Mesh;
}

const DISCOVER = 9;

/**
 * Campfires: walk close to discover one; press E to rest (heal, set respawn, reset the world,
 * autosave) or fast-travel to any discovered campfire.
 */
export class Campfires {
  readonly list: Campfire[] = [];
  readonly group = new THREE.Group();
  /** Discovered campfire ids (per character, saved). */
  readonly discovered = new Set<string>();
  /** Newly discovered this step (HUD toast). */
  readonly news: Campfire[] = [];

  constructor(world: World) {
    const stone = toonMaterial(0x7d7468);
    const log = toonMaterial(0x5b3a20);
    const fire = new THREE.MeshBasicMaterial({ color: 0xffa63a });
    const core = new THREE.MeshBasicMaterial({ color: 0xffe08a });
    for (const spec of world.layout.campfires) {
      const pos = new THREE.Vector3(spec.x, world.groundAt(spec.x, spec.z, 1e9), spec.z);
      const g = new THREE.Group();
      g.position.copy(pos);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.3), stone);
        s.position.set(Math.cos(a) * 0.75, 0.1, Math.sin(a) * 0.75);
        s.rotation.y = a;
        g.add(s);
      }
      for (const a of [0.3, 1.9]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.16), log);
        l.position.y = 0.12;
        l.rotation.y = a;
        g.add(l);
      }
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 6), fire);
      flame.position.y = 0.6;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.55, 5), core);
      inner.position.y = 0.45;
      g.add(flame, inner);
      this.group.add(g);
      this.list.push({ ...spec, pos, flame });
    }
  }

  get(id: string): Campfire | undefined {
    return this.list.find((c) => c.id === id);
  }

  /** Discover campfires near the player. */
  update(playerPos: THREE.Vector3): void {
    for (const c of this.list) {
      if (this.discovered.has(c.id)) continue;
      if (c.pos.distanceTo(playerPos) < DISCOVER) {
        this.discovered.add(c.id);
        this.news.push(c);
      }
    }
  }

  animate(t: number): void {
    for (const c of this.list) {
      const k = 1 + Math.sin(t * 9 + c.pos.x) * 0.12;
      c.flame.scale.set(1, k, 1);
      c.flame.rotation.y = t * 2;
    }
  }

  interactables(playerPos: THREE.Vector3, use: (c: Campfire) => void): Interactable[] {
    return this.list
      .filter((c) => c.pos.distanceTo(playerPos) < 3)
      .map((c) => ({ pos: c.pos, radius: 2.6, label: `Rest at ${c.name}`, color: '#ffb25a', act: () => use(c) }));
  }
}
