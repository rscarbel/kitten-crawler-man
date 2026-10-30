/**
 * What the Journal says to do from the moment Belle is taken until the
 * Warden falls, one step at a time, from whichever crawler is playing. While
 * the party is split each phase belongs to one side, so the phase alone says
 * whose step it is.
 */

import type { MissingCatsProgress } from '../../core/quests/missingCatsProgress';
import { STORM_DRAIN_ID, TOWN_TOWER_ID, type BuildingId } from '../../map/buildingIds';
import {
  ARCHIVE_KNOCKABLES,
  BELL_STOREY_PLATES,
  RITUAL_CIRCLE_TILE,
  TOWER_CATTERY_CAGES,
  towerStoreyIndex,
  towerStoreyPlan,
  WARD_CONDUIT_SLUICE_TILE,
  type TowerStoreyId,
  type TowerTile,
} from '../../map/town/interiors/townCenterTower';
import type { IndoorLead, TrackerTarget } from '../questTracker';
import { KITCHEN_FITTING_TILES, kitchenStep } from '../tower/kitchenSequence';

/** The General Store, which sells the tuna the tower's cellmate is fed. */
const STORE: BuildingId = 'taloncrest_general_store';

/**
 * Where a tower step is done: a fitting on one of the tower's storeys, or the
 * shop with the tuna.
 */
export type TowerStepPlace =
  | {
      readonly kind: 'tower';
      readonly storey: TowerStoreyId;
      readonly tile: TowerTile;
      readonly lead: IndoorLead;
    }
  | { readonly kind: 'store' };

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

/**
 * What either crawler has in their bag that a step turns on. The kitchen's
 * key ring and note are not here: where they are is the kitchen's own stage.
 */
export interface TowerStepCarried {
  readonly tuna: boolean;
}

function inTower(
  storey: TowerStoreyId,
  tile: TowerTile,
  lead: IndoorLead = 'route',
): TowerStepPlace {
  return { kind: 'tower', storey, tile, lead };
}

/** A storey's stair, for a step whose whole deed is taking it. */
function stairOf(
  storey: TowerStoreyId,
  stair: 'stairUp' | 'stairDown',
  lead: IndoorLead = 'route',
): TowerStepPlace {
  const plan = towerStoreyPlan(storey);
  return inTower(storey, plan[stair] ?? plan.arrival, lead);
}

const STORE_STEP: TowerStepPlace = { kind: 'store' };

/** The step for `phase`, given what either crawler carries. */
export function towerStep(
  phase: TowerStepPhase,
  progress: Pick<
    MissingCatsProgress,
    | 'crawlerCatUncaged'
    | 'cellmateFreed'
    | 'keyRingSent'
    | 'westWardOut'
    | 'kitchen'
    | 'portcullisRaised'
  >,
  carried: TowerStepCarried,
): TowerStep {
  switch (phase) {
    case 'captured':
      return {
        objective: 'Belle is being carried to the tower',
        hint: 'The Warden saw the plan coming.',
        place: inTower('cattery', TOWER_CATTERY_CAGES.crawler_cat),
      };
    case 'cattery':
      if (!progress.crawlerCatUncaged) {
        return {
          objective: "Work Belle's cage latch open",
          hint: "Jostle it while the keeper's back is turned. If it sees you out of your cage, it shuts you back in.",
          place: inTower('cattery', TOWER_CATTERY_CAGES.crawler_cat),
        };
      }
      if (!progress.cellmateFreed) {
        return {
          objective: 'Let Pumpkin out of the next cage',
          hint: 'Her claws are clipped, so the latch is yours to work. Wait behind the stores while the keeper looks.',
          place: inTower('cattery', TOWER_CATTERY_CAGES.tower_cattery_cellmate),
        };
      }
      return {
        objective: 'Free the town cats, then take the stairs down',
        hint: 'Every cat you let out now is one the Warden cannot use later.',
        place: stairOf('cattery', 'stairDown'),
      };
    case 'cistern':
      return {
        objective: 'Close the sluice gate in the cistern',
        hint: 'Glowing water runs from it up to the magic wards on the floors above.',
        place: inTower('cistern', WARD_CONDUIT_SLUICE_TILE),
      };
    case 'archive':
      return archiveStep(progress);
    case 'gatehouse':
      return gatehouseStep(progress, carried);
    case 'bell_storey':
      return progress.portcullisRaised
        ? {
            objective: 'Climb through the raised portcullis to the bell storey',
            hint: 'Belle is waiting at the top of the kitchen stair.',
            place: stairOf('kitchen', 'stairUp'),
          }
        : {
            objective: 'Hold both counterweight plates at once',
            hint: 'The bells swing to the beat. Cross the beams between swings. Pumpkin will sit on the other plate.',
            place: inTower('bell_storey', BELL_STOREY_PLATES.west.at),
          };
    case 'ascent':
      return {
        objective: 'Climb to the top of the tower together',
        hint: 'Belle can see the moving wards. Break the glowing stones she finds.',
        place: stairOf('cattery', 'stairDown'),
      };
    case 'ritual':
      return {
        objective: 'Stop the Warden at the top of the tower',
        hint: 'Belle frees the cats at the pillars while you hold the Warden off.',
        place: inTower('cattery', RITUAL_CIRCLE_TILE),
      };
    default: {
      const unhandled: never = phase;
      throw new Error(`no tower step for ${String(unhandled)}`);
    }
  }
}

/** Belle's archive chapter, from the key ring on its shelf to the stair down past the west ward. */
function archiveStep(
  progress: Pick<MissingCatsProgress, 'keyRingSent' | 'westWardOut'>,
): TowerStep {
  if (!progress.keyRingSent) {
    return {
      objective: 'Knock the key ring into the dumbwaiter',
      hint: "The red lines are wards: cross the doorway one between its burns. Stay out of the floating head's light; it keeps the dumbwaiter, and comes to whatever calls from it.",
      place: inTower('archive', ARCHIVE_KNOCKABLES.key_ring.at),
    };
  }
  if (!progress.westWardOut) {
    return {
      objective: "Take the archive's stair down to the bell storey",
      hint: 'The red ward by the stair goes out for good once its plate is weighed down. Knock the jar above it onto the plate.',
      place: stairOf('archive', 'stairDown', 'own_mark'),
    };
  }
  return {
    objective: "Take the archive's stair down to the bell storey",
    hint: 'The ward by the stair is out for good. The way down is clear.',
    place: stairOf('archive', 'stairDown'),
  };
}

/** The human's kitchen chapter, from the gatehouse guards to the tuna going up. */
function gatehouseStep(
  progress: Pick<MissingCatsProgress, 'kitchen'>,
  carried: TowerStepCarried,
): TowerStep {
  const { objective, hint, place } = kitchenStep(progress.kitchen, carried.tuna);
  switch (place.kind) {
    case 'store':
      return { objective, hint, place: STORE_STEP };
    case 'fitting':
      return { objective, hint, place: inTower('kitchen', KITCHEN_FITTING_TILES[place.fitting]) };
    default: {
      const unhandled: never = place;
      throw new Error(`no kitchen place ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The Journal's target for a step at `place`. From the street the way into
 * the tower is the storm drain, so a step in the tower points there; indoors
 * it names the storey and tile, so the tower leads up or down its own stairs
 * to them rather than back out.
 */
export function towerStepTarget(
  place: TowerStepPlace,
  doorTarget: (building: BuildingId) => TrackerTarget | undefined,
): TrackerTarget | undefined {
  switch (place.kind) {
    case 'store':
      return doorTarget(STORE);
    case 'tower': {
      const drain = doorTarget(STORM_DRAIN_ID);
      if (drain === undefined) return undefined;
      const indoors = {
        building: TOWN_TOWER_ID,
        storey: towerStoreyIndex(place.storey),
        tile: place.tile,
        lead: place.lead,
      };
      return { ...drain, indoors };
    }
    default: {
      const unhandled: never = place;
      throw new Error(`no target for ${JSON.stringify(unhandled)}`);
    }
  }
}
