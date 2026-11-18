import * as THREE from 'three';
import type { Game } from '../Game';

const PX = 2; // metres per map pixel

/**
 * Minimap (top right, north up, 160 m around you) and the full map screen (M).
 * Markers: campfires (orange; grey until found), villagers with work (yellow) or a quest to hand
 * in (green), your home (blue), the dungeon gate (purple), "reach" quest targets (star), you (arrow).
 */
export class MapView {
  private base: HTMLCanvasElement | null = null;
  private mini: HTMLCanvasElement;
  private big: HTMLDivElement;
  private bigCanvas: HTMLCanvasElement;
  private frame = 0;
  private tracker: HTMLDivElement;

  constructor(root: HTMLElement, private game: Game) {
    this.mini = document.createElement('canvas');
    this.mini.className = 'minimap';
    this.mini.width = this.mini.height = 170;
    this.big = document.createElement('div');
    this.big.className = 'bigmap';
    this.big.style.display = 'none';
    this.bigCanvas = document.createElement('canvas');
    this.big.innerHTML = '<div class="inv-head">Map<span class="inv-close">✕ (M / Esc)</span></div>';
    this.big.appendChild(this.bigCanvas);
    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML =
      '<span style="color:#ffa63a">● campfire</span> <span style="color:#ffd23a">◆ quest</span> <span style="color:#7be06b">◆ hand in</span> ' +
      '<span style="color:#6fb6ff">■ home</span> <span style="color:#c070ff">■ sealed door</span> <span style="color:#fff">★ objective</span> · fast travel from any campfire';
    this.big.appendChild(legend);
    this.big.querySelector('.inv-close')!.addEventListener('click', () => this.toggle(false));
    this.tracker = document.createElement('div');
    this.tracker.className = 'tracker';
    root.append(this.mini, this.big, this.tracker);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.toggle();
      else if (e.code === 'Escape' && this.game.hud.mapOpen) this.toggle(false);
    });
    if (game.world.layout.name !== 'main') this.mini.style.display = 'none';
  }

  toggle(open = !this.game.hud.mapOpen): void {
    this.game.hud.mapOpen = open;
    this.big.style.display = open ? '' : 'none';
    if (open) {
      document.exitPointerLock?.();
      this.drawBig();
    }
    this.game.updateMenus();
  }

  /** Terrain colours with hillshading, drawn once. */
  private baseImage(): HTMLCanvasElement {
    if (this.base) return this.base;
    const w = this.game.world;
    const n = Math.round(w.size / PX);
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(n, n);
    const col = new THREE.Color();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = i * PX - w.half;
        const z = j * PX - w.half;
        const h = w.heightAt(x, z);
        const slope = w.slopeAt(x, z);
        w.layout.colour(x, z, h, slope, col);
        const shade = 0.75 + 0.25 * Math.max(-1, Math.min(1, (w.heightAt(x - 1, z - 1) - h) * 0.6 + 0.3));
        const k = (j * n + i) * 4;
        img.data[k] = Math.min(255, col.r * 255 * shade);
        img.data[k + 1] = Math.min(255, col.g * 255 * shade);
        img.data[k + 2] = Math.min(255, col.b * 255 * shade);
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Buildings and ruins.
    ctx.fillStyle = 'rgba(70, 55, 45, 0.85)';
    for (const b of w.boxes) {
      ctx.fillRect((b.minX + w.half) / PX, (b.minZ + w.half) / PX, Math.max(1, (b.maxX - b.minX) / PX), Math.max(1, (b.maxZ - b.minZ) / PX));
    }
    this.base = c;
    return c;
  }

  update(): void {
    if (this.game.world.layout.name !== 'main') {
      this.tracker.innerHTML = '';
      return;
    }
    this.frame++;
    if (this.frame % 3 !== 0) return;
    this.drawMini();
    if (this.game.hud.mapOpen) this.drawBig();
    const a = this.game.adventure;
    const lines = a.quests.tracker(a.owner());
    this.tracker.innerHTML = lines.slice(0, 14).join('<br>');
  }

  private markers(): { x: number; z: number; kind: string }[] {
    const a = this.game.adventure;
    const out: { x: number; z: number; kind: string }[] = [];
    for (const c of a.campfires.list) out.push({ x: c.x, z: c.z, kind: a.campfires.discovered.has(c.id) ? 'fire' : 'fireUnknown' });
    const who = a.owner();
    for (const n of a.town.npcs) {
      const ready = a.quests.open(n.def.id).some((q) => a.quests.ready(q, who));
      const offer = a.quests.offers(n.def.id, who).length > 0;
      if (ready || offer) out.push({ x: n.def.x, z: n.def.z, kind: ready ? 'handin' : 'quest' });
    }
    const h = this.game.world.homeSite;
    out.push({ x: h.x, z: h.z, kind: 'home' });
    const d = this.game.world.layout.dungeon;
    if (d) out.push({ x: d[0], z: d[1], kind: 'dungeon' });
    for (const q of a.quests.active()) {
      q.objectives.forEach((o, i) => {
        if (o.type === 'reach' && !a.quests.have(q, i, who)) out.push({ x: o.x, z: o.z, kind: 'goal' });
      });
    }
    return out;
  }

  private drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string, s: number): void {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#000';
    const col: Record<string, string> = {
      fire: '#ffa63a', fireUnknown: '#7d7468', quest: '#ffd23a', handin: '#7be06b', home: '#6fb6ff', dungeon: '#c070ff', goal: '#ffffff',
    };
    ctx.fillStyle = col[kind] ?? '#fff';
    ctx.beginPath();
    if (kind === 'fire' || kind === 'fireUnknown') ctx.arc(x, y, s, 0, Math.PI * 2);
    else if (kind === 'quest' || kind === 'handin') {
      ctx.moveTo(x, y - s * 1.3);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s * 1.3);
      ctx.lineTo(x - s, y);
      ctx.closePath();
    } else if (kind === 'goal') {
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.5 : s * 1.4;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
    } else ctx.rect(x - s, y - s, s * 2, s * 2);
    ctx.fill();
    ctx.stroke();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    const p = this.game.player;
    const f = p.facingVector();
    const a = Math.atan2(f.z, f.x);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(s * 1.4, 0);
    ctx.lineTo(-s, s);
    ctx.lineTo(-s * 0.4, 0);
    ctx.lineTo(-s, -s);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawMini(): void {
    const ctx = this.mini.getContext('2d')!;
    const w = this.game.world;
    const p = this.game.player.pos;
    const size = this.mini.width;
    const span = 160; // metres shown
    const scale = size / span; // px per metre
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#20180f';
    ctx.fillRect(0, 0, size, size);
    const sx = (p.x - span / 2 + w.half) / PX;
    const sz = (p.z - span / 2 + w.half) / PX;
    ctx.drawImage(this.baseImage(), sx, sz, span / PX, span / PX, 0, 0, size, size);
    for (const m of this.markers()) {
      let x = (m.x - p.x) * scale + size / 2;
      let y = (m.z - p.z) * scale + size / 2;
      // Clamp important markers to the edge.
      if (m.kind === 'fireUnknown' && (x < 0 || x > size || y < 0 || y > size)) continue;
      x = Math.max(5, Math.min(size - 5, x));
      y = Math.max(5, Math.min(size - 5, y));
      this.drawMarker(ctx, x, y, m.kind, 4);
    }
    this.drawPlayer(ctx, size / 2, size / 2, 5);
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, size, size);
    ctx.fillStyle = '#f4ecd8';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('N', size / 2 - 4, 13);
  }

  private drawBig(): void {
    const base = this.baseImage();
    const size = Math.min(window.innerHeight - 140, window.innerWidth - 60, 640);
    this.bigCanvas.width = this.bigCanvas.height = size;
    const ctx = this.bigCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0, size, size);
    const w = this.game.world;
    const k = size / w.size;
    const toPx = (x: number, z: number) => [(x + w.half) * k, (z + w.half) * k] as const;
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    for (const [name, x, z] of [['Emberhollow', 0, 0], ['Sunmeadow', 110, 120], ['Gloamwood', -170, -40], ['The Sundered Ruins', 80, -190]] as const) {
      const [px, py] = toPx(x, z);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(name, px + 1, py + 1);
      ctx.fillStyle = '#ffe8b0';
      ctx.fillText(name, px, py);
    }
    ctx.font = '11px sans-serif';
    const a = this.game.adventure;
    for (const c of a.campfires.list) {
      if (!a.campfires.discovered.has(c.id)) continue;
      const [px, py] = toPx(c.x, c.z);
      ctx.fillStyle = '#ffd8a0';
      ctx.fillText(c.name, px, py - 9);
    }
    for (const m of this.markers()) {
      const [px, py] = toPx(m.x, m.z);
      this.drawMarker(ctx, px, py, m.kind, 5);
    }
    const p = this.game.player.pos;
    const [px, py] = toPx(p.x, p.z);
    this.drawPlayer(ctx, px, py, 7);
  }
}
