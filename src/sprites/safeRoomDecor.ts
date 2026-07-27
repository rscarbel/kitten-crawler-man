/**
 * The furnishings of a Bopca station: what turns a cleared room into a mess hall.
 *
 * Everything here reads as *inhabited and provisioned* — food, light, storage,
 * rest — rather than as dungeon set dressing, and everything is drawn to the
 * game's oblique projection: a fixed viewpoint slightly south of and above the
 * tile, so a prop shows its top surface and its front face and never its back.
 * That is why the three wall-hung props only ever appear on a room's north row
 * (`safeRoomDecorLayout` enforces it) — hung anywhere else they would be seen
 * from behind.
 *
 * Light comes from up-left and shadow falls down-right, matching the direction
 * the generated ground is lit from (`LIGHT_DIR` in `scripts/tilegen/materials.ts`).
 *
 * Every offset is a fraction of the tile size, so a prop is correct at the 32 px
 * the game draws at and at the sizes the review harnesses use.
 */

import { drawDishSteam } from './safeRoomCounter';

// ── Palette ───────────────────────────────────────────────────────────────────
// Warm oiled oak and blackened iron against the station's cream tile, with the
// Bopca's own mossy green for anything the cooks made themselves. Sampled from
// `safeRoomCounter.ts` and `bopcaSprite.ts` so nothing here clashes with the
// counter run or the chef standing behind it.
const WOOD = '#6b452a';
const WOOD_DARK = '#4e3220';
const WOOD_LIGHT = '#87593a';
const IRON = '#3a372f';
const IRON_LIGHT = '#57534a';
const BRASS = '#b08d3f';
const BRASS_LIGHT = '#e0bf72';
const SLATE = '#2b2b28';
const SLATE_FRAME = '#5a3b24';
const CHALK = '#e6e2d2';
const CHALK_FAINT = 'rgba(230,226,210,0.55)';
const BOPCA_GREEN = '#546146';
const BOPCA_GREEN_LIGHT = '#6f7f5c';
const BOPCA_GREEN_DARK = '#3d4733';
const HERB_GREEN = '#5f7040';
const HERB_DRY = '#8a7a3e';
const CURED_MEAT = '#8e4f3c';
const SACK_LINEN = '#c6b78d';
const SACK_LINEN_SHADE = '#a3946d';
const COPPER = '#a9663a';
const COPPER_LIGHT = '#c98a55';
const EMBER = 'rgba(232,124,40,0.85)';
const FLAME_CORE = 'rgba(255,224,150,0.95)';
const RUG_WEAVE = '#8c4a3c';
const RUG_WEAVE_ALT = '#a35c46';
const RUG_FRINGE = '#d8c9a4';
const CONTACT_SHADOW = 'rgba(0,0,0,0.28)';
const SOFT_SHADOW = 'rgba(0,0,0,0.18)';

/** Every prop that stands on the floor casts the same ellipse at its base. */
const CONTACT_SHADOW_WIDTH_FRACTION = 0.7;
const CONTACT_SHADOW_HEIGHT_FRACTION = 0.11;
const CONTACT_SHADOW_BASE_FRACTION = 0.93;

function drawContactShadow(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  widthFraction = CONTACT_SHADOW_WIDTH_FRACTION,
): void {
  ctx.fillStyle = CONTACT_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    sx + ts / 2,
    sy + ts * CONTACT_SHADOW_BASE_FRACTION,
    (ts * widthFraction) / 2,
    (ts * CONTACT_SHADOW_HEIGHT_FRACTION) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

// ── Menu board ────────────────────────────────────────────────────────────────

const BOARD_TOP_FRACTION = 0.1;
const BOARD_BOTTOM_FRACTION = 0.72;
const BOARD_SIDE_INSET_FRACTION = 0.14;
const BOARD_FRAME_THICKNESS_FRACTION = 0.05;
const BOARD_CHALK_LINE_COUNT = 4;
const BOARD_CHALK_TOP_FRACTION = 0.2;
const BOARD_CHALK_LINE_GAP_FRACTION = 0.11;
const BOARD_CHALK_INSET_FRACTION = 0.24;
/** The heading line is drawn brighter and shorter than the day's entries under it. */
const BOARD_HEADING_WIDTH_FRACTION = 0.28;
const BOARD_LINE_HEIGHT = 1;
const BOARD_PEG_WIDTH_FRACTION = 0.04;
const BOARD_PEG_HEIGHT_FRACTION = 0.1;

/** A chalk slate listing the day's stew, hung on the north wall beside the counter. */
export function drawMenuBoardTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  const left = sx + ts * BOARD_SIDE_INSET_FRACTION;
  const right = sx + ts * (1 - BOARD_SIDE_INSET_FRACTION);
  const top = sy + ts * BOARD_TOP_FRACTION;
  const bottom = sy + ts * BOARD_BOTTOM_FRACTION;

  // The peg it hangs from, drawn first so the board's frame overlaps its foot.
  const pegWidth = Math.max(1, ts * BOARD_PEG_WIDTH_FRACTION);
  ctx.fillStyle = IRON;
  ctx.fillRect(sx + ts / 2 - pegWidth / 2, sy, pegWidth, ts * BOARD_PEG_HEIGHT_FRACTION);

  const frame = Math.max(1, ts * BOARD_FRAME_THICKNESS_FRACTION);
  ctx.fillStyle = SLATE_FRAME;
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.fillStyle = SLATE;
  ctx.fillRect(left + frame, top + frame, right - left - frame * 2, bottom - top - frame * 2);

  // Chalk. Ruled lines rather than glyphs: at 32 px a letterform is one pixel of
  // noise, and ruled lines are what a slate reads as from across a room anyway.
  for (let line = 0; line < BOARD_CHALK_LINE_COUNT; line++) {
    const lineY = top + ts * (BOARD_CHALK_TOP_FRACTION + line * BOARD_CHALK_LINE_GAP_FRACTION);
    const isHeading = line === 0;
    const inset = ts * BOARD_CHALK_INSET_FRACTION;
    const width = isHeading ? ts * BOARD_HEADING_WIDTH_FRACTION : right - left - inset;
    ctx.fillStyle = isHeading ? CHALK : CHALK_FAINT;
    ctx.fillRect(left + inset / 2, lineY, Math.max(1, width), BOARD_LINE_HEIGHT);
  }

  ctx.fillStyle = SOFT_SHADOW;
  ctx.fillRect(left, bottom, right - left, Math.max(1, frame));
}

// ── Herb rack ─────────────────────────────────────────────────────────────────

const RACK_RAIL_TOP_FRACTION = 0.16;
const RACK_RAIL_HEIGHT_FRACTION = 0.06;
const RACK_RAIL_INSET_FRACTION = 0.06;
const RACK_BUNDLE_COUNT = 5;
const RACK_BUNDLE_MIN_LENGTH_FRACTION = 0.22;
const RACK_BUNDLE_LENGTH_STEP_FRACTION = 0.08;
const RACK_BUNDLE_WIDTH_FRACTION = 0.08;
const RACK_TIE_HEIGHT_FRACTION = 0.03;
/** Alternating lengths, so the row hangs like drying stock rather than a comb. */
const RACK_LENGTH_PATTERN: ReadonlyArray<number> = [1, 2, 0, 2, 1];
const RACK_BUNDLE_COLORS: ReadonlyArray<string> = [HERB_GREEN, HERB_DRY, CURED_MEAT];

/** A drying rack of herb bundles and cured strips, hung on the north wall. */
export function drawHerbRackTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  const railTop = sy + ts * RACK_RAIL_TOP_FRACTION;
  const railLeft = sx + ts * RACK_RAIL_INSET_FRACTION;
  const railWidth = ts * (1 - RACK_RAIL_INSET_FRACTION * 2);

  const bundleWidth = ts * RACK_BUNDLE_WIDTH_FRACTION;
  const spacing = railWidth / RACK_BUNDLE_COUNT;
  for (let bundle = 0; bundle < RACK_BUNDLE_COUNT; bundle++) {
    const centreX = railLeft + spacing * (bundle + 0.5);
    const lengthStep = RACK_LENGTH_PATTERN[bundle % RACK_LENGTH_PATTERN.length];
    const length =
      ts * (RACK_BUNDLE_MIN_LENGTH_FRACTION + lengthStep * RACK_BUNDLE_LENGTH_STEP_FRACTION);
    ctx.fillStyle = RACK_BUNDLE_COLORS[bundle % RACK_BUNDLE_COLORS.length];
    ctx.beginPath();
    ctx.moveTo(centreX - bundleWidth / 2, railTop);
    ctx.lineTo(centreX + bundleWidth / 2, railTop);
    // Tapered to a point: a bundle of stems is wide where it is tied and thin
    // where the leaves run out.
    ctx.lineTo(centreX, railTop + length);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(
      centreX - bundleWidth / 2,
      railTop,
      bundleWidth,
      Math.max(1, ts * RACK_TIE_HEIGHT_FRACTION),
    );
  }

  ctx.fillStyle = WOOD;
  ctx.fillRect(
    railLeft,
    railTop - ts * RACK_RAIL_HEIGHT_FRACTION,
    railWidth,
    ts * RACK_RAIL_HEIGHT_FRACTION,
  );
  ctx.fillStyle = WOOD_LIGHT;
  ctx.fillRect(railLeft, railTop - ts * RACK_RAIL_HEIGHT_FRACTION, railWidth, 1);
}

// ── Banner ────────────────────────────────────────────────────────────────────

const BANNER_TOP_FRACTION = 0.06;
const BANNER_BOTTOM_FRACTION = 0.78;
const BANNER_SIDE_INSET_FRACTION = 0.28;
const BANNER_POLE_HEIGHT_FRACTION = 0.05;
const BANNER_POLE_OVERHANG_FRACTION = 0.06;
const BANNER_TAIL_NOTCH_FRACTION = 0.16;
const BANNER_STRIPE_INSET_FRACTION = 0.05;
const BANNER_STRIPE_TOP_FRACTION = 0.3;
const BANNER_STRIPE_HEIGHT_FRACTION = 0.09;
const BANNER_SHADE_WIDTH_FRACTION = 0.22;

/** A long dyed cloth pennant in Bopca green, hung on the north wall. */
export function drawBannerTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  const left = sx + ts * BANNER_SIDE_INSET_FRACTION;
  const right = sx + ts * (1 - BANNER_SIDE_INSET_FRACTION);
  const top = sy + ts * BANNER_TOP_FRACTION;
  const bottom = sy + ts * BANNER_BOTTOM_FRACTION;
  const notch = ts * BANNER_TAIL_NOTCH_FRACTION;

  ctx.fillStyle = BOPCA_GREEN;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, bottom - notch);
  // Swallow-tailed hem, which is what makes it read as a pennant rather than a
  // hanging rug at this size.
  ctx.lineTo(sx + ts / 2, bottom);
  ctx.lineTo(left, bottom - notch);
  ctx.closePath();
  ctx.fill();

  // Lit up-left, shadowed down-right, matching the ground.
  ctx.fillStyle = BOPCA_GREEN_DARK;
  ctx.fillRect(
    right - ts * BANNER_SHADE_WIDTH_FRACTION,
    top,
    ts * BANNER_SHADE_WIDTH_FRACTION,
    bottom - notch - top,
  );

  ctx.fillStyle = BOPCA_GREEN_LIGHT;
  ctx.fillRect(
    left + ts * BANNER_STRIPE_INSET_FRACTION,
    top + ts * BANNER_STRIPE_TOP_FRACTION,
    right - left - ts * BANNER_STRIPE_INSET_FRACTION * 2,
    ts * BANNER_STRIPE_HEIGHT_FRACTION,
  );

  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(
    left - ts * BANNER_POLE_OVERHANG_FRACTION,
    sy,
    right - left + ts * BANNER_POLE_OVERHANG_FRACTION * 2,
    ts * BANNER_POLE_HEIGHT_FRACTION,
  );
}

// ── Standing lantern ──────────────────────────────────────────────────────────

const LANTERN_POLE_WIDTH_FRACTION = 0.07;
const LANTERN_POLE_TOP_FRACTION = 0.34;
const LANTERN_POLE_BOTTOM_FRACTION = 0.9;
const LANTERN_BASE_WIDTH_FRACTION = 0.34;
const LANTERN_BASE_HEIGHT_FRACTION = 0.07;
const LANTERN_HOUSING_TOP_FRACTION = 0.1;
const LANTERN_HOUSING_HEIGHT_FRACTION = 0.24;
const LANTERN_HOUSING_WIDTH_FRACTION = 0.3;
const LANTERN_CAP_HEIGHT_FRACTION = 0.05;
const LANTERN_CAP_OVERHANG_FRACTION = 0.05;
const LANTERN_GLASS_INSET_FRACTION = 0.05;
const LANTERN_FLAME_WIDTH_FRACTION = 0.07;
const LANTERN_FLAME_HEIGHT_FRACTION = 0.1;

/**
 * A standing brass lantern on a pole — the room's light source.
 *
 * The pool of light it throws is *not* drawn here: it is a per-frame radial
 * gradient composited over the sprites by `SafeRoomSystem.renderObjects`, so the
 * player standing beside a lantern is lit by it rather than hidden under it.
 */
export function drawLanternTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  const centreX = sx + ts / 2;
  drawContactShadow(ctx, sx, sy, ts, LANTERN_BASE_WIDTH_FRACTION);

  const baseWidth = ts * LANTERN_BASE_WIDTH_FRACTION;
  ctx.fillStyle = IRON;
  ctx.fillRect(
    centreX - baseWidth / 2,
    sy + ts * (LANTERN_POLE_BOTTOM_FRACTION - LANTERN_BASE_HEIGHT_FRACTION),
    baseWidth,
    ts * LANTERN_BASE_HEIGHT_FRACTION,
  );

  const poleWidth = Math.max(1, ts * LANTERN_POLE_WIDTH_FRACTION);
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(
    centreX - poleWidth / 2,
    sy + ts * LANTERN_POLE_TOP_FRACTION,
    poleWidth,
    ts * (LANTERN_POLE_BOTTOM_FRACTION - LANTERN_POLE_TOP_FRACTION),
  );

  const housingWidth = ts * LANTERN_HOUSING_WIDTH_FRACTION;
  const housingTop = sy + ts * LANTERN_HOUSING_TOP_FRACTION;
  const housingHeight = ts * LANTERN_HOUSING_HEIGHT_FRACTION;
  ctx.fillStyle = BRASS;
  ctx.fillRect(centreX - housingWidth / 2, housingTop, housingWidth, housingHeight);

  const glassInset = ts * LANTERN_GLASS_INSET_FRACTION;
  ctx.fillStyle = EMBER;
  ctx.fillRect(
    centreX - housingWidth / 2 + glassInset,
    housingTop + glassInset,
    housingWidth - glassInset * 2,
    housingHeight - glassInset * 2,
  );
  ctx.fillStyle = FLAME_CORE;
  ctx.fillRect(
    centreX - (ts * LANTERN_FLAME_WIDTH_FRACTION) / 2,
    housingTop + housingHeight - glassInset - ts * LANTERN_FLAME_HEIGHT_FRACTION,
    ts * LANTERN_FLAME_WIDTH_FRACTION,
    ts * LANTERN_FLAME_HEIGHT_FRACTION,
  );

  const capOverhang = ts * LANTERN_CAP_OVERHANG_FRACTION;
  ctx.fillStyle = BRASS_LIGHT;
  ctx.fillRect(
    centreX - housingWidth / 2 - capOverhang,
    housingTop - ts * LANTERN_CAP_HEIGHT_FRACTION,
    housingWidth + capOverhang * 2,
    ts * LANTERN_CAP_HEIGHT_FRACTION,
  );
}

// ── Stove ─────────────────────────────────────────────────────────────────────

const STOVE_BODY_TOP_FRACTION = 0.32;
const STOVE_BODY_BOTTOM_FRACTION = 0.92;
const STOVE_BODY_INSET_FRACTION = 0.1;
const STOVE_TOP_PLATE_HEIGHT_FRACTION = 0.07;
const STOVE_DOOR_WIDTH_FRACTION = 0.34;
const STOVE_DOOR_TOP_FRACTION = 0.58;
const STOVE_DOOR_HEIGHT_FRACTION = 0.2;
const STOVE_LEG_WIDTH_FRACTION = 0.06;
const STOVE_LEG_HEIGHT_FRACTION = 0.06;
const STOVE_LEG_INSET_FRACTION = 0.16;
const STOVE_POT_WIDTH_FRACTION = 0.42;
const STOVE_POT_HEIGHT_FRACTION = 0.18;
const STOVE_POT_TOP_FRACTION = 0.16;
const STOVE_POT_RIM_HEIGHT = 1;
const STOVE_STEAM_ALPHA = 0.3;
/** Grate bars across the firebox door, so the embers read as a fire behind iron. */
const STOVE_DOOR_BAR_COUNT = 3;

/**
 * A squat iron stove with a copper pot on it.
 *
 * Static: the tile renderer bakes prop tiles into the chunk cache, so anything
 * that moves has to be drawn per frame instead. The steam is therefore
 * `drawStoveSteam`, called from `SafeRoomSystem.renderObjects` alongside the
 * lantern pools.
 */
export function drawStoveTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  const centreX = sx + ts / 2;
  drawContactShadow(ctx, sx, sy, ts);

  const bodyLeft = sx + ts * STOVE_BODY_INSET_FRACTION;
  const bodyWidth = ts * (1 - STOVE_BODY_INSET_FRACTION * 2);
  const bodyTop = sy + ts * STOVE_BODY_TOP_FRACTION;
  const bodyBottom = sy + ts * STOVE_BODY_BOTTOM_FRACTION;

  const legWidth = Math.max(1, ts * STOVE_LEG_WIDTH_FRACTION);
  ctx.fillStyle = IRON;
  for (const legX of [
    bodyLeft + ts * STOVE_LEG_INSET_FRACTION,
    bodyLeft + bodyWidth - ts * STOVE_LEG_INSET_FRACTION - legWidth,
  ]) {
    ctx.fillRect(legX, bodyBottom, legWidth, ts * STOVE_LEG_HEIGHT_FRACTION);
  }

  ctx.fillStyle = IRON;
  ctx.fillRect(bodyLeft, bodyTop, bodyWidth, bodyBottom - bodyTop);
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(bodyLeft, bodyTop, bodyWidth, ts * STOVE_TOP_PLATE_HEIGHT_FRACTION);

  // Firebox door, with the embers behind it visible through the grate.
  const doorWidth = ts * STOVE_DOOR_WIDTH_FRACTION;
  const doorTop = sy + ts * STOVE_DOOR_TOP_FRACTION;
  ctx.fillStyle = EMBER;
  ctx.fillRect(centreX - doorWidth / 2, doorTop, doorWidth, ts * STOVE_DOOR_HEIGHT_FRACTION);
  ctx.fillStyle = IRON;
  for (let bar = 1; bar < STOVE_DOOR_BAR_COUNT; bar++) {
    ctx.fillRect(
      centreX - doorWidth / 2,
      doorTop + (ts * STOVE_DOOR_HEIGHT_FRACTION * bar) / STOVE_DOOR_BAR_COUNT,
      doorWidth,
      1,
    );
  }

  const potWidth = ts * STOVE_POT_WIDTH_FRACTION;
  const potTop = sy + ts * STOVE_POT_TOP_FRACTION;
  const potHeight = ts * STOVE_POT_HEIGHT_FRACTION;
  ctx.fillStyle = COPPER;
  ctx.fillRect(centreX - potWidth / 2, potTop, potWidth, potHeight);
  ctx.fillStyle = COPPER_LIGHT;
  ctx.fillRect(centreX - potWidth / 2, potTop, potWidth, STOVE_POT_RIM_HEIGHT);
}

/**
 * Wisps rising off the stove's pot, drawn per frame over the baked tile.
 *
 * The counter's own `drawDishSteam`, anchored on the pot's rim instead of a
 * dish's — so a stew on the range and a bowl on the bar steam alike.
 */
export function drawStoveSteam(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  elapsedSeconds: number,
): void {
  drawDishSteam(
    ctx,
    sx + ts / 2,
    sy + ts * STOVE_POT_TOP_FRACTION,
    ts,
    elapsedSeconds,
    STOVE_STEAM_ALPHA,
  );
}

// ── Refectory table and stools ────────────────────────────────────────────────

const TABLE_TOP_FRACTION = 0.34;
const TABLE_TOP_HEIGHT_FRACTION = 0.1;
const TABLE_TOP_INSET_FRACTION = 0.02;
const TABLE_APRON_HEIGHT_FRACTION = 0.07;
const TABLE_LEG_WIDTH_FRACTION = 0.09;
const TABLE_LEG_INSET_FRACTION = 0.1;
const TABLE_LEG_BOTTOM_FRACTION = 0.9;
const TABLE_PLANK_COUNT = 3;

/** A long refectory table: plank top, apron rail and two turned legs. */
export function drawTableTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  drawContactShadow(ctx, sx, sy, ts);

  const legWidth = Math.max(1, ts * TABLE_LEG_WIDTH_FRACTION);
  const topY = sy + ts * TABLE_TOP_FRACTION;
  const legBottom = sy + ts * TABLE_LEG_BOTTOM_FRACTION;
  ctx.fillStyle = WOOD_DARK;
  for (const legX of [
    sx + ts * TABLE_LEG_INSET_FRACTION,
    sx + ts * (1 - TABLE_LEG_INSET_FRACTION) - legWidth,
  ]) {
    ctx.fillRect(legX, topY, legWidth, legBottom - topY);
  }

  const left = sx + ts * TABLE_TOP_INSET_FRACTION;
  const width = ts * (1 - TABLE_TOP_INSET_FRACTION * 2);
  ctx.fillStyle = WOOD;
  ctx.fillRect(left, topY, width, ts * TABLE_TOP_HEIGHT_FRACTION);
  ctx.fillStyle = WOOD_LIGHT;
  ctx.fillRect(left, topY, width, 1);

  // Plank joints across the top, so a run of table tiles reads as boards rather
  // than as one flat slab.
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  for (let plank = 1; plank < TABLE_PLANK_COUNT; plank++) {
    ctx.fillRect(
      left,
      topY + (ts * TABLE_TOP_HEIGHT_FRACTION * plank) / TABLE_PLANK_COUNT,
      width,
      1,
    );
  }

  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(
    left,
    topY + ts * TABLE_TOP_HEIGHT_FRACTION,
    width,
    ts * TABLE_APRON_HEIGHT_FRACTION,
  );
}

const STOOL_SEAT_TOP_FRACTION = 0.5;
const STOOL_SEAT_WIDTH_FRACTION = 0.44;
const STOOL_SEAT_HEIGHT_FRACTION = 0.09;
const STOOL_LEG_WIDTH_FRACTION = 0.07;
const STOOL_LEG_BOTTOM_FRACTION = 0.88;
const STOOL_LEG_SPREAD_FRACTION = 0.28;

/** A three-legged stool at the refectory table. */
export function drawStoolTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  const centreX = sx + ts / 2;
  drawContactShadow(ctx, sx, sy, ts, STOOL_SEAT_WIDTH_FRACTION);

  const seatTop = sy + ts * STOOL_SEAT_TOP_FRACTION;
  const legWidth = Math.max(1, ts * STOOL_LEG_WIDTH_FRACTION);
  const legBottom = sy + ts * STOOL_LEG_BOTTOM_FRACTION;
  ctx.fillStyle = WOOD_DARK;
  for (const spread of [-STOOL_LEG_SPREAD_FRACTION, 0, STOOL_LEG_SPREAD_FRACTION]) {
    ctx.fillRect(centreX + ts * spread - legWidth / 2, seatTop, legWidth, legBottom - seatTop);
  }

  const seatWidth = ts * STOOL_SEAT_WIDTH_FRACTION;
  ctx.fillStyle = WOOD;
  ctx.fillRect(centreX - seatWidth / 2, seatTop, seatWidth, ts * STOOL_SEAT_HEIGHT_FRACTION);
  ctx.fillStyle = WOOD_LIGHT;
  ctx.fillRect(centreX - seatWidth / 2, seatTop, seatWidth, 1);
}

// ── Larder ────────────────────────────────────────────────────────────────────

const LARDER_CRATE_WIDTH_FRACTION = 0.46;
const LARDER_CRATE_HEIGHT_FRACTION = 0.3;
const LARDER_CRATE_TOP_FRACTION = 0.3;
const LARDER_LOWER_CRATE_TOP_FRACTION = 0.6;
const LARDER_CRATE_LEFT_FRACTION = 0.06;
const LARDER_SLAT_COUNT = 3;
const LARDER_SACK_WIDTH_FRACTION = 0.34;
const LARDER_SACK_HEIGHT_FRACTION = 0.36;
const LARDER_SACK_LEFT_FRACTION = 0.58;
const LARDER_SACK_TOP_FRACTION = 0.54;
const LARDER_SACK_NECK_WIDTH_FRACTION = 0.14;
const LARDER_SACK_NECK_HEIGHT_FRACTION = 0.07;
/** The shaded quarter of the sack, as fractions of the sack's own extent. */
const LARDER_SACK_SHADE_LEFT_FRACTION = 0.7;
const LARDER_SACK_SHADE_TOP_FRACTION = 0.3;

/** Stacked crates and a grain sack against a side wall. */
export function drawLarderTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  drawContactShadow(ctx, sx, sy, ts, 1);

  const crateWidth = ts * LARDER_CRATE_WIDTH_FRACTION;
  const crateHeight = ts * LARDER_CRATE_HEIGHT_FRACTION;
  const crateLeft = sx + ts * LARDER_CRATE_LEFT_FRACTION;
  for (const topFraction of [LARDER_LOWER_CRATE_TOP_FRACTION, LARDER_CRATE_TOP_FRACTION]) {
    const top = sy + ts * topFraction;
    ctx.fillStyle = WOOD;
    ctx.fillRect(crateLeft, top, crateWidth, crateHeight);
    ctx.fillStyle = WOOD_DARK;
    for (let slat = 1; slat < LARDER_SLAT_COUNT; slat++) {
      ctx.fillRect(crateLeft, top + (crateHeight * slat) / LARDER_SLAT_COUNT, crateWidth, 1);
    }
    ctx.fillStyle = WOOD_LIGHT;
    ctx.fillRect(crateLeft, top, crateWidth, 1);
  }

  const sackWidth = ts * LARDER_SACK_WIDTH_FRACTION;
  const sackLeft = sx + ts * LARDER_SACK_LEFT_FRACTION;
  const sackTop = sy + ts * LARDER_SACK_TOP_FRACTION;
  const sackHeight = ts * LARDER_SACK_HEIGHT_FRACTION;
  ctx.fillStyle = SACK_LINEN;
  ctx.beginPath();
  ctx.moveTo(sackLeft, sackTop + sackHeight);
  ctx.lineTo(sackLeft + sackWidth, sackTop + sackHeight);
  ctx.quadraticCurveTo(sackLeft + sackWidth, sackTop, sackLeft + sackWidth / 2, sackTop);
  ctx.quadraticCurveTo(sackLeft, sackTop, sackLeft, sackTop + sackHeight);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = SACK_LINEN_SHADE;
  ctx.fillRect(
    sackLeft + sackWidth * LARDER_SACK_SHADE_LEFT_FRACTION,
    sackTop + sackHeight * LARDER_SACK_SHADE_TOP_FRACTION,
    sackWidth * (1 - LARDER_SACK_SHADE_LEFT_FRACTION),
    sackHeight * (1 - LARDER_SACK_SHADE_TOP_FRACTION),
  );
  ctx.fillRect(
    sackLeft + sackWidth / 2 - (ts * LARDER_SACK_NECK_WIDTH_FRACTION) / 2,
    sackTop - ts * LARDER_SACK_NECK_HEIGHT_FRACTION,
    ts * LARDER_SACK_NECK_WIDTH_FRACTION,
    ts * LARDER_SACK_NECK_HEIGHT_FRACTION,
  );
}

// ── Rug ───────────────────────────────────────────────────────────────────────

const RUG_INSET_FRACTION = 0.04;
const RUG_TOP_FRACTION = 0.18;
const RUG_HEIGHT_FRACTION = 0.64;
const RUG_BAND_COUNT = 3;
const RUG_BAND_INSET_FRACTION = 0.1;
const RUG_FRINGE_WIDTH_FRACTION = 0.03;
/** Half-band offset on odd columns, so a runner's weave carries across tiles. */
const RUG_BAND_COLUMN_PHASE = 0.5;
/** A band covers half its slot, leaving the base weave showing between bands. */
const RUG_BAND_FILL_RATIO = 2;

/**
 * A woven runner across the floor. Walkable, and painted flat: it is the one
 * decoration here with no height, so it gets no contact shadow and no front face.
 */
export function drawRugTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
): void {
  const left = sx + ts * RUG_INSET_FRACTION;
  const width = ts * (1 - RUG_INSET_FRACTION * 2);
  const top = sy + ts * RUG_TOP_FRACTION;
  const height = ts * RUG_HEIGHT_FRACTION;

  ctx.fillStyle = RUG_WEAVE;
  ctx.fillRect(left, top, width, height);

  // Bands alternate with the tile's own column, so a two-tile runner reads as
  // one continuous weave rather than as the same tile printed twice.
  ctx.fillStyle = RUG_WEAVE_ALT;
  for (let band = 0; band < RUG_BAND_COUNT; band++) {
    const columnPhase = tx % 2 === 0 ? RUG_BAND_COLUMN_PHASE : 0;
    const bandY = top + (height * (band + columnPhase)) / RUG_BAND_COUNT;
    ctx.fillRect(
      left + ts * RUG_BAND_INSET_FRACTION,
      bandY,
      width - ts * RUG_BAND_INSET_FRACTION * 2,
      Math.max(1, height / (RUG_BAND_COUNT * RUG_BAND_FILL_RATIO)),
    );
  }

  const fringeWidth = Math.max(1, ts * RUG_FRINGE_WIDTH_FRACTION);
  ctx.fillStyle = RUG_FRINGE;
  ctx.fillRect(left, top, fringeWidth, height);
  ctx.fillRect(left + width - fringeWidth, top, fringeWidth, height);
}
