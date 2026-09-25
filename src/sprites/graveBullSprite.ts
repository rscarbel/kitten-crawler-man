import {
  PREWARM_BAKE_BUDGET_MS,
  drawFigureCached,
  prewarmFigureState,
} from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import {
  GRAVE_BULL_ACTION_VIEWS,
  GRAVE_BULL_FIGURE,
  graveBullStateName,
  type GraveBullAction,
} from './art/graveBullFigure';
import { GRAVE_BULL_GORE_STATES } from './art/graveBullArt';
import type { CowView } from './art/cowArt';

/**
 * Every state this wrapper can ask the figure for. An art gate holds it against
 * what the figure paints: the draw call returns silently on a state it cannot
 * find, so a drifted name is an invisible bull.
 */
export const GRAVE_BULL_DRAWN_STATES: readonly string[] = Object.entries(
  GRAVE_BULL_ACTION_VIEWS,
).flatMap(([action, views]) =>
  views.map((view) =>
    view === 'front' ? action : `${action}_${view === 'side' ? 'side' : 'away'}`,
  ),
);

/**
 * The `BodyPartGoreSystem` registry key a dead Grave Bull's pieces come from.
 * Its pieces are bones and a length of chain, never the cow's quarters: it is
 * a carcass, and it drops no meat.
 */
export const GRAVE_BULL_BODY_PART_KEY = 'grave_bull';

/** The loose bones it flies apart into, in spawn order. */
export const GRAVE_BULL_GORE_PARTS: ReadonlyArray<string> = GRAVE_BULL_GORE_STATES;

/** One of its rows, by what it is doing and which way it is seen. */
export interface GraveBullRowRef {
  readonly action: GraveBullAction;
  readonly view: CowView;
}

/**
 * Its rows are warmed in three stages.
 *
 * - Arrival, kept warm through the wave's countdown by `AssaultWavePrewarm`:
 *   the walk, in the two views the approach lanes show — side-on along the
 *   east lane, from behind up the south one.
 * - Attack, in the one view it will charge in, {@link
 *   GRAVE_BULL_ATTACK_PREWARM_LEAD_FRAMES} before its first paw: the paw, the
 *   charge, the recoil off the wall and the idle it waits in after. The
 *   recoil follows the charge by a fraction of a second, too soon to bake it
 *   then.
 * - Death, at its first charge: the collapse and the loose bones.
 *
 * `scripts/gates-assault-residency.ts` drives the real cache through them.
 */
export const GRAVE_BULL_ARRIVAL_ROWS: readonly GraveBullRowRef[] = [
  { action: 'walk', view: 'side' },
  { action: 'walk', view: 'back' },
];
export const GRAVE_BULL_ATTACK_ACTIONS: readonly GraveBullAction[] = [
  'paw',
  'charge',
  'impact',
  'idle',
];
export const GRAVE_BULL_DEATH_ACTIONS: readonly GraveBullAction[] = ['death'];

/**
 * What one of its cells costs to bake, in milliseconds, as the lead is sized:
 * about 3.5 ms offline, supersampled, and browsers diverge in both directions.
 */
export const GRAVE_BULL_CELL_BAKE_MS_ESTIMATE = 6;
export const GRAVE_BULL_LEAD_SAFETY = 2;

/** Cache frames needed to warm an attack in one view, with the safety margin. */
export const GRAVE_BULL_ATTACK_PREWARM_LEAD_FRAMES = Math.ceil(
  (GRAVE_BULL_ATTACK_ACTIONS.reduce(
    (cells, action) =>
      cells + figureFrameCount(GRAVE_BULL_FIGURE, graveBullStateName(action, 'side')),
    0,
  ) *
    GRAVE_BULL_CELL_BAKE_MS_ESTIMATE *
    GRAVE_BULL_LEAD_SAFETY) /
    PREWARM_BAKE_BUDGET_MS,
);

/** Warms the walk it arrives on. A backstop: the wave's ticker keeps these warm. */
export function prewarmGraveBull(): void {
  for (const row of GRAVE_BULL_ARRIVAL_ROWS) {
    prewarmFigureState(GRAVE_BULL_FIGURE, graveBullStateName(row.action, row.view));
  }
}

/**
 * Warms the paw, the charge, the recoil and the idle in the view it will
 * charge in. Call {@link GRAVE_BULL_ATTACK_PREWARM_LEAD_FRAMES} cache frames
 * before its first paw — as it closes on the wall.
 */
export function prewarmGraveBullAttack(facing: CowView): void {
  for (const action of GRAVE_BULL_ATTACK_ACTIONS) {
    prewarmFigureState(
      GRAVE_BULL_FIGURE,
      graveBullStateName(action, graveBullViewFor(action, facing)),
    );
  }
}

/** Warms the death and the loose bones. Call at its first charge. */
export function prewarmGraveBullDeath(): void {
  for (const action of GRAVE_BULL_DEATH_ACTIONS) {
    for (const view of GRAVE_BULL_ACTION_VIEWS[action]) {
      prewarmFigureState(GRAVE_BULL_FIGURE, graveBullStateName(action, view));
    }
  }
  for (const part of GRAVE_BULL_GORE_PARTS) prewarmFigureState(GRAVE_BULL_FIGURE, part);
}

/** The view an action is drawn in: its own facing if painted, else the one view it has. */
export function graveBullViewFor(action: GraveBullAction, facing: CowView): CowView {
  const views = GRAVE_BULL_ACTION_VIEWS[action];
  return views.includes(facing) ? facing : (views[0] ?? 'side');
}

/**
 * Draws the Grave Bull. The walk and the charge frames should be advanced by
 * ground covered (`GRAVE_BULL_TILES_PER_WALK_CYCLE`,
 * `GRAVE_BULL_TILES_PER_CHARGE_CYCLE`), never by a timer.
 */
export function drawGraveBullSprite(
  ctx: CanvasRenderingContext2D,
  action: GraveBullAction,
  facing: CowView,
  frame: number,
  sx: number,
  sy: number,
  tileSize: number,
  flipX: boolean,
  alpha = 1,
): void {
  const view = graveBullViewFor(action, facing);
  drawFigureCached(
    ctx,
    GRAVE_BULL_FIGURE,
    graveBullStateName(action, view),
    frame,
    sx,
    sy,
    tileSize,
    {
      flipX: flipX && view === 'side',
      alpha,
    },
  );
}

/** How many frames an action's row has, read off the figure. */
export function graveBullFrameCount(action: GraveBullAction): number {
  return figureFrameCount(
    GRAVE_BULL_FIGURE,
    graveBullStateName(action, GRAVE_BULL_ACTION_VIEWS[action][0] ?? 'side'),
  );
}
