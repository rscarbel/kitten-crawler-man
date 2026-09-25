/**
 * A thrall: the hooded, ragged ratkin laborer of `thrallFigure.ts`, washed in
 * the soul green and drawn translucent with a glowing rim.
 *
 * The figure is drawn fully opaque into a reused scratch canvas, tinted there,
 * and only then blitted once at the thrall's alpha. Drawing it straight into
 * the scene at reduced alpha would let every overlapping part of the figure
 * show through the part in front of it — an arm seen through the chest — which
 * reads as a stack of ghosts rather than one.
 */

import { allocCanvas, type CanvasSurface, surfaceContext } from '../core/canvasSurface';
import { drawFigureCached } from './figure/figureFrameCache';
import { thrallFigure } from './art/thrallFigure';
import type { ToolKind } from '../core/toolTiers';
import { SOUL_CORE, SOUL_DEEP, SOUL_MID, soulRgba } from './soulPalette';

/** How opaque a thrall is at full presence. */
export const THRALL_ALPHA = 0.55;

/**
 * The scratch canvas is the figure's own cell, and the figure's tile sits in
 * it where the cell puts it — read off the figure, so a re-cut cell cannot
 * leave the ghost standing off its tile. Both thrall figures share one cell.
 */
const CELL_FIGURE = thrallFigure('axe');
const SCRATCH_TILES_WIDE = CELL_FIGURE.frameWidth / CELL_FIGURE.tileScale;
const SCRATCH_TILES_HIGH = CELL_FIGURE.frameHeight / CELL_FIGURE.tileScale;
const SCRATCH_TILE_LEFT = CELL_FIGURE.tileX / CELL_FIGURE.tileScale;
const SCRATCH_TILE_TOP = CELL_FIGURE.tileY / CELL_FIGURE.tileScale;

/** How strongly the soul green washes over the figure's own colours: enough to read as a ghost, not so much it loses its shading. */
const SOUL_WASH_ALPHA = 0.45;
/** The rim: the tinted figure laid additively a pixel out on each side. */
const RIM_OFFSET_PX = 1;
const RIM_ALPHA = 0.16;
const RIM_OFFSETS: readonly (readonly [number, number])[] = [
  [RIM_OFFSET_PX, 0],
  [-RIM_OFFSET_PX, 0],
  [0, RIM_OFFSET_PX],
  [0, -RIM_OFFSET_PX],
];

/** The wisp trail: soft soul-green puffs trailing below and behind a gliding thrall. */
const WISP_COUNT = 4;
const WISP_SPACING_TILES = 0.16;
const WISP_RADIUS_TILES = 0.12;
const WISP_ALPHA = 0.3;
const WISP_BASE_Y_TILES = 0.85;
const FULL_TURN = Math.PI * 2;

let scratch: {
  surface: CanvasSurface;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
} | null = null;

function scratchFor(
  width: number,
  height: number,
): { surface: CanvasSurface; ctx: CanvasRenderingContext2D } {
  if (scratch === null || scratch.width < width || scratch.height < height) {
    const surface = allocCanvas(width, height);
    scratch = { surface, ctx: surfaceContext(surface), width, height };
  }
  return scratch;
}

/**
 * Every row a thrall can be drawn in. The runtime's choice is typed against
 * this one list and the art gate checks both thrall figures paint it, so a row
 * renamed on either side fails a gate instead of drawing nothing.
 */
export const THRALL_STATES = [
  'idle',
  'idle_side',
  'idle_away',
  'walk',
  'walk_side',
  'walk_away',
  'work',
  'work_side',
] as const;

export type ThrallState = (typeof THRALL_STATES)[number];

/** What a thrall looks like on one frame. */
export interface ThrallLook {
  /** What it holds, which picks the figure. */
  readonly tool: ToolKind;
  /** The row it is posed in: idle, a walk while it glides, work at its node. */
  readonly state: ThrallState;
  readonly frame: number;
  /** Mirrors a profile row to face −X. */
  readonly flipX: boolean;
  /** 0–1: fade-in on summon, fade-out on expiry. */
  readonly presence: number;
  /** Which way it last moved, for the wisp trail; zero when it is working in place. */
  readonly trailX: number;
  readonly trailY: number;
}

/** Draws a thrall with its tile's top-left at screen (`sx`, `sy`). */
export function drawThrall(
  ctx: CanvasRenderingContext2D,
  look: ThrallLook,
  sx: number,
  sy: number,
  tileSize: number,
): void {
  if (look.presence <= 0) return;
  const width = Math.ceil(SCRATCH_TILES_WIDE * tileSize);
  const height = Math.ceil(SCRATCH_TILES_HIGH * tileSize);
  const { surface, ctx: scratchCtx } = scratchFor(width, height);
  const originX = SCRATCH_TILE_LEFT * tileSize;
  const originY = SCRATCH_TILE_TOP * tileSize;

  scratchCtx.save();
  scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
  scratchCtx.globalCompositeOperation = 'source-over';
  scratchCtx.globalAlpha = 1;
  scratchCtx.clearRect(0, 0, width, height);
  drawFigureCached(
    scratchCtx,
    thrallFigure(look.tool),
    look.state,
    look.frame,
    originX,
    originY,
    tileSize,
    { flipX: look.flipX },
  );
  scratchCtx.globalCompositeOperation = 'source-atop';
  scratchCtx.fillStyle = soulRgba(SOUL_MID, SOUL_WASH_ALPHA);
  scratchCtx.fillRect(0, 0, width, height);
  scratchCtx.restore();

  const left = sx - originX;
  const top = sy - originY;
  ctx.save();
  drawWisps(ctx, look, sx, sy, tileSize);
  ctx.globalAlpha = look.presence * THRALL_ALPHA;
  ctx.drawImage(surface, 0, 0, width, height, left, top, width, height);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = look.presence * RIM_ALPHA;
  for (const [dx, dy] of RIM_OFFSETS) {
    ctx.drawImage(surface, 0, 0, width, height, left + dx, top + dy, width, height);
  }
  ctx.restore();
}

function drawWisps(
  ctx: CanvasRenderingContext2D,
  look: ThrallLook,
  sx: number,
  sy: number,
  tileSize: number,
): void {
  const trailLength = Math.hypot(look.trailX, look.trailY);
  const backX = trailLength > 0 ? -look.trailX / trailLength : 0;
  const backY = trailLength > 0 ? -look.trailY / trailLength : 0;
  const baseX = sx + tileSize / 2;
  const baseY = sy + WISP_BASE_Y_TILES * tileSize;
  for (let i = 0; i < WISP_COUNT; i++) {
    const along = (i + 1) * WISP_SPACING_TILES * tileSize;
    const fade = 1 - i / WISP_COUNT;
    const x = baseX + backX * along;
    const y = baseY + backY * along;
    const radius = WISP_RADIUS_TILES * tileSize * fade;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, soulRgba(SOUL_CORE, WISP_ALPHA * fade * look.presence));
    glow.addColorStop(1, soulRgba(SOUL_DEEP, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, FULL_TURN);
    ctx.fill();
  }
}
