import { TILE_SIZE } from '../../core/constants';
import type { PartyLocation } from '../../core/party/partySplit';
import type { BuildingId } from '../../map/buildingIds';
import type { TilePoint } from '../../map/town/townPlan';
import type { ArrivalLoadRequest } from '../../scenes/ArrivalLoader';

/** The loading card a move between locations is shown behind. */
export type ArrivalCard = Pick<ArrivalLoadRequest, 'kicker' | 'title' | 'screen'>;

export interface PartyTransferRequest {
  readonly to: PartyLocation;
  /** The card to show, or null for the destination's own. */
  readonly card: ArrivalCard | null;
}

/** Where a building visit asked for by a transfer puts the party down. */
export interface InteriorArrival {
  readonly storey: number;
  /** Where on the storey, or null for the storey's own arrival point. */
  readonly tile: TilePoint | null;
  readonly card: ArrivalCard | null;
}

/**
 * What the scene that owns building entry does for each kind of location. A
 * new location kind is a new method here, and every host fails to compile
 * until it can arrive there.
 */
export interface PartyTransferHost {
  arriveOverworld(tile: TilePoint, card: ArrivalCard | null): void;
  arriveInterior(building: BuildingId, arrival: InteriorArrival): void;
}

/**
 * The one way the party is moved to a location: a split's hand-over, a
 * regroup, a resume that must rejoin the live group, and any scripted move
 * between places. Replaces the scene behind an arrival card.
 */
export function transferParty(host: PartyTransferHost, request: PartyTransferRequest): void {
  const { to, card } = request;
  switch (to.kind) {
    case 'overworld':
      host.arriveOverworld(to.tile, card);
      return;
    case 'interior':
      host.arriveInterior(to.building, { storey: to.storey, tile: to.tile, card });
      return;
    default: {
      const unreachable: never = to;
      return unreachable;
    }
  }
}

/** A body's position is its top-left corner; the tile it stands on is read from its centre. */
const BODY_CENTRE_FRACTION = 0.5;

/** The tile a body stands on, as a location records it. */
export function tileStoodOn(body: { readonly x: number; readonly y: number }): TilePoint {
  return {
    x: Math.floor((body.x + TILE_SIZE * BODY_CENTRE_FRACTION) / TILE_SIZE),
    y: Math.floor((body.y + TILE_SIZE * BODY_CENTRE_FRACTION) / TILE_SIZE),
  };
}

/** Whether two locations name the same map, wherever on it they stand. */
export function sameMap(a: PartyLocation, b: PartyLocation): boolean {
  switch (a.kind) {
    case 'overworld':
      return b.kind === 'overworld';
    case 'interior':
      return b.kind === 'interior' && b.building === a.building && b.storey === a.storey;
    default: {
      const unreachable: never = a;
      return unreachable;
    }
  }
}
