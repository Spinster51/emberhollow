// Settings panel (O key): graphics quality, pixel size, sound volume and mute, and the controls.
// Changes are applied at once through the callbacks and saved by the Game.

import type { Quality, Settings } from '../core/settings';

/** Pixel-size steps: how many screen pixels make one game pixel, as a fraction of the window. */
export const PIXEL_STEPS = [1, 0.5, 0.34, 0.25];

export interface SettingsHooks {
  setQuality(q: Quality): void;
  setPixel(scale: number): void;
  setSound(volume: number, muted: boolean): void;
}

const QUALITY_LABEL: Record<Quality, string> = { low: 'Low · no shadows', medium: 'Medium · soft shadows', high: 'High · sharp shadows' };

export class SettingsUI {
  private panel: HTMLDivElement;
  private open_ = false;

  constructor(root: HTMLElement, private settings: Settings, private hooks: SettingsHooks, private onOpenChange: (open: boolean) => void) {
    this.panel = document.createElement('div');
    this.panel.className = 'inv settings-panel';
    this.panel.style.display = 'none';
    this.panel.addEventListener('contextmenu', (e) => e.preventDefault());
    root.append(this.panel);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyO') this.toggle();
      else if (e.code === 'Escape' && this.open_) this.close();
    });
  }

  get isOpen(): boolean {
    return this.open_;
  }

  toggle(): void {
    if (this.open_) this.close();
    else this.show();
  }

  show(): void {
    this.open_ = true;
    this.panel.style.display = '';
    document.exitPointerLock?.();
    this.onOpenChange(true);
    this.render();
  }

  close(): void {
    this.open_ = false;
    this.panel.style.display = 'none';
    this.onOpenChange(false);
  }

  private render(): void {
    const s = this.settings;
    this.panel.innerHTML = '';
    const head = el('div', 'inv-head', 'Settings<span class="inv-close">✕ (Esc)</span>');
    head.querySelector('.inv-close')!.addEventListener('click', () => this.close());
    this.panel.append(head);
    const body = el('div', 'set-body');

    // Graphics quality.
    body.append(el('div', 'inv-sub', 'Graphics'));
    const qRow = el('div', 'set-row');
    for (const q of ['low', 'medium', 'high'] as Quality[]) {
      const b = document.createElement('button');
      b.className = 'craft-btn' + (s.quality === q ? ' on' : '');
      b.textContent = q[0].toUpperCase() + q.slice(1);
      b.title = QUALITY_LABEL[q];
      b.addEventListener('click', () => {
        this.settings.quality = q;
        this.hooks.setQuality(q);
        this.render();
      });
      qRow.append(b);
    }
    body.append(qRow, el('div', 'inv-note set-note', QUALITY_LABEL[s.quality]));

    // Pixel size.
    body.append(el('div', 'inv-sub', 'Pixel size'));
    const idx = Math.max(0, PIXEL_STEPS.findIndex((v) => Math.abs(v - s.pixelScale) < 0.02));
    const pixelLabel = (v: number) => (v === 1 ? 'sharp' : `1/${Math.round(1 / v)}`);
    const pRow = el('div', 'set-row');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '1';
    slider.max = String(PIXEL_STEPS.length);
    slider.step = '1';
    slider.value = String(idx + 1);
    const label = el('span', 'set-val', pixelLabel(PIXEL_STEPS[idx]));
    slider.addEventListener('input', () => {
      const v = PIXEL_STEPS[Number(slider.value) - 1];
      label.textContent = pixelLabel(v);
      this.hooks.setPixel(v);
    });
    pRow.append(slider, label);
    body.append(pRow);

    // Sound.
    body.append(el('div', 'inv-sub', 'Sound'));
    const vRow = el('div', 'set-row');
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.step = '5';
    vol.value = String(Math.round(s.volume * 100));
    const volLabel = el('span', 'set-val', `${vol.value}%`);
    const mute = document.createElement('input');
    mute.type = 'checkbox';
    mute.checked = s.muted;
    const push = () => {
      const v = Number(vol.value) / 100;
      volLabel.textContent = `${vol.value}%`;
      this.hooks.setSound(v, mute.checked);
    };
    vol.addEventListener('input', push);
    mute.addEventListener('change', push);
    const muteLabel = document.createElement('label');
    muteLabel.className = 'set-mute';
    muteLabel.append(mute, ' Mute');
    vRow.append(vol, volLabel, muteLabel);
    body.append(vRow);

    // Controls (short reminder; the full list is the H panel).
    body.append(el('div', 'inv-sub', 'Keys'));
    body.append(el('div', 'set-keys', 'I inventory · K skills · M map · E use · 1–4 skills · Tab lock-on · H help · F3 debug'));
    this.panel.append(body);
  }
}

function el(tag: string, cls: string, html = ''): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.className = cls;
  e.innerHTML = html;
  return e;
}
