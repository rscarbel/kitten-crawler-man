/**
 * What the Journal says to do from the moment Belle is taken until the
 * Warden falls, one step at a time, from whichever crawler is playing. While
 * the party is split each phase belongs to one side, so the phase alone says
 * whose step it is.
 */

import type { MissingCatsProgress } from '../../core/quests/missingCatsProgress';

/**
 * Where a tower step points: the tower, or the shop with the tuna. From the
 * street the way into the tower is the storm drain; inside it a step on the
 * tower leads nowhere else, which is right for every one of them but the tuna.
 */
export type TowerStepPlace = 'tower' | 'store';

export interface TowerStep {
  readonly objective: string;
  readonly hint: string;
  readonly place: TowerStepPlace;
}

/** The phases this answers for, each a chapter of the split or the climb after it. */
export type TowerStepPhase = Extract<
  MissingCatsProgress['phase'],
  'captured' | 'cattery' | 'cistern' | 'archive' | 'gatehouse' | 'bell_storey' | 'ascent' | 'ritual'
>;

/** The step for `phase`; `tunaCarried` says whether either crawler has a tin of tuna in their bag. */
export function towerStep(
  phase: TowerStepPhase,
  progress: Pick<
    MissingCatsProgress,
    | 'crawlerCatUncaged'
    | 'cellmateFreed'
    | 'keyRingSent'
    | 'larderOpened'
    | 'tunaSent'
    | 'portcullisRaised'
  >,
  tunaCarried: boolean,
): TowerStep {
  switch (phase) {
    case 'captured':
      return {
        objective: 'Belle is being carried to the tower',
        hint: 'The Warden saw the plan coming.',
        place: 'tower',
      };
    case 'cattery':
      if (!progress.crawlerCatUncaged) {
        return {
          objective: "Work Belle's cage latch open",
          hint: "Jostle it while the keeper's back is turned.",
          place: 'tower',
        };
      }
      if (!progress.cellmateFreed) {
        return {
          objective: 'Let out the cat in the next cage',
          hint: 'She has opened these latches before.',
          place: 'tower',
        };
      }
      return {
        objective: 'Free the town cats, then take the stairs down',
        hint: 'Every cat you let out now is one the Warden cannot use later.',
        place: 'tower',
      };
    case 'cistern':
      return {
        objective: 'Close the sluice gate in the cistern',
        hint: 'Glowing water runs from it up to the magic wards on the floors above.',
        place: 'tower',
      };
    case 'archive':
      return progress.keyRingSent
        ? {
            objective: "Take the archive's stair down to the bell storey",
            hint: 'Cross while the wards are dark.',
            place: 'tower',
          }
        : {
            objective: 'Knock the key ring into the dumbwaiter',
            hint: 'Only Belle can see the wards. Knock things off shelves to make a noise and lure the wardens away.',
            place: 'tower',
          };
    case 'gatehouse':
      if (!progress.larderOpened) {
        return {
          objective: 'Get past the gatehouse guards and open the larder',
          hint: "The key ring is in the kitchen's dumbwaiter. The guards won't hurt you, but they will walk you back out.",
          place: 'tower',
        };
      }
      if (!progress.tunaSent && !tunaCarried) {
        return {
          objective: 'Buy a tin of tuna at the General Store',
          hint: 'The note in the dumbwaiter smells of fish. Whoever sent it wants tuna.',
          place: 'store',
        };
      }
      return {
        objective: 'Send the tuna up the dumbwaiter',
        hint: 'Whoever sent the note is holding the portcullis shut from above.',
        place: 'tower',
      };
    case 'bell_storey':
      return progress.portcullisRaised
        ? {
            objective: 'Climb through the raised portcullis to the bell storey',
            hint: 'Belle is waiting at the top of the kitchen stair.',
            place: 'tower',
          }
        : {
            objective: 'Hold both counterweight plates at once',
            hint: 'The bells swing to the beat. Cross the beams between swings. Pumpkin will sit on the other plate.',
            place: 'tower',
          };
    case 'ascent':
      return {
        objective: 'Climb to the top of the tower together',
        hint: 'Belle can see the moving wards. Break the glowing stones she finds.',
        place: 'tower',
      };
    case 'ritual':
      return {
        objective: 'Stop the Warden at the top of the tower',
        hint: 'Belle frees the cats at the pillars while you hold the Warden off.',
        place: 'tower',
      };
    default: {
      const unhandled: never = phase;
      throw new Error(`no tower step for ${String(unhandled)}`);
    }
  }
}
