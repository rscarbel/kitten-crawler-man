/**
 * The goblins' art gates, for all five figures.
 *
 * The family has no baked sheets to inspect any more, so every invariant the
 * old bake gate enforced against sheet pixels is enforced here against cells
 * painted from the figures — baked exactly the way the runtime cache bakes
 * them, supersampled and downsampled, so what is measured is what the game
 * blits. The pose-stream gates measure the rig itself and need no pixels at
 * all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong across all five builds. A gate that cannot find the
 * row or state it names fails loudly, and so does one whose filtered loop ran
 * zero times: a lookup that quietly returns nothing turns a whole gate module
 * green while measuring nothing.
 *
 * Run by the review harness: `npm run render:goblins`.
 */

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import {
  ARCHETYPE_SCALE,
  GOBLIN_ARCHETYPES,
  GOBLIN_FIGURES,
  GOBLIN_GORE_STATES,
  GOBLIN_STYLES,
  GORE_RECENTRE,
  IMPACT_FRAMES,
  ROWS,
  TILE_SCALE,
  accelerationWindow,
  bowDrawAt,
  cyclePhase,
  goblinPose,
  goblinWeapon,
  goblinWeaponTip,
  nockPoint,
  type GoblinArchetype,
  type RowSpec,
} from '../src/sprites/art/goblinFigure.js';
import { along, buildSkeleton, type GoblinPose, type Pt } from '../src/sprites/art/goblinArt.js';
import { BONELESS_GORE_STATES, gorePieces } from '../src/sprites/art/goblinGore.js';
import {
  GOBLIN_ATTACKS,
  GOBLIN_BOW_SHOTS,
  GOBLIN_GORE_PARTS,
  GOBLIN_STATES,
} from '../src/sprites/goblinSprite.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';

const INK_ALPHA_THRESHOLD = 24;
/**
 * Alpha at which a pixel is the figure's own body rather than a shadow or an
 * antialiased fringe.
 *
 * The anchor gate measures against this and not against ordinary ink: a contact
 * shadow is painted on the ground line wherever the feet actually are, so a
 * lowest-ink check measures the shadow and stays green while the figure floats.
 */
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE_SIZE = 32;

const failures: string[] = [];

function fail(id: string, archetype: GoblinArchetype, message: string): void {
  failures.push(`${id} goblin_${archetype}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — planted frames only, loop rows
 * only, one entry per painted piece — and a narrowing that matches nothing
 * leaves a green gate that examined nothing. Every filtering loop here counts
 * what it looked at and ends with a call to this.
 */
function failUnlessMeasured(
  gateId: string,
  archetype: GoblinArchetype,
  measured: number,
  what: string,
): void {
  for (const message of nothingMeasuredFailures(measured, what)) fail(gateId, archetype, message);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

interface Cell {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

const cellCache = new Map<string, Cell>();

/** One cell's pixels, baked as the runtime cache bakes them. */
function cellOf(archetype: GoblinArchetype, state: string, frame: number): Cell {
  const key = `${archetype}/${state}[${frame}]`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const def = GOBLIN_FIGURES[archetype];
  const canvas = bakeFigureCell(def, state, frame);
  const { data } = canvas.getContext('2d').getImageData(0, 0, def.frameWidth, def.frameHeight);
  const cell: Cell = { data, width: def.frameWidth, height: def.frameHeight };
  cellCache.set(key, cell);
  return cell;
}

function alphaAt(cell: Cell, x: number, y: number): number {
  return cell.data[(y * cell.width + x) * CHANNELS + ALPHA_OFFSET];
}

/** Mean absolute per-channel difference between two cells, 0–255. */
function cellDelta(a: Cell, b: Cell): number {
  let total = 0;
  for (let i = 0; i < a.data.length; i++) total += Math.abs(a.data[i] - b.data[i]);
  return total / a.data.length;
}

function consecutiveDeltas(archetype: GoblinArchetype, row: RowSpec): number[] {
  const deltas: number[] = [];
  for (let frame = 1; frame < row.frameCount; frame++) {
    deltas.push(
      cellDelta(cellOf(archetype, row.name, frame - 1), cellOf(archetype, row.name, frame)),
    );
  }
  return deltas;
}

interface InkBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function inkBoundsOf(cell: Cell, threshold = INK_ALPHA_THRESHOLD): InkBounds | null {
  let minX = cell.width;
  let minY = cell.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (alphaAt(cell, x, y) <= threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function rowByName(name: string): RowSpec {
  const row = ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) throw new Error(`the goblin figures paint no row "${name}"`);
  return row;
}

const LOOP_ROWS = ROWS.filter((row) => row.kind === 'loop');
const ONE_SHOT_ROWS = ROWS.filter((row) => row.kind === 'oneShot');

// ── G1 · structure ───────────────────────────────────────────────────────────

/**
 * The shared structural gates: every declared frame paints something, nothing
 * reaches the cell edge, and the cell is not mostly empty.
 *
 * The single gore pieces are exempt from the cell-fill check and not from the
 * clipping one: a severed jaw is a tenth of a cell sized by a war hammer hauled
 * overhead, and that cell size is frozen by the bake these figures replaced.
 */
function gateStructure(archetype: GoblinArchetype): void {
  const messages = figureStructuralFailures(GOBLIN_FIGURES[archetype], {
    sparseStates: GOBLIN_GORE_STATES,
  });
  for (const message of messages) fail('G1', archetype, message);
}

// ── G2 · the figure stands on its own ground line ────────────────────────────

/**
 * How far above the ground line the lowest solid pixel of a standing pose may
 * sit before the goblin reads as floating.
 */
const SOLE_FLOAT_TOLERANCE_PX = 3;
/**
 * How far below it a sole may legitimately hang — a boot heel and its outline
 * are painted past the contact point on purpose.
 */
const SOLE_OVERHANG_TOLERANCE_PX = 6;
/** Clear cell kept below the sole, so a foot never touches the cell edge. */
const MIN_FRAME_BELOW_SOLE = 8;

/**
 * Assert the art hangs off the anchor the runtime places it by.
 *
 * The anchor itself is frozen geometry, and a gate that re-derived it from
 * `paintFrame`'s own origin would move both sides together and pass for any
 * value — the parity run is the only real check on the frozen numbers. What
 * this catches is the art drifting off that anchor: the soles measured against
 * the tile box the runtime hangs a health bar and a shadow from.
 */
function gateAnchor(archetype: GoblinArchetype): void {
  const def = GOBLIN_FIGURES[archetype];
  const groundY = def.tileY + def.tileScale;
  if (groundY <= 0 || groundY >= def.frameHeight) {
    fail('G2', archetype, `the ground line at ${groundY} is outside the ${def.frameHeight}px cell`);
    return;
  }
  if (def.frameHeight - groundY < MIN_FRAME_BELOW_SOLE) {
    fail(
      'G2',
      archetype,
      `only ${def.frameHeight - groundY}px of cell below the sole, against the ` +
        `${MIN_FRAME_BELOW_SOLE}px a foot needs to not touch the edge`,
    );
  }

  const idle = rowByName('idle');
  let framesMeasured = 0;
  for (let frame = 0; frame < idle.frameCount; frame++) {
    const bounds = inkBoundsOf(cellOf(archetype, idle.name, frame), SOLID_ALPHA_THRESHOLD);
    if (bounds === null) {
      fail('G2', archetype, `idle frame ${frame} paints no solid pixel at all`);
      continue;
    }
    framesMeasured++;
    const sole = bounds.top + bounds.height - 1;
    if (sole < groundY - SOLE_FLOAT_TOLERANCE_PX) {
      fail(
        'G2',
        archetype,
        `idle frame ${frame} has its lowest solid pixel ${groundY - sole}px above the ground ` +
          `line at ${groundY} — the goblin is standing in the air`,
      );
    }
    if (sole > groundY + SOLE_OVERHANG_TOLERANCE_PX) {
      fail(
        'G2',
        archetype,
        `idle frame ${frame} paints ${sole - groundY}px below the ground line at ${groundY} — ` +
          'the goblin is sunk into the tile it stands on',
      );
    }
  }
  failUnlessMeasured('G2', archetype, framesMeasured, 'idle frames for the ground anchor');
}

// ── G3 · loop closure ────────────────────────────────────────────────────────

/**
 * How far past its row's *largest* ordinary step the seam may sit.
 *
 * Against the largest and not against a blend of the row's own neighbours: a
 * gait's per-frame delta varies two-fold between the contact and the swing
 * phase, and the seam legitimately falls in the fast part of the cycle, so a
 * median-relative limit has to be loosened until it catches nothing. Re-derived
 * over all ten shipped loop rows, whose seams run 0.80× to 1.07× their largest
 * ordinary step — sword walk is the worst at 1.071× — so the ceiling sits 7%
 * above the worst shipped row. That is as tight as this family allows.
 *
 * What it catches is a lone hitch at the seam. A row covering more or less than
 * one turn it cannot catch at any threshold, because the pose distance
 * saturates; `gatePhaseCoverage` is the ceiling for that half of the defect.
 */
const LOOP_CLOSURE_RATIO = 1.15;
/**
 * How far short of its row's *median* step the seam may fall.
 *
 * A ceiling alone is passed by the one mutation that beats every loop gate:
 * sampling a loop at `frame / (frameCount - 1)` makes the last frame identical
 * to the first, which sends the seam to zero while the cycle spends a whole
 * frame held still. The seam has to sit in a band.
 *
 * Against the median rather than the narrowest step, because a row may
 * legitimately hold two adjacent frames still, which collapses a
 * narrowest-based floor into `seam >= 0`. The shipped rows wrap at 1.12× to
 * 1.46× their median step, so a floor at 0.5 clears the worst of them twice
 * over.
 */
const LOOP_CLOSURE_FLOOR_RATIO = 0.5;
/** Floating-point slack on a phase span that has to be exactly one turn. */
const PHASE_EPSILON = 1e-9;
const ONE_TURN = 1;

/**
 * The loop ceiling in the units the defect is actually in: a loop row's phase
 * mapping spends exactly one turn over its declared frames, in equal steps, so
 * the frame after the last lands on the first.
 *
 * The pixels cannot say this. Half a stride apart is about as different as two
 * goblin frames can be, so a row running one and a half turns wraps by roughly
 * what it steps and reads as an ordinary loop whatever the pixel threshold is.
 * Asserted on `cyclePhase`, which is what every loop row's pose is sampled
 * through, and per archetype only in the sense that the mapping is shared: the
 * declared frame count is the part that could differ.
 */
function gatePhaseCoverage(archetype: GoblinArchetype, row: RowSpec): void {
  const turns = cyclePhase(row.frameCount, row.frameCount) - cyclePhase(0, row.frameCount);
  if (Math.abs(turns - ONE_TURN) > PHASE_EPSILON) {
    fail(
      'G3',
      archetype,
      `${row.name} spends ${turns.toFixed(4)} of a turn over its ${row.frameCount} frames rather ` +
        'than exactly one, so the frame after the last does not land on the first',
    );
  }
  const firstStep = cyclePhase(1, row.frameCount) - cyclePhase(0, row.frameCount);
  let stepsMeasured = 0;
  for (let frame = 1; frame < row.frameCount; frame++) {
    stepsMeasured++;
    const step = cyclePhase(frame, row.frameCount) - cyclePhase(frame - 1, row.frameCount);
    if (Math.abs(step - firstStep) <= PHASE_EPSILON) continue;
    fail(
      'G3',
      archetype,
      `${row.name} advances ${step.toFixed(4)} of a turn into frame ${frame} against ` +
        `${firstStep.toFixed(4)} at the start of the row; an unevenly sampled loop stutters`,
    );
  }
  failUnlessMeasured('G3', archetype, stepsMeasured, `phase steps of ${row.name}`);
}

function gateLoopClosure(archetype: GoblinArchetype): void {
  let rowsMeasured = 0;
  for (const row of LOOP_ROWS) {
    rowsMeasured++;
    gatePhaseCoverage(archetype, row);
    const deltas = consecutiveDeltas(archetype, row);
    const seam = cellDelta(
      cellOf(archetype, row.name, row.frameCount - 1),
      cellOf(archetype, row.name, 0),
    );
    const largestOrdinary = Math.max(...deltas);
    const typicalOrdinary = median(deltas);
    if (largestOrdinary <= 0) {
      fail('G3', archetype, `${row.name} does not move between frames at all`);
      continue;
    }
    console.log(
      `  G3 ${archetype} ${row.name}: seam ${(seam / largestOrdinary).toFixed(2)}× the largest ` +
        `ordinary step, ${(seam / typicalOrdinary).toFixed(2)}× the median`,
    );
    if (seam > largestOrdinary * LOOP_CLOSURE_RATIO) {
      fail(
        'G3',
        archetype,
        `${row.name}: the loop seam is ${seam.toFixed(2)} against a limit of ` +
          `${(largestOrdinary * LOOP_CLOSURE_RATIO).toFixed(2)} — the cycle hitches once per ` +
          'revolution',
      );
    }
    if (seam < typicalOrdinary * LOOP_CLOSURE_FLOOR_RATIO) {
      fail(
        'G3',
        archetype,
        `${row.name}: the loop seam is only ${seam.toFixed(2)} against a floor of ` +
          `${(typicalOrdinary * LOOP_CLOSURE_FLOOR_RATIO).toFixed(2)} — the last frame repeats ` +
          'the first, so the cycle holds still for a whole frame every revolution',
      );
    }
  }
  failUnlessMeasured('G3', archetype, rowsMeasured, 'loop rows');
}

// ── G4 · motion continuity ───────────────────────────────────────────────────

const MOTION_SPIKE_RATIO = 2.5;

/**
 * Frames whose delta is *supposed* to spike, and which G4 and G8 therefore skip.
 *
 * Two cases, both declared by the choreography rather than discovered in the
 * pixels: the frames around an impact, which carry a smear crescent, and the
 * flinch's snap. A flinch is five frames of head-snapping recoil — the jump is
 * the animation, and a gate that forbade it would be forbidding the effect.
 */
const FLINCH_SNAP_LAST_FRAME = 2;

function isDeclaredSpike(archetype: GoblinArchetype, row: RowSpec, frame: number): boolean {
  if (row.name === 'flinch') return frame <= FLINCH_SNAP_LAST_FRAME;
  if (row.name !== 'attack_light' && row.name !== 'attack_heavy') return false;
  const kind = row.name === 'attack_light' ? 'light' : 'heavy';
  const window = accelerationWindow(archetype, kind);
  return frame >= window.from && frame <= window.to;
}

function gateMotionContinuity(archetype: GoblinArchetype): void {
  let stepsMeasured = 0;
  for (const row of ROWS) {
    const deltas = consecutiveDeltas(archetype, row);
    const limit = median(deltas) * MOTION_SPIKE_RATIO;
    deltas.forEach((delta, index) => {
      const frame = index + 1;
      if (isDeclaredSpike(archetype, row, frame)) return;
      stepsMeasured++;
      if (delta > limit) {
        fail(
          'G4',
          archetype,
          `${row.name}: frame ${frame - 1}→${frame} jumps ${delta.toFixed(2)} against a limit ` +
            `of ${limit.toFixed(2)} — a visible hitch`,
        );
      }
    });
  }
  failUnlessMeasured('G4', archetype, stepsMeasured, 'frame-to-frame steps');
}

// ── G5 · centroid smoothness ─────────────────────────────────────────────────

const CENTROID_SEAM_RATIO = 1.4;
/**
 * One screen pixel, expressed in cell pixels.
 *
 * Cells are painted at `TILE_SCALE` and drawn at `TILE_SIZE`, so a two-pixel
 * step in the cell is one pixel on screen. Below that the seam is rounding, not
 * a jump anyone can see, and holding a gait to it would be measuring the
 * rasteriser rather than the animation.
 */
const CENTROID_SEAM_FLOOR_PX = TILE_SCALE / IN_GAME_TILE_SIZE;

function inkCentroid(cell: Cell): { x: number; y: number } {
  let sumX = 0;
  let sumY = 0;
  let weight = 0;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      const alpha = alphaAt(cell, x, y);
      if (alpha <= INK_ALPHA_THRESHOLD) continue;
      sumX += x * alpha;
      sumY += y * alpha;
      weight += alpha;
    }
  }
  if (weight === 0) return { x: 0, y: 0 };
  return { x: sumX / weight, y: sumY / weight };
}

/**
 * G5: the ink centroid's path around a loop must close without a cliff at the
 * seam.
 *
 * Comparing frame 0 to the *last* frame is the obvious test, but it measures
 * the wrong thing: in a twelve-frame cycle the last frame is one twelfth
 * *before* frame 0, so a correctly closed loop still shows a full frame's worth
 * of travel there. What matters is that the step across the seam is the same
 * size as every other step, which is the same property G3 checks in pixel
 * space, measured on the figure's mass instead.
 */
function gateCentroid(archetype: GoblinArchetype): void {
  let rowsMeasured = 0;
  for (const row of LOOP_ROWS) {
    rowsMeasured++;
    const centroids = Array.from({ length: row.frameCount }, (_unused, frame) =>
      inkCentroid(cellOf(archetype, row.name, frame)),
    );
    const steps: number[] = [];
    for (let i = 1; i < centroids.length; i++) {
      steps.push(
        Math.hypot(centroids[i].x - centroids[i - 1].x, centroids[i].y - centroids[i - 1].y),
      );
    }
    const last = centroids[centroids.length - 1];
    const seam = Math.hypot(centroids[0].x - last.x, centroids[0].y - last.y);
    const limit = Math.max(median(steps) * CENTROID_SEAM_RATIO, CENTROID_SEAM_FLOOR_PX);
    if (seam > limit) {
      fail(
        'G5',
        archetype,
        `${row.name}: the ink centroid steps ${seam.toFixed(2)}px across the loop seam against ` +
          `a limit of ${limit.toFixed(2)}px — the mass jumps once per cycle`,
      );
    }
  }
  failUnlessMeasured('G5', archetype, rowsMeasured, 'loop rows for centroid drift');
}

// ── G6 · one-shot → idle continuity ──────────────────────────────────────────

const ONE_SHOT_SETTLE_RATIO = 2.0;

function gateOneShotSettle(archetype: GoblinArchetype): void {
  const idle = rowByName('idle');
  let rowsMeasured = 0;
  for (const row of ONE_SHOT_ROWS) {
    rowsMeasured++;
    const deltas = consecutiveDeltas(archetype, row);
    const settle = cellDelta(
      cellOf(archetype, row.name, row.frameCount - 1),
      cellOf(archetype, idle.name, 0),
    );
    const limit = median(deltas) * ONE_SHOT_SETTLE_RATIO;
    if (settle > limit) {
      fail(
        'G6',
        archetype,
        `${row.name}: the hand-off to idle is ${settle.toFixed(2)} against a limit of ` +
          `${limit.toFixed(2)} — the goblin pops every time it swings`,
      );
    }
  }
  failUnlessMeasured('G6', archetype, rowsMeasured, 'one-shot rows');
}

// ── Pose stream ──────────────────────────────────────────────────────────────

interface PosedFrame {
  readonly row: RowSpec;
  readonly frame: number;
  readonly pose: GoblinPose;
}

const poseCache = new Map<GoblinArchetype, readonly PosedFrame[]>();

function poseStream(archetype: GoblinArchetype): readonly PosedFrame[] {
  const cached = poseCache.get(archetype);
  if (cached !== undefined) return cached;
  const stream: PosedFrame[] = [];
  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      stream.push({ row, frame, pose: goblinPose(archetype, row, frame) });
    }
  }
  poseCache.set(archetype, stream);
  return stream;
}

function posesOfRow(archetype: GoblinArchetype, row: RowSpec): readonly GoblinPose[] {
  return poseStream(archetype)
    .filter((entry) => entry.row.name === row.name)
    .map((entry) => entry.pose);
}

// ── G7 · no foot slide (pose space) ──────────────────────────────────────────

const FOOT_SLIDE_TOLERANCE = 0.01;
/** How unevenly a rolling contact may step before the ground reads as slipping. */
const CONTACT_ROLL_TOLERANCE = 0.02;

/**
 * Assert that no planted foot slips.
 *
 * What "planted" means depends on whether the figure is travelling. A one-shot
 * is played on the spot, so a foot on the ground must not move at all. A walk
 * cycle is *also* played on the spot — the world scrolls past instead — so its
 * planted foot has to roll backward at exactly the speed the body is notionally
 * moving forward. The naive test "x must be constant" fails every correct walk
 * cycle ever authored.
 *
 * The invariant that actually holds for a rolling contact is: the foot never
 * moves *forward* while planted, and each backward step is the same size as the
 * last. An uneven step is the ground slipping under the foot.
 */
function gateFootSlide(archetype: GoblinArchetype): void {
  let stepsMeasured = 0;
  for (const row of ROWS) {
    const poses = posesOfRow(archetype, row);
    for (const side of ['nearFoot', 'farFoot'] as const) {
      const steps: number[] = [];
      for (let i = 1; i < poses.length; i++) {
        const previous = poses[i - 1][side];
        const current = poses[i][side];
        // An epsilon rather than an equality: a lift that starts returning a
        // vanishing float instead of a hard zero would empty this filter and
        // leave the gate measuring nothing.
        if (Math.abs(previous.y) > Number.EPSILON || Math.abs(current.y) > Number.EPSILON) {
          steps.length = 0;
          continue;
        }
        stepsMeasured++;
        const step = current.x - previous.x;

        if (row.kind !== 'loop') {
          if (Math.abs(step) > FOOT_SLIDE_TOLERANCE) {
            fail(
              'G7',
              archetype,
              `${row.name}: the ${side} slides ${Math.abs(step).toFixed(4)} tile between frames ` +
                `${i - 1} and ${i} while planted`,
            );
          }
          continue;
        }

        if (step > FOOT_SLIDE_TOLERANCE) {
          fail(
            'G7',
            archetype,
            `${row.name}: the ${side} moves ${step.toFixed(4)} tile *forward* between frames ` +
              `${i - 1} and ${i} while planted`,
          );
        }
        if (steps.length > 0) {
          const drift = Math.abs(step - steps[steps.length - 1]);
          if (drift > CONTACT_ROLL_TOLERANCE) {
            fail(
              'G7',
              archetype,
              `${row.name}: the ${side}'s rolling contact steps ${step.toFixed(4)} after ` +
                `${steps[steps.length - 1].toFixed(4)} between frames ${i - 1} and ${i} — the ` +
                'ground is slipping under the foot',
            );
          }
        }
        steps.push(step);
      }
    }
  }
  failUnlessMeasured('G7', archetype, stepsMeasured, 'planted-foot steps');
}

// ── G8 · weapon-tip arc ──────────────────────────────────────────────────────

const ARC_SPACING_RATIO = 2.2;
/**
 * The smallest tip step whose neighbours could produce a hitch a player notices.
 *
 * Three screen pixels at `TILE_SIZE` 32, expressed in tile units. Tips are in
 * *authored* units while the figure is drawn at `ARCHETYPE_SCALE` of that, so
 * the real on-screen threshold this buys is nearer two pixels. That errs toward
 * testing more steps than strictly necessary, which is the safe direction: this
 * value only ever exempts a step from the ratio test.
 */
const VISIBLE_STEP = 3 / IN_GAME_TILE_SIZE;

interface ArcStep {
  readonly length: number;
  readonly dx: number;
  readonly dy: number;
}

/**
 * Per-frame tip travel for a row.
 *
 * Null on a frame whose pose left `weaponAngle` unset — the caller decides
 * whether that is a gap worth failing over or a row with no weapon in it.
 */
function tipsOfRow(archetype: GoblinArchetype, row: RowSpec): ReadonlyArray<Pt | null> {
  return posesOfRow(archetype, row).map((pose) => goblinWeaponTip(pose, archetype));
}

/** True when this step is the last before, or first after, a direction change. */
function atTurnaround(steps: readonly ArcStep[], index: number): boolean {
  const reverses = (a: ArcStep, b: ArcStep): boolean => a.dx * b.dx + a.dy * b.dy < 0;
  if (index > 0 && reverses(steps[index - 1], steps[index])) return true;
  return index + 1 < steps.length && reverses(steps[index], steps[index + 1]);
}

function arcStepsOf(archetype: GoblinArchetype, row: RowSpec): ArcStep[] | null {
  const tips = tipsOfRow(archetype, row);
  const steps: ArcStep[] = [];
  for (let i = 1; i < tips.length; i++) {
    const from = tips[i - 1];
    const to = tips[i];
    if (from === null || to === null) return null;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    steps.push({ length: Math.hypot(dx, dy), dx, dy });
  }
  return steps;
}

function gateWeaponArc(archetype: GoblinArchetype): void {
  let rowsMeasured = 0;
  let rowsWithAComparison = 0;
  let pairsCompared = 0;
  for (const row of ROWS) {
    const steps = arcStepsOf(archetype, row);
    if (steps === null) {
      fail('G8', archetype, `${row.name}: a frame in this row has no weapon-tip position`);
      continue;
    }
    rowsMeasured++;
    const total = steps.reduce((sum, step) => sum + step.length, 0);
    if (total <= 0) {
      fail('G8', archetype, `${row.name}: the weapon tip never moves`);
      continue;
    }
    let rowPairsCompared = 0;
    for (let i = 1; i < steps.length; i++) {
      if (isDeclaredSpike(archetype, row, i + 1)) continue;
      // A turnaround is not a hitch. Where the tip reverses — the end of a
      // follow-through, the top of a wind — it slows to a stop and sets off
      // again, so the steps on the approach are legitimately short.
      if (atTurnaround(steps, i - 1) || atTurnaround(steps, i)) continue;
      const smaller = Math.min(steps[i - 1].length, steps[i].length);
      const larger = Math.max(steps[i - 1].length, steps[i].length);
      // The ratio test only applies once the tip is genuinely travelling. A
      // cliff between two steps of half a pixel each is arithmetic, not a hitch
      // anyone can see, and applying the test there fails every walk cycle —
      // where the weapon drags along the ground a fraction of a pixel per frame.
      if (larger < VISIBLE_STEP) continue;
      rowPairsCompared++;
      pairsCompared++;
      if (larger / smaller > ARC_SPACING_RATIO) {
        fail(
          'G8',
          archetype,
          `${row.name}: tip spacing jumps ${larger.toFixed(4)} against ${smaller.toFixed(4)} at ` +
            `frame ${i + 1} — a cliff in the spacing chart`,
        );
      }
    }
    if (rowPairsCompared > 0) rowsWithAComparison++;
  }
  console.log(
    `  G8 ${archetype}: ${pairsCompared} tip-spacing pairs compared over ` +
      `${rowsWithAComparison} of ${rowsMeasured} rows`,
  );
  failUnlessMeasured('G8', archetype, rowsMeasured, 'rows with a weapon-tip trace');
  // Counting rows is not counting measurements: every step in every row can be
  // dropped by the spike, turnaround and visibility filters and the gate would
  // still report six rows examined. What it examined is pairs.
  failUnlessMeasured('G8', archetype, pairsCompared, 'weapon-tip spacing pairs');
  failUnlessMeasured('G8', archetype, rowsWithAComparison, 'rows contributing a spacing pair');
}

// ── G14 · the off hand grips the haft ────────────────────────────────────────

/**
 * How far the off fist may sit from the wood, as a fraction of its own radius.
 *
 * Not zero: the rig solves the far arm to a *target*, and a hand a fraction of
 * its own width off the haft still overlaps it and reads as gripping. Past that
 * the fist is floating beside the weapon.
 */
const GRIP_SLACK_FRACTION = 0.5;

/**
 * Assert that a two-handed weapon is actually held with two hands.
 *
 * The rig solves the far arm to a target and clamps it at the arm's reach, so an
 * off grip placed further away than the arm is long does not fail loudly — it
 * silently stops short and paints the fist in mid-air, identically on every
 * frame. Every other gate here is a ratio or a continuity test, and a hand that
 * is wrong the same way in all 79 frames is perfectly continuous, so this is the
 * one artifact the rest of the suite is structurally blind to.
 */
/**
 * How many of the five builds carry a declared off grip at all.
 *
 * The gate can only run where `offGripDistance` is set, and four of the five
 * weapons leave it null, so `gateOffHandGrip` returns before it counts anything
 * on four archetypes out of five. Without this the whole gate could go quiet —
 * one edit to `goblinWeapons.ts` and nothing would be measured on any build —
 * and its own `failUnlessMeasured` would never hear about it, because it is
 * never reached.
 */
let archetypesWithAnOffGrip = 0;

function gateOffHandGrip(archetype: GoblinArchetype): void {
  const offGrip = goblinWeapon(archetype).offGripDistance;
  if (offGrip === null) return;
  archetypesWithAnOffGrip++;
  const style = GOBLIN_STYLES[archetype];
  const slack = style.proportions.handRadius * GRIP_SLACK_FRACTION;

  let framesMeasured = 0;
  for (const { row, frame, pose } of poseStream(archetype)) {
    if (pose.weaponAngle === null) continue;
    framesMeasured++;
    const onHaft = along(pose.nearHand, pose.weaponAngle, offGrip);
    const solved = buildSkeleton(style, pose).farArm.end;
    const gap = Math.hypot(solved.x - onHaft.x, solved.y - onHaft.y);
    if (gap > slack) {
      fail(
        'G14',
        archetype,
        `${row.name} frame ${frame}: the off hand sits ${gap.toFixed(4)} from the haft against ` +
          `a ${slack.toFixed(4)} allowance — the far arm cannot reach its grip, so the fist is ` +
          'drawn holding nothing',
      );
    }
  }
  failUnlessMeasured('G14', archetype, framesMeasured, 'two-handed frames');
}

// ── G15 · the weapon stays out of the floor ──────────────────────────────────

/**
 * How far a tip may sit below the ground plane, in *drawn* tiles.
 *
 * Not zero: a weapon that dips a pixel or two below the sole reads as touching
 * the ground, which a flinch and a dragged mace both want. This is set to catch
 * the other thing — a swing whose follow-through drove the head a third of a
 * tile under the sprite's own feet, which at 32 px is a grey puddle rather than
 * a weapon.
 */
const MAX_TIP_BELOW_GROUND = 0.1;

function gateWeaponClearsFloor(archetype: GoblinArchetype): void {
  const scale = ARCHETYPE_SCALE[archetype];
  let tipsMeasured = 0;
  for (const { row, frame, pose } of poseStream(archetype)) {
    const tip = goblinWeaponTip(pose, archetype);
    if (tip === null) continue;
    tipsMeasured++;
    const belowGround = tip.y * scale;
    if (belowGround > MAX_TIP_BELOW_GROUND) {
      fail(
        'G15',
        archetype,
        `${row.name} frame ${frame}: the weapon tip is ${belowGround.toFixed(3)} tiles below ` +
          `the goblin's own feet against a ${MAX_TIP_BELOW_GROUND} allowance — it is buried in ` +
          'the floor',
      );
    }
  }
  failUnlessMeasured('G15', archetype, tipsMeasured, 'weapon-tip positions');
}

// ── G9 · gore legibility ─────────────────────────────────────────────────────

const GORE_THUMB = 16;
const GORE_COVERAGE_MIN = 0.08;
/**
 * An ellipse filling its own bounding box covers 78.5%, so this cap is really
 * "the piece must not be a filled rectangle". The solid pieces — the torso slab
 * and the rib chunk — legitimately sit in the high sixties.
 */
const GORE_COVERAGE_MAX = 0.75;
/** Smallest a piece may be on screen at the runtime's 0.5× gore scale, in px. */
const GORE_MIN_SCREEN_PX = 8;
const GORE_RENDER_SCALE = 0.5;
/** How far the bone must out-shine the wound around it, as a luminance fraction. */
const BONE_CONTRAST_MIN = 0.35;
/** Fraction of a piece's ink treated as its brightest element. */
const BRIGHTEST_FRACTION = 0.05;
/** How far outside the wound's own pixels the bone is looked for. */
const WOUND_DILATION_PX = 4;

const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;
const CHANNEL_MAX = 255;

const GORE_PIECE_FRAME = 0;

/**
 * Gore legibility, measured over each piece's **own footprint** rather than over
 * its cell.
 *
 * The cell is sized by a war hammer hauled overhead, so a severed jaw fills 3%
 * of it and a cell-relative coverage test says nothing about whether the jaw
 * reads. What matters is the shape itself at the size a player sees: 16×16 over
 * the piece's bounding box, plus a floor on how big that box is on screen.
 */
function gateGoreLegibility(archetype: GoblinArchetype): void {
  let piecesMeasured = 0;
  for (const partName of GOBLIN_GORE_STATES) {
    const cell = cellOf(archetype, partName, GORE_PIECE_FRAME);
    const bounds = inkBoundsOf(cell);
    if (bounds === null) {
      fail('G9a', archetype, `${partName}: the cell is empty`);
      continue;
    }
    piecesMeasured++;

    const screenPx = Math.max(bounds.width, bounds.height) * GORE_RENDER_SCALE;
    if (screenPx < GORE_MIN_SCREEN_PX) {
      fail(
        'G9a',
        archetype,
        `${partName}: only ${screenPx.toFixed(1)}px on screen, below the ` +
          `${GORE_MIN_SCREEN_PX}px floor — it cannot be named at that size`,
      );
    }

    let inked = 0;
    const stepX = bounds.width / GORE_THUMB;
    const stepY = bounds.height / GORE_THUMB;
    for (let ty = 0; ty < GORE_THUMB; ty++) {
      for (let tx = 0; tx < GORE_THUMB; tx++) {
        const px = bounds.left + Math.floor((tx + 0.5) * stepX);
        const py = bounds.top + Math.floor((ty + 0.5) * stepY);
        if (alphaAt(cell, px, py) > INK_ALPHA_THRESHOLD) inked++;
      }
    }

    const coverage = inked / (GORE_THUMB * GORE_THUMB);
    if (coverage < GORE_COVERAGE_MIN || coverage > GORE_COVERAGE_MAX) {
      fail(
        'G9a',
        archetype,
        `${partName}: covers ${(coverage * 100).toFixed(1)}% of its own 16×16 footprint, ` +
          `outside [${GORE_COVERAGE_MIN * 100}%, ${GORE_COVERAGE_MAX * 100}%]`,
      );
    }

    if (BONELESS_GORE_STATES.includes(partName)) continue;
    assertBoneCarriesTheWound(archetype, cell, partName);
  }
  failUnlessMeasured('G9a', archetype, piecesMeasured, 'gore pieces');
}

/**
 * G9b: inside each wound, the bone must be the highest-contrast element.
 *
 * Measured over the wound's *own* extent rather than over the whole piece. A
 * severed head is mostly skin, so a piece-wide comparison ends up asking whether
 * a cheekbone highlight beats the neck stump — which is not the question. The
 * wound is found by its colour: blood and cut muscle are the only strongly
 * red-dominant things a goblin is made of.
 */
function assertBoneCarriesTheWound(archetype: GoblinArchetype, cell: Cell, partName: string): void {
  const index = (x: number, y: number): number => (y * cell.width + x) * CHANNELS;
  const isWoundPixel = (x: number, y: number): boolean => {
    if (alphaAt(cell, x, y) <= INK_ALPHA_THRESHOLD) return false;
    const at = index(x, y);
    return cell.data[at] > cell.data[at + 1] + cell.data[at + 2];
  };
  const lumaAt = (x: number, y: number): number => {
    const at = index(x, y);
    return (
      (LUMA_RED * cell.data[at] + LUMA_GREEN * cell.data[at + 1] + LUMA_BLUE * cell.data[at + 2]) /
      CHANNEL_MAX
    );
  };

  const woundLuma: number[] = [];
  const wound: Array<{ readonly x: number; readonly y: number }> = [];
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (!isWoundPixel(x, y)) continue;
      wound.push({ x, y });
      woundLuma.push(lumaAt(x, y));
    }
  }
  if (wound.length === 0) {
    fail('G9b', archetype, `${partName}: no wound anywhere on the piece`);
    return;
  }

  // The comparison region is the wound dilated by a few pixels, not the wound's
  // bounding box. Spatter and drip runs are red-dominant too and throw the box
  // out over the whole limb, at which point the "brightest element in the wound"
  // is a highlight on the skin two centimetres away from it.
  const region = new Set<number>();
  for (const at of wound) {
    for (let dy = -WOUND_DILATION_PX; dy <= WOUND_DILATION_PX; dy++) {
      for (let dx = -WOUND_DILATION_PX; dx <= WOUND_DILATION_PX; dx++) {
        const x = at.x + dx;
        const y = at.y + dy;
        if (x < 0 || y < 0 || x >= cell.width || y >= cell.height) continue;
        if (alphaAt(cell, x, y) <= INK_ALPHA_THRESHOLD) continue;
        region.add(y * cell.width + x);
      }
    }
  }
  const allLuma = [...region].map((packed) =>
    lumaAt(packed % cell.width, Math.floor(packed / cell.width)),
  );

  const brightest = [...allLuma].sort((a, b) => b - a);
  const topCount = Math.max(1, Math.round(brightest.length * BRIGHTEST_FRACTION));
  const boneLuma = brightest.slice(0, topCount).reduce((sum, value) => sum + value, 0) / topCount;
  const meanWound = woundLuma.reduce((sum, value) => sum + value, 0) / woundLuma.length;
  const contrast = boneLuma - meanWound;
  if (contrast < BONE_CONTRAST_MIN) {
    fail(
      'G9b',
      archetype,
      `${partName}: the brightest element inside the wound beats the wound itself by only ` +
        `${contrast.toFixed(3)}, under the ${BONE_CONTRAST_MIN} minimum — the bone is not ` +
        'carrying the wound',
    );
  }
}

// ── G9c · the nine pieces are nine shapes ────────────────────────────────────

/**
 * How much of their silhouette two pieces may share, as intersection over union.
 *
 * G9a asks whether a piece is legible on its own; nothing asked whether it was
 * legible *against the other eight*, and that is the gap the whole gore set fell
 * through. A blind naming test scored two of nine, and the reason was not that
 * any one piece was badly drawn: the four limbs were one silhouette in four
 * variants — same taper, same bend, same wound at the same end — so a reviewer
 * could see a severed limb and had no way to say which one.
 *
 * Measured on a 16×16 mask rather than on the raw pixels, because that is the
 * size the naming test is run at and colour is not what fails here. Scale is
 * normalised away — a big limb and a small limb of the same outline are the
 * same failure — but **aspect is not**: stretching each piece to fill its own
 * bounding box maps every convex blob onto a filled square and scores a severed
 * head against a rib slab at 71%, which measures the normalisation rather than
 * the art.
 */
const GORE_SHAPE_OVERLAP_MAX = 0.62;

/** The 16×16 occupancy mask of a piece, scaled to fit and centred, aspect kept. */
function goreFootprintMask(cell: Cell): readonly boolean[] | null {
  const bounds = inkBoundsOf(cell);
  if (bounds === null) return null;
  const span = Math.max(bounds.width, bounds.height);
  const step = span / GORE_THUMB;
  const padX = (span - bounds.width) / 2;
  const padY = (span - bounds.height) / 2;
  const mask: boolean[] = [];
  for (let ty = 0; ty < GORE_THUMB; ty++) {
    for (let tx = 0; tx < GORE_THUMB; tx++) {
      const sx = Math.floor((tx + 0.5) * step - padX);
      const sy = Math.floor((ty + 0.5) * step - padY);
      const inside = sx >= 0 && sy >= 0 && sx < bounds.width && sy < bounds.height;
      mask.push(inside && alphaAt(cell, bounds.left + sx, bounds.top + sy) > INK_ALPHA_THRESHOLD);
    }
  }
  return mask;
}

function shapeOverlap(a: readonly boolean[], b: readonly boolean[]): number {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) intersection++;
    if (a[i] || b[i]) union++;
  }
  return union === 0 ? 1 : intersection / union;
}

function gateGoreDistinctness(archetype: GoblinArchetype): void {
  const masks: Array<readonly boolean[]> = [];
  for (const partName of GOBLIN_GORE_STATES) {
    const mask = goreFootprintMask(cellOf(archetype, partName, GORE_PIECE_FRAME));
    if (mask === null) {
      fail('G9c', archetype, `${partName} is empty`);
      continue;
    }
    masks.push(mask);
  }
  let pairsMeasured = 0;
  for (let a = 0; a < masks.length; a++) {
    for (let b = a + 1; b < masks.length; b++) {
      pairsMeasured++;
      const overlap = shapeOverlap(masks[a], masks[b]);
      if (overlap > GORE_SHAPE_OVERLAP_MAX) {
        fail(
          'G9c',
          archetype,
          `${GOBLIN_GORE_STATES[a]} and ${GOBLIN_GORE_STATES[b]} share ` +
            `${(overlap * 100).toFixed(1)}% of their 16×16 silhouette, over the ` +
            `${GORE_SHAPE_OVERLAP_MAX * 100}% ceiling — they are one shape in two variants, and ` +
            'a player cannot name either of them',
        );
      }
    }
  }
  failUnlessMeasured('G9c', archetype, pairsMeasured, 'gore-piece pairs');
}

// ── G10 · rotation safety ────────────────────────────────────────────────────

/**
 * Assert a spinning piece stays inside the circle its cell inscribes.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of its own cell, so ink
 * outside that circle is clipped away at some angle of the tumble.
 */
function gateRotationSafety(archetype: GoblinArchetype): void {
  const def = GOBLIN_FIGURES[archetype];
  const radius = Math.min(def.frameWidth, def.frameHeight) / 2;
  let piecesMeasured = 0;
  for (const partName of GOBLIN_GORE_STATES) {
    const cell = cellOf(archetype, partName, GORE_PIECE_FRAME);
    piecesMeasured++;
    let worst = 0;
    for (let y = 0; y < cell.height; y++) {
      for (let x = 0; x < cell.width; x++) {
        if (alphaAt(cell, x, y) <= INK_ALPHA_THRESHOLD) continue;
        worst = Math.max(worst, Math.hypot(x - def.frameWidth / 2, y - def.frameHeight / 2));
      }
    }
    if (worst > radius) {
      fail(
        'G10',
        archetype,
        `${partName}: ink at ${worst.toFixed(1)}px from the cell centre, outside the ` +
          `${radius.toFixed(1)}px inscribed circle — it will clip as the piece spins`,
      );
    }
  }
  failUnlessMeasured('G10', archetype, piecesMeasured, 'gore pieces for rotation safety');
}

// ── G11 · warm-row budget ────────────────────────────────────────────────────

/**
 * How many megabytes one state of one figure may occupy in the frame cache.
 *
 * This is what replaced the old whole-sheet texture budget. A painted figure is
 * admitted to the cache one state at a time, so the number that decides whether
 * it fits is the widest state's bytes against the cache's per-figure ceiling,
 * not the sum of every state. Measured over every state the def declares, gore
 * pieces included: a scan of the pose rows alone leaves the single-frame states
 * out of the figure's memory accounting entirely.
 *
 * Read the logged line as the number that matters and the threshold as an
 * alarm rather than a tight bound: the shipped widest row is 0.70 MB, an
 * eighth of the budget, and mutation testing put the trip point at roughly
 * eleven times the frame count these rows declare or a threefold growth of the
 * cell. Nothing a painter can do moves it; only a much longer row or a much
 * bigger cell will.
 */
const ROW_BUDGET_MEGABYTES = 6;

function gateWarmRowSize(archetype: GoblinArchetype): void {
  const def = GOBLIN_FIGURES[archetype];
  const cellBytes = def.frameWidth * def.frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of def.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured('G11', archetype, statesMeasured, 'declared states');
  if (statesMeasured === 0) return;

  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarmMegabytes = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  G11 goblin_${archetype} warm row: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once would be ` +
      `${allWarmMegabytes.toFixed(2)} MB`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      'G11',
      archetype,
      `${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
}

// ── G13 · runtime/art sync ───────────────────────────────────────────────────

/** Which runtime table an archetype's attack timings come from, for error text. */
function timingTableName(archetype: GoblinArchetype): string {
  return archetype === 'bow' ? 'GOBLIN_BOW_SHOTS' : 'GOBLIN_ATTACKS';
}

function gateTimingTable(archetype: GoblinArchetype): void {
  let kindsMeasured = 0;
  for (const kind of ['light', 'heavy'] as const) {
    // The archer's rows are measured by a table of their own: an arrow has no
    // reach and no moment of contact, so `GOBLIN_ATTACKS`' reach and damage
    // columns would be fields nothing could fill. What both tables *do* share is
    // the frame the row peaks on, which is what this gate is about.
    const timing =
      archetype === 'bow'
        ? {
            spriteFrames: GOBLIN_BOW_SHOTS[kind].spriteFrames,
            impactFrame: GOBLIN_BOW_SHOTS[kind].releaseFrame,
          }
        : GOBLIN_ATTACKS[archetype][kind];
    const row = rowByName(kind === 'light' ? 'attack_light' : 'attack_heavy');
    kindsMeasured++;
    if (timing.spriteFrames !== row.frameCount) {
      fail(
        'G13',
        archetype,
        `${kind}: ${timingTableName(archetype)} says ${timing.spriteFrames} sprite frames, the ` +
          `figure paints ${row.frameCount}`,
      );
    }
    if (timing.impactFrame !== IMPACT_FRAMES[archetype][kind]) {
      fail(
        'G13',
        archetype,
        `${kind}: ${timingTableName(archetype)} says frame ${timing.impactFrame}, the figure ` +
          `animates ${IMPACT_FRAMES[archetype][kind]}`,
      );
    }
    if (timing.impactFrame < 0 || timing.impactFrame >= row.frameCount) {
      fail('G13', archetype, `${kind}: impact frame ${timing.impactFrame} out of range`);
    }
  }
  failUnlessMeasured('G13', archetype, kindsMeasured, 'attack kinds');
}

/**
 * G13b: the *art* must peak where the table says it connects.
 *
 * Comparing the timing table against the figure's own impact table is two
 * copies of the same number agreeing with each other — unfalsifiable. What can
 * actually be wrong is the choreography: a swing whose fastest frame lands
 * nowhere near the frame damage is dealt on reads as a hit that happens before
 * or after the blow. The weapon tip's largest step is the moment of the strike,
 * so that is what gets checked.
 */
const PEAK_TOLERANCE_FRAMES = 1;

function gateImpactIsThePeak(archetype: GoblinArchetype): void {
  // The bow is exempt, and not as a loophole: this gate measures the *weapon
  // tip*, and a bow's tips are its limbs, which travel during the raise and the
  // lower and stand still through the hold. What has to peak on the release
  // frame is the string, and G16 below measures exactly that.
  if (archetype === 'bow') return;
  let kindsMeasured = 0;
  for (const kind of ['light', 'heavy'] as const) {
    const row = rowByName(kind === 'light' ? 'attack_light' : 'attack_heavy');
    const steps = arcStepsOf(archetype, row);
    if (steps === null || steps.length < 1) {
      fail('G13b', archetype, `${kind}: no weapon-tip trace for ${row.name}`);
      continue;
    }
    kindsMeasured++;
    const lengths = steps.map((step) => step.length);
    const spread = Math.max(...lengths) - Math.min(...lengths);
    if (spread <= Number.EPSILON) {
      fail('G13b', archetype, `${kind}: the weapon tip travels evenly — no strike`);
      continue;
    }
    const fastestFrame = lengths.indexOf(Math.max(...lengths)) + 1;
    const impact = IMPACT_FRAMES[archetype][kind];
    if (Math.abs(fastestFrame - impact) > PEAK_TOLERANCE_FRAMES) {
      fail(
        'G13b',
        archetype,
        `${kind}: the weapon is travelling fastest on frame ${fastestFrame} but damage lands on ` +
          `frame ${impact} — the strike and the hit are ${Math.abs(fastestFrame - impact)} ` +
          'frames apart',
      );
    }
  }
  failUnlessMeasured('G13b', archetype, kindsMeasured, 'melee attack rows');
}

// ── G16 · the bow's draw, and the hand on its string ─────────────────────────

/** Frames at least this far into their row's own full draw are checked for a fist on the string. */
const HAND_ON_STRING_MIN_DRAW_FRACTION = 0.9;
/** How many frames the string must sit at full draw before the loose. */
const MIN_DRAW_HOLD_FRAMES = 2;
/**
 * How far the draw hand has to move, in tile units, before a reversal counts as
 * a teleport rather than as the top of an authored arc.
 */
const MIN_HAND_SPIKE_STEP = 0.18;
/** How anti-parallel two steps must be to read as there-and-back; cos(~37°). */
const HAND_REVERSAL_ALIGNMENT = 0.8;
/** Below this a "full draw" is a string that never left its resting chord. */
const MIN_FULL_DRAW = 0.6;

/**
 * Assert that the archer's draw actually reads as a draw, and that the hand
 * pulling it is on the string.
 *
 * This is what G13b is exempted from measuring, and it is not a formality. G13b
 * tests the *weapon tip*, which for a bow is a limb that travels during the
 * raise and stands still through the hold, so it says nothing about the release.
 * G14 is blind here too — it returns early on a null `offGripDistance`, which a
 * bow has, so the very artifact G14's own header calls "the one the rest of the
 * suite is structurally blind to" (a fist drawn in mid-air, identically on every
 * frame) had nothing looking at it at all.
 */
function gateBowDraw(archetype: GoblinArchetype): void {
  if (archetype !== 'bow') return;
  const style = GOBLIN_STYLES.bow;
  const slack = style.proportions.handRadius * GRIP_SLACK_FRACTION;
  let framesMeasured = 0;

  for (const kind of ['light', 'heavy'] as const) {
    const row = rowByName(kind === 'light' ? 'attack_light' : 'attack_heavy');
    const poses = posesOfRow(archetype, row);
    const releaseFrame = IMPACT_FRAMES.bow[kind];

    // The row's own full draw, which is not the same number for both shots —
    // the hurried one deliberately pulls less far. Everything below has to be
    // relative to it rather than to an absolute, or a threshold tuned on the
    // aimed shot silently skips the whole hurried row.
    const fullDraw = bowDrawAt(kind, releaseFrame - 1, row.frameCount).amount;
    let peakDraw = 0;
    let previousDraw = 0;
    for (let frame = 0; frame < poses.length; frame++) {
      const pose = poses[frame];
      if (pose.weaponAngle === null) {
        fail('G16', archetype, `${kind} frame ${frame}: no aiming pose`);
        continue;
      }
      const draw = bowDrawAt(kind, frame, row.frameCount);

      // The string is let go on the release frame and stays let go: a bow still
      // bent through its own recovery reads as a shot that never left.
      const isReleased = frame >= releaseFrame;
      if (isReleased && (draw.amount !== 0 || draw.nocked)) {
        fail(
          'G16',
          archetype,
          `${kind} frame ${frame}: the string is still drawn ${draw.amount.toFixed(3)} after ` +
            `the release on frame ${releaseFrame}`,
        );
      }
      if (!isReleased) {
        // Monotone up to the loose. A draw that eased back before releasing is a
        // bow the archer changed its mind about, and it costs the telegraph the
        // one thing it is for: the string only ever gets tighter.
        if (draw.amount < previousDraw) {
          fail(
            'G16',
            archetype,
            `${kind} frame ${frame}: the string slackens from ${previousDraw.toFixed(3)} to ` +
              `${draw.amount.toFixed(3)} before the loose`,
          );
        }
        previousDraw = draw.amount;
        peakDraw = Math.max(peakDraw, draw.amount);
      }

      // The fist has to be *on the string*, checked only where the bow is fully
      // up and fully drawn. Earlier in the row the archer is still raising it and
      // the hand is legitimately on its way; afterwards the recoil is
      // deliberately throwing it back off.
      if (isReleased || draw.amount < fullDraw * HAND_ON_STRING_MIN_DRAW_FRACTION) continue;
      framesMeasured++;
      const onString = nockPoint(pose.nearHand, pose.weaponAngle, draw.amount);
      const solved = buildSkeleton(style, pose).farArm.end;
      const gap = Math.hypot(solved.x - onString.x, solved.y - onString.y);
      if (gap > slack) {
        fail(
          'G16',
          archetype,
          `${kind} frame ${frame}: the draw hand sits ${gap.toFixed(4)} from the string against ` +
            `a ${slack.toFixed(4)} allowance — the fist is drawn holding nothing`,
        );
      }
    }

    // Full draw has to be reached *and then held*. Testing the frame before the
    // loose would be arithmetic rather than a check: the monotonicity test above
    // already forbids the draw from decreasing, so the last frame before the
    // loose is the peak by construction and `peak >= peak` can never fail. What
    // is worth asserting is that the string arrived early enough to sit still
    // for a moment first, which is the whole of what makes a telegraph readable.
    const drawAtHoldStart = bowDrawAt(
      kind,
      releaseFrame - MIN_DRAW_HOLD_FRAMES,
      row.frameCount,
    ).amount;
    if (drawAtHoldStart < peakDraw) {
      fail(
        'G16',
        archetype,
        `${kind}: the string is still only at ${drawAtHoldStart.toFixed(3)} ` +
          `${MIN_DRAW_HOLD_FRAMES} frames before the loose and reaches ${peakDraw.toFixed(3)} — ` +
          'it snaps back the instant it reaches tension, with no hold',
      );
    }
    if (peakDraw < MIN_FULL_DRAW) {
      fail(
        'G16',
        archetype,
        `${kind}: peak draw is only ${peakDraw.toFixed(3)} — that is a bow being held, not one ` +
          'being drawn',
      );
    }

    // The draw hand must never go somewhere and come straight back. This is the
    // specific artifact the rest of the suite cannot see: the release frame sits
    // inside G4's and G8's declared acceleration window, so a fist that snapped
    // from the jaw onto the riser and off again — on the one frame the arrow
    // spawns — passed every other gate in the file.
    for (let frame = 1; frame + 1 < poses.length; frame++) {
      const inX = poses[frame].farHand.x - poses[frame - 1].farHand.x;
      const inY = poses[frame].farHand.y - poses[frame - 1].farHand.y;
      const outX = poses[frame + 1].farHand.x - poses[frame].farHand.x;
      const outY = poses[frame + 1].farHand.y - poses[frame].farHand.y;
      const inLength = Math.hypot(inX, inY);
      const outLength = Math.hypot(outX, outY);
      if (inLength < MIN_HAND_SPIKE_STEP || outLength < MIN_HAND_SPIKE_STEP) continue;
      const alignment = (inX * outX + inY * outY) / (inLength * outLength);
      if (alignment < -HAND_REVERSAL_ALIGNMENT) {
        fail(
          'G16',
          archetype,
          `${kind} frame ${frame}: the draw hand travels ${inLength.toFixed(4)} and comes ` +
            `straight back ${outLength.toFixed(4)} — a one-frame teleport, not a motion`,
        );
      }
    }
  }
  failUnlessMeasured('G16', archetype, framesMeasured, 'frames at full draw');
}

// ── G17 · the frozen gore recentring still centres the ink ───────────────────

/**
 * How far a piece's ink centre may sit from the centre of its cell.
 *
 * Asserted on the *effect* rather than by re-deriving the frozen offset the
 * same way the figure applies it: a gate that recomputed the arithmetic would
 * agree with itself whatever the numbers were. What the consumer cares about is
 * that the piece tumbles in place, and that is "the ink lands on the cell
 * centre" — measured on the cell the runtime actually spins, in cell pixels.
 */
const GORE_CENTRE_TOLERANCE_PX = 1.5;

function gateGoreRecentre(archetype: GoblinArchetype): void {
  const def = GOBLIN_FIGURES[archetype];
  const paintedStates = new Set(gorePieces(GOBLIN_STYLES[archetype]).map((piece) => piece.state));
  for (const frozenState of GORE_RECENTRE[archetype].keys()) {
    if (paintedStates.has(frozenState)) continue;
    fail(
      'G17',
      archetype,
      `GORE_RECENTRE freezes an offset for "${frozenState}", which nothing paints any more`,
    );
  }
  let piecesMeasured = 0;
  for (const partName of GOBLIN_GORE_STATES) {
    if (!paintedStates.has(partName)) {
      fail('G17', archetype, `nothing paints the declared piece "${partName}"`);
      continue;
    }
    const bounds = inkBoundsOf(cellOf(archetype, partName, GORE_PIECE_FRAME));
    if (bounds === null) {
      fail('G17', archetype, `${partName} painted nothing at all`);
      continue;
    }
    piecesMeasured++;
    const centreX = bounds.left + (bounds.width - 1) / 2;
    const centreY = bounds.top + (bounds.height - 1) / 2;
    const offX = centreX - def.frameWidth / 2;
    const offY = centreY - def.frameHeight / 2;
    if (Math.hypot(offX, offY) > GORE_CENTRE_TOLERANCE_PX) {
      fail(
        'G17',
        archetype,
        `${partName}'s ink centres ${Math.hypot(offX, offY).toFixed(2)}px off the cell centre ` +
          `(${offX.toFixed(2)}, ${offY.toFixed(2)}) against a ` +
          `${GORE_CENTRE_TOLERANCE_PX}px allowance — the piece will orbit rather than tumble; ` +
          're-measure GORE_RECENTRE',
      );
    }
  }
  failUnlessMeasured('G17', archetype, piecesMeasured, 'gore pieces for recentring');
}

// ── G18 · every state the runtime asks for is painted ────────────────────────

/**
 * Assert the names the runtime builds exist in the art.
 *
 * Both draw paths return silently on an unknown state, so a row name only the
 * runtime knows is an invisible goblin and no log line. Every table of names
 * the game can reach goes through here.
 */
function gateRuntimeStateNames(archetype: GoblinArchetype): void {
  const def = GOBLIN_FIGURES[archetype];
  for (const message of missingStateFailures(def, GOBLIN_STATES, 'GoblinAnimator.resolve')) {
    fail('G18', archetype, message);
  }
  // Against what `goblinGore.ts` actually paints, not against the figure's own
  // declaration: `GOBLIN_GORE_PARTS` *is* that declaration, so comparing the two
  // would be one list agreeing with itself. The independent list is the set of
  // piece names the wound module authors.
  const painted = gorePieces(GOBLIN_STYLES[archetype]).map((piece) => piece.state);
  let partsMeasured = 0;
  for (const part of GOBLIN_GORE_PARTS) {
    partsMeasured++;
    if (painted.includes(part)) continue;
    fail(
      'G18',
      archetype,
      `BodyPartGoreSystem spawns "${part}", which goblinGore.ts paints no piece for — the ` +
        'piece silently never appears',
    );
  }
  for (const state of painted) {
    if (GOBLIN_GORE_PARTS.includes(state)) continue;
    fail(
      'G18',
      archetype,
      `goblinGore.ts paints "${state}", which nothing spawns — it is a wound nobody sees`,
    );
  }
  failUnlessMeasured('G18', archetype, partsMeasured, 'gore parts');
}

// ── Run ──────────────────────────────────────────────────────────────────────

// A painter that composes on its own scratch surface reaches
// `document.createElement('canvas')`, which Node does not have.
installCanvasGlobals();

/** Runs every gate over all five figures and returns one message per failure. */
export function goblinGateFailures(): string[] {
  failures.length = 0;
  archetypesWithAnOffGrip = 0;
  for (const archetype of GOBLIN_ARCHETYPES) {
    gateStructure(archetype);
    gateAnchor(archetype);
    gateLoopClosure(archetype);
    gateMotionContinuity(archetype);
    gateCentroid(archetype);
    gateOneShotSettle(archetype);
    gateFootSlide(archetype);
    gateWeaponArc(archetype);
    gateOffHandGrip(archetype);
    gateWeaponClearsFloor(archetype);
    gateGoreLegibility(archetype);
    gateGoreDistinctness(archetype);
    gateRotationSafety(archetype);
    gateWarmRowSize(archetype);
    gateTimingTable(archetype);
    gateImpactIsThePeak(archetype);
    gateBowDraw(archetype);
    gateGoreRecentre(archetype);
    gateRuntimeStateNames(archetype);
  }
  for (const message of nothingMeasuredFailures(
    archetypesWithAnOffGrip,
    'builds carrying a declared off grip',
  )) {
    failures.push(`G14: ${message}`);
  }
  return [...failures];
}
