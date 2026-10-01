/**
 * A squared roof beam that came down with the vault: two tiles of dark,
 * heavy timber lying across the floor, one end propped up on a fallen block
 * and the other snapped to splinters. Its sawn end shows the growth rings.
 * Variants differ in which end is propped, the iron spikes left in it and the
 * rot along its top.
 */

import { mulberry32 } from '../../person/rng';
import type { CellarPiecePainter, PieceOrigin } from './cellarPiece';
import {
  HALF,
  LIMESTONE,
  RUST_IRON,
  contactShadow,
  crackLine,
  line,
  polygon,
  shard,
  wash,
  type Ctx,
  type Ramp,
} from './cellarPaint';

const BEAM_SEED = 0xbea3;
/** The remains draw from their own stream, apart from the standing beam's. */
const REMAINS_SEED = BEAM_SEED * 23;
const VARIANTS = 4;
const TILES_WIDE = 2;

/** Old roof timber, smoke-blackened and soaked: darker than any floor it lands on. */
const BEAM_TIMBER: Ramp = {
  deep: '#150f0b',
  shade: '#2a1f17',
  mid: '#3d2e22',
  lit: '#58442f',
  rim: '#7a6046',
};
/** The sawn end grain, paler than the weathered faces. */
const END_GRAIN = '#8a6a48';
const END_RING = '#5a4330';

/** The beam, in tile fractions across its two-tile footprint. */
const BEAM = {
  lowEndX: 0.08,
  highEndX: 1.82,
  lowEndY: 0.58,
  highEndY: 0.22,
  thickness: 0.32,
  topDepth: 0.2,
  floorY: 0.92,
  blockWidth: 0.34,
  /** The block the high end rests on starts this far down the beam's face. */
  blockSeat: 0.6,
  blockLitEdge: 0.06,
  outlineWidth: 2,
  grainLines: 3,
  grainAlpha: 0.45,
  /** The top face leans back by this share of its depth. */
  topLean: 0.4,
} as const;

/** The sawn end: a lit face with rings round the heart. */
const END = { rings: [0.75, 0.5, 0.25], ringWidth: 1.2 } as const;

/** The snapped end's splinters, as offsets out along the beam and down its face. */
const SPLINTERS = [
  [0, -1],
  [0.12, -0.2],
  [0.03, 0.2],
  [0.14, 0.5],
  [0.02, 0.75],
  [0.08, 1],
  [0, 1],
] as const;

/** Washes on and under the beam. */
const SHADOW = { rx: 0.94, ry: 0.12 } as const;
const UNDERSIDE = { rx: 0.9, ry: 0.12, rgb: '6,4,2', alpha: 0.45 } as const;
const ROT = { along: 0.4, rx: 0.4, ry: 0.06, rgb: '30,40,24', alpha: 0.55 } as const;
/** Variants from this one on carry rot along the top. */
const ROTTEN_FROM_VARIANT = 2;

/** Iron spikes left driven into the top, along the beam. */
const SPIKES = { at: [0.3, 0.62], lean: 0.03, height: 0.13, width: 2.5 } as const;
const SPIKED_VARIANTS: ReadonlySet<number> = new Set([1, 2]);

const CRACK_WOBBLE = 0.04;

interface BeamEnds {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function beamEnds(at: PieceOrigin, propRight: boolean): BeamEnds {
  const { ox, oy, ts } = at;
  const lowY = oy + BEAM.lowEndY * ts;
  const highY = oy + BEAM.highEndY * ts;
  return {
    x0: ox + BEAM.lowEndX * ts,
    y0: propRight ? lowY : highY,
    x1: ox + BEAM.highEndX * ts,
    y1: propRight ? highY : lowY,
  };
}

function propBlock(ctx: Ctx, at: PieceOrigin, x: number, top: number): void {
  const { oy, ts } = at;
  const floor = oy + BEAM.floorY * ts;
  const width = BEAM.blockWidth * ts;
  ctx.fillStyle = LIMESTONE.mid;
  ctx.fillRect(x, top, width, floor - top);
  ctx.fillStyle = LIMESTONE.rim;
  ctx.fillRect(x, top, width, BEAM.blockLitEdge * ts);
  ctx.strokeStyle = LIMESTONE.deep;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, top, width, floor - top);
}

function paintBeam(ctx: Ctx, at: PieceOrigin, variant: number, damaged: boolean): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(BEAM_SEED + variant);
  const propRight = variant % 2 === 0;
  const { x0, y0, x1, y1 } = beamEnds(at, propRight);
  const thick = BEAM.thickness * ts;
  const top = BEAM.topDepth * ts;
  const lean = top * BEAM.topLean;

  contactShadow(ctx, ox + ts, oy + BEAM.floorY * ts, SHADOW.rx * ts, SHADOW.ry * ts);
  const highX = propRight ? x1 - BEAM.blockWidth * ts : x0;
  const highY = propRight ? y1 : y0;
  propBlock(ctx, at, highX, highY + thick * BEAM.blockSeat);
  // The shadow the raised beam throws on the floor beneath it.
  wash(
    ctx,
    ox + ts,
    oy + BEAM.floorY * ts,
    UNDERSIDE.rx * ts,
    UNDERSIDE.ry * ts,
    UNDERSIDE.rgb,
    UNDERSIDE.alpha,
  );

  // Front face, mid-tone; the lit top above it.
  const face: ReadonlyArray<readonly [number, number]> = [
    [x0, y0],
    [x1, y1],
    [x1, y1 + thick],
    [x0, y0 + thick],
  ];
  const faceFill = ctx.createLinearGradient(0, Math.min(y0, y1), 0, Math.max(y0, y1) + thick);
  faceFill.addColorStop(0, BEAM_TIMBER.mid);
  faceFill.addColorStop(1, BEAM_TIMBER.shade);
  ctx.fillStyle = faceFill;
  polygon(ctx, face);
  ctx.fill();
  ctx.fillStyle = BEAM_TIMBER.lit;
  polygon(ctx, [
    [x0 + lean, y0 - top],
    [x1 + lean, y1 - top],
    [x1, y1],
    [x0, y0],
  ]);
  ctx.fill();
  line(ctx, x0, y0, x1, y1, BEAM_TIMBER.rim, 1);
  ctx.save();
  ctx.globalAlpha = BEAM.grainAlpha;
  for (let index = 1; index <= BEAM.grainLines; index++) {
    const f = index / (BEAM.grainLines + 1);
    line(ctx, x0, y0 + thick * f, x1, y1 + thick * f, BEAM_TIMBER.deep, 1);
  }
  ctx.restore();
  if (variant >= ROTTEN_FROM_VARIANT) {
    wash(
      ctx,
      x0 + (x1 - x0) * ROT.along,
      (y0 + y1) / 2 - top * HALF,
      ROT.rx * ts,
      ROT.ry * ts,
      ROT.rgb,
      ROT.alpha,
    );
  }

  // The sawn end shows its rings; the snapped end is a jagged lip of splinters.
  const sawnX = propRight ? x1 : x0;
  const sawnY = propRight ? y1 : y0;
  const end: ReadonlyArray<readonly [number, number]> = [
    [sawnX, sawnY],
    [sawnX + lean, sawnY - top],
    [sawnX + lean, sawnY - top + thick],
    [sawnX, sawnY + thick],
  ];
  ctx.fillStyle = END_GRAIN;
  polygon(ctx, end);
  ctx.fill();
  const heartX = sawnX + lean / 2;
  const heartY = sawnY - top / 2 + thick / 2;
  ctx.strokeStyle = END_RING;
  ctx.lineWidth = END.ringWidth;
  for (const share of END.rings) {
    ctx.beginPath();
    ctx.ellipse(heartX, heartY, (lean / 2) * share, (thick / 2) * share, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  const snappedX = propRight ? x0 : x1;
  const snappedY = propRight ? y0 : y1;
  const outward = propRight ? -1 : 1;
  ctx.fillStyle = BEAM_TIMBER.rim;
  polygon(
    ctx,
    SPLINTERS.map(([out, down]): [number, number] => [
      snappedX + outward * out * ts,
      down < 0 ? snappedY - top : snappedY + thick * down,
    ]),
  );
  ctx.fill();
  ctx.strokeStyle = BEAM_TIMBER.deep;
  ctx.lineWidth = BEAM.outlineWidth;
  polygon(ctx, face);
  ctx.stroke();
  if (SPIKED_VARIANTS.has(variant)) {
    for (const f of SPIKES.at) {
      const x = x0 + (x1 - x0) * f;
      const y = y0 + (y1 - y0) * f - top * HALF;
      line(ctx, x, y, x + SPIKES.lean * ts, y - SPIKES.height * ts, RUST_IRON.lit, SPIKES.width);
    }
  }
  if (damaged) {
    const midX = x0 + (x1 - x0) * HALF;
    crackLine(
      ctx,
      midX,
      (y0 + y1) / 2 - top,
      midX + CRACK_WOBBLE * ts,
      (y0 + y1) / 2 + thick,
      CRACK_WOBBLE * ts,
      rng,
    );
  }
}

const BEAM_PIECES = 6;

/** What a smashed beam leaves, in tile fractions across its footprint. */
const REMAINS = {
  wash: { y: 0.72, rx: 0.92, ry: 0.2, rgb: '30,24,18', alpha: 0.45 },
  pieces: { x: 0.25, spreadX: 1.5, y: 0.58, spreadY: 0.28, length: 0.3, lengthSpread: 0.3 },
  width: 0.14,
  twist: 0.6,
  litChance: 0.5,
} as const;

function paintBeamRemains(ctx: Ctx, at: PieceOrigin, variant: number): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(REMAINS_SEED + variant);
  const r = REMAINS;
  wash(ctx, ox + ts, oy + r.wash.y * ts, r.wash.rx * ts, r.wash.ry * ts, r.wash.rgb, r.wash.alpha);
  for (let index = 0; index < BEAM_PIECES; index++) {
    shard(
      ctx,
      ox + (r.pieces.x + rng() * r.pieces.spreadX) * ts,
      oy + (r.pieces.y + rng() * r.pieces.spreadY) * ts,
      (r.pieces.length + rng() * r.pieces.lengthSpread) * ts,
      r.width * ts,
      (rng() - HALF) * r.twist,
      rng() < r.litChance ? BEAM_TIMBER.mid : BEAM_TIMBER.lit,
      BEAM_TIMBER.deep,
    );
  }
}

/** How a smashed beam flies apart, in source pixels. */
const BEAM_SHATTER = {
  shardCount: 20,
  shardLength: 18,
  shardWidth: 6,
  spread: 30,
  halfWidth: 44,
  burstHeightTiles: 0.4,
} as const;

export const FALLEN_BEAM_PAINTER: CellarPiecePainter = {
  tilesWide: TILES_WIDE,
  variants: VARIANTS,
  paint: paintBeam,
  paintRemains: paintBeamRemains,
  shatter: {
    shades: [BEAM_TIMBER.mid, BEAM_TIMBER.lit, BEAM_TIMBER.shade, END_GRAIN],
    edge: BEAM_TIMBER.deep,
    dustRgb: '110,100,85',
    shardCount: BEAM_SHATTER.shardCount,
    shardLength: BEAM_SHATTER.shardLength,
    shardWidth: BEAM_SHATTER.shardWidth,
    spread: BEAM_SHATTER.spread,
    halfWidth: BEAM_SHATTER.halfWidth,
  },
  burstHeightTiles: BEAM_SHATTER.burstHeightTiles,
};
