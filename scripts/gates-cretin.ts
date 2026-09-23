/**
 * The Cretins' art gates, covering all four Cretins and the amber Shield dome.
 *
 * Pose-stream gates measure the rig itself; pixel gates measure cells baked
 * from the figures exactly the way the runtime cache bakes them, so what is
 * measured is what the game blits.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing.
 *
 *   npm run gates:cretin
 *   npm run render:cretin     (runs these first)
 */

import { pathToFileURL } from 'node:url';

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import { asGameContext } from './nodeGameContext.js';
import {
  CRETIN_VARIANTS,
  LEG_REACH,
  MEAT_SHIELDS_ORANGE,
  type CretinPose,
  cretinArmChain,
  cretinLegChain,
  cretinWearsArmband,
} from '../src/sprites/art/cretinArt.js';
import {
  CAST_PROGRESS,
  CRETIN_ACTIONS,
  CRETIN_FIGURES,
  CRETIN_ROWS,
  CRETIN_SHIELD_FIGURE,
  CRETIN_SHIELD_ROWS,
  CRETIN_VIEWS,
  type CretinAction,
  cretinStateName,
  cyclePhase,
  deathPoseAt,
  walkFoot,
  walkPose,
} from '../src/sprites/art/cretinFigure.js';
import { HUMAN_FIGURE } from '../src/sprites/art/humanFigure.js';
import { PROTECTIVE_SHELL_FIGURES } from '../src/sprites/art/protectiveShellFigure.js';
import {
  CRETIN_CAST_SHIELD_CAST_FRAME,
  CRETIN_DEATH_CORPSE_FRAME,
  CRETIN_DRAW_SCALE,
  CRETIN_PUNCH_IMPACT_FRAME,
  CRETIN_WALK_FRAMES,
  CRETIN_WALK_TILES_PER_CYCLE,
} from '../src/sprites/cretinTiming.js';
import { cretinReachableStates } from '../src/sprites/cretinSprite.js';
import { type FigureDef } from '../src/sprites/figure/figureDef.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/**
 * Alpha above which a pixel is the figure itself rather than its soft contact
 * shadow or dust. An anchor gate measured on ordinary ink measures the shadow,
 * which sits on the ground line whether or not the feet do.
 */
const SOLID_ALPHA = 200;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
/** Decimal places tile distances are reported to: a hundredth of a pixel at the bake. */
const TILE_DECIMALS = 3;
const SLIDE_DECIMALS = 4;
const PERCENT = 100;
/** A loop needs at least this many frames for a seam to be compared against its steps. */
const MIN_LOOP_FRAMES = 3;
/** The left foot's contact is half a cycle after the right's. */
const HALF_CYCLE = 0.5;
/** How far over its own shoulder a hand must be on the cast frame, tiles. */
const MIN_CAST_HAND_RAISE = 0.4;
const HEX_RADIX = 16;
/** A `#rrggbb` colour: one `#`, then two hex digits a channel. */
const HEX_PREFIX = 1;
const HEX_PAIR = 2;
const GREEN_CHANNEL = 1;
const BLUE_CHANNEL = 2;

function hexChannel(color: string, channel: number): number {
  const start = HEX_PREFIX + channel * HEX_PAIR;
  return parseInt(color.slice(start, start + HEX_PAIR), HEX_RADIX);
}
/** Alpha below which a Shield pixel is faint glow rather than the dome itself. */
const SHIELD_VISIBLE_ALPHA = 60;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(id: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(id, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const cellCache = new Map<string, Uint8ClampedArray>();

function pixelsOf(def: FigureDef, state: string, frame: number): Uint8ClampedArray {
  const key = `${def.id}:${state}[${frame}]`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const cell: Canvas = bakeFigureCell(def, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, cell.width, cell.height);
  cellCache.set(key, data);
  return data;
}

function framesOf(def: FigureDef, state: string, id: string): number {
  const declared = def.states.get(state);
  if (declared === undefined) {
    fail(id, `${def.id} declares no state "${state}" to measure`);
    return 0;
  }
  return declared.frames;
}

/** Mean absolute alpha difference between two cells, 0..255. */
function alphaDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let total = 0;
  for (let i = ALPHA_OFFSET; i < a.length; i += CHANNELS) total += Math.abs(a[i] - b[i]);
  return total / (a.length / CHANNELS);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

/** Top and bottom rows of solid ink in a cell, or null when there is none. */
function solidSpan(
  def: FigureDef,
  state: string,
  frame: number,
): { top: number; bottom: number } | null {
  const data = pixelsOf(def, state, frame);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < def.frameHeight; y++) {
    for (let x = 0; x < def.frameWidth; x++) {
      if (data[(y * def.frameWidth + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      if (top < 0) top = y;
      bottom = y;
      break;
    }
  }
  return top < 0 ? null : { top, bottom };
}

// ── G1 structure ─────────────────────────────────────────────────────────────

function gateStructure(): void {
  for (const variant of CRETIN_VARIANTS) {
    for (const failure of figureStructuralFailures(CRETIN_FIGURES[variant])) fail('G1', failure);
  }
  for (const failure of figureStructuralFailures(CRETIN_SHIELD_FIGURE)) fail('G1', failure);
}

// ── G2 row table and runtime names ───────────────────────────────────────────

/**
 * Every row the runtime can name is painted with the table's frame count in
 * every view, and each row's event frame is one the row actually has. The
 * names come from the runtime module's own composer, never from a scrape.
 */
function gateRowTable(): void {
  let rowsMeasured = 0;
  for (const variant of CRETIN_VARIANTS) {
    const def = CRETIN_FIGURES[variant];
    for (const failure of missingStateFailures(
      def,
      cretinReachableStates(),
      'cretinReachableStates()',
    )) {
      fail('G2', failure);
    }
    for (const action of CRETIN_ACTIONS) {
      const row = CRETIN_ROWS[action];
      for (const view of CRETIN_VIEWS) {
        const state = cretinStateName(action, view);
        const frames = framesOf(def, state, 'G2');
        rowsMeasured++;
        if (frames !== row.frameCount) {
          fail(
            'G2',
            `${def.id}.${state} paints ${frames} frames against the table's ${row.frameCount}`,
          );
        }
      }
      if (row.eventFrame !== null && (row.eventFrame < 0 || row.eventFrame >= row.frameCount)) {
        fail(
          'G2',
          `${action}'s event frame ${row.eventFrame} is outside its ${row.frameCount} frames`,
        );
      }
    }
  }
  for (const row of Object.keys(CRETIN_SHIELD_ROWS)) {
    if (!CRETIN_SHIELD_FIGURE.states.has(row))
      fail('G2', `the Shield dome does not paint "${row}"`);
  }
  failUnlessMeasured('G2', rowsMeasured, 'rows');
}

// ── G3 the feet stand on the tile ────────────────────────────────────────────

/**
 * How far a standing frame's lowest solid pixel may sit above and below the
 * bottom of the figure's own tile box, in cell pixels. Measured against
 * `tileY + tileScale` — the box the runtime hangs everything off — on a padded
 * canvas, so art that slipped off its anchor is measured rather than clipped.
 * Below is looser: a foot a stride toward the camera is drawn lower on the floor.
 */
const GROUND_ABOVE_PX = 3;
const GROUND_BELOW_PX = 7;
const GROUND_PAD = 48;
const GROUNDED_ACTIONS: readonly CretinAction[] = [
  'idle',
  'walk',
  'punch',
  'cast_shield',
  'robot',
  'hurt',
];

function lowestSolidUnclipped(def: FigureDef, state: string, frame: number): number {
  const canvas = createCanvas(def.frameWidth + GROUND_PAD * 2, def.frameHeight + GROUND_PAD * 2);
  const ctx = canvas.getContext('2d');
  ctx.translate(GROUND_PAD, GROUND_PAD);
  def.paintFrame(asGameContext(ctx), state, frame);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let y = canvas.height - 1; y >= 0; y--) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * CHANNELS + ALPHA_OFFSET] >= SOLID_ALPHA)
        return y - GROUND_PAD;
    }
  }
  return Number.NaN;
}

function gateGroundLine(): void {
  let measured = 0;
  const def = CRETIN_FIGURES.sledge;
  const tileBottom = def.tileY + def.tileScale;
  for (const action of GROUNDED_ACTIONS) {
    for (const view of CRETIN_VIEWS) {
      const state = cretinStateName(action, view);
      const frames = framesOf(def, state, 'G3');
      for (let frame = 0; frame < frames; frame++) {
        const lowest = lowestSolidUnclipped(def, state, frame);
        if (Number.isNaN(lowest)) {
          fail('G3', `${def.id}.${state}[${frame}] painted no solid pixel`);
          continue;
        }
        measured++;
        if (lowest >= tileBottom - GROUND_ABOVE_PX && lowest <= tileBottom + GROUND_BELOW_PX)
          continue;
        fail(
          'G3',
          `${def.id}.${state}[${frame}] has its lowest solid pixel on row ${lowest} against the tile's ` +
            `bottom at ${tileBottom} (allowed ${GROUND_ABOVE_PX} above, ${GROUND_BELOW_PX} below) — ` +
            'it is not standing on its tile',
        );
      }
    }
  }
  failUnlessMeasured('G3', measured, 'standing frames');
}

// ── G4 loops close ───────────────────────────────────────────────────────────

/**
 * The seam against the loop's largest ordinary step (a pop) and against its
 * median step (a held frame). Largest rather than median for the ceiling,
 * because a walk's steps are all large and a median-relative ceiling loose
 * enough for them passes a row running one and a half cycles.
 */
const MAX_SEAM_VS_LARGEST = 1.2;
const MIN_SEAM_VS_MEDIAN = 0.4;

function gateLoops(): void {
  let loops = 0;
  for (const variant of CRETIN_VARIANTS) {
    const def = CRETIN_FIGURES[variant];
    for (const action of CRETIN_ACTIONS) {
      if (CRETIN_ROWS[action].kind !== 'loop') continue;
      for (const view of CRETIN_VIEWS) {
        const state = cretinStateName(action, view);
        const frames = framesOf(def, state, 'G4');
        if (frames < MIN_LOOP_FRAMES) continue;
        loops++;
        const steps: number[] = [];
        for (let f = 1; f < frames; f++) {
          steps.push(alphaDelta(pixelsOf(def, state, f - 1), pixelsOf(def, state, f)));
        }
        const seam = alphaDelta(pixelsOf(def, state, frames - 1), pixelsOf(def, state, 0));
        const largest = Math.max(...steps);
        const typical = median(steps);
        if (typical <= 0) {
          fail('G4', `${def.id}.${state} does not move between frames`);
          continue;
        }
        if (seam > largest * MAX_SEAM_VS_LARGEST) {
          fail(
            'G4',
            `${def.id}.${state} pops at its seam: ${seam.toFixed(2)} against a largest step of ` +
              `${largest.toFixed(2)} (limit ${MAX_SEAM_VS_LARGEST}×)`,
          );
        } else if (seam < typical * MIN_SEAM_VS_MEDIAN) {
          fail(
            'G4',
            `${def.id}.${state} holds still across its seam: ${seam.toFixed(2)} against a median step ` +
              `of ${typical.toFixed(2)} (floor ${MIN_SEAM_VS_MEDIAN}×) — the last frame repeats the first`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G4', loops, 'looping rows');
}

// ── G5 the legs never clamp ──────────────────────────────────────────────────

/**
 * Hip-to-ankle distance stays inside the two bones on every posed frame. One
 * clamped frame locks the leg straight and the next bend snaps it back: the hop.
 */
const REACH_HEADROOM = 0.995;

function posedFrames(): { label: string; pose: CretinPose }[] {
  const out: { label: string; pose: CretinPose }[] = [];
  for (const action of CRETIN_ACTIONS) {
    const row = CRETIN_ROWS[action];
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = row.pose === null ? deathPoseAt(frame) : row.pose(frame);
      if (pose !== null) out.push({ label: `${action}[${frame}]`, pose });
    }
  }
  return out;
}

function gateLegReach(): void {
  let measured = 0;
  for (const { label, pose } of posedFrames()) {
    for (const side of [-1, 1]) {
      measured++;
      const share = cretinLegChain(pose, side).reachShare;
      if (share <= REACH_HEADROOM) continue;
      fail(
        'G5',
        `${label}: the ${side < 0 ? 'left' : 'right'} leg is asked to reach ${(share * LEG_REACH).toFixed(TILE_DECIMALS)} ` +
          `tiles against ${(LEG_REACH * REACH_HEADROOM).toFixed(TILE_DECIMALS)} — it locks straight`,
      );
    }
  }
  failUnlessMeasured('G5', measured, 'legs');
}

// ── G6 a planted foot holds the floor ────────────────────────────────────────

/**
 * Through stance a foot slides back through the cell at exactly the rate the
 * sprite is carried forward over the floor, measured from the solved rig in
 * the units a kit advances the gait in. Faster or slower is a skate.
 */
const FOOT_SLIDE_EPSILON = 1e-6;

function gateFootSlide(): void {
  // The rig moves in its own units; the screen carries it in tiles scaled by
  // the draw scale, so the two are compared in rig units.
  const groundPerFrame = CRETIN_WALK_TILES_PER_CYCLE / CRETIN_DRAW_SCALE / CRETIN_WALK_FRAMES;
  let measured = 0;
  for (const side of [-1, 1]) {
    for (let frame = 1; frame < CRETIN_WALK_FRAMES; frame++) {
      const offset = side < 0 ? HALF_CYCLE : 0;
      const before = walkFoot(cyclePhase(frame - 1, CRETIN_WALK_FRAMES) + offset);
      const after = walkFoot(cyclePhase(frame, CRETIN_WALK_FRAMES) + offset);
      if (!before.planted || !after.planted) continue;
      measured++;
      const ankleBefore = cretinLegChain(walkPose(cyclePhase(frame - 1, CRETIN_WALK_FRAMES)), side)
        .ankle.fore;
      const ankleAfter = cretinLegChain(walkPose(cyclePhase(frame, CRETIN_WALK_FRAMES)), side).ankle
        .fore;
      const drift = ankleAfter - ankleBefore + groundPerFrame;
      if (Math.abs(drift) <= FOOT_SLIDE_EPSILON) continue;
      fail(
        'G6',
        `walk[${frame}]: the planted ${side < 0 ? 'left' : 'right'} foot moves ${drift.toFixed(SLIDE_DECIMALS)} tiles ` +
          'over the floor while it is down — the walk skates',
      );
    }
  }
  failUnlessMeasured('G6', measured, 'planted walk steps');
}

// ── G7 arms swing against the legs ───────────────────────────────────────────

/**
 * At each foot's contact the arm on the same side is back and the other
 * forward. A sine driver in place of a cosine puts the arms a quarter cycle
 * late, which reads as a shuffle while every limb moves correctly.
 */
function gateArmPhase(): void {
  let measured = 0;
  for (const [side, phase] of [
    [1, 0],
    [-1, HALF_CYCLE],
  ] as const) {
    const frame = Math.round(phase * CRETIN_WALK_FRAMES);
    const pose = walkPose(cyclePhase(frame, CRETIN_WALK_FRAMES));
    const same = cretinArmChain(pose, side).fist.fore;
    const other = cretinArmChain(pose, -side).fist.fore;
    measured++;
    if (same < other) continue;
    fail(
      'G7',
      `walk[${frame}] is the ${side > 0 ? 'right' : 'left'} foot's contact, but that side's fist is ` +
        `${same.toFixed(TILE_DECIMALS)} forward against the other's ${other.toFixed(TILE_DECIMALS)} — the arms are out of phase`,
    );
  }
  failUnlessMeasured('G7', measured, 'foot contacts');
}

// ── G8 the punch lands on its impact frame ───────────────────────────────────

/** How far past its resting reach the punching fist must travel, in tiles. */
const MIN_PUNCH_TRAVEL = 0.45;

function gatePunchImpact(): void {
  const row = CRETIN_ROWS.punch;
  const pose = row.pose;
  if (pose === null) {
    fail('G8', 'the punch row has no pose to measure');
    return;
  }
  const reach = Array.from(
    { length: row.frameCount },
    (_unused, f) => cretinArmChain(pose(f), 1).fist.fore,
  );
  const peak = reach.indexOf(Math.max(...reach));
  if (peak !== CRETIN_PUNCH_IMPACT_FRAME) {
    fail(
      'G8',
      `the right fist is furthest out on punch[${peak}] but the hit lands on frame ` +
        `${CRETIN_PUNCH_IMPACT_FRAME} — the damage and the picture describe different moments`,
    );
  }
  const rest = cretinArmChain(pose(0), 1).fist.fore;
  const travel = reach[CRETIN_PUNCH_IMPACT_FRAME] - rest;
  if (travel < MIN_PUNCH_TRAVEL) {
    fail(
      'G8',
      `the punch drives the fist only ${travel.toFixed(TILE_DECIMALS)} tiles forward (floor ${MIN_PUNCH_TRAVEL})`,
    );
  }
}

// ── G9 the shield is cast on its cast frame ──────────────────────────────────

function gateCastFrame(): void {
  const row = CRETIN_ROWS.cast_shield;
  const pose = row.pose;
  if (pose === null) {
    fail('G9', 'the cast row has no pose to measure');
    return;
  }
  const glyphs = Array.from({ length: row.frameCount }, (_unused, f) => pose(f).glyph);
  const peak = glyphs.indexOf(Math.max(...glyphs));
  if (peak !== CRETIN_CAST_SHIELD_CAST_FRAME) {
    fail(
      'G9',
      `the glyph flares brightest on cast_shield[${peak}] but the shield is raised on frame ` +
        `${CRETIN_CAST_SHIELD_CAST_FRAME} (cast progress ${CAST_PROGRESS.toFixed(TILE_DECIMALS)})`,
    );
  }
  const castPose = pose(CRETIN_CAST_SHIELD_CAST_FRAME);
  const shoulderY = cretinArmChain(castPose, 1).shoulder.y;
  for (const side of [-1, 1]) {
    const fistY = cretinArmChain(castPose, side).fist.y;
    if (fistY < shoulderY - MIN_CAST_HAND_RAISE) continue;
    fail(
      'G9',
      `on the cast frame the ${side < 0 ? 'left' : 'right'} hand is not raised over the head`,
    );
  }
}

// ── G10 a Cretin towers over Carl ────────────────────────────────────────────

/**
 * Standing solid-ink height at the game's tile, against Carl's. Seven feet of
 * rock beside a six-foot man is a sixth taller; this asks for a quarter so it
 * still reads as towering at 32 px.
 */
const MIN_HEIGHT_OVER_CARL = 1.25;

function standingHeightTiles(def: FigureDef, state: string): number {
  const span = solidSpan(def, state, 0);
  if (span === null) return 0;
  return (span.bottom - span.top + 1) / def.tileScale;
}

function gateTowersOverCarl(): void {
  const carl = standingHeightTiles(HUMAN_FIGURE, 'idle');
  if (carl <= 0) {
    fail('G10', "Carl's idle painted no solid ink to compare against");
    return;
  }
  for (const variant of CRETIN_VARIANTS) {
    const height = standingHeightTiles(CRETIN_FIGURES[variant], 'idle');
    if (height >= carl * MIN_HEIGHT_OVER_CARL) continue;
    fail(
      'G10',
      `${variant} stands ${height.toFixed(2)} tiles against Carl's ${carl.toFixed(2)} ` +
        `(${(height / carl).toFixed(2)}×, floor ${MIN_HEIGHT_OVER_CARL}×) — it does not tower`,
    );
  }
}

// ── G11 the Meat Shields armband ─────────────────────────────────────────────

/** How close a pixel's colour must be to the armband's to count as it. */
const ARMBAND_COLOUR_DISTANCE = 42;
/**
 * The Cretins Meat Shields rents out, written here rather than read from the
 * painter: a gate that asks the painter who wears the band can only ever agree
 * with it.
 */
const MEAT_SHIELDS_HIRELINGS: readonly string[] = ['sledge', 'bomo'];
/** Pixels of armband a hireling's cell must show, at the bake's cell size. */
const MIN_ARMBAND_PIXELS = 6;

function armbandPixels(data: Uint8ClampedArray): number {
  const r = hexChannel(MEAT_SHIELDS_ORANGE, 0);
  const g = hexChannel(MEAT_SHIELDS_ORANGE, GREEN_CHANNEL);
  const b = hexChannel(MEAT_SHIELDS_ORANGE, BLUE_CHANNEL);
  let count = 0;
  for (let i = 0; i < data.length; i += CHANNELS) {
    if (data[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
    if (Math.hypot(data[i] - r, data[i + 1] - g, data[i + 2] - b) <= ARMBAND_COLOUR_DISTANCE)
      count++;
  }
  return count;
}

/**
 * Every hireling wears the orange band in every standing view — it is what
 * tells a hired Cretin from the club's own at a glance — and the escort-only
 * Cretins wear none: they are not Meat Shields.
 */
function gateArmband(): void {
  let measured = 0;
  for (const variant of CRETIN_VARIANTS) {
    const def = CRETIN_FIGURES[variant];
    for (const action of ['idle', 'walk'] as const) {
      for (const view of CRETIN_VIEWS) {
        const state = cretinStateName(action, view);
        const frames = framesOf(def, state, 'G11');
        for (let frame = 0; frame < frames; frame++) {
          measured++;
          const count = armbandPixels(pixelsOf(def, state, frame));
          const hireling = MEAT_SHIELDS_HIRELINGS.includes(variant);
          if (hireling !== cretinWearsArmband(variant)) {
            fail(
              'G11',
              `${variant}'s painter ${hireling ? 'omits' : 'paints'} the Meat Shields armband`,
            );
          }
          if (hireling && count < MIN_ARMBAND_PIXELS) {
            fail(
              'G11',
              `${def.id}.${state}[${frame}] shows ${count} armband pixels (floor ${MIN_ARMBAND_PIXELS})`,
            );
          }
          if (!hireling && count > 0) {
            fail(
              'G11',
              `${def.id}.${state}[${frame}] shows ${count} armband pixels but is not a Meat Shields hire`,
            );
          }
        }
      }
    }
  }
  failUnlessMeasured('G11', measured, 'standing frames');
}

// ── G12 the four can be told apart ───────────────────────────────────────────

/** Share of the cell two Cretins' standing frames must differ over, at the bake. */
const MIN_VARIANT_DIFFERENCE = 0.02;
const PERCEPTIBLE_STEP = 24;

/**
 * Pairwise, in every standing view: the four share one body, so everything
 * that tells them apart is paint, and paint that differs by less than this is
 * paint the eye cannot use at 32 px. A difference is not the right difference —
 * the lineup review is what says each one reads as itself.
 */
function gateVariantsDiffer(): void {
  let pairs = 0;
  for (const view of CRETIN_VIEWS) {
    const state = cretinStateName('idle', view);
    for (let i = 0; i < CRETIN_VARIANTS.length; i++) {
      for (let j = i + 1; j < CRETIN_VARIANTS.length; j++) {
        pairs++;
        const a = pixelsOf(CRETIN_FIGURES[CRETIN_VARIANTS[i]], state, 0);
        const b = pixelsOf(CRETIN_FIGURES[CRETIN_VARIANTS[j]], state, 0);
        let changed = 0;
        for (let p = 0; p < a.length; p += CHANNELS) {
          let moved = false;
          for (let c = 0; c < CHANNELS && !moved; c++)
            moved = Math.abs(a[p + c] - b[p + c]) >= PERCEPTIBLE_STEP;
          if (moved) changed++;
        }
        const share = changed / (a.length / CHANNELS);
        if (share >= MIN_VARIANT_DIFFERENCE) continue;
        fail(
          'G12',
          `${CRETIN_VARIANTS[i]} and ${CRETIN_VARIANTS[j]} differ over ${(share * PERCENT).toFixed(2)}% of ` +
            `the ${state} cell (floor ${(MIN_VARIANT_DIFFERENCE * PERCENT).toFixed(1)}%) — they read as one Cretin`,
        );
      }
    }
  }
  failUnlessMeasured('G12', pairs, 'variant pairs');
}

// ── G13 no row repeats a frame ───────────────────────────────────────────────

/**
 * The death settles a frame before it ends, so the corpse frame the runtime
 * holds while the body fades is the same picture as the one before it: a heap
 * still shifting on its last frame pops when the hold begins.
 */
function corpseHeld(state: string, earlier: number, later: number): boolean {
  return (
    state.startsWith('death') &&
    later === CRETIN_DEATH_CORPSE_FRAME &&
    earlier === CRETIN_DEATH_CORPSE_FRAME - 1
  );
}

function gateDistinctFrames(): void {
  for (const def of [...CRETIN_VARIANTS.map((v) => CRETIN_FIGURES[v]), CRETIN_SHIELD_FIGURE]) {
    const report = distinctFrameFailures(def, (state, frame) => pixelsOf(def, state, frame), {
      repeatsOnPurpose: corpseHeld,
    });
    for (const failure of report.failures) fail('G13', failure);
    failUnlessMeasured('G13', report.framesMeasured, `frames of ${def.id}`);
  }
}

// ── G14 warm-row size ────────────────────────────────────────────────────────

/**
 * The widest single state against the per-figure ceiling — a figure is
 * admitted to the cache one state at a time — and, reported, what every row
 * warm at once would cost.
 */
function gateWarmRows(): void {
  let states = 0;
  for (const def of [CRETIN_FIGURES.sledge, CRETIN_SHIELD_FIGURE]) {
    const cellBytes = def.frameWidth * def.frameHeight * BYTES_PER_PIXEL;
    let widest = 0;
    let widestState = '';
    let total = 0;
    for (const [state, declared] of def.states) {
      states++;
      total += declared.frames;
      if (declared.frames <= widest) continue;
      widest = declared.frames;
      widestState = state;
    }
    const budget = figureByteBudgetFor(def);
    const widestBytes = widest * cellBytes;
    console.log(
      `  G14 ${def.id}: widest row ${widestState} ${(widestBytes / BYTES_PER_MEGABYTE).toFixed(2)} MB; ` +
        `every row warm ${((total * cellBytes) / BYTES_PER_MEGABYTE).toFixed(2)} MB of ` +
        `${(budget / BYTES_PER_MEGABYTE).toFixed(0)} MB`,
    );
    if (widestBytes > budget) {
      fail(
        'G14',
        `${def.id}.${widestState} needs ${widestBytes} bytes against a ${budget}-byte budget`,
      );
    }
  }
  failUnlessMeasured('G14', states, 'declared states');
}

// ── G15 the death ends on a corpse ───────────────────────────────────────────

/**
 * A standing Cretin's solid ink is over the first. The corpse — a rubble mound
 * with the head sitting on top, and Sledge's hat on that — is under the given
 * share of the standing height.
 */
const MIN_STANDING_TILES = 1.8;
const MAX_CORPSE_SHARE_OF_STANDING = 0.5;

function gateDeathEndsOnCorpse(): void {
  let measured = 0;
  for (const variant of CRETIN_VARIANTS) {
    const def = CRETIN_FIGURES[variant];
    for (const view of CRETIN_VIEWS) {
      const state = cretinStateName('death', view);
      const frames = framesOf(def, state, 'G15');
      if (frames === 0) continue;
      measured++;
      const first = standingHeightTiles(def, state);
      const corpse = solidSpan(def, state, CRETIN_DEATH_CORPSE_FRAME);
      if (first < MIN_STANDING_TILES) {
        fail(
          'G15',
          `${def.id}.${state} starts ${first.toFixed(2)} tiles tall — it should start standing`,
        );
      }
      if (corpse === null) {
        fail('G15', `${def.id}.${state}'s corpse frame paints nothing to hold while it fades`);
        continue;
      }
      const tileBottom = def.tileY + def.tileScale;
      const corpseHeight = (tileBottom - corpse.top) / def.tileScale;
      const maxCorpse = first * MAX_CORPSE_SHARE_OF_STANDING;
      if (corpseHeight > maxCorpse) {
        fail(
          'G15',
          `${def.id}.${state}'s corpse frame stands ${corpseHeight.toFixed(2)} tiles high ` +
            `(ceiling ${maxCorpse.toFixed(2)}, half its standing height) — it is not rubble yet`,
        );
      }
    }
  }
  failUnlessMeasured('G15', measured, 'death rows');
}

// ── G16 the Shield is not the Protective Shell ───────────────────────────────

/**
 * How far apart in CIE76 ΔE the Shield's colour must sit from every colour
 * Carl's Protective Shell renders in. Around 2 is the smallest difference an
 * eye can see side by side and 10 reads as a slightly different shade of the
 * same paint; 20 is a different colour. Hue alone cannot do this: the Shell's
 * full power sits across orange to gold, the same hues as any amber, so the
 * Shield has to separate by saturation and value.
 */
const MIN_SHELL_DELTA_E = 20;
/**
 * The dome is taller than it is wide, and taller than the Shell's ring by a
 * margin. Measured on the shipped art: the dome's hold stands 1.20–1.23 as tall
 * as wide, every Shell frame 1.00.
 */
const MIN_DOME_ASPECT = 1.15;
const MIN_ASPECT_OVER_SHELL = 0.15;

/** sRGB to CIE L*a*b* (D65), for a ΔE a person would agree with. */
const SRGB_MAX = 255;
const SRGB_LINEAR_KNEE = 0.04045;
const SRGB_LINEAR_SLOPE = 12.92;
const SRGB_GAMMA_OFFSET = 0.055;
const SRGB_GAMMA_SCALE = 1.055;
const SRGB_GAMMA = 2.4;
/** The sRGB (D65) primaries' share of X, Y and Z, per linear channel. */
const X_FROM_R = 0.4124;
const X_FROM_G = 0.3576;
const X_FROM_B = 0.1805;
const Y_FROM_R = 0.2126;
const Y_FROM_G = 0.7152;
const Y_FROM_B = 0.0722;
const Z_FROM_R = 0.0193;
const Z_FROM_G = 0.1192;
const Z_FROM_B = 0.9505;
const RGB_TO_XYZ: readonly (readonly [number, number, number])[] = [
  [X_FROM_R, X_FROM_G, X_FROM_B],
  [Y_FROM_R, Y_FROM_G, Y_FROM_B],
  [Z_FROM_R, Z_FROM_G, Z_FROM_B],
];
const D65_WHITE_X = 0.95047;
const D65_WHITE_Z = 1.08883;
const D65_WHITE: readonly [number, number, number] = [D65_WHITE_X, 1, D65_WHITE_Z];
const LAB_EPSILON = 0.008856;
const LAB_KAPPA_SLOPE = 7.787;
const LAB_L_SCALE = 116;
const LAB_L_OFFSET = 16;
const LAB_OFFSET = LAB_L_OFFSET / LAB_L_SCALE;
const CUBE = 3;
const LAB_CUBE_ROOT = 1 / CUBE;
const LAB_A_SCALE = 500;
const LAB_B_SCALE = 200;

type Lab = readonly [number, number, number];

function labOf(r: number, g: number, b: number): Lab {
  const linear = [r, g, b].map((c) => {
    const v = c / SRGB_MAX;
    return v <= SRGB_LINEAR_KNEE
      ? v / SRGB_LINEAR_SLOPE
      : ((v + SRGB_GAMMA_OFFSET) / SRGB_GAMMA_SCALE) ** SRGB_GAMMA;
  });
  const [x, y, z] = RGB_TO_XYZ.map(
    (row, i) => (row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2]) / D65_WHITE[i],
  );
  const f = (t: number): number =>
    t > LAB_EPSILON ? t ** LAB_CUBE_ROOT : LAB_KAPPA_SLOPE * t + LAB_OFFSET;
  return [
    LAB_L_SCALE * f(y) - LAB_L_OFFSET,
    LAB_A_SCALE * (f(x) - f(y)),
    LAB_B_SCALE * (f(y) - f(z)),
  ];
}

function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

interface InkSummary {
  readonly colour: Lab;
  readonly aspect: number;
}

/** The alpha-weighted mean colour of a cell's visible pixels, and the shape of its ink. */
function inkSummary(def: FigureDef, state: string, frame: number): InkSummary | null {
  const data = pixelsOf(def, state, frame);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let weight = 0;
  let minX = def.frameWidth;
  let maxX = -1;
  let minY = def.frameHeight;
  let maxY = -1;
  for (let y = 0; y < def.frameHeight; y++) {
    for (let x = 0; x < def.frameWidth; x++) {
      const i = (y * def.frameWidth + x) * CHANNELS;
      const alpha = data[i + ALPHA_OFFSET];
      if (alpha < SHIELD_VISIBLE_ALPHA) continue;
      sumR += data[i] * alpha;
      sumG += data[i + 1] * alpha;
      sumB += data[i + 2] * alpha;
      weight += alpha;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (weight === 0) return null;
  return {
    colour: labOf(sumR / weight, sumG / weight, sumB / weight),
    aspect: (maxY - minY + 1) / (maxX - minX + 1),
  };
}

/**
 * The Shield against Carl's Protective Shell as the Shell actually renders:
 * every row of the shell and the cat's mini-shield, both variants, measured
 * off their own baked cells, so a Shell recolour is seen here without anyone
 * updating a list. Two independent reads, either of which alone tells them
 * apart at a glance: colour (ΔE against every Shell row) and shape (an upright
 * dome against a flat ring).
 */
function gateShieldLooksItsOwn(): void {
  const shellRows: InkSummary[] = [];
  for (const shell of PROTECTIVE_SHELL_FIGURES) {
    for (const [state, declared] of shell.states) {
      for (let frame = 0; frame < declared.frames; frame++) {
        const summary = inkSummary(shell, state, frame);
        if (summary !== null) shellRows.push(summary);
      }
    }
  }
  failUnlessMeasured('G16', shellRows.length, 'Protective Shell frames to compare against');
  const widestShell = Math.max(...shellRows.map((row) => row.aspect));

  const def = CRETIN_SHIELD_FIGURE;
  let measured = 0;
  for (const [state, declared] of def.states) {
    for (let frame = 0; frame < declared.frames; frame++) {
      const dome = inkSummary(def, state, frame);
      if (dome === null) {
        // The fade ends on a trace too faint to measure, so it cannot pop off.
        const fadeTail = state === 'fade' && frame === declared.frames - 1;
        if (!fadeTail) fail('G16', `the Shield's ${state}[${frame}] paints nothing visible`);
        continue;
      }
      measured++;
      const nearest = Math.min(...shellRows.map((row) => deltaE(dome.colour, row.colour)));
      if (nearest < MIN_SHELL_DELTA_E) {
        fail(
          'G16',
          `the Shield's ${state}[${frame}] is ${nearest.toFixed(1)} ΔE from a Protective Shell ` +
            `frame (floor ${MIN_SHELL_DELTA_E}) — the two spells read as one colour`,
        );
      }
      if (state !== 'hold') continue;
      if (dome.aspect < MIN_DOME_ASPECT || dome.aspect < widestShell + MIN_ASPECT_OVER_SHELL) {
        fail(
          'G16',
          `the Shield's hold[${frame}] is ${dome.aspect.toFixed(2)} as tall as wide against the ` +
            `Shell's ${widestShell.toFixed(2)} (floor ${MIN_DOME_ASPECT}, and ` +
            `${MIN_ASPECT_OVER_SHELL} over the Shell) — a ring, not a dome`,
        );
      }
    }
  }
  failUnlessMeasured('G16', measured, 'Shield frames');
}

/** Runs every gate and returns one message per failure. */
export function cretinGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateRowTable();
  gateGroundLine();
  gateLoops();
  gateLegReach();
  gateFootSlide();
  gateArmPhase();
  gatePunchImpact();
  gateCastFrame();
  gateTowersOverCarl();
  gateArmband();
  gateVariantsDiffer();
  gateDistinctFrames();
  gateWarmRows();
  gateDeathEndsOnCorpse();
  gateShieldLooksItsOwn();
  return [...failures];
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  console.log('Gating the Cretin figures…');
  reportFigureGates('cretins', cretinGateFailures());
}
