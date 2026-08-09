/**
 * Icons for the eight source-material enchanted pieces.
 *
 * Unlike the issue kit, these are not a matched set — they come from eight
 * different corners of the fiction and are worn by both crawlers — so each one
 * carries its own accent colour on top of a shared dark-to-light value ramp.
 * At an inventory slot's size the silhouette does the identifying and the
 * accent only confirms it, so every shape here is drawn as a solid mass with
 * two or three flat bands rather than a gradient.
 */

import type { ItemId } from '../../core/ItemDefs';

/** The eight ids this module can draw. Closed, so a new piece cannot ship iconless. */
export type EnchantedGearItemId =
  | 'nightgaunt_cloak'
  | 'slate_butterfly_talisman'
  | 'fae_scale_crupper'
  | 'bracelet_of_dex'
  | 'splatter_skunk_toe_ring'
  | 'shade_gnoll_kneepads'
  | 'grull_war_gauntlet'
  | 'slingshot';

export const ENCHANTED_GEAR_IDS: ReadonlySet<string> = new Set<EnchantedGearItemId>([
  'nightgaunt_cloak',
  'slate_butterfly_talisman',
  'fae_scale_crupper',
  'bracelet_of_dex',
  'splatter_skunk_toe_ring',
  'shade_gnoll_kneepads',
  'grull_war_gauntlet',
  'slingshot',
]);

/** Whether `id` is one of the enchanted pieces, and so drawable by {@link drawEnchantedGearIcon}. */
export function isEnchantedGearItem(id: ItemId): id is EnchantedGearItemId {
  return ENCHANTED_GEAR_IDS.has(id);
}

const INDIGO = '#2c2a52';
const INDIGO_SHADE = '#191833';
const INDIGO_LIGHT = '#454179';
const CYAN_RIM = '#7fe6ff';
const SILVER = '#c8ccd4';
const SILVER_SHADE = '#7d838e';
const SLATE = '#6c7280';
const SLATE_LIGHT = '#9aa1ad';
const WHITE_GLINT = '#ffffff';
const TEAL = '#2f8f7a';
const TEAL_SHADE = '#1c5a4c';
const TEAL_LIGHT = '#63c4ac';
const STRAP = '#5a4632';
const GOLD = '#d9a441';
const GOLD_SHADE = '#966c22';
const GEM = '#4fd0e0';
const SKIN = '#c99a72';
const SKIN_SHADE = '#9a7050';
const BRASS = '#e2b13c';
const STINK = '#8fd44a';
const LEATHER_DARK = '#3c2f26';
const LEATHER_MID = '#5d4736';
const STEEL = '#b7bec8';
const STEEL_SHADE = '#6a727d';
const ORC_STEEL = '#4a5560';
const ORC_STEEL_LIGHT = '#78848f';
const RIVET = '#cdd4dc';
const WOOD = '#8a5a30';
const WOOD_SHADE = '#5c3b1e';
const BAND = '#3b3b3b';
const PEBBLE = '#9b9b9b';

const OUTLINE_WIDTH = 1;
const FULL_CIRCLE = Math.PI * 2;

// Geometry as fractions of the icon square, so every piece scales with the slot.
const ICON_CX = 0.5;

const CLOAK_COLLAR_TOP = 0.14;
const CLOAK_COLLAR_HALF = 0.16;
const CLOAK_SHOULDER_Y = 0.28;
const CLOAK_SHOULDER_HALF = 0.4;
const CLOAK_HEM_Y = 0.84;
const CLOAK_HEM_HALF = 0.34;
/** Scallops along the hem are what separate a bat cape from a plain triangle. */
const CLOAK_SCALLOP_COUNT = 3;
const CLOAK_SCALLOP_RISE = 0.1;
const CLOAK_INNER_INSET = 0.12;
const CLOAK_CLASP_CY = 0.2;
const CLOAK_CLASP_R = 0.06;
const CLOAK_CLASP_INNER_R = 0.028;

const TALISMAN_RING_CY = 0.2;
const TALISMAN_RING_R = 0.1;
const TALISMAN_RING_WIDTH = 0.035;
const TALISMAN_BODY_TOP = 0.34;
const TALISMAN_BODY_BOTTOM = 0.76;
const TALISMAN_BODY_HALF = 0.035;
const TALISMAN_UPPER_WING_TIP_X = 0.4;
const TALISMAN_UPPER_WING_TIP_Y = 0.3;
const TALISMAN_UPPER_WING_OUTER_Y = 0.54;
const TALISMAN_LOWER_WING_TIP_X = 0.3;
const TALISMAN_LOWER_WING_TIP_Y = 0.84;
const TALISMAN_LOWER_WING_INNER_Y = 0.56;
const TALISMAN_GLINT_X = 0.32;
const TALISMAN_GLINT_Y = 0.42;
const TALISMAN_GLINT_R = 0.03;

const CRUPPER_LEFT = 0.14;
const CRUPPER_RIGHT = 0.86;
const CRUPPER_TOP = 0.16;
const CRUPPER_BOTTOM = 0.66;
const CRUPPER_CORNER = 0.16;
const CRUPPER_SCALE_ROWS = 3;
const CRUPPER_SCALE_COLS = 4;
const CRUPPER_SCALE_R = 0.075;
const CRUPPER_SCALE_TOP = 0.26;
const CRUPPER_ROW_SPACING = 0.14;
const CRUPPER_SHINE_INSET = 0.08;
/** The shine is a short arc over the shoulder of the guard, not a full sweep. */
const CRUPPER_SHINE_START_TURNS = -0.125;
const CRUPPER_SHINE_END_TURNS = 0.083;
const CRUPPER_SHINE_START_ANGLE = FULL_CIRCLE * CRUPPER_SHINE_START_TURNS;
const CRUPPER_SHINE_END_ANGLE = FULL_CIRCLE * CRUPPER_SHINE_END_TURNS;
const CRUPPER_SHINE_RADIUS_FRACTION = 0.5;
const CRUPPER_STRAP_WIDTH = 0.08;
const CRUPPER_STRAP_BOTTOM = 0.88;
const CRUPPER_STRAP_LEFT_X = 0.26;
const CRUPPER_STRAP_RIGHT_X = 0.66;

const BRACELET_CY = 0.5;
const BRACELET_RX = 0.3;
const BRACELET_RY = 0.2;
/** The band's thickness, as the gap between the outer and inner ellipse. */
const BRACELET_BAND = 0.09;
const BRACELET_TILT = -0.35;
const BRACELET_GEM_X = 0.5;
const BRACELET_GEM_Y = 0.3;
const BRACELET_GEM_R = 0.055;

const FOOT_HEEL_X = 0.24;
const FOOT_HEEL_Y = 0.74;
const FOOT_ARCH_Y = 0.46;
const FOOT_BALL_X = 0.66;
const FOOT_TOE_X = 0.82;
const FOOT_TOE_Y = 0.62;
const FOOT_SOLE_Y = 0.82;
const TOE_RING_CX = 0.74;
const TOE_RING_CY = 0.7;
const TOE_RING_RX = 0.075;
const TOE_RING_RY = 0.055;
const TOE_RING_WIDTH = 0.04;
const STINK_WISP_COUNT = 3;
const STINK_WISP_X = 0.6;
const STINK_WISP_TOP = 0.14;
const STINK_WISP_SPACING = 0.11;
const STINK_WISP_R = 0.035;
const STINK_WISP_STAGGER = 0.08;

const KNEEPAD_LEFT_CX = 0.29;
const KNEEPAD_RIGHT_CX = 0.71;
const KNEEPAD_CY = 0.66;
const KNEEPAD_RX = 0.2;
const KNEEPAD_RY = 0.22;
const KNEEPAD_STRAP_TOP = 0.66;
const KNEEPAD_STRAP_HEIGHT = 0.08;
const KNEEPAD_SPIKE_COUNT = 3;
const KNEEPAD_SPIKE_LENGTH = 0.14;
const KNEEPAD_SPIKE_HALF_WIDTH = 0.045;
/** Spikes fan across most of the dome's upper arc; a full half-turn would put the outer two sideways. */
const KNEEPAD_SPIKE_SPREAD_TURNS = 0.62;
const KNEEPAD_SPIKE_SPREAD = Math.PI * KNEEPAD_SPIKE_SPREAD_TURNS;

const FIST_LEFT = 0.2;
const FIST_RIGHT = 0.78;
const FIST_TOP = 0.24;
const FIST_BOTTOM = 0.7;
const FIST_CORNER = 0.12;
const FIST_CUFF_TOP = 0.7;
const FIST_CUFF_BOTTOM = 0.86;
const FIST_CUFF_INSET = 0.06;
const FIST_KNUCKLE_COUNT = 4;
const FIST_KNUCKLE_Y = 0.32;
const FIST_SPIKE_HEIGHT = 0.12;
const FIST_SPIKE_HALF_WIDTH = 0.04;
const FIST_FINGER_LINE_TOP = 0.4;
const FIST_FINGER_LINE_BOTTOM = 0.66;
const FIST_RIVET_R = 0.028;
const FIST_RIVET_Y = 0.78;
const FIST_RIVET_COUNT = 3;
/** Centres a knuckle spike within its share of the fist's width. */
const FIST_KNUCKLE_SLOT_CENTER = 0.5;

const SLING_HANDLE_BOTTOM = 0.9;
const SLING_HANDLE_TOP = 0.56;
const SLING_HANDLE_HALF_WIDTH = 0.055;
const SLING_FORK_LEFT_X = 0.24;
const SLING_FORK_RIGHT_X = 0.76;
const SLING_FORK_TOP_Y = 0.24;
const SLING_PRONG_WIDTH = 0.09;
const SLING_BAND_SAG = 0.16;
const SLING_BAND_WIDTH = 0.05;
const SLING_POUCH_R = 0.075;
const SLING_LOOSE_PEBBLE_R = 0.05;
const SLING_LOOSE_PEBBLE_Y = 0.9;
const SLING_LOOSE_PEBBLE_NEAR_X = 0.14;
const SLING_LOOSE_PEBBLE_FAR_X = 0.28;
const SLING_LOOSE_PEBBLE_XS = [SLING_LOOSE_PEBBLE_NEAR_X, SLING_LOOSE_PEBBLE_FAR_X] as const;

/** Draws one enchanted piece into a square icon region at `x`,`y`. */
export function drawEnchantedGearIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  id: EnchantedGearItemId,
): void {
  switch (id) {
    case 'nightgaunt_cloak':
      drawNightgauntCloak(ctx, x, y, size);
      return;
    case 'slate_butterfly_talisman':
      drawButterflyTalisman(ctx, x, y, size);
      return;
    case 'fae_scale_crupper':
      drawFaeScaleCrupper(ctx, x, y, size);
      return;
    case 'bracelet_of_dex':
      drawBracelet(ctx, x, y, size);
      return;
    case 'splatter_skunk_toe_ring':
      drawToeRing(ctx, x, y, size);
      return;
    case 'shade_gnoll_kneepads':
      drawKneepads(ctx, x, y, size);
      return;
    case 'grull_war_gauntlet':
      drawWarGauntlet(ctx, x, y, size);
      return;
    case 'slingshot':
      drawSlingshot(ctx, x, y, size);
      return;
  }
}

function drawNightgauntCloak(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size * ICON_CX;
  const hemY = y + size * CLOAK_HEM_Y;
  const scallopSpan = (size * CLOAK_HEM_HALF * 2) / CLOAK_SCALLOP_COUNT;

  const traceCape = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - size * CLOAK_COLLAR_HALF, y + size * CLOAK_COLLAR_TOP);
    ctx.lineTo(cx - size * CLOAK_SHOULDER_HALF, y + size * CLOAK_SHOULDER_Y);
    ctx.lineTo(cx - size * CLOAK_HEM_HALF, hemY);
    // Each scallop rises to a point between two hem lobes, which is the bat read.
    for (let lobe = 0; lobe < CLOAK_SCALLOP_COUNT; lobe++) {
      const lobeStart = cx - size * CLOAK_HEM_HALF + lobe * scallopSpan;
      ctx.quadraticCurveTo(
        lobeStart + scallopSpan / 2,
        hemY - size * CLOAK_SCALLOP_RISE,
        lobeStart + scallopSpan,
        hemY,
      );
    }
    ctx.lineTo(cx + size * CLOAK_SHOULDER_HALF, y + size * CLOAK_SHOULDER_Y);
    ctx.lineTo(cx + size * CLOAK_COLLAR_HALF, y + size * CLOAK_COLLAR_TOP);
    ctx.closePath();
  };

  ctx.fillStyle = INDIGO;
  traceCape();
  ctx.fill();

  // A cyan rim on the silhouette itself, because the cape's own value sits at
  // the slot background's and would otherwise disappear into it.
  ctx.strokeStyle = CYAN_RIM;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();

  ctx.fillStyle = INDIGO_SHADE;
  ctx.beginPath();
  ctx.moveTo(cx, y + size * CLOAK_SHOULDER_Y);
  ctx.lineTo(cx + size * (CLOAK_HEM_HALF - CLOAK_INNER_INSET), hemY - size * CLOAK_SCALLOP_RISE);
  ctx.lineTo(cx, hemY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = INDIGO_LIGHT;
  ctx.beginPath();
  ctx.arc(cx, y + size * CLOAK_CLASP_CY, size * CLOAK_CLASP_R, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.fillStyle = CYAN_RIM;
  ctx.beginPath();
  ctx.arc(cx, y + size * CLOAK_CLASP_CY, size * CLOAK_CLASP_INNER_R, 0, FULL_CIRCLE);
  ctx.fill();
}

function drawButterflyTalisman(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size * ICON_CX;

  ctx.strokeStyle = SILVER;
  ctx.lineWidth = size * TALISMAN_RING_WIDTH;
  ctx.beginPath();
  ctx.arc(cx, y + size * TALISMAN_RING_CY, size * TALISMAN_RING_R, 0, FULL_CIRCLE);
  ctx.stroke();

  const bodyTop = y + size * TALISMAN_BODY_TOP;
  const bodyBottom = y + size * TALISMAN_BODY_BOTTOM;

  for (const side of [-1, 1]) {
    ctx.fillStyle = SLATE;
    ctx.beginPath();
    ctx.moveTo(cx, bodyTop);
    ctx.lineTo(cx + side * size * TALISMAN_UPPER_WING_TIP_X, y + size * TALISMAN_UPPER_WING_TIP_Y);
    ctx.lineTo(
      cx + side * size * TALISMAN_UPPER_WING_TIP_X,
      y + size * TALISMAN_UPPER_WING_OUTER_Y,
    );
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = SILVER;
    ctx.lineWidth = OUTLINE_WIDTH;
    ctx.stroke();

    ctx.fillStyle = SLATE_LIGHT;
    ctx.beginPath();
    ctx.moveTo(cx, y + size * TALISMAN_LOWER_WING_INNER_Y);
    ctx.lineTo(cx + side * size * TALISMAN_LOWER_WING_TIP_X, y + size * TALISMAN_LOWER_WING_TIP_Y);
    ctx.lineTo(cx, bodyBottom);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = SILVER_SHADE;
    ctx.stroke();
  }

  ctx.fillStyle = SILVER;
  ctx.fillRect(
    cx - size * TALISMAN_BODY_HALF,
    bodyTop,
    size * TALISMAN_BODY_HALF * 2,
    bodyBottom - bodyTop,
  );

  ctx.fillStyle = WHITE_GLINT;
  ctx.beginPath();
  ctx.arc(
    x + size * TALISMAN_GLINT_X,
    y + size * TALISMAN_GLINT_Y,
    size * TALISMAN_GLINT_R,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();
}

function drawFaeScaleCrupper(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const left = x + size * CRUPPER_LEFT;
  const right = x + size * CRUPPER_RIGHT;
  const top = y + size * CRUPPER_TOP;
  const bottom = y + size * CRUPPER_BOTTOM;
  const corner = size * CRUPPER_CORNER;

  for (const strapX of [CRUPPER_STRAP_LEFT_X, CRUPPER_STRAP_RIGHT_X]) {
    ctx.fillStyle = STRAP;
    ctx.fillRect(
      x + size * strapX,
      bottom - corner,
      size * CRUPPER_STRAP_WIDTH,
      y + size * CRUPPER_STRAP_BOTTOM - (bottom - corner),
    );
  }

  ctx.fillStyle = TEAL_SHADE;
  ctx.beginPath();
  ctx.moveTo(left + corner, top);
  ctx.lineTo(right - corner, top);
  ctx.quadraticCurveTo(right, top, right, top + corner);
  ctx.lineTo(right, bottom - corner);
  ctx.quadraticCurveTo(right, bottom, right - corner, bottom);
  ctx.lineTo(left + corner, bottom);
  ctx.quadraticCurveTo(left, bottom, left, bottom - corner);
  ctx.lineTo(left, top + corner);
  ctx.quadraticCurveTo(left, top, left + corner, top);
  ctx.closePath();
  ctx.fill();

  // Overlapping half-discs are the scale read; a flat fill would be a saddle.
  ctx.save();
  ctx.clip();
  const scaleSpan = (right - left) / CRUPPER_SCALE_COLS;
  for (let row = 0; row < CRUPPER_SCALE_ROWS; row++) {
    const scaleY = y + size * (CRUPPER_SCALE_TOP + row * CRUPPER_ROW_SPACING);
    const rowOffset = row % 2 === 0 ? 0 : scaleSpan / 2;
    ctx.fillStyle = row % 2 === 0 ? TEAL : TEAL_LIGHT;
    for (let col = 0; col <= CRUPPER_SCALE_COLS; col++) {
      ctx.beginPath();
      ctx.arc(left + rowOffset + col * scaleSpan, scaleY, size * CRUPPER_SCALE_R, Math.PI, 0);
      ctx.fill();
    }
  }

  ctx.strokeStyle = WHITE_GLINT;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.arc(
    left + size * CRUPPER_SHINE_INSET,
    top + size * CRUPPER_SHINE_INSET,
    (right - left) * CRUPPER_SHINE_RADIUS_FRACTION,
    CRUPPER_SHINE_START_ANGLE,
    CRUPPER_SHINE_END_ANGLE,
  );
  ctx.stroke();
  ctx.restore();
}

function drawBracelet(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const cx = x + size * ICON_CX;
  const cy = y + size * BRACELET_CY;

  // Both ellipses go into one path so the even-odd rule punches the hole,
  // rather than erasing pixels via destination-out — this icon is drawn
  // straight onto the shared game canvas with no offscreen buffer to contain
  // a destructive composite op.
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.ellipse(cx, cy, size * BRACELET_RX, size * BRACELET_RY, BRACELET_TILT, 0, FULL_CIRCLE);
  ctx.ellipse(
    cx,
    cy,
    size * (BRACELET_RX - BRACELET_BAND),
    size * (BRACELET_RY - BRACELET_BAND),
    BRACELET_TILT,
    0,
    FULL_CIRCLE,
  );
  ctx.fill('evenodd');

  ctx.strokeStyle = GOLD_SHADE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.ellipse(cx, cy, size * BRACELET_RX, size * BRACELET_RY, BRACELET_TILT, 0, FULL_CIRCLE);
  ctx.stroke();

  ctx.fillStyle = GEM;
  ctx.beginPath();
  ctx.arc(
    x + size * BRACELET_GEM_X,
    y + size * BRACELET_GEM_Y,
    size * BRACELET_GEM_R,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();
}

function drawToeRing(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.moveTo(x + size * FOOT_HEEL_X, y + size * FOOT_HEEL_Y);
  ctx.quadraticCurveTo(
    x + size * FOOT_HEEL_X,
    y + size * FOOT_ARCH_Y,
    x + size * FOOT_BALL_X,
    y + size * FOOT_ARCH_Y,
  );
  ctx.lineTo(x + size * FOOT_TOE_X, y + size * FOOT_TOE_Y);
  ctx.lineTo(x + size * FOOT_TOE_X, y + size * FOOT_SOLE_Y);
  ctx.lineTo(x + size * FOOT_HEEL_X, y + size * FOOT_SOLE_Y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = SKIN_SHADE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();

  ctx.strokeStyle = BRASS;
  ctx.lineWidth = size * TOE_RING_WIDTH;
  ctx.beginPath();
  ctx.ellipse(
    x + size * TOE_RING_CX,
    y + size * TOE_RING_CY,
    size * TOE_RING_RX,
    size * TOE_RING_RY,
    0,
    0,
    FULL_CIRCLE,
  );
  ctx.stroke();

  // The skunk is the joke the item is named for; without the wisps this is a foot.
  ctx.fillStyle = STINK;
  for (let wisp = 0; wisp < STINK_WISP_COUNT; wisp++) {
    const wispX = x + size * (STINK_WISP_X + (wisp % 2 === 0 ? 0 : STINK_WISP_STAGGER));
    const wispY = y + size * (STINK_WISP_TOP + wisp * STINK_WISP_SPACING);
    ctx.beginPath();
    ctx.arc(wispX, wispY, size * STINK_WISP_R, 0, FULL_CIRCLE);
    ctx.fill();
  }
}

function drawKneepads(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  for (const padCx of [KNEEPAD_LEFT_CX, KNEEPAD_RIGHT_CX]) {
    const cx = x + size * padCx;
    const cy = y + size * KNEEPAD_CY;

    ctx.fillStyle = STEEL;
    for (let spike = 0; spike < KNEEPAD_SPIKE_COUNT; spike++) {
      const spread = KNEEPAD_SPIKE_SPREAD / (KNEEPAD_SPIKE_COUNT - 1);
      const angle = -Math.PI / 2 - KNEEPAD_SPIKE_SPREAD / 2 + spike * spread;
      const baseX = cx + Math.cos(angle) * size * KNEEPAD_RX;
      const baseY = cy + Math.sin(angle) * size * KNEEPAD_RY;
      const tipX = cx + Math.cos(angle) * size * (KNEEPAD_RX + KNEEPAD_SPIKE_LENGTH);
      const tipY = cy + Math.sin(angle) * size * (KNEEPAD_RY + KNEEPAD_SPIKE_LENGTH);
      ctx.beginPath();
      ctx.moveTo(
        baseX - Math.sin(angle) * size * KNEEPAD_SPIKE_HALF_WIDTH,
        baseY + Math.cos(angle) * size * KNEEPAD_SPIKE_HALF_WIDTH,
      );
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(
        baseX + Math.sin(angle) * size * KNEEPAD_SPIKE_HALF_WIDTH,
        baseY - Math.cos(angle) * size * KNEEPAD_SPIKE_HALF_WIDTH,
      );
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = LEATHER_MID;
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * KNEEPAD_RX, size * KNEEPAD_RY, 0, Math.PI, FULL_CIRCLE);
    ctx.fill();
    ctx.strokeStyle = STEEL_SHADE;
    ctx.lineWidth = OUTLINE_WIDTH;
    ctx.stroke();

    ctx.fillStyle = LEATHER_DARK;
    ctx.fillRect(
      cx - size * KNEEPAD_RX,
      y + size * KNEEPAD_STRAP_TOP,
      size * KNEEPAD_RX * 2,
      size * KNEEPAD_STRAP_HEIGHT,
    );
  }
}

function drawWarGauntlet(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const left = x + size * FIST_LEFT;
  const right = x + size * FIST_RIGHT;
  const top = y + size * FIST_TOP;
  const bottom = y + size * FIST_BOTTOM;
  const corner = size * FIST_CORNER;
  const knuckleSpan = (right - left) / FIST_KNUCKLE_COUNT;

  ctx.fillStyle = STEEL;
  for (let knuckle = 0; knuckle < FIST_KNUCKLE_COUNT; knuckle++) {
    const spikeCx = left + knuckleSpan * (knuckle + FIST_KNUCKLE_SLOT_CENTER);
    const spikeBaseY = y + size * FIST_KNUCKLE_Y;
    ctx.beginPath();
    ctx.moveTo(spikeCx - size * FIST_SPIKE_HALF_WIDTH, spikeBaseY);
    ctx.lineTo(spikeCx, spikeBaseY - size * FIST_SPIKE_HEIGHT);
    ctx.lineTo(spikeCx + size * FIST_SPIKE_HALF_WIDTH, spikeBaseY);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = ORC_STEEL;
  ctx.beginPath();
  ctx.moveTo(left + corner, top);
  ctx.lineTo(right - corner, top);
  ctx.quadraticCurveTo(right, top, right, top + corner);
  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.lineTo(left, top + corner);
  ctx.quadraticCurveTo(left, top, left + corner, top);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = ORC_STEEL_LIGHT;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();

  // Finger divisions: a plain block reads as a brick rather than a closed fist.
  ctx.strokeStyle = ORC_STEEL_LIGHT;
  ctx.beginPath();
  for (let finger = 1; finger < FIST_KNUCKLE_COUNT; finger++) {
    const lineX = left + knuckleSpan * finger;
    ctx.moveTo(lineX, y + size * FIST_FINGER_LINE_TOP);
    ctx.lineTo(lineX, y + size * FIST_FINGER_LINE_BOTTOM);
  }
  ctx.stroke();

  ctx.fillStyle = ORC_STEEL_LIGHT;
  ctx.fillRect(
    left - size * FIST_CUFF_INSET,
    y + size * FIST_CUFF_TOP,
    right - left + size * FIST_CUFF_INSET * 2,
    size * (FIST_CUFF_BOTTOM - FIST_CUFF_TOP),
  );

  ctx.fillStyle = RIVET;
  for (let rivet = 0; rivet < FIST_RIVET_COUNT; rivet++) {
    const rivetX = left + ((right - left) * (rivet + 1)) / (FIST_RIVET_COUNT + 1);
    ctx.beginPath();
    ctx.arc(rivetX, y + size * FIST_RIVET_Y, size * FIST_RIVET_R, 0, FULL_CIRCLE);
    ctx.fill();
  }
}

function drawSlingshot(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const cx = x + size * ICON_CX;
  const forkY = y + size * SLING_FORK_TOP_Y;
  const leftForkX = x + size * SLING_FORK_LEFT_X;
  const rightForkX = x + size * SLING_FORK_RIGHT_X;
  const handleTop = y + size * SLING_HANDLE_TOP;

  ctx.fillStyle = WOOD;
  ctx.fillRect(
    cx - size * SLING_HANDLE_HALF_WIDTH,
    handleTop,
    size * SLING_HANDLE_HALF_WIDTH * 2,
    y + size * SLING_HANDLE_BOTTOM - handleTop,
  );

  ctx.strokeStyle = WOOD;
  ctx.lineWidth = size * SLING_PRONG_WIDTH;
  ctx.lineCap = 'round';
  for (const prongX of [leftForkX, rightForkX]) {
    ctx.beginPath();
    ctx.moveTo(cx, handleTop);
    ctx.lineTo(prongX, forkY);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  ctx.strokeStyle = WOOD_SHADE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(cx, handleTop);
  ctx.lineTo(cx, y + size * SLING_HANDLE_BOTTOM);
  ctx.stroke();

  // The sagging band plus a pebble in it is what says "loaded", not "wishbone".
  ctx.strokeStyle = BAND;
  ctx.lineWidth = size * SLING_BAND_WIDTH;
  ctx.beginPath();
  ctx.moveTo(leftForkX, forkY);
  ctx.quadraticCurveTo(cx, forkY + size * SLING_BAND_SAG * 2, rightForkX, forkY);
  ctx.stroke();

  ctx.fillStyle = PEBBLE;
  ctx.beginPath();
  ctx.arc(cx, forkY + size * SLING_BAND_SAG, size * SLING_POUCH_R, 0, FULL_CIRCLE);
  ctx.fill();

  for (const pebbleX of SLING_LOOSE_PEBBLE_XS) {
    ctx.beginPath();
    ctx.arc(
      x + size * pebbleX,
      y + size * SLING_LOOSE_PEBBLE_Y,
      size * SLING_LOOSE_PEBBLE_R,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();
  }
}
