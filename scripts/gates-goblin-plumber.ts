/**
 * The bathroom plumber's art gates.
 *
 * His anatomy and movement are the goblin family's, gated by
 * `scripts/gates-goblins.ts`; what is his own is the cell he is painted into,
 * the rows the runtime asks him for, where his soles land, and the two pieces
 * of kit that name him in silhouette.
 *
 *   npm run gates:goblin-plumber
 *   (also run first by `npm run render:goblin-plumber`)
 */

import { pathToFileURL } from 'node:url';

import { paintFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import {
  GOBLIN_PLUMBER_FIGURE,
  GOBLIN_PLUMBER_ROWS,
  TILE_SCALE,
  goblinPlumberPose,
} from '../src/sprites/art/goblinFigure.js';
import {
  GOBLIN_PLUMBER_SCALE,
  GOBLIN_PLUMBER_STYLE,
  buildSkeleton,
} from '../src/sprites/art/goblinArt.js';
import { GOBLIN_PLUMBER_STATES } from '../src/sprites/goblinSprite.js';

const CHANNELS = 4;
const RED_OFFSET = 0;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;
/** Above this a pixel is the figure, not the soft contact shadow on the ground line. */
const SOLID_ALPHA = 200;
/** A sole may sit this many cell pixels off the ground line before he floats or sinks. */
const GROUND_TOLERANCE_PX = 3;
/**
 * How far above the top of the skull the plunger's cup must stand, in tile
 * units, measured only in the columns behind the cap.
 *
 * Under this the cup sinks in among the ears and the cap and the plumber is a
 * goblin in a hat: the cup standing clear behind the head is his silhouette cue.
 */
const MIN_PLUNGER_RISE = 0.01;
/** How far behind the skull's back edge a column must be to count as the cup's, in head radii. */
const BEHIND_CAP_MARGIN = 0.15;
/** A pixel is denim when blue leads both other channels by this much. */
const DENIM_BLUE_LEAD = 24;
/** Denim must cover at least this share of the figure's solid ink on every frame. */
const MIN_DENIM_SHARE = 0.12;
/** Decimal places a tile-unit measurement is reported to. */
const TILE_DECIMALS = 3;
const PERCENT = 100;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(id: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(id, failure);
}

function groundRow(): number {
  return GOBLIN_PLUMBER_FIGURE.tileY + TILE_SCALE;
}

interface FrameInk {
  readonly bottom: number;
  /** Topmost solid row among the columns left of `behindColumn`, or null if none. */
  readonly topBehind: number | null;
  readonly solid: number;
  readonly denim: number;
}

function inkOf(state: string, frame: number, behindColumn: number): FrameInk | null {
  const canvas = paintFigureCell(GOBLIN_PLUMBER_FIGURE, state, frame);
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  let top = -1;
  let bottom = -1;
  let topBehind: number | null = null;
  let solid = 0;
  let denim = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * CHANNELS;
      if (data[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      if (top < 0) top = y;
      if (topBehind === null && x < behindColumn) topBehind = y;
      bottom = y;
      solid++;
      const blue = data[i + BLUE_OFFSET];
      const bluest = blue - Math.max(data[i + RED_OFFSET], data[i + GREEN_OFFSET]);
      if (bluest >= DENIM_BLUE_LEAD) denim++;
    }
  }
  return top < 0 ? null : { bottom, topBehind, solid, denim };
}

// ── G1: structure ────────────────────────────────────────────────────────────

function gateStructure(): void {
  for (const failure of figureStructuralFailures(GOBLIN_PLUMBER_FIGURE)) fail('G1', failure);
}

// ── G2: every name the runtime asks for is painted ───────────────────────────

function gateReachableStates(): void {
  for (const failure of missingStateFailures(
    GOBLIN_PLUMBER_FIGURE,
    GOBLIN_PLUMBER_STATES,
    'GOBLIN_PLUMBER_STATES',
  )) {
    fail('G2', failure);
  }
}

// ── G3: soles on the ground line, cup over the head, dressed in denim ────────

/**
 * Frame by frame: the lowest solid row sits on the tile's ground line, the
 * plunger's cup stands clear above the skull behind the cap, and the overalls
 * are there.
 *
 * The skull is located from the rig's own head joint for that frame, so the
 * cup is measured against where the head actually is rather than against ink
 * that the cap and ears also contribute to.
 */
function gateStanceAndKit(): void {
  const { headRadius, headWidthFactor } = GOBLIN_PLUMBER_STYLE.proportions;
  const unit = TILE_SCALE * GOBLIN_PLUMBER_SCALE;
  const centreX = GOBLIN_PLUMBER_FIGURE.frameWidth / 2;
  let measured = 0;
  for (const row of GOBLIN_PLUMBER_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const head = buildSkeleton(GOBLIN_PLUMBER_STYLE, goblinPlumberPose(row, frame)).headCentre;
      const skullBack = head.x - headRadius * (headWidthFactor + BEHIND_CAP_MARGIN);
      const skullTopRow = groundRow() + (head.y - headRadius) * unit;
      const ink = inkOf(row.name, frame, centreX + skullBack * unit);
      if (ink === null) {
        fail('G3', `${row.name}[${frame}] painted nothing`);
        continue;
      }
      measured++;
      const drop = Math.abs(ink.bottom - groundRow());
      if (drop > GROUND_TOLERANCE_PX) {
        fail(
          'G3',
          `${row.name}[${frame}] has its lowest solid row ${drop}px off the ground line ` +
            `(tolerance ${GROUND_TOLERANCE_PX})`,
        );
      }
      const rise = ink.topBehind === null ? -Infinity : (skullTopRow - ink.topBehind) / TILE_SCALE;
      if (rise < MIN_PLUNGER_RISE) {
        fail(
          'G3',
          `${row.name}[${frame}]'s ink behind the cap tops out ${rise.toFixed(TILE_DECIMALS)} tiles above ` +
            `the skull, under the ${MIN_PLUNGER_RISE} the plunger's cup needs to stand clear of it`,
        );
      }
      const denimShare = ink.denim / ink.solid;
      if (denimShare < MIN_DENIM_SHARE) {
        fail(
          'G3',
          `${row.name}[${frame}] is ${(denimShare * PERCENT).toFixed(1)}% denim, under the ` +
            `${MIN_DENIM_SHARE * PERCENT}% the overalls need to read`,
        );
      }
    }
  }
  failUnlessMeasured('G3', measured, 'plumber frames');
}

/** Runs every plumber gate and returns the failures. */
export function goblinPlumberGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateReachableStates();
  gateStanceAndKit();
  return [...failures];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Goblin plumber art gates');
  reportFigureGates('goblin-plumber', goblinPlumberGateFailures());
}
