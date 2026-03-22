/**
 * MobUpdateLoop — handles per-frame mob AI ticking, spatial grid updates,
 * and mob-specific behaviors (BrindleGrub evolution, boss clamping).
 *
 * Extracted from DungeonScene.updateGameplay() to reduce orchestrator size.
 */

import { TILE_SIZE } from '../core/constants';
import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import { Mob } from '../creatures/Mob';
import { BrindleGrub } from '../creatures/BrindleGrub';
import { BallOfSwine } from '../creatures/BallOfSwine';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { BossRoomSystem } from './BossRoomSystem';

const AI_RADIUS = TILE_SIZE * 22;

/** Context needed for a mob update tick. */
export interface MobUpdateContext {
  human: HumanPlayer;
  cat: CatPlayer;
  mobs: Mob[];
  mobGrid: SpatialGrid<Mob>;
  bossRoom: BossRoomSystem;
  /** Additional player-like targets (e.g. Mongo). */
  extraTargets?: Player[];
}

export class MobUpdateLoop {
  /**
   * Run one frame of mob AI for all mobs within activation radius
   * of either player. Updates spatial grid positions.
   */
  update(ctx: MobUpdateContext): void {
    const { human, cat, mobs, mobGrid, bossRoom, extraTargets } = ctx;

    // Tick BrindleGrub evolution for ALL alive grubs (not just those in AI radius)
    for (const mob of mobs) {
      if (mob instanceof BrindleGrub && mob.isAlive) mob.tickEvolve();
    }

    // Only activate mobs near players
    const activeMobs = mobGrid.queryCircle(human.x, human.y, AI_RADIUS);
    mobGrid.queryCircle(cat.x, cat.y, AI_RADIUS, activeMobs);

    const playerTargets: Player[] = [human, cat];
    if (extraTargets) {
      for (const t of extraTargets) {
        if (t.isAlive) playerTargets.push(t);
      }
    }

    for (const mob of activeMobs) {
      if (!mob.isAlive) continue;
      const ox = mob.x;
      const oy = mob.y;

      if (mob.isConfused) {
        mob.currentTarget = null;
        mob.doWander();
      } else {
        if (mob.isBoss) mob.forceAggro = bossRoom.isBossInLockedRoom(mob);

        // Vespa-stage BrindleGrubs need the full mob list to target other mobs.
        if (mob instanceof BrindleGrub) {
          mob.allMobs = mobs;
        }

        // Clear stale retaliate target; add live ones to this mob's AI targets.
        if (mob.retaliateMob && !mob.retaliateMob.isAlive) mob.retaliateMob = null;
        const aiTargets =
          mob.retaliateMob && !(mob instanceof BrindleGrub)
            ? [...playerTargets, mob.retaliateMob]
            : playerTargets;

        mob.updateAI(aiTargets);
      }

      // Keep bosses (specifically the Juicer) confined to their room
      if (mob.isBoss && !(mob instanceof BallOfSwine)) bossRoom.clampBossToRoom(mob);
      mob.tickTimers();
      mobGrid.move(mob, ox, oy);
    }
  }
}
