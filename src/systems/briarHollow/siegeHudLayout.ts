/**
 * Where the siege's HUD panel goes: the countdown or the wave, the bell's
 * health and the necromancer's. It must clear the top-left HUD panel, the
 * resource strip, the minimap and everything hung down the right-hand column
 * under it, and the hotbar — on any window, desktop or phone, where short
 * windows leave little room between them.
 *
 * So the place is searched for rather than fixed: the largest scale the panel
 * can be drawn at somewhere clear of all of them, and at that scale the spot
 * nearest the top of the screen's middle, where the eye looks for it. The
 * search is remembered for the layout it was made for, so it runs only when
 * the window or the chrome around it changes.
 */

import { viewportHeight, viewportWidth } from '../../core/Viewport';
import type { MiniMapSystem } from '../MiniMapSystem';
import {
  type Rect,
  type StripSlot,
  achievementChipRect,
  buildButtonRect,
  followerButtonRect,
  journalButtonRect,
  levelTimerRect,
  pauseButtonRect,
  topCentreStripSlot,
} from '../DungeonUIRenderer';
import { hotbarStripRect } from '../../ui/InventoryPanel';
import { RESOURCE_HUD_HEIGHT, RESOURCE_HUD_WIDTH } from './ResourceHud';

/** The panel at full size: its width, its padding and each row's height. */
export const SIEGE_HUD_PANEL_WIDTH = 300;
export const SIEGE_HUD_PANEL_PAD = 6;
export const SIEGE_HUD_ROW_HEIGHT = 26;
/** The most rows it ever shows: the headline, the bell, the necromancer. */
export const SIEGE_HUD_MAX_ROWS = 3;
/**
 * Rows in the compact layout, for a short window: the headline, then the
 * bell's bar and the necromancer's side by side.
 */
export const SIEGE_HUD_COMPACT_ROWS = 2;

/** Where the panel goes, how large, and whether it lays its bars side by side. */
export interface SiegeHudSlot extends StripSlot {
  readonly compact: boolean;
  /**
   * Set on a window too small for both: the panel takes the resource strip's
   * place and the strip is not drawn while the siege is on.
   */
  readonly hidesResourceStrip: boolean;
  /**
   * Set where the window has no room anywhere — a phone in landscape with the
   * minimap expanded, where the HUD panel, the minimap and the hotbar already
   * cover the screen. The panel then keeps clear of the hotbar and the
   * buttons only, over the HUD panel and the minimap the player can shrink.
   */
  readonly crowded: boolean;
}
/** Clear space kept round the panel. */
const SIEGE_HUD_GAP = 6;
/** The right-hand column hangs under the minimap at this margin from the edge. */
const RIGHT_COL_MARGIN = 8;
/** The minimap's top edge. */
const MINIMAP_TOP = 8;
/** Scales tried, largest first, in these steps, down to the smallest still readable. */
const MAX_SCALE = 1;
const MIN_SCALE = 0.5;
/** The full layout is preferred only down to this scale; smaller, the compact one reads better. */
const FULL_LAYOUT_MIN_SCALE = 0.75;
const SCALE_STEP = 0.05;
/** Positions tried on a grid this many pixels apart. */
const SEARCH_STEP_PX = 4;
/** The spot the panel is drawn nearest to: the top of the screen's middle. */
const PREFERRED_TOP_PX = 8;

/** The panel's full-size height for `rows` rows. */
export function siegeHudPanelHeight(rows: number): number {
  return SIEGE_HUD_PANEL_PAD * 2 + rows * SIEGE_HUD_ROW_HEIGHT;
}

/** Rows the panel shows at most in a layout. */
export function siegeHudRows(compact: boolean): number {
  return compact ? SIEGE_HUD_COMPACT_ROWS : SIEGE_HUD_MAX_ROWS;
}

/** The panel's rectangle at a slot, sized for the most rows it can show there. */
export function siegeHudPanelRect(slot: SiegeHudSlot): Rect {
  return {
    x: slot.x,
    y: slot.y,
    w: SIEGE_HUD_PANEL_WIDTH * slot.scale,
    h: siegeHudPanelHeight(siegeHudRows(slot.compact)) * slot.scale,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function grown(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
}

/** The buttons hung down the right-hand column, and the Follower button. */
function columnPieces(miniMap: MiniMapSystem): Rect[] {
  return [
    pauseButtonRect(miniMap),
    levelTimerRect(miniMap),
    buildButtonRect(miniMap),
    achievementChipRect(miniMap),
    journalButtonRect(miniMap),
    followerButtonRect(),
  ];
}

/** Everything on screen the panel must keep clear of; the resource strip only when asked. */
function obstacles(miniMap: MiniMapSystem, hudRect: Rect, withStrip = true): Rect[] {
  const width = viewportWidth();
  const mapSize = miniMap.isExpanded ? miniMap.EXPANDED_SIZE : miniMap.NORMAL_SIZE;
  const strip = topCentreStripSlot(miniMap, hudRect, RESOURCE_HUD_WIDTH);
  const minimap: Rect = {
    x: width - RIGHT_COL_MARGIN - mapSize,
    y: MINIMAP_TOP,
    w: mapSize,
    h: mapSize,
  };
  const stripRect: Rect = {
    x: strip.x,
    y: strip.y,
    w: RESOURCE_HUD_WIDTH * strip.scale,
    h: RESOURCE_HUD_HEIGHT * strip.scale,
  };
  return [
    hudRect,
    hotbarStripRect(),
    ...(withStrip ? [stripRect] : []),
    minimap,
    ...columnPieces(miniMap),
  ].map((rect) => grown(rect, SIEGE_HUD_GAP));
}

/**
 * The layouts tried, in order: the full panel while it can be drawn nearly
 * full size; then the compact one at any readable size; then the full one
 * smaller still.
 */
const LAYOUTS: ReadonlyArray<{ readonly compact: boolean; readonly minScale: number }> = [
  { compact: false, minScale: FULL_LAYOUT_MIN_SCALE },
  { compact: true, minScale: MIN_SCALE },
  { compact: false, minScale: MIN_SCALE },
];

/** The search itself, for one layout of the screen. */
function searchSlot(miniMap: MiniMapSystem, hudRect: Rect): SiegeHudSlot {
  for (const withStrip of [true, false]) {
    const blocked = obstacles(miniMap, hudRect, withStrip);
    for (const layout of LAYOUTS) {
      const found = searchLayout(blocked, layout.compact, layout.minScale, !withStrip, false);
      if (found !== null) return found;
    }
  }
  const buttonsOnly = [hotbarStripRect(), ...columnPieces(miniMap)].map((rect) =>
    grown(rect, SIEGE_HUD_GAP),
  );
  const crowded = searchLayout(buttonsOnly, true, MIN_SCALE, true, true);
  if (crowded !== null) return crowded;
  const width = viewportWidth();
  // Nowhere clears everything: the smallest readable compact panel, top centre.
  return {
    x: width / 2 - (SIEGE_HUD_PANEL_WIDTH * MIN_SCALE) / 2,
    y: 0,
    scale: MIN_SCALE,
    compact: true,
    hidesResourceStrip: true,
    crowded: true,
  };
}

function searchLayout(
  blocked: readonly Rect[],
  compact: boolean,
  minScale: number,
  hidesResourceStrip: boolean,
  crowded: boolean,
): SiegeHudSlot | null {
  const width = viewportWidth();
  const height = viewportHeight();
  const fullHeight = siegeHudPanelHeight(siegeHudRows(compact));
  for (let scale = MAX_SCALE; scale >= minScale - Number.EPSILON; scale -= SCALE_STEP) {
    const w = SIEGE_HUD_PANEL_WIDTH * scale;
    const h = fullHeight * scale;
    let best: SiegeHudSlot | null = null;
    let bestMiss = Infinity;
    for (let y = 0; y + h <= height; y += SEARCH_STEP_PX) {
      for (let x = 0; x + w <= width; x += SEARCH_STEP_PX) {
        const rect = { x, y, w, h };
        if (blocked.some((obstacle) => overlaps(rect, obstacle))) continue;
        const miss = Math.hypot(x + w / 2 - width / 2, y - PREFERRED_TOP_PX);
        if (miss < bestMiss) {
          best = { x, y, scale, compact, hidesResourceStrip, crowded };
          bestMiss = miss;
        }
      }
    }
    if (best !== null) return best;
  }
  return null;
}

let remembered: { key: string; slot: SiegeHudSlot } | null = null;

/** The slot the siege panel is drawn at this frame. */
export function siegeHudSlot(miniMap: MiniMapSystem, hudRect: Rect): SiegeHudSlot {
  const key = [
    viewportWidth(),
    viewportHeight(),
    miniMap.isExpanded,
    hudRect.x,
    hudRect.y,
    hudRect.w,
    hudRect.h,
    ...obstacles(miniMap, hudRect).map((rect) => `${rect.x},${rect.y},${rect.w},${rect.h}`),
  ].join('|');
  if (remembered?.key === key) return remembered.slot;
  const slot = searchSlot(miniMap, hudRect);
  remembered = { key, slot };
  return slot;
}
