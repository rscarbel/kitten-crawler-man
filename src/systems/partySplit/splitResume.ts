import {
  liveGroupOf,
  withGroupAt,
  type InteriorPartyLocation,
  type PartyFormation,
  type PartyLocation,
  type PartySplitState,
} from '../../core/party/partySplit';
import type { BuildingId } from '../../map/buildingIds';

/**
 * The building a save written for `at` records as `SavedWorld.savedIndoorsIn`,
 * or null for a save written outdoors, which resumes on its own tile.
 */
export function savedIndoorsInFor(at: PartyLocation): BuildingId | null {
  switch (at.kind) {
    case 'overworld':
      return null;
    case 'interior':
      return at.building;
    default: {
      const unreachable: never = at;
      return unreachable;
    }
  }
}

/**
 * A save is about to be written for the live group standing at `at`: the
 * split records it there first, so the formation the save holds names the
 * place the save was written, wherever the group has walked since its chapter
 * opened. Nothing while the party is together.
 */
export function recordLiveGroupForSave(state: PartySplitState, at: PartyLocation): void {
  const formation = state.formation;
  if (formation.kind !== 'split') return;
  state.formation = withGroupAt(formation, formation.live, at);
}

/**
 * Where a restored party belongs, or null where the save's own resume tile is
 * the answer. A save written outdoors resumes where it was written, split or
 * not. One written inside `savedIndoorsIn` resumes inside it when something
 * can stand the building up again: a split's live group where the save
 * recorded it, or, for a party together, `indoorsResume`, the place a
 * questline names for the building as the save left it.
 */
export function resumeLocationFor(
  formation: PartyFormation,
  savedIndoorsIn: BuildingId | null,
  indoorsResume: InteriorPartyLocation | null,
): InteriorPartyLocation | null {
  if (savedIndoorsIn === null) return null;
  const indoors = formation.kind === 'split' ? liveGroupOf(formation).at : indoorsResume;
  if (indoors?.kind !== 'interior') return null;
  return indoors.building === savedIndoorsIn ? indoors : null;
}
