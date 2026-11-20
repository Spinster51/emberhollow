import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';
import { cloneModel, cloneNode, joinSkinnedParts, loadModel, modelClips, modelState, shareSkeletons } from '../core/models';
import { Rig } from '../core/rig';
import { recolorMap } from '../core/paint';
import { FURNITURE_FILE, HUMANOID, ITEM_FILE, NPC_DETAIL_RANGE, type NpcArt } from '../art/assets';
import { loadItemFile } from '../items/ItemMesh';
import { loadFurnitureFile } from '../home/furniture';

/** The placeholder's colours (from the villager's definition). */
export interface VillagerLook {
  coat: number;
  hat: number;
}

export type TalkPhase = 'none' | 'greet' | 'listen' | 'gesture';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const sanitize = (n: string) => THREE.PropertyBinding.sanitizeNodeName(n);
/** A villager glances at a player nearer than this (m), turning its head up to `LOOK_MAX` radians. */
const LOOK_RANGE = 6;
const LOOK_MAX = 1.1;
/** Turning: eased at this rate (1/s), never faster than `TURN_MAX` rad/s. */
const TURN_RATE = 7;
const TURN_MAX = 5;
/** In a conversation: seconds of listening before the first gesture, and between gestures. */
const GESTURE_FIRST = 1.2;
const GESTURE_GAP = 3;
/** Culling sphere of a joined body: its rest pose's, times this (the carpenter leans into his swing). */
const CULL_PAD = 1.6;

/** Load a file the way its owner does (the items and furniture files have their own outline widths). */
const loadFile = (f: string) => (f === ITEM_FILE ? loadItemFile(f) : f === FURNITURE_FILE ? loadFurnitureFile(f) : loadModel(f));
/** Every file a villager's art needs. */
const artFiles = (art: NpcArt) => [art.body, ...art.clips, ...(art.held ?? []).map((h) => h.file), ...(art.station ? [art.station.file] : [])];

/**
 * A town villager's body. Shows its rigged KayKit character (`NPC_ART`) once the files have loaded, and the
 * blocky placeholder until then, or for good if a file fails. Rests facing `homeYaw` in its role idle, glances
 * at a player who comes near, turns to face them in a conversation (a greeting, then gestures every few
 * seconds while they read) and turns back to its idle when it ends.
 */
export class NpcModel {
  readonly root = new THREE.Group();
  /** What its idle works on (the carpenter's crate): stands at the resting spot and does not turn with it. */
  readonly station = new THREE.Group();
  /** The placeholder: shown while loading and if a model fails. */
  readonly blocky: THREE.Group;
  rig: Rig | null = null;
  private rigHolder = new THREE.Group();
  /** 'pending' until the files settle; then the rig, or the placeholder for good. */
  private artState: 'pending' | 'rig' | 'blocky' = 'pending';
  /** Facing now (radians, the game's convention: 0 faces -Z). */
  facing: number;
  /** Head turn toward the player (radians). */
  headYaw = 0;
  /** Where the conversation is: greeting, listening, gesturing ('none' outside one). */
  phase: TalkPhase = 'none';
  /** Near the player (`NPC_DETAIL_RANGE`): outlines drawn, sun shadow cast, animated every frame. */
  detail = true;
  private outlines: THREE.Object3D[] = [];
  private casters: THREE.Object3D[] = [];
  /** Far villagers animate every other frame: this flips each frame, `owed` keeps the skipped frame's time. */
  private skip = false;
  private owed = 0;
  private talkTime = 0;
  private nextGesture = 0;
  private phaseEnd = 0;
  private gestureIndex = 0;

  /** `art` null: the placeholder only. Tests pass art with a missing file to check the fallback. */
  constructor(look: VillagerLook, readonly art: NpcArt | null, at: THREE.Vector3, readonly homeYaw: number) {
    this.facing = homeYaw;
    this.blocky = buildVillager(look);
    this.root.add(this.blocky, this.rigHolder);
    this.root.position.copy(at);
    this.root.rotation.y = homeYaw;
    this.rigHolder.rotation.y = Math.PI; // the models face +Z; the game faces -Z
    this.rigHolder.visible = false;
    this.station.position.copy(at);
    this.station.rotation.y = homeYaw;
    this.station.visible = false;
    if (art) for (const f of artFiles(art)) void loadFile(f).catch(() => {});
    else this.artState = 'blocky';
  }

  /** True once the rigged model is shown (false: placeholder). */
  get usingRig(): boolean {
    return this.rig !== null;
  }

  /**
   * One frame: turn toward the player while `talking` (back to the resting facing otherwise), glance at them
   * when near, and play the clip for the moment. `animate` false (far from the player): the pose holds.
   */
  update(dt: number, player: THREE.Vector3, talking: boolean, animate: boolean): void {
    this.syncRig();
    const p = this.root.position;
    const toPlayer = Math.atan2(-(player.x - p.x), -(player.z - p.z));
    const turn = wrapAngle((talking ? toPlayer : this.homeYaw) - this.facing);
    const ease = turn * (1 - Math.exp(-TURN_RATE * dt));
    this.facing = wrapAngle(this.facing + Math.sign(ease) * Math.min(Math.abs(ease), TURN_MAX * dt));
    this.root.rotation.y = this.facing;
    const rig = this.rig;
    const dist = Math.hypot(player.x - p.x, player.z - p.z);
    if (rig) this.setDetail(dist < NPC_DETAIL_RANGE + (this.detail ? 0.5 : -0.5));
    if (!rig || !animate) {
      if (!talking) this.phase = 'none';
      this.owed = 0;
      return;
    }
    this.owed += dt;
    if (!this.detail && !talking) {
      this.skip = !this.skip;
      if (this.skip) return;
    }
    const step = this.owed;
    this.owed = 0;
    this.pose(rig, this.art!, step, talking);
    rig.update(step);
    // A glance: the head turns toward a player who is near and not behind it.
    const rel = wrapAngle(toPlayer - this.facing);
    const near = dist < LOOK_RANGE && Math.abs(rel) < 1.9;
    this.headYaw += ((near ? clamp(rel, -LOOK_MAX, LOOK_MAX) : 0) - this.headYaw) * (1 - Math.exp(-6 * step));
    if (Math.abs(this.headYaw) > 1e-3) rig.turn(HUMANOID.head, UP, this.headYaw);
  }

  /** Outlines and sun shadow on (near the player) or off (far: neither shows at that size). */
  private setDetail(on: boolean): void {
    if (on === this.detail) return;
    this.detail = on;
    for (const o of this.outlines) o.visible = on;
    for (const o of this.casters) o.castShadow = on;
  }

  /** The role idle, or the conversation: greeting, then listening with a gesture every few seconds. */
  private pose(rig: Rig, art: NpcArt, dt: number, talking: boolean): void {
    const t = art.talk;
    if (!talking) {
      rig.play(art.idle, { fade: this.phase === 'none' ? 0.3 : 0.5 });
      this.phase = 'none';
      return;
    }
    if (this.phase === 'none') {
      this.phase = 'greet';
      this.talkTime = 0;
      this.gestureIndex = 0;
      this.phaseEnd = rig.duration(t.greet) * 0.85;
      rig.play(t.greet, { loop: false, fade: 0.25, restart: true });
      return;
    }
    this.talkTime += dt;
    if (this.phase === 'listen') {
      if (this.talkTime < this.nextGesture || !t.gestures.length) return;
      const clip = t.gestures[this.gestureIndex++ % t.gestures.length];
      this.phase = 'gesture';
      this.phaseEnd = this.talkTime + rig.duration(clip) * 0.9;
      rig.play(clip, { loop: false, fade: 0.25, restart: true });
    } else if (this.talkTime >= this.phaseEnd) {
      // The greeting or a gesture has played: back to listening.
      this.nextGesture = this.talkTime + (this.phase === 'greet' ? GESTURE_FIRST : GESTURE_GAP);
      this.phase = 'listen';
      rig.play(t.idle, { fade: 0.3 });
    }
  }

  /** Swap in the rigged model once its files are ready; keep the placeholder if one fails. */
  private syncRig(): void {
    if (this.artState !== 'pending') return;
    const art = this.art!;
    const files = artFiles(art);
    const states = files.map(modelState);
    if (states.includes('none')) {
      for (const f of files) void loadFile(f).catch(() => {});
      return;
    }
    if (states.includes('loading')) return;
    // A missing body or clip file keeps the placeholder; a missing prop or station is only left out.
    const clone = [art.body, ...art.clips].some((f) => modelState(f) === 'failed') ? null : cloneModel(art.body);
    if (!clone) {
      this.artState = 'blocky';
      return;
    }
    this.buildRig(art, clone);
    this.artState = 'rig';
  }

  private buildRig(art: NpcArt, clone: THREE.Object3D): void {
    // Left out: the listed parts (hats, a cape) and every pack prop on the hand slots but the kept ones.
    const hide = new Set((art.hide ?? []).map(sanitize));
    const keep = new Set((art.props ?? []).map(sanitize));
    const slots = new Set([HUMANOID.handR, HUMANOID.handL].map(sanitize));
    const drop: THREE.Object3D[] = [];
    clone.traverse((o) => {
      const prop = (o as THREE.Mesh).isMesh && !o.name.endsWith('_outline') && !!o.parent && slots.has(o.parent.name);
      if (hide.has(o.name) || (prop && !keep.has(o.name))) drop.push(o);
    });
    for (const o of drop) o.removeFromParent();
    // Own materials with the villager's colours (the body's file, shared with the player or bandits, is untouched).
    // Skinned and rigid meshes (capes, books, the bow on the bones) get separate copies: one material drawn both
    // ways makes three.js switch shader programs on every draw, in both passes.
    const made = new Map<string, THREE.Material>();
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.name.endsWith('_outline') || Array.isArray(mesh.material)) return;
      const src = mesh.material as THREE.MeshToonMaterial;
      if (!art.recolor && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
      const key = `${src.uuid}|${(mesh as THREE.SkinnedMesh).isSkinnedMesh ? 'skinned' : 'rigid'}`;
      let m = made.get(key);
      if (!m) {
        const c = src.clone();
        if (art.recolor && src.map) c.map = recolorMap(src.map, art.recolor);
        made.set(key, (m = c));
      }
      mesh.material = m;
    });
    shareSkeletons(clone);
    // One draw call (and one outline) for the whole body instead of one per part.
    for (const mesh of joinSkinnedParts(clone, `${art.body}|${[...hide].sort().join(',')}`)) {
      const geo = mesh.geometry;
      let sphere = geo.userData.cull as THREE.Sphere | undefined;
      if (!sphere) {
        sphere = geo.boundingBox!.getBoundingSphere(new THREE.Sphere());
        sphere.radius *= CULL_PAD;
        geo.userData.cull = sphere;
      }
      mesh.boundingSphere = sphere.clone();
      for (const c of mesh.children) if ((c as THREE.SkinnedMesh).isSkinnedMesh) (c as THREE.SkinnedMesh).boundingSphere = sphere.clone();
    }
    const used = new Set([art.idle, art.talk.greet, art.talk.idle, ...art.talk.gestures]);
    const seen = new Set<string>();
    const names = new Set<string>();
    clone.traverse((o) => names.add(o.name));
    const clips = art.clips
      .flatMap(modelClips)
      .filter((c) => used.has(c.name) && !seen.has(c.name) && !!seen.add(c.name))
      .map((c) => bodyClip(art.body, c, names));
    const rig = new Rig(clone, clips);
    for (const h of art.held ?? []) {
      const bone = rig.node(h.bone);
      const node = cloneNode(h.file, h.node);
      if (!bone || !node) continue;
      const holder = new THREE.Group();
      holder.name = `held:${h.node}`;
      holder.position.set(...(h.pos ?? [0, 0, 0]));
      if (h.dir) holder.quaternion.setFromUnitVectors(UP, _v.set(...h.dir).normalize());
      else holder.rotation.set(...(h.rot ?? [0, Math.PI, 0]));
      holder.scale.setScalar(h.scale ?? 1);
      holder.add(node);
      bone.add(holder);
    }
    if (art.station) {
      const s = art.station;
      const piece = cloneNode(s.file, s.node);
      if (piece) {
        const holder = new THREE.Group();
        holder.name = `station:${s.node}`;
        holder.position.set(s.at[0], 0, s.at[1]);
        holder.rotation.y = s.yaw;
        holder.scale.setScalar(s.scale);
        holder.add(piece);
        this.station.add(holder);
        this.station.visible = true;
      }
    }
    for (const r of [clone, this.station]) {
      r.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        if (o.name.endsWith('_outline')) this.outlines.push(o);
        else if (o.castShadow) this.casters.push(o);
      });
    }
    this.rigHolder.scale.setScalar(art.scale);
    this.rigHolder.add(clone);
    this.rig = rig;
    rig.play(art.idle, { fade: 0 });
    this.blocky.visible = false;
    this.rigHolder.visible = true;
  }
}

/** Clips cut down to the nodes a body has, per body and clip. */
const bodyClips = new Map<string, THREE.AnimationClip>();

/**
 * The clip as it plays on `body`: the Adventurers 1.0 clips also move the pack's IK helper bones, which the
 * 2.0 bodies leave out; those tracks are dropped (they would only warn that nothing is there to move).
 */
function bodyClip(body: string, clip: THREE.AnimationClip, names: Set<string>): THREE.AnimationClip {
  if (clip.tracks.every((t) => names.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName))) return clip;
  const key = `${body}|${clip.name}`;
  let c = bodyClips.get(key);
  if (!c) {
    c = new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter((t) => names.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName)));
    bodyClips.set(key, c);
  }
  return c;
}

/** The placeholder villager: a long coat, hat and box head, facing -Z. */
function buildVillager(look: VillagerLook): THREE.Group {
  const root = new THREE.Group();
  const skin = toonMaterial(0xe0b48a);
  const coat = toonMaterial(look.coat);
  const hat = toonMaterial(look.hat);
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, outline = true) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    if (outline) addOutline(mesh);
    root.add(mesh);
  };
  box(0.6, 1.0, 0.36, coat, 0, 0.95, 0); // long coat
  box(0.2, 0.5, 0.2, toonMaterial(0x3a3028), -0.14, 0.25, 0);
  box(0.2, 0.5, 0.2, toonMaterial(0x3a3028), 0.14, 0.25, 0);
  box(0.17, 0.6, 0.17, coat, -0.39, 1.15, 0);
  box(0.17, 0.6, 0.17, coat, 0.39, 1.15, 0);
  box(0.42, 0.42, 0.42, skin, 0, 1.68, 0);
  box(0.5, 0.14, 0.5, hat, 0, 1.92, 0, false);
  const eye = new THREE.MeshBasicMaterial({ color: 0x1a1010 });
  for (const x of [-0.1, 0.1]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), eye);
    e.position.set(x, 1.7, -0.215);
    root.add(e);
  }
  return root;
}
