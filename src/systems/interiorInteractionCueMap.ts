/**
 * Which interior cue each examine, use, search and readable raises.
 */

import type { InteriorCue } from '../audio/interiorInteractionSoundCues';
import type {
  TownInteriorExamineId,
  TownInteriorDialogInteraction,
  TownInteriorSearchId,
  TownInteriorUseId,
} from '../sprites/art/townInterior/townInteriorProps';
import type { ReadableMedium } from './townReadables';
import type { InteriorInteractionOutcome } from './InteriorPropInteractionSystem';

/** Examines that read paper or weigh goods; every other examine is the `propNoticed` cue. */
const EXAMINE_CUES: Partial<Record<TownInteriorExamineId, InteriorCue>> = {
  ledger_desk: 'pageTurn',
  merc_desk: 'pageTurn',
  field_log: 'pageTurn',
  lectern: 'pageTurn',
  lodge_duty_board: 'noticeUnfold',
  lodge_map_table: 'noticeUnfold',
  writ_board: 'noticeUnfold',
  scrivener_desk: 'noticeUnfold',
  grain_scale: 'scaleWeigh',
};

const USE_CUES: Record<TownInteriorUseId, InteriorCue> = {
  shop_bell: 'counterBell',
  offering_bowl: 'offeringCoin',
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
  interaction: TownInteriorDialogInteraction,
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
  interaction: TownInteriorDialogInteraction,
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
