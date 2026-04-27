import type { GameMap } from '../map/GameMap';
import {
  TILE_SIZE,
  FOLLOWER_SPEED,
  CAT_KITE_DIST,
  CAT_BEHIND_HUMAN_OFFSET,
  HUMAN_ENGAGE_RANGE,
} from '../core/constants';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameSystem, SystemContext } from './GameSystem';
import { normalize, clamp, randomInt } from '../utils';

type Entity = {
  x: number;
  y: number;
  isMoving: boolean;
  facingX: number;
  facingY: number;
};

export class CompanionSystem implements GameSystem {
  private catWanderTargetX = 0;
  private catWanderTargetY = 0;
  private catWanderTimer = 0;
  private catKiteAngle = 0;
  private humanIdleFrames = 0;
  private _followOverride = false;

  private companionPaths = new Map<
    object,
    {
      path: Array<{ x: number; y: number }>;
      timer: number;
      targetTX: number;
      targetTY: number;
    }
  >();

  constructor(
    private readonly gameMap: GameMap,
    startTileX: number,
    startTileY: number,
  ) {
    this.catWanderTargetX = (startTileX + 1) * TILE_SIZE;
    this.catWanderTargetY = startTileY * TILE_SIZE;
  }

  get isFollowOverride(): boolean {
    return this._followOverride;
  }

  set isFollowOverride(v: boolean) {
    this._followOverride = v;
  }

  get humanIdle(): number {
    return this.humanIdleFrames;
  }

  /** Update both companion AI (auto-target) and companion follower movement. */
  update(ctx: SystemContext): void {
    const { human, cat, mobs, mobGrid, activeIsMoving } = ctx;
    // Track human idle frames
    if (human.isActive) {
      if (activeIsMoving) this.humanIdleFrames = 0;
      else this.humanIdleFrames++;
    } else {
      this.humanIdleFrames = 0;
    }

    this.updateAutoAI(human, cat, mobs, mobGrid);
    this.updateFollower(human, cat, mobs, mobGrid);
  }

  snapFacingToNearestMob(
    player: HumanPlayer | CatPlayer,
    range: number,
    mobGrid: SpatialGrid<Mob>,
  ): void {
    const px = player.x + TILE_SIZE * 0.5;
    const py = player.y + TILE_SIZE * 0.5;
    let bestDist = range;
    let bestMob: Mob | null = null;
    const nearPlayer = mobGrid.queryCircle(px, py, range);
    for (const mob of nearPlayer) {
      if (!mob.isAlive) continue;
      const dx = mob.x + TILE_SIZE * 0.5 - px;
      const dy = mob.y + TILE_SIZE * 0.5 - py;
      const dist = Math.hypot(dx, dy);
      if (dist > range || dist === 0) continue;
      const dot = (dx / dist) * player.facingX + (dy / dist) * player.facingY;
      if (dot < 0.25) continue;
      if (!this.gameMap.hasLineOfSight(px, py, mob.x + TILE_SIZE * 0.5, mob.y + TILE_SIZE * 0.5))
        continue;
      if (dist < bestDist) {
        bestDist = dist;
        bestMob = mob;
      }
    }
    if (bestMob) {
      const dx = bestMob.x + TILE_SIZE * 0.5 - px;
      const dy = bestMob.y + TILE_SIZE * 0.5 - py;
      const n = normalize(dx, dy);
      player.facingX = n.x;
      player.facingY = n.y;
    }
  }

  entityMoveWithCollision(entity: { x: number; y: number }, dx: number, dy: number): void {
    const mapPx = this.gameMap.structure.length * TILE_SIZE;
    const ts = TILE_SIZE;
    if (dx !== 0) {
      const nextX = clamp(entity.x + dx, 0, mapPx - ts);
      const tileXnext =
        dx >= 0 ? Math.floor((nextX + ts * 0.72) / ts) : Math.floor((nextX + ts * 0.28) / ts);
      const tileYcur = Math.floor((entity.y + ts / 2) / ts);
      if (this.gameMap.isWalkable(tileXnext, tileYcur)) entity.x = nextX;
    }
    if (dy !== 0) {
      const nextY = clamp(entity.y + dy, 0, mapPx - ts);
      const tileXcur = Math.floor((entity.x + ts / 2) / ts);
      const tileYnext = Math.floor((nextY + ts / 2) / ts);
      if (this.gameMap.isWalkable(tileXcur, tileYnext)) entity.y = nextY;
    }
  }

  private updateAutoAI(
    human: HumanPlayer,
    cat: CatPlayer,
    mobs: Mob[],
    mobGrid: SpatialGrid<Mob>,
  ): void {
    if (human.isActive) {
      // Clear cat's target if it's dead or became an avoid-instead mob
      if (cat.autoTarget && (!cat.autoTarget.isAlive || cat.autoTarget.avoidInstead))
        cat.autoTarget = null;

      // While companion is being recalled, don't auto-assign new targets
      if (!this._followOverride) {
        // Only pull cat into combat if the mob is within range of the active player;
        // prevents the companion chasing back to distant fights after a follow recall.
        const nearPlayerRange = HUMAN_ENGAGE_RANGE * 2.5;
        const mobTargetingCat =
          mobs.find(
            (m) =>
              m.isAlive &&
              !m.avoidInstead &&
              m.currentTarget === cat &&
              Math.hypot(m.x - human.x, m.y - human.y) <= nearPlayerRange,
          ) ?? null;
        const mobTargetingHuman =
          mobs.find((m) => m.isAlive && !m.avoidInstead && m.currentTarget === human) ?? null;

        if (mobTargetingCat) {
          cat.autoTarget = mobTargetingCat;
        } else if (!cat.autoTarget && mobTargetingHuman) {
          cat.autoTarget = mobTargetingHuman;
        }
      }

      if (cat.autoTarget) {
        const tc = cat.autoTarget;
        const hasLOS = this.gameMap.hasLineOfSight(
          cat.x + TILE_SIZE * 0.5,
          cat.y + TILE_SIZE * 0.5,
          tc.x + TILE_SIZE * 0.5,
          tc.y + TILE_SIZE * 0.5,
        );
        if (hasLOS) cat.autoFireTick();
      }
    } else {
      // Clear human's target if it's dead or became an avoid-instead mob
      if (human.autoTarget && (!human.autoTarget.isAlive || human.autoTarget.avoidInstead))
        human.autoTarget = null;

      if (!human.autoTarget) {
        let closestDist = HUMAN_ENGAGE_RANGE;
        let closest: Mob | null = null;
        const nearHuman = mobGrid.queryCircle(human.x, human.y, HUMAN_ENGAGE_RANGE);
        for (const mob of nearHuman) {
          if (!mob.isAlive || !mob.isHostile || mob.avoidInstead) continue;
          const dist = Math.hypot(mob.x - human.x, mob.y - human.y);
          if (dist < closestDist) {
            closestDist = dist;
            closest = mob;
          }
        }
        human.autoTarget = closest;
      }

      if (human.autoTarget) {
        const th = human.autoTarget;
        const hasLOS = this.gameMap.hasLineOfSight(
          human.x + TILE_SIZE * 0.5,
          human.y + TILE_SIZE * 0.5,
          th.x + TILE_SIZE * 0.5,
          th.y + TILE_SIZE * 0.5,
        );
        if (hasLOS) human.autoFightTick();
      }
    }
  }

  /** Flee companion away from the nearest avoidInstead mob within fleeRadius px. Returns true if fleeing. */
  private fleeFromAvoidMobs(
    companion: HumanPlayer | CatPlayer,
    mobs: Mob[],
    fleeRadius: number,
  ): boolean {
    let closest: Mob | null = null;
    let closestDist = fleeRadius;
    for (const m of mobs) {
      if (!m.isAlive || !m.avoidInstead) continue;
      const dist = Math.hypot(
        m.x + TILE_SIZE * 0.5 - (companion.x + TILE_SIZE * 0.5),
        m.y + TILE_SIZE * 0.5 - (companion.y + TILE_SIZE * 0.5),
      );
      if (dist < closestDist) {
        closestDist = dist;
        closest = m;
      }
    }
    if (!closest) return false;

    const dx = companion.x + TILE_SIZE * 0.5 - (closest.x + TILE_SIZE * 0.5);
    const dy = companion.y + TILE_SIZE * 0.5 - (closest.y + TILE_SIZE * 0.5);
    const n = normalize(dx, dy);
    this.entityMoveWithCollision(companion, n.x * FOLLOWER_SPEED * 1.5, n.y * FOLLOWER_SPEED * 1.5);
    companion.isMoving = true;
    return true;
  }

  private updateFollower(
    human: HumanPlayer,
    cat: CatPlayer,
    mobs: Mob[],
    _mobGrid: SpatialGrid<Mob>,
  ): void {
    if (this._followOverride) {
      const caster = human.isActive ? human : cat;
      const companion = human.isActive ? cat : human;
      const dist = Math.hypot(companion.x - caster.x, companion.y - caster.y);
      if (dist <= TILE_SIZE) {
        this._followOverride = false;
        companion.autoTarget = null;
      } else {
        this.companionFollow(companion, caster.x, caster.y, FOLLOWER_SPEED * 1.5, TILE_SIZE * 0.9);
      }
      return;
    }

    // If any avoidInstead mob is nearby, flee from it — takes priority over all other movement.
    const companion = human.isActive ? cat : human;
    if (this.fleeFromAvoidMobs(companion, mobs, TILE_SIZE * 8)) return;

    if (human.isActive) {
      if (cat.autoTarget?.isAlive) {
        const enemy = cat.autoTarget;
        if (enemy.currentTarget === cat) {
          this.doCatKite(cat, enemy);
        } else if (enemy.currentTarget === human) {
          this.doCatBehindHuman(cat, human, enemy);
        } else {
          this.companionFollow(cat, enemy.x, enemy.y, FOLLOWER_SPEED, TILE_SIZE * 2.5);
        }
      } else if (this.humanIdleFrames >= 300) {
        // Cat wander — only once human has been idle for 5 seconds
        this.catWanderTimer--;
        if (this.catWanderTimer <= 0) {
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * TILE_SIZE;
          this.catWanderTargetX = human.x + Math.cos(angle) * radius;
          this.catWanderTargetY = human.y + Math.sin(angle) * radius;
          this.catWanderTimer = randomInt(160, 399);
        }
        if (Math.hypot(cat.x - human.x, cat.y - human.y) > TILE_SIZE * 3.5) {
          this.catWanderTargetX = human.x;
          this.catWanderTargetY = human.y;
        }
        this.companionFollow(
          cat,
          this.catWanderTargetX,
          this.catWanderTargetY,
          FOLLOWER_SPEED,
          TILE_SIZE * 1.5,
        );
      } else {
        // Human recently moved — cat follows smoothly, no wander jitter
        this.catWanderTargetX = human.x;
        this.catWanderTargetY = human.y;
        this.catWanderTimer = randomInt(160, 399);
        this.companionFollow(cat, human.x, human.y, FOLLOWER_SPEED, TILE_SIZE * 1.5);
      }
    } else {
      if (human.autoTarget?.isAlive) {
        this.companionFollow(
          human,
          human.autoTarget.x,
          human.autoTarget.y,
          FOLLOWER_SPEED,
          TILE_SIZE * 0.9,
        );
      } else {
        this.companionFollow(human, cat.x, cat.y, FOLLOWER_SPEED, TILE_SIZE * 1.8);
      }
    }
  }

  private doCatKite(cat: CatPlayer, enemy: Mob): void {
    const ex = enemy.x + TILE_SIZE * 0.5;
    const ey = enemy.y + TILE_SIZE * 0.5;
    const cx = cat.x + TILE_SIZE * 0.5;
    const cy = cat.y + TILE_SIZE * 0.5;
    const distToEnemy = Math.hypot(cx - ex, cy - ey);

    this.catKiteAngle += 0.022;

    if (distToEnemy < CAT_KITE_DIST * 0.75) {
      if (distToEnemy > 0) {
        const nx = (cx - ex) / distToEnemy;
        const ny = (cy - ey) / distToEnemy;
        const cos = Math.cos(0.4),
          sin = Math.sin(0.4);
        const sx2 = nx * cos - ny * sin;
        const sy2 = nx * sin + ny * cos;
        this.entityMoveWithCollision(cat, sx2 * FOLLOWER_SPEED * 1.35, sy2 * FOLLOWER_SPEED * 1.35);
        cat.isMoving = true;
      }
    } else {
      const targetX = ex + Math.cos(this.catKiteAngle) * CAT_KITE_DIST - TILE_SIZE * 0.5;
      const targetY = ey + Math.sin(this.catKiteAngle) * CAT_KITE_DIST - TILE_SIZE * 0.5;
      this.companionFollow(cat, targetX, targetY, FOLLOWER_SPEED, TILE_SIZE * 0.5);
    }
  }

  private doCatBehindHuman(cat: CatPlayer, human: HumanPlayer, enemy: Mob): void {
    const ex = enemy.x + TILE_SIZE * 0.5;
    const ey = enemy.y + TILE_SIZE * 0.5;
    const hx = human.x + TILE_SIZE * 0.5;
    const hy = human.y + TILE_SIZE * 0.5;

    const dx = hx - ex;
    const dy = hy - ey;
    const n = normalize(dx, dy);

    const targetX = hx + n.x * CAT_BEHIND_HUMAN_OFFSET - TILE_SIZE * 0.5;
    const targetY = hy + n.y * CAT_BEHIND_HUMAN_OFFSET - TILE_SIZE * 0.5;
    this.companionFollow(cat, targetX, targetY, FOLLOWER_SPEED, TILE_SIZE * 0.5);
  }

  private companionFollow(
    entity: Entity,
    targetX: number,
    targetY: number,
    speed: number,
    minDist: number,
  ): void {
    const dx = targetX - entity.x;
    const dy = targetY - entity.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= minDist) {
      entity.isMoving = false;
      this.companionPaths.delete(entity);
      return;
    }

    const step = Math.min(speed, dist - minDist);
    const ts = TILE_SIZE;

    const hasLOS =
      dist < ts * 2.5 ||
      this.gameMap.hasLineOfSight(
        entity.x + ts * 0.5,
        entity.y + ts * 0.5,
        targetX + ts * 0.5,
        targetY + ts * 0.5,
      );

    let moveNx = dx / dist;
    let moveNy = dy / dist;

    if (!hasLOS) {
      const goalTX = Math.floor((targetX + ts * 0.5) / ts);
      const goalTY = Math.floor((targetY + ts * 0.5) / ts);

      let cached = this.companionPaths.get(entity);
      if (!cached) {
        cached = { path: [], timer: 0, targetTX: -1, targetTY: -1 };
        this.companionPaths.set(entity, cached);
      }

      cached.timer--;
      if (cached.timer <= 0 || cached.targetTX !== goalTX || cached.targetTY !== goalTY) {
        const startTX = Math.floor((entity.x + ts * 0.5) / ts);
        const startTY = Math.floor((entity.y + ts * 0.5) / ts);
        const raw = this.gameMap.findPath(startTX, startTY, goalTX, goalTY);
        cached.path = raw.length > 1 ? raw.slice(1) : [];
        cached.timer = 30;
        cached.targetTX = goalTX;
        cached.targetTY = goalTY;
      }

      if (cached.path.length > 0) {
        const next = cached.path[0];
        const wpX = next.x * ts;
        const wpY = next.y * ts;
        const wpDx = wpX - entity.x;
        const wpDy = wpY - entity.y;
        const wpDist = Math.hypot(wpDx, wpDy);

        if (wpDist < ts * 0.65 && cached.path.length > 1) {
          cached.path.shift();
          const next2 = cached.path[0];
          const wpDx2 = next2.x * ts - entity.x;
          const wpDy2 = next2.y * ts - entity.y;
          const wpDist2 = Math.hypot(wpDx2, wpDy2);
          if (wpDist2 > 0) {
            moveNx = wpDx2 / wpDist2;
            moveNy = wpDy2 / wpDist2;
          }
        } else if (wpDist > 0) {
          moveNx = wpDx / wpDist;
          moveNy = wpDy / wpDist;
        }
      }
    } else {
      const cached = this.companionPaths.get(entity);
      if (cached) cached.path = [];
    }

    this.entityMoveWithCollision(entity, moveNx * step, moveNy * step);
    entity.isMoving = true;
    entity.facingX = moveNx;
    entity.facingY = moveNy;
  }
}
