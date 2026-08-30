/**
 * The Brindle Grub family's art gates, covering both instars.
 *
 * Neither has a baked sheet to inspect any more, so every invariant the old bake
 * enforced by throwing before it wrote a PNG is enforced here instead, against
 * cells painted from `BRINDLE_GRUB_FIGURE` and `COW_TAILED_GRUB_FIGURE` exactly
 * the way the runtime cache bakes them — supersampled and downsampled — so what
 * is measured is what the game blits.
 *
 * Both builds are gated, not just the one that fights: they are drawn by one
 * engine at two scales, and a change that only breaks the larva is exactly the
 * change nobody looks for.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing.
 *
 * Run by the review harness: `npm run render:grub`.
 */

import { createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { asGameContext } from './nodeGameContext.js';
import { SEGMENT_COUNT, TAIL_LENGTH, restGrubPose } from '../src/sprites/art/grubArt.js';
import {
  GRUB_VARIANTS,
  TILE_SCALE,
  grubFigureOf,
  type GrubVariant,
  type RowSpec,
} from '../src/sprites/art/grubFigure.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { grubReachableStates } from '../src/sprites/brindleGrubSprite.js';

const INK_ALPHA_THRESHOLD = 24;
/**
 * Alpha above which a pixel is the animal itself rather than the soft contact
 * shadow it paints on the ground line. A ground gate measured against ordinary
 * ink measures the shadow, which lands where the underside ought to be whether
 * or not it is there — and stays green while the figure floats.
 */
const SOLID_ALPHA_THRESHOLD = 200;
/** Clear pixels kept around the cell when measuring where the animal lies. */
const GROUND_MEASURE_PAD = 64;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — looping rows only, one pair per
 * row, the build that has a bite — and a narrowing that matches nothing leaves a
 * green gate that examined nothing. Every filtering loop here counts what it
 * looked at and ends with a call to this.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const alphaByCell = new Map<string, Uint8ClampedArray>();

/** One cell's alpha channel, baked as the runtime cache bakes it. */
function cellAlpha(def: FigureDef, state: string, frame: number): Uint8ClampedArray {
  const key = `${def.id}:${state}[${frame}]`;
  const cached = alphaByCell.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(def, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, def.frameWidth, def.frameHeight);
  const alpha = new Uint8ClampedArray(def.frameWidth * def.frameHeight);
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

/**
 * A frame's ink box, measured on a canvas padded well past the cell on every
 * side.
 *
 * Padded because the declared cell clears the widest pose by only a handful of
 * pixels: measured inside it, art that has outgrown or slipped off its cell is
 * clipped away before it can be measured, and every gate downstream could only
 * ever report what the clipping gate had already caught. The padding is taken
 * back out of the returned box, so the answer is in cell coordinates.
 */
function unclippedInkBox(
  def: FigureDef,
  state: string,
  frame: number,
  threshold: number,
): Box | null {
  const canvas = createCanvas(
    def.frameWidth + GROUND_MEASURE_PAD * 2,
    def.frameHeight + GROUND_MEASURE_PAD * 2,
  );
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(GROUND_MEASURE_PAD, GROUND_MEASURE_PAD);
  def.paintFrame(asGameContext(ctx), state, frame);
  ctx.restore();
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] < threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return {
    minX: minX - GROUND_MEASURE_PAD,
    minY: minY - GROUND_MEASURE_PAD,
    maxX: maxX - GROUND_MEASURE_PAD,
    maxY: maxY - GROUND_MEASURE_PAD,
  };
}

function figureOf(variant: GrubVariant): FigureDef {
  return grubFigureOf(variant.id);
}

function rowNamed(variant: GrubVariant, name: string, gateId: string): RowSpec | null {
  const row = variant.rows.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(
      gateId,
      `${variant.id} has no row named "${name}" — a gate is guarding a row that no longer exists`,
    );
    return null;
  }
  return row;
}

// ── G1 structure ─────────────────────────────────────────────────────────────

/**
 * G1 — the shared structural gates: every declared state paints every declared
 * frame, nothing paints against the cell edge, and the cell is not mostly empty.
 */
function gateStructure(): void {
  for (const variant of GRUB_VARIANTS) {
    for (const failure of figureStructuralFailures(figureOf(variant))) fail('G1', failure);
  }
}

// ── G2 anatomy ───────────────────────────────────────────────────────────────

/**
 * The thresholds the anatomy is held to.
 *
 * These are the only literals in this section on purpose: the *measurements* are
 * imported from `grubArt.ts`, so shortening the tail or dropping the segment
 * creases there fails the gate. Mirroring the measurements as local constants
 * would quietly make every comparison two compile-time literals that could never
 * disagree.
 */
const MIN_SEGMENTS = 5;
const MIN_TAIL_LENGTH = 0.08;
const MIN_INSTAR_SCALE_STEP = 1.2;

/**
 * G2 — geometric truths about the anatomy, checked before a pixel is painted.
 *
 * The segment creases are the single cue that turns a smooth capsule into a
 * larva; the tail is the feature the second instar's name promises and the only
 * thing that tells the two builds apart at a glance; and the two must actually
 * differ in size or the growth the whole lifecycle is about is invisible.
 */
function gateAnatomy(): void {
  if (SEGMENT_COUNT < MIN_SEGMENTS) {
    fail(
      'G2',
      `the body carries ${SEGMENT_COUNT} segment creases; under ${MIN_SEGMENTS} it reads as a ` +
        'smooth capsule rather than as a larva',
    );
  }
  if (TAIL_LENGTH < MIN_TAIL_LENGTH) {
    fail(
      'G2',
      `the cow tail is ${TAIL_LENGTH} tiles long, under the ${MIN_TAIL_LENGTH} it takes to read ` +
        'as an appendage — the second instar is the one the name promises a tail on',
    );
  }
  let taillessBuilds = 0;
  let tailedBuilds = 0;
  for (const variant of GRUB_VARIANTS) {
    if (variant.build.hasTail) tailedBuilds++;
    else taillessBuilds++;
  }
  if (taillessBuilds === 0 || tailedBuilds === 0) {
    fail(
      'G2',
      `${tailedBuilds} of ${GRUB_VARIANTS.length} builds carry the tail — the two instars are ` +
        'told apart by exactly that, so one of each is what the family needs',
    );
  }
  const [larva, adult] = GRUB_VARIANTS;
  const step = adult.scale / larva.scale;
  if (step < MIN_INSTAR_SCALE_STEP) {
    fail(
      'G2',
      `the second instar is only ${step.toFixed(2)}x the first (minimum ` +
        `${MIN_INSTAR_SCALE_STEP}x) — the growth the lifecycle is about does not show`,
    );
  }
}

// ── G3 the animal lies on its tile ───────────────────────────────────────────

/**
 * How far a frame's lowest solid pixel may sit from the bottom edge of the
 * animal's own tile box, in tiles.
 *
 * Measured against `tileY + tileScale` — the box the runtime hangs a health bar
 * off — rather than against the ground line the painter computes. The band
 * allows the arch of the crawl and the rear-up of the bite.
 *
 * What this cannot see is a uniformly wrong `tileY`: the painter anchors its
 * pose origin on `tileY` too, so moving it slides the art and this gate's own
 * reference by the same amount and every frame still measures flush. Mutating
 * the brindle grub's `tileY` from -26 to -10 leaves this green and reddens only
 * G7, which re-derives the cell from painted ink and is the gate that owns that
 * defect. What this one catches is the art floating or sinking relative to its
 * own pose origin — a shifted `GROUND_Y`, a scale applied about the wrong pivot.
 */
const GROUND_BAND_TILES = 0.25;

function gateGroundLine(): void {
  let framesMeasured = 0;
  for (const variant of GRUB_VARIANTS) {
    const def = figureOf(variant);
    const tileBottom = def.tileY + TILE_SCALE;
    const band = GROUND_BAND_TILES * TILE_SCALE;
    for (const row of variant.rows) {
      for (let frame = 0; frame < row.frameCount; frame++) {
        const box = unclippedInkBox(def, row.name, frame, SOLID_ALPHA_THRESHOLD);
        if (box === null) {
          fail('G3', `${def.id}.${row.name}[${frame}] painted no solid pixel at all`);
          continue;
        }
        framesMeasured++;
        if (Math.abs(box.maxY - tileBottom) <= band) continue;
        fail(
          'G3',
          `${def.id}.${row.name}[${frame}] has its lowest solid pixel on row ${box.maxY}, ` +
            `${((box.maxY - tileBottom) / TILE_SCALE).toFixed(2)} tiles from the bottom of its ` +
            `own tile box at ${tileBottom} — the animal is not lying on the tile it occupies`,
        );
      }
    }
  }
  failUnlessMeasured('G3', framesMeasured, 'planted frames');
}

// ── G4 loops close ───────────────────────────────────────────────────────────

/**
 * How much bigger the wrap from a loop's last frame to its first may be than the
 * largest step inside the loop.
 *
 * Compared against the loop's own largest step rather than against a pixel
 * count, because the two builds differ in size, and against the largest rather
 * than the median because the crawl's steps are bimodal: the peristaltic hump
 * moves fast through the middle of the body and slowly at each end.
 *
 * The six shipped loops seam at 0.30 to 0.84 of their own widest step, so this
 * clears the art by a third. What it cannot see whatever it is set to is a row
 * running more than one cycle: over-running raises the ordinary steps by the
 * same factor as the seam, and on two of these rows it raises them by *more*, so
 * the ratio falls. The phase check below is what holds the cycle count.
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
 * How small the wrap may be relative to the loop's *median* step.
 *
 * The other half of the same defect, and the half a ceiling alone cannot see:
 * sampling at `frame / (frameCount - 1)` instead of `frame / frameCount` makes
 * the last frame identical to the first, so the wrap goes to nothing while the
 * cycle spends a whole frame of its budget standing still.
 *
 * Measured against the median step rather than the narrowest one, which is what
 * a sibling figure uses: seen end-on a grub is a tube, and two frames of the
 * head-on crawl legitimately coincide there — a narrowest step of zero would
 * take this floor down with it and leave the row with no closure check at all.
 * The six shipped loops wrap between 0.85 and 1.09 of their own median step.
 */
const MIN_LOOP_WRAP_SHARE = 0.5;

/**
 * The failures for a loop row that does not sample exactly one turn of its cycle
 * in evenly spaced steps.
 *
 * This is the half of loop closure no pixel measurement can reach. A row whose
 * phase mapping runs a cycle and a half still seams cleanly by every ratio above,
 * because over-running scales the seam and the ordinary steps together — measured
 * on the shipped grub the seam sits at 0.84 of the widest step and at 0.81 with
 * the mapping running 1.5 turns. The cycle count only exists in the phase the
 * choreography samples at, which every loop pose carries as its `time`.
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

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function gateLoopClosure(): void {
  let loopsMeasured = 0;
  for (const variant of GRUB_VARIANTS) {
    const def = figureOf(variant);
    for (const row of variant.rows) {
      if (row.kind !== 'loop') continue;
      if (row.frameCount < 2) {
        fail('G4', `${def.id}.${row.name} declares ${row.frameCount} frames, not a loop`);
        continue;
      }
      loopsMeasured++;
      for (const failure of loopPhaseFailures(
        `${def.id}.${row.name}`,
        row.frameCount,
        (frame) => row.pose(frame).time,
      )) {
        fail('G4', failure);
      }
      const steps: number[] = [];
      for (let frame = 1; frame < row.frameCount; frame++) {
        steps.push(
          coverageDelta(cellAlpha(def, row.name, frame - 1), cellAlpha(def, row.name, frame)),
        );
      }
      const widestStep = Math.max(...steps);
      const typicalStep = median(steps);
      const wrap = coverageDelta(
        cellAlpha(def, row.name, row.frameCount - 1),
        cellAlpha(def, row.name, 0),
      );
      if (wrap > widestStep * LOOP_WRAP_TOLERANCE) {
        fail(
          'G4',
          `${def.id}.${row.name} jumps ${wrap} px of coverage from its last frame back to its ` +
            `first, against a widest in-cycle step of ${widestStep} — the loop does not close`,
        );
        continue;
      }
      if (wrap >= typicalStep * MIN_LOOP_WRAP_SHARE) continue;
      fail(
        'G4',
        `${def.id}.${row.name} moves only ${wrap} px of coverage from its last frame back to ` +
          `its first, against a median in-cycle step of ${typicalStep} — the row ends on a ` +
          'repeat of the frame it starts on and spends a frame of the cycle held still',
      );
    }
  }
  failUnlessMeasured('G4', loopsMeasured, 'looping rows');
}

// ── G5 nothing is frozen, and the bite has a snap ────────────────────────────

/**
 * The share of a frame's own ink that must change between two adjacent frames of
 * the *profile* crawl.
 *
 * Animation over the frame budget aliases: an oscillation sampled at or past its
 * own frequency comes out as a freeze or a strobe, and neither is visible in the
 * code that produced it. A crawl with a pair of near-identical frames is that
 * failure caught in pixels — but only edge-on, where the peristaltic wave has a
 * length of body to travel along. The two shipped profile crawls hold their
 * quietest step at 10% and 13% of their ink.
 */
const MIN_PROFILE_LOOP_STEP_SHARE = 0.05;

/**
 * The share of its ink a head-on crawl must move at its loudest.
 *
 * End-on the animal is a tube, and the wave running down it changes almost
 * nothing about the silhouette: two adjacent frames of the head-on crawl
 * legitimately coincide exactly, so no per-step floor can be set there at all.
 * What can still be asserted is that the row moves *somewhere* — a head-on crawl
 * frozen outright scores nothing, and the four shipped axial rows move between
 * 17% and 29%.
 */
const MIN_AXIAL_LOOP_PEAK_SHARE = 0.08;

/**
 * The share of the bite's ink its widest step must reach.
 *
 * A strike is mostly wind-up and recovery, so its *smallest* step is
 * legitimately tiny; what must exist is the snap. Measured on the widest step
 * for that reason.
 */
const MIN_SHOT_PEAK_SHARE = 0.1;

function gateMotion(): void {
  let rowsMeasured = 0;
  for (const variant of GRUB_VARIANTS) {
    const def = figureOf(variant);
    for (const row of variant.rows) {
      if (row.frameCount < 2) continue;
      rowsMeasured++;
      const reference = inkCount(cellAlpha(def, row.name, 0));
      let widestStep = 0;
      let narrowestStep = Infinity;
      for (let frame = 1; frame < row.frameCount; frame++) {
        const step = coverageDelta(
          cellAlpha(def, row.name, frame - 1),
          cellAlpha(def, row.name, frame),
        );
        widestStep = Math.max(widestStep, step);
        narrowestStep = Math.min(narrowestStep, step);
      }
      if (row.kind === 'loop') {
        if (row.view === 'side') {
          const share = narrowestStep / reference;
          if (share >= MIN_PROFILE_LOOP_STEP_SHARE) continue;
          fail(
            'G5',
            `${def.id}.${row.name} has two adjacent frames differing by only ` +
              `${(share * 100).toFixed(1)}% of its ink, under the ` +
              `${MIN_PROFILE_LOOP_STEP_SHARE * 100}% a crawling animal shows edge-on — the ` +
              'cycle has aliased into a hold',
          );
          continue;
        }
        const share = widestStep / reference;
        if (share >= MIN_AXIAL_LOOP_PEAK_SHARE) continue;
        fail(
          'G5',
          `${def.id}.${row.name} never moves more than ${(share * 100).toFixed(1)}% of its ink ` +
            `between frames, under the ${MIN_AXIAL_LOOP_PEAK_SHARE * 100}% a head-on crawl ` +
            'shows — the row is frozen',
        );
        continue;
      }
      const share = widestStep / reference;
      if (share >= MIN_SHOT_PEAK_SHARE) continue;
      fail(
        'G5',
        `${def.id}.${row.name} never moves more than ${(share * 100).toFixed(1)}% of its ink ` +
          `between frames, under the ${MIN_SHOT_PEAK_SHARE * 100}% a bite shows — there is no ` +
          'strike in the strike',
      );
    }
  }
  failUnlessMeasured('G5', rowsMeasured, 'animation rows');
}

// ── G6 the crawl travels along the body ──────────────────────────────────────

/**
 * How far along the body the peristaltic hump must travel over one cycle, as a
 * fraction of the body's length.
 *
 * The arch that makes a legless larva move is a wave running from tail to head,
 * not the whole animal rocking as one rigid unit. Rocking and travelling look
 * alike in any single frame and alike to every pixel gate above, because both
 * move about the same amount of ink; what separates them is where the highest
 * point of the back *is* from one frame to the next.
 */
const MIN_HUMP_TRAVEL_SHARE = 0.08;

function gateCrawlTravels(): void {
  let variantsMeasured = 0;
  for (const variant of GRUB_VARIANTS) {
    const def = figureOf(variant);
    const row = rowNamed(variant, 'walk_side', 'G6');
    if (row === null) continue;
    variantsMeasured++;
    let leftmost = Infinity;
    let rightmost = -Infinity;
    let bodyMin = Infinity;
    let bodyMax = -Infinity;
    let framesMeasured = 0;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const box = unclippedInkBox(def, row.name, frame, INK_ALPHA_THRESHOLD);
      if (box === null) {
        fail('G6', `${def.id}.walk_side[${frame}] painted nothing to measure`);
        continue;
      }
      framesMeasured++;
      bodyMin = Math.min(bodyMin, box.minX);
      bodyMax = Math.max(bodyMax, box.maxX);
      const crest = highestInkColumn(def, row.name, frame);
      leftmost = Math.min(leftmost, crest);
      rightmost = Math.max(rightmost, crest);
    }
    failUnlessMeasured('G6', framesMeasured, `${def.id} crawl frames`);
    if (framesMeasured === 0) continue;
    const travel = (rightmost - leftmost) / (bodyMax - bodyMin);
    if (travel >= MIN_HUMP_TRAVEL_SHARE) continue;
    fail(
      'G6',
      `${def.id}'s crawl moves the crest of its back over only ${(travel * 100).toFixed(1)}% of ` +
        `the body's length (minimum ${MIN_HUMP_TRAVEL_SHARE * 100}%) — the animal is rocking as ` +
        'one rigid unit rather than passing a wave along itself',
    );
  }
  failUnlessMeasured('G6', variantsMeasured, 'builds with a profile crawl');
}

/** The column the topmost ink in a profile frame sits in — the crest of the back. */
function highestInkColumn(def: FigureDef, state: string, frame: number): number {
  const alpha = cellAlpha(def, state, frame);
  for (let y = 0; y < def.frameHeight; y++) {
    let sum = 0;
    let count = 0;
    for (let x = 0; x < def.frameWidth; x++) {
      if (alpha[y * def.frameWidth + x] < INK_ALPHA_THRESHOLD) continue;
      sum += x;
      count++;
    }
    if (count > 0) return sum / count;
  }
  return Number.NaN;
}

// ── G7 the frozen cell geometry ──────────────────────────────────────────────

/**
 * The numbers the old bake used to size a cell around the art it measured.
 *
 * Held here as its own constants rather than imported, because the module that
 * used to own them is the generator this figure replaced. They are what makes
 * the check below a re-measurement rather than a restatement: the cell is
 * re-derived from painted ink and compared against the four numbers frozen in
 * the figure.
 */
const FRAME_PADDING = 6;
const FRAME_SIZE_QUANTUM = 8;

function roundUpTo(value: number, quantum: number): number {
  return Math.ceil(value / quantum) * quantum;
}

/**
 * G7 — the frozen cell still fits the art, re-derived from the painted ink.
 *
 * The cell size is the one measurement in this figure that only an offline pass
 * can take, and every other gate computes from it. Re-derived here the way the
 * bake derived it — widest reach from the pose origin, plus padding, rounded up
 * to the bake's quantum — so art that has grown or shrunk says so with a number
 * to paste rather than by being quietly clipped or by making every instance pay
 * for empty pixels.
 *
 * The height's anchor is the pose origin the painter itself derives from
 * `tileY`, so this cannot catch a uniformly wrong `tileY`; the parity run
 * against the sheet is what proved that. What it catches is the art outgrowing
 * the cell frozen around it.
 */
function gateFrozenCell(): void {
  let variantsMeasured = 0;
  for (const variant of GRUB_VARIANTS) {
    const def = figureOf(variant);
    const originX = def.frameWidth / 2;
    const originY = def.tileY + TILE_SCALE / 2;
    let halfWidth = 0;
    let up = 0;
    let down = 0;
    let framesMeasured = 0;
    for (const row of variant.rows) {
      for (let frame = 0; frame < row.frameCount; frame++) {
        const box = unclippedInkBox(def, row.name, frame, INK_ALPHA_THRESHOLD);
        if (box === null) {
          fail('G7', `${def.id}.${row.name}[${frame}] painted nothing to measure`);
          continue;
        }
        framesMeasured++;
        halfWidth = Math.max(halfWidth, originX - box.minX, box.maxX - originX);
        up = Math.max(up, originY - box.minY);
        down = Math.max(down, box.maxY - originY);
      }
    }
    failUnlessMeasured('G7', framesMeasured, `${def.id} animation frames`);
    if (framesMeasured === 0) continue;
    variantsMeasured++;
    const width = roundUpTo((halfWidth + FRAME_PADDING) * 2, FRAME_SIZE_QUANTUM);
    const topPad = Math.ceil(up + FRAME_PADDING);
    const height = roundUpTo(topPad + down + FRAME_PADDING, FRAME_SIZE_QUANTUM);
    const tileY = topPad - TILE_SCALE / 2;
    if (width === def.frameWidth && height === def.frameHeight && tileY === def.tileY) continue;
    fail(
      'G7',
      `${def.id}'s art now measures ${width}×${height} with tileY ${tileY}, but the figure ` +
        `freezes ${def.frameWidth}×${def.frameHeight} with tileY ${def.tileY} — paste the ` +
        'measured cell',
    );
  }
  failUnlessMeasured('G7', variantsMeasured, 'builds');
}

// ── G8 warm-row memory ───────────────────────────────────────────────────────

/**
 * The ceiling for one warm animation row.
 *
 * **This is a readout, not a gate.** The widest shipped row is 0.19 MB against
 * this 3 MB budget, and no art change these figures could plausibly take moves
 * it: doubling every walk row from 8 frames to 16 reaches 0.39 MB, and it takes
 * 128 frames in a walk row — sixteen times what the choreography declares — to
 * cross the budget at all. Growing the cell instead is caught by G7 long before
 * the bytes matter. Read the printed line as the number it is; do not read a
 * green G8 as evidence that anything was checked.
 *
 * The sheets these figures replaced had a whole-texture budget, because the
 * whole texture was decoded whether or not anything played. A painted figure is
 * admitted to the cache one state at a time and lets go of the states it stops
 * playing, so the number that decides whether it fits is the widest state's warm
 * bytes rather than the sum of every state — and it has to stay well inside the
 * cache's own per-figure ceiling, because level 2's on-kill rule can put five of
 * these on one corpse and they share these rows.
 */
const ROW_BUDGET_MEGABYTES = 3;

function gateWarmRowSize(): void {
  let statesMeasured = 0;
  for (const variant of GRUB_VARIANTS) {
    const def = figureOf(variant);
    const cellBytes = def.frameWidth * def.frameHeight * BYTES_PER_PIXEL;
    let widestState = '';
    let widestFrames = 0;
    let totalFrames = 0;
    for (const [state, declared] of def.states) {
      statesMeasured++;
      totalFrames += declared.frames;
      if (declared.frames <= widestFrames) continue;
      widestFrames = declared.frames;
      widestState = state;
    }
    if (widestFrames === 0) continue;
    const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
    const allWarm = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
    console.log(
      `  G8 warm row: ${def.id}.${widestState} is ${megabytes.toFixed(2)} MB of a ` +
        `${ROW_BUDGET_MEGABYTES} MB budget; all ${def.states.size} states warm at once would be ` +
        `${allWarm.toFixed(2)} MB`,
    );
    if (megabytes <= ROW_BUDGET_MEGABYTES) continue;
    fail(
      'G8',
      `${def.id}.${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
  failUnlessMeasured('G8', statesMeasured, 'declared states');
}

// ── G9 the runtime's own names ───────────────────────────────────────────────

/**
 * G9 — every state name the runtime can build is one the figure paints.
 *
 * `stateFor` composes its pose names by template literal, and both draw paths
 * answer a name the figure does not declare by returning without drawing
 * anything and saying nothing: a whole facing of the animal simply never
 * appears. The names are imported from the runtime module rather than scraped
 * out of its source, so a rename cannot make this gate quietly stop matching.
 */
function gateRuntimeStateNames(): void {
  let rowsMeasured = 0;
  for (const variant of GRUB_VARIANTS) {
    const def = figureOf(variant);
    const reachable = grubReachableStates(def);
    for (const failure of missingStateFailures(def, reachable, `grubReachableStates(${def.id})`)) {
      fail('G9', failure);
    }
    // The other direction: a row the figure paints that no runtime name can
    // reach is art nobody ever sees, and it costs a cell in every accounting.
    const names = new Set(reachable);
    for (const row of variant.rows) {
      rowsMeasured++;
      if (names.has(row.name)) continue;
      fail('G9', `${def.id} paints "${row.name}", which no runtime state name can reach`);
    }
  }
  failUnlessMeasured('G9', rowsMeasured, 'painted rows');
}

// ── G10 the idle is a rest, not a frame of the crawl ─────────────────────────

/**
 * G10 — the single-frame idle is built out of the rest pose plus a breath.
 *
 * The idle is one cell for the whole animal and the state a stopped grub holds
 * indefinitely, so it is the frame a player looks at longest — and being one
 * frame long it is the one row no motion gate above ever examines. What must
 * hold is that it is a *rest*: an idle sampled mid-crawl is a grub frozen
 * halfway through a stride, standing still with its back arched, and the picture
 * is identical to a walk frame the row will never play.
 *
 * The breath is the other half. Without it the pose is the bare rest pose, which
 * is exactly frame 0 of the crawl, and a stopped grub becomes indistinguishable
 * from one that has paused mid-step.
 */
function gateIdleIsARest(): void {
  const rest = restGrubPose();
  if (rest.crawlPhase !== 0) {
    fail('G10', `the rest pose starts mid-crawl at phase ${rest.crawlPhase}, not at rest`);
  }
  let idlesMeasured = 0;
  for (const variant of GRUB_VARIANTS) {
    const row = rowNamed(variant, 'idle', 'G10');
    if (row === null) continue;
    idlesMeasured++;
    const pose = row.pose(0);
    if (pose.crawlPhase !== rest.crawlPhase) {
      fail(
        'G10',
        `${variant.id}'s idle is sampled at crawl phase ${pose.crawlPhase} — a stopped grub is ` +
          'holding a stride rather than resting',
      );
    }
    if (pose.breathe === rest.breathe) {
      fail(
        'G10',
        `${variant.id}'s idle carries no breath of its own (${pose.breathe}), so the one frame ` +
          'a stopped grub holds is the bare rest pose the crawl also opens on',
      );
    }
  }
  failUnlessMeasured('G10', idlesMeasured, 'idle rows');
}

/** Runs every gate and returns one message per failure. */
export function grubGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateAnatomy();
  gateGroundLine();
  gateLoopClosure();
  gateMotion();
  gateCrawlTravels();
  gateFrozenCell();
  gateWarmRowSize();
  gateRuntimeStateNames();
  gateIdleIsARest();
  return [...failures];
}
