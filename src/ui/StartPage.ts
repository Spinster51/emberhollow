import { CLASSES } from '../classes/classes';
import { continueSlot, type AccountSave } from '../save/Save';

export interface StartActions {
  newGame(): void;
  continueGame(): void;
  load(): void;
  settings(): void;
  importSave(): void;
}

/** First screen: New game, Continue, Load, Settings and Import. Shown before any character is in play. */
export class StartPage {
  private el: HTMLDivElement;

  constructor(root: HTMLElement, private actions: StartActions) {
    this.el = document.createElement('div');
    this.el.className = 'classpick start';
    this.el.style.display = 'none';
    root.appendChild(this.el);
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  show(account: AccountSave, note = ''): void {
    this.el.style.display = '';
    this.el.innerHTML = '<h1>Emberhollow</h1><div class="tagline">A browser action RPG · four character slots</div>';
    const used = account.slots.filter((s) => !!s).length;
    const free = account.slots.findIndex((s) => !s);
    const cont = continueSlot(account);
    const menu = document.createElement('div');
    menu.className = 'start-menu';
    menu.append(
      item(
        'New game',
        free >= 0 ? `Starts a character in slot ${free + 1}` : 'All four slots are full: pick one to overwrite',
        () => this.actions.newGame(),
        { primary: true },
      ),
      item(
        'Continue',
        cont >= 0 ? `Slot ${cont + 1} · ${CLASSES[account.slots[cont]!.cls].name} · level ${account.slots[cont]!.level}` : 'No saved game yet',
        () => this.actions.continueGame(),
        { disabled: cont < 0 },
      ),
      item('Load', `${used} of 4 slots in use`, () => this.actions.load()),
      item('Settings', 'Graphics, sound and keys', () => this.actions.settings()),
      item('Import save file', 'Restore a saved .json file', () => this.actions.importSave()),
    );
    this.el.appendChild(menu);
    if (note) {
      const n = document.createElement('div');
      n.className = 'note';
      n.textContent = note;
      this.el.appendChild(n);
    }
  }
}

function item(label: string, hint: string, onClick: () => void, opts: { primary?: boolean; disabled?: boolean } = {}): HTMLButtonElement {
  const b = document.createElement('button');
  if (opts.primary) b.className = 'primary';
  const strong = document.createElement('b');
  strong.textContent = label;
  const small = document.createElement('small');
  small.textContent = hint;
  b.append(strong, small);
  b.disabled = !!opts.disabled;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
