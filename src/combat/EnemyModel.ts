import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';
import { BOSS_MOVES, type Enemy } from './Enemy';

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
    switch (enemy.kind) {
      case 'slime':
        this.buildSlime();
        break;
      case 'boar':
        this.buildBoar();
        break;
      case 'wolf':
        this.buildWolf();
        break;
      case 'spider':
        this.buildSpider();
        break;
      case 'bandit':
        this.buildHumanoid({ skin: 0xd9a77f, coat: 0x6e4b3a, pants: 0x3a3530, cloth: 0xa8322c, weapon: 'sword' });
        break;
      case 'skeleton':
        this.buildHumanoid({ skin: 0xe8e0c8, coat: 0xd8cfb4, pants: 0xcfc5a8, weapon: 'sword', thin: true });
        break;
      case 'goblin':
        this.buildHumanoid({ skin: 0x6fae4a, coat: 0x5a4a2a, pants: 0x3e3420, weapon: 'bow', scale: 0.75 });
        break;
      case 'cultist':
        this.buildHumanoid({ skin: 0xc9a080, coat: 0x4a2a5e, pants: 0x3a2048, cloth: 0x2a1838, weapon: 'staff', hood: true });
        break;
      case 'golem':
        this.buildHumanoid({ skin: 0x8a8274, coat: 0x7a7266, pants: 0x6a6258, weapon: 'none', scale: 1.7, glow: true });
        break;
      case 'warden':
        this.buildHumanoid({ skin: 0x3e3632, coat: 0x5a2a1e, pants: 0x2e2724, cloth: 0xd0501e, weapon: 'sword', scale: 2.3, glow: true });
        break;
    }
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

  private buildWolf(): void {
    const fur = this.mat(0x7d7f86);
    const dark = this.mat(0x4a4c52);
    const torso = box(0.6, 0.55, 1.3, fur);
    torso.position.y = 0.75;
    const head = new THREE.Group();
    head.position.set(0, 0.95, -0.75);
    const skull = box(0.45, 0.42, 0.45, fur);
    const snout = box(0.24, 0.2, 0.35, dark, false);
    snout.position.set(0, -0.08, -0.35);
    for (const x of [-0.14, 0.14]) {
      const ear = box(0.1, 0.18, 0.08, dark, false);
      ear.position.set(x, 0.28, 0.05);
      head.add(ear);
    }
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd23a });
    for (const x of [-0.11, 0.11]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.02), eyeMat);
      e.position.set(x, 0.06, -0.23);
      head.add(e);
    }
    head.add(skull, snout);
    const tail = box(0.12, 0.12, 0.5, dark, false);
    tail.position.set(0, 0.95, 0.8);
    tail.rotation.x = 0.5;
    this.parts.head = head;
    this.body.add(torso, head, tail);
    this.addLegs(dark, 0.45, 0.4, 0.45);
  }

  private addLegs(mat: THREE.Material, hip: number, x: number, z: number): void {
    const legs: [number, number][] = [[-x / 2 - 0.05, -z], [x / 2 + 0.05, -z], [-x / 2 - 0.05, z], [x / 2 + 0.05, z]];
    legs.forEach(([lx, lz], i) => {
      const g = new THREE.Group();
      g.position.set(lx, hip, lz);
      const l = box(0.17, hip, 0.17, mat);
      l.position.y = -hip / 2;
      g.add(l);
      this.parts[`leg${i}`] = g;
      this.body.add(g);
    });
  }

  private buildSpider(): void {
    const shell = this.mat(0x2a2230);
    const mark = this.mat(0xb03030);
    const abdomen = box(0.8, 0.55, 0.9, shell);
    abdomen.position.set(0, 0.5, 0.45);
    const stripe = box(0.2, 0.06, 0.6, mark, false);
    stripe.position.set(0, 0.79, 0.45);
    const head = box(0.5, 0.35, 0.45, shell);
    head.position.set(0, 0.42, -0.25);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3a3a });
    for (const [x, y] of [[-0.12, 0.08], [0.12, 0.08], [-0.06, 0.0], [0.06, 0.0]]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), eyeMat);
      e.position.set(x, y, -0.23);
      head.add(e);
    }
    this.body.add(abdomen, stripe, head);
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1;
      const k = i % 4;
      const g = new THREE.Group();
      g.position.set(side * 0.25, 0.45, -0.35 + k * 0.22);
      const upper = box(0.55, 0.07, 0.07, shell, false);
      upper.position.x = side * 0.27;
      upper.rotation.z = side * 0.5;
      const lower = box(0.07, 0.5, 0.07, shell, false);
      lower.position.set(side * 0.52, -0.1, 0);
      g.add(upper, lower);
      this.parts[`leg${i}`] = g;
      this.body.add(g);
    }
  }

  private buildHumanoid(o: {
    skin: number; coat: number; pants: number; cloth?: number;
    weapon: 'sword' | 'bow' | 'staff' | 'none'; scale?: number; thin?: boolean; hood?: boolean; glow?: boolean;
  }): void {
    const skin = this.mat(o.skin);
    const coat = this.mat(o.coat);
    const pants = this.mat(o.pants);
    const torso = new THREE.Group();
    torso.position.y = 0.95;
    this.body.add(torso);
    this.baseScale = o.scale ?? 1;
    this.parts.torso = torso;
    const chest = box(o.thin ? 0.4 : 0.55, 0.65, o.thin ? 0.2 : 0.32, coat);
    chest.position.y = 0.2;
    const head = box(0.42, 0.42, 0.42, skin);
    head.position.y = 0.75;
    if (o.cloth !== undefined && !o.hood) {
      const cloth = this.mat(o.cloth);
      const bandana = box(0.46, 0.14, 0.46, cloth, false);
      bandana.position.y = 0.14;
      const mask = box(0.44, 0.14, 0.05, cloth, false);
      mask.position.set(0, -0.1, -0.21);
      head.add(bandana, mask);
    }
    if (o.hood) {
      const hood = box(0.5, 0.5, 0.5, this.mat(o.cloth ?? o.coat), false);
      hood.position.set(0, 0.05, 0.04);
      const face = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.02), new THREE.MeshBasicMaterial({ color: 0x0a0610 }));
      face.position.set(0, -0.02, -0.215);
      head.add(hood, face);
      const glowEyes = new THREE.MeshBasicMaterial({ color: 0xd070ff });
      for (const x of [-0.08, 0.08]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), glowEyes);
        e.position.set(x, 0.02, -0.225);
        head.add(e);
      }
    } else if (o.glow) {
      const glowEyes = new THREE.MeshBasicMaterial({ color: 0xff9a3a });
      for (const x of [-0.1, 0.1]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.02), glowEyes);
        e.position.set(x, 0.04, -0.215);
        head.add(e);
      }
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.02), glowEyes);
      core.position.set(0, 0.25, -0.17);
      torso.add(core);
    } else {
      eyes(head, 0.04, -0.215, 0.1, 0.06);
    }
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
    const w = o.thin ? 0.12 : 0.17;
    const armL = limb('armL', -0.36, 0.45, 0.6, w, o.thin ? skin : coat);
    const armR = limb('armR', 0.36, 0.45, 0.6, w, o.thin ? skin : coat);
    limb('legL', -0.14, -0.12, 0.8, o.thin ? 0.14 : 0.2, pants);
    limb('legR', 0.14, -0.12, 0.8, o.thin ? 0.14 : 0.2, pants);
    const hand = new THREE.Group();
    hand.position.set(0, -0.6, 0);
    if (o.weapon === 'sword') {
      const blade = box(0.07, 0.07, 0.85, this.mat(0xb7b2a8), false);
      blade.position.z = -0.5;
      const guard = box(0.25, 0.06, 0.06, this.mat(0x5b3a20), false);
      guard.position.z = -0.08;
      hand.add(blade, guard);
      armR.add(hand);
    } else if (o.weapon === 'bow') {
      // Bow held upright in the left hand.
      const wood = this.mat(0x7a4a26);
      const top = box(0.05, 0.5, 0.05, wood, false);
      top.position.set(0, 0.22, -0.1);
      top.rotation.x = 0.35;
      const bottom = box(0.05, 0.5, 0.05, wood, false);
      bottom.position.set(0, -0.22, -0.1);
      bottom.rotation.x = -0.35;
      hand.add(top, bottom);
      armL.add(hand);
    } else if (o.weapon === 'staff') {
      const pole = box(0.06, 1.5, 0.06, this.mat(0x3a2a20), false);
      pole.position.y = 0.3;
      const gem = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshBasicMaterial({ color: 0xb04aff }));
      gem.position.y = 1.1;
      hand.add(pole, gem);
      armR.add(hand);
    }
    this.weapon = o.weapon;
  }

  private weapon: 'sword' | 'bow' | 'staff' | 'none' = 'none';
  private baseScale = 1;

  update(dt: number): void {
    const e = this.enemy;
    this.root.position.copy(e.pos);
    this.root.rotation.set(0, e.facing, 0);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.scale.setScalar(this.baseScale);

    // White flash when hit.
    if (e.hp < this.lastHp) this.flash = 1;
    this.lastHp = e.hp;
    this.flash = Math.max(0, this.flash - dt * 8);
    // The boss smoulders in its second phase.
    const ember = e.phase === 2 ? 0.25 + Math.sin(performance.now() / 120) * 0.1 : 0;
    for (const m of this.mats) m.emissiveIntensity = Math.max(this.flash * 0.8, ember);

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
    else if (e.kind === 'boar' || e.kind === 'wolf') this.animBoar(speed);
    else if (e.kind === 'spider') this.animSpider(speed);
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

  private animSpider(speed: number): void {
    const e = this.enemy;
    const k = Math.min(1, speed / 3);
    for (let i = 0; i < 8; i++) {
      const leg = this.parts[`leg${i}`];
      leg.rotation.y = Math.sin(this.phase * 2.5 + i * 1.3) * 0.35 * k;
    }
    if (e.state === 'windup') this.body.rotation.x = -0.25;
    else if (e.state === 'active') this.body.position.y = Math.sin(Math.min(1, e.stateTime / e.stats.active) * Math.PI) * 0.6;
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
    const wind = e.move ? BOSS_MOVES[e.move].windup / e.rage() : e.stats.windup;
    let style: string = e.stats.style;
    if (e.move === 'slam' || e.move === 'nova') style = 'slam';
    else if (e.move === 'volley') style = 'ranged';
    if (e.state === 'phase') {
      // Roar: arms wide and high.
      armL = armR = -2.6;
      p.torso.rotation.x = -0.25;
    } else if (style === 'ranged' && (e.state === 'windup' || e.state === 'active')) {
      // Draw the bow / raise the staff toward the target.
      armL = -1.55;
      armR = this.weapon === 'bow' ? -1.45 : -2.4;
      twist = this.weapon === 'bow' ? -0.3 : 0;
    } else if (style === 'slam' && e.state === 'windup') {
      const k = Math.min(1, e.stateTime / wind);
      armL = armR = -3.0 * k;
      p.torso.rotation.x = -0.2 * k;
    } else if (style === 'slam' && (e.state === 'active' || e.state === 'recover')) {
      armL = armR = -0.9;
      p.torso.rotation.x = 0.35;
    } else if (e.state === 'windup') {
      const k = Math.min(1, e.stateTime / (wind * (e.comboStep > 0 ? 0.6 : 1)));
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
