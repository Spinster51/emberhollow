import * as THREE from 'three';
import { toonMaterial } from '../core/toon';
import { buildItemMesh } from '../items/ItemMesh';
import { CHEST_SIZE } from '../items/Inventory';
import { lookOf, type Item, type Look, type Slot } from '../items/items';
import type { Interactable } from '../loot/Loot';
import type { DisplaySpot, InventoryUI } from '../ui/InventoryUI';
import type { Box, World } from '../world/World';
import type { FixtureKind } from '../art/assets';
import { FURNITURE, buildFixture, buildFurniture } from './furniture';

interface Spot extends DisplaySpot {
  pos: THREE.Vector3;
  holder: THREE.Group;
  kind: 'mount' | 'stand' | 'table';
  backRoom: boolean;
}

export interface PlacedFurniture {
  type: string;
  x: number;
  z: number;
  rot: number;
  mesh?: THREE.Object3D;
}

/** Everything about the home that is saved (shared by all characters on the account). */
export interface HomeSave {
  owned: boolean;
  expanded: boolean;
  chest: (Item | null)[];
  displays: (Item | null)[];
  stock: Record<string, number>;
  placed: { type: string; x: number; z: number; rot: number }[];
}

export interface HomeHooks {
  book(): void;
  sleep(): void;
  furnish(): void;
  bench(): void;
  message(text: string): void;
}

interface Door {
  box: Box;
  mesh: THREE.Object3D;
}

/**
 * The home base (DESIGN §10): a house with the shared storage chest, weapon mounts, armour
 * stands, a trinket table, a bed, a training book and free furniture placement. On the main
 * map it is bought through the steward's quest; the back room opens with the "More Room" quest.
 */
export class Home {
  readonly group = new THREE.Group();
  /** 100-slot chest shared by all characters. */
  readonly chest: (Item | null)[] = new Array(CHEST_SIZE).fill(null);
  readonly spots: Spot[] = [];
  readonly chestPos: THREE.Vector3;
  readonly floorY: number;
  /** Door centre, outside the house. */
  readonly door: THREE.Vector3;
  readonly bookPos: THREE.Vector3;
  readonly bedPos: THREE.Vector3;
  readonly cratePos: THREE.Vector3;
  /** Workbench: salvage, upgrade and re-roll gear. */
  readonly benchPos: THREE.Vector3;
  owned: boolean;
  expanded = false;
  /** Bought furniture not yet placed, by type. */
  readonly stock: Record<string, number> = {};
  readonly placed: PlacedFurniture[] = [];
  /** The fixtures' models (model or procedural placeholder, see buildFixture), placed at their anchors. */
  readonly fixtures: { kind: FixtureKind; group: THREE.Group; backRoom: boolean }[] = [];
  /** The storage chest's collider (same box the chest always had). */
  readonly chestBox: Box;
  /** Inside bounds of the main room and the back room (for furniture and "inside" checks). */
  private main: { x0: number; x1: number; z0: number; z1: number };
  private back: { x0: number; x1: number; z0: number; z1: number };
  private frontDoor: Door | null = null;
  private backDoor: Door | null = null;
  private backRoomGroup = new THREE.Group();

  constructor(
    private world: World,
    private ui: InventoryUI,
    private hooks: HomeHooks,
  ) {
    this.owned = world.layout.homeOwned;
    const c = world.homeSite;
    // Main room 12 × 10 m (roomy enough for the camera indoors) plus a 12 × 7 m back room.
    const x0 = c.x - 6;
    const x1 = c.x + 6;
    const z0 = c.z - 5;
    const z1 = c.z + 5;
    const zb = z0 - 7;
    let hi = -Infinity;
    for (let x = x0; x <= x1; x += 0.5) for (let z = zb; z <= z1; z += 0.5) hi = Math.max(hi, world.heightAt(x, z));
    const fy = hi + 0.2;
    this.floorY = fy;
    const H = 3.2;
    const T = 0.3;
    this.main = { x0: x0 + T, x1: x1 - T, z0: z0 + T, z1: z1 - T };
    this.back = { x0: x0 + T, x1: x1 - T, z0: zb + T, z1: z0 };

    const plank = toonMaterial(0x9a6b42);
    const wall = toonMaterial(0xe6d6b8);
    const beam = toonMaterial(0x5b3a20);
    const roof = toonMaterial(0xa8432f);
    const doorMat = toonMaterial(0x6b4425);
    const solid = (minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number, m: THREE.Material) => {
      const box = { minX, maxX, minY, maxY, minZ, maxZ };
      return { box, mesh: world.addSolid(box, m) };
    };

    // Floor, walls (front door on the +z side), back room behind, roof.
    solid(x0, x1, fy - 1.5, fy, zb, z1, plank);
    solid(x0, x0 + T, fy, fy + H, zb, z1, wall); // left
    solid(x1 - T, x1, fy, fy + H, zb, z1, wall); // right
    solid(x0, x1, fy, fy + H, zb, zb + T, wall); // far back
    const doorL = c.x - 0.8;
    const doorR = c.x + 0.8;
    // Wall between the rooms, with a doorway (closed until the expansion).
    solid(x0, doorL, fy, fy + H, z0, z0 + T, wall);
    solid(doorR, x1, fy, fy + H, z0, z0 + T, wall);
    solid(doorL, doorR, fy + 2.3, fy + H, z0, z0 + T, wall);
    this.backDoor = solid(doorL, doorR, fy, fy + 2.3, z0 + 0.05, z0 + T - 0.05, doorMat);
    // Front wall with the entrance.
    solid(x0, doorL, fy, fy + H, z1 - T, z1, wall);
    solid(doorR, x1, fy, fy + H, z1 - T, z1, wall);
    solid(doorL, doorR, fy + 2.3, fy + H, z1 - T, z1, wall);
    if (!this.owned) this.frontDoor = solid(doorL, doorR, fy, fy + 2.3, z1 - T + 0.05, z1 - 0.05, doorMat);
    solid(x0 - 0.4, x1 + 0.4, fy + H, fy + H + 0.3, zb - 0.4, z1 + 0.4, roof);
    solid(x0 + 0.6, x1 - 0.6, fy + H + 0.3, fy + H + 0.8, zb + 0.4, z1 - 0.4, roof);
    this.door = new THREE.Vector3(c.x, world.heightAt(c.x, z1 + 1.5), z1 + 1.5);

    for (const [x, z] of [[x0, zb], [x1, zb], [x0, z1], [x1, z1], [doorL, z1], [doorR, z1]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.36, H, 0.36), beam);
      post.position.set(x + (x === x0 ? 0.15 : x === x1 ? -0.15 : 0), fy + H / 2, z + (z === zb ? 0.15 : -0.15));
      this.group.add(post);
    }
    const lamp = new THREE.PointLight(0xffc27a, 8, 10, 1.5);
    lamp.position.set(c.x, fy + 2.6, c.z);
    this.group.add(lamp);

    // Storage chest against the back-left of the main room (the collider is the box it always had).
    this.chestPos = new THREE.Vector3(x0 + 1.4, fy, z0 + 0.9);
    this.chestBox = { minX: this.chestPos.x - 0.55, maxX: this.chestPos.x + 0.55, minY: fy, maxY: fy + 0.7, minZ: this.chestPos.z - 0.35, maxZ: this.chestPos.z + 0.35 };
    world.addCollider(this.chestBox);
    this.addFixture('chest', this.chestPos);

    // Weapon mounts on the main room's back wall (either side of the doorway).
    [c.x - 3.6, c.x - 2.0, c.x + 2.4].forEach((x, i) => this.addMount(x, z0 + T, `Weapon mount ${i + 1}`, false));
    // Armour stands along the right wall.
    for (let i = 0; i < 2; i++) this.addStand(x1 - 1.0, c.z - 2 + i * 3, `Armour stand ${i + 1}`, false);

    // Trinket table by the door.
    const tx = x0 + 1.3;
    const tz = z1 - 1.4;
    this.addFixture('trinketTable', new THREE.Vector3(tx, fy, tz));
    this.addSpot('table', 'Trinket table', ['ring', 'amulet'], new THREE.Vector3(tx, fy, tz), new THREE.Vector3(tx, fy + 1.05, tz), false);

    // Training book on a lectern by the left wall.
    this.bookPos = new THREE.Vector3(x0 + 1.0, fy, c.z + 0.5);
    this.addFixture('lectern', this.bookPos);

    // Bed in the front-right corner.
    this.bedPos = new THREE.Vector3(x1 - 1.3, fy, z1 - 1.6);
    this.addFixture('bed', this.bedPos);

    // Furniture crate by the entrance: open it to place furniture you bought.
    this.cratePos = new THREE.Vector3(c.x + 1.6, fy, z1 - 1.0);
    this.addFixture('crate', this.cratePos);

    // Workbench by the front wall: an anvil on a bench with a warm glow (salvage, upgrade, re-roll).
    this.benchPos = new THREE.Vector3(c.x - 2.2, fy, z1 - 1.2);
    this.addFixture('workbench', this.benchPos);

    // Back room: more mounts and stands (hidden behind its door until the expansion).
    this.group.add(this.backRoomGroup);
    [c.x - 3.8, c.x, c.x + 3.8].forEach((x, i) => this.addMount(x, zb + T, `Back room mount ${i + 1}`, true));
    this.addStand(x0 + 1.2, zb + 3.5, 'Back room stand 1', true);
    this.addStand(x1 - 1.2, zb + 3.5, 'Back room stand 2', true);
  }

  /** A fixture's model (or its procedural placeholder until the furniture file loads) at its anchor. */
  private addFixture(kind: FixtureKind, at: THREE.Vector3, backRoom = false): void {
    const group = buildFixture(kind);
    group.position.copy(at);
    (backRoom ? this.backRoomGroup : this.group).add(group);
    this.fixtures.push({ kind, group, backRoom });
  }

  private addMount(x: number, wallZ: number, name: string, back: boolean): void {
    const fy = this.floorY;
    this.addFixture('mount', new THREE.Vector3(x, fy, wallZ), back);
    this.addSpot('mount', name, ['weapon', 'offhand'], new THREE.Vector3(x, fy, wallZ + 0.05), new THREE.Vector3(x, fy + 1.9, wallZ + 0.2), back);
  }

  private addStand(x: number, z: number, name: string, back: boolean): void {
    const fy = this.floorY;
    this.addFixture('stand', new THREE.Vector3(x, fy, z), back);
    this.addSpot('stand', name, ['helmet', 'chest', 'gloves', 'boots'], new THREE.Vector3(x, fy, z), new THREE.Vector3(x, fy, z), back);
  }

  private addSpot(kind: Spot['kind'], name: string, accepts: Slot[], pos: THREE.Vector3, at: THREE.Vector3, backRoom: boolean): void {
    const holder = new THREE.Group();
    holder.position.copy(at);
    (backRoom ? this.backRoomGroup : this.group).add(holder);
    const spot: Spot = { kind, name, accepts, pos, holder, item: null, backRoom, onChange: () => this.showSpot(spot) };
    this.spots.push(spot);
  }

  /**
   * Put the displayed item's model on its mount / stand / table. Item fronts face -Z: shields and tomes
   * turn to face out from the wall, and stands turn their piece to face the middle of its room.
   */
  private showSpot(s: Spot): void {
    s.holder.clear();
    if (!s.item) return;
    const m = buildItemMesh(s.item);
    const look = lookOf(s.item);
    if (s.kind === 'mount') {
      if (look !== 'woodShield' && look !== 'ironShield' && look !== 'tome') {
        m.rotation.set(Math.PI / 2, 0, 0.6);
        m.position.y = -0.55;
      } else m.rotation.y = Math.PI;
    } else if (s.kind === 'stand') {
      const height: Partial<Record<Look, number>> = { cap: 1.75, helm: 1.75, tunic: 1.3, mail: 1.3, gloves: 1.0, gauntlets: 1.0, boots: 0.18, greaves: 0.18 };
      m.position.y = height[look] ?? 1.3;
      m.rotation.y = Math.atan2(-(this.world.homeSite.x - s.pos.x), 0);
    } else {
      m.rotation.y = 0.5;
    }
    s.holder.add(m);
  }

  // ---------------------------------------------------------------- ownership

  /** Hand over the key: open the front door. */
  unlock(): void {
    this.owned = true;
    if (this.frontDoor) {
      this.world.removeSolid(this.frontDoor.box, this.frontDoor.mesh);
      this.frontDoor = null;
    }
  }

  /** Open the back room. */
  expand(): void {
    this.expanded = true;
    if (this.backDoor) {
      this.world.removeSolid(this.backDoor.box, this.backDoor.mesh);
      this.backDoor = null;
    }
  }

  /** Is a point inside the usable rooms? */
  inside(x: number, z: number, margin = 0): boolean {
    const r = (b: { x0: number; x1: number; z0: number; z1: number }) =>
      x > b.x0 + margin && x < b.x1 - margin && z > b.z0 + margin && z < b.z1 - margin;
    return r(this.main) || (this.expanded && r(this.back));
  }

  // ---------------------------------------------------------------- furniture

  buy(type: string): void {
    this.stock[type] = (this.stock[type] ?? 0) + 1;
  }

  /** Place a stocked piece; returns false if it doesn't fit there. */
  place(type: string, x: number, z: number, rot: number): boolean {
    if ((this.stock[type] ?? 0) < 1 || !this.inside(x, z, 0.4)) return false;
    this.stock[type]--;
    this.addPlaced({ type, x, z, rot });
    return true;
  }

  private addPlaced(p: PlacedFurniture): void {
    const mesh = buildFurniture(p.type);
    mesh.position.set(p.x, this.floorY, p.z);
    mesh.rotation.y = p.rot;
    this.group.add(mesh);
    this.placed.push({ ...p, mesh });
  }

  pickUp(p: PlacedFurniture): void {
    const i = this.placed.indexOf(p);
    if (i < 0) return;
    this.placed.splice(i, 1);
    if (p.mesh) this.group.remove(p.mesh);
    this.stock[p.type] = (this.stock[p.type] ?? 0) + 1;
  }

  // ---------------------------------------------------------------- interaction

  /** The chest, displays, bed, book and furniture the player is close to. */
  interactables(playerPos: THREE.Vector3): Interactable[] {
    const out: Interactable[] = [];
    if (Math.abs(playerPos.y - this.floorY) > 2.5) return out;
    if (!this.owned) {
      out.push({
        pos: this.door,
        radius: 2.2,
        label: 'Locked house — ask Steward Ilsa',
        color: '#c8b89a',
        act: () => this.hooks.message('The door is locked. Steward Ilsa in the square is selling this house.'),
      });
      return out;
    }
    out.push({ pos: this.chestPos, radius: 1.8, label: 'Open storage chest', color: '#ffd27a', act: () => this.ui.openChest(this.chest) });
    out.push({ pos: this.bookPos, radius: 1.6, label: 'Training book (skills and respec)', color: '#8ab4ff', act: () => this.hooks.book() });
    out.push({ pos: this.bedPos, radius: 1.8, label: 'Sleep (heal, set respawn, save)', color: '#9fd8ff', act: () => this.hooks.sleep() });
    out.push({ pos: this.cratePos, radius: 1.5, label: 'Furniture crate (place furniture)', color: '#e0c08a', act: () => this.hooks.furnish() });
    out.push({ pos: this.benchPos, radius: 1.6, label: 'Workbench (salvage, upgrade, re-roll)', color: '#ffb060', act: () => this.hooks.bench() });
    for (const s of this.spots) {
      if (s.backRoom && !this.expanded) continue;
      out.push({
        pos: s.pos,
        radius: 1.5,
        label: s.item ? `${s.name}: ${s.item.name}` : `${s.name} (empty)`,
        act: () => this.ui.openRack(s),
      });
    }
    for (const p of this.placed) {
      out.push({
        pos: new THREE.Vector3(p.x, this.floorY, p.z),
        radius: 1.3,
        label: `Pick up ${FURNITURE[p.type]?.name ?? p.type}`,
        color: '#c8b89a',
        act: () => this.pickUp(p),
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- saving

  save(): HomeSave {
    return {
      owned: this.owned,
      expanded: this.expanded,
      chest: [...this.chest],
      displays: this.spots.map((s) => s.item),
      stock: { ...this.stock },
      placed: this.placed.map(({ type, x, z, rot }) => ({ type, x, z, rot })),
    };
  }

  load(d: HomeSave): void {
    if (d.owned && !this.owned) this.unlock();
    if (d.expanded && !this.expanded) this.expand();
    this.chest.fill(null);
    (d.chest ?? []).forEach((it, i) => i < this.chest.length && (this.chest[i] = it));
    this.spots.forEach((s, i) => {
      s.item = d.displays?.[i] ?? null;
      this.showSpot(s);
    });
    for (const k of Object.keys(this.stock)) delete this.stock[k];
    Object.assign(this.stock, d.stock ?? {});
    for (const p of [...this.placed]) if (p.mesh) this.group.remove(p.mesh);
    this.placed.length = 0;
    for (const p of d.placed ?? []) this.addPlaced(p);
  }
}
