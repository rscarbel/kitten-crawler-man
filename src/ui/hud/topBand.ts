/**
 * The strip of transient bars across the top of the screen: boss health, an
 * encounter's progress, a countdown, a banner. Each asks for a slot with a
 * priority and the band stacks them, highest priority first, centred between
 * the unit frames and the minimap; on a compact screen the band hangs under
 * the unit frames instead (`hudLayout` decides where the band is).
 *
 * Nothing that lives here places itself: an entry says how tall it is at a
 * given width and draws into the rect it is handed.
 *
 * A card is a readout, not a control: it registers no region of its own, so a
 * tap on it reaches the world beneath (on a phone the band can lie over the
 * very thing the player has to tap). An entry with its own controls registers
 * them itself.
 */

import { inset, overlaps, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { skinsFor } from '../theme/skins';
import { drawGlass } from '../widgets/paint';
import type { SizeClass } from '../core/viewport';
import type { Theme } from '../theme/tokens';
import type { StackedBandOptions } from './topBandStack';

/**
 * Highest first: a boss bar always sits nearest the top. `arrival` is where
 * the player has just come in (a room's name): it is shown only while nothing
 * else holds the band, so it never pushes a fight's cards down over the room.
 */
export const TOP_BAND_PRIORITIES = ['boss', 'encounter', 'countdown', 'banner', 'arrival'] as const;

export type TopBandPriority = (typeof TOP_BAND_PRIORITIES)[number];

const PRIORITY_RANK: Readonly<Record<TopBandPriority, number>> = {
  boss: 0,
  encounter: 1,
  countdown: 2,
  banner: 3,
  arrival: 4,
};

/** One bar in the band, built by its owner every frame it should show. */
export interface TopBandEntry {
  /** Unique within the band this frame; prefixes the entry's widget ids. */
  readonly id: string;
  readonly priority: TopBandPriority;
  /** The widest the entry is drawn; narrower bands hand it their whole width. */
  readonly maxWidth: number;
  /** The height the entry needs at `width` UI units. */
  height(ui: Ui, width: number): number;
  render(ui: Ui, rect: Rect): void;
  /** The rows and look it was built from, when it is a stack of rows (`stackedBandEntry`). */
  readonly stack?: StackedBandOptions;
}

/** An entry's size for {@link layoutTopBand}, which needs no `Ui`. */
export interface TopBandSize {
  readonly id: string;
  readonly priority: TopBandPriority;
  readonly w: number;
  readonly h: number;
}

/** Most nudges an entry takes past obstacles before it settles where it is. */
const MAX_OBSTACLE_STEPS = 16;

/**
 * A fight's own bars: shown even where the only room left lies over the
 * player, since a boss or an encounter with no bar is worse than a bar over
 * his head.
 */
const ALWAYS_PLACED: ReadonlySet<TopBandPriority> = new Set(['boss', 'encounter']);

/** The entries the band shows: an `arrival` entry only while it has the band to itself. */
function shownSizes(sizes: readonly TopBandSize[]): readonly TopBandSize[] {
  const anyOther = sizes.some((size) => size.priority !== 'arrival');
  return anyOther ? sizes.filter((size) => size.priority !== 'arrival') : sizes;
}

/**
 * Where each entry goes in `area`: sorted by priority (stable within one),
 * centred across the area and stacked down from its top, `gap` apart. An entry
 * that would land on an obstacle (a phone's packed button) moves to the
 * area's left or right edge at the same height if either is clear, and
 * otherwise slides down past the obstacle. An entry with no clear place above
 * `floor` — the lowest priorities on a full screen — is left out rather than
 * laid over a button, whose taps it would take. `keepClear` is avoided the
 * same way, unless that leaves a fight's own bar out: then the fight's bars
 * are laid out against `obstacles` alone and only the rest avoid it. An
 * `arrival` entry is left out whenever any other entry is shown.
 * Returned in stacking order.
 */
export function layoutTopBand(
  area: Rect,
  sizes: readonly TopBandSize[],
  obstacles: readonly Rect[],
  gap: number,
  floor = Infinity,
  keepClear: readonly Rect[] = [],
): Placed[] {
  const ordered = shownSizes(sizes)
    .map((size, index) => ({ size, index }))
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.size.priority] - PRIORITY_RANK[b.size.priority] || a.index - b.index,
    );
  const pass = (avoidsKeepClear: (priority: TopBandPriority) => boolean): Placed[] => {
    const placed: Placed[] = [];
    let cursor = area.y;
    for (const { size } of ordered) {
      const avoid = avoidsKeepClear(size.priority) ? [...obstacles, ...keepClear] : obstacles;
      const w = Math.min(size.w, area.w);
      const rect = placeEntry(area, { w, h: size.h }, cursor, avoid, gap, floor);
      if (rect === null) continue;
      placed.push({ id: size.id, rect });
      cursor = rect.y + rect.h + gap;
    }
    return placed;
  };
  const everyAvoids = pass(() => true);
  const fightBarLeftOut = ordered.some(
    ({ size }) =>
      ALWAYS_PLACED.has(size.priority) && !everyAvoids.some((slot) => slot.id === size.id),
  );
  if (!fightBarLeftOut || keepClear.length === 0) return everyAvoids;
  return pass((priority) => !ALWAYS_PLACED.has(priority));
}

interface Placed {
  readonly id: string;
  readonly rect: Rect;
}

/**
 * The first clear place for an entry `w` × `h` at or below `top`: centred,
 * else at either edge, else slid down past what blocks the centre.
 */
function placeEntry(
  area: Rect,
  size: { readonly w: number; readonly h: number },
  top: number,
  obstacles: readonly Rect[],
  gap: number,
  floor: number,
): Rect | null {
  const centredX = area.x + (area.w - size.w) / 2;
  const edgeXs = [area.x, area.x + area.w - size.w];
  let y = top;
  for (let step = 0; step < MAX_OBSTACLE_STEPS && y + size.h <= floor; step++) {
    const centred: Rect = { x: centredX, y, w: size.w, h: size.h };
    const candidates = [centred, ...edgeXs.map((x) => ({ ...centred, x }))];
    const clear = candidates.find((candidate) =>
      obstacles.every((obstacle) => !overlaps(candidate, obstacle)),
    );
    if (clear !== undefined) return clear;
    const blocker = obstacles.find((obstacle) => overlaps(centred, obstacle));
    if (blocker === undefined) return null;
    y = blocker.y + blocker.h + gap;
  }
  return null;
}

/** Lays the entries out in `area` and draws each. Returns where each landed. */
export function renderTopBand(
  ui: Ui,
  area: Rect,
  entries: readonly TopBandEntry[],
  obstacles: readonly Rect[],
  floor = Infinity,
  keepClear: readonly Rect[] = [],
): { readonly id: string; readonly rect: Rect }[] {
  const sizes = entries.map((entry) => {
    const w = Math.min(entry.maxWidth, area.w);
    return { id: entry.id, priority: entry.priority, w, h: entry.height(ui, w) };
  });
  const slots = layoutTopBand(area, sizes, obstacles, ui.theme.space.sm, floor, keepClear);
  for (const slot of slots) {
    const entry = entries.find((candidate) => candidate.id === slot.id);
    if (entry === undefined) continue;
    entry.render(ui, slot.rect);
  }
  return slots;
}

/**
 * How far a band card's content sits in from its edges. A compact screen's
 * cards are condensed, since the band there shares the column the player
 * stands in.
 */
export function bandCardInsets(
  theme: Theme,
  size: SizeClass,
): { readonly x: number; readonly y: number } {
  const { space } = theme;
  if (size === 'compact') return { x: space.sm, y: space.xs };
  return { x: space.md, y: skinsFor(theme).panel.hud.padding };
}

/** {@link bandCardInsets} for the screen `ui` is drawing on. */
export function topBandCardInsets(ui: Ui): { readonly x: number; readonly y: number } {
  return bandCardInsets(ui.theme, ui.size);
}

/**
 * The glass card every top-band entry sits on, so a boss bar, a countdown and
 * a banner read as one family. Returns the padded inside.
 */
export function topBandCard(ui: Ui, rect: Rect, opts: { readonly accent?: string } = {}): Rect {
  const skin = skinsFor(ui.theme).panel.hud;
  drawGlass(ui, rect, opts.accent === undefined ? skin : { ...skin, border: opts.accent });
  const pad = topBandCardInsets(ui);
  return inset(rect, { l: pad.x, r: pad.x, t: pad.y, b: pad.y });
}

/** The width {@link topBandCard} leaves for content in a card `width` wide. */
export function topBandCardInnerWidth(ui: Ui, width: number): number {
  return Math.max(0, width - topBandCardInsets(ui).x * 2);
}

/** The vertical padding {@link topBandCard} adds above and below its content. */
export function topBandCardPadding(ui: Ui): number {
  return topBandCardInsets(ui).y * 2;
}
