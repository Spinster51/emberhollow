import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';
import type { Player } from './Player';
import { buildItemMesh, gearMaterial } from '../items/ItemMesh';
import { lookOf, type Item, type Look } from '../items/items';
import { CLASSES, type ClassId } from '../classes/classes';
import { TUNING } from '../config';
import { cloneModel, cloneNode, loadModel, modelClips, modelState } from '../core/models';
import { Rig } from '../core/rig';
import { ATTACK_CLIPS, HUMANOID, SKILL_CLIPS, type SwingClip } from '../art/assets';

const AXIS_X = new THREE.Vector3(1, 0, 0);
/** Height (m) of the point the rigged body flips around in a roll: the middle of the tucked body. */
const ROLL_PIVOT = 0.75;
/**
 * Box helmet (caps) fit on the rig's head bone (rig units): centre height, width scale, dome
 * height. Helms wear the pack's own knight helmet instead (`rigHelmet`).
 */
const RIG_HELMET = { y: 0.84, width: 2.0, height: 0.46 };
/**
 * Weapon grips in the rig's hand slots. Slot frame: +Y is the fist's grip axis (blades point
 * along it: forward in Idle), -X runs up the forearm (up while the arm hangs), +Z points away
 * from the body. Items point along -Z from the grip, so blades turn -Z onto +Y.
 */
const BLADE_GRIP = new THREE.Quaternion().setFromAxisAngle(AXIS_X, Math.PI / 2);
/**
 * Staffs stand up the slot's -X instead (along +Y they lie flat in Idle, gem out in front at
 * hip height), leaning `forward` (+Y) and `out` (+Z, as tangents) so they clear the forearm and
 * the big head: in Idle ~30° off upright, out to the side and a little forward. Measured over
 * the mage's clips (Idle, walk, run, Spellcast_*, jumps, roll), the staff stays clear of the
 * head and body except for a frame or two of fast motion. `slide` (rig units) moves the staff
 * along itself through the fist; at 0 its foot is just above the ground in Idle.
 */
const RIG_STAFF = { forward: 0.4, out: 0.5, slide: 0 };
const STAFF_TIP = new THREE.Vector3(-1, RIG_STAFF.forward, RIG_STAFF.out).normalize();
const STAFF_GRIP = (() => {
  const z = STAFF_TIP.clone().negate();
  const y = new THREE.Vector3(0, 0, 1).addScaledVector(z, -z.z).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
})();
/** Directions in the rig's own space (+Z = forward, +X = the model's left, +Y = up). */
const dir = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();
/**
 * Shield guard while blocking on the rig (rig space, rig units): where the left hand goes (the
 * shield then sits a little left of centre, over the chest, top rim just under the chin), the
 * way the elbow bends (out and down), and how long (s) raising or lowering the shield takes.
 */
const RIG_GUARD = { hand: new THREE.Vector3(0.22, 0.81, 0.78), elbow: dir(1, -0.7, -0.2), raise: 0.1 };
/** The shield holder's rotation on the hand slot when not guarding (as `mountRig` puts it). */
const SHIELD_REST = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _gS = new THREE.Vector3();
const _gE = new THREE.Vector3();
const _gH = new THREE.Vector3();
const _gU = new THREE.Vector3();
const _gF = new THREE.Vector3();
const _gW = new THREE.Vector3();
const _gQ = new THREE.Quaternion();
const _gQ2 = new THREE.Quaternion();

/**
 * The player's body. Shows the class's rigged glTF character (KayKit Adventurers) once
 * its files have loaded, and the blocky placeholder with procedural poses until then,
 * or for good if a file fails to load. Both read the same Player state each frame.
 */
export class PlayerModel {
  readonly root = new THREE.Group();
  /** The placeholder: shown while loading and if a model fails. */
  private blocky = new THREE.Group();
  private body = new THREE.Group();
  private head: THREE.Mesh;
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private glider = new THREE.Group();
  /** Gear holders, filled from the equipped items (moved onto the rig's bones when it is shown). */
  private sword = new THREE.Group();
  private shield = new THREE.Group();
  private headGear = new THREE.Group();
  private chestGear = new THREE.Group();
  private hair: THREE.Mesh;
  private gearVersion = -1;
  private tunicMat: THREE.MeshToonMaterial;
  /** Second dagger in the left hand (assassin). */
  private offDagger = new THREE.Group();
  private ghost = false;
  private ghostMat = new THREE.MeshBasicMaterial({ color: 0x223044, transparent: true, opacity: 0.35, depthWrite: false });
  private realMats = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private phase = 0;
  private gliderOpen = 0;
  private look: Look | null = null;

  /** The rigged character, when loaded: `rigBody` tilts it, `rigHolder` turns and scales it. */
  private rig: Rig | null = null;
  /** The class the current body was chosen for (rig or, after a load failure, placeholder). */
  private rigClass: ClassId | null = null;
  private rigBody = new THREE.Group();
  private rigHolder = new THREE.Group();
  private headwear: THREE.Object3D[] = [];
  private lastState = '';
  /** 0..1: how far the shield is raised into the guard (rigged body, shield equipped). */
  private guard = 0;
  /** True while the guard has turned the shield holder away from its mounted rotation. */
  private shieldTurned = false;

  /** `bodies` can be swapped out by tests (e.g. a missing file to check the fallback). */
  constructor(private bodies: Record<ClassId, string> = HUMANOID.bodies, private clips = HUMANOID.clips) {
    const skin = toonMaterial(0xf0c39a);
    const tunic = toonMaterial(0x3f6fb5);
    this.tunicMat = tunic;
    const belt = toonMaterial(0x5b3a20);
    const pants = toonMaterial(0x4a3b2c);
    const hair = toonMaterial(0xb5582e);

    const box = (w: number, h: number, d: number, mat: THREE.Material, outline = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.castShadow = true;
      if (outline) addOutline(m);
      return m;
    };

    this.root.add(this.blocky, this.rigBody);
    this.blocky.add(this.body);
    this.rigBody.add(this.rigHolder);
    this.rigHolder.rotation.y = Math.PI; // the pack's characters face +Z; the game faces -Z
    this.rigHolder.scale.setScalar(HUMANOID.scale);
    this.rigBody.visible = false;
    this.body.position.y = 0.95;

    const torso = box(0.55, 0.65, 0.32, tunic);
    torso.position.y = 0.2;
    this.body.add(torso);
    const beltM = box(0.58, 0.1, 0.35, belt, false);
    beltM.position.y = -0.08;
    this.body.add(beltM);

    this.head = box(0.42, 0.42, 0.42, skin);
    this.head.position.y = 0.75;
    this.body.add(this.head);
    const hairM = box(0.46, 0.16, 0.46, hair, false);
    hairM.position.y = 0.2;
    this.head.add(hairM);
    this.hair = hairM;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1010 });
    for (const x of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), eyeMat);
      eye.position.set(x, 0.02, -0.215);
      this.head.add(eye);
    }

    const limb = (group: THREE.Group, x: number, y: number, len: number, w: number, mat: THREE.Material) => {
      group.position.set(x, y, 0);
      const m = box(w, len, w, mat);
      m.position.y = -len / 2;
      group.add(m);
      this.body.add(group);
    };
    limb(this.armL, -0.36, 0.45, 0.6, 0.17, tunic);
    limb(this.armR, 0.36, 0.45, 0.6, 0.17, tunic);
    limb(this.legL, -0.14, -0.12, 0.8, 0.2, pants);
    limb(this.legR, 0.14, -0.12, 0.8, 0.2, pants);
    this.mountBlocky();

    // Glider: a cloth wing on two poles, held above the head.
    const cloth = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.05, 1.0),
      toonMaterial(0xc9473a, { side: THREE.DoubleSide }),
    );
    cloth.castShadow = true;
    addOutline(cloth, 0.04);
    cloth.position.y = 1.15;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.06, 0.18), toonMaterial(0xf2d16b));
    stripe.position.y = 1.15;
    this.glider.add(cloth, stripe);
    for (const x of [-0.35, 0.35]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 5), belt);
      pole.position.set(x, 0.8, 0);
      pole.rotation.z = x > 0 ? -0.3 : 0.3;
      this.glider.add(pole);
    }
    this.glider.position.y = 0.6;
    this.glider.visible = false;
    this.body.add(this.glider);

    // The shared clips load straight away; each class body loads when first needed.
    void loadModel(this.clips).catch(() => {});
  }

  /** True once the rigged character is shown (false: placeholder). */
  get usingRig(): boolean {
    return this.rig !== null;
  }

  /** Gear holders on the placeholder's limbs. */
  private mountBlocky(): void {
    this.headGear.position.set(0, 0.17, 0);
    this.headGear.rotation.set(0, 0, 0);
    this.headGear.scale.setScalar(1);
    this.head.add(this.headGear);
    this.chestGear.position.set(0, 0.2, 0);
    this.chestGear.rotation.set(0, 0, 0);
    this.chestGear.scale.setScalar(0.98);
    this.body.add(this.chestGear);
    this.sword.position.set(0, -0.58, 0);
    this.sword.rotation.set(0, 0, 0);
    this.sword.scale.setScalar(1);
    this.armR.add(this.sword);
    this.shield.position.set(-0.13, -0.38, 0);
    this.shield.rotation.set(0, Math.PI / 2, 0);
    this.shield.scale.setScalar(0.85);
    this.armL.add(this.shield);
    this.offDagger.position.set(0, -0.58, 0);
    this.offDagger.rotation.set(0, 0, 0);
    this.offDagger.scale.setScalar(1);
    this.armL.add(this.offDagger);
    this.glider.position.set(0, 0.6, 0);
    this.body.add(this.glider);
  }

  /**
   * Gear holders on the rig's hand, head and chest bones. Item meshes are built in metres
   * for the game's scale, so the hand holders undo the rig's scale; the head and chest
   * holders size the placeholder armour to the pack's larger head and body.
   */
  private mountRig(rig: Rig): void {
    const inv = 1 / HUMANOID.scale;
    type V3 = [number, number, number];
    const put = (holder: THREE.Group, bone: string, pos: V3, rot: V3, scale: number | V3) => {
      const b = rig.node(bone);
      if (!b) return;
      holder.position.set(...pos);
      holder.rotation.set(...rot);
      if (typeof scale === 'number') holder.scale.setScalar(scale);
      else holder.scale.set(...scale);
      b.add(holder);
    };
    // Weapons point along -Z from the grip; the hand slots hold blades along +Y.
    put(this.sword, HUMANOID.handR, [0, 0, 0], [Math.PI / 2, 0, 0], inv);
    put(this.offDagger, HUMANOID.handL, [0, 0, 0], [Math.PI / 2, 0, 0], inv);
    // The pack's shields sit 0.16 out from the left hand slot, face along +Z, long side along +Y;
    // ours face -Z, so they turn half round.
    put(this.shield, HUMANOID.handL, [0, 0.02, 0.16], [0, Math.PI, 0], inv);
    // The head holder is the head bone itself; `rigHelmet` places what goes in it.
    put(this.headGear, HUMANOID.head, [0, 0, 0], [0, 0, 0], 1);
    // The box chest piece does not fit the round body, so it is hidden on the rig (see update).
    put(this.chestGear, HUMANOID.chest, [0, -0.1, 0], [0, Math.PI, 0], [1.45, 1.3, 2.1]);
    // Low enough that hands raised overhead reach the poles (the cloth clears the tallest hat).
    this.glider.position.set(0, 0.92, 0);
    this.rigBody.add(this.glider);
  }

  /** Swap in the class's rigged body when its files are ready; keep the placeholder on failure. */
  private syncBody(p: Player): void {
    if (this.rigClass === p.cls) return;
    const body = this.bodies[p.cls];
    const states = [modelState(this.clips), modelState(body)];
    if (states.includes('none')) {
      void loadModel(this.clips).catch(() => {});
      void loadModel(body).catch(() => {});
      return;
    }
    if (states.includes('loading')) return;
    // Swapping while stealthed: put the real materials back first; update() re-applies the ghost look.
    this.setGhost(false);
    this.rig?.dispose();
    this.rig = null;
    this.rigClass = p.cls;
    this.lastState = '';
    this.gearVersion = -1;
    const clone = states.includes('failed') ? null : cloneModel(body);
    if (!clone) {
      this.mountBlocky();
      this.blocky.visible = true;
      this.rigBody.visible = false;
      return;
    }
    this.rig = new Rig(clone, modelClips(this.clips));
    // The pack's own props (weapons, shields, mugs, books) are hidden; equipped items show instead.
    const slots = [this.rig.node(HUMANOID.handR), this.rig.node(HUMANOID.handL)];
    clone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.parent && slots.includes(o.parent)) o.visible = false;
    });
    this.headwear = HUMANOID.headwear.map((n) => this.rig!.node(n)).filter((n): n is THREE.Object3D => !!n);
    this.rigHolder.add(clone);
    this.mountRig(this.rig);
    this.blocky.visible = false;
    this.rigBody.visible = true;
  }

  /** Show the equipped weapon, off-hand, helmet and chest piece. */
  private refreshGear(p: Player): void {
    if (this.gearVersion === p.inv.version + p.prog.version * 1e6) return;
    this.gearVersion = p.inv.version + p.prog.version * 1e6;
    this.tunicMat.color.setHex(CLASSES[p.cls].colour);
    const eq = p.inv.equipped;
    const fill = (holder: THREE.Group, item: typeof eq.weapon) => {
      holder.clear();
      if (item) holder.add(buildItemMesh(item));
    };
    fill(this.sword, eq.weapon);
    fill(this.shield, eq.offhand);
    this.headGear.clear();
    if (eq.helmet) this.headGear.add(this.rig ? this.rigHelmet(eq.helmet) : buildItemMesh(eq.helmet));
    fill(this.chestGear, eq.chest);
    this.hair.visible = !eq.helmet;
    for (const h of this.headwear) h.visible = !eq.helmet;
    // Staffs are held upright; daggers come in pairs.
    const look = eq.weapon ? lookOf(eq.weapon) : null;
    this.look = look;
    if (!this.rig) this.sword.rotation.x = look === 'staff' ? Math.PI / 2 : 0;
    else {
      const staff = look === 'staff';
      this.sword.quaternion.copy(staff ? STAFF_GRIP : BLADE_GRIP);
      this.sword.position.copy(STAFF_TIP).multiplyScalar(staff ? RIG_STAFF.slide : 0);
    }
    this.offDagger.clear();
    if (look === 'daggers' && eq.weapon && !eq.offhand) this.offDagger.add(buildItemMesh(eq.weapon));
  }

  /**
   * What a helmet shows on the rig's head bone: a helm wears the pack's own knight helmet at its
   * place on the head (rig units; refitted only over the rogue's hood, `HUMANOID.helmFit`) with
   * its own material carrying the rarity glow,
   * so the tint never reaches the knight body's shared material; a cap (or a helm, should the
   * file lack it) is the item's box, sized to the pack's big round head (±0.54 wide, top ~1.0
   * above the bone): a little narrower than the head, down to the brow.
   */
  private rigHelmet(item: Item): THREE.Object3D {
    const look = lookOf(item);
    const helm = look === 'helm' ? cloneNode(this.clips, HUMANOID.helm) : null;
    if (helm) {
      helm.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.name.endsWith('_outline')) return;
        const src = mesh.material as THREE.MeshToonMaterial;
        const mat = gearMaterial(0xffffff, item);
        mat.color.copy(src.color);
        mat.map = src.map;
        mesh.material = mat;
      });
      const bodyFit = this.rigClass && HUMANOID.helmFit[this.rigClass];
      if (bodyFit) {
        helm.scale.multiplyScalar(bodyFit.scale);
        helm.position.z -= bodyFit.back;
      }
      return helm;
    }
    // Item fronts are -Z; the rig faces +Z. Every dome is stretched to one height (cap 0.2, helm 0.3 tall).
    const fit = new THREE.Group();
    fit.position.set(0, RIG_HELMET.y, 0);
    fit.rotation.set(0, Math.PI, 0);
    fit.scale.set(RIG_HELMET.width, RIG_HELMET.height / (look === 'cap' ? 0.2 : 0.3), RIG_HELMET.width);
    fit.add(buildItemMesh(item));
    return fit;
  }

  update(p: Player, dt: number): void {
    this.syncBody(p);
    this.refreshGear(p);
    this.root.position.copy(p.pos);
    this.root.rotation.set(0, p.facing, 0);
    this.sword.visible = p.state !== 'glide' && p.state !== 'climb' && p.state !== 'climbJump';
    // The placeholder's box chest piece looks wrong on the round rigged body: hidden there, still equipped.
    this.chestGear.visible = !this.rig;
    this.gliderOpen += ((p.state === 'glide' ? 1 : 0) - this.gliderOpen) * Math.min(1, dt * 10);
    this.glider.visible = this.gliderOpen > 0.05;
    this.glider.scale.setScalar(Math.max(0.05, this.gliderOpen));
    if (this.rig) this.poseRig(this.rig, p, dt);
    else this.poseBlocky(p, dt);
    this.setGhost(p.stealthTime > 0);
  }

  /** Map the player's state onto the rig's clips; climbing and gliding bend bones by hand. */
  private poseRig(rig: Rig, p: Player, dt: number): void {
    const hSpeed = Math.hypot(p.vel.x, p.vel.z);
    const entered = p.state !== this.lastState;
    this.lastState = p.state;
    this.rigBody.rotation.set(0, 0, 0);
    this.rigBody.position.set(0, 0, 0);
    this.rigHolder.position.set(0, 0, 0);
    const t = performance.now() / 1000;
    const arms = (angL: number, angR: number) => {
      // Positive = arm swings forward and up (around the body's side-to-side axis).
      rig.turn('upperarm.l', AXIS_X, -angL);
      rig.turn('upperarm.r', AXIS_X, -angR);
    };
    const legs = (angL: number, angR: number) => {
      rig.turn('upperleg.l', AXIS_X, -angL);
      rig.turn('upperleg.r', AXIS_X, -angR);
    };
    // Aim a whole arm or leg: the upper bone along `upper`, the lower one along `lower` (default: straight).
    const limb = (side: 'l' | 'r', kind: 'arm' | 'leg', upper: THREE.Vector3, lower = upper, weight = 1) => {
      const [a, b, c] = kind === 'arm' ? ['upperarm', 'lowerarm', 'hand'] : ['upperleg', 'lowerleg', 'foot'];
      rig.aim(`${a}.${side}`, `${b}.${side}`, upper, weight);
      rig.aim(`${b}.${side}`, `${c}.${side}`, lower, weight);
    };
    let after: (() => void) | null = null;

    switch (p.state) {
      case 'ground':
        if (p.blocking) rig.play('Blocking', { fade: 0.1 });
        else if (hSpeed > 2.6) rig.play('Running_A', { speed: Math.min(1.8, Math.max(0.7, hSpeed / 5)) });
        else if (hSpeed > 0.3) rig.play('Walking_A', { speed: Math.min(1.6, Math.max(0.6, hSpeed / 2)) });
        else rig.play(this.look === 'greatsword' ? '2H_Melee_Idle' : 'Idle', { fade: 0.2 });
        break;
      case 'air':
        if (entered && p.vel.y > 0) rig.play('Jump_Start', { loop: false, fade: 0.05 });
        else if (rig.clip !== 'Jump_Start' || p.vel.y <= 0) rig.play('Jump_Idle', { fade: 0.2 });
        break;
      case 'roll': {
        // The pack's Dodge_Forward is a short lunge, not a roll (measured: the hips never turn
        // past 17°). Hold its crouch, tuck the limbs and flip the body forward once around a
        // pivot at the tucked body's middle, finishing upright as the move ends.
        const r = TUNING.roll;
        const k = Math.min(1, p.stateTime / (r.buildup + r.move));
        const spin = k * k * (3 - 2 * k);
        const tuck = Math.sin(Math.PI * Math.min(1, p.stateTime / (r.buildup + r.move + r.recover * 0.5)));
        rig.scrub('Dodge_Forward', 0.25 * rig.duration('Dodge_Forward'), 0.04);
        this.rigBody.position.y = ROLL_PIVOT - 0.25 * tuck;
        this.rigHolder.position.y = -ROLL_PIVOT;
        this.rigBody.rotation.x = -spin * Math.PI * 2;
        after = () => {
          arms(1.1 * tuck, 1.1 * tuck);
          legs(1.7 * tuck, 1.7 * tuck);
          rig.turn('lowerleg.l', AXIS_X, 2.1 * tuck);
          rig.turn('lowerleg.r', AXIS_X, 2.1 * tuck);
          rig.turn('spine', AXIS_X, 0.45 * tuck);
          rig.turn('chest', AXIS_X, 0.35 * tuck);
          rig.turn('head', AXIS_X, 0.35 * tuck);
        };
        break;
      }
      case 'climb':
      case 'climbJump': {
        // No climb clip: a still Idle body, a slight lean back so the big head clears the wall,
        // and limbs aimed up the wall, reaching hand and opposite knee in turn as you move.
        rig.play('Idle', { speed: 0, fade: 0.1 });
        const move = Math.hypot(p.climbMove.x, p.climbMove.y);
        if (move > 0.05) this.phase += dt * 6 * move;
        const sw = p.state === 'climbJump' ? 0 : Math.sin(this.phase);
        const reach = p.state === 'climbJump' ? 1 : 0;
        this.rigBody.rotation.x = 0.1;
        after = () => {
          rig.turn('head', AXIS_X, -0.35);
          limb('l', 'arm', dir(0.3, 0.75 + 0.3 * sw + reach, 0.55));
          limb('r', 'arm', dir(-0.3, 0.75 - 0.3 * sw + reach, 0.55));
          limb('l', 'leg', dir(0.15, -0.75 + 0.3 * sw, 0.55), dir(0, -1, -0.1));
          limb('r', 'leg', dir(-0.15, -0.75 - 0.3 * sw, 0.55), dir(0, -1, -0.1));
        };
        break;
      }
      case 'mantle':
        // Lean over the ledge, hands pushing down on it, one knee up.
        rig.play('Idle', { speed: 0, fade: 0.08 });
        this.rigBody.rotation.x = -0.3;
        after = () => {
          limb('l', 'arm', dir(0.3, -0.2, 0.9), dir(0.1, -0.8, 0.5));
          limb('r', 'arm', dir(-0.3, -0.2, 0.9), dir(-0.1, -0.8, 0.5));
          limb('l', 'leg', dir(0.1, -0.2, 0.95), dir(0, -1, 0));
          limb('r', 'leg', dir(-0.1, -1, 0.1));
        };
        break;
      case 'glide':
        // Hanging under the glider: both hands straight up on its poles, legs trailing.
        rig.play('Jump_Idle', { fade: 0.2 });
        this.rigBody.rotation.x = -0.25;
        this.rigBody.rotation.z = Math.max(-0.4, Math.min(0.4, -this.turnRate(p, dt) * 0.25));
        after = () => {
          const k = this.gliderOpen;
          limb('l', 'arm', dir(0.17, 1, 0.05), undefined, k);
          limb('r', 'arm', dir(-0.17, 1, 0.05), undefined, k);
          const s = Math.sin(t * 3) * 0.12;
          limb('l', 'leg', dir(0.1, -1, -0.2 + s), dir(0, -1, -0.3));
          limb('r', 'leg', dir(-0.1, -1, -0.15 - s), dir(0, -1, -0.3));
        };
        break;
      case 'skill': {
        const def = SKILL_CLIPS[p.skill?.id ?? ''] ?? SKILL_CLIPS.default;
        if (def.loop) rig.play(def.clip, { speed: def.speed ?? 1, fade: 0.08 });
        else {
          const k = Math.min(1, p.stateTime / Math.max(0.05, p.skill?.time ?? 0.5));
          rig.scrub(def.clip, k * rig.duration(def.clip), 0.06);
        }
        break;
      }
      case 'attack':
        this.scrubAttack(rig, p);
        break;
      case 'stagger':
        if (entered) rig.play(p.staggerKind === 'knockdown' ? 'Hit_B' : 'Hit_A', { loop: false, fade: 0.05, restart: true });
        break;
      case 'dead':
        if (entered) rig.play('Death_A', { loop: false, fade: 0.1 });
        break;
    }
    rig.update(dt);
    if (after) after();
    this.poseGuard(rig, p, dt, !after);
  }

  /**
   * Blocking with a shield: the clips alone do not keep it in front (blended with other clips it
   * ends up out at the left side), so the left arm is bent across the front by hand (two-bone
   * reach for `RIG_GUARD.hand`), the forearm twisted so the hand slot faces forward, and the
   * shield holder turned to face straight ahead, long side up. Raised over `RIG_GUARD.raise` s of
   * block; lowered as fast when nothing else poses the arms (`free`), at once otherwise. The
   * holder gets its mounted rotation [0, π, 0] back once lowered.
   */
  private poseGuard(rig: Rig, p: Player, dt: number, free: boolean): void {
    const off = p.inv.equipped.offhand;
    const look = off ? lookOf(off) : null;
    const shield = look === 'woodShield' || look === 'ironShield';
    const step = dt / RIG_GUARD.raise;
    if (shield && p.state === 'ground' && p.blocking) {
      this.guard = Math.max(Math.min(1, p.blockTime / RIG_GUARD.raise), Math.min(1, this.guard + step));
    } else this.guard = shield && free ? Math.max(0, this.guard - step) : 0;
    const upper = rig.node('upperarm.l');
    const lower = rig.node('lowerarm.l');
    const hand = rig.node('hand.l');
    const slot = this.shield.parent;
    if (this.guard <= 0 || !upper || !lower || !hand || !slot) {
      if (this.shieldTurned) this.shield.rotation.set(0, Math.PI, 0);
      this.shieldTurned = false;
      return;
    }
    const k = this.guard * this.guard * (3 - 2 * this.guard);
    const local = (o: THREE.Object3D, v: THREE.Vector3) => rig.root.worldToLocal(o.getWorldPosition(v));
    // Two-bone reach: shoulder S, elbow on the circle where both bone lengths meet, hand at the target.
    const s = local(upper, _gS);
    const a = local(lower, _gE).distanceTo(s);
    const b = local(hand, _gH).distanceTo(_gE);
    const toHand = _gU.copy(RIG_GUARD.hand).sub(s);
    const d = Math.min(toHand.length(), (a + b) * 0.999);
    toHand.normalize();
    const along = (a * a - b * b + d * d) / (2 * d);
    const out = Math.sqrt(Math.max(0, a * a - along * along));
    _gW.copy(RIG_GUARD.elbow).addScaledVector(toHand, -RIG_GUARD.elbow.dot(toHand)).normalize();
    const elbow = _gE.copy(s).addScaledVector(toHand, along).addScaledVector(_gW, out);
    const fore = _gF.copy(s).addScaledVector(toHand, d).sub(elbow).normalize();
    rig.aim('upperarm.l', 'lowerarm.l', _gU.copy(elbow).sub(s).normalize(), k);
    rig.aim('lowerarm.l', 'hand.l', fore, k);
    // Twist the forearm about itself so the slot's +Z (the way a held shield faces) turns forward.
    const axis = local(hand, _gH).sub(local(lower, _gE)).normalize();
    rig.root.getWorldQuaternion(_gQ).invert();
    const face = _gS.set(0, 0, 1).applyQuaternion(slot.getWorldQuaternion(_gQ2)).applyQuaternion(_gQ);
    face.addScaledVector(axis, -face.dot(axis));
    const ahead = _gW.set(0, 0, 1).addScaledVector(axis, -axis.z);
    const twist = Math.atan2(_gU.crossVectors(face, ahead).dot(axis), face.dot(ahead));
    rig.turn('lowerarm.l', axis, twist * k);
    // Whatever twist is left: holder = slot⁻¹ · (rig root turned half round: -Z ahead, +Y up).
    slot.getWorldQuaternion(_gQ2).invert();
    rig.root.getWorldQuaternion(_gQ).multiply(SHIELD_REST);
    this.shield.quaternion.copy(SHIELD_REST).slerp(_gQ2.multiply(_gQ), k);
    this.shieldTurned = true;
  }

  /**
   * Attacks follow the game's timings: the clip's wind-up part is stretched over the
   * strike's windup, its swing over the swing, and the rest over the recovery.
   */
  private scrubAttack(rig: Rig, p: Player): void {
    const list = (this.look && ATTACK_CLIPS[this.look]) || ATTACK_CLIPS.default;
    const sc: SwingClip = list[p.comboIndex % list.length];
    const d = rig.duration(sc.clip);
    const [a, b] = [sc.swing[0] * d, sc.swing[1] * d];
    const tm = p.attackTimes();
    const st = p.stateTime;
    let ct: number;
    if (st < tm.windup) ct = (st / tm.windup) * a;
    else if (st < tm.windup + tm.swing) ct = a + ((st - tm.windup) / tm.swing) * (b - a);
    else ct = b + Math.min(1, (st - tm.windup - tm.swing) / Math.max(0.01, tm.recover)) * (d - b);
    rig.scrub(sc.clip, ct, p.stateTime < 0.02 ? 0.05 : 0.08);
  }

  /** The placeholder's procedural poses. */
  private poseBlocky(p: Player, dt: number): void {
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0.95, 0);

    const hSpeed = Math.hypot(p.vel.x, p.vel.z);
    let armL = 0;
    let armR = 0;
    let legL = 0;
    let legR = 0;
    let armSpreadL = 0;
    let armSpreadR = 0;
    const t = performance.now() / 1000;
    let twist = 0;

    switch (p.state) {
      case 'ground': {
        if (hSpeed > 0.3) {
          this.phase += dt * hSpeed * 2.2;
          const s = Math.sin(this.phase) * Math.min(1, hSpeed / 5) * (p.sprinting ? 1.1 : 0.8);
          legL = s;
          legR = -s;
          armL = -s * 0.9;
          armR = s * 0.9;
          this.body.position.y += Math.abs(Math.cos(this.phase)) * 0.06;
          this.body.rotation.x = p.sprinting ? -0.2 : -0.06;
        } else {
          this.body.position.y += Math.sin(t * 2) * 0.012;
          armSpreadL = 0.06;
          armSpreadR = -0.06;
        }
        break;
      }
      case 'air':
        legL = 0.5;
        legR = -0.2;
        armL = -2.4;
        armR = -2.4;
        armSpreadL = 0.4;
        armSpreadR = -0.4;
        if (p.vel.y > 0) {
          armL = -1.2;
          armR = 0.6;
        }
        break;
      case 'roll': {
        const k = Math.min(1, p.stateTime / 0.41);
        this.body.position.y = 0.55;
        this.body.rotation.x = -k * Math.PI * 2;
        legL = legR = 1.3;
        armL = armR = 1.0;
        break;
      }
      case 'climb':
      case 'climbJump': {
        const move = Math.hypot(p.climbMove.x, p.climbMove.y);
        if (move > 0.05) this.phase += dt * 6 * move;
        const s = Math.sin(this.phase);
        armL = -2.6 + s * 0.45;
        armR = -2.6 - s * 0.45;
        legL = 0.5 - s * 0.45;
        legR = 0.5 + s * 0.45;
        this.body.rotation.x = 0.12;
        if (p.state === 'climbJump') {
          armL = armR = -3.0;
          legL = legR = 0.2;
        }
        break;
      }
      case 'skill': {
        // Generic casting / skill poses.
        const id = p.skill?.id ?? '';
        if (id === 'whirlwind') {
          twist = p.stateTime * 18;
          armR = -1.5;
          armSpreadR = 1.4;
          armL = -1.4;
          armSpreadL = -1.4;
        } else if (id === 'charge' || id === 'shieldBash') {
          this.body.rotation.x = -0.35;
          armR = -1.4;
          armL = -1.6;
        } else if (id === 'earthsplitter' || id === 'eviscerate' || id === 'riposte') {
          const k = Math.min(1, p.stateTime / (p.skill!.time * 0.6));
          armR = armL = -3.0 + k * 3.2;
          this.body.rotation.x = -0.4 * k;
        } else {
          // Spells, cries, throws: arms up and forward.
          armR = -2.2;
          armL = -1.8;
          armSpreadL = 0.3;
          armSpreadR = -0.3;
        }
        break;
      }
      case 'attack': {
        // Wind up (arm back) → swing across → recover. Strikes alternate sides; the 3rd is overhead.
        const a = p.attackTimes();
        const st = p.stateTime;
        const side = p.comboIndex === 1 ? -1 : 1;
        let k = 0;
        if (st < a.windup) k = -st / a.windup;
        else if (st < a.windup + a.swing) k = (st - a.windup) / a.swing;
        else k = 1;
        if (p.comboIndex === 2) {
          armR = k < 0 ? -1.2 + k * 1.9 : -3.1 + k * 3.2;
          armL = armR * 0.6;
          this.body.rotation.x = k < 0 ? 0.15 : -0.25 * Math.min(1, k);
        } else {
          armR = k < 0 ? -1.4 + k * 0.6 : -2.0 + k * 0.6;
          armSpreadR = k < 0 ? -0.8 * -k * side : 0.9 * (k * 2 - 1) * side;
          twist = (k < 0 ? 0.5 * -k : 0.5 - k * 1.1) * side;
          armL = -0.4;
        }
        legL = 0.35;
        legR = -0.35;
        break;
      }
      case 'stagger':
        armL = armR = 0.5;
        armSpreadL = 0.5;
        armSpreadR = -0.5;
        this.body.rotation.x = p.staggerKind === 'knockdown' ? 1.2 : 0.3;
        if (p.staggerKind === 'knockdown') this.body.position.y = 0.4;
        break;
      case 'dead':
        this.body.rotation.x = Math.min(1, p.stateTime * 3) * 1.45;
        this.body.position.y = 0.3;
        armL = armR = 0.3;
        break;
      case 'mantle':
        armL = armR = -2.0;
        legL = 1.2;
        legR = 0.4;
        this.body.rotation.x = -0.35;
        break;
      case 'glide':
        armL = armR = -2.9;
        armSpreadL = 0.25;
        armSpreadR = -0.25;
        legL = 0.15 + Math.sin(t * 3) * 0.1;
        legR = 0.1 - Math.sin(t * 3) * 0.1;
        this.body.rotation.x = -0.25;
        // Bank into turns.
        this.body.rotation.z = Math.max(-0.4, Math.min(0.4, -this.turnRate(p, dt) * 0.25));
        break;
    }

    if (p.blocking) {
      // Sword held across the body.
      armR = -1.5;
      armSpreadR = 0.9;
      armL = -1.2;
      armSpreadL = -0.6;
    }
    this.body.rotation.y = twist;

    const lerp = Math.min(1, dt * (p.state === 'attack' ? 40 : 18));
    this.armL.rotation.x += (armL - this.armL.rotation.x) * lerp;
    this.armR.rotation.x += (armR - this.armR.rotation.x) * lerp;
    this.legL.rotation.x += (legL - this.legL.rotation.x) * lerp;
    this.legR.rotation.x += (legR - this.legR.rotation.x) * lerp;
    this.armL.rotation.z += (armSpreadL - this.armL.rotation.z) * lerp;
    this.armR.rotation.z += (armSpreadR - this.armR.rotation.z) * lerp;
  }

  private lastFacing = 0;
  private smoothedTurn = 0;
  private turnRate(p: Player, dt: number): number {
    let d = p.facing - this.lastFacing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.lastFacing = p.facing;
    this.smoothedTurn += (d / Math.max(dt, 1e-4) - this.smoothedTurn) * Math.min(1, dt * 5);
    return this.smoothedTurn;
  }

  /** Stealth look: swap every mesh to a dim see-through material (and back); outlines hide. */
  private setGhost(on: boolean): void {
    if (on === this.ghost) return;
    this.ghost = on;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.name.endsWith('_outline')) {
        m.visible = !on;
        return;
      }
      if (on) {
        this.realMats.set(m, m.material);
        m.material = this.ghostMat;
      } else if (this.realMats.has(m)) {
        m.material = this.realMats.get(m)!;
      }
    });
    if (!on) this.realMats.clear();
  }
}
