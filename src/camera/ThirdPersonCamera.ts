import * as THREE from 'three';
import type { World } from '../world/World';

/** Orbit camera behind the player, kept above the terrain. */
export class ThirdPersonCamera {
  yaw = 0;
  pitch = 0.32;
  distance = 6.5;
  private smoothTarget = new THREE.Vector3();
  private initialised = false;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private world: World,
  ) {}

  update(target: THREE.Vector3, look: { dx: number; dy: number; zoom: number }, dt: number): void {
    const sens = 0.0026;
    this.yaw -= look.dx * sens;
    this.pitch = Math.max(-0.35, Math.min(1.25, this.pitch + look.dy * sens));
    this.distance = Math.max(3, Math.min(12, this.distance + look.zoom * 0.6));

    const focus = target.clone().add(new THREE.Vector3(0, 1.55, 0));
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
  }
}
