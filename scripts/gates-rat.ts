/**
 * The rat's art gates.
 *
 * The bake this figure replaces had no gate module of its own: what it had was a
 * handful of invariants asserted inside the generator, which threw before the
 * PNG reached disk — no blank frames, a cell derived from the measured extents
 * with the gore's spin radius cleared on both axes, and a ceiling on how far the
 * gore was allowed to inflate every cell. Those are re-expressed here against
 * cells painted from `RAT_FIGURE`, baked exactly the way the runtime cache bakes
 * them, and joined by the checks a painted figure needs that a baked one did not.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly: a lookup that quietly returns nothing turns a whole gate module
 * green while measuring nothing.
 *
 * Run by the review harness: `npm run render:rat`.
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
  GORE_RECENTRE,
  GORE_STATES,
  GORE_UNIT,
  POSE_ORIGIN_X,
  POSE_ORIGIN_Y,
  RAT_FIGURE,
  ROWS,
  TILE_SCALE,
  type RowSpec,
} from '../src/sprites/art/ratFigure.js';
import { ratGorePieces } from '../src/sprites/art/ratGore.js';
import {
  RAT_BITE_IMPACT_PROGRESS,
  RAT_COMBAT_STATES,
  RAT_LOCOMOTION_STATES,
  RAT_STATES,
} from '../src/sprites/ratSprite.js';
import { progressFrameIndex } from '../src/core/SpriteRenderer.js';
import { asGameContext } from './nodeGameContext.js';

/** Alpha above which a pixel counts as painted. */
const INK_ALPHA_THRESHOLD = 24;
/** Alpha above which a pixel counts as *body* rather than as an antialiased edge. */
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** The size the sprite renders at in game; the runtime scale is this over TILE_SCALE. */
const IN_GAME_TILE = 32;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

const { frameWidth, frameHeight } = RAT_FIGURE;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — loop rows only, gore pieces
 * only, one pair per row — and a narrowing that matches nothing leaves a green
 * gate that examined nothing, which is indistinguishable from a pass.
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
  const cell = bakeFigureCell(RAT_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  alphaByCell.set(key, alpha);
  return alpha;
}

function cellsOfRow(row: RowSpec): Uint8ClampedArray[] {
  return Array.from({ length: row.frameCount }, (_unused, frame) => cellAlpha(row.name, frame));
}

/**
 * Clear pixels kept around a padded measurement, wide enough that no pose or
 * piece can reach the edge of the scratch canvas.
 *
 * Every measurement that asks "how far does this reach" has to be taken off a
 * canvas the art cannot run out of. In the cell itself the answer is capped by
 * the cell, so a figure painted half a tile too low would report a ground line
 * exactly on the bottom edge — a clipping failure wearing an anchor gate's
 * clothes.
 */
const MEASURE_PAD = 160;
const PADDED_WIDTH = frameWidth + MEASURE_PAD * 2;
const PADDED_HEIGHT = frameHeight + MEASURE_PAD * 2;

interface InkBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * The ink box of one frame painted into a canvas padded on all four sides,
 * returned in cell coordinates — so a pose that reaches outside the cell reports
 * where it actually reached rather than where it was clipped.
 */
function paddedInkBox(
  state: string,
  frame: number,
  threshold = INK_ALPHA_THRESHOLD,
): InkBox | null {
  const canvas = createCanvas(PADDED_WIDTH, PADDED_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(MEASURE_PAD, MEASURE_PAD);
  RAT_FIGURE.paintFrame(asGameContext(ctx), state, frame);
  ctx.restore();
  const { data } = ctx.getImageData(0, 0, PADDED_WIDTH, PADDED_HEIGHT);
  let minX = PADDED_WIDTH;
  let maxX = -1;
  let minY = PADDED_HEIGHT;
  let maxY = -1;
  for (let y = 0; y < PADDED_HEIGHT; y++) {
    for (let x = 0; x < PADDED_WIDTH; x++) {
      if (data[(y * PADDED_WIDTH + x) * CHANNELS + ALPHA_OFFSET] < threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return {
    minX: minX - MEASURE_PAD,
    maxX: maxX - MEASURE_PAD,
    minY: minY - MEASURE_PAD,
    maxY: maxY - MEASURE_PAD,
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
 * Under the shared default because this cell is not sized by the animation
 * alone: both axes are widened until a gore piece spinning about the cell centre
 * sweeps the inscribed circle without clipping, and a rat is a long low animal
 * that never fills the height that buys. The gore-inflation gate is what bounds
 * how much of the cell that is allowed to cost, and the warm-row gate is what
 * says the cells are still affordable.
 */
const MIN_INK_AREA_SHARE = 0.12;

/**
 * G1 — the shared structural gates: every declared state paints every declared
 * frame, nothing paints against the cell edge, and the cell is not mostly empty.
 * The gore states are exempt from the fill check: a severed foreleg is meant to
 * be small inside a cell sized for the longest piece's sweep.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(RAT_FIGURE, {
    sparseStates: GORE_STATES,
    minInkAreaShare: MIN_INK_AREA_SHARE,
  })) {
    fail('G1', failure);
  }
}

/**
 * The bake's own cell-sizing rules, which the frozen geometry was produced by.
 *
 * They are restated here rather than imported because the generator that held
 * them is gone with the sheet. That is exactly why the gate below re-derives the
 * whole cell from freshly painted ink and compares it against the four frozen
 * numbers: the rules and the art are both live, and the frozen numbers are not.
 */
const FRAME_PADDING = 6;
const FRAME_SIZE_QUANTUM = 8;

function roundUpTo(value: number, quantum: number): number {
  return Math.ceil(value / quantum) * quantum;
}

interface Extents {
  /** How far the pose rows reach from the painter's origin, in cell pixels. */
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
  /** How far the furthest gore piece reaches from the cell centre. */
  readonly goreRadius: number;
  readonly posesMeasured: number;
  readonly piecesMeasured: number;
}

function measureExtents(): Extents {
  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  let goreRadius = 0;
  let posesMeasured = 0;
  let piecesMeasured = 0;

  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const box = paddedInkBox(row.name, frame);
      if (box === null) continue;
      posesMeasured++;
      left = Math.max(left, POSE_ORIGIN_X - box.minX);
      right = Math.max(right, box.maxX - POSE_ORIGIN_X);
      up = Math.max(up, POSE_ORIGIN_Y - box.minY);
      down = Math.max(down, box.maxY - POSE_ORIGIN_Y);
    }
  }
  for (const state of GORE_STATES) {
    const box = paddedInkBox(state, 0);
    if (box === null) continue;
    piecesMeasured++;
    const halfWidth = (box.maxX - box.minX) / 2;
    const halfHeight = (box.maxY - box.minY) / 2;
    goreRadius = Math.max(goreRadius, Math.hypot(halfWidth, halfHeight));
  }
  return { left, right, up, down, goreRadius, posesMeasured, piecesMeasured };
}

interface CellGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

function geometryFor(extents: Extents, goreRadius: number): CellGeometry {
  // Both axes have to clear the gore radius: a spinning piece sweeps the cell's
  // *inscribed* circle, so a cell wide enough but not tall enough still clips.
  const goreSpan = (goreRadius + FRAME_PADDING) * 2;
  const halfWidth = Math.max(extents.left, extents.right) + FRAME_PADDING;
  const width = roundUpTo(Math.max(halfWidth * 2, goreSpan), FRAME_SIZE_QUANTUM);
  const originY = Math.ceil(extents.up + FRAME_PADDING);
  const height = roundUpTo(
    Math.max(originY + extents.down + FRAME_PADDING, goreSpan),
    FRAME_SIZE_QUANTUM,
  );
  return {
    frameWidth: width,
    frameHeight: height,
    tileX: width / 2 - TILE_SCALE / 2,
    tileY: originY - TILE_SCALE / 2,
  };
}

/**
 * How far the gore may inflate every cell past what the animation rows need.
 *
 * Rotation safety is free — the cell already clears the sweep on both axes — so
 * this bounds cost, not correctness: one long piece can quietly widen all
 * seventeen states to suit itself, and every instance of the creature pays for
 * the empty pixels.
 */
const GORE_AREA_INFLATION_LIMIT = 2;

/**
 * G2 — the frozen cell is still the cell the art needs, and the gore has not
 * inflated it.
 *
 * The bake measured this cell and is gone; the four numbers it produced are now
 * literals in the figure. Both halves of that comparison are re-derived here
 * from ink painted this run — the extents from the pose origin, the gore radius
 * from the recentred pieces — so a pose that outgrows the cell and a frozen
 * number edited by hand both land as a mismatch. The extents are measured on a
 * padded canvas, so what is compared is where the art reaches rather than where
 * the cell cut it off.
 */
function gateCellGeometry(): void {
  const extents = measureExtents();
  failUnlessMeasured('G2', extents.posesMeasured, 'pose frames');
  failUnlessMeasured('G2', extents.piecesMeasured, 'gore pieces');
  if (extents.posesMeasured === 0 || extents.piecesMeasured === 0) return;

  const derived = geometryFor(extents, extents.goreRadius);
  const frozen: CellGeometry = {
    frameWidth: RAT_FIGURE.frameWidth,
    frameHeight: RAT_FIGURE.frameHeight,
    tileX: RAT_FIGURE.tileX,
    tileY: RAT_FIGURE.tileY,
  };
  for (const key of ['frameWidth', 'frameHeight', 'tileX', 'tileY'] as const) {
    if (derived[key] === frozen[key]) continue;
    fail(
      'G2',
      `the art now measures ${key} ${derived[key]}, but the figure freezes ${frozen[key]} — ` +
        'the cell and the art it was measured from have parted company',
    );
  }

  const animationOnly = geometryFor(extents, 0);
  const inflation =
    (derived.frameWidth * derived.frameHeight) /
    (animationOnly.frameWidth * animationOnly.frameHeight);
  console.log(
    `  G2 cell: ${derived.frameWidth}×${derived.frameHeight} at (${derived.tileX}, ` +
      `${derived.tileY}); the gore widens it to ${inflation.toFixed(2)}× the animation rows' own ` +
      `size (limit ${GORE_AREA_INFLATION_LIMIT})`,
  );
  if (inflation > GORE_AREA_INFLATION_LIMIT) {
    fail(
      'G2',
      `the gore pieces inflate every cell to ${inflation.toFixed(2)}× the area the animation rows ` +
        `need — shrink the longest piece rather than paying for it on all ` +
        `${RAT_FIGURE.states.size} states`,
    );
  }
}

/**
 * Where the rat's soles sit inside its tile, as a share of the tile's height
 * below the tile's top edge.
 *
 * Frozen here rather than taken from the art's own `GROUND_Y`, which is what
 * this gate used to do and what made it unfailable against the defect it names:
 * `paintFrame` pivots the whole animal about `GROUND_Y` and plants every stance
 * foot on it, so a gate deriving its ground line from the same constant moved
 * both sides of the comparison together and passed for any value of it. The tile
 * box is what the runtime hangs the creature off, so that is what the soles are
 * held to. Measured off the shipped idle rows.
 */
const SOLE_SHARE_OF_TILE = 0.9;
/** Where the rat's feet sit inside the cell: the ground line of its own tile. */
const GROUND_LINE_Y = RAT_FIGURE.tileY + RAT_FIGURE.tileScale * SOLE_SHARE_OF_TILE;
/** How far a foot may float above the ground line the frozen tile box declares. */
const FOOT_FLOAT_TOLERANCE_PX = 2;
/**
 * How far below it a foot may sit.
 *
 * Wider than the float tolerance and deliberately so: a contact shadow and the
 * pad's own soft lower edge legitimately spill past the line, while a figure
 * that floats has nothing holding it down. One number covering both has to be
 * loosened until it catches nothing.
 */
const FOOT_HANG_TOLERANCE_PX = 5;
/**
 * The two views whose lowest solid pixel is a foot.
 *
 * The away rows are left out on purpose: seen from behind the tail runs *down*
 * the screen toward the viewer and legitimately reaches a dozen pixels past the
 * pads, so the lowest pixel there is a tail tip and reading it as a sole is how
 * an anchor gate ends up measuring something that was never on the floor. Those
 * rows are not unchecked — their reach is what `G2` derives the cell from.
 */
const STANDING_ROWS = ['idle', 'idle_side'] as const;

/**
 * G3 — the feet stand on the ground line the frozen tile box declares.
 *
 * Measured against solid alpha rather than any ink: the rat's soft edges and its
 * contact shading reach below the pads, so an ordinary-ink reading measures the
 * shadow and stays green while the animal floats. Measured on a padded canvas
 * for the same reason `G2` is — inside the cell a rat sunk far enough to fail
 * this would be clipped first, and the clipping gate would speak instead.
 *
 * Per row rather than over the fleet, which is what separates it from `G2`: one
 * row lifted off its feet does not move the extreme any of the others already
 * set.
 */
function gateGroundAnchor(): void {
  let rowsMeasured = 0;
  for (const name of STANDING_ROWS) {
    const row = rowNamed(name, 'G3');
    if (row === null) continue;
    rowsMeasured++;
    const box = paddedInkBox(name, 0, SOLID_ALPHA_THRESHOLD);
    if (box === null) {
      fail('G3', `${name}[0] has no solid ink at all to stand on`);
      continue;
    }
    const drop = box.maxY - GROUND_LINE_Y;
    if (drop < -FOOT_FLOAT_TOLERANCE_PX || drop > FOOT_HANG_TOLERANCE_PX) {
      fail(
        'G3',
        `${name}[0] has its lowest solid ink at y=${box.maxY} against a ground line of ` +
          `${GROUND_LINE_Y.toFixed(1)} — ${drop.toFixed(1)}px off, allowed ` +
          `${-FOOT_FLOAT_TOLERANCE_PX}..${FOOT_HANG_TOLERANCE_PX}`,
      );
    }
  }
  failUnlessMeasured('G3', rowsMeasured, 'standing rows');
}

/**
 * G4 — a looping row's last→first delta sits in a band, not merely under a limit.
 *
 * The ceiling catches a gait that pops once per cycle, which is invisible on a
 * contact sheet because every individual frame is fine.
 *
 * The floor catches the opposite defect, and it is the one a ceiling-only gate
 * cannot see. Sampling a cycle at `frame / (frameCount - 1)` instead of
 * `frame / frameCount` makes the last frame identical to the first: the seam
 * goes to zero, the loop holds still for a whole frame every cycle, and every
 * seam-versus-median reading stays green through it. It is held against the
 * median step rather than the narrowest, because a row may legitimately hold two
 * byte-identical adjacent frames, which would collapse the floor to `seam >= 0`.
 *
 * The wrap check is what pins the cycle to exactly one turn; neither end of the
 * pixel band can, because re-timing a row moves the steps the seam is judged
 * against along with the seam.
 */
/**
 * How far past the row's own largest ordinary step the seam may reach.
 *
 * A closed cycle crosses its seam the way it crosses anywhere else, so the
 * largest in-cycle step is the yardstick. These six loop rows seam at 0.68–1.08
 * of their largest step — walk_side's 1.076 is the highest reading of any
 * painted figure in the repo — so the margin here is deliberately slim, and the
 * failure message prints both numbers. The limit this replaces also allowed 1.9×
 * the row's *median* step, and a walk's steps are all large enough for that
 * clause to swallow the whole check. This clause is an art-drift check and cannot see cycle count at
 * all: re-timing a row moves the steps it is judged against along with the
 * seam. The wrap clause is what covers that.
 */
const LOOP_SEAM_CEILING = 1.15;
const LOOP_SEAM_FLOOR_SHARE = 0.45;
/**
 * How many pixels the frame one past a loop's last may differ from its first.
 *
 * The painter takes a frame index rather than a phase, so a loop can be painted
 * at `frameCount` — one frame past its end — where a closed cycle reproduces
 * frame 0. Not held to exactly zero because the cell is downsampled from twice
 * its size and a pose value landing on 2π rather than 0 rounds independently on
 * each side: these six rows measure 0–4px, the widest reading of the seven
 * figures swept with this check.
 */
const LOOP_WRAP_TOLERANCE_PX = 16;
/**
 * The least any interior frame of a loop may differ from its first.
 *
 * The wrap check is satisfied by a row that runs its cycle *twice*, which
 * repeats frame 0 in the middle of the row. Measured: the closest any interior
 * frame comes to frame 0 across these six rows is 26px (idle_away), against the
 * 0px an exact repeat scores.
 */
const LOOP_INTERIOR_REPEAT_FLOOR_PX = 8;

function gateLoopClosure(): void {
  let rowsMeasured = 0;
  for (const row of ROWS) {
    if (row.kind !== 'loop') continue;
    const cells = cellsOfRow(row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    rowsMeasured++;
    if (typical === 0) {
      fail('G4', `${row.name} has a median step of 0px — the row is frozen, not looping`);
      continue;
    }

    const wrap = frameDelta(cellAlpha(row.name, row.frameCount), cells[0]);
    if (wrap > LOOP_WRAP_TOLERANCE_PX) {
      fail(
        'G4',
        `${row.name} does not cover exactly one turn: painted at frame ${row.frameCount}, one ` +
          `past its end, it differs from frame 0 by ${wrap}px (allowed ` +
          `${LOOP_WRAP_TOLERANCE_PX}px) — the cycle is sampled over more or less than its own ` +
          'length, so the row plays at the wrong rate and never closes',
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
        'G4',
        `${row.name}[${closestFrame}] comes back to within ${closestInterior}px of frame 0 (at ` +
          `least ${LOOP_INTERIOR_REPEAT_FLOOR_PX}px expected) — the row is running its cycle ` +
          'more than once',
      );
    }

    const worst = Math.max(...steps);
    const allowed = worst * LOOP_SEAM_CEILING;
    if (seam > allowed) {
      fail(
        'G4',
        `${row.name} pops across its loop seam: last→first differs by ${seam}px against a ` +
          `largest in-cycle step of ${worst}px (allowed ${allowed.toFixed(0)}px)`,
      );
    }
    const floor = typical * LOOP_SEAM_FLOOR_SHARE;
    if (seam < floor) {
      fail(
        'G4',
        `${row.name} holds still across its loop seam: last→first differs by only ${seam}px ` +
          `against a median step of ${typical}px (floor ${floor.toFixed(0)}px) — the cycle is ` +
          'being sampled so that its last frame repeats its first',
      );
    }
  }
  failUnlessMeasured('G4', rowsMeasured, 'loops that actually move');
}

/**
 * G5 — no consecutive-frame step far above the row's own median.
 *
 * Catches a snapped joint, a mid-swing draw-order flip and a tail that jumps
 * sides.
 */
/**
 * Derived from the art rather than guessed: across the nine rows the worst
 * honest step is 1.62× its row's median on a loop and 1.43× on a one-shot, so
 * one limit covers both with room to spare and still sits well under a real
 * discontinuity. A separate, looser allowance for the one-shots would only be
 * honest if a lunge here actually spiked harder than a gait does, and it
 * measurably does not.
 */
const STEP_LIMIT = 2.1;
/**
 * A step this small is not visible however large its ratio to the row's median.
 * Without a floor the gate is loudest on the rows that move least.
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
    const floor = cellArea * STEP_FLOOR_SHARE;
    steps.forEach((step, i) => {
      const ratio = step / typical;
      if (ratio > STEP_LIMIT && step > floor) {
        fail(
          'G5',
          `${row.name} jumps between frames ${i} and ${i + 1}: ${step}px against a median of ` +
            `${typical}px (${ratio.toFixed(2)}×, limit ${STEP_LIMIT})`,
        );
      }
    });
  }
  failUnlessMeasured('G5', stepsMeasured, 'frame-to-frame steps');
}

/**
 * G6 — every gore piece is big enough to be identified as it tumbles.
 *
 * Measured in *screen* pixels, at the 0.5× the runtime applies, not in cell
 * pixels. This is the floor under `GORE_PIECE_SCALE`: a rat's parts are
 * anatomically tiny and the whole reason they are painted oversized is that at
 * their true size the set is eight indistinguishable red specks.
 */
const GORE_MIN_SHORT_AXIS_PX = 8;

function gateGoreLegibility(): void {
  const screenScale = IN_GAME_TILE / TILE_SCALE;
  let piecesMeasured = 0;
  for (const state of GORE_STATES) {
    piecesMeasured++;
    const box = paddedInkBox(state, 0);
    if (box === null) {
      fail('G6', `${state} painted nothing`);
      continue;
    }
    const shortAxis = Math.min(box.maxX - box.minX, box.maxY - box.minY) * screenScale;
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
 * G7 — no two gore pieces share a silhouette.
 *
 * Compared as small binary masks. Scale is normalised away but **aspect is
 * not**: stretching each piece to fill its own bounding box maps every convex
 * blob onto a filled square and measures the normalisation rather than the art.
 */
const DISTINCT_MASK = 16;
/**
 * Derived from this set, not carried over from another creature's.
 *
 * At a 16×16 mask a rat's parts are all soft lozenges: the shipped set already
 * runs to 72% between the severed head and the entrails, and no threshold that
 * passes those two proves anything about legibility. What it can still prove is
 * that no piece is a copy of another, which is the failure mode that actually
 * ships — so the limit sits just above the worst honest pair and the gate is a
 * near-duplicate check.
 */
const DISTINCT_IOU_LIMIT = 0.8;

function maskOf(state: string): boolean[] {
  const alpha = cellAlpha(state, 0);
  let minX = frameWidth;
  let maxX = -1;
  let minY = frameHeight;
  let maxY = -1;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < INK_ALPHA_THRESHOLD) continue;
    const x = i % frameWidth;
    const y = Math.floor(i / frameWidth);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(1, Math.max(maxX - minX, maxY - minY));
  const mask: boolean[] = new Array<boolean>(DISTINCT_MASK * DISTINCT_MASK).fill(false);
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < INK_ALPHA_THRESHOLD) continue;
    const x = (i % frameWidth) - minX;
    const y = Math.floor(i / frameWidth) - minY;
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
 * G8 — the frame the damage lands on is the frame the lunge drives furthest.
 *
 * `Rat` counts its damage off `RAT_BITE_IMPACT_PROGRESS`, and the choreography's
 * gather/strike/recover ramps decide when the jaws are actually out. Nothing
 * else can tell the two apart: the row still animates, the damage still lands,
 * and the animation simply becomes a reaction to a hit already taken. The drive
 * is read from the painted pose stream — the lunge on the profile row and the
 * squash on the two head-on ones, which is how each view sells the same moment.
 */
function gateBiteImpactIsTheStrike(): void {
  const declared = progressFrameIndex(RAT_BITE_IMPACT_PROGRESS, BITE_FRAMES);
  const rows: ReadonlyArray<readonly [string, (frame: number) => number]> = [
    ['bite_side', (frame) => rowNamed('bite_side', 'G8')?.pose(frame).lunge ?? 0],
    ['bite', (frame) => 1 - (rowNamed('bite', 'G8')?.pose(frame).squash ?? 1)],
    ['bite_away', (frame) => 1 - (rowNamed('bite_away', 'G8')?.pose(frame).squash ?? 1)],
  ];
  let rowsMeasured = 0;
  for (const [name, driveOf] of rows) {
    const row = rowNamed(name, 'G8');
    if (row === null) continue;
    rowsMeasured++;
    let peakFrame = 0;
    let peak = -Infinity;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const drive = driveOf(frame);
      if (drive > peak) {
        peak = drive;
        peakFrame = frame;
      }
    }
    if (peakFrame !== declared) {
      fail(
        'G8',
        `${name} drives furthest on frame ${peakFrame}, but RAT_BITE_IMPACT_PROGRESS ` +
          `(${RAT_BITE_IMPACT_PROGRESS}) puts the damage on frame ${declared} of ` +
          `${row.frameCount} — the animation and the hit have drifted apart`,
      );
    }
  }
  failUnlessMeasured('G8', rowsMeasured, 'bite rows');
}

/**
 * G9 — every state name the runtime can build is one the figure paints.
 *
 * Both draw paths return silently on an unknown state, so a pose name composed
 * from a base and a view that the figure does not paint is an invisible creature
 * and no log line. The two prewarm lists go through the same check: a prewarm of
 * a state that does not exist warms nothing and warns nowhere.
 */
function gateRuntimeStateNames(): void {
  const lists: ReadonlyArray<readonly [readonly string[], string]> = [
    [RAT_STATES, "ratSprite's RAT_STATES"],
    [RAT_LOCOMOTION_STATES, "ratSprite's RAT_LOCOMOTION_STATES"],
    [RAT_COMBAT_STATES, "ratSprite's RAT_COMBAT_STATES"],
  ];
  for (const [names, purpose] of lists) {
    for (const failure of missingStateFailures(RAT_FIGURE, [...names], purpose))
      fail('G9', failure);
  }
  // The other direction: a row the figure paints that no runtime name can reach
  // is art nobody ever sees, and it costs a cell in every accounting.
  const reachable = new Set<string>([...RAT_STATES, ...GORE_STATES]);
  let rowsMeasured = 0;
  for (const row of ROWS) {
    rowsMeasured++;
    if (reachable.has(row.name)) continue;
    fail('G9', `the figure paints "${row.name}", which no runtime state name can reach`);
  }
  failUnlessMeasured('G9', rowsMeasured, 'painted rows');
}

/**
 * Megabytes the widest single state may occupy once warm.
 *
 * The sheet-era accounting was the whole texture, because the whole texture was
 * decoded whether or not anything played. A painted figure is admitted one state
 * at a time and lets go of the states it stops playing, so the number that
 * decides whether it fits is the widest row against the cache's per-figure
 * ceiling — not the sum of every state. Measured over every state the def
 * declares, gore pieces included: a scan of the pose rows alone leaves the
 * single-frame states out of the figure's memory accounting entirely.
 */
const ROW_BUDGET_MEGABYTES = 6;

/** G10 — the widest state's warm bytes, reported whether or not it passes. */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of RAT_FIGURE.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured('G10', statesMeasured, 'declared states');
  if (statesMeasured === 0) return;

  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarmMegabytes = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  G10 warm row: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once would be ` +
      `${allWarmMegabytes.toFixed(2)} MB`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      'G10',
      `${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
}

/**
 * The canvas the gore pieces are measured on, big enough that no piece painted
 * about its own centre can reach an edge, and the same one the bake this figure
 * replaces measured on.
 */
const GORE_MEASURE_SPAN = 512;
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
 * G11 — the frozen gore recentring offsets still describe the painted pieces.
 *
 * The offsets are the one number in the figure that cannot be computed where it
 * is used: `BodyPartGoreSystem` spins a piece about the centre of its cell, and
 * finding where the piece's ink actually lands means painting it and reading the
 * pixels back. They are frozen in the figure module and re-measured here, so a
 * redrawn piece cannot silently start orbiting instead of tumbling.
 *
 * Checked in both directions. A frozen offset with no piece left to own it is a
 * dead entry that reads like a maintained measurement, and the next agent to add
 * a piece by that name inherits a number measured off art that is gone.
 */
function gateGoreRecentre(): void {
  const canvas = createCanvas(GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
  const ctx = canvas.getContext('2d');
  const pieces = ratGorePieces();
  const paintedStates = new Set(pieces.map((piece) => piece.state));
  for (const frozenState of GORE_RECENTRE.keys()) {
    if (paintedStates.has(frozenState)) continue;
    fail(
      'G11',
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
      fail('G11', `${piece.state} painted nothing at all when measured about its own centre`);
      continue;
    }
    const measuredX = (GORE_MEASURE_ORIGIN - (minX + maxX) / 2) / GORE_UNIT;
    const measuredY = (GORE_MEASURE_ORIGIN - (minY + maxY) / 2) / GORE_UNIT;
    const frozen = GORE_RECENTRE.get(piece.state);
    if (frozen === undefined) {
      fail('G11', `the figure freezes no recentring offset for ${piece.state}`);
      continue;
    }
    const gap = Math.hypot(measuredX - frozen.x, measuredY - frozen.y);
    if (gap > GORE_RECENTRE_TOLERANCE) {
      fail(
        'G11',
        `${piece.state}'s ink centres at (${measuredX.toFixed(5)}, ${measuredY.toFixed(5)}) but ` +
          `GORE_RECENTRE freezes (${frozen.x.toFixed(5)}, ${frozen.y.toFixed(5)}) — the piece ` +
          'will orbit rather than tumble; paste the measured pair',
      );
    }
  }
  failUnlessMeasured('G11', piecesMeasured, 'gore pieces');
}

/** Runs every gate and returns one message per failure. */
export function ratGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateCellGeometry();
  gateGroundAnchor();
  gateLoopClosure();
  gateMotionContinuity();
  gateGoreLegibility();
  gateGoreDistinctness();
  gateBiteImpactIsTheStrike();
  gateRuntimeStateNames();
  gateWarmRowSize();
  gateGoreRecentre();
  return [...failures];
}
