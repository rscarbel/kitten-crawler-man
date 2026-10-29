import type { Rect } from '../../../ui/core/geom';
import {
  bandedFill,
  disc,
  FULL_TURN,
  glint,
  MEDIUM_DETAIL,
  hairlineWidth,
  ICON_OUTLINE,
  litFill,
  outlineWidth,
  paintForm,
  paintIconArt,
  strokeDetail,
  tone,
  tracePoints,
  withShapeClip,
  type IconPoint,
} from './iconPaint';

const PARCHMENT = '#e6cf9c';
const PARCHMENT_ROLL = '#d8bb80';
const INK = '#5a4128';
const ROOT = '#7d5532';
/** Root hairs are pale, the way a freshly pulled root's are. */
const ROOTLET = '#d9c49a';
const WAX = '#a31f2e';
const RIBBON = '#3d5f8f';

const SHEET: readonly IconPoint[] = [
  [0.25, 0.2],
  [0.75, 0.2],
  [0.77, 0.5],
  [0.75, 0.8],
  [0.25, 0.8],
  [0.23, 0.5],
];
/** Lit from the upper-left corner across to the lower-right one. */
const SHEET_LIGHT_FROM: readonly [number, number] = [0.25, 0.2];
const SHEET_LIGHT_TO: readonly [number, number] = [0.75, 0.8];
const SHEET_SHADE_TONE = -0.18;
const SHEET_LIGHT_TONE = 0.12;
const SHEET_LIGHT_UNTIL = 0.3;
const SHEET_MID_UNTIL = 0.72;
/** The top roll casts a short shadow down onto the sheet just under it. */
const ROLL_SHADOW_TOP = 0.24;
const ROLL_SHADOW_HEIGHT = 0.05;
const ROLL_SHADOW = 'rgba(70,45,20,0.35)';

interface Roll {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}
const TOP_ROLL: Roll = { left: 0.14, right: 0.86, top: 0.1, bottom: 0.27 };
const BOTTOM_ROLL: Roll = { left: 0.18, right: 0.82, top: 0.74, bottom: 0.88 };
/** End-cap ellipse width as a fraction of the roll's height: the roll is seen almost side-on. */
const ROLL_CAP_ASPECT = 0.38;
const ROLL_HIGHLIGHT_UNTIL = 0.3;
const ROLL_MID_UNTIL = 0.62;
const ROLL_LIGHT_TONE = 0.3;
const ROLL_SHADE_TONE = -0.32;
/** The spiral of rolled sheet visible in each end cap. */
const SPIRAL_TURNS = 1.6;
const SPIRAL_STEPS = 14;
const SPIRAL_INNER_FRACTION = 0.15;

/** A root as a centreline and its half-width at the base and at the tip, in icon units. */
interface RootStroke {
  readonly points: readonly IconPoint[];
  readonly baseHalfWidth: number;
  readonly tipHalfWidth: number;
}

/** The roots inked on the sheet: a gnarled trunk splitting into two twisting arms over a spread of feeder roots. */
const SHEET_ROOTS: readonly RootStroke[] = [
  {
    points: [
      [0.5, 0.61],
      [0.47, 0.54],
      [0.52, 0.46],
      [0.47, 0.38],
      [0.51, 0.3],
    ],
    baseHalfWidth: 0.045,
    tipHalfWidth: 0.01,
  },
  {
    points: [
      [0.49, 0.56],
      [0.41, 0.53],
      [0.35, 0.46],
      [0.4, 0.39],
      [0.34, 0.32],
    ],
    baseHalfWidth: 0.03,
    tipHalfWidth: 0.008,
  },
  {
    points: [
      [0.51, 0.51],
      [0.59, 0.49],
      [0.65, 0.42],
      [0.6, 0.36],
      [0.66, 0.3],
    ],
    baseHalfWidth: 0.03,
    tipHalfWidth: 0.008,
  },
  {
    points: [
      [0.5, 0.61],
      [0.43, 0.62],
      [0.36, 0.6],
    ],
    baseHalfWidth: 0.025,
    tipHalfWidth: 0.008,
  },
  {
    points: [
      [0.5, 0.61],
      [0.57, 0.63],
      [0.64, 0.6],
    ],
    baseHalfWidth: 0.025,
    tipHalfWidth: 0.008,
  },
];

/** Roots creeping out from behind the sheet's edges, the one cue that this scroll does something. */
const ESCAPING_ROOTS: readonly RootStroke[] = [
  {
    points: [
      [0.72, 0.44],
      [0.8, 0.39],
      [0.88, 0.41],
      [0.93, 0.34],
      [0.88, 0.28],
    ],
    baseHalfWidth: 0.04,
    tipHalfWidth: 0.01,
  },
  {
    points: [
      [0.28, 0.58],
      [0.2, 0.62],
      [0.12, 0.6],
      [0.07, 0.67],
      [0.12, 0.72],
    ],
    baseHalfWidth: 0.04,
    tipHalfWidth: 0.01,
  },
];
const ROOT_LIGHT_FROM: readonly [number, number] = [0.3, 0.28];
const ROOT_LIGHT_TO: readonly [number, number] = [0.7, 0.66];
/** Each span of a root is split this many times, so its bends read as curves rather than corners. */
const ROOT_SUBSTEPS = 4;
const CATMULL_ROM_TENSION = 0.5;
const ROOTLETS: readonly (readonly IconPoint[])[] = [
  [
    [0.46, 0.44],
    [0.42, 0.42],
  ],
  [
    [0.62, 0.45],
    [0.67, 0.47],
  ],
  [
    [0.37, 0.43],
    [0.33, 0.45],
  ],
  [
    [0.85, 0.41],
    [0.86, 0.46],
  ],
  [
    [0.15, 0.6],
    [0.14, 0.55],
  ],
];

const INK_LINES: readonly (readonly IconPoint[])[] = [
  [
    [0.33, 0.64],
    [0.67, 0.64],
  ],
  [
    [0.33, 0.69],
    [0.58, 0.69],
  ],
];

const SEAL_CX = 0.5;
const SEAL_CY = 0.8;
const SEAL_R = 0.085;
const SEAL_LUMPS = 7;
const SEAL_LUMP_R = 0.024;
const SEAL_STAMP_R = 0.045;
/** The stamp is pressed into the wax, so its ring is a dark groove; a wet shine sits up-left of it. */
const SEAL_STAMP_TONE = -0.45;
const SEAL_SHINE_TONE = 0.5;
const RIBBON_TAILS: readonly (readonly IconPoint[])[] = [
  [
    [0.46, 0.84],
    [0.4, 0.98],
    [0.44, 0.95],
    [0.47, 0.98],
    [0.5, 0.86],
  ],
  [
    [0.5, 0.86],
    [0.55, 0.98],
    [0.58, 0.95],
    [0.62, 0.97],
    [0.55, 0.84],
  ],
];

const GLINT_X = 0.26;
const GLINT_Y = 0.13;
const GLINT_R = 0.05;

function traceRoll(ctx: CanvasRenderingContext2D, roll: Roll): void {
  const radius = (roll.bottom - roll.top) / 2;
  tracePoints(ctx, [
    [roll.left, roll.top, radius * ROLL_CAP_ASPECT],
    [roll.right, roll.top, radius * ROLL_CAP_ASPECT],
    [roll.right, roll.bottom, radius * ROLL_CAP_ASPECT],
    [roll.left, roll.bottom, radius * ROLL_CAP_ASPECT],
  ]);
}

function paintRoll(ctx: CanvasRenderingContext2D, px: number, roll: Roll): void {
  const fill = bandedFill(
    ctx,
    [0, roll.top],
    [0, roll.bottom],
    [
      [tone(PARCHMENT_ROLL, ROLL_LIGHT_TONE), ROLL_HIGHLIGHT_UNTIL],
      [PARCHMENT_ROLL, ROLL_MID_UNTIL],
      [tone(PARCHMENT_ROLL, ROLL_SHADE_TONE), 1],
    ],
  );
  paintForm(ctx, px, () => traceRoll(ctx, roll), fill);

  const radius = (roll.bottom - roll.top) / 2;
  const capCy = (roll.top + roll.bottom) / 2;
  for (const capCx of [roll.left, roll.right]) {
    ctx.beginPath();
    ctx.ellipse(capCx, capCy, radius * ROLL_CAP_ASPECT, radius, 0, 0, FULL_TURN);
    ctx.fillStyle = tone(PARCHMENT_ROLL, ROLL_SHADE_TONE / 2);
    ctx.fill();
    ctx.strokeStyle = ICON_OUTLINE;
    ctx.lineWidth = outlineWidth(px);
    ctx.stroke();
    const spiral: IconPoint[] = [];
    for (let step = 0; step <= SPIRAL_STEPS; step++) {
      const t = step / SPIRAL_STEPS;
      const angle = t * SPIRAL_TURNS * FULL_TURN;
      const reach = SPIRAL_INNER_FRACTION + (1 - SPIRAL_INNER_FRACTION) * t;
      spiral.push([
        capCx + Math.cos(angle) * radius * ROLL_CAP_ASPECT * reach,
        capCy + Math.sin(angle) * radius * reach,
      ]);
    }
    strokeDetail(ctx, px, spiral, tone(PARCHMENT_ROLL, ROLL_SHADE_TONE * 2));
  }
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const m1 = (p2 - p0) * CATMULL_ROM_TENSION;
  const m2 = (p3 - p1) * CATMULL_ROM_TENSION;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2
  );
}

/** The root's centreline, smoothed through its control points. */
function smoothRoot(points: readonly IconPoint[]): IconPoint[] {
  const smooth: IconPoint[] = [];
  const last = points.length - 1;
  for (let span = 0; span < last; span++) {
    const p0 = points[Math.max(0, span - 1)];
    const p1 = points[span];
    const p2 = points[span + 1];
    const p3 = points[Math.min(last, span + 2)];
    for (let step = 0; step < ROOT_SUBSTEPS; step++) {
      const t = step / ROOT_SUBSTEPS;
      smooth.push([
        catmullRom(p0[0], p1[0], p2[0], p3[0], t),
        catmullRom(p0[1], p1[1], p2[1], p3[1], t),
      ]);
    }
  }
  smooth.push(points[last]);
  return smooth;
}

/** A closed outline of the root, tapering from its base to its tip. */
function traceRoot(ctx: CanvasRenderingContext2D, root: RootStroke): void {
  const line = smoothRoot(root.points);
  const last = line.length - 1;
  const left: IconPoint[] = [];
  const right: IconPoint[] = [];
  line.forEach((point, index) => {
    const before = line[Math.max(0, index - 1)];
    const after = line[Math.min(last, index + 1)];
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.hypot(dx, dy);
    const nx = length === 0 ? 0 : -dy / length;
    const ny = length === 0 ? 0 : dx / length;
    const along = index / last;
    const halfWidth = root.baseHalfWidth + (root.tipHalfWidth - root.baseHalfWidth) * along;
    left.push([point[0] + nx * halfWidth, point[1] + ny * halfWidth]);
    right.push([point[0] - nx * halfWidth, point[1] - ny * halfWidth]);
  });
  tracePoints(ctx, [...left, ...right.reverse()]);
}

function paintRoots(ctx: CanvasRenderingContext2D, px: number, roots: readonly RootStroke[]): void {
  const fill = litFill(ctx, ROOT, ROOT_LIGHT_FROM, ROOT_LIGHT_TO);
  for (const root of roots) paintForm(ctx, px, () => traceRoot(ctx, root), fill);
}

function paintSeal(ctx: CanvasRenderingContext2D, px: number): void {
  for (const tail of RIBBON_TAILS) {
    paintForm(ctx, px, () => tracePoints(ctx, tail), RIBBON);
  }
  ctx.beginPath();
  for (let lump = 0; lump < SEAL_LUMPS; lump++) {
    const angle = (lump / SEAL_LUMPS) * FULL_TURN;
    const lx = SEAL_CX + Math.cos(angle) * SEAL_R;
    const ly = SEAL_CY + Math.sin(angle) * SEAL_R;
    ctx.moveTo(lx + SEAL_LUMP_R, ly);
    ctx.arc(lx, ly, SEAL_LUMP_R, 0, FULL_TURN);
  }
  ctx.moveTo(SEAL_CX + SEAL_R, SEAL_CY);
  ctx.arc(SEAL_CX, SEAL_CY, SEAL_R, 0, FULL_TURN);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = outlineWidth(px) * 2;
  ctx.stroke();
  const sealFill = litFill(
    ctx,
    WAX,
    [SEAL_CX - SEAL_R, SEAL_CY - SEAL_R],
    [SEAL_CX + SEAL_R, SEAL_CY + SEAL_R],
  );
  ctx.fillStyle = sealFill;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(SEAL_CX, SEAL_CY, SEAL_STAMP_R, 0, FULL_TURN);
  ctx.strokeStyle = tone(WAX, SEAL_STAMP_TONE);
  ctx.lineWidth = hairlineWidth(px) * MEDIUM_DETAIL;
  ctx.stroke();
  disc(
    ctx,
    SEAL_CX - SEAL_STAMP_R / 2,
    SEAL_CY - SEAL_STAMP_R / 2,
    SEAL_LUMP_R / 2,
    tone(WAX, SEAL_SHINE_TONE),
  );
}

/** Scroll of Entanglement: a parchment open between two rolls, roots inked on it and roots creeping off its edges. */
export function drawEntanglementScrollIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  paintIconArt(ctx, rect, (art, px) => {
    paintRoots(art, px, ESCAPING_ROOTS);
    paintForm(
      art,
      px,
      () => tracePoints(art, SHEET),
      bandedFill(art, SHEET_LIGHT_FROM, SHEET_LIGHT_TO, [
        [tone(PARCHMENT, SHEET_LIGHT_TONE), SHEET_LIGHT_UNTIL],
        [PARCHMENT, SHEET_MID_UNTIL],
        [tone(PARCHMENT, SHEET_SHADE_TONE), 1],
      ]),
    );
    withShapeClip(
      art,
      () => tracePoints(art, SHEET),
      () => {
        art.fillStyle = ROLL_SHADOW;
        art.fillRect(0, ROLL_SHADOW_TOP, 1, ROLL_SHADOW_HEIGHT);
      },
    );
    paintRoots(art, px, SHEET_ROOTS);
    for (const hair of ROOTLETS) strokeDetail(art, px, hair, ROOTLET, MEDIUM_DETAIL);
    for (const line of INK_LINES) strokeDetail(art, px, line, INK, MEDIUM_DETAIL);
    paintRoll(art, px, BOTTOM_ROLL);
    paintRoll(art, px, TOP_ROLL);
    paintSeal(art, px);
    glint(art, GLINT_X, GLINT_Y, GLINT_R);
  });
}
