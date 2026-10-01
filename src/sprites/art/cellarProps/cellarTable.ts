/**
 * A guardroom trestle table two tiles long, with a stool at each end and a
 * candle stub burning on the left of its top. The candle's flame is the one
 * bright thing on it; the lighting pass throws its glow.
 *
 * The top is a deep, lit plane of boards seen from above, with a thick front
 * edge, the legs and the dark under it below — so it reads as a table and not
 * as a bench. Variants differ in what lies on the top — a mug, a heel of bread,
 * dice and a scatter of cards — never in the table itself.
 */

import { mulberry32 } from '../../person/rng';
import type { CellarPiecePainter, PieceOrigin } from './cellarPiece';
import {
  HALF,
  HOLLOW,
  OAK,
  TALLOW,
  TWO_PI,
  contactShadow,
  crackLine,
  frontGradient,
  line,
  polygon,
  shard,
  wash,
  type Ctx,
} from './cellarPaint';
import { paintCandleFlame } from './candleFlame';

const TABLE_SEED = 0x7ab1;
/** The remains draw from their own stream, apart from the standing table's. */
const REMAINS_SEED = TABLE_SEED * 17;
/** The clutter on the top draws from its own stream too. */
const CLUTTER_SEED_STEP = 3;
const VARIANTS = 4;
const TILES_WIDE = 2;

/** The table, in tile fractions across its two-tile footprint. */
const TABLE = {
  leftX: 0.12,
  rightX: 1.88,
  /** The top's back edge climbs a little above the tile, as a deep table's would. */
  topBackY: -0.1,
  topFrontY: 0.4,
  /** The thick front edge of the top, then the apron under it. */
  edgeY: 0.47,
  apronY: 0.56,
  floorY: 0.92,
  legInset: 0.1,
  legWidth: 0.09,
  /** The back legs stand this far behind the front ones, half hidden in the dark under the top. */
  backLegRise: 0.18,
  stretcherY: 0.76,
  stretcherHeight: 0.04,
  boardSeams: [0.25, 0.5, 0.75],
  seamAlpha: 0.45,
  outlineWidth: 1.5,
  /** The candle stub stands over the anchor tile's centre, where its light is registered. */
  candleX: 0.5,
  candleBaseY: 0.14,
  candleHeight: 0.14,
  candleWidth: 0.07,
} as const;

/** The dark under the top, between the legs. */
const UNDER = { rgb: '8,5,3', alpha: 0.7 } as const;
const SHADOW = { rx: 0.92, ry: 0.12 } as const;

/** A stool in front of each end, tucked half under the table. */
const STOOL = {
  xs: [0.3, 1.66],
  seatY: 0.66,
  seatRx: 0.15,
  seatRy: 0.06,
  seatThickness: 0.05,
  floorY: 0.95,
  legWidth: 0.04,
  /** Three legs, splayed out from under the seat, as shares of its half-width. */
  legSplay: [-0.6, 0, 0.6],
  legTop: 0.8,
  shadowSwell: 1.1,
  shadowRy: 0.05,
} as const;

/** The candle stub: a puddle of wax round its foot, a lit left side, a wick. */
const CANDLE = {
  puddleSpread: 2,
  puddleDepth: 0.7,
  litStop: 0.4,
  topShare: 0.45,
  wick: 0.03,
  wickWidth: 1.5,
  flameLift: 0.02,
} as const;

/** What lies on the top, in tile fractions from the top's back edge and the table's left. */
const CLUTTER = {
  rowY: 0.18,
  mug: { x: 1.1, xSpread: 0.3, w: 0.1, h: 0.12, rimRy: 0.02, handle: 0.03, handleWidth: 2 },
  bread: { x: 0.9, dy: 0.06, rx: 0.1, ry: 0.05, angle: -0.2 },
  cards: { count: 3, x: 1.3, step: 0.09, jitter: 0.08, turn: 0.8, w: 0.08, h: 0.06 },
  dice: [
    [1.05, 0.03],
    [1.12, -0.01],
  ],
  die: 0.04,
} as const;
const MUG_COLOUR = '#5b4a3a';
const BREAD_COLOUR = '#a27a45';
const DIE_COLOUR = '#d9cfb4';
const CARD_COLOUR = '#c9bc98';
const MUG_VARIANTS: ReadonlySet<number> = new Set([0, 2]);
const BREAD_VARIANTS: ReadonlySet<number> = new Set([1, 2]);
const CARD_VARIANTS: ReadonlySet<number> = new Set([1, 3]);

/** A struck table: a split across the top and a corner knocked off its front edge. */
const STRUCK = {
  crackFromX: 1.2,
  crackToX: 1.32,
  wobble: 0.04,
  notch: [
    [1.6, 0.4],
    [1.74, 0.4],
    [1.68, 0.5],
  ],
} as const;

function tableTop(ctx: Ctx, at: PieceOrigin): void {
  const { ox, oy, ts } = at;
  const left = ox + TABLE.leftX * ts;
  const right = ox + TABLE.rightX * ts;
  const back = oy + TABLE.topBackY * ts;
  const front = oy + TABLE.topFrontY * ts;
  const edge = oy + TABLE.edgeY * ts;
  const apron = oy + TABLE.apronY * ts;
  // The top: boards running its length, lit from above, brightest at the front.
  const top = ctx.createLinearGradient(0, back, 0, front);
  top.addColorStop(0, OAK.mid);
  top.addColorStop(1, OAK.lit);
  ctx.fillStyle = top;
  ctx.fillRect(left, back, right - left, front - back);
  ctx.save();
  ctx.globalAlpha = TABLE.seamAlpha;
  for (const fraction of TABLE.boardSeams) {
    const y = back + (front - back) * fraction;
    line(ctx, left, y, right, y, OAK.deep, 1);
  }
  ctx.restore();
  // The thick front edge catches the light along its lip.
  ctx.fillStyle = OAK.rim;
  ctx.fillRect(left, front, right - left, edge - front);
  ctx.fillStyle = frontGradient(ctx, left, edge, apron, OAK);
  ctx.fillRect(left, edge, right - left, apron - edge);
  ctx.strokeStyle = OAK.deep;
  ctx.lineWidth = TABLE.outlineWidth;
  ctx.strokeRect(left, back, right - left, apron - back);
  line(ctx, left, edge, right, edge, OAK.shade, 1);
}

function legs(ctx: Ctx, at: PieceOrigin): void {
  const { ox, oy, ts } = at;
  const apron = oy + TABLE.apronY * ts;
  const floor = oy + TABLE.floorY * ts;
  const width = TABLE.legWidth * ts;
  const legXs = [TABLE.leftX + TABLE.legInset, TABLE.rightX - TABLE.legInset - TABLE.legWidth];
  // The dark under the top, with the back legs standing in it.
  const left = ox + TABLE.leftX * ts;
  const right = ox + TABLE.rightX * ts;
  ctx.fillStyle = `rgba(${UNDER.rgb},${UNDER.alpha})`;
  ctx.fillRect(left, apron, right - left, floor - apron - TABLE.backLegRise * ts);
  for (const x of legXs) {
    ctx.fillStyle = OAK.deep;
    ctx.fillRect(ox + x * ts, apron, width, floor - apron - TABLE.backLegRise * ts);
  }
  ctx.fillStyle = OAK.deep;
  ctx.fillRect(
    ox + legXs[0] * ts,
    oy + TABLE.stretcherY * ts,
    (legXs[1] - legXs[0]) * ts,
    TABLE.stretcherHeight * ts,
  );
  for (const x of legXs) {
    ctx.fillStyle = frontGradient(ctx, ox + x * ts, apron, floor, OAK);
    ctx.fillRect(ox + x * ts, apron, width, floor - apron);
    ctx.fillStyle = OAK.deep;
    ctx.fillRect(
      ox + x * ts + width - TABLE.outlineWidth,
      apron,
      TABLE.outlineWidth,
      floor - apron,
    );
  }
}

function stool(ctx: Ctx, at: PieceOrigin, x: number): void {
  const { ox, oy, ts } = at;
  const cx = ox + x * ts;
  const seat = oy + STOOL.seatY * ts;
  const floor = oy + STOOL.floorY * ts;
  const seatRx = STOOL.seatRx * ts;
  contactShadow(ctx, cx, floor, seatRx * STOOL.shadowSwell, STOOL.shadowRy * ts);
  for (const dx of STOOL.legSplay) {
    line(
      ctx,
      cx + dx * seatRx * STOOL.legTop,
      seat,
      cx + dx * seatRx,
      floor,
      OAK.shade,
      STOOL.legWidth * ts,
    );
  }
  const thickness = STOOL.seatThickness * ts;
  ctx.fillStyle = frontGradient(ctx, cx, seat, seat + thickness, OAK);
  ctx.beginPath();
  ctx.ellipse(cx, seat + thickness * HALF, seatRx, STOOL.seatRy * ts, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = OAK.rim;
  ctx.beginPath();
  ctx.ellipse(cx, seat, seatRx, STOOL.seatRy * ts, 0, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = OAK.deep;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function candleStub(ctx: Ctx, at: PieceOrigin): void {
  const { ox, oy, ts } = at;
  const cx = ox + TABLE.candleX * ts;
  const base = oy + TABLE.candleBaseY * ts;
  const height = TABLE.candleHeight * ts;
  const half = (TABLE.candleWidth * ts) / 2;
  ctx.fillStyle = TALLOW.shade;
  ctx.beginPath();
  ctx.ellipse(cx, base, half * CANDLE.puddleSpread, half * CANDLE.puddleDepth, 0, 0, TWO_PI);
  ctx.fill();
  const body = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
  body.addColorStop(0, TALLOW.rim);
  body.addColorStop(CANDLE.litStop, TALLOW.lit);
  body.addColorStop(1, TALLOW.shade);
  ctx.fillStyle = body;
  ctx.fillRect(cx - half, base - height, half * 2, height);
  ctx.fillStyle = TALLOW.rim;
  ctx.beginPath();
  ctx.ellipse(cx, base - height, half, half * CANDLE.topShare, 0, 0, TWO_PI);
  ctx.fill();
  line(ctx, cx, base - height, cx, base - height - CANDLE.wick * ts, HOLLOW, CANDLE.wickWidth);
  paintCandleFlame(ctx, cx, base - height - CANDLE.flameLift * ts, ts, 0);
}

function clutter(ctx: Ctx, at: PieceOrigin, variant: number): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(TABLE_SEED + variant * CLUTTER_SEED_STEP);
  const rowY = oy + (TABLE.topBackY + CLUTTER.rowY) * ts;
  if (MUG_VARIANTS.has(variant)) {
    const m = CLUTTER.mug;
    const x = ox + (m.x + rng() * m.xSpread) * ts;
    ctx.fillStyle = MUG_COLOUR;
    ctx.fillRect(x, rowY - m.h * ts, m.w * ts, m.h * ts);
    ctx.fillStyle = HOLLOW;
    ctx.beginPath();
    ctx.ellipse(x + (m.w * ts) / 2, rowY - m.h * ts, (m.w * ts) / 2, m.rimRy * ts, 0, 0, TWO_PI);
    ctx.fill();
    line(
      ctx,
      x + m.w * ts,
      rowY - m.h * ts * HALF,
      x + (m.w + m.handle) * ts,
      rowY - m.h * ts * HALF + m.handle * ts,
      MUG_COLOUR,
      m.handleWidth,
    );
  }
  if (BREAD_VARIANTS.has(variant)) {
    const b = CLUTTER.bread;
    ctx.fillStyle = BREAD_COLOUR;
    ctx.beginPath();
    ctx.ellipse(ox + b.x * ts, rowY + b.dy * ts, b.rx * ts, b.ry * ts, b.angle, 0, TWO_PI);
    ctx.fill();
  }
  if (CARD_VARIANTS.has(variant)) {
    const c = CLUTTER.cards;
    for (let card = 0; card < c.count; card++) {
      ctx.save();
      ctx.translate(ox + (c.x + card * c.step) * ts, rowY + (rng() - HALF) * c.jitter * ts);
      ctx.rotate((rng() - HALF) * c.turn);
      ctx.fillStyle = CARD_COLOUR;
      ctx.fillRect((-c.w / 2) * ts, (-c.h / 2) * ts, c.w * ts, c.h * ts);
      ctx.restore();
    }
    ctx.fillStyle = DIE_COLOUR;
    for (const [x, dy] of CLUTTER.dice) {
      ctx.fillRect(ox + x * ts, rowY + dy * ts, CLUTTER.die * ts, CLUTTER.die * ts);
    }
  }
}

function paintTable(ctx: Ctx, at: PieceOrigin, variant: number, damaged: boolean): void {
  const { ox, oy, ts } = at;
  contactShadow(ctx, ox + ts, oy + TABLE.floorY * ts, SHADOW.rx * ts, SHADOW.ry * ts);
  legs(ctx, at);
  tableTop(ctx, at);
  clutter(ctx, at, variant);
  candleStub(ctx, at);
  if (damaged) {
    const rng = mulberry32(TABLE_SEED + variant);
    crackLine(
      ctx,
      ox + STRUCK.crackFromX * ts,
      oy + TABLE.topBackY * ts,
      ox + STRUCK.crackToX * ts,
      oy + TABLE.apronY * ts,
      STRUCK.wobble * ts,
      rng,
    );
    ctx.fillStyle = HOLLOW;
    polygon(
      ctx,
      STRUCK.notch.map(([x, y]): [number, number] => [ox + x * ts, oy + y * ts]),
    );
    ctx.fill();
  }
  for (const x of STOOL.xs) stool(ctx, at, x);
}

const PLANK_PIECES = 8;

/** What a smashed table leaves, in tile fractions across its footprint. */
const REMAINS = {
  wash: { y: 0.7, rx: 0.9, ry: 0.2, rgb: '28,20,12', alpha: 0.35 },
  planks: { x: 0.25, spreadX: 1.5, y: 0.5, spreadY: 0.36, length: 0.35, lengthSpread: 0.35 },
  plankWidth: 0.09,
  plankTwist: 0.7,
  litPlankChance: 0.5,
  stool: { x: 1.6, y: 0.78, rx: 0.06, ry: 0.13 },
  stub: { x: 0.5, y: 0.8, w: 0.12, h: 0.05 },
} as const;

function paintTableRemains(ctx: Ctx, at: PieceOrigin, variant: number): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(REMAINS_SEED + variant);
  const r = REMAINS;
  wash(ctx, ox + ts, oy + r.wash.y * ts, r.wash.rx * ts, r.wash.ry * ts, r.wash.rgb, r.wash.alpha);
  for (let index = 0; index < PLANK_PIECES; index++) {
    shard(
      ctx,
      ox + (r.planks.x + rng() * r.planks.spreadX) * ts,
      oy + (r.planks.y + rng() * r.planks.spreadY) * ts,
      (r.planks.length + rng() * r.planks.lengthSpread) * ts,
      r.plankWidth * ts,
      (rng() - HALF) * r.plankTwist,
      rng() < r.litPlankChance ? OAK.mid : OAK.lit,
      OAK.deep,
    );
  }
  // A stool that survived, knocked on its side, and the snuffed stub.
  ctx.fillStyle = OAK.lit;
  ctx.beginPath();
  ctx.ellipse(
    ox + r.stool.x * ts,
    oy + r.stool.y * ts,
    r.stool.rx * ts,
    r.stool.ry * ts,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillStyle = TALLOW.mid;
  ctx.fillRect(ox + r.stub.x * ts, oy + r.stub.y * ts, r.stub.w * ts, r.stub.h * ts);
}

/** How a smashed table flies apart, in source pixels. */
const TABLE_SHATTER = {
  shardCount: 20,
  shardLength: 16,
  shardWidth: 4,
  spread: 38,
  halfWidth: 44,
  burstHeightTiles: 0.45,
} as const;

export const CELLAR_TABLE_PAINTER: CellarPiecePainter = {
  tilesWide: TILES_WIDE,
  variants: VARIANTS,
  paint: paintTable,
  paintRemains: paintTableRemains,
  shatter: {
    shades: [OAK.mid, OAK.lit, OAK.shade, TALLOW.lit],
    edge: OAK.deep,
    dustRgb: '150,120,90',
    shardCount: TABLE_SHATTER.shardCount,
    shardLength: TABLE_SHATTER.shardLength,
    shardWidth: TABLE_SHATTER.shardWidth,
    spread: TABLE_SHATTER.spread,
    halfWidth: TABLE_SHATTER.halfWidth,
  },
  burstHeightTiles: TABLE_SHATTER.burstHeightTiles,
};
