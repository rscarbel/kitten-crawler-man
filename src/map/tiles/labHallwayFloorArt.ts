/**
 * The floor of the spider lab's approach: the wreck and the colony laid over
 * the ordinary hallway concrete, worse the nearer the lab.
 *
 * Two kinds of mark. Per tile, from the tile's own hash and how far down the
 * approach it lies: a grime wash, cracked, heaved and missing slabs, silk
 * drifted against the wall base and eggshell shards thickening toward the
 * lab. And the placed pieces of `labHallwayDecor.ts` — the tape and hazard
 * band across the mouth, a fallen sign, the drag mark and slime trail, ichor
 * stains, the overturned cart, shattered jars, papers and the rubble from the
 * collapsed wall — each drawn whole and clipped to every tile it touches, so
 * neighbouring tiles agree and no seam shows.
 *
 * A dirty floor is not a busy one: the wash, cracks, stains and trails are
 * low-contrast tonal marks, and only the tape, the sign, the cart and the
 * debris read strongly. Baked once into the chunk with the rest of the ground.
 */

import { TILE_SIZE } from '../../core/constants';
import { drawSpill, spillVariant } from '../../systems/destruction/spillDecals';
import { mulberry32, type Rng } from '../../sprites/person/rng';
import {
  labHallwayDecorOf,
  type DecorPoint,
  type LabHallwayFloorItem,
} from '../dungeon/labHallwayDecor';
import { FloorTypeValue, positionHash, type TileContent } from '../tileTypes';

type Ctx = CanvasRenderingContext2D;

/** One pixel at the game's tile size, in tile units. */
const PX = 1 / TILE_SIZE;
const HALF = 0.5;
const TWO_PI = Math.PI * 2;
const HASH_UNIT = 0x1_0000_0000;

// ── Palette ──────────────────────────────────────────────────────────────────

const GRIME_RGB = '30,36,24';
const CRACK = 'rgba(14,12,10,0.42)';
const CRACK_LIGHT = 'rgba(210,205,190,0.1)';
const HEAVE_LIGHT = 'rgba(222,218,204,0.09)';
const HEAVE_DARK = 'rgba(0,0,0,0.18)';
const DIRT = 'rgba(54,46,38,0.32)';
const DIRT_EDGE = 'rgba(16,14,12,0.45)';
const DIRT_RIM = 'rgba(196,190,176,0.16)';
const DIRT_GRIT = 'rgba(88,76,60,0.45)';
const SILK_RGB = '232,230,220';
const SILK_SHADE_RGB = '150,150,140';
const SHARD = 'rgba(196,186,166,0.6)';
const SHARD_SHADE = 'rgba(146,124,118,0.5)';
const SHARD_SHADOW = 'rgba(0,0,0,0.3)';
const HAZARD_YELLOW = 'rgba(214,168,38,0.82)';
const HAZARD_BLACK = 'rgba(24,22,18,0.82)';
const TAPE_YELLOW = 'rgba(238,196,40,1)';
const TAPE_BLACK = 'rgba(22,20,16,1)';
const TAPE_SHADOW = 'rgba(0,0,0,0.32)';
const DRAG_SMEAR = 'rgba(70,26,24,0.22)';
const SLIME = 'rgba(118,138,86,0.08)';
const SLIME_SHEEN = 'rgba(214,232,182,0.06)';
const ICHOR_RGB = '38,20,30';
const STEEL = 'rgba(148,154,156,1)';
const STEEL_DARK = 'rgba(86,92,96,1)';
const STEEL_LIGHT = 'rgba(196,202,204,1)';
const RUBBER = 'rgba(26,26,28,1)';
const PROP_SHADOW = 'rgba(0,0,0,0.34)';
const GLASS = 'rgba(176,214,210,0.7)';
const GLASS_GLINT = 'rgba(240,252,250,0.85)';
const SPECIMEN_SPILL = 'rgba(120,128,72,0.26)';
const JAR_LID = 'rgba(70,74,78,1)';
const PAPER = 'rgba(226,222,208,0.92)';
const PAPER_INK = 'rgba(80,80,86,0.45)';
const RUBBLE_TONES = ['rgba(116,112,104,1)', 'rgba(136,132,122,1)', 'rgba(96,92,86,1)'] as const;
const RUBBLE_LIGHT = 'rgba(190,184,170,0.6)';
const SIGN_PLATE = 'rgba(232,228,214,1)';
const SIGN_BAND = 'rgba(196,36,30,1)';
const SIGN_INK = 'rgba(28,24,22,1)';

// ── Per-tile tuning ─────────────────────────────────────────────────────────

const GRIME_MIN_ALPHA = 0.05;
const GRIME_DECAY_ALPHA = 0.17;
const CRACK_BASE_CHANCE = 0.12;
const CRACK_DECAY_CHANCE = 0.45;
const CRACK_SEGMENTS = 4;
const CRACK_JITTER = 0.22;
const HEAVE_MIN_DECAY = 0.25;
const HEAVE_DECAY_CHANCE = 0.22;
const HEAVE_INSET = 0.08;
const MISSING_MIN_DECAY = 0.35;
const MISSING_DECAY_CHANCE = 0.06;
/** A missing slab is the tile's own square, its corners broken off unevenly. */
const MISSING_INSET = 0.14;
const MISSING_JITTER = 0.07;
const MISSING_GRIT = 5;
const SILK_BASE_CHANCE = 0.25;
/** Past this the silk lies unbroken along every wall. */
const SILK_UNBROKEN_DECAY = 0.3;
const SILK_MIN_ALPHA = 0.12;
const SILK_DECAY_ALPHA = 0.35;
/** Under one, so the silk thickens fast after the mouth and only slowly after that. */
const SILK_ALPHA_CURVE = 0.7;
const SILK_MIN_DEPTH = 0.22;
const SILK_DECAY_DEPTH = 0.18;
const SILK_EDGE_BASE = 0.8;
const SILK_EDGE_WAVE = 0.1;
const SILK_EDGE_RATE = 3.1;
const SILK_EDGE_STEPS = 6;
const SILK_EDGE_ALPHA_SHARE = 0.15;
const SILK_STRAND_ALPHA_SHARE = 0.6;
const SILK_WISPS = 7;
const SHARD_PILE_SHARDS = 16;
const SHARD_PILE_SPREAD = 0.42;
const SHARD_MIN_SIZE = 0.05;
const SHARD_SIZE_SPREAD = 0.06;
const SHELL_HALVES = 2;
const SHELL_RADIUS = 0.16;

const SALT_CRACK = 11;
const SALT_HEAVE = 12;
const SALT_MISSING = 13;
const SALT_SILK = 14;
const SALT_SHAPE = 16;
const SALT_X = 0x45d9;
const SALT_Y = 0x2c1b;

// ── Piece tuning ─────────────────────────────────────────────────────────────

const HAZARD_BAND_WIDTH = 0.26;
const HAZARD_STRIPE = 0.14;
const TAPE_WIDTH = 0.13;
const TAPE_STRIPE = 0.11;
const TAPE_SHADOW_OFFSET = 1.5 * PX;
const DRAG_SMEAR_WIDTH = 0.42;
const DRAG_MIN_SHARE = 0.25;
const DRAG_SWELL_SHARE = 0.85;
const DRAG_SWELL_RATE = 1.3;
const SLIME_WIDTH = 0.22;
const SLIME_SHEEN_WIDTH = 0.04;
const SLIME_SHEEN_OFFSET = 0.04;
const STAIN_LOBES = 3;
const STAIN_LOBE_SPREAD = 0.5;
const STAIN_ALPHA = 0.36;
const SPILL_ALPHA = 0.85;
const CART_LENGTH = 0.92;
const CART_DEPTH = 0.4;
const CART_SHELF_AT = 0.5;
const CART_WHEEL_RADIUS = 0.07;
const CART_HANDLE_REACH = 0.16;
const CART_SHADOW_GROW = 0.08;
const JAR_SHARDS = 6;
const JAR_SPILL_RX = 0.36;
const JAR_SPILL_RY = 0.22;
const JAR_SHARD_SPREAD = 0.42;
const JAR_SHARD_SIZE = 0.06;
const JAR_LENGTH = 0.22;
const JAR_RADIUS = 0.08;
const PAPER_SHEETS = 5;
const PAPER_W = 0.17;
const PAPER_H = 0.22;
const PAPER_SPREAD = 0.6;
const PAPER_LINES = 3;
const RUBBLE_CHUNKS = 14;
const RUBBLE_SPREAD = 0.95;
const RUBBLE_MIN_SIZE = 0.08;
const RUBBLE_SIZE_SPREAD = 0.12;
const RUBBLE_CHUNK_POINTS = 5;
const SIGN_W = 0.56;
const SIGN_H = 0.32;
const SIGN_BAND_SHARE = 0.32;
const SIGN_TEXT_LINES = 2;
const SIGN_TEXT_GAP = 0.07;
const SIGN_TEXT_STEP = 0.25;
const SIGN_EDGE_INSET = 0.05;

function unitHash(tx: number, ty: number, salt: number): number {
  return positionHash(tx + salt * SALT_X, ty - salt * SALT_Y) / HASH_UNIT;
}

function tileRand(tx: number, ty: number, salt: number): Rng {
  return mulberry32(positionHash(tx * SALT_Y + salt, ty * SALT_X - salt));
}

function isWall(structure: TileContent[][], x: number, y: number): boolean {
  return structure[y]?.[x]?.type === FloorTypeValue.wall;
}

/**
 * Paints the approach's floor over one tile of hallway ground. Does nothing
 * off the approach, or on a grid with no lab.
 */
export function drawLabHallwayFloor(
  ctx: Ctx,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const decor = labHallwayDecorOf(structure);
  if (decor === undefined) return;
  const decay = decor.decayAt(tx, ty);
  if (decay === null) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, ts, ts);
  ctx.clip();
  // Tile units from here on: (tx, ty) is this tile's top-left corner.
  ctx.translate(sx - tx * ts, sy - ty * ts);
  ctx.scale(ts, ts);
  drawGrime(ctx, decay, tx, ty);
  drawSlabDamage(ctx, decay, tx, ty);
  const items = decor.floorItemsAt(tx, ty);
  for (const item of items) if (isTonal(item)) drawItem(ctx, item);
  drawSilk(ctx, structure, decay, tx, ty);
  for (const item of items) if (!isTonal(item)) drawItem(ctx, item);
  ctx.restore();
}

/** The marks that are a stain on the floor rather than a thing lying on it. */
function isTonal(item: LabHallwayFloorItem): boolean {
  return item.kind === 'trail' || item.kind === 'stain' || item.kind === 'hazard_band';
}

function drawGrime(ctx: Ctx, decay: number, tx: number, ty: number): void {
  ctx.fillStyle = `rgba(${GRIME_RGB},${GRIME_MIN_ALPHA + GRIME_DECAY_ALPHA * decay})`;
  ctx.fillRect(tx, ty, 1, 1);
}

function drawSlabDamage(ctx: Ctx, decay: number, tx: number, ty: number): void {
  const missing =
    decay >= MISSING_MIN_DECAY && unitHash(tx, ty, SALT_MISSING) < MISSING_DECAY_CHANCE * decay;
  if (missing) {
    drawMissingSlab(ctx, tx, ty);
    return;
  }
  if (decay >= HEAVE_MIN_DECAY && unitHash(tx, ty, SALT_HEAVE) < HEAVE_DECAY_CHANCE * decay) {
    const left = tx + HEAVE_INSET;
    const top = ty + HEAVE_INSET;
    const size = 1 - HEAVE_INSET * 2;
    ctx.fillStyle = HEAVE_LIGHT;
    ctx.fillRect(left, top, size, 2 * PX);
    ctx.fillRect(left, top, 2 * PX, size);
    ctx.fillStyle = HEAVE_DARK;
    ctx.fillRect(left, top + size - 2 * PX, size, 2 * PX);
    ctx.fillRect(left + size - 2 * PX, top, 2 * PX, size);
  }
  if (unitHash(tx, ty, SALT_CRACK) < CRACK_BASE_CHANCE + CRACK_DECAY_CHANCE * decay) {
    drawCrack(ctx, tileRand(tx, ty, SALT_CRACK), tx, ty);
  }
}

function drawCrack(ctx: Ctx, rand: Rng, tx: number, ty: number): void {
  const points: DecorPoint[] = [{ x: tx + rand(), y: ty + rand() * HALF }];
  for (let step = 0; step < CRACK_SEGMENTS; step++) {
    const last = points[points.length - 1];
    points.push({
      x: last.x + (rand() - HALF) * CRACK_JITTER * 2,
      y: last.y + rand() * CRACK_JITTER + CRACK_JITTER * HALF,
    });
  }
  ctx.lineWidth = PX;
  ctx.lineJoin = 'round';
  for (const [colour, offset] of [
    [CRACK_LIGHT, PX],
    [CRACK, 0],
  ] as const) {
    ctx.strokeStyle = colour;
    strokeLine(ctx, points, offset);
  }
}

function drawMissingSlab(ctx: Ctx, tx: number, ty: number): void {
  const rand = tileRand(tx, ty, SALT_MISSING);
  const near = MISSING_INSET;
  const far = 1 - MISSING_INSET;
  const corners: DecorPoint[] = [
    { x: tx + near, y: ty + near },
    { x: tx + far, y: ty + near },
    { x: tx + far, y: ty + far },
    { x: tx + near, y: ty + far },
  ].map((corner) => ({
    x: corner.x + (rand() - HALF) * MISSING_JITTER * 2,
    y: corner.y + (rand() - HALF) * MISSING_JITTER * 2,
  }));
  ctx.beginPath();
  corners.forEach((corner, index) => {
    if (index === 0) ctx.moveTo(corner.x, corner.y);
    else ctx.lineTo(corner.x, corner.y);
  });
  ctx.closePath();
  ctx.fillStyle = DIRT;
  ctx.fill();
  ctx.lineWidth = PX * 2;
  ctx.strokeStyle = DIRT_EDGE;
  ctx.stroke();
  // The far lip of the hole catches the light; the near one is in its own shadow.
  const [, northEast, southEast, southWest] = corners;
  ctx.strokeStyle = DIRT_RIM;
  ctx.lineWidth = PX;
  ctx.beginPath();
  ctx.moveTo(northEast.x, northEast.y);
  ctx.lineTo(southEast.x, southEast.y);
  ctx.lineTo(southWest.x, southWest.y);
  ctx.stroke();
  ctx.fillStyle = DIRT_GRIT;
  for (let grit = 0; grit < MISSING_GRIT; grit++) {
    const x = tx + near + rand() * (far - near);
    const y = ty + near + rand() * (far - near);
    ctx.fillRect(x, y, 2 * PX, PX);
  }
}

const WALL_SIDES: ReadonlyArray<{ readonly dx: number; readonly dy: number }> = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

/**
 * Silk banked against the foot of each wall the tile backs onto: patchy near
 * the mouth, an unbroken mat by the time the station is passed, and near-white
 * and deep by the lab. Its inner edge wanders in world space, so it runs on
 * across tiles without a seam.
 */
function drawSilk(
  ctx: Ctx,
  structure: TileContent[][],
  decay: number,
  tx: number,
  ty: number,
): void {
  const alpha = SILK_MIN_ALPHA + SILK_DECAY_ALPHA * decay ** SILK_ALPHA_CURVE;
  const depth = SILK_MIN_DEPTH + SILK_DECAY_DEPTH * decay;
  WALL_SIDES.forEach((side, index) => {
    if (!isWall(structure, tx + side.dx, ty + side.dy)) return;
    const patchy = decay < SILK_UNBROKEN_DECAY;
    if (patchy && unitHash(tx, ty, SALT_SILK + index) >= SILK_BASE_CHANCE + decay) return;
    const alongWall = side.dx === 0;
    const edge = alongWall ? (side.dy > 0 ? ty + 1 : ty) : side.dx > 0 ? tx + 1 : tx;
    const inward = alongWall ? -side.dy : -side.dx;
    const reachAt = (u: number): number =>
      depth * (SILK_EDGE_BASE + SILK_EDGE_WAVE * Math.sin(u * SILK_EDGE_RATE + index));
    const point = (u: number, reach: number): DecorPoint =>
      alongWall ? { x: u, y: edge + inward * reach } : { x: edge + inward * reach, y: u };
    const start = alongWall ? tx : ty;
    ctx.beginPath();
    const first = point(start, 0);
    ctx.moveTo(first.x, first.y);
    for (let step = 0; step <= SILK_EDGE_STEPS; step++) {
      const u = start + step / SILK_EDGE_STEPS;
      const next = point(u, reachAt(u));
      ctx.lineTo(next.x, next.y);
    }
    const last = point(start + 1, 0);
    ctx.lineTo(last.x, last.y);
    ctx.closePath();
    const far = point(start, depth);
    const gradient = alongWall
      ? ctx.createLinearGradient(0, edge, 0, far.y)
      : ctx.createLinearGradient(edge, 0, far.x, 0);
    gradient.addColorStop(0, `rgba(${SILK_RGB},${alpha})`);
    gradient.addColorStop(1, `rgba(${SILK_RGB},${alpha * SILK_EDGE_ALPHA_SHARE})`);
    ctx.fillStyle = gradient;
    ctx.fill();
    const rand = tileRand(tx, ty, SALT_SILK + index);
    ctx.strokeStyle = `rgba(${SILK_SHADE_RGB},${alpha * SILK_STRAND_ALPHA_SHARE})`;
    ctx.lineWidth = PX;
    ctx.beginPath();
    for (let wisp = 0; wisp < SILK_WISPS; wisp++) {
      const u = start + rand();
      const from = point(u, rand() * depth * HALF);
      const to = point(u + (rand() - HALF) * depth, reachAt(u) * (HALF + rand() * HALF));
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
  });
}

/** A flake of eggshell: a pale angular chip, shaded where it curls, on its own small shadow. */
function drawShard(ctx: Ctx, x: number, y: number, size: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const outline: ReadonlyArray<DecorPoint> = [
    { x: -size, y: -size * HALF * HALF },
    { x: size * HALF, y: -size * HALF },
    { x: size, y: size * HALF * HALF },
    { x: -size * HALF, y: size * HALF },
  ];
  const trace = (dx: number, dy: number): void => {
    ctx.beginPath();
    outline.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x + dx, point.y + dy);
      else ctx.lineTo(point.x + dx, point.y + dy);
    });
    ctx.closePath();
  };
  ctx.fillStyle = SHARD_SHADOW;
  trace(PX, PX);
  ctx.fill();
  ctx.fillStyle = SHARD;
  trace(0, 0);
  ctx.fill();
  ctx.fillStyle = SHARD_SHADE;
  ctx.beginPath();
  ctx.moveTo(-size * HALF, size * HALF);
  ctx.lineTo(size, size * HALF * HALF);
  ctx.lineTo(size * HALF, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function drawItem(ctx: Ctx, item: LabHallwayFloorItem): void {
  switch (item.kind) {
    case 'hazard_band':
      drawHazardBand(ctx, item.from, item.to);
      return;
    case 'tape':
      drawTape(ctx, item.points);
      return;
    case 'fallen_sign':
      drawFallenSign(ctx, item.at, item.angle);
      return;
    case 'trail':
      if (item.style === 'drag') drawDrag(ctx, item.points);
      else drawSlime(ctx, item.points);
      return;
    case 'stain':
      drawStain(ctx, item.at, item.radius, item.seed);
      return;
    case 'spill':
      drawSpillAt(ctx, item.spill, item.at);
      return;
    case 'cart':
      drawCart(ctx, item.at, item.angle);
      return;
    case 'jars':
      drawJars(ctx, item.at, item.seed);
      return;
    case 'papers':
      drawPapers(ctx, item.at, item.seed);
      return;
    case 'rubble':
      drawRubble(ctx, item.at, item.seed);
      return;
    case 'egg_cluster':
      drawEggCluster(ctx, item.at, item.seed);
      return;
    case 'moult':
      drawMoult(ctx, item.at, item.angle, item.seed);
      return;
    case 'shard_pile':
      drawShardPile(ctx, item.at, item.seed);
      return;
    case 'husk':
      drawHusk(ctx, item.at, item.seed);
      return;
    case 'guy_line':
      drawGuyLine(ctx, item.from, item.to);
      return;
  }
}

function strokeLine(ctx: Ctx, points: ReadonlyArray<DecorPoint>, offset = 0): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x + offset, point.y + offset);
    else ctx.lineTo(point.x + offset, point.y + offset);
  });
  ctx.stroke();
}

/** The point `distance` along a line, and the line's direction there. */
function pointAlong(
  points: ReadonlyArray<DecorPoint>,
  distance: number,
): { x: number; y: number; ux: number; uy: number } {
  let left = distance;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) continue;
    const ux = (to.x - from.x) / length;
    const uy = (to.y - from.y) / length;
    if (left <= length || index === points.length - 1) {
      const t = Math.min(left, length);
      return { x: from.x + ux * t, y: from.y + uy * t, ux, uy };
    }
    left -= length;
  }
  const only = points[0] ?? { x: 0, y: 0 };
  return { x: only.x, y: only.y, ux: 1, uy: 0 };
}

function lineLength(points: ReadonlyArray<DecorPoint>): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    total += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }
  return total;
}

/**
 * A strip of `width` along a line, banded across every `pitch` in two
 * alternating colours, the bands leaning: worn safety paint on the floor, or
 * the tape itself.
 */
function stripedStrip(
  ctx: Ctx,
  points: ReadonlyArray<DecorPoint>,
  width: number,
  pitch: number,
  base: string,
  stripe: string,
): void {
  const total = lineLength(points);
  const lean = pitch * HALF;
  for (let band = 0; band * pitch < total; band++) {
    const a = pointAlong(points, band * pitch);
    const b = pointAlong(points, Math.min(total, (band + 1) * pitch));
    const anx = -a.uy * width * HALF;
    const any = a.ux * width * HALF;
    const bnx = -b.uy * width * HALF;
    const bny = b.ux * width * HALF;
    ctx.fillStyle = band % 2 === 0 ? base : stripe;
    ctx.beginPath();
    ctx.moveTo(a.x - anx, a.y - any);
    ctx.lineTo(b.x - bnx, b.y - bny);
    ctx.lineTo(b.x + bnx + b.ux * lean, b.y + bny + b.uy * lean);
    ctx.lineTo(a.x + anx + a.ux * lean, a.y + any + a.uy * lean);
    ctx.closePath();
    ctx.fill();
  }
}

function drawHazardBand(ctx: Ctx, from: DecorPoint, to: DecorPoint): void {
  stripedStrip(ctx, [from, to], HAZARD_BAND_WIDTH, HAZARD_STRIPE, HAZARD_YELLOW, HAZARD_BLACK);
}

function drawTape(ctx: Ctx, points: ReadonlyArray<DecorPoint>): void {
  ctx.lineWidth = TAPE_WIDTH;
  ctx.strokeStyle = TAPE_SHADOW;
  ctx.lineJoin = 'round';
  strokeLine(ctx, points, TAPE_SHADOW_OFFSET);
  stripedStrip(ctx, points, TAPE_WIDTH, TAPE_STRIPE, TAPE_YELLOW, TAPE_BLACK);
}

function drawFallenSign(ctx: Ctx, at: DecorPoint, angle: number): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.fillStyle = PROP_SHADOW;
  ctx.fillRect(-SIGN_W * HALF + PX * 2, -SIGN_H * HALF + PX * 2, SIGN_W, SIGN_H);
  ctx.fillStyle = SIGN_PLATE;
  ctx.fillRect(-SIGN_W * HALF, -SIGN_H * HALF, SIGN_W, SIGN_H);
  ctx.fillStyle = SIGN_BAND;
  ctx.fillRect(-SIGN_W * HALF, -SIGN_H * HALF, SIGN_W, SIGN_H * SIGN_BAND_SHARE);
  ctx.fillStyle = SIGN_INK;
  for (let line = 0; line < SIGN_TEXT_LINES; line++) {
    const y = -SIGN_H * HALF + SIGN_H * SIGN_BAND_SHARE + SIGN_TEXT_GAP * (line + 1) - PX;
    const length = (SIGN_W - SIGN_EDGE_INSET * 2) * (1 - line * SIGN_TEXT_STEP);
    ctx.fillRect(-SIGN_W * HALF + SIGN_EDGE_INSET, y, length, PX * 2);
  }
  ctx.restore();
}

function drawDrag(ctx: Ctx, points: ReadonlyArray<DecorPoint>): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = DRAG_SMEAR;
  // Swelling and thinning along its length, as a smear does where the body
  // pressed down and where it lifted.
  for (let index = 1; index < points.length; index++) {
    const swell =
      DRAG_MIN_SHARE + DRAG_SWELL_SHARE * (HALF + HALF * Math.sin(index * DRAG_SWELL_RATE));
    ctx.lineWidth = DRAG_SMEAR_WIDTH * swell;
    ctx.beginPath();
    ctx.moveTo(points[index - 1].x, points[index - 1].y);
    ctx.lineTo(points[index].x, points[index].y);
    ctx.stroke();
  }
}

function drawSlime(ctx: Ctx, points: ReadonlyArray<DecorPoint>): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = SLIME_WIDTH;
  ctx.strokeStyle = SLIME;
  strokeLine(ctx, points);
  ctx.lineWidth = SLIME_SHEEN_WIDTH;
  ctx.strokeStyle = SLIME_SHEEN;
  strokeLine(ctx, points, -SLIME_SHEEN_OFFSET);
}

function drawStain(ctx: Ctx, at: DecorPoint, radius: number, seed: number): void {
  const rand = mulberry32(seed);
  for (let lobe = 0; lobe < STAIN_LOBES; lobe++) {
    const x = at.x + (rand() - HALF) * radius * STAIN_LOBE_SPREAD * 2;
    const y = at.y + (rand() - HALF) * radius * STAIN_LOBE_SPREAD;
    const r = radius * (HALF + rand() * HALF);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(${ICHOR_RGB},${STAIN_ALPHA})`);
    gradient.addColorStop(1, `rgba(${ICHOR_RGB},0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * HALF + r * HALF * rand(), rand() * Math.PI, 0, TWO_PI);
    ctx.fill();
  }
}

function drawSpillAt(ctx: Ctx, spill: 'glass' | 'paper' | 'dust', at: DecorPoint): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  // The spill decals are painted in pixels at the game's tile size.
  ctx.scale(PX, PX);
  drawSpill(
    ctx,
    spill,
    'fresh',
    spillVariant(Math.floor(at.x), Math.floor(at.y)),
    0,
    0,
    SPILL_ALPHA,
  );
  ctx.restore();
}

/** A steel lab cart knocked on its side: two shelves seen edge-on, its wheels in the air. */
function drawCart(ctx: Ctx, at: DecorPoint, angle: number): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  const halfLength = CART_LENGTH * HALF;
  const halfDepth = CART_DEPTH * HALF;
  ctx.fillStyle = PROP_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    0,
    halfDepth * HALF,
    halfLength + CART_SHADOW_GROW,
    halfDepth + CART_SHADOW_GROW,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  // The two shelves, top and bottom, seen as slabs, joined by the corner posts.
  ctx.fillStyle = STEEL_DARK;
  ctx.fillRect(-halfLength, -halfDepth, CART_LENGTH, CART_DEPTH);
  ctx.fillStyle = STEEL;
  ctx.fillRect(-halfLength, -halfDepth, CART_LENGTH, CART_DEPTH * HALF * HALF);
  ctx.fillRect(
    -halfLength,
    -halfDepth + CART_DEPTH * CART_SHELF_AT,
    CART_LENGTH,
    CART_DEPTH * HALF * HALF,
  );
  ctx.fillStyle = STEEL_LIGHT;
  ctx.fillRect(-halfLength, -halfDepth, CART_LENGTH, PX);
  ctx.fillRect(-halfLength, -halfDepth, PX * 2, CART_DEPTH);
  ctx.fillRect(halfLength - PX * 2, -halfDepth, PX * 2, CART_DEPTH);
  // A push handle off one end, and the castors sticking up off the other side.
  ctx.strokeStyle = STEEL_LIGHT;
  ctx.lineWidth = PX * 2;
  ctx.beginPath();
  ctx.moveTo(-halfLength, -halfDepth + PX * 2);
  ctx.lineTo(-halfLength - CART_HANDLE_REACH, -halfDepth + PX * 2);
  ctx.lineTo(-halfLength - CART_HANDLE_REACH, halfDepth - PX * 2);
  ctx.lineTo(-halfLength, halfDepth - PX * 2);
  ctx.stroke();
  ctx.fillStyle = RUBBER;
  for (const x of [-halfLength + CART_WHEEL_RADIUS, halfLength - CART_WHEEL_RADIUS]) {
    ctx.beginPath();
    ctx.arc(x, -halfDepth - CART_WHEEL_RADIUS * HALF, CART_WHEEL_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/** Specimen jars smashed where they fell: glass, a dried stain, one rolled on its side. */
function drawJars(ctx: Ctx, at: DecorPoint, seed: number): void {
  const rand = mulberry32(seed);
  ctx.fillStyle = SPECIMEN_SPILL;
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, JAR_SPILL_RX, JAR_SPILL_RY, rand() * Math.PI, 0, TWO_PI);
  ctx.fill();
  for (let shard = 0; shard < JAR_SHARDS; shard++) {
    const x = at.x + (rand() - HALF) * JAR_SHARD_SPREAD * 2;
    const y = at.y + (rand() - HALF) * JAR_SHARD_SPREAD;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * TWO_PI);
    ctx.fillStyle = GLASS;
    ctx.beginPath();
    ctx.moveTo(-JAR_SHARD_SIZE, 0);
    ctx.lineTo(0, -JAR_SHARD_SIZE * HALF);
    ctx.lineTo(JAR_SHARD_SIZE, JAR_SHARD_SIZE * HALF);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = GLASS_GLINT;
    ctx.fillRect(0, -PX, PX, PX);
    ctx.restore();
  }
  ctx.save();
  ctx.translate(
    at.x + (rand() - HALF) * JAR_SHARD_SPREAD,
    at.y + (rand() - HALF) * JAR_SHARD_SPREAD,
  );
  ctx.rotate(rand() * TWO_PI);
  ctx.fillStyle = PROP_SHADOW;
  ctx.fillRect(-JAR_LENGTH * HALF, -JAR_RADIUS + PX * 2, JAR_LENGTH, JAR_RADIUS * 2);
  ctx.fillStyle = GLASS;
  ctx.fillRect(-JAR_LENGTH * HALF, -JAR_RADIUS, JAR_LENGTH, JAR_RADIUS * 2);
  ctx.fillStyle = JAR_LID;
  ctx.fillRect(JAR_LENGTH * HALF - PX * 3, -JAR_RADIUS, PX * 3, JAR_RADIUS * 2);
  ctx.fillStyle = GLASS_GLINT;
  ctx.fillRect(-JAR_LENGTH * HALF + PX, -JAR_RADIUS + PX, JAR_LENGTH - PX * 5, PX);
  ctx.restore();
}

function drawPapers(ctx: Ctx, at: DecorPoint, seed: number): void {
  const rand = mulberry32(seed);
  for (let sheet = 0; sheet < PAPER_SHEETS; sheet++) {
    ctx.save();
    ctx.translate(at.x + (rand() - HALF) * PAPER_SPREAD * 2, at.y + (rand() - HALF) * PAPER_SPREAD);
    ctx.rotate(rand() * TWO_PI);
    ctx.fillStyle = PROP_SHADOW;
    ctx.fillRect(-PAPER_W * HALF + PX, -PAPER_H * HALF + PX, PAPER_W, PAPER_H);
    ctx.fillStyle = PAPER;
    ctx.fillRect(-PAPER_W * HALF, -PAPER_H * HALF, PAPER_W, PAPER_H);
    ctx.fillStyle = PAPER_INK;
    for (let line = 0; line < PAPER_LINES; line++) {
      const y = -PAPER_H * HALF + (PAPER_H * (line + 1)) / (PAPER_LINES + 1);
      ctx.fillRect(-PAPER_W * HALF + PX * 2, y, PAPER_W - PX * 4, PX);
    }
    ctx.restore();
  }
}

/** The broken face's rubble: chunks of concrete heaped at the wall's foot. */
function drawRubble(ctx: Ctx, at: DecorPoint, seed: number): void {
  const rand = mulberry32(seed ^ SALT_SHAPE);
  for (let chunk = 0; chunk < RUBBLE_CHUNKS; chunk++) {
    // Heaped: the first chunks lie widest, the last on top near the middle.
    const spread = RUBBLE_SPREAD * (1 - chunk / RUBBLE_CHUNKS);
    const x = at.x + (rand() - HALF) * spread * 2;
    const y = at.y + (rand() - HALF) * spread;
    const size = RUBBLE_MIN_SIZE + rand() * RUBBLE_SIZE_SPREAD;
    const outline: DecorPoint[] = [];
    for (let point = 0; point < RUBBLE_CHUNK_POINTS; point++) {
      const angle = (point / RUBBLE_CHUNK_POINTS) * TWO_PI + rand();
      const radius = size * (HALF + rand() * HALF);
      outline.push({ x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius });
    }
    const trace = (dx: number, dy: number): void => {
      ctx.beginPath();
      outline.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x + dx, point.y + dy);
        else ctx.lineTo(point.x + dx, point.y + dy);
      });
      ctx.closePath();
    };
    ctx.fillStyle = PROP_SHADOW;
    trace(PX, PX * 2);
    ctx.fill();
    ctx.fillStyle = RUBBLE_TONES[chunk % RUBBLE_TONES.length];
    trace(0, 0);
    ctx.fill();
    ctx.fillStyle = RUBBLE_LIGHT;
    ctx.fillRect(x - size * HALF, y - size * HALF, size * HALF, PX);
  }
}

// ── The nest ─────────────────────────────────────────────────────────────────

const EGG = 'rgba(224,212,188,1)';
const EGG_SHADE = 'rgba(150,124,110,1)';
const EGG_SHINE = 'rgba(255,250,236,0.7)';
const EGG_VEIN = 'rgba(118,66,78,0.5)';
const NEST_SILK = 'rgba(232,230,220,0.78)';
const NEST_SHADOW = 'rgba(0,0,0,0.35)';
const EGG_MIN = 5;
const EGG_SPREAD = 5;
const EGG_MIN_RADIUS = 0.08;
const EGG_RADIUS_SPREAD = 0.06;
const EGG_BED_RADIUS = 0.4;
const EGG_BED_SQUASH = 0.65;
/** A clutch spreads wider along the wall than out from it. */
const EGG_BED_WIDEN = 1.5;
const EGG_TALL = 1.2;
const EGG_SHINE_SHARE = 0.75;

/** A clutch of egg sacs in a bed of silk: pale, glossy, veined. */
function drawEggCluster(ctx: Ctx, at: DecorPoint, seed: number): void {
  const rand = mulberry32(seed ^ SALT_SHAPE);
  ctx.fillStyle = NEST_SILK;
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, EGG_BED_RADIUS, EGG_BED_RADIUS * EGG_BED_SQUASH, rand(), 0, TWO_PI);
  ctx.fill();
  const eggs = EGG_MIN + Math.floor(rand() * EGG_SPREAD);
  for (let egg = 0; egg < eggs; egg++) {
    const x = at.x + (rand() - HALF) * EGG_BED_RADIUS * EGG_BED_WIDEN;
    const y = at.y + (rand() - HALF) * EGG_BED_RADIUS;
    const radius = EGG_MIN_RADIUS + rand() * EGG_RADIUS_SPREAD;
    ctx.fillStyle = NEST_SHADOW;
    ctx.beginPath();
    ctx.ellipse(x + PX, y + PX * 2, radius, radius * EGG_TALL, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = EGG_SHADE;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * EGG_TALL, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = EGG;
    ctx.beginPath();
    ctx.ellipse(
      x - PX,
      y - PX,
      radius * EGG_SHINE_SHARE,
      radius * EGG_TALL * EGG_SHINE_SHARE,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.fillStyle = EGG_SHINE;
    ctx.fillRect(x - radius * HALF, y - radius * HALF, PX * 2, PX);
    ctx.strokeStyle = EGG_VEIN;
    ctx.lineWidth = PX;
    ctx.beginPath();
    ctx.moveTo(x, y - radius);
    ctx.quadraticCurveTo(x + radius * HALF, y, x, y + radius);
    ctx.stroke();
  }
}

const MOULT = 'rgba(146,104,62,0.62)';
const MOULT_DARK = 'rgba(70,46,26,0.7)';
const MOULT_LIGHT = 'rgba(214,176,124,0.45)';
const MOULT_BODY = 0.26;
const MOULT_HEAD = 0.16;
const MOULT_LEG_PAIRS = 4;
const MOULT_LEG_REACH = 0.55;
const MOULT_LEG_BEND = 0.25;
const MOULT_LEG_WIDTH = 2.5 * PX;
const MOULT_LEG_SPREAD = 0.55;
/** How far behind the body the split in the carapace runs, as a share of the body. */
const MOULT_SPLIT_SHARE = 1.4;

/**
 * The cast-off skin of something with a body as long as a crawler: a split,
 * empty carapace with eight bent legs, translucent and brown.
 */
function drawMoult(ctx: Ctx, at: DecorPoint, angle: number, seed: number): void {
  const rand = mulberry32(seed ^ SALT_SHAPE);
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = MOULT_DARK;
  ctx.lineWidth = MOULT_LEG_WIDTH;
  for (const flank of [-1, 1]) {
    for (let pair = 0; pair < MOULT_LEG_PAIRS; pair++) {
      const share = pair / (MOULT_LEG_PAIRS - 1) - HALF;
      const root = share * MOULT_BODY;
      const reach = MOULT_LEG_REACH * (HALF + rand() * HALF);
      const sweep = share * MOULT_LEG_SPREAD * 2;
      const kneeX = root + sweep * reach * HALF;
      const kneeY = flank * reach * HALF + flank * MOULT_LEG_BEND * rand();
      ctx.beginPath();
      ctx.moveTo(root, 0);
      ctx.lineTo(kneeX, kneeY);
      ctx.lineTo(kneeX + sweep * reach, kneeY + flank * reach * HALF);
      ctx.stroke();
    }
  }
  ctx.fillStyle = MOULT;
  ctx.beginPath();
  ctx.ellipse(-MOULT_BODY * HALF, 0, MOULT_BODY, MOULT_BODY * EGG_BED_SQUASH, 0, 0, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    MOULT_BODY * HALF + MOULT_HEAD * HALF,
    0,
    MOULT_HEAD,
    MOULT_HEAD * EGG_BED_SQUASH,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.strokeStyle = MOULT_DARK;
  ctx.lineWidth = PX;
  ctx.beginPath();
  ctx.moveTo(-MOULT_BODY * MOULT_SPLIT_SHARE, 0);
  ctx.lineTo(MOULT_BODY, 0);
  ctx.stroke();
  ctx.fillStyle = MOULT_LIGHT;
  ctx.fillRect(-MOULT_BODY, -MOULT_BODY * HALF * HALF, MOULT_BODY, PX);
  ctx.restore();
}

/** A heap of eggshell where a clutch hatched: curled flakes round two broken halves. */
function drawShardPile(ctx: Ctx, at: DecorPoint, seed: number): void {
  const rand = mulberry32(seed ^ SALT_SHAPE);
  for (let half = 0; half < SHELL_HALVES; half++) {
    const x = at.x + (rand() - HALF) * SHARD_PILE_SPREAD;
    const y = at.y + (rand() - HALF) * SHARD_PILE_SPREAD * HALF;
    ctx.fillStyle = NEST_SHADOW;
    ctx.beginPath();
    ctx.ellipse(x + PX, y + PX * 2, SHELL_RADIUS, SHELL_RADIUS * HALF, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = EGG_SHADE;
    ctx.beginPath();
    ctx.ellipse(x, y, SHELL_RADIUS, SHELL_RADIUS * HALF, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = EGG;
    ctx.beginPath();
    ctx.ellipse(x, y - PX, SHELL_RADIUS, SHELL_RADIUS * HALF * HALF, 0, Math.PI, TWO_PI);
    ctx.fill();
  }
  for (let shard = 0; shard < SHARD_PILE_SHARDS; shard++) {
    const spread = SHARD_PILE_SPREAD * Math.sqrt(rand());
    const turn = rand() * TWO_PI;
    drawShard(
      ctx,
      at.x + Math.cos(turn) * spread,
      at.y + Math.sin(turn) * spread * HALF,
      SHARD_MIN_SIZE + rand() * SHARD_SIZE_SPREAD,
      rand() * TWO_PI,
    );
  }
}

const HUSK_RX = 0.2;
const HUSK_RY = 0.12;
const HUSK_WRAPS = 5;
const HUSK_LEG_REACH = 0.12;
const HUSK_WRAP = `rgba(${SILK_SHADE_RGB},0.8)`;

/** A small thing sucked dry and left in its wrapping: a rat, or a goblin's arm. */
function drawHusk(ctx: Ctx, at: DecorPoint, seed: number): void {
  const rand = mulberry32(seed ^ SALT_SHAPE);
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate((rand() - HALF) * Math.PI);
  ctx.fillStyle = NEST_SHADOW;
  ctx.beginPath();
  ctx.ellipse(PX, PX * 2, HUSK_RX, HUSK_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = NEST_SILK;
  ctx.beginPath();
  ctx.ellipse(0, 0, HUSK_RX, HUSK_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = HUSK_WRAP;
  ctx.lineWidth = PX;
  ctx.beginPath();
  for (let wrap = 0; wrap < HUSK_WRAPS; wrap++) {
    const x = -HUSK_RX + ((wrap + HALF) / HUSK_WRAPS) * HUSK_RX * 2;
    ctx.moveTo(x - HUSK_RY * HALF, -HUSK_RY);
    ctx.lineTo(x + HUSK_RY * HALF, HUSK_RY);
  }
  ctx.moveTo(HUSK_RX, 0);
  ctx.lineTo(HUSK_RX + HUSK_LEG_REACH, -HUSK_LEG_REACH * HALF);
  ctx.stroke();
  ctx.restore();
}

const GUY_ROPE = 'rgba(236,234,224,0.75)';
const GUY_ROPE_SHADE = 'rgba(0,0,0,0.25)';
const GUY_ROPE_WIDTH = 1.5 * PX;
/** Where a guy line meets the floor it splays into fibres glued down in a fan. */
const GUY_FIBRES = 4;
const GUY_FIBRE_SPREAD = 0.5;
const GUY_FIBRE_SHARE = 0.25;
const GUY_FIBRE_WIDTH = PX;

/** A rope of silk from the wall's foot, its end splayed and glued to the floor. */
function drawGuyLine(ctx: Ctx, from: DecorPoint, to: DecorPoint): void {
  ctx.lineCap = 'butt';
  ctx.lineWidth = GUY_ROPE_WIDTH;
  ctx.strokeStyle = GUY_ROPE_SHADE;
  ctx.beginPath();
  ctx.moveTo(from.x + PX, from.y + PX * 2);
  ctx.lineTo(to.x + PX, to.y + PX * 2);
  ctx.stroke();
  ctx.strokeStyle = GUY_ROPE;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const fibre = Math.hypot(dx, dy) * GUY_FIBRE_SHARE;
  const heading = Math.atan2(dy, dx);
  ctx.lineWidth = GUY_FIBRE_WIDTH;
  ctx.beginPath();
  for (let strand = 0; strand < GUY_FIBRES; strand++) {
    const turn = heading + (strand / (GUY_FIBRES - 1) - HALF) * GUY_FIBRE_SPREAD * 2;
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x + Math.cos(turn) * fibre, to.y + Math.sin(turn) * fibre);
  }
  ctx.stroke();
}
