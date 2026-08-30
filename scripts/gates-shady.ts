/**
 * Shady's art gates.
 *
 * He has no baked sheet to inspect any more, so every invariant the old bake
 * enforced against sheet pixels is enforced here against cells painted from
 * `SHADY_FIGURE` — baked exactly the way the runtime cache bakes them,
 * supersampled and downsampled, so what is measured is what the game blits. The
 * elbow gate measures the rig itself and needs no pixels at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly: a lookup that quietly returns nothing turns a whole gate module
 * green while measuring nothing.
 *
 * Run by the review harness: `npm run render:shady`.
 */

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import {
  ORIGIN_X,
  ORIGIN_Y,
  SHADY_FIGURE,
  SHADY_ROWS,
  SHADY_SCALE,
  TILE_SCALE,
  type RowSpec,
} from '../src/sprites/art/shadyFigure.js';
import { buildSkeleton, cowlWindow, type ShadyPose } from '../src/sprites/art/shadyArt.js';
import {
  SHADY_DRAWN_STATES,
  SHADY_HEAD_ABOVE_TILE_TILES,
  SHADY_PREWARMED_STATES,
} from '../src/sprites/shadySprite.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Alpha above which a pixel counts as ink. */
const INK_ALPHA = 8;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

const { frameWidth, frameHeight } = SHADY_FIGURE;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — one row at a time, looping rows
 * only, frames whose elbow is actually bent — and a narrowing that matches
 * nothing leaves a green gate that examined nothing. Every filtering loop here
 * counts what it looked at and ends with a call to this.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const cellsByKey = new Map<string, Uint8ClampedArray>();

/** One cell's RGBA, baked as the runtime cache bakes it. */
function cellRgba(state: string, frame: number): Uint8ClampedArray {
  const key = `${state}[${frame}]`;
  const cached = cellsByKey.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(SHADY_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  cellsByKey.set(key, data);
  return data;
}

function alphaAt(data: Uint8ClampedArray, x: number, y: number): number {
  return data[(y * frameWidth + x) * CHANNELS + ALPHA_OFFSET];
}

/**
 * The row a gate names, or null after recording a failure.
 *
 * Every one of these names is a string literal written here rather than in
 * `SHADY_ROWS`, so renaming a row would otherwise turn its gate into a silent
 * no-op: present, green, and measuring nothing.
 */
function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = SHADY_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `no row named "${name}" — a gate is guarding a row that no longer exists`);
    return null;
  }
  return row;
}

// ── G1: structure ────────────────────────────────────────────────────────────

/**
 * G1 — the shared structural gates: every declared state paints every declared
 * frame, nothing paints against the cell edge, and the cell is not mostly
 * empty. The edge check is what the old bake's border-clip gate did; a frame
 * that paints outside its cell is clipped away silently, and nothing
 * downstream can detect it.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(SHADY_FIGURE)) fail('G1', failure);
}

// ── G2: the cowl is a void ───────────────────────────────────────────────────

/**
 * Highest channel value any pixel inside the cowl may reach.
 *
 * Deliberately far below the hood's own darkest cloth: a blind review found the
 * first bake's brightest cowl pixel was *brighter* than the hood's shadow, which
 * is exactly when the darkness stops being a void and the lit part starts
 * reading as a brow with a mouth under it.
 */
const COWL_MAX_CHANNEL = 12;

/**
 * G2 — the hood interior is solid darkness at every frame.
 *
 * Non-negotiable, and exactly the property a later palette tweak, a stray
 * highlight or a shifted brow lip could undo without anything else looking
 * wrong.
 */
function gateCowlIsVoid(): void {
  let framesMeasured = 0;
  for (const row of SHADY_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const data = cellRgba(row.name, frame);
      const window = cowlWindow(row.pose(frame));
      const cx = ORIGIN_X + window.cx * TILE_SCALE * SHADY_SCALE;
      const cy = ORIGIN_Y + window.cy * TILE_SCALE * SHADY_SCALE;
      const rx = window.rx * TILE_SCALE * SHADY_SCALE;
      const ry = window.ry * TILE_SCALE * SHADY_SCALE;
      let sampled = 0;
      let worst = 0;
      let holed = false;
      for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry); y++) {
        for (let x = Math.ceil(cx - rx); x <= Math.floor(cx + rx); x++) {
          const nx = (x - cx) / rx;
          const ny = (y - cy) / ry;
          if (nx * nx + ny * ny > 1) continue;
          if (x < 0 || y < 0 || x >= frameWidth || y >= frameHeight) continue;
          const at = (y * frameWidth + x) * CHANNELS;
          if (data[at + ALPHA_OFFSET] <= INK_ALPHA) {
            if (!holed) {
              holed = true;
              fail(
                'G2',
                `${row.name}[${frame}] has a hole in the cowl at (${x},${y}) — ` +
                  'the hood is see-through',
              );
            }
            continue;
          }
          sampled++;
          worst = Math.max(worst, data[at], data[at + 1], data[at + 2]);
        }
      }
      if (sampled === 0) {
        fail('G2', `${row.name}[${frame}] sampled no cowl pixels`);
        continue;
      }
      framesMeasured++;
      if (worst > COWL_MAX_CHANNEL) {
        fail(
          'G2',
          `${row.name}[${frame}] cowl interior reaches ${worst} against a limit of ` +
            `${COWL_MAX_CHANNEL} — a face is showing`,
        );
      }
    }
  }
  failUnlessMeasured('G2', framesMeasured, 'frames with a sampled cowl');
}

// ── G3: elbows ───────────────────────────────────────────────────────────────

/** Below this the elbow is effectively on the shoulder→wrist line and its side is noise. */
const ELBOW_BEND_EPSILON = 1e-4;

/**
 * G3 — an elbow must never invert mid-row.
 *
 * The standard bipedal gate, and the one the scratch row exists to trip: an arm
 * authored by its hand target folds through the straight-arm singularity if the
 * target crosses the shoulder, and the elbow snaps to the other side for a
 * frame. Measured as the sign of the cross product of shoulder→elbow with
 * shoulder→wrist, which is which side of the limb's own line the joint sits on.
 */
function gateElbowNeverInverts(): void {
  let bendsMeasured = 0;
  for (const row of SHADY_ROWS) {
    for (const side of ['left', 'right'] as const) {
      let established = 0;
      for (let frame = 0; frame < row.frameCount; frame++) {
        // Measured through the art module's own solver, so the gate reads the
        // geometry the painter draws rather than a re-derivation of it.
        const skeleton = buildSkeleton(row.pose(frame));
        const chain = side === 'left' ? skeleton.leftArm : skeleton.rightArm;
        const ax = chain.joint.x - chain.root.x;
        const ay = chain.joint.y - chain.root.y;
        const bx = chain.end.x - chain.root.x;
        const by = chain.end.y - chain.root.y;
        const cross = ax * by - ay * bx;
        if (Math.abs(cross) < ELBOW_BEND_EPSILON) continue;
        bendsMeasured++;
        const sign = Math.sign(cross);
        if (established === 0) {
          established = sign;
          continue;
        }
        if (sign !== established) {
          fail(
            'G3',
            `${row.name}[${frame}] ${side} elbow flipped to the other side of the arm ` +
              `(cross ${cross.toFixed(5)})`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G3', bendsMeasured, 'bent elbows');
}

// ── G4 / G5: continuity ──────────────────────────────────────────────────────

function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = ALPHA_OFFSET; i < a.length; i += CHANNELS) sum += Math.abs(a[i] - b[i]);
  return sum;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((p, q) => p - q);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function consecutiveSteps(row: RowSpec): number[] {
  const steps: number[] = [];
  for (let frame = 1; frame < row.frameCount; frame++) {
    steps.push(frameDelta(cellRgba(row.name, frame - 1), cellRgba(row.name, frame)));
  }
  return steps;
}

/**
 * The band the seam of a looping row has to land in, as a multiple of the row's
 * own steps.
 *
 * The ceiling hangs off the row's *largest* ordinary step and the floor off its
 * median, and they are different on purpose. His two loops step unevenly — a
 * breath and a jaw both slow at their turnarounds — so the median sits down
 * among the small steps and a perfectly closing seam already measures 1.17× it
 * on the idle and 1.32× on the talk; a ceiling hung off the median is therefore
 * no bound at all, which is what the 2.2× this replaces turned out to be.
 * Against the largest step the two rows close at 0.70× and 0.98×, so 1.15 is a
 * real bound.
 *
 * The floor is what catches the other way a cycle's phase mapping goes wrong.
 * Sampling at `frame / (frameCount - 1)` instead of `frame / frameCount` makes
 * the last frame identical to the first: the seam drops to exactly zero and the
 * cycle spends a whole frame held still, which a ceiling alone reads as a pass.
 * It cannot use the narrowest step — a row may legitimately hold two
 * byte-identical adjacent frames, which would collapse it into `seam >= 0` —
 * so it too is against the median, where the shipped rows sit at 1.17× and
 * 1.32× and 0.4 is comfortably clear of both.
 */
const LOOP_SEAM_CEILING = 1.15;
const LOOP_SEAM_FLOOR = 0.4;

/**
 * How far the pose one frame past the end of a loop may sit from the pose the
 * loop starts on, as a share of the row's median pose-space step.
 *
 * This is the gate on the phase mapping itself, and it is the only clause here
 * that can see how much of a turn the row actually covers. A pixel ratio cannot:
 * a cell-wide alpha difference saturates once the silhouette has moved off
 * itself, so a row rewritten to run one and a half turns measures a *smaller*
 * seam ratio on the talk (0.70×) than the shipped art does (0.98×) and reads as
 * a cleaner loop. Asking the row for the frame after its last one and requiring
 * it to be the frame it started on pins the mapping exactly: `frame /
 * frameCount` lands on phase 1, which both pose functions answer identically to
 * phase 0, while `(frame * 1.5) / frameCount` lands on phase 1.5 and
 * `frame / (frameCount - 1)` on phase `n/(n-1)`.
 *
 * A numerical tolerance rather than an equality: the shipped rows land within
 * 1e-16 of their own start, which is floating-point noise in a sine.
 *
 * What it cannot see: a row sampled over a whole number of turns greater than
 * one, because phase 2 and phase 0 are the same pose. That defect aliases rather
 * than pops.
 */
const PHASE_TURN_TOLERANCE = 1e-6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Every number a pose holds, walked rather than listed.
 *
 * A hand-written list of fields is the shape where a renamed or newly added pose
 * axis silently stops being measured and the gate goes green having looked at
 * less than it did yesterday.
 */
function poseNumbers(value: unknown, out: number[]): void {
  if (typeof value === 'number') {
    out.push(value);
    return;
  }
  if (typeof value === 'boolean') {
    out.push(value ? 1 : 0);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) poseNumbers(item, out);
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value).sort()) poseNumbers(value[key], out);
}

function poseDistance(a: ShadyPose, b: ShadyPose): number {
  const left: number[] = [];
  const right: number[] = [];
  poseNumbers(a, left);
  poseNumbers(b, right);
  if (left.length !== right.length) return Infinity;
  let total = 0;
  for (let i = 0; i < left.length; i++) total += (left[i] - right[i]) ** 2;
  return Math.sqrt(total);
}
/** A short loop has no meaningful step distribution to compare a seam against. */
const LOOP_GATE_MIN_FRAMES = 4;

/** G4 — a looping row that jumps at the seam pops once per cycle, forever. */
function gateLoopCloses(): void {
  let loopsMeasured = 0;
  for (const row of SHADY_ROWS) {
    if (!row.loops) continue;
    if (row.frameCount < LOOP_GATE_MIN_FRAMES) {
      // Dropped silently, a short loop would leave the count untouched and the
      // minimum-sample guard could never notice the row had gone.
      fail(
        'G4',
        `${row.name} loops in ${row.frameCount} frames, under the ${LOOP_GATE_MIN_FRAMES} a seam ` +
          'needs to have a step distribution to be compared against',
      );
      continue;
    }
    loopsMeasured++;
    const steps = consecutiveSteps(row);
    const typical = median(steps);
    const largest = Math.max(...steps);
    const seam = frameDelta(cellRgba(row.name, row.frameCount - 1), cellRgba(row.name, 0));
    if (largest > 0 && seam > largest * LOOP_SEAM_CEILING) {
      fail(
        'G4',
        `${row.name} loop seam is ${seam.toFixed(0)}, ${(seam / largest).toFixed(2)}× the row's ` +
          `largest ordinary step of ${largest.toFixed(0)} (ceiling ${LOOP_SEAM_CEILING}×) — it ` +
          'pops once per cycle',
      );
    }
    if (typical > 0 && seam < typical * LOOP_SEAM_FLOOR) {
      fail(
        'G4',
        `${row.name} loop seam is ${seam.toFixed(0)}, only ${(seam / typical).toFixed(2)}× the ` +
          `row's median step of ${typical.toFixed(0)} (floor ${LOOP_SEAM_FLOOR}×) — the last ` +
          'frame all but repeats the first, so the cycle holds still for a frame',
      );
    }
    const poseSteps: number[] = [];
    for (let frame = 1; frame < row.frameCount; frame++) {
      poseSteps.push(poseDistance(row.pose(frame - 1), row.pose(frame)));
    }
    const poseTypical = median(poseSteps);
    const pastTheEnd = poseDistance(row.pose(row.frameCount), row.pose(0));
    if (poseTypical > 0 && pastTheEnd > poseTypical * PHASE_TURN_TOLERANCE) {
      fail(
        'G4',
        `${row.name}: the frame after the last one is ` +
          `${(pastTheEnd / poseTypical).toExponential(2)}× a median step away from the frame the ` +
          `row starts on, so the ${row.frameCount} frames do not cover exactly one turn`,
      );
    }
    // A row covering a whole number of turns greater than one closes at the
    // wrap and steps evenly, so neither clause above can see it. What it cannot
    // hide is that it repaints its own first frame partway through. No
    // tolerance: the comparison is between two deterministic rasterisations of
    // the same cell, and a doubled cycle makes them byte-identical.
    for (let frame = 1; frame < row.frameCount; frame++) {
      if (frameDelta(cellRgba(row.name, frame), cellRgba(row.name, 0)) > 0) continue;
      fail(
        'G4',
        `${row.name}[${frame}] repaints frame 0 exactly — the row covers more than one turn of ` +
          'its cycle, so it is spending frames on a picture it has already drawn',
      );
    }
  }
  failUnlessMeasured('G4', loopsMeasured, 'looping rows long enough to have a seam');
}

/**
 * How far a one-shot's last frame may sit from the idle it hands off to,
 * measured as the total travel of both hands in tile units.
 *
 * A pixel-delta ratio against the row's own median step — what the old bake gate
 * used — cannot fail on this figure: the scratch sweeps an arm most of a tile
 * every frame, so its median step is large enough that a row ending with the
 * hand still fully raised measures 1.9x it and passes. The hands are what the
 * row moves, so the hands are what has to come back.
 */
const SETTLE_TOLERANCE_TILES = 0.02;

/** How far the hands sit from the idle's, summed over both of them. */
function handDistanceToIdle(row: RowSpec, frame: number, idle: RowSpec): number {
  const pose = row.pose(frame);
  const rest = idle.pose(0);
  return (
    Math.hypot(pose.rightHand.x - rest.rightHand.x, pose.rightHand.y - rest.rightHand.y) +
    Math.hypot(pose.leftHand.x - rest.leftHand.x, pose.leftHand.y - rest.leftHand.y)
  );
}

/** The last three frames are enough to say whether a row is easing into rest. */
const SETTLE_APPROACH_FRAMES = 3;

/**
 * G5 — a one-shot has to hand back to the pose the idle actually starts from,
 * and ease into it rather than snapping there on its final frame.
 *
 * Both halves matter. The arrival is what stops the figure jumping the instant
 * the animation ends; the convergence is what stops the whole recovery being
 * squeezed into one frame, which is a jump the arrival test alone cannot see.
 */
function gateOneShotSettles(): void {
  const idle = rowNamed('idle', 'G5');
  if (idle === null) return;
  let shotsMeasured = 0;
  let approachesMeasured = 0;
  for (const row of SHADY_ROWS) {
    if (row.loops) continue;
    if (row.frameCount < SETTLE_APPROACH_FRAMES) {
      fail('G5', `${row.name} has ${row.frameCount} frames, too few to have a recovery at all`);
      continue;
    }
    shotsMeasured++;
    const arrival = handDistanceToIdle(row, row.frameCount - 1, idle);
    if (arrival > SETTLE_TOLERANCE_TILES) {
      fail(
        'G5',
        `${row.name} ends with its hands ${arrival.toFixed(3)} tiles from the idle's, past a ` +
          `tolerance of ${SETTLE_TOLERANCE_TILES}`,
      );
    }
    for (let back = SETTLE_APPROACH_FRAMES; back >= 2; back--) {
      const further = handDistanceToIdle(row, row.frameCount - back, idle);
      const nearer = handDistanceToIdle(row, row.frameCount - back + 1, idle);
      approachesMeasured++;
      if (nearer > further) {
        fail(
          'G5',
          `${row.name} moves away from the idle over its last frames — frame ` +
            `${row.frameCount - back + 1} is ${nearer.toFixed(3)} tiles out against ` +
            `${further.toFixed(3)} the frame before`,
        );
      }
    }
  }
  failUnlessMeasured('G5', shotsMeasured, 'one-shot rows');
  failUnlessMeasured('G5', approachesMeasured, 'recovery frames');
}

// ── G6: the tile anchor ──────────────────────────────────────────────────────

/**
 * Where his soles must land inside his own tile, measured from the tile's floor.
 *
 * Against the *tile*, never against the painter's own ground line: the two are
 * built from the same ground-offset constant, so a gate comparing them moves
 * both together and passes whatever that constant is set to. The tile is frozen
 * geometry the health bar and the quest marker are hung off, which is what makes
 * it an independent thing to measure against.
 */
const SOLES_ABOVE_TILE_FLOOR_MIN_PX = 2;
const SOLES_ABOVE_TILE_FLOOR_MAX_PX = 12;
/** He fidgets sideways, so his centre of ink is not pinned to the tile centre. */
const ANCHOR_CENTRE_TOLERANCE_PX = 6;

interface InkExtent {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly pixels: number;
}

function inkExtentOf(state: string, frame: number): InkExtent {
  const data = cellRgba(state, frame);
  let top = frameHeight;
  let bottom = -1;
  let left = frameWidth;
  let right = -1;
  let pixels = 0;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      if (alphaAt(data, x, y) <= INK_ALPHA) continue;
      pixels++;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  return { top, bottom, left, right, pixels };
}

/**
 * G6 — a redraw moves the tile anchor, and the health bar and quest marker key
 * off it. Measured rather than trusted, against the tile the figure declares.
 */
function gateAnchor(): void {
  const tileFloor = SHADY_FIGURE.tileY + TILE_SCALE;
  const tileCentreX = SHADY_FIGURE.tileX + TILE_SCALE / 2;
  let rowsMeasured = 0;
  for (const row of SHADY_ROWS) {
    const extent = inkExtentOf(row.name, 0);
    if (extent.pixels === 0) {
      fail('G6', `${row.name}[0] is empty`);
      continue;
    }
    rowsMeasured++;
    const aboveFloor = tileFloor - extent.bottom;
    if (aboveFloor < SOLES_ABOVE_TILE_FLOOR_MIN_PX) {
      fail(
        'G6',
        `${row.name}'s soles paint ${aboveFloor}px above his tile's floor, which is at or ` +
          `through it (minimum ${SOLES_ABOVE_TILE_FLOOR_MIN_PX}px)`,
      );
    }
    if (aboveFloor > SOLES_ABOVE_TILE_FLOOR_MAX_PX) {
      fail(
        'G6',
        `${row.name}'s soles paint ${aboveFloor}px above his tile's floor, past a limit of ` +
          `${SOLES_ABOVE_TILE_FLOOR_MAX_PX}px — he is floating over the flagstones`,
      );
    }
    const centre = (extent.left + extent.right) / 2;
    if (Math.abs(centre - tileCentreX) > ANCHOR_CENTRE_TOLERANCE_PX) {
      fail(
        'G6',
        `${row.name} paints centred on x=${centre.toFixed(1)} against a tile centre of ` +
          `${tileCentreX}`,
      );
    }
  }
  failUnlessMeasured('G6', rowsMeasured, 'rows with a measurable sole line');
}

// ── G7: the warm-row budget ──────────────────────────────────────────────────

/**
 * The hard ceiling for one warm animation row.
 *
 * The sheet this figure replaced had a stated whole-texture budget. A painted
 * figure is admitted to the cache a row at a time, so the number that decides
 * whether it fits is the widest row's warm bytes rather than the sum of all of
 * them — and it has to stay well inside the cache's own per-figure ceiling so
 * that a second row can be warm at the same time.
 */
const ROW_BUDGET_MEGABYTES = 3;

/** G7 — the widest warm row's memory, reported whether or not it passes. */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of SHADY_FIGURE.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured('G7', statesMeasured, 'declared states');
  if (statesMeasured === 0) return;

  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarmMegabytes = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  G7 warm row: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once would be ` +
      `${allWarmMegabytes.toFixed(2)} MB`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      'G7',
      `${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
}

// ── G8: the state names the runtime asks for ─────────────────────────────────

/**
 * G8 — every state name the runtime can reach is a state the figure paints.
 *
 * Both draw paths return silently on an unknown state, so a name the wrapper
 * builds and the figure lacks is an invisible NPC and no log line.
 */
function gateRuntimeStateNames(): void {
  for (const failure of missingStateFailures(
    SHADY_FIGURE,
    SHADY_DRAWN_STATES,
    'the sprite wrapper',
  ))
    fail('G8', failure);
  for (const failure of missingStateFailures(
    SHADY_FIGURE,
    SHADY_PREWARMED_STATES,
    'the prewarm list',
  ))
    fail('G8', failure);
}

// ── G9: the frozen marker clearance ──────────────────────────────────────────

/**
 * How far above his painted crown the quest marker may float before it stops
 * reading as belonging to him.
 *
 * The clearance the creature freezes is deliberately more than the crown itself
 * — a marker resting on his hood touches it — so the gate brackets it rather
 * than matching it: never below the crown, never adrift above it.
 */
const MARKER_GAP_LIMIT_TILES = 0.4;

/** G9 — the frozen marker clearance still clears the painted hood. */
function gateMarkerClearance(): void {
  let framesMeasured = 0;
  let highestCrownTiles = 0;
  for (const row of SHADY_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const extent = inkExtentOf(row.name, frame);
      if (extent.pixels === 0) continue;
      framesMeasured++;
      highestCrownTiles = Math.max(
        highestCrownTiles,
        (SHADY_FIGURE.tileY - extent.top) / TILE_SCALE,
      );
    }
  }
  failUnlessMeasured('G9', framesMeasured, 'frames with ink to measure a crown from');
  if (framesMeasured === 0) return;
  console.log(
    `  G9 marker clearance: crown reaches ${highestCrownTiles.toFixed(3)} tiles above the ` +
      `tile, marker sits at ${SHADY_HEAD_ABOVE_TILE_TILES}`,
  );
  if (SHADY_HEAD_ABOVE_TILE_TILES < highestCrownTiles) {
    fail(
      'G9',
      `the marker sits ${SHADY_HEAD_ABOVE_TILE_TILES} tiles above the tile while his art ` +
        `reaches ${highestCrownTiles.toFixed(3)} — it is painted across him`,
    );
  }
  if (SHADY_HEAD_ABOVE_TILE_TILES > highestCrownTiles + MARKER_GAP_LIMIT_TILES) {
    fail(
      'G9',
      `the marker floats ${(SHADY_HEAD_ABOVE_TILE_TILES - highestCrownTiles).toFixed(3)} tiles ` +
        `clear of his crown, past a limit of ${MARKER_GAP_LIMIT_TILES}`,
    );
  }
}

/** Runs every gate and returns one message per failure. */
export function shadyGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateCowlIsVoid();
  gateElbowNeverInverts();
  gateLoopCloses();
  gateOneShotSettles();
  gateAnchor();
  gateWarmRowSize();
  gateRuntimeStateNames();
  gateMarkerClearance();
  return [...failures];
}
