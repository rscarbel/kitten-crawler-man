/**
 * The Patched Duster on the human crawler: a long brown leather coat worn
 * open over whatever he has on, hanging to his calves and flaring at the hem,
 * patched all over in leathers that never matched. At the tile it is a brown
 * body and sleeves with a strip of his shirt down the open front, lit lapels
 * at the chest, and a long flared skirt either side of his legs; the patches
 * are blocks of tan, oxblood and near-black let into the brown, each ringed
 * with pale stitching.
 */

import type { BipedBackFrame, BipedTorsoFrame } from '../../art/biped/bipedParts';
import { deriveGlossRamp, deriveRamp, type Ramp } from '../../art/biped/palette';
import type { TorsoFrame } from '../../art/biped/torso';
import { rgba, type Pt } from '../../art/bipedArt';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import { coatSkirt, paintSkirt, skirtPieceIs, type SkirtCut, type SkirtShape } from './coatSkirt';
import {
  fillPolygon,
  paintCoverBody,
  withDeepShade,
  strokeLine,
  tracePolygon,
  withinTorso,
} from './torsoCover';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/** Weathered saddle brown, the leather the coat started as. */
const DUSTER_LEATHER = withDeepShade(deriveGlossRamp('#6e4428'));
/** The skirt's inside, seen past his legs head-on: unlit, a step darker than its outside. */
const DUSTER_LINING = deriveRamp('#45291a');

/** Each patch is a different hide: one paler, one redder, one darker than the coat, so each reads apart from it. */
const TAN_PATCH = '#b5844f';
const OXBLOOD_PATCH = '#6a1f1d';
const DARK_PATCH = '#2e211a';
const STITCH = '#dcc79c';
const STITCH_ALPHA = 0.85;
const STITCH_WIDTH = 0.012;
const STITCH_DASH = 0.022;
/** The stitching runs just inside each patch's edge. */
const STITCH_INSET = 0.18;
const PATCH_EDGE_ALPHA = 0.6;
const PATCH_EDGE_WIDTH = 0.012;

/** Leather keeps a few deep folds; the jacket's own weight. */
const LEATHER_FOLD_WEIGHT = 1;

/**
 * Head-on the fronts stand open down his middle: the strip of whatever he
 * wears under it, narrow at the throat and opening toward the hem.
 */
const OPEN_FRONT_TOP_HALF = 0.04;
const OPEN_FRONT_HEM_HALF = 0.075;
const OPEN_FRONT_TOP_Y = -0.2;
/** How far past the hem the open strip is cut, so the hem, not the strip, ends it. */
const OPEN_FRONT_OVERREACH = 0.2;
/** Large enough to hold the whole figure, for clipping the strip out of it. */
const CLIP_REACH = 10;
const FRONT_EDGE_WIDTH = 0.02;
const FRONT_EDGE_ALPHA = 0.85;

/** The lapels folded back from the open fronts, a lit triangle each side of his chest. */
const LAPEL_TOP_Y = -0.03;
const LAPEL_NOTCH_HALF = 0.15;
const LAPEL_NOTCH_Y = 0.05;
const LAPEL_POINT_Y = 0.22;
const LAPEL_EDGE_WIDTH = 0.014;
/** From behind, the collar rolls round the back of his neck as a lit band. */
const BACK_COLLAR_HALF = 0.12;
const BACK_COLLAR_Y = -0.04;
const BACK_COLLAR_WIDTH = 0.045;
/** Edge-on, the lapel's fold is a lit line down the front of his chest. */
const PROFILE_LAPEL_X = 0.17;
const PROFILE_LAPEL_TOP_Y = -0.01;
const PROFILE_LAPEL_BOTTOM_Y = 0.2;

/** The long skirt: from the waist to his calves, flaring well past his hips at the hem. */
const DUSTER_SKIRT: SkirtCut = {
  length: 0.78,
  waistHalf: 0.21,
  hemHalf: 0.34,
  profileBehind: 0.2,
  profileFrontShare: 1,
  profileAhead: 0.1,
  splitRise: 0.35,
  splitOpen: 0,
};
/** The riding vent up the back of the skirt, and the folds the flare hangs in. */
const VENT_WIDTH = 0.02;
const VENT_ALPHA = 0.85;
const SKIRT_FOLD_ACROSS: readonly number[] = [-0.55, 0.5];
const SKIRT_FOLD_TOP_V = 0.25;
const SKIRT_FOLD_WIDTH = 0.022;
const SKIRT_FOLD_ALPHA = 0.55;
/** A lit band along the hem, so the flare's edge reads against the floor. */
const HEM_LIGHT_ALPHA = 0.7;
const HEM_LIGHT_WIDTH = 0.025;

/** A patch: its leather and its corners, in whichever frame it is let into. */
interface Patch {
  readonly colour: string;
  /** Corners clockwise from top left, as coordinates in its frame. */
  readonly corners: readonly [Pt, Pt, Pt, Pt];
}

function patch(
  colour: string,
  left: number,
  top: number,
  right: number,
  bottom: number,
  skew: number,
): Patch {
  return {
    colour,
    corners: [
      { x: left, y: top + skew },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left + skew, y: bottom },
    ],
  };
}

/** A small tilt to each patch, so they read as sewn on by hand rather than printed. */
const PATCH_SKEW = 0.02;

/** The patches on the coat's body, in the torso's own frame; edge-on, x before his build's depth. */
const FRONT_PATCHES: readonly Patch[] = [
  patch(TAN_PATCH, -0.2, 0.25, -0.08, 0.37, PATCH_SKEW),
  patch(DARK_PATCH, 0.09, 0.27, 0.2, 0.38, -PATCH_SKEW),
];
const BACK_PATCHES: readonly Patch[] = [
  patch(DARK_PATCH, -0.17, 0.07, -0.04, 0.19, PATCH_SKEW),
  patch(TAN_PATCH, 0.05, 0.25, 0.18, 0.37, -PATCH_SKEW),
];
const PROFILE_PATCHES: readonly Patch[] = [patch(TAN_PATCH, -0.14, 0.14, 0.0, 0.27, PATCH_SKEW)];

/** The patches on the skirt, across it (`u`) and down it (`v`). */
const SKIRT_BACK_PATCHES: readonly Patch[] = [
  patch(OXBLOOD_PATCH, -0.75, 0.3, -0.35, 0.55, 0.03),
  patch(TAN_PATCH, 0.3, 0.55, 0.7, 0.82, -0.03),
];
const SKIRT_PROFILE_PATCHES: readonly Patch[] = [
  patch(TAN_PATCH, -0.85, 0.35, -0.4, 0.6, 0.03),
  patch(DARK_PATCH, -0.2, 0.62, 0.25, 0.86, -0.03),
];
const SKIRT_FRONT_PATCHES: readonly Patch[] = [patch(TAN_PATCH, 0.62, 0.45, 0.95, 0.7, 0.03)];

function inset(corners: readonly Pt[], share: number): Pt[] {
  const cx = corners.reduce((sum, p) => sum + p.x, 0) / corners.length;
  const cy = corners.reduce((sum, p) => sum + p.y, 0) / corners.length;
  return corners.map((p) => ({ x: p.x + (cx - p.x) * share, y: p.y + (cy - p.y) * share }));
}

function paintPatch(ctx: Ctx, corners: readonly Pt[], colour: string): void {
  fillPolygon(ctx, corners, colour);
  tracePolygon(ctx, corners);
  ctx.strokeStyle = rgba(DUSTER_LEATHER.deep, PATCH_EDGE_ALPHA);
  ctx.lineWidth = PATCH_EDGE_WIDTH;
  ctx.stroke();
  ctx.save();
  tracePolygon(ctx, inset(corners, STITCH_INSET));
  ctx.setLineDash([STITCH_DASH, STITCH_DASH]);
  ctx.strokeStyle = rgba(STITCH, STITCH_ALPHA);
  ctx.lineWidth = STITCH_WIDTH;
  ctx.stroke();
  ctx.restore();
}

function paintPatches(ctx: Ctx, patches: readonly Patch[], place: (p: Pt) => Pt): void {
  for (const { colour, corners } of patches) paintPatch(ctx, corners.map(place), colour);
}

function openFrontStrip(torso: TorsoFrame): Pt[] {
  return [
    torso.at(-OPEN_FRONT_TOP_HALF, OPEN_FRONT_TOP_Y),
    torso.at(OPEN_FRONT_TOP_HALF, OPEN_FRONT_TOP_Y),
    torso.hem(OPEN_FRONT_HEM_HALF, OPEN_FRONT_OVERREACH),
    torso.hem(-OPEN_FRONT_HEM_HALF, OPEN_FRONT_OVERREACH),
  ];
}

/** The coat's body with the open front left out of it, so his shirt shows down the strip. */
function paintOpenBody(
  ctx: Ctx,
  frame: BipedTorsoFrame,
  context: GarmentFrameContext<'human'>,
): void {
  const strip = openFrontStrip(frame.torso);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-CLIP_REACH, -CLIP_REACH, CLIP_REACH * 2, CLIP_REACH * 2);
  const [first, ...rest] = strip;
  ctx.moveTo(first.x, first.y);
  for (const p of rest) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.clip('evenodd');
  paintCoverBody(ctx, frame, context, DUSTER_LEATHER, { foldWeight: LEATHER_FOLD_WEIGHT });
  ctx.restore();
}

function paintBody(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  const { torso, view } = frame;
  if (view.profile || view.showsBack) {
    paintCoverBody(ctx, frame, context, DUSTER_LEATHER, { foldWeight: LEATHER_FOLD_WEIGHT });
  } else paintOpenBody(ctx, frame, context);
  const depth = view.profile ? torso.cut.profileDepth : 1;
  const inTorso = (p: Pt): Pt => torso.at(p.x * depth, p.y);
  withinTorso(ctx, frame, context, () => {
    if (view.profile) {
      paintPatches(ctx, PROFILE_PATCHES, inTorso);
      return;
    }
    if (view.showsBack) {
      paintPatches(ctx, BACK_PATCHES, inTorso);
      return;
    }
    paintPatches(ctx, FRONT_PATCHES, inTorso);
    const [topLeft, topRight, hemRight, hemLeft] = openFrontStrip(torso);
    const edge = rgba(DUSTER_LEATHER.deep, FRONT_EDGE_ALPHA);
    strokeLine(ctx, [topLeft, hemLeft], edge, FRONT_EDGE_WIDTH);
    strokeLine(ctx, [topRight, hemRight], edge, FRONT_EDGE_WIDTH);
  });
}

function paintLapels(ctx: Ctx, torso: TorsoFrame): void {
  const { at } = torso;
  for (const side of [-1, 1]) {
    const corners = [
      at(side * OPEN_FRONT_TOP_HALF, LAPEL_TOP_Y),
      at(side * LAPEL_NOTCH_HALF, LAPEL_NOTCH_Y),
      at(side * OPEN_FRONT_TOP_HALF, LAPEL_POINT_Y),
    ];
    fillPolygon(ctx, corners, DUSTER_LEATHER.light);
    strokeLine(ctx, [corners[1], corners[2]], DUSTER_LEATHER.deep, LAPEL_EDGE_WIDTH);
  }
}

function paintCollar(ctx: Ctx, frame: BipedTorsoFrame): void {
  const { torso, view } = frame;
  if (view.profile) {
    const x = PROFILE_LAPEL_X * torso.cut.profileDepth;
    strokeLine(
      ctx,
      [torso.at(x, PROFILE_LAPEL_TOP_Y), torso.at(x, PROFILE_LAPEL_BOTTOM_Y)],
      DUSTER_LEATHER.light,
      LAPEL_EDGE_WIDTH * 2,
    );
    return;
  }
  if (view.showsBack) {
    const half = BACK_COLLAR_HALF * view.girth;
    strokeLine(
      ctx,
      [torso.at(-half, BACK_COLLAR_Y), torso.at(half, BACK_COLLAR_Y)],
      DUSTER_LEATHER.light,
      BACK_COLLAR_WIDTH,
    );
    return;
  }
  paintLapels(ctx, torso);
}

function paintTorso(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  if (frame.piece === 'jacket') paintBody(ctx, frame, context);
  else if (frame.piece === 'collar') paintCollar(ctx, frame);
}

function paintSkirtDetail(
  ctx: Ctx,
  skirt: SkirtShape,
  ramp: Ramp,
  patches: readonly Patch[],
): void {
  for (const across of SKIRT_FOLD_ACROSS) {
    strokeLine(
      ctx,
      [skirt.at(across * SKIRT_FOLD_TOP_V, SKIRT_FOLD_TOP_V), skirt.at(across, 1)],
      rgba(ramp.deep, SKIRT_FOLD_ALPHA),
      SKIRT_FOLD_WIDTH,
    );
  }
  paintPatches(ctx, patches, (p) => skirt.at(p.x, p.y));
  if (skirt.split !== null) {
    strokeLine(ctx, [skirt.split.top, skirt.split.hem], rgba(ramp.deep, VENT_ALPHA), VENT_WIDTH);
  }
  strokeLine(
    ctx,
    [skirt.at(-1, 1), skirt.at(1, 1)],
    rgba(ramp.light, HEM_LIGHT_ALPHA),
    HEM_LIGHT_WIDTH,
  );
}

function paintBack(ctx: Ctx, frame: BipedBackFrame): void {
  if (!skirtPieceIs(frame)) return;
  const skirt = coatSkirt(frame, DUSTER_SKIRT);
  const { view } = frame;
  const facingFront = !view.profile && !view.showsBack;
  const ramp = facingFront ? DUSTER_LINING : DUSTER_LEATHER;
  const patches = view.profile
    ? SKIRT_PROFILE_PATCHES
    : view.showsBack
      ? SKIRT_BACK_PATCHES
      : SKIRT_FRONT_PATCHES;
  paintSkirt(ctx, skirt, ramp, () => paintSkirtDetail(ctx, skirt, ramp, patches));
}

export const PATCHED_DUSTER = defineGarment({
  id: 'human_patched_duster',
  name: 'Patched Duster',
  wearer: 'human',
  material: 'leather',
  layer: 'back',
  region: ['torso', 'back'],
  sleeves: { cloth: DUSTER_LEATHER },
  paint: { torso: humanEveryView(paintTorso), back: humanEveryView(paintBack) },
});
