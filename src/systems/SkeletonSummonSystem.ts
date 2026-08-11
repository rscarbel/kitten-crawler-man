/**
 * Places the reinforcements a skeleton caster calls up, and holds the ceiling on
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
import { TheLich } from '../creatures/TheLich';
import { SkeletonWarrior } from '../creatures/SkeletonWarrior';
import { SkeletonArcher } from '../creatures/SkeletonArcher';
import { RisingSkeleton } from '../creatures/RisingSkeleton';
import { TILE_SIZE } from '../core/constants';
import { hasRoomToMove } from '../map/findWalkableTile';
import { applyActiveDifficultyRewards } from '../core/difficultyProfiles';
import type { GameSystem, SystemContext } from './GameSystem';

/**
 * Living escorts the Skeleton Lord is allowed at once.
 *
 * Two waves' worth plus the three he starts with. Past that the party is fighting
 * a crowd rather than a boss, and the lord himself becomes unreachable behind it.
 *
 * It is his number rather than the system's because the ceiling is a property of
 * the ground the fight happens on: the Lich holds the same escort inside a single
 * tower room and carries a far lower one of its own.
 */
const SKELETON_LORD_ESCORT_CAP = 9;

/** Anything that queues reinforcements for this system to place. */
type SkeletonSummoner = SkeletonLord | TheLich;

function escortCapOf(summoner: SkeletonSummoner): number {
  return summoner instanceof TheLich ? summoner.escortCap : SKELETON_LORD_ESCORT_CAP;
}

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
    const summoners = ctx.roster.mobs.filter(
      (mob): mob is SkeletonSummoner =>
        (mob instanceof SkeletonLord || mob instanceof TheLich) && mob.isAlive,
    );
    if (summoners.length === 0) return;

    const escortRadiusPx = TILE_SIZE * ESCORT_RADIUS_TILES;
    const skeletons = ctx.roster.mobs.filter(
      (mob): mob is RisingSkeleton => mob instanceof RisingSkeleton && mob.isAlive,
    );

    for (const summoner of summoners) {
      const cap = escortCapOf(summoner);
      let living = 0;
      for (const skeleton of skeletons) {
        if (Math.hypot(skeleton.x - summoner.x, skeleton.y - summoner.y) <= escortRadiusPx)
          living++;
      }
      for (const request of summoner.takePendingSummons()) {
        // A rising skeleton is already alive and already counted, so the cap can
        // never be double-booked by a wave that has not finished climbing out.
        if (living >= cap) continue;
        const tile = this.findSpawnTile(request.originX, request.originY);
        if (tile === null) continue;
        this.raise(request.kind, tile.x, tile.y, summoner);
        living++;
      }
      summoner.escortAtCap = living >= cap;
    }
  }

  private raise(
    kind: 'sword' | 'archer',
    tileX: number,
    tileY: number,
    summoner: SkeletonSummoner,
  ): void {
    const risen =
      kind === 'sword'
        ? new SkeletonWarrior(tileX, tileY, TILE_SIZE)
        : new SkeletonArcher(tileX, tileY, TILE_SIZE);
    risen.setMap(this.gameMap);
    // The flags BountySystem would have applied at issue time. Summons never
    // pass through it, so they are applied here — exactly once each.
    risen.applyMobLevel(summoner.mobLevel);
    applyActiveDifficultyRewards(risen);
    risen.ignoresTownSafeZone = true;
    // Deliberately unleashed: they climb out into a fight that is already
    // happening, so there is no site for them to be anchored to.
    risen.forceAggro = true;
    risen.beginRising();
    this.addMob(risen);
    this.riseSoundPending = true;
  }

  /**
   * Finds open ground near the summoner to raise something on.
   *
   * Searched outward from a minimum radius rather than from zero: a warrior that
   * climbs out on top of the caster blocks the very shot it was buying time for,
   * and the two immediately shove each other apart, which looks like a bug.
   *
   * Placement demands room to move rather than mere walkability: a one-tile
   * pocket between a desk and a wall passes `isWalkable` and traps whatever
   * rises in it for the rest of the fight.
   */
  private findSpawnTile(originX: number, originY: number): { x: number; y: number } | null {
    const centreTileX = Math.floor(originX / TILE_SIZE);
    const centreTileY = Math.floor(originY / TILE_SIZE);
    const roomy: Array<{ x: number; y: number }> = [];
    const cramped: Array<{ x: number; y: number }> = [];
    for (let radius = MIN_SPAWN_RADIUS_TILES; radius <= MAX_SPAWN_RADIUS_TILES; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const tileX = centreTileX + dx;
          const tileY = centreTileY + dy;
          if (!this.gameMap.isWalkable(tileX, tileY)) continue;
          if (hasRoomToMove(this.gameMap, tileX, tileY)) roomy.push({ x: tileX, y: tileY });
          else cramped.push({ x: tileX, y: tileY });
        }
      }
      // Picked at random from the whole ring rather than taking the first hit,
      // so a wave does not always come up on the caster's western side.
      if (roomy.length > 0) return roomy[Math.floor(Math.random() * roomy.length)];
    }
    // Nowhere with elbow room inside the search: a cramped tile still beats
    // swallowing the summon outright, and indoors — where a room is furniture
    // wall to wall — it is often the only kind there is.
    if (cramped.length > 0) return cramped[Math.floor(Math.random() * cramped.length)];
    return null;
  }
}
