/**
 * The Cockscomb Crest on the human crawler: a close steel skullcap with a
 * gold rim, crested fore-and-aft with a tall rooster's comb in red enamel,
 * the same comb the cat crawler wears. In profile the comb is its whole fan
 * of rounded lobes; head-on and from behind it is seen end-on, a narrow red
 * fin with its lobes stepping up its sides. At the tile the read is the red
 * crest standing up off a grey helmet.
 */

import type { CardinalView } from '../../facingView';
import { GOLD, IRON, type MetalRamp, metalFill, paintGlint } from '../cat/metalInk';
import { defineGarment } from '../garmentDef';
import {
  fillHatPath,
  hatUnits,
  hatViews,
  type PathCommand,
  strokeHatLine,
  traceHatPath,
  type Units,
} from './headwear';

type Ctx = CanvasRenderingContext2D;

/** The cat's crest's enamel, so the two crawlers' crests match. */
const RED_ENAMEL: MetalRamp = {
  shadow: '#5c0810',
  base: '#d41c26',
  light: '#ff6e5e',
  glint: '#fff0ea',
};
const SEAM_INK = '#1a1c20';

/** The skullcap head-on: close over the crop, its rim across the upper forehead. */
const CAP_FRONT: readonly PathCommand[] = [
  ['M', -1.14, -0.5],
  ['Q', -1.24, -1.62, 0, -1.64],
  ['Q', 1.24, -1.62, 1.14, -0.5],
  ['Q', 0, -0.4, -1.14, -0.5],
];
const RIM_FRONT: readonly number[] = [-1.14, -0.5, -0.6, -0.44, 0, -0.42, 0.6, -0.44, 1.14, -0.5];
/** From behind the rim comes down over the back of the skull. */
const CAP_BACK: readonly PathCommand[] = [
  ['M', -1.18, -0.36],
  ['Q', -1.28, -1.62, 0, -1.64],
  ['Q', 1.28, -1.62, 1.18, -0.36],
  ['Q', 0, -0.2, -1.18, -0.36],
];
const RIM_BACK: readonly number[] = [-1.18, -0.36, -0.6, -0.28, 0, -0.26, 0.6, -0.28, 1.18, -0.36];
/** Edge-on: from the brow back over the crown to the top of the nape. */
const CAP_SIDE: readonly PathCommand[] = [
  ['M', 0.96, -0.66],
  ['Q', 1.02, -1.72, -0.1, -1.74],
  ['Q', -1.32, -1.64, -1.24, -0.4],
  ['L', 0.96, -0.66],
];
const RIM_SIDE: readonly number[] = [-1.24, -0.4, 0.96, -0.66];
const RIM_WIDTH = 0.034;
const RIM_EDGE_WIDTH = 0.05;

/**
 * The comb end-on: a narrow fin rising off the crown, its points stepping up
 * either side. The notches run deep: it is the serration, not the colour,
 * that keeps it from reading as a red plume.
 */
const COMB_HEAD_ON: readonly PathCommand[] = [
  ['M', -0.22, -1.5],
  ['L', -0.34, -1.96],
  ['L', -0.14, -1.98],
  ['L', -0.26, -2.32],
  ['L', -0.06, -2.3],
  ['L', 0, -2.62],
  ['L', 0.06, -2.3],
  ['L', 0.26, -2.32],
  ['L', 0.14, -1.98],
  ['L', 0.34, -1.96],
  ['L', 0.22, -1.5],
];
/** The fin's lit flank head-on, toward the key light. */
const COMB_HEAD_ON_LIGHT: readonly number[] = [
  -0.14, -1.6, -0.22, -1.94, -0.14, -2.28, -0.02, -2.54,
];
/**
 * The comb in profile, from the brow back over the crown: five rounded
 * points, tallest in the middle as on a single comb, rooted inside the cap so
 * the cap's top covers where it is fixed.
 */
const COMB_PROFILE: readonly PathCommand[] = [
  ['M', 0.74, -1.4],
  ['Q', 0.86, -2.06, 0.6, -2.18],
  ['Q', 0.5, -1.94, 0.38, -1.96],
  ['Q', 0.42, -2.5, 0.16, -2.52],
  ['Q', 0.06, -2.1, -0.06, -2.1],
  ['Q', -0.1, -2.7, -0.38, -2.6],
  ['Q', -0.4, -2.14, -0.5, -2.08],
  ['Q', -0.66, -2.5, -0.88, -2.38],
  ['Q', -0.82, -2.0, -0.92, -1.94],
  ['Q', -1.2, -2.08, -1.22, -1.9],
  ['Q', -1.12, -1.6, -0.96, -1.3],
];
/** The lit upper edge of each lobe in profile, the line that turns a red shape into enamel. */
const COMB_PROFILE_LIGHT: readonly (readonly number[])[] = [
  [0.7, -1.7, 0.66, -2.06],
  [0.3, -2.1, 0.2, -2.42],
  [-0.14, -2.24, -0.3, -2.54],
  [-0.56, -2.18, -0.78, -2.34],
];
const COMB_LIGHT_WIDTH = 0.03;
const COMB_EDGE_WIDTH = 0.02;
const GLINT_REACH = 0.028;
const GLINT_PROFILE_X = 0.18;
const GLINT_PROFILE_Y = -2.34;
const GLINT_HEAD_ON_X = -0.04;
const GLINT_HEAD_ON_Y = -2.24;
const CAP_GLINT_REACH = 0.026;
const CAP_GLINT_X = -0.56;
const CAP_GLINT_Y = -1.28;

/** The fills' key-light span: from upper left to lower right of each shape. */
const LIGHT_FROM_X = -1.1;
const LIGHT_FROM_Y = -1.7;
const SHADOW_TO_X = 1.1;
const SHADOW_TO_Y = -0.4;
const COMB_SHADOW_TO_Y = -1.5;
const COMB_LIGHT_FROM_Y = -2.6;

function capFill(ctx: Ctx, units: Units): CanvasGradient {
  return metalFill(
    ctx,
    IRON,
    LIGHT_FROM_X * units.x,
    LIGHT_FROM_Y * units.y,
    SHADOW_TO_X * units.x,
    SHADOW_TO_Y * units.y,
  );
}

function combFill(ctx: Ctx, units: Units): CanvasGradient {
  return metalFill(
    ctx,
    RED_ENAMEL,
    LIGHT_FROM_X * units.x,
    COMB_LIGHT_FROM_Y * units.y,
    SHADOW_TO_X * units.x,
    COMB_SHADOW_TO_Y * units.y,
  );
}

function paintComb(ctx: Ctx, units: Units, comb: readonly PathCommand[]): void {
  traceHatPath(ctx, comb, units);
  ctx.fillStyle = combFill(ctx, units);
  ctx.fill();
  ctx.strokeStyle = RED_ENAMEL.shadow;
  ctx.lineWidth = COMB_EDGE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function paintCap(
  ctx: Ctx,
  units: Units,
  cap: readonly PathCommand[],
  rim: readonly number[],
  lit: boolean,
): void {
  fillHatPath(ctx, cap, units, capFill(ctx, units));
  strokeHatLine(ctx, rim, units, SEAM_INK, RIM_EDGE_WIDTH);
  strokeHatLine(ctx, rim, units, GOLD.base, RIM_WIDTH);
  if (lit) paintGlint(ctx, IRON, CAP_GLINT_X * units.x, CAP_GLINT_Y * units.y, CAP_GLINT_REACH);
}

function paintHeadOn(ctx: Ctx, view: CardinalView): void {
  const units = hatUnits(view);
  const fromBehind = view === 'back';
  paintComb(ctx, units, COMB_HEAD_ON);
  strokeHatLine(ctx, COMB_HEAD_ON_LIGHT, units, RED_ENAMEL.light, COMB_LIGHT_WIDTH);
  if (fromBehind) paintCap(ctx, units, CAP_BACK, RIM_BACK, false);
  else {
    paintCap(ctx, units, CAP_FRONT, RIM_FRONT, true);
    paintGlint(ctx, RED_ENAMEL, GLINT_HEAD_ON_X * units.x, GLINT_HEAD_ON_Y * units.y, GLINT_REACH);
  }
}

function paintSide(ctx: Ctx, view: CardinalView): void {
  const units = hatUnits(view);
  paintComb(ctx, units, COMB_PROFILE);
  for (const light of COMB_PROFILE_LIGHT) {
    strokeHatLine(ctx, light, units, RED_ENAMEL.light, COMB_LIGHT_WIDTH);
  }
  paintGlint(ctx, RED_ENAMEL, GLINT_PROFILE_X * units.x, GLINT_PROFILE_Y * units.y, GLINT_REACH);
  paintCap(ctx, units, CAP_SIDE, RIM_SIDE, true);
}

export const COCKSCOMB_CREST = defineGarment({
  id: 'human_cockscomb_crest',
  name: 'Cockscomb Crest',
  wearer: 'human',
  material: 'metal',
  layer: 'overcoat',
  region: ['head'],
  paint: { head: hatViews({ front: paintHeadOn, side: paintSide, back: paintHeadOn }) },
});
