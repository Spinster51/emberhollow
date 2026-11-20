import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { cloneNode, loadModel, modelState } from '../core/models';
import { DUNGEON_FILE, DUNGEON_OUTLINE, WORLD_FILE, WORLD_OUTLINE } from '../art/assets';

/**
 * The world file (milestone 8): vegetation, rocks, the building kit, ruins, gate, well, chests, campfires,
 * camp dressing and the glider. Most of it is not cloned node by node: the game merges kit pieces into one
 * mesh per building group and instances the vegetation, so this module hands out each piece's geometry
 * (as plain float attributes, ready to transform) and the file's two shared materials.
 */

const prepared = new Set<string>();
const GLOW_MATS = new Set(['WorldGlow', 'DungeonGlow', 'PlateGlow', 'BrazierEmber', 'ExitPortalGlow', 'ExitPortalMid', 'ExitPortalCore']);

function loadPaletteFile(file: string, outlines: Record<string, number>): Promise<GLTF> {
  return loadModel(file, { outline: (m) => outlines[nodeName(m)] ?? 0 }).then((gltf) => {
    if (!prepared.has(file)) {
      prepared.add(file);
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.name.endsWith('_outline')) return;
        const mat = mesh.material as THREE.MeshToonMaterial;
        if (mat.userData.worldReady) return;
        mat.userData.worldReady = true;
        if (mat.map) {
          // A gradient palette: no mipmaps, so distant pieces keep their cell's colour instead of bleeding into the next.
          mat.map.minFilter = THREE.LinearFilter;
          mat.map.generateMipmaps = false;
          mat.map.needsUpdate = true;
        }
        if (GLOW_MATS.has(mat.name)) {
          if (mat.map) mat.emissiveMap = mat.map;
          mat.emissive.set(0xffffff);
          mat.emissiveIntensity = mat.name === 'WorldGlow' || mat.name === 'DungeonGlow' ? 0.85 : 0.25;
        }
      });
    }
    return gltf;
  });
}

/** Start loading a world file (once; the game never waits on it). Resolves with the parsed file. */
export function loadWorldFile(file = WORLD_FILE): Promise<GLTF> {
  return loadPaletteFile(file, WORLD_OUTLINE);
}

/** Start loading the dungeon file (once; the game never waits on it). Resolves with the parsed file. */
export function loadDungeonFile(file = DUNGEON_FILE): Promise<GLTF> {
  return loadPaletteFile(file, DUNGEON_OUTLINE);
}

/** The top-level node a mesh belongs to (multi-material nodes load as a group of primitives). */
function nodeName(m: THREE.Object3D): string {
  let n = m;
  while (n.parent && n.parent.parent) n = n.parent;
  return n.name;
}

export function worldReady(file = WORLD_FILE): boolean {
  return modelState(file) === 'ready';
}

/** A copy of a whole node (shares geometry and materials), or null. */
export function worldNode(name: string, file = WORLD_FILE): THREE.Object3D | null {
  return cloneNode(file, name);
}

export interface PiecePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const parts = new Map<string, PiecePart[] | null>();

/** Float copy of position / normal / uv (quantized attributes would clamp once transformed) and the index. */
function toFloat(src: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) arr[i * a.itemSize + j] = a.getComponent(i, j);
    g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array as ArrayLike<number>), 1));
  g.applyMatrix4(m);
  return g;
}

/** The parts of a node (one per material) in the node's own space, or null if the file is not ready / lacks it. */
export function pieceParts(name: string, file = WORLD_FILE): PiecePart[] | null {
  const key = `${file}#${name}`;
  if (parts.has(key)) return parts.get(key)!;
  const node = worldNode(name, file);
  if (!node) return null;
  node.updateMatrixWorld(true);
  const inv = node.matrixWorld.clone().invert();
  const out: PiecePart[] = [];
  node.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name.endsWith('_outline')) return;
    out.push({ geometry: toFloat(mesh.geometry, inv.clone().multiply(mesh.matrixWorld)), material: mesh.material as THREE.Material });
  });
  parts.set(key, out);
  return out;
}

/** The single geometry of a one-material node in the file's own (quantized) form, for instancing. */
export function pieceGeometry(name: string, file = WORLD_FILE): { geometry: THREE.BufferGeometry; material: THREE.Material } | null {
  return pieceMeshes(name, file)?.[0] ?? null;
}

/** All mesh primitives of a node in the file's own quantized form, for instancing multi-material props. */
export function pieceMeshes(name: string, file = WORLD_FILE): PiecePart[] | null {
  const node = worldNode(name, file);
  if (!node) return null;
  const out: PiecePart[] = [];
  node.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !mesh.name.endsWith('_outline')) {
      out.push({ geometry: mesh.geometry, material: mesh.material as THREE.Material });
    }
  });
  return out.length ? out : null;
}
