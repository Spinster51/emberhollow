import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';
import { cloneNode, loadModel } from '../core/models';
import { lazyModel } from '../items/ItemMesh';
import { FIXTURE_ART, FURNITURE_ART, FURNITURE_FILE, FURNITURE_OUTLINE, type FixtureKind } from '../art/assets';

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

// ---------------------------------------------------------------- models (milestone 8)

/** Load a file of furniture models (the game never waits on it; the first caller's outline widths apply). */
export function loadFurnitureFile(file: string): Promise<unknown> {
  return loadModel(file, { outline: (m) => FURNITURE_OUTLINE[m.name] ?? 0.03 });
}

/**
 * A copy of a piece's node (shares the file's geometry and materials), or null if its file is not ready.
 * Furniture always stands under the house's roof, which already shades the whole floor from the sun, so
 * it casts no sun shadow (that pass would only cost draw calls).
 */
function pieceModel(file: string, node: string): THREE.Object3D | null {
  const n = cloneNode(file, node);
  if (!n) return null;
  n.traverse((o) => (o.castShadow = false));
  const g = new THREE.Group();
  g.name = `furniture:${node}`;
  g.add(n);
  return g;
}

/**
 * Build a furniture model; the origin is on the floor at its centre. Shows the piece's glTF model once
 * the furniture file has loaded, the procedural one until then or if the file fails (`userData.model`).
 * `file` can be swapped by tests.
 */
export function buildFurniture(type: string, file = FURNITURE_FILE): THREE.Group {
  const node = FURNITURE_ART[type];
  const g = lazyModel(file, () => (node ? pieceModel(file, node) : null), () => buildProceduralFurniture(type), loadFurnitureFile);
  g.userData.node = node;
  return g;
}

/**
 * Build a home fixture (chest, weapon mount, armour stand, trinket table, lectern and book, bed, crate,
 * workbench) with its origin at the fixture's anchor on the floor (a mount's on the wall face). Same
 * model-or-procedural swap as buildFurniture.
 */
export function buildFixture(kind: FixtureKind, file = FURNITURE_FILE): THREE.Group {
  const node = FIXTURE_ART[kind];
  const g = lazyModel(file, () => pieceModel(file, node), () => buildProceduralFixture(kind), loadFurnitureFile);
  g.userData.node = node;
  return g;
}

// ---------------------------------------------------------------- procedural placeholders

const WOOD = 0x8a5a33;
const DARK = 0x5b3a20;
const PLANK = 0x9a6b42;

function box(g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, outline = true): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  if (outline) addOutline(m, 0.03);
  g.add(m);
  return m;
}

/** The placeholder furniture built from boxes (shown while the file loads, and for good if it fails). */
export function buildProceduralFurniture(type: string): THREE.Group {
  const g = new THREE.Group();
  g.name = 'furniture:procedural';
  const wood = () => toonMaterial(WOOD);
  const dark = () => toonMaterial(DARK);
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

/** The placeholder fixtures built from boxes (as the home had them before its models), origin at the anchor. */
export function buildProceduralFixture(kind: FixtureKind): THREE.Group {
  const g = new THREE.Group();
  g.name = 'furniture:procedural';
  const beam = () => toonMaterial(DARK);
  switch (kind) {
    case 'chest': {
      const body = box(g, 1.1, 0.7, 0.7, 0, 0.35, 0, toonMaterial(0x7a4a26), false);
      body.receiveShadow = true;
      box(g, 1.16, 0.12, 0.76, 0, 0.72, 0, toonMaterial(0xc9a13b)).castShadow = false;
      break;
    }
    case 'mount':
      box(g, 1.2, 0.5, 0.08, 0, 1.9, 0.04, beam(), false).castShadow = false;
      break;
    case 'stand': {
      const m = beam();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 6), m);
      pole.position.y = 0.85;
      g.add(pole);
      box(g, 0.08, 0.08, 0.8, 0, 1.35, 0, m, false).castShadow = false;
      box(g, 0.6, 0.08, 0.6, 0, 0.04, 0, m, false).castShadow = false;
      break;
    }
    case 'trinketTable':
      box(g, 1.0, 0.1, 0.7, 0, 0.8, 0, toonMaterial(PLANK)).castShadow = false;
      box(g, 0.12, 0.8, 0.12, 0, 0.4, 0, beam(), false).castShadow = false;
      break;
    case 'lectern': {
      box(g, 0.5, 1.0, 0.5, 0, 0.5, 0, beam(), false).castShadow = false;
      const book = box(g, 0.5, 0.1, 0.4, 0, 1.05, 0, toonMaterial(0x4a6fb0, { emissive: 0x2a4a90, emissiveIntensity: 0.4 }));
      book.rotation.z = 0.25;
      book.castShadow = false;
      break;
    }
    case 'bed':
      box(g, 1.3, 0.4, 2.2, 0, 0.2, 0, beam());
      box(g, 1.2, 0.18, 1.6, 0, 0.48, 0.25, toonMaterial(0x3f6fb5));
      box(g, 0.9, 0.16, 0.4, 0, 0.48, -0.8, toonMaterial(0xf2ead2));
      break;
    case 'crate':
      box(g, 0.7, 0.6, 0.7, 0, 0.3, 0, toonMaterial(0xb08a5a)).castShadow = false;
      break;
    case 'workbench':
      box(g, 1.6, 0.9, 0.8, 0, 0.45, 0, beam());
      box(g, 0.7, 0.3, 0.5, 0, 1.05, 0, toonMaterial(0x5a5f6b, { emissive: 0xff6a20, emissiveIntensity: 0.25 }));
      break;
  }
  return g;
}
