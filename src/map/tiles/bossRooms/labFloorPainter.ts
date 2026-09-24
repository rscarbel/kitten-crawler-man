import { allocCanvas, surfaceContext, type CanvasSurface } from '../../../core/canvasSurface';
import { tileCoordKey } from '../../tileIndex';
import { LAB_WEB, positionHash, type TileContent } from '../../tileTypes';
import { drawWallShadow } from '../helpers';
import { spiderLabFloorPlanFor, type SpiderLabFloorPlan } from './labFloorPlan';

/**
 * The spider lab's floor: sealed vinyl squares, scuffed and grimed, with the
 * room's safety markings painted into it — hazard borders round the life
 * machines, a biohazard roundel by the egg, drains — and an organic stain that
 * spreads and thickens toward where the egg sac sat. Plus the web laid over it,
 * and what is left of a web once it has been cut down.
 *
 * Painted once into the chunk bake. Every mark that could cross a tile edge
 * (a stain blob, a web strand, the roundel) is placed from a neighbourhood of
 * tiles and clipped to this one, so neighbouring tiles agree about it and no
 * seam shows along the grid.
 */

type Ctx = CanvasRenderingContext2D;

// ── Palette ──────────────────────────────────────────────────────────────────

const VINYL_TONES = ['#b9bfbb', '#c2c7c2', '#adb4b0', '#b4bab5'] as const;
const VINYL_GROUT = '#7f8782';
const VINYL_BEVEL_LIGHT = 'rgba(255,255,255,0.22)';
const VINYL_BEVEL_DARK = 'rgba(40,46,44,0.22)';
const SCUFF = 'rgba(58,62,60,0.22)';
const GRIME = '38,32,30';
const STAIN_DARK_RGB = '44,24,34';
const STAIN_MID_RGB = '74,36,54';
const STAIN_VEIN = '#5c3b49';
const STAIN_GLOSS = 'rgba(210,170,200,0.28)';
const HAZARD_YELLOW = '#d8a526';
const HAZARD_BLACK = '#1d1b18';
const HAZARD_WEAR = 'rgba(185,191,187,0.35)';
const ROUNDEL_YELLOW = '#d9a21f';
const ROUNDEL_INK = '#1c1a17';
const DRAIN_FRAME = '#5a5f5c';
const DRAIN_FRAME_LIGHT = '#8a908c';
const DRAIN_VOID = '#101312';
const DRAIN_RUST = 'rgba(120,64,28,0.35)';
const SILK = '220,222,212';
const SILK_SHADOW = '40,40,36';
const TORN_SILK = 'rgba(214,214,200,0.55)';

// ── Vinyl ────────────────────────────────────────────────────────────────────

/** Vinyl squares per tile edge: two, so the floor reads as sheet tiles, not as the game grid. */
const VINYL_SQUARES_PER_TILE = 2;
const GROUT_WIDTH_FRACTION = 0.03;
const BEVEL_WIDTH_FRACTION = 0.025;
/** Chance a vinyl square carries a scuff, and how long a scuff runs. */
const SCUFF_CHANCE = 0.18;
const SCUFF_LENGTH_FRACTION = 0.28;
const SCUFF_WIDTH_FRACTION = 0.03;
/** Darkest grime, at the far wall; the entrance end is swept clean. */
const GRIME_MAX_ALPHA = 0.3;
const GRIME_CURVE = 1.6;

// ── Organic stain ────────────────────────────────────────────────────────────

/** Tiles from the egg past which there is no stain at all. */
const STAIN_REACH_TILES = 16;
/** Neighbouring tiles whose smears may reach into this one. */
const STAIN_NEIGHBOURHOOD = 1;

// ── Hazard border ────────────────────────────────────────────────────────────

/** The border rings each machine one tile out, as a band this wide. */
const HAZARD_RING_TILES = 1;
const HAZARD_BAND_FRACTION = 0.2;
const HAZARD_BAND_INSET_FRACTION = 0.06;
const HAZARD_STRIPE_FRACTION = 0.14;

// ── Roundel ──────────────────────────────────────────────────────────────────

const ROUNDEL_RADIUS_TILES = 1.35;
const ROUNDEL_RING_WIDTH = 0.1;
const ROUNDEL_LOBE_DISTANCE = 0.42;
const ROUNDEL_LOBE_RADIUS = 0.38;
const ROUNDEL_LOBE_CUT_DISTANCE = 0.55;
const ROUNDEL_LOBE_CUT_RADIUS = 0.3;
const ROUNDEL_HUB_RADIUS = 0.14;
const ROUNDEL_HUB_CUT_RADIUS = 0.07;
const ROUNDEL_INNER_RING_RADIUS = 0.5;
const ROUNDEL_INNER_RING_WIDTH = 0.07;
const ROUNDEL_ALPHA = 0.82;
const ROUNDEL_LOBE_ANGLES = [-Math.PI / 2, Math.PI / 6, (Math.PI * 5) / 6] as const;
/** Chips worn out of the roundel's paint, per tile it covers. */
const ROUNDEL_WEAR_CHIPS = 5;
const ROUNDEL_WEAR_RADIUS = 0.06;

// ── Drain ────────────────────────────────────────────────────────────────────

const DRAIN_SIZE_FRACTION = 0.62;
const DRAIN_FRAME_FRACTION = 0.07;
const DRAIN_SLOTS = 5;
const DRAIN_SLOT_FILL = 0.55;
const DRAIN_RUST_LENGTH = 0.45;

// ── Web ──────────────────────────────────────────────────────────────────────

const SILK_WASH_ALPHA = 0.4;
/** Anchor points a strand fixes to on each edge shared with more web. */
const WEB_EDGE_ANCHORS = 2;
const WEB_HUB_JITTER = 0.18;
const WEB_STRAND_WIDTH_FRACTION = 0.04;
const WEB_STRAND_ALPHA = 0.78;
const WEB_SPIRAL_RINGS = 3;
const WEB_SPIRAL_ALPHA = 0.5;
const WEB_SPIRAL_MIN_RADIUS = 0.1;
const WEB_SPIRAL_STEP = 0.1;
const WEB_SPIRAL_WIDTH_FRACTION = 0.018;
const WEB_SHADOW_OFFSET_FRACTION = 0.03;
const WEB_SHADOW_ALPHA = 0.25;
/** Loose wisps along an edge where the web stops. */
const WEB_FRAY_WISPS = 3;
const WEB_FRAY_LENGTH = 0.35;
/** A clump of wrapped debris, on this share of web tiles. */
const WEB_CLUMP_CHANCE = 0.18;
const WEB_CLUMP_RADIUS = 0.12;

// ── Torn web ─────────────────────────────────────────────────────────────────

const TORN_SHREDS = 5;
const TORN_SHRED_LENGTH = 0.22;
const TORN_SHRED_WIDTH_FRACTION = 0.03;

const TWO_PI = Math.PI * 2;
const HALF = 0.5;

// ── Hashing ──────────────────────────────────────────────────────────────────

const HASH_UNIT = 0x1_0000_0000;

/** A stable value in [0, 1) for a tile and a salt: art variation that never reaches geometry. */
function unitHash(x: number, y: number, salt: number): number {
  return positionHash(x + salt * HASH_SALT_X, y - salt * HASH_SALT_Y) / HASH_UNIT;
}
const HASH_SALT_X = 7919;
const HASH_SALT_Y = 104729;

/** Salts, one per decision, so no two choices read the same hash. */
const SALT = {
  tone: 1,
  scuff: 2,
  scuffAngle: 3,
  scuffPos: 4,
  stainCount: 5,
  stainX: 6,
  stainY: 7,
  stainR: 8,
  wear: 9,
  edge: 10,
  hub: 11,
  clump: 12,
  fray: 13,
  shred: 14,
} as const;

// ── Floor ────────────────────────────────────────────────────────────────────

/** Paints one tile of the lab's floor. */
export function drawSpiderLabFloor(
  ctx: Ctx,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const plan = spiderLabFloorPlanFor(structure);
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(sx, sy, ts, ts);
    ctx.clip();
    drawVinyl(ctx, sx, sy, ts, tx, ty);
    if (plan !== undefined) {
      drawGrime(ctx, plan, sx, sy, ts, tx, ty);
      drawStain(ctx, plan, sx, sy, ts, tx, ty);
      drawHazardBorders(ctx, plan, sx, sy, ts, tx, ty);
      drawRoundel(ctx, plan, sx, sy, ts, tx, ty);
      const key = tileCoordKey(tx, ty);
      if (plan.drains.has(key)) drawDrain(ctx, sx, sy, ts, tx, ty);
      if (plan.tornWebTiles.has(key)) drawTornWeb(ctx, sx, sy, ts, tx, ty);
    }
  } finally {
    ctx.restore();
  }
  drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
}

function drawVinyl(ctx: Ctx, sx: number, sy: number, ts: number, tx: number, ty: number): void {
  const square = ts / VINYL_SQUARES_PER_TILE;
  for (let row = 0; row < VINYL_SQUARES_PER_TILE; row++) {
    for (let col = 0; col < VINYL_SQUARES_PER_TILE; col++) {
      const qx = tx * VINYL_SQUARES_PER_TILE + col;
      const qy = ty * VINYL_SQUARES_PER_TILE + row;
      const x = sx + col * square;
      const y = sy + row * square;
      const tone = Math.floor(unitHash(qx, qy, SALT.tone) * VINYL_TONES.length);
      ctx.fillStyle = VINYL_TONES[tone] ?? VINYL_TONES[0];
      ctx.fillRect(x, y, square, square);
      const bevel = ts * BEVEL_WIDTH_FRACTION;
      ctx.fillStyle = VINYL_BEVEL_LIGHT;
      ctx.fillRect(x, y, square, bevel);
      ctx.fillRect(x, y, bevel, square);
      ctx.fillStyle = VINYL_BEVEL_DARK;
      ctx.fillRect(x, y + square - bevel, square, bevel);
      ctx.fillRect(x + square - bevel, y, bevel, square);
      if (unitHash(qx, qy, SALT.scuff) < SCUFF_CHANCE) {
        const angle = unitHash(qx, qy, SALT.scuffAngle) * Math.PI;
        const length = ts * SCUFF_LENGTH_FRACTION;
        const cx = x + square * (HALF + (unitHash(qx, qy, SALT.scuffPos) - HALF) * HALF);
        const cy = y + square * HALF;
        ctx.strokeStyle = SCUFF;
        ctx.lineWidth = ts * SCUFF_WIDTH_FRACTION;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - (Math.cos(angle) * length) / 2, cy - (Math.sin(angle) * length) / 2);
        ctx.quadraticCurveTo(
          cx,
          cy + length * WEAR_BOW,
          cx + (Math.cos(angle) * length) / 2,
          cy + (Math.sin(angle) * length) / 2,
        );
        ctx.stroke();
      }
    }
  }
  const grout = ts * GROUT_WIDTH_FRACTION;
  ctx.fillStyle = VINYL_GROUT;
  for (let i = 0; i <= VINYL_SQUARES_PER_TILE; i++) {
    ctx.fillRect(sx + i * square - grout / 2, sy, grout, ts);
    ctx.fillRect(sx, sy + i * square - grout / 2, ts, grout);
  }
}
/** How far a scuff bows off its straight line, as a share of its length. */
const WEAR_BOW = 0.15;

function drawGrime(
  ctx: Ctx,
  plan: SpiderLabFloorPlan,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  // Graded across the tile along the room's depth, so the grime deepens
  // smoothly instead of stepping a shade darker at every row.
  const here = plan.frame.toFrame({ x: tx, y: ty });
  const grimeAt = (depth: number): string => {
    const share = Math.max(0, Math.min(1, depth / Math.max(1, plan.frame.depthMax)));
    return `rgba(${GRIME},${(GRIME_MAX_ALPHA * Math.pow(share, GRIME_CURVE)).toFixed(3)})`;
  };
  const inward = plan.frame.toWorld({ along: here.along, depth: here.depth + 1 });
  const stepX = inward.x - tx;
  const stepY = inward.y - ty;
  const nearX = sx + (stepX < 0 ? ts : 0);
  const nearY = sy + (stepY < 0 ? ts : 0);
  const gradient = ctx.createLinearGradient(nearX, nearY, nearX + stepX * ts, nearY + stepY * ts);
  gradient.addColorStop(0, grimeAt(here.depth - HALF));
  gradient.addColorStop(1, grimeAt(here.depth + HALF));
  ctx.fillStyle = gradient;
  ctx.fillRect(sx, sy, ts, ts);
}

/** How strongly the stain has taken a tile, 1 at the egg and 0 past its reach. */
function stainStrength(plan: SpiderLabFloorPlan, tx: number, ty: number): number {
  const egg = plan.room.spiderEggTile;
  const distance = Math.hypot(tx - egg.x, ty - egg.y);
  return Math.max(0, 1 - distance / STAIN_REACH_TILES);
}

function drawStain(
  ctx: Ctx,
  plan: SpiderLabFloorPlan,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  // The mass: broad, faint smears from every tile around, overlapping into one
  // continuous rot that deepens toward the egg.
  for (let ny = ty - STAIN_NEIGHBOURHOOD; ny <= ty + STAIN_NEIGHBOURHOOD; ny++) {
    for (let nx = tx - STAIN_NEIGHBOURHOOD; nx <= tx + STAIN_NEIGHBOURHOOD; nx++) {
      const strength = stainStrength(plan, nx, ny);
      if (strength <= 0) continue;
      for (let i = 0; i < STAIN_SMEARS_PER_TILE; i++) {
        const bx = sx + (nx - tx + unitHash(nx + i, ny, SALT.stainX)) * ts;
        const by = sy + (ny - ty + unitHash(nx, ny + i, SALT.stainY)) * ts;
        const radius =
          ts *
          (STAIN_SMEAR_MIN_RADIUS +
            unitHash(nx + i, ny + i, SALT.stainR) * STAIN_SMEAR_RADIUS_RANGE);
        const angle = unitHash(nx - i, ny + i, SALT.stainCount) * Math.PI;
        const alpha = STAIN_SMEAR_ALPHA * Math.pow(strength, STAIN_SMEAR_CURVE);
        fillSoftBlob(ctx, bx, by, radius, angle, i === 0 ? STAIN_MID_RGB : STAIN_DARK_RGB, alpha);
      }
      const glossy = unitHash(nx, ny, SALT.stainCount) < STAIN_GLOSS_CHANCE * strength;
      if (glossy) {
        const gx = sx + (nx - tx + unitHash(ny, nx, SALT.stainX)) * ts;
        const gy = sy + (ny - ty + unitHash(ny, nx, SALT.stainY)) * ts;
        const radius = ts * STAIN_POOL_RADIUS * (HALF + strength);
        fillSoftBlob(
          ctx,
          gx,
          gy,
          radius * STAIN_POOL_SOFT_REACH,
          0,
          STAIN_DARK_RGB,
          STAIN_POOL_ALPHA * strength,
        );
        ctx.globalAlpha = strength;
        ctx.fillStyle = STAIN_GLOSS;
        ctx.beginPath();
        ctx.ellipse(
          gx - radius * STAIN_GLOSS_OFFSET,
          gy - radius * STAIN_GLOSS_OFFSET * STAIN_SQUASH,
          radius * STAIN_GLOSS_SIZE,
          radius * STAIN_GLOSS_SIZE * STAIN_SQUASH,
          0,
          0,
          TWO_PI,
        );
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  drawVeins(ctx, plan, sx, sy, ts, tx, ty);
}

/**
 * A soft-edged ellipse, dense at the centre and fading to nothing at its rim,
 * so neighbouring smears melt into one mass instead of reading as dots.
 */
function fillSoftBlob(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  angle: number,
  rgb: string,
  alpha: number,
): void {
  if (alpha <= 0 || radius <= 0) return;
  ctx.save();
  try {
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.scale(1, STAIN_SQUASH);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, `rgba(${rgb},${alpha.toFixed(3)})`);
    gradient.addColorStop(
      STAIN_SOFT_CORE,
      `rgba(${rgb},${(alpha * STAIN_SOFT_CORE_ALPHA).toFixed(3)})`,
    );
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TWO_PI);
    ctx.fill();
  } finally {
    ctx.restore();
  }
}
const STAIN_SOFT_CORE = 0.5;
const STAIN_SOFT_CORE_ALPHA = 0.7;
const STAIN_POOL_SOFT_REACH = 1.6;

/** One vein of the stain: a wandering line out of the egg, as tile-space points. */
type Vein = ReadonlyArray<{ x: number; y: number; width: number }>;

const veinsByPlan = new WeakMap<SpiderLabFloorPlan, readonly Vein[]>();

/**
 * The veins crawling out of where the egg sat, computed once per lab. Placed
 * from a hash of the vein's own index, never the floor's seed: they are art,
 * and art may not vary the room between two floors that share its layout.
 */
function veinsFor(plan: SpiderLabFloorPlan): readonly Vein[] {
  const cached = veinsByPlan.get(plan);
  if (cached !== undefined) return cached;
  const egg = plan.room.spiderEggTile;
  const veins: Vein[] = [];
  for (let v = 0; v < VEIN_COUNT; v++) {
    const angle = ((v + unitHash(v, VEIN_COUNT, SALT.edge)) / VEIN_COUNT) * TWO_PI;
    const length =
      STAIN_REACH_TILES * (VEIN_MIN_REACH + unitHash(v, v, SALT.hub) * VEIN_REACH_RANGE);
    const phase = unitHash(v, 0, SALT.fray) * TWO_PI;
    const points: Array<{ x: number; y: number; width: number }> = [];
    const along = { x: Math.cos(angle), y: Math.sin(angle) };
    const wobbleAt = (t: number): number =>
      Math.sin(t * VEIN_WOBBLE_FREQUENCY + phase) * VEIN_WOBBLE_TILES +
      Math.sin(t * VEIN_WOBBLE_FREQUENCY * VEIN_RIPPLE_RATIO + phase * 2) * VEIN_RIPPLE_TILES;
    let step = 0;
    for (let t = 0; t <= length; t += VEIN_STEP_TILES) {
      const wobble = wobbleAt(t);
      const px = egg.x + HALF + along.x * t - along.y * wobble;
      const py = egg.y + HALF + along.y * t + along.x * wobble;
      const width = VEIN_BASE_WIDTH * (1 - t / length) + VEIN_TIP_WIDTH;
      points.push({ x: px, y: py, width });
      step++;
      // A short twig off every few steps, alternating sides.
      if (step % VEIN_TWIG_EVERY === 0 && t > VEIN_TWIG_FIRST_TILES) {
        const side = (step / VEIN_TWIG_EVERY) % 2 === 0 ? 1 : -1;
        const twigAngle = angle + side * VEIN_TWIG_ANGLE;
        const twig: Array<{ x: number; y: number; width: number }> = [];
        for (let u = 0; u <= VEIN_TWIG_TILES; u += VEIN_STEP_TILES) {
          twig.push({
            x: px + Math.cos(twigAngle) * u,
            y: py + Math.sin(twigAngle) * u,
            width: width * (1 - u / VEIN_TWIG_TILES) * VEIN_TWIG_WIDTH_SHARE + VEIN_TIP_WIDTH,
          });
        }
        veins.push(twig);
      }
    }
    veins.push(points);
  }
  veinsByPlan.set(plan, veins);
  return veins;
}

function drawVeins(
  ctx: Ctx,
  plan: SpiderLabFloorPlan,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = STAIN_VEIN;
  for (const vein of veinsFor(plan)) {
    for (let i = 1; i < vein.length; i++) {
      const from = vein[i - 1];
      const to = vein[i];
      const nearTile =
        Math.abs(from.x - (tx + HALF)) < VEIN_TILE_REACH &&
        Math.abs(from.y - (ty + HALF)) < VEIN_TILE_REACH;
      if (!nearTile) continue;
      ctx.lineWidth = ts * from.width;
      ctx.beginPath();
      ctx.moveTo(sx + (from.x - tx) * ts, sy + (from.y - ty) * ts);
      ctx.lineTo(sx + (to.x - tx) * ts, sy + (to.y - ty) * ts);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
const VEIN_COUNT = 11;
const VEIN_MIN_REACH = 0.45;
const VEIN_REACH_RANGE = 0.5;
const VEIN_STEP_TILES = 0.4;
const VEIN_WOBBLE_FREQUENCY = 0.9;
const VEIN_WOBBLE_TILES = 0.6;
const VEIN_BASE_WIDTH = 0.1;
const VEIN_TIP_WIDTH = 0.015;
const VEIN_RIPPLE_RATIO = 3.1;
const VEIN_RIPPLE_TILES = 0.18;
const VEIN_TWIG_EVERY = 4;
const VEIN_TWIG_FIRST_TILES = 1.5;
const VEIN_TWIG_ANGLE = 0.9;
const VEIN_TWIG_TILES = 1.2;
const VEIN_TWIG_WIDTH_SHARE = 0.7;
/** A vein segment that starts this many tiles from a tile's centre can reach into it. */
const VEIN_TILE_REACH = 1.5;
const STAIN_SMEARS_PER_TILE = 2;
const STAIN_SMEAR_MIN_RADIUS = 0.35;
const STAIN_SMEAR_RADIUS_RANGE = 0.45;
const STAIN_SMEAR_ALPHA = 0.42;
const STAIN_SMEAR_CURVE = 1.3;
const STAIN_GLOSS_CHANCE = 0.18;
const STAIN_POOL_RADIUS = 0.16;
const STAIN_POOL_ALPHA = 0.75;
/** Floor marks are seen at an angle: every round mark is this much shallower than wide. */
const STAIN_SQUASH = 0.72;
const STAIN_GLOSS_OFFSET = 0.35;
const STAIN_GLOSS_SIZE = 0.28;

function drawHazardBorders(
  ctx: Ctx,
  plan: SpiderLabFloorPlan,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const reach = HAZARD_RING_TILES + 1;
  for (const machine of plan.room.lifeMachineTiles) {
    if (Math.abs(machine.x - tx) > reach || Math.abs(machine.y - ty) > reach) continue;
    const originX = sx + (machine.x - HAZARD_RING_TILES - tx) * ts;
    const originY = sy + (machine.y - HAZARD_RING_TILES - ty) * ts;
    const span = (HAZARD_RING_TILES * 2 + 1) * ts;
    const inset = ts * HAZARD_BAND_INSET_FRACTION;
    const band = ts * HAZARD_BAND_FRACTION;
    const outerX = originX + inset;
    const outerY = originY + inset;
    const outer = span - inset * 2;
    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(outerX, outerY, outer, band);
      ctx.rect(outerX, outerY + outer - band, outer, band);
      ctx.rect(outerX, outerY + band, band, outer - band * 2);
      ctx.rect(outerX + outer - band, outerY + band, band, outer - band * 2);
      ctx.clip();
      ctx.fillStyle = HAZARD_YELLOW;
      ctx.fillRect(outerX, outerY, outer, outer);
      const stripe = ts * HAZARD_STRIPE_FRACTION;
      ctx.strokeStyle = HAZARD_BLACK;
      ctx.lineWidth = stripe;
      ctx.beginPath();
      for (let offset = -outer; offset < outer * 2; offset += stripe * 2) {
        ctx.moveTo(outerX + offset, outerY);
        ctx.lineTo(outerX + offset + outer, outerY + outer);
      }
      ctx.stroke();
      // Foot traffic has worn the paint back to vinyl in patches.
      ctx.fillStyle = HAZARD_WEAR;
      for (let i = 0; i < ROUNDEL_WEAR_CHIPS; i++) {
        const wx = sx + unitHash(tx + i, ty, SALT.wear) * ts;
        const wy = sy + unitHash(tx, ty + i, SALT.wear) * ts;
        ctx.beginPath();
        ctx.arc(wx, wy, ts * ROUNDEL_WEAR_RADIUS * (1 + unitHash(tx, ty, i)), 0, TWO_PI);
        ctx.fill();
      }
    } finally {
      ctx.restore();
    }
  }
}

/** The roundel, painted once per tile size and blitted into each tile it covers. */
const roundelCache = new Map<number, CanvasSurface>();

function roundelSurface(ts: number): CanvasSurface {
  const cached = roundelCache.get(ts);
  if (cached !== undefined) return cached;
  const radius = ROUNDEL_RADIUS_TILES * ts;
  const size = Math.ceil(radius * 2);
  const surface = allocCanvas(size, size);
  const c = surfaceContext(surface);
  const cx = size / 2;
  const cy = size / 2;
  c.fillStyle = ROUNDEL_YELLOW;
  // Outer ring.
  c.beginPath();
  c.arc(cx, cy, radius, 0, TWO_PI);
  c.arc(cx, cy, radius * (1 - ROUNDEL_RING_WIDTH), 0, TWO_PI, true);
  c.fill();
  // Three lobes, each a disc with a smaller disc bitten out of its outer side.
  for (const angle of ROUNDEL_LOBE_ANGLES) {
    const lx = cx + Math.cos(angle) * radius * ROUNDEL_LOBE_DISTANCE;
    const ly = cy + Math.sin(angle) * radius * ROUNDEL_LOBE_DISTANCE;
    c.fillStyle = ROUNDEL_YELLOW;
    c.beginPath();
    c.arc(lx, ly, radius * ROUNDEL_LOBE_RADIUS, 0, TWO_PI);
    c.fill();
  }
  c.globalCompositeOperation = 'destination-out';
  for (const angle of ROUNDEL_LOBE_ANGLES) {
    const bx = cx + Math.cos(angle) * radius * ROUNDEL_LOBE_CUT_DISTANCE;
    const by = cy + Math.sin(angle) * radius * ROUNDEL_LOBE_CUT_DISTANCE;
    c.beginPath();
    c.arc(bx, by, radius * ROUNDEL_LOBE_CUT_RADIUS, 0, TWO_PI);
    c.fill();
  }
  c.beginPath();
  c.arc(cx, cy, radius * ROUNDEL_HUB_RADIUS, 0, TWO_PI);
  c.fill();
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = ROUNDEL_YELLOW;
  c.beginPath();
  c.arc(cx, cy, radius * ROUNDEL_HUB_RADIUS, 0, TWO_PI);
  c.arc(cx, cy, radius * ROUNDEL_HUB_CUT_RADIUS, 0, TWO_PI, true);
  c.fill();
  // The broken inner ring that crosses the lobes.
  c.strokeStyle = ROUNDEL_YELLOW;
  c.lineWidth = radius * ROUNDEL_INNER_RING_WIDTH;
  c.beginPath();
  c.arc(cx, cy, radius * ROUNDEL_INNER_RING_RADIUS, 0, TWO_PI);
  c.stroke();
  // Ink the whole symbol from behind, so it reads against pale vinyl.
  c.globalCompositeOperation = 'destination-over';
  c.strokeStyle = ROUNDEL_INK;
  c.lineWidth = Math.max(1, ts * ROUNDEL_INK_WIDTH_FRACTION);
  c.beginPath();
  c.arc(cx, cy, radius, 0, TWO_PI);
  c.stroke();
  c.globalCompositeOperation = 'source-over';
  roundelCache.set(ts, surface);
  return surface;
}
const ROUNDEL_INK_WIDTH_FRACTION = 0.08;

function drawRoundel(
  ctx: Ctx,
  plan: SpiderLabFloorPlan,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const { x: rx, y: ry } = plan.roundelCentre;
  const reach = ROUNDEL_RADIUS_TILES + 1;
  if (Math.abs(rx - (tx + HALF)) > reach || Math.abs(ry - (ty + HALF)) > reach) return;
  const surface = roundelSurface(ts);
  const radius = ROUNDEL_RADIUS_TILES * ts;
  ctx.globalAlpha = ROUNDEL_ALPHA * (1 - stainStrength(plan, tx, ty) * HALF);
  ctx.drawImage(surface, sx + (rx - tx) * ts - radius, sy + (ry - ty) * ts - radius);
  ctx.globalAlpha = 1;
  ctx.fillStyle = HAZARD_WEAR;
  for (let i = 0; i < ROUNDEL_WEAR_CHIPS; i++) {
    const wx = sx + unitHash(tx + i, ty, SALT.wear) * ts;
    const wy = sy + unitHash(tx, ty + i, SALT.wear) * ts;
    ctx.beginPath();
    ctx.arc(wx, wy, ts * ROUNDEL_WEAR_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
}

function drawDrain(ctx: Ctx, sx: number, sy: number, ts: number, tx: number, ty: number): void {
  const size = ts * DRAIN_SIZE_FRACTION;
  const x = sx + (ts - size) / 2;
  const y = sy + (ts - size) / 2;
  const frame = ts * DRAIN_FRAME_FRACTION;
  ctx.fillStyle = DRAIN_RUST;
  ctx.beginPath();
  ctx.ellipse(
    x + size / 2,
    y + size,
    size * HALF,
    ts * DRAIN_RUST_LENGTH * HALF,
    unitHash(tx, ty, SALT.edge) - HALF,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillStyle = DRAIN_FRAME;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = DRAIN_FRAME_LIGHT;
  ctx.fillRect(x, y, size, frame * HALF);
  ctx.fillStyle = DRAIN_VOID;
  const inner = size - frame * 2;
  const slotPitch = inner / DRAIN_SLOTS;
  for (let i = 0; i < DRAIN_SLOTS; i++) {
    ctx.fillRect(x + frame, y + frame + i * slotPitch, inner, slotPitch * DRAIN_SLOT_FILL);
  }
}

function drawTornWeb(ctx: Ctx, sx: number, sy: number, ts: number, tx: number, ty: number): void {
  ctx.strokeStyle = TORN_SILK;
  ctx.lineWidth = ts * TORN_SHRED_WIDTH_FRACTION;
  ctx.lineCap = 'round';
  for (let i = 0; i < TORN_SHREDS; i++) {
    const x = sx + unitHash(tx + i, ty, SALT.shred) * ts;
    const y = sy + unitHash(tx, ty + i, SALT.shred) * ts;
    const angle = unitHash(tx + i, ty + i, SALT.shred) * TWO_PI;
    const length = ts * TORN_SHRED_LENGTH;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(angle) * length * HALF,
      y + Math.sin(angle + HALF) * length * HALF,
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
    );
    ctx.stroke();
  }
}

// ── Web ──────────────────────────────────────────────────────────────────────

/** Whether a tile carries web, for joining strands across the edge between two tiles. */
function isWeb(structure: TileContent[][], x: number, y: number): boolean {
  return structure[y]?.[x]?.type === LAB_WEB;
}

/**
 * A strand anchor on the edge between two tiles, as a share along that edge.
 * Keyed on the edge itself, so the tiles either side of it pick the same spot.
 */
function edgeAnchor(edgeX: number, edgeY: number, vertical: boolean, index: number): number {
  const salt = SALT.edge + (vertical ? 1 : 0) * EDGE_ORIENTATION_SALT + index;
  const spread = HALF / WEB_EDGE_ANCHORS;
  return spread * HALF + ((index + unitHash(edgeX, edgeY, salt)) * (1 - spread)) / WEB_EDGE_ANCHORS;
}
const EDGE_ORIENTATION_SALT = 17;

/**
 * Paints web over a lab tile: a pale wash, strands running from a hub to
 * anchors shared with each neighbouring web tile, a few rings of spiral, and
 * loose wisps where the web gives out. Pale and busy on purpose — webbing is
 * slow ground, and slow ground has to read as different from across the room.
 */
export function drawLabWeb(
  ctx: Ctx,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(sx, sy, ts, ts);
    ctx.clip();
    ctx.fillStyle = `rgba(${SILK},${SILK_WASH_ALPHA})`;
    ctx.fillRect(sx, sy, ts, ts);

    const hubX = sx + ts * (HALF + (unitHash(tx, ty, SALT.hub) - HALF) * WEB_HUB_JITTER * 2);
    const hubY = sy + ts * (HALF + (unitHash(ty, tx, SALT.hub) - HALF) * WEB_HUB_JITTER * 2);
    const anchors: Array<{ x: number; y: number }> = [];
    const edges = [
      { dx: 0, dy: -1, vertical: false, ex: tx, ey: ty },
      { dx: 0, dy: 1, vertical: false, ex: tx, ey: ty + 1 },
      { dx: -1, dy: 0, vertical: true, ex: tx, ey: ty },
      { dx: 1, dy: 0, vertical: true, ex: tx + 1, ey: ty },
    ];
    const frayed: typeof edges = [];
    for (const edge of edges) {
      if (!isWeb(structure, tx + edge.dx, ty + edge.dy)) {
        frayed.push(edge);
        continue;
      }
      for (let i = 0; i < WEB_EDGE_ANCHORS; i++) {
        const along = edgeAnchor(edge.ex, edge.ey, edge.vertical, i) * ts;
        anchors.push(
          edge.vertical
            ? { x: sx + (edge.ex - tx) * ts, y: sy + along }
            : { x: sx + along, y: sy + (edge.ey - ty) * ts },
        );
      }
    }
    // Strands, each with a soft shadow on the floor below it.
    const strand = (alpha: number, offset: number, color: string): void => {
      ctx.strokeStyle = `rgba(${color},${alpha})`;
      ctx.lineWidth = ts * WEB_STRAND_WIDTH_FRACTION;
      ctx.beginPath();
      for (const anchor of anchors) {
        ctx.moveTo(hubX + offset, hubY + offset);
        ctx.lineTo(anchor.x + offset, anchor.y + offset);
      }
      ctx.stroke();
    };
    const shadowOffset = ts * WEB_SHADOW_OFFSET_FRACTION;
    strand(WEB_SHADOW_ALPHA, shadowOffset, SILK_SHADOW);
    strand(WEB_STRAND_ALPHA, 0, SILK);

    if (anchors.length > 0) {
      ctx.strokeStyle = `rgba(${SILK},${WEB_SPIRAL_ALPHA})`;
      ctx.lineWidth = ts * WEB_SPIRAL_WIDTH_FRACTION;
      const ordered = anchors.map((a) => Math.atan2(a.y - hubY, a.x - hubX)).sort((a, b) => a - b);
      for (let ring = 0; ring < WEB_SPIRAL_RINGS; ring++) {
        const r = ts * (WEB_SPIRAL_MIN_RADIUS + ring * WEB_SPIRAL_STEP);
        ctx.beginPath();
        ordered.forEach((angle, i) => {
          const px = hubX + Math.cos(angle) * r;
          const py = hubY + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.stroke();
      }
    }

    // Wisps trailing off where the web ends.
    ctx.strokeStyle = `rgba(${SILK},${WEB_STRAND_ALPHA * HALF})`;
    ctx.lineWidth = ts * WEB_SPIRAL_WIDTH_FRACTION;
    for (const edge of frayed) {
      for (let i = 0; i < WEB_FRAY_WISPS; i++) {
        const along = unitHash(edge.ex + i, edge.ey, SALT.fray + (edge.vertical ? 1 : 0)) * ts;
        const baseX = edge.vertical ? sx + (edge.ex - tx) * ts : sx + along;
        const baseY = edge.vertical ? sy + along : sy + (edge.ey - ty) * ts;
        const inX = -edge.dx * ts * WEB_FRAY_LENGTH;
        const inY = -edge.dy * ts * WEB_FRAY_LENGTH;
        ctx.beginPath();
        ctx.moveTo(hubX, hubY);
        ctx.quadraticCurveTo(baseX + inX, baseY + inY, baseX + inX * HALF, baseY + inY * HALF);
        ctx.stroke();
      }
    }

    if (unitHash(tx, ty, SALT.clump) < WEB_CLUMP_CHANCE) {
      ctx.fillStyle = `rgba(${SILK},${WEB_STRAND_ALPHA})`;
      ctx.beginPath();
      ctx.ellipse(
        hubX,
        hubY,
        ts * WEB_CLUMP_RADIUS,
        ts * WEB_CLUMP_RADIUS * STAIN_SQUASH,
        0,
        0,
        TWO_PI,
      );
      ctx.fill();
      ctx.fillStyle = `rgba(${SILK_SHADOW},${WEB_SHADOW_ALPHA})`;
      ctx.beginPath();
      ctx.ellipse(
        hubX,
        hubY + ts * WEB_CLUMP_RADIUS * HALF,
        ts * WEB_CLUMP_RADIUS,
        ts * WEB_CLUMP_RADIUS * HALF * STAIN_SQUASH,
        0,
        0,
        Math.PI,
      );
      ctx.fill();
    }
  } finally {
    ctx.restore();
  }
}
