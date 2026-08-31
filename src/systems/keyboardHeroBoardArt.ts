/**
 * The keyboard-hero board's drawing primitives, shared by everything that shows
 * the board: the live mini-game, the tutorial that teaches it, and the dev
 * preview scene that reviews it.
 *
 * Keeping them here is what stops the tutorial from drifting back into
 * hand-drawing an approximation of the board that looks nothing like the board.
 * Every caller works in the same board space, off the same `KeyboardHeroLayout`,
 * against the same painted pieces.
 *
 * The pieces come from `keyboardHeroArtCache`, which paints each of them once
 * and blits it thereafter, so a draw here costs what the retired sheets cost
 * without their floor-long residency.
 */

import { drawBox } from '../ui/Box';
import type { CanvasSurface } from '../core/canvasSurface';
import type { NoteState, ReceptorState, TouchState } from '../sprites/art/keyboardHeroArt';
import {
  boardFrameArt,
  laneBedArt,
  laneHighlightArt,
  noteKeycapArt,
  receptorArt,
  touchButtonArt,
} from './keyboardHeroArtCache';
import {
  BOARD_BAKE_SCALE,
  LANE_BED_IMG_H,
  LANE_BED_IMG_W,
  LANE_INDICES,
  LANE_PALETTES,
  type KeyboardHeroLayout,
  type LaneIndex,
  type Rect,
} from './keyboardHeroLayout';

export type NoteArtState = NoteState;
export type ReceptorArtState = ReceptorState;
export type TouchArtState = TouchState;

/** Alpha of the soft band showing how far either side of the line a press still counts. */
export const HIT_WINDOW_BAND_ALPHA = 0.1;
export const HIT_LINE_ALPHA = 0.75;
/** Board-space thickness of the hit line. */
const HIT_LINE_IMG_H = 2.5;

/** Peak alpha of the additive neutral lift under a lane press or error flash. */
export const LANE_HIGHLIGHT_ALPHA = 0.42;
/** Peak alpha of the additive hue laid over that lift to colour it. */
export const LANE_TINT_ALPHA = 0.5;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Blit a painted piece into a rect. A collapsed layout has no piece and draws nothing. */
function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: CanvasSurface | null,
  rect: Rect,
  alpha: number,
): void {
  if (piece === null) return;
  ctx.save();
  ctx.globalAlpha = clamp01(alpha);
  ctx.drawImage(piece, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

export function drawBoardFrame(ctx: CanvasRenderingContext2D, layout: KeyboardHeroLayout): void {
  const { board } = layout;
  drawPiece(ctx, boardFrameArt(board.width, board.height), board, 1);
}

/** One lane's bed in an arbitrary rect, for reviewing a bed away from the board. */
export function drawLaneBedInRect(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  lane: LaneIndex,
  alpha: number,
): void {
  drawPiece(ctx, laneBedArt(lane, rect.width, rect.height), rect, alpha);
}

export function drawLaneBed(
  ctx: CanvasRenderingContext2D,
  layout: KeyboardHeroLayout,
  lane: LaneIndex,
  alpha: number,
): void {
  drawLaneBedInRect(ctx, layout.lanes[lane], lane, alpha);
}

/**
 * A band of one lane's bed, centred on a note-space depth, stretched into `rect`
 * — the surface a swatch of note or receptor art is judged against, since that
 * is the only thing any of it is ever seen on.
 *
 * The band is cut out of a bed painted at its own board-space size rather than
 * by oversizing and clipping the destination: a review page shows several swatch
 * sizes at once, and a destination-sized bed would be a different cache entry for
 * each of them, repainting a full-depth bed several times per frame.
 */
export function drawLaneBedSlice(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  lane: LaneIndex,
  centerImgY: number,
  depthImgH: number,
): void {
  const piece = laneBedArt(lane, LANE_BED_IMG_W, LANE_BED_IMG_H);
  if (piece === null) return;
  const sourceDepth = depthImgH * BOARD_BAKE_SCALE;
  ctx.drawImage(
    piece,
    0,
    centerImgY * BOARD_BAKE_SCALE - sourceDepth / 2,
    LANE_BED_IMG_W * BOARD_BAKE_SCALE,
    sourceDepth,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  );
}

export function drawAllLaneBeds(
  ctx: CanvasRenderingContext2D,
  layout: KeyboardHeroLayout,
  alphaFor: (lane: LaneIndex) => number,
): void {
  for (const lane of LANE_INDICES) drawLaneBed(ctx, layout, lane, alphaFor(lane));
}

/**
 * The band is what makes the frozen hit window visible: it is exactly as deep,
 * either side of the line, as a press is still counted. Guitar hero's receptors
 * say "press here"; this says "and here is the slack you have".
 */
export function drawHitWindow(
  ctx: CanvasRenderingContext2D,
  layout: KeyboardHeroLayout,
  lineAlphaScale: number,
): void {
  ctx.save();
  clipToLanes(ctx, layout);
  ctx.globalCompositeOperation = 'lighter';

  ctx.globalAlpha = HIT_WINDOW_BAND_ALPHA;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(
    layout.laneArea.x,
    layout.hitLineY - layout.hitWindowHalfHeight,
    layout.laneArea.width,
    layout.hitWindowHalfHeight * 2,
  );

  ctx.globalAlpha = clamp01(HIT_LINE_ALPHA * lineAlphaScale);
  const lineH = Math.max(1, HIT_LINE_IMG_H * layout.scale);
  ctx.fillRect(layout.laneArea.x, layout.hitLineY - lineH / 2, layout.laneArea.width, lineH);
  ctx.restore();
}

/**
 * A lane's press / error lift is drawn additively rather than by tinting the
 * bed: `source-atop` on the shared canvas would recolour everything already
 * under the lane, and an offscreen tint buffer would have to be rebuilt on every
 * resize. Adding the neutral strip for brightness and then the hue for colour
 * gets the same glow with neither problem.
 */
export function drawLaneHighlight(
  ctx: CanvasRenderingContext2D,
  layout: KeyboardHeroLayout,
  lane: LaneIndex,
  color: string,
  strength: number,
): void {
  if (strength <= 0) return;
  const rect = layout.lanes[lane];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawPiece(ctx, laneHighlightArt(rect.width, rect.height), rect, LANE_HIGHLIGHT_ALPHA * strength);
  ctx.globalAlpha = clamp01(LANE_TINT_ALPHA * strength);
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

/**
 * The board's static layers, in the one order they are allowed to go down.
 *
 * The order is load-bearing and not obvious: the frame's lane well is
 * opaque near-black, so the housing has to be laid down *first* and the beds
 * painted into its well. Drawn the other way round the frame erases every lane
 * hue, the hit-window band and the press and error highlights that ride on them,
 * and the board becomes a black slab with four dividers.
 *
 * Every surface that shows the board — the live game, the tutorial, the preview
 * scene — composites through here, so there is only one order to get right.
 *
 * @param laneAlphaFor - per-lane bed alpha, carrying the beat pulse.
 * @param hitLineAlphaScale - multiplier on the hit line's own alpha, for the same pulse.
 */
export function drawBoardBase(
  ctx: CanvasRenderingContext2D,
  layout: KeyboardHeroLayout,
  laneAlphaFor: (lane: LaneIndex) => number,
  hitLineAlphaScale: number,
): void {
  drawBoardFrame(ctx, layout);
  drawAllLaneBeds(ctx, layout, laneAlphaFor);
  drawHitWindow(ctx, layout, hitLineAlphaScale);
}

/** A receptor in an arbitrary square rect, for reviewing one away from the board. */
export function drawReceptorInRect(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  lane: LaneIndex,
  state: ReceptorArtState,
): void {
  drawPiece(ctx, receptorArt(lane, state, rect.width), rect, 1);
}

export function drawReceptor(
  ctx: CanvasRenderingContext2D,
  layout: KeyboardHeroLayout,
  lane: LaneIndex,
  state: ReceptorArtState,
): void {
  drawReceptorInRect(ctx, layout.receptors[lane], lane, state);
}

/** Draw a note keycap centred on a point, at an arbitrary size and alpha. */
export function drawNoteKeycap(
  ctx: CanvasRenderingContext2D,
  lane: LaneIndex,
  centerX: number,
  centerY: number,
  size: number,
  state: NoteArtState,
  alpha: number,
): void {
  drawPiece(
    ctx,
    noteKeycapArt(lane, state),
    { x: centerX - size / 2, y: centerY - size / 2, width: size, height: size },
    alpha,
  );
}

export function drawTouchButton(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  lane: LaneIndex,
  state: TouchArtState,
): void {
  drawPiece(ctx, touchButtonArt(lane, state, rect.width), rect, 1);
}

/** Clip subsequent drawing to the play area, so notes never spill onto the frame. */
export function clipToLanes(ctx: CanvasRenderingContext2D, layout: KeyboardHeroLayout): void {
  ctx.beginPath();
  ctx.rect(layout.laneArea.x, layout.laneArea.y, layout.laneArea.width, layout.laneArea.height);
  ctx.clip();
}

/** The colour a lane's own feedback is drawn in. */
export function laneHue(lane: LaneIndex): string {
  return LANE_PALETTES[lane].hue;
}

// ── Firewall integrity pips ─────────────────────────────────────────────────
// The two-strike rule is the mini-game's least discoverable mechanic, so the
// live HUD and the tutorial that explains it draw the same two pips from here.

const PIP_INTACT_FILL = 'rgba(79,195,247,0.35)';
export const PIP_INTACT_BORDER = '#4fc3f7';
const PIP_LOST_FILL = 'rgba(70,20,20,0.6)';
const PIP_LOST_BORDER = '#7f1d1d';
const PIP_BORDER_WIDTH = 1.5;
const PIP_RADIUS = 2;

/** Draw one firewall pip, either whole or already breached. */
export function drawFirewallPip(ctx: CanvasRenderingContext2D, rect: Rect, intact: boolean): void {
  drawBox(ctx, {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    fill: intact ? PIP_INTACT_FILL : PIP_LOST_FILL,
    border: intact ? PIP_INTACT_BORDER : PIP_LOST_BORDER,
    borderWidth: PIP_BORDER_WIDTH,
    radius: PIP_RADIUS,
  });
}
