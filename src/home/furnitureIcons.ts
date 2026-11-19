import * as THREE from 'three';
import { buildFurniture } from './furniture';

/**
 * Small pictures of furniture for the carpenter's shop and the furniture crate: the piece (its model once
 * the furniture file has loaded, else the procedural one) rendered once into a render target and kept as
 * a data URL. A picture of the procedural piece is redrawn once the model is there.
 */

export interface FurnitureIcon {
  src: string;
  /** Drawn from the glTF model (not the procedural placeholder). */
  model: boolean;
}

const SIZE = 96;
/** Pieces whose front faces -z turn round to face the camera. */
const TURN: Record<string, number> = { chair: Math.PI, bookshelf: Math.PI };
const VIEW = new THREE.Vector3(0.8, 0.65, 1).normalize();

const cache = new Map<string, FurnitureIcon>();
let stage: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; target: THREE.WebGLRenderTarget; pixels: Uint8Array } | null = null;

/** Linear → sRGB for 8-bit channels (render targets hold linear colour). */
const TO_SRGB = new Uint8Array(256).map((_, i) => {
  const l = i / 255;
  return Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));
});

export function furnitureIcon(renderer: THREE.WebGLRenderer, type: string): FurnitureIcon {
  const hit = cache.get(type);
  if (hit?.model) return hit;
  const piece = buildFurniture(type);
  const model = piece.userData.model === true;
  if (hit && !model) return hit;
  if (!stage) {
    const scene = new THREE.Scene();
    // The game's own light colours (Game.ts), the sun from the front-right.
    scene.add(new THREE.HemisphereLight('#cfe8ff', '#5a4a36', 1.5));
    const sun = new THREE.DirectionalLight('#fff2d6', 2.2);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    const target = new THREE.WebGLRenderTarget(SIZE, SIZE);
    stage = { scene, camera: new THREE.PerspectiveCamera(26, 1, 0.05, 60), target, pixels: new Uint8Array(SIZE * SIZE * 4) };
  }
  const { scene, camera, target, pixels } = stage;
  piece.rotation.y = TURN[type] ?? 0;
  scene.add(piece);
  piece.updateMatrixWorld(true);
  const sphere = new THREE.Box3().setFromObject(piece).getBoundingSphere(new THREE.Sphere());
  const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.02;
  camera.position.copy(sphere.center).addScaledVector(VIEW, dist);
  camera.lookAt(sphere.center);

  const prevTarget = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevReset = renderer.info.autoReset;
  renderer.info.autoReset = false;
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.info.autoReset = prevReset;
  scene.remove(piece);

  // Rows come bottom-up; colour is linear.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const s = ((SIZE - 1 - y) * SIZE + x) * 4;
      const d = (y * SIZE + x) * 4;
      img.data[d] = TO_SRGB[pixels[s]];
      img.data[d + 1] = TO_SRGB[pixels[s + 1]];
      img.data[d + 2] = TO_SRGB[pixels[s + 2]];
      img.data[d + 3] = pixels[s + 3];
    }
  }
  ctx.putImageData(img, 0, 0);
  const icon = { src: canvas.toDataURL('image/png'), model };
  cache.set(type, icon);
  return icon;
}
