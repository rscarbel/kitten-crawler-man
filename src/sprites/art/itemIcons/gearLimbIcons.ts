/**
 * Icons for the gear worn on the limbs — gloves, wraps, bracers, kneeguards,
 * boots and the cat's booties — and the pot-lid buckler carried on the arm.
 *
 * Every boot is drawn in side profile, toe to the right, so the four human
 * pairs differ where a player looks first: shaft height, heel, sole and toe.
 * Gloves stand fingers up, palm to the viewer. The cat's booties are always a
 * pair, small and round, so they never read as a human boot.
 */

import type { Rect } from '../../../ui/core/geom';
import {
  BOLD_DETAIL,
  disc,
  glint,
  hairlineWidth,
  bandedFill,
  ICON_OUTLINE,
  litFill,
  outlineWidth,
  MEDIUM_DETAIL,
  offsetShade,
  paintForm,
  paintIconArt,
  rivet,
  strokeDetail,
  tone,
  traceEllipse,
  tracePoints,
  withShapeClip,
  type IconArtPainter,
  type IconPoint,
} from './iconPaint';

export type GearLimbIconId =
  | 'scrappers_wraps'
  | 'hobnail_boots'
  | 'riot_kneeguards'
  | 'iron_knuckle_gauntlet'
  | 'silkspinner_gloves'
  | 'lineman_boots'
  | 'mousehide_booties'
  | 'prowler_booties'
  | 'hearthguard_bracers'
  | 'hearthguard_boots'
  | 'pot_lid_buckler';

type Shape = readonly IconPoint[];
type Point = readonly [number, number];

/** Shade bands run from the top-left corner of a form's bounds to its bottom-right. */
function boundsOf(points: Shape): { from: Point; to: Point } {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    from: [Math.min(...xs), Math.min(...ys)],
    to: [Math.max(...xs), Math.max(...ys)],
  };
}

function litForm(ctx: CanvasRenderingContext2D, px: number, points: Shape, base: string): void {
  const { from, to } = boundsOf(points);
  paintForm(ctx, px, () => tracePoints(ctx, points), litFill(ctx, base, from, to));
}

function flatForm(ctx: CanvasRenderingContext2D, px: number, points: Shape, fill: string): void {
  paintForm(ctx, px, () => tracePoints(ctx, points), fill);
}

function shifted(points: Shape, dx: number, dy: number): Shape {
  return points.map(([x, y, radius]) => [x + dx, y + dy, radius] as const);
}

/** Paints `paint` clipped inside `points`, for seams and stains that must stay on the form. */
function insideOf(ctx: CanvasRenderingContext2D, points: Shape, paint: () => void): void {
  withShapeClip(ctx, () => tracePoints(ctx, points), paint);
}

/** A dashed run of stitches along `points`. */
function stitches(
  ctx: CanvasRenderingContext2D,
  px: number,
  points: Shape,
  color: string,
  dash: number,
  widthScale: number = MEDIUM_DETAIL,
): void {
  ctx.save();
  ctx.setLineDash([dash, dash]);
  strokeDetail(ctx, px, points, color, widthScale);
  ctx.restore();
}

/** Tone shifts shared across the family, each named for the surface it makes. */
const SEAM_TONE = -0.5;
const CREASE_TONE = -0.4;
const STAMP_TONE = -0.4;
const HOLLOW_TONE = -0.65;
const SOLE_TONE = -0.55;
const KNUCKLE_PLATE_TONE = -0.1;
/** A turned-over cuff faces up into the light, so it sits a step brighter than the body. */
const TURNED_CUFF_TONE = 0.15;
const FELT_FLAP_TONE = 0.22;
const CAP_RAISE_TONE = 0.18;
const DENT_SHADOW_TONE = -0.6;
const DENT_LIGHT_TONE = 0.5;
const DOME_LIGHT_TONE = 0.3;
const DOME_SHADE_TONE = -0.32;
/** A stroked outline is laid at this multiple of the stroke on top, so the top stroke sits inside it. */
const OUTLINE_UNDERLAY = 2;

/* ------------------------------------------------------------------ boots */

const STEEL = '#9aa1a8';

const HOBNAIL_LEATHER = '#7a4a2a';
const HOBNAIL_SOLE = '#33251b';
const HOBNAIL_LACE = '#d8c49a';
const HOBNAIL_UPPER: Shape = [
  [0.22, 0.1, 0.03],
  [0.54, 0.1, 0.03],
  [0.55, 0.48],
  [0.66, 0.55, 0.05],
  [0.86, 0.61, 0.1],
  [0.9, 0.76],
  [0.2, 0.76],
  [0.21, 0.44],
];
const HOBNAIL_CUFF: Shape = [
  [0.2, 0.08, 0.02],
  [0.56, 0.08, 0.02],
  [0.56, 0.18, 0.02],
  [0.2, 0.18, 0.02],
];
const HOBNAIL_SOLE_SHAPE: Shape = [
  [0.17, 0.73, 0.02],
  [0.92, 0.73, 0.03],
  [0.92, 0.83, 0.03],
  [0.17, 0.83, 0.02],
];
const HOBNAIL_TOE_SEAM: Shape = [
  [0.64, 0.73],
  [0.66, 0.62, 0.04],
  [0.76, 0.58],
];
/** Lace crossings up the front of the shaft, top to bottom. */
const HOBNAIL_LACE_ROWS = [0.24, 0.32, 0.4, 0.48] as const;
const HOBNAIL_LACE_BACK_X = 0.46;
const HOBNAIL_LACE_FRONT_X = 0.56;
const HOBNAIL_LACE_DROP = 0.05;
/** The hobnails sit proud of the sole, so they break its silhouette even at 24 px. */
const HOBNAIL_STUD_XS = [0.24, 0.37, 0.5, 0.63, 0.76, 0.88] as const;
const HOBNAIL_STUD_Y = 0.855;
const HOBNAIL_STUD_R = 0.038;
const HOBNAIL_GLINT: Point = [0.3, 0.26];
const BOOT_GLINT_R = 0.05;

const paintHobnailBoots: IconArtPainter = (ctx, px) => {
  for (const x of HOBNAIL_STUD_XS) rivet(ctx, px, x, HOBNAIL_STUD_Y, HOBNAIL_STUD_R, STEEL);
  litForm(ctx, px, HOBNAIL_SOLE_SHAPE, HOBNAIL_SOLE);
  litForm(ctx, px, HOBNAIL_UPPER, HOBNAIL_LEATHER);
  strokeDetail(ctx, px, HOBNAIL_TOE_SEAM, tone(HOBNAIL_LEATHER, SEAM_TONE), MEDIUM_DETAIL);
  for (const y of HOBNAIL_LACE_ROWS) {
    strokeDetail(
      ctx,
      px,
      [
        [HOBNAIL_LACE_BACK_X, y],
        [HOBNAIL_LACE_FRONT_X, y + HOBNAIL_LACE_DROP],
      ],
      HOBNAIL_LACE,
      MEDIUM_DETAIL,
    );
  }
  litForm(ctx, px, HOBNAIL_CUFF, tone(HOBNAIL_LEATHER, TURNED_CUFF_TONE));
  glint(ctx, HOBNAIL_GLINT[0], HOBNAIL_GLINT[1], BOOT_GLINT_R);
};

/** Near-black garrison leather and a low ankle cut, so it never reads as the tall brown hobnail boot. */
const GARRISON_LEATHER = '#2f2219';
const GARRISON_COLLAR = '#a07a50';
const GARRISON_SOLE = '#16110d';
const GARRISON_WELT = '#cdb48a';
const GARRISON_BRASS = '#e0b04a';
const GARRISON_STRAP_LEATHER = '#8a6a44';
const GARRISON_UPPER: Shape = [
  [0.2, 0.42, 0.03],
  [0.52, 0.42, 0.03],
  [0.54, 0.52],
  [0.68, 0.56, 0.05],
  [0.88, 0.61, 0.1],
  [0.9, 0.74],
  [0.18, 0.74],
  [0.19, 0.56],
];
const GARRISON_COLLAR_SHAPE: Shape = [
  [0.17, 0.37, 0.04],
  [0.55, 0.37, 0.04],
  [0.55, 0.46, 0.03],
  [0.17, 0.46, 0.03],
];
const GARRISON_SOLE_SHAPE: Shape = [
  [0.15, 0.71, 0.02],
  [0.93, 0.71, 0.03],
  [0.93, 0.79, 0.03],
  [0.15, 0.79, 0.02],
];
const GARRISON_HEEL: Shape = [
  [0.15, 0.77],
  [0.42, 0.77],
  [0.4, 0.9, 0.02],
  [0.17, 0.9, 0.02],
];
const GARRISON_STRAP: Shape = [
  [0.17, 0.5],
  [0.58, 0.54],
  [0.62, 0.64],
  [0.17, 0.61],
];
/** A big brass buckle on the strap: the boot's one bright landmark at slot size. */
const GARRISON_BUCKLE: Shape = [
  [0.36, 0.46, 0.015],
  [0.5, 0.48, 0.015],
  [0.5, 0.68, 0.015],
  [0.36, 0.66, 0.015],
];
const GARRISON_BUCKLE_HOLE: Shape = [
  [0.4, 0.52, 0.01],
  [0.46, 0.53, 0.01],
  [0.46, 0.62, 0.01],
  [0.4, 0.61, 0.01],
];
const GARRISON_WELT_LINE: Shape = [
  [0.2, 0.75],
  [0.9, 0.75],
];
const GARRISON_WELT_DASH = 0.03;
const GARRISON_GLINT: Point = [0.72, 0.64];

const paintHearthguardBoots: IconArtPainter = (ctx, px) => {
  litForm(ctx, px, GARRISON_HEEL, GARRISON_SOLE);
  litForm(ctx, px, GARRISON_SOLE_SHAPE, GARRISON_SOLE);
  litForm(ctx, px, GARRISON_UPPER, GARRISON_LEATHER);
  stitches(ctx, px, GARRISON_WELT_LINE, GARRISON_WELT, GARRISON_WELT_DASH);
  litForm(ctx, px, GARRISON_STRAP, GARRISON_STRAP_LEATHER);
  litForm(ctx, px, GARRISON_BUCKLE, GARRISON_BRASS);
  flatForm(ctx, px, GARRISON_BUCKLE_HOLE, GARRISON_STRAP_LEATHER);
  litForm(ctx, px, GARRISON_COLLAR_SHAPE, GARRISON_COLLAR);
  glint(ctx, GARRISON_GLINT[0], GARRISON_GLINT[1], BOOT_GLINT_R);
};

const PIG_LEATHER = '#d9958a';
const HOOF = '#4a3a36';
const LINEMAN_UPPER: Shape = [
  [0.26, 0.18, 0.04],
  [0.54, 0.18, 0.04],
  [0.56, 0.48],
  [0.68, 0.55, 0.06],
  [0.84, 0.62, 0.08],
  [0.86, 0.8],
  [0.2, 0.8],
  [0.23, 0.48],
];
/** A cloven trotter cap on the toe: two rounded toes split by a notch, the one shape that says "pig" at slot size. */
const LINEMAN_TROTTER: Shape = [
  [0.7, 0.6, 0.06],
  [0.86, 0.62, 0.06],
  [0.93, 0.7, 0.04],
  [0.8, 0.74],
  [0.94, 0.79, 0.04],
  [0.9, 0.88, 0.02],
  [0.68, 0.88, 0.04],
  [0.66, 0.72, 0.06],
];
const LINEMAN_CLEFT: Shape = [
  [0.8, 0.74],
  [0.74, 0.74],
];
const LINEMAN_SOLE: Shape = [
  [0.18, 0.8, 0.02],
  [0.7, 0.8],
  [0.7, 0.88],
  [0.18, 0.88, 0.02],
];
const LINEMAN_WRINKLES: readonly Shape[] = [
  [
    [0.3, 0.5],
    [0.38, 0.47],
    [0.46, 0.5],
  ],
  [
    [0.32, 0.6],
    [0.42, 0.57],
    [0.52, 0.6],
  ],
];
/** The pull tab at the back of the shaft curls like a pig's tail. */
const TAIL_CX = 0.2;
const TAIL_CY = 0.26;
const TAIL_R = 0.06;
const TAIL_START = -Math.PI * 0.4;
const TAIL_SWEEP = Math.PI * 1.6;
const LINEMAN_GLINT: Point = [0.32, 0.3];

const paintLinemanBoots: IconArtPainter = (ctx, px) => {
  ctx.beginPath();
  ctx.arc(TAIL_CX, TAIL_CY, TAIL_R, TAIL_START, TAIL_START + TAIL_SWEEP);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = hairlineWidth(px) * BOLD_DETAIL * OUTLINE_UNDERLAY;
  ctx.stroke();
  ctx.strokeStyle = PIG_LEATHER;
  ctx.lineWidth = hairlineWidth(px) * BOLD_DETAIL;
  ctx.stroke();
  litForm(ctx, px, LINEMAN_SOLE, tone(PIG_LEATHER, SOLE_TONE));
  litForm(ctx, px, LINEMAN_UPPER, PIG_LEATHER);
  for (const wrinkle of LINEMAN_WRINKLES) {
    strokeDetail(ctx, px, wrinkle, tone(PIG_LEATHER, CREASE_TONE), MEDIUM_DETAIL);
  }
  litForm(ctx, px, LINEMAN_TROTTER, HOOF);
  strokeDetail(ctx, px, LINEMAN_CLEFT, ICON_OUTLINE, BOLD_DETAIL);
  glint(ctx, LINEMAN_GLINT[0], LINEMAN_GLINT[1], BOOT_GLINT_R);
};

/* ---------------------------------------------------------- cat booties */

/** Where the back and front bootie of a pair sit; the front one overlaps the back. */
const BOOTIE_BACK_OFFSET: Point = [0.1, 0.1];
const BOOTIE_FRONT_OFFSET: Point = [0.38, 0.42];
const BOOTIE_GLINT_R = 0.04;

const MOUSEHIDE = '#9a958f';
const MOUSEHIDE_PAD = '#d9a3a0';
/** A chubby, toe-heavy sock: round enough that it can only be a paw's. */
const MOUSE_BOOTIE: Shape = [
  [0.06, 0.04, 0.04],
  [0.3, 0.04, 0.04],
  [0.32, 0.22],
  [0.47, 0.28, 0.12],
  [0.5, 0.44, 0.1],
  [0.02, 0.46, 0.1],
  [0.04, 0.2],
];
const MOUSE_CUFF: Shape = [
  [0.02, 0.0, 0.05],
  [0.35, 0.0, 0.05],
  [0.35, 0.1, 0.05],
  [0.02, 0.1, 0.05],
];
const MOUSE_PAD_CX = 0.36;
const MOUSE_PAD_CY = 0.38;
const MOUSE_PAD_R = 0.05;
const MOUSE_GLINT: Point = [0.12, 0.2];

function paintMouseBootie(ctx: CanvasRenderingContext2D, px: number, at: Point): void {
  const [dx, dy] = at;
  litForm(ctx, px, shifted(MOUSE_BOOTIE, dx, dy), MOUSEHIDE);
  disc(ctx, MOUSE_PAD_CX + dx, MOUSE_PAD_CY + dy, MOUSE_PAD_R, MOUSEHIDE_PAD);
  litForm(ctx, px, shifted(MOUSE_CUFF, dx, dy), tone(MOUSEHIDE, TURNED_CUFF_TONE));
  glint(ctx, MOUSE_GLINT[0] + dx, MOUSE_GLINT[1] + dy, BOOTIE_GLINT_R);
}

const paintMousehideBooties: IconArtPainter = (ctx, px) => {
  paintMouseBootie(ctx, px, BOOTIE_BACK_OFFSET);
  paintMouseBootie(ctx, px, BOOTIE_FRONT_OFFSET);
};

/** Lifted well above the slot's own dark so the pair never sinks into it. */
const PROWLER_FELT = '#4c4e5a';
const PROWLER_SILVER = '#e4e8ee';
/** Felt is matte: two flat bands and no specular glint, or it reads as steel. */
const FELT_LIT_TONE = 0.12;
const FELT_SHADE_TONE = -0.18;
const FELT_BAND_SPLIT = 0.55;
/** Taller and slimmer than the mousehide pair, every corner soft. */
const PROWLER_BOOTIE: Shape = [
  [0.08, -0.12, 0.04],
  [0.28, -0.12, 0.04],
  [0.29, 0.24, 0.05],
  [0.44, 0.3, 0.1],
  [0.52, 0.4, 0.06],
  [0.48, 0.47, 0.04],
  [0.07, 0.47, 0.07],
  [0.07, 0.2],
];
/** A soft rolled cuff, turned over at the top. */
const PROWLER_CUFF: Shape = [
  [0.05, -0.15, 0.05],
  [0.31, -0.15, 0.05],
  [0.32, -0.02, 0.05],
  [0.04, -0.02, 0.05],
];
const PROWLER_CUFF_STITCH: Shape = [
  [0.07, -0.06],
  [0.29, -0.06],
];
const PROWLER_TOE_STITCH: Shape = [
  [0.3, 0.27],
  [0.4, 0.33],
  [0.46, 0.44],
];
/** Fine silver stitches: a round dot every gap, never a continuous edge. */
const STITCH_DOT = 0.001;
const STITCH_GAP = 0.04;

function feltFill(ctx: CanvasRenderingContext2D, points: Shape, base: string): CanvasGradient {
  const { from, to } = boundsOf(points);
  return bandedFill(ctx, from, to, [
    [tone(base, FELT_LIT_TONE), FELT_BAND_SPLIT],
    [tone(base, FELT_SHADE_TONE), 1],
  ]);
}

function dottedStitches(
  ctx: CanvasRenderingContext2D,
  px: number,
  points: Shape,
  color: string,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.setLineDash([STITCH_DOT, STITCH_GAP]);
  strokeDetail(ctx, px, points, color, BOLD_DETAIL);
  ctx.restore();
}

function paintProwlerBootie(ctx: CanvasRenderingContext2D, px: number, at: Point): void {
  const [dx, dy] = at;
  const body = shifted(PROWLER_BOOTIE, dx, dy);
  const cuff = shifted(PROWLER_CUFF, dx, dy);
  paintForm(ctx, px, () => tracePoints(ctx, body), feltFill(ctx, body, PROWLER_FELT));
  dottedStitches(ctx, px, shifted(PROWLER_TOE_STITCH, dx, dy), PROWLER_SILVER);
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, cuff),
    feltFill(ctx, cuff, tone(PROWLER_FELT, FELT_FLAP_TONE)),
  );
  dottedStitches(ctx, px, shifted(PROWLER_CUFF_STITCH, dx, dy), PROWLER_SILVER);
}

const PROWLER_BACK_OFFSET: Point = [0.08, 0.2];
const PROWLER_FRONT_OFFSET: Point = [0.36, 0.42];

const paintProwlerBooties: IconArtPainter = (ctx, px) => {
  paintProwlerBootie(ctx, px, PROWLER_BACK_OFFSET);
  paintProwlerBootie(ctx, px, PROWLER_FRONT_OFFSET);
};

/* ----------------------------------------------------------------- hands */

const WRAP_CLOTH = '#d8d0bc';
const WRAP_GRIME = '#9c9484';
const WRAP_TAPE = '#8d939a';
/** A wrapped fist: knuckles bound in cloth, fingers folded down under the wrap. */
const WRAP_HAND: Shape = [
  [0.34, 0.92],
  [0.32, 0.66],
  [0.18, 0.56, 0.05],
  [0.16, 0.45, 0.05],
  [0.25, 0.41, 0.04],
  [0.31, 0.46],
  [0.29, 0.3, 0.07],
  [0.42, 0.24, 0.05],
  [0.44, 0.27],
  [0.47, 0.22, 0.05],
  [0.59, 0.22, 0.05],
  [0.61, 0.26],
  [0.63, 0.24, 0.05],
  [0.76, 0.3, 0.07],
  [0.77, 0.62, 0.05],
  [0.68, 0.92],
];
const WRAP_TAPE_BAND: Shape = [
  [0.31, 0.76, 0.02],
  [0.71, 0.76, 0.02],
  [0.7, 0.88, 0.02],
  [0.32, 0.88, 0.02],
];
/** The loose end of the wrap, trailing off the wrist: what makes it a wrap and not a mitten. */
const WRAP_TAIL: Shape = [
  [0.64, 0.86],
  [0.72, 0.84],
  [0.86, 0.9, 0.04],
  [0.94, 0.98],
  [0.84, 0.99],
  [0.76, 0.93],
];
/** The turns of cloth cross the hand on a slant, one stroke per turn. */
const WRAP_TURN_STARTS = [0.22, 0.34, 0.46, 0.58, 0.7] as const;
const WRAP_TURN_RISE = 0.16;
const WRAP_TURN_LEFT = 0.12;
const WRAP_TURN_RIGHT = 0.82;
const WRAP_STAIN_CX = 0.6;
const WRAP_STAIN_CY = 0.5;
const WRAP_STAIN_RX = 0.13;
const WRAP_STAIN_RY = 0.1;

const paintScrappersWraps: IconArtPainter = (ctx, px) => {
  litForm(ctx, px, WRAP_TAIL, WRAP_CLOTH);
  litForm(ctx, px, WRAP_HAND, WRAP_CLOTH);
  insideOf(ctx, WRAP_HAND, () => {
    traceEllipse(ctx, WRAP_STAIN_CX, WRAP_STAIN_CY, WRAP_STAIN_RX, WRAP_STAIN_RY);
    ctx.fillStyle = WRAP_GRIME;
    ctx.fill();
    for (const y of WRAP_TURN_STARTS) {
      strokeDetail(
        ctx,
        px,
        [
          [WRAP_TURN_LEFT, y + WRAP_TURN_RISE],
          [WRAP_TURN_RIGHT, y],
        ],
        tone(WRAP_CLOTH, CREASE_TONE),
        MEDIUM_DETAIL,
      );
    }
  });
  litForm(ctx, px, WRAP_TAPE_BAND, WRAP_TAPE);
};

const IRON = '#7d848c';
const GAUNTLET_HAND: Shape = [
  [0.3, 0.7],
  [0.28, 0.58],
  [0.14, 0.48, 0.04],
  [0.12, 0.38, 0.04],
  [0.21, 0.34, 0.04],
  [0.3, 0.42],
  [0.27, 0.18, 0.05],
  [0.4, 0.17, 0.05],
  [0.41, 0.36],
  [0.41, 0.12, 0.05],
  [0.54, 0.12, 0.05],
  [0.55, 0.36],
  [0.55, 0.15, 0.05],
  [0.67, 0.16, 0.05],
  [0.68, 0.38],
  [0.68, 0.26, 0.05],
  [0.79, 0.27, 0.05],
  [0.78, 0.58],
  [0.72, 0.7],
];
/** The flared cuff is the gauntlet's signature: no glove here is wider at the wrist than the hand. */
const GAUNTLET_CUFF: Shape = [
  [0.29, 0.6, 0.02],
  [0.73, 0.6, 0.02],
  [0.86, 0.94, 0.02],
  [0.16, 0.94, 0.02],
];
const GAUNTLET_KNUCKLE_PLATE: Shape = [
  [0.27, 0.37, 0.03],
  [0.8, 0.39, 0.03],
  [0.79, 0.47, 0.03],
  [0.28, 0.47, 0.03],
];
/** Dark gaps between the fingers, down to the knuckle plate, so four fingers read and not a block. */
const FINGER_GAPS: readonly Shape[] = [
  [
    [0.41, 0.2],
    [0.41, 0.37],
  ],
  [
    [0.545, 0.17],
    [0.55, 0.37],
  ],
  [
    [0.675, 0.24],
    [0.68, 0.38],
  ],
];
/** Each finger's lames are split where its joints bend. */
const FINGER_JOINTS: readonly (readonly [x0: number, x1: number, y: number])[] = [
  [0.28, 0.4, 0.27],
  [0.42, 0.54, 0.24],
  [0.56, 0.67, 0.26],
  [0.69, 0.78, 0.33],
];
const KNUCKLE_RIVET_XS = [0.36, 0.54, 0.72] as const;
const KNUCKLE_RIVET_Y = 0.425;
const CUFF_RIVET_XS = [0.3, 0.51, 0.72] as const;
const CUFF_RIVET_Y = 0.84;
const GAUNTLET_RIVET_R = 0.032;
const GAUNTLET_CUFF_RIDGE: Shape = [
  [0.27, 0.7],
  [0.76, 0.7],
];
const GAUNTLET_GLINT: Point = [0.36, 0.22];
const GAUNTLET_GLINT_R = 0.06;

const paintIronKnuckleGauntlet: IconArtPainter = (ctx, px) => {
  litForm(ctx, px, GAUNTLET_HAND, IRON);
  for (const [x0, x1, y] of FINGER_JOINTS) {
    strokeDetail(
      ctx,
      px,
      [
        [x0, y],
        [x1, y],
      ],
      ICON_OUTLINE,
      MEDIUM_DETAIL,
    );
  }
  for (const gap of FINGER_GAPS) strokeDetail(ctx, px, gap, ICON_OUTLINE, BOLD_DETAIL);
  litForm(ctx, px, GAUNTLET_KNUCKLE_PLATE, tone(IRON, KNUCKLE_PLATE_TONE));
  for (const x of KNUCKLE_RIVET_XS) rivet(ctx, px, x, KNUCKLE_RIVET_Y, GAUNTLET_RIVET_R, IRON);
  litForm(ctx, px, GAUNTLET_CUFF, IRON);
  strokeDetail(ctx, px, GAUNTLET_CUFF_RIDGE, tone(IRON, SEAM_TONE), MEDIUM_DETAIL);
  for (const x of CUFF_RIVET_XS) rivet(ctx, px, x, CUFF_RIVET_Y, GAUNTLET_RIVET_R, IRON);
  glint(ctx, GAUNTLET_GLINT[0], GAUNTLET_GLINT[1], GAUNTLET_GLINT_R);
};

const SILK_GLOVE = '#e6e0d2';
const SILK_CUFF = '#a8a2b8';
const SILK_THREAD = '#fbfaf6';
/** A slender glove with its fingers spread, so the threads have somewhere to come from. */
const SILK_HAND: Shape = [
  [0.38, 0.92],
  [0.36, 0.7],
  [0.22, 0.58, 0.03],
  [0.15, 0.48, 0.03],
  [0.21, 0.44, 0.03],
  [0.34, 0.53],
  [0.28, 0.27, 0.04],
  [0.37, 0.25, 0.04],
  [0.43, 0.45],
  [0.44, 0.18, 0.04],
  [0.53, 0.18, 0.04],
  [0.54, 0.45],
  [0.59, 0.22, 0.04],
  [0.67, 0.24, 0.04],
  [0.63, 0.48],
  [0.72, 0.36, 0.03],
  [0.79, 0.4, 0.03],
  [0.7, 0.62, 0.04],
  [0.64, 0.92],
];
const SILK_CUFF_SHAPE: Shape = [
  [0.34, 0.78, 0.02],
  [0.67, 0.78, 0.02],
  [0.68, 0.94, 0.02],
  [0.33, 0.94, 0.02],
];
/** Each thread leaves a fingertip and drifts up and right, off toward the corner. */
const SILK_THREADS: readonly Shape[] = [
  [
    [0.18, 0.45],
    [0.1, 0.32, 0.08],
    [0.14, 0.12],
  ],
  [
    [0.32, 0.25],
    [0.3, 0.12, 0.06],
    [0.4, 0.04],
  ],
  [
    [0.49, 0.18],
    [0.56, 0.08, 0.06],
    [0.68, 0.06],
  ],
  [
    [0.63, 0.23],
    [0.76, 0.14, 0.06],
    [0.9, 0.16],
  ],
  [
    [0.76, 0.38],
    [0.88, 0.32, 0.06],
    [0.96, 0.4],
  ],
];
const SILK_THREAD_WIDTH = 1.2;
const SILK_GLINT: Point = [0.4, 0.62];
const SILK_GLINT_R = 0.045;

const paintSilkspinnerGloves: IconArtPainter = (ctx, px) => {
  for (const thread of SILK_THREADS) {
    strokeDetail(ctx, px, thread, ICON_OUTLINE, SILK_THREAD_WIDTH * BOLD_DETAIL);
    strokeDetail(ctx, px, thread, SILK_THREAD, SILK_THREAD_WIDTH);
  }
  litForm(ctx, px, SILK_HAND, SILK_GLOVE);
  litForm(ctx, px, SILK_CUFF_SHAPE, SILK_CUFF);
  glint(ctx, SILK_GLINT[0], SILK_GLINT[1], SILK_GLINT_R);
};

const BOILED_LEATHER = '#8a5a32';
const BRACER_LACE = '#3a2617';
/**
 * The bracer is painted upright — elbow end at the top, wrist end at the
 * bottom — then laid across the cell on a slant, the way a cuff lies on a
 * table.
 */
const BRACER_TILT = -0.62;
const BRACER_PIVOT = 0.5;
const BRACER_BODY: Shape = [
  [0.3, 0.18, 0.03],
  [0.7, 0.18, 0.03],
  [0.65, 0.84, 0.03],
  [0.35, 0.84, 0.03],
];
const BRACER_OPENING_CX = 0.5;
const BRACER_OPENING_CY = 0.18;
const BRACER_OPENING_RX = 0.2;
const BRACER_OPENING_RY = 0.06;
const BRACER_RIVETS: readonly Point[] = [
  [0.36, 0.28],
  [0.64, 0.28],
  [0.39, 0.74],
  [0.61, 0.74],
];
const BRACER_RIVET_R = 0.035;
const BRACER_BRASS = '#c99a3a';
/** The garrison hearth, stamped in the leather: a house roof over a flame. */
const HEARTH_ROOF: Shape = [
  [0.4, 0.5],
  [0.5, 0.4],
  [0.6, 0.5],
];
const HEARTH_FLAME: Shape = [
  [0.5, 0.5],
  [0.55, 0.57, 0.03],
  [0.5, 0.64, 0.03],
  [0.45, 0.57, 0.03],
];
const BRACER_LACE_ROWS = [0.32, 0.44, 0.56, 0.68] as const;
const BRACER_LACE_SPAN = 0.06;
const BRACER_EDGE_X = 0.69;

const paintHearthguardBracers: IconArtPainter = (ctx, px) => {
  ctx.translate(BRACER_PIVOT, BRACER_PIVOT);
  ctx.rotate(BRACER_TILT);
  ctx.translate(-BRACER_PIVOT, -BRACER_PIVOT);
  for (const y of BRACER_LACE_ROWS) {
    strokeDetail(
      ctx,
      px,
      [
        [BRACER_EDGE_X - BRACER_LACE_SPAN, y],
        [BRACER_EDGE_X + BRACER_LACE_SPAN, y + BRACER_LACE_SPAN],
      ],
      BRACER_LACE,
      BOLD_DETAIL,
    );
  }
  const { from, to } = boundsOf(BRACER_BODY);
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, BRACER_BODY),
    litFill(ctx, BOILED_LEATHER, [from[0], 0], [to[0], 0]),
  );
  paintForm(
    ctx,
    px,
    () =>
      traceEllipse(ctx, BRACER_OPENING_CX, BRACER_OPENING_CY, BRACER_OPENING_RX, BRACER_OPENING_RY),
    tone(BOILED_LEATHER, HOLLOW_TONE),
  );
  strokeDetail(ctx, px, HEARTH_ROOF, tone(BOILED_LEATHER, SEAM_TONE), BOLD_DETAIL);
  flatForm(ctx, px, HEARTH_FLAME, tone(BOILED_LEATHER, STAMP_TONE));
  for (const [x, y] of BRACER_RIVETS) rivet(ctx, px, x, y, BRACER_RIVET_R, BRACER_BRASS);
};

/* ------------------------------------------------------------------ knees */

const RIOT_SHELL = '#373a42';
const RIOT_STRAP = '#6a6c74';
const RIOT_SCUFF = '#ffffff';
const RIOT_STENCIL = '#e8e4d6';
/**
 * A pair, the back one up and left of the front: each a rounded dome over
 * the knee tapering into a shin plate, a strap across it whose ends stick out
 * both sides. Each carries a different stencilled number, since the numbers
 * on a pair never match.
 */
const PAD_BACK_OFFSET: Point = [0.12, 0.02];
const PAD_FRONT_OFFSET: Point = [0.52, 0.1];
/** A small cap over a long shin plate: each pad is much taller than wide, so the pair never reads as round. */
const PAD_CAP_CX = 0.16;
const PAD_CAP_CY = 0.17;
const PAD_CAP_RX = 0.15;
const PAD_CAP_RY = 0.12;
const PAD_DOME_LAYERS = [
  [tone(RIOT_SHELL, DOME_LIGHT_TONE), 0, 0],
  [tone(RIOT_SHELL, CAP_RAISE_TONE), 0.03, 0.03],
  [tone(RIOT_SHELL, DOME_SHADE_TONE), 0.08, 0.08],
] as const;
const PAD_SHIN: Shape = [
  [0.01, 0.16, 0.03],
  [0.31, 0.16, 0.03],
  [0.25, 0.86, 0.07],
  [0.07, 0.86, 0.07],
];
const PAD_STRAPS: readonly Shape[] = [
  [
    [-0.06, 0.36, 0.015],
    [0.38, 0.36, 0.015],
    [0.38, 0.43, 0.015],
    [-0.06, 0.43, 0.015],
  ],
  [
    [-0.04, 0.7, 0.015],
    [0.36, 0.7, 0.015],
    [0.36, 0.76, 0.015],
    [-0.04, 0.76, 0.015],
  ],
];
const PAD_BUCKLE: Shape = [
  [0.28, 0.34, 0.01],
  [0.34, 0.34, 0.01],
  [0.34, 0.45, 0.01],
  [0.28, 0.45, 0.01],
];
const PAD_SCUFF: Shape = [
  [0.2, 0.1],
  [0.27, 0.18],
];
const PAD_GLINT: Point = [0.1, 0.11];
const PAD_GLINT_R = 0.045;
const STENCIL_SEVEN: Shape = [
  [0.11, 0.5],
  [0.21, 0.5],
  [0.14, 0.62],
];
const STENCIL_THREE: Shape = [
  [0.11, 0.5],
  [0.21, 0.5],
  [0.15, 0.55],
  [0.21, 0.6],
  [0.11, 0.62],
];

function paintKneePad(ctx: CanvasRenderingContext2D, px: number, at: Point, numeral: Shape): void {
  const [dx, dy] = at;
  litForm(ctx, px, shifted(PAD_SHIN, dx, dy), RIOT_SHELL);
  for (const strap of PAD_STRAPS) litForm(ctx, px, shifted(strap, dx, dy), RIOT_STRAP);
  flatForm(ctx, px, shifted(PAD_BUCKLE, dx, dy), STEEL);
  strokeDetail(ctx, px, shifted(numeral, dx, dy), RIOT_STENCIL, BOLD_DETAIL);
  const traceCap = (sx: number, sy: number): void =>
    traceEllipse(ctx, PAD_CAP_CX + dx + sx, PAD_CAP_CY + dy + sy, PAD_CAP_RX, PAD_CAP_RY);
  paintForm(ctx, px, () => traceCap(0, 0), RIOT_SHELL);
  offsetShade(ctx, traceCap, [...PAD_DOME_LAYERS]);
  strokeDetail(ctx, px, shifted(PAD_SCUFF, dx, dy), RIOT_SCUFF, BOLD_DETAIL);
  glint(ctx, PAD_GLINT[0] + dx, PAD_GLINT[1] + dy, PAD_GLINT_R);
}

const paintRiotKneeguards: IconArtPainter = (ctx, px) => {
  paintKneePad(ctx, px, PAD_BACK_OFFSET, STENCIL_SEVEN);
  paintKneePad(ctx, px, PAD_FRONT_OFFSET, STENCIL_THREE);
};

/* ---------------------------------------------------------------- buckler */

const POT_STEEL = '#8f969c';
/**
 * A pot lid seen from above at a slant, not a shield face-on: a thick rolled
 * rim, a shallow domed face, a black knob standing up at its crown and one
 * deep dent — the lid he carries on his off hand.
 */
const LID_CX = 0.5;
const LID_CY = 0.6;
const LID_RX = 0.39;
const LID_RY = 0.26;
/** The rolled lip, as a thick ring stroked a step lighter than the face. */
const LID_LIP_WIDTH = 0.07;
const LID_LIP_TONE = 0.35;
const LID_FACE_SHARE = 0.84;
const LID_DOME_LAYERS = [
  [tone(POT_STEEL, DOME_LIGHT_TONE), 0, 0],
  [POT_STEEL, 0.05, 0.04],
  [tone(POT_STEEL, DOME_SHADE_TONE), 0.12, 0.09],
] as const;
/**
 * The knob: a black bakelite cap on a short steel neck at the crown of the
 * dome, seen from above at the lid's slant, so it stands up over the lid's
 * centre.
 */
const KNOB_NECK_BOTTOM: Point = [0.5, 0.58];
const KNOB_NECK_TOP: Point = [0.5, 0.47];
const KNOB_NECK_WIDTH = 0.07;
const KNOB_CX = 0.5;
const KNOB_CY = 0.43;
const KNOB_RX = 0.1;
const KNOB_RY = 0.07;
const KNOB_BLACK = '#232022';
const KNOB_SHINE_TONE = 0.45;
/** The shine on the cap, as a share of the cap. */
const KNOB_SHINE_SHARE = 0.45;
/** The dent: a dark hollow with a lit lip on its far wall. */
const DENT_SHADOW: Shape = [
  [0.2, 0.64],
  [0.26, 0.57, 0.05],
  [0.33, 0.6],
  [0.3, 0.68, 0.04],
];
const DENT_LIP: Shape = [
  [0.21, 0.69],
  [0.28, 0.71, 0.04],
  [0.35, 0.64],
];
const LID_GLINT: Point = [0.74, 0.54];
const LID_GLINT_R = 0.07;
const KNOB_GLINT: Point = [0.46, 0.41];
const KNOB_GLINT_R = 0.035;

function traceKnobNeck(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(KNOB_NECK_BOTTOM[0], KNOB_NECK_BOTTOM[1]);
  ctx.lineTo(KNOB_NECK_TOP[0], KNOB_NECK_TOP[1]);
}

const paintPotLidBuckler: IconArtPainter = (ctx, px) => {
  const traceLid = (): void => traceEllipse(ctx, LID_CX, LID_CY, LID_RX, LID_RY);
  traceLid();
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = LID_LIP_WIDTH + outlineWidth(px) * OUTLINE_UNDERLAY;
  ctx.stroke();
  ctx.fillStyle = POT_STEEL;
  ctx.fill();
  const faceRx = LID_RX * LID_FACE_SHARE;
  const faceRy = LID_RY * LID_FACE_SHARE;
  offsetShade(ctx, (dx, dy) => traceEllipse(ctx, LID_CX + dx, LID_CY + dy, faceRx, faceRy), [
    ...LID_DOME_LAYERS,
  ]);
  traceLid();
  ctx.strokeStyle = tone(POT_STEEL, LID_LIP_TONE);
  ctx.lineWidth = LID_LIP_WIDTH;
  ctx.stroke();
  flatForm(ctx, px, DENT_SHADOW, tone(POT_STEEL, DENT_SHADOW_TONE));
  strokeDetail(ctx, px, DENT_LIP, tone(POT_STEEL, DENT_LIGHT_TONE), BOLD_DETAIL);
  traceKnobNeck(ctx);
  ctx.lineCap = 'round';
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = KNOB_NECK_WIDTH + outlineWidth(px) * OUTLINE_UNDERLAY;
  ctx.stroke();
  ctx.strokeStyle = tone(POT_STEEL, DENT_SHADOW_TONE);
  ctx.lineWidth = KNOB_NECK_WIDTH;
  ctx.stroke();
  traceEllipse(ctx, KNOB_CX, KNOB_CY, KNOB_RX, KNOB_RY);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = outlineWidth(px) * OUTLINE_UNDERLAY;
  ctx.stroke();
  ctx.fillStyle = KNOB_BLACK;
  ctx.fill();
  traceEllipse(ctx, KNOB_CX, KNOB_CY, KNOB_RX * KNOB_SHINE_SHARE, KNOB_RY * KNOB_SHINE_SHARE);
  ctx.fillStyle = tone(KNOB_BLACK, KNOB_SHINE_TONE);
  ctx.fill();
  glint(ctx, LID_GLINT[0], LID_GLINT[1], LID_GLINT_R);
  glint(ctx, KNOB_GLINT[0], KNOB_GLINT[1], KNOB_GLINT_R);
};

const LIMB_ICON_PAINTERS: Record<GearLimbIconId, IconArtPainter> = {
  scrappers_wraps: paintScrappersWraps,
  hobnail_boots: paintHobnailBoots,
  riot_kneeguards: paintRiotKneeguards,
  iron_knuckle_gauntlet: paintIronKnuckleGauntlet,
  silkspinner_gloves: paintSilkspinnerGloves,
  lineman_boots: paintLinemanBoots,
  mousehide_booties: paintMousehideBooties,
  prowler_booties: paintProwlerBooties,
  hearthguard_bracers: paintHearthguardBracers,
  hearthguard_boots: paintHearthguardBoots,
  pot_lid_buckler: paintPotLidBuckler,
};

export function drawGearLimbIcon(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  id: GearLimbIconId,
): void {
  paintIconArt(ctx, rect, LIMB_ICON_PAINTERS[id]);
}
