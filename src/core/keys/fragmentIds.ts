/**
 * Every key fragment's id, with the floor and the key it belongs to.
 *
 * Apart from `FLOOR_KEYS` (`floorKeys.ts`), which holds each fragment's words,
 * so that a save's key ring can be checked without loading any dialog.
 * `defineFloorKeys` holds that table to exactly these ids, each listed under
 * the floor and the key named here.
 */

import { LEVEL_IDS, type LevelId } from '../../levels/levelIds';
import { keptAcrossFloors, type KeyKind } from './keyKinds';

/** Where a fragment belongs: the floor whose key it is a piece of, and the kind of key. */
interface FragmentHome {
  readonly levelId: LevelId;
  readonly kind: KeyKind;
}

export const FRAGMENT_HOMES = {
  tutorial_dave_first: { levelId: 'tutorial', kind: 'golden' },
  tutorial_dave_farewell: { levelId: 'tutorial', kind: 'golden' },
  level1_trash_gremlin: { levelId: 'level1', kind: 'golden' },
  level1_kraken: { levelId: 'level1', kind: 'golden' },
  level2_electric_goblin: { levelId: 'level2', kind: 'golden' },
  level2_big_rooster: { levelId: 'level2', kind: 'golden' },
  level3_briar_hollow_plea: { levelId: 'level3', kind: 'golden' },
  level3_missing_cats: { levelId: 'level3', kind: 'golden' },
  level3_anchor_shards: { levelId: 'level3', kind: 'golden' },
} as const satisfies Record<string, FragmentHome>;

export type FragmentId = keyof typeof FRAGMENT_HOMES;

/** The fragments homed on `Level` in a key of `Kind`. */
export type FragmentIdOn<Level extends LevelId, Kind extends KeyKind> = {
  [Id in FragmentId]: (typeof FRAGMENT_HOMES)[Id] extends { levelId: Level; kind: Kind }
    ? Id
    : never;
}[FragmentId];

function homeKey(levelId: LevelId, kind: KeyKind): string {
  return `${levelId}/${kind}`;
}

const FRAGMENT_IDS_BY_HOME: ReadonlyMap<string, readonly FragmentId[]> = Object.keys(FRAGMENT_HOMES)
  .filter(isFragmentId)
  .reduce((byHome, id) => {
    const home = FRAGMENT_HOMES[id];
    const key = homeKey(home.levelId, home.kind);
    byHome.set(key, [...(byHome.get(key) ?? []), id]);
    return byHome;
  }, new Map<string, FragmentId[]>());

export function isFragmentId(value: unknown): value is FragmentId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FRAGMENT_HOMES, value);
}

export function fragmentHome(id: FragmentId): FragmentHome {
  return FRAGMENT_HOMES[id];
}

function fragmentIdsOf(levelId: LevelId, kind: KeyKind): readonly FragmentId[] {
  return FRAGMENT_IDS_BY_HOME.get(homeKey(levelId, kind)) ?? [];
}

/**
 * Every piece of the `kind` key a ring on `ringLevel` is gathering: that
 * floor's pieces for a key left behind at the stairs, and every floor's
 * pieces up to this one for a key the party keeps from floor to floor.
 */
export function fragmentsOfKey(kind: KeyKind, ringLevel: LevelId): readonly FragmentId[] {
  if (!keptAcrossFloors(kind)) return fragmentIdsOf(ringLevel, kind);
  const floorsSoFar = LEVEL_IDS.slice(0, LEVEL_IDS.indexOf(ringLevel) + 1);
  return floorsSoFar.flatMap((levelId) => fragmentIdsOf(levelId, kind));
}
