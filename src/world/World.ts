import * as THREE from 'three';
import { fbm, mulberry32, smoothstep } from '../core/noise';
import { toonMaterial } from '../core/toon';
import { TUNING } from '../config';

/** Axis-aligned solid block (towers, walls, crates). Every side is climbable. */
export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface WallHit {
  /** Horizontal outward normal of the wall. */
  normal: THREE.Vector3;
  /** Height of the top of the obstacle at this point (used for vaulting). */
  top: number;
  box: Box | null;
}

const SIZE = 256;
const RES = 1;
const N = SIZE / RES + 1;
const HALF = SIZE / 2;
export const WORLD_LIMIT = HALF - 8;

/**
 * Milestone-1 test map: rolling hills, a cliff plateau, a climbable mountain, a stone pillar
 * and some blocks. Height queries match the rendered triangles exactly.
 */
export class World {
  readonly heights = new Float32Array(N * N);
  readonly boxes: Box[] = [];
  readonly group = new THREE.Group();
  readonly spawn = new THREE.Vector3(0, 0, 12);
  /** Where the test home base stands (kept free of trees). */
  readonly homeSite = new THREE.Vector3(12, 0, -4);

  constructor() {
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        this.heights[iz * N + ix] = this.shape(ix * RES - HALF, iz * RES - HALF);
      }
    }
    this.addBoxes();
    this.spawn.y = this.groundAt(this.spawn.x, this.spawn.z, 1e9);
    this.buildTerrainMesh();
    this.buildBoxMeshes();
    this.scatterTrees();
  }

  /** Analytic height used only to fill the grid. */
  private shape(x: number, z: number): number {
    let h = fbm(x * 0.025, z * 0.025, 4, 3) * 6 - 2;

    // Plateau with sheer cliffs, ~12 m tall.
    const dp = Math.hypot(x - 45, z + 20);
    h += (11 + fbm(x * 0.1, z * 0.1, 2, 9) * 1.5) * (1 - smoothstep(20, 23, dp));

    // Mountain: gentle at the base, steep near the peak.
    const dm = Math.hypot(x + 55, z + 50);
    const t = Math.max(0, 1 - dm / 48);
    h += 42 * Math.pow(t, 1.7) * (0.85 + 0.3 * fbm(x * 0.06, z * 0.06, 3, 5));

    // Narrow rock spire.
    const ds = Math.hypot(x - 10, z - 45);
    h += 24 * (1 - smoothstep(4, 6.5, ds));

    // Raised rim at the world edge.
    const de = Math.max(Math.abs(x), Math.abs(z));
    h += Math.max(0, de - (HALF - 20)) * 2.5;
    return h;
  }

  private addBoxes(): void {
    const add = (cx: number, cz: number, w: number, d: number, height: number) => {
      const minX = cx - w / 2;
      const maxX = cx + w / 2;
      const minZ = cz - d / 2;
      const maxZ = cz + d / 2;
      let base = Infinity;
      for (const [x, z] of [
        [minX, minZ],
        [maxX, minZ],
        [minX, maxZ],
        [maxX, maxZ],
        [cx, cz],
      ]) {
        base = Math.min(base, this.heightAt(x, z));
      }
      this.boxes.push({ minX, maxX, minZ, maxZ, minY: base - 1, maxY: base + height });
    };
    add(-22, 28, 6, 6, 18); // stone tower (climbable on one full stamina bar)
    add(20, 8, 14, 1.5, 6); // wall
    add(4, 2, 1.6, 1.6, 1.0); // crate (vault)
    add(7, 4, 1.6, 1.6, 2.4); // tall crate (climb)
    add(-8, 0, 3, 3, 4); // block
  }

  /** Terrain height, exactly matching the mesh triangles. */
  heightAt(x: number, z: number): number {
    const gx = Math.min(N - 1.0001, Math.max(0, (x + HALF) / RES));
    const gz = Math.min(N - 1.0001, Math.max(0, (z + HALF) / RES));
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
    for (const b of this.boxes) {
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
    for (const b of this.boxes) {
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
    for (const b of this.boxes) {
      if (
        p.x > b.minX - margin && p.x < b.maxX + margin &&
        p.y > b.minY - margin && p.y < b.maxY + margin &&
        p.z > b.minZ - margin && p.z < b.maxZ + margin
      ) return true;
    }
    return false;
  }

  clampToWorld(p: THREE.Vector3): void {
    p.x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, p.x));
    p.z = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, p.z));
  }

  private buildTerrainMesh(): void {
    const positions = new Float32Array(N * N * 3);
    const colors = new Float32Array(N * N * 3);
    const grass = new THREE.Color('#6fa84a');
    const grassDark = new THREE.Color('#4d7f36');
    const rock = new THREE.Color('#8a7f72');
    const snow = new THREE.Color('#e8eef2');
    const c = new THREE.Color();
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const i = iz * N + ix;
        const x = ix * RES - HALF;
        const z = iz * RES - HALF;
        const h = this.heights[i];
        positions.set([x, h, z], i * 3);
        const slope = this.slopeAt(x, z);
        c.copy(grass).lerp(grassDark, fbm(x * 0.15, z * 0.15, 2, 4));
        c.lerp(rock, smoothstep(0.7, 1.2, slope));
        if (h > 30) c.lerp(snow, smoothstep(30, 36, h) * (1 - smoothstep(0.9, 1.4, slope)));
        colors.set([c.r, c.g, c.b], i * 3);
      }
    }
    const index: number[] = [];
    for (let iz = 0; iz < N - 1; iz++) {
      for (let ix = 0; ix < N - 1; ix++) {
        const a = iz * N + ix; // (0,0)
        const b = a + 1; // (1,0)
        const d = a + N; // (0,1)
        const e = d + 1; // (1,1)
        // Same split as heightAt: (00,01,10) and (10,01,11).
        index.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, toonMaterial(0xffffff, { vertexColors: true }));
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
  }

  /** Add a solid block after construction (buildings). Every side is climbable, like other boxes. */
  addSolid(box: Box, material: THREE.Material): THREE.Mesh {
    this.boxes.push(box);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ),
      material,
    );
    m.position.set((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2);
    m.castShadow = m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  private buildBoxMeshes(): void {
    const mat = toonMaterial(0xa59a8c);
    const cap = toonMaterial(0x7d6e60);
    for (const b of this.boxes) {
      const w = b.maxX - b.minX;
      const h = b.maxY - b.minY;
      const d = b.maxZ - b.minZ;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.25, d + 0.2), cap);
      top.position.set(m.position.x, b.maxY - 0.1, m.position.z);
      top.castShadow = true;
      this.group.add(top);
    }
  }

  private scatterTrees(): void {
    const rand = mulberry32(42);
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 1.6, 6);
    const leafGeo = new THREE.ConeGeometry(1.2, 2.8, 7);
    const trunkMat = toonMaterial(0x6b4a2b);
    const leafMat = toonMaterial(0x2f6b3a);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, 260);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 260);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let count = 0;
    for (let tries = 0; tries < 3000 && count < 260; tries++) {
      const x = (rand() - 0.5) * (WORLD_LIMIT * 2 - 10);
      const z = (rand() - 0.5) * (WORLD_LIMIT * 2 - 10);
      if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < 8) continue;
      if (Math.hypot(x - this.homeSite.x, z - this.homeSite.z) < 11) continue;
      if (this.slopeAt(x, z) > 0.5) continue;
      if (this.groundAt(x, z, 1e9) - this.heightAt(x, z) > 0.1) continue; // not on boxes
      const y = this.heightAt(x, z);
      const k = 0.8 + rand() * 0.6;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
      s.set(k, k, k);
      m.compose(new THREE.Vector3(x, y + 0.8 * k, z), q, s);
      trunks.setMatrixAt(count, m);
      m.compose(new THREE.Vector3(x, y + (1.6 + 1.2) * k, z), q, s);
      leaves.setMatrixAt(count, m);
      count++;
    }
    trunks.count = leaves.count = count;
    trunks.castShadow = leaves.castShadow = true;
    this.group.add(trunks, leaves);
  }
}
