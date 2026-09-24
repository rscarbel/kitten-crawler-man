/**
 * Icons for the folded-for-carrying trebuchet and snare kits.
 *
 * Both share a crate silhouette — they are literally "a structure, folded
 * into a box" — and differ only in the branded plate on the crate's face, so
 * a player can tell them apart without reading the tooltip. The plate is a
 * separate light patch behind the mark rather than the mark painted straight
 * onto the crate's wood, because a thin dark stroke on medium-brown wood
 * disappears at hotbar size; a bold shape on a pale plate does not.
 */

import type { ItemId } from '../../core/ItemDefs';

/** The two kit ids this module can draw. Closed, so a new kit cannot ship iconless. */
export type KitIconId = 'trebuchet_kit' | 'snare_kit';

/** Every id this module can draw, the single source of truth for the id set below and for the icon bake gate. */
export const KIT_ICON_ID_LIST: readonly KitIconId[] = ['trebuchet_kit', 'snare_kit'];

const KIT_ICON_IDS: ReadonlySet<string> = new Set<KitIconId>(KIT_ICON_ID_LIST);

/** Whether `id` is a kit, and so drawable by {@link drawKitIcon}. */
export function isKitIconId(id: ItemId): id is KitIconId {
  return KIT_ICON_IDS.has(id);
}

const FULL_CIRCLE = Math.PI * 2;
const OUTLINE = '#3a2414';
const OUTLINE_WIDTH = 1;
const THIN_LINE_WIDTH = 1;
const HIGHLIGHT_LINE_HEIGHT = 2;

const CRATE_LEFT = 0.13;
const CRATE_TOP = 0.2;
const CRATE_WIDTH = 0.74;
const CRATE_HEIGHT = 0.62;
const CRATE_PLANK_COUNT = 3;
const CRATE_COLOR = '#a9793f';
const CRATE_DARK = '#7a5228';
const CRATE_LIGHT = 'rgba(255,255,255,0.2)';

/** A single tied band near the top of the crate, rather than a rope crossing the whole face and fighting the plate for attention. */
const BAND_TOP_FRACTION = 0.14;
const BAND_HEIGHT_FRACTION = 0.12;
const ROPE_COLOR = '#d8c088';
const ROPE_SHADE = '#a9895a';
const ROPE_KNOT_R = 0.045;

/** The branded plate the glyph sits on. */
const PLATE_TOP_FRACTION = 0.34;
const PLATE_HEIGHT_FRACTION = 0.56;
const PLATE_INSET_FRACTION = 0.1;
const PLATE_COLOR = '#e8d9b0';
const PLATE_SHADE = '#c7b384';
const GLYPH_COLOR = '#2a1a10';

function drawCrate(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const left = x + size * CRATE_LEFT;
  const top = y + size * CRATE_TOP;
  const width = size * CRATE_WIDTH;
  const height = size * CRATE_HEIGHT;

  ctx.fillStyle = CRATE_COLOR;
  ctx.fillRect(left, top, width, height);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.strokeRect(left, top, width, height);

  ctx.strokeStyle = CRATE_DARK;
  ctx.lineWidth = THIN_LINE_WIDTH;
  ctx.beginPath();
  for (let plank = 1; plank < CRATE_PLANK_COUNT; plank++) {
    const px = left + (width * plank) / CRATE_PLANK_COUNT;
    ctx.moveTo(px, top);
    ctx.lineTo(px, top + height);
  }
  ctx.stroke();
  ctx.fillStyle = CRATE_LIGHT;
  ctx.fillRect(left, top, width, HIGHLIGHT_LINE_HEIGHT);

  const bandTop = top + height * BAND_TOP_FRACTION;
  const bandHeight = height * BAND_HEIGHT_FRACTION;
  ctx.fillStyle = ROPE_COLOR;
  ctx.fillRect(left, bandTop, width, bandHeight);
  ctx.strokeStyle = ROPE_SHADE;
  ctx.lineWidth = THIN_LINE_WIDTH;
  ctx.strokeRect(left, bandTop, width, bandHeight);
  ctx.fillStyle = ROPE_SHADE;
  ctx.beginPath();
  ctx.arc(left + width / 2, bandTop + bandHeight / 2, size * ROPE_KNOT_R, 0, FULL_CIRCLE);
  ctx.fill();

  const plateLeft = left + width * PLATE_INSET_FRACTION;
  const plateTop = top + height * PLATE_TOP_FRACTION;
  const plateWidth = width * (1 - PLATE_INSET_FRACTION * 2);
  const plateHeight = height * PLATE_HEIGHT_FRACTION;
  ctx.fillStyle = PLATE_COLOR;
  ctx.fillRect(plateLeft, plateTop, plateWidth, plateHeight);
  ctx.strokeStyle = PLATE_SHADE;
  ctx.lineWidth = THIN_LINE_WIDTH;
  ctx.strokeRect(plateLeft, plateTop, plateWidth, plateHeight);
}

// Trebuchet glyph.
const TREBUCHET_LEG_SPREAD = 0.19;
const TREBUCHET_APEX_Y = 0.19;
/**
 * A solid triangle (the A-frame, seen as a silhouette) with a separate round
 * weight above one shoulder. Two distinct shapes with a gap between them read
 * far better at hotbar size than a frame and an arm sharing one outline — the
 * two merge into a single dark blob the moment they touch.
 */
const TREBUCHET_WEIGHT_R = 0.075;
const TREBUCHET_WEIGHT_OFFSET_X = 0.15;
const TREBUCHET_WEIGHT_OFFSET_Y = -0.19;

function drawTrebuchetGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
): void {
  const apex = { x: cx, y: cy - s * TREBUCHET_APEX_Y };

  ctx.fillStyle = GLYPH_COLOR;
  ctx.beginPath();
  ctx.moveTo(cx - s * TREBUCHET_LEG_SPREAD, cy + s * TREBUCHET_LEG_SPREAD);
  ctx.lineTo(apex.x, apex.y);
  ctx.lineTo(cx + s * TREBUCHET_LEG_SPREAD, cy + s * TREBUCHET_LEG_SPREAD);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(
    cx + s * TREBUCHET_WEIGHT_OFFSET_X,
    cy + s * TREBUCHET_WEIGHT_OFFSET_Y,
    s * TREBUCHET_WEIGHT_R,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();
}

// Snare glyph: a bold ring — a filled annulus, not a thin stroked loop, so it holds up at hotbar size.
const SNARE_RING_OUTER_R = 0.18;
const SNARE_RING_INNER_R = 0.1;
const SNARE_PEG_HALF_WIDTH = 0.03;
const SNARE_PEG_TOP_Y = 0.14;
const SNARE_PEG_BOTTOM_Y = 0.26;

function drawSnareGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.fillStyle = GLYPH_COLOR;
  ctx.beginPath();
  ctx.arc(cx, cy, s * SNARE_RING_OUTER_R, 0, FULL_CIRCLE);
  ctx.arc(cx, cy, s * SNARE_RING_INNER_R, 0, FULL_CIRCLE, true);
  ctx.fill('evenodd');

  ctx.fillStyle = GLYPH_COLOR;
  ctx.fillRect(
    cx - s * SNARE_PEG_HALF_WIDTH,
    cy + s * SNARE_PEG_TOP_Y,
    s * SNARE_PEG_HALF_WIDTH * 2,
    s * (SNARE_PEG_BOTTOM_Y - SNARE_PEG_TOP_Y),
  );
}

/** Draws one kit's icon into a square icon region at `x`,`y`. */
export function drawKitIcon(
  ctx: CanvasRenderingContext2D,
  id: KitIconId,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();

  drawCrate(ctx, x, y, size);
  const plateTop = y + size * (CRATE_TOP + CRATE_HEIGHT * PLATE_TOP_FRACTION);
  const plateHeight = size * CRATE_HEIGHT * PLATE_HEIGHT_FRACTION;
  const glyphCx = x + size * (CRATE_LEFT + CRATE_WIDTH / 2);
  const glyphCy = plateTop + plateHeight / 2;
  if (id === 'trebuchet_kit') drawTrebuchetGlyph(ctx, glyphCx, glyphCy, size);
  else drawSnareGlyph(ctx, glyphCx, glyphCy, size);

  ctx.restore();
}
