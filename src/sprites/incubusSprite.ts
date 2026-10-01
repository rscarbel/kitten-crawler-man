/**
 * Draw wrapper for Mordecai's Incubus shape: picks a row of `INCUBUS_FIGURE`
 * from what he is doing and which way he faces, and a frame from the ground
 * he has covered or the clock, and blits it through the shared figure cache.
 */

import { walkFrameIndex } from '../core/SpriteRenderer';
import { TILE_SIZE } from '../core/constants';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { type DrawnFigureRow, figureFrameCount, drawnFigureRow } from './figure/figureDef';
import {
  INCUBUS_FIGURE,
  INCUBUS_HEIGHT_SCALE,
  INCUBUS_ROLES,
  INCUBUS_TILE_SCALE,
  INCUBUS_VIEWS,
  type IncubusRole,
  type IncubusView,
  incubusStateName,
} from './art/incubusFigure';
import { WALK_GROUND_PER_CYCLE_PX } from './art/human/locomotion';
import { idleFrameAtSeconds, TICKS_PER_SECOND } from './art/human/timing';
import { TALK_TICKS_PER_FRAME } from './art/human/actionsMisc';

/**
 * Every state this wrapper can ask the figure for. The harness holds it
 * against what the figure paints: the draw call returns silently on a state
 * it cannot find, so a name that drifts is an invisible NPC and no log line.
 */
export const INCUBUS_DRAWN_STATES: readonly string[] = INCUBUS_ROLES.flatMap((role) =>
  INCUBUS_VIEWS.map((view) => incubusStateName(role, view)),
);

/**
 * The rows warmed the moment a safe room stands him up: every idle view, since
 * he is standing the frame the room exists and the player can walk in from any
 * side. The walk follows within a wander beat, and the talk only once spoken
 * to; both bake on first use while the cache's own approximation covers them.
 */
const PREWARMED_STATES: readonly string[] = INCUBUS_VIEWS.map((view) =>
  incubusStateName('idle', view),
);

export function prewarmIncubusSprite(): void {
  for (const state of PREWARMED_STATES) prewarmFigureState(INCUBUS_FIGURE, state);
}

/**
 * Ground one walk cycle covers, in world pixels at the standard tile: Carl's
 * own walk, whose rows these are, on a figure scaled up by his height. Pace
 * the walk by distance with this and the planted foot holds still.
 */
export const INCUBUS_PIXELS_PER_WALK_CYCLE = WALK_GROUND_PER_CYCLE_PX * INCUBUS_HEIGHT_SCALE;

/** Tiles per walk cycle, for callers that measure the world in tiles. */
export const INCUBUS_TILES_PER_WALK_CYCLE = INCUBUS_PIXELS_PER_WALK_CYCLE / TILE_SIZE;

/**
 * The topmost inked row of any idle, walk or talk frame, in cell pixels — the
 * horn tips or the wing peaks. Measured off the painted cells, because the
 * anchor only says where his feet are; the harness
 * (`scripts/render-mordecai-incubus.ts`) re-measures it and fails when a
 * redraw moves it.
 */
export const INCUBUS_INK_TOP_PX = 69;

/** How far above his tile's top edge the art reaches, in tiles. */
export function incubusHeadClearanceTiles(): number {
  return (INCUBUS_FIGURE.tileY - INCUBUS_INK_TOP_PX) / INCUBUS_TILE_SCALE;
}

/** Everything the Incubus sprite needs to pick a pose. */
export interface IncubusSpriteState {
  /** Walk-cycle angle in radians, advanced by the ground he has covered. */
  readonly walkPhase: number;
  readonly isWalking: boolean;
  readonly isTalking: boolean;
  /** +1 faces right, −1 faces left, 0 while walking along the vertical axis. */
  readonly facingX: number;
  /** +1 faces toward the camera, −1 away, 0 neither. */
  readonly facingY: number;
  /** Offset into the clock-driven loops, so two of him do not breathe in unison. */
  readonly idleOffsetSeconds: number;
}

/** Views split on whichever axis he is facing hardest along. */
function viewFor(facingX: number, facingY: number): IncubusView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

const MS_PER_SECOND = 1000;

function roleOf(state: IncubusSpriteState): IncubusRole {
  if (state.isWalking) return 'walk';
  return state.isTalking ? 'talk' : 'idle';
}

function frameFor(role: IncubusRole, state: IncubusSpriteState, frames: number): number {
  if (role === 'walk') return walkFrameIndex(state.walkPhase, frames);
  const seconds = performance.now() / MS_PER_SECOND + state.idleOffsetSeconds;
  if (role === 'talk')
    return Math.floor((seconds * TICKS_PER_SECOND) / TALK_TICKS_PER_FRAME) % frames;
  return idleFrameAtSeconds(seconds);
}

/**
 * Draw the Incubus standing on the tile whose top-left is `(sx, sy)`, returning
 * the row drawn, or `undefined` when he paints nothing for that pose. Only the
 * profile is mirrored: the head-on rows keep his sash knot and tail on their
 * own side when he turns round.
 */
export function drawIncubusSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: IncubusSpriteState,
): DrawnFigureRow | undefined {
  const view = viewFor(state.facingX, state.facingY);
  const role = roleOf(state);
  const key = incubusStateName(role, view);
  const frames = figureFrameCount(INCUBUS_FIGURE, key);
  if (frames === 0) return undefined;
  const flipX = view === 'side' && state.facingX < 0;
  drawFigureCached(ctx, INCUBUS_FIGURE, key, frameFor(role, state, frames), sx, sy, tileSize, {
    flipX,
  });
  return drawnFigureRow(INCUBUS_FIGURE, key);
}
