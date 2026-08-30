/**
 * The skeleton family's art gates — the Skeleton Lord and his sword and bow
 * warriors.
 *
 * The three creatures have no baked sheets to inspect any more, so every
 * invariant the old bake enforced by throwing before it wrote a PNG is enforced
 * here instead: the pose-stream gates measure the rig itself, and the pixel
 * gates measure cells painted from the three `FigureDef`s exactly the way the
 * runtime cache bakes them — supersampled and downsampled — so what is measured
 * is what the game blits.
 *
 * Every gate runs over all three variants. They share one set of pose functions
 * and differ only in scale and gear, which is precisely the shape of defect that
 * hides: a pose that reaches on the Lord clamps on the archer, and a cell sized
 * for one is not sized for the others.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing.
 *
 * Run by the review harness: `npm run render:skeletons`.
 */

import { createCanvas } from 'canvas';

import { bakeFigureCell, paintFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { asGameContext } from './nodeGameContext.js';
import {
  GORE_RECENTRE_PX,
  GORE_STATES,
  SKELETON_FIGURES,
  SKELETON_ROWS,
  goreUnitOf,
} from '../src/sprites/art/skeletonFigure.js';
import {
  lateralFor,
  legReachHeadroom,
  type SkeletonPose,
  type SkeletonVariant,
} from '../src/sprites/art/skeletonArt.js';
import { skeletonGorePieces } from '../src/sprites/art/skeletonGore.js';
import { SKELETON_GORE_PARTS, SKELETON_PREWARMED_STATES } from '../src/sprites/skeletonSprite.js';

const VARIANTS: ReadonlyArray<SkeletonVariant> = ['lord', 'sword', 'archer'];

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Alpha above which a pixel counts as painted, when measuring ink. */
const INK_ALPHA_THRESHOLD = 24;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — loop rows only, one entry per
 * painted piece, one variant's rows — and a narrowing that matches nothing
 * leaves a green gate that examined nothing. Every filtering loop here counts
 * what it looked at and ends with a call to this.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

interface InkBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function inkBoxIn(data: Uint8ClampedArray, width: number, height: number): InkBox | null {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

// ── G1 the structural gates ──────────────────────────────────────────────────

/**
 * How much of the cell the widest pose must fill.
 *
 * Under the shared default, and deliberately: each cell was sized by the bake
 * these figures replace, and its width is bought by rows the walk never reaches
 * — the Lord's grasping-hands sweep, the warriors' slash and bow arm. Resizing a
 * cell is not available without discarding the parity that proved the port, and
 * G6 is what says the cells are still affordable.
 */
const MIN_INK_AREA_SHARE = 0.11;

function gateStructure(): void {
  for (const variant of VARIANTS) {
    for (const failure of figureStructuralFailures(SKELETON_FIGURES[variant], {
      // A loose bone is one small piece painted about the centre of a cell sized
      // for a whole figure; it is meant to be mostly empty.
      sparseStates: GORE_STATES,
      minInkAreaShare: MIN_INK_AREA_SHARE,
    })) {
      fail('G1', `${variant}: ${failure}`);
    }
  }
}

// ── G2 the loop seam ─────────────────────────────────────────────────────────

/**
 * The band the step across a loop's seam has to land in.
 *
 * Comparing the pose at phase 0 with the pose at phase 1 is worthless here:
 * every pose in the figure is built from sinusoids of the phase and from a gait
 * function that wraps its argument into [0,1), so both are identical at 0 and 1
 * by construction. What catches a pop is measuring how far the figure moves
 * between each pair of adjacent frames and asking whether the wrap from the last
 * frame back to the first is in line with the rest.
 *
 * A band, not a ceiling. The two ways a cycle's phase mapping goes wrong point
 * in opposite directions and only one of them makes the seam bigger: a row that
 * runs past one turn overshoots the wrap, while sampling at
 * `frame / (frameCount - 1)` instead of `frame / frameCount` makes the last
 * frame identical to the first, drops the seam to exactly zero, and spends a
 * whole frame of the cycle held still. A ceiling alone is green on the second.
 */
const LOOP_SEAM_CEILING = 1.15;
const LOOP_SEAM_FLOOR = 0.3;

/**
 * How far the pose one frame past the end of a loop may sit from the pose the
 * loop starts on, as a share of the row's median step.
 *
 * This is the gate on the phase mapping itself, and it is the only clause here
 * that can see how much of a turn the row actually covers. A ratio between the
 * seam and the ordinary steps cannot: a row sampled over one and a half turns
 * still wraps by a plausible-looking amount, and on some figures it wraps by
 * *less* than the shipped art does, because over-running raises the ordinary
 * steps faster than it raises the seam. Asking the row for the frame after its
 * last one and requiring it to be the frame it started on pins the mapping
 * exactly: `frame / frameCount` lands on phase 1, which every pose function here
 * answers identically to phase 0, while `(frame * 1.5) / frameCount` lands on
 * phase 1.5 and `frame / (frameCount - 1)` on phase `n/(n-1)`.
 *
 * A numerical tolerance rather than an equality: the shipped rows land within
 * 1e-15 of their own start, which is floating-point noise in a sine, so 1e-6 is
 * six orders of magnitude of slack and still nowhere near any real motion.
 *
 * Measured over the same joints as the seam, which leaves out `headTurn`: the
 * idle rows drive it from a *half*-frequency sine that resets at the wrap rather
 * than closing, so measuring it here would fail shipped art on an authored
 * decision this gate has no business overruling.
 *
 * What it cannot see: a row sampled over a whole number of turns greater than
 * one. Phase 2 and phase 0 are the same pose, so the wrap closes and the steps
 * stay even — the symptom is aliasing rather than a pop.
 */
const PHASE_TURN_TOLERANCE = 1e-6;

/** Joints sampled to measure how much a pose changed between two frames. */
function poseFingerprint(pose: SkeletonPose): readonly number[] {
  return [
    pose.leftFoot.x,
    pose.leftFoot.y,
    pose.rightFoot.x,
    pose.rightFoot.y,
    pose.bob,
    pose.sway,
    pose.lean,
    pose.leftHand.x,
    pose.leftHand.y,
    pose.rightHand.x,
    pose.rightHand.y,
  ];
}

function poseDistance(a: SkeletonPose, b: SkeletonPose): number {
  const left = poseFingerprint(a);
  const right = poseFingerprint(b);
  let total = 0;
  for (let i = 0; i < left.length; i++) total += (left[i] - right[i]) ** 2;
  return Math.sqrt(total);
}

/**
 * The ceiling's denominator is the row's largest ordinary step, and the floor's
 * is its median.
 *
 * They are different on purpose. A cycle built from sinusoids takes bimodal
 * steps — large through the middle of the swing, near zero at the turnarounds —
 * so a median sits down among the small ones and a healthy seam already measures
 * 1.45–1.87× it; a ceiling hung off the median is therefore no bound at all,
 * which is what the 1.6× this replaces turned out to be. Measured against the
 * largest step instead, every shipped row of all three variants closes between
 * 0.331× and 1.080× (the walks near 0.33, the idles just over 1.0), so 1.15
 * leaves room for the art and none for a cycle that overshoots its turn.
 *
 * The floor cannot use the narrowest step: a row may legitimately contain two
 * byte-identical adjacent frames, which would collapse it into `seam >= 0`. Nor
 * the largest, which the walks sit at 0.33× of. Against the median the shipped
 * rows run 0.451–1.866×, so 0.3 sits a third below the tightest of them.
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function gateLoopClosure(): void {
  let rowsMeasured = 0;
  for (const variant of VARIANTS) {
    for (const row of SKELETON_ROWS[variant]) {
      if (row.kind !== 'loop') continue;
      rowsMeasured++;
      const poses: SkeletonPose[] = [];
      for (let frame = 0; frame < row.frameCount; frame++) poses.push(row.pose(frame));
      const steps: number[] = [];
      for (let frame = 0; frame < poses.length - 1; frame++) {
        steps.push(poseDistance(poses[frame], poses[frame + 1]));
      }
      if (steps.length === 0) {
        fail('G2', `${variant}/${row.name}: a looping row with no consecutive frames to compare`);
        continue;
      }
      const seam = poseDistance(poses[poses.length - 1], poses[0]);
      const largest = Math.max(...steps);
      const typical = median(steps);
      if (largest > 0 && seam > largest * LOOP_SEAM_CEILING) {
        fail(
          'G2',
          `${variant}/${row.name}: the loop does not close — the step across the seam is ` +
            `${(seam / largest).toFixed(2)}× the row's own largest ordinary step (ceiling ` +
            `${LOOP_SEAM_CEILING}×), which pops once per cycle`,
        );
      }
      if (typical > 0 && seam < typical * LOOP_SEAM_FLOOR) {
        fail(
          'G2',
          `${variant}/${row.name}: the seam is only ${(seam / typical).toFixed(2)}× the row's ` +
            `median step (floor ${LOOP_SEAM_FLOOR}×) — the last frame all but repeats the first, ` +
            'so the cycle spends a whole frame held still instead of covering one turn',
        );
      }
      const pastTheEnd = poseDistance(row.pose(row.frameCount), poses[0]);
      if (typical > 0 && pastTheEnd > typical * PHASE_TURN_TOLERANCE) {
        fail(
          'G2',
          `${variant}/${row.name}: the frame after the last one is ` +
            `${(pastTheEnd / typical).toExponential(2)}× a median step away from the frame the ` +
            `row starts on, so the ${row.frameCount} frames do not cover exactly one turn of the ` +
            'cycle',
        );
      }
    }
  }
  failUnlessMeasured('G2', rowsMeasured, 'looping rows');
}

// ── G3 leg reach ─────────────────────────────────────────────────────────────

/** Headroom a leg must keep under its own full extension, in tile units. */
const MIN_LEG_REACH_HEADROOM = 0.002;

/**
 * G3 — no frame asks a leg to reach further than it is long.
 *
 * Checked on every frame of every row of every variant, one-shots included: a
 * crouch, a lunge or a climb out of the ground can put a foot out of reach just
 * as easily as a stride can. The IK clamps rather than throwing, so the symptom
 * is a leg locked dead straight with the foot hanging above the floor, which
 * reads as a hop and is invisible in the drawing code.
 */
function gateLegReach(): void {
  let framesMeasured = 0;
  for (const variant of VARIANTS) {
    for (const row of SKELETON_ROWS[variant]) {
      for (let frame = 0; frame < row.frameCount; frame++) {
        framesMeasured++;
        const headroom = legReachHeadroom(row.pose(frame), lateralFor(row.view));
        if (headroom < MIN_LEG_REACH_HEADROOM) {
          fail(
            'G3',
            `${variant}/${row.name}[${frame}]: a leg is over-extended by ` +
              `${(MIN_LEG_REACH_HEADROOM - headroom).toFixed(4)} tiles — the IK clamps and the ` +
              'foot hangs off the floor, which reads as a hop',
          );
        }
      }
    }
  }
  failUnlessMeasured('G3', framesMeasured, 'posed frames');
}

// ── G4 the figure stands on its own tile ─────────────────────────────────────

/**
 * How far the lowest solid pixel of a planted frame may sit from the cell's
 * ground line, in cell pixels.
 *
 * Measured against solid alpha rather than any ink: these figures paint a
 * contact shadow on the ground line wherever the feet actually are, so an
 * any-ink check measures the shadow and stays green while the body floats above
 * it. The band has to allow the shadow's own solid core and a foot pitched onto
 * its toe, and nothing like a whole boot.
 */
const SOLID_ALPHA = 200;
const GROUND_BAND_PX = 10;

/** The frames of each variant's idle where nothing is lifted off the floor. */
const PLANTED_ROWS: ReadonlyArray<string> = ['idle_side'];

/**
 * G4 — a standing frame's feet are on the cell's ground line.
 *
 * What it can prove and what it cannot. The painter takes its own paint origin
 * from `tileY + TILE_SCALE / 2`, which is the expression this measures against,
 * so moving `tileY` moves the ground line and the whole figure together and this
 * gate passes for any value of it — the parity run against the deleted sheet is
 * the only thing that ever checked that number. What it does catch is art
 * drifting off its own anchor: a pose authored a few pixels above or below the
 * rig's floor, on one variant and not the others.
 *
 * Measured against solid alpha rather than any ink: these figures paint a
 * contact shadow on the ground line wherever the feet actually are, so an
 * any-ink check measures the shadow and stays green while the body floats.
 */
function gateGroundLine(): void {
  let framesMeasured = 0;
  for (const variant of VARIANTS) {
    const figure = SKELETON_FIGURES[variant];
    const groundY = figure.tileY + figure.tileScale / 2;
    for (const rowName of PLANTED_ROWS) {
      const row = SKELETON_ROWS[variant].find((candidate) => candidate.name === rowName);
      if (row === undefined) {
        fail('G4', `${variant} has no row named "${rowName}" to measure`);
        continue;
      }
      for (let frame = 0; frame < row.frameCount; frame++) {
        framesMeasured++;
        const cell = paintFigureCell(figure, rowName, frame);
        const { data } = cell
          .getContext('2d')
          .getImageData(0, 0, figure.frameWidth, figure.frameHeight);
        let lowest = -1;
        for (let y = figure.frameHeight - 1; y >= 0 && lowest < 0; y--) {
          for (let x = 0; x < figure.frameWidth; x++) {
            if (data[(y * figure.frameWidth + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA) continue;
            lowest = y;
            break;
          }
        }
        if (lowest < 0) {
          fail('G4', `${variant}/${rowName}[${frame}] painted no solid pixel at all`);
          continue;
        }
        if (Math.abs(lowest - groundY) > GROUND_BAND_PX) {
          fail(
            'G4',
            `${variant}/${rowName}[${frame}]: the lowest solid pixel is at y=${lowest}, ` +
              `${Math.abs(lowest - groundY).toFixed(0)}px from the cell's ground line at ` +
              `y=${groundY} — the figure floats above, or sinks into, the tile it stands on`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G4', framesMeasured, 'planted frames');
}

// ── G5 the loose bones the runtime spawns ────────────────────────────────────

/**
 * G5 — every variant paints exactly the pieces the gore field spawns.
 *
 * `BodyPartGoreSystem` answers a state it cannot find by spawning nothing and
 * saying nothing, so a rename on either side is a bone that silently stops
 * flying. Checked in both directions: a piece a figure paints and the runtime
 * never asks for is a cell nobody sees and memory somebody pays for.
 *
 * What this deliberately does not do is compare the figures' bone set against
 * the shared one: `skeletonFigure`'s `GORE_STATES` is `SKELETON_GORE_STATES`
 * itself, so a clause comparing the two is a constant compared against itself
 * and cannot fail whatever the art does. The runtime's list is the only
 * independent side there is to check against.
 */
function gateGoreParts(): void {
  let namesChecked = 0;
  for (const part of SKELETON_GORE_PARTS) {
    namesChecked++;
    if (!GORE_STATES.includes(part)) {
      fail('G5', `the gore field spawns "${part}", which nothing paints`);
    }
  }
  for (const state of GORE_STATES) {
    if (!SKELETON_GORE_PARTS.includes(state)) {
      fail('G5', `the figures paint "${state}", which the gore field never spawns`);
    }
  }
  failUnlessMeasured('G5', namesChecked, 'gore part names');
}

// ── G6 the warm-row budget ───────────────────────────────────────────────────

const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * What one row of one variant may cost warm, in megabytes.
 *
 * A painted figure is admitted to the cache one state at a time, so the number
 * that decides whether it fits is the widest state's bytes — not the sum over
 * every state, which only binds on a figure holding its entire declared set at
 * once. These three warm every row they have the moment a wave of them is
 * scheduled, so the all-warm total is reported beside it and held to the cache's
 * own per-figure ceiling.
 */
const ROW_BUDGET_MEGABYTES = 4;
const FIGURE_BUDGET_MEGABYTES = 24;

function gateWarmRowSize(): void {
  let variantsMeasured = 0;
  for (const variant of VARIANTS) {
    const figure = SKELETON_FIGURES[variant];
    const cellBytes = figure.frameWidth * figure.frameHeight * BYTES_PER_PIXEL;
    let widestState = '';
    let widestFrames = 0;
    let statesMeasured = 0;
    let totalFrames = 0;
    for (const [state, declared] of figure.states) {
      statesMeasured++;
      totalFrames += declared.frames;
      if (declared.frames <= widestFrames) continue;
      widestFrames = declared.frames;
      widestState = state;
    }
    failUnlessMeasured('G6', statesMeasured, `${variant}'s declared states`);
    if (statesMeasured === 0) continue;
    variantsMeasured++;

    const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
    const allWarm = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
    console.log(
      `  G6 ${variant} warm row: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
        `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once would be ` +
        `${allWarm.toFixed(2)} MB`,
    );
    if (megabytes > ROW_BUDGET_MEGABYTES) {
      fail(
        'G6',
        `${variant}/${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
          `${ROW_BUDGET_MEGABYTES} MB`,
      );
    }
    if (allWarm > FIGURE_BUDGET_MEGABYTES) {
      fail(
        'G6',
        `${variant} would hold ${allWarm.toFixed(2)} MB with every row warm, past the ` +
          `${FIGURE_BUDGET_MEGABYTES} MB the cache allows one figure — and its prewarm asks ` +
          'for every row',
      );
    }
  }
  failUnlessMeasured('G6', variantsMeasured, 'variants');
}

// ── G7 the runtime's own names ───────────────────────────────────────────────

/**
 * Every pose name each sprite wrapper can build by template literal.
 *
 * Rebuilt here rather than imported, because the point of the gate is that the
 * *shape* of the names the wrapper assembles is one the figure answers: a base
 * crossed with the two suffixed views, plus the rows that exist in one facing
 * only.
 */
const VIEWED_BASES: Readonly<Record<SkeletonVariant, ReadonlyArray<string>>> = {
  lord: ['walk', 'idle', 'cast', 'hands_cast'],
  sword: ['walk', 'idle', 'slash'],
  archer: ['walk', 'idle', 'draw_loose'],
};

const SINGLE_VIEW_STATES: Readonly<Record<SkeletonVariant, ReadonlyArray<string>>> = {
  lord: ['summon'],
  sword: ['rise'],
  archer: ['rise'],
};

function runtimeStateNames(variant: SkeletonVariant): string[] {
  const names: string[] = [...SINGLE_VIEW_STATES[variant]];
  for (const base of VIEWED_BASES[variant]) names.push(base, `${base}_side`, `${base}_away`);
  return names;
}

/**
 * G7 — every state name the runtime can ask for is one the figure paints.
 *
 * Both draw paths answer a name the figure does not declare by returning without
 * drawing anything and saying nothing: a whole facing of a mob, or a body part,
 * simply never appears and nothing is logged.
 */
function gateRuntimeStateNames(): void {
  let rowsChecked = 0;
  for (const variant of VARIANTS) {
    const figure = SKELETON_FIGURES[variant];
    const prewarmed = SKELETON_PREWARMED_STATES[figure.id] ?? [];
    if (prewarmed.length === 0) {
      fail('G7', `${variant}: the sprite module names no prewarmed states for "${figure.id}"`);
    }
    const tables: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['the sprite wrapper', runtimeStateNames(variant)],
      ['the gore field', SKELETON_GORE_PARTS],
      ['the prewarm list', prewarmed],
    ];
    for (const [purpose, names] of tables) {
      for (const failure of missingStateFailures(figure, names, purpose)) {
        fail('G7', `${variant}: ${failure}`);
      }
    }
    // A row the figure paints and nothing can name is memory with no caller.
    const reachable = new Set([
      ...runtimeStateNames(variant),
      ...SKELETON_GORE_PARTS,
      ...prewarmed,
    ]);
    for (const row of SKELETON_ROWS[variant]) {
      rowsChecked++;
      if (reachable.has(row.name)) continue;
      fail('G7', `${variant} paints "${row.name}", which nothing in the runtime can name`);
    }
  }
  failUnlessMeasured('G7', rowsChecked, 'pose rows');
}

// ── G8 the frozen gore recentring ────────────────────────────────────────────

/**
 * How far a loose bone's ink may sit from the centre of its own cell, in cell
 * pixels.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of the cell, so ink that
 * does not sit there orbits rather than tumbles. A pixel and a half of slack:
 * the frozen nudges were computed from a rasterised bounding box measured at a
 * different canvas size, and a bounding box is a pixel-grained thing.
 */
const GORE_CENTRING_TOLERANCE_PX = 1.5;

/**
 * G8 — the frozen recentring nudges still land each bone on its cell's centre.
 *
 * The nudges are the one set of numbers in the figures that cannot be computed
 * where they are used: finding the centre of a piece's ink means painting it and
 * reading the pixels back, which nothing at runtime can do. They are frozen in
 * the figure module and their *effect* is re-measured here, off the real cell, so
 * a redrawn bone cannot silently start orbiting.
 *
 * Checked in both directions. A frozen nudge with no piece left to own it is a
 * dead entry that reads like a maintained measurement, and the next agent to add
 * a piece by that name inherits a number measured off art that is gone.
 */
function gateGoreRecentre(): void {
  let piecesMeasured = 0;
  let worstGap = 0;
  let worstAt = '';
  for (const variant of VARIANTS) {
    const figure = SKELETON_FIGURES[variant];
    const painted = new Set(GORE_STATES);
    for (const frozen of GORE_RECENTRE_PX[variant].keys()) {
      if (painted.has(frozen)) continue;
      fail('G8', `${variant} freezes a nudge for "${frozen}", which nothing paints any more`);
    }
    const centreX = figure.frameWidth / 2;
    const centreY = figure.frameHeight / 2;
    for (const state of GORE_STATES) {
      piecesMeasured++;
      if (!GORE_RECENTRE_PX[variant].has(state)) {
        fail('G8', `${variant} freezes no recentring nudge for "${state}"`);
        continue;
      }
      const cell = paintFigureCell(figure, state, 0);
      const { data } = cell
        .getContext('2d')
        .getImageData(0, 0, figure.frameWidth, figure.frameHeight);
      const box = inkBoxIn(data, figure.frameWidth, figure.frameHeight);
      if (box === null) {
        fail('G8', `${variant}/${state} painted nothing at all into its cell`);
        continue;
      }
      const gap = Math.hypot(
        (box.minX + box.maxX) / 2 - centreX,
        (box.minY + box.maxY) / 2 - centreY,
      );
      if (gap > worstGap) {
        worstGap = gap;
        worstAt = `${variant}/${state}`;
      }
      if (gap > GORE_CENTRING_TOLERANCE_PX) {
        fail(
          'G8',
          `${variant}/${state}'s ink centres ${gap.toFixed(2)}px from the centre of its cell, ` +
            `past the ${GORE_CENTRING_TOLERANCE_PX}px it is held to — the piece will orbit ` +
            'rather than tumble; re-measure the frozen nudge',
        );
      }
    }
  }
  failUnlessMeasured('G8', piecesMeasured, 'loose bones');
  console.log(`  G8 worst gore centring gap ${worstGap.toFixed(2)}px at ${worstAt}`);
}

// ── G9 the bones are drawn at their own variant's size ───────────────────────

/**
 * How much taller than the archer's the Lord's longest bone must be.
 *
 * An ordering rather than a frozen span: the pieces are painted at each
 * variant's own figure scale, and the whole point of scaling them is that a
 * 2.5-tile Lord does not scatter a 1.5-tile archer's bones. A shared bone size
 * across the three is exactly what happens when the scale stops being applied,
 * and it is invisible in any single variant's contact sheet.
 */
const MIN_LORD_TO_ARCHER_BONE_RATIO = 1.4;

function longestBoneOf(variant: SkeletonVariant): number {
  const span = 512;
  const origin = span / 2;
  const canvas = createCanvas(span, span);
  const ctx = canvas.getContext('2d');
  const art = asGameContext(ctx);
  const unit = goreUnitOf(variant);
  let longest = 0;
  for (const piece of skeletonGorePieces(variant)) {
    ctx.clearRect(0, 0, span, span);
    art.save();
    art.translate(origin, origin);
    art.scale(unit, unit);
    piece.paint(art);
    art.restore();
    const box = inkBoxIn(ctx.getImageData(0, 0, span, span).data, span, span);
    if (box === null) {
      fail('G9', `${variant}/${piece.state} painted nothing at all about its own origin`);
      continue;
    }
    longest = Math.max(longest, box.maxX - box.minX, box.maxY - box.minY);
  }
  return longest;
}

function gateBoneScale(): void {
  const longest = new Map<SkeletonVariant, number>();
  let variantsMeasured = 0;
  for (const variant of VARIANTS) {
    const reach = longestBoneOf(variant);
    if (reach <= 0) {
      fail('G9', `${variant} painted no measurable bone at all`);
      continue;
    }
    variantsMeasured++;
    longest.set(variant, reach);
  }
  failUnlessMeasured('G9', variantsMeasured, 'variants');
  const lord = longest.get('lord');
  const archer = longest.get('archer');
  if (lord === undefined || archer === undefined) return;
  console.log(
    `  G9 longest bone: lord ${lord.toFixed(0)}px, archer ${archer.toFixed(0)}px ` +
      `(ratio ${(lord / archer).toFixed(2)}×)`,
  );
  if (lord / archer < MIN_LORD_TO_ARCHER_BONE_RATIO) {
    fail(
      'G9',
      `the Lord's longest bone is only ${(lord / archer).toFixed(2)}× the archer's, under the ` +
        `${MIN_LORD_TO_ARCHER_BONE_RATIO}× a whole tile of height between them should give — ` +
        'the variant scale has stopped reaching the loose bones',
    );
  }
}

// ── G10 the variants are visibly different heights ───────────────────────────

/**
 * How much taller the Lord's painted silhouette must be than the archer's.
 *
 * The three share every pose function and differ only by a scale applied at the
 * cell, so a scale that stops being applied leaves three identical creatures at
 * three cell sizes — and each one's own contact sheet still looks right. Measured
 * off the painted idle rather than off the declared heights, which is the number
 * that would have been edited.
 */
const MIN_LORD_TO_ARCHER_HEIGHT_RATIO = 1.5;

function paintedHeightOf(variant: SkeletonVariant): number {
  const figure = SKELETON_FIGURES[variant];
  const cell = bakeFigureCell(figure, 'idle', 0);
  const { data } = cell.getContext('2d').getImageData(0, 0, figure.frameWidth, figure.frameHeight);
  const box = inkBoxIn(data, figure.frameWidth, figure.frameHeight);
  if (box === null) {
    fail('G10', `${variant}'s idle painted nothing at all`);
    return 0;
  }
  return box.maxY - box.minY + 1;
}

function gateVariantHeights(): void {
  const lord = paintedHeightOf('lord');
  const sword = paintedHeightOf('sword');
  const archer = paintedHeightOf('archer');
  if (lord === 0 || sword === 0 || archer === 0) return;
  console.log(
    `  G10 painted idle heights: lord ${lord}px, sword ${sword}px, archer ${archer}px ` +
      `(lord/archer ${(lord / archer).toFixed(2)}×)`,
  );
  if (lord / archer < MIN_LORD_TO_ARCHER_HEIGHT_RATIO) {
    fail(
      'G10',
      `the Lord stands only ${(lord / archer).toFixed(2)}× the archer's painted height, under ` +
        `the ${MIN_LORD_TO_ARCHER_HEIGHT_RATIO}× their declared tile heights call for — the ` +
        'per-variant scale has stopped being applied',
    );
  }
  if (sword < archer) {
    fail(
      'G10',
      `the sword warrior paints shorter (${sword}px) than the archer (${archer}px), which ` +
        'inverts their declared heights',
    );
  }
}

/** Runs every gate and returns one message per failure. */
export function skeletonGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateLoopClosure();
  gateLegReach();
  gateGroundLine();
  gateGoreParts();
  gateWarmRowSize();
  gateRuntimeStateNames();
  gateGoreRecentre();
  gateBoneScale();
  gateVariantHeights();
  return [...failures];
}
