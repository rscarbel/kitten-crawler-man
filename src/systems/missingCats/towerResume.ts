/**
 * Where the tower takes the party back to after a reload or a death, once
 * the party is whole again inside it. The tower's front door never opens, so
 * a save written in the tower would otherwise leave the party on the street
 * with the drain and the sewer between it and where it was. Every storey is
 * built from the questline's phase alone, so the phase is enough to know
 * which storey to stand the party on.
 *
 * The scene asks this only for a save written inside the tower; a save
 * written outdoors resumes outdoors whatever the phase. While the party is
 * split the live group's place answers instead, and nothing here is asked.
 */

import type { InteriorPartyLocation } from '../../core/party/partySplit';
import type { MissingCatsProgress } from '../../core/quests/missingCatsProgress';
import { towerStairLocation } from './missingCatsSplit';

/** Where the party is set down together once the split is over: the head of the kitchen stair. */
export const REUNION_LOCATION = towerStairLocation('bell_storey', 'stairDown');

/**
 * The foot of the cattery stair, on the archive: the Warden's fight is one
 * flight up, behind the stair's are-you-ready question.
 */
const CATTERY_APPROACH = towerStairLocation('archive', 'stairUp');

/** The cattery's own landing, where the party stands once the Warden is gone. */
const CATTERY_LANDING = towerStairLocation('cattery', 'stairDown');

/**
 * Where a save written inside the tower resumes, or null where the tower has
 * nothing to take the party back to and the save resumes at its door.
 *
 * - `bell_storey` with the counterweight down: the reunion's landing, where
 *   the reunion is still owed.
 * - `ascent`: the same landing, where the climb together starts.
 * - `ritual`: the foot of the cattery stair, so a death in the fight replays
 *   it from the stair up rather than from the drain.
 * - `aftermath`: the cattery, where the Warden fell.
 */
export function missingCatsTowerResume(
  progress: Pick<MissingCatsProgress, 'phase' | 'portcullisRaised'>,
): InteriorPartyLocation | null {
  switch (progress.phase) {
    case 'bell_storey':
      return progress.portcullisRaised ? REUNION_LOCATION : null;
    case 'ascent':
      return REUNION_LOCATION;
    case 'ritual':
      return CATTERY_APPROACH;
    case 'aftermath':
      return CATTERY_LANDING;
    case 'not_started':
    case 'posters_up':
    case 'investigating':
    case 'blame':
    case 'stakeout':
    case 'chase':
    case 'confession':
    case 'choice':
    case 'bait':
    case 'captured':
    case 'cattery':
    case 'seeking_entry':
    case 'sewer':
    case 'cistern':
    case 'archive':
    case 'gatehouse':
    case 'complete':
      return null;
    default: {
      const unhandled: never = progress.phase;
      throw new Error(`no tower resume for ${String(unhandled)}`);
    }
  }
}
