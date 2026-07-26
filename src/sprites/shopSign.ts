/**
 * Hanging shop signs — a wrought bracket off a building's facade and a painted
 * board swinging under it, carrying the device of the trade inside.
 *
 * Drawn procedurally rather than commissioned: the town's props are already
 * primitives and a sign is a rectangle, two eyes and a small emblem. It exists so
 * that every named building is identifiable without walking to its door, so the
 * emblem is the point and everything around it is frame.
 *
 * The sign is drawn **above and west of** its anchor tile — bolted to the facade
 * beside the opening, which is where an inn's sign goes and, more usefully, is
 * the one place a 15-building town has left for it: the row below a door is the
 * apron the player walks on, and the opening itself has to stay clear. Measured
 * at a 32 px tile over all fifteen emblems and a full sway cycle, the art
 * occupies y ∈ [−47, −10] px and x ∈ [−33, +16] px relative to the anchor's
 * top-left, so it is entirely above the anchor tile and mostly over the facade
 * tile west of it.
 */

import { WOOD_DARK } from './townPalette';
import type { ShopSignEmblem } from '../map/town/townPlan';
import { GOLDEN_ANGLE_RAD } from '../utils';

const TWO_PI = Math.PI * 2;

/**
 * The two sides of a symmetric device, hoisted out of the painters that iterate
 * them: a `[-1, 1]` literal inside a `for…of` allocates an array every frame, and
 * these run once per sign per frame.
 */
const MIRRORED_SIDES: ReadonlyArray<number> = [-1, 1];

/**
 * Geometry, as fractions of a tile, measured from the anchor tile's top-left.
 *
 * The heights are pinned to the **door head**, not to the building. Every sprite
 * puts its doorway on its front row, so the lintel is about a tile above the
 * anchor whatever the building's height, while the footprint above that row runs
 * from 4 tiles (five of the thirteen sprites, including the smithy and both
 * taverns) to 9 (the Desperado Club) — measured, not estimated. A sign hung off
 * the roof line would need a per-building offset; hung off the door head it is
 * one offset for all fifteen.
 *
 * The arm projects **west**, past the opening the player walks through. How far
 * west is not fixed, because doorways are not all one tile wide: `doorTile` is
 * the *centre* of the opening, so a wide front's opening reaches west of it and
 * an unshifted sign would hang across the middle of it. `signWestShiftTiles`
 * turns the width into the shift that keeps every sign the same distance west of
 * its opening's west edge.
 */
const BRACKET_ARM_Y = -1.42;
const BRACKET_ROOT_X = 0.5;
const BRACKET_TIP_X = -0.5;
const BRACKET_STAY_ROOT_Y = -0.82;
/** How far along the arm the stay meets it, as a fraction of the arm's reach. */
const BRACKET_STAY_REACH = 0.55;
const BRACKET_THICKNESS_PX = 2;
/** The two eyes the board swings on, as a fraction of the tile either side of the tip. */
const HANGER_SPREAD = 0.26;
const HANGER_THICKNESS_PX = 1;

const BOARD_TOP = -1.24;
const BOARD_BOTTOM = -0.3;
const BOARD_HALF_WIDTH = 0.46;
const BOARD_FRAME_PX = 2;
const BOARD_CORNER_PX = 3;
/** How much of the board's height the light wash covers, from the bottom up. */
const BOARD_SHADE_FRACTION = 0.34;

/**
 * The board swings on its two eyes, so the sway is a rotation about the bracket
 * tip rather than a slide. A whole degree is far too much at 32 px a tile — the
 * board's bottom corner would travel a pixel and a half and read as a wobble
 * rather than as weight.
 */
const SWAY_AMPLITUDE_RAD = 0.045;
const SWAY_PERIOD_FRAMES = 190;
/**
 * Phase step between consecutive signs, so the town's fifteen boards do not
 * swing as one.
 *
 * The golden angle rather than a round number of radians. An earlier 0.7 rad
 * read as well spread and was not: nine steps of it come within 0.017 rad of a
 * full turn, so signs 0 and 9 differed by 0.03 px of board travel — identical on
 * screen. Measured over fifteen signs, the golden angle's closest pair is 3.44%
 * of a period apart against 0.27% for the old stride.
 */
export const SIGN_SWAY_PHASE_STRIDE_RAD = GOLDEN_ANGLE_RAD;

/**
 * How far west of the door tile a sign is shifted, in tiles, for an opening
 * `doorwayWidth` tiles wide.
 *
 * `SpriteLoader.computeDoorway` puts the door tile at `dx0 + floor((w-1)/2)`, so
 * the opening reaches exactly that many tiles west of it. Shifting the sign by
 * the same amount therefore gives every building the *same* geometry relative to
 * its opening's west edge, whatever its width — rather than leaving a wide front
 * with its sign over the middle of its own doorway.
 *
 * Measured over the thirteen sprites the town uses: six openings are one tile
 * wide, five are two, the General Store is three and The Horned Flagon is four.
 * Only the last two shift, by one tile each.
 */
export function signWestShiftTiles(doorwayWidth: number): number {
  return Math.floor((doorwayWidth - 1) / 2);
}

const BRACKET_IRON = '#3a3630';
const BRACKET_IRON_LIGHT = '#585149';
const BOARD_FACE = '#8d6a3f';
const BOARD_SHADE = 'rgba(0,0,0,0.22)';

/** Emblem colours, shared so fifteen small devices read as one signwriter's work. */
const GOLD = '#d8b45a';
const GOLD_DARK = '#a8842f';
const IRON = '#8d949c';
const IRON_DARK = '#5b6169';
const CREAM = '#e9dcc0';
const BLOOD = '#a83a3a';
const LEAF = '#6f8f45';
const SKY = '#7fb0d8';
const EMBER = '#e08a3c';

/**
 * The box an emblem is drawn inside: the board's face, inset by its frame. Every
 * painter works in this box so a device can be retuned without touching the
 * board, and so all fifteen come out the same size.
 */
interface EmblemBox {
  readonly cx: number;
  readonly cy: number;
  /** Half-width and half-height of the drawable area, in pixels. */
  readonly rx: number;
  readonly ry: number;
}

type EmblemPainter = (ctx: CanvasRenderingContext2D, box: EmblemBox) => void;

function fillCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fill();
}

function strokeRound(ctx: CanvasRenderingContext2D, width: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/** A waxing crescent: a disc with a second disc bitten out of its east side. */
const MOON_RADIUS_FRACTION = 0.92;
const MOON_BITE_OFFSET_FRACTION = 0.62;

const drawMoon: EmblemPainter = (ctx, box) => {
  const r = box.ry * MOON_RADIUS_FRACTION;
  const biteX = box.cx + r * MOON_BITE_OFFSET_FRACTION;
  // A crescent is one disc *minus* another, which even-odd over two discs does
  // not give you — it fills the symmetric difference, so the earlier version
  // drew both limbs and read as an eclipse. Clipping to "the box, minus the bite
  // disc" is the subtraction, and unlike overpainting the bite in the board's
  // colour it does not have to know what is underneath.
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.cx - box.rx, box.cy - box.ry, box.rx * 2, box.ry * 2);
  ctx.moveTo(biteX + r, box.cy);
  ctx.arc(biteX, box.cy, r, 0, TWO_PI);
  ctx.clip('evenodd');
  ctx.fillStyle = CREAM;
  fillCircle(ctx, box.cx, box.cy, r);
  ctx.restore();
};

const FLEECE_LOBES: ReadonlyArray<readonly [number, number, number]> = [
  [-0.5, -0.1, 0.5],
  [0.1, -0.34, 0.52],
  [0.55, 0.06, 0.44],
  [-0.06, 0.34, 0.5],
];
const FLEECE_FACE_DX = -0.78;
const FLEECE_FACE_DY = 0.2;
const FLEECE_FACE_RADIUS = 0.3;

const drawFleece: EmblemPainter = (ctx, box) => {
  ctx.fillStyle = CREAM;
  for (const [dx, dy, r] of FLEECE_LOBES) {
    fillCircle(ctx, box.cx + box.rx * dx, box.cy + box.ry * dy, box.ry * r);
  }
  ctx.fillStyle = IRON_DARK;
  fillCircle(
    ctx,
    box.cx + box.rx * FLEECE_FACE_DX,
    box.cy + box.ry * FLEECE_FACE_DY,
    box.ry * FLEECE_FACE_RADIUS,
  );
};

const SHIELD_TOP = -0.95;
const SHIELD_SHOULDER = -0.35;
const SHIELD_HALF_WIDTH = 0.72;
const SHIELD_POINT = 1.0;
const SHIELD_BAND_HEIGHT = 0.24;

const drawShield: EmblemPainter = (ctx, box) => {
  const halfWidth = box.rx * SHIELD_HALF_WIDTH;
  ctx.fillStyle = IRON;
  ctx.beginPath();
  ctx.moveTo(box.cx - halfWidth, box.cy + box.ry * SHIELD_TOP);
  ctx.lineTo(box.cx + halfWidth, box.cy + box.ry * SHIELD_TOP);
  ctx.lineTo(box.cx + halfWidth, box.cy + box.ry * SHIELD_SHOULDER);
  ctx.quadraticCurveTo(
    box.cx + halfWidth,
    box.cy + box.ry * SHIELD_POINT,
    box.cx,
    box.cy + box.ry * SHIELD_POINT,
  );
  ctx.quadraticCurveTo(
    box.cx - halfWidth,
    box.cy + box.ry * SHIELD_POINT,
    box.cx - halfWidth,
    box.cy + box.ry * SHIELD_SHOULDER,
  );
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BLOOD;
  ctx.fillRect(
    box.cx - halfWidth,
    box.cy - box.ry * SHIELD_BAND_HEIGHT,
    halfWidth * 2,
    box.ry * SHIELD_BAND_HEIGHT * 2,
  );
};

const WHEEL_RIM_FRACTION = 0.96;
const WHEEL_HUB_FRACTION = 0.2;
/**
 * Each iteration strokes a full **diameter** across a half-turn sweep, so this is
 * the number of spoke *pairs*: six here is twelve spokes on the wheel.
 */
const WHEEL_DIAMETER_COUNT = 6;
const WHEEL_RIM_WIDTH_PX = 3;
const WHEEL_SPOKE_WIDTH_PX = 2;

const drawWheel: EmblemPainter = (ctx, box) => {
  const r = box.ry * WHEEL_RIM_FRACTION;
  strokeRound(ctx, WHEEL_SPOKE_WIDTH_PX, GOLD_DARK);
  for (let spoke = 0; spoke < WHEEL_DIAMETER_COUNT; spoke++) {
    const angle = (spoke / WHEEL_DIAMETER_COUNT) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(box.cx - Math.cos(angle) * r, box.cy - Math.sin(angle) * r);
    ctx.lineTo(box.cx + Math.cos(angle) * r, box.cy + Math.sin(angle) * r);
    ctx.stroke();
  }
  strokeRound(ctx, WHEEL_RIM_WIDTH_PX, GOLD);
  ctx.beginPath();
  ctx.arc(box.cx, box.cy, r, 0, TWO_PI);
  ctx.stroke();
  ctx.fillStyle = GOLD_DARK;
  fillCircle(ctx, box.cx, box.cy, box.ry * WHEEL_HUB_FRACTION);
};

const SUN_CORE_FRACTION = 0.44;
const SUN_RAY_COUNT = 8;
const SUN_RAY_INNER = 0.58;
const SUN_RAY_OUTER = 1.0;
const SUN_RAY_WIDTH_PX = 2;

const drawSun: EmblemPainter = (ctx, box) => {
  strokeRound(ctx, SUN_RAY_WIDTH_PX, GOLD);
  for (let ray = 0; ray < SUN_RAY_COUNT; ray++) {
    const angle = (ray / SUN_RAY_COUNT) * TWO_PI;
    ctx.beginPath();
    ctx.moveTo(
      box.cx + Math.cos(angle) * box.ry * SUN_RAY_INNER,
      box.cy + Math.sin(angle) * box.ry * SUN_RAY_INNER,
    );
    ctx.lineTo(
      box.cx + Math.cos(angle) * box.ry * SUN_RAY_OUTER,
      box.cy + Math.sin(angle) * box.ry * SUN_RAY_OUTER,
    );
    ctx.stroke();
  }
  ctx.fillStyle = GOLD;
  fillCircle(ctx, box.cx, box.cy, box.ry * SUN_CORE_FRACTION);
  ctx.fillStyle = SKY;
  fillCircle(ctx, box.cx, box.cy, box.ry * SUN_CORE_FRACTION * 0.5);
};

const MORTAR_BOWL_TOP = 0.0;
const MORTAR_BOWL_BOTTOM = 0.86;
const MORTAR_BOWL_HALF_TOP = 0.7;
const MORTAR_BOWL_HALF_BOTTOM = 0.42;
const MORTAR_LIP_HEIGHT = 0.16;
const PESTLE_WIDTH_PX = 3;
const PESTLE_TOP = -0.94;
const PESTLE_TIP = 0.2;
const PESTLE_LEAN = 0.5;

const drawMortar: EmblemPainter = (ctx, box) => {
  strokeRound(ctx, PESTLE_WIDTH_PX, CREAM);
  ctx.beginPath();
  ctx.moveTo(box.cx + box.rx * PESTLE_LEAN, box.cy + box.ry * PESTLE_TOP);
  ctx.lineTo(box.cx - box.rx * PESTLE_LEAN * 0.3, box.cy + box.ry * PESTLE_TIP);
  ctx.stroke();

  ctx.fillStyle = IRON;
  ctx.beginPath();
  ctx.moveTo(box.cx - box.rx * MORTAR_BOWL_HALF_TOP, box.cy + box.ry * MORTAR_BOWL_TOP);
  ctx.lineTo(box.cx + box.rx * MORTAR_BOWL_HALF_TOP, box.cy + box.ry * MORTAR_BOWL_TOP);
  ctx.lineTo(box.cx + box.rx * MORTAR_BOWL_HALF_BOTTOM, box.cy + box.ry * MORTAR_BOWL_BOTTOM);
  ctx.lineTo(box.cx - box.rx * MORTAR_BOWL_HALF_BOTTOM, box.cy + box.ry * MORTAR_BOWL_BOTTOM);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(
    box.cx - box.rx * MORTAR_BOWL_HALF_TOP,
    box.cy + box.ry * MORTAR_BOWL_TOP,
    box.rx * MORTAR_BOWL_HALF_TOP * 2,
    box.ry * MORTAR_LIP_HEIGHT,
  );
};

/**
 * A barrel, seen from the side: staves, two hoops, a lid.
 *
 * The General Store's device was a balance scale, and a balance is a beam, two
 * chains and two pans — all of it line work a couple of pixels wide. At the 18 px
 * the emblem box actually gets, every one of those lines collapsed and what
 * survived was the post and the beam: a capital T. A barrel is one bold mass with
 * a curved silhouette and two dark bands across it, which is the kind of shape
 * that still says something at that size.
 */
const BARREL_HALF_WIDTH = 0.62;
const BARREL_TOP = -0.86;
const BARREL_BOTTOM = 0.88;
const BARREL_BULGE = 0.24;
const BARREL_HOOP_FRACTIONS = [0.24, 0.72] as const;
const BARREL_HOOP_HEIGHT = 0.13;
const BARREL_LID_HEIGHT = 0.16;

const drawBarrel: EmblemPainter = (ctx, box) => {
  const top = box.cy + box.ry * BARREL_TOP;
  const bottom = box.cy + box.ry * BARREL_BOTTOM;
  const half = box.rx * BARREL_HALF_WIDTH;
  const bulge = box.rx * BARREL_BULGE;

  ctx.fillStyle = EMBER;
  ctx.beginPath();
  ctx.moveTo(box.cx - half, top);
  ctx.quadraticCurveTo(box.cx - half - bulge, box.cy, box.cx - half, bottom);
  ctx.lineTo(box.cx + half, bottom);
  ctx.quadraticCurveTo(box.cx + half + bulge, box.cy, box.cx + half, top);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = GOLD_DARK;
  ctx.fillRect(box.cx - half, top, half * 2, box.ry * BARREL_LID_HEIGHT);
  ctx.fillStyle = IRON_DARK;
  for (const fraction of BARREL_HOOP_FRACTIONS) {
    ctx.fillRect(
      box.cx - half - bulge,
      top + (bottom - top) * fraction,
      (half + bulge) * 2,
      box.ry * BARREL_HOOP_HEIGHT,
    );
  }
};

const BED_FRAME_TOP = -0.24;
const BED_FRAME_BOTTOM = 0.5;
const BED_HALF_WIDTH = 0.86;
const BED_HEADBOARD_TOP = -0.78;
const BED_HEADBOARD_WIDTH_PX = 3;
const BED_PILLOW_HALF = 0.24;
const BED_LEG_HEIGHT = 0.3;
const BED_LEG_WIDTH_PX = 3;

const drawBed: EmblemPainter = (ctx, box) => {
  const half = box.rx * BED_HALF_WIDTH;
  const top = box.cy + box.ry * BED_FRAME_TOP;
  const bottom = box.cy + box.ry * BED_FRAME_BOTTOM;
  ctx.fillStyle = GOLD_DARK;
  ctx.fillRect(box.cx - half, top, half * 2, bottom - top);
  ctx.fillRect(
    box.cx - half,
    box.cy + box.ry * BED_HEADBOARD_TOP,
    BED_HEADBOARD_WIDTH_PX,
    top - box.cy - box.ry * BED_HEADBOARD_TOP,
  );
  ctx.fillRect(box.cx - half, bottom, BED_LEG_WIDTH_PX, box.ry * BED_LEG_HEIGHT);
  ctx.fillRect(box.cx + half - BED_LEG_WIDTH_PX, bottom, BED_LEG_WIDTH_PX, box.ry * BED_LEG_HEIGHT);
  ctx.fillStyle = CREAM;
  ctx.fillRect(
    box.cx - half + BED_HEADBOARD_WIDTH_PX,
    top,
    box.rx * BED_PILLOW_HALF * 2,
    (bottom - top) * 0.6,
  );
};

/**
 * A drinking horn: wide mouth at the upper left, tapering to a point at the
 * lower right. Drawn as a closed silhouette between two curves rather than as a
 * stroked line, because a constant-width stroke has no taper and read as a boot.
 */
const HORN_MOUTH_X = -0.8;
const HORN_MOUTH_TOP_Y = -0.86;
const HORN_MOUTH_BOTTOM_Y = -0.18;
const HORN_TIP_X = 0.92;
const HORN_TIP_Y = 0.86;
const HORN_OUTER_BOW_X = -0.62;
const HORN_OUTER_BOW_Y = 0.94;
const HORN_INNER_BOW_X = 0.12;
const HORN_INNER_BOW_Y = 0.16;
const HORN_BAND_WIDTH_PX = 3;

const drawHorn: EmblemPainter = (ctx, box) => {
  const mouthX = box.cx + box.rx * HORN_MOUTH_X;
  const mouthTopY = box.cy + box.ry * HORN_MOUTH_TOP_Y;
  const mouthBottomY = box.cy + box.ry * HORN_MOUTH_BOTTOM_Y;
  ctx.fillStyle = CREAM;
  ctx.beginPath();
  ctx.moveTo(mouthX, mouthTopY);
  ctx.quadraticCurveTo(
    box.cx + box.rx * HORN_INNER_BOW_X,
    box.cy + box.ry * HORN_INNER_BOW_Y,
    box.cx + box.rx * HORN_TIP_X,
    box.cy + box.ry * HORN_TIP_Y,
  );
  ctx.quadraticCurveTo(
    box.cx + box.rx * HORN_OUTER_BOW_X,
    box.cy + box.ry * HORN_OUTER_BOW_Y,
    mouthX,
    mouthBottomY,
  );
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.fillRect(mouthX, mouthTopY, HORN_BAND_WIDTH_PX, mouthBottomY - mouthTopY);
};

const CAULDRON_BELLY_CY = 0.24;
const CAULDRON_BELLY_RX = 0.78;
const CAULDRON_BELLY_RY = 0.62;
const CAULDRON_RIM_HEIGHT = 0.16;
const CAULDRON_LEG_SPREAD = 0.42;
const CAULDRON_LEG_WIDTH_PX = 3;
const CAULDRON_LEG_HEIGHT = 0.22;
const CAULDRON_BREW_INSET = 0.18;

const drawCauldron: EmblemPainter = (ctx, box) => {
  const bellyY = box.cy + box.ry * CAULDRON_BELLY_CY;
  ctx.fillStyle = IRON_DARK;
  for (const dir of MIRRORED_SIDES) {
    ctx.fillRect(
      box.cx + dir * box.rx * CAULDRON_LEG_SPREAD - CAULDRON_LEG_WIDTH_PX / 2,
      bellyY + box.ry * CAULDRON_BELLY_RY * 0.6,
      CAULDRON_LEG_WIDTH_PX,
      box.ry * CAULDRON_LEG_HEIGHT,
    );
  }
  ctx.beginPath();
  ctx.ellipse(box.cx, bellyY, box.rx * CAULDRON_BELLY_RX, box.ry * CAULDRON_BELLY_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = IRON;
  ctx.fillRect(
    box.cx - box.rx * CAULDRON_BELLY_RX,
    bellyY - box.ry * CAULDRON_BELLY_RY,
    box.rx * CAULDRON_BELLY_RX * 2,
    box.ry * CAULDRON_RIM_HEIGHT,
  );
  ctx.fillStyle = LEAF;
  ctx.beginPath();
  ctx.ellipse(
    box.cx,
    bellyY - box.ry * CAULDRON_BELLY_RY + box.ry * CAULDRON_RIM_HEIGHT,
    box.rx * (CAULDRON_BELLY_RX - CAULDRON_BREW_INSET),
    box.ry * CAULDRON_RIM_HEIGHT,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
};

/**
 * A smith's hammer: a heavy head on a haft, laid on the diagonal.
 *
 * **This is the third device on The Rusty Anvil's sign, and the first that reads
 * at the size it is drawn.** An anvil is a face, a horn, a waist and a foot — and
 * a symmetric face over a symmetric foot is a capital T whatever happens between
 * them, which is what two attempts at it produced. The horn is the only cue that
 * distinguishes the shape and it is the first thing to vanish at 18 px.
 *
 * A hammer needs no fine detail: a thick bar and a thin one, crossing at an angle,
 * with the mass all at one end. That asymmetry survives being three pixels wide.
 */
const HAMMER_ANGLE_RAD = -0.5;
const HAMMER_HAFT_HALF_LENGTH = 0.92;
const HAMMER_HAFT_WIDTH_PX = 4;
const HAMMER_HEAD_HALF_LENGTH = 0.46;
const HAMMER_HEAD_HALF_DEPTH = 0.28;
/** The head sits at the haft's far end rather than across its middle. */
const HAMMER_HEAD_OFFSET = 0.6;
/** The peen: the head's narrow end, which is what makes it a hammer not a mallet. */
const HAMMER_PEEN_LENGTH = 0.3;
const HAMMER_PEEN_HALF_DEPTH = 0.12;

const drawHammer: EmblemPainter = (ctx, box) => {
  ctx.save();
  ctx.translate(box.cx, box.cy);
  ctx.rotate(HAMMER_ANGLE_RAD);

  const haftLength = box.rx * HAMMER_HAFT_HALF_LENGTH;
  ctx.fillStyle = GOLD_DARK;
  ctx.fillRect(-haftLength, -HAMMER_HAFT_WIDTH_PX / 2, haftLength * 2, HAMMER_HAFT_WIDTH_PX);

  const headCentre = box.rx * HAMMER_HEAD_OFFSET;
  const headHalf = box.rx * HAMMER_HEAD_HALF_LENGTH;
  const headDepth = box.ry * HAMMER_HEAD_HALF_DEPTH;
  ctx.fillStyle = IRON;
  ctx.fillRect(headCentre - headHalf, -headDepth, headHalf * 2, headDepth * 2);
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(
    headCentre - headHalf - box.rx * HAMMER_PEEN_LENGTH,
    -box.ry * HAMMER_PEEN_HALF_DEPTH,
    box.rx * HAMMER_PEEN_LENGTH,
    box.ry * HAMMER_PEEN_HALF_DEPTH * 2,
  );
  ctx.restore();
};

const TANKARD_BODY_HALF = 0.5;
const TANKARD_TOP = -0.62;
const TANKARD_BOTTOM = 0.86;
const TANKARD_HANDLE_WIDTH_PX = 3;
const TANKARD_HANDLE_REACH = 0.42;
const TANKARD_FOAM_HEIGHT = 0.3;

const drawTankard: EmblemPainter = (ctx, box) => {
  const left = box.cx - box.rx * TANKARD_BODY_HALF;
  const right = box.cx + box.rx * TANKARD_BODY_HALF;
  const top = box.cy + box.ry * TANKARD_TOP;
  const bottom = box.cy + box.ry * TANKARD_BOTTOM;
  strokeRound(ctx, TANKARD_HANDLE_WIDTH_PX, IRON);
  ctx.beginPath();
  ctx.moveTo(right, top + (bottom - top) * 0.25);
  ctx.quadraticCurveTo(
    right + box.rx * TANKARD_HANDLE_REACH,
    (top + bottom) / 2,
    right,
    bottom - (bottom - top) * 0.2,
  );
  ctx.stroke();
  ctx.fillStyle = EMBER;
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.fillStyle = CREAM;
  ctx.fillRect(
    left,
    top - box.ry * TANKARD_FOAM_HEIGHT,
    right - left,
    box.ry * TANKARD_FOAM_HEIGHT,
  );
};

/**
 * A quill: a solid vane down one side of the shaft, and an ink-dark nib.
 *
 * Comb-tooth barbs are what a feather looks like drawn large; at 26 px they came
 * out as evenly spaced ticks along a diagonal and the device read as a ruler.
 * A filled vane has the one silhouette cue that matters at this size — wide at
 * the top, tapering to nothing at the nib.
 */
const QUILL_NIB_X = -0.66;
const QUILL_NIB_Y = 0.92;
const QUILL_TOP_X = 0.7;
const QUILL_TOP_Y = -0.94;
const QUILL_SHAFT_WIDTH_PX = 2;
const QUILL_VANE_BOW_X = -0.5;
const QUILL_VANE_BOW_Y = -0.5;
const QUILL_VANE_SPLIT = 0.3;
const QUILL_NIB_LENGTH = 0.26;
const QUILL_NIB_WIDTH_PX = 3;

const drawQuill: EmblemPainter = (ctx, box) => {
  const nibX = box.cx + box.rx * QUILL_NIB_X;
  const nibY = box.cy + box.ry * QUILL_NIB_Y;
  const topX = box.cx + box.rx * QUILL_TOP_X;
  const topY = box.cy + box.ry * QUILL_TOP_Y;
  const splitX = topX + (nibX - topX) * QUILL_VANE_SPLIT;
  const splitY = topY + (nibY - topY) * QUILL_VANE_SPLIT;

  ctx.fillStyle = CREAM;
  ctx.beginPath();
  ctx.moveTo(topX, topY);
  ctx.quadraticCurveTo(
    box.cx + box.rx * QUILL_VANE_BOW_X,
    box.cy + box.ry * QUILL_VANE_BOW_Y,
    nibX,
    nibY,
  );
  ctx.lineTo(splitX, splitY);
  ctx.closePath();
  ctx.fill();

  strokeRound(ctx, QUILL_SHAFT_WIDTH_PX, GOLD_DARK);
  ctx.beginPath();
  ctx.moveTo(topX, topY);
  ctx.lineTo(nibX, nibY);
  ctx.stroke();

  strokeRound(ctx, QUILL_NIB_WIDTH_PX, IRON_DARK);
  ctx.beginPath();
  ctx.moveTo(nibX + (topX - nibX) * QUILL_NIB_LENGTH, nibY + (topY - nibY) * QUILL_NIB_LENGTH);
  ctx.lineTo(nibX, nibY);
  ctx.stroke();
};

const CARD_HALF_WIDTH = 0.34;
const CARD_HALF_HEIGHT = 0.66;
const CARD_LEAN_RAD = 0.28;
const CARD_OFFSET = 0.3;
const CARD_PIP_RADIUS = 0.16;

const drawCards: EmblemPainter = (ctx, box) => {
  for (const dir of MIRRORED_SIDES) {
    ctx.save();
    ctx.translate(box.cx + dir * box.rx * CARD_OFFSET, box.cy);
    ctx.rotate(dir * CARD_LEAN_RAD);
    ctx.fillStyle = CREAM;
    ctx.fillRect(
      -box.rx * CARD_HALF_WIDTH,
      -box.ry * CARD_HALF_HEIGHT,
      box.rx * CARD_HALF_WIDTH * 2,
      box.ry * CARD_HALF_HEIGHT * 2,
    );
    ctx.fillStyle = dir < 0 ? IRON_DARK : BLOOD;
    fillCircle(ctx, 0, 0, box.ry * CARD_PIP_RADIUS);
    ctx.restore();
  }
};

const SHEAF_STALK_COUNT = 5;
const SHEAF_SPREAD = 0.72;
const SHEAF_TOP = -0.92;
const SHEAF_BOTTOM = 0.92;
const SHEAF_STALK_WIDTH_PX = 2;
const SHEAF_EAR_RADIUS = 0.16;
const SHEAF_BAND_Y = 0.36;
const SHEAF_BAND_HEIGHT_PX = 3;
const SHEAF_BAND_HALF = 0.34;

const drawSheaf: EmblemPainter = (ctx, box) => {
  strokeRound(ctx, SHEAF_STALK_WIDTH_PX, GOLD_DARK);
  for (let stalk = 0; stalk < SHEAF_STALK_COUNT; stalk++) {
    const spread = (stalk / (SHEAF_STALK_COUNT - 1) - 0.5) * 2 * SHEAF_SPREAD;
    const topX = box.cx + box.rx * spread;
    ctx.beginPath();
    ctx.moveTo(box.cx, box.cy + box.ry * SHEAF_BOTTOM);
    ctx.lineTo(topX, box.cy + box.ry * SHEAF_TOP);
    ctx.stroke();
    ctx.fillStyle = GOLD;
    fillCircle(ctx, topX, box.cy + box.ry * SHEAF_TOP, box.ry * SHEAF_EAR_RADIUS);
  }
  ctx.fillStyle = BLOOD;
  ctx.fillRect(
    box.cx - box.rx * SHEAF_BAND_HALF,
    box.cy + box.ry * SHEAF_BAND_Y,
    box.rx * SHEAF_BAND_HALF * 2,
    SHEAF_BAND_HEIGHT_PX,
  );
};

/**
 * Every device, keyed by the plan's own union. A `Record` rather than a switch
 * so adding an emblem to `ShopSignEmblem` without drawing it fails to compile.
 */
const EMBLEM_PAINTERS: Record<ShopSignEmblem, EmblemPainter> = {
  moon: drawMoon,
  fleece: drawFleece,
  shield: drawShield,
  wheel: drawWheel,
  sun: drawSun,
  mortar: drawMortar,
  barrel: drawBarrel,
  bed: drawBed,
  horn: drawHorn,
  cauldron: drawCauldron,
  hammer: drawHammer,
  tankard: drawTankard,
  quill: drawQuill,
  cards: drawCards,
  sheaf: drawSheaf,
};

/**
 * How many distinct angles a sign board is drawn at across its swing. The whole
 * swing is 0.045 rad — the board's far corner travels about 1.5 px end to end —
 * so four steps are already finer than a pixel, and each extra step is another
 * baked canvas per sign.
 */
export const SIGN_SWAY_STEPS = 4;

/**
 * The sign's swing at `frame`, snapped to one of `SIGN_SWAY_STEPS` angles.
 * Returns the step index and the rotation to draw it with.
 */
export function shopSignSway(frame: number, swayPhase: number): { step: number; sway: number } {
  const wave = Math.sin((frame / SWAY_PERIOD_FRAMES) * TWO_PI + swayPhase);
  const normalized = (wave + 1) / 2;
  const step = Math.min(SIGN_SWAY_STEPS - 1, Math.floor(normalized * SIGN_SWAY_STEPS));
  const steppedWave = (step / (SIGN_SWAY_STEPS - 1)) * 2 - 1;
  return { step, sway: steppedWave * SWAY_AMPLITUDE_RAD };
}

/**
 * Draws the bracket and the swinging board for one shop sign.
 *
 * `sx`/`sy` are the screen position of the sign's **anchor tile** — the door
 * tile — and everything is drawn above it. `swayPhase` is a per-building phase
 * offset in radians so the town's fifteen signs do not swing in lockstep.
 */
export function drawShopSign(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  emblem: ShopSignEmblem,
  sway: number,
  westShiftTiles = 0,
): void {
  // `strokeRound` sets lineCap, lineJoin and lineWidth, and the emblem painters
  // set fill and stroke styles. Props are rendered back to back with no reset
  // between them, so anything left behind here is inherited by whatever draws
  // next — the clutter on this building's own frontage sorts immediately after
  // its sign.
  ctx.save();
  const shift = ts * westShiftTiles;
  const rootX = sx + ts * BRACKET_ROOT_X - shift;
  const tipX = sx + ts * BRACKET_TIP_X - shift;
  const armY = sy + ts * BRACKET_ARM_Y;

  // The stay braces the arm's near half and is drawn in the darker iron, so the
  // arm stays the dominant line. Drawn the other way round — a full-length stay
  // in the lighter tone — it out-read the arm and the whole bracket looked like a
  // stray diagonal with a board floating off one end.
  const stayRootY = sy + ts * BRACKET_STAY_ROOT_Y;
  strokeRound(ctx, BRACKET_THICKNESS_PX, BRACKET_IRON);
  ctx.beginPath();
  ctx.moveTo(rootX, stayRootY);
  ctx.lineTo(rootX + (tipX - rootX) * BRACKET_STAY_REACH, armY);
  ctx.stroke();

  ctx.fillStyle = BRACKET_IRON_LIGHT;
  ctx.fillRect(tipX, armY, rootX - tipX, BRACKET_THICKNESS_PX);
  ctx.fillRect(rootX - BRACKET_THICKNESS_PX, armY, BRACKET_THICKNESS_PX, stayRootY - armY);

  ctx.save();
  ctx.translate(tipX, armY);
  ctx.rotate(sway);

  const boardTop = ts * (BOARD_TOP - BRACKET_ARM_Y);
  ctx.fillStyle = BRACKET_IRON;
  for (const dir of MIRRORED_SIDES) {
    ctx.fillRect(
      dir * ts * HANGER_SPREAD - HANGER_THICKNESS_PX / 2,
      0,
      HANGER_THICKNESS_PX,
      boardTop,
    );
  }

  const boardHeight = ts * (BOARD_BOTTOM - BOARD_TOP);
  const boardHalf = ts * BOARD_HALF_WIDTH;
  ctx.fillStyle = WOOD_DARK;
  roundedRect(ctx, -boardHalf, boardTop, boardHalf * 2, boardHeight, BOARD_CORNER_PX);
  ctx.fill();
  ctx.fillStyle = BOARD_FACE;
  roundedRect(
    ctx,
    -boardHalf + BOARD_FRAME_PX,
    boardTop + BOARD_FRAME_PX,
    boardHalf * 2 - BOARD_FRAME_PX * 2,
    boardHeight - BOARD_FRAME_PX * 2,
    BOARD_CORNER_PX,
  );
  ctx.fill();

  // The wash goes under the emblem, not over it. Painted last it reads as depth
  // on an empty board and as a stain across the bottom third of a device — it
  // took the foot clean off the smith's mark, on the one sign whose whole job is
  // to say "blacksmith" from across the street.
  ctx.fillStyle = BOARD_SHADE;
  roundedRect(
    ctx,
    -boardHalf,
    boardTop + boardHeight * (1 - BOARD_SHADE_FRACTION),
    boardHalf * 2,
    boardHeight * BOARD_SHADE_FRACTION,
    BOARD_CORNER_PX,
  );
  ctx.fill();

  EMBLEM_PAINTERS[emblem](ctx, {
    cx: 0,
    cy: boardTop + boardHeight / 2,
    rx: boardHalf - BOARD_FRAME_PX * 2,
    ry: boardHeight / 2 - BOARD_FRAME_PX * 2,
  });

  ctx.restore();
  ctx.restore();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
