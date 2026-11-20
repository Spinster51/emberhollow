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
import { WORLD_FILE } from '../art/assets';
import { KitBuilder, fill, onSide, roofOn, sides, strip, trs } from '../world/kit';
import { loadWorldFile } from '../world/worldModels';

/** What each collider of the house shell is, for its model. */
type ShellRole = 'floor' | 'wall' | 'lintel' | 'doorFront' | 'doorBack' | 'eave' | 'roof';

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
  /** The shell's colliders and their box meshes (hidden once the shell model is in), and the procedural posts. */
  private shell: { box: Box; mesh: THREE.Mesh; role: ShellRole }[] = [];
  private posts: THREE.Mesh[] = [];
  /** The shell's model (milestone 8): walls and floor, roof, and the two doors (null once opened). */
  readonly shellModel: { body: THREE.Group | null; roof: THREE.Group | null; doorFront: THREE.Group | null; doorBack: THREE.Group | null } = {
    body: null, roof: null, doorFront: null, doorBack: null,
  };
  private shellOutlines: THREE.Object3D[] = [];
  private shellOutlineOn = true;

  constructor(
    private world: World,
    private ui: InventoryUI,
    private hooks: HomeHooks,
    file = WORLD_FILE,
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
    const solid = (minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number, m: THREE.Material, role: ShellRole = 'wall') => {
      const box = { minX, maxX, minY, maxY, minZ, maxZ };
      const part = { box, mesh: world.addSolid(box, m), role };
      this.shell.push(part);
      return part;
    };

    // Floor, walls (front door on the +z side), back room behind, roof.
    solid(x0, x1, fy - 1.5, fy, zb, z1, plank, 'floor');
    solid(x0, x0 + T, fy, fy + H, zb, z1, wall); // left
    solid(x1 - T, x1, fy, fy + H, zb, z1, wall); // right
    solid(x0, x1, fy, fy + H, zb, zb + T, wall); // far back
    const doorL = c.x - 0.8;
    const doorR = c.x + 0.8;
    // Wall between the rooms, with a doorway (closed until the expansion).
    solid(x0, doorL, fy, fy + H, z0, z0 + T, wall);
    solid(doorR, x1, fy, fy + H, z0, z0 + T, wall);
    solid(doorL, doorR, fy + 2.3, fy + H, z0, z0 + T, wall, 'lintel');
    this.backDoor = solid(doorL, doorR, fy, fy + 2.3, z0 + 0.05, z0 + T - 0.05, doorMat, 'doorBack');
    // Front wall with the entrance.
    solid(x0, doorL, fy, fy + H, z1 - T, z1, wall);
    solid(doorR, x1, fy, fy + H, z1 - T, z1, wall);
    solid(doorL, doorR, fy + 2.3, fy + H, z1 - T, z1, wall, 'lintel');
    if (!this.owned) this.frontDoor = solid(doorL, doorR, fy, fy + 2.3, z1 - T + 0.05, z1 - 0.05, doorMat, 'doorFront');
    solid(x0 - 0.4, x1 + 0.4, fy + H, fy + H + 0.3, zb - 0.4, z1 + 0.4, roof, 'eave');
    solid(x0 + 0.6, x1 - 0.6, fy + H + 0.3, fy + H + 0.8, zb + 0.4, z1 - 0.4, roof, 'roof');
    this.door = new THREE.Vector3(c.x, world.heightAt(c.x, z1 + 1.5), z1 + 1.5);

    for (const [x, z] of [[x0, zb], [x1, zb], [x0, z1], [x1, z1], [doorL, z1], [doorR, z1]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.36, H, 0.36), beam);
      post.position.set(x + (x === x0 ? 0.15 : x === x1 ? -0.15 : 0), fy + H / 2, z + (z === zb ? 0.15 : -0.15));
      this.group.add(post);
      this.posts.push(post);
    }
    // The shell's model replaces these boxes when the world file loads (they stay if it fails).
    loadWorldFile(file).then(() => this.buildShell(file, { x0, x1, z0, z1, zb, fy, H, T, doorL, doorR }), () => {});
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
    this.shellModel.doorFront?.removeFromParent();
    this.shellModel.doorFront = null;
  }

  /** Open the back room. */
  expand(): void {
    this.expanded = true;
    if (this.backDoor) {
      this.world.removeSolid(this.backDoor.box, this.backDoor.mesh);
      this.backDoor = null;
    }
    this.shellModel.doorBack?.removeFromParent();
    this.shellModel.doorBack = null;
  }

  // ---------------------------------------------------------------- the shell's model (milestone 8)

  /**
   * Build the house from the world file's kit, fitted to the same colliders: stone footing and plank floor,
   * plaster walls with timber posts and beams, windows inside and out, the doors, and the roof. The boxes
   * are hidden, never removed (they are the colliders' look only). Keeps the boxes if a piece is missing.
   */
  private buildShell(file: string, f: { x0: number; x1: number; z0: number; z1: number; zb: number; fy: number; H: number; T: number; doorL: number; doorR: number }): void {
    const { x0, x1, z0, z1, zb, fy, H, T, doorL, doorR } = f;
    const c = this.world.homeSite;
    const body = new KitBuilder(file);
    const roofK = new KitBuilder(file);
    const doors: Partial<Record<ShellRole, KitBuilder>> = {};
    const shut = (role: ShellRole) => (role === 'doorFront' ? !!this.frontDoor : !!this.backDoor);
    for (const p of this.shell) {
      const b = p.box;
      if (p.role === 'floor') {
        fill(body, 'KitStone', { ...b, maxY: b.maxY - 0.06 });
        fill(body, 'KitPlank', { ...b, minY: b.maxY - 0.06 });
      } else if (p.role === 'wall' || p.role === 'lintel') fill(body, 'KitPlaster', b);
      else if ((p.role === 'doorFront' || p.role === 'doorBack') && shut(p.role)) {
        const k = (doors[p.role] = new KitBuilder(file));
        k.add('KitDoorLeaf', trs((b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2, 0, (b.maxX - b.minX) / 1.6, (b.maxY - b.minY) / 2.3, (b.maxZ - b.minZ) / 0.2));
      }
    }
    const eave = this.shell.find((p) => p.role === 'eave')!.box;
    const roof = this.shell.find((p) => p.role === 'roof')!.box;
    roofOn(roofK, eave, roof);

    // Outside: footing, sill and top plate, panel posts, corner posts, the door frame and a lamp.
    const out = sides(x0, x1, zb, z1);
    out.forEach((s, i) => {
      const front = i === 0;
      const gapFrom = front ? doorL - x0 : 0;
      const gapTo = front ? doorR - x0 : 0;
      if (front) {
        strip(body, 'KitBase', s, fy - 0.45, 1, 0, gapFrom - 0.15);
        strip(body, 'KitBase', s, fy - 0.45, 1, gapTo + 0.15, s.len);
        onSide(body, 'KitBeam', s, gapFrom / 2, fy + 0.62, gapFrom - 0.13, 1, 1);
        onSide(body, 'KitBeam', s, (gapTo + s.len) / 2, fy + 0.62, s.len - gapTo - 0.13, 1, 1);
      } else {
        strip(body, 'KitBase', s, fy - 0.45, 1);
        onSide(body, 'KitBeam', s, s.len / 2, fy + 0.62, s.len, 1, 1);
      }
      onSide(body, 'KitBeam', s, s.len / 2, fy + H - 0.12, s.len, 1, 1);
      const panels = Math.max(2, Math.round(s.len / 3));
      for (let p = 1; p < panels; p++) {
        const t = (p * s.len) / panels;
        if (front && t > gapFrom - 0.5 && t < gapTo + 0.5) continue;
        onSide(body, 'KitPost', s, t, fy - 0.1, 1, H + 0.1, 1);
      }
    });
    for (const [x, z] of [[x0, zb], [x1, zb], [x0, z1], [x1, z1]]) body.add('KitPost', trs(x, fy - 0.45, z, 0, 1.15, H + 0.45, 1.15));
    // Door frames: the entrance outside, and both faces of the doorway between the rooms.
    for (const [z, yaw] of [[z1, 0], [z0 + T, 0], [z0, Math.PI]] as [number, number][]) {
      for (const x of [doorL, doorR]) body.add('KitPost', trs(x, fy, z, 0, 0.8, 2.42, 0.6));
      body.add('KitBeam', trs(c.x, fy + 2.4, z, yaw, doorR - doorL + 0.3, 1.2, 1));
    }
    body.add('KitLamp', trs(doorR + 0.75, fy + 2.5, z1, 0));
    // Windows outside and in, clear of the mounts, stands, bed and fixtures. `t` runs along the outer side.
    const inner = sides(x0 + T, x1 - T, zb + T, z1 - T);
    const win = (side: number, t: number, alsoInside = true) => {
      onSide(body, 'KitWindow', out[side], t, fy + 1.75, 0.8, 0.9, 1);
      if (!alsoInside) return;
      const s = out[side];
      const si = inner[side];
      // The same spot on the inner face, facing into the room.
      const x = s.x + s.dx * t - s.nx * T;
      const z = s.z + s.dz * t - s.nz * T;
      body.add('KitWindow', trs(x, fy + 1.75, z, si.yaw + Math.PI, 0.8, 0.9, 1));
    };
    win(0, 2.4); // front, left of the door (above the workbench)
    win(0, 9.6); // front, right of the door (above the bed)
    win(1, 5.5); // right side, between the armour stands
    win(1, 11.5); // right side, back room
    win(2, 4.1); // back wall of the back room, between mounts
    win(2, 7.9);
    win(3, 9.6, false); // left side, main room (the lectern and chest stand inside)
    win(3, 5.5); // left side, back room
    // Ceiling beams across both rooms.
    for (const z of [c.z - 2.5, c.z + 2.5, zb + 3.5]) body.add('KitBeam', trs(c.x, fy + H - 0.1, z - 0.07, 0, x1 - x0 - 2 * T, 1.1, 1.3));

    if ([body, roofK, ...Object.values(doors)].some((k) => k.missing.size > 0)) {
      console.warn('world models: the home shell lacks pieces; keeping the boxes');
      return;
    }
    this.shellModel.body = body.build('home:shell', { outline: 0.03 });
    this.shellModel.roof = roofK.build('home:roof', { outline: 0.03 });
    this.group.add(this.shellModel.body, this.shellModel.roof);
    for (const role of ['doorFront', 'doorBack'] as const) {
      const k = doors[role];
      if (!k) continue;
      const g = k.build(`home:${role}`, { outline: 0.03 });
      this.shellModel[role] = g;
      this.group.add(g);
    }
    this.shellOutlines.length = 0;
    for (const g of [this.shellModel.body, this.shellModel.roof, this.shellModel.doorFront, this.shellModel.doorBack]) {
      g?.traverse((o) => o.name.endsWith('_outline') && this.shellOutlines.push(o));
    }
    for (const p of this.shell) p.mesh.visible = false;
    for (const m of this.posts) m.visible = false;
  }

  /** Hide the home shell's outline past 65 m (or from a high overview camera). */
  updateOutlines(player: THREE.Vector3, camera?: THREE.Camera): void {
    if (!this.shellOutlines.length) return;
    const c = this.world.homeSite;
    const high = !!camera && camera.position.y - player.y > 40;
    const show = !high && (player.x - c.x) ** 2 + (player.z - c.z) ** 2 < 65 * 65;
    if (show === this.shellOutlineOn) return;
    this.shellOutlineOn = show;
    for (const o of this.shellOutlines) o.visible = show;
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
