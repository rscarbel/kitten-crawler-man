/**
 * The cat crawler's trinkets: each one a charm on a jump ring, hung from a
 * slim leather collar round her neck. Head-on and in profile the charm hangs
 * at her throat over her bib; from behind only the collar shows across her
 * nape. It swings a little with her sway.
 *
 * She wears two trinkets at once, and the garment cannot know which slot it
 * is in, so every charm hangs from its own link of the collar: any two worn
 * together hang side by side instead of one over the other.
 *
 * Painted on her neck, after her body and before her head, so her chin and
 * cheek ruffs fall over the collar.
 */

import type { CatNeckFrame } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import type { CatCharmGarmentId } from '../garmentIds';
import {
  defineGarment,
  type GarmentFrameContext,
  withViewFallback,
  type WornGarmentDef,
} from '../garmentDef';
import { IRON, metalFill, paintGlint, SILVER, type MetalRamp } from './metalInk';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;
const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;
const HALF = 0.5;

/**
 * A slim oxblood strap: dark enough not to read as a garment of its own, red
 * enough to show on a black cat, so the charm is seen to hang from something.
 */
const COLLAR_LEATHER = '#7a2a20';
const COLLAR_WIDTH = 0.02;
const JUMP_RING_RADIUS = 0.011;
const JUMP_RING_WIDTH = 0.01;
/** How far below the collar the charm's own ring hangs. */
const CHARM_HANG = 0.022;

const COPPER: MetalRamp = {
  shadow: '#4a1e0a',
  base: '#c66a32',
  light: '#f4b07a',
  glint: '#fff0e0',
};
/**
 * The bangle's copper gone green where it never stops sliding round: at the
 * tile a bright copper hoop was one more orange speck beside the penny and the
 * ember.
 */
const VERDIGRIS: MetalRamp = {
  shadow: '#123c34',
  base: '#3fae92',
  light: '#a8ecd6',
  glint: '#f0fff8',
};
const BRASS: MetalRamp = {
  shadow: '#4a3208',
  base: '#b8902c',
  light: '#eed27a',
  glint: '#fffbe8',
};

/** How far her sway swings the charm, as a turn of the charm per unit of sway. */
const SWING_PER_SWAY = 6;
const MAX_SWING = 0.3;
/** Lying on her side the charm rests beside her neck: its drop shrinks with her roll, to this share at the most. */
const LYING_HANG_SHARE = 0.3;
/** In profile a flat charm is seen partly edge-on. */
const PROFILE_SQUASH = 0.6;
const GLINT_REACH = 0.018;
/**
 * Each charm is drawn this much larger than life: at the tile anything
 * smaller than a few pixels vanishes into her bib.
 */
const CHARM_SCALE = 1.4;

/** A charm's glint sits up on its lit side, toward the key light at the upper left. */
const GLINT_ACROSS = -0.6;
const GLINT_UP = 0.3;

/** Paints one charm hanging from its ring at the origin, +Y down. */
type CharmPainter = (ctx: Ctx) => void;

interface CharmLook {
  readonly id: CatCharmGarmentId;
  readonly name: string;
  /** Which link of the collar it hangs from: a turn round the band from her throat. */
  readonly link: number;
  readonly paint: CharmPainter;
}

/** The step between neighbouring links, small enough that every charm still hangs at her throat. */
const LINK_STEP = 0.12;

function ringStroke(ctx: Ctx, cx: number, cy: number, r: number, width: number, metal: MetalRamp) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, FULL_TURN);
  ctx.strokeStyle = metalFill(ctx, metal, cx - r, cy - r, cx + r, cy + r);
  ctx.lineWidth = width;
  ctx.stroke();
}

const BANGLE_RADIUS = 0.03;
const BANGLE_WIDTH = 0.013;

function paintBangle(ctx: Ctx): void {
  ringStroke(ctx, 0, BANGLE_RADIUS, BANGLE_RADIUS, BANGLE_WIDTH, VERDIGRIS);
  paintGlint(
    ctx,
    VERDIGRIS,
    BANGLE_RADIUS * GLINT_ACROSS,
    BANGLE_RADIUS * (1 - GLINT_UP),
    GLINT_REACH,
  );
}

const PENNY_RADIUS = 0.032;
const PENNY_HOLE_RADIUS = 0.008;
/** The punched hole sits near the top edge, where the ring passes through it. */
const PENNY_HOLE_DOWN = 0.012;
const PENNY_RIM_WIDTH = 0.006;

function paintPenny(ctx: Ctx): void {
  const cy = PENNY_RADIUS;
  ctx.beginPath();
  ctx.arc(0, cy, PENNY_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = metalFill(ctx, COPPER, -PENNY_RADIUS, 0, PENNY_RADIUS, cy * 2);
  ctx.fill();
  ctx.strokeStyle = COPPER.shadow;
  ctx.lineWidth = PENNY_RIM_WIDTH;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, PENNY_HOLE_DOWN, PENNY_HOLE_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = COPPER.shadow;
  ctx.fill();
  paintGlint(ctx, COPPER, PENNY_RADIUS * GLINT_ACROSS, cy - PENNY_RADIUS * GLINT_UP, GLINT_REACH);
}

const FANG_IVORY = '#f2e2a0';
const FANG_ROOT = '#b89a48';
const FANG_EDGE = '#3a2a0c';
const FANG_LENGTH = 0.085;
const FANG_HALF_WIDTH = 0.018;
/** The fang curves to one side as it tapers, the mark that says tooth rather than spike. */
const FANG_CURVE = 0.022;
/** Where along the fang each side's curve is pulled: the inner side bellies lower than the outer. */
const FANG_OUTER_BELLY = 0.6;
const FANG_INNER_BELLY = 0.45;
const FANG_EDGE_WIDTH = 0.01;
const WIRE_WRAPS = 2;
const WIRE_STEP = 0.01;
const WIRE_WIDTH = 0.006;

function paintFang(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(-FANG_HALF_WIDTH, 0);
  ctx.quadraticCurveTo(-FANG_HALF_WIDTH, FANG_LENGTH * FANG_OUTER_BELLY, FANG_CURVE, FANG_LENGTH);
  ctx.quadraticCurveTo(FANG_HALF_WIDTH, FANG_LENGTH * FANG_INNER_BELLY, FANG_HALF_WIDTH, 0);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, 0, 0, FANG_LENGTH);
  fill.addColorStop(0, FANG_ROOT);
  fill.addColorStop(1, FANG_IVORY);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = FANG_EDGE;
  ctx.lineWidth = FANG_EDGE_WIDTH;
  ctx.stroke();
  ctx.strokeStyle = SILVER.base;
  ctx.lineWidth = WIRE_WIDTH;
  for (let wrap = 1; wrap <= WIRE_WRAPS; wrap++) {
    ctx.beginPath();
    ctx.moveTo(-FANG_HALF_WIDTH, wrap * WIRE_STEP);
    ctx.lineTo(FANG_HALF_WIDTH, wrap * WIRE_STEP - WIRE_WIDTH);
    ctx.stroke();
  }
}

const FROST_CORE = '#e8f8ff';
const FROST_GLASS = '#8cc8ec';
const FROST_DEEP = '#2e6488';
const BEAD_RADIUS = 0.03;
const BEAD_LIGHT_OFFSET = 0.35;
const BEAD_GLASS_STOP = 0.55;
/** A dark rim parts the pale bead from a cream bib. */
const BEAD_RIM_WIDTH = 0.008;

function paintFrostBead(ctx: Ctx): void {
  const cy = BEAD_RADIUS;
  const lightX = -BEAD_RADIUS * BEAD_LIGHT_OFFSET;
  const lightY = cy - BEAD_RADIUS * BEAD_LIGHT_OFFSET;
  ctx.beginPath();
  ctx.arc(0, cy, BEAD_RADIUS, 0, FULL_TURN);
  const glass = ctx.createRadialGradient(lightX, lightY, 0, 0, cy, BEAD_RADIUS);
  glass.addColorStop(0, FROST_CORE);
  glass.addColorStop(BEAD_GLASS_STOP, FROST_GLASS);
  glass.addColorStop(1, FROST_DEEP);
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.strokeStyle = FROST_DEEP;
  ctx.lineWidth = BEAD_RIM_WIDTH;
  ctx.stroke();
  paintGlint(ctx, SILVER, lightX, lightY, GLINT_REACH);
}

const EMBER_HOT = '#fff0a0';
const EMBER_MID = '#ff3a12';
const EMBER_DARK = '#8a1a06';
const CAGE_RADIUS = 0.03;
const EMBER_RADIUS = 0.022;
const CAGE_BARS = 3;
const CAGE_BAR_WIDTH = 0.007;
const EMBER_MID_STOP = 0.5;

function paintEmberCage(ctx: Ctx): void {
  const cy = CAGE_RADIUS;
  ctx.beginPath();
  ctx.arc(0, cy, EMBER_RADIUS, 0, FULL_TURN);
  const glow = ctx.createRadialGradient(0, cy, 0, 0, cy, EMBER_RADIUS);
  glow.addColorStop(0, EMBER_HOT);
  glow.addColorStop(EMBER_MID_STOP, EMBER_MID);
  glow.addColorStop(1, EMBER_DARK);
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.strokeStyle = BRASS.base;
  ctx.lineWidth = CAGE_BAR_WIDTH;
  for (let bar = 0; bar < CAGE_BARS; bar++) {
    const spread = ((bar + HALF) / CAGE_BARS - HALF) * 2;
    ctx.beginPath();
    ctx.ellipse(0, cy, Math.abs(spread) * CAGE_RADIUS, CAGE_RADIUS, 0, 0, FULL_TURN);
    ctx.stroke();
  }
  ringStroke(ctx, 0, cy, CAGE_RADIUS, CAGE_BAR_WIDTH, BRASS);
}

const FAE_RIME = '#dff4ff';
const FAE_GLOW = '#ff8a2a';
const FAE_RADIUS = 0.029;
const FAE_WIDTH = 0.018;
/** The half rimed white against the half glowing orange, on the black iron. */
const FAE_ACCENT_WIDTH = 0.007;

function paintFaeIron(ctx: Ctx): void {
  const cy = FAE_RADIUS;
  ctx.beginPath();
  ctx.arc(0, cy, FAE_RADIUS, 0, FULL_TURN);
  ctx.strokeStyle = IRON.shadow;
  ctx.lineWidth = FAE_WIDTH;
  ctx.stroke();
  ctx.lineWidth = FAE_ACCENT_WIDTH;
  ctx.beginPath();
  ctx.arc(0, cy, FAE_RADIUS, QUARTER_TURN, QUARTER_TURN + HALF_TURN);
  ctx.strokeStyle = FAE_RIME;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, cy, FAE_RADIUS, -QUARTER_TURN, QUARTER_TURN);
  ctx.strokeStyle = FAE_GLOW;
  ctx.stroke();
}

const HOURGLASS_HEIGHT = 0.085;
const HOURGLASS_HALF_WIDTH = 0.03;
const HOURGLASS_CAP_HEIGHT = 0.014;
const HOURGLASS_WAIST = 0.004;
const GLASS = 'rgba(214,236,246,0.9)';
const SAND = '#f08a20';
/** The sand fills the top bulb this far: it runs upward. */
const SAND_TOP_SHARE = 0.6;
const GLASS_EDGE = '#26303a';
const GLASS_EDGE_WIDTH = 0.008;

function traceBulb(ctx: Ctx, from: number, to: number): void {
  ctx.beginPath();
  ctx.moveTo(-HOURGLASS_HALF_WIDTH, from);
  ctx.lineTo(HOURGLASS_HALF_WIDTH, from);
  ctx.lineTo(HOURGLASS_WAIST, to);
  ctx.lineTo(-HOURGLASS_WAIST, to);
  ctx.closePath();
}

function paintHourglass(ctx: Ctx): void {
  const top = HOURGLASS_CAP_HEIGHT;
  const bottom = HOURGLASS_HEIGHT - HOURGLASS_CAP_HEIGHT;
  const waist = (top + bottom) / 2;
  ctx.fillStyle = GLASS;
  traceBulb(ctx, top, waist);
  ctx.fill();
  ctx.strokeStyle = GLASS_EDGE;
  ctx.lineWidth = GLASS_EDGE_WIDTH;
  ctx.stroke();
  traceBulb(ctx, bottom, waist);
  ctx.fill();
  ctx.stroke();
  ctx.save();
  traceBulb(ctx, top, waist);
  ctx.clip();
  ctx.fillStyle = SAND;
  ctx.fillRect(
    -HOURGLASS_HALF_WIDTH,
    top,
    HOURGLASS_HALF_WIDTH * 2,
    (waist - top) * SAND_TOP_SHARE,
  );
  ctx.restore();
  ctx.fillStyle = metalFill(ctx, BRASS, -HOURGLASS_HALF_WIDTH, 0, HOURGLASS_HALF_WIDTH, 0);
  ctx.fillRect(-HOURGLASS_HALF_WIDTH, 0, HOURGLASS_HALF_WIDTH * 2, HOURGLASS_CAP_HEIGHT);
  ctx.fillRect(-HOURGLASS_HALF_WIDTH, bottom, HOURGLASS_HALF_WIDTH * 2, HOURGLASS_CAP_HEIGHT);
}

/** The point on the band at `angle`, in pose space. */
function bandPoint(frame: CatNeckFrame, angle: number): { x: number; y: number } {
  const { band, tilt } = frame;
  const lx = Math.cos(angle) * band.rx;
  const ly = Math.sin(angle) * band.ry;
  return {
    x: band.cx + lx * Math.cos(tilt) - ly * Math.sin(tilt),
    y: band.cy + lx * Math.sin(tilt) + ly * Math.cos(tilt),
  };
}

function strokeCollar(ctx: Ctx, frame: CatNeckFrame, from: number, to: number): void {
  const { band, tilt } = frame;
  ctx.beginPath();
  ctx.ellipse(band.cx, band.cy, band.rx, band.ry, tilt, from, to);
  ctx.strokeStyle = COLLAR_LEATHER;
  ctx.lineWidth = COLLAR_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function swingOf(context: GarmentFrameContext<'cat'>): number {
  return Math.max(-MAX_SWING, Math.min(MAX_SWING, -context.pose.sway * SWING_PER_SWAY));
}

function hangCharm(
  ctx: Ctx,
  look: CharmLook,
  frame: CatNeckFrame,
  context: GarmentFrameContext<'cat'>,
  squash: number,
): void {
  const at = bandPoint(frame, QUARTER_TURN + look.link * LINK_STEP);
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(swingOf(context));
  ctx.beginPath();
  ctx.arc(0, 0, JUMP_RING_RADIUS, 0, FULL_TURN);
  ctx.strokeStyle = SILVER.base;
  ctx.lineWidth = JUMP_RING_WIDTH;
  ctx.stroke();
  ctx.translate(0, CHARM_HANG * Math.max(LYING_HANG_SHARE, Math.cos(context.pose.roll)));
  ctx.scale(squash * CHARM_SCALE, CHARM_SCALE);
  look.paint(ctx);
  ctx.restore();
}

function defineCharm(look: CharmLook): WornGarmentDef<'cat'> {
  const front = (ctx: Ctx, frame: CatNeckFrame, context: GarmentFrameContext<'cat'>): void => {
    ctx.save();
    strokeCollar(ctx, frame, 0, HALF_TURN);
    hangCharm(ctx, look, frame, context, 1);
    ctx.restore();
  };
  const side = (ctx: Ctx, frame: CatNeckFrame, context: GarmentFrameContext<'cat'>): void => {
    ctx.save();
    strokeCollar(ctx, frame, -QUARTER_TURN, QUARTER_TURN);
    hangCharm(ctx, look, frame, context, PROFILE_SQUASH);
    ctx.restore();
  };
  const back = (ctx: Ctx, frame: CatNeckFrame): void => {
    ctx.save();
    strokeCollar(ctx, frame, 0, HALF_TURN);
    ctx.restore();
  };
  return defineGarment({
    id: look.id,
    name: look.name,
    wearer: 'cat',
    material: 'jewelry',
    layer: 'over',
    region: ['neck'],
    paint: { neck: withViewFallback({ front, side, back }, CAT_VIEW_FALLBACK) },
  });
}

/** Every trinket's charm, by id. */
export const CAT_CHARM_GARMENTS: Readonly<Record<CatCharmGarmentId, WornGarmentDef<'cat'>>> = {
  cat_nimble_bangle_charm: defineCharm({
    id: 'cat_nimble_bangle_charm',
    name: 'Nimble Bangle',
    link: -3,
    paint: paintBangle,
  }),
  cat_lucky_penny_charm: defineCharm({
    id: 'cat_lucky_penny_charm',
    name: 'Lucky Penny',
    link: -2,
    paint: paintPenny,
  }),
  cat_fang_charm: defineCharm({
    id: 'cat_fang_charm',
    name: 'Fang Charm',
    link: -1,
    paint: paintFang,
  }),
  cat_frostward_charm: defineCharm({
    id: 'cat_frostward_charm',
    name: 'Frostward Charm',
    link: 0,
    paint: paintFrostBead,
  }),
  cat_emberward_charm: defineCharm({
    id: 'cat_emberward_charm',
    name: 'Emberward Charm',
    link: 1,
    paint: paintEmberCage,
  }),
  cat_fae_iron_charm: defineCharm({
    id: 'cat_fae_iron_charm',
    name: 'Fae-Iron Charm',
    link: 2,
    paint: paintFaeIron,
  }),
  cat_hourglass_charm: defineCharm({
    id: 'cat_hourglass_charm',
    name: 'Hourglass Charm',
    link: 3,
    paint: paintHourglass,
  }),
};
