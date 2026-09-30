/**
 * How worn a mineable rock looks, keyed on the share of its capacity still in
 * it.
 *
 * The stage rides on the tile's `damageStage` because the tile renderer is pure
 * and reads nothing else; the node ledger writes it after every harvest. Lives
 * in the map layer so both the renderer and the painters that bake each stage
 * can name the stages without importing gameplay code.
 */

/** Sprite rows of every mineable rock sheet, in row order, one per damage stage. */
export const ROCK_DAMAGE_STATES = ['idle', 'chipped', 'broken', 'remnant'] as const;

export type RockDamageState = (typeof ROCK_DAMAGE_STATES)[number];

export const ROCK_DAMAGE_STAGE_INTACT = 0;
export const ROCK_DAMAGE_STAGE_CHIPPED = 1;
export const ROCK_DAMAGE_STAGE_BROKEN = 2;
export const ROCK_DAMAGE_STAGE_REMNANT = 3;

/**
 * Share of capacity left at or above which a worked rock is only chipped. The
 * first swing already chips it: a rock that looks untouched after a strike
 * reads as a miss.
 */
export const ROCK_CHIPPED_MIN_FRACTION = 0.6;
/** Share of capacity left at or above which a worked rock is broken rather than a remnant. */
export const ROCK_BROKEN_MIN_FRACTION = 0.25;

/** The damage stage of a rock with `remaining` of `capacity` harvests left. */
export function rockDamageStageFor(remaining: number, capacity: number): number {
  if (remaining >= capacity) return ROCK_DAMAGE_STAGE_INTACT;
  const fractionLeft = capacity > 0 ? remaining / capacity : 0;
  if (fractionLeft >= ROCK_CHIPPED_MIN_FRACTION) return ROCK_DAMAGE_STAGE_CHIPPED;
  if (fractionLeft >= ROCK_BROKEN_MIN_FRACTION) return ROCK_DAMAGE_STAGE_BROKEN;
  return ROCK_DAMAGE_STAGE_REMNANT;
}

/** The sprite row a rock tile with this `damageStage` is drawn from. */
export function rockDamageState(damageStage: number | undefined): RockDamageState {
  const stage = damageStage ?? ROCK_DAMAGE_STAGE_INTACT;
  const lastStage = ROCK_DAMAGE_STATES.length - 1;
  const clamped = Math.max(ROCK_DAMAGE_STAGE_INTACT, Math.min(lastStage, Math.floor(stage)));
  return ROCK_DAMAGE_STATES[clamped];
}
