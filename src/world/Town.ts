import * as THREE from 'three';
import { addOutline, toonMaterial } from '../core/toon';
import type { Interactable } from '../loot/Loot';
import type { Dialog, DialogOption } from '../ui/Dialog';
import { FURNITURE } from '../home/furniture';
import type { Home } from '../home/Home';
import { QUEST_BY_ID, objectiveText, type QuestDef, type QuestLog, type QuestOwner } from './quests';
import type { World } from './World';

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  x: number;
  z: number;
  coat: number;
  hat: number;
  greeting: string;
}

export const NPCS: NpcDef[] = [
  { id: 'elder', name: 'Elder Maren', title: 'Village Elder', x: 6, z: -12, coat: 0x6a4a8a, hat: 0xd8d0c0, greeting: 'Welcome to Emberhollow, traveller. These are uneasy days.' },
  { id: 'steward', name: 'Steward Ilsa', title: 'Town Steward', x: -14, z: 14, coat: 0x2f6a5a, hat: 0x5b3a20, greeting: 'Need a place to call home? I look after the houses here.' },
  { id: 'tinker', name: 'Tinker Oswin', title: 'Inventor', x: 16, z: 10, coat: 0x8a6a2a, hat: 0x3a3530, greeting: 'Mind the springs! Everything here is either broken or brilliant.' },
  { id: 'hunter', name: 'Hunter Kael', title: 'Huntsman', x: -18, z: -6, coat: 0x4d6a2f, hat: 0x6b4a2b, greeting: 'The wilds are restless. Good hunting pays, if you are up to it.' },
  { id: 'scholar', name: 'Scholar Vey', title: 'Ruin Scholar', x: -2, z: -19, coat: 0x3a4a8a, hat: 0x9a7ab0, greeting: 'The ruins to the north hold secrets older than this town.' },
  { id: 'carpenter', name: 'Carpenter Bram', title: 'Carpenter', x: 8, z: 16, coat: 0x8a4a2a, hat: 0xc9a13b, greeting: 'Tables, shelves, banners — whatever a home needs.' },
];

/** What the town needs from the game. */
export interface TownContext {
  quests: QuestLog;
  owner(): QuestOwner;
  dialog: Dialog;
  home: Home;
  gold(): number;
  spendGold(n: number): void;
  /** Consume materials/gold and give rewards. */
  turnIn(q: QuestDef): void;
  message(text: string): void;
  /** A picture of a furniture piece for the shop (image URL). */
  furnitureIcon?(type: string): string;
}

interface Npc {
  def: NpcDef;
  root: THREE.Group;
  pos: THREE.Vector3;
  marker: THREE.Mesh;
}

/** Villagers in the town square: talk to them for quests and the carpenter's shop. */
export class Town {
  readonly group = new THREE.Group();
  readonly npcs: Npc[] = [];

  constructor(world: World, private ctx: TownContext) {
    if (world.layout.name !== 'main') return;
    for (const def of NPCS) {
      const pos = new THREE.Vector3(def.x, world.groundAt(def.x, def.z, 1e9), def.z);
      const root = buildVillager(def);
      root.position.copy(pos);
      const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0xffd23a }));
      marker.position.y = 2.6;
      root.add(marker);
      this.group.add(root);
      this.npcs.push({ def, root, pos, marker });
    }
  }

  /** Face the player when close; show "!" over villagers with work for you, "?" when ready to hand in. */
  animate(t: number, playerPos: THREE.Vector3): void {
    const q = this.ctx.quests;
    const who = this.ctx.owner();
    for (const n of this.npcs) {
      const d = n.pos.distanceTo(playerPos);
      if (d < 8) n.root.rotation.y = Math.atan2(-(playerPos.x - n.pos.x), -(playerPos.z - n.pos.z));
      const ready = q.open(n.def.id).some((x) => q.ready(x, who));
      const offer = q.offers(n.def.id, who).length > 0;
      n.marker.visible = ready || offer;
      (n.marker.material as THREE.MeshBasicMaterial).color.setHex(ready ? 0x7be06b : 0xffd23a);
      n.marker.position.y = 2.6 + Math.sin(t * 3) * 0.08;
      n.marker.rotation.y = t * 2;
    }
  }

  interactables(playerPos: THREE.Vector3): Interactable[] {
    return this.npcs
      .filter((n) => n.pos.distanceTo(playerPos) < 3)
      .map((n) => ({ pos: n.pos, radius: 2.6, label: `Talk to ${n.def.name}`, color: '#ffd27a', act: () => this.talk(n.def.id) }));
  }

  /** Open the conversation with a villager. */
  talk(id: string, lead = ''): void {
    const def = NPCS.find((n) => n.id === id)!;
    const { quests, home } = this.ctx;
    const who = this.ctx.owner();
    // Another character on this account may already own / have expanded the house.
    if (id === 'steward') {
      if (home.owned && quests.status('house') !== 'done') quests.states.house = { status: 'done', progress: [1] };
      if (home.expanded && quests.status('expand') !== 'done') quests.states.expand = { status: 'done', progress: [1, 1, 1] };
    }
    const opts: DialogOption[] = [];
    for (const q of quests.open(id)) {
      if (quests.ready(q, who)) opts.push({ label: `Hand in: ${q.name}`, action: () => this.handIn(q) });
      else opts.push({ label: `${q.name} (in progress)`, keepOpen: true, action: () => this.progress(id, q) });
    }
    for (const q of quests.offers(id, who)) {
      opts.push({ label: `Quest: ${q.name}`, keepOpen: true, action: () => this.offer(id, q) });
    }
    if (id === 'carpenter') opts.push({ label: 'Buy furniture', keepOpen: true, action: () => this.shop() });
    opts.push({ label: 'Goodbye' });
    const later = quests.later(id, who);
    const hint = later.length ? `<p class="hint">Come back at level ${Math.min(...later.map((q) => q.level ?? 1))} — I may have more work for you.</p>` : '';
    this.ctx.dialog.show({ title: `${def.name} · ${def.title}`, text: `${lead}<p>${def.greeting}</p>${hint}`, options: opts });
  }

  private offer(npc: string, q: QuestDef): void {
    const goals = q.objectives.map((o) => `<li>${objectiveText(o, 0)}</li>`).join('');
    const reward = rewardText(q);
    this.ctx.dialog.show({
      title: q.name,
      text: `<p>${q.intro}</p><ul>${goals}</ul><p class="reward">Reward: ${reward}</p>`,
      options: [
        {
          label: 'Accept',
          keepOpen: true,
          action: () => {
            this.ctx.quests.accept(q.id);
            this.talk(npc, `<p class="ok">Quest accepted: ${q.name}</p>`);
          },
        },
        { label: 'Not now', keepOpen: true, action: () => this.talk(npc) },
      ],
    });
  }

  private progress(npc: string, q: QuestDef): void {
    const who = this.ctx.owner();
    const goals = q.objectives.map((o, i) => `<li>${objectiveText(o, this.ctx.quests.have(q, i, who))}</li>`).join('');
    this.ctx.dialog.show({
      title: q.name,
      text: `<p>${q.intro}</p><ul>${goals}</ul>`,
      options: [{ label: 'Back', keepOpen: true, action: () => this.talk(npc) }],
    });
  }

  private handIn(q: QuestDef): void {
    this.ctx.turnIn(q);
    this.ctx.dialog.show({
      title: `${q.name} — complete`,
      text: `<p>${q.done}</p><p class="reward">Reward: ${rewardText(q)}</p>`,
      options: [{ label: 'Thanks', keepOpen: true, action: () => this.talk(q.giver) }],
    });
  }

  /** Carpenter's furniture shop. */
  shop(): void {
    const opts: DialogOption[] = Object.entries(FURNITURE).map(([type, f]) => ({
      label: `${f.name} — ${f.price} gold${this.ctx.home.stock[type] ? ` (have ${this.ctx.home.stock[type]})` : ''}`,
      icon: this.ctx.furnitureIcon?.(type),
      disabled: this.ctx.gold() < f.price,
      keepOpen: true,
      action: () => {
        this.ctx.spendGold(f.price);
        this.ctx.home.buy(type);
        this.ctx.message(`Bought: ${f.name}. Place it from the furniture crate in your home.`);
        this.shop();
      },
    }));
    opts.push({ label: 'Back', keepOpen: true, action: () => this.talk('carpenter') });
    this.ctx.dialog.show({
      title: 'Carpenter Bram · Furniture',
      text: `<p>Pieces are delivered to the crate by your front door. You have <b>${this.ctx.gold()} gold</b>.</p>`,
      options: opts,
    });
  }
}

export function rewardText(q: QuestDef): string {
  const r = q.reward;
  const parts: string[] = [];
  if (r.gold) parts.push(`${r.gold} gold`);
  if (r.xp) parts.push(`${r.xp} XP`);
  if (r.item) parts.push(`a ${r.item} item`);
  if (r.unlock === 'house') parts.push('your own house');
  if (r.unlock === 'glider') parts.push('a glider');
  if (r.unlock === 'expansion') parts.push('the back room');
  return parts.join(', ');
}

function buildVillager(def: NpcDef): THREE.Group {
  const root = new THREE.Group();
  const skin = toonMaterial(0xe0b48a);
  const coat = toonMaterial(def.coat);
  const hat = toonMaterial(def.hat);
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, outline = true) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    if (outline) addOutline(mesh);
    root.add(mesh);
  };
  box(0.6, 1.0, 0.36, coat, 0, 0.95, 0); // long coat
  box(0.2, 0.5, 0.2, toonMaterial(0x3a3028), -0.14, 0.25, 0);
  box(0.2, 0.5, 0.2, toonMaterial(0x3a3028), 0.14, 0.25, 0);
  box(0.17, 0.6, 0.17, coat, -0.39, 1.15, 0);
  box(0.17, 0.6, 0.17, coat, 0.39, 1.15, 0);
  box(0.42, 0.42, 0.42, skin, 0, 1.68, 0);
  box(0.5, 0.14, 0.5, hat, 0, 1.92, 0, false);
  const eye = new THREE.MeshBasicMaterial({ color: 0x1a1010 });
  for (const x of [-0.1, 0.1]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), eye);
    e.position.set(x, 1.7, -0.215);
    root.add(e);
  }
  return root;
}

/** Re-export for the quest tracker. */
export { QUEST_BY_ID };
