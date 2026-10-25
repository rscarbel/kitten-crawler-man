/**
 * Ryan's trousers and belt: slim charcoal chinos below his shirt's tucked
 * tail, and a black leather belt with a silver buckle over the tuck.
 *
 * The legs are the townsfolk trousers' leg painter in a fixed slate cloth;
 * the seat over his hips is the trouser seat the cast's trousers are painted
 * with. The belt is painted at the bottom of the shirt's own torso trace, so
 * it sits exactly where the tail is tucked in, in every view.
 */

import type { BipedHipsFrame, BipedLegFrame, BipedTorsoFrame } from '../../art/biped/bipedParts';
import type { GlossRamp } from '../../art/biped/palette';
import { traceGarmentTorso } from '../../art/biped/torso';
import { paintTrouserSeat, type SeatFit } from '../../art/human/legwear';
import { rgba } from '../../art/bipedArt';
import { withClip } from '../../art/softShade';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import { type LegCloth, paintLegCloth } from './townsfolkLegwear';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/**
 * Charcoal slate: well under the shirt's value and a cool grey rather than
 * black, so his legs read as one dark mass against the light-blue top at the
 * tile while staying apart from the near-black belt and shoes. The lit side
 * climbs well clear of the shadow: a slim leg is two pixels across at the
 * tile, one lit and one in shade, and a charcoal whose light is only a step
 * off its base reads there as one flat dark strip.
 */
const SLATE: GlossRamp = {
  deep: '#13161c',
  shadow: '#1c2028',
  dark: '#252a33',
  mid: '#2a3039',
  base: '#5b6371',
  light: '#98a1af',
  rim: '#a3abba',
  specular: '#7f8897',
};

export const RYAN_SLATE: LegCloth = { cloth: SLATE, cut: 'slimTrousers' };

/**
 * A slim cut sits close to his narrow hips: head-on his trousers stand well
 * inside his shoulders, and edge-on his seat is about an eighth of his height
 * deep. The rig's heavy seat at its full size stands out round him like a
 * skirt and behind him like a paunch.
 */
const SLIM_SEAT: SeatFit = {
  across: 0.46,
  depth: 0.58,
  drop: 0.6,
  style: { kind: 'legs', cut: RYAN_SLATE.cut },
};

function paintSeat(ctx: Ctx, frame: BipedHipsFrame): void {
  paintTrouserSeat(ctx, frame.skeleton, frame.view, RYAN_SLATE.cloth, SLIM_SEAT, frame.look.limbs);
}

function paintLegs(ctx: Ctx, frame: BipedLegFrame): void {
  paintLegCloth(ctx, frame, RYAN_SLATE);
}

export const RYAN_CHINOS = defineGarment({
  id: 'ryan_chinos',
  name: 'Chinos',
  wearer: 'human',
  base: true,
  layer: 'over',
  region: ['hips', 'leg'],
  paint: {
    hips: humanEveryView(paintSeat),
    leg: humanEveryView(paintLegs),
  },
});

/** Black leather, its lit edge only just off black. */
export const RYAN_BELT_LEATHER = '#141417';
const BELT_LIT = '#34343a';
const BUCKLE = '#c6cbd3';
const BUCKLE_SHADE = '#6f747d';
/** How tall the belt stands, up from the bottom of the shirt's tail, in torso units. */
const BELT_HEIGHT = 0.05;
/** The belt runs on past his sides so the torso's clip, not the band's end, finishes it. */
const BELT_OVERREACH = 0.6;
/** The lit top edge of the belt, a sliver of its height. */
const BELT_LIP_SHARE = 0.25;
const BELT_LIP_ALPHA = 0.9;
/** The buckle: a rectangle a little taller than the belt, at the front. */
const BUCKLE_HALF_WIDTH = 0.034;
const BUCKLE_RISE = 0.006;
/** The buckle's frame, a band round the dark belt that shows through it. */
const BUCKLE_FRAME = 0.012;
/** Edge-on the buckle sits just in from the front of his waist. */
const PROFILE_BUCKLE_X = 0.17;
const PROFILE_BUCKLE_HALF_WIDTH = 0.016;

function paintBuckle(
  ctx: Ctx,
  centreX: number,
  halfWidth: number,
  top: number,
  bottom: number,
  at: (x: number, y: number) => { x: number; y: number },
): void {
  const outer = [
    at(centreX - halfWidth, top - BUCKLE_RISE),
    at(centreX + halfWidth, top - BUCKLE_RISE),
    at(centreX + halfWidth, bottom + BUCKLE_RISE),
    at(centreX - halfWidth, bottom + BUCKLE_RISE),
  ];
  ctx.beginPath();
  ctx.moveTo(outer[0].x, outer[0].y);
  for (const p of outer.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fillStyle = BUCKLE;
  ctx.fill();
  const inset = Math.min(BUCKLE_FRAME, halfWidth / 2);
  const inner = [
    at(centreX - halfWidth + inset, top - BUCKLE_RISE + inset),
    at(centreX + halfWidth - inset, top - BUCKLE_RISE + inset),
    at(centreX + halfWidth - inset, bottom + BUCKLE_RISE - inset),
    at(centreX - halfWidth + inset, bottom + BUCKLE_RISE - inset),
  ];
  ctx.beginPath();
  ctx.moveTo(inner[0].x, inner[0].y);
  for (const p of inner.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fillStyle = BUCKLE_SHADE;
  ctx.fill();
}

function paintBelt(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  if (frame.piece !== 'jacket') return;
  const { skeleton, view, look, torso } = frame;
  const bottom = torso.hemY;
  const top = bottom - BELT_HEIGHT;
  withClip(
    ctx,
    () => traceGarmentTorso(ctx, skeleton, context.pose, view, look),
    () => {
      const band = [
        torso.at(-BELT_OVERREACH, top),
        torso.at(BELT_OVERREACH, top),
        torso.hem(BELT_OVERREACH),
        torso.hem(-BELT_OVERREACH),
      ];
      ctx.beginPath();
      ctx.moveTo(band[0].x, band[0].y);
      for (const p of band.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fillStyle = RYAN_BELT_LEATHER;
      ctx.fill();
      const lipFrom = torso.at(-BELT_OVERREACH, top);
      const lipTo = torso.at(BELT_OVERREACH, top);
      ctx.strokeStyle = rgba(BELT_LIT, BELT_LIP_ALPHA);
      ctx.lineWidth = BELT_HEIGHT * BELT_LIP_SHARE;
      ctx.beginPath();
      ctx.moveTo(lipFrom.x, lipFrom.y);
      ctx.lineTo(lipTo.x, lipTo.y);
      ctx.stroke();
      if (view.showsBack) return;
      if (view.profile) {
        const buckleX = PROFILE_BUCKLE_X * torso.cut.profileDepth;
        paintBuckle(ctx, buckleX, PROFILE_BUCKLE_HALF_WIDTH, top, bottom, torso.at);
      } else paintBuckle(ctx, 0, BUCKLE_HALF_WIDTH, top, bottom, torso.at);
    },
  );
}

export const RYAN_BELT = defineGarment({
  id: 'ryan_belt',
  name: 'Belt',
  wearer: 'human',
  base: true,
  layer: 'outer',
  region: ['torso'],
  paint: { torso: humanEveryView(paintBelt) },
});
