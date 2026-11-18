import * as THREE from 'three';

export interface PlayOptions {
  /** Cross-fade time in seconds (default 0.15). */
  fade?: number;
  /** Loop the clip (default true). A one-shot clip holds its last frame. */
  loop?: boolean;
  /** Playback speed (default 1; 0 freezes the clip for `scrub`). */
  speed?: number;
  /** Restart the clip even if it is already playing. */
  restart?: boolean;
}

const _axis = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _parent = new THREE.Quaternion();
const _root = new THREE.Quaternion();

/**
 * One animated instance of a loaded model: its own mixer, one action per clip, and
 * name lookups for bones and attachment points. Game code picks the clip each frame;
 * attacks are scrubbed by hand so their timing follows the game's numbers, not the clip's.
 */
export class Rig {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private nodes = new Map<string, THREE.Object3D>();
  private current: THREE.AnimationAction | null = null;
  /** Name of the clip playing (or fading in) now. */
  clip = '';

  constructor(readonly root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c));
    root.traverse((o) => {
      if (o.name && !this.nodes.has(o.name)) this.nodes.set(o.name, o);
    });
  }

  has(clip: string): boolean {
    return this.actions.has(clip);
  }

  duration(clip: string): number {
    return this.actions.get(clip)?.getClip().duration ?? 0;
  }

  /**
   * A node by its name in the glTF file. GLTFLoader strips characters that animation
   * bindings reserve ('.', ':', '/', '[', ']'), so 'handslot.r' is stored as 'handslotr';
   * both spellings work here.
   */
  node(name: string): THREE.Object3D | undefined {
    return this.nodes.get(name) ?? this.nodes.get(THREE.PropertyBinding.sanitizeNodeName(name));
  }

  /**
   * Cross-fade to a clip. Asking for the clip already playing only updates its speed.
   * Every other clip still mixed in fades out from its weight now, and this one takes up what
   * they give back, so the weights always add up to 1: no pop when a fade is cut short, and
   * never a glimpse of the bind pose (the mixer fills any weight below 1 with it).
   */
  play(clip: string, o: PlayOptions = {}): THREE.AnimationAction | null {
    const next = this.actions.get(clip);
    if (!next) return null;
    if (next === this.current && !o.restart) {
      next.timeScale = o.speed ?? 1;
      return next;
    }
    const fade = o.fade ?? 0.15;
    next.reset();
    next.timeScale = o.speed ?? 1;
    next.setLoop(o.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = o.loop === false;
    next.setEffectiveWeight(1);
    // Started first, so bones it shares with the clips stopped below keep their mixer binding.
    next.play();
    // Every scheduled clip, not only `isRunning()` ones: that is false at speed 0 and for a
    // finished one-shot (paused on its last frame), and the game freezes clips at speed 0 all
    // the time (`scrub`, still climb poses); skipped, they stayed mixed in at full weight.
    let rest = 0;
    for (const a of this.actions.values()) {
      if (a === next || !a.isScheduled()) continue;
      const w = a.enabled ? a.getEffectiveWeight() : 0;
      if (fade > 0 && w > 0) {
        a.setEffectiveWeight(w).fadeOut(fade);
        rest += w;
      } else a.stop(); // faded out already (the mixer disables it at 0): off its active list
    }
    if (rest > 0) next._scheduleFading(fade, Math.max(0, 1 - rest), 1);
    this.current = next;
    this.clip = clip;
    return next;
  }

  /** Show a clip at a set time (seconds), frozen there; used for attacks and rolls. */
  scrub(clip: string, time: number, fade = 0.06): void {
    const a = this.play(clip, { fade, loop: false, speed: 0 });
    if (a) a.time = Math.max(0, Math.min(a.getClip().duration - 1e-4, time));
  }

  update(dt: number): void {
    // Undo last frame's `turn`/`aim`. The mixer only writes a bone when its clip value changed,
    // so on a frozen clip (scrubbed attack, roll, still climb pose) the turns would pile up.
    for (const b of this.turned) b.quaternion.copy(this.clipPose.get(b)!);
    this.turned.clear();
    this.mixer.update(dt);
  }

  /** Bones turned by hand this frame, and the clip's pose for each from before the turn. */
  private turned = new Set<THREE.Object3D>();
  private clipPose = new Map<THREE.Object3D, THREE.Quaternion>();

  private keepClipPose(b: THREE.Object3D): void {
    if (this.turned.has(b)) return;
    this.turned.add(b);
    let q = this.clipPose.get(b);
    if (!q) this.clipPose.set(b, (q = new THREE.Quaternion()));
    q.copy(b.quaternion);
  }

  /**
   * Turn a bone by `angle` around an axis given in the rig root's own space, on top of
   * whatever the clips posed this frame (climbing and gliding have no clips of their own).
   */
  turn(bone: string, axis: THREE.Vector3, angle: number): void {
    const b = this.node(bone);
    if (!b || !b.parent || angle === 0) return;
    this.keepClipPose(b);
    this.root.getWorldQuaternion(_root);
    b.parent.getWorldQuaternion(_parent);
    _axis.copy(axis).applyQuaternion(_root).applyQuaternion(_parent.invert()).normalize();
    b.quaternion.premultiply(_q.setFromAxisAngle(_axis, angle));
    b.updateMatrixWorld(true);
  }

  /**
   * Point a bone so the line from it to `tip` (a bone further down the same limb) runs along
   * `dir`, given in the rig root's own space (+Z = the way the model faces, +X its left, +Y up),
   * whatever pose the clips left it in. `weight` < 1 turns it only part of the way.
   * Aim a limb's upper bone before its lower one.
   */
  aim(bone: string, tip: string, dir: THREE.Vector3, weight = 1): void {
    const b = this.node(bone);
    const c = this.node(tip);
    if (!b || !c || !b.parent || weight <= 0) return;
    this.keepClipPose(b);
    c.getWorldPosition(_from).sub(b.getWorldPosition(_to)).normalize();
    _to.copy(dir).applyQuaternion(this.root.getWorldQuaternion(_root)).normalize();
    _q.setFromUnitVectors(_from, _to);
    if (weight < 1) _q.slerp(_q2.identity(), 1 - weight);
    // A turn in world space, moved into the bone's parent space: local' = P⁻¹ · Q · P · local.
    b.parent.getWorldQuaternion(_parent);
    _q2.copy(_parent).invert().multiply(_q).multiply(_parent);
    b.quaternion.premultiply(_q2);
    b.updateMatrixWorld(true);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.removeFromParent();
  }
}
