/**
 * Gates for the working tool drawn over Carl's chop and mine rows.
 *
 * The tool is not in his cells — `toolOverlaySprite.ts` lays it along the line
 * his two fists make on each drawn cell — so none of his figure gates can see
 * it. These hold the overlay's per-cell placement, read through the same
 * `toolOverlayOf` the runtime calls:
 *
 * - T1: every frame of every swing draws the tool from the fist the row names
 *   as holding the butt through the other fist, puts that grip inside the
 *   cell, and draws the fists far enough apart that the line between them
 *   is a direction rather than noise.
 * - T2: the blow lands on the frame the rows name as `impact` — the pick's
 *   head driven furthest down onto the rock, the axe's furthest into the
 *   trunk: forward at waist height in profile; head-on, down at his feet on
 *   his centreline; from behind, down at his feet beside his left leg, where
 *   his body does not hide it. Both tell the axe's blow from the
 *   pick's, which lands out beside his right foot. The chips, the shake and the sound are
 *   struck on that frame, so a swing whose extreme falls a frame either side
 *   sounds before or after the picture hits.
 * - T3: facing −X draws the same tool reflected: the grip mirrored about the
 *   tile's centre, the haft's angle reflected, the blade on the other side.
 * - T4: the tool never lies across his face, head-on or in profile, unless a
 *   fist is already there — the frame a tool comes down past his chin. Laid
 *   over the face the handle reads as a bar across it, and the head as a
 *   mask.
 *
 *   npm run gates:human-tools
 */

import { pathToFileURL } from 'node:url';
import { nothingMeasuredFailures, reportFigureGates } from './figureGates.js';
import {
  CHOP_ROWS,
  eventFrame,
  FRAME_H,
  FRAME_W,
  GROUND_OFFSET_IN_TILE,
  HUMAN_ROW_TABLE,
  type HumanRowMeta,
  type HumanRowName,
  MINE_ROWS,
  TILE_X,
  TILE_Y,
} from '../src/sprites/art/humanFigure.js';
import {
  HUMAN_SCALE,
  TILE_CENTRE_FRACTION,
  TILE_SCALE,
} from '../src/sprites/art/human/figureScale.js';
import { handGripInTile, probeHumanJoints } from '../src/sprites/art/human/probe.js';
import { HEAD_RX } from '../src/sprites/art/carl/proportions.js';
import { type BodySide } from '../src/sprites/art/carl/rig.js';
import { toolHalfBreadth, toolHaftLength } from '../src/sprites/art/toolArt.js';
import { toolOverlayOf, type ToolOverlayPlacement } from '../src/sprites/toolOverlaySprite.js';
import { MAX_TOOL_TIER, TOOL_TIER_BASIC, type ToolTier } from '../src/core/toolTiers.js';
import type { Pt } from '../src/sprites/art/carlArt.js';

/**
 * The closest the two grips may be drawn, in tiles. The haft's direction is
 * the line between them; much closer than a third of a hand's width and a
 * one-pixel wobble of either fist at the 32 px tile swings the tool tens of
 * degrees.
 */
const MIN_GRIP_SPACING_TILES = 0.025;
/**
 * The height the axe bites at in profile, in rig units above the floor: from
 * mid-thigh to the ribs. A trunk is chopped at the waist; much lower is
 * chopping a log, much higher a branch.
 */
const CHOP_HEIGHT_MIN_UNITS = 0.7;
const CHOP_HEIGHT_MAX_UNITS = 1.4;
/**
 * Head-on and from behind the axe is driven down into the foot of a trunk
 * ahead of him, bent over it: its head lands low, from a little ahead of his
 * soles (below the ground line on the screen, as the floor ahead of him is
 * drawn) to his shins. Head-on it also lands on his centreline; off it by
 * more than the half-width below is the pick's strike, which lands out
 * beside his right foot.
 */
const FRONT_STRIKE_MIN_UNITS = -0.3;
const FRONT_STRIKE_MAX_UNITS = 0.6;
const FRONT_STRIKE_HALF_WIDTH_TILES = 0.2;
/**
 * From behind, a strike on his centreline is hidden by his body, so the axe
 * comes down beside his left leg instead: at least this far out from his
 * centreline, on the side opposite the pick's strike.
 */
const BESIDE_LEG_MIN_TILES = 0.2;
/** Tolerance on a mirrored placement against its reflection, in tiles and radians. */
const MIRROR_EPSILON = 1e-9;
const DIGITS = 3;

const CELL_LEFT_TILES = -TILE_X / TILE_SCALE;
const CELL_RIGHT_TILES = (FRAME_W - TILE_X) / TILE_SCALE;
const CELL_TOP_TILES = -TILE_Y / TILE_SCALE;
const CELL_BOTTOM_TILES = (FRAME_H - TILE_Y) / TILE_SCALE;

/**
 * Which way a blow drives the tool's head, as a screen direction the head
 * must reach furthest along on the impact frame. Edge-on the pick comes down
 * forward and down onto the rock, and its backswing takes the head lower
 * still but behind him — measured straight down, the backswing would win.
 */
type SwingDrive = 'forward' | 'down' | 'forwardDown' | 'downInFront' | 'downBesideLeftLeg';

/** The screen direction a drive is measured along. */
function driveDirection(drive: SwingDrive): Pt {
  switch (drive) {
    case 'forward':
      return { x: 1, y: 0 };
    case 'down':
      return { x: 0, y: 1 };
    case 'forwardDown':
      return { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    case 'downInFront':
    case 'downBesideLeftLeg':
      return { x: 0, y: 1 };
  }
}

/** Drives that land a blow on a trunk, so at his waist. */
function bitesAtWaist(drive: SwingDrive): boolean {
  return drive === 'forward';
}

const DRIVE_WORDS: Readonly<Record<SwingDrive, string>> = {
  forward: 'further forward',
  down: 'lower',
  forwardDown: 'further forward and down',
  downInFront: 'lower',
  downBesideLeftLeg: 'lower',
};

interface SwingRow {
  readonly row: HumanRowName;

  readonly drive: SwingDrive;
}

const SWING_ROWS: readonly SwingRow[] = [
  { row: CHOP_ROWS.side, drive: 'forward' },
  { row: CHOP_ROWS.front, drive: 'downInFront' },
  { row: CHOP_ROWS.back, drive: 'downBesideLeftLeg' },
  { row: MINE_ROWS.side, drive: 'forwardDown' },
  { row: MINE_ROWS.front, drive: 'down' },
  { row: MINE_ROWS.back, drive: 'down' },
];

function placementOf(
  row: HumanRowName,
  frame: number,
  flipX: boolean,
): ToolOverlayPlacement | null {
  return toolOverlayOf({ row, frame, flipX });
}

/** Where the tool's head is, in tile fractions, for a tier's haft (the basic tier's by default). */
function headOf(placement: ToolOverlayPlacement, tier: ToolTier = TOOL_TIER_BASIC): Pt {
  const reach = toolHaftLength(tier) * HUMAN_SCALE * placement.lengthShare;
  return {
    x: placement.grip.x + Math.cos(placement.haftAngle) * reach,
    y: placement.grip.y + Math.sin(placement.haftAngle) * reach,
  };
}

function gatePlacement(failures: string[]): void {
  let framesMeasured = 0;
  for (const { row } of SWING_ROWS) {
    for (let frame = 0; frame < HUMAN_ROW_TABLE[row].frameCount; frame++) {
      const placement = placementOf(row, frame, false);
      if (placement === null) {
        failures.push(`T1: ${row}[${frame}] draws no tool at all`);
        continue;
      }
      framesMeasured++;
      const { grip } = placement;
      const inside =
        Number.isFinite(grip.x) &&
        Number.isFinite(grip.y) &&
        grip.x >= CELL_LEFT_TILES &&
        grip.x <= CELL_RIGHT_TILES &&
        grip.y >= CELL_TOP_TILES &&
        grip.y <= CELL_BOTTOM_TILES;
      if (!inside) {
        failures.push(
          `T1: ${row}[${frame}] puts the butt grip at (${grip.x.toFixed(DIGITS)}, ` +
            `${grip.y.toFixed(DIGITS)}) tiles, outside the cell`,
        );
      }
      const buttSide = buttFistOf(row, frame);
      const butt = handGripInTile(row, frame, false, buttSide).centre;
      const upper = handGripInTile(
        row,
        frame,
        false,
        buttSide === 'left' ? 'right' : 'left',
      ).centre;
      const gripOff = Math.hypot(grip.x - butt.x, grip.y - butt.y);
      const haftOff = angleGap(placement.haftAngle, Math.atan2(upper.y - butt.y, upper.x - butt.x));
      if (gripOff > MIRROR_EPSILON || haftOff > MIRROR_EPSILON) {
        failures.push(
          `T1: ${row}[${frame}] does not draw the tool from his ${buttSide} fist, which the row ` +
            `names as the butt, through his other (grip off by ${gripOff.toFixed(DIGITS)} tiles, ` +
            `haft by ${haftOff.toFixed(DIGITS)} rad)`,
        );
      }
      const spacing = Math.hypot(upper.x - butt.x, upper.y - butt.y);
      if (spacing < MIN_GRIP_SPACING_TILES) {
        failures.push(
          `T1: ${row}[${frame}] draws the fists ${spacing.toFixed(DIGITS)} tiles apart ` +
            `(need ${MIN_GRIP_SPACING_TILES}) — too close for the haft between them to have a direction`,
        );
      }
    }
  }
  failures.push(...nothingMeasuredFailures(framesMeasured, 'swing frames').map((f) => `T1: ${f}`));
}

/** The fist the row table names as holding the tool's butt on a frame, read independently of the overlay. */
function buttFistOf(row: HumanRowName, frame: number): BodySide {
  const meta: HumanRowMeta = HUMAN_ROW_TABLE[row];
  return meta.toolButt?.[frame] ?? 'left';
}

function gateImpact(failures: string[]): void {
  let rowsMeasured = 0;
  for (const { row, drive } of SWING_ROWS) {
    const impact = eventFrame(row, 'impact');
    if (impact === undefined) {
      failures.push(`T2: ${row} names no impact frame`);
      continue;
    }
    const heads: Pt[] = [];
    for (let frame = 0; frame < HUMAN_ROW_TABLE[row].frameCount; frame++) {
      const placement = placementOf(row, frame, false);
      if (placement !== null) heads.push(headOf(placement));
    }
    if (heads.length !== HUMAN_ROW_TABLE[row].frameCount) continue;
    rowsMeasured++;
    const direction = driveDirection(drive);
    const driven = (head: Pt): number => head.x * direction.x + head.y * direction.y;
    const atImpact = driven(heads[impact]);
    heads.forEach((head, frame) => {
      if (frame !== impact && driven(head) >= atImpact) {
        failures.push(
          `T2: ${row}'s tool head is driven ${DRIVE_WORDS[drive]} ` +
            `on frame ${frame} (${driven(head).toFixed(DIGITS)}) than on its impact frame ${impact} ` +
            `(${atImpact.toFixed(DIGITS)}) — the blow sounds a frame off the picture`,
        );
      }
    });
    const heightUnits = (GROUND_OFFSET_IN_TILE - heads[impact].y) / HUMAN_SCALE;
    const lowEnough =
      heightUnits >= FRONT_STRIKE_MIN_UNITS && heightUnits <= FRONT_STRIKE_MAX_UNITS;
    if (drive === 'downBesideLeftLeg') {
      // From behind he is drawn unreflected, so his left is screen left.
      const outToHisLeft = TILE_CENTRE_FRACTION - heads[impact].x;
      if (!lowEnough || outToHisLeft < BESIDE_LEG_MIN_TILES) {
        failures.push(
          `T2: ${row} strikes ${heightUnits.toFixed(DIGITS)} rig units off the floor and ` +
            `${outToHisLeft.toFixed(DIGITS)} tiles out to his left — not low beside ` +
            `his left leg (${FRONT_STRIKE_MIN_UNITS}–${FRONT_STRIKE_MAX_UNITS} units up, at ` +
            `least ${BESIDE_LEG_MIN_TILES} tiles out)`,
        );
      }
    }
    if (drive === 'downInFront') {
      const offCentre = Math.abs(heads[impact].x - TILE_CENTRE_FRACTION);
      if (!lowEnough || offCentre > FRONT_STRIKE_HALF_WIDTH_TILES) {
        failures.push(
          `T2: ${row} strikes ${heightUnits.toFixed(DIGITS)} rig units off the floor and ` +
            `${offCentre.toFixed(DIGITS)} tiles off his centreline — outside the strike ahead of ` +
            `him (${FRONT_STRIKE_MIN_UNITS}–${FRONT_STRIKE_MAX_UNITS} units up, within ` +
            `${FRONT_STRIKE_HALF_WIDTH_TILES} tiles of centre)`,
        );
      }
    }
    if (bitesAtWaist(drive)) {
      const heightUnits = (GROUND_OFFSET_IN_TILE - heads[impact].y) / HUMAN_SCALE;
      if (heightUnits < CHOP_HEIGHT_MIN_UNITS || heightUnits > CHOP_HEIGHT_MAX_UNITS) {
        failures.push(
          `T2: ${row} bites ${heightUnits.toFixed(DIGITS)} rig units off the floor, outside the ` +
            `waist band ${CHOP_HEIGHT_MIN_UNITS}–${CHOP_HEIGHT_MAX_UNITS}`,
        );
      }
    }
  }
  failures.push(...nothingMeasuredFailures(rowsMeasured, 'swing rows').map((f) => `T2: ${f}`));
}

/** The same angle, reflected across a vertical line. */
function reflectedAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), -Math.cos(angle));
}

function angleGap(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function gateMirror(failures: string[]): void {
  let framesMeasured = 0;
  for (const { row } of SWING_ROWS) {
    if (!HUMAN_ROW_TABLE[row].mirrorable) continue;
    for (let frame = 0; frame < HUMAN_ROW_TABLE[row].frameCount; frame++) {
      const facing = placementOf(row, frame, false);
      const flipped = placementOf(row, frame, true);
      if (facing === null || flipped === null) continue;
      framesMeasured++;
      const gripOff =
        Math.abs(flipped.grip.x - (1 - facing.grip.x)) + Math.abs(flipped.grip.y - facing.grip.y);
      const angleOff = angleGap(flipped.haftAngle, reflectedAngle(facing.haftAngle));
      if (gripOff > MIRROR_EPSILON || angleOff > MIRROR_EPSILON) {
        failures.push(
          `T3: ${row}[${frame}] facing −X is not the reflection of facing +X ` +
            `(grip off by ${gripOff.toFixed(DIGITS)} tiles, haft by ${angleOff.toFixed(DIGITS)} rad)`,
        );
      }
      if (flipped.mirrored === facing.mirrored) {
        failures.push(
          `T3: ${row}[${frame}] keeps the blade on the same side facing −X — a reflected swing turns ` +
            'the other way, so its leading side must flip too',
        );
      }
    }
  }
  failures.push(
    ...nothingMeasuredFailures(framesMeasured, 'mirrored swing frames').map((f) => `T3: ${f}`),
  );
}

/**
 * The face's disc, as a share of the head's half-width: the eyes, nose and
 * mouth, not the ears and the hair round them, which a handle may pass over.
 */
const FACE_SHARE = 0.8;
/** Samples along the haft tested against the face: one per cell pixel or so at the art's own tile. */
const HAFT_SAMPLES = 24;

/** Evenly spaced points from `a` to `b`, both ends included. */
function samplesBetween(a: Pt, b: Pt): Pt[] {
  return Array.from({ length: HAFT_SAMPLES + 1 }, (_unused, sample) => {
    const t = sample / HAFT_SAMPLES;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  });
}

function inDisc(point: Pt, centre: Pt, radius: number): boolean {
  return Math.hypot(point.x - centre.x, point.y - centre.y) <= radius;
}

function gateFace(failures: string[]): void {
  let framesMeasured = 0;
  const faceRadius = HEAD_RX * HUMAN_SCALE * FACE_SHARE;
  for (const { row } of SWING_ROWS) {
    // From behind the tool is drawn under him, so it cannot cover anything.
    if (HUMAN_ROW_TABLE[row].view === 'back') continue;
    for (let frame = 0; frame < HUMAN_ROW_TABLE[row].frameCount; frame++) {
      const placement = placementOf(row, frame, false);
      if (placement === null) continue;
      const headCell = probeHumanJoints(row, frame).headCentre;
      const face = { x: (headCell.x - TILE_X) / TILE_SCALE, y: (headCell.y - TILE_Y) / TILE_SCALE };
      const leftFist = handGripInTile(row, frame, false, 'left').centre;
      const rightFist = handGripInTile(row, frame, false, 'right').centre;
      if (inDisc(leftFist, face, faceRadius) || inDisc(rightFist, face, faceRadius)) continue;
      framesMeasured++;
      const head = headOf(placement, MAX_TOOL_TIER);
      const haftCrosses = samplesBetween(placement.grip, head).some((p) =>
        inDisc(p, face, faceRadius),
      );
      // The head is a bar across the haft's end, as broad as the blade or the
      // pick's arms reach: a haft that stops short of the face can still hang
      // its blade over it.
      const across = { x: -Math.sin(placement.haftAngle), y: Math.cos(placement.haftAngle) };
      const breadth = toolHalfBreadth(MAX_TOOL_TIER) * HUMAN_SCALE;
      const headBar = samplesBetween(
        { x: head.x - across.x * breadth, y: head.y - across.y * breadth },
        { x: head.x + across.x * breadth, y: head.y + across.y * breadth },
      );
      const headCovers = headBar.some((p) => inDisc(p, face, faceRadius));
      if (haftCrosses || headCovers) {
        failures.push(
          `T4: ${row}[${frame}] lays the tool's ${haftCrosses ? 'haft' : 'head'} across his face`,
        );
      }
    }
  }
  failures.push(
    ...nothingMeasuredFailures(framesMeasured, 'frames with his face clear of his fists').map(
      (f) => `T4: ${f}`,
    ),
  );
}

export function humanToolGateFailures(): string[] {
  const failures: string[] = [];
  gatePlacement(failures);
  gateImpact(failures);
  gateMirror(failures);
  gateFace(failures);
  return failures;
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  console.log('Gating the working tool over Carl…');
  reportFigureGates('human tools', humanToolGateFailures());
}
