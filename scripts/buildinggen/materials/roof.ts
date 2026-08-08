/**
 * Roofs: thatch, slate, pantile, split shake, and the temple's dome on a drum.
 *
 * ## The one fact every course in this file depends on
 *
 * `makePlane` maps a quad's top-left corner to plane `(0, 0)` and its bottom-left
 * to plane `(0, height)`. `roofQuad.tl` sits on the ridge and `roofQuad.bl` sits
 * on the eaves, and the hip end's quad is built the same way round. So in plane
 * space **y = 0 is the ridge, y = height is the eaves, and downhill is +y**.
 * Every course position, every lap, every strand direction, which way the sag
 * bows and where the ridge cap goes are all read off that one statement.
 *
 * ## Courses are laid from the eaves upward
 *
 * Water runs downhill, so the course nearer the ridge laps *over* the one below
 * it — which means the lower course must already be on the canvas. Painting
 * ridge-first would put every lap the wrong way round, and it would leave nowhere
 * to drop the shadow each course's lip casts: that shadow lands on pixels the
 * course below has already put down.
 *
 * ## A roof is not a wall with a different ramp
 *
 * A wall is read as a field of individuals; a roof is read as a *stack of lines*.
 * The horizontal rhythm of the laps is the whole silhouette cue, which is why the
 * lip relief here is drawn per course rather than per element, and why the
 * top-to-bottom value gradient is kept small enough that it never competes with
 * it.
 */

import type { CanvasGradient } from 'canvas';
import type { Plane } from '../projection.js';
import { getRamp, hueShift, rgb, rgba, sampleRamp, type RGB, type Ramp } from '../ramps.js';
import { jointWander } from '../texture.js';
import {
  ELEMENT_BOTTOM_SHADOW,
  ELEMENT_EDGE_PX,
  ELEMENT_HUE_JITTER,
  ELEMENT_TONE_JITTER,
  ELEMENT_TOP_LIGHT,
  JOINT_WANDER_PERIOD,
  JOINT_WANDER_PX,
  elementValue,
  type RoofPaintOptions,
} from './kit.js';

/** Streams, so two properties of one course or tile never share a number. */
const STREAM_COURSE_HEIGHT = 21;
const STREAM_COURSE_TONE = 22;
const STREAM_COURSE_BOND = 23;
const STREAM_TILE_TONE = 24;
const STREAM_TILE_HUE = 25;
const STREAM_TILE_WIDTH = 26;
const STREAM_TILE_DEFECT = 27;
const STREAM_SCALLOP_WIDTH = 28;
const STREAM_SCALLOP_DEPTH = 29;
const STREAM_STRAND = 30;
const STREAM_STITCH = 31;

/** Keys two indices into one element stream without either overwriting the other. */
const COURSE_KEY_STRIDE = 1009;

/** Shortest course the layout may emit, in pixels. Below this a course is a line. */
const MIN_COURSE_PX = 3;

/**
 * Peak value lift at the ridge and matching drop at the eaves, in ramp-`t` units.
 *
 * A roof plane faces the sky most directly near its ridge, so it is genuinely
 * brighter up there — but the lap rhythm is the read, and a gradient strong
 * enough to notice on its own turns the courses into a fade.
 */
const SLOPE_TONE_LIFT = 0.07;

/** Moss on a roof grows where the slope stays damp: the upslope third, thinning down. */
const ROOF_MOSS_REACH_FRACTION = 0.42;
const ROOF_MOSS_STRENGTH = 0.34;
const ROOF_MOSS_RAMP_T = 0.42;

/**
 * How much of the ridge's sag survives down at the eaves.
 *
 * The rafters bow but the wall plate holds the eaves line, so the sag is deepest
 * along the ridge and mostly gone by the bottom of the slope. It is not gone
 * *entirely*, because a roof whose courses straighten out perfectly at the eaves
 * reads as a straight roof with a bent stripe drawn on it.
 */
const SAG_AT_EAVES_FRACTION = 0.35;

/** Occlusion is a warm near-black; pure black under a lap reads as a hole in the roof. */
const LAP_SHADOW_COLOR: RGB = [18, 13, 12];

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/**
 * Downward displacement of the roof surface, in pixels, at a point given as
 * fractions across the slope (0 at the left eave corner, 1 at the right) and down
 * it (0 at the ridge, 1 at the eaves).
 *
 * Exported because roof furniture stands *on* this surface: a chimney that seats
 * itself against an unsagged roof floats above a deeply bowed one, and a second
 * copy of the arch in the furniture file is how the two drift apart the first
 * time the curve is tuned.
 */
export function roofSagPx(acrossFraction: number, downhillFraction: number, sagPx: number): number {
  const arch = Math.sin(Math.PI * clamp01(acrossFraction));
  const retained = 1 - (1 - SAG_AT_EAVES_FRACTION) * clamp01(downhillFraction);
  return sagPx * arch * retained;
}

export function paintRoof(options: RoofPaintOptions): void {
  const ctx = options.plane.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, options.plane.width, options.plane.height);
  ctx.clip();

  switch (options.roof.material) {
    case 'thatch':
      paintThatch(options);
      break;
    case 'slate':
      paintSlate(options);
      break;
    case 'clay_tile':
      paintClayTile(options);
      break;
    case 'shake':
      paintShake(options);
      break;
    case 'dome':
      paintDome(options);
      break;
  }

  ctx.restore();
}

// ── shared course layout ───────────────────────────────────────────────────

interface Course {
  readonly index: number;
  /** Plane-space y of the course's top edge, before the sag displaces it. */
  readonly top: number;
  readonly height: number;
}

/**
 * Courses from the ridge down to the eaves, with jittered heights.
 *
 * Returned ridge-first because that is the order the geometry is easiest to
 * reason about; every painter walks the array backwards, for the reason in this
 * file's header.
 */
function layOutCourses(
  options: RoofPaintOptions,
  coursePx: number,
  heightJitter: number,
): ReadonlyArray<Course> {
  const courses: Course[] = [];
  let top = 0;
  let index = 0;
  while (top < options.plane.height) {
    const jitter =
      1 + (elementValue(options.seed, STREAM_COURSE_HEIGHT, index) - 0.5) * 2 * heightJitter;
    const height = Math.max(MIN_COURSE_PX, coursePx * jitter);
    courses.push({ index, top, height });
    top += height;
    index++;
  }
  return courses;
}

/** Plane-space y of a course's top edge at `x`, sag and wander included. */
function courseTopAt(options: RoofPaintOptions, course: Course, x: number): number {
  const sagPx = options.roof.ridgeSagTiles * options.scale;
  const across = options.plane.width === 0 ? 0 : x / options.plane.width;
  const downhill = options.plane.height === 0 ? 0 : course.top / options.plane.height;
  const wander = jointWander(
    options.noise,
    x,
    course.index * COURSE_KEY_STRIDE,
    options.seed,
    JOINT_WANDER_PX,
    JOINT_WANDER_PERIOD,
  );
  return course.top + roofSagPx(across, downhill, sagPx) + wander;
}

/** The subtle ridge-bright, eaves-dark drift, in ramp-`t` units, at plane-space `y`. */
function slopeTone(plane: Plane, y: number): number {
  const downhill = plane.height === 0 ? 0 : clamp01(y / plane.height);
  return SLOPE_TONE_LIFT * (1 - downhill * 2);
}

/** Per-element colour: ramp value plus its own tone and hue jitter. */
function elementColor(
  ramp: Ramp,
  seed: number,
  key: number,
  toneCentre: number,
  toneJitter: number,
): RGB {
  const tone = toneCentre + (elementValue(seed, STREAM_TILE_TONE, key) - 0.5) * 2 * toneJitter;
  const hue = (elementValue(seed, STREAM_TILE_HUE, key) - 0.5) * 2 * ELEMENT_HUE_JITTER;
  return hueShift(sampleRamp(ramp, clamp01(tone)), hue);
}

/**
 * The lit lip of one course and the shadow it drops on the course below.
 *
 * The lip line is the *lower* edge of the course being drawn, which is also the
 * top of the exposed strip of the course beneath it — so this single pass is both
 * the lit top edge the exposed course shows and the occlusion under the lap. It
 * has to run after the course is filled and before the next one up is drawn.
 *
 * The occlusion is stepped rather than a single band because a hard-edged bar of
 * translucent black under a lap is the exact move that makes a roof read flat.
 */
function paintLipRelief(
  plane: Plane,
  lipYAt: (x: number) => number,
  litColor: RGB,
  aoReachPx: number,
  aoDepth: number,
): void {
  const ctx = plane.ctx;
  const steps = Math.max(1, Math.round(aoReachPx));
  for (let x = 0; x < plane.width; x++) {
    const lipY = lipYAt(x);
    ctx.fillStyle = rgba(litColor, ELEMENT_TOP_LIGHT * 2);
    ctx.fillRect(x, lipY - ELEMENT_EDGE_PX, 1, ELEMENT_EDGE_PX);
    for (let step = 0; step < steps; step++) {
      const falloff = 1 - step / steps;
      ctx.fillStyle = rgba(LAP_SHADOW_COLOR, aoDepth * falloff * falloff);
      ctx.fillRect(x, lipY + step, 1, 1);
    }
  }
}

/**
 * Green cast on the courses nearest the ridge, painted as a tint over the
 * finished slope so the material's own value variation still shows through.
 */
function tintUpslopeMoss(options: RoofPaintOptions): void {
  if (!options.roof.mossy) return;
  const ctx = options.plane.ctx;
  const reach = options.plane.height * ROOF_MOSS_REACH_FRACTION;
  const moss = sampleRamp(getRamp('leaf_green'), ROOF_MOSS_RAMP_T);
  const gradient = ctx.createLinearGradient(0, 0, 0, reach);
  const MID_STOP = 0.45;
  const MID_STRENGTH_FRACTION = 0.55;
  gradient.addColorStop(0, rgba(moss, ROOF_MOSS_STRENGTH));
  gradient.addColorStop(MID_STOP, rgba(moss, ROOF_MOSS_STRENGTH * MID_STRENGTH_FRACTION));
  gradient.addColorStop(1, rgba(moss, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, options.plane.width, reach);
  ctx.restore();
}

// ── thatch ─────────────────────────────────────────────────────────────────

/** Course pitch and how far a course hangs past its own band, in tiles. */
const THATCH_COURSE_TILES = 0.34;
const THATCH_COURSE_HEIGHT_JITTER = 0.2;
const THATCH_LAP_FRACTION = 0.9;

/** The shallow arcs the lower edge of a bundle is combed into. */
const THATCH_SCALLOP_TILES = 0.19;
const THATCH_SCALLOP_WIDTH_JITTER = 0.5;
const THATCH_SCALLOP_DEPTH_TILES = 0.055;
const THATCH_SCALLOP_DEPTH_JITTER = 0.6;
/** Worn thatch combs out ragged: disrepair deepens the arcs rather than adding holes. */
const THATCH_DISREPAIR_RAGGEDNESS = 1.4;

/** Near-vertical straws inside a course. */
const THATCH_STRAND_SPACING_PX = 1.4;
const THATCH_STRAND_TONE_JITTER = 0.42;
const THATCH_STRAND_DRIFT_PX = 1.5;
const THATCH_STRAND_ALPHA = 0.9;

/** The shadow under a bundle's lip is the deepest occlusion on a thatched roof. */
const THATCH_LIP_AO_TILES = 0.1;
const THATCH_LIP_AO_DEPTH = 0.78;

/** Thatch sits on a dark, airless underside wherever a lip does not cover it. */
const THATCH_UNDERSIDE_T = 0.1;

/** Re-thatched patches sit a shade greyer than the field around them. */
const THATCH_PATCH_TONE_DROP = 0.2;
const THATCH_PATCH_RATE = 0.55;

/** The rolled roll along the ridge, and the ties combed across it. */
/**
 * The roll's depth, measured *down* from the ridge line.
 *
 * A real roll stands proud of the ridge, but the ridge line is this plane's own
 * top edge and there is no canvas above it — a cap drawn above y = 0 is a cap
 * that is not in the bake. It sits in the top band instead, which is where it
 * lands on screen anyway once the plane is warped.
 */
const THATCH_ROLL_DEPTH_TILES = 0.24;
const THATCH_STITCH_SPACING_TILES = 0.23;
const THATCH_STITCH_LENGTH_TILES = 0.19;
const THATCH_STITCH_ALPHA = 0.55;
const THATCH_STITCH_WIDTH_PX = 1;
/** Ramp value the roll is bulked out at, before its own cylinder shading. */
const THATCH_ROLL_BASE_T = 0.5;
/** How far along its own spacing a tie may wander, as a fraction. */
const THATCH_STITCH_PHASE_JITTER = 0.5;

function paintThatch(options: RoofPaintOptions): void {
  const { plane } = options;
  const ctx = plane.ctx;
  const ramp = getRamp(options.roof.ramp);
  const disrepair = clamp01(options.roof.disrepair);

  // The underside is laid first and the bundles are drawn over it, so any pixel
  // no lip reaches is the dark of the layer behind rather than a hole.
  ctx.fillStyle = rgb(sampleRamp(ramp, THATCH_UNDERSIDE_T));
  ctx.fillRect(0, 0, plane.width, plane.height);

  const coursePx = THATCH_COURSE_TILES * options.scale;
  const courses = layOutCourses(options, coursePx, THATCH_COURSE_HEIGHT_JITTER);

  for (let i = courses.length - 1; i >= 0; i--) {
    const course = courses[i];
    const lipEdge = thatchScallopedEdge(options, course, disrepair);
    paintThatchCourse(options, course, lipEdge, ramp, disrepair);
    paintLipRelief(
      plane,
      (x) => lipEdge[Math.min(lipEdge.length - 1, Math.max(0, x))],
      sampleRamp(ramp, clamp01(0.5 + slopeTone(plane, course.top) + ELEMENT_TOP_LIGHT)),
      THATCH_LIP_AO_TILES * options.scale,
      THATCH_LIP_AO_DEPTH,
    );
  }

  tintUpslopeMoss(options);

  if (!options.isReturn) {
    paintThatchRidgeRoll(options);
  }
}

/**
 * The lower edge of one bundle, as a plane-space y per integer x.
 *
 * A run of shallow arcs whose widths and depths are drawn per scallop, plus the
 * shared wander field on top, so no two scallops on the roof match and no course
 * edge is ever a ruler line.
 */
function thatchScallopedEdge(
  options: RoofPaintOptions,
  course: Course,
  disrepair: number,
): ReadonlyArray<number> {
  const { plane, seed } = options;
  const baseY = course.top + course.height * (1 + THATCH_LAP_FRACTION);
  const bandBottom: Course = { index: course.index, top: baseY, height: course.height };
  const scallopPx = THATCH_SCALLOP_TILES * options.scale;
  const depthPx =
    THATCH_SCALLOP_DEPTH_TILES * options.scale * (1 + disrepair * THATCH_DISREPAIR_RAGGEDNESS);

  // Filled with the flat band position first: the scallop walk lands on integer
  // pixels and a rounding step that skips one would otherwise leave a hole in the
  // path, which fills as a spike all the way to the eaves.
  const edge = new Array<number>(plane.width + 1).fill(baseY);
  let start = 0;
  let scallop = 0;
  while (start < plane.width) {
    const key = course.index * COURSE_KEY_STRIDE + scallop;
    const width =
      scallopPx *
      (1 + (elementValue(seed, STREAM_SCALLOP_WIDTH, key) - 0.5) * 2 * THATCH_SCALLOP_WIDTH_JITTER);
    const depth =
      depthPx *
      (1 + (elementValue(seed, STREAM_SCALLOP_DEPTH, key) - 0.5) * 2 * THATCH_SCALLOP_DEPTH_JITTER);
    const end = start + Math.max(MIN_COURSE_PX, width);
    for (let x = Math.floor(start); x <= Math.min(plane.width, Math.ceil(end)); x++) {
      const local = clamp01((x - start) / Math.max(1, end - start));
      edge[x] = courseTopAt(options, bandBottom, x) + depth * Math.sin(Math.PI * local);
    }
    start = end;
    scallop++;
  }
  return edge;
}

function paintThatchCourse(
  options: RoofPaintOptions,
  course: Course,
  lipEdge: ReadonlyArray<number>,
  ramp: Ramp,
  disrepair: number,
): void {
  const { plane, seed } = options;
  const ctx = plane.ctx;

  const patched =
    elementValue(seed, STREAM_COURSE_TONE, course.index) < disrepair * THATCH_PATCH_RATE;
  const courseTone =
    0.5 +
    slopeTone(plane, course.top) +
    (elementValue(seed, STREAM_COURSE_TONE, course.index + plane.width) - 0.5) *
      2 *
      ELEMENT_TONE_JITTER -
    (patched ? THATCH_PATCH_TONE_DROP : 0);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, courseTopAt(options, course, 0));
  for (let x = 1; x <= plane.width; x++) {
    ctx.lineTo(x, courseTopAt(options, course, x));
  }
  for (let x = plane.width; x >= 0; x--) {
    ctx.lineTo(x, lipEdge[x]);
  }
  ctx.closePath();
  ctx.fillStyle = rgb(sampleRamp(ramp, clamp01(courseTone)));
  ctx.fill();
  ctx.clip();

  paintThatchStrands(options, course, ramp, courseTone);
  ctx.restore();
}

/**
 * The straws themselves: one-pixel streaks running downhill at high frequency.
 *
 * They drift a pixel or so across their length rather than falling plumb, because
 * a column of pixels at a fixed x is a scratch and a whole course of them is a
 * comb.
 */
function paintThatchStrands(
  options: RoofPaintOptions,
  course: Course,
  ramp: Ramp,
  courseTone: number,
): void {
  const { plane, seed } = options;
  const ctx = plane.ctx;
  const top = course.top;
  const bottom = course.top + course.height * (1 + THATCH_LAP_FRACTION) + course.height;
  const strandCount = Math.max(1, Math.round(plane.width / THATCH_STRAND_SPACING_PX));

  ctx.lineWidth = ELEMENT_EDGE_PX;
  for (let strand = 0; strand < strandCount; strand++) {
    const key = course.index * COURSE_KEY_STRIDE + strand;
    const value = elementValue(seed, STREAM_STRAND, key);
    const x = (strand + value) * THATCH_STRAND_SPACING_PX;
    const drift = (value - 0.5) * 2 * THATCH_STRAND_DRIFT_PX;
    const tone = courseTone + (value - 0.5) * 2 * THATCH_STRAND_TONE_JITTER;
    ctx.strokeStyle = rgba(sampleRamp(ramp, clamp01(tone)), THATCH_STRAND_ALPHA);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + drift, bottom);
    ctx.stroke();
  }
}

/**
 * The rolled ridge: a fat sausage of thatch laid over the apex and pegged down
 * with crossed ties.
 *
 * The ties alternate direction along the ridge. A run of parallel diagonals reads
 * as hatching; alternating them reads as the cross-stitch a thatcher actually
 * combs in, and it is the detail that says "thatch" from across the plaza.
 */
function paintThatchRidgeRoll(options: RoofPaintOptions): void {
  const { plane, seed } = options;
  const ctx = plane.ctx;
  const ridgeRamp = getRamp(options.roof.ridgeRamp);
  const sagPx = options.roof.ridgeSagTiles * options.scale;
  const depth = THATCH_ROLL_DEPTH_TILES * options.scale;
  const rollTopAt = (x: number): number =>
    roofSagPx(plane.width === 0 ? 0 : x / plane.width, 0, sagPx);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, rollTopAt(0));
  for (let x = 1; x <= plane.width; x++) ctx.lineTo(x, rollTopAt(x));
  for (let x = plane.width; x >= 0; x--) ctx.lineTo(x, rollTopAt(x) + depth);
  ctx.closePath();
  ctx.fillStyle = rgb(sampleRamp(ridgeRamp, THATCH_ROLL_BASE_T));
  ctx.fill();
  ctx.clip();

  // The roll is a cylinder: lit along its crown, losing the sun toward the lower
  // edge where it meets the first course.
  const shading = ctx.createLinearGradient(0, 0, 0, depth);
  const CROWN_STOP = 0.3;
  gradientStops(shading, ridgeRamp, CROWN_STOP);
  ctx.fillStyle = shading;
  ctx.fillRect(0, 0, plane.width, depth);

  const spacing = THATCH_STITCH_SPACING_TILES * options.scale;
  const length = THATCH_STITCH_LENGTH_TILES * options.scale;
  const stitchCount = Math.max(1, Math.round(plane.width / spacing));
  ctx.lineWidth = THATCH_STITCH_WIDTH_PX;
  ctx.strokeStyle = rgba(sampleRamp(ridgeRamp, 0), THATCH_STITCH_ALPHA);
  for (let stitch = 0; stitch < stitchCount; stitch++) {
    const jitter = elementValue(seed, STREAM_STITCH, stitch);
    const x = (stitch + jitter * THATCH_STITCH_PHASE_JITTER) * spacing;
    const lean = stitch % 2 === 0 ? length : -length;
    const top = rollTopAt(x);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + lean, top + depth);
    ctx.stroke();
  }
  ctx.restore();
}

/** Crown-lit, base-shadowed stops for anything that has to read as a cylinder. */
function gradientStops(gradient: CanvasGradient, ramp: Ramp, crownStop: number): void {
  const CROWN_T = 0.9;
  const MID_T = 0.55;
  const MID_STOP = 0.62;
  const BASE_T = 0.12;
  const CROWN_ALPHA = 0.5;
  const MID_ALPHA = 0.18;
  const BASE_ALPHA = 0.55;
  gradient.addColorStop(0, rgba(sampleRamp(ramp, MID_T), MID_ALPHA));
  gradient.addColorStop(crownStop, rgba(sampleRamp(ramp, CROWN_T), CROWN_ALPHA));
  gradient.addColorStop(MID_STOP, rgba(sampleRamp(ramp, MID_T), MID_ALPHA));
  gradient.addColorStop(1, rgba(sampleRamp(ramp, BASE_T), BASE_ALPHA));
}

// ── coursed tiles: slate, pantile and shake share a skeleton ───────────────

interface TileCourseStyle {
  readonly coursePx: number;
  readonly tileWidthPx: number;
  readonly courseHeightJitter: number;
  readonly tileWidthJitter: number;
  /** How far a course hangs past its own band onto the one below, as a fraction. */
  readonly lapFraction: number;
  /** Stagger between adjacent courses. Zero for pantiles, which run in columns. */
  readonly bondJitter: number;
  /** Per-tile defect rates, before `disrepair` scales them. */
  readonly slipRate: number;
  readonly missingRate: number;
  readonly splitRate: number;
  readonly slipRadians: number;
  readonly lipAoTiles: number;
  readonly lipAoDepth: number;
  /** Hue bias of the whole field, in degrees. Shakes lean warm against slate. */
  readonly hueBias: number;
}

/** Whatever no tile covers is the batten gap behind the roof, not a hole. */
const TILE_UNDERSIDE_T = 0.08;

/** A tile is drawn a hair wider than its pitch so antialiasing leaves no seam. */
const TILE_OVERDRAW_PX = 0.6;

function paintTileCourses(options: RoofPaintOptions, style: TileCourseStyle): void {
  const { plane } = options;
  const ctx = plane.ctx;
  const ramp = getRamp(options.roof.ramp);
  const disrepair = clamp01(options.roof.disrepair);

  ctx.fillStyle = rgb(sampleRamp(ramp, TILE_UNDERSIDE_T));
  ctx.fillRect(0, 0, plane.width, plane.height);

  const courses = layOutCourses(options, style.coursePx, style.courseHeightJitter);
  for (let i = courses.length - 1; i >= 0; i--) {
    const course = courses[i];
    paintTileCourse(options, style, course, ramp, disrepair);
    const lapBand: Course = {
      index: course.index,
      top: course.top + course.height * (1 + style.lapFraction),
      height: course.height,
    };
    paintLipRelief(
      plane,
      (x) => courseTopAt(options, lapBand, x),
      sampleRamp(ramp, clamp01(0.5 + slopeTone(plane, course.top) + ELEMENT_TOP_LIGHT * 2)),
      style.lipAoTiles * options.scale,
      style.lipAoDepth,
    );
  }

  tintUpslopeMoss(options);
}

function paintTileCourse(
  options: RoofPaintOptions,
  style: TileCourseStyle,
  course: Course,
  ramp: Ramp,
  disrepair: number,
): void {
  const { plane, seed } = options;
  const ctx = plane.ctx;
  const bond =
    elementValue(seed, STREAM_COURSE_BOND, course.index) * style.tileWidthPx * style.bondJitter;
  const bottom = course.top + course.height * (1 + style.lapFraction);
  const slipChance = style.slipRate * disrepair;
  const missingChance = style.missingRate * disrepair;
  // Scaled by disrepair like the other two. It was used raw, against its own
  // field's documentation, so a well-kept shake roof split as often as a ruin.
  const splitChance = style.splitRate * disrepair;

  let x = -bond;
  let tileIndex = 0;
  while (x < plane.width) {
    const key = course.index * COURSE_KEY_STRIDE + tileIndex;
    const widthJitter =
      1 + (elementValue(seed, STREAM_TILE_WIDTH, key) - 0.5) * 2 * style.tileWidthJitter;
    const width = Math.max(MIN_COURSE_PX, style.tileWidthPx * widthJitter);
    const defect = elementValue(seed, STREAM_TILE_DEFECT, key);

    if (defect >= missingChance) {
      const centreX = x + width / 2;
      const top = courseTopAt(options, course, centreX);
      const tone = 0.5 + slopeTone(plane, course.top);
      const color = hueShift(
        elementColor(ramp, seed, key, tone, ELEMENT_TONE_JITTER * 2),
        style.hueBias,
      );
      // The three defect classes have to be disjoint intervals over `defect`.
      // The split test used to read `defect < missing + slip + splitRate`, which
      // *contains* the slip interval — so with `splitRate: 0` (slate and clay
      // tile) it collapsed to exactly the slip condition, and every slipped tile
      // on those roofs also opened a riven-timber crack down its face.
      const slipped = defect < missingChance + slipChance;
      const splitFloor = missingChance + slipChance;
      const split = defect >= splitFloor && defect < splitFloor + splitChance;
      const tilt = slipped
        ? (elementValue(seed, STREAM_TILE_TONE, key + plane.width) - 0.5) * 2 * style.slipRadians
        : 0;

      ctx.save();
      ctx.translate(centreX, top);
      ctx.rotate(tilt);
      ctx.fillStyle = rgb(color);
      ctx.fillRect(
        -width / 2 - TILE_OVERDRAW_PX,
        0,
        width + TILE_OVERDRAW_PX * 2,
        bottom - courseTopAt(options, course, centreX),
      );
      if (split) {
        paintShakeSplit(options, ramp, key, width, bottom - top);
      }
      ctx.restore();
    }

    x += width;
    tileIndex++;
  }
}

/** The split a drying shake opens down part of its length. */
const SHAKE_SPLIT_LENGTH_FRACTION = 0.72;
const SHAKE_SPLIT_ALPHA = 0.5;

function paintShakeSplit(
  options: RoofPaintOptions,
  ramp: Ramp,
  key: number,
  width: number,
  length: number,
): void {
  const ctx = options.plane.ctx;
  const offset = (elementValue(options.seed, STREAM_TILE_HUE, key + 1) - 0.5) * width;
  ctx.strokeStyle = rgba(sampleRamp(ramp, 0), SHAKE_SPLIT_ALPHA);
  ctx.lineWidth = ELEMENT_EDGE_PX;
  ctx.beginPath();
  ctx.moveTo(offset, 0);
  ctx.lineTo(offset, length * SHAKE_SPLIT_LENGTH_FRACTION);
  ctx.stroke();
}

// ── slate ──────────────────────────────────────────────────────────────────

const SLATE_COURSE_TILES = 0.16;
const SLATE_TILE_WIDTH_TILES = 0.22;
const SLATE_COURSE_HEIGHT_JITTER = 0.09;
const SLATE_TILE_WIDTH_JITTER = 0.16;
const SLATE_LAP_FRACTION = 0.55;
const SLATE_BOND_JITTER = 0.9;
const SLATE_SLIP_RATE = 0.22;
const SLATE_MISSING_RATE = 0.09;
const SLATE_SLIP_RADIANS = 0.09;
const SLATE_LIP_AO_TILES = 0.06;
const SLATE_LIP_AO_DEPTH = 0.55;

function paintSlate(options: RoofPaintOptions): void {
  paintTileCourses(options, {
    coursePx: SLATE_COURSE_TILES * options.scale,
    tileWidthPx: SLATE_TILE_WIDTH_TILES * options.scale,
    courseHeightJitter: SLATE_COURSE_HEIGHT_JITTER,
    tileWidthJitter: SLATE_TILE_WIDTH_JITTER,
    lapFraction: SLATE_LAP_FRACTION,
    bondJitter: SLATE_BOND_JITTER,
    slipRate: SLATE_SLIP_RATE,
    missingRate: SLATE_MISSING_RATE,
    splitRate: 0,
    slipRadians: SLATE_SLIP_RADIANS,
    lipAoTiles: SLATE_LIP_AO_TILES,
    lipAoDepth: SLATE_LIP_AO_DEPTH,
    hueBias: 0,
  });
  if (!options.isReturn) {
    paintHalfRoundRidge(options);
  }
}

// ── clay pantile ───────────────────────────────────────────────────────────

const CLAY_COURSE_TILES = 0.18;
const CLAY_TILE_WIDTH_TILES = 0.2;
const CLAY_COURSE_HEIGHT_JITTER = 0.08;
const CLAY_TILE_WIDTH_JITTER = 0.1;
const CLAY_LAP_FRACTION = 0.5;
const CLAY_SLIP_RATE = 0.16;
const CLAY_MISSING_RATE = 0.07;
const CLAY_SLIP_RADIANS = 0.07;
const CLAY_LIP_AO_TILES = 0.065;
const CLAY_LIP_AO_DEPTH = 0.58;

/** The S-section: a lit crown down the middle of each column, a valley at its edge. */
const CLAY_CROWN_WIDTH_FRACTION = 0.42;
const CLAY_CROWN_ALPHA = 0.3;
const CLAY_VALLEY_WIDTH_FRACTION = 0.26;
const CLAY_VALLEY_ALPHA = 0.34;
/** Both section gradients peak on their own centre line. */
const CLAY_SECTION_PEAK_STOP = 0.5;

function paintClayTile(options: RoofPaintOptions): void {
  paintTileCourses(options, {
    coursePx: CLAY_COURSE_TILES * options.scale,
    tileWidthPx: CLAY_TILE_WIDTH_TILES * options.scale,
    courseHeightJitter: CLAY_COURSE_HEIGHT_JITTER,
    tileWidthJitter: CLAY_TILE_WIDTH_JITTER,
    lapFraction: CLAY_LAP_FRACTION,
    // Pantiles interlock down their own columns, so there is no stagger to give
    // them; the crown and valley below only read if they run unbroken downhill.
    bondJitter: 0,
    slipRate: CLAY_SLIP_RATE,
    missingRate: CLAY_MISSING_RATE,
    splitRate: 0,
    slipRadians: CLAY_SLIP_RADIANS,
    lipAoTiles: CLAY_LIP_AO_TILES,
    lipAoDepth: CLAY_LIP_AO_DEPTH,
    hueBias: 0,
  });
  paintPantileSection(options);
  if (!options.isReturn) {
    paintHalfRoundRidge(options);
  }
}

function paintPantileSection(options: RoofPaintOptions): void {
  const { plane } = options;
  const ctx = plane.ctx;
  const ramp = getRamp(options.roof.ramp);
  const columnPx = CLAY_TILE_WIDTH_TILES * options.scale;
  const crown = columnPx * CLAY_CROWN_WIDTH_FRACTION;
  const valley = columnPx * CLAY_VALLEY_WIDTH_FRACTION;
  const columns = Math.ceil(plane.width / columnPx) + 1;

  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  for (let column = 0; column < columns; column++) {
    const left = column * columnPx;
    const crownX = left + columnPx / 2 - crown / 2;
    const crownGradient = ctx.createLinearGradient(crownX, 0, crownX + crown, 0);
    crownGradient.addColorStop(0, rgba(sampleRamp(ramp, 1), 0));
    crownGradient.addColorStop(CLAY_SECTION_PEAK_STOP, rgba(sampleRamp(ramp, 1), CLAY_CROWN_ALPHA));
    crownGradient.addColorStop(1, rgba(sampleRamp(ramp, 1), 0));
    ctx.fillStyle = crownGradient;
    ctx.fillRect(crownX, 0, crown, plane.height);

    const valleyX = left - valley / 2;
    const valleyGradient = ctx.createLinearGradient(valleyX, 0, valleyX + valley, 0);
    valleyGradient.addColorStop(0, rgba(sampleRamp(ramp, 0), 0));
    valleyGradient.addColorStop(
      CLAY_SECTION_PEAK_STOP,
      rgba(sampleRamp(ramp, 0), CLAY_VALLEY_ALPHA),
    );
    valleyGradient.addColorStop(1, rgba(sampleRamp(ramp, 0), 0));
    ctx.fillStyle = valleyGradient;
    ctx.fillRect(valleyX, 0, valley, plane.height);
  }
  ctx.restore();
}

// ── split shake ────────────────────────────────────────────────────────────

const SHAKE_COURSE_TILES = 0.2;
const SHAKE_TILE_WIDTH_TILES = 0.26;
const SHAKE_COURSE_HEIGHT_JITTER = 0.16;
/** A shake is riven, not sawn: its width is the roughest of any tile here. */
const SHAKE_TILE_WIDTH_JITTER = 0.5;
const SHAKE_LAP_FRACTION = 0.6;
const SHAKE_BOND_JITTER = 1;
const SHAKE_SLIP_RATE = 0.18;
const SHAKE_MISSING_RATE = 0.05;
const SHAKE_SPLIT_RATE = 0.3;
const SHAKE_SLIP_RADIANS = 0.06;
const SHAKE_LIP_AO_TILES = 0.075;
const SHAKE_LIP_AO_DEPTH = 0.6;
/** Weathered timber runs warmer than the grey it starts as. */
const SHAKE_HUE_BIAS = 4;

function paintShake(options: RoofPaintOptions): void {
  paintTileCourses(options, {
    coursePx: SHAKE_COURSE_TILES * options.scale,
    tileWidthPx: SHAKE_TILE_WIDTH_TILES * options.scale,
    courseHeightJitter: SHAKE_COURSE_HEIGHT_JITTER,
    tileWidthJitter: SHAKE_TILE_WIDTH_JITTER,
    lapFraction: SHAKE_LAP_FRACTION,
    bondJitter: SHAKE_BOND_JITTER,
    slipRate: SHAKE_SLIP_RATE,
    missingRate: SHAKE_MISSING_RATE,
    splitRate: SHAKE_SPLIT_RATE,
    slipRadians: SHAKE_SLIP_RADIANS,
    lipAoTiles: SHAKE_LIP_AO_TILES,
    lipAoDepth: SHAKE_LIP_AO_DEPTH,
    hueBias: SHAKE_HUE_BIAS,
  });
  if (!options.isReturn) {
    paintShakeRidgeBoards(options);
  }
}

/** A shake roof is capped with two boards leaned against each other, not with caps. */
const SHAKE_RIDGE_DEPTH_TILES = 0.16;
const SHAKE_RIDGE_BASE_T = 0.44;

function paintShakeRidgeBoards(options: RoofPaintOptions): void {
  const { plane } = options;
  const ctx = plane.ctx;
  const ridgeRamp = getRamp(options.roof.ridgeRamp);
  const sagPx = options.roof.ridgeSagTiles * options.scale;
  const depth = SHAKE_RIDGE_DEPTH_TILES * options.scale;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, boardTopAt(plane, 0, sagPx));
  for (let x = 1; x <= plane.width; x++) ctx.lineTo(x, boardTopAt(plane, x, sagPx));
  for (let x = plane.width; x >= 0; x--) ctx.lineTo(x, boardTopAt(plane, x, sagPx) + depth);
  ctx.closePath();
  ctx.fillStyle = rgb(sampleRamp(ridgeRamp, SHAKE_RIDGE_BASE_T));
  ctx.fill();
  ctx.clip();
  const shading = ctx.createLinearGradient(0, 0, 0, depth);
  const BOARD_CROWN_STOP = 0.22;
  gradientStops(shading, ridgeRamp, BOARD_CROWN_STOP);
  ctx.fillStyle = shading;
  ctx.fillRect(0, 0, plane.width, depth);
  ctx.restore();
}

function boardTopAt(plane: Plane, x: number, sagPx: number): number {
  return roofSagPx(plane.width === 0 ? 0 : x / plane.width, 0, sagPx);
}

// ── the half-round ridge slate and clay are capped with ────────────────────

const RIDGE_CAP_WIDTH_TILES = 0.24;
const RIDGE_CAP_HEIGHT_TILES = 0.13;
const RIDGE_CAP_LAP_FRACTION = 0.22;
const RIDGE_CAP_TONE_JITTER = 0.12;

function paintHalfRoundRidge(options: RoofPaintOptions): void {
  const { plane, seed } = options;
  const ctx = plane.ctx;
  const ridgeRamp = getRamp(options.roof.ridgeRamp);
  const sagPx = options.roof.ridgeSagTiles * options.scale;
  const capWidth = RIDGE_CAP_WIDTH_TILES * options.scale;
  const capHeight = RIDGE_CAP_HEIGHT_TILES * options.scale;
  const pitch = capWidth * (1 - RIDGE_CAP_LAP_FRACTION);
  const capCount = Math.ceil(plane.width / pitch) + 1;

  for (let cap = 0; cap < capCount; cap++) {
    const left = cap * pitch;
    const centreX = left + capWidth / 2;
    const top = boardTopAt(plane, centreX, sagPx);
    const tone =
      0.5 + (elementValue(seed, STREAM_TILE_TONE, cap) - 0.5) * 2 * RIDGE_CAP_TONE_JITTER;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(centreX, top + capHeight, capWidth / 2, capHeight, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = rgb(sampleRamp(ridgeRamp, clamp01(tone)));
    ctx.fill();
    ctx.clip();
    const shading = ctx.createLinearGradient(0, top, 0, top + capHeight);
    const CAP_CROWN_STOP = 0.3;
    gradientStops(shading, ridgeRamp, CAP_CROWN_STOP);
    ctx.fillStyle = shading;
    ctx.fillRect(left, top, capWidth, capHeight);
    ctx.restore();
  }
}

// ── the temple: a parapet, a drum, and the dome that rises from it ─────────

/**
 * A dome is *not* the roof plane.
 *
 * Filling the plane with one half-ellipse paints an igloo: a hemisphere the full
 * width of the building, sitting straight on the stone box with nothing between
 * them. What reads as a temple is three separate objects — a stone parapet across
 * the whole front, a cylindrical drum standing behind it, and a dome on top of
 * the drum that is clearly narrower than the building. The drum is the part doing
 * the work: without a visible cylinder under it, a dome is a bubble.
 *
 * Everything above the parapet and outside the dome is left transparent, so the
 * silhouette pass inks the dome's own curve against the sky.
 */

/**
 * The stone the parapet, the drum and the cornices are cut from.
 *
 * A `RoofSpec` states one field colour and one ridge colour, and this material
 * needs a third. It is named here rather than authored per building because the
 * dome is the temple's alone, and it is the temple's own facade stone — which is
 * what keeps the palette gate, which measures rendered pixels against the ramps a
 * spec names, able to account for these pixels.
 */
const DOME_STONE_RAMP_ID = 'pale_ashlar';

/**
 * Where the sun sits on the dome, in the dome's own radii: left of its axis and
 * high up its face, matching the one sun the whole town is lit by.
 */
const DOME_HIGHLIGHT_ACROSS = -0.36;
const DOME_HIGHLIGHT_UP = 0.52;

/**
 * The falloff stops, as (radius fraction, ramp `t`) pairs.
 *
 * Deliberately non-linear: a hemisphere holds most of its value across the middle
 * and then loses it fast at the limb, where the surface turns away from the
 * viewer through ninety degrees in a handful of pixels. A linear ramp over the
 * same span paints a cone.
 */
const DOME_CORE_STOP = 0.16;
const DOME_CORE_T = 1;
const DOME_BODY_STOP = 0.5;
const DOME_BODY_T = 0.66;
const DOME_TERMINATOR_STOP = 0.78;
const DOME_TERMINATOR_T = 0.28;
const DOME_LIMB_T = 0.02;
/**
 * Reach of the falloff, against the dome's own radius.
 *
 * Measured off the dome rather than off the plane's diagonal: a gradient whose
 * outer stop is further away than the object itself spends its whole range
 * inside the bright end and paints a flat disc with a rim.
 */
const DOME_FALLOFF_REACH = 1.15;

/** Meridians, and how much darker their shadowed side runs. */
const DOME_RIB_COUNT = 11;
const DOME_RIB_ALPHA = 0.5;
const DOME_RIB_LIGHT_ALPHA = 0.34;
const DOME_RIB_WIDTH_PX = 1.5;
const DOME_RIB_LIGHT_OFFSET_PX = 1;

/** The finial: a ball on a spike, standing on the apex. */
const DOME_FINIAL_HEIGHT_TILES = 0.34;
const DOME_FINIAL_BALL_TILES = 0.1;
const DOME_FINIAL_SPIKE_WIDTH_TILES = 0.055;
const DOME_FINIAL_SPIKE_T = 0.7;
const DOME_FINIAL_BALL_T = 0.55;

/**
 * How much of the plane's width the dome spans.
 *
 * Well under the whole plane on purpose: a dome as wide as the building it stands
 * on has no building left to stand on, which is the entire difference between a
 * temple and a snow globe.
 */
const DOME_WIDTH_FRACTION = 0.55;

/** The dome's height against its own half-width. Under one: a shallow saucer dome. */
const DOME_RADIUS_ASPECT = 0.85;

/** The parapet across the front, and the cornice projecting from its foot. */
const PARAPET_HEIGHT_TILES = 0.38;
const PARAPET_BLOCK_TILES = 0.62;
const PARAPET_BLOCK_WIDTH_JITTER = 0.22;
const PARAPET_JOINT_PX = 1;
const PARAPET_BODY_T = 0.62;
const PARAPET_CORNICE_HEIGHT_TILES = 0.13;
const PARAPET_CORNICE_T = 0.44;
const PARAPET_CORNICE_AO_ALPHA = 0.45;
const PARAPET_COPING_LIGHT_PX = 2;
const PARAPET_COPING_LIGHT_ALPHA = 0.6;

/** The gilt string course along the coping, in the roof's own ridge colour. */
const PARAPET_TRIM_HEIGHT_TILES = 0.055;
const PARAPET_TRIM_T = 0.72;
const PARAPET_TRIM_ALPHA = 0.9;

/**
 * The drum: the cylinder the dome springs from, and the ribs that state it.
 *
 * It stands *behind* the parapet, so it is authored a good deal darker than the
 * parapet is — at equal value the two masses merge into one grey band and the
 * dome is back to sitting on the building.
 */
const DRUM_HEIGHT_TILES = 0.55;
/**
 * The drum's width against the dome's.
 *
 * Narrow enough that sky shows between the drum's sides and the dome's limbs.
 * That pair of notches is the single cheapest thing that separates a dome on a
 * building from a dome *behind* a parapet, and it does more work than any amount
 * of shading on the cylinder itself.
 */
const DRUM_WIDTH_FACTOR = 0.78;
const DRUM_BODY_T = 0.42;
const DRUM_LIT_STOP = 0.28;
const DRUM_MID_STOP = 0.6;
const DRUM_LIT_ALPHA = 0.55;
const DRUM_NEAR_EDGE_ALPHA = 0.5;
const DRUM_FAR_EDGE_ALPHA = 0.72;
const DRUM_PILASTER_COUNT = 7;
const DRUM_PILASTER_WIDTH_PX = 3;
const DRUM_PILASTER_ALPHA = 0.66;
const DRUM_PILASTER_LIGHT_ALPHA = 0.5;

/** The cornice at the springing line, where the drum hands over to the dome. */
const DRUM_CORNICE_HEIGHT_TILES = 0.1;
const DRUM_CORNICE_T = 0.58;
const DRUM_CORNICE_LIGHT_ALPHA = 0.55;
const DRUM_CORNICE_AO_ALPHA = 0.62;
const DRUM_CORNICE_AO_PX = 3;

interface DomeGeometry {
  readonly centreX: number;
  readonly radiusX: number;
  readonly radiusY: number;
  /** Plane y of the springing line: the dome's base and the drum's top. */
  readonly springY: number;
  readonly apexY: number;
  readonly drumHalfWidth: number;
  /** Plane y the parapet's masonry starts at, which is what hides the drum's foot. */
  readonly parapetTopY: number;
}

function domeGeometry(options: RoofPaintOptions): DomeGeometry {
  const { plane } = options;
  const parapetTopY = plane.height - PARAPET_HEIGHT_TILES * options.scale;
  const springY = parapetTopY - DRUM_HEIGHT_TILES * options.scale;
  const radiusX = (plane.width * DOME_WIDTH_FRACTION) / 2;
  const finialHeight = DOME_FINIAL_HEIGHT_TILES * options.scale;
  // The dome takes the height its own proportion asks for unless that would push
  // the finial off the top of the plane: there is no canvas above y = 0, and a
  // spike drawn there is a spike that is not in the bake.
  const tallestThatFits = springY - finialHeight;
  const radiusY = Math.max(MIN_COURSE_PX, Math.min(radiusX * DOME_RADIUS_ASPECT, tallestThatFits));
  return {
    centreX: plane.width / 2,
    radiusX,
    radiusY,
    springY,
    apexY: springY - radiusY,
    drumHalfWidth: radiusX * DRUM_WIDTH_FACTOR,
    parapetTopY,
  };
}

function paintDome(options: RoofPaintOptions): void {
  // The hip end of a dome is not a second dome. Painting the ellipse again on the
  // return plane grows a blue fin off the building's right shoulder; the dome is
  // one object standing behind the front parapet, and all the hip end owns is the
  // parapet carrying on round the corner.
  if (!options.isReturn) {
    const geometry = domeGeometry(options);
    paintDrum(options, geometry);
    paintDomeShell(options, geometry);
    paintSpringingCornice(options, geometry);
    paintDomeFinial(options, geometry);
  }
  // Last, so it occludes the drum's foot: the drum stands *behind* the parapet.
  paintParapet(options);
}

/**
 * The stone parapet across the whole width of the plane.
 *
 * Blocks over a joint-coloured ground, so every gap between two of them is mortar
 * by construction rather than by rounding.
 */
function paintParapet(options: RoofPaintOptions): void {
  const { plane, seed } = options;
  const ctx = plane.ctx;
  const stone = getRamp(DOME_STONE_RAMP_ID);
  const height = PARAPET_HEIGHT_TILES * options.scale;
  const top = plane.height - height;

  ctx.fillStyle = rgb(sampleRamp(stone, 0));
  ctx.fillRect(0, top, plane.width, height);

  const blockPx = PARAPET_BLOCK_TILES * options.scale;
  let x = 0;
  let block = 0;
  while (x < plane.width) {
    const widthJitter =
      1 + (elementValue(seed, STREAM_TILE_WIDTH, block) - 0.5) * 2 * PARAPET_BLOCK_WIDTH_JITTER;
    const width = Math.max(MIN_COURSE_PX, blockPx * widthJitter);
    ctx.fillStyle = rgb(elementColor(stone, seed, block, PARAPET_BODY_T, ELEMENT_TONE_JITTER));
    ctx.fillRect(
      x + PARAPET_JOINT_PX / 2,
      top + PARAPET_JOINT_PX / 2,
      width - PARAPET_JOINT_PX,
      height - PARAPET_JOINT_PX,
    );
    x += width;
    block++;
  }

  const corniceHeight = PARAPET_CORNICE_HEIGHT_TILES * options.scale;
  const corniceTop = plane.height - corniceHeight;
  ctx.fillStyle = rgb(sampleRamp(stone, PARAPET_CORNICE_T));
  ctx.fillRect(0, corniceTop, plane.width, corniceHeight);
  ctx.fillStyle = rgba(LAP_SHADOW_COLOR, PARAPET_CORNICE_AO_ALPHA);
  ctx.fillRect(0, corniceTop - ELEMENT_EDGE_PX, plane.width, ELEMENT_EDGE_PX);

  // The coping is the one horizontal the sun hits square on, and the brightest
  // line on the building — it is what says the parapet has a top rather than
  // simply stopping.
  ctx.fillStyle = rgba(sampleRamp(stone, 1), PARAPET_COPING_LIGHT_ALPHA);
  ctx.fillRect(0, top, plane.width, PARAPET_COPING_LIGHT_PX);

  const trimHeight = PARAPET_TRIM_HEIGHT_TILES * options.scale;
  ctx.fillStyle = rgba(
    sampleRamp(getRamp(options.roof.ridgeRamp), PARAPET_TRIM_T),
    PARAPET_TRIM_ALPHA,
  );
  ctx.fillRect(0, top + PARAPET_COPING_LIGHT_PX, plane.width, trimHeight);
}

/**
 * The cylinder under the dome.
 *
 * Shaded across its width like any other cylinder, and ribbed with pilasters
 * whose spacing is read off evenly spaced longitudes — so they crowd toward the
 * drum's edges by projection rather than by a fudge, which is the cue that says
 * "this is round" before the dome above it has said anything at all.
 */
function paintDrum(options: RoofPaintOptions, geometry: DomeGeometry): void {
  const ctx = options.plane.ctx;
  const stone = getRamp(DOME_STONE_RAMP_ID);
  const left = geometry.centreX - geometry.drumHalfWidth;
  const width = geometry.drumHalfWidth * 2;
  const top = geometry.springY;
  // Carried down to the plane's own bottom edge: the parapet is painted over this
  // afterwards, and a drum that stopped exactly at the coping would show a seam
  // wherever the coping's lit line lands a pixel high.
  const height = options.plane.height - top;

  ctx.fillStyle = rgb(sampleRamp(stone, DRUM_BODY_T));
  ctx.fillRect(left, top, width, height);

  // Both ends of the cylinder turn away from the viewer, so both go dark. The
  // shared crown-lit stops only darken the far end, which on a drum this shallow
  // leaves the near edge as bright as the lit face and flattens it to a slab.
  const shading = ctx.createLinearGradient(left, 0, left + width, 0);
  shading.addColorStop(0, rgba(sampleRamp(stone, 0), DRUM_NEAR_EDGE_ALPHA));
  shading.addColorStop(DRUM_LIT_STOP, rgba(sampleRamp(stone, 1), DRUM_LIT_ALPHA));
  shading.addColorStop(DRUM_MID_STOP, rgba(sampleRamp(stone, DRUM_BODY_T), 0));
  shading.addColorStop(1, rgba(sampleRamp(stone, 0), DRUM_FAR_EDGE_ALPHA));
  ctx.fillStyle = shading;
  ctx.fillRect(left, top, width, height);

  for (let pilaster = 0; pilaster < DRUM_PILASTER_COUNT; pilaster++) {
    const longitude = (Math.PI * (pilaster + 0.5)) / DRUM_PILASTER_COUNT;
    const x = geometry.centreX + geometry.drumHalfWidth * Math.cos(longitude);
    ctx.fillStyle = rgba(sampleRamp(stone, 0), DRUM_PILASTER_ALPHA);
    ctx.fillRect(x, top, DRUM_PILASTER_WIDTH_PX, height);
    ctx.fillStyle = rgba(sampleRamp(stone, 1), DRUM_PILASTER_LIGHT_ALPHA);
    ctx.fillRect(x - DRUM_PILASTER_WIDTH_PX, top, DRUM_PILASTER_WIDTH_PX, height);
  }
}

/**
 * The stone band at the springing line.
 *
 * Painted after the dome and spanning the dome's full width rather than the
 * drum's, so the dome visibly oversails the cylinder it stands on. Its own drop
 * shadow lands on the drum below, which is what separates the two objects instead
 * of letting the blue simply end.
 */
function paintSpringingCornice(options: RoofPaintOptions, geometry: DomeGeometry): void {
  const ctx = options.plane.ctx;
  const stone = getRamp(DOME_STONE_RAMP_ID);
  const height = DRUM_CORNICE_HEIGHT_TILES * options.scale;
  const left = geometry.centreX - geometry.radiusX;
  const width = geometry.radiusX * 2;
  const top = geometry.springY - height;

  ctx.fillStyle = rgb(sampleRamp(stone, DRUM_CORNICE_T));
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = rgba(sampleRamp(stone, 1), DRUM_CORNICE_LIGHT_ALPHA);
  ctx.fillRect(left, top, width, ELEMENT_EDGE_PX);
  ctx.fillStyle = rgba(LAP_SHADOW_COLOR, DRUM_CORNICE_AO_ALPHA);
  ctx.fillRect(left, geometry.springY, width, DRUM_CORNICE_AO_PX);
}

function paintDomeShell(options: RoofPaintOptions, geometry: DomeGeometry): void {
  const { plane } = options;
  const ctx = plane.ctx;
  const ramp = getRamp(options.roof.ramp);
  const { centreX, radiusX, radiusY, springY } = geometry;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(centreX, springY, radiusX, radiusY, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  ctx.fillStyle = rgb(sampleRamp(ramp, DOME_BODY_T));
  ctx.fillRect(centreX - radiusX, geometry.apexY, radiusX * 2, radiusY);

  const highlightX = centreX + radiusX * DOME_HIGHLIGHT_ACROSS;
  const highlightY = springY - radiusY * DOME_HIGHLIGHT_UP;
  const outerRadius = Math.hypot(radiusX, radiusY) * DOME_FALLOFF_REACH;
  const shading = ctx.createRadialGradient(
    highlightX,
    highlightY,
    0,
    highlightX,
    highlightY,
    outerRadius,
  );
  shading.addColorStop(0, rgb(sampleRamp(ramp, DOME_CORE_T)));
  shading.addColorStop(DOME_CORE_STOP, rgb(sampleRamp(ramp, DOME_CORE_T)));
  shading.addColorStop(DOME_BODY_STOP, rgb(sampleRamp(ramp, DOME_BODY_T)));
  shading.addColorStop(DOME_TERMINATOR_STOP, rgb(sampleRamp(ramp, DOME_TERMINATOR_T)));
  shading.addColorStop(1, rgb(sampleRamp(ramp, DOME_LIMB_T)));
  ctx.fillStyle = shading;
  ctx.fillRect(centreX - radiusX, geometry.apexY, radiusX * 2, radiusY);

  paintDomeTiling(options, ramp, geometry);
  paintDomeLimb(options, ramp, geometry);
  paintDomeRibs(options, ramp, centreX, radiusX, radiusY, springY);
  ctx.restore();
}

/**
 * Courses of glazed tile following the dome's curve.
 *
 * A dome is the largest unbroken surface in the town, and shaded alone it is a
 * smooth gradient — which reads as a balloon rather than as something built. Real
 * domes of this kind are tiled, and the courses are what state the scale of the
 * thing: without them a viewer has nothing to measure the dome against.
 *
 * The courses are drawn as nested ellipses, so their spacing closes toward the
 * apex exactly the way the surface's own foreshortening does. Drawn as evenly
 * spaced horizontal lines instead they read as a barrel.
 */
const DOME_COURSE_COUNT = 9;
const DOME_COURSE_ALPHA = 0.42;
const DOME_COURSE_LIGHT_ALPHA = 0.3;
const DOME_COURSE_WIDTH_PX = 1.2;
const DOME_COURSE_JOINT_T = 0.08;
const DOME_COURSE_LIGHT_T = 0.95;
const DOME_COURSE_LIGHT_OFFSET_PX = 1.2;

function paintDomeTiling(options: RoofPaintOptions, ramp: Ramp, geometry: DomeGeometry): void {
  const ctx = options.plane.ctx;
  const { centreX, radiusX, radiusY, springY } = geometry;
  ctx.lineWidth = DOME_COURSE_WIDTH_PX;
  for (let course = 1; course < DOME_COURSE_COUNT; course++) {
    // A hemisphere's equal-arc courses project as the sine of the polar angle,
    // which bunches them at the *crown*. Squaring the fraction instead bunched
    // them at the springing line — the opposite end — piling three unreadable
    // rings into the bottom tenth of the dome and leaving the crown bare.
    const height = Math.sin((course / DOME_COURSE_COUNT) * (Math.PI / 2));
    const ringX = radiusX * Math.sqrt(Math.max(0, 1 - height * height));
    const ringY = radiusY * height;
    if (ringX <= 1) continue;
    ctx.strokeStyle = rgba(sampleRamp(ramp, DOME_COURSE_JOINT_T), DOME_COURSE_ALPHA);
    ctx.beginPath();
    ctx.ellipse(centreX, springY, ringX, ringY, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgba(sampleRamp(ramp, DOME_COURSE_LIGHT_T), DOME_COURSE_LIGHT_ALPHA);
    ctx.beginPath();
    ctx.ellipse(
      centreX,
      springY + DOME_COURSE_LIGHT_OFFSET_PX,
      ringX,
      ringY,
      0,
      Math.PI,
      Math.PI * 2,
    );
    ctx.stroke();
  }
}

/** Where the limb shade starts, in dome radii, and how dark it gets at the edge. */
const DOME_LIMB_INNER_STOP = 0.58;
const DOME_LIMB_MID_STOP = 0.85;
const DOME_LIMB_MID_ALPHA = 0.3;
const DOME_LIMB_ALPHA = 0.8;

/**
 * Darkening keyed to distance from the dome's axis rather than from the sun.
 *
 * The sun's own radial falloff cannot do this: the highlight sits left of centre,
 * so the *left* limb is nearer to it than the middle of the dome is and comes out
 * as one of the brightest things on the shell. But a limb is turned ninety
 * degrees away from the viewer whichever side of the sun it is on, and a dome
 * whose left edge does not turn away is a disc with a bright patch on it.
 */
function paintDomeLimb(options: RoofPaintOptions, ramp: Ramp, geometry: DomeGeometry): void {
  const ctx = options.plane.ctx;
  const { centreX, radiusX, radiusY, springY } = geometry;
  const dark = sampleRamp(ramp, 0);

  ctx.save();
  ctx.translate(centreX, springY);
  ctx.scale(1, radiusY / radiusX);
  const limb = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusX);
  limb.addColorStop(0, rgba(dark, 0));
  limb.addColorStop(DOME_LIMB_INNER_STOP, rgba(dark, 0));
  limb.addColorStop(DOME_LIMB_MID_STOP, rgba(dark, DOME_LIMB_MID_ALPHA));
  limb.addColorStop(1, rgba(dark, DOME_LIMB_ALPHA));
  ctx.fillStyle = limb;
  ctx.fillRect(-radiusX, -radiusX, radiusX * 2, radiusX * 2);
  ctx.restore();
}

/**
 * Meridians drawn as half-ellipses sharing the apex and the springing line.
 *
 * A meridian at longitude φ projects to an ellipse whose horizontal semi-axis is
 * `radiusX * cos φ`, which is why evenly spaced longitudes crowd together toward
 * the limb on their own — the convergence is the projection's, not a fudge.
 */
function paintDomeRibs(
  options: RoofPaintOptions,
  ramp: Ramp,
  centreX: number,
  radiusX: number,
  radiusY: number,
  baseY: number,
): void {
  const ctx = options.plane.ctx;
  ctx.lineWidth = DOME_RIB_WIDTH_PX;
  for (let rib = 0; rib < DOME_RIB_COUNT; rib++) {
    const longitude = (Math.PI * (rib + 0.5)) / DOME_RIB_COUNT;
    const semiAxis = Math.abs(radiusX * Math.cos(longitude));
    ctx.strokeStyle = rgba(sampleRamp(ramp, 0), DOME_RIB_ALPHA);
    ctx.beginPath();
    ctx.ellipse(centreX, baseY, semiAxis, radiusY, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgba(sampleRamp(ramp, 1), DOME_RIB_LIGHT_ALPHA);
    ctx.beginPath();
    ctx.ellipse(
      centreX - DOME_RIB_LIGHT_OFFSET_PX,
      baseY,
      semiAxis,
      radiusY,
      0,
      Math.PI,
      Math.PI * 2,
    );
    ctx.stroke();
  }
}

/**
 * The gold spike on the apex.
 *
 * Painted from `ridgeRamp` rather than reaching for the gold in the registry
 * directly: the palette gate tests rendered pixels against the ramps a building's
 * spec *declares*, and a hue nothing declared is a hue the gate cannot see.
 */
function paintDomeFinial(options: RoofPaintOptions, geometry: DomeGeometry): void {
  const ctx = options.plane.ctx;
  const ramp = getRamp(options.roof.ridgeRamp);
  const height = DOME_FINIAL_HEIGHT_TILES * options.scale;
  const ballRadius = (DOME_FINIAL_BALL_TILES * options.scale) / 2;
  const spikeHalfWidth = (DOME_FINIAL_SPIKE_WIDTH_TILES * options.scale) / 2;
  const centreX = geometry.centreX;
  // The dome's own radius is solved so this clears the plane's top edge; there is
  // no canvas above y = 0, and a spike drawn there is a spike not in the bake.
  const apexY = geometry.apexY;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(centreX, apexY - height);
  ctx.lineTo(centreX + spikeHalfWidth, apexY);
  ctx.lineTo(centreX - spikeHalfWidth, apexY);
  ctx.closePath();
  ctx.fillStyle = rgb(sampleRamp(ramp, DOME_FINIAL_SPIKE_T));
  ctx.fill();

  ctx.beginPath();
  ctx.arc(centreX, apexY - height + ballRadius, ballRadius, 0, Math.PI * 2);
  ctx.fillStyle = rgb(sampleRamp(ramp, DOME_FINIAL_BALL_T));
  ctx.fill();

  const HIGHLIGHT_OFFSET_FRACTION = 0.35;
  ctx.beginPath();
  ctx.arc(
    centreX - ballRadius * HIGHLIGHT_OFFSET_FRACTION,
    apexY - height + ballRadius * (1 - HIGHLIGHT_OFFSET_FRACTION),
    ballRadius * HIGHLIGHT_OFFSET_FRACTION,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = rgba(sampleRamp(ramp, 1), 1 - ELEMENT_BOTTOM_SHADOW);
  ctx.fill();
  ctx.restore();
}
