#!/usr/bin/env tsx
/**
 * The goblin bake's entry point: run every gate, then write the sheets.
 *
 * The gates run **before anything reaches the disk**, in the shape of
 * `assertNothingClipped` in `generate-tree-sprites.ts`. A failed gate stops the
 * bake rather than leaving a half-good sheet in the repo for someone to discover
 * three commits later.
 *
 * Pixel gates operate on the composed `ImageData`; pose gates operate on the
 * pose structs directly, which is strictly stronger — a foot that slides by
 * 0.005 tile is invisible in pixels and obvious in the pose.
 *
 * Run: npm run gen:goblins
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  COLS_PER_ROW,
  GOBLIN_ARCHETYPES,
  IMPACT_FRAMES,
  accelerationWindow,
  INK_ALPHA_THRESHOLD,
  ROWS,
  TILE_SCALE,
  ARC_TRACE_DIR,
  arcTracePath,
  bake,
  physicalRowCount,
  rowOffsets,
  sheetFileName,
  sheetPath,
  type BakedSheet,
  type GoblinArchetype,
  type RowSpec,
  type SheetPixels,
} from './generate-goblin-sprites';
import { ARCHETYPE_SCALE, GOBLIN_STYLES, along, buildSkeleton, type Pt } from './goblinArt';
import { BONELESS_GORE_STATES } from './goblinGore';
import { GOBLIN_ATTACKS, GOBLIN_GORE_PARTS } from '../src/sprites/goblinSprite';

const CHANNELS_PER_PIXEL = 4;
const ALPHA_CHANNEL_OFFSET = 3;

// ── G1 · no ink on any frame border ──────────────────────────────────────────

function alphaAt(pixels: SheetPixels, x: number, y: number): number {
  return pixels.data[(y * pixels.width + x) * CHANNELS_PER_PIXEL + ALPHA_CHANNEL_OFFSET];
}

function gateBorderClip(sheet: BakedSheet): void {
  const { frameWidth, frameHeight } = sheet.geometry;
  const rows = physicalRowCount();
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < COLS_PER_ROW; column++) {
      const left = column * frameWidth;
      const top = row * frameHeight;
      const right = left + frameWidth - 1;
      const bottom = top + frameHeight - 1;
      const clipped = (edge: string): never => {
        throw new Error(
          `G1 ${sheet.archetype} physical row ${row} column ${column} is clipped at its ${edge} ` +
            `edge — the painter drew outside its ${frameWidth}×${frameHeight} cell`,
        );
      };
      for (let x = left; x <= right; x++) {
        if (alphaAt(sheet.pixels, x, top) > INK_ALPHA_THRESHOLD) clipped('top');
        if (alphaAt(sheet.pixels, x, bottom) > INK_ALPHA_THRESHOLD) clipped('bottom');
      }
      for (let y = top; y <= bottom; y++) {
        if (alphaAt(sheet.pixels, left, y) > INK_ALPHA_THRESHOLD) clipped('left');
        if (alphaAt(sheet.pixels, right, y) > INK_ALPHA_THRESHOLD) clipped('right');
      }
    }
  }
}

// ── G2 · anchor sanity ───────────────────────────────────────────────────────

/** Clear frame kept below the sole, so a foot never touches the cell edge. */
const MIN_FRAME_BELOW_SOLE = 8;

function gateAnchor(sheet: BakedSheet): void {
  const { groundY, frameHeight } = sheet.geometry;
  if (groundY <= 0 || groundY >= frameHeight) {
    throw new Error(`G2 ${sheet.archetype}: groundY ${groundY} is outside the frame`);
  }
  if (frameHeight - groundY < MIN_FRAME_BELOW_SOLE) {
    throw new Error(
      `G2 ${sheet.archetype}: only ${frameHeight - groundY}px below the sole, ` +
        `need ${MIN_FRAME_BELOW_SOLE}`,
    );
  }
}

// ── Frame-delta helpers, shared by G3, G4 and G6 ─────────────────────────────

interface FrameWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function frameWindow(sheet: BakedSheet, row: RowSpec, frame: number): FrameWindow {
  const offsets = rowOffsets();
  const start = offsets.get(row.name);
  if (start === undefined) throw new Error(`no offset for ${row.name}`);
  const { frameWidth, frameHeight } = sheet.geometry;
  return {
    x: (frame % COLS_PER_ROW) * frameWidth,
    y: (start + Math.floor(frame / COLS_PER_ROW)) * frameHeight,
    w: frameWidth,
    h: frameHeight,
  };
}

/** Mean absolute per-channel difference between two frames, 0–255. */
function frameDelta(sheet: BakedSheet, a: FrameWindow, b: FrameWindow): number {
  let total = 0;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const ia = ((a.y + y) * sheet.pixels.width + (a.x + x)) * CHANNELS_PER_PIXEL;
      const ib = ((b.y + y) * sheet.pixels.width + (b.x + x)) * CHANNELS_PER_PIXEL;
      for (let channel = 0; channel < CHANNELS_PER_PIXEL; channel++) {
        total += Math.abs(sheet.pixels.data[ia + channel] - sheet.pixels.data[ib + channel]);
      }
    }
  }
  return total / (a.w * a.h * CHANNELS_PER_PIXEL);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function consecutiveDeltas(sheet: BakedSheet, row: RowSpec): number[] {
  const deltas: number[] = [];
  for (let frame = 1; frame < row.frameCount; frame++) {
    deltas.push(
      frameDelta(sheet, frameWindow(sheet, row, frame - 1), frameWindow(sheet, row, frame)),
    );
  }
  return deltas;
}

// ── G3 · loop closure ────────────────────────────────────────────────────────

const LOOP_CLOSURE_RATIO = 1.35;

function gateLoopClosure(sheet: BakedSheet): void {
  for (const row of ROWS) {
    if (row.kind !== 'loop') continue;
    const deltas = consecutiveDeltas(sheet, row);
    const seam = frameDelta(
      sheet,
      frameWindow(sheet, row, row.frameCount - 1),
      frameWindow(sheet, row, 0),
    );
    // Compared against its own neighbours rather than against the row's median.
    // A gait's per-frame delta legitimately varies a lot between the contact and
    // the swing phase, so a median-based limit fails a perfectly closed loop
    // whose seam happens to fall in the fast part of the cycle. The frames
    // either side of the seam are at the same part of that cycle, which makes
    // them the only fair comparison.
    const neighbours = [deltas[0], deltas[deltas.length - 1]];
    const limit = (median(neighbours) + median(deltas)) * 0.5 * LOOP_CLOSURE_RATIO;
    if (seam > limit) {
      throw new Error(
        `G3 ${sheet.archetype} ${row.name}: the loop seam is ${seam.toFixed(2)} against a ` +
          `limit of ${limit.toFixed(2)} — the cycle hitches once per revolution`,
      );
    }
  }
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

function gateMotionContinuity(sheet: BakedSheet): void {
  for (const row of ROWS) {
    if (row.kind === 'gore') continue;
    const deltas = consecutiveDeltas(sheet, row);
    const limit = median(deltas) * MOTION_SPIKE_RATIO;
    deltas.forEach((delta, index) => {
      const frame = index + 1;
      if (isDeclaredSpike(sheet.archetype, row, frame)) return;
      if (delta > limit) {
        throw new Error(
          `G4 ${sheet.archetype} ${row.name}: frame ${frame - 1}→${frame} jumps ` +
            `${delta.toFixed(2)} against a limit of ${limit.toFixed(2)} — a visible hitch`,
        );
      }
    });
  }
}

// ── G5 · centroid smoothness ─────────────────────────────────────────────────

const CENTROID_SEAM_RATIO = 1.4;
/**
 * One screen pixel, expressed in frame pixels.
 *
 * Sheets are drawn at `TILE_SCALE` and rendered at `TILE_SIZE`, so a two-pixel
 * step in the sheet is one pixel on screen. Below that the seam is rounding, not
 * a jump anyone can see, and holding a gait to it would be measuring the
 * rasteriser rather than the animation.
 */
const IN_GAME_TILE_SIZE = 32;
const CENTROID_SEAM_FLOOR_PX = TILE_SCALE / IN_GAME_TILE_SIZE;

function inkCentroid(sheet: BakedSheet, window: FrameWindow): { x: number; y: number } {
  let sumX = 0;
  let sumY = 0;
  let weight = 0;
  for (let y = 0; y < window.h; y++) {
    for (let x = 0; x < window.w; x++) {
      const alpha = alphaAt(sheet.pixels, window.x + x, window.y + y);
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
 * Comparing frame 0 to the *last* frame — which is what the plan literally asks
 * for — measures the wrong thing: in a twelve-frame cycle the last frame is one
 * twelfth *before* frame 0, so a correctly closed loop still shows a full
 * frame's worth of travel there. What matters is that the step across the seam
 * is the same size as every other step, which is the same property G3 checks in
 * pixel space, measured on the figure's mass instead.
 */
function gateCentroid(sheet: BakedSheet): void {
  for (const row of ROWS) {
    if (row.kind !== 'loop') continue;
    const centroids = Array.from({ length: row.frameCount }, (unused, frame) =>
      inkCentroid(sheet, frameWindow(sheet, row, frame)),
    );
    const steps: number[] = [];
    for (let i = 1; i < centroids.length; i++) {
      steps.push(Math.hypot(centroids[i].x - centroids[i - 1].x, centroids[i].y - centroids[i - 1].y));
    }
    const last = centroids[centroids.length - 1];
    const seam = Math.hypot(centroids[0].x - last.x, centroids[0].y - last.y);
    const limit = Math.max(median(steps) * CENTROID_SEAM_RATIO, CENTROID_SEAM_FLOOR_PX);
    if (seam > limit) {
      throw new Error(
        `G5 ${sheet.archetype} ${row.name}: the ink centroid steps ${seam.toFixed(2)}px across ` +
          `the loop seam against a limit of ${limit.toFixed(2)}px — the mass jumps once per cycle`,
      );
    }
  }
}

// ── G6 · one-shot → idle continuity ──────────────────────────────────────────

const ONE_SHOT_SETTLE_RATIO = 2.0;

function gateOneShotSettle(sheet: BakedSheet): void {
  const idle = ROWS.find((row) => row.name === 'idle');
  if (idle === undefined) throw new Error('no idle row');
  for (const row of ROWS) {
    if (row.kind !== 'oneShot') continue;
    const deltas = consecutiveDeltas(sheet, row);
    const settle = frameDelta(
      sheet,
      frameWindow(sheet, row, row.frameCount - 1),
      frameWindow(sheet, idle, 0),
    );
    const limit = median(deltas) * ONE_SHOT_SETTLE_RATIO;
    if (settle > limit) {
      throw new Error(
        `G6 ${sheet.archetype} ${row.name}: the hand-off to idle is ${settle.toFixed(2)} ` +
          `against a limit of ${limit.toFixed(2)} — the goblin pops every time it swings`,
      );
    }
  }
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
 * moving forward. The naive "x must be constant" test the plan specifies fails
 * every correct walk cycle ever authored.
 *
 * The invariant that actually holds for a rolling contact is: the foot never
 * moves *forward* while planted, and each backward step is the same size as the
 * last. An uneven step is the ground slipping under the foot, which is the exact
 * artifact this gate exists to catch.
 */
function gateFootSlide(sheet: BakedSheet): void {
  for (const [rowName, poses] of sheet.poses) {
    const row = ROWS.find((candidate) => candidate.name === rowName);
    if (row === undefined) continue;
    for (const side of ['nearFoot', 'farFoot'] as const) {
      const steps: number[] = [];
      for (let i = 1; i < poses.length; i++) {
        const previousPose = poses[i - 1];
        const currentPose = poses[i];
        if (previousPose === undefined || currentPose === undefined) {
          throw new Error(`G7 ${sheet.archetype} ${rowName}: frame ${i} has no pose`);
        }
        const previous = previousPose[side];
        const current = currentPose[side];
        if (previous.y !== 0 || current.y !== 0) {
          steps.length = 0;
          continue;
        }
        const step = current.x - previous.x;

        if (row.kind !== 'loop') {
          if (Math.abs(step) > FOOT_SLIDE_TOLERANCE) {
            throw new Error(
              `G7 ${sheet.archetype} ${rowName}: the ${side} slides ${Math.abs(step).toFixed(4)} ` +
                `tile between frames ${i - 1} and ${i} while planted`,
            );
          }
          continue;
        }

        if (step > FOOT_SLIDE_TOLERANCE) {
          throw new Error(
            `G7 ${sheet.archetype} ${rowName}: the ${side} moves ${step.toFixed(4)} tile ` +
              `*forward* between frames ${i - 1} and ${i} while planted`,
          );
        }
        if (steps.length > 0) {
          const drift = Math.abs(step - steps[steps.length - 1]);
          if (drift > CONTACT_ROLL_TOLERANCE) {
            throw new Error(
              `G7 ${sheet.archetype} ${rowName}: the ${side}'s rolling contact steps ` +
                `${step.toFixed(4)} after ${steps[steps.length - 1].toFixed(4)} between frames ` +
                `${i - 1} and ${i} — the ground is slipping under the foot`,
            );
          }
        }
        steps.push(step);
      }
    }
  }
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
const VISIBLE_STEP = 3 / 32;

interface ArcStep {
  readonly length: number;
  readonly dx: number;
  readonly dy: number;
}

/**
 * Per-frame tip travel for a row.
 *
 * Throws rather than returning holes: `tips` is written by frame index, so a
 * frame whose pose left `weaponAngle` null leaves a gap that would otherwise
 * surface as a bare `TypeError` from inside a gate instead of a gate message.
 */
function tipSteps(tips: ReadonlyArray<Pt | undefined>, label: string): number[] {
  const steps: number[] = [];
  for (let frame = 1; frame < tips.length; frame++) {
    const from = tips[frame - 1];
    const to = tips[frame];
    if (from === undefined || to === undefined) {
      throw new Error(`G8 ${label}: frame ${frame} has no weapon-tip position`);
    }
    steps.push(Math.hypot(to.x - from.x, to.y - from.y));
  }
  return steps;
}

/** True when this step is the last before, or first after, a direction change. */
function atTurnaround(steps: readonly ArcStep[], index: number): boolean {
  const reverses = (a: ArcStep, b: ArcStep): boolean => a.dx * b.dx + a.dy * b.dy < 0;
  if (index > 0 && reverses(steps[index - 1], steps[index])) return true;
  return index + 1 < steps.length && reverses(steps[index], steps[index + 1]);
}

function gateWeaponArc(sheet: BakedSheet): void {
  for (const [rowName, tips] of sheet.tips) {
    const row = ROWS.find((candidate) => candidate.name === rowName);
    if (row === undefined || row.kind === 'gore') continue;
    const steps: ArcStep[] = [];
    for (let i = 1; i < tips.length; i++) {
      const from = tips[i - 1];
      const to = tips[i];
      if (from === undefined || to === undefined) {
        throw new Error(`G8 ${sheet.archetype} ${rowName}: frame ${i} has no weapon-tip position`);
      }
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      steps.push({ length: Math.hypot(dx, dy), dx, dy });
    }
    const total = steps.reduce((sum, step) => sum + step.length, 0);
    if (total <= 0) {
      throw new Error(`G8 ${sheet.archetype} ${rowName}: the weapon tip never moves`);
    }
    for (let i = 1; i < steps.length; i++) {
      if (isDeclaredSpike(sheet.archetype, row, i + 1)) continue;
      // A turnaround is not a hitch. Where the tip reverses — the end of a
      // follow-through, the top of a wind — it slows to a stop and sets off
      // again, so the steps on the approach are legitimately short. Gate G5
      // makes the same allowance for authored reversals.
      if (atTurnaround(steps, i - 1) || atTurnaround(steps, i)) continue;
      const smaller = Math.min(steps[i - 1].length, steps[i].length);
      const larger = Math.max(steps[i - 1].length, steps[i].length);
      // The ratio test only applies once the tip is genuinely travelling. A
      // cliff between two steps of half a pixel each is arithmetic, not a hitch
      // anyone can see, and applying the test there fails every walk cycle —
      // where the weapon drags along the ground a fraction of a pixel per frame.
      if (larger < VISIBLE_STEP) continue;
      if (larger / smaller > ARC_SPACING_RATIO) {
        throw new Error(
          `G8 ${sheet.archetype} ${rowName}: tip spacing jumps ${larger.toFixed(4)} against ` +
            `${smaller.toFixed(4)} at frame ${i + 1} — a cliff in the spacing chart`,
        );
      }
    }
  }
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
function gateOffHandGrip(sheet: BakedSheet): void {
  const offGrip = sheet.offGripDistance;
  if (offGrip === null) return;
  const style = GOBLIN_STYLES[sheet.archetype];
  const slack = style.proportions.handRadius * GRIP_SLACK_FRACTION;

  for (const [rowName, poses] of sheet.poses) {
    for (let frame = 0; frame < poses.length; frame++) {
      const pose = poses[frame];
      if (pose === undefined || pose.weaponAngle === null) continue;
      const onHaft = along(pose.nearHand, pose.weaponAngle, offGrip);
      const solved = buildSkeleton(style, pose).farArm.end;
      const gap = Math.hypot(solved.x - onHaft.x, solved.y - onHaft.y);
      if (gap > slack) {
        throw new Error(
          `G14 ${sheet.archetype} ${rowName} frame ${frame}: the off hand sits ` +
            `${gap.toFixed(4)} from the haft against a ${slack.toFixed(4)} allowance — ` +
            `the far arm cannot reach its grip, so the fist is drawn holding nothing`,
        );
      }
    }
  }
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

/**
 * Assert that no weapon tip finishes through the floor.
 *
 * A goblin's weapon is over half its own height, so any swing driven downward
 * from chest height buries the head unless something stops it. That "something"
 * is a derived angle cap rather than eight hand-authored keyframes, and this is
 * the gate that keeps a retimed attack from quietly getting under it again.
 */
function gateWeaponClearsFloor(sheet: BakedSheet): void {
  const scale = ARCHETYPE_SCALE[sheet.archetype];
  for (const [rowName, tips] of sheet.tips) {
    for (let frame = 0; frame < tips.length; frame++) {
      const tip = tips[frame];
      if (tip === undefined) continue;
      const belowGround = tip.y * scale;
      if (belowGround > MAX_TIP_BELOW_GROUND) {
        throw new Error(
          `G15 ${sheet.archetype} ${rowName} frame ${frame}: the weapon tip is ` +
            `${belowGround.toFixed(3)} tiles below the goblin's own feet against a ` +
            `${MAX_TIP_BELOW_GROUND} allowance — it is buried in the floor`,
        );
      }
    }
  }
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

interface InkBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function inkBounds(sheet: BakedSheet, window: FrameWindow): InkBounds | null {
  let minX = window.w;
  let minY = window.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < window.h; y++) {
    for (let x = 0; x < window.w; x++) {
      if (alphaAt(sheet.pixels, window.x + x, window.y + y) <= INK_ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Gore legibility, measured over each piece's **own footprint** rather than over
 * its cell.
 *
 * The cell is sized by a war hammer hauled overhead, so a severed jaw fills 3% of
 * it and a cell-relative coverage test says nothing about whether the jaw reads.
 * What matters is the shape itself at the size a player sees: 16×16 over the
 * piece's bounding box, plus a floor on how big that box is on screen.
 */
function gateGoreLegibility(sheet: BakedSheet): void {
  const row = ROWS.find((candidate) => candidate.kind === 'gore');
  if (row === undefined) throw new Error('no gore row');
  for (let frame = 0; frame < row.frameCount; frame++) {
    const window = frameWindow(sheet, row, frame);
    const partName = GOBLIN_GORE_PARTS[frame];
    const bounds = inkBounds(sheet, window);
    if (bounds === null) {
      throw new Error(`G9a ${sheet.archetype} ${partName}: the cell is empty`);
    }

    const screenPx = Math.max(bounds.width, bounds.height) * GORE_RENDER_SCALE;
    if (screenPx < GORE_MIN_SCREEN_PX) {
      throw new Error(
        `G9a ${sheet.archetype} ${partName}: only ${screenPx.toFixed(1)}px on screen, ` +
          `below the ${GORE_MIN_SCREEN_PX}px floor — it cannot be named at that size`,
      );
    }

    let inked = 0;
    const stepX = bounds.width / GORE_THUMB;
    const stepY = bounds.height / GORE_THUMB;
    for (let ty = 0; ty < GORE_THUMB; ty++) {
      for (let tx = 0; tx < GORE_THUMB; tx++) {
        const px = window.x + bounds.left + Math.floor((tx + 0.5) * stepX);
        const py = window.y + bounds.top + Math.floor((ty + 0.5) * stepY);
        if (alphaAt(sheet.pixels, px, py) > INK_ALPHA_THRESHOLD) inked++;
      }
    }

    const coverage = inked / (GORE_THUMB * GORE_THUMB);
    if (coverage < GORE_COVERAGE_MIN || coverage > GORE_COVERAGE_MAX) {
      throw new Error(
        `G9a ${sheet.archetype} ${partName}: covers ${(coverage * 100).toFixed(1)}% of its own ` +
          `16×16 footprint, outside [${GORE_COVERAGE_MIN * 100}%, ${GORE_COVERAGE_MAX * 100}%]`,
      );
    }

    if (BONELESS_GORE_STATES.includes(partName)) continue;
    assertBoneCarriesTheWound(sheet, window, partName);
  }
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
function assertBoneCarriesTheWound(
  sheet: BakedSheet,
  window: FrameWindow,
  partName: string,
): void {
  const isWoundPixel = (px: number, py: number): boolean => {
    if (alphaAt(sheet.pixels, px, py) <= INK_ALPHA_THRESHOLD) return false;
    const index = (py * sheet.pixels.width + px) * CHANNELS_PER_PIXEL;
    return sheet.pixels.data[index] > sheet.pixels.data[index + 1] + sheet.pixels.data[index + 2];
  };
  const lumaAt = (px: number, py: number): number => {
    const index = (py * sheet.pixels.width + px) * CHANNELS_PER_PIXEL;
    return (
      (LUMA_RED * sheet.pixels.data[index] +
        LUMA_GREEN * sheet.pixels.data[index + 1] +
        LUMA_BLUE * sheet.pixels.data[index + 2]) /
      CHANNEL_MAX
    );
  };

  const woundLuma: number[] = [];
  const wound: Array<{ readonly x: number; readonly y: number }> = [];
  for (let y = 0; y < window.h; y++) {
    for (let x = 0; x < window.w; x++) {
      if (!isWoundPixel(window.x + x, window.y + y)) continue;
      wound.push({ x, y });
      woundLuma.push(lumaAt(window.x + x, window.y + y));
    }
  }
  if (wound.length === 0) {
    throw new Error(`G9b ${sheet.archetype} ${partName}: no wound anywhere on the piece`);
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
        if (x < 0 || y < 0 || x >= window.w || y >= window.h) continue;
        if (alphaAt(sheet.pixels, window.x + x, window.y + y) <= INK_ALPHA_THRESHOLD) continue;
        region.add(y * window.w + x);
      }
    }
  }
  const allLuma = [...region].map((packed) =>
    lumaAt(window.x + (packed % window.w), window.y + Math.floor(packed / window.w)),
  );

  const brightest = [...allLuma].sort((a, b) => b - a);
  const topCount = Math.max(1, Math.round(brightest.length * BRIGHTEST_FRACTION));
  const boneLuma = brightest.slice(0, topCount).reduce((sum, value) => sum + value, 0) / topCount;
  const meanWound = woundLuma.reduce((sum, value) => sum + value, 0) / woundLuma.length;
  const contrast = boneLuma - meanWound;
  if (contrast < BONE_CONTRAST_MIN) {
    throw new Error(
      `G9b ${sheet.archetype} ${partName}: the brightest element inside the wound beats the ` +
        `wound itself by only ${contrast.toFixed(3)}, under the ${BONE_CONTRAST_MIN} minimum — ` +
        `the bone is not carrying the wound`,
    );
  }
}

// ── G10 · rotation safety ────────────────────────────────────────────────────

function gateRotationSafety(sheet: BakedSheet): void {
  const row = ROWS.find((candidate) => candidate.kind === 'gore');
  if (row === undefined) throw new Error('no gore row');
  const { frameWidth, frameHeight } = sheet.geometry;
  const radius = Math.min(frameWidth, frameHeight) / 2;
  for (let frame = 0; frame < row.frameCount; frame++) {
    const window = frameWindow(sheet, row, frame);
    for (let y = 0; y < window.h; y++) {
      for (let x = 0; x < window.w; x++) {
        if (alphaAt(sheet.pixels, window.x + x, window.y + y) <= INK_ALPHA_THRESHOLD) continue;
        const dx = x - frameWidth / 2;
        const dy = y - frameHeight / 2;
        if (Math.hypot(dx, dy) > radius) {
          throw new Error(
            `G10 ${sheet.archetype} ${GOBLIN_GORE_PARTS[frame]}: ink at ` +
              `${Math.hypot(dx, dy).toFixed(1)}px from the cell centre, outside the ` +
              `${radius.toFixed(1)}px inscribed circle — it will clip as the piece spins`,
          );
        }
      }
    }
  }
}

// ── G11 · texture size ───────────────────────────────────────────────────────

const MAX_TEXTURE_PX = 4096;
const TARGET_TEXTURE_PX = 2560;

function gateTextureSize(sheet: BakedSheet): void {
  if (sheet.width > MAX_TEXTURE_PX || sheet.height > MAX_TEXTURE_PX) {
    throw new Error(
      `G11 ${sheet.archetype}: ${sheet.width}×${sheet.height} exceeds the ${MAX_TEXTURE_PX}px limit`,
    );
  }
  if (sheet.width > TARGET_TEXTURE_PX || sheet.height > TARGET_TEXTURE_PX) {
    console.warn(
      `G11 ${sheet.archetype}: ${sheet.width}×${sheet.height} is over the ${TARGET_TEXTURE_PX}px target`,
    );
  }
}

// ── G13 · runtime/art sync ───────────────────────────────────────────────────

interface ManifestStateEntry {
  readonly row: number;
  readonly frameCount: number;
  readonly colsPerRow?: number;
  /** Set on gore states, which share one physical row. */
  readonly colOffset?: number;
}

interface ManifestEntry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly states: Record<string, ManifestStateEntry>;
}

function isManifestEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record.frameWidth === 'number' &&
    typeof record.frameHeight === 'number' &&
    typeof record.tileX === 'number' &&
    typeof record.tileY === 'number' &&
    typeof record.tileScale === 'number' &&
    typeof record.states === 'object' &&
    record.states !== null &&
    typeof record.path === 'string'
  );
}

/**
 * Assert that the timing table and the manifest both describe what was just
 * baked.
 *
 * This closes the pipeline's one known weak seam: every other generator in this
 * repo relies on a hand-synced `manifest.json`, and nothing catches it when the
 * two drift. It **verifies rather than rewrites** on purpose — other agents work
 * in this repo, and programmatically rewriting a shared JSON file would clobber
 * their edits.
 */
function gateTimingTable(): void {
  for (const archetype of GOBLIN_ARCHETYPES) {
    for (const kind of ['light', 'heavy'] as const) {
      const timing = GOBLIN_ATTACKS[archetype][kind];
      const rowName = kind === 'light' ? 'attack_light' : 'attack_heavy';
      const row = ROWS.find((candidate) => candidate.name === rowName);
      if (row === undefined) throw new Error(`G13: no row ${rowName}`);
      if (timing.spriteFrames !== row.frameCount) {
        throw new Error(
          `G13 ${archetype} ${kind}: GOBLIN_ATTACKS says ${timing.spriteFrames} sprite frames, ` +
            `the generator bakes ${row.frameCount}`,
        );
      }
      if (timing.impactFrame !== IMPACT_FRAMES[archetype][kind]) {
        throw new Error(
          `G13 ${archetype} ${kind}: GOBLIN_ATTACKS says impact frame ${timing.impactFrame}, ` +
            `the generator animates ${IMPACT_FRAMES[archetype][kind]}`,
        );
      }
      if (timing.impactFrame < 0 || timing.impactFrame >= row.frameCount) {
        throw new Error(`G13 ${archetype} ${kind}: impact frame ${timing.impactFrame} out of range`);
      }
    }
  }
}

/**
 * G13b: the *art* must peak where the table says it connects.
 *
 * Comparing the timing table against the generator's own impact table is two
 * copies of the same number agreeing with each other — unfalsifiable. What can
 * actually be wrong is the choreography: a swing whose fastest frame lands
 * nowhere near the frame damage is dealt on reads as a hit that happens before
 * or after the blow. The weapon tip's largest step is the moment of the strike,
 * so that is what gets checked.
 */
function gateImpactIsThePeak(sheets: readonly BakedSheet[]): void {
  const PEAK_TOLERANCE_FRAMES = 1;
  for (const sheet of sheets) {
    for (const kind of ['light', 'heavy'] as const) {
      const rowName = kind === 'light' ? 'attack_light' : 'attack_heavy';
      const tips = sheet.tips.get(rowName);
      if (tips === undefined || tips.length < 2) {
        throw new Error(`G13b ${sheet.archetype} ${kind}: no weapon-tip trace for ${rowName}`);
      }
      const steps = tipSteps(tips, `${sheet.archetype} ${kind}`);
      let fastestFrame = steps.indexOf(Math.max(...steps)) + 1;
      // `indexOf` on an all-equal array returns 0, which would name frame 1 for
      // a tip that never moves. G8 rejects a static tip first, but the value
      // should come from the data rather than from a guess.
      if (steps.every((step: number) => step === steps[0])) fastestFrame = -1;
      const impact = IMPACT_FRAMES[sheet.archetype][kind];
      if (fastestFrame < 0) {
        throw new Error(`G13b ${sheet.archetype} ${kind}: the weapon tip travels evenly — no strike`);
      }
      if (Math.abs(fastestFrame - impact) > PEAK_TOLERANCE_FRAMES) {
        throw new Error(
          `G13b ${sheet.archetype} ${kind}: the weapon is travelling fastest on frame ` +
            `${fastestFrame} but damage lands on frame ${impact} — the strike and the hit are ` +
            `${Math.abs(fastestFrame - impact)} frames apart`,
        );
      }
    }
  }

}

/**
 * The manifest half of G13, split out so `--skip-manifest-gate` can skip exactly
 * what its name says. The timing-table half above always runs.
 */
function gateManifestSync(sheets: readonly BakedSheet[]): void {
  const manifestPath = resolve('src/images/enemies/manifest.json');
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('G13: enemies/manifest.json is not an object');
  }
  const manifest: Record<string, unknown> = { ...parsed };
  const offsets = rowOffsets();

  for (const sheet of sheets) {
    const key = `goblin_${sheet.archetype}`;
    const entry = manifest[key];
    if (!isManifestEntry(entry)) {
      throw new Error(`G13: enemies/manifest.json has no usable "${key}" entry`);
    }
    const expected = {
      frameWidth: sheet.geometry.frameWidth,
      frameHeight: sheet.geometry.frameHeight,
      tileX: sheet.geometry.tileX,
      tileY: sheet.geometry.tileY,
      tileScale: TILE_SCALE,
    };
    for (const [field, value] of Object.entries(expected)) {
      const actual: unknown = { ...entry }[field];
      if (actual !== value) {
        throw new Error(`G13 ${key}: manifest ${field} is ${String(actual)}, the bake produced ${value}`);
      }
    }
    if (entry.path !== `enemies/${sheetFileName(sheet.archetype)}`) {
      throw new Error(`G13 ${key}: manifest path is "${entry.path}"`);
    }

    for (const row of ROWS) {
      if (row.kind === 'gore') continue;
      const state = entry.states[row.name];
      if (state === undefined) throw new Error(`G13 ${key}: manifest has no "${row.name}" state`);
      const expectedRow = offsets.get(row.name);
      if (state.row !== expectedRow || state.frameCount !== row.frameCount) {
        throw new Error(
          `G13 ${key} ${row.name}: manifest says row ${state.row} × ${state.frameCount} frames, ` +
            `the bake produced row ${expectedRow} × ${row.frameCount}`,
        );
      }
      if (state.colsPerRow !== COLS_PER_ROW) {
        throw new Error(`G13 ${key} ${row.name}: manifest colsPerRow is ${state.colsPerRow}`);
      }
    }

    const goreRowStart = offsets.get('gore');
    GOBLIN_GORE_PARTS.forEach((partState, index) => {
      const state = entry.states[partState];
      if (state === undefined) throw new Error(`G13 ${key}: manifest has no "${partState}" state`);
      if (state.row !== goreRowStart || state.frameCount !== 1) {
        throw new Error(`G13 ${key} ${partState}: manifest row/frameCount wrong`);
      }
      if (state.colOffset !== index) {
        throw new Error(
          `G13 ${key} ${partState}: manifest colOffset is ${String(state.colOffset)}, want ${index}`,
        );
      }
    });
  }
}

// ── G12 · asset budget ───────────────────────────────────────────────────────

/** On-disk bytes the four goblin sheets may not exceed together. */
const ASSET_BUDGET_BYTES = 3.0 * 1024 * 1024;
/** What the three retired sheets cost, measured before they were deleted. */
const RETIRED_PIXELS = 3_936_256;
const RETIRED_BYTES = 388_000;

function reportAssetBudget(sheets: readonly BakedSheet[]): void {
  const pixels = sheets.reduce((sum, sheet) => sum + sheet.width * sheet.height, 0);
  const bytes = sheets.reduce((sum, sheet) => sum + sheet.buffer.byteLength, 0);
  const BYTES_PER_MB = 1024 * 1024;
  const PIXELS_PER_MEGA = 1_000_000;
  console.log(
    `G12 budget: ${(pixels / PIXELS_PER_MEGA).toFixed(2)}M px, ` +
      `${(bytes / BYTES_PER_MB).toFixed(2)} MB on disk ` +
      `(net ${((pixels - RETIRED_PIXELS) / PIXELS_PER_MEGA).toFixed(2)}M px, ` +
      `${((bytes - RETIRED_BYTES) / BYTES_PER_MB).toFixed(2)} MB vs the three retired sheets)`,
  );
  if (bytes > ASSET_BUDGET_BYTES) {
    throw new Error(
      `G12: ${(bytes / BYTES_PER_MB).toFixed(2)} MB exceeds the ` +
        `${(ASSET_BUDGET_BYTES / BYTES_PER_MB).toFixed(1)} MB budget`,
    );
  }
}

// ── Arc trace ────────────────────────────────────────────────────────────────

/**
 * The weapon tip per frame, dumped next to the sheet. The harness plots it as a
 * polyline with a spacing bar chart, which is how a hitch becomes visible in a
 * still: even spacing is smooth motion, and a chart with a cliff in it is a jump
 * you can see without seeing the animation.
 */
function writeArcTrace(sheet: BakedSheet): void {
  mkdirSync(resolve(ARC_TRACE_DIR), { recursive: true });
  const trace: Record<string, ReadonlyArray<Pt | undefined>> = {};
  for (const [rowName, tips] of sheet.tips) trace[rowName] = tips;
  writeFileSync(resolve(arcTracePath(sheet.archetype)), `${JSON.stringify(trace, null, 2)}\n`);
}

/** The `manifest.json` entry this bake requires, for pasting when geometry moves. */
function manifestEntryFor(sheet: BakedSheet): ManifestEntry {
  const offsets = rowOffsets();
  const states: Record<string, ManifestStateEntry> = {};
  for (const row of ROWS) {
    if (row.kind === 'gore') continue;
    const start = offsets.get(row.name);
    if (start === undefined) throw new Error(`no offset for ${row.name}`);
    states[row.name] = { row: start, frameCount: row.frameCount, colsPerRow: COLS_PER_ROW };
  }
  const goreRow = offsets.get('gore');
  if (goreRow === undefined) throw new Error('no gore row offset');
  GOBLIN_GORE_PARTS.forEach((partState, index) => {
    states[partState] = { row: goreRow, colOffset: index, frameCount: 1 };
  });
  return {
    path: `enemies/${sheetFileName(sheet.archetype)}`,
    frameWidth: sheet.geometry.frameWidth,
    frameHeight: sheet.geometry.frameHeight,
    tileX: sheet.geometry.tileX,
    tileY: sheet.geometry.tileY,
    tileScale: TILE_SCALE,
    states,
  };
}

// ── Run ──────────────────────────────────────────────────────────────────────

const skipManifestGate = process.argv.includes('--skip-manifest-gate');

const baked = GOBLIN_ARCHETYPES.map((archetype) => {
  const sheet = bake(archetype);
  gateBorderClip(sheet);
  gateAnchor(sheet);
  gateLoopClosure(sheet);
  gateMotionContinuity(sheet);
  gateCentroid(sheet);
  gateOneShotSettle(sheet);
  gateFootSlide(sheet);
  gateWeaponArc(sheet);
  gateOffHandGrip(sheet);
  gateWeaponClearsFloor(sheet);
  gateGoreLegibility(sheet);
  gateRotationSafety(sheet);
  gateTextureSize(sheet);
  return sheet;
});

reportAssetBudget(baked);
gateTimingTable();
gateImpactIsThePeak(baked);
if (skipManifestGate) {
  console.warn('G13: manifest check skipped by --skip-manifest-gate');
} else {
  gateManifestSync(baked);
}

for (const sheet of baked) {
  writeFileSync(resolve(sheetPath(sheet.archetype)), sheet.buffer);
  writeArcTrace(sheet);
  const offsets = rowOffsets();
  console.log(`goblin_${sheet.archetype} → ${sheetPath(sheet.archetype)}`);
  console.log(
    `  ${sheet.width}×${sheet.height}px ` +
      `(${physicalRowCount()} physical rows × ${COLS_PER_ROW} cols of ` +
      `${sheet.geometry.frameWidth}×${sheet.geometry.frameHeight})`,
  );
  console.log(
    `  tileX=${sheet.geometry.tileX} tileY=${sheet.geometry.tileY} tileScale=${TILE_SCALE} ` +
      `groundY=${sheet.geometry.groundY}`,
  );
  // Printed, never written. G13 verifies `manifest.json` rather than rewriting
  // it because other agents work in this repo and a programmatic rewrite of a
  // shared file would clobber their edits — but the numbers change whenever a
  // pose does, so the entry the manifest *should* carry is printed for pasting.
  console.log(`  manifest: ${JSON.stringify(manifestEntryFor(sheet))}`);
  for (const row of ROWS) {
    console.log(`    ${row.name}: row ${offsets.get(row.name)}, ${row.frameCount} frames`);
  }
}
