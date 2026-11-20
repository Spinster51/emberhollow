// All movement tuning lives here so play-tests can adjust feel in one place.
// Units: metres, seconds. Starting values were informed by studying Veloren (see docs/DESIGN.md).
export const TUNING = {
  gravity: 25,
  radius: 0.35,
  height: 1.8,
  /** Height of the chest above the feet; climbing keeps the chest against the wall. */
  chest: 1.0,

  walkSpeed: 4.5,
  sprintSpeed: 8,
  groundAccel: 40,
  airAccel: 10,
  jumpVelocity: 9,
  stepUp: 0.45,
  /** Terrain steeper than this gradient (rise/run, ~50°) is a wall, not a slope. */
  maxWalkSlope: 1.2,

  stamina: {
    max: 100,
    regen: 30,
    regenDelay: 0.5,
    /** After running dry you must recover this fraction before using stamina again. */
    recoverFraction: 0.3,
    sprint: 12,
    roll: 15,
    climbIdle: 1,
    climbUp: 12,
    climbSide: 8,
    climbJump: 20,
    glide: 6,
  },

  roll: { buildup: 0.05, move: 0.36, recover: 0.125, startSpeed: 9, endSpeed: 3 },

  climb: {
    speed: 2.4,
    mantleTime: 0.35,
    /** Ledges up to this high above the feet are vaulted instead of climbed. */
    vaultMax: 1.25,
    jumpUp: 2.2,
    jumpUpTime: 0.3,
    jumpOffSpeed: 6,
  },

  glide: { speed: 8, sinkSpeed: 2, turnRate: 2.5, minHeight: 1.5 },

  fall: { safeSpeed: 16, damagePerSpeed: 4 },

  maxHp: 100,

  /** Milestone 2 combat. Times in seconds; see docs/DESIGN.md §11. */
  combat: {
    /** Presses are remembered this long so an early tap still fires. */
    buffer: 0.2,
    // Primary-attack combos live with each class in src/classes/classes.ts.
    /** Fire damage over time from the Emberfang legendary. */
    burn: { dps: 4, time: 3 },
    lifesteal: 0.08,
    regen: 2,
    reach: 2.2,
    /** Total arc of a sword swing, degrees. */
    arc: 110,
    /** Per-class melee combo reach / arc overrides (Option C). */
    classes: {
      warrior: { step3Arc: 100 },
      tank: { reach: 2.0, arc1: 110, arc2: 100 },
      assassin: { reach: 1.7, arc: 105 },
    },
    /** Active skill reaches, radii and arcs (metres, degrees). */
    skills: {
      chargeReach: 1.4,
      whirlwindReach: 2.8,
      warCryRadius: 10,
      earthsplitterLength: 7,
      earthsplitterHalfWidth: 1.2,
      riposteReach: 2.3,
      riposteArc: 120,
      tauntRadius: 10,
      shieldBashReach: 1.8,
      shieldBashArc: 100,
      frostNovaRadius: 5,
      shadowstepRange: 12,
      shadowstepBehind: 1.1,
      eviscerateReach: 2.0,
      eviscerateArc: 90,
    },
    /** Extra roll stamina when rolling out of an attack's wind-up or recovery. */
    rollCancelExtra: 10,
    block: { moveFactor: 0.4, arc: 90, strength: 0.4, parryWindow: 0.2 },
    poise: { max: 30, regen: 10, regenDelay: 2 },
    /** Poise fraction left after a hit → stagger kind (most severe crossed wins). */
    staggers: [
      { below: 0, kind: 'knockdown', time: 1.5 },
      { below: 0.25, kind: 'dazed', time: 0.75 },
      { below: 0.5, kind: 'stunned', time: 0.35 },
      { below: 0.75, kind: 'interrupted', time: 0.2 },
    ],
    staggerGrace: 1,
    staggeredDamageBonus: 1.25,
    deathTime: 2.5,
    hitStop: { light: 3, heavy: 6 },
    lockOn: { range: 25, flick: 40 },
  },

  // Crafting at the home workbench (DESIGN §10). Salvage yields the slot's material; upgrades
  // cost gold (goldBase × N²), slot materials (ceil(N/2)) and, from +8, Warden Embers.
  crafting: {
    maxPlus: 10,
    /** Each +1 multiplies an item's positive stats by (1 + this × plus). */
    plusPerLevel: 0.08,
    salvageYield: { common: 1, uncommon: 2, rare: 3, epic: 5, legendary: 8 } as Record<string, number>,
    goldBase: 10,
    emberFrom: 8,
    rerollAsh: 2,
    rerollGoldPerLevel: 25,
  },
  enemies: {
    respawnTime: 60,
    /** Camps respawn only when the player is at least this far away. */
    respawnDistance: 35,
    /** Enemies further than this from the player sleep (no AI). */
    sleepDistance: 110,
    /** Per level above an enemy's base level: HP ×(1 + hp), damage ×(1 + damage). */
    perLevel: { hp: 0.3, damage: 0.15, poise: 0.1 },
    /** Melee hit reach added to `stats.range` and melee hit arc (degrees). */
    meleeMargin: 0.25,
    meleeArc: 100,
    /** Melee AI circling and combo follow-up distances added to `stats.range`. */
    meleeCircleRange: 1.5,
    meleeCircleKeep: 0.5,
    meleeComboRange: 0.8,
    /** Contact margin added to `stats.radius + playerRadius` for lunges and charges. */
    lungeMargin: 0.35,
    /** Default projectile spawn height above `stats.centreY` and forward offset. */
    projectileYOffset: 0.2,
    projectileFwd: 0.5,
    /** Vertical tolerance for enemy slams. */
    slamY: 2,
    /** Cinder Warden boss chase, reach and projectile tuning. */
    boss: {
      closeRange: 3.5,
      stopDistance: 2.6,
      longRangeMin: 8,
      longRangeMax: 22,
      sweepReach: 3.5,
      sweepArc: 140,
      chargeMargin: 1.1,
      novaRadius: 9,
      volleyY: 2.2,
      volleySpread: 0.22,
      hitY: 2.5,
    },
  },
};

export type EnemyStyle = 'lunge' | 'charge' | 'melee' | 'ranged' | 'slam' | 'boss';

/** Per-kind enemy numbers at the kind's base level. Times in seconds, speeds m/s. */
export interface EnemyStats {
  name: string;
  style: EnemyStyle;
  baseLevel: number;
  hp: number;
  poise: number;
  radius: number;
  /** Height of the body centre and the top of the head (UI, hits). */
  centreY: number;
  topY: number;
  speed: number;
  aggro: number;
  leash: number;
  /** Attack range (ranged: shooting range). */
  range: number;
  windup: number;
  active: number;
  recover: number;
  damage: number;
  poiseDamage: number;
  knockback: number;
  cooldown: number;
  /** Lunge / charge speed. */
  lunge: number;
  /** Ranged: preferred distance and projectile. */
  keep?: number;
  projectile?: 'arrow' | 'orb';
  projectileSpeed?: number;
  /** Projectile spawn height above the enemy's feet (default `centreY + projectileYOffset`). */
  projectileY?: number;
  /** Slam radius. */
  aoe?: number;
  /** Lunge hits poison the player. */
  poison?: boolean;
  /** Melee: 2-hit combo. */
  combo?: boolean;
  /** Boss: phase 2 starts below this HP fraction. */
  phase2?: number;
}

const enemy = (s: EnemyStats) => s;

export const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  slime: enemy({
    name: 'Slime', style: 'lunge', baseLevel: 1, hp: 30, poise: 15, radius: 0.45, centreY: 0.4, topY: 0.9,
    speed: 2.4, aggro: 10, leash: 25, range: 1.6, windup: 0.45, active: 0.25, recover: 0.6,
    damage: 8, poiseDamage: 8, knockback: 3, cooldown: 1.2, lunge: 5,
  }),
  boar: enemy({
    name: 'Boar', style: 'charge', baseLevel: 2, hp: 60, poise: 40, radius: 0.75, centreY: 0.7, topY: 1.3,
    speed: 3.5, aggro: 14, leash: 30, range: 9, windup: 0.7, active: 1.1, recover: 1.0,
    damage: 18, poiseDamage: 30, knockback: 9, cooldown: 2.5, lunge: 12,
  }),
  bandit: enemy({
    name: 'Bandit', style: 'melee', baseLevel: 3, hp: 70, poise: 35, radius: 0.4, centreY: 1.2, topY: 2.1,
    speed: 4.2, aggro: 14, leash: 30, range: 1.5, windup: 0.4, active: 0.15, recover: 0.5,
    damage: 12, poiseDamage: 14, knockback: 3, cooldown: 1.0, lunge: 3, combo: true,
  }),
  wolf: enemy({
    name: 'Wolf', style: 'lunge', baseLevel: 5, hp: 55, poise: 25, radius: 0.65, centreY: 0.6, topY: 1.2,
    speed: 6, aggro: 16, leash: 35, range: 3.5, windup: 0.35, active: 0.35, recover: 0.5,
    damage: 14, poiseDamage: 14, knockback: 4, cooldown: 1.2, lunge: 10,
  }),
  spider: enemy({
    name: 'Spider', style: 'lunge', baseLevel: 6, hp: 50, poise: 20, radius: 0.9, centreY: 0.45, topY: 0.9,
    speed: 4.5, aggro: 12, leash: 30, range: 3, windup: 0.4, active: 0.3, recover: 0.6,
    damage: 10, poiseDamage: 10, knockback: 2, cooldown: 1.4, lunge: 8, poison: true,
  }),
  goblin: enemy({
    name: 'Goblin Archer', style: 'ranged', baseLevel: 7, hp: 40, poise: 15, radius: 0.35, centreY: 0.8, topY: 1.5,
    speed: 4.5, aggro: 22, leash: 35, range: 18, windup: 0.7, active: 0.1, recover: 0.6,
    damage: 12, poiseDamage: 8, knockback: 2, cooldown: 1.6, lunge: 0, keep: 11, projectile: 'arrow', projectileSpeed: 24,
    projectileY: 0.65,
  }),
  skeleton: enemy({
    name: 'Skeleton', style: 'melee', baseLevel: 10, hp: 90, poise: 40, radius: 0.4, centreY: 1.2, topY: 2.1,
    speed: 3.8, aggro: 15, leash: 30, range: 1.6, windup: 0.45, active: 0.15, recover: 0.5,
    damage: 18, poiseDamage: 16, knockback: 3, cooldown: 1.1, lunge: 3, combo: true,
  }),
  golem: enemy({
    name: 'Stone Golem', style: 'slam', baseLevel: 12, hp: 260, poise: 120, radius: 1.0, centreY: 1.6, topY: 3.3,
    speed: 2.4, aggro: 14, leash: 28, range: 3.0, windup: 1.0, active: 0.2, recover: 1.2,
    damage: 40, poiseDamage: 60, knockback: 9, cooldown: 2.4, lunge: 0, aoe: 3.2,
  }),
  cultist: enemy({
    name: 'Cultist', style: 'ranged', baseLevel: 11, hp: 70, poise: 25, radius: 0.4, centreY: 1.2, topY: 2.1,
    speed: 3.5, aggro: 22, leash: 32, range: 18, windup: 0.9, active: 0.1, recover: 0.7,
    damage: 24, poiseDamage: 20, knockback: 4, cooldown: 2.2, lunge: 0, keep: 12, projectile: 'orb', projectileSpeed: 13,
    projectileY: 1.4,
  }),
  // The dungeon boss (DESIGN §7). Moves: sweep, slam, charge; phase 2 adds orb volleys, a fire
  // nova and two skeleton adds, and everything gets faster. Wind-ups below are per move.
  warden: enemy({
    name: 'The Cinder Warden', style: 'boss', baseLevel: 16, hp: 2600, poise: 400, radius: 1.3, centreY: 2.3, topY: 4.6,
    speed: 3.4, aggro: 24, leash: 60, range: 3.5, windup: 0.85, active: 0.25, recover: 0.9,
    damage: 42, poiseDamage: 45, knockback: 8, cooldown: 1.3, lunge: 15, aoe: 4.8,
    projectile: 'orb', projectileSpeed: 14, projectileY: 2.2, phase2: 0.5,
  }),
};

/** Loot per kill: XP, gold range, chance of gear, the family's crafting material. */
export const ENEMY_LOOT: Record<EnemyKind, { xp: number; gold: [number, number]; gear: number; material: string; materialChance: number }> = {
  slime: { xp: 12, gold: [1, 4], gear: 0.15, material: 'gel', materialChance: 0.7 },
  boar: { xp: 25, gold: [3, 8], gear: 0.3, material: 'hide', materialChance: 0.7 },
  bandit: { xp: 35, gold: [6, 15], gear: 0.45, material: 'cloth', materialChance: 0.6 },
  wolf: { xp: 50, gold: [5, 12], gear: 0.25, material: 'fang', materialChance: 0.6 },
  spider: { xp: 55, gold: [5, 12], gear: 0.25, material: 'silk', materialChance: 0.7 },
  goblin: { xp: 60, gold: [10, 22], gear: 0.4, material: 'feather', materialChance: 0.6 },
  skeleton: { xp: 80, gold: [12, 26], gear: 0.4, material: 'bone', materialChance: 0.7 },
  golem: { xp: 160, gold: [30, 60], gear: 0.8, material: 'core', materialChance: 0.9 },
  cultist: { xp: 90, gold: [15, 30], gear: 0.5, material: 'ash', materialChance: 0.6 },
  warden: { xp: 3000, gold: [400, 700], gear: 1, material: 'ember', materialChance: 1 },
};

export type EnemyKind = 'slime' | 'boar' | 'bandit' | 'wolf' | 'spider' | 'goblin' | 'skeleton' | 'golem' | 'cultist' | 'warden';
export type StaggerKind = 'interrupted' | 'stunned' | 'dazed' | 'knockdown';
