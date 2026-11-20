import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';
import { inArc } from '../combat/combat';
import { CHEST_ART, DUNGEON_FILE, WORLD_FILE } from '../art/assets';
import { KitBuilder, hash2, trs } from './kit';
import { loadDungeonFile, loadWorldFile, pieceMeshes, worldNode, worldReady } from './worldModels';
import type { Box, World } from './World';
import type { Interactable } from '../loot/Loot';
import type { Enemies } from '../combat/Enemies';
import type { Enemy } from '../combat/Enemy';
import type { EnemyKind } from '../config';

/**
 * The Ember Vault (DESIGN §7 Dungeon): a separate interior, built high above the north-west corner
 * of the map so nothing outside can see or reach it. You enter through the sealed gate in the
 * ruins once the "Sealed Door" quest is done.
 *
 * Rooms, south to north:
 *   A Entry hall (way out)  →  B Plate room: push the stone block onto the pressure plate
 *   →  C Crystal room: strike the crystal behind the railing (melee or projectile) to open the
 *      east door; D (east) holds the small key  →  C's north door is locked (key)
 *   →  E Long hall: pull the lever, then sprint before the far gate shuts (timed)
 *   →  F Brazier (heal + respawn point)  →  G Arena: the Cinder Warden (2 phases).
 * Puzzle progress, keys and the brazier are per character and saved.
 */

export const VAULT = { ox: -230, oz: -125, y: 300 };
const WALL_H = 7;

/** Local (room-plan) coordinates → world. */
const W = (x: number, z: number) => new THREE.Vector3(VAULT.ox + x, VAULT.y, VAULT.oz + z);

type Side = 'n' | 's' | 'e' | 'w';
interface RoomSpec {
  id: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  open: { side: Side; at: number; w: number }[];
}

const ROOMS: RoomSpec[] = [
  { id: 'A', x0: -8, x1: 8, z0: -14, z1: 0, open: [{ side: 'n', at: 0, w: 4 }] },
  { id: 'B', x0: -10, x1: 10, z0: -36, z1: -16, open: [{ side: 's', at: 0, w: 4 }, { side: 'n', at: 0, w: 4 }] },
  { id: 'C', x0: -12, x1: 12, z0: -62, z1: -38, open: [{ side: 's', at: 0, w: 4 }, { side: 'n', at: 0, w: 4 }, { side: 'e', at: -50, w: 4 }] },
  { id: 'D', x0: 14, x1: 28, z0: -58, z1: -42, open: [{ side: 'w', at: -50, w: 4 }] },
  { id: 'E', x0: -3, x1: 3, z0: -110, z1: -64, open: [{ side: 's', at: 0, w: 4 }, { side: 'n', at: 0, w: 4 }] },
  { id: 'F', x0: -8, x1: 8, z0: -126, z1: -112, open: [{ side: 's', at: 0, w: 4 }, { side: 'n', at: 0, w: 6 }] },
  { id: 'G', x0: -16, x1: 16, z0: -162, z1: -128, open: [{ side: 's', at: 0, w: 6 }] },
];

const ROOM_LINKS: Record<string, { id: string; door?: string }[]> = {
  A: [{ id: 'B' }],
  B: [{ id: 'A' }, { id: 'C', door: 'plateDoor' }],
  C: [{ id: 'B', door: 'plateDoor' }, { id: 'D', door: 'crystalDoor' }, { id: 'E', door: 'lockDoor' }],
  D: [{ id: 'C', door: 'crystalDoor' }],
  E: [{ id: 'C', door: 'lockDoor' }, { id: 'F', door: 'timedDoor' }],
  F: [{ id: 'E', door: 'timedDoor' }, { id: 'G' }],
  G: [{ id: 'F' }],
};

/** Doorway floor thresholds between rooms (local coordinates, attributed to south/west room). */
const THRESHOLDS: { room: string; x0: number; x1: number; z0: number; z1: number }[] = [
  { room: 'A', x0: -2, x1: 2, z0: -16, z1: -14 },
  { room: 'B', x0: -2, x1: 2, z0: -38, z1: -36 },
  { room: 'C', x0: 12, x1: 14, z0: -52, z1: -48 },
  { room: 'C', x0: -2, x1: 2, z0: -64, z1: -62 },
  { room: 'E', x0: -2, x1: 2, z0: -112, z1: -110 },
  { room: 'F', x0: -3, x1: 3, z0: -128, z1: -126 },
];

/** Where things are, in local coordinates. */
export const SPOTS = {
  entry: [0, -6],
  exitA: [0, -2],
  block: [-6, -28],
  plate: [0, -28],
  reset: [-8, -18],
  crystal: [-11, -50],
  keyChest: [25, -54],
  lever: [2, -67],
  brazier: [0, -119],
  boss: [0, -146],
  exitG: [0, -158],
  /** Door gaps: [x, z, width, along x?] */
  plateDoor: [0, -37],
  crystalDoor: [13, -50],
  lockDoor: [0, -63],
  timedDoor: [0, -111],
} as const;

const ENEMIES: [EnemyKind, number, number, number][] = [
  ['skeleton', -5, -24, 14],
  ['skeleton', 5, -30, 14],
  ['skeleton', -6, -44, 15],
  ['skeleton', 6, -46, 15],
  ['cultist', 0, -58, 15],
  ['golem', 21, -50, 15],
];

/** Seconds the timed gate stays open (a sprint makes it; a walk does not). */
export const TIMED_OPEN = 7.5;
const STEP = 2;

export interface DungeonSave {
  solved: string[];
  keys: number;
  /** Respawn at the brazier. */
  brazier: boolean;
}

interface Door {
  id: string;
  box: Box;
  mesh: THREE.Group;
  open: boolean;
  /** 0 = shut, 1 = sunk into the floor. */
  anim: number;
}

interface RoomNode {
  spec: RoomSpec;
  group: THREE.Group;
  ceiling: THREE.Group;
}

interface DressSlot {
  file: string;
  node: string;
  room: string;
  matrix: THREE.Matrix4;
}

interface DressBatch {
  items: DressSlot[];
  meshes: THREE.InstancedMesh[];
}

export interface DungeonHooks {
  message(t: string): void;
  /** Heal fully (brazier). */
  heal(): void;
  setRespawn(at: THREE.Vector3): void;
  leave(): void;
  gold(n: number, at: THREE.Vector3): void;
}

const DOOR_MODELS: Record<string, string> = {
  plateDoor: 'DoorPlate',
  crystalDoor: 'DoorCrystal',
  lockDoor: 'DoorLock',
  timedDoor: 'DoorTimed',
};

const DOOR_ROOMS: Record<string, [string, string]> = {
  plateDoor: ['B', 'C'],
  crystalDoor: ['C', 'E'],
  lockDoor: ['D', 'E'],
  timedDoor: ['E', 'F'],
};

export class Dungeon {
  readonly group = new THREE.Group();
  readonly solved = new Set<string>();
  keys = 0;
  brazierLit = false;
  readonly doors = new Map<string, Door>();
  readonly block: { box: Box; mesh: THREE.Group; home: THREE.Vector3; anim: THREE.Vector3 | null };
  readonly boss: Enemy;
  readonly enemies: Enemy[] = [];
  /** Seconds the timed gate has left. */
  timer = 0;
  /** Wall / floor boxes (map drawing). */
  readonly walls: Box[] = [];
  /** True once the dungeon models replaced the placeholder boxes. */
  modelsReady = false;
  /** Resolves when the dungeon file has loaded and been applied (or failed). */
  readonly loaded: Promise<boolean>;

  private plateMesh: THREE.Group;
  private platePad: THREE.Object3D;
  private plateGlowMat: THREE.MeshToonMaterial | null = null;
  private crystal: THREE.Group;
  private crystalMat: THREE.MeshBasicMaterial;
  private crystalModelMat: THREE.MeshToonMaterial | null = null;
  private crystalPedestal: THREE.Group;
  private resetGroup: THREE.Group;
  private leverGroup: THREE.Group;
  private lever: THREE.Group;
  private keyChestGroup: THREE.Group;
  private keyChestLid: THREE.Object3D;
  private brazierGroup: THREE.Group;
  private brazierFlame: THREE.Object3D;
  private brazierEmberMat: THREE.MeshToonMaterial | null = null;
  private exitAGroup: THREE.Group;
  private exitGGroup: THREE.Group;
  private exitGGlowMat: THREE.MeshToonMaterial | null = null;
  private exitGMidMat: THREE.MeshToonMaterial | null = null;
  private exitGCoreMat: THREE.MeshToonMaterial | null = null;
  private fallbackTorches: THREE.Group;
  private fallbackSolids: THREE.Mesh[] = [];
  private rooms = new Map<string, RoomNode>();
  private dressBatches: DressBatch[] = [];
  private brazierLight: THREE.PointLight;
  private ceilingsVisible = true;
  private lastVisKey = '';
  private countdown: HTMLDivElement;
  readonly bounds = { minX: VAULT.ox - 18, maxX: VAULT.ox + 30, minZ: VAULT.oz - 164, maxZ: VAULT.oz + 2 };

  constructor(
    private world: World,
    enemies: Enemies,
    hudRoot: HTMLElement,
    private hooks: DungeonHooks,
    readonly file = DUNGEON_FILE,
    readonly worldFile = WORLD_FILE,
  ) {
    this.group.name = 'dungeon';
    const stone = toonMaterial(0x4a433d);
    const floor = toonMaterial(0x35302b);
    const trim = toonMaterial(0x2a2521);
    // One floor slab under everything.
    const b = this.bounds;
    this.solid({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, minY: VAULT.y - 2, maxY: VAULT.y }, floor);
    for (const r of ROOMS) this.buildRoom(r, stone);

    // Procedural torches along the walls (fallback until models load).
    this.fallbackTorches = new THREE.Group();
    this.fallbackTorches.name = 'dungeon:fallbackTorches';
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
    for (const r of ROOMS) {
      for (const [x, z] of [[r.x0 + 0.3, (r.z0 + r.z1) / 2], [r.x1 - 0.3, (r.z0 + r.z1) / 2]]) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 0.25), trim);
        t.position.copy(W(x, z)).setY(VAULT.y + 3);
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.2), flameMat);
        f.position.copy(t.position).setY(VAULT.y + 3.4);
        this.fallbackTorches.add(t, f);
      }
    }
    this.group.add(this.fallbackTorches);

    // Doors.
    this.addDoor('plateDoor', 0x4a6a9a, false);
    this.addDoor('crystalDoor', 0x7a4a9a, false);
    this.addDoor('lockDoor', 0xa07a3a, false);
    this.addDoor('timedDoor', 0x6a6a72, false);

    // Push block and pressure plate.
    const home = W(SPOTS.block[0], SPOTS.block[1]);
    const blockGroup = new THREE.Group();
    blockGroup.name = 'dungeon:block';
    const bm = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.6, 1.8), toonMaterial(0x7d7468));
    addOutline(bm, 0.03);
    bm.castShadow = true;
    blockGroup.add(bm);
    const bbox: Box = { minX: 0, maxX: 0, minY: VAULT.y, maxY: VAULT.y + 1.6, minZ: 0, maxZ: 0, noClimb: true, zone: 'dungeon' };
    this.block = { box: bbox, mesh: blockGroup, home, anim: null };
    this.group.add(blockGroup);
    this.placeBlock(home);
    this.world.addCollider(bbox);

    this.plateMesh = new THREE.Group();
    this.plateMesh.name = 'dungeon:plate';
    this.plateMesh.position.copy(W(SPOTS.plate[0], SPOTS.plate[1]));
    const platePad = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 2), toonMaterial(0x6a8ab0));
    platePad.position.y = 0.06;
    this.platePad = platePad;
    this.plateMesh.add(platePad);

    this.resetGroup = new THREE.Group();
    this.resetGroup.name = 'dungeon:reset';
    this.resetGroup.position.copy(W(SPOTS.reset[0], SPOTS.reset[1]));
    const rune = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), toonMaterial(0x5a7aa0, { emissive: 0x203860, emissiveIntensity: 0.6 }));
    rune.position.y = 0.25;
    this.resetGroup.add(rune);
    this.group.add(this.plateMesh, this.resetGroup);

    // The crystal behind its railing (west wall of C).
    const rail = (minX: number, maxX: number, minZ: number, maxZ: number) =>
      this.solid({ minX: VAULT.ox + minX, maxX: VAULT.ox + maxX, minZ: VAULT.oz + minZ, maxZ: VAULT.oz + maxZ, minY: VAULT.y, maxY: VAULT.y + 1.6 }, trim);
    rail(-10, -9.5, -52, -48);
    rail(-12, -9.5, -52.5, -52);
    rail(-12, -9.5, -48, -47.5);
    this.crystalMat = new THREE.MeshBasicMaterial({ color: 0xe04a4a });
    this.crystal = new THREE.Group();
    this.crystal.name = 'dungeon:crystal';
    this.crystal.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.5), this.crystalMat));
    this.crystal.position.copy(this.crystalPos());
    this.crystalPedestal = new THREE.Group();
    this.crystalPedestal.position.copy(this.crystalPos()).setY(VAULT.y);
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.5), trim);
    pillar.position.y = 0.8;
    this.crystalPedestal.add(pillar);
    this.group.add(this.crystal, this.crystalPedestal);

    // Key chest (room D).
    this.keyChestGroup = new THREE.Group();
    this.keyChestGroup.name = 'dungeon:keyChest';
    this.keyChestGroup.position.copy(W(SPOTS.keyChest[0], SPOTS.keyChest[1]));
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.6), toonMaterial(0x5a3a26));
    body.position.y = 0.28;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.15, 0.64), toonMaterial(0x8aa0b0));
    lid.position.y = 0.62;
    this.keyChestLid = lid;
    this.keyChestGroup.add(body, lid);
    this.group.add(this.keyChestGroup);

    // Lever (hall E).
    const lv = new THREE.Group();
    lv.name = 'dungeon:lever';
    this.leverGroup = lv;
    lv.position.copy(W(SPOTS.lever[0], SPOTS.lever[1]));
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), trim);
    base.position.y = 0.2;
    const leverArm = new THREE.Group();
    leverArm.position.y = 0.4;
    const leverStick = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), toonMaterial(0xc0a060));
    leverStick.position.y = 0.55;
    leverArm.add(leverStick);
    leverArm.rotation.x = 0.6;
    this.lever = leverArm;
    lv.add(base, leverArm);
    this.group.add(lv);

    // Brazier (room F).
    this.brazierGroup = new THREE.Group();
    this.brazierGroup.name = 'dungeon:brazier';
    this.brazierGroup.position.copy(W(SPOTS.brazier[0], SPOTS.brazier[1]));
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.4, 0.9, 8), trim);
    bowl.position.y = 0.45;
    const bf = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 6), new THREE.MeshBasicMaterial({ color: 0xff7a2a }));
    bf.position.y = 1.4;
    this.brazierFlame = bf;
    this.brazierGroup.add(bowl, bf);
    this.group.add(this.brazierGroup);

    // Way-out stairs (A) and the exit portal behind the boss (G).
    this.exitAGroup = new THREE.Group();
    this.exitAGroup.name = 'dungeon:exitA';
    this.exitAGroup.position.copy(W(SPOTS.exitA[0], SPOTS.exitA[1]));
    const eaMesh = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 1.5), new THREE.MeshBasicMaterial({ color: 0xffe8b0 }));
    eaMesh.position.y = 0.05;
    this.exitAGroup.add(eaMesh);

    this.exitGGroup = new THREE.Group();
    this.exitGGroup.name = 'dungeon:exitG';
    this.exitGGroup.position.copy(W(SPOTS.exitG[0], SPOTS.exitG[1]));
    const egMesh = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 1.5), new THREE.MeshBasicMaterial({ color: 0xffe8b0 }));
    egMesh.position.y = 0.05;
    this.exitGGroup.add(egMesh);
    this.group.add(this.exitAGroup, this.exitGGroup);

    // One cheap point light for the brazier when lit (no shadows, active only in F).
    this.brazierLight = new THREE.PointLight(0xff8c32, 14, 18, 1.6);
    this.brazierLight.position.copy(W(SPOTS.brazier[0], SPOTS.brazier[1])).setY(VAULT.y + 2.4);
    this.brazierLight.visible = false;
    this.group.add(this.brazierLight);

    for (const [kind, x, z, level] of ENEMIES) {
      const p = W(x, z);
      this.enemies.push(enemies.spawn(kind, p.x, p.z, level));
    }
    const bp = W(SPOTS.boss[0], SPOTS.boss[1]);
    this.boss = enemies.spawn('warden', bp.x, bp.z, 16);
    this.enemies.push(this.boss);

    this.countdown = document.createElement('div');
    this.countdown.className = 'countdown';
    this.countdown.style.display = 'none';
    hudRoot.appendChild(this.countdown);
    this.setVisible(false);
    this.sync();

    this.loaded = Promise.all([loadDungeonFile(this.file), loadWorldFile(this.worldFile).catch(() => null)]).then(
      () => this.applyModels(),
      () => false,
    );
  }

  // ---------------------------------------------------------------- building

  private solid(box: Box, mat: THREE.Material): void {
    box.noClimb = true;
    box.zone = 'dungeon';
    const mesh = this.world.addSolid(box, mat);
    this.fallbackSolids.push(mesh);
    this.walls.push(box);
  }

  private buildRoom(r: RoomSpec, mat: THREE.Material): void {
    const y0 = VAULT.y;
    const y1 = VAULT.y + WALL_H;
    const seg = (side: Side, a0: number, a1: number) => {
      if (a1 - a0 < 0.01) return;
      let box: Box;
      if (side === 'n' || side === 's') {
        const z = side === 'n' ? r.z0 - 1 : r.z1;
        box = { minX: a0, maxX: a1, minZ: z, maxZ: z + 1, minY: y0, maxY: y1 };
      } else {
        const x = side === 'w' ? r.x0 - 1 : r.x1;
        box = { minX: x, maxX: x + 1, minZ: a0, maxZ: a1, minY: y0, maxY: y1 };
      }
      box.minX += VAULT.ox;
      box.maxX += VAULT.ox;
      box.minZ += VAULT.oz;
      box.maxZ += VAULT.oz;
      this.solid(box, mat);
    };
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      const ns = side === 'n' || side === 's';
      const lo = ns ? r.x0 - 1 : r.z0;
      const hi = ns ? r.x1 + 1 : r.z1;
      const gaps = r.open.filter((o) => o.side === side).sort((a, b) => a.at - b.at);
      let at = lo;
      for (const g of gaps) {
        seg(side, at, g.at - g.w / 2);
        at = g.at + g.w / 2;
      }
      seg(side, at, hi);
    }
  }

  private addDoor(id: keyof typeof SPOTS, color: number, open: boolean): void {
    const [x, z] = SPOTS[id];
    const alongX = id !== 'crystalDoor';
    const w = 4;
    const c = W(x, z);
    const box: Box = {
      minX: c.x - (alongX ? w / 2 : 0.5),
      maxX: c.x + (alongX ? w / 2 : 0.5),
      minZ: c.z - (alongX ? 0.5 : w / 2),
      maxZ: c.z + (alongX ? 0.5 : w / 2),
      minY: VAULT.y,
      maxY: VAULT.y + WALL_H,
      noClimb: true,
      zone: 'dungeon',
    };
    const holder = new THREE.Group();
    holder.name = `dungeon:door:${id}`;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, 1), toonMaterial(color));
    mesh.castShadow = mesh.receiveShadow = true;
    holder.add(mesh);
    if (!alongX) holder.rotation.y = Math.PI / 2;
    holder.position.set(c.x, VAULT.y + WALL_H / 2, c.z);
    this.group.add(holder);
    const d: Door = { id, box, mesh: holder, open: !open, anim: open ? 1 : 0 };
    this.doors.set(id, d);
    this.setDoor(id, open);
  }

  // ---------------------------------------------------------------- models (milestone 8)

  private applyModels(): boolean {
    const f = this.file;
    const builtRooms = new Map<string, RoomNode>();

    for (const r of ROOMS) {
      const floor = new KitBuilder(f);
      const arch = new KitBuilder(f);
      const ceil = new KitBuilder(f);
      this.buildRoomKit(r, floor, arch, ceil);
      if (floor.missing.size || arch.missing.size || ceil.missing.size) {
        console.warn(`dungeon models: room ${r.id} lacks pieces; keeping the boxes`);
        return false;
      }
      const roomGroup = new THREE.Group();
      roomGroup.name = `dungeon:room:${r.id}`;
      const floorGroup = floor.build(`dungeon:floor:${r.id}`, { outline: 0, shadow: false, receive: true });
      const archGroup = arch.build(`dungeon:arch:${r.id}`, { outline: 0, shadow: false, receive: true });
      const ceilGroup = ceil.build(`dungeon:ceil:${r.id}`, { outline: 0, shadow: false, receive: false });
      ceilGroup.visible = this.ceilingsVisible;
      roomGroup.add(floorGroup, archGroup, ceilGroup);
      builtRooms.set(r.id, { spec: r, group: roomGroup, ceiling: ceilGroup });
    }

    const pushModel = worldNode('PushBlock', f);
    const plateFrame = worldNode('PlateFrame', f);
    const platePad = worldNode('PlatePad', f);
    const resetModel = worldNode('ResetRune', f);
    const pedestalModel = worldNode('CrystalPedestal', f);
    const crystalModel = worldNode('CrystalGem', f);
    const leverBase = worldNode('LeverBase', f);
    const leverArm = worldNode('LeverArm', f);
    const brazierBowl = worldNode('BrazierBowl', f);
    const brazierFlame = worldNode('BrazierFlame', f);
    const exitA = worldNode('ExitStairsA', f);
    const exitG = worldNode('ExitPortal', f);
    const doorNodes = Object.fromEntries(Object.entries(DOOR_MODELS).map(([id, n]) => [id, worldNode(n, f)]));

    if (
      !pushModel || !plateFrame || !platePad || !resetModel || !pedestalModel || !crystalModel ||
      !leverBase || !leverArm || !brazierBowl || !brazierFlame || !exitA || !exitG ||
      Object.values(doorNodes).some((d) => !d)
    ) {
      console.warn('dungeon models: missing mechanism/door node; keeping the boxes');
      return false;
    }

    // Commit rooms and hide the procedural wall/floor/railing boxes.
    for (const node of builtRooms.values()) {
      this.rooms.set(node.spec.id, node);
      this.group.add(node.group);
    }
    for (const m of this.fallbackSolids) m.visible = false;
    this.fallbackTorches.visible = false;

    // Doors.
    for (const [id, d] of this.doors) {
      d.mesh.clear();
      d.mesh.add(doorNodes[id]!);
    }

    // Push block.
    this.block.mesh.clear();
    this.block.mesh.add(pushModel);

    // Pressure plate.
    this.plateMesh.clear();
    this.plateMesh.add(plateFrame, platePad);
    this.platePad = platePad;
    platePad.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material).name === 'PlateGlow') {
        const clone = (m.material as THREE.MeshToonMaterial).clone();
        m.material = clone;
        this.plateGlowMat = clone;
      }
    });

    // Reset rune.
    this.resetGroup.clear();
    this.resetGroup.add(resetModel);

    // Crystal switch + pedestal.
    this.crystalPedestal.clear();
    this.crystalPedestal.add(pedestalModel);
    this.crystal.clear();
    this.crystal.add(crystalModel);
    crystalModel.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.name.endsWith('_outline') && (m.material as THREE.Material).name === 'DungeonCrystal') {
        const clone = (m.material as THREE.MeshToonMaterial).clone();
        m.material = clone;
        this.crystalModelMat = clone;
      }
    });

    // Key chest: reuse ChestGold from world.glb at clear dungeon chest scale (~1.05 m wide), angled into Room D.
    if (worldReady(this.worldFile)) {
      const cBody = worldNode(CHEST_ART.gold.body, this.worldFile);
      const cLid = worldNode(CHEST_ART.gold.lid, this.worldFile);
      if (cBody && cLid) {
        const hinge = new THREE.Group();
        hinge.position.set(...CHEST_ART.gold.hinge);
        hinge.add(cLid);
        this.keyChestGroup.clear();
        this.keyChestGroup.add(cBody, hinge);
        this.keyChestGroup.scale.setScalar(1.2);
        this.keyChestGroup.rotation.y = -0.35;
        this.keyChestLid = hinge;
      }
    }

    // Timed lever.
    const leverParent = this.lever.parent!;
    leverParent.clear();
    leverArm.position.set(0, 0.42, 0);
    this.lever = leverArm as THREE.Group;
    leverParent.add(leverBase, leverArm);

    // Brazier.
    this.brazierGroup.clear();
    brazierFlame.position.set(0, 0.90, 0);
    this.brazierFlame = brazierFlame;
    brazierBowl.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material).name === 'BrazierEmber') {
        const clone = (m.material as THREE.MeshToonMaterial).clone();
        m.material = clone;
        this.brazierEmberMat = clone;
      }
    });
    this.brazierGroup.add(brazierBowl, brazierFlame);

    // Entrance stairs (A) & Exit portal (G).
    this.exitAGroup.clear();
    exitA.position.set(0, 0, 0.95);
    this.exitAGroup.add(exitA);

    this.exitGGroup.clear();
    exitG.position.set(0, 0, -1.6);
    exitG.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.name.endsWith('_outline')) return;
      const matName = (m.material as THREE.Material).name;
      if (matName === 'ExitPortalGlow' || matName === 'ExitPortalMid' || matName === 'ExitPortalCore') {
        const clone = (m.material as THREE.MeshToonMaterial).clone();
        m.material = clone;
        if (matName === 'ExitPortalGlow') this.exitGGlowMat = clone;
        else if (matName === 'ExitPortalMid') this.exitGMidMat = clone;
        else this.exitGCoreMat = clone;
      }
    });
    this.exitGGroup.add(exitG);

    // Instanced dungeon dressing (torches, chains, and reused world.glb props).
    this.buildDressing();

    this.modelsReady = true;
    this.lastVisKey = '';
    this.sync();
    this.syncVisibility();
    return true;
  }

  private buildRoomKit(r: RoomSpec, floor: KitBuilder, arch: KitBuilder, ceil: KitBuilder): void {
    const y0 = VAULT.y;

    // 1. Floor tiles covering interior (and doorway thresholds attached to S/W room).
    this.tileRect(floor, r.id, r.x0, r.x1, r.z0, r.z1, y0);
    for (const th of THRESHOLDS) {
      if (th.room === r.id) this.tileRect(floor, r.id, th.x0, th.x1, th.z0, th.z1, y0, true);
    }

    // 2. Walls (lower 4m + upper 3m), matching buildRoom's exact segments.
    const wallSeg = (side: Side, a0: number, a1: number) => {
      const len = a1 - a0;
      if (len < 0.01) return;
      const n = Math.max(1, Math.round(len / 4));
      const seg = len / n;
      const yaw = side === 'n' ? 0 : side === 's' ? Math.PI : side === 'w' ? Math.PI / 2 : -Math.PI / 2;
      for (let i = 0; i < n; i++) {
        const along = a0 + seg * (i + 0.5);
        const wx = side === 'w' ? r.x0 - 0.5 : side === 'e' ? r.x1 + 0.5 : along;
        const wz = side === 'n' ? r.z0 - 0.5 : side === 's' ? r.z1 + 0.5 : along;
        const h = hash2(wx, wz, 3);
        let lower = 'DungWall';
        if (seg >= 3.2) {
          if (r.id === 'G' && i % 2 === 1) lower = 'DungWallPillar';
          else if ((r.id === 'A' || r.id === 'F') && h < 0.45) lower = 'DungWallArched';
          else if (h < 0.12) lower = 'DungWallCracked';
          else if (h < 0.36) lower = 'DungWallPillar';
        }
        arch.add(lower, trs(VAULT.ox + wx, y0, VAULT.oz + wz, yaw, seg / 4, 1, 1));
        arch.add('DungWall', trs(VAULT.ox + wx, y0 + 4, VAULT.oz + wz, yaw, seg / 4, 0.75, 1));
      }
    };
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      const ns = side === 'n' || side === 's';
      const lo = ns ? r.x0 - 1 : r.z0;
      const hi = ns ? r.x1 + 1 : r.z1;
      const gaps = r.open.filter((o) => o.side === side).sort((a, b) => a.at - b.at);
      let at = lo;
      for (const g of gaps) {
        wallSeg(side, at, g.at - g.w / 2);
        // Archway lintel + side jambs over each doorway opening.
        const ax = side === 'w' ? r.x0 - 0.3 : side === 'e' ? r.x1 + 0.3 : g.at;
        const az = side === 'n' ? r.z0 - 0.3 : side === 's' ? r.z1 + 0.3 : g.at;
        const yaw = ns ? 0 : Math.PI / 2;
        arch.add('DungArch', trs(VAULT.ox + ax, y0 + 5.2, VAULT.oz + az, yaw, g.w, 1.8, 0.56));
        for (const sgn of [-1, 1]) {
          const jx = ns ? g.at + sgn * (g.w / 2 + 0.16) : ax;
          const jz = ns ? az : g.at + sgn * (g.w / 2 + 0.16);
          arch.add('DungPillar', trs(VAULT.ox + jx, y0, VAULT.oz + jz, yaw, 0.42, 1.75, 0.55));
        }
        at = g.at + g.w / 2;
      }
      wallSeg(side, at, hi);
    }

    // 3. Corner pilasters (tucked into corners, off gameplay paths).
    for (const [cx, cz] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]]) {
      const px = cx + (cx === r.x0 ? -0.15 : 0.15);
      const pz = cz + (cz === r.z0 ? -0.15 : 0.15);
      arch.add('DungPillar', trs(VAULT.ox + px, y0, VAULT.oz + pz, 0, 0.72, 1.75, 0.72));
    }

    // Boss arena monumental wall pilasters (Room G).
    if (r.id === 'G') {
      for (const z of [-135, -143, -151, -159]) {
        arch.add('DungPillarDec', trs(VAULT.ox + r.x0 + 0.15, y0, VAULT.oz + z, Math.PI / 2, 0.85, 1.75, 0.85));
        arch.add('DungPillarDec', trs(VAULT.ox + r.x1 - 0.15, y0, VAULT.oz + z, -Math.PI / 2, 0.85, 1.75, 0.85));
      }
      for (const x of [-8, 8]) {
        arch.add('DungPillarDec', trs(VAULT.ox + x, y0, VAULT.oz + r.z0 + 0.15, 0, 0.85, 1.75, 0.85));
      }
    }

    // 4. Crystal railing in Room C (exact match to the 3 rail colliders).
    if (r.id === 'C') {
      arch.add('DungRailing', trs(VAULT.ox - 9.75, y0, VAULT.oz - 50, Math.PI / 2, 4, 1, 1));
      arch.add('DungRailing', trs(VAULT.ox - 10.75, y0, VAULT.oz - 52.25, 0, 2.5, 1, 1));
      arch.add('DungRailing', trs(VAULT.ox - 10.75, y0, VAULT.oz - 47.75, 0, 2.5, 1, 1));
      arch.add('DungRailPost', trs(VAULT.ox - 9.75, y0, VAULT.oz - 52.25, 0, 1, 1, 1));
      arch.add('DungRailPost', trs(VAULT.ox - 9.75, y0, VAULT.oz - 47.75, 0, 1, 1, 1));
    }

    // 5. Ceiling slabs + cross beams (single-sided downward, castShadow=false).
    const cw = r.x1 - r.x0;
    const cd = r.z1 - r.z0;
    const nx = Math.max(1, Math.round(cw / 4));
    const nz = Math.max(1, Math.round(cd / 4));
    const sx = cw / nx;
    const sz = cd / nz;
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        ceil.add('DungCeiling', trs(VAULT.ox + r.x0 + sx * (ix + 0.5), y0 + WALL_H, VAULT.oz + r.z0 + sz * (iz + 0.5), 0, sx, 1, sz));
      }
    }
    // Ceiling slabs over doorway thresholds so there are no gaps above doors.
    for (const th of THRESHOLDS) {
      if (th.room === r.id) {
        ceil.add('DungCeiling', trs(VAULT.ox + (th.x0 + th.x1) / 2, y0 + WALL_H, VAULT.oz + (th.z0 + th.z1) / 2, 0, th.x1 - th.x0, 1, th.z1 - th.z0));
      }
    }
    const alongX = cw <= cd;
    if (alongX) {
      for (let z = r.z0 + 4; z < r.z1 - 1; z += 4) {
        ceil.add('DungBeam', trs(VAULT.ox + (r.x0 + r.x1) / 2, y0 + WALL_H, VAULT.oz + z, 0, cw, 1, 1));
      }
    } else {
      for (let x = r.x0 + 4; x < r.x1 - 1; x += 4) {
        ceil.add('DungBeam', trs(VAULT.ox + x, y0 + WALL_H, VAULT.oz + (r.z0 + r.z1) / 2, Math.PI / 2, cd, 1, 1));
      }
    }
  }

  private tileRect(k: KitBuilder, roomId: string, x0: number, x1: number, z0: number, z1: number, y: number, smallOnly = false): void {
    // Tile 4x4 squares where possible, and always 2x2 squares for remainders so 90-degree rotations never leave gaps.
    for (let x = x0; x < x1;) {
      const can4x = !smallOnly && x + 4 <= x1;
      const wx = can4x ? 4 : 2;
      for (let z = z0; z < z1;) {
        const use4 = can4x && z + 4 <= z1;
        if (wx === 4 && !use4) {
          // Sub-divide this 4x2 strip into two 2x2 small tiles.
          for (const dx of [0, 2]) {
            const cx = x + dx + 1;
            const cz = z + 1;
            const rot = Math.floor(hash2(cx, cz, 12) * 4) * (Math.PI / 2);
            k.add('DungFloorSmall', trs(VAULT.ox + cx, y, VAULT.oz + cz, rot));
          }
          z += 2;
          continue;
        }
        const wz = use4 ? 4 : 2;
        const cx = x + wx / 2;
        const cz = z + wz / 2;
        let node = 'DungFloorSmall';
        if (use4) {
          const inBrazier = roomId === 'F' && Math.abs(cx) < 3 && Math.abs(cz + 119) < 3;
          const inArenaCenter = roomId === 'G' && Math.abs(cx) < 7 && Math.abs(cz + 145) < 7;
          node = inBrazier || inArenaCenter ? 'DungFloorGrate' : 'DungFloor';
        }
        const rot = Math.floor(hash2(cx, cz, 12) * 4) * (Math.PI / 2);
        k.add(node, trs(VAULT.ox + cx, y, VAULT.oz + cz, rot));
        z += wz;
      }
      x += wx;
    }
  }

  private buildDressing(): void {
    const slots: DressSlot[] = [];
    const add = (file: string, node: string, room: string, x: number, y: number, z: number, yaw = 0, scale = 1) => {
      slots.push({ file, node, room, matrix: trs(VAULT.ox + x, VAULT.y + y, VAULT.oz + z, yaw, scale, scale, scale) });
    };

    // Wall torches in every room.
    for (const r of ROOMS) {
      const zMid = (r.z0 + r.z1) / 2;
      if (r.id === 'E') {
        for (const z of [-72, -82, -92, -102]) {
          add(this.file, 'TorchWall', 'E', r.x0 + 0.02, 3.1, z, Math.PI / 2);
          add(this.file, 'TorchWall', 'E', r.x1 - 0.02, 3.1, z, -Math.PI / 2);
        }
      } else if (r.id === 'G') {
        for (const z of [-135, -145, -155]) {
          add(this.file, 'TorchWall', 'G', r.x0 + 0.02, 3.3, z, Math.PI / 2);
          add(this.file, 'TorchWall', 'G', r.x1 - 0.02, 3.3, z, -Math.PI / 2);
        }
        for (const x of [-8, 8]) add(this.file, 'TorchWall', 'G', x, 3.3, r.z0 + 0.02, 0);
      } else {
        // Skip west wall of C near crystal (-50) and east wall of C near doorway (-50).
        if (r.id === 'C') {
          for (const z of [-43, -57]) {
            add(this.file, 'TorchWall', 'C', r.x0 + 0.02, 3.1, z, Math.PI / 2);
            add(this.file, 'TorchWall', 'C', r.x1 - 0.02, 3.1, z, -Math.PI / 2);
          }
        } else if (r.id === 'D') {
          add(this.file, 'TorchWall', 'D', r.x1 - 0.02, 3.1, zMid, -Math.PI / 2);
          add(this.file, 'TorchWall', 'D', 21, 3.1, r.z0 + 0.02, 0);
        } else {
          add(this.file, 'TorchWall', r.id, r.x0 + 0.02, 3.1, zMid, Math.PI / 2);
          add(this.file, 'TorchWall', r.id, r.x1 - 0.02, 3.1, zMid, -Math.PI / 2);
        }
      }
    }

    // Hanging ceiling chains (high up at y=7 -> y=4.7, completely above player/camera).
    const chains: [string, number, number][] = [
      ['A', -5, -11], ['A', 5, -11],
      ['B', -7, -20], ['B', 7, -32],
      ['C', -8, -42], ['C', 8, -58],
      ['D', 17, -45], ['D', 17, -55],
      ['E', 0, -76], ['E', 0, -96],
      ['F', -5, -116], ['F', 5, -116],
      ['G', -11, -135], ['G', 11, -135], ['G', -11, -155], ['G', 11, -155],
    ];
    for (const [room, x, z] of chains) add(this.file, 'ChainHang', room, x, WALL_H, z, 0, 1);

    // Reused world.glb dressing (kept strictly off gameplay paths, spawns & interactables).
    if (worldReady(this.worldFile)) {
      const wf = this.worldFile;
      // Banners on walls.
      add(wf, 'Banner', 'A', -5, 2.5, -13.85, 0);
      add(wf, 'Banner', 'A', 5, 2.5, -13.85, 0);
      add(wf, 'BannerTorn', 'B', -9.85, 2.5, -21, Math.PI / 2);
      add(wf, 'BannerTorn', 'B', 9.85, 2.5, -31, -Math.PI / 2);
      add(wf, 'Banner', 'C', -6, 2.5, -61.85, 0);
      add(wf, 'Banner', 'C', 6, 2.5, -61.85, 0);
      add(wf, 'Banner', 'F', -5, 2.5, -125.85, 0);
      add(wf, 'Banner', 'F', 5, 2.5, -125.85, 0);
      for (const z of [-139, -147]) {
        add(wf, 'Banner', 'G', -15.85, 2.7, z, Math.PI / 2);
        add(wf, 'Banner', 'G', 15.85, 2.7, z, -Math.PI / 2);
      }

      // Corner rubble, barrels, crates, candles, bones (all tucked at room edges/corners).
      add(wf, 'Barrel', 'A', 6.8, 0, -1.5, 0.2);
      add(wf, 'CrateSmall', 'A', 6.6, 0, -2.6, 0.5);
      add(wf, 'RubbleBig', 'A', -6.2, 0, -13.0, 0.1, 0.75);
      add(wf, 'Candles', 'A', -6.8, 0, -1.2, 0.4);

      add(wf, 'RubbleBig', 'B', 8.0, 0, -17.0, 0.3, 0.75);
      add(wf, 'Bones', 'B', -8.6, 0, -34.6, 0.6);
      add(wf, 'CrateBig', 'B', 8.7, 0, -34.7, -0.2);

      add(wf, 'RubbleBig', 'C', 10.2, 0, -39.2, -0.2, 0.75);
      add(wf, 'Barrel', 'C', -10.8, 0, -39.4, 0.1);
      add(wf, 'CrateSmall', 'C', -10.8, 0, -40.5, 0.7);
      add(wf, 'Candles', 'C', -10.8, 0, -60.8, 0.2);

      add(wf, 'Barrel', 'D', 15.2, 0, -43.2, 0.2);
      add(wf, 'CrateBig', 'D', 16.3, 0, -43.2, 0.4);
      add(wf, 'RubbleBig', 'D', 26.2, 0, -43.0, 0.1, 0.7);
      add(wf, 'Candles', 'D', 26.8, 0, -56.8, 0.8);

      add(wf, 'Skull', 'E', -2.3, 0, -65.2, 0.4, 0.8);
      add(wf, 'Bones', 'E', 2.2, 0, -108.5, 1.1);

      add(wf, 'Barrel', 'F', -6.8, 0, -113.2, 0);
      add(wf, 'CrateBig', 'F', 6.8, 0, -113.2, 0.3);
      add(wf, 'Candles', 'F', -6.8, 0, -124.8, 0.5);
      add(wf, 'Candles', 'F', 6.8, 0, -124.8, 1.2);

      add(wf, 'Rubble', 'G', -14.0, 0, -160.2, 0.2, 0.85);
      add(wf, 'Rubble', 'G', 14.0, 0, -160.2, -0.4, 0.85);
      add(wf, 'RubbleBig', 'G', -14.2, 0, -129.2, 0.1, 0.85);
      add(wf, 'RubbleBig', 'G', 14.2, 0, -129.2, -0.1, 0.85);
      add(wf, 'Bones', 'G', -14.5, 0, -142.0, 0.5);
      add(wf, 'Skull', 'G', 14.5, 0, -149.0, -0.7, 0.85);
      add(wf, 'Candles', 'G', -3.6, 0, -160.6, 0.2);
      add(wf, 'Candles', 'G', 3.6, 0, -160.6, 0.9);
    }

    // Group by (file, node) into InstancedMesh batches.
    const byKey = new Map<string, DressSlot[]>();
    for (const s of slots) {
      const k = `${s.file}#${s.node}`;
      let list = byKey.get(k);
      if (!list) byKey.set(k, (list = []));
      list.push(s);
    }
    for (const items of byKey.values()) {
      const parts = pieceMeshes(items[0].node, items[0].file);
      if (!parts) continue;
      const meshes: THREE.InstancedMesh[] = [];
      for (const p of parts) {
        const im = new THREE.InstancedMesh(p.geometry, p.material, items.length);
        im.name = `dungeon:dress:${items[0].node}`;
        im.castShadow = false;
        im.receiveShadow = true;
        im.frustumCulled = false;
        im.count = 0;
        this.group.add(im);
        meshes.push(im);
      }
      this.dressBatches.push({ items, meshes });
    }
  }

  // ---------------------------------------------------------------- visibility & culling

  /** Show or hide the entire Ember Vault (costs 0 when player is outside). */
  setVisible(on: boolean): void {
    this.group.visible = on;
    if (!this.modelsReady) {
      for (const m of this.fallbackSolids) m.visible = on;
    }
  }

  /** Toggle ceiling visibility (e.g. for overhead overview shots). */
  setCeilingsVisible(on: boolean): void {
    this.ceilingsVisible = on;
    for (const r of this.rooms.values()) r.ceiling.visible = on;
  }

  /** Cull rooms that neither the player nor camera can see through open doorways. */
  cull(playerPos: THREE.Vector3, camera?: THREE.Camera): void {
    if (!this.modelsReady) return;
    const highCam = !!camera && camera.position.y > VAULT.y + 15;
    let vis: Set<string>;
    if (highCam) {
      vis = new Set(ROOMS.map((r) => r.id));
    } else {
      const seeds = new Set<string>();
      const addSeed = (pt: THREE.Vector3) => {
        const lx = pt.x - VAULT.ox;
        const lz = pt.z - VAULT.oz;
        for (const r of ROOMS) {
          if (lx >= r.x0 - 1.5 && lx <= r.x1 + 1.5 && lz >= r.z0 - 1.5 && lz <= r.z1 + 1.5) seeds.add(r.id);
        }
      };
      addSeed(playerPos);
      if (camera) addSeed(camera.position);
      if (!seeds.size) seeds.add('A');

      vis = new Set(seeds);
      const q: { id: string; depth: number }[] = [...seeds].map((id) => ({ id, depth: 0 }));
      while (q.length) {
        const cur = q.shift()!;
        if (cur.depth >= 2) continue;
        for (const link of ROOM_LINKS[cur.id] ?? []) {
          if (vis.has(link.id)) continue;
          if (link.door) {
            const d = this.doors.get(link.door);
            if (d && !d.open && d.anim <= 0.02) continue;
          }
          const target = this.rooms.get(link.id)?.spec;
          if (target) {
            const cx = Math.max(VAULT.ox + target.x0, Math.min(VAULT.ox + target.x1, playerPos.x));
            const cz = Math.max(VAULT.oz + target.z0, Math.min(VAULT.oz + target.z1, playerPos.z));
            if (Math.hypot(cx - playerPos.x, cz - playerPos.z) > 62) continue;
          }
          vis.add(link.id);
          q.push({ id: link.id, depth: cur.depth + 1 });
        }
      }
    }

    const key = [...vis].sort().join(',');
    if (key === this.lastVisKey) return;
    this.lastVisKey = key;

    for (const [id, r] of this.rooms) r.group.visible = vis.has(id);
    for (const [id, d] of this.doors) {
      const pair = DOOR_ROOMS[id];
      d.mesh.visible = !pair || vis.has(pair[0]) || vis.has(pair[1]);
    }
    this.exitAGroup.visible = vis.has('A');
    const visB = vis.has('B');
    this.block.mesh.visible = visB;
    this.plateMesh.visible = visB;
    this.resetGroup.visible = visB;
    const visC = vis.has('C');
    this.crystalPedestal.visible = visC;
    this.crystal.visible = visC;
    this.keyChestGroup.visible = vis.has('D');
    this.leverGroup.visible = vis.has('E');
    this.brazierGroup.visible = vis.has('F');
    this.exitGGroup.visible = vis.has('G');
    for (const b of this.dressBatches) {
      let n = 0;
      for (let i = 0; i < b.items.length; i++) {
        if (!vis.has(b.items[i].room)) continue;
        for (const im of b.meshes) im.setMatrixAt(n, b.items[i].matrix);
        n++;
      }
      for (const im of b.meshes) {
        im.count = n;
        im.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private syncVisibility(): void {
    this.lastVisKey = '';
  }

  // ---------------------------------------------------------------- doors

  setDoor(id: string, open: boolean): void {
    const d = this.doors.get(id)!;
    if (d.open === open) return;
    d.open = open;
    if (open) this.world.removeCollider(d.box);
    else this.world.addCollider(d.box);
    this.lastVisKey = '';
  }

  isOpen(id: string): boolean {
    return this.doors.get(id)!.open;
  }

  // ---------------------------------------------------------------- queries

  /** Is a point inside the vault? */
  contains(p: THREE.Vector3): boolean {
    const b = this.bounds;
    return p.y > VAULT.y - 20 && p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ;
  }

  entryPoint(): THREE.Vector3 {
    return W(SPOTS.entry[0], SPOTS.entry[1]);
  }

  /** World position of a named spot. */
  spot(id: keyof typeof SPOTS): THREE.Vector3 {
    const [x, z] = SPOTS[id];
    return W(x, z);
  }

  crystalPos(): THREE.Vector3 {
    return W(SPOTS.crystal[0], SPOTS.crystal[1]).setY(VAULT.y + 2.3);
  }

  blockOnPlate(): boolean {
    const p = W(SPOTS.plate[0], SPOTS.plate[1]);
    const c = this.blockCentre();
    return Math.abs(c.x - p.x) < 0.5 && Math.abs(c.z - p.z) < 0.5;
  }

  blockCentre(): THREE.Vector3 {
    const b = this.block.box;
    return new THREE.Vector3((b.minX + b.maxX) / 2, VAULT.y, (b.minZ + b.maxZ) / 2);
  }

  // ---------------------------------------------------------------- per step

  update(dt: number, player: { pos: THREE.Vector3; state: string }): void {
    // Pressure plate: held down by the block (or you standing on it).
    const plate = W(SPOTS.plate[0], SPOTS.plate[1]);
    const standing = player.state !== 'dead' && Math.abs(player.pos.x - plate.x) < 1.1 && Math.abs(player.pos.z - plate.z) < 1.1 && Math.abs(player.pos.y - VAULT.y) < 0.3;
    const pressed = this.blockOnPlate() || standing;
    if (this.blockOnPlate() && !this.solved.has('plate')) {
      this.solved.add('plate');
      this.hooks.message('The stone settles on the plate. A door grinds open.');
    }
    this.setDoor('plateDoor', pressed || this.solved.has('plate'));
    this.platePad.position.y = pressed ? (this.modelsReady ? 0.03 : 0.02) : (this.modelsReady ? 0.08 : 0.06);
    if (this.plateGlowMat) this.plateGlowMat.emissiveIntensity = pressed ? 1.4 : 0.25;

    // Timed gate.
    if (this.timer > 0) {
      this.timer -= dt;
      const gate = W(SPOTS.timedDoor[0], SPOTS.timedDoor[1]);
      if (player.pos.z < gate.z - 0.6 && Math.abs(player.pos.x - gate.x) < 3 && this.contains(player.pos)) {
        this.solved.add('timed');
        this.timer = 0;
        this.hooks.message('You made it! The gate stays open behind you.');
      } else if (this.timer <= 0) {
        this.timer = 0;
        this.hooks.message('The gate slams shut.');
      }
    }
    this.setDoor('timedDoor', this.timer > 0 || this.solved.has('timed'));
    this.lever.rotation.x = this.solved.has('timed') || this.timer > 0 ? -0.6 : 0.6;
    this.countdown.style.display = this.timer > 0 ? '' : 'none';
    if (this.timer > 0) this.countdown.textContent = `Gate closing… ${this.timer.toFixed(1)}`;

    // Exit portal glow illuminates in 3 layered emerald tones once the Cinder Warden falls.
    if (this.exitGGlowMat) {
      const dead = !this.boss.alive;
      this.exitGGlowMat.color.setHex(dead ? 0x0e3d24 : 0x141b19);
      this.exitGGlowMat.emissive.setHex(dead ? 0x0a341e : 0x080c0a);
      this.exitGGlowMat.emissiveIntensity = dead ? 0.30 : 0.14;
      if (this.exitGMidMat) {
        this.exitGMidMat.color.setHex(dead ? 0x1a824a : 0x1c2623);
        this.exitGMidMat.emissive.setHex(dead ? 0x146c3c : 0x0d1411);
        this.exitGMidMat.emissiveIntensity = dead ? 0.42 : 0.16;
      }
      if (this.exitGCoreMat) {
        this.exitGCoreMat.color.setHex(dead ? 0x38c272 : 0x26342f);
        this.exitGCoreMat.emissive.setHex(dead ? 0x289a56 : 0x121d19);
        this.exitGCoreMat.emissiveIntensity = dead ? 0.52 : 0.20;
      }
    }

    // Sliding block.
    const a = this.block.anim;
    if (a) {
      const c = this.block.mesh.position;
      const k = 1 - Math.exp(-14 * dt);
      c.x += (a.x - c.x) * k;
      c.z += (a.z - c.z) * k;
      if (Math.hypot(a.x - c.x, a.z - c.z) < 0.02) {
        c.set(a.x, c.y, a.z);
        this.block.anim = null;
      }
    }
  }

  /** Doors sink into the floor; the crystal spins; the brazier flickers. */
  animate(t: number, dt: number): void {
    for (const d of this.doors.values()) {
      const prevVis = d.mesh.visible;
      d.anim += ((d.open ? 1 : 0) - d.anim) * Math.min(1, dt * 6);
      d.mesh.position.y = VAULT.y + WALL_H / 2 - d.anim * (WALL_H - 0.15);
      d.mesh.visible = d.anim < 0.99;
      if (d.mesh.visible !== prevVis) this.lastVisKey = '';
    }
    this.crystal.rotation.y = t * (this.solved.has('crystal') ? 0.6 : 2);
    this.crystal.position.y = VAULT.y + 2.3 + Math.sin(t * 2) * 0.08;
    if (this.modelsReady) {
      this.brazierFlame.visible = this.brazierLit;
      if (this.brazierLit) {
        const sy = 1 + Math.sin(t * 9.5) * 0.12 + Math.sin(t * 17.3) * 0.05;
        const sx = 1 + Math.cos(t * 11.2) * 0.06;
        this.brazierFlame.scale.set(sx, sy, sx);
        this.brazierFlame.rotation.y = t * 1.4;
      }
    } else {
      this.brazierFlame.visible = true;
      this.brazierFlame.scale.setScalar(this.brazierLit ? 1 + Math.sin(t * 13) * 0.08 : 0.35);
    }
  }

  // ---------------------------------------------------------------- puzzles

  /** A player melee swing (crystal switch). */
  strike(origin: THREE.Vector3, facing: THREE.Vector3, reach: number, arc: number): boolean {
    if (this.solved.has('crystal')) return false;
    if (Math.abs(origin.y - VAULT.y) > 2) return false;
    // The crystal sits high on its pillar; any swing at it counts.
    if (!inArc(origin, facing, this.crystalPos().setY(origin.y + 1), reach + 0.5, arc)) return false;
    this.hitCrystal();
    return true;
  }

  /** A player projectile moved from `a` to `b` (crystal switch). Returns true if it hit. */
  projectileHit(a: THREE.Vector3, b: THREE.Vector3, r: number): boolean {
    if (this.solved.has('crystal')) return false;
    const c = this.crystalPos();
    const seg = b.clone().sub(a);
    const t = Math.max(0, Math.min(1, c.clone().sub(a).dot(seg) / Math.max(seg.lengthSq(), 1e-9)));
    if (a.clone().addScaledVector(seg, t).distanceTo(c) > 0.6 + r) return false;
    this.hitCrystal();
    return true;
  }

  private hitCrystal(): void {
    this.solved.add('crystal');
    this.hooks.message('The crystal rings out. Somewhere a door opens.');
    this.sync();
  }

  /** Push the block one step away from the player, if the way is clear. */
  push(from: THREE.Vector3): boolean {
    if (this.solved.has('plate') && this.blockOnPlate()) return false;
    const c = this.blockCentre();
    const dx = c.x - from.x;
    const dz = c.z - from.z;
    const dir = Math.abs(dx) > Math.abs(dz) ? new THREE.Vector3(Math.sign(dx), 0, 0) : new THREE.Vector3(0, 0, Math.sign(dz));
    const to = c.clone().addScaledVector(dir, STEP);
    // Stay inside room B, clear of its walls.
    const lx = to.x - VAULT.ox;
    const lz = to.z - VAULT.oz;
    if (lx < -10 + 1 || lx > 10 - 1 || lz < -36 + 1 || lz > -16 - 1) {
      this.hooks.message('It will not budge any further that way.');
      return false;
    }
    this.placeBlock(to);
    this.block.anim = to.clone();
    // Visual slides from where it was.
    this.block.mesh.position.set(c.x, VAULT.y + 0.8, c.z);
    return true;
  }

  private placeBlock(at: THREE.Vector3): void {
    const b = this.block.box;
    b.minX = at.x - 0.9;
    b.maxX = at.x + 0.9;
    b.minZ = at.z - 0.9;
    b.maxZ = at.z + 0.9;
    // Re-index the moved box in the world's grid.
    if (this.world.hasCollider(b)) {
      this.world.removeCollider(b);
      this.world.addCollider(b);
    }
    this.block.mesh.position.set(at.x, VAULT.y + 0.8, at.z);
  }

  resetBlock(): void {
    if (this.solved.has('plate')) return;
    this.placeBlock(this.block.home);
    this.block.anim = null;
  }

  pullLever(): void {
    if (this.solved.has('timed')) {
      this.hooks.message('The gate is already open.');
      return;
    }
    this.timer = TIMED_OPEN;
    this.sync();
    this.hooks.message('The far gate rises — run!');
  }

  openKeyChest(): void {
    if (this.solved.has('keychest')) return;
    this.solved.add('keychest');
    this.keys++;
    this.hooks.message('You found a Small Key.');
    this.hooks.gold(120, W(SPOTS.keyChest[0], SPOTS.keyChest[1]).setY(VAULT.y + 0.6));
    this.sync();
  }

  unlock(): void {
    if (this.solved.has('lock')) return;
    if (this.keys <= 0) {
      this.hooks.message('Locked. A small key would open it.');
      return;
    }
    this.keys--;
    this.solved.add('lock');
    this.hooks.message('The key turns. The door opens.');
    this.sync();
  }

  /** Doors and props from the saved progress. */
  sync(): void {
    this.setDoor('crystalDoor', this.solved.has('crystal'));
    this.setDoor('lockDoor', this.solved.has('lock'));
    this.setDoor('plateDoor', this.solved.has('plate') || this.blockOnPlate());
    this.setDoor('timedDoor', this.solved.has('timed') || this.timer > 0);
    const crystalOn = this.solved.has('crystal');
    this.crystalMat.color.setHex(crystalOn ? 0x5ae07a : 0xe04a4a);
    if (this.crystalModelMat) {
      this.crystalModelMat.color.setHex(crystalOn ? 0x5ef088 : 0xc42028);
      this.crystalModelMat.emissive.setHex(crystalOn ? 0x38d86c : 0x700c12);
      this.crystalModelMat.emissiveIntensity = crystalOn ? 0.85 : 0.30;
    }
    const opened = this.solved.has('keychest');
    if (this.keyChestLid instanceof THREE.Group) {
      this.keyChestLid.rotation.x = opened ? CHEST_ART.open : 0;
    } else {
      this.keyChestLid.rotation.x = opened ? -1.2 : 0;
      this.keyChestLid.position.set(0, opened ? 0.75 : 0.62, opened ? 0.3 : 0);
    }
    this.lever.rotation.x = this.solved.has('timed') || this.timer > 0 ? -0.6 : 0.6;
    this.brazierLight.visible = this.brazierLit;
    if (this.brazierEmberMat) {
      this.brazierEmberMat.color.setHex(this.brazierLit ? 0xff7a2a : 0x1e1c20);
      this.brazierEmberMat.emissiveIntensity = this.brazierLit ? 1.05 : 0;
    }
    if (this.modelsReady) this.brazierFlame.visible = this.brazierLit;
  }

  interactables(p: THREE.Vector3, bossDead: boolean): Interactable[] {
    if (!this.contains(p)) return [];
    const out: Interactable[] = [];
    const add = (pos: THREE.Vector3, label: string, act: () => void, radius = 2, color = '#ffd27a') => out.push({ pos, radius, label, color, act });
    add(this.spot('exitA'), 'Leave the vault', () => this.hooks.leave(), 2.2);
    if (bossDead) add(this.spot('exitG'), 'Leave the vault', () => this.hooks.leave(), 2.2, '#7be06b');
    if (!(this.solved.has('plate') && this.blockOnPlate()) && !this.block.anim) {
      add(this.blockCentre(), 'Push block', () => this.push(p), 2.0);
      add(this.spot('reset'), 'Touch the rune (reset the block)', () => this.resetBlock(), 1.6, '#8ab0e0');
    }
    if (!this.solved.has('keychest')) add(this.spot('keyChest'), 'Open chest', () => this.openKeyChest());
    if (!this.solved.has('lock')) add(this.spot('lockDoor').add(new THREE.Vector3(0, 0, 1.2)), this.keys > 0 ? 'Unlock door (Small Key)' : 'Locked door', () => this.unlock(), 2.4);
    if (this.timer <= 0) add(this.spot('lever'), 'Pull lever', () => this.pullLever(), 1.8);
    add(this.spot('brazier'), this.brazierLit ? 'Rest at the brazier' : 'Light the brazier', () => this.rest(), 2.2, '#ffa63a');
    return out;
  }

  rest(): void {
    this.brazierLit = true;
    this.sync();
    this.hooks.heal();
    this.hooks.setRespawn(this.spot('brazier').add(new THREE.Vector3(0, 0, 2.5)));
    this.hooks.message('The brazier burns. You will wake here if you fall.');
  }

  // ---------------------------------------------------------------- saving

  save(): DungeonSave {
    return { solved: [...this.solved], keys: this.keys, brazier: this.brazierLit };
  }

  load(s: DungeonSave | null | undefined): void {
    this.solved.clear();
    for (const id of s?.solved ?? []) this.solved.add(id);
    this.keys = s?.keys ?? 0;
    this.brazierLit = s?.brazier ?? false;
    this.timer = 0;
    this.placeBlock(this.solved.has('plate') ? W(SPOTS.plate[0], SPOTS.plate[1]) : this.block.home);
    this.block.anim = null;
    this.sync();
  }
}
