/**
 * Mongo's art gates, across all three growth stages.
 *
 * The creature has no baked sheets any more, so every invariant the old bake
 * gate enforced against sheet pixels is enforced here against cells painted
 * from the three `FigureDef`s — baked exactly the way the runtime cache bakes
 * them, supersampled and downsampled, so what is measured is what the game
 * blits. The pose-stream gates measure the rig itself and need no pixels at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong, and every failure carries the measured value *and*
 * the limit so it says what to change. A gate that cannot find the row or state
 * it names fails loudly, and so does one whose filtered loop examined nothing.
 *
 * Run by the review harness: `npm run render:mongo`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures as sharedDistinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  CONTRALATERAL_PHASE,
  MONGO_FIGURES,
  MONGO_ROWS,
  STANCE_FRACTION,
  TILE_SCALE,
  poseStream,
  type RowSpec,
} from '../src/sprites/art/mongoFigure.js';
import {
  GROUND_Y,
  MONGO_STAGES,
  MONGO_STAGE_ORDER,
  legReach,
  measureFootSickle,
  measureHandClaw,
  measureHead,
  measureLegs,
  type MongoPose,
  type MongoStage,
  type Pt,
} from '../src/sprites/art/mongoArt.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Alpha above which a pixel counts as painted. */
const INK_ALPHA_THRESHOLD = 24;
const MAX_ALPHA = 255;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — planted frames only, profile
 * rows only, one sample per stage — and a narrowing that matches nothing leaves
 * a green gate that examined nothing. Every filtering loop here counts what it
 * looked at and ends with a call to this.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

interface Cell {
  /** RGBA, four bytes per pixel, row-major within the cell. */
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

const cellCache = new Map<string, Cell>();

function cellOf(def: FigureDef, state: string, frame: number): Cell {
  const key = `${def.id}|${state}[${frame}]`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const declared = def.states.get(state);
  if (declared === undefined) throw new Error(`${def.id} declares no state "${state}"`);
  if (frame < 0 || frame >= declared.frames) {
    throw new Error(`${def.id}.${state} has no frame ${frame}`);
  }
  const canvas = bakeFigureCell(def, state, frame);
  const { data } = canvas.getContext('2d').getImageData(0, 0, def.frameWidth, def.frameHeight);
  const cell = { pixels: data, width: def.frameWidth, height: def.frameHeight };
  cellCache.set(key, cell);
  return cell;
}

function alphaAt(cell: Cell, x: number, y: number): number {
  return cell.pixels[(y * cell.width + x) * CHANNELS + ALPHA_OFFSET];
}

interface InkBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function inkBox(cell: Cell): InkBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (alphaAt(cell, x, y) < INK_ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function inkCentroid(cell: Cell): Point | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (alphaAt(cell, x, y) < INK_ALPHA_THRESHOLD) continue;
      sumX += x;
      sumY += y;
      count++;
    }
  }
  if (count === 0) return null;
  return { x: sumX / count, y: sumY / count };
}

/** Mean absolute alpha difference between two cells, 0–255. */
function cellDelta(a: Cell, b: Cell): number {
  let total = 0;
  const count = a.width * a.height;
  for (let i = 0; i < count; i++) {
    total += Math.abs(
      a.pixels[i * CHANNELS + ALPHA_OFFSET] - b.pixels[i * CHANNELS + ALPHA_OFFSET],
    );
  }
  return total / count;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

const LOOP_ROWS = MONGO_ROWS.filter((row) => row.kind === 'loop');

function stageOrder(): readonly MongoStage[] {
  return MONGO_STAGE_ORDER;
}

function figureOf(stage: MongoStage): FigureDef {
  return MONGO_FIGURES[stage];
}

function cellKey(row: string, frame: number): string {
  return `${row}[${frame}]`;
}

// ── Structural ───────────────────────────────────────────────────────────────

/**
 * G1 — the shared structural gates, per stage: every declared frame paints
 * something, nothing paints against the cell edge, and the cell is not far
 * larger than the widest pose inside it.
 */
function gateStructure(): void {
  let stagesMeasured = 0;
  for (const stage of stageOrder()) {
    stagesMeasured++;
    for (const failure of figureStructuralFailures(figureOf(stage)))
      fail('G1', `${stage} ${failure}`);
  }
  failUnlessMeasured('G1', stagesMeasured, 'growth stages');
}

/**
 * G2 — anchor. His feet must stand on the tile the figure claims, or the health
 * bar, the aggro marker and the minimap dot all sit somewhere else.
 *
 * What it can prove and what it cannot. The painter takes its own paint origin
 * from `tileY` and pivots its stage scaling on `GROUND_Y`, and this measures
 * against an expression built from those same two numbers — so moving either
 * moves the ground line and the figure together and this gate passes for any
 * value of them. G-CLEARANCE is the clause that ties `tileY` to something
 * outside the art, by re-measuring the lift the runtime declares for his health
 * bar. What G2 catches is art drifting off its own anchor, per stage and per
 * view: the head-on and edge-on feet are painted by different code, and a view
 * that stands a pixel lower than the others is what a single-row check misses.
 *
 * The horizontal half of the anchor is not measurable in pixels at all — the
 * art is not symmetric about its tile, and it moves with the cell it is
 * measured in — so it is checked against the painter's own origin arithmetic
 * instead, which is the one thing `tileX` has to agree with.
 *
 * Checked on frame 0 of every row rather than on one sample: the head-on and
 * edge-on feet are painted by different code, and a view that stands a pixel
 * lower than the others is exactly the drift a single-row check cannot see.
 */
const ANCHOR_TOLERANCE_PX = 2;
/** How far below the soles the contact shadow legitimately reaches. */
const SHADOW_SPREAD_PX = 7;
/** Where the ground line falls inside the logical tile, measured from its top. */
const GROUND_OFFSET_IN_TILE = 0.5 + GROUND_Y;
/** The collapse's last frame, where he is finally lying down. */
const COLLAPSE_SETTLED_FRAME = 9;

/**
 * The painter's own horizontal origin: it centres every pose on the middle of
 * the cell, so the tile's left edge is half a tile to the left of that.
 */
function paintedTileX(def: FigureDef): number {
  return def.frameWidth / 2 - TILE_SCALE / 2;
}

function gateAnchor(): void {
  let stagesMeasured = 0;
  // The horizontal half of the anchor, which the vertical clauses below cannot
  // see: the painter puts the middle of the cell on the middle of the tile,
  // while the blit subtracts `tileX` to place the tile's left edge. A `tileX`
  // that stops agreeing with the painter's arithmetic draws him standing beside
  // his own tile, and every pixel measurement in this file still passes because
  // the art moved with the cell it is measured in.
  for (const stage of stageOrder()) {
    const def = figureOf(stage);
    stagesMeasured++;
    const expected = paintedTileX(def);
    if (def.tileX !== expected) {
      fail(
        'G2',
        `${stage} anchors its tile at x ${def.tileX} in a ${def.frameWidth}px cell the painter ` +
          `centres its poses in, which puts the tile's left edge at ${expected} — he is drawn ` +
          `${(expected - def.tileX).toFixed(1)}px to the side of the tile he stands on`,
      );
    }
  }
  failUnlessMeasured('G2', stagesMeasured, 'horizontal anchors');

  let samplesMeasured = 0;
  for (const stage of stageOrder()) {
    const def = figureOf(stage);
    const groundY = def.tileY + TILE_SCALE * GROUND_OFFSET_IN_TILE;
    // Frame 0 of every row, plus the *last* frame of the collapse: that row is
    // the only one whose settled pose is at its end, and it is the one that
    // reaches the floor. Sampled at frame 0 alone the buckle can drive his jaw
    // straight through the ground and nothing notices.
    const samples: ReadonlyArray<readonly [string, number]> = [
      ...MONGO_ROWS.map((row) => [row.name, 0] as const),
      ['collapse', COLLAPSE_SETTLED_FRAME],
    ];
    for (const [rowName, frame] of samples) {
      const box = inkBox(cellOf(def, rowName, frame));
      if (box === null) {
        fail('G2', `${stage} ${cellKey(rowName, frame)} painted nothing to anchor`);
        continue;
      }
      samplesMeasured++;
      // Signed, not absolute. The shadow allowance exists only for ink *below*
      // the soles; an absolute test spends it on the other side too and lets
      // him float a quarter of a tile above the floor everything else stands on.
      if (box.maxY < groundY - ANCHOR_TOLERANCE_PX) {
        fail(
          'G2',
          `${stage} ${cellKey(rowName, frame)}'s lowest ink is ` +
            `${(groundY - box.maxY).toFixed(1)}px *above* the tile's ground line — he is floating`,
        );
      }
      if (box.maxY > groundY + SHADOW_SPREAD_PX + ANCHOR_TOLERANCE_PX) {
        fail(
          'G2',
          `${stage} ${cellKey(rowName, frame)}'s lowest ink is ` +
            `${(box.maxY - groundY).toFixed(1)}px below the ground line (limit ` +
            `${SHADOW_SPREAD_PX + ANCHOR_TOLERANCE_PX}px) — the figure's tileY no longer ` +
            `describes where he stands`,
        );
      }
    }
  }
  failUnlessMeasured('G2', samplesMeasured, 'anchor samples');
}

/**
 * Floor under both delta gates, as a budget of fully-opaque pixels on the bake.
 *
 * Both gates are ratio tests, and a ratio against a near-zero median means
 * nothing: a head-on idle is *supposed* to sit near the threshold of visibility,
 * so its typical step is a fraction of a pixel's worth of antialiased edge and
 * any transition at all measures several times it.
 */
const SEAM_INK_BUDGET_PX = 30;

function deltaLimit(typical: number, factor: number, def: FigureDef): number {
  const floor = (SEAM_INK_BUDGET_PX * MAX_ALPHA) / (def.frameWidth * def.frameHeight);
  return Math.max(typical * factor, floor);
}

function rowSteps(def: FigureDef, row: RowSpec): number[] {
  const steps: number[] = [];
  for (let frame = 1; frame < row.frameCount; frame++) {
    steps.push(cellDelta(cellOf(def, row.name, frame - 1), cellOf(def, row.name, frame)));
  }
  return steps;
}

/**
 * G3 — loop closure. A cycle whose last frame does not lead back into its first
 * pops once per lap, which is invisible on a contact sheet and obvious in motion.
 */
/**
 * The floor a closing seam has to clear, as a multiple of the row's median
 * frame-to-frame delta in painted pixels.
 *
 * The pixel side of this gate carries the floor and not the ceiling, because a
 * cell-wide alpha difference saturates: once the silhouette has moved off
 * itself, moving further changes the number hardly at all. Every deliberate
 * break of the phase mapping — a row rewritten to cover 0.5, 0.7, 1.25 or 1.5
 * turns instead of one — leaves the seam between 0.39× and 1.15× the largest
 * in-loop step, against 1.003× for the shipped art, so no pixel ceiling can
 * separate the two. The pose-space ceiling below is where that bound lives.
 *
 * The floor does not saturate, because the defect it names drives the seam to
 * exactly zero: sampling at `frame / (frameCount - 1)` instead of
 * `frame / frameCount` makes the last frame identical to the first and spends a
 * whole frame of the cycle held still. Its denominator is the median rather than
 * the narrowest step, which a row holding two byte-identical adjacent frames
 * would collapse to zero; the shipped rows run 0.667–2.014× their median, so 0.4
 * sits well clear of the tightest of them.
 */
const LOOP_SEAM_FLOOR = 0.4;

/**
 * How much bigger the pose-space step across the seam may be than the row's
 * largest ordinary pose-space step.
 *
 * In pose space nothing saturates — the fingerprint is the rig's own numbers, so
 * a cycle that covers the wrong amount of turn moves the ratio the way the
 * defect points. The eighteen shipped loop rows close between 0.749× and 0.918×;
 * a row rewritten to cover 0.7 of a turn measures 1.161–1.308× and one covering
 * half a turn 1.117–1.689×, so 1.05 separates the art from the defect with room
 * on both sides.
 *
 * What no seam ratio in any metric can see is a row that covers *more* than one
 * turn in evenly spaced steps: the wrap from the last frame back to the first is
 * then a perfectly ordinary-looking step, and 1.25 and 1.5 turns both measure
 * *under* the shipped ratio here. That defect is caught instead by G7 and G13,
 * which read the planted foot's travel against the stride the runtime declares.
 */
const POSE_SEAM_CEILING = 1.05;

/**
 * How far the pose one frame past the end of a loop may sit from the pose the
 * loop starts on, as a share of the row's median pose-space step.
 *
 * This is the gate on the phase mapping itself, and it is the only clause here
 * that can see how much of a turn the row actually covers — the ratios above
 * bound how far the wrap *moves*, which a row covering the wrong amount of turn
 * can still satisfy. Asking the row for the frame after its last one and
 * requiring it to be the frame it started on pins the mapping exactly:
 * `frame / frameCount` lands on phase 1, which every pose function here answers
 * identically to phase 0, while `(frame * 1.5) / frameCount` lands on phase 1.5
 * and `frame / (frameCount - 1)` on phase `n/(n-1)`.
 *
 * A numerical tolerance rather than an equality: the shipped rows land within
 * 1e-15 of their own start, which is floating-point noise in a sine.
 *
 * What it cannot see: a row sampled over a whole number of turns greater than
 * one, because phase 2 and phase 0 are the same pose. That defect aliases rather
 * than pops, and G7 and G13 are what catch it on the walks.
 */
const PHASE_TURN_TOLERANCE = 1e-6;

/** The rig numbers a pose-space step is measured over. */
function poseFingerprint(pose: MongoPose): readonly number[] {
  const legs = [pose.nearLeg, pose.farLeg].flatMap((leg) => [
    leg.toeX,
    leg.lift,
    leg.meta,
    leg.roll,
    leg.sickle,
    leg.lateral,
    leg.nearness,
  ]);
  const arms = [pose.nearArm, pose.farArm].flatMap((arm) => [
    arm.upper,
    arm.fore,
    arm.spread,
    arm.lateral,
  ]);
  return [
    pose.surge,
    pose.rise,
    pose.pitch,
    pose.sway,
    pose.arch,
    pose.neckCurl,
    pose.neckReach,
    pose.headLift,
    pose.headTurn,
    pose.headTilt,
    pose.gape,
    pose.eyeOpen,
    pose.tailLift,
    pose.tailSway,
    pose.tailCurve,
    pose.breathe,
    pose.shadow,
    ...legs,
    ...arms,
  ];
}

/**
 * `time` is deliberately left out of the fingerprint: it *is* the phase, so it
 * ramps linearly across the row and would put a fixed, art-independent floor
 * under every step and under the seam.
 */
function poseDistance(a: MongoPose, b: MongoPose): number {
  const left = poseFingerprint(a);
  const right = poseFingerprint(b);
  let total = 0;
  for (let i = 0; i < left.length; i++) total += (left[i] - right[i]) ** 2;
  return Math.sqrt(total);
}

function gateLoopClosure(): void {
  let loopsMeasured = 0;
  for (const stage of stageOrder()) {
    const def = figureOf(stage);
    const prop = MONGO_STAGES[stage];
    for (const row of LOOP_ROWS) {
      const steps = rowSteps(def, row);
      if (steps.length === 0) {
        fail('G3', `${stage} ${row.name} has no consecutive frames to compare`);
        continue;
      }
      loopsMeasured++;
      const seam = cellDelta(cellOf(def, row.name, row.frameCount - 1), cellOf(def, row.name, 0));
      const typical = median(steps);
      if (seam < typical * LOOP_SEAM_FLOOR) {
        fail(
          'G3',
          `${stage} ${row.name}'s loop seam is ${seam.toFixed(2)}, only ` +
            `${(seam / typical).toFixed(2)}× its median step of ${typical.toFixed(2)} (floor ` +
            `${LOOP_SEAM_FLOOR}×) — the last frame all but repeats the first, so the cycle holds ` +
            'still for a frame instead of covering one turn',
        );
      }

      const poses = Array.from({ length: row.frameCount }, (_unused, frame) =>
        row.pose(frame, prop),
      );
      const poseSteps: number[] = [];
      for (let frame = 1; frame < poses.length; frame++) {
        poseSteps.push(poseDistance(poses[frame - 1], poses[frame]));
      }
      const largestPoseStep = Math.max(...poseSteps);
      const poseSeam = poseDistance(poses[poses.length - 1], poses[0]);
      if (largestPoseStep > 0 && poseSeam > largestPoseStep * POSE_SEAM_CEILING) {
        fail(
          'G3',
          `${stage} ${row.name} does not close in pose space: the wrap moves the rig ` +
            `${(poseSeam / largestPoseStep).toFixed(2)}× as far as its largest ordinary step ` +
            `(ceiling ${POSE_SEAM_CEILING}×) — it pops once per lap`,
        );
      }
      const poseTypical = median(poseSteps);
      const pastTheEnd = poseDistance(row.pose(row.frameCount, prop), poses[0]);
      if (poseTypical > 0 && pastTheEnd > poseTypical * PHASE_TURN_TOLERANCE) {
        fail(
          'G3',
          `${stage} ${row.name}: the frame after the last one is ` +
            `${(pastTheEnd / poseTypical).toExponential(2)}× a median step away from the frame ` +
            `the row starts on, so the ${row.frameCount} frames do not cover exactly one turn of ` +
            'the cycle',
        );
      }
    }
  }
  failUnlessMeasured('G3', loopsMeasured, 'looping rows');
}

/**
 * G4 — motion continuity. A snapped knee, a mid-swing draw-order flip or an IK
 * clamp all show up as one consecutive-frame delta far above its neighbours.
 *
 * One-shots get a looser factor than loops on purpose: an attack is *supposed*
 * to have a fastest moment, and holding a strike to a walk's evenness would
 * force out the acceleration that makes it read as a strike.
 */
const LOOP_CONTINUITY_LIMIT = 2.4;
const ONE_SHOT_CONTINUITY_LIMIT = 4.2;

function gateContinuity(): void {
  let stepsMeasured = 0;
  for (const stage of stageOrder()) {
    const def = figureOf(stage);
    for (const row of MONGO_ROWS) {
      const steps = rowSteps(def, row);
      const typical = median(steps);
      const factor = row.kind === 'loop' ? LOOP_CONTINUITY_LIMIT : ONE_SHOT_CONTINUITY_LIMIT;
      const limit = deltaLimit(typical, factor, def);
      steps.forEach((step, index) => {
        stepsMeasured++;
        if (step > limit) {
          fail(
            'G4',
            `${stage} ${row.name} jumps ${step.toFixed(2)} between frames ${index} and ` +
              `${index + 1}, against a median step of ${typical.toFixed(2)} (limit ` +
              `${limit.toFixed(2)})`,
          );
        }
      });
    }
  }
  failUnlessMeasured('G4', stepsMeasured, 'frame-to-frame steps');
}

/**
 * G5 — centroid drift. A walk cycle is drawn in place: the body must end the lap
 * where it started it, or he moonwalks along his own path.
 */
const CENTROID_DRIFT_LIMIT_PX = 1.5;
/** A seam step may be this much larger than a typical one before it reads. */
const CENTROID_SEAM_SHARE = 2;
/** How much larger than the largest in-loop centroid step a closing seam may be. */
const CENTROID_SEAM_OVER_LARGEST_STEP = 1.2;

function gateCentroidDrift(): void {
  let loopsMeasured = 0;
  for (const stage of stageOrder()) {
    const def = figureOf(stage);
    for (const row of LOOP_ROWS) {
      const centroids: Point[] = [];
      let missing = false;
      for (let frame = 0; frame < row.frameCount; frame++) {
        const centroid = inkCentroid(cellOf(def, row.name, frame));
        if (centroid === null) {
          fail('G5', `${stage} ${cellKey(row.name, frame)} holds no ink to find a centroid in`);
          missing = true;
          break;
        }
        centroids.push(centroid);
      }
      if (missing) continue;
      if (centroids.length < 2) {
        // Dropped silently, this would take the row out of the count before the
        // minimum-sample guard could notice it had gone.
        fail('G5', `${stage} ${row.name} is a looping row with fewer than two frames`);
        continue;
      }
      loopsMeasured++;
      const steps: number[] = [];
      for (let i = 1; i < centroids.length; i++) {
        steps.push(
          Math.hypot(centroids[i].x - centroids[i - 1].x, centroids[i].y - centroids[i - 1].y),
        );
      }
      const first = centroids[0];
      const last = centroids[centroids.length - 1];
      const seam = Math.hypot(first.x - last.x, first.y - last.y);
      // Against the largest in-loop step as well: a cycle driven by a sine
      // sampled at eight points has steps that alternate large and small, so its
      // median is the small one and a seam that closes perfectly still measures
      // over twice it.
      const limit = Math.max(
        CENTROID_DRIFT_LIMIT_PX,
        median(steps) * CENTROID_SEAM_SHARE,
        Math.max(...steps) * CENTROID_SEAM_OVER_LARGEST_STEP,
      );
      if (seam > limit) {
        fail(
          'G5',
          `${stage} ${row.name}'s ink centroid steps ${seam.toFixed(2)}px across the loop seam, ` +
            `against a largest in-loop step of ${Math.max(...steps).toFixed(2)}px and a limit of ` +
            `${limit.toFixed(2)}px`,
        );
      }
    }
  }
  failUnlessMeasured('G5', loopsMeasured, 'looping rows');
}

/**
 * G-FEATHER — the three pink display zones.
 *
 * Pink appears in exactly three places: the head crest, the forearms and the
 * tail fan. It is an invariant, not a decoration: a frame that loses one has
 * lost the thing that separates Mongo from any other blue lizard, and a pose
 * change that hides the crest behind the body is invisible on a contact sheet
 * scrolled past at speed.
 */
const PINK_MIN_RED = 170;
const PINK_RED_OVER_GREEN = 45;
/**
 * How much pink a zone must hold, as a share of the frame's own ink.
 *
 * A share rather than a flat count: the juvenile's cell is a third of the
 * adult's area, so an absolute floor either passes an adult whose crest has
 * vanished or fails a chick whose crest is perfectly visible.
 */
const PINK_MIN_SHARE = 0.006;
/** …with a hard floor, so a frame that draws almost nothing cannot pass by default. */
const PINK_MIN_PIXELS = 8;
/**
 * The band the crest has to appear in, as a share of the frame's ink height.
 *
 * Tight enough to be the head and nothing else. At half the ink box the tail —
 * which sweeps out at hip height in profile and above the hips axially — can
 * satisfy the check on its own, and a gate a second pink zone can pass for the
 * first proves nothing about either.
 */
const CREST_BAND_SHARE = 0.3;
/** And, in profile, the tail fan in the trailing third. */
const TAIL_BAND_SHARE = 0.3;
/** How far from the skull's centre the crest may sit and still count. */
const CREST_BAND_PX = 26;

function isPink(cell: Cell, x: number, y: number): boolean {
  const at = (y * cell.width + x) * CHANNELS;
  if (cell.pixels[at + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) return false;
  const red = cell.pixels[at];
  const green = cell.pixels[at + 1];
  const blue = cell.pixels[at + 2];
  return red >= PINK_MIN_RED && red - green >= PINK_RED_OVER_GREEN && blue > green;
}

/**
 * Where in the cell the skull is, in pixels — for the profile rows, where
 * `measureHead` is exact.
 *
 * The painter scales about the ground line, so the same transform has to be
 * applied here or a stage's crest lands nowhere near where this thinks it is.
 */
function headPixelY(stage: MongoStage, row: RowSpec, frame: number, def: FigureDef): number {
  const prop = MONGO_STAGES[stage];
  const head = measureHead(row.pose(frame, prop), prop);
  const originY = def.tileY + TILE_SCALE / 2;
  return originY + TILE_SCALE * (GROUND_Y + (head.y - GROUND_Y) * prop.scale);
}

function gateFeathers(): void {
  let framesMeasured = 0;
  for (const stage of stageOrder()) {
    const def = figureOf(stage);
    for (const row of MONGO_ROWS) {
      for (let frame = 0; frame < row.frameCount; frame++) {
        const cell = cellOf(def, row.name, frame);
        const box = inkBox(cell);
        if (box === null) {
          fail('G-FEATHER', `${stage} ${cellKey(row.name, frame)} holds no ink at all`);
          continue;
        }
        framesMeasured++;
        let ink = 0;
        let total = 0;
        let inCrestBand = 0;
        let inTailBand = 0;
        // Anchored on the skull itself in profile, where its position is known
        // exactly. A band measured off the ink box instead fails the collapse —
        // where the head is *supposed* to be the lowest thing on the animal —
        // and, in the axial views, can be satisfied by the tail.
        const crestFloor =
          row.view === 'side' ? headPixelY(stage, row, frame, def) - CREST_BAND_PX : box.minY;
        const crestLimit =
          row.view === 'side'
            ? headPixelY(stage, row, frame, def) + CREST_BAND_PX
            : box.minY + (box.maxY - box.minY) * CREST_BAND_SHARE;
        // The profile art always faces +X, so the tail is always the left third.
        const tailLimit = box.minX + (box.maxX - box.minX) * TAIL_BAND_SHARE;
        for (let y = box.minY; y <= box.maxY; y++) {
          for (let x = box.minX; x <= box.maxX; x++) {
            if (alphaAt(cell, x, y) >= INK_ALPHA_THRESHOLD) ink++;
            if (!isPink(cell, x, y)) continue;
            total++;
            if (y <= crestLimit && y >= crestFloor) inCrestBand++;
            if (x <= tailLimit) inTailBand++;
          }
        }
        const where = `${stage} ${cellKey(row.name, frame)}`;
        const floor = Math.max(PINK_MIN_PIXELS, Math.round(ink * PINK_MIN_SHARE));
        if (total < floor) {
          fail(
            'G-FEATHER',
            `${where} holds ${total} pink pixels against a floor of ${floor} — the display ` +
              `feathers have gone missing`,
          );
        }
        if (inCrestBand < floor) {
          fail(
            'G-FEATHER',
            `${where} has ${inCrestBand} pink pixels in its crest band against a floor of ` +
              `${floor} — the head crest is hidden`,
          );
        }
        if (row.view === 'side' && inTailBand < floor) {
          fail(
            'G-FEATHER',
            `${where} has ${inTailBand} pink pixels in its trailing ` +
              `${(TAIL_BAND_SHARE * 100).toFixed(0)}% against a floor of ${floor} — the tail fan ` +
              `is hidden`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G-FEATHER', framesMeasured, 'painted frames');
}

/**
 * G-CLAW — the keratin claws are actually painted.
 *
 * G-ARC traces a *pose* point, so it is perfectly happy with a claw that exists
 * in the rig and is never drawn — which is how the sickle claw shipped invisible
 * once already. This one counts pixels.
 *
 * What counts as claw keratin: a warm mid-tone where green leads blue. The
 * `green > blue` term is what keeps the pink display feathers out — they are
 * every bit as bright and every bit as red, and without it a frame could satisfy
 * a claw gate with a crest. The red-over-blue floor keeps the (cooler, paler)
 * teeth out, so a bite frame cannot pass on its tooth row either.
 */
const KERATIN_MIN_RED = 160;
const KERATIN_RED_OVER_BLUE = 24;
/**
 * How much keratin a frame must hold, as a share of its own ink, with a hard
 * floor under it — a share for the same reason G-FEATHER uses one.
 */
const KERATIN_MIN_SHARE = 0.0015;
const KERATIN_MIN_PIXELS = 2;

/**
 * The one row the claw gate cannot police: he is lying down with his legs
 * folded under him, and a killing claw hidden under a collapsed body is the
 * correct picture rather than a missing one.
 */
const CLAW_EXEMPT_ROW = 'collapse';

function isKeratin(cell: Cell, x: number, y: number): boolean {
  const at = (y * cell.width + x) * CHANNELS;
  if (cell.pixels[at + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) return false;
  const red = cell.pixels[at];
  const green = cell.pixels[at + 1];
  const blue = cell.pixels[at + 2];
  return red >= KERATIN_MIN_RED && green > blue && red - blue >= KERATIN_RED_OVER_BLUE;
}

function gateClaws(): void {
  let framesMeasured = 0;
  for (const stage of stageOrder()) {
    const def = figureOf(stage);
    for (const row of MONGO_ROWS) {
      if (row.name === CLAW_EXEMPT_ROW) continue;
      for (let frame = 0; frame < row.frameCount; frame++) {
        const cell = cellOf(def, row.name, frame);
        const box = inkBox(cell);
        if (box === null) {
          fail('G-CLAW', `${stage} ${cellKey(row.name, frame)} holds no ink at all`);
          continue;
        }
        framesMeasured++;
        let ink = 0;
        let keratin = 0;
        for (let y = box.minY; y <= box.maxY; y++) {
          for (let x = box.minX; x <= box.maxX; x++) {
            if (alphaAt(cell, x, y) >= INK_ALPHA_THRESHOLD) ink++;
            if (isKeratin(cell, x, y)) keratin++;
          }
        }
        const floor = Math.max(KERATIN_MIN_PIXELS, Math.round(ink * KERATIN_MIN_SHARE));
        if (keratin < floor) {
          fail(
            'G-CLAW',
            `${stage} ${cellKey(row.name, frame)} paints ${keratin} keratin pixels against a ` +
              `floor of ${floor} — the sickle claw is the single most diagnostic thing a ` +
              `dromaeosaur silhouette has, and this frame has not drawn one`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G-CLAW', framesMeasured, 'painted frames');
}

// ── Frozen measurements ──────────────────────────────────────────────────────

const RUNTIME_SPRITE_PATH = 'src/sprites/mongoSprite.ts';
/** The attack rows take their counts from here, so G10 has to resolve into it too. */
const RUNTIME_TIMING_PATH = 'src/sprites/mongoAttackTiming.ts';

function runtimeSource(): string {
  return readFileSync(resolve(RUNTIME_SPRITE_PATH), 'utf8');
}

function declaredRecord(source: string, name: string, stage: MongoStage): number | null {
  const block = new RegExp(`${name}[^{]*\\{([^}]*)\\}`).exec(source);
  if (block === null) {
    fail('G-FROZEN', `${RUNTIME_SPRITE_PATH} no longer declares ${name}`);
    return null;
  }
  const entry = new RegExp(`${stage}\\s*:\\s*([\\d.]+)`).exec(block[1]);
  if (entry === null) {
    fail('G-FROZEN', `${name} has no ${stage} entry`);
    return null;
  }
  return Number(entry[1]);
}

/**
 * G-CLEARANCE — the health-bar lift.
 *
 * A redraw moves how far his art stands above his tile, and the runtime lifts
 * his health bar by a declared number that nothing else can check. Left stale,
 * the bar is simply painted across his back forever. Nothing can measure ink at
 * runtime, so the number is frozen in the sprite module and re-measured here on
 * every render.
 */
const CLEARANCE_TOLERANCE_TILES = 0.05;

function gateHeadClearance(source: string): void {
  let stagesMeasured = 0;
  for (const stage of stageOrder()) {
    const def = figureOf(stage);
    // Measured off the standing profile idle, which is the pose the health bar
    // is read against — not off the pounce, which leaves the ground.
    const box = inkBox(cellOf(def, 'idle_side', 0));
    if (box === null) {
      fail('G-CLEARANCE', `${stage} idle_side[0] holds no ink to measure`);
      continue;
    }
    const declared = declaredRecord(source, 'MONGO_HEAD_CLEARANCE_TILES', stage);
    if (declared === null) continue;
    stagesMeasured++;
    // Clamped at zero: a stage whose art fits inside its own tile needs no lift
    // at all, and a negative one would push the bar down into his back.
    const measured = Math.max(0, (def.tileY - box.minY) / TILE_SCALE);
    if (Math.abs(declared - measured) > CLEARANCE_TOLERANCE_TILES) {
      fail(
        'G-CLEARANCE',
        `${RUNTIME_SPRITE_PATH} lifts the ${stage} health bar by ${declared} tiles, but his ` +
          `standing art reaches ${measured.toFixed(3)} tiles above his tile (tolerance ` +
          `${CLEARANCE_TOLERANCE_TILES})`,
      );
    }
    console.log(`  G-CLEARANCE ${stage}: art reaches ${measured.toFixed(3)} tiles above the tile`);
  }
  failUnlessMeasured('G-CLEARANCE', stagesMeasured, 'growth stages');
}

const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/**
 * The hard ceiling for one warm animation row.
 *
 * The sheets these figures replaced had a stated whole-texture budget. A painted
 * figure is admitted to the cache a row at a time, so the number that decides
 * whether it fits is the widest row's warm bytes rather than the sum of all of
 * them — and it has to stay well inside the cache's own per-figure ceiling so
 * that a second row can be warm at the same time.
 */
const ROW_BUDGET_MEGABYTES = 3;

/**
 * G-WARM-ROW — the widest warm row's memory, per stage, reported whether or not
 * it passes. Quiet memory growth is the failure mode nobody goes looking for.
 */
function gateWarmRowSize(): void {
  let statesMeasured = 0;
  for (const stage of stageOrder()) {
    const def = figureOf(stage);
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
    if (widestState === '') continue;
    const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
    const allWarmMegabytes = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
    console.log(
      `  G-WARM-ROW ${stage}: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
        `${ROW_BUDGET_MEGABYTES} MB budget; every state warm at once would be ` +
        `${allWarmMegabytes.toFixed(2)} MB`,
    );
    if (megabytes > ROW_BUDGET_MEGABYTES) {
      fail(
        'G-WARM-ROW',
        `${stage} ${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
          `${ROW_BUDGET_MEGABYTES} MB`,
      );
    }
  }
  failUnlessMeasured('G-WARM-ROW', statesMeasured, 'declared states');
}

/**
 * G-STAGE-SCALE — the growth read.
 *
 * Each stage's cell was measured independently, so nothing structurally stops a
 * tuning pass from making the adolescent taller than the adult. Growing up has
 * to be visible at a glance or the whole level-5 and level-10 payoff evaporates.
 */
const STAGE_GROWTH_MIN = 1.15;
const STAGE_GROWTH_MAX = 2.1;

function gateStageScale(): void {
  const heights = new Map<MongoStage, number>();
  for (const stage of stageOrder()) {
    const box = inkBox(cellOf(figureOf(stage), 'idle_side', 0));
    if (box === null) {
      fail('G-STAGE-SCALE', `${stage} idle_side[0] holds no ink to measure`);
      continue;
    }
    heights.set(stage, box.maxY - box.minY);
  }
  let pairsMeasured = 0;
  for (let i = 1; i < MONGO_STAGE_ORDER.length; i++) {
    const younger = MONGO_STAGE_ORDER[i - 1];
    const older = MONGO_STAGE_ORDER[i];
    const before = heights.get(younger);
    const after = heights.get(older);
    if (before === undefined || after === undefined) {
      fail('G-STAGE-SCALE', `no standing height for ${younger} or ${older}`);
      continue;
    }
    pairsMeasured++;
    const ratio = after / before;
    if (ratio < STAGE_GROWTH_MIN || ratio > STAGE_GROWTH_MAX) {
      fail(
        'G-STAGE-SCALE',
        `the ${older} stands ${ratio.toFixed(2)}× the ${younger}, outside the ` +
          `${STAGE_GROWTH_MIN}–${STAGE_GROWTH_MAX} band the growth has to read within`,
      );
    }
    console.log(
      `  G-STAGE-SCALE: ${older} is ${ratio.toFixed(2)}× the ${younger}'s standing height`,
    );
  }
  failUnlessMeasured('G-STAGE-SCALE', pairsMeasured, 'consecutive stage pairs');
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

/**
 * G10 — timing table. The row names and frame counts the runtime expects have to
 * match the ones painted here; a row added in one place only is a blank
 * animation.
 */
const EXPECTED_ROWS: ReadonlyArray<readonly [string, number]> = [
  ['idle', 8],
  ['idle_side', 8],
  ['idle_away', 8],
  ['walk', 8],
  ['walk_side', 8],
  ['walk_away', 8],
  ['bite', 10],
  ['bite_side', 10],
  ['bite_away', 10],
  ['slash', 10],
  ['slash_side', 10],
  ['slash_away', 10],
  ['pounce', 14],
  ['pounce_side', 14],
  ['pounce_away', 14],
  ['collapse', 10],
];

function gateTimingTable(source: string): void {
  if (MONGO_ROWS.length !== EXPECTED_ROWS.length) {
    fail('G10', `the figure has ${MONGO_ROWS.length} rows against ${EXPECTED_ROWS.length}`);
  }
  // Walked over whichever table is shorter, with the length mismatch above as
  // the thing that reports the rows the walk could not reach. An index guard
  // here instead would be a comparison the type system can already decide, so it
  // would read as a check and never be one.
  const paired = Math.min(MONGO_ROWS.length, EXPECTED_ROWS.length);
  let rowsMeasured = 0;
  for (let index = 0; index < paired; index++) {
    const row = MONGO_ROWS[index];
    const [name, frameCount] = EXPECTED_ROWS[index];
    rowsMeasured++;
    if (row.name !== name || row.frameCount !== frameCount) {
      fail('G10', `row ${index} is ${row.name}×${row.frameCount}, expected ${name}×${frameCount}`);
    }
  }
  failUnlessMeasured('G10', rowsMeasured, 'declared rows');

  // The runtime keeps its own copy of the frame counts, and a row that is one
  // frame longer there than here plays a frozen cell at the end of every swing.
  const timingSource = readFileSync(resolve(RUNTIME_TIMING_PATH), 'utf8');
  for (const row of MONGO_ROWS) {
    const declared = runtimeFrameCount(source + timingSource, row.name);
    if (declared === null) continue;
    if (declared !== row.frameCount) {
      fail(
        'G10',
        `${RUNTIME_SPRITE_PATH} says ${row.name} has ${declared} frames, the figure paints ` +
          `${row.frameCount}`,
      );
    }
  }
}

/**
 * Reads one row's frame count out of the runtime's `FRAME_COUNT` map.
 *
 * Resolves through a named constant when the entry is one, because every entry
 * is now — and fails when it cannot resolve at all. A version that skipped
 * silently on no-match would be worth nothing: the day the last numeric literal
 * in that map became a constant, the whole check would quietly stop running and
 * say so to no one.
 */
function runtimeFrameCount(source: string, rowName: string): number | null {
  const entry = new RegExp(`\\b${rowName}\\s*:\\s*([A-Za-z0-9_]+)\\s*,`).exec(source);
  if (entry === null) {
    fail('G10', `${RUNTIME_SPRITE_PATH} declares no frame count for ${rowName}`);
    return null;
  }
  const value = entry[1];
  if (/^\d+$/.test(value)) return Number(value);
  const constant = new RegExp(`\\b${value}\\s*=\\s*(\\d+)`).exec(source);
  if (constant === null) {
    fail(
      'G10',
      `${rowName}'s frame count is ${value}, which is not a number and is defined in neither ` +
        `${RUNTIME_SPRITE_PATH} nor ${RUNTIME_TIMING_PATH}`,
    );
    return null;
  }
  return Number(constant[1]);
}

/**
 * G6 — reach headroom. Hip→ankle must stay inside the thigh and shank's combined
 * span on *every* frame. One clamped frame locks the leg straight, the next tuck
 * snaps it back, and the result reads as a hop rather than as a walk.
 */
const REACH_HEADROOM = 0.004;

function gateReachHeadroom(): void {
  let worst = 0;
  let worstAt = '';
  let worstLimit = Infinity;
  let legsMeasured = 0;
  for (const { stage, prop, row, frame, pose } of poseStream()) {
    if (row.view !== 'side') continue;
    const limit = legReach(prop);
    const legs = measureLegs(pose, prop);
    for (const [side, leg] of Object.entries(legs)) {
      legsMeasured++;
      const share = leg.hipToAnkle / limit;
      if (share > worst / (worstLimit === Infinity ? 1 : worstLimit)) {
        worst = leg.hipToAnkle;
        worstLimit = limit;
        worstAt = `${stage} ${cellKey(row.name, frame)} ${side}`;
      }
    }
  }
  failUnlessMeasured('G6', legsMeasured, 'profile legs');
  if (legsMeasured === 0) return;
  if (worst > worstLimit - REACH_HEADROOM) {
    fail(
      'G6',
      `${worstAt} asks the leg to span ${worst.toFixed(4)} against a reach of ` +
        `${worstLimit.toFixed(4)} — shorten the stride or drop the pelvis further at contact`,
    );
  }
  console.log(
    `  G6 reach headroom: worst frame spans ${worst.toFixed(4)} of ${worstLimit.toFixed(4)} ` +
      `(${worstAt})`,
  );
}

/**
 * G7 — foot slide. The classic moonwalk.
 *
 * A planted foot slides backward under the body at a *constant* rate — that is
 * what "the body travels over it" means — so any easing on stance is a skate
 * however monotonic it stays.
 *
 * Returns the ground one full cycle covers, in tiles, so G13 can check the
 * runtime against something measured rather than against a formula.
 */
const PLANTED_EPSILON = 1e-9;
const SLIDE_RATE_TOLERANCE = 1e-9;

function gateFootSlide(stage: MongoStage): number | null {
  const prop = MONGO_STAGES[stage];
  const walk = MONGO_ROWS.find((row) => row.name === 'walk_side');
  if (walk === undefined) {
    fail('G7', 'there is no walk_side row to check');
    return null;
  }

  const slides: number[] = [];
  let plantedFrames = 0;
  for (const side of ['near', 'far'] as const) {
    // Stance comes from the phase, not from the foot's height: once the toes
    // roll at push-off, height no longer distinguishes stance from swing.
    const phaseOffset = side === 'near' ? 0 : CONTRALATERAL_PHASE;
    let previous: { x: number; frame: number } | null = null;
    for (let frame = 0; frame < walk.frameCount; frame++) {
      const cycle = (((frame / walk.frameCount + phaseOffset) % 1) + 1) % 1;
      const pose = walk.pose(frame, prop);
      const foot = side === 'near' ? pose.nearLeg : pose.farLeg;
      if (cycle >= STANCE_FRACTION) {
        previous = null;
        continue;
      }
      plantedFrames++;
      if (foot.lift !== 0) {
        fail(
          'G7',
          `the ${side} foot is ${foot.lift.toFixed(4)} off the floor while its phase says it is ` +
            `planted, on ${stage} walk_side frame ${frame}`,
        );
      }
      if (previous !== null && foot.toeX >= previous.x - PLANTED_EPSILON) {
        fail(
          'G7',
          `the ${side} foot slides forward while planted on ${stage} — x went from ` +
            `${previous.x.toFixed(4)} on frame ${previous.frame} to ${foot.toeX.toFixed(4)} on ` +
            `frame ${frame}`,
        );
      }
      if (previous !== null) slides.push(previous.x - foot.toeX);
      previous = { x: foot.toeX, frame };
    }
  }

  failUnlessMeasured('G7', plantedFrames, `planted ${stage} walk frames`);
  if (slides.length === 0) {
    fail('G7', `no consecutive pair of ${stage} walk_side frames plants the same foot`);
    return null;
  }
  const slowest = Math.min(...slides);
  const fastest = Math.max(...slides);
  if (fastest - slowest > SLIDE_RATE_TOLERANCE) {
    fail(
      'G7',
      `the planted foot slides unevenly on ${stage} — between ${slowest.toFixed(6)} and ` +
        `${fastest.toFixed(6)} per frame (limit ${SLIDE_RATE_TOLERANCE})`,
    );
  }
  // The rate, not the span: the last instant of stance falls between two frames
  // and is never drawn, so measuring the sampled span comes up a frame short.
  return fastest * walk.frameCount * prop.scale;
}

/**
 * G8 — both feet never leave the floor. He walks; he does not hop, so every frame
 * of a walk or an idle has at least one foot in contact. The attacks are exempt:
 * the pounce is a leap, and being airborne is the whole point of it.
 */
const GROUNDED_ROWS = new Set(['idle', 'idle_side', 'idle_away', 'walk', 'walk_side', 'walk_away']);

function gateGroundContact(): void {
  let framesMeasured = 0;
  for (const { stage, row, frame, pose } of poseStream()) {
    if (!GROUNDED_ROWS.has(row.name)) continue;
    framesMeasured++;
    const lowest = Math.min(pose.nearLeg.lift, pose.farLeg.lift);
    if (lowest > 0) {
      fail(
        'G8',
        `${stage} ${cellKey(row.name, frame)} has both feet off the floor (nearest contact ` +
          `${lowest.toFixed(4)} above it)`,
      );
    }
  }
  failUnlessMeasured('G8', framesMeasured, 'grounded-row frames');
}

/**
 * G9 — the digitigrade stack, which is the single most diagnostic thing about a
 * dromaeosaur leg and the thing a sign flip destroys silently.
 *
 * Edge-on: the knee has to sit *forward* of the hip→ankle line, and the ankle —
 * the high "reverse joint" that is really a heel — has to sit *behind* and
 * *above* the toes. Head-on that first test is meaningless, so what is policed
 * there is the metatarsus angle itself, which is what puts the ankle up off the
 * floor in the first place.
 */
const MIN_META_ANGLE = 0.1;
const MAX_META_ANGLE = Math.PI / 2 - 0.05;

function gateDigitigrade(): void {
  let legsMeasured = 0;
  let profileLegsMeasured = 0;
  for (const { stage, prop, row, frame, pose } of poseStream()) {
    const where = `${stage} ${cellKey(row.name, frame)}`;
    for (const [side, leg] of Object.entries({ near: pose.nearLeg, far: pose.farLeg })) {
      legsMeasured++;
      if (leg.meta < MIN_META_ANGLE || leg.meta > MAX_META_ANGLE) {
        fail(
          'G9',
          `${where}'s ${side} metatarsus is at ${leg.meta.toFixed(3)} rad, outside ` +
            `(${MIN_META_ANGLE}, ${MAX_META_ANGLE.toFixed(3)}) — the ankle is either on the ` +
            `floor or directly over the toes, and either way the leg stops reading as ` +
            `digitigrade`,
        );
      }
    }
    if (row.view !== 'side') continue;
    const legs = measureLegs(pose, prop);
    for (const [side, leg] of Object.entries(legs)) {
      profileLegsMeasured++;
      if (leg.ankle.x >= leg.toeTip.x) {
        fail(
          'G9',
          `${where}'s ${side} ankle is not behind its toes (ankle x ${leg.ankle.x.toFixed(4)}, ` +
            `toe x ${leg.toeTip.x.toFixed(4)})`,
        );
      }
      if (leg.ankle.y >= leg.toeTip.y) {
        fail('G9', `${where}'s ${side} ankle is not above its toes`);
      }
      // Signed area of hip→ankle against hip→knee. Facing +X with +Y down, a
      // knee forward of that line gives a negative cross product.
      const ankle = { x: leg.ankle.x - leg.hip.x, y: leg.ankle.y - leg.hip.y };
      const knee = { x: leg.knee.x - leg.hip.x, y: leg.knee.y - leg.hip.y };
      const cross = ankle.x * knee.y - ankle.y * knee.x;
      if (cross >= 0) {
        fail(
          'G9',
          `${where}'s ${side} knee sits behind the hip→ankle line (cross ${cross.toFixed(5)}) — ` +
            `the leg has hinged backward`,
        );
      }
    }
  }
  failUnlessMeasured('G9', legsMeasured, 'legs');
  failUnlessMeasured('G9', profileLegsMeasured, 'profile legs');
}

/**
 * G-HEADLEVEL — avian head stabilisation.
 *
 * A walking bird's body bobs while its head holds a fixed height. It is the one
 * trait that sells "this is a real animal" harder than anything else in the
 * walk, and it is invisible on a contact sheet — every frame looks fine, and the
 * head simply bounces in motion.
 *
 * The body's own bob is measured too: a head that is level because *nothing*
 * moves would otherwise pass. Pinning the head to a constant height also passes
 * trivially and looks like a skull glued in mid-air while the body slides under
 * it; what the trait actually is, is a head that moves *far less* than the body.
 */
const HEAD_SWING_MAX_SHARE = 0.4;
/** And a floor, so a head that holds still because nothing moves cannot pass. */
const MIN_BODY_BOB = 0.02;

function gateHeadLevel(): void {
  const stabilised = ['walk_side', 'idle_side'];
  let rowsMeasured = 0;
  for (const stage of stageOrder()) {
    const prop = MONGO_STAGES[stage];
    for (const name of stabilised) {
      const row = MONGO_ROWS.find((candidate) => candidate.name === name);
      if (row === undefined) {
        fail('G-HEADLEVEL', `there is no ${name} row`);
        continue;
      }
      rowsMeasured++;
      const headYs: number[] = [];
      const bodyYs: number[] = [];
      for (let frame = 0; frame < row.frameCount; frame++) {
        const pose = row.pose(frame, prop);
        headYs.push(measureHead(pose, prop).y);
        bodyYs.push(pose.rise);
      }
      const headSwing = Math.max(...headYs) - Math.min(...headYs);
      const bodySwing = Math.max(...bodyYs) - Math.min(...bodyYs);
      if (headSwing > bodySwing * HEAD_SWING_MAX_SHARE) {
        fail(
          'G-HEADLEVEL',
          `${stage} ${name}'s head moves ${headSwing.toFixed(5)} vertically against a body bob ` +
            `of ${bodySwing.toFixed(5)} — over the ${HEAD_SWING_MAX_SHARE} share the ` +
            `stabilisation is supposed to hold it to`,
        );
      }
      if (bodySwing < MIN_BODY_BOB) {
        fail(
          'G-HEADLEVEL',
          `${stage} ${name}'s body only bobs ${bodySwing.toFixed(5)} (floor ${MIN_BODY_BOB}) — ` +
            `the head is level because nothing is moving, which proves nothing`,
        );
      }
    }
  }
  failUnlessMeasured('G-HEADLEVEL', rowsMeasured, 'stabilised rows');
}

/**
 * G-ARC — claw-tip arcs.
 *
 * A believable swing is a smooth arc; a cornered or teleporting one is a rig
 * bug, and it is the single thing about an attack that a still cannot show. The
 * hand claw traces the rake and the foot's sickle claw traces the pounce.
 */
const ARC_STEP_LIMIT = 3.2;

function gateArcs(): void {
  let arcsMeasured = 0;
  for (const stage of stageOrder()) {
    const prop = MONGO_STAGES[stage];
    const arcs: ReadonlyArray<readonly [string, (pose: MongoPose) => Pt]> = [
      ['slash_side', (pose) => measureHandClaw(pose, prop)],
      ['pounce_side', (pose) => measureFootSickle(pose, prop)],
    ];
    for (const [name, tip] of arcs) {
      const row = MONGO_ROWS.find((candidate) => candidate.name === name);
      if (row === undefined) {
        fail('G-ARC', `there is no ${name} row`);
        continue;
      }
      arcsMeasured++;
      const points: Pt[] = [];
      for (let frame = 0; frame < row.frameCount; frame++) points.push(tip(row.pose(frame, prop)));
      const steps: number[] = [];
      for (let i = 1; i < points.length; i++) {
        steps.push(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
      }
      const typical = median(steps);
      steps.forEach((step, index) => {
        if (typical > 0 && step > typical * ARC_STEP_LIMIT) {
          fail(
            'G-ARC',
            `${stage} ${name}'s claw tip jumps ${step.toFixed(4)} between frames ${index} and ` +
              `${index + 1}, against a median step of ${typical.toFixed(4)} (limit ` +
              `${(typical * ARC_STEP_LIMIT).toFixed(4)}) — the swing corners rather than arcs`,
          );
        }
      });
    }
  }
  failUnlessMeasured('G-ARC', arcsMeasured, 'claw arcs');
  console.log(`  G-ARC: ${arcsMeasured} claw arcs traced`);
}

/**
 * G13 — stride sync. `src/sprites/mongoSprite.ts` declares how much ground one
 * walk cycle covers so a caller can advance the phase by distance travelled.
 * The number is a record of the choreography and nothing can re-derive it at
 * runtime, so this reads the constant back out of the source and checks it
 * against what G7 *measured* off the planted frames — not against a
 * hand-derived formula, which agrees with itself even after the keyframes it
 * claims to describe have been edited out from under it.
 */
const STRIDE_TOLERANCE = 0.00005;

function gateStrideSync(source: string): void {
  let stagesMeasured = 0;
  for (const stage of stageOrder()) {
    const measured = gateFootSlide(stage);
    if (measured === null) continue;
    const declared = declaredRecord(source, 'MONGO_TILES_PER_WALK_CYCLE', stage);
    if (declared === null) continue;
    stagesMeasured++;
    if (Math.abs(declared - measured) > STRIDE_TOLERANCE) {
      fail(
        'G13',
        `${RUNTIME_SPRITE_PATH} says one ${stage} walk cycle covers ${declared} tiles, but the ` +
          `choreography covers ${measured.toFixed(4)} — his feet will skate until they agree`,
      );
    }
    console.log(`  G13 stride sync ${stage}: one walk cycle covers ${declared} tiles (measured)`);
  }
  failUnlessMeasured('G13', stagesMeasured, 'growth stages');
}

/**
 * G-STATES — every state name the runtime can build must be one the figures
 * paint.
 *
 * Both draw paths return silently on an unknown state, so a pose name assembled
 * by template literal that no figure paints is an invisible pet and no log line.
 */
const RUNTIME_BASES: readonly string[] = ['idle', 'walk', 'bite', 'slash', 'pounce'];
const RUNTIME_VIEW_SUFFIXES: readonly string[] = ['', '_side', '_away'];
/** The row the collapse plays, which has no head-on or from-behind view. */
const RUNTIME_SINGLETON_STATES: readonly string[] = ['collapse'];

function gateRuntimeStateNames(): void {
  const names = [
    ...RUNTIME_BASES.flatMap((base) => RUNTIME_VIEW_SUFFIXES.map((suffix) => `${base}${suffix}`)),
    ...RUNTIME_SINGLETON_STATES,
  ];
  let stagesMeasured = 0;
  for (const stage of stageOrder()) {
    stagesMeasured++;
    for (const failure of missingStateFailures(
      figureOf(stage),
      names,
      `${stage}'s runtime pose names`,
    )) {
      fail('G-STATES', failure);
    }
  }
  failUnlessMeasured('G-STATES', stagesMeasured, 'growth stages');
}

/** Runs every gate and returns one message per failure. */
/**
 * G-DISTINCT — a row paints as many pictures as it declares frames.
 *
 * His idles shipped as seven pictures for eight frames head-on and five facing
 * away, in all three growth stages, because every term of the pose rode the same
 * sine of the cycle. Putting the head scan a quarter turn ahead of the breath
 * made them eight *files* and left the profile row a duplicate anyway — the
 * quadrature term was a yaw the profile view foreshortens to nothing, so frames
 * 0 and 4 differed in eighteen pixels — which is why this measures a perceptual
 * floor rather than a hash, and why the balance shift that replaced it is spent
 * on the tail and the pelvis, which every view can see.
 */
function gateDistinctFrames(): void {
  let framesMeasured = 0;
  let worst: { readonly share: number; readonly note: string } | null = null;
  for (const stage of stageOrder()) {
    const def = figureOf(stage);
    const report = sharedDistinctFrameFailures(
      def,
      (state, frame) => cellOf(def, state, frame).pixels,
    );
    for (const message of report.failures) fail('G-DISTINCT', message);
    framesMeasured += report.framesMeasured;
    if (report.closestNote === null || report.closestShare === null) continue;
    if (worst === null || report.closestShare < worst.share) {
      worst = { share: report.closestShare, note: report.closestNote };
    }
  }
  failUnlessMeasured('G-DISTINCT', framesMeasured, 'painted frames');
  if (worst !== null) console.log(`  G-DISTINCT closest frames: ${worst.note}`);
}

export function mongoGateFailures(): string[] {
  failures.length = 0;
  const source = runtimeSource();
  gateTimingTable(source);
  gateReachHeadroom();
  gateGroundContact();
  gateDigitigrade();
  gateHeadLevel();
  gateArcs();
  gateStrideSync(source);
  gateStructure();
  gateAnchor();
  gateLoopClosure();
  gateContinuity();
  gateCentroidDrift();
  gateFeathers();
  gateClaws();
  gateHeadClearance(source);
  gateWarmRowSize();
  gateStageScale();
  gateRuntimeStateNames();
  gateDistinctFrames();
  return [...failures];
}
