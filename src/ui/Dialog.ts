/** One button in a dialog. */
export interface DialogOption {
  label: string;
  action?: () => void;
  disabled?: boolean;
  /** Keep the dialog open after the action (it usually re-shows itself). */
  keepOpen?: boolean;
}

export interface DialogSpec {
  title: string;
  /** HTML body (trusted: only our own strings). */
  text: string;
  options: DialogOption[];
}

/**
 * Generic talk / menu box: NPC conversations, campfire rest and fast travel, house purchase.
 * Keys 1–9 pick an option; Esc closes.
 */
export class Dialog {
  private el: HTMLDivElement;
  private spec: DialogSpec | null = null;

  constructor(root: HTMLElement, private onOpenChange: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'dialog';
    this.el.style.display = 'none';
    root.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (!this.spec) return;
      if (e.code === 'Escape') this.close();
      const n = Number(e.key);
      if (n >= 1 && n <= 9) this.choose(n - 1);
    });
  }

  get isOpen(): boolean {
    return this.spec !== null;
  }

  get current(): DialogSpec | null {
    return this.spec;
  }

  show(spec: DialogSpec): void {
    this.spec = spec;
    this.el.style.display = '';
    this.el.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'dialog-title';
    title.textContent = spec.title;
    const text = document.createElement('div');
    text.className = 'dialog-text';
    text.innerHTML = spec.text;
    const opts = document.createElement('div');
    opts.className = 'dialog-options';
    spec.options.forEach((o, i) => {
      const b = document.createElement('button');
      b.textContent = `${i + 1}. ${o.label}`;
      b.disabled = !!o.disabled;
      b.addEventListener('click', () => this.choose(i));
      opts.appendChild(b);
    });
    this.el.append(title, text, opts);
    document.exitPointerLock?.();
    this.onOpenChange();
  }

  /** Pick option `i` (also used by tests). */
  choose(i: number): void {
    const spec = this.spec;
    const o = spec?.options[i];
    if (!o || o.disabled) return;
    if (!o.keepOpen) this.close();
    o.action?.();
  }

  /** Pick the option whose label contains `text`. */
  chooseLabel(text: string): boolean {
    const i = this.spec?.options.findIndex((o) => o.label.includes(text)) ?? -1;
    if (i < 0) return false;
    this.choose(i);
    return true;
  }

  close(): void {
    if (!this.spec) return;
    this.spec = null;
    this.el.style.display = 'none';
    this.onOpenChange();
  }
}
