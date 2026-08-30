/**
 * The Lava Llama's art gates.
 *
 * The animal has no baked sheet to inspect any more, so every invariant the old
 * bake enforced by throwing before it wrote a PNG is enforced here instead,
 * against cells painted from `LLAMA_FIGURE` exactly the way the runtime cache
 * bakes them — supersampled and downsampled — so what is measured is what the
 * game blits. The pose-stream gates measure the choreography itself and need no
 * pixels at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing: a lookup
 * that quietly returns nothing turns a whole gate module green while measuring
 * nothing.
 *
 * Run by the review harness: `npm run render:llama`.
 */

import { createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { asGameContext } from './nodeGameContext.js';
import { llamaGorePieces } from '../src/sprites/art/llamaGore.js';
import {
  GORE_RECENTRE,
  GORE_STATES,
  GORE_UNIT,
  LLAMA_FIGURE,
  LLAMA_ROWS,
  TILE_SCALE,
  type RowSpec,
} from '../src/sprites/art/llamaFigure.js';
import { LLAMA_SPIT_RELEASE_PROGRESS } from '../src/sprites/llamaSpitTiming.js';
import {
  LLAMA_GORE_PARTS,
  LLAMA_PREWARMED_STATES,
  LLAMA_SPIT_STATES,
  LLAMA_STATES,
} from '../src/sprites/llamaSprite.js';

const INK_ALPHA_THRESHOLD = 24;
/**
 * Alpha above which a pixel is the animal itself rather than the soft contact
 * shadow it paints on the ground line. A ground gate measured against ordinary
 * ink measures the shadow, which lands where the feet ought to be whether or
 * not they are there — and stays green while the figure floats.
 */
const SOLID_ALPHA_THRESHOLD = 200;
/** Clear pixels kept around the cell when measuring where the feet land. */
const GROUND_MEASURE_PAD = 64;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

const { frameWidth, frameHeight } = LLAMA_FIGURE;

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
  const cell = bakeFigureCell(LLAMA_FIGURE, state, frame);
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

interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function inkBox(alpha: Uint8ClampedArray): Box | null {
  let minX = frameWidth;
  let minY = frameHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      if (alpha[y * frameWidth + x] < INK_ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/**
 * The lowest row holding a pixel solid enough to be the animal, measured on a
 * canvas padded well past the cell on every side.
 *
 * Padded because the declared cell clears the widest pose by only a handful of
 * pixels: measured inside it, art that has slipped off its anchor is clipped
 * away before it can be measured, and the ground gate could only ever report
 * what the clipping gate had already caught. The padding is taken back out of
 * the returned row, so the answer is in cell coordinates.
 */
function lowestSolidRowUnclipped(state: string, frame: number): number {
  const canvas = createCanvas(
    frameWidth + GROUND_MEASURE_PAD * 2,
    frameHeight + GROUND_MEASURE_PAD * 2,
  );
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(GROUND_MEASURE_PAD, GROUND_MEASURE_PAD);
  LLAMA_FIGURE.paintFrame(asGameContext(ctx), state, frame);
  ctx.restore();
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA_THRESHOLD) continue;
      return y - GROUND_MEASURE_PAD;
    }
  }
  return Number.NaN;
}

/**
 * The row a gate names, or null after recording a failure.
 *
 * Every one of these names is a string literal written here rather than in
 * `LLAMA_ROWS`, so renaming a row would otherwise turn its gate into a silent
 * no-op: present, green, and measuring nothing.
 */
function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = LLAMA_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `no row named "${name}" — a gate is guarding a row that no longer exists`);
    return null;
  }
  return row;
}

// ── G1 structure ─────────────────────────────────────────────────────────────

/**
 * G1 — the shared structural gates: every declared state paints every declared
 * frame, nothing paints against the cell edge, and the cell is not mostly
 * empty. The gore states are exempt from the fill check: a severed ear is meant
 * to be small inside a cell sized for a reared neck.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(LLAMA_FIGURE, { sparseStates: GORE_STATES })) {
    fail('G1', failure);
  }
}

// ── G2 the feet stand on the tile ────────────────────────────────────────────

/**
 * How far a planted frame's lowest solid pixel may sit from the bottom edge of
 * the animal's own tile box, in tiles.
 *
 * Measured against `tileY + tileScale` — the box the runtime hangs a health bar
 * off — rather than against the ground line the painter computes, because a gate
 * whose reference is derived from the constant under test moves both of its
 * sides at once and passes for any value.
 *
 * The band is wide enough for the lunge the spit drives forward on and for a
 * hoof mid-swing, and far narrower than the half tile it takes for an animal to
 * look like it is standing in front of its own tile rather than on it.
 */
const GROUND_BAND_TILES = 0.25;

const GROUNDED_ACTIONS: readonly string[] = ['idle', 'walk', 'spit'];
const VIEW_SUFFIXES: readonly string[] = ['', '_side', '_away'];

function statesOf(actions: readonly string[]): readonly string[] {
  return actions.flatMap((action) => VIEW_SUFFIXES.map((suffix) => `${action}${suffix}`));
}

function gateGroundLine(): void {
  const tileBottom = LLAMA_FIGURE.tileY + TILE_SCALE;
  const band = GROUND_BAND_TILES * TILE_SCALE;
  let framesMeasured = 0;
  for (const state of statesOf(GROUNDED_ACTIONS)) {
    const row = rowNamed(state, 'G2');
    if (row === null) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const lowest = lowestSolidRowUnclipped(state, frame);
      if (Number.isNaN(lowest)) {
        fail('G2', `${state}[${frame}] painted no solid pixel at all`);
        continue;
      }
      framesMeasured++;
      if (Math.abs(lowest - tileBottom) <= band) continue;
      fail(
        'G2',
        `${state}[${frame}] has its lowest solid pixel on row ${lowest}, ` +
          `${((lowest - tileBottom) / TILE_SCALE).toFixed(2)} tiles from the bottom of its own ` +
          `tile box at ${tileBottom} — the animal is not standing on the tile it occupies`,
      );
    }
  }
  failUnlessMeasured('G2', framesMeasured, 'planted frames');
}

// ── G3 loops close ───────────────────────────────────────────────────────────

/**
 * How much bigger the wrap from a loop's last frame to its first may be than the
 * largest step inside the loop.
 *
 * Compared against the loop's own largest step rather than against a pixel
 * count, and against the largest rather than the median because these cycles are
 * sinusoidal and their steps are bimodal by nature.
 *
 * The six shipped loops seam at 0.79 to 0.95 of their own widest step, so this
 * clears the art by a fifth. What it cannot see whatever it is set to is a row
 * running more than one cycle: over-running raises the ordinary steps by the same
 * factor as the seam, so the ratio barely moves. The phase check below is what
 * holds the cycle count.
 */
const LOOP_WRAP_TOLERANCE = 1.15;

/**
 * How small the wrap may be relative to the loop's *median* step.
 *
 * The other half of the same defect, and the half a ceiling alone cannot see:
 * sampling at `frame / (frameCount - 1)` instead of `frame / frameCount` makes
 * the last frame identical to the first, so the wrap goes to nothing while the
 * cycle spends a whole frame of its budget standing still.
 *
 * Measured against the median step rather than the narrowest one. A row may
 * legitimately hold two adjacent frames at the same coverage — a sibling figure
 * seen end-on has exactly that — and a narrowest step of zero collapses this
 * floor into `wrap >= 0`, which is true of every row there is. The six shipped
 * loops wrap between 1.04 and 1.61 of their own median step.
 */
const MIN_LOOP_WRAP_SHARE = 0.6;

/**
 * The float epsilon a loop row's sampled phases are held to.
 *
 * Every shipped row samples exact rationals, so this guards against binary
 * rounding rather than allowing the choreography any slack.
 */
const LOOP_PHASE_EPSILON = 1e-9;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * The failures for a loop row that does not sample exactly one turn of its cycle
 * in evenly spaced steps.
 *
 * This is the half of loop closure no pixel measurement can reach. A row whose
 * phase mapping runs a cycle and a half still seams cleanly by every ratio above,
 * because over-running scales the seam and the ordinary steps together — measured
 * on the shipped llama the worst seam sits at 0.95 of the widest step and at 1.11
 * with the mapping running 1.5 turns, which no threshold can separate from the
 * art. The cycle count only exists in the phase the choreography samples at,
 * which every loop pose carries as its `time`.
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

function loopRows(): readonly RowSpec[] {
  return LLAMA_ROWS.filter((row) => row.kind === 'loop');
}

function gateLoopClosure(): void {
  let loopsMeasured = 0;
  for (const row of loopRows()) {
    if (row.frameCount < 2) {
      fail('G3', `${row.name} declares ${row.frameCount} frames, which cannot be a loop`);
      continue;
    }
    loopsMeasured++;
    for (const failure of loopPhaseFailures(
      row.name,
      row.frameCount,
      (frame) => row.pose(frame).time,
    )) {
      fail('G3', failure);
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
        'G3',
        `${row.name} jumps ${wrap} px of coverage from its last frame back to its first, ` +
          `against a widest in-cycle step of ${widestStep} — the loop does not close`,
      );
      continue;
    }
    if (wrap >= typicalStep * MIN_LOOP_WRAP_SHARE) continue;
    fail(
      'G3',
      `${row.name} moves only ${wrap} px of coverage from its last frame back to its first, ` +
        `against a median in-cycle step of ${typicalStep} — the row ends on a repeat of ` +
        'the frame it starts on and spends a frame of the cycle held still',
    );
  }
  failUnlessMeasured('G3', loopsMeasured, 'looping rows');
}

// ── G4 nothing is frozen, and the spit has a whip ────────────────────────────

/**
 * The share of a frame's own ink that must change between two adjacent frames of
 * a loop.
 *
 * Animation over the frame budget aliases: an oscillation sampled at or past its
 * own frequency comes out as a freeze or a strobe, and neither is visible in the
 * code that produced it. A loop with a pair of near-identical frames is that
 * failure caught in pixels.
 */
const MIN_LOOP_STEP_SHARE = 0.03;

/**
 * The share of a one-shot's ink its widest step must reach.
 *
 * The attack is mostly gather and recovery, so its *smallest* step is
 * legitimately tiny; what must exist is somewhere the picture changes. Measured
 * on the widest step for that reason, and derived from the art rather than
 * copied: the profile row moves 57% of the animal's ink at its loudest, but
 * head-on there is no forward reach to show and the same beat moves 14%, so the
 * limit sits under the head-on rows. A row that has aliased into a hold scores
 * near zero. What this cannot see is a spit that still gathers but no longer
 * whips, because the gather alone clears the bar — the neck-reversal half of G5
 * is what catches that.
 */
const MIN_SHOT_PEAK_SHARE = 0.1;

function gateMotion(): void {
  let rowsMeasured = 0;
  for (const row of LLAMA_ROWS) {
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
        'G4',
        `${row.name} has two adjacent frames differing by only ${(share * 100).toFixed(1)}% of ` +
          `its ink, under the ${MIN_LOOP_STEP_SHARE * 100}% a moving animal shows — the cycle ` +
          'has aliased into a hold',
      );
      continue;
    }
    const share = widestStep / reference;
    if (share >= MIN_SHOT_PEAK_SHARE) continue;
    fail(
      'G4',
      `${row.name} never moves more than ${(share * 100).toFixed(1)}% of its ink between ` +
        `frames, under the ${MIN_SHOT_PEAK_SHARE * 100}% the neck's forward whip shows — there ` +
        'is no thrust in the spit',
    );
  }
  failUnlessMeasured('G4', rowsMeasured, 'animation rows');
}

// ── G5 the spit reads as a spit ──────────────────────────────────────────────

/**
 * How far open the jaw must be on the release frame.
 *
 * The jaw's opening and closing windows are hand-tuned in the choreography while
 * the release fraction is shared with `src/creatures/Llama.ts`, so the two can
 * drift apart with every other gate green: the row still animates, the ball
 * still flies, and the llama simply fires with its mouth shut. This is the one
 * gate that holds them together.
 */
const MIN_RELEASE_JAW = 0.5;

/**
 * How far the neck must reel back and how far it must whip forward, in radians
 * of profile lean.
 *
 * The reversal *is* the attack: the neck rocks back into a deep S on the gather
 * and is thrown forward and almost straight on the thrust. A spit whose thrust
 * stopped driving still animates — the gather alone moves a sixth of the
 * animal's ink — so no pixel gate can see the difference, and the profile lean
 * running only one way is the shape of it. The shipped row reels 0.49 rad back
 * and whips 0.35 rad forward; both limits sit under those and far above the
 * nothing a stalled thrust or a stalled gather leaves behind.
 */
const MIN_SPIT_REEL_BACK = 0.25;
const MIN_SPIT_WHIP_FORWARD = 0.2;

function gateSpitReadsAsASpit(): void {
  let rowsMeasured = 0;
  for (const name of statesOf(['spit'])) {
    const row = rowNamed(name, 'G5');
    if (row === null) continue;
    rowsMeasured++;
    // The frame whose own sampling point sits nearest the shared release
    // fraction, which is the cell the runtime shows as the ball leaves.
    let releaseFrame = 0;
    let closest = Infinity;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const at = (frame + 0.5) / row.frameCount;
      const gap = Math.abs(at - LLAMA_SPIT_RELEASE_PROGRESS);
      if (gap >= closest) continue;
      closest = gap;
      releaseFrame = frame;
    }
    const { jaw } = row.pose(releaseFrame);
    if (jaw >= MIN_RELEASE_JAW) continue;
    fail(
      'G5',
      `${name}[${releaseFrame}] is the frame the ball leaves on (release progress ` +
        `${LLAMA_SPIT_RELEASE_PROGRESS} of ${row.frameCount} frames) but the jaw is only ` +
        `${jaw.toFixed(2)} open, under the ${MIN_RELEASE_JAW} it takes to read as a mouth — ` +
        'the llama fires with its mouth shut',
    );
  }
  failUnlessMeasured('G5', rowsMeasured, 'spit rows');

  const profile = rowNamed('spit_side', 'G5');
  if (profile === null) return;
  let furthestBack = 0;
  let furthestForward = 0;
  for (let frame = 0; frame < profile.frameCount; frame++) {
    const { neckLean } = profile.pose(frame);
    furthestBack = Math.max(furthestBack, -neckLean);
    furthestForward = Math.max(furthestForward, neckLean);
  }
  if (furthestBack < MIN_SPIT_REEL_BACK) {
    fail(
      'G5',
      `spit_side never reels its neck further back than ${furthestBack.toFixed(3)} rad ` +
        `(minimum ${MIN_SPIT_REEL_BACK}) — there is no gather to whip out of`,
    );
  }
  if (furthestForward < MIN_SPIT_WHIP_FORWARD) {
    fail(
      'G5',
      `spit_side never whips its neck further forward than ${furthestForward.toFixed(3)} rad ` +
        `(minimum ${MIN_SPIT_WHIP_FORWARD}) — the ball leaves a neck that never moved`,
    );
  }
}

// ── G6 the gait is a pace ────────────────────────────────────────────────────

/**
 * How closely the fore and hind hoof on one side must agree about their lift.
 *
 * Llamas — like every camelid — *pace*: the fore and hind leg on the same side
 * swing together rather than diagonally as a horse or a rat trots. It is the
 * single most identifiable thing about how the animal moves, and diagonalising
 * the phases turns it back into a generic quadruped without changing a
 * silhouette enough for any pixel gate to notice.
 */
const PACE_SAME_SIDE_TOLERANCE = 0.02;
/** How far apart the two sides must be at the loudest frame of the cycle. */
const PACE_OPPOSITE_SIDE_MINIMUM = 0.3;

function gatePace(): void {
  let framesMeasured = 0;
  let widestSideSplit = 0;
  const row = rowNamed('walk_side', 'G6');
  if (row !== null) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = row.pose(frame);
      framesMeasured++;
      for (const [side, front, hind] of [
        ['left', pose.frontL, pose.hindL],
        ['right', pose.frontR, pose.hindR],
      ] as const) {
        const gap = Math.abs(front.lift - hind.lift);
        if (gap <= PACE_SAME_SIDE_TOLERANCE) continue;
        fail(
          'G6',
          `walk_side[${frame}]'s ${side} fore and hind hooves lift ${gap.toFixed(3)} apart ` +
            `(tolerance ${PACE_SAME_SIDE_TOLERANCE}) — a camelid paces, and this pair no longer ` +
            'swings together',
        );
      }
      widestSideSplit = Math.max(widestSideSplit, Math.abs(pose.frontL.lift - pose.frontR.lift));
    }
    if (widestSideSplit < PACE_OPPOSITE_SIDE_MINIMUM) {
      fail(
        'G6',
        `walk_side's two sides never lift more than ${widestSideSplit.toFixed(3)} apart ` +
          `(minimum ${PACE_OPPOSITE_SIDE_MINIMUM}) — both pairs are swinging at once, which is a ` +
          'bound rather than a pace',
      );
    }
  }
  failUnlessMeasured('G6', framesMeasured, 'walk frames');
}

// ── G7 the pieces are told apart ─────────────────────────────────────────────

/**
 * How much of the smaller piece's ink two severed pieces must differ by.
 *
 * The exit criterion for the set is naming all eight from the in-game strip, and
 * two pieces that cover the same pixels cannot be named apart at 32 px whatever
 * their colouring. The number is measured off the shipped set rather than copied
 * from another creature's: the llama's closest pair — the ribcage and the flat
 * sheet of fleece, two slabs of nearly the same outline — sit 36% apart, so what
 * this can honestly prove is that no two pieces are the *same* shape, which is
 * what a duplicated entry in the piece list looks like and scores at zero.
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

// ── G8 the pieces can spin, and do not pay for the whole cell ────────────────

/**
 * How much bigger than the animation rows need the gore may make every cell.
 *
 * The bake this figure replaces refused to write a sheet whose gore pieces
 * inflated every cell past this, because one long piece quietly widens all nine
 * animation rows to suit itself. The cell is frozen now, so the same rule is
 * expressed the other way round: the declared cell has to stay within this much
 * of what the animation rows themselves ask for.
 */
const GORE_AREA_INFLATION_LIMIT = 2;
/** Clear pixels the bake kept between the furthest ink and the frame edge. */
const FRAME_PADDING = 6;

/**
 * G8 — a gore piece sweeps its cell's *inscribed* circle when
 * `BodyPartGoreSystem` spins it, so a cell wide enough but not tall enough still
 * shears the piece halfway through its tumble — a defect that only shows in
 * play, on one frame out of a spin. The second half of the gate is the cost the
 * old bake policed: cells sized for the pieces rather than for the animal.
 */
function gateGoreClearance(): void {
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

  // What the animation rows alone would have asked for, measured the way the
  // bake measured it: the widest reach from the pose origin, plus its padding.
  let poseFramesMeasured = 0;
  let halfWidth = 0;
  let up = 0;
  let down = 0;
  const originX = frameWidth / 2;
  const originY = LLAMA_FIGURE.tileY + TILE_SCALE / 2;
  for (const row of LLAMA_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const box = inkBox(cellAlpha(row.name, frame));
      if (box === null) {
        fail('G8', `${row.name}[${frame}] painted nothing to measure`);
        continue;
      }
      poseFramesMeasured++;
      halfWidth = Math.max(halfWidth, originX - box.minX, box.maxX - originX);
      up = Math.max(up, originY - box.minY);
      down = Math.max(down, box.maxY - originY);
    }
  }
  failUnlessMeasured('G8', poseFramesMeasured, 'animation frames');
  if (poseFramesMeasured === 0) return;
  const animationArea = (halfWidth + FRAME_PADDING) * 2 * (up + down + FRAME_PADDING * 2);
  const inflation = (frameWidth * frameHeight) / animationArea;
  console.log(
    `  G8 cell cost: the ${frameWidth}×${frameHeight} cell is ${inflation.toFixed(2)}x the area ` +
      `the animation rows alone need (limit ${GORE_AREA_INFLATION_LIMIT}x)`,
  );
  if (inflation <= GORE_AREA_INFLATION_LIMIT) return;
  fail(
    'G8',
    `every cell is ${inflation.toFixed(2)}x the area the animation rows need, past the ` +
      `${GORE_AREA_INFLATION_LIMIT}x limit — the gore pieces are being paid for on all ` +
      `${LLAMA_ROWS.length} animation rows`,
  );
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
  const pieces = llamaGorePieces();
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
 * bytes rather than the sum of every state — and it has to stay well inside the
 * cache's own per-figure ceiling, because a room's worth of llamas shares these
 * rows while a floor's worth of packs shares the global one.
 */
const ROW_BUDGET_MEGABYTES = 3;

/**
 * G10 — the widest state's warm bytes, reported whether or not it passes.
 *
 * Measured over every state the figure declares rather than over the pose rows
 * alone: the cache does not know a gore piece from a walk cycle, and a gore
 * state that grew frames would otherwise be memory nothing accounts for.
 */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of LLAMA_FIGURE.states) {
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
 * spawns its pieces by name, and the prewarm helpers name whole rows. Every one
 * of those paths answers a name the figure does not declare by returning without
 * drawing anything and saying nothing: a whole facing of the animal, or a body
 * part, simply never appears.
 *
 * The names are imported from the runtime module rather than scraped out of its
 * source, so a rename cannot make this gate quietly stop matching.
 */
function gateRuntimeStateNames(): void {
  const tables: ReadonlyArray<readonly [readonly string[], string]> = [
    [LLAMA_STATES, "llamaSprite's LLAMA_STATES"],
    [LLAMA_PREWARMED_STATES, "llamaSprite's LLAMA_PREWARMED_STATES"],
    [LLAMA_SPIT_STATES, "llamaSprite's LLAMA_SPIT_STATES"],
    [LLAMA_GORE_PARTS, "llamaSprite's LLAMA_GORE_PARTS"],
  ];
  for (const [names, purpose] of tables) {
    for (const failure of missingStateFailures(LLAMA_FIGURE, names, purpose)) fail('G11', failure);
  }
  // The other direction: a row the figure paints that no runtime name can reach
  // is art nobody ever sees, and it costs a cell in every accounting.
  const reachable = new Set([...LLAMA_STATES, ...LLAMA_GORE_PARTS]);
  let rowsMeasured = 0;
  for (const row of LLAMA_ROWS) {
    rowsMeasured++;
    if (reachable.has(row.name)) continue;
    fail('G11', `the figure paints "${row.name}", which no runtime state name can reach`);
  }
  failUnlessMeasured('G11', rowsMeasured, 'painted rows');
}

/** Runs every gate and returns one message per failure. */
export function llamaGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateGroundLine();
  gateLoopClosure();
  gateMotion();
  gateSpitReadsAsASpit();
  gatePace();
  gateGoreDistinctness();
  gateGoreClearance();
  gateGoreRecentre();
  gateWarmRowSize();
  gateRuntimeStateNames();
  return [...failures];
}
