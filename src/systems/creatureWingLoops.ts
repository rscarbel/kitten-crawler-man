import type { AudioScope } from '../audio/AudioScope';
import { placedGain } from '../audio/AudioManager';
import {
  GIANT_WASP_BUZZ_LOOP,
  GRAVEDIGGER_WING_DRONE_LOOP,
  type LoopLevel,
} from '../audio/loopLevels';
import { TILE_SIZE } from '../core/constants';
import { GiantWasp } from '../creatures/GiantWasp';
import { GravediggerBeetle } from '../creatures/GravediggerBeetle';
import type { Mob } from '../creatures/Mob';

const HALF_TILE = TILE_SIZE / 2;

/** A loop the wings of living flyers of one kind make, heard from where they are. */
interface WingLoop {
  readonly loop: LoopLevel;
  readonly hearingTiles: number;
  /**
   * The most flyers' worth of level the loop may reach. Each one in earshot
   * adds its own share, so a pack is louder than one, up to this many on top
   * of the listener.
   */
  readonly crowdCeiling: number;
  readonly sounds: (mob: Mob) => boolean;
}

/** How far a beetle's drone carries, in tiles. */
const GRAVEDIGGER_DRONE_HEARING_TILES = 10;
/** A brood hatches up to five at once; past two the drone only gets thicker, not louder. */
const GRAVEDIGGER_DRONE_CROWD_CEILING = 2;
/** How far a wasp's buzz carries, in tiles. */
const GIANT_WASP_BUZZ_HEARING_TILES = 9;
/** A swarm on top of the party sounds like this many wasps at most. */
const GIANT_WASP_BUZZ_CROWD_CEILING = 4;

/** Only the adult flies; the larva and the pupa make no wing sound. */
function isFlyingGravedigger(mob: Mob): boolean {
  return mob instanceof GravediggerBeetle && mob.isAdult;
}

function isGiantWasp(mob: Mob): boolean {
  return mob instanceof GiantWasp;
}

const WING_LOOPS: readonly WingLoop[] = [
  {
    loop: GRAVEDIGGER_WING_DRONE_LOOP,
    hearingTiles: GRAVEDIGGER_DRONE_HEARING_TILES,
    crowdCeiling: GRAVEDIGGER_DRONE_CROWD_CEILING,
    sounds: isFlyingGravedigger,
  },
  {
    loop: GIANT_WASP_BUZZ_LOOP,
    hearingTiles: GIANT_WASP_BUZZ_HEARING_TILES,
    crowdCeiling: GIANT_WASP_BUZZ_CROWD_CEILING,
    sounds: isGiantWasp,
  },
];

function crowdLevel(
  wing: WingLoop,
  mobs: readonly Mob[],
  listener: { readonly x: number; readonly y: number },
): number {
  let level = 0;
  for (const mob of mobs) {
    if (!mob.isAlive || !wing.sounds(mob)) continue;
    const centreX = mob.x + HALF_TILE;
    const centreY = mob.y + HALF_TILE;
    const distanceTiles = Math.hypot(centreX - listener.x, centreY - listener.y) / TILE_SIZE;
    level += placedGain(distanceTiles, wing.hearingTiles);
  }
  return Math.min(level, wing.crowdCeiling);
}

/**
 * The wing loops of every living flying beetle and wasp heard from
 * `listener`, a world point: one voice per kind whose level is the sum of the
 * flyers in earshot, each fading with its distance. A loop stops the frame its
 * last flyer dies or the party walks out of earshot.
 */
export function updateCreatureWingLoops(
  scope: AudioScope | null,
  mobs: readonly Mob[],
  listener: { readonly x: number; readonly y: number },
): void {
  if (scope === null) return;
  for (const wing of WING_LOOPS) {
    const level = crowdLevel(wing, mobs, listener);
    if (level <= 0) {
      scope.stopLoop(wing.loop);
      continue;
    }
    // Asked of the scope each frame: a start declined while the buffer is
    // still decoding or the context is locked must be retried.
    scope.startLoop(wing.loop);
    scope.setAmbientLoopVolume(wing.loop.id, wing.loop.volume * level);
  }
}

/** Stops every wing loop at once, for a frame the world does not run or a scene leaving the floor. */
export function silenceCreatureWingLoops(scope: AudioScope | null): void {
  for (const wing of WING_LOOPS) scope?.stopLoop(wing.loop);
}
