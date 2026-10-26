/**
 * The cat crawler's neck-slot pieces: each a pendant on its own chain or
 * thong, worn round her neck and dropping in a V to hang low at her throat,
 * under any trinket on her collar. Head-on and in profile the pendant hangs
 * over her bib; from behind only the chain shows across her nape. It swings a
 * little with her sway.
 *
 * At the tile a pendant is a few pixels, so the four are told apart by
 * silhouette and metal before detail: the moth's wide pale wings, the stone's
 * big grey lump on dark leather, and the two round lockets, gold and silver.
 *
 * Painted on her neck, after her body and before her head, so her chin and
 * cheek ruffs fall over the chain as they would over a collar.
 */

import type { CatNeckFrame } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import type { CatPendantGarmentId } from '../garmentIds';
import {
  defineGarment,
  type GarmentFrameContext,
  withViewFallback,
  type WornGarmentDef,
} from '../garmentDef';
import { GOLD, metalFill, paintGlint, SILVER, type MetalRamp } from './metalInk';

type Ctx = CanvasRenderingContext2D;
type Pt = { readonly x: number; readonly y: number };

const FULL_TURN = Math.PI * 2;
const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;

/** Paints one pendant hanging from its bail at the origin, +Y down. */
type PendantPainter = (ctx: Ctx) => void;

/** What a pendant hangs from: a fine metal chain, or a leather thong. */
interface Cord {
  readonly colour: string;
  /** The darker line under it, so a pale chain still parts from a pale bib. */
  readonly under: string;
  readonly width: number;
}

interface PendantLook {
  readonly id: CatPendantGarmentId;
  readonly name: string;
  readonly cord: Cord;
  readonly paint: PendantPainter;
  /** How far the pendant narrows seen edge-on in profile. */
  readonly profileSquash: number;
}

const CORD_UNDER_EXTRA = 0.008;
/**
 * How far either side of her throat the cord leaves the band to fall in a V
 * to the pendant, as a turn round the band.
 */
const V_SPREAD = 0.75;
/** How far below the band the V's point, and the pendant's bail, hangs. */
const V_DROP = 0.035;
/** How far her sway swings the pendant, as a turn of it per unit of sway. */
const SWING_PER_SWAY = 6;
const MAX_SWING = 0.3;
/** Lying on her side the pendant rests beside her neck: its drop shrinks with her roll, to this share at the most. */
const LYING_HANG_SHARE = 0.3;
/** In profile a flat pendant is seen partly edge-on. */
const PROFILE_SQUASH = 0.6;
/** The moth's wings spread far wider than a locket: edge-on they would stand off her chest. */
const MOTH_PROFILE_SQUASH = 0.35;
const GLINT_REACH = 0.02;

const SILVER_CHAIN: Cord = { colour: SILVER.light, under: SILVER.shadow, width: 0.014 };
const GOLD_CHAIN: Cord = { colour: GOLD.base, under: GOLD.shadow, width: 0.014 };
const LEATHER_THONG: Cord = { colour: '#9a6634', under: '#24140a', width: 0.018 };

const BAIL_RADIUS = 0.01;
const BAIL_WIDTH = 0.008;

function paintBail(ctx: Ctx, metal: MetalRamp): void {
  ctx.beginPath();
  ctx.arc(0, BAIL_RADIUS, BAIL_RADIUS, 0, FULL_TURN);
  ctx.strokeStyle = metal.base;
  ctx.lineWidth = BAIL_WIDTH;
  ctx.stroke();
}

const MOTH_PALE = '#c4f2b0';
const MOTH_DUSK = '#5eb878';
const MOTH_SPOT = '#2c3a5a';
const MOTH_BODY = '#7a7466';
/** The moth's forewings: broad and swept, much wider than they are tall, the mark of a moth over a butterfly. */
const FOREWING_RX = 0.07;
const FOREWING_RY = 0.032;
const FOREWING_OUT = 0.056;
const FOREWING_DOWN = 0.03;
const FOREWING_TILT = -0.35;
const HINDWING_RX = 0.036;
const HINDWING_RY = 0.028;
const HINDWING_OUT = 0.03;
const HINDWING_DOWN = 0.06;
const WING_SETTING = 0.014;
const EYESPOT_OUT = 0.066;
const EYESPOT_RADIUS = 0.014;
const MOTH_BODY_TOP = 0.018;
const MOTH_BODY_BOTTOM = 0.085;
const MOTH_BODY_WIDTH = 0.016;
const MOTH_WING_MID = 0.55;

function paintMothWing(ctx: Ctx, x: number, y: number, rx: number, ry: number, tilt: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, tilt, 0, FULL_TURN);
  const fill = ctx.createLinearGradient(x, y - ry, x, y + ry);
  fill.addColorStop(0, MOTH_PALE);
  fill.addColorStop(MOTH_WING_MID, MOTH_PALE);
  fill.addColorStop(1, MOTH_DUSK);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = SILVER.shadow;
  ctx.lineWidth = WING_SETTING;
  ctx.stroke();
}

function paintMoonmoth(ctx: Ctx): void {
  paintBail(ctx, SILVER);
  for (const side of [-1, 1]) {
    paintMothWing(ctx, side * HINDWING_OUT, HINDWING_DOWN, HINDWING_RX, HINDWING_RY, 0);
    paintMothWing(
      ctx,
      side * FOREWING_OUT,
      FOREWING_DOWN,
      FOREWING_RX,
      FOREWING_RY,
      side * FOREWING_TILT,
    );
    ctx.beginPath();
    ctx.arc(side * EYESPOT_OUT, FOREWING_DOWN, EYESPOT_RADIUS, 0, FULL_TURN);
    ctx.fillStyle = MOTH_SPOT;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(0, MOTH_BODY_TOP);
  ctx.lineTo(0, MOTH_BODY_BOTTOM);
  ctx.strokeStyle = MOTH_BODY;
  ctx.lineWidth = MOTH_BODY_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
  paintGlint(ctx, SILVER, -FOREWING_OUT, FOREWING_DOWN - FOREWING_RY, GLINT_REACH);
}

const STONE_LIGHT = '#e2ded2';
const STONE = '#a29e92';
const STONE_DARK = '#46433c';
const STONE_EDGE = '#141310';
/** The lump's outline: an uneven fist of rock, lopsided so it never reads as a coin or a bead. */
const STONE_OUTLINE: readonly Pt[] = [
  { x: -0.04, y: 0.008 },
  { x: 0.026, y: 0.004 },
  { x: 0.068, y: 0.032 },
  { x: 0.072, y: 0.07 },
  { x: 0.036, y: 0.106 },
  { x: -0.03, y: 0.102 },
  { x: -0.07, y: 0.068 },
  { x: -0.064, y: 0.028 },
];
/**
 * Heavy and near black, and the face pale above it: the dark rim is what
 * parts the stone from a cream bib, the pale face what parts it from black fur.
 */
const STONE_EDGE_WIDTH = 0.018;
/** The thong's knot where it binds the stone. */
const STONE_KNOT_RADIUS = 0.012;
/** A crack across the face of the stone: the one mark that says rock rather than lead. */
const STONE_CRACK: readonly Pt[] = [
  { x: -0.042, y: 0.05 },
  { x: -0.008, y: 0.064 },
  { x: 0.016, y: 0.05 },
  { x: 0.044, y: 0.076 },
];
const STONE_CRACK_WIDTH = 0.007;
const STONE_LIT_UNTIL = 0.3;
const STONE_SHADE_FROM = 0.72;

function tracePolyline(ctx: Ctx, points: readonly Pt[]): void {
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
}

function paintStoneheart(ctx: Ctx): void {
  ctx.beginPath();
  tracePolyline(ctx, STONE_OUTLINE);
  ctx.closePath();
  const top = Math.min(...STONE_OUTLINE.map((point) => point.y));
  const bottom = Math.max(...STONE_OUTLINE.map((point) => point.y));
  const fill = ctx.createLinearGradient(-STONE_KNOT_RADIUS, top, STONE_KNOT_RADIUS, bottom);
  fill.addColorStop(0, STONE_LIGHT);
  fill.addColorStop(STONE_LIT_UNTIL, STONE);
  fill.addColorStop(STONE_SHADE_FROM, STONE);
  fill.addColorStop(1, STONE_DARK);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = STONE_EDGE;
  ctx.lineWidth = STONE_EDGE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.beginPath();
  tracePolyline(ctx, STONE_CRACK);
  ctx.strokeStyle = STONE_DARK;
  ctx.lineWidth = STONE_CRACK_WIDTH;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, STONE_KNOT_RADIUS, STONE_KNOT_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = LEATHER_THONG.colour;
  ctx.fill();
  ctx.strokeStyle = LEATHER_THONG.under;
  ctx.lineWidth = BAIL_WIDTH;
  ctx.stroke();
}

const LOCKET_RADIUS = 0.048;
const LOCKET_RIM_WIDTH = 0.01;
/** The lid's emblem, inset from the rim. */
const EMBLEM_RADIUS = 0.02;
const SUN_RAYS = 8;
const SUN_RAY_REACH = 0.04;
const RAY_WIDTH = 0.007;
/** The crescent: a disc with a second, offset disc cut out of it. */
const CRESCENT_RADIUS = 0.028;
const CRESCENT_BITE_OFFSET = 0.014;

function paintLocketCase(ctx: Ctx, metal: MetalRamp): number {
  paintBail(ctx, metal);
  const cy = BAIL_RADIUS * 2 + LOCKET_RADIUS;
  ctx.beginPath();
  ctx.arc(0, cy, LOCKET_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = metalFill(
    ctx,
    metal,
    -LOCKET_RADIUS,
    cy - LOCKET_RADIUS,
    LOCKET_RADIUS,
    cy + LOCKET_RADIUS,
  );
  ctx.fill();
  ctx.strokeStyle = metal.shadow;
  ctx.lineWidth = LOCKET_RIM_WIDTH;
  ctx.stroke();
  return cy;
}

function paintSunLocket(ctx: Ctx): void {
  const cy = paintLocketCase(ctx, GOLD);
  ctx.strokeStyle = GOLD.shadow;
  ctx.lineWidth = RAY_WIDTH;
  ctx.lineCap = 'round';
  for (let ray = 0; ray < SUN_RAYS; ray++) {
    const angle = (ray / SUN_RAYS) * FULL_TURN;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * EMBLEM_RADIUS, cy + Math.sin(angle) * EMBLEM_RADIUS);
    ctx.lineTo(Math.cos(angle) * SUN_RAY_REACH, cy + Math.sin(angle) * SUN_RAY_REACH);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, cy, EMBLEM_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = GOLD.light;
  ctx.fill();
  ctx.strokeStyle = GOLD.shadow;
  ctx.stroke();
  paintGlint(ctx, GOLD, -LOCKET_RADIUS / 2, cy - LOCKET_RADIUS / 2, GLINT_REACH);
}

function paintMoonLocket(ctx: Ctx): void {
  const cy = paintLocketCase(ctx, SILVER);
  ctx.beginPath();
  ctx.arc(0, cy, CRESCENT_RADIUS, 0, FULL_TURN);
  ctx.arc(CRESCENT_BITE_OFFSET, cy - CRESCENT_BITE_OFFSET / 2, CRESCENT_RADIUS, 0, FULL_TURN, true);
  ctx.fillStyle = SILVER.shadow;
  ctx.fill('evenodd');
  paintGlint(ctx, SILVER, -LOCKET_RADIUS / 2, cy - LOCKET_RADIUS / 2, GLINT_REACH);
}

/** The point on the band at `angle`, in pose space. */
function bandPoint(frame: CatNeckFrame, angle: number): Pt {
  const { band, tilt } = frame;
  const lx = Math.cos(angle) * band.rx;
  const ly = Math.sin(angle) * band.ry;
  return {
    x: band.cx + lx * Math.cos(tilt) - ly * Math.sin(tilt),
    y: band.cy + lx * Math.sin(tilt) + ly * Math.cos(tilt),
  };
}

function strokeCord(ctx: Ctx, cord: Cord, trace: () => void): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  trace();
  ctx.strokeStyle = cord.under;
  ctx.lineWidth = cord.width + CORD_UNDER_EXTRA;
  ctx.stroke();
  ctx.beginPath();
  trace();
  ctx.strokeStyle = cord.colour;
  ctx.lineWidth = cord.width;
  ctx.stroke();
}

/** The arc of the cord round her neck, from `from` to `to` round the band. */
function traceBand(ctx: Ctx, frame: CatNeckFrame, from: number, to: number): void {
  const { band, tilt } = frame;
  ctx.ellipse(band.cx, band.cy, band.rx, band.ry, tilt, from, to);
}

function hangDrop(context: GarmentFrameContext<'cat'>): number {
  return Math.max(LYING_HANG_SHARE, Math.cos(context.pose.roll));
}

function swingOf(context: GarmentFrameContext<'cat'>): number {
  return Math.max(-MAX_SWING, Math.min(MAX_SWING, -context.pose.sway * SWING_PER_SWAY));
}

/** Where on the band a pendant hangs, and how far below it the cord's V drops it. */
interface Hang {
  readonly angle: number;
  readonly drop: number;
}

/** Head-on the pendant hangs at her throat, the cord falling to it in a V. */
const FRONT_HANG: Hang = { angle: QUARTER_TURN, drop: V_DROP };
/**
 * In profile the band runs down the front of her neck to her chest, so a
 * pendant hung from its lower end, let alone dropped below it, dangles
 * between her forelegs: it hangs from partway up the band instead, at her
 * throat, with no V.
 */
const PROFILE_HANG: Hang = { angle: QUARTER_TURN * 0.35, drop: 0 };

/**
 * The cord round the visible arc of her neck and, for a hang with a drop,
 * falling in a V from either side of the hang point to the pendant.
 */
function hangPendant(
  ctx: Ctx,
  look: PendantLook,
  frame: CatNeckFrame,
  context: GarmentFrameContext<'cat'>,
  arc: { readonly from: number; readonly to: number },
  hang: Hang,
  squash: number,
): void {
  const anchor = bandPoint(frame, hang.angle);
  const drop = hang.drop * hangDrop(context);
  const point = { x: anchor.x, y: anchor.y + drop };
  strokeCord(ctx, look.cord, () => {
    traceBand(ctx, frame, arc.from, arc.to);
  });
  if (drop > 0) {
    const leftArm = bandPoint(frame, hang.angle + V_SPREAD);
    const rightArm = bandPoint(frame, hang.angle - V_SPREAD);
    strokeCord(ctx, look.cord, () => {
      ctx.moveTo(leftArm.x, leftArm.y);
      ctx.lineTo(point.x, point.y);
      ctx.lineTo(rightArm.x, rightArm.y);
    });
  }
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(swingOf(context));
  ctx.scale(squash, 1);
  look.paint(ctx);
  ctx.restore();
}

function definePendant(look: PendantLook): WornGarmentDef<'cat'> {
  const front = (ctx: Ctx, frame: CatNeckFrame, context: GarmentFrameContext<'cat'>): void => {
    ctx.save();
    hangPendant(ctx, look, frame, context, { from: 0, to: HALF_TURN }, FRONT_HANG, 1);
    ctx.restore();
  };
  const side = (ctx: Ctx, frame: CatNeckFrame, context: GarmentFrameContext<'cat'>): void => {
    ctx.save();
    hangPendant(
      ctx,
      look,
      frame,
      context,
      { from: -QUARTER_TURN, to: QUARTER_TURN },
      PROFILE_HANG,
      look.profileSquash,
    );
    ctx.restore();
  };
  const back = (ctx: Ctx, frame: CatNeckFrame): void => {
    ctx.save();
    strokeCord(ctx, look.cord, () => {
      traceBand(ctx, frame, 0, HALF_TURN);
    });
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

/** Every neck-slot pendant, by id. */
export const CAT_PENDANT_GARMENTS: Readonly<Record<CatPendantGarmentId, WornGarmentDef<'cat'>>> = {
  cat_moonmoth_pendant: definePendant({
    id: 'cat_moonmoth_pendant',
    name: 'Moonmoth Pendant',
    cord: SILVER_CHAIN,
    paint: paintMoonmoth,
    profileSquash: MOTH_PROFILE_SQUASH,
  }),
  cat_stoneheart_amulet: definePendant({
    id: 'cat_stoneheart_amulet',
    name: 'Stoneheart Amulet',
    cord: LEATHER_THONG,
    paint: paintStoneheart,
    profileSquash: PROFILE_SQUASH,
  }),
  cat_sun_locket: definePendant({
    id: 'cat_sun_locket',
    name: 'Sun Locket',
    cord: GOLD_CHAIN,
    paint: paintSunLocket,
    profileSquash: PROFILE_SQUASH,
  }),
  cat_moon_locket: definePendant({
    id: 'cat_moon_locket',
    name: 'Moon Locket',
    cord: SILVER_CHAIN,
    paint: paintMoonLocket,
    profileSquash: PROFILE_SQUASH,
  }),
};
