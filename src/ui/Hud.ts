import * as THREE from 'three';
import { TUNING } from '../config';
import type { Player } from '../player/Player';

const HELP = `WASD  move        Mouse  look / scroll zoom
Space jump · climb-jump · open/close glider
      (on a wall + S: jump off)
Shift tap: dodge-roll · hold: sprint
Walk into a wall to climb · H hide help`;

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

  constructor(
    root: HTMLElement,
    onPixelScale: (scale: number) => void,
    initialScale: number,
  ) {
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
      `stam  ${p.stamina.toFixed(0)}${p.exhausted ? ' (exhausted)' : ''}`;

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
}
