/**
 * Every per-level stat curve a mob is levelled by, in one pure module.
 *
 * Pure and free of game-object imports so a headless script can read the real
 * curves rather than a copy of them that could drift; `scripts/verify-difficulty.ts`
 * asserts the cadence curve and the locked-telegraph floor this way.
 *
 * Why the HP and damage curves are shallow: a fight's cost to the player is
 * roughly how long the mob survives times how fast it drains them, so the mob's
 * side of that cost is HP × damage ÷ cadence — three curves multiplied together.
 * The player earns one stat point per level spread across four stats, which
 * grows their side of the same product far more slowly. The rates below are the
 * ones meant to keep an on-schedule party's share of HP lost per fight nearly
 * flat, drifting slowly upward; the rates themselves are tuned by playtest.
 *
 * Every curve also carries an explicit ceiling on its multiplier, independent
 * of the spawner's level cap, so raising that cap cannot carry any curve past
 * its ceiling.
 */

/** HP added per level above 1, as a fraction of the mob's authored max HP. */
const MOB_LEVEL_HP_SCALE = 0.17;
/** Hard ceiling on the HP multiplier, whatever level a mob is given. */
export const MAX_MOB_HP_MULTIPLIER = 4.23;

/** Damage added per level above 1, as a fraction of the blow's authored damage. */
const MOB_LEVEL_DAMAGE_SCALE = 0.1125;
/** Hard ceiling on the damage multiplier, whatever level a mob is given. */
const MAX_MOB_DAMAGE_MULTIPLIER = 3.14;

/**
 * Walk speed added per level above 1, as a fraction of the authored speed.
 *
 * `Mob.levelledSpeedCap` still bounds the result against the player's own
 * speed; this ceiling bounds the multiplier itself.
 */
const MOB_LEVEL_SPEED_SCALE = 0.08;
/** Hard ceiling on the speed multiplier, whatever level a mob is given. */
const MAX_MOB_SPEED_MULTIPLIER = 2.52;

/**
 * Projectile flight speed added per level above 1, as a fraction of the
 * projectile's authored speed. Each projectile keeps its own absolute cap as a
 * fraction of `PLAYER_SPEED`, so a bolt stays outrunnable; this bounds only the
 * level multiplier.
 */
const MOB_LEVEL_PROJECTILE_SPEED_SCALE = 0.04;
/** Hard ceiling on the projectile speed multiplier, whatever level a mob is given. */
const MAX_MOB_PROJECTILE_SPEED_MULTIPLIER = 1.76;

/**
 * The shortest a scaled cooldown ever gets, as a fraction of its level-1 value.
 *
 * The cadence axis: threat is damage × cadence × hit-rate × count, and a mob
 * whose attack clock never moved with level would survive longer at higher
 * levels without ever becoming more dangerous — the definition of an HP sponge.
 *
 * Asymptotic and floored rather than linear, because the failure mode at the far
 * end is a machine gun: the curve is steepest over the first few levels, where
 * the player feels it, and flattens out well before it becomes unreactable.
 */
export const CADENCE_SCALE_FLOOR = 0.55;
/** How quickly {@link CADENCE_SCALE_FLOOR} is approached; larger is faster. */
const CADENCE_RATE = 0.12;

/** Levels above the first, never negative. */
function levelsAboveFirst(level: number): number {
  return Math.max(0, level - 1);
}

/** A linear per-level multiplier, held under its own ceiling. */
function linearScale(level: number, perLevel: number, ceiling: number): number {
  return Math.min(ceiling, 1 + levelsAboveFirst(level) * perLevel);
}

/**
 * The per-level HP and damage curve a floor levels its mobs by. Every floor
 * uses {@link SHARED_LEVELLED_CURVE} unless its `LevelDef.levelledCurve` names
 * another; walk speed, projectile speed and cadence have one curve everywhere.
 *
 * A level-1 mob is its authored self under every curve, since every rate here
 * multiplies only the levels above the first.
 */
export interface LevelledCurve {
  /** HP added per level above 1, as a fraction of the mob's authored max HP. */
  readonly hpPerLevel: number;
  /** Damage added per level above 1, as a fraction of the blow's authored damage. */
  readonly damagePerLevel: number;
  /** Whether levelled max HP and every levelled blow round up to a whole point. */
  readonly roundsUp: boolean;
}

/** The curve every floor is balanced on unless it names its own. */
export const SHARED_LEVELLED_CURVE: LevelledCurve = {
  hpPerLevel: MOB_LEVEL_HP_SCALE,
  damagePerLevel: MOB_LEVEL_DAMAGE_SCALE,
  roundsUp: false,
};

/** HP added per level above 1 on the curve the learning floor was tuned on. */
const LEARNING_FLOOR_HP_PER_LEVEL = 0.3;
/** Damage added per level above 1 on the curve the learning floor was tuned on. */
const LEARNING_FLOOR_DAMAGE_PER_LEVEL = 0.2;

/**
 * The curve floor 1's bands, region bonuses, bosses and defend-quest wave were
 * tuned on, kept for that floor alone when the shared curve was flattened for
 * the deeper ones: steeper, and rounded up, so a one-point goblin blade hits
 * for two from level 2. Floor 1's levelled mobs meet every blow and HP value
 * they were tuned with; the spike rounding causes is the one the floor was
 * built around, and it never reaches a floor that did not choose it.
 */
export const LEARNING_FLOOR_LEVELLED_CURVE: LevelledCurve = {
  hpPerLevel: LEARNING_FLOOR_HP_PER_LEVEL,
  damagePerLevel: LEARNING_FLOOR_DAMAGE_PER_LEVEL,
  roundsUp: true,
};

/** A levelled value rounded as `curve` rounds it. */
function roundedForCurve(value: number, curve: LevelledCurve): number {
  return curve.roundsUp ? Math.ceil(value) : value;
}

/** What a mob of this level multiplies its authored max HP by. */
export function hpScaleForLevel(level: number, curve = SHARED_LEVELLED_CURVE): number {
  return linearScale(level, curve.hpPerLevel, MAX_MOB_HP_MULTIPLIER);
}

/** A mob's max HP at `level`, from the authored value, rounded as its curve rounds it. */
export function levelledMaxHp(
  baseMaxHp: number,
  level: number,
  curve = SHARED_LEVELLED_CURVE,
): number {
  return roundedForCurve(baseMaxHp * hpScaleForLevel(level, curve), curve);
}

/** What a mob of this level multiplies each blow's authored damage by. */
function damageScaleForLevel(level: number, curve = SHARED_LEVELLED_CURVE): number {
  return linearScale(level, curve.damagePerLevel, MAX_MOB_DAMAGE_MULTIPLIER);
}

/** What a mob of this level multiplies its authored walk speed by, before its speed cap. */
export function speedScaleForLevel(level: number): number {
  return linearScale(level, MOB_LEVEL_SPEED_SCALE, MAX_MOB_SPEED_MULTIPLIER);
}

/** What a mob of this level multiplies its projectiles' authored flight speed by. */
export function projectileSpeedScaleForLevel(level: number): number {
  return linearScale(level, MOB_LEVEL_PROJECTILE_SPEED_SCALE, MAX_MOB_PROJECTILE_SPEED_MULTIPLIER);
}

/**
 * A blow's authored damage at a given level.
 *
 * Not rounded on the shared curve. Most blows are one to three points, and a
 * one-point bite rounded to a whole number doubles in a single level the day
 * its multiplier crosses a half — a spike no curve can smooth out, landing on
 * the crawler with the least HP. Crawler health already takes fractional
 * damage (the difficulty profile's incoming-damage scale is fractional too),
 * so the blow follows the curve exactly. Only a curve that says it rounds up
 * does, and {@link LEARNING_FLOOR_LEVELLED_CURVE} says why. The multiplier is
 * never below one, so a levelled blow is never weaker than the authored one.
 */
export function scaledDamageForLevel(
  baseDamage: number,
  level: number,
  curve = SHARED_LEVELLED_CURVE,
): number {
  return roundedForCurve(baseDamage * damageScaleForLevel(level, curve), curve);
}

/**
 * Multiplier a mob of this level applies to any of its own attack cooldowns and
 * wind-ups: 1.00 at level 1, approaching {@link CADENCE_SCALE_FLOOR}.
 */
export function cooldownScaleForLevel(level: number): number {
  return (
    CADENCE_SCALE_FLOOR + (1 - CADENCE_SCALE_FLOOR) / (1 + CADENCE_RATE * levelsAboveFirst(level))
  );
}

/**
 * A base cooldown or wind-up shortened for a given level, never below one frame.
 *
 * The single implementation behind `Mob.scaledCooldownFrames` and behind every
 * creature that exposes its own scaled timing as a free function.
 */
export function scaledCooldownFramesForLevel(baseFrames: number, level: number): number {
  return Math.max(1, Math.round(baseFrames * cooldownScaleForLevel(level)));
}

/**
 * The most of a crawler's max HP one blow from any member of a bounty
 * encounter — the mark or its escort — may take.
 *
 * Whatever hits the crawler, she walks away from it with a quarter of her bar,
 * which is a potion's worth of time to answer it. A quarter rather than a
 * sliver because a bounty is never one body: a blow that leaves a sliver is a
 * death the moment anything else in the pack lands beside it. Bounties are also
 * where the level multiplier bites hardest — escorts spawn at the party's own
 * level, the mark a level above, and they are the only creatures that ever
 * reach the level cap — so an authored number that reads as heavy on a floor
 * mob reads as a kill from full here.
 */
export const BOUNTY_MAX_BLOW_HP_SHARE = 0.75;

/**
 * The fairness floor under every locked telegraph, in frames (350 ms): an
 * attack whose aim is frozen stays frozen at least this long at every level,
 * so avoiding it by movement alone is always possible. The single source the
 * gates and `docs/difficulty-fairness-rules.md` name.
 */
export const LOCKED_TELEGRAPH_MIN_FRAMES = 21;
