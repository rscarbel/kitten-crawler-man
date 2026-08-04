import { BOUNTY_DEFS } from '../systems/bountyDefs';

/**
 * Cross-scene state for Shady's bounty loop. One mutable object is created by
 * the overworld DungeonScene and threaded by reference through every scene
 * reconstruction (building entry/exit), so an issued bounty — and, critically,
 * the shuffled orders that make repeats feel fresh — survive door round-trips.
 *
 * The shuffles live in the factory rather than the system's constructor for
 * exactly that reason: a constructor-time shuffle would re-roll every time the
 * player walked through a door.
 */
export type BountyPhase = 'available' | 'active' | 'kill_pending';

export interface BountyProgress {
  phase: BountyPhase;
  /** Shuffled cycle of BountyDef ids; walked by cycleIndex. */
  typeOrder: string[];
  cycleIndex: number;
  /**
   * Per-type shuffled name pools, so a repeat encounter gets a fresh name.
   * Optional-valued because a saved-forward record can be read with a type id
   * that no longer exists in the registry.
   */
  namesByType: Record<string, string[] | undefined>;
  nameCursorByType: Record<string, number | undefined>;
  /** Set while phase !== 'available'. */
  currentTypeId: string | null;
  currentName: string | null;
  currentSiteIndex: number | null;
  /**
   * The site the previous bounty used, kept after the payout clears
   * `currentSiteIndex` so the next one can avoid staging in the same clearing.
   */
  lastSiteIndex: number | null;
  bountiesCompleted: number;
}

/** Fisher–Yates into a fresh array; leaves the source untouched. */
function shuffled<T>(source: readonly T[]): T[] {
  const out = source.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Reshuffles `source` such that the first element is never `avoidFirst`.
 *
 * Without this the seam between two cycles can deal the same type twice in a
 * row — the one repeat the "never repeat until all have been seen" rule is
 * supposed to rule out. A swap rather than a reroll loop so a single-entry pool
 * (or a pool where every entry equals `avoidFirst`) still terminates.
 */
function reshuffledAvoidingFirst<T>(source: readonly T[], avoidFirst: T | null): T[] {
  const out = shuffled(source);
  if (avoidFirst === null || out.length < 2 || out[0] !== avoidFirst) return out;
  const swapIndex = 1 + Math.floor(Math.random() * (out.length - 1));
  const tmp = out[0];
  out[0] = out[swapIndex];
  out[swapIndex] = tmp;
  return out;
}

export function createBountyProgress(): BountyProgress {
  const namesByType: Record<string, string[] | undefined> = {};
  const nameCursorByType: Record<string, number | undefined> = {};
  for (const def of BOUNTY_DEFS) {
    namesByType[def.id] = shuffled(def.names);
    nameCursorByType[def.id] = 0;
  }
  return {
    phase: 'available',
    typeOrder: shuffled(BOUNTY_DEFS.map((def) => def.id)),
    cycleIndex: 0,
    namesByType,
    nameCursorByType,
    currentTypeId: null,
    currentName: null,
    currentSiteIndex: null,
    lastSiteIndex: null,
    bountiesCompleted: 0,
  };
}

/**
 * The bounty type that should be issued next. A pure read — Shady's dialog asks
 * for it just to name the mark in his pitch, and a getter that reshuffled a
 * durable record as a side effect would be a trap for every future caller.
 *
 * That is why the reshuffles live on the consuming side ({@link
 * advanceBountyType}, {@link takeNextBountyName}) rather than being done lazily
 * when the cursor is found to have run off the end: the cursor is never left
 * pointing past the end in the first place.
 */
export function peekNextBountyType(progress: BountyProgress): string | null {
  if (progress.typeOrder.length === 0) return null;
  const index = progress.cycleIndex % progress.typeOrder.length;
  return progress.typeOrder[index];
}

/**
 * Consumes the current cycle slot, reshuffling the order when the last type of
 * the cycle has been dealt so no type repeats until every one has been seen.
 */
export function advanceBountyType(progress: BountyProgress): void {
  progress.cycleIndex++;
  if (progress.cycleIndex < progress.typeOrder.length) return;
  const lastIssued = progress.typeOrder[progress.typeOrder.length - 1];
  progress.typeOrder = reshuffledAvoidingFirst(progress.typeOrder, lastIssued);
  progress.cycleIndex = 0;
}

/**
 * The name {@link takeNextBountyName} would return, without consuming it. Shady
 * names the mark on the second page of his pitch, which the player can still
 * back out of — a peek keeps an abandoned conversation from burning a name.
 */
export function peekNextBountyName(progress: BountyProgress, typeId: string): string {
  const pool = progress.namesByType[typeId];
  if (pool === undefined || pool.length === 0) return typeId;
  return pool[(progress.nameCursorByType[typeId] ?? 0) % pool.length];
}

/**
 * The next unused name for `typeId`, consuming it. Falls back to the type id
 * itself only if the def registered no names at all.
 */
export function takeNextBountyName(progress: BountyProgress, typeId: string): string {
  const pool = progress.namesByType[typeId];
  if (pool === undefined || pool.length === 0) return typeId;
  const cursor = (progress.nameCursorByType[typeId] ?? 0) % pool.length;
  const name = pool[cursor];
  const nextCursor = cursor + 1;
  if (nextCursor < pool.length) {
    progress.nameCursorByType[typeId] = nextCursor;
    return name;
  }
  progress.namesByType[typeId] = reshuffledAvoidingFirst(pool, name);
  progress.nameCursorByType[typeId] = 0;
  return name;
}
