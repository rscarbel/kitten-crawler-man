/**
 * The Goblin High Security Prison's double door and the PRISON sign beside it,
 * painted onto the north wall face of floor 2's stealth gate room.
 *
 * Both are dungeon wall art rather than a town facade: the face strip is
 * painted first by the wall painter, and the door is set into it with a cast
 * concrete casing in floor 2's own cinderblock tones. The leaves are riveted
 * steel with three iron bands across both and a small barred window in each.
 *
 * The door spans two columns and both rows of the face. Each tile paints the
 * whole door in door-local coordinates, clipped to itself, because the floor is
 * baked into chunks clipped to their own rects: nothing may reach past a tile.
 */

import { CINDERBLOCK_RAMP, mix, shade } from '../../map/tilegen/palette';
import type { RGB } from '../../map/tilegen/raster';
import { rgba, BODY_TOP_TILES, FACE_STRIP_ROWS } from './dungeonWallGeometry';
import { worldText } from '../../ui/world/worldText';

type Ctx = CanvasRenderingContext2D;

/** Which tile of the two-by-two door a wall tile carries. */
export interface PrisonDoorPart {
  /** 0 for the west column, 1 for the east. */
  readonly column: number;
  readonly row: 'upper' | 'lower';
}

const OPAQUE = 1;
const HALF = 0.5;

const CASING: RGB = shade(CINDERBLOCK_RAMP.light, 1.25);
const CASING_SHADOW: RGB = CINDERBLOCK_RAMP.shadow;
const CASING_LIGHT: RGB = mix(CINDERBLOCK_RAMP.accent, [200, 205, 200], 0.25);
const STEEL: RGB = [46, 54, 60];
const STEEL_DARK: RGB = [22, 26, 30];
const STEEL_LIGHT: RGB = [88, 100, 108];
const IRON: RGB = [28, 30, 32];
const IRON_LIGHT: RGB = [96, 102, 106];
const RIVET: RGB = [150, 156, 158];
const WINDOW_DARK: RGB = [8, 9, 10];
const RUST: RGB = [118, 62, 32];
const RUST_ALPHA = 0.35;
const THRESHOLD_SHADOW_ALPHA = 0.55;

/** Door-local geometry, in tiles from the top-left of the door's upper west tile. */
const DOOR_WIDTH = 2;
const CASING_INSET = 0.1;
const CASING_TOP = BODY_TOP_TILES + 0.14;
const CASING_THICKNESS = 0.1;
const LEAF_INSET = CASING_INSET + CASING_THICKNESS;
const LEAF_TOP = CASING_TOP + CASING_THICKNESS;
const FLOOR_Y = FACE_STRIP_ROWS;
const SEAM_HALF_WIDTH = 0.015;
const BAND_HEIGHT = 0.09;
const BAND_ROWS = [0.36, 0.68, 0.93] as const;
const RIVETS_PER_LEAF = 4;
const RIVET_RADIUS = 0.022;
const WINDOW_TOP = 0.12;
const WINDOW_HEIGHT = 0.2;
const WINDOW_WIDTH = 0.36;
const WINDOW_BARS = 3;
const WINDOW_BAR_WIDTH = 0.035;
const HINGE_WIDTH = 0.06;
const HINGE_HEIGHT = 0.1;
const HINGE_ROWS = [0.22, 0.8] as const;
const LOCK_WIDTH = 0.14;
const LOCK_HEIGHT = 0.18;
const LOCK_CENTRE = 0.55;
const KEYHOLE_RADIUS = 0.02;
const THRESHOLD_HEIGHT = 0.05;
const LINE_WIDTH = 0.02;

function fill(ctx: Ctx, color: RGB, x: number, y: number, w: number, h: number, alpha = OPAQUE) {
  ctx.fillStyle = rgba(color, alpha);
  ctx.fillRect(x, y, w, h);
}

function circle(ctx: Ctx, color: RGB, x: number, y: number, radius: number) {
  ctx.fillStyle = rgba(color, OPAQUE);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Paints the whole door with its top-left at (ox, oy). */
function paintDoor(ctx: Ctx, ox: number, oy: number, ts: number): void {
  const px = (tiles: number): number => tiles * ts;
  const casingLeft = ox + px(CASING_INSET);
  const casingRight = ox + px(DOOR_WIDTH - CASING_INSET);
  const casingTop = oy + px(CASING_TOP);
  const floorY = oy + px(FLOOR_Y);

  fill(ctx, CASING_SHADOW, casingLeft, casingTop, casingRight - casingLeft, floorY - casingTop);
  fill(
    ctx,
    CASING,
    casingLeft + px(LINE_WIDTH),
    casingTop + px(LINE_WIDTH),
    casingRight - casingLeft - px(LINE_WIDTH * 2),
    floorY - casingTop,
  );
  fill(ctx, CASING_LIGHT, casingLeft, casingTop, casingRight - casingLeft, px(LINE_WIDTH));

  const leafLeft = ox + px(LEAF_INSET);
  const leafRight = ox + px(DOOR_WIDTH - LEAF_INSET);
  const leafTop = oy + px(LEAF_TOP);
  const leafHeight = floorY - leafTop;
  const middle = ox + px(DOOR_WIDTH * HALF);
  fill(ctx, STEEL_DARK, leafLeft, leafTop, leafRight - leafLeft, leafHeight);
  for (const [left, right] of [
    [leafLeft, middle],
    [middle, leafRight],
  ] as const) {
    fill(
      ctx,
      STEEL,
      left + px(LINE_WIDTH),
      leafTop + px(LINE_WIDTH),
      right - left - px(LINE_WIDTH * 2),
      leafHeight,
    );
    fill(
      ctx,
      STEEL_LIGHT,
      left + px(LINE_WIDTH),
      leafTop + px(LINE_WIDTH),
      px(LINE_WIDTH),
      leafHeight,
    );
    paintWindow(ctx, (left + right) * HALF, leafTop + px(WINDOW_TOP), ts);
  }
  fill(ctx, IRON, middle - px(SEAM_HALF_WIDTH), leafTop, px(SEAM_HALF_WIDTH * 2), leafHeight);

  for (const share of BAND_ROWS) {
    const bandY = leafTop + leafHeight * share;
    fill(ctx, IRON, leafLeft, bandY, leafRight - leafLeft, px(BAND_HEIGHT));
    fill(ctx, IRON_LIGHT, leafLeft, bandY, leafRight - leafLeft, px(LINE_WIDTH));
    fill(
      ctx,
      RUST,
      leafLeft,
      bandY + px(BAND_HEIGHT) - px(LINE_WIDTH),
      leafRight - leafLeft,
      px(LINE_WIDTH),
      RUST_ALPHA,
    );
    const rivetY = bandY + px(BAND_HEIGHT * HALF);
    for (const [left, right] of [
      [leafLeft, middle],
      [middle, leafRight],
    ] as const) {
      for (let rivet = 0; rivet < RIVETS_PER_LEAF; rivet++) {
        const rivetX = left + ((rivet + HALF) / RIVETS_PER_LEAF) * (right - left);
        circle(ctx, RIVET, rivetX, rivetY, Math.max(1, px(RIVET_RADIUS)));
      }
    }
  }

  for (const share of HINGE_ROWS) {
    const hingeY = leafTop + leafHeight * share;
    fill(ctx, IRON, leafLeft - px(HINGE_WIDTH * HALF), hingeY, px(HINGE_WIDTH), px(HINGE_HEIGHT));
    fill(ctx, IRON, leafRight - px(HINGE_WIDTH * HALF), hingeY, px(HINGE_WIDTH), px(HINGE_HEIGHT));
  }

  const lockY = leafTop + leafHeight * LOCK_CENTRE;
  fill(
    ctx,
    IRON,
    middle - px(LOCK_WIDTH * HALF),
    lockY - px(LOCK_HEIGHT * HALF),
    px(LOCK_WIDTH),
    px(LOCK_HEIGHT),
  );
  fill(
    ctx,
    IRON_LIGHT,
    middle - px(LOCK_WIDTH * HALF),
    lockY - px(LOCK_HEIGHT * HALF),
    px(LOCK_WIDTH),
    px(LINE_WIDTH),
  );
  circle(ctx, WINDOW_DARK, middle, lockY, Math.max(1, px(KEYHOLE_RADIUS)));

  fill(
    ctx,
    WINDOW_DARK,
    leafLeft,
    floorY - px(THRESHOLD_HEIGHT),
    leafRight - leafLeft,
    px(THRESHOLD_HEIGHT),
    THRESHOLD_SHADOW_ALPHA,
  );
}

/** A small barred window centred on `centreX`, its top at `top`. */
function paintWindow(ctx: Ctx, centreX: number, top: number, ts: number): void {
  const width = WINDOW_WIDTH * ts;
  const height = WINDOW_HEIGHT * ts;
  const left = centreX - width * HALF;
  fill(
    ctx,
    IRON,
    left - LINE_WIDTH * ts,
    top - LINE_WIDTH * ts,
    width + LINE_WIDTH * ts * 2,
    height + LINE_WIDTH * ts * 2,
  );
  fill(ctx, WINDOW_DARK, left, top, width, height);
  const barWidth = Math.max(1, WINDOW_BAR_WIDTH * ts);
  for (let bar = 0; bar < WINDOW_BARS; bar++) {
    const barX = left + ((bar + 1) / (WINDOW_BARS + 1)) * width - barWidth * HALF;
    fill(ctx, IRON_LIGHT, barX, top, barWidth, height);
  }
}

/**
 * Draws the part of the prison door a wall face tile carries, over the face
 * the wall painter has already drawn there.
 */
export function drawPrisonDoorTile(
  ctx: Ctx,
  part: PrisonDoorPart,
  sx: number,
  sy: number,
  ts: number,
): void {
  const rowOffset = part.row === 'upper' ? 0 : 1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, ts, ts);
  ctx.clip();
  paintDoor(ctx, sx - part.column * ts, sy - rowOffset * ts, ts);
  ctx.restore();
}

const SIGN_PLATE: RGB = [150, 34, 28];
const SIGN_PLATE_DARK: RGB = [86, 18, 16];
const SIGN_INK: RGB = [236, 228, 206];
const SIGN_LEFT = 0.08;
const SIGN_TOP = 0.1;
const SIGN_WIDTH = 0.84;
const SIGN_HEIGHT = 0.5;
const SIGN_BORDER = 0.035;
const SIGN_TEXT_SIZE = 0.17;
const SIGN_TEXT_Y = 0.25;
const SIGN_ARROW_Y = 0.45;
const SIGN_ARROW_HALF_LENGTH = 0.24;
const SIGN_ARROW_HEAD = 0.08;
const SIGN_ARROW_STROKE = 0.045;
const SIGN_SCREW_RADIUS = 0.02;
const SIGN_SCREW_INSET = 0.06;
const SIGN_SHADOW_OFFSET = 0.025;
const SIGN_SHADOW_ALPHA = 0.4;

/** The enamel PRISON plate on the lower face tile beside the door, its arrow toward it. */
export function drawPrisonSignTile(
  ctx: Ctx,
  arrow: 'west' | 'east',
  sx: number,
  sy: number,
  ts: number,
): void {
  const left = sx + SIGN_LEFT * ts;
  const top = sy + SIGN_TOP * ts;
  const width = SIGN_WIDTH * ts;
  const height = SIGN_HEIGHT * ts;
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, ts, ts);
  ctx.clip();
  fill(
    ctx,
    WINDOW_DARK,
    left + SIGN_SHADOW_OFFSET * ts,
    top + SIGN_SHADOW_OFFSET * ts,
    width,
    height,
    SIGN_SHADOW_ALPHA,
  );
  fill(ctx, SIGN_PLATE_DARK, left, top, width, height);
  const border = SIGN_BORDER * ts;
  fill(ctx, SIGN_PLATE, left + border, top + border, width - border * 2, height - border * 2);
  for (const screwX of [left + SIGN_SCREW_INSET * ts, left + width - SIGN_SCREW_INSET * ts]) {
    circle(
      ctx,
      RIVET,
      screwX,
      top + height - SIGN_SCREW_INSET * ts,
      Math.max(1, SIGN_SCREW_RADIUS * ts),
    );
  }
  worldText(ctx, 'PRISON', {
    x: sx + ts * HALF,
    y: sy + SIGN_TEXT_Y * ts,
    size: SIGN_TEXT_SIZE * ts,
    bold: true,
    color: rgba(SIGN_INK, OPAQUE),
    outline: false,
    align: 'center',
    baseline: 'middle',
  });
  const direction = arrow === 'east' ? 1 : -1;
  const centreX = sx + ts * HALF;
  const arrowY = sy + SIGN_ARROW_Y * ts;
  const tipX = centreX + direction * SIGN_ARROW_HALF_LENGTH * ts;
  ctx.strokeStyle = rgba(SIGN_INK, OPAQUE);
  ctx.lineWidth = Math.max(1, SIGN_ARROW_STROKE * ts);
  ctx.beginPath();
  ctx.moveTo(centreX - direction * SIGN_ARROW_HALF_LENGTH * ts, arrowY);
  ctx.lineTo(tipX, arrowY);
  ctx.stroke();
  ctx.fillStyle = rgba(SIGN_INK, OPAQUE);
  ctx.beginPath();
  ctx.moveTo(tipX + direction * SIGN_ARROW_HEAD * ts, arrowY);
  ctx.lineTo(tipX - direction * SIGN_ARROW_HEAD * ts * HALF, arrowY - SIGN_ARROW_HEAD * ts);
  ctx.lineTo(tipX - direction * SIGN_ARROW_HEAD * ts * HALF, arrowY + SIGN_ARROW_HEAD * ts);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
