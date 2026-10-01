/**
 * A hessian grain sack. Two of the variants stand, tied at the neck; two have
 * slumped over against the wall, their mouths fallen open. Every variant is the
 * same coarse sacking under the same light, so a row of them reads as one store.
 */

import { mulberry32 } from '../../person/rng';
import type { CellarPiecePainter, PieceOrigin } from './cellarPiece';
import {
  BURLAP,
  GRAIN,
  GRAIN_SHADE,
  HALF,
  HOLLOW,
  TWO_PI,
  contactShadow,
  crackLine,
  line,
  polygon,
  sideLitGradient,
  wash,
  type Ctx,
} from './cellarPaint';

const SACK_SEED = 0x5ac4;
/** The remains draw from their own stream, apart from the standing sack's. */
const REMAINS_SEED = SACK_SEED * 5;
const VARIANTS = 4;
/** Variants below this stand; the rest have slumped. */
const STANDING_VARIANTS = 2;
/** How far a standing sack may lean, across its whole range, in tiles. */
const LEAN_RANGE = 0.06;

type TileOffset = readonly [number, number];

/** A standing sack, in tile fractions. */
const STANDING = {
  centreX: 0.5,
  neckY: 0.1,
  tieY: 0.2,
  shoulderY: 0.34,
  baseY: 0.88,
  neckRx: 0.08,
  bodyRx: 0.34,
  baseRx: 0.36,
  earRise: 0.08,
  /** The gathered ears above the tie, as multiples of the neck's half-width. */
  earLeftReach: 1.4,
  earLeftNotch: 0.3,
  earRightTip: 0.4,
  earRightTipRise: 0.7,
  earRightReach: 1.3,
  earRightDrop: 0.01,
  shoulderDip: 0.04,
  /** The sides bulge past the body's half-width above the base. */
  sideSwell: 1.12,
  sideSwellRise: 0.25,
  baseCornerRise: 0.04,
  baseSag: 0.05,
  tieOverhang: 1.1,
  tieTilt: 0.01,
  tieWidth: 3,
} as const;

/** A slumped sack lying along the floor with its mouth toward the right. */
const SLUMPED = {
  leftX: 0.08,
  rightX: 0.86,
  topY: 0.38,
  baseY: 0.9,
  mouthX: 0.82,
  mouthY: 0.62,
  /** The curve over the sack's back, as offsets from its left end and top. */
  backFootRise: 0.06,
  backCurl: [-0.02, 0.05],
  backShoulder: [0.2, -0.04],
  backCrownX: 0.4,
  backFall: [0.58, 0.04],
  mouthLipPull: [-0.06, -0.18],
  mouthTopRise: 0.1,
  mouthLowerLip: [0.04, 0.08],
  bellyFall: 0.02,
  bellyUnder: [0.4, 0.03],
} as const;

/** Where the shadows and light sit, in tile fractions. */
const SHADOW = {
  standing: { x: 0.5, rx: 0.4, ry: 0.09 },
  slumped: { x: 0.48, rx: 0.46, ry: 0.09 },
} as const;
const BODY_LIGHT = { fromX: 0.1, toX: 0.9, y: 0.5 } as const;
const FLANK_SHADE = { x: 0.62, y: 0.95, rx: 0.5, ry: 0.28 } as const;

/** Folds and seams drawn on the sacking, in tile fractions. */
const FOLD_WIDTH = 2;
const SEAM_WIDTH = 1.5;
const STANDING_FOLDS: ReadonlyArray<readonly [TileOffset, TileOffset]> = [
  [
    [0.44, 0.24],
    [0.36, 0.5],
  ],
  [
    [0.56, 0.24],
    [0.64, 0.46],
  ],
];
const STANDING_SEAM: readonly [TileOffset, TileOffset] = [
  [0.76, 0.4],
  [0.8, 0.82],
];
const SLUMPED_FOLD: readonly [TileOffset, TileOffset] = [
  [0.3, 0.48],
  [0.5, 0.6],
];
/** A mended patch on alternate variants. */
const PATCH = { x: 0.26, y: 0.6, w: 0.16, h: 0.13 } as const;
const OUTLINE_WIDTH = 1.5;

/** The slumped sack's open mouth and the grain run out of it, from its mouth point. */
const MOUTH = { dx: 0.04, rx: 0.04, ry: 0.08 } as const;
const MOUTH_GRAIN = { dx: 0.06, dy: 0.12, rx: 0.08, ry: 0.04 } as const;

/** A struck sack's slit, and the grain heaped below it, from the slit's centre. */
const SLIT = {
  x: 0.45,
  standingY: 0.5,
  slumpedY: 0.62,
  halfLength: 0.12,
  fall: 0.06,
  wobble: 0.03,
  width: 3,
} as const;
const SLIT_GRAIN = {
  topLeft: [-0.06, 0.03],
  topRight: [0.04, 0.05],
  footRightX: 0.2,
  footLeftX: -0.18,
  floorY: 0.9,
  alpha: 0.85,
  heapDx: 0.01,
  heapRx: 0.2,
  heapRy: 0.04,
} as const;

const SEAM_ALPHA = 0.5;
const TIE_COLOUR = '#2f2414';
const SHADE_RGB = '24,16,8';
const SHADE_ALPHA = 0.45;
const WEAVE_ALPHA = 0.12;
const WEAVE_STEP = 4;
const PATCH_COLOUR = '#6f5a3a';

function standingPath(ctx: Ctx, at: PieceOrigin, lean: number): void {
  const { ox, oy, ts } = at;
  const s = STANDING;
  const cx = ox + s.centreX * ts;
  const neckY = oy + s.neckY * ts;
  const tieY = oy + s.tieY * ts;
  const shoulderY = oy + s.shoulderY * ts;
  const baseY = oy + s.baseY * ts;
  const neck = s.neckRx * ts;
  const body = s.bodyRx * ts;
  const base = s.baseRx * ts;
  const tilt = lean * ts;
  const shoulderCtrlY = shoulderY - s.shoulderDip * ts;
  const swellY = baseY - s.sideSwellRise * ts;
  const cornerY = baseY - s.baseCornerRise * ts;
  ctx.beginPath();
  // Gathered ears of cloth above the tie.
  ctx.moveTo(cx - neck * s.earLeftReach + tilt, neckY - s.earRise * ts);
  ctx.lineTo(cx - neck * s.earLeftNotch + tilt, neckY);
  ctx.lineTo(cx + neck * s.earRightTip + tilt, neckY - s.earRise * ts * s.earRightTipRise);
  ctx.lineTo(cx + neck * s.earRightReach + tilt, neckY + s.earRightDrop * ts);
  ctx.lineTo(cx + neck + tilt, tieY);
  ctx.bezierCurveTo(
    cx + body + tilt,
    shoulderCtrlY,
    cx + body * s.sideSwell,
    swellY,
    cx + base,
    cornerY,
  );
  ctx.quadraticCurveTo(cx, baseY + s.baseSag * ts, cx - base, cornerY);
  ctx.bezierCurveTo(
    cx - body * s.sideSwell,
    swellY,
    cx - body + tilt,
    shoulderCtrlY,
    cx - neck + tilt,
    tieY,
  );
  ctx.closePath();
}

function slumpedPath(ctx: Ctx, at: PieceOrigin): void {
  const { ox, oy, ts } = at;
  const s = SLUMPED;
  const left = ox + s.leftX * ts;
  const right = ox + s.rightX * ts;
  const top = oy + s.topY * ts;
  const base = oy + s.baseY * ts;
  const mouthX = ox + s.mouthX * ts;
  const mouthY = oy + s.mouthY * ts;
  const footY = base - s.backFootRise * ts;
  ctx.beginPath();
  ctx.moveTo(left, footY);
  ctx.bezierCurveTo(
    left + s.backCurl[0] * ts,
    top + s.backCurl[1] * ts,
    left + s.backShoulder[0] * ts,
    top + s.backShoulder[1] * ts,
    left + s.backCrownX * ts,
    top,
  );
  ctx.bezierCurveTo(
    left + s.backFall[0] * ts,
    top + s.backFall[1] * ts,
    mouthX + s.mouthLipPull[0] * ts,
    mouthY + s.mouthLipPull[1] * ts,
    right,
    mouthY - s.mouthTopRise * ts,
  );
  ctx.lineTo(right + s.mouthLowerLip[0] * ts, mouthY + s.mouthLowerLip[1] * ts);
  ctx.bezierCurveTo(
    mouthX,
    base - s.bellyFall * ts,
    left + s.bellyUnder[0] * ts,
    base + s.bellyUnder[1] * ts,
    left,
    footY,
  );
  ctx.closePath();
}

/** The sacking's weave: a faint diagonal hatch, kept wide enough to read as cloth and not as noise. */
function weave(ctx: Ctx, at: PieceOrigin): void {
  const { ox, oy, ts } = at;
  ctx.save();
  ctx.globalAlpha = WEAVE_ALPHA;
  ctx.strokeStyle = BURLAP.deep;
  ctx.lineWidth = 1;
  for (let offset = -ts; offset < ts; offset += WEAVE_STEP) {
    ctx.beginPath();
    ctx.moveTo(ox + offset, oy);
    ctx.lineTo(ox + offset + ts, oy + ts);
    ctx.stroke();
  }
  ctx.restore();
}

/** A straight stroke between two points given in tile fractions. */
function strokeAt(
  ctx: Ctx,
  at: PieceOrigin,
  [from, to]: readonly [TileOffset, TileOffset],
  colour: string,
  width: number,
): void {
  const { ox, oy, ts } = at;
  line(ctx, ox + from[0] * ts, oy + from[1] * ts, ox + to[0] * ts, oy + to[1] * ts, colour, width);
}

function paintSack(ctx: Ctx, at: PieceOrigin, variant: number, damaged: boolean): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(SACK_SEED + variant);
  const standing = variant < STANDING_VARIANTS;
  const lean = (rng() - HALF) * LEAN_RANGE;

  if (standing) {
    const shadow = SHADOW.standing;
    contactShadow(
      ctx,
      ox + shadow.x * ts,
      oy + STANDING.baseY * ts,
      shadow.rx * ts,
      shadow.ry * ts,
    );
    standingPath(ctx, at, lean);
  } else {
    const shadow = SHADOW.slumped;
    contactShadow(ctx, ox + shadow.x * ts, oy + SLUMPED.baseY * ts, shadow.rx * ts, shadow.ry * ts);
    slumpedPath(ctx, at);
  }
  ctx.save();
  ctx.fillStyle = sideLitGradient(
    ctx,
    ox + BODY_LIGHT.fromX * ts,
    ox + BODY_LIGHT.toX * ts,
    oy + BODY_LIGHT.y * ts,
    BURLAP,
  );
  ctx.fill();
  ctx.clip();
  weave(ctx, at);
  // Turning away from the light at the bottom and down the right flank.
  const flank = FLANK_SHADE;
  wash(
    ctx,
    ox + flank.x * ts,
    oy + flank.y * ts,
    flank.rx * ts,
    flank.ry * ts,
    SHADE_RGB,
    SHADE_ALPHA,
  );
  if (standing) {
    // Folds pulled down from the tie.
    for (const fold of STANDING_FOLDS) strokeAt(ctx, at, fold, BURLAP.shade, FOLD_WIDTH);
    // A stitched seam down the side.
    ctx.globalAlpha = SEAM_ALPHA;
    strokeAt(ctx, at, STANDING_SEAM, BURLAP.deep, SEAM_WIDTH);
    ctx.globalAlpha = 1;
  } else {
    strokeAt(ctx, at, SLUMPED_FOLD, BURLAP.shade, FOLD_WIDTH);
  }
  if (variant % 2 === 1) {
    ctx.fillStyle = PATCH_COLOUR;
    ctx.fillRect(ox + PATCH.x * ts, oy + PATCH.y * ts, PATCH.w * ts, PATCH.h * ts);
    ctx.strokeStyle = BURLAP.deep;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + PATCH.x * ts, oy + PATCH.y * ts, PATCH.w * ts, PATCH.h * ts);
  }
  ctx.restore();

  ctx.save();
  if (standing) standingPath(ctx, at, lean);
  else slumpedPath(ctx, at);
  ctx.strokeStyle = BURLAP.deep;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
  ctx.restore();

  if (standing) {
    const tieY = oy + STANDING.tieY * ts;
    const cx = ox + STANDING.centreX * ts + lean * ts;
    const tieHalf = STANDING.neckRx * ts * STANDING.tieOverhang;
    line(
      ctx,
      cx - tieHalf,
      tieY,
      cx + tieHalf,
      tieY + STANDING.tieTilt * ts,
      TIE_COLOUR,
      STANDING.tieWidth,
    );
  } else {
    // The open mouth, a little grain run out of it.
    const mouthX = ox + SLUMPED.mouthX * ts;
    const mouthY = oy + SLUMPED.mouthY * ts;
    ctx.fillStyle = HOLLOW;
    ctx.beginPath();
    ctx.ellipse(mouthX + MOUTH.dx * ts, mouthY, MOUTH.rx * ts, MOUTH.ry * ts, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = GRAIN;
    ctx.beginPath();
    ctx.ellipse(
      mouthX + MOUTH_GRAIN.dx * ts,
      mouthY + MOUTH_GRAIN.dy * ts,
      MOUTH_GRAIN.rx * ts,
      MOUTH_GRAIN.ry * ts,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  if (damaged) {
    const slitX = ox + SLIT.x * ts;
    const slitY = oy + (standing ? SLIT.standingY : SLIT.slumpedY) * ts;
    crackLine(
      ctx,
      slitX - SLIT.halfLength * ts,
      slitY,
      slitX + SLIT.halfLength * ts,
      slitY + SLIT.fall * ts,
      SLIT.wobble * ts,
      rng,
      HOLLOW,
      SLIT.width,
    );
    // Grain run out of the cut and heaped against the sack's foot.
    const g = SLIT_GRAIN;
    const floorY = oy + g.floorY * ts;
    ctx.fillStyle = GRAIN;
    polygon(ctx, [
      [slitX + g.topLeft[0] * ts, slitY + g.topLeft[1] * ts],
      [slitX + g.topRight[0] * ts, slitY + g.topRight[1] * ts],
      [slitX + g.footRightX * ts, floorY],
      [slitX + g.footLeftX * ts, floorY],
    ]);
    ctx.globalAlpha = g.alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = GRAIN_SHADE;
    ctx.beginPath();
    ctx.ellipse(slitX + g.heapDx * ts, floorY, g.heapRx * ts, g.heapRy * ts, 0, 0, Math.PI);
    ctx.fill();
  }
}

const GRAIN_FLECKS = 22;
const GRAIN_FLECK_SIZE = 2;
const GRAIN_SHADE_CHANCE = 0.5;

/** What an emptied sack leaves, in tile fractions. */
const REMAINS = {
  spill: { x: 0.5, y: 0.72, rx: 0.44, ry: 0.18, rgb: '170,140,80', alpha: 0.6 },
  heap: { x: 0.56, y: 0.72, rx: 0.2, ry: 0.07 },
  flecks: { x: 0.15, spreadX: 0.7, y: 0.62, spreadY: 0.22 },
  /** The flattened sack, and the lit fold across it. */
  sack: [
    [0.1, 0.68],
    [0.42, 0.6],
    [0.5, 0.76],
    [0.18, 0.84],
  ],
  fold: [
    [0.12, 0.68],
    [0.4, 0.61],
    [0.36, 0.68],
  ],
} as const;

function paintSackRemains(ctx: Ctx, at: PieceOrigin, variant: number): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(REMAINS_SEED + variant);
  const r = REMAINS;
  const at01 = ([dx, dy]: TileOffset): [number, number] => [ox + dx * ts, oy + dy * ts];
  // The spilled grain: a wide, flat tonal heap rather than a speckle field.
  wash(
    ctx,
    ox + r.spill.x * ts,
    oy + r.spill.y * ts,
    r.spill.rx * ts,
    r.spill.ry * ts,
    r.spill.rgb,
    r.spill.alpha,
  );
  ctx.fillStyle = GRAIN;
  ctx.beginPath();
  ctx.ellipse(ox + r.heap.x * ts, oy + r.heap.y * ts, r.heap.rx * ts, r.heap.ry * ts, 0, 0, TWO_PI);
  ctx.fill();
  for (let index = 0; index < GRAIN_FLECKS; index++) {
    ctx.fillStyle = rng() < GRAIN_SHADE_CHANCE ? GRAIN : GRAIN_SHADE;
    ctx.fillRect(
      ox + (r.flecks.x + rng() * r.flecks.spreadX) * ts,
      oy + (r.flecks.y + rng() * r.flecks.spreadY) * ts,
      GRAIN_FLECK_SIZE,
      GRAIN_FLECK_SIZE,
    );
  }
  // The emptied sack, flattened and folded.
  ctx.fillStyle = BURLAP.shade;
  polygon(ctx, r.sack.map(at01));
  ctx.fill();
  ctx.fillStyle = BURLAP.mid;
  polygon(ctx, r.fold.map(at01));
  ctx.fill();
}

/** How a burst sack flies apart, in source pixels. */
const SACK_SHATTER = {
  shardCount: 12,
  shardLength: 8,
  shardWidth: 5,
  spread: 26,
  halfWidth: 8,
  burstHeightTiles: 0.6,
} as const;

export const GRAIN_SACK_PAINTER: CellarPiecePainter = {
  tilesWide: 1,
  variants: VARIANTS,
  paint: paintSack,
  paintRemains: paintSackRemains,
  shatter: {
    shades: [BURLAP.mid, BURLAP.lit, GRAIN, GRAIN_SHADE],
    edge: BURLAP.deep,
    dustRgb: '190,165,110',
    shardCount: SACK_SHATTER.shardCount,
    shardLength: SACK_SHATTER.shardLength,
    shardWidth: SACK_SHATTER.shardWidth,
    spread: SACK_SHATTER.spread,
    halfWidth: SACK_SHATTER.halfWidth,
  },
  burstHeightTiles: SACK_SHATTER.burstHeightTiles,
};
