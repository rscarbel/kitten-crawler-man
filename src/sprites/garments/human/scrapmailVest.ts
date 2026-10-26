/**
 * The Scrapmail Vest on the human crawler: bottle caps, can lids and washers
 * wired together in overlapping rows like scales, cut as a sleeveless vest
 * hanging open down the front over his shirt. At the tile it is a speckled tin
 * torso dotted red, blue and yellow by the painted caps, hard glints on its lit
 * side, his shirt showing at the shoulders round the armholes and in a strip
 * down his chest. The metals are the cat's vest's, so the pair match.
 */

import type { BipedTorsoFrame } from '../../art/biped/bipedParts';
import type { ViewSpec } from '../../art/biped/rig';
import type { TorsoFrame } from '../../art/biped/torso';
import { rgba, type Pt } from '../../art/bipedArt';
import { withClip } from '../../art/softShade';
import { BRASS, IRON, paintGlint, SILVER, type MetalRamp } from '../cat/metalInk';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import { fillPolygon, tracePolygon, withinTorso } from './torsoCover';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/** The wire the caps are strung on, showing dark between them. */
const WIRE = IRON.shadow;
const BINDING = '#16181c';

/** Painted bottle caps, the cat's vest's colours: a saturated face with a dark crimped rim. */
const CAP_RED: MetalRamp = {
  shadow: '#4a0c0c',
  base: '#d83a2c',
  light: '#ff8a70',
  glint: '#fff0e8',
};
const CAP_BLUE: MetalRamp = {
  shadow: '#0c1e4a',
  base: '#3a72d8',
  light: '#8ab8ff',
  glint: '#eef6ff',
};
const CAP_YELLOW: MetalRamp = {
  shadow: '#4a3a06',
  base: '#f0c832',
  light: '#fff09a',
  glint: '#fffdf0',
};
/** Can lids gone to rust, so the tin is not one clean grey. */
const RUST: MetalRamp = {
  shadow: '#3a1a0c',
  base: '#9a4a24',
  light: '#d08050',
  glint: '#ffe4cc',
};
/**
 * The cycle the caps run through: mostly tin lids and washers, a painted cap
 * one in six, so the vest reads as metal scales with colour in it rather than
 * as a printed pattern.
 */
const CAP_CYCLE: readonly MetalRamp[] = [
  SILVER,
  IRON,
  CAP_RED,
  SILVER,
  RUST,
  IRON,
  SILVER,
  BRASS,
  IRON,
  SILVER,
  CAP_BLUE,
  IRON,
  SILVER,
  RUST,
  IRON,
  SILVER,
  CAP_YELLOW,
  IRON,
];
/** Steps through the cycle per column and per row, coprime to its length so no colour lines up. */
const CYCLE_STEP_COLUMN = 7;
const CYCLE_STEP_ROW = 5;

/** Caps big enough to stay a pixel or two at the tile, so the vest reads as discs rather than a grey wash. */
const CAP_RADIUS = 0.054;
const CAP_RIM = 0.014;
const ROW_STEP = 0.072;
const COLUMN_STEP = 0.092;
const CAP_LIGHT_OFFSET = 0.35;
const CAP_LIGHT_SHARE = 0.5;
const FULL_TURN = Math.PI * 2;
/** The rows start above the shoulder line and run past the hem, so the vest's outline, not a row, ends them. */
const CAPS_TOP_Y = -0.1;
const CAPS_BELOW_HEM = 0.08;
const CAPS_HALF_SPAN = 0.6;

/** Hard glints on a scatter of caps on the lit side: what says polished metal at a few pixels. */
const GLINT_EVERY = 5;
const GLINT_REACH = 0.045;
/** Only caps this far across toward the key light catch it. */
const GLINT_LIT_SIDE_X = 0.04;

/** The vest's turn into shadow: its far side and lower body darkened over the caps. */
const FAR_SIDE_SHADE_ALPHA = 0.65;
const FAR_SIDE_SHADE_FROM = 0.35;
const BINDING_WIDTH = 0.03;

/** Head-on: the armholes cut in under the shoulders, and the open front from the throat to the hem. */
const VEST_NECK_HALF = 0.115;
const VEST_NECK_Y = -0.03;
const VEST_SHOULDER_HALF = 0.26;
const VEST_SHOULDER_Y = 0.005;
const ARMHOLE_HALF = 0.245;
const ARMHOLE_BOTTOM_Y = 0.22;
const VEST_SIDE_Y = 0.27;
/** Past the torso's sides, so the clip, not the vest's edge, finishes it there. */
const OVERREACH = 0.6;
const OPENING_TOP_HALF = 0.07;
const OPENING_V_BOTTOM_Y = 0.14;
const OPENING_HALF = 0.022;

/** Edge-on: the vest wraps his side, the shoulder over the arm cut away, open a little at the throat. */
const PROFILE_NECK_FRONT_X = 0.06;
const PROFILE_NECK_BACK_X = -0.1;
const PROFILE_NECK_Y = -0.04;
const PROFILE_FRONT_NOTCH_Y = 0.12;

function capAt(row: number, column: number): MetalRamp {
  const cycleAt = column * CYCLE_STEP_COLUMN + row * CYCLE_STEP_ROW;
  const length = CAP_CYCLE.length;
  return CAP_CYCLE[((cycleAt % length) + length) % length] ?? SILVER;
}

function paintCap(ctx: Ctx, metal: MetalRamp, centre: Pt): void {
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, CAP_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = metal.base;
  ctx.fill();
  ctx.strokeStyle = metal.shadow;
  ctx.lineWidth = CAP_RIM;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(
    centre.x - CAP_RADIUS * CAP_LIGHT_OFFSET,
    centre.y - CAP_RADIUS * CAP_LIGHT_OFFSET,
    CAP_RADIUS * CAP_LIGHT_SHARE,
    0,
    FULL_TURN,
  );
  ctx.fillStyle = metal.light;
  ctx.fill();
}

/**
 * Rows of caps down the torso, each offset half a cap and lapping over the one
 * above, placed in the torso's frame so they turn and squash with it. `squeeze`
 * narrows the across-spacing edge-on.
 */
function paintCaps(ctx: Ctx, torso: TorsoFrame, squeeze: number): void {
  const rows = Math.ceil((torso.hemY + CAPS_BELOW_HEM - CAPS_TOP_Y) / ROW_STEP);
  const columns = Math.ceil(CAPS_HALF_SPAN / COLUMN_STEP);
  const glints: Pt[] = [];
  for (let row = 0; row <= rows; row++) {
    const y = CAPS_TOP_Y + row * ROW_STEP;
    const offset = row % 2 === 0 ? 0 : COLUMN_STEP / 2;
    for (let column = -columns; column <= columns; column++) {
      const x = column * COLUMN_STEP + offset;
      const centre = torso.at(x * squeeze, y);
      const metal = capAt(row, column);
      paintCap(ctx, metal, centre);
      const glinting = (row * columns + column) % GLINT_EVERY === 0 && x < -GLINT_LIT_SIDE_X;
      if (glinting) glints.push(centre);
    }
  }
  for (const glint of glints) paintGlint(ctx, SILVER, glint.x, glint.y, GLINT_REACH);
}

function shadeFarSide(ctx: Ctx, torso: TorsoFrame, halfWidth: number): void {
  const lit = torso.at(-halfWidth, 0);
  const far = torso.at(halfWidth, torso.hemY);
  const shade = ctx.createLinearGradient(lit.x, lit.y, far.x, far.y);
  shade.addColorStop(0, rgba(IRON.shadow, 0));
  shade.addColorStop(FAR_SIDE_SHADE_FROM, rgba(IRON.shadow, 0));
  shade.addColorStop(1, rgba(IRON.shadow, FAR_SIDE_SHADE_ALPHA));
  ctx.fillStyle = shade;
  ctx.fillRect(
    Math.min(lit.x, far.x) - OVERREACH,
    Math.min(lit.y, far.y) - OVERREACH,
    Math.abs(far.x - lit.x) + OVERREACH * 2,
    Math.abs(far.y - lit.y) + OVERREACH * 2,
  );
}

/** One side of the vest head-on, from the neck out round the armhole and down to the hem, `side` −1 or +1. */
function sideEdge(torso: TorsoFrame, view: ViewSpec, side: number): Pt[] {
  const { at } = torso;
  const g = view.girth;
  return [
    at(side * VEST_NECK_HALF * g, VEST_NECK_Y),
    at(side * VEST_SHOULDER_HALF * g, VEST_SHOULDER_Y),
    at(side * ARMHOLE_HALF * g, ARMHOLE_BOTTOM_Y),
    at(side * OVERREACH, VEST_SIDE_Y),
    torso.hem(side * OVERREACH, OVERREACH),
  ];
}

/** One front panel, `side` −1 for the one on the left as drawn, +1 for the other, open down the middle. */
function frontPanel(torso: TorsoFrame, view: ViewSpec, side: number): Pt[] {
  const { at } = torso;
  const g = view.girth;
  return [
    at(side * OPENING_TOP_HALF * g, VEST_NECK_Y),
    ...sideEdge(torso, view, side),
    torso.hem(side * OPENING_HALF * g, OVERREACH),
    at(side * OPENING_HALF * g, OPENING_V_BOTTOM_Y),
  ];
}

/** The back in one piece, from one armhole to the other. */
function backPanel(torso: TorsoFrame, view: ViewSpec): Pt[] {
  return [...sideEdge(torso, view, -1), ...sideEdge(torso, view, 1).reverse()];
}

function profileOutline(torso: TorsoFrame): Pt[] {
  const depth = torso.cut.profileDepth;
  const { at } = torso;
  return [
    at(PROFILE_NECK_BACK_X * depth, PROFILE_NECK_Y),
    at(PROFILE_NECK_FRONT_X * depth, PROFILE_NECK_Y),
    at(OVERREACH, PROFILE_FRONT_NOTCH_Y),
    torso.hem(OVERREACH, OVERREACH),
    torso.hem(-OVERREACH, OVERREACH),
    at(-OVERREACH, PROFILE_NECK_Y),
  ];
}

function paintPanel(
  ctx: Ctx,
  torso: TorsoFrame,
  outline: readonly Pt[],
  squeeze: number,
  halfWidth: number,
): void {
  fillPolygon(ctx, outline, WIRE);
  withClip(
    ctx,
    () => tracePolygon(ctx, outline),
    () => {
      paintCaps(ctx, torso, squeeze);
      shadeFarSide(ctx, torso, halfWidth);
      tracePolygon(ctx, outline);
      ctx.strokeStyle = BINDING;
      ctx.lineWidth = BINDING_WIDTH * 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    },
  );
}

function paintBody(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  const { torso, view } = frame;
  withinTorso(ctx, frame, context, () => {
    if (view.profile) {
      const depth = torso.cut.profileDepth;
      paintPanel(ctx, torso, profileOutline(torso), depth, OVERREACH * depth);
      return;
    }
    const halfWidth = VEST_SHOULDER_HALF * view.girth;
    if (view.showsBack) {
      paintPanel(ctx, torso, backPanel(torso, view), view.girth, halfWidth);
      return;
    }
    for (const side of [-1, 1]) {
      paintPanel(ctx, torso, frontPanel(torso, view, side), view.girth, halfWidth);
    }
  });
}

function paintTorso(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  if (frame.piece === 'jacket') paintBody(ctx, frame, context);
}

export const SCRAPMAIL_VEST = defineGarment({
  id: 'human_scrapmail_vest',
  name: 'Scrapmail Vest',
  wearer: 'human',
  material: 'metal',
  layer: 'outer',
  region: ['torso'],
  paint: { torso: humanEveryView(paintTorso) },
});
