/**
 * The Lucky Hoodie on the human crawler: a faded red pullover hoodie worn over
 * his shirt. At the tile it is a red torso and red sleeves pushed up his
 * forearms; what says "hoodie" rather than "red shirt" is the hood bunched
 * round the back of his neck, the pale drawstrings dropping from its throat,
 * the kangaroo pocket across his belly and the ribbed band at the hem.
 */

import type { BipedTorsoFrame } from '../../art/biped/bipedParts';
import type { ViewSpec } from '../../art/biped/rig';
import type { TorsoFrame } from '../../art/biped/torso';
import { pt } from '../../art/biped/geometry';
import { rgba, type Pt } from '../../art/bipedArt';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import {
  fillPolygon,
  matteRamp,
  paintCoverBody,
  withDeepShade,
  strokeLine,
  withinTorso,
} from './torsoCover';
import { humanEveryView } from './views';
import { paintBackHood, paintBackHoodRim, paintFacingHood, paintProfileHood } from './hoodDown';

type Ctx = CanvasRenderingContext2D;

/** Washed so many times the red has gone a little brick. */
const FADED_RED = withDeepShade(matteRamp('#a4473f'));
const DRAWSTRING = '#f4ede0';
const DRAWSTRING_TIP = '#8d8578';

/** Fleece pushed up the forearm bunches into a thicker roll than a shirt's or a jacket's. */
const FLEECE_CUFF_BULK = 3;

/** Fleece folds softer than leather, deeper than a shirt. */
const FLEECE_FOLD_WEIGHT = 0.5;
const FLEECE_SEAM_WEIGHT = 0.4;

/** The ribbed band at the hem, standing this far up from it. */
const HEM_BAND_RISE = 0.055;
const HEM_BAND_ALPHA = 0.75;
const HEM_BAND_LIP_WIDTH = 0.014;
const HEM_BAND_LIP_ALPHA = 0.55;
/** How far past the torso a band runs, so the clip, not its end, finishes it at his sides. */
const OVERREACH = 0.5;

/** The kangaroo pocket head-on: a trapezoid over the belly, its slanted sides the hand openings. */
const POCKET_TOP_Y = 0.27;
const POCKET_BOTTOM_RISE = 0.06;
const POCKET_TOP_HALF = 0.075;
const POCKET_BOTTOM_HALF = 0.125;
const POCKET_FILL_ALPHA = 0.5;
const POCKET_EDGE_WIDTH = 0.014;
const POCKET_EDGE_ALPHA = 0.8;
const POCKET_OPENING_WIDTH = 0.016;
const POCKET_OPENING_ALPHA = 0.85;
/** Edge-on the pocket's front bulges a touch over the belly, a seam where it meets the body. */
const PROFILE_POCKET_BACK_X = 0.05;

/** The drawstrings drop from either side of the throat, a little apart. */
const DRAWSTRING_X = 0.028;
const DRAWSTRING_TOP_Y = 0.01;
const DRAWSTRING_BOTTOM_Y = 0.16;
const DRAWSTRING_SWAY = 0.008;
const DRAWSTRING_WIDTH = 0.018;
const DRAWSTRING_TIP_LENGTH = 0.022;
/** Edge-on one string shows, hanging just off the front of his chest. */
const PROFILE_DRAWSTRING_X = 0.07;

function paintHemBand(ctx: Ctx, torso: TorsoFrame): void {
  const top = (x: number): Pt => torso.hem(x, -HEM_BAND_RISE);
  fillPolygon(
    ctx,
    [
      top(-OVERREACH),
      top(OVERREACH),
      torso.hem(OVERREACH, OVERREACH),
      torso.hem(-OVERREACH, OVERREACH),
    ],
    rgba(FADED_RED.dark, HEM_BAND_ALPHA),
  );
  strokeLine(
    ctx,
    [top(-OVERREACH), top(OVERREACH)],
    rgba(FADED_RED.light, HEM_BAND_LIP_ALPHA),
    HEM_BAND_LIP_WIDTH,
  );
}

function paintPocket(ctx: Ctx, torso: TorsoFrame): void {
  const { at } = torso;
  const bottomY = torso.hemY - POCKET_BOTTOM_RISE;
  const corners = [
    at(-POCKET_TOP_HALF, POCKET_TOP_Y),
    at(POCKET_TOP_HALF, POCKET_TOP_Y),
    at(POCKET_BOTTOM_HALF, bottomY),
    at(-POCKET_BOTTOM_HALF, bottomY),
  ];
  fillPolygon(ctx, corners, rgba(FADED_RED.mid, POCKET_FILL_ALPHA));
  strokeLine(
    ctx,
    [corners[0], corners[1]],
    rgba(FADED_RED.light, POCKET_EDGE_ALPHA),
    POCKET_EDGE_WIDTH,
  );
  const opening = rgba(FADED_RED.deep, POCKET_OPENING_ALPHA);
  strokeLine(ctx, [corners[1], corners[2]], opening, POCKET_OPENING_WIDTH);
  strokeLine(ctx, [corners[0], corners[3]], opening, POCKET_OPENING_WIDTH);
}

function paintProfilePocket(ctx: Ctx, torso: TorsoFrame): void {
  const depth = torso.cut.profileDepth;
  const top = torso.at(PROFILE_POCKET_BACK_X * depth, POCKET_TOP_Y);
  const bottom = torso.at(PROFILE_POCKET_BACK_X * depth, torso.hemY - POCKET_BOTTOM_RISE);
  strokeLine(ctx, [top, bottom], rgba(FADED_RED.deep, POCKET_OPENING_ALPHA), POCKET_OPENING_WIDTH);
}

function strokeDrawstring(ctx: Ctx, from: Pt, to: Pt): void {
  strokeLine(ctx, [from, to], DRAWSTRING, DRAWSTRING_WIDTH);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const tip = pt(
    to.x + (dx / length) * DRAWSTRING_TIP_LENGTH,
    to.y + (dy / length) * DRAWSTRING_TIP_LENGTH,
  );
  strokeLine(ctx, [to, tip], DRAWSTRING_TIP, DRAWSTRING_WIDTH);
}

function paintDrawstrings(ctx: Ctx, torso: TorsoFrame, view: ViewSpec): void {
  const { at } = torso;
  if (view.profile) {
    const x = PROFILE_DRAWSTRING_X * torso.cut.profileDepth;
    strokeDrawstring(ctx, at(x, DRAWSTRING_TOP_Y), at(x + DRAWSTRING_SWAY, DRAWSTRING_BOTTOM_Y));
    return;
  }
  for (const side of [-1, 1]) {
    strokeDrawstring(
      ctx,
      at(side * DRAWSTRING_X, DRAWSTRING_TOP_Y),
      at(side * (DRAWSTRING_X + DRAWSTRING_SWAY), DRAWSTRING_BOTTOM_Y),
    );
  }
}

function paintBody(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  const cut = { foldWeight: FLEECE_FOLD_WEIGHT, seamWeight: FLEECE_SEAM_WEIGHT };
  paintCoverBody(ctx, frame, context, FADED_RED, cut);
  const { torso, view } = frame;
  withinTorso(ctx, frame, context, () => {
    paintHemBand(ctx, torso);
    if (view.profile) {
      paintProfilePocket(ctx, torso);
      return;
    }
    if (view.showsBack) {
      paintBackHood(ctx, torso, FADED_RED);
      return;
    }
    paintPocket(ctx, torso);
  });
  if (view.profile) paintProfileHood(ctx, torso, FADED_RED);
}

function paintCollar(ctx: Ctx, frame: BipedTorsoFrame): void {
  const { torso, view } = frame;
  if (view.profile) {
    paintDrawstrings(ctx, torso, view);
    return;
  }
  if (view.showsBack) {
    paintBackHoodRim(ctx, torso, view, FADED_RED);
    return;
  }
  paintFacingHood(ctx, frame, FADED_RED);
  paintDrawstrings(ctx, torso, view);
}

function paintTorso(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  if (frame.piece === 'jacket') paintBody(ctx, frame, context);
  else if (frame.piece === 'collar') paintCollar(ctx, frame);
}

export const LUCKY_HOODIE = defineGarment({
  id: 'human_lucky_hoodie',
  name: 'Lucky Hoodie',
  wearer: 'human',
  material: 'cloth',
  layer: 'overcoat',
  region: ['torso'],
  covers: ['chest', 'throat'],
  sleeves: { cloth: FADED_RED, cut: { cuffBulk: FLEECE_CUFF_BULK } },
  paint: { torso: humanEveryView(paintTorso) },
});
