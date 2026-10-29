/**
 * Review harness for the safe room's doctor's corner: the medicine cabinet's two
 * tiles against a strip of north wall, the doctor's bag on the floor in front of
 * its west half, and the doctor standing in front of its east half. Written at
 * the in-game tile size and enlarged.
 *
 *   npm run render:safe-room-clinic
 */

import { createCanvas } from 'canvas';

import { asGameContext } from './nodeGameContext.js';
import { paintFigureCell } from './figureSheet.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { drawDoctorsBag, drawMedicineCabinetTile } from '../src/sprites/safeRoomClinic.js';
import { doctorFigure, doctorLookForRoom } from '../src/sprites/art/doctorFigure.js';
import { safeRoomIdIn } from '../src/map/safeRoomId.js';

const SCALES: readonly number[] = [1, 4];
const ROOM_TILES_WIDE = 4;
const WALL_ROWS = 1;
const FLOOR_ROWS = 2;
/** The cabinet's west tile, in room tiles from the room's west edge. */
const CABINET_TILE_X = 1;
const WALL = '#2a2420';
const WALL_FOOT = '#1a1512';
const FLOOR = '#b7a58a';
const FLOOR_JOINT = 'rgba(0,0,0,0.12)';
const WALL_FOOT_TILES = 0.08;
/** The bag stands near the top edge of the floor tile in front of the cabinet's west half. */
const BAG_TILE_X = 0.5;
const BAG_GROUND_TILES = 0.4;
/** Which room's doctor stands in the corner. */
const DOCTOR_ROOM = safeRoomIdIn({ kind: 'floor', level: 'level1' }, 0);
const DOCTOR_FRAME = 0;

function renderAt(scale: number): Buffer {
  const ts = TILE_SIZE * scale;
  const canvas = createCanvas(ROOM_TILES_WIDE * ts, (WALL_ROWS + 1 + FLOOR_ROWS) * ts);
  const ctx = canvas.getContext('2d');
  const wallBottom = WALL_ROWS * ts;
  ctx.fillStyle = WALL;
  ctx.fillRect(0, 0, canvas.width, wallBottom);
  ctx.fillStyle = WALL_FOOT;
  ctx.fillRect(0, wallBottom - WALL_FOOT_TILES * ts, canvas.width, WALL_FOOT_TILES * ts);
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, wallBottom, canvas.width, canvas.height - wallBottom);
  ctx.fillStyle = FLOOR_JOINT;
  for (let column = 1; column < ROOM_TILES_WIDE; column++) {
    ctx.fillRect(column * ts, wallBottom, 1, canvas.height - wallBottom);
  }
  for (let row = WALL_ROWS + 1; row <= WALL_ROWS + FLOOR_ROWS; row++) {
    ctx.fillRect(0, row * ts, canvas.width, 1);
  }

  const cabinetY = wallBottom;
  const gameCtx = asGameContext(ctx);
  drawMedicineCabinetTile(gameCtx, CABINET_TILE_X * ts, cabinetY, ts, 'west');
  drawMedicineCabinetTile(gameCtx, (CABINET_TILE_X + 1) * ts, cabinetY, ts, 'east');
  drawDoctorsBag(
    gameCtx,
    (CABINET_TILE_X + BAG_TILE_X) * ts,
    cabinetY + ts + BAG_GROUND_TILES * ts,
    ts,
  );
  const figure = doctorFigure(doctorLookForRoom(DOCTOR_ROOM));
  const density = ts / figure.tileScale;
  const doctorCell = paintFigureCell(figure, 'idle', DOCTOR_FRAME, density);
  ctx.drawImage(
    doctorCell,
    (CABINET_TILE_X + 1) * ts - figure.tileX * density,
    cabinetY + ts - figure.tileY * density,
  );
  return canvas.toBuffer('image/png');
}

for (const scale of SCALES) {
  const written = writePreviewPng(`${PREVIEW_DIR}/safe-room-clinic-${scale}x.png`, renderAt(scale));
  console.log(`Wrote ${written}`);
}
