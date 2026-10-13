import type { Rect } from '../../../ui/core/geom';
import {
  appendPoints,
  bandedFill,
  disc,
  FULL_TURN,
  glint,
  ICON_OUTLINE,
  litFill,
  outlineWidth,
  paintForm,
  paintIconArt,
  tone,
  withShapeClip,
  type IconPoint,
} from './iconPaint';

/**
 * The Eyes of Splatter: round pink-lensed shades seen face-on, with a red
 * splatter dried across the right lens. At slot size the two discs and the
 * bridge identify them as glasses; the splatter is what tells them apart from
 * any other pair.
 */

const LENS_RADIUS = 0.17;
const LENS_Y = 0.52;
const LEFT_LENS_X = 0.28;
const RIGHT_LENS_X = 0.72;
/** The rim is drawn as a ring this much wider than the lens it holds. */
const RIM_WIDTH = 0.035;

const BRIDGE_TOP_Y = 0.4;
const BRIDGE_DIP_Y = 0.45;
const BRIDGE_WIDTH = 0.04;
/** Where the temple arms leave the rims and how far they reach toward the edges. */
const TEMPLE_Y = 0.43;
const TEMPLE_REACH = 0.04;
const TEMPLE_WIDTH = 0.04;

const FRAME_COLOR = '#2b1630';
const LENS_PINK = '#ef6fae';
const LENS_LIGHT_UNTIL = 0.3;
const LENS_MID_UNTIL = 0.7;
const LENS_LIGHT = 0.35;
const LENS_SHADE = -0.35;

const SPLATTER_RED = '#b3122b';
/**
 * The splatter's main blot, offset from the right lens's centre: a lopsided
 * burst rather than a circle, because a circle on a disc reads as a pupil.
 */
const SPLATTER_BLOT: readonly IconPoint[] = [
  [0.0, -0.08, 0.02],
  [0.03, -0.05],
  [0.1, -0.09],
  [0.06, -0.02, 0.02],
  [0.08, 0.03, 0.02],
  [0.03, 0.06],
  [0.03, 0.11],
  [-0.02, 0.06],
  [-0.07, 0.07, 0.02],
  [-0.06, 0.01],
  [-0.12, -0.01],
  [-0.05, -0.04, 0.02],
];
/** Flung droplets round the blot, as (dx, dy, radius) from the right lens's centre. */
const SPLATTER_DROPS: readonly (readonly [number, number, number])[] = [
  [-0.1, -0.1, 0.018],
  [0.12, -0.12, 0.014],
  [0.14, 0.11, 0.016],
  [-0.12, 0.12, 0.012],
];
/** The run of a drip down from the blot, ending in a bead. */
const DRIP_TOP_Y = 0.08;
const DRIP_BOTTOM_Y = 0.15;
const DRIP_X = 0.0;
const DRIP_WIDTH = 0.022;
const DRIP_BEAD_RADIUS = 0.02;
const SPLATTER_SHINE = 0.4;
const SPLATTER_SHINE_RADIUS = 0.012;
const SPLATTER_SHINE_DX = 0.01;
const SPLATTER_SHINE_DY = -0.05;

const GLINT_DX = -0.07;
const GLINT_DY = -0.08;
const GLINT_RADIUS = 0.06;
const LENS_GLARE_ALPHA = 0.35;
const LENS_GLARE_WIDTH = 0.03;

function traceLens(ctx: CanvasRenderingContext2D, cx: number): void {
  ctx.beginPath();
  ctx.arc(cx, LENS_Y, LENS_RADIUS, 0, FULL_TURN);
}

function paintTemples(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.lineCap = 'round';
  for (const [rimX, edgeX] of [
    [LEFT_LENS_X - LENS_RADIUS, TEMPLE_REACH],
    [RIGHT_LENS_X + LENS_RADIUS, 1 - TEMPLE_REACH],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(rimX, TEMPLE_Y);
    ctx.lineTo(edgeX, TEMPLE_Y - TEMPLE_WIDTH);
    ctx.strokeStyle = ICON_OUTLINE;
    ctx.lineWidth = TEMPLE_WIDTH + outlineWidth(px) * 2;
    ctx.stroke();
    ctx.strokeStyle = FRAME_COLOR;
    ctx.lineWidth = TEMPLE_WIDTH;
    ctx.stroke();
  }
}

function paintBridge(ctx: CanvasRenderingContext2D, px: number): void {
  const left = LEFT_LENS_X + LENS_RADIUS;
  const right = RIGHT_LENS_X - LENS_RADIUS;
  ctx.beginPath();
  ctx.moveTo(left, BRIDGE_DIP_Y);
  ctx.quadraticCurveTo((left + right) / 2, BRIDGE_TOP_Y - BRIDGE_WIDTH, right, BRIDGE_DIP_Y);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = BRIDGE_WIDTH + outlineWidth(px) * 2;
  ctx.stroke();
  ctx.strokeStyle = FRAME_COLOR;
  ctx.lineWidth = BRIDGE_WIDTH;
  ctx.stroke();
}

function paintLens(ctx: CanvasRenderingContext2D, px: number, cx: number): void {
  paintForm(
    ctx,
    px,
    () => {
      ctx.beginPath();
      ctx.arc(cx, LENS_Y, LENS_RADIUS + RIM_WIDTH, 0, FULL_TURN);
    },
    litFill(
      ctx,
      FRAME_COLOR,
      [cx - LENS_RADIUS, LENS_Y - LENS_RADIUS],
      [cx + LENS_RADIUS, LENS_Y + LENS_RADIUS],
    ),
  );
  traceLens(ctx, cx);
  ctx.fillStyle = bandedFill(
    ctx,
    [cx - LENS_RADIUS, LENS_Y - LENS_RADIUS],
    [cx + LENS_RADIUS, LENS_Y + LENS_RADIUS],
    [
      [tone(LENS_PINK, LENS_LIGHT), LENS_LIGHT_UNTIL],
      [LENS_PINK, LENS_MID_UNTIL],
      [tone(LENS_PINK, LENS_SHADE), 1],
    ],
  );
  ctx.fill();
}

function paintSplatter(ctx: CanvasRenderingContext2D, cx: number): void {
  withShapeClip(
    ctx,
    () => traceLens(ctx, cx),
    () => {
      ctx.beginPath();
      appendPoints(
        ctx,
        SPLATTER_BLOT.map(([dx, dy]): IconPoint => [cx + dx, LENS_Y + dy]),
      );
      ctx.fillStyle = SPLATTER_RED;
      ctx.fill();
      for (const [dx, dy, r] of SPLATTER_DROPS) disc(ctx, cx + dx, LENS_Y + dy, r, SPLATTER_RED);
      ctx.beginPath();
      ctx.moveTo(cx + DRIP_X, LENS_Y + DRIP_TOP_Y);
      ctx.lineTo(cx + DRIP_X, LENS_Y + DRIP_BOTTOM_Y);
      ctx.strokeStyle = SPLATTER_RED;
      ctx.lineWidth = DRIP_WIDTH;
      ctx.stroke();
      disc(ctx, cx + DRIP_X, LENS_Y + DRIP_BOTTOM_Y, DRIP_BEAD_RADIUS, SPLATTER_RED);
      disc(
        ctx,
        cx + SPLATTER_SHINE_DX,
        LENS_Y + SPLATTER_SHINE_DY,
        SPLATTER_SHINE_RADIUS,
        tone(SPLATTER_RED, SPLATTER_SHINE),
      );
    },
  );
}

/** A straight band of glare across a lens, the one mark that says glass rather than paint. */
function paintGlare(ctx: CanvasRenderingContext2D, cx: number): void {
  withShapeClip(
    ctx,
    () => traceLens(ctx, cx),
    () => {
      ctx.beginPath();
      ctx.moveTo(cx - LENS_RADIUS, LENS_Y);
      ctx.lineTo(cx, LENS_Y - LENS_RADIUS);
      ctx.strokeStyle = tone(LENS_PINK, 1);
      ctx.globalAlpha = LENS_GLARE_ALPHA;
      ctx.lineWidth = LENS_GLARE_WIDTH;
      ctx.stroke();
    },
  );
}

export function drawEyesOfSplatterIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  paintIconArt(ctx, rect, (c, px) => {
    paintTemples(c, px);
    paintBridge(c, px);
    for (const cx of [LEFT_LENS_X, RIGHT_LENS_X]) {
      paintLens(c, px, cx);
      paintGlare(c, cx);
    }
    paintSplatter(c, RIGHT_LENS_X);
    glint(c, LEFT_LENS_X + GLINT_DX, LENS_Y + GLINT_DY, GLINT_RADIUS);
  });
}
