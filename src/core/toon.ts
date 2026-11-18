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
