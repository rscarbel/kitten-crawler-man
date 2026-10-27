/**
 * Brother Anselm's tonsure: the crown shaved bare and a ring of greying hair
 * left round the head above the ears, cut short. Painted in the head's own
 * frame by the rig's head painter, in the head-local units the cast heads
 * and Ryan's hair use (`human/castHead.ts`, `ryanHead.ts`): x a fraction of
 * `HEAD_RX` head-on and of `HEAD_DEPTH` edge-on, y of `HEAD_RY`, the crown
 * at −1.2 and the brow near −0.3.
 *
 * Head-on the ring is a band across the brow with the bare dome over it;
 * from behind and edge-on the shaved crown shows as a lit disc of scalp
 * inside the ring, which is what reads as a monk at the tile.
 */

import { type HairMass, headUnits, paintHairMass, type Units } from '../human/castHead';
import { hairTone, type HeadFeaturePainter } from './head';
import { fillSoftEllipse } from '../softShade';
import type { Ramp } from './palette';

/** Head-on: the ring as a band from ear to ear across the brow, the dome bare above it. */
const RING_FRONT: HairMass = {
  path: [
    ['M', -1.02, -0.12],
    ['Q', -1.1, -0.66, -0.84, -0.94],
    ['Q', -0.44, -1.1, 0, -1.1],
    ['Q', 0.44, -1.1, 0.84, -0.94],
    ['Q', 1.1, -0.66, 1.02, -0.12],
    ['L', 0.9, -0.2],
    ['Q', 0.9, -0.62, 0.68, -0.8],
    ['Q', 0.36, -0.88, 0, -0.88],
    ['Q', -0.36, -0.88, -0.68, -0.8],
    ['Q', -0.9, -0.62, -0.9, -0.2],
  ],
  strands: [
    [-0.5, -0.86, -0.42, -0.98, -0.3, -1.04],
    [0.3, -0.88, 0.36, -0.98, 0.5, -1.02],
  ],
};

/** Edge-on: short hair over the side and back of the head and down to the nape, the crown above it bare. */
const RING_PROFILE: HairMass = {
  path: [
    ['M', 0.36, -0.6],
    ['Q', 0.3, -0.92, -0.04, -0.98],
    ['Q', -0.74, -1.02, -1.02, -0.72],
    ['Q', -1.12, -0.16, -0.86, 0.42],
    ['L', -0.64, 0.2],
    ['Q', -0.5, -0.3, -0.22, -0.34],
    ['L', 0.1, -0.34],
    ['L', 0.16, -0.08],
    ['L', 0.26, -0.12],
    ['Q', 0.3, -0.36, 0.36, -0.6],
  ],
  strands: [
    [0.2, -0.82, -0.3, -0.96, -0.8, -0.74],
    [-0.2, -0.6, -0.7, -0.6, -0.86, 0.1],
  ],
};

/** From behind: the back of the head in short hair from ear to ear and down to the nape. */
const RING_BACK: HairMass = {
  path: [
    ['M', -1.1, -0.3],
    ['Q', -1.16, -1.0, -0.62, -1.24],
    ['Q', 0, -1.34, 0.62, -1.24],
    ['Q', 1.16, -1.0, 1.1, -0.3],
    ['Q', 1.04, 0.3, 0.7, 0.54],
    ['Q', 0, 0.68, -0.7, 0.54],
    ['Q', -1.04, 0.3, -1.1, -0.3],
  ],
  strands: [
    [-0.4, -0.5, -0.46, 0, -0.42, 0.44],
    [0.4, -0.5, 0.46, 0, 0.42, 0.44],
  ],
};

/** The shaved crown from behind: a disc of scalp high on the back of the head. */
const BACK_CROWN = { x: 0, y: -0.8, rx: 0.72, ry: 0.46 } as const;
/** Edge-on the disc is seen from its side, on top of the head toward the back. */
const PROFILE_CROWN = { x: -0.36, y: -1.0, rx: 0.5, ry: 0.16 } as const;
/** The scalp's lit face, then its shaded rim against the hair round it. */
const CROWN_LIGHT_SHARE = 0.7;
const CROWN_LIGHT_ALPHA = 1;

function paintCrown(
  ctx: CanvasRenderingContext2D,
  crown: { readonly x: number; readonly y: number; readonly rx: number; readonly ry: number },
  units: Units,
  skin: Pick<Ramp, 'base' | 'light'>,
): void {
  const centre = { x: crown.x * units.x, y: crown.y * units.y };
  const rx = crown.rx * units.x;
  const ry = crown.ry * units.y;
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin.base;
  ctx.fill();
  fillSoftEllipse(
    ctx,
    centre.x,
    centre.y - ry * (1 - CROWN_LIGHT_SHARE),
    rx * CROWN_LIGHT_SHARE,
    ry * CROWN_LIGHT_SHARE,
    skin.light,
    CROWN_LIGHT_ALPHA,
  );
}

/** Anselm's tonsure: a ring of short greying hair round a shaved crown. */
export const ANSELM_TONSURE: HeadFeaturePainter = (ctx, head) => {
  const units = headUnits(head.profile);
  const tone = hairTone(head.hair);
  if (head.fromBehind) {
    paintHairMass(ctx, RING_BACK, units, tone);
    paintCrown(ctx, BACK_CROWN, units, head.skin);
    return;
  }
  if (head.profile) {
    paintHairMass(ctx, RING_PROFILE, units, tone);
    paintCrown(ctx, PROFILE_CROWN, units, head.skin);
    return;
  }
  paintHairMass(ctx, RING_FRONT, units, tone);
};
