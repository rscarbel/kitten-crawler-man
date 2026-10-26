/**
 * The Foreman's Hardhat on the human crawler: a yellow construction hard hat,
 * scuffed. At the tile it is a bright yellow dome capping his head down to
 * the brow, split by its raised centre ridge, with the short peak jutting over
 * his forehead; the scuffs and the tally of scratches on the peak only show
 * close up.
 */

import type { CardinalView } from '../../facingView';
import type { MetalRamp } from '../cat/metalInk';
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

/** Safety yellow, glossy: hard bands from a pale lit shoulder to an ochre shadow. */
const SHELL: MetalRamp = {
  shadow: '#8a5c06',
  base: '#e8ac12',
  light: '#ffe060',
  glint: '#fffbe0',
};
const RIM_SHADOW = '#5a3a04';
/** The peak's shadow on his forehead: a thin band, so it never masks the eyes. */
const PEAK_SHADOW = 'rgba(40,24,8,0.45)';
const PEAK_SHADOW_FRONT: readonly PathCommand[] = [
  ['M', -0.9, -0.46],
  ['Q', 0, -0.28, 0.9, -0.46],
  ['L', 0.86, -0.38],
  ['Q', 0, -0.2, -0.86, -0.38],
];
const SCUFF = 'rgba(120,84,24,0.6)';
const SCRATCH = 'rgba(70,44,8,0.9)';

/**
 * The shell head-on: down past the temples to just above the ear, its front
 * rim bowing toward the camera over the brow. It stands clear of the crop all
 * round, so none of his hair shows over it.
 */
const SHELL_FRONT: readonly PathCommand[] = [
  ['M', -1.16, -0.56],
  ['Q', -1.26, -1.66, 0, -1.7],
  ['Q', 1.26, -1.66, 1.16, -0.56],
  ['Q', 0, -0.42, -1.16, -0.56],
];
/** The peak seen from in front: a band jutting over the brow, lowest at its middle. */
const PEAK_FRONT: readonly PathCommand[] = [
  ['M', -0.94, -0.56],
  ['Q', 0, -0.42, 0.94, -0.56],
  ['L', 1.0, -0.46],
  ['Q', 0, -0.26, -1.0, -0.46],
];
/** From behind the rim comes lower, over the top of his nape. */
const SHELL_BACK: readonly PathCommand[] = [
  ['M', -1.2, -0.4],
  ['Q', -1.3, -1.62, 0, -1.66],
  ['Q', 1.3, -1.62, 1.2, -0.4],
  ['Q', 0, -0.2, -1.2, -0.4],
];
/** Edge-on: the dome from his nape to his brow, its rim dipping toward the back. */
const SHELL_SIDE: readonly PathCommand[] = [
  ['M', -1.26, -0.44],
  ['Q', -1.34, -1.66, -0.08, -1.74],
  ['Q', 1.02, -1.7, 1.02, -0.66],
  ['L', -1.26, -0.44],
];
/** The peak edge-on, jutting forward off the front rim over his brow. */
const PEAK_SIDE: readonly PathCommand[] = [
  ['M', 0.86, -0.7],
  ['L', 1.38, -0.62],
  ['L', 1.36, -0.54],
  ['L', 0.86, -0.6],
];

/** The ridge head-on: a raised rib up the middle of the shell, from the rim to the crown. */
const RIDGE_HALF_WIDTH = 0.12;
const RIDGE_BOTTOM = -0.5;
const RIDGE_TOP = -1.66;
const RIDGE_SHADOW_WIDTH = 0.022;
/** Edge-on the ridge runs over the top of the dome, a lit line just inside its outline. */
const RIDGE_SIDE: readonly number[] = [0.94, -0.92, 0.6, -1.56, -0.1, -1.66, -0.9, -1.4];
const RIDGE_SIDE_WIDTH = 0.04;
const RIDGE_SIDE_GROOVE: readonly number[] = [0.86, -0.88, 0.54, -1.46, -0.1, -1.56, -0.84, -1.32];
const RIDGE_GROOVE_WIDTH = 0.016;

/** The rim's lip, a dark line where the shell ends. */
const RIM_WIDTH = 0.022;
const RIM_FRONT: readonly number[] = [-1.16, -0.56, -0.6, -0.5, 0, -0.48, 0.6, -0.5, 1.16, -0.56];
const RIM_BACK: readonly number[] = [-1.2, -0.4, -0.6, -0.28, 0, -0.26, 0.6, -0.28, 1.2, -0.4];
const RIM_SIDE: readonly number[] = [-1.26, -0.44, 1.02, -0.66];
const PEAK_LIP_FRONT: readonly number[] = [
  -1.0, -0.46, -0.5, -0.32, 0, -0.26, 0.5, -0.32, 1.0, -0.46,
];
const PEAK_LIP_SIDE: readonly number[] = [0.86, -0.6, 1.36, -0.54];

/** The shell's hard banding, as fractions of its key-light gradient's radius. */
const LIGHT_CENTRE_X = -0.5;
const LIGHT_CENTRE_Y = -1.3;
const GRADIENT_REACH = 1.9;
const GLINT_UNTIL = 0.08;
const LIGHT_UNTIL = 0.3;
const BASE_UNTIL = 0.66;
const FEATHER = 0.035;

/** A hard specular on the lit shoulder: the plastic is glossy. */
const SPECULAR_X = -0.56;
const SPECULAR_Y = -1.32;
const SPECULAR_RX = 0.035;
const SPECULAR_RY = 0.022;
const SPECULAR_TILT = -0.7;

/** Scuffs on the shell: short dull scrapes through the gloss. */
const SCUFF_WIDTH = 0.016;
const SCUFFS_FRONT: readonly (readonly number[])[] = [
  [0.42, -0.86, 0.66, -1.02],
  [0.28, -1.3, 0.5, -1.24],
  [-0.7, -0.78, -0.52, -0.9],
];
const SCUFFS_SIDE: readonly (readonly number[])[] = [
  [-0.64, -0.9, -0.36, -1.02],
  [0.2, -1.2, 0.42, -1.1],
  [-0.2, -0.66, 0.06, -0.74],
];
const SCUFFS_BACK: readonly (readonly number[])[] = [
  [-0.56, -0.9, -0.3, -1.04],
  [0.36, -1.16, 0.62, -1.06],
];

/** Four scratched strokes and the one across them, on the right of the peak. */
const TALLY_FROM_X = 0.34;
const TALLY_STEP = 0.09;
const TALLY_STROKES = 4;
const TALLY_TOP = -0.49;
const TALLY_BOTTOM = -0.39;
const TALLY_SLASH: readonly number[] = [0.3, -0.42, 0.66, -0.47];
const TALLY_WIDTH = 0.012;
/** Edge-on the tally is seen along the peak's side, three short ticks. */
const TALLY_SIDE: readonly (readonly number[])[] = [
  [1.02, -0.66, 1.04, -0.6],
  [1.12, -0.65, 1.14, -0.59],
  [1.22, -0.63, 1.24, -0.58],
];

const FULL_TURN = Math.PI * 2;

function shellFill(ctx: Ctx, units: Units): CanvasGradient {
  const lightX = LIGHT_CENTRE_X * units.x;
  const lightY = LIGHT_CENTRE_Y * units.y;
  const gradient = ctx.createRadialGradient(
    lightX,
    lightY,
    0,
    lightX,
    lightY,
    GRADIENT_REACH * units.y,
  );
  gradient.addColorStop(0, SHELL.light);
  gradient.addColorStop(GLINT_UNTIL, SHELL.light);
  gradient.addColorStop(LIGHT_UNTIL - FEATHER, SHELL.light);
  gradient.addColorStop(LIGHT_UNTIL + FEATHER, SHELL.base);
  gradient.addColorStop(BASE_UNTIL - FEATHER, SHELL.base);
  gradient.addColorStop(BASE_UNTIL + FEATHER, SHELL.shadow);
  gradient.addColorStop(1, SHELL.shadow);
  return gradient;
}

function paintSpecular(ctx: Ctx, units: Units): void {
  ctx.save();
  ctx.translate(SPECULAR_X * units.x, SPECULAR_Y * units.y);
  ctx.rotate(SPECULAR_TILT);
  ctx.beginPath();
  ctx.ellipse(0, 0, SPECULAR_RX, SPECULAR_RY, 0, 0, FULL_TURN);
  ctx.fillStyle = SHELL.glint;
  ctx.fill();
  ctx.restore();
}

function paintScuffs(ctx: Ctx, units: Units, scuffs: readonly (readonly number[])[]): void {
  for (const scuff of scuffs) strokeHatLine(ctx, scuff, units, SCUFF, SCUFF_WIDTH);
}

/** Head-on the ridge is a lit rib up the middle, its shadowed flank toward screen right. */
function paintRidgeHeadOn(ctx: Ctx, units: Units, shell: readonly PathCommand[]): void {
  ctx.save();
  traceHatPath(ctx, shell, units);
  ctx.clip();
  const halfWidth = RIDGE_HALF_WIDTH * units.x;
  ctx.fillStyle = SHELL.light;
  ctx.fillRect(
    -halfWidth,
    RIDGE_TOP * units.y,
    halfWidth * 2,
    (RIDGE_BOTTOM - RIDGE_TOP) * units.y,
  );
  strokeHatLine(
    ctx,
    [RIDGE_HALF_WIDTH, RIDGE_BOTTOM, RIDGE_HALF_WIDTH, RIDGE_TOP],
    units,
    SHELL.shadow,
    RIDGE_SHADOW_WIDTH,
  );
  ctx.restore();
}

function paintTally(ctx: Ctx, units: Units): void {
  for (let stroke = 0; stroke < TALLY_STROKES; stroke++) {
    const x = TALLY_FROM_X + stroke * TALLY_STEP;
    strokeHatLine(ctx, [x, TALLY_TOP, x, TALLY_BOTTOM], units, SCRATCH, TALLY_WIDTH);
  }
  strokeHatLine(ctx, TALLY_SLASH, units, SCRATCH, TALLY_WIDTH);
}

function paintFront(ctx: Ctx, view: CardinalView): void {
  const units = hatUnits(view);
  fillHatPath(ctx, SHELL_FRONT, units, shellFill(ctx, units));
  paintRidgeHeadOn(ctx, units, SHELL_FRONT);
  paintScuffs(ctx, units, SCUFFS_FRONT);
  paintSpecular(ctx, units);
  strokeHatLine(ctx, RIM_FRONT, units, RIM_SHADOW, RIM_WIDTH);
  fillHatPath(ctx, PEAK_SHADOW_FRONT, units, PEAK_SHADOW);
  fillHatPath(ctx, PEAK_FRONT, units, SHELL.light);
  strokeHatLine(ctx, PEAK_LIP_FRONT, units, RIM_SHADOW, RIM_WIDTH);
  paintTally(ctx, units);
}

function paintBack(ctx: Ctx, view: CardinalView): void {
  const units = hatUnits(view);
  fillHatPath(ctx, SHELL_BACK, units, shellFill(ctx, units));
  paintRidgeHeadOn(ctx, units, SHELL_BACK);
  paintScuffs(ctx, units, SCUFFS_BACK);
  strokeHatLine(ctx, RIM_BACK, units, RIM_SHADOW, RIM_WIDTH);
}

function paintSide(ctx: Ctx, view: CardinalView): void {
  const units = hatUnits(view);
  fillHatPath(ctx, PEAK_SIDE, units, SHELL.base);
  strokeHatLine(ctx, PEAK_LIP_SIDE, units, RIM_SHADOW, RIM_WIDTH);
  fillHatPath(ctx, SHELL_SIDE, units, shellFill(ctx, units));
  ctx.save();
  traceHatPath(ctx, SHELL_SIDE, units);
  ctx.clip();
  strokeHatLine(ctx, RIDGE_SIDE_GROOVE, units, SHELL.shadow, RIDGE_GROOVE_WIDTH);
  ctx.restore();
  strokeHatLine(ctx, RIDGE_SIDE, units, SHELL.light, RIDGE_SIDE_WIDTH);
  paintScuffs(ctx, units, SCUFFS_SIDE);
  paintSpecular(ctx, units);
  strokeHatLine(ctx, RIM_SIDE, units, RIM_SHADOW, RIM_WIDTH);
  for (const tick of TALLY_SIDE) strokeHatLine(ctx, tick, units, SCRATCH, TALLY_WIDTH);
}

export const FOREMANS_HARDHAT = defineGarment({
  id: 'human_foremans_hardhat',
  name: "Foreman's Hardhat",
  wearer: 'human',
  material: 'metal',
  layer: 'overcoat',
  region: ['head'],
  paint: { head: hatViews({ front: paintFront, side: paintSide, back: paintBack }) },
});
