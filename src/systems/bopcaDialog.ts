/**
 * The Bopca's dishes, its attendants' names, and its choice-row labels.
 *
 * Canon anchored in the source material: they are genuinely good cooks and proud
 * of it, they never wash their hands, they get a physical newsletter rather than
 * the newsfeed, and they may discuss safe rooms but not the Dungeon at large.
 *
 * Everything a Bopca actually says lives in `dialog/scripts/bopca.ts` instead —
 * this module is what a script or a system needs that is not itself a line of
 * dialog.
 */

import type { DishVisual } from '../sprites/safeRoomCounter';

/**
 * A table that is provably non-empty, so indexing into it yields the element
 * type and never `undefined` — enforced by the type rather than by a `??` at
 * every call site.
 */
type NonEmptyTable<T> = readonly [T, ...T[]];
type LineTable = NonEmptyTable<string>;

export type DishId =
  | 'moss_broth_stew'
  | 'root_and_bone_soup'
  | 'grub_skewers'
  | 'hard_yellow_cheese'
  | 'black_bread_and_dripping'
  | 'spiced_gruel'
  | 'fried_cave_fish'
  | 'honeyed_tubers'
  | 'pickled_eggs'
  | 'mushroom_hash'
  | 'green_aspic'
  | 'yesterdays_stew';

/** How a dish is eaten, which decides what the crawler sounds like eating it. */
export type DishEating = 'slurp' | 'chew';

export interface DishDef {
  /** How the Bopca names it, dropped into the serving line. */
  name: string;
  visual: DishVisual;
  /**
   * Stated per dish rather than read off the vessel: a bowl can hold pickled
   * eggs, and a mug can hold stew.
   */
  eating: DishEating;
}

/**
 * The dish table. Every dish heals the same amount — the variety is entirely
 * flavour, so a player can never feel they rolled a bad meal.
 *
 * Structured as a `Record<DishId, DishDef>` mirroring `ITEM_DEF`, which is also
 * what makes the union exhaustive: adding a `DishId` without a definition is a
 * compile error.
 */
export const DISH_DEF: Record<DishId, DishDef> = {
  moss_broth_stew: {
    name: 'moss-broth stew',
    eating: 'slurp',
    visual: {
      shape: 'bowl',
      vesselColor: '#e0d7c0',
      contentColor: '#5f7a3c',
      garnishColor: '#9fc46a',
    },
  },
  root_and_bone_soup: {
    name: 'root-and-bone soup',
    eating: 'slurp',
    visual: {
      shape: 'bowl',
      vesselColor: '#d8cdb4',
      contentColor: '#9a6a34',
      garnishColor: '#e2d2a8',
    },
  },
  grub_skewers: {
    name: 'grub skewers',
    eating: 'chew',
    visual: { shape: 'skewer', vesselColor: '#c9a86a', contentColor: '#c8a2a8' },
  },
  hard_yellow_cheese: {
    name: 'a wedge of hard yellow cheese',
    eating: 'chew',
    visual: { shape: 'wedge', vesselColor: '#8a6a42', contentColor: '#e0b743' },
  },
  black_bread_and_dripping: {
    name: 'black bread with dripping',
    eating: 'chew',
    visual: {
      shape: 'plate',
      vesselColor: '#cfc4ab',
      contentColor: '#4a3524',
      garnishColor: '#e8c877',
    },
  },
  spiced_gruel: {
    name: 'spiced gruel',
    eating: 'slurp',
    visual: { shape: 'bowl', vesselColor: '#dcd2bb', contentColor: '#c2a06a' },
  },
  fried_cave_fish: {
    name: 'fried cave-fish',
    eating: 'chew',
    visual: {
      shape: 'plate',
      vesselColor: '#d4cbb6',
      contentColor: '#c88a48',
      garnishColor: '#7fa356',
    },
  },
  honeyed_tubers: {
    name: 'honeyed tubers',
    eating: 'chew',
    visual: {
      shape: 'plate',
      vesselColor: '#cfc0a2',
      contentColor: '#d59a3a',
      garnishColor: '#f0d68a',
    },
  },
  pickled_eggs: {
    name: 'pickled eggs',
    eating: 'chew',
    visual: { shape: 'bowl', vesselColor: '#c8cfc4', contentColor: '#eee4c8' },
  },
  mushroom_hash: {
    name: 'mushroom hash',
    eating: 'chew',
    visual: {
      shape: 'plate',
      vesselColor: '#d2c8b2',
      contentColor: '#7a5a3e',
      garnishColor: '#a8b878',
    },
  },
  green_aspic: {
    name: 'a wobbling green aspic',
    eating: 'chew',
    visual: { shape: 'plate', vesselColor: '#d6d0bc', contentColor: '#7fae62' },
  },
  yesterdays_stew: {
    name: "yesterday's stew, but better",
    eating: 'slurp',
    visual: {
      shape: 'mug',
      vesselColor: '#b8916a',
      contentColor: '#6a4c2e',
    },
  },
};

const ALL_DISH_IDS: ReadonlyArray<DishId> = Object.keys(DISH_DEF).filter(isDishId);

function isDishId(candidate: string): candidate is DishId {
  return candidate in DISH_DEF;
}

/**
 * The names a safe room's attendant can be called, picked by room index.
 *
 * Cheap, and the single change that stops the Bopca reading as one repeated prop:
 * the attendant on floor two is Molvo, and Molvo is not Grennick.
 */
const BOPCA_NAMES: LineTable = [
  'Grennick',
  'Molvo',
  'Hessup',
  'Brannick',
  'Tolm',
  'Ospreth',
  'Durvo',
  'Grask',
  'Yennil',
  'Mubb',
];

/** The attendant's name for a given safe room, stable across visits. */
export function bopcaNameForRoom(roomIndex: number): string {
  return BOPCA_NAMES[Math.abs(Math.trunc(roomIndex)) % BOPCA_NAMES.length];
}

/** A dish at random. Every dish heals the same, so there is no weighting to do. */
export function randomDishId(): DishId {
  return ALL_DISH_IDS[Math.floor(Math.random() * ALL_DISH_IDS.length)];
}

/** Labels for the choices offered under the dialog box. */
export const BOPCA_CHOICE_LABELS = {
  askForFood: 'Ask for food',
  takeDish: 'Take the dish',
  leave: 'Leave',
} as const;

/** Topics the chat choice cycles through, so a second question gets a new answer. */
export const CHAT_TOPIC_ORDER = ['aboutSafeRoom', 'aboutSelf', 'aboutDungeon'] as const;

export type ChatTopic = (typeof CHAT_TOPIC_ORDER)[number];

/**
 * What the chat button says for each topic.
 *
 * The button carries the question, because nothing else on screen does: a single
 * `Just chatting` button left the player reading an answer with no idea what had
 * been asked, which is the whole reason the chat lines read as non-sequiturs.
 */
export const CHAT_TOPIC_LABELS: Record<ChatTopic, string> = {
  aboutSafeRoom: 'Ask about this room',
  aboutSelf: 'Ask about Bopcas',
  aboutDungeon: 'Ask about the Dungeon',
};
