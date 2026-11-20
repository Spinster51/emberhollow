// World layouts: the small test map (automated tests) and the main 600 m map.

import * as THREE from 'three';
import { fbm, smoothstep } from '../core/noise';
import type { EnemyKind } from '../config';

export type RegionId = 'town' | 'meadow' | 'forest' | 'ruins' | 'test' | 'dungeon';

export interface Region {
  id: RegionId;
  name: string;
  /** Enemy level here (fixed per place, no scaling with the player). */
  level: number;
}

export interface CampSpec {
  kind: EnemyKind;
  x: number;
  z: number;
  level?: number;
}

export interface CampfireSpec {
  id: string;
  name: string;
  x: number;
  z: number;
}

export interface ChestSpec {
  id: string;
  x: number;
  z: number;
  /** 0 = normal, 1 = hard to reach (better loot, guaranteed rare+). */
  tier: number;
}

/** A solid block to add: centre, size, height above the lowest ground under it. */
export interface BlockSpec {
  cx: number;
  cz: number;
  w: number;
  d: number;
  h: number;
  color?: number;
  /** Absolute base height instead of the ground (floating blocks, roofs). */
  base?: number;
  /** Sink this far below the ground (default 1). */
  sink?: number;
  cap?: boolean;
  /**
   * What the block is, for its model (milestone 8): 'house' walls with its 'eave' and 'roof' slabs (same
   * `artId`), 'well', 'column', 'ruinWall', 'gatePillar', 'gateLintel', 'gateDoor', 'stone', 'crate'.
   * Untagged blocks keep their box.
   */
  art?: string;
  artId?: number;
}

export interface Layout {
  name: 'test' | 'main';
  size: number;
  spawn: [number, number];
  homeSite: [number, number];
  /** The home starts owned (test map) or is bought through the house quest (main map). */
  homeOwned: boolean;
  gliderAtStart: boolean;
  shape(x: number, z: number): number;
  blocks(heightAt: (x: number, z: number) => number): BlockSpec[];
  region(x: number, z: number): Region;
  colour(x: number, z: number, h: number, slope: number, out: THREE.Color): void;
  /** Tree density 0–1 at a spot (also skips steep slopes and blocks). */
  treeDensity(x: number, z: number, h: number): number;
  maxTrees: number;
  camps: CampSpec[];
  campfires: CampfireSpec[];
  chests: ChestSpec[];
  /** Dungeon entrance (milestone 6). */
  dungeon?: [number, number];
  /** Rock spires in the heightmap ([x, z, height]); the world models dress their feet. */
  spires?: [number, number, number][];
}

const GRASS = new THREE.Color('#6fa84a');
const GRASS_DARK = new THREE.Color('#4d7f36');
const ROCK = new THREE.Color('#8a7f72');
const SNOW = new THREE.Color('#e8eef2');

// ---------------------------------------------------------------- test map (milestones 1–4)

export const TEST_LAYOUT: Layout = {
  name: 'test',
  size: 256,
  spawn: [0, 12],
  homeSite: [12, -4],
  homeOwned: true,
  gliderAtStart: true,
  shape(x, z) {
    let h = fbm(x * 0.025, z * 0.025, 4, 3) * 6 - 2;
    const dp = Math.hypot(x - 45, z + 20);
    h += (11 + fbm(x * 0.1, z * 0.1, 2, 9) * 1.5) * (1 - smoothstep(20, 23, dp));
    const dm = Math.hypot(x + 55, z + 50);
    const t = Math.max(0, 1 - dm / 48);
    h += 42 * Math.pow(t, 1.7) * (0.85 + 0.3 * fbm(x * 0.06, z * 0.06, 3, 5));
    const ds = Math.hypot(x - 10, z - 45);
    h += 24 * (1 - smoothstep(4, 6.5, ds));
    const de = Math.max(Math.abs(x), Math.abs(z));
    h += Math.max(0, de - (128 - 20)) * 2.5;
    return h;
  },
  blocks: () => [
    { cx: -22, cz: 28, w: 6, d: 6, h: 18, art: 'stone' }, // stone tower (climbable on one full stamina bar)
    { cx: 20, cz: 8, w: 14, d: 1.5, h: 6, art: 'stone' }, // wall
    { cx: 4, cz: 2, w: 1.6, d: 1.6, h: 1.0, art: 'crate' }, // crate (vault)
    { cx: 7, cz: 4, w: 1.6, d: 1.6, h: 2.4, art: 'crate' }, // tall crate (climb)
    { cx: -8, cz: 0, w: 3, d: 3, h: 4, art: 'stone' }, // block
  ],
  region: () => ({ id: 'test', name: 'Test Meadow', level: 1 }),
  colour(x, z, h, slope, c) {
    c.copy(GRASS).lerp(GRASS_DARK, fbm(x * 0.15, z * 0.15, 2, 4));
    c.lerp(ROCK, smoothstep(0.7, 1.2, slope));
    if (h > 30) c.lerp(SNOW, smoothstep(30, 36, h) * (1 - smoothstep(0.9, 1.4, slope)));
  },
  treeDensity(x, z) {
    if (Math.hypot(x, z - 12) < 8) return 0;
    if (Math.hypot(x - 12, z + 4) < 11) return 0;
    return 1;
  },
  maxTrees: 260,
  camps: [
    { kind: 'slime', x: -6, z: 24 },
    { kind: 'slime', x: -3, z: 27 },
    { kind: 'slime', x: -9, z: 28 },
    { kind: 'boar', x: 18, z: 26 },
    { kind: 'boar', x: 24, z: 30 },
    { kind: 'bandit', x: -18, z: 2 },
    { kind: 'bandit', x: -22, z: -3 },
  ],
  campfires: [],
  chests: [],
};

// ---------------------------------------------------------------- main map (milestone 5)

const HALF = 300;
const TOWN_R = 42;
const TOWN_H = 6;

/** Compass angle in degrees: 0 = south (+z), 90 = east (+x), ±180 = north. */
function angleOf(x: number, z: number): number {
  return (Math.atan2(x, z) * 180) / Math.PI;
}

/** Soft region weights (meadow, forest, ruins), blended over ~20° at the borders. */
function regionWeights(x: number, z: number): [number, number, number] {
  const a = angleOf(x, z) + (fbm(x * 0.008, z * 0.008, 3, 77) - 0.5) * 50;
  const wrap = (v: number) => ((v + 540) % 360) - 180;
  // Sector centres and half-widths: meadow south-east, forest west, ruins north.
  const sector = (centre: number, half: number) => 1 - smoothstep(half - 12, half + 12, Math.abs(wrap(a - centre)));
  const m = sector(37, 97);
  const f = sector(-110, 50);
  const r = sector(165, 35);
  const s = m + f + r || 1;
  return [m / s, f / s, r / s];
}

const REGIONS = {
  meadow: { name: 'Sunmeadow', min: 1, max: 5 },
  forest: { name: 'Gloamwood', min: 5, max: 10 },
  ruins: { name: 'The Sundered Ruins', min: 10, max: 15 },
} as const;

function regionAt(x: number, z: number): Region {
  const r = Math.hypot(x, z);
  if (r < TOWN_R + 6) return { id: 'town', name: 'Emberhollow', level: 1 };
  const [m, f, ru] = regionWeights(x, z);
  const id = m >= f && m >= ru ? 'meadow' : f >= ru ? 'forest' : 'ruins';
  const info = REGIONS[id];
  const k = Math.min(1, Math.max(0, (r - TOWN_R - 10) / 220));
  return { id, name: info.name, level: Math.round(info.min + (info.max - info.min) * k) };
}

/** Terraced mesas with sheer cliffs for the ruins. */
function terrace(v: number, step: number): number {
  const t = v / step;
  const f = t - Math.floor(t);
  return (Math.floor(t) + smoothstep(0.8, 0.97, f)) * step;
}

/** Roads from the town to each region (flattened and dirt-coloured). */
const ROADS: [number, number, number, number][] = [
  [0, 0, 60, 150],
  [60, 150, 170, 70],
  [0, 0, -120, -20],
  [-120, -20, -200, -105],
  [0, 0, 55, -140],
  [55, -140, 160, -205],
];
function roadDist(x: number, z: number): number {
  let best = Infinity;
  for (const [ax, az, bx, bz] of ROADS) {
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/** Tall rock spires (chests on top: climb with a full stamina bar or glide in). */
const SPIRES: [number, number, number][] = [
  [95, 85, 22],
  [-60, 95, 20],
  [-150, -70, 26],
  [-95, -150, 24],
  [100, -105, 28],
  [210, -150, 30],
];

function mainShape(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const [m, f, ru] = regionWeights(x, z);
  const base = fbm(x * 0.01, z * 0.01, 5, 3);
  const meadow = base * 16 - 2 + fbm(x * 0.04, z * 0.04, 3, 8) * 3;
  const ridge = 1 - Math.abs(fbm(x * 0.012, z * 0.012, 4, 21) * 2 - 1);
  const forest = base * 20 + ridge * 18 - 4;
  const ruins = terrace(base * 30 + fbm(x * 0.02, z * 0.02, 3, 31) * 26, 7) - 2;
  let h = meadow * m + forest * f + ruins * ru;

  // Roads soften the ground a little.
  const rd = roadDist(x, z);
  if (rd < 6) h = h * (0.75 + 0.25 * smoothstep(0, 6, rd)) + base * 4 * (1 - smoothstep(0, 6, rd));

  // Town plateau.
  const tb = smoothstep(TOWN_R, TOWN_R + 28, r);
  h = TOWN_H * (1 - tb) + h * tb;

  // Rock spires.
  for (const [sx, sz, sh] of SPIRES) {
    const d = Math.hypot(x - sx, z - sz);
    if (d < 7) h += sh * (1 - smoothstep(3.5, 6, d));
  }

  // Mountains around the world edge.
  const de = Math.max(Math.abs(x), Math.abs(z));
  h += Math.max(0, de - (HALF - 34)) * 2.2 + Math.max(0, de - (HALF - 60)) * 0.4 * fbm(x * 0.05, z * 0.05, 2, 41) * 6;
  return h;
}

const TOWN_STONE = new THREE.Color('#a39a88');
const DIRT = new THREE.Color('#9b7d55');
const MEADOW = new THREE.Color('#7cbf4f');
const FOREST = new THREE.Color('#3f6e35');
const MOSS = new THREE.Color('#2e5a2c');
const SAND = new THREE.Color('#c2a878');
const RUIN_ROCK = new THREE.Color('#9a8670');

// Region ground (milestone 8): each region reads apart at a glance. Sunmeadow is a warm yellow-green with
// lighter flower patches, Gloamwood a dark blue-green with moss and needle-litter, the Ruins sand with rust
// and pale stone. Cliffs and spires are layered rock (bands by height) tinted per region.
const MEADOW_LIGHT = new THREE.Color('#a8cf5a');
const FLOWERS = new THREE.Color('#d9d77a');
const FOREST_DEEP = new THREE.Color('#2b5a3a');
const LITTER = new THREE.Color('#5a5034');
const RUST = new THREE.Color('#b8834f');
const PALE = new THREE.Color('#d6c4a0');
const STRATA = {
  meadow: [new THREE.Color('#968d80'), new THREE.Color('#7e766b')],
  forest: [new THREE.Color('#687064'), new THREE.Color('#565d53')],
  ruins: [new THREE.Color('#b08c66'), new THREE.Color('#987552')],
} as const;
const tmp2 = new THREE.Color();

function mainColour(x: number, z: number, h: number, slope: number, c: THREE.Color): void {
  const [m, f, ru] = regionWeights(x, z);
  const n = fbm(x * 0.15, z * 0.15, 2, 4);
  const patch = fbm(x * 0.05, z * 0.05, 2, 13);
  // Meadow: grass with lighter patches and pale flower speckle.
  tmp2.copy(MEADOW).lerp(GRASS_DARK, n * 0.5).lerp(MEADOW_LIGHT, smoothstep(0.55, 0.75, patch) * 0.6);
  tmp2.lerp(FLOWERS, smoothstep(0.78, 0.9, fbm(x * 0.4, z * 0.4, 1, 3)) * 0.45);
  c.copy(tmp2).multiplyScalar(m);
  // Gloamwood: deep blue-green with moss and needle litter.
  tmp2.copy(FOREST).lerp(FOREST_DEEP, n).lerp(MOSS, smoothstep(0.5, 0.7, patch) * 0.6).lerp(LITTER, smoothstep(0.62, 0.8, fbm(x * 0.09, z * 0.09, 2, 17)) * 0.55);
  c.add(tmp2.multiplyScalar(f));
  // Ruins: sand, rust patches and pale flagstone.
  tmp2.copy(SAND).lerp(RUIN_ROCK, n * 0.7).lerp(RUST, smoothstep(0.55, 0.75, patch) * 0.5).lerp(PALE, smoothstep(0.7, 0.85, fbm(x * 0.12, z * 0.12, 2, 23)) * 0.5);
  c.add(tmp2.multiplyScalar(ru));
  const rd = roadDist(x, z);
  if (rd < 3.5) c.lerp(DIRT, 1 - smoothstep(2, 3.5, rd));
  const r = Math.hypot(x, z);
  if (r < TOWN_R) c.lerp(TOWN_STONE, (1 - smoothstep(TOWN_R - 14, TOWN_R, r)) * (0.5 + 0.3 * n));
  // Layered rock on steep ground (and on rock spires, including their flat tops): bands about 1.6 m apart.
  let onSpire = false;
  let spireBlend = 0;
  for (const [sx, sz] of SPIRES) {
    const d = Math.hypot(x - sx, z - sz);
    if (d < 7) {
      onSpire = true;
      spireBlend = Math.max(spireBlend, 1 - smoothstep(4.5, 6.8, d));
    }
  }
  const steep = Math.max(smoothstep(0.75, 1.25, slope), spireBlend);
  if (steep > 0) {
    const band = (h + fbm(x * 0.08, z * 0.08, 2, 29) * 3) / 2.2;
    const t = smoothstep(0.35, 0.65, Math.abs((band - Math.floor(band)) * 2 - 1));
    const rock = tmp2.set(0, 0, 0);
    for (const [k, w] of [['meadow', m], ['forest', f], ['ruins', ru]] as const) {
      rock.r += (STRATA[k][0].r + (STRATA[k][1].r - STRATA[k][0].r) * t) * w;
      rock.g += (STRATA[k][0].g + (STRATA[k][1].g - STRATA[k][0].g) * t) * w;
      rock.b += (STRATA[k][0].b + (STRATA[k][1].b - STRATA[k][0].b) * t) * w;
    }
    c.lerp(rock, steep);
  }
  if (!onSpire && h > 45) c.lerp(SNOW, smoothstep(45, 55, h) * (1 - smoothstep(0.9, 1.4, slope)));
}

/** Town buildings, ruins and the dungeon gate. */
function mainBlocks(heightAt: (x: number, z: number) => number): BlockSpec[] {
  const out: BlockSpec[] = [];
  // Town houses around the square (the player's home is built by Home at homeSite).
  const houses: [number, number, number, number, number][] = [
    [-22, -16, 9, 8, 0xd9c8a5],
    [20, -18, 10, 8, 0xe2d2b0],
    [26, 4, 8, 10, 0xd6c19a],
    [-28, 2, 8, 9, 0xcdb994],
    [12, 24, 9, 7, 0xd9c8a5],
    [-6, -28, 12, 8, 0xc9b38c],
  ];
  houses.forEach(([cx, cz, w, d, col], i) => {
    out.push({ cx, cz, w, d, h: 4, color: col, cap: false, art: 'house', artId: i });
    out.push({ cx, cz, w: w + 1, d: d + 1, h: 0.5, base: TOWN_H + 4, color: 0xa8432f, cap: false, art: 'eave', artId: i });
    out.push({ cx, cz, w: w - 2, d: d - 2, h: 1.2, base: TOWN_H + 4.5, color: 0x8f3626, cap: false, art: 'roof', artId: i });
  });
  // Well in the square.
  out.push({ cx: 0, cz: -6, w: 2.2, d: 2.2, h: 1, color: 0x8a8070, art: 'well' });

  // Ruins: broken walls and columns scattered over the north.
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const a = ((140 + rand() * 80) * Math.PI) / 180;
    const r = 80 + rand() * 190;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    if (regionAt(x, z).id !== 'ruins') continue;
    const col = rand() < 0.5;
    if (col) out.push({ cx: x, cz: z, w: 1.4, d: 1.4, h: 3 + rand() * 6, color: 0xb9ab92, art: 'column' });
    else {
      const long = 4 + rand() * 8;
      const alongX = rand() < 0.5;
      out.push({ cx: x, cz: z, w: alongX ? long : 1, d: alongX ? 1 : long, h: 1.5 + rand() * 3, color: 0xa99a80, art: 'ruinWall' });
    }
  }
  // Dungeon gate (opens in milestone 6).
  const [gx, gz] = [160, -215];
  const gy = heightAt(gx, gz);
  out.push({ cx: gx - 3.5, cz: gz, w: 2, d: 3, h: 8, color: 0x6e6658, art: 'gatePillar' });
  out.push({ cx: gx + 3.5, cz: gz, w: 2, d: 3, h: 8, color: 0x6e6658, art: 'gatePillar' });
  out.push({ cx: gx, cz: gz, w: 9, d: 3, h: 1.6, base: gy + 7, color: 0x5a5348, art: 'gateLintel' });
  out.push({ cx: gx, cz: gz - 1.2, w: 5, d: 0.5, h: 6.5, color: 0x2a2420, art: 'gateDoor' });
  return out;
}

/** Enemy camps: [kind, x, z] spread through each region; level from distance. */
function mainCamps(): CampSpec[] {
  const out: CampSpec[] = [];
  const camp = (kind: EnemyKind, x: number, z: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push({ kind, x: x + Math.cos(a) * 3, z: z + Math.sin(a) * 3 });
    }
  };
  // Sunmeadow (south-east)
  camp('slime', 30, 75, 3);
  camp('slime', -25, 80, 3);
  camp('slime', 75, 40, 3);
  camp('boar', 110, 130, 2);
  camp('boar', 20, 170, 2);
  camp('boar', 150, 20, 2);
  camp('bandit', 135, 175, 3);
  camp('bandit', 215, 100, 3);
  camp('slime', 200, 20, 3);
  // Gloamwood (west)
  camp('wolf', -90, 15, 3);
  camp('wolf', -150, 40, 3);
  camp('spider', -125, -60, 2);
  camp('spider', -185, -20, 2);
  camp('goblin', -170, -135, 3);
  camp('wolf', -230, -60, 3);
  camp('goblin', -110, -110, 2);
  // Sundered Ruins (north)
  camp('skeleton', 30, -110, 3);
  camp('skeleton', 100, -150, 3);
  camp('cultist', -20, -175, 2);
  camp('golem', 60, -220, 1);
  camp('cultist', 130, -250, 2);
  camp('skeleton', 200, -180, 3);
  camp('golem', 190, -240, 1);
  return out;
}

export const MAIN_LAYOUT: Layout = {
  name: 'main',
  size: 600,
  spawn: [0, 8],
  homeSite: [-24, 22],
  homeOwned: false,
  gliderAtStart: false,
  shape: mainShape,
  blocks: mainBlocks,
  region: regionAt,
  colour: mainColour,
  treeDensity(x, z, h) {
    const r = Math.hypot(x, z);
    if (r < TOWN_R + 8 || roadDist(x, z) < 5.5 || h > 48) return 0;
    const [m, f, ru] = regionWeights(x, z);
    // Thin Gloamwood with soft glades so roads, camps and enemies read clearly from above.
    const glade = 0.7 + 0.3 * smoothstep(0.35, 0.7, fbm(x * 0.025, z * 0.025, 2, 55));
    return m * 0.14 + f * 0.44 * glade + ru * 0.035;
  },
  maxTrees: 2700,
  camps: mainCamps(),
  campfires: [
    { id: 'town', name: 'Town Square', x: 0, z: 5 },
    { id: 'fields', name: 'Sunny Fields', x: 62, z: 120 },
    { id: 'mill', name: 'Old Mill', x: 175, z: 62 },
    { id: 'hunters', name: "Hunter's Rest", x: -112, z: -12 },
    { id: 'deepwood', name: 'Deepwood', x: -205, z: -100 },
    { id: 'gate', name: 'Broken Gate', x: 52, z: -135 },
    { id: 'heights', name: 'Ruin Heights', x: 150, z: -190 },
  ],
  chests: [
    ...SPIRES.map(([x, z], i) => ({ id: `spire${i}`, x, z, tier: 1 })),
    { id: 'meadowRock', x: 140, z: 150, tier: 0 },
    { id: 'woodHollow', x: -200, z: 30, tier: 0 },
    { id: 'ruinCorner', x: 15, z: -240, tier: 0 },
    { id: 'edgeCliff', x: -40, z: 240, tier: 0 },
  ],
  dungeon: [160, -219],
  spires: SPIRES,
};
