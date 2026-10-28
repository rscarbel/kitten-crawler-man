/**
 * A fitted, cropped wine-red twill jacket, the base garment over the female
 * crawler's torso: cut to her waist, closed by a slim cognac belt there and
 * ending just below it, over the top of her high-waisted trousers. It lies
 * open at the neck over an ivory crew-neck top, its lapels turned back
 * either side of it, with long sleeves to the wrist.
 *
 * The belt is what carries the cut at the tile: a dark band at the narrowest
 * point of her torso, the wine cloth widening above it to the chest and the
 * trousers below it to her hips, reads as a waist where a plain jacket of the
 * same outline reads as a box.
 */

import type { BipedTorsoFrame } from '../../art/biped/bipedParts';
import { pt } from '../../art/biped/geometry';
import { crease } from '../../art/biped/paint';
import type { GlossRamp, Ramp } from '../../art/biped/palette';
import { NECK_WIDTH } from '../../art/biped/proportions';
import type { ViewSpec } from '../../art/biped/rig';
import { LEATHER_SLEEVE_CONTRAST, type SleeveCut } from '../../art/biped/sleeve';
import {
  OPEN_NECK_DEPTH,
  openNeckCorners,
  paintJacket,
  traceGarmentTorso,
  traceOpenNeck,
  type TorsoFrame,
} from '../../art/biped/torso';
import { type Pt, rgba } from '../../art/bipedArt';
import { withClip } from '../../art/softShade';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import { fillPolygon, strokeLine } from './torsoCover';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/**
 * Wine-red twill. A mid value, so the jacket stands clear of the dark floor
 * and of the ivory top in its open neck alike, and warm, so beside the male
 * crawler's light-blue shirt the two read apart at a glance. The light steps
 * climb well clear of the base: a sleeve is two pixels across at the tile,
 * and a red whose light sits close to its base reads there as a flat strip.
 * Twill is matte: its specular sits below the light step, or the chest
 * shines like leather.
 */
export const WINE_TWILL: GlossRamp = {
  deep: '#1f0910',
  shadow: '#33101a',
  dark: '#4a1724',
  mid: '#62202f',
  base: '#8f3448',
  light: '#c66b7b',
  rim: '#e0919d',
  specular: '#ad5263',
};

/** How far the sleeve runs down the forearm: to just short of the wrist bone. */
const WRIST_LENGTH_SLEEVE = 0.82;
/** A tailored cuff: a slim band, only a little proud of the sleeve. */
const TAILORED_CUFF_BULK = 1;
/**
 * Twill stands only a little off her arm: padded like leather a slim arm's
 * sleeve balloons, and lying flat on it the forearm is too few pixels across
 * at the tile to turn from light to shade.
 */
const TAILORED_PADDING = 0.3;
/** A soft shoulder: the cap rounds over her deltoid without a pad's shelf. */
const TAILORED_CAP_SWELL = 0.2;
/** Her shoulders slope, and the soft cap follows them out over the arm. */
const TAILORED_CAP_SLOPE = 1;
/**
 * The sleeve takes the cloth's whole ramp: it covers her forearm, which is
 * three pixels across at the tile, and shaded as softly as rolled cotton it
 * reads there as a flat strip with no form.
 */
const TWILL_SLEEVE_CONTRAST = LEATHER_SLEEVE_CONTRAST;

/** The jacket's long sleeves, ending in a slim cuff short of the wrist. */
export const TAILORED_SLEEVE: SleeveCut = {
  cuffAlongForearm: WRIST_LENGTH_SLEEVE,
  cuffBulk: TAILORED_CUFF_BULK,
  padding: TAILORED_PADDING,
  capSwell: TAILORED_CAP_SWELL,
  capSlope: TAILORED_CAP_SLOPE,
  shadeContrast: TWILL_SLEEVE_CONTRAST,
};

/** A plain ivory knit, cool in its shade so it never reads as skin. */
const IVORY: Ramp = {
  deep: '#7f7a70',
  shadow: '#a39d92',
  dark: '#c2bcb0',
  mid: '#d8d2c6',
  base: '#ece6da',
  light: '#f6f2ea',
  rim: '#ffffff',
};

/** A slim cognac belt and its small brass buckle. */
export const JACKET_BELT_LEATHER = '#6a3a1c';
const BELT_LIT = '#9c6236';
const BUCKLE = '#e0bd6a';
const BUCKLE_SHADE = '#8f6c2a';

/** The jacket wraps the neck at about the shirt collar's own width. */
const NECK_WRAP = 1.15;
/**
 * The top's crew neck shows as a curved line across the base of the throat,
 * its control point this far down the torso, so the top reads as a top and
 * not as a bib filling the V.
 */
const CREW_NECK_CONTROL_Y = 0.03;
const CREW_NECK_WIDTH = 0.012;

/**
 * The lapels head-on: each turned back from the neck corner of the V, out
 * across the chest to its notch and back in to the V's point.
 */
const LAPEL_OUTER_X = 1.9;
const LAPEL_OUTER_Y = 0.06;
const LAPEL_POINT_SHARE = 0.95;
/** The shadow each lapel casts on the jacket just outside its edge. */
const LAPEL_SHADOW_WIDTH = 0.018;
const LAPEL_SHADOW_OPACITY = 0.55;

/** The front edge where the jacket closes, from the V's point to the hem. */
const FRONT_EDGE_WIDTH = 0.014;
const FRONT_EDGE_OPACITY = 0.7;

/** The belt's height and where its middle sits, at her waist. */
const BELT_HEIGHT = 0.04;
/** The lit top edge of the belt, a sliver of its height. */
const BELT_LIP_SHARE = 0.3;
const BELT_LIP_ALPHA = 0.85;
/** The belt runs on past her sides so the torso's clip, not the band's end, finishes it. */
const BELT_OVERREACH = 0.6;
/** The buckle head-on: a small square of brass a little taller than the belt. */
const BUCKLE_HALF_WIDTH = 0.024;
const BUCKLE_RISE = 0.006;
const BUCKLE_FRAME = 0.01;
/** Edge-on the buckle sits just in from the front of her waist. */
const PROFILE_BUCKLE_X = 0.16;
const PROFILE_BUCKLE_HALF_WIDTH = 0.012;

/** Edge-on, the lapel is a sliver turned back along the front of the chest. */
const PROFILE_LAPEL = [pt(0.05, -0.03), pt(0.12, -0.02), pt(0.2, 0.1), pt(0.11, 0.09)] as const;

/** The collar's stand round the back of her neck, seen from behind. */
const COLLAR_STAND_TOP_Y = -0.085;
const COLLAR_STAND_BOTTOM_Y = -0.01;
const COLLAR_STAND_HUG = 0.86;
const COLLAR_STAND_LIP_WIDTH = 0.012;
/** Edge-on the collar stands round the neck and rolls into the lapel. */
const PROFILE_COLLAR = [
  pt(-0.12, 0.0),
  pt(-0.11, -0.055),
  pt(0.06, -0.035),
  pt(0.08, 0.0),
] as const;

function neckHalf(view: ViewSpec): number {
  return NECK_WIDTH * view.girth * NECK_WRAP;
}

/** The open neck filled with the ivory top, its crew neck curving across the throat. */
function paintTopInNeck(ctx: Ctx, torso: TorsoFrame, view: ViewSpec): void {
  traceOpenNeck(ctx, torso, view);
  ctx.fillStyle = IVORY.base;
  ctx.fill();
  if (view.profile) return;
  const [left, right] = openNeckCorners(torso, view, 1, 1);
  const dip = torso.at(0, CREW_NECK_CONTROL_Y);
  ctx.strokeStyle = IVORY.shadow;
  ctx.lineWidth = CREW_NECK_WIDTH;
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.quadraticCurveTo(dip.x, dip.y, right.x, right.y);
  ctx.stroke();
}

/** One lapel head-on, `side` −1 or +1 across her. */
function lapel(torso: TorsoFrame, view: ViewSpec, side: number): Pt[] {
  const half = neckHalf(view);
  const [left, right, point] = openNeckCorners(torso, view, 1, LAPEL_POINT_SHARE);
  const corner = side < 0 ? left : right;
  return [corner, torso.at(side * half * LAPEL_OUTER_X, LAPEL_OUTER_Y), point];
}

function paintLapels(ctx: Ctx, torso: TorsoFrame, view: ViewSpec): void {
  for (const side of [-1, 1]) {
    const [corner, outer, point] = lapel(torso, view, side);
    crease(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(outer.x, outer.y);
        ctx.lineTo(point.x, point.y);
      },
      LAPEL_SHADOW_WIDTH,
      torso.material,
      LAPEL_SHADOW_OPACITY,
    );
    fillPolygon(ctx, [corner, outer, point], side < 0 ? torso.material.light : torso.material.mid);
  }
}

function paintFrontEdge(ctx: Ctx, torso: TorsoFrame): void {
  const top = torso.at(0, OPEN_NECK_DEPTH);
  const bottom = torso.hem(0);
  crease(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
    },
    FRONT_EDGE_WIDTH,
    torso.material,
    FRONT_EDGE_OPACITY,
  );
}

function paintBuckle(ctx: Ctx, torso: TorsoFrame, centreX: number, halfWidth: number): void {
  const top = torso.waistY - BELT_HEIGHT / 2 - BUCKLE_RISE;
  const bottom = torso.waistY + BELT_HEIGHT / 2 + BUCKLE_RISE;
  const { at } = torso;
  fillPolygon(
    ctx,
    [
      at(centreX - halfWidth, top),
      at(centreX + halfWidth, top),
      at(centreX + halfWidth, bottom),
      at(centreX - halfWidth, bottom),
    ],
    BUCKLE,
  );
  const inset = Math.min(BUCKLE_FRAME, halfWidth / 2);
  fillPolygon(
    ctx,
    [
      at(centreX - halfWidth + inset, top + inset),
      at(centreX + halfWidth - inset, top + inset),
      at(centreX + halfWidth - inset, bottom - inset),
      at(centreX - halfWidth + inset, bottom - inset),
    ],
    BUCKLE_SHADE,
  );
}

/** The slim belt at her waist, run past her sides for the torso's clip to end. */
function paintBelt(ctx: Ctx, torso: TorsoFrame, view: ViewSpec): void {
  const top = torso.waistY - BELT_HEIGHT / 2;
  const bottom = torso.waistY + BELT_HEIGHT / 2;
  const { at } = torso;
  fillPolygon(
    ctx,
    [
      at(-BELT_OVERREACH, top),
      at(BELT_OVERREACH, top),
      at(BELT_OVERREACH, bottom),
      at(-BELT_OVERREACH, bottom),
    ],
    JACKET_BELT_LEATHER,
  );
  strokeLine(
    ctx,
    [at(-BELT_OVERREACH, top), at(BELT_OVERREACH, top)],
    rgba(BELT_LIT, BELT_LIP_ALPHA),
    BELT_HEIGHT * BELT_LIP_SHARE,
  );
  if (view.showsBack) return;
  if (view.profile) {
    paintBuckle(ctx, torso, PROFILE_BUCKLE_X * torso.cut.profileDepth, PROFILE_BUCKLE_HALF_WIDTH);
  } else paintBuckle(ctx, torso, 0, BUCKLE_HALF_WIDTH);
}

function paintProfileLapel(ctx: Ctx, torso: TorsoFrame): void {
  const depth = torso.cut.profileDepth;
  fillPolygon(
    ctx,
    PROFILE_LAPEL.map((p) => torso.at(p.x * depth, p.y)),
    torso.material.light,
  );
}

function paintJacketBody(
  ctx: Ctx,
  frame: BipedTorsoFrame,
  context: GarmentFrameContext<'human'>,
): void {
  const { skeleton, view, look, torso } = frame;
  paintJacket(ctx, skeleton, context.pose, view, look);
  withClip(
    ctx,
    () => traceGarmentTorso(ctx, skeleton, context.pose, view, look),
    () => {
      if (view.profile) {
        paintTopInNeck(ctx, torso, view);
        paintProfileLapel(ctx, torso);
      } else if (!view.showsBack) {
        paintFrontEdge(ctx, torso);
        paintTopInNeck(ctx, torso, view);
        paintLapels(ctx, torso, view);
      }
      paintBelt(ctx, torso, view);
    },
  );
}

/** The collar's stand round the back of the neck, seen from behind, lit along its fold. */
function paintCollarStand(ctx: Ctx, torso: TorsoFrame, view: ViewSpec): void {
  const half = neckHalf(view);
  const topHalf = half * COLLAR_STAND_HUG;
  const { at } = torso;
  const band = [
    at(-topHalf, COLLAR_STAND_TOP_Y),
    at(topHalf, COLLAR_STAND_TOP_Y),
    at(half, COLLAR_STAND_BOTTOM_Y),
    at(-half, COLLAR_STAND_BOTTOM_Y),
  ];
  fillPolygon(ctx, band, torso.material.base);
  strokeLine(ctx, [band[0], band[1]], torso.material.light, COLLAR_STAND_LIP_WIDTH);
}

function paintCollarProfile(ctx: Ctx, torso: TorsoFrame): void {
  const depth = torso.cut.profileDepth;
  fillPolygon(
    ctx,
    PROFILE_COLLAR.map((p) => torso.at(p.x * depth, p.y)),
    torso.material.base,
  );
}

function paintTorso(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  if (frame.piece === 'jacket') paintJacketBody(ctx, frame, context);
  else if (frame.piece === 'collar') {
    if (frame.view.profile) paintCollarProfile(ctx, frame.torso);
    else if (frame.view.showsBack) paintCollarStand(ctx, frame.torso, frame.view);
  }
}

export const BELTED_TWILL_JACKET = defineGarment({
  id: 'belted_twill_jacket',
  name: 'Belted twill jacket',
  wearer: 'human',
  base: true,
  layer: 'over',
  region: ['torso'],
  covers: ['chest'],
  paint: { torso: humanEveryView(paintTorso) },
});
