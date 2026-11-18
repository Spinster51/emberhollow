import * as THREE from 'three';
import type { Player } from '../player/Player';
import type { Enemy } from '../combat/Enemy';
import type { CombatFx } from '../combat/combat';
import type { Interactable } from '../loot/Loot';
import { SKILLS, xpToNext, MAX_LEVEL } from '../classes/classes';
import type { Skills } from '../classes/Skills';

const HELP = `WASD  move        Mouse  look / scroll zoom
Space jump · climb-jump · open/close glider
      (on a wall + S: jump off)
Shift tap: dodge-roll · hold: sprint
Left click: attack (click again mid-swing = combo)
Right click: block, parry (mage: aim) · 1–4 skills
Tab / middle click: lock-on · flick mouse to switch
E pick up / use · I inventory · K skills · M map
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
  private bannerEl!: HTMLDivElement;
  private bossBar!: HTMLDivElement;
  private bannerTime = 0;
  /** The full map screen (M) is open. */
  mapOpen = false;
  private interact: HTMLDivElement;
  private feedBox: HTMLDivElement;
  private feedItems: { el: HTMLDivElement; age: number }[] = [];
  private goldText: HTMLDivElement;
  private mpFill!: HTMLDivElement;
  private mpText!: HTMLSpanElement;
  private xpFill!: HTMLDivElement;
  private lvl!: HTMLDivElement;
  private buffs!: HTMLDivElement;
  private skillbar!: HTMLDivElement;
  private crosshair!: HTMLDivElement;
  private slots: { root: HTMLDivElement; cd: HTMLDivElement; txt: HTMLSpanElement; lock: HTMLDivElement; cls: string; id: string }[] = [];

  constructor(
    root: HTMLElement,
    onPixelScale: (scale: number) => void,
    initialScale: number,
  ) {
    this.root = root;
    root.innerHTML = `
      <div class="panel hp"><div class="lvl" id="lvl"></div>
        <span>HP <span id="hp-text"></span></span><div class="bar"><div id="hp-fill"></div></div>
        <span>Mana <span id="mp-text"></span></span><div class="bar mana"><div id="mp-fill"></div></div>
        <div class="bar xp"><div id="xp-fill"></div></div>
        <div class="buffs" id="buffs"></div>
        <div class="gold" id="gold"></div></div>
      <div class="skillbar" id="skillbar"></div>
      <div class="crosshair" id="crosshair"></div>
      <div class="interact" id="interact"></div>
      <div class="feed" id="feed"></div>
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
      <div class="toast" id="toast"></div>
      <div class="banner" id="banner"><b></b><small></small></div>
      <div class="bossbar" id="bossbar" style="display:none"><b></b><div class="track"><div></div></div></div>`;
    this.hpFill = root.querySelector('#hp-fill')!;
    this.hpText = root.querySelector('#hp-text')!;
    this.debug = root.querySelector('#debug')!;
    this.help = root.querySelector('#help')!;
    this.help.textContent = HELP;
    this.wheel = root.querySelector('#wheel')!;
    this.wheelArc = root.querySelector('#wheel-arc')!;
    this.prompt = root.querySelector('#prompt')!;
    this.toast = root.querySelector('#toast')!;
    this.interact = root.querySelector('#interact')!;
    this.bannerEl = root.querySelector('#banner')!;
    this.bossBar = root.querySelector('#bossbar')!;
    this.feedBox = root.querySelector('#feed')!;
    this.goldText = root.querySelector('#gold')!;
    this.mpFill = root.querySelector('#mp-fill')!;
    this.mpText = root.querySelector('#mp-text')!;
    this.xpFill = root.querySelector('#xp-fill')!;
    this.lvl = root.querySelector('#lvl')!;
    this.buffs = root.querySelector('#buffs')!;
    this.skillbar = root.querySelector('#skillbar')!;
    this.crosshair = root.querySelector('#crosshair')!;
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
      if (e.code === 'F3') {
        e.preventDefault();
        this.debug.style.display = this.debug.style.display === 'none' ? '' : 'none';
      }
    });
    // Debug panel: hidden in the real game (F3 shows it), visible in automated tests.
    if (!new URLSearchParams(location.search).has('test')) this.debug.style.display = 'none';
  }

  update(p: Player, camera: THREE.Camera, dt: number, locked: boolean): void {
    this.fps += (1 / Math.max(dt, 1e-4) - this.fps) * 0.05;
    this.hpFill.style.width = `${Math.max(0, (p.hp / p.stats.maxHp) * 100)}%`;
    this.hpText.textContent = `${Math.max(0, Math.round(p.hp))} / ${p.stats.maxHp}`;
    this.debug.textContent =
      `fps   ${this.fps.toFixed(0)}\n` +
      `state ${p.state}\n` +
      `pos   ${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)}\n` +
      `stam  ${p.stamina.toFixed(0)}${p.exhausted ? ' (exhausted)' : ''}\n` +
      `poise ${p.poise.value.toFixed(0)}${p.staggerKind ? ` (${p.staggerKind})` : ''}` +
      (p.state === 'attack' ? `\nhit   ${p.comboIndex + 1} ${p.attackPhase()}` : '') +
      (p.blocking ? '\nblocking' : '');

    // Stamina wheel beside the player; hidden when full.
    const full = p.stamina >= p.stats.maxStamina - 0.01 && !p.exhausted;
    const sp = p.pos.clone().add(new THREE.Vector3(0, 1.4, 0)).project(camera);
    this.wheel.style.left = `${(sp.x * 0.5 + 0.5) * window.innerWidth + 46}px`;
    this.wheel.style.top = `${(-sp.y * 0.5 + 0.5) * window.innerHeight}px`;
    this.wheel.style.opacity = full ? '0' : '1';
    const frac = p.stamina / p.stats.maxStamina;
    this.wheelArc.setAttribute('stroke-dashoffset', String(87.96 * (1 - frac)));
    this.wheelArc.setAttribute('stroke', p.exhausted ? '#e0503f' : frac < 0.3 ? '#f0c040' : '#7be06b');

    this.prompt.style.display = locked ? 'none' : '';

    const ev = p.events.shift();
    if (ev) {
      this.toast.textContent = ev;
      this.toastTime = 1.8;
    }
    this.toastTime -= dt;
    this.bannerTime -= dt;
    this.bannerEl.style.opacity = this.bannerTime > 0 ? '1' : '0';
    this.toast.style.opacity = this.toastTime > 0 ? '1' : '0';
  }

  /** Big region-name banner. */
  banner(title: string, sub: string): void {
    (this.bannerEl.querySelector('b') as HTMLElement).textContent = title;
    (this.bannerEl.querySelector('small') as HTMLElement).textContent = sub;
    this.bannerTime = 3;
  }

  /** Mana, XP, level, skill bar with cooldowns, buffs, tank counter meter, mage crosshair. */
  updateClass(p: Player, skills: Skills): void {
    const st = p.stats;
    const def = p.prog.def;
    this.mpFill.style.width = `${(p.mana / st.maxMana) * 100}%`;
    this.mpText.textContent = `${Math.floor(p.mana)} / ${st.maxMana}`;
    const need = xpToNext(p.level);
    this.xpFill.style.width = p.level >= MAX_LEVEL ? '100%' : `${(p.prog.xp / need) * 100}%`;
    const pts = p.prog.attrPoints + p.prog.skillPoints > 0 ? ' <b class="pts">+ points (K)</b>' : '';
    this.lvl.innerHTML = `${def.name} · Level ${p.level}${p.level < MAX_LEVEL ? ` <small>${p.prog.xp}/${need} XP</small>` : ''}${pts}`;

    const b: string[] = [];
    if (p.damageBuffTime > 0) b.push(`War Cry ${p.damageBuffTime.toFixed(0)}s`);
    if (p.guardTime > 0) b.push(`Bulwark ${p.guardTime.toFixed(0)}s`);
    if (p.stealthTime > 0) b.push(`Stealth ${p.stealthTime.toFixed(0)}s`);
    if (p.nextCrit) b.push('Next hit crits');
    if (p.cls === 'tank') b.push(`Counter ${Math.round(p.counter)}%${p.sinceParry < 1.5 ? ' — RIPOSTE (1)!' : ''}`);
    this.buffs.textContent = b.join(' · ');

    // Skill bar (rebuilt when the class changes).
    if (this.slots[0]?.cls !== def.id) {
      this.skillbar.innerHTML = '';
      this.slots = def.skills.map((id, i) => {
        const sk = SKILLS[id];
        const root = document.createElement('div');
        root.className = 'skill';
        root.title = `${sk.name} — ${sk.desc}`;
        root.innerHTML = `<i>${i + 1}</i><span>${sk.short}</span><div class="cd"></div><div class="lock"></div><small>${sk.mana || ''}</small>`;
        this.skillbar.appendChild(root);
        return {
          root, cls: def.id, id,
          cd: root.querySelector('.cd') as HTMLDivElement,
          txt: root.querySelector('span') as HTMLSpanElement,
          lock: root.querySelector('.lock') as HTMLDivElement,
        };
      });
    }
    for (const s of this.slots) {
      const sk = SKILLS[s.id];
      const left = skills.remaining(s.id);
      const unlocked = p.prog.skillUnlocked(s.id);
      s.cd.style.height = left > 0 ? `${Math.min(1, left / sk.cooldown) * 100}%` : '0';
      s.cd.textContent = left > 0.05 ? left.toFixed(left < 1 ? 1 : 0) : '';
      s.lock.style.display = unlocked ? 'none' : '';
      s.lock.textContent = `Lv ${sk.unlock}`;
      const ready = s.id === 'riposte' ? p.sinceParry < 1.5 : true;
      s.root.classList.toggle('nomana', unlocked && p.mana < sk.mana);
      s.root.classList.toggle('dim', unlocked && !ready);
    }

    this.crosshair.style.display = def.secondary === 'aim' && p.state !== 'dead' ? '' : 'none';
    this.crosshair.classList.toggle('aiming', p.aiming);
  }

  /** Interaction prompt, pick-up feed and gold. */
  updateLoot(focus: Interactable | null, feed: [string, string][], gold: number, dt: number): void {
    if (focus) {
      this.interact.style.display = '';
      this.interact.innerHTML = '<b>E</b>';
      const span = document.createElement('span');
      span.textContent = focus.label;
      span.style.color = focus.color ?? '#f4ecd8';
      this.interact.appendChild(span);
    } else {
      this.interact.style.display = 'none';
    }
    for (const [text, color] of feed) {
      const el = document.createElement('div');
      el.textContent = text;
      el.style.color = color;
      this.feedBox.appendChild(el);
      this.feedItems.push({ el, age: 0 });
    }
    this.feedItems = this.feedItems.filter((f) => {
      f.age += dt;
      f.el.style.opacity = f.age > 3 ? '0' : '1';
      if (f.age > 3.7) {
        f.el.remove();
        return false;
      }
      return true;
    });
    this.goldText.textContent = `Gold ${gold}`;
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
      if ((f.stagger || f.crit) && f.target === 'enemy') cls += ' big';
      if (f.crit) text += '!';
      if (f.dot) cls += ' note';
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
    // The boss gets a big bar at the top while the fight is on.
    const boss = enemies.find((e) => e.isBoss && e.alive && e.state !== 'idle' && e.state !== 'return' && e.pos.distanceTo(camera.position) < 50);
    this.bossBar.style.display = boss ? '' : 'none';
    if (boss) {
      (this.bossBar.querySelector('b') as HTMLElement).textContent = `${boss.stats.name}${boss.phase === 2 ? ' — enraged' : ''}`;
      (this.bossBar.querySelector('.track > div') as HTMLElement).style.width = `${(boss.hp / boss.maxHp) * 100}%`;
      this.bossBar.classList.toggle('enraged', boss.phase === 2);
    }
    for (const e of enemies) {
      if (e.isBoss) continue;
      let bar = this.bars.get(e);
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'ebar';
        bar.innerHTML = '<div></div>';
        this.root.appendChild(bar);
        this.bars.set(e, bar);
      }
      const near = e.pos.distanceTo(camera.position) < 60;
      const show = e.alive && near && (e === target || e.sinceHit < 4 || e.hp < e.maxHp);
      const s = toScreen(e.pos.clone().setY(e.topY() + 0.35));
      bar.style.opacity = show && s.visible ? '1' : '0';
      bar.style.left = `${s.x}px`;
      bar.style.top = `${s.y}px`;
      (bar.firstChild as HTMLDivElement).style.width = `${(e.hp / e.maxHp) * 100}%`;
      bar.dataset.level = String(e.level);
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
