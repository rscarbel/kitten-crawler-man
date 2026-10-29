import type { AudioScope } from '../audio/AudioScope';
import { placedGain } from '../audio/AudioManager';
import { GENERATOR_RIG_HUM_LOOP } from '../audio/loopLevels';
import { TILE_SIZE } from '../core/constants';
import { ElectricGoblin } from '../creatures/ElectricGoblin';
import type { Mob } from '../creatures/Mob';

/** How far from the Current Goblin his generator can still be heard, in tiles. */
const GENERATOR_RIG_HUM_HEARING_TILES = 14;
const HALF_TILE = TILE_SIZE / 2;

/**
 * The hum of the generator on a living Current Goblin's back, at the level of
 * the nearest one as heard from `listener`, a world point. Stops the frame he
 * dies or the party walks out of earshot.
 */
export function updateGeneratorRigHum(
  scope: AudioScope | null,
  mobs: readonly Mob[],
  listener: { readonly x: number; readonly y: number },
): void {
  if (scope === null) return;
  let level = 0;
  for (const mob of mobs) {
    if (!(mob instanceof ElectricGoblin) || !mob.isAlive) continue;
    const centreX = mob.x + HALF_TILE;
    const centreY = mob.y + HALF_TILE;
    const distanceTiles = Math.hypot(centreX - listener.x, centreY - listener.y) / TILE_SIZE;
    level = Math.max(level, placedGain(distanceTiles, GENERATOR_RIG_HUM_HEARING_TILES));
  }
  if (level <= 0) {
    scope.stopLoop(GENERATOR_RIG_HUM_LOOP);
    return;
  }
  // Asked of the scope each frame: a start declined while the buffer is still
  // decoding or the context is locked must be retried.
  scope.startLoop(GENERATOR_RIG_HUM_LOOP);
  scope.setAmbientLoopVolume(GENERATOR_RIG_HUM_LOOP.id, GENERATOR_RIG_HUM_LOOP.volume * level);
}

/** Stops the hum at once, for a frame the world does not run or a scene leaving the floor. */
export function silenceGeneratorRigHum(scope: AudioScope | null): void {
  scope?.stopLoop(GENERATOR_RIG_HUM_LOOP);
}
