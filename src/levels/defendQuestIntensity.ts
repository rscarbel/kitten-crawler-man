/**
 * How hard the goblin mother's nursery pushes back on a given floor.
 *
 * The room is the same encounter on floors 1 and 2, but floor 2's party meets
 * it with a floor's worth more gear and levels, so the second visit widens the
 * front (more grates to board) and quickens it (more bodies, harder blows on
 * the boards) rather than only inflating the bugaboos' stats.
 */
export interface DefendQuestIntensity {
  /** Grates cut into the nursery floor; split evenly across two of its walls, so keep it even. */
  readonly grateCount: number;
  /** How many times faster than the base cadence the wave spawns. */
  readonly spawnRateMultiplier: number;
  /** Multiplies every blow a bugaboo lands on a boarded grate. */
  readonly barrierDamageMultiplier: number;
}

/** Four grates: two walls, two apiece. */
export const BASE_NURSERY_GRATE_COUNT = 4;

/** The nursery as floor 1 meets it — and as any floor that says nothing meets it. */
export const BASE_DEFEND_QUEST_INTENSITY: DefendQuestIntensity = {
  grateCount: BASE_NURSERY_GRATE_COUNT,
  spawnRateMultiplier: 1,
  barrierDamageMultiplier: 1,
};

/** Floor 2 cuts one more grate into each of the two walls. */
const FLOOR_TWO_EXTRA_GRATES = 2;
const FLOOR_TWO_SPAWN_RATE_MULTIPLIER = 2;
const FLOOR_TWO_BARRIER_DAMAGE_MULTIPLIER = 1.5;

export const FLOOR_TWO_DEFEND_QUEST_INTENSITY: DefendQuestIntensity = {
  grateCount: BASE_NURSERY_GRATE_COUNT + FLOOR_TWO_EXTRA_GRATES,
  spawnRateMultiplier: FLOOR_TWO_SPAWN_RATE_MULTIPLIER,
  barrierDamageMultiplier: FLOOR_TWO_BARRIER_DAMAGE_MULTIPLIER,
};
