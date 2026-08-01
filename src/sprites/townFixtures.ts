/**
 * The town's interactive fixtures, as pictures: the bench you rest on, the
 * notice board you read, and Madame Voss at her table.
 *
 * They used to be painted inline inside `TownPropSystem`'s renderables, which
 * made the system that owns their *behaviour* also the only place their art
 * existed. They live here so the offline sheet generators can call the same
 * painters the game used to call every frame — a second copy of the drawing
 * would diverge the first time one of them was touched.
 *
 * Every measure is a fraction of the tile size `ts`, taken from the anchor
 * tile's top-left corner, with negative fractions reaching above it. The tile is
 * the fixture's foot, so the scene's Y-sort puts a player walking past in front
 * of it.
 *
 * These are game-world figures, so raw canvas calls are appropriate here — the
 * `src/ui/*` helpers are for interface chrome, not sprites.
 */

import { PARCHMENT, WOOD, WOOD_DARK } from './townPalette';

const TWO_PI = Math.PI * 2;

// Notice board: two posts carrying a framed board with a painted header and a
// few pinned scraps. Rises most of a tile above its own anchor.
const NOTICE_HEADER = '#8a5a2b';
const BOARD_POST_WIDTH_PX = 4;
const BOARD_POST_INSET_PX = 6;
const BOARD_TOP_FRACTION = -0.85;
const BOARD_BOTTOM_FRACTION = 0.35;
const BOARD_SIDE_OVERHANG_PX = 3;
const BOARD_FRAME_PX = 2;
const BOARD_HEADER_HEIGHT_PX = 6;
const NOTE_INSET_PX = 5;
const NOTE_HEIGHT_PX = 4;
const NOTE_GAP_PX = 3;
const NOTE_COUNT = 3;

/** The notice board, standing on the tile whose top-left corner is (sx, sy). */
export function drawNoticeBoard(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  const leftPostX = sx + BOARD_POST_INSET_PX;
  const rightPostX = sx + ts - BOARD_POST_INSET_PX - BOARD_POST_WIDTH_PX;
  const boardTop = sy + ts * BOARD_TOP_FRACTION;
  const postTop = boardTop + BOARD_HEADER_HEIGHT_PX;
  const postBottom = sy + ts;

  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(leftPostX, postTop, BOARD_POST_WIDTH_PX, postBottom - postTop);
  ctx.fillRect(rightPostX, postTop, BOARD_POST_WIDTH_PX, postBottom - postTop);

  const boardX = sx - BOARD_SIDE_OVERHANG_PX;
  const boardW = ts + BOARD_SIDE_OVERHANG_PX * 2;
  const boardH = ts * (BOARD_BOTTOM_FRACTION - BOARD_TOP_FRACTION);

  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(boardX, boardTop, boardW, boardH);
  ctx.fillStyle = WOOD;
  ctx.fillRect(
    boardX + BOARD_FRAME_PX,
    boardTop + BOARD_FRAME_PX,
    boardW - BOARD_FRAME_PX * 2,
    boardH - BOARD_FRAME_PX * 2,
  );

  ctx.fillStyle = NOTICE_HEADER;
  ctx.fillRect(
    boardX + BOARD_FRAME_PX,
    boardTop + BOARD_FRAME_PX,
    boardW - BOARD_FRAME_PX * 2,
    BOARD_HEADER_HEIGHT_PX,
  );

  const noteX = boardX + NOTE_INSET_PX;
  const noteW = boardW - NOTE_INSET_PX * 2;
  let noteY = boardTop + BOARD_FRAME_PX + BOARD_HEADER_HEIGHT_PX + NOTE_GAP_PX;
  ctx.fillStyle = PARCHMENT;
  for (let note = 0; note < NOTE_COUNT; note++) {
    ctx.fillRect(noteX, noteY, noteW, NOTE_HEIGHT_PX);
    noteY += NOTE_HEIGHT_PX + NOTE_GAP_PX;
  }
}

// Bench: a low wooden seat with a backrest, sitting wholly within its own tile.
const BENCH_SIDE_INSET_PX = 2;
const BENCH_SEAT_FRACTION = 0.55;
const BENCH_SEAT_THICKNESS_PX = 4;
const BENCH_LEG_WIDTH_PX = 3;
const BENCH_LEG_HEIGHT_PX = 6;
const BENCH_BACK_FRACTION = 0.28;
const BENCH_BACK_THICKNESS_PX = 3;

/** A bench, standing on the tile whose top-left corner is (sx, sy). */
export function drawBench(ctx: CanvasRenderingContext2D, sx: number, sy: number, ts: number): void {
  const left = sx + BENCH_SIDE_INSET_PX;
  const width = ts - BENCH_SIDE_INSET_PX * 2;
  const seatY = sy + ts * BENCH_SEAT_FRACTION;
  const backY = sy + ts * BENCH_BACK_FRACTION;

  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(left, backY, BENCH_BACK_THICKNESS_PX, seatY - backY);
  ctx.fillRect(
    left + width - BENCH_BACK_THICKNESS_PX,
    backY,
    BENCH_BACK_THICKNESS_PX,
    seatY - backY,
  );
  ctx.fillRect(left, backY, width, BENCH_BACK_THICKNESS_PX);

  ctx.fillStyle = WOOD;
  ctx.fillRect(left, seatY, width, BENCH_SEAT_THICKNESS_PX);

  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(
    left + BENCH_SIDE_INSET_PX,
    seatY + BENCH_SEAT_THICKNESS_PX,
    BENCH_LEG_WIDTH_PX,
    BENCH_LEG_HEIGHT_PX,
  );
  ctx.fillRect(
    left + width - BENCH_SIDE_INSET_PX - BENCH_LEG_WIDTH_PX,
    seatY + BENCH_SEAT_THICKNESS_PX,
    BENCH_LEG_WIDTH_PX,
    BENCH_LEG_HEIGHT_PX,
  );
}

// Madame Voss: a hooded seer seated behind a small table, hands framing a
// glowing crystal orb. Every measure is a fraction of tile size so she reads as
// a person, not a robe-blob. She has no animation — the glows are `shadowBlur`
// on fixed geometry — so she is one picture, baked once.
const SEER_BASE_FRACTION = 0.96; // seat/base line
const SEER_SHOULDER_FRACTION = 0.44; // shoulder line
const SEER_TABLE_TOP_FRACTION = 0.66;
const SEER_TABLE_HEIGHT_FRACTION = 0.13;
const SEER_TABLE_INSET_FRACTION = 0.05;
const SEER_SHOULDER_HALF = 0.28; // half shoulder width
const SEER_HEM_HALF = 0.42; // half robe hem width at the seat
const SEER_ROBE_SEAM_WIDTH = 0.02;
const SEER_HEAD_CY_FRACTION = 0.27;
const SEER_HOOD_R = 0.19;
const SEER_HOOD_LIFT = 0.03; // hood peak above the face center
const SEER_FACE_RX = 0.085;
const SEER_FACE_RY = 0.11;
const SEER_FACE_DROP = 0.02; // face sits below the hood center so the cowl frames it
const SEER_BROW_SHADOW_RY = 0.045;
const SEER_EYE_DX = 0.038;
const SEER_EYE_CY_FRACTION = 0.28;
const SEER_EYE_R = 0.018;
const SEER_ARM_WIDTH = 0.085;
const SEER_HAND_DX = 0.17;
const SEER_HAND_R = 0.045;
const SEER_ORB_RADIUS_FRACTION = 0.09;
const SEER_ORB_LIFT_FRACTION = 0.05;
const SEER_COWL_SIDE_FRACTION = 0.9; // where the cowl meets the head, as a fraction of hood radius
const SEER_COWL_SHOULDER_DROP = 0.02; // how far the cowl laps over the shoulders
const SEER_BROW_SHADOW_RISE = 0.5; // brow shadow center above the face center, as a fraction of face RY
const SEER_EYE_GLOW_BLUR = 0.08;
const SEER_HAND_REST_LIFT = 0.01; // hands sit just above the table surface
const SEER_ARM_ROOT_SPREAD = 0.7; // arm root spacing as a fraction of shoulder half-width
const SEER_ARM_ROOT_DROP = 0.03; // arm root below the shoulder line
const SEER_ARM_ELBOW_DX = 0.24; // elbow bow-out from center
const SEER_ARM_ELBOW_LIFT = 0.04; // elbow above the table surface
const SEER_ORB_GLOW_BLUR_FACTOR = 2; // the orb's halo, as a multiple of its radius

const SEER_ROBE = '#3b2f5e';
const SEER_ROBE_SEAM = '#2c2247';
const SEER_HOOD = '#241b38';
const SEER_FACE = '#c9a781';
const SEER_BROW_SHADOW = '#5a3f4a';
const SEER_EYE = '#fff2c4';
const SEER_EYE_GLOW = '#a855f7';
const SEER_ORB = '#c9b8f0';
const SEER_ORB_GLOW = '#a855f7';

/** The fortune teller, seated on the tile whose top-left corner is (sx, sy). */
export function drawFortuneTeller(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  // She sets `lineWidth` and `lineCap` for her arms and never puts them back, so
  // the restore is hers to make: whoever draws next inherits whatever she left.
  ctx.save();
  const cx = sx + ts / 2;
  const baseY = sy + ts * SEER_BASE_FRACTION;
  const shoulderY = sy + ts * SEER_SHOULDER_FRACTION;
  const tableTop = sy + ts * SEER_TABLE_TOP_FRACTION;
  const headCY = sy + ts * SEER_HEAD_CY_FRACTION;

  // Cowl draping from the head down to the shoulders — sits behind the body.
  ctx.fillStyle = SEER_HOOD;
  ctx.beginPath();
  ctx.moveTo(cx - ts * SEER_HOOD_R * SEER_COWL_SIDE_FRACTION, headCY);
  ctx.lineTo(cx - ts * SEER_SHOULDER_HALF, shoulderY + ts * SEER_COWL_SHOULDER_DROP);
  ctx.lineTo(cx + ts * SEER_SHOULDER_HALF, shoulderY + ts * SEER_COWL_SHOULDER_DROP);
  ctx.lineTo(cx + ts * SEER_HOOD_R * SEER_COWL_SIDE_FRACTION, headCY);
  ctx.closePath();
  ctx.fill();

  // Robe body: a trapezoid from the shoulders to a wide hem at the seat.
  ctx.fillStyle = SEER_ROBE;
  ctx.beginPath();
  ctx.moveTo(cx - ts * SEER_SHOULDER_HALF, shoulderY);
  ctx.lineTo(cx + ts * SEER_SHOULDER_HALF, shoulderY);
  ctx.lineTo(cx + ts * SEER_HEM_HALF, baseY);
  ctx.lineTo(cx - ts * SEER_HEM_HALF, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = SEER_ROBE_SEAM;
  ctx.lineWidth = Math.max(1, ts * SEER_ROBE_SEAM_WIDTH);
  ctx.beginPath();
  ctx.moveTo(cx, shoulderY);
  ctx.lineTo(cx, baseY);
  ctx.stroke();

  // Head: hood cowl behind, skin face inset, a shaded brow, and glowing eyes.
  ctx.fillStyle = SEER_HOOD;
  ctx.beginPath();
  ctx.arc(cx, headCY - ts * SEER_HOOD_LIFT, ts * SEER_HOOD_R, 0, TWO_PI);
  ctx.fill();

  const faceCY = headCY + ts * SEER_FACE_DROP;
  ctx.fillStyle = SEER_FACE;
  ctx.beginPath();
  ctx.ellipse(cx, faceCY, ts * SEER_FACE_RX, ts * SEER_FACE_RY, 0, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = SEER_BROW_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    faceCY - ts * SEER_FACE_RY * SEER_BROW_SHADOW_RISE,
    ts * SEER_FACE_RX,
    ts * SEER_BROW_SHADOW_RY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.save();
  ctx.shadowColor = SEER_EYE_GLOW;
  ctx.shadowBlur = ts * SEER_EYE_GLOW_BLUR;
  ctx.fillStyle = SEER_EYE;
  const eyeY = sy + ts * SEER_EYE_CY_FRACTION;
  ctx.beginPath();
  ctx.arc(cx - ts * SEER_EYE_DX, eyeY, ts * SEER_EYE_R, 0, TWO_PI);
  ctx.arc(cx + ts * SEER_EYE_DX, eyeY, ts * SEER_EYE_R, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  // Table in front of her lower body.
  const inset = ts * SEER_TABLE_INSET_FRACTION;
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(sx + inset, tableTop, ts - inset * 2, ts * SEER_TABLE_HEIGHT_FRACTION);

  // Sleeved arms resting on the table, hands framing the orb.
  const handY = tableTop - ts * SEER_HAND_REST_LIFT;
  ctx.strokeStyle = SEER_ROBE;
  ctx.lineWidth = ts * SEER_ARM_WIDTH;
  ctx.lineCap = 'round';
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(
      cx + dir * ts * SEER_SHOULDER_HALF * SEER_ARM_ROOT_SPREAD,
      shoulderY + ts * SEER_ARM_ROOT_DROP,
    );
    ctx.quadraticCurveTo(
      cx + dir * ts * SEER_ARM_ELBOW_DX,
      tableTop - ts * SEER_ARM_ELBOW_LIFT,
      cx + dir * ts * SEER_HAND_DX,
      handY,
    );
    ctx.stroke();
  }
  ctx.fillStyle = SEER_FACE;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + dir * ts * SEER_HAND_DX, handY, ts * SEER_HAND_R, 0, TWO_PI);
    ctx.fill();
  }

  // Crystal orb between her hands.
  ctx.save();
  ctx.shadowColor = SEER_ORB_GLOW;
  ctx.shadowBlur = ts * SEER_ORB_RADIUS_FRACTION * SEER_ORB_GLOW_BLUR_FACTOR;
  ctx.fillStyle = SEER_ORB;
  ctx.beginPath();
  ctx.arc(cx, tableTop - ts * SEER_ORB_LIFT_FRACTION, ts * SEER_ORB_RADIUS_FRACTION, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}
