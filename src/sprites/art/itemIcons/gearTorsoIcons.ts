/**
 * Icons for torso gear: shirts, jackets, coats, capes and the cat's harnesses.
 *
 * Each piece is laid flat, front on, and given a silhouette of its own so two
 * pieces never read as the same garment in a different colour: the hoodie has
 * its hood and pocket, the duster its long flared skirt, the apron its bib
 * and ties, the tailcoat its tails, the vest no sleeves, the quilted vest a
 * boxy padded cut, the mantle a short bell of cape, and the harnesses are
 * straps and rings rather than cloth.
 */

import type { Rect } from '../../../ui/core/geom';
import {
  bandedFill,
  BOLD_DETAIL,
  disc,
  FULL_TURN,
  glint,
  hairlineWidth,
  ICON_OUTLINE,
  litFill,
  MEDIUM_DETAIL,
  outlineWidth,
  paintForm,
  paintIconArt,
  rivet,
  strokeDetail,
  tone,
  tracePoints,
  tracePolyline,
  withShapeClip,
  type IconArtPainter,
  type IconPoint,
} from './iconPaint';

export type GearTorsoIconId =
  | 'lucky_hoodie'
  | 'patched_duster'
  | 'demolition_apron'
  | 'velvet_harness'
  | 'plumed_coat'
  | 'prowler_mantle'
  | 'hearthguard_quilted_vest'
  | 'scrapmail_vest'
  | 'sequin_tailcoat';

type Shape = readonly IconPoint[];
type Point = readonly [number, number];

const LIGHT_FROM: Point = [0.15, 0.1];
const LIGHT_TO: Point = [0.85, 0.9];

/** How far a seam, fold or hem line sits below the cloth it is drawn on. */
const SEAM_SHADE = -0.45;
/** Every other one, for rows that stagger and feathers that lean to alternate sides. */
const ALTERNATE = 2;
/** A trim band (cuff, hem rib, collar) is a step darker than the body. */
const TRIM_SHADE = -0.22;
/** A strap's outline shows on both of its edges. */
const OUTLINE_SIDES = 2;

function paintCloth(ctx: CanvasRenderingContext2D, px: number, shape: Shape, base: string): void {
  paintForm(ctx, px, () => tracePoints(ctx, shape), litFill(ctx, base, LIGHT_FROM, LIGHT_TO));
}

/** A trim band painted inside `clip`, so it never pokes past the garment's outline. */
function paintTrim(ctx: CanvasRenderingContext2D, clip: Shape, band: Shape, color: string): void {
  withShapeClip(
    ctx,
    () => tracePoints(ctx, clip),
    () => {
      tracePoints(ctx, band);
      ctx.fillStyle = color;
      ctx.fill();
    },
  );
}

/** A thick strap along an open path: outline, then the strap's shaded fill, then a lit edge. */
function paintStrap(
  ctx: CanvasRenderingContext2D,
  px: number,
  trace: () => void,
  base: string,
  width: number,
): void {
  trace();
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = width + outlineWidth(px) * OUTLINE_SIDES;
  ctx.stroke();
  ctx.strokeStyle = litFill(ctx, base, LIGHT_FROM, LIGHT_TO);
  ctx.lineWidth = width;
  ctx.stroke();
}

function ellipsePath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): () => void {
  return () => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, FULL_TURN);
  };
}

/** A metal ring (a D-ring or a washer): an outlined annulus lit from the top-left. */
function paintRing(
  ctx: CanvasRenderingContext2D,
  px: number,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  base: string,
): void {
  paintForm(
    ctx,
    px,
    () => {
      ctx.beginPath();
      ctx.arc(cx, cy, outer, 0, FULL_TURN);
      ctx.arc(cx, cy, inner, FULL_TURN, 0, true);
    },
    litFill(ctx, base, [cx - outer, cy - outer], [cx + outer, cy + outer]),
  );
}

// ── Lucky Hoodie ────────────────────────────────────────────────────────────

const HOODIE_RED = '#b0574c';
const HOODIE_STRING = '#efe2c8';
const HOODIE_HOOD: Shape = [
  [0.3, 0.34],
  [0.31, 0.08, 0.12],
  [0.69, 0.08, 0.12],
  [0.7, 0.34],
];
const HOODIE_HOOD_OPENING: Shape = [
  [0.38, 0.3],
  [0.39, 0.15, 0.08],
  [0.61, 0.15, 0.08],
  [0.62, 0.3],
];
const HOODIE_BODY: Shape = [
  [0.4, 0.27],
  [0.5, 0.33],
  [0.6, 0.27],
  [0.78, 0.29, 0.05],
  [0.95, 0.72, 0.02],
  [0.82, 0.78, 0.02],
  [0.71, 0.5],
  [0.72, 0.9, 0.03],
  [0.28, 0.9, 0.03],
  [0.29, 0.5],
  [0.18, 0.78, 0.02],
  [0.05, 0.72, 0.02],
  [0.22, 0.29, 0.05],
];
const HOODIE_HEM_RIB: Shape = [
  [0, 0.82],
  [1, 0.82],
  [1, 1],
  [0, 1],
];
const HOODIE_LEFT_CUFF: Shape = [
  [0.0, 0.66],
  [0.2, 0.71],
  [0.2, 0.85],
  [0.0, 0.8],
];
const HOODIE_RIGHT_CUFF: Shape = [
  [1.0, 0.66],
  [0.8, 0.71],
  [0.8, 0.85],
  [1.0, 0.8],
];
const HOODIE_POCKET: Shape = [
  [0.37, 0.6, 0.02],
  [0.63, 0.6, 0.02],
  [0.68, 0.78, 0.02],
  [0.32, 0.78, 0.02],
];
const HOODIE_LEFT_ARM_SEAM: Shape = [
  [0.29, 0.5],
  [0.3, 0.33],
];
const HOODIE_RIGHT_ARM_SEAM: Shape = [
  [0.71, 0.5],
  [0.7, 0.33],
];
/** The left drawstring hangs full length; the right one was chewed flat and is shorter. */
const HOODIE_LEFT_STRING: Shape = [
  [0.45, 0.32],
  [0.44, 0.5],
];
const HOODIE_RIGHT_STRING: Shape = [
  [0.55, 0.32],
  [0.56, 0.43],
];
const HOODIE_AGLET_R = 0.022;
const HOODIE_HOOD_DEPTH = -0.6;
const HOODIE_POCKET_SHADE = -0.11;

const paintHoodie: IconArtPainter = (ctx, px) => {
  paintCloth(ctx, px, HOODIE_HOOD, HOODIE_RED);
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, HOODIE_HOOD_OPENING),
    tone(HOODIE_RED, HOODIE_HOOD_DEPTH),
  );
  paintCloth(ctx, px, HOODIE_BODY, HOODIE_RED);
  const trim = tone(HOODIE_RED, TRIM_SHADE);
  paintTrim(ctx, HOODIE_BODY, HOODIE_HEM_RIB, trim);
  paintTrim(ctx, HOODIE_BODY, HOODIE_LEFT_CUFF, trim);
  paintTrim(ctx, HOODIE_BODY, HOODIE_RIGHT_CUFF, trim);
  const seam = tone(HOODIE_RED, SEAM_SHADE);
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, HOODIE_POCKET),
    tone(HOODIE_RED, HOODIE_POCKET_SHADE),
    seam,
  );
  strokeDetail(ctx, px, HOODIE_LEFT_ARM_SEAM, seam, MEDIUM_DETAIL);
  strokeDetail(ctx, px, HOODIE_RIGHT_ARM_SEAM, seam, MEDIUM_DETAIL);
  strokeDetail(ctx, px, HOODIE_LEFT_STRING, HOODIE_STRING, BOLD_DETAIL);
  strokeDetail(ctx, px, HOODIE_RIGHT_STRING, HOODIE_STRING, BOLD_DETAIL);
  disc(ctx, HOODIE_LEFT_STRING[1][0], HOODIE_LEFT_STRING[1][1], HOODIE_AGLET_R, HOODIE_STRING);
};

// ── Patched Duster ──────────────────────────────────────────────────────────

const DUSTER_LEATHER = '#6e4a31';
const DUSTER_LINING = '#2a1c14';
/** The left lapel faces the light and the right turns away from it. */
const DUSTER_LIT_LAPEL = 0.12;
const DUSTER_COAT: Shape = [
  [0.4, 0.07],
  [0.6, 0.07],
  [0.77, 0.14, 0.04],
  [0.91, 0.6, 0.02],
  [0.79, 0.64, 0.02],
  [0.69, 0.3],
  [0.67, 0.5],
  [0.88, 0.95, 0.02],
  [0.12, 0.95, 0.02],
  [0.33, 0.5],
  [0.31, 0.3],
  [0.21, 0.64, 0.02],
  [0.09, 0.6, 0.02],
  [0.23, 0.14, 0.04],
];
/** The open front: the coat hangs apart from the collar down, widest at the hem. */
const DUSTER_OPENING: Shape = [
  [0.5, 0.2],
  [0.55, 0.5],
  [0.6, 0.95],
  [0.4, 0.95],
  [0.45, 0.5],
];
const DUSTER_LEFT_LAPEL: Shape = [
  [0.4, 0.07],
  [0.5, 0.2],
  [0.44, 0.42],
  [0.35, 0.22],
];
const DUSTER_RIGHT_LAPEL: Shape = [
  [0.6, 0.07],
  [0.5, 0.2],
  [0.56, 0.42],
  [0.65, 0.22],
];
const DUSTER_LEFT_SLEEVE_SEAM: Shape = [
  [0.31, 0.3],
  [0.25, 0.62],
];
const DUSTER_RIGHT_SLEEVE_SEAM: Shape = [
  [0.69, 0.3],
  [0.75, 0.62],
];

interface Patch {
  readonly shape: Shape;
  readonly leather: string;
}

/** Every patch a different leather: tan, oxblood and near-black. */
const DUSTER_PATCHES: readonly Patch[] = [
  {
    shape: [
      [0.22, 0.7, 0.01],
      [0.34, 0.68, 0.01],
      [0.35, 0.8, 0.01],
      [0.21, 0.82, 0.01],
    ],
    leather: '#b58a55',
  },
  {
    shape: [
      [0.62, 0.58, 0.01],
      [0.72, 0.6, 0.01],
      [0.73, 0.72, 0.01],
      [0.63, 0.71, 0.01],
    ],
    leather: '#8a3a2c',
  },
  {
    shape: [
      [0.13, 0.3, 0.01],
      [0.2, 0.28, 0.01],
      [0.23, 0.42, 0.01],
      [0.15, 0.44, 0.01],
    ],
    leather: '#c29a62',
  },
];
const PATCH_STITCH = '#e8d6b0';
const PATCH_STITCH_DASH = [0.018, 0.018] as const;

const paintDuster: IconArtPainter = (ctx, px) => {
  paintCloth(ctx, px, DUSTER_COAT, DUSTER_LEATHER);
  withShapeClip(
    ctx,
    () => tracePoints(ctx, DUSTER_COAT),
    () => {
      tracePoints(ctx, DUSTER_OPENING);
      ctx.fillStyle = DUSTER_LINING;
      ctx.fill();
    },
  );
  const lapel = tone(DUSTER_LEATHER, TRIM_SHADE);
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, DUSTER_LEFT_LAPEL),
    tone(DUSTER_LEATHER, DUSTER_LIT_LAPEL),
  );
  paintForm(ctx, px, () => tracePoints(ctx, DUSTER_RIGHT_LAPEL), lapel);
  const seam = tone(DUSTER_LEATHER, SEAM_SHADE);
  strokeDetail(ctx, px, DUSTER_LEFT_SLEEVE_SEAM, seam, MEDIUM_DETAIL);
  strokeDetail(ctx, px, DUSTER_RIGHT_SLEEVE_SEAM, seam, MEDIUM_DETAIL);
  for (const patch of DUSTER_PATCHES) {
    paintForm(ctx, px, () => tracePoints(ctx, patch.shape), patch.leather);
    tracePoints(ctx, patch.shape);
    ctx.save();
    ctx.setLineDash([...PATCH_STITCH_DASH]);
    ctx.strokeStyle = PATCH_STITCH;
    ctx.lineWidth = hairlineWidth(px);
    ctx.stroke();
    ctx.restore();
  }
};

// ── Demolition Apron ────────────────────────────────────────────────────────

const APRON_LEATHER = '#a07040';
const APRON_SCORCH = '#2a1a10';
const APRON_STRAP = '#6a4526';
const DYNAMITE_RED = '#c23a2a';
const FUSE_COLOR = '#e8d8a8';
/** A narrow bib over deep armhole curves, then a wide skirt: the cut that says apron, not bag. */
const APRON_BODY: Shape = [
  [0.41, 0.17, 0.02],
  [0.59, 0.17, 0.02],
  [0.61, 0.3],
  [0.67, 0.44, 0.12],
  [0.77, 0.48, 0.02],
  [0.8, 0.98, 0.03],
  [0.2, 0.98, 0.03],
  [0.23, 0.48, 0.02],
  [0.33, 0.44, 0.12],
  [0.39, 0.3],
];
/** A thin neck loop rising from the bib's corners. */
const APRON_NECK_LOOP: Shape = [
  [0.42, 0.18],
  [0.43, 0.02, 0.06],
  [0.57, 0.02, 0.06],
  [0.58, 0.18],
];
const APRON_NECK_WIDTH = 0.02;
/** Ties leave the waist corners and hang loose down the sides. */
const APRON_TIES: readonly Shape[] = [
  [
    [0.23, 0.5],
    [0.15, 0.46],
    [0.09, 0.52],
    [0.02, 0.47],
  ],
  [
    [0.77, 0.5],
    [0.85, 0.46],
    [0.91, 0.52],
    [0.98, 0.47],
  ],
];
const APRON_TIE_WIDTH = 0.024;
/** The band across the bib the stick loops are sewn into. */
const APRON_LOOP_BAND: Shape = [
  [0.38, 0.36],
  [0.62, 0.36],
  [0.62, 0.4],
  [0.38, 0.4],
];
const STICK_XS = [0.44, 0.5, 0.56] as const;
const STICK_TOP = 0.22;
const STICK_BOTTOM = 0.56;
const STICK_HALF_WIDTH = 0.019;
const STICK_CAP_RADIUS = STICK_HALF_WIDTH / 2;
const STICK_FUSE_RISE = 0.06;
const STICK_FUSE_LEAN = 0.03;
const APRON_POCKET: Shape = [
  [0.3, 0.68, 0.02],
  [0.7, 0.68, 0.02],
  [0.71, 0.84, 0.02],
  [0.29, 0.84, 0.02],
];
const APRON_POCKET_DIVIDER: Shape = [
  [0.5, 0.68],
  [0.5, 0.84],
];
const APRON_SCORCHES: readonly Shape[] = [
  [
    [0.22, 0.84],
    [0.32, 0.8],
    [0.38, 0.88],
    [0.34, 0.97],
    [0.2, 0.97],
  ],
  [
    [0.6, 0.88],
    [0.68, 0.83],
    [0.8, 0.86],
    [0.78, 0.97],
    [0.62, 0.97],
  ],
  [
    [0.66, 0.52],
    [0.72, 0.5],
    [0.74, 0.58],
    [0.68, 0.6],
  ],
];
const SCORCH_ALPHA = 0.7;
const APRON_POCKET_SHADE = -0.12;

function openPath(ctx: CanvasRenderingContext2D, points: Shape): () => void {
  return () => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  };
}

function paintDynamiteStick(ctx: CanvasRenderingContext2D, px: number, x: number): void {
  strokeDetail(
    ctx,
    px,
    [
      [x, STICK_TOP],
      [x + STICK_FUSE_LEAN, STICK_TOP - STICK_FUSE_RISE],
    ],
    FUSE_COLOR,
    MEDIUM_DETAIL,
  );
  const left = x - STICK_HALF_WIDTH;
  const right = x + STICK_HALF_WIDTH;
  paintForm(
    ctx,
    px,
    () =>
      tracePoints(ctx, [
        [left, STICK_TOP, STICK_CAP_RADIUS],
        [right, STICK_TOP, STICK_CAP_RADIUS],
        [right, STICK_BOTTOM, STICK_CAP_RADIUS],
        [left, STICK_BOTTOM, STICK_CAP_RADIUS],
      ]),
    litFill(ctx, DYNAMITE_RED, [left, STICK_TOP], [right, STICK_TOP]),
  );
}

const paintApron: IconArtPainter = (ctx, px) => {
  paintStrap(ctx, px, openPath(ctx, APRON_NECK_LOOP), APRON_STRAP, APRON_NECK_WIDTH);
  for (const tie of APRON_TIES)
    paintStrap(ctx, px, openPath(ctx, tie), APRON_STRAP, APRON_TIE_WIDTH);
  paintCloth(ctx, px, APRON_BODY, APRON_LEATHER);
  const seam = tone(APRON_LEATHER, SEAM_SHADE);
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, APRON_POCKET),
    tone(APRON_LEATHER, APRON_POCKET_SHADE),
    seam,
  );
  strokeDetail(ctx, px, APRON_POCKET_DIVIDER, seam, MEDIUM_DETAIL);
  withShapeClip(
    ctx,
    () => tracePoints(ctx, APRON_BODY),
    () => {
      ctx.save();
      ctx.globalAlpha *= SCORCH_ALPHA;
      for (const scorch of APRON_SCORCHES) {
        tracePoints(ctx, scorch);
        ctx.fillStyle = APRON_SCORCH;
        ctx.fill();
      }
      ctx.restore();
    },
  );
  for (const x of STICK_XS) paintDynamiteStick(ctx, px, x);
  paintForm(ctx, px, () => tracePoints(ctx, APRON_LOOP_BAND), tone(APRON_LEATHER, TRIM_SHADE));
};

// ── Cat harnesses, worn on a dress form ─────────────────────────────────────

/**
 * Straps on their own read as abstract rings, so both harnesses are shown on
 * the same faceless cat torso, seen from her left side with her chest to the
 * left: each band crosses the body and runs a touch past its outline, which
 * only reads as wrapping round because the body is there.
 */
const FORM_GREY = '#7d8594';
const CAT_FORM: Shape = [
  [0.14, 0.11, 0.04],
  [0.28, 0.13, 0.04],
  [0.42, 0.31, 0.1],
  [0.7, 0.32, 0.12],
  [0.92, 0.38, 0.12],
  [0.95, 0.6, 0.1],
  [0.8, 0.7, 0.08],
  [0.62, 0.66, 0.1],
  [0.36, 0.8, 0.12],
  [0.18, 0.74, 0.1],
  [0.08, 0.4, 0.06],
];
/** The form is backdrop, so it is shaded softer than the gear on it. */
const FORM_HIGHLIGHT = 0.18;
const FORM_SHADE = -0.22;
const FORM_HIGHLIGHT_UNTIL = 0.35;
const FORM_MID_UNTIL = 0.7;
const FORM_LIGHT_FROM: Point = [0.5, 0.2];
const FORM_LIGHT_TO: Point = [0.5, 0.8];

const BRASS = '#c99a3e';

interface HarnessLayout {
  /** Round the neck, from the nape over to the throat. */
  readonly neck: Shape;
  /** Behind the forelegs, from the shoulders down under the chest. */
  readonly chest: Shape;
  /** Round the waist, from the back down under the belly. */
  readonly belly: Shape;
  /** Along the top of the back, joining the three bands. */
  readonly back: Shape;
}

const HARNESS_LAYOUT: HarnessLayout = {
  neck: [
    [0.29, 0.15],
    [0.19, 0.26],
    [0.06, 0.33],
  ],
  chest: [
    [0.39, 0.25],
    [0.36, 0.55],
    [0.32, 0.85],
  ],
  belly: [
    [0.7, 0.28],
    [0.72, 0.5],
    [0.69, 0.73],
  ],
  back: [
    [0.29, 0.16],
    [0.39, 0.28],
    [0.55, 0.31],
    [0.7, 0.31],
  ],
};
const NECK_JUNCTION: Point = [0.29, 0.16];
const CHEST_JUNCTION: Point = [0.39, 0.28];
const BELLY_JUNCTION: Point = [0.7, 0.31];
const LEASH_RING: Point = [0.54, 0.26];
const JUNCTION_RING_OUTER_R = 0.05;
const JUNCTION_RING_INNER_R = 0.024;
const LEASH_RING_OUTER_R = 0.06;
const LEASH_RING_INNER_R = 0.032;

function paintCatForm(ctx: CanvasRenderingContext2D, px: number): void {
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, CAT_FORM),
    bandedFill(ctx, FORM_LIGHT_FROM, FORM_LIGHT_TO, [
      [tone(FORM_GREY, FORM_HIGHLIGHT), FORM_HIGHLIGHT_UNTIL],
      [FORM_GREY, FORM_MID_UNTIL],
      [tone(FORM_GREY, FORM_SHADE), 1],
    ]),
  );
}

interface HarnessStyle {
  readonly leather: string;
  readonly width: number;
  readonly sheen: string | null;
}

/** Bands first, then the back strap over their tops, then the rings at each junction. */
function paintHarnessOnForm(ctx: CanvasRenderingContext2D, px: number, style: HarnessStyle): void {
  const { neck, chest, belly, back } = HARNESS_LAYOUT;
  const straps = [neck, chest, belly, back];
  for (const strap of straps) {
    paintStrap(ctx, px, openPath(ctx, strap), style.leather, style.width);
  }
  if (style.sheen !== null) {
    for (const strap of straps) {
      const sheen: Shape = strap.map(([x, y]) => [x - STRAP_SHEEN_OFFSET, y]);
      strokeDetail(ctx, px, sheen, style.sheen);
    }
  }
  for (const [x, y] of [NECK_JUNCTION, CHEST_JUNCTION, BELLY_JUNCTION]) {
    paintRing(ctx, px, x, y, JUNCTION_RING_OUTER_R, JUNCTION_RING_INNER_R, BRASS);
  }
}

/** The lit edge velvet pile catches, a hair toward the light from each strap's centre. */
const STRAP_SHEEN_OFFSET = 0.01;

// ── Velvet Harness (cat) ────────────────────────────────────────────────────

const VELVET_STYLE: HarnessStyle = {
  leather: '#7a3368',
  width: 0.062,
  sheen: '#c27ab0',
};

const paintVelvetHarness: IconArtPainter = (ctx, px) => {
  paintCatForm(ctx, px);
  paintHarnessOnForm(ctx, px, VELVET_STYLE);
  paintRing(ctx, px, LEASH_RING[0], LEASH_RING[1], LEASH_RING_OUTER_R, LEASH_RING_INNER_R, BRASS);
};

// ── Plumed Coat (cat) ────────────────────────────────────────────────────

/**
 * A light coat over the same cat form the harnesses are shown on: green
 * suede from her chest back over her flank, bound in tan, the copper crest
 * standing along her spine. The coat filling the body, not bands across it, is
 * what parts it from the Velvet Harness.
 */
const PLUMED_SUEDE = '#2f7a5a';
const PLUMED_BINDING = '#d9b680';
/** The coat's panel, from a collar line below her neck to a hem curving up over her flank; clipped to the form. */
const PLUMED_PANEL: Shape = [
  [0.3, 0],
  [0.8, 0],
  [0.84, 0.4, 0.08],
  [0.76, 1],
  [0.06, 1],
];
const PLUMED_BINDING_WIDTH = 0.045;
const PLUMED_HEM: Shape = [
  [0.8, 0.26],
  [0.84, 0.44],
  [0.77, 0.7],
];
const FEATHER_COPPER = '#d2621f';
const FEATHER_COPPER_DEEP = '#9c4a26';
const FEATHER_RACHIS = '#f0c08a';

interface CrestFeather {
  readonly root: Point;
  /** Lean back toward the tail, in radians off straight up. */
  readonly lean: number;
  readonly length: number;
  readonly color: string;
}

/** Standing along the top of the back, tallest and most swept toward the tail; painted tail first. */
const CREST: readonly CrestFeather[] = [
  { root: [0.66, 0.3], lean: 0.75, length: 0.25, color: FEATHER_COPPER_DEEP },
  { root: [0.59, 0.29], lean: 0.6, length: 0.26, color: FEATHER_COPPER },
  { root: [0.52, 0.29], lean: 0.45, length: 0.25, color: FEATHER_COPPER_DEEP },
  { root: [0.45, 0.28], lean: 0.32, length: 0.22, color: FEATHER_COPPER },
  { root: [0.39, 0.26], lean: 0.2, length: 0.18, color: FEATHER_COPPER_DEEP },
];
const FEATHER_HALF_WIDTH = 0.04;
/** The widest point of a vane, as a share of the way from root to tip. */
const FEATHER_BELLY = 0.55;
/** Each feather's tip curls further back than its root, the sickle of a tail feather. */
const FEATHER_CURL = 0.3;

function featherShape(f: CrestFeather): { shape: Shape; tip: Point } {
  const [rx, ry] = f.root;
  const belly = f.length * FEATHER_BELLY;
  const bx = rx + Math.sin(f.lean) * belly;
  const by = ry - Math.cos(f.lean) * belly;
  const tipAngle = f.lean + FEATHER_CURL;
  const rest = f.length - belly;
  const tip: Point = [bx + Math.sin(tipAngle) * rest, by - Math.cos(tipAngle) * rest];
  const nx = Math.cos(f.lean) * FEATHER_HALF_WIDTH;
  const ny = Math.sin(f.lean) * FEATHER_HALF_WIDTH;
  return { tip, shape: [f.root, [bx - nx, by - ny], tip, [bx + nx, by + ny]] };
}

const paintPlumedCoat: IconArtPainter = (ctx, px) => {
  paintCatForm(ctx, px);
  withShapeClip(
    ctx,
    () => tracePoints(ctx, CAT_FORM),
    () => {
      paintForm(
        ctx,
        px,
        () => tracePoints(ctx, PLUMED_PANEL),
        litFill(ctx, PLUMED_SUEDE, LIGHT_FROM, LIGHT_TO),
      );
      paintStrap(ctx, px, openPath(ctx, PLUMED_HEM), PLUMED_BINDING, PLUMED_BINDING_WIDTH);
    },
  );
  for (const f of CREST) {
    const { shape, tip } = featherShape(f);
    paintForm(ctx, px, () => tracePoints(ctx, shape), litFill(ctx, f.color, LIGHT_FROM, LIGHT_TO));
    strokeDetail(ctx, px, [f.root, tip], FEATHER_RACHIS);
  }
};

// ── Prowler Mantle (cat) ────────────────────────────────────────────────────

/** Charcoal lifted a touch off true charcoal so the cape holds its shape on a dark slot. */
const PROWLER_CHARCOAL = '#535763';
const PROWLER_SILVER = '#d6dbe2';
const MANTLE_LINING = '#1e2026';
/** Round shoulders under a high collar, swirled to one side the way a cape lies mid-turn. */
const MANTLE_CAPE: Shape = [
  [0.4, 0.2],
  [0.6, 0.2],
  [0.86, 0.36, 0.16],
  [0.9, 0.86, 0.03],
  [0.72, 0.79],
  [0.52, 0.88],
  [0.33, 0.8],
  [0.14, 0.86, 0.03],
  [0.14, 0.38, 0.16],
];
const MANTLE_COLLAR = { cx: 0.5, cy: 0.21, rx: 0.17, ry: 0.09 } as const;
const MANTLE_NECK = { cx: 0.5, cy: 0.19, rx: 0.1, ry: 0.045 } as const;
const MANTLE_COLLAR_LIFT = 0.12;
const MANTLE_FOLDS: readonly Shape[] = [
  [
    [0.36, 0.34],
    [0.3, 0.76],
  ],
  [
    [0.64, 0.34],
    [0.73, 0.74],
  ],
  [
    [0.5, 0.32],
    [0.53, 0.84],
  ],
];
const MANTLE_HEM_STITCH: Shape = [
  [0.17, 0.81],
  [0.33, 0.75],
  [0.52, 0.83],
  [0.72, 0.74],
  [0.87, 0.8],
];
const MANTLE_STITCH_DASH = [0.03, 0.022] as const;
const MANTLE_COLLAR_STITCH_INSET = 0.025;
const MANTLE_CLASP: Point = [0.5, 0.3];
const MANTLE_CLASP_R = 0.042;

const paintMantle: IconArtPainter = (ctx, px) => {
  paintCloth(ctx, px, MANTLE_CAPE, PROWLER_CHARCOAL);
  const fold = tone(PROWLER_CHARCOAL, SEAM_SHADE);
  for (const line of MANTLE_FOLDS) strokeDetail(ctx, px, line, fold, BOLD_DETAIL);
  ctx.save();
  ctx.setLineDash([...MANTLE_STITCH_DASH]);
  strokeDetail(ctx, px, MANTLE_HEM_STITCH, PROWLER_SILVER, MEDIUM_DETAIL);
  ctx.restore();
  const collar = MANTLE_COLLAR;
  paintForm(
    ctx,
    px,
    ellipsePath(ctx, collar.cx, collar.cy, collar.rx, collar.ry),
    litFill(
      ctx,
      tone(PROWLER_CHARCOAL, MANTLE_COLLAR_LIFT),
      [collar.cx - collar.rx, collar.cy - collar.ry],
      [collar.cx + collar.rx, collar.cy + collar.ry],
    ),
  );
  ctx.save();
  ctx.setLineDash([...MANTLE_STITCH_DASH]);
  ellipsePath(
    ctx,
    collar.cx,
    collar.cy,
    collar.rx - MANTLE_COLLAR_STITCH_INSET,
    collar.ry - MANTLE_COLLAR_STITCH_INSET,
  )();
  ctx.strokeStyle = PROWLER_SILVER;
  ctx.lineWidth = hairlineWidth(px);
  ctx.stroke();
  ctx.restore();
  const neck = MANTLE_NECK;
  paintForm(ctx, px, ellipsePath(ctx, neck.cx, neck.cy, neck.rx, neck.ry), MANTLE_LINING);
  rivet(ctx, px, MANTLE_CLASP[0], MANTLE_CLASP[1], MANTLE_CLASP_R, PROWLER_SILVER);
};

// ── Hearthguard Quilted Vest ────────────────────────────────────────────────

const QUILT_LINEN = '#cfbb90';
const GARRISON_BROWN = '#7a5636';
const QUILT_COAT: Shape = [
  [0.38, 0.13],
  [0.62, 0.13],
  [0.68, 0.18],
  [0.88, 0.25, 0.06],
  [0.95, 0.52, 0.04],
  [0.76, 0.56, 0.03],
  [0.75, 0.9, 0.05],
  [0.25, 0.9, 0.05],
  [0.24, 0.56, 0.03],
  [0.05, 0.52, 0.04],
  [0.12, 0.25, 0.06],
  [0.32, 0.18],
];
const QUILT_COLLAR: Shape = [
  [0.36, 0.1, 0.03],
  [0.64, 0.1, 0.03],
  [0.62, 0.22, 0.02],
  [0.38, 0.22, 0.02],
];
const QUILT_HEM: Shape = [
  [0, 0.84],
  [1, 0.84],
  [1, 1],
  [0, 1],
];
/**
 * The padding: horizontal channels stitched through, each lit along its top
 * and turning into shade along its bottom, so every row reads as a puffed roll.
 */
const QUILT_FIRST_ROW_Y = 0.16;
const QUILT_ROW_HEIGHT = 0.1;
const QUILT_ROW_HIGHLIGHT_UNTIL = 0.3;
const QUILT_ROW_MID_UNTIL = 0.65;
const QUILT_ROW_HIGHLIGHT = 0.3;
const QUILT_ROW_SHADE = -0.3;
const QUILT_RIDGE_SHADE = -0.55;
const QUILT_FRONT: Shape = [
  [0.5, 0.22],
  [0.5, 0.84],
];

const paintQuiltedVest: IconArtPainter = (ctx, px) => {
  paintCloth(ctx, px, QUILT_COAT, QUILT_LINEN);
  const ridge = tone(QUILT_LINEN, QUILT_RIDGE_SHADE);
  withShapeClip(
    ctx,
    () => tracePoints(ctx, QUILT_COAT),
    () => {
      for (let top = QUILT_FIRST_ROW_Y; top < 1; top += QUILT_ROW_HEIGHT) {
        const bottom = top + QUILT_ROW_HEIGHT;
        ctx.fillStyle = bandedFill(
          ctx,
          [0, top],
          [0, bottom],
          [
            [tone(QUILT_LINEN, QUILT_ROW_HIGHLIGHT), QUILT_ROW_HIGHLIGHT_UNTIL],
            [QUILT_LINEN, QUILT_ROW_MID_UNTIL],
            [tone(QUILT_LINEN, QUILT_ROW_SHADE), 1],
          ],
        );
        ctx.fillRect(0, top, 1, QUILT_ROW_HEIGHT);
        tracePolyline(ctx, [
          [0, bottom],
          [1, bottom],
        ]);
        ctx.strokeStyle = ridge;
        ctx.lineWidth = hairlineWidth(px) * BOLD_DETAIL;
        ctx.stroke();
      }
    },
  );
  paintTrim(ctx, QUILT_COAT, QUILT_HEM, GARRISON_BROWN);
  strokeDetail(ctx, px, QUILT_FRONT, tone(GARRISON_BROWN, TRIM_SHADE), BOLD_DETAIL);
  paintCloth(ctx, px, QUILT_COLLAR, GARRISON_BROWN);
};

// ── Scrapmail Vest ──────────────────────────────────────────────────────────

const WIRE_GREY = '#5f646c';
const BOTTLE_CAP_RED = '#c0392b';
const CAN_LID_SILVER = '#b9bfc6';
const WASHER_BRASS = '#b8923a';
const VEST: Shape = [
  [0.3, 0.1, 0.02],
  [0.42, 0.1, 0.02],
  [0.5, 0.38],
  [0.58, 0.1, 0.02],
  [0.7, 0.1, 0.02],
  [0.72, 0.34, 0.1],
  [0.83, 0.42, 0.03],
  [0.81, 0.9, 0.04],
  [0.19, 0.9, 0.04],
  [0.17, 0.42, 0.03],
  [0.28, 0.34, 0.1],
];
const SCRAP_SPACING = 0.135;
const SCRAP_ROW_SHIFT = SCRAP_SPACING / 2;
const SCRAP_FIRST_X = 0.15;
const SCRAP_FIRST_Y = 0.16;
const SCRAP_LAST = 0.95;
const SCRAP_R = 0.058;
const WASHER_HOLE_SHARE = 0.42;
const SCRAP_KINDS = 3;
/** Steps the kind along a row so no two neighbours, across or down, are the same scrap. */
const SCRAP_COLUMN_STEP = 2;

function paintScrap(
  ctx: CanvasRenderingContext2D,
  px: number,
  x: number,
  y: number,
  kind: number,
): void {
  if (kind === 0) {
    rivet(ctx, px, x, y, SCRAP_R, BOTTLE_CAP_RED);
    return;
  }
  if (kind === 1) {
    rivet(ctx, px, x, y, SCRAP_R, CAN_LID_SILVER);
    return;
  }
  paintRing(ctx, px, x, y, SCRAP_R, SCRAP_R * WASHER_HOLE_SHARE, WASHER_BRASS);
}

const paintScrapmailVest: IconArtPainter = (ctx, px) => {
  paintCloth(ctx, px, VEST, WIRE_GREY);
  withShapeClip(
    ctx,
    () => tracePoints(ctx, VEST),
    () => {
      let row = 0;
      for (let y = SCRAP_FIRST_Y; y < SCRAP_LAST; y += SCRAP_SPACING, row++) {
        const shift = row % ALTERNATE === 0 ? 0 : SCRAP_ROW_SHIFT;
        let column = 0;
        for (let x = SCRAP_FIRST_X + shift; x < SCRAP_LAST; x += SCRAP_SPACING, column++) {
          paintScrap(ctx, px, x, y, (row + column * SCRAP_COLUMN_STEP) % SCRAP_KINDS);
        }
      }
    },
  );
  tracePoints(ctx, VEST);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = outlineWidth(px);
  ctx.stroke();
};

// ── Sequin Tailcoat ─────────────────────────────────────────────────────────

const TAILCOAT_SCARLET = '#a81e2c';
const TAILCOAT_GOLD = '#e0b04a';
const SHIRT_WHITE = '#f2eee6';
const BOW_BLACK = '#1c1a1e';
/** How far each lapel is turned toward or away from the light. */
const LAPEL_TURN = 0.15;
/** The front is cut away at the waist; only the tails, hung behind, reach down. */
const TAILCOAT: Shape = [
  [0.4, 0.1],
  [0.6, 0.1],
  [0.78, 0.17, 0.04],
  [0.93, 0.6, 0.02],
  [0.81, 0.64, 0.02],
  [0.7, 0.32],
  [0.71, 0.6],
  [0.5, 0.52],
  [0.29, 0.6],
  [0.3, 0.32],
  [0.19, 0.64, 0.02],
  [0.07, 0.6, 0.02],
  [0.22, 0.17, 0.04],
];
const TAILCOAT_TAILS: readonly Shape[] = [
  [
    [0.3, 0.5],
    [0.49, 0.54],
    [0.44, 0.76],
    [0.37, 0.97],
    [0.28, 0.76],
  ],
  [
    [0.7, 0.5],
    [0.51, 0.54],
    [0.56, 0.76],
    [0.63, 0.97],
    [0.72, 0.76],
  ],
];
/** The tails hang behind the coat, so they sit a step into shadow. */
const TAILCOAT_TAIL_SHADE = -0.3;
const TAILCOAT_SHIRT: Shape = [
  [0.42, 0.1],
  [0.58, 0.1],
  [0.5, 0.5],
];
const TAILCOAT_LEFT_LAPEL: Shape = [
  [0.4, 0.1],
  [0.46, 0.1],
  [0.5, 0.5],
  [0.34, 0.3],
];
const TAILCOAT_RIGHT_LAPEL: Shape = [
  [0.6, 0.1],
  [0.54, 0.1],
  [0.5, 0.5],
  [0.66, 0.3],
];
const BOW_TIE: Shape = [
  [0.43, 0.12],
  [0.5, 0.16],
  [0.57, 0.12],
  [0.57, 0.22],
  [0.5, 0.18],
  [0.43, 0.22],
];
const TAILCOAT_SLEEVE_SEAMS: readonly Shape[] = [
  [
    [0.3, 0.32],
    [0.25, 0.6],
  ],
  [
    [0.7, 0.32],
    [0.75, 0.6],
  ],
];
const TAILCOAT_GOLD_CUFFS: readonly Shape[] = [
  [
    [0.0, 0.54],
    [0.24, 0.58],
    [0.24, 0.7],
    [0.0, 0.66],
  ],
  [
    [1.0, 0.54],
    [0.76, 0.58],
    [0.76, 0.7],
    [1.0, 0.66],
  ],
];
/** Where the sequins catch the light: a scatter of glints across the coat. */
const SEQUIN_GLINTS: readonly Point[] = [
  [0.26, 0.24],
  [0.82, 0.36],
  [0.36, 0.78],
  [0.66, 0.84],
  [0.62, 0.44],
  [0.15, 0.5],
];
const SEQUIN_DOTS: readonly Point[] = [
  [0.38, 0.4],
  [0.7, 0.22],
  [0.4, 0.66],
  [0.6, 0.7],
  [0.24, 0.4],
  [0.86, 0.52],
  [0.6, 0.86],
];
const SEQUIN_GLINT_R = 0.05;
const SEQUIN_DOT_R = 0.016;

const paintTailcoat: IconArtPainter = (ctx, px) => {
  for (const tail of TAILCOAT_TAILS) {
    paintCloth(ctx, px, tail, tone(TAILCOAT_SCARLET, TAILCOAT_TAIL_SHADE));
  }
  paintCloth(ctx, px, TAILCOAT, TAILCOAT_SCARLET);
  for (const cuff of TAILCOAT_GOLD_CUFFS) paintTrim(ctx, TAILCOAT, cuff, TAILCOAT_GOLD);
  const seam = tone(TAILCOAT_SCARLET, SEAM_SHADE);
  for (const line of TAILCOAT_SLEEVE_SEAMS) strokeDetail(ctx, px, line, seam, MEDIUM_DETAIL);
  paintForm(ctx, px, () => tracePoints(ctx, TAILCOAT_SHIRT), SHIRT_WHITE);
  paintForm(ctx, px, () => tracePoints(ctx, TAILCOAT_LEFT_LAPEL), tone(TAILCOAT_GOLD, LAPEL_TURN));
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, TAILCOAT_RIGHT_LAPEL),
    tone(TAILCOAT_GOLD, -LAPEL_TURN),
  );
  paintForm(ctx, px, () => tracePoints(ctx, BOW_TIE), BOW_BLACK);
  for (const [x, y] of SEQUIN_DOTS) disc(ctx, x, y, SEQUIN_DOT_R, TAILCOAT_GOLD);
  for (const [x, y] of SEQUIN_GLINTS) glint(ctx, x, y, SEQUIN_GLINT_R);
};

const PAINTERS: Readonly<Record<GearTorsoIconId, IconArtPainter>> = {
  lucky_hoodie: paintHoodie,
  patched_duster: paintDuster,
  demolition_apron: paintApron,
  velvet_harness: paintVelvetHarness,
  plumed_coat: paintPlumedCoat,
  prowler_mantle: paintMantle,
  hearthguard_quilted_vest: paintQuiltedVest,
  scrapmail_vest: paintScrapmailVest,
  sequin_tailcoat: paintTailcoat,
};

export function drawGearTorsoIcon(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  id: GearTorsoIconId,
): void {
  paintIconArt(ctx, rect, PAINTERS[id]);
}
