/**
 * Cross-scene state for "The Anchor is Broken" — the questline that assembles
 * the Wayfinder's Anchor out of three shards.
 *
 * The questline spans two kinds of scene: Madame Voss and the tinker's stall are
 * `DungeonScene`, while Old Hilda's cottage and the Temple of the Sky are
 * `BuildingInteriorScene` — and an interior is constructed fresh on every entry.
 * So, exactly as `MurderQuestProgress` and `CircusQuestProgress` do, one mutable
 * object is created by the overworld scene and threaded by reference through
 * every scene and every scene reconstruction.
 *
 * Shard *ownership* is deliberately absent. The two crawlers carry separate
 * inventories, so "do we have all three?" is a sum over both bags — mirroring it
 * here would give the answer two sources of truth that a checkpoint restore can
 * desync. This record tracks only what inventory cannot say.
 */

import type { QuestStatus } from './QuestManager';

/**
 * How far one shard's giver has got.
 *
 * `offered` — the giver has not been asked yet.
 * `in_progress` — they have named their price and the player is working on it.
 * `shard_owed` — the work is done; the shard is waiting to be handed over.
 * `done` — the shard has been handed over (and is now an inventory question).
 */
type AnchorStepState = 'offered' | 'in_progress' | 'shard_owed' | 'done';

export interface AnchorQuestProgress {
  /**
   * The questline's own status. The `QuestManager` inside `AnchorQuestSystem` is
   * rebuilt with the scene, so this — not that — is where the status durably
   * lives; the system seeds its manager from this field at construction.
   */
  status: QuestStatus;
  tinker: AnchorStepState;
  hilda: AnchorStepState;
  temple: AnchorStepState;
  /**
   * Which of her furnishings are mended, identified by their intact tile type
   * (e.g. `TABLE`), not by a count — a count can only say *how many*, and a
   * cottage rebuilt fresh on every door open needs to know *which*, or a visit
   * that mends the shelf can re-break the untouched worktable instead.
   */
  hildaRepairedTypes: number[];
  /**
   * Vermin still loose in the temple nave. Zero until the step starts, at which
   * point the temple step sets it to the count it spawned — so "no vermin left"
   * and "no vermin yet" are told apart by `temple`, not by this number.
   */
  templeVerminRemaining: number;
  /**
   * Whether the stone has ever completed a teleport, for Mordecai's advice.
   * Lives here rather than on `DungeonScene` because a building visit tears
   * that scene down and rebuilds it twice (in and back out) and a discovery
   * flag that resets every doorway would send the player back to advice about
   * an item they have already used.
   */
  recallEverUsed: boolean;
  /**
   * Whether a Speed Fizz has ever been bought or drunk, for Mordecai's advice.
   *
   * Not really anchor-questline state, but it needs the exact same durability
   * `recallEverUsed` does, and this record is already threaded everywhere a
   * sticky discovery flag would need to survive — a second object built solely
   * to hold one more boolean would be a second thing to remember to thread.
   * Re-derived from inventory where it can be (`countOf`/`hasStatus`), but a
   * drunk fizz's status expires and leaves nothing to read back, so the flag
   * has to be the one thing that remembers it happened at all.
   */
  speedFizzDiscovered: boolean;
}

export function createAnchorQuestProgress(): AnchorQuestProgress {
  return {
    status: 'available',
    tinker: 'offered',
    hilda: 'offered',
    temple: 'offered',
    hildaRepairedTypes: [],
    templeVerminRemaining: 0,
    recallEverUsed: false,
    speedFizzDiscovered: false,
  };
}

export interface AnchorQuestProgressCheckpoint {
  readonly status: QuestStatus;
  readonly tinker: AnchorStepState;
  readonly hilda: AnchorStepState;
  readonly temple: AnchorStepState;
  readonly hildaRepairedTypes: readonly number[];
  readonly templeVerminRemaining: number;
}

/** Snapshots questline progress so a safe-room death can rewind the errand. */
export function captureAnchorQuestProgress(
  progress: AnchorQuestProgress,
): AnchorQuestProgressCheckpoint {
  return {
    status: progress.status,
    tinker: progress.tinker,
    hilda: progress.hilda,
    temple: progress.temple,
    hildaRepairedTypes: [...progress.hildaRepairedTypes],
    templeVerminRemaining: progress.templeVerminRemaining,
  };
}

/**
 * Rewinds progress in place. The same object is threaded by reference through
 * every scene and every scene reconstruction, so it can never be replaced.
 */
export function restoreAnchorQuestProgress(
  progress: AnchorQuestProgress,
  snapshot: AnchorQuestProgressCheckpoint,
): void {
  progress.status = snapshot.status;
  progress.tinker = snapshot.tinker;
  progress.hilda = snapshot.hilda;
  progress.temple = snapshot.temple;
  progress.hildaRepairedTypes = [...snapshot.hildaRepairedTypes];
  progress.templeVerminRemaining = snapshot.templeVerminRemaining;
}
