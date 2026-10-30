/**
 * The data a place declares for the works a room is built with: things a cat
 * can knock off a ledge, pressure plates and what a set of them drives, and
 * conveyors that carry things between two places. Data only; the runtime is
 * `src/systems/roomMechanisms/`.
 */

import type { SoundId } from '../audio/sounds';
import type { ItemId } from '../core/items/defs/ItemDefs';
import type { ExchangeFlagId } from '../core/party/partySplit';
import type { BuildingId } from './buildingIds';
import type { TilePoint } from './town/townPlan';

/** A unit step on the grid, for a thing batted in a direction. */
export type GridStep = -1 | 0 | 1;

/**
 * Where a knocked-off thing is sent. Either way it flies until something
 * tall enough to stop a lob is in the way, and lands short of it.
 */
export type KnockOffFall =
  | { readonly kind: 'tile'; readonly tile: TilePoint }
  | {
      readonly kind: 'direction';
      readonly dx: GridStep;
      readonly dy: GridStep;
      readonly reachTiles: number;
    };

/**
 * What a knocked-off thing does when it lands, resolved against the tile it
 * actually comes down on, never the tile it was aimed at.
 */
export type KnockOffLanding =
  /** It lies where it lands; on a pressure plate, its weight holds the plate down. */
  | { readonly kind: 'pressPlate' }
  /** It lands loudly: anything listening within the radius hears it there. */
  | { readonly kind: 'makeNoise'; readonly radiusTiles: number }
  /** It smashes, the way a swing breaks it. */
  | { readonly kind: 'break' }
  /** It lies across the ground it falls on, which becomes this walkable floor. */
  | { readonly kind: 'bridge'; readonly floorTileType: number; readonly spanTiles: number }
  /** Landing in a conveyor's end, it is sent on as this item; anywhere else it just lies there. */
  | { readonly kind: 'deliver'; readonly item: ItemId };

export interface KnockOffPlacement {
  readonly fall: KnockOffFall;
  readonly landing: KnockOffLanding;
  /** Heard where it lands; a break also plays the prop's own break cue. */
  readonly landingCue: SoundId;
}

/** What a set of pressure plates opens. Every target blocks its tiles while shut. */
export type PlateSetTarget =
  | {
      readonly kind: 'door';
      readonly tiles: readonly TilePoint[];
      /** The side the door swings from. */
      readonly hinge: 'west' | 'east';
    }
  | { readonly kind: 'portcullis'; readonly tiles: readonly TilePoint[] }
  | {
      readonly kind: 'counterweight';
      /** Where the weight hangs, and how far it drops when the set is held. */
      readonly weightTile: TilePoint;
      readonly dropTiles: number;
      /** What the weight's rope hauls clear. */
      readonly tiles: readonly TilePoint[];
    };

/** Whether a plate set's target shuts again when a plate lifts, or stays open once opened. */
export type PlateSetHold = 'while_held' | 'latches';

export interface PlateSetDef {
  readonly id: string;
  /** Placed `pressure_plate` prop ids, all of which must be held at once. */
  readonly plates: readonly string[];
  readonly target: PlateSetTarget;
  readonly hold: PlateSetHold;
}

/** Where one end of a conveyor stands: a tile of one building's storey. */
export interface ConveyorEndPlace {
  readonly building: BuildingId;
  readonly storey: number;
  readonly tile: TilePoint;
}

/** What a conveyor that carries things is: a dumbwaiter, a chute, a bucket on a rope. */
export interface ItemConveyorKindDef {
  readonly deed: string;
  readonly sendCue: SoundId;
  readonly arriveCue: SoundId;
}

/** What a signal fixture is: a bell on a pull, a flag on a line. */
export interface SignalFixtureKindDef {
  readonly deed: string;
  readonly signalCue: SoundId;
}

export const ITEM_CONVEYOR_KINDS = {
  dumbwaiter: {
    deed: 'send it on the dumbwaiter',
    sendCue: 'rope_tightening',
    arriveCue: 'reward_chest_latch',
  },
} as const satisfies Record<string, ItemConveyorKindDef>;

export type ItemConveyorKindId = keyof typeof ITEM_CONVEYOR_KINDS;

export const SIGNAL_FIXTURE_KINDS = {
  dumbwaiter_bell: { deed: 'ring the bell', signalCue: 'feeding_bell_ring' },
} as const satisfies Record<string, SignalFixtureKindDef>;

export type SignalFixtureKindId = keyof typeof SIGNAL_FIXTURE_KINDS;

/**
 * A conveyor placed in the world: a named foot and head, which may stand in
 * different storeys or places. An item conveyor carries the items it accepts
 * from either end to the other; a signal fixture carries a flag.
 */
export type ConveyorPlacement =
  | {
      readonly kind: 'items';
      readonly id: string;
      readonly fixture: ItemConveyorKindId;
      readonly foot: ConveyorEndPlace;
      readonly head: ConveyorEndPlace;
      readonly accepts: readonly ItemId[];
    }
  | {
      readonly kind: 'signal';
      readonly id: string;
      readonly fixture: SignalFixtureKindId;
      readonly foot: ConveyorEndPlace;
      readonly head: ConveyorEndPlace;
      readonly flag: ExchangeFlagId;
    };

export type ConveyorEndId = 'foot' | 'head';
