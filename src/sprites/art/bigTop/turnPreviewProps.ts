/**
 * The hall of mirrors' turn preview: the dotted ghost of where the light will
 * go after the next blow on a mirror, and the ring on a star it would light.
 *
 * Drawn live and never cached: the ghost moves every frame.
 */

import type { BeamDirection } from '../../../map/bigTopMazeLayout';
import { FULL_TURN, GILT_GLINT, IRON, outlineWidth, rgba } from './stagePropKit';

type Ctx = CanvasRenderingContext2D;

// ── The turn preview ────────────────────────────────────────────────────────

/** Dots per tile along the ghost path. */
const PREVIEW_DOTS_PER_TILE = 3;
/** A dot's radius, as a share of the tile. */
const PREVIEW_DOT_RADIUS = 0.055;
/** How far the dots march along the path each frame, in tiles: slow enough to read as a line. */
const PREVIEW_MARCH_TILES_PER_FRAME = 0.012;
/**
 * The ghost's strength. Faint on purpose: it is a question — "if I knock this
 * mirror" — and must never be mistaken for the live beam or for the hot span.
 */
const PREVIEW_DOT_ALPHA = 0.55;
/** A ring round the star the ghost would land on, as a share of the tile. */
const PREVIEW_STAR_RING_RADIUS = 0.42;
const PREVIEW_STAR_RING_ALPHA = 0.5;
/** Dash and gap of the star ring, as shares of the tile. */
const PREVIEW_RING_DASH = 0.08;
const PREVIEW_RING_GAP = 0.07;
const PREVIEW_DOT_FILL = rgba(GILT_GLINT, PREVIEW_DOT_ALPHA);
const PREVIEW_DOT_STROKE = rgba(IRON.shadow, PREVIEW_DOT_ALPHA);
const PREVIEW_RING_STROKE = rgba(GILT_GLINT, PREVIEW_STAR_RING_ALPHA);
/** Reused for every ring so a live draw allocates nothing per frame. */
const ringDash: number[] = [0, 0];

/** One tile of the ghost path the light would take after the next blow. */
export function drawTurnPreviewTile(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  heading: BeamDirection,
  phase: number,
): void {
  const vertical = heading === 'north' || heading === 'south';
  const forward = heading === 'south' || heading === 'east' ? 1 : -1;
  const spacing = 1 / PREVIEW_DOTS_PER_TILE;
  const march = (((phase * PREVIEW_MARCH_TILES_PER_FRAME * forward) % spacing) + spacing) % spacing;
  const radius = Math.max(1, PREVIEW_DOT_RADIUS * size);
  ctx.save();
  try {
    ctx.fillStyle = PREVIEW_DOT_FILL;
    ctx.strokeStyle = PREVIEW_DOT_STROKE;
    ctx.lineWidth = outlineWidth(size);
    for (let dot = 0; dot < PREVIEW_DOTS_PER_TILE; dot++) {
      const along = (dot * spacing + march) * size;
      const centreX = vertical ? x + size / 2 : x + along;
      const centreY = vertical ? y + along : y + size / 2;
      ctx.beginPath();
      ctx.arc(centreX, centreY, radius, 0, FULL_TURN);
      ctx.fill();
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}

/** A dashed ring on the star the ghost path would land on. */
export function drawTurnPreviewStarRing(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  ctx.save();
  try {
    ctx.strokeStyle = PREVIEW_RING_STROKE;
    ctx.lineWidth = outlineWidth(size);
    ringDash[0] = PREVIEW_RING_DASH * size;
    ringDash[1] = PREVIEW_RING_GAP * size;
    ctx.setLineDash(ringDash);
    ctx.lineDashOffset = -phase * PREVIEW_MARCH_TILES_PER_FRAME * size;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, PREVIEW_STAR_RING_RADIUS * size, 0, FULL_TURN);
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}
