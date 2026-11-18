import { CLASSES } from '../classes/classes';
import type { AccountSave } from '../save/Save';

export interface SlotActions {
  play(i: number): void;
  create(i: number): void;
  overwrite(i: number): void;
  remove(i: number): void;
  back(): void;
  exportSave(): void;
  importSave(): void;
}

/** Slot list: 4 character slots, plus export / import of the whole save. Opened from the start page. */
export class SlotSelect {
  private el: HTMLDivElement;

  constructor(root: HTMLElement, private actions: SlotActions) {
    this.el = document.createElement('div');
    this.el.className = 'classpick slots';
    this.el.style.display = 'none';
    root.appendChild(this.el);
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  /** `full`: every slot is used, so each card offers to overwrite (after a confirmation). */
  show(account: AccountSave, note = '', full = false): void {
    this.el.style.display = '';
    this.el.innerHTML = '<h1>Emberhollow</h1><div>Choose a character. The storage chest and your home are shared by all four.</div>';
    const back = button('‹ Back', () => this.actions.back());
    back.className = 'back';
    this.el.prepend(back);
    if (note) {
      const n = document.createElement('div');
      n.className = 'note';
      n.textContent = note;
      this.el.appendChild(n);
    }
    const cards = document.createElement('div');
    cards.className = 'cards';
    account.slots.forEach((s, i) => {
      const card = document.createElement('div');
      card.className = 'classcard slot';
      if (s) {
        const c = CLASSES[s.cls];
        const mins = Math.round(s.playTime / 60);
        card.innerHTML = `<h2 style="color:#ffd27a">${c.name}</h2><div class="weapon">Level ${s.level} · ${s.inv.gold} gold</div>
          <div>${Object.values(s.quests ?? {}).filter((q) => q.status === 'done').length} quests done · ${mins} min played</div>`;
        const play = button('Play', () => this.actions.play(i));
        const del = button('Delete', () => {
          if (confirmDelete(c.name, s.level)) this.actions.remove(i);
        });
        del.className = 'danger';
        card.append(play, del);
        if (full) {
          const over = button('Overwrite with new character', () => {
            if (confirmOverwrite(c.name, s.level)) this.actions.overwrite(i);
          });
          over.className = 'danger';
          card.append(over);
        }
      } else {
        card.innerHTML = `<h2 style="color:#9c8a6c">Empty slot</h2><div class="weapon">Slot ${i + 1}</div>`;
        card.append(button('New character', () => this.actions.create(i)));
      }
      cards.appendChild(card);
    });
    this.el.appendChild(cards);
    const bar = document.createElement('div');
    bar.className = 'savebar';
    bar.append(button('Export save file', () => this.actions.exportSave()), button('Import save file', () => this.actions.importSave()));
    this.el.appendChild(bar);
  }
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function confirmDelete(name: string, level: number): boolean {
  try {
    return window.confirm(`Delete this level ${level} ${name}? This cannot be undone.`);
  } catch {
    return true;
  }
}

function confirmOverwrite(name: string, level: number): boolean {
  try {
    return window.confirm(`Overwrite this level ${level} ${name} with a new character? The old one is lost for good.`);
  } catch {
    return false;
  }
}
