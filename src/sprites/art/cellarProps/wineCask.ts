/**
 * A great wine cask lying on a wooden cradle, two tiles long. Its head faces
 * left, with a tap; the body is staves under three iron hoops. Variants differ
 * in a chalked tally on the staves, a wine drip under the tap, a rusted hoop
 * and a wet bung.
 */

import { mulberry32 } from '../../person/rng';
import type { CellarPiecePainter, PieceOrigin } from './cellarPiece';
import {
  HALF,
  OAK,
  RUST_IRON,
  TWO_PI,
  WINE_STAIN,
  contactShadow,
  crackLine,
  frontGradient,
  line,
  polygon,
  shard,
  wash,
  type Ctx,
} from './cellarPaint';

const CASK_SEED = 0xca5c;
/** The remains draw from their own stream, apart from the standing cask's. */
const REMAINS_SEED = CASK_SEED * 7;
const VARIANTS = 4;
const TILES_WIDE = 2;

/** The cask and its cradle, in tile fractions across the two-tile footprint. */
const CASK = {
  leftX: 0.16,
  rightX: 1.86,
  axisY: 0.42,
  endRy: 0.34,
  bulgeRy: 0.39,
  headRx: 0.09,
  hoopFractions: [0.1, 0.5, 0.9],
  hoopWidth: 0.06,
  cradleFractions: [0.2, 0.8],
  cradleHalfWidth: 0.14,
  cradleTopY: 0.66,
  floorY: 0.92,
  tapY: 0.5,
  tapLength: 0.1,
  tapStandoff: 0.02,
  tapSpout: 0.06,
  tapWidth: 3,
  /** The far head is seen nearly edge-on, a sliver of the near one's width. */
  farHeadShare: 0.6,
  outlineWidth: 1.5,
} as const;

/** A parabola through 0 at both heads and 1 at the middle is `4·t·(1 − t)`. */
const BULGE_PARABOLA = 4;

/** The cradle's trestle legs, as shares of its half-width and of its height. */
const CRADLE_LEG = { outer: 0.8, inner: 0.45, crotch: 0.5 } as const;

/** Light down a hoop: lit on top, falling into shade under the cask. */
const HOOP_MID_STOP = 0.35;

/** Light down the cask's round body, top to bottom. */
const BODY_STOPS = { rim: 0.18, lit: 0.4, mid: 0.75 } as const;

/** Washes on and under the cask, in tile fractions across its footprint. */
const SHADOW = { rx: 0.9, ry: 0.1 } as const;
const TAP_DRIP = { dx: 0.06, rx: 0.22, ry: 0.07, rgb: '58,15,20', alpha: 0.7 } as const;
const UNDERSIDE = { x: 1.4, dy: 0.4, rx: 0.8, ry: 0.2, alpha: 0.35 } as const;

/** The chalked tally: four strokes and the stroke across them. */
const TALLY = {
  marks: 4,
  firstX: 1.1,
  spacing: 0.07,
  top: -0.16,
  foot: 0.02,
  slant: 0.02,
  crossFromX: 1.08,
  crossFromDy: -0.02,
  crossToX: 1.36,
  crossToDy: -0.12,
  width: 2,
} as const;
/** Variants from this one on carry a chalk tally. */
const TALLIED_FROM_VARIANT = 2;
/** The one variant whose end hoop has rusted through to orange. */
const RUSTED_HOOP_VARIANT = 0;
const RUSTED_HOOP = 2;

/** The bung on top of the cask, set just short of the crown. */
const BUNG = { x: 0.92, crownShare: 0.82, rx: 0.06, ry: 0.025, wet: '#4a1a1c' } as const;

/** A struck cask's split and the wine weeping from it. */
const SPLIT = {
  fromX: 0.6,
  fromDy: -0.2,
  toX: 0.9,
  toDy: 0.18,
  wobble: 0.04,
  dripFromX: 0.78,
  dripFromDy: 0.04,
  dripToX: 0.8,
  dripFloorY: 0.86,
  dripWidth: 3,
} as const;
const SPLIT_POOL = { x: 0.85, rx: 0.3, ry: 0.08, rgb: '70,16,22', alpha: 0.75 } as const;

const CHALK = 'rgba(225,215,190,0.75)';
const STAVE_COUNT = 7;
const STAVE_ALPHA = 0.45;
const SHADE_RGB = '20,10,4';

/** The cask's silhouette: two shallow arcs bulging between the heads. */
function caskPath(ctx: Ctx, at: PieceOrigin): void {
  const { ox, oy, ts } = at;
  const left = ox + CASK.leftX * ts;
  const right = ox + CASK.rightX * ts;
  const axis = oy + CASK.axisY * ts;
  const end = CASK.endRy * ts;
  const bulge = CASK.bulgeRy * ts;
  const mid = (left + right) / 2;
  ctx.beginPath();
  ctx.moveTo(left, axis - end);
  ctx.quadraticCurveTo(mid, axis - bulge * 2 + end, right, axis - end);
  ctx.ellipse(right, axis, CASK.headRx * ts * CASK.farHeadShare, end, 0, -Math.PI / 2, Math.PI / 2);
  ctx.quadraticCurveTo(mid, axis + bulge * 2 - end, left, axis + end);
  ctx.closePath();
}

/** The height of the cask's surface above and below its axis at fraction `t` along it. */
function halfHeightAt(t: number, ts: number): number {
  const bulge = BULGE_PARABOLA * t * (1 - t);
  return (CASK.endRy + (CASK.bulgeRy - CASK.endRy) * bulge) * ts;
}

function cradle(ctx: Ctx, at: PieceOrigin, fraction: number): void {
  const { ox, oy, ts } = at;
  const cx = ox + (CASK.leftX + (CASK.rightX - CASK.leftX) * fraction) * ts;
  const half = CASK.cradleHalfWidth * ts;
  const top = oy + CASK.cradleTopY * ts;
  const floor = oy + CASK.floorY * ts;
  ctx.fillStyle = frontGradient(ctx, cx, top, floor, OAK);
  polygon(ctx, [
    [cx - half, top],
    [cx + half, top],
    [cx + half * CRADLE_LEG.outer, floor],
    [cx + half * CRADLE_LEG.inner, floor],
    [cx, top + (floor - top) * CRADLE_LEG.crotch],
    [cx - half * CRADLE_LEG.inner, floor],
    [cx - half * CRADLE_LEG.outer, floor],
  ]);
  ctx.fill();
  ctx.strokeStyle = OAK.deep;
  ctx.lineWidth = CASK.outlineWidth;
  ctx.stroke();
}

function hoop(ctx: Ctx, at: PieceOrigin, fraction: number, rusted: boolean): void {
  const { ox, oy, ts } = at;
  const x = ox + (CASK.leftX + (CASK.rightX - CASK.leftX) * fraction) * ts;
  const half = halfHeightAt(fraction, ts);
  const axis = oy + CASK.axisY * ts;
  const ramp = RUST_IRON;
  const width = CASK.hoopWidth * ts;
  const g = ctx.createLinearGradient(x, axis - half, x, axis + half);
  g.addColorStop(0, rusted ? ramp.rim : ramp.lit);
  g.addColorStop(HOOP_MID_STOP, ramp.mid);
  g.addColorStop(1, ramp.deep);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, axis, width, half, 0, -Math.PI / 2, Math.PI / 2);
  ctx.ellipse(x - width, axis, width, half, 0, Math.PI / 2, -Math.PI / 2, true);
  ctx.closePath();
  ctx.fill();
}

function paintCask(ctx: Ctx, at: PieceOrigin, variant: number, damaged: boolean): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(CASK_SEED + variant);
  const axis = oy + CASK.axisY * ts;
  const left = ox + CASK.leftX * ts;
  const right = ox + CASK.rightX * ts;

  contactShadow(ctx, ox + ts, oy + CASK.floorY * ts, SHADOW.rx * ts, SHADOW.ry * ts);
  if (variant % 2 === 1) {
    wash(
      ctx,
      left + TAP_DRIP.dx * ts,
      oy + CASK.floorY * ts,
      TAP_DRIP.rx * ts,
      TAP_DRIP.ry * ts,
      TAP_DRIP.rgb,
      TAP_DRIP.alpha,
    );
  }
  for (const fraction of CASK.cradleFractions) cradle(ctx, at, fraction);

  caskPath(ctx, at);
  ctx.save();
  const body = ctx.createLinearGradient(0, axis - CASK.bulgeRy * ts, 0, axis + CASK.bulgeRy * ts);
  body.addColorStop(0, OAK.mid);
  body.addColorStop(BODY_STOPS.rim, OAK.rim);
  body.addColorStop(BODY_STOPS.lit, OAK.lit);
  body.addColorStop(BODY_STOPS.mid, OAK.mid);
  body.addColorStop(1, OAK.deep);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.clip();
  // Staves run the length of the cask, curving with its belly.
  ctx.globalAlpha = STAVE_ALPHA;
  ctx.strokeStyle = OAK.deep;
  ctx.lineWidth = 1;
  for (let stave = 1; stave < STAVE_COUNT; stave++) {
    const s = stave / STAVE_COUNT - HALF;
    ctx.beginPath();
    ctx.moveTo(left, axis + s * 2 * CASK.endRy * ts);
    ctx.quadraticCurveTo(
      ox + ts,
      axis + s * 2 * (2 * CASK.bulgeRy - CASK.endRy) * ts,
      right,
      axis + s * 2 * CASK.endRy * ts,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  wash(
    ctx,
    ox + UNDERSIDE.x * ts,
    axis + UNDERSIDE.dy * ts,
    UNDERSIDE.rx * ts,
    UNDERSIDE.ry * ts,
    SHADE_RGB,
    UNDERSIDE.alpha,
  );
  if (variant >= TALLIED_FROM_VARIANT) {
    // A cellarman's chalked tally on the staves.
    const t = TALLY;
    for (let mark = 0; mark < t.marks; mark++) {
      const x = ox + (t.firstX + mark * t.spacing) * ts;
      line(ctx, x, axis + t.top * ts, x + t.slant * ts, axis + t.foot * ts, CHALK, t.width);
    }
    line(
      ctx,
      ox + t.crossFromX * ts,
      axis + t.crossFromDy * ts,
      ox + t.crossToX * ts,
      axis + t.crossToDy * ts,
      CHALK,
      t.width,
    );
  }
  ctx.restore();
  ctx.save();
  caskPath(ctx, at);
  ctx.strokeStyle = OAK.deep;
  ctx.lineWidth = CASK.outlineWidth;
  ctx.stroke();
  ctx.restore();

  CASK.hoopFractions.forEach((fraction, index) =>
    hoop(ctx, at, fraction, variant === RUSTED_HOOP_VARIANT && index === RUSTED_HOOP),
  );

  // The head, seen almost edge-on, and its tap.
  const head = ctx.createLinearGradient(
    left - CASK.headRx * ts,
    axis,
    left + CASK.headRx * ts,
    axis,
  );
  head.addColorStop(0, OAK.lit);
  head.addColorStop(1, OAK.shade);
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.ellipse(left, axis, CASK.headRx * ts, CASK.endRy * ts, 0, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = OAK.deep;
  ctx.lineWidth = CASK.outlineWidth;
  ctx.stroke();
  const tapY = oy + CASK.tapY * ts;
  const tapEnd = left - CASK.tapLength * ts;
  line(ctx, left - CASK.tapStandoff * ts, tapY, tapEnd, tapY, RUST_IRON.lit, CASK.tapWidth);
  line(ctx, tapEnd, tapY, tapEnd, tapY + CASK.tapSpout * ts, RUST_IRON.mid, CASK.tapWidth);

  // The bung on top, wet round its plug on some casks.
  const bungX = ox + BUNG.x * ts;
  const bungY = axis - CASK.bulgeRy * ts * BUNG.crownShare;
  ctx.fillStyle = variant % 2 === 0 ? OAK.shade : BUNG.wet;
  ctx.beginPath();
  ctx.ellipse(bungX, bungY, BUNG.rx * ts, BUNG.ry * ts, 0, 0, TWO_PI);
  ctx.fill();

  if (damaged) {
    const split = SPLIT;
    crackLine(
      ctx,
      ox + split.fromX * ts,
      axis + split.fromDy * ts,
      ox + split.toX * ts,
      axis + split.toDy * ts,
      split.wobble * ts,
      rng,
    );
    // Wine weeping out of the split and pooling under the cradle.
    line(
      ctx,
      ox + split.dripFromX * ts,
      axis + split.dripFromDy * ts,
      ox + split.dripToX * ts,
      oy + split.dripFloorY * ts,
      WINE_STAIN,
      split.dripWidth,
    );
    const pool = SPLIT_POOL;
    wash(
      ctx,
      ox + pool.x * ts,
      oy + CASK.floorY * ts,
      pool.rx * ts,
      pool.ry * ts,
      pool.rgb,
      pool.alpha,
    );
  }
}

const STAVE_PIECES = 9;

/** What a burst cask leaves, in tile fractions across its footprint. */
const REMAINS = {
  stain: { y: 0.7, rx: 0.92, ry: 0.28, rgb: '52,12,18', alpha: 0.75 },
  pool: { x: 0.8, spread: 0.4, y: 0.72, rx: 0.5, ry: 0.16, rgb: '70,16,24', alpha: 0.6 },
  cradleY: 0.78,
  cradleH: 0.1,
  staves: { x: 0.2, spreadX: 1.6, y: 0.56, spreadY: 0.3, length: 0.3, lengthSpread: 0.25 },
  staveWidth: 0.07,
  staveTwist: 0.9,
  litStaveChance: 0.5,
  hoop: { x: 0.7, spread: 0.6, y: 0.74, rx: 0.26, ry: 0.08, width: 3 },
} as const;

function paintCaskRemains(ctx: Ctx, at: PieceOrigin, variant: number): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(REMAINS_SEED + variant);
  const r = REMAINS;
  // The burst cask's wine soaks into the floor as a wide dark stain.
  wash(
    ctx,
    ox + ts,
    oy + r.stain.y * ts,
    r.stain.rx * ts,
    r.stain.ry * ts,
    r.stain.rgb,
    r.stain.alpha,
  );
  wash(
    ctx,
    ox + (r.pool.x + rng() * r.pool.spread) * ts,
    oy + r.pool.y * ts,
    r.pool.rx * ts,
    r.pool.ry * ts,
    r.pool.rgb,
    r.pool.alpha,
  );
  for (const fraction of CASK.cradleFractions) {
    const cx = ox + (CASK.leftX + (CASK.rightX - CASK.leftX) * fraction) * ts;
    ctx.fillStyle = OAK.shade;
    ctx.fillRect(
      cx - CASK.cradleHalfWidth * ts,
      oy + r.cradleY * ts,
      CASK.cradleHalfWidth * 2 * ts,
      r.cradleH * ts,
    );
  }
  const staves = r.staves;
  for (let index = 0; index < STAVE_PIECES; index++) {
    shard(
      ctx,
      ox + (staves.x + rng() * staves.spreadX) * ts,
      oy + (staves.y + rng() * staves.spreadY) * ts,
      (staves.length + rng() * staves.lengthSpread) * ts,
      r.staveWidth * ts,
      (rng() - HALF) * r.staveTwist,
      rng() < r.litStaveChance ? OAK.mid : OAK.lit,
      OAK.deep,
    );
  }
  // A sprung hoop lying flat.
  ctx.strokeStyle = RUST_IRON.mid;
  ctx.lineWidth = r.hoop.width;
  ctx.beginPath();
  ctx.ellipse(
    ox + (r.hoop.x + rng() * r.hoop.spread) * ts,
    oy + r.hoop.y * ts,
    r.hoop.rx * ts,
    r.hoop.ry * ts,
    0,
    0,
    TWO_PI,
  );
  ctx.stroke();
}

/** How a burst cask flies apart, in source pixels. */
const CASK_SHATTER = {
  shardCount: 22,
  shardLength: 14,
  shardWidth: 4,
  spread: 40,
  halfWidth: 48,
  burstHeightTiles: 0.45,
} as const;

export const WINE_CASK_PAINTER: CellarPiecePainter = {
  tilesWide: TILES_WIDE,
  variants: VARIANTS,
  paint: paintCask,
  paintRemains: paintCaskRemains,
  shatter: {
    shades: [OAK.mid, OAK.lit, OAK.shade, WINE_STAIN],
    edge: OAK.deep,
    dustRgb: '110,40,40',
    shardCount: CASK_SHATTER.shardCount,
    shardLength: CASK_SHATTER.shardLength,
    shardWidth: CASK_SHATTER.shardWidth,
    spread: CASK_SHATTER.spread,
    halfWidth: CASK_SHATTER.halfWidth,
  },
  burstHeightTiles: CASK_SHATTER.burstHeightTiles,
};
