import * as THREE from 'three';
import { Input, type VirtualInput } from './core/Input';
import { World } from './world/World';
import { Player } from './player/Player';
import { PlayerModel } from './player/PlayerModel';
import { ThirdPersonCamera } from './camera/ThirdPersonCamera';
import { Hud } from './ui/Hud';
import { Enemies } from './combat/Enemies';
import { LockOn } from './combat/LockOn';
import type { CombatFx } from './combat/combat';
import { TUNING } from './config';
import { Loot, type Interactable } from './loot/Loot';
import { InventoryUI } from './ui/InventoryUI';
import { Home } from './home/Home';

const STEP = 1 / 60;
const PIXEL_KEY = 'emberhollow.pixelScale';

function loadPixelScale(): number {
  try {
    const v = Number(localStorage.getItem(PIXEL_KEY));
    if (v > 0 && v <= 1) return v;
  } catch {
    /* storage unavailable */
  }
  return 0.5;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 600);
  readonly input: Input;
  readonly world: World;
  readonly player: Player;
  readonly model = new PlayerModel();
  readonly cam: ThirdPersonCamera;
  readonly hud: Hud;
  readonly enemies: Enemies;
  readonly lockOn = new LockOn();
  /** Hit feedback produced this frame, shown by the HUD. */
  readonly fx: CombatFx[] = [];
  /** Remaining frames of hit-stop (the whole simulation freezes briefly on a hit). */
  hitStop = 0;
  readonly loot: Loot;
  /** The thing E would use right now (nearest in reach), if any. */
  focus: Interactable | null = null;
  /** Extra sources of interactables (the home base). */
  readonly interactSources: (() => Interactable[])[] = [];
  /** While a menu is open the world keeps running but ignores game input. */
  menuOpen = false;
  readonly ui: InventoryUI;
  readonly home: Home;
  private sun: THREE.DirectionalLight;
  private accumulator = 0;
  private last = performance.now();
  private pixelScale = loadPixelScale();
  /** In manual mode (tests) the loop does not simulate on its own; call `step`. */
  manual = false;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const sky = new THREE.Color('#8fc4e8');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 60, 220);
    this.scene.add(new THREE.HemisphereLight('#cfe8ff', '#5a4a36', 1.3));
    this.sun = new THREE.DirectionalLight('#fff2d6', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -40;
    sc.right = sc.top = 40;
    sc.near = 1;
    sc.far = 200;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);

    this.input = new Input(canvas);
    this.world = new World();
    this.scene.add(this.world.group);
    this.player = new Player(this.world);
    this.scene.add(this.model.root);
    this.enemies = new Enemies(this.world);
    this.scene.add(this.enemies.group);
    this.loot = new Loot(this.world);
    this.scene.add(this.loot.group);
    this.cam = new ThirdPersonCamera(this.camera, this.world);
    this.hud = new Hud(hudRoot, (s) => this.setPixelScale(s), this.pixelScale);
    this.ui = new InventoryUI(
      hudRoot,
      this.player.inv,
      () => this.player.level,
      (open) => (this.menuOpen = open),
      (item) => this.loot.dropItem(item, this.player.pos),
      (msg) => this.player.events.push(msg),
    );
    this.home = new Home(this.world, this.ui);
    this.scene.add(this.home.group);
    this.interactSources.push(() => this.home.interactables(this.player.pos));

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setPixelScale(s: number): void {
    this.pixelScale = s;
    try {
      localStorage.setItem(PIXEL_KEY, String(s));
    } catch {
      /* storage unavailable */
    }
    this.resize();
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Render at a fraction of the screen; CSS stretches it with nearest-neighbour.
    this.renderer.setSize(Math.max(1, Math.round(w * this.pixelScale)), Math.max(1, Math.round(h * this.pixelScale)), false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (!this.manual) {
        this.accumulator += dt;
        let steps = 0;
        while (this.accumulator >= STEP && steps < 6) {
          this.simulate();
          this.accumulator -= STEP;
          steps++;
        }
        if (steps === 6) this.accumulator = 0;
      }
      this.render(dt);
    };
    loop();
  }

  private simulate(): void {
    this.input.suppressed = this.menuOpen;
    this.input.update();
    const p = this.player;
    if (this.hitStop > 0) {
      // Frozen for a few frames; still remember button presses.
      this.hitStop--;
      p.readInput(this.input, STEP);
      this.input.endStep();
      return;
    }

    if (this.input.consumePress('lockOn')) this.lockOn.toggle(p, this.enemies.list, this.cam.yaw);
    this.lockOn.update(p, STEP);
    const target = this.lockOn.target;
    if (target) this.cam.followLock(p.pos, target.pos, STEP);

    p.update(STEP, this.input, this.cam.yaw, target ? target.pos : null);
    if (p.strike) {
      const { hits, dealt } = this.enemies.applyStrike(p.strike, p, this.fx);
      if (p.stats.uniques.has('lifesteal')) p.heal(dealt * TUNING.combat.lifesteal);
      if (hits > 0) {
        const heavy = p.strike.index === TUNING.combat.combo.length - 1;
        this.hitStop = heavy ? TUNING.combat.hitStop.heavy : TUNING.combat.hitStop.light;
        this.cam.addTrauma(heavy ? 0.35 : 0.2);
      }
    }
    this.enemies.update(STEP, p, this.fx);
    for (const e of this.enemies.collectKills()) this.loot.dropFor(e);
    this.loot.update(STEP, p);

    this.focus = this.findFocus();
    if (this.input.consumePress('interact') && this.focus && (p.state === 'ground' || p.state === 'attack')) {
      this.focus.act();
    }

    for (const f of p.fx) {
      this.fx.push(f);
      if (f.result === 'hit' || f.result === 'blocked') this.cam.addTrauma(f.stagger ? 0.5 : 0.3);
      if (f.result === 'parried') this.hitStop = TUNING.combat.hitStop.heavy;
    }
    p.fx.length = 0;
    this.input.endStep();
  }

  private findFocus(): Interactable | null {
    const p = this.player;
    if (p.state === 'dead') return null;
    let best: Interactable | null = null;
    let bestD = Infinity;
    const all = this.loot.interactables(p);
    for (const src of this.interactSources) all.push(...src());
    for (const it of all) {
      const d = Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z);
      if (d <= it.radius && d < bestD && Math.abs(it.pos.y - p.pos.y) < 2.5) {
        best = it;
        bestD = d;
      }
    }
    return best;
  }

  /** Test hook: run `frames` fixed steps with the given virtual input. */
  step(frames: number, v: VirtualInput | null = null, draw = false): void {
    this.input.setVirtual(v ?? {});
    for (let i = 0; i < frames; i++) this.simulate();
    this.input.setVirtual(null);
    if (draw) this.render(STEP);
  }

  private render(dt: number): void {
    const look = this.input.takeLook();
    const target = this.lockOn.target;
    if (target) this.lockOn.flick(look.dx, this.player, this.enemies.list);
    this.cam.update(this.player.pos, look, dt, target ? target.centre() : null);
    this.model.update(this.player, dt);
    this.enemies.updateModels(dt);
    this.loot.animate(performance.now() / 1000);
    // Keep the shadow area centred on the player.
    const p = this.player.pos;
    this.sun.position.set(p.x + 30, p.y + 60, p.z + 20);
    this.sun.target.position.copy(p);
    this.hud.update(this.player, this.camera, dt, this.input.pointerLocked || this.manual);
    this.hud.updateCombat(this.camera, this.enemies.list, target, this.fx, dt);
    this.hud.updateLoot(this.focus, this.loot.feed, this.player.inv.gold, dt);
    this.loot.feed.length = 0;
    this.ui.update();
    this.fx.length = 0;
    this.renderer.render(this.scene, this.camera);
  }
}
