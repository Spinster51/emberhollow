import * as THREE from 'three';
import { Input, type VirtualInput } from './core/Input';
import { World } from './world/World';
import { Player } from './player/Player';
import { PlayerModel } from './player/PlayerModel';
import { ThirdPersonCamera } from './camera/ThirdPersonCamera';
import { Hud } from './ui/Hud';

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
    this.cam = new ThirdPersonCamera(this.camera, this.world);
    this.hud = new Hud(hudRoot, (s) => this.setPixelScale(s), this.pixelScale);

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
    this.input.update();
    this.player.update(STEP, this.input, this.cam.yaw);
    this.input.endStep();
  }

  /** Test hook: run `frames` fixed steps with the given virtual input. */
  step(frames: number, v: VirtualInput | null = null, draw = false): void {
    this.input.setVirtual(v ?? {});
    for (let i = 0; i < frames; i++) this.simulate();
    this.input.setVirtual(null);
    if (draw) this.render(STEP);
  }

  private render(dt: number): void {
    this.cam.update(this.player.pos, this.input.takeLook(), dt);
    this.model.update(this.player, dt);
    // Keep the shadow area centred on the player.
    const p = this.player.pos;
    this.sun.position.set(p.x + 30, p.y + 60, p.z + 20);
    this.sun.target.position.copy(p);
    this.hud.update(this.player, this.camera, dt, this.input.pointerLocked || this.manual);
    this.renderer.render(this.scene, this.camera);
  }
}
