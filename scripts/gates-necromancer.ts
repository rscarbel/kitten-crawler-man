/**
 * Vordrick Boneharrow's art gates.
 *
 * Measured against cells painted from `NECROMANCER_FIGURE` the way the runtime
 * cache bakes them, so what is measured is what the game blits; the timing
 * gates read the pose stream and need no pixels. Failures accumulate so one
 * run reports everything, and a gate whose filter matches nothing fails rather
 * than passing on an empty loop.
 *
 * Run by the review harness: `npm run render:necromancer`.
 */

import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  inkBoxOf,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { LOCKED_TELEGRAPH_MIN_FRAMES } from '../src/creatures/mobLevelScaling.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import {
  CAST_BOLT_FRAMES,
  CAST_PULSE_CHANNEL_FROM,
  DEATH_FRAMES,
  DRIFT_FRAMES,
  NECROMANCER_FIGURE,
  NECROMANCER_ROWS,
  POSE_ORIGIN_X,
  POSE_ORIGIN_Y,
  TILE_SCALE,
  advanceDriftFrame,
  necromancerTicksToEvent,
  necromancerRow,
  type NecromancerRowSpec,
} from '../src/sprites/art/necromancerFigure.js';
import {
  NECROMANCER_HEAD_HEIGHT,
  lanternGlowRadius,
  paintedLanternPoint,
} from '../src/sprites/art/necromancerArt.js';
import {
  NECROMANCER_DRAWN_STATES,
  NECROMANCER_HEAD_ABOVE_TILE_TILES,
  NECROMANCER_ARRIVAL_ROWS,
  NECROMANCER_BLINK_ROWS,
  NECROMANCER_CASTS,
  NECROMANCER_STANDING_ROWS,
} from '../src/sprites/necromancerSprite.js';
import { SOUL_MID, hollowSoulPalette, type SoulRgb } from '../src/sprites/soulPalette.js';
import { RAT_KIN_FIGURE, ORIGIN_Y as RAT_KIN_ORIGIN_Y } from '../src/sprites/art/ratKinFigure.js';

const CHANNELS = 4;
const PERCENT = 100;
const ALPHA_OFFSET = 3;
const SOLID_ALPHA = 128;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const BYTES_PER_PIXEL = 4;

const { frameWidth, frameHeight } = NECROMANCER_FIGURE;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Cells ────────────────────────────────────────────────────────────────────

const cellsByKey = new Map<string, Uint8ClampedArray>();

function cellRgba(state: string, frame: number): Uint8ClampedArray {
  const key = `${state}[${frame}]`;
  const cached = cellsByKey.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(NECROMANCER_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  cellsByKey.set(key, data);
  return data;
}

function rowNamed(gateId: string, state: string): NecromancerRowSpec | undefined {
  const row = necromancerRow(state);
  if (row === undefined) fail(gateId, `the figure has no row "${state}"`);
  return row;
}

/** Rec. 709 luma weights. */
const LUMA_RED = 0.2126;
const LUMA_GREEN = 0.7152;
const LUMA_BLUE = 0.0722;

function luminance(r: number, g: number, b: number): number {
  return LUMA_RED * r + LUMA_GREEN * g + LUMA_BLUE * b;
}

/** The highest solid pixel inside a column band, in cell pixels, or null. */
function topSolidInBand(data: Uint8ClampedArray, fromX: number, toX: number): number | null {
  for (let y = 0; y < frameHeight; y++) {
    for (let x = Math.max(0, fromX); x <= Math.min(frameWidth - 1, toX); x++) {
      if (data[(y * frameWidth + x) * CHANNELS + ALPHA_OFFSET] >= SOLID_ALPHA) return y;
    }
  }
  return null;
}

function solidCount(data: Uint8ClampedArray): number {
  let n = 0;
  for (let i = ALPHA_OFFSET; i < data.length; i += CHANNELS) if (data[i] >= SOLID_ALPHA) n++;
  return n;
}

// ── G1 structural, G2 reachable states ──────────────────────────────────────

function structuralGates(): void {
  for (const failure of figureStructuralFailures(NECROMANCER_FIGURE)) fail('G1 structure', failure);
  for (const failure of missingStateFailures(
    NECROMANCER_FIGURE,
    NECROMANCER_DRAWN_STATES,
    'drawNecromancerSprite',
  )) {
    fail('G2 states', failure);
  }
  // Spelt out here rather than through the figure's own name builder, so a
  // drifted name is caught; every cast has a head-on row named by the bare action.
  const prewarmed = [
    ...[...NECROMANCER_ARRIVAL_ROWS, ...NECROMANCER_STANDING_ROWS, ...NECROMANCER_BLINK_ROWS].map(
      (row) => (row.view === 'front' ? row.action : `${row.action}_${row.view}`),
    ),
    ...NECROMANCER_CASTS,
  ];
  for (const failure of missingStateFailures(NECROMANCER_FIGURE, prewarmed, 'the prewarm list')) {
    fail('G2 states', failure);
  }
}

// ── G3 size against a ratkin, G4 heads tall, G5 frozen head clearance ────────

/** Half-width of the column band the crown is looked for in, in tiles. */
const CROWN_BAND_TILES = 0.18;
/** He stands twice a ratkin's height; the band the ratio may sit in. */
const MIN_RATKIN_RATIO = 1.85;
const MAX_RATKIN_RATIO = 2.3;
/** Heads tall a figure needs to read as tall rather than as big. A ratkin is about 2.5. */
const MIN_HEADS_TALL = 5.5;
/** How far the frozen health-bar clearance may drift from the crown it clears. */
const HEAD_CLEARANCE_SLACK_TILES = 0.08;

function crownHeightTiles(): number | null {
  const data = cellRgba('idle', 0);
  const band = Math.round(CROWN_BAND_TILES * TILE_SCALE);
  const top = topSolidInBand(data, POSE_ORIGIN_X - band, POSE_ORIGIN_X + band);
  return top === null ? null : (POSE_ORIGIN_Y - top) / TILE_SCALE;
}

function sizeGates(): void {
  const crown = crownHeightTiles();
  if (crown === null) {
    fail('G3 size', 'found no solid ink above the idle front frame’s feet');
    return;
  }
  let ratkinHeight: number | null = null;
  try {
    const box = inkBoxOf(RAT_KIN_FIGURE, 'idle', 0);
    ratkinHeight = box === null ? null : (RAT_KIN_ORIGIN_Y - box.minY) / TILE_SCALE;
  } catch (error) {
    fail('G3 size', `could not paint the ratkin to measure against: ${String(error)}`);
  }
  if (ratkinHeight === null) {
    fail('G3 size', 'the ratkin idle painted nothing to measure against');
  } else {
    const ratio = crown / ratkinHeight;
    console.log(
      `  G3 crown ${crown.toFixed(2)} tiles against a ratkin's ${ratkinHeight.toFixed(2)} — ${ratio.toFixed(2)}×`,
    );
    if (ratio < MIN_RATKIN_RATIO || ratio > MAX_RATKIN_RATIO) {
      fail(
        'G3 size',
        `he stands ${ratio.toFixed(2)}× a ratkin; he must read at about twice one ` +
          `(${MIN_RATKIN_RATIO}–${MAX_RATKIN_RATIO})`,
      );
    }
  }
  const heads = crown / NECROMANCER_HEAD_HEIGHT;
  console.log(`  G4 ${heads.toFixed(1)} heads tall`);
  if (heads < MIN_HEADS_TALL) {
    fail(
      'G4 heads',
      `${heads.toFixed(1)} heads tall, under ${MIN_HEADS_TALL}: a big head on a big body reads as big, not tall`,
    );
  }
  const tileTop = NECROMANCER_FIGURE.tileY;
  const crownAboveTile = (tileTop - (POSE_ORIGIN_Y - crown * TILE_SCALE)) / TILE_SCALE;
  if (Math.abs(crownAboveTile - NECROMANCER_HEAD_ABOVE_TILE_TILES) > HEAD_CLEARANCE_SLACK_TILES) {
    fail(
      'G5 head clearance',
      `the crown stands ${crownAboveTile.toFixed(2)} tiles above the tile but ` +
        `NECROMANCER_HEAD_ABOVE_TILE_TILES is ${NECROMANCER_HEAD_ABOVE_TILE_TILES}; re-measure it`,
    );
  }
}

// ── G6 the lantern is the brightest point ────────────────────────────────────

/** How far from the lantern's centre the brightest pixel may land, in tiles. */
const BRIGHTEST_NEAR_LANTERN_TILES = 0.2;
/** A flaring lantern's white-hot core spreads over this much of its glow. */
const GLOW_CORE_SHARE = 0.6;

/** Rows where the lantern is lit and whole: not the burst or the fray. */
function lanternLitFrames(): { row: NecromancerRowSpec; frame: number }[] {
  const frames: { row: NecromancerRowSpec; frame: number }[] = [];
  for (const row of NECROMANCER_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = row.pose(frame);
      if (pose.cageBurst > 0 || pose.fray > 0) continue;
      frames.push({ row, frame });
    }
  }
  return frames;
}

function brightestGate(): void {
  let measured = 0;
  for (const { row, frame } of lanternLitFrames()) {
    const data = cellRgba(row.name, frame);
    let best = -1;
    let bestX = 0;
    let bestY = 0;
    for (let i = 0; i < data.length; i += CHANNELS) {
      if (data[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      const lum = luminance(data[i], data[i + 1], data[i + 2]);
      if (lum > best) {
        best = lum;
        const pixel = i / CHANNELS;
        bestX = pixel % frameWidth;
        bestY = Math.floor(pixel / frameWidth);
      }
    }
    measured++;
    const pose = row.pose(frame);
    const lantern = paintedLanternPoint(row.view, pose);
    const lx = POSE_ORIGIN_X + lantern.x * TILE_SCALE;
    const ly = POSE_ORIGIN_Y + lantern.y * TILE_SCALE;
    const off = Math.hypot(bestX - lx, bestY - ly) / TILE_SCALE;
    // A lantern thrust at the camera is drawn larger, and a flaring one burns
    // white further out into its own glow.
    if (
      off >
      Math.max(
        BRIGHTEST_NEAR_LANTERN_TILES * pose.lanternScale,
        lanternGlowRadius(pose) * GLOW_CORE_SHARE,
      )
    ) {
      fail(
        'G6 brightest',
        `${row.name}[${frame}]'s brightest pixel is ${off.toFixed(2)} tiles from the lantern, ` +
          `at (${bestX},${bestY}); the soul-lantern must be the brightest thing on him`,
      );
    }
  }
  failUnlessMeasured('G6 brightest', measured, 'frames with a lit lantern');
}

// ── G7 the rim is a light, not an outline ────────────────────────────────────

/** A rim pixel is blue-dominant and bright enough to be light on black cloth. */
function isRimPixel(r: number, g: number, b: number): boolean {
  return b >= RIM_MIN_BLUE && b - r >= RIM_MIN_BLUE_LEAD && b > g;
}
const RIM_MIN_BLUE = 110;
const RIM_MIN_BLUE_LEAD = 45;
/** Measured between the glow's own reach and a tile and a half out. */
const RIM_NEAR_BAND_FROM_TILES = 0.45;
const RIM_NEAR_BAND_TO_TILES = 1.3;
/** Past this distance from the lantern the rim must have faded to almost nothing. */
const RIM_FAR_FROM_TILES = 1.7;
const MIN_NEAR_RIM_PIXELS = 25;
const MAX_FAR_RIM_SHARE = 0.25;

function rimGate(): void {
  let measured = 0;
  for (const state of ['idle', 'idle_side', 'idle_away', 'drift', 'drift_side', 'drift_away']) {
    const row = rowNamed('G7 rim', state);
    if (row === undefined) continue;
    const data = cellRgba(state, 0);
    const lantern = paintedLanternPoint(row.view, row.pose(0));
    const lx = POSE_ORIGIN_X + lantern.x * TILE_SCALE;
    const ly = POSE_ORIGIN_Y + lantern.y * TILE_SCALE;
    let near = 0;
    let far = 0;
    for (let i = 0; i < data.length; i += CHANNELS) {
      if (data[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      if (!isRimPixel(data[i], data[i + 1], data[i + 2])) continue;
      const pixel = i / CHANNELS;
      const d =
        Math.hypot((pixel % frameWidth) - lx, Math.floor(pixel / frameWidth) - ly) / TILE_SCALE;
      if (d >= RIM_NEAR_BAND_FROM_TILES && d <= RIM_NEAR_BAND_TO_TILES) near++;
      if (d >= RIM_FAR_FROM_TILES) far++;
    }
    measured++;
    if (near < MIN_NEAR_RIM_PIXELS) {
      fail(
        'G7 rim',
        `${state}[0] has ${near} rim pixels near the lantern (need ${MIN_NEAR_RIM_PIXELS}); ` +
          'near-black robes vanish against the ground without the lantern’s bounce light',
      );
    }
    if (far > near * MAX_FAR_RIM_SHARE) {
      fail(
        'G7 rim',
        `${state}[0] has ${far} rim pixels far from the lantern against ${near} near it; ` +
          'a rim lit evenly all the way round is an outline, not a light',
      );
    }
  }
  failUnlessMeasured('G7 rim', measured, 'rows');
}

// ── G8 the blue is not the lich's green ─────────────────────────────────────

function hueOf([r, g, b]: SoulRgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma === 0) return 0;
  const sector = 60;
  if (max === r) return (sector * ((g - b) / chroma) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;
  if (max === g) return sector * ((b - r) / chroma + 2);
  return sector * ((r - g) / chroma + BLUE_SECTOR_OFFSET);
}
const FULL_TURN_DEGREES = 360;
/** Where the blue-dominant sector of the hue wheel starts, in sectors of 60°. */
const BLUE_SECTOR_OFFSET = 4;
const BLUE_HUE_FROM = 200;
const BLUE_HUE_TO = 235;
const MIN_HUE_SEPARATION = 90;

function paletteGate(): void {
  const blue = hueOf(hollowSoulPalette.mid);
  const green = hueOf(SOUL_MID);
  const separation = Math.min(Math.abs(blue - green), FULL_TURN_DEGREES - Math.abs(blue - green));
  if (blue < BLUE_HUE_FROM || blue > BLUE_HUE_TO) {
    fail('G8 palette', `the hollow soul-light's hue is ${blue.toFixed(0)}°, not a cold blue`);
  }
  if (separation < MIN_HUE_SEPARATION) {
    fail(
      'G8 palette',
      `the hollow blue sits ${separation.toFixed(0)}° from the lich's green; they must read as two casters`,
    );
  }
}

// ── G9 loops close, G10 frames are distinct ─────────────────────────────────

function changedPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let changed = 0;
  const step = 12;
  for (let i = 0; i < a.length; i += CHANNELS) {
    for (let c = 0; c < CHANNELS; c++) {
      if (Math.abs(a[i + c] - b[i + c]) >= step) {
        changed++;
        break;
      }
    }
  }
  return changed;
}

/** The seam must be an ordinary step: not a jump, and not a held frame either. */
const SEAM_MAX_OF_MEDIAN = 1.6;
const SEAM_MIN_OF_MEDIAN = 0.3;

function loopGates(): void {
  let measured = 0;
  for (const row of NECROMANCER_ROWS) {
    const loopFrom = row.kind === 'loop' ? 0 : row.loopFrom;
    if (loopFrom === undefined) continue;
    const steps: number[] = [];
    for (let f = loopFrom + 1; f < row.frameCount; f++) {
      steps.push(changedPixels(cellRgba(row.name, f - 1), cellRgba(row.name, f)));
    }
    const seam = changedPixels(
      cellRgba(row.name, row.frameCount - 1),
      cellRgba(row.name, loopFrom),
    );
    const sorted = [...steps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    measured++;
    if (median === 0) {
      fail('G9 loop', `${row.name} does not move at all between frames`);
      continue;
    }
    const ratio = seam / median;
    if (ratio > SEAM_MAX_OF_MEDIAN || ratio < SEAM_MIN_OF_MEDIAN) {
      fail(
        'G9 loop',
        `${row.name}'s seam back to frame ${loopFrom} is ${ratio.toFixed(2)}× its median step ` +
          `(band ${SEAM_MIN_OF_MEDIAN}–${SEAM_MAX_OF_MEDIAN}): a hitch or a held frame once a loop`,
      );
    }
  }
  failUnlessMeasured('G9 loop', measured, 'looping rows');

  const report = distinctFrameFailures(NECROMANCER_FIGURE, cellRgba, {
    // The death holds its heap once it has settled; that hold is the terminal phase.
    repeatsOnPurpose: (state, earlier) => state === 'death' && earlier >= DEATH_SETTLED_FROM,
  });
  for (const failure of report.failures) fail('G10 distinct', failure);
  failUnlessMeasured('G10 distinct', report.framesMeasured, 'frames');
}

/** The frame from which the death's heap has settled and holds. */
const DEATH_HELD_FRAMES = 3;
const DEATH_SETTLED_FROM = DEATH_FRAMES - DEATH_HELD_FRAMES;

// ── G11 event frames sit on the picture ─────────────────────────────────────

/** Where in the raise the dead are called up, as a share of the row. */
const RAISE_RELEASE_FROM = 0.6;
const RAISE_RELEASE_TO = 0.8;

function eventGates(): void {
  const raise = rowNamed('G11 events', 'cast_raise');
  if (raise !== undefined) {
    const release = raise.eventFrames?.release;
    let peak = 0;
    let peakFrame = -1;
    for (let f = 0; f < raise.frameCount; f++) {
      const glow = raise.pose(f).lanternGlow;
      if (glow > peak) {
        peak = glow;
        peakFrame = f;
      }
    }
    const releaseShare = release === undefined ? -1 : release / (raise.frameCount - 1);
    if (releaseShare < RAISE_RELEASE_FROM || releaseShare > RAISE_RELEASE_TO) {
      fail(
        'G11 events',
        `cast_raise releases ${Math.round(releaseShare * PERCENT)}% of the way through; the dead ` +
          'rise late in the cast, after a long readable wind-up',
      );
    }
    if (release === undefined || Math.abs(release - peakFrame) > 1) {
      fail(
        'G11 events',
        `cast_raise releases on ${release} but the lantern flares on ${peakFrame}`,
      );
    }
  }
  for (const state of ['cast_bolt', 'cast_bolt_side', 'cast_bolt_away']) {
    const row = rowNamed('G11 events', state);
    if (row === undefined) continue;
    const release = row.eventFrames?.release;
    // The volley leaves at the end of the thrust: the frame the lantern has
    // travelled furthest from where it rests.
    const rest = paintedLanternPoint(row.view, row.pose(0));
    let furthest = -1;
    let furthestFrame = -1;
    for (let f = 0; f < CAST_BOLT_FRAMES; f++) {
      const p = row.pose(f);
      const at = paintedLanternPoint(row.view, p);
      const reach = Math.hypot(at.x - rest.x, at.y - rest.y) + Math.abs(p.lanternScale - 1);
      if (reach > furthest) {
        furthest = reach;
        furthestFrame = f;
      }
    }
    if (release === undefined || Math.abs(release - furthestFrame) > 1) {
      fail(
        'G11 events',
        `${state} releases on ${release} but the thrust peaks on ${furthestFrame}`,
      );
    }
  }
  for (const state of ['cast_pulse', 'cast_pulse_side', 'cast_pulse_away']) {
    const row = rowNamed('G11 events', state);
    if (row === undefined) continue;
    const plant = row.eventFrames?.plant;
    const firstCrack = Array.from(
      { length: row.frameCount },
      (_u, f) => row.pose(f).cracks,
    ).findIndex((c) => c > 0);
    if (plant === undefined || firstCrack < plant || firstCrack > plant + 1) {
      fail(
        'G11 events',
        `${state} plants on ${plant} but the ground first cracks on ${firstCrack}`,
      );
    }
    if (row.loopFrom !== CAST_PULSE_CHANNEL_FROM) {
      fail('G11 events', `${state} does not declare its channel loop`);
    }
  }
}

// ── G12 terminal death, G13 blink ends ──────────────────────────────────────

/** The settled heap: at most this share of the last frame's pixels may change on the frame before. */
const MAX_SETTLED_CHANGE = 0.01;
/** Blue-lit pixels the dead heap may still show — the lantern is out. */
const MAX_DEAD_BLUE_PIXELS = 12;
const BLINK_GONE_SHARE = 0.03;
const BLINK_BACK_SHARE = 0.9;

function terminalGates(): void {
  const last = cellRgba('death', DEATH_FRAMES - 1);
  const before = cellRgba('death', DEATH_FRAMES - 2);
  const change = changedPixels(last, before) / (frameWidth * frameHeight);
  if (change > MAX_SETTLED_CHANGE) {
    fail(
      'G12 death',
      `the heap still moves into the held last frame (${(change * PERCENT).toFixed(2)}% changes)`,
    );
  }
  let blue = 0;
  for (let i = 0; i < last.length; i += CHANNELS) {
    if (last[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
    if (isRimPixel(last[i], last[i + 1], last[i + 2])) blue++;
  }
  if (blue > MAX_DEAD_BLUE_PIXELS) {
    fail('G12 death', `the held death frame still has ${blue} blue-lit pixels; the lantern is out`);
  }
  const whole = solidCount(cellRgba('idle', 0));
  const gone = solidCount(cellRgba('blink_out', figureFrames('blink_out') - 1));
  const back = solidCount(cellRgba('blink_in', figureFrames('blink_in') - 1));
  if (gone > whole * BLINK_GONE_SHARE) {
    fail('G13 blink', `blink_out ends with ${gone} solid pixels of his ${whole}; he must be gone`);
  }
  if (back < whole * BLINK_BACK_SHARE) {
    fail(
      'G13 blink',
      `blink_in ends with ${back} solid pixels of his ${whole}; he must be whole again`,
    );
  }
}

function figureFrames(state: string): number {
  return NECROMANCER_FIGURE.states.get(state)?.frames ?? 0;
}

// ── G14 drift pacing ────────────────────────────────────────────────────────

const TEST_TILE = 32;
/**
 * The least a stationary tick may advance the drift: enough to cycle the hem
 * in a few seconds. Held here, not read off the figure's own constant, so the
 * gate cannot agree with whatever that constant is set to.
 */
const MIN_STILL_DRIFT_STEP = 0.02;
/** Past one frame a tick the row is undersampled and strobes. */
const MAX_DRIFT_STEP = 1;
/** A drift frame this close to the end of the row, so one tick must wrap it. */
const FRAME_JUST_BEFORE_WRAP = 0.01;
const SHOVE_PIXELS = 40;

function driftGate(): void {
  const still = advanceDriftFrame(0, 0, TEST_TILE);
  if (still < MIN_STILL_DRIFT_STEP) {
    fail('G14 drift', 'a stationary tick does not advance the drift; the hem would freeze');
  }
  const shoved = advanceDriftFrame(0, SHOVE_PIXELS, TEST_TILE);
  if (shoved > MAX_DRIFT_STEP) {
    fail(
      'G14 drift',
      `a shove advances the drift ${shoved.toFixed(2)} frames in a tick; it would strobe`,
    );
  }
  const wrapped = advanceDriftFrame(DRIFT_FRAMES - FRAME_JUST_BEFORE_WRAP, TEST_TILE, TEST_TILE);
  if (wrapped < 0 || wrapped >= DRIFT_FRAMES)
    fail('G14 drift', `the drift frame wraps to ${wrapped}`);
}

// ── G15 budget ──────────────────────────────────────────────────────────────

function budgetGate(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widest = 0;
  let widestState = '';
  let total = 0;
  for (const [state, declared] of NECROMANCER_FIGURE.states) {
    const bytes = declared.frames * cellBytes;
    total += bytes;
    if (bytes > widest) {
      widest = bytes;
      widestState = state;
    }
  }
  const budget = figureByteBudgetFor(NECROMANCER_FIGURE);
  console.log(
    `  G15 widest row ${widestState} ${(widest / BYTES_PER_MEGABYTE).toFixed(2)} MB of a ` +
      `${(budget / BYTES_PER_MEGABYTE).toFixed(0)} MB budget; every row warm would be ` +
      `${(total / BYTES_PER_MEGABYTE).toFixed(1)} MB`,
  );
  if (widest > budget) fail('G15 budget', `${widestState} alone outgrows the figure's budget`);
}

// ── G16 telegraphs meet the reaction floor ──────────────────────────────────

function telegraphGate(): void {
  let measured = 0;
  for (const row of NECROMANCER_ROWS) {
    for (const event of ['release', 'plant'] as const) {
      const ticks = necromancerTicksToEvent(row, event);
      if (ticks === undefined) continue;
      measured++;
      if (ticks < LOCKED_TELEGRAPH_MIN_FRAMES) {
        fail(
          'G16 telegraph',
          `${row.name} reaches its ${event} after ${ticks} ticks, under the ` +
            `${LOCKED_TELEGRAPH_MIN_FRAMES}-tick locked-telegraph floor`,
        );
      }
    }
  }
  failUnlessMeasured('G16 telegraph', measured, 'cast events');
}

/** Runs every gate and returns the failures. */
export function necromancerGateFailures(): string[] {
  failures.length = 0;
  structuralGates();
  sizeGates();
  brightestGate();
  rimGate();
  paletteGate();
  loopGates();
  eventGates();
  terminalGates();
  driftGate();
  budgetGate();
  telegraphGate();
  return [...failures];
}
