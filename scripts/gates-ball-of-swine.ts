/**
 * The Ball of Swine's art gates.
 *
 * The creature has no baked sheet any more, so every invariant the old bake gate
 * enforced against sheet pixels is enforced here against cells painted from
 * `BALL_OF_SWINE_FIGURE` — baked exactly the way the runtime cache bakes them,
 * supersampled and downsampled, so what is measured is what the game blits.
 *
 * Several gates exist specifically to catch the ways the *previous* art failed —
 * a ball that was a third of the size its frame paid for, and a maroon sphere
 * with none of the pink flesh, tusks or evening wear the creature is described
 * by. Those are measurable, so they are measured.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong, each with the number it measured and the limit it
 * measured against. A gate that cannot find the state it names fails loudly, and
 * so does one whose filtered loop examined nothing.
 *
 * Run by the review harness: `npm run render:ball-of-swine`.
 */

import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures as sharedDistinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import {
  BALL_OF_SWINE_FIGURE,
  BALL_OF_SWINE_ROWS,
  TILE_SCALE,
  type RowSpec,
} from '../src/sprites/art/ballOfSwineFigure.js';
import { BALL_RADIUS, BODY_REACH, LOBE_BOX_DRIFT } from '../src/sprites/art/ballOfSwineArt.js';
import { ARENA_PLATE_LIGHT } from '../src/map/tiles/specialFloorTiles.js';

const INK_ALPHA_THRESHOLD = 24;
const OPAQUE_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const MAX_ALPHA = 255;

const FRAME_SIZE = BALL_OF_SWINE_FIGURE.frameWidth;
const ANCHOR = BALL_OF_SWINE_FIGURE.tileX;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates here narrow before they measure — rotated states only, loops only,
 * overlays only — and a narrowing that matches nothing leaves a green gate that
 * examined nothing. Every filtering loop below counts what it looked at and ends
 * with a call to this.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const rgbaByCell = new Map<string, Uint8ClampedArray>();

/** One cell's RGBA, baked as the runtime cache bakes it. */
function cellRgba(state: string, frame: number): Uint8ClampedArray {
  const key = `${state}[${frame}]`;
  const cached = rgbaByCell.get(key);
  if (cached !== undefined) return cached;
  const canvas = bakeFigureCell(BALL_OF_SWINE_FIGURE, state, frame);
  const { data } = canvas.getContext('2d').getImageData(0, 0, FRAME_SIZE, FRAME_SIZE);
  rgbaByCell.set(key, data);
  return data;
}

function cellAlpha(state: string, frame: number): Uint8ClampedArray {
  const rgba = cellRgba(state, frame);
  const alpha = new Uint8ClampedArray(FRAME_SIZE * FRAME_SIZE);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * CHANNELS + ALPHA_OFFSET];
  return alpha;
}

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function pixelAt(rgba: Uint8ClampedArray, x: number, y: number): Rgba {
  const index = (y * FRAME_SIZE + x) * CHANNELS;
  return { r: rgba[index], g: rgba[index + 1], b: rgba[index + 2], a: rgba[index + 3] };
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

const EMPTY_INK: InkStats = {
  count: 0,
  centroidX: 0,
  centroidY: 0,
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
};

/**
 * Ink statistics over a cell, optionally cropped to a disc about its centre.
 *
 * The crop is how the gates separate the *body* from what the body throws off
 * itself: a slam's spray and a burst's debris legitimately fly clear of the
 * ball, and a measurement that counted them would report the body as off-centre
 * or as the wrong size. Because the crop is itself centred on the anchor, a
 * genuinely off-centre body still shows up as off-centre inside it.
 */
function inkStatsOf(
  alpha: Uint8ClampedArray,
  threshold = INK_ALPHA_THRESHOLD,
  cropRadius = Infinity,
): InkStats {
  const centre = FRAME_SIZE / 2;
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < FRAME_SIZE; y++) {
    for (let x = 0; x < FRAME_SIZE; x++) {
      if (alpha[y * FRAME_SIZE + x] < threshold) continue;
      if (Math.hypot(x + 0.5 - centre, y + 0.5 - centre) > cropRadius) continue;
      count++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) return EMPTY_INK;
  return { count, centroidX: sumX / count, centroidY: sumY / count, minX, maxX, minY, maxY };
}

/**
 * How far from the centre a pixel still counts as the ball rather than as spray.
 *
 * Read off the art module's own `BODY_REACH` declaration, which is the other
 * half of the same contract: the painters keep every thrown droplet outside it,
 * so anything inside is body.
 */
const BODY_RADIUS_PX = BODY_REACH * TILE_SCALE;

function bodyStatsOf(state: string, frame: number): InkStats {
  return inkStatsOf(cellAlpha(state, frame), INK_ALPHA_THRESHOLD, BODY_RADIUS_PX);
}

/**
 * Fraction of a body's mass the robust span trims off each end.
 *
 * The plain ink box is decided by its single outermost pixel, so one droplet of
 * slam spray or one tusk tip moves it several pixels and reports a perfectly
 * centred body as lopsided. Trimming a fiftieth of the mass off each side gives
 * a span that tracks where the body *is* while still moving the moment the body
 * itself does.
 */
const SPAN_TRIM = 0.02;

interface Span {
  readonly low: number;
  readonly high: number;
}

const EMPTY_SPAN: Span = { low: 0, high: 0 };

/**
 * The extent of a body along one axis, ignoring the outermost `SPAN_TRIM` of its
 * mass at each end.
 */
function robustSpan(alpha: Uint8ClampedArray, axis: 'x' | 'y', cropRadius: number): Span {
  const centre = FRAME_SIZE / 2;
  const buckets = new Float64Array(FRAME_SIZE);
  let total = 0;
  for (let y = 0; y < FRAME_SIZE; y++) {
    for (let x = 0; x < FRAME_SIZE; x++) {
      const value = alpha[y * FRAME_SIZE + x];
      if (value < INK_ALPHA_THRESHOLD) continue;
      if (Math.hypot(x + 0.5 - centre, y + 0.5 - centre) > cropRadius) continue;
      buckets[axis === 'x' ? x : y] += value;
      total += value;
    }
  }
  if (total === 0) return EMPTY_SPAN;

  const trim = total * SPAN_TRIM;
  let running = 0;
  let low = 0;
  for (let i = 0; i < FRAME_SIZE; i++) {
    running += buckets[i];
    if (running >= trim) {
      low = i;
      break;
    }
  }
  running = 0;
  let high = FRAME_SIZE - 1;
  for (let i = FRAME_SIZE - 1; i >= 0; i--) {
    running += buckets[i];
    if (running >= trim) {
      high = i;
      break;
    }
  }
  return { low, high };
}

/**
 * Total alpha in a cell.
 *
 * The measure for "how much creature is left", as against a pixel count: a body
 * coming apart spreads over *more* pixels while becoming less substantial, so a
 * count would report a dissolving corpse as growing.
 */
function alphaMassOf(alpha: Uint8ClampedArray): number {
  let mass = 0;
  for (const value of alpha) mass += value;
  return mass / MAX_ALPHA;
}

function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] >= INK_ALPHA_THRESHOLD !== b[i] >= INK_ALPHA_THRESHOLD) differing++;
  }
  return differing;
}

/** Mean channel value of a `#rrggbb` string, on the same 0–255 scale as a pixel. */
function hexLightness(hex: string): number {
  const RADIX = 16;
  const CHANNELS_IN_HEX = 3;
  let total = 0;
  for (let channel = 0; channel < CHANNELS_IN_HEX; channel++) {
    total += parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), RADIX);
  }
  return total / CHANNELS_IN_HEX;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function cellsOf(row: RowSpec): Uint8ClampedArray[] {
  return Array.from({ length: row.frameCount }, (_unused, frame) => cellAlpha(row.name, frame));
}

/**
 * The state a gate names, or null after recording a failure.
 *
 * Every one of these names is a string literal written here rather than read out
 * of the row table, so renaming a state would otherwise turn its gate into a
 * silent no-op: present, green, and measuring nothing.
 */
function rowOf(name: string): RowSpec | null {
  const row = BALL_OF_SWINE_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail('G0', `no state named "${name}" — a gate is guarding a state that no longer exists`);
    return null;
  }
  return row;
}

// ── Gates ────────────────────────────────────────────────────────────────────

/**
 * G1 — the shared structural gates: every declared frame paints something,
 * nothing paints against the cell edge, and the cell is not far larger than the
 * widest thing painted into it.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(BALL_OF_SWINE_FIGURE)) fail('G1', failure);
}

/**
 * How far a rotated frame's body mass may sit from the cell centre, in pixels.
 *
 * The tightest gate on the figure and the one that matters most: the runtime
 * rotates the ball about the anchor, which is the cell centre. Mass centred
 * anywhere else makes the ball orbit a point off its own axis, and the wobble
 * grows with the offset.
 *
 * Measured on the alpha centroid rather than on the ink box, because the box is
 * decided by whichever tusk happens to stick out furthest this frame while the
 * centroid tracks where the body actually is — and it is the body's apparent
 * centre that a viewer sees wobble. The box gets its own, looser limit below.
 */
const MAX_CENTROID_DRIFT_PX = 3;

/**
 * How far the body's robust span may sit off centre on a rotated frame.
 *
 * Derived from the lobe depth the art module declares rather than picked: the
 * silhouette's ripple is a deliberate asymmetry, so the limit has to be whatever
 * that ripple can produce. Tightened past this it would forbid the rippling the
 * creature is described by; loosened it would stop catching a genuinely
 * off-centre bake.
 */
const MAX_SPAN_DRIFT_PX = LOBE_BOX_DRIFT * TILE_SCALE;

/** G2 — the rotated states are concentric on the cell centre, because that is the pivot. */
function gateConcentric(): void {
  let framesMeasured = 0;
  for (const row of BALL_OF_SWINE_ROWS) {
    if (!row.rotated) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const stats = bodyStatsOf(row.name, frame);
      if (stats.count === 0) continue;
      framesMeasured++;
      const centroidDrift = Math.hypot(stats.centroidX - ANCHOR, stats.centroidY - ANCHOR);
      if (centroidDrift > MAX_CENTROID_DRIFT_PX) {
        fail(
          'G2',
          `${row.name}[${frame}]'s body mass is ${centroidDrift.toFixed(1)}px off the cell ` +
            `centre (limit ${MAX_CENTROID_DRIFT_PX}px); a rotated draw pivots on the anchor, so ` +
            `this wobbles`,
        );
      }
      const alpha = cellAlpha(row.name, frame);
      const across = robustSpan(alpha, 'x', BODY_RADIUS_PX);
      const down = robustSpan(alpha, 'y', BODY_RADIUS_PX);
      const spanDrift = Math.hypot(
        (across.low + across.high + 1) / 2 - ANCHOR,
        (down.low + down.high + 1) / 2 - ANCHOR,
      );
      if (spanDrift > MAX_SPAN_DRIFT_PX) {
        fail(
          'G2',
          `${row.name}[${frame}]'s body spans ${across.low}..${across.high} × ` +
            `${down.low}..${down.high}, ${spanDrift.toFixed(1)}px off the cell centre — more than ` +
            `the declared lobe depth can account for (limit ${MAX_SPAN_DRIFT_PX.toFixed(1)}px)`,
        );
      }
    }
  }
  failUnlessMeasured('G2', framesMeasured, 'rotated frames');
}

/**
 * The most a closing loop's seam may exceed the row's own largest ordinary step.
 *
 * A cycle that closes makes the wrap from last frame to first just another step
 * of the same cycle, so the largest step inside the row is the only scale that
 * describes it. Measured with the ink threshold this module uses, the shipped
 * roll wraps at 0.759 of its largest in-cycle step and the wallow at 0.949. 1.15
 * is that plus 21%, which is all a deterministic painter needs.
 *
 * It is an art-drift check and nothing more: it cannot see how many turns a row
 * covers, because over-running the cycle raises the ordinary steps faster than
 * it raises the seam. `CYCLE_CLOSE_TOLERANCE_PX` below is what holds the cycle
 * count.
 *
 * The disjunct this replaces allowed the seam up to 2.1× the row's *median* step
 * instead, and could not fail: the wallow wraps at 2.135× its own median as
 * shipped, so a cycle sampled over 1.5 turns still sat comfortably under it.
 * Against this limit that same mis-sampling puts the roll at 1.210, and a cycle
 * stopping short at 0.7 of a turn puts it at 1.648.
 */
const LOOP_SEAM_CEILING = 1.15;
/**
 * How far the frame *after* a loop's last one may differ from its first, in
 * pixels. Zero: the shipped art closes exactly, so anything at all is a defect.
 *
 * This is the clause that carries the cycle count, and it exists because the
 * seam ratios cannot: over-running a cycle raises the ordinary steps faster than
 * it raises the seam, so a row sampled over 1.5 turns measures a *cleaner* wrap
 * than the shipped art does and no ceiling value separates them. Asking the
 * painter for one frame past the row's end is what settles it instead — the
 * painter takes a frame index, so the frame the row would play next if it kept
 * counting must paint the identical cell. That holds exactly when the phase the
 * row covers is a whole number of turns, which is what makes it a loop; it
 * holds for the two-turn idle bobs as well as the single-turn walks, and it
 * fails on both a cycle running 1.5 turns and one sampled over `frameCount - 1`
 * so its last frame repeats its first.
 *
 * Deliberately weaker than "the pose function is periodic in the frame count":
 * several rows drive a channel at half the row's own frequency — a `sin` of half
 * the cycle angle — so the poses only agree again at the whole turn, which is
 * the only place the row ever wraps.
 */
const CYCLE_CLOSE_TOLERANCE_PX = 0;
/**
 * The fewest frames a loop may spend on one turn of its own cycle.
 *
 * The closure check above pins the row to a *whole* number of turns but says
 * nothing about how many, so doubling every row's phase — `(frame * 2) /
 * frameCount` — still closes and slips through it, through both seam ratios and
 * through the continuity gate. What it actually does is halve the sampling rate,
 * which is the Nyquist failure a frame count is chosen to avoid.
 *
 * Deliberately *not* the sibling form of this check, "no interior frame may
 * reproduce frame 0". That is false of this art: measured over the loop rows
 * here, the head-on and profile idles reproduce frame 0 exactly at frame 4 of 8
 * and Donut's dance at frame 6 of 12, because those rows run two whole turns of
 * their oscillation each. Turn *count* is not the invariant; frames per turn is.
 * Shipped, the first exact repeat lands at 4, 6, 8, 12 or 16 frames, so 4 is the
 * floor the art already sits on, and it is an integer structural quantity rather
 * than a measured one — a row divides its cycle evenly or it does not, and
 * nothing can drift 4 into 3. Under a doubled phase every one of those halves,
 * and the rows sitting at 4 fall to 2.
 */
const MIN_FRAMES_PER_CYCLE_TURN = 4;
/**
 * The least a closing loop's seam may be, against the row's median step.
 *
 * A row sampled at `frame / (frameCount - 1)` instead of `frame / frameCount`
 * paints a last frame identical to its first: the cycle then spends a whole
 * frame held still, the seam goes to exactly zero, and every ceiling-only seam
 * gate stays green on it. The denominator is the median rather than the
 * narrowest step because two adjacent frames can legitimately be byte-identical,
 * which would collapse the floor into `seam >= 0`. The shipped roll wraps at
 * 0.895 of its median step and the wallow at 2.135, so 0.5 is far below either
 * and still fires the moment a seam collapses.
 */
const LOOP_SEAM_FLOOR = 0.5;

/** G3 — a loop must close: not a pop across its seam, and not a held frame. */
function gateLoopClosure(): void {
  let loopsMeasured = 0;
  for (const row of BALL_OF_SWINE_ROWS) {
    if (row.kind !== 'loop') continue;
    loopsMeasured++;
    const cells = cellsOf(row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    if (typical === 0) {
      fail('G3', `${row.name}'s frames are all identical, so its seam measures nothing`);
      continue;
    }
    const largestStep = Math.max(...steps);
    const ceiling = largestStep * LOOP_SEAM_CEILING;
    if (seam > ceiling) {
      fail(
        'G3',
        `${row.name} pops across its loop seam: last→first differs by ${seam}px against a ` +
          `largest in-cycle step of ${largestStep}px (ceiling ${ceiling.toFixed(0)}px) — the ` +
          'cycle does not end where it began',
      );
    }
    const floor = typical * LOOP_SEAM_FLOOR;
    if (seam < floor) {
      fail(
        'G3',
        `${row.name} barely moves across its loop seam: last→first differs by ${seam}px against ` +
          `a median step of ${typical}px (floor ${floor.toFixed(0)}px) — the row holds still for ` +
          'a frame at the wrap, which is what sampling the cycle over frameCount-1 does',
      );
    }

    const closure = frameDelta(cells[0], cellAlpha(row.name, row.frameCount));
    if (closure > CYCLE_CLOSE_TOLERANCE_PX) {
      fail(
        'G3',
        `${row.name} does not close: the frame after its last one paints ${closure}px unlike ` +
          `${row.name}[0] (tolerance ${CYCLE_CLOSE_TOLERANCE_PX}px), so the phase this row ` +
          'covers is not a whole number of turns and the wrap is a jump',
      );
    }

    const framesPerTurn = cells.findIndex(
      (cell, frame) => frame > 0 && frameDelta(cells[0], cell) === 0,
    );
    if (framesPerTurn >= 0 && framesPerTurn < MIN_FRAMES_PER_CYCLE_TURN) {
      fail(
        'G3',
        `${row.name} is back on its first pose by frame ${framesPerTurn}, so it spends ` +
          `${framesPerTurn} frames on a turn of its cycle (floor ${MIN_FRAMES_PER_CYCLE_TURN}) — ` +
          'the row is sampled below its own rate and will strobe rather than animate',
      );
    }
  }
  // Selected by `kind` rather than by name, so a renamed `RowKind` would
  // otherwise leave this gate green having measured nothing at all.
  failUnlessMeasured('G3', loopsMeasured, 'looping states');
}

/**
 * Fraction of the ball's radius the surface-travel sample is taken inside.
 *
 * Well inside the rim, because the rim is a louder neighbour than the subject.
 * The silhouette's lobe ripple turns with the roll phase too, and measured on the
 * ink mask it alone accounts for almost all the frame-to-frame change: a ball
 * whose member sphere, seams, bristles and sheen were every one of them frozen at
 * a fixed longitude — a surface that does not roll at all, which is exactly the
 * defect this gate names — still moved 3.1% of the ink mask per step against a
 * shipped 3.4%, and the ink-mask form of this gate passed it.
 */
const SURFACE_SAMPLE_RADIUS = 0.85;
/** Channel-sum difference at which a pixel counts as having been repainted. */
const SURFACE_TONE_STEP = 24;
/**
 * Least of the inner disc a roll frame must repaint against its neighbour.
 *
 * That disc is solidly opaque in every frame, so nothing here can be answered by
 * the silhouette: what changes inside it is the surface itself, which is what
 * "the ball is rolling" means. Shipped, adjacent frames repaint 65–79% of it;
 * the frozen-surface ball above repaints at most 3.6%, so this floor separates
 * them by a factor of two and a half in either direction.
 */
const MIN_ROLL_SURFACE_TRAVEL = 0.25;

/** G4 — the roll state's surface has to actually travel. */
function gateRollTravels(): void {
  const row = rowOf('roll');
  if (row === null) return;
  const sampleRadius = BALL_RADIUS * SURFACE_SAMPLE_RADIUS * TILE_SCALE;
  const inDisc: number[] = [];
  for (let y = 0; y < FRAME_SIZE; y++) {
    for (let x = 0; x < FRAME_SIZE; x++) {
      if (Math.hypot(x + 0.5 - ANCHOR, y + 0.5 - ANCHOR) > sampleRadius) continue;
      inDisc.push((y * FRAME_SIZE + x) * CHANNELS);
    }
  }
  failUnlessMeasured('G4', inDisc.length, 'inner-disc pixels');
  if (inDisc.length === 0) return;

  const cells = Array.from({ length: row.frameCount }, (_unused, frame) =>
    cellRgba(row.name, frame),
  );
  let stepsMeasured = 0;
  for (let i = 0; i < cells.length; i++) {
    const next = (i + 1) % cells.length;
    const here = cells[i];
    const there = cells[next];
    let repainted = 0;
    for (const index of inDisc) {
      const difference =
        Math.abs(here[index] - there[index]) +
        Math.abs(here[index + 1] - there[index + 1]) +
        Math.abs(here[index + 2] - there[index + 2]);
      if (difference > SURFACE_TONE_STEP) repainted++;
    }
    stepsMeasured++;
    const fraction = repainted / inDisc.length;
    if (fraction < MIN_ROLL_SURFACE_TRAVEL) {
      fail(
        'G4',
        `roll[${i}]→[${next}] repaints ${(fraction * 100).toFixed(2)}% of the ball's inner disc ` +
          `(floor ${(MIN_ROLL_SURFACE_TRAVEL * 100).toFixed(0)}%); the surface is not rolling, ` +
          'whatever the silhouette is doing',
      );
    }
  }
  failUnlessMeasured('G4', stepsMeasured, 'roll steps');
}

/**
 * How much the rolling silhouette's width may vary across the row, as a fraction
 * of its own mean. The ball is rigid: a silhouette that grows and shrinks as it
 * turns reads as breathing, and at speed as a strobe.
 */
const MAX_ROLL_SPAN_VARIANCE = 0.09;

/** G5 — a rigid ball keeps its size while it turns. */
function gateRollSilhouetteIsRigid(): void {
  const row = rowOf('roll');
  if (row === null) return;
  const spans: number[] = [];
  for (let frame = 0; frame < row.frameCount; frame++) {
    const stats = bodyStatsOf(row.name, frame);
    if (stats.count === 0) continue;
    spans.push(Math.max(stats.maxX - stats.minX, stats.maxY - stats.minY));
  }
  failUnlessMeasured('G5', spans.length, 'roll silhouettes');
  if (spans.length === 0) return;
  const mean = spans.reduce((sum, span) => sum + span, 0) / spans.length;
  const spread = (Math.max(...spans) - Math.min(...spans)) / mean;
  if (spread > MAX_ROLL_SPAN_VARIANCE) {
    fail(
      'G5',
      `the rolling silhouette varies ${(spread * 100).toFixed(1)}% in width across the row ` +
        `(limit ${(MAX_ROLL_SPAN_VARIANCE * 100).toFixed(0)}%); a rigid ball does not breathe`,
    );
  }
}

/**
 * How far the painted ball may be from the diameter the art module declares.
 *
 * `BALL_RADIUS` is not decoration: the fight's contact radius, the arena's clear
 * lines and the creature's whole "almost fifteen feet" read are all priced
 * against it. The art the *previous* sheet baked filled about a third of its
 * frame, and nothing measured that.
 *
 * Measured on the shipped art the roll paints 185px across against a declared
 * 179px — 3% out, because the tusks and the outermost members break the outline
 * past the hide. 6% is that doubled, and it is as loose as the gate can be and
 * still speak: at the inherited 10% a fifth of the body could go missing before
 * anything said so.
 */
const MAX_DIAMETER_ERROR = 0.06;

/**
 * G6 — the painted ball is the size its own declared radius says it is.
 *
 * It cannot catch a wrong `BALL_RADIUS`, and does not claim to: the painters
 * scale every stroke by that constant and the body crop is derived from it too,
 * so changing it moves both sides of this comparison together and the gate stays
 * green. What it catches is the art drifting off the radius it is drawn from —
 * a silhouette, a stretch or a member ring that stopped agreeing with the number
 * the fight is priced against.
 */
function gateDeclaredSize(): void {
  const row = rowOf('roll');
  if (row === null) return;
  const expected = BALL_RADIUS * 2 * TILE_SCALE;
  const spans: number[] = [];
  for (let frame = 0; frame < row.frameCount; frame++) {
    const stats = bodyStatsOf(row.name, frame);
    if (stats.count === 0) continue;
    // The mean of the two axes: tusks break the outline on whichever side they
    // happen to be, and judging the diameter off the wider axis alone would read
    // a spur as growth of the body.
    spans.push((stats.maxX - stats.minX + stats.maxY - stats.minY) / 2);
  }
  failUnlessMeasured('G6', spans.length, 'roll frames');
  if (spans.length === 0) return;
  const measured = spans.reduce((sum, span) => sum + span, 0) / spans.length;
  const error = Math.abs(measured - expected) / expected;
  if (error > MAX_DIAMETER_ERROR) {
    fail(
      'G6',
      `the ball paints ${measured.toFixed(0)}px across against a declared ${expected.toFixed(0)}px ` +
        `(${(error * 100).toFixed(0)}% off, limit ${(MAX_DIAMETER_ERROR * 100).toFixed(0)}%)`,
    );
  }
}

/** Least of its own cell the widest frame of any state must span. */
const MIN_INK_SPAN = 0.6;

/** G7 — the cell envelope has to be justified by the art inside it. */
function gateInkSpan(): void {
  let widest = 0;
  let framesMeasured = 0;
  for (const row of BALL_OF_SWINE_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const stats = inkStatsOf(cellAlpha(row.name, frame));
      if (stats.count === 0) continue;
      framesMeasured++;
      widest = Math.max(
        widest,
        (stats.maxX - stats.minX) / FRAME_SIZE,
        (stats.maxY - stats.minY) / FRAME_SIZE,
      );
    }
  }
  failUnlessMeasured('G7', framesMeasured, 'painted frames');
  if (framesMeasured === 0) return;
  if (widest < MIN_INK_SPAN) {
    fail(
      'G7',
      `no frame spans more than ${(widest * 100).toFixed(0)}% of its cell (floor ` +
        `${(MIN_INK_SPAN * 100).toFixed(0)}%); shrink the envelope rather than paying for empty ` +
        `pixels`,
    );
  }
}

const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/**
 * The hard ceiling for one warm animation state.
 *
 * The sheet this figure replaced had a whole-texture budget. A painted figure is
 * admitted to the cache a state at a time, so what decides whether it fits is
 * the widest state's warm bytes rather than the sum of every state — and it has
 * to stay well inside the cache's own per-figure ceiling so that a second state
 * can be warm alongside it. These are the largest cells in the fleet, and the
 * twelve-frame roll is the fleet's largest single row, which is what sets this
 * number: it is the measured row plus room to grow, and it still leaves the
 * per-figure ceiling holding six of them.
 */
const STATE_BUDGET_MEGABYTES = 4.2;

/** G8 — the widest warm state's memory, reported whether or not it passes. */
function gateWarmRowSize(): void {
  const cellBytes = FRAME_SIZE * FRAME_SIZE * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of BALL_OF_SWINE_FIGURE.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured('G8', statesMeasured, 'declared states');
  if (statesMeasured === 0) return;

  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarmMegabytes = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  G8 warm row: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${STATE_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once would be ` +
      `${allWarmMegabytes.toFixed(2)} MB`,
  );
  if (megabytes > STATE_BUDGET_MEGABYTES) {
    fail(
      'G8',
      `${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${STATE_BUDGET_MEGABYTES} MB`,
    );
  }
}

/**
 * Least the wallowing body must be wider than tall.
 *
 * The vulnerable window is the only moment the crawler can trade damage, so it
 * has to be legible across the arena from the silhouette alone — not from the
 * health bar and not from a colour change.
 */
const MIN_WALLOW_SPREAD = 1.25;

/** G10 — the wallow is a different shape from the roll, not a recoloured one. */
function gateWallowIsDistinct(): void {
  const wallow = rowOf('wallow');
  const roll = rowOf('roll');
  if (wallow === null || roll === null) return;

  const rollStats = bodyStatsOf(roll.name, 0);
  const rollSpan = rollStats.maxX - rollStats.minX;

  let framesMeasured = 0;
  for (let frame = 0; frame < wallow.frameCount; frame++) {
    const stats = bodyStatsOf(wallow.name, frame);
    if (stats.count === 0) continue;
    framesMeasured++;
    const ratio = (stats.maxX - stats.minX) / Math.max(1, stats.maxY - stats.minY);
    if (ratio < MIN_WALLOW_SPREAD) {
      fail(
        'G10',
        `wallow[${frame}] is only ${ratio.toFixed(2)}× wider than tall (floor ` +
          `${MIN_WALLOW_SPREAD}); the vulnerable state has to read from the silhouette`,
      );
    }
    if (stats.maxX - stats.minX <= rollSpan) {
      fail(
        'G10',
        `wallow[${frame}] spans ${stats.maxX - stats.minX}px against the roll's ${rollSpan}px; ` +
          `a collapsed mass spreads sideways`,
      );
    }
  }
  failUnlessMeasured('G10', framesMeasured, 'wallow frames');
}

/** Least the slam's hardest frame must be compressed along the impact axis. */
const MIN_SLAM_CRUSH = 1.15;

/** G11 — the slam actually compresses, which is the whole content of the state. */
function gateSlamCrushes(): void {
  const row = rowOf('slam');
  if (row === null) return;
  let bestRatio = 0;
  let framesMeasured = 0;
  for (let frame = 0; frame < row.frameCount; frame++) {
    const stats = bodyStatsOf(row.name, frame);
    if (stats.count === 0) continue;
    framesMeasured++;
    // Taller than wide: the art is authored with the wall lying to +X and the
    // runtime rotates it to the impact normal.
    bestRatio = Math.max(
      bestRatio,
      (stats.maxY - stats.minY) / Math.max(1, stats.maxX - stats.minX),
    );
  }
  failUnlessMeasured('G11', framesMeasured, 'slam frames');
  if (framesMeasured === 0) return;
  if (bestRatio < MIN_SLAM_CRUSH) {
    fail(
      'G11',
      `the slam never gets taller than ${bestRatio.toFixed(2)}× its width (floor ` +
        `${MIN_SLAM_CRUSH}); nothing in the state reads as an impact`,
    );
  }
}

/**
 * Least the burst's widest frame must spread its mass vertically, against the
 * frame it opened on.
 *
 * Measured as the alpha-weighted spread of the ink about its own mean row rather
 * than as the ink box's height, because the box is decided by the debris. The
 * thrown heads, hooves and cloth fly outward on a clock of their own, so a burst
 * whose two halves never move apart at all still ends 26px taller than it
 * started, and a height comparison cannot see it — it did not, when it was one.
 * The debris is about a twentieth of the painted mass, so a mass-weighted spread
 * is the halves and almost nothing else. Shipped, the spread peaks at 1.33× the
 * first frame's; with the halves' separation term removed it peaks at 1.00×.
 */
const MIN_BURST_SPREAD_GROWTH = 1.15;

/** Alpha-weighted spread of a cell's ink about its own mean row, in pixels. */
function verticalSpreadOf(alpha: Uint8ClampedArray): number {
  let total = 0;
  let sumY = 0;
  for (let y = 0; y < FRAME_SIZE; y++) {
    for (let x = 0; x < FRAME_SIZE; x++) {
      const value = alpha[y * FRAME_SIZE + x];
      if (value < INK_ALPHA_THRESHOLD) continue;
      total += value;
      sumY += value * y;
    }
  }
  if (total === 0) return 0;
  const meanY = sumY / total;
  let variance = 0;
  for (let y = 0; y < FRAME_SIZE; y++) {
    for (let x = 0; x < FRAME_SIZE; x++) {
      const value = alpha[y * FRAME_SIZE + x];
      if (value < INK_ALPHA_THRESHOLD) continue;
      variance += value * (y - meanY) ** 2;
    }
  }
  return Math.sqrt(variance / total);
}

/** G12 — the burst opens up and thins out, rather than looping in place. */
function gateBurstComesApart(): void {
  const row = rowOf('burst');
  if (row === null) return;
  const firstCell = cellAlpha(row.name, 0);
  const lastCell = cellAlpha(row.name, row.frameCount - 1);
  const first = inkStatsOf(firstCell);
  const last = inkStatsOf(lastCell);
  if (first.count === 0 || last.count === 0) {
    fail('G12', 'the burst has an empty first or last frame, so nothing could be compared');
    return;
  }
  const openingSpread = verticalSpreadOf(firstCell);
  let widestSpread = 0;
  let framesMeasured = 0;
  for (let frame = 0; frame < row.frameCount; frame++) {
    framesMeasured++;
    widestSpread = Math.max(widestSpread, verticalSpreadOf(cellAlpha(row.name, frame)));
  }
  failUnlessMeasured('G12', framesMeasured, 'burst frames');
  if (openingSpread === 0) {
    fail('G12', 'the burst opens on a frame with no mass to spread, so nothing could be compared');
  } else {
    const growth = widestSpread / openingSpread;
    if (growth < MIN_BURST_SPREAD_GROWTH) {
      fail(
        'G12',
        `the burst's mass never spreads further than ${growth.toFixed(2)}× the ` +
          `${openingSpread.toFixed(0)}px it opened with (floor ${MIN_BURST_SPREAD_GROWTH}×); the ` +
          'halves are not separating',
      );
    }
  }
  const firstMass = alphaMassOf(firstCell);
  const lastMass = alphaMassOf(lastCell);
  if (lastMass >= firstMass) {
    fail(
      'G12',
      `the burst ends with ${lastMass.toFixed(0)} of opaque mass against ${firstMass.toFixed(0)} ` +
        `at the start; the body should be thinning out as it comes apart`,
    );
  }
}

/**
 * Most of an overlay cell that may be fully opaque.
 *
 * `shade` and `shadow` are composited over and under a rolling frame. An opaque
 * overlay does not tint the ball, it replaces it.
 */
const MAX_OVERLAY_OPAQUE_FRACTION = 0.02;

/** G13 — the overlay states are overlays. */
function gateOverlaysAreTranslucent(): void {
  let framesMeasured = 0;
  for (const row of BALL_OF_SWINE_ROWS) {
    if (row.kind !== 'overlay') continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      framesMeasured++;
      const opaque = inkStatsOf(cellAlpha(row.name, frame), OPAQUE_ALPHA_THRESHOLD).count;
      const fraction = opaque / (FRAME_SIZE * FRAME_SIZE);
      if (fraction > MAX_OVERLAY_OPAQUE_FRACTION) {
        fail(
          'G13',
          `${row.name}[${frame}] is ${(fraction * 100).toFixed(1)}% fully opaque (limit ` +
            `${(MAX_OVERLAY_OPAQUE_FRACTION * 100).toFixed(0)}%); it would replace the ball, not ` +
            `light it`,
        );
      }
    }
  }
  // Same reason as G3: selected by `kind`, so it has to say when nothing matched.
  failUnlessMeasured('G13', framesMeasured, 'overlay frames');
}

/**
 * G14 — the shade state carries a direction, and the shadow state sits
 * underneath.
 *
 * The whole reason the lighting is a separate state is that it must not turn
 * with the ball. If it stopped being directional there would be no reason for
 * the state to exist, and if the shadow drifted off the bottom it would read as
 * a bruise instead of as ground contact.
 */
function gateShadeIsDirectional(): void {
  const shade = rowOf('shade');
  const shadow = rowOf('shadow');
  const half = Math.floor(FRAME_SIZE / 2);

  if (shade !== null) {
    let litSum = 0;
    let litCount = 0;
    let darkSum = 0;
    let darkCount = 0;
    const rgba = cellRgba(shade.name, 0);
    for (let y = 0; y < FRAME_SIZE; y++) {
      for (let x = 0; x < FRAME_SIZE; x++) {
        const pixel = pixelAt(rgba, x, y);
        if (pixel.a < INK_ALPHA_THRESHOLD) continue;
        // Weighted by alpha: a bright pixel laid on at 10% is a tenth of a bright
        // pixel, and the two halves are compared on what they do to the flesh
        // underneath rather than on the colours they were mixed from.
        const luminance = ((pixel.r + pixel.g + pixel.b) / 3) * (pixel.a / MAX_ALPHA);
        if (x < half && y < half) {
          litSum += luminance;
          litCount++;
        } else if (x >= half && y >= half) {
          darkSum += luminance;
          darkCount++;
        }
      }
    }
    if (litCount === 0 || darkCount === 0) {
      fail('G14', 'the shade state does not cover both the lit and the shadowed quadrant');
    } else {
      const lit = litSum / litCount;
      const dark = darkSum / darkCount;
      if (lit <= dark) {
        fail(
          'G14',
          `the shade state's lit quadrant averages ${lit.toFixed(1)} against ${dark.toFixed(1)} ` +
            `in the shadowed one; it carries no direction, so it does not need to be its own state`,
        );
      }
    }
  }

  if (shadow !== null) {
    const stats = inkStatsOf(cellAlpha(shadow.name, 0));
    if (stats.count === 0) {
      fail('G14', 'the ground shadow paints nothing at all');
    } else if (stats.centroidY <= ANCHOR) {
      fail(
        'G14',
        `the ground shadow's centre sits at y=${stats.centroidY.toFixed(0)}, at or above the ` +
          `ball's own centre (${ANCHOR}); it is not on the ground`,
      );
    }
  }
}

/**
 * Least the flesh may average, on a 0–255 lightness scale.
 *
 * Judged over the ball's inner disc rather than the whole silhouette: outlines,
 * eyes, hooves and black cloth are all *meant* to be dark, and averaging them in
 * with the hide measures how much detail the creature has rather than what
 * colour its skin is.
 */
const MIN_PINK_LIGHTNESS = 110;
/** Fraction of the radius the flesh sample is taken inside, away from the rim falloff. */
const FLESH_SAMPLE_RADIUS = 0.55;
/**
 * Least the whole silhouette may average, as a multiple of the arena floor.
 *
 * The other half of the same problem: a creature at the same value as the ground
 * it rolls on is a smudge at 32px however well drawn it is, and the arena's
 * grating is very dark.
 */
const MIN_FLOOR_CONTRAST = 2.2;
/**
 * Lightness of the arena floor the ball is seen against, read off the tile
 * renderer rather than copied. It was copied once, and the floor was then
 * rewritten in the same change — leaving the gate demanding contrast against a
 * colour the game had stopped drawing.
 */
const ARENA_FLOOR_LIGHTNESS = hexLightness(ARENA_PLATE_LIGHT);
/**
 * Least bone-bright pixels the roll row must hold.
 *
 * Derived from the art with the tusks taken off it rather than picked: bone is
 * not the only bright thing on the creature, so the floor has to sit above what
 * the rest of it supplies on its own. Stripping every tusk from the faces and the
 * snouts leaves 36 (the teeth, which are bone too and are meant to be); the
 * shipped art holds 150.
 */
const MIN_TUSK_PIXELS = 90;
const MIN_SEQUIN_PIXELS = 24;
/**
 * Least shirt-linen pixels the roll row must hold, after eroding the mask.
 *
 * Shipped 73 against 0 for a tuxedo scrap whose shirt front went dark. Both
 * numbers are far below the raw count because of the erosion below.
 */
const MIN_LINEN_PIXELS = 30;
/**
 * Bone: bright, barely saturated, and *warm* — the last of those is what keeps
 * this measuring tusks. Without it the test also passes for the shirt linen and
 * for every white eye-spark on the ball, which between them held the count at 991
 * with every tusk on the creature deleted.
 */
const TUSK_MIN_DARKEST = 178;
const TUSK_MAX_SPREAD = 46;
const TUSK_MIN_WARMTH = 25;
const TUSK_MAX_LIGHTEST = 250;
/**
 * Linen: brighter still, and neutral rather than warm, which separates a shirt
 * from a tusk highlight. Pure white is excluded for the same reason the warmth
 * bound exists — an eye's specular dot is white, and the eyes alone kept this
 * clause green through a shirt front painted the colour of the jacket.
 */
const LINEN_MIN_BLUE = 200;
const LINEN_MIN_GREEN = 200;
const LINEN_MAX_SPREAD = 26;
const LINEN_MAX_WARMTH = 16;
/** Sequins: saturated red well above the hide's own dusty pink. */
const SEQUIN_MIN_RED = 190;
const SEQUIN_RED_OVER_GREEN = 95;
const SEQUIN_RED_OVER_BLUE = 80;

/**
 * G15 — the creature the source describes is actually painted.
 *
 * Three specific claims from the description, each measurable, each a way the
 * art this replaced failed:
 *
 *  - "rippling **pink** flesh" — the old sphere was maroon, and dark enough to
 *    disappear against the arena's steel floor.
 *  - "**tusks**" — bone, so much lighter than anything else on the body.
 *  - "scraps of tuxedos and **red sequin dresses**" — the sequins are the only
 *    saturated highlight on the creature, and the linen the only real value
 *    contrast in the black cloth. Without them the scraps read as holes.
 */
function gateDescribedCreature(): void {
  const row = rowOf('roll');
  if (row === null) return;
  const fleshRadius = BALL_RADIUS * FLESH_SAMPLE_RADIUS * TILE_SCALE;

  let bodyCount = 0;
  let bodySum = 0;
  let fleshCount = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let tuskPixels = 0;
  let sequinPixels = 0;
  let linenPixels = 0;

  for (let frame = 0; frame < row.frameCount; frame++) {
    const rgba = cellRgba(row.name, frame);
    const linenMask = new Uint8Array(FRAME_SIZE * FRAME_SIZE);
    for (let y = 0; y < FRAME_SIZE; y++) {
      for (let x = 0; x < FRAME_SIZE; x++) {
        const pixel = pixelAt(rgba, x, y);
        if (pixel.a < OPAQUE_ALPHA_THRESHOLD) continue;
        bodyCount++;
        bodySum += (pixel.r + pixel.g + pixel.b) / 3;
        if (Math.hypot(x - ANCHOR, y - ANCHOR) <= fleshRadius) {
          fleshCount++;
          sumR += pixel.r;
          sumG += pixel.g;
          sumB += pixel.b;
        }
        const lightest = Math.max(pixel.r, pixel.g, pixel.b);
        const darkest = Math.min(pixel.r, pixel.g, pixel.b);
        const warmth = pixel.r - pixel.b;
        if (
          darkest > TUSK_MIN_DARKEST &&
          lightest - darkest < TUSK_MAX_SPREAD &&
          warmth >= TUSK_MIN_WARMTH &&
          lightest < TUSK_MAX_LIGHTEST
        ) {
          tuskPixels++;
        }
        if (
          pixel.b > LINEN_MIN_BLUE &&
          pixel.g > LINEN_MIN_GREEN &&
          lightest - darkest < LINEN_MAX_SPREAD &&
          warmth <= LINEN_MAX_WARMTH
        ) {
          linenMask[y * FRAME_SIZE + x] = 1;
        }
        if (
          pixel.r > SEQUIN_MIN_RED &&
          pixel.r - pixel.g > SEQUIN_RED_OVER_GREEN &&
          pixel.r - pixel.b > SEQUIN_RED_OVER_BLUE
        ) {
          sequinPixels++;
        }
      }
    }
    // Only the interior of a linen patch counts. The colour test alone is passed
    // by the antialiased fringe of every white eye-spark on the ball, which is a
    // ring one pixel wide and never has a linen neighbour on all four sides.
    for (let y = 1; y < FRAME_SIZE - 1; y++) {
      for (let x = 1; x < FRAME_SIZE - 1; x++) {
        const index = y * FRAME_SIZE + x;
        if (linenMask[index] === 0) continue;
        const surrounded =
          linenMask[index - 1] === 1 &&
          linenMask[index + 1] === 1 &&
          linenMask[index - FRAME_SIZE] === 1 &&
          linenMask[index + FRAME_SIZE] === 1;
        if (surrounded) linenPixels++;
      }
    }
  }

  failUnlessMeasured('G15', bodyCount, 'opaque body pixels');
  failUnlessMeasured('G15', fleshCount, 'flesh-sample pixels');
  if (fleshCount === 0 || bodyCount === 0) return;

  const meanR = sumR / fleshCount;
  const meanG = sumG / fleshCount;
  const meanB = sumB / fleshCount;
  const lightness = (meanR + meanG + meanB) / 3;
  if (lightness < MIN_PINK_LIGHTNESS) {
    fail(
      'G15',
      `the flesh averages a lightness of ${lightness.toFixed(0)} (floor ${MIN_PINK_LIGHTNESS}); ` +
        `"rippling pink flesh" cannot be this dark`,
    );
  }
  if (meanR <= meanG || meanR <= meanB) {
    fail(
      'G15',
      `the flesh averages rgb(${meanR.toFixed(0)}, ${meanG.toFixed(0)}, ${meanB.toFixed(0)}), ` +
        `which is not pink`,
    );
  }
  const contrast = bodySum / bodyCount / ARENA_FLOOR_LIGHTNESS;
  if (contrast < MIN_FLOOR_CONTRAST) {
    fail(
      'G15',
      `the whole body averages only ${contrast.toFixed(2)}× the arena floor's lightness (floor ` +
        `${MIN_FLOOR_CONTRAST}×); at 32px it reads as a smudge on the grating`,
    );
  }
  if (tuskPixels < MIN_TUSK_PIXELS) {
    fail(
      'G15',
      `only ${tuskPixels} bone-bright pixels across the roll state (floor ${MIN_TUSK_PIXELS}); ` +
        `the tusks are gone`,
    );
  }
  if (sequinPixels < MIN_SEQUIN_PIXELS) {
    fail(
      'G15',
      `only ${sequinPixels} saturated-red pixels across the roll state (floor ` +
        `${MIN_SEQUIN_PIXELS}); the sequin dresses have stopped reading as clothing`,
    );
  }
  if (linenPixels < MIN_LINEN_PIXELS) {
    fail(
      'G15',
      `only ${linenPixels} dress-linen pixels across the roll state (floor ${MIN_LINEN_PIXELS}); ` +
        `the tuxedo scraps have stopped reading as clothing`,
    );
  }
}

/**
 * G16 — every state name the runtime can ask for is one the figure paints.
 *
 * The draw path returns silently on an unknown state, so a pose the fight enters
 * and the figure lacks is an invisible five-tile boss and no log line. The three
 * lists below are the three places a name reaches the figure from: the pose
 * union the fight maps its phases onto, the two overlay layers the wrapper draws
 * around the body, and the prewarm calls the fight makes ahead of each of them.
 */
const RUNTIME_POSES: readonly string[] = ['roll', 'wallow', 'spinup', 'slam', 'burst'];
const RUNTIME_OVERLAYS: readonly string[] = ['shade', 'shadow'];
const RUNTIME_PREWARMED: readonly string[] = [
  'roll',
  'shadow',
  'shade',
  'spinup',
  'slam',
  'wallow',
  'burst',
];

function gateRuntimeStateNames(): void {
  const named: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['the fight’s pose union', RUNTIME_POSES],
    ['the wrapper’s overlay layers', RUNTIME_OVERLAYS],
    ['the fight’s prewarm calls', RUNTIME_PREWARMED],
  ];
  let listsMeasured = 0;
  for (const [purpose, names] of named) {
    listsMeasured++;
    for (const failure of missingStateFailures(BALL_OF_SWINE_FIGURE, names, purpose)) {
      fail('G16', failure);
    }
  }
  failUnlessMeasured('G16', listsMeasured, 'runtime name tables');
}

/**
 * G17 — a row paints as many pictures as it declares frames.
 *
 * A row whose every term rides one hump retraces its own path either side of the
 * peak, so it can declare four frames and paint two while loop closure, the
 * crush check and the ink-span check all stay green: those measure how far the
 * shape *moves*, and a shape that comes back the way it went moves exactly as
 * much on the way out as on the way in. The slam shipped that way, because its
 * spray flew out on the compression and was pulled home again with it.
 */
function gateDistinctFrames(): void {
  const report = sharedDistinctFrameFailures(BALL_OF_SWINE_FIGURE, cellRgba, { subject: 'shape' });
  for (const message of report.failures) fail('G17', message);
  failUnlessMeasured('G17', report.framesMeasured, 'painted frames');
  if (report.closestNote !== null) console.log(`  G17 closest frames: ${report.closestNote}`);
}

/** Runs every gate and returns one message per failure. */
export function ballOfSwineGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateConcentric();
  gateLoopClosure();
  gateRollTravels();
  gateRollSilhouetteIsRigid();
  gateDeclaredSize();
  gateInkSpan();
  gateWarmRowSize();
  gateWallowIsDistinct();
  gateSlamCrushes();
  gateBurstComesApart();
  gateOverlaysAreTranslucent();
  gateShadeIsDirectional();
  gateDescribedCreature();
  gateRuntimeStateNames();
  gateDistinctFrames();
  return [...failures];
}
