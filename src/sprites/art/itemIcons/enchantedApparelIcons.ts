import type { Rect } from '../../../ui/core/geom';
import {
  bandedFill,
  disc,
  FULL_TURN,
  BOLD_DETAIL,
  glint,
  ICON_CENTER,
  ICON_OUTLINE,
  litFill,
  offsetShade,
  paintForm,
  paintIconArt,
  strokeDetail,
  tone,
  tracePoints,
  withShapeClip,
  type IconPoint,
} from './iconPaint';

const LIGHT = 0.3;
const SHADE = -0.3;
const DEEP_SHADE = -0.55;
const LIGHT_BAND_UNTIL = 0.32;
const MID_BAND_UNTIL = 0.7;
const CLOTH_LIGHT_FROM: readonly [number, number] = [0.1, 0.12];
const CLOTH_LIGHT_TO: readonly [number, number] = [0.9, 0.9];

/** BigBoi Boxers: white cotton shorts, ribbed waistband, scattered red hearts. */
const COTTON = '#eceff3';
const HEART_RED = '#e0384a';
const WAISTBAND: readonly IconPoint[] = [
  [0.13, 0.18, 0.02],
  [0.87, 0.18, 0.02],
  [0.88, 0.32],
  [0.12, 0.32],
];
const SHORTS: readonly IconPoint[] = [
  [0.13, 0.3],
  [0.87, 0.3],
  [0.93, 0.8, 0.02],
  [0.56, 0.86, 0.02],
  [0.5, 0.6, 0.04],
  [0.44, 0.86, 0.02],
  [0.07, 0.8, 0.02],
];
const WAISTBAND_RIBS = 9;
const WAISTBAND_RIB_INSET = 0.02;
const FLY: readonly IconPoint[] = [
  [0.5, 0.32],
  [0.5, 0.5],
];
const BOXER_CREASES: readonly (readonly IconPoint[])[] = [
  [
    [0.5, 0.6],
    [0.6, 0.72],
  ],
  [
    [0.5, 0.6],
    [0.4, 0.7],
  ],
];
const HEARTS: readonly (readonly [number, number, number])[] = [
  [0.27, 0.45, 0.07],
  [0.72, 0.42, 0.06],
  [0.22, 0.7, 0.055],
  [0.76, 0.68, 0.07],
  [0.6, 0.53, 0.045],
];
/** A heart's two lobe curves, as fractions of its size about its centre. */
const HEART_NOTCH = -0.3;
const HEART_LOBE_INNER_X = 0.55;
const HEART_LOBE_TOP = -0.95;
const HEART_LOBE_OUTER_X = 1.25;
const HEART_LOBE_OUTER_Y = -0.15;
const HEART_POINT = 0.8;

/** Trollskin shirt: a short-sleeved tunic of mottled green hide with a laced neck. */
const HIDE = '#6f8c55';
const HIDE_MOTTLE = '#4d6a3c';
const SINEW = '#d8c79a';
const SHIRT: readonly IconPoint[] = [
  [0.38, 0.12],
  [0.22, 0.16, 0.05],
  [0.05, 0.38, 0.02],
  [0.17, 0.5, 0.02],
  [0.26, 0.42],
  [0.25, 0.84],
  [0.33, 0.9],
  [0.41, 0.85],
  [0.5, 0.91],
  [0.59, 0.85],
  [0.67, 0.9],
  [0.75, 0.84],
  [0.74, 0.42],
  [0.83, 0.5, 0.02],
  [0.95, 0.38, 0.02],
  [0.78, 0.16, 0.05],
  [0.62, 0.12],
];
const SHIRT_NECK: readonly IconPoint[] = [
  [0.38, 0.12],
  [0.62, 0.12],
  [0.5, 0.36, 0.02],
];
const NECK_LACE_ROWS = [0.18, 0.24, 0.3] as const;
const NECK_LACE_HALF = 0.06;
/** Warts: each a raised lump, catching light on its upper-left and casting a crescent of shade lower-right. */
const WARTS: readonly (readonly [number, number, number])[] = [
  [0.36, 0.5, 0.04],
  [0.62, 0.44, 0.03],
  [0.55, 0.68, 0.045],
  [0.34, 0.75, 0.028],
  [0.16, 0.36, 0.025],
  [0.82, 0.37, 0.025],
];
const WART_LIGHT_SHIFT = 0.014;
/** A wart is a shade lighter than the hide around it, so it reads as a raised lump rather than a pit. */
const WART_TONE = 0.12;
const WART_HIGHLIGHT_FRACTION = 0.33;
const WART_HIGHLIGHT_TONE = 0.6;
const SHIRT_SEAMS: readonly (readonly IconPoint[])[] = [
  [
    [0.26, 0.42],
    [0.27, 0.17],
  ],
  [
    [0.74, 0.42],
    [0.73, 0.17],
  ],
];
const SEAM_STITCHES = 4;
const SEAM_STITCH_HALF = 0.022;
const SHIRT_FOLDS: readonly (readonly IconPoint[])[] = [
  [
    [0.3, 0.5],
    [0.42, 0.62],
  ],
  [
    [0.7, 0.5],
    [0.62, 0.58],
  ],
];

/** Crown of the Sepsis Whore: a bruised-violet crown, its gems weeping green. */
const CROWN_METAL = '#7d4bb5';
const CROWN_INSIDE = '#211033';
const GEM = '#a4e23a';
const OOZE = '#8fd42a';
const CROWN: readonly IconPoint[] = [
  [0.14, 0.7],
  [0.13, 0.28],
  [0.27, 0.46],
  [0.32, 0.2],
  [0.41, 0.44],
  [0.5, 0.1],
  [0.59, 0.44],
  [0.68, 0.2],
  [0.73, 0.46],
  [0.87, 0.28],
  [0.86, 0.7],
];
const CROWN_FRONT_SAG = 0.13;
const CROWN_RIM_CX = 0.5;
const CROWN_RIM_CY = 0.47;
const CROWN_RIM_RX = 0.34;
const CROWN_RIM_RY = 0.07;
const CROWN_BAND_TOP = 0.56;
const CROWN_TIPS: readonly (readonly [number, number])[] = [
  [0.13, 0.28],
  [0.32, 0.2],
  [0.5, 0.1],
  [0.68, 0.2],
  [0.87, 0.28],
];
const CROWN_TIP_R = 0.04;
const CROWN_GEMS: readonly (readonly [number, number, number])[] = [
  [0.5, 0.69, 0.065],
  [0.28, 0.66, 0.045],
  [0.72, 0.66, 0.045],
];
const GEM_SHADE_SHIFT = 0.035;
/** Cabochons are a little wider than tall, seen from just above. */
const GEM_ASPECT = 0.8;
const GEM_GLINT_FRACTION = 0.4;
const OOZE_DRIPS: readonly (readonly IconPoint[])[] = [
  [
    [0.47, 0.74],
    [0.53, 0.74],
    [0.52, 0.86, 0.02],
    [0.48, 0.86, 0.02],
  ],
  [
    [0.26, 0.69],
    [0.3, 0.69],
    [0.295, 0.8, 0.015],
    [0.265, 0.8, 0.015],
  ],
];
const CROWN_GLINT: readonly [number, number] = [0.22, 0.42];
const CROWN_GLINT_R = 0.06;

function traceHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * HEART_NOTCH);
  for (const side of [1, -1]) {
    ctx.bezierCurveTo(
      cx + side * size * HEART_LOBE_INNER_X,
      cy + size * HEART_LOBE_TOP,
      cx + side * size * HEART_LOBE_OUTER_X,
      cy + size * HEART_LOBE_OUTER_Y,
      cx,
      cy + size * HEART_POINT,
    );
    ctx.moveTo(cx, cy + size * HEART_NOTCH);
  }
}

const clothFill = (ctx: CanvasRenderingContext2D, base: string): CanvasGradient =>
  bandedFill(ctx, CLOTH_LIGHT_FROM, CLOTH_LIGHT_TO, [
    [tone(base, LIGHT / 2), LIGHT_BAND_UNTIL],
    [base, MID_BAND_UNTIL],
    [tone(base, SHADE), 1],
  ]);

/** Enchanted BigBoi Boxers. */
export function drawBigBoiBoxersIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  paintIconArt(ctx, rect, (art, px) => {
    const traceShorts = (): void => tracePoints(art, SHORTS);
    paintForm(art, px, traceShorts, clothFill(art, COTTON));
    withShapeClip(art, traceShorts, () => {
      for (const [cx, cy, size] of HEARTS) {
        traceHeart(art, cx, cy, size);
        art.fillStyle = HEART_RED;
        art.fill();
      }
      for (const crease of BOXER_CREASES) strokeDetail(art, px, crease, tone(COTTON, SHADE));
    });
    strokeDetail(art, px, FLY, tone(COTTON, DEEP_SHADE));

    const band = WAISTBAND;
    paintForm(
      art,
      px,
      () => tracePoints(art, band),
      litFill(art, tone(COTTON, SHADE / 2), [band[0][0], band[0][1]], [band[2][0], band[2][1]]),
    );
    const left = band[0][0];
    const right = band[1][0];
    for (let rib = 1; rib < WAISTBAND_RIBS; rib++) {
      const ribX = left + ((right - left) * rib) / WAISTBAND_RIBS;
      strokeDetail(
        art,
        px,
        [
          [ribX, band[0][1] + WAISTBAND_RIB_INSET],
          [ribX, band[2][1] - WAISTBAND_RIB_INSET],
        ],
        tone(COTTON, DEEP_SHADE / 2),
      );
    }
  });
}

/** Enchanted Trollskin Shirt. */
export function drawTrollskinShirtIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  paintIconArt(ctx, rect, (art, px) => {
    const traceShirt = (): void => tracePoints(art, SHIRT);
    paintForm(art, px, traceShirt, clothFill(art, HIDE));
    withShapeClip(art, traceShirt, () => {
      for (const [cx, cy, r] of WARTS) {
        disc(art, cx + WART_LIGHT_SHIFT, cy + WART_LIGHT_SHIFT, r, HIDE_MOTTLE);
        disc(art, cx, cy, r, tone(HIDE, WART_TONE));
        disc(
          art,
          cx - r * WART_HIGHLIGHT_FRACTION,
          cy - r * WART_HIGHLIGHT_FRACTION,
          r * WART_HIGHLIGHT_FRACTION,
          tone(HIDE, WART_HIGHLIGHT_TONE),
        );
      }
      for (const fold of SHIRT_FOLDS) strokeDetail(art, px, fold, tone(HIDE, DEEP_SHADE));
      for (const seam of SHIRT_SEAMS) {
        strokeDetail(art, px, seam, tone(HIDE, DEEP_SHADE));
        const [from, to] = seam;
        for (let stitch = 0; stitch < SEAM_STITCHES; stitch++) {
          const t = (stitch + 1) / (SEAM_STITCHES + 1);
          const sx = from[0] + (to[0] - from[0]) * t;
          const sy = from[1] + (to[1] - from[1]) * t;
          strokeDetail(
            art,
            px,
            [
              [sx - SEAM_STITCH_HALF, sy],
              [sx + SEAM_STITCH_HALF, sy],
            ],
            SINEW,
          );
        }
      }
    });
    paintForm(art, px, () => tracePoints(art, SHIRT_NECK), tone(HIDE, DEEP_SHADE));
    for (const laceY of NECK_LACE_ROWS) {
      strokeDetail(
        art,
        px,
        [
          [ICON_CENTER - NECK_LACE_HALF, laceY],
          [ICON_CENTER + NECK_LACE_HALF, laceY + NECK_LACE_HALF / 2],
        ],
        SINEW,
        BOLD_DETAIL,
      );
    }
  });
}

function traceCrownFront(ctx: CanvasRenderingContext2D, dx: number, dy: number): void {
  ctx.beginPath();
  CROWN.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x + dx, y + dy);
    else ctx.lineTo(x + dx, y + dy);
  });
  const last = CROWN[CROWN.length - 1];
  const first = CROWN[0];
  ctx.quadraticCurveTo(
    CROWN_RIM_CX + dx,
    last[1] + CROWN_FRONT_SAG * 2 + dy,
    first[0] + dx,
    first[1] + dy,
  );
  ctx.closePath();
}

/** Enchanted Crown of the Sepsis Whore. */
export function drawSepsisCrownIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  paintIconArt(ctx, rect, (art, px) => {
    art.beginPath();
    art.ellipse(CROWN_RIM_CX, CROWN_RIM_CY, CROWN_RIM_RX, CROWN_RIM_RY, 0, Math.PI, 0);
    art.closePath();
    art.fillStyle = CROWN_INSIDE;
    art.fill();

    const metalBands = bandedFill(
      art,
      [CROWN[0][0], 0],
      [CROWN[CROWN.length - 1][0], 0],
      [
        [tone(CROWN_METAL, LIGHT), LIGHT_BAND_UNTIL],
        [CROWN_METAL, MID_BAND_UNTIL],
        [tone(CROWN_METAL, SHADE), 1],
      ],
    );
    paintForm(art, px, () => traceCrownFront(art, 0, 0), metalBands);
    offsetShade(art, (dx, dy) => traceCrownFront(art, dx, dy), [
      [tone(CROWN_METAL, DEEP_SHADE), 0, CROWN_BAND_TOP - CROWN_RIM_CY + CROWN_FRONT_SAG],
    ]);
    withShapeClip(
      art,
      () => traceCrownFront(art, 0, 0),
      () => {
        art.fillStyle = bandedFill(
          art,
          [CROWN[0][0], 0],
          [CROWN[CROWN.length - 1][0], 0],
          [
            [tone(CROWN_METAL, LIGHT / 2), LIGHT_BAND_UNTIL],
            [tone(CROWN_METAL, SHADE / 2), MID_BAND_UNTIL],
            [tone(CROWN_METAL, DEEP_SHADE), 1],
          ],
        );
        art.beginPath();
        art.moveTo(0, CROWN_BAND_TOP);
        art.quadraticCurveTo(CROWN_RIM_CX, CROWN_BAND_TOP + CROWN_FRONT_SAG, 1, CROWN_BAND_TOP);
        art.lineTo(1, 1);
        art.lineTo(0, 1);
        art.closePath();
        art.fill();
        strokeDetail(
          art,
          px,
          [
            [0, CROWN_BAND_TOP],
            [CROWN_RIM_CX, CROWN_BAND_TOP + CROWN_FRONT_SAG / 2],
            [1, CROWN_BAND_TOP],
          ],
          ICON_OUTLINE,
        );
      },
    );
    for (const [tipX, tipY] of CROWN_TIPS) {
      paintForm(
        art,
        px,
        () => {
          art.beginPath();
          art.arc(tipX, tipY, CROWN_TIP_R, 0, FULL_TURN);
        },
        litFill(
          art,
          tone(CROWN_METAL, LIGHT / 2),
          [tipX - CROWN_TIP_R, tipY - CROWN_TIP_R],
          [tipX + CROWN_TIP_R, tipY + CROWN_TIP_R],
        ),
      );
    }
    for (const drip of OOZE_DRIPS) paintForm(art, px, () => tracePoints(art, drip), OOZE);
    for (const [gx, gy, r] of CROWN_GEMS) {
      const traceGem = (dx: number, dy: number): void => {
        art.beginPath();
        art.ellipse(gx + dx, gy + dy, r, r * GEM_ASPECT, 0, 0, FULL_TURN);
      };
      paintForm(art, px, () => traceGem(0, 0), tone(GEM, LIGHT));
      offsetShade(art, traceGem, [
        [GEM, GEM_SHADE_SHIFT / 2, GEM_SHADE_SHIFT / 2],
        [tone(GEM, DEEP_SHADE), GEM_SHADE_SHIFT * 2, GEM_SHADE_SHIFT * 2],
      ]);
      glint(
        art,
        gx - r * GEM_GLINT_FRACTION,
        gy - r * GEM_GLINT_FRACTION,
        r * GEM_GLINT_FRACTION * 2,
      );
    }
    glint(art, CROWN_GLINT[0], CROWN_GLINT[1], CROWN_GLINT_R);
  });
}
