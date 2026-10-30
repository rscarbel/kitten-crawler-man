/**
 * The works each town interior storey is built with, as data: which plate
 * sets it holds, and every conveyor placed in the world. A storey's knockable
 * props are written in its layout (`knockableProp`), beside the rest of its
 * furniture; its pressure plates are `pressure_plate` props there too, named
 * by id so a plate set here can list them.
 */

import { exchangeFlag } from '../../../core/party/partySplit';
import { TOWN_TOWER_ID, type BuildingId } from '../../buildingIds';
import type { ConveyorEndPlace, ConveyorPlacement, PlateSetDef } from '../../interiorMechanisms';
import {
  BELL_COUNTERWEIGHT,
  BELL_COUNTERWEIGHT_SET_ID,
  BELL_STOREY_PLATES,
  TOWER_DUMBWAITER,
  towerStoreyIndex,
} from './townCenterTower';

/** Each storey's plate sets, by building and then storey index. */
const INTERIOR_PLATE_SETS: Partial<
  Record<BuildingId, Readonly<Partial<Record<number, readonly PlateSetDef[]>>>>
> = {
  [TOWN_TOWER_ID]: {
    [towerStoreyIndex('bell_storey')]: [
      {
        id: BELL_COUNTERWEIGHT_SET_ID,
        plates: [BELL_STOREY_PLATES.west.id, BELL_STOREY_PLATES.east.id],
        target: {
          kind: 'counterweight',
          weightTile: BELL_COUNTERWEIGHT.weightTile,
          dropTiles: BELL_COUNTERWEIGHT.dropTiles,
          tiles: BELL_COUNTERWEIGHT.grate,
        },
        hold: 'latches',
      },
    ],
  },
};

/** The tower dumbwaiter's conveyor, for a system that watches what it carries. */
export const TOWER_DUMBWAITER_CONVEYOR_ID = 'tower_dumbwaiter';
/** The tower dumbwaiter's bell pulls, for a system that works one of them itself. */
export const TOWER_DUMBWAITER_BELL_ID = 'tower_dumbwaiter_bell';
/** The flag the tower dumbwaiter's bell pull raises at the other end. */
export const TOWER_DUMBWAITER_BELL_FLAG = exchangeFlag('tower_dumbwaiter_bell');

function towerEnd(end: 'foot' | 'head', fitting: 'hatch' | 'bell'): ConveyorEndPlace {
  const place = TOWER_DUMBWAITER[end];
  return {
    building: TOWN_TOWER_ID,
    storey: towerStoreyIndex(place.storey),
    tile: place[fitting],
  };
}

/** Every conveyor in the world; each end belongs to the place it stands in. */
export const CONVEYOR_PLACEMENTS: readonly ConveyorPlacement[] = [
  {
    kind: 'items',
    id: TOWER_DUMBWAITER_CONVEYOR_ID,
    fixture: 'dumbwaiter',
    foot: towerEnd('foot', 'hatch'),
    head: towerEnd('head', 'hatch'),
    // Nothing is sent on it from a bag at an unclaimed end: the key ring goes
    // down by being batted into the hatch, and the tin the kitchen sends up is
    // eaten as it arrives, so a tin sent down from the top would have nowhere
    // in the kitchen's sequence to go.
    accepts: [],
  },
  {
    kind: 'signal',
    id: TOWER_DUMBWAITER_BELL_ID,
    fixture: 'dumbwaiter_bell',
    foot: towerEnd('foot', 'bell'),
    head: towerEnd('head', 'bell'),
    flag: TOWER_DUMBWAITER_BELL_FLAG,
  },
];

const NO_PLATE_SETS: readonly PlateSetDef[] = [];

export function plateSetsFor(building: BuildingId, storey: number): readonly PlateSetDef[] {
  return INTERIOR_PLATE_SETS[building]?.[storey] ?? NO_PLATE_SETS;
}

/** A place a scene's map stands for, as a conveyor's end names it, without a tile. */
export type MechanismPlace = Omit<ConveyorEndPlace, 'tile'>;

export function endStandsIn(end: ConveyorEndPlace, place: MechanismPlace): boolean {
  return place.building === end.building && place.storey === end.storey;
}
