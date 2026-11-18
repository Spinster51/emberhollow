// Items: slots, rarities, base types, random affixes, legendary uniques, and the stats they add.
// All names are original. Numbers are first guesses for play-testing.

import type { ClassId } from '../classes/classes';
import { TUNING } from '../config';

export type Slot = 'weapon' | 'offhand' | 'helmet' | 'chest' | 'gloves' | 'boots' | 'ring' | 'amulet';
export const SLOTS: Slot[] = ['weapon', 'offhand', 'helmet', 'chest', 'gloves', 'boots', 'ring', 'amulet'];
export const SLOT_NAMES: Record<Slot, string> = {
  weapon: 'Weapon', offhand: 'Off-hand', helmet: 'Helmet', chest: 'Chest',
  gloves: 'Gloves', boots: 'Boots', ring: 'Ring', amulet: 'Amulet',
};

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const RARITY_INFO: Record<Rarity, { name: string; color: string; affixes: number; weight: number }> = {
  common: { name: 'Common', color: '#d8d8d8', affixes: 0, weight: 60 },
  uncommon: { name: 'Uncommon', color: '#5fd35a', affixes: 1, weight: 25 },
  rare: { name: 'Rare', color: '#4f9dff', affixes: 2, weight: 10 },
  epic: { name: 'Epic', color: '#b866ff', affixes: 3, weight: 4 },
  legendary: { name: 'Legendary', color: '#ff9a2e', affixes: 4, weight: 1 },
};

/** Every number an item can add. Percentages are stored as fractions (0.05 = 5 %). */
export interface Stats {
  damage: number;
  damagePct: number;
  armour: number;
  hp: number;
  stamina: number;
  crit: number;
  attackSpeed: number;
  moveSpeed: number;
  cooldown: number;
  fireDamage: number;
  fireRes: number;
  block: number;
  mana: number;
  str: number;
  int: number;
  dex: number;
  vit: number;
}
export type StatKey = keyof Stats;

export const emptyStats = (): Stats => ({
  damage: 0, damagePct: 0, armour: 0, hp: 0, stamina: 0, crit: 0, attackSpeed: 0, moveSpeed: 0,
  cooldown: 0, fireDamage: 0, fireRes: 0, block: 0, mana: 0, str: 0, int: 0, dex: 0, vit: 0,
});

/** How each stat is shown in tooltips. */
export const STAT_LABEL: Record<StatKey, (v: number) => string> = {
  damage: (v) => `${Math.round(v)} damage`,
  damagePct: (v) => `+${pct(v)} damage`,
  armour: (v) => `+${Math.round(v)} armour`,
  hp: (v) => `+${Math.round(v)} HP`,
  stamina: (v) => `+${Math.round(v)} Stamina`,
  crit: (v) => `+${pct(v)} crit chance`,
  attackSpeed: (v) => `${v >= 0 ? '+' : ''}${pct(v)} attack speed`,
  moveSpeed: (v) => `${v >= 0 ? '+' : ''}${pct(v)} move speed`,
  cooldown: (v) => `+${pct(v)} cooldown reduction`,
  fireDamage: (v) => `+${Math.round(v)} fire damage`,
  fireRes: (v) => `+${pct(v)} fire resistance`,
  block: (v) => `${pct(v)} block strength`,
  mana: (v) => `+${Math.round(v)} mana`,
  str: (v) => `+${Math.round(v)} Strength`,
  int: (v) => `+${Math.round(v)} Intelligence`,
  dex: (v) => `+${Math.round(v)} Dexterity`,
  vit: (v) => `+${Math.round(v)} Vitality`,
};
function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Visual style of the base, used by the 3D models. */
export type Look =
  | 'sword' | 'greatsword' | 'mace' | 'staff' | 'daggers' | 'woodShield' | 'ironShield' | 'tome' | 'parryDagger'
  | 'cap' | 'helm' | 'tunic' | 'mail' | 'gloves' | 'gauntlets' | 'boots' | 'greaves' | 'ring' | 'amulet';

export interface Base {
  id: string;
  name: string;
  slot: Slot;
  look: Look;
  /** Built-in stats at item level 1 (they grow 10 % per level). */
  implicit: Partial<Stats>;
  /** Classes that can equip it (everyone if omitted). */
  classes?: ClassId[];
  /** Starting gear: never dropped. */
  starter?: boolean;
}

export const BASES: Base[] = [
  { id: 'rustySword', name: 'Rusty Sword', slot: 'weapon', look: 'sword', implicit: { damage: 12 }, classes: ['warrior'], starter: true },
  { id: 'ironSword', name: 'Iron Sword', slot: 'weapon', look: 'sword', implicit: { damage: 14 }, classes: ['warrior'] },
  { id: 'greatsword', name: 'Greatsword', slot: 'weapon', look: 'greatsword', implicit: { damage: 20, attackSpeed: -0.15 }, classes: ['warrior'] },
  { id: 'rustyMace', name: 'Rusty Mace', slot: 'weapon', look: 'mace', implicit: { damage: 13 }, classes: ['tank'], starter: true },
  { id: 'ironMace', name: 'Flanged Mace', slot: 'weapon', look: 'mace', implicit: { damage: 16 }, classes: ['tank'] },
  { id: 'oakStaff', name: 'Oak Staff', slot: 'weapon', look: 'staff', implicit: { damage: 11, mana: 10 }, classes: ['mage'], starter: true },
  { id: 'runedStaff', name: 'Runed Staff', slot: 'weapon', look: 'staff', implicit: { damage: 14, mana: 20 }, classes: ['mage'] },
  { id: 'rustyDaggers', name: 'Rusty Daggers', slot: 'weapon', look: 'daggers', implicit: { damage: 11 }, classes: ['assassin'], starter: true },
  { id: 'steelDaggers', name: 'Steel Daggers', slot: 'weapon', look: 'daggers', implicit: { damage: 13, crit: 0.03 }, classes: ['assassin'] },
  { id: 'woodShield', name: 'Wooden Shield', slot: 'offhand', look: 'woodShield', implicit: { block: 0.5, armour: 3 }, classes: ['warrior', 'tank'] },
  { id: 'ironShield', name: 'Iron Shield', slot: 'offhand', look: 'ironShield', implicit: { block: 0.6, armour: 6 }, classes: ['warrior', 'tank'] },
  { id: 'tome', name: 'Spell Tome', slot: 'offhand', look: 'tome', implicit: { mana: 20 }, classes: ['mage'] },
  { id: 'parryDagger', name: 'Parrying Dagger', slot: 'offhand', look: 'parryDagger', implicit: { crit: 0.03 }, classes: ['assassin'] },
  { id: 'cap', name: 'Leather Cap', slot: 'helmet', look: 'cap', implicit: { armour: 3 } },
  { id: 'helm', name: 'Iron Helm', slot: 'helmet', look: 'helm', implicit: { armour: 6 } },
  { id: 'tunic', name: 'Padded Tunic', slot: 'chest', look: 'tunic', implicit: { armour: 5 } },
  { id: 'mail', name: 'Chainmail', slot: 'chest', look: 'mail', implicit: { armour: 10, moveSpeed: -0.03 } },
  { id: 'gloves', name: 'Leather Gloves', slot: 'gloves', look: 'gloves', implicit: { armour: 2 } },
  { id: 'gauntlets', name: 'Gauntlets', slot: 'gloves', look: 'gauntlets', implicit: { armour: 4 } },
  { id: 'boots', name: 'Leather Boots', slot: 'boots', look: 'boots', implicit: { armour: 2 } },
  { id: 'greaves', name: 'Iron Greaves', slot: 'boots', look: 'greaves', implicit: { armour: 4 } },
  { id: 'copperRing', name: 'Copper Ring', slot: 'ring', look: 'ring', implicit: {} },
  { id: 'boneCharm', name: 'Bone Charm', slot: 'amulet', look: 'amulet', implicit: {} },
];
export const BASE_BY_ID = Object.fromEntries(BASES.map((b) => [b.id, b])) as Record<string, Base>;

/** Random affixes: [min, max] at item level 1; values grow 10 % per level. */
interface AffixDef {
  stat: StatKey;
  min: number;
  max: number;
  prefix: string;
  /** Slots it may appear on (all if omitted). */
  slots?: Slot[];
}
const AFFIXES: AffixDef[] = [
  { stat: 'str', min: 1, max: 3, prefix: 'Mighty' },
  { stat: 'int', min: 1, max: 3, prefix: 'Clever' },
  { stat: 'dex', min: 1, max: 3, prefix: 'Nimble' },
  { stat: 'vit', min: 1, max: 3, prefix: 'Hale' },
  { stat: 'damagePct', min: 0.05, max: 0.15, prefix: 'Keen', slots: ['weapon', 'gloves', 'ring', 'amulet'] },
  { stat: 'armour', min: 2, max: 6, prefix: 'Sturdy', slots: ['offhand', 'helmet', 'chest', 'gloves', 'boots'] },
  { stat: 'hp', min: 5, max: 15, prefix: 'Hearty' },
  { stat: 'crit', min: 0.02, max: 0.05, prefix: 'Deadly', slots: ['weapon', 'gloves', 'ring', 'amulet', 'helmet'] },
  { stat: 'attackSpeed', min: 0.03, max: 0.08, prefix: 'Swift', slots: ['weapon', 'gloves', 'ring'] },
  { stat: 'moveSpeed', min: 0.02, max: 0.05, prefix: 'Fleet', slots: ['boots', 'amulet'] },
  { stat: 'cooldown', min: 0.03, max: 0.08, prefix: 'Focused', slots: ['helmet', 'amulet', 'ring'] },
  { stat: 'fireDamage', min: 2, max: 5, prefix: 'Burning', slots: ['weapon', 'gloves', 'ring'] },
  { stat: 'fireRes', min: 0.05, max: 0.15, prefix: 'Fireproof' },
  { stat: 'stamina', min: 5, max: 15, prefix: 'Tireless' },
  { stat: 'mana', min: 5, max: 15, prefix: 'Wise', slots: ['weapon', 'offhand', 'helmet', 'ring', 'amulet'] },
];

/** Legendary unique effects. */
export type UniqueEffect = 'burn' | 'lifesteal' | 'freeRoll' | 'regen';
export interface Unique {
  id: string;
  name: string;
  base: string;
  effect: UniqueEffect;
  text: string;
}
export const UNIQUES: Unique[] = [
  { id: 'emberfang', name: 'Emberfang', base: 'ironSword', effect: 'burn', text: 'Hits set enemies alight: 4 fire damage per second for 3 s.' },
  { id: 'thirstBand', name: 'Band of Thirst', base: 'copperRing', effect: 'lifesteal', text: 'Heal 8% of the damage you deal.' },
  { id: 'driftstep', name: 'Driftstep Boots', base: 'boots', effect: 'freeRoll', text: 'Dodge-rolls cost no stamina.' },
  { id: 'heartstone', name: 'Heartstone', base: 'boneCharm', effect: 'regen', text: 'Regenerate 2 HP per second.' },
  { id: 'emberMaul', name: 'Ember Maul', base: 'ironMace', effect: 'burn', text: 'Hits set enemies alight: 4 fire damage per second for 3 s.' },
  { id: 'cinderstaff', name: 'Cinderstaff', base: 'runedStaff', effect: 'burn', text: 'Hits set enemies alight: 4 fire damage per second for 3 s.' },
  { id: 'bloodfangs', name: 'Bloodfangs', base: 'steelDaggers', effect: 'lifesteal', text: 'Heal 8% of the damage you deal.' },
];
export const UNIQUE_BY_ID = Object.fromEntries(UNIQUES.map((u) => [u.id, u])) as Record<string, Unique>;

export interface Affix {
  stat: StatKey;
  value: number;
}

export interface Item {
  uid: number;
  base: string;
  rarity: Rarity;
  level: number;
  /** Minimum character level to equip. */
  req: number;
  affixes: Affix[];
  unique?: string;
  /** Upgrade level from the workbench (+1..+10). Missing in old saves = 0. */
  plus?: number;
  name: string;
}

export interface Material {
  id: string;
  name: string;
  color: string;
}
export const MATERIALS: Record<string, Material> = {
  gel: { id: 'gel', name: 'Slime Gel', color: '#6fd36a' },
  hide: { id: 'hide', name: 'Boar Hide', color: '#9a6b47' },
  cloth: { id: 'cloth', name: 'Bandit Cloth', color: '#c0443a' },
  fang: { id: 'fang', name: 'Wolf Fang', color: '#d8d2c0' },
  silk: { id: 'silk', name: 'Spider Silk', color: '#e8e8f0' },
  feather: { id: 'feather', name: 'Goblin Feather', color: '#6fb06a' },
  bone: { id: 'bone', name: 'Old Bone', color: '#e6dcc4' },
  core: { id: 'core', name: 'Golem Core', color: '#ff8a3a' },
  ash: { id: 'ash', name: 'Cult Ash', color: '#9a7ab0' },
  ember: { id: 'ember', name: 'Warden Ember', color: '#ff5a2a' },
};

let nextUid = 1;

const scale = (v: number, level: number) => v * (1 + 0.1 * (level - 1));
const isPct = (s: StatKey) => ['damagePct', 'crit', 'attackSpeed', 'moveSpeed', 'cooldown', 'fireRes', 'block'].includes(s);
const roundStat = (s: StatKey, v: number) => (isPct(s) ? Math.round(v * 100) / 100 : Math.round(v));

/** Keep new item ids above any loaded from a save. */
export function bumpUid(uid: number): void {
  nextUid = Math.max(nextUid, uid + 1);
}

/** Make a specific item (used for starting gear and tests). */
export function makeItem(baseId: string, rarity: Rarity = 'common', level = 1, affixes: Affix[] = [], unique?: string): Item {
  const base = BASE_BY_ID[baseId];
  const item: Item = { uid: nextUid++, base: baseId, rarity, level, req: 1, affixes, unique, name: '' };
  item.name = unique ? UNIQUE_BY_ID[unique].name : nameFor(base, affixes);
  return item;
}

function nameFor(base: Base, affixes: Affix[]): string {
  if (affixes.length === 0) return base.name;
  // Name after the biggest affix (relative to its range).
  let best = affixes[0];
  let bestScore = -1;
  for (const a of affixes) {
    const def = AFFIXES.find((d) => d.stat === a.stat)!;
    const score = a.value / def.max;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return `${AFFIXES.find((d) => d.stat === best.stat)!.prefix} ${base.name}`;
}

export function usableBy(baseId: string, cls: ClassId): boolean {
  const c = BASE_BY_ID[baseId].classes;
  return !c || c.includes(cls);
}

/** Roll a random item. `rand` returns [0, 1). With `cls`, only gear that class can use drops. */
export function rollItem(rand: () => number, level: number, rarity?: Rarity, cls?: ClassId): Item {
  rarity ??= rollRarity(rand);
  let item: Item;
  if (rarity === 'legendary') {
    const pool = UNIQUES.filter((u) => !cls || usableBy(u.base, cls));
    const u = pool[Math.floor(rand() * pool.length)];
    item = makeItem(u.base, 'legendary', level, rollAffixes(rand, BASE_BY_ID[u.base].slot, level, 3), u.id);
  } else {
    const pool = BASES.filter((b) => !b.starter && (!cls || usableBy(b.id, cls)));
    const base = pool[Math.floor(rand() * pool.length)];
    item = makeItem(base.id, rarity, level, rollAffixes(rand, base.slot, level, RARITY_INFO[rarity].affixes));
  }
  // Gear needs a minimum level (DESIGN §9): one below its item level.
  item.req = Math.max(1, level - 1);
  return item;
}

export function rollRarity(rand: () => number): Rarity {
  const total = RARITIES.reduce((s, r) => s + RARITY_INFO[r].weight, 0);
  let x = rand() * total;
  for (const r of RARITIES) {
    x -= RARITY_INFO[r].weight;
    if (x < 0) return r;
  }
  return 'common';
}

function rollAffixes(rand: () => number, slot: Slot, level: number, count: number): Affix[] {
  const pool = AFFIXES.filter((a) => !a.slots || a.slots.includes(slot));
  const out: Affix[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    const def = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    const v = scale(def.min + (def.max - def.min) * rand(), level);
    out.push({ stat: def.stat, value: roundStat(def.stat, v) });
  }
  return out;
}

/** All stats one item adds (implicit + affixes). */
export function itemStats(item: Item): Stats {
  const s = emptyStats();
  const base = BASE_BY_ID[item.base];
  const up = 1 + TUNING.crafting.plusPerLevel * (item.plus ?? 0);
  for (const [k, v] of Object.entries(base.implicit) as [StatKey, number][]) {
    // Penalties and block strength do not grow with level; upgrades only add to positive values.
    if (v > 0 && k !== 'block') s[k] += roundStat(k, scale(v, item.level) * up);
    else s[k] += v;
  }
  for (const a of item.affixes) s[a.stat] += a.value > 0 ? roundStat(a.stat, a.value * up) : a.value;
  return s;
}

/** Recompute the display name (base name, affix prefix, unique name, and the +N upgrade suffix). */
export function refreshName(item: Item): void {
  const plain = item.unique ? UNIQUE_BY_ID[item.unique].name : nameFor(BASE_BY_ID[item.base], item.affixes);
  item.name = (item.plus ?? 0) > 0 ? `${plain} +${item.plus}` : plain;
}

/** Replace one random affix (never a unique's, and never a stat the item already has). Returns false if nothing can change. */
export function rerollAffix(item: Item, rand: () => number): boolean {
  if (item.affixes.length === 0) return false;
  const slot = BASE_BY_ID[item.base].slot;
  const have = new Set(item.affixes.map((a) => a.stat));
  const pool = AFFIXES.filter((a) => (!a.slots || a.slots.includes(slot)) && !have.has(a.stat));
  if (pool.length === 0) return false;
  const def = pool[Math.floor(rand() * pool.length)];
  const i = Math.floor(rand() * item.affixes.length);
  const v = scale(def.min + (def.max - def.min) * rand(), item.level);
  item.affixes[i] = { stat: def.stat, value: roundStat(def.stat, v) };
  refreshName(item);
  return true;
}

export function slotOf(item: Item): Slot {
  return BASE_BY_ID[item.base].slot;
}

export function lookOf(item: Item): Look {
  return BASE_BY_ID[item.base].look;
}

export function uniqueOf(item: Item | null | undefined): UniqueEffect | null {
  return item?.unique ? UNIQUE_BY_ID[item.unique].effect : null;
}
