/**
 * Service icons for the counters that patch a crawler up: the apothecary's
 * antidote, the temple's blessing and the infirmary.
 */

import {
  bandedFill,
  FULL_TURN,
  glint,
  ICON_OUTLINE,
  litFill,
  paintForm,
  rivet,
  strokeDetail,
  tone,
  traceEllipse,
  tracePoints,
  withShapeClip,
  type IconArtPainter,
  type IconPoint,
} from './iconPaint';
import {
  GOLD,
  HALF_LIGHT,
  LIGHT,
  LINEN,
  paintGlow,
  paintLitPoints,
  paintLitRect,
  rectPoints,
  SHADE,
  DEEP_SHADE,
  toIcon,
  traceCurvePath,
  type CurveSegment,
  type Vec,
} from './serviceIconKit';

const GLASS = '#bfd6d8';
const TINCTURE = '#8fa82c';
const TINCTURE_LIT_UNTIL = 0.3;
const TINCTURE_MID_UNTIL = 0.68;
/** A leaf is lit above its midrib and shaded below it; the vein runs most of its length. */
const LEAF_MIDRIB = 0.5;
const LEAF_VEIN_REACH = 0.8;
const CORK = '#a8784a';
const HERB = '#4f8a3a';
const TWINE = '#c9a874';

/** Fen's vial: a tall round-shouldered bottle, a sprig of herb tied to its neck. */
const VIAL = {
  left: 0.27,
  right: 0.63,
  top: 0.34,
  bottom: 0.9,
  corner: 0.12,
  neckLeft: 0.38,
  neckRight: 0.52,
  neckTop: 0.18,
  lipHalf: 0.09,
  lipHeight: 0.05,
  corkTop: 0.06,
  corkHalf: 0.065,
  corkCorner: 0.022,
  liquidTop: 0.5,
  inset: 0.035,
  shineX: 0.34,
  shineTop: 0.42,
  shineBottom: 0.78,
  glint: [0.36, 0.4],
  glintR: 0.05,
  twineY: 0.27,
} as const;
const SHINE_WIDTH = 3;
const BUBBLE_R = 0.018;
const BUBBLES: readonly (readonly [number, number])[] = [
  [0.5, 0.62],
  [0.42, 0.74],
  [0.54, 0.8],
];
const SPRIG_STEM: readonly IconPoint[] = [
  [0.52, 0.27],
  [0.72, 0.4, 0.1],
  [0.84, 0.66],
];
const SPRIG_STEM_WIDTH = 2;
/** Each leaf: centre, half-length, half-width, angle. */
const SPRIG_LEAVES: readonly (readonly [number, number, number, number, number])[] = [
  [0.7, 0.3, 0.08, 0.035, -0.5],
  [0.8, 0.42, 0.08, 0.035, 0.4],
  [0.7, 0.5, 0.075, 0.03, -0.9],
  [0.88, 0.58, 0.07, 0.03, 0.9],
  [0.78, 0.68, 0.065, 0.028, -1.2],
];

function paintLeaf(
  ctx: CanvasRenderingContext2D,
  px: number,
  [cx, cy, rx, ry, angle]: readonly [number, number, number, number, number],
  color: string,
): void {
  const trace = (): void => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, angle, 0, FULL_TURN);
  };
  const veinReach = rx * LEAF_VEIN_REACH;
  paintForm(
    ctx,
    px,
    trace,
    bandedFill(
      ctx,
      [cx, cy - ry],
      [cx, cy + ry],
      [
        [tone(color, LIGHT), LEAF_MIDRIB],
        [tone(color, SHADE), 1],
      ],
    ),
  );
  strokeDetail(
    ctx,
    px,
    [
      [cx - Math.cos(angle) * veinReach, cy - Math.sin(angle) * veinReach],
      [cx + Math.cos(angle) * veinReach, cy + Math.sin(angle) * veinReach],
    ],
    tone(color, DEEP_SHADE),
  );
}

const paintAntidote: IconArtPainter = (ctx, px) => {
  const body = rectPoints(VIAL.left, VIAL.top, VIAL.right, VIAL.bottom, VIAL.corner);
  const traceBottle = (): void => {
    tracePoints(ctx, body);
    ctx.rect(
      VIAL.neckLeft,
      VIAL.neckTop,
      VIAL.neckRight - VIAL.neckLeft,
      VIAL.top + VIAL.corner - VIAL.neckTop,
    );
  };
  paintForm(ctx, px, traceBottle, litFill(ctx, GLASS, [VIAL.left, 0], [VIAL.right, 0]));
  withShapeClip(
    ctx,
    () => tracePoints(ctx, body),
    () => {
      ctx.fillStyle = bandedFill(
        ctx,
        [VIAL.left, 0],
        [VIAL.right, 0],
        [
          [tone(TINCTURE, LIGHT), TINCTURE_LIT_UNTIL],
          [TINCTURE, TINCTURE_MID_UNTIL],
          [tone(TINCTURE, SHADE), 1],
        ],
      );
      ctx.fillRect(VIAL.left, VIAL.liquidTop, VIAL.right - VIAL.left, VIAL.bottom - VIAL.liquidTop);
      strokeDetail(
        ctx,
        px,
        [
          [VIAL.left, VIAL.liquidTop],
          [VIAL.right, VIAL.liquidTop],
        ],
        tone(TINCTURE, LIGHT * 2),
        SHINE_WIDTH / 2,
      );
      for (const [bx, by] of BUBBLES) {
        traceEllipse(ctx, bx, by, BUBBLE_R, BUBBLE_R);
        ctx.fillStyle = tone(TINCTURE, LIGHT * 2);
        ctx.fill();
      }
    },
  );
  strokeDetail(
    ctx,
    px,
    [
      [VIAL.shineX, VIAL.shineTop],
      [VIAL.shineX, VIAL.shineBottom],
    ],
    tone(GLASS, LIGHT * 2),
    SHINE_WIDTH,
  );
  const neckCx = (VIAL.neckLeft + VIAL.neckRight) / 2;
  paintLitRect(
    ctx,
    px,
    neckCx - VIAL.corkHalf,
    VIAL.corkTop,
    neckCx + VIAL.corkHalf,
    VIAL.neckTop + VIAL.lipHeight,
    CORK,
    VIAL.corkCorner,
  );
  paintLitRect(
    ctx,
    px,
    neckCx - VIAL.lipHalf,
    VIAL.neckTop,
    neckCx + VIAL.lipHalf,
    VIAL.neckTop + VIAL.lipHeight,
    GLASS,
    VIAL.lipHeight / 2,
  );
  strokeDetail(ctx, px, SPRIG_STEM, ICON_OUTLINE, SPRIG_STEM_WIDTH * 2);
  strokeDetail(ctx, px, SPRIG_STEM, tone(HERB, SHADE), SPRIG_STEM_WIDTH);
  for (const leaf of SPRIG_LEAVES) paintLeaf(ctx, px, leaf, HERB);
  strokeDetail(
    ctx,
    px,
    [
      [VIAL.neckLeft, VIAL.twineY],
      [VIAL.neckRight + VIAL.inset, VIAL.twineY - VIAL.inset / 2],
    ],
    TWINE,
    SHINE_WIDTH,
  );
  glint(ctx, VIAL.glint[0], VIAL.glint[1], VIAL.glintR);
};

const HOLY_GOLD = '#f2d27a';
const FEATHER_WHITE = '#f8f4e6';
const RAY_COUNT = 12;
const RAY = { cx: 0.52, cy: 0.44, inner: 0.16, outer: 0.48, halfAngle: 0.1 } as const;
const BLESSING_GLOW_R = 0.36;
/**
 * The feather leans tip up-right. Its vane is two curves meeting at the tip,
 * the far side broader, with one split in the near edge — the notch is what
 * makes it read as a feather and not a leaf.
 */
const FEATHER_VANE_START: Vec = [0.36, 0.8];
/** From the vane's base: up the near edge, into the notch, out to the tip and back down the far edge. */
const FEATHER_VANE_PATH: readonly CurveSegment[] = [
  [0.2, 0.62, 0.36, 0.44],
  [0.44, 0.46],
  [0.42, 0.38],
  [0.54, 0.16, 0.78, 0.08],
  [0.9, 0.36, 0.66, 0.6],
  [0.54, 0.74, 0.42, 0.82],
];
const FEATHER_RACHIS: readonly IconPoint[] = [
  [0.77, 0.1],
  [0.52, 0.48, 0.3],
  [0.28, 0.94],
];
const FEATHER_BARBS: readonly (readonly IconPoint[])[] = [
  [
    [0.66, 0.28],
    [0.8, 0.24],
  ],
  [
    [0.6, 0.38],
    [0.74, 0.4],
  ],
  [
    [0.54, 0.5],
    [0.64, 0.56],
  ],
  [
    [0.58, 0.32],
    [0.5, 0.28],
  ],
  [
    [0.46, 0.56],
    [0.34, 0.56],
  ],
];
const RACHIS_WIDTH = 2.4;
const RACHIS_EDGE = 4.4;
/** The vane's far half sits in a warm shade band; the boundary runs along the shaft. */
const VANE_SHADE_FROM: readonly [number, number] = [0.4, 0.4];
const VANE_SHADE_TO: readonly [number, number] = [0.7, 0.56];
const VANE_LIT_UNTIL = 0.5;
const BLESSING_SPARKLES: readonly (readonly [number, number, number])[] = [
  [0.18, 0.2, 0.07],
  [0.86, 0.7, 0.06],
  [0.16, 0.58, 0.04],
];

const paintBlessing: IconArtPainter = (ctx, px) => {
  paintGlow(ctx, RAY.cx, RAY.cy, BLESSING_GLOW_R, HOLY_GOLD);
  ctx.beginPath();
  for (let ray = 0; ray < RAY_COUNT; ray++) {
    const angle = (ray / RAY_COUNT) * FULL_TURN;
    const before = angle - RAY.halfAngle;
    const after = angle + RAY.halfAngle;
    ctx.moveTo(RAY.cx + Math.cos(before) * RAY.inner, RAY.cy + Math.sin(before) * RAY.inner);
    ctx.lineTo(RAY.cx + Math.cos(angle) * RAY.outer, RAY.cy + Math.sin(angle) * RAY.outer);
    ctx.lineTo(RAY.cx + Math.cos(after) * RAY.inner, RAY.cy + Math.sin(after) * RAY.inner);
    ctx.closePath();
  }
  ctx.fillStyle = HOLY_GOLD;
  ctx.fill();

  const vane = (): void => traceCurvePath(ctx, FEATHER_VANE_START, FEATHER_VANE_PATH);
  paintForm(
    ctx,
    px,
    vane,
    bandedFill(ctx, VANE_SHADE_FROM, VANE_SHADE_TO, [
      [FEATHER_WHITE, VANE_LIT_UNTIL],
      [tone(HOLY_GOLD, HALF_LIGHT), 1],
    ]),
  );
  withShapeClip(ctx, vane, () => {
    for (const barb of FEATHER_BARBS) strokeDetail(ctx, px, barb, tone(HOLY_GOLD, SHADE));
  });
  strokeDetail(ctx, px, FEATHER_RACHIS, ICON_OUTLINE, RACHIS_EDGE);
  strokeDetail(ctx, px, FEATHER_RACHIS, GOLD, RACHIS_WIDTH);
  for (const [sx, sy, r] of BLESSING_SPARKLES) glint(ctx, sx, sy, r, FEATHER_WHITE);
};

const BAG_LEATHER = '#3a2a24';
const BAG_TRIM = '#9a9ea6';
const CROSS_RED = '#c8322a';
/** Gladstone bag: a wide body, a hinged top bar and an arched handle. */
const BAG = {
  left: 0.12,
  right: 0.88,
  top: 0.38,
  bottom: 0.88,
  corner: 0.08,
  jawTop: 0.3,
  jawInset: 0.04,
  jawCorner: 0.027,
  handleLeft: 0.36,
  handleRight: 0.64,
  handleTop: 0.12,
  handleCorner: 0.08,
  claspY: 0.42,
  claspR: 0.035,
  crossCx: 0.5,
  crossCy: 0.64,
  crossArm: 0.15,
  crossHalf: 0.055,
  patchHalf: 0.2,
  patchHalfHeight: 0.19,
} as const;
const HANDLE_WIDTH = 5;
const HANDLE_EDGE = 8;
const STITCH_INSET = 0.04;

function paintCross(
  ctx: CanvasRenderingContext2D,
  px: number,
  cx: number,
  cy: number,
  arm: number,
  half: number,
  color: string,
): void {
  const cross: readonly IconPoint[] = [
    [cx - half, cy - arm],
    [cx + half, cy - arm],
    [cx + half, cy - half],
    [cx + arm, cy - half],
    [cx + arm, cy + half],
    [cx + half, cy + half],
    [cx + half, cy + arm],
    [cx - half, cy + arm],
    [cx - half, cy + half],
    [cx - arm, cy + half],
    [cx - arm, cy - half],
    [cx - half, cy - half],
  ];
  paintLitPoints(ctx, px, cross, color);
}

function paintDoctorsBag(
  ctx: CanvasRenderingContext2D,
  px: number,
  leather: string,
  trim: string,
  cross: string,
): void {
  const handle: readonly IconPoint[] = [
    [BAG.handleLeft, BAG.jawTop],
    [BAG.handleLeft, BAG.handleTop, BAG.handleCorner],
    [BAG.handleRight, BAG.handleTop, BAG.handleCorner],
    [BAG.handleRight, BAG.jawTop],
  ];
  strokeDetail(ctx, px, handle, ICON_OUTLINE, HANDLE_EDGE);
  strokeDetail(ctx, px, handle, tone(leather, LIGHT), HANDLE_WIDTH);
  const body: readonly IconPoint[] = [
    [BAG.left + BAG.jawInset, BAG.top - BAG.jawInset, BAG.corner / 2],
    [BAG.right - BAG.jawInset, BAG.top - BAG.jawInset, BAG.corner / 2],
    [BAG.right, BAG.bottom, BAG.corner],
    [BAG.left, BAG.bottom, BAG.corner],
  ];
  paintLitPoints(ctx, px, body, leather);
  withShapeClip(
    ctx,
    () => tracePoints(ctx, body),
    () => {
      strokeDetail(
        ctx,
        px,
        [
          [BAG.left + STITCH_INSET * 2, BAG.bottom - STITCH_INSET],
          [BAG.right - STITCH_INSET * 2, BAG.bottom - STITCH_INSET],
        ],
        tone(leather, LIGHT * 2),
      );
    },
  );
  paintLitRect(ctx, px, BAG.left, BAG.jawTop, BAG.right, BAG.top, trim, BAG.jawCorner);
  rivet(ctx, px, BAG.crossCx, BAG.claspY - BAG.jawInset, BAG.claspR, trim);
  paintLitRect(
    ctx,
    px,
    BAG.crossCx - BAG.patchHalf,
    BAG.crossCy - BAG.patchHalfHeight,
    BAG.crossCx + BAG.patchHalf,
    BAG.crossCy + BAG.patchHalfHeight,
    LINEN,
    BAG.corner / 2,
  );
  paintCross(ctx, px, BAG.crossCx, BAG.crossCy, BAG.crossArm, BAG.crossHalf, cross);
}

const paintTreatment: IconArtPainter = (ctx, px) => {
  paintDoctorsBag(ctx, px, BAG_LEATHER, BAG_TRIM, CROSS_RED);
};

export const CARE_SERVICE_ICONS = {
  antidote: toIcon(paintAntidote),
  blessing: toIcon(paintBlessing),
  treatment: toIcon(paintTreatment),
} as const;
