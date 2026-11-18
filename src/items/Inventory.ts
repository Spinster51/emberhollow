import { TUNING } from '../config';
import type { Progression } from '../classes/Progression';
import { CLASSES, type ClassId } from '../classes/classes';
import {
  BASE_BY_ID, SLOTS, emptyStats, itemStats, makeItem, slotOf, uniqueOf, usableBy,
  type Item, type Slot, type Stats, type UniqueEffect,
} from './items';

export const BAG_SIZE = 40;
export const CHEST_SIZE = 100;

/** Stats the game actually uses, worked out from equipped gear (and, from M4, attributes). */
export interface Derived {
  maxHp: number;
  maxStamina: number;
  weaponDamage: number;
  damageMult: number;
  armour: number;
  /** Fraction of incoming damage removed by armour. */
  armourReduction: number;
  crit: number;
  critMult: number;
  attackSpeed: number;
  moveSpeed: number;
  blockStrength: number;
  fireDamage: number;
  fireRes: number;
  maxMana: number;
  manaRegen: number;
  hpRegen: number;
  /** Multiply skill cooldowns by this. */
  cooldownMult: number;
  /** Stamina taken off each dodge-roll (Dexterity). */
  rollDiscount: number;
  /** Extra damage from behind. */
  backstab: number;
  uniques: Set<UniqueEffect>;
  totals: Stats;
}

/** Bag, equipped gear, gold and crafting materials. */
export class Inventory {
  readonly bag: (Item | null)[] = new Array(BAG_SIZE).fill(null);
  readonly equipped: Record<Slot, Item | null> = Object.fromEntries(SLOTS.map((s) => [s, null])) as Record<Slot, Item | null>;
  gold = 0;
  readonly materials: Record<string, number> = {};
  /** Bumped on every change so the UI and the player model know to refresh. */
  version = 0;

  /** Class of the owner (gear restrictions). */
  cls: ClassId = 'warrior';

  constructor() {
    this.equipped.weapon = makeItem('rustySword');
  }

  /** Empty everything and hand out a class's starting gear. */
  resetFor(cls: ClassId): void {
    this.cls = cls;
    this.bag.fill(null);
    for (const s of SLOTS) this.equipped[s] = null;
    for (const id of CLASSES[cls].start) {
      const it = makeItem(id);
      this.equipped[slotOf(it)] = it;
    }
    this.gold = 0;
    for (const k of Object.keys(this.materials)) delete this.materials[k];
    this.changed();
  }

  changed(): void {
    this.version++;
  }

  freeSlots(): number {
    return this.bag.filter((x) => !x).length;
  }

  /** Put an item in the first free bag slot. Returns false if the bag is full. */
  add(item: Item): boolean {
    const i = this.bag.indexOf(null);
    if (i < 0) return false;
    this.bag[i] = item;
    this.changed();
    return true;
  }

  addMaterial(id: string, n = 1): void {
    this.materials[id] = (this.materials[id] ?? 0) + n;
    this.changed();
  }

  take(i: number): Item | null {
    const it = this.bag[i];
    this.bag[i] = null;
    if (it) this.changed();
    return it;
  }

  /** Equip the bag item at `i`, swapping the old one into its place. Returns an error message or null. */
  equip(i: number, level: number): string | null {
    const it = this.bag[i];
    if (!it) return 'Nothing there.';
    if (it.req > level) return `Requires level ${it.req}.`;
    if (!usableBy(it.base, this.cls)) {
      const who = BASE_BY_ID[it.base].classes!.map((c) => CLASSES[c].name).join(' / ');
      return `Only ${who} can use this.`;
    }
    const slot = slotOf(it);
    this.bag[i] = this.equipped[slot];
    this.equipped[slot] = it;
    this.changed();
    return null;
  }

  /** Move an equipped item into the bag. */
  unequip(slot: Slot): boolean {
    const it = this.equipped[slot];
    if (!it) return false;
    const i = this.bag.indexOf(null);
    if (i < 0) return false;
    this.bag[i] = it;
    this.equipped[slot] = null;
    this.changed();
    return true;
  }

  /** Work out the stats the game uses from class, level, attributes, tree passives and gear. */
  derive(prog: Progression): Derived {
    const t = emptyStats();
    const uniques = new Set<UniqueEffect>();
    for (const slot of SLOTS) {
      const it = this.equipped[slot];
      if (!it) continue;
      const s = itemStats(it);
      for (const k of Object.keys(t) as (keyof Stats)[]) t[k] += s[k];
      const u = uniqueOf(it);
      if (u) uniques.add(u);
    }
    const cls = prog.def;
    for (const [k, v] of Object.entries(cls.bonus) as [keyof Stats, number][]) t[k] += v;
    // Tree passives that map straight onto item stats.
    for (const k of ['hp', 'damagePct', 'stamina', 'attackSpeed', 'armour', 'cooldown', 'crit', 'moveSpeed'] as const) {
      t[k] += prog.passive(k);
    }
    // Attributes = allocated points + gear (DESIGN §9).
    const str = prog.attrs.str + t.str;
    const int = prog.attrs.int + t.int;
    const dex = prog.attrs.dex + t.dex;
    const vit = prog.attrs.vit + t.vit;
    const dmgAttr = cls.damageAttr === 'int' ? int : str;
    const armour = t.armour + str;
    return {
      maxHp: cls.hp + (prog.level - 1) * 4 + t.hp + vit * 5,
      maxStamina: TUNING.stamina.max + t.stamina + vit * 2,
      maxMana: cls.mana + t.mana + int * 4 + prog.passive('mana'),
      manaRegen: cls.manaRegen + prog.passive('manaRegen') + int * 0.1,
      hpRegen: vit * 0.05,
      weaponDamage: this.equipped.weapon ? t.damage : 5,
      damageMult: 1 + t.damagePct + dmgAttr * 0.02,
      armour,
      armourReduction: armour / (armour + 60),
      crit: t.crit + dex * 0.005,
      critMult: cls.critMult + prog.passive('critMult'),
      attackSpeed: Math.max(0.5, 1 + t.attackSpeed + dex * 0.005),
      moveSpeed: Math.max(0.5, 1 + t.moveSpeed),
      blockStrength: Math.min(0.9, (this.equipped.offhand && t.block > 0 ? t.block : TUNING.combat.block.strength) + prog.passive('blockBonus')),
      cooldownMult: 1 - Math.min(0.4, t.cooldown),
      rollDiscount: Math.min(8, dex * 0.2),
      backstab: cls.backstab,
      fireDamage: t.fireDamage,
      fireRes: Math.min(0.75, t.fireRes),
      uniques,
      totals: t,
    };
  }
}
