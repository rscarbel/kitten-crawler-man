/**
 * The cockroach's art gates.
 *
 * The creature has no baked sheet to inspect any more, so every invariant the
 * old bake gate enforced against sheet pixels is enforced here against cells
 * painted from `COCKROACH_FIGURE` — baked exactly the way the runtime cache
 * bakes them, supersampled and downsampled, so what is measured is what the
 * game blits. The pose-stream gates measure the choreography itself and need no
 * pixels at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly: a lookup that quietly returns nothing turns a whole gate module
 * green while measuring nothing.
 *
 * Run by the review harness: `npm run render:cockroach`.
 */

import { createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import {
  BITE_FRAMES,
  BITE_IMPACT_FRAME,
  COCKROACH_FIGURE,
  GORE_RECENTRE,
  GORE_STATES,
  GORE_UNIT,
  ROWS,
  TILE_SCALE,
  type RowSpec,
} from '../src/sprites/art/cockroachFigure.js';
import { ANTENNA_MIN_REACH_TILES } from '../src/sprites/art/cockroachArt.js';
import { cockroachGorePieces } from '../src/sprites/art/cockroachGore.js';
import {
  COCKROACH_BITE_IMPACT_FRAME,
  COCKROACH_COMBAT_STATES,
  COCKROACH_SPAWN_STATES,
  COCKROACH_STATES,
} from '../src/sprites/cockroachSprite.js';
import { asGameContext } from './nodeGameContext.js';

/** Alpha above which a pixel counts as painted. */
const INK_ALPHA_THRESHOLD = 24;
/** Alpha above which a pixel counts as *body* rather than as an antialiased edge. */
const SOLID_ALPHA_THRESHOLD = 200;
/** Half a pixel, so a reach is measured from the middle of a pixel rather than its corner. */
const PIXEL_CENTRE = 0.5;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** The size the sprite renders at in game; the runtime scale is this over TILE_SCALE. */
const IN_GAME_TILE = 32;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

const { frameWidth, frameHeight } = COCKROACH_FIGURE;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — skitter rows only, gore pieces
 * only, one pair per row — and a narrowing that matches nothing leaves a green
 * gate that examined nothing.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const alphaByCell = new Map<string, Uint8ClampedArray>();

/** One cell's alpha channel, baked as the runtime cache bakes it. */
function cellAlpha(state: string, frame: number): Uint8ClampedArray {
  const key = `${state}[${frame}]`;
  const cached = alphaByCell.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(COCKROACH_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  alphaByCell.set(key, alpha);
  return alpha;
}

function cellsOfRow(row: RowSpec): Uint8ClampedArray[] {
  return Array.from({ length: row.frameCount }, (_unused, frame) => cellAlpha(row.name, frame));
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

function inkStatsOf(alpha: Uint8ClampedArray, threshold = INK_ALPHA_THRESHOLD): InkStats {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = frameWidth;
  let maxX = -1;
  let minY = frameHeight;
  let maxY = -1;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < threshold) continue;
    const x = i % frameWidth;
    const y = Math.floor(i / frameWidth);
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

/** How many pixels differ between two cells of the same row. */
function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    const inA = a[i] >= INK_ALPHA_THRESHOLD;
    const inB = b[i] >= INK_ALPHA_THRESHOLD;
    if (inA !== inB) differing++;
  }
  return differing;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

const SKITTER_ROWS = ['skitter', 'skitter_side', 'skitter_back'] as const;
const IDLE_ROWS = ['idle', 'idle_side', 'idle_back'] as const;

/**
 * The row a gate names, or null after recording a failure.
 *
 * Every one of these names is a string literal written here rather than in
 * `ROWS`, so renaming a row would otherwise turn its gate into a silent no-op:
 * present, green, and measuring nothing.
 */
function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `no row named "${name}" — a gate is guarding a row that no longer exists`);
    return null;
  }
  return row;
}

// ── Structural gates ─────────────────────────────────────────────────────────

/**
 * How much of the cell the widest pose must fill.
 *
 * Below the shared default, and it has to be: this cell is not sized by the
 * animation at all. It is sized so that a gore piece spinning about the cell
 * centre sweeps the inscribed circle without clipping, which makes it square and
 * wider than a flat animal a third of a tile long ever fills. The warm-row gate
 * is what says those cells are still affordable.
 */
const MIN_INK_AREA_SHARE = 0.1;

/**
 * G1 — the shared structural gates: every declared state paints every declared
 * frame, nothing paints against the cell edge, and the cell is not mostly empty.
 * The gore states are exempt from the fill check: a severed cercus is meant to
 * be small inside a cell sized for the widest sweep.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(COCKROACH_FIGURE, {
    sparseStates: GORE_STATES,
    minInkAreaShare: MIN_INK_AREA_SHARE,
  })) {
    fail('G1', failure);
  }
}

/**
 * How far the body's solid mass may sit from the cell centre.
 *
 * The tolerance has to clear the antennae. They are solid ink, they are longer
 * than the body, and they both sweep forward — so the mass of the animal
 * legitimately sits ahead of the body's own centre. The construction guarantees
 * the anchor; this is the net that catches a gross break, not a fine one.
 */
const ANCHOR_TOLERANCE_PX = 14;

/**
 * G2 — the tile anchor is the centre of the cell, and the animal is on it.
 *
 * This creature registers on its **body centre** rather than on a ground line,
 * so the whole contract is that the painter's origin, the cell centre and the
 * middle of the declared tile are the same point. Health bars and aggro markers
 * key off it, and a redraw moves it silently.
 *
 * The measurement is the *solid* ink's centroid, which weights the plates rather
 * than the antennae. It cannot catch a wrong `tileX`/`tileY` — `paintFrame` puts
 * its own origin on the cell centre either way — and does not claim to; the
 * parity run against the sheet is what proved those numbers. What it catches is
 * the art drifting off its own anchor, and the frozen tile box drifting off the
 * centre the art is painted about.
 */
function gateAnchor(): void {
  const wantTileX = frameWidth / 2 - TILE_SCALE / 2;
  const wantTileY = frameHeight / 2 - TILE_SCALE / 2;
  if (COCKROACH_FIGURE.tileX !== wantTileX || COCKROACH_FIGURE.tileY !== wantTileY) {
    fail(
      'G2',
      `the tile is declared at (${COCKROACH_FIGURE.tileX}, ${COCKROACH_FIGURE.tileY}) but a ` +
        `body-centred anchor in a ${frameWidth}×${frameHeight} cell puts it at ` +
        `(${wantTileX}, ${wantTileY})`,
    );
  }
  let rowsMeasured = 0;
  for (const name of IDLE_ROWS) {
    const row = rowNamed(name, 'G2');
    if (row === null) continue;
    rowsMeasured++;
    const stats = inkStatsOf(cellAlpha(name, 0), SOLID_ALPHA_THRESHOLD);
    if (stats.count === 0) {
      fail('G2', `${name}[0] has no solid ink at all to weigh`);
      continue;
    }
    const off = Math.hypot(stats.centroidX - frameWidth / 2, stats.centroidY - frameHeight / 2);
    if (off > ANCHOR_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] carries its body mass at (${stats.centroidX.toFixed(1)}, ` +
          `${stats.centroidY.toFixed(1)}) against a cell centre of ` +
          `(${frameWidth / 2}, ${frameHeight / 2}) — ${off.toFixed(1)}px off the anchor, ` +
          `limit ${ANCHOR_TOLERANCE_PX}`,
      );
    }
  }
  failUnlessMeasured('G2', rowsMeasured, 'idle rows');
}

/**
 * G3 — a looping row's last→first delta sits in a band, not merely under a limit.
 *
 * The ceiling catches a gait that pops once per cycle, which is invisible on a
 * contact sheet because every individual frame is fine. It is measured against
 * the median step *and* the largest legitimate step: a sine-driven sweep is
 * steepest at its own zero crossing, which lands on the seam by construction.
 *
 * The floor catches the opposite defect, and it is the one a ceiling-only gate
 * cannot see. Sampling a cycle at `frame / (frameCount - 1)` instead of
 * `frame / frameCount` makes the last frame identical to the first: the seam
 * goes to zero, the loop holds still for a whole frame every cycle, and a
 * seam-versus-median gate stays green through it.
 */
/**
 * Both limits are re-derived from the art rather than carried over from the
 * bake gate, whose 2.1× was set against a different measurement and left this
 * one unable to fail: a cycle running half a stride long still passed it. Across
 * the six loop rows the seam runs 0.81–0.91 of the median step and 0.67–0.73 of
 * the worst, and a cycle sampled half a stride long runs 1.29 and 1.17, so the
 * allowance sits between the two: about a third clear of every honest row, and
 * under the row that overruns.
 *
 * It stays a pixel ratio all the same, so treat it as an art-drift check that
 * happens to bind on this figure rather than as a cycle-count gate: re-timing a
 * row moves the steps the seam is judged against along with the seam, and on
 * other figures that inverts far enough that an overrunning cycle reads
 * *cleaner* than the shipped art. The wrap clause below is what covers that.
 */
const LOOP_SEAM_LIMIT = 1.2;
const LOOP_SEAM_VS_WORST_STEP = 1.1;
/**
 * The smallest share of the row's median step the seam may be.
 *
 * A closed cycle steps across its seam exactly as it steps anywhere else, so the
 * honest value is around 1; the floor is set well under the smallest measured
 * ratio across these six rows so that only a cycle that genuinely stops moving
 * at the seam trips it.
 */
const LOOP_SEAM_FLOOR_SHARE = 0.35;
/**
 * How many pixels the frame one past a loop's last may differ from its first.
 *
 * The clause that binds a cycle to exactly one turn, and the only one that can:
 * a pixel seam ratio moves its own denominator when the row is re-timed, so on
 * several figures a cycle running one and a half turns measured *inside* the
 * ceiling. The painter takes a frame index rather than a phase, so a loop can be
 * painted at `frameCount` — one frame past its end — where a closed cycle
 * reproduces frame 0. Not held to exactly zero because the cell is downsampled
 * from twice its size and a pose value landing on 2π rather than 0 rounds
 * independently on each side; all six of this figure's loop rows measure 0px,
 * and the worst across the seven figures swept with it is 4px.
 */
const LOOP_WRAP_TOLERANCE_PX = 16;
/**
 * The least any interior frame of a loop may differ from its first.
 *
 * The wrap check is satisfied by a row that runs its cycle *twice*, which
 * repeats frame 0 in the middle of the row. Measured: the closest any interior
 * frame comes to frame 0 across these six rows is 413px, so this sits well clear
 * of the art and far from the 0px an exact repeat scores.
 */
const LOOP_INTERIOR_REPEAT_FLOOR_PX = 100;

function gateLoopClosure(): void {
  let rowsMeasured = 0;
  for (const name of [...SKITTER_ROWS, ...IDLE_ROWS]) {
    const row = rowNamed(name, 'G3');
    if (row === null) continue;
    const cells = cellsOfRow(row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    rowsMeasured++;
    if (typical === 0) {
      fail('G3', `${name} has a median step of 0px — the row is frozen, not looping`);
      continue;
    }

    const wrap = frameDelta(cellAlpha(name, row.frameCount), cells[0]);
    if (wrap > LOOP_WRAP_TOLERANCE_PX) {
      fail(
        'G3',
        `${name} does not cover exactly one turn: painted at frame ${row.frameCount}, one past ` +
          `its end, it differs from frame 0 by ${wrap}px (allowed ${LOOP_WRAP_TOLERANCE_PX}px) — ` +
          'the cycle is sampled over more or less than its own length, so the row plays at the ' +
          'wrong rate and never closes',
      );
    }
    let closestInterior = Infinity;
    let closestFrame = -1;
    for (let frame = 1; frame < row.frameCount; frame++) {
      const distance = frameDelta(cells[frame], cells[0]);
      if (distance >= closestInterior) continue;
      closestInterior = distance;
      closestFrame = frame;
    }
    if (closestInterior < LOOP_INTERIOR_REPEAT_FLOOR_PX) {
      fail(
        'G3',
        `${name}[${closestFrame}] comes back to within ${closestInterior}px of frame 0 (at ` +
          `least ${LOOP_INTERIOR_REPEAT_FLOOR_PX}px expected) — the row is running its cycle ` +
          'more than once',
      );
    }
    const worst = Math.max(...steps);
    const allowed = Math.max(typical * LOOP_SEAM_LIMIT, worst * LOOP_SEAM_VS_WORST_STEP);
    if (seam > allowed) {
      fail(
        'G3',
        `${name} pops across its loop seam: last→first differs by ${seam}px against a median ` +
          `step of ${typical}px and a worst in-cycle step of ${worst}px ` +
          `(allowed ${allowed.toFixed(0)}px)`,
      );
    }
    const floor = typical * LOOP_SEAM_FLOOR_SHARE;
    if (seam < floor) {
      fail(
        'G3',
        `${name} holds still across its loop seam: last→first differs by only ${seam}px against ` +
          `a median step of ${typical}px (floor ${floor.toFixed(0)}px) — the cycle is being ` +
          'sampled so that its last frame repeats its first',
      );
    }
  }
  failUnlessMeasured('G3', rowsMeasured, 'loops that actually move');
}

/**
 * G4 — no consecutive-frame step far above the row's own median.
 *
 * Catches a snapped knee, a mid-swing draw-order flip and an antenna that jumps
 * sides. One-shots are allowed a bigger spike than loops, because a lunge is
 * *meant* to have one violent frame in it — that is what a lunge is.
 */
/**
 * Re-derived from the art, like the seam limits and for the same reason: the
 * bake gate's 2.6 and 4 were loose enough that a whole row rotating eighty
 * degrees between two frames passed. Across the nine rows the worst honest step
 * is 1.33× its row's median on a loop and 1.10× on a one-shot, so both limits
 * sit comfortably clear of that and well under a real discontinuity. The
 * one-shot's is the looser of the two because a lunge is *meant* to have one
 * violent frame in it — that is what a lunge is.
 */
const LOOP_STEP_LIMIT = 1.8;
const ONE_SHOT_STEP_LIMIT = 2.2;
/**
 * A step this small is not visible however large its ratio to the row's median.
 * Without a floor the gate is loudest on the rows that move least — and the idle
 * on this animal is deliberately near the threshold of visibility.
 */
const STEP_FLOOR_SHARE = 0.005;

function gateMotionContinuity(): void {
  const cellArea = frameWidth * frameHeight;
  let stepsMeasured = 0;
  for (const row of ROWS) {
    const cells = cellsOfRow(row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    stepsMeasured += steps.length;
    const typical = median(steps);
    if (typical === 0) continue;
    const limit = row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT;
    const floor = cellArea * STEP_FLOOR_SHARE;
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
  }
  failUnlessMeasured('G4', stepsMeasured, 'frame-to-frame steps');
}

/**
 * G5 — a skitter cycle runs on the spot rather than travelling across its cell.
 *
 * Measured as each frame's ink centroid against the **mean** centroid of the
 * whole loop, not as first-against-last. A gait is periodic by construction, so
 * the last frame is one step short of the first and a first-vs-last check
 * measures that step instead of the drift; the mean is the only reading that
 * says "this animal is not walking out of its own tile".
 */
const CENTROID_WANDER_LIMIT_PX = 4;

function gateCentroidWander(): void {
  let framesMeasured = 0;
  for (const name of SKITTER_ROWS) {
    const row = rowNamed(name, 'G5');
    if (row === null) continue;
    const centroids = cellsOfRow(row).map((cell) => inkStatsOf(cell));
    const meanX = centroids.reduce((sum, s) => sum + s.centroidX, 0) / centroids.length;
    const meanY = centroids.reduce((sum, s) => sum + s.centroidY, 0) / centroids.length;
    centroids.forEach((stats, frame) => {
      framesMeasured++;
      const wander = Math.hypot(stats.centroidX - meanX, stats.centroidY - meanY);
      if (wander > CENTROID_WANDER_LIMIT_PX) {
        fail(
          'G5',
          `${name}[${frame}] sits ${wander.toFixed(2)}px from the loop's own mean centroid ` +
            `(limit ${CENTROID_WANDER_LIMIT_PX}) — the cycle is travelling, not skittering in place`,
        );
      }
    });
  }
  failUnlessMeasured('G5', framesMeasured, 'skitter frames');
}

/**
 * G6 — every gore piece is big enough to be identified as it tumbles.
 *
 * Measured in *screen* pixels, at the 0.5× the runtime applies, not in cell
 * pixels. A roach's parts are the smallest in the bestiary and this is the gate
 * that stops them shipping as eight brown flecks.
 */
const GORE_MIN_SHORT_AXIS_PX = 8;

function gateGoreLegibility(): void {
  const screenScale = IN_GAME_TILE / TILE_SCALE;
  let piecesMeasured = 0;
  for (const state of GORE_STATES) {
    piecesMeasured++;
    const stats = inkStatsOf(cellAlpha(state, 0));
    if (stats.count === 0) {
      fail('G6', `${state} painted nothing`);
      continue;
    }
    const shortAxis = Math.min(stats.maxX - stats.minX, stats.maxY - stats.minY) * screenScale;
    if (shortAxis < GORE_MIN_SHORT_AXIS_PX) {
      fail(
        'G6',
        `${state} is ${shortAxis.toFixed(1)}px across its short axis at the size it renders ` +
          `(limit ${GORE_MIN_SHORT_AXIS_PX}) — nothing that thin can be told from anything else`,
      );
    }
  }
  failUnlessMeasured('G6', piecesMeasured, 'gore pieces');
}

/**
 * G7 — no two gore pieces are the same shape.
 *
 * Compared as small binary masks. Scale is normalised away but **aspect is
 * not**: stretching each piece to fill its own bounding box maps every convex
 * blob onto a filled square and measures the normalisation rather than the art.
 */
const DISTINCT_MASK = 16;
const DISTINCT_IOU_LIMIT = 0.62;

function maskOf(state: string): boolean[] {
  const alpha = cellAlpha(state, 0);
  const stats = inkStatsOf(alpha);
  const boxW = Math.max(1, stats.maxX - stats.minX);
  const boxH = Math.max(1, stats.maxY - stats.minY);
  const span = Math.max(boxW, boxH);
  const mask: boolean[] = new Array<boolean>(DISTINCT_MASK * DISTINCT_MASK).fill(false);
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < INK_ALPHA_THRESHOLD) continue;
    const x = (i % frameWidth) - stats.minX;
    const y = Math.floor(i / frameWidth) - stats.minY;
    const mx = Math.min(DISTINCT_MASK - 1, Math.floor((x / span) * DISTINCT_MASK));
    const my = Math.min(DISTINCT_MASK - 1, Math.floor((y / span) * DISTINCT_MASK));
    mask[my * DISTINCT_MASK + mx] = true;
  }
  return mask;
}

function gateGoreDistinctness(): void {
  const masks = GORE_STATES.map((state) => maskOf(state));
  let pairsMeasured = 0;
  for (let a = 0; a < masks.length; a++) {
    for (let b = a + 1; b < masks.length; b++) {
      pairsMeasured++;
      let intersection = 0;
      let union = 0;
      for (let i = 0; i < masks[a].length; i++) {
        if (masks[a][i] && masks[b][i]) intersection++;
        if (masks[a][i] || masks[b][i]) union++;
      }
      const iou = union === 0 ? 0 : intersection / union;
      if (iou > DISTINCT_IOU_LIMIT) {
        fail(
          'G7',
          `${GORE_STATES[a]} and ${GORE_STATES[b]} are ${(iou * 100).toFixed(0)}% the same shape ` +
            `(limit ${(DISTINCT_IOU_LIMIT * 100).toFixed(0)}%)`,
        );
      }
    }
  }
  failUnlessMeasured('G7', pairsMeasured, 'gore piece pairings');
}

/**
 * G8 — the antennae carry the silhouette out to its declared reach on every
 * skitter frame.
 *
 * The antennae are most of what makes this shape an insect rather than a seed,
 * and they are also the first thing a cell-size change crops. Cropping is
 * silent: the structural gate only fires if the ink actually touches the border,
 * and a painter change that shortens the sweep does not touch it at all.
 *
 * Measured as the distance from the cell centre — the body's own anchor — to the
 * furthest ink, in tiles, which on every view is an antenna tip. The bounding
 * *span* this used to read was answered by the body and the legs: shortening the
 * filaments from 0.82 tiles to 0.62 moved it by one percent and the gate stayed
 * green, while the same cut takes this reading down by seven.
 */
function gateAntennaReach(): void {
  const centreX = frameWidth / 2;
  const centreY = frameHeight / 2;
  let framesMeasured = 0;
  for (const name of SKITTER_ROWS) {
    const row = rowNamed(name, 'G8');
    if (row === null) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      framesMeasured++;
      const alpha = cellAlpha(name, frame);
      let furthest = 0;
      for (let i = 0; i < alpha.length; i++) {
        if (alpha[i] < INK_ALPHA_THRESHOLD) continue;
        const dx = (i % frameWidth) + PIXEL_CENTRE - centreX;
        const dy = Math.floor(i / frameWidth) + PIXEL_CENTRE - centreY;
        furthest = Math.max(furthest, Math.hypot(dx, dy));
      }
      const reach = furthest / TILE_SCALE;
      if (reach < ANTENNA_MIN_REACH_TILES) {
        fail(
          'G8',
          `${name}[${frame}] reaches only ${reach.toFixed(3)} tiles from the body's own centre ` +
            `against a declared antenna reach of ${ANTENNA_MIN_REACH_TILES} — the antennae are ` +
            'being cropped or have been shortened, and they are the whole insect cue',
        );
      }
    }
  }
  failUnlessMeasured('G8', framesMeasured, 'skitter frames');
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

const BITE_ROWS = ['bite', 'bite_side', 'bite_back'] as const;
/**
 * How much more ink the impact frame must carry than the frame either side of
 * it.
 *
 * Seen from overhead the only cue for a lunge toward the camera is the body
 * growing, so the painted ink area is what "full reach" means here. Measured on
 * the shipped rows: the impact frame carries 1728–1740px of ink against a
 * runner-up of 1678–1699, about 2.4% clear, so this asks for rather less than
 * the art delivers and still refuses a flat row where the peak is noise.
 */
const BITE_PEAK_MARGIN = 1.01;

/**
 * G9 — the painted lunge peaks on exactly the frame the mob deals its damage.
 *
 * A choreography that drifted from the timing table puts the roach at full reach
 * two frames after the player has already been bitten. The frame the runtime
 * counts off is imported rather than restated, so the two cannot drift apart
 * without this gate seeing it.
 *
 * Measured on painted ink rather than on `bitePose(...).surge`, which is what
 * this gate used to read and could not fail: `biteSurge` is built as two ramps
 * meeting at a peak computed from the impact frame itself, so the argmax of the
 * surge is that frame by construction, for any value of it. What the pixels add
 * is every *other* part of the pose — the rear-up, the gape, the braced legs —
 * which can and does move the visible extreme off the surge's own crest. This
 * gate still cannot see the impact frame being changed to a different number,
 * because the choreography follows it there; the parity table is what proved the
 * frames themselves.
 */
function gateBiteImpactIsThePeak(): void {
  let rowsMeasured = 0;
  for (const name of BITE_ROWS) {
    const row = rowNamed(name, 'G9');
    if (row === null) continue;
    rowsMeasured++;
    let peakFrame = -1;
    let peakInk = -Infinity;
    let runnerUpInk = -Infinity;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const { count } = inkStatsOf(cellAlpha(name, frame));
      if (count > peakInk) {
        runnerUpInk = peakInk;
        peakInk = count;
        peakFrame = frame;
        continue;
      }
      if (count > runnerUpInk) runnerUpInk = count;
    }
    if (peakFrame !== COCKROACH_BITE_IMPACT_FRAME) {
      fail(
        'G9',
        `${name} paints its widest body on frame ${peakFrame} (${peakInk}px of ink) but the mob ` +
          `deals its damage on frame ${COCKROACH_BITE_IMPACT_FRAME} — the lunge and the hit have ` +
          'drifted apart',
      );
      continue;
    }
    if (peakInk < runnerUpInk * BITE_PEAK_MARGIN) {
      fail(
        'G9',
        `${name}'s impact frame carries ${peakInk}px of ink against ${runnerUpInk}px on the next ` +
          `frame, under the ${BITE_PEAK_MARGIN}× that separates a lunge from a row that barely ` +
          'moves — the strike has no reach in it',
      );
    }
  }
  failUnlessMeasured('G9', rowsMeasured, 'bite rows');

  if (BITE_IMPACT_FRAME < 0 || BITE_IMPACT_FRAME >= BITE_FRAMES) {
    fail(
      'G9',
      `the declared impact frame ${BITE_IMPACT_FRAME} is outside the ${BITE_FRAMES}-frame bite row`,
    );
  }
}

/**
 * G10 — every state name the runtime can build is one the figure paints.
 *
 * Both draw paths return silently on an unknown state, so a pose name composed
 * from a base and a view that the figure does not paint is an invisible creature
 * and no log line. The two prewarm lists go through the same check: a prewarm of
 * a state that does not exist warms nothing and warns nowhere.
 */
function gateRuntimeStateNames(): void {
  const lists: ReadonlyArray<readonly [readonly string[], string]> = [
    [COCKROACH_STATES, "cockroachSprite's COCKROACH_STATES"],
    [COCKROACH_SPAWN_STATES, "cockroachSprite's COCKROACH_SPAWN_STATES"],
    [COCKROACH_COMBAT_STATES, "cockroachSprite's COCKROACH_COMBAT_STATES"],
  ];
  for (const [names, purpose] of lists) {
    for (const failure of missingStateFailures(COCKROACH_FIGURE, [...names], purpose)) {
      fail('G10', failure);
    }
  }
  // The other direction: a row the figure paints that no runtime name can reach
  // is art nobody ever sees, and it costs a cell in every accounting.
  const reachable = new Set([...COCKROACH_STATES, ...GORE_STATES]);
  let rowsMeasured = 0;
  for (const row of ROWS) {
    rowsMeasured++;
    if (reachable.has(row.name)) continue;
    fail('G10', `the figure paints "${row.name}", which no runtime state name can reach`);
  }
  failUnlessMeasured('G10', rowsMeasured, 'painted rows');
}

/**
 * Megabytes the widest single state may occupy once warm.
 *
 * The sheet-era budget was the whole texture, because the whole texture was
 * decoded whether or not anything played. A painted figure is admitted one state
 * at a time and lets go of the states it stops playing, so the number that
 * decides whether it fits is the widest row against the cache's per-figure
 * ceiling.
 *
 * On this figure that clause is a **readout, not a gate**, and it is written
 * down as one rather than left to look like coverage: the cells are 144×144 and
 * the longest row is eight frames, so the widest state warms to 0.63 MB and a
 * row would have to run ninety-six frames to reach the ceiling. Nothing an
 * animator would plausibly do can move it. The all-warm total below is the
 * clause that binds.
 */
const ROW_BUDGET_MEGABYTES = 6;
/**
 * Megabytes every declared state may occupy warm at once.
 *
 * This creature is warmed a whole list at a time — `prewarmCockroach` and
 * `prewarmCockroachCombat` walk their state lists in one go — so the sum is what
 * a room full of them actually holds, gore pieces included: a scan of the pose
 * rows alone leaves the single-frame states out of the accounting entirely.
 * Measured on the shipped art: 74 declared frames come to 5.85 MB, so this sits
 * about a third clear of it and under any wholesale lengthening of the cycles —
 * doubling the skitter *and* idle rows lands at 9.2 MB.
 */
const ALL_WARM_BUDGET_MEGABYTES = 8;

/** G11 — the figure's warm bytes, reported whether or not they pass. */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of COCKROACH_FIGURE.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured('G11', statesMeasured, 'declared states');
  if (statesMeasured === 0) return;

  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarmMegabytes = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  G11 warm row: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB readout; all ${statesMeasured} states warm at once is ` +
      `${allWarmMegabytes.toFixed(2)} MB of a ${ALL_WARM_BUDGET_MEGABYTES} MB budget`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      'G11',
      `${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
  if (allWarmMegabytes > ALL_WARM_BUDGET_MEGABYTES) {
    fail(
      'G11',
      `every state warm at once is ${allWarmMegabytes.toFixed(2)} MB against a budget of ` +
        `${ALL_WARM_BUDGET_MEGABYTES} MB, and this figure is prewarmed a whole list at a time`,
    );
  }
}

/**
 * The canvas the gore pieces are measured on, big enough that no piece painted
 * about its centre can reach an edge, and the same one the bake this figure
 * replaces measured on.
 */
const GORE_MEASURE_SPAN = 384;
const GORE_MEASURE_ORIGIN = GORE_MEASURE_SPAN / 2;
/**
 * How far a re-measured offset may sit from the frozen one, in piece units.
 *
 * Zero in principle — the same painter measured the same way — but a sub-pixel
 * band keeps the gate from firing on a rounding difference between node-canvas
 * builds rather than on the art.
 */
const GORE_RECENTRE_TOLERANCE = 1 / GORE_UNIT;

/**
 * G12 — the frozen gore recentring offsets still describe the painted pieces.
 *
 * The offsets are the one number in the figure that cannot be computed where it
 * is used: `BodyPartGoreSystem` spins a piece about the centre of its cell, and
 * finding where the piece's ink actually lands means painting it and reading the
 * pixels back. They are frozen in the figure module and re-measured here, so a
 * redrawn piece cannot silently start orbiting.
 *
 * Checked in both directions. A frozen offset with no piece left to own it is a
 * dead entry that reads like a maintained measurement, and the next agent to add
 * a piece by that name inherits a number measured off art that is gone.
 */
function gateGoreRecentre(): void {
  const canvas = createCanvas(GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
  const ctx = canvas.getContext('2d');
  const pieces = cockroachGorePieces();
  const paintedStates = new Set(pieces.map((piece) => piece.state));
  for (const frozenState of GORE_RECENTRE.keys()) {
    if (paintedStates.has(frozenState)) continue;
    fail(
      'G12',
      `GORE_RECENTRE freezes an offset for "${frozenState}", which nothing paints any more`,
    );
  }
  let piecesMeasured = 0;
  for (const piece of pieces) {
    piecesMeasured++;
    ctx.clearRect(0, 0, GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
    ctx.save();
    ctx.translate(GORE_MEASURE_ORIGIN, GORE_MEASURE_ORIGIN);
    ctx.scale(GORE_UNIT, GORE_UNIT);
    piece.paint(asGameContext(ctx));
    ctx.restore();
    const { data } = ctx.getImageData(0, 0, GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
    let minX = GORE_MEASURE_SPAN;
    let maxX = -1;
    let minY = GORE_MEASURE_SPAN;
    let maxY = -1;
    for (let y = 0; y < GORE_MEASURE_SPAN; y++) {
      for (let x = 0; x < GORE_MEASURE_SPAN; x++) {
        if (data[(y * GORE_MEASURE_SPAN + x) * CHANNELS + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) {
          continue;
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) {
      fail('G12', `${piece.state} painted nothing at all when measured about its own centre`);
      continue;
    }
    const measuredX = (GORE_MEASURE_ORIGIN - (minX + maxX) / 2) / GORE_UNIT;
    const measuredY = (GORE_MEASURE_ORIGIN - (minY + maxY) / 2) / GORE_UNIT;
    const frozen = GORE_RECENTRE.get(piece.state);
    if (frozen === undefined) {
      fail('G12', `the figure freezes no recentring offset for ${piece.state}`);
      continue;
    }
    const gap = Math.hypot(measuredX - frozen.x, measuredY - frozen.y);
    if (gap > GORE_RECENTRE_TOLERANCE) {
      fail(
        'G12',
        `${piece.state}'s ink centres at (${measuredX.toFixed(5)}, ${measuredY.toFixed(5)}) but ` +
          `GORE_RECENTRE freezes (${frozen.x.toFixed(5)}, ${frozen.y.toFixed(5)}) — the piece ` +
          'will orbit rather than tumble; paste the measured pair',
      );
    }
  }
  failUnlessMeasured('G12', piecesMeasured, 'gore pieces');
}

/** Runs every gate and returns one message per failure. */
export function cockroachGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateAnchor();
  gateLoopClosure();
  gateMotionContinuity();
  gateCentroidWander();
  gateGoreLegibility();
  gateGoreDistinctness();
  gateAntennaReach();
  gateBiteImpactIsThePeak();
  gateRuntimeStateNames();
  gateWarmRowSize();
  gateGoreRecentre();
  return [...failures];
}
