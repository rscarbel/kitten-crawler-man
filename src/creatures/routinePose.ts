/**
 * What an occupant's routine has them doing while they stand still, for a
 * figure that paints the routine's own rows: a mop stroke, a wring over the
 * bucket, a levelled crossbow, a shot, a reload.
 *
 * A cast citizen has no such rows and draws any of these as its `work` loop;
 * a bespoke resident maps each pose onto a row of its own painter.
 */

export type RoutinePoseId = 'mop' | 'wring' | 'aim' | 'shoot' | 'reload';

export interface RoutinePose {
  readonly id: RoutinePoseId;
  /** 0 at the start of one play of the pose (one stroke cycle, one shot), 1 at its end. */
  readonly progress: number;
}

/** How one play of a pose runs, owned by the figure that paints it. */
export interface RoutinePoseTiming {
  /** How long one play lasts, in milliseconds. */
  readonly durationMs: number;
  /**
   * The progress points at which the pose makes its sound — a stroke
   * landing, the bolt leaving, the mop hitting the water — so the sound
   * lands on the frame that shows it.
   */
  readonly beats: readonly number[];
}

/** A beat halfway through a pose: the second of two strokes, the middle of a shot. */
const HALFWAY = 0.5;
/** The mop reaches the water a little under a third of the way into a wring. */
const WRING_DUNK = 0.3;

/**
 * The timing a figure with no rows of its own for a pose is played at. A cast
 * citizen's `work` loop has no frame a beat must land on, so its beats only
 * pace the routine's sounds.
 */
export const DEFAULT_ROUTINE_POSE_TIMING = {
  mop: { durationMs: 1200, beats: [0, HALFWAY] },
  wring: { durationMs: 1400, beats: [WRING_DUNK] },
  aim: { durationMs: 1500, beats: [] },
  shoot: { durationMs: 500, beats: [HALFWAY] },
  reload: { durationMs: 2000, beats: [0] },
} as const satisfies Record<RoutinePoseId, RoutinePoseTiming>;

/**
 * How a figure paints one routine pose: a row of its own, played at that
 * row's timing, or its rest row, played at {@link DEFAULT_ROUTINE_POSE_TIMING}.
 * A figure's table is a `Record` over every pose, so a pose cannot be given a
 * row without the timing its sound beats land on.
 */
export type RoutinePoseRow<Row extends string> =
  { readonly row: Row; readonly timing: RoutinePoseTiming } | 'rest';

/** Every pose drawn at rest, for a figure that paints no routine of its own. */
export const NO_ROUTINE_ROWS = {
  mop: 'rest',
  wring: 'rest',
  aim: 'rest',
  shoot: 'rest',
  reload: 'rest',
} as const satisfies Record<RoutinePoseId, RoutinePoseRow<never>>;

/** The timing `pose` plays at under a figure's table entry for it. */
export function routinePoseTiming(
  entry: RoutinePoseRow<string>,
  pose: RoutinePoseId,
): RoutinePoseTiming {
  return entry === 'rest' ? DEFAULT_ROUTINE_POSE_TIMING[pose] : entry.timing;
}
