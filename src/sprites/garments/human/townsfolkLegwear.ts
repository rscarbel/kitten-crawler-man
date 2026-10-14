/**
 * Trousers (or stockings) and shoes for the people built on Carl's rig — the
 * town's citizens and residents, the club dancer, the Incubus. Never his:
 * Carl is canonically bare-legged and barefoot, and nothing he can loot paints
 * these.
 *
 * Both are painted on the leg part, inside each leg's own slab and right after
 * the bare leg it covers, so they follow every knee bend, foot plant and slab
 * order of the pose. The cloth is the rig's own leg contour grown by a cloth
 * margin (`legCover`), so no calf belly or quad sweep shows past it in any
 * view or gait; the shoe is the boot painter's foot, which is built on the
 * bare foot's own measures.
 *
 * A cell is shared by every figure drawn with it, so the colours are not read
 * per instance: like the rig's skin and jacket ramps they are live module
 * state, set by the figure's painter round its draw and reset after it.
 */

import type { CarlLegFrame } from '../../art/carl/carlParts';
import { legCover, type LegCoverSegment } from '../../art/carl/limbs';
import { crease, shadeForm } from '../../art/carl/paint';
import { deriveGlossRamp, deriveRamp, type GlossRamp } from '../../art/carl/palette';
import { mix, rgba } from '../../art/carlArt';
import { footSoleLandmarks } from '../../art/carl/feet';
import type { LegwearCut } from '../../art/human/legwear';
import { defineGarment } from '../garmentDef';
import { type BootLook, paintBootOnLeg } from './carlBoots';
import { carlEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/** What a figure on Carl's rig wears on its legs and feet. */
export interface TownsfolkLegwear {
  readonly cloth: GlossRamp;
  readonly cut: LegwearCut;
  readonly footwear: GlossRamp;
  /** Pasture mud caked on the shoes and flicked up the cuffs. */
  readonly muddy: boolean;
}

/** Plain charcoal wool and dark leather: what the garments paint with when no figure has set its own. */
const DEFAULT_LEGWEAR: TownsfolkLegwear = {
  cloth: deriveGlossRamp('#3a3a44'),
  cut: 'trousers',
  footwear: deriveGlossRamp('#3a2a1e'),
  muddy: false,
};

let worn: TownsfolkLegwear = DEFAULT_LEGWEAR;

/** Sets the legwear every subsequent paint of these garments reads, until {@link resetTownsfolkLegwear}. */
export function setTownsfolkLegwear(legwear: TownsfolkLegwear): void {
  worn = legwear;
}

/** Restores the default legwear — call after every bake that set its own. */
export function resetTownsfolkLegwear(): void {
  worn = DEFAULT_LEGWEAR;
}

/**
 * How much fuller than the bare leg each cut stands: loose trousers clear the
 * muscle by a good margin, stockings hug it. The margin is in figure units, so
 * the slim ankle is covered as surely as the broad thigh.
 */
const COVER: Readonly<Record<LegwearCut, { grow: number; margin: number }>> = {
  trousers: { grow: 1.08, margin: 0.018 },
  stockings: { grow: 1.02, margin: 0.012 },
};
const CLOTH_SPECULAR = 0.25;
/** The fold behind the knee, across the top of the shin. */
const KNEE_FOLD_ALONG = 0.06;
const KNEE_FOLD_WIDTH = 0.012;
const KNEE_FOLD_OPACITY = 0.45;

function nearnessOf(frame: CarlLegFrame): number {
  return frame.drawn === 'left' ? frame.pose.leftLegNearness : frame.pose.rightLegNearness;
}

function paintCover(ctx: Ctx, frame: CarlLegFrame, segment: LegCoverSegment): void {
  const { grow, margin } = COVER[worn.cut];
  const cover = legCover(
    ctx,
    frame.chain,
    frame.view,
    frame.footOut,
    nearnessOf(frame),
    segment,
    grow,
    margin,
  );
  const { joint, end } = frame.chain;
  shadeForm(
    ctx,
    cover.trace,
    cover.axis,
    worn.cloth,
    { halfWidth: cover.axis.halfWidth, specular: CLOTH_SPECULAR },
    segment === 'shin'
      ? () =>
          crease(
            ctx,
            () => {
              const foldX = joint.x + (end.x - joint.x) * KNEE_FOLD_ALONG;
              const foldY = joint.y + (end.y - joint.y) * KNEE_FOLD_ALONG;
              ctx.moveTo(foldX - cover.axis.halfWidth, foldY);
              ctx.lineTo(foldX + cover.axis.halfWidth, foldY);
            },
            KNEE_FOLD_WIDTH,
            worn.cloth,
            KNEE_FOLD_OPACITY,
          )
      : undefined,
  );
}

function paintCloth(ctx: Ctx, frame: CarlLegFrame): void {
  // A knee driven at the camera is shaded over the shin after the leg is
  // dressed, so the shin is laid again over that shading.
  if (frame.piece === 'kneeAtCamera') {
    paintCover(ctx, frame, 'shin');
    return;
  }
  if (frame.segments !== 'lower') paintCover(ctx, frame, 'thigh');
  if (frame.segments !== 'thigh') paintCover(ctx, frame, 'shin');
}

/** A plain low shoe: the trouser cuff covers the ankle, so its shaft stops just above it. */
const SHOE_SHAFT_TOP_AT = 0.8;
/** The sole is the upper's leather taken most of the way to near-black. */
const SOLE_DARKEN_TOWARD = '#120d0b';
const SOLE_DARKEN = 0.7;

function shoeLook(): BootLook {
  return {
    leather: worn.footwear,
    sole: deriveRamp(mix(worn.footwear.base, SOLE_DARKEN_TOWARD, SOLE_DARKEN)),
    shaftTopAt: SHOE_SHAFT_TOP_AT,
    hobnails: false,
  };
}

/** Wet pasture mud: darker and warmer than any trouser colour, so it reads on dark shoes too. */
const MUD_COLOR = '#6a5236';
const MUD_ALPHA = 0.9;
/** Mud cakes the sole and the lower half of the shoe, never the whole of it. */
const MUD_HALF_HEIGHT = 0.03;
const MUD_LENGTH_SHARE = 0.55;
/** Head-on and from behind the sole is seen end-on: the cake is as wide as the foot. */
const MUD_MIN_HALF_LENGTH = 0.06;
/** Splashes flicked up the cuff above each shoe: how far up the shin, and how far off it. */
const MUD_SPLASH_RADIUS = 0.014;
const MUD_SPLASHES: readonly { readonly up: number; readonly across: number }[] = [
  { up: 0.07, across: -0.05 },
  { up: 0.1, across: 0.035 },
  { up: 0.055, across: 0.06 },
];

/**
 * Cakes the shoe just painted on `frame` in mud: along the sole the foot
 * stands on, and in splashes up the shin above it. Placed from the same sole
 * landmarks and foot scale the shoe is built on, so the mud stays on the shoe
 * through every plant and lift of the stride.
 */
function paintMud(ctx: Ctx, frame: CarlLegFrame): void {
  const { chain, view, footScale } = frame;
  const point =
    (frame.drawn === 'left' ? frame.pose.leftFootPoint : frame.pose.rightFootPoint) ?? 0;
  const landmarks = footSoleLandmarks(chain.end, frame.footPitch, view, frame.footOut, point);
  const scaled = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: chain.end.x + (p.x - chain.end.x) * footScale,
    y: chain.end.y + (p.y - chain.end.y) * footScale,
  });
  const heel = scaled(landmarks.heel);
  const toe = scaled(landmarks.toe);
  const halfLength = Math.max(
    (Math.hypot(toe.x - heel.x, toe.y - heel.y) / 2) * MUD_LENGTH_SHARE,
    MUD_MIN_HALF_LENGTH * footScale,
  );
  const halfHeight = MUD_HALF_HEIGHT * footScale;
  const soleAngle = Math.atan2(toe.y - heel.y, toe.x - heel.x);
  ctx.fillStyle = rgba(MUD_COLOR, MUD_ALPHA);
  ctx.beginPath();
  ctx.ellipse(
    (heel.x + toe.x) / 2,
    (heel.y + toe.y) / 2 - halfHeight,
    halfLength,
    halfHeight,
    soleAngle,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  const shinX = chain.joint.x - chain.end.x;
  const shinY = chain.joint.y - chain.end.y;
  const shinLength = Math.hypot(shinX, shinY);
  if (shinLength === 0) return;
  const upX = shinX / shinLength;
  const upY = shinY / shinLength;
  for (const splash of MUD_SPLASHES) {
    ctx.beginPath();
    ctx.arc(
      chain.end.x + upX * splash.up - upY * splash.across,
      chain.end.y + upY * splash.up + upX * splash.across,
      MUD_SPLASH_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function paintShoe(ctx: Ctx, frame: CarlLegFrame): void {
  if (frame.piece === 'kneeAtCamera' || frame.segments === 'thigh') return;
  paintBootOnLeg(ctx, frame, shoeLook());
  if (worn.muddy) paintMud(ctx, frame);
}

export const TOWNSFOLK_TROUSERS = defineGarment({
  id: 'townsfolk_trousers',
  name: 'Townsfolk trousers',
  wearer: 'human',
  material: 'cloth',
  layer: 'over',
  region: ['leg'],
  paint: { leg: carlEveryView(paintCloth) },
});

export const TOWNSFOLK_SHOES = defineGarment({
  id: 'townsfolk_shoes',
  name: 'Townsfolk shoes',
  wearer: 'human',
  material: 'leather',
  layer: 'outer',
  region: ['leg'],
  hides: [
    { kind: 'garment', garment: 'carl_toe_ring' },
    { kind: 'garment', garment: 'carl_pedicure' },
  ],
  paint: { leg: carlEveryView(paintShoe) },
});
