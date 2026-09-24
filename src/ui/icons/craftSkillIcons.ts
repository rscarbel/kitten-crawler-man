/**
 * Icons for the two craft skills, used by the level-up dialog and the pause
 * menu's Crafts tab.
 *
 * Resourcing reuses the basic axe from {@link drawToolIcon} — the tool a
 * crawler actually swings to earn the skill. Construction has no matching
 * item icon, so it gets a small hammer-and-nail painter of its own.
 */

import { drawToolIcon } from './toolIcons';
import type { CraftSkillId } from '../../core/CraftSkills';

const OUTLINE = '#1c1712';
const OUTLINE_WIDTH = 1;
const HANDLE_COLOR = '#8a5a2e';
const HEAD_COLOR = '#94a3b8';
const HEAD_EDGE_COLOR = '#e2e8f0';
const NAIL_COLOR = '#cbd5e1';

/** Hammer geometry, in local space with the origin at the head's mounting point. */
const HANDLE_LENGTH_FRACTION = 0.62;
const HANDLE_WIDTH_FRACTION = 0.09;
const HAMMER_LEAN = -0.5;
const ORIGIN_X_FRACTION = 0.36;
const ORIGIN_Y_FRACTION = 0.82;

const HEAD_WIDTH_FRACTION = 0.46;
const HEAD_HEIGHT_FRACTION = 0.2;
const HEAD_CLAW_FRACTION = 0.14;
/** Where the head's back edge sits, as a fraction of its own width behind the handle's end. */
const HEAD_BACK_INSET_FRACTION = 0.2;
/** Where the head's front (striking) face sits, as a fraction of its own width past the handle's end. */
const HEAD_FRONT_FRACTION = 0.5;
/** How far the claw notch's inner corners sit from the head's vertical center, as a fraction of head height. */
const HEAD_CLAW_NOTCH_FRACTION = 0.15;

const NAIL_LENGTH_FRACTION = 0.16;
const NAIL_X_OFFSET_FRACTION = 0.24;
const NAIL_Y_OFFSET_FRACTION = 0.06;

function drawConstructionIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();

  ctx.translate(x + size * ORIGIN_X_FRACTION, y + size * ORIGIN_Y_FRACTION);
  ctx.rotate(HAMMER_LEAN);

  const handleLength = size * HANDLE_LENGTH_FRACTION;
  const handleWidth = size * HANDLE_WIDTH_FRACTION;

  ctx.fillStyle = HANDLE_COLOR;
  ctx.beginPath();
  ctx.rect(0, -handleWidth / 2, handleLength, handleWidth);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();

  const headWidth = size * HEAD_WIDTH_FRACTION;
  const headHeight = size * HEAD_HEIGHT_FRACTION;
  const clawDepth = size * HEAD_CLAW_FRACTION;

  const headBack = handleLength - headWidth * HEAD_BACK_INSET_FRACTION;
  const headFront = handleLength + headWidth * HEAD_FRONT_FRACTION;
  const clawNotch = headHeight * HEAD_CLAW_NOTCH_FRACTION;

  ctx.fillStyle = HEAD_COLOR;
  ctx.beginPath();
  ctx.moveTo(headBack, -headHeight / 2);
  ctx.lineTo(headFront, -headHeight / 2);
  ctx.lineTo(headFront, headHeight / 2);
  ctx.lineTo(headBack, headHeight / 2);
  ctx.lineTo(headBack - clawDepth, clawNotch);
  ctx.lineTo(headBack - clawDepth, -clawNotch);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  ctx.strokeStyle = HEAD_EDGE_COLOR;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(headFront, -headHeight / 2);
  ctx.lineTo(headFront, headHeight / 2);
  ctx.stroke();

  const nailLength = size * NAIL_LENGTH_FRACTION;
  ctx.strokeStyle = NAIL_COLOR;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(handleLength * NAIL_X_OFFSET_FRACTION, headHeight / 2 + size * NAIL_Y_OFFSET_FRACTION);
  ctx.lineTo(
    handleLength * NAIL_X_OFFSET_FRACTION,
    headHeight / 2 + size * NAIL_Y_OFFSET_FRACTION + nailLength,
  );
  ctx.stroke();

  ctx.restore();
}

/** Draws the icon for one craft skill into a square icon region at `x`,`y`. */
export function drawCraftSkillIcon(
  ctx: CanvasRenderingContext2D,
  id: CraftSkillId,
  x: number,
  y: number,
  size: number,
): void {
  if (id === 'resourcing') {
    drawToolIcon(ctx, 'basic_axe', x, y, size);
    return;
  }
  drawConstructionIcon(ctx, x, y, size);
}
