/**
 * The two racks that stand against a north face: a bottle rack and a rack of
 * rusted spears. Each stands on the floor tile below the face and climbs up
 * over it, so the wall behind reads as the thing it leans on.
 */

import { mulberry32 } from '../../person/rng';
import type { CellarPiecePainter, PieceOrigin } from './cellarPiece';
import {
  BOTTLE_BROWN,
  BOTTLE_GREEN,
  GLASS_GLINT,
  HALF,
  HOLLOW,
  OAK,
  RUST_IRON,
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

const VARIANTS = 4;

/** The soft shadow under either rack, in tile fractions. */
const RACK_SHADOW = { x: 0.5, ry: 0.08 } as const;

// ── Bottle rack ─────────────────────────────────────────────────────────────

const BOTTLE_SEED = 0xb071;
/** The remains draw from their own stream, apart from the standing rack's. */
const BOTTLE_REMAINS_SEED = BOTTLE_SEED * 11;

/** The rack's frame, in tile fractions; its top climbs above the tile onto the face. */
const BOTTLE_RACK = {
  leftX: 0.08,
  rightX: 0.92,
  topY: -0.62,
  floorY: 0.9,
  postWidth: 0.08,
  sideDepth: 0.07,
  /** The lit cap overhangs the frame a little on each side. */
  capOverhang: 0.02,
  columns: 3,
  rows: 4,
  /** The lowest shelf sits clear of the floor. */
  plinth: 0.12,
  shadowRx: 0.46,
  /** Each shelf board: a lit top edge over a dark underside, in source pixels. */
  boardLitHalf: 1.5,
  boardLitHeight: 3,
  boardShadeHeight: 1,
} as const;

/** Chance a cubby is empty, per variant: an old cellar is never fully stocked. */
const EMPTY_CUBBY_CHANCE = [0.1, 0.25, 0.4, 0.15] as const;
/** A struck rack has lost this much more of its stock. */
const STRUCK_EMPTY_EXTRA = 0.3;
const GREEN_BOTTLE_CHANCE = 0.6;

/** A bottle end in its cubby, as shares of the cubby and of the bottle's radius. */
const BOTTLE_END = {
  radius: 0.085,
  down: 0.55,
  glintAlpha: 0.7,
  glintX: 0.55,
  glintY: 0.6,
  glintSize: 2,
} as const;

/** The bottle laid on top of some racks, along the cap from its left edge. */
const TOP_BOTTLE = {
  rise: 0.04,
  bodyFrom: 0.2,
  bodyTo: 0.58,
  bodyWidth: 0.09,
  neckTo: 0.68,
  neckWidth: 0.04,
  glintRise: 0.07,
  glintFrom: 0.24,
  glintTo: 0.5,
} as const;
/** Variants that carry a bottle laid on top. */
const BOTTLE_ON_TOP_PARITY = 1;

/** A struck rack's split post and the wine running from under it. */
const BOTTLE_STRUCK = {
  crackReach: 1.3,
  wobble: 0.04,
  spill: { x: 0.55, rise: 0.02, rx: 0.3, ry: 0.07, rgb: '58,15,20', alpha: 0.7 },
} as const;

function rackFrame(ctx: Ctx, at: PieceOrigin): void {
  const { ox, oy, ts } = at;
  const left = ox + BOTTLE_RACK.leftX * ts;
  const right = ox + BOTTLE_RACK.rightX * ts;
  const top = oy + BOTTLE_RACK.topY * ts;
  const floor = oy + BOTTLE_RACK.floorY * ts;
  const overhang = BOTTLE_RACK.capOverhang * ts;
  // The dark of the cubbies behind the bottles.
  ctx.fillStyle = HOLLOW;
  ctx.fillRect(left, top, right - left, floor - top);
  // The cap of the rack, lit from above.
  ctx.fillStyle = OAK.rim;
  ctx.fillRect(
    left - overhang,
    top - BOTTLE_RACK.sideDepth * ts,
    right - left + overhang * 2,
    BOTTLE_RACK.sideDepth * ts,
  );
}

function rackLattice(ctx: Ctx, at: PieceOrigin): void {
  const { ox, oy, ts } = at;
  const r = BOTTLE_RACK;
  const left = ox + r.leftX * ts;
  const right = ox + r.rightX * ts;
  const top = oy + r.topY * ts;
  const floor = oy + r.floorY * ts;
  const post = r.postWidth * ts;
  const shelfBottom = floor - r.plinth * ts;
  const cellW = (right - left) / r.columns;
  const cellH = (shelfBottom - top) / r.rows;
  ctx.fillStyle = frontGradient(ctx, left, top, floor, OAK);
  for (let column = 0; column <= r.columns; column++) {
    const x = left + column * cellW - post / 2;
    ctx.fillRect(Math.max(left - post / 2, x), top, post, floor - top);
  }
  for (let row = 0; row <= r.rows; row++) {
    const y = top + row * cellH;
    ctx.fillStyle = OAK.lit;
    ctx.fillRect(left, y - r.boardLitHalf, right - left, r.boardLitHeight);
    ctx.fillStyle = OAK.deep;
    ctx.fillRect(left, y + r.boardLitHalf, right - left, r.boardShadeHeight);
  }
  ctx.fillStyle = OAK.shade;
  ctx.fillRect(left, shelfBottom, right - left, floor - shelfBottom);
}

function paintBottleRack(ctx: Ctx, at: PieceOrigin, variant: number, damaged: boolean): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(BOTTLE_SEED + variant);
  const left = ox + BOTTLE_RACK.leftX * ts;
  const right = ox + BOTTLE_RACK.rightX * ts;
  const top = oy + BOTTLE_RACK.topY * ts;
  const floor = oy + BOTTLE_RACK.floorY * ts;
  const shelfBottom = floor - BOTTLE_RACK.plinth * ts;
  const cellW = (right - left) / BOTTLE_RACK.columns;
  const cellH = (shelfBottom - top) / BOTTLE_RACK.rows;
  const emptyChance = EMPTY_CUBBY_CHANCE[variant % VARIANTS] ?? EMPTY_CUBBY_CHANCE[0];

  contactShadow(
    ctx,
    ox + RACK_SHADOW.x * ts,
    floor,
    BOTTLE_RACK.shadowRx * ts,
    RACK_SHADOW.ry * ts,
  );
  rackFrame(ctx, at);
  // Bottle ends seen head-on in each cubby: a dark disc with a lit lip.
  const end = BOTTLE_END;
  for (let row = 0; row < BOTTLE_RACK.rows; row++) {
    for (let column = 0; column < BOTTLE_RACK.columns; column++) {
      const empty = rng() < (damaged ? emptyChance + STRUCK_EMPTY_EXTRA : emptyChance);
      const glass = rng() < GREEN_BOTTLE_CHANCE ? BOTTLE_GREEN : BOTTLE_BROWN;
      if (empty) continue;
      const cx = left + (column + HALF) * cellW;
      const cy = top + (row + end.down) * cellH;
      const radius = end.radius * ts;
      ctx.fillStyle = glass;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = GLASS_GLINT;
      ctx.globalAlpha = end.glintAlpha;
      ctx.fillRect(
        cx - radius * end.glintX,
        cy - radius * end.glintY,
        end.glintSize,
        end.glintSize,
      );
      ctx.globalAlpha = 1;
    }
  }
  rackLattice(ctx, at);
  if (variant % 2 === BOTTLE_ON_TOP_PARITY) {
    const b = TOP_BOTTLE;
    const y = top - BOTTLE_RACK.sideDepth * ts * HALF;
    const bodyY = y - b.rise * ts;
    line(
      ctx,
      left + b.bodyFrom * ts,
      bodyY,
      left + b.bodyTo * ts,
      bodyY,
      BOTTLE_GREEN,
      b.bodyWidth * ts,
    );
    line(
      ctx,
      left + b.bodyTo * ts,
      bodyY,
      left + b.neckTo * ts,
      bodyY,
      BOTTLE_GREEN,
      b.neckWidth * ts,
    );
    const glintY = y - b.glintRise * ts;
    line(ctx, left + b.glintFrom * ts, glintY, left + b.glintTo * ts, glintY, GLASS_GLINT, 1);
  }
  if (damaged) {
    const struck = BOTTLE_STRUCK;
    crackLine(
      ctx,
      left + cellW,
      top + cellH,
      left + cellW * struck.crackReach,
      shelfBottom,
      struck.wobble * ts,
      rng,
    );
    const spill = struck.spill;
    wash(
      ctx,
      ox + spill.x * ts,
      floor - spill.rise * ts,
      spill.rx * ts,
      spill.ry * ts,
      spill.rgb,
      spill.alpha,
    );
  }
}

const GLASS_PIECES = 10;
const PLANK_PIECES = 5;

/** What a smashed bottle rack leaves, in tile fractions. */
const BOTTLE_REMAINS = {
  stain: { x: 0.5, y: 0.72, rx: 0.44, ry: 0.18, rgb: '52,12,18', alpha: 0.7 },
  planks: { x: 0.2, spreadX: 0.6, y: 0.55, spreadY: 0.3, length: 0.35, lengthSpread: 0.25 },
  plankWidth: 0.07,
  plankTwist: 1.2,
  litPlankChance: 0.5,
  glass: { x: 0.1, spreadX: 0.8, y: 0.55, spreadY: 0.35, length: 0.08, width: 0.05 },
  glintSize: 1.5,
} as const;

function paintBottleRackRemains(ctx: Ctx, at: PieceOrigin, variant: number): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(BOTTLE_REMAINS_SEED + variant);
  const r = BOTTLE_REMAINS;
  wash(
    ctx,
    ox + r.stain.x * ts,
    oy + r.stain.y * ts,
    r.stain.rx * ts,
    r.stain.ry * ts,
    r.stain.rgb,
    r.stain.alpha,
  );
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
  for (let index = 0; index < GLASS_PIECES; index++) {
    const x = ox + (r.glass.x + rng() * r.glass.spreadX) * ts;
    const y = oy + (r.glass.y + rng() * r.glass.spreadY) * ts;
    shard(
      ctx,
      x,
      y,
      r.glass.length * ts,
      r.glass.width * ts,
      rng() * Math.PI,
      rng() < GREEN_BOTTLE_CHANCE ? BOTTLE_GREEN : BOTTLE_BROWN,
      HOLLOW,
    );
    ctx.fillStyle = GLASS_GLINT;
    ctx.fillRect(x, y - 1, r.glintSize, r.glintSize);
  }
}

/** How a smashed bottle rack flies apart, in source pixels. */
const BOTTLE_SHATTER = {
  shardCount: 20,
  shardLength: 9,
  shardWidth: 4,
  spread: 36,
  halfWidth: 14,
  burstHeightTiles: 0.1,
} as const;

export const BOTTLE_RACK_PAINTER: CellarPiecePainter = {
  tilesWide: 1,
  variants: VARIANTS,
  paint: paintBottleRack,
  paintRemains: paintBottleRackRemains,
  shatter: {
    shades: [BOTTLE_GREEN, BOTTLE_BROWN, GLASS_GLINT, OAK.mid, OAK.lit],
    edge: HOLLOW,
    dustRgb: '120,60,60',
    shardCount: BOTTLE_SHATTER.shardCount,
    shardLength: BOTTLE_SHATTER.shardLength,
    shardWidth: BOTTLE_SHATTER.shardWidth,
    spread: BOTTLE_SHATTER.spread,
    halfWidth: BOTTLE_SHATTER.halfWidth,
  },
  burstHeightTiles: BOTTLE_SHATTER.burstHeightTiles,
};

// ── Spear rack ──────────────────────────────────────────────────────────────

const SPEAR_SEED = 0x59ea;
/** The remains draw from their own stream, apart from the standing rack's. */
const SPEAR_REMAINS_SEED = SPEAR_SEED * 13;

/** The rack and its spears, in tile fractions; the spear heads climb onto the face. */
const SPEAR_RACK = {
  leftX: 0.1,
  rightX: 0.9,
  railTopY: -0.16,
  railLowY: 0.58,
  floorY: 0.9,
  railHeight: 0.11,
  postWidth: 0.1,
  spearTopY: -0.62,
  shaftWidth: 0.07,
  headLength: 0.26,
  headWidth: 0.13,
  /** The butts stand in a foot board this deep, just above the floor line. */
  footBoard: 0.08,
  buttRise: 0.04,
  shadowRx: 0.45,
  railLitEdge: 1.5,
  /** The shaft's lit side, as shares of the shaft's width. */
  shaftLitOffset: 0.25,
  shaftLitWidth: 0.35,
  /** Where the leaf blade is widest, and the lit facet's inner edge, as shares of its length. */
  bladeShoulder: 0.35,
  bladeFacet: 0.3,
} as const;

/** The splintered top of the spear snapped on a struck rack. */
const SNAPPED_SPEAR = { drop: 0.05, splinter: 0.03, width: 2, index: 1 } as const;
/** The crack along a struck rack's top rail. */
const RAIL_CRACK = {
  fromX: 0.2,
  toX: 0.5,
  fromDown: 2,
  toDown: 3,
  wobble: 0.02,
  width: 1.5,
} as const;

/** Where each spear stands across the rack, and how far it leans, per variant. */
const SPEAR_LAYOUTS = [
  [
    { x: 0.24, lean: -0.03 },
    { x: 0.42, lean: 0.02 },
    { x: 0.6, lean: -0.01 },
    { x: 0.76, lean: 0.04 },
  ],
  [
    { x: 0.26, lean: 0.03 },
    { x: 0.5, lean: -0.02 },
    { x: 0.74, lean: 0.02 },
  ],
  [
    { x: 0.22, lean: -0.02 },
    { x: 0.4, lean: 0.05 },
    { x: 0.78, lean: -0.04 },
  ],
  [
    { x: 0.3, lean: 0.01 },
    { x: 0.48, lean: -0.03 },
    { x: 0.66, lean: 0.03 },
    { x: 0.8, lean: -0.02 },
  ],
] as const;

const SHAFT_COLOUR = '#5b4029';
const SHAFT_LIT = '#7a5838';

function rail(ctx: Ctx, at: PieceOrigin, y: number): void {
  const { ox, ts } = at;
  const left = ox + SPEAR_RACK.leftX * ts;
  const right = ox + SPEAR_RACK.rightX * ts;
  const height = SPEAR_RACK.railHeight * ts;
  ctx.fillStyle = frontGradient(ctx, left, y, y + height, OAK);
  ctx.fillRect(left, y, right - left, height);
  ctx.fillStyle = OAK.rim;
  ctx.fillRect(left, y, right - left, SPEAR_RACK.railLitEdge);
  ctx.strokeStyle = OAK.deep;
  ctx.lineWidth = 1;
  ctx.strokeRect(left, y, right - left, height);
}

function spear(ctx: Ctx, at: PieceOrigin, x: number, lean: number, broken: boolean): void {
  const { ox, oy, ts } = at;
  const r = SPEAR_RACK;
  const footX = ox + x * ts;
  const footY = oy + (r.floorY - r.buttRise) * ts;
  const tipY = oy + (broken ? r.railTopY - SNAPPED_SPEAR.drop : r.spearTopY) * ts;
  const tipX = footX + (lean * ts * (footY - tipY)) / ts;
  const shaft = r.shaftWidth * ts;
  line(ctx, footX, footY, tipX, tipY, SHAFT_COLOUR, shaft);
  const litOffset = shaft * r.shaftLitOffset;
  line(ctx, footX - litOffset, footY, tipX - litOffset, tipY, SHAFT_LIT, shaft * r.shaftLitWidth);
  if (broken) {
    const splinter = SNAPPED_SPEAR.splinter * ts;
    line(
      ctx,
      tipX - splinter,
      tipY,
      tipX + splinter,
      tipY - splinter,
      OAK.rim,
      SNAPPED_SPEAR.width,
    );
    return;
  }
  // A rusted leaf-blade head; its upper edge catches the light.
  const head = r.headLength * ts;
  const half = (r.headWidth * ts) / 2;
  const shoulderY = tipY - head * r.bladeShoulder;
  ctx.fillStyle = RUST_IRON.mid;
  polygon(ctx, [
    [tipX, tipY - head],
    [tipX + half, shoulderY],
    [tipX, tipY],
    [tipX - half, shoulderY],
  ]);
  ctx.fill();
  ctx.fillStyle = RUST_IRON.rim;
  polygon(ctx, [
    [tipX, tipY - head],
    [tipX - half, shoulderY],
    [tipX, tipY - head * r.bladeFacet],
  ]);
  ctx.fill();
  ctx.strokeStyle = RUST_IRON.deep;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function paintSpearRack(ctx: Ctx, at: PieceOrigin, variant: number, damaged: boolean): void {
  const { ox, oy, ts } = at;
  const r = SPEAR_RACK;
  const layout = SPEAR_LAYOUTS[variant % VARIANTS] ?? SPEAR_LAYOUTS[0];
  const left = ox + r.leftX * ts;
  const right = ox + r.rightX * ts;
  const floor = oy + r.floorY * ts;
  const postW = r.postWidth * ts;
  contactShadow(ctx, ox + RACK_SHADOW.x * ts, floor, r.shadowRx * ts, RACK_SHADOW.ry * ts);
  const railTop = oy + r.railTopY * ts;
  for (const x of [left, right - postW]) {
    ctx.fillStyle = frontGradient(ctx, x, railTop, floor, OAK);
    ctx.fillRect(x, railTop, postW, floor - railTop);
    ctx.fillStyle = OAK.deep;
    ctx.fillRect(x + postW - 1, railTop, 1, floor - railTop);
  }
  // A foot board the butts stand in.
  ctx.fillStyle = OAK.shade;
  ctx.fillRect(left, floor - r.footBoard * ts, right - left, r.footBoard * ts);
  layout.forEach((entry, index) => {
    spear(ctx, at, entry.x, entry.lean, damaged && index === SNAPPED_SPEAR.index);
  });
  rail(ctx, at, railTop);
  rail(ctx, at, oy + r.railLowY * ts);
  if (damaged) {
    const rng = mulberry32(SPEAR_SEED + variant);
    const c = RAIL_CRACK;
    crackLine(
      ctx,
      left + c.fromX * ts,
      railTop + c.fromDown,
      left + c.toX * ts,
      railTop + c.toDown,
      c.wobble * ts,
      rng,
      OAK.deep,
      c.width,
    );
  }
}

/** What a smashed spear rack leaves, in tile fractions. */
const SPEAR_REMAINS = {
  wash: { x: 0.5, y: 0.72, rx: 0.44, ry: 0.16, rgb: '30,22,14', alpha: 0.35 },
  shafts: 3,
  shaftX: 0.5,
  shaftY: 0.55,
  shaftStep: 0.12,
  shaftJitter: 0.05,
  shaftTwist: 0.5,
  shaftLength: 0.8,
  shaftWidth: 0.05,
  rail: { x: 0.35, y: 0.82, length: 0.6, width: 0.07, angle: 0.1 },
  heads: 2,
  head: { x: 0.2, spreadX: 0.6, y: 0.6, spreadY: 0.2 },
  /** A fallen blade, as offsets from its base. */
  blade: [
    [0.14, -0.03],
    [0.03, 0.04],
  ],
} as const;

function paintSpearRackRemains(ctx: Ctx, at: PieceOrigin, variant: number): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(SPEAR_REMAINS_SEED + variant);
  const r = SPEAR_REMAINS;
  wash(
    ctx,
    ox + r.wash.x * ts,
    oy + r.wash.y * ts,
    r.wash.rx * ts,
    r.wash.ry * ts,
    r.wash.rgb,
    r.wash.alpha,
  );
  for (let index = 0; index < r.shafts; index++) {
    const y = oy + (r.shaftY + index * r.shaftStep + rng() * r.shaftJitter) * ts;
    const angle = (rng() - HALF) * r.shaftTwist;
    shard(
      ctx,
      ox + r.shaftX * ts,
      y,
      r.shaftLength * ts,
      r.shaftWidth * ts,
      angle,
      SHAFT_COLOUR,
      OAK.deep,
    );
  }
  shard(
    ctx,
    ox + r.rail.x * ts,
    oy + r.rail.y * ts,
    r.rail.length * ts,
    r.rail.width * ts,
    r.rail.angle,
    OAK.mid,
    OAK.deep,
  );
  for (let index = 0; index < r.heads; index++) {
    const x = ox + (r.head.x + rng() * r.head.spreadX) * ts;
    const y = oy + (r.head.y + rng() * r.head.spreadY) * ts;
    ctx.fillStyle = RUST_IRON.mid;
    polygon(ctx, [
      [x, y],
      ...r.blade.map(([dx, dy]): [number, number] => [x + dx * ts, y + dy * ts]),
    ]);
    ctx.fill();
  }
}

/** How a smashed spear rack flies apart, in source pixels. */
const SPEAR_SHATTER = {
  shardCount: 14,
  shardLength: 16,
  shardWidth: 3,
  spread: 34,
  halfWidth: 14,
  burstHeightTiles: 0.2,
} as const;

export const SPEAR_RACK_PAINTER: CellarPiecePainter = {
  tilesWide: 1,
  variants: VARIANTS,
  paint: paintSpearRack,
  paintRemains: paintSpearRackRemains,
  shatter: {
    shades: [OAK.mid, OAK.lit, SHAFT_COLOUR, RUST_IRON.mid],
    edge: OAK.deep,
    dustRgb: '120,95,70',
    shardCount: SPEAR_SHATTER.shardCount,
    shardLength: SPEAR_SHATTER.shardLength,
    shardWidth: SPEAR_SHATTER.shardWidth,
    spread: SPEAR_SHATTER.spread,
    halfWidth: SPEAR_SHATTER.halfWidth,
  },
  burstHeightTiles: SPEAR_SHATTER.burstHeightTiles,
};
