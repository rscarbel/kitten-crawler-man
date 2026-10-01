/**
 * A cluster of tallow candles burning on their own spilt wax, low enough to
 * walk past and over. Any hit knocks it over and it goes out: the remains are
 * the candles lying in the wax with a thread of smoke.
 */

import { mulberry32 } from '../../person/rng';
import type { PieceOrigin } from './cellarPiece';
import { CANDLE_FLAME_FRAMES, paintCandleFlame } from './candleFlame';
import {
  HALF,
  HOLLOW,
  TALLOW,
  TWO_PI,
  contactShadow,
  line,
  type Ctx,
  type ShatterSpec,
} from './cellarPaint';

const CANDLE_SEED = 0xca9d;
export const CANDLE_CLUSTER_VARIANTS = 4;

interface Candle {
  /** Across the tile, as a fraction. */
  readonly x: number;
  /** The candle's foot, down the tile, as a fraction. */
  readonly y: number;
  readonly height: number;
  readonly lit: boolean;
}

/** Each variant's candles, back to front so nearer ones overlap. */
const LAYOUTS: ReadonlyArray<ReadonlyArray<Candle>> = [
  [
    { x: 0.36, y: 0.62, height: 0.3, lit: true },
    { x: 0.58, y: 0.64, height: 0.2, lit: true },
    { x: 0.46, y: 0.74, height: 0.14, lit: true },
  ],
  [
    { x: 0.32, y: 0.6, height: 0.24, lit: true },
    { x: 0.5, y: 0.58, height: 0.34, lit: true },
    { x: 0.66, y: 0.66, height: 0.18, lit: false },
    { x: 0.42, y: 0.76, height: 0.1, lit: true },
  ],
  [
    { x: 0.42, y: 0.64, height: 0.26, lit: true },
    { x: 0.6, y: 0.72, height: 0.16, lit: true },
  ],
  [
    { x: 0.3, y: 0.66, height: 0.16, lit: true },
    { x: 0.48, y: 0.6, height: 0.28, lit: true },
    { x: 0.62, y: 0.68, height: 0.22, lit: true },
    { x: 0.52, y: 0.78, height: 0.08, lit: false },
  ],
];

const CANDLE_WIDTH = 0.075;
const WAX_POOL = { x: 0.48, y: 0.7, rx: 0.26, ry: 0.09 } as const;
const DRIP_LENGTH = 0.08;

/** A candle's body: lit down its left side, the drip down that side, the cupped top. */
const CANDLE = {
  litStop: 0.35,
  dripShare: 0.6,
  topShare: 0.45,
  wick: 0.03,
  wickWidth: 1.5,
  /** The flame stands just clear of the wick's foot. */
  flameLift: 0.02,
} as const;
/** The shadow under the wax pool spreads past it. */
const POOL_SHADOW = { rx: 1.2, ry: 1.4 } as const;
/** Knocked over, the pool runs a little wider. */
const SPILLED_POOL_RX = 1.15;
/** Fallen candles land near where they stood, mostly a little nearer the viewer. */
const FALLEN = { scatterX: 0.15, forwardBias: 0.3, scatterY: 0.08, wickEnd: 2 } as const;

function layoutFor(variant: number): ReadonlyArray<Candle> {
  return LAYOUTS[variant % CANDLE_CLUSTER_VARIANTS] ?? [];
}

function candleBody(ctx: Ctx, cx: number, foot: number, height: number, ts: number): void {
  const half = (CANDLE_WIDTH * ts) / 2;
  const body = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
  body.addColorStop(0, TALLOW.lit);
  body.addColorStop(CANDLE.litStop, TALLOW.rim);
  body.addColorStop(1, TALLOW.shade);
  ctx.fillStyle = body;
  ctx.fillRect(cx - half, foot - height, half * 2, height);
  // A wax drip run down the lit side.
  ctx.fillStyle = TALLOW.rim;
  ctx.fillRect(cx - half, foot - height, half * CANDLE.dripShare, DRIP_LENGTH * ts);
  ctx.fillStyle = TALLOW.lit;
  ctx.beginPath();
  ctx.ellipse(cx, foot - height, half, half * CANDLE.topShare, 0, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = TALLOW.deep;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - half, foot - height, half * 2, height);
  line(ctx, cx, foot - height, cx, foot - height - CANDLE.wick * ts, HOLLOW, CANDLE.wickWidth);
}

/** The cluster standing, its flames at `phase` of {@link CANDLE_FLAME_FRAMES}. */
export function paintCandleCluster(ctx: Ctx, at: PieceOrigin, variant: number, phase: number) {
  const { ox, oy, ts } = at;
  contactShadow(
    ctx,
    ox + WAX_POOL.x * ts,
    oy + WAX_POOL.y * ts,
    WAX_POOL.rx * ts * POOL_SHADOW.rx,
    WAX_POOL.ry * ts * POOL_SHADOW.ry,
  );
  ctx.fillStyle = TALLOW.mid;
  ctx.beginPath();
  ctx.ellipse(
    ox + WAX_POOL.x * ts,
    oy + WAX_POOL.y * ts,
    WAX_POOL.rx * ts,
    WAX_POOL.ry * ts,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.strokeStyle = TALLOW.shade;
  ctx.lineWidth = 1;
  ctx.stroke();
  layoutFor(variant).forEach((candle, index) => {
    const cx = ox + candle.x * ts;
    const foot = oy + candle.y * ts;
    const height = candle.height * ts;
    candleBody(ctx, cx, foot, height, ts);
    if (candle.lit) {
      paintCandleFlame(
        ctx,
        cx,
        foot - height - CANDLE.flameLift * ts,
        ts,
        (phase + index) % CANDLE_FLAME_FRAMES,
      );
    }
  });
}

/** Knocked over and out: candles lying cold in their spilt wax. */
export function paintCandleClusterRemains(ctx: Ctx, at: PieceOrigin, variant: number): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(CANDLE_SEED + variant);
  ctx.fillStyle = TALLOW.shade;
  ctx.beginPath();
  ctx.ellipse(
    ox + WAX_POOL.x * ts,
    oy + WAX_POOL.y * ts,
    WAX_POOL.rx * ts * SPILLED_POOL_RX,
    WAX_POOL.ry * ts,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  layoutFor(variant).forEach((candle) => {
    const angle = (rng() - HALF) * Math.PI;
    const length = candle.height * ts;
    const cx = ox + (candle.x + (rng() - HALF) * FALLEN.scatterX) * ts;
    const cy = oy + (candle.y + (rng() - FALLEN.forwardBias) * FALLEN.scatterY) * ts;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = TALLOW.lit;
    ctx.fillRect(-length / 2, -(CANDLE_WIDTH * ts) / 2, length, CANDLE_WIDTH * ts);
    ctx.strokeStyle = TALLOW.deep;
    ctx.lineWidth = 1;
    ctx.strokeRect(-length / 2, -(CANDLE_WIDTH * ts) / 2, length, CANDLE_WIDTH * ts);
    ctx.fillStyle = HOLLOW;
    ctx.fillRect(length / 2 - FALLEN.wickEnd, -1, FALLEN.wickEnd, FALLEN.wickEnd);
    ctx.restore();
  });
}

/** Knocked over, a few stubs of wax skitter off, in source pixels. */
const CANDLE_SHATTER = {
  shardCount: 6,
  shardLength: 6,
  shardWidth: 3,
  spread: 18,
  halfWidth: 6,
} as const;

export const CANDLE_CLUSTER_SHATTER: ShatterSpec = {
  shades: [TALLOW.lit, TALLOW.rim, TALLOW.mid],
  edge: TALLOW.deep,
  dustRgb: '200,190,170',
  shardCount: CANDLE_SHATTER.shardCount,
  shardLength: CANDLE_SHATTER.shardLength,
  shardWidth: CANDLE_SHATTER.shardWidth,
  spread: CANDLE_SHATTER.spread,
  halfWidth: CANDLE_SHATTER.halfWidth,
};

/** Where a candle cluster's knock-over bursts from, as a fraction of a tile down. */
export const CANDLE_CLUSTER_BURST_HEIGHT_TILES = 0.6;
