// Town quests (DESIGN §13: light story, kill/collect quests, the glider quest, a reason to
// beat the dungeon boss). Original names and text.

import type { EnemyKind } from '../config';
import { ENEMY_STATS } from '../config';
import { MATERIALS, type Rarity } from '../items/items';

export type Objective =
  | { type: 'kill'; kind: EnemyKind; count: number }
  | { type: 'collect'; material: string; count: number }
  | { type: 'pay'; gold: number }
  | { type: 'reach'; x: number; z: number; r: number; label: string };

export type Unlock = 'house' | 'glider' | 'expansion' | 'dungeon';

export interface QuestDef {
  id: string;
  name: string;
  giver: string;
  /** What the giver says when offering it. */
  intro: string;
  /** What they say when you hand it in. */
  done: string;
  objectives: Objective[];
  reward: { gold?: number; xp?: number; item?: Rarity; unlock?: Unlock };
  requires?: string[];
  level?: number;
}

export const QUESTS: QuestDef[] = [
  {
    id: 'slimes', name: 'Slime Trouble', giver: 'elder',
    intro: 'Slimes have crept up from the fields and are souring the wells. Thin them out for us — six should do.',
    done: 'The water already tastes cleaner. You have a steady hand, traveller.',
    objectives: [{ type: 'kill', kind: 'slime', count: 6 }],
    reward: { gold: 50, xp: 60 },
  },
  {
    id: 'house', name: 'A Roof of Your Own', giver: 'steward',
    intro: 'The empty house by the west lane needs an owner. 150 gold and it is yours — chest, racks, bed and all.',
    done: 'Here is the key. Welcome home!',
    objectives: [{ type: 'pay', gold: 150 }],
    reward: { unlock: 'house', xp: 50 },
  },
  {
    id: 'glider', name: 'Wings of Cloth', giver: 'tinker',
    intro: 'I can build you a glider — a frame of boar hide and bandit cloth. Bring me 4 Bandit Cloth and 3 Boar Hide.',
    done: 'There! Jump, then jump again in the air to open it. Mind your stamina.',
    objectives: [{ type: 'collect', material: 'cloth', count: 4 }, { type: 'collect', material: 'hide', count: 3 }],
    reward: { unlock: 'glider', xp: 120 },
    requires: ['slimes'],
  },
  {
    id: 'boars', name: 'Tusks in the Fields', giver: 'hunter',
    intro: 'The boars are trampling the crops. Five of them, and I will make it worth your while.',
    done: 'Good hunting. Take this — I will not be needing it.',
    objectives: [{ type: 'kill', kind: 'boar', count: 5 }],
    reward: { gold: 80, xp: 100, item: 'uncommon' },
  },
  {
    id: 'bandits', name: 'The Bandit Camp', giver: 'elder',
    intro: 'Bandits camp out east and rob our carts. Scatter them: six should send the rest running.',
    done: 'The roads are safe again. This was taken from their leader — it is yours now.',
    objectives: [{ type: 'kill', kind: 'bandit', count: 6 }],
    reward: { gold: 120, xp: 200, item: 'rare' },
    requires: ['slimes'],
  },
  {
    id: 'wolves', name: 'Wolves at the Treeline', giver: 'hunter', level: 5,
    intro: 'Gloamwood wolves have grown bold. Eight pelts would calm the shepherds.',
    done: 'Fine work. The woods will be quieter tonight.',
    objectives: [{ type: 'kill', kind: 'wolf', count: 8 }],
    reward: { gold: 150, xp: 400, item: 'rare' },
  },
  {
    id: 'silk', name: 'Silk for the Weavers', giver: 'hunter', level: 5,
    intro: 'The weavers pay well for spider silk. Six bundles, if you can stomach the spiders.',
    done: 'Ugh, still sticky. Here is your share.',
    objectives: [{ type: 'collect', material: 'silk', count: 6 }],
    reward: { gold: 200, xp: 400 },
  },
  {
    id: 'goblins', name: 'Arrows in the Dark', giver: 'hunter', level: 7,
    intro: 'Goblin archers shoot at anyone on the deep paths. Six of them, please.',
    done: 'No more arrows in the dark. Take this bow-breaker’s prize.',
    objectives: [{ type: 'kill', kind: 'goblin', count: 6 }],
    reward: { gold: 200, xp: 600, item: 'rare' },
  },
  {
    id: 'bones', name: 'Restless Bones', giver: 'scholar', level: 10,
    intro: 'The dead walk in the Sundered Ruins. Put ten of them back to rest so I can study the stones.',
    done: 'Remarkable. The carvings speak of a sealed hall beneath the ruins…',
    objectives: [{ type: 'kill', kind: 'skeleton', count: 10 }],
    reward: { gold: 300, xp: 1200, item: 'epic' },
  },
  {
    id: 'cult', name: 'The Ash Cult', giver: 'scholar', level: 11,
    intro: 'Robed cultists burn offerings in the ruins. Stop six of them before their fire spreads.',
    done: 'Their ash smells of the deep hall. Whatever they serve is down there.',
    objectives: [{ type: 'kill', kind: 'cultist', count: 6 }],
    reward: { gold: 300, xp: 1400, item: 'epic' },
  },
  {
    id: 'sealed', name: 'The Sealed Door', giver: 'elder', level: 10,
    intro: 'Something old stirs under the ruins — the cultists, the walking dead, the tremors. Find the great sealed door in the far north of the ruins and tell me what you see.',
    done: 'Sealed, you say… then whatever is below is trying to get out. These words from the old carvings should open it. Rest, and ready yourself before you go down.',
    objectives: [{ type: 'reach', x: 160, z: -213, r: 12, label: 'Find the sealed door in the Sundered Ruins' }],
    reward: { xp: 2000, gold: 250, unlock: 'dungeon' },
  },
  {
    id: 'warden', name: 'Embers Below', giver: 'elder', level: 13, requires: ['sealed'],
    intro: 'The tremors come from the vault beneath the sealed door. The carvings name its keeper: the Cinder Warden. Go down, find your way past its locks, and put out that fire for good.',
    done: 'The tremors have stopped. Emberhollow sleeps easy tonight — because of you. Take this; it was meant for a hero.',
    objectives: [{ type: 'kill', kind: 'warden', count: 1 }],
    reward: { xp: 5000, gold: 1000, item: 'legendary' },
  },
  {
    id: 'expand', name: 'More Room', giver: 'steward',
    intro: 'Running out of wall space? I can open up the back room of your house: 300 gold, 5 Boar Hide and 5 Wolf Fang for the builders.',
    done: 'The back room is open. More racks, more trophies!',
    objectives: [{ type: 'pay', gold: 300 }, { type: 'collect', material: 'hide', count: 5 }, { type: 'collect', material: 'fang', count: 5 }],
    reward: { unlock: 'expansion', xp: 300 },
    requires: ['house'],
  },
];

export const QUEST_BY_ID = Object.fromEntries(QUESTS.map((q) => [q.id, q])) as Record<string, QuestDef>;

export type QuestStatus = 'active' | 'done';

export interface QuestState {
  status: QuestStatus;
  /** Kills per objective index (kill objectives) / reached flags. */
  progress: number[];
}

/** What the quest system needs to know about the player. */
export interface QuestOwner {
  level: number;
  gold: number;
  material(id: string): number;
}

export function objectiveText(o: Objective, have: number): string {
  switch (o.type) {
    case 'kill':
      if (o.count === 1) return `Defeat ${ENEMY_STATS[o.kind].name}${have >= 1 ? ' ✓' : ''}`;
      return `Defeat ${ENEMY_STATS[o.kind].name}s: ${Math.min(have, o.count)}/${o.count}`;
    case 'collect':
      return `${MATERIALS[o.material]?.name ?? o.material}: ${Math.min(have, o.count)}/${o.count}`;
    case 'pay':
      return `Gold: ${Math.min(have, o.gold)}/${o.gold}`;
    case 'reach':
      return have ? `${o.label} ✓` : o.label;
  }
}

/** Per-character quest log. */
export class QuestLog {
  readonly states: Record<string, QuestState> = {};
  /** Messages for the HUD ("Quest accepted", "objective complete"). */
  readonly news: string[] = [];

  status(id: string): QuestStatus | 'available' | 'locked' {
    const s = this.states[id];
    if (s) return s.status;
    return 'available';
  }

  /** Quests this NPC can offer now. */
  offers(npc: string, who: QuestOwner): QuestDef[] {
    return QUESTS.filter(
      (q) =>
        q.giver === npc &&
        !this.states[q.id] &&
        (q.requires ?? []).every((r) => this.states[r]?.status === 'done') &&
        who.level >= (q.level ?? 1),
    );
  }

  /** Quests this NPC gave that are still open. */
  open(npc: string): QuestDef[] {
    return QUESTS.filter((q) => q.giver === npc && this.states[q.id]?.status === 'active');
  }

  /** Locked offers (for "come back at level N" hints). */
  later(npc: string, who: QuestOwner): QuestDef[] {
    return QUESTS.filter(
      (q) =>
        q.giver === npc &&
        !this.states[q.id] &&
        (q.requires ?? []).every((r) => this.states[r]?.status === 'done') &&
        who.level < (q.level ?? 1),
    );
  }

  accept(id: string): void {
    if (this.states[id]) return;
    this.states[id] = { status: 'active', progress: QUEST_BY_ID[id].objectives.map(() => 0) };
    this.news.push(`Quest accepted: ${QUEST_BY_ID[id].name}`);
  }

  active(): QuestDef[] {
    return QUESTS.filter((q) => this.states[q.id]?.status === 'active');
  }

  onKill(kind: EnemyKind): void {
    for (const q of this.active()) {
      q.objectives.forEach((o, i) => {
        if (o.type !== 'kill' || o.kind !== kind) return;
        const st = this.states[q.id];
        if (st.progress[i] < o.count) {
          st.progress[i]++;
          if (st.progress[i] === o.count) this.news.push(`${q.name}: objective complete`);
        }
      });
    }
  }

  onMove(x: number, z: number): void {
    for (const q of this.active()) {
      q.objectives.forEach((o, i) => {
        if (o.type !== 'reach') return;
        const st = this.states[q.id];
        if (!st.progress[i] && Math.hypot(x - o.x, z - o.z) < o.r) {
          st.progress[i] = 1;
          this.news.push(`${q.name}: objective complete`);
        }
      });
    }
  }

  /** Current amount for an objective. */
  have(q: QuestDef, i: number, who: QuestOwner): number {
    const o = q.objectives[i];
    if (o.type === 'collect') return who.material(o.material);
    if (o.type === 'pay') return who.gold;
    return this.states[q.id]?.progress[i] ?? 0;
  }

  ready(q: QuestDef, who: QuestOwner): boolean {
    return q.objectives.every((o, i) => {
      const h = this.have(q, i, who);
      return o.type === 'kill' ? h >= o.count : o.type === 'collect' ? h >= o.count : o.type === 'pay' ? h >= o.gold : h > 0;
    });
  }

  complete(id: string): void {
    this.states[id].status = 'done';
  }

  /** Lines for the HUD tracker. */
  tracker(who: QuestOwner): string[] {
    const out: string[] = [];
    for (const q of this.active()) {
      out.push(`<b>${q.name}</b>${this.ready(q, who) ? ' — <span class="ok">hand in</span>' : ''}`);
      q.objectives.forEach((o, i) => out.push(`· ${objectiveText(o, this.have(q, i, who))}`));
    }
    return out;
  }

  toJSON(): Record<string, QuestState> {
    return this.states;
  }

  load(data: Record<string, QuestState>): void {
    for (const k of Object.keys(this.states)) delete this.states[k];
    Object.assign(this.states, data ?? {});
  }
}
