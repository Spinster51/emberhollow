import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';
import { buildItemMesh } from '../items/ItemMesh';
import { CHEST_SIZE } from '../items/Inventory';
import { lookOf, type Item, type Look, type Slot } from '../items/items';
import type { Interactable } from '../loot/Loot';
import type { DisplaySpot, InventoryUI } from '../ui/InventoryUI';
import type { World } from '../world/World';

interface Spot extends DisplaySpot {
  pos: THREE.Vector3;
  holder: THREE.Group;
  kind: 'mount' | 'stand' | 'table';
}

/**
 * Milestone-3 test home base: a one-room house with the shared storage chest, three weapon
 * wall-mounts, two armour stands and a trinket table. Moves into town in milestone 5
 * (with the house quest, expansions, bed and furniture).
 */
export class Home {
  readonly group = new THREE.Group();
  /** 100-slot chest shared by all characters (saved with the account from M5). */
  readonly chest: (Item | null)[] = new Array(CHEST_SIZE).fill(null);
  readonly spots: Spot[] = [];
  readonly chestPos: THREE.Vector3;
  readonly floorY: number;
  /** Door centre, outside the house. */
  readonly door: THREE.Vector3;

  constructor(
    world: World,
    private ui: InventoryUI,
  ) {
    const c = world.homeSite;
    // 12 × 10 m: roomy enough for the camera to stay behind the player indoors.
    const x0 = c.x - 6;
    const x1 = c.x + 6;
    const z0 = c.z - 5;
    const z1 = c.z + 5;
    let hi = -Infinity;
    for (let x = x0; x <= x1; x += 0.5) for (let z = z0; z <= z1; z += 0.5) hi = Math.max(hi, world.heightAt(x, z));
    const fy = hi + 0.2;
    this.floorY = fy;
    const H = 3.2;
    const T = 0.3;

    const plank = toonMaterial(0x9a6b42);
    const wall = toonMaterial(0xe6d6b8);
    const beam = toonMaterial(0x5b3a20);
    const roof = toonMaterial(0xa8432f);
    const solid = (minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number, m: THREE.Material) =>
      world.addSolid({ minX, maxX, minY, maxY, minZ, maxZ }, m);

    // Floor, walls (door in the front, +z side), roof.
    solid(x0, x1, fy - 1.5, fy, z0, z1, plank);
    solid(x0, x1, fy, fy + H, z0, z0 + T, wall); // back
    solid(x0, x0 + T, fy, fy + H, z0, z1, wall); // left
    solid(x1 - T, x1, fy, fy + H, z0, z1, wall); // right
    const doorL = c.x - 0.8;
    const doorR = c.x + 0.8;
    solid(x0, doorL, fy, fy + H, z1 - T, z1, wall);
    solid(doorR, x1, fy, fy + H, z1 - T, z1, wall);
    solid(doorL, doorR, fy + 2.3, fy + H, z1 - T, z1, wall); // lintel
    solid(x0 - 0.4, x1 + 0.4, fy + H, fy + H + 0.3, z0 - 0.4, z1 + 0.4, roof);
    solid(x0 + 0.6, x1 - 0.6, fy + H + 0.3, fy + H + 0.8, z0 + 0.4, z1 - 0.4, roof);
    this.door = new THREE.Vector3(c.x, world.heightAt(c.x, z1 + 1.5), z1 + 1.5);

    // Timber frame on the corners (decoration only).
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [doorL, z1], [doorR, z1]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.36, H, 0.36), beam);
      post.position.set(x + (x === x0 ? 0.15 : x === x1 ? -0.15 : 0), fy + H / 2, z + (z === z0 ? 0.15 : -0.15));
      this.group.add(post);
    }
    // Warm light inside.
    const lamp = new THREE.PointLight(0xffc27a, 8, 10, 1.5);
    lamp.position.set(c.x, fy + 2.6, c.z);
    this.group.add(lamp);

    // Storage chest against the back-left.
    this.chestPos = new THREE.Vector3(x0 + 1.4, fy, z0 + 0.9);
    solid(this.chestPos.x - 0.55, this.chestPos.x + 0.55, fy, fy + 0.7, this.chestPos.z - 0.35, this.chestPos.z + 0.35, toonMaterial(0x7a4a26));
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.12, 0.76), toonMaterial(0xc9a13b));
    lid.position.set(this.chestPos.x, fy + 0.72, this.chestPos.z);
    addOutline(lid, 0.03);
    this.group.add(lid);

    // Weapon mounts on the back wall.
    for (let i = 0; i < 3; i++) {
      const x = c.x - 1.9 + i * 1.9;
      const pos = new THREE.Vector3(x, fy, z0 + T + 0.05);
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.08), beam);
      board.position.set(x, fy + 1.9, z0 + T + 0.04);
      this.group.add(board);
      this.addSpot('mount', `Weapon mount ${i + 1}`, ['weapon', 'offhand'], pos, new THREE.Vector3(x, fy + 1.9, z0 + T + 0.2));
    }

    // Armour stands along the right wall.
    for (let i = 0; i < 2; i++) {
      const z = c.z - 2 + i * 3;
      const x = x1 - 1.0;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 6), beam);
      pole.position.set(x, fy + 0.85, z);
      const arms = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.8), beam);
      arms.position.set(x, fy + 1.35, z);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.6), beam);
      foot.position.set(x, fy + 0.04, z);
      this.group.add(pole, arms, foot);
      this.addSpot('stand', `Armour stand ${i + 1}`, ['helmet', 'chest', 'gloves', 'boots'], new THREE.Vector3(x, fy, z), new THREE.Vector3(x, fy, z));
    }

    // Trinket table by the door for rings and amulets.
    const tx = x0 + 1.3;
    const tz = z1 - 1.4;
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.7), plank);
    top.position.set(tx, fy + 0.8, tz);
    addOutline(top, 0.03);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), beam);
    leg.position.set(tx, fy + 0.4, tz);
    this.group.add(top, leg);
    this.addSpot('table', 'Trinket table', ['ring', 'amulet'], new THREE.Vector3(tx, fy, tz), new THREE.Vector3(tx, fy + 1.05, tz));
  }

  private addSpot(kind: Spot['kind'], name: string, accepts: Slot[], pos: THREE.Vector3, at: THREE.Vector3): void {
    const holder = new THREE.Group();
    holder.position.copy(at);
    this.group.add(holder);
    const spot: Spot = {
      kind, name, accepts, pos, holder, item: null,
      onChange: () => this.showSpot(spot),
    };
    this.spots.push(spot);
  }

  /** Put the displayed item's model on its mount / stand / table. */
  private showSpot(s: Spot): void {
    s.holder.clear();
    if (!s.item) return;
    const m = buildItemMesh(s.item);
    const look = lookOf(s.item);
    if (s.kind === 'mount') {
      // Shields hang flat on the wall; weapons hang tilted, blade up.
      if (look !== 'woodShield' && look !== 'ironShield') {
        m.rotation.set(Math.PI / 2, 0, 0.6);
        m.position.y = -0.55;
      }
    } else if (s.kind === 'stand') {
      // Each piece sits where it would be worn.
      const height: Partial<Record<Look, number>> = { cap: 1.75, helm: 1.75, tunic: 1.3, mail: 1.3, gloves: 1.0, gauntlets: 1.0, boots: 0.18, greaves: 0.18 };
      m.position.y = height[look] ?? 1.3;
    } else {
      m.rotation.y = 0.5;
    }
    s.holder.add(m);
  }

  /** The chest and display spots the player is close to. */
  interactables(playerPos: THREE.Vector3): Interactable[] {
    const out: Interactable[] = [];
    if (Math.abs(playerPos.y - this.floorY) > 2.5) return out;
    out.push({
      pos: this.chestPos,
      radius: 1.8,
      label: 'Open storage chest',
      color: '#ffd27a',
      act: () => this.ui.openChest(this.chest),
    });
    for (const s of this.spots) {
      out.push({
        pos: s.pos,
        radius: 1.5,
        label: s.item ? `${s.name}: ${s.item.name}` : `${s.name} (empty)`,
        act: () => this.ui.openRack(s),
      });
    }
    return out;
  }
}
