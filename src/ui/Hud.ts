import * as THREE from 'three';
import { TUNING } from '../config';
import type { Player } from '../player/Player';
import type { Enemy } from '../combat/Enemy';
import type { CombatFx } from '../combat/combat';

const HELP = `WASD  move        Mouse  look / scroll zoom
Space jump · climb-jump · open/close glider
      (on a wall + S: jump off)
Shift tap: dodge-roll · hold: sprint
Left click: attack (click again mid-swing = combo)
Right click: block (block just in time = parry)
Tab / middle click: lock-on · flick mouse to switch
Walk into a wall to climb · H hide help`;

interface FloatText {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
  drift: number;
}

/** DOM overlay: HP, stamina wheel next to the player, debug, help and settings. */
export class Hud {
  private hpFill: HTMLDivElement;
  private hpText: HTMLSpanElement;
  private debug: HTMLDivElement;
  private help: HTMLDivElement;
  private wheel: SVGSVGElement;
  private wheelArc: SVGCircleElement;
  private prompt: HTMLDivElement;
  private toast: HTMLDivElement;
  private toastTime = 0;
  private fps = 60;
  private root: HTMLElement;
  private floats: FloatText[] = [];
  private bars = new Map<Enemy, HTMLDivElement>();
  private reticle: HTMLDivElement;

  constructor(
    root: HTMLElement,
    onPixelScale: (scale: number) => void,
    initialScale: number,
  ) {
    this.root = root;
    root.innerHTML = `
      <div class="panel hp"><span>HP <span id="hp-text"></span></span><div class="bar"><div id="hp-fill"></div></div></div>
      <div class="panel debug" id="debug"></div>
      <div class="panel help" id="help"></div>
      <div class="panel settings">Pixel size
        <input id="pixel" type="range" min="1" max="4" step="1" />
        <span id="pixel-label"></span></div>
      <svg class="stamina" id="wheel" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="14" fill="rgba(0,0,0,0.45)" stroke="#2b2b2b" stroke-width="5" />
        <circle id="wheel-arc" cx="18" cy="18" r="14" fill="none" stroke="#7be06b" stroke-width="5"
          stroke-dasharray="87.96" transform="rotate(-90 18 18)" stroke-linecap="butt" />
      </svg>
      <div class="prompt" id="prompt">Click to play</div>
      <div class="toast" id="toast"></div>`;
    this.hpFill = root.querySelector('#hp-fill')!;
    this.hpText = root.querySelector('#hp-text')!;
    this.debug = root.querySelector('#debug')!;
    this.help = root.querySelector('#help')!;
    this.help.textContent = HELP;
    this.wheel = root.querySelector('#wheel')!;
    this.wheelArc = root.querySelector('#wheel-arc')!;
    this.prompt = root.querySelector('#prompt')!;
    this.toast = root.querySelector('#toast')!;
    this.reticle = document.createElement('div');
    this.reticle.className = 'reticle';
    root.appendChild(this.reticle);

    // Slider value = how many screen pixels make one game pixel.
    const slider = root.querySelector<HTMLInputElement>('#pixel')!;
    const label = root.querySelector<HTMLSpanElement>('#pixel-label')!;
    const steps = [1, 0.5, 0.34, 0.25];
    const idx = Math.max(0, steps.findIndex((s) => Math.abs(s - initialScale) < 0.02));
    slider.value = String(idx + 1);
    const apply = () => {
      const s = steps[Number(slider.value) - 1];
      label.textContent = s === 1 ? 'sharp' : `1/${Math.round(1 / s)}`;
      onPixelScale(s);
    };
    slider.addEventListener('input', apply);
    label.textContent = initialScale === 1 ? 'sharp' : `1/${Math.round(1 / initialScale)}`;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH') this.help.style.display = this.help.style.display === 'none' ? '' : 'none';
    });
  }

  update(p: Player, camera: THREE.Camera, dt: number, locked: boolean): void {
    this.fps += (1 / Math.max(dt, 1e-4) - this.fps) * 0.05;
    this.hpFill.style.width = `${Math.max(0, (p.hp / TUNING.maxHp) * 100)}%`;
    this.hpText.textContent = `${Math.max(0, Math.round(p.hp))} / ${TUNING.maxHp}`;
    this.debug.textContent =
      `fps   ${this.fps.toFixed(0)}\n` +
      `state ${p.state}\n` +
      `pos   ${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)}\n` +
      `stam  ${p.stamina.toFixed(0)}${p.exhausted ? ' (exhausted)' : ''}\n` +
      `poise ${p.poise.value.toFixed(0)}${p.staggerKind ? ` (${p.staggerKind})` : ''}` +
      (p.state === 'attack' ? `\nhit   ${p.comboIndex + 1} ${p.attackPhase()}` : '') +
      (p.blocking ? '\nblocking' : '');

    // Stamina wheel beside the player; hidden when full.
    const full = p.stamina >= TUNING.stamina.max - 0.01 && !p.exhausted;
    const sp = p.pos.clone().add(new THREE.Vector3(0, 1.4, 0)).project(camera);
    this.wheel.style.left = `${(sp.x * 0.5 + 0.5) * window.innerWidth + 46}px`;
    this.wheel.style.top = `${(-sp.y * 0.5 + 0.5) * window.innerHeight}px`;
    this.wheel.style.opacity = full ? '0' : '1';
    const frac = p.stamina / TUNING.stamina.max;
    this.wheelArc.setAttribute('stroke-dashoffset', String(87.96 * (1 - frac)));
    this.wheelArc.setAttribute('stroke', p.exhausted ? '#e0503f' : frac < 0.3 ? '#f0c040' : '#7be06b');

    this.prompt.style.display = locked ? 'none' : '';

    const ev = p.events.shift();
    if (ev) {
      this.toast.textContent = ev;
      this.toastTime = 1.8;
    }
    this.toastTime -= dt;
    this.toast.style.opacity = this.toastTime > 0 ? '1' : '0';
  }

  /** Floating damage numbers, enemy health bars and the lock-on reticle. */
  updateCombat(camera: THREE.Camera, enemies: Enemy[], target: Enemy | null, fx: CombatFx[], dt: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const toScreen = (v: THREE.Vector3) => {
      const s = v.clone().project(camera);
      return { x: (s.x * 0.5 + 0.5) * w, y: (-s.y * 0.5 + 0.5) * h, visible: s.z < 1 && s.z > -1 };
    };

    for (const f of fx) {
      const el = document.createElement('div');
      let text = f.amount > 0 ? String(f.amount) : '';
      let cls = f.target === 'player' ? 'dmg player' : 'dmg';
      if (f.result === 'dodged') (text = 'dodge'), (cls += ' note');
      else if (f.result === 'parried') (text = 'PARRY!'), (cls += ' big');
      else if (f.result === 'blocked') text = `${text} blocked`;
      if (f.stagger && f.target === 'enemy') cls += ' big';
      if (f.stagger) text += ` ${f.stagger}`;
      el.className = cls;
      el.textContent = text;
      this.root.appendChild(el);
      this.floats.push({ el, pos: f.pos.clone(), age: 0, drift: (Math.random() - 0.5) * 30 });
    }
    this.floats = this.floats.filter((f) => {
      f.age += dt;
      if (f.age > 0.9) {
        f.el.remove();
        return false;
      }
      const s = toScreen(f.pos);
      f.el.style.left = `${s.x + f.drift * f.age}px`;
      f.el.style.top = `${s.y - f.age * 60}px`;
      f.el.style.opacity = String(Math.min(1, (0.9 - f.age) * 4));
      f.el.style.display = s.visible ? '' : 'none';
      return true;
    });

    // Enemy health bars: shown while locked on or recently hit.
    for (const e of enemies) {
      let bar = this.bars.get(e);
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'ebar';
        bar.innerHTML = '<div></div>';
        this.root.appendChild(bar);
        this.bars.set(e, bar);
      }
      const show = e.alive && (e === target || e.sinceHit < 4 || e.hp < e.stats.hp);
      const s = toScreen(e.pos.clone().setY(e.topY() + 0.35));
      bar.style.opacity = show && s.visible ? '1' : '0';
      bar.style.left = `${s.x}px`;
      bar.style.top = `${s.y}px`;
      (bar.firstChild as HTMLDivElement).style.width = `${(e.hp / e.stats.hp) * 100}%`;
    }

    if (target) {
      const s = toScreen(target.centre());
      this.reticle.style.display = s.visible ? '' : 'none';
      this.reticle.style.left = `${s.x}px`;
      this.reticle.style.top = `${s.y}px`;
    } else {
      this.reticle.style.display = 'none';
    }
  }
}
