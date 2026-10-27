/**
 * Gates for the club casts' seated figures, run by each cast's own gate
 * script over its own looks:
 *
 *   S1  every seated cell stays inside its frame and paints a figure
 *   S2  every state the club's sit draw can ask for is painted
 *   S3  a one-shot pose's first frame is the idle's first frame, so a seat's
 *       action loop chains idle → play → idle with no pop
 *   S4  the frozen bar-stool seat height still matches the stool's painted seat
 */

import { createCanvas } from 'canvas';

import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { paintFigureCell } from './figureSheet.js';
import { asGameContext } from './nodeGameContext.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { CLUB_TILE_SCALE, drawBarStool } from '../src/sprites/art/clubFurnitureArt.js';
import {
  BAR_STOOL_SEAT_HEIGHT_TILES,
  SEAT_POSE_LOOPS,
  SEAT_POSES,
  SEAT_VIEWS,
  seatStateName,
} from '../src/sprites/art/seatPoses.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** A seated figure is narrower than its cell, which is sized for a cheer's raised arms. */
const SEATED_MIN_INK_AREA_SHARE = 0.05;
/** Channel difference past which two seam cells count as different pixels. */
const SEAM_CHANNEL_TOLERANCE = 2;

/** S1 and S2 for one seated figure. */
export function seatedFigureFailures(figure: FigureDef): string[] {
  const failures = figureStructuralFailures(figure, {
    minInkAreaShare: SEATED_MIN_INK_AREA_SHARE,
  }).map((failure) => `S1: ${failure}`);
  const names = SEAT_POSES.flatMap((pose) => SEAT_VIEWS.map((view) => seatStateName(pose, view)));
  failures.push(
    ...missingStateFailures(figure, names, 'the club sit draw').map((failure) => `S2: ${failure}`),
  );
  return failures;
}

/** S3 for one seated figure: every one-shot pose opens on the idle's own first frame. */
export function seatedSeamFailures(figure: FigureDef): string[] {
  const failures: string[] = [];
  let measured = 0;
  for (const view of SEAT_VIEWS) {
    const rest = paintFigureCell(figure, seatStateName('idle', view), 0);
    const restPixels = rest.getContext('2d').getImageData(0, 0, rest.width, rest.height).data;
    for (const pose of SEAT_POSES) {
      if (SEAT_POSE_LOOPS[pose]) continue;
      measured++;
      const state = seatStateName(pose, view);
      const first = paintFigureCell(figure, state, 0);
      const pixels = first.getContext('2d').getImageData(0, 0, first.width, first.height).data;
      let differing = 0;
      for (let i = 0; i < pixels.length; i++) {
        if (Math.abs(pixels[i] - restPixels[i]) > SEAM_CHANNEL_TOLERANCE) differing++;
      }
      if (differing > 0) {
        failures.push(
          `S3: ${figure.id}.${state}[0] differs from its idle's first frame in ${differing} channels — ` +
            'the pose pops on the way in from the idle',
        );
      }
    }
  }
  failures.push(...nothingMeasuredFailures(measured, 'one-shot seat poses').map((m) => `S3: ${m}`));
  return failures;
}

/** How far the frozen seat height may sit from the painted seat, in tiles. */
const SEAT_HEIGHT_TOLERANCE_TILES = 0.02;
const REPORT_DECIMALS = 3;
/** Headroom the stool's sheet gives it above its footprint row, in tiles. */
const STOOL_HEADROOM_TILES = 0.5;

/**
 * S4. The seat's centre is the widest row of the stool's top half: the cushion
 * is an ellipse seen from above, wider than every leg and the foot ring.
 */
export function barStoolSeatFailures(): string[] {
  const headroom = CLUB_TILE_SCALE * STOOL_HEADROOM_TILES;
  const height = CLUB_TILE_SCALE + headroom;
  const canvas = createCanvas(CLUB_TILE_SCALE, height);
  const ctx = canvas.getContext('2d');
  drawBarStool(
    asGameContext(ctx),
    { w: CLUB_TILE_SCALE, h: height, footTop: headroom, footBottom: height },
    0,
    0,
  );
  const { data } = ctx.getImageData(0, 0, CLUB_TILE_SCALE, height);
  // Above the middle of the footprint row: the seat, and none of the foot ring.
  const seatSearchRows = headroom + CLUB_TILE_SCALE / 2;
  const widths: number[] = [];
  for (let y = 0; y < seatSearchRows; y++) {
    let inked = 0;
    for (let x = 0; x < CLUB_TILE_SCALE; x++) {
      if (data[(y * CLUB_TILE_SCALE + x) * CHANNELS + ALPHA_OFFSET] > 0) inked++;
    }
    widths.push(inked);
  }
  const widest = Math.max(...widths);
  // An ellipse's widest stretch is several rows deep once it lands on whole
  // pixels; its centre is the middle of that run.
  const firstWidest = widths.indexOf(widest);
  const lastWidest = widths.lastIndexOf(widest);
  const widestRow = widest > 0 ? (firstWidest + lastWidest) / 2 : -1;
  if (widestRow < 0) return ['S4: the bar stool painted nothing to sit on'];
  const paintedTiles = (height - widestRow) / CLUB_TILE_SCALE;
  if (Math.abs(paintedTiles - BAR_STOOL_SEAT_HEIGHT_TILES) > SEAT_HEIGHT_TOLERANCE_TILES) {
    return [
      `S4: the bar stool's seat is painted ${paintedTiles.toFixed(REPORT_DECIMALS)} tiles up, but seated ` +
        `figures sit at BAR_STOOL_SEAT_HEIGHT_TILES = ${BAR_STOOL_SEAT_HEIGHT_TILES}`,
    ];
  }
  return [];
}
