import * as THREE from 'three';
import { addOutline, addSkinnedOutline, shellMaterial, toonMaterial } from '../core/toon';
import { BOSS_MOVES, PHASE_ROAR, type Enemy } from './Enemy';
import { cloneModel, loadModel, modelClips, modelState, shareSkeletons } from '../core/models';
import { Rig } from '../core/rig';
import { ENEMY_ART, HUMANOID, type Ears, type EnemyArt, type EnemyAttack, type PlantedHop, type Stride } from '../art/assets';

/** Every file an enemy's art needs (body, clips, weapons, preloads). */
const artFiles = (art: EnemyArt): string[] => [
  art.body, ...(art.clips ?? []), ...(art.weapons ?? []).map((w) => w.file), ...(art.preload ?? []),
];

/** The clip names an art uses (the rig gets only these: one action per clip per enemy adds up). */
function usedClips(art: EnemyArt): Set<string> {
  const out = new Set([art.idle, art.walk[0], art.run[0], art.death]);
  for (const c of [art.combatIdle, art.hit, art.knockdown, art.spawn?.clip, art.jog?.[0], art.back?.[0], art.strafe?.left, art.strafe?.right]) if (c) out.add(c);
  for (const atk of [...art.attacks, ...Object.values(art.boss ?? {})]) {
    if (!atk) continue;
    out.add(atk.clip);
    if (atk.windup) out.add(atk.windup.clip);
    if (atk.loop) out.add(atk.loop.clip);
    if (atk.recover) out.add(atk.recover);
  }
  return out;
}

/** Culling spheres per body file (model space, rest pose, padded for the clips' reach). */
const cullSpheres = new Map<string, THREE.Sphere>();
/** Repainted copies of textures (stone golem, goblin skin), made once per texture and recipe. */
const paintedMaps = new Map<string, THREE.Texture>();
/** The boss's phase-2 smoulder colour. */
const EMBER = new THREE.Color(0xff5a1e);
const WHITE = new THREE.Color(0xffffff);
const UP = new THREE.Vector3(0, 1, 0);
/**
 * Locomotion clips play at the speed that matches their stride to the ground speed, within these limits
 * (`EnemyArt.clipMax` raises the top one per kind); the AI's speeds all fall inside them.
 */
const CLIP_MIN = 0.4;
const CLIP_MAX = 2.5;
const clipSpeed = (v: number, max = CLIP_MAX) => Math.min(max, Math.max(CLIP_MIN, v));
/** Backing off faster than this times the backwards walk's stride turns the model round to run (with a margin back). */
const BACK_MAX = 2.2;
/** How far (radians) a humanoid turns off its logic facing into a strafe or backwards walk; the rest slides. */
const YAW_MAX = 0.87;
/** Margin (radians) before the travel direction switches clip sets (forward, strafes, backwards). */
const DIR_MARGIN = 0.2;
/** KayKit palette atlases: 8 × 4 cells. */
const ATLAS: [number, number] = [8, 4];
const _box = new THREE.Box3();
const _mbox = new THREE.Box3();
const _v = new THREE.Vector3();
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const frac = (x: number) => x - Math.floor(x);

type MoveMode = 'fwd' | 'left' | 'right' | 'back' | 'flee';

/** A copy of a texture repainted by `paint` (made once per recipe). Falls back to the original. */
function paintMap(src: THREE.Texture, recipe: string, paint: (d: ImageData) => void): THREE.Texture {
  const key = `${src.uuid}|${recipe}`;
  let t = paintedMaps.get(key);
  if (t) return t;
  t = src;
  const img = src.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  const cv = img?.width ? document.createElement('canvas') : null;
  const ctx = cv?.getContext('2d', { willReadFrequently: true });
  if (img && cv && ctx) {
    cv.width = img.width;
    cv.height = img.height;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height);
    paint(d);
    ctx.putImageData(d, 0, 0);
    const c = new THREE.CanvasTexture(cv);
    c.flipY = src.flipY;
    c.colorSpace = src.colorSpace;
    c.magFilter = src.magFilter;
    c.minFilter = src.minFilter;
    c.wrapS = src.wrapS;
    c.wrapT = src.wrapT;
    c.name = `${src.name}_${recipe.length > 16 ? 'recolor' : recipe}`;
    t = c;
  }
  paintedMaps.set(key, t);
  return t;
}

const luma = (p: Uint8ClampedArray, i: number) => 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];

/** A texture's colours turned to grey (luma), for the stone golem. */
const stoneMap = (src: THREE.Texture) =>
  paintMap(src, 'stone', (d) => {
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) p[i] = p[i + 1] = p[i + 2] = luma(p, i);
  });

/**
 * Palette cells ("column,row" of the atlas) repainted in a colour; each pixel keeps its shade (its luma
 * against the cell's mean), so the cell's gradient survives. The goblin's skin on the bandit's texture.
 */
const recolorMap = (src: THREE.Texture, cells: Record<string, number>) =>
  paintMap(src, JSON.stringify(cells), (d) => {
    const p = d.data;
    const cw = d.width / ATLAS[0];
    const ch = d.height / ATLAS[1];
    for (const [cell, hex] of Object.entries(cells)) {
      const [cx, cy] = cell.split(',').map(Number);
      const x0 = Math.round(cx * cw), x1 = Math.round((cx + 1) * cw);
      const y0 = Math.round(cy * ch), y1 = Math.round((cy + 1) * ch);
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += luma(p, (y * d.width + x) * 4);
      const mean = Math.max(1, sum / ((x1 - x0) * (y1 - y0)));
      const rgb = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * d.width + x) * 4;
          const k = luma(p, i) / mean;
          for (let c = 0; c < 3; c++) p[i + c] = rgb[c] * k;
        }
      }
    }
  });

/**
 * One pointed ear: a four-sided cone along +Y, its base at the origin, flattened to a leaf (broad across
 * x, thin along z, so it shows its broad side from the front); shared by every goblin.
 */
const earGeometries = new Map<string, THREE.BufferGeometry>();
function earGeometry(ears: Ears): THREE.BufferGeometry {
  const key = `${ears.length}/${ears.width}`;
  let g = earGeometries.get(key);
  if (!g) {
    g = new THREE.ConeGeometry(ears.width / 2, ears.length, 4);
    g.translate(0, ears.length / 2, 0);
    g.scale(1, 1, 1 / 3);
    g.computeVertexNormals();
    earGeometries.set(key, g);
  }
  return g;
}

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

/**
 * An enemy's body. Shows its rigged glTF model (`ENEMY_ART`) once the files have loaded, and the
 * blocky placeholder with procedural poses until then, or for good if a file fails to load.
 * Both read the same Enemy state each frame; attack clips are scrubbed to the game's timings.
 */
export class EnemyModel {
  readonly root = new THREE.Group();
  /** The placeholder: shown while loading and if a model fails. */
  private body = new THREE.Group();
  private parts: Record<string, THREE.Object3D> = {};
  private phase = 0;
  private flash = 0;
  private lastHp: number;
  private mats: THREE.MeshToonMaterial[] = [];

  /** The rigged model, when loaded: `rigBody` hops and tilts it, `rigHolder` turns and scales it. */
  rig: Rig | null = null;
  private rigBody = new THREE.Group();
  private rigHolder = new THREE.Group();
  /** The art shown (picked on the first update unless given: a summoned skeleton is marked after it is built). */
  private art: EnemyArt | null;
  /** 'pending' until the files settle; then the rig, or the placeholder for good. */
  private artState: 'pending' | 'rig' | 'blocky' = 'pending';
  /** This enemy's own copies of the model's materials (hit flash, smoulder, tints). */
  private rigMats: THREE.MeshToonMaterial[] = [];
  /** Glowing eye materials (left out of the flash). */
  readonly glowMats: THREE.MeshToonMaterial[] = [];
  private lastState = '';
  private lastStateTime = 0;
  /** Locomotion gaits, slowest first (walk, jog, run; one entry when they share a clip). */
  private gaits: Stride[] = [];
  /** The gait playing (index into `gaits`), with a margin so neighbouring gaits do not flicker. */
  private gait = 0;
  /** Which way the model travels against its facing: picks the forward, strafe or backwards clips. */
  private moveMode: MoveMode = 'fwd';
  /**
   * Visual turn (radians) of the model off the logic facing: into a strafe's diagonal, round to run when
   * backing off fast, toward a beast's motion. Locomotion only; it eases back to 0 for every attack, so the
   * model faces the target over the wind-up (the hit arcs use the logic facing either way).
   */
  yaw = 0;
  private yawTarget = 0;
  /** The last locomotion clip, its stride-matched speed (`want`) and the speed it plays at (`rate`). Read by tests. */
  readonly loco = { clip: '', mode: 'fwd' as MoveMode, want: 0, rate: 0 };
  /** Seconds since this model was made (a summoned add's rise). */
  private age = 0;

  /** `art` can be given by tests (e.g. a missing file to check the fallback). */
  constructor(readonly enemy: Enemy, art?: EnemyArt) {
    this.lastHp = enemy.hp;
    this.art = art ?? null;
    this.root.add(this.body, this.rigBody);
    this.rigBody.add(this.rigHolder);
    this.rigHolder.rotation.y = Math.PI; // the models face +Z; the game faces -Z
    this.rigBody.visible = false;
    for (const f of artFiles(art ?? ENEMY_ART[enemy.kind])) void loadModel(f).catch(() => {});
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

  /** True once the rigged model is shown (false: placeholder). */
  get usingRig(): boolean {
    return this.rig !== null;
  }

  /** Release the rig and this enemy's own materials (a summoned add leaving). */
  dispose(): void {
    this.rig?.dispose();
    for (const m of [...this.rigMats, ...this.glowMats]) m.dispose();
    this.root.removeFromParent();
  }

  /**
   * `animate` false (far away and asleep): the rig keeps its pose and its mixer does not advance;
   * position, facing and the death sink still follow the enemy.
   */
  update(dt: number, animate = true): void {
    const e = this.enemy;
    this.syncRig();
    this.age += dt;
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
    if (this.rig) {
      const f = this.flash * 0.8;
      for (const m of this.rigMats) {
        m.emissive.copy(f >= ember ? WHITE : EMBER);
        m.emissiveIntensity = Math.max(f, ember);
      }
      this.updateRig(this.rig, dt, animate);
      return;
    }

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

  // ---------------------------------------------------------------- rigged model

  /** Swap in the rigged model once its files are ready; keep the placeholder if one fails. */
  private syncRig(): void {
    if (this.artState !== 'pending') return;
    const art = (this.art ??= this.enemy.summoner ? ENEMY_ART.add : ENEMY_ART[this.enemy.kind]);
    const files = artFiles(art);
    const states = files.map(modelState);
    if (states.includes('none')) {
      for (const f of files) void loadModel(f).catch(() => {});
      return;
    }
    if (states.includes('loading')) return;
    // A missing body or clip file keeps the placeholder; a missing weapon is only left out.
    const core = [art.body, ...(art.clips ?? [])];
    const clone = core.some((f) => modelState(f) === 'failed') ? null : cloneModel(art.body);
    if (!clone) {
      this.artState = 'blocky';
      return;
    }
    this.buildRig(art, clone);
    this.artState = 'rig';
  }

  private buildRig(art: EnemyArt, clone: THREE.Object3D): void {
    shareSkeletons(clone);
    const used = usedClips(art);
    const clips = (art.clips ? art.clips.flatMap(modelClips) : modelClips(art.body)).filter((c) => used.has(c.name));
    const rig = new Rig(clone, clips);
    // The pack's own hand-slot props: only the listed ones stay (the bandit's knives, the goblin's crossbow).
    const slots = [rig.node('handslot.r'), rig.node('handslot.l')];
    clone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.parent && slots.includes(o.parent)) o.visible = !!art.props?.includes(o.name);
    });
    this.fitCulling(art, clone);
    for (const w of art.weapons ?? []) {
      const bone = rig.node(w.bone);
      const held = cloneModel(w.file);
      if (!bone || !held) continue;
      held.position.set(...w.pos);
      held.rotation.set(...w.rot);
      bone.add(held);
    }
    // Outlines are grown in model units (0.04 when loaded): models shrunk below the player's scale
    // get thicker ones, so every outline is at least the player's ~3 cm.
    const shell = art.scale < HUMANOID.scale ? +(0.04 * (HUMANOID.scale / art.scale)).toFixed(4) : 0.04;
    const outline = art.scale < HUMANOID.scale ? shellMaterial(shell) : null;
    // Own materials: the flash and the smoulder are per enemy; colours per kind.
    const made = new Map<THREE.Material, THREE.MeshToonMaterial>();
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.name.endsWith('_outline') && outline) mesh.material = outline;
      if (!mesh.isMesh || mesh.name.endsWith('_outline')) return;
      const src = mesh.material as THREE.MeshToonMaterial;
      let m = made.get(src);
      if (!m) {
        m = src.clone();
        const named = art.colors?.[src.name];
        if (named !== undefined) m.color.setHex(named);
        if (art.tint !== undefined) m.color.multiply(new THREE.Color(art.tint));
        if (art.recolor && m.map) m.map = recolorMap(m.map, art.recolor);
        if (art.brighten !== undefined) m.color.multiplyScalar(art.brighten);
        if (art.stone !== undefined) {
          if (m.map) m.map = stoneMap(m.map);
          m.color.multiply(new THREE.Color(art.stone));
        }
        if (src.name === 'Glow') {
          // Eyes: the emissive colour alone (a lit white base would wash a tint out).
          if (art.glow !== undefined) {
            m.color.setHex(0x000000);
            m.emissive.setHex(art.glow);
            m.emissiveIntensity = 1;
          }
          this.glowMats.push(m);
        } else {
          m.emissive.setHex(0xffffff);
          m.emissiveIntensity = 0;
          this.rigMats.push(m);
        }
        made.set(src, m);
      }
      mesh.material = m;
    });
    if (art.ears) this.addEars(art.ears, rig, clone, shell);
    const gaits = [art.walk, art.jog, art.run].filter((g): g is Stride => !!g);
    this.gaits = gaits.filter((g, i) => i === 0 || g[0] !== gaits[i - 1][0] || g[1] !== gaits[i - 1][1]);
    this.rigHolder.scale.setScalar(art.scale);
    this.rigHolder.position.y = (art.lift ?? 0) * art.scale;
    this.rigHolder.add(clone);
    this.rig = rig;
    this.lastState = '';
    rig.play(art.idle, { fade: 0 });
    this.body.visible = false;
    this.rigBody.visible = true;
  }

  /**
   * Pointed ears on the head bone, placed in model space at rest (the clone is unposed and has no parent
   * yet, so its world space is model space) and carried by the bone from then on.
   */
  private addEars(ears: Ears, rig: Rig, clone: THREE.Object3D, shell: number): void {
    const head = rig.node(HUMANOID.head);
    if (!head) return;
    clone.updateMatrixWorld(true);
    const toHead = head.matrixWorld.clone().invert();
    const mat = toonMaterial(ears.color, { emissive: 0xffffff, emissiveIntensity: 0 });
    mat.name = 'Ears';
    this.rigMats.push(mat);
    const geo = earGeometry(ears);
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    for (const side of [1, -1]) {
      const ear = new THREE.Mesh(geo, mat);
      ear.name = side > 0 ? 'Ear_L' : 'Ear_R';
      ear.castShadow = true;
      q.setFromUnitVectors(UP, _v.set(side * ears.dir[0], ears.dir[1], ears.dir[2]).normalize());
      m.compose(_v.set(side * ears.at[0], ears.at[1], ears.at[2]), q, new THREE.Vector3(1, 1, 1));
      m.premultiply(toHead).decompose(ear.position, ear.quaternion, ear.scale);
      addSkinnedOutline(ear, shell);
      head.add(ear);
    }
  }

  /**
   * Skinned meshes are culled by a bounding sphere three.js computes once, from whatever pose they
   * are in then. Every skinned mesh gets the whole body's rest-pose sphere instead, padded so that
   * leaps, swings and death falls stay inside it (no popping at the screen edge).
   */
  private fitCulling(art: EnemyArt, clone: THREE.Object3D): void {
    clone.updateMatrixWorld(true);
    const skinned: THREE.SkinnedMesh[] = [];
    clone.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && skinned.push(o as THREE.SkinnedMesh));
    let sphere = cullSpheres.get(art.body);
    if (!sphere) {
      _box.makeEmpty();
      for (const m of skinned) {
        if (m.name.endsWith('_outline')) continue;
        m.computeBoundingBox();
        _box.union(_mbox.copy(m.boundingBox!).applyMatrix4(m.matrixWorld));
      }
      sphere = _box.getBoundingSphere(new THREE.Sphere());
      sphere.radius *= art.cullPad ?? 1.7;
      cullSpheres.set(art.body, sphere);
    }
    for (const m of skinned) {
      // The sphere is in model space: right for meshes placed at the model's origin (all of ours).
      if (m.matrixWorld.equals(clone.matrixWorld)) m.boundingSphere = sphere.clone();
      else m.frustumCulled = false;
    }
  }

  private updateRig(rig: Rig, dt: number, animate: boolean): void {
    const e = this.enemy;
    this.rigBody.position.set(0, 0, 0);
    this.rigBody.rotation.set(0, 0, 0);
    if (e.state === 'dead') {
      // The death clip, then sink into the ground (as the placeholder does).
      this.rigBody.position.y = -Math.max(0, e.stateTime - 1.2) * 0.8;
      this.root.visible = e.stateTime < 3;
    } else this.root.visible = true;
    if (!animate) return;
    this.yawTarget = 0;
    this.poseRig(rig, this.art!);
    // Ease into the travel direction while moving; back to the logic facing (quicker) for everything else.
    // A dying model keeps its turn.
    if (e.state !== 'dead') {
      const loco = e.state === 'idle' || e.state === 'chase' || e.state === 'return';
      this.yaw = wrapAngle(this.yaw + wrapAngle(this.yawTarget - this.yaw) * (1 - Math.exp(-(loco ? 10 : 18) * dt)));
    }
    this.rigHolder.rotation.y = Math.PI + this.yaw; // the models face +Z; the game faces -Z
    rig.update(dt);
  }

  /** Map the enemy's state onto the rig's clips. */
  private poseRig(rig: Rig, art: EnemyArt): void {
    const e = this.enemy;
    const entered = e.state !== this.lastState || e.stateTime < this.lastStateTime;
    this.lastState = e.state;
    this.lastStateTime = e.stateTime;
    switch (e.state) {
      case 'dead':
        if (entered) rig.play(art.death, { loop: false, fade: 0.1 });
        break;
      case 'stagger': {
        const clip = e.staggerKind === 'knockdown' ? (art.knockdown ?? art.hit) : art.hit;
        if (clip) {
          if (entered) rig.play(clip, { loop: false, fade: 0.05, restart: true });
          break;
        }
        // No hit clip (spider): rear back and settle.
        if (entered) rig.play(art.idle, { fade: 0.1 });
        this.rigBody.rotation.x = 0.35 * Math.sin(Math.min(1, e.stateTime / 0.35) * Math.PI);
        break;
      }
      case 'windup':
      case 'active':
      case 'recover':
        this.scrubAttack(rig, art);
        break;
      case 'phase': {
        const roar = art.boss?.phase;
        if (!roar) {
          rig.play(art.combatIdle ?? art.idle, { fade: 0.2 });
          break;
        }
        const k = Math.min(1, e.stateTime / PHASE_ROAR);
        rig.scrub(roar.clip, (roar.swing[0] + k * (roar.swing[1] - roar.swing[0])) * rig.duration(roar.clip), 0.15);
        break;
      }
      default:
        this.locomotion(rig, art);
    }
  }

  /**
   * Idle or a locomotion clip, its speed matched to the ground speed so the planted feet stay put; a
   * summoned add first rises. The travel direction against the facing picks the clip set: forward (walk,
   * jog or run by speed), a strafe, or walking backwards; the model turns by the rest (`yaw`). Beasts have
   * only forward clips and turn all the way toward their motion.
   */
  private locomotion(rig: Rig, art: EnemyArt): void {
    const e = this.enemy;
    if (art.spawn && e.summoner && this.age < rig.duration(art.spawn.clip) / art.spawn.speed) {
      rig.play(art.spawn.clip, { loop: false, speed: art.spawn.speed, fade: 0 });
      return;
    }
    const h = Math.hypot(e.vel.x, e.vel.z);
    if (h < 0.3) {
      rig.play(e.state === 'chase' && art.combatIdle ? art.combatIdle : art.idle, { fade: 0.25 });
      // Setting off again starts from the walk (and climbs to the gait the speed asks for).
      this.gait = 0;
      this.moveMode = 'fwd';
      return;
    }
    // Travel direction against the facing: 0 ahead, + to the left (the game's heading convention).
    const theta = wrapAngle(Math.atan2(-e.vel.x, -e.vel.z) - e.facing);
    const mode = this.pickMode(art, theta, h);
    const st = art.strafe;
    const lean = (a: number) => Math.max(-YAW_MAX, Math.min(YAW_MAX, a));
    let stride: Stride;
    if ((mode === 'left' || mode === 'right') && st) {
      stride = [mode === 'left' ? st.left : st.right, st.ground];
      this.yawTarget = lean(theta - (mode === 'left' ? st.angle : -st.angle));
    } else if (mode === 'back' && art.back) {
      stride = art.back;
      this.yawTarget = lean(wrapAngle(theta - Math.PI));
    } else {
      stride = this.pickGait(art, h);
      // Humanoids lean into a forward diagonal; beasts, and anyone turning round to run, face the motion.
      this.yawTarget = mode === 'fwd' && (st || art.back) ? lean(theta) : theta;
    }
    const want = h / (stride[1] * art.scale);
    const rate = clipSpeed(want, art.clipMax);
    const act = rig.play(stride[0], { speed: rate, fade: 0.2 });
    Object.assign(this.loco, { clip: stride[0], mode, want, rate });
    const hop = art.plant?.[stride[0]];
    if (hop && act) this.plantHop(hop, act, rig.duration(stride[0]), h, rate, art);
  }

  /** Forward, a strafe or backwards: the clip set whose travel is nearest the direction (with a margin). */
  private pickMode(art: EnemyArt, theta: number, h: number): MoveMode {
    const st = art.strafe;
    const dirs: [MoveMode, number][] = [['fwd', 0]];
    if (st) dirs.push(['left', st.angle], ['right', -st.angle]);
    if (art.back || st) dirs.push(['back', Math.PI]);
    const cur = this.moveMode === 'flee' ? 'back' : this.moveMode;
    let best: MoveMode = 'fwd';
    let bestD = Infinity;
    for (const [m, a] of dirs) {
      const d = Math.abs(wrapAngle(theta - a)) - (m === cur ? DIR_MARGIN : 0);
      if (d < bestD) [best, bestD] = [m, d];
    }
    if (best === 'back') {
      // Backing off faster than the backwards walk can show: turn round and run.
      const r = art.back ? h / (art.back[1] * art.scale) : Infinity;
      best = r > BACK_MAX * (this.moveMode === 'flee' ? 0.8 : 1) ? 'flee' : 'back';
    }
    this.moveMode = best;
    return best;
  }

  /** Walk, jog or run: the gait whose stride is nearest the ground speed (by ratio), with a 15% margin. */
  private pickGait(art: EnemyArt, h: number): Stride {
    const g = this.gaits;
    const v = (i: number) => g[i][1] * art.scale;
    let i = Math.min(this.gait, g.length - 1);
    while (i < g.length - 1 && h > Math.sqrt(v(i) * v(i + 1)) * 1.15) i++;
    while (i > 0 && h < Math.sqrt(v(i - 1) * v(i)) * 0.85) i--;
    this.gait = i;
    return g[i];
  }

  /**
   * A hop's base stays put while it is down: over the contact part of the cycle the model lags back by
   * the ground the clip's own sweep does not cover, and catches up again in the air (the slime's chase:
   * ±14 cm around its collider).
   */
  private plantHop(hop: PlantedHop, act: THREE.AnimationAction, dur: number, h: number, rate: number, art: EnemyArt): void {
    const e = this.enemy;
    const resid = h - hop.sweep * art.scale * rate;
    if (resid <= 0 || dur <= 0) return;
    const cf = frac(hop.contact[1] - hop.contact[0]);
    const u = frac(act.time / dur - hop.contact[0]);
    const a = (resid * cf * dur) / rate / 2;
    const off = u < cf ? a * (1 - (2 * u) / cf) : a * ((2 * (u - cf)) / (1 - cf) - 1);
    _v.set(e.vel.x, 0, e.vel.z).normalize().applyAxisAngle(UP, -e.facing).multiplyScalar(off);
    this.rigBody.position.add(_v);
  }

  /** The attack in progress and its timings (the game's, never the clip's). */
  private attack(art: EnemyArt): { atk: EnemyAttack; windup: number; active: number; recover: number } {
    const e = this.enemy;
    if (e.move) {
      const mv = BOSS_MOVES[e.move];
      const r = e.rage();
      return { atk: art.boss?.[e.move] ?? art.attacks[0], windup: mv.windup / r, active: mv.active, recover: mv.recover / r };
    }
    const s = e.stats;
    return {
      atk: art.attacks[e.comboStep % art.attacks.length],
      windup: s.combo && e.comboStep > 0 ? s.windup * 0.6 : s.windup,
      active: s.active,
      recover: s.recover,
    };
  }

  /**
   * Attacks follow the game's timings: the clip's wind-up part is stretched over the wind-up, its
   * swing over the active window and the rest over the recovery (or the attack's own clips there).
   */
  private scrubAttack(rig: Rig, art: EnemyArt): void {
    const e = this.enemy;
    const { atk, windup, active, recover } = this.attack(art);
    const d = rig.duration(atk.clip);
    const [s0, s1] = atk.swing;
    const st = e.stateTime;
    if (e.state === 'windup') {
      const k = Math.min(1, st / Math.max(0.01, windup));
      if (atk.windup) rig.scrub(atk.windup.clip, k * atk.windup.to * rig.duration(atk.windup.clip), 0.1);
      else rig.scrub(atk.clip, k * s0 * d, 0.08);
    } else if (e.state === 'active') {
      const k = Math.min(1, st / Math.max(0.01, active));
      if (atk.loop) rig.play(atk.loop.clip, { speed: clipSpeed(Math.hypot(e.vel.x, e.vel.z) / (atk.loop.ground * art.scale), art.clipMax), fade: 0.1 });
      else rig.scrub(atk.clip, (s0 + k * (s1 - s0)) * d, 0.06);
      if (art.hop) this.rigBody.position.y = Math.sin(k * Math.PI) * art.hop;
    } else if (atk.recover) rig.play(atk.recover, { fade: 0.15 });
    else rig.scrub(atk.clip, (s1 + Math.min(1, st / Math.max(0.01, recover)) * (1 - s1)) * d, 0.1);
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
