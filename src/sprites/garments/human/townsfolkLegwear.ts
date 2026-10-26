/**
 * Trousers (or stockings) and shoes for the people built on the biped rig —
 * the town's citizens and residents, the club dancer, the Incubus — and the
 * leg painter a look's own trousers are cut with. Nothing a crawler can loot
 * paints these.
 *
 * Both are painted on the leg part, inside each leg's own slab and right after
 * the bare leg it covers, so they follow every knee bend, foot plant and slab
 * order of the pose. The cloth is the rig's own leg contour grown by a cloth
 * margin (`legCover`), so no calf belly or quad sweep shows past it in any
 * view or gait; the shoe is the boot painter's foot, which is built on the
 * bare foot's own measures.
 *
 * The painters take their colours as arguments. The two cast garments read
 * theirs from live module state, set by the cast figure's painter round its
 * draw and reset after it, because every look of the cast shares one garment.
 */

import type { BipedLegFrame } from '../../art/biped/bipedParts';
import { legCover, type LegCoverSegment } from '../../art/biped/limbs';
import { crease, shadeForm } from '../../art/biped/paint';
import { deriveGlossRamp, deriveRamp, type GlossRamp } from '../../art/biped/palette';
import { mix, type Pt, rgba } from '../../art/bipedArt';
import { footSoleLandmarks } from '../../art/biped/feet';
import { LEG_COVER, type LegwearCut } from '../../art/human/legwear';
import { defineGarment } from '../garmentDef';
import { BOOT_SOLE, type BootLook, paintBootOnLeg } from './footwear';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/** What a pair of trouser or stocking legs is cut from. */
export interface LegCloth {
  readonly cloth: GlossRamp;
  readonly cut: LegwearCut;
}

/** What a figure on the biped rig wears on its legs and feet. */
export interface TownsfolkLegwear extends LegCloth {
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

const CLOTH_SPECULAR = 0.25;
/**
 * The fold behind the knee, across the top of the shin: a soft one, or the
 * leg reads as a doll's, jointed at the knee.
 */
const KNEE_FOLD_ALONG = 0.06;
const KNEE_FOLD_WIDTH = 0.012;
const KNEE_FOLD_OPACITY = 0.2;

function nearnessOf(frame: BipedLegFrame): number {
  return frame.drawn === 'left' ? frame.pose.leftLegNearness : frame.pose.rightLegNearness;
}

function paintCover(
  ctx: Ctx,
  frame: BipedLegFrame,
  segment: LegCoverSegment,
  { cloth, cut }: LegCloth,
): void {
  const { grow, margin, terminator } = LEG_COVER[cut];
  const cover = legCover(
    ctx,
    frame.chain,
    frame.view,
    frame.footOut,
    nearnessOf(frame),
    segment,
    grow,
    margin,
    frame.look.limbs,
  );
  const { root, joint, end } = frame.chain;
  const trousers = cut !== 'stockings';
  // Head-on a trouser leg is one tube of cloth hanging from the hip: thigh
  // and shin take their light across one line, down the whole leg, or the
  // two covers' own lights meet at the knee at an angle in a step that joints
  // the leg. Edge-on the knee bends in the picture, and each cover takes the
  // light across its own bone.
  const axis = trousers && !frame.view.profile ? { from: root, to: end } : cover.axis;
  ctx.save();
  // Only a standing leg seen head-on is cut at the knee: a knee bent in the
  // picture, or driven at the camera, is covered by the shin's own top, and
  // cut there it leaves the bare knee showing through the trousers.
  if (segment === 'shin' && trousers && !frame.view.profile && frame.piece === 'leg') {
    clipBelowKnee(ctx, root, joint);
  }
  shadeForm(
    ctx,
    cover.trace,
    axis,
    cloth,
    { halfWidth: cover.axis.halfWidth, specular: CLOTH_SPECULAR, terminator },
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
            cloth,
            KNEE_FOLD_OPACITY,
          )
      : undefined,
  );
  ctx.restore();
}

/**
 * How far past the knee, along the thigh, a trouser leg's shin cover is
 * still drawn: just enough to close any gap where the two covers meet.
 */
const SHIN_OVERLAP = 0.01;
/** How far the cut runs either side of the knee, so the cover's own outline, not the cut's end, bounds it. */
const KNEE_CUT_REACH = 1;

/**
 * Clips what is painted next to below the knee, square to the thigh. A trouser leg is one tube of cloth: the shin cover's round top
 * laid over the thigh reads as a seam, a kneepad sewn on at the knee.
 */
function clipBelowKnee(ctx: Ctx, hip: Pt, knee: Pt): void {
  const length = Math.hypot(knee.x - hip.x, knee.y - hip.y);
  if (length === 0) return;
  const down = { x: (knee.x - hip.x) / length, y: (knee.y - hip.y) / length };
  const across = { x: -down.y, y: down.x };
  const cut = { x: knee.x - down.x * SHIN_OVERLAP, y: knee.y - down.y * SHIN_OVERLAP };
  const corner = (side: number, along: number): Pt => ({
    x: cut.x + across.x * side * KNEE_CUT_REACH + down.x * along,
    y: cut.y + across.y * side * KNEE_CUT_REACH + down.y * along,
  });
  ctx.beginPath();
  for (const [side, along] of [
    [-1, 0],
    [1, 0],
    [1, KNEE_CUT_REACH],
    [-1, KNEE_CUT_REACH],
  ] as const) {
    const p = corner(side, along);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.clip();
}

/**
 * Paints `legs` over the leg `frame` dresses, following the rig's own leg
 * contour through every bend of the pose.
 */
export function paintLegCloth(ctx: Ctx, frame: BipedLegFrame, legs: LegCloth): void {
  // A knee driven at the camera is shaded over the shin after the leg is
  // dressed, so the shin is laid again over that shading.
  if (frame.piece === 'kneeAtCamera') {
    paintCover(ctx, frame, 'shin', legs);
    return;
  }
  if (frame.segments !== 'lower') paintCover(ctx, frame, 'thigh', legs);
  if (frame.segments !== 'thigh') paintCover(ctx, frame, 'shin', legs);
}

/** A plain low shoe: the trouser cuff covers the ankle, so its shaft stops just above it. */
const SHOE_SHAFT_TOP_AT = 0.8;
/** The sole is the upper's leather taken most of the way to near-black. */
const SOLE_DARKEN_TOWARD = '#120d0b';
const SOLE_DARKEN = 0.7;

function shoeLook(footwear: GlossRamp): BootLook {
  return {
    leather: footwear,
    sole: deriveRamp(mix(footwear.base, SOLE_DARKEN_TOWARD, SOLE_DARKEN)),
    shaftTopAt: SHOE_SHAFT_TOP_AT,
    soleBuild: BOOT_SOLE,
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
function paintMud(ctx: Ctx, frame: BipedLegFrame): void {
  const { chain, view, footScale } = frame;
  const point =
    (frame.drawn === 'left' ? frame.pose.leftFootPoint : frame.pose.rightFootPoint) ?? 0;
  const landmarks = footSoleLandmarks(
    chain.end,
    frame.footPitch,
    view,
    frame.footOut,
    frame.look.limbs,
    point,
  );
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

function paintShoe(ctx: Ctx, frame: BipedLegFrame, { footwear, muddy }: TownsfolkLegwear): void {
  if (frame.piece === 'kneeAtCamera' || frame.segments === 'thigh') return;
  paintBootOnLeg(ctx, frame, shoeLook(footwear));
  if (muddy) paintMud(ctx, frame);
}

function paintWornCloth(ctx: Ctx, frame: BipedLegFrame): void {
  paintLegCloth(ctx, frame, worn);
}

function paintWornShoe(ctx: Ctx, frame: BipedLegFrame): void {
  paintShoe(ctx, frame, worn);
}

export const TOWNSFOLK_TROUSERS = defineGarment({
  id: 'townsfolk_trousers',
  name: 'Townsfolk trousers',
  wearer: 'human',
  material: 'cloth',
  layer: 'over',
  region: ['leg'],
  paint: { leg: humanEveryView(paintWornCloth) },
});

export const TOWNSFOLK_SHOES = defineGarment({
  id: 'townsfolk_shoes',
  name: 'Townsfolk shoes',
  wearer: 'human',
  material: 'leather',
  layer: 'outer',
  region: ['leg'],
  covers: ['feet'],
  paint: { leg: humanEveryView(paintWornShoe) },
});
