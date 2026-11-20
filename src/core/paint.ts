import * as THREE from 'three';

/** KayKit palette atlases: 8 × 4 cells of vertical gradients. */
const ATLAS: [number, number] = [8, 4];
/** Repainted copies of textures, made once per texture and recipe. */
const paintedMaps = new Map<string, THREE.Texture>();

/** A copy of a texture repainted by `paint` (made once per recipe). Falls back to the original. */
export function paintMap(src: THREE.Texture, recipe: string, paint: (d: ImageData) => void): THREE.Texture {
  const key = `${src.uuid}|${recipe}`;
  let t = paintedMaps.get(key);
  if (t) return t;
  t = src;
  const img = src.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  const cv = img?.width ? document.createElement('canvas') : null;
  const ctx = cv?.getContext('2d', { willReadFrequently: true });
  if (img && cv && ctx) {
    cv.width = img.width;
    cv.height = img.height;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height);
    paint(d);
    ctx.putImageData(d, 0, 0);
    const c = new THREE.CanvasTexture(cv);
    c.flipY = src.flipY;
    c.colorSpace = src.colorSpace;
    c.magFilter = src.magFilter;
    c.minFilter = src.minFilter;
    c.wrapS = src.wrapS;
    c.wrapT = src.wrapT;
    c.name = `${src.name}_${recipe.length > 16 ? 'recolor' : recipe}`;
    t = c;
  }
  paintedMaps.set(key, t);
  return t;
}

export const luma = (p: Uint8ClampedArray, i: number) => 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];

/**
 * Palette cells ("column,row" of the atlas) repainted in a colour; each pixel keeps its shade (its luma
 * against the cell's mean), so the cell's gradient survives. The goblin's skin on the bandit's texture,
 * the villagers' clothes and hair.
 */
export const recolorMap = (src: THREE.Texture, cells: Record<string, number>) =>
  paintMap(src, JSON.stringify(cells), (d) => {
    const p = d.data;
    const cw = d.width / ATLAS[0];
    const ch = d.height / ATLAS[1];
    for (const [cell, hex] of Object.entries(cells)) {
      const [cx, cy] = cell.split(',').map(Number);
      const x0 = Math.round(cx * cw), x1 = Math.round((cx + 1) * cw);
      const y0 = Math.round(cy * ch), y1 = Math.round((cy + 1) * ch);
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += luma(p, (y * d.width + x) * 4);
      const mean = Math.max(1, sum / ((x1 - x0) * (y1 - y0)));
      const rgb = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * d.width + x) * 4;
          const k = luma(p, i) / mean;
          for (let c = 0; c < 3; c++) p[i + c] = rgb[c] * k;
        }
      }
    }
  });
