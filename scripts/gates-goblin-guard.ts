/**
 * The prison goblins' art gates: the patrol guard, the gate guard and the
 * prisoner.
 *
 * Their anatomy and borrowed movement are the goblin family's, gated by
 * `scripts/gates-goblins.ts`; what is theirs is the cell each is painted into,
 * the rows the runtime asks for, where the soles land, the kit that names
 * them in silhouette, and the two anchors the runtime reads off the art — the
 * flashlight's lens and the eyes.
 *
 *   npm run gates:goblin-guard
 *   (also run first by `npm run render:goblin-guard`)
 */

import { pathToFileURL } from 'node:url';

import { paintFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import { TILE_SCALE, type RowSpec } from '../src/sprites/art/goblinFigure.js';
import {
  GOBLIN_GATE_GUARD_FIGURE,
  GOBLIN_GATE_GUARD_ROWS,
  GOBLIN_GUARD_EYE_ANCHOR,
  GOBLIN_GUARD_FIGURE,
  GOBLIN_GUARD_ROWS,
  GOBLIN_PRISONER_EYE_ANCHOR,
  GOBLIN_PRISONER_FIGURE,
  GOBLIN_PRISONER_ROWS,
  goblinGateGuardPose,
  goblinGuardPose,
  guardLensAnchor,
  type TileAnchor,
} from '../src/sprites/art/goblinGuardFigure.js';
import {
  GOBLIN_GATE_GUARD_STYLE,
  GOBLIN_GUARD_SCALE,
  GOBLIN_GUARD_STYLE,
} from '../src/sprites/art/goblinGuardArt.js';
import { buildSkeleton, type GoblinPose } from '../src/sprites/art/goblinArt.js';
import {
  GOBLIN_GATE_GUARD_STATES,
  GOBLIN_GUARD_STATES,
  GOBLIN_PRISONER_STATES,
} from '../src/sprites/goblinGuardSprite.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

const CHANNELS = 4;
const RED_OFFSET = 0;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;
/** Above this a pixel is the figure, not the soft contact shadow on the ground line. */
const SOLID_ALPHA = 200;
/** A sole may sit this many cell pixels off the ground line before it floats or sinks. */
const GROUND_TOLERANCE_PX = 3;
/**
 * How far the cap's crown must stand above the skull, in tile units, measured
 * in the skull's own columns. Under this the peaked cap sinks onto the head and
 * reads as the plumber's soft one.
 */
const MIN_CAP_RISE = 0.06;
/** A pixel is uniform serge when blue leads red by this much and it is this dark. */
const UNIFORM_BLUE_LEAD = 14;
const UNIFORM_MAX_BRIGHTNESS = 120;
/** The uniform must cover at least this share of a guard's solid ink on every frame. */
const MIN_UNIFORM_SHARE = 0.15;
/** A pixel is a pale prison stripe when every channel is this bright and red leads blue. */
const STRIPE_MIN_CHANNEL = 130;
const STRIPE_WARMTH = 10;
/**
 * Pale stripes must cover at least this share of a prisoner's solid ink. Low,
 * because his folded or raised arms cross most of the tunic on some rows; the
 * shipped art bottoms out near 1.6%, and bare skin with no tunic measures 0.
 */
const MIN_STRIPE_SHARE = 0.01;
/** A pixel is the lit lens when it is this bright in red and green and this much paler in blue. */
const LENS_MIN_RED_GREEN = 235;
const LENS_MIN_BLUE = 150;
/** The lens must show within this many cell pixels of the exported anchor. */
const LENS_SEARCH_PX = 3;
/** A pixel is an eye's glow: a hot yellow, redder than the badges' gold and bluer-free than their glints. */
const EYE_MIN_RED = 235;
const EYE_MIN_GREEN = 170;
const EYE_MAX_BLUE = 140;
const EYE_MIN_BLUE_GAP = 70;
/** The eye glow is looked for within this many cell pixels of the anchor. */
const EYE_SEARCH_PX = 8;
/**
 * The glow's centroid may sit this far from the anchor, in tiles. The anchor
 * is the midpoint of the two eyes, but the far eye is smaller and half under
 * the nose, so the glow's centroid sits toward the near eye by up to half the
 * eye gap (about 0.06 tiles).
 */
const EYE_TOLERANCE_TILES = 0.07;
const MIN_EYE_PIXELS = 2;
const TILE_DECIMALS = 3;
const PERCENT = 100;

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

function pixelsOf(def: FigureDef, state: string, frame: number): Pixels {
  const canvas = paintFigureCell(def, state, frame);
  const { width, height } = canvas;
  return { width, height, data: canvas.getContext('2d').getImageData(0, 0, width, height).data };
}

function groundRow(def: FigureDef): number {
  return def.tileY + TILE_SCALE;
}

/** A tile anchor as a cell pixel on a figure facing +X. */
function cellPoint(def: FigureDef, anchor: TileAnchor): { x: number; y: number } {
  return { x: def.tileX + anchor.x * TILE_SCALE, y: def.tileY + anchor.y * TILE_SCALE };
}

interface FigureCase {
  readonly def: FigureDef;
  readonly rows: readonly RowSpec[];
  readonly states: ReadonlyArray<string>;
  readonly statesName: string;
}

const CASES: readonly FigureCase[] = [
  {
    def: GOBLIN_GUARD_FIGURE,
    rows: GOBLIN_GUARD_ROWS,
    states: GOBLIN_GUARD_STATES,
    statesName: 'GOBLIN_GUARD_STATES',
  },
  {
    def: GOBLIN_GATE_GUARD_FIGURE,
    rows: GOBLIN_GATE_GUARD_ROWS,
    states: GOBLIN_GATE_GUARD_STATES,
    statesName: 'GOBLIN_GATE_GUARD_STATES',
  },
  {
    def: GOBLIN_PRISONER_FIGURE,
    rows: GOBLIN_PRISONER_ROWS,
    states: GOBLIN_PRISONER_STATES,
    statesName: 'GOBLIN_PRISONER_STATES',
  },
];

// ── G1: structure ────────────────────────────────────────────────────────────

function gateStructure(): void {
  for (const { def } of CASES) {
    for (const failure of figureStructuralFailures(def)) fail('G1', `${def.id}: ${failure}`);
  }
}

// ── G2: every name the runtime asks for is painted ───────────────────────────

function gateReachableStates(): void {
  for (const { def, states, statesName } of CASES) {
    for (const failure of missingStateFailures(def, states, statesName)) fail('G2', failure);
  }
}

// ── G3: soles on the ground line, and each is dressed ────────────────────────

interface Dress {
  readonly name: string;
  readonly minShare: number;
  readonly matches: (red: number, green: number, blue: number) => boolean;
}

const UNIFORM_DRESS: Dress = {
  name: 'uniform serge',
  minShare: MIN_UNIFORM_SHARE,
  matches: (red, green, blue) =>
    blue - red >= UNIFORM_BLUE_LEAD && Math.max(red, green, blue) <= UNIFORM_MAX_BRIGHTNESS,
};

const STRIPE_DRESS: Dress = {
  name: 'pale prison stripe',
  minShare: MIN_STRIPE_SHARE,
  matches: (red, green, blue) =>
    Math.min(red, green, blue) >= STRIPE_MIN_CHANNEL && red - blue >= STRIPE_WARMTH,
};

function dressOf(def: FigureDef): Dress {
  return def === GOBLIN_PRISONER_FIGURE ? STRIPE_DRESS : UNIFORM_DRESS;
}

/**
 * Frame by frame: the lowest solid row sits on the tile's ground line, and the
 * figure's own clothing covers its share of the ink — the dark uniform on a
 * guard, the pale stripes on a prisoner.
 */
function gateStanceAndDress(): void {
  let measured = 0;
  for (const { def, rows } of CASES) {
    const dress = dressOf(def);
    for (const row of rows) {
      for (let frame = 0; frame < row.frameCount; frame++) {
        const { width, height, data } = pixelsOf(def, row.name, frame);
        let bottom = -1;
        let solid = 0;
        let dressed = 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * CHANNELS;
            if (data[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
            bottom = y;
            solid++;
            if (
              dress.matches(data[i + RED_OFFSET], data[i + GREEN_OFFSET], data[i + BLUE_OFFSET])
            ) {
              dressed++;
            }
          }
        }
        const label = `${def.id}.${row.name}[${frame}]`;
        if (solid === 0) {
          fail('G3', `${label} painted nothing`);
          continue;
        }
        measured++;
        const drop = Math.abs(bottom - groundRow(def));
        if (drop > GROUND_TOLERANCE_PX) {
          fail(
            'G3',
            `${label} has its lowest solid row ${drop}px off the ground line (tolerance ${GROUND_TOLERANCE_PX})`,
          );
        }
        const share = dressed / solid;
        if (share < dress.minShare) {
          fail(
            'G3',
            `${label} is ${(share * PERCENT).toFixed(1)}% ${dress.name}, under the ${dress.minShare * PERCENT}% it needs to read`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G3', measured, 'prison goblin frames');
}

// ── G4: the peaked cap stands over the skull ─────────────────────────────────

/**
 * On every guard frame the topmost solid ink in the skull's own columns stands
 * well clear of the skull's top. The skull is located from the rig's head
 * joint for that frame, so this measures the cap rather than the ears, which
 * stand out sideways past those columns.
 */
function gateCap(): void {
  const guards: ReadonlyArray<{
    def: FigureDef;
    rows: readonly RowSpec[];
    pose: (row: RowSpec, frame: number) => GoblinPose;
    style: typeof GOBLIN_GUARD_STYLE;
  }> = [
    {
      def: GOBLIN_GUARD_FIGURE,
      rows: GOBLIN_GUARD_ROWS,
      pose: goblinGuardPose,
      style: GOBLIN_GUARD_STYLE,
    },
    {
      def: GOBLIN_GATE_GUARD_FIGURE,
      rows: GOBLIN_GATE_GUARD_ROWS,
      pose: goblinGateGuardPose,
      style: GOBLIN_GATE_GUARD_STYLE,
    },
  ];
  const unit = TILE_SCALE * GOBLIN_GUARD_SCALE;
  let measured = 0;
  for (const { def, rows, pose, style } of guards) {
    const { headRadius, headWidthFactor } = style.proportions;
    const centreX = def.frameWidth / 2;
    for (const row of rows) {
      for (let frame = 0; frame < row.frameCount; frame++) {
        const head = buildSkeleton(style, pose(row, frame)).headCentre;
        const halfWidth = headRadius * headWidthFactor * unit * SKULL_COLUMN_SHARE;
        const columnFrom = Math.round(centreX + head.x * unit - halfWidth);
        const columnTo = Math.round(centreX + head.x * unit + halfWidth);
        const skullTop = groundRow(def) + (head.y - headRadius) * unit;
        const { width, height, data } = pixelsOf(def, row.name, frame);
        let top: number | null = null;
        for (let y = 0; y < height && top === null; y++) {
          for (let x = Math.max(0, columnFrom); x <= Math.min(width - 1, columnTo); x++) {
            if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] >= SOLID_ALPHA) {
              top = y;
              break;
            }
          }
        }
        measured++;
        const rise = top === null ? -Infinity : (skullTop - top) / TILE_SCALE;
        if (rise < MIN_CAP_RISE) {
          fail(
            'G4',
            `${def.id}.${row.name}[${frame}]'s cap tops out ${rise.toFixed(TILE_DECIMALS)} tiles above ` +
              `the skull, under the ${MIN_CAP_RISE} a peaked cap needs`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G4', measured, 'guard frames');
}
/** The skull's middle columns, as a share of its half-width either side of centre. */
const SKULL_COLUMN_SHARE = 0.5;

// ── G5: the lens is where the lighting will start the cone ───────────────────

/**
 * On every patrol guard frame, the lit lens is painted within a few pixels of
 * `guardLensAnchor`, and the mirrored anchor is the facing-right one reflected
 * about the tile's centre. A lamp that moves without its anchor, or an anchor
 * that drifts off the lamp, puts the cone's start somewhere the player can see
 * there is no flashlight.
 */
function gateLens(): void {
  let measured = 0;
  for (const row of GOBLIN_GUARD_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const anchor = guardLensAnchor(row.name, frame, 1);
      const mirrored = guardLensAnchor(row.name, frame, -1);
      const label = `goblin_guard.${row.name}[${frame}]`;
      if (Math.abs(mirrored.x - (1 - anchor.x)) > Number.EPSILON || mirrored.y !== anchor.y) {
        fail('G5', `${label}'s mirrored lens anchor is not the right-facing one reflected`);
      }
      const at = cellPoint(GOBLIN_GUARD_FIGURE, anchor);
      const { width, height, data } = pixelsOf(GOBLIN_GUARD_FIGURE, row.name, frame);
      let found = false;
      for (let dy = -LENS_SEARCH_PX; dy <= LENS_SEARCH_PX && !found; dy++) {
        for (let dx = -LENS_SEARCH_PX; dx <= LENS_SEARCH_PX; dx++) {
          const x = Math.round(at.x + dx);
          const y = Math.round(at.y + dy);
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const i = (y * width + x) * CHANNELS;
          if (
            data[i + RED_OFFSET] >= LENS_MIN_RED_GREEN &&
            data[i + GREEN_OFFSET] >= LENS_MIN_RED_GREEN &&
            data[i + BLUE_OFFSET] >= LENS_MIN_BLUE
          ) {
            found = true;
            break;
          }
        }
      }
      measured++;
      if (!found) {
        fail(
          'G5',
          `${label} paints no lit lens within ${LENS_SEARCH_PX}px of its anchor ` +
            `(${anchor.x.toFixed(TILE_DECIMALS)}, ${anchor.y.toFixed(TILE_DECIMALS)})`,
        );
      }
    }
  }
  failUnlessMeasured('G5', measured, 'patrol guard frames');
}

// ── G6: the eye placement sits on the painted eyes ───────────────────────────

/**
 * The eye-shine placement exported for each figure lands on the eyes it
 * actually paints: the centroid of the hot eye-core pixels near the anchor, on
 * the idle's first frame, sits within tolerance of it.
 */
function gateEyes(): void {
  const subjects: ReadonlyArray<{ def: FigureDef; anchor: TileAnchor }> = [
    { def: GOBLIN_GUARD_FIGURE, anchor: GOBLIN_GUARD_EYE_ANCHOR },
    { def: GOBLIN_GATE_GUARD_FIGURE, anchor: GOBLIN_GUARD_EYE_ANCHOR },
    { def: GOBLIN_PRISONER_FIGURE, anchor: GOBLIN_PRISONER_EYE_ANCHOR },
  ];
  let measured = 0;
  for (const { def, anchor } of subjects) {
    const at = cellPoint(def, anchor);
    const { width, height, data } = pixelsOf(def, 'idle', 0);
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    for (
      let y = Math.max(0, Math.floor(at.y - EYE_SEARCH_PX));
      y <= Math.min(height - 1, at.y + EYE_SEARCH_PX);
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(at.x - EYE_SEARCH_PX));
        x <= Math.min(width - 1, at.x + EYE_SEARCH_PX);
        x++
      ) {
        const i = (y * width + x) * CHANNELS;
        const red = data[i + RED_OFFSET];
        const green = data[i + GREEN_OFFSET];
        const blue = data[i + BLUE_OFFSET];
        if (
          data[i + ALPHA_OFFSET] >= SOLID_ALPHA &&
          red >= EYE_MIN_RED &&
          green >= EYE_MIN_GREEN &&
          blue <= EYE_MAX_BLUE &&
          green - blue >= EYE_MIN_BLUE_GAP
        ) {
          count++;
          sumX += x;
          sumY += y;
        }
      }
    }
    if (count < MIN_EYE_PIXELS) {
      fail('G6', `${def.id}.idle[0] paints no eye glow near its eye placement`);
      continue;
    }
    measured++;
    const offX = (sumX / count - at.x) / TILE_SCALE;
    const offY = (sumY / count - at.y) / TILE_SCALE;
    if (Math.hypot(offX, offY) > EYE_TOLERANCE_TILES) {
      fail(
        'G6',
        `${def.id}'s painted eyes sit (${offX.toFixed(TILE_DECIMALS)}, ${offY.toFixed(TILE_DECIMALS)}) tiles ` +
          `off its eye placement (tolerance ${EYE_TOLERANCE_TILES})`,
      );
    }
  }
  failUnlessMeasured('G6', measured, 'eye placements');
}

/** Runs every prison goblin gate and returns the failures. */
export function goblinGuardGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateReachableStates();
  gateStanceAndDress();
  gateCap();
  gateLens();
  gateEyes();
  return [...failures];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Goblin guard art gates');
  reportFigureGates('goblin-guard', goblinGuardGateFailures());
}
