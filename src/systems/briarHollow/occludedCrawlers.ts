/**
 * A crawler standing just behind a tall village structure — north of the
 * palisade, the closed gate or a trebuchet — is drawn before it in the
 * Y-sort and so is partly hidden by it. This redraws that crawler faintly
 * over the structure, so the player never loses sight of who they are
 * steering.
 *
 * The crawler is painted opaque into a scratch canvas and the finished image
 * is blitted once at reduced alpha: `Player.render` sets absolute alphas on
 * several of its own paths (hit flash, status coats, the knocked-out ring), so
 * drawing it straight in under a lowered alpha would pop back to opaque
 * whenever one of those is showing.
 */

import type { Player } from '../../Player';
import { PLAYER_HIT_FLASH_MARGIN_TILES } from '../../Player';
import { TILE_SIZE } from '../../core/constants';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';

/** How strongly the hidden crawler shows through: a ghost, not a second body. */
export const OCCLUDED_CRAWLER_ALPHA = 0.5;

let scratch: { surface: CanvasSurface; ctx: CanvasRenderingContext2D; size: number } | null = null;

/** A grow-only scratch canvas, reused every frame rather than allocated per crawler. */
function scratchOf(size: number): { surface: CanvasSurface; ctx: CanvasRenderingContext2D } {
  if (scratch === null || scratch.size < size) {
    const grown = Math.max(size, scratch?.size ?? 0);
    const surface = allocCanvas(grown, grown);
    scratch = { surface, ctx: surfaceContext(surface), size: grown };
  }
  return scratch;
}

/** Draws `player` over whatever hides it, at {@link OCCLUDED_CRAWLER_ALPHA}. */
export function drawOccludedCrawler(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  player: Player,
): void {
  const margin = PLAYER_HIT_FLASH_MARGIN_TILES * TILE_SIZE;
  const cssSize = TILE_SIZE + margin * 2;
  const transform = ctx.getTransform();
  const scaleX = transform.a;
  const scaleY = transform.d;
  const isPlainScale = transform.b === 0 && transform.c === 0 && scaleX > 0 && scaleY > 0;
  if (!isPlainScale) return;
  const deviceSize = Math.ceil(cssSize * Math.max(scaleX, scaleY));
  const { surface, ctx: scratchCtx } = scratchOf(deviceSize);
  scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
  scratchCtx.globalAlpha = 1;
  scratchCtx.globalCompositeOperation = 'source-over';
  scratchCtx.clearRect(0, 0, deviceSize, deviceSize);
  scratchCtx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  player.render(scratchCtx, player.x - margin, player.y - margin, TILE_SIZE);
  ctx.save();
  ctx.globalAlpha *= OCCLUDED_CRAWLER_ALPHA;
  ctx.drawImage(
    surface,
    0,
    0,
    deviceSize,
    deviceSize,
    player.x - camX - margin,
    player.y - camY - margin,
    cssSize,
    cssSize,
  );
  ctx.restore();
}
