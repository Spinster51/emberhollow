// Art manifest: every glTF file the game loads and how its clips map onto game states.
// Files live in `public/models/`; each pack is credited in CREDITS.md.
// Timing note: clip lengths never decide gameplay. Attack and roll clips are scrubbed so
// their swing lands inside the game's own windup/swing window (classes.ts combos,
// TUNING in config.ts); the `swing` marks below only say where the swing is in each clip.

import type { ClassId } from '../classes/classes';
import type { Look } from '../items/items';

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
