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
};
