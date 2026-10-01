/**
 * Where every HUD button goes, for every scene that has them: the dungeon and
 * the overworld outside, and every building inside.
 *
 * One function for both, so that given the same screen and the same buttons
 * it answers with the same rects — walking through a door moves nothing. Pure
 * in its inputs, so a layout check can ask about a phone from a desktop
 * process, and the interior camera can frame a room clear of buttons it has
 * not drawn yet.
 *
 * The order down the right-hand column is fixed: Pause, Bag, Build, the
 * achievement chip, the Journal, then whatever a scene adds of its own. A
 * phone puts the level timer and the Follower button ahead of Pause, all of it
 * packed into whatever room the screen leaves (see `hudPacking.ts`); a desktop
 * stands the Follower button at the bottom right.
 */

import { bottomRowButtonRects, stackedAboveRect } from '../../systems/MobileHUDSystem';
import { SUMMON_BUTTON_HEIGHT, SUMMON_BUTTON_WIDTH } from '../../systems/MongoSystem';
import {
  insetRect,
  packStack,
  type PackOptions,
  type PackRect,
  type PackSize,
} from '../hudPacking';
import { hotbarStripRectFor } from '../InventoryPanel';
import { HUD_MINIMAP_MARGIN } from './hudMiniMap';

type Rect = PackRect;

/** Clear space between the right-hand column and the screen's edges. */
export const HUD_RIGHT_COLUMN_MARGIN = 8;
/** Clear space between the minimap and the first button hung under it. */
export const BELOW_MINIMAP_GAP = 20;
/** Clear space kept between HUD buttons, and the step between a column's slots. */
export const HUD_BUTTON_GAP = 6;
const DESKTOP_BUTTON_W = 104;
const MOBILE_BUTTON_W = 80;
const SMALL_BUTTON_H = 28;
/** The Follower button and a phone's other large buttons. */
const LARGE_BUTTON_H = 52;
/** The level timer's box at its base size. */
export const LEVEL_TIMER_W = 96;
export const LEVEL_TIMER_H = 42;
/**
 * The largest the desktop level timer ever grows to — its five-minute tier —
 * which is the footprint the layout reserves for it.
 */
export const LEVEL_TIMER_MAX_SCALE = 2;
const TIMER_PAUSE_GAP = 8;
const CHIP_HEIGHT = 26;
/** The Journal button is a square, big enough that the compass rose reads at a glance. */
const JOURNAL_BUTTON_SIZE = 36;
const JOURNAL_GAP_ABOVE = 8;
/** The hotbar band the bottom-row buttons (Switch, Summon, a desktop Follower) stand above. */
const BOTTOM_ROW_HOTBAR_BAND_H = 52;
/** Left edge of the desktop Summon button, bottom left. */
const DESKTOP_SUMMON_LEFT = 10;
/** Desktop Follower button: its clearance from the right edge, and from the hotbar band below it. */
const DESKTOP_FOLLOWER_RIGHT_MARGIN = 10;
const DESKTOP_FOLLOWER_BOTTOM_MARGIN = 12;
const DESKTOP_FOLLOWER_BOTTOM_OFFSET = 8;
/** The Bag button's slot, directly under Pause. */
const BAG_SLOTS_BELOW_PAUSE = 1;
/** Where the Build button would stand on a desktop that has not reserved its slot. */
const BUILD_SLOTS_BELOW_PAUSE = 2;
/**
 * The height the minimap's caption takes under it. With the packer's gap
 * round it, the first piece under the minimap starts `BELOW_MINIMAP_GAP` below.
 */
const MINIMAP_CAPTION_H = BELOW_MINIMAP_GAP - HUD_BUTTON_GAP;
/**
 * What a pixel of sideways drift from the column under the minimap costs, in
 * pixels of drop down it. Large enough that a portrait phone keeps the whole
 * cluster in one column; a landscape one moves pieces beside the minimap or
 * across only once the column runs into the hotbar.
 */
const COLUMN_SHIFT_COST = 4;
const OFFSCREEN_X = -9999;
/** A slot that is not on screen, for a phone piece this scene does not show. */
export const OFFSCREEN_SLOT: Rect = { x: OFFSCREEN_X, y: 0, w: 0, h: 0 };

export interface HudButtonLayoutInput {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  /** The phone layout, packed into whatever room the screen has. */
  readonly mobile: boolean;
  /** The minimap's square, caption not included (`hudMiniMapRect`). */
  readonly miniMap: Rect;
  /** The party HUD panel, kept clear of while there is room elsewhere; null before it is first drawn. */
  readonly hudPanel: Rect | null;
  /** What on the HUD panel no button may ever cover: its collapse toggle and HP bars (`hudKeepouts`). */
  readonly hudKeepouts: readonly Rect[];
  /** Whether the floor's collapse timer is on screen. */
  readonly timer: boolean;
  /** Whether the Build button's slot is held. */
  readonly build: boolean;
  /** The unopened-loot-box banner, while it shows; only the pieces after Bag keep clear of it. */
  readonly lootBoxBanner: Rect | null;
  /**
   * A scene's own buttons, placed after every shared one so that a scene
   * without them lays the shared ones out exactly the same.
   */
  readonly extras: readonly PackSize[];
}

export interface HudButtonRects {
  readonly pause: Rect;
  readonly bag: Rect;
  /**
   * Always held, shown or not, so hiding the button never moves the buttons
   * around it.
   */
  readonly follower: Rect;
  /**
   * The level timer's footprint: on a desktop, at its largest tier, wherever
   * it shows or not; on a phone, the box it draws, or `OFFSCREEN_SLOT`.
   */
  readonly timer: Rect;
  /**
   * The Build button. A desktop without the slot reserved reports where it
   * would stand; a phone reports `OFFSCREEN_SLOT`.
   */
  readonly build: Rect;
  /**
   * The achievement chip's slot, held whether or not anything is unread, so
   * nothing else moves when an achievement is earned.
   */
  readonly chip: Rect;
  readonly journal: Rect;
  /** One rect per `extras` entry, in the same order. */
  readonly extras: readonly Rect[];
}

let memo: { readonly key: string; readonly rects: HudButtonRects } | null = null;

/** Every HUD button's rect for `input`. */
export function hudButtonLayout(input: HudButtonLayoutInput): HudButtonRects {
  const key = JSON.stringify(input);
  if (memo !== null && memo.key === key) return memo.rects;
  const rects = input.mobile ? phoneLayout(input) : desktopLayout(input);
  memo = { key, rects };
  return rects;
}

/** A phone's Switch button, bottom left above the hotbar. */
export function phoneSwitchButtonRect(viewportWidth: number, viewportHeight: number): Rect {
  return bottomRowButtonRects(viewportWidth, viewportHeight, BOTTOM_ROW_HOTBAR_BAND_H, 0)
    .switchButton;
}

/** A phone's Summon button, stacked on Switch. */
export function phoneSummonButtonRect(viewportWidth: number, viewportHeight: number): Rect {
  return stackedAboveRect(phoneSwitchButtonRect(viewportWidth, viewportHeight));
}

/** A desktop's Follower button: bottom right, clear of the hotbar. */
export function desktopFollowerButtonRect(viewportWidth: number, viewportHeight: number): Rect {
  return {
    x: viewportWidth - DESKTOP_FOLLOWER_RIGHT_MARGIN - MOBILE_BUTTON_W,
    y: desktopBottomRowTop(viewportHeight),
    w: MOBILE_BUTTON_W,
    h: LARGE_BUTTON_H,
  };
}

/**
 * A desktop's Summon button: bottom left, its top level with the Follower
 * button's across the screen.
 */
export function desktopSummonButtonRect(viewportHeight: number): Rect {
  return {
    x: DESKTOP_SUMMON_LEFT,
    y: desktopBottomRowTop(viewportHeight),
    w: SUMMON_BUTTON_WIDTH,
    h: SUMMON_BUTTON_HEIGHT,
  };
}

/** Top of a desktop's bottom-row buttons, the Follower and Summon. */
function desktopBottomRowTop(viewportHeight: number): number {
  return (
    viewportHeight -
    BOTTOM_ROW_HOTBAR_BAND_H -
    DESKTOP_FOLLOWER_BOTTOM_MARGIN -
    LARGE_BUTTON_H -
    DESKTOP_FOLLOWER_BOTTOM_OFFSET
  );
}

/** The minimap and the caption drawn under it. */
export function miniMapWithCaption(miniMap: Rect): Rect {
  return { x: miniMap.x, y: miniMap.y, w: miniMap.w, h: miniMap.h + MINIMAP_CAPTION_H };
}

/**
 * A phone's cluster, placed into whatever room the screen has.
 *
 * Under the minimap in one column, as long as the column fits; on a short
 * screen — a phone in landscape — a piece that no longer fits moves into the
 * next column to the left, or up beside the minimap, wherever
 * {@link COLUMN_SHIFT_COST} finds the nearest clear room. Pause and Bag go as
 * a pair where they can. Every piece keeps clear of the minimap and its
 * caption, the hotbar, the Switch and Summon buttons, the HUD panel's
 * collapse toggle and HP bars and, while there is room elsewhere, the rest of
 * the HUD panel.
 *
 * Only what stays put for a whole floor moves the cluster: the timer, the
 * Summon slot and the Follower button are held whether or not they show this
 * frame, so a button never jumps from under the player's finger. The loot-box
 * banner moves only the pieces after Pause and Bag.
 */
function phoneLayout(input: HudButtonLayoutInput): HudButtonRects {
  const { viewportWidth: width, viewportHeight: height, miniMap } = input;
  const anchorRight = width - HUD_RIGHT_COLUMN_MARGIN;
  const anchorTop = miniMap.y + miniMap.h + BELOW_MINIMAP_GAP;
  const blocked: Rect[] = [
    miniMapWithCaption(miniMap),
    insetRect(hotbarStripRectFor(width, height), HUD_BUTTON_GAP),
    phoneSwitchButtonRect(width, height),
    phoneSummonButtonRect(width, height),
    ...input.hudKeepouts,
  ];
  const options: PackOptions = {
    bounds: {
      x: HUD_RIGHT_COLUMN_MARGIN,
      y: HUD_MINIMAP_MARGIN,
      w: width - HUD_RIGHT_COLUMN_MARGIN * 2,
      h: height - HUD_MINIMAP_MARGIN - HUD_RIGHT_COLUMN_MARGIN,
    },
    blocked,
    avoid: input.hudPanel === null ? [] : [input.hudPanel],
    gap: HUD_BUTTON_GAP,
    cost: (rect) => (anchorRight - (rect.x + rect.w)) * COLUMN_SHIFT_COST + rect.y,
    seedXs: [],
    seedYs: [anchorTop],
  };
  const placed: Rect[] = [];
  const place = (stack: readonly PackSize[]): Rect[] => {
    const rects = packStack(stack, placed, options);
    placed.push(...rects);
    return rects;
  };
  const one = (size: PackSize): Rect => place([size])[0] ?? OFFSCREEN_SLOT;

  const timer = input.timer ? one({ w: LEVEL_TIMER_W, h: LEVEL_TIMER_H }) : OFFSCREEN_SLOT;
  const follower = one({ w: MOBILE_BUTTON_W, h: LARGE_BUTTON_H });
  const smallButton: PackSize = { w: MOBILE_BUTTON_W, h: SMALL_BUTTON_H };
  const [pause = OFFSCREEN_SLOT, bag = OFFSCREEN_SLOT] = place([smallButton, smallButton]);
  if (input.lootBoxBanner !== null) blocked.push(input.lootBoxBanner);
  const build = input.build ? one(smallButton) : OFFSCREEN_SLOT;
  const chip = one({ w: MOBILE_BUTTON_W, h: CHIP_HEIGHT });
  const journal = one({ w: JOURNAL_BUTTON_SIZE, h: JOURNAL_BUTTON_SIZE });
  const extras = input.extras.map(one);
  return { timer, follower, pause, bag, build, chip, journal, extras };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The desktop's right-hand column: Pause under the minimap, Bag under it,
 * then the Build button (where it is reserved), the achievement chip's slot,
 * the Journal and a scene's extras.
 *
 * Each takes the next slot down the column while that slot is clear of the
 * rest of the HUD — the hotbar strip, Pause, the Bag row, the minimap, the
 * Follower button, the level timer, the loot-box banner and the HUD panel —
 * and of the bottom of the screen. Once one piece has had to leave the column,
 * the pieces after it leave too. A piece that leaves goes to the first slot
 * that is clear, searching column by column to the left as far as the
 * screen's edge, each from the Bag's row down and then upward:
 *
 * 1. first a slot clear of everything, the HUD panel included;
 * 2. failing that, a slot clear of everything but the HUD panel;
 * 3. failing both, beside the Bag, whatever it overlaps — only on a screen too
 *    small for any of the above.
 */
function desktopLayout(input: HudButtonLayoutInput): HudButtonRects {
  const { viewportWidth: viewportW, viewportHeight: viewportH, miniMap } = input;
  const width = DESKTOP_BUTTON_W;
  const pause: Rect = {
    x: viewportW - HUD_RIGHT_COLUMN_MARGIN - width,
    y: miniMap.y + miniMap.h + BELOW_MINIMAP_GAP,
    w: width,
    h: SMALL_BUTTON_H,
  };
  const timerW = LEVEL_TIMER_W * LEVEL_TIMER_MAX_SCALE;
  const timerH = LEVEL_TIMER_H * LEVEL_TIMER_MAX_SCALE;
  const timer: Rect = { x: pause.x - TIMER_PAUSE_GAP - timerW, y: pause.y, w: timerW, h: timerH };
  const follower = desktopFollowerButtonRect(viewportW, viewportH);
  const slotStep = SMALL_BUTTON_H + HUD_BUTTON_GAP;
  const bagRow = pause.y + BAG_SLOTS_BELOW_PAUSE * slotStep;
  const bag: Rect = { x: pause.x, y: bagRow, w: width, h: SMALL_BUTTON_H };
  const screenFloor = viewportH - HUD_RIGHT_COLUMN_MARGIN;
  const occupied: Rect[] = [hotbarStripRectFor(viewportW, viewportH), pause, miniMap, follower];
  if (input.timer) occupied.push(timer);
  if (input.lootBoxBanner !== null) occupied.push(input.lootBoxBanner);
  occupied.push(bag);
  const panel = input.hudPanel;
  const isClear = (rect: Rect, avoidHudPanel: boolean): boolean =>
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.y + rect.h <= screenFloor &&
    occupied.every((other) => !rectsOverlap(rect, other)) &&
    !(avoidHudPanel && panel !== null && rectsOverlap(rect, panel));

  let nextColumnSlot = BAG_SLOTS_BELOW_PAUSE + 1;
  let columnOpen = true;
  let columnBottom = bagRow + SMALL_BUTTON_H;
  const take = (rect: Rect): Rect => {
    occupied.push(rect);
    return rect;
  };
  const overflowRows: number[] = [];
  for (let y = bagRow; y <= screenFloor; y += slotStep) overflowRows.push(y);
  for (let y = bagRow - slotStep; y >= HUD_MINIMAP_MARGIN; y -= slotStep) overflowRows.push(y);
  const overflow = (w: number, h: number): Rect => {
    // Clear of the HUD panel if the screen allows it; on the very smallest a
    // corner of the panel is the only room left that is not another button.
    for (const avoidHudPanel of [true, false]) {
      const columnStep = width + HUD_BUTTON_GAP;
      for (let right = pause.x - HUD_BUTTON_GAP; right >= w; right -= columnStep) {
        for (const y of overflowRows) {
          const rect = { x: right - w, y, w, h };
          if (isClear(rect, avoidHudPanel)) return take(rect);
        }
      }
    }
    return take({ x: pause.x - HUD_BUTTON_GAP - w, y: bagRow, w, h });
  };
  const place = (h: number, w: number = width, gapAbove = 0): Rect => {
    if (columnOpen) {
      const y = gapAbove > 0 ? columnBottom + gapAbove : pause.y + nextColumnSlot * slotStep;
      const rect = { x: pause.x + width - w, y, w, h };
      if (isClear(rect, true)) {
        nextColumnSlot++;
        columnBottom = y + h;
        return take(rect);
      }
      // Nothing hangs in the column past a gap, so once one piece has had to
      // step out of it, everything below it does too.
      columnOpen = false;
    }
    return overflow(w, h);
  };
  const build = input.build
    ? place(SMALL_BUTTON_H)
    : {
        x: pause.x,
        y: pause.y + BUILD_SLOTS_BELOW_PAUSE * slotStep,
        w: width,
        h: SMALL_BUTTON_H,
      };
  const chip = place(CHIP_HEIGHT);
  const journal = place(JOURNAL_BUTTON_SIZE, JOURNAL_BUTTON_SIZE, JOURNAL_GAP_ABOVE);
  const extras = input.extras.map((size) => place(size.h, size.w, HUD_BUTTON_GAP));
  return { pause, bag, follower, timer, build, chip, journal, extras };
}
