import type { GameProgressInput } from '../../auth/AuthClient';
import type { LevelCheckpoint } from './LevelCheckpoint';
import type { RespawnMode } from '../../ui/DeathScreen';
import type { DeathCause } from '../../ui/DeathExplanations';

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
  /** Back to the floor's own entry, for the reason given. */
  | { kind: 'floorRestart'; reason: FloorRestartReason };

/**
 * Why a death goes back to the floor's entry, which decides what the restart
 * may write over:
 *
 * - `noSaveToReturnTo`: the run holds no save a death can return to, so the
 *   restart writes nothing and leaves whatever storage holds alone.
 * - `timeLimitForfeit`: Nightmare's time limit ran out
 *   ({@link FLOOR_RESTART_DEATH_CAUSE}), usually long after the floor's own
 *   saves. Those saves are mid-floor with time left on the clock, so the
 *   restart writes the floor's entry over them; otherwise a reload would
 *   dodge the limit the death just enforced.
 */
export type FloorRestartReason = 'noSaveToReturnTo' | 'timeLimitForfeit';

/**
 * The one death that never returns to the last save: Nightmare's time limit
 * running out. The limit is a promise about the whole floor, and a save taken
 * part-way through would let a party dodge it by dying back to that save with
 * time still on the clock.
 */
export const FLOOR_RESTART_DEATH_CAUSE = 'levelTimerRanOut' as const satisfies DeathCause;

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
 * reserved for a run that has none a death can return to, and for the death
 * that forfeits the floor. `cause` is the death being answered, or null when
 * no death is known yet: an interior asks before any fall, and a death inside
 * one can never be the floor's time limit.
 */
export function respawnRouteFor<Checkpoint>(
  lastSave: SavePoint<Checkpoint> | null,
  cause: DeathCause | null,
): RespawnRoute<Checkpoint> {
  if (cause === FLOOR_RESTART_DEATH_CAUSE) {
    return { kind: 'floorRestart', reason: 'timeLimitForfeit' };
  }
  if (lastSave === null) return { kind: 'floorRestart', reason: 'noSaveToReturnTo' };
  if (lastSave.checkpoint !== null) {
    return { kind: 'checkpoint', checkpoint: lastSave.checkpoint };
  }
  return { kind: 'resumeSave', progress: lastSave.progress };
}

/**
 * `progress` with its floor's clock back at zero: the save a time-limit
 * restart rebuilds the floor from, which must hand the party the whole limit
 * again and nothing more.
 */
export function withFloorClockAtStart<Progress extends GameProgressInput>(
  progress: Progress,
): Progress {
  const world = progress.world;
  if (world === undefined) return progress;
  return { ...progress, world: { ...world, floorElapsedFrames: 0 } };
}

/** What the death screen promises for a route: both save routes land on the same save. */
export function respawnModeFor<Checkpoint>(route: RespawnRoute<Checkpoint>): RespawnMode {
  return route.kind === 'floorRestart' ? 'floorRestart' : 'checkpoint';
}

/**
 * Whether the floor a scene is built from `carriedSave` for had to be generated
 * fresh because the save describes no floor this code can rebuild.
 *
 * That is the level-complete save, which deliberately carries no world: its
 * floor is the next one, not yet generated. The resume draws a new seed, so a
 * death before the next save would resume the same save and draw yet another.
 * The floor owes an arrival save, and nothing it replaces could have been
 * better: the carried save has no position on this floor to lose.
 */
export function carriedSaveRegeneratesFloor(carriedSave: GameProgressInput | undefined): boolean {
  return carriedSave !== undefined && carriedSave.world === undefined;
}

/**
 * Whether a scene's first frame owes the floor-arrival save.
 *
 * A fresh floor with no save of its own owes one, unless a death restart opted
 * out; so does a floor whose carried save is stale (`carriedSaveIsStale`): one
 * it could not be rebuilt from (`carriedSaveRegeneratesFloor`), or one that
 * holds less of the run than the scene built from it, which storage must not
 * keep. The tutorial never does — its scripted flow saves at its own safe rooms.
 */
export function owesArrivalSave(
  carriedSave: GameProgressInput | undefined,
  carriedSaveIsStale: boolean,
  suppressArrivalSave: boolean,
  inTutorial: boolean,
): boolean {
  if (inTutorial) return false;
  if (carriedSave !== undefined) return carriedSaveIsStale;
  return !suppressArrivalSave;
}
