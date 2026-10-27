/**
 * Hair and facial hair for the people built on the biped rig.
 *
 * Dave's tufted crop is his and nobody else's: a look painted on the rig
 * paints none of the rig's own hair (its `hairstyle` draws nothing) and wears
 * one of these styles instead, so no townsperson shares his head at the 32 px
 * tile. Each style is painted as the rig's `over` attachment in the head's own frame —
 * translated to the solved head centre and turned with it — so it rides every
 * bob, nod and turn of the head it sits on.
 *
 * Head-local units, as `biped/head.ts` paints in: origin at the eye line, +Y
 * down, x a fraction of `HEAD_RX` head-on and of `HEAD_DEPTH` edge-on (the
 * face toward +X), y a fraction of `HEAD_RY`. The skull's crown is at -1.2,
 * the brow near -0.3, the mouth at 0.62 and the chin near 1.2.
 */

import { headAngle, pitchedHairY } from '../biped/head';
import { crease, shadeForm } from '../biped/paint';
import { type Ramp } from '../biped/palette';
import { HEAD_DEPTH, HEAD_RX, HEAD_RY } from '../biped/proportions';
import { type BipedPose, type Skeleton, type ViewSpec } from '../biped/rig';
import { rgba, type Pt } from '../bipedArt';
import { withClip } from '../softShade';

type Ctx = CanvasRenderingContext2D;

/** Every hairstyle a figure on the biped rig can wear; none of them is Dave's crop. */
export type HairStyleKind =
  'bald' | 'receding' | 'sidePart' | 'long' | 'bun' | 'ponytail' | 'curly';

export type FacialHairKind = 'none' | 'fullBeard' | 'moustache' | 'goatee';

/** What a cast head wears: the style and its colour. */
export interface CastHeadSpec {
  readonly hairStyle: HairStyleKind;
  readonly facialHair: FacialHairKind;
  readonly hair: Ramp;
}

// ── Shape tables ─────────────────────────────────────────────────────────────

export type PathCommand =
  | readonly ['M', number, number]
  | readonly ['L', number, number]
  | readonly ['Q', number, number, number, number];

interface Lobe {
  readonly x: number;
  readonly y: number;
  /** In units of `HEAD_RX` in every view, so a curl is the same size turned or not. */
  readonly r: number;
}

/** A groove combed into a mass, as a quadratic: from, control, to. */
export type Strand = readonly [number, number, number, number, number, number];

/**
 * One closed mass of hair: an outline, round lobes unioned with it, and the
 * grooves combed into it. A smooth shaded shell on a head is a helmet; the
 * grooves running the way the hair lies are what make it hair.
 */
export interface HairMass {
  readonly path: readonly PathCommand[];
  readonly lobes?: readonly Lobe[];
  readonly strands?: readonly Strand[];
}

/** A style's masses, per view: head-on, edge-on and from behind. */
interface ViewMasses {
  readonly front: readonly HairMass[];
  readonly profile: readonly HairMass[];
  readonly back: readonly HairMass[];
}

/** The smooth dome every capped style is built on, temple to temple over the crown. */
const DOME_FRONT: readonly PathCommand[] = [
  ['M', -1.06, -0.1],
  ['Q', -1.12, -1.38, 0, -1.33],
  ['Q', 1.12, -1.38, 1.06, -0.1],
];

/** A side-parted cut: the fringe swept off the parting and down toward one temple. */
const SIDE_PART_FRONT: HairMass = {
  path: [
    ...DOME_FRONT,
    ['L', 0.92, -0.32],
    ['Q', 0.5, -0.5, -0.3, -0.74],
    ['L', -0.42, -0.82],
    ['Q', -0.82, -0.76, -0.94, -0.3],
  ],
  strands: [
    [-0.42, -0.82, -0.38, -1.1, -0.24, -1.3],
    [-0.2, -1.22, 0.4, -1.1, 0.72, -0.5],
    [-0.1, -0.86, 0.3, -0.84, 0.6, -0.5],
    [-0.62, -0.84, -0.86, -0.7, -0.92, -0.36],
  ],
};

/** A centre parting framing the brow from both sides. */
const CENTRE_PART_FRONT: HairMass = {
  path: [
    ...DOME_FRONT,
    ['L', 0.94, -0.3],
    ['Q', 0.7, -0.72, 0.04, -0.82],
    ['Q', -0.7, -0.72, -0.94, -0.3],
  ],
  strands: [
    [0.04, -0.82, 0.02, -1.1, 0, -1.3],
    [-0.1, -1.18, -0.6, -1.0, -0.82, -0.42],
    [0.1, -1.18, 0.6, -1.0, 0.82, -0.42],
  ],
};

/** From behind the cap runs down the skull to a nape line below the ears. */
const BACK_STRANDS: readonly Strand[] = [
  [0, -1.24, -0.1, -0.4, -0.08, 0.5],
  [-0.4, -1.12, -0.62, -0.4, -0.56, 0.4],
  [0.4, -1.12, 0.62, -0.4, 0.56, 0.4],
];
const CAP_BACK: HairMass = {
  path: [...DOME_FRONT, ['L', 0.86, 0.46], ['Q', 0, 0.64, -0.86, 0.46]],
  strands: BACK_STRANDS,
};

/** Edge-on: the hairline at the forehead, over the crown, down to the nape, and back over the ear. */
const CAP_PROFILE: HairMass = {
  path: [
    ['M', 0.95, -0.66],
    ['Q', 1.02, -1.4, 0, -1.4],
    ['Q', -1.22, -1.34, -1.12, -0.3],
    ['L', -0.96, 0.42],
    ['Q', -0.52, 0.18, -0.38, -0.36],
    ['Q', -0.1, -0.46, 0.3, -0.42],
    ['L', 0.3, -0.12],
    ['Q', 0.4, -0.38, 0.5, -0.5],
    ['Q', 0.72, -0.58, 0.95, -0.66],
  ],
  strands: [
    [0.7, -0.8, 0.2, -1.3, -0.6, -1.0],
    [0.5, -0.56, -0.2, -0.9, -0.9, -0.3],
  ],
};

/** Long hair hanging past the shoulders: two curtains head-on, kept outside the cheeks. */
const LONG_CURTAINS_FRONT: readonly HairMass[] = [-1, 1].map((side) => ({
  path: [
    ['M', side * 1.06, -0.3],
    ['Q', side * 1.36, 0.9, side * 1.22, 2.1],
    ['L', side * 0.66, 2.0],
    ['Q', side * 0.86, 1.2, side * 0.9, 0.7],
    ['Q', side * 0.98, 0.2, side * 0.94, -0.3],
  ],
}));

const LONG_BACK: HairMass = {
  path: [
    ...DOME_FRONT,
    ['Q', 1.3, 1.0, 1.36, 2.1],
    ['Q', 0, 2.34, -1.36, 2.1],
    ['Q', -1.3, 1.0, -1.06, -0.1],
  ],
  strands: [
    [0, -1.24, -0.1, 0.4, -0.04, 2.1],
    [-0.46, -1.1, -0.9, 0.4, -0.86, 2.0],
    [0.46, -1.1, 0.9, 0.4, 0.86, 2.0],
  ],
};

const LONG_PROFILE: HairMass = {
  path: [
    ['M', 0.95, -0.66],
    ['Q', 1.02, -1.4, 0, -1.4],
    ['Q', -1.26, -1.34, -1.16, -0.2],
    ['L', -1.2, 1.9],
    ['Q', -0.62, 2.12, -0.18, 1.86],
    ['Q', -0.02, 0.6, 0.12, -0.3],
    ['Q', 0.56, -0.56, 0.95, -0.66],
  ],
  strands: [
    [0.6, -1.1, -0.6, -1.2, -0.8, 1.6],
    [0.3, -0.6, -0.4, -0.5, -0.5, 1.7],
  ],
};

/** A knot of hair pinned on the crown, standing over the head's outline in every view. */
const BUN_FRONT: Lobe = { x: 0, y: -1.46, r: 0.4 };
const BUN_BACK: Lobe = { x: 0, y: -1.0, r: 0.46 };
const BUN_PROFILE: Lobe = { x: -0.92, y: -1.08, r: 0.44 };

/** A tail tied at the back of the head, hanging to the shoulder blades. */
const PONYTAIL_BACK: HairMass = {
  path: [
    ['M', -0.3, -0.5],
    ['Q', -0.42, 0.9, -0.16, 1.9],
    ['Q', 0, 2.04, 0.16, 1.9],
    ['Q', 0.42, 0.9, 0.3, -0.5],
  ],
};
const PONYTAIL_PROFILE: HairMass = {
  path: [
    ['M', -0.96, -0.72],
    ['Q', -1.62, 0.2, -1.3, 1.72],
    ['Q', -1.16, 1.84, -1.06, 1.66],
    ['Q', -1.22, 0.4, -0.86, -0.36],
  ],
};

/**
 * A full head of tight curls: a mass bigger than the skull, its edge broken
 * into round lobes so it reads as curl and not as a helmet. The hairline sits
 * well above the brow so the face stays clear.
 */
const CURLY_FRONT: HairMass = {
  path: [
    ['M', -1.08, -0.2],
    ['Q', -1.3, -1.56, 0, -1.56],
    ['Q', 1.3, -1.56, 1.08, -0.2],
    ['L', 0.9, -0.36],
    ['Q', 0.6, -0.7, 0, -0.74],
    ['Q', -0.6, -0.7, -0.9, -0.36],
  ],
  lobes: [
    { x: -1.08, y: -0.3, r: 0.32 },
    { x: -1.1, y: -0.84, r: 0.38 },
    { x: -0.74, y: -1.32, r: 0.4 },
    { x: -0.24, y: -1.52, r: 0.4 },
    { x: 0.28, y: -1.52, r: 0.4 },
    { x: 0.76, y: -1.3, r: 0.4 },
    { x: 1.1, y: -0.84, r: 0.38 },
    { x: 1.08, y: -0.3, r: 0.32 },
  ],
};
const CURLY_BACK: HairMass = {
  path: [
    ['M', -1.08, -0.2],
    ['Q', -1.3, -1.56, 0, -1.56],
    ['Q', 1.3, -1.56, 1.08, -0.2],
    ['L', 0.96, 0.5],
    ['Q', 0, 0.74, -0.96, 0.5],
  ],
  lobes: [
    ...(CURLY_FRONT.lobes ?? []),
    { x: -0.98, y: 0.3, r: 0.32 },
    { x: -0.5, y: 0.56, r: 0.32 },
    { x: 0, y: 0.62, r: 0.32 },
    { x: 0.5, y: 0.56, r: 0.32 },
    { x: 0.98, y: 0.3, r: 0.32 },
  ],
};
const CURLY_PROFILE: HairMass = {
  path: [
    ['M', 0.86, -0.8],
    ['Q', 1.0, -1.58, 0, -1.58],
    ['Q', -1.42, -1.5, -1.26, -0.1],
    ['L', -1.04, 0.5],
    ['Q', -0.56, 0.3, -0.4, -0.38],
    ['Q', 0.2, -0.56, 0.86, -0.8],
  ],
  lobes: [
    { x: 0.72, y: -1.14, r: 0.36 },
    { x: 0.24, y: -1.5, r: 0.4 },
    { x: -0.34, y: -1.52, r: 0.4 },
    { x: -0.9, y: -1.24, r: 0.4 },
    { x: -1.24, y: -0.66, r: 0.38 },
    { x: -1.22, y: -0.04, r: 0.36 },
    { x: -1.0, y: 0.42, r: 0.3 },
  ],
};

/** An older man's horseshoe: bare crown, hair left over the ears and round the back. */
const RECEDING_FRONT: readonly HairMass[] = [-1, 1].map((side) => ({
  path: [
    ['M', side * 1.04, -0.6],
    ['Q', side * 1.14, -0.14, side * 1.02, 0.12],
    ['L', side * 0.88, 0.04],
    ['Q', side * 0.9, -0.3, side * 0.82, -0.62],
  ],
}));
const RECEDING_BACK: HairMass = {
  path: [
    ['M', -1.05, -0.5],
    ['Q', 0, -0.18, 1.05, -0.5],
    ['L', 0.86, 0.46],
    ['Q', 0, 0.64, -0.86, 0.46],
  ],
};
const RECEDING_PROFILE: HairMass = {
  path: [
    ['M', -0.2, -0.66],
    ['Q', -0.96, -0.9, -1.12, -0.32],
    ['L', -0.96, 0.42],
    ['Q', -0.52, 0.18, -0.38, -0.36],
    ['Q', -0.1, -0.46, 0.28, -0.44],
    ['L', 0.26, -0.6],
  ],
};

const STYLE_MASSES: Readonly<Record<Exclude<HairStyleKind, 'bald'>, ViewMasses>> = {
  sidePart: { front: [SIDE_PART_FRONT], profile: [CAP_PROFILE], back: [CAP_BACK] },
  long: {
    front: [...LONG_CURTAINS_FRONT, CENTRE_PART_FRONT],
    profile: [LONG_PROFILE],
    back: [LONG_BACK],
  },
  bun: {
    front: [{ path: CENTRE_PART_FRONT.path, lobes: [BUN_FRONT] }],
    profile: [{ path: CAP_PROFILE.path, lobes: [BUN_PROFILE] }],
    back: [{ path: CAP_BACK.path, lobes: [BUN_BACK] }],
  },
  ponytail: {
    front: [CENTRE_PART_FRONT],
    profile: [PONYTAIL_PROFILE, CAP_PROFILE],
    back: [PONYTAIL_BACK, CAP_BACK],
  },
  curly: { front: [CURLY_FRONT], profile: [CURLY_PROFILE], back: [CURLY_BACK] },
  receding: { front: RECEDING_FRONT, profile: [RECEDING_PROFILE], back: [RECEDING_BACK] },
};

// ── Facial hair ──────────────────────────────────────────────────────────────

/** A moustache over the upper lip, its ends drooping to the mouth's corners. */
const MOUSTACHE_FRONT: HairMass = {
  path: [
    ['M', -0.4, 0.5],
    ['Q', 0, 0.36, 0.4, 0.5],
    ['L', 0.42, 0.62],
    ['Q', 0, 0.5, -0.42, 0.62],
  ],
};
const MOUSTACHE_PROFILE: HairMass = {
  path: [
    ['M', 0.74, 0.42],
    ['L', 1.04, 0.4],
    ['L', 1.04, 0.54],
    ['L', 0.8, 0.58],
  ],
};

/** A full beard along the jaw to below the chin, open round the mouth so speech still shows. */
const BEARD_FRONT: HairMass = {
  path: [
    ['M', -0.98, -0.08],
    ['Q', -1.0, 0.6, -0.78, 1.0],
    ['Q', -0.44, 1.46, 0, 1.48],
    ['Q', 0.44, 1.46, 0.78, 1.0],
    ['Q', 1.0, 0.6, 0.98, -0.08],
    ['L', 0.78, 0.26],
    ['Q', 0.52, 0.42, 0.4, 0.62],
    ['L', 0.34, 0.78],
    ['Q', 0, 0.84, -0.34, 0.78],
    ['L', -0.4, 0.62],
    ['Q', -0.52, 0.42, -0.78, 0.26],
  ],
};
const BEARD_PROFILE: HairMass = {
  path: [
    ['M', -0.04, -0.22],
    ['L', -0.12, 0.44],
    ['Q', -0.06, 1.22, 0.58, 1.38],
    ['Q', 1.1, 1.46, 1.06, 0.8],
    ['L', 0.8, 0.76],
    ['Q', 0.58, 0.7, 0.54, 0.5],
    ['Q', 0.4, 0.3, 0.18, 0.14],
    ['L', 0.14, -0.22],
  ],
};

/** A pointed tuft on the chin. */
const GOATEE_FRONT: HairMass = {
  path: [
    ['M', -0.3, 0.8],
    ['Q', 0, 0.74, 0.3, 0.8],
    ['Q', 0.3, 1.3, 0, 1.42],
    ['Q', -0.3, 1.3, -0.3, 0.8],
  ],
};
const GOATEE_PROFILE: HairMass = {
  path: [
    ['M', 0.72, 0.8],
    ['L', 1.0, 0.8],
    ['Q', 1.1, 1.18, 0.9, 1.34],
    ['Q', 0.74, 1.2, 0.72, 0.8],
  ],
};

const FACIAL_MASSES: Readonly<Record<Exclude<FacialHairKind, 'none'>, Omit<ViewMasses, 'back'>>> = {
  fullBeard: {
    front: [BEARD_FRONT, MOUSTACHE_FRONT],
    profile: [BEARD_PROFILE, MOUSTACHE_PROFILE],
  },
  moustache: { front: [MOUSTACHE_FRONT], profile: [MOUSTACHE_PROFILE] },
  goatee: { front: [GOATEE_FRONT, MOUSTACHE_FRONT], profile: [GOATEE_PROFILE, MOUSTACHE_PROFILE] },
};

// ── Painting ─────────────────────────────────────────────────────────────────

/** Hair takes the ramp a step darker than its swatch, the way Dave's crop does. */
function hairTone(hair: Ramp): Ramp {
  return {
    deep: hair.deep,
    shadow: hair.deep,
    dark: hair.shadow,
    mid: hair.dark,
    base: hair.mid,
    light: hair.base,
    rim: hair.light,
  };
}

/**
 * Where hair meets skin inside the silhouette there is no outline to part
 * them, so each mass carries a soft dark edge of its own.
 */
const EDGE_WIDTH = 0.012;
const EDGE_ALPHA = 0.7;
/** The shade runs across the mass about as wide as the head. */
const SHADE_HALF_WIDTH_SHARE = 1.1;
const STRAND_WIDTH = 0.014;
const STRAND_OPACITY = 0.8;

export interface Units {
  readonly x: number;
  readonly y: number;
}

/** Head-local units in a view: x a fraction of the head's half-width head-on and of its depth edge-on, y of its half-height. */
export function headUnits(profile: boolean): Units {
  return { x: profile ? HEAD_DEPTH : HEAD_RX, y: HEAD_RY };
}

/** Signed area under the y-down convention: positive is clockwise on screen. */
function signedArea(points: readonly Pt[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function endPoints(path: readonly PathCommand[], units: Units): Pt[] {
  return path.map((command) =>
    command[0] === 'Q'
      ? { x: command[3] * units.x, y: command[4] * units.y }
      : { x: command[1] * units.x, y: command[2] * units.y },
  );
}

/**
 * Traces a mass as one path. Every lobe is wound the way the outline runs,
 * so the nonzero fill and clip take their union rather than cutting holes
 * where they overlap.
 */
function traceMass(ctx: Ctx, mass: HairMass, units: Units): void {
  ctx.beginPath();
  for (const command of mass.path) {
    if (command[0] === 'M') ctx.moveTo(command[1] * units.x, command[2] * units.y);
    else if (command[0] === 'L') ctx.lineTo(command[1] * units.x, command[2] * units.y);
    else {
      ctx.quadraticCurveTo(
        command[1] * units.x,
        command[2] * units.y,
        command[3] * units.x,
        command[4] * units.y,
      );
    }
  }
  ctx.closePath();
  const anticlockwise = signedArea(endPoints(mass.path, units)) < 0;
  for (const lobe of mass.lobes ?? []) {
    const cx = lobe.x * units.x;
    const cy = lobe.y * units.y;
    const r = lobe.r * HEAD_RX;
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, anticlockwise);
    ctx.closePath();
  }
}

function massBounds(mass: HairMass, units: Units): { top: number; bottom: number } {
  const ys = [
    ...endPoints(mass.path, units).map((p) => p.y),
    ...(mass.lobes ?? []).flatMap((lobe) => [
      lobe.y * units.y - lobe.r * HEAD_RX,
      lobe.y * units.y + lobe.r * HEAD_RX,
    ]),
  ];
  return { top: Math.min(...ys), bottom: Math.max(...ys) };
}

/**
 * Paints one mass of hair, shaded down its own height, combed and edged, in
 * head-local `units`.
 *
 * @param edge how strongly the mass's own outline is drawn: a head of hair or
 *   a full beard has an edge where it stands off the skin; stubble has none,
 *   and an inked edge round it draws a mask on the face.
 */
export function paintHairMass(
  ctx: Ctx,
  mass: HairMass,
  units: Units,
  ramp: Ramp,
  edge: number = EDGE_ALPHA,
): void {
  const { top, bottom } = massBounds(mass, units);
  const trace = (): void => traceMass(ctx, mass, units);
  shadeForm(ctx, trace, { from: { x: 0, y: top }, to: { x: 0, y: bottom } }, ramp, {
    halfWidth: HEAD_RX * SHADE_HALF_WIDTH_SHARE,
  });
  const strands = mass.strands ?? [];
  if (strands.length > 0) {
    withClip(ctx, trace, () =>
      crease(
        ctx,
        () => {
          for (const [fromX, fromY, controlX, controlY, toX, toY] of strands) {
            ctx.moveTo(fromX * units.x, fromY * units.y);
            ctx.quadraticCurveTo(
              controlX * units.x,
              controlY * units.y,
              toX * units.x,
              toY * units.y,
            );
          }
        },
        STRAND_WIDTH,
        ramp,
        STRAND_OPACITY,
      ),
    );
  }
  if (edge <= 0) return;
  trace();
  ctx.strokeStyle = rgba(ramp.deep, edge);
  ctx.lineWidth = EDGE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function viewMasses(masses: ViewMasses, view: ViewSpec): readonly HairMass[] {
  if (view.showsBack) return masses.back;
  return view.profile ? masses.profile : masses.front;
}

/**
 * Head-on a pitched head squashes its hair about a pivot over the crown and
 * rides up the neck: the same transform the rig paints its own crop under.
 */
function applyHairPitch(ctx: Ctx, lift: number): void {
  const offsetY = pitchedHairY(0, lift);
  const scaleY = pitchedHairY(1, lift) - offsetY;
  ctx.translate(0, offsetY);
  ctx.scale(1, scaleY);
}

/** Paints `spec`'s hair and facial hair onto the head the skeleton solved, in its own frame. */
export function paintCastHead(
  ctx: Ctx,
  skeleton: Skeleton,
  view: ViewSpec,
  pose: BipedPose,
  spec: CastHeadSpec,
): void {
  const units = headUnits(view.profile);
  ctx.save();
  ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
  ctx.rotate(headAngle(pose));
  if (!view.profile && !view.showsBack) applyHairPitch(ctx, pose.chinLift ?? 0);
  if (!view.showsBack && spec.facialHair !== 'none') {
    const tone = hairTone(spec.hair);
    for (const mass of viewMasses({ ...FACIAL_MASSES[spec.facialHair], back: [] }, view)) {
      paintHairMass(ctx, mass, units, tone);
    }
  }
  if (spec.hairStyle !== 'bald') {
    const ramp = hairTone(spec.hair);
    for (const mass of viewMasses(STYLE_MASSES[spec.hairStyle], view)) {
      paintHairMass(ctx, mass, units, ramp);
    }
  }
  ctx.restore();
}

/** How far a cast head's hair can reach past the head centre, in head-local units. */
const REACH_ACROSS = 1.7;
const REACH_ABOVE = 1.9;
const REACH_BELOW = 2.4;

/** The extreme points a cast head's hair can reach, for sizing the composing surface. */
export function castHeadReach(skeleton: Skeleton): readonly Pt[] {
  const centre = skeleton.headCentre;
  const across = HEAD_RX * REACH_ACROSS;
  return [
    { x: centre.x - across, y: centre.y - HEAD_RY * REACH_ABOVE },
    { x: centre.x + across, y: centre.y - HEAD_RY * REACH_ABOVE },
    { x: centre.x - across, y: centre.y + HEAD_RY * REACH_BELOW },
    { x: centre.x + across, y: centre.y + HEAD_RY * REACH_BELOW },
  ];
}
