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
    reach: 2.4,
    /** Total arc of a sword swing, degrees. */
    arc: 120,
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

  enemies: {
    /**
     * Loot per kill: gold range, chance of a piece of gear, the family's crafting material.
     * `level` sets item level (meadow 1–3).
     */
    loot: {
      slime: { level: 1, xp: 12, gold: [1, 4], gear: 0.15, material: 'gel', materialChance: 0.7 },
      boar: { level: 2, xp: 25, gold: [3, 8], gear: 0.3, material: 'hide', materialChance: 0.7 },
      bandit: { level: 3, xp: 35, gold: [6, 15], gear: 0.45, material: 'cloth', materialChance: 0.6 },
    },
    respawnTime: 60,
    /** Camps respawn only when the player is at least this far away. */
    respawnDistance: 35,
    slime: {
      hp: 30, poise: 15, radius: 0.45, speed: 2.4, aggro: 10, leash: 25, range: 1.6,
      windup: 0.45, active: 0.25, recover: 0.6, damage: 8, poiseDamage: 8, knockback: 3, cooldown: 1.2,
      lunge: 5,
    },
    boar: {
      hp: 60, poise: 40, radius: 0.6, speed: 3.5, aggro: 14, leash: 30, range: 9,
      windup: 0.7, active: 1.1, recover: 1.0, damage: 18, poiseDamage: 30, knockback: 9, cooldown: 2.5,
      lunge: 12,
    },
    bandit: {
      hp: 70, poise: 35, radius: 0.4, speed: 4.2, aggro: 14, leash: 30, range: 2.0,
      windup: 0.4, active: 0.15, recover: 0.5, damage: 12, poiseDamage: 14, knockback: 3, cooldown: 1.0,
      lunge: 3,
    },
  },
};

export type EnemyKind = 'slime' | 'boar' | 'bandit';
export type StaggerKind = 'interrupted' | 'stunned' | 'dazed' | 'knockdown';
