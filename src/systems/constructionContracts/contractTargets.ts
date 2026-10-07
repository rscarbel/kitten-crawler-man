/**
 * Turns a contract spot into the tiles it covers on the map the party is
 * standing on.
 *
 * A prop spot is found by the explicit placed-prop id its layout gives it; an
 * area spot is read from the area record the building's layout file exports
 * and shifted onto the map. Both answers come from the built layout, never
 * from coordinates held by the catalogue.
 */

import { ownEntry } from '../../core/guards';
import type { ContractArea } from '../../map/contractAreas';
import type { GameMap } from '../../map/GameMap';
import { BRIAR_HOLLOW_CONTRACT_AREAS } from '../../map/overworld/briarHollowLayout';
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import {
  NAMED_INTERIOR_CONTRACT_AREAS,
  buildGeneralStoreContractAreas,
} from '../../map/town/interiors';
import type { PlannedBuildingName, TileRect } from '../../map/town/townPlan';
import { TOWN_INTERIOR_PROPS } from '../../sprites/art/townInterior/townInteriorProps';
import type {
  BriarHollowContractSiteDef,
  ContractSpotDef,
  SkyfowlContractSiteDef,
} from './contractCatalog';

/** The General Store's layout is applied by building kind, so its areas are looked up apart from the named rooms. */
const GENERAL_STORE_NAME = 'General Store' satisfies PlannedBuildingName;

/** Where a spot lies, and what kind of surface it marks: a prop, or one of the layout's area kinds. */
export interface ContractSpotFootprint {
  readonly rect: TileRect;
  readonly surface: 'prop' | ContractArea['kind'];
}

function areaFootprint(
  area: ContractArea,
  originX: number,
  originY: number,
): ContractSpotFootprint {
  return {
    rect: { x: originX + area.x, y: originY + area.y, w: area.w, h: area.h },
    surface: area.kind,
  };
}

/**
 * A Skyfowl Town spot's footprint in the interior grid `map` was generated
 * with, or null when the layout no longer carries its target.
 */
export function skyfowlSpotFootprint(
  site: SkyfowlContractSiteDef,
  spot: ContractSpotDef,
  map: Pick<GameMap, 'placedInteriorProps' | 'structure'>,
): ContractSpotFootprint | null {
  const target = spot.target;
  if (target.kind === 'prop') {
    const placed = map.placedInteriorProps.find((candidate) => candidate.id === target.placedId);
    if (placed === undefined) return null;
    const { footprint } = TOWN_INTERIOR_PROPS[placed.propId];
    return {
      rect: { x: placed.tile.x, y: placed.tile.y, w: footprint.w, h: footprint.h },
      surface: 'prop',
    };
  }
  const interiorH = map.structure.length;
  const interiorW = map.structure[0]?.length ?? 0;
  const areas =
    site.buildingName === GENERAL_STORE_NAME
      ? buildGeneralStoreContractAreas(interiorW, interiorH)
      : NAMED_INTERIOR_CONTRACT_AREAS.get(site.buildingName)?.(interiorW, interiorH);
  const area = areas === undefined ? undefined : ownEntry(areas, target.areaId);
  return area === undefined ? null : areaFootprint(area, 0, 0);
}

/**
 * A Briar Hollow spot's footprint in map coordinates, or null when the
 * village no longer carries its target. An area may lie just outside its
 * building rect (a door step), so relative coordinates can be negative.
 */
export function briarHollowSpotFootprint(
  site: BriarHollowContractSiteDef,
  spot: ContractSpotDef,
  village: BriarHollowSite,
): ContractSpotFootprint | null {
  const building = village.buildings.find((candidate) => candidate.id === site.buildingId);
  if (building === undefined) return null;
  const target = spot.target;
  if (target.kind === 'prop') {
    const placed = building.furniture.find((prop) => prop.contractSpotId === target.placedId);
    if (placed === undefined) return null;
    return { rect: { x: placed.x, y: placed.y, w: placed.w, h: placed.h }, surface: 'prop' };
  }
  const area = ownEntry(BRIAR_HOLLOW_CONTRACT_AREAS[site.buildingId], target.areaId);
  return area === undefined ? null : areaFootprint(area, building.rect.x, building.rect.y);
}

/** Every tile of a footprint, row by row. */
export function footprintTiles(rect: TileRect): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) tiles.push({ x: rect.x + dx, y: rect.y + dy });
  }
  return tiles;
}
