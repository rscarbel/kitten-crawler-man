/**
 * Places the reinforcements the Skeleton Lord calls up, and holds the ceiling on
 * how many of them can exist.
 *
 * The Hoarder pattern: the boss queues requests and a system drains them, so the
 * cap is enforced in one place by something that can see the whole mob list
 * rather than by a creature guessing at it. The count is written back to the
 * lord so he stops *casting* summon at the cap instead of casting it and having
 * every request thrown away — which from the player's side is a boss standing
 * still doing nothing for a second and a half.
 *
 * Everything `BountySystem` applies uniformly to an encounter at issue time —
 * the level, the willingness to chase into town, the commitment to the fight —
 * has to be applied here as well. Summons arrive mid-fight and never pass
 * through that staging, and a warrior that missed it is a level-1 mob that
 * gives up at the town line while its brothers do not.
 */

import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import { SkeletonLord } from '../creatures/SkeletonLord';
import { SkeletonWarrior } from '../creatures/SkeletonWarrior';
import { SkeletonArcher } from '../creatures/SkeletonArcher';
import { RisingSkeleton } from '../creatures/RisingSkeleton';
import { TILE_SIZE } from '../core/constants';
import type { GameSystem, SystemContext } from './GameSystem';

/**
 * Living escorts allowed at once.
 *
 * Two waves' worth plus the three he starts with. Past that the party is fighting
 * a crowd rather than a boss, and the lord himself becomes unreachable behind it.
 */
const ESCORT_CAP = 9;

/** Rings of tiles searched outward from the lord for somewhere to put a summon. */
const MIN_SPAWN_RADIUS_TILES = 2;
const MAX_SPAWN_RADIUS_TILES = 5;

/**
 * How far from the lord a skeleton counts as one of *his*.
 *
 * The cap is a property of one encounter, not of the map. Counting every living
 * skeleton everywhere would let a crypt full of ambient warriors on the far side
 * of the floor silently forbid the boss from ever summoning — and the sword and
 * archer are registered as standalone spawner ids precisely so a future level
 * can do that. Generous enough to cover a fight that has spread out, far short
 * of anywhere else on the map.
 */
const ESCORT_RADIUS_TILES = 24;

export class SkeletonSummonSystem implements GameSystem {
  /** Set when anything rises; `DungeonScene` reads and clears it to play the cue. */
  riseSoundPending = false;

  constructor(
    private readonly gameMap: GameMap,
    private readonly addMob: (mob: Mob) => void,
  ) {}

  /**
   * Drops the pending rise cue on a checkpoint restore.
   *
   * Without it, a safe-room restore on the exact frame a wave rose would play
   * the cue for a summon that the restore has just undone — a sound with nothing
   * on screen behind it. The other three encounter systems already do this.
   */
  resetForCheckpoint(): void {
    this.riseSoundPending = false;
  }

  update(ctx: SystemContext): void {
    const lords = ctx.roster.mobs.filter(
      (mob): mob is SkeletonLord => mob instanceof SkeletonLord && mob.isAlive,
    );
    if (lords.length === 0) return;

    const escortRadiusPx = TILE_SIZE * ESCORT_RADIUS_TILES;
    const skeletons = ctx.roster.mobs.filter(
      (mob): mob is RisingSkeleton => mob instanceof RisingSkeleton && mob.isAlive,
    );

    for (const lord of lords) {
      let living = 0;
      for (const skeleton of skeletons) {
        if (Math.hypot(skeleton.x - lord.x, skeleton.y - lord.y) <= escortRadiusPx) living++;
      }
      for (const request of lord.takePendingSummons()) {
        // A rising skeleton is already alive and already counted, so the cap can
        // never be double-booked by a wave that has not finished climbing out.
        if (living >= ESCORT_CAP) continue;
        const tile = this.findSpawnTile(request.originX, request.originY);
        if (tile === null) continue;
        this.raise(request.kind, tile.x, tile.y, lord);
        living++;
      }
      lord.escortAtCap = living >= ESCORT_CAP;
    }
  }

  private raise(kind: 'sword' | 'archer', tileX: number, tileY: number, lord: SkeletonLord): void {
    const risen =
      kind === 'sword'
        ? new SkeletonWarrior(tileX, tileY, TILE_SIZE)
        : new SkeletonArcher(tileX, tileY, TILE_SIZE);
    risen.setMap(this.gameMap);
    // The three flags BountySystem would have applied at issue time. Summons
    // never pass through it, so they are applied here — exactly once each.
    risen.applyMobLevel(lord.mobLevel);
    risen.ignoresTownSafeZone = true;
    // Deliberately unleashed: they climb out into a fight that is already
    // happening, so there is no site for them to be anchored to.
    risen.forceAggro = true;
    risen.beginRising();
    this.addMob(risen);
    this.riseSoundPending = true;
  }

  /**
   * Finds open ground near the lord to raise something on.
   *
   * Searched outward from a minimum radius rather than from zero: a warrior that
   * climbs out on top of the lord blocks the very shot he was buying time for,
   * and the two immediately shove each other apart, which looks like a bug.
   */
  private findSpawnTile(originX: number, originY: number): { x: number; y: number } | null {
    const centreTileX = Math.floor(originX / TILE_SIZE);
    const centreTileY = Math.floor(originY / TILE_SIZE);
    const candidates: Array<{ x: number; y: number }> = [];
    for (let radius = MIN_SPAWN_RADIUS_TILES; radius <= MAX_SPAWN_RADIUS_TILES; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const tileX = centreTileX + dx;
          const tileY = centreTileY + dy;
          if (!this.gameMap.isWalkable(tileX, tileY)) continue;
          candidates.push({ x: tileX, y: tileY });
        }
      }
      // Picked at random from the whole ring rather than taking the first hit,
      // so a wave does not always come up on the lord's western side.
      if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
      }
    }
    return null;
  }
}
