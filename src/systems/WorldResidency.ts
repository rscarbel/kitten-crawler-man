/**
 * Decides what stays resident by distance from the party, for everything
 * placed in the world whose memory should follow it.
 *
 * Every decision measures how far a camera would have to travel before an
 * entry came into view, from each place the next frames may be drawn around
 * (the outlook). Within a set's hold ring an entry is held and anything it is
 * missing is asked for urgently, nearest first; past the release ring it is
 * released; between the two it keeps whichever it was, so a party standing on
 * the edge does not flip it every few steps. What holding, warming and
 * releasing mean is each resident set's own business: this only measures and
 * decides.
 *
 * A decision scans every placement, at about 0.2 µs each measured headless
 * (about 0.3 ms for 1,600 placements, once every
 * {@link RESIDENCY_CHECK_INTERVAL_UPDATES} updates). A spatial index would
 * have to re-bucket placements that move on every decision, so it does not
 * pay for its upkeep at that cost.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import { worldViewWidth, worldViewHeight } from '../core/rendering/Viewport';
import { REFRESHED_SPEED_FACTOR } from '../core/combat/StatusEffect';
import { SPEED_FIZZ_MULTIPLIER } from '../Player';
import type { TileRect } from '../map/town/townPlan';

const UPDATES_PER_SECOND = 60;

/** The fastest a crawler walks without cheats: Speed Fizz on top of the stall's boon. */
export const FASTEST_WALK_TILES_PER_SECOND =
  (PLAYER_SPEED * SPEED_FIZZ_MULTIPLIER * REFRESHED_SPEED_FACTOR * UPDATES_PER_SECOND) / TILE_SIZE;

/** Updates between decisions: often enough that the fastest walk moves under two tiles between them. */
export const RESIDENCY_CHECK_INTERVAL_UPDATES = 10;

/** A point, in world pixels, the next frames may be drawn around. */
export interface ResidencyFocus {
  readonly x: number;
  readonly y: number;
  /**
   * Set for where a warp that is coming will put the party, rather than where
   * a crawler stands: what it holds is owed by the time the warp lands, not
   * by the time anyone walks there.
   */
  readonly landing?: boolean;
}

/** The focus of a camera centred on a map tile. */
export function tileFocus(tile: { readonly x: number; readonly y: number }): ResidencyFocus {
  return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
}

/**
 * What the next frames may show: the points they may be drawn around, and
 * whether the world is covered while the party waits to be put at one of them.
 */
export interface ResidencyOutlook {
  readonly focus: ReadonlyArray<ResidencyFocus>;
  readonly covered: boolean;
}

/**
 * How far, in tiles, a camera centred on `focus` must move before any of
 * `area` comes into view: zero while some of it is in view already.
 */
export function tilesUntilInView(focus: ResidencyFocus, area: TileRect): number {
  const halfViewW = worldViewWidth() / 2 / TILE_SIZE;
  const halfViewH = worldViewHeight() / 2 / TILE_SIZE;
  const focusTileX = focus.x / TILE_SIZE;
  const focusTileY = focus.y / TILE_SIZE;
  const dx = Math.max(area.x - focusTileX, 0, focusTileX - (area.x + area.w)) - halfViewW;
  const dy = Math.max(area.y - focusTileY, 0, focusTileY - (area.y + area.h)) - halfViewH;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

/** Where one entry of a resident set is needed. An entry may be placed in several areas. */
export interface ResidentPlacement<Entry> {
  readonly entry: Entry;
  /** In tiles. */
  readonly area: TileRect;
}

/**
 * How an entry is asked for:
 * - `speculative`: outside the hold ring, into whatever room the cache has;
 * - `urgent`: inside it, displacing what the cache need not keep;
 * - `forgiving`: urgent, and also asking again for what the cache gave up on,
 *   for a loading screen under which room can be made that cannot be in play.
 */
export type ResidentUrgency = 'speculative' | 'urgent' | 'forgiving';

/**
 * How ready an entry is: all of it resident, still on its way, or missing
 * with nothing queued for it, because its cache baked or gave up on all it
 * was asked for.
 */
export type ResidentWarmth = 'warm' | 'queued' | 'stalled';

/** Whether an entry is held against its cache's release or released to it. */
type ResidentHold = 'held' | 'released';

/**
 * Anything placed in the world whose memory should follow the party. The set
 * owns its cache: this interface only says where each entry is needed and
 * which way to move it.
 */
export interface ResidentSet<Entry> {
  /**
   * Seconds of fastest walk an entry is held ahead of coming into view: how
   * long it may take to come back. The hold ring is this times
   * {@link FASTEST_WALK_TILES_PER_SECOND}.
   */
  readonly leadSeconds: number;
  /** Tiles past the hold ring an entry must be before it is released. */
  readonly releaseHysteresisTiles: number;
  /** Whether an entry is held before any decision has reached it. */
  readonly entriesStartHeld: boolean;
  /** Placements sharing a key are one entry, as near as its nearest placement. */
  keyOf(entry: Entry): string;
  /** Every placement of every entry, wherever it is. */
  placements(): Iterable<ResidentPlacement<Entry>>;
  /** Called when a released entry comes within the hold ring. */
  hold(entry: Entry): void;
  /** Called when a held entry goes past the release ring. */
  release(entry: Entry): void;
  /**
   * Called on every decision for every entry: urgently inside the hold ring,
   * speculatively outside it. Returns whether anything missing is now on
   * its way: something given up on is owed, but no hurry will bring it.
   */
  warm(entry: Entry, urgency: ResidentUrgency): boolean;
  warmth(entry: Entry): ResidentWarmth;
  /**
   * Called after a decision that found entries missing within the hold ring
   * while the world is covered, so the set may spend more per frame than play
   * would allow. Renewed on every decision while that lasts.
   */
  hurryWhileCovered?(): void;
  /**
   * Called after a decision that found entries missing within the hold ring
   * of a crawler, not only of a landing: the party has arrived among, or is
   * walking towards, entries its cache gave back, and will see them within the
   * set's lead. Renewed on every decision while that lasts.
   */
  hurryWhileApproached?(): void;
  /**
   * Spends up to `budgetMs` on whatever the set has asked its cache for, for
   * a loading screen waiting on it; `mustProgress` makes at least one step
   * even past the budget.
   */
  bakeFor?(budgetMs: number, mustProgress: boolean): void;
}

/** The share of entries near a point that are warm, and whether any still missing is on its way. */
export interface ResidentWarmthAround {
  readonly share: number;
  readonly anyQueued: boolean;
}

interface WarmthTally {
  near: number;
  warm: number;
  anyQueued: boolean;
}

/** A registered set, with its entry type hidden so sets of every kind sit in one list. */
interface Registration {
  settle(outlook: ResidencyOutlook): void;
  releaseAll(): void;
  isWarmAround(focus: ResidencyFocus): boolean;
  forgiveAndWarmAround(focus: ResidencyFocus): void;
  tallyWarmthAround(focus: ResidencyFocus, tally: WarmthTally): void;
  /** Whether the set bakes for a loading screen. */
  readonly bakes: boolean;
  bakeFor(budgetMs: number, mustProgress: boolean): void;
}

interface EntryDistance<Entry> {
  readonly key: string;
  readonly entry: Entry;
  readonly tiles: number;
  /** The same distance, from crawlers only. */
  readonly crawlerTiles: number;
}

class SetRegistration<Entry> implements Registration {
  private readonly holds = new Map<string, ResidentHold>();
  /** The entry each key last stood for, so one that stops being placed can still be released. */
  private readonly lastEntries = new Map<string, Entry>();
  private readonly holdTiles: number;
  private readonly releaseTiles: number;

  constructor(private readonly set: ResidentSet<Entry>) {
    this.holdTiles = set.leadSeconds * FASTEST_WALK_TILES_PER_SECOND;
    this.releaseTiles = this.holdTiles + set.releaseHysteresisTiles;
  }

  get bakes(): boolean {
    return this.set.bakeFor !== undefined;
  }

  bakeFor(budgetMs: number, mustProgress: boolean): void {
    this.set.bakeFor?.(budgetMs, mustProgress);
  }

  settle(outlook: ResidencyOutlook): void {
    let owedWithinHold = false;
    let owedNearCrawler = false;
    const nearest = this.nearestFirst(outlook.focus);
    this.releaseVanished(nearest);
    // Nearest first, so the cache's queue fills what the camera reaches first.
    for (const near of nearest) {
      if (near.tiles <= this.holdTiles) {
        this.moveTo(near, 'held');
        if (!this.set.warm(near.entry, 'urgent')) continue;
        owedWithinHold = true;
        if (near.crawlerTiles <= this.holdTiles) owedNearCrawler = true;
        continue;
      }
      if (near.tiles > this.releaseTiles) this.moveTo(near, 'released');
      this.set.warm(near.entry, 'speculative');
    }
    if (owedWithinHold && outlook.covered) this.set.hurryWhileCovered?.();
    if (owedNearCrawler) this.set.hurryWhileApproached?.();
  }

  releaseAll(): void {
    for (const [key, entry] of this.lastEntries) {
      if (this.holdOf(key) === 'held') this.set.release(entry);
    }
    this.holds.clear();
    this.lastEntries.clear();
  }

  isWarmAround(focus: ResidencyFocus): boolean {
    for (const near of this.nearestFirst([focus])) {
      if (near.tiles > this.holdTiles) break;
      if (this.set.warmth(near.entry) !== 'warm') return false;
    }
    return true;
  }

  forgiveAndWarmAround(focus: ResidencyFocus): void {
    for (const near of this.nearestFirst([focus])) {
      if (near.tiles > this.holdTiles) break;
      this.set.warm(near.entry, 'forgiving');
    }
  }

  tallyWarmthAround(focus: ResidencyFocus, tally: WarmthTally): void {
    for (const near of this.nearestFirst([focus])) {
      if (near.tiles > this.holdTiles) break;
      tally.near++;
      const warmth = this.set.warmth(near.entry);
      if (warmth === 'warm') tally.warm++;
      if (warmth === 'queued') tally.anyQueued = true;
    }
  }

  /**
   * Releases every key no longer placed anywhere — a look nobody wears any
   * more, a vendor gone — and forgets it, so nothing it held outlives it.
   */
  private releaseVanished(nearest: ReadonlyArray<EntryDistance<Entry>>): void {
    const placed = new Set(nearest.map((near) => near.key));
    for (const [key, entry] of this.lastEntries) {
      if (placed.has(key)) continue;
      if (this.holdOf(key) === 'held') this.set.release(entry);
      this.holds.delete(key);
      this.lastEntries.delete(key);
    }
    for (const near of nearest) this.lastEntries.set(near.key, near.entry);
  }

  private holdOf(key: string): ResidentHold {
    const fallback: ResidentHold = this.set.entriesStartHeld ? 'held' : 'released';
    return this.holds.get(key) ?? fallback;
  }

  private moveTo(near: EntryDistance<Entry>, hold: ResidentHold): void {
    if (this.holdOf(near.key) === hold) return;
    this.holds.set(near.key, hold);
    if (hold === 'held') this.set.hold(near.entry);
    else this.set.release(near.entry);
  }

  /** Each entry's distance from the nearest focus, nearest first. */
  private nearestFirst(focus: ReadonlyArray<ResidencyFocus>): EntryDistance<Entry>[] {
    const nearestByKey = new Map<string, EntryDistance<Entry>>();
    for (const placement of this.set.placements()) {
      const key = this.set.keyOf(placement.entry);
      let tiles = Number.POSITIVE_INFINITY;
      let crawlerTiles = Number.POSITIVE_INFINITY;
      for (const point of focus) {
        const pointTiles = tilesUntilInView(point, placement.area);
        tiles = Math.min(tiles, pointTiles);
        if (point.landing !== true) crawlerTiles = Math.min(crawlerTiles, pointTiles);
      }
      const known = nearestByKey.get(key);
      if (known === undefined) {
        nearestByKey.set(key, { key, entry: placement.entry, tiles, crawlerTiles });
        continue;
      }
      nearestByKey.set(key, {
        key,
        entry: tiles < known.tiles ? placement.entry : known.entry,
        tiles: Math.min(tiles, known.tiles),
        crawlerTiles: Math.min(crawlerTiles, known.crawlerTiles),
      });
    }
    return [...nearestByKey.values()].sort((a, b) => a.tiles - b.tiles);
  }
}

/** The residency decision, over every resident set registered with it. */
export class WorldResidency {
  private readonly registrations: Registration[] = [];
  private updatesUntilCheck = 0;

  register<Entry>(set: ResidentSet<Entry>): void {
    this.registrations.push(new SetRegistration(set));
  }

  /**
   * Decides, every {@link RESIDENCY_CHECK_INTERVAL_UPDATES} updates, what to
   * hold, warm and release. The outlook is built only when a decision is due.
   */
  update(outlook: () => ResidencyOutlook): void {
    if (this.registrations.length === 0) return;
    if (this.updatesUntilCheck > 0) {
      this.updatesUntilCheck--;
      return;
    }
    this.updatesUntilCheck = RESIDENCY_CHECK_INTERVAL_UPDATES;
    this.settleNow(outlook());
  }

  /**
   * {@link update}'s decision, made now: for a party just set down on the
   * floor, or a warp that has just moved it.
   */
  settleNow(outlook: ResidencyOutlook): void {
    if (outlook.focus.length === 0) return;
    for (const registration of this.registrations) registration.settle(outlook);
  }

  /**
   * Releases every entry a decision has held, for a scene giving up its
   * world: nothing it held should outlive it.
   */
  releaseAll(): void {
    for (const registration of this.registrations) registration.releaseAll();
  }

  /**
   * Whether every entry of every set within its hold ring of `focus` is
   * warm: for a warp, which must not put the party down among cold art.
   */
  isWarmAround(focus: ResidencyFocus): boolean {
    return this.registrations.every((registration) => registration.isWarmAround(focus));
  }

  /**
   * Asks again, forgivingly, for every entry within its hold ring of `focus`:
   * for a loading screen covering a warp there.
   */
  forgiveAndWarmAround(focus: ResidencyFocus): void {
    for (const registration of this.registrations) registration.forgiveAndWarmAround(focus);
  }

  /**
   * Spends `budgetMs` for a loading screen on what the sets that bake have
   * asked their caches for: each is offered an even share of what is left,
   * so a set with little to do hands the rest of its share on to the sets
   * after it rather than leaving it unspent. Measured by the clock, so a set
   * need not say what it spent.
   */
  bakeFor(budgetMs: number, mustProgress: boolean): void {
    const baking = this.registrations.filter((registration) => registration.bakes);
    let remainingMs = budgetMs;
    for (const [index, registration] of baking.entries()) {
      const shareMs = remainingMs / (baking.length - index);
      const startedAt = performance.now();
      registration.bakeFor(shareMs, mustProgress);
      remainingMs = Math.max(0, remainingMs - (performance.now() - startedAt));
    }
  }

  /**
   * The share of entries, over every set, within their hold rings of `focus`
   * that are warm, and whether any still missing is queued: none means every
   * cache has baked or given up on all of them.
   */
  warmthAround(focus: ResidencyFocus): ResidentWarmthAround {
    const tally: WarmthTally = { near: 0, warm: 0, anyQueued: false };
    for (const registration of this.registrations) registration.tallyWarmthAround(focus, tally);
    if (tally.near === 0) return { share: 1, anyQueued: false };
    return { share: tally.warm / tally.near, anyQueued: tally.anyQueued };
  }
}
