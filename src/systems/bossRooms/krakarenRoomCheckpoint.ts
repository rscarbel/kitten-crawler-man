import { isRecord } from '../../core/util/guards';

/** What the Krakaren clone lab has to put back after a death. */
export interface KrakarenRoomCheckpoint {
  /** Indices of the vats that had burst, in layout order. */
  readonly brokenVats: readonly number[];
  /** Indices of the live puddles whose junction box was smashed. */
  readonly deadJunctions: readonly number[];
  readonly defeated: boolean;
}

/** Reads a saved lab checkpoint back from untrusted JSON. */
export function parseKrakarenRoomCheckpoint(
  value: unknown,
): KrakarenRoomCheckpoint | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const brokenVats = parseIndexList(value.brokenVats);
  const deadJunctions = parseIndexList(value.deadJunctions);
  const { defeated } = value;
  if (brokenVats === undefined || deadJunctions === undefined) return undefined;
  if (typeof defeated !== 'boolean') return undefined;
  return { brokenVats, deadJunctions, defeated };
}

function parseIndexList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0) return undefined;
    list.push(entry);
  }
  return list;
}
