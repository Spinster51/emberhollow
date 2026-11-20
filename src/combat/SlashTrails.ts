import * as THREE from 'three';
import type { ClassId } from '../classes/classes';
import type { Item, Rarity } from '../items/items';

const POOL_SIZE = 4;
const MAX_SAMPLES = 36;
const FADE_TIME = 0.15;
const SUBDIVISIONS = 3;

const CLASS_COLOR: Record<ClassId, number> = {
  warrior: 0x268cff,
  tank: 0xff9e1b,
  assassin: 0x1ee67a,
  mage: 0xa66bff,
};

const UNIQUE_COLOR: Record<string, number> = {
  emberfang: 0xff4d0a,
  emberMaul: 0xff4d0a,
  cinderstaff: 0xff4d0a,
  bloodfangs: 0xff1e42,
};

const RARITY_CFG: Record<Rarity, { gain: number; tipWhite: number; opacity: number }> = {
  common: { gain: 0.9, tipWhite: 0.18, opacity: 0.82 },
  uncommon: { gain: 1.0, tipWhite: 0.28, opacity: 0.88 },
  rare: { gain: 1.12, tipWhite: 0.38, opacity: 0.94 },
  epic: { gain: 1.24, tipWhite: 0.5, opacity: 0.98 },
  legendary: { gain: 1.38, tipWhite: 0.65, opacity: 1.0 },
};

const WHITE = new THREE.Color(0xffffff);
const _baseCol = new THREE.Color();
const _vTip = new THREE.Vector3();
const _vInner = new THREE.Vector3();
const _prevTipOff = new THREE.Vector3();
const _curTipOff = new THREE.Vector3();
const _prevInOff = new THREE.Vector3();
const _curInOff = new THREE.Vector3();

function createTrailTexture(): THREE.DataTexture {
  const w = 32;
  const h = 8;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    // Rich translucent blade body rising cleanly to a crisp bright outer edge.
    const cross = v < 0.78 ? 0.5 + 0.5 * Math.pow(v / 0.78, 0.55) : 1 - ((v - 0.78) / 0.22) * 0.1;
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const along = Math.pow(u, 0.45);
      const i = (y * w + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, along * cross)));
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export interface SwingSample {
  swingKey: number;
  active: boolean;
  hasPre: boolean;
  preTip: THREE.Vector3;
  preInner: THREE.Vector3;
  tip: THREE.Vector3;
  inner: THREE.Vector3;
  center: THREE.Vector3;
  cls: ClassId;
  weapon: Item | null;
}

export interface TrailSlot {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshBasicMaterial;
  readonly posAttr: THREE.BufferAttribute;
  readonly uvAttr: THREE.BufferAttribute;
  readonly colAttr: THREE.BufferAttribute;
  readonly innerCol: THREE.Color;
  readonly tipCol: THREE.Color;
  readonly tips: THREE.Vector3[];
  readonly inners: THREE.Vector3[];
  count: number;
  emitting: boolean;
  fade: number;
  baseOpacity: number;
  swingKey: number;
  dirty: boolean;
}

/**
 * Pooled melee slash-arc ribbons that follow the weapon tip during the swing's active window
 * and fade out over ~0.15 s. Zero per-swing or per-frame heap allocations.
 */
export class SlashTrails {
  readonly group = new THREE.Group();
  readonly slots: TrailSlot[] = [];
  private activeSlot: TrailSlot | null = null;
  private lastKey = -1;
  private tex: THREE.DataTexture;

  constructor() {
    this.group.name = 'slash-trails';
    this.tex = createTrailTexture();
    const indices: number[] = [];
    for (let i = 0; i < MAX_SAMPLES - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }

    for (let s = 0; s < POOL_SIZE; s++) {
      const posArr = new Float32Array(MAX_SAMPLES * 2 * 3);
      const uvArr = new Float32Array(MAX_SAMPLES * 2 * 2);
      const colArr = new Float32Array(MAX_SAMPLES * 2 * 3);
      const geo = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(posArr, 3);
      posAttr.setUsage(THREE.DynamicDrawUsage);
      const uvAttr = new THREE.BufferAttribute(uvArr, 2);
      uvAttr.setUsage(THREE.DynamicDrawUsage);
      const colAttr = new THREE.BufferAttribute(colArr, 3);
      colAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', posAttr);
      geo.setAttribute('uv', uvAttr);
      geo.setAttribute('color', colAttr);
      geo.setIndex(indices);
      geo.setDrawRange(0, 0);

      const mat = new THREE.MeshBasicMaterial({
        map: this.tex,
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 10;
      this.group.add(mesh);

      const tips: THREE.Vector3[] = [];
      const inners: THREE.Vector3[] = [];
      for (let i = 0; i < MAX_SAMPLES; i++) {
        tips.push(new THREE.Vector3());
        inners.push(new THREE.Vector3());
      }
      this.slots.push({
        mesh,
        mat,
        posAttr,
        uvAttr,
        colAttr,
        innerCol: new THREE.Color(0xffffff),
        tipCol: new THREE.Color(0xffffff),
        tips,
        inners,
        count: 0,
        emitting: false,
        fade: 0,
        baseOpacity: 0.82,
        swingKey: -1,
        dirty: false,
      });
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.mesh.visible) n++;
    return n;
  }

  reset(): void {
    for (const s of this.slots) {
      s.mesh.visible = false;
      s.count = 0;
      s.emitting = false;
      s.fade = 0;
      s.swingKey = -1;
      s.dirty = false;
    }
    this.activeSlot = null;
    this.lastKey = -1;
  }

  update(sample: SwingSample | null, dt: number): void {
    if (sample && sample.active) {
      if (sample.swingKey !== this.lastKey || !this.activeSlot || !this.activeSlot.emitting) {
        this.startTrail(sample);
      } else {
        this.appendArc(this.activeSlot, sample.tip, sample.inner, sample.center);
      }
    } else if (this.activeSlot) {
      this.activeSlot.emitting = false;
      this.activeSlot = null;
    }

    for (const s of this.slots) {
      if (!s.mesh.visible && (!s.emitting || s.count < 2)) continue;
      if (!s.emitting) {
        s.fade += dt;
        if (s.fade >= FADE_TIME) {
          s.mesh.visible = false;
          s.count = 0;
          continue;
        }
        s.mat.opacity = s.baseOpacity * (1 - s.fade / FADE_TIME);
      }
      if (s.dirty && s.count >= 2) {
        this.rebuildGeometry(s);
        s.dirty = false;
      }
      s.mesh.visible = s.count >= 2;
    }
  }

  private startTrail(sample: SwingSample): void {
    if (this.activeSlot) this.activeSlot.emitting = false;
    let slot = this.slots.find((s) => !s.mesh.visible && !s.emitting);
    if (!slot) {
      // Reuse the oldest fading slot if all pool slots are busy.
      slot = this.slots[0];
      for (const s of this.slots) {
        if (!s.emitting && (slot.emitting || s.fade > slot.fade)) slot = s;
      }
    }
    slot.count = 0;
    slot.emitting = true;
    slot.fade = 0;
    slot.swingKey = sample.swingKey;
    slot.dirty = false;
    this.applyTint(slot, sample.cls, sample.weapon);
    this.activeSlot = slot;
    this.lastKey = sample.swingKey;

    if (sample.hasPre) {
      this.pushSample(slot, sample.preTip, sample.preInner);
      this.appendArc(slot, sample.tip, sample.inner, sample.center);
    } else {
      this.pushSample(slot, sample.tip, sample.inner);
    }
  }

  private applyTint(slot: TrailSlot, cls: ClassId, weapon: Item | null): void {
    const baseHex = (weapon?.unique && UNIQUE_COLOR[weapon.unique]) || CLASS_COLOR[cls];
    const rarity: Rarity = weapon?.rarity ?? 'common';
    const cfg = RARITY_CFG[rarity];
    _baseCol.setHex(baseHex);
    slot.innerCol.copy(_baseCol).multiplyScalar(cfg.gain);
    slot.tipCol.copy(_baseCol).lerp(WHITE, cfg.tipWhite).multiplyScalar(cfg.gain);
    slot.mat.color.setHex(0xffffff);
    slot.baseOpacity = cfg.opacity;
    slot.mat.opacity = cfg.opacity;
  }

  private appendArc(slot: TrailSlot, tip: THREE.Vector3, inner: THREE.Vector3, center: THREE.Vector3): void {
    if (slot.count === 0) {
      this.pushSample(slot, tip, inner);
      return;
    }
    const prevTip = slot.tips[slot.count - 1];
    const prevInner = slot.inners[slot.count - 1];
    const d = prevTip.distanceTo(tip);
    if (d < 0.015) return;

    // Subdivide along the swing arc around the player centre so even fast 60 fps swings stay curved.
    if (d > 0.08) {
      _prevTipOff.copy(prevTip).sub(center);
      _curTipOff.copy(tip).sub(center);
      _prevInOff.copy(prevInner).sub(center);
      _curInOff.copy(inner).sub(center);
      const rTip0 = Math.hypot(_prevTipOff.x, _prevTipOff.z);
      const rTip1 = Math.hypot(_curTipOff.x, _curTipOff.z);
      const rIn0 = Math.hypot(_prevInOff.x, _prevInOff.z);
      const rIn1 = Math.hypot(_curInOff.x, _curInOff.z);
      for (let i = 1; i < SUBDIVISIONS; i++) {
        const t = i / SUBDIVISIONS;
        _vTip.copy(_prevTipOff).lerp(_curTipOff, t);
        const hTip = Math.hypot(_vTip.x, _vTip.z);
        if (hTip > 1e-4) {
          const want = rTip0 + (rTip1 - rTip0) * t;
          _vTip.x *= want / hTip;
          _vTip.z *= want / hTip;
        }
        _vTip.add(center);

        _vInner.copy(_prevInOff).lerp(_curInOff, t);
        const hIn = Math.hypot(_vInner.x, _vInner.z);
        if (hIn > 1e-4) {
          const want = rIn0 + (rIn1 - rIn0) * t;
          _vInner.x *= want / hIn;
          _vInner.z *= want / hIn;
        }
        _vInner.add(center);
        this.pushSample(slot, _vTip, _vInner);
      }
    }
    this.pushSample(slot, tip, inner);
  }

  private pushSample(slot: TrailSlot, tip: THREE.Vector3, inner: THREE.Vector3): void {
    if (slot.count >= MAX_SAMPLES) {
      for (let i = 0; i < MAX_SAMPLES - 1; i++) {
        slot.tips[i].copy(slot.tips[i + 1]);
        slot.inners[i].copy(slot.inners[i + 1]);
      }
      slot.count = MAX_SAMPLES - 1;
    }
    slot.tips[slot.count].copy(tip);
    slot.inners[slot.count].copy(inner);
    slot.count++;
    slot.dirty = true;
  }

  private rebuildGeometry(slot: TrailSlot): void {
    const pos = slot.posAttr.array as Float32Array;
    const uv = slot.uvAttr.array as Float32Array;
    const col = slot.colAttr.array as Float32Array;
    const n = slot.count;
    const ir = slot.innerCol.r;
    const ig = slot.innerCol.g;
    const ib = slot.innerCol.b;
    const tr = slot.tipCol.r;
    const tg = slot.tipCol.g;
    const tb = slot.tipCol.b;
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 1;
      const vi = i * 2;
      const inPt = slot.inners[i];
      const tipPt = slot.tips[i];

      pos[vi * 3] = inPt.x;
      pos[vi * 3 + 1] = inPt.y;
      pos[vi * 3 + 2] = inPt.z;
      pos[(vi + 1) * 3] = tipPt.x;
      pos[(vi + 1) * 3 + 1] = tipPt.y;
      pos[(vi + 1) * 3 + 2] = tipPt.z;

      uv[vi * 2] = u;
      uv[vi * 2 + 1] = 0;
      uv[(vi + 1) * 2] = u;
      uv[(vi + 1) * 2 + 1] = 1;

      col[vi * 3] = ir;
      col[vi * 3 + 1] = ig;
      col[vi * 3 + 2] = ib;
      col[(vi + 1) * 3] = tr;
      col[(vi + 1) * 3 + 1] = tg;
      col[(vi + 1) * 3 + 2] = tb;
    }
    slot.posAttr.needsUpdate = true;
    slot.uvAttr.needsUpdate = true;
    slot.colAttr.needsUpdate = true;
    slot.mesh.geometry.setDrawRange(0, (n - 1) * 6);
  }
}
