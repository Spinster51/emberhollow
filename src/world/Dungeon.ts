import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';
import { inArc } from '../combat/combat';
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
  mesh: THREE.Mesh;
  open: boolean;
  /** 0 = shut, 1 = sunk into the floor. */
  anim: number;
}

export interface DungeonHooks {
  message(t: string): void;
  /** Heal fully (brazier). */
  heal(): void;
  setRespawn(at: THREE.Vector3): void;
  leave(): void;
  gold(n: number, at: THREE.Vector3): void;
}

export class Dungeon {
  readonly group = new THREE.Group();
  readonly solved = new Set<string>();
  keys = 0;
  brazierLit = false;
  readonly doors = new Map<string, Door>();
  readonly block: { box: Box; mesh: THREE.Mesh; home: THREE.Vector3; anim: THREE.Vector3 | null };
  readonly boss: Enemy;
  readonly enemies: Enemy[] = [];
  /** Seconds the timed gate has left. */
  timer = 0;
  /** Wall / floor boxes (map drawing). */
  readonly walls: Box[] = [];
  private plateMesh: THREE.Mesh;
  private crystal: THREE.Mesh;
  private crystalMat: THREE.MeshBasicMaterial;
  private lever: THREE.Mesh;
  private keyChestLid: THREE.Mesh;
  private brazierFlame: THREE.Mesh;
  private countdown: HTMLDivElement;
  readonly bounds = { minX: VAULT.ox - 18, maxX: VAULT.ox + 30, minZ: VAULT.oz - 164, maxZ: VAULT.oz + 2 };

  constructor(private world: World, enemies: Enemies, hudRoot: HTMLElement, private hooks: DungeonHooks) {
    const stone = toonMaterial(0x4a433d);
    const floor = toonMaterial(0x35302b);
    const trim = toonMaterial(0x2a2521);
    // One floor slab under everything.
    const b = this.bounds;
    this.solid({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, minY: VAULT.y - 2, maxY: VAULT.y }, floor);
    for (const r of ROOMS) this.buildRoom(r, stone);
    // Torches along the walls (unlit flames, cheap).
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
    for (const r of ROOMS) {
      for (const [x, z] of [[r.x0 + 0.3, (r.z0 + r.z1) / 2], [r.x1 - 0.3, (r.z0 + r.z1) / 2]]) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 0.25), trim);
        t.position.copy(W(x, z)).setY(VAULT.y + 3);
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.2), flameMat);
        f.position.copy(t.position).setY(VAULT.y + 3.4);
        this.group.add(t, f);
      }
    }

    // Doors.
    this.addDoor('plateDoor', 0x4a6a9a, false);
    this.addDoor('crystalDoor', 0x7a4a9a, false);
    this.addDoor('lockDoor', 0xa07a3a, false);
    this.addDoor('timedDoor', 0x6a6a72, false);

    // Push block and pressure plate.
    const home = W(SPOTS.block[0], SPOTS.block[1]);
    const bm = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.6, 1.8), toonMaterial(0x7d7468));
    addOutline(bm, 0.03);
    bm.castShadow = true;
    const bbox: Box = { minX: 0, maxX: 0, minY: VAULT.y, maxY: VAULT.y + 1.6, minZ: 0, maxZ: 0, noClimb: true, zone: 'dungeon' };
    this.block = { box: bbox, mesh: bm, home, anim: null };
    this.group.add(bm);
    this.placeBlock(home);
    this.world.addCollider(bbox);
    this.plateMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 2), toonMaterial(0x6a8ab0));
    this.plateMesh.position.copy(W(SPOTS.plate[0], SPOTS.plate[1])).setY(VAULT.y + 0.06);
    const rune = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), toonMaterial(0x5a7aa0, { emissive: 0x203860, emissiveIntensity: 0.6 }));
    rune.position.copy(W(SPOTS.reset[0], SPOTS.reset[1])).setY(VAULT.y + 0.25);
    this.group.add(this.plateMesh, rune);

    // The crystal behind its railing (west wall of C).
    const rail = (minX: number, maxX: number, minZ: number, maxZ: number) =>
      this.solid({ minX: VAULT.ox + minX, maxX: VAULT.ox + maxX, minZ: VAULT.oz + minZ, maxZ: VAULT.oz + maxZ, minY: VAULT.y, maxY: VAULT.y + 1.6 }, trim);
    rail(-10, -9.5, -52, -48);
    rail(-12, -9.5, -52.5, -52);
    rail(-12, -9.5, -48, -47.5);
    this.crystalMat = new THREE.MeshBasicMaterial({ color: 0xe04a4a });
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), this.crystalMat);
    this.crystal.position.copy(this.crystalPos());
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.5), trim);
    pillar.position.copy(this.crystalPos()).setY(VAULT.y + 0.8);
    this.group.add(this.crystal, pillar);

    // Key chest (room D).
    const kc = new THREE.Group();
    kc.position.copy(W(SPOTS.keyChest[0], SPOTS.keyChest[1]));
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.6), toonMaterial(0x5a3a26));
    body.position.y = 0.28;
    this.keyChestLid = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.15, 0.64), toonMaterial(0x8aa0b0));
    this.keyChestLid.position.y = 0.62;
    kc.add(body, this.keyChestLid);
    this.group.add(kc);

    // Lever (hall E).
    const lv = new THREE.Group();
    lv.position.copy(W(SPOTS.lever[0], SPOTS.lever[1]));
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), trim);
    base.position.y = 0.2;
    this.lever = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), toonMaterial(0xc0a060));
    this.lever.position.y = 0.4;
    this.lever.geometry.translate(0, 0.55, 0);
    this.lever.rotation.x = 0.6;
    lv.add(base, this.lever);
    this.group.add(lv);

    // Brazier (room F).
    const br = new THREE.Group();
    br.position.copy(W(SPOTS.brazier[0], SPOTS.brazier[1]));
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.4, 0.9, 8), trim);
    bowl.position.y = 0.45;
    this.brazierFlame = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 6), new THREE.MeshBasicMaterial({ color: 0xff7a2a }));
    this.brazierFlame.position.y = 1.4;
    br.add(bowl, this.brazierFlame);
    this.group.add(br);

    // Way-out stairs (A) and the exit portal behind the boss (G).
    for (const [x, z] of [SPOTS.exitA, SPOTS.exitG]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 1.5), new THREE.MeshBasicMaterial({ color: 0xffe8b0 }));
      s.position.copy(W(x, z)).setY(VAULT.y + 0.05);
      this.group.add(s);
    }

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
    this.sync();
  }

  // ---------------------------------------------------------------- building

  private solid(box: Box, mat: THREE.Material): void {
    box.noClimb = true;
    box.zone = 'dungeon';
    this.world.addSolid(box, mat);
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
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.maxX - box.minX, WALL_H, box.maxZ - box.minZ), toonMaterial(color));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.set(c.x, VAULT.y + WALL_H / 2, c.z);
    this.group.add(mesh);
    const d: Door = { id, box, mesh, open: !open, anim: open ? 1 : 0 };
    this.doors.set(id, d);
    this.setDoor(id, open);
  }

  setDoor(id: string, open: boolean): void {
    const d = this.doors.get(id)!;
    if (d.open === open) return;
    d.open = open;
    if (open) this.world.removeCollider(d.box);
    else this.world.addCollider(d.box);
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
    this.plateMesh.position.y = VAULT.y + (pressed ? 0.02 : 0.06);

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
    this.countdown.style.display = this.timer > 0 ? '' : 'none';
    if (this.timer > 0) this.countdown.textContent = `Gate closing… ${this.timer.toFixed(1)}`;

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
      d.anim += ((d.open ? 1 : 0) - d.anim) * Math.min(1, dt * 6);
      d.mesh.position.y = VAULT.y + WALL_H / 2 - d.anim * (WALL_H - 0.15);
      d.mesh.visible = d.anim < 0.99;
    }
    this.crystal.rotation.y = t * (this.solved.has('crystal') ? 0.6 : 2);
    this.crystal.position.y = VAULT.y + 2.3 + Math.sin(t * 2) * 0.08;
    this.brazierFlame.scale.setScalar(this.brazierLit ? 1 + Math.sin(t * 13) * 0.08 : 0.35);
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
    this.crystalMat.color.setHex(this.solved.has('crystal') ? 0x5ae07a : 0xe04a4a);
    const opened = this.solved.has('keychest');
    this.keyChestLid.rotation.x = opened ? -1.2 : 0;
    this.keyChestLid.position.set(0, opened ? 0.75 : 0.62, opened ? 0.3 : 0);
    this.lever.rotation.x = this.solved.has('timed') ? -0.6 : 0.6;
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
