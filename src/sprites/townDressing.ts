/**
 * Building-line dressing: the awning post, the skyfowl perch and the pasture's
 * field shelter. Each reaches well above its own tile — a valance, a perch bar,
 * a lean-to roof — so unlike `townClutter.ts`'s single shared envelope, every
 * one of these gets its own frame in `townscapeSheets.ts`.
 *
 * Painted through the town's own material vocabulary
 * (`src/sprites/art/town/`) rather than flat fills, so a post standing at a
 * building line reads as the same ash-oak timber and iron the facade above it
 * is built from.
 */

import { mulberry32 } from './person/rng';
import { inkOutline, rgb, rgba, type Ctx } from './art/town/townArt';
import { getTownRamp, TOWN_INK } from './art/town/townPalette';
import {
  paintBeam,
  paintClothAwning,
  paintIronStrap,
  paintPlankBoard,
} from './art/town/townMaterials';

/**
 * These fixtures carry no floor seed — a post's grain is fixed dressing, not a
 * place a player looks for variety — so one constant seed paints the same
 * picture every time, the way `drawFortuneTeller`'s fixed geometry does.
 */
const DRESSING_SEED = 0x7a17_2c11;

const TIMBER = getTownRamp('oc_timber');
const IRON = getTownRamp('iron_black');
const CLOTH_SKY = getTownRamp('oc_cloth_sky');
const CLOTH_EMBER = getTownRamp('oc_cloth_ember');

const CONTACT_SHADOW_ALPHA = 0.3;
const CONTACT_SHADOW_FILL_ALPHA = 1;
const CONTACT_SHADOW_RX_FRACTION = 0.32;
const CONTACT_SHADOW_RY_FRACTION = 0.09;

function drawContactShadow(ctx: Ctx, sx: number, sy: number, ts: number): void {
  const cx = sx + ts * 0.5;
  const cy = sy + ts * 0.94;
  ctx.fillStyle = rgba(TOWN_INK, CONTACT_SHADOW_FILL_ALPHA);
  ctx.save();
  ctx.globalAlpha = CONTACT_SHADOW_ALPHA;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy,
    ts * CONTACT_SHADOW_RX_FRACTION,
    ts * CONTACT_SHADOW_RY_FRACTION,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}

// ── Awning post ─────────────────────────────────────────────────────────────
//
// A single timber post against a building line, carrying a short valance of
// striped awning cloth — the market's canvas read as something a shopkeeper
// nailed to their own wall, not just the stall carts out in the plaza.

/** How far above its own anchor tile the valance's top rides. */
export const AWNING_POST_UP_TILES = 1.3;
const POST_WIDTH_FRACTION = 0.12;
const POST_TOP_FRACTION = -0.8;
const POST_BOTTOM_FRACTION = 0.92;
const VALANCE_WIDTH_FRACTION = 0.72;
const VALANCE_HEIGHT_FRACTION = 0.42;
const VALANCE_TOP_FRACTION = -1.18;
/** The brace runs from the post, a third of the way down the valance, out to its lower corner. */
const BRACE_DROP_FRACTION = 0.34;
const BRACE_WIDTH_PX = 2;

export function drawAwningPost(ctx: Ctx, sx: number, sy: number, ts: number): void {
  const rng = mulberry32(DRESSING_SEED);
  drawContactShadow(ctx, sx, sy, ts);

  const postW = ts * POST_WIDTH_FRACTION;
  const postX = sx + ts * 0.5 - postW / 2;
  const postTop = sy + ts * POST_TOP_FRACTION;
  const postBottom = sy + ts * POST_BOTTOM_FRACTION;
  paintBeam(ctx, postX, postTop, postW, postBottom - postTop, TIMBER, rng);
  ctx.beginPath();
  ctx.rect(postX, postTop, postW, postBottom - postTop);
  inkOutline(ctx, ts);

  const valanceW = ts * VALANCE_WIDTH_FRACTION;
  const valanceX = sx + ts * 0.5 - valanceW / 2;
  const valanceY = sy + ts * VALANCE_TOP_FRACTION;
  const valanceH = ts * VALANCE_HEIGHT_FRACTION;

  // A wooden brace either side, meeting the post above its own top and the
  // valance's lower corners — without it the canopy reads as floating rather
  // than built onto the post beneath it.
  ctx.strokeStyle = rgb(TIMBER.shadow);
  ctx.lineWidth = BRACE_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(sx + ts * 0.5, postTop);
  ctx.lineTo(valanceX, valanceY + valanceH * BRACE_DROP_FRACTION);
  ctx.moveTo(sx + ts * 0.5, postTop);
  ctx.lineTo(valanceX + valanceW, valanceY + valanceH * BRACE_DROP_FRACTION);
  ctx.stroke();

  paintClothAwning(ctx, valanceX, valanceY, valanceW, valanceH, CLOTH_SKY, CLOTH_EMBER);
  ctx.beginPath();
  ctx.rect(valanceX, valanceY, valanceW, valanceH);
  inkOutline(ctx, ts);
}

// ── Skyfowl perch ────────────────────────────────────────────────────────────
//
// A rail on two posts, roughly roof-shoulder height — furniture a bird
// chooses to use, not a nest and not baked into any facade.

export const SKYFOWL_PERCH_UP_TILES = 1.6;
const PERCH_POST_WIDTH_FRACTION = 0.1;
const PERCH_POST_INSET_FRACTION = 0.2;
const PERCH_POST_TOP_FRACTION = -1.3;
const PERCH_POST_BOTTOM_FRACTION = 0.92;
const PERCH_BAR_TOP_FRACTION = -1.4;
const PERCH_BAR_HEIGHT_FRACTION = 0.13;
const PERCH_BAR_OVERHANG_FRACTION = 0.14;
const PERCH_CAP_LENGTH_FRACTION = 0.2;
/** The corbel drops from the bar's underside to a point on the post below it. */
const PERCH_CORBEL_DROP_FRACTION = 0.28;
const PERCH_CORBEL_WIDTH_PX = 2;

export function drawSkyfowlPerch(ctx: Ctx, sx: number, sy: number, ts: number): void {
  const rng = mulberry32(DRESSING_SEED + 1);
  drawContactShadow(ctx, sx, sy, ts);

  const postW = ts * PERCH_POST_WIDTH_FRACTION;
  const leftX = sx + ts * PERCH_POST_INSET_FRACTION - postW / 2;
  const rightX = sx + ts * (1 - PERCH_POST_INSET_FRACTION) - postW / 2;
  const postTop = sy + ts * PERCH_POST_TOP_FRACTION;
  const postBottom = sy + ts * PERCH_POST_BOTTOM_FRACTION;
  for (const postX of [leftX, rightX]) {
    paintBeam(ctx, postX, postTop, postW, postBottom - postTop, TIMBER, rng);
    ctx.beginPath();
    ctx.rect(postX, postTop, postW, postBottom - postTop);
    inkOutline(ctx, ts);
  }

  const barX = sx + ts * (PERCH_POST_INSET_FRACTION - PERCH_BAR_OVERHANG_FRACTION);
  const barW = ts * (1 - 2 * PERCH_POST_INSET_FRACTION + 2 * PERCH_BAR_OVERHANG_FRACTION);
  const barY = sy + ts * PERCH_BAR_TOP_FRACTION;
  const barH = ts * PERCH_BAR_HEIGHT_FRACTION;

  // A short bracket under each post, so the rail reads as jointed onto the
  // posts rather than resting loose across their tops — angled inward from
  // the bar to the post a little below it, like a shelf bracket, never
  // meeting in the middle where the two would read as a roof ridge.
  ctx.strokeStyle = rgb(TIMBER.shadow);
  ctx.lineWidth = PERCH_CORBEL_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(leftX + postW, barY + barH);
  ctx.lineTo(leftX + postW / 2, barY + barH + ts * PERCH_CORBEL_DROP_FRACTION);
  ctx.moveTo(rightX, barY + barH);
  ctx.lineTo(rightX + postW / 2, barY + barH + ts * PERCH_CORBEL_DROP_FRACTION);
  ctx.stroke();

  paintBeam(ctx, barX, barY, barW, barH, IRON, rng);
  ctx.beginPath();
  ctx.rect(barX, barY, barW, barH);
  inkOutline(ctx, ts);

  // Iron cap straps at each end, so the rail reads as fastened rather than
  // balanced — the one iron touch, kept rare per the town's own hardware rule.
  const capLen = ts * PERCH_CAP_LENGTH_FRACTION;
  paintIronStrap(ctx, barX, barY + barH / 2, capLen, 0, IRON);
  paintIronStrap(ctx, barX + barW, barY + barH / 2, capLen, Math.PI, IRON);
}

// ── Field shelter ─────────────────────────────────────────────────────────────
//
// A small three-post lean-to for Wendell's pasture: a back wall of boards, a
// single-pitch roof, and open air beneath it — sized for a cow that is not
// there yet, and left with the ground in front of it clear.

export const FIELD_SHELTER_UP_TILES = 1.8;
export const FIELD_SHELTER_SIDE_TILES = 0.5;
const SHELTER_POST_WIDTH_FRACTION = 0.09;
const SHELTER_LEFT_POST_X_FRACTION = -0.28;
const SHELTER_RIGHT_POST_X_FRACTION = 1.2;
const SHELTER_BACK_POST_X_FRACTION = 0.46;
const SHELTER_LOW_EAVE_TOP_FRACTION = -0.9;
const SHELTER_HIGH_EAVE_TOP_FRACTION = -1.55;
const SHELTER_POST_BOTTOM_FRACTION = 0.94;
const SHELTER_BACK_WALL_TOP_FRACTION = -0.85;
const SHELTER_BACK_WALL_WIDTH_FRACTION = 1.5;
const SHELTER_BACK_WALL_HEIGHT_FRACTION = 0.8;
const SHELTER_ROOF_THICKNESS_FRACTION = 0.22;
const SHELTER_ROOF_OVERHANG_FRACTION = 0.14;
const SHELTER_PLANK_BOARD_PX_FRACTION = 0.16;

export function drawFieldShelter(ctx: Ctx, sx: number, sy: number, ts: number): void {
  const rng = mulberry32(DRESSING_SEED + 2);
  drawContactShadow(ctx, sx, sy, ts);

  const postW = ts * SHELTER_POST_WIDTH_FRACTION;
  const postBottom = sy + ts * SHELTER_POST_BOTTOM_FRACTION;
  const leftX = sx + ts * SHELTER_LEFT_POST_X_FRACTION;
  const rightX = sx + ts * SHELTER_RIGHT_POST_X_FRACTION - postW;
  const backX = sx + ts * SHELTER_BACK_POST_X_FRACTION;

  // Back wall of boards, behind the posts, reading as the shelter's closed side.
  const wallX = sx + ts * (0.5 - SHELTER_BACK_WALL_WIDTH_FRACTION / 2);
  const wallY = sy + ts * SHELTER_BACK_WALL_TOP_FRACTION;
  const wallW = ts * SHELTER_BACK_WALL_WIDTH_FRACTION;
  const wallH = ts * SHELTER_BACK_WALL_HEIGHT_FRACTION;
  paintPlankBoard(ctx, wallX, wallY, wallW, wallH, rng, {
    direction: 'vertical',
    boardPx: ts * SHELTER_PLANK_BOARD_PX_FRACTION,
    ramp: TIMBER,
  });
  ctx.beginPath();
  ctx.rect(wallX, wallY, wallW, wallH);
  inkOutline(ctx, ts);

  const leftTop = sy + ts * SHELTER_LOW_EAVE_TOP_FRACTION;
  const rightTop = sy + ts * SHELTER_HIGH_EAVE_TOP_FRACTION;
  const backTop = sy + ts * SHELTER_HIGH_EAVE_TOP_FRACTION;
  for (const [postX, postTop] of [
    [leftX, leftTop],
    [rightX, rightTop],
    [backX, backTop],
  ] as const) {
    paintBeam(ctx, postX, postTop, postW, postBottom - postTop, TIMBER, rng);
    ctx.beginPath();
    ctx.rect(postX, postTop, postW, postBottom - postTop);
    inkOutline(ctx, ts);
  }

  // A single-pitch roof plane, low over the front post and high over the back —
  // a lean-to, not a gable, so it reads as something built onto the yard fence
  // rather than a whole second building.
  const roofLeftX = leftX - ts * SHELTER_ROOF_OVERHANG_FRACTION;
  const roofRightX = rightX + postW + ts * SHELTER_ROOF_OVERHANG_FRACTION;
  const roofThickness = ts * SHELTER_ROOF_THICKNESS_FRACTION;
  ctx.fillStyle = rgb(TIMBER.shadow);
  ctx.beginPath();
  ctx.moveTo(roofLeftX, leftTop);
  ctx.lineTo(roofRightX, rightTop);
  ctx.lineTo(roofRightX, rightTop + roofThickness);
  ctx.lineTo(roofLeftX, leftTop + roofThickness);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba(TIMBER.light, 0.4);
  ctx.beginPath();
  ctx.moveTo(roofLeftX, leftTop);
  ctx.lineTo(roofRightX, rightTop);
  ctx.lineTo(roofRightX, rightTop + roofThickness * 0.35);
  ctx.lineTo(roofLeftX, leftTop + roofThickness * 0.35);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(roofLeftX, leftTop);
  ctx.lineTo(roofRightX, rightTop);
  ctx.lineTo(roofRightX, rightTop + roofThickness);
  ctx.lineTo(roofLeftX, leftTop + roofThickness);
  ctx.closePath();
  inkOutline(ctx, ts);
}
