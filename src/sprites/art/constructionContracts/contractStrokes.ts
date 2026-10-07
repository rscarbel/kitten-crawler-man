/**
 * The small marks construction-contract damage is assembled from: grooves,
 * boards, nails, splinters, stone chunks, rope and fray. Each is drawn in
 * the art's own light (upper left) so a mark sits on a prop the way the
 * prop's own seams and joints do.
 */

import { fillSoftEllipse } from '../softShade';
import { rgb, rgba } from '../town/townArt';
import { mix, sampleRamp, type Ramp, type RGB } from '../town/townPalette';
import { range, type Rng } from '../../person/rng';

type Ctx = CanvasRenderingContext2D;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The game's own tile size: one screen pixel is `tilePx / DISPLAY_TILE_PX` art units. */
const DISPLAY_TILE_PX = 32;

/** One on-screen pixel, in the units a painter draws in at this tile size. */
export function screenPx(tilePx: number): number {
  return tilePx / DISPLAY_TILE_PX;
}

const WHITE: RGB = [255, 255, 255];

/** How far a groove's lit lip sits below its dark core, in screen pixels. */
const GROOVE_LIP_OFFSET_PX = 0.9;
const GROOVE_LIP_WIDTH_SHARE = 0.7;

/**
 * A crack or split: a dark core with a lit lip just below it. Light comes from
 * the upper left, so the far wall of a groove catches it and the near wall is
 * in shadow.
 */
export function strokeGroove(
  ctx: Ctx,
  points: readonly Point[],
  widthPx: number,
  ink: RGB,
  inkAlpha: number,
  lip: RGB,
  lipAlpha: number,
  tilePx: number,
): void {
  if (points.length < 2) return;
  const unit = screenPx(tilePx);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  tracePolyline(ctx, points, GROOVE_LIP_OFFSET_PX * unit, GROOVE_LIP_OFFSET_PX * unit);
  ctx.strokeStyle = rgba(lip, lipAlpha);
  ctx.lineWidth = widthPx * GROOVE_LIP_WIDTH_SHARE;
  ctx.stroke();
  tracePolyline(ctx, points, 0, 0);
  ctx.strokeStyle = rgba(ink, inkAlpha);
  ctx.lineWidth = widthPx;
  ctx.stroke();
  ctx.restore();
}

function tracePolyline(ctx: Ctx, points: readonly Point[], dx: number, dy: number): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x + dx, point.y + dy);
    else ctx.lineTo(point.x + dx, point.y + dy);
  });
}

/** A wandering line from `from` to `to`, kinked `steps` times by up to `wobble` sideways. */
export function jaggedLine(
  rng: Rng,
  from: Point,
  to: Point,
  steps: number,
  wobble: number,
): Point[] {
  const points: Point[] = [from];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const normalX = -dy / length;
  const normalY = dx / length;
  for (let step = 1; step < steps; step++) {
    const t = step / steps;
    const offset = range(rng, -wobble, wobble);
    points.push({ x: from.x + dx * t + normalX * offset, y: from.y + dy * t + normalY * offset });
  }
  points.push(to);
  return points;
}

/** Share of a course a stepped crack's riser wanders sideways. */
const STEP_RISER_WOBBLE = 0.12;
const STEP_TREAD_MIN = 0.25;
const STEP_TREAD_MAX = 0.65;

/**
 * A crack that runs down through masonry the way masonry actually cracks:
 * down the head joint between two blocks, along the bed joint under them,
 * down the next head joint — a staircase that follows the courses.
 */
export function steppedCrack(
  rng: Rng,
  start: Point,
  courses: number,
  courseH: number,
  blockW: number,
  minX: number,
  maxX: number,
): Point[] {
  const points: Point[] = [start];
  let x = start.x;
  let y = start.y;
  let heading = rng() < 1 / 2 ? -1 : 1;
  for (let course = 0; course < courses; course++) {
    x += range(rng, -STEP_RISER_WOBBLE, STEP_RISER_WOBBLE) * courseH;
    y += courseH;
    points.push({ x, y });
    let tread = blockW * range(rng, STEP_TREAD_MIN, STEP_TREAD_MAX) * heading;
    const overruns = x + tread < minX || x + tread > maxX;
    if (overruns) {
      heading = -heading;
      tread = -tread;
    }
    x = Math.min(maxX, Math.max(minX, x + tread));
    points.push({ x, y });
  }
  return points;
}

export interface BoardStyle {
  readonly ramp: Ramp;
  readonly freshBreak: RGB;
  readonly ink: RGB;
  /** Which end, if either, snapped off — painted as a jagged, pale break. */
  readonly brokenEnd: 'start' | 'end' | 'none';
  /** Saw-cut ends showing pale end grain: a fresh offcut rather than an old board. */
  readonly sawnEnds?: boolean;
  readonly tilePx: number;
}

const END_GRAIN_SHARE = 0.08;

const BOARD_LIT_EDGE_SHARE = 0.28;
const BOARD_SHADE_EDGE_SHARE = 0.26;
const BOARD_GRAIN_LINES = 2;
const BOARD_GRAIN_ALPHA = 0.3;
const BOARD_OUTLINE_ALPHA = 0.85;
const BOARD_BODY_TONE = 0.55;
const BOARD_LIT_TONE = 0.9;
const BOARD_SHADE_TONE = 0.18;
const BREAK_TEETH = 4;
const BREAK_DEPTH_SHARE = 0.9;
/** Break teeth alternate shallow and deep, as shares of the break's depth. */
const BREAK_TOOTH_SHALLOW_MIN = 0.1;
const BREAK_TOOTH_SHALLOW_MAX = 0.4;
const BREAK_TOOTH_DEEP_MIN = 0.6;
const BREAK_TOOTH_DEEP_MAX = 1;
/** The pale fibre runs this many break depths back from the board's end. */
const BREAK_FIBRE_REACH = 1.6;
const END_GRAIN_MIN_PX = 1.5;

/**
 * A plank seen from the front, `length` along its grain and `thickness`
 * across, centred on `(cx, cy)` and turned by `angle`. A broken end is a row
 * of pale teeth: the bright, unweathered fibre is what reads as a fresh break
 * at game size, more than the jagged outline.
 */
export function drawBoard(
  ctx: Ctx,
  cx: number,
  cy: number,
  length: number,
  thickness: number,
  angle: number,
  rng: Rng,
  style: BoardStyle,
): void {
  const unit = screenPx(style.tilePx);
  const half = length / 2;
  const halfT = thickness / 2;
  const breakDepth = thickness * BREAK_DEPTH_SHARE;
  const teeth = Array.from({ length: BREAK_TEETH + 1 }, (_unused, index) => ({
    across: -halfT + (thickness * index) / BREAK_TEETH,
    depth:
      index % 2 === 0
        ? range(rng, BREAK_TOOTH_SHALLOW_MIN, BREAK_TOOTH_SHALLOW_MAX) * breakDepth
        : range(rng, BREAK_TOOTH_DEEP_MIN, BREAK_TOOTH_DEEP_MAX) * breakDepth,
  }));
  const outline = (): void => {
    ctx.beginPath();
    if (style.brokenEnd === 'start') {
      ctx.moveTo(-half + teeth[0].depth, teeth[0].across);
    } else {
      ctx.moveTo(-half, -halfT);
    }
    if (style.brokenEnd === 'end') {
      for (const tooth of teeth) ctx.lineTo(half - tooth.depth, tooth.across);
    } else {
      ctx.lineTo(half, -halfT);
      ctx.lineTo(half, halfT);
    }
    if (style.brokenEnd === 'start') {
      for (const tooth of [...teeth].reverse()) ctx.lineTo(-half + tooth.depth, tooth.across);
    } else {
      ctx.lineTo(-half, halfT);
    }
    ctx.closePath();
  };
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  outline();
  ctx.fillStyle = rgb(sampleRamp(style.ramp, BOARD_BODY_TONE));
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = rgb(sampleRamp(style.ramp, BOARD_LIT_TONE));
  ctx.fillRect(-half, -halfT, length, thickness * BOARD_LIT_EDGE_SHARE);
  ctx.fillStyle = rgb(sampleRamp(style.ramp, BOARD_SHADE_TONE));
  ctx.fillRect(-half, halfT - thickness * BOARD_SHADE_EDGE_SHARE, length, thickness);
  ctx.strokeStyle = rgba(sampleRamp(style.ramp, 0), BOARD_GRAIN_ALPHA);
  ctx.lineWidth = unit;
  for (let line = 1; line <= BOARD_GRAIN_LINES; line++) {
    const across = -halfT + (thickness * line) / (BOARD_GRAIN_LINES + 1);
    ctx.beginPath();
    ctx.moveTo(-half, across + range(rng, -unit, unit));
    ctx.lineTo(half, across + range(rng, -unit, unit));
    ctx.stroke();
  }
  if (style.brokenEnd !== 'none') {
    const sign = style.brokenEnd === 'end' ? 1 : -1;
    ctx.fillStyle = rgb(style.freshBreak);
    ctx.beginPath();
    for (const tooth of teeth) ctx.lineTo(sign * (half - tooth.depth), tooth.across);
    ctx.lineTo(sign * (half - breakDepth * BREAK_FIBRE_REACH), halfT);
    ctx.lineTo(sign * (half - breakDepth * BREAK_FIBRE_REACH), -halfT);
    ctx.closePath();
    ctx.fill();
  }
  if (style.sawnEnds === true) {
    const grain = Math.max(unit * END_GRAIN_MIN_PX, length * END_GRAIN_SHARE);
    ctx.fillStyle = rgb(style.freshBreak);
    ctx.fillRect(-half, -halfT, grain, thickness);
    ctx.fillRect(half - grain, -halfT, grain, thickness);
  }
  ctx.restore();
  outline();
  ctx.strokeStyle = rgba(style.ink, BOARD_OUTLINE_ALPHA);
  ctx.lineWidth = unit;
  ctx.stroke();
  ctx.restore();
}

const NAIL_HEAD_RADIUS_PX = 1.3;
const NAIL_SHANK_WIDTH_PX = 1.1;
const NAIL_GLINT_ALPHA = 0.8;
const NAIL_SHANK_TONE = 0.3;
const NAIL_HEAD_TONE = 0.15;
/** How far, in radians, the shank folds back on itself past its elbow. */
const NAIL_FOLD_RADIANS = 1;

/**
 * A nail head, and — when `bend` is given — the shank that came out with the
 * board and folded over, which is the tell that a board was pulled, not
 * removed.
 */
export function drawNail(
  ctx: Ctx,
  x: number,
  y: number,
  bend: number | null,
  shankPx: number,
  nail: Ramp,
  tilePx: number,
): void {
  const unit = screenPx(tilePx);
  ctx.save();
  if (bend !== null) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgb(sampleRamp(nail, NAIL_SHANK_TONE));
    ctx.lineWidth = NAIL_SHANK_WIDTH_PX * unit;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const elbowX = x + Math.cos(bend) * shankPx * (1 / 2);
    const elbowY = y + Math.sin(bend) * shankPx * (1 / 2);
    ctx.lineTo(elbowX, elbowY);
    ctx.lineTo(
      elbowX + Math.cos(bend + NAIL_FOLD_RADIANS) * shankPx * (1 / 2),
      elbowY + Math.sin(bend + NAIL_FOLD_RADIANS) * shankPx * (1 / 2),
    );
    ctx.stroke();
  }
  ctx.fillStyle = rgb(sampleRamp(nail, NAIL_HEAD_TONE));
  ctx.beginPath();
  ctx.arc(x, y, NAIL_HEAD_RADIUS_PX * unit, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba(sampleRamp(nail, 1), NAIL_GLINT_ALPHA);
  ctx.fillRect(x - unit * (1 / 2), y - unit * (1 / 2), unit * (1 / 2), unit * (1 / 2));
  ctx.restore();
}

const SPLINTER_WIDTH_SHARE = 0.22;
const SPLINTER_MIN_WIDTH_PX = 1.5;
const SPLINTER_OUTLINE_ALPHA = 0.7;
const SPLINTER_OUTLINE_PX = 3 / 4;

/** A sliver of wood: a long thin wedge, pale along its broken side. */
export function drawSplinter(
  ctx: Ctx,
  x: number,
  y: number,
  length: number,
  angle: number,
  body: RGB,
  pale: RGB,
  ink: RGB,
  tilePx: number,
): void {
  const unit = screenPx(tilePx);
  const width = Math.max(unit * SPLINTER_MIN_WIDTH_PX, length * SPLINTER_WIDTH_SHARE);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -width / 2);
  ctx.lineTo(length, 0);
  ctx.lineTo(0, width / 2);
  ctx.closePath();
  ctx.fillStyle = rgb(body);
  ctx.fill();
  ctx.fillStyle = rgb(pale);
  ctx.beginPath();
  ctx.moveTo(0, -width / 2);
  ctx.lineTo(length, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(ink, SPLINTER_OUTLINE_ALPHA);
  ctx.lineWidth = unit * SPLINTER_OUTLINE_PX;
  ctx.beginPath();
  ctx.moveTo(0, -width / 2);
  ctx.lineTo(length, 0);
  ctx.lineTo(0, width / 2);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

const CHUNK_VERTICES = 7;
const CHUNK_RADIUS_JITTER = 0.32;
const CHUNK_SQUASH = 0.72;
const CHUNK_LIT_TONE = 0.85;
const CHUNK_BODY_TONE = 0.5;
const CHUNK_SHADE_TONE = 0.15;
const CHUNK_OUTLINE_ALPHA = 0.85;
const CHUNK_SHADOW_ALPHA = 0.45;
const CHUNK_SHADOW_WIDTH = 1.15;
const CHUNK_SHADOW_HEIGHT = 0.4;
/** The chunk's shadow falls a little right of and below its centre, away from the light. */
const CHUNK_SHADOW_SHIFT_X = 0.15;
const CHUNK_SHADOW_DROP = 0.85;
const CHUNK_BODY_STOP = 0.5;

/**
 * A broken lump of stone, plaster or brick lying on the ground: an irregular
 * polygon lit on its upper left, shaded on its lower right, sitting in a soft
 * contact shadow.
 */
export function drawChunk(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  rng: Rng,
  ramp: Ramp,
  ink: RGB,
  tilePx: number,
): void {
  const unit = screenPx(tilePx);
  fillSoftEllipse(
    ctx,
    cx + radius * CHUNK_SHADOW_SHIFT_X,
    cy + radius * CHUNK_SQUASH * CHUNK_SHADOW_DROP,
    radius * CHUNK_SHADOW_WIDTH,
    radius * CHUNK_SHADOW_HEIGHT,
    rgb(ink),
    CHUNK_SHADOW_ALPHA,
  );
  const vertices: Point[] = [];
  const turn = range(rng, 0, Math.PI * 2);
  for (let index = 0; index < CHUNK_VERTICES; index++) {
    const angle = turn + (index / CHUNK_VERTICES) * Math.PI * 2;
    const r = radius * (1 + range(rng, -CHUNK_RADIUS_JITTER, CHUNK_RADIUS_JITTER));
    vertices.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r * CHUNK_SQUASH });
  }
  const trace = (): void => {
    ctx.beginPath();
    vertices.forEach((vertex, index) => {
      if (index === 0) ctx.moveTo(vertex.x, vertex.y);
      else ctx.lineTo(vertex.x, vertex.y);
    });
    ctx.closePath();
  };
  ctx.save();
  trace();
  const light = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  light.addColorStop(0, rgb(sampleRamp(ramp, CHUNK_LIT_TONE)));
  light.addColorStop(CHUNK_BODY_STOP, rgb(sampleRamp(ramp, CHUNK_BODY_TONE)));
  light.addColorStop(1, rgb(sampleRamp(ramp, CHUNK_SHADE_TONE)));
  ctx.fillStyle = light;
  ctx.fill();
  ctx.strokeStyle = rgba(ink, CHUNK_OUTLINE_ALPHA);
  ctx.lineWidth = unit;
  ctx.stroke();
  ctx.restore();
}

const CRUMB_ALPHA = 0.9;
const CRUMB_MIN_PX = 1;
const CRUMB_MAX_PX = 2.2;
const CRUMB_SHADE_TONE = 0.15;
const CRUMB_LIT_TONE = 0.85;

/** A scatter of tiny fragments: the debris a break leaves at its foot. */
export function drawCrumbs(
  ctx: Ctx,
  cx: number,
  cy: number,
  spreadX: number,
  spreadY: number,
  count: number,
  rng: Rng,
  ramp: Ramp,
  tilePx: number,
): void {
  const unit = screenPx(tilePx);
  for (let crumb = 0; crumb < count; crumb++) {
    const x = cx + range(rng, -spreadX, spreadX);
    const y = cy + range(rng, -spreadY, spreadY);
    const size = unit * range(rng, CRUMB_MIN_PX, CRUMB_MAX_PX);
    ctx.fillStyle = rgba(sampleRamp(ramp, CRUMB_SHADE_TONE), CRUMB_ALPHA);
    ctx.fillRect(x, y + size * (1 / 2), size, size * (1 / 2));
    ctx.fillStyle = rgba(sampleRamp(ramp, CRUMB_LIT_TONE), CRUMB_ALPHA);
    ctx.fillRect(x, y, size, size * (1 / 2));
  }
}

const ROPE_OUTLINE_SCALE = 1.45;
const ROPE_LIT_SHARE = 0.4;
const ROPE_TWIST_SPACING = 0.9;
const ROPE_TWIST_ALPHA = 0.55;
const ROPE_OUTLINE_ALPHA = 0.8;
const ROPE_BODY_TONE = 0.5;
const ROPE_LIT_TONE = 0.92;
const ROPE_TWIST_WIDTH_SHARE = 1 / 4;

/**
 * A length of laid rope along `points`: an inked body, a lit strand along its
 * top and the diagonal lay of its twist, which is what tells rope from a
 * stick at game size.
 */
export function drawRope(
  ctx: Ctx,
  points: readonly Point[],
  width: number,
  ramp: Ramp,
  ink: RGB,
): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  tracePolyline(ctx, points, 0, 0);
  ctx.strokeStyle = rgba(ink, ROPE_OUTLINE_ALPHA);
  ctx.lineWidth = width * ROPE_OUTLINE_SCALE;
  ctx.stroke();
  ctx.strokeStyle = rgb(sampleRamp(ramp, ROPE_BODY_TONE));
  ctx.lineWidth = width;
  ctx.stroke();
  tracePolyline(ctx, points, 0, -width * (1 - ROPE_LIT_SHARE) * (1 / 2));
  ctx.strokeStyle = rgb(sampleRamp(ramp, ROPE_LIT_TONE));
  ctx.lineWidth = width * ROPE_LIT_SHARE;
  ctx.stroke();
  ctx.strokeStyle = rgba(sampleRamp(ramp, 0), ROPE_TWIST_ALPHA);
  ctx.lineWidth = Math.max(1, width * ROPE_TWIST_WIDTH_SHARE);
  const spacing = width * ROPE_TWIST_SPACING;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    const segment = Math.hypot(to.x - from.x, to.y - from.y);
    if (segment === 0) continue;
    const ux = (to.x - from.x) / segment;
    const uy = (to.y - from.y) / segment;
    for (let along = spacing / 2; along < segment; along += spacing) {
      const px = from.x + ux * along;
      const py = from.y + uy * along;
      const half = width * (1 / 2);
      ctx.beginPath();
      ctx.moveTo(px - ux * half * (1 / 2) - uy * half, py - uy * half * (1 / 2) + ux * half);
      ctx.lineTo(px + ux * half * (1 / 2) + uy * half, py + uy * half * (1 / 2) - ux * half);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const FRAY_FIBRES = 6;
const FRAY_SPREAD = 0.9;
const FRAY_ANGLE_JITTER = 0.15;
const FRAY_MIN_LENGTH_SHARE = 0.55;
const FRAY_CURL = 0.4;
const FRAY_LIGHT_TONE = 0.85;
const FRAY_DARK_TONE = 0.45;

/** The burst of loose fibres at a snapped rope end, fanned along `angle`. */
export function drawFray(
  ctx: Ctx,
  x: number,
  y: number,
  angle: number,
  length: number,
  ramp: Ramp,
  rng: Rng,
  tilePx: number,
): void {
  const unit = screenPx(tilePx);
  ctx.save();
  ctx.lineCap = 'round';
  for (let fibre = 0; fibre < FRAY_FIBRES; fibre++) {
    const spread = ((fibre / (FRAY_FIBRES - 1)) * 2 - 1) * FRAY_SPREAD;
    const fibreAngle = angle + spread + range(rng, -FRAY_ANGLE_JITTER, FRAY_ANGLE_JITTER);
    const fibreLength = length * range(rng, FRAY_MIN_LENGTH_SHARE, 1);
    const curl = range(rng, -FRAY_CURL, FRAY_CURL);
    ctx.strokeStyle = rgb(sampleRamp(ramp, fibre % 2 === 0 ? FRAY_LIGHT_TONE : FRAY_DARK_TONE));
    ctx.lineWidth = unit;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(fibreAngle) * fibreLength * (1 / 2),
      y + Math.sin(fibreAngle) * fibreLength * (1 / 2),
      x + Math.cos(fibreAngle + curl) * fibreLength,
      y + Math.sin(fibreAngle + curl) * fibreLength,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/** A soft dark pool under something resting on the ground. */
export function contactShadow(
  ctx: Ctx,
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  ink: RGB,
  alpha: number,
): void {
  fillSoftEllipse(ctx, cx, cy, radiusX, radiusY, rgb(ink), alpha);
}

/** A colour lifted toward white — the lit lip of a groove in a pale material. */
export function lifted(color: RGB, amount: number): RGB {
  return mix(color, WHITE, amount);
}
