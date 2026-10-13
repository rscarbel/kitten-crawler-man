/**
 * The Over City interiors' interactables — shop counters and doors, readables,
 * searchable containers and the props a crawler can use — by what they mean
 * rather than by file.
 *
 * Every play site raises a cue from {@link INTERIOR_CUES}, never a raw id, so
 * a new recording is its registration in `src/audio/sounds.ts` plus one line
 * here. A cue with several takes plays a fresh one each time, never the take
 * it played last.
 *
 * Every id here is preloaded through the `interiorInteractions` group in
 * `src/audio/sfxGroups.ts`, which every building interior loads.
 * `AudioManager.play` returns silently on a buffer that was never preloaded.
 */

import type { AudioManager } from '../audio/AudioManager';
import type { SoundId } from '../audio/sounds';
import type {
  TownInteriorExamineId,
  TownInteriorInteraction,
  TownInteriorSearchId,
  TownInteriorUseId,
} from '../sprites/art/townInterior/townInteriorProps';
import type { ReadableMedium } from './townReadables';
import type { InteriorInteractionOutcome } from './InteriorPropInteractionSystem';

export const INTERIOR_CUES = {
  /** Looking at, or using, a prop with no sound of its own. */
  propNoticed: ['menu_open'],
  /** The bell over the General Store's door as the party walks in. */
  shopDoorBell: ['shop_door_bell_1', 'shop_door_bell_2'],
  /** The brass service bell on a shop counter. */
  counterBell: ['shop_counter_bell'],
  /** The keeper's till taking or paying out coin over a counter. */
  tillDrawer: ['till_drawer_open'],
  /** Goods weighed on a counter or farm scale. */
  scaleWeigh: ['merchant_scale_weigh'],
  /** A bound ledger or book opened to read. */
  pageTurn: [
    'ledger_page_turn_1',
    'ledger_page_turn_2',
    'ledger_page_turn_3',
    'ledger_page_turn_4',
  ],
  /** A loose letter, notice or map unfolded to read. */
  noticeUnfold: [
    'paper_notice_unfold_1',
    'paper_notice_unfold_2',
    'paper_notice_unfold_3',
    'paper_notice_unfold_4',
  ],
  /** A desk drawer or cabinet pulled open to search. */
  drawerOpen: ['drawer_open_wood'],
  /** The same drawer pushed shut as its line is put away. */
  drawerClose: ['drawer_close_wood'],
  /** Hands through a crate or chest of odds and ends. */
  rummageCrate: ['rummage_crate_1', 'rummage_crate_2', 'rummage_crate_3'],
  /** Hands through a coat's pockets. */
  rummageCloth: ['rummage_cloth'],
  /** A search that turned up nothing. */
  searchEmpty: ['search_empty'],
  /** A coin laid in the temple's offering bowl, or a blessing paid for. */
  offeringCoin: ['offering_coin_bowl'],
  /** Sitting down on a bench or stool. */
  benchSit: ['bench_creak_sit'],
  /** A dart into the Sunken Stump's board. */
  dartThunk: ['dartboard_thunk'],
} as const satisfies Record<string, readonly SoundId[]>;

/** Which cue a play site raises. */
export type InteriorCue = keyof typeof INTERIOR_CUES;

/** Plays a fresh take of `cue` through `audio`. Silent for a missing audio manager. */
export function playInteriorCue(
  audio: Pick<AudioManager, 'playRandomFresh'> | null,
  cue: InteriorCue,
): void {
  audio?.playRandomFresh(INTERIOR_CUES[cue]);
}

/**
 * {@link playInteriorCue} for a cue raised as a room opens, which may beat its
 * group's decode: the take waits for its buffer rather than being dropped.
 */
export function playInteriorCueWhenReady(
  audio: Pick<AudioManager, 'playRandomFreshWhenReady'> | null,
  cue: InteriorCue,
): void {
  audio?.playRandomFreshWhenReady(INTERIOR_CUES[cue]);
}

/** Examines that read paper or weigh goods; every other examine is {@link INTERIOR_CUES.propNoticed}. */
const EXAMINE_CUES: Partial<Record<TownInteriorExamineId, InteriorCue>> = {
  ledger_desk: 'pageTurn',
  field_log: 'pageTurn',
  lectern: 'pageTurn',
  petition_counter: 'pageTurn',
  lodge_duty_board: 'noticeUnfold',
  lodge_map_table: 'noticeUnfold',
  writ_board: 'noticeUnfold',
  scrivener_desk: 'noticeUnfold',
  grain_scale: 'scaleWeigh',
};

const USE_CUES: Record<TownInteriorUseId, InteriorCue> = {
  shop_bell: 'counterBell',
  offering_bowl: 'offeringCoin',
  bench_seat: 'benchSit',
  biting_stool: 'benchSit',
  throw_dart: 'dartThunk',
  hearth: 'propNoticed',
  grindstone: 'propNoticed',
  wheelwright_stand: 'propNoticed',
};

/** The sound of getting into a container, before anything is known of what is in it. */
const SEARCH_OPEN_CUES: Record<TownInteriorSearchId, InteriorCue> = {
  chest: 'rummageCrate',
  open_crate: 'rummageCrate',
  coat_hook: 'rummageCloth',
  drawer_unit: 'drawerOpen',
};

/** Containers that have to be shut again once the search's line is dismissed. */
const SEARCH_CLOSE_CUES: Partial<Record<TownInteriorSearchId, InteriorCue>> = {
  drawer_unit: 'drawerClose',
};

/**
 * The cues to play as `interaction` runs. A container already emptied on an
 * earlier search is not opened again — only its emptiness is heard.
 */
export function interiorInteractionCues(
  interaction: TownInteriorInteraction,
  outcome: InteriorInteractionOutcome,
): readonly InteriorCue[] {
  switch (interaction.kind) {
    case 'examine':
      return [EXAMINE_CUES[interaction.id] ?? 'propNoticed'];
    case 'use':
      return [USE_CUES[interaction.id]];
    case 'search': {
      if (outcome === 'already_searched') return ['searchEmpty'];
      const opening = SEARCH_OPEN_CUES[interaction.id];
      return outcome === 'nothing_found' ? [opening, 'searchEmpty'] : [opening];
    }
  }
}

/** The cue to play when the interaction's line is put away, or null when nothing closes. */
export function interiorInteractionClosingCue(
  interaction: TownInteriorInteraction,
  outcome: InteriorInteractionOutcome,
): InteriorCue | null {
  if (interaction.kind !== 'search' || outcome === 'already_searched') return null;
  return SEARCH_CLOSE_CUES[interaction.id] ?? null;
}

const READABLE_CUES: Record<ReadableMedium, InteriorCue> = {
  book: 'pageTurn',
  sheet: 'noticeUnfold',
  board: 'propNoticed',
};

/** The cue for picking up a readable made of `medium`. */
export function readableCue(medium: ReadableMedium): InteriorCue {
  return READABLE_CUES[medium];
}
