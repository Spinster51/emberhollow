import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';
import { cloneNode, loadModel, modelState } from '../core/models';
import { ITEM_ART, ITEM_FILE, type ItemArt } from '../art/assets';
import { RARITY_INFO, lookOf, type Item, type Look, type Rarity } from './items';

const METAL = 0xc9d2dc;
const DARK_METAL = 0x7d8794;
const WOOD = 0x8a5a33;
const LEATHER = 0x7a4f2e;
const GOLD = 0xd9a83b;

/** Rarity glow (emissive intensity). Legendary glows strongest. */
const GLOW: Record<Rarity, number> = { common: 0, uncommon: 0.12, rare: 0.18, epic: 0.25, legendary: 0.35 };
/** Uniques with a glow colour of their own shine a little brighter than the legendary orange. */
const UNIQUE_GLOW = 0.4;
/**
 * Textured models keep their detail under a weaker glow than the flat procedural boxes: the rarity
 * still reads (green, blue, purple, orange), the colours and parts still show.
 */
const MODEL_GLOW = 0.75;

/** Toon material with a rarity glow (emissive). Legendary glows strongest. */
export function gearMaterial(color: number, item: Item): THREE.MeshToonMaterial {
  return toonMaterial(color, { emissive: new THREE.Color(RARITY_INFO[item.rarity].color), emissiveIntensity: GLOW[item.rarity] });
}

// ---------------------------------------------------------------- models (milestone 8)

/**
 * Outline thickness per node of the items file, in its own units. The pack props are in pack units
 * (0.04 → 0.03 m, as the characters); worn pieces and jewellery are modelled in metres, the jewellery small.
 */
const ITEM_OUTLINE: Record<string, number> = {
  Ring: 0.012, Amulet: 0.012, Tunic: 0.03, Mail: 0.03, Gloves: 0.022, Gauntlets: 0.022, Boots: 0.025, Greaves: 0.025,
};

/** Load a file that holds item models (the items file gets its own outline widths). */
export function loadItemFile(file: string): Promise<unknown> {
  return loadModel(file, file === ITEM_FILE ? { outline: (m) => ITEM_OUTLINE[m.name] ?? 0.04 } : {});
}

/** Start loading every file the items use (the game never waits on them). */
export function preloadItemModels(): void {
  const files = new Set([ITEM_ART.looks, ITEM_ART.bases, ITEM_ART.uniques].flatMap((m) => Object.values(m).map((a) => a.file)));
  for (const f of files) void loadItemFile(f).catch(() => {});
}

/** The model an item shows: its unique's, else its base's, else its look's. */
export function itemArt(item: Item): ItemArt {
  return (item.unique && ITEM_ART.uniques[item.unique]) || ITEM_ART.bases[item.base] || ITEM_ART.looks[lookOf(item)];
}

/**
 * The loaded file's material with the item's tint and glow: one shared material per (source material,
 * rarity, tint, glow), so every copy on the ground, on racks and in hand draws with the same few
 * materials. Common, untinted items use the file's own.
 */
const itemMats = new Map<string, THREE.Material>();
export function itemMaterial(src: THREE.Material, rarity: Rarity, tint?: number, glow?: number): THREE.Material {
  const level = (glow !== undefined ? Math.max(UNIQUE_GLOW, GLOW[rarity]) : GLOW[rarity]) * MODEL_GLOW;
  if (level === 0 && tint === undefined) return src;
  const key = `${src.uuid}|${rarity}|${tint ?? ''}|${glow ?? ''}`;
  let m = itemMats.get(key);
  if (!m) {
    const t = (src as THREE.MeshToonMaterial).clone();
    if (tint !== undefined) t.color.multiply(new THREE.Color(tint));
    t.emissive.set(glow ?? RARITY_INFO[rarity].color);
    t.emissiveIntensity = level;
    t.name = `${src.name}:${rarity}`;
    itemMats.set(key, t);
    m = t;
  }
  return m;
}

/** Give a fresh copy of a file's node the item's look (outlines keep their own material). */
export function applyItemLook(root: THREE.Object3D, item: Item, art?: Pick<ItemArt, 'tint' | 'glow'>): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name.endsWith('_outline')) return;
    mesh.material = itemMaterial(mesh.material as THREE.Material, item.rarity, art?.tint, art?.glow);
  });
}

/** The item's model in item space (shares the file's geometry), or null if its file is not ready. */
export function itemModel(item: Item, art: ItemArt = itemArt(item)): THREE.Object3D | null {
  const node = cloneNode(art.file, art.node);
  if (!node) return null;
  applyItemLook(node, item, art);
  const g = new THREE.Group();
  g.name = `item:${art.node}`;
  g.position.set(...art.pos);
  g.rotation.set(...art.rot);
  g.scale.setScalar(art.scale);
  g.add(node);
  return g;
}

/**
 * A group that shows `fallback()` until `file` has loaded, then `model()` in its place; it keeps the
 * fallback if the file fails (or `model()` gives null). `userData.model` says which is shown. The
 * fallback (a procedural piece: its own geometry and toon materials) is freed when the model replaces it.
 * `load` fetches the file (furniture passes its own, for its outline widths).
 */
export function lazyModel(
  file: string,
  model: () => THREE.Object3D | null,
  fallback: () => THREE.Object3D,
  load: (file: string) => Promise<unknown> = loadItemFile,
): THREE.Group {
  const g = new THREE.Group();
  const show = (o: THREE.Object3D, isModel: boolean) => {
    g.clear();
    g.add(o);
    g.userData.model = isModel;
  };
  const state = modelState(file);
  const m = state === 'ready' ? model() : null;
  if (m) {
    show(m, true);
    return g;
  }
  const placeholder = fallback();
  show(placeholder, false);
  if (state === 'none' || state === 'loading') {
    load(file).then(
      () => {
        const late = model();
        if (!late) return;
        show(late, true);
        disposeProcedural(placeholder);
      },
      () => {},
    );
  }
  return g;
}

/** Free a procedural item's geometry and toon materials (outlines share the parent's geometry and one basic material). */
function disposeProcedural(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material;
    if ((mat as THREE.MeshToonMaterial).isMeshToonMaterial) mat.dispose();
  });
}

/**
 * Build a model of the item. Weapons point along -Z with the grip at the origin (they sit in the
 * player's hand that way); everything else is centred. Shows the item's glTF model (ITEM_ART) once
 * its file has loaded, the procedural one until then or if the file fails. `art` can be swapped by tests.
 */
export function buildItemMesh(item: Item, art: ItemArt = itemArt(item)): THREE.Group {
  const g = lazyModel(art.file, () => itemModel(item, art), () => buildProceduralItem(item));
  g.userData.node = art.node;
  return g;
}

// ---------------------------------------------------------------- procedural placeholders

function box(w: number, h: number, d: number, mat: THREE.Material, outline = 0.03): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  if (outline > 0) addOutline(m, outline);
  return m;
}

/** Tint by base look so iron and leather pieces read differently. */
const LOOK_COLOR: Record<Look, number> = {
  sword: METAL, greatsword: METAL, mace: DARK_METAL, staff: WOOD, daggers: METAL, tome: 0x6a2f6a, parryDagger: METAL, woodShield: WOOD, ironShield: DARK_METAL, cap: LEATHER, helm: DARK_METAL,
  tunic: 0x5d7a3a, mail: DARK_METAL, gloves: LEATHER, gauntlets: DARK_METAL, boots: LEATHER, greaves: DARK_METAL,
  ring: GOLD, amulet: GOLD,
};

/** The placeholder model built from boxes (shown while a file loads, and for good if it fails). */
export function buildProceduralItem(item: Item): THREE.Group {
  const g = new THREE.Group();
  g.name = 'item:procedural';
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
    case 'mace': {
      const handle = box(0.07, 0.07, 0.8, grip, 0);
      handle.position.z = -0.3;
      const head = box(0.26, 0.26, 0.3, main);
      head.position.z = -0.75;
      const flange = box(0.36, 0.08, 0.2, trim, 0);
      flange.position.z = -0.75;
      g.add(handle, head, flange);
      break;
    }
    case 'staff': {
      const pole = box(0.07, 0.07, 1.7, main);
      pole.position.z = -0.45;
      const gem = box(0.18, 0.18, 0.18, gearMaterial(item.unique ? 0xff5a2a : 0x7fd7ff, item), 0.02);
      gem.position.z = -1.35;
      gem.rotation.z = Math.PI / 4;
      const cradle = box(0.22, 0.05, 0.08, trim, 0);
      cradle.position.z = -1.22;
      g.add(pole, gem, cradle);
      break;
    }
    case 'daggers':
    case 'parryDagger': {
      const blade = box(0.06, 0.05, 0.45, main);
      blade.position.z = -0.3;
      const guard = box(look === 'parryDagger' ? 0.3 : 0.16, 0.05, 0.05, trim, 0);
      guard.position.z = -0.06;
      g.add(blade, guard);
      break;
    }
    case 'tome': {
      // Two covers and a spine (0.4 × 0.5 × 0.12 m, spine at -X, front cover -Z) round a block of pages
      // that sits inside them: inset at the edges, exactly as thick as the gap between the covers.
      const cover = 0.025;
      for (const z of [-1, 1]) {
        const c = box(0.4, 0.5, cover, main, 0.02);
        c.name = 'tome_cover';
        c.position.z = z * (0.06 - cover / 2);
        g.add(c);
      }
      const spine = box(cover, 0.5, 0.12, main, 0);
      spine.name = 'tome_cover';
      spine.position.x = -0.2 + cover / 2;
      const pages = box(0.36, 0.46, 0.12 - 2 * cover, toonMaterial(0xefe3c4), 0);
      pages.name = 'tome_pages';
      pages.position.x = 0.005;
      const clasp = box(0.06, 0.12, 0.13, trim, 0);
      clasp.position.x = 0.2;
      g.add(spine, pages, clasp);
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
