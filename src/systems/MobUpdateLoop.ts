/**
 * MobUpdateLoop — handles per-frame mob AI ticking, spatial grid updates,
 * and mob-specific behaviors (BrindleGrub evolution, boss clamping).
 *
 * Extracted from DungeonScene.updateGameplay() to reduce orchestrator size.
 */

import { TILE_SIZE } from '../core/constants';
import type { Player } from '../Player';
import { BrindleGrub } from '../creatures/BrindleGrub';
import { BallOfSwine } from '../creatures/BallOfSwine';
import type { Mob } from '../creatures/Mob';
import type { GameMap } from '../map/GameMap';
import type { GameSystem, SystemContext } from './GameSystem';

const AI_RADIUS = TILE_SIZE * 22;
const SEP_DIST = TILE_SIZE;

/**
 * Pushes a player by (dx, dy) with per-axis wall collision, mirroring
 * Mob.moveWithCollision so mobs act as solid obstacles for the player.
 */
function pushPlayerWithCollision(
  player: { x: number; y: number },
  dx: number,
  dy: number,
  map: GameMap,
): void {
  const ts = TILE_SIZE;
  if (dx !== 0) {
    const nextX = player.x + dx;
    const tileXnext =
      dx >= 0 ? Math.floor((nextX + ts * 0.72) / ts) : Math.floor((nextX + ts * 0.28) / ts);
    const tileYcur = Math.floor((player.y + ts * 0.5) / ts);
    if (map.isWalkable(tileXnext, tileYcur)) player.x = nextX;
  }
  if (dy !== 0) {
    const nextY = player.y + dy;
    const tileXcur = Math.floor((player.x + ts * 0.5) / ts);
    const tileYnext = Math.floor((nextY + ts * 0.5) / ts);
    if (map.isWalkable(tileXcur, tileYnext)) player.y = nextY;
  }
}

export class MobUpdateLoop implements GameSystem {
  /**
   * Run one frame of mob AI for all mobs within activation radius
   * of either player. Updates spatial grid positions.
   */
  update(ctx: SystemContext): void {
    const { human, cat, mobs, mobGrid, bossRoom, extraTargets, gameMap } = ctx;

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

    // O(N²/2) separation over non-flying active mobs. activeMobs may contain
    // duplicates (mob in range of both players), so deduplicate via Set first.
    const seps: Mob[] = [];
    const sepSeen = new Set<Mob>();
    for (const mob of activeMobs) {
      if (mob.isAlive && !mob.isFlying && !sepSeen.has(mob)) {
        seps.push(mob);
        sepSeen.add(mob);
      }
    }

    const preX: number[] = [];
    const preY: number[] = [];
    for (const m of seps) {
      preX.push(m.x);
      preY.push(m.y);
    }

    for (let i = 0; i < seps.length; i++) {
      const a = seps[i];
      for (let j = i + 1; j < seps.length; j++) {
        const b = seps[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0 && dist < SEP_DIST) {
          const factor = ((SEP_DIST - dist) * 0.3) / dist;
          const px = dx * factor;
          const py = dy * factor;
          a.applySeparation(px, py);
          b.applySeparation(-px, -py);
        }
      }
    }

    for (let i = 0; i < seps.length; i++) {
      if (seps[i].x !== preX[i] || seps[i].y !== preY[i]) {
        mobGrid.move(seps[i], preX[i], preY[i]);
      }
    }

    // Player-mob collision. Human-controlled: symmetric half-push (neither has privileged mass).
    // AI-controlled follower: full push back onto the player only — mobs act as walls.
    for (const player of [human, cat]) {
      if (!player.isAlive) continue;
      for (const mob of seps) {
        if (!mob.isAlive) continue;
        const dx = player.x - mob.x;
        const dy = player.y - mob.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0 && dist < SEP_DIST) {
          if (player.isActive) {
            const half = ((SEP_DIST - dist) * 0.5) / dist;
            const px = dx * half;
            const py = dy * half;
            pushPlayerWithCollision(player, px, py, gameMap);
            const mobOx = mob.x;
            const mobOy = mob.y;
            mob.applySeparation(-px, -py);
            if (mob.x !== mobOx || mob.y !== mobOy) mobGrid.move(mob, mobOx, mobOy);
          } else {
            const full = (SEP_DIST - dist) / dist;
            pushPlayerWithCollision(player, dx * full, dy * full, gameMap);
          }
        }
      }
    }
  }
}
