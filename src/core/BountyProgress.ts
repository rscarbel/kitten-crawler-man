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
  /**
   * The coins this encounter will pay out, stamped when the mark was
   * levelled. Lives here — not on `BountySystem`, which is rebuilt on every
   * building entry/exit — so a mark killed on one difficulty and collected
   * after a door round-trip still pays what that fight was actually worth,
   * rather than whatever a freshly constructed system happens to default to.
   */
  pendingPayoutCoins: number;
}

/**
 * A point-in-time copy of the record, for the in-run safe-room checkpoint.
 *
 * Rewinding the whole record — not just the phase — is what makes a death
 * against a checkpoint cost the player the bounty they took after it: the
 * cycle position and the per-type name cursors go back too, so the contract
 * they accepted is un-accepted rather than merely abandoned.
 */
export interface BountyProgressCheckpoint {
  phase: BountyPhase;
  typeOrder: string[];
  cycleIndex: number;
  namesByType: Record<string, string[] | undefined>;
  nameCursorByType: Record<string, number | undefined>;
  currentTypeId: string | null;
  currentName: string | null;
  currentSiteIndex: number | null;
  lastSiteIndex: number | null;
  bountiesCompleted: number;
  pendingPayoutCoins: number;
}

/** Deep-copies the per-type name pools; the pools themselves are reshuffled in place. */
function copyNamePools(
  pools: Record<string, string[] | undefined>,
): Record<string, string[] | undefined> {
  const copy: Record<string, string[] | undefined> = {};
  for (const [typeId, names] of Object.entries(pools)) {
    copy[typeId] = names === undefined ? undefined : names.slice();
  }
  return copy;
}

export function captureBountyProgress(progress: BountyProgress): BountyProgressCheckpoint {
  return {
    phase: progress.phase,
    typeOrder: progress.typeOrder.slice(),
    cycleIndex: progress.cycleIndex,
    namesByType: copyNamePools(progress.namesByType),
    nameCursorByType: { ...progress.nameCursorByType },
    currentTypeId: progress.currentTypeId,
    currentName: progress.currentName,
    currentSiteIndex: progress.currentSiteIndex,
    lastSiteIndex: progress.lastSiteIndex,
    bountiesCompleted: progress.bountiesCompleted,
    pendingPayoutCoins: progress.pendingPayoutCoins,
  };
}

/**
 * Rewinds the record in place — every scene and `BountySystem` hold this one
 * object by reference.
 *
 * The containers are copied again on the way in, because one checkpoint is
 * restored once per death and `takeNextBountyName` reshuffles a pool in place:
 * handing the snapshot's own arrays to the live record would let the first
 * bounty issued after a restore rewrite the snapshot.
 */
export function restoreBountyProgress(
  progress: BountyProgress,
  snapshot: BountyProgressCheckpoint,
): void {
  progress.phase = snapshot.phase;
  progress.typeOrder = snapshot.typeOrder.slice();
  progress.cycleIndex = snapshot.cycleIndex;
  progress.namesByType = copyNamePools(snapshot.namesByType);
  progress.nameCursorByType = { ...snapshot.nameCursorByType };
  progress.currentTypeId = snapshot.currentTypeId;
  progress.currentName = snapshot.currentName;
  progress.currentSiteIndex = snapshot.currentSiteIndex;
  progress.lastSiteIndex = snapshot.lastSiteIndex;
  progress.bountiesCompleted = snapshot.bountiesCompleted;
  progress.pendingPayoutCoins = snapshot.pendingPayoutCoins;
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
    pendingPayoutCoins: 0,
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
