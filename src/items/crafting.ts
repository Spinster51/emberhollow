// Crafting at the home workbench (DESIGN §10): salvage gear into materials, upgrade +1..+10,
// re-roll one affix. Pure rules on an Inventory; the UI calls these and shows the costs.

import { TUNING } from '../config';
import type { Inventory } from './Inventory';
import { BASE_BY_ID, MATERIALS, refreshName, rerollAffix, type Item, type Slot } from './items';

/** The material a slot salvages into and upgrades with. Gel, fang and feather have no craft use yet. */
export const CRAFT_MATERIAL: Record<Slot, string> = {
  weapon: 'core', offhand: 'bone', helmet: 'hide', chest: 'hide', gloves: 'cloth', boots: 'cloth', ring: 'silk', amulet: 'silk',
};

export interface Cost {
  gold: number;
  /** Slot material and how many. */
  mat: string;
  matAmount: number;
  ember: number;
  ash: number;
}

/** Materials salvaging `item` gives (of its slot material). */
export function salvageAmount(item: Item): number {
  return TUNING.crafting.salvageYield[item.rarity] ?? 1;
}

/** Cost of the next upgrade, or null at +maxPlus. */
export function upgradeCost(item: Item): Cost | null {
  const next = (item.plus ?? 0) + 1;
  if (next > TUNING.crafting.maxPlus) return null;
  return {
    gold: TUNING.crafting.goldBase * next * next,
    mat: CRAFT_MATERIAL[slotOfItem(item)],
    matAmount: Math.ceil(next / 2),
    ember: next >= TUNING.crafting.emberFrom ? 1 : 0,
    ash: 0,
  };
}

export function rerollCost(item: Item): Cost {
  return {
    gold: TUNING.crafting.rerollGoldPerLevel * item.level,
    mat: '',
    matAmount: 0,
    ember: 0,
    ash: TUNING.crafting.rerollAsh,
  };
}

/** Why a cost cannot be paid, or null if it can. */
export function missing(inv: Inventory, c: Cost): string | null {
  if (inv.gold < c.gold) return `Needs ${c.gold} gold.`;
  if (c.mat && (inv.materials[c.mat] ?? 0) < c.matAmount) return `Needs ${c.matAmount} ${matName(c.mat)}.`;
  if (c.ember && (inv.materials.ember ?? 0) < c.ember) return `Needs ${c.ember} Warden Ember.`;
  if (c.ash && (inv.materials.ash ?? 0) < c.ash) return `Needs ${c.ash} Cult Ash.`;
  return null;
}

function pay(inv: Inventory, c: Cost): void {
  inv.gold -= c.gold;
  if (c.mat) inv.materials[c.mat] -= c.matAmount;
  if (c.ember) inv.materials.ember -= c.ember;
  if (c.ash) inv.materials.ash -= c.ash;
  for (const k of Object.keys(inv.materials)) if (inv.materials[k] <= 0) delete inv.materials[k];
}

/** Salvage bag item `i`. Returns an error, or the material gained as a message. */
export function salvage(inv: Inventory, i: number): { error?: string; gained?: string } {
  const it = inv.bag[i];
  if (!it) return { error: 'Nothing there.' };
  const mat = CRAFT_MATERIAL[slotOfItem(it)];
  const n = salvageAmount(it);
  inv.take(i);
  inv.addMaterial(mat, n);
  return { gained: `${n} ${matName(mat)}` };
}

/** Upgrade an item (bag or equipped) by one level. */
export function upgrade(inv: Inventory, item: Item): string | null {
  const c = upgradeCost(item);
  if (!c) return 'Already at the maximum upgrade.';
  const why = missing(inv, c);
  if (why) return why;
  pay(inv, c);
  item.plus = (item.plus ?? 0) + 1;
  refreshName(item);
  inv.changed();
  return null;
}

/** Re-roll one random affix on an item (bag or equipped). */
export function reroll(inv: Inventory, item: Item, rand: () => number): string | null {
  const c = rerollCost(item);
  const why = missing(inv, c);
  if (why) return why;
  if (!rerollAffix(item, rand)) return 'Nothing to re-roll.';
  pay(inv, c);
  inv.changed();
  return null;
}

function slotOfItem(it: Item): Slot {
  return BASE_BY_ID[it.base].slot;
}
function matName(id: string): string {
  return MATERIALS[id]?.name ?? id;
}
