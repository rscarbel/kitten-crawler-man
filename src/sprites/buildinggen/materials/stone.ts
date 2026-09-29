/**
 * Masonry: coursed rubble, dressed ashlar and the fieldstone bases the cottages
 * stand on.
 *
 * A wall of stone is a wall of *individuals*. The thing that separates convincing
 * masonry from a brick-pattern fill is that no two blocks agree about anything —
 * width, value, hue, how square their corners are, whether they are cracked —
 * while the courses they sit in stay level enough to read as built. Every one of
 * those axes is driven off the block's index rather than a running RNG, so
 * inserting a course does not reshuffle the wall below it.
 */

import type { NoiseField } from '../../../map/tilegen/noise';
import type { Plane } from '../projection';
import { hueShift, rgb, rgba, sampleRamp, type Ramp } from '../ramps';
import { jointWander } from '../texture';
import {
  ELEMENT_BOTTOM_SHADOW,
  ELEMENT_EDGE_PX,
  ELEMENT_HUE_JITTER,
  ELEMENT_TONE_JITTER,
  ELEMENT_TOP_LIGHT,
  JOINT_WANDER_PERIOD,
  JOINT_WANDER_PX,
  elementValue,
  type Band,
} from './kit';

export interface StoneOptions {
  readonly plane: Plane;
  readonly noise: NoiseField;
  readonly seed: number;
  readonly band: Band;
  readonly ramp: Ramp;
  readonly jointRamp: Ramp;
  /** Nominal course height in pixels, before per-course jitter. */
  readonly coursePx: number;
  /** Nominal block width in pixels, before per-block jitter. */
  readonly blockPx: number;
  /** How square the blocks are: 0 is rubble, 1 is dressed ashlar. */
  readonly dressed: number;
  /** Larger, lighter corner blocks up the left and right edges. */
  readonly quoins: boolean;
}

/** Mortar width: a fraction of the course's height, plus a floor. */
const JOINT_WIDTH_PER_COURSE = 0.13;
const DRESSED_JOINT_TIGHTENING = 0.5;
const MIN_JOINT_PX = 1.4;

/** Jitter of a course's height and a block's width, as a fraction of nominal. */
const COURSE_HEIGHT_JITTER = 0.22;
const BLOCK_WIDTH_JITTER = 0.45;

/** A rubble wall's blocks sit slightly askew; a dressed one's do not. */
const RUBBLE_TILT_PX = 1.4;

/** Chance a block has lost a corner, and that one is cracked through. */
const CHIP_CHANCE = 0.08;
const CRACK_CHANCE = 0.03;
/** Keeps a crack clear of the block's own edges, where it would read as a joint. */
const CRACK_MARGIN = 0.18;

/** Quoin blocks are wider and a touch brighter than the field. */
const QUOIN_WIDTH_FACTOR = 1.45;
const QUOIN_TONE_LIFT = 0.14;

/** Streams, so two properties of one block never share a number. */
const STREAM_COURSE_HEIGHT = 1;
const STREAM_BLOCK_WIDTH = 2;
const STREAM_BLOCK_TONE = 3;
const STREAM_BLOCK_HUE = 4;
const STREAM_BLOCK_DEFECT = 5;
const STREAM_BOND = 6;
const STREAM_TILT = 7;

export function paintStone(options: StoneOptions): void {
  const { plane, seed, band, jointRamp } = options;
  const ctx = plane.ctx;
  // Wide enough to read as a recess rather than as a hairline. The painterly art
  // this replaces carries most of its local contrast in dark linework around
  // every element, and a one-pixel joint at bake scale disappears entirely once
  // the sheet is drawn down to the 32px display tile.
  const jointPx = Math.max(
    MIN_JOINT_PX,
    options.coursePx * JOINT_WIDTH_PER_COURSE * (1 - options.dressed * DRESSED_JOINT_TIGHTENING) +
      MIN_JOINT_PX,
  );

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, band.top, plane.width, band.bottom - band.top);
  ctx.clip();

  // The joint colour is laid down first and the blocks are drawn over it, so
  // every gap between two blocks is mortar by construction. Drawing joints as
  // lines afterwards leaves them landing wherever rounding put them, and a
  // one-pixel gap that misses its line is a hole in the wall.
  ctx.fillStyle = rgb(sampleRamp(jointRamp, 0.45));
  ctx.fillRect(0, band.top, plane.width, band.bottom - band.top);

  let courseIndex = 0;
  let y = band.top;
  while (y < band.bottom) {
    const heightJitter =
      1 + (elementValue(seed, STREAM_COURSE_HEIGHT, courseIndex) - 0.5) * 2 * COURSE_HEIGHT_JITTER;
    const courseHeight = Math.max(3, options.coursePx * heightJitter);
    paintCourse(options, courseIndex, y, Math.min(courseHeight, band.bottom - y), jointPx);
    y += courseHeight;
    courseIndex++;
  }

  if (options.quoins) {
    paintQuoins(options, band, jointPx);
  }

  ctx.restore();
}

function paintCourse(
  options: StoneOptions,
  courseIndex: number,
  courseTop: number,
  courseHeight: number,
  jointPx: number,
): void {
  const { plane, seed } = options;
  // A running bond, but not a half-lap one: an exact half-lap puts every second
  // vertical joint on the same x for the height of the wall, which is a grid.
  const bondOffset =
    elementValue(seed, STREAM_BOND, courseIndex) * options.blockPx * (1 - options.dressed * 0.6);

  let blockIndex = 0;
  let x = -bondOffset;
  while (x < plane.width) {
    const widthJitter =
      1 +
      (elementValue(seed, STREAM_BLOCK_WIDTH, courseIndex * 1009 + blockIndex) - 0.5) *
        2 *
        BLOCK_WIDTH_JITTER *
        (1 - options.dressed * 0.7);
    const blockWidth = Math.max(4, options.blockPx * widthJitter);
    paintBlock(options, {
      courseIndex,
      blockIndex,
      x: x + jointPx / 2,
      y: courseTop + jointPx / 2,
      width: blockWidth - jointPx,
      height: courseHeight - jointPx,
    });
    x += blockWidth;
    blockIndex++;
  }
}

interface BlockRect {
  readonly courseIndex: number;
  readonly blockIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How many discrete tones a stone's face may take, above and below the
 * ramp's own middle. A continuous jitter puts every stone at a slightly
 * different value and reads as speckle at a glance; a small fixed palette —
 * the way a painter actually mixes a batch of "stone grey" and reuses it —
 * reads as sorted, individual blocks instead.
 */
const BLOCK_TONE_STEPS = 4;

function quantizedTone(seed: number, stream: number, key: number, spread: number): number {
  const raw = elementValue(seed, stream, key);
  const step = Math.round(raw * (BLOCK_TONE_STEPS - 1)) / (BLOCK_TONE_STEPS - 1);
  return 0.5 + (step - 0.5) * 2 * spread;
}

function paintBlock(options: StoneOptions, block: BlockRect): void {
  const { plane, seed, ramp } = options;
  const ctx = plane.ctx;
  if (block.width <= 1 || block.height <= 1) return;
  const key = block.courseIndex * 1009 + block.blockIndex;

  const tone = quantizedTone(seed, STREAM_BLOCK_TONE, key, ELEMENT_TONE_JITTER);
  const hue = (elementValue(seed, STREAM_BLOCK_HUE, key) - 0.5) * 2 * ELEMENT_HUE_JITTER;
  const base = hueShift(sampleRamp(ramp, tone), hue);

  // Rubble blocks sit a degree or two off level. Rotating about the block's own
  // centre keeps the course reading as level while no individual stone is.
  const tilt =
    ((elementValue(seed, STREAM_TILT, key) - 0.5) * 2 * RUBBLE_TILT_PX * (1 - options.dressed)) /
    Math.max(1, block.width);

  ctx.save();
  ctx.translate(block.x + block.width / 2, block.y + block.height / 2);
  ctx.rotate(tilt);
  ctx.translate(-block.width / 2, -block.height / 2);

  // One flat fill, never a gradient or per-pixel fleck: a stone is a clean
  // painted shape, not a rendered bump — the two edge lines below are the
  // entire read of its volume.
  ctx.fillStyle = rgb(base);
  ctx.fillRect(0, 0, block.width, block.height);

  // Sun from above and the left: a light line along the top and left edges,
  // a shadow line along the bottom and right — one flat cel-shaded block,
  // matching the town's own upper-left light.
  ctx.fillStyle = rgb(sampleRamp(ramp, Math.min(1, tone + ELEMENT_TOP_LIGHT * 2)));
  ctx.fillRect(0, 0, block.width, ELEMENT_EDGE_PX);
  ctx.fillRect(0, 0, ELEMENT_EDGE_PX, block.height);
  ctx.fillStyle = rgb(sampleRamp(ramp, Math.max(0, tone - ELEMENT_BOTTOM_SHADOW * 2)));
  ctx.fillRect(0, block.height - ELEMENT_EDGE_PX, block.width, ELEMENT_EDGE_PX);
  ctx.fillRect(block.width - ELEMENT_EDGE_PX, 0, ELEMENT_EDGE_PX, block.height);

  const defect = elementValue(seed, STREAM_BLOCK_DEFECT, key);
  if (defect < CHIP_CHANCE) {
    paintChip(options, block, defect);
  } else if (defect < CHIP_CHANCE + CRACK_CHANCE) {
    paintCrack(options, block, defect, tone);
  }

  ctx.restore();
}

/** A lost corner, painted as mortar reclaiming the block. */
function paintChip(options: StoneOptions, block: BlockRect, defect: number): void {
  const ctx = options.plane.ctx;
  const CHIP_SIZE_FRACTION = 0.35;
  const size = Math.min(block.width, block.height) * CHIP_SIZE_FRACTION;
  const onRight = defect * 1000 - Math.floor(defect * 1000) > 0.5;
  const cornerX = onRight ? block.width : 0;
  ctx.fillStyle = rgb(sampleRamp(options.jointRamp, 0.3));
  ctx.beginPath();
  ctx.moveTo(cornerX, 0);
  ctx.lineTo(cornerX + (onRight ? -size : size), 0);
  ctx.lineTo(cornerX, size);
  ctx.closePath();
  ctx.fill();
}

/** A crack: a dark line with a lit lip below it, so it reads as depth. */
function paintCrack(options: StoneOptions, block: BlockRect, defect: number, tone: number): void {
  const ctx = options.plane.ctx;
  const CRACK_ALPHA = 0.55;
  // `defect` only ever reaches this function inside the crack interval, a narrow
  // band just above the chip chance, so scaling it directly put every crack in
  // the last sixth of its block and the top of the range past the block's own
  // right edge — which `paintBlock` does not clip. Re-spread across the interval
  // instead, so a crack can land anywhere across the face.
  const withinInterval = (defect - CHIP_CHANCE) / CRACK_CHANCE;
  const startX = block.width * (CRACK_MARGIN + withinInterval * (1 - CRACK_MARGIN * 2));
  ctx.strokeStyle = rgba(sampleRamp(options.jointRamp, 0.1), CRACK_ALPHA);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(startX, 0);
  ctx.lineTo(startX + block.width * 0.12, block.height * 0.55);
  ctx.lineTo(startX - block.width * 0.05, block.height);
  ctx.stroke();
  ctx.strokeStyle = rgba(sampleRamp(options.ramp, Math.min(1, tone + 0.2)), CRACK_ALPHA * 0.5);
  ctx.beginPath();
  ctx.moveTo(startX + 1, 0);
  ctx.lineTo(startX + block.width * 0.12 + 1, block.height * 0.55);
  ctx.stroke();
}

/**
 * Corner blocks running up both edges of the wall.
 *
 * Larger, squarer and lighter than the field, alternating long and short like
 * real quoining — that alternation is what says "someone laid these deliberately"
 * against a wall of rubble that says the opposite.
 */
function paintQuoins(options: StoneOptions, band: Band, jointPx: number): void {
  const { plane, noise, seed, ramp } = options;
  const ctx = plane.ctx;
  const longWidth = options.blockPx * QUOIN_WIDTH_FACTOR;
  const shortWidth = options.blockPx * 0.8;
  const height = options.coursePx * 1.15;

  for (const edge of [0, 1]) {
    let y = band.top;
    let index = 0;
    while (y < band.bottom) {
      const isLong = index % 2 === 0;
      const width = isLong ? longWidth : shortWidth;
      const tone = Math.min(
        1,
        0.5 +
          QUOIN_TONE_LIFT +
          (elementValue(seed, STREAM_BLOCK_TONE, index + edge * 601) - 0.5) * ELEMENT_TONE_JITTER,
      );
      const x = edge === 0 ? 0 : plane.width - width;
      const wander = jointWander(noise, x, y, seed, JOINT_WANDER_PX, JOINT_WANDER_PERIOD);
      ctx.fillStyle = rgb(sampleRamp(options.jointRamp, 0.4));
      ctx.fillRect(x, y, width, Math.min(height, band.bottom - y));
      ctx.fillStyle = rgb(sampleRamp(ramp, tone));
      ctx.fillRect(
        x + (edge === 0 ? 0 : jointPx / 2),
        y + jointPx / 2 + wander * 0.2,
        width - jointPx / 2,
        Math.min(height, band.bottom - y) - jointPx,
      );
      ctx.fillStyle = rgba(sampleRamp(ramp, Math.min(1, tone + ELEMENT_TOP_LIGHT)), 0.7);
      ctx.fillRect(x, y + jointPx / 2, width, ELEMENT_EDGE_PX);
      y += height;
      index++;
    }
  }
}
