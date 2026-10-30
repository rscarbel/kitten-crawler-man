/**
 * The earth elemental mercenaries' earth blast: a fist-sized clump of rock and
 * packed soil punched out at a target, and the puff of dirt it bursts into
 * where it stops.
 *
 * Painted with a few canvas paths rather than baked into a sheet, for the
 * reason the goblin arrow is: a shape this small that tumbles and points along
 * any heading would need a frame per angle, and the paths are cheaper than the
 * sheet's memory.
 */

const FULL_TURN = Math.PI * 2;

// ── The clump in flight ──────────────────────────────────────────────────────

/** Radians the clump turns per frame of flight, so it reads as thrown, not slid. */
const CLUMP_SPIN_PER_FRAME = 0.22;
/** Radius of the soil core every chunk is packed around, as a fraction of a tile. */
const SOIL_CORE_RADIUS_TILES = 0.16;
/** How much wider than tall the core is: soil squashed by the punch that threw it. */
const SOIL_CORE_STRETCH = 1.2;
const OUTLINE_GROWTH_TILES = 0.022;
/**
 * The lit top-left of the soil, as a share of the core's size and how far
 * toward the light it sits: light comes from the upper left, as on every
 * sprite in the game.
 */
const SOIL_LIGHT_SHARE = 0.6;
const SOIL_LIGHT_SHIFT = 0.22;
/** A lit chunk's bright facet, sized and shifted the same way. */
const CHUNK_FACET_SHARE = 0.45;
const CHUNK_FACET_SHIFT = 0.25;

/**
 * The rock chunks stuck in the soil, about the clump's centre. Angle and
 * distance place each chunk; `size` is its radius in tiles; `sides` how many
 * facets its outline has, so no two chunks share a silhouette.
 */
const CLUMP_CHUNKS = [
  { angle: 0.3, distanceTiles: 0.17, sizeTiles: 0.09, sides: 5, lit: true },
  { angle: 1.9, distanceTiles: 0.17, sizeTiles: 0.065, sides: 4, lit: false },
  { angle: 3.3, distanceTiles: 0.18, sizeTiles: 0.08, sides: 6, lit: true },
  { angle: 4.7, distanceTiles: 0.16, sizeTiles: 0.06, sides: 4, lit: false },
] as const;

/** How far each facet's corner strays from a true polygon, as a share of the chunk's radius. */
const CHUNK_FACET_JITTER = 0.28;
/** Facets alternate in and out by the jitter; this offsets the pattern per chunk. */
const CHUNK_FACET_PHASE = 1.7;

/**
 * Dirt shed behind the clump as it flies: distance back along the heading,
 * sideways offset, radius, all in tiles, and how opaque the puff is.
 */
const TRAIL_PUFFS = [
  { backTiles: 0.2, sideTiles: 0.03, radiusTiles: 0.13, alpha: 0.6 },
  { backTiles: 0.36, sideTiles: -0.04, radiusTiles: 0.1, alpha: 0.42 },
  { backTiles: 0.5, sideTiles: 0.02, radiusTiles: 0.07, alpha: 0.25 },
] as const;

/** Crumbs falling off the back, as (back, side) in tiles. */
const TRAIL_CRUMBS = [
  { backTiles: 0.3, sideTiles: 0.12 },
  { backTiles: 0.42, sideTiles: -0.1 },
  { backTiles: 0.56, sideTiles: 0.06 },
] as const;
const TRAIL_CRUMB_SIZE_TILES = 0.05;

const SOIL_DARK = '#4a2f18';
const SOIL_MID = '#74502c';
const ROCK_LIT = '#958a78';
const ROCK_SHADE = '#675d50';
const ROCK_EDGE = '#c4b9a6';
const CLUMP_OUTLINE = '#17110b';
const TRAIL_DUST = '#9a7a52';

function traceChunk(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation: number,
): void {
  ctx.beginPath();
  for (let side = 0; side < sides; side++) {
    const facetAngle = rotation + (side / sides) * FULL_TURN;
    const jitter = 1 + CHUNK_FACET_JITTER * Math.sin(side * CHUNK_FACET_PHASE + sides);
    const px = cx + Math.cos(facetAngle) * radius * jitter;
    const py = cy + Math.sin(facetAngle) * radius * jitter;
    if (side === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * Draws one earth blast centred on (sx, sy), flying along `headingRad`.
 *
 * @param ageFrames Frames since it left the fist; turns the clump as it flies.
 */
export function drawEarthBlast(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  headingRad: number,
  ageFrames: number,
): void {
  const outline = OUTLINE_GROWTH_TILES * tileSize;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(headingRad);

  for (const puff of TRAIL_PUFFS) {
    ctx.globalAlpha = puff.alpha;
    ctx.fillStyle = TRAIL_DUST;
    ctx.beginPath();
    ctx.arc(
      -puff.backTiles * tileSize,
      puff.sideTiles * tileSize,
      puff.radiusTiles * tileSize,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const crumb = TRAIL_CRUMB_SIZE_TILES * tileSize;
  ctx.fillStyle = SOIL_MID;
  for (const bit of TRAIL_CRUMBS) {
    ctx.fillRect(
      -bit.backTiles * tileSize - crumb / 2,
      bit.sideTiles * tileSize - crumb / 2,
      crumb,
      crumb,
    );
  }

  // The tumble turns the chunks about the core; the trail stays on the heading.
  ctx.rotate(ageFrames * CLUMP_SPIN_PER_FRAME);
  const coreRx = SOIL_CORE_RADIUS_TILES * SOIL_CORE_STRETCH * tileSize;
  const coreRy = SOIL_CORE_RADIUS_TILES * tileSize;

  // One dark silhouette under everything: at a 32 px tile the clump is a dozen
  // pixels, and without it the brown vanishes on a dirt or wooden floor.
  ctx.fillStyle = CLUMP_OUTLINE;
  ctx.beginPath();
  ctx.ellipse(0, 0, coreRx + outline, coreRy + outline, 0, 0, FULL_TURN);
  ctx.fill();
  for (const chunk of CLUMP_CHUNKS) {
    const cx = Math.cos(chunk.angle) * chunk.distanceTiles * tileSize;
    const cy = Math.sin(chunk.angle) * chunk.distanceTiles * tileSize;
    traceChunk(ctx, cx, cy, chunk.sizeTiles * tileSize + outline, chunk.sides, chunk.angle);
    ctx.fill();
  }

  ctx.fillStyle = SOIL_DARK;
  ctx.beginPath();
  ctx.ellipse(0, 0, coreRx, coreRy, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = SOIL_MID;
  ctx.beginPath();
  ctx.ellipse(
    -coreRx * SOIL_LIGHT_SHIFT,
    -coreRy * SOIL_LIGHT_SHIFT,
    coreRx * SOIL_LIGHT_SHARE,
    coreRy * SOIL_LIGHT_SHARE,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();

  for (const chunk of CLUMP_CHUNKS) {
    const cx = Math.cos(chunk.angle) * chunk.distanceTiles * tileSize;
    const cy = Math.sin(chunk.angle) * chunk.distanceTiles * tileSize;
    const radius = chunk.sizeTiles * tileSize;
    ctx.fillStyle = chunk.lit ? ROCK_LIT : ROCK_SHADE;
    traceChunk(ctx, cx, cy, radius, chunk.sides, chunk.angle);
    ctx.fill();
    if (chunk.lit) {
      ctx.fillStyle = ROCK_EDGE;
      const facetShift = radius * CHUNK_FACET_SHIFT;
      traceChunk(
        ctx,
        cx - facetShift,
        cy - facetShift,
        radius * CHUNK_FACET_SHARE,
        chunk.sides,
        chunk.angle,
      );
      ctx.fill();
    }
  }

  ctx.restore();
}

// ── The puff where it stops ──────────────────────────────────────────────────

/** Frames the dirt puff plays for, from the burst to the last of the dust settling. */
export const EARTH_BLAST_IMPACT_FRAMES = 22;

/**
 * The dust clouds the clump bursts into, each grown from `startTiles` to
 * `endTiles` across the puff, offset from the impact point in tiles.
 */
const IMPACT_CLOUDS = [
  { dxTiles: -0.12, dyTiles: 0.07, startTiles: 0.12, endTiles: 0.26, alpha: 0.7, dark: true },
  { dxTiles: 0.13, dyTiles: 0.06, startTiles: 0.11, endTiles: 0.24, alpha: 0.7, dark: true },
  { dxTiles: 0, dyTiles: 0, startTiles: 0.16, endTiles: 0.36, alpha: 0.8, dark: false },
  { dxTiles: 0.03, dyTiles: -0.12, startTiles: 0.09, endTiles: 0.22, alpha: 0.6, dark: false },
] as const;

/** Bits of soil and gravel thrown out of the puff: direction in radians, how far they get in tiles. */
const IMPACT_PEBBLES = [
  { angle: 0.3, reachTiles: 0.62, sizeTiles: 0.08, rock: true },
  { angle: 1.2, reachTiles: 0.5, sizeTiles: 0.065, rock: false },
  { angle: 2.1, reachTiles: 0.68, sizeTiles: 0.085, rock: true },
  { angle: 3.0, reachTiles: 0.52, sizeTiles: 0.065, rock: false },
  { angle: 3.9, reachTiles: 0.62, sizeTiles: 0.075, rock: true },
  { angle: 4.8, reachTiles: 0.48, sizeTiles: 0.06, rock: false },
  { angle: 5.6, reachTiles: 0.64, sizeTiles: 0.07, rock: true },
] as const;
/** Pebbles start this share of the way out, so the first frame is a burst, not one dark dot. */
const PEBBLE_START_SHARE = 0.35;
/** How high a thrown pebble rises at the top of its arc, in tiles: the burst is on the ground plane. */
const PEBBLE_ARC_TILES = 0.16;
/** The pebbles are gone by this share of the puff; only the dust hangs on. */
const PEBBLE_LIFE_SHARE = 0.7;
/** The dust stays solid this long before it starts thinning out. */
const DUST_HOLD_SHARE = 0.25;

const IMPACT_DUST_LIGHT = '#a68862';
const IMPACT_DUST_DARK = '#6e5236';

/**
 * Draws the puff of dirt an earth blast bursts into, centred on (sx, sy).
 *
 * @param progress 0 at the burst, 1 as the last of the dust settles.
 */
export function drawEarthBlastImpact(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  progress: number,
): void {
  const t = Math.max(0, Math.min(1, progress));
  // Fast out, slow settle: a burst throws its dust before it drifts.
  const growth = 1 - (1 - t) * (1 - t);
  const dustFade = t <= DUST_HOLD_SHARE ? 1 : 1 - (t - DUST_HOLD_SHARE) / (1 - DUST_HOLD_SHARE);
  ctx.save();

  for (const cloud of IMPACT_CLOUDS) {
    const radius = (cloud.startTiles + (cloud.endTiles - cloud.startTiles) * growth) * tileSize;
    ctx.globalAlpha = cloud.alpha * dustFade;
    ctx.fillStyle = cloud.dark ? IMPACT_DUST_DARK : IMPACT_DUST_LIGHT;
    ctx.beginPath();
    ctx.arc(
      sx + cloud.dxTiles * tileSize * (1 + growth),
      sy + cloud.dyTiles * tileSize * (1 + growth),
      radius,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }

  if (t < PEBBLE_LIFE_SHARE) {
    const flight = t / PEBBLE_LIFE_SHARE;
    const lift = Math.sin(flight * Math.PI) * PEBBLE_ARC_TILES * tileSize;
    ctx.globalAlpha = 1 - flight;
    for (const pebble of IMPACT_PEBBLES) {
      const reachShare = PEBBLE_START_SHARE + (1 - PEBBLE_START_SHARE) * flight;
      const reach = pebble.reachTiles * tileSize * reachShare;
      const size = pebble.sizeTiles * tileSize;
      const px = sx + Math.cos(pebble.angle) * reach;
      const py = sy + Math.sin(pebble.angle) * reach - lift;
      ctx.fillStyle = pebble.rock ? CLUMP_OUTLINE : SOIL_DARK;
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    }
  }

  ctx.restore();
}
