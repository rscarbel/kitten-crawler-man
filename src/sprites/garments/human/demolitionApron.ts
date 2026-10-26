/**
 * The Demolition Apron on the human crawler: a heavy brown leather bib apron
 * worn over his shirt. At the tile it is a dark brown panel down the middle of
 * his torso, his shirt showing at the shoulders and flanks round it, with a row
 * of red dynamite sticks in loops across the chest and the leather scorched
 * black at its lower corners. From behind only the straps show: one round the
 * back of his neck and two crossing his back down to the waist tie.
 */

import type { BipedHipsFrame, BipedTorsoFrame } from '../../art/biped/bipedParts';
import { shadeForm } from '../../art/biped/paint';
import { deriveGlossRamp } from '../../art/biped/palette';
import { NECK_WIDTH } from '../../art/biped/proportions';
import type { ViewSpec } from '../../art/biped/rig';
import type { TorsoFrame } from '../../art/biped/torso';
import { rgba, type Pt } from '../../art/bipedArt';
import { fillSoftEllipse, withClip } from '../../art/softShade';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import { fillPolygon, strokeLine, tracePolygon, withinTorso } from './torsoCover';
import { skirtFrame } from './hipSkirt';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/** Tan, well under the chambray's value and well over a brown leather jacket's, so the bib reads as its own panel on either. */
const LEATHER = deriveGlossRamp('#9a693b');
const SOOT = '#140e0b';
const DYNAMITE = deriveGlossRamp('#cf2a1f');
const FUSE = '#efe2c4';

/** The bib head-on: narrow at the chest, flaring out under the arms to wrap the waist. */
const BIB_TOP_Y = 0.045;
const BIB_TOP_HALF = 0.115;
const BIB_FLARE_START_Y = 0.2;
const BIB_WAIST_Y = 0.34;
/** Past the torso's sides, so the clip, not the bib's edge, finishes it at his hips. */
const OVERREACH = 0.6;
const BIB_EDGE_WIDTH = 0.02;
const BIB_EDGE_ALPHA = 0.85;
/** Leather is broad and stiff: a wide, soft terminator across the panel. */
const BIB_SOFTNESS = 1.6;
const BIB_SPECULAR = 0.35;

/** The neck strap runs from the bib's top corners up the sides of his neck. */
const STRAP_WIDTH = 0.032;
const NECK_STRAP_SHARE = 0.95;
const NECK_STRAP_TOP_Y = -0.03;
const STRAP_LIGHT_ALPHA = 0.6;
const STRAP_LIGHT_WIDTH_SHARE = 0.35;

/** The dynamite row: sticks standing in leather loops across the top of the bib. */
const STICK_COUNT = 4;
const STICK_PITCH = 0.058;
const STICK_HALF_WIDTH = 0.022;
const STICK_TOP_Y = 0.06;
const STICK_BOTTOM_Y = 0.215;
const STICK_SHINE_SHARE = 0.4;
const FUSE_LENGTH = 0.05;
const FUSE_WIDTH = 0.014;
/** The loop band the sticks are pushed through, across their middles. */
const LOOP_TOP_Y = 0.125;
const LOOP_BOTTOM_Y = 0.145;
const LOOP_LIP_ALPHA = 0.7;
const LOOP_LIP_WIDTH = 0.01;

/**
 * Soot where a blast licked the leather: soft-edged smudges, since a hard-edged
 * dark disc reads as a spot printed on the hide rather than a burn.
 */
interface ScorchPatch {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly alpha: number;
}
const FRONT_SCORCH: readonly ScorchPatch[] = [
  { x: -0.22, y: 0.42, rx: 0.12, ry: 0.09, alpha: 0.9 },
  { x: 0.2, y: 0.45, rx: 0.1, ry: 0.07, alpha: 0.85 },
  { x: -0.12, y: 0.06, rx: 0.05, ry: 0.04, alpha: 0.7 },
];
/** A smudge's solid core, as a share of its radius, before it fades. */
const SCORCH_CORE = 0.35;

/**
 * The apron's skirt hangs from his waist over the tops of his thighs, painted
 * at the seat so his legs stay under it and the bib's hem laps over its top.
 * Lengths run down his spine from the waist; widths are across his hips.
 */
const SKIRT_DROP_BELOW_HIP = 0.27;
const SKIRT_TOP_HALF = 0.21;
const SKIRT_BOTTOM_HALF = 0.235;
const PROFILE_SKIRT_BACK_X = 0.0;
const PROFILE_SKIRT_FRONT_X = 0.13;
/** Edge-on a heavy apron hangs a little clear of his thighs, kicked out at the hem. */
const PROFILE_SKIRT_HEM_KICK = 0.01;
/** The hem is charred black along its length, fading up into the leather. */
const SKIRT_CHAR_RISE = 0.09;
const SKIRT_CHAR_ALPHA = 0.9;
const SKIRT_SCORCH: readonly ScorchPatch[] = [
  { x: -0.2, y: 0.85, rx: 0.1, ry: 0.11, alpha: 0.9 },
  { x: 0.16, y: 0.9, rx: 0.08, ry: 0.07, alpha: 0.8 },
];
const PROFILE_SKIRT_SCORCH: readonly ScorchPatch[] = [
  { x: 0.07, y: 0.9, rx: 0.08, ry: 0.08, alpha: 0.85 },
];
const FULL_TURN = Math.PI * 2;

/** Edge-on the bib covers the front of his torso, from a little behind its middle forward. */
const PROFILE_BIB_BACK_X = -0.1;
const PROFILE_BIB_TOP_BACK_X = 0.05;
/** Edge-on the strap climbs from the bib's top up behind to his nape. */
const PROFILE_STRAP_TOP = { x: -0.06, y: -0.04 } as const;
/** The waist tie runs back from the bib's side round his waist. */
const PROFILE_TIE_Y = 0.36;
/** The sticks edge-on: a short red block standing on the front of his chest. */
const PROFILE_STICK_BACK_X = 0.17;
const PROFILE_SCORCH: readonly ScorchPatch[] = [
  { x: 0.2, y: 0.44, rx: 0.08, ry: 0.07, alpha: 0.85 },
];

/** From behind: the strap across the nape, two crossing his back, and the waist tie with its knot. */
const BACK_NECK_STRAP_Y = 0.0;
const BACK_CROSS_TOP_HALF = 0.13;
const BACK_CROSS_TOP_Y = 0.02;
const BACK_CROSS_BOTTOM_HALF = 0.17;
const BACK_TIE_Y = 0.37;
const BACK_KNOT_RX = 0.035;
const BACK_KNOT_RY = 0.025;
const BACK_TAIL_LENGTH = 0.09;
const BACK_TAIL_SPREAD = 0.03;

function frontBibOutline(torso: TorsoFrame, view: ViewSpec): Pt[] {
  const { at } = torso;
  const top = BIB_TOP_HALF * view.girth;
  return [
    at(-top, BIB_TOP_Y),
    at(top, BIB_TOP_Y),
    at(top, BIB_FLARE_START_Y),
    at(OVERREACH, BIB_WAIST_Y),
    torso.hem(OVERREACH, OVERREACH),
    torso.hem(-OVERREACH, OVERREACH),
    at(-OVERREACH, BIB_WAIST_Y),
    at(-top, BIB_FLARE_START_Y),
  ];
}

function profileBibOutline(torso: TorsoFrame): Pt[] {
  const depth = torso.cut.profileDepth;
  const { at } = torso;
  return [
    at(PROFILE_BIB_TOP_BACK_X * depth, BIB_TOP_Y),
    at(OVERREACH, BIB_TOP_Y),
    torso.hem(OVERREACH, OVERREACH),
    torso.hem(PROFILE_BIB_BACK_X * depth, OVERREACH),
  ];
}

function paintLeatherPanel(
  ctx: Ctx,
  torso: TorsoFrame,
  outline: readonly Pt[],
  halfWidth: number,
): void {
  const trace = (): void => tracePolygon(ctx, outline);
  shadeForm(ctx, trace, { from: torso.at(0, 0), to: torso.at(0, torso.hemY) }, LEATHER, {
    halfWidth,
    softness: BIB_SOFTNESS,
    specular: BIB_SPECULAR,
  });
  withClip(ctx, trace, () => {
    tracePolygon(ctx, outline);
    ctx.strokeStyle = rgba(LEATHER.deep, BIB_EDGE_ALPHA);
    ctx.lineWidth = BIB_EDGE_WIDTH * 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  });
}

function paintScorch(
  ctx: Ctx,
  outline: readonly Pt[],
  patches: readonly ScorchPatch[],
  place: (x: number, y: number) => Pt,
  rotation: number,
): void {
  withClip(
    ctx,
    () => tracePolygon(ctx, outline),
    () => {
      for (const patch of patches) {
        const centre = place(patch.x, patch.y);
        fillSoftEllipse(
          ctx,
          centre.x,
          centre.y,
          patch.rx,
          patch.ry,
          SOOT,
          patch.alpha,
          rotation,
          SCORCH_CORE,
        );
      }
    },
  );
}

function paintStick(ctx: Ctx, torso: TorsoFrame, centreX: number, halfWidth: number): void {
  const { at } = torso;
  const left = centreX - halfWidth;
  const right = centreX + halfWidth;
  fillPolygon(
    ctx,
    [
      at(left, STICK_TOP_Y),
      at(right, STICK_TOP_Y),
      at(right, STICK_BOTTOM_Y),
      at(left, STICK_BOTTOM_Y),
    ],
    DYNAMITE.base,
  );
  const shineRight = left + halfWidth * 2 * STICK_SHINE_SHARE;
  fillPolygon(
    ctx,
    [
      at(left, STICK_TOP_Y),
      at(shineRight, STICK_TOP_Y),
      at(shineRight, STICK_BOTTOM_Y),
      at(left, STICK_BOTTOM_Y),
    ],
    DYNAMITE.light,
  );
  strokeLine(ctx, [at(right, STICK_TOP_Y), at(right, STICK_BOTTOM_Y)], DYNAMITE.deep, FUSE_WIDTH);
  strokeLine(
    ctx,
    [at(centreX, STICK_TOP_Y), at(centreX, STICK_TOP_Y - FUSE_LENGTH)],
    FUSE,
    FUSE_WIDTH,
  );
}

function paintLoopBand(ctx: Ctx, torso: TorsoFrame, fromX: number, toX: number): void {
  const { at } = torso;
  fillPolygon(
    ctx,
    [at(fromX, LOOP_TOP_Y), at(toX, LOOP_TOP_Y), at(toX, LOOP_BOTTOM_Y), at(fromX, LOOP_BOTTOM_Y)],
    LEATHER.shadow,
  );
  strokeLine(
    ctx,
    [at(fromX, LOOP_TOP_Y), at(toX, LOOP_TOP_Y)],
    rgba(LEATHER.light, LOOP_LIP_ALPHA),
    LOOP_LIP_WIDTH,
  );
}

function paintDynamiteRow(ctx: Ctx, torso: TorsoFrame, view: ViewSpec): void {
  const pitch = STICK_PITCH * view.girth;
  const firstX = (-(STICK_COUNT - 1) / 2) * pitch;
  for (let i = 0; i < STICK_COUNT; i++) {
    paintStick(ctx, torso, firstX + i * pitch, STICK_HALF_WIDTH * view.girth);
  }
  const bandHalf = BIB_TOP_HALF * view.girth;
  paintLoopBand(ctx, torso, -bandHalf, bandHalf);
}

function paintStrap(ctx: Ctx, points: readonly Pt[]): void {
  strokeLine(ctx, points, LEATHER.dark, STRAP_WIDTH);
  strokeLine(
    ctx,
    points,
    rgba(LEATHER.light, STRAP_LIGHT_ALPHA),
    STRAP_WIDTH * STRAP_LIGHT_WIDTH_SHARE,
  );
}

function paintFront(ctx: Ctx, torso: TorsoFrame, view: ViewSpec): void {
  const { at } = torso;
  const neckX = NECK_WIDTH * view.girth * NECK_STRAP_SHARE;
  const topHalf = BIB_TOP_HALF * view.girth;
  paintStrap(ctx, [at(-topHalf, BIB_TOP_Y), at(-neckX, NECK_STRAP_TOP_Y)]);
  paintStrap(ctx, [at(topHalf, BIB_TOP_Y), at(neckX, NECK_STRAP_TOP_Y)]);
  const outline = frontBibOutline(torso, view);
  paintLeatherPanel(ctx, torso, outline, topHalf);
  paintScorch(ctx, outline, FRONT_SCORCH, (x, y) => torso.at(x * view.girth, y), torso.angle);
  paintDynamiteRow(ctx, torso, view);
}

function paintProfile(ctx: Ctx, torso: TorsoFrame): void {
  const depth = torso.cut.profileDepth;
  const { at } = torso;
  const bibTop = at(PROFILE_BIB_TOP_BACK_X * depth, BIB_TOP_Y);
  paintStrap(ctx, [bibTop, at(PROFILE_STRAP_TOP.x * depth, PROFILE_STRAP_TOP.y)]);
  paintStrap(ctx, [at(PROFILE_BIB_BACK_X * depth, PROFILE_TIE_Y), at(-OVERREACH, PROFILE_TIE_Y)]);
  const outline = profileBibOutline(torso);
  paintLeatherPanel(ctx, torso, outline, OVERREACH * depth);
  paintScorch(ctx, outline, PROFILE_SCORCH, (x, y) => torso.at(x * depth, y), torso.angle);
  const stickBack = PROFILE_STICK_BACK_X * depth;
  fillPolygon(
    ctx,
    [
      at(stickBack, STICK_TOP_Y),
      at(OVERREACH, STICK_TOP_Y),
      at(OVERREACH, STICK_BOTTOM_Y),
      at(stickBack, STICK_BOTTOM_Y),
    ],
    DYNAMITE.base,
  );
  paintLoopBand(ctx, torso, stickBack, OVERREACH);
}

function paintBackTies(ctx: Ctx, torso: TorsoFrame, view: ViewSpec): void {
  const { at } = torso;
  const neckX = NECK_WIDTH * view.girth;
  paintStrap(ctx, [at(-neckX, BACK_NECK_STRAP_Y), at(neckX, BACK_NECK_STRAP_Y)]);
  const topHalf = BACK_CROSS_TOP_HALF * view.girth;
  const bottomHalf = BACK_CROSS_BOTTOM_HALF * view.girth;
  paintStrap(ctx, [at(-topHalf, BACK_CROSS_TOP_Y), at(bottomHalf, BACK_TIE_Y)]);
  paintStrap(ctx, [at(topHalf, BACK_CROSS_TOP_Y), at(-bottomHalf, BACK_TIE_Y)]);
  paintStrap(ctx, [at(-OVERREACH, BACK_TIE_Y), at(OVERREACH, BACK_TIE_Y)]);
  const knot = at(0, BACK_TIE_Y);
  paintStrap(ctx, [knot, at(-BACK_TAIL_SPREAD, BACK_TIE_Y + BACK_TAIL_LENGTH)]);
  paintStrap(ctx, [knot, at(BACK_TAIL_SPREAD, BACK_TIE_Y + BACK_TAIL_LENGTH)]);
  ctx.beginPath();
  ctx.ellipse(knot.x, knot.y, BACK_KNOT_RX, BACK_KNOT_RY, torso.angle, 0, FULL_TURN);
  ctx.fillStyle = LEATHER.base;
  ctx.fill();
}

function paintBody(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  const { torso, view } = frame;
  withinTorso(ctx, frame, context, () => {
    if (view.profile) {
      paintProfile(ctx, torso);
      return;
    }
    if (view.showsBack) {
      paintBackTies(ctx, torso, view);
      return;
    }
    paintFront(ctx, torso, view);
  });
}

function paintSkirt(ctx: Ctx, frame: BipedHipsFrame): void {
  const { view } = frame;
  if (view.showsBack) return;
  const { place, rotation, length } = skirtFrame(frame, SKIRT_DROP_BELOW_HIP);
  const outline = view.profile
    ? [
        place(PROFILE_SKIRT_BACK_X, 0),
        place(PROFILE_SKIRT_FRONT_X, 0),
        place(PROFILE_SKIRT_FRONT_X + PROFILE_SKIRT_HEM_KICK, 1),
        place(PROFILE_SKIRT_BACK_X + PROFILE_SKIRT_HEM_KICK, 1),
      ]
    : [
        place(-SKIRT_TOP_HALF * view.girth, 0),
        place(SKIRT_TOP_HALF * view.girth, 0),
        place(SKIRT_BOTTOM_HALF * view.girth, 1),
        place(-SKIRT_BOTTOM_HALF * view.girth, 1),
      ];
  const trace = (): void => tracePolygon(ctx, outline);
  const halfWidth = view.profile
    ? (PROFILE_SKIRT_FRONT_X - PROFILE_SKIRT_BACK_X) / 2
    : SKIRT_BOTTOM_HALF * view.girth;
  const centreX = view.profile ? (PROFILE_SKIRT_FRONT_X + PROFILE_SKIRT_BACK_X) / 2 : 0;
  shadeForm(ctx, trace, { from: place(centreX, 0), to: place(centreX, 1) }, LEATHER, {
    halfWidth,
    softness: BIB_SOFTNESS,
    specular: BIB_SPECULAR,
  });
  withClip(ctx, trace, () => {
    const charTop = 1 - SKIRT_CHAR_RISE / length;
    const from = place(centreX, charTop);
    const to = place(centreX, 1);
    const char = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    char.addColorStop(0, rgba(SOOT, 0));
    char.addColorStop(1, rgba(SOOT, SKIRT_CHAR_ALPHA));
    trace();
    ctx.fillStyle = char;
    ctx.fill();
    trace();
    ctx.strokeStyle = rgba(LEATHER.deep, BIB_EDGE_ALPHA);
    ctx.lineWidth = BIB_EDGE_WIDTH * 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  });
  const scale = view.profile ? 1 : view.girth;
  paintScorch(
    ctx,
    outline,
    view.profile ? PROFILE_SKIRT_SCORCH : SKIRT_SCORCH,
    (x, share) => place(x * scale, share),
    rotation,
  );
}

function paintTorso(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  if (frame.piece === 'jacket') paintBody(ctx, frame, context);
}

export const DEMOLITION_APRON = defineGarment({
  id: 'human_demolition_apron',
  name: 'Demolition Apron',
  wearer: 'human',
  material: 'leather',
  layer: 'outer',
  region: ['torso', 'hips'],
  paint: { torso: humanEveryView(paintTorso), hips: humanEveryView(paintSkirt) },
});
