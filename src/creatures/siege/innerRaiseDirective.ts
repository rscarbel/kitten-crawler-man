/**
 * The frame of a body the necromancer raises inside the palisade. It climbs
 * out near the wall, behind the defenders holding it, and turns on the
 * nearest of them — or on a village trebuchet, if one stands strictly nearer
 * — before it ever thinks of the bell. Only with nobody within
 * {@link INNER_RAISE_DEFENDER_LEASH_TILES} does it fall back to its own AI,
 * which fights whoever is in its aggro range or else marches on the bell.
 *
 * A defender is chased through the mob's own AI with `Mob.fixatedTarget`, so
 * the chase uses the creature's real pathing and attacks even when the
 * defender is out of sight or past its plain aggro range.
 */

import { TILE_SIZE } from '../../core/constants';
import type { Player } from '../../Player';
import type { Mob } from '../Mob';
import { RisingSkeleton } from '../RisingSkeleton';
import {
  isInsidePalisade,
  isInsidePalisadeTile,
  nearestEngageableDefender,
} from './siegeCapability';
import type { SiegeDirective } from './siegeTypes';
import { engageTrebuchet, nearestLiveTrebuchetTo } from './trebuchetThreat';

/**
 * How far an inner raise looks for a defender or an engine to go after.
 * Below every raised kind's aggro range times `AGGRO_PERSIST_MULTIPLIER`
 * (the ratkin's 14 is the smallest), so the fixation it sets always reaches.
 */
export const INNER_RAISE_DEFENDER_LEASH_TILES = 12;

const LEASH_PX = INNER_RAISE_DEFENDER_LEASH_TILES * TILE_SIZE;

/** The defender this directive fixated each mob on, so it only ever clears its own fixation. */
const fixatedByDirective = new WeakMap<Mob, Player>();

function fixate(mob: Mob, defender: Player): void {
  mob.fixatedTarget = defender;
  fixatedByDirective.set(mob, defender);
}

function releaseFixation(mob: Mob): void {
  const own = fixatedByDirective.get(mob);
  if (own === undefined) return;
  if (mob.fixatedTarget === own) mob.fixatedTarget = null;
  fixatedByDirective.delete(mob);
}

/** See the module comment. Stateless apart from which fixation it set, so one constant serves every raise. */
export const INNER_RAISE_DIRECTIVE: SiegeDirective = {
  steer(mob, targets) {
    const siege = mob.siegeCapable;
    const stillRising = mob instanceof RisingSkeleton && mob.isRising;
    if (
      siege === null ||
      !mob.isHostile ||
      mob.ownsSiegeMovement ||
      stillRising ||
      !isInsidePalisade(siege.world.site, mob)
    ) {
      releaseFixation(mob);
      return false;
    }
    const { site, defense } = siege.world;
    const defender = nearestEngageableDefender(mob, targets, LEASH_PX);
    const defenderDistance = defender?.distance ?? Infinity;

    if (siege.structureDamageMultiplier > 0) {
      const engine = nearestLiveTrebuchetTo(mob, defense, LEASH_PX);
      const engineInside =
        engine !== null &&
        isInsidePalisadeTile(
          site,
          Math.floor(engine.x / TILE_SIZE),
          Math.floor(engine.y / TILE_SIZE),
        );
      if (
        engine !== null &&
        engineInside &&
        engine.distance < defenderDistance &&
        mob.hasSightOfPoint(engine.x, engine.y)
      ) {
        releaseFixation(mob);
        mob.currentTarget = null;
        engageTrebuchet(mob, defense, engine);
        return true;
      }
    }

    if (defender !== null) {
      fixate(mob, defender.target);
      return false;
    }
    releaseFixation(mob);
    return false;
  },
};
