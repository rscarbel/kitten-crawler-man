/**
 * Each floor's keys: which kinds of key the floor holds, the fragments each is
 * broken into, and where every fragment comes from.
 *
 * A key's fragment count is its `fragments.length` and is held nowhere else:
 * the menu, the ceremonies, the floor intro and Caroline's arrival lines all
 * read it from here.
 */

import { carolineLines, type CarolineMessage } from '../../dialog/caroline';
import { LEVEL_IDS, type LevelId } from '../../levels/levelIds';
import type { GauntletBossType } from '../../map/bossRoomSizes';
import type { StoryBeatId } from '../../story/storyBeatIds';
import type { QuestId } from '../quests/QuestManager';
import type { FragmentId, FragmentIdOn } from './fragmentIds';
import { keyKindDef, opensStairwells, type KeyKind } from './keyKinds';

/**
 * Where a fragment comes from. Every consumer switches over `kind` and ends in
 * a `never` check, so a new source lists every site that must handle it.
 */
export type FragmentSource =
  /** Issued when this story beat's conversation ends. */
  | { readonly kind: 'storyBeat'; readonly beat: StoryBeatId }
  /** Issued when this boss dies. */
  | { readonly kind: 'bossDefeated'; readonly boss: GauntletBossType }
  /**
   * Issued when this quest completes, or, on the first build of the floor's
   * ring, for a completion the run carried in with it.
   */
  | { readonly kind: 'questCompleted'; readonly questId: QuestId };

export type FragmentSourceKind = FragmentSource['kind'];

/** One piece of a key. */
export interface FragmentDef<Id extends FragmentId = FragmentId> {
  readonly id: Id;
  /** Its on-screen name. */
  readonly name: string;
  readonly source: FragmentSource;
  /** Caroline's sentence when the fragment is issued. */
  readonly issueLine: CarolineMessage;
  /**
   * Caroline's sentence when the fragment is issued for a deed the run carried
   * in from before (see {@link FragmentSource}); `issueLine` when absent.
   */
  readonly carriedIssueLine?: CarolineMessage;
  /**
   * What the key ring shows while the fragment is missing. Names the kind of
   * deed, never a place or a bearing: Dave never knows where bosses are, and
   * Caroline gives bearings only in safe rooms.
   */
  readonly hint: string;
}

/** One key a floor holds and the fragments it is broken into, in the table's order. */
export interface FloorKey<Kind extends KeyKind = KeyKind, Id extends FragmentId = FragmentId> {
  readonly kind: Kind;
  readonly fragments: readonly FragmentDef<Id>[];
}

/** The keys a floor holds. Every floor holds at least one, so every floor can be left. */
type FloorKeySet = readonly [FloorKey, ...FloorKey[]];

type SourceKey<Source> = Source extends { kind: 'storyBeat'; beat: infer Beat extends string }
  ? `storyBeat:${Beat}`
  : Source extends { kind: 'bossDefeated'; boss: infer Boss extends string }
    ? `bossDefeated:${Boss}`
    : Source extends { kind: 'questCompleted'; questId: infer Quest extends string }
      ? `questCompleted:${Quest}`
      : never;

type FragmentsIn<Keys extends Record<LevelId, FloorKeySet>> =
  Keys[LevelId][number]['fragments'][number];

type MisplacedFragments<Keys extends Record<LevelId, FloorKeySet>> = {
  [Level in LevelId]: Keys[Level][number] extends infer Key
    ? Key extends { kind: infer Kind extends KeyKind; fragments: readonly (infer Def)[] }
      ? Def extends { id: infer Id }
        ? Id extends FragmentIdOn<Level, Kind>
          ? never
          : Id
        : never
      : never
    : never;
}[LevelId];

type MissingFragments<Keys extends Record<LevelId, FloorKeySet>> = Exclude<
  FragmentId,
  FragmentsIn<Keys>['id']
>;

type SharedSources<Keys extends Record<LevelId, FloorKeySet>> = {
  [Id in FragmentsIn<Keys>['id']]: SourceKey<
    Extract<FragmentsIn<Keys>, { id: Id }>['source']
  > extends SourceKey<
    Extract<FragmentsIn<Keys>, { id: Exclude<FragmentsIn<Keys>['id'], Id> }>['source']
  >
    ? Id
    : never;
}[FragmentsIn<Keys>['id']];

type FloorKeysProblems<Keys extends Record<LevelId, FloorKeySet>> = [
  MisplacedFragments<Keys>,
] extends [never]
  ? [MissingFragments<Keys>] extends [never]
    ? [SharedSources<Keys>] extends [never]
      ? unknown
      : { readonly fragmentsSharingASource: SharedSources<Keys> }
    : { readonly fragmentsMissingFromTheTable: MissingFragments<Keys> }
  : { readonly fragmentsUnderTheWrongFloorOrKey: MisplacedFragments<Keys> };

function sourceKeyOf(source: FragmentSource): string {
  switch (source.kind) {
    case 'storyBeat':
      return `storyBeat:${source.beat}`;
    case 'bossDefeated':
      return `bossDefeated:${source.boss}`;
    case 'questCompleted':
      return `questCompleted:${source.questId}`;
    default: {
      const unhandled: never = source;
      return unhandled;
    }
  }
}

/**
 * Checks the floors' key table at compile time: every fragment sits under the
 * floor and key its id is homed at in `FRAGMENT_HOMES`, every fragment id is
 * listed, and no two fragments share a source. Rejects a fragment id listed
 * twice when the module loads. Returns the table unchanged, with its literal
 * types.
 */
function defineFloorKeys<const Keys extends Record<LevelId, FloorKeySet>>(
  keys: Keys & FloorKeysProblems<Keys>,
): Keys {
  const seenIds = new Set<string>();
  const seenSources = new Set<string>();
  for (const set of Object.values<FloorKeySet>(keys)) {
    for (const key of set) {
      for (const fragment of key.fragments) {
        const sourceKey = sourceKeyOf(fragment.source);
        if (seenIds.has(fragment.id)) throw new Error(`Fragment ${fragment.id} is listed twice`);
        if (seenSources.has(sourceKey)) throw new Error(`Two fragments come from ${sourceKey}`);
        seenIds.add(fragment.id);
        seenSources.add(sourceKey);
      }
    }
    if (!set.some((key) => opensStairwells(key.kind))) {
      throw new Error('A floor holds no key that opens its stairwells');
    }
  }
  return keys;
}

const GUARDIAN_HINT = 'Held by a guardian on this floor.';

export const FLOOR_KEYS = defineFloorKeys({
  tutorial: [
    {
      kind: 'golden',
      fragments: [
        {
          id: 'tutorial_dave_first',
          name: 'The Cellar Fragment',
          source: { kind: 'storyBeat', beat: 'tutorial_meets_dave' },
          issueLine: carolineLines.message(
            'Fragment issued. Dave is authorised to hand it to you. He has carried my keys before.',
          ),
          hint: 'Dave hands it over the first time you meet him.',
        },
        {
          id: 'tutorial_dave_farewell',
          name: 'The Reunion Fragment',
          source: { kind: 'storyBeat', beat: 'tutorial_dave_farewell' },
          issueLine: carolineLines.message(
            'Fragment issued. Both crawlers are accounted for. The party is complete.',
          ),
          hint: 'Dave hands it over once your partner is with you.',
        },
      ],
    },
  ],
  level1: [
    {
      kind: 'golden',
      fragments: [
        {
          id: 'level1_trash_gremlin',
          name: "The Gremlin's Tooth",
          source: { kind: 'bossDefeated', boss: 'trash_gremlin' },
          issueLine: carolineLines.message(
            'Guardian terminated. The Trash Gremlin held this fragment. It is issued to your party.',
          ),
          hint: GUARDIAN_HINT,
        },
        {
          id: 'level1_kraken',
          name: 'The Drowned Fragment',
          source: { kind: 'bossDefeated', boss: 'kraken' },
          issueLine: carolineLines.message(
            'Guardian terminated. The Kraken held this fragment beneath the water. It is issued to your party.',
          ),
          hint: GUARDIAN_HINT,
        },
      ],
    },
  ],
  level2: [
    {
      kind: 'golden',
      fragments: [
        {
          id: 'level2_electric_goblin',
          name: 'The Charged Fragment',
          source: { kind: 'bossDefeated', boss: 'electric_goblin' },
          issueLine: carolineLines.message(
            'Guardian terminated. The Current Goblin held this fragment. Residual charge is within tolerance. It is issued to your party.',
          ),
          hint: GUARDIAN_HINT,
        },
        {
          id: 'level2_big_rooster',
          name: "The Rooster's Spur",
          source: { kind: 'bossDefeated', boss: 'big_rooster' },
          issueLine: carolineLines.message(
            'Guardian terminated. Big Rooster held this fragment. It is issued to your party.',
          ),
          hint: GUARDIAN_HINT,
        },
      ],
    },
  ],
  level3: [
    {
      kind: 'golden',
      fragments: [
        {
          id: 'level3_briar_hollow_plea',
          name: 'The Briar Fragment',
          source: { kind: 'questCompleted', questId: 'briar_hollow_plea' },
          issueLine: carolineLines.message(
            "Briar Hollow stands. The village's request is closed. Its fragment is issued to your party.",
          ),
          hint: "Earned by answering Briar Hollow's plea.",
        },
        {
          id: 'level3_missing_cats',
          name: 'The Homecoming Fragment',
          source: { kind: 'questCompleted', questId: 'taloncrest_missing_cats' },
          issueLine: carolineLines.message(
            "Taloncrest's cats are accounted for. The request is closed. Its fragment is issued to your party.",
          ),
          hint: "Earned by bringing Taloncrest's missing cats home.",
        },
        {
          id: 'level3_anchor_shards',
          name: "The Wayfinder's Fragment",
          source: { kind: 'questCompleted', questId: 'anchor_shards' },
          issueLine: carolineLines.message(
            'The anchor is whole. The request is closed. Its fragment is issued to your party.',
          ),
          carriedIssueLine: carolineLines.message(
            'The anchor recognises this floor. Its fragment is issued.',
          ),
          hint: "Earned by mending the Wayfinder's Anchor.",
        },
      ],
    },
  ],
});

/**
 * A fragment as the table lists it: every field a {@link FragmentDef} has,
 * with its source's literal ids kept.
 */
export type FloorFragmentDef = (typeof FLOOR_KEYS)[LevelId][number]['fragments'][number] &
  FragmentDef;

/** A key as the table lists it: its fragments keep their sources' literal ids. */
export interface TableFloorKey extends FloorKey {
  readonly fragments: readonly FloorFragmentDef[];
}

/** The keys `levelId` holds, in the table's order. */
export function floorKeysFor(levelId: LevelId): readonly [TableFloorKey, ...TableFloorKey[]] {
  return FLOOR_KEYS[levelId];
}

/** The key that opens `levelId`'s stairwells; the table refuses to load without one on every floor. */
export function stairwellKey(levelId: LevelId): TableFloorKey {
  const keys = floorKeysFor(levelId);
  return keys.find((key) => opensStairwells(key.kind)) ?? keys[0];
}

/** The on-screen name of the key that opens `levelId`'s stairwells. */
export function stairwellKeyName(levelId: LevelId): string {
  return keyKindDef(stairwellKey(levelId).kind).name;
}

/** The key of `kind` on `levelId`, or null for a floor that holds none of that kind. */
export function floorKey(levelId: LevelId, kind: KeyKind): TableFloorKey | null {
  const byKind = new Map(floorKeysFor(levelId).map((key) => [key.kind, key]));
  return byKind.get(kind) ?? null;
}

/** Every fragment of every key on `levelId`. */
export function fragmentsOnFloor(levelId: LevelId): readonly FloorFragmentDef[] {
  return floorKeysFor(levelId).flatMap((key) => key.fragments);
}

const FRAGMENT_DEFS: ReadonlyMap<FragmentId, FloorFragmentDef> = new Map(
  LEVEL_IDS.flatMap((levelId) => fragmentsOnFloor(levelId)).map((fragment) => [
    fragment.id,
    fragment,
  ]),
);

export function fragmentDef(id: FragmentId): FloorFragmentDef {
  const def = FRAGMENT_DEFS.get(id);
  if (def === undefined) throw new Error(`Fragment ${id} is in no floor's keys`);
  return def;
}

/** Every source some fragment in the table is issued for, with its literal ids. */
export type FloorKeySource = (typeof FLOOR_KEYS)[LevelId][number]['fragments'][number]['source'];

/** The quests whose completion issues some fragment. */
export type FragmentQuestId = Extract<FloorKeySource, { kind: 'questCompleted' }>['questId'];

/** The line Caroline issues a fragment with, for a live deed or one carried into the run. */
export function issueLineFor(fragment: FragmentDef, award: FragmentAward): CarolineMessage {
  switch (award) {
    case 'live':
      return fragment.issueLine;
    case 'carriedIn':
      return fragment.carriedIssueLine ?? fragment.issueLine;
    default: {
      const unhandled: never = award;
      return unhandled;
    }
  }
}

/**
 * Why a fragment is being issued with a ceremony: a deed done now, or a deed
 * the run carried in from before, recognised on the floor's first build.
 */
export type FragmentAward = 'live' | 'carriedIn';
