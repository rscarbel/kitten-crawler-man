/**
 * Splash Zone's art gates: the otter hireling and his bolt, wave and splash.
 *
 * Pose-stream gates measure the choreography itself; pixel gates measure cells
 * painted from the figures exactly the way the runtime cache bakes them, so
 * what is measured is what the game blits.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing.
 *
 *   npm run gates:splash-zone        (also run first by `npm run render:splash-zone`)
 */

import type { Canvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import {
  SPLASH_ZONE_ARMBAND_COLOR,
  legReachShare,
  otterSilhouetteRatios,
} from '../src/sprites/art/splashZoneArt.js';
import {
  BOLT_STATE,
  OTTER_TILE_Y,
  SPLASH_STATE,
  SPLASH_ZONE_BOLT_FIGURE,
  SPLASH_ZONE_EFFECT_FIGURES,
  SPLASH_ZONE_FIGURE,
  SPLASH_ZONE_ROWS,
  SPLASH_ZONE_SPLASH_FIGURE,
  SPLASH_ZONE_STANDING_TOP_ABOVE_TILE,
  SPLASH_ZONE_VIEWS,
  SPLASH_ZONE_WAVE_FIGURE,
  TILE_SCALE,
  WAVE_STATE,
  splashZonePoseAt,
  splashZoneStateName,
  type SplashZoneRow,
} from '../src/sprites/art/splashZoneFigure.js';
import { CLUB_ZONES } from '../src/core/clubLayout.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  SPLASH_ZONE_BOLT_FRAMES,
  SPLASH_ZONE_CAST_WAVE_FRAMES,
  SPLASH_ZONE_CAST_WAVE_RELEASE_FRAME,
  SPLASH_ZONE_DEATH_FRAMES,
  SPLASH_ZONE_HURT_FRAMES,
  SPLASH_ZONE_IDLE_FRAMES,
  SPLASH_ZONE_SHOOT_FRAMES,
  SPLASH_ZONE_SHOOT_RELEASE_FRAME,
  SPLASH_ZONE_SPLASH_FRAMES,
  SPLASH_ZONE_WALK_FRAMES,
  SPLASH_ZONE_WAVE_FRAMES,
} from '../src/sprites/splashZoneTiming.js';
import { splashZoneReachableStates } from '../src/sprites/splashZoneSprite.js';

const CHANNELS = 4;
const RED = 0;
const GREEN = 1;
const BLUE = 2;
const ALPHA = 3;
/**
 * Alpha above which a pixel is the otter rather than the soft contact shadow
 * under him. An anchor gate measured on ordinary ink measures the shadow, which
 * sits on the ground line whether or not the feet do.
 */
const SOLID_ALPHA = 200;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_KIBIBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
/** Turns a 0-1 share into the percentage a failure message reads in. */
const PERCENT = 100;
const HEX_PAIR = 2;
const RGB_CHANNELS = 3;
const FROZEN_DECIMALS = 4;
const HEX_RADIX = 16;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
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

function alphaAt(data: Uint8ClampedArray, def: FigureDef, x: number, y: number): number {
  return data[(y * def.frameWidth + x) * CHANNELS + ALPHA];
}

/** Mean absolute alpha difference between two frames of a state, 0..255. */
function frameDelta(def: FigureDef, state: string, a: number, b: number): number {
  const first = pixelsOf(def, state, a);
  const second = pixelsOf(def, state, b);
  let total = 0;
  for (let i = ALPHA; i < first.length; i += CHANNELS) total += Math.abs(first[i] - second[i]);
  return total / (first.length / CHANNELS);
}

interface SolidBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function solidBoxOf(def: FigureDef, state: string, frame: number): SolidBox | null {
  const data = pixelsOf(def, state, frame);
  let minX = def.frameWidth;
  let minY = def.frameHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < def.frameHeight; y++) {
    for (let x = 0; x < def.frameWidth; x++) {
      if (alphaAt(data, def, x, y) < SOLID_ALPHA) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

function frameCountOf(def: FigureDef, state: string): number {
  return def.states.get(state)?.frames ?? 0;
}

// ── G1 structure ─────────────────────────────────────────────────────────────

function gateStructure(): void {
  for (const failure of figureStructuralFailures(SPLASH_ZONE_FIGURE)) fail('G1', failure);
  // The bolt's motion streak is authored to trail off the back of its cell.
  for (const failure of figureStructuralFailures(SPLASH_ZONE_BOLT_FIGURE, {
    bleedEdges: ['left'],
  })) {
    fail('G1', failure);
  }
  for (const failure of figureStructuralFailures(SPLASH_ZONE_WAVE_FIGURE)) fail('G1', failure);
  // The splash is sized for its biggest frame, the crown at full height with
  // the ripple at full spread; it is a burst, so no one frame fills the cell.
  for (const failure of figureStructuralFailures(SPLASH_ZONE_SPLASH_FIGURE, {
    minInkAreaShare: SPLASH_MIN_FILL,
  })) {
    fail('G1', failure);
  }
}

const SPLASH_MIN_FILL = 0.1;

// ── G2 every state the runtime can ask for is painted ────────────────────────

function gateReachableStates(): void {
  for (const failure of missingStateFailures(
    SPLASH_ZONE_FIGURE,
    splashZoneReachableStates(),
    'splashZoneReachableStates()',
  )) {
    fail('G2', failure);
  }
}

// ── G3 row lengths match the timing module ───────────────────────────────────

/**
 * The frame counts the kit's timing is computed against. Written out here from
 * the timing module rather than read off the row table, so a row that stops
 * being built from its timing constant is caught instead of agreeing with itself.
 */
const EXPECTED_FRAMES: Readonly<Record<SplashZoneRow, number>> = {
  idle: SPLASH_ZONE_IDLE_FRAMES,
  walk: SPLASH_ZONE_WALK_FRAMES,
  shoot: SPLASH_ZONE_SHOOT_FRAMES,
  cast_wave: SPLASH_ZONE_CAST_WAVE_FRAMES,
  hurt: SPLASH_ZONE_HURT_FRAMES,
  death: SPLASH_ZONE_DEATH_FRAMES,
};

const EXPECTED_EFFECT_FRAMES: ReadonlyArray<readonly [FigureDef, string, number]> = [
  [SPLASH_ZONE_BOLT_FIGURE, BOLT_STATE, SPLASH_ZONE_BOLT_FRAMES],
  [SPLASH_ZONE_WAVE_FIGURE, WAVE_STATE, SPLASH_ZONE_WAVE_FRAMES],
  [SPLASH_ZONE_SPLASH_FIGURE, SPLASH_STATE, SPLASH_ZONE_SPLASH_FRAMES],
];

function gateRowLengths(): void {
  let measured = 0;
  for (const spec of SPLASH_ZONE_ROWS) {
    for (const view of SPLASH_ZONE_VIEWS) {
      const state = splashZoneStateName(spec.row, view);
      const frames = frameCountOf(SPLASH_ZONE_FIGURE, state);
      measured++;
      if (frames !== EXPECTED_FRAMES[spec.row]) {
        fail(
          'G3',
          `${state} paints ${frames} frames; the timing module says ${EXPECTED_FRAMES[spec.row]}`,
        );
      }
    }
  }
  for (const [def, state, expected] of EXPECTED_EFFECT_FRAMES) {
    measured++;
    const frames = frameCountOf(def, state);
    if (frames !== expected) {
      fail('G3', `${def.id}.${state} paints ${frames} frames; the timing module says ${expected}`);
    }
  }
  failUnlessMeasured('G3', measured, 'rows');
}

// ── G4 the release frames show the release ───────────────────────────────────

/**
 * The kit spawns the bolt and the wave on the release frame, so the frame
 * before it must still show them in hand and the release frame must show them
 * gone. In every view: the three views share the timing, and a view whose
 * choreography drifted would fire from a loaded crossbow.
 */
function gateReleaseFrames(): void {
  let measured = 0;
  for (const view of SPLASH_ZONE_VIEWS) {
    const shoot = splashZoneStateName('shoot', view);
    const before = splashZonePoseAt(shoot, SPLASH_ZONE_SHOOT_RELEASE_FRAME - 1);
    const at = splashZonePoseAt(shoot, SPLASH_ZONE_SHOOT_RELEASE_FRAME);
    if (before === null || at === null) {
      fail('G4', `${shoot} has no pose at its release frame ${SPLASH_ZONE_SHOOT_RELEASE_FRAME}`);
    } else {
      measured++;
      if (!before.crossbow.loaded) {
        fail(
          'G4',
          `${shoot}[${SPLASH_ZONE_SHOOT_RELEASE_FRAME - 1}] is already empty before the release frame`,
        );
      }
      if (at.crossbow.loaded || at.crossbow.cocked > 0) {
        fail(
          'G4',
          `${shoot}[${SPLASH_ZONE_SHOOT_RELEASE_FRAME}] still shows a loaded, cocked crossbow on the release frame`,
        );
      }
    }

    const cast = splashZoneStateName('cast_wave', view);
    const gathering = splashZonePoseAt(cast, SPLASH_ZONE_CAST_WAVE_RELEASE_FRAME - 1);
    const thrown = splashZonePoseAt(cast, SPLASH_ZONE_CAST_WAVE_RELEASE_FRAME);
    if (gathering === null || thrown === null) {
      fail('G4', `${cast} has no pose at its release frame ${SPLASH_ZONE_CAST_WAVE_RELEASE_FRAME}`);
    } else {
      measured++;
      if (gathering.waterThrow > 0 || gathering.water <= 0) {
        fail(
          'G4',
          `${cast}[${SPLASH_ZONE_CAST_WAVE_RELEASE_FRAME - 1}] should hold the gathered water, not throw it`,
        );
      }
      if (thrown.waterThrow <= 0 || thrown.water > 0) {
        fail(
          'G4',
          `${cast}[${SPLASH_ZONE_CAST_WAVE_RELEASE_FRAME}] should show the water leaving the paws`,
        );
      }
    }
  }
  failUnlessMeasured('G4', measured, 'release frames');
}

// ── G5 standing on the ground line ───────────────────────────────────────────

/** The cell row the tile's bottom edge — the ground — falls on. */
const GROUND_ROW = OTTER_TILE_Y + TILE_SCALE;
/** A sole may reach a pixel or two past the line; it may never float above it. */
const GROUND_BELOW_TOLERANCE = 3;
/**
 * From behind, his tail lies on the floor between him and the camera, so it
 * draws a little lower on the screen than his soles do.
 */
const AWAY_TAIL_BELOW_TOLERANCE = 9;
/**
 * Head-on, the water he throws lands on the floor in front of his feet and
 * rolls toward the camera, so it draws below his soles.
 */
const FRONT_THROW_BELOW_TOLERANCE = 12;
const GROUND_ABOVE_TOLERANCE = 2;
const STANDING_ROWS: readonly SplashZoneRow[] = ['idle', 'walk', 'shoot', 'cast_wave', 'hurt'];

function gateGroundLine(): void {
  let measured = 0;
  for (const row of STANDING_ROWS) {
    for (const view of SPLASH_ZONE_VIEWS) {
      const state = splashZoneStateName(row, view);
      for (let frame = 0; frame < frameCountOf(SPLASH_ZONE_FIGURE, state); frame++) {
        const box = solidBoxOf(SPLASH_ZONE_FIGURE, state, frame);
        if (box === null) {
          fail('G5', `${state}[${frame}] has no solid pixels at all`);
          continue;
        }
        measured++;
        const offset = box.maxY - GROUND_ROW;
        const throwsAtCamera = view === 'front' && row === 'cast_wave';
        const below =
          view === 'away'
            ? AWAY_TAIL_BELOW_TOLERANCE
            : throwsAtCamera
              ? FRONT_THROW_BELOW_TOLERANCE
              : GROUND_BELOW_TOLERANCE;
        if (offset < -GROUND_ABOVE_TOLERANCE || offset > below) {
          fail(
            'G5',
            `${state}[${frame}]: lowest solid pixel is ${offset} px from the ground line ` +
              `(allowed ${-GROUND_ABOVE_TOLERANCE}..+${below})`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G5', measured, 'standing frames');
}

// ── G6 facing ────────────────────────────────────────────────────────────

/** How much of the ink's height, from the bottom, counts as "the floor band" for the facing test. */
const FLOOR_BAND_SHARE = 0.2;
/** The tail must trail at least this much further behind the tile's centre than anything reaches ahead of it. */
const TAIL_TRAIL_MARGIN_PX = 10;
/** Head-on and from behind are the same body; their crowns may differ in height by this much. */
const VIEW_TOP_TOLERANCE_PX = 3;

/**
 * The profile is painted facing +X and the runtime mirrors it for -X, so in
 * every standing profile frame the heavy tail lies along the floor behind him,
 * reaching well past the tile's centre on the -X side — a row authored facing
 * the other way walks backward after the flip. Head-on and from behind must
 * stand the same height, or turning round changes his size.
 */
function gateFacing(): void {
  const tileCentreX = SPLASH_ZONE_FIGURE.tileX + TILE_SCALE / 2;
  let measured = 0;
  for (const row of STANDING_ROWS) {
    const state = splashZoneStateName(row, 'side');
    for (let frame = 0; frame < frameCountOf(SPLASH_ZONE_FIGURE, state); frame++) {
      const box = solidBoxOf(SPLASH_ZONE_FIGURE, state, frame);
      if (box === null) {
        fail('G6', `${state}[${frame}] has no solid ink`);
        continue;
      }
      const data = pixelsOf(SPLASH_ZONE_FIGURE, state, frame);
      const bandTop = box.maxY - Math.round((box.maxY - box.minY) * FLOOR_BAND_SHARE);
      let behind = 0;
      let ahead = 0;
      for (let y = bandTop; y <= box.maxY; y++) {
        for (let x = 0; x < SPLASH_ZONE_FIGURE.frameWidth; x++) {
          if (alphaAt(data, SPLASH_ZONE_FIGURE, x, y) < SOLID_ALPHA) continue;
          behind = Math.max(behind, tileCentreX - x);
          ahead = Math.max(ahead, x - tileCentreX);
        }
      }
      measured++;
      if (behind < ahead + TAIL_TRAIL_MARGIN_PX) {
        fail(
          'G6',
          `${state}[${frame}]: along the floor the ink reaches ${behind} px behind the tile centre ` +
            `and ${ahead} px ahead — the tail is not trailing behind a +X-facing profile`,
        );
      }
    }
  }
  const front = solidBoxOf(SPLASH_ZONE_FIGURE, splashZoneStateName('idle', 'front'), 0);
  const away = solidBoxOf(SPLASH_ZONE_FIGURE, splashZoneStateName('idle', 'away'), 0);
  if (front === null || away === null) {
    fail('G6', 'the head-on or away idle painted nothing');
  } else {
    measured++;
    const difference = Math.abs(front.minY - away.minY);
    if (difference > VIEW_TOP_TOLERANCE_PX) {
      fail(
        'G6',
        `head-on and away idles top out ${difference} px apart (limit ${VIEW_TOP_TOLERANCE_PX})`,
      );
    }
  }
  failUnlessMeasured('G6', measured, 'facing measurements');
}

// ── G7 leg reach ─────────────────────────────────────────────────────────────

/**
 * Every frame of every row keeps each hip-to-ankle span inside the leg's
 * reach. A clamped leg locks straight and leaves its foot hanging off the
 * floor, which in a walk reads as a hop.
 */
function gateLegReach(): void {
  let measured = 0;
  for (const spec of SPLASH_ZONE_ROWS) {
    for (const view of SPLASH_ZONE_VIEWS) {
      const state = splashZoneStateName(spec.row, view);
      for (let frame = 0; frame < spec.frameCount; frame++) {
        const pose = splashZonePoseAt(state, frame);
        if (pose === null) {
          fail('G7', `${state}[${frame}] has no pose`);
          continue;
        }
        for (const side of ['R', 'L'] as const) {
          measured++;
          const share = legReachShare(pose, side);
          if (share > 1) {
            fail(
              'G7',
              `${state}[${frame}] leg ${side} reaches ${(share * PERCENT).toFixed(1)}% of its length`,
            );
          }
        }
      }
    }
  }
  failUnlessMeasured('G7', measured, 'legs');
}

// ── G8 loop seams ────────────────────────────────────────────────────────────

/**
 * A loop's last-to-first step, held to a band. The ceiling is against the
 * largest step inside the row, not the median: the idle's bounce and the
 * walk's footfalls are deliberate sharp steps that recur once a cycle, and a
 * seam that lands on one of them is exactly as big as its twin mid-row. A pop
 * is a seam bigger than anything the row does on purpose. The floor is against
 * the median: a seam near zero means the cycle holds still for a frame.
 */
const SEAM_MIN_TO_MEDIAN = 0.4;
const SEAM_MAX_TO_LARGEST = 1.25;

function loopSeamFailures(def: FigureDef, state: string): number {
  const frames = frameCountOf(def, state);
  if (frames < 2) {
    fail('G8', `${def.id}.${state} has ${frames} frames, too few to loop`);
    return 0;
  }
  const steps: number[] = [];
  for (let frame = 1; frame < frames; frame++) steps.push(frameDelta(def, state, frame - 1, frame));
  const seam = frameDelta(def, state, frames - 1, 0);
  const typical = median(steps);
  const largest = Math.max(...steps);
  if (typical <= 0) {
    fail('G8', `${def.id}.${state} never moves`);
    return 1;
  }
  if (seam < typical * SEAM_MIN_TO_MEDIAN) {
    fail(
      'G8',
      `${def.id}.${state}: loop seam is ${(seam / typical).toFixed(2)}× the median step ` +
        `(floor ${SEAM_MIN_TO_MEDIAN}) — the cycle holds still across the seam`,
    );
  }
  if (seam > largest * SEAM_MAX_TO_LARGEST) {
    fail(
      'G8',
      `${def.id}.${state}: loop seam is ${(seam / largest).toFixed(2)}× the largest step in the ` +
        `row (ceiling ${SEAM_MAX_TO_LARGEST}) — the loop pops once a cycle`,
    );
  }
  return 1;
}

function gateLoopSeams(): void {
  let measured = 0;
  for (const row of ['idle', 'walk'] as const) {
    for (const view of SPLASH_ZONE_VIEWS) {
      measured += loopSeamFailures(SPLASH_ZONE_FIGURE, splashZoneStateName(row, view));
    }
  }
  measured += loopSeamFailures(SPLASH_ZONE_WAVE_FIGURE, WAVE_STATE);
  failUnlessMeasured('G8', measured, 'loop rows');
}

// ── G9 death ends on a corpse ────────────────────────────────────────────────

/** A body lying on the floor is no taller than this, in tiles. */
const CORPSE_MAX_HEIGHT_TILES = 0.55;
/** The corpse rests on the floor rather than hovering over it. */
const CORPSE_GROUND_TOLERANCE_PX = 6;

function gateCorpse(): void {
  let measured = 0;
  for (const view of SPLASH_ZONE_VIEWS) {
    const state = splashZoneStateName('death', view);
    const last = frameCountOf(SPLASH_ZONE_FIGURE, state) - 1;
    const box = solidBoxOf(SPLASH_ZONE_FIGURE, state, last);
    if (box === null) {
      fail('G9', `${state}[${last}] painted no corpse`);
      continue;
    }
    measured++;
    const height = (box.maxY - box.minY) / TILE_SCALE;
    if (height > CORPSE_MAX_HEIGHT_TILES) {
      fail(
        'G9',
        `${state}[${last}] stands ${height.toFixed(2)} tiles tall — not lying down (limit ${CORPSE_MAX_HEIGHT_TILES})`,
      );
    }
    if (Math.abs(box.maxY - GROUND_ROW) > CORPSE_GROUND_TOLERANCE_PX) {
      fail('G9', `${state}[${last}] rests ${box.maxY - GROUND_ROW} px off the ground line`);
    }
  }
  failUnlessMeasured('G9', measured, 'corpse frames');
}

// ── G10 the ally armband is visible ──────────────────────────────────────────

/**
 * How far round the colour wheel from the armband's own hue a pixel may be and
 * still count as the armband — in degrees. Measured by hue rather than by
 * channel distance because the trunks' highlight sits within a few channel
 * steps of this orange, and a channel test counts the trunks as an armband.
 */
const ARMBAND_HUE_WINDOW = 4;
const ARMBAND_MIN_SATURATION = 0.5;
const ARMBAND_MIN_VALUE = 0.55;
/**
 * The armband is one solid patch, so the gate measures the largest connected
 * patch of its hue rather than a total: stray antialiased pixels on the fur's
 * and trunks' edges scatter across the figure and never join up. With the
 * armband every view shows a patch of nineteen or more; painted without it,
 * the largest stray patch in any view is eight.
 */
const ARMBAND_MIN_PIXELS = 14;

/** The size of the largest 4-connected run of set cells in a row-major mask. */
function largestBlob(mask: Uint8Array, width: number): number {
  const seen = new Uint8Array(mask.length);
  let largest = 0;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || seen[start] === 1) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const cell = stack.pop() ?? start;
      size++;
      const x = cell % width;
      const neighbours = [
        x > 0 ? cell - 1 : -1,
        x < width - 1 ? cell + 1 : -1,
        cell - width,
        cell + width,
      ];
      for (const next of neighbours) {
        if (next < 0 || next >= mask.length || mask[next] === 0 || seen[next] === 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    largest = Math.max(largest, size);
  }
  return largest;
}
const DEGREES_PER_HUE_SECTOR = 60;
const FULL_TURN_DEGREES = 360;
const HUE_SECTORS = 6;
const GREEN_SECTOR = 2;
const BLUE_SECTOR = 4;
const CHANNEL_MAX = 255;

interface Hsv {
  readonly hue: number;
  readonly saturation: number;
  readonly value: number;
}

function hsvOf(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;
  let sector = 0;
  if (spread > 0) {
    if (max === r) sector = ((g - b) / spread) % HUE_SECTORS;
    else if (max === g) sector = (b - r) / spread + GREEN_SECTOR;
    else sector = (r - g) / spread + BLUE_SECTOR;
  }
  return {
    hue: (sector * DEGREES_PER_HUE_SECTOR + FULL_TURN_DEGREES) % FULL_TURN_DEGREES,
    saturation: max === 0 ? 0 : spread / max,
    value: max / CHANNEL_MAX,
  };
}

function parseHex(hex: string): readonly [number, number, number] {
  const body = hex.replace('#', '');
  return [
    parseInt(body.slice(0, HEX_PAIR), HEX_RADIX),
    parseInt(body.slice(HEX_PAIR, HEX_PAIR * 2), HEX_RADIX),
    parseInt(body.slice(HEX_PAIR * 2, HEX_PAIR * RGB_CHANNELS), HEX_RADIX),
  ];
}

/**
 * Every hireling carries the Meat Shields armband so the player can tell an
 * ally from a hostile of the same kind. It must show in all three views of
 * the rows he spends his time in.
 */
function gateArmband(): void {
  const zone = CLUB_ZONES.find((candidate) => candidate.id === 'mercenary');
  if (zone === undefined) {
    fail('G10', 'the club has no Meat Shields zone to take the armband colour from');
  } else if (zone.color.toLowerCase() !== SPLASH_ZONE_ARMBAND_COLOR.toLowerCase()) {
    fail(
      'G10',
      `the armband is ${SPLASH_ZONE_ARMBAND_COLOR}, not the Meat Shields colour ${zone.color}`,
    );
  }
  const [r, g, b] = parseHex(SPLASH_ZONE_ARMBAND_COLOR);
  const armbandHue = hsvOf(r, g, b).hue;
  let measured = 0;
  for (const row of ['idle', 'walk'] as const) {
    for (const view of SPLASH_ZONE_VIEWS) {
      const state = splashZoneStateName(row, view);
      const data = pixelsOf(SPLASH_ZONE_FIGURE, state, 0);
      const pixelCount = data.length / CHANNELS;
      const isBand = new Uint8Array(pixelCount);
      for (let p = 0; p < pixelCount; p++) {
        const i = p * CHANNELS;
        if (data[i + ALPHA] < SOLID_ALPHA) continue;
        const pixel = hsvOf(data[i + RED], data[i + GREEN], data[i + BLUE]);
        const near =
          Math.abs(pixel.hue - armbandHue) <= ARMBAND_HUE_WINDOW &&
          pixel.saturation >= ARMBAND_MIN_SATURATION &&
          pixel.value >= ARMBAND_MIN_VALUE;
        if (near) isBand[p] = 1;
      }
      const count = largestBlob(isBand, SPLASH_ZONE_FIGURE.frameWidth);
      measured++;
      if (count < ARMBAND_MIN_PIXELS) {
        fail(
          'G10',
          `${state}[0]: the largest patch of armband colour is ${count} pixels (need ${ARMBAND_MIN_PIXELS})`,
        );
      }
    }
  }
  failUnlessMeasured('G10', measured, 'armband views');
}

// ── G11 not a rat ────────────────────────────────────────────────────────────

/** A rat's head is a long wedge; an otter's is broad and flat. */
const MIN_HEAD_WIDTH_TO_HEIGHT = 1.35;
/** A rat's tail is a thin cord; an otter's roots as thick as a thigh. */
const MIN_TAIL_ROOT_TO_THIGH = 1;
/** A rat's ears are big discs; an otter's are small round nubs. */
const MAX_EAR_TO_HEAD_HALF_WIDTH = 0.3;

function gateNotARat(): void {
  const ratios = otterSilhouetteRatios();
  if (ratios.headWidthToHeight < MIN_HEAD_WIDTH_TO_HEIGHT) {
    fail(
      'G11',
      `head is ${ratios.headWidthToHeight.toFixed(2)}× as wide as tall (min ${MIN_HEAD_WIDTH_TO_HEIGHT}) — a wedge reads as a rat`,
    );
  }
  if (ratios.tailRootToThigh < MIN_TAIL_ROOT_TO_THIGH) {
    fail(
      'G11',
      `tail root is ${ratios.tailRootToThigh.toFixed(2)}× a thigh (min ${MIN_TAIL_ROOT_TO_THIGH}) — a thin tail reads as a rat's`,
    );
  }
  if (ratios.earToHeadHalfWidth > MAX_EAR_TO_HEAD_HALF_WIDTH) {
    fail(
      'G11',
      `ears are ${ratios.earToHeadHalfWidth.toFixed(2)} of the head's half-width (max ${MAX_EAR_TO_HEAD_HALF_WIDTH}) — big ears read as a rat's`,
    );
  }
}

// ── G12 warm-row size ────────────────────────────────────────────────────────

function gateWarmRowSize(): void {
  let measured = 0;
  for (const def of [SPLASH_ZONE_FIGURE, ...SPLASH_ZONE_EFFECT_FIGURES]) {
    const cellBytes = def.frameWidth * def.frameHeight * BYTES_PER_PIXEL;
    let widest = 0;
    let widestState = '';
    for (const [state, declared] of def.states) {
      measured++;
      if (declared.frames <= widest) continue;
      widest = declared.frames;
      widestState = state;
    }
    const bytes = widest * cellBytes;
    if (bytes > figureByteBudgetFor(def)) {
      fail(
        'G12',
        `${def.id}.${widestState} warms to ${(bytes / BYTES_PER_MEGABYTE).toFixed(2)} MB, over ` +
          `its ${(figureByteBudgetFor(def) / BYTES_PER_MEGABYTE).toFixed(1)} MB budget`,
      );
    }
  }
  failUnlessMeasured('G12', measured, 'declared states');
}

// ── G13 the frozen head clearance ────────────────────────────────────────────

/** How far the frozen standing top may sit from the re-measured one, in pixels. */
const STANDING_TOP_TOLERANCE_PX = 1;

/**
 * The health bar hangs off `SPLASH_ZONE_STANDING_TOP_ABOVE_TILE`, frozen from
 * the art because nothing can measure ink at runtime. Re-measured here from
 * the tallest standing frame of every view against the tile's own top edge —
 * never against a ground line derived from the same constant.
 */
function gateStandingTop(): void {
  let highest = SPLASH_ZONE_FIGURE.frameHeight;
  let measured = 0;
  for (const row of ['idle', 'walk'] as const) {
    for (const view of SPLASH_ZONE_VIEWS) {
      const state = splashZoneStateName(row, view);
      for (let frame = 0; frame < frameCountOf(SPLASH_ZONE_FIGURE, state); frame++) {
        const box = solidBoxOf(SPLASH_ZONE_FIGURE, state, frame);
        if (box === null) continue;
        measured++;
        highest = Math.min(highest, box.minY);
      }
    }
  }
  failUnlessMeasured('G13', measured, 'standing frames');
  const measuredAbove = OTTER_TILE_Y - highest;
  const frozenAbove = SPLASH_ZONE_STANDING_TOP_ABOVE_TILE * TILE_SCALE;
  if (Math.abs(measuredAbove - frozenAbove) > STANDING_TOP_TOLERANCE_PX) {
    fail(
      'G13',
      `the standing figure tops out ${measuredAbove} px above its tile; ` +
        `SPLASH_ZONE_STANDING_TOP_ABOVE_TILE says ${frozenAbove.toFixed(1)} — re-freeze it at ` +
        (measuredAbove / TILE_SCALE).toFixed(FROZEN_DECIMALS),
    );
  }
}

// ── G14 the effects sit on their anchors ─────────────────────────────────────

const BOLT_TIP_TOLERANCE_PX = 2;
const WAVE_LIP_SEARCH_PX = 5;
const FOAM_MIN_CHANNEL = 215;
/** The splash's last frame must be mostly faded out; the runtime removes it after. */
const SPLASH_END_MAX_SHARE = 0.3;

function totalAlpha(def: FigureDef, state: string, frame: number): number {
  const data = pixelsOf(def, state, frame);
  let total = 0;
  for (let i = ALPHA; i < data.length; i += CHANNELS) total += data[i];
  return total;
}

/**
 * The runtime passes the bolt's tip and the wave's leading edge as their
 * positions, and hit-tests there. So the bolt's frontmost ink must sit on its
 * anchor, and the wave must show foam on its anchor row right at the anchor.
 */
function gateEffectAnchors(): void {
  let measured = 0;
  const bolt = SPLASH_ZONE_BOLT_FIGURE;
  for (let frame = 0; frame < frameCountOf(bolt, BOLT_STATE); frame++) {
    const box = solidBoxOf(bolt, BOLT_STATE, frame);
    if (box === null) {
      fail('G14', `${bolt.id}[${frame}] has no solid ink`);
      continue;
    }
    measured++;
    if (Math.abs(box.maxX - bolt.tileX) > BOLT_TIP_TOLERANCE_PX) {
      fail(
        'G14',
        `${bolt.id}[${frame}]: the tip is at x=${box.maxX}, not on the anchor x=${bolt.tileX}`,
      );
    }
  }

  const wave = SPLASH_ZONE_WAVE_FIGURE;
  for (let frame = 0; frame < frameCountOf(wave, WAVE_STATE); frame++) {
    const data = pixelsOf(wave, WAVE_STATE, frame);
    const y = wave.tileY;
    let foamFound = false;
    for (let x = wave.tileX - WAVE_LIP_SEARCH_PX; x <= wave.tileX + WAVE_LIP_SEARCH_PX; x++) {
      const i = (y * wave.frameWidth + x) * CHANNELS;
      const foam =
        data[i + ALPHA] >= SOLID_ALPHA &&
        data[i + RED] >= FOAM_MIN_CHANNEL &&
        data[i + GREEN] >= FOAM_MIN_CHANNEL &&
        data[i + BLUE] >= FOAM_MIN_CHANNEL;
      if (foam) foamFound = true;
    }
    measured++;
    if (!foamFound) {
      fail(
        'G14',
        `${wave.id}[${frame}]: no foam lip within ${WAVE_LIP_SEARCH_PX} px of the anchor`,
      );
    }
  }

  const splash = SPLASH_ZONE_SPLASH_FIGURE;
  const frames = frameCountOf(splash, SPLASH_STATE);
  const totals = Array.from({ length: frames }, (_unused, frame) =>
    totalAlpha(splash, SPLASH_STATE, frame),
  );
  const peak = Math.max(0, ...totals);
  measured++;
  if (peak === 0) fail('G14', `${splash.id} paints nothing`);
  else if (totals[frames - 1] / peak > SPLASH_END_MAX_SHARE) {
    fail(
      'G14',
      `${splash.id}'s last frame is ${((totals[frames - 1] / peak) * PERCENT).toFixed(0)}% of its peak — it pops off instead of fading`,
    );
  }
  failUnlessMeasured('G14', measured, 'effect frames');
}

/** Runs every gate and returns one message per failure. */
export function splashZoneGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateReachableStates();
  gateRowLengths();
  gateReleaseFrames();
  gateGroundLine();
  gateFacing();
  gateLegReach();
  gateLoopSeams();
  gateCorpse();
  gateArmband();
  gateNotARat();
  gateWarmRowSize();
  gateStandingTop();
  gateEffectAnchors();
  return [...failures];
}

if (process.argv[1]?.endsWith('gates-splash-zone.ts')) {
  console.log('Gating Splash Zone…');
  reportFigureGates('splash zone', splashZoneGateFailures());
}
