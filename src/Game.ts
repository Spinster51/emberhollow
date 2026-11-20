import * as THREE from 'three';
import { Input, type VirtualInput } from './core/Input';
import { World } from './world/World';
import { Scenery } from './world/Scenery';
import { SHADOW_LAYER } from './world/Vegetation';
import { Player } from './player/Player';
import { PlayerModel } from './player/PlayerModel';
import { ThirdPersonCamera } from './camera/ThirdPersonCamera';
import { Hud } from './ui/Hud';
import { Enemies } from './combat/Enemies';
import { LockOn } from './combat/LockOn';
import type { CombatFx } from './combat/combat';
import { ENEMY_LOOT, TUNING } from './config';
import { Loot, type Interactable } from './loot/Loot';
import { InventoryUI } from './ui/InventoryUI';
import { CharacterUI, ClassSelect } from './ui/CharacterUI';
import { Home } from './home/Home';
import { TEST_LAYOUT, type Layout } from './world/layouts';
import { Projectiles } from './combat/Projectiles';
import { xpFor, type ClassId } from './classes/classes';
import { Skills, type SkillContext } from './classes/Skills';
import type { Enemy } from './combat/Enemy';
import { Adventure } from './game/Adventure';
import { MapView } from './ui/MapView';
import { loadSettings, saveSettings, type Settings } from './core/settings';
import { sound } from './core/sound';
import { SettingsUI } from './ui/SettingsUI';
import type { Quality } from './core/settings';
import { SlashTrails } from './combat/SlashTrails';
import { Telegraphs } from './combat/Telegraphs';

const STEP = 1 / 60;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 600);
  readonly input: Input;
  readonly world: World;
  /** The world's models (milestone 8): buildings, ruins, gate, vegetation, camp and town dressing. */
  readonly scenery: Scenery;
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
  /** Called for every kill (quests listen here). */
  onKill: ((e: Enemy) => void) | null = null;
  readonly loot: Loot;
  /** The thing E would use right now (nearest in reach), if any. */
  focus: Interactable | null = null;
  /** Extra sources of interactables (the home base). */
  readonly interactSources: (() => Interactable[])[] = [];
  /** While a menu is open the world keeps running but ignores game input. */
  menuOpen = false;
  /** False on the title screens (start page, slots, class pick): the HUD is hidden and input ignored. */
  private playing = false;
  private hudRoot: HTMLElement;
  readonly ui: InventoryUI;
  readonly settingsUI: SettingsUI;
  readonly charUI: CharacterUI;
  readonly classSelect: ClassSelect;
  readonly home: Home;
  readonly projectiles: Projectiles;
  readonly trails = new SlashTrails();
  readonly telegraphs: Telegraphs;
  readonly skills = new Skills();
  readonly adventure: Adventure;
  readonly map: MapView;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private sky: { color: THREE.Color; near: number; far: number };
  /** Inside the dungeon: dark fog, dim torchlight. */
  interior = false;
  private accumulator = 0;
  private last = performance.now();
  readonly settings: Settings = loadSettings();
  private pixelScale = this.settings.pixelScale;
  private lastLevel = 0;
  private lastState = '';
  /** In manual mode (tests) the loop does not simulate on its own; call `step`. */
  manual = false;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, layout: Layout = TEST_LAYOUT) {
    this.hudRoot = hudRoot;
    hudRoot.classList.add('title');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const sky = new THREE.Color('#8fc4e8');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, layout.name === 'main' ? 90 : 60, layout.name === 'main' ? 260 : 220);
    this.camera.far = layout.name === 'main' ? 300 : 600;
    this.sky = { color: sky.clone(), near: this.scene.fog.near, far: this.scene.fog.far };
    this.hemi = new THREE.HemisphereLight('#cfe8ff', '#5a4a36', 1.3);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff2d6', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -40;
    sc.right = sc.top = 40;
    sc.near = 1;
    sc.far = 200;
    this.sun.shadow.bias = -0.0008;
    // The shadow camera also sees the tree shadow proxies (low-poly casters the main camera never draws).
    this.sun.shadow.camera.layers.enable(SHADOW_LAYER);
    this.scene.add(this.sun, this.sun.target);

    this.input = new Input(canvas);
    this.world = new World(layout);
    this.scene.add(this.world.group);
    this.scenery = new Scenery(this.world);
    this.scene.add(this.scenery.group);
    this.player = new Player(this.world);
    this.scene.add(this.model.root);
    this.enemies = new Enemies(this.world);
    this.scene.add(this.enemies.group);
    this.loot = new Loot(this.world);
    this.scene.add(this.loot.group);
    this.projectiles = new Projectiles(this.world);
    this.scene.add(this.projectiles.group);
    this.scene.add(this.trails.group);
    this.telegraphs = new Telegraphs(this.world);
    this.scene.add(this.telegraphs.group);
    this.enemies.hooks = {
      shoot: (e, kind, from, vel) =>
        this.projectiles.spawn({ kind, from, vel, owner: e, damage: e.damage, crit: false, poise: e.stats.poiseDamage, knockback: e.stats.knockback, life: 2 }),
      blast: (at, r, color) => this.projectiles.blast(at, r, color),
    };
    this.cam = new ThirdPersonCamera(this.camera, this.world);
    this.hud = new Hud(hudRoot);
    this.settingsUI = new SettingsUI(hudRoot, this.settings, {
      setQuality: (q) => this.setQuality(q),
      setPixel: (s) => this.setPixelScale(s),
      setSound: (v, m) => this.setSound(v, m),
    }, () => this.updateMenus());
    this.ui = new InventoryUI(
      hudRoot,
      this.player.inv,
      () => this.player.level,
      () => this.player.stats,
      () => this.updateMenus(),
      (item) => this.loot.dropItem(item, this.player.pos),
      (msg) => this.player.events.push(msg),
    );
    this.charUI = new CharacterUI(hudRoot, this.player, () => this.updateMenus(), (msg) => this.player.events.push(msg));
    this.classSelect = new ClassSelect(hudRoot, (cls) => {
      this.chooseClass(cls);
      this.adventure.onClassPicked(cls);
      this.updateMenus();
    });
    this.classSelect.hide();
    this.home = new Home(this.world, this.ui, {
      book: () => this.charUI.show(true),
      sleep: () => this.adventure.sleep(),
      furnish: () => this.adventure.furnish(),
      bench: () => this.ui.openCraft(),
      message: (t) => this.player.events.push(t),
    });
    this.scene.add(this.home.group);
    this.interactSources.push(() => this.home.interactables(this.player.pos));
    this.adventure = new Adventure(this, hudRoot);
    this.interactSources.push(() => this.adventure.interactables());
    this.map = new MapView(hudRoot, this);

    sound.setVolume(this.settings.volume);
    sound.setMuted(this.settings.muted);
    this.applyQuality(this.settings.quality);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setPixelScale(s: number): void {
    this.pixelScale = s;
    this.settings.pixelScale = s;
    saveSettings(this.settings);
    this.resize();
  }

  /** Graphics preset: shadows and their resolution. Remembered. */
  setQuality(q: Quality): void {
    this.settings.quality = q;
    this.applyQuality(q);
    saveSettings(this.settings);
  }

  private applyQuality(q: Quality): void {
    const cfg = { low: { shadows: false, map: 512 }, medium: { shadows: true, map: 1024 }, high: { shadows: true, map: 2048 } }[q];
    this.renderer.shadowMap.enabled = cfg.shadows;
    this.sun.castShadow = cfg.shadows;
    this.sun.shadow.mapSize.set(cfg.map, cfg.map);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  /** Change sound settings and remember them. */
  setSound(volume: number, muted: boolean): void {
    this.settings.volume = volume;
    this.settings.muted = muted;
    sound.setVolume(volume);
    sound.setMuted(muted);
    saveSettings(this.settings);
  }

  /** Plays one sound per combat result, the loot feed, level-ups, rolls and death. */
  private playEvents(): void {
    for (const f of this.fx) {
      if (f.dot) continue;
      if (f.target === 'enemy') {
        if (f.result === 'hit') sound.play(f.crit ? 'crit' : 'hit');
        else if (f.result === 'blocked' || f.result === 'parried') sound.play('block');
      } else if (f.result === 'hit') sound.play('hurt');
      else if (f.result === 'blocked') sound.play('block');
      else if (f.result === 'parried') sound.play('parry');
    }
    if (this.loot.feed.length) sound.play('pickup');
    const p = this.player;
    // A jump of one or two levels is a kill; a bigger one is a loaded save.
    if (p.level > this.lastLevel && this.lastLevel > 0 && p.level - this.lastLevel <= 2) sound.play('levelUp');
    this.lastLevel = p.level;
    if (p.state === 'roll' && this.lastState !== 'roll') sound.play('roll');
    if (p.state === 'dead' && this.lastState !== 'dead') sound.play('death');
    this.lastState = p.state;
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

    this.adventure.preUpdate();
    this.computeAim(target);
    const ctx = this.skillContext(target);
    for (let i = 0; i < 4; i++) {
      if (!this.input.consumePress(`skill${i + 1}` as 'skill1')) continue;
      const err = this.skills.cast(i, ctx);
      if (err && err !== 'busy') p.events.push(err);
    }
    this.skills.update(STEP, ctx);
    p.update(STEP, this.input, this.cam.yaw, target ? target.pos : null);
    if (p.strike) sound.play('swing');
    if (p.strike?.projectile) {
      // Mage bolt from the staff toward the aim point.
      const from = p.pos.clone().add(new THREE.Vector3(0, 1.4, 0)).addScaledVector(p.facingVector(), 0.7);
      const vel = p.aimPoint.clone().sub(from).normalize().multiplyScalar(30);
      this.projectiles.spawn({ kind: 'bolt', from, vel, ...p.strike, life: 1.2 });
    } else if (p.strike) {
      const { hits: enemyHits } = this.enemies.applyStrike(p.strike, p, this.fx);
      const sw = this.adventure.dungeon?.strike(p.pos, p.facingVector(), p.strike.reach ?? TUNING.combat.reach, p.strike.arc ?? TUNING.combat.arc);
      const hits = enemyHits + (sw ? 1 : 0);
      if (hits > 0) {
        const heavy = p.strike.index === p.combo().length - 1;
        this.hitStop = heavy ? TUNING.combat.hitStop.heavy : TUNING.combat.hitStop.light;
        this.cam.addTrauma(heavy ? 0.35 : 0.2);
      }
    }
    this.projectiles.update(STEP, this.enemies, p, this.fx);
    this.enemies.update(STEP, p, this.fx);
    for (const e of this.enemies.collectKills()) {
      this.loot.dropFor(e, p.cls);
      const xp = ENEMY_LOOT[e.kind].xp * (1 + 0.2 * (e.level - e.stats.baseLevel));
      p.gainXp(xpFor(Math.round(xp), e.level, p.level));
      this.onKill?.(e);
    }
    this.loot.update(STEP, p);
    this.adventure.update(STEP);

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

  skillContext(target: Enemy | null = this.lockOn.target): SkillContext {
    const yaw = this.cam.yaw;
    const mx = this.input.moveX;
    const my = this.input.moveY;
    return {
      player: this.player,
      enemies: this.enemies,
      projectiles: this.projectiles,
      world: this.world,
      fx: this.fx,
      target,
      camYaw: yaw,
      wish: new THREE.Vector3(-Math.sin(yaw) * my + Math.cos(yaw) * mx, 0, -Math.cos(yaw) * my - Math.sin(yaw) * mx),
      shake: (a) => this.cam.addTrauma(a),
      faceCamera: () => (this.cam.yaw = this.player.facing),
      hitStop: (f) => (this.hitStop = Math.max(this.hitStop, f)),
    };
  }

  /** Switch between open-air and dungeon lighting, and cull whichever world the player is not in. */
  setInterior(on: boolean): void {
    if (this.interior !== on) {
      this.interior = on;
      const fog = this.scene.fog as THREE.Fog;
      if (on) {
        const dark = new THREE.Color('#0e0b0a');
        this.scene.background = dark;
        fog.color.copy(dark);
        fog.near = 14;
        fog.far = 55;
        this.hemi.color.set('#e8d8c8');
        this.hemi.groundColor.set('#3a2a20');
        this.hemi.intensity = 1.1;
        this.sun.intensity = 1.3;
        this.sun.color.set('#ffd2a0');
      } else {
        this.scene.background = this.sky.color.clone();
        fog.color.copy(this.sky.color);
        fog.near = this.sky.near;
        fog.far = this.sky.far;
        this.hemi.color.set('#cfe8ff');
        this.hemi.groundColor.set('#5a4a36');
        this.hemi.intensity = 1.3;
        this.sun.intensity = 2.2;
        this.sun.color.set('#fff2d6');
      }
    }
    this.world.setOverworldVisible(!on);
    this.scenery.group.visible = !on;
    this.home.group.visible = !on;
    this.adventure.campfires.group.visible = !on;
    this.adventure.chests.group.visible = !on;
    this.adventure.town.group.visible = !on;
    this.adventure.dungeon?.setVisible(on);
  }

  /** Show the class pick screen (new character). */
  showClassSelect(): void {
    this.classSelect.show();
    this.updateMenus();
  }

  /**
   * Title screens own the screen until a character is in play. Only the title panels (`.classpick`,
   * `.settings-panel`) stay visible under the `title` class; the HUD and minimap are hidden.
   */
  setPlaying(on: boolean): void {
    this.playing = on;
    this.hudRoot.classList.toggle('title', !on);
    this.updateMenus();
  }

  updateMenus(): void {
    const a = this.adventure;
    this.menuOpen =
      !this.playing || this.ui.isOpen || this.charUI.isOpen || this.settingsUI.isOpen || this.classSelect.visible ||
      !!a && (a.dialog.isOpen || a.slotSelect.visible || a.startPage.visible) || this.hud.mapOpen;
    if (this.menuOpen) document.exitPointerLock?.();
  }

  /** Start a new character of the given class (class is permanent per character). */
  chooseClass(cls: ClassId): void {
    this.player.setClass(cls);
    this.skills.reset();
    this.trails.reset();
    this.telegraphs.reset();
    this.lockOn.target = null;
  }

  /**
   * Where ranged attacks go: the lock-on target; while aiming, the crosshair (camera ray);
   * otherwise the enemy nearest the centre of view within 20°, or straight ahead.
   */
  private computeAim(target: Enemy | null): void {
    const p = this.player;
    const head = p.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
    if (target) {
      p.aimPoint.copy(target.centre());
      return;
    }
    if (p.aiming) {
      const origin = this.camera.position.clone();
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      for (let d = 1; d <= 40; d += 0.5) {
        const q = origin.clone().addScaledVector(dir, d);
        const hitEnemy = this.enemies.list.find((e) => e.alive && e.centre().distanceTo(q) < e.stats.radius + 0.4);
        if (hitEnemy || (d > 3 && this.world.isSolid(q, 0))) {
          p.aimPoint.copy(hitEnemy ? hitEnemy.centre() : q);
          return;
        }
      }
      p.aimPoint.copy(origin.addScaledVector(dir, 40));
      return;
    }
    const fwd = new THREE.Vector3(-Math.sin(this.cam.yaw), 0, -Math.cos(this.cam.yaw));
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      const to = e.pos.clone().sub(p.pos).setY(0);
      const d = to.length();
      if (d > 25 || d < 0.1) continue;
      const cos = to.dot(fwd) / d;
      if (cos < Math.cos((20 * Math.PI) / 180)) continue;
      const score = d * (2 - cos);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    p.aimPoint.copy(best ? best.centre() : head.addScaledVector(fwd, 25));
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
    this.cam.update(this.player.pos, look, dt, target ? target.centre() : null, this.player.aiming);
    this.model.update(this.player, dt);
    this.trails.update(this.model.getSwingSample(this.player), dt);
    this.enemies.updateModels(dt, this.player.pos);
    this.telegraphs.update(this.enemies.list, this.player.pos);
    this.loot.animate(performance.now() / 1000);
    this.adventure.render(performance.now() / 1000);
    this.map.update();
    const d = this.adventure.dungeon;
    if (d) {
      const inside = d.contains(this.player.pos) || this.camera.position.y > 280;
      this.setInterior(inside);
      if (inside) d.cull(this.player.pos, this.camera);
    }
    if (!this.interior) {
      this.scenery.update(this.player.pos, this.camera);
      this.home.updateOutlines(this.player.pos, this.camera);
    }
    // Keep the shadow area centred on the player.
    const p = this.player.pos;
    this.sun.position.set(p.x + 30, p.y + 60, p.z + 20);
    this.sun.target.position.copy(p);
    this.hud.update(this.player, this.camera, dt, this.input.pointerLocked || this.manual);
    this.playEvents();
    this.hud.updateCombat(this.camera, this.enemies.list, target, this.fx, dt);
    this.hud.updateLoot(this.focus, this.loot.feed, this.player.inv.gold, dt);
    this.loot.feed.length = 0;
    this.ui.update();
    this.charUI.update();
    this.hud.updateClass(this.player, this.skills);
    this.fx.length = 0;
    this.renderer.render(this.scene, this.camera);
  }
}
