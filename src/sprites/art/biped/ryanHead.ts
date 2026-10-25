/**
 * Ryan's hair and beard: the head features of his look, painted in the
 * head's own frame by the rig's head painter (`head.ts`), under its pitch.
 *
 * Head-local units, as the cast heads use them (`human/castHead.ts`): origin
 * at the eye line, +Y down, x a fraction of `HEAD_RX` head-on and of
 * `HEAD_DEPTH` edge-on (the face toward +X), y a fraction of `HEAD_RY`. The
 * skull's crown is at −1.2, the brow near −0.3, the mouth at 0.62 and the
 * chin near 1.2.
 */

import type { Ramp } from './palette';
import { type HairMass, headUnits, paintHairMass } from '../human/castHead';
import { hairTone, type HeadFeaturePainter } from './head';

type Ctx = CanvasRenderingContext2D;

// ── Hair ─────────────────────────────────────────────────────────────────────

/**
 * Head-on: the sides cut close to the skull and the top left long, swept up
 * off the forehead so the crown stands a little clear of the skull's own
 * curve; lifted much higher, the head above the brow outgrows the face below. The
 * hairline sits a third of the face above the brow — as far as the brow is
 * above the base of the nose — and steps back only a little at each temple:
 * set higher, or cut back deep at the temples, the forehead reads as a tall
 * bare dome over a small face.
 */
const SWEPT_TOP_FRONT: HairMass = {
  path: [
    ['M', -1.0, -0.24],
    ['Q', -1.09, -0.92, -0.9, -1.16],
    ['Q', -0.62, -1.36, 0.04, -1.36],
    ['Q', 0.7, -1.34, 0.92, -1.16],
    ['Q', 1.09, -0.92, 1.0, -0.24],
    ['L', 0.9, -0.28],
    ['Q', 0.9, -0.6, 0.74, -0.8],
    ['Q', 0.62, -0.92, 0.42, -0.84],
    ['Q', 0.2, -0.76, 0, -0.76],
    ['Q', -0.2, -0.76, -0.42, -0.84],
    ['Q', -0.62, -0.92, -0.74, -0.8],
    ['Q', -0.9, -0.6, -0.9, -0.28],
  ],
  strands: [
    [-0.36, -0.82, -0.42, -1.1, -0.16, -1.3],
    [-0.08, -0.78, -0.1, -1.1, 0.14, -1.32],
    [0.22, -0.8, 0.26, -1.06, 0.46, -1.26],
  ],
};

/**
 * Edge-on the lift is at the front: the top rises off the hairline and runs
 * back over the crown, while the back and the sides above the ear lie short
 * against the skull and taper to the nape. The hairline comes down to the
 * same third of the face as head-on, and the temple fills in behind it to
 * the sideburn; left bare, the temple is a wedge of skin as tall as the face
 * below the brow.
 */
const SWEPT_TOP_PROFILE: HairMass = {
  path: [
    ['M', 0.62, -0.76],
    ['Q', 0.8, -1.2, 0.46, -1.38],
    ['Q', -0.04, -1.48, -0.56, -1.3],
    ['Q', -1.04, -1.14, -1.08, -0.52],
    ['Q', -1.1, 0.12, -0.86, 0.42],
    ['L', -0.64, 0.2],
    ['Q', -0.5, -0.3, -0.22, -0.34],
    ['L', 0.1, -0.34],
    ['L', 0.16, -0.08],
    ['L', 0.26, -0.12],
    ['Q', 0.32, -0.44, 0.46, -0.56],
    ['Q', 0.54, -0.72, 0.62, -0.76],
  ],
  strands: [
    [0.5, -0.86, 0.36, -1.28, -0.3, -1.36],
    [0.36, -0.72, 0.12, -1.18, -0.6, -1.18],
    [0.2, -0.46, -0.2, -0.84, -0.84, -0.7],
  ],
};

/**
 * From behind: the long top over the crown, and the back cut short but
 * running on down past the ears to the nape, where it tapers in to the neck.
 */
const SWEPT_TOP_BACK: HairMass = {
  path: [
    ['M', -1.12, -0.3],
    ['Q', -1.18, -1.1, -0.62, -1.32],
    ['Q', 0, -1.42, 0.62, -1.32],
    ['Q', 1.18, -1.1, 1.12, -0.3],
    ['Q', 1.06, 0.3, 0.7, 0.56],
    ['Q', 0, 0.7, -0.7, 0.56],
    ['Q', -1.06, 0.3, -1.12, -0.3],
  ],
  strands: [
    [-0.3, -1.42, -0.42, -0.6, -0.4, 0.5],
    [0.1, -1.46, 0.08, -0.6, 0.1, 0.6],
    [0.46, -1.34, 0.56, -0.6, 0.52, 0.48],
  ],
};

function hairMassFor(profile: boolean, fromBehind: boolean): HairMass {
  if (fromBehind) return SWEPT_TOP_BACK;
  return profile ? SWEPT_TOP_PROFILE : SWEPT_TOP_FRONT;
}

/** Ryan's cut: short tapered sides and back, a longer top swept up and back. */
export const RYAN_SWEPT_TOP: HeadFeaturePainter = (ctx, head) => {
  const mass = hairMassFor(head.profile, head.fromBehind);
  paintHairMass(ctx, mass, headUnits(head.profile), hairTone(head.hair));
};

// ── Beard ────────────────────────────────────────────────────────────────────

/**
 * Brown with a warmer, more ginger cast than his hair: beard hair grows
 * redder than the scalp's on a great many brown-haired men.
 */
const BEARD: Ramp = {
  deep: '#3a2a20',
  shadow: '#4e3a2b',
  dark: '#634a37',
  mid: '#765b45',
  base: '#866a51',
  light: '#9a7e63',
  rim: '#b0967c',
};

/**
 * A short, even beard head-on: down each jaw from the sideburn, round under
 * the chin, with a neat cheek line running down to the corners of the mouth
 * and only the lips left bare. Close-cropped, so it stands only just off
 * the jaw it follows.
 */
const SHORT_BEARD_FRONT: HairMass = {
  path: [
    ['M', -0.95, 0.04],
    ['Q', -0.95, 0.58, -0.74, 0.9],
    ['Q', -0.42, 1.1, 0, 1.12],
    ['Q', 0.42, 1.1, 0.76, 0.92],
    ['Q', 0.95, 0.58, 0.95, 0.04],
    ['L', 0.9, 0.3],
    ['Q', 0.7, 0.4, 0.46, 0.5],
    ['L', 0.34, 0.6],
    ['Q', 0, 0.75, -0.34, 0.6],
    ['L', -0.46, 0.5],
    ['Q', -0.7, 0.4, -0.9, 0.3],
  ],
};

/**
 * The moustache over the upper lip, trimmed level along the lip and square
 * at its ends where it joins the beard at the corners of the mouth: let its
 * ends fall past the corners and it is a handlebar.
 */
const MOUSTACHE_FRONT: HairMass = {
  path: [
    ['M', -0.44, 0.6],
    ['L', -0.44, 0.47],
    ['Q', -0.22, 0.38, 0, 0.41],
    ['Q', 0.22, 0.38, 0.44, 0.47],
    ['L', 0.44, 0.6],
    ['Q', 0, 0.6, -0.44, 0.6],
  ],
};

/** Edge-on: the sideburn, down the jaw to under the chin, open round the lips. */
const SHORT_BEARD_PROFILE: HairMass = {
  path: [
    ['M', 0.04, -0.12],
    ['L', -0.1, 0.44],
    ['Q', -0.04, 1.04, 0.56, 1.14],
    ['Q', 0.98, 1.18, 0.98, 0.8],
    ['L', 0.82, 0.76],
    ['Q', 0.6, 0.68, 0.56, 0.5],
    ['Q', 0.42, 0.34, 0.22, 0.22],
    ['L', 0.18, -0.12],
  ],
};

const MOUSTACHE_PROFILE: HairMass = {
  path: [
    ['M', 0.76, 0.44],
    ['L', 1.04, 0.42],
    ['L', 1.04, 0.56],
    ['L', 0.8, 0.58],
  ],
};

/**
 * Heavy-stubble length: the skin shows through it, so it is laid on well
 * short of opaque, a shadow of hair over the jaw rather than a mat of it.
 */
const STUBBLE_OPACITY = 0.34;
/** Stubble has no edge of its own where it stops on the cheek: it thins out into the skin. */
const STUBBLE_EDGE = 0;

/** Ryan's short full beard and connected moustache. Not painted from behind. */
export const RYAN_SHORT_BEARD: HeadFeaturePainter = (ctx: Ctx, head) => {
  if (head.fromBehind) return;
  const units = headUnits(head.profile);
  const masses = head.profile
    ? [SHORT_BEARD_PROFILE, MOUSTACHE_PROFILE]
    : [SHORT_BEARD_FRONT, MOUSTACHE_FRONT];
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * STUBBLE_OPACITY;
  try {
    for (const mass of masses) paintHairMass(ctx, mass, units, BEARD, STUBBLE_EDGE);
  } finally {
    ctx.globalAlpha = alpha;
  }
};
