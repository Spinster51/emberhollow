import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import { shellMaterial } from '../core/toon';
import { ROCK_TINT, SCATTER_ART, TREE_ART, TREE_FAR, TREE_NEAR, VEG_TINT, type ScatterPiece, type VegRegion } from '../art/assets';
import { pieceGeometry } from './worldModels';
import type { World } from './World';

/**
 * Trees, bushes, grass and rocks from the world file (milestone 8), all instanced.
 *
 * Every kind keeps all of its instances in a 24 m grid. Around the player a "near pool" per kind holds the
 * instances within the kind's range at full detail; it is refilled when the player has moved a few metres.
 * Trees also have a "far pool" per kind with their low-poly LOD: the instances past the near range, up to the
 * fog's end, that lie in the camera's view (with a wide margin); it is refilled with the near pools and when
 * the camera turns. Near trees cast their sun shadow through a third pool of LOD shadow casters on a layer only
 * the shadow camera sees. Ground cover and rocks have no far pool: past their range they are not drawn.
 * So the vegetation costs about two draw calls per kind in view (plus a shadow pass per tree kind), wherever you are.
 */

const CELL = 24;
/** Refill the pools when the player has moved this far (m) or the camera has turned this much (rad). */
const REFILL = 4;
const TURN = 0.2;
/** Half-angle of the far pool's view cone beyond the camera's half field of view (rad). */
const CONE_MARGIN = 0.55;
/** The layer only the sun's shadow camera renders (the tree shadow proxies). */
export const SHADOW_LAYER = 1;

interface Kind {
  node: string;
  lod?: string;
  range: number;
  shadow: boolean;
  outline: number;
  /** Instance indices per grid cell. */
  cells: Map<number, number[]>;
  count: number;
  near?: THREE.InstancedMesh;
  nearOutline?: THREE.InstancedMesh;
  /** LOD shadow casters for the near pool (shares its instance matrices; shadow camera only). */
  nearShadow?: THREE.InstancedMesh;
  far?: THREE.InstancedMesh;
  /** Global instance index per slot in `near` (for hiding trees that block the camera). */
  nearIds?: number[];
  /** Slots in `near` currently hidden because they sit between camera and player. */
  hiddenSlots?: Set<number>;
}

const cellKey = (cx: number, cz: number) => cx * 100003 + cz;

/** Which art region a spot belongs to (the test map is a meadow; town and dungeon have no wild plants). */
export function vegRegion(world: World, x: number, z: number): VegRegion | null {
  const id = world.regionAt(x, z).id;
  if (id === 'meadow' || id === 'test') return 'meadow';
  if (id === 'forest' || id === 'ruins') return id;
  return null;
}

function pick(list: ScatterPiece[], r: number): ScatterPiece {
  const total = list.reduce((s, p) => s + p.weight, 0);
  let t = r * total;
  for (const p of list) {
    if ((t -= p.weight) <= 0) return p;
  }
  return list[list.length - 1];
}

export class Vegetation {
  readonly group = new THREE.Group();
  private kinds = new Map<string, Kind>();
  /** Instance data: matrix (16 floats), colour (3 floats), position. */
  private mats: number[] = [];
  private cols: number[] = [];
  private xz: number[] = [];
  private centre = new THREE.Vector3(1e9, 0, 1e9);
  /** The view the far pools were last filled for: camera position and forward (x, z), cone cosine (-2: all round). */
  private view = { x: 0, z: 0, fx: 0, fz: -1, cos: -2, yaw: 1e9 };
  /** Last player & camera state checked by `update` (skip per-frame work when nothing moved). */
  private last = { px: 1e9, pz: 1e9, cx: 1e9, cy: 1e9, cz: 1e9, hasCam: false };
  /** Instances per art layer, for tests and the report. */
  readonly counts: Record<string, number> = {};
  ready = false;

  constructor(private world: World, private file?: string) {
    this.group.name = 'vegetation';
  }

  /** Lay out every instance and build the meshes (the world file must be loaded). False if a piece is missing. */
  build(): boolean {
    const w = this.world;
    const big = w.layout.name === 'main';
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    const heights = new Map<string, number>();
    const add = (p: ScatterPiece, range: number, shadow: boolean, outline: number, x: number, y: number, z: number, yaw: number, s: number, tint: [number, number, number], vary: number, rnd: number) => {
      let k = this.kinds.get(p.node);
      if (!k) this.kinds.set(p.node, (k = { node: p.node, lod: p.lod, range, shadow, outline, cells: new Map(), count: 0 }));
      const i = this.xz.length / 2;
      q.setFromAxisAngle(up, yaw);
      let h = heights.get(p.node);
      if (h === undefined) {
        const geo = pieceGeometry(p.node, this.file)?.geometry;
        if (geo && !geo.boundingBox) geo.computeBoundingBox();
        heights.set(p.node, (h = geo?.boundingBox?.max.y ?? 1));
      }
      m.compose(new THREE.Vector3(x, y - (p.sink ?? 0) * h * s, z), q, new THREE.Vector3(s, s, s));
      this.mats.push(...m.elements);
      const v = 1 + (rnd - 0.5) * vary;
      c.setRGB(tint[0] * v, tint[1] * v, tint[2] * (1 + (rnd - 0.5) * vary * 0.6));
      this.cols.push(c.r, c.g, c.b);
      this.xz.push(x, z);
      const key = cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
      let list = k.cells.get(key);
      if (!list) k.cells.set(key, (list = []));
      list.push(i);
      k.count++;
    };

    // Trees: the old trees' spots, each region with its own kinds.
    for (const t of w.trees) {
      const r = vegRegion(w, t.x, t.z) ?? 'meadow';
      const p = pick(TREE_ART[r], hash(t.x, t.z));
      const s = p.scale[0] + (p.scale[1] - p.scale[0]) * hash(t.z, t.x) * 0.5 + (t.k - 0.8) / 0.6 * (p.scale[1] - p.scale[0]) * 0.5;
      add(p, TREE_NEAR, true, 0, t.x, t.y, t.z, t.rot, s, VEG_TINT[r], 0.22, hash(t.x * 3, t.z));
    }
    this.counts.trees = w.trees.length;

    // Ground cover and rocks, scattered by region density.
    const span = w.limit * 2 - 10;
    const probe = new THREE.Vector3();
    const avoid = w.scatterAvoid;
    SCATTER_ART.forEach((layer, li) => {
      const rand = mulberry32(1000 + li * 77);
      const want = big ? layer.count : Math.round(layer.count / 10);
      let n = 0;
      for (let tries = 0; tries < want * 12 && n < want; tries++) {
        const x = (rand() - 0.5) * span;
        const z = (rand() - 0.5) * span;
        const r1 = rand();
        const r2 = rand();
        const r3 = rand();
        const r = vegRegion(w, x, z);
        if (!r) continue;
        const pieces = layer.pieces[r];
        if (!pieces || r1 > layer.density[r]) continue;
        const y = w.heightAt(x, z);
        if (w.layout.treeDensity(x, z, y) <= 0) continue;
        if (w.slopeAt(x, z) > layer.maxSlope) continue;
        // Clear of blocks by a metre (the probe sits above the terrain margin, so only boxes count).
        if (w.isSolid(probe.set(x, y + 1.2, z), 1.0)) continue;
        if (avoid.some(([ax, az, ar]) => (x - ax) ** 2 + (z - az) ** 2 < ar * ar)) continue;
        // Keep bushes clear of enemy camp interiors so tents, crates and enemies read cleanly.
        if (layer.id === 'bush' && w.campCentres.some(([cx, cz]) => (x - cx) ** 2 + (z - cz) ** 2 < 9 * 9)) continue;
        const p = pick(pieces, r2);
        const s = p.scale[0] + (p.scale[1] - p.scale[0]) * r3;
        const rock = layer.id === 'pebble' || layer.id === 'boulder';
        add(p, layer.range, layer.shadow, 0, x, y, z, r3 * 40, s, rock ? ROCK_TINT[r] : VEG_TINT[r], rock ? 0.18 : 0.3, r2);
        n++;
      }
      this.counts[layer.id] = n;
    });

    // Crags round the foot of the rock spires (sunk, so only their tops show).
    let crags = 0;
    for (const [sx, sz] of w.layout.spires ?? []) {
      for (let i = 0; i < 6; i++) {
        const a = hash(sx, sz, i) * Math.PI * 2;
        const d = 6.8 + hash(sz, sx, i) * 2.2;
        const x = sx + Math.cos(a) * d;
        const z = sz + Math.sin(a) * d;
        const r = vegRegion(w, x, z) ?? 'meadow';
        // The boulder layer's rock, larger and deeper (no extra kind: kinds cost draw calls).
        add({ node: 'BoulderC', weight: 1, scale: [1, 1], sink: 0.35 }, 95, false, 0, x, w.heightAt(x, z), z, a, 0.8 + hash(x, z) * 0.5, ROCK_TINT[r], 0.15, hash(z, x));
        crags++;
      }
    }
    this.counts.crags = crags;

    // Meshes per kind.
    for (const k of this.kinds.values()) {
      const src = pieceGeometry(k.node, this.file);
      if (!src) return false;
      const lod = k.lod ? pieceGeometry(k.lod, this.file) : null;
      if (k.lod && !lod) return false;
      const near = this.pool(`veg:${k.node}`, src.geometry, src.material, k.count);
      // Trees cast their shadow through LOD proxies (a quarter of the triangles); other kinds as configured.
      near.castShadow = k.shadow && !lod;
      k.near = near;
      if (k.outline > 0) {
        const ol = new THREE.InstancedMesh(src.geometry, shellMaterial(k.outline), k.count);
        ol.instanceMatrix = near.instanceMatrix;
        ol.count = 0;
        ol.frustumCulled = false;
        k.nearOutline = ol;
        this.group.add(ol);
      }
      if (lod) {
        k.nearIds = [];
        k.hiddenSlots = new Set();
        if (k.shadow) {
          const sh = new THREE.InstancedMesh(lod.geometry, lod.material, k.count);
          sh.name = `veg:${k.lod}:shadow`;
          sh.instanceMatrix = near.instanceMatrix;
          sh.count = 0;
          sh.frustumCulled = false;
          sh.castShadow = true;
          sh.matrixAutoUpdate = false;
          sh.updateMatrix();
          sh.layers.set(SHADOW_LAYER);
          k.nearShadow = sh;
          this.group.add(sh);
        }
        k.far = this.pool(`veg:${k.lod}`, lod.geometry, lod.material, k.count);
      }
    }
    this.ready = true;
    return true;
  }

  /** An empty instanced pool (filled by `fill`). */
  private pool(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geometry, material, capacity);
    m.name = name;
    m.count = 0;
    m.visible = false;
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = false;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(m);
    return m;
  }

  /**
   * Refill the pools when the player has moved far enough (near and far) or the camera has turned (far).
   * Without a camera (tests, overview shots) the far pools take every tree in range, all round.
   */
  update(player: THREE.Vector3, camera?: THREE.Camera, force = false): void {
    if (!this.ready) return;
    const cx = camera ? camera.position.x : 0;
    const cy = camera ? camera.position.y : 0;
    const cz = camera ? camera.position.z : 0;
    const hasCam = !!camera;
    const L = this.last;
    if (
      !force &&
      hasCam === L.hasCam &&
      Math.abs(player.x - L.px) < 0.05 &&
      Math.abs(player.z - L.pz) < 0.05 &&
      (!hasCam || (Math.abs(cx - L.cx) < 0.05 && Math.abs(cy - L.cy) < 0.05 && Math.abs(cz - L.cz) < 0.05))
    ) {
      return;
    }
    L.px = player.x;
    L.pz = player.z;
    L.cx = cx;
    L.cy = cy;
    L.cz = cz;
    L.hasCam = hasCam;
    const moved = (player.x - this.centre.x) ** 2 + (player.z - this.centre.z) ** 2 >= REFILL * REFILL;
    if (force || moved) {
      this.centre.copy(player);
      for (const k of this.kinds.values()) {
        this.fill(k.near!, k, 0, k.range);
        if (k.nearShadow) {
          k.nearShadow.count = k.near!.count;
          k.nearShadow.visible = k.near!.visible;
        }
        if (k.nearOutline) {
          k.nearOutline.count = k.near!.count;
          k.nearOutline.visible = k.near!.visible;
        }
      }
    }
    // The far pools follow the camera's view: a cone from the camera, as wide as its field of view plus a margin.
    const v = this.view;
    let yaw = 0;
    let cos = -2;
    if (camera) {
      const d = camera.getWorldDirection(tmpDir);
      yaw = Math.atan2(d.x, d.z);
      const pc = camera as THREE.PerspectiveCamera;
      const half = pc.isPerspectiveCamera ? Math.atan(Math.tan(THREE.MathUtils.degToRad(pc.fov / 2)) * pc.aspect) : Math.PI;
      // Looking steeply down (or from high above) the view covers all round.
      if (Math.abs(d.y) < 0.7 && camera.position.y - player.y < 40) cos = Math.cos(Math.min(Math.PI, half + CONE_MARGIN));
      if (cos > -2) {
        v.fx = d.x;
        v.fz = d.z;
        const l = Math.hypot(v.fx, v.fz) || 1;
        v.fx /= l;
        v.fz /= l;
      }
    }
    const turned = Math.abs(Math.atan2(Math.sin(yaw - v.yaw), Math.cos(yaw - v.yaw))) > TURN || cos !== v.cos;
    if (force || moved || turned) {
      v.yaw = yaw;
      v.cos = cos;
      v.x = camera ? camera.position.x : player.x;
      v.z = camera ? camera.position.z : player.z;
      for (const k of this.kinds.values()) if (k.far) this.fill(k.far, k, k.range, TREE_FAR, true);
    }
    this.hideOccluding(player, camera);
  }

  /**
   * Hide near trees whose trunk or canopy engulfs the camera lens or crosses the sightline between camera
   * and target, restoring them as soon as the view clears. Very high overview cameras (>= 20 m above ground)
   * show all trees.
   */
  private hideOccluding(player: THREE.Vector3, camera?: THREE.Camera): void {
    const camAbove = camera ? camera.position.y - this.world.heightAt(camera.position.x, camera.position.z) : 1e9;
    const dist = camera ? camera.position.distanceTo(player) : 1e9;
    const active = !!camera && camAbove < 20 && dist < 32;
    const ax = camera ? camera.position.x : 0;
    const az = camera ? camera.position.z : 0;
    const dx = player.x - ax;
    const dz = player.z - az;
    const len2 = dx * dx + dz * dz;
    // Tapered sightline cone from lens (`r0`) to target (`r1`) so wide canopies near the camera never clip the foreground.
    const r0 = camAbove > 5 ? 6.0 : 4.2;
    const r1 = 2.4;
    const r02 = r0 * r0;
    for (const k of this.kinds.values()) {
      if (!k.near || !k.nearIds || !k.hiddenSlots) continue;
      if (!active && k.hiddenSlots.size === 0) continue;
      const arr = k.near.instanceMatrix.array as Float32Array;
      let dirty = false;
      for (let slot = 0; slot < k.near.count; slot++) {
        const i = k.nearIds[slot];
        let hide = false;
        if (active) {
          const tx = this.xz[i * 2];
          const tz = this.xz[i * 2 + 1];
          const c2 = (tx - ax) ** 2 + (tz - az) ** 2;
          const t = len2 > 1e-4 ? Math.max(0, Math.min(0.95, ((tx - ax) * dx + (tz - az) * dz) / len2)) : 0;
          const px = ax + dx * t;
          const pz = az + dz * t;
          const d2 = (tx - px) ** 2 + (tz - pz) ** 2;
          const r = r0 + (r1 - r0) * t;
          hide = c2 < r02 || d2 < r * r;
        }
        const was = k.hiddenSlots.has(slot);
        if (hide && !was) {
          k.hiddenSlots.add(slot);
          for (let j = 0; j < 16; j++) arr[slot * 16 + j] = 0;
          dirty = true;
        } else if (!hide && was) {
          k.hiddenSlots.delete(slot);
          for (let j = 0; j < 16; j++) arr[slot * 16 + j] = this.mats[i * 16 + j];
          dirty = true;
        }
      }
      if (dirty) {
        k.near.instanceMatrix.clearUpdateRanges();
        k.near.instanceMatrix.addUpdateRange(0, k.near.count * 16);
        k.near.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /**
   * Copy the instances between `inner` and `outer` metres of the pool centre into `mesh` (and, for a far pool,
   * only those in the view cone).
   */
  private fill(mesh: THREE.InstancedMesh, k: Kind, inner: number, outer: number, cone = false): void {
    const I2 = inner * inner;
    const R2 = outer * outer;
    const { x: px, z: pz } = this.centre;
    const v = this.view;
    const arr = mesh.instanceMatrix.array as Float32Array;
    const col = mesh.instanceColor!.array as Float32Array;
    const trackNear = !cone && !!k.nearIds;
    if (trackNear) {
      k.nearIds!.length = 0;
      k.hiddenSlots!.clear();
    }
    let n = 0;
    const c0 = Math.floor((px - outer) / CELL);
    const c1 = Math.floor((px + outer) / CELL);
    const r0 = Math.floor((pz - outer) / CELL);
    const r1 = Math.floor((pz + outer) / CELL);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = r0; cz <= r1; cz++) {
        const list = k.cells.get(cellKey(cx, cz));
        if (!list) continue;
        for (const i of list) {
          const x = this.xz[i * 2];
          const z = this.xz[i * 2 + 1];
          const d2 = (x - px) ** 2 + (z - pz) ** 2;
          if (d2 >= R2 || d2 < I2) continue;
          if (cone && v.cos > -2) {
            const ex = x - v.x;
            const ez = z - v.z;
            const el = Math.hypot(ex, ez);
            if (el > 8 && (ex * v.fx + ez * v.fz) / el < v.cos) continue;
          }
          for (let j = 0; j < 16; j++) arr[n * 16 + j] = this.mats[i * 16 + j];
          col[n * 3] = this.cols[i * 3];
          col[n * 3 + 1] = this.cols[i * 3 + 1];
          col[n * 3 + 2] = this.cols[i * 3 + 2];
          if (trackNear) k.nearIds!.push(i);
          n++;
        }
      }
    }
    mesh.count = n;
    mesh.visible = n > 0;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.clearUpdateRanges();
    mesh.instanceColor!.addUpdateRange(0, n * 3);
    mesh.instanceColor!.needsUpdate = true;
  }

  /** Instanced meshes in use, by kind (tests). */
  meshes(): { node: string; near: number; far: number; instanced: boolean }[] {
    return [...this.kinds.values()].map((k) => ({ node: k.node, near: k.near?.count ?? 0, far: k.far?.count ?? 0, instanced: !!k.near?.isInstancedMesh }));
  }
}

const tmpDir = new THREE.Vector3();

function hash(x: number, z: number, salt = 0): number {
  const s = Math.sin(x * 12.9898 + z * 78.233 + salt * 4.123) * 43758.5453;
  return s - Math.floor(s);
}
