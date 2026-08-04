#!/usr/bin/env tsx
/**
 * The bake gate for the Bugaboo sheet, and the entry point `npm run gen:bugaboo`
 * runs — **not** `generate-bugaboo-sprite.ts` itself.
 *
 * A sheet that fails a gate must never reach disk. This module bakes into
 * memory, measures the baked pixels and the pose stream, throws with a numeric
 * message naming what it measured and what the limit was, and only then lets
 * the generator write.
 *
 * Every gate here exists because something on this figure was wrong in a way
 * that `typecheck`, `lint` and reading the drawing code could not see.
 */

import { createCanvas, loadImage, type Canvas } from 'canvas';
import { pathToFileURL } from 'url';

import {
  BREACH_FRAMES,
  GROUND_OFFSET_PX,
  ROWS,
  FIGURE_SCALE,
  SWIPE_IMPACT_FRAME,
  TILE_SCALE,
  bake,
  breach,
  swipeSide,
  verifyManifest,
  type BakedSheet,
} from './generate-bugaboo-sprite';
import {
  ARM_LENGTH,
  BREACH_FLOOR_Y,
  JOINT_SLACK,
  HIP_Y,
  SHIN_LENGTH,
  SUBMERGE_DEPTH,
  THIGH_LENGTH,
  ankleFor,
  solvedArm,
  solvedLegRoot,
} from './bugabooArt';
import { BUGABOO_SWIPE_FRAMES, BUGABOO_SWIPE_IMPACT_FRAME } from '../src/sprites/bugabooSprite.js';

/** Alpha above which a pixel counts as painted. */
const INK_ALPHA_THRESHOLD = 24;
/** Alpha above which a pixel counts as *solid* ink rather than a soft edge. */
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;

interface Grid {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

async function decode(sheet: BakedSheet): Promise<Canvas> {
  const image = await loadImage(sheet.buffer);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas;
}

function gridOf(canvas: Canvas): Grid {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data };
}

interface Cell {
  readonly col: number;
  readonly row: number;
}

/** Every painted pixel of one cell, as a flat alpha array. */
function cellAlpha(grid: Grid, sheet: BakedSheet, cell: Cell): Uint8ClampedArray {
  const { frameWidth, frameHeight } = sheet.geometry;
  const out = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let y = 0; y < frameHeight; y++) {
    const sourceRow = (cell.row * frameHeight + y) * grid.width;
    for (let x = 0; x < frameWidth; x++) {
      out[y * frameWidth + x] =
        grid.data[(sourceRow + cell.col * frameWidth + x) * CHANNELS + ALPHA_OFFSET];
    }
  }
  return out;
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

function inkStatsOf(
  alpha: Uint8ClampedArray,
  width: number,
  threshold = INK_ALPHA_THRESHOLD,
): InkStats {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < threshold) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    count++;
    sumX += x;
    sumY += y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    count,
    centroidX: count === 0 ? 0 : sumX / count,
    centroidY: count === 0 ? 0 : sumY / count,
    minX,
    maxX,
    minY,
    maxY,
  };
}

/** How many pixels differ between two cells of the same size. */
function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] >= INK_ALPHA_THRESHOLD !== b[i] >= INK_ALPHA_THRESHOLD) differing++;
  }
  return differing;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function cellsOf(grid: Grid, sheet: BakedSheet, rowIndex: number, count: number) {
  return Array.from({ length: count }, (_unused, col) =>
    cellAlpha(grid, sheet, { col, row: rowIndex }),
  );
}

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

// ── Pixel gates ──────────────────────────────────────────────────────────────

/**
 * `G1` — no ink on any cell border.
 *
 * A frame that paints outside its cell is sheared flat by the sheet blit and
 * baked in, and nothing downstream can detect it.
 */
function gateBorderClip(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth, frameHeight } = sheet.geometry;
  ROWS.forEach((row, rowIndex) => {
    for (let col = 0; col < row.frameCount; col++) {
      const stats = inkStatsOf(cellAlpha(grid, sheet, { col, row: rowIndex }), frameWidth);
      if (stats.count === 0) {
        fail('G1', `${row.name}[${col}] painted nothing at all`);
        continue;
      }
      if (
        stats.minX === 0 ||
        stats.minY === 0 ||
        stats.maxX === frameWidth - 1 ||
        stats.maxY === frameHeight - 1
      ) {
        fail(
          'G1',
          `${row.name}[${col}] paints on its cell border (ink box ${stats.minX}..${stats.maxX} × ` +
            `${stats.minY}..${stats.maxY} in a ${frameWidth}×${frameHeight} cell)`,
        );
      }
    }
  });
}

/**
 * `G2` — the creature's feet stand where `tileY` claims the ground is.
 *
 * A redraw silently moves the tile anchor, and health bars and aggro markers
 * key off it. Measured against *solid* ink, because the contact shadow is a
 * radial gradient that legitimately spreads past the feet, and on the idle rows
 * only: nothing standing in a hole in the floor has feet on it.
 */
const FOOT_TOLERANCE_PX = 6;
const STANDING_ROWS = ['idle', 'idle_side', 'idle_away'] as const;

function gateAnchor(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth, tileY } = sheet.geometry;
  const groundY = tileY + GROUND_OFFSET_PX;
  for (const name of STANDING_ROWS) {
    const rowIndex = ROWS.findIndex((row) => row.name === name);
    if (rowIndex < 0) continue;
    const alpha = cellAlpha(grid, sheet, { col: 0, row: rowIndex });
    const stats = inkStatsOf(alpha, frameWidth, SOLID_ALPHA_THRESHOLD);
    const drop = Math.abs(stats.maxY - groundY);
    if (drop > FOOT_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] has its lowest solid ink at y=${stats.maxY} against a ground line of ` +
          `${groundY} (tileY ${tileY} + ${GROUND_OFFSET_PX}) — ${drop.toFixed(1)}px off, ` +
          `limit ${FOOT_TOLERANCE_PX}`,
      );
    }
  }
}

/**
 * `G3` — a looping row's last→first delta is no worse than the steps inside it.
 *
 * This is the gate that catches a walk that pops once per cycle, which is
 * invisible on a contact sheet because every individual frame is fine. The
 * comparison is against the median step *and* the largest legitimate step in
 * the cycle: a sine-driven idle is steepest at its own zero crossing, which
 * lands on the seam by construction.
 */
const LOOP_SEAM_LIMIT = 2.1;
const LOOP_SEAM_VS_WORST_STEP = 1.25;

function gateLoopClosure(grid: Grid, sheet: BakedSheet): void {
  ROWS.forEach((row, rowIndex) => {
    if (row.kind !== 'loop') return;
    const cells = cellsOf(grid, sheet, rowIndex, row.frameCount);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    if (typical === 0) return;
    const allowed = Math.max(
      typical * LOOP_SEAM_LIMIT,
      Math.max(...steps) * LOOP_SEAM_VS_WORST_STEP,
    );
    if (seam > allowed) {
      fail(
        'G3',
        `${row.name} pops across its loop seam: last→first differs by ${seam}px against a median ` +
          `step of ${typical}px (allowed ${allowed.toFixed(0)}px)`,
      );
    }
  });
}

/**
 * `G4` — no consecutive-frame step far above the row's own median.
 *
 * Catches a snapped knee, a mid-swing draw-order flip and an IK clamp. The
 * one-shot rows are allowed a bigger spike than the loops, because a strike is
 * *meant* to have one violent frame in it — that is what a strike is.
 */
const LOOP_STEP_LIMIT = 2.6;
const ONE_SHOT_STEP_LIMIT = 4;
/**
 * A step this small is not visible however large its ratio to the row's median.
 * Without a floor the gate is loudest on the rows that move least.
 */
const STEP_FLOOR_SHARE = 0.005;

function gateMotionContinuity(grid: Grid, sheet: BakedSheet): void {
  ROWS.forEach((row, rowIndex) => {
    const limit = row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT;
    const cells = cellsOf(grid, sheet, rowIndex, row.frameCount);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const typical = median(steps);
    if (typical === 0) return;
    const floor = sheet.geometry.frameWidth * sheet.geometry.frameHeight * STEP_FLOOR_SHARE;
    steps.forEach((step, i) => {
      const ratio = step / typical;
      if (ratio > limit && step > floor) {
        fail(
          'G4',
          `${row.name} jumps between frames ${i} and ${i + 1}: ${step}px against a median of ` +
            `${typical}px (${ratio.toFixed(2)}×, limit ${limit})`,
        );
      }
    });
  });
}

/**
 * `G5` — a walk cycle does not slide in place.
 *
 * The creature's ink centroid may bob, but over a full loop it must come back
 * to where it started: a centroid that has drifted by the end of the cycle is a
 * figure moonwalking on the spot.
 */
/**
 * The seam is one step like any other, so it is judged against the steps inside
 * the cycle rather than against a flat pixel count. A flat limit measures how
 * energetic the animation is: a brisk 16-frame walk moves its centroid two
 * pixels every frame, and the seam is then held to a standard no frame of the
 * row meets.
 */
const CENTROID_SEAM_LIMIT = 1.6;
/**
 * The seam of a walk lands on contact, which is where the swing leg is
 * travelling fastest — so it is legitimately near the largest step in the
 * cycle, and measured against the median alone a correct walk fails.
 */
const CENTROID_SEAM_VS_WORST_STEP = 1.25;
const CENTROID_SEAM_FLOOR_PX = 1;

function gateCentroidDrift(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth } = sheet.geometry;
  ROWS.forEach((row, rowIndex) => {
    if (row.kind !== 'loop') return;
    const centroids = cellsOf(grid, sheet, rowIndex, row.frameCount).map((cell) =>
      inkStatsOf(cell, frameWidth),
    );
    const stepBetween = (a: InkStats, b: InkStats): number =>
      Math.hypot(b.centroidX - a.centroidX, b.centroidY - a.centroidY);
    const steps: number[] = [];
    for (let i = 1; i < centroids.length; i++)
      steps.push(stepBetween(centroids[i - 1], centroids[i]));
    const seam = stepBetween(centroids[centroids.length - 1], centroids[0]);
    const allowed = Math.max(
      median(steps) * CENTROID_SEAM_LIMIT,
      Math.max(...steps) * CENTROID_SEAM_VS_WORST_STEP,
      CENTROID_SEAM_FLOOR_PX,
    );
    if (seam > allowed) {
      fail(
        'G5',
        `${row.name}'s centroid jumps ${seam.toFixed(2)}px across its loop seam against a median ` +
          `in-cycle step of ${median(steps).toFixed(2)}px (allowed ${allowed.toFixed(2)}px) — it ` +
          `is sliding on the spot`,
      );
    }
  });
}

/**
 * `G6` — the arm out of a breach is always well clear of the hole's lip.
 *
 * The whole point of that row is a hand coming up out of the floor: on any
 * frame where the arm is down inside the hole there is nothing to see but
 * rubble, and the player standing on a tile that is quietly damaging them has
 * no idea why. Measured as the height of the topmost ink above the floor line.
 */
const BREACH_MIN_REACH_TILES = 0.45;

function gateBreachReach(grid: Grid, sheet: BakedSheet): void {
  const rowIndex = ROWS.findIndex((row) => row.name === 'breach');
  if (rowIndex < 0) return;
  const { frameWidth, tileY } = sheet.geometry;
  // Figure units scale by the tile size *and* the figure's own scale factor;
  // the tile size alone is the trap, and it is only a third of a pixel out
  // today because the floor line happens to sit near the origin.
  const floorY = tileY + GROUND_OFFSET_PX + BREACH_FLOOR_Y * TILE_SCALE * FIGURE_SCALE;
  for (let col = 0; col < BREACH_FRAMES; col++) {
    const stats = inkStatsOf(cellAlpha(grid, sheet, { col, row: rowIndex }), frameWidth);
    const reach = (floorY - stats.minY) / TILE_SCALE;
    if (reach < BREACH_MIN_REACH_TILES) {
      fail(
        'G6',
        `breach[${col}] reaches only ${reach.toFixed(3)} tiles above the floor line ` +
          `(limit ${BREACH_MIN_REACH_TILES}) — on that frame there is nothing out of the hole`,
      );
    }
  }
}

/**
 * `G7` — an attack row hands back to the stance it was entered from.
 *
 * The runtime plays a swipe and then goes straight back to idling. A row whose
 * first and last frames are still mid-swing pops twice per attack, at the
 * shoulders, which is exactly where the player is already looking.
 */
const SETTLE_LIMIT_SHARE = 0.045;
const ONE_SHOT_SETTLES: ReadonlyArray<readonly [string, string]> = [
  ['swipe', 'idle'],
  ['swipe_side', 'idle_side'],
  ['swipe_away', 'idle_away'],
  ['emerge', 'idle'],
];

function gateOneShotSettle(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth, frameHeight } = sheet.geometry;
  const limit = frameWidth * frameHeight * SETTLE_LIMIT_SHARE;
  for (const [shot, stance] of ONE_SHOT_SETTLES) {
    const shotRow = ROWS.findIndex((row) => row.name === shot);
    const stanceRow = ROWS.findIndex((row) => row.name === stance);
    if (shotRow < 0 || stanceRow < 0) continue;
    const lastFrame = ROWS[shotRow].frameCount - 1;
    const delta = frameDelta(
      cellAlpha(grid, sheet, { col: lastFrame, row: shotRow }),
      cellAlpha(grid, sheet, { col: 0, row: stanceRow }),
    );
    if (delta > limit) {
      fail(
        'G7',
        `${shot}'s last frame differs from ${stance}[0] by ${delta}px (limit ${limit.toFixed(0)}) ` +
          `— the attack hands off to a different pose than the one it returns to`,
      );
    }
  }
}

/**
 * `G8` — the sheet is not quietly getting expensive.
 *
 * Reported even when it passes: every sheet in this game is preloaded at boot
 * and held decoded, so a row added without thought is memory nobody sees spent.
 */
/**
 * Set just above what eleven rows of this figure actually need, so a row added
 * without thought fails rather than quietly costing three megabytes. The cell
 * is as wide as it is because of one frame — the windup, where the trailing arm
 * passes through horizontal while the leading one is already overhead — and
 * every row on the sheet pays for it.
 */
const TEXTURE_BUDGET_MEGAPIXELS = 5.6;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

function gateTextureSize(sheet: BakedSheet): void {
  const pixels =
    sheet.columns * sheet.geometry.frameWidth * ROWS.length * sheet.geometry.frameHeight;
  const megapixels = pixels / 1e6;
  console.log(
    `  texture: ${megapixels.toFixed(2)}MP, ` +
      `${((pixels * BYTES_PER_PIXEL) / BYTES_PER_MEGABYTE).toFixed(1)}MB decoded`,
  );
  if (megapixels > TEXTURE_BUDGET_MEGAPIXELS) {
    fail(
      'G8',
      `the sheet is ${megapixels.toFixed(2)} megapixels against a budget of ` +
        `${TEXTURE_BUDGET_MEGAPIXELS} — it is preloaded and held decoded at boot`,
    );
  }
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

/**
 * `G9` — a planted foot stays planted.
 *
 * The classic moonwalk, and the one defect a contact sheet is completely blind
 * to: every individual frame looks correct. A planted foot sliding *backward*
 * under the body at a constant rate is what a stance phase is; travelling
 * forward is what it must never do.
 */
const FOOT_DOWN_LIMIT = 0.002;

function gateFootSlide(): void {
  const row = ROWS.find((spec) => spec.name === 'walk_side');
  if (row === undefined) return;
  let previous: { left: number; right: number; leftDown: boolean; rightDown: boolean } | null =
    null;
  for (let frame = 0; frame < row.frameCount; frame++) {
    const pose = row.pose(frame);
    const current = {
      left: pose.leftFoot.x,
      right: pose.rightFoot.x,
      leftDown: pose.leftFoot.y >= -FOOT_DOWN_LIMIT,
      rightDown: pose.rightFoot.y >= -FOOT_DOWN_LIMIT,
    };
    if (previous !== null) {
      for (const side of ['left', 'right'] as const) {
        const down =
          side === 'left'
            ? current.leftDown && previous.leftDown
            : current.rightDown && previous.rightDown;
        if (down && current[side] > previous[side]) {
          fail(
            'G9',
            `walk_side's ${side} foot is planted and travels forward between frames ` +
              `${frame - 1} and ${frame} (${previous[side].toFixed(4)} → ` +
              `${current[side].toFixed(4)}) — that is a moonwalk`,
          );
        }
      }
    }
    previous = current;
  }
}

/**
 * `G10` — the legs never have to reach further than they are long.
 *
 * A stride that clamps on even one frame reads as a hop: the leg locks dead
 * straight with its foot hanging above the floor, and the next frame's tuck
 * snaps the knee back in. The margin is thin by construction — the legs are
 * within half a percent of the hip height — so this is measured on every frame
 * of every row rather than spot-checked.
 */
const LEG_REACH_LIMIT = THIGH_LENGTH + SHIN_LENGTH - JOINT_SLACK;

function gateLegReach(): void {
  let worst = 0;
  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = row.pose(frame);
      for (const [side, foot, pitch] of [
        ['left', pose.leftFoot, pose.leftFootPitch],
        ['right', pose.rightFoot, pose.rightFootPitch],
      ] as const) {
        const root = solvedLegRoot(pose, row.view, side);
        const ankle = ankleFor(foot, pitch);
        const reach = Math.hypot(ankle.x - root.x, ankle.y - root.y);
        worst = Math.max(worst, reach);
        if (reach > LEG_REACH_LIMIT) {
          fail(
            'G10',
            `${row.name}[${frame}]'s ${side} leg has to reach ${reach.toFixed(4)} from its root ` +
              `against a leg ${LEG_REACH_LIMIT.toFixed(4)} long — the IK clamps and the step ` +
              `becomes a hop`,
          );
        }
      }
    }
  }
  console.log(`  leg reach: worst frame ${worst.toFixed(4)} of ${LEG_REACH_LIMIT.toFixed(4)}`);
}

/**
 * `G11` — no arm is clamped, and no elbow is folded flat against itself.
 *
 * Two different faults, and a clamp check alone sees only the first.
 *
 * Unlike Carl's equivalent this does *not* demand a near-straight arm. These
 * arms are more than half the creature's height, so almost every deliberate
 * pose folds them hard — a hand reaching out of a floor hole spans a third of
 * its own arm and is correct. What is never correct is a joint folded past the
 * point where the two segments lie on top of each other, which the solver will
 * happily produce and which reads as an arm with no elbow at all.
 */
const CLAMP_TOLERANCE = 0.0005;
const MIN_ELBOW_DEGREES = 25;
const DEGREES_PER_RADIAN = 180 / Math.PI;

function gateArmReach(): void {
  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = row.pose(frame);
      for (const [side, hand, angles] of [
        ['left', pose.leftHand, pose.leftArmAngles],
        ['right', pose.rightHand, pose.rightArmAngles],
      ] as const) {
        const chain = solvedArm(pose, row.view, side);
        const upper = Math.hypot(chain.joint.x - chain.root.x, chain.joint.y - chain.root.y);
        const lower = Math.hypot(chain.end.x - chain.joint.x, chain.end.y - chain.joint.y);
        const span = Math.hypot(chain.end.x - chain.root.x, chain.end.y - chain.root.y);
        const cosine = (upper * upper + lower * lower - span * span) / (2 * upper * lower);
        const elbow = Math.acos(Math.min(1, Math.max(-1, cosine))) * DEGREES_PER_RADIAN;
        if (elbow < MIN_ELBOW_DEGREES) {
          fail(
            'G11',
            `${row.name}[${frame}]'s ${side} elbow is folded to ${elbow.toFixed(1)}° ` +
              `(limit ${MIN_ELBOW_DEGREES}°) — the two segments lie along each other and the ` +
              `arm reads as having no joint`,
          );
        }
        // Only an arm placed by a hand *target* can clamp; the FK-driven walk
        // and smash arms carry their own length by construction.
        if (angles !== null) continue;
        const moved = Math.hypot(chain.end.x - hand.x, chain.end.y - hand.y);
        if (moved > CLAMP_TOLERANCE) {
          fail(
            'G11',
            `${row.name}[${frame}]'s ${side} hand target is beyond an arm ` +
              `${ARM_LENGTH.toFixed(4)} long, so the IK clamped it ${moved.toFixed(4)} short and ` +
              `locked the elbow straight`,
          );
        }
      }
    }
  }
}

/**
 * `G12` — the strike peaks on the frame the mob deals its damage.
 *
 * `Bugaboo` fires its hit on {@link SWIPE_IMPACT_FRAME}. A timing table that
 * drifted from the choreography puts the claws at full reach two frames after
 * the player has already been clawed.
 */
function gateImpactIsThePeak(): void {
  const row = ROWS.find((spec) => spec.name === 'swipe_side');
  if (row === undefined) return;
  let peakFrame = 0;
  let furthest = -Infinity;
  for (let frame = 0; frame < row.frameCount; frame++) {
    const reach = swipeSide(frame / (row.frameCount - 1)).rightHand.x;
    if (reach > furthest) {
      furthest = reach;
      peakFrame = frame;
    }
  }
  if (peakFrame !== SWIPE_IMPACT_FRAME) {
    fail(
      'G12',
      `swipe_side reaches furthest on frame ${peakFrame} but the mob deals damage on frame ` +
        `${SWIPE_IMPACT_FRAME} — the timing table and the choreography have drifted apart`,
    );
  }
}

/**
 * `G13` — the runtime's copy of the impact frame matches the bake's.
 *
 * `src/sprites/bugabooSprite.ts` cannot import from `scripts/` (rootDir is
 * `src/`), so the number is duplicated. This is the only thing that notices.
 */
function gateImpactContract(): void {
  const baked = ROWS.find((row) => row.name === 'swipe_side')?.frameCount ?? 0;
  if (BUGABOO_SWIPE_FRAMES !== baked) {
    fail(
      'G13',
      `the bake gives a swipe ${baked} frames but BUGABOO_SWIPE_FRAMES in ` +
        `src/sprites/bugabooSprite.ts is ${BUGABOO_SWIPE_FRAMES} — the mob would time its blow ` +
        `against the wrong length of swing`,
    );
  }
  if (BUGABOO_SWIPE_IMPACT_FRAME !== SWIPE_IMPACT_FRAME) {
    fail(
      'G13',
      `the bake strikes on frame ${SWIPE_IMPACT_FRAME} but BUGABOO_SWIPE_IMPACT_FRAME in ` +
        `src/sprites/bugabooSprite.ts is ${BUGABOO_SWIPE_IMPACT_FRAME}`,
    );
  }
}

/**
 * `G14` — the breach's groping hand actually goes round.
 *
 * "Reaching around" is a circle, and a hand that only rocks side to side is a
 * wave. Checked as the hand's own travel: its horizontal *and* vertical spans
 * both have to be real, because a flat sweep passes any single-axis check.
 */
const GROPE_MIN_SPAN_X = 0.5;
const GROPE_MIN_SPAN_Y = 0.2;

function gateGropeSweep(): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let frame = 0; frame < BREACH_FRAMES; frame++) {
    const hand = breach(frame / BREACH_FRAMES).rightHand;
    minX = Math.min(minX, hand.x);
    maxX = Math.max(maxX, hand.x);
    minY = Math.min(minY, hand.y);
    maxY = Math.max(maxY, hand.y);
  }
  if (maxX - minX < GROPE_MIN_SPAN_X) {
    fail(
      'G14',
      `the breach hand sweeps only ${(maxX - minX).toFixed(3)} tiles across ` +
        `(limit ${GROPE_MIN_SPAN_X})`,
    );
  }
  if (maxY - minY < GROPE_MIN_SPAN_Y) {
    fail(
      'G14',
      `the breach hand sweeps only ${(maxY - minY).toFixed(3)} tiles up and down ` +
        `(limit ${GROPE_MIN_SPAN_Y}) — a flat sweep is a wave, not a grope`,
    );
  }
}

/**
 * `G15` — the breached creature stays under its own floor line.
 *
 * `submerged` is the only thing in the rig that changes *what* is drawn rather
 * than where, and it is easy to author a "submerged" frame that in fact stands
 * the creature in the hole. Measured at the hips rather than the shoulders: a
 * couple of hundredths of shoulder showing above the rubble is the hump that
 * makes the hole read as occupied, but hips at the floor means it is standing.
 */
const BREACH_MIN_HIP_DEPTH_TILES = 0.3;

function gateBreachDepth(): void {
  for (let frame = 0; frame < BREACH_FRAMES; frame++) {
    const pose = breach(frame / BREACH_FRAMES);
    const depth = HIP_Y + pose.submerged * SUBMERGE_DEPTH - BREACH_FLOOR_Y;
    if (depth < BREACH_MIN_HIP_DEPTH_TILES) {
      fail(
        'G15',
        `breach[${frame}] is only ${pose.submerged.toFixed(3)} submerged, which leaves its hips ` +
          `${depth.toFixed(3)} tiles below the floor (limit ${BREACH_MIN_HIP_DEPTH_TILES}) — the ` +
          `creature is standing in the hole rather than still stuck under it`,
      );
    }
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function runGates(): Promise<void> {
  console.log('Gating the bugaboo bake…');
  const sheet = bake();
  const grid = gridOf(await decode(sheet));

  gateBorderClip(grid, sheet);
  gateAnchor(grid, sheet);
  gateLoopClosure(grid, sheet);
  gateMotionContinuity(grid, sheet);
  gateCentroidDrift(grid, sheet);
  gateBreachReach(grid, sheet);
  gateOneShotSettle(grid, sheet);
  gateTextureSize(sheet);
  gateFootSlide();
  gateLegReach();
  gateArmReach();
  gateImpactIsThePeak();
  gateImpactContract();
  gateGropeSweep();
  gateBreachDepth();
  if (!verifyManifest(sheet)) {
    fail('G16', `src/images/npcs/manifest.json does not describe the sheet the bake produced`);
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} gate${failures.length === 1 ? '' : 's'} failed; nothing was written:\n  ` +
        failures.join('\n  '),
    );
  }
  console.log('  all gates passed');
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runGates()
    .then(async () => {
      const { writeSheet } = await import('./generate-bugaboo-sprite');
      writeSheet();
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

export { runGates };
