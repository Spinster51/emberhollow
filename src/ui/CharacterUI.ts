import {
  ATTRS, ATTR_HELP, ATTR_NAMES, CLASSES, CLASS_IDS, MAX_RANK, PASSIVES, SKILLS, xpToNext, type ClassId,
} from '../classes/classes';
import type { Player } from '../player/Player';

/**
 * K menu: level, attributes (spend points), the class skill tree (4 skills + 4 passives,
 * 3 ranks each). Opened from the home's training book it also offers a respec for gold.
 */
export class CharacterUI {
  private panel: HTMLDivElement;
  private open = false;
  private atBook = false;
  private renderedKey = '';

  constructor(
    root: HTMLElement,
    private player: Player,
    private onOpenChange: (open: boolean) => void,
    private toast: (msg: string) => void,
  ) {
    this.panel = document.createElement('div');
    this.panel.className = 'inv';
    this.panel.style.display = 'none';
    root.appendChild(this.panel);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyK') this.toggle();
      else if (e.code === 'Escape' && this.open) this.close();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(atBook = false): void {
    if (this.open && !atBook) this.close();
    else this.show(atBook);
  }

  show(atBook = false): void {
    this.open = true;
    this.atBook = atBook;
    this.renderedKey = '';
    this.panel.style.display = '';
    document.exitPointerLock?.();
    this.onOpenChange(true);
    this.update();
  }

  close(): void {
    this.open = false;
    this.panel.style.display = 'none';
    this.onOpenChange(false);
  }

  /** Respec for gold (only at the training book). */
  respec(): string | null {
    const p = this.player;
    const cost = p.prog.respecCost();
    if (p.inv.gold < cost) return `Respec costs ${cost} gold.`;
    p.inv.gold -= cost;
    p.inv.changed();
    p.prog.respec();
    return null;
  }

  update(): void {
    if (!this.open) return;
    const p = this.player;
    p.refreshStats();
    const key = `${p.prog.version}:${p.inv.version}`;
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    const prog = p.prog;
    const def = prog.def;
    const st = p.stats;
    this.panel.innerHTML = '';

    const head = div('inv-head', `${def.name} · Level ${prog.level}<span class="inv-close">✕ (Esc)</span>`);
    head.querySelector('.inv-close')!.addEventListener('click', () => this.close());
    this.panel.appendChild(head);
    this.panel.appendChild(
      div('inv-sub', prog.level < 15 ? `XP ${prog.xp} / ${xpToNext(prog.level)}` : 'Max level'),
    );

    const body = div('inv-body');
    this.panel.appendChild(body);

    // Attributes.
    const left = div('inv-col');
    left.appendChild(div('inv-sub', `Attributes — <b style="color:#7be06b">${prog.attrPoints}</b> to spend`));
    const attrs = div('attrs');
    for (const a of ATTRS) {
      const row = div('');
      const gear = st.totals[a];
      row.innerHTML = `<span class="name">${ATTR_NAMES[a]}</span><span class="val">${prog.attrs[a] + gear}</span>`;
      const plus = document.createElement('button');
      plus.className = 'plus';
      plus.textContent = '+';
      plus.disabled = prog.attrPoints < 1;
      plus.addEventListener('click', () => prog.allocate(a));
      row.appendChild(plus);
      row.appendChild(div('', `<small>${ATTR_HELP[a]}${gear ? ` (gear +${gear})` : ''}</small>`));
      attrs.appendChild(row);
    }
    left.appendChild(attrs);
    left.appendChild(
      div(
        'inv-stats',
        [
          ['HP', st.maxHp], ['Mana', st.maxMana], ['Stamina', st.maxStamina],
          ['Damage', Math.round(st.weaponDamage * st.damageMult)],
          ['Crit', `${Math.round(st.crit * 100)}% ×${st.critMult.toFixed(2)}`],
          ['Armour', st.armour], ['Cooldowns', `${Math.round((1 - st.cooldownMult) * 100)}% faster`],
        ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join(''),
      ),
    );
    if (this.atBook) {
      const btn = document.createElement('button');
      btn.className = 'respec';
      btn.textContent = `Respec: refund all points (${prog.respecCost()} gold)`;
      btn.addEventListener('click', () => {
        const err = this.respec();
        if (err) this.toast(err);
      });
      left.appendChild(btn);
    } else {
      left.appendChild(div('inv-note', 'Respec at the training book in your home.'));
    }
    body.appendChild(left);

    // Skill tree.
    const right = div('inv-col');
    right.appendChild(div('inv-sub', `Skill tree — <b style="color:#7be06b">${prog.skillPoints}</b> point${prog.skillPoints === 1 ? '' : 's'} to spend`));
    const tree = div('tree');
    def.skills.forEach((id, i) => {
      const s = SKILLS[id];
      const locked = prog.level < s.unlock;
      tree.appendChild(this.node(id, `${i + 1}. ${s.name}`, `${s.desc} <i>(${s.cooldown}s${s.mana ? `, ${s.mana} mana` : ''})</i>`, `Rank: ${s.rankText}`, locked ? `Unlocks at level ${s.unlock}` : ''));
    });
    for (const id of def.passives) {
      const pv = PASSIVES[id];
      tree.appendChild(this.node(id, pv.name, 'Passive', `Rank: ${pv.text}`, ''));
    }
    right.appendChild(tree);
    body.appendChild(right);
    this.panel.appendChild(div('inv-foot', '<i>Levels give 5 attribute points and 1 skill point. Skills unlock at levels 1, 2, 4 and 6.</i>'));
  }

  private node(id: string, title: string, desc: string, rankText: string, lockText: string): HTMLElement {
    const prog = this.player.prog;
    const r = prog.rank(id);
    const n = div(`node${lockText ? ' locked' : ''}`);
    n.innerHTML = `<b>${title}</b> <span class="pips">${'●'.repeat(r)}${'○'.repeat(MAX_RANK - r)}</span>
      <div class="desc">${desc}</div><small>${lockText || rankText}</small>`;
    const plus = document.createElement('button');
    plus.className = 'plus';
    plus.textContent = '+';
    plus.disabled = prog.skillPoints < 1 || r >= MAX_RANK || !!lockText;
    plus.addEventListener('click', () => {
      const err = prog.rankUp(id);
      if (err) this.toast(err);
    });
    n.appendChild(plus);
    return n;
  }
}

/** Start screen: pick one of the four classes (permanent for this character). */
export class ClassSelect {
  private el: HTMLDivElement;

  constructor(root: HTMLElement, onPick: (cls: ClassId) => void) {
    this.el = div('classpick');
    this.el.innerHTML = '<h1>Emberhollow</h1><div>Choose your class — it is permanent for this character.</div>';
    const cards = div('cards');
    for (const id of CLASS_IDS) {
      const c = CLASSES[id];
      const card = div('classcard');
      const colour = `#${c.colour.toString(16).padStart(6, '0')}`;
      card.style.borderTopColor = colour;
      card.innerHTML = `<h2 style="color:${lighten(colour)}">${c.name}</h2><div class="weapon">${c.weapon} · ${c.hp} HP · ${c.mana} mana</div>
        <div>${c.blurb}</div><ul>${c.skills.map((s) => `<li>${SKILLS[s].name}</li>`).join('')}</ul>`;
      card.addEventListener('click', () => {
        this.hide();
        onPick(id);
      });
      cards.appendChild(card);
    }
    this.el.appendChild(cards);
    root.appendChild(this.el);
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  show(): void {
    this.el.style.display = '';
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}

function div(cls: string, html = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  return d;
}

function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.min(255, ((n >> s) & 255) + 90);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}
