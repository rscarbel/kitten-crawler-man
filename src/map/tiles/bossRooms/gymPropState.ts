/**
 * The live state the gym's tile props are drawn in: how many dumbbells each
 * rack holds, and whether each squat rack still has its plates.
 *
 * The racks are tiles, drawn by the map's Y-sorted decoration pass, which is
 * handed a tile and nothing else. `JuicerRoomSystem` owns the state and writes
 * it here every frame it changes; the tile painter reads it. Keyed by tile, and
 * cleared whenever a gym is built, so a previous floor's racks cannot leak into
 * this one's.
 */

import { GYM_RACK_SLOTS } from '../../../sprites/art/gymRoomArt';

const rackFill = new Map<string, number>();
const strippedSquatRacks = new Set<string>();

const tileKey = (tx: number, ty: number): string => `${tx},${ty}`;

/** Forgets every rack, for a new gym. */
export function resetGymPropState(): void {
  rackFill.clear();
  strippedSquatRacks.clear();
}

export function setGymRackFill(tx: number, ty: number, filled: number): void {
  rackFill.set(tileKey(tx, ty), filled);
}

/** Dumbbells on the rack at this tile; a rack nobody has reported is full. */
export function gymRackFill(tx: number, ty: number): number {
  return rackFill.get(tileKey(tx, ty)) ?? GYM_RACK_SLOTS;
}

export function setGymSquatRackLoaded(tx: number, ty: number, loaded: boolean): void {
  if (loaded) strippedSquatRacks.delete(tileKey(tx, ty));
  else strippedSquatRacks.add(tileKey(tx, ty));
}

export function gymSquatRackLoaded(tx: number, ty: number): boolean {
  return !strippedSquatRacks.has(tileKey(tx, ty));
}
