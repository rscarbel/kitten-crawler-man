/**
 * The positional loops a generated interior's placed props make: one emitter
 * at the centre of every standing prop whose def declares an `ambientSound`.
 *
 * Pure, so `scripts/verify-interiors.ts` can check a room's plan without an
 * audio context. `BuildingInteriorScene` hands the result to its
 * `AmbientSoundSystem` alongside the room's own constant bed.
 */

import type { PlacedTownInteriorProp } from '../map/GameMap';
import { TOWN_INTERIOR_PROPS } from '../sprites/art/townInterior/townInteriorProps';
import type { AmbientEmitter } from './AmbientSoundSystem';
import { interiorAmbienceSound } from '../audio/interiorAmbienceCues';

const HALF = 0.5;

/** A prop's emitter, with the placed instance it sounds from. */
export interface TownInteriorPropEmitter extends AmbientEmitter {
  readonly placedId: string;
}

/**
 * One emitter per placed prop that makes a sound, left out for every id in
 * `hidden` — a smashed brazier or a hearth a contract has taken down is silent.
 */
export function townInteriorPropEmitters(
  placed: ReadonlyArray<PlacedTownInteriorProp>,
  hidden: ReadonlySet<string> | undefined,
): TownInteriorPropEmitter[] {
  const emitters: TownInteriorPropEmitter[] = [];
  for (const prop of placed) {
    if (hidden?.has(prop.id) === true) continue;
    const propDef = TOWN_INTERIOR_PROPS[prop.propId];
    const sound = propDef.ambientSound;
    if (sound === undefined) continue;
    emitters.push({
      placedId: prop.id,
      soundId: interiorAmbienceSound(sound.cue),
      x: prop.tile.x + propDef.footprint.w * HALF,
      y: prop.tile.y + propDef.footprint.h * HALF,
      radiusTiles: sound.radiusTiles,
      maxVolume: sound.maxVolume,
    });
  }
  return emitters;
}
