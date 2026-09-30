/**
 * A one-line quest counter — "4/10 fence sections", "36/100 grain" — hung
 * under the resource strip, for a step whose progress is a count the player
 * works through with the strip's own resources.
 *
 * It sits centred under wherever the strip's slot is, at the strip's scale,
 * whether or not the strip is showing, so it never jumps as the strip fades.
 * Where that spot lands on the phone HUD's buttons, the minimap, the HUD
 * panel or the hotbar, it moves to the clear spot nearest it instead.
 */

import { viewportHeight, viewportWidth } from '../../core/Viewport';
import { BOX_PRESETS, drawBox } from '../../ui/Box';
import { drawText, TEXT_PRESETS } from '../../ui/TextBox';
import { bestSpot, type PackRect } from '../../ui/hudPacking';
import { hotbarStripRect } from '../../ui/InventoryPanel';
import type { MiniMapSystem } from '../MiniMapSystem';
import { phoneHudButtonRects, topCentreStripSlot, type Rect } from '../DungeonUIRenderer';
import { RESOURCE_HUD_HEIGHT, RESOURCE_HUD_WIDTH } from './ResourceHud';

/** The counter's size at full scale. */
export const QUEST_COUNTER_WIDTH = 150;
export const QUEST_COUNTER_HEIGHT = 22;
/** Space between the strip's bottom edge and the counter. */
const GAP_UNDER_STRIP_PX = 4;
/** Clear space kept between the counter and anything it moves out of the way of. */
const OBSTACLE_GAP_PX = 6;
const SCREEN_MARGIN_PX = 8;
const TEXT_TOP_PX = 5;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function grown(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
}

/** Where the counter is drawn this frame, and at what scale. */
export function questCounterRect(miniMap: MiniMapSystem, hudRect: Rect): Rect {
  const strip = topCentreStripSlot(miniMap, hudRect, RESOURCE_HUD_WIDTH, RESOURCE_HUD_HEIGHT);
  const width = QUEST_COUNTER_WIDTH * strip.scale;
  const height = QUEST_COUNTER_HEIGHT * strip.scale;
  const stripRect: Rect = {
    x: strip.x,
    y: strip.y,
    w: RESOURCE_HUD_WIDTH * strip.scale,
    h: RESOURCE_HUD_HEIGHT * strip.scale,
  };
  const underStrip: Rect = {
    x: stripRect.x + stripRect.w / 2 - width / 2,
    y: stripRect.y + stripRect.h + GAP_UNDER_STRIP_PX,
    w: width,
    h: height,
  };
  const obstacles: PackRect[] = [
    ...phoneHudButtonRects(miniMap),
    miniMap.screenRect,
    hudRect,
    hotbarStripRect(),
    stripRect,
  ];
  const clear = obstacles.every(
    (obstacle) => !overlaps(underStrip, grown(obstacle, OBSTACLE_GAP_PX)),
  );
  if (clear) return underStrip;
  const spot = bestSpot({ w: width, h: height }, obstacles, {
    bounds: {
      x: SCREEN_MARGIN_PX,
      y: SCREEN_MARGIN_PX,
      w: viewportWidth() - SCREEN_MARGIN_PX * 2,
      h: viewportHeight() - SCREEN_MARGIN_PX * 2,
    },
    blocked: [],
    avoid: [],
    gap: OBSTACLE_GAP_PX,
    cost: (rect) => Math.hypot(rect.x - underStrip.x, rect.y - underStrip.y),
    seedXs: [underStrip.x],
    seedYs: [underStrip.y],
  });
  return spot ?? underStrip;
}

/** Draws `text` in the quest counter's box. */
export function drawQuestCounter(
  ctx: CanvasRenderingContext2D,
  miniMap: MiniMapSystem,
  hudRect: Rect,
  text: string,
): void {
  const rect = questCounterRect(miniMap, hudRect);
  const scale = rect.w / QUEST_COUNTER_WIDTH;
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.scale(scale, scale);
  drawBox(ctx, {
    x: 0,
    y: 0,
    width: QUEST_COUNTER_WIDTH,
    height: QUEST_COUNTER_HEIGHT,
    ...BOX_PRESETS.hudTranslucent,
  });
  drawText(ctx, text, {
    x: QUEST_COUNTER_WIDTH / 2,
    y: TEXT_TOP_PX,
    align: 'center',
    ...TEXT_PRESETS.value,
    outline: true,
  });
  ctx.restore();
}
