/**
 * The painter behind the Hoarder's bile projectile and the acid pool it leaves.
 *
 * Two sheets share this file because they share a material. What makes the
 * projectile read as *vomit* rather than as a magic orb is that it is chunky
 * first: a translucent yellow-green envelope with solid lumps suspended in it
 * that break the silhouette, a stringy drool trailing behind, and wet speculars.
 * A smooth glowing ball is a spell; a lumpy dripping one is a stomach's worth of
 * bile in the air.
 *
 * What makes the pool read as a *hazard* rather than as a decal is its edge: a
 * ragged lobed perimeter with thin runnels, and a corroded rim eating into the
 * floor around it. The rim is also the hazard's stated boundary — nothing is
 * painted outside it, which is what lets the generator measure the footprint
 * against the damage radius the runtime uses.
 *
 * Drawn in PIXEL space (unlike the tile-unit creature art) because effects are
 * baked at a fixed pixel size rather than scaled by a tile grid — the same
 * convention `vespaSpitArt.ts` and `magicMissileArt.ts` use.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

const TWO_PI = Math.PI * 2;

/** Radii below this are degenerate; node-canvas rejects such an arc or gradient. */
const MIN_RADIUS = 1e-4;

const ALPHA_PRECISION = 4;

/**
 * `rgba()` with the alpha rounded to a fixed decimal string.
 *
 * A computed alpha can come out vanishingly small, and `String(5e-17)` is
 * exponent notation node-canvas cannot parse — it drops the whole colour and
 * the shape bakes as an opaque smear.
 */
function rgba(rgb: readonly [number, number, number], alpha: number): string {
  const [r, g, b] = rgb;
  const safe = Math.max(0, Math.min(1, alpha)).toFixed(ALPHA_PRECISION);
  return `rgba(${r},${g},${b},${safe})`;
}

/** Deterministic pseudo-random in [0,1) so re-runs produce identical art. */
function hash1(seed: number): number {
  const HASH_MULTIPLIER = 12.9898;
  const HASH_SCALE = 43758.5453;
  const x = Math.sin(seed * HASH_MULTIPLIER) * HASH_SCALE;
  return x - Math.floor(x);
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth 0→1 ease that decelerates into its target. */
function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

/** Smooth 0→1 ease that accelerates out of its start. */
function easeIn(t: number): number {
  const c = clamp01(t);
  return c * c;
}

/**
 * A closed, irregular blob laid through quadratic curves.
 *
 * Curves rather than straight segments: at the sample counts these effects can
 * afford, a polyline blob bakes as a visibly faceted shard, which reads as a
 * crystal no matter what colour it is painted.
 */
function blobPath(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  seed: number,
  roughness: number,
  steps: number,
): void {
  const pointAt = (i: number): readonly [number, number] => {
    const angle = ((i % steps) / steps) * TWO_PI;
    const wobble =
      1 + roughness * (Math.sin(angle * 3 + seed) * 0.6 + Math.sin(angle * 7 - seed * 1.9) * 0.4);
    return [cx + Math.cos(angle) * radius * wobble, cy + Math.sin(angle) * radius * wobble];
  };
  const [firstX, firstY] = pointAt(0);
  const [lastX, lastY] = pointAt(steps - 1);
  ctx.beginPath();
  ctx.moveTo((lastX + firstX) / 2, (lastY + firstY) / 2);
  for (let i = 0; i < steps; i++) {
    const [px, py] = pointAt(i);
    const [nx, ny] = pointAt(i + 1);
    ctx.quadraticCurveTo(px, py, (px + nx) / 2, (py + ny) / 2);
  }
  ctx.closePath();
}

// ── Shared geometry ──────────────────────────────────────────────────────────

/** Authored pixels per drawn tile; the manifest's `tileScale` for both sheets. */
export const TILE_SCALE = 64;

/** The tile size the runtime draws these effects at. */
export const RUNTIME_TILE_SIZE = 32;

/** Authored pixel → drawn game pixel, per `SpriteRenderer.drawSprite`. */
export const GAME_PIXELS_PER_AUTHORED_PIXEL = RUNTIME_TILE_SIZE / TILE_SCALE;

// ── The material ─────────────────────────────────────────────────────────────

/** Bile proper: yellow-green, never neon. */
const BILE_PALE: readonly [number, number, number] = [201, 210, 100];
const BILE_MID: readonly [number, number, number] = [154, 168, 58];
const BILE_BODY: readonly [number, number, number] = [116, 130, 44];
const BILE_DEEP: readonly [number, number, number] = [86, 96, 26];
/** The deepest part of a standing pool, where almost no light gets back out. */
const BILE_SUMP: readonly [number, number, number] = [46, 54, 14];
/** Stomach contents are browner than the bile carrying them. */
const GUT_BROWN: readonly [number, number, number] = [122, 90, 42];
const CHUNK_PALE: readonly [number, number, number] = [198, 176, 118];
const CHUNK_MID: readonly [number, number, number] = [150, 118, 62];
const CHUNK_DARK: readonly [number, number, number] = [86, 62, 30];
/** The rim where the mass is thickest, and the corroded floor around the pool. */
const RIM_DARK: readonly [number, number, number] = [52, 50, 18];
/** Desaturated on purpose: a dark *olive* ring reads as more bile, not as stone. */
const CORRODE_DARK: readonly [number, number, number] = [24, 21, 18];
const CORRODE_WARM: readonly [number, number, number] = [54, 46, 38];
const SPECULAR: readonly [number, number, number] = [255, 255, 236];
const FROTH_PALE: readonly [number, number, number] = [214, 226, 148];
const FUME: readonly [number, number, number] = [196, 208, 168];
/**
 * What the acid leaves once it has drained away: etched stone.
 *
 * Darker than the dungeon floor, not lighter. A "bleached" stain painted
 * brighter than the stone measures as a 1-level difference once composited and
 * is simply invisible.
 */
const STAIN: readonly [number, number, number] = [48, 45, 34];

// ── Sheet 1: the bile bolus in flight ────────────────────────────────────────

export const BOLUS_FRAME_SIZE = 112;
export const BOLUS_ANCHOR = BOLUS_FRAME_SIZE / 2;
export const BOLUS_FRAME_COUNT = 8;

const BOLUS_RADIUS = 21;
const BOLUS_SURFACE_STEPS = 26;
/** Fixed, so the envelope is one shape being turned rather than a new shape each frame. */
const BODY_SHAPE_SEED = 2.1;
/**
 * How much the envelope's outline churns on top of the tumble.
 *
 * It swings between these two rather than sitting at one value, so the surface
 * is still working while the mass turns.
 */
const BOLUS_ROUGHNESS_MIN = 0.12;
const BOLUS_ROUGHNESS_MAX = 0.22;
const BOLUS_RIM_WIDTH = 2.6;
const GUT_WASH_SEED = 2.4;

const CHUNK_COUNT = 8;
const CHUNK_MIN_RADIUS = 3;
const CHUNK_RADIUS_SPREAD = 4;
/**
 * Chunks ride *past* the envelope edge. A chunk that stays inside is a texture
 * painted on a ball; only the ones that push the silhouette out make the mass
 * read as lumpy.
 */
const CHUNK_MAX_ORBIT = 1.18;
const CHUNK_MIN_ORBIT = 0.15;

const DROOL_LENGTH = 38;
const DROOL_ROOT_WIDTH = 8;
const DROOL_WOBBLE = 4;
const DROOL_STUB_LENGTH = 11;
const DROOL_STUB_SAMPLES = 7;
const DROOL_SPRAY_COUNT = 12;
/** How far the spray fans out from the flight line at its far end. */
const DROOL_SPRAY_FAN = 16;
/** How far a sprayed droplet is drawn out along the flight line. */
const DROOL_STREAK_STRETCH = 2.4;

const SHED_DROPLET_COUNT = 3;
const SHED_REACH = 30;
const SHED_MAX_RADIUS = 7;
/** Heading of the mass's shaded side; the dark rim is confined to it. */
const SHADED_SIDE_ANGLE = Math.PI * 0.25;

/**
 * The bolus in flight, travelling along +X with its drool behind it.
 *
 * `frame`/`frameCount` drive one full tumble, so the row loops. The runtime
 * rotates the sprite to the flight heading, so nothing here knows a direction
 * beyond "the trail is on the -X side".
 */
export function drawHoarderBile(
  ctx: Ctx,
  cx: number,
  cy: number,
  frame: number,
  frameCount: number,
): void {
  const phase = frame / frameCount;
  const spin = phase * TWO_PI;

  ctx.save();
  ctx.translate(cx, cy);

  // The wake is laid in screen space — it trails the flight line, not the mass.
  drawShedDroplets(ctx, phase);
  drawDrool(ctx, spin);

  // The mass itself is turned bodily. Rotating the *contents* while leaving the
  // envelope's own wobble harmonics where they were bought nothing: those
  // harmonics counter-rotate against each other, so a best-fit rotation of any
  // frame onto any other came out at 0° and the bolus measured as a pellet
  // sliding through the air.
  ctx.save();
  ctx.rotate(spin);
  drawBolusEnvelope(ctx, spin);
  drawBolusChunks(ctx);
  drawBolusRim(ctx, spin);
  ctx.restore();

  // The speculars stay in screen space: they are where the light is, and light
  // does not tumble with the thing it falls on.
  drawBolusSpeculars(ctx, spin);

  ctx.restore();
}

/**
 * Droplets that have already left the mass. Their offsets cycle by one slot per
 * loop, so the *set* of droplets maps onto itself at the seam even though each
 * individual droplet is travelling.
 */
function drawShedDroplets(ctx: Ctx, phase: number): void {
  for (let i = 0; i < SHED_DROPLET_COUNT; i++) {
    const travel = (i + phase) / SHED_DROPLET_COUNT;
    const px = -BOLUS_RADIUS * 0.6 - travel * SHED_REACH;
    const py = (hash1(i * 3.1) - 0.5) * 10 + travel * 6;
    const radius = SHED_MAX_RADIUS * (1 - travel * 0.6);
    if (radius <= MIN_RADIUS) continue;
    ctx.fillStyle = rgba(BILE_MID, 0.85 * (1 - travel));
    blobPath(ctx, px, py, radius, i * 4.3, 0.22, 10);
    ctx.fill();
    ctx.fillStyle = rgba(SPECULAR, 0.5 * (1 - travel));
    ctx.beginPath();
    ctx.arc(px - radius * 0.3, py - radius * 0.35, Math.max(MIN_RADIUS, radius * 0.3), 0, TWO_PI);
    ctx.fill();
  }
}

/**
 * The wake behind the mass: a short stub of mucus still hanging off it, then a
 * widening spray of streaks and droplets.
 *
 * Every *connected* trail shape tried here — a filled ribbon, a stroked line, a
 * line of beads, a tapering run of discs — bakes as a leaf, a whisker or a
 * caterpillar attached to a round green body. A broken spray is the only trail
 * that cannot be read as part of the object it trails from.
 */
function drawDrool(ctx: Ctx, spin: number): void {
  const rootX = -BOLUS_RADIUS * 0.55;
  const wobble = Math.sin(spin) * DROOL_WOBBLE;

  for (let i = 0; i <= DROOL_STUB_SAMPLES; i++) {
    const along = i / DROOL_STUB_SAMPLES;
    const sx = rootX - along * DROOL_STUB_LENGTH;
    const sy = wobble * along * 0.5;
    const radius = lerp(DROOL_ROOT_WIDTH * 0.42, DROOL_ROOT_WIDTH * 0.14, along);
    if (radius <= MIN_RADIUS) continue;
    // The wake takes the body's own darker colour, not the bright bile: a pale
    // green streak off a brown-green mass reads as a separate object stuck to it.
    ctx.fillStyle = rgba(BILE_BODY, lerp(0.9, 0.55, along));
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, TWO_PI);
    ctx.fill();
  }

  for (let i = 0; i < DROOL_SPRAY_COUNT; i++) {
    const along = lerp(0.15, 1, hash1(i * 2.9));
    const sx = rootX - DROOL_STUB_LENGTH - along * (DROOL_LENGTH - DROOL_STUB_LENGTH);
    // The spray fans out behind the mass rather than following one line: a
    // single file of specks reads as a dotted leader, not as thrown liquid.
    const sy = (hash1(i * 5.1) - 0.5) * DROOL_SPRAY_FAN * along + wobble * along * 0.6;
    const radius = lerp(DROOL_ROOT_WIDTH * 0.55, DROOL_ROOT_WIDTH * 0.14, along);
    if (radius <= MIN_RADIUS) continue;
    ctx.fillStyle = rgba(BILE_BODY, lerp(0.88, 0.4, along));
    ctx.beginPath();
    ctx.ellipse(sx, sy, radius * DROOL_STREAK_STRETCH, radius, 0, 0, TWO_PI);
    ctx.fill();
  }
}

/** The translucent envelope: pale and thin at the edge, brown and deep at the core. */
function bolusRoughness(spin: number): number {
  return lerp(BOLUS_ROUGHNESS_MIN, BOLUS_ROUGHNESS_MAX, (Math.sin(spin * 2) + 1) / 2);
}

function drawBolusEnvelope(ctx: Ctx, spin: number): void {
  const body = ctx.createRadialGradient(
    -BOLUS_RADIUS * 0.3,
    -BOLUS_RADIUS * 0.35,
    MIN_RADIUS,
    0,
    0,
    BOLUS_RADIUS * 1.15,
  );
  // Kept well below opaque on purpose: at 90 % alpha the bolus is a solid
  // object with a gradient on it, and the floor showing faintly through the thin
  // edges is most of what says "liquid".
  body.addColorStop(0, rgba(BILE_PALE, 0.8));
  body.addColorStop(0.4, rgba(BILE_MID, 0.78));
  body.addColorStop(0.78, rgba(BILE_BODY, 0.74));
  body.addColorStop(1, rgba(BILE_DEEP, 0.45));

  blobPath(ctx, 0, 0, BOLUS_RADIUS, BODY_SHAPE_SEED, bolusRoughness(spin), BOLUS_SURFACE_STEPS);
  ctx.fillStyle = body;
  ctx.fill();

  // A wash of stomach contents in the shaded half. Brown belongs *in* the bile,
  // not all over it: a fully brown envelope bakes as a bread roll.
  ctx.save();
  blobPath(ctx, 0, 0, BOLUS_RADIUS, BODY_SHAPE_SEED, bolusRoughness(spin), BOLUS_SURFACE_STEPS);
  ctx.clip();
  ctx.fillStyle = rgba(GUT_BROWN, 0.45);
  blobPath(
    ctx,
    BOLUS_RADIUS * 0.3,
    BOLUS_RADIUS * 0.34,
    BOLUS_RADIUS * 0.8,
    GUT_WASH_SEED,
    0.3,
    16,
  );
  ctx.fill();
  ctx.restore();
}

interface ChunkPlacement {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly seed: number;
  readonly isPale: boolean;
}

/**
 * Where the suspended lumps sit on the mass. Fixed relative to it — the caller
 * has already rotated the canvas, so these ride round with the body.
 *
 * The spacing is by hash, NOT even. Eight chunks on an even ring advanced by one
 * eighth of a turn per frame land exactly on each other's previous positions:
 * the pattern would be invariant under its own animation.
 */
function chunkPlacements(): ChunkPlacement[] {
  const placements: ChunkPlacement[] = [];
  for (let i = 0; i < CHUNK_COUNT; i++) {
    const orbitAngle = hash1(i * 1.7 + 0.4) * TWO_PI;
    const orbit = BOLUS_RADIUS * lerp(CHUNK_MIN_ORBIT, CHUNK_MAX_ORBIT, hash1(i * 2.7));
    placements.push({
      x: Math.cos(orbitAngle) * orbit,
      y: Math.sin(orbitAngle) * orbit,
      radius: CHUNK_MIN_RADIUS + hash1(i * 5.3) * CHUNK_RADIUS_SPREAD,
      seed: i * 3.9,
      isPale: i % 3 === 0,
    });
  }
  return placements;
}

/**
 * A dark contour along the shaded side of the mass and of every chunk on it.
 *
 * Drawn last and only on one side. Without it every pixel of the bolus is
 * brighter than the dungeon floor it flies over and the whole thing reads as a
 * glowing orb; with it drawn all the way round it reads as ink on a sticker.
 */
function drawBolusRim(ctx: Ctx, spin: number): void {
  const HALF_PLANE_EXTENT = BOLUS_RADIUS * 3;
  ctx.save();
  // `spin` is subtracted because the caller has already turned the canvas with
  // the mass: the shaded half must stay put in screen space while the body
  // rotates under it, or the "light" tumbles along with the vomit.
  ctx.rotate(SHADED_SIDE_ANGLE - spin);
  ctx.beginPath();
  ctx.rect(-HALF_PLANE_EXTENT, 0, HALF_PLANE_EXTENT * 2, HALF_PLANE_EXTENT);
  ctx.clip();
  ctx.rotate(spin - SHADED_SIDE_ANGLE);

  ctx.strokeStyle = rgba(RIM_DARK, 0.85);
  ctx.lineWidth = BOLUS_RIM_WIDTH;
  blobPath(ctx, 0, 0, BOLUS_RADIUS, BODY_SHAPE_SEED, bolusRoughness(spin), BOLUS_SURFACE_STEPS);
  ctx.stroke();

  ctx.strokeStyle = rgba(RIM_DARK, 0.5);
  ctx.lineWidth = BOLUS_RIM_WIDTH * 0.5;
  for (const { x, y, radius, seed } of chunkPlacements()) {
    blobPath(ctx, x, y, radius, seed, 0.3, 12);
    ctx.stroke();
  }
  ctx.restore();
}

/** Solid lumps suspended in the envelope, rotating rigidly so the mass tumbles. */
function drawBolusChunks(ctx: Ctx): void {
  for (const { x: px, y: py, radius, seed, isPale: isPaleChunk } of chunkPlacements()) {
    ctx.fillStyle = rgba(isPaleChunk ? CHUNK_PALE : CHUNK_MID, 0.92);
    blobPath(ctx, px, py, radius, seed, 0.3, 12);
    ctx.fill();

    ctx.fillStyle = rgba(CHUNK_DARK, 0.42);
    blobPath(ctx, px + radius * 0.2, py + radius * 0.34, radius * 0.6, seed * 1.6, 0.28, 10);
    ctx.fill();

    if (isPaleChunk) {
      ctx.fillStyle = rgba(SPECULAR, 0.5);
      ctx.beginPath();
      ctx.arc(
        px - radius * 0.32,
        py - radius * 0.34,
        Math.max(MIN_RADIUS, radius * 0.18),
        0,
        TWO_PI,
      );
      ctx.fill();
    }
  }
}

/**
 * Wet speculars. They stay put as the mass tumbles under them — a highlight
 * that rotates with the body reads as a painted spot rather than as a light.
 */
function drawBolusSpeculars(ctx: Ctx, spin: number): void {
  const drift = Math.sin(spin) * 1.3;
  ctx.fillStyle = rgba(SPECULAR, 0.7);
  ctx.beginPath();
  ctx.ellipse(
    -BOLUS_RADIUS * 0.34 + drift,
    -BOLUS_RADIUS * 0.44,
    BOLUS_RADIUS * 0.17,
    BOLUS_RADIUS * 0.085,
    -0.6,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.fillStyle = rgba(SPECULAR, 0.5);
  ctx.beginPath();
  ctx.ellipse(
    -BOLUS_RADIUS * 0.06 + drift * 0.6,
    -BOLUS_RADIUS * 0.62,
    BOLUS_RADIUS * 0.1,
    BOLUS_RADIUS * 0.05,
    -0.3,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.fillStyle = rgba(SPECULAR, 0.45);
  ctx.beginPath();
  ctx.ellipse(
    BOLUS_RADIUS * 0.3,
    -BOLUS_RADIUS * 0.12 - drift * 0.5,
    BOLUS_RADIUS * 0.14,
    BOLUS_RADIUS * 0.08,
    0.4,
    0,
    TWO_PI,
  );
  ctx.fill();
}

// ── Sheet 2: the acid pool ───────────────────────────────────────────────────

/**
 * The frame is the footprint plus a margin: the edge-bleed gate rejects ink on
 * a cell border, so the pool cannot be authored right out to the frame wall.
 */
const POOL_FRAME_MARGIN = 22;
/**
 * Authored radius of the pool's outer corroded edge.
 *
 * This is the number the whole redraw's geometry hangs on:
 * `POOL_AUTHORED_RADIUS * GAME_PIXELS_PER_AUTHORED_PIXEL` must equal the
 * runtime's `ACID_PUDDLE_RADIUS` of 64 game px, or the hazard damages ground it
 * never covered.
 */
export const POOL_AUTHORED_RADIUS = 128;
export const POOL_FRAME_SIZE = (POOL_AUTHORED_RADIUS + POOL_FRAME_MARGIN) * 2;
export const POOL_ANCHOR = POOL_FRAME_SIZE / 2;

export const SPLASH_FRAME_COUNT = 8;
export const FORM_FRAME_COUNT = 6;
export const POOL_FRAME_COUNT = 8;
export const FADE_FRAME_COUNT = 6;

/** Samples around the perimeter; the runnels are only a few samples wide. */
const POOL_OUTLINE_STEPS = 288;
/** Fixed so the outline never swims between frames — a pool has one shape. */
const EDGE_SEED_A = 1.7;
const EDGE_SEED_B = 4.1;
const EDGE_SEED_C = 2.6;
/**
 * The corroded rim's variation is entirely OUTWARD from the nominal radius.
 *
 * The rim is the outer silhouette — the liquid never is — so this is the shape
 * the player actually sees, and it is also the shape that has to cover the
 * damage disc. Those two pull opposite ways: any inward bite that makes the
 * outline ragged is floor that hurts and looks clean. So the nominal radius is
 * the *floor* of the profile, never its mean, and all the raggedness is bumps
 * and runnels pushed past it.
 */
const RIM_RAGGED_AMPLITUDE = 0.07;
/** How far past the nominal radius a full-strength runnel reaches. */
const RIM_RUNNEL_OVERREACH = 0.085;
const RIM_BREATH_AMPLITUDE = 0.022;
const RIM_BREATH_LOBES = 5;

interface Bay {
  /** Heading the bay is bitten out of, in radians. */
  readonly angle: number;
  /** How far in it cuts, as a fraction of the shape it is cut from. */
  readonly depth: number;
  /** Gaussian half-width, in radians. */
  readonly width: number;
}

/** Swells of extra etch, pushed outward from the nominal boundary. */
const RIM_SWELLS: readonly Bay[] = [
  { angle: 2.1, depth: 0.055, width: 0.3 },
  { angle: 4.9, depth: 0.04, width: 0.25 },
  { angle: 0.3, depth: 0.05, width: 0.2 },
  { angle: 3.6, depth: 0.03, width: 0.45 },
];

/**
 * Where the liquid pulled back to as it drained and ate down, as a fraction of
 * the rim. Deep and unequal: this is the ragged shape the player actually sees.
 */
const LIQUID_BASE = 0.94;
const LIQUID_RAGGED_AMPLITUDE = 0.028;
/** How much of a bay's depth a pool at its smallest carries. */
const LIQUID_BAY_MIN_GROWTH = 0.3;
const LIQUID_BREATH_AMPLITUDE = 0.022;
const LIQUID_BREATH_LOBES = 6;
const LIQUID_BAYS: readonly Bay[] = [
  { angle: 0.95, depth: 0.17, width: 0.5 },
  { angle: 2.4, depth: 0.22, width: 0.42 },
  { angle: 3.85, depth: 0.12, width: 0.34 },
  { angle: 5.3, depth: 0.19, width: 0.5 },
  { angle: 1.95, depth: 0.1, width: 0.18 },
];

interface Runnel {
  /** Heading the runnel drains along, in radians. */
  readonly angle: number;
  /** Share of the gap between the lobed body and the full radius that it closes. */
  readonly reach: number;
  /** Gaussian half-width of its tip, in radians. */
  readonly tipWidth: number;
}

/**
 * Runnels of unequal length at unequal spacings.
 *
 * Two opposed runnels of equal length bake as a lemon, and four evenly spaced
 * ones as a star: the asymmetry is the entire point. They push the rim out and
 * carry the liquid with them, so a runnel is a green tongue inside its own
 * etched channel rather than a bare scratch in the floor. Exactly one reaches 1,
 * and that one is what the footprint gate measures.
 */
const RUNNELS: readonly Runnel[] = [
  { angle: 1.4, reach: 1, tipWidth: 0.11 },
  { angle: 5.55, reach: 0.6, tipWidth: 0.09 },
];
/** How much wider the swell a runnel drains out of is than its tip. */
const RUNNEL_SWELL_RATIO = 4.5;
/** Share of a runnel's reach carried by the narrow tip rather than the swell. */
const RUNNEL_TIP_SHARE = 0.75;

const DEEP_POCKET_COUNT = 3;
const SHALLOW_PATCH_COUNT = 4;
/** Turns a shallow patch makes around the pool per loop. */
const SHALLOW_PATCH_SWIRL = 1;
const SUSPENDED_CHUNK_COUNT = 13;
const CHUNK_BOB_FRACTION = 0.055;
const FROTH_CELL_COUNT = 20;
/**
 * Froth cycles per loop.
 *
 * One, not two: at two, cell i and cell i+half share a phase and the row plays
 * as four frames twice — measurably, the half-period frame pairs come out half
 * as different as neighbouring ones.
 */
const FROTH_CYCLES_PER_LOOP = 1;
const FROTH_MAX_RADIUS_FRACTION = 0.072;
/** Fraction of a cell's life spent inflating before it pops. */
const FROTH_POP_POINT = 0.78;
const FROTH_POP_RING_GROWTH = 2.1;
const FROTH_PHASE_JITTER = 0.3;

const FUME_COUNT = 7;
const FUME_PUFFS_PER_WISP = 4;
const FUME_RISE_FRACTION = 0.55;
const FUME_ORIGIN_SPREAD = 0.78;
/** Clearance a wisp's widest puff must keep from the frame border. */
const FUME_TOP_MARGIN = 6;
const FUME_PUFF_MAX_GROWTH = 1.3;
const FUME_PEAK_ALPHA = 0.22;
const FUME_PUFF_RADIUS_FRACTION = 0.11;

/** Angular distance between two headings, in [0, π]. */
function angleDelta(a: number, b: number): number {
  const raw = Math.abs(((a - b) % TWO_PI) + TWO_PI) % TWO_PI;
  return raw > Math.PI ? TWO_PI - raw : raw;
}

function totalBayDepth(angle: number, bays: readonly Bay[]): number {
  let total = 0;
  for (const { angle: bayAngle, depth, width } of bays) {
    const offset = angleDelta(angle, bayAngle);
    total += depth * Math.exp(-Math.pow(offset / width, 2));
  }
  return total;
}

/** Slow, large-lobed noise on an outline, in [-1, 1]. */
function coarseNoise(angle: number): number {
  return (
    Math.sin(angle * 2 + EDGE_SEED_A) * 0.5 +
    Math.sin(angle * 3 - EDGE_SEED_B) * 0.32 +
    Math.sin(angle * 5 + EDGE_SEED_C) * 0.18
  );
}

/** Fine, high-frequency noise on an outline, in [-1, 1]. */
function raggedness(angle: number): number {
  return (
    Math.sin(angle * 7 + EDGE_SEED_A) * 0.5 +
    Math.sin(angle * 11 - EDGE_SEED_B) * 0.3 +
    Math.sin(angle * 17 + EDGE_SEED_C) * 0.2
  );
}

/** How strongly a runnel pushes the outline out at this angle, in [0, 1]. */
function runnelStrength(angle: number): number {
  let strongest = 0;
  for (const { angle: runnelAngle, reach, tipWidth } of RUNNELS) {
    const offset = angleDelta(angle, runnelAngle);
    const tip = Math.exp(-Math.pow(offset / tipWidth, 2));
    const swell = Math.exp(-Math.pow(offset / (tipWidth * RUNNEL_SWELL_RATIO), 2));
    strongest = Math.max(
      strongest,
      reach * (RUNNEL_TIP_SHARE * tip + (1 - RUNNEL_TIP_SHARE) * swell),
    );
  }
  return strongest;
}

/** The outer edge of the corroded floor, as a fraction of the nominal radius. */
function rimEdgeFraction(angle: number, phase: number): number {
  // `Math.abs` on the noise is what keeps the profile outward-only: signed noise
  // would cut the boundary inside the damage radius on half its circumference.
  // Low harmonics, not the fine noise the liquid uses: at 7/11/17 the outward
  // bumps come out as an even row of small teeth, which reads as a cog.
  const ragged = RIM_RAGGED_AMPLITUDE * Math.abs(coarseNoise(angle));
  const swell = totalBayDepth(angle, RIM_SWELLS);
  // Outward-only again, so the breath can never pull the boundary inside the
  // damage radius. Without it the rim — which IS the silhouette — is pixel-
  // identical on all eight frames and the pool reads as a decal with an
  // animation playing inside it.
  const breath =
    RIM_BREATH_AMPLITUDE * (0.5 + 0.5 * Math.sin(angle * RIM_BREATH_LOBES + phase * TWO_PI));
  return 1 + ragged + swell + breath + RIM_RUNNEL_OVERREACH * runnelStrength(angle);
}

/**
 * Where the liquid itself stops, as a fraction of the authored radius.
 *
 * Its own deep bays are what give the pool a silhouette; the runnels then carry
 * it back out to the etched boundary, so each trickle is liquid in a channel.
 *
 * `spread` deepens the bays as the pool grows: a small puddle really is nearly
 * round, and without this the `form` and `fade` rows are one polygon zoomed in
 * and out, which measures as a radial-profile correlation of 0.99 against the
 * finished shape.
 *
 * `phase` breathes the whole edge. It is small, but a boiling pool whose
 * silhouette is pixel-identical in all eight frames reads as a decal with an
 * animation playing inside it.
 */
function liquidEdgeFraction(angle: number, spread: number, phase: number): number {
  const bayGrowth = lerp(LIQUID_BAY_MIN_GROWTH, 1, clamp01(spread));
  const breathe = LIQUID_BREATH_AMPLITUDE * Math.sin(angle * LIQUID_BREATH_LOBES + phase * TWO_PI);
  const pullBack =
    LIQUID_BASE -
    totalBayDepth(angle, LIQUID_BAYS) * bayGrowth +
    LIQUID_RAGGED_AMPLITUDE * raggedness(angle * 2) +
    breathe;
  const reached = pullBack + (1 - pullBack) * runnelStrength(angle);
  return rimEdgeFraction(angle, phase) * reached;
}

type EdgeShape = (angle: number) => number;

/**
 * Trace a pool outline.
 *
 * Straight segments rather than the smoothed curves used elsewhere: a runnel is
 * only a few samples wide, and quadratic smoothing pulls its tip inward, which
 * would put the measured footprint below the radius the gate checks.
 */
function tracePool(ctx: Ctx, radius: number, edge: EdgeShape): void {
  for (let i = 0; i < POOL_OUTLINE_STEPS; i++) {
    const angle = (i / POOL_OUTLINE_STEPS) * TWO_PI;
    const r = radius * edge(angle);
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function poolPath(ctx: Ctx, radius: number, edge: EdgeShape): void {
  ctx.beginPath();
  tracePool(ctx, radius, edge);
}

/** The ring between two outlines, as an even-odd path. */
function annulusPath(ctx: Ctx, radius: number, outer: EdgeShape, inner: EdgeShape): void {
  ctx.beginPath();
  tracePool(ctx, radius, outer);
  tracePool(ctx, radius, inner);
}

function scaledEdge(edge: EdgeShape, factor: number): EdgeShape {
  return (angle: number) => edge(angle) * factor;
}

/**
 * The browned, blackened floor the acid is eating, around the liquid.
 *
 * Painted as rings that stop at the liquid's edge rather than as discs under it.
 * Filled underneath, the rim's own opacity stacks with the liquid's and the pool
 * composites at alpha 253/255 — a flat sticker with no floor showing through,
 * however translucent the liquid layer thinks it is.
 */
function drawCorrodedRim(
  ctx: Ctx,
  radius: number,
  liquidEdge: EdgeShape,
  rimEdge: EdgeShape,
  opacity: number,
): void {
  // Three nested rings rather than one: a single flat annulus is exactly the
  // even outline that makes a hazard read as a sticker.
  annulusPath(ctx, radius, rimEdge, liquidEdge);
  ctx.fillStyle = rgba(CORRODE_DARK, 0.72 * opacity);
  ctx.fill('evenodd');

  annulusPath(ctx, radius, scaledEdge(rimEdge, 0.975), liquidEdge);
  ctx.fillStyle = rgba(CORRODE_DARK, 0.4 * opacity);
  ctx.fill('evenodd');

  annulusPath(ctx, radius, scaledEdge(rimEdge, 0.95), liquidEdge);
  ctx.fillStyle = rgba(CORRODE_WARM, 0.5 * opacity);
  ctx.fill('evenodd');

  // Pitting eaten inward from the rim, so the boundary is chewed rather than
  // cut. Clipped to the same ring so a pit never darkens the liquid.
  ctx.save();
  annulusPath(ctx, radius, rimEdge, liquidEdge);
  ctx.clip('evenodd');
  const PIT_COUNT = 22;
  for (let i = 0; i < PIT_COUNT; i++) {
    const angle = (i / PIT_COUNT) * TWO_PI + hash1(i * 3.7);
    const edge = radius * rimEdge(angle);
    const distance = edge * lerp(0.8, 0.98, hash1(i * 8.2));
    const pitRadius = radius * lerp(0.015, 0.055, hash1(i * 5.5));
    if (pitRadius <= MIN_RADIUS) continue;
    ctx.fillStyle = rgba(CORRODE_DARK, 0.4 * opacity);
    blobPath(
      ctx,
      Math.cos(angle) * distance,
      Math.sin(angle) * distance,
      pitRadius,
      i * 2.2,
      0.35,
      10,
    );
    ctx.fill();
  }
  ctx.restore();
}

/** The caustic body: deep and opaque at the middle, thin enough to see through at the edge. */
function drawLiquidBody(ctx: Ctx, radius: number, phase: number, opacity: number): void {
  const body = ctx.createRadialGradient(
    -radius * 0.12,
    -radius * 0.1,
    MIN_RADIUS,
    0,
    0,
    radius * LIQUID_BASE,
  );
  // The deep middle is dark, but only a little darker than the shallows: taken
  // all the way to the sump colour the pool reads as a crater with a hole in it
  // rather than as standing liquid. The sump is kept for the pockets alone.
  body.addColorStop(0, rgba(BILE_DEEP, 0.86 * opacity));
  body.addColorStop(0.42, rgba(BILE_BODY, 0.8 * opacity));
  body.addColorStop(0.72, rgba(BILE_MID, 0.72 * opacity));
  body.addColorStop(0.9, rgba(BILE_MID, 0.58 * opacity));
  body.addColorStop(1, rgba(BILE_BODY, 0.26 * opacity));
  ctx.fillStyle = body;
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2);

  for (let i = 0; i < DEEP_POCKET_COUNT; i++) {
    const angle = hash1(i * 2.9) * TWO_PI;
    const distance = radius * lerp(0.1, 0.45, hash1(i * 6.3));
    const pocketRadius = radius * lerp(0.18, 0.3, hash1(i * 4.1));
    if (pocketRadius <= MIN_RADIUS) continue;
    ctx.fillStyle = rgba(BILE_SUMP, 0.42 * opacity);
    blobPath(
      ctx,
      Math.cos(angle) * distance,
      Math.sin(angle) * distance,
      pocketRadius,
      i * 7.7,
      0.3,
      18,
    );
    ctx.fill();
  }

  // Pale shallows over the deep pockets: without them the body is one flat
  // green field and the pool reads as paper cut to shape.
  for (let i = 0; i < SHALLOW_PATCH_COUNT; i++) {
    // Drifting, because a bright patch that is byte-identical on all eight
    // frames is a painted highlight pretending to be part of a boiling surface.
    const angle = hash1(i * 5.4 + 1.3) * TWO_PI + phase * TWO_PI * SHALLOW_PATCH_SWIRL;
    const distance = radius * lerp(0.25, 0.7, hash1(i * 3.6));
    const patchRadius = radius * lerp(0.16, 0.32, hash1(i * 7.2));
    if (patchRadius <= MIN_RADIUS) continue;
    ctx.fillStyle = rgba(BILE_PALE, 0.2 * opacity);
    blobPath(
      ctx,
      Math.cos(angle) * distance,
      Math.sin(angle) * distance,
      patchRadius,
      i * 4.8,
      0.34,
      18,
    );
    ctx.fill();
  }
}

/** Undigested matter floating in it — the tell that separates vomit from slime. */
function drawSuspendedChunks(ctx: Ctx, radius: number, phase: number, opacity: number): void {
  for (let i = 0; i < SUSPENDED_CHUNK_COUNT; i++) {
    const angle = hash1(i * 1.9) * TWO_PI;
    const distance = radius * lerp(0.08, 0.82, hash1(i * 4.7));
    const chunkRadius = radius * lerp(0.028, 0.058, hash1(i * 9.1));
    if (chunkRadius <= MIN_RADIUS) continue;
    // Chunks bob on the boil rather than sitting still; a frozen scatter is what
    // gives away that the whole pool is a still image with sparkles on it.
    const bob = radius * CHUNK_BOB_FRACTION;
    const px = Math.cos(angle) * distance + Math.cos(phase * TWO_PI + i) * bob;
    const py = Math.sin(angle) * distance + Math.sin(phase * TWO_PI + i * 1.7) * bob;
    const isPaleChunk = i % 3 === 0;
    ctx.fillStyle = rgba(isPaleChunk ? CHUNK_PALE : CHUNK_MID, 0.72 * opacity);
    blobPath(ctx, px, py, chunkRadius, i * 3.3, 0.32, 12);
    ctx.fill();
    ctx.fillStyle = rgba(CHUNK_DARK, 0.4 * opacity);
    blobPath(
      ctx,
      px + chunkRadius * 0.22,
      py + chunkRadius * 0.3,
      chunkRadius * 0.6,
      i * 8.4,
      0.3,
      10,
    );
    ctx.fill();
  }
}

/**
 * Froth cells, each on its own phase so the surface boils rather than pulsing in
 * unison. A popped cell leaves a brief expanding ring where it burst.
 */
function drawFroth(ctx: Ctx, radius: number, phase: number, opacity: number): void {
  const maxRadius = radius * FROTH_MAX_RADIUS_FRACTION;
  for (let i = 0; i < FROTH_CELL_COUNT; i++) {
    const angle = hash1(i * 2.3) * TWO_PI;
    const distance = radius * lerp(0.05, 0.8, hash1(i * 5.9));
    const px = Math.cos(angle) * distance;
    const py = Math.sin(angle) * distance;
    // Spread deterministically then jittered: leaving the offsets to the hash
    // alone let them clump, and the whole surface then swelled and fell as one.
    const life =
      (phase * FROTH_CYCLES_PER_LOOP + i / FROTH_CELL_COUNT + hash1(i * 7.1) * FROTH_PHASE_JITTER) %
      1;

    if (life < FROTH_POP_POINT) {
      const swell = Math.sin((life / FROTH_POP_POINT) * (Math.PI / 2));
      const cellRadius = maxRadius * lerp(0.25, 1, swell) * lerp(0.6, 1.1, hash1(i * 3.7));
      if (cellRadius <= MIN_RADIUS) continue;
      ctx.fillStyle = rgba(FROTH_PALE, 0.6 * opacity);
      ctx.beginPath();
      ctx.arc(px, py, cellRadius, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = rgba(BILE_DEEP, 0.5 * opacity);
      ctx.lineWidth = Math.max(MIN_RADIUS, cellRadius * 0.36);
      ctx.beginPath();
      ctx.arc(px, py, cellRadius * 0.85, 0.4, 0.4 + Math.PI * 1.1);
      ctx.stroke();
      ctx.fillStyle = rgba(SPECULAR, 0.5 * opacity);
      ctx.beginPath();
      ctx.arc(
        px - cellRadius * 0.3,
        py - cellRadius * 0.32,
        Math.max(MIN_RADIUS, cellRadius * 0.28),
        0,
        TWO_PI,
      );
      ctx.fill();
      continue;
    }

    const burst = (life - FROTH_POP_POINT) / (1 - FROTH_POP_POINT);
    const ringRadius = maxRadius * lerp(1, FROTH_POP_RING_GROWTH, burst);
    if (ringRadius <= MIN_RADIUS) continue;
    ctx.strokeStyle = rgba(FROTH_PALE, 0.35 * (1 - burst) * opacity);
    ctx.lineWidth = Math.max(MIN_RADIUS, maxRadius * 0.28 * (1 - burst));
    ctx.beginPath();
    ctx.arc(px, py, ringRadius, 0, TWO_PI);
    ctx.stroke();
  }
}

/**
 * Fume wisps coming off the surface.
 *
 * Kept low-contrast and thin on purpose: at the 32 px the pool is actually seen
 * at, anything stronger merges into a grey blob sitting on top of the hazard.
 *
 * They do rise clear of the liquid — vapour that never leaves the puddle is just
 * a lighter patch of puddle. They can, because their alpha never reaches the
 * threshold the footprint gate counts as coverage, so they cannot inflate the
 * measured hazard. Their tops are clamped to the frame's own margin instead.
 */
function drawFumes(ctx: Ctx, radius: number, phase: number, opacity: number): void {
  const rise = radius * FUME_RISE_FRACTION;
  for (let i = 0; i < FUME_COUNT; i++) {
    const life = (phase + hash1(i * 6.7)) % 1;
    const angle = hash1(i * 2.1) * TWO_PI;
    const distance = radius * FUME_ORIGIN_SPREAD * hash1(i * 8.9);
    const baseX = Math.cos(angle) * distance;
    const baseY = Math.sin(angle) * distance;
    const widestPuff = radius * FUME_PUFF_RADIUS_FRACTION * FUME_PUFF_MAX_GROWTH;
    const headroom = baseY + POOL_ANCHOR - FUME_TOP_MARGIN - widestPuff;
    const height = Math.min(headroom, rise * lerp(0.6, 1, hash1(i * 4.4)) * life);
    if (height <= MIN_RADIUS) continue;
    const drift = Math.sin(life * Math.PI + i) * radius * 0.08;
    const strength = FUME_PEAK_ALPHA * Math.sin(life * Math.PI) * opacity;

    // Soft puffs stacked up the wisp rather than a stroked curve: a stroke bakes
    // as a hairline scratch lying across the pool, which reads as damage to the
    // sprite rather than as vapour above it.
    for (let puff = 0; puff < FUME_PUFFS_PER_WISP; puff++) {
      const along = (puff + 1) / FUME_PUFFS_PER_WISP;
      const puffRadius =
        radius * FUME_PUFF_RADIUS_FRACTION * lerp(0.5, FUME_PUFF_MAX_GROWTH, along);
      if (puffRadius <= MIN_RADIUS) continue;
      const px = baseX + drift * along * 1.6;
      const py = baseY - height * along;
      const puffAlpha = strength * (1 - along * 0.7);
      const puffGradient = ctx.createRadialGradient(px, py, MIN_RADIUS, px, py, puffRadius);
      puffGradient.addColorStop(0, rgba(FUME, puffAlpha));
      puffGradient.addColorStop(1, rgba(FUME, 0));
      ctx.fillStyle = puffGradient;
      ctx.beginPath();
      ctx.arc(px, py, puffRadius, 0, TWO_PI);
      ctx.fill();
    }
  }
}

/**
 * The whole pool at a given size, phase and strength. Every row is this same
 * function under different envelopes, which is what keeps the four states
 * reading as one hazard at four moments.
 */
function drawAcidPool(ctx: Ctx, spread: number, phase: number, opacity: number): void {
  const radius = POOL_AUTHORED_RADIUS * clamp01(spread);
  const strength = clamp01(opacity);
  if (radius <= MIN_RADIUS || strength <= 0) return;

  const rimEdge: EdgeShape = (edgeAngle) => rimEdgeFraction(edgeAngle, phase);
  const liquidEdge: EdgeShape = (edgeAngle) => liquidEdgeFraction(edgeAngle, spread, phase);

  drawCorrodedRim(ctx, radius, liquidEdge, rimEdge, strength);

  ctx.save();
  poolPath(ctx, radius, liquidEdge);
  ctx.clip();
  drawLiquidBody(ctx, radius, phase, strength);
  drawSuspendedChunks(ctx, radius, phase, strength);
  drawFroth(ctx, radius, phase, strength);
  ctx.restore();

  // The wet edge highlight rides on top of the liquid, outside the clip so it
  // is not shaved to half its width by its own boundary.
  poolPath(ctx, radius, liquidEdge);
  ctx.strokeStyle = rgba(FROTH_PALE, 0.16 * strength);
  ctx.lineWidth = 1.8;
  ctx.stroke();

  drawFumes(ctx, radius, phase, strength);
}

/** The bleached etch left in the stone once the acid has drained away. */
function drawEtchedStain(ctx: Ctx, spread: number, opacity: number): void {
  const radius = POOL_AUTHORED_RADIUS * clamp01(spread);
  const strength = clamp01(opacity);
  if (radius <= MIN_RADIUS || strength <= 0) return;

  poolPath(ctx, radius, (angle) => rimEdgeFraction(angle, 0));
  ctx.fillStyle = rgba(STAIN, 0.6 * strength);
  ctx.fill();

  poolPath(
    ctx,
    radius,
    scaledEdge((angle) => liquidEdgeFraction(angle, 1, 0), 0.92),
  );
  ctx.fillStyle = rgba(CORRODE_DARK, 0.22 * strength);
  ctx.fill();

  const MOTTLE_COUNT = 9;
  for (let i = 0; i < MOTTLE_COUNT; i++) {
    const angle = hash1(i * 4.9) * TWO_PI;
    const distance = radius * lerp(0.05, 0.7, hash1(i * 2.8));
    const mottleRadius = radius * lerp(0.08, 0.2, hash1(i * 6.6));
    if (mottleRadius <= MIN_RADIUS) continue;
    ctx.fillStyle = rgba(STAIN, 0.35 * strength);
    blobPath(
      ctx,
      Math.cos(angle) * distance,
      Math.sin(angle) * distance,
      mottleRadius,
      i * 5.2,
      0.34,
      14,
    );
    ctx.fill();
  }
}

// ── Row: splash ──────────────────────────────────────────────────────────────

/**
 * Spread the splash's residual pool has reached by its last frame.
 *
 * `form` starts here rather than at zero: the two rows are the same event
 * continuing, and a `form` that restarted from nothing would pop the pool away
 * the instant the splash handed over.
 */
export const FORM_START_SPREAD = 0.35;

const CROWN_REACH = POOL_AUTHORED_RADIUS * 0.8;
/**
 * The crown is seen from almost directly above, so it is barely squashed.
 * At 0.55 with a big lift every droplet lands in the upper half of the frame and
 * the burst bakes as a side-view splash pasted into a top-down scene.
 */
const CROWN_VERTICAL_SQUASH = 0.85;
const CROWN_LIFT = 12;
const CROWN_DROPLET_COUNT = 13;
const CROWN_DROPLET_MAX_RADIUS = 6;
/** How far a droplet is drawn out along its own flight direction at full speed. */
const CROWN_DROPLET_STRETCH = 2.2;
/** Even a settling droplet is not a circle; a disc reads as a printed dot. */
const CROWN_DROPLET_MIN_STRETCH = 1;
const CROWN_ANGLE_JITTER = 0.9;
const CROWN_SKIRT_FRACTION = 0.72;
const CROWN_SKIRT_ALPHA = 0.75;
const CROWN_SKIRT_WIDTH = 9;
const CROWN_SKIRT_GOBS = 15;
/** The crown is at full reach a third of the way in; the violence is all up front. */
const CROWN_PEAK_POINT = 0.34;
const GOUT_PEAK_POINT = 0.24;
const GOUT_HEIGHT = 34;
const GOUT_WIDTH = 24;
const GOUT_GOB_COUNT = 5;
/** The column necks in the middle and fattens again at its head. */
const GOUT_HEAD_WIDTH_FRACTION = 0.55;

/**
 * The one-shot impact burst as the bolus lands: a crown of thrown droplets that
 * peaks fast and falls, leaving the pool behind.
 */
export function drawAcidSplash(
  ctx: Ctx,
  cx: number,
  cy: number,
  frame: number,
  frameCount: number,
): void {
  const t = clamp01(frame / (frameCount - 1));
  const throwOut = easeOut(Math.min(1, t / CROWN_PEAK_POINT));
  const crownFade = 1 - easeIn(t);

  ctx.save();
  ctx.translate(cx, cy);

  drawAcidPool(ctx, FORM_START_SPREAD * easeOut(t), t, lerp(0.25, 0.6, easeOut(t)));

  // The central gout is a stack of gobs, not a cone: a smooth tapered triangle
  // bakes as a traffic cone standing in the pool at any size below 4×.
  const gout = Math.sin(clamp01(t / GOUT_PEAK_POINT) * (Math.PI / 2)) * (1 - easeIn(t));
  if (gout > 0) {
    const height = GOUT_HEIGHT * gout;
    for (let i = 0; i < GOUT_GOB_COUNT; i++) {
      const along = i / (GOUT_GOB_COUNT - 1);
      const gobRadius =
        GOUT_WIDTH *
        lerp(1, GOUT_HEAD_WIDTH_FRACTION, Math.sin(along * Math.PI)) *
        lerp(0.85, 1.15, hash1(i * 3.4));
      if (gobRadius <= MIN_RADIUS) continue;
      const px = (hash1(i * 6.2) - 0.5) * GOUT_WIDTH * 0.7;
      const py = -height * along;
      ctx.fillStyle = rgba(i % 2 === 0 ? BILE_MID : BILE_PALE, (0.85 - along * 0.25) * gout);
      blobPath(ctx, px, py, gobRadius, i * 5.7 + t * 3, 0.3, 14);
      ctx.fill();
      ctx.fillStyle = rgba(CHUNK_MID, 0.45 * gout);
      blobPath(ctx, px + gobRadius * 0.2, py + gobRadius * 0.25, gobRadius * 0.4, i * 9.3, 0.3, 10);
      ctx.fill();
    }
  }

  // A skirt of liquid thrown out along the floor, under the airborne droplets.
  // Without it the droplets are unconnected dots and the impact reads as
  // confetti rather than as one mass hitting stone.
  // Laid as a broken run of gobs, never as a stroked ellipse: an unbroken ring
  // of even width bakes as a targeting reticle drawn on the floor.
  const skirtRadius = CROWN_REACH * throwOut * CROWN_SKIRT_FRACTION;
  if (skirtRadius > MIN_RADIUS && crownFade > 0) {
    for (let i = 0; i < CROWN_SKIRT_GOBS; i++) {
      const angle = (i / CROWN_SKIRT_GOBS) * TWO_PI + hash1(i * 2.4) * 0.35;
      const gobRadius = CROWN_SKIRT_WIDTH * lerp(0.35, 1, hash1(i * 6.8)) * crownFade;
      if (gobRadius <= MIN_RADIUS) continue;
      const reach = skirtRadius * lerp(0.86, 1.08, hash1(i * 4.2));
      ctx.fillStyle = rgba(BILE_MID, CROWN_SKIRT_ALPHA * crownFade * lerp(0.5, 1, hash1(i * 8.6)));
      blobPath(
        ctx,
        Math.cos(angle) * reach,
        Math.sin(angle) * reach * CROWN_VERTICAL_SQUASH,
        gobRadius,
        i * 3.3,
        0.2,
        12,
      );
      ctx.fill();
    }
  }

  for (let i = 0; i < CROWN_DROPLET_COUNT; i++) {
    // A wide angular jitter and a wide size range: evenly spaced, evenly sized,
    // evenly elongated ovals radiating from a lump bake as a daisy.
    const angle = (i / CROWN_DROPLET_COUNT) * TWO_PI + hash1(i * 3.1) * CROWN_ANGLE_JITTER;
    const reach = CROWN_REACH * throwOut * lerp(0.55, 1, hash1(i * 7.3));
    const lift = Math.sin(t * Math.PI) * CROWN_LIFT * lerp(0.5, 1, hash1(i * 5.1));
    // Scaled by the fade as well as by time: at 19 droplets on one frame and
    // zero on the next, the crown does not fall, it is switched off.
    const dropletRadius =
      CROWN_DROPLET_MAX_RADIUS * lerp(0.18, 1, hash1(i * 9.7)) * lerp(0.25, 1, crownFade);
    if (dropletRadius <= MIN_RADIUS) continue;
    const px = Math.cos(angle) * reach;
    const py = Math.sin(angle) * reach * CROWN_VERTICAL_SQUASH - lift;
    // Ellipses stretched along the throw, not blobs: a small rough blob bakes
    // as a heart or a leaf, and a ring of those reads as scattered foliage.
    const screenAngle = Math.atan2(Math.sin(angle) * CROWN_VERTICAL_SQUASH, Math.cos(angle));
    const stretch = lerp(
      CROWN_DROPLET_MIN_STRETCH,
      CROWN_DROPLET_STRETCH,
      throwOut * hash1(i * 6.4),
    );
    ctx.fillStyle = rgba(BILE_MID, 0.9 * crownFade);
    ctx.beginPath();
    ctx.ellipse(px, py, dropletRadius * stretch, dropletRadius, screenAngle, 0, TWO_PI);
    ctx.fill();
    // A smaller lobe trailing the droplet: without it every blob's area is
    // exactly pi/4 of its bounding box, which is the signature of a primitive.
    ctx.fillStyle = rgba(BILE_MID, 0.75 * crownFade);
    ctx.beginPath();
    ctx.ellipse(
      px - Math.cos(screenAngle) * dropletRadius * stretch * 0.55,
      py - Math.sin(screenAngle) * dropletRadius * stretch * 0.55,
      dropletRadius * 0.38,
      dropletRadius * 0.34,
      screenAngle,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.fillStyle = rgba(CHUNK_MID, 0.5 * crownFade);
    ctx.beginPath();
    ctx.ellipse(
      px + dropletRadius * 0.2,
      py + dropletRadius * 0.25,
      dropletRadius * 0.4 * stretch,
      dropletRadius * 0.35,
      screenAngle,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.fillStyle = rgba(SPECULAR, 0.55 * crownFade);
    ctx.beginPath();
    ctx.arc(
      px - dropletRadius * 0.3,
      py - dropletRadius * 0.35,
      Math.max(MIN_RADIUS, dropletRadius * 0.26),
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  ctx.restore();
}

// ── Row: form ────────────────────────────────────────────────────────────────

/** The pool spreading out to its full footprint. */
export function drawAcidForm(
  ctx: Ctx,
  cx: number,
  cy: number,
  frame: number,
  frameCount: number,
): void {
  const t = clamp01(frame / (frameCount - 1));
  ctx.save();
  ctx.translate(cx, cy);
  drawAcidPool(ctx, lerp(FORM_START_SPREAD, 1, easeOut(t)), t, lerp(0.6, 1, t));
  ctx.restore();
}

// ── Row: pool ────────────────────────────────────────────────────────────────

/** The steady-state bubbling loop at full footprint. */
export function drawAcidPoolLoop(
  ctx: Ctx,
  cx: number,
  cy: number,
  frame: number,
  frameCount: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  drawAcidPool(ctx, 1, frame / frameCount, 1);
  ctx.restore();
}

// ── Row: fade ────────────────────────────────────────────────────────────────

/**
 * How far the pool draws in on itself as it drains away.
 *
 * It has to *retreat*, not just go transparent. A row that holds full size and
 * only ramps alpha measures as a constant-area cross-dissolve and reads as the
 * hazard turning into a grey hole in the floor rather than draining out of it.
 */
const FADE_SHRINK = 0.5;
/** The stain shrinks too, but far less: the etch is bigger than the last puddle. */
const FADE_STAIN_SHRINK = 0.9;
const FADE_STAIN_START_OPACITY = 0.9;
const FADE_STAIN_END_OPACITY = 0.34;

/** The pool sinking away, leaving an etched stain that is itself fading. */
export function drawAcidFade(
  ctx: Ctx,
  cx: number,
  cy: number,
  frame: number,
  frameCount: number,
): void {
  const t = clamp01(frame / (frameCount - 1));
  ctx.save();
  ctx.translate(cx, cy);
  // The stain is drawn first and outlives the liquid: it is what tells the
  // player where the hazard *was*, so it must not vanish with it.
  drawEtchedStain(
    ctx,
    lerp(1, FADE_STAIN_SHRINK, t),
    lerp(FADE_STAIN_START_OPACITY, FADE_STAIN_END_OPACITY, t),
  );
  // A linear drain, not an eased one: eased, the liquid holds nearly full
  // opacity for four frames and then falls off a cliff in the last two.
  drawAcidPool(ctx, lerp(1, FADE_SHRINK, easeIn(t)), t, 1 - t);
  ctx.restore();
}
