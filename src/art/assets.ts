// Art manifest: every glTF file the game loads and how its clips map onto game states.
// Files live in `public/models/`; each pack is credited in CREDITS.md.
// Timing note: clip lengths never decide gameplay. Attack and roll clips are scrubbed so
// their swing lands inside the game's own windup/swing window (classes.ts combos,
// TUNING in config.ts); the `swing` marks below only say where the swing is in each clip.

import type { ClassId } from '../classes/classes';
import type { Look } from '../items/items';
import type { EnemyKind } from '../config';
import type { BossMove } from '../combat/Enemy';

/** KayKit Adventurers (CC0). All four bodies share one rig; the clips live in knight.glb. */
export const HUMANOID = {
  clips: 'models/chars/knight.glb',
  /** The pack's characters are ~2.5 units tall with headwear; this makes them ~1.85 m. */
  scale: 0.75,
  bodies: {
    warrior: 'models/chars/barbarian.glb',
    tank: 'models/chars/knight.glb',
    mage: 'models/chars/mage.glb',
    assassin: 'models/chars/rogue_hooded.glb',
  } as Record<ClassId, string>,
  /** Bones that carry held items. The pack's own props on them are hidden. */
  handR: 'handslot.r',
  handL: 'handslot.l',
  head: 'head',
  chest: 'chest',
  /** The class's own hat or helmet, hidden while a helmet item is worn. */
  headwear: ['Knight_Helmet', 'Barbarian_Hat', 'Mage_Hat'],
  /** The pack's helmet (a plain mesh on the head bone in the clips file), worn on the rig for 'helm' items. */
  helm: 'Knight_Helmet',
  /**
   * That helmet's fit per body (default: as on the knight): the rogue's hood is a little bigger
   * than a bare head, and its peak pokes out at the back. `back` moves it back (rig units).
   */
  helmFit: { assassin: { scale: 1.1, back: 0.04 } } as Partial<Record<ClassId, { scale: number; back: number }>>,
};

/** An attack clip and the part of it (fractions of its length) that is the swing itself. */
export interface SwingClip {
  clip: string;
  swing: [number, number];
}

const s = (clip: string, a: number, b: number): SwingClip => ({ clip, swing: [a, b] });

/**
 * Combo strikes by weapon look; strike i uses entry i (wrapping).
 * Swing marks are measured, not guessed: the clip sampled 61 times, `handslot.r` tracked in
 * world space, swing = the samples where that hand moves at ≥ 50% of the clip's peak speed
 * (Dualwield: the faster hand). Clips are keyed at 30 fps, so marks are good to about ±0.02.
 * 1H_Slice_Horizontal uses its 40% window: at 50% the swing is a single key step.
 */
export const ATTACK_CLIPS: Partial<Record<Look, SwingClip[]>> & { default: SwingClip[] } = {
  default: [
    s('1H_Melee_Attack_Slice_Diagonal', 0.37, 0.43),
    s('1H_Melee_Attack_Slice_Horizontal', 0.18, 0.27),
    s('1H_Melee_Attack_Chop', 0.5, 0.57),
  ],
  mace: [s('1H_Melee_Attack_Slice_Diagonal', 0.37, 0.43), s('1H_Melee_Attack_Chop', 0.5, 0.57)],
  greatsword: [
    s('2H_Melee_Attack_Slice', 0.33, 0.38),
    s('2H_Melee_Attack_Slice', 0.33, 0.38),
    s('2H_Melee_Attack_Chop', 0.38, 0.52),
  ],
  daggers: [
    // Slice and Chop have a second, off-hand burst later (0.60–0.72 / 0.63–0.68); it plays in the recovery.
    s('Dualwield_Melee_Attack_Slice', 0.45, 0.53),
    s('Dualwield_Melee_Attack_Chop', 0.4, 0.48),
    s('Dualwield_Melee_Attack_Stab', 0.22, 0.27),
    s('Dualwield_Melee_Attack_Chop', 0.4, 0.48),
  ],
  // The fast part of the cast is the push forward; the hand is fully out at ~0.3.
  staff: [s('Spellcast_Shoot', 0.03, 0.2), s('Spellcast_Shoot', 0.03, 0.2)],
};

/** Skills: a clip stretched over the skill's time (`loop` clips repeat instead). */
export const SKILL_CLIPS: Record<string, { clip: string; loop?: boolean; speed?: number }> = {
  whirlwind: { clip: '2H_Melee_Attack_Spin', loop: true, speed: 1.6 },
  charge: { clip: 'Running_A', loop: true, speed: 1.6 },
  shieldBash: { clip: '1H_Melee_Attack_Stab' },
  earthsplitter: { clip: '2H_Melee_Attack_Chop' },
  eviscerate: { clip: 'Dualwield_Melee_Attack_Stab' },
  riposte: { clip: '1H_Melee_Attack_Stab' },
  fanOfKnives: { clip: 'Throw' },
  warCry: { clip: 'Cheer' },
  taunt: { clip: 'Cheer' },
  bulwark: { clip: 'Block' },
  frostNova: { clip: 'Spellcast_Raise' },
  meteor: { clip: 'Spellcast_Long' },
  default: { clip: 'Spellcast_Shoot' },
};

// ---------------------------------------------------------------- enemies (milestone 8)

/**
 * One enemy attack on the rig. The clip is scrubbed by the game's timings (ENEMY_STATS, BOSS_MOVES):
 * [0, swing[0]] over the wind-up, `swing` over the active window, the rest over the recovery.
 * Where the hit lands decides `swing`: melee and boss moves hit at the middle of the active window,
 * so `swing` is the measured fast part (the tracked point moving at ≥ 50% of its peak speed: the
 * right hand slot for humanoids, the head or arm tip for beasts); shots and slams hit on its first
 * frame, so it starts at the release or the impact; lunges hurt on contact all through it.
 */
export interface EnemyAttack {
  clip: string;
  swing: [number, number];
  /** Shown over the wind-up instead: this clip scrubbed from its start to `to` (a fraction). */
  windup?: { clip: string; to: number };
  /** Looped over the active window instead (charges); `ground` = its stride speed (model units/s) to match. */
  loop?: { clip: string; ground: number };
  /** Looped over the recovery instead. */
  recover?: string;
}

/**
 * A clip and its stride speed: model units per second at clip speed 1, measured from the planted feet
 * (the soles' travel while on the ground; for an in-place hop, the distance one hop should cover per second).
 */
export type Stride = [clip: string, ground: number];

/** Sideways locomotion: clips that travel `angle` radians to the model's left / right of its facing, at `ground`. */
export interface StrafeClips {
  left: string;
  right: string;
  ground: number;
  angle: number;
}

/**
 * A hopping gait (the slime): the clip's base is on the ground over `contact` (fractions of its cycle; may
 * wrap past 1) and slides back at `sweep` model units/s meanwhile. Whatever ground speed the clip cannot
 * cover there is taken up by a small visual lead and lag along the travel, so the base stays put while down.
 */
export interface PlantedHop {
  contact: [number, number];
  sweep: number;
}

/** Pointed ears on the head bone (the goblin): the left ear in model units at rest (the right one mirrored). */
export interface Ears {
  /** Base point, where the head's own ear is. */
  at: [number, number, number];
  /** Direction the ear points (model space: +x the model's left, +y up, +z the way it faces). */
  dir: [number, number, number];
  length: number;
  /** Width at the base; it is a third as thick. */
  width: number;
  color: number;
}

/** A prop from another file, held on a bone (pack props point along the slot's +Y). */
export interface EnemyWeapon {
  file: string;
  bone: string;
  pos: [number, number, number];
  rot: [number, number, number];
}

export interface EnemyArt {
  body: string;
  /** Files holding the clips (KayKit bodies share the Adventurers' rig); default: the body's own. */
  clips?: string[];
  /** Model units → metres; fitted so the height is near the collider's topY. */
  scale: number;
  /** Raise (model units) so the rest pose stands on the ground. */
  lift?: number;
  idle: string;
  /** Idle while chasing (standing still between attacks). */
  combatIdle?: string;
  walk: Stride;
  /** Between walk and run (humanoids); the gait whose stride is nearest the ground speed plays. */
  jog?: Stride;
  run: Stride;
  /** Walking backwards (humanoids); much faster than its stride (a goblin backing off), the model turns and runs instead. */
  back?: Stride;
  /** Sideways (humanoids circling or strafing). */
  strafe?: StrafeClips;
  /** Fastest playback of a locomotion clip (default 2.5); spider legs churn, a charging boar's blur. */
  clipMax?: number;
  /** Hopping clips by name (the slime). */
  plant?: Record<string, PlantedHop>;
  /** By combo step (the bandit's and skeleton's second strike uses entry 1). */
  attacks: EnemyAttack[];
  /** Boss moves and the phase-2 roar (`phase`: `swing` is the part of the clip shown over the roar). */
  boss?: Partial<Record<BossMove | 'phase', EnemyAttack>>;
  /** Stagger clip; none: a procedural flinch. */
  hit?: string;
  knockdown?: string;
  death: string;
  /** Height (m) of a hop over a lunge's active window (clips that bite in place). */
  hop?: number;
  /** Summoned: rise with this clip (speed-up) when spawned. */
  spawn?: { clip: string; speed: number };
  /** The pack's own hand-slot props to keep; all others are hidden. */
  props?: string[];
  weapons?: EnemyWeapon[];
  /** Material colours by material name. */
  colors?: Record<string, number>;
  /** Multiply every colour by this. */
  tint?: number;
  /**
   * Palette cells to recolour in the model's texture, "column,row" → colour (KayKit atlases: 8 × 4 cells of
   * vertical gradients); every pixel keeps its shade. The goblin's green skin on the bandit's body.
   */
  recolor?: Record<string, number>;
  ears?: Ears;
  /** Scale every colour by this (above 1 lightens a dark texture). */
  brighten?: number;
  /** Grey the texture (stone) and multiply by this colour. */
  stone?: number;
  /** Emissive colour of the 'Glow' material (skeleton eyes). */
  glow?: number;
  /** Other files to fetch with this one (the boss's adds). */
  preload?: string[];
  /** Culling sphere: the rest pose's, times this (default 1.7; measured over every clip used). */
  cullPad?: number;
}

const KAYKIT_CLIPS = [HUMANOID.clips, 'models/enemies/clips_extra.glb'];
const HAND_R = { bone: 'handslot.r', pos: [0, 0.033, 0], rot: [0, Math.PI, 0] } as const;
const weapon = (file: string, at: { bone: string; pos: readonly number[]; rot: readonly number[] } = HAND_R): EnemyWeapon => ({
  file: `models/enemies/${file}.glb`,
  bone: at.bone,
  pos: [at.pos[0], at.pos[1], at.pos[2]],
  rot: [at.rot[0], at.rot[1], at.rot[2]],
});
/** KayKit Skeletons weapons; the shield sits where the Adventurers' shields do. */
const BLADE = weapon('skeleton_blade');
const SHIELD = weapon('skeleton_shield', { bone: 'handslot.l', pos: [0, 0.017, 0.156], rot: [0, 0, 0] });
/**
 * Along the slot's +Y a staff lies flat in Idle (out in front at hip height). Like the player's staff
 * grip it stands up the slot's -X instead, leaning forward (+Y) and out (+Z): the staff's +Y turned
 * onto (-1, 0.4, 0.5); slid 0.25 up through the fist so its foot clears the ground.
 */
const STAFF = weapon('skeleton_staff', { bone: 'handslot.r', pos: [-0.211, 0.084, 0.105], rot: [0.452, 0.268, 1.062] });
const a = (clip: string, s0: number, s1: number, more: Partial<EnemyAttack> = {}): EnemyAttack => ({ clip, swing: [s0, s1], ...more });

/**
 * Shared by humanoid enemies (KayKit rig). Strides are the soles' planted travel (each foot's lowest
 * vertices, sampled 121 times per clip): walk 0.70, jog 2.21, run 4.42, backwards 0.71; the strafes
 * travel 4.4 at 60° off the facing (they run diagonally forward), so a sideways circle turns the body 30°.
 */
const KAYKIT = {
  clips: KAYKIT_CLIPS,
  idle: 'Idle',
  combatIdle: 'Idle_Combat',
  walk: ['Walking_A', 0.7] as Stride,
  jog: ['Running_B', 2.21] as Stride,
  run: ['Running_A', 4.42] as Stride,
  back: ['Walking_Backwards', 0.71] as Stride,
  strafe: { left: 'Running_Strafe_Left', right: 'Running_Strafe_Right', ground: 4.4, angle: Math.PI / 3 },
  hit: 'Hit_A',
  knockdown: 'Hit_B',
  death: 'Death_A',
};
const SKELETON = {
  ...KAYKIT,
  walk: ['Walking_D_Skeletons', 0.46] as Stride,
  run: ['Running_C', 4.37] as Stride,
  death: 'Death_C_Skeletons',
  // The bones scatter as it falls apart: an arm lands 2.4 rest-radii out.
  cullPad: 2.6,
};
const GOBLIN_SKIN = 0x7fae48;
const SKELETON_SLICES = [a('1H_Melee_Attack_Slice_Diagonal', 0.37, 0.43), a('1H_Melee_Attack_Slice_Horizontal', 0.18, 0.27)];

/**
 * Enemy models (`add` = the boss's summoned skeletons). Rest sizes in model units, from the files:
 * slime 1.83 tall; boar 4.17 tall (to the crest) × 9.36 long (tail included); wolf 2.67 × 5.27; spider 1.95 tall × 5.94 wide;
 * yeti 3.2; KayKit bodies 2.17 (2.59 with the warrior's helmet, 2.63 with the mage's hat).
 * Strides: the soles' planted travel (see KAYKIT). The AI's speeds then play every locomotion clip between
 * about 0.5× and 2× (spider and boar charge excepted, see `clipMax`).
 */
export const ENEMY_ART: Record<EnemyKind | 'add', EnemyArt> = {
  slime: {
    body: 'models/enemies/slime.glb', scale: 0.48, lift: 0.013,
    // Walk is a small hop whose base slides back 0.94/s while down (wander: 1.9×); Jump hops in place, played
    // so one hop covers 1 m (4.8 model units/s at 1×: 1.04× at chase speed). The base stays put while down (`plant`).
    idle: 'Idle', walk: ['Walk', 0.94], run: ['Jump', 4.8], clipMax: 2,
    plant: { Walk: { contact: [0.9, 0.27], sweep: 0.94 }, Jump: { contact: [0.97, 0.25], sweep: 0 } },
    // Leans back, then bites forward (0.33–0.5); the hop carries the lunge.
    attacks: [a('Bite_Front', 0.3, 0.55)], hop: 0.45,
    hit: 'HitRecieve', death: 'Death',
    // The pack's green is very dark under the toon ramp; lighter, it reads like the old slime.
    brighten: 1.8,
  },
  boar: {
    // A low-poly wild boar (tusks, bristle ridge) skinned to the Quaternius bull's rig and clips; see CREDITS.md.
    body: 'models/enemies/boar.glb', scale: 0.28, lift: 0.007,
    // The charge (12 m/s) gallops at 5.2×: the legs blur, but stay planted.
    idle: 'Idle', walk: ['Walk', 1.64], run: ['Gallop', 8.32], clipMax: 5.5,
    // Head down over the wind-up, gallop through the charge, the head toss (0.45–0.55) on the recovery.
    attacks: [a('Attack_Headbutt', 0.33, 0.45, { loop: { clip: 'Gallop', ground: 8.32 } })],
    hit: 'Idle_HitReact1', death: 'Death',
    // Dark bristly brown, a darker crested mane stripe from the forehead to the tail, a dusky snout; the ivory
    // tusks keep the file's colour.
    colors: { Hide: 0x56402f, Bristle: 0x433126, Snout: 0x80604f },
  },
  wolf: {
    body: 'models/enemies/wolf.glb', scale: 0.45, lift: 0.01,
    idle: 'Idle', walk: ['Walk', 1.65], run: ['Gallop', 8.55],
    // The lunge and bite (head forward and down, 0.18–0.5); the fastest burst (0.65–0.78) is the head coming back up.
    attacks: [a('Attack', 0.2, 0.5)],
    hit: 'Idle_HitReact1', death: 'Death',
  },
  spider: {
    // The eight tips plant at 1.8–3.7/s (median 2.52): chase speed (4.5 m/s) is 4.5×, fast-churning legs.
    body: 'models/enemies/spider.glb', scale: 0.4,
    idle: 'Spider_Idle', walk: ['Spider_Walk', 2.52], run: ['Spider_Walk', 2.52], clipMax: 5,
    // The pounce: crouch, airborne 0.4–0.75 (the lunge), land.
    attacks: [a('Spider_Jump', 0.4, 0.75)],
    death: 'Spider_Death',
  },
  golem: {
    // No lift: the rest pose dips 0.12 below the ground, but Idle stands at +0.02 (Walk dips to -0.12).
    // Walk swings each block foot like a pendulum and sets it down at the bottom of the swing, sweeping back
    // at 1.2–1.7/s as it lands (1.4); Run plants at 6.9. Chase speed (2.4 m/s) walks at 1.7×.
    body: 'models/enemies/golem_yeti.glb', scale: 1.03,
    idle: 'Idle', walk: ['Walk', 1.4], run: ['Run', 6.9],
    // Both fists come down over 0.55–0.8 and hit the ground at ~0.8: the slam's blast is the active window's first frame.
    attacks: [a('Attack', 0.72, 0.88)],
    hit: 'HitRecieve', death: 'Death', stone: 0xb4ada2,
  },
  bandit: {
    ...KAYKIT, body: 'models/enemies/bandit.glb', scale: 0.85,
    attacks: [a('Dualwield_Melee_Attack_Slice', 0.45, 0.53), a('Dualwield_Melee_Attack_Chop', 0.4, 0.48)],
    props: ['Knife', 'Knife_Offhand'],
  },
  goblin: {
    ...KAYKIT, body: 'models/enemies/bandit.glb', scale: 0.64,
    // Raises and aims the crossbow (0–0.27), the shot, then lowers it.
    attacks: [a('1H_Ranged_Shoot', 0.27, 0.33)],
    props: ['1H_Crossbow'],
    // The bandit's body, its own colours: green skin (face, ears, knees), leather browns for the green tunic and
    // the cape and trims, dark hair. Atlas cells "column,row" (see `recolor`).
    recolor: { '0,0': GOBLIN_SKIN, '0,1': 0x6e5638, '1,1': 0x54422c, '1,0': 0x3b2f27 },
    // Out of the head's own ears (at ±0.5, 1.52), back and up.
    ears: { at: [0.47, 1.53, 0.0], dir: [1, 0.5, -0.32], length: 0.46, width: 0.22, color: GOBLIN_SKIN },
  },
  skeleton: {
    ...SKELETON, body: 'models/enemies/skeleton_warrior.glb', scale: 0.8,
    attacks: SKELETON_SLICES, weapons: [BLADE, SHIELD],
  },
  add: {
    ...SKELETON, body: 'models/enemies/skeleton_minion.glb', scale: 0.85,
    attacks: SKELETON_SLICES, weapons: [BLADE],
    spawn: { clip: 'Spawn_Ground_Skeletons', speed: 3.5 },
  },
  cultist: {
    ...SKELETON, body: 'models/enemies/skeleton_mage.glb', scale: 0.8,
    // Staff raised overhead over the wind-up, then the cast's push forward (0.03–0.2) releases the orb.
    attacks: [a('Spellcast_Shoot', 0.1, 0.2, { windup: { clip: 'Spellcast_Raise', to: 0.3 } })],
    weapons: [STAFF], glow: 0xc070ff,
  },
  warden: {
    // At 1.75× its strides are long: the chase (3.4 m/s, 4.4 in phase 2) jogs at 0.9–1.1× and only the
    // charge (15 m/s) runs (Running_C at 2×).
    ...SKELETON, body: 'models/enemies/skeleton_warrior.glb', scale: 1.75,
    attacks: [a('1H_Melee_Attack_Slice_Horizontal', 0.18, 0.27)],
    boss: {
      sweep: a('1H_Melee_Attack_Slice_Horizontal', 0.18, 0.27),
      // Leaps (0.15–0.42) and chops down; the axe hits the ground at ~0.55.
      slam: a('1H_Melee_Attack_Jump_Chop', 0.5, 0.6),
      charge: a('Running_C', 0, 1, { windup: { clip: 'Idle_Combat', to: 0.3 }, loop: { clip: 'Running_C', ground: 4.37 }, recover: 'Idle_Combat' }),
      volley: a('Spellcast_Shoot', 0.1, 0.2, { windup: { clip: 'Spellcast_Raise', to: 0.3 } }),
      nova: a('Spellcast_Raise', 0.22, 0.32),
      // The roar calls the adds: both arms come up at ~0.65–0.7.
      phase: a('Spellcast_Summon', 0.35, 0.95),
    },
    weapons: [weapon('skeleton_axe')], glow: 0xff6a1e,
    preload: ['models/enemies/skeleton_minion.glb'],
  },
};

/** Rigs further than this (m) from the player only animate while awake (not idle). */
export const ENEMY_ANIM_RANGE = 60;

// ---------------------------------------------------------------- items (milestone 8)

type V3 = [number, number, number];

/**
 * An item's model and how it sits in item space: metres; weapons point along -Z from the grip at
 * the origin, everything else is centred with its front facing -Z (as the procedural models in
 * ItemMesh.ts). `pos`/`rot` (Euler XYZ)/`scale` place the file's node in that space.
 */
export interface ItemArt {
  file: string;
  node: string;
  pos: V3;
  rot: V3;
  scale: number;
  /** Multiply every colour by this (rust, ember). */
  tint?: number;
  /** A glow of its own (uniques), in place of the rarity colour. */
  glow?: number;
}

/** Shared items file: KayKit props (some recoloured) and models made for the game in Blender; see CREDITS.md. */
export const ITEM_FILE = 'models/items/items.glb';
const SKELETON_BLADE = 'models/enemies/skeleton_blade.glb';
const SKELETON_STAFF = 'models/enemies/skeleton_staff.glb';
/** KayKit units → metres (the rig's scale). */
const KK = HUMANOID.scale;
/**
 * A pack prop in a right hand slot sits `slotY` out along the slot's +Y (the fist's grip axis), turned
 * half round about it. The game's hand holders turn item -Z onto that axis and undo the rig's scale,
 * so in item space the prop is turned (π/2, 0, π), slid `slotY` (pack units) along -Z, and sized KK.
 */
const held = (file: string, node: string, slotY = 0.033, size = 1, more: Partial<ItemArt> = {}): ItemArt => ({
  file, node, pos: [0, 0, -slotY * KK * size], rot: [Math.PI / 2, 0, Math.PI], scale: KK * size, ...more,
});
/**
 * Staffs stand up the hand slot's -X (PlayerModel's STAFF_GRIP), so only their length matters: each slides
 * along itself so its foot (at `footY` along the file's +Y, pack units) sits 0.4 m behind the grip, like the
 * old staff's (its foot then clears the ground in Idle).
 */
const staff = (file: string, node: string, footY: number, more: Partial<ItemArt> = {}): ItemArt => ({
  file, node, pos: [0, 0, 0.4 - -footY * KK], rot: [Math.PI / 2, 0, Math.PI], scale: KK, ...more,
});
/** Pack shields face +Z on the left slot; item fronts face -Z, so they turn half round (PlayerModel turns them back). */
const shield = (node: string): ItemArt => ({ file: ITEM_FILE, node, pos: [0, 0, 0], rot: [0, Math.PI, 0], scale: KK });
/** Pieces modelled in metres, front -Z: centred by `pos`. */
const worn = (node: string, pos: V3, more: Partial<ItemArt> = {}): ItemArt => ({ file: ITEM_FILE, node, pos, rot: [0, 0, 0], scale: 1, ...more });

const RUST = 0xd9a27a;
const EMBER = 0xffb08a;

/**
 * Models per look; `bases` and `uniques` override it (the starter rusty pieces, legendaries).
 * Off-hand tome: the pack's spellbook (spine along its -Z, height +Y, covers ±X) turned so the spine
 * runs along item -X and the covers face ±Z, sized like the pack's own (the off-hand rest shrinks it 0.85).
 */
export const ITEM_ART: {
  looks: Record<Look, ItemArt>;
  bases: Record<string, ItemArt>;
  uniques: Record<string, ItemArt>;
} = {
  looks: {
    sword: held(ITEM_FILE, 'Sword_Iron'),
    greatsword: held(ITEM_FILE, 'Greatsword'),
    mace: held(ITEM_FILE, 'Mace_Flanged'),
    staff: staff(ITEM_FILE, 'Staff_Runed', -0.9),
    daggers: held(ITEM_FILE, 'Dagger', 0),
    // A short sword with a broad guard (the pack's 1H sword at 55%) reads as a main-gauche.
    parryDagger: held(ITEM_FILE, 'Sword_Iron', 0.033, 0.55),
    tome: { file: ITEM_FILE, node: 'Tome', pos: [0, 0, 0], rot: [0, Math.PI / 2, 0], scale: KK / 0.85 },
    woodShield: shield('Shield_Wood'),
    ironShield: shield('Shield_Iron'),
    // Head pieces are modelled on the rig's head bone (`HEAD_ART`); on the ground and on stands they shrink to ~0.5 m.
    cap: { file: ITEM_FILE, node: 'Cap', pos: [0, -0.28, 0], rot: [0, Math.PI, 0], scale: 0.4 },
    helm: { file: HUMANOID.clips, node: HUMANOID.helm, pos: [0, -0.23, 0.036], rot: [0, Math.PI, 0], scale: 0.42 },
    tunic: worn('Tunic', [0, -0.02, 0]),
    mail: worn('Mail', [0, -0.02, 0]),
    gloves: worn('Gloves', [0, -0.016, 0]),
    gauntlets: worn('Gauntlets', [0, -0.015, 0]),
    boots: worn('Boots', [0, -0.173, 0.043]),
    greaves: worn('Greaves', [0, -0.188, 0.044]),
    ring: worn('Ring', [0, -0.053, 0]),
    amulet: worn('Amulet', [0, 0.05, 0]),
  },
  bases: {
    // KayKit Skeletons' jagged blade (the skeletons' own file) as the starter's rusty sword.
    rustySword: held(SKELETON_BLADE, 'Skeleton_Blade'),
    rustyMace: held(ITEM_FILE, 'Mace_Rusty'),
    oakStaff: staff(ITEM_FILE, 'Staff_Oak', -0.64),
    rustyDaggers: held(ITEM_FILE, 'Dagger', 0, 1, { tint: RUST }),
  },
  uniques: {
    // "Autumn Sword" by SimberGI (CC BY 4.0), decimated, its glow baked into the colour map.
    emberfang: held(ITEM_FILE, 'Sword_Autumn'),
    emberMaul: held(ITEM_FILE, 'Mace_Flanged', 0.033, 1, { tint: EMBER, glow: 0xff4a10 }),
    cinderstaff: staff(SKELETON_STAFF, 'Skeleton_Staff', -0.846, { tint: EMBER, glow: 0xff5a1a }),
    bloodfangs: held(ITEM_FILE, 'Dagger', 0, 1, { tint: 0xff9090, glow: 0xff1f3a }),
    thirstBand: worn('Ring', [0, -0.053, 0], { tint: 0xd05a6a, glow: 0xff2040 }),
    driftstep: worn('Boots', [0, -0.173, 0.043], { tint: 0xc4e6ff, glow: 0x5fd0ff }),
    heartstone: worn('Amulet', [0, 0.05, 0], { tint: 0xff9a90, glow: 0xff3030 }),
  },
};

/**
 * Head pieces as worn on the rig: nodes modelled on the head bone (rig units), placed there as they are;
 * `HUMANOID.helmFit` refits them over the rogue's hood.
 */
export const HEAD_ART: Partial<Record<Look, { file: string; node: string }>> = {
  helm: { file: HUMANOID.clips, node: HUMANOID.helm },
  cap: { file: ITEM_FILE, node: 'Cap' },
};

// ---------------------------------------------------------------- furniture and home fixtures (milestone 8)

/**
 * Catalogue furniture and the home's fixtures, one node per piece (KayKit Dungeon Remastered, Furniture Bits
 * and Halloween Bits, and pieces built for the game from them; see CREDITS.md). Every node is in metres with
 * its origin on the floor at the piece's anchor, facing as the procedural piece it replaces (furniture.ts),
 * so it drops in with no transform. All share one 512 px palette atlas (three glow variants for the book,
 * anvil and lantern glass).
 */
export const FURNITURE_FILE = 'models/home/furniture.glb';

/** Catalogue furniture (FURNITURE ids) → node. */
export const FURNITURE_ART: Record<string, string> = {
  table: 'Table', chair: 'Chair', bookshelf: 'Bookshelf', rug: 'Rug', plant: 'Plant', lantern: 'Lantern', banner: 'Banner', barrel: 'Barrel',
};

export type FixtureKind = 'chest' | 'mount' | 'stand' | 'trinketTable' | 'lectern' | 'bed' | 'crate' | 'workbench';

/** Home fixtures → node. The weapon mount's origin is on the wall face (the board stands out along +z). */
export const FIXTURE_ART: Record<FixtureKind, string> = {
  chest: 'Chest', mount: 'WeaponMount', stand: 'ArmourStand', trinketTable: 'TrinketTable', lectern: 'Lectern', bed: 'Bed', crate: 'Crate', workbench: 'Workbench',
};

/** Outline width (m) per node, default 0.03 as the procedural pieces; the rug lies flat and has none. */
export const FURNITURE_OUTLINE: Record<string, number> = { Rug: 0 };

// ---------------------------------------------------------------- town villagers (milestone 8)

/** A prop from another file, held on a bone (hand slots). */
export interface NpcProp {
  file: string;
  node: string;
  bone: string;
  /** Slot units. */
  pos?: V3;
  /** Euler XYZ; default half round about Y, as the pack holds its own props. */
  rot?: V3;
  /** Point the prop's +Y along this direction in the slot's frame instead (staffs). */
  dir?: V3;
  scale?: number;
}

/** A piece of furniture beside a villager that its idle works on (the carpenter's crate). */
export interface NpcStation {
  file: string;
  node: string;
  /** Metres from the villager in its resting frame: +x its right, -z ahead. */
  at: [number, number];
  /** Turn (radians) against the villager's resting facing. */
  yaw: number;
  scale: number;
}

export interface NpcArt {
  body: string;
  /** Files holding the clips (every KayKit body plays them). */
  clips: string[];
  /** Model units → metres. */
  scale: number;
  /** Nodes of the body left out (hats, a cape). */
  hide?: string[];
  /** The pack's own hand-slot props to keep; all others are left out. */
  props?: string[];
  held?: NpcProp[];
  /** Palette cells to repaint, "column,row" → colour (see `EnemyArt.recolor`); the body's own file is untouched. */
  recolor?: Record<string, number>;
  /** The role idle, looped while not talking. */
  idle: string;
  /** In a conversation: `greet` once while turning to the player, then `idle` with a `gestures` clip every few seconds. */
  talk: { greet: string; idle: string; gestures: string[] };
  station?: NpcStation;
}

/** Character Animations 1.1 clips the villagers use (the KayKit Adventurers rig, trimmed); see CREDITS.md. */
export const NPC_CLIPS = 'models/npcs/npc_clips.glb';
/** Hand props for villagers: KayKit RPG Tools Bits (ledger, wrench, magnifying glass, mallet). */
export const NPC_PROPS = 'models/npcs/npc_props.glb';
const VILLAGER_CLIPS = [HUMANOID.clips, NPC_CLIPS];
const TALK = { greet: 'Waving', idle: 'Idle', gestures: ['Interact'] };

/**
 * Town villagers by NPC id. KayKit bodies on the Adventurers rig: the Barbarian, Knight, Mage and Rogue bodies
 * the player and the bandits already load, without their hats and repainted, and two from Adventurers 2.0 (the
 * Ranger, the long-haired Mage). Atlas cells per body: Mage 0,1 robe, 1,0 hair, 2,1 cape, 4,0 cuffs and hem;
 * Rogue 0,1 tunic, 1,0 hair, 1,1 cape and scarf; Knight 3,0 armour, 1,0 hair; Ranger 0,1 neckerchief and cape;
 * Barbarian 1,0 beard and brows, 6,0 straps, 7,0 cape.
 */
export const NPC_ART: Record<string, NpcArt> = {
  elder: {
    body: 'models/npcs/mage_longhair.glb', clips: VILLAGER_CLIPS, scale: 0.72,
    recolor: { '1,0': 0xdedad2, '0,1': 0xd9cfb6, '2,1': 0x7a2a3a, '4,0': 0xc9a040 },
    idle: 'Idle_B', talk: TALK,
  },
  steward: {
    body: 'models/enemies/bandit.glb', clips: VILLAGER_CLIPS, scale: 0.74,
    recolor: { '0,1': 0x2f6a5a, '1,1': 0x34405e, '1,0': 0xd9b26a },
    held: [{ file: NPC_PROPS, node: 'Ledger', bone: 'handslot.l' }],
    idle: 'Holding_B', talk: TALK,
  },
  tinker: {
    body: HUMANOID.clips, clips: VILLAGER_CLIPS, scale: 0.75,
    hide: ['Knight_Helmet', 'Knight_Cape'],
    recolor: { '3,0': 0xb58a4a, '1,0': 0x8a462e },
    held: [{ file: NPC_PROPS, node: 'Wrench', bone: 'handslot.r' }],
    idle: 'Working_A', talk: TALK,
  },
  hunter: {
    body: 'models/npcs/ranger.glb', clips: VILLAGER_CLIPS, scale: 0.77,
    recolor: { '0,1': 0x4d6a2f },
    // The pack's longbow, stood upright in the left hand at his side (baked into the file's hand slot).
    props: ['Bow'],
    idle: 'Idle', talk: TALK,
  },
  scholar: {
    body: HUMANOID.bodies.mage, clips: VILLAGER_CLIPS, scale: 0.73,
    hide: ['Mage_Hat'],
    recolor: { '0,1': 0x34467e, '1,0': 0x5c3a32, '2,1': 0x6b4a32 },
    props: ['Spellbook_open'],
    held: [{ file: NPC_PROPS, node: 'Magnifier', bone: 'handslot.r' }],
    idle: 'Holding_B', talk: TALK,
  },
  carpenter: {
    body: HUMANOID.bodies.warrior, clips: VILLAGER_CLIPS, scale: 0.8,
    hide: ['Barbarian_Hat'],
    recolor: { '1,0': 0x794e2a },
    held: [{ file: NPC_PROPS, node: 'Mallet', bone: 'handslot.r', scale: 0.6 }],
    idle: 'Hammering', talk: TALK,
    station: { file: FURNITURE_FILE, node: 'Crate', at: [0.24, -0.6], yaw: 0.2, scale: 0.85 },
  },
};

/** Villagers further than this (m) from the player hold their pose (their mixers do not run). */
export const NPC_ANIM_RANGE = 40;
/**
 * Within this (m) of the player a villager draws its outline, casts its sun shadow and animates every frame.
 * Further out it does neither (its 3 cm outline is under half a pixel wide there at the default pixel scale)
 * and animates every other frame; 0.5 m of slack each way keeps it from flickering at the edge.
 */
export const NPC_DETAIL_RANGE = 20;

// ---------------------------------------------------------------- world: props and environment (milestone 8)

/**
 * The overworld's props and environment: vegetation, rocks, the building kit (town houses and the home's
 * shell), ruins, the dungeon gate, the well, chests, campfires, camp and town dressing, and the glider.
 * One file on one 512 px palette atlas (KayKit Forest Nature, Medieval Hexagon, Dungeon Remastered and
 * Halloween Bits palettes); material `World`, plus `WorldGlow` for the few parts that glow.
 */
export const WORLD_FILE = 'models/world/world.glb';

/** Outline widths for nodes cloned whole from the world file (everything else is merged by the game). */
export const WORLD_OUTLINE: Record<string, number> = {
  ChestBody: 0.025, ChestLid: 0.025, ChestGoldBody: 0.025, ChestGoldLid: 0.025, Campfire: 0.025, Glider: 0.03,
};

export type VegRegion = 'meadow' | 'forest' | 'ruins';

/** A scattered piece: its node, an optional far LOD node, how often it is picked and its scale range. */
export interface ScatterPiece {
  node: string;
  lod?: string;
  weight: number;
  scale: [number, number];
  /** Sink this far into the ground (fraction of its height), so rocks sit in the soil. */
  sink?: number;
}

/**
 * Trees per region (the scatter positions are the old trees'; each region picks its own kinds). Few kinds on
 * purpose: every kind costs a draw call or two wherever it is in view, so variety comes from scale, turn and tint.
 */
export const TREE_ART: Record<VegRegion, ScatterPiece[]> = {
  meadow: [
    { node: 'TreeMeadowA', lod: 'TreeMeadowA_LOD', weight: 1, scale: [0.95, 1.35] },
    { node: 'TreeMeadowB', lod: 'TreeMeadowB_LOD', weight: 1, scale: [0.9, 1.3] },
  ],
  forest: [
    { node: 'TreeForestA', lod: 'TreeForestA_LOD', weight: 1, scale: [0.95, 1.4] },
    { node: 'TreeForestB', lod: 'TreeForestB_LOD', weight: 1, scale: [0.9, 1.35] },
  ],
  ruins: [
    { node: 'TreeRuinsA', lod: 'TreeRuinsA_LOD', weight: 3, scale: [0.9, 1.3] },
    { node: 'TreeRuinsC', lod: 'TreeRuinsC_LOD', weight: 2, scale: [0.9, 1.2] },
  ],
};

/** Instance tints per region (multiply the atlas): bright warm meadow, dark blue-green wood, dry ruins. */
export const VEG_TINT: Record<VegRegion, [number, number, number]> = {
  meadow: [1.08, 1.1, 0.82],
  forest: [0.58, 0.74, 0.7],
  ruins: [1.05, 0.95, 0.82],
};

/** Ground cover and rocks scattered by region density; `range` = drawn within this distance of the player. */
export interface ScatterLayer {
  id: string;
  /** Instances on the main map (the test map gets a tenth). */
  count: number;
  /** Density 0..1 per region. */
  density: Record<VegRegion, number>;
  pieces: Partial<Record<VegRegion, ScatterPiece[]>>;
  range: number;
  maxSlope: number;
  shadow: boolean;
}

export const SCATTER_ART: ScatterLayer[] = [
  {
    id: 'grass', count: 4800, density: { meadow: 1, forest: 0.55, ruins: 0.2 }, range: 24, maxSlope: 0.7, shadow: false,
    pieces: {
      meadow: [{ node: 'Grass', weight: 1, scale: [0.8, 1.4] }],
      forest: [{ node: 'Grass', weight: 1, scale: [0.9, 1.5] }],
      ruins: [{ node: 'GrassB', weight: 1, scale: [0.7, 1.1] }],
    },
  },
  {
    id: 'bush', count: 1100, density: { meadow: 0.45, forest: 1, ruins: 0.3 }, range: 34, maxSlope: 0.65, shadow: false,
    pieces: {
      meadow: [{ node: 'BushMeadow', weight: 1, scale: [0.8, 1.4] }],
      forest: [{ node: 'BushForest', weight: 1, scale: [0.7, 1.25] }],
      ruins: [{ node: 'BushRuins', weight: 1, scale: [0.8, 1.4] }],
    },
  },
  {
    id: 'pebble', count: 600, density: { meadow: 0.35, forest: 0.45, ruins: 1 }, range: 28, maxSlope: 1.0, shadow: false,
    pieces: {
      meadow: [{ node: 'PebbleA', weight: 1, scale: [0.35, 0.7], sink: 0.2 }],
      forest: [{ node: 'PebbleA', weight: 1, scale: [0.35, 0.75], sink: 0.2 }],
      ruins: [{ node: 'PebbleA', weight: 1, scale: [0.4, 0.9], sink: 0.2 }],
    },
  },
  {
    id: 'boulder', count: 400, density: { meadow: 0.25, forest: 0.45, ruins: 1 }, range: 70, maxSlope: 1.1, shadow: false,
    pieces: {
      meadow: [{ node: 'BoulderB', weight: 1, scale: [0.8, 1.15], sink: 0.2 }],
      forest: [{ node: 'BoulderB', weight: 1, scale: [0.8, 1.1], sink: 0.2 }],
      ruins: [{ node: 'CragA', weight: 1, scale: [0.8, 1.25], sink: 0.2 }],
    },
  },
];

/** Rock tints per region (grey stone in the meadow and wood, sandstone in the ruins). */
export const ROCK_TINT: Record<VegRegion, [number, number, number]> = {
  meadow: [1, 1, 0.97],
  forest: [0.78, 0.86, 0.84],
  ruins: [1.25, 1.02, 0.78],
};

/** Full-detail trees within this distance of the player; past it, the low-poly LOD (up to `TREE_FAR`, near fog end). */
export const TREE_NEAR = 26;
export const TREE_FAR = 220;
/** Camp and town dressing are drawn within this distance. */
export const PROP_RANGE = 115;
/** Camp dressing keeps its outline within this distance (thinner than a pixel past it). */
export const PROP_OUTLINE_RANGE = 45;

/** Camp dressing per enemy kind: [node, count]; placed around the camp at 3.8–6.8 m, facing its middle. */
export const CAMP_ART: Partial<Record<string, [string, number][]>> = {
  bandit: [['Tent', 2], ['CrateBig', 2], ['CrateSmall', 2], ['Barrel', 2], ['Sack', 1], ['WeaponRack', 1], ['Flag', 2], ['FenceWood', 2], ['Lumber', 1], ['Target', 1]],
  goblin: [['Tent', 2], ['CrateBig', 1], ['CrateSmall', 2], ['Sack', 2], ['PostSkull', 2], ['Bones', 1], ['FenceWood', 3], ['Flag', 1], ['BannerTorn', 1]],
  skeleton: [['Gravestone', 3], ['Grave', 1], ['PillarBroken', 2], ['BannerTorn', 1], ['Bones', 2], ['Skull', 1]],
  cultist: [['Shrine', 1], ['Candles', 3], ['Banner', 2], ['Skull', 2], ['PostSkull', 1]],
  golem: [['RubbleBig', 1], ['Rubble', 2], ['PillarBroken', 1]],
  wolf: [['Bones', 2], ['BonesB', 1], ['Ribcage', 1], ['Skull', 1]],
  spider: [['Bones', 2], ['Ribcage', 1], ['Skull', 2]],
  boar: [['Lumber', 1], ['BonesB', 1]],
};

/** Exploration chests: body and lid nodes, the lid's hinge (from the body's origin) and how far it opens. Tier 1 chests are gilded. */
export const CHEST_ART = {
  normal: { body: 'ChestBody', lid: 'ChestLid', hinge: [0, 0.2706, -0.3057] as [number, number, number] },
  gold: { body: 'ChestGoldBody', lid: 'ChestGoldLid', hinge: [0, 0.2706, -0.3057] as [number, number, number] },
  open: -1.75,
};
