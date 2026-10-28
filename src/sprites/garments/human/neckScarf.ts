/**
 * A small silk scarf in dusty teal, wrapped once round the base of the neck
 * and knotted at the throat a little to one side, its two short ends falling
 * over the top. At the tile it is a few pixels of cool colour between the
 * face and the warm jacket, which is what it is for.
 */

import type { BipedTorsoFrame } from '../../art/biped/bipedParts';
import { pt } from '../../art/biped/geometry';
import type { Ramp } from '../../art/biped/palette';
import { NECK_WIDTH } from '../../art/biped/proportions';
import type { ViewSpec } from '../../art/biped/rig';
import type { TorsoFrame } from '../../art/biped/torso';
import type { Pt } from '../../art/bipedArt';
import { defineGarment } from '../garmentDef';
import { fillPolygon } from './torsoCover';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

const TEAL_SILK: Ramp = {
  deep: '#14302e',
  shadow: '#1f4643',
  dark: '#2b5e5a',
  mid: '#387772',
  base: '#4a938c',
  light: '#6fb5ad',
  rim: '#9ad3cb',
};

/** The wrap lies close round the neck, in neck widths: it stands a little proud of it either side. */
const WRAP_HALF_NECKS = 1.4;
/** The wrap's band head-on, from the base of the neck up the throat. */
const WRAP_TOP_Y = -0.07;
const WRAP_BOTTOM_Y = -0.025;
/** Its lit upper edge. */
const WRAP_LIP_SHARE = 0.35;

/** The knot sits on the throat, a little toward her right as the view lays it out. */
const KNOT_X = 0.018;
const KNOT_Y = -0.02;
const KNOT_RX = 0.03;
const KNOT_RY = 0.024;
/** Its lit upper side. */
const KNOT_LIGHT_X = -0.008;
const KNOT_LIGHT_Y = -0.008;
const KNOT_LIGHT_SHARE = 0.55;

/** The two ends falling from the knot over the top, each a narrow tapered strip. */
const TAILS: readonly { readonly root: Pt; readonly tip: Pt }[] = [
  { root: pt(0.012, 0.0), tip: pt(0.004, 0.075) },
  { root: pt(0.028, 0.0), tip: pt(0.05, 0.065) },
];
const TAIL_HALF_ROOT = 0.016;
const TAIL_HALF_TIP = 0.01;

/** Edge-on: the wrap round the neck and the knot standing at the front of the throat. */
const PROFILE_WRAP = [
  pt(-0.12, -0.075),
  pt(0.07, -0.05),
  pt(0.08, -0.015),
  pt(-0.11, -0.03),
] as const;
const PROFILE_KNOT = pt(0.09, -0.01);
const PROFILE_KNOT_RX = 0.024;
const PROFILE_KNOT_RY = 0.026;
const PROFILE_TAIL = [pt(0.075, 0.0), pt(0.105, 0.0), pt(0.12, 0.06), pt(0.09, 0.065)] as const;

/** From behind: the wrap's band across the nape, over the jacket's collar. */
const BACK_WRAP_TOP_Y = -0.1;
const BACK_WRAP_BOTTOM_Y = -0.06;

function neckHalf(view: ViewSpec, neckGirth: number): number {
  return NECK_WIDTH * view.girth * neckGirth * WRAP_HALF_NECKS;
}

function fillEllipse(
  ctx: Ctx,
  torso: TorsoFrame,
  centre: Pt,
  rx: number,
  ry: number,
  colour: string,
): void {
  const at = torso.at(centre.x, centre.y);
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, rx, ry, torso.angle - Math.PI / 2, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
}

function band(torso: TorsoFrame, half: number, top: number, bottom: number): Pt[] {
  return [
    torso.at(-half, top),
    torso.at(half, top),
    torso.at(half, bottom),
    torso.at(-half, bottom),
  ];
}

function paintFacing(ctx: Ctx, torso: TorsoFrame, view: ViewSpec, neckGirth: number): void {
  const half = neckHalf(view, neckGirth);
  if (view.showsBack) {
    fillPolygon(ctx, band(torso, half, BACK_WRAP_TOP_Y, BACK_WRAP_BOTTOM_Y), TEAL_SILK.mid);
    const lipBottom = BACK_WRAP_TOP_Y + (BACK_WRAP_BOTTOM_Y - BACK_WRAP_TOP_Y) * WRAP_LIP_SHARE;
    fillPolygon(ctx, band(torso, half, BACK_WRAP_TOP_Y, lipBottom), TEAL_SILK.base);
    return;
  }
  fillPolygon(ctx, band(torso, half, WRAP_TOP_Y, WRAP_BOTTOM_Y), TEAL_SILK.mid);
  const lipBottom = WRAP_TOP_Y + (WRAP_BOTTOM_Y - WRAP_TOP_Y) * WRAP_LIP_SHARE;
  fillPolygon(ctx, band(torso, half, WRAP_TOP_Y, lipBottom), TEAL_SILK.base);
  for (const tail of TAILS) {
    fillPolygon(
      ctx,
      [
        torso.at(tail.root.x - TAIL_HALF_ROOT, tail.root.y),
        torso.at(tail.root.x + TAIL_HALF_ROOT, tail.root.y),
        torso.at(tail.tip.x + TAIL_HALF_TIP, tail.tip.y),
        torso.at(tail.tip.x - TAIL_HALF_TIP, tail.tip.y),
      ],
      TEAL_SILK.dark,
    );
  }
  fillEllipse(ctx, torso, pt(KNOT_X, KNOT_Y), KNOT_RX, KNOT_RY, TEAL_SILK.base);
  fillEllipse(
    ctx,
    torso,
    pt(KNOT_X + KNOT_LIGHT_X, KNOT_Y + KNOT_LIGHT_Y),
    KNOT_RX * KNOT_LIGHT_SHARE,
    KNOT_RY * KNOT_LIGHT_SHARE,
    TEAL_SILK.light,
  );
}

function paintProfile(ctx: Ctx, torso: TorsoFrame): void {
  const depth = torso.cut.profileDepth;
  const scaled = (p: Pt): Pt => torso.at(p.x * depth, p.y);
  fillPolygon(ctx, PROFILE_WRAP.map(scaled), TEAL_SILK.mid);
  fillPolygon(ctx, PROFILE_TAIL.map(scaled), TEAL_SILK.dark);
  fillEllipse(
    ctx,
    torso,
    pt(PROFILE_KNOT.x * depth, PROFILE_KNOT.y),
    PROFILE_KNOT_RX,
    PROFILE_KNOT_RY,
    TEAL_SILK.base,
  );
}

function paintTorso(ctx: Ctx, frame: BipedTorsoFrame): void {
  if (frame.piece !== 'collar') return;
  if (frame.view.profile) paintProfile(ctx, frame.torso);
  else paintFacing(ctx, frame.torso, frame.view, frame.look.neckGirth);
}

export const SILK_NECK_SCARF = defineGarment({
  id: 'silk_neck_scarf',
  name: 'Silk neck scarf',
  wearer: 'human',
  base: true,
  layer: 'outer',
  region: ['torso'],
  covers: ['throat'],
  paint: { torso: humanEveryView(paintTorso) },
});
