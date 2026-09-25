import type { GameProgressInput } from '../auth/AuthClient';
import type { LevelCheckpoint } from './LevelCheckpoint';
import type { RespawnMode } from '../ui/DeathScreen';
import { parseSavedWorld } from './SavedWorld';

/**
 * The last save the run wrote, and the in-place twin of it when the scene that
 * wrote it could take one.
 *
 * The two live in one record so that a save can never leave an older checkpoint
 * standing: every write replaces both, and a write that cannot take a checkpoint
 * — a save with no room to stand the party in — replaces it with `null`. A
 * death then respawns from whichever of the two describes the same moment, so
 * it always lands on what a reload would.
 */
export interface SavePoint<Checkpoint = LevelCheckpoint> {
  /**
   * Exactly what was handed to the save callback. Held in memory rather than
   * read back from storage, so a respawn neither waits on nor races the write.
   */
  readonly progress: GameProgressInput;
  /**
   * Bound to the scene that captured it: its mob flags live on that scene's
   * roster, so a scene rebuilt around a regenerated roster carries `progress`
   * alone and starts with `null` here.
   */
  readonly checkpoint: Checkpoint | null;
}

/** Where a death sends the party. */
export type RespawnRoute<Checkpoint = LevelCheckpoint> =
  /** Rewind this scene in place: same map, same roster, back to the save. */
  | { kind: 'checkpoint'; checkpoint: Checkpoint }
  /** Rebuild the scene from the save, the way a page reload does. */
  | { kind: 'resumeSave'; progress: GameProgressInput }
  /** Nothing has been saved, so the only way back is the floor's own entry. */
  | { kind: 'floorRestart' };

/**
 * The respawn point a save write leaves behind, or `null` for one a death cannot
 * return to. A tutorial save is written without a world and resumes at the
 * start of a restarted script, so pointing a death at it would promise a return
 * to the save and deliver the floor restart anyway.
 */
export function savePointAfterWrite<Checkpoint>(
  progress: GameProgressInput,
  checkpoint: Checkpoint | null,
  inTutorial: boolean,
): SavePoint<Checkpoint> | null {
  return inTutorial ? null : { progress, checkpoint };
}

/**
 * Every route but the floor restart lands on the last save; the restart is
 * reserved for a run that has none a death can return to.
 */
export function respawnRouteFor<Checkpoint>(
  lastSave: SavePoint<Checkpoint> | null,
): RespawnRoute<Checkpoint> {
  if (lastSave === null) return { kind: 'floorRestart' };
  if (lastSave.checkpoint !== null) {
    return { kind: 'checkpoint', checkpoint: lastSave.checkpoint };
  }
  return { kind: 'resumeSave', progress: lastSave.progress };
}

/** What the death screen promises for a route: both save routes land on the same save. */
export function respawnModeFor<Checkpoint>(route: RespawnRoute<Checkpoint>): RespawnMode {
  return route.kind === 'floorRestart' ? 'floorRestart' : 'checkpoint';
}

/**
 * Whether the floor a scene is built from `carriedSave` for had to be generated
 * fresh because the save describes no floor this code can rebuild.
 *
 * That is any carried save without a usable world: one written by an older
 * generator, one written before saves carried a world at all, and the
 * level-complete save, which deliberately has none — its floor is the next
 * one, not yet generated. In every case the resume draws a new seed, so a
 * death before the next save would resume the same save and draw yet another.
 * The floor owes an arrival save, and nothing it replaces could have been
 * better: the carried save has no position on this floor to lose.
 */
export function carriedSaveRegeneratesFloor(carriedSave: GameProgressInput | undefined): boolean {
  return carriedSave !== undefined && parseSavedWorld(carriedSave.world) === undefined;
}

/**
 * Whether a scene's first frame owes the floor-arrival save.
 *
 * A fresh floor with no save of its own owes one, unless a death restart opted
 * out; so does a floor rebuilt in place of a carried save it could not use
 * (`carriedSaveRegeneratesFloor`). The tutorial never does — its scripted flow
 * saves at its own safe rooms.
 */
export function owesArrivalSave(
  carriedSave: GameProgressInput | undefined,
  suppressArrivalSave: boolean,
  inTutorial: boolean,
): boolean {
  if (inTutorial) return false;
  if (carriedSaveRegeneratesFloor(carriedSave)) return true;
  return carriedSave === undefined && !suppressArrivalSave;
}
