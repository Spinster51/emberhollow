import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';
import { RARITY_INFO, lookOf, type Item, type Look } from './items';

const METAL = 0xc9d2dc;
const DARK_METAL = 0x7d8794;
const WOOD = 0x8a5a33;
const LEATHER = 0x7a4f2e;
const GOLD = 0xd9a83b;

/** Toon material with a rarity glow (emissive). Legendary glows strongest. */
export function gearMaterial(color: number, item: Item): THREE.MeshToonMaterial {
  const glow = { common: 0, uncommon: 0.12, rare: 0.18, epic: 0.25, legendary: 0.35 }[item.rarity];
  return toonMaterial(color, { emissive: new THREE.Color(RARITY_INFO[item.rarity].color), emissiveIntensity: glow });
}

function box(w: number, h: number, d: number, mat: THREE.Material, outline = 0.03): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  if (outline > 0) addOutline(m, outline);
  return m;
}

/** Tint by base look so iron and leather pieces read differently. */
const LOOK_COLOR: Record<Look, number> = {
  sword: METAL, greatsword: METAL, woodShield: WOOD, ironShield: DARK_METAL, cap: LEATHER, helm: DARK_METAL,
  tunic: 0x5d7a3a, mail: DARK_METAL, gloves: LEATHER, gauntlets: DARK_METAL, boots: LEATHER, greaves: DARK_METAL,
  ring: GOLD, amulet: GOLD,
};

/**
 * Build a model of the item. Weapons point along -Z with the grip at the origin (they sit in the
 * player's hand that way); everything else is centred.
 */
export function buildItemMesh(item: Item): THREE.Group {
  const g = new THREE.Group();
  const look = lookOf(item);
  const main = gearMaterial(item.unique === 'emberfang' ? 0xe0603a : LOOK_COLOR[look], item);
  const trim = gearMaterial(GOLD, item);
  const grip = toonMaterial(0x4a2e1a);
  switch (look) {
    case 'sword':
    case 'greatsword': {
      const big = look === 'greatsword';
      const blade = box(big ? 0.13 : 0.08, 0.08, big ? 1.5 : 1.0, main);
      blade.position.z = big ? -0.9 : -0.6;
      const guard = box(big ? 0.42 : 0.3, 0.07, 0.07, trim, 0);
      guard.position.z = -0.08;
      const handle = box(0.06, 0.06, big ? 0.3 : 0.18, grip, 0);
      handle.position.z = 0.06;
      g.add(blade, guard, handle);
      break;
    }
    case 'woodShield':
    case 'ironShield': {
      const face = box(0.6, 0.7, 0.08, main);
      const boss = box(0.18, 0.18, 0.08, trim, 0);
      boss.position.z = -0.07;
      g.add(face, boss);
      if (look === 'ironShield') {
        const rim = box(0.66, 0.08, 0.1, trim, 0);
        rim.position.y = 0.33;
        g.add(rim);
      }
      break;
    }
    case 'cap':
    case 'helm': {
      const dome = box(0.48, look === 'helm' ? 0.3 : 0.2, 0.48, main);
      g.add(dome);
      if (look === 'helm') {
        const nose = box(0.06, 0.2, 0.06, trim, 0);
        nose.position.set(0, -0.15, -0.25);
        const crest = box(0.06, 0.12, 0.4, trim, 0);
        crest.position.y = 0.2;
        g.add(nose, crest);
      }
      break;
    }
    case 'tunic':
    case 'mail': {
      const body = box(0.6, 0.7, 0.36, main);
      const belt = box(0.62, 0.08, 0.38, trim, 0);
      belt.position.y = -0.28;
      g.add(body, belt);
      if (look === 'mail') {
        for (const x of [-0.36, 0.36]) {
          const pad = box(0.2, 0.12, 0.38, trim, 0);
          pad.position.set(x, 0.32, 0);
          g.add(pad);
        }
      }
      break;
    }
    case 'gloves':
    case 'gauntlets':
      for (const x of [-0.14, 0.14]) {
        const h = box(0.18, 0.2, 0.18, main);
        h.position.x = x;
        g.add(h);
      }
      break;
    case 'boots':
    case 'greaves':
      for (const x of [-0.14, 0.14]) {
        const b = box(0.2, 0.3, 0.3, main);
        b.position.x = x;
        const toe = box(0.2, 0.12, 0.12, main, 0);
        toe.position.set(x, -0.09, -0.2);
        g.add(b, toe);
      }
      break;
    case 'ring': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.04, 6, 12), main);
      const gem = box(0.08, 0.08, 0.08, gearMaterial(0xff5577, item), 0);
      gem.position.y = 0.16;
      g.add(ring, gem);
      break;
    }
    case 'amulet': {
      const chain = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 4, 16), main);
      const stone = box(0.14, 0.18, 0.06, gearMaterial(item.unique ? 0xff4433 : 0x55c0ff, item), 0);
      stone.position.y = -0.22;
      g.add(chain, stone);
      break;
    }
  }
  return g;
}
