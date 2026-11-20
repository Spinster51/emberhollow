import * as THREE from 'three';
import { TUNING } from '../config';
import type { World } from '../world/World';
import { BOSS_MOVES, type Enemy } from './Enemy';

const POOL_SIZE = 4;
const SEGS = 40;
const FILL_RINGS = 4; // center, mid-fill, fill-edge, inner-border
const MAX_FILL_VERTS = (SEGS + 1) * FILL_RINGS;
// Outer arc border (2 * (SEGS + 1)) + up to 2 radial side borders (4 + 4 = 8)
const MAX_BORDER_VERTS = (SEGS + 1) * 2 + 8;
const GROUND_LIFT = 0.06;
const TELEGRAPH_RANGE = 60;

export type TelegraphKind = 'golem:slam' | 'warden:sweep' | 'warden:slam' | 'warden:nova';

export interface TelegraphSlot {
  readonly group: THREE.Group;
  readonly fillMesh: THREE.Mesh;
  readonly borderMesh: THREE.Mesh;
  readonly fillPos: THREE.BufferAttribute;
  readonly fillCol: THREE.BufferAttribute;
  readonly borderPos: THREE.BufferAttribute;
  visible: boolean;
  enemy: Enemy | null;
  kind: TelegraphKind | null;
  radius: number;
  arcDeg: number;
  progress: number;
}

const B = TUNING.enemies.boss;

/**
 * Pooled ground warning decals for Golem slam and Cinder Warden sweep/slam/nova.
 * Conforms to the ground under each attack (both sloped terrain and the vault floor)
 * with zero per-frame allocations.
 */
export class Telegraphs {
  readonly group = new THREE.Group();
  readonly slots: TelegraphSlot[] = [];

  constructor(private world: World) {
    this.group.name = 'ground-telegraphs';

    const fillIndices: number[] = [];
    for (let r = 0; r < FILL_RINGS - 1; r++) {
      for (let i = 0; i < SEGS; i++) {
        const a = r * (SEGS + 1) + i;
        const b = a + 1;
        const c = a + (SEGS + 1);
        const d = c + 1;
        fillIndices.push(a, b, c, b, d, c);
      }
    }

    const borderIndices: number[] = [];
    for (let i = 0; i < SEGS; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      borderIndices.push(a, c, b, b, c, d);
    }
    const sideBase = (SEGS + 1) * 2;
    for (let k = 0; k < 2; k++) {
      const a = sideBase + k * 4;
      borderIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    for (let s = 0; s < POOL_SIZE; s++) {
      const fillGeo = new THREE.BufferGeometry();
      const fillPos = new THREE.BufferAttribute(new Float32Array(MAX_FILL_VERTS * 3), 3);
      fillPos.setUsage(THREE.DynamicDrawUsage);
      const fillCol = new THREE.BufferAttribute(new Float32Array(MAX_FILL_VERTS * 3), 3);
      fillCol.setUsage(THREE.DynamicDrawUsage);
      fillGeo.setAttribute('position', fillPos);
      fillGeo.setAttribute('color', fillCol);
      fillGeo.setIndex(fillIndices);

      const fillMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const fillMesh = new THREE.Mesh(fillGeo, fillMat);
      fillMesh.frustumCulled = false;
      fillMesh.renderOrder = 4;

      const borderGeo = new THREE.BufferGeometry();
      const borderPos = new THREE.BufferAttribute(new Float32Array(MAX_BORDER_VERTS * 3), 3);
      borderPos.setUsage(THREE.DynamicDrawUsage);
      borderGeo.setAttribute('position', borderPos);
      borderGeo.setIndex(borderIndices);

      const borderMat = new THREE.MeshBasicMaterial({
        color: 0xff4c1a,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      const borderMesh = new THREE.Mesh(borderGeo, borderMat);
      borderMesh.frustumCulled = false;
      borderMesh.renderOrder = 5;

      const slotGroup = new THREE.Group();
      slotGroup.visible = false;
      slotGroup.add(fillMesh, borderMesh);
      this.group.add(slotGroup);

      this.slots.push({
        group: slotGroup,
        fillMesh,
        borderMesh,
        fillPos,
        fillCol,
        borderPos,
        visible: false,
        enemy: null,
        kind: null,
        radius: 0,
        arcDeg: 360,
        progress: 0,
      });
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.visible) n++;
    return n;
  }

  reset(): void {
    for (const s of this.slots) {
      s.visible = false;
      s.group.visible = false;
      s.enemy = null;
      s.kind = null;
    }
  }

  update(enemies: readonly Enemy[], viewPos: THREE.Vector3): void {
    let used = 0;
    for (const e of enemies) {
      if (used >= POOL_SIZE) break;
      if (!e.alive) continue;
      if (e.state !== 'windup' && !(e.state === 'active' && !e.hitDone)) continue;
      if (Math.abs(e.pos.y - viewPos.y) > 15) continue;
      if (e.pos.distanceToSquared(viewPos) > TELEGRAPH_RANGE * TELEGRAPH_RANGE) continue;

      let kind: TelegraphKind | null = null;
      let radius = 0;
      let arcDeg = 360;
      let windup = 1;
      if (e.kind === 'golem') {
        kind = 'golem:slam';
        radius = e.stats.aoe ?? 3.2;
        windup = e.stats.windup;
      } else if (e.kind === 'warden' && e.move === 'sweep') {
        kind = 'warden:sweep';
        radius = B.sweepReach;
        arcDeg = B.sweepArc;
        windup = BOSS_MOVES.sweep.windup / e.rage();
      } else if (e.kind === 'warden' && e.move === 'slam') {
        kind = 'warden:slam';
        radius = e.stats.aoe ?? 4.8;
        windup = BOSS_MOVES.slam.windup / e.rage();
      } else if (e.kind === 'warden' && e.move === 'nova') {
        kind = 'warden:nova';
        radius = B.novaRadius;
        windup = BOSS_MOVES.nova.windup / e.rage();
      }
      if (!kind) continue;

      const progress = e.state === 'windup' ? Math.min(1, Math.max(0, e.stateTime / Math.max(0.01, windup))) : 1;
      const slot = this.slots[used++];
      this.writeSlot(slot, e, kind, radius, arcDeg, progress);
    }

    for (let i = used; i < POOL_SIZE; i++) {
      const s = this.slots[i];
      if (s.visible) {
        s.visible = false;
        s.group.visible = false;
        s.enemy = null;
        s.kind = null;
      }
    }
  }

  private groundY(x: number, z: number, refY: number): number {
    return this.world.groundAt(x, z, refY + 1.5) + GROUND_LIFT;
  }

  private writeSlot(
    slot: TelegraphSlot,
    enemy: Enemy,
    kind: TelegraphKind,
    radius: number,
    arcDeg: number,
    progress: number,
  ): void {
    slot.visible = true;
    slot.group.visible = true;
    slot.enemy = enemy;
    slot.kind = kind;
    slot.radius = radius;
    slot.arcDeg = arcDeg;
    slot.progress = progress;

    const ox = enemy.pos.x;
    const oy = enemy.pos.y;
    const oz = enemy.pos.z;
    const half = ((arcDeg / 2) * Math.PI) / 180;
    const borderW = Math.min(0.2, Math.max(0.11, radius * 0.04));
    const innerR = Math.max(0.1, radius - borderW);
    const fillR = Math.max(0.03, innerR * progress);
    const midR = fillR * 0.5;
    const radii = [0, midR, fillR, innerR];

    // Brighten the growing fill and border as the wind-up approaches the hit.
    const fillRCol = 1.0;
    const fillGCol = 0.34 + 0.34 * progress;
    const fillBCol = 0.08 + 0.1 * progress;
    const bgRCol = 0.45;
    const bgGCol = 0.07;
    const bgBCol = 0.04;

    const fPos = slot.fillPos.array as Float32Array;
    const fCol = slot.fillCol.array as Float32Array;
    const bPos = slot.borderPos.array as Float32Array;

    for (let i = 0; i <= SEGS; i++) {
      const a = enemy.facing - half + (2 * half * i) / SEGS;
      const sx = -Math.sin(a);
      const sz = -Math.cos(a);

      for (let r = 0; r < FILL_RINGS; r++) {
        const rad = radii[r];
        const wx = ox + sx * rad;
        const wz = oz + sz * rad;
        const wy = this.groundY(wx, wz, oy);
        const vi = r * (SEGS + 1) + i;
        fPos[vi * 3] = wx;
        fPos[vi * 3 + 1] = wy;
        fPos[vi * 3 + 2] = wz;

        const isFill = r < 3;
        fCol[vi * 3] = isFill ? fillRCol : bgRCol;
        fCol[vi * 3 + 1] = isFill ? fillGCol : bgGCol;
        fCol[vi * 3 + 2] = isFill ? fillBCol : bgBCol;
      }

      const ix = ox + sx * innerR;
      const iz = oz + sz * innerR;
      const rx = ox + sx * radius;
      const rz = oz + sz * radius;
      const bi = i * 2;
      bPos[bi * 3] = ix;
      bPos[bi * 3 + 1] = this.groundY(ix, iz, oy);
      bPos[bi * 3 + 2] = iz;
      bPos[(bi + 1) * 3] = rx;
      bPos[(bi + 1) * 3 + 1] = this.groundY(rx, rz, oy);
      bPos[(bi + 1) * 3 + 2] = rz;
    }

    const isCone = arcDeg < 359.9;
    if (isCone) {
      const sideBase = (SEGS + 1) * 2;
      const edgeHalfW = 0.065;
      for (let k = 0; k < 2; k++) {
        const a = enemy.facing + (k === 0 ? -half : half);
        const sx = -Math.sin(a);
        const sz = -Math.cos(a);
        const nx = sz * edgeHalfW * (k === 0 ? 1 : -1);
        const nz = -sx * edgeHalfW * (k === 0 ? 1 : -1);
        const v0 = sideBase + k * 4;
        const pts: [number, number][] = [
          [ox, oz],
          [ox + nx, oz + nz],
          [ox + sx * radius, oz + sz * radius],
          [ox + sx * radius + nx, oz + sz * radius + nz],
        ];
        for (let p = 0; p < 4; p++) {
          const wx = pts[p][0];
          const wz = pts[p][1];
          bPos[(v0 + p) * 3] = wx;
          bPos[(v0 + p) * 3 + 1] = this.groundY(wx, wz, oy);
          bPos[(v0 + p) * 3 + 2] = wz;
        }
      }
      slot.borderMesh.geometry.setDrawRange(0, (SEGS + 2) * 6);
    } else {
      slot.borderMesh.geometry.setDrawRange(0, SEGS * 6);
    }

    const bMat = slot.borderMesh.material as THREE.MeshBasicMaterial;
    bMat.color.setRGB(1.0, 0.28 + 0.42 * progress, 0.08 + 0.1 * progress);
    bMat.opacity = 0.85 + 0.12 * progress;

    slot.fillPos.needsUpdate = true;
    slot.fillCol.needsUpdate = true;
    slot.borderPos.needsUpdate = true;
  }
}
