import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import {
  RAISED_ACTION_VIEWS,
  raisedRatkinFigure,
  raisedStateName,
  type RaisedRatkinAction,
} from './art/raisedRatkinFigure';
import type { RaisedRatkinLook } from './art/raisedRatkinArt';
import type { RatKinView } from './art/ratKinArt';

/**
 * Every state this wrapper can ask a raised ratkin figure for. An art gate
 * holds it against what the figures paint: the draw call returns silently on
 * a state it cannot find, so a drifted name is an invisible corpse.
 */
export const RAISED_DRAWN_STATES: readonly string[] = Object.entries(RAISED_ACTION_VIEWS).flatMap(
  ([action, views]) => views.map((view) => `${action}${view === 'front' ? '' : `_${view}`}`),
);

/**
 * The rows a raised ratkin plays from the moment it is summoned: the rise it
 * comes up in, and the shamble and idle it stands into. The claw, the flinch
 * and the death follow once it engages.
 */
export const RAISED_PREWARMED_ACTIONS: readonly RaisedRatkinAction[] = ['rise', 'shamble', 'idle'];

/**
 * The rows a wave of them arrives playing, kept warm through its countdown by
 * `AssaultWavePrewarm`: the rise out of the ground, and the shamble in the two
 * views the approach lanes show — side-on along the east lane, from behind up
 * the south one. The rest are warmed as they come within reach.
 */
export const RAISED_ARRIVAL_ROWS: readonly { action: RaisedRatkinAction; view: RatKinView }[] = [
  { action: 'rise', view: 'front' },
  { action: 'shamble', view: 'side' },
  { action: 'shamble', view: 'away' },
];
export const RAISED_ENGAGED_ACTIONS: readonly RaisedRatkinAction[] = ['claw', 'hurt', 'death'];

function prewarmActions(look: RaisedRatkinLook, actions: readonly RaisedRatkinAction[]): void {
  const figure = raisedRatkinFigure(look);
  for (const action of actions) {
    for (const view of RAISED_ACTION_VIEWS[action]) {
      prewarmFigureState(figure, raisedStateName(action, view));
    }
  }
}

/** Warms what a summoned raised ratkin plays first. Call where the raise is scheduled. */
export function prewarmRaisedRatkin(look: RaisedRatkinLook): void {
  prewarmActions(look, RAISED_PREWARMED_ACTIONS);
}

/** Warms the fighting rows, for when a raised ratkin first engages. */
export function prewarmRaisedRatkinFight(look: RaisedRatkinLook): void {
  prewarmActions(look, RAISED_ENGAGED_ACTIONS);
}

/** The view an action is drawn in, falling back to head-on for the front-only rows. */
export function raisedViewFor(action: RaisedRatkinAction, facing: RatKinView): RatKinView {
  return RAISED_ACTION_VIEWS[action].includes(facing) ? facing : 'front';
}

/**
 * Draws a raised ratkin. `facing` is the view it is turned to; `flipX` mirrors
 * the profile for a westward facing. The shamble's frame should be advanced by
 * ground covered (`RAISED_RATKIN_TILES_PER_SHAMBLE_CYCLE`), never by a timer.
 */
export function drawRaisedRatkinSprite(
  ctx: CanvasRenderingContext2D,
  look: RaisedRatkinLook,
  action: RaisedRatkinAction,
  facing: RatKinView,
  frame: number,
  sx: number,
  sy: number,
  tileSize: number,
  flipX: boolean,
  alpha = 1,
): void {
  const view = raisedViewFor(action, facing);
  drawFigureCached(
    ctx,
    raisedRatkinFigure(look),
    raisedStateName(action, view),
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

/** How many frames an action's row has, read off the figure rather than retyped. */
export function raisedFrameCount(action: RaisedRatkinAction): number {
  return figureFrameCount(raisedRatkinFigure('smock'), raisedStateName(action, 'front'));
}
