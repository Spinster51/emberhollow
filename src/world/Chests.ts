import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';
import { lazyModel } from '../items/ItemMesh';
import { CHEST_ART, WORLD_FILE } from '../art/assets';
import { loadWorldFile, worldNode } from './worldModels';
import type { ChestSpec } from './layouts';
import type { World } from './World';
import type { Interactable } from '../loot/Loot';

export interface WorldChest extends ChestSpec {
  pos: THREE.Vector3;
  /** The chest's look (its model once the world file loads, boxes until then); `userData.lid` is the lid's hinge. */
  look: THREE.Group;
}

/**
 * Exploration chests on cliff tops, spires and hidden corners (DESIGN §7). Each character opens
 * each chest once; hard-to-reach ones (tier 1) always hold rare or better gear (and look gilded).
 */
export class Chests {
  readonly list: WorldChest[] = [];
  readonly group = new THREE.Group();
  /** Opened chest ids (per character, saved). */
  readonly opened = new Set<string>();

  /** `file` can be swapped by tests (a missing file keeps the boxes). */
  constructor(world: World, file = WORLD_FILE) {
    for (const spec of world.layout.chests) {
      const pos = new THREE.Vector3(spec.x, world.groundAt(spec.x, spec.z, 1e9), spec.z);
      const g = new THREE.Group();
      g.position.copy(pos);
      const art = spec.tier === 1 ? CHEST_ART.gold : CHEST_ART.normal;
      const look = lazyModel(file, () => chestModel(art, file), proceduralChest, (f) => loadWorldFile(f));
      g.add(look);
      this.group.add(g);
      this.list.push({ ...spec, pos, look });
    }
    // The model arrives after the first sync: show opened lids on it too.
    loadWorldFile(file).then(() => this.sync(), () => {});
  }

  /** Show opened chests with their lids up. */
  sync(): void {
    for (const c of this.list) {
      const shown = c.look.children[0];
      const lid = shown?.userData.lid as THREE.Object3D | undefined;
      if (lid) lid.rotation.x = this.opened.has(c.id) ? (c.look.userData.model ? CHEST_ART.open : -1.2) : 0;
    }
  }

  interactables(playerPos: THREE.Vector3, open: (c: WorldChest) => void): Interactable[] {
    return this.list
      .filter((c) => !this.opened.has(c.id) && c.pos.distanceTo(playerPos) < 2.5)
      .map((c) => ({ pos: c.pos, radius: 2, label: 'Open chest', color: '#ffd27a', act: () => open(c) }));
  }
}

/** The chest model: body, and the lid on a hinge (`userData.lid`). Null if the file lacks it. */
function chestModel(art: typeof CHEST_ART.normal, file: string): THREE.Object3D | null {
  const body = worldNode(art.body, file);
  const lid = worldNode(art.lid, file);
  if (!body || !lid) return null;
  const g = new THREE.Group();
  g.name = `chest:${art.body}`;
  const hinge = new THREE.Group();
  hinge.position.set(...art.hinge);
  hinge.add(lid);
  g.add(body, hinge);
  g.userData.lid = hinge;
  return g;
}

/** The placeholder chest built from boxes (its lid on a hinge at the back of the body). */
function proceduralChest(): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'chest:procedural';
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.6), toonMaterial(0x7a4a26));
  body.position.y = 0.28;
  addOutline(body, 0.03);
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.55, -0.3);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.15, 0.64), toonMaterial(0xd9a83b, { emissive: 0x806010, emissiveIntensity: 0.4 }));
  lid.position.set(0, 0.07, 0.3);
  addOutline(lid, 0.03);
  hinge.add(lid);
  g.add(body, hinge);
  g.userData.lid = hinge;
  return g;
}
