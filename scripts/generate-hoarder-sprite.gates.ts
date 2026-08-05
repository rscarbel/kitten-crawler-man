#!/usr/bin/env tsx
/**
 * Bake gates for the Hoarder sheet. This is the `npm run gen:hoarder` entry
 * point, not the generator: a sheet that fails a gate must never reach disk.
 *
 * Every gate has an ID and every failure message carries the measured value
 * *and* the limit, because "the loop seam is 41.2 against a median of 12.8" is
 * actionable and "loop seam too large" is not.
 *
 * Run: npm run gen:hoarder
 */

import { createCanvas, loadImage } from 'canvas';
import { pathToFileURL } from 'node:url';

import {
  HOARDER_FRAME_COUNT,
  HOARDER_GORE_PARTS,
  HOARDER_VOMIT_RELEASE_FRAME,
} from '../src/sprites/hoarderSprite.js';
import { LEG_REACH, legReachDemand, torsoOutlineCurvature } from './hoarderArt.js';
import {
  GORE_STATES,
  GROUND_OFFSET_PX,
  SEGMENTS,
  type SegmentSpec,
  VOMIT_RELEASE_FRAME,
  bake,
  type BakedSheet,
  columnOffsetOf,
} from './generate-hoarder-sprite.js';

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`[${id}] ${message}`);
}

// ── Pixel access ─────────────────────────────────────────────────────────────

const INK_ALPHA_THRESHOLD = 24;
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;

interface Grid {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

async function gridOf(sheet: BakedSheet): Promise<Grid> {
  const image = await loadImage(sheet.buffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height);
  return {
    data: pixels.data,
    width: image.width,
    height: image.height,
    frameWidth: sheet.geometry.frameWidth,
    frameHeight: sheet.geometry.frameHeight,
  };
}

function alphaAt(grid: Grid, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 0;
  return grid.data[(y * grid.width + x) * CHANNELS + ALPHA_OFFSET] ?? 0;
}

function cellAlpha(grid: Grid, row: number, column: number, x: number, y: number): number {
  return alphaAt(grid, column * grid.frameWidth + x, row * grid.frameHeight + y);
}

interface InkStats {
  readonly count: number;
  readonly centroidX: number;
  readonly centroidY: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function inkStatsOf(grid: Grid, row: number, column: number, threshold: number): InkStats | null {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < grid.frameHeight; y++) {
    for (let x = 0; x < grid.frameWidth; x++) {
      if (cellAlpha(grid, row, column, x, y) < threshold) continue;
      count++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) return null;
  return { count, centroidX: sumX / count, centroidY: sumY / count, minX, maxX, minY, maxY };
}

/** Share of pixels whose ink state differs between two cells. */
function frameDelta(grid: Grid, row: number, a: number, b: number): number {
  let differing = 0;
  for (let y = 0; y < grid.frameHeight; y++) {
    for (let x = 0; x < grid.frameWidth; x++) {
      const inA = cellAlpha(grid, row, a, x, y) >= INK_ALPHA_THRESHOLD;
      const inB = cellAlpha(grid, row, b, x, y) >= INK_ALPHA_THRESHOLD;
      if (inA !== inB) differing++;
    }
  }
  return differing / (grid.frameWidth * grid.frameHeight);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const low = sorted[middle - 1] ?? 0;
  const high = sorted[middle] ?? 0;
  return sorted.length % 2 === 0 ? (low + high) / 2 : high;
}

function animationSegments(): readonly SegmentSpec[] {
  return SEGMENTS.filter((segment) => segment.kind !== 'gore');
}

// ── G1 border clip ───────────────────────────────────────────────────────────

function gateBorderClip(grid: Grid): void {
  for (const segment of SEGMENTS) {
    const base = columnOffsetOf(segment.name);
    for (let frame = 0; frame < segment.frameCount; frame++) {
      const column = base + frame;
      let worst = 0;
      for (let x = 0; x < grid.frameWidth; x++) {
        worst = Math.max(
          worst,
          cellAlpha(grid, segment.row, column, x, 0),
          cellAlpha(grid, segment.row, column, x, grid.frameHeight - 1),
        );
      }
      for (let y = 0; y < grid.frameHeight; y++) {
        worst = Math.max(
          worst,
          cellAlpha(grid, segment.row, column, 0, y),
          cellAlpha(grid, segment.row, column, grid.frameWidth - 1, y),
        );
      }
      if (worst > INK_ALPHA_THRESHOLD) {
        fail(
          'G1',
          `${segment.name}[${frame}] paints its own cell border at alpha ${worst} ` +
            `(limit ${INK_ALPHA_THRESHOLD}); the blit shears it flat and nothing downstream notices`,
        );
      }
    }
  }
}

// ── G2 anchor ────────────────────────────────────────────────────────────────

/**
 * Her feet have to land on the ground line the manifest claims, or the health
 * bar, the aggro marker and every other thing keyed off the tile sit somewhere
 * she is not.
 */
const GROUND_TOLERANCE_PX = 9;

function gateAnchor(grid: Grid, sheet: BakedSheet): void {
  // The ground line sits inside the tile, not at its bottom edge: the art is
  // drawn with the same foot placement the cat and Carl use.
  const groundY = sheet.geometry.tileY + GROUND_OFFSET_PX;
  for (const segment of animationSegments()) {
    const base = columnOffsetOf(segment.name);
    for (let frame = 0; frame < segment.frameCount; frame++) {
      const stats = inkStatsOf(grid, segment.row, base + frame, SOLID_ALPHA_THRESHOLD);
      if (stats === null) {
        fail('G2', `${segment.name}[${frame}] has no solid ink at all`);
        continue;
      }
      const drop = Math.abs(stats.maxY - groundY);
      if (drop > GROUND_TOLERANCE_PX) {
        fail(
          'G2',
          `${segment.name}[${frame}] has its lowest solid pixel ${stats.maxY} against a ground ` +
            `line at ${groundY} — ${drop.toFixed(1)}px off, limit ${GROUND_TOLERANCE_PX}`,
        );
      }
    }
  }
}

// ── G3 loop closure, G4 motion continuity, G5 centroid drift ─────────────────

const LOOP_SEAM_VS_MEDIAN = 2.1;
const LOOP_STEP_VS_MEDIAN = 2.6;
const ONE_SHOT_STEP_VS_MEDIAN = 4;
/** Deltas this small are noise; scaling them up finds a spike in a still row. */
const STEP_FLOOR_SHARE = 0.004;
/**
 * The last frame of a cycle is one step short of the first, not identical to
 * it, so the seam is only drift when it is larger than a step. Comparing the
 * two centroids against a flat pixel limit measures the sway amplitude instead.
 */
const CENTROID_SEAM_VS_STEP = 1.6;
const CENTROID_SEAM_FLOOR_PX = 1.5;

/**
 * Frames where a snap is the point. A vomit is a violent motion and the release
 * frame is meant to be the fastest thing on the sheet; the alternative is
 * loosening the limit for every row, which would hide a real pop somewhere else.
 */
const DECLARED_SPIKES: ReadonlyArray<{ readonly segment: string; readonly frame: number }> = [
  { segment: 'vomit', frame: VOMIT_RELEASE_FRAME },
  { segment: 'vomit_side', frame: VOMIT_RELEASE_FRAME },
  { segment: 'vomit_back', frame: VOMIT_RELEASE_FRAME },
];

function isDeclaredSpike(segmentName: string, frame: number): boolean {
  return DECLARED_SPIKES.some((spike) => spike.segment === segmentName && spike.frame === frame);
}

function gateLoopsAndContinuity(grid: Grid): void {
  for (const segment of animationSegments()) {
    const base = columnOffsetOf(segment.name);
    const steps: number[] = [];
    for (let frame = 1; frame < segment.frameCount; frame++) {
      steps.push(frameDelta(grid, segment.row, base + frame - 1, base + frame));
    }
    const typical = Math.max(median(steps), STEP_FLOOR_SHARE);
    const limit = segment.kind === 'loop' ? LOOP_STEP_VS_MEDIAN : ONE_SHOT_STEP_VS_MEDIAN;
    steps.forEach((step, index) => {
      if (isDeclaredSpike(segment.name, index + 1)) return;
      if (step > typical * limit) {
        fail(
          'G4',
          `${segment.name} pops between frames ${index} and ${index + 1}: ${(step * 100).toFixed(2)}% ` +
            `of the cell changed against a median of ${(typical * 100).toFixed(2)}% ` +
            `(limit ${limit}x)`,
        );
      }
    });

    if (segment.kind !== 'loop') continue;

    const seam = frameDelta(grid, segment.row, base + segment.frameCount - 1, base);
    if (seam > typical * LOOP_SEAM_VS_MEDIAN) {
      fail(
        'G3',
        `${segment.name} does not close: the last-to-first step is ${(seam * 100).toFixed(2)}% ` +
          `against a median step of ${(typical * 100).toFixed(2)}% (limit ${LOOP_SEAM_VS_MEDIAN}x)`,
      );
    }

    const centroids: Array<{ x: number; y: number }> = [];
    for (let frame = 0; frame < segment.frameCount; frame++) {
      const stats = inkStatsOf(grid, segment.row, base + frame, INK_ALPHA_THRESHOLD);
      if (stats === null) continue;
      centroids.push({ x: stats.centroidX, y: stats.centroidY });
    }
    const first = centroids[0];
    const last = centroids[centroids.length - 1];
    if (first === undefined || last === undefined) continue;
    const centroidSteps: number[] = [];
    for (let i = 1; i < centroids.length; i++) {
      const here = centroids[i];
      const before = centroids[i - 1];
      if (here === undefined || before === undefined) continue;
      centroidSteps.push(Math.hypot(here.x - before.x, here.y - before.y));
    }
    const centroidSeam = Math.hypot(last.x - first.x, last.y - first.y);
    const seamLimit = Math.max(
      CENTROID_SEAM_FLOOR_PX,
      median(centroidSteps) * CENTROID_SEAM_VS_STEP,
    );
    if (centroidSeam > seamLimit) {
      fail(
        'G5',
        `${segment.name} closes its loop ${centroidSeam.toFixed(2)}px away from where it started, ` +
          `against a typical step of ${median(centroidSteps).toFixed(2)}px ` +
          `(limit ${seamLimit.toFixed(2)}px) — she moonwalks`,
      );
    }
  }
}

// ── G6/G7 gore ───────────────────────────────────────────────────────────────

/** The runtime draws body parts at half size; a piece has to survive that. */
const GORE_RUNTIME_SCALE = 0.5;
const GORE_MIN_SHORT_AXIS_PX = 9;
const DISTINCT_MASK = 16;
const DISTINCT_IOU_LIMIT = 0.62;

function goreMask(grid: Grid, row: number, column: number): boolean[] {
  const stats = inkStatsOf(grid, row, column, INK_ALPHA_THRESHOLD);
  const mask = new Array<boolean>(DISTINCT_MASK * DISTINCT_MASK).fill(false);
  if (stats === null) return mask;
  // Scale is normalised away but aspect is not: stretching each piece to fill
  // its own bounding box maps every convex blob onto a filled square, which
  // measures the normalisation rather than the art.
  const span = Math.max(stats.maxX - stats.minX, stats.maxY - stats.minY) + 1;
  const originX = (stats.minX + stats.maxX) / 2 - span / 2;
  const originY = (stats.minY + stats.maxY) / 2 - span / 2;
  for (let my = 0; my < DISTINCT_MASK; my++) {
    for (let mx = 0; mx < DISTINCT_MASK; mx++) {
      const x = Math.round(originX + ((mx + 0.5) / DISTINCT_MASK) * span);
      const y = Math.round(originY + ((my + 0.5) / DISTINCT_MASK) * span);
      mask[my * DISTINCT_MASK + mx] = cellAlpha(grid, row, column, x, y) >= INK_ALPHA_THRESHOLD;
    }
  }
  return mask;
}

function gateGore(grid: Grid): void {
  const goreSegment = SEGMENTS.find((segment) => segment.kind === 'gore');
  if (goreSegment === undefined) {
    fail('G6', 'there is no gore segment in SEGMENTS at all');
    return;
  }
  const base = columnOffsetOf(goreSegment.name);

  GORE_STATES.forEach((state, index) => {
    const stats = inkStatsOf(grid, goreSegment.row, base + index, INK_ALPHA_THRESHOLD);
    if (stats === null) {
      fail('G6', `${state} painted nothing`);
      return;
    }
    const shortAxis =
      Math.min(stats.maxX - stats.minX, stats.maxY - stats.minY) * GORE_RUNTIME_SCALE;
    if (shortAxis < GORE_MIN_SHORT_AXIS_PX) {
      fail(
        'G6',
        `${state} is ${shortAxis.toFixed(1)}px across its short axis on screen ` +
          `(limit ${GORE_MIN_SHORT_AXIS_PX}px) — it reads as a speck`,
      );
    }
  });

  const masks = GORE_STATES.map((_, index) => goreMask(grid, goreSegment.row, base + index));
  for (let a = 0; a < masks.length; a++) {
    for (let b = a + 1; b < masks.length; b++) {
      const maskA = masks[a];
      const maskB = masks[b];
      if (maskA === undefined || maskB === undefined) continue;
      let intersection = 0;
      let union = 0;
      for (let i = 0; i < maskA.length; i++) {
        const inA = maskA[i] === true;
        const inB = maskB[i] === true;
        if (inA && inB) intersection++;
        if (inA || inB) union++;
      }
      const iou = union === 0 ? 0 : intersection / union;
      if (iou > DISTINCT_IOU_LIMIT) {
        fail(
          'G7',
          `${GORE_STATES[a]} and ${GORE_STATES[b]} share ${(iou * 100).toFixed(0)}% of their ` +
            `silhouette (limit ${(DISTINCT_IOU_LIMIT * 100).toFixed(0)}%) — they tumble as the same blob`,
        );
      }
    }
  }
}

// ── G8 reach headroom, G9 foot slide ─────────────────────────────────────────

/**
 * A stride that clamps on even one frame reads as a hop: the leg locks dead
 * straight, the foot hangs off the floor and the next tuck snaps it back.
 */
function gateReachHeadroom(): void {
  for (const segment of animationSegments()) {
    const { pose, view } = segment;
    if (pose === null) continue;
    for (let frame = 0; frame < segment.frameCount; frame++) {
      const demand = legReachDemand(pose(frame), view);
      for (const [name, span] of [
        ['left', demand.left],
        ['right', demand.right],
      ] as const) {
        if (span > LEG_REACH) {
          fail(
            'G8',
            `${segment.name}[${frame}] asks the ${name} leg for ${span.toFixed(4)} against a reach ` +
              `of ${LEG_REACH.toFixed(4)} — the IK clamps and the step reads as a hop`,
          );
        }
      }
    }
  }
}

/** How far a planted foot may move between frames, in figure units. */
const FOOT_SLIDE_LIMIT = 0.002;
const PLANTED_LIFT_EPSILON = 1e-6;

/**
 * A planted foot must not move sideways, and a foot sliding backward under a
 * moving body must step monotonically. Both are the same defect seen twice —
 * the moonwalk — and neither shows up in any pixel measurement.
 */
function gateFootSlide(): void {
  const walkSideSegment = SEGMENTS.find((segment) => segment.name === 'walk_side');
  if (walkSideSegment === undefined || walkSideSegment.pose === null) {
    fail('G9', 'there is no walk_side segment to measure a planted foot on');
    return;
  }
  const { pose, frameCount } = walkSideSegment;
  let previousX: number | null = null;
  for (let frame = 0; frame < frameCount; frame++) {
    const here = pose(frame);
    const planted = here.rightFoot.y >= -PLANTED_LIFT_EPSILON;
    if (!planted) {
      previousX = null;
      continue;
    }
    if (previousX !== null) {
      const step = here.rightFoot.x - previousX;
      // Stance travel is backward by construction; a forward step is the foot
      // being dragged along with the body, which is exactly the moonwalk.
      if (step > FOOT_SLIDE_LIMIT) {
        fail(
          'G9',
          `walk_side[${frame}] drags the planted right foot forward by ${step.toFixed(4)} ` +
            `(limit ${FOOT_SLIDE_LIMIT})`,
        );
      }
    }
    previousX = here.rightFoot.x;
  }
}

// ── G14 the silhouette has no corners ────────────────────────────────────────

/**
 * The tightest turn the flesh outline is allowed, in figure units. Roughly a
 * seventh of her half-width: a fat body is a stack of long shallow arcs, and
 * anything much tighter than this stops reading as flesh and starts reading as
 * a fold in cardboard. It went in after the outline was found turning inside a
 * hundredth of a tile — a mathematical curve and a visual corner.
 */
const MIN_OUTLINE_RADIUS = 0.1;

function gateSilhouetteCurvature(): void {
  let worstRadius = Infinity;
  let worstAt = '';
  let worstY = 0;
  for (const segment of animationSegments()) {
    const { pose, view } = segment;
    if (pose === null) continue;
    for (let frame = 0; frame < segment.frameCount; frame++) {
      const tightest = torsoOutlineCurvature(pose(frame), view);
      if (tightest.radius >= worstRadius) continue;
      worstRadius = tightest.radius;
      worstAt = `${segment.name}[${frame}]`;
      worstY = tightest.y;
    }
  }
  if (worstRadius === Infinity) {
    fail('G14', 'there are no posed rows to measure the silhouette on');
    return;
  }
  if (worstRadius < MIN_OUTLINE_RADIUS) {
    fail(
      'G14',
      `${worstAt} turns the silhouette inside ${worstRadius.toFixed(4)} at y ${worstY.toFixed(3)} ` +
        `(limit ${MIN_OUTLINE_RADIUS}) — that is a corner, not a body`,
    );
    return;
  }
  console.log(
    `  G14 silhouette: tightest turn ${worstRadius.toFixed(4)} of ${MIN_OUTLINE_RADIUS} ` +
      `at ${worstAt}, y ${worstY.toFixed(3)}`,
  );
}

// ── G10 release is the peak ──────────────────────────────────────────────────

function gateReleaseIsThePeak(): void {
  const vomitRows = animationSegments().filter((segment) => segment.name.startsWith('vomit'));
  if (vomitRows.length === 0) {
    fail('G10', 'there are no vomit rows to check the release frame against');
    return;
  }
  for (const segment of vomitRows) {
    if (segment.pose === null) continue;
    const { pose } = segment;
    let peakFrame = 0;
    let peakGape = -Infinity;
    for (let frame = 0; frame < segment.frameCount; frame++) {
      const gape = pose(frame).mouth;
      if (gape > peakGape) {
        peakGape = gape;
        peakFrame = frame;
      }
    }
    if (peakFrame !== VOMIT_RELEASE_FRAME) {
      fail(
        'G10',
        `${segment.name} opens widest on frame ${peakFrame} but the bile is released on ` +
          `frame ${VOMIT_RELEASE_FRAME} — the projectile appears before or after her jaw drops`,
      );
    }
  }
}

// ── G11/G12 contracts with the runtime ───────────────────────────────────────

function gateRuntimeContract(): void {
  if (VOMIT_RELEASE_FRAME !== HOARDER_VOMIT_RELEASE_FRAME) {
    fail(
      'G11',
      `the generator releases on frame ${VOMIT_RELEASE_FRAME} and the runtime expects ` +
        `${HOARDER_VOMIT_RELEASE_FRAME}`,
    );
  }
  // Every animated row, not just the vomit one, and a row the runtime has never
  // heard of is a failure rather than a skip: a gate that cannot find its
  // subject reports "all gates passed" while measuring nothing.
  const declared: Record<string, number> = { ...HOARDER_FRAME_COUNT };
  for (const segment of animationSegments()) {
    const runtimeCount = declared[segment.name];
    if (runtimeCount === undefined) {
      fail('G11', `the sheet has a row "${segment.name}" the runtime does not declare`);
      continue;
    }
    if (runtimeCount !== segment.frameCount) {
      fail(
        'G11',
        `the ${segment.name} row bakes ${segment.frameCount} frames and the runtime declares ` +
          `${runtimeCount}; the shorter of the two is the one that freezes`,
      );
    }
  }
  for (const name of Object.keys(declared)) {
    if (animationSegments().some((segment) => segment.name === name)) continue;
    fail('G11', `the runtime declares a row "${name}" the sheet does not bake`);
  }

  const generated = GORE_STATES.join(',');
  const runtime = HOARDER_GORE_PARTS.join(',');
  if (generated !== runtime) {
    fail(
      'G12',
      `the sheet's gore columns are [${generated}] and HOARDER_GORE_PARTS is [${runtime}]; ` +
        'a part that is not in both is silently skipped at draw time',
    );
  }
}

// ── G13 texture budget ───────────────────────────────────────────────────────

const MEGA = 1_000_000;
/** She is a boss with three views of three states; this is the ceiling for that. */
const TEXTURE_BUDGET_MEGAPIXELS = 6;

function gateTextureSize(sheet: BakedSheet): void {
  const megapixels =
    (sheet.columns * sheet.geometry.frameWidth * sheet.rows * sheet.geometry.frameHeight) / MEGA;
  console.log(`  texture: ${megapixels.toFixed(2)} Mpx of ${TEXTURE_BUDGET_MEGAPIXELS} allowed`);
  if (megapixels > TEXTURE_BUDGET_MEGAPIXELS) {
    fail(
      'G13',
      `the sheet is ${megapixels.toFixed(2)} Mpx against a budget of ` +
        `${TEXTURE_BUDGET_MEGAPIXELS} Mpx`,
    );
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function runGates(): Promise<void> {
  const sheet = bake();
  const grid = await gridOf(sheet);

  gateBorderClip(grid);
  gateAnchor(grid, sheet);
  gateLoopsAndContinuity(grid);
  gateGore(grid);
  gateReachHeadroom();
  gateFootSlide();
  gateSilhouetteCurvature();
  gateReleaseIsThePeak();
  gateRuntimeContract();
  gateTextureSize(sheet);

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} gates failed; nothing was written:\n  ${failures.join('\n  ')}`,
    );
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runGates()
    .then(async () => {
      const { writeSheet } = await import('./generate-hoarder-sprite.js');
      writeSheet();
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}

export { runGates };
