/**
 * Brother Anselm's quarterstaff: a plain pale ash pole about as tall as
 * he is, shod with iron at both ends. Both ends are alike, so whichever
 * end a row puts at the floor or swings out reads as the same staff; the
 * "head" is only the last hand's length of the pole and its iron foot.
 *
 * Pale wood against his dark wool habit, so the pole shows across his body
 * at the tile, where it is a pixel and a half wide.
 */

import { rgba } from '../../art/bipedArt';
import { defineHeldVisual, type HeldHandleGeometry, type HeldLook } from '../heldVisualDef';
import { heldShade, outlineAndFill, paintSharedHandle } from '../heldPaint';

type Ctx = CanvasRenderingContext2D;

/** Weathered ash, gone pale and grey where hands have worn it. */
const ASH = '#c2a06c';
const IRON = '#4d5056';
const IRON_LIT = '#868a92';

/** Butt to the last hand's length, and that last length to the iron foot, rig units. */
const STAFF_HANDLE_LENGTH = 1.45;
const STAFF_HEAD_LENGTH = 0.15;
/**
 * The butt fist closes a hand's breadth up from the end, where a staff is
 * held to be swung or planted.
 */
const STAFF_GRIP_POINT = 0.12;
/** The iron shoe at each end stands a little proud of the wood. */
const SHOE_LENGTH = 0.05;
const SHOE_SWELL = 1.25;
/** The narrowest head the archetype accepts: the shoe's iron rim, never painted that wide. */
const STAFF_HEAD_WIDTH = 0.1;
const SHOE_LIT_ALPHA = 0.7;
const SHOE_LIT_WIDTH_SHARE = 0.35;

function paintShoe(ctx: Ctx, look: HeldLook, from: number, to: number, halfWidth: number): void {
  const half = halfWidth * SHOE_SWELL;
  const start = Math.min(from, to);
  const run = Math.abs(to - from);
  ctx.beginPath();
  ctx.roundRect(start, -half, run, half * 2, Math.min(half, run / 2));
  outlineAndFill(ctx, heldShade(IRON, look));
  const litSide = look.light.y < 0 ? -1 : 1;
  ctx.strokeStyle = rgba(heldShade(IRON_LIT, look), SHOE_LIT_ALPHA);
  ctx.lineWidth = half * SHOE_LIT_WIDTH_SHARE;
  ctx.beginPath();
  ctx.moveTo(start, litSide * half * SHOE_LIT_WIDTH_SHARE);
  ctx.lineTo(start + run, litSide * half * SHOE_LIT_WIDTH_SHARE);
  ctx.stroke();
}

function paintPole(ctx: Ctx, look: HeldLook, handle: HeldHandleGeometry): void {
  paintSharedHandle(ctx, look, handle, { colour: ASH, butt: 'plain' });
  paintShoe(ctx, look, handle.buttX, handle.buttX + SHOE_LENGTH, handle.halfWidth);
}

function paintFoot(ctx: Ctx, look: HeldLook, handle: HeldHandleGeometry): void {
  const end = handle.headBase + STAFF_HEAD_LENGTH;
  paintSharedHandle(
    ctx,
    look,
    { buttX: handle.headBase, headBase: end, halfWidth: handle.halfWidth },
    { colour: ASH, butt: 'plain' },
  );
  paintShoe(ctx, look, end - SHOE_LENGTH, end, handle.halfWidth);
}

export const ANSELM_QUARTERSTAFF = defineHeldVisual({
  id: 'anselm_quarterstaff',
  name: 'Quarterstaff',
  archetype: 'twoHandHaft',
  weight: 'heavy',
  handle: { length: STAFF_HANDLE_LENGTH, radius: 'standard' },
  head: { length: STAFF_HEAD_LENGTH, width: STAFF_HEAD_WIDTH },
  gripPoint: STAFF_GRIP_POINT,
  phases: 1,
  paintHandle: paintPole,
  paintHead: paintFoot,
});
