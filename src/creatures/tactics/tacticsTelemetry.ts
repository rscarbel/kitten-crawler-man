/**
 * `?difficulty` tactics counters — guard blocks and kites — recorded the
 * instant one happens rather than kept on the mob that earned it.
 *
 * A mob taken off the roster by a direct splice (a Mongo phase change, a
 * mercenary dismissal, a bounty escort's own despawn) is never asked
 * anything again, so a per-mob pending counter would lose whatever it was
 * holding the same frame the mob left. A module-level sink has nothing to
 * lose: the count already landed here before the mob was ever removed.
 *
 * Drained once a frame by `DifficultyTelemetrySystem`, the same
 * accumulate-then-drain shape as `Player.pendingDamageTaken`.
 */

/** One frame's worth of tactics counters since the last drain. */
export interface TacticsTelemetrySample {
  readonly guardBlocks: number;
  readonly kiteStarts: number;
  /** Kites that ended, paired with {@link kiteFrames} to average a kite's length. */
  readonly kiteEnds: number;
  readonly kiteFrames: number;
}

let guardBlocks = 0;
let kiteStarts = 0;
let kiteEnds = 0;
let kiteFrames = 0;

/** A guard turned a blow aside. Called from {@link MobTactics.tryGuard}. */
export function noteGuardBlock(): void {
  guardBlocks++;
}

/** A kite began. Called from {@link MobTactics.tryStartKite}. */
export function noteKiteStart(): void {
  kiteStarts++;
}

/** A kite ended, however it ended, after walking `frames`. */
export function noteKiteEnd(frames: number): void {
  kiteEnds++;
  kiteFrames += frames;
}

/** This frame's counters, zeroed on the way out so nothing is ever double-counted. */
export function drainTacticsTelemetry(): TacticsTelemetrySample {
  const sample: TacticsTelemetrySample = { guardBlocks, kiteStarts, kiteEnds, kiteFrames };
  guardBlocks = 0;
  kiteStarts = 0;
  kiteEnds = 0;
  kiteFrames = 0;
  return sample;
}
