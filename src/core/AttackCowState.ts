/**
 * The part of the human crawler's attack cow that outlives the creature.
 *
 * Like `MongoPetState`: the cow instance is thrown away at every door, stair
 * and despawn, so whether the party owns her, her health and her rest latch are
 * party state, threaded by reference through `DungeonSceneOptions` and the
 * interior scene so they survive floor changes and building entries. Owned
 * lives here too, unlike Mongo's unlock flag, because the cow is won inside a
 * building and the scene outside has to see the win when the party walks out.
 */
export interface AttackCowState {
  owned: boolean;
  /**
   * Current HP, or null for a cow at full health whose maximum has not been
   * measured yet — the stats that define it belong to the creature, and a
   * freshly won or freshly loaded cow has not been built against them.
   */
  hp: number | null;
  /** The maximum HP `hp` was last measured against, or null alongside a null `hp`. */
  scaledAgainstMaxHp: number | null;
  /**
   * Set when she leaves a fight spent and held until she is back to full, so
   * a knockout costs the whole recovery. Saved, or a reload would skip it.
   */
  restingUntilFull: boolean;
}

export function createAttackCowState(
  owned = false,
  hp: number | null = null,
  restingUntilFull = hp !== null && hp <= 0,
): AttackCowState {
  return {
    owned,
    hp,
    scaledAgainstMaxHp: null,
    restingUntilFull,
  };
}

/** A point-in-time copy, for checkpoints; every field is a primitive. */
export type AttackCowStateCheckpoint = Readonly<AttackCowState>;

export function captureAttackCowState(state: AttackCowState): AttackCowStateCheckpoint {
  return { ...state };
}

/** In place, because every holder shares the one object. */
export function restoreAttackCowState(
  state: AttackCowState,
  snapshot: AttackCowStateCheckpoint,
): void {
  state.owned = snapshot.owned;
  state.hp = snapshot.hp;
  state.scaledAgainstMaxHp = snapshot.scaledAgainstMaxHp;
  state.restingUntilFull = snapshot.restingUntilFull;
}

/**
 * A saved HP screened to a usable value: finite and not negative. The upper
 * bound is the creature's to apply, once it knows its maximum.
 */
export function parseAttackCowHp(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return Math.max(0, raw);
}
