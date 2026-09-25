/**
 * The navigation the village assault's undead follow: for every tile around
 * Briar Hollow, how costly the cheapest way to the Hollow Bell is, counting a
 * standing wall as the time it takes to chew through it.
 *
 * A flow field rather than per-mob A*: the palisade is a closed ring and the
 * gate is shut to hostiles, so a plain search from outside to the bell fails —
 * and a failed search latches (`astarSearchFailed` holds a mob off pathing for
 * a while), dropping the mob to straight-line movement that scrapes along the
 * wall. One Dijkstra outward from the bell answers "which wall do I break, and
 * how do I get there" for every mob at once.
 *
 * The field is recomputed when the walls it priced change enough to matter —
 * a tier, a breach, or a structure's health crossing a quarter — and never
 * more often than {@link FLOW_RECOMPUTE_DEBOUNCE_SECONDS}, so a wall being
 * chewed does not rebuild it on every blow.
 */

import type { EventBus } from '../../core/EventBus';
import type { GameMap } from '../../map/GameMap';
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import type { SiegeFlowQuery, SiegeTile } from '../../creatures/siege/siegeTypes';
import { isStandingStructure } from '../../creatures/siege/siegeCapability';
import type { DefenseStructures, StructureRef } from './DefenseStructures';
import { structureKey, trebuchetFootprint, footprintTiles } from './DefenseStructures';

/** How far past the palisade the field reaches, so every lane's walk in is inside it. */
export const FLOW_MARGIN_TILES = 32;
/**
 * The health a siege mob chews through in the time it takes to walk one
 * tile. A wall's price in the field is its health over this — "how many tiles
 * of walking is breaking it worth" — so a mob detours to a weaker section
 * rather than chewing a fortified one, but never walks the whole ring to
 * save a few blows.
 */
export const SIEGE_DPS_ESTIMATE_PER_TILE = 4;
/**
 * What a standing snare adds to a step onto it, so the undead mildly prefer
 * to step round a trap they can see. Zero if playtesting finds snares never
 * spring.
 */
export const SNARE_STEP_PENALTY = 2;
/** Seconds between recomputes, however often the walls change. */
export const FLOW_RECOMPUTE_DEBOUNCE_SECONDS = 0.5;
/** A structure's health is priced in quarters: a change inside one does not recompute. */
const HP_BANDS = 4;
/**
 * Neighbours within this share of the cheapest are all "downhill enough",
 * and a mob picks among them by its own seed, so a wave converging on one
 * breach spreads out instead of walking single file.
 */
export const SPREAD_COST_TOLERANCE = 0.05;

const OPEN_STEP_COST = 1;
/** Entries the heap starts with room for; a recompute of the whole field needs a few thousand. */
const HEAP_INITIAL_CAPACITY = 4096;
const UNREACHABLE = Number.POSITIVE_INFINITY;

const NEIGHBOURS_4: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Multipliers and shifts of a 32-bit integer mix (the murmur finaliser): opaque by nature. */
const HASH_X_PRIME = 0x27d4eb2d;
const HASH_Y_PRIME = 0x165667b1;
const MIX_A = 0x85ebca6b;
const MIX_B = 0xc2b2ae35;
const SHIFT_A = 15;
const SHIFT_B = 13;
const SHIFT_C = 16;

/** A small integer hash for the per-mob tie-break; stable for a mob on a tile. */
function spreadHash(seed: number, x: number, y: number): number {
  let h = (seed | 0) ^ Math.imul(x, HASH_X_PRIME) ^ Math.imul(y, HASH_Y_PRIME);
  h = Math.imul(h ^ (h >>> SHIFT_A), MIX_A);
  h = Math.imul(h ^ (h >>> SHIFT_B), MIX_B);
  return (h ^ (h >>> SHIFT_C)) >>> 0;
}

/**
 * A binary min-heap of tile indices keyed by cost, over typed arrays that
 * grow only when a recompute outruns them, so a recompute allocates nothing.
 */
class IndexHeap {
  private items = new Int32Array(HEAP_INITIAL_CAPACITY);
  private keys = new Float64Array(HEAP_INITIAL_CAPACITY);
  private count = 0;
  /** The key of the entry the last {@link pop} removed. */
  lastKey = 0;

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  private grow(): void {
    const items = new Int32Array(this.items.length * 2);
    const keys = new Float64Array(this.keys.length * 2);
    items.set(this.items);
    keys.set(this.keys);
    this.items = items;
    this.keys = keys;
  }

  push(item: number, key: number): void {
    if (this.count === this.items.length) this.grow();
    const items = this.items;
    const keys = this.keys;
    let i = this.count++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      items[i] = items[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    items[i] = item;
    keys[i] = key;
  }

  /** Removes the cheapest entry and returns it; its key is left in {@link lastKey}. */
  pop(): number {
    const items = this.items;
    const keys = this.keys;
    const top = items[0];
    this.lastKey = keys[0];
    const count = --this.count;
    if (count > 0) {
      const lastItem = items[count];
      const lastKey = keys[count];
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        if (left >= count) break;
        const right = left + 1;
        const child = right < count && keys[right] < keys[left] ? right : left;
        if (keys[child] >= lastKey) break;
        items[i] = items[child];
        keys[i] = keys[child];
        i = child;
      }
      items[i] = lastItem;
      keys[i] = lastKey;
    }
    return top;
  }
}

export interface SiegeFlowFieldDeps {
  readonly gameMap: GameMap;
  readonly site: BriarHollowSite;
  readonly defense: DefenseStructures;
  /** Structure events mark the field for a check; absent in a gate that calls {@link SiegeFlowField.markDirty}. */
  readonly bus?: EventBus;
  /** High-resolution clock in milliseconds, for measuring a recompute. */
  readonly nowMs?: () => number;
}

export class SiegeFlowField implements SiegeFlowQuery {
  private readonly originX: number;
  private readonly originY: number;
  private readonly width: number;
  private readonly height: number;
  private readonly cost: Float64Array;
  /** Each tile's entry cost for the recompute under way; reused, never reallocated. */
  private readonly steps: Float64Array;
  private readonly heap = new IndexHeap();
  private readonly unsubscribers: Array<() => void> = [];
  private dirty = false;
  private secondsSinceRecompute = FLOW_RECOMPUTE_DEBOUNCE_SECONDS;
  private signature = '';
  /**
   * What entering each tile costs with no structure on it: open ground or
   * solid. The land does not change during a siege, so it is read from the
   * map once per set of engines standing — the engines' own footprints are
   * the one thing that moves the map's blocks — and every recompute prices
   * the structures over a copy of it.
   */
  private terrain: Float64Array | null = null;
  private terrainEngines = '';
  /** How long each recompute took, in milliseconds, for the gate to judge. */
  readonly recomputeMs: number[] = [];
  /** How many times the field has been rebuilt. */
  recomputes = 0;

  constructor(private readonly deps: SiegeFlowFieldDeps) {
    const { site } = deps;
    let minX = site.palisadeBounds.x - FLOW_MARGIN_TILES;
    let minY = site.palisadeBounds.y - FLOW_MARGIN_TILES;
    let maxX = site.palisadeBounds.x + site.palisadeBounds.w + FLOW_MARGIN_TILES;
    let maxY = site.palisadeBounds.y + site.palisadeBounds.h + FLOW_MARGIN_TILES;
    // Every lane's spawn must be inside, or its wave would stand where it appeared.
    for (const lane of site.assaultLanes) {
      minX = Math.min(minX, lane.spawn.x - 1);
      minY = Math.min(minY, lane.spawn.y - 1);
      maxX = Math.max(maxX, lane.spawn.x + 1);
      maxY = Math.max(maxY, lane.spawn.y + 1);
    }
    const mapHeight = deps.gameMap.structure.length;
    const mapWidth = mapHeight === 0 ? 0 : deps.gameMap.structure[0].length;
    this.originX = Math.max(0, minX);
    this.originY = Math.max(0, minY);
    this.width = Math.max(0, Math.min(mapWidth, maxX + 1) - this.originX);
    this.height = Math.max(0, Math.min(mapHeight, maxY + 1) - this.originY);
    this.cost = new Float64Array(this.width * this.height);
    this.steps = new Float64Array(this.width * this.height);
    const bus = deps.bus;
    if (bus !== undefined) {
      const mark = (): void => this.markDirty();
      this.unsubscribers.push(
        bus.on('structureDamaged', mark),
        bus.on('structureDestroyed', mark),
        bus.on('structureBuilt', mark),
        bus.on('structureRepaired', mark),
      );
    }
    this.recompute();
  }

  /** Something about the walls may have changed; the next {@link update} checks. */
  markDirty(): void {
    this.dirty = true;
  }

  /** Once per gameplay update: recomputes when the walls have changed enough, at most every half second. */
  update(dtSeconds: number): void {
    this.secondsSinceRecompute += dtSeconds;
    if (!this.dirty || this.secondsSinceRecompute < FLOW_RECOMPUTE_DEBOUNCE_SECONDS) return;
    this.dirty = false;
    if (this.structureSignature() === this.signature) return;
    this.recompute();
  }

  /**
   * One word per structure the field prices: its standing state and the
   * quarter of its health it is in. Two equal signatures price every tile the
   * same.
   */
  private structureSignature(): string {
    const { defense } = this.deps;
    const parts: string[] = [];
    // Its full health as well as the quarter it is in: an upgrade from a
    // full wooden wall to a full stone one changes the price, not the quarter.
    const band = (ref: StructureRef): string => {
      const standing = isStandingStructure(defense, ref);
      if (!standing) return 'x';
      const max = defense.maxHp(ref);
      const quarter = max <= 0 ? 0 : Math.ceil((defense.hp(ref) / max) * HP_BANDS);
      return `${max}:${quarter}`;
    };
    for (const segment of defense.segments) {
      parts.push(band({ kind: 'segment', id: segment.id }));
    }
    for (const record of defense.trebuchets) {
      const ref: StructureRef = { kind: 'trebuchet', key: structureKey(record.x, record.y) };
      parts.push(`t${ref.key}:${band(ref)}`);
    }
    for (const record of defense.snares) {
      parts.push(`s${structureKey(record.x, record.y)}:${record.broken ? 'x' : 'o'}`);
    }
    parts.push(`b${band({ kind: 'bell' })}`);
    return parts.join('|');
  }

  private indexOf(tileX: number, tileY: number): number {
    const lx = tileX - this.originX;
    const ly = tileY - this.originY;
    if (lx < 0 || ly < 0 || lx >= this.width || ly >= this.height) return -1;
    return ly * this.width + lx;
  }

  /** What a standing structure adds to entering its tile: how long chewing through it takes. */
  private structurePrice(ref: StructureRef): number {
    const { defense } = this.deps;
    const record = defense.record(ref);
    const spikes = record?.spikesHp ?? 0;
    return OPEN_STEP_COST + (defense.hp(ref) + spikes) / SIEGE_DPS_ESTIMATE_PER_TILE;
  }

  /**
   * What entering each tile costs, for this recompute: open ground one, a
   * standing structure its price, a snare a small penalty, the gate and every
   * other solid tile impassable.
   */
  private terrainCosts(): Float64Array {
    const { defense, gameMap } = this.deps;
    const engines = defense.trebuchets.map((record) => structureKey(record.x, record.y)).join('|');
    if (this.terrain !== null && engines === this.terrainEngines) return this.terrain;
    const terrain = new Float64Array(this.width * this.height);
    for (let ly = 0; ly < this.height; ly++) {
      for (let lx = 0; lx < this.width; lx++) {
        const x = lx + this.originX;
        const y = ly + this.originY;
        const i = ly * this.width + lx;
        // The gate is shut to hostiles by its own walkability flag, which is
        // what makes it impassable here too — one rule, read in one place.
        const open = gameMap.isWalkableForHostile(x, y);
        terrain[i] = open ? OPEN_STEP_COST : UNREACHABLE;
      }
    }
    this.terrain = terrain;
    this.terrainEngines = engines;
    return terrain;
  }

  private stepCosts(): Float64Array {
    const { defense, gameMap } = this.deps;
    const steps = this.steps;
    steps.set(this.terrainCosts());
    // The ring's own tiles open and close as walls fall and are mended.
    for (const segment of defense.segments) {
      for (const tile of segment.tiles) {
        const i = this.indexOf(tile.x, tile.y);
        if (i >= 0)
          steps[i] = gameMap.isWalkableForHostile(tile.x, tile.y) ? OPEN_STEP_COST : UNREACHABLE;
      }
    }
    const price = (ref: StructureRef, tiles: ReadonlyArray<{ x: number; y: number }>): void => {
      const standing = isStandingStructure(defense, ref);
      const value = standing ? this.structurePrice(ref) : null;
      for (const tile of tiles) {
        const i = this.indexOf(tile.x, tile.y);
        if (i < 0) continue;
        // A fallen wall is rubble to walk over, which the map already says.
        if (value !== null) steps[i] = value;
      }
    };
    for (const segment of defense.segments) {
      price({ kind: 'segment', id: segment.id }, segment.tiles);
    }
    for (const record of defense.trebuchets) {
      price(
        { kind: 'trebuchet', key: structureKey(record.x, record.y) },
        footprintTiles(trebuchetFootprint(record.x, record.y)),
      );
    }
    price({ kind: 'bell' }, defense.bellTiles);
    for (const record of defense.snares) {
      const i = this.indexOf(record.x, record.y);
      if (i < 0 || record.broken || !Number.isFinite(steps[i])) continue;
      steps[i] += SNARE_STEP_PENALTY;
    }
    return steps;
  }

  /** Rebuilds the whole field from the bell outward. */
  recompute(): void {
    const now = this.deps.nowMs ?? (() => performance.now());
    const startedAt = now();
    this.signature = this.structureSignature();
    this.secondsSinceRecompute = 0;
    const steps = this.stepCosts();
    const cost = this.cost;
    cost.fill(UNREACHABLE);
    const heap = this.heap;
    heap.clear();
    // The bell's own tiles are where every route ends: reaching one costs
    // nothing more, and stepping onto one from beside it is the blow on the bell.
    for (const tile of this.deps.defense.bellTiles) {
      const i = this.indexOf(tile.x, tile.y);
      if (i < 0) continue;
      cost[i] = 0;
      heap.push(i, 0);
    }
    const width = this.width;
    const height = this.height;
    const last = width * height;
    while (heap.size > 0) {
      const i = heap.pop();
      const here = heap.lastKey;
      if (here > cost[i]) continue;
      // Walking from a neighbour into this tile costs this tile's step.
      const through = here + steps[i];
      const lx = i % width;
      // Unrolled over the four neighbours: this loop runs for every tile of
      // the field on every recompute.
      if (i >= width) this.relax(i - width, through, steps, cost, heap);
      if (i + width < last) this.relax(i + width, through, steps, cost, heap);
      if (lx > 0) this.relax(i - 1, through, steps, cost, heap);
      if (lx < width - 1) this.relax(i + 1, through, steps, cost, heap);
    }
    this.recomputes++;
    this.recomputeMs.push(now() - startedAt);
  }

  private relax(
    n: number,
    through: number,
    steps: Float64Array,
    cost: Float64Array,
    heap: IndexHeap,
  ): void {
    if (through >= cost[n] || steps[n] === UNREACHABLE) return;
    cost[n] = through;
    heap.push(n, through);
  }

  /** The field's cost at a tile: how dear the cheapest way to the bell is from there. */
  costAt(tile: SiegeTile): number {
    const i = this.indexOf(tile.x, tile.y);
    return i < 0 ? UNREACHABLE : this.cost[i];
  }

  /**
   * The next tile toward the bell from `tile`. Among neighbours within
   * {@link SPREAD_COST_TOLERANCE} of the cheapest, `spreadSeed` picks one, so
   * each mob keeps its own line through a crowd; the same seed on the same
   * tile always gives the same answer.
   */
  nextStep(tile: SiegeTile, spreadSeed = 0): SiegeTile | null {
    const i = this.indexOf(tile.x, tile.y);
    if (i < 0) return null;
    const here = this.cost[i];
    let best = UNREACHABLE;
    for (const [dx, dy] of NEIGHBOURS_4) {
      const via = this.costVia({ x: tile.x + dx, y: tile.y + dy });
      if (via < best) best = via;
    }
    if (!Number.isFinite(best)) return null;
    return this.pickAmong(tile, here, best, spreadSeed);
  }

  /**
   * What reaching the bell costs from here by way of `next`: entering it —
   * a wall's price for a standing wall — and the rest of the way from it.
   * The field's own cost at a tile leaves out that tile's entry, so choosing
   * a step by it alone would walk into a stone wall as readily as a fence.
   */
  private costVia(next: SiegeTile): number {
    const n = this.indexOf(next.x, next.y);
    if (n < 0) return UNREACHABLE;
    return this.cost[n] + this.steps[n];
  }

  /**
   * Every neighbour whose way to the bell is within
   * {@link SPREAD_COST_TOLERANCE} of the cheapest, and which is itself nearer
   * the bell than here (so a step always makes progress), one of them chosen
   * by the seed.
   */
  private pickAmong(
    tile: SiegeTile,
    here: number,
    best: number,
    spreadSeed: number,
  ): SiegeTile | null {
    const limit = best * (1 + SPREAD_COST_TOLERANCE);
    const candidates: SiegeTile[] = [];
    for (const [dx, dy] of NEIGHBOURS_4) {
      const next = { x: tile.x + dx, y: tile.y + dy };
      if (this.costVia(next) <= limit && this.costAt(next) < here) candidates.push(next);
    }
    if (candidates.length === 0) return null;
    return candidates[spreadHash(spreadSeed, tile.x, tile.y) % candidates.length];
  }

  /** The standing structure the step out of `tile` would walk into, or null for open ground. */
  blockingStructure(tile: SiegeTile, spreadSeed = 0): StructureRef | null {
    const next = this.nextStep(tile, spreadSeed);
    if (next === null) return null;
    const { defense } = this.deps;
    const ref = defense.at(next.x, next.y);
    if (ref === null || ref.kind === 'snare') return null;
    return isStandingStructure(defense, ref) ? ref : null;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
  }
}
