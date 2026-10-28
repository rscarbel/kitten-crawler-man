/**
 * The crawlers' own stat arithmetic, as pure functions and constants.
 *
 * `HumanPlayer`, `CatPlayer` and `Player` compute their live numbers through
 * these, and `src/core/party/referenceCrawler.ts` computes an idealised crawler
 * through the same ones — so it reads the formulas the game actually runs
 * rather than a copy of them that could drift.
 */

/** No stat can be driven below this by debuffs or refunds. */
export const MIN_STAT_VALUE = 1;

/** Max HP granted by each point of health. The single source for this ratio. */
export const HEALTH_HP_PER_POINT = 1;

/** Unspent stat points a crawler banks on each level-up. */
export const STAT_POINTS_PER_LEVEL = 1;

/** A crawler's max HP from health alone, before gear, boons or overrides. */
export function crawlerMaxHp(baseHpOffset: number, health: number): number {
  return baseHpOffset + health * HEALTH_HP_PER_POINT;
}

/** Species HP floor for the human: 8 + starting health 2 = 10 starting max HP. */
export const HUMAN_BASE_HP_OFFSET = 8;
/** Frames one punch or kick takes; the attack key cannot start another sooner. */
export const HUMAN_SWING_FRAMES = 18;
/** Damage a punch does before melee, gear, skills or status are counted. */
const BARE_FIST_DAMAGE = 1;

/** A bare-handed punch's damage from melee alone. */
export function bareFistDamage(melee: number): number {
  return BARE_FIST_DAMAGE + melee;
}

/** Species HP floor for the cat: 4 + starting health 2 = 6 starting max HP. She is meant to be fragile. */
export const CAT_BASE_HP_OFFSET = 4;
/** Frames the claw swipe covers; `CatPlayer` times its hit window and the sprite its animation to this. */
export const CAT_SWIPE_FRAMES = 18;
/** Damage a claw swipe does before melee, gear or status are counted. */
const BARE_CLAW_DAMAGE = 1;
/** A magic missile's damage before magic and the spell's own level are counted. */
const MISSILE_BASE_DAMAGE = 2;

/** A claw swipe's damage from melee alone. */
export function bareClawDamage(melee: number): number {
  return BARE_CLAW_DAMAGE + melee;
}

/** A magic missile's damage from magic and the spell level's damage multiplier. */
export function missileDamage(magic: number, damageMultiplier: number): number {
  return Math.round((MISSILE_BASE_DAMAGE + magic) * damageMultiplier);
}

/** Points of a stat above the floor every stat starts from. */
function pointsAboveFloor(value: number): number {
  return Math.max(0, value - MIN_STAT_VALUE);
}

// ── Health ──────────────────────────────────────────────────────────────────

/** Passive regen every crawler has before health is counted, in HP per second. */
const REGEN_BASE_HP_PER_SECOND = 0.08;
/** The most health can add to regen, approached but never reached. */
const REGEN_HEALTH_GAIN_HP_PER_SECOND = 0.35;
/** Health at which half of {@link REGEN_HEALTH_GAIN_HP_PER_SECOND} is earned. */
const REGEN_HEALTH_HALF = 20;

/**
 * Passive HP per second for a crawler with this health: a flat base plus an
 * asymptotic health term, so a high-health build heals fastest without ever
 * out-healing an enemy that never misses. Max HP and the potion cooldown are
 * what health is mostly bought for.
 */
export function crawlerRegenHpPerSecond(health: number): number {
  return (
    REGEN_BASE_HP_PER_SECOND +
    (REGEN_HEALTH_GAIN_HP_PER_SECOND * health) / (health + REGEN_HEALTH_HALF)
  );
}

/** The ceiling {@link crawlerRegenHpPerSecond} approaches but never reaches. */
export const REGEN_HP_PER_SECOND_ASYMPTOTE =
  REGEN_BASE_HP_PER_SECOND + REGEN_HEALTH_GAIN_HP_PER_SECOND;

// ── Ranged ──────────────────────────────────────────────────────────────────

/** A sling stone's damage before ranged is counted. */
const SLING_BASE_DAMAGE = 2;
/** Share of a point of ranged a stone's damage gains, rounded down. */
const RANGED_DAMAGE_PER_POINT_FRACTION = 0.25;
/** How far a stone flies at starting ranged, in tiles. */
const SLING_BASE_RANGE_TILES = 6;
/** Tiles of flight each point of ranged adds to a stone. */
export const RANGED_RANGE_PER_POINT_TILES = 0.1;
/** The furthest any stone flies, however much ranged is behind it. */
const SLING_MAX_RANGE_TILES = 9;

/** What a single stone does on impact; deliberately below a bare fist's reach-for-reach worth. */
export function slingDamage(ranged: number): number {
  return SLING_BASE_DAMAGE + Math.floor(ranged * RANGED_DAMAGE_PER_POINT_FRACTION);
}

/** How far a stone flies, in tiles. */
export function slingRangeTiles(ranged: number): number {
  const grown = SLING_BASE_RANGE_TILES + pointsAboveFloor(ranged) * RANGED_RANGE_PER_POINT_TILES;
  return Math.min(SLING_MAX_RANGE_TILES, grown);
}

// ── Explosives Handling ─────────────────────────────────────────────────────

/**
 * Multiplier on blast damage to enemies added per explosives handling point
 * above the first.
 *
 * A multiplier rather than a flat bonus: a flat point would shrink to nothing
 * against levelled health, where a share of an already-levelled stick keeps
 * every point spent worth what it was when spent.
 */
export const DYN_MOB_DAMAGE_FRACTION_PER_HANDLING_LEVEL = 0.3;

// ── Magic ───────────────────────────────────────────────────────────────────

/** How much longer and harder an Energy Shield runs per point of magic above the first. */
const ENERGY_SHIELD_GROWTH_PER_MAGIC = 0.03;
/** The most magic can multiply an Energy Shield's duration and blast by. */
const ENERGY_SHIELD_MAX_MAGIC_SCALE = 2;

/** What the caster's magic multiplies an Energy Shield's duration and expanding blast by. */
export function energyShieldMagicScale(magic: number): number {
  const grown = 1 + pointsAboveFloor(magic) * ENERGY_SHIELD_GROWTH_PER_MAGIC;
  return Math.min(ENERGY_SHIELD_MAX_MAGIC_SCALE, grown);
}

/** Share of a magic blow that magic-resistant gear turns aside at starting magic. */
const MAGIC_RESIST_BASE_SHARE = 0.25;
/** Share of a magic blow each point of the wearer's magic above the first adds to that. */
const MAGIC_RESIST_SHARE_PER_MAGIC = 0.01;
/** The most of a magic blow any amount of magic lets gear turn aside. */
const MAGIC_RESIST_MAX_SHARE = 0.6;

/**
 * Share of a magic blow, and of a magic status's length and grip, that
 * magic-resistant gear turns aside for a wearer with this much magic.
 */
export function magicResistedShare(magic: number): number {
  const grown = MAGIC_RESIST_BASE_SHARE + pointsAboveFloor(magic) * MAGIC_RESIST_SHARE_PER_MAGIC;
  return Math.min(MAGIC_RESIST_MAX_SHARE, grown);
}

/** How much shorter a magic-attuned relic's recharge gets per point of magic above the first. */
const MAGIC_RECHARGE_REDUCTION_PER_POINT = 0.01;
/** The shortest a magic-attuned relic's recharge can get, as a share of its own. */
const MAGIC_RECHARGE_MIN_SCALE = 0.5;

/** What the wearer's magic multiplies a magic-attuned relic's recharge by. */
export function magicRechargeScale(magic: number): number {
  const shortened = 1 - pointsAboveFloor(magic) * MAGIC_RECHARGE_REDUCTION_PER_POINT;
  return Math.max(MAGIC_RECHARGE_MIN_SCALE, shortened);
}

/**
 * Hit points as a player should see them.
 *
 * Levelled mob damage and the difficulty profile's incoming-damage scale are
 * both fractional, so live HP is too; every place that prints HP goes through
 * this so none of them shows floating-point noise. Rounded up, so a crawler
 * clinging on at a fraction of a point never reads as zero.
 */
export function displayHp(hp: number): number {
  return Math.ceil(hp);
}
