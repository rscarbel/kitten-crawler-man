/**
 * The small spider's art gates.
 *
 * The creature has no baked sheet to inspect any more, so every invariant is
 * asserted against cells painted from `SPIDER_FIGURE` — baked exactly the way
 * the runtime cache bakes them, supersampled and downsampled, so what is
 * measured is what the game blits.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row it names fails
 * loudly: a lookup that quietly returns nothing turns a whole gate module green
 * while measuring nothing.
 *
 * Run by the review harness: `npm run render:spider`.
 */

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import {
  SPIDER_FIGURE,
  SPIDER_ROWS,
  TILE_SCALE,
  type RowSpec,
} from '../src/sprites/art/spiderFigure.js';
import { LEGS, LEG_COUNT_PER_SIDE, TOTAL_LEGS } from '../src/sprites/art/spiderArt.js';
import {
  SPIDER_APPROACH_STATES,
  SPIDER_COMBAT_STATES,
  SPIDER_STATES,
} from '../src/sprites/spiderSprite.js';

const INK_ALPHA_THRESHOLD = 24;
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

const { frameWidth, frameHeight } = SPIDER_FIGURE;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — loops only, planted rows only,
 * one entry per death row — and a narrowing that matches nothing leaves a green
 * gate that examined nothing. Every filtering loop here counts what it looked
 * at and ends with a call to this.
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
  const cell = bakeFigureCell(SPIDER_FIGURE, state, frame);
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
  readonly centreX: number;
  readonly centreY: number;
  readonly width: number;
  readonly height: number;
}

function inkStatsOf(alpha: Uint8ClampedArray, threshold = INK_ALPHA_THRESHOLD): InkStats {
  let count = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      if (alpha[y * frameWidth + x] < threshold) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) return { count: 0, centreX: 0, centreY: 0, width: 0, height: 0 };
  return {
    count,
    centreX: (minX + maxX) / 2,
    centreY: (minY + maxY) / 2,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    const inkedA = a[i] >= INK_ALPHA_THRESHOLD;
    const inkedB = b[i] >= INK_ALPHA_THRESHOLD;
    if (inkedA !== inkedB) differing++;
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
 * `SPIDER_ROWS`, so renaming a row would otherwise turn its gate into a silent
 * no-op: present, green, and measuring nothing.
 */
function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = SPIDER_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `no row named "${name}" — a gate is guarding a row that no longer exists`);
    return null;
  }
  return row;
}

// ── Gates ────────────────────────────────────────────────────────────────────

/**
 * G1 — the shared structural gates: every declared state paints every declared
 * frame, nothing paints against the cell edge, and the cell is not mostly
 * empty.
 *
 * The fill share is held below the shared default because the cell was frozen
 * by the bake this figure replaces and cannot be resized without breaking the
 * parity that proved it: four tiles across is what the airborne pounce needs,
 * and the standing rows sit well inside that. G6 is what says the cells are
 * still affordable.
 */
const MIN_INK_AREA_SHARE = 0.1;

function gateStructure(): void {
  for (const failure of figureStructuralFailures(SPIDER_FIGURE, {
    minInkAreaShare: MIN_INK_AREA_SHARE,
  })) {
    fail('G1', failure);
  }
}

/**
 * How far a planted spider's ink may sit from the cell centre.
 *
 * The cell centre is the figure's `tileX`/`tileY`, and the runtime spins the
 * creature about exactly that point every time it turns to face its heading —
 * so art that has drifted off it does not turn, it orbits. Generous enough to
 * allow the abdomen's own asymmetry about the body's midpoint, tight enough
 * that the wobble stays under a couple of in-game pixels.
 */
const PIVOT_TOLERANCE_PX = 14;
/** Rows a spider plays with its feet on the ground and its body over them. */
const PLANTED_ROWS = ['idle', 'walk', 'crouch'] as const;

/**
 * G2 — a planted spider's ink is centred on the pivot it is spun about.
 *
 * This cannot catch a wrong `tileX`/`tileY` — `paintFrame` puts its own origin
 * on the same point — and does not claim to; the parity run against the sheet
 * is what proved those numbers. What it catches is the art drifting off its own
 * anchor, which on this creature is visible as a swing every time it turns.
 */
function gatePivot(): void {
  let framesMeasured = 0;
  for (const name of PLANTED_ROWS) {
    const row = rowNamed(name, 'G2');
    if (row === null) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const stats = inkStatsOf(cellAlpha(name, frame), SOLID_ALPHA_THRESHOLD);
      if (stats.count === 0) {
        fail('G2', `${name}[${frame}] has no solid ink at all to measure`);
        continue;
      }
      framesMeasured++;
      const offset = Math.hypot(
        stats.centreX - SPIDER_FIGURE.tileX,
        stats.centreY - SPIDER_FIGURE.tileY,
      );
      if (offset > PIVOT_TOLERANCE_PX) {
        fail(
          'G2',
          `${name}[${frame}] centres its solid ink at (${stats.centreX.toFixed(1)}, ` +
            `${stats.centreY.toFixed(1)}), ${offset.toFixed(1)}px from the ` +
            `(${SPIDER_FIGURE.tileX}, ${SPIDER_FIGURE.tileY}) pivot it is rotated about ` +
            `(allowed ${PIVOT_TOLERANCE_PX}px) — it will orbit rather than turn`,
        );
      }
    }
  }
  failUnlessMeasured('G2', framesMeasured, 'planted frames');
}

/**
 * How far past the row's own largest ordinary step the seam may reach.
 *
 * A closed cycle crosses its seam the way it crosses anywhere else, so the
 * largest in-cycle step is the honest yardstick. Measured on shipped art: this
 * figure's two loop rows seam at 0.656 (walk) and 0.800 (idle) of their largest
 * step, and the worst across every painted figure in the repo is 1.076. The
 * limit this replaces also allowed 2.1x the row's *median* step, and a walk's
 * steps are all large enough for that clause to swallow the whole check — a row
 * re-timed to run one and a half cycles passed it. This clause is an art-drift check and cannot see cycle count at
 * all: re-timing a row moves the steps it is judged against along with the
 * seam. The wrap clause is what covers that.
 */
const LOOP_SEAM_CEILING = 1.15;
/**
 * The floor half of the band, against the row's median step.
 *
 * A ceiling alone is passed by the one mutation that beats every loop gate
 * written without one: sampling the cycle at `frame / (frameCount - 1)` makes
 * the last frame identical to the first, so the seam drops to nothing and the
 * row spends a whole frame held still. Held against the median rather than the
 * narrowest step, because a row may legitimately contain two byte-identical
 * adjacent frames, which would collapse a narrowest-based floor to `seam >= 0`.
 */
const LOOP_SEAM_FLOOR = 0.3;

/**
 * How many pixels the frame one past a loop's last may differ from its first.
 *
 * This is the clause that binds a cycle to exactly one turn, and the pixel band
 * above cannot do it: a row re-timed to run one and a half cycles raises its
 * ordinary steps in step with its seam, and measures 1.10 of its largest step
 * against a shipped 0.66 — inside any ceiling the shipped art can support. The
 * painter takes a frame index rather than a phase, so the row can simply be
 * painted at `frameCount`, one past its end, where a closed cycle reproduces
 * frame 0. It is not held to exactly zero because the cell is downsampled from
 * twice its size and a pose value landing on 2π rather than 0 rounds
 * independently on each side; both of this figure's loop rows measure 0px, and
 * the worst across the seven figures swept with it is 4px.
 */
const LOOP_WRAP_TOLERANCE_PX = 16;
/**
 * The least any interior frame of a loop may differ from its first.
 *
 * The wrap check is satisfied by a row that runs its cycle *twice*, which
 * repeats frame 0 in the middle of the row. Measured: the closest any interior
 * frame comes to frame 0 is 482px (idle), so this is well clear of the art and
 * still far from the 0px an exact repeat scores.
 */
const LOOP_INTERIOR_REPEAT_FLOOR_PX = 120;

/** G3 — a loop must close on exactly one turn, and must not pop at its seam. */
function gateLoopClosure(): void {
  let rowsMeasured = 0;
  for (const row of SPIDER_ROWS) {
    if (row.kind !== 'loop') continue;
    const cells = cellsOfRow(row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    rowsMeasured++;
    if (typical === 0) {
      fail('G3', `${row.name} has a median step of 0px — the row is frozen, not looping`);
      continue;
    }

    const wrap = frameDelta(cellAlpha(row.name, row.frameCount), cells[0]);
    if (wrap > LOOP_WRAP_TOLERANCE_PX) {
      fail(
        'G3',
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
        'G3',
        `${row.name}[${closestFrame}] comes back to within ${closestInterior}px of frame 0 ` +
          `(at least ${LOOP_INTERIOR_REPEAT_FLOOR_PX}px expected) — the row is running its ` +
          'cycle more than once',
      );
    }

    const largestStep = Math.max(...steps);
    const allowed = largestStep * LOOP_SEAM_CEILING;
    if (seam > allowed) {
      fail(
        'G3',
        `${row.name} pops across its loop seam: last→first differs by ${seam}px against a ` +
          `largest in-cycle step of ${largestStep}px (allowed ${allowed.toFixed(0)}px)`,
      );
    }
    const floor = typical * LOOP_SEAM_FLOOR;
    if (seam < floor) {
      fail(
        'G3',
        `${row.name} holds still across its loop seam: last→first differs by only ${seam}px ` +
          `against a median step of ${typical}px (at least ${floor.toFixed(0)}px expected) — ` +
          'the cycle is being sampled past its own end',
      );
    }
  }
  failUnlessMeasured('G3', rowsMeasured, 'loops that actually move');
}

const LOOP_STEP_LIMIT = 2.6;
const ONE_SHOT_STEP_LIMIT = 4;
const STEP_FLOOR_SHARE = 0.005;
/**
 * How far the worst step may exceed the *second* worst.
 *
 * Any cycle driven off a sine has a bimodal step distribution — fast steps
 * around the zero crossings, slow ones at the extremes — so its median is the
 * slow step and a perfectly smooth row scores several times it. What actually
 * distinguishes a snap is that it is a *lone* outlier: real motion that is fast
 * somewhere is fast in several places.
 */
const STEP_VS_RUNNER_UP = 1.35;

/** G4 — no consecutive-frame step far above the row's own median. */
function gateMotionContinuity(): void {
  const cellArea = frameWidth * frameHeight;
  let stepsMeasured = 0;
  for (const row of SPIDER_ROWS) {
    const cells = cellsOfRow(row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    stepsMeasured += steps.length;
    const typical = median(steps);
    const runnerUp = [...steps].sort((a, b) => b - a)[1] ?? 0;
    const limitShare = row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT;
    const allowed = Math.max(
      typical * limitShare,
      runnerUp * STEP_VS_RUNNER_UP,
      cellArea * STEP_FLOOR_SHARE,
    );
    steps.forEach((step, i) => {
      if (step > allowed) {
        fail(
          'G4',
          `${row.name} snaps between frames ${i} and ${i + 1}: ${step}px changed against a ` +
            `median step of ${typical}px (allowed ${allowed.toFixed(0)}px)`,
        );
      }
    });
  }
  failUnlessMeasured('G4', stepsMeasured, 'frame-to-frame steps');
}

const DEATH_ROWS = ['death_curl', 'death_spasm', 'death_flip'] as const;
/**
 * How far apart two death rows' final frames may be, as a share of the ink one
 * of them holds.
 *
 * Not zero: the three rows arrive at the rosette by different routes and their
 * last frames carry a little residual twitch. Small enough that a row settling
 * into a different pose is caught.
 */
const CORPSE_AGREEMENT_SHARE = 0.2;

/**
 * G5 — every death row ends on the same corpse.
 *
 * The creature holds the final frame of whichever death it played for the whole
 * fifteen seconds a body lingers, so the three rows have to converge: a spider
 * killed by a missile and one killed by a sword lie next to each other on the
 * floor, and a pose that only one of them reaches reads as two different
 * creatures.
 */
function gateCorpsesAgree(): void {
  const finals: Array<{ name: string; alpha: Uint8ClampedArray; ink: number }> = [];
  for (const name of DEATH_ROWS) {
    const row = rowNamed(name, 'G5');
    if (row === null) continue;
    const alpha = cellAlpha(name, row.frameCount - 1);
    finals.push({ name, alpha, ink: inkStatsOf(alpha).count });
  }
  let pairsMeasured = 0;
  for (let i = 0; i < finals.length; i++) {
    for (let j = i + 1; j < finals.length; j++) {
      pairsMeasured++;
      const differing = frameDelta(finals[i].alpha, finals[j].alpha);
      const allowed = Math.max(finals[i].ink, finals[j].ink) * CORPSE_AGREEMENT_SHARE;
      if (differing > allowed) {
        fail(
          'G5',
          `${finals[i].name} and ${finals[j].name} end on different corpses: ${differing}px ` +
            `differ against an allowance of ${allowed.toFixed(0)}px`,
        );
      }
    }
  }
  failUnlessMeasured('G5', pairsMeasured, 'pairs of death rows');
}

/**
 * Megabytes the widest single state may occupy once warm.
 *
 * The sheet-era budget was the whole texture, because the whole texture was
 * decoded whether or not anything played. A painted figure is admitted one
 * state at a time and lets go of the states it stops playing, so the number
 * that decides whether it fits is the widest row against the cache's per-figure
 * ceiling. This creature's cells are a quarter of a megabyte each, which is why
 * the number is worth watching.
 */
const ROW_BUDGET_MEGABYTES = 6;

/** G6 — the widest state's warm bytes, reported whether or not it passes. */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of SPIDER_FIGURE.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured('G6', statesMeasured, 'declared states');
  if (statesMeasured === 0) return;

  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarmMegabytes = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  G6 warm row: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once would be ` +
      `${allWarmMegabytes.toFixed(2)} MB`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      'G6',
      `${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
}

/**
 * G7 — every state name the runtime can build is one the figure paints.
 *
 * Both draw paths return silently on an unknown state, so a name the sprite
 * wrapper reaches for and the figure lacks is an invisible creature and no log
 * line. The two prewarm lists go through the same check: a prewarm of a state
 * that does not exist warms nothing and warns nowhere.
 */
function gateRuntimeStateNames(): void {
  const lists: ReadonlyArray<readonly [readonly string[], string]> = [
    [SPIDER_STATES, "spiderSprite's SPIDER_STATES"],
    [SPIDER_APPROACH_STATES, "spiderSprite's SPIDER_APPROACH_STATES"],
    [SPIDER_COMBAT_STATES, "spiderSprite's SPIDER_COMBAT_STATES"],
  ];
  for (const [names, purpose] of lists) {
    for (const failure of missingStateFailures(SPIDER_FIGURE, names, purpose)) fail('G7', failure);
  }
  // The other direction: a row the figure paints that no runtime name can reach
  // is art nobody ever sees, and it costs a cell in every accounting.
  const reachable = new Set(SPIDER_STATES);
  let rowsMeasured = 0;
  for (const row of SPIDER_ROWS) {
    rowsMeasured++;
    if (reachable.has(row.name)) continue;
    fail('G7', `the figure paints "${row.name}", which no runtime state name can reach`);
  }
  failUnlessMeasured('G7', rowsMeasured, 'painted rows');
}

/**
 * How much wider the airborne pounce must read than the same spider standing.
 *
 * The only cue a top-down view has for height off the ground is scale: the body
 * grows toward the camera and the legs are thrown out ahead. Lose that and the
 * leap becomes a slide.
 */
const POUNCE_SPREAD_GAIN = 1.15;

/**
 * G8 — the leap leaves the ground.
 *
 * Expressed as an ordering between frames rather than as a frozen span: the
 * airborne stretch of the row has to read larger than the idle the spider
 * launched from, whatever the authored scale happens to be.
 */
function gatePounceLeavesTheGround(): void {
  const pounce = rowNamed('pounce', 'G8');
  const idle = rowNamed('idle', 'G8');
  if (pounce === null || idle === null) return;
  const standing = inkStatsOf(cellAlpha('idle', 0));
  if (standing.count === 0) {
    fail('G8', 'idle[0] painted nothing to compare the leap against');
    return;
  }
  const standingSpan = Math.max(standing.width, standing.height);
  let widestSpan = 0;
  let widestFrame = -1;
  let framesMeasured = 0;
  for (let frame = 0; frame < pounce.frameCount; frame++) {
    const stats = inkStatsOf(cellAlpha('pounce', frame));
    if (stats.count === 0) continue;
    framesMeasured++;
    const span = Math.max(stats.width, stats.height);
    if (span <= widestSpan) continue;
    widestSpan = span;
    widestFrame = frame;
  }
  failUnlessMeasured('G8', framesMeasured, 'pounce frames');
  if (framesMeasured === 0) return;
  const required = standingSpan * POUNCE_SPREAD_GAIN;
  if (widestSpan < required) {
    fail(
      'G8',
      `the widest pounce frame (${widestFrame}) spans ${widestSpan}px against a standing span ` +
        `of ${standingSpan}px — the leap needs at least ${required.toFixed(0)}px to read as ` +
        'airborne rather than as a slide',
    );
  }
}

/**
 * How much of a resting spider's ink must have a mirror image across the body's
 * own long axis.
 *
 * Not 1: the idle row's tremor is seeded per leg, the abdomen's folium is
 * hand-scalloped, and the downsample rounds each side independently. What the
 * number rules out is a leg missing from one side, a fan that collapsed, or a
 * rest pose that has quietly stopped being a rest pose.
 */
const RESTING_SYMMETRY_FLOOR = 0.8;
/**
 * The same measure's ceiling for the walk, which is the same claim inverted.
 *
 * An alternating tetrapod swings L1/R2/L3/R4 while the other four hold, so a
 * walking spider is never symmetric. A gait that measured as symmetric is one
 * where every leg swings together — a march, and the single most likely way for
 * the phase offsets to be lost.
 */
const WALKING_SYMMETRY_CEILING = 0.8;
const RESTING_ROWS = ['idle', 'crouch'] as const;

/** The share of a cell's ink that has a mirror partner across the pivot's column. */
function bilateralSymmetryOf(alpha: Uint8ClampedArray): number {
  let ink = 0;
  let matched = 0;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      if (alpha[y * frameWidth + x] < INK_ALPHA_THRESHOLD) continue;
      ink++;
      const mirroredX = Math.round(2 * SPIDER_FIGURE.tileX - x);
      if (mirroredX < 0 || mirroredX >= frameWidth) continue;
      if (alpha[y * frameWidth + mirroredX] >= INK_ALPHA_THRESHOLD) matched++;
    }
  }
  return ink === 0 ? 0 : matched / ink;
}

/**
 * G9 — a resting spider is bilaterally symmetric and a walking one is not.
 *
 * Both directions are asserted, and the second is the one that earns the gate:
 * a gait whose phase offsets were lost paints all eight legs swinging in unison
 * and looks, frame by frame, entirely reasonable. The resting floor catches a
 * whole side of the rig going missing; a single leg is too small a share of the
 * creature's ink for this measure to see, which is what G10 is for.
 */
function gateBilateralSymmetry(): void {
  let rowsMeasured = 0;
  for (const name of RESTING_ROWS) {
    const row = rowNamed(name, 'G9');
    if (row === null) continue;
    rowsMeasured++;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const symmetry = bilateralSymmetryOf(cellAlpha(name, frame));
      if (symmetry >= RESTING_SYMMETRY_FLOOR) continue;
      fail(
        'G9',
        `${name}[${frame}] mirrors only ${(symmetry * 100).toFixed(1)}% of its ink across the ` +
          `body axis, under the ${(RESTING_SYMMETRY_FLOOR * 100).toFixed(0)}% a resting spider ` +
          'is held to — a limb is missing from one side',
      );
    }
  }
  const walk = rowNamed('walk', 'G9');
  if (walk !== null) {
    rowsMeasured++;
    let worst = 0;
    let worstFrame = -1;
    for (let frame = 0; frame < walk.frameCount; frame++) {
      const symmetry = bilateralSymmetryOf(cellAlpha('walk', frame));
      if (symmetry <= worst) continue;
      worst = symmetry;
      worstFrame = frame;
    }
    if (worst > WALKING_SYMMETRY_CEILING) {
      fail(
        'G9',
        `walk[${worstFrame}] mirrors ${(worst * 100).toFixed(1)}% of its ink across the body ` +
          `axis, over the ${(WALKING_SYMMETRY_CEILING * 100).toFixed(0)}% a gait is allowed — ` +
          'the legs are swinging in unison instead of alternating',
      );
    }
  }
  failUnlessMeasured('G9', rowsMeasured, 'rows with a symmetry claim');
}

/**
 * How far from its computed position a leg's tip may be and still count as
 * painted, in cell pixels.
 *
 * A tarsus is a couple of pixels wide at this scale and the cell is downsampled
 * from twice its size, so the ink at the very tip is soft. Wide enough to find
 * a leg that is there, far too tight to find one that is not.
 */
const LEG_TIP_TOLERANCE_PX = 5;
const DEGREES_PER_RADIAN = 180 / Math.PI;
/**
 * The idle row is the one the tips can be computed for without duplicating the
 * whole rig: every leg in it is planted (`lift` 0) and at full extension
 * (`reach` 1), so the chain is three fixed-length links off the socket.
 */
const LEG_TIP_ROW = 'idle';

/**
 * G10 — all eight legs are actually painted.
 *
 * The femur/tibia/tarsus chain is walked here from the rig's own socket and
 * segment lengths and the ink is looked for where it lands. This is the only
 * gate that notices one leg dropping out of the draw loop: every other
 * measurement in this file is an aggregate, and a spider paints seven legs
 * about as convincingly as it paints eight.
 */
function gateEveryLegIsPainted(): void {
  const row = rowNamed(LEG_TIP_ROW, 'G10');
  if (row === null) return;
  let tipsMeasured = 0;
  for (let frame = 0; frame < row.frameCount; frame++) {
    const pose = row.pose(frame);
    const alpha = cellAlpha(LEG_TIP_ROW, frame);
    for (let leg = 0; leg < TOTAL_LEGS; leg++) {
      const def = LEGS[leg % LEG_COUNT_PER_SIDE];
      const legPose = pose.legs[leg];
      if (legPose.lift !== 0 || legPose.reach !== 1) {
        fail(
          'G10',
          `${LEG_TIP_ROW}[${frame}] leg ${leg} is lifted or drawn in, so its tip cannot be ` +
            'computed from the socket alone — the gate has outlived the row it was written for',
        );
        continue;
      }
      let x = def.attachX;
      let y = def.attachY;
      for (const [angleDegrees, length] of [
        [legPose.femurAngle, def.femur],
        [legPose.tibiaAngle, def.tibia],
        [legPose.tarsusAngle, def.tarsus],
      ] as const) {
        const angle = angleDegrees / DEGREES_PER_RADIAN;
        x += Math.cos(angle) * length;
        y += Math.sin(angle) * length;
      }
      const side = leg < LEG_COUNT_PER_SIDE ? 1 : -1;
      const tipX = SPIDER_FIGURE.tileX + side * x * TILE_SCALE;
      const tipY = SPIDER_FIGURE.tileY + y * TILE_SCALE;
      tipsMeasured++;
      if (inkNear(alpha, tipX, tipY, LEG_TIP_TOLERANCE_PX)) continue;
      fail(
        'G10',
        `${LEG_TIP_ROW}[${frame}] has no ink within ${LEG_TIP_TOLERANCE_PX}px of leg ${leg}'s ` +
          `tip at (${tipX.toFixed(1)}, ${tipY.toFixed(1)}) — that leg is not being painted`,
      );
    }
  }
  failUnlessMeasured('G10', tipsMeasured, 'leg tips');
}

/** Whether any ink sits within `radius` cell pixels of a point. */
function inkNear(alpha: Uint8ClampedArray, cx: number, cy: number, radius: number): boolean {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(frameWidth - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(frameHeight - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      if (alpha[y * frameWidth + x] >= INK_ALPHA_THRESHOLD) return true;
    }
  }
  return false;
}

/** Runs every gate and returns one message per failure. */
export function smallSpiderGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gatePivot();
  gateLoopClosure();
  gateMotionContinuity();
  gateCorpsesAgree();
  gateWarmRowSize();
  gateRuntimeStateNames();
  gatePounceLeavesTheGround();
  gateBilateralSymmetry();
  gateEveryLegIsPainted();
  return [...failures];
}
