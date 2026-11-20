import * as THREE from 'three';
import { shellMaterial } from '../core/toon';
import { pieceParts } from './worldModels';
import type { Box } from './World';

/**
 * Building kit (milestone 8): unit pieces from the world file (plaster, stone, timber, shingles, windows,
 * doors, column drums, ruin wall segments...) stretched and placed onto the collider boxes, then merged
 * into one mesh per material. Colliders never change: every face a player can climb stays within about
 * 0.15 m of its box.
 */

type UvMap = (u: number, v: number) => [number, number];

interface Acc {
  material: THREE.Material;
  pos: number[];
  nrm: number[];
  uv: number[];
  idx: number[];
}

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const nm = new THREE.Matrix3();

export class KitBuilder {
  private acc = new Map<THREE.Material, Acc>();
  /** Pieces the file lacked (a stale file); the caller keeps the old look if any. */
  readonly missing = new Set<string>();

  constructor(private file?: string) {}

  /** Add a piece transformed by `m` (UVs optionally moved to another palette cell). */
  add(name: string, m: THREE.Matrix4, uvMap?: UvMap): void {
    const ps = pieceParts(name, this.file);
    if (!ps) {
      this.missing.add(name);
      return;
    }
    nm.getNormalMatrix(m);
    for (const p of ps) {
      let a = this.acc.get(p.material);
      if (!a) this.acc.set(p.material, (a = { material: p.material, pos: [], nrm: [], uv: [], idx: [] }));
      const g = p.geometry;
      const P = g.getAttribute('position');
      const N = g.getAttribute('normal');
      const U = g.getAttribute('uv');
      const base = a.pos.length / 3;
      for (let i = 0; i < P.count; i++) {
        tmpV.fromBufferAttribute(P, i).applyMatrix4(m);
        a.pos.push(tmpV.x, tmpV.y, tmpV.z);
        tmpN.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        a.nrm.push(tmpN.x, tmpN.y, tmpN.z);
        const u = U.getX(i);
        const v = U.getY(i);
        if (uvMap) a.uv.push(...uvMap(u, v));
        else a.uv.push(u, v);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) a.idx.push(base + g.index.getX(i));
      else for (let i = 0; i < P.count; i++) a.idx.push(base + i);
    }
  }

  get empty(): boolean {
    return this.acc.size === 0;
  }

  /** The merged meshes (one per material) in a group, with an optional outline shell and sun shadows. */
  build(name: string, opts: { outline?: number; shadow?: boolean; receive?: boolean } = {}): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    for (const a of this.acc.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(a.nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
      geo.setIndex(a.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(a.idx, 1) : new THREE.Uint16BufferAttribute(a.idx, 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, a.material);
      mesh.name = `${name}:${a.material.name}`;
      mesh.castShadow = opts.shadow ?? true;
      mesh.receiveShadow = opts.receive ?? true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      g.add(mesh);
      if (opts.outline) {
        const o = new THREE.Mesh(geo, shellMaterial(opts.outline));
        o.name = `${mesh.name}_outline`;
        o.raycast = () => {};
        o.matrixAutoUpdate = false;
        o.updateMatrix();
        mesh.add(o);
      }
    }
    g.matrixAutoUpdate = false;
    g.updateMatrix();
    this.acc.clear();
    return g;
  }
}

// ---------------------------------------------------------------- transforms

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Translate · yaw · scale. */
export function trs(x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  Q.setFromAxisAngle(UP, yaw);
  return M.clone().compose(new THREE.Vector3(x, y, z), Q, new THREE.Vector3(sx, sy, sz));
}

/** A unit box piece (1 m cube, origin at its bottom centre) stretched to fill a box. */
export function fill(k: KitBuilder, piece: string, b: Box, uvMap?: UvMap): void {
  k.add(piece, trs((b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2, 0, b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ), uvMap);
}

/** The four sides of a box footprint: start corner, unit direction along the side, its length, outward yaw. */
export interface Side {
  x: number;
  z: number;
  dx: number;
  dz: number;
  len: number;
  /** Yaw that turns a piece's +z (out of the wall) to this side's outward normal. */
  yaw: number;
  /** Outward normal. */
  nx: number;
  nz: number;
}

export function sides(minX: number, maxX: number, minZ: number, maxZ: number): Side[] {
  return [
    { x: minX, z: maxZ, dx: 1, dz: 0, len: maxX - minX, yaw: 0, nx: 0, nz: 1 }, // south (+z)
    { x: maxX, z: maxZ, dx: 0, dz: -1, len: maxZ - minZ, yaw: Math.PI / 2, nx: 1, nz: 0 }, // east (+x)
    { x: maxX, z: minZ, dx: -1, dz: 0, len: maxX - minX, yaw: Math.PI, nx: 0, nz: -1 }, // north (-z)
    { x: minX, z: minZ, dx: 0, dz: 1, len: maxZ - minZ, yaw: -Math.PI / 2, nx: -1, nz: 0 }, // west (-x)
  ];
}

/** Place a piece on a side at distance `t` along it, height y, `out` metres off the face. */
export function onSide(k: KitBuilder, piece: string, s: Side, t: number, y: number, sx = 1, sy = 1, sz = 1, out = 0, uvMap?: UvMap): void {
  k.add(piece, trs(s.x + s.dx * t + s.nx * out, y, s.z + s.dz * t + s.nz * out, s.yaw, sx, sy, sz), uvMap);
}

/** Tile a 1 m strip piece along a side in whole segments, each stretched to fit. */
export function strip(k: KitBuilder, piece: string, s: Side, y: number, sy = 1, from = 0, to = s.len, unit = 1, uvMap?: UvMap): void {
  const len = to - from;
  if (len <= 0.05) return;
  const n = Math.max(1, Math.round(len / unit));
  const w = len / n;
  for (let i = 0; i < n; i++) onSide(k, piece, s, from + w * (i + 0.5), y, w / unit, sy, 1, 0, uvMap);
}

/** Small deterministic hash of a position (0..1), for variety that never changes between loads. */
export function hash2(x: number, z: number, salt = 0): number {
  const s = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------------------------------------------------------- palette cell moves (variety without new pieces)

/** Atlas quadrants (pack palettes, 8 x 4 cells each): Forest top-left, Hex top-right, Dungeon bottom-left, Halloween bottom-right. */
const QUAD = { F: [0, 0.5], X: [0.5, 0.5], D: [0, 0], H: [0.5, 0] } as const;

/** Move UVs inside one pack's palette quadrant by whole cells (optionally only from some cells). */
export function cellShift(pack: keyof typeof QUAD, dc: number, dr: number, only?: (col: number, row: number) => boolean): UvMap {
  const [ox, oy] = QUAD[pack];
  return (u, v) => {
    if (u < ox || u >= ox + 0.5 || v < oy || v >= oy + 0.5) return [u, v];
    const col = Math.floor((u - ox) * 16);
    const row = Math.floor((oy + 0.5 - v) * 8);
    if (only && !only(col, row)) return [u, v];
    return [u + dc / 16, v - dr / 8];
  };
}

/** Move UVs inside the hex palette quadrant (the kit's colours) by whole cells. */
export function hexShift(dc: number, dr: number, only?: (col: number, row: number) => boolean): UvMap {
  return cellShift('X', dc, dr, only);
}

// ---------------------------------------------------------------- buildings

export interface HouseBoxes {
  walls: Box;
  eave: Box;
  roof: Box;
}

/**
 * A timber-framed town house fitted to its three colliders: plaster walls on a stone footing, corner and
 * panel posts, beams, windows (a door on the side facing `door`), a shingled eave on the lower roof slab
 * and a shingled mansard on the upper one.
 */
export function house(k: KitBuilder, h: HouseBoxes, ground: number, door: { x: number; z: number }, roofMap?: UvMap, wallMap?: UvMap): void {
  const w = h.walls;
  fill(k, 'KitPlaster', w, wallMap);
  const ss = sides(w.minX, w.maxX, w.minZ, w.maxZ);
  const top = w.maxY;
  // The side whose outward normal points most toward the door target gets the door.
  const cx = (w.minX + w.maxX) / 2;
  const cz = (w.minZ + w.maxZ) / 2;
  let doorSide = 0;
  let best = -Infinity;
  ss.forEach((s, i) => {
    const d = s.nx * (door.x - cx) + s.nz * (door.z - cz);
    if (d > best) {
      best = d;
      doorSide = i;
    }
  });
  ss.forEach((s, i) => {
    const panels = Math.max(2, Math.round(s.len / 2.6));
    const pw = s.len / panels;
    const doorPanel = i === doorSide ? Math.floor(panels / 2) : -1;
    // Footing, skipping the door's panel.
    if (doorPanel >= 0) {
      strip(k, 'KitBase', s, ground - 0.15, 1, 0, doorPanel * pw, 2);
      strip(k, 'KitBase', s, ground - 0.15, 1, (doorPanel + 1) * pw, s.len, 2);
    } else strip(k, 'KitBase', s, ground - 0.15, 1, 0, s.len, 2);
    // Beams: sill, lintel line, top plate.
    for (const y of [ground + 0.62, ground + 3.0, top - 0.12]) onSide(k, 'KitBeam', s, s.len / 2, y, s.len, 1, 1);
    // Panel posts (corner posts below).
    for (let p = 1; p < panels; p++) onSide(k, 'KitPost', s, p * pw, ground + 0.5, 1, top - ground - 0.5, 1);
    for (let p = 0; p < panels; p++) {
      const t = (p + 0.5) * pw;
      if (p === doorPanel) {
        onSide(k, 'KitDoor', s, t, ground, 1, 1, 1);
        onSide(k, 'KitLamp', s, t + 0.95, ground + 2.5, 1, 1, 1);
      } else if (pw > 1.9) onSide(k, 'KitWindow', s, t, ground + 1.9, Math.min(1, (pw - 0.3) / 1.74), 1, 1);
    }
  });
  for (const [x, z] of [[w.minX, w.minZ], [w.maxX, w.minZ], [w.minX, w.maxZ], [w.maxX, w.maxZ]]) {
    k.add('KitPost', trs(x, ground - 0.1, z, 0, 1.15, top - ground + 0.1, 1.15));
  }
  roofOn(k, h.eave, h.roof, roofMap);
}

/**
 * Roof on two stacked slabs: the lower slab (eave) as a timber fascia and soffit with shingles over its
 * exposed ring, the upper slab with shingled sides, corner posts, shingles on top and a ridge.
 */
export function roofOn(k: KitBuilder, eave: Box, roof: Box, roofMap?: UvMap): void {
  fill(k, 'KitTimber', eave);
  const y = eave.maxY;
  // Ring strips between the upper slab's footprint and the eave's edge (rows run along each side).
  const rings: [number, number, number, number, number][] = [
    // [cx, cz, along, depth, yaw]
    [(roof.minX + roof.maxX) / 2, (roof.maxZ + eave.maxZ) / 2, roof.maxX - roof.minX, eave.maxZ - roof.maxZ, 0],
    [(roof.minX + roof.maxX) / 2, (roof.minZ + eave.minZ) / 2, roof.maxX - roof.minX, roof.minZ - eave.minZ, Math.PI],
    [(roof.maxX + eave.maxX) / 2, (roof.minZ + roof.maxZ) / 2, roof.maxZ - roof.minZ, eave.maxX - roof.maxX, Math.PI / 2],
    [(roof.minX + eave.minX) / 2, (roof.minZ + roof.maxZ) / 2, roof.maxZ - roof.minZ, roof.minX - eave.minX, -Math.PI / 2],
  ];
  for (const [cx, cz, along, depth, yaw] of rings) k.add('KitShingles', trs(cx, y, cz, yaw, along, 1, depth), roofMap);
  // Corner squares.
  for (const [x0, x1, z0, z1, yaw] of [
    [roof.maxX, eave.maxX, roof.maxZ, eave.maxZ, 0], [eave.minX, roof.minX, roof.maxZ, eave.maxZ, 0],
    [roof.maxX, eave.maxX, eave.minZ, roof.minZ, Math.PI], [eave.minX, roof.minX, eave.minZ, roof.minZ, Math.PI],
  ] as [number, number, number, number, number][]) {
    k.add('KitShingles', trs((x0 + x1) / 2, y, (z0 + z1) / 2, yaw, x1 - x0, 1, z1 - z0), roofMap);
  }
  fill(k, 'KitRoof', roof, roofMap);
  const rh = roof.maxY - roof.minY;
  for (const s of sides(roof.minX, roof.maxX, roof.minZ, roof.maxZ)) {
    strip(k, 'KitShingleSide', s, roof.minY, rh, 0, s.len, 2, roofMap);
  }
  for (const [x, z] of [[roof.minX, roof.minZ], [roof.maxX, roof.minZ], [roof.minX, roof.maxZ], [roof.maxX, roof.maxZ]]) {
    k.add('KitPost', trs(x, roof.minY, z, 0, 0.9, rh + 0.04, 0.9));
  }
  const alongX = roof.maxX - roof.minX >= roof.maxZ - roof.minZ;
  const cx = (roof.minX + roof.maxX) / 2;
  const cz = (roof.minZ + roof.maxZ) / 2;
  // Top: shingle patches about 2 m deep each, running along the ridge.
  const along = alongX ? roof.maxX - roof.minX : roof.maxZ - roof.minZ;
  const across = alongX ? roof.maxZ - roof.minZ : roof.maxX - roof.minX;
  const rows = Math.max(1, Math.round(across / 2.0));
  for (let i = 0; i < rows; i++) {
    const off = -across / 2 + (across / rows) * (i + 0.5);
    k.add('KitShingles', trs(cx + (alongX ? 0 : off), roof.maxY, cz + (alongX ? off : 0), alongX ? 0 : Math.PI / 2, along, 0.6, across / rows), roofMap);
  }
  k.add('KitRidge', trs(cx, roof.maxY - 0.03, cz, alongX ? 0 : Math.PI / 2, (alongX ? roof.maxX - roof.minX : roof.maxZ - roof.minZ) + 0.1, 1, 1));
}

// ---------------------------------------------------------------- ruins, gate, well, test blocks

/** A square ruin column on its 1.4 m collider: plinth, drums with joints, a capital or a broken top. */
export function column(k: KitBuilder, b: Box, ground: number): void {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const sx = (b.maxX - b.minX) / 1.4;
  const sz = (b.maxZ - b.minZ) / 1.4;
  const broken = hash2(cx, cz) < 0.55;
  const plinth = Math.max(b.minY, ground - 0.25);
  k.add('ColBase', trs(cx, plinth, cz, 0, sx, 1, sz));
  const capH = broken ? 0.25 : 0.4;
  const y0 = plinth + 0.58;
  const y1 = b.maxY - capH + 0.02;
  if (y1 > y0) {
    k.add('ColShaft', trs(cx, y0, cz, 0, sx, y1 - y0, sz));
    const n = Math.floor((y1 - y0) / 1.6);
    for (let i = 1; i <= n; i++) k.add('ColJoint', trs(cx, y0 + (i * (y1 - y0)) / (n + 1) - 0.04, cz, 0, sx, 1, sz));
  }
  if (broken) k.add('ColBroken', trs(cx, b.maxY, cz, hash2(cx, cz, 1) * 6.28, sx, 1, sz));
  else k.add('ColTop', trs(cx, b.maxY - 0.4, cz, 0, sx, 1, sz));
}

/** A ruin wall: KayKit dungeon wall segments (4 x 1 x 4 m) stretched along the collider, with a sandstone core so ends are solid. */
export function wallSegments(k: KitBuilder, b: Box, uvMap?: UvMap): void {
  const alongX = b.maxX - b.minX >= b.maxZ - b.minZ;
  const len = alongX ? b.maxX - b.minX : b.maxZ - b.minZ;
  const thick = alongX ? b.maxZ - b.minZ : b.maxX - b.minX;
  const n = Math.max(1, Math.round(len / 4));
  const seg = len / n;
  const h = b.maxY - b.minY;
  fill(k, 'KitSand', {
    minX: b.minX + 0.08, maxX: b.maxX - 0.08,
    minY: b.minY, maxY: b.maxY - 0.05,
    minZ: b.minZ + 0.08, maxZ: b.maxZ - 0.08,
  }, uvMap);
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + seg * (i + 0.5);
    const x = alongX ? (b.minX + b.maxX) / 2 + t : (b.minX + b.maxX) / 2;
    const z = alongX ? (b.minZ + b.maxZ) / 2 : (b.minZ + b.maxZ) / 2 + t;
    k.add('RuinWall', trs(x, b.minY, z, alongX ? 0 : Math.PI / 2, seg / 4, h / 4, thick), uvMap);
  }
}

/** A piece designed at its collider's size, stretched in height to the box (origin at the bottom centre). */
export function fitted(k: KitBuilder, piece: string, b: Box, designH: number, yaw = 0): void {
  k.add(piece, trs((b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2, yaw, 1, (b.maxY - b.minY) / designH, 1));
}

/** A dressed stone block (test-map tower, wall and block): stone body, joint bands, a coping on top. */
export function stoneBlock(k: KitBuilder, b: Box, ground: number): void {
  fill(k, 'KitStone', b);
  const ss = sides(b.minX, b.maxX, b.minZ, b.maxZ);
  for (const s of ss) {
    strip(k, 'KitBase', s, Math.max(b.minY, ground - 0.15), 1, 0, s.len, 1);
    for (let y = ground + 2; y < b.maxY - 0.6; y += 2) onSide(k, 'KitBeam', s, s.len / 2, y, s.len, 0.6, 0.5, 0, hexShift(-4, -1));
  }
  for (const [x, z] of [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]]) {
    k.add('KitPost', trs(x, ground, z, 0, 0.9, b.maxY - ground, 0.9), hexShift(-5, -1));
  }
  k.add('KitGrey', trs((b.minX + b.maxX) / 2, b.maxY - 0.22, (b.minZ + b.maxZ) / 2, 0, b.maxX - b.minX + 0.16, 0.22, b.maxZ - b.minZ + 0.16));
}

/** A crate stretched to its collider (test-map crates). */
export function crateBlock(k: KitBuilder, b: Box): void {
  // CrateBig is 0.95 m on each side.
  k.add('CrateBig', trs((b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2, 0, (b.maxX - b.minX) / 0.95, (b.maxY - b.minY) / 0.95, (b.maxZ - b.minZ) / 0.95));
}
