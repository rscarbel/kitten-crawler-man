import type { Rect } from '../../../ui/core/geom';
import {
  bandedFill,
  BOLD_DETAIL,
  glint,
  ICON_CENTER,
  MEDIUM_DETAIL,
  hairlineWidth,
  ICON_OUTLINE,
  litFill,
  offsetShade,
  paintForm,
  paintIconArt,
  rivet,
  strokeDetail,
  tone,
  traceEllipse,
  tracePoints,
  withShapeClip,
  type IconPoint,
} from './iconPaint';

/**
 * Icons for the garrison's four issue-kit armour pieces.
 *
 * One shared palette rather than four: the pieces are a matched set the player buys
 * over the same counter, so what tells them apart at inventory-slot size has to
 * be the silhouette, not the colour.
 */

/** The four ids this module can draw. Closed, so a new piece cannot ship iconless. */
export type IssueKitItemId =
  'issue_kettle_helm' | 'padded_gambeson' | 'riveted_bracers' | 'marching_boots';

const IRON = '#868c95';
const LEATHER = '#7a5230';
const LINEN = '#cdbb8e';
const BRASS = '#c9a24a';
const SOLE = '#3a2a1f';
const NAIL = '#cfd3d8';

/** Standard lift and drop for a form's lit rim and shaded side. */
const LIGHT = 0.3;
const SHADE = -0.34;
const DEEP_SHADE = -0.6;
const LIGHT_BAND_UNTIL = 0.3;
const SHADE_BAND_UNTIL = 0.7;
/** The second of a pair sits behind the first, a step darker so the two never merge. */
const BEHIND_TONE = -0.22;

/** Kettle helm: a wide sloped brim with a riveted dome standing on it. */
const BRIM_CX = 0.5;
const BRIM_CY = 0.6;
const BRIM_RX = 0.45;
const BRIM_RY = 0.15;
/** The brim's underside shows as a dark lip this far below its top face. */
const BRIM_LIP = 0.035;
const DOME_LEFT = 0.22;
const DOME_RIGHT = 0.78;
const DOME_TOP = 0.2;
const DOME_BASE = 0.6;
const DOME_BASE_RY = 0.075;
const DOME_SHOULDER_RISE = 0.28;
const DOME_LIT_SHIFT: readonly [number, number] = [0.05, 0.04];
const DOME_SHADE_SHIFT: readonly [number, number] = [0.16, 0.06];
const HELM_BAND_HEIGHT = 0.07;
const HELM_RIVET_XS = [0.32, 0.44, 0.56, 0.68] as const;
const HELM_RIVET_R = 0.022;
const HELM_RIVET_Y = 0.6;
/** "Somebody else's dent": a dent is shaded on the side facing the light and lit on the far side. */
const DENT_CX = 0.6;
const DENT_CY = 0.36;
const DENT_RX = 0.065;
const DENT_RY = 0.05;
const DENT_LIT_SHIFT = 0.025;
const HELM_GLINT: readonly [number, number] = [0.34, 0.31];
const HELM_GLINT_R = 0.06;
const CHIN_STRAP: readonly IconPoint[] = [
  [0.34, 0.68],
  [0.4, 0.9, 0.06],
  [0.6, 0.9, 0.06],
  [0.66, 0.68],
];
const CHIN_STRAP_WIDTH_SCALE = 3.2;
const CHIN_STRAP_EDGE_SCALE = 5;

/** Gambeson: a long-sleeved quilted jacket, front-on. */
const GAMBESON: readonly IconPoint[] = [
  [0.4, 0.12],
  [0.25, 0.17, 0.05],
  [0.07, 0.66, 0.02],
  [0.21, 0.71, 0.02],
  [0.28, 0.42],
  [0.27, 0.9, 0.03],
  [0.73, 0.9, 0.03],
  [0.72, 0.42],
  [0.79, 0.71, 0.02],
  [0.93, 0.66, 0.02],
  [0.75, 0.17, 0.05],
  [0.6, 0.12],
];
const GAMBESON_LIGHT_FROM: readonly [number, number] = [0.1, 0.1];
const GAMBESON_LIGHT_TO: readonly [number, number] = [0.9, 0.9];
const COLLAR: readonly IconPoint[] = [
  [0.38, 0.07, 0.02],
  [0.62, 0.07, 0.02],
  [0.6, 0.18],
  [0.5, 0.22],
  [0.4, 0.18],
];
/** The quilting runs in vertical channels; each channel puffs, lit on its left and shaded against the next stitch. */
const QUILT_STITCH_XS = [0.36, 0.43, 0.57, 0.64] as const;
const QUILT_TOP = 0.2;
const QUILT_BOTTOM = 0.9;
const QUILT_CHANNEL_SHADE_WIDTH = 0.025;
const SLEEVE_QUILTS: readonly (readonly IconPoint[])[] = [
  [
    [0.17, 0.36],
    [0.26, 0.38],
  ],
  [
    [0.12, 0.5],
    [0.24, 0.54],
  ],
  [
    [0.83, 0.36],
    [0.74, 0.38],
  ],
  [
    [0.88, 0.5],
    [0.76, 0.54],
  ],
];
const FRONT_OPENING: readonly IconPoint[] = [
  [0.5, 0.22],
  [0.5, 0.9],
];
const TOGGLE_YS = [0.34, 0.5, 0.66, 0.8] as const;
const TOGGLE_HALF = 0.045;
const TOGGLE_WIDTH_SCALE = 2.6;

/**
 * Bracer: one tapered leather vambrace, painted upright and then leaned so the
 * elbow end sits up-right. It is wrapped, not tubed — the laced seam shows the
 * suede lining between its edges, and the suede shows again inside the open
 * elbow end, which is what keeps it from reading as a pipe.
 */
const BRACER_CX = 0.5;
const BRACER_TOP = 0.1;
const BRACER_BOTTOM = 0.9;
const BRACER_HALF_TOP = 0.23;
const BRACER_HALF_BOTTOM = 0.1;
const BRACER_TOP_RIM_RY = 0.07;
const BRACER_BOTTOM_RIM_RY = 0.04;
const BRACER_TILT = 0.55;
const BRACER_SCALE = 1;
const SUEDE = '#d2b08a';
const LACE = '#2a190e';
/** The seam runs down the bracer at this fraction across its face, 1 being its right edge. */
const SEAM_POSITION = 0.5;
const SEAM_HALF_GAP = 0.02;
/** Three bold laces cross the seam: few enough that each one reads at slot size. */
const SEAM_LACE_FRACTIONS = [0.25, 0.5, 0.75] as const;
/** Each lace reaches this far past the gap on either side, onto the leather it pulls together. */
const LACE_OVERREACH = 0.12;
const LACE_WIDTH_SCALE = 3;
const WRIST_INSIDE = '#24160c';
/** The opening's near rim throws a shadow across the suede just inside it. */
const OPENING_SHADOW_RISE = 0.035;
const SPLINT_POSITION = -0.35;
const SPLINT_HALF_FRACTION = 0.14;
const SPLINT_INSET = 0.09;
/** A splint is a narrow polished strip: most of its face lit, a thin shaded edge. */
const SPLINT_LIGHT = 0.6;
const SPLINT_LIT_UNTIL = 0.6;
/** At least two screen pixels across at hotbar size. */
const BRACER_RIVET_R = 0.036;
const HEM_RIVET_POSITIONS = [-0.75, 0.05] as const;
const BRACER_HEM_INSET = 0.06;
const BRACER_HEM_WIDTH_SCALE = 3;

/** Boots: a tall marching boot in profile, toe to the right, with its partner behind it. */
const BOOT: readonly IconPoint[] = [
  [0.14, 0.08],
  [0.42, 0.08],
  [0.43, 0.52, 0.06],
  [0.66, 0.64, 0.06],
  [0.76, 0.74, 0.06],
  [0.76, 0.84, 0.03],
  [0.15, 0.84, 0.02],
  [0.16, 0.5],
];
const BOOT_SOLE: readonly IconPoint[] = [
  [0.13, 0.82],
  [0.77, 0.82, 0.03],
  [0.77, 0.89, 0.02],
  [0.42, 0.89],
  [0.4, 0.86],
  [0.28, 0.86],
  [0.27, 0.92],
  [0.13, 0.92, 0.01],
];
const BOOT_CUFF: readonly IconPoint[] = [
  [0.12, 0.06, 0.01],
  [0.44, 0.06, 0.01],
  [0.43, 0.17],
  [0.14, 0.17],
];
const BOOT_TOE_CAP: readonly IconPoint[] = [
  [0.6, 0.62],
  [0.56, 0.7, 0.03],
  [0.58, 0.82],
];
const BOOT_STRAP_YS = [0.3, 0.44] as const;
const BOOT_STRAP_LEFT = 0.15;
const BOOT_STRAP_RIGHT = 0.43;
const BOOT_STRAP_HEIGHT = 0.045;
const BOOT_BUCKLE_X = 0.36;
const BOOT_BUCKLE_HALF = 0.03;
const BOOT_NAIL_XS = [0.2, 0.48, 0.58, 0.68] as const;
const BOOT_NAIL_Y = 0.875;
const BOOT_NAIL_R = 0.016;
const BOOT_LIGHT_FROM: readonly [number, number] = [0.14, 0];
const BOOT_LIGHT_TO: readonly [number, number] = [0.6, 0];
const BOOT_BACK_SHIFT: readonly [number, number] = [0.18, -0.04];
const BOOT_FRONT_SHIFT: readonly [number, number] = [0.02, 0.04];

/** Draws one piece of issue kit into the largest square centred in `rect`. */
export function drawIssueKitIcon(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  id: IssueKitItemId,
): void {
  paintIconArt(ctx, rect, (art, px) => {
    switch (id) {
      case 'issue_kettle_helm':
        paintKettleHelm(art, px);
        return;
      case 'padded_gambeson':
        paintGambeson(art, px);
        return;
      case 'riveted_bracers':
        paintBracers(art, px);
        return;
      case 'marching_boots':
        paintMarchingBoots(art, px);
        return;
    }
  });
}

function traceDome(ctx: CanvasRenderingContext2D, dx: number, dy: number): void {
  const cx = (DOME_LEFT + DOME_RIGHT) / 2 + dx;
  const left = DOME_LEFT + dx;
  const right = DOME_RIGHT + dx;
  const base = DOME_BASE + dy;
  ctx.beginPath();
  ctx.moveTo(left, base);
  ctx.bezierCurveTo(
    left,
    base - DOME_SHOULDER_RISE,
    cx - (cx - left) / 2,
    DOME_TOP + dy,
    cx,
    DOME_TOP + dy,
  );
  ctx.bezierCurveTo(
    cx + (right - cx) / 2,
    DOME_TOP + dy,
    right,
    base - DOME_SHOULDER_RISE,
    right,
    base,
  );
  ctx.ellipse(cx, base, (right - left) / 2, DOME_BASE_RY, 0, 0, Math.PI);
  ctx.closePath();
}

function paintKettleHelm(ctx: CanvasRenderingContext2D, px: number): void {
  strokeDetail(ctx, px, CHIN_STRAP, ICON_OUTLINE, CHIN_STRAP_EDGE_SCALE);
  strokeDetail(ctx, px, CHIN_STRAP, LEATHER, CHIN_STRAP_WIDTH_SCALE);

  paintForm(
    ctx,
    px,
    () => traceEllipse(ctx, BRIM_CX, BRIM_CY + BRIM_LIP, BRIM_RX, BRIM_RY),
    tone(IRON, DEEP_SHADE),
  );
  traceEllipse(ctx, BRIM_CX, BRIM_CY, BRIM_RX, BRIM_RY);
  ctx.fillStyle = litFill(
    ctx,
    IRON,
    [BRIM_CX - BRIM_RX, BRIM_CY - BRIM_RY],
    [BRIM_CX + BRIM_RX, BRIM_CY + BRIM_RY],
  );
  ctx.fill();

  paintForm(ctx, px, () => traceDome(ctx, 0, 0), tone(IRON, LIGHT));
  offsetShade(ctx, (dx, dy) => traceDome(ctx, dx, dy), [
    [IRON, DOME_LIT_SHIFT[0], DOME_LIT_SHIFT[1]],
    [tone(IRON, SHADE), DOME_SHADE_SHIFT[0], DOME_SHADE_SHIFT[1]],
  ]);

  withShapeClip(
    ctx,
    () => traceDome(ctx, 0, 0),
    () => {
      ctx.fillStyle = bandedFill(
        ctx,
        [DOME_LEFT, 0],
        [DOME_RIGHT, 0],
        [
          [tone(IRON, LIGHT / 2), LIGHT_BAND_UNTIL],
          [tone(IRON, SHADE / 2), SHADE_BAND_UNTIL],
          [tone(IRON, DEEP_SHADE), 1],
        ],
      );
      ctx.fillRect(
        DOME_LEFT,
        DOME_BASE - HELM_BAND_HEIGHT,
        DOME_RIGHT - DOME_LEFT,
        HELM_BAND_HEIGHT * 2,
      );
      strokeDetail(
        ctx,
        px,
        [
          [DOME_LEFT, DOME_BASE - HELM_BAND_HEIGHT],
          [DOME_RIGHT, DOME_BASE - HELM_BAND_HEIGHT],
        ],
        ICON_OUTLINE,
      );

      traceEllipse(ctx, DENT_CX, DENT_CY, DENT_RX, DENT_RY);
      ctx.fillStyle = tone(IRON, SHADE);
      ctx.fill();
      traceEllipse(
        ctx,
        DENT_CX + DENT_LIT_SHIFT,
        DENT_CY + DENT_LIT_SHIFT,
        DENT_RX - DENT_LIT_SHIFT,
        DENT_RY - DENT_LIT_SHIFT / 2,
      );
      ctx.fillStyle = tone(IRON, LIGHT);
      ctx.fill();
    },
  );
  for (const rivetX of HELM_RIVET_XS)
    rivet(ctx, px, rivetX, HELM_RIVET_Y, HELM_RIVET_R, tone(IRON, LIGHT));
  glint(ctx, HELM_GLINT[0], HELM_GLINT[1], HELM_GLINT_R);
}

function paintGambeson(ctx: CanvasRenderingContext2D, px: number): void {
  const trace = (): void => tracePoints(ctx, GAMBESON);
  paintForm(ctx, px, trace, litFill(ctx, LINEN, GAMBESON_LIGHT_FROM, GAMBESON_LIGHT_TO));
  const seam = tone(LINEN, DEEP_SHADE);
  withShapeClip(ctx, trace, () => {
    ctx.fillStyle = tone(LINEN, SHADE);
    for (const stitchX of QUILT_STITCH_XS) {
      ctx.fillRect(
        stitchX - QUILT_CHANNEL_SHADE_WIDTH,
        QUILT_TOP,
        QUILT_CHANNEL_SHADE_WIDTH,
        QUILT_BOTTOM - QUILT_TOP,
      );
    }
    for (const stitchX of QUILT_STITCH_XS) {
      strokeDetail(
        ctx,
        px,
        [
          [stitchX, QUILT_TOP],
          [stitchX, QUILT_BOTTOM],
        ],
        seam,
      );
    }
    for (const quilt of SLEEVE_QUILTS) strokeDetail(ctx, px, quilt, seam);
  });
  strokeDetail(ctx, px, FRONT_OPENING, ICON_OUTLINE, BOLD_DETAIL);
  for (const toggleY of TOGGLE_YS) {
    strokeDetail(
      ctx,
      px,
      [
        [ICON_CENTER - TOGGLE_HALF, toggleY],
        [ICON_CENTER + TOGGLE_HALF, toggleY],
      ],
      LEATHER,
      TOGGLE_WIDTH_SCALE,
    );
  }
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, COLLAR),
    litFill(
      ctx,
      tone(LINEN, SHADE / 2),
      [COLLAR[0][0], COLLAR[0][1]],
      [COLLAR[1][0], COLLAR[3][1]],
    ),
  );
}

/** The bracer's half-width `t` of the way from elbow to wrist. */
function bracerHalfAt(t: number): number {
  return BRACER_HALF_TOP + (BRACER_HALF_BOTTOM - BRACER_HALF_TOP) * t;
}

function bracerYAt(t: number): number {
  return BRACER_TOP + (BRACER_BOTTOM - BRACER_TOP) * t;
}

/** A point on the bracer's face, `position` across it (-1 left edge, 1 right) and `t` down it. */
function bracerPoint(position: number, t: number): IconPoint {
  return [BRACER_CX + bracerHalfAt(t) * position, bracerYAt(t)];
}

function traceBracer(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(BRACER_CX - BRACER_HALF_TOP, BRACER_TOP);
  ctx.lineTo(BRACER_CX - BRACER_HALF_BOTTOM, BRACER_BOTTOM);
  ctx.ellipse(
    BRACER_CX,
    BRACER_BOTTOM,
    BRACER_HALF_BOTTOM,
    BRACER_BOTTOM_RIM_RY,
    0,
    Math.PI,
    0,
    true,
  );
  ctx.lineTo(BRACER_CX + BRACER_HALF_TOP, BRACER_TOP);
  ctx.ellipse(BRACER_CX, BRACER_TOP, BRACER_HALF_TOP, BRACER_TOP_RIM_RY, 0, 0, Math.PI, false);
  ctx.closePath();
}

function paintBracerSeam(ctx: CanvasRenderingContext2D, px: number): void {
  const left = SEAM_POSITION - SEAM_HALF_GAP / BRACER_HALF_BOTTOM;
  const right = SEAM_POSITION + SEAM_HALF_GAP / BRACER_HALF_BOTTOM;
  paintForm(
    ctx,
    px,
    () =>
      tracePoints(ctx, [
        bracerPoint(left, 0),
        bracerPoint(right, 0),
        bracerPoint(right, 1),
        bracerPoint(left, 1),
      ]),
    tone(SUEDE, SHADE / 2),
  );
  for (const t of SEAM_LACE_FRACTIONS) {
    strokeDetail(
      ctx,
      px,
      [bracerPoint(left - LACE_OVERREACH, t), bracerPoint(right + LACE_OVERREACH, t)],
      LACE,
      LACE_WIDTH_SCALE,
    );
  }
}

function paintBracers(ctx: CanvasRenderingContext2D, px: number): void {
  const cy = (BRACER_TOP + BRACER_BOTTOM) / 2;
  ctx.save();
  ctx.translate(BRACER_CX, cy);
  ctx.rotate(BRACER_TILT);
  ctx.scale(BRACER_SCALE, BRACER_SCALE);
  ctx.translate(-BRACER_CX, -cy);
  const unitPx = px / BRACER_SCALE;

  paintForm(
    ctx,
    unitPx,
    () => traceBracer(ctx),
    bandedFill(
      ctx,
      [BRACER_CX - BRACER_HALF_TOP, 0],
      [BRACER_CX + BRACER_HALF_TOP, 0],
      [
        [tone(LEATHER, LIGHT), LIGHT_BAND_UNTIL],
        [LEATHER, SHADE_BAND_UNTIL],
        [tone(LEATHER, SHADE), 1],
      ],
    ),
  );
  withShapeClip(
    ctx,
    () => traceBracer(ctx),
    () => {
      for (const [hemY, half, rimRy] of [
        [BRACER_TOP + BRACER_HEM_INSET, BRACER_HALF_TOP, BRACER_TOP_RIM_RY],
        [BRACER_BOTTOM - BRACER_HEM_INSET, BRACER_HALF_BOTTOM, BRACER_BOTTOM_RIM_RY],
      ] as const) {
        ctx.beginPath();
        ctx.ellipse(BRACER_CX, hemY, half, rimRy, 0, 0, Math.PI);
        ctx.strokeStyle = tone(LEATHER, SHADE);
        ctx.lineWidth = hairlineWidth(unitPx) * BRACER_HEM_WIDTH_SCALE;
        ctx.stroke();
      }
      paintBracerSeam(ctx, unitPx);
    },
  );

  paintForm(
    ctx,
    unitPx,
    () => traceEllipse(ctx, BRACER_CX, BRACER_TOP, BRACER_HALF_TOP, BRACER_TOP_RIM_RY),
    SUEDE,
  );
  withShapeClip(
    ctx,
    () => traceEllipse(ctx, BRACER_CX, BRACER_TOP, BRACER_HALF_TOP, BRACER_TOP_RIM_RY),
    () => {
      traceEllipse(
        ctx,
        BRACER_CX,
        BRACER_TOP + BRACER_TOP_RIM_RY * 2 - OPENING_SHADOW_RISE,
        BRACER_HALF_TOP,
        BRACER_TOP_RIM_RY,
      );
      ctx.fillStyle = tone(SUEDE, DEEP_SHADE);
      ctx.fill();
    },
  );

  paintForm(
    ctx,
    unitPx,
    () => traceEllipse(ctx, BRACER_CX, BRACER_BOTTOM, BRACER_HALF_BOTTOM, BRACER_BOTTOM_RIM_RY),
    WRIST_INSIDE,
  );
  ctx.beginPath();
  ctx.ellipse(BRACER_CX, BRACER_BOTTOM, BRACER_HALF_BOTTOM, BRACER_BOTTOM_RIM_RY, 0, Math.PI, 0);
  ctx.strokeStyle = SUEDE;
  ctx.lineWidth = hairlineWidth(unitPx) * BOLD_DETAIL;
  ctx.stroke();

  const splintTop = bracerPoint(SPLINT_POSITION, SPLINT_INSET / (BRACER_BOTTOM - BRACER_TOP));
  const splintBottom = bracerPoint(
    SPLINT_POSITION,
    1 - SPLINT_INSET / (BRACER_BOTTOM - BRACER_TOP),
  );
  const topHalf = BRACER_HALF_TOP * SPLINT_HALF_FRACTION;
  const bottomHalf = BRACER_HALF_BOTTOM * SPLINT_HALF_FRACTION;
  paintForm(
    ctx,
    unitPx,
    () =>
      tracePoints(ctx, [
        [splintTop[0] - topHalf, splintTop[1]],
        [splintTop[0] + topHalf, splintTop[1]],
        [splintBottom[0] + bottomHalf, splintBottom[1]],
        [splintBottom[0] - bottomHalf, splintBottom[1]],
      ]),
    bandedFill(
      ctx,
      [splintTop[0] - topHalf, 0],
      [splintTop[0] + topHalf, 0],
      [
        [tone(IRON, SPLINT_LIGHT), SPLINT_LIT_UNTIL],
        [tone(IRON, SHADE), 1],
      ],
    ),
  );
  for (const position of HEM_RIVET_POSITIONS) {
    const top = bracerPoint(position, (BRACER_HEM_INSET * 2) / (BRACER_BOTTOM - BRACER_TOP));
    const bottom = bracerPoint(position, 1 - (BRACER_HEM_INSET * 2) / (BRACER_BOTTOM - BRACER_TOP));
    rivet(ctx, unitPx, top[0], top[1], BRACER_RIVET_R, BRASS);
    rivet(ctx, unitPx, bottom[0], bottom[1], BRACER_RIVET_R, BRASS);
  }
  ctx.restore();
}

function paintBoot(ctx: CanvasRenderingContext2D, px: number, darken: number): void {
  const leather = tone(LEATHER, darken);
  paintForm(ctx, px, () => tracePoints(ctx, BOOT_SOLE), tone(SOLE, darken));
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, BOOT),
    bandedFill(ctx, BOOT_LIGHT_FROM, BOOT_LIGHT_TO, [
      [tone(leather, LIGHT), LIGHT_BAND_UNTIL],
      [leather, SHADE_BAND_UNTIL],
      [tone(leather, SHADE), 1],
    ]),
  );
  strokeDetail(ctx, px, BOOT_TOE_CAP, tone(leather, DEEP_SHADE), MEDIUM_DETAIL);
  for (const strapY of BOOT_STRAP_YS) {
    paintForm(
      ctx,
      px,
      () =>
        tracePoints(ctx, [
          [BOOT_STRAP_LEFT, strapY],
          [BOOT_STRAP_RIGHT, strapY],
          [BOOT_STRAP_RIGHT, strapY + BOOT_STRAP_HEIGHT],
          [BOOT_STRAP_LEFT, strapY + BOOT_STRAP_HEIGHT],
        ]),
      tone(leather, SHADE),
    );
    paintForm(
      ctx,
      px,
      () =>
        tracePoints(ctx, [
          [BOOT_BUCKLE_X - BOOT_BUCKLE_HALF, strapY - BOOT_BUCKLE_HALF / 2],
          [BOOT_BUCKLE_X + BOOT_BUCKLE_HALF, strapY - BOOT_BUCKLE_HALF / 2],
          [BOOT_BUCKLE_X + BOOT_BUCKLE_HALF, strapY + BOOT_STRAP_HEIGHT + BOOT_BUCKLE_HALF / 2],
          [BOOT_BUCKLE_X - BOOT_BUCKLE_HALF, strapY + BOOT_STRAP_HEIGHT + BOOT_BUCKLE_HALF / 2],
        ]),
      tone(BRASS, darken),
    );
  }
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, BOOT_CUFF),
    litFill(
      ctx,
      tone(leather, LIGHT / 2),
      [BOOT_CUFF[0][0], BOOT_CUFF[0][1]],
      [BOOT_CUFF[1][0], BOOT_CUFF[2][1]],
    ),
  );
  for (const nailX of BOOT_NAIL_XS) {
    traceEllipse(ctx, nailX, BOOT_NAIL_Y, BOOT_NAIL_R, BOOT_NAIL_R);
    ctx.fillStyle = tone(NAIL, darken);
    ctx.fill();
  }
}

function paintMarchingBoots(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.save();
  ctx.translate(BOOT_BACK_SHIFT[0], BOOT_BACK_SHIFT[1]);
  paintBoot(ctx, px, BEHIND_TONE);
  ctx.restore();
  ctx.save();
  ctx.translate(BOOT_FRONT_SHIFT[0], BOOT_FRONT_SHIFT[1]);
  paintBoot(ctx, px, 0);
  ctx.restore();
}
