/**
 * The goblin mother's and her toddler's art gates.
 *
 * Pixel gates measure cells painted from the figures the way the runtime cache
 * bakes them; pose gates read the choreography directly. Failures accumulate
 * so one run reports everything, and a gate whose loop measured nothing fails
 * rather than passing.
 *
 *   npm run gates:goblin-mother
 *   (also run first by `npm run render:goblin-mother`)
 */

import { pathToFileURL } from 'node:url';

import { paintFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import {
  GOBLIN_MOTHER_FIGURE,
  GOBLIN_TODDLER_FIGURE,
  GROUND_OFFSET_IN_TILE,
  MOTHER_ROWS,
  TILE_SCALE,
  TODDLER_ROWS,
  motherPose,
} from '../src/sprites/art/goblinMotherFigure.js';
import {
  MOTHER_CROWN_Y,
  babyFacePoint,
  bundlePoint,
  farHandPoint,
} from '../src/sprites/art/goblinMotherArt.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

const CHANNELS = 4;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;
/** Above this a pixel is the figure, not the soft contact shadow on the ground line. */
const SOLID_ALPHA = 200;
/** Decimal places a tile-unit measurement is reported to. */
const TILE_DECIMALS = 3;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(id: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(id, failure);
}

interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

const pixelCache = new Map<string, Pixels>();

function pixelsOf(def: FigureDef, state: string, frame: number): Pixels {
  const cacheKey = `${def.id}/${state}/${frame}`;
  const cached = pixelCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const canvas = paintFigureCell(def, state, frame);
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels = { width: canvas.width, height: canvas.height, data };
  pixelCache.set(cacheKey, pixels);
  return pixels;
}

function indexOf(pixels: Pixels, x: number, y: number): number | null {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) return null;
  return (py * pixels.width + px) * CHANNELS;
}

function alphaAt(pixels: Pixels, x: number, y: number): number {
  const i = indexOf(pixels, x, y);
  return i === null ? 0 : pixels.data[i + ALPHA_OFFSET];
}

/** The cell pixel a tile-unit point from the ground between the feet lands on. */
function cellPoint(def: FigureDef, point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: def.tileX + TILE_SCALE / 2 + point.x * TILE_SCALE,
    y: def.tileY + TILE_SCALE * GROUND_OFFSET_IN_TILE + point.y * TILE_SCALE,
  };
}

function groundRow(def: FigureDef): number {
  return def.tileY + TILE_SCALE * GROUND_OFFSET_IN_TILE;
}

/** Topmost and bottommost rows holding solid ink. */
function solidRows(pixels: Pixels): { top: number; bottom: number } | null {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) {
      if (alphaAt(pixels, x, y) < SOLID_ALPHA) continue;
      if (top < 0) top = y;
      bottom = y;
      break;
    }
  }
  return top < 0 ? null : { top, bottom };
}

// ── G1: structure ────────────────────────────────────────────────────────────

function gateStructure(): void {
  for (const def of [GOBLIN_MOTHER_FIGURE, GOBLIN_TODDLER_FIGURE]) {
    for (const failure of figureStructuralFailures(def)) fail('G1', failure);
  }
}

// ── G2: every name the runtime asks for is painted ───────────────────────────

function gateReachableStates(): void {
  for (const failure of missingStateFailures(GOBLIN_MOTHER_FIGURE, MOTHER_ROWS, 'MOTHER_ROWS')) {
    fail('G2', failure);
  }
  for (const failure of missingStateFailures(GOBLIN_TODDLER_FIGURE, TODDLER_ROWS, 'TODDLER_ROWS')) {
    fail('G2', failure);
  }
}

// ── G3: every declared frame is its own picture ──────────────────────────────

function gateDistinctFrames(): void {
  for (const def of [GOBLIN_MOTHER_FIGURE, GOBLIN_TODDLER_FIGURE]) {
    const report = distinctFrameFailures(def, (state, frame) => pixelsOf(def, state, frame).data);
    for (const failure of report.failures) fail('G3', failure);
    failUnlessMeasured('G3', report.framesMeasured, `${def.id} frames`);
  }
}

// ── G4: heights, and both stand on the shared ground line ────────────────────

interface HeightBand {
  readonly def: FigureDef;
  readonly state: string;
  readonly min: number;
  readonly max: number;
}

/**
 * She stands a shade under the enemy goblins' tallest (0.86) to the crown of
 * her scarf; the toddler about half her height, so he reads as a small child
 * and not a second adult.
 */
const HEIGHT_BANDS: readonly HeightBand[] = [
  { def: GOBLIN_MOTHER_FIGURE, state: 'idle', min: 0.84, max: 0.98 },
  { def: GOBLIN_TODDLER_FIGURE, state: 'walk', min: 0.46, max: 0.6 },
];
/** A sole may sit this many cell pixels off the ground line before she floats or sinks. */
const GROUND_TOLERANCE_PX = 2;

function gateHeightAndGround(): void {
  let measured = 0;
  for (const band of HEIGHT_BANDS) {
    const rows = solidRows(pixelsOf(band.def, band.state, 0));
    measured++;
    if (rows === null) {
      fail('G4', `${band.def.id}.${band.state}[0] painted no solid ink`);
      continue;
    }
    const height = (groundRow(band.def) - rows.top) / TILE_SCALE;
    if (height < band.min || height > band.max) {
      fail(
        'G4',
        `${band.def.id}.${band.state}[0] stands ${height.toFixed(TILE_DECIMALS)} tiles, outside ` +
          `${band.min}–${band.max}`,
      );
    }
  }
  for (const def of [GOBLIN_MOTHER_FIGURE, GOBLIN_TODDLER_FIGURE]) {
    for (const [state, declared] of def.states) {
      for (let frame = 0; frame < declared.frames; frame++) {
        const rows = solidRows(pixelsOf(def, state, frame));
        measured++;
        const drop = rows === null ? Infinity : Math.abs(rows.bottom - groundRow(def));
        if (drop > GROUND_TOLERANCE_PX) {
          fail(
            'G4',
            `${def.id}.${state}[${frame}]'s lowest solid ink is ${drop.toFixed(1)} px off the ` +
              `ground line (tolerance ${GROUND_TOLERANCE_PX})`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G4', measured, 'cells');
}

// ── G5: the baby is in every frame — a pale bundle with a green face ────────

/** The blanket reads as a pale bundle: its lit cloth is well above the dress and shawl. */
const BLANKET_MIN_LUMA = 170;
/** A goblin face: green over both red and blue. */
const FACE_MIN_GREEN_LEAD = 15;
/** How far round each point to look, in cell pixels, for the colour it should hold. */
const PROBE_RADIUS = 2;
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;

function anyNear(
  pixels: Pixels,
  at: { x: number; y: number },
  test: (r: number, g: number, b: number) => boolean,
): boolean {
  for (let dy = -PROBE_RADIUS; dy <= PROBE_RADIUS; dy++) {
    for (let dx = -PROBE_RADIUS; dx <= PROBE_RADIUS; dx++) {
      const i = indexOf(pixels, at.x + dx, at.y + dy);
      if (i === null || pixels.data[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      if (test(pixels.data[i], pixels.data[i + GREEN_OFFSET], pixels.data[i + BLUE_OFFSET])) {
        return true;
      }
    }
  }
  return false;
}

function isBlanket(r: number, g: number, b: number): boolean {
  return r * LUMA_RED + g * LUMA_GREEN + b * LUMA_BLUE >= BLANKET_MIN_LUMA;
}

function isGoblinFace(r: number, g: number, b: number): boolean {
  return g - r >= FACE_MIN_GREEN_LEAD && g - b >= FACE_MIN_GREEN_LEAD;
}

function gateBabyPresent(): void {
  let measured = 0;
  for (const row of MOTHER_ROWS) {
    const frames = GOBLIN_MOTHER_FIGURE.states.get(row)?.frames ?? 0;
    for (let frame = 0; frame < frames; frame++) {
      const pose = motherPose(row, frame);
      const pixels = pixelsOf(GOBLIN_MOTHER_FIGURE, row, frame);
      measured++;
      if (!anyNear(pixels, cellPoint(GOBLIN_MOTHER_FIGURE, bundlePoint(pose)), isBlanket)) {
        fail('G5', `goblin_mother.${row}[${frame}] shows no pale blanket where the bundle is`);
      }
      if (!anyNear(pixels, cellPoint(GOBLIN_MOTHER_FIGURE, babyFacePoint(pose)), isGoblinFace)) {
        fail('G5', `goblin_mother.${row}[${frame}] shows no green face where the baby's head is`);
      }
    }
  }
  failUnlessMeasured('G5', measured, 'mother frames');
}

// ── G6: her call for help waves a hand above her head ────────────────────────

function gateHelpWave(): void {
  let measured = 0;
  const frames = GOBLIN_MOTHER_FIGURE.states.get('hurt')?.frames ?? 0;
  for (let frame = 0; frame < frames; frame++) {
    const pose = motherPose('hurt', frame);
    const handAt = farHandPoint(pose);
    measured++;
    if (handAt.y >= MOTHER_CROWN_Y) {
      fail(
        'G6',
        `hurt[${frame}] holds her free hand at ${handAt.y.toFixed(TILE_DECIMALS)}, not above the crown of ` +
          `her scarf at ${MOTHER_CROWN_Y.toFixed(TILE_DECIMALS)}`,
      );
    }
    const pixels = pixelsOf(GOBLIN_MOTHER_FIGURE, 'hurt', frame);
    if (
      alphaAt(
        pixels,
        cellPoint(GOBLIN_MOTHER_FIGURE, handAt).x,
        cellPoint(GOBLIN_MOTHER_FIGURE, handAt).y,
      ) < SOLID_ALPHA
    ) {
      fail('G6', `hurt[${frame}] paints nothing where the waving hand should be`);
    }
  }
  failUnlessMeasured('G6', measured, 'hurt frames');
}

/** Runs every gate and returns one message per failure. */
export function goblinMotherGateFailures(): string[] {
  failures.length = 0;
  pixelCache.clear();
  const gates: ReadonlyArray<readonly [string, () => void]> = [
    ['G1', gateStructure],
    ['G2', gateReachableStates],
    ['G3', gateDistinctFrames],
    ['G4', gateHeightAndGround],
    ['G5', gateBabyPresent],
    ['G6', gateHelpWave],
  ];
  for (const [id, gate] of gates) {
    try {
      gate();
    } catch (error) {
      fail(id, `the gate threw before it could measure: ${String(error)}`);
    }
  }
  return [...failures];
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  console.log('Goblin mother art gates');
  reportFigureGates('goblin-mother', goblinMotherGateFailures());
}
