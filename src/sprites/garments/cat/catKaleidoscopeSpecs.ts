/**
 * The Kaleidoscope Specs on the cat crawler: round wire-rimmed glasses whose
 * lenses are cut like prisms, each one banded through the spectrum and
 * throwing little coloured sparks onto the fur beside it.
 *
 * At her in-game size a lens is three or four screen pixels across, so the
 * spectrum is cut down to the three hard bands that survive there (cyan,
 * magenta, gold) and the sparks are single saturated points: subtler
 * iridescence greys out into her coat.
 */

import type { CatHeadFrame } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { SILVER } from './metalInk';
import {
  BACK_ARM_SPREAD,
  CAT_LENS_RADIUS,
  lensCentres,
  PROFILE_LENS_SQUASH,
  PROFILE_LENS_TILT,
  SIDE_TEMPLE,
  strokeLine,
  templePoint,
} from './faceWear';

type Ctx = CanvasRenderingContext2D;
type Pt = { readonly x: number; readonly y: number };

const FULL_TURN = Math.PI * 2;

/** Silver wire: a dark rim vanishes on a black cat and leaves only the lenses, which read as glowing eyes. */
const RIM_WIRE = SILVER.light;
/**
 * The spectrum each lens is banded through, upper-left to lower-right, as
 * shares of the lens. The magenta is kept narrow: as wide as the others it
 * fills the middle pixel and the lenses read as glowing pink eyes.
 */
const PRISM_BANDS = [
  { colour: '#7ff4ff', from: 0, to: 0.38 },
  { colour: '#ff4fd8', from: 0.44, to: 0.56 },
  { colour: '#ffd23a', from: 0.62, to: 1 },
] as const;
const SPARK_WHITE = '#ffffff';
/** The colours the lenses throw onto her fur: one spark of each beside every lens. */
const SPARK_COLOURS = ['#5cf0ff', '#ff5ce0', '#ffe04a'] as const;

const RIM_WIDTH = 0.024;
const ARM_WIDTH = 0.018;
/** How far the bridge rises above the lens centres, as a share of a lens radius. */
const BRIDGE_RISE = 1.1;
/** Where the bridge leaves each rim, as a share of a lens radius in from its inner edge. */
const BRIDGE_INSET = 0.25;

const GLINT_OFFSET = 0.38;
const GLINT_LENGTH = 0.5;
const GLINT_WAIST = 0.18;
const GLINT_ARMS = 4;

/** Where the thrown sparks land round a lens, as an angle and a reach in lens radii. */
const SPARK_SPOTS: readonly { readonly angle: number; readonly reach: number }[] = [
  { angle: -2.3, reach: 1.4 },
  { angle: -0.6, reach: 1.4 },
  { angle: 2.5, reach: 1.35 },
];
const SPARK_RADIUS = 0.016;

/** From behind, the arms show as short strokes where they hook over her ears. */
const BACK_ARM_LENGTH = 0.07;
const BACK_ARM_RISE = 0.025;

function prismFill(ctx: Ctx, r: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(-r, -r, r, r);
  for (const band of PRISM_BANDS) {
    gradient.addColorStop(band.from, band.colour);
    gradient.addColorStop(band.to, band.colour);
  }
  return gradient;
}

function paintGlint(ctx: Ctx, r: number): void {
  const x = -r * GLINT_OFFSET;
  const y = -r * GLINT_OFFSET;
  const reach = r * GLINT_LENGTH;
  ctx.beginPath();
  for (let arm = 0; arm < GLINT_ARMS * 2; arm++) {
    const angle = (arm / (GLINT_ARMS * 2)) * FULL_TURN;
    const length = arm % 2 === 0 ? reach : reach * GLINT_WAIST;
    const px = x + Math.cos(angle) * length;
    const py = y + Math.sin(angle) * length;
    if (arm === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = SPARK_WHITE;
  ctx.fill();
}

function paintLens(ctx: Ctx, at: Pt, squash: number, tilt: number, glint: boolean): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(tilt);
  ctx.scale(squash, 1);
  ctx.beginPath();
  ctx.arc(0, 0, CAT_LENS_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = prismFill(ctx, CAT_LENS_RADIUS);
  ctx.fill();
  ctx.strokeStyle = RIM_WIRE;
  ctx.lineWidth = RIM_WIDTH;
  ctx.stroke();
  if (glint) paintGlint(ctx, CAT_LENS_RADIUS);
  ctx.restore();
}

/** The coloured points of light the prisms throw onto the fur round a lens. */
function paintSparks(ctx: Ctx, at: Pt, mirror: number): void {
  SPARK_SPOTS.forEach((spot, index) => {
    const colour = SPARK_COLOURS[index % SPARK_COLOURS.length];
    const x = at.x + mirror * Math.cos(spot.angle) * CAT_LENS_RADIUS * spot.reach;
    const y = at.y + Math.sin(spot.angle) * CAT_LENS_RADIUS * spot.reach;
    ctx.beginPath();
    ctx.arc(x, y, SPARK_RADIUS, 0, FULL_TURN);
    ctx.fillStyle = colour;
    ctx.fill();
  });
}

function paintFront(ctx: Ctx, frame: CatHeadFrame): void {
  if (frame.piece !== 'features') return;
  const lenses = lensCentres(frame.landmarks, false);
  if (lenses.length < 2) return;
  const [left, right] = lenses;
  strokeLine(
    ctx,
    { x: left.x - CAT_LENS_RADIUS, y: left.y },
    templePoint(frame.landmarks, -1),
    RIM_WIRE,
    ARM_WIDTH,
  );
  strokeLine(
    ctx,
    { x: right.x + CAT_LENS_RADIUS, y: right.y },
    templePoint(frame.landmarks, 1),
    RIM_WIRE,
    ARM_WIDTH,
  );
  const bridgeY = left.y - CAT_LENS_RADIUS * BRIDGE_INSET;
  ctx.beginPath();
  ctx.moveTo(left.x + CAT_LENS_RADIUS * (1 - BRIDGE_INSET), bridgeY);
  ctx.quadraticCurveTo(
    (left.x + right.x) / 2,
    left.y - CAT_LENS_RADIUS * BRIDGE_RISE,
    right.x - CAT_LENS_RADIUS * (1 - BRIDGE_INSET),
    bridgeY,
  );
  ctx.strokeStyle = RIM_WIRE;
  ctx.lineWidth = ARM_WIDTH;
  ctx.stroke();
  paintSparks(ctx, left, 1);
  paintSparks(ctx, right, -1);
  paintLens(ctx, left, 1, 0, true);
  paintLens(ctx, right, 1, 0, false);
}

function paintSide(ctx: Ctx, frame: CatHeadFrame): void {
  if (frame.piece !== 'features') return;
  const lenses = lensCentres(frame.landmarks, true);
  if (lenses.length === 0) return;
  const [lens] = lenses;
  strokeLine(
    ctx,
    { x: lens.x, y: lens.y - CAT_LENS_RADIUS * BRIDGE_INSET },
    SIDE_TEMPLE,
    RIM_WIRE,
    ARM_WIDTH,
  );
  paintSparks(ctx, lens, -1);
  paintLens(ctx, lens, PROFILE_LENS_SQUASH, PROFILE_LENS_TILT, true);
}

/** From behind: the silver arms where they hook over her ears. */
function paintBack(ctx: Ctx, frame: CatHeadFrame): void {
  if (frame.piece !== 'features') return;
  const { skull, eyeLine } = frame.landmarks;
  for (const side of [-1, 1]) {
    const outerX = skull.cx + side * skull.rx * BACK_ARM_SPREAD;
    strokeLine(
      ctx,
      { x: outerX, y: eyeLine },
      { x: outerX - side * BACK_ARM_LENGTH, y: eyeLine - BACK_ARM_RISE },
      RIM_WIRE,
      ARM_WIDTH,
    );
  }
}

export const CAT_KALEIDOSCOPE_SPECS = defineGarment({
  id: 'cat_kaleidoscope_specs',
  name: 'Kaleidoscope Specs',
  wearer: 'cat',
  material: 'jewelry',
  layer: 'outer',
  region: ['head'],
  paint: {
    head: withViewFallback(
      { front: paintFront, side: paintSide, back: paintBack },
      CAT_VIEW_FALLBACK,
    ),
  },
});
