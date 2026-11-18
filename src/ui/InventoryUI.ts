import {
  BASE_BY_ID, MATERIALS, RARITY_INFO, SLOTS, SLOT_NAMES, STAT_LABEL, UNIQUE_BY_ID, emptyStats, itemStats, lookOf, slotOf,
  type Item, type Slot, type StatKey,
} from '../items/items';
import type { Derived, Inventory } from '../items/Inventory';

/** A display spot in the home base (weapon mount or armour stand). */
export interface DisplaySpot {
  name: string;
  accepts: Slot[];
  item: Item | null;
  /** Called after the item changes so the 3D display updates. */
  onChange(): void;
}

type Mode = { kind: 'bag' } | { kind: 'chest'; chest: (Item | null)[] } | { kind: 'rack'; spot: DisplaySpot };

const SHORT: Record<string, string> = {
  sword: 'SWD', greatsword: 'GSW', woodShield: 'SHD', ironShield: 'SHD', cap: 'CAP', helm: 'HLM', tunic: 'TUN',
  mail: 'MAIL', gloves: 'GLV', gauntlets: 'GNT', boots: 'BTS', greaves: 'GRV', ring: 'RING', amulet: 'AMU',
};

/**
 * Menus: I = inventory (equipment + 40-slot bag), the home chest (bag ↔ 100-slot chest) and
 * display racks (pick a bag item to show off, or take the shown item back).
 * Click to equip / move; right-click a bag item to drop it.
 */
export class InventoryUI {
  private panel: HTMLDivElement;
  private tip: HTMLDivElement;
  private mode: Mode | null = null;
  private renderedVersion = -1;
  private chestVersion = 0;

  constructor(
    root: HTMLElement,
    private inv: Inventory,
    private level: () => number,
    private stats: () => Derived,
    private onOpenChange: (open: boolean) => void,
    private onDrop: (item: Item) => void,
    private toast: (msg: string) => void,
  ) {
    this.panel = document.createElement('div');
    this.panel.className = 'inv';
    this.panel.style.display = 'none';
    this.tip = document.createElement('div');
    this.tip.className = 'tip';
    this.tip.style.display = 'none';
    root.append(this.panel, this.tip);
    this.panel.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyI') {
        if (this.mode?.kind === 'bag') this.close();
        else this.open({ kind: 'bag' });
      } else if (e.code === 'Escape' && this.mode) {
        this.close();
      }
    });
    window.addEventListener('mousemove', (e) => {
      this.tip.style.left = `${Math.min(e.clientX + 16, window.innerWidth - 300)}px`;
      this.tip.style.top = `${Math.min(e.clientY + 12, window.innerHeight - this.tip.offsetHeight - 8)}px`;
    });
  }

  get isOpen(): boolean {
    return this.mode !== null;
  }

  get modeKind(): string | null {
    return this.mode?.kind ?? null;
  }

  open(mode: Mode): void {
    this.mode = mode;
    this.renderedVersion = -1;
    this.panel.style.display = '';
    document.exitPointerLock?.();
    this.onOpenChange(true);
    this.render();
  }

  openChest(chest: (Item | null)[]): void {
    this.open({ kind: 'chest', chest });
  }

  openRack(spot: DisplaySpot): void {
    this.open({ kind: 'rack', spot });
  }

  close(): void {
    this.mode = null;
    this.panel.style.display = 'none';
    this.tip.style.display = 'none';
    this.onOpenChange(false);
  }

  /** Re-render when the inventory changed (e.g. a pick-up while open). */
  update(): void {
    if (this.mode && this.renderedVersion !== this.inv.version + this.chestVersion) this.render();
  }

  // ---------------------------------------------------------------- actions (also used by tests)

  /** Move bag item `i` into the open chest. */
  storeInChest(chest: (Item | null)[], i: number): boolean {
    const it = this.inv.bag[i];
    const free = chest.indexOf(null);
    if (!it || free < 0) return false;
    chest[free] = this.inv.take(i);
    this.chestVersion++;
    return true;
  }

  takeFromChest(chest: (Item | null)[], i: number): boolean {
    const it = chest[i];
    if (!it || !this.inv.add(it)) return false;
    chest[i] = null;
    this.chestVersion++;
    return true;
  }

  /** Put bag item `i` on a display spot (swapping any item already there back into the bag). */
  display(spot: DisplaySpot, i: number): boolean {
    const it = this.inv.bag[i];
    if (!it || !spot.accepts.includes(slotOf(it))) return false;
    this.inv.bag[i] = spot.item;
    spot.item = it;
    this.inv.changed();
    spot.onChange();
    return true;
  }

  takeFromDisplay(spot: DisplaySpot): boolean {
    if (!spot.item || !this.inv.add(spot.item)) return false;
    spot.item = null;
    spot.onChange();
    return true;
  }

  // ---------------------------------------------------------------- rendering

  private render(): void {
    const m = this.mode;
    if (!m) return;
    this.renderedVersion = this.inv.version + this.chestVersion;
    this.panel.innerHTML = '';
    this.tip.style.display = 'none';
    const title = m.kind === 'bag' ? 'Inventory' : m.kind === 'chest' ? 'Storage chest' : m.spot.name;
    const head = el('div', 'inv-head', `${title}<span class="inv-close">✕ (Esc)</span>`);
    head.querySelector('.inv-close')!.addEventListener('click', () => this.close());
    this.panel.append(head);
    const body = el('div', 'inv-body');
    this.panel.append(body);

    if (m.kind === 'bag') body.append(this.equipmentColumn());
    if (m.kind === 'rack') body.append(this.rackColumn(m.spot));
    body.append(this.bagColumn(m));
    if (m.kind === 'chest') body.append(this.chestColumn(m.chest));

    const mats = Object.entries(this.inv.materials)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => `<span style="color:${MATERIALS[id]?.color ?? '#fff'}">${MATERIALS[id]?.name ?? id} ×${n}</span>`)
      .join(' · ');
    const hint = {
      bag: 'Click: equip / unequip · Right-click: drop',
      chest: 'Click an item to move it between bag and chest',
      rack: 'Click a highlighted bag item to display it',
    }[m.kind];
    this.panel.append(el('div', 'inv-foot', `<span class="gold">Gold ${this.inv.gold}</span> ${mats ? '· ' + mats : ''}<br><i>${hint}</i>`));
  }

  private equipmentColumn(): HTMLElement {
    const col = el('div', 'inv-col');
    col.append(el('div', 'inv-sub', 'Equipped'));
    const grid = el('div', 'inv-grid equip');
    for (const slot of SLOTS) {
      const it = this.inv.equipped[slot];
      const cell = this.cell(it, SLOT_NAMES[slot]);
      cell.addEventListener('click', () => {
        if (it && !this.inv.unequip(slot)) this.toast('Your bag is full.');
      });
      grid.append(cell);
    }
    col.append(grid, this.statsBox());
    return col;
  }

  private statsBox(): HTMLElement {
    const d = this.stats();
    const rows: [string, string][] = [
      ['Damage', `${Math.round(d.weaponDamage * d.damageMult)}${d.fireDamage ? ` +${d.fireDamage} fire` : ''}`],
      ['HP / Mana', `${d.maxHp} / ${d.maxMana}`],
      ['Armour', `${d.armour} (−${Math.round(d.armourReduction * 100)}% damage)`],
      ['Stamina', `${d.maxStamina}`],
      ['Crit', `${Math.round(d.crit * 100)}%`],
      ['Attack speed', `${Math.round(d.attackSpeed * 100)}%`],
      ['Move speed', `${Math.round(d.moveSpeed * 100)}%`],
      ['Block', `${Math.round(d.blockStrength * 100)}%`],
    ];
    return el('div', 'inv-stats', rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join(''));
  }

  private bagColumn(m: Mode): HTMLElement {
    const col = el('div', 'inv-col');
    col.append(el('div', 'inv-sub', `Bag (${this.inv.bag.filter(Boolean).length}/${this.inv.bag.length})`));
    const grid = el('div', 'inv-grid bag');
    this.inv.bag.forEach((it, i) => {
      const usable = m.kind !== 'rack' || (it && m.spot.accepts.includes(slotOf(it)));
      const cell = this.cell(it, '', !usable);
      cell.addEventListener('click', () => {
        if (!it) return;
        if (m.kind === 'bag') {
          const err = this.inv.equip(i, this.level());
          if (err) this.toast(err);
        } else if (m.kind === 'chest') {
          if (!this.storeInChest(m.chest, i)) this.toast('The chest is full.');
        } else if (usable) {
          this.display(m.spot, i);
        }
      });
      cell.addEventListener('contextmenu', () => {
        if (it && m.kind === 'bag') {
          this.inv.take(i);
          this.onDrop(it);
        }
      });
      grid.append(cell);
    });
    col.append(grid);
    return col;
  }

  private chestColumn(chest: (Item | null)[]): HTMLElement {
    const col = el('div', 'inv-col');
    col.append(el('div', 'inv-sub', `Chest (${chest.filter(Boolean).length}/${chest.length}) — shared by all characters`));
    const grid = el('div', 'inv-grid chest');
    chest.forEach((it, i) => {
      const cell = this.cell(it, '');
      cell.addEventListener('click', () => {
        if (it && !this.takeFromChest(chest, i)) this.toast('Your bag is full.');
      });
      grid.append(cell);
    });
    col.append(grid);
    return col;
  }

  private rackColumn(spot: DisplaySpot): HTMLElement {
    const col = el('div', 'inv-col');
    col.append(el('div', 'inv-sub', `On display (${spot.accepts.map((s) => SLOT_NAMES[s]).join(' / ')})`));
    const cell = this.cell(spot.item, 'Empty');
    cell.classList.add('big');
    cell.addEventListener('click', () => {
      if (spot.item && !this.takeFromDisplay(spot)) this.toast('Your bag is full.');
    });
    col.append(cell, el('div', 'inv-note', spot.item ? 'Click to take it back.' : 'Pick an item from your bag.'));
    return col;
  }

  private cell(it: Item | null, emptyLabel: string, dim = false): HTMLElement {
    const c = el('div', 'inv-cell');
    if (dim) c.classList.add('dim');
    if (!it) {
      c.innerHTML = `<small>${emptyLabel}</small>`;
      return c;
    }
    const color = RARITY_INFO[it.rarity].color;
    c.style.borderColor = color;
    c.style.boxShadow = it.rarity === 'common' ? '' : `inset 0 0 10px ${color}66`;
    c.innerHTML = `<span style="color:${color}">${SHORT[lookOf(it)]}</span><small>${it.level}</small>`;
    c.addEventListener('mouseenter', () => this.showTip(it));
    c.addEventListener('mouseleave', () => (this.tip.style.display = 'none'));
    return c;
  }

  private showTip(it: Item): void {
    this.tip.innerHTML = tooltipHtml(it, this.inv.equipped[slotOf(it)], this.level());
    this.tip.style.display = '';
  }
}

/** Tooltip with ↑/↓ comparison against the equipped item in the same slot. */
export function tooltipHtml(it: Item, equipped: Item | null, level: number): string {
  const info = RARITY_INFO[it.rarity];
  const base = BASE_BY_ID[it.base];
  const s = itemStats(it);
  const lines: string[] = [];
  lines.push(`<div class="tip-name" style="color:${info.color}">${it.name}</div>`);
  lines.push(`<div class="tip-sub">${info.name} ${SLOT_NAMES[base.slot]} · ${it.unique ? base.name + ' · ' : ''}item level ${it.level}</div>`);
  const shown = new Set<StatKey>();
  for (const k of Object.keys(base.implicit) as StatKey[]) {
    shown.add(k);
    lines.push(`<div class="tip-implicit">${STAT_LABEL[k](s[k])}</div>`);
  }
  for (const a of it.affixes) lines.push(`<div class="tip-affix">${STAT_LABEL[a.stat](a.value)}</div>`);
  if (it.unique) lines.push(`<div class="tip-unique">${UNIQUE_BY_ID[it.unique].text}</div>`);
  if (it.req > 1) lines.push(`<div class="${it.req > level ? 'tip-bad' : 'tip-sub'}">Requires level ${it.req}</div>`);

  if (equipped && equipped !== it) {
    const e = itemStats(equipped);
    const diffs: string[] = [];
    for (const k of Object.keys(emptyStats()) as StatKey[]) {
      const d = s[k] - e[k];
      if (Math.abs(d) < 1e-6) continue;
      const up = d > 0;
      diffs.push(`<div class="${up ? 'tip-up' : 'tip-down'}">${up ? '↑' : '↓'} ${STAT_LABEL[k](Math.abs(d)).replace(/^[+-]/, '')}</div>`);
    }
    lines.push(`<div class="tip-cmp">Compared with ${equipped.name}:</div>`);
    lines.push(diffs.length ? diffs.join('') : '<div class="tip-sub">Same stats</div>');
  } else if (!equipped) {
    lines.push('<div class="tip-up">↑ Empty slot</div>');
  }
  return lines.join('');
}

function el(tag: string, cls: string, html = ''): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.className = cls;
  e.innerHTML = html;
  return e;
}
