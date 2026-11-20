import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addSkinnedOutline, toonMaterial } from './toon';

/**
 * glTF model loader with a cache. Each file is fetched and parsed once; callers get
 * SkeletonUtils clones, so every enemy or villager has its own skeleton and mixer.
 * Loading is asynchronous: models show their placeholder until the file is ready,
 * and keep the placeholder for good if the file fails to load.
 */

const loader = new GLTFLoader();
const pending = new Map<string, Promise<GLTF>>();
const ready = new Map<string, GLTF>();
const failed = new Set<string>();

/** Resolve a path under `public/` against the site base (works under a GitHub Pages sub-path). */
export function assetUrl(path: string): string {
  return import.meta.env.BASE_URL + path;
}

export interface ModelOptions {
  /** Outline thickness for a mesh in its own units (default 0.04; 0 = none). */
  outline?: (mesh: THREE.Mesh) => number;
}

/** Start loading a model (once; the first call's options apply). Resolves with the parsed file; rejects if it fails. */
export function loadModel(path: string, opts: ModelOptions = {}): Promise<GLTF> {
  let p = pending.get(path);
  if (!p) {
    p = loader.loadAsync(assetUrl(path)).then(
      (gltf) => {
        prepare(gltf, opts);
        ready.set(path, gltf);
        return gltf;
      },
      (err: unknown) => {
        failed.add(path);
        console.warn(`model ${path} failed to load; keeping the placeholder`, err);
        throw err;
      },
    );
    // Callers that only poll `modelState` must not see an unhandled rejection.
    p.catch(() => {});
    pending.set(path, p);
  }
  return p;
}

export type ModelState = 'none' | 'loading' | 'ready' | 'failed';

export function modelState(path: string): ModelState {
  if (ready.has(path)) return 'ready';
  if (failed.has(path)) return 'failed';
  return pending.has(path) ? 'loading' : 'none';
}

/** A fresh copy of a loaded model (own skeleton), or null if it is not ready. */
export function cloneModel(path: string): THREE.Object3D | null {
  const gltf = ready.get(path);
  return gltf ? SkeletonUtils.clone(gltf.scene) : null;
}

/**
 * SkeletonUtils gives every skinned mesh of a clone its own Skeleton (each outline shell too), and
 * three.js updates and uploads each one every frame. Meshes bound to the same bones with the same
 * inverse bind matrices (one glTF skin) can share a single Skeleton: same pose, a fraction of the work.
 */
export function shareSkeletons(root: THREE.Object3D): void {
  const shared: THREE.Skeleton[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const k = m.skeleton;
    const same = shared.find(
      (s) => s.bones.length === k.bones.length && s.bones.every((b, i) => b === k.bones[i]) && s.boneInverses.every((inv, i) => inv.equals(k.boneInverses[i])),
    );
    if (same) m.skeleton = same;
    else shared.push(k);
  });
}

/** Joined geometries per key (null: the parts could not be joined). */
const joinedGeometry = new Map<string, THREE.BufferGeometry | null>();

/** Can these geometries be merged: the same attributes (size, type, normalisation), all indexed, no morphs? */
function joinable(geos: THREE.BufferGeometry[]): boolean {
  const sig = (g: THREE.BufferGeometry) =>
    `${g.index ? 'i' : 'n'}|${Object.keys(g.morphAttributes).length}|` +
    Object.entries(g.attributes)
      .map(([k, a]) => `${k}:${a.itemSize}:${(a as THREE.BufferAttribute).array?.constructor.name}:${a.normalized}`)
      .sort()
      .join(',');
  const first = sig(geos[0]);
  return geos.every((g) => sig(g) === first);
}

/**
 * Join a clone's visible skinned parts into one SkinnedMesh per skeleton and material (call `shareSkeletons`
 * first): one draw call, and one for its outline, instead of one each per body part (KayKit bodies come in
 * six to eight parts). Parts must sit at their parent's origin with one bind matrix, as every pack body
 * does; any that do not stay as they are. The joined geometry is built once per `key` (the file plus what
 * was left out of it) and shared by every clone; the outline is grown `outline` model units, as loaded
 * parts get theirs. Returns the joined meshes.
 */
export function joinSkinnedParts(root: THREE.Object3D, key: string, outline = 0.04): THREE.SkinnedMesh[] {
  const groups = new Map<string, THREE.SkinnedMesh[]>();
  const ids = new Map<object, number>();
  const id = (o: object) => {
    let i = ids.get(o);
    if (i === undefined) ids.set(o, (i = ids.size));
    return i;
  };
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || m.name.endsWith('_outline') || !m.visible || !m.parent) return;
    const placed = m.position.lengthSq() < 1e-12 && Math.abs(m.quaternion.w) > 1 - 1e-9 && Math.abs(m.scale.x * m.scale.y * m.scale.z - 1) < 1e-6;
    if (!placed || Array.isArray(m.material)) return;
    const k = `${id(m.skeleton)}/${id(m.material)}/${id(m.parent)}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(m);
  });
  const out: THREE.SkinnedMesh[] = [];
  let n = 0;
  for (const parts of groups.values()) {
    const first = parts[0];
    if (parts.length < 2 || !parts.every((p) => p.bindMatrix.equals(first.bindMatrix))) continue;
    const gk = `${key}#${n++}:${parts.map((p) => p.name).join(',')}`;
    let geo = joinedGeometry.get(gk);
    if (geo === undefined) {
      const geos = parts.map((p) => p.geometry);
      geo = joinable(geos) ? mergeGeometries(geos) : null;
      if (geo) {
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
      }
      joinedGeometry.set(gk, geo);
    }
    if (!geo) continue;
    const mesh = new THREE.SkinnedMesh(geo, first.material);
    mesh.name = `joined:${parts.length}`;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    first.parent!.add(mesh);
    mesh.bind(first.skeleton, first.bindMatrix);
    if (outline > 0) addSkinnedOutline(mesh, outline);
    for (const p of parts) p.removeFromParent();
    out.push(mesh);
  }
  return out;
}

/**
 * A copy of one named node of a loaded model (with its children, outline included) and its
 * local transform, e.g. a helmet off a character; null if the file is not ready or lacks it.
 * For plain meshes: the copy shares geometry and materials with the file, so clone a material
 * before changing it.
 */
export function cloneNode(path: string, name: string): THREE.Object3D | null {
  const node = ready.get(path)?.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
  return node ? node.clone() : null;
}

/** The animation clips of a loaded model (shared, never modified). */
export function modelClips(path: string): THREE.AnimationClip[] {
  return ready.get(path)?.animations ?? [];
}

/** Resolves once every model requested so far has loaded or failed (tests wait on this). */
export async function modelsSettled(): Promise<void> {
  await Promise.allSettled([...pending.values()]);
}

/**
 * One-time conversion of a loaded file to the game's look: toon shading with the
 * pack's colour atlas, shadows, and a back-face outline on every mesh. Clones share
 * these materials and outline meshes.
 */
function prepare(gltf: GLTF, opts: ModelOptions): void {
  const mats = new Map<THREE.Material, THREE.MeshToonMaterial>();
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    const src = mesh.material as THREE.MeshStandardMaterial;
    let toon = mats.get(src);
    if (!toon) {
      toon = toonMaterial(src.color ?? 0xffffff, { map: src.map ?? null });
      // Names let callers recolour one part (e.g. a body's hide); emissive keeps glowing eyes glowing.
      toon.name = src.name;
      if (src.emissive && src.emissive.getHex() !== 0) {
        toon.emissive.copy(src.emissive);
        toon.emissiveIntensity = src.emissiveIntensity ?? 1;
      }
      if (toon.map) {
        toon.map.colorSpace = THREE.SRGBColorSpace;
        // Keep the atlas crisp at the game's low render resolution.
        toon.map.magFilter = THREE.NearestFilter;
      }
      mats.set(src, toon);
    }
    mesh.material = toon;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    const outline = opts.outline?.(mesh) ?? 0.04;
    if (outline > 0) addSkinnedOutline(mesh, outline);
  }
}
