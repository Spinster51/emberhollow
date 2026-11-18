import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';
import type { ChestSpec } from './layouts';
import type { World } from './World';
import type { Interactable } from '../loot/Loot';

export interface WorldChest extends ChestSpec {
  pos: THREE.Vector3;
  lid: THREE.Mesh;
}

/**
 * Exploration chests on cliff tops, spires and hidden corners (DESIGN §7). Each character opens
 * each chest once; hard-to-reach ones (tier 1) always hold rare or better gear.
 */
export class Chests {
  readonly list: WorldChest[] = [];
  readonly group = new THREE.Group();
  /** Opened chest ids (per character, saved). */
  readonly opened = new Set<string>();

  constructor(world: World) {
    const wood = toonMaterial(0x7a4a26);
    const gold = toonMaterial(0xd9a83b, { emissive: 0x806010, emissiveIntensity: 0.4 });
    for (const spec of world.layout.chests) {
      const pos = new THREE.Vector3(spec.x, world.groundAt(spec.x, spec.z, 1e9), spec.z);
      const g = new THREE.Group();
      g.position.copy(pos);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.6), wood);
      body.position.y = 0.28;
      addOutline(body, 0.03);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.15, 0.64), gold);
      lid.position.set(0, 0.62, 0);
      addOutline(lid, 0.03);
      g.add(body, lid);
      this.group.add(g);
      this.list.push({ ...spec, pos, lid });
    }
  }

  /** Show opened chests with their lids up. */
  sync(): void {
    for (const c of this.list) {
      const open = this.opened.has(c.id);
      c.lid.rotation.x = open ? -1.2 : 0;
      c.lid.position.set(0, open ? 0.75 : 0.62, open ? 0.3 : 0);
    }
  }

  interactables(playerPos: THREE.Vector3, open: (c: WorldChest) => void): Interactable[] {
    return this.list
      .filter((c) => !this.opened.has(c.id) && c.pos.distanceTo(playerPos) < 2.5)
      .map((c) => ({ pos: c.pos, radius: 2, label: 'Open chest', color: '#ffd27a', act: () => open(c) }));
  }
}
