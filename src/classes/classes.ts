// The four classes: base stats, primary attack combos, skills and skill-tree nodes.
// Numbers are first guesses for play-testing (docs/DESIGN.md §8–9, §11).

import type { StatKey } from '../items/items';

export type ClassId = 'warrior' | 'tank' | 'mage' | 'assassin';
export const CLASS_IDS: ClassId[] = ['warrior', 'tank', 'mage', 'assassin'];
export type Attr = 'str' | 'int' | 'dex' | 'vit';
export const ATTRS: Attr[] = ['str', 'int', 'dex', 'vit'];
export const ATTR_NAMES: Record<Attr, string> = { str: 'Strength', int: 'Intelligence', dex: 'Dexterity', vit: 'Vitality' };
export const ATTR_HELP: Record<Attr, string> = {
  str: '+2% melee damage, +1 armour',
  int: '+2% spell damage, +4 mana',
  dex: '+0.5% crit, +0.5% attack speed, cheaper rolls',
  vit: '+5 HP, +2 stamina, faster HP regen',
};

/** One step of a primary-attack combo. `mult` scales weapon damage; `projectile` = ranged bolt. */
export interface ComboStep {
  windup: number;
  swing: number;
  recover: number;
  hitAt: number;
  mult: number;
  poise: number;
  stamina: number;
  lunge: number;
  knockback: number;
  reach?: number;
  arc?: number;
  projectile?: boolean;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  weapon: string;
  blurb: string;
  colour: number;
  hp: number;
  mana: number;
  manaRegen: number;
  /** Extra base stats (crit, armour, block…). */
  bonus: Partial<Record<StatKey, number>>;
  critMult: number;
  /** Damage bonus for hits from behind (assassin). */
  backstab: number;
  combo: ComboStep[];
  /** Melee classes scale with Strength, the mage with Intelligence. */
  damageAttr: Attr;
  /** What right-click does. */
  secondary: 'block' | 'aim';
  start: string[];
  skills: string[];
  passives: string[];
}

const melee = (w: number, s: number, r: number, mult: number, poise: number, stamina: number, lunge = 3, knockback = 2): ComboStep => ({
  windup: w, swing: s, recover: r, hitAt: 0.5, mult, poise, stamina, lunge, knockback,
});

export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: {
    id: 'warrior', name: 'Warrior', weapon: 'Sword / greatsword', colour: 0x3f6fb5,
    blurb: 'Balanced melee. Fast sword combos, a charge and a ground-splitting slam. The easiest class.',
    hp: 100, mana: 50, manaRegen: 4, bonus: {}, critMult: 1.5, backstab: 0, damageAttr: 'str', secondary: 'block',
    combo: [melee(0.15, 0.15, 0.3, 1.0, 10, 6), melee(0.12, 0.15, 0.3, 1.15, 12, 6), melee(0.25, 0.2, 0.45, 1.8, 25, 10, 5, 6)],
    start: ['rustySword'],
    skills: ['charge', 'whirlwind', 'warCry', 'earthsplitter'],
    passives: ['wToughness', 'wBrutality', 'wEndurance', 'wMomentum'],
  },
  tank: {
    id: 'tank', name: 'Tank', weapon: 'Shield + mace', colour: 0x8a3a2e,
    blurb: 'Block and parry to build a counter meter, then hit back hard. Taunts and slows enemies. Built to be fun solo.',
    hp: 130, mana: 40, manaRegen: 4, bonus: { armour: 10 }, critMult: 1.5, backstab: 0, damageAttr: 'str', secondary: 'block',
    combo: [
      { ...melee(0.25, 0.2, 0.4, 1.0, 18, 8, 2, 4), reach: 2.2 },
      { ...melee(0.3, 0.22, 0.5, 1.5, 30, 10, 3, 7), reach: 2.2 },
    ],
    start: ['rustyMace', 'woodShield'],
    skills: ['riposte', 'taunt', 'shieldBash', 'bulwark'],
    passives: ['tIronSkin', 'tVigour', 'tShieldWall', 'tRetaliation'],
  },
  mage: {
    id: 'mage', name: 'Mage', weapon: 'Staff', colour: 0x6a45a8,
    blurb: 'Bolts and area spells from range, a blink to escape, careful mana management. Hits hard, falls fast.',
    hp: 80, mana: 120, manaRegen: 8, bonus: {}, critMult: 1.5, backstab: 0, damageAttr: 'int', secondary: 'aim',
    combo: [
      { ...melee(0.18, 0.08, 0.22, 1.0, 6, 3, 0, 1), projectile: true },
      { ...melee(0.14, 0.08, 0.22, 1.0, 6, 3, 0, 1), projectile: true },
    ],
    start: ['oakStaff'],
    skills: ['fireball', 'frostNova', 'blink', 'meteor'],
    passives: ['mArcaneMind', 'mSpellPower', 'mHaste', 'mManaFlow'],
  },
  assassin: {
    id: 'assassin', name: 'Assassin', weapon: 'Daggers', colour: 0x2f4a3a,
    blurb: 'Fast dagger flurries, lots of dodging, bonus damage from behind, a short stealth and big crits.',
    hp: 85, mana: 60, manaRegen: 5, bonus: { crit: 0.1 }, critMult: 1.75, backstab: 0.5, damageAttr: 'str', secondary: 'block',
    combo: [
      { ...melee(0.08, 0.1, 0.2, 0.7, 5, 4, 3, 1), reach: 2.0 },
      { ...melee(0.07, 0.1, 0.2, 0.7, 5, 4, 3, 1), reach: 2.0 },
      { ...melee(0.07, 0.1, 0.2, 0.8, 6, 4, 3, 1), reach: 2.0 },
      { ...melee(0.15, 0.15, 0.35, 1.4, 15, 6, 5, 4), reach: 2.0 },
    ],
    start: ['rustyDaggers'],
    skills: ['shadowstep', 'fanOfKnives', 'vanish', 'eviscerate'],
    passives: ['aPrecision', 'aRuthless', 'aLightFeet', 'aAgility'],
  },
};

/** Active skills: keys 1–4. Damage is a multiple of weapon damage. */
export interface SkillDef {
  id: string;
  name: string;
  short: string;
  desc: string;
  cooldown: number;
  mana: number;
  unlock: number;
  /** Total time the player is busy casting (s). */
  time: number;
  /** Each rank in the tree adds this much (fraction) to the skill's main effect. */
  rankBonus: number;
  rankText: string;
}

const sk = (id: string, name: string, short: string, cooldown: number, mana: number, unlock: number, time: number, desc: string, rankText: string, rankBonus = 0.2): SkillDef => ({
  id, name, short, cooldown, mana, unlock, time, desc, rankText, rankBonus,
});

export const SKILLS: Record<string, SkillDef> = Object.fromEntries(
  [
    sk('charge', 'Charge', 'CHG', 6, 15, 1, 0.45, 'Dash 8 m forward, hitting everything in your path for 150% damage.', '+20% damage'),
    sk('whirlwind', 'Whirlwind', 'WHL', 8, 20, 2, 0.7, 'Spin with your blade, hitting all around you 3 times for 70% damage.', '+20% damage'),
    sk('warCry', 'War Cry', 'CRY', 20, 15, 4, 0.4, 'Roar: +25% damage for 8 s and nearby enemies come for you.', '+2 s duration', 0.25),
    sk('earthsplitter', 'Earthsplitter', 'ERT', 15, 30, 6, 0.9, 'Slam the ground: a 7 m line of 300% damage that knocks enemies down.', '+20% damage'),

    sk('riposte', 'Riposte', 'RIP', 1, 0, 1, 0.5, 'Only right after a parry: a counter-attack for 200% damage plus up to 300% more from the counter meter.', '+20% damage'),
    sk('taunt', 'Taunt', 'TNT', 12, 15, 2, 0.4, 'Enemies within 10 m come for you and are slowed 40% for 5 s.', '+1 s duration', 0.2),
    sk('shieldBash', 'Shield Bash', 'BSH', 6, 10, 4, 0.45, 'Bash with your shield: 120% damage and a heavy stagger.', '+20% damage'),
    sk('bulwark', 'Bulwark', 'BUL', 20, 20, 6, 0.3, 'For 5 s take 50% less damage and cannot be staggered.', '+1 s duration', 0.2),

    sk('fireball', 'Fireball', 'FIR', 4, 20, 1, 0.45, 'Hurl a fireball that explodes for 250% damage in 3 m and sets enemies alight.', '+20% damage'),
    sk('frostNova', 'Frost Nova', 'ICE', 10, 25, 2, 0.4, 'Freeze everything within 5 m for 2 s (80% damage).', '+0.4 s freeze', 0.2),
    sk('blink', 'Blink', 'BLK', 5, 15, 4, 0.15, 'Teleport 8 m in the direction you move (or forward). Untouchable while blinking.', '+1.5 m distance', 0.2),
    sk('meteor', 'Meteor', 'MET', 18, 45, 6, 0.6, 'Call a meteor at your aim point: after 1 s it crashes for 600% damage in 5 m.', '+20% damage'),

    sk('shadowstep', 'Shadowstep', 'STP', 8, 15, 1, 0.2, 'Appear behind your target (or the nearest enemy within 12 m). Your next hit is a guaranteed crit.', '−1 s cooldown', 0.2),
    sk('fanOfKnives', 'Fan of Knives', 'FAN', 6, 15, 2, 0.35, 'Throw 5 knives in a fan, each for 80% damage.', '+20% damage'),
    sk('vanish', 'Vanish', 'VAN', 18, 20, 4, 0.2, 'Turn invisible for 4 s: enemies lose track of you. Your first hit from stealth deals +100% damage.', '+1 s duration', 0.25),
    sk('eviscerate', 'Eviscerate', 'EVS', 12, 25, 6, 0.5, 'A brutal strike for 400% damage, doubled against enemies below 30% HP.', '+20% damage'),
  ].map((s) => [s.id, s]),
);

/** Passive tree nodes: each rank adds `perRank` of a stat. */
export interface PassiveDef {
  id: string;
  name: string;
  stat: StatKey | 'mana' | 'manaRegen' | 'critMult' | 'blockBonus';
  perRank: number;
  text: string;
}
const pv = (id: string, name: string, stat: PassiveDef['stat'], perRank: number, text: string): PassiveDef => ({ id, name, stat, perRank, text });
export const PASSIVES: Record<string, PassiveDef> = Object.fromEntries(
  [
    pv('wToughness', 'Toughness', 'hp', 10, '+10 HP'),
    pv('wBrutality', 'Brutality', 'damagePct', 0.04, '+4% damage'),
    pv('wEndurance', 'Endurance', 'stamina', 10, '+10 Stamina'),
    pv('wMomentum', 'Momentum', 'attackSpeed', 0.04, '+4% attack speed'),
    pv('tIronSkin', 'Iron Skin', 'armour', 5, '+5 armour'),
    pv('tVigour', 'Vigour', 'hp', 15, '+15 HP'),
    pv('tShieldWall', 'Shield Wall', 'blockBonus', 0.05, '+5% block strength'),
    pv('tRetaliation', 'Retaliation', 'damagePct', 0.05, '+5% damage'),
    pv('mArcaneMind', 'Arcane Mind', 'mana', 15, '+15 mana'),
    pv('mSpellPower', 'Spell Power', 'damagePct', 0.06, '+6% damage'),
    pv('mHaste', 'Haste', 'cooldown', 0.05, '+5% cooldown reduction'),
    pv('mManaFlow', 'Mana Flow', 'manaRegen', 2, '+2 mana per second'),
    pv('aPrecision', 'Precision', 'crit', 0.03, '+3% crit chance'),
    pv('aRuthless', 'Ruthless', 'critMult', 0.1, '+10% crit damage'),
    pv('aLightFeet', 'Light Feet', 'moveSpeed', 0.03, '+3% move speed'),
    pv('aAgility', 'Agility', 'attackSpeed', 0.04, '+4% attack speed'),
  ].map((p) => [p.id, p]),
);

export const MAX_RANK = 3;
export const MAX_LEVEL = 15;
export const ATTR_POINTS_PER_LEVEL = 5;

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(60 * Math.pow(level, 1.6));
}

/** XP for a kill; reduced if you out-level the enemy by more than 3. */
export function xpFor(base: number, enemyLevel: number, playerLevel: number): number {
  const over = playerLevel - enemyLevel - 3;
  return Math.max(1, Math.round(base * (over > 0 ? Math.max(0.1, 1 - over * 0.25) : 1)));
}
