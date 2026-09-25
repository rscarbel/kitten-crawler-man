import type { PersistedWorldState } from './PersistedWorldState';
import { parsePersistedWorldState, parsePoint } from './PersistedWorldState';
import { isRecord } from './guards';

/**
 * Bumped whenever a change to map generation would make an old seed produce a
 * different floor. A save from before the bump keeps its party but loses its
 * place, because a seed replayed through changed code lands the saved safe-room
 * tile inside a wall: `parseSavedWorld` drops the whole world, so the floor is
 * regenerated from a fresh seed, its per-floor state starts over, and the
 * party arrives at the floor's start tile.
 */
export const WORLD_GENERATOR_VERSION = 3;

interface TilePoint {
  x: number;
  y: number;
}

/** What a save needs to rebuild the floor the player left and stand them back on it. */
export interface SavedWorld {
  generatorVersion: number;
  worldSeed: number;
  artSeed: number;
  /**
   * The last save point entered — a safe room's centre, or the tile where the
   * party entered town — which is where a resume puts them; `null` when the
   * floor has none to return to. Named for safe rooms because it is a key in
   * existing saves.
   */
  safeRoomTile: TilePoint | null;
  /** Frames left on the floor's collapse timer; `null` on a floor that has none. */
  levelTimerFrames: number | null;
  /** Absent on an older save or one that no longer parses; the floor then starts fresh. */
  persisted?: PersistedWorldState;
}

/**
 * The world a save describes, or `undefined` when it has none or was written by
 * a generator that no longer matches. Input is unvalidated JSON from storage or
 * the server, so nothing is trusted.
 */
export function parseSavedWorld(value: unknown): SavedWorld | undefined {
  if (!isRecord(value)) return undefined;
  const { generatorVersion, worldSeed, artSeed, safeRoomTile, levelTimerFrames, persisted } = value;
  if (generatorVersion !== WORLD_GENERATOR_VERSION) return undefined;
  if (typeof worldSeed !== 'number' || !Number.isFinite(worldSeed)) return undefined;
  if (typeof artSeed !== 'number' || !Number.isFinite(artSeed)) return undefined;
  const parsedPersisted = persisted === undefined ? undefined : parsePersistedWorldState(persisted);
  return {
    generatorVersion,
    worldSeed,
    artSeed,
    safeRoomTile: parsePoint(safeRoomTile) ?? null,
    levelTimerFrames:
      typeof levelTimerFrames === 'number' && Number.isFinite(levelTimerFrames)
        ? Math.max(0, levelTimerFrames)
        : null,
    persisted: parsedPersisted,
  };
}
