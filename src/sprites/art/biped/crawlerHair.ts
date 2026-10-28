/**
 * The human crawler's hair and beard: head features painted in the
 * head's own frame by the rig's head painter (`head.ts`), under its pitch.
 *
 * Head-local units, as the cast heads use them (`human/castHead.ts`): origin
 * at the eye line, +Y down, x a fraction of `HEAD_RX` head-on and of
 * `HEAD_DEPTH` edge-on (the face toward +X), y a fraction of `HEAD_RY`. The
 * skull's crown is at −1.2, the brow near −0.3, the mouth at 0.62 and the
 * chin near 1.2.
 */

import type { Ramp } from './palette';
import { HEAD_RX } from './proportions';
import {
  type HairMass,
  headUnits,
  paintHairMass,
  type Strand,
  type Units,
} from '../human/castHead';
import { type HeadFeatureFrame, hairTone, type HeadFeaturePainter } from './head';

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

/** Short tapered sides and back, a longer top swept up and back. */
export const SWEPT_TOP: HeadFeaturePainter = (ctx, head) => {
  const mass = hairMassFor(head.profile, head.fromBehind);
  paintHairMass(ctx, mass, headUnits(head.profile), hairTone(head.hair));
};

// ── Tight curls cut short ────────────────────────────────────────────────────

/**
 * The coils combed into a tight-curl crop: small arcs on a brick grid across
 * `bounds`, each a curl's shadowed underside. Clipped to the mass they are
 * painted in, so the grid may overrun it. A combed groove running one way is
 * straight hair; a field of short turns is what reads as coil.
 */
function coilStrands(bounds: {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}): readonly Strand[] {
  const strands: Strand[] = [];
  let row = 0;
  for (let rowY = bounds.top; rowY <= bounds.bottom; rowY += COIL_ROW_STEP, row++) {
    const stagger = row % 2 === 0 ? 0 : COIL_COLUMN_STEP / 2;
    let column = 0;
    for (
      let columnX = bounds.left + stagger;
      columnX <= bounds.right;
      columnX += COIL_COLUMN_STEP, column++
    ) {
      const x = columnX + coilJitter(row, column, COIL_JITTER_X_SALT);
      const y = rowY + coilJitter(row, column, COIL_JITTER_Y_SALT);
      strands.push([
        x - COIL_HALF_SPAN,
        y,
        x,
        y + COIL_HALF_SPAN * COIL_CUP,
        x + COIL_HALF_SPAN,
        y,
      ]);
    }
  }
  return strands;
}

/**
 * A fixed offset per coil, up to {@link COIL_JITTER} either way, so the coils
 * do not line up into a mesh. A pure function of the coil's place, so every
 * bake paints the same curls.
 */
function coilJitter(row: number, column: number, salt: number): number {
  const hashed = Math.sin(row * COIL_HASH_ROW + column * COIL_HASH_COLUMN + salt) * COIL_HASH_SCALE;
  const unit = hashed - Math.floor(hashed);
  return (unit * 2 - 1) * COIL_JITTER;
}

const COIL_JITTER = 0.05;
const COIL_HASH_ROW = 12.9898;
const COIL_HASH_COLUMN = 78.233;
const COIL_HASH_SCALE = 43758.5453;
const COIL_JITTER_X_SALT = 0;
const COIL_JITTER_Y_SALT = 1.7;

/** Coils sit about a sixth of the head's half-width apart: a 4c coil cut short, not waves. */
const COIL_COLUMN_STEP = 0.2;
const COIL_ROW_STEP = 0.17;
const COIL_HALF_SPAN = 0.065;
/** How deep each coil's arc cups below its ends, against its half-span. */
const COIL_CUP = 1.3;

/**
 * Head-on: an even crop of tight curls standing a finger's width off the
 * skull, a little fuller over the crown, the sides taken down close. The
 * hairline is lined up straight across at the swept top's height with
 * squared temples: the edge-up a short curly cut is kept with. Its crown
 * stays under the swept top's, so every hat sized to that crop covers it.
 */
const TIGHT_CURL_FRONT: HairMass = {
  path: [
    ['M', -0.98, -0.26],
    ['Q', -1.06, -0.94, -0.86, -1.14],
    ['Q', -0.56, -1.3, 0, -1.3],
    ['Q', 0.56, -1.3, 0.86, -1.14],
    ['Q', 1.06, -0.94, 0.98, -0.26],
    ['L', 0.9, -0.3],
    ['L', 0.86, -0.7],
    ['Q', 0.8, -0.78, 0.66, -0.78],
    ['Q', 0, -0.74, -0.66, -0.78],
    ['Q', -0.8, -0.78, -0.86, -0.7],
    ['L', -0.9, -0.3],
  ],
  lobes: [
    { x: -0.84, y: -1.08, r: 0.12 },
    { x: -0.5, y: -1.22, r: 0.12 },
    { x: -0.16, y: -1.26, r: 0.12 },
    { x: 0.18, y: -1.26, r: 0.12 },
    { x: 0.52, y: -1.22, r: 0.12 },
    { x: 0.86, y: -1.08, r: 0.12 },
  ],
  strands: coilStrands({ left: -1.0, right: 1.0, top: -1.28, bottom: -0.3 }),
};

/**
 * Edge-on: the same close crop over the crown and down the back of the
 * skull to a short nape, the curls standing off the head evenly all round,
 * and a squared temple and short sideburn at the front.
 */
const TIGHT_CURL_PROFILE: HairMass = {
  path: [
    ['M', 0.58, -0.74],
    ['Q', 0.74, -1.16, 0.4, -1.3],
    ['Q', -0.06, -1.42, -0.56, -1.26],
    ['Q', -0.98, -1.06, -1.0, -0.5],
    ['Q', -1.02, 0.04, -0.86, 0.34],
    ['L', -0.66, 0.18],
    ['Q', -0.5, -0.3, -0.22, -0.34],
    ['L', 0.1, -0.34],
    ['L', 0.14, -0.06],
    ['L', 0.26, -0.1],
    ['L', 0.3, -0.62],
    ['Q', 0.44, -0.74, 0.58, -0.74],
  ],
  lobes: [
    { x: 0.44, y: -1.18, r: 0.12 },
    { x: 0.02, y: -1.3, r: 0.12 },
    { x: -0.46, y: -1.22, r: 0.12 },
    { x: -0.8, y: -0.96, r: 0.12 },
    { x: -0.92, y: -0.52, r: 0.12 },
  ],
  strands: coilStrands({ left: -1.1, right: 0.7, top: -1.36, bottom: 0.3 }),
};

/** From behind: the crop over the crown and down to a short nape above the collar. */
const TIGHT_CURL_BACK: HairMass = {
  path: [
    ['M', -1.08, -0.3],
    ['Q', -1.14, -1.06, -0.6, -1.26],
    ['Q', 0, -1.36, 0.6, -1.26],
    ['Q', 1.14, -1.06, 1.08, -0.3],
    ['Q', 1.02, 0.24, 0.68, 0.46],
    ['Q', 0, 0.58, -0.68, 0.46],
    ['Q', -1.02, 0.24, -1.08, -0.3],
  ],
  lobes: [
    { x: -0.88, y: -1.0, r: 0.12 },
    { x: -0.46, y: -1.22, r: 0.12 },
    { x: 0, y: -1.28, r: 0.12 },
    { x: 0.46, y: -1.22, r: 0.12 },
    { x: 0.88, y: -1.0, r: 0.12 },
  ],
  strands: coilStrands({ left: -1.1, right: 1.1, top: -1.32, bottom: 0.5 }),
};

function tightCurlMassFor(head: HeadFeatureFrame): HairMass {
  if (head.fromBehind) return TIGHT_CURL_BACK;
  return head.profile ? TIGHT_CURL_PROFILE : TIGHT_CURL_FRONT;
}

/** Tight curls cut short and even all over, the hairline lined up square. */
export const TIGHT_CURL_CROP: HeadFeaturePainter = (ctx, head) => {
  paintHairMass(ctx, tightCurlMassFor(head), headUnits(head.profile), hairTone(head.hair));
};

// ── Hair pulled back ─────────────────────────────────────────────────────────
//
// Both of the female crawler's cuts are pulled back off the face and gathered
// low at the nape: the cap lies close over the skull, under the crown height
// the swept top reaches, so every hat that clears the swept top clears these;
// what is gathered hangs below the skull, where no hat reaches.

/**
 * Head-on: a smooth cap parted in the middle and drawn back over the ears,
 * the hairline a third of the face above the brow and running down past the
 * temples over the ears: a cut that stops above the ear reads head-on as a
 * man's short back and sides.
 */
const PULLED_BACK_FRONT: HairMass = {
  path: [
    ['M', -1.08, 0.24],
    ['Q', -1.16, -1.32, 0, -1.32],
    ['Q', 1.16, -1.32, 1.08, 0.24],
    ['L', 0.94, 0.12],
    ['Q', 0.88, -0.6, 0.5, -0.76],
    ['Q', 0.2, -0.82, 0.02, -0.86],
    ['Q', -0.2, -0.82, -0.5, -0.76],
    ['Q', -0.88, -0.6, -0.94, 0.12],
  ],
  strands: [
    [0.02, -0.86, 0.02, -1.1, 0, -1.3],
    [-0.12, -1.16, -0.66, -1.0, -0.94, -0.3],
    [0.12, -1.16, 0.66, -1.0, 0.94, -0.3],
  ],
};

/**
 * Edge-on: the cap from the hairline over the crown and down the back of the
 * skull to the nape, combed straight back, the ear left bare below it.
 */
const PULLED_BACK_PROFILE: HairMass = {
  path: [
    ['M', 0.62, -0.74],
    ['Q', 0.78, -1.28, 0.2, -1.4],
    ['Q', -0.6, -1.46, -1.02, -0.96],
    ['Q', -1.2, -0.4, -0.98, 0.3],
    ['L', -0.72, 0.28],
    ['Q', -0.56, -0.24, -0.24, -0.34],
    ['L', 0.12, -0.36],
    ['Q', 0.36, -0.46, 0.46, -0.6],
    ['Q', 0.54, -0.7, 0.62, -0.74],
  ],
  strands: [
    [0.5, -0.82, 0.1, -1.32, -0.7, -1.12],
    [0.32, -0.6, -0.2, -1.0, -0.94, -0.5],
    [0.1, -0.42, -0.5, -0.6, -0.92, 0.1],
  ],
};

/** From behind: the cap over the whole back of the skull, combed in to the nape. */
const PULLED_BACK_BACK: HairMass = {
  path: [
    ['M', -1.08, -0.3],
    ['Q', -1.14, -1.36, 0, -1.38],
    ['Q', 1.14, -1.36, 1.08, -0.3],
    ['Q', 1.0, 0.24, 0.3, 0.42],
    ['Q', 0, 0.48, -0.3, 0.42],
    ['Q', -1.0, 0.24, -1.08, -0.3],
  ],
  strands: [
    [-0.8, -1.0, -0.6, -0.2, -0.16, 0.36],
    [0, -1.36, 0, -0.5, 0, 0.4],
    [0.8, -1.0, 0.6, -0.2, 0.16, 0.36],
  ],
};

function pulledBackCap(head: HeadFeatureFrame): HairMass {
  if (head.fromBehind) return PULLED_BACK_BACK;
  return head.profile ? PULLED_BACK_PROFILE : PULLED_BACK_FRONT;
}

/** How much of the head's lag a free end of hair swings by, against the tufts of a crop. */
const LOOSE_END_LAG = 1;

/** The head's lag, carried by a loose end, in head-local fractions of `units`. */
function looseEndLag(head: HeadFeatureFrame, units: Units): { x: number; y: number } {
  return {
    x: (head.tipLag.x * LOOSE_END_LAG) / units.x,
    y: (head.tipLag.y * LOOSE_END_LAG) / units.y,
  };
}

/**
 * A ponytail tied at the nape and hanging to between the shoulder blades:
 * edge-on lying against the back of the neck, from behind down the middle of
 * the back. Its end swings with the head's lag. Head-on it is hidden behind
 * her. Edge-on it overlaps the neck rather than hanging clear of it: the
 * figure lights every edge turned from the key that has background beside
 * it, and a sliver of background between hair and neck paints a pale line
 * down the inside of the hair.
 */
function ponytailMass(head: HeadFeatureFrame, units: Units): HairMass | null {
  if (!head.profile && !head.fromBehind) return null;
  const lag = looseEndLag(head, units);
  if (head.profile) {
    const tip = { x: -1.0 + lag.x, y: 2.05 + lag.y };
    return {
      path: [
        ['M', -1.06, 0.06],
        ['Q', -1.34, 0.4, -1.24, 1.0],
        ['Q', -1.2, 1.6, tip.x, tip.y],
        ['Q', -0.66, 1.7, -0.6, 1.1],
        ['Q', -0.5, 0.56, -0.5, 0.26],
      ],
      strands: [[-0.98, 0.2, -1.16, 0.8, -1.0, 1.8]],
    };
  }
  const tip = { x: lag.x, y: 2.1 + lag.y };
  return {
    path: [
      ['M', -0.26, 0.24],
      ['Q', -0.46, 0.9, -0.3, 1.5],
      ['Q', -0.2, 1.96, tip.x, tip.y],
      ['Q', 0.2, 1.96, 0.3, 1.5],
      ['Q', 0.46, 0.9, 0.26, 0.24],
    ],
    strands: [
      [-0.1, 0.3, -0.24, 1.1, -0.04, 1.9],
      [0.12, 0.3, 0.22, 1.1, 0.06, 1.9],
    ],
  };
}

/** The tie round the ponytail's root, a band of the hair's own deepest tone. */
const TIE_HALF = 0.14;
const TIE_THICKNESS = 0.11;
const PROFILE_TIE = { x: -1.0, y: 0.2 };
const BACK_TIE = { x: 0, y: 0.34 };

function paintTie(ctx: Ctx, head: HeadFeatureFrame, units: Units): void {
  const at = head.profile ? PROFILE_TIE : BACK_TIE;
  const half = head.profile ? TIE_HALF : TIE_HALF * 2;
  ctx.fillStyle = head.hair.deep;
  ctx.fillRect(
    (at.x - half) * units.x,
    (at.y - TIE_THICKNESS / 2) * units.y,
    half * 2 * units.x,
    TIE_THICKNESS * units.y,
  );
}

/** Hair drawn back off the face into a low ponytail at the nape. */
export const LOW_PONYTAIL: HeadFeaturePainter = (ctx, head) => {
  const units = headUnits(head.profile);
  const tone = hairTone(head.hair);
  const tail = ponytailMass(head, units);
  if (tail !== null) paintHairMass(ctx, tail, units, tone);
  paintHairMass(ctx, pulledBackCap(head), units, tone);
  if (tail !== null) paintTie(ctx, head, units);
};

/** How many plaits the braid is crossed into, root to tip. */
const BRAID_PLAITS = 9;
/** Each plait's half-width, in head-local fractions of the head's half-width, root to tip. */
const BRAID_ROOT_RADIUS = 0.3;
const BRAID_TIP_RADIUS = 0.18;
/** How far each plait steps to alternate sides of the braid's line, as a share of its radius. */
const BRAID_PLAIT_STAGGER = 0.35;
/** The rope under the plaits, as a share of each plait's half-width. */
const BRAID_ROPE_SHARE = 0.8;
/**
 * The braid's line from the nape to its tip, head-on from behind and edge-on;
 * edge-on it lies against the back of the neck, as the ponytail does.
 */
const BACK_BRAID = { root: { x: 0, y: 0.3 }, tip: { x: 0, y: 2.3 } };
const PROFILE_BRAID = { root: { x: -0.8, y: 0.12 }, tip: { x: -0.8, y: 2.15 } };

/**
 * A single braid from the nape down between the shoulder blades: a chain of
 * plaits stepping from side to side, narrowing to the tip, its lower end
 * swinging with the head's lag. Dark hair against the shirt's light back is
 * what reads from behind at the tile, where a knot of it on the dark head
 * would vanish. Head-on it is hidden behind her.
 */
function braidMass(head: HeadFeatureFrame, units: Units): HairMass | null {
  if (!head.profile && !head.fromBehind) return null;
  const line = head.profile ? PROFILE_BRAID : BACK_BRAID;
  const lag = looseEndLag(head, units);
  const tip = { x: line.tip.x + lag.x, y: line.tip.y + lag.y };
  const lobes = Array.from({ length: BRAID_PLAITS }, (_unused, index) => {
    const share = index / (BRAID_PLAITS - 1);
    const radius = BRAID_ROOT_RADIUS + (BRAID_TIP_RADIUS - BRAID_ROOT_RADIUS) * share;
    const side = index % 2 === 0 ? -1 : 1;
    const across = (side * radius * BRAID_PLAIT_STAGGER * HEAD_RX) / units.x;
    return {
      x: line.root.x + (tip.x - line.root.x) * share + across,
      y: line.root.y + (tip.y - line.root.y) * share,
      r: radius,
    };
  });
  // One rope under the plaits, so they read as a braid rather than a string of beads.
  const ropeHalf = (radius: number): number => (radius * BRAID_ROPE_SHARE * HEAD_RX) / units.x;
  const rootHalf = ropeHalf(BRAID_ROOT_RADIUS);
  const tipHalf = ropeHalf(BRAID_TIP_RADIUS);
  return {
    path: [
      ['M', line.root.x - rootHalf, line.root.y],
      ['L', line.root.x + rootHalf, line.root.y],
      ['L', tip.x + tipHalf, tip.y],
      ['L', tip.x - tipHalf, tip.y],
    ],
    lobes,
  };
}

/** Hair worn close to the head and drawn back into a single low braid. */
export const LOW_BRAID: HeadFeaturePainter = (ctx, head) => {
  const units = headUnits(head.profile);
  const tone = hairTone(head.hair);
  const braid = braidMass(head, units);
  // The braid takes the hair's own ramp, a step lighter than the cap's, so
  // the plaits stand apart from the dark head they hang from.
  if (braid !== null) paintHairMass(ctx, braid, units, head.hair);
  paintHairMass(ctx, pulledBackCap(head), units, tone);
};

// ── Beard ────────────────────────────────────────────────────────────────────

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

/** A short full beard and connected moustache in `beard`'s colours. Not painted from behind. */
export function shortBeard(beard: Ramp): HeadFeaturePainter {
  return (ctx: Ctx, head) => {
    if (head.fromBehind) return;
    const units = headUnits(head.profile);
    const masses = head.profile
      ? [SHORT_BEARD_PROFILE, MOUSTACHE_PROFILE]
      : [SHORT_BEARD_FRONT, MOUSTACHE_FRONT];
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * STUBBLE_OPACITY;
    try {
      for (const mass of masses) paintHairMass(ctx, mass, units, beard, STUBBLE_EDGE);
    } finally {
      ctx.globalAlpha = alpha;
    }
  };
}
