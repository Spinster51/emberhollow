import * as THREE from 'three';
import { CAMP_ART, PROP_OUTLINE_RANGE, PROP_RANGE, WORLD_FILE } from '../art/assets';
import { mulberry32 } from '../core/noise';
import { modelState } from '../core/models';
import { KitBuilder, cellShift, column, crateBlock, fitted, hexShift, house, stoneBlock, trs, wallSegments } from './kit';
import { Vegetation } from './Vegetation';
import { loadWorldFile } from './worldModels';
import type { LayoutBlock, World } from './World';

/**
 * The overworld's look (milestone 8): swaps the layout's boxes for models fitted to them (town houses, the
 * well, ruins, the dungeon gate, the test map's blocks), the procedural trees for the instanced vegetation,
 * and adds camp and town dressing. Visual only: colliders, prompts and saves never change. Until the world
 * file loads, and for good if it fails, the old boxes and trees stay.
 */

/** Town dressing: [node, x, z, yaw]; visual only, kept off paths, villagers and the spawn. */
const TOWN_DRESSING: [string, number, number, number][] = [
  ['LampPost', 7, -2, 0], ['LampPost', -7, -2, 0], ['LampPost', 4, 13, 0], ['LampPost', -10, 9, 0], ['LampPost', 11, -9, 0],
  ['Bench', 3.6, -6.5, Math.PI / 2], ['Bench', -3.6, -6.5, -Math.PI / 2],
  ['CrateBig', -16.9, -13.2, 0.2], ['CrateSmall', -16.8, -14.4, 0.5], ['Barrel', 14.4, -15, 0], ['Barrel', 14.5, -16.1, 0.4],
  ['CrateBig', 21.4, 7.6, -0.1], ['Sack', 21.3, 6.3, 1.2], ['Barrel', -23.3, 5.6, 0], ['CrateSmall', -23.4, 4.6, 0.3],
  ['Barrel', 0.7, -24.6, 0], ['CrateBig', 6.8, 26.2, 0.3], ['Bucket', 1.6, -4.4, 0],
];

export interface SceneryStats {
  houses: number;
  columns: number;
  ruinWalls: number;
  gate: number;
  blocks: number;
  camps: number;
  campProps: number;
  townProps: number;
}

export class Scenery {
  readonly group = new THREE.Group();
  readonly vegetation: Vegetation;
  /** Camp dressing groups (culled by distance). */
  private camps: { group: THREE.Group; x: number; z: number; outlines: THREE.Object3D[] }[] = [];
  /** Outlines and distant prop groups toggled by distance to the camera/player so far silhouettes stay cheap. */
  private lodGroups: { group?: THREE.Group; outlines: THREE.Object3D[]; x: number; z: number; range?: number; outlineRange: number; test?: (p: THREE.Vector3) => boolean }[] = [];
  /** Last player position and high-camera state checked for camp/outline culling. */
  private lastCull = { x: 1e9, z: 1e9, high: false };
  /** True once the models replaced the boxes and trees. */
  ready = false;
  readonly stats: SceneryStats = { houses: 0, columns: 0, ruinWalls: 0, gate: 0, blocks: 0, camps: 0, campProps: 0, townProps: 0 };
  /** Resolves when the file has loaded and been applied (or failed). */
  readonly loaded: Promise<boolean>;

  constructor(private world: World, readonly file = WORLD_FILE) {
    this.group.name = 'scenery';
    this.vegetation = new Vegetation(world, file);
    this.group.add(this.vegetation.group);
    this.loaded = loadWorldFile(file).then(
      () => this.apply(),
      () => false,
    );
  }

  get state(): string {
    return modelState(this.file);
  }

  private apply(): boolean {
    const w = this.world;
    // Blocks first: each group swaps only if every piece it needs is in the file.
    const byArt = (a: string) => w.blocks.filter((b) => b.spec.art === a);
    const town = new KitBuilder(this.file);
    const townBlocks: LayoutBlock[] = [];
    const houses = byArt('house');
    for (const hb of houses) {
      const id = hb.spec.artId;
      const eave = w.blocks.find((b) => b.spec.art === 'eave' && b.spec.artId === id);
      const roof = w.blocks.find((b) => b.spec.art === 'roof' && b.spec.artId === id);
      if (!eave || !roof) continue;
      const ground = hb.box.minY + (hb.spec.sink ?? 1);
      const roofMap = [undefined, hexShift(-1, 0, (c, r) => r === 0 && c === 7), hexShift(-2, 0, (c, r) => r === 0 && c === 7)][(id ?? 0) % 3];
      const wallMap = (id ?? 0) % 2 ? hexShift(0, -1, (c, r) => r === 2 && c === 5) : undefined;
      house(town, { walls: hb.box, eave: eave.box, roof: roof.box }, ground, { x: 0, z: 0 }, roofMap, wallMap);
      townBlocks.push(hb, eave, roof);
      this.stats.houses++;
    }
    for (const b of byArt('well')) {
      town.add('Well', trs((b.box.minX + b.box.maxX) / 2, b.box.minY + 1, (b.box.minZ + b.box.maxZ) / 2));
      townBlocks.push(b);
    }
    const townG = this.swap(town, townBlocks, 'town', 0.035);
    if (townG) this.trackLod(townG, 0, 0, undefined, 75);
    if (w.layout.name === 'main') {
      const props = new KitBuilder(this.file);
      for (const [node, x, z, yaw] of TOWN_DRESSING) {
        props.add(node, trs(x, this.footY(x, z, 0.5), z, yaw));
        this.stats.townProps++;
      }
      const tpG = this.swap(props, [], 'townProps', 0);
      if (tpG) this.trackLod(tpG, 0, 0, PROP_RANGE, PROP_OUTLINE_RANGE);
    }

    // Split ruins into 2x2 spatial chunks inside one 'scenery:ruins' group so main & shadow cameras frustum-cull distant ruins.
    const ruinChunks = [new KitBuilder(this.file), new KitBuilder(this.file), new KitBuilder(this.file), new KitBuilder(this.file)];
    const rChunk = (b: LayoutBlock) => {
      const cx = (b.box.minX + b.box.maxX) / 2;
      const cz = (b.box.minZ + b.box.maxZ) / 2;
      return (cx >= 70 ? 1 : 0) + (cz >= -170 ? 2 : 0);
    };
    const ruinBlocks: LayoutBlock[] = [];
    for (const b of byArt('column')) {
      column(ruinChunks[rChunk(b)], b.box, Math.max(b.box.minY, w.heightAt((b.box.minX + b.box.maxX) / 2, (b.box.minZ + b.box.maxZ) / 2)));
      ruinBlocks.push(b);
      this.stats.columns++;
    }
    for (const b of byArt('ruinWall')) {
      wallSegments(ruinChunks[rChunk(b)], b.box);
      ruinBlocks.push(b);
      this.stats.ruinWalls++;
    }
    if (ruinBlocks.length && ruinChunks.every((k) => !k.missing.size)) {
      const rg = new THREE.Group();
      rg.name = 'scenery:ruins';
      rg.matrixAutoUpdate = false;
      rg.updateMatrix();
      ruinChunks.forEach((k, i) => {
        if (!k.empty) rg.add(k.build(`scenery:ruins:${i}`, { outline: 0 }));
      });
      this.group.add(rg);
      for (const b of ruinBlocks) {
        b.mesh.visible = false;
        if (b.cap) b.cap.visible = false;
      }
    }

    const gate = new KitBuilder(this.file);
    const gateBlocks: LayoutBlock[] = [];
    // Pieces built at their colliders' sizes (pillar 9 m with 1 m buried, lintel 1.6 m, door 7.5 m).
    const gateParts: [string, string, number][] = [['gatePillar', 'GatePillar', 9], ['gateLintel', 'GateLintel', 1.6], ['gateDoor', 'GateDoor', 7.5]];
    for (const [art, piece, h] of gateParts) {
      for (const b of byArt(art)) {
        fitted(gate, piece, b.box, h);
        gateBlocks.push(b);
      }
    }
    this.stats.gate = gateBlocks.length;
    const gateG = this.swap(gate, gateBlocks, 'gate', 0.05);
    if (gateG && w.layout.dungeon) this.trackLod(gateG, w.layout.dungeon[0], w.layout.dungeon[1], undefined, 65);

    const blocks = new KitBuilder(this.file);
    const plain: LayoutBlock[] = [];
    for (const b of byArt('stone')) {
      stoneBlock(blocks, b.box, b.box.minY + (b.spec.sink ?? 1));
      plain.push(b);
    }
    for (const b of byArt('crate')) {
      crateBlock(blocks, b.box);
      plain.push(b);
    }
    this.stats.blocks = plain.length;
    this.swap(blocks, plain, 'blocks', 0.04);

    this.dressCamps();

    // Vegetation replaces the procedural trees.
    if (this.vegetation.build()) {
      for (const m of w.treeMeshes) m.visible = false;
    }
    this.ready = true;
    return true;
  }

  /** Put a kit group in the world and hide the boxes it replaces; keeps the boxes if a piece is missing. */
  private swap(k: KitBuilder, blocks: LayoutBlock[], name: string, outline: number): THREE.Group | null {
    if (k.empty || k.missing.size) {
      if (k.missing.size) console.warn(`world models: ${name} lacks ${[...k.missing].join(', ')}; keeping the boxes`);
      return null;
    }
    const g = k.build(`scenery:${name}`, { outline });
    this.group.add(g);
    for (const b of blocks) {
      b.mesh.visible = false;
      if (b.cap) b.cap.visible = false;
    }
    return g;
  }

  private trackLod(group: THREE.Group, x: number, z: number, range: number | undefined, outlineRange: number, test?: (p: THREE.Vector3) => boolean): void {
    const outlines: THREE.Object3D[] = [];
    group.traverse((o) => o.name.endsWith('_outline') && outlines.push(o));
    this.lodGroups.push({ group: range ? group : undefined, outlines, x, z, range, outlineRange, test });
  }

  /** The lowest ground under a prop's footprint (so it never floats on a slope). */
  private footY(x: number, z: number, r: number): number {
    const w = this.world;
    return Math.min(w.heightAt(x, z), w.heightAt(x - r, z - r), w.heightAt(x + r, z - r), w.heightAt(x - r, z + r), w.heightAt(x + r, z + r));
  }

  /** Tents, crates, banners, bones... around each enemy camp, merged into one mesh per camp. */
  private dressCamps(): void {
    const w = this.world;
    const camps: { kind: string; x: number; z: number; n: number }[] = [];
    for (const c of w.layout.camps) {
      const near = camps.find((o) => o.kind === c.kind && Math.hypot(o.x / o.n - c.x, o.z / o.n - c.z) < 7);
      if (near) {
        near.x += c.x;
        near.z += c.z;
        near.n++;
      } else camps.push({ kind: c.kind, x: c.x, z: c.z, n: 1 });
    }
    const probe = new THREE.Vector3();
    for (const camp of camps) {
      const cx = camp.x / camp.n;
      const cz = camp.z / camp.n;
      const list = CAMP_ART[camp.kind];
      if (!list) continue;
      const k = new KitBuilder(this.file);
      const rand = mulberry32(Math.floor(Math.abs(cx * 31 + cz * 17)) + 5);
      const items = list.flatMap(([node, n]) => Array.from({ length: n }, () => node));
      const base = rand() * Math.PI * 2;
      let placed = 0;
      const placedPos: [number, number][] = [];
      items.forEach((node, i) => {
        const big = node === 'Tent' || node.startsWith('Rubble');
        const minGap = big ? 2.4 : 1.1;
        for (let attempt = 0; attempt < 16; attempt++) {
          const a = base + (i / items.length) * Math.PI * 2 + (rand() - 0.5) * 0.45 + attempt * 0.65;
          const r = big ? 5.2 + rand() * 1.6 : 3.8 + rand() * 2.6;
          const x = cx + Math.cos(a) * r;
          const z = cz + Math.sin(a) * r;
          if (w.slopeAt(x, z) > (big ? 0.75 : 0.9)) continue;
          // Clear of blocks (the probe sits above the terrain margin, so only boxes count).
          if (w.isSolid(probe.set(x, w.heightAt(x, z) + (big ? 2.2 : 1.0), z), big ? 1.8 : 0.7)) continue;
          if (w.scatterAvoid.some(([ax, az, ar]) => (x - ax) ** 2 + (z - az) ** 2 < (ar + 1) ** 2)) continue;
          if (placedPos.some(([px, pz]) => (x - px) ** 2 + (z - pz) ** 2 < minGap * minGap)) continue;
          // Tents open toward the camp's middle; the rest turn roughly to it.
          const yaw = Math.atan2(cx - x, cz - z) + (big ? 0 : (rand() - 0.5) * 1.0);
          const s = node === 'Tent' ? 1.15 : 1;
          const uv = camp.kind === 'goblin' && node === 'Tent' ? hexShift(-1, 0, (c, rr) => rr === 1 && c === 5)
            : camp.kind === 'cultist' && node === 'Banner' ? cellShift('D', 0, -1, (c, rr) => rr === 2 && c === 3) : undefined;
          k.add(node, trs(x, this.footY(x, z, big ? 1.2 : 0.45), z, yaw, s, s, s), uv);
          placedPos.push([x, z]);
          placed++;
          break;
        }
      });
      if (k.missing.size || k.empty) continue;
      const g = k.build(`scenery:camp:${camp.kind}`, { outline: 0 });
      this.group.add(g);
      const outlines: THREE.Object3D[] = [];
      g.traverse((o) => o.name.endsWith('_outline') && outlines.push(o));
      this.camps.push({ group: g, x: cx, z: cz, outlines });
      this.stats.camps++;
      this.stats.campProps += placed;
    }
  }

  /** Per frame: refill the vegetation around the player and in the camera's view; hide far props and distant outlines. */
  update(player: THREE.Vector3, camera?: THREE.Camera): void {
    if (!this.ready) return;
    this.vegetation.update(player, camera);
    const highCam = !!camera && camera.position.y - player.y > 40;
    const lc = this.lastCull;
    if (highCam === lc.high && (player.x - lc.x) ** 2 + (player.z - lc.z) ** 2 < 0.25) return;
    lc.x = player.x;
    lc.z = player.z;
    lc.high = highCam;
    const R2 = PROP_RANGE * PROP_RANGE;
    const O2 = PROP_OUTLINE_RANGE * PROP_OUTLINE_RANGE;
    for (const c of this.camps) {
      const d2 = (c.x - player.x) ** 2 + (c.z - player.z) ** 2;
      c.group.visible = d2 < R2;
      const showOl = !highCam && d2 < O2;
      for (const o of c.outlines) o.visible = showOl;
    }
    for (const l of this.lodGroups) {
      const d2 = (l.x - player.x) ** 2 + (l.z - player.z) ** 2;
      if (l.group && l.range) l.group.visible = d2 < l.range * l.range;
      const showOl = !highCam && (l.test ? l.test(player) : d2 < l.outlineRange * l.outlineRange);
      for (const o of l.outlines) o.visible = showOl;
    }
  }
}
