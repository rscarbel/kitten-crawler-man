import type { Rect } from '../../../ui/core/geom';
import {
  bandedFill,
  glint,
  hairlineWidth,
  ICON_CENTER,
  type IconPoint,
  litFill,
  paintForm,
  paintIconArt,
  rivet,
  tracePoints,
  tracePolyline,
} from './iconPaint';
import {
  TARANIS_BRONZE,
  TARANIS_GRIP_WRAP,
  TARANIS_LIGHTNING,
  TARANIS_SILVER,
} from '../taranisPalette';

/**
 * The Fury of Taranis: a bronze-hilted silver sword laid corner to corner,
 * point up and right, with lightning crawling down its edge. Drawn in a
 * frame turned so the blade runs straight up the square's diagonal: x across
 * the blade, y from the point (0) down to the pommel.
 */
const DIAGONAL_TILT = Math.PI / 4;
/** The sword's run along the diagonal, as a share of the diagonal, leaving room for its outline. */
const LENGTH_SHARE = 0.9;

const TIP_Y = 0;
const SHOULDER_Y = 0.12;
const GUARD_Y = 0.66;
const BLADE_HALF = 0.05;
const GUARD_HALF_SPAN = 0.15;
const GUARD_HALF_THICK = 0.03;
const GRIP_HALF = 0.026;
const POMMEL_Y = 0.92;
const POMMEL_R = 0.045;

const BLADE: readonly IconPoint[] = [
  [0, TIP_Y],
  [BLADE_HALF, SHOULDER_Y],
  [BLADE_HALF, GUARD_Y],
  [-BLADE_HALF, GUARD_Y],
  [-BLADE_HALF, SHOULDER_Y],
];
const GUARD: readonly IconPoint[] = [
  [-GUARD_HALF_SPAN, GUARD_Y - GUARD_HALF_THICK, GUARD_HALF_THICK],
  [GUARD_HALF_SPAN, GUARD_Y - GUARD_HALF_THICK, GUARD_HALF_THICK],
  [GUARD_HALF_SPAN, GUARD_Y + GUARD_HALF_THICK, GUARD_HALF_THICK],
  [-GUARD_HALF_SPAN, GUARD_Y + GUARD_HALF_THICK, GUARD_HALF_THICK],
];
const GRIP: readonly IconPoint[] = [
  [-GRIP_HALF, GUARD_Y],
  [GRIP_HALF, GUARD_Y],
  [GRIP_HALF, POMMEL_Y],
  [-GRIP_HALF, POMMEL_Y],
];
/** Where the grip's leather wrap crosses, as lines across it. */
const WRAP_TURNS = [0.74, 0.8, 0.86] as const;

/** The lit bevel is the half of the blade toward the key light; the far bevel a step down. */
const BEVEL_SPLIT = 0.5;
const BEVEL_FROM: readonly [number, number] = [-BLADE_HALF, 0];
const BEVEL_TO: readonly [number, number] = [BLADE_HALF, 0];
const GUARD_LIGHT_FROM: readonly [number, number] = [-GUARD_HALF_SPAN, GUARD_Y - GUARD_HALF_THICK];
const GUARD_LIGHT_TO: readonly [number, number] = [GUARD_HALF_SPAN, GUARD_Y + GUARD_HALF_THICK];

/** The crackle zig-zags down the blade's far edge, kink by kink, from near the point to the guard. */
const CRACKLE: readonly IconPoint[] = [
  [0.02, 0.06],
  [0.085, 0.16],
  [0.03, 0.24],
  [0.1, 0.33],
  [0.04, 0.42],
  [0.095, 0.5],
  [0.035, 0.58],
];
const CRACKLE_GLOW_WIDTH = 4;
const CRACKLE_ARC_WIDTH = 2;
const CRACKLE_CORE_WIDTH = 0.9;
const CRACKLE_GLOW_ALPHA = 0.5;
/** A spark of loose lightning at the point. */
const TIP_GLINT_R = 0.09;
const BLADE_GLINT: readonly [number, number] = [-0.02, 0.3];
const BLADE_GLINT_R = 0.05;

function paintSword(ctx: CanvasRenderingContext2D, px: number): void {
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, BLADE),
    bandedFill(ctx, BEVEL_FROM, BEVEL_TO, [
      [TARANIS_SILVER.light, BEVEL_SPLIT],
      [TARANIS_SILVER.mid, 1],
    ]),
  );
  paintForm(ctx, px, () => tracePoints(ctx, GRIP), TARANIS_GRIP_WRAP);
  for (const turn of WRAP_TURNS) {
    tracePolyline(ctx, [
      [-GRIP_HALF, turn],
      [GRIP_HALF, turn],
    ]);
    ctx.strokeStyle = TARANIS_BRONZE.dark;
    ctx.lineWidth = hairlineWidth(px);
    ctx.stroke();
  }
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, GUARD),
    litFill(ctx, TARANIS_BRONZE.base, GUARD_LIGHT_FROM, GUARD_LIGHT_TO),
  );
  rivet(ctx, px, 0, POMMEL_Y, POMMEL_R, TARANIS_BRONZE.base);

  const baseAlpha = ctx.globalAlpha;
  tracePolyline(ctx, CRACKLE);
  ctx.lineJoin = 'miter';
  ctx.globalAlpha = baseAlpha * CRACKLE_GLOW_ALPHA;
  ctx.strokeStyle = TARANIS_LIGHTNING.glow;
  ctx.lineWidth = hairlineWidth(px) * CRACKLE_GLOW_WIDTH;
  ctx.stroke();
  ctx.globalAlpha = baseAlpha;
  ctx.strokeStyle = TARANIS_LIGHTNING.arc;
  ctx.lineWidth = hairlineWidth(px) * CRACKLE_ARC_WIDTH;
  ctx.stroke();
  ctx.strokeStyle = TARANIS_LIGHTNING.core;
  ctx.lineWidth = hairlineWidth(px) * CRACKLE_CORE_WIDTH;
  ctx.stroke();

  glint(ctx, BLADE_GLINT[0], BLADE_GLINT[1], BLADE_GLINT_R);
  glint(ctx, 0, TIP_Y, TIP_GLINT_R, TARANIS_LIGHTNING.core);
}

export function drawTaranisSwordIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  paintIconArt(ctx, rect, (artCtx, px) => {
    const length = Math.SQRT2 * LENGTH_SHARE;
    const lengthPerUnit = length / (POMMEL_Y + POMMEL_R - TIP_Y);
    artCtx.translate(ICON_CENTER, ICON_CENTER);
    artCtx.rotate(DIAGONAL_TILT);
    artCtx.scale(lengthPerUnit, lengthPerUnit);
    artCtx.translate(0, -(POMMEL_Y + POMMEL_R + TIP_Y) / 2);
    paintSword(artCtx, px / lengthPerUnit);
  });
}
