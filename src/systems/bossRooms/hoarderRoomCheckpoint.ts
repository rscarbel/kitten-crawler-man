import { isRecord } from '../../core/guards';
import type { TilePoint } from './bossRoomLayout';

/** A tower that has come down, and the tiles its junk spread over. */
export interface ToppledTower {
  /** The tower's index in the lair's layout, which is fixed for a floor. */
  readonly tower: number;
  /** The tiles its junk spread over, past its own. */
  readonly line: readonly TilePoint[];
}

/** What the Hoarder's lair has to put back after a death: which towers are down, and where they fell. */
export interface HoarderRoomCheckpoint {
  readonly toppled: ReadonlyArray<ToppledTower>;
}

function parseTile(value: unknown): TilePoint | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y } = value;
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
  return { x, y };
}

function parseToppled(value: unknown): ToppledTower | undefined {
  if (!isRecord(value)) return undefined;
  const { tower, line } = value;
  if (typeof tower !== 'number' || !Number.isInteger(tower) || tower < 0) return undefined;
  if (!Array.isArray(line)) return undefined;
  const tiles: TilePoint[] = [];
  for (const entry of line) {
    const tile = parseTile(entry);
    if (tile === undefined) return undefined;
    tiles.push(tile);
  }
  return { tower, line: tiles };
}

/**
 * Reads the lair's part of a saved checkpoint back from untrusted JSON: null
 * for a floor with no lair, undefined for anything malformed. A save written
 * before the lair kept any state has an empty record here, which reads as no
 * tower down.
 */
export function parseHoarderRoomCheckpoint(
  value: unknown,
): HoarderRoomCheckpoint | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (value.toppled === undefined) return { toppled: [] };
  if (!Array.isArray(value.toppled)) return undefined;
  const toppled: ToppledTower[] = [];
  for (const entry of value.toppled) {
    const parsed = parseToppled(entry);
    if (parsed === undefined) return undefined;
    toppled.push(parsed);
  }
  return { toppled };
}
