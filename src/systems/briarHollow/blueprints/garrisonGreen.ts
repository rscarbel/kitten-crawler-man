/**
 * Garrison Green — Wendell's pasture beside Plumbline Farm, where Midge is
 * delivered and lives from then on — as the escort and her life there read
 * it: the yard's outer rectangle (fence included) and the tiles of its cart
 * gate. Read from the town plan every time, so moving or reshaping the yard
 * in `townPlan.ts` moves everything that uses it.
 */

import type { GameMap } from '../../../map/GameMap';
import type { TilePoint, TileRect } from '../../../map/town/townPlan';
import { WENDELL_PASTURE_YARD_NAME } from './blueprintsProgress';

export interface GarrisonGreen {
  /** The yard's outer rectangle, fence line included. */
  readonly bounds: TileRect;
  /** Every tile of the yard's gate gaps. */
  readonly gateTiles: readonly TilePoint[];
}

/** Wendell's pasture on this map, or null off the town floor. */
export function garrisonGreen(gameMap: GameMap): GarrisonGreen | null {
  const yard = gameMap.townPlan?.yards.find(
    (candidate) => candidate.name === WENDELL_PASTURE_YARD_NAME,
  );
  if (yard === undefined) return null;
  const gateTiles: TilePoint[] = [];
  for (const gate of yard.gates) {
    for (let y = gate.y; y < gate.y + gate.h; y++) {
      for (let x = gate.x; x < gate.x + gate.w; x++) gateTiles.push({ x, y });
    }
  }
  return { bounds: yard.bounds, gateTiles };
}

/** Whether tile (`tileX`, `tileY`) lies inside the yard's outer rectangle. */
export function isInGarrisonGreen(green: GarrisonGreen, tileX: number, tileY: number): boolean {
  const { x, y, w, h } = green.bounds;
  return tileX >= x && tileY >= y && tileX < x + w && tileY < y + h;
}
