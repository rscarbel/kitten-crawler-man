/**
 * Held-item pictures, painted once per look and reused for every frame that
 * shows that look.
 *
 * A look is one held visual at one quantised on-screen angle and one
 * foreshortening step, flat or edge-on, mirrored or not, lit or shaded, in one
 * of its phases. Each is painted already turned to its step's angle — so the
 * key light falls on the correct side of the haft for that angle — and cropped
 * to its ink. Drawing it at a socket transform then only turns it the residue
 * between the transform's angle and the step's (under half a step), and
 * stretches it the residue between the two foreshortenings, so a haft sweeping
 * through a swing never visibly snaps.
 *
 * The cache holds at most {@link HELD_ART_BUDGET_MEGABYTES}; past that the
 * look drawn longest ago is released first.
 */

import { onCanvasRecovery } from '../../core/canvasRecovery';
import {
  allocCanvas,
  allocReadableCanvas,
  type CanvasSurface,
  surfaceContext,
} from '../../core/canvasSurface';
import { BYTES_PER_MEGABYTE } from '../figure/figureCacheStats';
import { HUMAN_CELL_PX_PER_UNIT } from '../art/human/figureScale';
import { archetypeSpec } from './gripArchetypes';
import { HELD_FACINGS, type HeldFacing, type HeldVisualDef } from './heldVisualDef';
import {
  enterHeldFrame,
  heldHandleGeometry,
  heldLookOf,
  heldScreenFrame,
  type HeldScreenFrame,
  type HeldVisualTransform,
  MIN_LENGTH_SHARE,
  paintHeldItemLocal,
  paintHeldVisual,
} from './heldPaint';

type Ctx = CanvasRenderingContext2D;

/**
 * How many on-screen angles a look is painted at, round the full turn. At
 * 11.25° a step, the residue a draw turns through is at most 5.6°, too little
 * for the turned blit to soften a two-pixel haft.
 */
export const AXIS_ANGLE_STEPS = 32;
/** How many foreshortenings a look is painted at, from full length down to {@link MIN_LENGTH_SHARE}. */
export const FORESHORTENING_STEPS = 4;
/**
 * Pixels per rig unit a look is painted at, over the cell's own. The cell is
 * already twice the 32 px tile's density; painting held art denser still was
 * measured to change nothing visible at the tile while holding four times the
 * memory (the Fury of Taranis's every look: 20.9 MB against 5.4 MB).
 */
const HELD_ART_SUPERSAMPLE = 1;
export const HELD_ART_PX_PER_UNIT = HUMAN_CELL_PX_PER_UNIT * HELD_ART_SUPERSAMPLE;
/**
 * Room left round the declared handle and head for what they do not count:
 * the outline, a pommel, a spark off a blade's point, a lighter's flame glow.
 */
const INK_MARGIN_UNITS = 0.14;
/** The most every held picture together may hold resident. */
export const HELD_ART_BUDGET_MEGABYTES = 4;
const HELD_ART_BYTE_BUDGET = HELD_ART_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;
const BYTES_PER_PIXEL = 4;
/** An alpha at or under this is no ink. */
const INK_ALPHA_FLOOR = 0;
const ALPHA_CHANNEL = 3;
const FULL_TURN = Math.PI * 2;
const ANGLE_STEP = FULL_TURN / AXIS_ANGLE_STEPS;

/** One look's key. */
export interface HeldLookKey {
  readonly angleStep: number;
  readonly lengthStep: number;
  readonly facing: HeldFacing;
  readonly mirrored: boolean;
  readonly reversed: boolean;
  readonly shaded: boolean;
  readonly phase: number;
}

interface HeldPicture {
  readonly surface: CanvasSurface;
  /** Where the grip point sits on the surface, surface pixels. */
  readonly originX: number;
  readonly originY: number;
  readonly bytes: number;
}

const pictures = new Map<string, HeldPicture>();
let residentBytes = 0;

function releasePicture(key: string, picture: HeldPicture): void {
  pictures.delete(key);
  residentBytes -= picture.bytes;
  picture.surface.width = 0;
  picture.surface.height = 0;
}

// A purge leaves every cached surface blank; paint each again on demand.
onCanvasRecovery(() => {
  pictures.clear();
  residentBytes = 0;
});

/** The bytes every resident held picture holds. */
export function heldVisualCacheBytes(): number {
  return residentBytes;
}

/** How many held pictures are resident. */
export function heldVisualCacheCount(): number {
  return pictures.size;
}

function lengthShareOfStep(step: number): number {
  return MIN_LENGTH_SHARE + ((1 - MIN_LENGTH_SHARE) * step) / (FORESHORTENING_STEPS - 1);
}

function angleStepOf(angle: number): number {
  const turns = angle / ANGLE_STEP;
  return ((Math.round(turns) % AXIS_ANGLE_STEPS) + AXIS_ANGLE_STEPS) % AXIS_ANGLE_STEPS;
}

function lengthStepOf(lengthShare: number): number {
  const share = (lengthShare - MIN_LENGTH_SHARE) / (1 - MIN_LENGTH_SHARE);
  return Math.round(share * (FORESHORTENING_STEPS - 1));
}

function lookKeyOf(frame: HeldScreenFrame, phase: number, shaded: boolean): HeldLookKey {
  return {
    angleStep: angleStepOf(frame.angle),
    lengthStep: lengthStepOf(frame.lengthShare),
    facing: frame.facing,
    mirrored: frame.mirrored,
    reversed: frame.reversed,
    shaded,
    phase,
  };
}

function frameOfKey(key: HeldLookKey): HeldScreenFrame {
  return {
    angle: key.angleStep * ANGLE_STEP,
    lengthShare: lengthShareOfStep(key.lengthStep),
    mirrored: key.mirrored,
    reversed: key.reversed,
    facing: key.facing,
  };
}

function cacheKey(def: HeldVisualDef, key: HeldLookKey): string {
  return [
    def.id,
    key.angleStep,
    key.lengthStep,
    key.facing,
    String(key.mirrored),
    String(key.reversed),
    String(key.shaded),
    key.phase,
  ].join(':');
}

/** The farthest any of `def`'s ink can lie from its grip point, rig units. */
function inkReach(def: HeldVisualDef): number {
  const handle = heldHandleGeometry(def);
  const along = Math.max(-handle.buttX, handle.headBase + def.head.length);
  return Math.max(along, def.head.width, handle.halfWidth) + INK_MARGIN_UNITS;
}

let scratch: CanvasSurface | null = null;

function scratchOfSize(side: number): CanvasSurface {
  if (scratch === null || scratch.width < side || scratch.height < side) {
    scratch = allocReadableCanvas(side, side);
  }
  return scratch;
}

interface InkBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function inkBounds(data: Uint8ClampedArray, side: number): InkBounds | null {
  let left = side;
  let top = side;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (data[(y * side + x) * BYTES_PER_PIXEL + ALPHA_CHANNEL] <= INK_ALPHA_FLOOR) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** Paints one look on a scratch square, then copies its ink alone onto a surface of its own. */
function paintPicture(def: HeldVisualDef, key: HeldLookKey): HeldPicture {
  const half = Math.ceil(inkReach(def) * HELD_ART_PX_PER_UNIT);
  const side = half * 2;
  const surface = scratchOfSize(side);
  const ctx = surfaceContext(surface);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, side, side);
  ctx.save();
  const frame = frameOfKey(key);
  enterHeldFrame(ctx, frame, { x: half, y: half }, HELD_ART_PX_PER_UNIT);
  paintHeldItemLocal(ctx, def, heldLookOf(frame, key.phase, key.shaded));
  ctx.restore();
  const bounds = inkBounds(ctx.getImageData(0, 0, side, side).data, side) ?? {
    left: half,
    top: half,
    width: 1,
    height: 1,
  };
  const cropped = allocCanvas(bounds.width, bounds.height);
  surfaceContext(cropped).drawImage(
    surface,
    bounds.left,
    bounds.top,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );
  return {
    surface: cropped,
    originX: half - bounds.left,
    originY: half - bounds.top,
    bytes: bounds.width * bounds.height * BYTES_PER_PIXEL,
  };
}

function pictureFor(def: HeldVisualDef, key: HeldLookKey): HeldPicture {
  const id = cacheKey(def, key);
  const known = pictures.get(id);
  if (known !== undefined) {
    // Re-inserted so the map's order runs from least to most recently drawn.
    pictures.delete(id);
    pictures.set(id, known);
    return known;
  }
  const painted = paintPicture(def, key);
  pictures.set(id, painted);
  residentBytes += painted.bytes;
  for (const [oldest, picture] of pictures) {
    if (residentBytes <= HELD_ART_BYTE_BUDGET || oldest === id) break;
    releasePicture(oldest, picture);
  }
  return painted;
}

/**
 * Draws `def` at a socket transform from its cached pictures — the path an
 * equipment-chosen item takes, composited over a baked cell at runtime.
 */
export function drawHeldVisual(ctx: Ctx, def: HeldVisualDef, transform: HeldVisualTransform): void {
  // A scripted row's prop is placed by the row's own pose, which no cached
  // look is keyed by.
  if (transform.scripted !== undefined) {
    paintHeldVisual(ctx, def, transform);
    return;
  }
  const frame = heldScreenFrame(def, transform);
  const phase = (transform.phase ?? 0) % def.phases;
  const key = lookKeyOf(frame, phase, transform.shaded ?? false);
  const picture = pictureFor(def, key);
  const baked = frameOfKey(key);
  const toDestination = transform.scale / HELD_ART_PX_PER_UNIT;
  ctx.save();
  ctx.translate(transform.centre.x, transform.centre.y);
  ctx.rotate(frame.angle);
  ctx.scale((toDestination * frame.lengthShare) / baked.lengthShare, toDestination);
  ctx.rotate(-baked.angle);
  ctx.drawImage(picture.surface, -picture.originX, -picture.originY);
  ctx.restore();
}

/**
 * Every look `def` can be drawn in. A level-held item is never turned, only
 * reflected and never mirrored, so it has one angle, both reversals and one
 * mirroring; anything else turns
 * through every angle and is never reversed.
 */
export function* heldLookKeys(def: HeldVisualDef): Generator<HeldLookKey> {
  const level = archetypeSpec(def.archetype).heldLevel;
  const angleSteps = level ? 1 : AXIS_ANGLE_STEPS;
  const reversals = level ? [false, true] : [false];
  const flags = [false, true];
  const mirrorings = level ? [false] : flags;
  for (let angleStep = 0; angleStep < angleSteps; angleStep++) {
    for (let lengthStep = 0; lengthStep < FORESHORTENING_STEPS; lengthStep++) {
      for (const facing of HELD_FACINGS) {
        for (const mirrored of mirrorings) {
          for (const reversed of reversals) {
            for (const shaded of flags) {
              for (let phase = 0; phase < def.phases; phase++) {
                yield { angleStep, lengthStep, facing, mirrored, reversed, shaded, phase };
              }
            }
          }
        }
      }
    }
  }
}

/** What painting every look of `def` would hold: the picture count and their bytes. */
export function measureHeldVisualSet(def: HeldVisualDef): { pictures: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const key of heldLookKeys(def)) {
    const picture = paintPicture(def, key);
    count += 1;
    bytes += picture.bytes;
    picture.surface.width = 0;
    picture.surface.height = 0;
  }
  return { pictures: count, bytes };
}

/** The box `def`'s ink covers, rig units from the grip point, when drawn at `transform`'s axis and palm. */
export interface HeldInkBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Measures the box `def`'s ink covers at `transform`'s axis, palm, phase and
 * shading, by painting it once at the held-art density: the declared handle
 * and head leave out the outline, pommels and sparks, which only the picture
 * shows. `transform`'s centre and scale are ignored.
 */
export function measureHeldInk(def: HeldVisualDef, transform: HeldVisualTransform): HeldInkBox {
  const half = Math.ceil(inkReach(def) * HELD_ART_PX_PER_UNIT);
  const side = half * 2;
  const surface = scratchOfSize(side);
  const ctx = surfaceContext(surface);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, side, side);
  paintHeldVisual(ctx, def, {
    ...transform,
    centre: { x: half, y: half },
    scale: HELD_ART_PX_PER_UNIT,
  });
  const bounds = inkBounds(ctx.getImageData(0, 0, side, side).data, side);
  if (bounds === null) return { left: 0, top: 0, width: 0, height: 0 };
  return {
    left: (bounds.left - half) / HELD_ART_PX_PER_UNIT,
    top: (bounds.top - half) / HELD_ART_PX_PER_UNIT,
    width: bounds.width / HELD_ART_PX_PER_UNIT,
    height: bounds.height / HELD_ART_PX_PER_UNIT,
  };
}
