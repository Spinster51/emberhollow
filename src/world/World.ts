import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import { toonMaterial } from '../core/toon';
import { TUNING } from '../config';
import { TEST_LAYOUT, type BlockSpec, type Layout, type Region } from './layouts';

/** Axis-aligned solid block (towers, walls, crates, buildings). Every side is climbable. */
export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  /** Dungeon walls, doors and push blocks cannot be climbed (DESIGN §6). */
  noClimb?: boolean;
  /** 'dungeon' boxes are left off the overworld map. */
  zone?: string;
}

/** A block added from the layout: its collider, its procedural mesh (and cap), and the layout's art tag. */
export interface LayoutBlock {
  spec: BlockSpec;
  box: Box;
  mesh: THREE.Mesh;
  cap: THREE.Mesh | null;
}

/** A tree spot from the scatter (the procedural trees, and the models that replace them). */
export interface TreeSpot {
  x: number;
  y: number;
  z: number;
  /** Scale of the old tree (0.8–1.4). */
  k: number;
  rot: number;
}

export interface WallHit {
  /** Horizontal outward normal of the wall. */
  normal: THREE.Vector3;
  /** Height of the top of the obstacle at this point (used for vaulting). */
  top: number;
  box: Box | null;
}

const RES = 1;
/** Terrain chunk size in cells: 100 m keeps the terrain to a few dozen draw calls on the 600 m map. */
const CHUNK = 100;
const CELL = 16;

/**
 * Heightmap terrain plus solid blocks, built from a layout (the small test map or the 600 m
 * main map). Height queries match the rendered triangles exactly. The terrain is split into
 * 100 m chunks so the camera's far plane culls distant ground.
 */
export class World {
  readonly size: number;
  readonly half: number;
  readonly limit: number;
  private readonly n: number;
  readonly heights: Float32Array;
  readonly boxes: Box[] = [];
  /** Boxes by 16 m grid cell (each box is listed in every cell it overlaps, plus a margin). */
  private grid = new Map<number, Box[]>();
  readonly group = new THREE.Group();
  readonly spawn: THREE.Vector3;
  readonly homeSite: THREE.Vector3;
  /** Layout blocks with their meshes (the world models replace the boxes' look, never the colliders). */
  readonly blocks: LayoutBlock[] = [];
  /** Tree spots, and the procedural trees drawn there until (or unless) the tree models load. */
  readonly trees: TreeSpot[] = [];
  readonly treeMeshes: THREE.InstancedMesh[] = [];
  /** Spots ground cover and rocks keep clear of: [x, z, radius] (campfires, chests, the dungeon gate). */
  readonly scatterAvoid: [number, number, number][] = [];
  /** Spots trees keep clear of: [x, z, radius] (campfires, chests, enemy camps, dungeon gate, home). */
  readonly treeAvoid: [number, number, number][] = [];
  /** Clustered enemy camp centres: [x, z] (bushes and trees keep clear so camps read cleanly). */
  readonly campCentres: [number, number][] = [];

  constructor(readonly layout: Layout = TEST_LAYOUT) {
    this.size = layout.size;
    this.half = layout.size / 2;
    this.limit = this.half - 8;
    this.n = this.size / RES + 1;
    const N = this.n;
    this.heights = new Float32Array(N * N);
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        this.heights[iz * N + ix] = layout.shape(ix * RES - this.half, iz * RES - this.half);
      }
    }
    this.spawn = new THREE.Vector3(layout.spawn[0], 0, layout.spawn[1]);
    this.homeSite = new THREE.Vector3(layout.homeSite[0], 0, layout.homeSite[1]);
    this.addBlocks();
    this.spawn.y = this.groundAt(this.spawn.x, this.spawn.z, 1e9);
    this.buildTerrain();
    for (const c of layout.campfires) {
      this.scatterAvoid.push([c.x, c.z, 3.5]);
      this.treeAvoid.push([c.x, c.z, 6.5]);
    }
    for (const c of layout.chests) {
      this.scatterAvoid.push([c.x, c.z, 3.0]);
      this.treeAvoid.push([c.x, c.z, 6.5]);
    }
    if (layout.dungeon) {
      this.scatterAvoid.push([layout.dungeon[0], layout.dungeon[1] + 3, 11]);
      this.treeAvoid.push([layout.dungeon[0], layout.dungeon[1] + 3, 13]);
    }
    const clusters: { kind: string; x: number; z: number; n: number }[] = [];
    for (const c of layout.camps) {
      const near = clusters.find((o) => o.kind === c.kind && Math.hypot(o.x / o.n - c.x, o.z / o.n - c.z) < 7);
      if (near) {
        near.x += c.x;
        near.z += c.z;
        near.n++;
      } else clusters.push({ kind: c.kind, x: c.x, z: c.z, n: 1 });
    }
    for (const cl of clusters) {
      const cx = cl.x / cl.n;
      const cz = cl.z / cl.n;
      this.campCentres.push([cx, cz]);
      this.treeAvoid.push([cx, cz, 13.5]);
    }
    this.treeAvoid.push([layout.homeSite[0], layout.homeSite[1], 14]);
    this.scatterTrees();
  }

  regionAt(x: number, z: number): Region {
    return this.layout.region(x, z);
  }

  private addBlocks(): void {
    const mats = new Map<number, THREE.Material>();
    const cap = toonMaterial(0x7d6e60);
    for (const s of this.layout.blocks((x, z) => this.heightAt(x, z))) {
      const minX = s.cx - s.w / 2;
      const maxX = s.cx + s.w / 2;
      const minZ = s.cz - s.d / 2;
      const maxZ = s.cz + s.d / 2;
      let base = s.base;
      if (base === undefined) {
        base = Infinity;
        for (const [x, z] of [[minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ], [s.cx, s.cz]]) {
          base = Math.min(base, this.heightAt(x, z));
        }
      }
      const sink = s.base === undefined ? (s.sink ?? 1) : 0;
      const box: Box = { minX, maxX, minZ, maxZ, minY: base - sink, maxY: base + s.h };
      const color = s.color ?? 0xa59a8c;
      if (!mats.has(color)) mats.set(color, toonMaterial(color));
      const m = this.addSolid(box, mats.get(color)!);
      let top: THREE.Mesh | null = null;
      if (s.cap !== false && s.color === undefined) {
        top = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.2, 0.25, s.d + 0.2), cap);
        top.position.set(m.position.x, box.maxY - 0.1, m.position.z);
        top.castShadow = true;
        this.group.add(top);
      }
      this.blocks.push({ spec: s, box, mesh: m, cap: top });
    }
  }

  /** Add a solid block after construction (buildings). Every side is climbable, like other boxes. */
  addSolid(box: Box, material: THREE.Material): THREE.Mesh {
    this.addCollider(box);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ),
      material,
    );
    m.position.set((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2);
    m.castShadow = m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  /** Collision only (the caller draws it): doors and push blocks that move. */
  addCollider(box: Box): void {
    this.boxes.push(box);
    for (let ix = Math.floor((box.minX - 1) / CELL); ix <= Math.floor((box.maxX + 1) / CELL); ix++) {
      for (let iz = Math.floor((box.minZ - 1) / CELL); iz <= Math.floor((box.maxZ + 1) / CELL); iz++) {
        const key = ix * 100003 + iz;
        let list = this.grid.get(key);
        if (!list) this.grid.set(key, (list = []));
        list.push(box);
      }
    }
  }

  /** Remove a block added with addSolid (doors that open). */
  removeSolid(box: Box, mesh: THREE.Object3D): void {
    this.removeCollider(box);
    this.group.remove(mesh);
  }

  removeCollider(box: Box): void {
    const i = this.boxes.indexOf(box);
    if (i >= 0) this.boxes.splice(i, 1);
    for (const list of this.grid.values()) {
      const j = list.indexOf(box);
      if (j >= 0) list.splice(j, 1);
    }
  }

  /** Is a collider currently in the world? */
  hasCollider(box: Box): boolean {
    return this.boxes.includes(box);
  }

  /** Boxes that might touch a point (within ~1 m). */
  private boxesAt(x: number, z: number): Box[] {
    return this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) ?? [];
  }

  /** Terrain height, exactly matching the mesh triangles. */
  heightAt(x: number, z: number): number {
    const N = this.n;
    const gx = Math.min(N - 1.0001, Math.max(0, (x + this.half) / RES));
    const gz = Math.min(N - 1.0001, Math.max(0, (z + this.half) / RES));
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const h00 = this.heights[iz * N + ix];
    const h10 = this.heights[iz * N + ix + 1];
    const h01 = this.heights[(iz + 1) * N + ix];
    const h11 = this.heights[(iz + 1) * N + ix + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /** Uphill gradient of the terrain (dh/dx, dh/dz). */
  gradientAt(x: number, z: number, out = new THREE.Vector2()): THREE.Vector2 {
    const e = 0.15;
    return out.set(
      (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e),
      (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e),
    );
  }

  slopeAt(x: number, z: number): number {
    return this.gradientAt(x, z).length();
  }

  /** Highest standable surface under (x, z) that is not above the given feet height (plus step-up). */
  groundAt(x: number, z: number, feetY: number): number {
    let h = this.heightAt(x, z);
    const r = TUNING.radius * 0.5;
    for (const b of this.boxesAt(x, z)) {
      if (x < b.minX - r || x > b.maxX + r || z < b.minZ - r || z > b.maxZ + r) continue;
      if (feetY >= b.maxY - TUNING.stepUp - 0.01) h = Math.max(h, b.maxY);
    }
    return h;
  }

  /**
   * Push a capsule out of any box it overlaps. Returns the box wall it touched, if any.
   */
  resolveBoxes(p: THREE.Vector3, radius: number, height: number): WallHit | null {
    let hit: WallHit | null = null;
    for (const b of this.boxesAt(p.x, p.z)) {
      if (p.y >= b.maxY - 0.05 || p.y + height <= b.minY) continue;
      const cx = Math.min(b.maxX, Math.max(b.minX, p.x));
      const cz = Math.min(b.maxZ, Math.max(b.minZ, p.z));
      let dx = p.x - cx;
      let dz = p.z - cz;
      const d = Math.hypot(dx, dz);
      if (d >= radius) continue;
      const n = new THREE.Vector3();
      if (d > 1e-5) {
        dx /= d;
        dz /= d;
        // Snap to the dominant face so climbing has a clean normal.
        if (Math.abs(dx) > Math.abs(dz)) n.set(Math.sign(dx), 0, 0);
        else n.set(0, 0, Math.sign(dz));
        p.x = cx + dx * radius;
        p.z = cz + dz * radius;
      } else {
        // Centre is inside the box: leave by the nearest face.
        const pen = [
          [p.x - b.minX, -1, 0],
          [b.maxX - p.x, 1, 0],
          [p.z - b.minZ, 0, -1],
          [b.maxZ - p.z, 0, 1],
        ].sort((a, c) => a[0] - c[0])[0];
        n.set(pen[1], 0, pen[2]);
        if (n.x) p.x = n.x > 0 ? b.maxX + radius : b.minX - radius;
        else p.z = n.z > 0 ? b.maxZ + radius : b.minZ - radius;
      }
      hit = { normal: n, top: b.maxY, box: b };
    }
    return hit;
  }

  /** Is the terrain at (x, z) a wall rising above the given height? */
  terrainWall(x: number, z: number, aboveY: number): WallHit | null {
    const h = this.heightAt(x, z);
    if (h <= aboveY) return null;
    const g = this.gradientAt(x, z);
    if (g.length() < TUNING.maxWalkSlope) return null;
    const n = new THREE.Vector3(-g.x, 0, -g.y).normalize();
    // Look a little further in to estimate how tall the obstacle is.
    let top = h;
    for (let i = 1; i <= 6; i++) {
      top = Math.max(top, this.heightAt(x - n.x * 0.4 * i, z - n.z * 0.4 * i));
    }
    return { normal: n, top, box: null };
  }

  /** True if the point is inside the terrain or a box (with a margin), for camera collision. */
  isSolid(p: THREE.Vector3, margin = 0.3): boolean {
    if (this.heightAt(p.x, p.z) + margin > p.y) return true;
    for (const b of this.boxesAt(p.x, p.z)) {
      if (
        p.x > b.minX - margin && p.x < b.maxX + margin &&
        p.y > b.minY - margin && p.y < b.maxY + margin &&
        p.z > b.minZ - margin && p.z < b.maxZ + margin
      ) return true;
    }
    return false;
  }

  clampToWorld(p: THREE.Vector3): void {
    p.x = Math.max(-this.limit, Math.min(this.limit, p.x));
    p.z = Math.max(-this.limit, Math.min(this.limit, p.z));
  }

  /** Terrain in chunks, with normals from the heightmap so chunk edges match. */
  private buildTerrain(): void {
    this.group.add(...this.terrainChunks(CHUNK));
  }

  /** The terrain meshes in square chunks of `size` cells (tests compare chunk sizes). */
  terrainChunks(size: number): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    const CHUNK = size;
    const N = this.n;
    const mat = toonMaterial(0xffffff, { vertexColors: true });
    const c = new THREE.Color();
    const cells = N - 1;
    for (let cz0 = 0; cz0 < cells; cz0 += CHUNK) {
      for (let cx0 = 0; cx0 < cells; cx0 += CHUNK) {
        const w = Math.min(CHUNK, cells - cx0) + 1;
        const d = Math.min(CHUNK, cells - cz0) + 1;
        const positions = new Float32Array(w * d * 3);
        const normals = new Float32Array(w * d * 3);
        const colors = new Float32Array(w * d * 3);
        for (let j = 0; j < d; j++) {
          for (let i = 0; i < w; i++) {
            const ix = cx0 + i;
            const iz = cz0 + j;
            const x = ix * RES - this.half;
            const z = iz * RES - this.half;
            const h = this.heights[iz * N + ix];
            const k = (j * w + i) * 3;
            positions[k] = x;
            positions[k + 1] = h;
            positions[k + 2] = z;
            const hx = this.heights[iz * N + Math.min(N - 1, ix + 1)] - this.heights[iz * N + Math.max(0, ix - 1)];
            const hz = this.heights[Math.min(N - 1, iz + 1) * N + ix] - this.heights[Math.max(0, iz - 1) * N + ix];
            const nl = Math.hypot(hx, 2 * RES, hz);
            normals[k] = -hx / nl;
            normals[k + 1] = (2 * RES) / nl;
            normals[k + 2] = -hz / nl;
            this.layout.colour(x, z, h, this.slopeAt(x, z), c);
            colors[k] = c.r;
            colors[k + 1] = c.g;
            colors[k + 2] = c.b;
          }
        }
        const index: number[] = [];
        for (let j = 0; j < d - 1; j++) {
          for (let i = 0; i < w - 1; i++) {
            const a = j * w + i;
            const b = a + 1;
            const dd = a + w;
            const e = dd + 1;
            // Same split as heightAt: (00,01,10) and (10,01,11).
            index.push(a, dd, b, b, dd, e);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.setIndex(index);
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        mesh.name = 'terrain';
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        out.push(mesh);
      }
    }
    return out;
  }

  private scatterTrees(): void {
    const rand = mulberry32(42);
    const max = this.layout.maxTrees;
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 1.6, 6);
    const leafGeo = new THREE.ConeGeometry(1.2, 2.8, 7);
    const trunks = new THREE.InstancedMesh(trunkGeo, toonMaterial(0x6b4a2b), max);
    const leaves = new THREE.InstancedMesh(leafGeo, toonMaterial(0xffffff), max);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const tint = new THREE.Color();
    let count = 0;
    const span = this.limit * 2 - 10;
    for (let tries = 0; tries < max * 12 && count < max; tries++) {
      const x = (rand() - 0.5) * span;
      const z = (rand() - 0.5) * span;
      const y = this.heightAt(x, z);
      if (rand() > this.layout.treeDensity(x, z, y)) continue;
      if (this.slopeAt(x, z) > 0.5) continue;
      if (this.groundAt(x, z, 1e9) - y > 0.1) continue; // not on boxes
      if (this.treeAvoid.some(([ax, az, ar]) => (x - ax) ** 2 + (z - az) ** 2 < ar * ar)) continue;
      const k = 0.8 + rand() * 0.6;
      const rot = rand() * Math.PI;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      this.trees.push({ x, y, z, k, rot });
      s.set(k, k, k);
      m.compose(new THREE.Vector3(x, y + 0.8 * k, z), q, s);
      trunks.setMatrixAt(count, m);
      m.compose(new THREE.Vector3(x, y + (1.6 + 1.2) * k, z), q, s);
      leaves.setMatrixAt(count, m);
      const region = this.layout.region(x, z).id;
      tint.setHex(region === 'forest' ? 0x24522d : region === 'ruins' ? 0x6b6a3a : 0x2f6b3a);
      leaves.setColorAt(count, tint);
      count++;
    }
    trunks.count = leaves.count = count;
    trunks.castShadow = leaves.castShadow = true;
    trunks.name = leaves.name = 'trees:procedural';
    this.treeMeshes.push(trunks, leaves);
    this.group.add(trunks, leaves);
  }
}
