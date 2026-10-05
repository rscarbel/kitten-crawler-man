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
 * touch screen puts the Follower button ahead of Pause, all of it packed into
 * whatever room the screen leaves (see `hudPacking.ts`); a pointer screen
 * stands the Follower button at the bottom right, above the hotbar.
 */

import { inset, overlaps, type Rect } from '../core/geom';
import { packStack, type PackOptions, type PackSize } from './hudPacking';

/**
 * What a pixel of sideways drift from the column under the minimap costs, in
 * pixels of drop down it. Large enough that a portrait phone keeps the whole
 * cluster in one column; a landscape one moves pieces beside the minimap or
 * across only once the column runs into the hotbar.
 */
const COLUMN_SHIFT_COST = 4;
/** Layouts remembered at once: one per screen and HUD state a session flips between. */
const LAYOUT_CACHE_SIZE = 8;

export interface HudButtonLayoutInput {
  /** The safe area, in UI units. */
  readonly bounds: Rect;
  /** The touch layout: the cluster is packed into whatever room the screen has. */
  readonly packed: boolean;
  /** The side of every square button. */
  readonly button: number;
  /** Clear space kept between buttons, and the step between a column's slots. */
  readonly gap: number;
  /** Clear space between the HUD and the screen's edges. */
  readonly margin: number;
  /** The minimap's frame as drawn: larger than `normalMiniMap` while expanded. */
  readonly miniMap: Rect;
  /** The minimap's square at its normal size, which no button ever covers. */
  readonly normalMiniMap: Rect;
  /** The unit frames, kept clear of while there is room elsewhere. */
  readonly frames: Rect | null;
  /**
   * Where a fight's bars stack in the top band: buttons keep clear of it while
   * there is room elsewhere, so the bars are never pushed off a short screen
   * by a button that could stand anywhere.
   */
  readonly barsReserve: Rect | null;
  /** What no button may ever cover: the HP meters. */
  readonly keepouts: readonly Rect[];
  /** The hotbar's glass strip. */
  readonly hotbar: Rect;
  /** Mongo's Summon card, held whether or not it shows so nothing moves when he is unlocked. */
  readonly summon: PackSize;
  /** Whether the Build button's slot is held. */
  readonly build: boolean;
  /**
   * A scene's own buttons, placed after every shared one so that a scene
   * without them lays the shared ones out exactly the same.
   */
  readonly extras: readonly PackSize[];
}

export interface HudButtonRects {
  readonly pause: Rect;
  readonly bag: Rect;
  /** Always held, shown or not, so hiding the button never moves the buttons around it. */
  readonly follower: Rect;
  /** The Build button, where its slot is held. */
  readonly build: Rect | null;
  /** The achievement chip's slot, held whether or not anything is unread. */
  readonly chip: Rect;
  readonly journal: Rect;
  /** The crawler switch, on a touch screen; a keyboard switches with its key. */
  readonly switchButton: Rect | null;
  readonly summon: Rect;
  /** One rect per `extras` entry, in the same order. */
  readonly extras: readonly Rect[];
}

/** Most recently used last. */
const cache = new Map<string, HudButtonRects>();

/** Every HUD button's rect for `input`. */
export function hudButtonLayout(input: HudButtonLayoutInput): HudButtonRects {
  const key = JSON.stringify(input);
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const rects = input.packed ? packedLayout(input) : columnLayout(input);
  cache.set(key, rects);
  if (cache.size > LAYOUT_CACHE_SIZE) {
    const oldest = cache.keys().next();
    if (oldest.done !== true) cache.delete(oldest.value);
  }
  return rects;
}

/**
 * What a button gives up last to first: the part of the screen an expanded
 * minimap grew into (the player opened it for a look), then the top band's
 * bars, then the unit frames.
 */
function avoidTiers(input: HudButtonLayoutInput): Rect[][] {
  const tiers: Rect[][] = [[input.miniMap]];
  if (input.barsReserve !== null) tiers.push([input.barsReserve]);
  if (input.frames !== null) tiers.push([input.frames]);
  return tiers;
}

/** The pieces no button ever covers: the normal minimap, the hotbar, the HP meters. */
function hardBlocks(input: HudButtonLayoutInput): Rect[] {
  return [input.normalMiniMap, inset(input.hotbar, input.gap), ...input.keepouts];
}

/**
 * A piece that has a home of its own — the switch and Summon bottom left, a
 * pointer screen's Follower bottom right — at that home, or the clear spot
 * nearest it when something else stands there on a short screen.
 */
function pinned(input: HudButtonLayoutInput, want: Rect, blocked: Rect[]): Rect {
  const [rect] = packStack([{ w: want.w, h: want.h }], blocked, {
    bounds: inset(input.bounds, input.margin),
    blocked,
    avoid: avoidTiers(input),
    gap: input.gap,
    cost: (candidate) => Math.hypot(candidate.x - want.x, candidate.y - want.y),
    seedXs: [want.x],
    seedYs: [want.y],
  });
  blocked.push(rect);
  return rect;
}

/**
 * A touch screen's cluster, placed into whatever room the screen has.
 *
 * Under the minimap in one column, as long as the column fits; on a short
 * screen — a phone in landscape — a piece that no longer fits moves into the
 * next column to the left, or up beside the minimap, wherever
 * {@link COLUMN_SHIFT_COST} finds the nearest clear room. Pause and Bag go as
 * a pair where they can. Every piece keeps clear of the normal minimap, the
 * hotbar, the switch and Summon and the HP meters, and of what
 * {@link avoidTiers} lists while there is room elsewhere.
 *
 * Only what stays put for a whole floor moves the cluster: the Summon slot
 * and the Follower button are held whether or not they show this frame, so a
 * button never jumps from under the player's finger.
 */
function packedLayout(input: HudButtonLayoutInput): HudButtonRects {
  const { bounds, miniMap, margin, gap, button } = input;
  const blocked = hardBlocks(input);
  const switchButton = pinned(input, switchButtonRect(input), blocked);
  const summon = pinned(input, summonRect(input, switchButton), blocked);
  const anchorRight = bounds.x + bounds.w - margin;
  const options: PackOptions = {
    bounds: inset(bounds, margin),
    blocked,
    avoid: avoidTiers(input),
    gap,
    cost: (rect) => (anchorRight - (rect.x + rect.w)) * COLUMN_SHIFT_COST + rect.y,
    seedXs: [],
    seedYs: [miniMap.y + miniMap.h + gap, input.normalMiniMap.y + input.normalMiniMap.h + gap],
  };
  const placed: Rect[] = [];
  const place = (stack: readonly PackSize[]): Rect[] => {
    const rects = packStack(stack, placed, options);
    placed.push(...rects);
    return rects;
  };
  const square: PackSize = { w: button, h: button };
  const one = (size: PackSize): Rect => {
    const [rect] = place([size]);
    return rect;
  };

  const follower = one(square);
  const [pause, bag] = place([square, square]);
  const build = input.build ? one(square) : null;
  const chip = one(square);
  const journal = one(square);
  const extras = input.extras.map(one);
  return { follower, pause, bag, build, chip, journal, switchButton, summon, extras };
}

/** The crawler switch on a touch screen: bottom left, above the hotbar. */
function switchButtonRect(input: HudButtonLayoutInput): Rect {
  const { bounds, margin, button, hotbar, gap } = input;
  return { x: bounds.x + margin, y: hotbar.y - gap - button, w: button, h: button };
}

/**
 * Mongo's card: beside the switch on a touch screen, so the two take one row
 * above the hotbar and leave the unit frames above them room on a short
 * screen; bottom left above the hotbar on a pointer screen.
 */
function summonRect(input: HudButtonLayoutInput, switchButton: Rect | null): Rect {
  const { bounds, margin, hotbar, gap, summon } = input;
  if (switchButton === null) {
    return { x: bounds.x + margin, y: hotbar.y - gap - summon.h, w: summon.w, h: summon.h };
  }
  return {
    x: switchButton.x + switchButton.w + gap,
    y: switchButton.y + switchButton.h - summon.h,
    w: summon.w,
    h: summon.h,
  };
}

/**
 * A pointer screen's right-hand column: Pause under the minimap, Bag under
 * it, then the Build button (where it is reserved), the achievement chip's
 * slot, the Journal and a scene's extras.
 *
 * Each takes the next slot down the column while that slot is clear of the
 * rest of the HUD and of the bottom of the screen. Once one piece has had to
 * leave the column, the pieces after it leave too. A piece that leaves goes
 * to the first slot that is clear, searching column by column to the left as
 * far as the screen's edge, each from the top down — first clear of what
 * {@link avoidTiers} lists as well, giving those up tier by tier only when it
 * must.
 */
function columnLayout(input: HudButtonLayoutInput): HudButtonRects {
  const { bounds, miniMap, margin, gap, button } = input;
  const right = bounds.x + bounds.w - margin;
  const blocked = hardBlocks(input);
  const follower = pinned(
    input,
    { x: right - button, y: input.hotbar.y - margin - button, w: button, h: button },
    blocked,
  );
  const summon = pinned(input, summonRect(input, null), blocked);
  const top = bounds.y + margin;
  const screenFloor = bounds.y + bounds.h - margin;
  const occupied: Rect[] = [...blocked];
  const tiers = avoidTiers(input);
  const isClear = (rect: Rect, avoided: readonly Rect[]): boolean =>
    rect.x >= bounds.x + margin &&
    rect.y >= top &&
    rect.y + rect.h <= screenFloor &&
    occupied.every((other) => !overlaps(rect, other)) &&
    avoided.every((other) => !overlaps(rect, other));
  const slotStep = button + gap;
  const columnTop = miniMap.y + miniMap.h + gap;
  let nextSlot = 0;
  let columnOpen = true;
  const take = (rect: Rect): Rect => {
    occupied.push(rect);
    return rect;
  };
  const overflow = (size: PackSize): Rect => {
    for (let from = 0; from <= tiers.length; from++) {
      const avoided = tiers.slice(from).flat();
      for (let edge = right - size.w; edge >= bounds.x + margin; edge -= slotStep) {
        for (let y = top; y + size.h <= screenFloor; y += slotStep) {
          const rect = { x: edge, y, ...size };
          if (isClear(rect, avoided)) return take(rect);
        }
      }
    }
    return take({ x: right - size.w, y: columnTop, ...size });
  };
  const place = (size: PackSize): Rect => {
    if (columnOpen) {
      const rect = { x: right - size.w, y: columnTop + nextSlot * slotStep, ...size };
      if (isClear(rect, tiers.flat())) {
        nextSlot++;
        return take(rect);
      }
      columnOpen = false;
    }
    return overflow(size);
  };
  const square: PackSize = { w: button, h: button };
  const pause = place(square);
  const bag = place(square);
  const build = input.build ? place(square) : null;
  const chip = place(square);
  const journal = place(square);
  const extras = input.extras.map(place);
  return { pause, bag, follower, build, chip, journal, switchButton: null, summon, extras };
}
