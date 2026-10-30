/**
 * Draw wrapper for the Demon Liaison: picks a row of `DEMON_LIAISON_FIGURE`
 * from what he is doing and which way he faces, and a frame from the ground
 * he has covered or the clock, and blits it through the shared figure cache.
 *
 * A finished character asset with no placement yet: nothing in play draws it.
 * Its readers are the `?demonliaison` preview and `npm run render:demon-liaison`.
 */

import { walkFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../core/constants';
import { drawFigureCached } from './figure/figureFrameCache';
import { type DrawnFigureRow, figureFrameCount, drawnFigureRow } from './figure/figureDef';
import {
  DEMON_LIAISON_FIGURE,
  DEMON_LIAISON_HEIGHT_SCALE,
  DEMON_LIAISON_ROLES,
  DEMON_LIAISON_VIEWS,
  type DemonLiaisonRole,
  type DemonLiaisonView,
  demonLiaisonStateName,
} from './art/demonLiaisonFigure';
import { RIG_WALK_GROUND_PER_CYCLE_PX } from './art/human/locomotion';
import { idleFrameAtSeconds } from './art/human/timing';
import { TALK_TICKS_PER_FRAME } from './art/human/actionsMisc';

/**
 * Every state this wrapper can ask the figure for. The harness holds it
 * against what the figure paints: the draw call returns silently on a state
 * it cannot find, so a name that drifts is an invisible NPC and no log line.
 */
export const DEMON_LIAISON_DRAWN_STATES: readonly string[] = DEMON_LIAISON_ROLES.flatMap((role) =>
  DEMON_LIAISON_VIEWS.map((view) => demonLiaisonStateName(role, view)),
);

/**
 * Ground one walk cycle covers, in tiles: the rig's own walk on a figure scaled
 * up by his height. Pace the walk by distance with this and the planted foot
 * holds still.
 */
export const DEMON_LIAISON_TILES_PER_WALK_CYCLE =
  (RIG_WALK_GROUND_PER_CYCLE_PX * DEMON_LIAISON_HEIGHT_SCALE) / TILE_SIZE;

/** Everything the Demon Liaison sprite needs to pick a pose. */
export interface DemonLiaisonSpriteState {
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
function viewFor(facingX: number, facingY: number): DemonLiaisonView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

const MS_PER_SECOND = 1000;

function roleOf(state: DemonLiaisonSpriteState): DemonLiaisonRole {
  if (state.isWalking) return 'walk';
  return state.isTalking ? 'talk' : 'idle';
}

function frameFor(role: DemonLiaisonRole, state: DemonLiaisonSpriteState, frames: number): number {
  if (role === 'walk') return walkFrameIndex(state.walkPhase, frames);
  const seconds = performance.now() / MS_PER_SECOND + state.idleOffsetSeconds;
  if (role === 'talk')
    return Math.floor((seconds * WORLD_TICKS_PER_SECOND) / TALK_TICKS_PER_FRAME) % frames;
  return idleFrameAtSeconds(seconds);
}

/**
 * Draw the Demon Liaison standing on the tile whose top-left is `(sx, sy)`, returning
 * the row drawn, or `undefined` when he paints nothing for that pose. Only the
 * profile is mirrored: the head-on rows keep his sash knot and tail on their
 * own side when he turns round.
 */
export function drawDemonLiaisonSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: DemonLiaisonSpriteState,
): DrawnFigureRow | undefined {
  const view = viewFor(state.facingX, state.facingY);
  const role = roleOf(state);
  const key = demonLiaisonStateName(role, view);
  const frames = figureFrameCount(DEMON_LIAISON_FIGURE, key);
  if (frames === 0) return undefined;
  const flipX = view === 'side' && state.facingX < 0;
  drawFigureCached(
    ctx,
    DEMON_LIAISON_FIGURE,
    key,
    frameFor(role, state, frames),
    sx,
    sy,
    tileSize,
    {
      flipX,
    },
  );
  return drawnFigureRow(DEMON_LIAISON_FIGURE, key);
}
