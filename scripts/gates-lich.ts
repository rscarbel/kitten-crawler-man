/**
 * The Lich's art gates.
 *
 * The creature has no baked sheet to inspect any more, so every invariant the
 * old bake enforced by throwing before it wrote a PNG is enforced here instead:
 * the pose-stream gates measure the rig itself, and the pixel gates measure
 * cells painted from `LICH_FIGURE` exactly the way the runtime cache bakes them
 * — supersampled and downsampled — so what is measured is what the game blits.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing: a lookup
 * that quietly returns nothing turns a whole gate module green while measuring
 * nothing at all.
 *
 * Run by the review harness: `npm run render:lich`.
 */

import { createCanvas } from 'canvas';

import { bakeFigureCell, paintFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { asGameContext } from './nodeGameContext.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import {
  GORE_ORIGIN_X,
  GORE_ORIGIN_Y,
  GORE_RECENTRE_PX,
  GORE_STATES,
  GORE_UNIT,
  LICH_FIGURE,
  LICH_ROWS,
  RIM_RGB,
  paintGorePiece,
} from '../src/sprites/art/lichFigure.js';
import { lichLateralFor, lichLegReachHeadroom } from '../src/sprites/art/lichArt.js';
import type { SkeletonPose } from '../src/sprites/art/skeletonArt.js';
import { LICH_PREWARMED_STATES } from '../src/sprites/lichSprite.js';
import { SKELETON_GORE_PARTS } from '../src/sprites/skeletonSprite.js';

// The painter composes each pose on scratch surfaces of its own, and that path
// reaches for `document.createElement('canvas')`.
installCanvasGlobals();

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Alpha above which a pixel counts as painted, when measuring ink. */
const INK_ALPHA_THRESHOLD = 24;

const { frameWidth, frameHeight } = LICH_FIGURE;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — loop rows only, pose rows only,
 * one entry per painted piece — and a narrowing that matches nothing leaves a
 * green gate that examined nothing. Every filtering loop here counts what it
 * looked at and ends with a call to this.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── G1 the structural gates ──────────────────────────────────────────────────

/**
 * How much of the cell the widest pose must fill.
 *
 * Under the shared default, and deliberately: the cell was sized by the bake
 * this figure replaces, and its height is bought by the summon — both hands
 * thrown most of a tile over a crown that already stands 2.68 tiles up — while
 * its width is bought by the grasping-hands sweep. Every other row is a narrow
 * column of cloth inside that box. Resizing the cell is not available without
 * discarding the parity that proved the port, and G7 is what says the cells are
 * still affordable.
 */
const MIN_INK_AREA_SHARE = 0.11;

function gateStructure(): void {
  for (const failure of figureStructuralFailures(LICH_FIGURE, {
    // A loose bone is one small piece painted about the centre of a cell sized
    // for a whole figure; it is meant to be mostly empty.
    sparseStates: GORE_STATES,
    minInkAreaShare: MIN_INK_AREA_SHARE,
  })) {
    fail('G1', failure);
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
 * idle rows drive it from a *half*-frequency sine that resets at the wrap
 * rather than closing, so measuring it here would fail shipped art on an
 * authored decision this gate has no business overruling.
 */
const PHASE_TURN_TOLERANCE = 1e-6;

/**
 * What this gate cannot see: a row sampled over a whole number of turns greater
 * than one. Phase 2 and phase 0 are the same pose, so the wrap closes and the
 * steps stay even — the symptom is aliasing rather than a pop, and it belongs to
 * the continuity gates.
 */

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
 * 1.5–1.9× it; a ceiling hung off the median is therefore no bound at all, which
 * is what the 1.6× this replaces turned out to be. Measured against the largest
 * step instead, every shipped row closes between 0.331× and 1.080× (the walks
 * near 0.34, the idles just over 1.0), so 1.15 leaves room for the art and none
 * for a cycle that overshoots its turn.
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
  for (const row of LICH_ROWS) {
    if (row.kind !== 'loop') continue;
    rowsMeasured++;
    const poses: SkeletonPose[] = [];
    for (let frame = 0; frame < row.frameCount; frame++) poses.push(row.pose(frame));
    const steps: number[] = [];
    for (let frame = 0; frame < poses.length - 1; frame++) {
      steps.push(poseDistance(poses[frame], poses[frame + 1]));
    }
    if (steps.length === 0) {
      fail('G2', `${row.name}: a looping row with no consecutive frames to compare`);
      continue;
    }
    const seam = poseDistance(poses[poses.length - 1], poses[0]);
    const largest = Math.max(...steps);
    const typical = median(steps);
    if (largest > 0 && seam > largest * LOOP_SEAM_CEILING) {
      fail(
        'G2',
        `${row.name}: the loop does not close — the step across the seam is ` +
          `${(seam / largest).toFixed(2)}× the row's own largest ordinary step (ceiling ` +
          `${LOOP_SEAM_CEILING}×), which pops once per cycle`,
      );
    }
    if (typical > 0 && seam < typical * LOOP_SEAM_FLOOR) {
      fail(
        'G2',
        `${row.name}: the seam is only ${(seam / typical).toFixed(2)}× the row's median step ` +
          `(floor ${LOOP_SEAM_FLOOR}×) — the last frame all but repeats the first, so the cycle ` +
          'spends a whole frame held still instead of covering one turn',
      );
    }
    const pastTheEnd = poseDistance(row.pose(row.frameCount), poses[0]);
    if (typical > 0 && pastTheEnd > typical * PHASE_TURN_TOLERANCE) {
      fail(
        'G2',
        `${row.name}: the frame after the last one is ${(pastTheEnd / typical).toExponential(2)}× ` +
          `a median step away from the frame the row starts on, so the ${row.frameCount} frames ` +
          'do not cover exactly one turn of the cycle',
      );
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
 * Checked on every frame of every row including the one-shots: a crouch or a
 * lunge can put a foot out of reach just as easily as a stride can. The IK
 * clamps rather than throwing, so the symptom is a leg locked dead straight with
 * the foot hanging above the floor, which reads as a hop and is invisible in the
 * drawing code.
 */
function gateLegReach(): void {
  let framesMeasured = 0;
  for (const row of LICH_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      framesMeasured++;
      const headroom = lichLegReachHeadroom(row.pose(frame), lichLateralFor(row.view));
      if (headroom < MIN_LEG_REACH_HEADROOM) {
        fail(
          'G3',
          `${row.name}[${frame}]: a leg is over-extended by ` +
            `${(MIN_LEG_REACH_HEADROOM - headroom).toFixed(4)} tiles — the IK clamps and the ` +
            'foot hangs off the floor, which reads as a hop',
        );
      }
    }
  }
  failUnlessMeasured('G3', framesMeasured, 'posed frames');
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

interface FrameInk {
  readonly inkPixels: number;
  readonly rimPixels: number;
  /** Luminance at {@link SILHOUETTE_PERCENTILE} across the frame's own ink. */
  readonly brightLuma: number;
}

const LUMA_RED = 0.2126;
const LUMA_GREEN = 0.7152;
const LUMA_BLUE = 0.0722;

function lumaOf(r: number, g: number, b: number): number {
  return r * LUMA_RED + g * LUMA_GREEN + b * LUMA_BLUE;
}

/** How far a pixel's green may sit under the rim colour's and still count. */
const RIM_MATCH_TOLERANCE = 46;
const SILHOUETTE_PERCENTILE = 0.95;

function measureInk(data: Uint8ClampedArray): FrameInk {
  const lumas: number[] = [];
  let rimPixels = 0;
  for (let i = 0; i < data.length; i += CHANNELS) {
    if (data[i + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    lumas.push(lumaOf(r, g, b));
    const greenLead = g - Math.max(r, b);
    if (
      g >= RIM_RGB.g - RIM_MATCH_TOLERANCE &&
      greenLead >= RIM_RGB.g - RIM_RGB.r - RIM_MATCH_TOLERANCE
    ) {
      rimPixels++;
    }
  }
  if (lumas.length === 0) return { inkPixels: 0, rimPixels: 0, brightLuma: 0 };
  lumas.sort((a, b) => a - b);
  const index = Math.min(lumas.length - 1, Math.floor(lumas.length * SILHOUETTE_PERCENTILE));
  return { inkPixels: lumas.length, rimPixels, brightLuma: lumas[index] };
}

// ── G4 the rim light, and G5 what is left of it in play ──────────────────────

/**
 * The rim light is the silhouette, so its absence is a failure and not a style
 * note.
 *
 * Expressed as a share of the frame's *own* ink with a hard floor, never as an
 * absolute pixel count: a threshold tuned on a summon frame that fills the cell
 * would pass anything on a hunched idle, and one tuned on the idle would be
 * meaningless on the summon.
 *
 * This clause counts how *much* rim there is, not how bright it is: the colour
 * it matches on is derived from `RIM_RGB`, which is the same constant the
 * painter lays the rim in, so recolouring the edge light moves the art and the
 * test together and this stays green. G5's absolute luma floor is what catches
 * a rim that is present and too dim to be a silhouette.
 */
const MIN_RIM_INK_SHARE = 0.03;
const MIN_RIM_INK_PIXELS = 40;

/**
 * The dimmest floor this creature is fought on, and how far its brightest edge
 * has to clear that floor once the cell has been halved to the game's tile.
 *
 * A near-black figure on a dark tower floor is a smudge whatever the outline is
 * doing at 4×, and the only honest place to measure that is at the size it
 * renders. `p95` rather than the maximum: one stray bright pixel is not a
 * silhouette, and the maximum would be satisfied by the wax seal alone.
 *
 * What carries this number is the rim light, and knowing that is the point of
 * the gate rather than a flaw in it: darkening every body ramp on the figure
 * fivefold leaves the measurement untouched, because the rim is over a tenth of
 * the ink and so owns the 95th percentile outright. So this is the gate on the
 * edge light's *brightness* — a rim recoloured dim, or dilated away to nothing,
 * is what reddens it — while the body's own exposure sits below this floor by
 * design and is not something this can speak to.
 */
const DIM_FLOOR_LUMA = 58;
const MIN_SILHOUETTE_CONTRAST = 46;

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;

function gateRimLight(): void {
  const inGameWidth = Math.ceil((frameWidth * IN_GAME_TILE) / LICH_FIGURE.tileScale);
  const inGameHeight = Math.ceil((frameHeight * IN_GAME_TILE) / LICH_FIGURE.tileScale);
  const shrunk = createCanvas(inGameWidth, inGameHeight);
  const shrunkCtx = shrunk.getContext('2d');

  let worstRimShare = Infinity;
  let worstRimAt = '';
  let worstContrast = Infinity;
  let worstContrastAt = '';
  let framesMeasured = 0;

  for (const row of LICH_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      framesMeasured++;
      const cell = bakeFigureCell(LICH_FIGURE, row.name, frame);
      const full = measureInk(
        cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight).data,
      );
      const rimShare = full.rimPixels / Math.max(1, full.inkPixels);
      if (rimShare < worstRimShare) {
        worstRimShare = rimShare;
        worstRimAt = `${row.name}[${frame}]`;
      }
      if (rimShare < MIN_RIM_INK_SHARE || full.rimPixels < MIN_RIM_INK_PIXELS) {
        fail(
          'G4',
          `${row.name}[${frame}]: only ${full.rimPixels} rim pixels ` +
            `(${(rimShare * 100).toFixed(2)}% of the frame's ink, floor ` +
            `${(MIN_RIM_INK_SHARE * 100).toFixed(0)}% / ${MIN_RIM_INK_PIXELS}px) — a near-black ` +
            'figure without its edge light is a smudge on a dark floor',
        );
      }

      shrunkCtx.clearRect(0, 0, inGameWidth, inGameHeight);
      shrunkCtx.drawImage(cell, 0, 0, inGameWidth, inGameHeight);
      const small = measureInk(shrunkCtx.getImageData(0, 0, inGameWidth, inGameHeight).data);
      const contrast = small.brightLuma - DIM_FLOOR_LUMA;
      if (contrast < worstContrast) {
        worstContrast = contrast;
        worstContrastAt = `${row.name}[${frame}]`;
      }
      if (contrast < MIN_SILHOUETTE_CONTRAST) {
        fail(
          'G5',
          `${row.name}[${frame}]: at a ${IN_GAME_TILE}px tile the frame's brightest edge is ` +
            `${small.brightLuma.toFixed(1)} luma against a ${DIM_FLOOR_LUMA} floor — ` +
            `${contrast.toFixed(1)} of contrast against a ${MIN_SILHOUETTE_CONTRAST} floor. ` +
            'Fix the exposure, not the texture',
        );
      }
    }
  }
  failUnlessMeasured('G4', framesMeasured, 'painted pose frames');
  failUnlessMeasured('G5', framesMeasured, 'painted pose frames');
  console.log(
    `  G4/G5 worst rim share ${(worstRimShare * 100).toFixed(2)}% at ${worstRimAt}; ` +
      `worst in-game contrast ${worstContrast.toFixed(1)} at ${worstContrastAt}`,
  );
}

// ── G6 the loose bones the runtime spawns ────────────────────────────────────

/**
 * G6 — the figure paints exactly the pieces the gore field spawns.
 *
 * `BodyPartGoreSystem` answers a state it cannot find by spawning nothing and
 * saying nothing, so a rename on either side is a bone that silently stops
 * flying. Checked in both directions: a piece the figure paints and the runtime
 * never asks for is a cell nobody sees and memory somebody pays for.
 *
 * What this deliberately does not do is compare the figure's bone set against
 * the shared one: `lichFigure`'s `GORE_STATES` is `SKELETON_GORE_STATES`
 * itself, so a clause comparing the two is a constant compared against itself
 * and cannot fail whatever the art does. The runtime's list is the only
 * independent side there is to check against.
 */
function gateGoreParts(): void {
  const painted = new Set(GORE_STATES);
  let namesChecked = 0;
  for (const part of SKELETON_GORE_PARTS) {
    namesChecked++;
    if (!painted.has(part)) fail('G6', `the gore field spawns "${part}", which nothing paints`);
  }
  for (const state of GORE_STATES) {
    if (!SKELETON_GORE_PARTS.includes(state)) {
      fail('G6', `the figure paints "${state}", which the gore field never spawns`);
    }
  }
  failUnlessMeasured('G6', namesChecked, 'gore part names');
}

// ── G7 the warm-row budget ───────────────────────────────────────────────────

const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * What one row of this figure may cost warm, in megabytes.
 *
 * A painted figure is admitted to the cache one state at a time, so the number
 * that decides whether it fits is the widest state's bytes — not the sum over
 * every state, which only binds on a figure holding its entire declared set at
 * once. Sized well under the cache's per-figure ceiling so that a fight can hold
 * a locomotion row and an attack row in every view at the same time.
 */
const ROW_BUDGET_MEGABYTES = 4;

function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of LICH_FIGURE.states) {
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

// ── G8 the runtime's own names ───────────────────────────────────────────────

/**
 * Every pose name the sprite wrapper can build by template literal.
 *
 * Rebuilt here rather than imported, because the point of the gate is that the
 * *shape* of the names the wrapper assembles is one the figure answers: a base
 * crossed with the two suffixed views, plus the two rows that exist in one
 * facing only.
 */
const VIEWED_BASES: ReadonlyArray<string> = ['walk', 'idle', 'cast', 'hands_cast'];
const SINGLE_VIEW_STATES: ReadonlyArray<string> = ['summon', 'dazed'];

function runtimeStateNames(): string[] {
  const names: string[] = [...SINGLE_VIEW_STATES];
  for (const base of VIEWED_BASES) names.push(base, `${base}_side`, `${base}_away`);
  return names;
}

/**
 * G8 — every state name the runtime can ask for is one the figure paints.
 *
 * Both draw paths answer a name the figure does not declare by returning without
 * drawing anything and saying nothing: a whole facing of the boss, or a body
 * part, simply never appears and nothing is logged.
 */
function gateRuntimeStateNames(): void {
  for (const failure of missingStateFailures(
    LICH_FIGURE,
    runtimeStateNames(),
    'the sprite wrapper',
  )) {
    fail('G8', failure);
  }
  for (const failure of missingStateFailures(LICH_FIGURE, SKELETON_GORE_PARTS, 'the gore field')) {
    fail('G8', failure);
  }
  for (const failure of missingStateFailures(
    LICH_FIGURE,
    LICH_PREWARMED_STATES,
    'the prewarm list',
  )) {
    fail('G8', failure);
  }
  // A row the figure paints and nothing can name is memory with no caller.
  const reachable = new Set([
    ...runtimeStateNames(),
    ...SKELETON_GORE_PARTS,
    ...LICH_PREWARMED_STATES,
  ]);
  let rowsChecked = 0;
  for (const row of LICH_ROWS) {
    rowsChecked++;
    if (reachable.has(row.name)) continue;
    fail('G8', `the figure paints "${row.name}", which nothing in the runtime can name`);
  }
  failUnlessMeasured('G8', rowsChecked, 'pose rows');
}

// ── G9 the frozen gore recentring ────────────────────────────────────────────

/**
 * How far a loose bone's ink may sit from the centre of its own cell, in cell
 * pixels.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of the cell, so ink that
 * does not sit there orbits rather than tumbles. A pixel of slack: the frozen
 * nudges were computed from a rasterised bounding box measured at a different
 * canvas size, and a bounding box is a pixel-grained thing.
 */
const GORE_CENTRING_TOLERANCE_PX = 1.5;

/**
 * G9 — the frozen recentring nudges still land each bone on its cell's centre.
 *
 * The nudges are the one set of numbers in the figure that cannot be computed
 * where they are used: finding the centre of a piece's ink means painting it and
 * reading the pixels back, which nothing at runtime can do. They are frozen in
 * the figure module and their *effect* is re-measured here, off the real cell,
 * so a redrawn bone cannot silently start orbiting.
 *
 * Checked in both directions. A frozen nudge with no piece left to own it is a
 * dead entry that reads like a maintained measurement, and the next agent to add
 * a piece by that name inherits a number measured off art that is gone.
 */
function gateGoreRecentre(): void {
  const painted = new Set(GORE_STATES);
  for (const frozen of GORE_RECENTRE_PX.keys()) {
    if (painted.has(frozen)) continue;
    fail('G9', `a nudge is frozen for "${frozen}", which nothing paints any more`);
  }

  let piecesMeasured = 0;
  let worstGap = 0;
  let worstAt = '';
  for (const state of GORE_STATES) {
    piecesMeasured++;
    if (!GORE_RECENTRE_PX.has(state)) {
      fail('G9', `the figure freezes no recentring nudge for "${state}"`);
      continue;
    }
    const cell = paintFigureCell(LICH_FIGURE, state, 0);
    const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
    let minX = frameWidth;
    let maxX = -1;
    let minY = frameHeight;
    let maxY = -1;
    for (let y = 0; y < frameHeight; y++) {
      for (let x = 0; x < frameWidth; x++) {
        if (data[(y * frameWidth + x) * CHANNELS + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) {
      fail('G9', `${state} painted nothing at all into its cell`);
      continue;
    }
    const gap = Math.hypot((minX + maxX) / 2 - GORE_ORIGIN_X, (minY + maxY) / 2 - GORE_ORIGIN_Y);
    if (gap > worstGap) {
      worstGap = gap;
      worstAt = state;
    }
    if (gap > GORE_CENTRING_TOLERANCE_PX) {
      fail(
        'G9',
        `${state}'s ink centres ${gap.toFixed(2)}px from the centre of its cell, past the ` +
          `${GORE_CENTRING_TOLERANCE_PX}px it is held to — the piece will orbit rather than ` +
          'tumble; re-measure the frozen nudge',
      );
    }
  }
  failUnlessMeasured('G9', piecesMeasured, 'loose bones');
  console.log(`  G9 worst gore centring gap ${worstGap.toFixed(2)}px at ${worstAt}`);
}

// ── G10 the bones are drawn at the Lich's own size ───────────────────────────

/**
 * How many cell pixels across the longest loose bone must measure.
 *
 * The bones are the skeleton warrior's, painted at the Lich's own figure scale
 * rather than the warrior's — a whole tile of height between the two creatures —
 * so a piece that comes out the size a 1.55-tile warrior's does means the scale
 * stopped being applied. Bounded above as well: the femur inside a cell sized
 * for the figure is the thing that would say the pieces had been inflated to
 * make them legible in a review, which is the review harness's job and not the
 * art's.
 */
const MIN_LONGEST_BONE_PX = 40;
const MAX_LONGEST_BONE_PX = 110;

function gateBoneScale(): void {
  const span = 512;
  const origin = span / 2;
  const canvas = createCanvas(span, span);
  const ctx = canvas.getContext('2d');
  let longest = 0;
  let longestAt = '';
  let piecesMeasured = 0;
  for (const state of GORE_STATES) {
    piecesMeasured++;
    ctx.clearRect(0, 0, span, span);
    const art = asGameContext(ctx);
    art.save();
    art.translate(origin, origin);
    art.scale(GORE_UNIT, GORE_UNIT);
    paintGorePiece(art, state);
    art.restore();
    const { data } = ctx.getImageData(0, 0, span, span);
    let minX = span;
    let maxX = -1;
    let minY = span;
    let maxY = -1;
    for (let y = 0; y < span; y++) {
      for (let x = 0; x < span; x++) {
        if (data[(y * span + x) * CHANNELS + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) {
      fail('G10', `${state} painted nothing at all about its own origin`);
      continue;
    }
    const reach = Math.max(maxX - minX, maxY - minY);
    if (reach > longest) {
      longest = reach;
      longestAt = state;
    }
  }
  failUnlessMeasured('G10', piecesMeasured, 'loose bones');
  console.log(`  G10 longest bone ${longest.toFixed(0)}px (${longestAt})`);
  if (longest < MIN_LONGEST_BONE_PX || longest > MAX_LONGEST_BONE_PX) {
    fail(
      'G10',
      `the longest bone (${longestAt}) spans ${longest.toFixed(0)}px, outside the ` +
        `${MIN_LONGEST_BONE_PX}–${MAX_LONGEST_BONE_PX}px a 2.68-tile figure's bones belong in`,
    );
  }
}

/** Runs every gate and returns one message per failure. */
export function lichGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateLoopClosure();
  gateLegReach();
  gateRimLight();
  gateGoreParts();
  gateWarmRowSize();
  gateRuntimeStateNames();
  gateGoreRecentre();
  gateBoneScale();
  return [...failures];
}
