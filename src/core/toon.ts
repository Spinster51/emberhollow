import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

/** 3-band lighting ramp shared by every toon material. */
function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

export function toonMaterial(
  color: THREE.ColorRepresentation,
  extra: THREE.MeshToonMaterialParameters = {},
): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
}

const outlineMat = new THREE.MeshBasicMaterial({ color: 0x140d0a, side: THREE.BackSide });

/** Inverted-hull outline: a slightly larger black copy rendered from the back. */
export function addOutline(mesh: THREE.Mesh, thickness = 0.06): THREE.Mesh {
  const geo = mesh.geometry as THREE.BufferGeometry;
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);
  const o = new THREE.Mesh(geo, outlineMat);
  o.scale.set(
    1 + thickness / Math.max(size.x, 0.01),
    1 + thickness / Math.max(size.y, 0.01),
    1 + thickness / Math.max(size.z, 0.01),
  );
  o.raycast = () => {};
  mesh.add(o);
  return o;
}

const shellMats = new Map<number, THREE.MeshBasicMaterial>();

/**
 * Outline material that pushes each vertex out along its normal (works on skinned meshes), by
 * `thickness` in the mesh's own units; one shared material per thickness.
 */
export function shellMaterial(thickness: number): THREE.MeshBasicMaterial {
  let m = shellMats.get(thickness);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: 0x140d0a, side: THREE.BackSide });
    const push = thickness.toFixed(4);
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n\ttransformed += normalize(normal) * ${push};`,
      );
    };
    m.customProgramCacheKey = () => `shell-outline-${push}`;
    shellMats.set(thickness, m);
  }
  return m;
}

/**
 * Inverted-hull outline for loaded models: a back-face copy grown along the normals
 * (in the mesh's own units). Skinned meshes get a skinned copy bound to the same bones,
 * so the outline follows the animation.
 */
export function addSkinnedOutline(mesh: THREE.Mesh, thickness: number): THREE.Mesh {
  const mat = shellMaterial(thickness);
  let o: THREE.Mesh;
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
    const src = mesh as THREE.SkinnedMesh;
    const shell = new THREE.SkinnedMesh(src.geometry, mat);
    shell.bind(src.skeleton, src.bindMatrix);
    o = shell;
  } else {
    o = new THREE.Mesh(mesh.geometry, mat);
  }
  o.name = `${mesh.name}_outline`;
  o.raycast = () => {};
  o.castShadow = false;
  mesh.add(o);
  return o;
}
