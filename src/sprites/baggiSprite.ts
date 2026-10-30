import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { walkFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { TILE_SIZE } from '../core/constants';
import { idleFrameAtSeconds, TICKS_PER_SECOND } from './art/human/timing';
import { TALK_TICKS_PER_FRAME } from './art/human/actionsMisc';
import { RIG_WALK_GROUND_PER_CYCLE_PX } from './art/human/locomotion';
import { type DrawnFigureRow, drawnFigureRow, figureFrameCount } from './figure/figureDef';
import { scaleHumanoidBox } from './humanoidScale';
import {
  BAGGI_FIGURE,
  BAGGI_ROLES,
  BAGGI_VIEWS,
  type BaggiRole,
  type BaggiView,
  baggiStateName,
} from './art/baggiFigure';

/**
 * How much larger than her tile Baggi is drawn, about her feet. An orc stands
 * a head over the humans around her.
 */
export const BAGGI_DRAW_SCALE = 1.12;

/**
 * Tiles one walk cycle covers: the rig's own walk, drawn larger by her draw
 * scale. Pace the walk by distance with this and the planted foot holds still.
 */
export const BAGGI_TILES_PER_WALK_CYCLE =
  (RIG_WALK_GROUND_PER_CYCLE_PX * BAGGI_DRAW_SCALE) / TILE_SIZE;

/**
 * Every state the draw call can ask the figure for. The gates hold it against
 * what the figure paints: a state that drifts draws nothing and says nothing.
 */
export const BAGGI_DRAWN_STATES: readonly string[] = BAGGI_ROLES.flatMap((role) =>
  BAGGI_VIEWS.map((view) => baggiStateName(role, view)),
);

/** Everything the Baggi sprite needs to pick a cell. */
export interface BaggiSpriteState {
  readonly role: BaggiRole;
  /** The way she faces; picks the view, and the profile's mirroring. */
  readonly facingX: number;
  readonly facingY: number;
  /** Walk cycle angle in radians, 0..2π. */
  readonly walkPhase: number;
  /** Seconds on any steady clock; drives the idle breath and the talk. */
  readonly timeSeconds: number;
}

/** Views split on whichever axis she faces hardest along. */
function viewFor(facingX: number, facingY: number): BaggiView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function frameFor(state: BaggiSpriteState, name: string): number {
  const frames = Math.max(1, figureFrameCount(BAGGI_FIGURE, name));
  switch (state.role) {
    case 'walk':
      return walkFrameIndex(state.walkPhase, frames);
    case 'talk':
      return Math.floor((state.timeSeconds * TICKS_PER_SECOND) / TALK_TICKS_PER_FRAME) % frames;
    case 'idle':
      return idleFrameAtSeconds(state.timeSeconds);
    default: {
      const unhandled: never = state.role;
      throw new Error(`no clock for Baggi row ${String(unhandled)}`);
    }
  }
}

/** Frames in her walk row: the most one tick may advance its cycle is one of them. */
export function baggiWalkFrames(): number {
  return Math.max(1, figureFrameCount(BAGGI_FIGURE, baggiStateName('walk', 'side')));
}

/** Warms every row in every view, for the moment her shop is being set up. */
export function prewarmBaggiSprite(): void {
  for (const state of BAGGI_DRAWN_STATES) prewarmFigureState(BAGGI_FIGURE, state);
}

/**
 * Draw Baggi, a stout, kindly orc in a patched mustard coat and a washed
 * apron, on the tile whose top-left is (`sx`, `sy`), grown about her feet by
 * {@link BAGGI_DRAW_SCALE}. Returns the row drawn so a caller can hang a label
 * or icon over the art's measured top. Only the profile is mirrored.
 */
export function drawBaggiSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: BaggiSpriteState,
): DrawnFigureRow {
  const view = viewFor(state.facingX, state.facingY);
  const name = baggiStateName(state.role, view);
  const box = scaleHumanoidBox(sx, sy, tileSize, BAGGI_DRAW_SCALE);
  const flipX = view === 'side' && state.facingX < 0;
  drawFigureCached(ctx, BAGGI_FIGURE, name, frameFor(state, name), box.sx, box.sy, box.s, {
    flipX,
  });
  return drawnFigureRow(BAGGI_FIGURE, name);
}
