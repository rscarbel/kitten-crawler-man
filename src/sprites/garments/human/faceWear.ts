/**
 * What the human's face pieces share: the strap that holds goggles or a mask
 * on, wrapped round his head where the face piece itself does not show.
 */

import type { BipedHeadFrame } from '../../art/biped/bipedParts';
import { traceSkull } from '../../art/biped/head';
import { HEAD_DEPTH, HEAD_RX } from '../../art/biped/proportions';
import { withClip } from '../../art/softShade';

type Ctx = CanvasRenderingContext2D;

/** How far past the skull's silhouette a strap is drawn before the skull clips it: it wraps round, never ends short. */
const STRAP_OVERREACH = 1.2;

export interface StrapLook {
  readonly colour: string;
  readonly width: number;
  /** Head-local height the strap runs round the head at. */
  readonly y: number;
  /** Edge-on, where the strap leaves the face piece toward the back of his head. */
  readonly profileFromX: number;
}

/**
 * The strap from behind (across the back of the head) or edge-on (from the
 * face piece back over the ear), clipped to the skull so it wraps the head
 * rather than standing off it. Head-on the face piece paints its own ends.
 */
export function paintHeadStrap(ctx: Ctx, frame: BipedHeadFrame, strap: StrapLook): void {
  const view = frame.view;
  if (!view.profile && !view.showsBack) return;
  const fromX = view.profile ? strap.profileFromX : -HEAD_RX * STRAP_OVERREACH;
  const toX = view.profile ? -HEAD_DEPTH * STRAP_OVERREACH : HEAD_RX * STRAP_OVERREACH;
  withClip(
    ctx,
    () => traceSkull(ctx, view),
    () => {
      ctx.beginPath();
      ctx.moveTo(fromX, strap.y);
      ctx.lineTo(toX, strap.y);
      ctx.strokeStyle = strap.colour;
      ctx.lineWidth = strap.width;
      ctx.lineCap = 'butt';
      ctx.stroke();
    },
  );
}
