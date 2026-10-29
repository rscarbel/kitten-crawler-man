/**
 * The Scroll of Entanglement's roots: gnarled roots tearing up out of a patch
 * of torn soil at a held mob's feet and coiling round its legs, then snapping
 * and crumbling to bark and dirt when the hold ends.
 *
 * A pure function of the pose, so a review render and the live game draw one
 * image; every twist is hashed from the hold's seed, never rolled, so a mob's
 * roots keep their shape for the whole hold.
 *
 * The roots are drawn over the mob, so the coil that passes behind its legs is
 * painted faint and only the turns wrapping in front are solid: one call reads
 * as roots both behind and in front of the body.
 */

import { clamp01, easeOut, lerp } from './bipedArt';
import { drawGroundPool, hash01, hashRange, rgba, type Rgb } from '../status/statusPaint';

const TAU = Math.PI * 2;
const HALF = 0.5;

// ── Palette ──────────────────────────────────────────────────────────────────

const ROOT_OUTLINE: Rgb = [20, 13, 8];
const ROOT_BARK: Rgb = [72, 50, 31];
const ROOT_BARK_LIGHT: Rgb = [132, 100, 66];
/** Root hairs and freshly torn tips are pale, the way a pulled root's are. */
const ROOTLET: Rgb = [206, 184, 140];
const SOIL_DEEP: Rgb = [26, 19, 12];
const SOIL_CLOD: Rgb = [78, 58, 38];
const BARK_CRUMB: Rgb = [110, 80, 50];

// ── Timing ───────────────────────────────────────────────────────────────────

/** How long the roots take to break apart once a hold ends. */
export const ENTANGLE_ROOTS_CRUMBLE_FRAMES = 24;

const GROW_FRAMES = 13;
/** Each tendril starts a little after the last, so they tear up in a burst rather than rise as one. */
const TENDRIL_LAG_FRAMES = 1.5;
const FLECK_FRAMES = 16;
/** A piece snaps somewhere in this first share of the crumble, so the last one still has time to fall. */
const SNAP_SPREAD = 0.45;
const TIGHTEN_RATE = 0.075;

// ── Shape, as shares of the tile unless named in pixels ─────────────────────

/** Where the mob's feet stand below the tile's centre. */
const FEET_DROP = 0.36;
const MIN_TENDRILS = 3;
const MAX_TENDRILS = 5;
const SOIL_RADIUS = 0.5;
const SOIL_DEPTH = 0.36;
const SOIL_ALPHA = 0.55;
const CLODS = 7;
const CLOD_RIM_SHARE = 0.85;
const CLOD_BURST = 0.12;
const CLOD_MIN_PX = 1.1;
const CLOD_MAX_PX = 2;
/** How round the coil is around the legs, before it flares out at the ground. */
const WRAP_RADIUS = 0.22;
const GROUND_FLARE = 0.7;
/** The coil is a ring lying on the floor, seen from above at this squash. */
const COIL_DEPTH = 0.35;
const REACH_MIN = 0.24;
const REACH_MAX = 0.46;
const TURNS_MIN = 0.45;
const TURNS_MAX = 0.85;
/** The tip curls out off the leg rather than ending flush against it. */
const TIP_CURL = 0.35;
const TIP_CURL_FROM = 0.82;
const TIGHTEN_SHARE = 0.04;
/** The coil sweeps round slowly at first, so a root climbs out of the soil before it wraps. */
const TWIST_EASE_POWER = 1.7;

const SAMPLES = 16;
const BASE_WIDTH_PX = 3.6;
const TIP_WIDTH_PX = 0.9;
const OUTLINE_PX = 1.1;
const HIGHLIGHT_PX = 0.7;
/** The highlight runs along the lit (upper) edge of the root, this share of its half-width out. */
const HIGHLIGHT_OFFSET = 0.45;
/** Knots and kinks along a root, in pixels and waves per root. */
const GNARL_PX = 1.2;
const GNARL_WAVES = 2.7;
const BEHIND_ALPHA = 0.38;

const ROOTLETS_PER_TENDRIL = 3;
const ROOTLET_LENGTH_PX = 2.8;
const ROOTLET_WIDTH_PX = 0.6;
/** A hair points out and a little back down the root, the way they trail. */
const ROOTLET_TRAIL = 0.5;
/** Rootlets stay off the thick base, where they would be lost in the soil. */
const ROOTLET_FIRST_SAMPLE = 3;

const FLECKS = 9;
const FLECK_REACH = 0.5;
const FLECK_LIFT = 0.38;
const FLECK_MIN_PX = 1;
/** Scales t(1 - t), which peaks at a quarter, so a fleck's arc tops out at its full lift. */
const PARABOLA_PEAK_SCALE = 4;
const FLECK_MAX_PX = 1.8;

const PIECES_PER_TENDRIL = 4;
const PIECE_FALL = 0.42;
const PIECE_DRIFT = 0.12;
const PIECE_SPIN = 0.9;
/** A falling piece withers as it goes, so it never lands as a whole stick. */
const PIECE_SHRINK = 0.45;
const CRUMBS_PER_PIECE = 3;
const CRUMB_SCATTER = 0.22;
const CRUMB_FALL = 0.6;
const CRUMB_MIN_PX = 0.8;
const CRUMB_MAX_PX = 1.6;

// ── Hash keys ────────────────────────────────────────────────────────────────

const SEED_STRIDE = 0.618;
const TENDRIL_KEY_STRIDE = 13.7;
const CLOD_KEY_STRIDE = 5.3;
const FLECK_KEY_STRIDE = 7.9;
const PIECE_KEY_STRIDE = 3.1;
const CRUMB_KEY_STRIDE = 1.7;
const ROOTLET_KEY_STRIDE = 2.3;
const COUNT_KEY = 0.5;

/** Where the roots are drawn and how far into their life they are. */
export interface EntanglementRootsPose {
  /** Centre of the held mob's tile, in screen pixels. */
  readonly x: number;
  readonly y: number;
  /** The world's tile size in pixels (TILE_SIZE). */
  readonly tileSize: number;
  /** Frames since the roots burst up. */
  readonly heldFrames: number;
  /** Frames since the hold ended and the roots began to break apart; null while they still hold. */
  readonly crumbleFrames: number | null;
  /** Stable per hold, so each mob's roots grow their own way and keep it. */
  readonly seed: number;
}

interface RootSample {
  readonly x: number;
  readonly y: number;
  readonly halfWidth: number;
  /** Whether this stretch of coil wraps in front of the legs. */
  readonly front: boolean;
}

/** One snapped length of root as it falls: its own offset, spin and fade. */
interface PieceMotion {
  readonly dx: number;
  readonly dy: number;
  readonly spin: number;
  readonly shrink: number;
  readonly alpha: number;
  /** 0 while still attached, rising to 1 as it finishes falling. */
  readonly progress: number;
}

const HELD_PIECE: PieceMotion = { dx: 0, dy: 0, spin: 0, shrink: 1, alpha: 1, progress: 0 };

function pieceMotion(key: number, crumble: number, tile: number): PieceMotion {
  if (crumble <= 0) return HELD_PIECE;
  const snapAt = hash01(key) * SNAP_SPREAD;
  const progress = clamp01((crumble - snapAt) / (1 - snapAt));
  if (progress <= 0) return HELD_PIECE;
  const drift = hashRange(key + 1, -PIECE_DRIFT, PIECE_DRIFT) * tile;
  return {
    dx: drift * progress,
    dy: progress * progress * PIECE_FALL * tile,
    spin: hashRange(key + 2, -PIECE_SPIN, PIECE_SPIN) * progress,
    shrink: 1 - PIECE_SHRINK * progress,
    alpha: 1 - progress * progress,
    progress,
  };
}

function tendrilSamples(
  pose: EntanglementRootsPose,
  key: number,
  grow: number,
  tighten: number,
): RootSample[] {
  const tile = pose.tileSize;
  const footY = pose.y + tile * FEET_DROP;
  const startAngle = hash01(key) * TAU;
  const direction = hash01(key + 1) < HALF ? -1 : 1;
  const turns = hashRange(key + 2, TURNS_MIN, TURNS_MAX);
  const reach = hashRange(key + 3, REACH_MIN, REACH_MAX) * tile;
  const gnarlPhase = hash01(key + 4) * TAU;
  const wrap = tile * WRAP_RADIUS * (1 - tighten);
  const samples: RootSample[] = [];
  for (let index = 0; index <= SAMPLES; index++) {
    const along = index / SAMPLES;
    const t = along * grow;
    const twist = Math.pow(t, TWIST_EASE_POWER);
    const angle = startAngle + direction * turns * TAU * twist;
    const tipCurl = Math.max(0, (t - TIP_CURL_FROM) / (1 - TIP_CURL_FROM)) * TIP_CURL;
    const radius = wrap * (1 + GROUND_FLARE * (1 - t) * (1 - t) + tipCurl);
    const gnarl = Math.sin(t * GNARL_WAVES * TAU + gnarlPhase) * GNARL_PX;
    samples.push({
      x: pose.x + Math.cos(angle) * radius + gnarl,
      y: footY - t * reach + Math.sin(angle) * radius * COIL_DEPTH,
      halfWidth: lerp(BASE_WIDTH_PX, TIP_WIDTH_PX, along) * HALF,
      front: Math.sin(angle) > 0,
    });
  }
  return samples;
}

function moved(sample: RootSample, pivot: RootSample, motion: PieceMotion): RootSample {
  const cos = Math.cos(motion.spin);
  const sin = Math.sin(motion.spin);
  const offsetX = sample.x - pivot.x;
  const offsetY = sample.y - pivot.y;
  return {
    x: pivot.x + offsetX * cos - offsetY * sin + motion.dx,
    y: pivot.y + offsetX * sin + offsetY * cos + motion.dy,
    halfWidth: sample.halfWidth * motion.shrink,
    front: sample.front,
  };
}

/** The unit normal at a sample, turned to face up the screen, toward the light. */
function litNormal(run: readonly RootSample[], index: number): { nx: number; ny: number } {
  const before = run[Math.max(0, index - 1)];
  const after = run[Math.min(run.length - 1, index + 1)];
  const tx = after.x - before.x;
  const ty = after.y - before.y;
  const length = Math.hypot(tx, ty);
  if (length === 0) return { nx: 0, ny: -1 };
  const nx = -ty / length;
  const ny = tx / length;
  return ny > 0 ? { nx: -nx, ny: -ny } : { nx, ny };
}

/** A tapered ribbon along the run: outline, bark, then a thin lit edge. */
function paintRun(ctx: CanvasRenderingContext2D, run: readonly RootSample[], alpha: number): void {
  if (run.length < 2 || alpha <= 0) return;
  const normals = run.map((_, index) => litNormal(run, index));
  ctx.beginPath();
  run.forEach((sample, index) => {
    const { nx, ny } = normals[index];
    const px = sample.x + nx * sample.halfWidth;
    const py = sample.y + ny * sample.halfWidth;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  for (let index = run.length - 1; index >= 0; index--) {
    const sample = run[index];
    const { nx, ny } = normals[index];
    ctx.lineTo(sample.x - nx * sample.halfWidth, sample.y - ny * sample.halfWidth);
  }
  ctx.closePath();
  ctx.strokeStyle = rgba(ROOT_OUTLINE, alpha);
  ctx.lineWidth = OUTLINE_PX;
  ctx.stroke();
  ctx.fillStyle = rgba(ROOT_BARK, alpha);
  ctx.fill();

  ctx.beginPath();
  run.forEach((sample, index) => {
    const { nx, ny } = normals[index];
    const offset = sample.halfWidth * HIGHLIGHT_OFFSET;
    if (index === 0) ctx.moveTo(sample.x + nx * offset, sample.y + ny * offset);
    else ctx.lineTo(sample.x + nx * offset, sample.y + ny * offset);
  });
  ctx.strokeStyle = rgba(ROOT_BARK_LIGHT, alpha);
  ctx.lineWidth = HIGHLIGHT_PX;
  ctx.stroke();
}

function paintRootlets(
  ctx: CanvasRenderingContext2D,
  run: readonly RootSample[],
  hairAt: ReadonlySet<number>,
  firstIndex: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  ctx.beginPath();
  run.forEach((sample, offset) => {
    const index = firstIndex + offset;
    if (!hairAt.has(index)) return;
    const { nx, ny } = litNormal(run, offset);
    const side = index % 2 === 0 ? 1 : -1;
    const back = run[Math.max(0, offset - 1)];
    const backLength = Math.hypot(sample.x - back.x, sample.y - back.y);
    const trailX = backLength === 0 ? 0 : ((back.x - sample.x) / backLength) * ROOTLET_TRAIL;
    const trailY = backLength === 0 ? 0 : ((back.y - sample.y) / backLength) * ROOTLET_TRAIL;
    const startX = sample.x + nx * side * sample.halfWidth;
    const startY = sample.y + ny * side * sample.halfWidth;
    ctx.moveTo(startX, startY);
    ctx.lineTo(
      startX + (nx * side + trailX) * ROOTLET_LENGTH_PX,
      startY + (ny * side + trailY) * ROOTLET_LENGTH_PX,
    );
  });
  ctx.strokeStyle = rgba(ROOTLET, alpha);
  ctx.lineWidth = ROOTLET_WIDTH_PX;
  ctx.stroke();
}

function paintSoil(
  ctx: CanvasRenderingContext2D,
  pose: EntanglementRootsPose,
  seed: number,
  grow: number,
  fade: number,
): void {
  const tile = pose.tileSize;
  const footY = pose.y + tile * FEET_DROP;
  const rx = tile * SOIL_RADIUS * grow;
  const ry = rx * SOIL_DEPTH;
  drawGroundPool(ctx, SOIL_DEEP, pose.x, footY, rx, ry, SOIL_ALPHA * fade);
  ctx.globalAlpha = 1;
  ctx.fillStyle = rgba(SOIL_CLOD, fade);
  ctx.beginPath();
  for (let clod = 0; clod < CLODS; clod++) {
    const key = seed + clod * CLOD_KEY_STRIDE;
    const angle = hash01(key) * TAU;
    const burst = 1 + CLOD_BURST * grow;
    const cx = pose.x + Math.cos(angle) * rx * CLOD_RIM_SHARE * burst;
    const cy = footY + Math.sin(angle) * ry * CLOD_RIM_SHARE * burst;
    const size = hashRange(key + 1, CLOD_MIN_PX, CLOD_MAX_PX) * grow;
    ctx.moveTo(cx + size, cy);
    ctx.ellipse(cx, cy, size, size * SOIL_DEPTH + HALF, 0, 0, TAU);
  }
  ctx.fill();
}

function paintFlecks(
  ctx: CanvasRenderingContext2D,
  pose: EntanglementRootsPose,
  seed: number,
): void {
  const life = pose.heldFrames / FLECK_FRAMES;
  if (life >= 1) return;
  const tile = pose.tileSize;
  const footY = pose.y + tile * FEET_DROP;
  ctx.fillStyle = rgba(SOIL_CLOD, 1 - life);
  for (let fleck = 0; fleck < FLECKS; fleck++) {
    const key = seed + fleck * FLECK_KEY_STRIDE;
    const angle = hash01(key) * TAU;
    const reach = hashRange(key + 1, HALF, 1) * FLECK_REACH * tile;
    const lift = hashRange(key + 2, HALF, 1) * FLECK_LIFT * tile;
    const size = hashRange(key + 3, FLECK_MIN_PX, FLECK_MAX_PX);
    const fx = pose.x + Math.cos(angle) * reach * life;
    const arc = PARABOLA_PEAK_SCALE * life * (1 - life);
    const fy = footY + Math.sin(angle) * reach * life * SOIL_DEPTH - lift * arc;
    ctx.fillRect(fx - size * HALF, fy - size * HALF, size, size);
  }
}

function paintCrumbs(
  ctx: CanvasRenderingContext2D,
  origin: RootSample,
  key: number,
  motion: PieceMotion,
  tile: number,
): void {
  if (motion.progress <= 0) return;
  for (let crumb = 0; crumb < CRUMBS_PER_PIECE; crumb++) {
    const crumbKey = key + crumb * CRUMB_KEY_STRIDE;
    const scatter = hashRange(crumbKey, -CRUMB_SCATTER, CRUMB_SCATTER) * tile;
    const fall = hashRange(crumbKey + 1, HALF, 1) * CRUMB_FALL * tile;
    const size = hashRange(crumbKey + 2, CRUMB_MIN_PX, CRUMB_MAX_PX);
    const colour = crumb % 2 === 0 ? BARK_CRUMB : SOIL_CLOD;
    ctx.fillStyle = rgba(colour, 1 - motion.progress);
    const cx = origin.x + scatter * motion.progress;
    const cy = origin.y + fall * motion.progress * motion.progress;
    ctx.fillRect(cx - size * HALF, cy - size * HALF, size, size);
  }
}

interface Tendril {
  readonly samples: readonly RootSample[];
  readonly key: number;
  readonly hairAt: ReadonlySet<number>;
}

/**
 * Splits a tendril into runs that each lie wholly in front of or behind the
 * legs and, once the hold breaks, wholly inside one falling piece, then paints
 * the runs of one layer.
 */
function paintTendrilLayer(
  ctx: CanvasRenderingContext2D,
  tendril: Tendril,
  front: boolean,
  crumble: number,
  tile: number,
): void {
  const { samples, key } = tendril;
  const pieceLength = SAMPLES / PIECES_PER_TENDRIL;
  const pieceOf = (index: number): number =>
    Math.min(PIECES_PER_TENDRIL - 1, Math.floor(index / pieceLength));
  let start = 0;
  while (start < samples.length - 1) {
    const piece = pieceOf(start);
    const layerFront = samples[start + 1].front;
    let end = start + 1;
    while (
      end < samples.length - 1 &&
      samples[end + 1].front === layerFront &&
      pieceOf(end) === piece
    ) {
      end++;
    }
    if (layerFront === front) {
      const motion = pieceMotion(key + piece * PIECE_KEY_STRIDE, crumble, tile);
      const pivot = samples[Math.min(samples.length - 1, piece * pieceLength)];
      const run = samples.slice(start, end + 1).map((sample) => moved(sample, pivot, motion));
      const layerAlpha = front ? 1 : BEHIND_ALPHA;
      const alpha = layerAlpha * motion.alpha;
      paintRun(ctx, run, alpha);
      paintRootlets(ctx, run, tendril.hairAt, start, alpha);
      paintCrumbs(ctx, samples[start], key + piece * PIECE_KEY_STRIDE + start, motion, tile);
    }
    start = end;
  }
}

/**
 * Roots torn up out of the ground at a held mob's feet, coiled round its legs.
 * They burst up over the first frames of a hold, keep a faint tightening creak
 * while it lasts, and snap, fall and crumble once `crumbleFrames` starts.
 */
export function drawEntanglementRoots(
  ctx: CanvasRenderingContext2D,
  pose: EntanglementRootsPose,
): void {
  const crumble =
    pose.crumbleFrames === null ? 0 : pose.crumbleFrames / ENTANGLE_ROOTS_CRUMBLE_FRAMES;
  if (crumble >= 1) return;
  const seed = pose.seed * SEED_STRIDE;
  const soilGrow = easeOut(pose.heldFrames / GROW_FRAMES);
  const tendrilCount = Math.floor(hashRange(seed + COUNT_KEY, MIN_TENDRILS, MAX_TENDRILS + 1));

  const tendrils: Tendril[] = [];
  for (let index = 0; index < tendrilCount; index++) {
    const key = seed + index * TENDRIL_KEY_STRIDE;
    const grow = easeOut((pose.heldFrames - index * TENDRIL_LAG_FRAMES) / GROW_FRAMES);
    if (grow <= 0) continue;
    const creak = HALF + HALF * Math.sin(pose.heldFrames * TIGHTEN_RATE + index);
    const hairAt = new Set<number>();
    for (let hair = 0; hair < ROOTLETS_PER_TENDRIL; hair++) {
      const hairKey = key + hair * ROOTLET_KEY_STRIDE;
      hairAt.add(Math.floor(hashRange(hairKey, ROOTLET_FIRST_SAMPLE, SAMPLES)));
    }
    tendrils.push({
      samples: tendrilSamples(pose, key, grow, TIGHTEN_SHARE * creak),
      key,
      hairAt,
    });
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  paintSoil(ctx, pose, seed, soilGrow, 1 - crumble);
  for (const tendril of tendrils) paintTendrilLayer(ctx, tendril, false, crumble, pose.tileSize);
  for (const tendril of tendrils) paintTendrilLayer(ctx, tendril, true, crumble, pose.tileSize);
  paintFlecks(ctx, pose, seed);
  ctx.restore();
}
