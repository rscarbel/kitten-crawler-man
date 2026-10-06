import type { Rect } from '../../../ui/core/geom';
import {
  bandedFill,
  disc,
  FULL_TURN,
  BOLD_DETAIL,
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
const FOG = '#9a92c4';
const FOG_DARK = '#4c4478';
const FOG_WISP = '#c4bcec';
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

const CLOUD_PUFFS: readonly (readonly [number, number, number])[] = [
  [0.38, 0.47, 0.085],
  [0.5, 0.41, 0.105],
  [0.62, 0.47, 0.085],
  [0.5, 0.51, 0.09],
];
const CLOUD_LIGHT_FROM: readonly [number, number] = [0.36, 0.33];
const CLOUD_LIGHT_TO: readonly [number, number] = [0.62, 0.58];
const SWIRL_CX = 0.5;
const SWIRL_CY = 0.46;
const SWIRL_RADIUS = 0.07;
const SWIRL_TURNS = 1.75;
const SWIRL_STEPS = 24;

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

/** Fog puffing out from behind the sheet's edges, the one cue that this scroll does something. */
const FOG_PUFFS: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [0.83, 0.36, 0.06],
    [0.91, 0.43, 0.055],
    [0.84, 0.47, 0.05],
  ],
  [
    [0.16, 0.56, 0.055],
    [0.09, 0.63, 0.05],
    [0.17, 0.67, 0.06],
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

function traceCloud(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  for (const [cx, cy, r] of CLOUD_PUFFS) {
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, FULL_TURN);
  }
}

function paintFogMotif(ctx: CanvasRenderingContext2D, px: number): void {
  traceCloud(ctx);
  ctx.strokeStyle = FOG_DARK;
  ctx.lineWidth = outlineWidth(px) * 2;
  ctx.stroke();
  ctx.fillStyle = litFill(ctx, FOG, CLOUD_LIGHT_FROM, CLOUD_LIGHT_TO);
  ctx.fill();

  const swirl: IconPoint[] = [];
  for (let step = 0; step <= SWIRL_STEPS; step++) {
    const t = step / SWIRL_STEPS;
    const angle = t * SWIRL_TURNS * FULL_TURN;
    swirl.push([
      SWIRL_CX + Math.cos(angle) * SWIRL_RADIUS * t,
      SWIRL_CY + Math.sin(angle) * SWIRL_RADIUS * t,
    ]);
  }
  strokeDetail(ctx, px, swirl, FOG_DARK, BOLD_DETAIL);
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

/** Scroll of Confusing Fog: a parchment open between two rolls, a fog cloud inked on it and fog leaking off its edges. */
export function drawConfusingFogScrollIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  paintIconArt(ctx, rect, (art, px) => {
    for (const puff of FOG_PUFFS) {
      art.beginPath();
      for (const [cx, cy, r] of puff) {
        art.moveTo(cx + r, cy);
        art.arc(cx, cy, r, 0, FULL_TURN);
      }
      art.strokeStyle = FOG_DARK;
      art.lineWidth = outlineWidth(px) * 2;
      art.stroke();
      art.fillStyle = FOG_WISP;
      art.fill();
    }
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
    paintFogMotif(art, px);
    for (const line of INK_LINES) strokeDetail(art, px, line, INK, MEDIUM_DETAIL);
    paintRoll(art, px, BOTTOM_ROLL);
    paintRoll(art, px, TOP_ROLL);
    paintSeal(art, px);
    glint(art, GLINT_X, GLINT_Y, GLINT_R);
  });
}
