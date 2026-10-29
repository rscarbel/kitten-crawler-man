/**
 * The electric goblin's art gates.
 *
 * Pixel gates measure cells painted from the figure; pose gates read the
 * choreography directly. Failures accumulate so one run reports everything,
 * and a gate whose loop measured nothing fails rather than passing.
 *
 *   G1  structure: every state painted, nothing clipped at the cell's edge
 *   G2  every row name the runtime asks for is painted
 *   G3  he stands on the frozen tile box's ground line on every standing frame
 *   G4  no leg is asked past its reach on a frame with that foot down: a
 *       clamped leg locks straight and the next frame snaps it back
 *   G5  each cable reaches its fist in every frame of every row: red cable
 *       ink lies in a ring round each rod's grip
 *   G6  each event frame is the extreme of its motion: the plunge and slam
 *       land lowest, the toss lets go highest, the swipe reaches furthest
 *
 *   npx tsx scripts/gates-electric-goblin.ts
 *   (also run first by `npm run render:electric-goblin`)
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
  ELECTRIC_GOBLIN_FIGURE,
  ELECTRIC_GOBLIN_ROWS,
  ELECTRIC_GOBLIN_ROW_NAMES,
  electricGoblinBallAnchor,
  electricGoblinFrame,
  type ElectricGoblinRow,
} from '../src/sprites/art/electricGoblinFigure.js';
import {
  ELECTRIC_GOBLIN_SCALE,
  electricGoblinStyle,
} from '../src/sprites/art/electricGoblinArt.js';
import { buildSkeleton } from '../src/sprites/art/goblinArt.js';

const CHANNELS = 4;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;
/** Above this a pixel is the figure, not the soft contact shadow on the ground line. */
const SOLID_ALPHA = 200;
const DECIMALS = 3;

const DEF = ELECTRIC_GOBLIN_FIGURE;
const STYLE = electricGoblinStyle({ spin: 0, charge: 0 });
const TILE_CENTRE = 0.5;

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

function pixelsOf(state: string, frame: number): Pixels {
  const key = `${state}/${frame}`;
  const cached = pixelCache.get(key);
  if (cached !== undefined) return cached;
  const canvas = paintFigureCell(DEF, state, frame);
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels = { width: canvas.width, height: canvas.height, data };
  pixelCache.set(key, pixels);
  return pixels;
}

function framesOf(row: ElectricGoblinRow): number {
  return ELECTRIC_GOBLIN_ROWS[row].frames;
}

/** The ground line, in cell pixels: the bottom of the tile the runtime stands him on. */
function groundRow(): number {
  return DEF.tileY + DEF.tileScale;
}

// ── G1 ───────────────────────────────────────────────────────────────────────

function gateStructure(): void {
  for (const failure of figureStructuralFailures(DEF)) fail('G1', failure);
}

// ── G2 ───────────────────────────────────────────────────────────────────────

function gateRuntimeNames(): void {
  for (const failure of missingStateFailures(
    DEF,
    ELECTRIC_GOBLIN_ROW_NAMES,
    'ELECTRIC_GOBLIN_ROW_NAMES',
  )) {
    fail('G2', failure);
  }
}

// ── G3 ───────────────────────────────────────────────────────────────────────

/** Rows in which he stands on both boots throughout. */
const STANDING_ROWS: readonly ElectricGoblinRow[] = ['idle', 'block', 'hurt'];
/** A boot sole may sit this far above the line (floating) or below it (sunk), in cell pixels. */
const FLOAT_TOLERANCE_PX = 1;
const SINK_TOLERANCE_PX = 3;

function lowestSolidRow(pixels: Pixels): number | null {
  for (let y = pixels.height - 1; y >= 0; y--) {
    for (let x = 0; x < pixels.width; x++) {
      if (pixels.data[(y * pixels.width + x) * CHANNELS + ALPHA_OFFSET] >= SOLID_ALPHA) return y;
    }
  }
  return null;
}

function gateGround(): void {
  let measured = 0;
  for (const row of STANDING_ROWS) {
    for (let frame = 0; frame < framesOf(row); frame++) {
      const lowest = lowestSolidRow(pixelsOf(row, frame));
      measured++;
      if (lowest === null) {
        fail('G3', `${row}[${frame}] painted no solid ink`);
        continue;
      }
      const sole = lowest + 1;
      const offBy = sole - groundRow();
      if (offBy < -FLOAT_TOLERANCE_PX || offBy > SINK_TOLERANCE_PX) {
        fail(
          'G3',
          `${row}[${frame}]'s soles sit ${offBy} px off the ground line at ${groundRow()} ` +
            `(−${FLOAT_TOLERANCE_PX} … +${SINK_TOLERANCE_PX})`,
        );
      }
    }
  }
  failUnlessMeasured('G3', measured, 'standing frames');
}

// ── G4 ───────────────────────────────────────────────────────────────────────

/** Rows whose feet are planted or stepping: every row but the death, which kneels. */
const LEG_ROWS: readonly ElectricGoblinRow[] = ELECTRIC_GOBLIN_ROW_NAMES.filter(
  (row) => row !== 'death',
);
/** Headroom a planted leg must keep below full reach, as a share of the leg. */
const LEG_HEADROOM = 0.02;
/** A foot this close to the floor, in tile units, carries weight. */
const PLANTED_LIFT = 0.005;

function gateLegReach(): void {
  const p = STYLE.proportions;
  const reach = (p.thighLength + p.shinLength) * (1 - LEG_HEADROOM);
  let measured = 0;
  for (const row of LEG_ROWS) {
    for (let frame = 0; frame < framesOf(row); frame++) {
      const { pose } = electricGoblinFrame(row, frame);
      const skeleton = buildSkeleton(STYLE, pose);
      const legs = [
        ['near', skeleton.nearLeg, pose.nearFoot],
        ['far', skeleton.farLeg, pose.farFoot],
      ] as const;
      for (const [side, leg, foot] of legs) {
        if (-foot.y > PLANTED_LIFT) continue;
        measured++;
        const ankle = { x: foot.x, y: foot.y - p.footHeight };
        const span = Math.hypot(ankle.x - leg.anchor.x, ankle.y - leg.anchor.y);
        if (span > reach) {
          fail(
            'G4',
            `${row}[${frame}]'s planted ${side} foot is ${span.toFixed(DECIMALS)} tiles from its ` +
              `hip, past the ${reach.toFixed(DECIMALS)} a leg can reach with headroom`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G4', measured, 'planted feet');
}

// ── G5 ───────────────────────────────────────────────────────────────────────

/** Cable insulation: saturated red, well clear of the mustard rubber and the copper. */
const CABLE_MIN_RED = 140;
const CABLE_MAX_GREEN = 80;
const CABLE_MAX_BLUE = 80;
/** The ring round a grip searched for cable ink, in tile units out from the fist's centre. */
const RING_INNER = 0.1;
const RING_OUTER = 0.3;

function isCable(pixels: Pixels, i: number): boolean {
  return (
    pixels.data[i + ALPHA_OFFSET] >= SOLID_ALPHA &&
    pixels.data[i] >= CABLE_MIN_RED &&
    pixels.data[i + GREEN_OFFSET] <= CABLE_MAX_GREEN &&
    pixels.data[i + BLUE_OFFSET] <= CABLE_MAX_BLUE
  );
}

function cableNear(pixels: Pixels, centre: { x: number; y: number }): boolean {
  const unit = DEF.tileScale * ELECTRIC_GOBLIN_SCALE;
  const inner = RING_INNER * unit;
  const outer = RING_OUTER * unit;
  for (let y = Math.floor(centre.y - outer); y <= Math.ceil(centre.y + outer); y++) {
    for (let x = Math.floor(centre.x - outer); x <= Math.ceil(centre.x + outer); x++) {
      if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) continue;
      const distance = Math.hypot(x - centre.x, y - centre.y);
      if (distance < inner || distance > outer) continue;
      if (isCable(pixels, (y * pixels.width + x) * CHANNELS)) return true;
    }
  }
  return false;
}

/**
 * Only the near cable is measured on every frame: the far one runs behind his
 * body by design and is hidden wherever the far fist is, which the near cable
 * never is.
 */
function gateCablesFollowHands(): void {
  let measured = 0;
  for (const row of ELECTRIC_GOBLIN_ROW_NAMES) {
    for (let frame = 0; frame < framesOf(row); frame++) {
      const fist = buildSkeleton(STYLE, electricGoblinFrame(row, frame).pose).nearArm.end;
      const unit = DEF.tileScale * ELECTRIC_GOBLIN_SCALE;
      const centre = {
        x: DEF.tileX + DEF.tileScale * TILE_CENTRE + fist.x * unit,
        y: DEF.tileY + DEF.tileScale + fist.y * unit,
      };
      measured++;
      if (!cableNear(pixelsOf(row, frame), centre)) {
        fail(
          'G5',
          `${row}[${frame}] shows no red cable within ${RING_OUTER} tiles of the near fist at ` +
            `(${centre.x.toFixed(1)}, ${centre.y.toFixed(1)}): the wire has come away from the rod`,
        );
      }
    }
  }
  failUnlessMeasured('G5', measured, 'frames');
}

// ── G6 ───────────────────────────────────────────────────────────────────────

interface EventExtreme {
  readonly row: ElectricGoblinRow;
  readonly eventFrame: number;
  readonly rod: 'near' | 'far';
  /** How the event frame must beat every other frame of the row. */
  readonly measure: 'lowest' | 'highest' | 'furthest';
  readonly what: string;
}

const EVENT_EXTREMES: readonly EventExtreme[] = [
  {
    row: 'plunge',
    eventFrame: ELECTRIC_GOBLIN_ROWS.plunge.eventFrame,
    rod: 'near',
    measure: 'lowest',
    what: 'the balls go into the floor',
  },
  {
    row: 'slam',
    eventFrame: ELECTRIC_GOBLIN_ROWS.slam.eventFrame,
    rod: 'near',
    measure: 'lowest',
    what: 'the balls hit the floor',
  },
  {
    row: 'grenade_toss',
    eventFrame: ELECTRIC_GOBLIN_ROWS.grenade_toss.eventFrame,
    rod: 'near',
    measure: 'highest',
    what: 'the grenade is let go',
  },
  {
    row: 'swipe',
    eventFrame: ELECTRIC_GOBLIN_ROWS.swipe.eventFrame,
    rod: 'near',
    measure: 'furthest',
    what: 'the ball connects',
  },
];
/** Frames after an impact may hold the ball where it landed, to this much, in tiles. */
const HOLD_TOLERANCE = 0.01;

function gateEventExtremes(): void {
  let measured = 0;
  for (const event of EVENT_EXTREMES) {
    const at = electricGoblinBallAnchor(event.row, event.eventFrame, event.rod, 1);
    const score = (point: { x: number; y: number }): number =>
      event.measure === 'lowest' ? point.y : event.measure === 'highest' ? -point.y : point.x;
    for (let frame = 0; frame < framesOf(event.row); frame++) {
      if (frame === event.eventFrame) continue;
      measured++;
      const other = electricGoblinBallAnchor(event.row, frame, event.rod, 1);
      if (score(other) > score(at) + HOLD_TOLERANCE) {
        fail(
          'G6',
          `${event.row}[${frame}] puts the ${event.rod} ball ${event.measure === 'furthest' ? 'further out' : event.measure === 'lowest' ? 'lower' : 'higher'} ` +
            `than frame ${event.eventFrame}, where ${event.what}: the event frame no longer marks the motion's extreme`,
        );
      }
    }
  }
  failUnlessMeasured('G6', measured, 'frames beside an event');
}

/** Runs every gate and returns one message per failure. */
export function electricGoblinGateFailures(): string[] {
  failures.length = 0;
  pixelCache.clear();
  const gates: ReadonlyArray<readonly [string, () => void]> = [
    ['G1', gateStructure],
    ['G2', gateRuntimeNames],
    ['G3', gateGround],
    ['G4', gateLegReach],
    ['G5', gateCablesFollowHands],
    ['G6', gateEventExtremes],
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
  console.log('Electric goblin art gates');
  if (!reportFigureGates('electric-goblin', electricGoblinGateFailures())) process.exitCode = 1;
}
