/**
 * The present that rides beside a quest giver's `?` when talking to them pays
 * a reward. Kept apart from the reward-screen icons so the world painters that
 * hang it over a head pull in nothing of the dialog chrome.
 */

import type { Rect } from '../core/geom';
import { worldPalette } from '../theme/worldInk';
import { iconSquare } from './iconSquare';

const FULL_TURN = Math.PI * 2;

const PRESENT_BODY_INSET = 0.14;
const PRESENT_BODY_TOP = 0.46;
const PRESENT_BODY_BOTTOM = 0.94;
const PRESENT_LID_INSET = 0.06;
const PRESENT_LID_TOP = 0.32;
const PRESENT_RIBBON_WIDTH = 0.16;
/** The bow's two loops: how far each sits off the centre line, and its half-size. */
const PRESENT_BOW_LOOP_OFFSET = 0.15;
const PRESENT_BOW_LOOP_HALF_WIDTH = 0.15;
const PRESENT_BOW_LOOP_HALF_HEIGHT = 0.1;
/** The bow sits on the lid, its loops tilted up and out. */
const PRESENT_BOW_CENTRE_Y = 0.22;
const PRESENT_BOW_LOOP_TILT = 0.45;
const PRESENT_BOW_KNOT_RADIUS = 0.07;
/** Thick enough at marker size (ten pixels or so) to hold the shape against any floor. */
const PRESENT_EDGE_WIDTH = 0.11;

/**
 * A wrapped present: a rose box with a lid, a gold ribbon round it and a bow
 * on top, edged dark so it reads painted into the world beside a quest
 * giver's `?` as well as on a panel.
 */
export function drawPresentRewardIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  const ink = worldPalette.questMarker;
  const centreX = x + size / 2;
  const bodyLeft = x + PRESENT_BODY_INSET * size;
  const bodyWidth = size * (1 - PRESENT_BODY_INSET * 2);
  const bodyTop = y + PRESENT_BODY_TOP * size;
  const bodyHeight = (PRESENT_BODY_BOTTOM - PRESENT_BODY_TOP) * size;
  const lidLeft = x + PRESENT_LID_INSET * size;
  const lidWidth = size * (1 - PRESENT_LID_INSET * 2);
  const lidTop = y + PRESENT_LID_TOP * size;
  const lidHeight = bodyTop - lidTop;
  const ribbonHalf = (PRESENT_RIBBON_WIDTH * size) / 2;
  const bowY = y + PRESENT_BOW_CENTRE_Y * size;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = PRESENT_EDGE_WIDTH * size;
  ctx.strokeStyle = ink.presentEdge;

  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.ellipse(
      centreX + side * PRESENT_BOW_LOOP_OFFSET * size,
      bowY,
      PRESENT_BOW_LOOP_HALF_WIDTH * size,
      PRESENT_BOW_LOOP_HALF_HEIGHT * size,
      -side * PRESENT_BOW_LOOP_TILT,
      0,
      FULL_TURN,
    );
    ctx.fillStyle = ink.presentRibbon;
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = ink.presentBox;
  ctx.fillRect(bodyLeft, bodyTop, bodyWidth, bodyHeight);
  ctx.strokeRect(bodyLeft, bodyTop, bodyWidth, bodyHeight);
  ctx.fillRect(lidLeft, lidTop, lidWidth, lidHeight);
  ctx.strokeRect(lidLeft, lidTop, lidWidth, lidHeight);

  ctx.fillStyle = ink.presentRibbon;
  ctx.fillRect(centreX - ribbonHalf, lidTop, ribbonHalf * 2, bodyTop + bodyHeight - lidTop);

  ctx.beginPath();
  ctx.arc(centreX, bowY, PRESENT_BOW_KNOT_RADIUS * size, 0, FULL_TURN);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
