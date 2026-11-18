import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';

/** Furniture sold by the carpenter (decorative; placed freely inside your home). */
export const FURNITURE: Record<string, { name: string; price: number }> = {
  table: { name: 'Oak Table', price: 40 },
  chair: { name: 'Chair', price: 20 },
  bookshelf: { name: 'Bookshelf', price: 60 },
  rug: { name: 'Woven Rug', price: 30 },
  plant: { name: 'Potted Fern', price: 25 },
  lantern: { name: 'Standing Lantern', price: 35 },
  banner: { name: 'Ember Banner', price: 45 },
  barrel: { name: 'Barrel', price: 15 },
};

const wood = () => toonMaterial(0x8a5a33);
const dark = () => toonMaterial(0x5b3a20);

function box(g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, outline = true): void {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  if (outline) addOutline(m, 0.03);
  g.add(m);
}

/** Build a furniture model; the origin is on the floor at its centre. */
export function buildFurniture(type: string): THREE.Group {
  const g = new THREE.Group();
  switch (type) {
    case 'table':
      box(g, 1.4, 0.1, 0.9, 0, 0.78, 0, wood());
      for (const [x, z] of [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]]) box(g, 0.1, 0.75, 0.1, x, 0.37, z, dark(), false);
      break;
    case 'chair':
      box(g, 0.5, 0.08, 0.5, 0, 0.45, 0, wood());
      box(g, 0.5, 0.55, 0.08, 0, 0.75, 0.21, wood());
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) box(g, 0.07, 0.45, 0.07, x, 0.22, z, dark(), false);
      break;
    case 'bookshelf': {
      box(g, 1.2, 2.0, 0.4, 0, 1.0, 0, dark());
      const colours = [0xa8322c, 0x3f6fb5, 0x4d7f36, 0xc9a13b, 0x6a45a8];
      for (let shelf = 0; shelf < 3; shelf++) {
        for (let i = 0; i < 5; i++) {
          box(g, 0.16, 0.42, 0.3, -0.42 + i * 0.21, 0.35 + shelf * 0.6, -0.04, toonMaterial(colours[(i + shelf) % 5]), false);
        }
      }
      break;
    }
    case 'rug':
      box(g, 2.2, 0.03, 1.4, 0, 0.02, 0, toonMaterial(0xa8432f), false);
      box(g, 1.8, 0.035, 1.0, 0, 0.025, 0, toonMaterial(0xd9a83b), false);
      break;
    case 'plant':
      box(g, 0.45, 0.45, 0.45, 0, 0.22, 0, toonMaterial(0xb06a3a));
      for (let i = 0; i < 3; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.35 - i * 0.08, 0.5, 6), toonMaterial(0x3f8a3a));
        leaf.position.y = 0.65 + i * 0.25;
        g.add(leaf);
      }
      break;
    case 'lantern':
      box(g, 0.1, 1.6, 0.1, 0, 0.8, 0, dark(), false);
      box(g, 0.4, 0.06, 0.4, 0, 0.03, 0, dark(), false);
      box(g, 0.3, 0.35, 0.3, 0, 1.75, 0, new THREE.MeshBasicMaterial({ color: 0xffd27a }), false);
      break;
    case 'banner':
      box(g, 0.08, 2.2, 0.08, 0, 1.1, 0, dark(), false);
      box(g, 0.9, 1.2, 0.04, 0, 1.4, 0.06, toonMaterial(0xa8322c));
      box(g, 0.3, 0.3, 0.05, 0, 1.5, 0.09, toonMaterial(0xffa63a), false);
      break;
    case 'barrel': {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 10), wood());
      b.position.y = 0.45;
      b.castShadow = true;
      addOutline(b, 0.03);
      g.add(b);
      break;
    }
  }
  return g;
}
