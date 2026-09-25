import {
  PREWARM_BAKE_BUDGET_MS,
  drawFigureCached,
  prewarmFigureState,
  touchFigureState,
} from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import {
  NECROMANCER_ACTION_VIEWS,
  NECROMANCER_FIGURE,
  necromancerStateName,
  type NecromancerAction,
} from './art/necromancerFigure';
import type { NecromancerView } from './art/necromancerArt';

/**
 * Every state this wrapper can ask the figure for: each action in each view it
 * is drawn in. An art gate holds this against what the figure paints, because
 * the draw call returns silently on a state it cannot find — a name that drifts
 * is an invisible boss and no log line.
 */
export const NECROMANCER_DRAWN_STATES: readonly string[] = Object.entries(
  NECROMANCER_ACTION_VIEWS,
).flatMap(([action, views]) =>
  views.map((view) => `${action}${view === 'front' ? '' : `_${view}`}`),
);

/** One row of his, by what he is doing and which way he is seen. */
export interface NecromancerRowRef {
  readonly action: NecromancerAction;
  readonly view: NecromancerView;
}

function allViewsOf(actions: readonly NecromancerAction[]): NecromancerRowRef[] {
  return actions.flatMap((action) =>
    NECROMANCER_ACTION_VIEWS[action].map((view) => ({ action, view })),
  );
}

/**
 * His rows are warmed in stages, each ahead of when it is first played, and
 * each staged set is sized to sit inside the figure's own byte budget
 * alongside the ones before it (`scripts/gates-assault-residency.ts` drives
 * the real cache through the sequence). His cells are the dearest in the
 * assault — the cache bakes them at full cell size whatever the tile size —
 * so every row warm at once does not fit, and does not need to: a cast is
 * played in one view.
 *
 * - arrival (kept warm through the lead-in by `AssaultWavePrewarm`): the
 *   drift he comes in on, side-on, the one view the east lane he arrives by
 *   shows;
 * - standing (the moment he first acts, {@link
 *   NECROMANCER_STANDING_PREWARM_LEAD_FRAMES} before he first stands — his
 *   walk in is paced to that): the idle and the flinch, and the drift toward
 *   the camera;
 * - the blink, when a crawler first comes within
 *   {@link NECROMANCER_BLINK_WARN_TILES} of him;
 * - each cast, in the one view he will cast it in, {@link
 *   NECROMANCER_CAST_PREWARM_LEAD_FRAMES} before he starts it;
 * - his drift away from the camera, and toward it before he has settled, when
 *   he sets off in that direction — the standing set cannot also hold it
 *   inside his budget;
 * - the death, when the fight turns toward its end.
 */
export const NECROMANCER_ARRIVAL_ROWS: readonly NecromancerRowRef[] = [
  { action: 'drift', view: 'side' },
];
export const NECROMANCER_STANDING_ROWS: readonly NecromancerRowRef[] = [
  { action: 'drift', view: 'front' },
  ...allViewsOf(['idle', 'hurt']),
];
export const NECROMANCER_BLINK_ROWS: readonly NecromancerRowRef[] = allViewsOf([
  'blink_out',
  'blink_in',
]);

/** The casts, each warmed on its own ahead of use. */
export type NecromancerCast = Extract<NecromancerAction, 'cast_raise' | 'cast_bolt' | 'cast_pulse'>;
export const NECROMANCER_CASTS: readonly NecromancerCast[] = [
  'cast_raise',
  'cast_bolt',
  'cast_pulse',
];

/**
 * What one of his cells costs to bake, in milliseconds, as the leads are
 * sized: a blink's cells fray, which reads the whole cell back, and cost
 * about twice an ordinary one. Measured at about 5 and 10 ms offline; browsers
 * diverge from node in both directions, so each lead is a further
 * {@link PREWARM_LEAD_SAFETY} times the work.
 */
export const NECROMANCER_CELL_BAKE_MS_ESTIMATE = 10;
export const NECROMANCER_BLINK_CELL_BAKE_MS_ESTIMATE = 16;
export const PREWARM_LEAD_SAFETY = 2;

function cellsIn(rows: readonly NecromancerRowRef[]): number {
  return rows.reduce(
    (cells, row) =>
      cells + figureFrameCount(NECROMANCER_FIGURE, necromancerStateName(row.action, row.view)),
    0,
  );
}

/** Cache frames needed to warm this many cells at an estimated cost each, with the safety margin. */
export function necromancerLeadFrames(cells: number, msPerCell: number): number {
  return Math.ceil((cells * msPerCell * PREWARM_LEAD_SAFETY) / PREWARM_BAKE_BUDGET_MS);
}

/** The longest cast row, in cells: the one a cast's lead must cover. */
const LONGEST_CAST_CELLS = Math.max(
  ...NECROMANCER_CASTS.map((cast) => figureFrameCount(NECROMANCER_FIGURE, cast)),
);

/**
 * How many of the figure cache's frames before a cast starts it must be
 * warmed. Counted on the cache's clock (`figureCacheFrame`), not in gameplay
 * updates.
 */
export const NECROMANCER_CAST_PREWARM_LEAD_FRAMES = necromancerLeadFrames(
  LONGEST_CAST_CELLS,
  NECROMANCER_CELL_BAKE_MS_ESTIMATE,
);

/** The same for a drift in one view, warmed as he sets off in it. */
export const NECROMANCER_DRIFT_PREWARM_LEAD_FRAMES = necromancerLeadFrames(
  figureFrameCount(NECROMANCER_FIGURE, necromancerStateName('drift', 'away')),
  NECROMANCER_CELL_BAKE_MS_ESTIMATE,
);

/**
 * The same for his standing set, warmed as he sets out from his spawn: his
 * first stop, whenever it comes, draws from it.
 */
export const NECROMANCER_STANDING_PREWARM_LEAD_FRAMES = necromancerLeadFrames(
  cellsIn(NECROMANCER_STANDING_ROWS),
  NECROMANCER_CELL_BAKE_MS_ESTIMATE,
);

/** The same for the blink out and back in, warmed together. */
export const NECROMANCER_BLINK_PREWARM_LEAD_FRAMES = necromancerLeadFrames(
  cellsIn(NECROMANCER_BLINK_ROWS),
  NECROMANCER_BLINK_CELL_BAKE_MS_ESTIMATE,
);

/**
 * How close a crawler comes before the blink is warmed, in tiles: well outside
 * the two tiles he blinks away from, so the lead is covered by the approach
 * rather than by the two seconds he waits before going.
 */
export const NECROMANCER_BLINK_WARN_TILES = 8;

function prewarmRows(rows: readonly NecromancerRowRef[]): void {
  for (const row of rows) {
    prewarmFigureState(NECROMANCER_FIGURE, necromancerStateName(row.action, row.view));
  }
}

/** Warms the drift he arrives on. A backstop: the wave's ticker keeps these warm. */
export function prewarmNecromancerArrival(): void {
  prewarmRows(NECROMANCER_ARRIVAL_ROWS);
}

/**
 * Warms his idle, his flinch and the drift toward the camera. Call as he sets
 * out, at least {@link NECROMANCER_STANDING_PREWARM_LEAD_FRAMES} cache frames
 * before he first stands.
 */
export function prewarmNecromancerStanding(): void {
  touchStandingRows();
  prewarmRows(NECROMANCER_STANDING_ROWS);
}

/** Warms the blink out and back in. Call when a crawler first comes within {@link NECROMANCER_BLINK_WARN_TILES}. */
export function prewarmNecromancerBlink(): void {
  touchStandingRows();
  prewarmRows(NECROMANCER_BLINK_ROWS);
}

/**
 * Warms one cast in the view he will cast it in. Call it
 * {@link NECROMANCER_CAST_PREWARM_LEAD_FRAMES} cache frames before the cast
 * starts — as its cooldown runs down — so its telegraph never plays a frame
 * behind its own bake.
 */
export function prewarmNecromancerCast(cast: NecromancerCast, facing: NecromancerView): void {
  touchStandingRows();
  const view = necromancerViewFor(cast, facing);
  prewarmFigureState(NECROMANCER_FIGURE, necromancerStateName(cast, view));
}

/**
 * Warms his drift in one view. Call as he sets off in a direction whose drift
 * is not already warm: away from the camera, or toward it before he has
 * settled. The side-on drift is kept warm from his arrival. Warming it takes
 * {@link NECROMANCER_DRIFT_PREWARM_LEAD_FRAMES} cache frames; a drift that
 * starts sooner paints its first frames on the draw.
 */
export function prewarmNecromancerDrift(view: NecromancerView): void {
  touchStandingRows();
  prewarmFigureState(NECROMANCER_FIGURE, necromancerStateName('drift', view));
}

/**
 * Marks the rows he arrives, stands and dodges in as the freshest he holds,
 * ahead of a new row. When the new row needs room, what the cache gives up is
 * an earlier cast he has finished with, not the drift he goes back to.
 */
function touchStandingRows(): void {
  for (const row of [
    ...NECROMANCER_ARRIVAL_ROWS,
    ...NECROMANCER_STANDING_ROWS,
    ...NECROMANCER_BLINK_ROWS,
  ]) {
    touchFigureState(NECROMANCER_FIGURE, necromancerStateName(row.action, row.view));
  }
}

/** Warms the death row, for the moment the fight turns toward its end. */
export function prewarmNecromancerDeath(): void {
  touchStandingRows();
  prewarmFigureState(NECROMANCER_FIGURE, necromancerStateName('death', 'front'));
}

/**
 * How far the crown of his hood stands above the top of his own tile, in
 * tiles, so a health bar or a marker hung off the tile clears his head. Frozen
 * from the idle's painted ink; `scripts/gates-necromancer.ts` re-measures it.
 */
export const NECROMANCER_HEAD_ABOVE_TILE_TILES = 1.59;

/** The view an action is drawn in, falling back to head-on for the front-only rows. */
export function necromancerViewFor(
  action: NecromancerAction,
  facing: NecromancerView,
): NecromancerView {
  return NECROMANCER_ACTION_VIEWS[action].includes(facing) ? facing : 'front';
}

/**
 * Draws the necromancer. `facing` is the direction he is turned; `flipX`
 * mirrors the profile for a westward facing. Frame indices are clamped by the
 * cache, and `figureFrameCount` says how many a row has.
 */
export function drawNecromancerSprite(
  ctx: CanvasRenderingContext2D,
  action: NecromancerAction,
  facing: NecromancerView,
  frame: number,
  sx: number,
  sy: number,
  tileSize: number,
  flipX: boolean,
  alpha = 1,
): void {
  const view = necromancerViewFor(action, facing);
  const state = necromancerStateName(action, view);
  drawFigureCached(ctx, NECROMANCER_FIGURE, state, frame, sx, sy, tileSize, {
    flipX: flipX && view === 'side',
    alpha,
  });
}

/** How many frames an action's row has, read off the figure rather than retyped. */
export function necromancerFrameCount(action: NecromancerAction): number {
  return figureFrameCount(NECROMANCER_FIGURE, necromancerStateName(action, 'front'));
}
