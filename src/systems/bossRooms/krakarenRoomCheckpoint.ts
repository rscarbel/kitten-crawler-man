import { isRecord } from '../../core/guards';

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
  // A save from before the lab had state of its own: an untouched lab.
  if (value.brokenVats === undefined && value.deadJunctions === undefined) {
    return { brokenVats: [], deadJunctions: [], defeated: false };
  }
  if (brokenVats === undefined || deadJunctions === undefined) return undefined;
  const defeated = value.defeated === true;
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
