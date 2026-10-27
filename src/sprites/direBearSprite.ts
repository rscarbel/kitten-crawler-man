import { progressFrameIndex, walkFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import {
  DIRE_BEAR_FIGURE,
  DIRE_BEAR_IDLE_TICKS_PER_FRAME,
  type DireBearAction,
} from './art/direBearFigure';
import { figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

/** Checked by the review harness: a state the figure lacks draws nothing, silently. */
export const DIRE_BEAR_DRAWN_STATES: readonly DireBearAction[] = ['walk', 'idle', 'attack'];

/** Bakes its rows ahead of time so its first appearance does not bake mid-frame. */
export function prewarmDireBear(): void {
  for (const state of DIRE_BEAR_DRAWN_STATES) prewarmFigureState(DIRE_BEAR_FIGURE, state);
}

function frameCountOf(state: DireBearAction): number {
  return Math.max(1, figureFrameCount(DIRE_BEAR_FIGURE, state));
}

/**
 * Draw a Dire Bear — a heavy brown bear in profile, mirrored to face left.
 *
 * @param walkFrame  Gait phase in radians, advanced by ground covered.
 * @param attackAnim 0..1 — 0–0.5 rears up, 0.5–1 brings the swipe down.
 * @param idleTicks  Ticks on the clock that drives its breathing at rest.
 */
export function drawDireBearSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  attackAnim = 0,
  facingX = 1,
  idleTicks = 0,
): void {
  const flipX = facingX < 0;
  let state: DireBearAction = 'idle';
  let frame: number;
  if (attackAnim > 0) {
    state = 'attack';
    frame = progressFrameIndex(attackAnim, frameCountOf(state));
  } else if (isMoving) {
    state = 'walk';
    frame = walkFrameIndex(walkFrame, frameCountOf(state));
  } else {
    frame = Math.floor(idleTicks / DIRE_BEAR_IDLE_TICKS_PER_FRAME) % frameCountOf(state);
  }
  drawFigureCached(ctx, DIRE_BEAR_FIGURE, state, frame, sx, sy, s, { flipX });
}
