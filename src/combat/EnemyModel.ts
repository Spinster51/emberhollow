import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';
import type { Enemy } from './Enemy';

const box = (w: number, h: number, d: number, mat: THREE.Material, outline = true) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  if (outline) addOutline(m);
  return m;
};

const eyeMat = new THREE.MeshBasicMaterial({ color: 0x140a0a });
const eyes = (parent: THREE.Object3D, y: number, z: number, gap: number, size = 0.07) => {
  for (const x of [-gap, gap]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(size, size * 1.3, 0.02), eyeMat);
    e.position.set(x, y, z);
    parent.add(e);
  }
};

/** Placeholder blocky enemy with procedural poses; real models come with the asset pass. */
export class EnemyModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private parts: Record<string, THREE.Object3D> = {};
  private phase = 0;
  private flash = 0;
  private lastHp: number;
  private mats: THREE.MeshToonMaterial[] = [];

  constructor(readonly enemy: Enemy) {
    this.lastHp = enemy.hp;
    this.root.add(this.body);
    if (enemy.kind === 'slime') this.buildSlime();
    else if (enemy.kind === 'boar') this.buildBoar();
    else this.buildBandit();
    this.body.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m instanceof THREE.MeshToonMaterial) this.mats.push(m);
    });
  }

  private mat(color: number, extra: THREE.MeshToonMaterialParameters = {}) {
    return toonMaterial(color, { emissive: 0xffffff, emissiveIntensity: 0, ...extra });
  }

  private buildSlime(): void {
    const jelly = box(0.85, 0.65, 0.85, this.mat(0x58c25a, { transparent: true, opacity: 0.88 }));
    jelly.position.y = 0.325;
    const core = box(0.35, 0.3, 0.35, this.mat(0x2f7d3a), false);
    core.position.y = 0.3;
    eyes(jelly, 0.08, -0.43, 0.15, 0.09);
    this.body.add(jelly, core);
  }

  private buildBoar(): void {
    const hide = this.mat(0x6b4a33);
    const dark = this.mat(0x3e2a1d);
    const torso = box(0.9, 0.75, 1.5, hide);
    torso.position.y = 0.75;
    const mane = box(0.5, 0.2, 1.1, dark, false);
    mane.position.set(0, 1.18, 0.05);
    const head = new THREE.Group();
    head.position.set(0, 0.8, -0.8);
    const skull = box(0.6, 0.55, 0.55, hide);
    skull.position.z = -0.2;
    const snout = box(0.36, 0.28, 0.25, this.mat(0xc98c79), false);
    snout.position.set(0, -0.08, -0.55);
    for (const x of [-0.2, 0.2]) {
      const tusk = box(0.07, 0.25, 0.07, this.mat(0xf2ead2), false);
      tusk.position.set(x, 0.0, -0.55);
      tusk.rotation.x = -0.4;
      head.add(tusk);
    }
    eyes(skull, 0.1, -0.28, 0.17);
    head.add(skull, snout);
    this.parts.head = head;
    this.body.add(torso, mane, head);
    const legs: [number, number][] = [[-0.3, -0.5], [0.3, -0.5], [-0.3, 0.5], [0.3, 0.5]];
    legs.forEach(([x, z], i) => {
      const g = new THREE.Group();
      g.position.set(x, 0.45, z);
      const l = box(0.2, 0.45, 0.2, dark);
      l.position.y = -0.225;
      g.add(l);
      this.parts[`leg${i}`] = g;
      this.body.add(g);
    });
  }

  private buildBandit(): void {
    const skin = this.mat(0xd9a77f);
    const coat = this.mat(0x6e4b3a);
    const cloth = this.mat(0xa8322c);
    const pants = this.mat(0x3a3530);
    const torso = new THREE.Group();
    torso.position.y = 0.95;
    this.body.add(torso);
    this.parts.torso = torso;
    const chest = box(0.55, 0.65, 0.32, coat);
    chest.position.y = 0.2;
    const head = box(0.42, 0.42, 0.42, skin);
    head.position.y = 0.75;
    const bandana = box(0.46, 0.14, 0.46, cloth, false);
    bandana.position.y = 0.14;
    const mask = box(0.44, 0.14, 0.05, cloth, false);
    mask.position.set(0, -0.1, -0.21);
    head.add(bandana, mask);
    eyes(head, 0.04, -0.215, 0.1, 0.06);
    torso.add(chest, head);
    const limb = (name: string, x: number, y: number, len: number, w: number, mat: THREE.Material) => {
      const g = new THREE.Group();
      g.position.set(x, y, 0);
      const m = box(w, len, w, mat);
      m.position.y = -len / 2;
      g.add(m);
      torso.add(g);
      this.parts[name] = g;
      return g;
    };
    limb('armL', -0.36, 0.45, 0.6, 0.17, coat);
    const armR = limb('armR', 0.36, 0.45, 0.6, 0.17, coat);
    limb('legL', -0.14, -0.12, 0.8, 0.2, pants);
    limb('legR', 0.14, -0.12, 0.8, 0.2, pants);
    // Rusty sword in the right hand, pointing forward.
    const sword = new THREE.Group();
    sword.position.set(0, -0.6, 0);
    const blade = box(0.07, 0.07, 0.85, this.mat(0xb7b2a8), false);
    blade.position.z = -0.5;
    const guard = box(0.25, 0.06, 0.06, this.mat(0x5b3a20), false);
    guard.position.z = -0.08;
    sword.add(blade, guard);
    armR.add(sword);
  }

  update(dt: number): void {
    const e = this.enemy;
    this.root.position.copy(e.pos);
    this.root.rotation.set(0, e.facing, 0);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.scale.set(1, 1, 1);

    // White flash when hit.
    if (e.hp < this.lastHp) this.flash = 1;
    this.lastHp = e.hp;
    this.flash = Math.max(0, this.flash - dt * 8);
    for (const m of this.mats) m.emissiveIntensity = this.flash * 0.8;

    const speed = Math.hypot(e.vel.x, e.vel.z);
    this.phase += dt * (2 + speed * 2.5);

    if (e.state === 'dead') {
      // Topple, then sink into the ground.
      const t = e.stateTime;
      this.body.rotation.z = Math.min(1, t * 3) * (Math.PI / 2) * (e.kind === 'slime' ? 0 : 1);
      if (e.kind === 'slime') this.body.scale.set(1 + t, Math.max(0.05, 1 - t * 2), 1 + t);
      this.body.position.y = -Math.max(0, t - 1.2) * 0.8;
      this.root.visible = t < 3;
      return;
    }
    this.root.visible = true;

    if (e.kind === 'slime') this.animSlime(dt);
    else if (e.kind === 'boar') this.animBoar(speed);
    else this.animBandit(speed, dt);
  }

  private animSlime(_dt: number): void {
    const e = this.enemy;
    let sy = 1 + Math.sin(this.phase * 2) * 0.08;
    let hop = 0;
    if (e.state === 'windup') sy = 1 - Math.min(1, e.stateTime / e.stats.windup) * 0.4;
    else if (e.state === 'active') {
      const k = Math.min(1, e.stateTime / e.stats.active);
      hop = Math.sin(k * Math.PI) * 0.9;
      sy = 1.25;
    } else if (e.state === 'stagger') sy = 0.75;
    else if (Math.hypot(e.vel.x, e.vel.z) > 0.3) hop = Math.abs(Math.sin(this.phase * 1.5)) * 0.25;
    this.body.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
    this.body.position.y = hop;
  }

  private animBoar(speed: number): void {
    const e = this.enemy;
    const swing = Math.sin(this.phase * 1.6) * Math.min(1, speed / 3) * 0.7;
    for (let i = 0; i < 4; i++) {
      const leg = this.parts[`leg${i}`];
      leg.rotation.x = (i === 0 || i === 3 ? 1 : -1) * swing;
    }
    const head = this.parts.head;
    head.rotation.x = 0;
    if (e.state === 'windup') {
      // Head down, scrape the ground.
      head.rotation.x = 0.45;
      this.parts.leg0.rotation.x = Math.sin(e.stateTime * 25) * 0.6;
      this.body.rotation.x = 0.08;
    } else if (e.state === 'active') {
      head.rotation.x = 0.3;
      this.body.position.y = Math.abs(Math.sin(this.phase * 1.6)) * 0.1;
    } else if (e.state === 'stagger') {
      this.body.rotation.z = Math.sin(e.stateTime * 20) * 0.1;
    }
  }

  private animBandit(speed: number, dt: number): void {
    const e = this.enemy;
    const p = this.parts;
    const s = Math.sin(this.phase * 1.4) * Math.min(1, speed / 4) * 0.8;
    let armR = -0.5;
    let armL = -s * 0.8;
    let legL = s;
    let legR = -s;
    let twist = 0;
    if (e.state === 'windup') {
      const k = Math.min(1, e.stateTime / (e.stats.windup * (e.comboStep > 0 ? 0.6 : 1)));
      armR = -0.5 - k * 2.2;
      twist = k * 0.5;
    } else if (e.state === 'active' || e.state === 'recover') {
      const k = e.state === 'active' ? Math.min(1, e.stateTime / e.stats.active) : 1;
      armR = -2.7 + k * 3.0;
      twist = 0.5 - k * 1.0;
      armL = 0.3;
    } else if (e.state === 'stagger') {
      armR = 0.2;
      armL = 0.4;
      p.torso.rotation.x = 0.25;
    }
    const lerp = Math.min(1, dt * 20);
    p.armR.rotation.x += (armR - p.armR.rotation.x) * lerp;
    p.armL.rotation.x += (armL - p.armL.rotation.x) * lerp;
    p.legL.rotation.x += (legL - p.legL.rotation.x) * lerp;
    p.legR.rotation.x += (legR - p.legR.rotation.x) * lerp;
    p.torso.rotation.y += (twist - p.torso.rotation.y) * lerp;
    if (e.state !== 'stagger') p.torso.rotation.x *= 0.8;
  }
}
