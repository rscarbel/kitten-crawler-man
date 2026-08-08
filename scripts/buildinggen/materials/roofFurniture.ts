/**
 * The things that stand on a roof: chimney stacks and dormer boxes.
 *
 * Unlike a material, these paint in **frame space**, straight onto the finished
 * building, after the roof planes have been warped onto their quads. A chimney
 * painted inside the roof plane would be sheared along with the courses and come
 * out leaning; a chimney is plumb no matter what the roof under it is doing.
 *
 * ## Everything is seated off one geometry function
 *
 * Where a stack meets the roof, how tall it is, where its cap sits and where its
 * pot's mouth is are all solved once in `chimneyGeometry`. The `life` animator
 * asks the same function where smoke should leave from — a second copy of that
 * arithmetic anywhere is how smoke ends up rising beside its own chimney, and it
 * would not be visible in either file's code, only in the picture.
 */

import type { CanvasRenderingContext2D as NodeCtx } from 'canvas';
import {
  paintEdgeLight,
  paintRecessAo,
  paintStructuralLine,
  paintWindowGlow,
} from '../lighting.js';
import type { Point, Projection, Quad } from '../projection.js';
import { getRamp, hueShift, rgb, rgba, sampleRamp, type RGB, type Ramp } from '../ramps.js';
import type { BuildingSpec, ChimneySpec, DormerSpec } from '../spec.js';
import { elementValue } from './kit.js';
import { roofSagPx } from './roof.js';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Streams, so a block's tone and its hue never share a number. */
const STREAM_STACK_TONE = 41;
const STREAM_STACK_HUE = 42;
const STREAM_STACK_WIDTH = 43;

/** Per-block jitter on a stack. Smaller than a wall's: a chimney is one built object. */
const STACK_TONE_JITTER = 0.13;
const STACK_HUE_JITTER = 2.5;
const STACK_BLOCK_WIDTH_JITTER = 0.3;

/** Keys a course and a block into one stream. */
const STACK_KEY_STRIDE = 401;

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * A point on the front roof slope, given as fractions across it and down it.
 *
 * Interpolated along the quad's own left and right edges rather than off the
 * ridge and eaves lines, because the ridge is inset from the eaves — a point
 * placed by frame-space x alone lands on the roof near the ridge and off it near
 * the eaves.
 */
function roofSurfacePoint(quad: Quad, acrossFraction: number, downhillFraction: number): Point {
  const left: Point = {
    x: lerp(quad.tl.x, quad.bl.x, downhillFraction),
    y: lerp(quad.tl.y, quad.bl.y, downhillFraction),
  };
  const right: Point = {
    x: lerp(quad.tr.x, quad.br.x, downhillFraction),
    y: lerp(quad.tr.y, quad.br.y, downhillFraction),
  };
  return {
    x: lerp(left.x, right.x, acrossFraction),
    y: lerp(left.y, right.y, acrossFraction),
  };
}

/** Where along the slope's width a frame-space column falls, at a given depth. */
function acrossFractionForColumn(
  projection: Projection,
  col: number,
  downhillFraction: number,
): number {
  const quad = projection.roofQuad;
  const leftX = lerp(quad.tl.x, quad.bl.x, downhillFraction);
  const rightX = lerp(quad.tr.x, quad.br.x, downhillFraction);
  const span = rightX - leftX;
  if (span === 0) return 0;
  return clamp01((col * projection.scale - leftX) / span);
}

// ── chimneys ───────────────────────────────────────────────────────────────

/**
 * How far down the slope a stack breaks through, as a fraction.
 *
 * Near the ridge, because that is where a flue actually comes out and because a
 * stack seated halfway down the visible slope covers the courses that carry most
 * of the roof's read.
 */
const CHIMNEY_SLOPE_SEAT = 0.26;

/** How far the stack's masonry continues below the seat, so it never floats. */
const CHIMNEY_EMBED_TILES = 0.18;

/** The stack narrows as it rises; the cap then projects past the narrowed top. */
const CHIMNEY_TOP_TAPER = 0.85;
const CHIMNEY_CAP_OVERHANG = 1.24;
const CHIMNEY_CAP_HEIGHT_TILES = 0.13;

/** Coursed masonry inside the stack. */
const CHIMNEY_COURSE_TILES = 0.13;
const CHIMNEY_BLOCK_TILES = 0.2;
const CHIMNEY_JOINT_PX = 1;

/** Pots standing on the cap. */
const CHIMNEY_POT_HEIGHT_TILES = 0.24;
const CHIMNEY_POT_WIDTH_TILES = 0.15;
const CHIMNEY_POT_GAP_TILES = 0.06;
/** A stack this wide carries a second pot; a narrow one would have them touching. */
const CHIMNEY_SECOND_POT_MIN_TILES = 0.85;

/** The shadow the stack drops down-right onto the roof, away from the town's sun. */
const CHIMNEY_SHADOW_DX_TILES = 0.24;
const CHIMNEY_SHADOW_DY_TILES = 0.14;
const CHIMNEY_SHADOW_ALPHA = 0.42;
const CHIMNEY_SHADOW_MID_STOP = 0.5;
const CHIMNEY_SHADOW_MID_FRACTION = 0.45;

/** The lit lip along the cap, the single highest-value pixel on the whole stack. */
const CAP_LIGHT_WIDTH_PX = 2;
const CAP_LIGHT_ALPHA = 0.8;

interface ChimneyGeometry {
  /** Where the stack breaks through the roof surface. */
  readonly seat: Point;
  readonly stack: Rect;
  readonly topWidth: number;
  readonly cap: Rect;
  readonly potWidth: number;
  readonly potHeight: number;
  readonly potTopY: number;
  readonly primaryPotX: number;
  /** Left edge of the second pot, or null on a stack too narrow to carry one. */
  readonly secondPotX: number | null;
  /** Frame-space point smoke leaves the stack from. */
  readonly mouth: Point;
}

function chimneyGeometry(
  projection: Projection,
  spec: BuildingSpec,
  chimney: ChimneySpec,
): ChimneyGeometry {
  const scale = projection.scale;
  const across = acrossFractionForColumn(projection, chimney.col, CHIMNEY_SLOPE_SEAT);
  const surface = roofSurfacePoint(projection.roofQuad, across, CHIMNEY_SLOPE_SEAT);
  // Seated on the bowed surface, exactly as the dormer is. Leaving this out is
  // the failure `roofSagPx` was exported to prevent, and it was left out here:
  // the Sunken Stump bows fifteen pixels and seats its stack near the ridge, so
  // the chimney — and the `life` smoke, which derives from this same geometry —
  // floated clear of the roof they stand on.
  const sagPx = spec.roof.ridgeSagTiles * scale;
  const seat: Point = {
    x: surface.x,
    y: surface.y + roofSagPx(across, CHIMNEY_SLOPE_SEAT, sagPx),
  };

  const bottomWidth = chimney.widthTiles * scale;
  const topWidth = bottomWidth * CHIMNEY_TOP_TAPER;
  const height = chimney.heightTiles * scale;
  const embed = CHIMNEY_EMBED_TILES * scale;
  const capHeight = CHIMNEY_CAP_HEIGHT_TILES * scale;
  const capWidth = topWidth * CHIMNEY_CAP_OVERHANG;

  const stack: Rect = {
    x: seat.x - bottomWidth / 2,
    y: seat.y - height,
    width: bottomWidth,
    height: height + embed,
  };
  const cap: Rect = {
    x: seat.x - capWidth / 2,
    y: stack.y - capHeight,
    width: capWidth,
    height: capHeight,
  };

  const potWidth = CHIMNEY_POT_WIDTH_TILES * scale;
  const potHeight = CHIMNEY_POT_HEIGHT_TILES * scale;
  const potGap = CHIMNEY_POT_GAP_TILES * scale;
  const potTopY = cap.y - potHeight;
  const carriesTwo = chimney.widthTiles >= CHIMNEY_SECOND_POT_MIN_TILES;
  const pairSpan = potWidth * 2 + potGap;
  const primaryPotX = carriesTwo ? seat.x - pairSpan / 2 : seat.x - potWidth / 2;
  const secondPotX = carriesTwo ? primaryPotX + potWidth + potGap : null;

  return {
    seat,
    stack,
    topWidth,
    cap,
    potWidth,
    potHeight,
    potTopY,
    primaryPotX,
    secondPotX,
    mouth: { x: primaryPotX + potWidth / 2, y: potTopY },
  };
}

/**
 * Frame-space point the `life` overlay's smoke rises from.
 *
 * Shares `chimneyGeometry` with the painter on purpose — see this file's header.
 */
export function chimneyPotMouth(
  projection: Projection,
  spec: BuildingSpec,
  chimney: ChimneySpec,
): { readonly x: number; readonly y: number } {
  return chimneyGeometry(projection, spec, chimney).mouth;
}

export function paintChimney(
  ctx: NodeCtx,
  projection: Projection,
  spec: BuildingSpec,
  chimney: ChimneySpec,
): void {
  const geometry = chimneyGeometry(projection, spec, chimney);
  const ramp = getRamp(chimney.ramp);
  const seed = spec.seed + chimney.col;

  paintChimneyRoofShadow(ctx, projection, geometry);
  paintStack(ctx, projection, geometry, ramp, seed);
  paintCap(ctx, geometry, ramp);
  paintPots(ctx, geometry, ramp);

  // The flashing line where lead is dressed into the courses. It is the join that
  // says the stack goes *through* the roof rather than standing on top of it.
  paintStructuralLine(
    ctx,
    { x: geometry.stack.x, y: geometry.seat.y },
    { x: geometry.stack.x + geometry.stack.width, y: geometry.seat.y },
  );
}

/**
 * The stack's own shadow, laid on the roof before the stack so the masonry is not
 * darkened by it.
 *
 * `source-atop` keeps it on pixels the roof has already painted; a plain fill
 * would drop a grey wedge into the transparent sky beside a stack near the gable.
 */
function paintChimneyRoofShadow(
  ctx: NodeCtx,
  projection: Projection,
  geometry: ChimneyGeometry,
): void {
  const shadow = sampleRamp(getRamp('ground_shadow'), 0);
  const dx = CHIMNEY_SHADOW_DX_TILES * projection.scale;
  const dy = CHIMNEY_SHADOW_DY_TILES * projection.scale;
  const gradient = ctx.createLinearGradient(
    geometry.stack.x,
    geometry.seat.y,
    geometry.stack.x + geometry.stack.width + dx,
    geometry.seat.y + dy,
  );
  gradient.addColorStop(0, rgba(shadow, CHIMNEY_SHADOW_ALPHA));
  gradient.addColorStop(
    CHIMNEY_SHADOW_MID_STOP,
    rgba(shadow, CHIMNEY_SHADOW_ALPHA * CHIMNEY_SHADOW_MID_FRACTION),
  );
  gradient.addColorStop(1, rgba(shadow, 0));

  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(geometry.stack.x, geometry.seat.y);
  ctx.lineTo(geometry.stack.x + geometry.stack.width, geometry.seat.y);
  ctx.lineTo(geometry.cap.x + geometry.cap.width + dx, geometry.cap.y + dy);
  ctx.lineTo(geometry.cap.x + dx, geometry.cap.y + dy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function paintStack(
  ctx: NodeCtx,
  projection: Projection,
  geometry: ChimneyGeometry,
  ramp: Ramp,
  seed: number,
): void {
  const scale = projection.scale;
  const coursePx = CHIMNEY_COURSE_TILES * scale;
  const blockPx = CHIMNEY_BLOCK_TILES * scale;
  const courseCount = Math.max(1, Math.ceil(geometry.stack.height / coursePx));

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(geometry.stack.x + (geometry.stack.width - geometry.topWidth) / 2, geometry.stack.y);
  ctx.lineTo(
    geometry.stack.x + geometry.stack.width - (geometry.stack.width - geometry.topWidth) / 2,
    geometry.stack.y,
  );
  ctx.lineTo(geometry.stack.x + geometry.stack.width, geometry.stack.y + geometry.stack.height);
  ctx.lineTo(geometry.stack.x, geometry.stack.y + geometry.stack.height);
  ctx.closePath();
  // The joint colour goes down first and the blocks over it, so every gap between
  // two blocks is mortar by construction rather than by rounding.
  ctx.fillStyle = rgb(sampleRamp(ramp, 0));
  ctx.fill();
  ctx.clip();

  for (let course = 0; course < courseCount; course++) {
    const courseTop = geometry.stack.y + course * coursePx;
    let x = geometry.stack.x;
    let block = 0;
    while (x < geometry.stack.x + geometry.stack.width) {
      const key = course * STACK_KEY_STRIDE + block;
      const widthJitter =
        1 + (elementValue(seed, STREAM_STACK_WIDTH, key) - 0.5) * 2 * STACK_BLOCK_WIDTH_JITTER;
      const width = Math.max(CHIMNEY_JOINT_PX * 2, blockPx * widthJitter);
      ctx.fillStyle = rgb(stackBlockColor(ramp, seed, key));
      ctx.fillRect(
        x + CHIMNEY_JOINT_PX / 2,
        courseTop + CHIMNEY_JOINT_PX / 2,
        width - CHIMNEY_JOINT_PX,
        coursePx - CHIMNEY_JOINT_PX,
      );
      x += width;
      block++;
    }
  }
  ctx.restore();
}

/** The mid-value of a stack block: a chimney is soot-darkened toward its top. */
const STACK_BASE_TONE = 0.55;

function stackBlockColor(ramp: Ramp, seed: number, key: number): RGB {
  const tone =
    STACK_BASE_TONE + (elementValue(seed, STREAM_STACK_TONE, key) - 0.5) * 2 * STACK_TONE_JITTER;
  const hue = (elementValue(seed, STREAM_STACK_HUE, key) - 0.5) * 2 * STACK_HUE_JITTER;
  return hueShift(sampleRamp(ramp, clamp01(tone)), hue);
}

/** Ramp values of the cap's body and of the light along its weathered top. */
const CAP_BODY_T = 0.4;
const CAP_LIGHT_T = 1;

function paintCap(ctx: NodeCtx, geometry: ChimneyGeometry, ramp: Ramp): void {
  ctx.fillStyle = rgb(sampleRamp(ramp, CAP_BODY_T));
  ctx.fillRect(geometry.cap.x, geometry.cap.y, geometry.cap.width, geometry.cap.height);
  paintEdgeLight(
    ctx,
    { x: geometry.cap.x, y: geometry.cap.y },
    { x: geometry.cap.x + geometry.cap.width, y: geometry.cap.y },
    sampleRamp(ramp, CAP_LIGHT_T),
    CAP_LIGHT_WIDTH_PX,
    CAP_LIGHT_ALPHA,
  );
}

/** A pot is a short cylinder: lit down one side, dark down the other, hollow on top. */
const POT_BODY_T = 0.5;
const POT_LIT_T = 0.85;
const POT_LIT_WIDTH_FRACTION = 0.34;
const POT_LIT_ALPHA = 0.6;
const POT_MOUTH_HEIGHT_FRACTION = 0.22;
const POT_MOUTH_T = 0;

function paintPots(ctx: NodeCtx, geometry: ChimneyGeometry, ramp: Ramp): void {
  paintPot(ctx, geometry, ramp, geometry.primaryPotX);
  if (geometry.secondPotX !== null) {
    paintPot(ctx, geometry, ramp, geometry.secondPotX);
  }
}

function paintPot(ctx: NodeCtx, geometry: ChimneyGeometry, ramp: Ramp, left: number): void {
  const { potWidth, potHeight, potTopY } = geometry;
  ctx.fillStyle = rgb(sampleRamp(ramp, POT_BODY_T));
  ctx.fillRect(left, potTopY, potWidth, potHeight);
  ctx.fillStyle = rgba(sampleRamp(ramp, POT_LIT_T), POT_LIT_ALPHA);
  ctx.fillRect(left, potTopY, potWidth * POT_LIT_WIDTH_FRACTION, potHeight);

  // The mouth: an ellipse of the dark inside, which is what makes the pot read as
  // open rather than as a peg standing on the cap.
  const mouthHeight = potHeight * POT_MOUTH_HEIGHT_FRACTION;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(left + potWidth / 2, potTopY, potWidth / 2, mouthHeight / 2, 0, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = rgb(sampleRamp(ramp, POT_MOUTH_T));
  ctx.fill();
  ctx.restore();
}

// ── dormers ────────────────────────────────────────────────────────────────

/** How far down the front slope a dormer's own eaves line sits, as a fraction. */
const DORMER_SLOPE_SEAT = 0.66;

/** The box's proportions, against its own width. */
const DORMER_BODY_HEIGHT_FACTOR = 0.62;
const DORMER_GABLE_HEIGHT_FACTOR = 0.28;
const DORMER_EAVES_OVERHANG_FACTOR = 0.09;

/** The window in the cheek face, as fractions of the box. */
const DORMER_WINDOW_INSET_FACTOR = 0.26;
const DORMER_WINDOW_HEIGHT_FACTOR = 0.52;

/** Ramp values the box's parts are cut from. */
const DORMER_CHEEK_T = 0.3;
const DORMER_CHEEK_LIT_T = 0.72;
const DORMER_CHEEK_LIT_WIDTH_FRACTION = 0.16;
const DORMER_CHEEK_LIT_ALPHA = 0.55;
const DORMER_GABLE_T = 0.5;
const DORMER_GLASS_T = 0;

/** Reveal depth of the unlit window, and the halo a lit one spills on the cheeks. */
const DORMER_RECESS_DEPTH = 0.55;
const DORMER_GLOW_INTENSITY = 0.6;
const DORMER_GLOW_BLEED_FACTOR = 0.2;

const DORMER_GABLE_LIGHT_WIDTH_PX = 1.5;
const DORMER_GABLE_LIGHT_ALPHA = 0.7;

export function paintDormer(
  ctx: NodeCtx,
  projection: Projection,
  spec: BuildingSpec,
  dormer: DormerSpec,
): void {
  const scale = projection.scale;
  const across = acrossFractionForColumn(projection, dormer.col, DORMER_SLOPE_SEAT);
  const surface = roofSurfacePoint(projection.roofQuad, across, DORMER_SLOPE_SEAT);
  // A dormer's own eaves sit on the roof surface, sag and all — a box seated on
  // the unsagged plane hangs in the air over Old Hilda's bowed ridge.
  const sagPx = spec.roof.ridgeSagTiles * scale;
  const baseY = surface.y + roofSagPx(across, DORMER_SLOPE_SEAT, sagPx);

  const width = dormer.widthTiles * scale;
  const bodyHeight = width * DORMER_BODY_HEIGHT_FACTOR;
  const gableHeight = width * DORMER_GABLE_HEIGHT_FACTOR;
  const overhang = width * DORMER_EAVES_OVERHANG_FACTOR;
  const body: Rect = {
    x: surface.x - width / 2,
    y: baseY - bodyHeight,
    width,
    height: bodyHeight,
  };

  paintDormerCastShadow(ctx, body, gableHeight, overhang);

  const cheekRamp = getRamp(spec.facade.ground.ramp);
  ctx.fillStyle = rgb(sampleRamp(cheekRamp, DORMER_CHEEK_T));
  ctx.fillRect(body.x, body.y, body.width, body.height);
  ctx.fillStyle = rgba(sampleRamp(cheekRamp, DORMER_CHEEK_LIT_T), DORMER_CHEEK_LIT_ALPHA);
  ctx.fillRect(body.x, body.y, body.width * DORMER_CHEEK_LIT_WIDTH_FRACTION, body.height);

  paintDormerGable(ctx, spec, body, gableHeight, overhang);
  paintDormerWindow(ctx, spec, dormer, body);
}

/**
 * The shadow a dormer throws down the roof beside it.
 *
 * Without it a dormer is a light rectangle lying on the thatch, and no amount of
 * detail on its own face fixes that — a viewer reads "sitting on" from the
 * shadow, not from the object. Offset down and right, because the town's one sun
 * is upper-left.
 */
const DORMER_SHADOW_OFFSET_FACTOR = 0.16;
const DORMER_SHADOW_ALPHA = 0.42;
const DORMER_SHADOW_SPREAD_FACTOR = 0.1;

function paintDormerCastShadow(
  ctx: NodeCtx,
  body: Rect,
  gableHeight: number,
  overhang: number,
): void {
  const offset = body.width * DORMER_SHADOW_OFFSET_FACTOR;
  const spread = body.width * DORMER_SHADOW_SPREAD_FACTOR;
  ctx.save();
  // Guarded like every other cast shadow here. It is not spilling today, but the
  // shape is an axis-aligned quad over a sloped roof, so the first dormer moved
  // near a gable — or a steeper roof — would put shadow into open sky.
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = rgba(SHADOW_INK, DORMER_SHADOW_ALPHA);
  ctx.beginPath();
  ctx.moveTo(body.x - overhang + offset, body.y - gableHeight + offset);
  ctx.lineTo(body.x + body.width + overhang + offset + spread, body.y - gableHeight + offset);
  ctx.lineTo(body.x + body.width + overhang + offset + spread, body.y + body.height + offset);
  ctx.lineTo(body.x - overhang + offset, body.y + body.height + offset);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A warm near-black; pure black on a golden roof reads as a hole punched in it. */
const SHADOW_INK: RGB = [20, 15, 13];

function paintDormerGable(
  ctx: NodeCtx,
  spec: BuildingSpec,
  body: Rect,
  gableHeight: number,
  overhang: number,
): void {
  const ridgeRamp = getRamp(spec.roof.ridgeRamp);
  const apex: Point = { x: body.x + body.width / 2, y: body.y - gableHeight };
  const left: Point = { x: body.x - overhang, y: body.y };
  const right: Point = { x: body.x + body.width + overhang, y: body.y };

  ctx.beginPath();
  ctx.moveTo(apex.x, apex.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(left.x, left.y);
  ctx.closePath();
  ctx.fillStyle = rgb(sampleRamp(ridgeRamp, DORMER_GABLE_T));
  ctx.fill();

  // The sun is upper-left, so only the left rake catches it.
  paintEdgeLight(
    ctx,
    left,
    apex,
    sampleRamp(ridgeRamp, 1),
    DORMER_GABLE_LIGHT_WIDTH_PX,
    DORMER_GABLE_LIGHT_ALPHA,
  );
  paintStructuralLine(ctx, left, right);
}

function paintDormerWindow(ctx: NodeCtx, spec: BuildingSpec, dormer: DormerSpec, body: Rect): void {
  const inset = body.width * DORMER_WINDOW_INSET_FACTOR;
  const opening: Rect = {
    x: body.x + inset,
    y: body.y + (body.height * (1 - DORMER_WINDOW_HEIGHT_FACTOR)) / 2,
    width: body.width - inset * 2,
    height: body.height * DORMER_WINDOW_HEIGHT_FACTOR,
  };
  if (opening.width <= 1 || opening.height <= 1) return;

  ctx.fillStyle = rgb(sampleRamp(getRamp(spec.facade.ground.trimRamp), DORMER_GLASS_T));
  ctx.fillRect(opening.x, opening.y, opening.width, opening.height);

  if (dormer.lit) {
    paintWindowGlow(ctx, opening, {
      rampId: 'hearth_glow',
      intensity: DORMER_GLOW_INTENSITY,
      bleed: opening.width * DORMER_GLOW_BLEED_FACTOR,
    });
  } else {
    paintRecessAo(ctx, opening, DORMER_RECESS_DEPTH);
  }
}
