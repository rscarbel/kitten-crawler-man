/**
 * Building-line dressing: the awning post, the skyfowl perch, and the milking
 * shed and cart gate of Wendell's pasture. Each reaches well past its own tile —
 * a valance, a perch bar, a roof, a pair of gate leaves — so unlike `townClutter.ts`'s single shared envelope, every
 * one of these gets its own frame in `townscapeSheets.ts`.
 *
 * Painted through the town's own material vocabulary
 * (`src/sprites/art/town/`) rather than flat fills, so a post standing at a
 * building line reads as the same ash-oak timber and iron the facade above it
 * is built from.
 */

import { mulberry32 } from './person/rng';
import { inkOutline, rgb, rgba, type Ctx } from './art/town/townArt';
import { getTownRamp, TOWN_INK, type RGB } from './art/town/townPalette';
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

// ── Milking shed ─────────────────────────────────────────────────────────────
//
// Wendell's milking shed: two open stalls under a pent roof, built square and
// finished like a house — a hay manger in each, fresh straw down, a stool and a
// pail waiting in the first, and a blank name board over each stall for a cow
// that has not come. Two stalls, not one: the pasture was prepared for a herd.
//
// Its footprint is its two front tiles, and both are blocked: the roof climbs
// back over the fence behind it, which nobody can stand on, so no walkable tile
// sits under art that is not its own.

/** The shed covers two tiles east–west, anchored on the western one. */
export const MILKING_SHED_WIDTH_TILES = 2;
/** The roof's back edge rides this far above the anchor tile's top. */
export const MILKING_SHED_UP_TILES = 1.2;
/** The roof overhangs the posts by a sliver either side. */
export const MILKING_SHED_SIDE_TILES = 0.25;

const SHED_BASE_FRACTION = 0.94;
const SHED_EAVE_FRACTION = -0.3;
const SHED_ROOF_BACK_FRACTION = -1.0;
const SHED_ROOF_OVERHANG_FRACTION = 0.1;
const SHED_FASCIA_HEIGHT_FRACTION = 0.1;
const SHED_POST_WIDTH_FRACTION = 0.13;
const SHED_POST_INSET_FRACTION = 0.03;
const SHED_LINTEL_HEIGHT_FRACTION = 0.12;
const SHED_ROOF_BOARD_PX_FRACTION = 0.2;
const SHED_BACK_BOARD_PX_FRACTION = 0.16;
/** The inside of an open-fronted shed is a stop and a half darker than its boards in daylight. */
const SHED_INTERIOR_SHADE_ALPHA = 0.55;
/** The roof's own top face catches the sky; the boards' ramp alone reads as wall. */
const SHED_ROOF_SKY_ALPHA = 0.18;
const SHED_ROOF_EDGE_LIGHT_ALPHA = 0.55;
const SHED_ROOF_EDGE_LIGHT_FRACTION = 0.04;
/** The manger's slatted front, across the back of each stall. */
const MANGER_TOP_FRACTION = -0.1;
const MANGER_HEIGHT_FRACTION = 0.3;
const MANGER_SLAT_SPACING_FRACTION = 0.1;
const MANGER_SLAT_WIDTH_PX = 1;
const MANGER_RAIL_HEIGHT_FRACTION = 0.05;
/** The straw bed along each stall's floor. */
const STRAW_TOP_FRACTION = 0.74;
const STRAW_STALK_COUNT = 26;
const STRAW_STALK_LENGTH_FRACTION = 0.1;
const STRAW_STALK_WIDTH_PX = 1;
/** The blank name board over each stall. */
const NAME_BOARD_WIDTH_FRACTION = 0.36;
const NAME_BOARD_HEIGHT_FRACTION = 0.1;
const NAME_BOARD_DROP_FRACTION = 0.02;
const NAIL_RADIUS_FRACTION = 0.018;
const NAIL_INSET_FRACTION = 0.12;
/** The pail and stool waiting in the western stall. */
const PAIL_CENTRE_FRACTION = 0.66;
const PAIL_TOP_WIDTH_FRACTION = 0.2;
const PAIL_BOTTOM_WIDTH_FRACTION = 0.16;
const PAIL_HEIGHT_FRACTION = 0.18;
const PAIL_HOOP_WIDTH_PX = 1;
const STOOL_CENTRE_FRACTION = 0.33;
const STOOL_SEAT_WIDTH_FRACTION = 0.22;
const STOOL_SEAT_HEIGHT_FRACTION = 0.05;
const STOOL_SEAT_TOP_FRACTION = 0.7;
const STOOL_LEG_WIDTH_PX = 2;
const STOOL_LEG_SPLAY_FRACTION = 0.13;
const SHED_SHADOW_ALPHA = 0.32;
const SHED_SHADOW_RY_FRACTION = 0.12;

/** Pale straw and scoured tin: the two things in the shed that are new. */
const STRAW: RGB = [206, 176, 104];
const STRAW_DARK: RGB = [150, 118, 60];
const STRAW_LIGHT: RGB = [236, 212, 150];
const TIN: RGB = [176, 184, 190];
const TIN_DARK: RGB = [110, 118, 126];

function paintStrawBed(
  ctx: Ctx,
  x: number,
  w: number,
  top: number,
  bottom: number,
  rng: () => number,
  ts: number,
): void {
  ctx.fillStyle = rgb(STRAW_DARK);
  ctx.fillRect(x, top, w, bottom - top);
  ctx.lineWidth = STRAW_STALK_WIDTH_PX;
  const stalk = ts * STRAW_STALK_LENGTH_FRACTION;
  for (let index = 0; index < STRAW_STALK_COUNT; index++) {
    const sx = x + rng() * w;
    const sy = top + rng() * (bottom - top);
    const slant = (rng() - 0.5) * stalk;
    ctx.strokeStyle = rgb(rng() < 0.5 ? STRAW : STRAW_LIGHT);
    ctx.beginPath();
    ctx.moveTo(sx - slant / 2, sy);
    ctx.lineTo(sx + slant / 2, sy - stalk / 2);
    ctx.stroke();
  }
}

function paintManger(ctx: Ctx, x: number, w: number, ts: number, rng: () => number): void {
  const top = ts * MANGER_TOP_FRACTION;
  const h = ts * MANGER_HEIGHT_FRACTION;
  paintStrawBed(ctx, x, w, top, top + h, rng, ts);
  ctx.strokeStyle = rgb(TIMBER.mid);
  ctx.lineWidth = MANGER_SLAT_WIDTH_PX;
  const spacing = ts * MANGER_SLAT_SPACING_FRACTION;
  for (let slatX = x + spacing / 2; slatX < x + w; slatX += spacing) {
    ctx.beginPath();
    ctx.moveTo(slatX, top);
    ctx.lineTo(slatX, top + h);
    ctx.stroke();
  }
  const railH = ts * MANGER_RAIL_HEIGHT_FRACTION;
  ctx.fillStyle = rgb(TIMBER.light);
  ctx.fillRect(x, top, w, railH);
  ctx.fillStyle = rgb(TIMBER.mid);
  ctx.fillRect(x, top + h - railH, w, railH);
}

function paintPail(ctx: Ctx, cx: number, bottom: number, ts: number): void {
  const topW = ts * PAIL_TOP_WIDTH_FRACTION;
  const bottomW = ts * PAIL_BOTTOM_WIDTH_FRACTION;
  const h = ts * PAIL_HEIGHT_FRACTION;
  ctx.fillStyle = rgb(TIN);
  ctx.beginPath();
  ctx.moveTo(cx - topW / 2, bottom - h);
  ctx.lineTo(cx + topW / 2, bottom - h);
  ctx.lineTo(cx + bottomW / 2, bottom);
  ctx.lineTo(cx - bottomW / 2, bottom);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.strokeStyle = rgb(TIN_DARK);
  ctx.lineWidth = PAIL_HOOP_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(cx - topW / 2, bottom - h * 0.35);
  ctx.lineTo(cx + topW / 2, bottom - h * 0.35);
  ctx.stroke();
}

function paintStool(ctx: Ctx, cx: number, ts: number): void {
  const seatW = ts * STOOL_SEAT_WIDTH_FRACTION;
  const seatTop = ts * STOOL_SEAT_TOP_FRACTION;
  const seatH = ts * STOOL_SEAT_HEIGHT_FRACTION;
  const splay = ts * STOOL_LEG_SPLAY_FRACTION;
  const floor = ts * SHED_BASE_FRACTION;
  ctx.strokeStyle = rgb(TIMBER.shadow);
  ctx.lineWidth = STOOL_LEG_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(cx - seatW / 3, seatTop + seatH);
  ctx.lineTo(cx - splay, floor);
  ctx.moveTo(cx + seatW / 3, seatTop + seatH);
  ctx.lineTo(cx + splay, floor);
  ctx.stroke();
  ctx.fillStyle = rgb(TIMBER.light);
  ctx.fillRect(cx - seatW / 2, seatTop, seatW, seatH);
  ctx.beginPath();
  ctx.rect(cx - seatW / 2, seatTop, seatW, seatH);
  inkOutline(ctx, ts);
}

function paintNameBoard(ctx: Ctx, cx: number, lintelTop: number, ts: number): void {
  const w = ts * NAME_BOARD_WIDTH_FRACTION;
  const h = ts * NAME_BOARD_HEIGHT_FRACTION;
  const y = lintelTop + ts * NAME_BOARD_DROP_FRACTION;
  ctx.fillStyle = rgb(TIMBER.accent);
  ctx.fillRect(cx - w / 2, y, w, h);
  ctx.beginPath();
  ctx.rect(cx - w / 2, y, w, h);
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(IRON.mid);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(
      cx + side * (w / 2 - w * NAIL_INSET_FRACTION),
      y + h / 2,
      ts * NAIL_RADIUS_FRACTION,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

/**
 * Paints the milking shed with its anchor (western front tile) at `(sx, sy)`.
 * Everything is drawn in the anchor's own local frame, translated once.
 */
export function drawMilkingShed(ctx: Ctx, sx: number, sy: number, ts: number): void {
  const rng = mulberry32(DRESSING_SEED + 2);
  const width = ts * MILKING_SHED_WIDTH_TILES;
  const base = ts * SHED_BASE_FRACTION;
  const eave = ts * SHED_EAVE_FRACTION;
  const postW = ts * SHED_POST_WIDTH_FRACTION;
  const inset = ts * SHED_POST_INSET_FRACTION;
  const postXs = [inset, width / 2 - postW / 2, width - inset - postW];

  ctx.save();
  ctx.translate(sx, sy);

  ctx.fillStyle = rgba(TOWN_INK, SHED_SHADOW_ALPHA);
  ctx.beginPath();
  ctx.ellipse(width / 2, base, width * 0.52, ts * SHED_SHADOW_RY_FRACTION, 0, 0, Math.PI * 2);
  ctx.fill();

  // The back wall, seen through the open stalls and pushed into the shed's shade.
  paintPlankBoard(ctx, inset, eave, width - inset * 2, base - eave, rng, {
    direction: 'vertical',
    boardPx: ts * SHED_BACK_BOARD_PX_FRACTION,
    ramp: TIMBER,
  });
  ctx.fillStyle = rgba(TOWN_INK, SHED_INTERIOR_SHADE_ALPHA);
  ctx.fillRect(inset, eave, width - inset * 2, base - eave);

  const stallW = width / 2 - inset - postW / 2;
  const stallXs = [inset + postW, width / 2 + postW / 2];
  for (const stallX of stallXs) {
    paintManger(ctx, stallX, stallW - postW / 2, ts, rng);
    paintStrawBed(ctx, stallX, stallW - postW / 2, ts * STRAW_TOP_FRACTION, base, rng, ts);
  }
  paintStool(ctx, ts * STOOL_CENTRE_FRACTION, ts);
  paintPail(ctx, ts * PAIL_CENTRE_FRACTION, base, ts);

  for (const postX of postXs) {
    paintBeam(ctx, postX, eave, postW, base - eave, TIMBER, rng);
    ctx.beginPath();
    ctx.rect(postX, eave, postW, base - eave);
    inkOutline(ctx, ts);
  }

  const lintelH = ts * SHED_LINTEL_HEIGHT_FRACTION;
  ctx.fillStyle = rgb(TIMBER.mid);
  ctx.fillRect(0, eave, width, lintelH);
  ctx.fillStyle = rgb(TIMBER.light);
  ctx.fillRect(0, eave, width, Math.max(1, lintelH * 0.25));
  ctx.beginPath();
  ctx.rect(0, eave, width, lintelH);
  inkOutline(ctx, ts);
  for (const stallX of stallXs)
    paintNameBoard(ctx, stallX + (stallW - postW / 2) / 2, eave + lintelH, ts);

  // A pent roof, high at the fence and falling to the stalls: seen from the
  // lane it is a plane of boards running down the slope, capped by a fascia.
  const overhang = ts * SHED_ROOF_OVERHANG_FRACTION;
  const roofTop = ts * SHED_ROOF_BACK_FRACTION;
  const fasciaH = ts * SHED_FASCIA_HEIGHT_FRACTION;
  const roofX = -overhang;
  const roofW = width + overhang * 2;
  const roofBottom = eave;
  paintPlankBoard(ctx, roofX, roofTop, roofW, roofBottom - roofTop - fasciaH, rng, {
    direction: 'vertical',
    boardPx: ts * SHED_ROOF_BOARD_PX_FRACTION,
    ramp: TIMBER,
  });
  ctx.fillStyle = rgba(TIMBER.accent, SHED_ROOF_SKY_ALPHA);
  ctx.fillRect(roofX, roofTop, roofW, roofBottom - roofTop - fasciaH);
  ctx.fillStyle = rgba(TIMBER.accent, SHED_ROOF_EDGE_LIGHT_ALPHA);
  ctx.fillRect(roofX, roofTop, roofW, ts * SHED_ROOF_EDGE_LIGHT_FRACTION);
  ctx.fillStyle = rgb(TIMBER.shadow);
  ctx.fillRect(roofX, roofBottom - fasciaH, roofW, fasciaH);
  ctx.beginPath();
  ctx.rect(roofX, roofTop, roofW, roofBottom - roofTop);
  inkOutline(ctx, ts);

  ctx.restore();
}

// ── Pasture gate ─────────────────────────────────────────────────────────────
//
// The cart gate into Wendell's pasture, built far better than the fence it
// hangs in: two squared gateposts a head taller than the rails, capped and
// finialled, and a pair of framed, braced leaves on strap hinges swung wide
// open along the fence, so the opening between the posts stays clear. It
// blocks nothing — the posts stand on fence tiles that are already solid, and
// the open-framed leaves stand over them with the rails showing through.
//
// Anchored on the gate's western tile; the gate is two tiles wide.

/** The posts stand on the centres of the fence tiles either side of the two-tile gap. */
const GATE_OPENING_TILES = 2;
const GATEPOST_CENTRE_OUTSET_FRACTION = 0.5;
/** How far the art reaches west of the anchor tile and east past the gate's east tile. */
export const PASTURE_GATE_WEST_TILES = 2.25;
export const PASTURE_GATE_EAST_TILES = 2.25;
export const PASTURE_GATE_UP_TILES = 1;
export const PASTURE_GATE_WIDTH_TILES = GATE_OPENING_TILES;

const GATEPOST_WIDTH_FRACTION = 0.3;
const GATEPOST_TOP_FRACTION = -0.6;
const GATEPOST_BOTTOM_FRACTION = 0.94;
const GATEPOST_CAP_WIDTH_FRACTION = 0.42;
const GATEPOST_CAP_HEIGHT_FRACTION = 0.1;
const GATEPOST_CAP_PEAK_FRACTION = 0.1;
const GATEPOST_FINIAL_RADIUS_FRACTION = 0.07;
const GATEPOST_CHAMFER_ALPHA = 0.35;
const GATEPOST_CHAMFER_WIDTH_FRACTION = 0.06;
const GATE_LEAF_TOP_FRACTION = 0.34;
const GATE_LEAF_BOTTOM_FRACTION = 0.92;
/** A leaf is a hair shorter than half the opening, so it clears the other post when shut. */
const GATE_LEAF_LENGTH_SHARE = 0.92;
/**
 * How far a leaf's free end rides above its hinge end, in tiles: the leaf
 * stands swung open at an angle rather than pressed flat, which is what lets
 * its brace read as a diagonal and the fence show through behind it.
 */
const GATE_LEAF_SWING_RISE_FRACTION = 0.22;
const GATE_LEAF_STILE_FRACTION = 0.09;
const GATE_LEAF_RAIL_FRACTION = 0.08;
const GATE_LEAF_PALING_FRACTION = 0.06;
const GATE_LEAF_PALINGS = 2;
const GATE_BRACE_WIDTH_FRACTION = 0.08;
const GATE_LEAF_LIT_EDGE_ALPHA = 0.7;
/** A strap hinge's length; `paintIronStrap` makes its width a share of this, so it also sets how heavy the iron reads. */
const GATE_HINGE_LENGTH_FRACTION = 0.34;
const GATE_HINGE_ROWS = [0.12, 0.86] as const;
const GATE_LATCH_RADIUS_FRACTION = 0.05;
const GATE_LATCH_WIDTH_PX = 1;

/** One member of a leaf's frame: a lit timber bar, a lit top edge and its own ink line. */
function paintLeafMember(ctx: Ctx, x: number, y: number, w: number, h: number, ts: number): void {
  ctx.fillStyle = rgb(TIMBER.light);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgba(TIMBER.accent, GATE_LEAF_LIT_EDGE_ALPHA);
  ctx.fillRect(x, y, w, Math.max(1, h * 0.3));
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  inkOutline(ctx, ts);
}

/**
 * One leaf standing swung open beside its post: an open frame of stiles and
 * rails, two palings and a brace, so the fence rails behind it still read
 * through the gaps. `hingeX` is its hinged end, `freeX` its latch end.
 */
function paintGateLeaf(ctx: Ctx, hingeX: number, freeX: number, ts: number): void {
  const outward = Math.sign(freeX - hingeX);
  const w = Math.abs(freeX - hingeX);
  const top = ts * GATE_LEAF_TOP_FRACTION;
  const h = ts * (GATE_LEAF_BOTTOM_FRACTION - GATE_LEAF_TOP_FRACTION);
  const stile = ts * GATE_LEAF_STILE_FRACTION;
  const rail = ts * GATE_LEAF_RAIL_FRACTION;
  const paling = ts * GATE_LEAF_PALING_FRACTION;
  const rise = ts * GATE_LEAF_SWING_RISE_FRACTION;

  ctx.save();
  // Local x runs from 0 at the hinge to `w` at the latch; the shear lifts the
  // latch end by `rise`, which is how a leaf turned away from the viewer foreshortens.
  ctx.translate(hingeX, 0);
  ctx.scale(outward, 1);
  ctx.transform(1, -rise / w, 0, 1, 0, 0);

  for (let index = 1; index <= GATE_LEAF_PALINGS; index++) {
    const px = (w * index) / (GATE_LEAF_PALINGS + 1) - paling / 2;
    paintLeafMember(ctx, px, top, paling, h, ts);
  }
  // The brace climbs from the bottom rail at the hinge to the top rail at the
  // latch: the one way round that holds a leaf off the sag.
  ctx.strokeStyle = rgb(TIMBER.mid);
  ctx.lineWidth = ts * GATE_BRACE_WIDTH_FRACTION;
  ctx.beginPath();
  ctx.moveTo(stile, top + h - rail);
  ctx.lineTo(w - stile, top + rail);
  ctx.stroke();
  paintLeafMember(ctx, 0, top, w, rail, ts);
  paintLeafMember(ctx, 0, top + h - rail, w, rail, ts);
  paintLeafMember(ctx, 0, top, stile, h, ts);
  paintLeafMember(ctx, w - stile, top, stile, h, ts);
  for (const row of GATE_HINGE_ROWS) {
    paintIronStrap(ctx, 0, top + h * row, ts * GATE_HINGE_LENGTH_FRACTION, 0, IRON);
  }
  ctx.strokeStyle = rgb(IRON.light);
  ctx.lineWidth = GATE_LATCH_WIDTH_PX;
  ctx.beginPath();
  ctx.arc(w - stile / 2, top + h / 2, ts * GATE_LATCH_RADIUS_FRACTION, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function paintGatepost(ctx: Ctx, cx: number, ts: number, rng: () => number): void {
  const w = ts * GATEPOST_WIDTH_FRACTION;
  const top = ts * GATEPOST_TOP_FRACTION;
  const bottom = ts * GATEPOST_BOTTOM_FRACTION;
  paintBeam(ctx, cx - w / 2, top, w, bottom - top, TIMBER, rng);
  // A stopped chamfer down the lit arris — a joiner's touch no fence post gets.
  ctx.fillStyle = rgba(TIMBER.accent, GATEPOST_CHAMFER_ALPHA);
  ctx.fillRect(cx - w / 2, top + w, ts * GATEPOST_CHAMFER_WIDTH_FRACTION, bottom - top - w * 2);
  ctx.beginPath();
  ctx.rect(cx - w / 2, top, w, bottom - top);
  inkOutline(ctx, ts);

  const capW = ts * GATEPOST_CAP_WIDTH_FRACTION;
  const capH = ts * GATEPOST_CAP_HEIGHT_FRACTION;
  const peak = ts * GATEPOST_CAP_PEAK_FRACTION;
  ctx.fillStyle = rgb(TIMBER.shadow);
  ctx.fillRect(cx - capW / 2, top - capH, capW, capH);
  ctx.beginPath();
  ctx.rect(cx - capW / 2, top - capH, capW, capH);
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(TIMBER.mid);
  ctx.beginPath();
  ctx.moveTo(cx - capW / 2, top - capH);
  ctx.lineTo(cx, top - capH - peak);
  ctx.lineTo(cx + capW / 2, top - capH);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts);
  const finialR = ts * GATEPOST_FINIAL_RADIUS_FRACTION;
  ctx.fillStyle = rgb(TIMBER.light);
  ctx.beginPath();
  ctx.arc(cx, top - capH - peak - finialR * 0.6, finialR, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
}

/** Paints the pasture's cart gate with its anchor (the opening's western tile) at `(sx, sy)`. */
export function drawPastureGate(ctx: Ctx, sx: number, sy: number, ts: number): void {
  const rng = mulberry32(DRESSING_SEED + 3);
  const westPost = -ts * GATEPOST_CENTRE_OUTSET_FRACTION;
  const eastPost = ts * (GATE_OPENING_TILES + GATEPOST_CENTRE_OUTSET_FRACTION);
  const halfPost = (ts * GATEPOST_WIDTH_FRACTION) / 2;
  const opening = eastPost - westPost - halfPost * 2;
  const leafEach = (opening / 2) * GATE_LEAF_LENGTH_SHARE;
  ctx.save();
  ctx.translate(sx, sy);
  paintGateLeaf(ctx, westPost - halfPost, westPost - halfPost - leafEach, ts);
  paintGateLeaf(ctx, eastPost + halfPost, eastPost + halfPost + leafEach, ts);
  paintGatepost(ctx, westPost, ts, rng);
  paintGatepost(ctx, eastPost, ts, rng);
  ctx.restore();
}
