import type { Rect } from '../../../ui/core/geom';
import {
  FULL_TURN,
  glint,
  ICON_OUTLINE,
  litFill,
  outlineWidth,
  paintForm,
  paintIconArt,
  strokeDetail,
  tone,
  traceEllipse,
  tracePoints,
  withShapeClip,
  type IconPoint,
} from './iconPaint';

/**
 * Icons for the three rings that turn fairy magic away.
 *
 * They share one band seen a little from above, so at slot size they read as
 * a family, and are told apart by colour first: frost blue for ice, ember
 * orange for fire, and a two-tone opal for the signet that stops both.
 */

/** The ids this module can draw. Closed, so a new ring cannot ship iconless. */
export type FairyWardRingItemId =
  'fairy_repellent_signet' | 'ring_of_the_cold_shoulder' | 'ring_of_the_asbestos_knuckle';

const SHADE = -0.34;
const DEEP_SHADE = -0.6;

const BAND_CX = 0.5;
const BAND_CY = 0.64;
const BAND_RX = 0.3;
const BAND_RY = 0.24;
const HOLE_RX = 0.2;
const HOLE_RY = 0.14;
/** The hole sits a touch high: the band is seen from above, so its near wall shows thicker. */
const HOLE_RISE = 0.03;
/** The far inner wall shows as a crescent along the hole's top, where the light doesn't reach. */
const INNER_WALL_DROP = 0.05;
const BAND_GLINT: readonly [number, number] = [0.27, 0.6];
const BAND_GLINT_R = 0.06;

const FROST_METAL = '#a9cfe6';
const FROST_GEM = '#7fe0ff';
const EMBER_METAL = '#b9662e';
const EMBER_GEM = '#ff8a2a';
const EMBER_CORE = '#ffe08a';
const SIGNET_METAL = '#d7b45a';
const OPAL_FROST = '#8fd6ff';
const OPAL_EMBER = '#ff9147';
const OPAL_FLECK_COOL = '#9bf5d8';
const OPAL_FLECK_WARM = '#ff7fb0';

/** The cut ice crystal on the Cold Shoulder: a tall hexagon standing on the band. */
const ICE_GEM: readonly IconPoint[] = [
  [0.5, 0.12],
  [0.62, 0.24],
  [0.62, 0.38],
  [0.5, 0.48],
  [0.38, 0.38],
  [0.38, 0.24],
];
const ICE_GEM_FACET: readonly IconPoint[] = [
  [0.5, 0.12],
  [0.5, 0.48],
];
const ICE_GEM_LIGHT_FROM: readonly [number, number] = [0.38, 0.12];
const ICE_GEM_LIGHT_TO: readonly [number, number] = [0.62, 0.48];
const ICE_GEM_GLINT: readonly [number, number] = [0.44, 0.22];
const ICE_GEM_GLINT_R = 0.06;
/** Frost spikes flaring off the band's shoulders. */
const FROST_SPIKES: readonly (readonly IconPoint[])[] = [
  [
    [0.24, 0.48],
    [0.13, 0.36],
  ],
  [
    [0.2, 0.56],
    [0.07, 0.52],
  ],
  [
    [0.76, 0.48],
    [0.87, 0.36],
  ],
  [
    [0.8, 0.56],
    [0.93, 0.52],
  ],
];
const FROST_SPIKE_WIDTH = 2.4;

const EMBER_STONE_CX = 0.5;
const EMBER_STONE_CY = 0.36;
const EMBER_STONE_RX = 0.15;
const EMBER_STONE_RY = 0.12;
const EMBER_CORE_RX = 0.07;
const EMBER_CORE_RY = 0.05;
/** The core glows low in the stone, as coals glow from beneath their ash. */
const EMBER_CORE_DROP = 0.025;
const EMBER_GLINT: readonly [number, number] = [0.43, 0.31];
const EMBER_GLINT_R = 0.05;
/** Sparks drifting up off the stone. */
const EMBER_SPARKS: readonly (readonly [number, number, number])[] = [
  [0.36, 0.14, 0.022],
  [0.58, 0.08, 0.018],
  [0.68, 0.19, 0.024],
];

const SIGNET_FACE_CX = 0.5;
const SIGNET_FACE_CY = 0.34;
const SIGNET_FACE_RX = 0.24;
const SIGNET_FACE_RY = 0.17;
const SIGNET_BEZEL = 0.035;
const OPAL_RX = SIGNET_FACE_RX - SIGNET_BEZEL;
const OPAL_RY = SIGNET_FACE_RY - SIGNET_BEZEL;
/** Where the opal's frost half meets its ember half, along a diagonal from upper right to lower left. */
const OPAL_SPLIT: readonly [number, number, number, number] = [0.66, 0.18, 0.34, 0.5];
const OPAL_FLECKS: readonly (readonly [number, number, number, string])[] = [
  [0.4, 0.3, 0.022, OPAL_FLECK_COOL],
  [0.47, 0.38, 0.016, OPAL_FLECK_COOL],
  [0.56, 0.32, 0.02, OPAL_FLECK_WARM],
  [0.62, 0.39, 0.016, OPAL_FLECK_WARM],
];
const OPAL_GLINT: readonly [number, number] = [0.39, 0.27];
const OPAL_GLINT_R = 0.06;

/** Draws one fairy-ward ring into the largest square centred in `rect`. */
export function drawFairyWardRingIcon(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  id: FairyWardRingItemId,
): void {
  paintIconArt(ctx, rect, (art, px) => {
    switch (id) {
      case 'ring_of_the_cold_shoulder':
        paintColdShoulder(art, px);
        return;
      case 'ring_of_the_asbestos_knuckle':
        paintAsbestosKnuckle(art, px);
        return;
      case 'fairy_repellent_signet':
        paintSignet(art, px);
        return;
    }
  });
}

function paintBand(ctx: CanvasRenderingContext2D, px: number, metal: string): void {
  const holeCy = BAND_CY - HOLE_RISE;
  const traceBand = (): void => {
    ctx.beginPath();
    ctx.ellipse(BAND_CX, BAND_CY, BAND_RX, BAND_RY, 0, 0, FULL_TURN);
    ctx.moveTo(BAND_CX + HOLE_RX, holeCy);
    ctx.ellipse(BAND_CX, holeCy, HOLE_RX, HOLE_RY, 0, 0, FULL_TURN);
  };
  traceBand();
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = outlineWidth(px) * 2;
  ctx.stroke();
  ctx.fillStyle = litFill(
    ctx,
    metal,
    [BAND_CX - BAND_RX, BAND_CY - BAND_RY],
    [BAND_CX + BAND_RX, BAND_CY + BAND_RY],
  );
  ctx.fill('evenodd');

  withShapeClip(
    ctx,
    () => traceEllipse(ctx, BAND_CX, holeCy, HOLE_RX, HOLE_RY),
    () => {
      ctx.beginPath();
      ctx.ellipse(BAND_CX, holeCy, HOLE_RX, HOLE_RY, 0, 0, FULL_TURN);
      ctx.moveTo(BAND_CX + HOLE_RX, holeCy + INNER_WALL_DROP);
      ctx.ellipse(BAND_CX, holeCy + INNER_WALL_DROP, HOLE_RX, HOLE_RY, 0, 0, FULL_TURN);
      ctx.fillStyle = tone(metal, SHADE);
      ctx.fill('evenodd');
    },
  );
  glint(ctx, BAND_GLINT[0], BAND_GLINT[1], BAND_GLINT_R);
}

function paintColdShoulder(ctx: CanvasRenderingContext2D, px: number): void {
  for (const spike of FROST_SPIKES) {
    strokeDetail(ctx, px, spike, ICON_OUTLINE, FROST_SPIKE_WIDTH * 2);
    strokeDetail(ctx, px, spike, FROST_GEM, FROST_SPIKE_WIDTH);
  }
  paintBand(ctx, px, FROST_METAL);
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, ICE_GEM),
    litFill(ctx, FROST_GEM, ICE_GEM_LIGHT_FROM, ICE_GEM_LIGHT_TO),
  );
  strokeDetail(ctx, px, ICE_GEM_FACET, tone(FROST_GEM, DEEP_SHADE));
  glint(ctx, ICE_GEM_GLINT[0], ICE_GEM_GLINT[1], ICE_GEM_GLINT_R);
}

function paintAsbestosKnuckle(ctx: CanvasRenderingContext2D, px: number): void {
  for (const [x, y, r] of EMBER_SPARKS) {
    ctx.beginPath();
    ctx.arc(x, y, r + outlineWidth(px), 0, FULL_TURN);
    ctx.fillStyle = ICON_OUTLINE;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, FULL_TURN);
    ctx.fillStyle = EMBER_CORE;
    ctx.fill();
  }
  paintBand(ctx, px, EMBER_METAL);
  const traceStone = (): void =>
    traceEllipse(ctx, EMBER_STONE_CX, EMBER_STONE_CY, EMBER_STONE_RX, EMBER_STONE_RY);
  paintForm(
    ctx,
    px,
    traceStone,
    litFill(
      ctx,
      EMBER_GEM,
      [EMBER_STONE_CX - EMBER_STONE_RX, EMBER_STONE_CY - EMBER_STONE_RY],
      [EMBER_STONE_CX + EMBER_STONE_RX, EMBER_STONE_CY + EMBER_STONE_RY],
    ),
  );
  withShapeClip(ctx, traceStone, () => {
    traceEllipse(
      ctx,
      EMBER_STONE_CX,
      EMBER_STONE_CY + EMBER_CORE_DROP,
      EMBER_CORE_RX,
      EMBER_CORE_RY,
    );
    ctx.fillStyle = EMBER_CORE;
    ctx.fill();
  });
  glint(ctx, EMBER_GLINT[0], EMBER_GLINT[1], EMBER_GLINT_R);
}

function paintSignet(ctx: CanvasRenderingContext2D, px: number): void {
  paintBand(ctx, px, SIGNET_METAL);
  paintForm(
    ctx,
    px,
    () => traceEllipse(ctx, SIGNET_FACE_CX, SIGNET_FACE_CY, SIGNET_FACE_RX, SIGNET_FACE_RY),
    litFill(
      ctx,
      SIGNET_METAL,
      [SIGNET_FACE_CX - SIGNET_FACE_RX, SIGNET_FACE_CY - SIGNET_FACE_RY],
      [SIGNET_FACE_CX + SIGNET_FACE_RX, SIGNET_FACE_CY + SIGNET_FACE_RY],
    ),
  );
  const traceOpal = (): void => traceEllipse(ctx, SIGNET_FACE_CX, SIGNET_FACE_CY, OPAL_RX, OPAL_RY);
  withShapeClip(ctx, traceOpal, () => {
    ctx.fillStyle = OPAL_FROST;
    ctx.fillRect(0, 0, 1, 1);
    const [fromX, fromY, toX, toY] = OPAL_SPLIT;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(1, 0);
    ctx.lineTo(1, 1);
    ctx.lineTo(toX, toY);
    ctx.closePath();
    ctx.fillStyle = OPAL_EMBER;
    ctx.fill();
    for (const [x, y, r, color] of OPAL_FLECKS) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, FULL_TURN);
      ctx.fillStyle = color;
      ctx.fill();
    }
  });
  traceOpal();
  ctx.strokeStyle = tone(SIGNET_METAL, DEEP_SHADE);
  ctx.lineWidth = outlineWidth(px);
  ctx.stroke();
  glint(ctx, OPAL_GLINT[0], OPAL_GLINT[1], OPAL_GLINT_R);
}
