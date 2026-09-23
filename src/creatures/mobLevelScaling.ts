/**
 * Every per-level stat curve a mob is levelled by, in one pure module.
 *
 * Pure and free of game-object imports so `scripts/verify-difficulty.ts` and
 * `scripts/verify-difficulty-curve.ts` can assert the real curves headlessly
 * rather than a copy of them that could drift.
 *
 * Why the HP and damage curves are shallow: a fight's cost to the player is
 * roughly how long the mob survives times how fast it drains them, so the mob's
 * side of that cost is HP × damage ÷ cadence — three curves multiplied together.
 * The player earns one stat point per level spread across four stats, which
 * grows their side of the same product far more slowly. The rates below are the
 * ones that keep an on-schedule party's share of HP lost per fight nearly flat,
 * drifting slowly upward, and `verify:difficulty-curve` fails if a retune lets
 * that share climb out of its band.
 *
 * Every curve also carries an explicit ceiling on its multiplier, independent
 * of the spawner's level cap, so raising that cap later cannot silently extend
 * any curve past what was checked.
 */

/** HP added per level above 1, as a fraction of the mob's authored max HP. */
export const MOB_LEVEL_HP_SCALE = 0.17;
/** Hard ceiling on the HP multiplier, whatever level a mob is given. */
export const MAX_MOB_HP_MULTIPLIER = 4.23;

/** Damage added per level above 1, as a fraction of the blow's authored damage. */
export const MOB_LEVEL_DAMAGE_SCALE = 0.1125;
/** Hard ceiling on the damage multiplier, whatever level a mob is given. */
export const MAX_MOB_DAMAGE_MULTIPLIER = 3.14;

/**
 * Walk speed added per level above 1, as a fraction of the authored speed.
 *
 * `Mob.levelledSpeedCap` still bounds the result against the player's own
 * speed; this ceiling bounds the multiplier itself.
 */
export const MOB_LEVEL_SPEED_SCALE = 0.08;
/** Hard ceiling on the speed multiplier, whatever level a mob is given. */
export const MAX_MOB_SPEED_MULTIPLIER = 2.52;

/**
 * Projectile flight speed added per level above 1, as a fraction of the
 * projectile's authored speed. Each projectile keeps its own absolute cap as a
 * fraction of `PLAYER_SPEED`, so a bolt stays outrunnable; this bounds only the
 * level multiplier.
 */
export const MOB_LEVEL_PROJECTILE_SPEED_SCALE = 0.04;
/** Hard ceiling on the projectile speed multiplier, whatever level a mob is given. */
export const MAX_MOB_PROJECTILE_SPEED_MULTIPLIER = 1.76;

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
export const LEARNING_FLOOR_HP_PER_LEVEL = 0.3;
/** Damage added per level above 1 on the curve the learning floor was tuned on. */
export const LEARNING_FLOOR_DAMAGE_PER_LEVEL = 0.2;

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
export function damageScaleForLevel(level: number, curve = SHARED_LEVELLED_CURVE): number {
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

// ── What the curves must achieve ─────────────────────────────────────────────
//
// Asserted by `scripts/verify-difficulty-curve.ts` against real creatures and
// the reference crawler in `src/core/referenceCrawler.ts`. "HP share" is the
// fraction of a crawler's max HP one stand-up fight with one mob costs; the
// ratios are that share against the same creature's share at party level 1.

/**
 * Party levels the HP-share trend is averaged over. Spawn levels are rounded
 * from party level, so the mob holds a level while the crawler grows past it;
 * mob HP rounds to whole points; and a creature's measured attack rate steps
 * as its scaled cooldowns round to whole frames. The raw share is a sawtooth
 * under any curve, and the trend reads through it.
 */
export const HP_SHARE_TREND_WINDOW = 7;
/**
 * How far the balanced build's averaged HP share may fall from one party level
 * to the next before the path counts as getting easier.
 */
export const HP_SHARE_DIP_TOLERANCE = 0.05;
/**
 * Party levels over which {@link EARLY_HP_SHARE_DIP_TOLERANCE} applies instead.
 * A fresh crawler's stats are tiny, so each early point is a large fraction of
 * everything she has — her first punch point is a quarter more damage — while
 * the mob only steps a level every one-and-a-half party levels. Early fights
 * genuinely get cheaper for a few levels before the curve catches up.
 */
export const EARLY_RAMP_PARTY_LEVELS = 7;
/** How far the averaged HP share may fall between spawn-level steps during the early ramp. */
export const EARLY_HP_SHARE_DIP_TOLERANCE = 0.2;
/**
 * The shortest fight a ratio may be read against: more than a single blow. A
 * baseline that one blow almost settles (a level-1 rat under a punch) is a
 * rounding error, and every ratio against it would measure that error rather
 * than the curve.
 */
export const REAL_FIGHT_MIN_PRESSES = 1.5;
/** The balanced build's averaged HP share at the spawn-level cap must have risen at least this far... */
export const HP_SHARE_END_MIN = 1.3;
/** ...and at most this far: a slow upward drift, not a wall. */
export const HP_SHARE_END_MAX = 1.6;
/** No sampled party level may cost the balanced build more than this multiple of level 1. */
export const HP_SHARE_CEILING = 1.75;
/**
 * The ceiling on the hard profile's balanced-build path, against hard's own
 * party-level-1 fight: the smallest round value hard's per-level peaks meet.
 *
 * Above {@link HP_SHARE_CEILING} by necessity, not by choice: hard's spawn
 * ratio brings mobs to the level cap four party levels earlier, when the
 * crawler has four fewer stat points, so the same level-20 mob meets a crawler
 * about 1.4× weaker than on normal. That factor comes from the crawler's own
 * formulas, not from the curve, so no curve whose normal path still rises to
 * {@link HP_SHARE_END_MIN} can hold hard under {@link HP_SHARE_CEILING}.
 */
export const HARD_HP_SHARE_CEILING = 2.1;
/**
 * A fight cheaper than this share of max HP is exempt from the ratio
 * ceilings. The ceilings exist to stop a fight turning unwinnable; a fight
 * that costs a crawler under a quarter of her health is not one, however far
 * it has risen from an even cheaper level-1 fight. A regression can only
 * hide here while the fight stays under this share; the moment it costs
 * more, the ratio ceilings read it again.
 */
export const RATIO_CEILING_MIN_HP_SHARE = 0.25;
/** A boss fight is meant to cost more, but never more than this multiple of its level-1 cost. */
export const BOSS_HP_SHARE_CEILING = 2.5;
/** Fewest blows the balanced build may need to kill one regular mob. */
export const HITS_TO_KILL_MIN = 2;
/** Most blows the balanced build may need to kill one regular mob. */
export const HITS_TO_KILL_MAX = 6;
/**
 * The deliberately weak build must still win a one-on-one against every regular
 * mob — an HP share under one — so a player who spent points badly struggles
 * but is never locked out.
 */
export const OFF_STAT_HP_SHARE_MAX = 1;
/**
 * The most of a full-health, on-schedule balanced crawler's max HP one blow
 * from any member of a bounty encounter — the mark or its escort — may take.
 *
 * The ratio ceilings above only compare a fight with its own level-1 cost, so
 * a creature authored to kill from full at level 1 passes every one of them.
 * This is the absolute floor under them: whatever hits the crawler, she walks
 * away from it with a quarter of her bar, which is a potion's worth of time to
 * answer it. A quarter rather than a sliver because a bounty is never one body:
 * a blow that leaves a sliver is a death the moment anything else in the pack
 * lands beside it. Bounties are also where the level multiplier bites hardest —
 * escorts spawn at the party's own level, the mark a level above, and they are
 * the only creatures that ever reach the level cap — so an authored number that
 * reads as heavy on a floor mob reads as a kill from full here.
 */
export const BOUNTY_MAX_BLOW_HP_SHARE = 0.75;
/**
 * The least of the reference party's pooled HP a regular room fight may leave,
 * averaged over the rooms a floor rolls: the bottom of the target-feel band in
 * `docs/difficulty-fairness-rules.md`. A room below it is one that routinely
 * forces a retreat.
 */
export const ROOM_FIGHT_HP_REMAINING_MIN = 0.4;
/**
 * The most of the reference party's pooled HP a regular room fight may leave,
 * past the learning floor. A room above it costs so little that the gap between
 * rooms heals it, and potions never come into play.
 */
export const ROOM_FIGHT_HP_REMAINING_MAX = 0.7;
/**
 * The least of the reference party's pooled HP a regular fight may leave on
 * hard. Hard is meant to push a fight past the normal band — a potion mid-room
 * is part of choosing it — but a fight that routinely leaves the party with
 * nothing is one it cannot finish without one, which is a wall, not pressure.
 */
export const HARD_ROOM_FIGHT_HP_REMAINING_MIN = 0.15;
/**
 * The most of the pooled HP of an off-stat party — both crawlers built badly —
 * one regular mob may cost at a level a floor has tracked the party up to.
 *
 * {@link OFF_STAT_HP_SHARE_MAX} holds the off-stat crawler alone to winning
 * against the authored bands. Past them it cannot hold: that build's main
 * attack never grows, while a tracked mob keeps levelling with the party. So
 * there the rule is restated for the party the game is actually played as, and
 * held with a margin — half the bar left — rather than a bare win.
 */
export const OFF_STAT_PARTY_HP_SHARE_MAX = 0.5;
/**
 * The least of its pooled HP an off-stat party must keep after a whole fight it
 * cannot avoid — the roaming mobs on every overworld road — on normal, at a
 * floor that tracks the party. Enough of a bar to reach the next fight or a
 * potion; an optional camp is held only on easy.
 */
export const OFF_STAT_UNAVOIDABLE_HP_REMAINING_MIN = 0.15;
/**
 * The longest the balanced crawler may take to kill one regular mob at a level
 * a floor has tracked the party up to: the top of the time-to-kill row in
 * `docs/difficulty-fairness-rules.md`. The blows-to-kill band is read at the
 * authored levels; at tracked ones, time is what tells a sponge from a tough
 * mob.
 */
export const TIME_TO_KILL_MAX_SECONDS = 8;
/**
 * The fairness floor under every locked telegraph, in frames (350 ms): an
 * attack whose aim is frozen stays frozen at least this long at every level,
 * so avoiding it by movement alone is always possible. The single source the
 * gates and `docs/difficulty-fairness-rules.md` name.
 */
export const LOCKED_TELEGRAPH_MIN_FRAMES = 21;
