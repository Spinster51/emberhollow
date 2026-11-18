// Keyboard, mouse (pointer lock) and gamepad input, merged into one set of actions.
// Tests can drive the game through `setVirtual`, which bypasses real devices.

export type Action = 'jump' | 'dodge' | 'interact' | 'attack' | 'block' | 'lockOn';

const KEY_ACTIONS: Record<string, Action> = {
  Space: 'jump',
  ShiftLeft: 'dodge',
  ShiftRight: 'dodge',
  KeyE: 'interact',
  Tab: 'lockOn',
  Mouse0: 'attack',
  Mouse1: 'lockOn',
  Mouse2: 'block',
};

// Standard gamepad: A jump, B dodge, X attack, Y interact, LT lock-on, RT/RB block.
const PAD_ACTIONS: Record<number, Action> = { 0: 'jump', 1: 'dodge', 2: 'attack', 3: 'interact', 5: 'block', 6: 'lockOn', 7: 'block' };

export interface VirtualInput {
  moveX?: number;
  moveY?: number;
  held?: Action[];
}

export class Input {
  private keys = new Set<string>();
  private held = new Set<Action>();
  private prevHeld = new Set<Action>();
  private pressedEdges = new Set<Action>();
  private virtual: VirtualInput | null = null;

  /** Accumulated mouse movement since the camera last read it. */
  lookDX = 0;
  lookDY = 0;
  zoomDelta = 0;
  moveX = 0;
  /** Positive = forward. */
  moveY = 0;
  pointerLocked = false;
  /** Menus open: report no movement or actions. */
  suppressed = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    // The first click only captures the mouse; once captured, buttons are game actions.
    canvas.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) {
        if (!this.suppressed) canvas.requestPointerLock?.();
        return;
      }
      e.preventDefault();
      this.keys.add(`Mouse${e.button}`);
    });
    window.addEventListener('mouseup', (e) => this.keys.delete(`Mouse${e.button}`));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        this.zoomDelta += Math.sign(e.deltaY);
      },
      { passive: true },
    );
  }

  setVirtual(v: VirtualInput | null): void {
    this.virtual = v;
  }

  /** Poll devices once per fixed simulation step. */
  update(): void {
    this.prevHeld = this.held;
    this.held = new Set();
    let mx = 0;
    let my = 0;

    if (this.suppressed && !this.virtual) {
      // Nothing held while a menu is open.
    } else if (this.virtual) {
      mx = this.virtual.moveX ?? 0;
      my = this.virtual.moveY ?? 0;
      for (const a of this.virtual.held ?? []) this.held.add(a);
    } else {
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
      for (const k of this.keys) {
        const a = KEY_ACTIONS[k];
        if (a) this.held.add(a);
      }
      this.pollGamepad((x, y) => {
        mx += x;
        my += y;
      });
    }

    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.moveX = mx;
    this.moveY = my;

    for (const a of this.held) if (!this.prevHeld.has(a)) this.pressedEdges.add(a);
  }

  private pollGamepad(addMove: (x: number, y: number) => void): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads.find((p) => p && p.connected);
    if (!pad) return;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    addMove(dz(pad.axes[0] ?? 0), -dz(pad.axes[1] ?? 0));
    this.lookDX += dz(pad.axes[2] ?? 0) * 12;
    this.lookDY += dz(pad.axes[3] ?? 0) * 8;
    for (const [idx, action] of Object.entries(PAD_ACTIONS)) {
      if (pad.buttons[Number(idx)]?.pressed) {
        this.held.add(action);
      }
    }
  }

  isHeld(a: Action): boolean {
    return this.held.has(a);
  }

  /** True once per press; consumed when read. */
  consumePress(a: Action): boolean {
    if (!this.pressedEdges.has(a)) return false;
    this.pressedEdges.delete(a);
    return true;
  }

  /** Called after each simulation step so unread presses do not linger. */
  endStep(): void {
    this.pressedEdges.clear();
  }

  takeLook(): { dx: number; dy: number; zoom: number } {
    const r = { dx: this.lookDX, dy: this.lookDY, zoom: this.zoomDelta };
    this.lookDX = 0;
    this.lookDY = 0;
    this.zoomDelta = 0;
    return r;
  }

  hasKey(code: string): boolean {
    return this.keys.has(code);
  }
}
