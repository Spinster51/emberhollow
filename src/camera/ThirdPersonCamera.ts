import * as THREE from 'three';
import type { World } from '../world/World';

/**
 * Orbit camera behind the player, kept above the terrain. With a lock-on target it swings
 * round to keep player and target in view. `addTrauma` shakes it (shake = trauma²).
 */
export class ThirdPersonCamera {
  yaw = 0;
  pitch = 0.32;
  distance = 6.5;
  private smoothTarget = new THREE.Vector3();
  private initialised = false;
  private trauma = 0;
  private shoulder = 0;
  private shakeTime = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private world: World,
  ) {}

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Swing the yaw so the camera sits behind the player, facing the lock-on target. */
  followLock(player: THREE.Vector3, lock: THREE.Vector3, dt: number): void {
    const dx = player.x - lock.x;
    const dz = player.z - lock.z;
    if (Math.hypot(dx, dz) < 0.5) return;
    const want = Math.atan2(dx, dz);
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-8 * dt));
    this.pitch += (0.3 - this.pitch) * (1 - Math.exp(-3 * dt));
  }

  update(
    target: THREE.Vector3,
    look: { dx: number; dy: number; zoom: number },
    dt: number,
    lock: THREE.Vector3 | null = null,
  ): void {
    const sens = 0.0026;
    // While locked, the yaw is driven by followLock (called from the fixed simulation step).
    if (!lock) this.yaw -= look.dx * sens;
    this.pitch = Math.max(-0.35, Math.min(1.25, this.pitch + (lock ? 0 : look.dy * sens)));
    this.distance = Math.max(3, Math.min(12, this.distance + look.zoom * 0.6));

    const focus = target.clone().add(new THREE.Vector3(0, 1.55, 0));
    // Locked on: move over the right shoulder (so the player does not hide the target) and look
    // a little toward the target so both stay on screen.
    this.shoulder += ((lock ? 1 : 0) - this.shoulder) * (1 - Math.exp(-6 * dt));
    focus.x += Math.cos(this.yaw) * 0.9 * this.shoulder;
    focus.z += -Math.sin(this.yaw) * 0.9 * this.shoulder;
    if (lock) {
      const toward = lock.clone().sub(focus).multiplyScalar(0.25);
      toward.clampLength(0, 2.5);
      focus.add(toward);
    }
    if (!this.initialised) {
      this.smoothTarget.copy(focus);
      this.initialised = true;
    }
    this.smoothTarget.lerp(focus, 1 - Math.exp(-14 * dt));

    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );

    // Pull in if terrain or a block is between the player and the camera.
    let dist = this.distance;
    for (let i = 1; i <= 24; i++) {
      const d = (this.distance * i) / 24;
      const p = this.smoothTarget.clone().addScaledVector(dir, d);
      if (this.world.isSolid(p, 0.35)) {
        dist = Math.max(0.6, d - this.distance / 24);
        break;
      }
    }
    const pos = this.smoothTarget.clone().addScaledVector(dir, dist);
    const floor = this.world.heightAt(pos.x, pos.z) + 0.4;
    if (pos.y < floor) pos.y = floor;
    this.camera.position.copy(pos);
    this.camera.lookAt(this.smoothTarget);

    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    if (this.trauma > 0) {
      this.shakeTime += dt * 30;
      const s = this.trauma * this.trauma;
      const n = (k: number) => Math.sin(this.shakeTime * (1 + k * 0.37) + k * 12.9) * Math.sin(this.shakeTime * 0.61 + k);
      this.camera.position.add(new THREE.Vector3(n(1), n(2), n(3)).multiplyScalar(s * 0.35));
      this.camera.rotation.z += n(4) * s * 0.05;
    }
  }
}
