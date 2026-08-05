/**
 * MobUpdateLoop — handles per-frame mob AI ticking, spatial grid updates,
 * and mob-specific behaviors (BrindleGrub evolution, boss clamping).
 *
 * Extracted from DungeonScene.updateGameplay() to reduce orchestrator size.
 */

import { TILE_SIZE } from '../core/constants';
import { perfMonitor } from '../core/PerfMonitor';
import type { Player } from '../Player';
import { BrindleGrub } from '../creatures/BrindleGrub';
import { BallOfSwine } from '../creatures/BallOfSwine';
import type { Mob } from '../creatures/Mob';
import { resetPathfindBudget } from '../creatures/pathfindBudget';
import { setPackAlertGrid } from '../creatures/packAlert';
import type { GameMap } from '../map/GameMap';
import { SeparationGrid } from '../core/SeparationGrid';
import type { SpatialGrid } from '../core/SpatialGrid';
import {
  accumulateSeparationForces,
  SEPARATION_POSITION_TOLERANCE,
  SEPARATION_RADIUS,
  SEPARATION_RADIUS_SQ,
} from './mobSeparation';
import type { GameSystem, SystemContext } from './GameSystem';

const AI_RADIUS_TILES = 22;
const AI_RADIUS = TILE_SIZE * AI_RADIUS_TILES;
/** Effective mass used for players in separation calculations. */
const PLAYER_MASS = 3;

const LEADING_EDGE_FRONT = 0.72;
const LEADING_EDGE_BACK = 0.28;
const TILE_CENTER_OFFSET = 0.5;

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
      dx >= 0
        ? Math.floor((nextX + ts * LEADING_EDGE_FRONT) / ts)
        : Math.floor((nextX + ts * LEADING_EDGE_BACK) / ts);
    const tileYcur = Math.floor((player.y + ts * TILE_CENTER_OFFSET) / ts);
    if (map.isWalkable(tileXnext, tileYcur)) player.x = nextX;
  }
  if (dy !== 0) {
    const nextY = player.y + dy;
    const tileXcur = Math.floor((player.x + ts * TILE_CENTER_OFFSET) / ts);
    const tileYnext = Math.floor((nextY + ts * TILE_CENTER_OFFSET) / ts);
    if (map.isWalkable(tileXcur, tileYnext)) player.y = nextY;
  }
}

/**
 * Handed to a boss that must not engage yet — shared, so holding fire allocates
 * nothing. `updateAI` takes a mutable array for the sake of the thirty-odd
 * subclasses that implement it; none of them writes to what it is given.
 */
const NO_TARGETS: Player[] = [];
// Frozen for its side effect only — the return value is typed readonly and
// `updateAI` takes a mutable array. A future implementation that writes to what
// it is given throws here instead of corrupting every boss on the floor.
Object.freeze(NO_TARGETS);

export class MobUpdateLoop implements GameSystem {
  /**
   * Per-frame scratch, kept as fields and cleared each frame rather than
   * rebuilt, so a busy level does not allocate five arrays and a Set per frame.
   */
  private readonly playerTargets: Player[] = [];
  private readonly separationMobs: Mob[] = [];
  private readonly separationSeen = new Set<Mob>();
  private readonly separationPreX: number[] = [];
  private readonly separationPreY: number[] = [];
  private readonly separationDx: number[] = [];
  private readonly separationDy: number[] = [];
  /**
   * Flying mobs get their own separation pass so they push off each other by
   * weight without being pushed by (or pushing) ground mobs sharing their tile
   * — a flying mob overlapping a ground mob's footprint is expected.
   */
  private readonly flyingSeparationMobs: Mob[] = [];
  private readonly flyingSeparationSeen = new Set<Mob>();
  private readonly flyingSeparationPreX: number[] = [];
  private readonly flyingSeparationPreY: number[] = [];
  private readonly flyingSeparationDx: number[] = [];
  private readonly flyingSeparationDy: number[] = [];
  private readonly aiTargets: Player[] = [];
  private readonly players: Player[] = [];
  /**
   * Rebuilt per pass rather than held across frames — see `SeparationGrid`. The
   * ground pass and the flying pass run one after the other, so one grid and one
   * candidate buffer serve both.
   */
  private readonly separationGrid = new SeparationGrid<Mob>();

  /**
   * Run one frame of mob AI for all mobs within activation radius
   * of either player. Updates spatial grid positions.
   */
  update(ctx: SystemContext): void {
    const { human, cat, mobs, mobGrid, bossRoom, extraTargets, gameMap } = ctx;

    resetPathfindBudget();
    setPackAlertGrid(mobGrid);

    // Tick BrindleGrub evolution for ALL alive grubs (not just those in AI radius)
    for (const mob of mobs) {
      if (mob instanceof BrindleGrub && mob.isAlive) mob.tickEvolve();
    }

    // Only activate mobs near players
    const activeMobs = mobGrid.queryCircle(human.x, human.y, AI_RADIUS);
    mobGrid.queryCircle(cat.x, cat.y, AI_RADIUS, activeMobs);

    // Mobs that require evasion (e.g. GrotesqueSpider) always run AI — they roam
    // the full map and must tick even when far off-screen. Same for a mob under
    // forceAggro: a scripted encounter that ignores aggro range would otherwise
    // freeze the moment the player outran the activation radius.
    for (const mob of mobs) {
      if (mob.isAlive && (mob.requiresEvasion || mob.forceAggro) && !activeMobs.has(mob)) {
        activeMobs.add(mob);
      }
    }

    perfMonitor.count('activeMobs', activeMobs.size);

    const playerTargets = this.playerTargets;
    playerTargets.length = 0;
    playerTargets.push(human, cat);
    if (extraTargets) {
      for (const t of extraTargets) {
        // Defend-quest NPCs (e.g. Goblin Mother) are handled by Bugaboo's own
        // defendTarget field — exclude them from the shared target list so regular
        // enemies ignore them.
        if (t.isAlive && !t.isDefendTarget) playerTargets.push(t);
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
        // Without a boss-room system (building interiors), leave forceAggro to
        // whatever the hosting scene's boss system decided.
        //
        // It is also left alone for a boss standing in no boss room at all: on
        // the overworld the scene builds a BossRoomSystem with an empty room
        // list, so an unguarded write here cleared a bounty mark's forceAggro
        // every single frame and the mark alone could be outrun while its
        // escort committed for good.
        // A boss whose room nobody has walked into yet has nothing to fight, and
        // is handed no targets rather than merely un-forced ones: its own aggro
        // range reaches out through the doorway, so leaving it the party list
        // lets it open the fight across a threshold the party has not crossed.
        let holdsFire = false;
        if (mob.isBoss && bossRoom) {
          if (
            bossRoom.isBossInLockedRoom(mob) ||
            bossRoom.isAnyPlayerInBossRoom(mob, playerTargets)
          )
            mob.forceAggro = true;
          else if (bossRoom.governsBoss(mob)) {
            mob.forceAggro = false;
            holdsFire = !bossRoom.sharesRoomWithPlayer(mob, playerTargets);
          }
        }

        // Vespa-stage BrindleGrubs need the full mob list to target other mobs.
        if (mob instanceof BrindleGrub) {
          mob.allMobs = mobs;
        }

        // Clear stale retaliate target; add live ones to this mob's AI targets.
        if (mob.retaliateMob && !mob.retaliateMob.isAlive) mob.retaliateMob = null;
        let aiTargets = playerTargets;
        if (mob.retaliateMob && !(mob instanceof BrindleGrub)) {
          this.aiTargets.length = 0;
          this.aiTargets.push(...playerTargets, mob.retaliateMob);
          aiTargets = this.aiTargets;
        }

        mob.updateAI(holdsFire ? NO_TARGETS : aiTargets);
      }

      // Keep bosses (specifically the Juicer) confined to their room
      if (mob.isBoss && !(mob instanceof BallOfSwine)) bossRoom?.clampBossToRoom(mob);
      mob.tickTimers();
      mobGrid.move(mob, ox, oy);
    }

    // Separation over non-flying active mobs, and a second pass for flying mobs
    // against each other only — see the field comment on `flyingSeparationMobs`
    // for why they're not merged into one pass.
    const separationStartedAt = perfMonitor.begin();
    this.runSeparationPass(
      activeMobs,
      (mob) => !mob.isFlying,
      this.separationMobs,
      this.separationSeen,
      this.separationPreX,
      this.separationPreY,
      this.separationDx,
      this.separationDy,
      mobGrid,
    );
    this.runSeparationPass(
      activeMobs,
      (mob) => mob.isFlying,
      this.flyingSeparationMobs,
      this.flyingSeparationSeen,
      this.flyingSeparationPreX,
      this.flyingSeparationPreY,
      this.flyingSeparationDx,
      this.flyingSeparationDy,
      mobGrid,
    );
    perfMonitor.end('separation', separationStartedAt);

    // Player-mob collision. Human-controlled: mass-weighted push so heavy bosses and light
    // cockroaches are displaced proportionally to their mass relative to the player.
    // AI-controlled follower: full push back onto the player only — mobs act as walls.
    this.players.length = 0;
    this.players.push(human, cat);
    for (const player of this.players) {
      if (!player.isAlive) continue;
      for (const mob of this.separationMobs) {
        if (!mob.isAlive) continue;
        const dx = player.x - mob.x;
        const dy = player.y - mob.y;
        const distSq = dx * dx + dy * dy;
        if (distSq >= SEPARATION_RADIUS_SQ) continue;
        const dist = Math.sqrt(distSq);
        if (dist > SEPARATION_POSITION_TOLERANCE) {
          if (player.isActive) {
            const base = (SEPARATION_RADIUS - dist) / dist;
            const totalMass = PLAYER_MASS + mob.mass;
            const playerShare = mob.mass / totalMass;
            const mobShare = PLAYER_MASS / totalMass;
            pushPlayerWithCollision(
              player,
              dx * base * playerShare,
              dy * base * playerShare,
              gameMap,
            );
            const mobOx = mob.x;
            const mobOy = mob.y;
            mob.applySeparation(-dx * base * mobShare, -dy * base * mobShare);
            if (mob.x !== mobOx || mob.y !== mobOy) mobGrid.move(mob, mobOx, mobOy);
          } else {
            const full = (SEPARATION_RADIUS - dist) / dist;
            pushPlayerWithCollision(player, dx * full, dy * full, gameMap);
          }
        }
      }
    }
  }

  /** Drops the published grid so a torn-down scene's mobs can never be searched. */
  dispose(): void {
    setPackAlertGrid(null);
  }

  /**
   * Mass-weighted separation over `activeMobs` filtered by `include`, written
   * into the given scratch arrays. Shared by the ground pass and the flying
   * pass so a mob only separates from others that pass the same filter.
   */
  private runSeparationPass(
    activeMobs: ReadonlySet<Mob>,
    include: (mob: Mob) => boolean,
    seps: Mob[],
    sepSeen: Set<Mob>,
    preX: number[],
    preY: number[],
    sepDx: number[],
    sepDy: number[],
    mobGrid: SpatialGrid<Mob>,
  ): void {
    seps.length = 0;
    sepSeen.clear();
    for (const mob of activeMobs) {
      if (mob.isAlive && include(mob) && !sepSeen.has(mob)) {
        seps.push(mob);
        sepSeen.add(mob);
      }
    }

    preX.length = 0;
    preY.length = 0;
    for (const m of seps) {
      preX.push(m.x);
      preY.push(m.y);
    }

    // Accumulated first and applied afterwards, rather than each pair moving its
    // mobs as it is visited. Two reasons, both of which showed up as shake:
    //
    // - Applying in the loop reads positions earlier pairs already changed, so
    //   the result depends on pair order — and pair order comes from a Set fed
    //   by a spatial query, which reshuffles as mobs cross grid cells. The same
    //   standing configuration then resolved differently on consecutive frames.
    // - There is nowhere to bound the total. A mob in a crowd took one push per
    //   neighbour, and ten goblins around a knight all pushed the same way.
    sepDx.length = 0;
    sepDy.length = 0;
    for (const _mob of seps) {
      sepDx.push(0);
      sepDy.push(0);
    }

    accumulateSeparationForces(seps, sepDx, sepDy, this.separationGrid);

    // `applySeparation` caps each mob's displacement against its own walk step.
    for (let i = 0; i < seps.length; i++) {
      seps[i].applySeparation(sepDx[i], sepDy[i]);
    }

    for (let i = 0; i < seps.length; i++) {
      if (seps[i].x !== preX[i] || seps[i].y !== preY[i]) {
        mobGrid.move(seps[i], preX[i], preY[i]);
      }
    }
  }
}
