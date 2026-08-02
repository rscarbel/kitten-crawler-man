/**
 * Drawing engine for the Cat's Magic Missile — the flying bolt and its impact.
 *
 * The spell spans fifteen levels, and the art is banded into four tiers that
 * line up with the levels where the *mechanics* change (splash at 5, sub-missiles
 * at 10, full power at 15). A player who just earned a perk should see the spell
 * change, so the bands are the perk boundaries rather than an even split.
 *
 * The bands escalate in kind, not just in size:
 *
 *   tier1 (1–4)   a plain conjured bolt — a bright head and a short straight
 *                 streak. Deliberately mundane: it is the floor the later tiers
 *                 are read against, and a level-1 cantrip that already looks
 *                 cosmic leaves nowhere to go.
 *   tier2 (5–9)   the streak becomes a woven ribbon that undulates, with motes
 *                 orbiting the head.
 *   tier3 (10–14) twin counter-wound ribbons braid behind a magenta head that
 *                 sheds embers and cracks with arcs.
 *   tier4 (15)    a different creature entirely — the palette breaks from violet
 *                 to white-hot gold, the tail braids in three, a rune ring turns
 *                 around the head, and a dark aura is punched *behind* the bloom
 *                 so the bolt reads as a hole in the world rather than a light
 *                 in it. Nothing below 15 uses either the warm palette or the
 *                 dark aura, which is what makes the last level read as a
 *                 category change instead of one more step.
 *
 * Everything is drawn in a local space whose origin is the missile position and
 * whose +x is the direction of travel, so the sheet bakes at any tail length
 * without the anchor moving. `SpriteRenderer` rotates around that anchor.
 *
 * The impact art is bounded by `maxRadius` per tier, and the ceiling is chosen
 * against `CombatSystem`'s 1.5-tile splash radius: an explosion that paints
 * light where nothing takes damage teaches the player the wrong radius.
 *
 * Determinism matters — every seeded detail draws from a fixed literal seed, so
 * re-running the bake leaves `git status` clean and a diff in the PNGs always
 * means the art actually changed.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import { mulberry32, range, type Rng } from '../src/sprites/person/rng.js';

const TWO_PI = Math.PI * 2;

/** Tile size the sheets are drawn at; the runtime rescales by tileSize/64. */
export const TILE_SCALE = 64;

export const PROJECTILE_FRAME_WIDTH = 256;
export const PROJECTILE_FRAME_HEIGHT = 112;
/** Head sits here inside the frame, leaving room ahead for the forward glow. */
export const PROJECTILE_TILE_X = 208;
export const PROJECTILE_TILE_Y = 56;
export const PROJECTILE_FRAME_COUNT = 8;

export const EXPLOSION_FRAME_SIZE = 224;
export const EXPLOSION_TILE_OFFSET = 112;
export const EXPLOSION_FRAME_COUNT = 10;

export const MISSILE_TIERS = ['tier1', 'tier2', 'tier3', 'tier4'] as const;
export type MissileTier = (typeof MISSILE_TIERS)[number];

/**
 * Sub-missiles are the level-10 shrapnel, not a tier of their own. They carry
 * their own impact as well as their own bolt: they are spawned with an ability
 * level of 1 so they cannot chain further, and without a row of their own their
 * magenta shard would detonate in the level-1 violet.
 */
export type ProjectileVariant = MissileTier | 'sub_missile';
export type ExplosionVariant = ProjectileVariant;

type Rgb = readonly [number, number, number];

/**
 * Below this an element is invisible, and painting it is not merely wasted: a
 * fading alpha reaches values like 5e-17, and node-canvas's colour parser does
 * not accept exponent notation — it drops the whole `rgba(...)` and the last
 * frame of every explosion came out as an opaque smear of the smoke colour.
 */
const MIN_VISIBLE_ALPHA = 0.004;
const ALPHA_DECIMALS = 4;

function rgba(color: Rgb, alpha: number): string {
  const safeAlpha = clamp01(alpha).toFixed(ALPHA_DECIMALS);
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${safeAlpha})`;
}

interface ArcanePalette {
  /** The hottest point of the head — near white at every tier. */
  readonly core: Rgb;
  readonly inner: Rgb;
  readonly outer: Rgb;
  readonly spark: Rgb;
  /** Darkest falloff, also the colour of lingering impact smoke. */
  readonly smoke: Rgb;
}

const APPRENTICE_VIOLET: ArcanePalette = {
  core: [255, 255, 255],
  inner: [208, 184, 255],
  outer: [122, 72, 214],
  spark: [178, 142, 255],
  smoke: [38, 22, 62],
};

const ADEPT_AZURE: ArcanePalette = {
  core: [255, 255, 255],
  inner: [188, 216, 255],
  outer: [92, 72, 232],
  spark: [142, 202, 255],
  smoke: [24, 24, 68],
};

const ARCHMAGE_MAGENTA: ArcanePalette = {
  core: [255, 255, 255],
  inner: [255, 190, 255],
  outer: [178, 38, 230],
  spark: [255, 124, 255],
  smoke: [40, 10, 58],
};

/** Level 15 alone leaves the violet family; the warm palette is the tell. */
const CATACLYSM_GOLD: ArcanePalette = {
  core: [255, 255, 255],
  inner: [255, 228, 162],
  outer: [255, 104, 16],
  spark: [255, 186, 64],
  smoke: [46, 12, 4],
};

interface ProjectileVisuals {
  readonly palette: ArcanePalette;
  /**
   * Distinguishes this variant's seeded detail from every other variant's.
   * Explicit rather than derived from the variant name, because the four tier
   * names are all the same length and any hash of the name that collides gives
   * every tier the same arcs and the same ember scatter.
   */
  readonly seedSalt: number;
  readonly headRadius: number;
  readonly tailLength: number;
  readonly tailWidth: number;
  /** Ribbons braided behind the head; 1 reads as a plain streak. */
  readonly ribbonCount: number;
  /** Whole waves along the tail — integers keep the loop seamless. */
  readonly ribbonWaves: number;
  readonly ribbonAmplitude: number;
  readonly arcCount: number;
  readonly emberCount: number;
  readonly moteCount: number;
  readonly hasShardRing: boolean;
  readonly hasRuneRing: boolean;
  readonly hasVoidAura: boolean;
}

const PROJECTILE_VISUALS: Record<ProjectileVariant, ProjectileVisuals> = {
  tier1: {
    palette: APPRENTICE_VIOLET,
    seedSalt: 101,
    headRadius: 9,
    tailLength: 76,
    tailWidth: 7,
    ribbonCount: 1,
    ribbonWaves: 1,
    ribbonAmplitude: 3,
    arcCount: 0,
    emberCount: 0,
    moteCount: 0,
    hasShardRing: false,
    hasRuneRing: false,
    hasVoidAura: false,
  },
  tier2: {
    palette: ADEPT_AZURE,
    seedSalt: 211,
    headRadius: 11,
    tailLength: 118,
    tailWidth: 10,
    ribbonCount: 2,
    ribbonWaves: 2,
    ribbonAmplitude: 11,
    arcCount: 1,
    emberCount: 5,
    moteCount: 3,
    hasShardRing: false,
    hasRuneRing: false,
    hasVoidAura: false,
  },
  tier3: {
    palette: ARCHMAGE_MAGENTA,
    seedSalt: 337,
    headRadius: 13,
    tailLength: 152,
    tailWidth: 13,
    ribbonCount: 2,
    ribbonWaves: 3,
    ribbonAmplitude: 17,
    arcCount: 2,
    emberCount: 10,
    moteCount: 4,
    hasShardRing: true,
    hasRuneRing: false,
    hasVoidAura: false,
  },
  tier4: {
    palette: CATACLYSM_GOLD,
    seedSalt: 457,
    headRadius: 15,
    tailLength: 178,
    tailWidth: 17,
    ribbonCount: 3,
    ribbonWaves: 3,
    ribbonAmplitude: 23,
    arcCount: 4,
    emberCount: 16,
    moteCount: 5,
    hasShardRing: true,
    hasRuneRing: true,
    hasVoidAura: true,
  },
  sub_missile: {
    palette: ARCHMAGE_MAGENTA,
    seedSalt: 577,
    headRadius: 7,
    tailLength: 58,
    tailWidth: 6,
    ribbonCount: 1,
    ribbonWaves: 2,
    ribbonAmplitude: 6,
    arcCount: 1,
    emberCount: 3,
    moteCount: 0,
    hasShardRing: false,
    hasRuneRing: false,
    hasVoidAura: false,
  },
};

interface ExplosionVisuals {
  readonly palette: ArcanePalette;
  /** See `ProjectileVisuals.seedSalt`. */
  readonly seedSalt: number;
  /**
   * Outer reach of the blast. `CombatSystem` splashes 1.5 tiles (96 px at the
   * 64 px tile scale) from level 5, so tiers 2 and 3 stop just inside that and
   * only the level-15 blast is allowed past it — it is the one that also fires
   * a death shockwave.
   */
  readonly maxRadius: number;
  readonly coreRadius: number;
  readonly ringCount: number;
  readonly sparkCount: number;
  readonly boltCount: number;
  readonly shardCount: number;
  readonly emberCount: number;
  readonly smokePuffCount: number;
  readonly hasRuneRing: boolean;
  readonly hasStarBurst: boolean;
  readonly hasVoidRim: boolean;
}

const EXPLOSION_VISUALS: Record<ExplosionVariant, ExplosionVisuals> = {
  tier1: {
    palette: APPRENTICE_VIOLET,
    seedSalt: 613,
    maxRadius: 62,
    coreRadius: 16,
    ringCount: 1,
    sparkCount: 7,
    boltCount: 0,
    shardCount: 0,
    emberCount: 0,
    smokePuffCount: 0,
    hasRuneRing: false,
    hasStarBurst: false,
    hasVoidRim: false,
  },
  tier2: {
    palette: ADEPT_AZURE,
    seedSalt: 727,
    maxRadius: 84,
    coreRadius: 22,
    ringCount: 2,
    sparkCount: 14,
    boltCount: 3,
    shardCount: 4,
    emberCount: 8,
    smokePuffCount: 3,
    hasRuneRing: false,
    hasStarBurst: false,
    hasVoidRim: false,
  },
  tier3: {
    palette: ARCHMAGE_MAGENTA,
    seedSalt: 839,
    maxRadius: 94,
    coreRadius: 28,
    ringCount: 3,
    sparkCount: 20,
    boltCount: 6,
    shardCount: 8,
    emberCount: 16,
    smokePuffCount: 5,
    hasRuneRing: true,
    hasStarBurst: false,
    hasVoidRim: false,
  },
  tier4: {
    palette: CATACLYSM_GOLD,
    seedSalt: 953,
    maxRadius: 100,
    coreRadius: 36,
    ringCount: 4,
    sparkCount: 30,
    boltCount: 10,
    shardCount: 12,
    emberCount: 26,
    smokePuffCount: 6,
    hasRuneRing: true,
    hasStarBurst: true,
    hasVoidRim: true,
  },
  sub_missile: {
    palette: ARCHMAGE_MAGENTA,
    seedSalt: 1069,
    maxRadius: 54,
    coreRadius: 15,
    ringCount: 1,
    sparkCount: 9,
    boltCount: 2,
    shardCount: 3,
    emberCount: 6,
    smokePuffCount: 2,
    hasRuneRing: false,
    hasStarBurst: false,
    hasVoidRim: false,
  },
};

/** Fixed so the two sheets' seeded detail is stable across bakes. */
const PROJECTILE_SEED = 0x5eed_1a11;
const EXPLOSION_SEED = 0x0b00_bea7;
/** Spacing between consecutive frames' seeds, so no two frames flicker alike. */
const FRAME_SEED_STRIDE = 977;

/**
 * One stream per seeded layer. Layers must not share a stream: several of them
 * skip their work on frames where they would be invisible, and a skipped draw
 * that shares a stream shifts every later layer's numbers on that frame alone.
 */
const LAYER_SALT = {
  tailEmbers: 11,
  arcs: 23,
  sparks: 37,
  shards: 53,
  emberCloud: 71,
  smoke: 89,
  boltCrown: 101,
  blastFront: 113,
} as const;

/**
 * A stream that does not depend on the frame.
 *
 * Every particle layer animates by reading `phase`/`progress` off a *fixed*
 * scatter — ember `i` drifts down the tail, spark `i` stretches outward, shard
 * `i` spins as it flies. Reseeding per frame makes particle `i` a different
 * particle in every frame, and the whole layer boils in place instead of moving.
 */
function layerRng(sheetSeed: number, seedSalt: number, layerSalt: number): Rng {
  return mulberry32(sheetSeed + seedSalt + layerSalt);
}

/**
 * A stream that changes every frame — for discharges only, where re-striking
 * from scratch each frame is the effect rather than a bug.
 */
function flickerRng(sheetSeed: number, seedSalt: number, layerSalt: number, frame: number): Rng {
  return mulberry32(sheetSeed + seedSalt + layerSalt + frame * FRAME_SEED_STRIDE);
}

/**
 * Progress the last baked frame is painted at.
 *
 * `progressFrameIndex` floors, so frame 9 of 10 is the last one the runtime can
 * ever select, and the missile is dropped right after it. Every fade curve here
 * is written to reach zero at progress 1, which the sheet never gets to — so
 * without `extinctionAt` the final displayed frame is still a fifth lit and the
 * blast pops out of existence instead of dying.
 */
const LAST_BAKED_FRAME_PROGRESS = (EXPLOSION_FRAME_COUNT - 1) / EXPLOSION_FRAME_COUNT;
/** Where the blast starts being pulled down toward nothing. */
const EXTINCTION_ONSET = 0.55;
/**
 * What is left on the last frame. Not zero: a blank final frame is the bug this
 * replaced, and a few percent is below the threshold where the cut is visible.
 */
const EXTINCTION_FLOOR = 0.16;

function extinctionAt(progress: number): number {
  if (progress <= EXTINCTION_ONSET) return 1;
  const decay = clamp01(
    (progress - EXTINCTION_ONSET) / (LAST_BAKED_FRAME_PROGRESS - EXTINCTION_ONSET),
  );
  return Math.max(EXTINCTION_FLOOR, 1 - decay);
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/**
 * A soft additive light. Callers set the composite mode; this only paints.
 */
function glow(
  ctx: Ctx,
  x: number,
  y: number,
  radius: number,
  hot: Rgb,
  cool: Rgb,
  alpha: number,
): void {
  if (radius <= 0 || alpha < MIN_VISIBLE_ALPHA) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, rgba(hot, alpha));
  gradient.addColorStop(0.4, rgba(cool, alpha * 0.55));
  gradient.addColorStop(1, rgba(cool, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TWO_PI);
  ctx.fill();
}

/**
 * A jagged discharge from (x0,y0) to (x1,y1), painted as a wide coloured haze
 * under a thin white filament — a single stroke reads as a bent wire.
 */
function drawBolt(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  jitter: number,
  rng: Rng,
  palette: ArcanePalette,
  alpha: number,
): void {
  const BOLT_SEGMENTS = 7;
  const points: Array<{ x: number; y: number }> = [];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (length <= 0 || alpha < MIN_VISIBLE_ALPHA) return;
  const normalX = -dy / length;
  const normalY = dx / length;
  for (let i = 0; i <= BOLT_SEGMENTS; i++) {
    const t = i / BOLT_SEGMENTS;
    // Ends are pinned so the bolt starts at the head and lands on the target.
    const swing = i === 0 || i === BOLT_SEGMENTS ? 0 : range(rng, -jitter, jitter);
    points.push({
      x: x0 + dx * t + normalX * swing,
      y: y0 + dy * t + normalY * swing,
    });
  }

  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  };

  const HAZE_WIDTH = 5;
  const FILAMENT_WIDTH = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(palette.outer, alpha * 0.55);
  ctx.lineWidth = HAZE_WIDTH;
  trace();
  ctx.strokeStyle = rgba(palette.core, alpha);
  ctx.lineWidth = FILAMENT_WIDTH;
  trace();
}

/**
 * One tail ribbon: a tapering sheet that whips behind the head. `side` flips
 * the wave so a pair braids instead of overlapping.
 */
function drawRibbon(
  ctx: Ctx,
  visuals: ProjectileVisuals,
  phase: number,
  side: number,
  widthScale: number,
  alpha: number,
): void {
  const RIBBON_STEPS = 28;
  const { tailLength, tailWidth, ribbonWaves, ribbonAmplitude, palette } = visuals;

  const AMPLITUDE_RAMP = 0.75;
  const WIDTH_FALLOFF = 0.85;
  /** How fast the ribbon widens out of the head; a hard start reads as a stub. */
  const HEAD_PINCH_RATE = 7;

  const centerAt = (t: number): number =>
    side *
    ribbonAmplitude *
    Math.pow(t, AMPLITUDE_RAMP) *
    Math.sin(t * ribbonWaves * TWO_PI - phase * TWO_PI);
  /**
   * Held wide most of the way back before it tapers. An aggressive taper puts
   * the whole wave in the part of the ribbon that is too thin to see, and the
   * tail reads as a straight streak with a wisp on the end.
   */
  const halfWidthAt = (t: number): number =>
    (tailWidth * widthScale * Math.pow(1 - t, WIDTH_FALLOFF) * Math.min(1, t * HEAD_PINCH_RATE)) /
    2;

  ctx.beginPath();
  for (let i = 0; i <= RIBBON_STEPS; i++) {
    const t = i / RIBBON_STEPS;
    const x = -t * tailLength;
    const y = centerAt(t) - halfWidthAt(t);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = RIBBON_STEPS; i >= 0; i--) {
    const t = i / RIBBON_STEPS;
    ctx.lineTo(-t * tailLength, centerAt(t) + halfWidthAt(t));
  }
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, 0, -tailLength, 0);
  gradient.addColorStop(0, rgba(palette.core, alpha));
  gradient.addColorStop(0.15, rgba(palette.inner, alpha * 0.95));
  gradient.addColorStop(0.5, rgba(palette.outer, alpha * 0.6));
  // Gone well before the frame edge: a ribbon still bright where the cell ends
  // is a tail chopped off with a straight razor line in game.
  gradient.addColorStop(0.88, rgba(palette.outer, alpha * 0.08));
  gradient.addColorStop(1, rgba(palette.outer, 0));
  ctx.fillStyle = gradient;
  ctx.fill();
}

function drawTailEmbers(ctx: Ctx, visuals: ProjectileVisuals, phase: number, rng: Rng): void {
  const { emberCount, tailLength, ribbonAmplitude, palette } = visuals;
  const EMBER_MIN_RADIUS = 1.2;
  const EMBER_MAX_RADIUS = 3.4;
  for (let i = 0; i < emberCount; i++) {
    const drift = range(rng, 0, 1);
    const spread = range(rng, -1, 1);
    const radius = range(rng, EMBER_MIN_RADIUS, EMBER_MAX_RADIUS);
    // Advancing by whole phase keeps each ember on the same loop as the ribbons.
    const t = (drift + phase) % 1;
    const x = -t * tailLength;
    // Embers shed sideways as they fall behind, so the tail frays at its end.
    const y = spread * ribbonAmplitude * t * 1.4;
    const fade = 1 - t;
    glow(ctx, x, y, radius * 3.5, palette.spark, palette.outer, 0.5 * fade);
    ctx.fillStyle = rgba(palette.core, 0.85 * fade);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TWO_PI);
    ctx.fill();
  }
}

function drawOrbitingMotes(ctx: Ctx, visuals: ProjectileVisuals, phase: number): void {
  const { moteCount, headRadius, palette } = visuals;
  const ORBIT_RADIUS_SCALE = 1.9;
  /** Squashed so the orbit reads as a ring seen nearly edge-on. */
  const ORBIT_FLATTEN = 0.55;
  const MOTE_RADIUS = 2.2;
  for (let i = 0; i < moteCount; i++) {
    const angle = (i / moteCount) * TWO_PI + phase * TWO_PI;
    const x = Math.cos(angle) * headRadius * ORBIT_RADIUS_SCALE;
    const y = Math.sin(angle) * headRadius * ORBIT_RADIUS_SCALE * ORBIT_FLATTEN;
    // Motes on the far side of the orbit dim, which sells the ring as 3D.
    const depth = 0.45 + 0.55 * ((Math.cos(angle) + 1) / 2);
    glow(ctx, x, y, MOTE_RADIUS * 4, palette.spark, palette.outer, 0.55 * depth);
    ctx.fillStyle = rgba(palette.core, 0.9 * depth);
    ctx.beginPath();
    ctx.arc(x, y, MOTE_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
}

function drawShardRing(ctx: Ctx, visuals: ProjectileVisuals, phase: number): void {
  const SHARD_COUNT = 3;
  const SHARD_ORBIT_SCALE = 2.4;
  const SHARD_LENGTH = 10;
  const SHARD_HALF_WIDTH = 1.6;
  const { headRadius, palette } = visuals;
  for (let i = 0; i < SHARD_COUNT; i++) {
    const angle = (i / SHARD_COUNT) * TWO_PI - phase * TWO_PI;
    const x = Math.cos(angle) * headRadius * SHARD_ORBIT_SCALE;
    const y = Math.sin(angle) * headRadius * SHARD_ORBIT_SCALE * 0.7;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = rgba(palette.inner, 0.6);
    ctx.beginPath();
    ctx.moveTo(SHARD_LENGTH, 0);
    ctx.lineTo(-SHARD_LENGTH * 0.6, SHARD_HALF_WIDTH);
    ctx.lineTo(-SHARD_LENGTH * 0.6, -SHARD_HALF_WIDTH);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/**
 * The turning sigil around the level-15 head, and the glyph circle its impact
 * leaves behind. Drawn as separated arcs rather than one closed ring: an
 * unbroken circle with evenly spaced ticks reads as a targeting reticle, which
 * is the one thing a spell this size must not look like.
 */
function drawRuneRing(ctx: Ctx, radius: number, phase: number, palette: ArcanePalette): void {
  const ARC_COUNT = 3;
  const ARC_SWEEP = TWO_PI / 5;
  const RUNE_COUNT = 5;
  const RUNE_LENGTH = 5;
  const RING_WIDTH = 1.2;
  ctx.save();
  ctx.rotate(phase * TWO_PI);
  ctx.strokeStyle = rgba(palette.inner, 0.45);
  ctx.lineWidth = RING_WIDTH;
  for (let i = 0; i < ARC_COUNT; i++) {
    const start = (i / ARC_COUNT) * TWO_PI;
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, start + ARC_SWEEP);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(palette.core, 0.6);
  for (let i = 0; i < RUNE_COUNT; i++) {
    const angle = (i / RUNE_COUNT) * TWO_PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(cos * (radius - RUNE_LENGTH / 2), sin * (radius - RUNE_LENGTH / 2));
    ctx.lineTo(cos * (radius + RUNE_LENGTH / 2), sin * (radius + RUNE_LENGTH / 2));
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The dark halo behind the level-15 head. Painted normally rather than
 * additively — it has to *subtract* from the floor for the bolt to read as a
 * tear in the world, and every other layer of the sprite adds light.
 */
function drawVoidAura(ctx: Ctx, visuals: ProjectileVisuals, pulse: number): void {
  const VOID_RADIUS_SCALE = 3.6;
  const VOID_ALPHA = 0.5;
  // Its gradient only reaches zero at its own rim, so a radius past the frame's
  // forward margin bakes a hard vertical bar of dark pixels along the cell edge
  // — and the sprite is drawn rotated, so that bar would track the bolt.
  const radius = Math.min(
    visuals.headRadius * VOID_RADIUS_SCALE * pulse,
    PROJECTILE_FRAME_WIDTH - PROJECTILE_TILE_X,
  );
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  gradient.addColorStop(0, rgba(visuals.palette.smoke, 0));
  gradient.addColorStop(0.45, rgba(visuals.palette.smoke, VOID_ALPHA));
  gradient.addColorStop(1, rgba(visuals.palette.smoke, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
  ctx.fill();
}

function drawHead(ctx: Ctx, visuals: ProjectileVisuals, pulse: number): void {
  const { headRadius, palette } = visuals;
  // Capped so the bloom's own falloff completes inside the frame's forward
  // margin; `assertFramesDoNotBleed` in the generator fails the bake otherwise.
  const BLOOM_SCALE = 2.8;
  const CORE_SCALE = 0.55;
  const FORWARD_FLARE_SCALE = 1.6;
  const FORWARD_FLARE_OFFSET = 0.7;

  glow(ctx, 0, 0, headRadius * BLOOM_SCALE * pulse, palette.inner, palette.outer, 0.75);
  // A second, brighter lobe pushed ahead of the anchor makes the bolt look like
  // it is driving forward rather than sitting inside its own glow.
  glow(
    ctx,
    headRadius * FORWARD_FLARE_OFFSET,
    0,
    headRadius * FORWARD_FLARE_SCALE * pulse,
    palette.core,
    palette.inner,
    0.7,
  );
  ctx.fillStyle = rgba(palette.core, 0.95);
  ctx.beginPath();
  ctx.arc(0, 0, headRadius * CORE_SCALE * pulse, 0, TWO_PI);
  ctx.fill();
}

/**
 * Paints one projectile frame with the missile position at (originX, originY)
 * and travel pointing along +x.
 */
export function drawMagicMissileProjectile(
  ctx: Ctx,
  originX: number,
  originY: number,
  variant: ProjectileVariant,
  frame: number,
): void {
  const visuals = PROJECTILE_VISUALS[variant];
  const phase = frame / PROJECTILE_FRAME_COUNT;
  const PULSE_DEPTH = 0.12;
  const pulse = 1 + PULSE_DEPTH * Math.sin(phase * TWO_PI);

  ctx.save();
  ctx.translate(originX, originY);

  if (visuals.hasVoidAura) drawVoidAura(ctx, visuals, pulse);

  ctx.globalCompositeOperation = 'lighter';

  const RIBBON_ALPHA = 0.9;
  for (let i = 0; i < visuals.ribbonCount; i++) {
    // Ribbons alternate sides and lag one another so the braid never collapses
    // into a single thick streak on any frame.
    const side = i % 2 === 0 ? 1 : -1;
    const lag = (i / visuals.ribbonCount) * 0.5;
    const widthScale = 1 - i * 0.18;
    drawRibbon(ctx, visuals, phase + lag, side, widthScale, RIBBON_ALPHA);
  }

  drawTailEmbers(
    ctx,
    visuals,
    phase,
    layerRng(PROJECTILE_SEED, visuals.seedSalt, LAYER_SALT.tailEmbers),
  );

  // Arcs crackle across the braid near the head only. Spread along the whole
  // tail they stop reading as discharges and turn the streak into scribble.
  const ARC_ORIGIN_SPREAD = 0.3;
  const ARC_MIN_SPAN = 0.06;
  const ARC_MAX_SPAN = 0.16;
  const ARC_JITTER_SCALE = 0.4;
  const ARC_ALPHA = 0.55;
  const arcRng = flickerRng(PROJECTILE_SEED, visuals.seedSalt, LAYER_SALT.arcs, frame);
  for (let i = 0; i < visuals.arcCount; i++) {
    const startT = range(arcRng, 0, ARC_ORIGIN_SPREAD);
    const endT = startT + range(arcRng, ARC_MIN_SPAN, ARC_MAX_SPAN);
    drawBolt(
      ctx,
      -startT * visuals.tailLength,
      range(arcRng, -1, 1) * visuals.ribbonAmplitude * startT,
      -endT * visuals.tailLength,
      range(arcRng, -1, 1) * visuals.ribbonAmplitude * endT,
      visuals.ribbonAmplitude * ARC_JITTER_SCALE,
      arcRng,
      visuals.palette,
      ARC_ALPHA,
    );
  }

  drawHead(ctx, visuals, pulse);
  if (visuals.moteCount > 0) drawOrbitingMotes(ctx, visuals, phase);
  if (visuals.hasShardRing) drawShardRing(ctx, visuals, phase);
  if (visuals.hasRuneRing) {
    const RUNE_RING_SCALE = 2.2;
    drawRuneRing(ctx, visuals.headRadius * RUNE_RING_SCALE, phase, visuals.palette);
  }

  ctx.restore();
}

/**
 * Traces a closed ring whose radius wanders. A true circle reads as a drawn
 * interface element rather than a blast front, and the wander is seeded per ring
 * so the same front keeps its shape as it expands across the frames.
 */
function traceBlastFront(ctx: Ctx, radius: number, rng: Rng): void {
  const FRONT_POINTS = 56;
  // Two lobed harmonics rather than per-point noise: point noise at this radius
  // scallops the rim into gear teeth, which reads as a drawn shape again.
  const SLOW_LOBES = 3;
  const FAST_LOBES = 7;
  const SLOW_DEPTH = 0.05;
  const FAST_DEPTH = 0.025;
  const slowPhase = range(rng, 0, TWO_PI);
  const fastPhase = range(rng, 0, TWO_PI);
  ctx.beginPath();
  for (let i = 0; i <= FRONT_POINTS; i++) {
    const angle = (i / FRONT_POINTS) * TWO_PI;
    const r =
      radius *
      (1 +
        SLOW_DEPTH * Math.sin(angle * SLOW_LOBES + slowPhase) +
        FAST_DEPTH * Math.sin(angle * FAST_LOBES + fastPhase));
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawShockRings(ctx: Ctx, visuals: ExplosionVisuals, progress: number): void {
  const { ringCount, maxRadius, palette } = visuals;
  const RING_STAGGER = 0.11;
  const RING_MAX_WIDTH = 9;
  const RING_SEED_STRIDE = 7919;
  for (let i = 0; i < ringCount; i++) {
    const delay = i * RING_STAGGER;
    if (progress < delay) continue;
    const ringProgress = clamp01((progress - delay) / (1 - delay));
    // Trailing rings stop short, so the blast reads as a stack of fronts rather
    // than one thick band.
    const reach = maxRadius * (1 - i * 0.14);
    const radius = reach * easeOut(ringProgress);
    const fade = Math.pow(1 - ringProgress, 1.5);
    // Both strokes of one front must trace the same shape, and the shape must
    // not move as the front expands — hence a seed per (tier, ring), not per frame.
    const frontSeed =
      EXPLOSION_SEED + visuals.seedSalt + LAYER_SALT.blastFront + i * RING_SEED_STRIDE;
    ctx.lineWidth = Math.max(1, RING_MAX_WIDTH * fade);
    ctx.strokeStyle = rgba(i === 0 ? palette.core : palette.inner, 0.85 * fade);
    traceBlastFront(ctx, radius, mulberry32(frontSeed));
    ctx.stroke();
    ctx.strokeStyle = rgba(palette.outer, 0.5 * fade);
    ctx.lineWidth = Math.max(1, RING_MAX_WIDTH * 2 * fade);
    traceBlastFront(ctx, radius, mulberry32(frontSeed));
    ctx.stroke();
  }
}

function drawFireball(ctx: Ctx, visuals: ExplosionVisuals, progress: number): void {
  const { coreRadius, palette } = visuals;
  const FIREBALL_GROWTH = 1.7;
  const radius = coreRadius * (0.5 + FIREBALL_GROWTH * easeOut(progress));
  const fade = Math.pow(1 - progress, 1.6);
  glow(ctx, 0, 0, radius * 1.9, palette.inner, palette.outer, 0.8 * fade);
  glow(ctx, 0, 0, radius, palette.core, palette.inner, 0.95 * fade);
}

function drawSparks(ctx: Ctx, visuals: ExplosionVisuals, progress: number, rng: Rng): void {
  const { sparkCount, maxRadius, palette } = visuals;
  const SPARK_MIN_REACH = 0.35;
  const SPARK_MAX_REACH = 1;
  const SPARK_MIN_WIDTH = 1;
  const SPARK_MAX_WIDTH = 2.6;
  const SPARK_ANGLE_SCATTER = 0.5;
  const fade = Math.pow(1 - progress, 1.3);
  if (fade < MIN_VISIBLE_ALPHA) return;
  ctx.lineCap = 'round';
  for (let i = 0; i < sparkCount; i++) {
    // Scattered off the even spoke by up to half a slot: perfectly even spokes
    // of equal length read as the ticks on a dial.
    const slot = TWO_PI / sparkCount;
    const angle = i * slot + range(rng, -slot, slot) * SPARK_ANGLE_SCATTER;
    const reach = maxRadius * range(rng, SPARK_MIN_REACH, SPARK_MAX_REACH);
    const tip = reach * easeOut(progress);
    // The trailing end lags the tip, so each spark stretches as it flies.
    const root = tip * range(rng, 0.35, 0.7);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const trail = ctx.createLinearGradient(cos * root, sin * root, cos * tip, sin * tip);
    trail.addColorStop(0, rgba(palette.outer, 0));
    trail.addColorStop(1, rgba(palette.spark, 0.9 * fade));
    ctx.strokeStyle = trail;
    ctx.lineWidth = range(rng, SPARK_MIN_WIDTH, SPARK_MAX_WIDTH);
    ctx.beginPath();
    ctx.moveTo(cos * root, sin * root);
    ctx.lineTo(cos * tip, sin * tip);
    ctx.stroke();
  }
}

function drawBoltCrown(ctx: Ctx, visuals: ExplosionVisuals, progress: number, rng: Rng): void {
  const { boltCount, maxRadius, palette } = visuals;
  const CROWN_REACH = 0.92;
  const CROWN_JITTER = 12;
  // The crown is the discharge of the strike itself, so it is gone long before
  // the smoke is.
  const fade = Math.pow(1 - progress, 2.4);
  if (fade < MIN_VISIBLE_ALPHA) return;
  for (let i = 0; i < boltCount; i++) {
    const angle = (i / boltCount) * TWO_PI + range(rng, -0.2, 0.2);
    const reach = maxRadius * CROWN_REACH * easeOut(progress) * range(rng, 0.7, 1);
    drawBolt(
      ctx,
      0,
      0,
      Math.cos(angle) * reach,
      Math.sin(angle) * reach,
      CROWN_JITTER,
      rng,
      palette,
      0.8 * fade,
    );
  }
}

function drawShards(ctx: Ctx, visuals: ExplosionVisuals, progress: number, rng: Rng): void {
  const { shardCount, maxRadius, palette } = visuals;
  const SHARD_LENGTH = 11;
  const SHARD_HALF_WIDTH = 3.5;
  const SHARD_SPIN_TURNS = 1.5;
  const fade = Math.pow(1 - progress, 1.1);
  for (let i = 0; i < shardCount; i++) {
    const angle = (i / shardCount) * TWO_PI + range(rng, -0.3, 0.3);
    const distance = maxRadius * range(rng, 0.45, 1) * easeOut(progress);
    const spin = range(rng, -1, 1) * SHARD_SPIN_TURNS * TWO_PI * progress;
    ctx.save();
    ctx.translate(Math.cos(angle) * distance, Math.sin(angle) * distance);
    ctx.rotate(angle + spin);
    ctx.fillStyle = rgba(palette.inner, 0.8 * fade);
    ctx.beginPath();
    ctx.moveTo(SHARD_LENGTH, 0);
    ctx.lineTo(-SHARD_LENGTH * 0.5, SHARD_HALF_WIDTH);
    ctx.lineTo(-SHARD_LENGTH * 0.5, -SHARD_HALF_WIDTH);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawEmberCloud(ctx: Ctx, visuals: ExplosionVisuals, progress: number, rng: Rng): void {
  const { emberCount, maxRadius, palette } = visuals;
  const EMBER_MIN_RADIUS = 1.4;
  const EMBER_MAX_RADIUS = 3.6;
  // Held short of the blast's own reach so the ember's glow — several times its
  // radius — still lands inside the frame at full expansion.
  const EMBER_MAX_REACH = 0.85;
  const fade = Math.pow(1 - progress, 0.8);
  for (let i = 0; i < emberCount; i++) {
    const angle = range(rng, 0, TWO_PI);
    const distance = maxRadius * range(rng, 0.2, EMBER_MAX_REACH) * easeOut(progress);
    const radius = range(rng, EMBER_MIN_RADIUS, EMBER_MAX_RADIUS);
    // Embers arc upward as they cool, which reads as heat rising off the impact.
    const rise = maxRadius * 0.18 * progress * progress;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance - rise;
    glow(ctx, x, y, radius * 3.5, palette.spark, palette.outer, 0.55 * fade);
    ctx.fillStyle = rgba(palette.core, 0.8 * fade);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TWO_PI);
    ctx.fill();
  }
}

/**
 * Lingering smoke. Drawn normally rather than additively because smoke that
 * adds light is just more fire.
 */
function drawSmoke(ctx: Ctx, visuals: ExplosionVisuals, progress: number, rng: Rng): void {
  const { smokePuffCount, maxRadius, palette } = visuals;
  const SMOKE_ONSET = 0.35;
  const SMOKE_PEAK_ALPHA = 0.45;
  if (progress < SMOKE_ONSET) return;
  const smokeProgress = (progress - SMOKE_ONSET) / (1 - SMOKE_ONSET);
  const alpha = SMOKE_PEAK_ALPHA * Math.sin(smokeProgress * Math.PI);
  if (alpha < MIN_VISIBLE_ALPHA) return;
  for (let i = 0; i < smokePuffCount; i++) {
    const angle = (i / smokePuffCount) * TWO_PI + range(rng, -0.4, 0.4);
    const distance = maxRadius * range(rng, 0.15, 0.6) * smokeProgress;
    const radius = maxRadius * range(rng, 0.18, 0.34) * (0.6 + smokeProgress);
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance - maxRadius * 0.12 * smokeProgress;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, rgba(palette.smoke, alpha));
    gradient.addColorStop(1, rgba(palette.smoke, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TWO_PI);
    ctx.fill();
  }
}

/** The level-15 six-pointed flare — a shape no lower tier draws. */
function drawStarBurst(ctx: Ctx, visuals: ExplosionVisuals, progress: number): void {
  const SPIKE_COUNT = 6;
  const SPIKE_HALF_WIDTH = 0.09;
  const { maxRadius, palette } = visuals;
  const fade = Math.pow(1 - progress, 2);
  if (fade < MIN_VISIBLE_ALPHA) return;
  const reach = maxRadius * (0.5 + 0.55 * easeOut(progress));
  for (let i = 0; i < SPIKE_COUNT; i++) {
    const angle = (i / SPIKE_COUNT) * TWO_PI + progress * 0.4;
    const gradient = ctx.createLinearGradient(
      0,
      0,
      Math.cos(angle) * reach,
      Math.sin(angle) * reach,
    );
    gradient.addColorStop(0, rgba(palette.core, 0.9 * fade));
    gradient.addColorStop(1, rgba(palette.outer, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
    ctx.lineTo(
      Math.cos(angle + SPIKE_HALF_WIDTH) * reach * 0.12,
      Math.sin(angle + SPIKE_HALF_WIDTH) * reach * 0.12,
    );
    ctx.lineTo(
      Math.cos(angle - SPIKE_HALF_WIDTH) * reach * 0.12,
      Math.sin(angle - SPIKE_HALF_WIDTH) * reach * 0.12,
    );
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * A dark band chasing the outermost front. It marks the damage edge without
 * adding more light out there, which is what keeps the level-15 blast readable
 * as a radius instead of a white-out.
 */
function drawVoidRim(ctx: Ctx, visuals: ExplosionVisuals, progress: number): void {
  const { maxRadius, palette } = visuals;
  const RIM_ONSET = 0.2;
  const RIM_WIDTH = 14;
  const VOID_RIM_PEAK_ALPHA = 0.5;
  if (progress < RIM_ONSET) return;
  const rimProgress = (progress - RIM_ONSET) / (1 - RIM_ONSET);
  const radius = maxRadius * easeOut(rimProgress);
  const alpha = VOID_RIM_PEAK_ALPHA * Math.sin(rimProgress * Math.PI);
  if (alpha < MIN_VISIBLE_ALPHA) return;
  const gradient = ctx.createRadialGradient(0, 0, Math.max(0, radius - RIM_WIDTH), 0, 0, radius);
  gradient.addColorStop(0, rgba(palette.smoke, 0));
  gradient.addColorStop(1, rgba(palette.smoke, alpha));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
  ctx.fill();
}

/** Paints one impact frame centred on (originX, originY). */
export function drawMagicMissileExplosion(
  ctx: Ctx,
  originX: number,
  originY: number,
  variant: ExplosionVariant,
  frame: number,
): void {
  const visuals = EXPLOSION_VISUALS[variant];
  // Divided by the count, not by count-1: at progress exactly 1 every fade term
  // is zero and the last frame of the sheet bakes empty, which the runtime then
  // shows for the final ticks of the blast.
  const progress = frame / EXPLOSION_FRAME_COUNT;

  const extinction = extinctionAt(progress);

  ctx.save();
  ctx.translate(originX, originY);
  ctx.globalAlpha = extinction;

  if (visuals.hasVoidRim) drawVoidRim(ctx, visuals, progress);
  if (visuals.smokePuffCount > 0) {
    drawSmoke(ctx, visuals, progress, layerRng(EXPLOSION_SEED, visuals.seedSalt, LAYER_SALT.smoke));
  }

  ctx.globalCompositeOperation = 'lighter';

  if (visuals.hasStarBurst) drawStarBurst(ctx, visuals, progress);
  drawFireball(ctx, visuals, progress);
  drawShockRings(ctx, visuals, progress);
  if (visuals.boltCount > 0) {
    drawBoltCrown(
      ctx,
      visuals,
      progress,
      flickerRng(EXPLOSION_SEED, visuals.seedSalt, LAYER_SALT.boltCrown, frame),
    );
  }
  drawSparks(ctx, visuals, progress, layerRng(EXPLOSION_SEED, visuals.seedSalt, LAYER_SALT.sparks));
  if (visuals.shardCount > 0) {
    drawShards(
      ctx,
      visuals,
      progress,
      layerRng(EXPLOSION_SEED, visuals.seedSalt, LAYER_SALT.shards),
    );
  }
  if (visuals.emberCount > 0) {
    drawEmberCloud(
      ctx,
      visuals,
      progress,
      layerRng(EXPLOSION_SEED, visuals.seedSalt, LAYER_SALT.emberCloud),
    );
  }
  if (visuals.hasRuneRing) {
    const RUNE_RING_REACH = 0.62;
    const runeFade = Math.sin(clamp01(progress) * Math.PI);
    ctx.save();
    ctx.globalAlpha = runeFade * extinction;
    drawRuneRing(
      ctx,
      visuals.maxRadius * RUNE_RING_REACH * easeOut(progress),
      progress,
      visuals.palette,
    );
    ctx.restore();
  }

  ctx.restore();
}
