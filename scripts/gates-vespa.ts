/**
 * The Brindled Vespa's art gates.
 *
 * The hornet has no baked sheet to inspect any more, so every invariant the old
 * bake enforced by throwing before it wrote a PNG is enforced here instead,
 * against cells painted from `BRINDLED_VESPA_FIGURE` exactly the way the runtime
 * cache bakes them — supersampled and downsampled — so what is measured is what
 * the game blits. The pose-stream gates measure the choreography itself and need
 * no pixels at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing.
 *
 * Run by the review harness: `npm run render:vespa`.
 */

import { createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { asGameContext } from './nodeGameContext.js';
import {
  ABDOMEN_TIP_X,
  BRINDLED_VESPA_BUILD,
  STINGER_LENGTH,
  THORAX_X,
  WING_LENGTH,
  restVespaPose,
} from '../src/sprites/art/brindledVespaArt.js';
import { brindledVespaGorePieces } from '../src/sprites/art/brindledVespaGore.js';
import {
  BRINDLED_VESPA_FIGURE,
  BRINDLED_VESPA_ROWS,
  GORE_RECENTRE,
  GORE_STATES,
  GORE_UNIT,
  TILE_SCALE,
  type RowSpec,
} from '../src/sprites/art/brindledVespaFigure.js';
import {
  BRINDLED_VESPA_GORE_PARTS,
  BRINDLED_VESPA_STATES,
} from '../src/sprites/brindledVespaSprite.js';

const INK_ALPHA_THRESHOLD = 24;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/** Clear pixels kept around the cell when measuring art that may have outgrown it. */
const MEASURE_PAD = 64;

const { frameWidth, frameHeight } = BRINDLED_VESPA_FIGURE;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — looping rows only, one entry per
 * painted piece, one pair per row — and a narrowing that matches nothing leaves
 * a green gate that examined nothing. Every filtering loop here counts what it
 * looked at and ends with a call to this.
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
  const cell = bakeFigureCell(BRINDLED_VESPA_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  alphaByCell.set(key, alpha);
  return alpha;
}

function inkCount(alpha: Uint8ClampedArray): number {
  let count = 0;
  for (const value of alpha) if (value >= INK_ALPHA_THRESHOLD) count++;
  return count;
}

/** Count of pixels whose coverage differs between two frames. */
function coverageDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
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

interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * A frame's ink box, measured on a canvas padded well past the cell on every
 * side.
 *
 * Padded because the declared cell clears the widest pose by only a handful of
 * pixels: measured inside it, art that has outgrown its cell is clipped away
 * before it can be measured, and the cell gate below could only ever report what
 * the clipping gate had already caught. The padding is taken back out of the
 * returned box, so the answer is in cell coordinates.
 */
function unclippedInkBox(state: string, frame: number): Box | null {
  const canvas = createCanvas(frameWidth + MEASURE_PAD * 2, frameHeight + MEASURE_PAD * 2);
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(MEASURE_PAD, MEASURE_PAD);
  BRINDLED_VESPA_FIGURE.paintFrame(asGameContext(ctx), state, frame);
  ctx.restore();
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
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
  if (maxX < 0) return null;
  return {
    minX: minX - MEASURE_PAD,
    minY: minY - MEASURE_PAD,
    maxX: maxX - MEASURE_PAD,
    maxY: maxY - MEASURE_PAD,
  };
}

/**
 * The row a gate names, or null after recording a failure.
 *
 * Every one of these names is a string literal written here rather than in
 * `BRINDLED_VESPA_ROWS`, so renaming a row would otherwise turn its gate into a
 * silent no-op: present, green, and measuring nothing.
 */
function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = BRINDLED_VESPA_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `no row named "${name}" — a gate is guarding a row that no longer exists`);
    return null;
  }
  return row;
}

// ── G1 structure ─────────────────────────────────────────────────────────────

/**
 * G1 — the shared structural gates: every declared state paints every declared
 * frame, nothing paints against the cell edge, and the cell is not mostly empty.
 * The gore states are exempt from the fill check: a severed antenna is meant to
 * be small inside a cell sized for a wingspan.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(BRINDLED_VESPA_FIGURE, {
    sparseStates: GORE_STATES,
  })) {
    fail('G1', failure);
  }
}

// ── G2 anatomy ───────────────────────────────────────────────────────────────

/**
 * The thresholds the anatomy is held to.
 *
 * These are the only literals in this section on purpose: the *measurements* are
 * imported from `brindledVespaArt.ts`, so shortening the abdomen or the wings
 * there fails the gate. Mirroring the measurements as local constants too would
 * quietly make every comparison two compile-time literals that could never
 * disagree.
 */
const MIN_WING_TO_BODY_RATIO = 0.7;
const MIN_STINGER_LENGTH = 0.03;
const LEG_COUNT = 6;
const LEGS_PER_SIDE = 3;

/**
 * G2 — geometric truths about the anatomy, checked before a pixel is painted.
 *
 * A hornet is read from three things at 32 px: wings long enough to be wings
 * rather than fins, a stinger on the end of the abdomen, and three legs a side.
 * Every one of them is a number in the art module that a refactor can move
 * without any pixel gate noticing, because each change is small on its own.
 */
function gateAnatomy(): void {
  const bodyLength = THORAX_X - ABDOMEN_TIP_X;
  const wingToBody = WING_LENGTH / bodyLength;
  if (wingToBody < MIN_WING_TO_BODY_RATIO) {
    fail(
      'G2',
      `the wing is ${wingToBody.toFixed(2)}x the body's length; a wasp carries at least ` +
        `${MIN_WING_TO_BODY_RATIO}x or the wings read as fins`,
    );
  }
  if (STINGER_LENGTH < MIN_STINGER_LENGTH) {
    fail(
      'G2',
      `the sting is ${STINGER_LENGTH} tiles long, under the ${MIN_STINGER_LENGTH} it takes to ` +
        'show at the tip of the abdomen — the one thing that says this animal is dangerous',
    );
  }
  // Three legs a side, and only three. Counted off the pose rather than written
  // as a literal, so a rig that lost one fails here rather than in a screenshot.
  const dangles = restVespaPose().legs.length;
  if (dangles !== LEGS_PER_SIDE) {
    fail(
      'G2',
      `the pose carries ${dangles} leg pairs; an insect has ${LEG_COUNT} legs, which is ` +
        `${LEGS_PER_SIDE} pairs`,
    );
  }
}

// ── G3 the hornet hangs over its tile ────────────────────────────────────────

/**
 * How far the ink's horizontal centre may sit from the centre of the hornet's
 * own tile box, in tiles.
 *
 * A flier has no ground line to stand on — the whole point of `isFlying` is that
 * it hovers — so the anchor that has to hold is lateral: the body must hang over
 * the tile the game thinks it occupies, or every attack that measures range from
 * that tile lands somewhere the player is not looking.
 *
 * Measured against `tileX + tileScale / 2`, the box the runtime hangs a health
 * bar off, rather than against anything the painter derives from the same
 * constant — a gate whose reference moves with the constant under test passes
 * for any value of it.
 */
const HOVER_CENTRE_BAND_TILES = 0.3;

function gateHoversOverItsTile(): void {
  const tileCentreX = BRINDLED_VESPA_FIGURE.tileX + TILE_SCALE / 2;
  let framesMeasured = 0;
  for (const row of BRINDLED_VESPA_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const box = unclippedInkBox(row.name, frame);
      if (box === null) {
        fail('G3', `${row.name}[${frame}] painted nothing at all`);
        continue;
      }
      framesMeasured++;
      const centre = (box.minX + box.maxX) / 2;
      const offset = (centre - tileCentreX) / TILE_SCALE;
      if (Math.abs(offset) <= HOVER_CENTRE_BAND_TILES) continue;
      fail(
        'G3',
        `${row.name}[${frame}] centres its ink ${offset.toFixed(2)} tiles from the middle of its ` +
          `own tile box — the hornet is not over the tile the game aims at`,
      );
    }
  }
  failUnlessMeasured('G3', framesMeasured, 'animation frames');
}

// ── G4 loops close ───────────────────────────────────────────────────────────

/**
 * How much bigger the wrap from a loop's last frame to its first may be than the
 * largest step inside the loop.
 *
 * Compared against the loop's own largest step rather than a pixel count, and
 * against the largest rather than the median because a wingbeat's steps are
 * bimodal by nature: fast through the middle of the stroke and slow at each
 * extreme.
 *
 * The three shipped hovers seam at 0.92 to 1.01 of their own widest step, so
 * this clears the art by a seventh. What it cannot see whatever it is set to is
 * a row running more than one cycle: over-running the wingbeat raises the
 * ordinary steps by *more* than the seam, so the ratio falls to 0.87 and reads
 * as a cleaner loop than the shipped one. The phase check below is what holds
 * the cycle count.
 */
const LOOP_WRAP_TOLERANCE = 1.15;

/**
 * The float epsilon a loop row's sampled phases are held to.
 *
 * Every shipped row samples exact rationals, so this guards against binary
 * rounding rather than allowing the choreography any slack.
 */
const LOOP_PHASE_EPSILON = 1e-9;

/**
 * The failures for a loop row that does not sample exactly one turn of its cycle
 * in evenly spaced steps.
 *
 * This is the half of loop closure no pixel measurement can reach, and on this
 * figure the pixel side does not merely miss the defect but inverts on it: a
 * hover running 1.5 turns seams at a *smaller* share of its widest step than the
 * shipped row does. The cycle count only exists in the phase the choreography
 * samples at, which every loop pose carries as its `time`.
 *
 * @param phaseAt The phase a frame is sampled at, straight off the row's pose.
 */
function loopPhaseFailures(
  label: string,
  frameCount: number,
  phaseAt: (frame: number) => number,
): string[] {
  const messages: string[] = [];
  const step = phaseAt(1) - phaseAt(0);
  for (let frame = 2; frame < frameCount; frame++) {
    const thisStep = phaseAt(frame) - phaseAt(frame - 1);
    if (Math.abs(thisStep - step) <= LOOP_PHASE_EPSILON) continue;
    messages.push(
      `${label} advances ${thisStep} of a cycle into frame ${frame} but ${step} into frame 1 — ` +
        'the loop is sampled unevenly, so it plays fast in one place and slow in another',
    );
    break;
  }
  const turnsCovered = step * frameCount;
  if (Math.abs(turnsCovered - 1) > LOOP_PHASE_EPSILON) {
    messages.push(
      `${label} covers ${turnsCovered} turns of its cycle over ${frameCount} frames rather than ` +
        'exactly one — a row that over-runs its cycle seams as cleanly as one that closes, so ' +
        'no pixel measurement can see this',
    );
  }
  return messages;
}

/**
 * How small the wrap may be relative to the loop's *median* step.
 *
 * The other half of the same defect, and the half a ceiling alone cannot see:
 * sampling at `frame / (frameCount - 1)` instead of `frame / frameCount` makes
 * the last frame identical to the first, so the wrap goes to nothing while the
 * cycle spends a whole frame of its budget held still. Measured against the
 * median rather than the narrowest step, so a pair of frames that happen to sit
 * close together cannot take the floor down with them. The three shipped hovers
 * wrap between 1.10 and 1.83 of their own median step.
 */
const MIN_LOOP_WRAP_SHARE = 0.5;

function gateLoopClosure(): void {
  let loopsMeasured = 0;
  for (const row of BRINDLED_VESPA_ROWS) {
    if (row.kind !== 'loop') continue;
    if (row.frameCount < 2) {
      fail('G4', `${row.name} declares ${row.frameCount} frames, which cannot be a loop`);
      continue;
    }
    loopsMeasured++;
    for (const failure of loopPhaseFailures(
      row.name,
      row.frameCount,
      (frame) => row.pose(frame).time,
    )) {
      fail('G4', failure);
    }
    const steps: number[] = [];
    for (let frame = 1; frame < row.frameCount; frame++) {
      steps.push(coverageDelta(cellAlpha(row.name, frame - 1), cellAlpha(row.name, frame)));
    }
    const widestStep = Math.max(...steps);
    const typicalStep = median(steps);
    const wrap = coverageDelta(cellAlpha(row.name, row.frameCount - 1), cellAlpha(row.name, 0));
    if (wrap > widestStep * LOOP_WRAP_TOLERANCE) {
      fail(
        'G4',
        `${row.name} jumps ${wrap} px of coverage from its last frame back to its first, ` +
          `against a widest in-cycle step of ${widestStep} — the loop does not close`,
      );
      continue;
    }
    if (wrap >= typicalStep * MIN_LOOP_WRAP_SHARE) continue;
    fail(
      'G4',
      `${row.name} moves only ${wrap} px of coverage from its last frame back to its first, ` +
        `against a median in-cycle step of ${typicalStep} — the row ends on a repeat of the ` +
        'frame it starts on and spends a frame of the cycle held still',
    );
  }
  failUnlessMeasured('G4', loopsMeasured, 'looping rows');
}

// ── G5 nothing is frozen ─────────────────────────────────────────────────────

/**
 * The share of a frame's own ink that must change between two adjacent frames of
 * the hover.
 *
 * Animation over the frame budget aliases: an oscillation sampled at or past its
 * own frequency comes out as a freeze or a strobe, and neither is visible in the
 * code that produced it. A wingbeat is the fastest cycle in this figure and the
 * likeliest to alias, so it is the one this most needs to hold.
 */
const MIN_LOOP_STEP_SHARE = 0.02;

/**
 * The share of the wind-up's ink its widest step must reach.
 *
 * The charge is mostly a slow rear-back, so its *smallest* step is legitimately
 * tiny; what must exist is somewhere the picture changes. Measured on the widest
 * step for that reason.
 */
const MIN_SHOT_PEAK_SHARE = 0.06;

function gateMotion(): void {
  let rowsMeasured = 0;
  for (const row of BRINDLED_VESPA_ROWS) {
    if (row.frameCount < 2) continue;
    rowsMeasured++;
    const reference = inkCount(cellAlpha(row.name, 0));
    let widestStep = 0;
    let narrowestStep = Infinity;
    for (let frame = 1; frame < row.frameCount; frame++) {
      const step = coverageDelta(cellAlpha(row.name, frame - 1), cellAlpha(row.name, frame));
      widestStep = Math.max(widestStep, step);
      narrowestStep = Math.min(narrowestStep, step);
    }
    if (row.kind === 'loop') {
      const share = narrowestStep / reference;
      if (share >= MIN_LOOP_STEP_SHARE) continue;
      fail(
        'G5',
        `${row.name} has two adjacent frames differing by only ${(share * 100).toFixed(1)}% of ` +
          `its ink, under the ${MIN_LOOP_STEP_SHARE * 100}% a wingbeat shows — the cycle has ` +
          'aliased into a hold',
      );
      continue;
    }
    const share = widestStep / reference;
    if (share >= MIN_SHOT_PEAK_SHARE) continue;
    fail(
      'G5',
      `${row.name} never moves more than ${(share * 100).toFixed(1)}% of its ink between ` +
        `frames, under the ${MIN_SHOT_PEAK_SHARE * 100}% the rear-back shows — there is no ` +
        'charge in the charge',
    );
  }
  failUnlessMeasured('G5', rowsMeasured, 'animation rows');
}

// ── G6 the wind-up is a warning ──────────────────────────────────────────────

/**
 * How far the abdomen must curl and the mandibles open through the wind-up.
 *
 * The charge is the player's only warning that acid is coming, and it has to be
 * a different picture from the hover it interrupts — the animal rears, curls the
 * sting under itself and opens its jaws. A wind-up whose values never leave the
 * rest pose still animates its wings and passes every pixel gate above, because
 * the wingbeat alone moves more ink than the rear-back does.
 */
const MIN_WINDUP_ABDOMEN_CURL = 0.15;
const MIN_WINDUP_MANDIBLE_OPEN = 0.6;

/**
 * How far into the row the wind-up must have settled back down by, so the pose
 * hands off to the hover that follows the shot rather than freezing mid-rear.
 */
const WINDUP_RELEASE_SETTLE = 0.35;

function gateWindupReadsAsAWarning(): void {
  const rest = restVespaPose();
  let rowsMeasured = 0;
  for (const row of BRINDLED_VESPA_ROWS) {
    if (row.kind !== 'oneShot') continue;
    rowsMeasured++;
    let peakCurl = 0;
    let peakOpen = 0;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = row.pose(frame);
      peakCurl = Math.max(peakCurl, Math.abs(pose.abdomenCurl - rest.abdomenCurl));
      peakOpen = Math.max(peakOpen, pose.mandibleOpen - rest.mandibleOpen);
    }
    if (peakCurl < MIN_WINDUP_ABDOMEN_CURL) {
      fail(
        'G6',
        `${row.name} curls its abdomen only ${peakCurl.toFixed(3)} rad from rest (minimum ` +
          `${MIN_WINDUP_ABDOMEN_CURL}) — the rear-back the player is warned by is not there`,
      );
    }
    if (peakOpen < MIN_WINDUP_MANDIBLE_OPEN) {
      fail(
        'G6',
        `${row.name} opens its mandibles only ${peakOpen.toFixed(2)} (minimum ` +
          `${MIN_WINDUP_MANDIBLE_OPEN}) — the charge never shows a mouth`,
      );
    }
    const settled = row.pose(row.frameCount - 1);
    if (Math.abs(settled.abdomenCurl - rest.abdomenCurl) <= peakCurl * WINDUP_RELEASE_SETTLE) {
      continue;
    }
    fail(
      'G6',
      `${row.name} ends still curled ${Math.abs(settled.abdomenCurl - rest.abdomenCurl).toFixed(3)} ` +
        `rad from rest, over ${WINDUP_RELEASE_SETTLE} of its own peak — the row hands off to a ` +
        'hover it does not resemble and the acid leaves a frozen hornet',
    );
  }
  failUnlessMeasured('G6', rowsMeasured, 'wind-up rows');
}

// ── G7 the pieces are told apart ─────────────────────────────────────────────

/**
 * How much of the smaller piece's ink two severed pieces must differ by.
 *
 * The exit criterion for the set is naming all eight from the in-game strip, and
 * two pieces that cover the same pixels cannot be named apart at 32 px whatever
 * their colouring. Measured off the shipped set rather than copied from another
 * creature's, and what it can honestly prove is that no two pieces are the
 * *same* shape, which is what a duplicated entry in the piece list looks like
 * and scores at zero.
 */
const MIN_PIECE_DISTINCTION_SHARE = 0.3;

function gateGoreDistinctness(): void {
  let pairsMeasured = 0;
  for (let a = 0; a < GORE_STATES.length; a++) {
    for (let b = a + 1; b < GORE_STATES.length; b++) {
      const first = cellAlpha(GORE_STATES[a], 0);
      const second = cellAlpha(GORE_STATES[b], 0);
      pairsMeasured++;
      const smaller = Math.min(inkCount(first), inkCount(second));
      if (smaller === 0) {
        fail('G7', `${GORE_STATES[a]} or ${GORE_STATES[b]} painted nothing`);
        continue;
      }
      const share = coverageDelta(first, second) / smaller;
      if (share >= MIN_PIECE_DISTINCTION_SHARE) continue;
      fail(
        'G7',
        `${GORE_STATES[a]} and ${GORE_STATES[b]} differ by only ${(share * 100).toFixed(1)}% of ` +
          "the smaller piece's ink — they cannot be told apart at the size they render",
      );
    }
  }
  failUnlessMeasured('G7', pairsMeasured, 'gore piece pairs');
}

// ── G8 the pieces can spin ───────────────────────────────────────────────────

/**
 * G8 — a gore piece sweeps its cell's *inscribed* circle when
 * `BodyPartGoreSystem` spins it, so a cell wide enough but not tall enough still
 * shears the piece halfway through its tumble — a defect that only shows in
 * play, on one frame out of a spin, which is why it is measured here rather than
 * looked for.
 */
function gateGoreRotationClearance(): void {
  const centreX = frameWidth / 2;
  const centreY = frameHeight / 2;
  const spinRadius = Math.min(centreX, centreY);
  let piecesMeasured = 0;
  for (const state of GORE_STATES) {
    const alpha = cellAlpha(state, 0);
    let worst = 0;
    let found = false;
    for (let y = 0; y < frameHeight; y++) {
      for (let x = 0; x < frameWidth; x++) {
        if (alpha[y * frameWidth + x] < INK_ALPHA_THRESHOLD) continue;
        found = true;
        worst = Math.max(worst, Math.hypot(x + 0.5 - centreX, y + 0.5 - centreY));
      }
    }
    if (!found) {
      fail('G8', `${state} painted nothing to measure`);
      continue;
    }
    piecesMeasured++;
    if (worst <= spinRadius) continue;
    fail(
      'G8',
      `${state} reaches ${worst.toFixed(1)} px from its cell's centre, past the ` +
        `${spinRadius.toFixed(1)} px it may spin through — it is sheared partway round a tumble`,
    );
  }
  failUnlessMeasured('G8', piecesMeasured, 'gore pieces');
}

// ── G9 the frozen recentring offsets ─────────────────────────────────────────

/**
 * How far a re-measured offset may sit from the frozen one, in piece units.
 *
 * Zero in principle — the same painter measured the same way — but a sub-pixel
 * band keeps the gate from firing on a rounding difference between node-canvas
 * builds rather than on the art.
 */
const GORE_RECENTRE_TOLERANCE = 1 / GORE_UNIT;
/** Scratch canvas for measuring a piece about its own origin. */
const GORE_MEASURE_SPAN = 512;
const GORE_MEASURE_ORIGIN = GORE_MEASURE_SPAN / 2;

/**
 * G9 — the frozen recentring offsets still describe the painted pieces.
 *
 * They are the one number in this figure that cannot be computed where it is
 * used: `BodyPartGoreSystem` spins a piece about the centre of its ink, and
 * finding that centre means painting the piece and reading the pixels back. They
 * are frozen in the figure module and re-measured here, so a redrawn piece
 * cannot silently start orbiting.
 *
 * Checked in both directions. A frozen offset with no piece left to own it is a
 * dead entry that reads like a maintained measurement, and the next agent to add
 * a piece by that name inherits a number measured off art that is gone.
 */
function gateGoreRecentre(): void {
  const canvas = createCanvas(GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
  const ctx = canvas.getContext('2d');
  const pieces = brindledVespaGorePieces();
  const paintedStates = new Set(pieces.map((piece) => piece.state));
  for (const frozenState of GORE_RECENTRE.keys()) {
    if (paintedStates.has(frozenState)) continue;
    fail(
      'G9',
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
    piece.paint(asGameContext(ctx), BRINDLED_VESPA_BUILD);
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
      fail('G9', `${piece.state} painted nothing at all when measured about its own centre`);
      continue;
    }
    const measuredX = (GORE_MEASURE_ORIGIN - (minX + maxX) / 2) / GORE_UNIT;
    const measuredY = (GORE_MEASURE_ORIGIN - (minY + maxY) / 2) / GORE_UNIT;
    const frozen = GORE_RECENTRE.get(piece.state);
    if (frozen === undefined) {
      fail('G9', `the figure freezes no recentring offset for ${piece.state}`);
      continue;
    }
    const gap = Math.hypot(measuredX - frozen.x, measuredY - frozen.y);
    if (gap <= GORE_RECENTRE_TOLERANCE) continue;
    fail(
      'G9',
      `${piece.state}'s ink centres at (${measuredX}, ${measuredY}) but GORE_RECENTRE freezes ` +
        `(${frozen.x}, ${frozen.y}) — the piece will orbit rather than tumble; paste the ` +
        'measured pair',
    );
  }
  failUnlessMeasured('G9', piecesMeasured, 'gore pieces');
}

// ── G10 warm-row memory ──────────────────────────────────────────────────────

/**
 * The hard ceiling for one warm animation row.
 *
 * The sheet this figure replaced had a whole-texture budget, because the whole
 * texture was decoded whether or not anything played. A painted figure is
 * admitted to the cache one state at a time and lets go of the states it stops
 * playing, so the number that decides whether it fits is the widest state's warm
 * bytes rather than the sum of every state.
 */
const ROW_BUDGET_MEGABYTES = 3;

/**
 * G10 — the widest state's warm bytes, reported whether or not it passes.
 *
 * Measured over every state the figure declares rather than over the pose rows
 * alone: the cache does not know a gore piece from a wingbeat, and a gore state
 * that grew frames would otherwise be memory nothing accounts for.
 */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of BRINDLED_VESPA_FIGURE.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured('G10', statesMeasured, 'declared states');
  if (statesMeasured === 0) return;

  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarm = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  G10 warm row: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once would be ` +
      `${allWarm.toFixed(2)} MB`,
  );
  if (megabytes <= ROW_BUDGET_MEGABYTES) return;
  fail(
    'G10',
    `${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
      `${ROW_BUDGET_MEGABYTES} MB`,
  );
}

// ── G11 the runtime's own names ──────────────────────────────────────────────

/**
 * G11 — every state name the runtime can build is one the figure paints.
 *
 * `stateFor` composes its pose names by template literal, `BodyPartGoreSystem`
 * spawns its pieces by name, and the prewarm helper names whole rows. Every one
 * of those paths answers a name the figure does not declare by returning without
 * drawing anything and saying nothing: a whole facing of the hornet, or a body
 * part, simply never appears.
 *
 * The names are imported from the runtime module rather than scraped out of its
 * source, so a rename cannot make this gate quietly stop matching.
 */
function gateRuntimeStateNames(): void {
  const tables: ReadonlyArray<readonly [readonly string[], string]> = [
    [BRINDLED_VESPA_STATES, "brindledVespaSprite's BRINDLED_VESPA_STATES"],
    [BRINDLED_VESPA_GORE_PARTS, "brindledVespaSprite's BRINDLED_VESPA_GORE_PARTS"],
  ];
  for (const [names, purpose] of tables) {
    for (const failure of missingStateFailures(BRINDLED_VESPA_FIGURE, names, purpose)) {
      fail('G11', failure);
    }
  }
  // The other direction: a row the figure paints that no runtime name can reach
  // is art nobody ever sees, and it costs a cell in every accounting.
  const reachable = new Set([...BRINDLED_VESPA_STATES, ...BRINDLED_VESPA_GORE_PARTS]);
  let rowsMeasured = 0;
  for (const row of BRINDLED_VESPA_ROWS) {
    rowsMeasured++;
    if (reachable.has(row.name)) continue;
    fail('G11', `the figure paints "${row.name}", which no runtime state name can reach`);
  }
  failUnlessMeasured('G11', rowsMeasured, 'painted rows');
}

// ── G12 the hover is not the wind-up ─────────────────────────────────────────

/**
 * How much of the hover's ink the wind-up's loudest frame must differ from it
 * by.
 *
 * The wind-up is the only warning the acid gives, and a warning that looks like
 * the hover is not a warning. Held on the *closest* wind-up frame to the
 * *closest* hover frame, because the row starts and ends on a hovering pose by
 * design — what has to differ is the middle of it.
 */
const MIN_WINDUP_DISTINCTION_SHARE = 0.1;

function gateWindupReadsApart(): void {
  const hover = rowNamed('hover_side', 'G12');
  const windup = rowNamed('spit_windup_side', 'G12');
  if (hover === null || windup === null) return;
  let comparisons = 0;
  let loudest = 0;
  let reference = 0;
  for (let charge = 0; charge < windup.frameCount; charge++) {
    let closest = Infinity;
    let closestInk = 0;
    for (let beat = 0; beat < hover.frameCount; beat++) {
      comparisons++;
      const delta = coverageDelta(cellAlpha(windup.name, charge), cellAlpha(hover.name, beat));
      if (delta >= closest) continue;
      closest = delta;
      closestInk = inkCount(cellAlpha(hover.name, beat));
    }
    if (closest <= loudest) continue;
    loudest = closest;
    reference = closestInk;
  }
  failUnlessMeasured('G12', comparisons, 'wind-up against hover frame pairs');
  if (reference === 0) {
    fail('G12', 'every hover frame the wind-up was compared against painted no ink at all');
    return;
  }
  const share = loudest / reference;
  if (share >= MIN_WINDUP_DISTINCTION_SHARE) return;
  fail(
    'G12',
    `the wind-up never gets further than ${(share * 100).toFixed(1)}% of the hover's ink away ` +
      `from it (minimum ${MIN_WINDUP_DISTINCTION_SHARE * 100}%) — the charge does not read as a ` +
      'warning',
  );
}

/** Runs every gate and returns one message per failure. */
export function vespaGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateAnatomy();
  gateHoversOverItsTile();
  gateLoopClosure();
  gateMotion();
  gateWindupReadsAsAWarning();
  gateGoreDistinctness();
  gateGoreRotationClearance();
  gateGoreRecentre();
  gateWarmRowSize();
  gateRuntimeStateNames();
  gateWindupReadsApart();
  return [...failures];
}
