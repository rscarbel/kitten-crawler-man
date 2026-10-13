/**
 * An item's icon painted from its held visual: the item laid corner to corner
 * across the square, point up and right, by the same painter that draws it in
 * hand. An item added as data alone gets a picture without one of its own.
 */

import type { Rect } from '../../../ui/core/geom';
import { paintHeldVisual, type HeldVisualTransform } from '../../held/heldPaint';
import { type HeldInkBox, measureHeldInk } from '../../held/heldVisualCache';
import type { HeldVisualId } from '../../held/heldVisualIds';
import { HELD_VISUALS } from '../../held/heldVisuals';

/** Up and to the right, the way every weapon icon lies. */
const ICON_AXIS_ANGLE = -Math.PI / 4;
/** How much of the square the item's ink spans, leaving a margin round it. */
const FILL_SHARE = 0.92;

const ICON_POSE: Omit<HeldVisualTransform, 'centre' | 'scale'> = {
  axis: { x: Math.cos(ICON_AXIS_ANGLE), y: Math.sin(ICON_AXIS_ANGLE), z: 0 },
  palmNormal: { x: 0, y: 0, z: 1 },
};

const inkById = new Map<HeldVisualId, HeldInkBox>();

function inkOf(id: HeldVisualId): HeldInkBox {
  const known = inkById.get(id);
  if (known !== undefined) return known;
  const measured = measureHeldInk(HELD_VISUALS[id], {
    ...ICON_POSE,
    centre: { x: 0, y: 0 },
    scale: 1,
  });
  inkById.set(id, measured);
  return measured;
}

/** Paints held visual `id` as an icon, its whole ink fitted inside `rect`. */
export function drawHeldVisualIcon(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  id: HeldVisualId,
): void {
  const ink = inkOf(id);
  const longest = Math.max(ink.width, ink.height);
  if (longest <= 0) return;
  const scale = (Math.min(rect.w, rect.h) * FILL_SHARE) / longest;
  const inkMidX = ink.left + ink.width / 2;
  const inkMidY = ink.top + ink.height / 2;
  paintHeldVisual(ctx, HELD_VISUALS[id], {
    ...ICON_POSE,
    centre: {
      x: rect.x + rect.w / 2 - inkMidX * scale,
      y: rect.y + rect.h / 2 - inkMidY * scale,
    },
    scale,
  });
}
