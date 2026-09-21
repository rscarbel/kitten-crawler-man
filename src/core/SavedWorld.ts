/**
 * Bumped whenever a change to map generation would make an old seed produce a
 * different floor. A save from before the bump keeps its party but loses its
 * place, because a seed replayed through changed code lands the saved safe-room
 * tile inside a wall.
 */
export const WORLD_GENERATOR_VERSION = 1;

interface TilePoint {
  x: number;
  y: number;
}

/** What a save needs to rebuild the floor the player left and stand them back on it. */
export interface SavedWorld {
  generatorVersion: number;
  worldSeed: number;
  artSeed: number;
  /** Centre of the last safe room entered; `null` when the floor has none to return to. */
  safeRoomTile: TilePoint | null;
  /** Frames left on the floor's collapse timer; `null` on a floor that has none. */
  levelTimerFrames: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTile(value: unknown): TilePoint | null {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * The world a save describes, or `undefined` when it has none or was written by
 * a generator that no longer matches. Input is unvalidated JSON from storage or
 * the server, so nothing is trusted.
 */
export function parseSavedWorld(value: unknown): SavedWorld | undefined {
  if (!isRecord(value)) return undefined;
  const { generatorVersion, worldSeed, artSeed, safeRoomTile, levelTimerFrames } = value;
  if (generatorVersion !== WORLD_GENERATOR_VERSION) return undefined;
  if (typeof worldSeed !== 'number' || !Number.isFinite(worldSeed)) return undefined;
  if (typeof artSeed !== 'number' || !Number.isFinite(artSeed)) return undefined;
  return {
    generatorVersion,
    worldSeed,
    artSeed,
    safeRoomTile: parseTile(safeRoomTile),
    levelTimerFrames:
      typeof levelTimerFrames === 'number' && Number.isFinite(levelTimerFrames)
        ? Math.max(0, levelTimerFrames)
        : null,
  };
}
