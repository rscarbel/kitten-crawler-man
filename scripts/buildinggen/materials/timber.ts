/**
 * Timber: the half-timbered frames the town's cottages are built in, and the
 * plank walls of everything thrown up in a hurry behind them.
 *
 * ## A frame is a thing standing in front of a wall
 *
 * The single tell that separates half-timbering from a brown grid drawn on
 * cream is that the timbers are *proud of the plaster*. So the plaster is
 * painted first — by `paintPlaster`, the same routine a plain plaster wall uses,
 * because a frame whose infill is a second implementation of plaster drifts away
 * from it the first time either is tuned — and every beam then drops a short
 * shadow down-right onto it. Remove those shadows and the whole facade
 * flattens into wallpaper, however good the grain on the beams is.
 *
 * ## Nothing lands on the tile grid
 *
 * Panel widths come from the plane's own width divided into a count, then
 * jittered per panel. A carpenter's nominal panel width would be a round number
 * of tiles, and a post every 48 px paints a visible grid across the town at
 * in-game scale even though every post is individually varied.
 */

import type { NoiseField } from '../../tilegen/noise.js';
import type { Plane, Point } from '../projection.js';
import { LIGHT_DIR_X, LIGHT_DIR_Y, hueShift, rgb, rgba, sampleRamp, type Ramp } from '../ramps.js';
import { jointWander } from '../texture.js';
import {
  ELEMENT_BOTTOM_SHADOW,
  ELEMENT_EDGE_PX,
  ELEMENT_HUE_JITTER,
  ELEMENT_TONE_JITTER,
  ELEMENT_TOP_LIGHT,
  elementValue,
  type Band,
} from './kit.js';
import { paintPlaster } from './plaster.js';

export interface TimberFrameOptions {
  readonly plane: Plane;
  readonly noise: NoiseField;
  readonly seed: number;
  readonly band: Band;
  readonly beamRamp: Ramp;
  readonly infillRamp: Ramp;
  readonly scale: number;
  /** Diagonal braces in the end panels. */
  readonly braces: boolean;
  /** A horizontal sill beam across the band's bottom. */
  readonly sillBeam: boolean;
}

export interface PlankWallOptions {
  readonly plane: Plane;
  readonly noise: NoiseField;
  readonly seed: number;
  readonly band: Band;
  readonly ramp: Ramp;
  readonly scale: number;
  /** Planks run vertically when false — horizontal weatherboarding when true. */
  readonly horizontal: boolean;
}

/** The midpoint every jitter sample is centred on before being scaled. */
const JITTER_MIDPOINT = 0.5;

/** Ramp position the bulk of a beam or a plank sits at. */
const TIMBER_BASE_TONE = 0.5;

/**
 * Opacity of the 1px lit and shadowed edges every member gets. The kit's
 * `ELEMENT_TOP_LIGHT` / `ELEMENT_BOTTOM_SHADOW` are *tone* offsets, not alphas;
 * these say how firmly the resulting line is laid over the surface beneath it.
 */
const EDGE_LIGHT_ALPHA = 0.66;
const EDGE_SHADOW_ALPHA = 0.48;

// ── the frame ──────────────────────────────────────────────────────────────

/**
 * Nominal panel width in tiles, used only to choose *how many* panels a wall
 * gets. The width they actually come out at is the plane's width divided by
 * that count, which lands on an arbitrary period rather than a tile-sized one.
 */
const NOMINAL_PANEL_TILES = 0.82;
const MIN_PANELS = 2;
const PANEL_EDGE_JITTER = 0.26;

/** Beam sizes, in tiles. Posts are the slenderest member; the sill is the fattest. */
const POST_WIDTH_TILES = 0.15;
const HEAD_BEAM_TILES = 0.18;
const SILL_BEAM_TILES = 0.21;
const BRACE_WIDTH_TILES = 0.12;
const MIN_BEAM_WIDTH_PX = 3;

/** How far into its panel a brace's head reaches, as a fraction of panel width. */
const BRACE_HEAD_REACH = 0.85;

/** The drop shadow that puts the frame in front of the plaster. */
const BEAM_SHADOW_PX = 1.6;
const BEAM_SHADOW_TONE = 0.04;
const BEAM_SHADOW_ALPHA = 0.34;

/** Along-grain streaks: 1px lines of a darker ramp value running the beam's length. */
const GRAIN_STREAKS_PER_TILE = 3.4;
const GRAIN_STREAK_TONE_DROP = 0.3;
const GRAIN_STREAK_ALPHA = 0.6;
const GRAIN_STREAK_MIN_LENGTH = 0.25;
const GRAIN_STREAK_LENGTH_SPREAD = 0.6;

/** Pegs at the joints, and how often a joint actually shows one. */
const PEG_CHANCE = 0.62;
const PEG_RADIUS_TILES = 0.035;
const PEG_TONE = 0.24;
const PEG_RING_TONE = 0.78;
const PEG_RING_ALPHA = 0.45;

/** Element streams for the frame. */
const STREAM_PANEL_EDGE = 21;
const STREAM_BEAM_TONE = 22;
const STREAM_BEAM_HUE = 23;
const STREAM_GRAIN_ACROSS = 24;
const STREAM_GRAIN_ALONG = 25;
const STREAM_GRAIN_LENGTH = 26;
const STREAM_PEG = 27;

/** Keeps two streams indexed by (element, sub-element) from colliding. */
const SUB_ELEMENT_STRIDE = 1009;

/** Seed offset for the infill, so the plaster does not correlate with the frame. */
const INFILL_SEED_OFFSET = 5171;

/** Infill under a frame is limewash, not a colour coat: barely painted at all. */
const INFILL_PAINTED = 0.18;

export function paintTimberFrame(options: TimberFrameOptions): void {
  const { plane, noise, seed, band, scale } = options;

  paintPlaster({
    plane,
    noise,
    seed: seed + INFILL_SEED_OFFSET,
    band,
    ramp: options.infillRamp,
    trimRamp: options.infillRamp,
    painted: INFILL_PAINTED,
    scale,
  });

  const ctx = plane.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, band.top, plane.width, band.bottom - band.top);
  ctx.clip();

  const postWidth = beamWidth(scale, POST_WIDTH_TILES);
  const headHeight = beamWidth(scale, HEAD_BEAM_TILES);
  const sillHeight = beamWidth(scale, SILL_BEAM_TILES);
  const boundaries = panelBoundaries(options);
  const headCentreY = band.top + headHeight / 2;
  const sillCentreY = band.bottom - sillHeight / 2;
  const postFootY = options.sillBeam ? sillCentreY : band.bottom;

  // Braces go under the posts: a brace is a secondary member pegged into the
  // frame, and one drawn over its own post reads as a plank leaning on the wall.
  // `boundaries.length` is `panelCount + 1` and `panelCount` is floored at
  // `MIN_PANELS`, so a second clause on it is true for every plane this kit can
  // produce and only read as a guard.
  if (options.braces) {
    paintBraces(options, boundaries, headCentreY, postFootY);
  }

  let beamIndex = 0;
  for (const x of boundaries) {
    paintBeam(options, {
      index: beamIndex,
      start: { x, y: postFootY },
      end: { x, y: headCentreY },
      width: postWidth,
    });
    beamIndex++;
  }

  paintBeam(options, {
    index: beamIndex,
    start: { x: 0, y: headCentreY },
    end: { x: plane.width, y: headCentreY },
    width: headHeight,
  });
  beamIndex++;

  if (options.sillBeam) {
    paintBeam(options, {
      index: beamIndex,
      start: { x: 0, y: sillCentreY },
      end: { x: plane.width, y: sillCentreY },
      width: sillHeight,
    });
  }

  paintPegs(options, boundaries, headCentreY, sillCentreY);

  ctx.restore();
}

function beamWidth(scale: number, tiles: number): number {
  return Math.max(MIN_BEAM_WIDTH_PX, scale * tiles);
}

function panelBoundaries(options: TimberFrameOptions): ReadonlyArray<number> {
  const { plane, seed, scale } = options;
  const panelCount = Math.max(MIN_PANELS, Math.round(plane.width / (scale * NOMINAL_PANEL_TILES)));
  const nominal = plane.width / panelCount;
  const boundaries: number[] = [0];
  for (let panel = 1; panel < panelCount; panel++) {
    const jitter =
      (elementValue(seed, STREAM_PANEL_EDGE, panel) - JITTER_MIDPOINT) * 2 * PANEL_EDGE_JITTER;
    boundaries.push(panel * nominal + jitter * nominal);
  }
  boundaries.push(plane.width);
  return boundaries;
}

interface BeamLine {
  readonly index: number;
  /** Always the foot or the left-hand end — see `paintBeam` for why. */
  readonly start: Point;
  readonly end: Point;
  readonly width: number;
}

/**
 * One member of the frame, with its shadow, its grain and its lit edge.
 *
 * A beam is painted in its own rotated space, where the member runs along +x and
 * its width spans y. That is what lets a post, a head beam and a diagonal brace
 * share every detail pass. The contract that makes the *lighting* shared too is
 * that `start` is the foot of a vertical member and the left end of a horizontal
 * one: with the beam's own axis pointing up or right, the local top edge always
 * lands on the face the town's sun is on.
 */
function paintBeam(options: TimberFrameOptions, beam: BeamLine): void {
  const { plane, seed, beamRamp } = options;
  const ctx = plane.ctx;
  const length = Math.hypot(beam.end.x - beam.start.x, beam.end.y - beam.start.y);
  if (length <= 0 || beam.width <= 0) return;
  const angle = Math.atan2(beam.end.y - beam.start.y, beam.end.x - beam.start.x);
  const halfWidth = beam.width / 2;

  // The shadow is cast away from the light, which is what makes the frame sit in
  // front of the plaster rather than being inlaid into it.
  const shadowX = -Math.sign(LIGHT_DIR_X) * BEAM_SHADOW_PX;
  const shadowY = -Math.sign(LIGHT_DIR_Y) * BEAM_SHADOW_PX;
  ctx.save();
  ctx.translate(beam.start.x + shadowX, beam.start.y + shadowY);
  ctx.rotate(angle);
  ctx.fillStyle = rgba(sampleRamp(beamRamp, BEAM_SHADOW_TONE), BEAM_SHADOW_ALPHA);
  ctx.fillRect(0, -halfWidth, length, beam.width);
  ctx.restore();

  const tone =
    TIMBER_BASE_TONE +
    (elementValue(seed, STREAM_BEAM_TONE, beam.index) - JITTER_MIDPOINT) * 2 * ELEMENT_TONE_JITTER;
  const hue =
    (elementValue(seed, STREAM_BEAM_HUE, beam.index) - JITTER_MIDPOINT) * 2 * ELEMENT_HUE_JITTER;

  ctx.save();
  ctx.translate(beam.start.x, beam.start.y);
  ctx.rotate(angle);
  ctx.fillStyle = rgb(hueShift(sampleRamp(beamRamp, tone), hue));
  ctx.fillRect(0, -halfWidth, length, beam.width);

  paintGrainStreaks(options, beam, length, tone);

  ctx.fillStyle = rgba(sampleRamp(beamRamp, tone + ELEMENT_TOP_LIGHT), EDGE_LIGHT_ALPHA);
  ctx.fillRect(0, -halfWidth, length, ELEMENT_EDGE_PX);
  ctx.fillStyle = rgba(sampleRamp(beamRamp, tone - ELEMENT_BOTTOM_SHADOW), EDGE_SHADOW_ALPHA);
  ctx.fillRect(0, halfWidth - ELEMENT_EDGE_PX, length, ELEMENT_EDGE_PX);
  ctx.restore();
}

/** Called inside a beam's rotated space: streaks run along local +x by construction. */
function paintGrainStreaks(
  options: TimberFrameOptions,
  beam: BeamLine,
  length: number,
  tone: number,
): void {
  const ctx = options.plane.ctx;
  const streakCount = Math.max(1, Math.round((length / options.scale) * GRAIN_STREAKS_PER_TILE));
  ctx.fillStyle = rgba(
    sampleRamp(options.beamRamp, tone - GRAIN_STREAK_TONE_DROP),
    GRAIN_STREAK_ALPHA,
  );
  for (let streak = 0; streak < streakCount; streak++) {
    const key = beam.index * SUB_ELEMENT_STRIDE + streak;
    const across =
      (elementValue(options.seed, STREAM_GRAIN_ACROSS, key) - JITTER_MIDPOINT) * beam.width;
    const start = elementValue(options.seed, STREAM_GRAIN_ALONG, key) * length;
    const streakLength =
      length *
      (GRAIN_STREAK_MIN_LENGTH +
        elementValue(options.seed, STREAM_GRAIN_LENGTH, key) * GRAIN_STREAK_LENGTH_SPREAD);
    ctx.fillRect(start, across, Math.min(streakLength, length - start), ELEMENT_EDGE_PX);
  }
}

/**
 * The diagonal braces in the end panels.
 *
 * Both rise from the wall's outer corner toward the middle of the building,
 * which is the direction a brace actually resists — and, incidentally, the only
 * arrangement that looks deliberate rather than like two beams that happen to
 * lean.
 */
function paintBraces(
  options: TimberFrameOptions,
  boundaries: ReadonlyArray<number>,
  headCentreY: number,
  footY: number,
): void {
  const width = beamWidth(options.scale, BRACE_WIDTH_TILES);
  const leftOuter = boundaries[0];
  const leftInner = boundaries[1];
  const rightOuter = boundaries[boundaries.length - 1];
  const rightInner = boundaries[boundaries.length - 2];
  const BRACE_LEFT_INDEX = -1;
  const BRACE_RIGHT_INDEX = -2;

  paintBeam(options, {
    index: BRACE_LEFT_INDEX,
    start: { x: leftOuter, y: footY },
    end: { x: leftOuter + (leftInner - leftOuter) * BRACE_HEAD_REACH, y: headCentreY },
    width,
  });
  paintBeam(options, {
    index: BRACE_RIGHT_INDEX,
    start: { x: rightOuter, y: footY },
    end: { x: rightOuter - (rightOuter - rightInner) * BRACE_HEAD_REACH, y: headCentreY },
    width,
  });
}

/** Oak pegs at the post-to-beam joints, the detail that says the frame is joined. */
function paintPegs(
  options: TimberFrameOptions,
  boundaries: ReadonlyArray<number>,
  headCentreY: number,
  sillCentreY: number,
): void {
  const ctx = options.plane.ctx;
  const radius = Math.max(1, options.scale * PEG_RADIUS_TILES);
  const jointRows = options.sillBeam ? [headCentreY, sillCentreY] : [headCentreY];

  let joint = 0;
  for (const y of jointRows) {
    for (const x of boundaries) {
      joint++;
      if (elementValue(options.seed, STREAM_PEG, joint) > PEG_CHANCE) continue;
      ctx.fillStyle = rgba(sampleRamp(options.beamRamp, PEG_RING_TONE), PEG_RING_ALPHA);
      ctx.beginPath();
      ctx.arc(x, y, radius + ELEMENT_EDGE_PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(sampleRamp(options.beamRamp, PEG_TONE));
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ── plank walls ────────────────────────────────────────────────────────────

/** Nominal plank width in tiles, before per-plank jitter. */
const PLANK_WIDTH_TILES = 0.42;
const PLANK_WIDTH_JITTER = 0.3;
const MIN_PLANK_WIDTH_PX = 4;

/** The gap between two planks: painted under them, so a gap can never be missed. */
const PLANK_GAP_TONE = 0.06;
const PLANK_GAP_PX = 1.3;
const PLANK_EDGE_WANDER_PX = 0.9;
const PLANK_EDGE_WANDER_PERIOD = 11;
/** Distance between samples of a wandering plank edge. */
const PLANK_EDGE_STEP_PX = 3;

/** Per-plank streaking, in streaks per tile of plank length. */
const PLANK_GRAIN_PER_TILE = 2.6;
const PLANK_GRAIN_TONE_DROP = 0.2;
const PLANK_GRAIN_ALPHA = 0.42;
const PLANK_GRAIN_MIN_LENGTH = 0.2;
const PLANK_GRAIN_LENGTH_SPREAD = 0.55;

/** Knots: roughly one every few planks. */
const KNOT_CHANCE = 0.34;
const KNOT_RADIUS_TILES = 0.05;
const KNOT_ASPECT = 1.6;
const KNOT_CORE_DROP = 0.4;
const KNOT_RING_LIFT = 0.3;
const KNOT_RING_ALPHA = 0.5;
const KNOT_RING_WIDTH_PX = 1;

/** A split running in from one end of a plank. */
const SPLIT_CHANCE = 0.14;
const SPLIT_LENGTH_TILES = 0.3;
/** Keeps a split clear of its plank's own edges, where it would read as the gap. */
const SPLIT_EDGE_MARGIN = 0.16;
const SPLIT_DRIFT = 0.35;
const SPLIT_TONE = 0.08;
const SPLIT_ALPHA = 0.55;
const SPLIT_WIDTH_PX = 1;

/** Element streams for the planking. */
const STREAM_PLANK_WIDTH = 31;
const STREAM_PLANK_TONE = 32;
const STREAM_PLANK_HUE = 33;
const STREAM_PLANK_GRAIN = 34;
const STREAM_PLANK_GRAIN_ALONG = 35;
const STREAM_PLANK_GRAIN_LENGTH = 36;
const STREAM_PLANK_KNOT = 37;
const STREAM_PLANK_KNOT_POSITION = 38;
const STREAM_PLANK_SPLIT = 39;

/**
 * Boarding, in whichever of the two directions the wall runs.
 *
 * The whole routine is written in *along* and *across* rather than x and y, and
 * a single mapping function decides which of those is which. Weatherboarding and
 * vertical planking then share every detail — the wandering gap, the grain, the
 * knots — instead of being two implementations that drift apart.
 */
export function paintPlankWall(options: PlankWallOptions): void {
  const { plane, seed, band, ramp, scale, horizontal } = options;
  const ctx = plane.ctx;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, band.top, plane.width, band.bottom - band.top);
  ctx.clip();

  // Same trick the masonry uses: the gap colour goes down first and the planks
  // are drawn over it, so a rounding error between two planks shows a gap rather
  // than a hole.
  ctx.fillStyle = rgb(sampleRamp(ramp, PLANK_GAP_TONE));
  ctx.fillRect(0, band.top, plane.width, band.bottom - band.top);

  const acrossStart = horizontal ? band.top : 0;
  const acrossEnd = horizontal ? band.bottom : plane.width;
  const alongStart = horizontal ? 0 : band.top;
  const alongEnd = horizontal ? plane.width : band.bottom;
  const nominal = Math.max(MIN_PLANK_WIDTH_PX, scale * PLANK_WIDTH_TILES);

  let plankIndex = 0;
  let across = acrossStart;
  while (across < acrossEnd) {
    const jitter =
      1 +
      (elementValue(seed, STREAM_PLANK_WIDTH, plankIndex) - JITTER_MIDPOINT) *
        2 *
        PLANK_WIDTH_JITTER;
    const width = Math.max(MIN_PLANK_WIDTH_PX, nominal * jitter);
    paintPlank(options, {
      index: plankIndex,
      acrossStart: across + PLANK_GAP_PX / 2,
      acrossEnd: Math.min(across + width - PLANK_GAP_PX / 2, acrossEnd),
      alongStart,
      alongEnd,
    });
    across += width;
    plankIndex++;
  }

  ctx.restore();
}

interface Plank {
  readonly index: number;
  readonly acrossStart: number;
  readonly acrossEnd: number;
  readonly alongStart: number;
  readonly alongEnd: number;
}

/** Maps a plank-space (along, across) pair into the plane's x and y. */
function toPlane(options: PlankWallOptions, along: number, across: number): Point {
  return options.horizontal ? { x: along, y: across } : { x: across, y: along };
}

function paintPlank(options: PlankWallOptions, plank: Plank): void {
  const { plane, seed, ramp } = options;
  const ctx = plane.ctx;
  if (plank.acrossEnd - plank.acrossStart <= 1) return;

  const tone =
    TIMBER_BASE_TONE +
    (elementValue(seed, STREAM_PLANK_TONE, plank.index) - JITTER_MIDPOINT) *
      2 *
      ELEMENT_TONE_JITTER *
      2;
  const hue =
    (elementValue(seed, STREAM_PLANK_HUE, plank.index) - JITTER_MIDPOINT) * 2 * ELEMENT_HUE_JITTER;

  const leading = wanderingEdge(options, plank, plank.acrossStart);
  const trailing = wanderingEdge(options, plank, plank.acrossEnd);

  ctx.beginPath();
  ctx.moveTo(leading[0].x, leading[0].y);
  for (let point = 1; point < leading.length; point++)
    ctx.lineTo(leading[point].x, leading[point].y);
  for (let point = trailing.length - 1; point >= 0; point--) {
    ctx.lineTo(trailing[point].x, trailing[point].y);
  }
  ctx.closePath();
  ctx.fillStyle = rgb(hueShift(sampleRamp(ramp, tone), hue));
  ctx.fill();

  // The edge nearer the light catches it; the far edge falls away into the gap,
  // which is what gives a flat board its thickness.
  ctx.lineWidth = ELEMENT_EDGE_PX;
  ctx.strokeStyle = rgba(sampleRamp(ramp, tone + ELEMENT_TOP_LIGHT), EDGE_LIGHT_ALPHA);
  strokeEdge(ctx, leading);
  ctx.strokeStyle = rgba(sampleRamp(ramp, tone - ELEMENT_BOTTOM_SHADOW), EDGE_SHADOW_ALPHA);
  strokeEdge(ctx, trailing);

  paintPlankGrain(options, plank, tone);
  paintKnot(options, plank, tone);
  paintSplitEnd(options, plank);
}

/**
 * One long edge of a plank, sampled at intervals so it wanders.
 *
 * A ruler-straight plank gap is the loudest tell in procedural boarding, and a
 * per-plank offset does not fix it — that gives a straight line in a slightly
 * different place. The wander has to happen *along* the plank, which is why the
 * edge is a polyline rather than a rectangle side.
 */
function wanderingEdge(
  options: PlankWallOptions,
  plank: Plank,
  across: number,
): ReadonlyArray<Point> {
  const { noise, seed } = options;
  const points: Point[] = [];
  for (
    let along = plank.alongStart;
    along < plank.alongEnd + PLANK_EDGE_STEP_PX;
    along += PLANK_EDGE_STEP_PX
  ) {
    const clamped = Math.min(along, plank.alongEnd);
    const at = toPlane(options, clamped, across);
    const offset = jointWander(
      noise,
      at.x,
      at.y,
      seed,
      PLANK_EDGE_WANDER_PX,
      PLANK_EDGE_WANDER_PERIOD,
    );
    points.push(toPlane(options, clamped, across + offset));
  }
  return points;
}

function strokeEdge(ctx: Plane['ctx'], edge: ReadonlyArray<Point>): void {
  ctx.beginPath();
  ctx.moveTo(edge[0].x, edge[0].y);
  for (let point = 1; point < edge.length; point++) ctx.lineTo(edge[point].x, edge[point].y);
  ctx.stroke();
}

function paintPlankGrain(options: PlankWallOptions, plank: Plank, tone: number): void {
  const ctx = options.plane.ctx;
  const length = plank.alongEnd - plank.alongStart;
  const width = plank.acrossEnd - plank.acrossStart;
  const streakCount = Math.max(1, Math.round((length / options.scale) * PLANK_GRAIN_PER_TILE));

  ctx.strokeStyle = rgba(sampleRamp(options.ramp, tone - PLANK_GRAIN_TONE_DROP), PLANK_GRAIN_ALPHA);
  ctx.lineWidth = ELEMENT_EDGE_PX;
  for (let streak = 0; streak < streakCount; streak++) {
    const key = plank.index * SUB_ELEMENT_STRIDE + streak;
    const across = plank.acrossStart + elementValue(options.seed, STREAM_PLANK_GRAIN, key) * width;
    const start =
      plank.alongStart + elementValue(options.seed, STREAM_PLANK_GRAIN_ALONG, key) * length;
    const streakLength =
      length *
      (PLANK_GRAIN_MIN_LENGTH +
        elementValue(options.seed, STREAM_PLANK_GRAIN_LENGTH, key) * PLANK_GRAIN_LENGTH_SPREAD);
    const end = Math.min(start + streakLength, plank.alongEnd);
    const from = toPlane(options, start, across);
    const to = toPlane(options, end, across);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
}

/** A knot: a dark eye with the lighter ring of grain that flowed round it. */
function paintKnot(options: PlankWallOptions, plank: Plank, tone: number): void {
  if (elementValue(options.seed, STREAM_PLANK_KNOT, plank.index) > KNOT_CHANCE) return;
  const ctx = options.plane.ctx;
  const length = plank.alongEnd - plank.alongStart;
  const along =
    plank.alongStart + elementValue(options.seed, STREAM_PLANK_KNOT_POSITION, plank.index) * length;
  const centre = toPlane(options, along, (plank.acrossStart + plank.acrossEnd) / 2);
  const radius = Math.max(1, options.scale * KNOT_RADIUS_TILES);
  // A knot is an end-grain section of a branch, so it is elongated along the
  // board — a circular one reads as a drilled hole.
  const radii = toPlane(options, radius * KNOT_ASPECT, radius);

  ctx.strokeStyle = rgba(sampleRamp(options.ramp, tone + KNOT_RING_LIFT), KNOT_RING_ALPHA);
  ctx.lineWidth = KNOT_RING_WIDTH_PX;
  ctx.beginPath();
  ctx.ellipse(
    centre.x,
    centre.y,
    radii.x + KNOT_RING_WIDTH_PX,
    radii.y + KNOT_RING_WIDTH_PX,
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();

  ctx.fillStyle = rgb(sampleRamp(options.ramp, tone - KNOT_CORE_DROP));
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, radii.x, radii.y, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A board that has split at one end, running in along the grain. */
function paintSplitEnd(options: PlankWallOptions, plank: Plank): void {
  const chance = elementValue(options.seed, STREAM_PLANK_SPLIT, plank.index);
  if (chance > SPLIT_CHANCE) return;
  const ctx = options.plane.ctx;
  const fromTop = chance < SPLIT_CHANCE / 2;
  const end = fromTop ? plank.alongStart : plank.alongEnd;
  const inward = fromTop ? 1 : -1;
  const length = options.scale * SPLIT_LENGTH_TILES;
  const width = plank.acrossEnd - plank.acrossStart;
  // `chance` has already been narrowed to the split interval by the guard above,
  // so using it directly as a position confines every split to one narrow band
  // of its plank and — for a split running the other way — carries it past the
  // board's own edge and across the gap into its neighbour. Re-spread across the
  // interval first, exactly as `stone.ts` does for its cracks, and clamp so the
  // drift can never leave the plank whichever way the split runs.
  const withinInterval = chance / SPLIT_CHANCE;
  const drift = (withinInterval - JITTER_MIDPOINT) * 2 * SPLIT_DRIFT;
  const acrossFraction = Math.min(
    1 - SPLIT_EDGE_MARGIN,
    Math.max(SPLIT_EDGE_MARGIN, JITTER_MIDPOINT + drift),
  );
  const across = plank.acrossStart + width * acrossFraction;

  const from = toPlane(options, end, across);
  const to = toPlane(
    options,
    end + inward * length,
    across + width * SPLIT_DRIFT * (fromTop ? 1 : -1),
  );
  ctx.strokeStyle = rgba(sampleRamp(options.ramp, SPLIT_TONE), SPLIT_ALPHA);
  ctx.lineWidth = SPLIT_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}
