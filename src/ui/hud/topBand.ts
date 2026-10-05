/**
 * The strip of transient bars across the top of the screen: boss health, an
 * encounter's progress, a countdown, a banner. Each asks for a slot with a
 * priority and the band stacks them, highest priority first, centred between
 * the unit frames and the minimap; on a compact screen the band hangs under
 * the unit frames instead (`hudLayout` decides where the band is).
 *
 * Nothing that lives here places itself: an entry says how tall it is at a
 * given width and draws into the rect it is handed.
 */

import { inset, overlaps, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { skinsFor } from '../theme/skins';
import { drawGlass } from '../widgets/paint';

/** Highest first: a boss bar always sits nearest the top. */
export const TOP_BAND_PRIORITIES = ['boss', 'encounter', 'countdown', 'banner'] as const;

export type TopBandPriority = (typeof TOP_BAND_PRIORITIES)[number];

const PRIORITY_RANK: Readonly<Record<TopBandPriority, number>> = {
  boss: 0,
  encounter: 1,
  countdown: 2,
  banner: 3,
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
 * Where each entry goes in `area`: sorted by priority (stable within one),
 * centred across the area and stacked down from its top, `gap` apart. An entry
 * that would land on an obstacle (a phone's packed button) moves to the
 * area's left or right edge at the same height if either is clear, and
 * otherwise slides down past the obstacle. An entry with no clear place above
 * `floor` — the lowest priorities on a full screen — is left out rather than
 * laid over a button, whose taps it would take. Returned in stacking order.
 */
export function layoutTopBand(
  area: Rect,
  sizes: readonly TopBandSize[],
  obstacles: readonly Rect[],
  gap: number,
  floor = Infinity,
): { readonly id: string; readonly rect: Rect }[] {
  const ordered = sizes
    .map((size, index) => ({ size, index }))
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.size.priority] - PRIORITY_RANK[b.size.priority] || a.index - b.index,
    );
  const placed: { id: string; rect: Rect }[] = [];
  let cursor = area.y;
  for (const { size } of ordered) {
    const w = Math.min(size.w, area.w);
    const centredX = area.x + (area.w - w) / 2;
    const edgeXs = [area.x, area.x + area.w - w];
    let y = cursor;
    let rect: Rect | null = null;
    for (let step = 0; step < MAX_OBSTACLE_STEPS && y + size.h <= floor; step++) {
      const centred: Rect = { x: centredX, y, w, h: size.h };
      const candidates = [centred, ...edgeXs.map((x) => ({ ...centred, x }))];
      const clear = candidates.find((candidate) =>
        obstacles.every((obstacle) => !overlaps(candidate, obstacle)),
      );
      if (clear !== undefined) {
        rect = clear;
        break;
      }
      const blocker = obstacles.find((obstacle) => overlaps(centred, obstacle));
      if (blocker === undefined) break;
      y = blocker.y + blocker.h + gap;
    }
    if (rect === null) continue;
    placed.push({ id: size.id, rect });
    cursor = rect.y + rect.h + gap;
  }
  return placed;
}

/** Lays the entries out in `area` and draws each. Returns where each landed. */
export function renderTopBand(
  ui: Ui,
  area: Rect,
  entries: readonly TopBandEntry[],
  obstacles: readonly Rect[],
  floor = Infinity,
): { readonly id: string; readonly rect: Rect }[] {
  const sizes = entries.map((entry) => {
    const w = Math.min(entry.maxWidth, area.w);
    return { id: entry.id, priority: entry.priority, w, h: entry.height(ui, w) };
  });
  const slots = layoutTopBand(area, sizes, obstacles, ui.theme.space.sm, floor);
  for (const slot of slots) {
    const entry = entries.find((candidate) => candidate.id === slot.id);
    if (entry === undefined) continue;
    ui.block(slot.rect);
    entry.render(ui, slot.rect);
  }
  return slots;
}

/**
 * The glass card every top-band entry sits on, so a boss bar, a countdown and
 * a banner read as one family. Returns the padded inside.
 */
export function topBandCard(ui: Ui, rect: Rect, opts: { readonly accent?: string } = {}): Rect {
  const skin = skinsFor(ui.theme).panel.hud;
  drawGlass(ui, rect, opts.accent === undefined ? skin : { ...skin, border: opts.accent });
  return inset(rect, {
    l: ui.theme.space.md,
    r: ui.theme.space.md,
    t: skin.padding,
    b: skin.padding,
  });
}

/** The vertical padding {@link topBandCard} adds above and below its content. */
export function topBandCardPadding(ui: Ui): number {
  return skinsFor(ui.theme).panel.hud.padding * 2;
}
