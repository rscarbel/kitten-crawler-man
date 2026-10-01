/**
 * A clay storage urn: a round belly on a narrow foot, a short neck and a lip,
 * with two loop handles at the shoulder. One silhouette; the variants differ
 * in the painted band, a stopper, a damp tide-mark and a chipped lip.
 */

import { mulberry32 } from '../../person/rng';
import type { CellarPiecePainter, PieceOrigin } from './cellarPiece';
import {
  CLAY,
  GRAIN,
  GRAIN_SHADE,
  HOLLOW,
  OAK,
  TWO_PI,
  contactShadow,
  crackLine,
  HALF,
  line,
  polygon,
  shard,
  sideLitGradient,
  wash,
  type Ctx,
} from './cellarPaint';

const URN_SEED = 0x51a7;
/** The remains draw from their own stream, so the wreckage never repeats the standing urn's marks. */
const REMAINS_SEED = URN_SEED * 3;
const VARIANTS = 4;

/** Shape of the pot, in tile fractions from the tile's top-left corner. */
const URN = {
  centreX: 0.5,
  lipY: 0.06,
  lipRx: 0.15,
  lipRy: 0.05,
  neckY: 0.2,
  neckRx: 0.1,
  bellyY: 0.52,
  bellyRx: 0.33,
  footY: 0.88,
  footRx: 0.16,
  footRy: 0.05,
  handleY: 0.27,
  handleReach: 0.3,
  handleDrop: 0.14,
  handleWidth: 0.045,
  bandY: 0.42,
  bandHeight: 0.07,
  tideY: 0.7,
  shadowRx: 0.32,
  shadowRy: 0.08,
  /** Where along the neck the lip's curve pulls in to the neck. */
  lipCurveAlong: 0.5,
  /** The belly swells past its own radius before it turns under. */
  bellySwell: 1.08,
  /** Where the side tucks in under the belly, as a share of the radius and of the drop to the foot. */
  bellyTuck: 0.92,
  bellyTuckAlong: 0.45,
  /** The control point that draws the side in to the foot. */
  footPull: 0.6,
  footPullRise: 0.02,
  handleRise: 0.05,
  handleArc: 0.06,
  /** How far out the handle's foot lands, as a share of its full reach. */
  handleLanding: 0.7,
  outlineWidth: 1.5,
} as const;

/** The washes that model the belly, in tile fractions from the pot's centre line. */
const BELLY_SHADE = { dx: 0.12, y: 0.86, rx: 0.42, ry: 0.26, rgb: '20,8,4' } as const;
const SHOULDER_LIGHT = { dx: -0.12, y: 0.33, rx: 0.16, ry: 0.1, rgb: '230,170,120' } as const;

/** The painted band round the belly. */
const BAND = { alpha: 0.55, overhang: 1.1, ry: 0.06 } as const;
/** The damp tide-mark low on the belly. */
const TIDE = { drop: 0.12, rx: 0.42, ry: 0.14 } as const;

/** The mouth: the throat or stopper inside the lip. */
const MOUTH = { drop: 0.005, rxShare: 0.7, ryShare: 0.62, stopperBand: 0.03 } as const;
/** The bite out of a chipped lip, as offsets from the lip's centre. */
const LIP_CHIP = { startX: 0.04, notchX: 0.1, notchDrop: 0.01, endX: 0.14, endShare: 0.4 } as const;

type TileOffset = readonly [number, number];

/** The two cracks a struck urn shows, from and to, in tile fractions from the pot's centre line. */
const CRACKS: ReadonlyArray<{
  readonly from: TileOffset;
  readonly to: TileOffset;
  readonly wobble: number;
}> = [
  { from: [-0.06, 0.24], to: [0.04, 0.72], wobble: 0.05 },
  { from: [0.02, 0.5], to: [0.2, 0.62], wobble: 0.03 },
];
/** The sherd knocked out of a struck urn's belly. */
const SHERD_HOLE: ReadonlyArray<TileOffset> = [
  [0.09, 0.4],
  [0.15, 0.36],
  [0.22, 0.41],
  [0.17, 0.44],
  [0.19, 0.5],
  [0.12, 0.47],
];
/** The hole's lower edge, which catches the light. */
const SHERD_HOLE_LIT_EDGE = { from: [0.12, 0.47], to: [0.19, 0.5] } as const;

const BAND_COLOUR = '#3b1d12';
const TIDE_RGB = '30,22,16';
const TIDE_ALPHA = 0.35;
const HIGHLIGHT_ALPHA = 0.28;
const SHADE_ALPHA = 0.4;

/** Which details each variant wears. */
const VARIANT_DETAILS = [
  { band: true, stopper: false, tide: false, chippedLip: false },
  { band: false, stopper: true, tide: true, chippedLip: false },
  { band: true, stopper: false, tide: true, chippedLip: true },
  { band: false, stopper: false, tide: false, chippedLip: true },
] as const;

function urnPath(ctx: Ctx, cx: number, oy: number, ts: number): void {
  const lipY = oy + URN.lipY * ts;
  const neckY = oy + URN.neckY * ts;
  const bellyY = oy + URN.bellyY * ts;
  const footY = oy + URN.footY * ts;
  const neck = URN.neckRx * ts;
  const lip = URN.lipRx * ts;
  const belly = URN.bellyRx * ts;
  const foot = URN.footRx * ts;
  ctx.beginPath();
  ctx.moveTo(cx - lip, lipY);
  const lipCurveY = lipY + (neckY - lipY) * URN.lipCurveAlong;
  const tuckY = bellyY + (footY - bellyY) * URN.bellyTuckAlong;
  const footPullY = footY - URN.footPullRise * ts;
  ctx.quadraticCurveTo(cx - neck, lipCurveY, cx - neck, neckY);
  ctx.bezierCurveTo(
    cx - belly,
    neckY,
    cx - belly * URN.bellySwell,
    bellyY,
    cx - belly * URN.bellyTuck,
    tuckY,
  );
  ctx.quadraticCurveTo(cx - belly * URN.footPull, footPullY, cx - foot, footY);
  ctx.ellipse(cx, footY, foot, URN.footRy * ts, 0, Math.PI, 0, true);
  ctx.quadraticCurveTo(cx + belly * URN.footPull, footPullY, cx + belly * URN.bellyTuck, tuckY);
  ctx.bezierCurveTo(cx + belly * URN.bellySwell, bellyY, cx + belly, neckY, cx + neck, neckY);
  ctx.quadraticCurveTo(cx + neck, lipCurveY, cx + lip, lipY);
  ctx.closePath();
}

function handle(ctx: Ctx, cx: number, oy: number, ts: number, side: 1 | -1, colour: string) {
  const startX = cx + side * URN.neckRx * ts;
  const y = oy + URN.handleY * ts;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = URN.handleWidth * ts;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(startX, y - URN.handleRise * ts);
  ctx.quadraticCurveTo(
    cx + side * (URN.neckRx + URN.handleReach) * ts,
    y - URN.handleArc * ts,
    cx + side * (URN.neckRx + URN.handleReach * URN.handleLanding) * ts,
    y + URN.handleDrop * ts,
  );
  ctx.stroke();
  ctx.restore();
}

function paintUrn(ctx: Ctx, at: PieceOrigin, variant: number, damaged: boolean): void {
  const { ox, oy, ts } = at;
  const details = VARIANT_DETAILS[variant % VARIANTS] ?? VARIANT_DETAILS[0];
  const rng = mulberry32(URN_SEED + variant);
  const cx = ox + URN.centreX * ts;
  const bellyLeft = cx - URN.bellyRx * ts;
  const bellyRight = cx + URN.bellyRx * ts;

  contactShadow(ctx, cx, oy + URN.footY * ts, URN.shadowRx * ts, URN.shadowRy * ts);

  handle(ctx, cx, oy, ts, 1, CLAY.shade);
  urnPath(ctx, cx, oy, ts);
  ctx.save();
  ctx.fillStyle = sideLitGradient(ctx, bellyLeft, bellyRight, oy + URN.bellyY * ts, CLAY);
  ctx.fill();
  ctx.clip();

  // The belly turns away from the light below its widest point: a soft dark
  // band across the lower half, offset down and right of the lit shoulder.
  for (const [form, alpha] of [
    [BELLY_SHADE, SHADE_ALPHA],
    [SHOULDER_LIGHT, HIGHLIGHT_ALPHA],
  ] as const) {
    wash(ctx, cx + form.dx * ts, oy + form.y * ts, form.rx * ts, form.ry * ts, form.rgb, alpha);
  }

  if (details.band) {
    ctx.fillStyle = BAND_COLOUR;
    ctx.globalAlpha = BAND.alpha;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      oy + URN.bandY * ts,
      URN.bellyRx * ts * BAND.overhang,
      BAND.ry * ts,
      0,
      0,
      Math.PI,
    );
    ctx.ellipse(
      cx,
      oy + (URN.bandY + URN.bandHeight) * ts,
      URN.bellyRx * ts * BAND.overhang,
      BAND.ry * ts,
      0,
      Math.PI,
      0,
      true,
    );
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (details.tide) {
    wash(
      ctx,
      cx,
      oy + (URN.tideY + TIDE.drop) * ts,
      TIDE.rx * ts,
      TIDE.ry * ts,
      TIDE_RGB,
      TIDE_ALPHA,
    );
  }
  ctx.restore();

  ctx.save();
  urnPath(ctx, cx, oy, ts);
  ctx.strokeStyle = CLAY.deep;
  ctx.lineWidth = URN.outlineWidth;
  ctx.stroke();
  ctx.restore();
  handle(ctx, cx, oy, ts, -1, CLAY.mid);

  // The mouth: a lit lip round a dark throat, or a wooden stopper.
  const lipY = oy + URN.lipY * ts;
  ctx.fillStyle = CLAY.rim;
  ctx.beginPath();
  ctx.ellipse(cx, lipY, URN.lipRx * ts, URN.lipRy * ts, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = details.stopper ? OAK.lit : HOLLOW;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    lipY + MOUTH.drop * ts,
    URN.lipRx * ts * MOUTH.rxShare,
    URN.lipRy * ts * MOUTH.ryShare,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  if (details.stopper) {
    ctx.fillStyle = OAK.shade;
    ctx.fillRect(
      cx - URN.lipRx * ts * MOUTH.rxShare,
      lipY,
      URN.lipRx * ts * MOUTH.rxShare * 2,
      MOUTH.stopperBand * ts,
    );
  }
  if (details.chippedLip) {
    ctx.fillStyle = CLAY.shade;
    ctx.beginPath();
    ctx.moveTo(cx + LIP_CHIP.startX * ts, lipY - URN.lipRy * ts);
    ctx.lineTo(cx + LIP_CHIP.notchX * ts, lipY - LIP_CHIP.notchDrop * ts);
    ctx.lineTo(cx + LIP_CHIP.endX * ts, lipY - URN.lipRy * ts * LIP_CHIP.endShare);
    ctx.closePath();
    ctx.fill();
  }

  if (damaged) {
    const at = ([dx, dy]: TileOffset): [number, number] => [cx + dx * ts, oy + dy * ts];
    for (const crack of CRACKS) {
      const [x0, y0] = at(crack.from);
      const [x1, y1] = at(crack.to);
      crackLine(ctx, x0, y0, x1, y1, crack.wobble * ts, rng);
    }
    // A sherd knocked out of the belly, showing the dark inside.
    ctx.fillStyle = HOLLOW;
    polygon(ctx, SHERD_HOLE.map(at));
    ctx.fill();
    // The broken edge's lower lip catches the light; the upper sits in shadow.
    const [edgeX0, edgeY0] = at(SHERD_HOLE_LIT_EDGE.from);
    const [edgeX1, edgeY1] = at(SHERD_HOLE_LIT_EDGE.to);
    line(ctx, edgeX0, edgeY0, edgeX1, edgeY1, CLAY.rim, URN.outlineWidth);
  }
}

const SHERD_COUNT = 6;
const GRAIN_FLECKS = 18;
const GRAIN_FLECK_SIZE = 2;
/** Even odds a fleck takes the darker grain. */
const GRAIN_SHADE_CHANCE = 0.5;

/** What a broken urn leaves, in tile fractions from its centre line and foot. */
const REMAINS = {
  grainWash: { dx: 0.06, rise: 0.08, rx: 0.34, ry: 0.14, rgb: '150,124,70', alpha: 0.55 },
  /** Grain flecks fan out mostly to the right of the foot, across this spread. */
  grainBias: 0.3,
  grainSpreadX: 0.6,
  grainSpreadY: 0.18,
  dampWash: { rise: 0.06, rx: 0.32, ry: 0.13, rgb: '24,16,12', alpha: 0.4 },
  ringDx: -0.05,
  ringRise: 0.03,
  ringRySwell: 1.2,
  holeRise: 0.04,
  holeShare: 0.7,
  sherdRise: 0.06,
  sherdReachMin: 0.18,
  sherdReachSpread: 0.2,
  /** Sherds lie flat, so their scatter is squashed down the tile. */
  sherdFlatten: 0.4,
  sherdLengthMin: 0.1,
  sherdLengthSpread: 0.08,
  sherdWidth: 0.06,
  litSherdChance: 0.5,
} as const;

function paintUrnRemains(ctx: Ctx, at: PieceOrigin, variant: number): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(REMAINS_SEED + variant);
  const cx = ox + URN.centreX * ts;
  const footY = oy + URN.footY * ts;
  const spilled = variant % 2 === 0;
  const r = REMAINS;
  if (spilled) {
    const grain = r.grainWash;
    wash(
      ctx,
      cx + grain.dx * ts,
      footY - grain.rise * ts,
      grain.rx * ts,
      grain.ry * ts,
      grain.rgb,
      grain.alpha,
    );
    ctx.fillStyle = GRAIN;
    for (let index = 0; index < GRAIN_FLECKS; index++) {
      const x = cx + (rng() - r.grainBias) * r.grainSpreadX * ts;
      const y = footY - grain.rise * ts + (rng() - HALF) * r.grainSpreadY * ts;
      ctx.fillStyle = rng() < GRAIN_SHADE_CHANCE ? GRAIN : GRAIN_SHADE;
      ctx.fillRect(x, y, GRAIN_FLECK_SIZE, GRAIN_FLECK_SIZE);
    }
  } else {
    const damp = r.dampWash;
    wash(ctx, cx, footY - damp.rise * ts, damp.rx * ts, damp.ry * ts, damp.rgb, damp.alpha);
  }
  // The foot often survives as a broken ring.
  ctx.fillStyle = CLAY.shade;
  ctx.beginPath();
  ctx.ellipse(
    cx + r.ringDx * ts,
    footY - r.ringRise * ts,
    URN.footRx * ts,
    URN.footRy * ts * r.ringRySwell,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillStyle = HOLLOW;
  ctx.beginPath();
  ctx.ellipse(
    cx + r.ringDx * ts,
    footY - r.holeRise * ts,
    URN.footRx * ts * r.holeShare,
    URN.footRy * ts * r.holeShare,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  for (let index = 0; index < SHERD_COUNT; index++) {
    const angle = rng() * TWO_PI;
    const reach = (r.sherdReachMin + rng() * r.sherdReachSpread) * ts;
    shard(
      ctx,
      cx + Math.cos(angle) * reach,
      footY - r.sherdRise * ts + Math.sin(angle) * reach * r.sherdFlatten,
      (r.sherdLengthMin + rng() * r.sherdLengthSpread) * ts,
      r.sherdWidth * ts,
      rng() * Math.PI,
      rng() < r.litSherdChance ? CLAY.mid : CLAY.lit,
      CLAY.deep,
    );
  }
}

/** How a broken urn flies apart: many small curved sherds out of its belly, in source pixels. */
const URN_SHATTER = {
  shardCount: 14,
  shardLength: 9,
  shardWidth: 5,
  spread: 34,
  halfWidth: 6,
  burstHeightTiles: 0.5,
} as const;

export const CLAY_URN_PAINTER: CellarPiecePainter = {
  tilesWide: 1,
  variants: VARIANTS,
  paint: paintUrn,
  paintRemains: paintUrnRemains,
  shatter: {
    shades: [CLAY.mid, CLAY.lit, CLAY.shade, CLAY.rim],
    edge: CLAY.deep,
    dustRgb: '150,110,80',
    shardCount: URN_SHATTER.shardCount,
    shardLength: URN_SHATTER.shardLength,
    shardWidth: URN_SHATTER.shardWidth,
    spread: URN_SHATTER.spread,
    halfWidth: URN_SHATTER.halfWidth,
  },
  burstHeightTiles: URN_SHATTER.burstHeightTiles,
};
