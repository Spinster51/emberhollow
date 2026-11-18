import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';
import type { Player } from './Player';

/**
 * Placeholder blocky adventurer with procedural animation. Replaced by the rigged
 * Quaternius character in a later milestone; the state-driven poses stay the same.
 */
export class PlayerModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head: THREE.Mesh;
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private glider = new THREE.Group();
  private phase = 0;
  private gliderOpen = 0;

  constructor() {
    const skin = toonMaterial(0xf0c39a);
    const tunic = toonMaterial(0x3f6fb5);
    const belt = toonMaterial(0x5b3a20);
    const pants = toonMaterial(0x4a3b2c);
    const hair = toonMaterial(0xb5582e);

    const box = (w: number, h: number, d: number, mat: THREE.Material, outline = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.castShadow = true;
      if (outline) addOutline(m);
      return m;
    };

    this.root.add(this.body);
    this.body.position.y = 0.95;

    const torso = box(0.55, 0.65, 0.32, tunic);
    torso.position.y = 0.2;
    this.body.add(torso);
    const beltM = box(0.58, 0.1, 0.35, belt, false);
    beltM.position.y = -0.08;
    this.body.add(beltM);

    this.head = box(0.42, 0.42, 0.42, skin);
    this.head.position.y = 0.75;
    this.body.add(this.head);
    const hairM = box(0.46, 0.16, 0.46, hair, false);
    hairM.position.y = 0.2;
    this.head.add(hairM);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1010 });
    for (const x of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), eyeMat);
      eye.position.set(x, 0.02, -0.215);
      this.head.add(eye);
    }

    const limb = (group: THREE.Group, x: number, y: number, len: number, w: number, mat: THREE.Material) => {
      group.position.set(x, y, 0);
      const m = box(w, len, w, mat);
      m.position.y = -len / 2;
      group.add(m);
      this.body.add(group);
    };
    limb(this.armL, -0.36, 0.45, 0.6, 0.17, tunic);
    limb(this.armR, 0.36, 0.45, 0.6, 0.17, tunic);
    limb(this.legL, -0.14, -0.12, 0.8, 0.2, pants);
    limb(this.legR, 0.14, -0.12, 0.8, 0.2, pants);

    // Glider: a cloth wing on two poles, held above the head.
    const cloth = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.05, 1.0),
      toonMaterial(0xc9473a, { side: THREE.DoubleSide }),
    );
    cloth.castShadow = true;
    addOutline(cloth, 0.04);
    cloth.position.y = 1.15;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.06, 0.18), toonMaterial(0xf2d16b));
    stripe.position.y = 1.15;
    this.glider.add(cloth, stripe);
    for (const x of [-0.35, 0.35]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 5), belt);
      pole.position.set(x, 0.8, 0);
      pole.rotation.z = x > 0 ? -0.3 : 0.3;
      this.glider.add(pole);
    }
    this.glider.position.y = 0.6;
    this.glider.visible = false;
    this.body.add(this.glider);
  }

  update(p: Player, dt: number): void {
    this.root.position.copy(p.pos);
    this.root.rotation.set(0, p.facing, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0.95, 0);

    const hSpeed = Math.hypot(p.vel.x, p.vel.z);
    let armL = 0;
    let armR = 0;
    let legL = 0;
    let legR = 0;
    let armSpreadL = 0;
    let armSpreadR = 0;
    const t = performance.now() / 1000;

    this.gliderOpen += ((p.state === 'glide' ? 1 : 0) - this.gliderOpen) * Math.min(1, dt * 10);
    this.glider.visible = this.gliderOpen > 0.05;
    this.glider.scale.setScalar(Math.max(0.05, this.gliderOpen));

    switch (p.state) {
      case 'ground': {
        if (hSpeed > 0.3) {
          this.phase += dt * hSpeed * 2.2;
          const s = Math.sin(this.phase) * Math.min(1, hSpeed / 5) * (p.sprinting ? 1.1 : 0.8);
          legL = s;
          legR = -s;
          armL = -s * 0.9;
          armR = s * 0.9;
          this.body.position.y += Math.abs(Math.cos(this.phase)) * 0.06;
          this.body.rotation.x = p.sprinting ? -0.2 : -0.06;
        } else {
          this.body.position.y += Math.sin(t * 2) * 0.012;
          armSpreadL = 0.06;
          armSpreadR = -0.06;
        }
        break;
      }
      case 'air':
        legL = 0.5;
        legR = -0.2;
        armL = -2.4;
        armR = -2.4;
        armSpreadL = 0.4;
        armSpreadR = -0.4;
        if (p.vel.y > 0) {
          armL = -1.2;
          armR = 0.6;
        }
        break;
      case 'roll': {
        const k = Math.min(1, p.stateTime / 0.41);
        this.body.position.y = 0.55;
        this.body.rotation.x = -k * Math.PI * 2;
        legL = legR = 1.3;
        armL = armR = 1.0;
        break;
      }
      case 'climb':
      case 'climbJump': {
        const move = Math.hypot(p.climbMove.x, p.climbMove.y);
        if (move > 0.05) this.phase += dt * 6 * move;
        const s = Math.sin(this.phase);
        armL = -2.6 + s * 0.45;
        armR = -2.6 - s * 0.45;
        legL = 0.5 - s * 0.45;
        legR = 0.5 + s * 0.45;
        this.body.rotation.x = 0.12;
        if (p.state === 'climbJump') {
          armL = armR = -3.0;
          legL = legR = 0.2;
        }
        break;
      }
      case 'mantle':
        armL = armR = -2.0;
        legL = 1.2;
        legR = 0.4;
        this.body.rotation.x = -0.35;
        break;
      case 'glide':
        armL = armR = -2.9;
        armSpreadL = 0.25;
        armSpreadR = -0.25;
        legL = 0.15 + Math.sin(t * 3) * 0.1;
        legR = 0.1 - Math.sin(t * 3) * 0.1;
        this.body.rotation.x = -0.25;
        // Bank into turns.
        this.body.rotation.z = Math.max(-0.4, Math.min(0.4, -this.turnRate(p, dt) * 0.25));
        break;
    }

    const lerp = Math.min(1, dt * 18);
    this.armL.rotation.x += (armL - this.armL.rotation.x) * lerp;
    this.armR.rotation.x += (armR - this.armR.rotation.x) * lerp;
    this.legL.rotation.x += (legL - this.legL.rotation.x) * lerp;
    this.legR.rotation.x += (legR - this.legR.rotation.x) * lerp;
    this.armL.rotation.z += (armSpreadL - this.armL.rotation.z) * lerp;
    this.armR.rotation.z += (armSpreadR - this.armR.rotation.z) * lerp;
  }

  private lastFacing = 0;
  private smoothedTurn = 0;
  private turnRate(p: Player, dt: number): number {
    let d = p.facing - this.lastFacing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.lastFacing = p.facing;
    this.smoothedTurn += (d / Math.max(dt, 1e-4) - this.smoothedTurn) * Math.min(1, dt * 5);
    return this.smoothedTurn;
  }
}
