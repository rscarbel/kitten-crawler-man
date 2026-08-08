/**
 * Windows: the only thing on a facade that says somebody is home.
 *
 * A lit window is worth more per pixel than any amount of wall texture, and
 * almost all of that value is in two passes — the glow bleeding a few pixels
 * onto the stone beside the opening, and a flat dark silhouette behind the
 * glass. A rectangle of warm colour with a hard edge is a swatch; the same
 * rectangle with light spilling out of it and a shape moving behind it is a
 * room.
 *
 * Everything is painted in **facade-plane** coordinates, which are inset from
 * frame space by the roof's overhang, so the opening's position comes through
 * `tileColumnToPlaneX` / `frameYToFacadePlaneY` rather than off `col * scale`.
 *
 * `windowRect` exists so the `life` overlay's breathing light lands on the same
 * pixels the glass was painted into. An animator that recomputed the rect from
 * the spec would agree with this file until the first time either side clamped,
 * and then it would light the wall beside the window forever.
 */

import type { CanvasRenderingContext2D as NodeCtx } from 'canvas';
import type { NoiseField } from '../../tilegen/noise.js';
import {
  paintEdgeAo,
  paintEdgeLight,
  paintRecessAo,
  paintStructuralLine,
  paintWindowGlow,
} from '../lighting.js';
import {
  ELEMENT_EDGE_PX,
  ELEMENT_HUE_JITTER,
  ELEMENT_TONE_JITTER,
  ELEMENT_TOP_LIGHT,
  JOINT_WANDER_PERIOD,
  JOINT_WANDER_PX,
  elementValue,
} from '../materials/kit.js';
import type { Plane, Projection } from '../projection.js';
import { frameYToFacadePlaneY, groundHeightToFrameY, tileColumnToPlaneX } from '../projection.js';
import { getRamp, hueShift, rgb, rgba, sampleRamp, type Ramp } from '../ramps.js';
import type { BuildingSpec, WindowInterior, WindowSpec, WindowStyle } from '../spec.js';
import { jointWander, planeNoise } from '../texture.js';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Keeps a window's randomness clear of the wall's, which shares `spec.seed`. */
const WINDOW_SEED_OFFSET = 3607;
/** Strides that give two windows on one wall different glass, shutters and flowers. */
const COL_SEED_STRIDE = 131;
const ROW_SEED_STRIDE = 17;

const STREAM_PANE = 1;
const STREAM_SHUTTER = 2;
const STREAM_FLOWER = 3;
const STREAM_INTERIOR = 4;

/** Below this an opening is a smear rather than a window, so nothing is painted. */
const MIN_PAINTABLE_PX = 6;

const RECESS_DEPTH = 0.6;

/** Warm interior seen through the glass. */
const DEFAULT_GLOW_RAMP = 'hearth_glow';
const GLOW_INTENSITY = 0.9;
const GLOW_BLEED_PX = 6;

/** Unlit glass: dark, and lifted only by the sky it reflects. */
const DARK_GLASS_TONE = 0.35;
const SHEEN_ALPHA = 0.28;
const SHEEN_WIDTH_FRACTION = 0.55;

/** Silhouettes behind the glass, painted flat — depth in them reads as dirt. */
const SILHOUETTE_TONE = 0.1;
const SILHOUETTE_ALPHA = 0.82;
const SHELF_COUNT = 2;
const SHELF_THICKNESS_PX = 2;
const GOODS_PER_SHELF = 4;
const GOODS_HEIGHT_FRACTION = 0.6;
const CROWD_HEADS = 3;
const CROWD_HEAD_RADIUS_FRACTION = 0.11;
const CROWD_SHOULDER_FRACTION = 0.62;
const CROWD_SHOULDER_WIDTH_FACTOR = 1.3;
const CROWD_HEIGHT_JITTER = 0.2;
const CROWD_NECK_GAP_FACTOR = 0.25;
const CROWD_BASE_FRACTION = 1;
const BOTTLE_COUNT = 4;
const BOTTLE_NECK_FRACTION = 0.22;
const BOTTLE_NECK_WIDTH_FRACTION = 0.34;
const BOTTLE_BODY_WIDTH_FRACTION = 0.72;
const BOTTLE_HEIGHT_FRACTION = 0.55;
const FLASH_SHEETS = 4;
const FLASH_SHEET_INSET_FRACTION = 0.12;
const FLASH_PIN_RADIUS_PX = 1;
const CAT_BODY_WIDTH_FRACTION = 0.62;
const CAT_BODY_HEIGHT_FRACTION = 0.26;
const CAT_HEAD_RADIUS_FRACTION = 0.12;
const CAT_EAR_PX = 3;

/** Glazing bars: lead in a mullioned light, timber everywhere else. */
const BAR_PX = 1;
const STOUT_BAR_PX = 2;
const PANE_NOMINAL_PX = 11;
const BAR_TONE = 0.3;
const BAR_ALPHA = 0.85;
const RADIAL_BAR_COUNT = 5;
const ROUND_LIGHT_INSET_PX = 1;
const SHOPFRONT_LOW_BAR_FRACTION = 0.72;

/** Frame and sill. */
const FRAME_PX = 2;
const FRAME_TONE = 0.45;
const SILL_HEIGHT_PX = 4;
const SILL_OVERHANG_PX = 3;
const SILL_TONE = 0.56;
const SILL_LIGHT_ALPHA = 0.65;
const SILL_LIGHT_WIDTH_PX = 1.3;
const DRIP_DEPTH = 0.55;
const DRIP_REACH_PX = 7;

/** Shutters, hinged back flat against the wall. */
const DEFAULT_SHUTTER_RAMP = 'oak_beam';
const SHUTTER_WIDTH_FRACTION = 0.5;
const SHUTTER_TONE = 0.5;
const SHUTTER_SLAT_PX = 4;
const SHUTTER_SLAT_ALPHA = 0.4;
/** Spaced by more than the ±1 `side` spans, so the three streams cannot overlap. */
const SHUTTER_KEY_LOUVRE = 0;
const SHUTTER_KEY_TONE = 10;
const SHUTTER_KEY_HUE = 20;

const SHUTTER_LOUVRE_CHANCE = 0.5;
const SHUTTER_SHADOW_DEPTH = 0.5;
const SHUTTER_SHADOW_REACH_PX = 4;
const SHUTTER_EDGE_ALPHA = 0.6;

/** The flower box, which carries more charm per pixel than anything else here. */
const BOX_HEIGHT_PX = 6;
const BOX_OVERHANG_PX = 2;
const BOX_TONE = 0.42;
const BOX_RIM_TONE = 0.7;
const FLOWER_COUNT_MIN = 2;
const FLOWER_COUNT_RANGE = 2;
const FLOWER_RADIUS_PX = 2.2;
const FLOWER_RISE_PX = 4;
const FLOWER_HIGHLIGHT_TONE = 1;
const FLOWER_HIGHLIGHT_ALPHA = 0.6;
const LEAF_SPECKS_PER_FLOWER = 3;
const LEAF_SPECK_PX = 1;
const LEAF_SPREAD_PX = 5;

/**
 * The plane-space rect a window's glass occupies, clamped into the plane.
 *
 * The single source of truth for where a window *is*: `paintWindow` paints into
 * it and the `life` animator breathes light onto it.
 */
export function windowRect(plane: Plane, projection: Projection, window: WindowSpec): Rect {
  const left = tileColumnToPlaneX(projection, window.col);
  const right = left + window.widthTiles * projection.scale;
  // Both edges are converted through the plane mapping rather than one edge plus
  // a height: the facade plane's height is the warped wall's, not the frame's,
  // so a height added in frame pixels drifts further off the taller the wall is.
  const sillFrameY = groundHeightToFrameY(projection, window.baseAboveGroundTiles);
  const bottom = frameYToFacadePlaneY(projection, plane, sillFrameY);
  const top = frameYToFacadePlaneY(
    projection,
    plane,
    sillFrameY - window.heightTiles * projection.scale,
  );

  const clampedLeft = Math.max(0, left);
  const clampedTop = Math.max(0, top);
  const clampedRight = Math.min(plane.width, right);
  const clampedBottom = Math.min(plane.height, bottom);

  return {
    x: clampedLeft,
    y: clampedTop,
    width: Math.max(0, clampedRight - clampedLeft),
    height: Math.max(0, clampedBottom - clampedTop),
  };
}

export function paintWindow(
  plane: Plane,
  projection: Projection,
  spec: BuildingSpec,
  window: WindowSpec,
): void {
  const glass = windowRect(plane, projection, window);
  if (glass.width < MIN_PAINTABLE_PX || glass.height < MIN_PAINTABLE_PX) return;

  const ctx = plane.ctx;
  const noise = planeNoise(plane);
  const seed =
    spec.seed +
    WINDOW_SEED_OFFSET +
    Math.round(window.col * COL_SEED_STRIDE + window.baseAboveGroundTiles * ROW_SEED_STRIDE);

  paintRecessAo(ctx, glass, RECESS_DEPTH);

  if (window.lit) {
    paintWindowGlow(ctx, glass, {
      rampId: window.glowRamp ?? DEFAULT_GLOW_RAMP,
      intensity: GLOW_INTENSITY,
      bleed: GLOW_BLEED_PX,
    });
  } else {
    paintDarkGlass(ctx, glass);
  }

  if (window.interior !== undefined) {
    paintInterior(ctx, seed, glass, window.interior);
  }

  paintGlazingBars(ctx, glass, window.style);
  const facadeBaseY = planeY(plane, projection, projection.facadeBaseY);
  const sillBottom = paintFrameAndSill(ctx, glass, facadeBaseY);

  if (window.shutters) {
    paintShutters(ctx, noise, seed, glass, getRamp(window.shutterRamp ?? DEFAULT_SHUTTER_RAMP));
  }
  if (window.flowerBox) {
    paintFlowerBox(ctx, seed, glass, sillBottom, facadeBaseY);
  }
}

/**
 * Facade-plane Y of a frame-space Y.
 *
 * The facade plane's own vertical span covers `eavesY .. facadeBaseY`, and that
 * is not the same number of pixels as the frame-space distance once a building
 * leans — so anything read off the projection converts here rather than
 * subtracting `eavesY` and hoping.
 */
function planeY(plane: Plane, projection: Projection, frameY: number): number {
  const facadeSpan = projection.facadeBaseY - projection.eavesY;
  if (facadeSpan <= 0) return plane.height;
  return ((frameY - projection.eavesY) / facadeSpan) * plane.height;
}

/**
 * Unlit glass, plus the diagonal band of sky it reflects.
 *
 * The sheen is what stops a dark window reading as a hole in the wall — a black
 * rectangle beside a lit one looks like missing art rather than an empty room.
 */
function paintDarkGlass(ctx: NodeCtx, glass: Rect): void {
  const ramp = getRamp('dark_glass');
  ctx.save();
  ctx.beginPath();
  ctx.rect(glass.x, glass.y, glass.width, glass.height);
  ctx.clip();
  ctx.fillStyle = rgb(sampleRamp(ramp, DARK_GLASS_TONE));
  ctx.fillRect(glass.x, glass.y, glass.width, glass.height);

  const sheenWidth = glass.width * SHEEN_WIDTH_FRACTION;
  ctx.fillStyle = rgba(sampleRamp(ramp, 1), SHEEN_ALPHA);
  ctx.beginPath();
  ctx.moveTo(glass.x, glass.y + glass.height);
  ctx.lineTo(glass.x + sheenWidth, glass.y + glass.height);
  ctx.lineTo(glass.x + glass.width, glass.y);
  ctx.lineTo(glass.x + glass.width - sheenWidth, glass.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function paintInterior(ctx: NodeCtx, seed: number, glass: Rect, interior: WindowInterior): void {
  const ink = rgba(sampleRamp(getRamp('ink_outline'), SILHOUETTE_TONE), SILHOUETTE_ALPHA);
  ctx.save();
  ctx.beginPath();
  ctx.rect(glass.x, glass.y, glass.width, glass.height);
  ctx.clip();
  ctx.fillStyle = ink;
  switch (interior) {
    case 'goods':
      paintGoods(ctx, seed, glass);
      break;
    case 'crowd':
      paintCrowd(ctx, seed, glass);
      break;
    case 'bottles':
      paintBottles(ctx, seed, glass);
      break;
    case 'flash_art':
      paintFlashArt(ctx, seed, glass);
      break;
    case 'cat':
      paintSleepingCat(ctx, glass);
      break;
  }
  ctx.restore();
}

/** Shelves of jars and bolts of cloth: alternating round and square tops. */
function paintGoods(ctx: NodeCtx, seed: number, glass: Rect): void {
  const shelfSpacing = glass.height / (SHELF_COUNT + 1);
  for (let shelf = 1; shelf <= SHELF_COUNT; shelf++) {
    const shelfY = glass.y + shelf * shelfSpacing;
    ctx.fillRect(glass.x, shelfY, glass.width, SHELF_THICKNESS_PX);
    const slot = glass.width / GOODS_PER_SHELF;
    for (let item = 0; item < GOODS_PER_SHELF; item++) {
      const value = elementValue(seed, STREAM_INTERIOR, shelf * GOODS_PER_SHELF + item);
      const height = shelfSpacing * GOODS_HEIGHT_FRACTION * (1 - value * ELEMENT_TONE_JITTER * 2);
      const width = slot * (1 - value * ELEMENT_TONE_JITTER);
      const x = glass.x + item * slot + (slot - width) / 2;
      const y = shelfY - height;
      ctx.fillRect(x, y, width, height);
      if (value > 0.5) {
        ctx.beginPath();
        ctx.arc(x + width / 2, y, width / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Two or three overlapping shoulder-and-head shapes: the Flagon at full tilt. */
function paintCrowd(ctx: NodeCtx, seed: number, glass: Rect): void {
  const baseY = glass.y + glass.height * CROWD_BASE_FRACTION;
  const headRadius = glass.height * CROWD_HEAD_RADIUS_FRACTION;
  const slot = glass.width / CROWD_HEADS;
  for (let person = 0; person < CROWD_HEADS; person++) {
    const value = elementValue(seed, STREAM_INTERIOR, person);
    const centreX = glass.x + (person + 0.5) * slot;
    const shoulderY =
      glass.y + glass.height * CROWD_SHOULDER_FRACTION * (1 + value * CROWD_HEIGHT_JITTER);
    // Wide, flat shoulders under a small head. A tall narrow shoulder line meets
    // its own head and the pair reads as one blob, which is a crowd of nothing.
    const shoulderWidth = slot * (CROWD_SHOULDER_WIDTH_FACTOR + value * CROWD_HEIGHT_JITTER);
    // A quadratic reaches only halfway to its control point, so the control is
    // thrown twice as far up as the shoulder line it has to arrive at. Aiming it
    // at the shoulder itself leaves the head floating clear of the body.
    const controlY = shoulderY * 2 - baseY;
    ctx.beginPath();
    ctx.moveTo(centreX - shoulderWidth / 2, baseY);
    ctx.quadraticCurveTo(centreX, controlY, centreX + shoulderWidth / 2, baseY);
    ctx.closePath();
    ctx.fill();
    const neckGap = headRadius * CROWD_NECK_GAP_FACTOR;
    ctx.beginPath();
    ctx.arc(centreX, shoulderY - headRadius - neckGap, headRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A row of bottles on the counter: a body, a shoulder and a neck. */
function paintBottles(ctx: NodeCtx, seed: number, glass: Rect): void {
  const baseY = glass.y + glass.height;
  const slot = glass.width / BOTTLE_COUNT;
  for (let bottle = 0; bottle < BOTTLE_COUNT; bottle++) {
    const value = elementValue(seed, STREAM_INTERIOR, bottle);
    const bodyHeight = glass.height * BOTTLE_HEIGHT_FRACTION * (0.7 + value * 0.5);
    const bodyWidth = slot * BOTTLE_BODY_WIDTH_FRACTION;
    const centreX = glass.x + (bottle + 0.5) * slot;
    ctx.fillRect(centreX - bodyWidth / 2, baseY - bodyHeight, bodyWidth, bodyHeight);
    // A tall thin neck on a narrow body is a candlestick. The bottle reads from
    // the shoulder: a wide body and a short stub above it.
    const neckHeight = bodyHeight * BOTTLE_NECK_FRACTION;
    const neckWidth = bodyWidth * BOTTLE_NECK_WIDTH_FRACTION;
    ctx.fillRect(centreX - neckWidth / 2, baseY - bodyHeight - neckHeight, neckWidth, neckHeight);
  }
}

/** The Quiet Needle's pinned design sheets: rectangles at slight angles, each with its pin. */
function paintFlashArt(ctx: NodeCtx, seed: number, glass: Rect): void {
  const inset = Math.min(glass.width, glass.height) * FLASH_SHEET_INSET_FRACTION;
  const sheetWidth = (glass.width - inset * 2) / 2;
  const sheetHeight = (glass.height - inset * 2) / 2;
  for (let sheet = 0; sheet < FLASH_SHEETS; sheet++) {
    const value = elementValue(seed, STREAM_INTERIOR, sheet);
    const column = sheet % 2;
    const row = Math.floor(sheet / 2);
    const x = glass.x + inset + column * sheetWidth;
    const y = glass.y + inset + row * sheetHeight;
    const tilt = (value - 0.5) * 2 * (ELEMENT_HUE_JITTER / JOINT_WANDER_PERIOD);
    ctx.save();
    ctx.translate(x + sheetWidth / 2, y + sheetHeight / 2);
    ctx.rotate(tilt);
    ctx.fillRect(-sheetWidth / 2, -sheetHeight / 2, sheetWidth * 0.8, sheetHeight * 0.8);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x + sheetWidth / 2, y, FLASH_PIN_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A cat curled on the sill in profile: a loaf, a head and two ears. */
function paintSleepingCat(ctx: NodeCtx, glass: Rect): void {
  const bodyWidth = glass.width * CAT_BODY_WIDTH_FRACTION;
  const bodyHeight = glass.height * CAT_BODY_HEIGHT_FRACTION;
  const baseY = glass.y + glass.height;
  const centreX = glass.x + glass.width / 2;
  ctx.beginPath();
  ctx.ellipse(centreX, baseY - bodyHeight / 2, bodyWidth / 2, bodyHeight / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  const headRadius = glass.height * CAT_HEAD_RADIUS_FRACTION;
  const headX = centreX - bodyWidth / 2 + headRadius;
  const headY = baseY - bodyHeight - headRadius / 2;
  ctx.beginPath();
  ctx.arc(headX, headY, headRadius, 0, Math.PI * 2);
  ctx.fill();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(headX + side * headRadius * 0.6, headY - headRadius * 0.5);
    ctx.lineTo(headX + side * headRadius * 0.8, headY - headRadius - CAT_EAR_PX);
    ctx.lineTo(headX + side * headRadius * 0.2, headY - headRadius);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Blocks out the corners of the opening a round-headed or circular light does
 * not fill, in the frame's own timber.
 *
 * The glow behind the glass is painted into the whole rectangle, so without
 * this a bullseye window is a lit square with a circle drawn on it — the one
 * shape in the opening that is not the shape of the window.
 */
function paintSpandrels(ctx: NodeCtx, glass: Rect, light: (target: NodeCtx) => void): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(glass.x, glass.y, glass.width, glass.height);
  light(ctx);
  ctx.closePath();
  ctx.fillStyle = rgb(sampleRamp(getRamp('oak_beam'), FRAME_TONE));
  ctx.fill('evenodd');
  ctx.restore();
}

function paintGlazingBars(ctx: NodeCtx, glass: Rect, style: WindowStyle): void {
  const lead = rgba(sampleRamp(getRamp('iron_black'), BAR_TONE), BAR_ALPHA);
  const timber = rgba(sampleRamp(getRamp('oak_beam'), BAR_TONE), BAR_ALPHA);
  ctx.save();
  ctx.beginPath();
  ctx.rect(glass.x, glass.y, glass.width, glass.height);
  ctx.clip();

  switch (style) {
    case 'mullioned': {
      const columns = Math.max(2, Math.round(glass.width / PANE_NOMINAL_PX));
      const rows = Math.max(2, Math.round(glass.height / PANE_NOMINAL_PX));
      ctx.fillStyle = lead;
      for (let column = 1; column < columns; column++) {
        ctx.fillRect(glass.x + (glass.width * column) / columns, glass.y, BAR_PX, glass.height);
      }
      for (let row = 1; row < rows; row++) {
        ctx.fillRect(glass.x, glass.y + (glass.height * row) / rows, glass.width, BAR_PX);
      }
      break;
    }
    case 'shuttered':
      ctx.fillStyle = timber;
      ctx.fillRect(glass.x + glass.width / 2, glass.y, STOUT_BAR_PX, glass.height);
      break;
    case 'arched': {
      const centreX = glass.x + glass.width / 2;
      const springY = glass.y + glass.width / 2;
      paintSpandrels(ctx, glass, (target) => {
        target.moveTo(glass.x, glass.y + glass.height);
        target.lineTo(glass.x, springY);
        target.arc(centreX, springY, glass.width / 2, Math.PI, 0, false);
        target.lineTo(glass.x + glass.width, glass.y + glass.height);
      });
      ctx.fillStyle = timber;
      ctx.fillRect(glass.x, springY, glass.width, BAR_PX);
      ctx.strokeStyle = timber;
      ctx.lineWidth = BAR_PX;
      for (let bar = 1; bar < RADIAL_BAR_COUNT; bar++) {
        const angle = Math.PI + (Math.PI * bar) / RADIAL_BAR_COUNT;
        ctx.beginPath();
        ctx.moveTo(centreX, springY);
        ctx.lineTo(
          centreX + Math.cos(angle) * glass.width,
          springY + Math.sin(angle) * glass.width,
        );
        ctx.stroke();
      }
      ctx.fillRect(centreX, springY, BAR_PX, glass.height - (springY - glass.y));
      break;
    }
    case 'round': {
      const centreX = glass.x + glass.width / 2;
      const centreY = glass.y + glass.height / 2;
      const radius = Math.min(glass.width, glass.height) / 2 - ROUND_LIGHT_INSET_PX;
      paintSpandrels(ctx, glass, (target) => {
        target.moveTo(centreX + radius, centreY);
        target.arc(centreX, centreY, radius, 0, Math.PI * 2);
      });
      ctx.strokeStyle = timber;
      ctx.lineWidth = STOUT_BAR_PX;
      ctx.beginPath();
      ctx.arc(centreX, centreY, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(centreX - radius, centreY);
      ctx.lineTo(centreX + radius, centreY);
      ctx.moveTo(centreX, centreY - radius);
      ctx.lineTo(centreX, centreY + radius);
      ctx.stroke();
      break;
    }
    case 'shopfront': {
      const lowBarY = glass.y + glass.height * SHOPFRONT_LOW_BAR_FRACTION;
      ctx.fillStyle = timber;
      ctx.fillRect(glass.x, lowBarY, glass.width, STOUT_BAR_PX);
      paintStructuralLine(
        ctx,
        { x: glass.x, y: lowBarY + STOUT_BAR_PX },
        { x: glass.x + glass.width, y: lowBarY + STOUT_BAR_PX },
      );
      break;
    }
  }
  ctx.restore();
}

/**
 * The timber frame and the stone sill under it.
 *
 * Returns the sill's own bottom in plane space, because the flower box hangs off
 * it and a planter floating a pixel clear of its sill is the sort of thing a
 * viewer notices without being able to say why.
 */
function paintFrameAndSill(ctx: NodeCtx, glass: Rect, facadeBaseY: number): number {
  const frameRamp = getRamp('oak_beam');
  ctx.strokeStyle = rgb(sampleRamp(frameRamp, FRAME_TONE));
  ctx.lineWidth = FRAME_PX;
  ctx.strokeRect(glass.x, glass.y, glass.width, glass.height);

  const stone = getRamp('step_stone');
  const sillY = Math.min(glass.y + glass.height, facadeBaseY - SILL_HEIGHT_PX);
  const sillX = glass.x - SILL_OVERHANG_PX;
  const sillWidth = glass.width + SILL_OVERHANG_PX * 2;
  ctx.fillStyle = rgb(sampleRamp(stone, SILL_TONE));
  ctx.fillRect(sillX, sillY, sillWidth, SILL_HEIGHT_PX);
  paintEdgeLight(
    ctx,
    { x: sillX, y: sillY },
    { x: sillX + sillWidth, y: sillY },
    sampleRamp(stone, 1),
    SILL_LIGHT_WIDTH_PX,
    SILL_LIGHT_ALPHA,
  );

  const sillBottom = sillY + SILL_HEIGHT_PX;
  paintEdgeAo(ctx, { x: sillX, y: sillBottom, width: sillWidth, height: DRIP_REACH_PX }, 'top', {
    depth: DRIP_DEPTH,
    reach: DRIP_REACH_PX,
  });
  return sillBottom;
}

/**
 * Shutters hinged back flat against the wall on both sides.
 *
 * Open, never closed: a closed shutter hides the one feature on the facade that
 * carries any light. Each leaf is louvred or planked — chosen per window, not
 * per town, so the street does not read as one carpenter's entire output.
 */
function paintShutters(
  ctx: NodeCtx,
  noise: NoiseField,
  seed: number,
  glass: Rect,
  ramp: Ramp,
): void {
  const width = glass.width * SHUTTER_WIDTH_FRACTION;
  if (width < MIN_PAINTABLE_PX) return;
  // Keys chosen so no two of these read the same element. `side` is -1 or +1, so
  // the obvious `side + 1` and `side + 3` produced {0, 2} and {2, 4}: the louvre
  // decision shared its element with the left leaf's tone (making a louvred pair
  // always the darker one, a correlation that is never independent), and the
  // left leaf's hue shared one with the right leaf's tone.
  const louvred = elementValue(seed, STREAM_SHUTTER, SHUTTER_KEY_LOUVRE) < SHUTTER_LOUVRE_CHANCE;

  for (const side of [-1, 1]) {
    const x = side < 0 ? glass.x - width : glass.x + glass.width;
    const tone =
      SHUTTER_TONE +
      (elementValue(seed, STREAM_SHUTTER, SHUTTER_KEY_TONE + side) - 0.5) * 2 * ELEMENT_TONE_JITTER;
    const hue =
      (elementValue(seed, STREAM_SHUTTER, SHUTTER_KEY_HUE + side) - 0.5) * 2 * ELEMENT_HUE_JITTER;
    ctx.fillStyle = rgb(hueShift(sampleRamp(ramp, tone), hue));
    ctx.fillRect(x, glass.y, width, glass.height);

    ctx.fillStyle = rgba(sampleRamp(ramp, 0), SHUTTER_SLAT_ALPHA);
    if (louvred) {
      for (
        let slatY = glass.y + SHUTTER_SLAT_PX;
        slatY < glass.y + glass.height;
        slatY += SHUTTER_SLAT_PX
      ) {
        const wander = jointWander(noise, x, slatY, seed, JOINT_WANDER_PX, JOINT_WANDER_PERIOD);
        ctx.fillRect(x, slatY + wander, width, ELEMENT_EDGE_PX);
      }
    } else {
      ctx.fillRect(x + width / 2, glass.y, ELEMENT_EDGE_PX, glass.height);
    }

    ctx.fillStyle = rgba(
      sampleRamp(ramp, Math.min(1, tone + ELEMENT_TOP_LIGHT)),
      SHUTTER_EDGE_ALPHA,
    );
    ctx.fillRect(x, glass.y, width, ELEMENT_EDGE_PX);

    // The leaf stands off the wall, so it drops a shadow away from the sun onto
    // the stone it is hinged against.
    paintEdgeAo(
      ctx,
      {
        x: x + width,
        y: glass.y + SHUTTER_SHADOW_REACH_PX,
        width: SHUTTER_SHADOW_REACH_PX,
        height: glass.height,
      },
      'left',
      { depth: SHUTTER_SHADOW_DEPTH, reach: SHUTTER_SHADOW_REACH_PX },
    );
  }
}

/**
 * A planter of blob-flowers under the sill.
 *
 * Three or four saturated dots and a scatter of leaf specks. Tiny, and the
 * single highest charm-per-pixel object on any wall in the town — so the blobs
 * get a highlight each rather than being flat circles, which is what makes them
 * survive being seen at a third of this size.
 */
function paintFlowerBox(
  ctx: NodeCtx,
  seed: number,
  glass: Rect,
  sillBottom: number,
  facadeBaseY: number,
): void {
  const boxTop = Math.min(sillBottom, facadeBaseY - BOX_HEIGHT_PX);
  if (boxTop <= glass.y) return;
  const boxX = glass.x - BOX_OVERHANG_PX;
  const boxWidth = glass.width + BOX_OVERHANG_PX * 2;

  const timber = getRamp('oak_beam');
  ctx.fillStyle = rgb(sampleRamp(timber, BOX_TONE));
  ctx.fillRect(boxX, boxTop, boxWidth, BOX_HEIGHT_PX);
  ctx.fillStyle = rgb(sampleRamp(timber, BOX_RIM_TONE));
  ctx.fillRect(boxX, boxTop, boxWidth, ELEMENT_EDGE_PX);

  const petal = getRamp('flower_pink');
  const leaf = getRamp('leaf_green');
  const flowerCount =
    FLOWER_COUNT_MIN + Math.floor(elementValue(seed, STREAM_FLOWER, 0) * FLOWER_COUNT_RANGE);
  const slot = boxWidth / flowerCount;
  for (let flower = 0; flower < flowerCount; flower++) {
    const value = elementValue(seed, STREAM_FLOWER, flower + 1);
    const centreX = boxX + (flower + 0.5) * slot;
    const centreY = boxTop - FLOWER_RISE_PX * (0.6 + value * 0.8);

    ctx.fillStyle = rgb(sampleRamp(leaf, 0.5));
    for (let speck = 0; speck < LEAF_SPECKS_PER_FLOWER; speck++) {
      const speckValue = elementValue(seed, STREAM_PANE, flower * LEAF_SPECKS_PER_FLOWER + speck);
      ctx.fillRect(
        centreX + (speckValue - 0.5) * 2 * LEAF_SPREAD_PX,
        boxTop - speckValue * FLOWER_RISE_PX,
        LEAF_SPECK_PX,
        LEAF_SPECK_PX,
      );
    }

    ctx.fillStyle = rgb(sampleRamp(petal, 0.5 + value * ELEMENT_TONE_JITTER));
    ctx.beginPath();
    ctx.arc(centreX, centreY, FLOWER_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(sampleRamp(petal, FLOWER_HIGHLIGHT_TONE), FLOWER_HIGHLIGHT_ALPHA);
    ctx.fillRect(centreX - FLOWER_RADIUS_PX / 2, centreY - FLOWER_RADIUS_PX / 2, 1, 1);
  }
}
