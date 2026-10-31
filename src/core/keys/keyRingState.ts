/**
 * The key ring as a save and a checkpoint hold it, and the strict check a
 * stored one must pass. Data only, so the save validator can load it.
 */

import { isLevelId, type LevelId } from '../../levels/levelIds';
import { isRecord } from '../util/guards';
import { fragmentHome, fragmentsOfKey, isFragmentId, type FragmentId } from './fragmentIds';
import { isKeyKind, opensStairwells, type KeyKind } from './keyKinds';

/** A stairwell, named by the top-left tile of its footprint, as `GameMap.stairwellTiles` lists it. */
export interface StairwellTile {
  readonly x: number;
  readonly y: number;
}

/** Everything the party holds of every kind of key, for the floor it is on. */
export interface KeyRingState {
  /** The floor the ring was last begun on. */
  readonly levelId: LevelId;
  /**
   * Whether the key system has been built on this floor before. The first
   * build of a floor's ring is the one moment a fragment can be issued live for
   * a deed done before the party arrived (a quest carried into a new run).
   */
  readonly floorBuilt: boolean;
  /** Fragments held, of every kind, in the order they were claimed. */
  readonly held: readonly FragmentId[];
  /** Kinds whose fragments have fused into the key. */
  readonly forged: readonly KeyKind[];
  /** Stairwells on this floor whose seal has been opened, in the order they were opened. */
  readonly unsealedStairwells: readonly StairwellTile[];
}

/** A ring on `levelId` holding nothing, never built. */
export function emptyKeyRingState(levelId: LevelId): KeyRingState {
  return { levelId, floorBuilt: false, held: [], forged: [], unsealedStairwells: [] };
}

function isTileCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseStairwellTile(value: unknown): StairwellTile | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y } = value;
  if (!isTileCoordinate(x) || !isTileCoordinate(y)) return undefined;
  return { x, y };
}

function parseFragmentIds(value: unknown, levelId: LevelId): FragmentId[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids: FragmentId[] = [];
  for (const entry of value) {
    if (!isFragmentId(entry) || ids.includes(entry)) return undefined;
    if (!fragmentsOfKey(fragmentHome(entry).kind, levelId).includes(entry)) return undefined;
    ids.push(entry);
  }
  return ids;
}

function parseForgedKinds(
  value: unknown,
  levelId: LevelId,
  held: readonly FragmentId[],
): KeyKind[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kinds: KeyKind[] = [];
  for (const entry of value) {
    if (!isKeyKind(entry) || kinds.includes(entry)) return undefined;
    const needed = fragmentsOfKey(entry, levelId);
    const whole = needed.length > 0 && needed.every((id) => held.includes(id));
    if (!whole) return undefined;
    kinds.push(entry);
  }
  return kinds;
}

function parseUnsealedStairwells(
  value: unknown,
  forged: readonly KeyKind[],
): StairwellTile[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length > 0 && !forged.some(opensStairwells)) return undefined;
  const tiles: StairwellTile[] = [];
  for (const entry of value) {
    const tile = parseStairwellTile(entry);
    if (tile === undefined) return undefined;
    if (tiles.some((other) => other.x === tile.x && other.y === tile.y)) return undefined;
    tiles.push(tile);
  }
  return tiles;
}

/**
 * Parses an untrusted stored ring. Rejects an unknown fragment or kind, a
 * fragment held twice or held on a floor its key does not travel to, a key
 * forged without every piece, and a seal opened with no key that opens seals.
 */
export function parseKeyRingState(value: unknown): KeyRingState | undefined {
  if (!isRecord(value)) return undefined;
  const { levelId, floorBuilt } = value;
  if (!isLevelId(levelId) || typeof floorBuilt !== 'boolean') return undefined;
  const held = parseFragmentIds(value.held, levelId);
  if (held === undefined) return undefined;
  const forged = parseForgedKinds(value.forged, levelId, held);
  if (forged === undefined) return undefined;
  const unsealedStairwells = parseUnsealedStairwells(value.unsealedStairwells, forged);
  if (unsealedStairwells === undefined) return undefined;
  return { levelId, floorBuilt, held, forged, unsealedStairwells };
}
