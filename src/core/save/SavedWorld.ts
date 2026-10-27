import type { PersistedWorldState } from './PersistedWorldState';
import { parsePersistedWorldState, parsePoint } from './PersistedWorldState';
import { isRecord } from '../util/guards';

/**
 * Changed whenever a change to map generation would make a seed produce a
 * different floor. A seed replayed through changed code lands the saved
 * safe-room tile inside a wall, and nothing in the seed itself can reveal
 * that, so a save stamped with any other generator fails validation.
 */
export const WORLD_GENERATOR_VERSION = 8;

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
   * floor has none to return to.
   */
  resumeTile: TilePoint | null;
  /** Frames left on the floor's collapse timer; `null` on a floor that has none. */
  levelTimerFrames: number | null;
  persisted: PersistedWorldState;
}

/**
 * The world a save describes, or `undefined` when it is not a valid one for
 * this build, including one written by another generator. Input is
 * unvalidated JSON from storage or the server, so nothing is trusted.
 */
export function parseSavedWorld(value: unknown): SavedWorld | undefined {
  if (!isRecord(value)) return undefined;
  const { generatorVersion, worldSeed, artSeed, resumeTile, levelTimerFrames, persisted } = value;
  if (generatorVersion !== WORLD_GENERATOR_VERSION) return undefined;
  if (!isFiniteNumber(worldSeed) || !isFiniteNumber(artSeed)) return undefined;
  const parsedResumeTile = resumeTile === null ? null : parsePoint(resumeTile);
  if (parsedResumeTile === undefined) return undefined;
  const levelTimerValid =
    levelTimerFrames === null || (isFiniteNumber(levelTimerFrames) && levelTimerFrames >= 0);
  if (!levelTimerValid) return undefined;
  const parsedPersisted = parsePersistedWorldState(persisted);
  if (parsedPersisted === undefined) return undefined;
  return {
    generatorVersion,
    worldSeed,
    artSeed,
    resumeTile: parsedResumeTile,
    levelTimerFrames,
    persisted: parsedPersisted,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
