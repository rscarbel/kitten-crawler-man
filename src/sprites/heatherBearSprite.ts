import { progressFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import {
  HEATHER_BEAR_FIGURE,
  HEATHER_IDLE_TICKS_PER_FRAME,
  type HeatherAction,
} from './art/heatherBearFigure';
import { figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

/** Checked by the review harness: a state the figure lacks draws nothing, silently. */
export const HEATHER_DRAWN_STATES: readonly HeatherAction[] = ['walk', 'idle', 'attack'];

/** Bakes her rows ahead of time so her first appearance does not bake mid-frame. */
export function prewarmHeatherBear(): void {
  for (const state of HEATHER_DRAWN_STATES) prewarmFigureState(HEATHER_BEAR_FIGURE, state);
}

function frameCountOf(state: HeatherAction): number {
  return Math.max(1, figureFrameCount(HEATHER_BEAR_FIGURE, state));
}

/**
 * Draw Heather the Bear — the circus's beloved brown bear, transformed by
 * Scolopendra's poison: bare skull showing through torn fur round her near
 * eye and white parasite worms writhing from her forepaws.
 *
 * @param walkFrame  Gait phase in radians, advanced by ground covered.
 * @param attackAnim 0..1 — 0–0.5 rears up, 0.5–1 brings the swipe down.
 * @param idleTicks  Ticks on the clock that drives her breathing at rest.
 */
export function drawHeatherBearSprite(
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
  let state: HeatherAction = 'idle';
  let frame: number;
  if (attackAnim > 0) {
    state = 'attack';
    frame = progressFrameIndex(attackAnim, frameCountOf(state));
  } else if (isMoving) {
    state = 'walk';
    frame = walkFrameIndex(walkFrame, frameCountOf(state));
  } else {
    frame = Math.floor(idleTicks / HEATHER_IDLE_TICKS_PER_FRAME) % frameCountOf(state);
  }
  drawFigureCached(ctx, HEATHER_BEAR_FIGURE, state, frame, sx, sy, s, { flipX });
}
