import { TUNING } from '../config';
import {
  SLOTS, emptyStats, itemStats, makeItem, slotOf, uniqueOf,
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

  constructor() {
    this.equipped.weapon = makeItem('rustySword');
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

  derive(): Derived {
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
    // Attributes, first pass (DESIGN §9): Strength → melee damage and armour, Dexterity → crit and
    // attack speed, Vitality → HP and stamina. Intelligence (mana, spells) arrives with the Mage in M4.
    const armour = t.armour + t.str;
    return {
      maxHp: TUNING.maxHp + t.hp + t.vit * 5,
      maxStamina: TUNING.stamina.max + t.stamina + t.vit * 2,
      weaponDamage: this.equipped.weapon ? t.damage : 5,
      damageMult: 1 + t.damagePct + t.str * 0.02,
      armour,
      armourReduction: armour / (armour + 60),
      crit: t.crit + t.dex * 0.005,
      critMult: 1.5,
      attackSpeed: Math.max(0.5, 1 + t.attackSpeed + t.dex * 0.005),
      moveSpeed: Math.max(0.5, 1 + t.moveSpeed),
      blockStrength: this.equipped.offhand ? t.block : TUNING.combat.block.strength,
      fireDamage: t.fireDamage,
      fireRes: Math.min(0.75, t.fireRes),
      uniques,
      totals: t,
    };
  }
}
