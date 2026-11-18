import {
  ATTRS, ATTR_POINTS_PER_LEVEL, CLASSES, MAX_LEVEL, MAX_RANK, PASSIVES, SKILLS, xpToNext,
  type Attr, type ClassDef, type ClassId,
} from './classes';

/** Level, XP, allocated attributes and skill-tree ranks for one character. */
export class Progression {
  cls: ClassId = 'warrior';
  level = 1;
  xp = 0;
  readonly attrs: Record<Attr, number> = { str: 0, int: 0, dex: 0, vit: 0 };
  attrPoints = 0;
  skillPoints = 0;
  /** Tree ranks by node id (skills and passives). */
  readonly ranks: Record<string, number> = {};
  /** Bumped on every change (stats and UI refresh). */
  version = 0;

  get def(): ClassDef {
    return CLASSES[this.cls];
  }

  reset(cls: ClassId): void {
    this.cls = cls;
    this.level = 1;
    this.xp = 0;
    for (const a of ATTRS) this.attrs[a] = 0;
    this.attrPoints = 0;
    this.skillPoints = 0;
    for (const k of Object.keys(this.ranks)) delete this.ranks[k];
    this.version++;
  }

  /** Add XP; returns how many levels were gained. */
  addXp(n: number): number {
    if (this.level >= MAX_LEVEL) return 0;
    this.xp += n;
    let gained = 0;
    while (this.level < MAX_LEVEL && this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
      this.attrPoints += ATTR_POINTS_PER_LEVEL;
      this.skillPoints += 1;
      gained++;
    }
    if (this.level >= MAX_LEVEL) this.xp = 0;
    this.version++;
    return gained;
  }

  allocate(a: Attr, n = 1): boolean {
    if (this.attrPoints < n) return false;
    this.attrPoints -= n;
    this.attrs[a] += n;
    this.version++;
    return true;
  }

  rank(id: string): number {
    return this.ranks[id] ?? 0;
  }

  /** Spend a skill point on a tree node. Skill nodes need the skill unlocked. */
  rankUp(id: string): string | null {
    if (this.skillPoints < 1) return 'No skill points.';
    if (!this.def.skills.includes(id) && !this.def.passives.includes(id)) return 'Not in your tree.';
    if (this.rank(id) >= MAX_RANK) return 'Already at max rank.';
    const skill = SKILLS[id];
    if (skill && this.level < skill.unlock) return `Unlocks at level ${skill.unlock}.`;
    this.ranks[id] = this.rank(id) + 1;
    this.skillPoints--;
    this.version++;
    return null;
  }

  /** Refund every attribute and skill point. */
  respec(): void {
    for (const a of ATTRS) {
      this.attrPoints += this.attrs[a];
      this.attrs[a] = 0;
    }
    for (const k of Object.keys(this.ranks)) {
      this.skillPoints += this.ranks[k];
      delete this.ranks[k];
    }
    this.version++;
  }

  respecCost(): number {
    return 20 * this.level;
  }

  skillUnlocked(id: string): boolean {
    return this.def.skills.includes(id) && this.level >= SKILLS[id].unlock;
  }

  /** Sum of a passive stat from the tree. */
  passive(stat: string): number {
    let v = 0;
    for (const id of this.def.passives) {
      const p = PASSIVES[id];
      if (p.stat === stat) v += p.perRank * this.rank(id);
    }
    return v;
  }
}
