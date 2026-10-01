/**
 * Painters for the floor features a dungeon room may carry, and for the decals
 * laid along hallways.
 *
 * Every room feature is a field defined in world tile coordinates and sampled
 * at each pixel's centre, so the slice one tile paints meets its neighbour's
 * slice exactly, and every one fades to nothing at its footprint's edge, so a
 * feature never ends on a tile boundary. They are baked with the ground into
 * the chunk cache and cost nothing per frame.
 *
 * Kept quiet on purpose: muted colours, broad shapes, soft edges. A feature is
 * something the floor has, not something that competes with what stands on it.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { blitAtDevice, fillSnapped, snappedDeviceRect } from './deviceSnap';
import type { FloorFeatureId } from '../dungeon/roomCharacters';
import {
  featureHash,
  footprintWindow,
  GUTTER_EAST,
  GUTTER_SOUTH,
  LIQUID_EDGE_FIELD,
  liquidField,
  smoothstep,
  WALK_LINE_EAST,
  WALK_LINE_NORTH,
  WALK_LINE_SOUTH,
  WALK_LINE_WEST,
  type PlacedFloorFeature,
} from '../dungeon/floorFeatures';

type Rgb = readonly [number, number, number];

/** A colour and how much of it covers the floor, built up layer by layer. */
interface Paint {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Lays `rgb` at opacity `alpha` over what `paint` already holds. */
function over(paint: Paint, rgb: Rgb, alpha: number): void {
  if (alpha <= 0) return;
  const below = paint.a * (1 - alpha);
  const total = alpha + below;
  paint.r = (rgb[0] * alpha + paint.r * below) / total;
  paint.g = (rgb[1] * alpha + paint.g * below) / total;
  paint.b = (rgb[2] * alpha + paint.b * below) / total;
  paint.a = total;
}

// ── Liquids ─────────────────────────────────────────────────────────────────

/** Where wet ground darkens around a liquid, below its edge field. */
const WET_HALO_FIELD = 0.25;
/** The middle of a liquid is a little darker, where it stands deepest. */
const DEEP_FIELD_LOW = 0.75;
const DEEP_FIELD_HIGH = 1.3;
const DEEP_SHARE = 0.35;
/** Field band over which a liquid's edge goes from nothing to full. */
const LIQUID_EDGE_SOFTNESS = 0.22;
/**
 * How far north a liquid's field is compared against to find its far edge, in
 * tiles. The camera looks down and a little south, so still water catches the
 * room's light along the inside of its northern edge.
 */
const SHEEN_PROBE_TILES = 0.35;
/** Field drop over the probe at which the sheen is at full strength. */
const SHEEN_FULL_DROP = 0.2;
/** The sheen lies in this band of field just inside the edge, fading inward. */
const SHEEN_EDGE_FIELD_LOW = 0.62;
const SHEEN_EDGE_FIELD_HIGH = 0.9;

interface LiquidLook {
  readonly body: Rgb;
  readonly bodyAlpha: number;
  readonly halo: Rgb;
  readonly haloAlpha: number;
  /** The light the surface catches along its far edge. */
  readonly rim: Rgb;
  readonly rimAlpha: number;
}

/**
 * Standing water: the floor seen darker, cooler and smoother through it, a damp
 * halo round it, and a soft sheen along its far edge that is all the gloss a
 * baked decal can carry — the moving glint is the lighting pass's.
 */
const WATER_LOOK: LiquidLook = {
  body: [30, 33, 38],
  bodyAlpha: 0.4,
  halo: [30, 28, 24],
  haloAlpha: 0.16,
  rim: [210, 220, 228],
  rimAlpha: 0.3,
};
/** Plum, not red: a red pool on a dungeon floor reads as blood. */
const WINE_LOOK: LiquidLook = {
  body: [40, 18, 34],
  bodyAlpha: 0.5,
  halo: [40, 26, 36],
  haloAlpha: 0.1,
  rim: [92, 64, 96],
  rimAlpha: 0.16,
};
const OIL_LOOK: LiquidLook = {
  body: [18, 16, 14],
  bodyAlpha: 0.48,
  halo: [30, 26, 22],
  haloAlpha: 0.12,
  rim: [120, 112, 150],
  rimAlpha: 0.08,
};

function paintLiquid(
  paint: Paint,
  feature: PlacedFloorFeature,
  look: LiquidLook,
  wx: number,
  wy: number,
): void {
  const field = liquidField(feature, wx, wy);
  const halo = smoothstep(WET_HALO_FIELD, LIQUID_EDGE_FIELD, field);
  over(paint, look.halo, halo * look.haloAlpha);
  const body = smoothstep(LIQUID_EDGE_FIELD, LIQUID_EDGE_FIELD + LIQUID_EDGE_SOFTNESS, field);
  over(paint, look.body, body * look.bodyAlpha);
  const deep = smoothstep(DEEP_FIELD_LOW, DEEP_FIELD_HIGH, field);
  over(paint, look.body, deep * look.bodyAlpha * DEEP_SHARE);
  // A crescent just inside the far edge, not a wash over the whole north half.
  const nearEdge = 1 - smoothstep(SHEEN_EDGE_FIELD_LOW, SHEEN_EDGE_FIELD_HIGH, field);
  const northward = liquidField(feature, wx, wy - SHEEN_PROBE_TILES);
  const facing = smoothstep(0, SHEEN_FULL_DROP, field - northward);
  over(paint, look.rim, body * nearEdge * facing * look.rimAlpha);
}

/**
 * Broken cask staves lying in a wine spill, so the pool reads as the cask
 * that burst rather than as something that bled. Sizes are in tiles.
 */
const STAVE_COUNT = 2;
const STAVE_HALF_LENGTH = 0.34;
const STAVE_HALF_WIDTH = 0.1;
/** Staves lie this far out from the spill's middle, as a share of its smaller radius. */
const STAVE_REACH_SHARE = 0.85;
/** Staves lie roughly round the pool's rim, off true by up to this, in radians. */
const STAVE_TILT_JITTER = 0.5;
/** The second stave lies at least this far round from the first, in radians. */
const STAVE_MIN_SEPARATION = 1.8;
const STAVE_SEPARATION_RANGE = 1.6;
const STAVE_RGB: Rgb = [70, 48, 30];
/** The stave's sunlit edge, along its northern side. */
const STAVE_EDGE_RGB: Rgb = [112, 82, 52];
const STAVE_ALPHA = 0.85;
/** Share of a stave's half width that is its lit edge. */
const STAVE_EDGE_SHARE = 0.35;
/** Hash salts for where round the pool the staves lie and how they tilt. */
const STAVE_ANGLE_SALT = 31;
const STAVE_SEPARATION_SALT = 32;
const STAVE_TILT_SALT = 33;

function paintWineSpill(paint: Paint, feature: PlacedFloorFeature, wx: number, wy: number): void {
  paintLiquid(paint, feature, WINE_LOOK, wx, wy);
  const outline = feature.outline;
  if (outline === null) return;
  const reach = Math.min(outline.radiusX, outline.radiusY) * STAVE_REACH_SHARE;
  const firstAngle = featureHash(0, STAVE_ANGLE_SALT, feature.seed) * FULL_TURN;
  const separation =
    STAVE_MIN_SEPARATION +
    featureHash(0, STAVE_SEPARATION_SALT, feature.seed) * STAVE_SEPARATION_RANGE;
  for (let stave = 0; stave < STAVE_COUNT; stave++) {
    const around = firstAngle + stave * separation;
    const tilt = (featureHash(stave, STAVE_TILT_SALT, feature.seed) - HALF) * 2 * STAVE_TILT_JITTER;
    const lie = around + Math.PI * HALF + tilt;
    const dirX = Math.cos(lie);
    const dirY = Math.sin(lie);
    const offX = wx - (outline.x + Math.cos(around) * reach);
    const offY = wy - (outline.y + Math.sin(around) * reach);
    const along = offX * dirX + offY * dirY;
    const across = offY * dirX - offX * dirY;
    if (Math.abs(along) > STAVE_HALF_LENGTH || Math.abs(across) > STAVE_HALF_WIDTH) continue;
    // The lit edge is whichever long side faces north, towards the camera's key light.
    const northSide = dirX >= 0 ? -1 : 1;
    const onEdge = across * northSide > STAVE_HALF_WIDTH * (1 - 2 * STAVE_EDGE_SHARE);
    over(
      paint,
      onEdge ? STAVE_EDGE_RGB : STAVE_RGB,
      STAVE_ALPHA * footprintWindow(feature, wx, wy),
    );
  }
}

/** A floor drain's grate: half its width, the frame's share, and its slots. */
const DRAIN_HALF = 0.36;
const DRAIN_FRAME = 0.08;
const DRAIN_SLOTS_PER_TILE = 6;
const DRAIN_SLOT_SHARE = 0.55;
const DRAIN_FRAME_RGB: Rgb = [92, 96, 102];
const DRAIN_SLOT_RGB: Rgb = [16, 17, 19];
const DRAIN_BAR_RGB: Rgb = [70, 74, 80];
const DRAIN_ALPHA = 0.85;
/** The rust-brown tide mark round the water, where it has spread and dried before. */
const STAIN_RGB: Rgb = [84, 62, 34];
const STAIN_ALPHA = 0.2;
const STAIN_FIELD_LOW = 0.12;
const STAIN_FIELD_HIGH = 0.32;

function paintDrainStain(paint: Paint, feature: PlacedFloorFeature, wx: number, wy: number): void {
  const field = liquidField(feature, wx, wy);
  const stain =
    smoothstep(STAIN_FIELD_LOW, STAIN_FIELD_HIGH, field) *
    (1 - smoothstep(STAIN_FIELD_HIGH, LIQUID_EDGE_FIELD, field));
  over(paint, STAIN_RGB, stain * STAIN_ALPHA);
  paintLiquid(paint, feature, WATER_LOOK, wx, wy);

  const dx = Math.abs(wx - feature.centreX);
  const dy = Math.abs(wy - feature.centreY);
  const reach = Math.max(dx, dy);
  if (reach >= DRAIN_HALF) return;
  if (reach >= DRAIN_HALF - DRAIN_FRAME) {
    over(paint, DRAIN_FRAME_RGB, DRAIN_ALPHA);
    return;
  }
  const slotPhase = (wx - feature.centreX + DRAIN_HALF) * DRAIN_SLOTS_PER_TILE;
  const inSlot = slotPhase - Math.floor(slotPhase) < DRAIN_SLOT_SHARE;
  over(paint, inSlot ? DRAIN_SLOT_RGB : DRAIN_BAR_RGB, DRAIN_ALPHA);
}

// ── Mosaic ring ─────────────────────────────────────────────────────────────

/**
 * The ring's radii and band widths as shares of the decal's half size, so a
 * room that only has space for a smaller ring still gets the same ring.
 */
const MOSAIC_OUTER_RADIUS_SHARE = 1.03;
const MOSAIC_OUTER_WIDTH_SHARE = 0.23;
const MOSAIC_INNER_RADIUS_SHARE = 0.67;
const MOSAIC_INNER_WIDTH_SHARE = 0.07;
const MOSAIC_EDGE_SOFTNESS = 0.08;
const MOSAIC_SEGMENTS = 24;
const MOSAIC_SEAM_SHARE = 0.08;
const MOSAIC_ALPHA = 0.42;
/** Warm stones only: a cool one in a warm floor reads as a spinner, not as an inlay. */
const MOSAIC_COLOURS: ReadonlyArray<Rgb> = [
  [168, 128, 82],
  [128, 84, 62],
  [150, 112, 78],
  [104, 78, 60],
];
const MOSAIC_SEAM_RGB: Rgb = [150, 140, 120];
const MOSAIC_INNER_RGB: Rgb = [156, 136, 96];
const FULL_TURN = Math.PI * 2;

function bandCoverage(radius: number, centre: number, width: number): number {
  const half = width / 2;
  const fromEdge = half - Math.abs(radius - centre);
  return smoothstep(0, MOSAIC_EDGE_SOFTNESS, fromEdge);
}

function paintMosaicRing(paint: Paint, feature: PlacedFloorFeature, wx: number, wy: number): void {
  const dx = wx - feature.centreX;
  const dy = wy - feature.centreY;
  const radius = Math.hypot(dx, dy);
  const window = footprintWindow(feature, wx, wy);
  const half = Math.min(feature.halfWidth, feature.halfHeight);
  const inner = bandCoverage(
    radius,
    half * MOSAIC_INNER_RADIUS_SHARE,
    half * MOSAIC_INNER_WIDTH_SHARE,
  );
  over(paint, MOSAIC_INNER_RGB, inner * MOSAIC_ALPHA * window);
  const outer = bandCoverage(
    radius,
    half * MOSAIC_OUTER_RADIUS_SHARE,
    half * MOSAIC_OUTER_WIDTH_SHARE,
  );
  if (outer <= 0) return;
  const turn = (Math.atan2(dy, dx) + Math.PI) / FULL_TURN;
  const segment = turn * MOSAIC_SEGMENTS;
  const segmentIndex = Math.floor(segment) % MOSAIC_SEGMENTS;
  const inSeam = segment - Math.floor(segment) < MOSAIC_SEAM_SHARE;
  const tile = MOSAIC_COLOURS[segmentIndex % MOSAIC_COLOURS.length];
  over(paint, inSeam ? MOSAIC_SEAM_RGB : tile, outer * MOSAIC_ALPHA * window);
}

// ── Worn rug ────────────────────────────────────────────────────────────────

const RUG_FIELD_RGB: Rgb = [106, 60, 50];
const RUG_BORDER_RGB: Rgb = [136, 106, 66];
const RUG_MEDALLION_RGB: Rgb = [84, 66, 64];
const RUG_FRINGE_RGB: Rgb = [184, 166, 128];
const RUG_SHADOW_RGB: Rgb = [20, 16, 12];
const RUG_ALPHA = 0.9;
/** The weave: faint ribs along the rug's length, so it reads as cloth rather than paint. */
const RUG_WEAVE_PER_TILE = 6;
const RUG_WEAVE_ALPHA = 0.07;
const RUG_WEAVE_RGB: Rgb = [20, 14, 10];
const RUG_BORDER_TILES = 0.22;
const RUG_MEDALLION_TILES = 0.55;
/** How much paler the middle of the rug is, where it has been walked thin. */
const RUG_WEAR_LIFT = 0.22;
const RUG_WEAR_RGB: Rgb = [196, 178, 150];
const RUG_FRINGE_TILES = 0.14;
const RUG_THREADS_PER_TILE = 8;
const RUG_THREAD_SHARE = 0.5;
const RUG_FRINGE_ALPHA = 0.7;
const RUG_SHADOW_TILES = 0.06;
const RUG_SHADOW_ALPHA = 0.22;
/** Hash salt for a fringe thread's length. */
const RUG_THREAD_SALT = 3;

/** A fringe thread runs between half and all of the fringe's full length. */
const RUG_THREAD_MIN_SHARE = 0.5;

function threadLength(feature: PlacedFloorFeature, thread: number): number {
  const share =
    RUG_THREAD_MIN_SHARE +
    (1 - RUG_THREAD_MIN_SHARE) * featureHash(thread, RUG_THREAD_SALT, feature.seed);
  return RUG_FRINGE_TILES * share;
}

function paintWornRug(paint: Paint, feature: PlacedFloorFeature, wx: number, wy: number): void {
  const along = feature.halfWidth >= feature.halfHeight;
  const halfLong = along ? feature.halfWidth : feature.halfHeight;
  const halfShort = along ? feature.halfHeight : feature.halfWidth;
  const u = along ? wx - feature.centreX : wy - feature.centreY;
  const v = along ? wy - feature.centreY : wx - feature.centreX;
  const fromLongEdge = halfLong - Math.abs(u);
  const fromShortEdge = halfShort - Math.abs(v);

  if (fromLongEdge < 0 && fromShortEdge >= 0) {
    // The fringe, at the two short ends only: loose threads of uneven length.
    const thread = Math.floor((v + halfShort) * RUG_THREADS_PER_TILE);
    const phase = (v + halfShort) * RUG_THREADS_PER_TILE - thread;
    if (phase < RUG_THREAD_SHARE && -fromLongEdge < threadLength(feature, thread)) {
      over(paint, RUG_FRINGE_RGB, RUG_FRINGE_ALPHA);
    }
    return;
  }
  const edge = Math.min(fromLongEdge, fromShortEdge);
  if (edge < 0) {
    over(paint, RUG_SHADOW_RGB, (1 - smoothstep(0, RUG_SHADOW_TILES, -edge)) * RUG_SHADOW_ALPHA);
    return;
  }
  const medallion = Math.abs(u) + Math.abs(v) < RUG_MEDALLION_TILES;
  const rgb =
    edge < RUG_BORDER_TILES ? RUG_BORDER_RGB : medallion ? RUG_MEDALLION_RGB : RUG_FIELD_RGB;
  over(paint, rgb, RUG_ALPHA);
  const weave = (v + halfShort) * RUG_WEAVE_PER_TILE;
  if (weave - Math.floor(weave) < RUG_THREAD_SHARE) over(paint, RUG_WEAVE_RGB, RUG_WEAVE_ALPHA);
  const middle = Math.max(0, 1 - Math.hypot(u / halfLong, v / halfShort));
  over(paint, RUG_WEAR_RGB, middle * RUG_WEAR_LIFT);
}

// ── Scorch mark ─────────────────────────────────────────────────────────────

const SCORCH_RGB: Rgb = [24, 18, 14];
const SCORCH_ALPHA = 0.5;
const SCORCH_RADIUS = 1.3;
const SCORCH_CORE = 0.2;
/** Ragged edge: two slow wobbles round the mark, never a fine-grained noise. */
const SCORCH_WOBBLE_LOW = 3;
const SCORCH_WOBBLE_HIGH = 7;
const SCORCH_WOBBLE_LOW_DEPTH = 0.15;
const SCORCH_WOBBLE_HIGH_DEPTH = 0.08;
const SCORCH_BASE_REACH = 0.85;
/** The faster wobble's phase runs at a different rate from the seed, so the two never line up. */
const SCORCH_HIGH_PHASE_RATE = 2;

function paintScorch(paint: Paint, feature: PlacedFloorFeature, wx: number, wy: number): void {
  const dx = wx - feature.centreX;
  const dy = wy - feature.centreY;
  const angle = Math.atan2(dy, dx);
  const reach =
    SCORCH_RADIUS *
    (SCORCH_BASE_REACH +
      SCORCH_WOBBLE_LOW_DEPTH * Math.sin(angle * SCORCH_WOBBLE_LOW + feature.seed) +
      SCORCH_WOBBLE_HIGH_DEPTH *
        Math.sin(angle * SCORCH_WOBBLE_HIGH + feature.seed * SCORCH_HIGH_PHASE_RATE));
  const fall = 1 - smoothstep(SCORCH_CORE, 1, Math.hypot(dx, dy) / reach);
  over(paint, SCORCH_RGB, fall * SCORCH_ALPHA * footprintWindow(feature, wx, wy));
}

// ── Straw bed ───────────────────────────────────────────────────────────────

const STRAW_RGB: Rgb = [158, 136, 88];
const STRAW_LIGHT_RGB: Rgb = [214, 190, 122];
const STRAW_DARK_RGB: Rgb = [104, 82, 42];
const STRAW_ALPHA = 0.42;
/** The bed's ragged outline: two slow wobbles, so it reads as strewn rather than as a polygon. */
const STRAW_WOBBLE_LOW = 3;
const STRAW_WOBBLE_HIGH = 7;
const STRAW_WOBBLE_LOW_DEPTH = 0.12;
const STRAW_WOBBLE_HIGH_DEPTH = 0.07;
const STRAW_HIGH_PHASE_RATE = 3;
const STRAW_EDGE_SOFTNESS = 0.25;
/**
 * Loose straws lying on the bed: a handful per tile of bed, each long and
 * wide enough at 32 px a tile to read as a stalk rather than a speck.
 */
const STRAWS_PER_TILE = 6;
const STRAW_MIN_LENGTH_TILES = 0.35;
const STRAW_LENGTH_RANGE_TILES = 0.35;
const STRAW_HALF_WIDTH_TILES = 0.022;
const STRAW_STALK_ALPHA = 0.38;
/** Share of straws drawn dark — damp or trodden — against pale. */
const STRAW_DARK_SHARE = 0.35;
/** How far round the circle the straws lie, from east; mostly one way, as if raked. */
const STRAW_LIE_SPREAD = 0.9;
const STRAW_LIE_BASE = 0.4;
/** Hash salts for a straw's position, length, angle and tone. */
const STRAW_X_SALT = 21;
const STRAW_Y_SALT = 22;
const STRAW_LENGTH_SALT = 23;
const STRAW_ANGLE_SALT = 24;
const STRAW_TONE_SALT = 25;
/** Straws lie within this share of the bed's half size, so they stay on the bed. */
const STRAW_PLACE_SHARE = 0.75;
/** Where along its half length a straw starts to taper to its tip. */
const STRAW_TAPER_FROM = 0.6;
const HALF = 0.5;

interface Straw {
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly halfLength: number;
  readonly dark: boolean;
}

const strawCache = new WeakMap<PlacedFloorFeature, ReadonlyArray<Straw>>();

/** The loose straws on a bed, laid once per feature from its seed. */
function strawsOf(feature: PlacedFloorFeature): ReadonlyArray<Straw> {
  const cached = strawCache.get(feature);
  if (cached !== undefined) return cached;
  const area = feature.halfWidth * feature.halfHeight * Math.PI;
  const count = Math.round(area * STRAWS_PER_TILE);
  const straws: Straw[] = [];
  for (let index = 0; index < count; index++) {
    const along = featureHash(index, STRAW_X_SALT, feature.seed) * 2 - 1;
    const across = featureHash(index, STRAW_Y_SALT, feature.seed) * 2 - 1;
    const angle =
      (STRAW_LIE_BASE +
        (featureHash(index, STRAW_ANGLE_SALT, feature.seed) - HALF) * STRAW_LIE_SPREAD) *
      Math.PI;
    straws.push({
      x: feature.centreX + along * feature.halfWidth * STRAW_PLACE_SHARE,
      y: feature.centreY + across * feature.halfHeight * STRAW_PLACE_SHARE,
      dirX: Math.cos(angle),
      dirY: Math.sin(angle),
      halfLength:
        (STRAW_MIN_LENGTH_TILES +
          featureHash(index, STRAW_LENGTH_SALT, feature.seed) * STRAW_LENGTH_RANGE_TILES) *
        HALF,
      dark: featureHash(index, STRAW_TONE_SALT, feature.seed) < STRAW_DARK_SHARE,
    });
  }
  strawCache.set(feature, straws);
  return straws;
}

function paintStrawBed(paint: Paint, feature: PlacedFloorFeature, wx: number, wy: number): void {
  const u = (wx - feature.centreX) / feature.halfWidth;
  const v = (wy - feature.centreY) / feature.halfHeight;
  const angle = Math.atan2(v, u);
  const reach =
    1 +
    STRAW_WOBBLE_LOW_DEPTH * Math.sin(angle * STRAW_WOBBLE_LOW + feature.seed) +
    STRAW_WOBBLE_HIGH_DEPTH *
      Math.sin(angle * STRAW_WOBBLE_HIGH + feature.seed * STRAW_HIGH_PHASE_RATE);
  const cover = 1 - smoothstep(reach - STRAW_EDGE_SOFTNESS, reach, Math.hypot(u, v));
  const window = footprintWindow(feature, wx, wy);
  over(paint, STRAW_RGB, cover * STRAW_ALPHA * window);
  for (const straw of strawsOf(feature)) {
    const dx = wx - straw.x;
    const dy = wy - straw.y;
    const along = dx * straw.dirX + dy * straw.dirY;
    if (Math.abs(along) > straw.halfLength) continue;
    const across = Math.abs(dx * -straw.dirY + dy * straw.dirX);
    if (across > STRAW_HALF_WIDTH_TILES * 2) continue;
    const body = 1 - smoothstep(STRAW_HALF_WIDTH_TILES, STRAW_HALF_WIDTH_TILES * 2, across);
    const taper =
      1 - smoothstep(straw.halfLength * STRAW_TAPER_FROM, straw.halfLength, Math.abs(along));
    over(
      paint,
      straw.dark ? STRAW_DARK_RGB : STRAW_LIGHT_RGB,
      body * taper * STRAW_STALK_ALPHA * window,
    );
  }
}

// ── Hazard stripes ──────────────────────────────────────────────────────────

const HAZARD_GAP_TILES = 0.08;
const HAZARD_BAND_TILES = 0.38;
const HAZARD_STRIPES_PER_TILE = 2.5;
const HAZARD_YELLOW_RGB: Rgb = [196, 162, 48];
const HAZARD_BLACK_RGB: Rgb = [34, 34, 32];
const HAZARD_ALPHA = 0.58;
const HAZARD_YELLOW_SHARE = 0.5;
const HAZARD_EDGE_SOFTNESS = 0.03;

function paintHazardStripes(
  paint: Paint,
  feature: PlacedFloorFeature,
  wx: number,
  wy: number,
): void {
  const { anchor } = feature;
  if (anchor === null) return;
  const outX = Math.max(anchor.x - wx, wx - (anchor.x + anchor.w), 0);
  const outY = Math.max(anchor.y - wy, wy - (anchor.y + anchor.h), 0);
  const out = Math.max(outX, outY);
  const inBand =
    smoothstep(HAZARD_GAP_TILES, HAZARD_GAP_TILES + HAZARD_EDGE_SOFTNESS, out) *
    (1 -
      smoothstep(
        HAZARD_GAP_TILES + HAZARD_BAND_TILES - HAZARD_EDGE_SOFTNESS,
        HAZARD_GAP_TILES + HAZARD_BAND_TILES,
        out,
      ));
  if (inBand <= 0) return;
  const phase = (wx + wy) * HAZARD_STRIPES_PER_TILE;
  const yellow = phase - Math.floor(phase) < HAZARD_YELLOW_SHARE;
  over(
    paint,
    yellow ? HAZARD_YELLOW_RGB : HAZARD_BLACK_RGB,
    inBand * HAZARD_ALPHA * footprintWindow(feature, wx, wy),
  );
}

// ── Trapdoor ────────────────────────────────────────────────────────────────

const TRAPDOOR_HALF = 0.62;
const TRAPDOOR_FRAME = 0.05;
const TRAPDOOR_PLANKS = 4;
const TRAPDOOR_SEAM_SHARE = 0.08;
const TRAPDOOR_BAND_OFFSET = 0.36;
const TRAPDOOR_BAND_HALF = 0.06;
const TRAPDOOR_RING_RADIUS = 0.12;
const TRAPDOOR_RING_WIDTH = 0.035;
const TRAPDOOR_WOOD_RGB: Rgb = [112, 80, 50];
const TRAPDOOR_SEAM_RGB: Rgb = [58, 40, 26];
const TRAPDOOR_IRON_RGB: Rgb = [62, 60, 58];
const TRAPDOOR_GAP_RGB: Rgb = [20, 16, 12];
const TRAPDOOR_ALPHA = 0.92;

function paintTrapdoor(paint: Paint, feature: PlacedFloorFeature, wx: number, wy: number): void {
  const u = wx - feature.centreX;
  const v = wy - feature.centreY;
  const reach = Math.max(Math.abs(u), Math.abs(v));
  if (reach >= TRAPDOOR_HALF) return;
  if (reach >= TRAPDOOR_HALF - TRAPDOOR_FRAME) {
    over(paint, TRAPDOOR_GAP_RGB, TRAPDOOR_ALPHA);
    return;
  }
  const ring = Math.abs(Math.hypot(u - TRAPDOOR_BAND_OFFSET, v) - TRAPDOOR_RING_RADIUS);
  if (ring < TRAPDOOR_RING_WIDTH) {
    over(paint, TRAPDOOR_IRON_RGB, TRAPDOOR_ALPHA);
    return;
  }
  if (Math.abs(Math.abs(v) - TRAPDOOR_BAND_OFFSET) < TRAPDOOR_BAND_HALF) {
    over(paint, TRAPDOOR_IRON_RGB, TRAPDOOR_ALPHA);
    return;
  }
  const plank = ((u + TRAPDOOR_HALF) / (TRAPDOOR_HALF * 2)) * TRAPDOOR_PLANKS;
  const seam = plank - Math.floor(plank) < TRAPDOOR_SEAM_SHARE;
  over(paint, seam ? TRAPDOOR_SEAM_RGB : TRAPDOOR_WOOD_RGB, TRAPDOOR_ALPHA);
}

// ── Dispatch ────────────────────────────────────────────────────────────────

type FeaturePainter = (paint: Paint, feature: PlacedFloorFeature, wx: number, wy: number) => void;

/** Hallway features are drawn as hallway marks, not per-pixel decals. */
const noRoomDecal: FeaturePainter = () => undefined;

/** One painter per feature id; a new id without one is a compile error. */
const FEATURE_PAINTERS: Readonly<Record<FloorFeatureId, FeaturePainter>> = {
  puddle: (paint, feature, wx, wy) => paintLiquid(paint, feature, WATER_LOOK, wx, wy),
  drain_stain: paintDrainStain,
  wine_spill: paintWineSpill,
  oil_spill: (paint, feature, wx, wy) => paintLiquid(paint, feature, OIL_LOOK, wx, wy),
  mosaic_ring: paintMosaicRing,
  worn_rug: paintWornRug,
  scorch_mark: paintScorch,
  straw_bed: paintStrawBed,
  hazard_stripes: paintHazardStripes,
  trapdoor: paintTrapdoor,
  gutter: noRoomDecal,
  walk_line: noRoomDecal,
};

const RGBA_CHANNELS = 4;
const OPAQUE = 255;
const PIXEL_CENTRE = 0.5;

/**
 * One scratch surface per device size: a feature tile is painted pixel by
 * pixel into it and blitted, at bake time only.
 */
const scratch = new Map<string, CanvasSurface>();

function scratchSurface(w: number, h: number): CanvasSurface {
  const key = `${w}x${h}`;
  const existing = scratch.get(key);
  if (existing !== undefined) return existing;
  const surface = allocCanvas(w, h);
  scratch.set(key, surface);
  return surface;
}

/**
 * Paints the slice of a room feature that lies in one tile, at the tile's own
 * device pixels — see `deviceSnap.ts` for why it is snapped to them rather
 * than drawn at the tile's user-space rect.
 */
export function drawFeatureTile(
  ctx: CanvasRenderingContext2D,
  feature: PlacedFloorFeature,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const rect = snappedDeviceRect(ctx, sx, sy, ts, ts);
  if (rect.w <= 0 || rect.h <= 0) return;
  const surface = scratchSurface(rect.w, rect.h);
  const scratchCtx = surfaceContext(surface);
  const image = scratchCtx.createImageData(rect.w, rect.h);
  const painter = FEATURE_PAINTERS[feature.kind];
  const paint: Paint = { r: 0, g: 0, b: 0, a: 0 };
  for (let py = 0; py < rect.h; py++) {
    const wy = ty + (py + PIXEL_CENTRE) / rect.h;
    for (let px = 0; px < rect.w; px++) {
      const wx = tx + (px + PIXEL_CENTRE) / rect.w;
      paint.r = 0;
      paint.g = 0;
      paint.b = 0;
      paint.a = 0;
      painter(paint, feature, wx, wy);
      if (paint.a <= 0) continue;
      const offset = (py * rect.w + px) * RGBA_CHANNELS;
      image.data[offset] = paint.r;
      image.data[offset + 1] = paint.g;
      image.data[offset + 2] = paint.b;
      image.data[offset + 3] = Math.round(Math.min(1, paint.a) * OPAQUE);
    }
  }
  scratchCtx.putImageData(image, 0, 0);
  blitAtDevice(ctx, surface, rect);
}

// ── Hallway marks ───────────────────────────────────────────────────────────

/** A gutter: a dark channel set in from the wall, with a pale worn lip on its open side. */
const GUTTER_INSET = 0.08;
const GUTTER_WIDTH = 0.16;
const GUTTER_LIP = 0.035;
const GUTTER_COLOR = 'rgba(22, 18, 14, 0.34)';
const GUTTER_LIP_COLOR = 'rgba(226, 206, 172, 0.12)';
/** The walk line: faded safety yellow, narrower and fainter than the wall-side edge line. */
const WALK_LINE_WIDTH = 0.06;
const WALK_LINE_COLOR = 'rgba(200, 172, 80, 0.26)';
const TILE_MIDDLE = 0.5;

/** Paints a tile's gutter and walk-line marks. */
export function drawHallwayMarks(
  ctx: CanvasRenderingContext2D,
  marks: number,
  sx: number,
  sy: number,
  ts: number,
): void {
  if ((marks & GUTTER_SOUTH) !== 0) {
    const channelTop = sy + ts * (1 - GUTTER_INSET - GUTTER_WIDTH);
    ctx.fillStyle = GUTTER_COLOR;
    fillSnapped(ctx, sx, channelTop, ts, ts * GUTTER_WIDTH);
    ctx.fillStyle = GUTTER_LIP_COLOR;
    fillSnapped(ctx, sx, channelTop - ts * GUTTER_LIP, ts, ts * GUTTER_LIP);
  }
  if ((marks & GUTTER_EAST) !== 0) {
    const channelLeft = sx + ts * (1 - GUTTER_INSET - GUTTER_WIDTH);
    ctx.fillStyle = GUTTER_COLOR;
    fillSnapped(ctx, channelLeft, sy, ts * GUTTER_WIDTH, ts);
    ctx.fillStyle = GUTTER_LIP_COLOR;
    fillSnapped(ctx, channelLeft - ts * GUTTER_LIP, sy, ts * GUTTER_LIP, ts);
  }

  const walkBits = WALK_LINE_NORTH | WALK_LINE_EAST | WALK_LINE_SOUTH | WALK_LINE_WEST;
  if ((marks & walkBits) === 0) return;
  // Translucent, so every part is painted once: the centre square, then each
  // arm from its edge of that square out to the tile's edge.
  const width = ts * WALK_LINE_WIDTH;
  const near = ts * TILE_MIDDLE - width / 2;
  const far = near + width;
  ctx.fillStyle = WALK_LINE_COLOR;
  fillSnapped(ctx, sx + near, sy + near, width, width);
  if ((marks & WALK_LINE_NORTH) !== 0) fillSnapped(ctx, sx + near, sy, width, near);
  if ((marks & WALK_LINE_SOUTH) !== 0) fillSnapped(ctx, sx + near, sy + far, width, ts - far);
  if ((marks & WALK_LINE_WEST) !== 0) fillSnapped(ctx, sx, sy + near, near, width);
  if ((marks & WALK_LINE_EAST) !== 0) fillSnapped(ctx, sx + far, sy + near, ts - far, width);
}
