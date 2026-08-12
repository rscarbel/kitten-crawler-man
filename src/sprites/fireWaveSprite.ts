/**
 * One tile-wide segment of the Lich's wall of fire.
 *
 * The firewall phase spawns a wave across the whole width of the room and walks
 * it south, so this is drawn edge to edge along a row and has to hold two things
 * at once: no seam where two segments meet, and no two segments that look like
 * the same picture repeated.
 *
 * Both fall out of the same decision — a segment is not a *shape*, it is a patch
 * of combustion. Parcels of burning gas are born on evenly spaced slots across
 * the tile's own mouth, so the density of fire per unit of floor is identical
 * whether you look at the middle of a tile or across a boundary; and every
 * parcel takes its width, lean, bend and sway from a hash salted with the tile's
 * own column, so neighbours differ without anything being remembered per tile.
 *
 * The stamps and the palette are the Big Top's flame vents', imported rather
 * than matched: fire is one substance in this game.
 */

import {
  MIN_VISIBLE_ALPHA,
  flameStamps,
  hashUnit,
  stampTeardrop,
  type FlameStamps,
} from './flameStamps';

const TAU = Math.PI * 2;

/**
 * How many births the loop contains.
 *
 * An integer, and the birth number is taken modulo it, so the parcel that is
 * halfway up the wall at `animPhase` 0.999 is the same parcel at 0.001 — with
 * the same hashed width and sway. Left as a free-running counter the entire wall
 * would swap identities once per loop.
 */
const WAVE_BIRTH_CYCLES = 4;
/** Parcels in the air per tile at any moment. */
const WAVE_PARCEL_COUNT = 7;
/**
 * Where in its tile the wall stands, and how far above that it reaches.
 *
 * The foot sits low in the tile and the fire licks a full tile above it: the
 * burning tile is the hitbox, and flame that only filled it would read as a
 * puddle rather than as a wall you cannot walk through.
 */
const WAVE_BASE_Y = 0.86;
const WAVE_HEIGHT_TILES = 1.45;

/**
 * How far a parcel may wander inside its own slot, as a share of the slot.
 *
 * Inside the slot rather than free: a free offset lets two parcels land on top
 * of each other and leaves a hole beside them, and a hole in a wall of fire is
 * the one thing the player is entitled to read as a gap they can run through.
 */
const WAVE_SLOT_JITTER = 0.55;
const WAVE_FOOT_HALF_WIDTH = 0.3;
const WAVE_BODY_HEIGHT = 0.72;
/** Where up the climb a parcel starts necking in, and how sharply. */
const WAVE_WAIST_START = 0.45;
const WAVE_TAPER_EXPONENT = 0.85;
/** What a parcel's body height keeps as it burns out. */
const WAVE_BODY_SURVIVAL = 0.5;
/** Rising gas accelerates; a linear climb reads as a lift, not a fire. */
const WAVE_RISE_ACCELERATION = 0.5;
const WAVE_BIRTH_FRACTION = 0.1;
const WAVE_WIDTH_JITTER = 0.45;
const WAVE_ALPHA_FLOOR = 0.7;

/**
 * Cycles of sideways whip across one parcel's whole life.
 *
 * This is the number that has to stay small. A parcel lives one loop divided by
 * {@link WAVE_BIRTH_CYCLES}, so at the fastest animation this art is meant for —
 * one loop per {@link WAVE_MIN_LOOP_FRAMES} — a two-cycle whip is still six
 * frames per cycle. Push either number and the lick aliases: it stops reading as
 * motion and starts reading as a strobe, which on a hazard is a lie about where
 * the edge of the fire is.
 */
const WAVE_SWAY_PRIMARY_CYCLE = 2;
const WAVE_SWAY_SECONDARY_CYCLE = 3;
const WAVE_SWAY_PRIMARY_TILES = 0.13;
const WAVE_SWAY_SECONDARY_TILES = 0.05;
/**
 * The shortest loop this art stays readable at, in frames. Documentation for the
 * caller driving `animPhase`, and the number the sway cycles above are sized
 * against.
 */
export const WAVE_MIN_LOOP_FRAMES = 24;

const WAVE_MAX_LEAN_RADIANS = 0.26;
/** Below this a stamp is a smear one pixel across; drawing it costs more than it shows. */
const WAVE_MIN_STAMP_HALF_WIDTH = 0.4;

/** The continuous sheet at the foot, which is what actually hides the seams. */
const WAVE_ROOT_COUNT = 3;
const WAVE_ROOT_HALF_WIDTH = 0.34;
const WAVE_ROOT_HEIGHT = 0.6;
const WAVE_ROOT_FLICKER_DEPTH = 0.1;
const WAVE_ROOT_FLICKER_CYCLES = 2;

/**
 * The white-hot point down at the fuel, where the wall is hottest.
 *
 * One per tile, and placed by hash rather than on a fixed mark. Two per tile at
 * fixed marks is a highlight every sixteen pixels for the width of the room, and
 * a periodic bright dot does not read as heat — it reads as a string of beads
 * hung along the fire, which is exactly the tiled-strip look the rest of this
 * module exists to avoid.
 */
const WAVE_THROAT_HALF_WIDTH = 0.07;
const WAVE_THROAT_LIFT = 0.09;
const WAVE_THROAT_ALPHA = 0.4;
/** The band of the tile its hashed position is drawn from, clear of both edges. */
const WAVE_THROAT_INSET = 0.25;

const WAVE_GLOW_RADIUS = 0.8;
const WAVE_GLOW_ALPHA = 0.16;
const WAVE_GLOW_FLICKER_DEPTH = 0.24;
const WAVE_GLOW_CYCLES = 3;

/**
 * Distinct offsets into the hash, so a parcel's width, brightness, sway, lane
 * and bend are independent draws. Reusing one draw for two of them ties the
 * shape to the lean and the whole wall starts to look combed one way.
 */
const SALT_COLUMN = 9973;
const SALT_WIDTH = 101;
const SALT_BRIGHTNESS = 211;
const SALT_SWAY_PRIMARY = 307;
const SALT_SWAY_SECONDARY = 401;
const SALT_SLOT = 509;
const SALT_BEND = 709;
const SALT_BEND_MIRROR = 811;
const SALT_THROAT = 1013;
const SALT_TILE_PHASE = 1201;

/**
 * The tile's own identity, from its screen position.
 *
 * Taken as a whole number of tiles rather than as raw pixels: the hash is a
 * sin-scatter, and feeding it a scrolling pixel coordinate would give the same
 * tile a different fire every time the camera moved a pixel — the wall would
 * boil. Rounded, every tile of the room keeps one identity for the whole fight,
 * and a wave passing over it looks like the same wave.
 */
function columnSeed(sx: number, tileSize: number): number {
  return Math.round(sx / tileSize) * SALT_COLUMN;
}

function paintGlowPool(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  cx: number,
  baseY: number,
  tileSize: number,
  phase: number,
): void {
  const breath =
    1 - WAVE_GLOW_FLICKER_DEPTH * (0.5 + 0.5 * Math.sin(phase * TAU * WAVE_GLOW_CYCLES));
  const radius = tileSize * WAVE_GLOW_RADIUS;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = WAVE_GLOW_ALPHA * breath;
  ctx.drawImage(stamps.glow, cx - radius, baseY - radius, radius * 2, radius * 2);
  ctx.restore();
}

/**
 * The anchored sheet the parcels leave from.
 *
 * Every roving part of the wall is free to lean away from the tile edge, which
 * on its own would let a gap open between two segments for a frame. The roots
 * are wide, overlapping and pinned to the floor, so the base of the wall is
 * continuous no matter what the licks are doing above it.
 */
function paintRoots(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  sx: number,
  baseY: number,
  tileSize: number,
  phase: number,
  seed: number,
): void {
  for (let i = 0; i < WAVE_ROOT_COUNT; i++) {
    const alongTile = (i + 0.5) / WAVE_ROOT_COUNT;
    const flicker =
      1 -
      WAVE_ROOT_FLICKER_DEPTH *
        (0.5 + 0.5 * Math.sin(phase * TAU * WAVE_ROOT_FLICKER_CYCLES + hashUnit(seed, i) * TAU));
    stampTeardrop(
      ctx,
      stamps.root,
      sx + tileSize * alongTile,
      baseY,
      tileSize * WAVE_ROOT_HALF_WIDTH,
      tileSize * WAVE_ROOT_HEIGHT * flicker,
      0,
      flicker,
      hashUnit(seed + i, i) < 0.5,
    );
  }
}

function paintThroat(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  sx: number,
  baseY: number,
  tileSize: number,
  phase: number,
  seed: number,
): void {
  const alongTile =
    WAVE_THROAT_INSET + hashUnit(seed + SALT_THROAT, 0) * (1 - WAVE_THROAT_INSET * 2);
  const flicker =
    0.5 + 0.5 * Math.sin(phase * TAU * WAVE_ROOT_FLICKER_CYCLES + hashUnit(seed, 0) * TAU);
  const half = tileSize * WAVE_THROAT_HALF_WIDTH;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = WAVE_THROAT_ALPHA * flicker;
  ctx.drawImage(
    stamps.throat,
    sx + tileSize * alongTile - half,
    baseY - tileSize * WAVE_THROAT_LIFT - half,
    half * 2,
    half * 2,
  );
  ctx.restore();
}

function paintParcels(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  sx: number,
  baseY: number,
  tileSize: number,
  phase: number,
  seed: number,
): void {
  const columnHeight = tileSize * WAVE_HEIGHT_TILES;
  const topTier = stamps.body.length - 1;
  const clock = phase * WAVE_BIRTH_CYCLES;

  for (let i = 0; i < WAVE_PARCEL_COUNT; i++) {
    const release = clock + i / WAVE_PARCEL_COUNT;
    // Modulo the cycle count, so the identities repeat exactly once per loop
    // instead of walking off with the frame counter.
    const birth =
      ((Math.floor(release) % WAVE_BIRTH_CYCLES) + WAVE_BIRTH_CYCLES) % WAVE_BIRTH_CYCLES;
    const age = release - Math.floor(release);

    const brightness =
      WAVE_ALPHA_FLOOR + (1 - WAVE_ALPHA_FLOOR) * hashUnit(seed + birth + SALT_BRIGHTNESS, i);
    const alpha = brightness * Math.min(1, age / WAVE_BIRTH_FRACTION);
    if (alpha < MIN_VISIBLE_ALPHA) continue;

    const slot = (i + 0.5) / WAVE_PARCEL_COUNT;
    const jitter =
      ((hashUnit(seed + birth + SALT_SLOT, i) - 0.5) * WAVE_SLOT_JITTER) / WAVE_PARCEL_COUNT;
    const climb = age * (1 - WAVE_RISE_ACCELERATION + WAVE_RISE_ACCELERATION * age);
    const footY = baseY - columnHeight * climb;

    const swaySeedPrimary = hashUnit(seed + birth + SALT_SWAY_PRIMARY, i) * TAU;
    const swaySeedSecondary = hashUnit(seed + birth + SALT_SWAY_SECONDARY, i) * TAU;
    const sway =
      tileSize *
      age *
      (WAVE_SWAY_PRIMARY_TILES * Math.sin(age * WAVE_SWAY_PRIMARY_CYCLE + swaySeedPrimary) +
        WAVE_SWAY_SECONDARY_TILES * Math.sin(age * WAVE_SWAY_SECONDARY_CYCLE + swaySeedSecondary));
    const footX = sx + tileSize * (slot + jitter) + sway;

    const widthJitter = 1 + (hashUnit(seed + birth + SALT_WIDTH, i) - 0.5) * WAVE_WIDTH_JITTER;
    const pastWaist = Math.max(0, age - WAVE_WAIST_START) / (1 - WAVE_WAIST_START);
    const girth = Math.pow(1 - pastWaist, WAVE_TAPER_EXPONENT);
    const halfWidth = tileSize * WAVE_FOOT_HALF_WIDTH * widthJitter * girth;
    if (halfWidth < WAVE_MIN_STAMP_HALF_WIDTH) continue;
    const bodyHeight =
      tileSize *
      WAVE_BODY_HEIGHT *
      widthJitter *
      (WAVE_BODY_SURVIVAL + (1 - WAVE_BODY_SURVIVAL) * (1 - age));

    const tier = Math.min(topTier, Math.floor(climb * stamps.body.length));
    const bends = stamps.body[tier];
    const bendIndex = Math.min(
      bends.length - 1,
      Math.floor(hashUnit(seed + birth + SALT_BEND, i) * bends.length),
    );
    const tilt = Math.max(
      -WAVE_MAX_LEAN_RADIANS,
      Math.min(WAVE_MAX_LEAN_RADIANS, sway / Math.max(bodyHeight, 1)),
    );
    stampTeardrop(
      ctx,
      bends[bendIndex],
      footX,
      footY,
      halfWidth,
      bodyHeight,
      tilt,
      Math.min(1, alpha),
      hashUnit(seed + birth + SALT_BEND_MIRROR, i) < 0.5,
    );
  }
}

/**
 * Draws one tile-wide segment of a wall of flame.
 *
 * `(sx, sy)` is the screen-space top-left of the tile; `animPhase` is a 0..1
 * looping animation phase, which the caller must not advance faster than one
 * full loop per {@link WAVE_MIN_LOOP_FRAMES} frames.
 */
export function drawFireWave(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  animPhase: number,
): void {
  const stamps = flameStamps();
  const baseY = sy + tileSize * WAVE_BASE_Y;
  const seed = columnSeed(sx, tileSize);
  // Each tile runs the same loop from a different point in it, so a whole row
  // never breathes in unison — which is the tell that reads as a printed strip
  // rather than as a fire.
  const phase = (animPhase + hashUnit(seed + SALT_TILE_PHASE, 0)) % 1;

  ctx.save();
  paintGlowPool(ctx, stamps, sx + tileSize / 2, baseY, tileSize, phase);
  paintRoots(ctx, stamps, sx, baseY, tileSize, phase, seed);
  paintParcels(ctx, stamps, sx, baseY, tileSize, phase, seed);
  paintThroat(ctx, stamps, sx, baseY, tileSize, phase, seed);
  ctx.restore();
}
