/**
 * Draws one piece of Desperado Club furniture from the generated sprite sheets.
 *
 * The sheets store each variant as a frame of a single `idle` state, so a prop's
 * `variant` is the frame index. The only motion is a prop's chasing bulbs, which
 * step through the cached frames of their own light sheet laid over the body.
 */

import { TILE_SIZE } from '../core/constants';
import { drawSpriteKey } from '../core/SpriteRenderer';
import type { ClubProp } from '../core/clubProps';
import clubSpriteManifest from '../images/environment/club/manifest.json';

/**
 * Draws `prop` at its layout tile, offset by the camera and by any art shift.
 * `elapsedSeconds` is the club's own clock, which drives the bulb chase.
 */
export function drawClubProp(
  ctx: CanvasRenderingContext2D,
  prop: ClubProp,
  camX: number,
  camY: number,
  elapsedSeconds: number,
): void {
  const screenX = (prop.tile.x + (prop.artShiftTilesX ?? 0)) * TILE_SIZE - camX;
  const screenY = prop.tile.y * TILE_SIZE - camY;
  drawSpriteKey(ctx, prop.sprite, 'idle', prop.variant, screenX, screenY, TILE_SIZE);

  const lights = prop.lights;
  if (lights === undefined) return;
  const phaseCount = clubSpriteManifest[lights.sprite].states.idle.frameCount;
  const step = Math.floor(elapsedSeconds * lights.stepsPerSecond) + lights.phaseOffset;
  const phase = step % phaseCount;
  drawSpriteKey(ctx, lights.sprite, 'idle', phase, screenX, screenY, TILE_SIZE);
}
