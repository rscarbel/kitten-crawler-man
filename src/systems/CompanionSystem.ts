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
import type { BossRoomSystem } from './BossRoomSystem';
import { normalize, clamp, randomInt } from '../utils';

type Entity = {
  x: number;
  y: number;
  isMoving: boolean;
  facingX: number;
  facingY: number;
};

export type MovementMode = 'follow' | 'anchored';
export type CombatStance = 'aggressive' | 'passive';

type CharStance = {
  movementMode: MovementMode;
  combatStance: CombatStance;
  anchorX: number;
  anchorY: number;
};

const ANCHOR_CHASE_TILES = 3;
const ANCHOR_CHASE_RANGE = TILE_SIZE * ANCHOR_CHASE_TILES;
/** Orbit radius for human companion evasion — just inside melee range so attacks still land. */
const HUMAN_EVADE_ORBIT_TILES = 1.5;
const HUMAN_EVADE_ORBIT_RADIUS = TILE_SIZE * HUMAN_EVADE_ORBIT_TILES;
/** Radians per frame the orbit angle advances during evasion. */
const HUMAN_EVADE_ANGLE_SPEED = 0.04;

// Magic number constants
const TILE_CENTER_OFFSET = 0.5;
const DOT_PRODUCT_THRESHOLD = 0.25;
const COLLISION_BOX_RIGHT_FRACTION = 0.72;
const COLLISION_BOX_LEFT_FRACTION = 0.28;
const NEARBY_PLAYER_RANGE_MULTIPLIER = 2.5;
const CAT_EVADE_ANGLE_MIN = 0.032;
const CAT_EVADE_ANGLE_SIN_FACTOR = 3.7;
const CAT_EVADE_ANGLE_VARIATION = 0.018;
const CAT_EVADE_ANGLE_STANDARD = 0.022;
const KITE_DISTANCE_THRESHOLD = 0.75;
const ROTATION_ANGLE = 0.4;
const KITE_SPEED_MULTIPLIER = 1.35;
const RECALL_CHASE_SPEED = 1.5;
const FOLLOW_TARGET_CLOSE_DISTANCE_MULT = 2.5;
const CAT_IDLE_WANDER_FRAMES = 300;
const WANDER_TIMER_MIN = 160;
const WANDER_TIMER_MAX = 399;
const DISTANT_COMPANION_DISTANCE = 3.5;
const NEARBY_COMPANION_SPEED = 1.5;
const HUMAN_PURSUE_DISTANCE = 1.8;
const HUMAN_EVASION_SPEED = 1.1;
const HUMAN_EVASION_STOP_DISTANCE = 0.3;
const EVASION_STUCK_THRESHOLD = 8;
const EVASION_ANGLE_JUMP = 0.3;
const PATHFINDING_DISTANCE_THRESHOLD = 2.5;
const PATHFINDING_RECALC_FRAMES = 30;
const WAYPOINT_ARRIVAL_DISTANCE = 0.65;
const PATHING_FAILURE_DISTANCE = 4;
const FLEE_RADIUS_MULTIPLIER = 8;
const ANCHOR_FOLLOW_DISTANCE = 0.9;
const ANCHOR_CLOSE_DISTANCE = 0.5;
const NEARBY_TARGET_FOLLOW_DISTANCE = 0.9;

export class CompanionSystem implements GameSystem {
  private catWanderTargetX = 0;
  private catWanderTargetY = 0;
  private catWanderTimer = 0;
  private catKiteAngle = 0;
  private humanIdleFrames = 0;
  private _followOverride = false;

  private humanEvasionAngle = Math.random() * Math.PI * 2;
  private humanEvasionClockwise = true;
  private humanEvasionStuckFrames = 0;

  // Independent stance per character — used when that character is the companion (inactive).
  private readonly humanStance: CharStance = {
    movementMode: 'follow',
    combatStance: 'aggressive',
    anchorX: 0,
    anchorY: 0,
  };
  private readonly catStance: CharStance = {
    movementMode: 'follow',
    combatStance: 'aggressive',
    anchorX: 0,
    anchorY: 0,
  };

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

  /** Returns the stance struct for the companion (inactive character). */
  private stanceFor(humanIsActive: boolean): CharStance {
    return humanIsActive ? this.catStance : this.humanStance;
  }

  getMovementMode(humanIsActive: boolean): MovementMode {
    return this.stanceFor(humanIsActive).movementMode;
  }

  getCombatStance(humanIsActive: boolean): CombatStance {
    return this.stanceFor(humanIsActive).combatStance;
  }

  /** Recall the companion to the active player and resume following. */
  setFollowMe(humanIsActive: boolean): void {
    this.stanceFor(humanIsActive).movementMode = 'follow';
    this._followOverride = true;
  }

  /** Anchor the companion at their current position; they will not follow the player. */
  setDoNotMove(companion: { x: number; y: number }, humanIsActive: boolean): void {
    const stance = this.stanceFor(humanIsActive);
    stance.movementMode = 'anchored';
    stance.anchorX = companion.x;
    stance.anchorY = companion.y;
    this._followOverride = false;
  }

  /** Companion attacks enemies on sight. */
  setAggressive(humanIsActive: boolean): void {
    this.stanceFor(humanIsActive).combatStance = 'aggressive';
  }

  /** Companion only retaliates when directly attacked. */
  setPassive(humanIsActive: boolean): void {
    this.stanceFor(humanIsActive).combatStance = 'passive';
  }

  /**
   * Called when a character switches from active to companion.
   * If they were anchored, their anchor updates to wherever they ended up,
   * so any movement made while the player controlled them is preserved.
   */
  notifyBecameCompanion(char: { x: number; y: number }, charIsHuman: boolean): void {
    const stance = charIsHuman ? this.humanStance : this.catStance;
    if (stance.movementMode === 'anchored') {
      stance.anchorX = char.x;
      stance.anchorY = char.y;
    }
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

    const companion = human.isActive ? cat : human;
    if (companion.isKnockedOut) {
      companion.isMoving = false;
      return;
    }

    this.updateAutoAI(human, cat, mobs, mobGrid, ctx.bossRoom);
    this.updateFollower(human, cat, mobs, mobGrid, ctx.bossRoom);
  }

  snapFacingToNearestMob(
    player: HumanPlayer | CatPlayer,
    range: number,
    mobGrid: SpatialGrid<Mob>,
  ): void {
    const px = player.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const py = player.y + TILE_SIZE * TILE_CENTER_OFFSET;
    let bestDist = range;
    let bestMob: Mob | null = null;
    const nearPlayer = mobGrid.queryCircle(px, py, range);
    for (const mob of nearPlayer) {
      if (!mob.isAlive) continue;
      const dx = mob.x + TILE_SIZE * TILE_CENTER_OFFSET - px;
      const dy = mob.y + TILE_SIZE * TILE_CENTER_OFFSET - py;
      const dist = Math.hypot(dx, dy);
      if (dist > range || dist === 0) continue;
      const dot = (dx / dist) * player.facingX + (dy / dist) * player.facingY;
      if (dot < DOT_PRODUCT_THRESHOLD) continue;
      if (
        !this.gameMap.hasLineOfSight(
          px,
          py,
          mob.x + TILE_SIZE * TILE_CENTER_OFFSET,
          mob.y + TILE_SIZE * TILE_CENTER_OFFSET,
        )
      )
        continue;
      if (dist < bestDist) {
        bestDist = dist;
        bestMob = mob;
      }
    }
    if (bestMob) {
      const dx = bestMob.x + TILE_SIZE * TILE_CENTER_OFFSET - px;
      const dy = bestMob.y + TILE_SIZE * TILE_CENTER_OFFSET - py;
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
        dx >= 0
          ? Math.floor((nextX + ts * COLLISION_BOX_RIGHT_FRACTION) / ts)
          : Math.floor((nextX + ts * COLLISION_BOX_LEFT_FRACTION) / ts);
      const tileYcur = Math.floor((entity.y + ts * TILE_CENTER_OFFSET) / ts);
      if (this.gameMap.isWalkable(tileXnext, tileYcur)) entity.x = nextX;
    }
    if (dy !== 0) {
      const nextY = clamp(entity.y + dy, 0, mapPx - ts);
      const tileXcur = Math.floor((entity.x + ts * TILE_CENTER_OFFSET) / ts);
      const tileYnext = Math.floor((nextY + ts * TILE_CENTER_OFFSET) / ts);
      if (this.gameMap.isWalkable(tileXcur, tileYnext)) entity.y = nextY;
    }
  }

  private updateAutoAI(
    human: HumanPlayer,
    cat: CatPlayer,
    mobs: Mob[],
    mobGrid: SpatialGrid<Mob>,
    bossRoom: BossRoomSystem,
  ): void {
    // Returns true if a mob is inside a boss room that the active player hasn't entered,
    // AND the mob hasn't initiated combat against either player.
    // In that case the companion should not proactively target it.
    const isUntriggeredBossRoomMob = (m: Mob, activePlayer: { x: number; y: number }): boolean => {
      for (const state of bossRoom.getBossRoomStates()) {
        if (!bossRoom.isEntityInRoom(m, state.bounds)) continue;
        // Mob is in a boss room — allow targeting only if the active player is also in that
        // room or the mob has already attacked one of the players.
        const playerInRoom = bossRoom.isEntityInRoom(activePlayer, state.bounds);
        const hasAttackedPlayers = m.currentTarget === human || m.currentTarget === cat;
        return !playerInRoom && !hasAttackedPlayers;
      }
      return false;
    };

    if (human.isActive) {
      // Clear cat's target if it's dead or became an avoid-instead mob
      if (cat.autoTarget && (!cat.autoTarget.isAlive || cat.autoTarget.avoidInstead))
        cat.autoTarget = null;

      // Also clear if the current target is in an untriggered boss room
      if (cat.autoTarget && isUntriggeredBossRoomMob(cat.autoTarget, human)) cat.autoTarget = null;

      // While companion is being recalled, don't auto-assign new targets
      if (!this._followOverride) {
        const nearPlayerRange = HUMAN_ENGAGE_RANGE * NEARBY_PLAYER_RANGE_MULTIPLIER;
        if (this.catStance.combatStance === 'aggressive') {
          // Only pull cat into combat if the mob is within range of the active player;
          // prevents the companion chasing back to distant fights after a follow recall.
          const mobTargetingCat =
            mobs.find(
              (m) =>
                m.isAlive &&
                !m.avoidInstead &&
                !isUntriggeredBossRoomMob(m, human) &&
                m.currentTarget === cat &&
                Math.hypot(m.x - human.x, m.y - human.y) <= nearPlayerRange,
            ) ?? null;
          const mobTargetingHuman =
            mobs.find(
              (m) =>
                m.isAlive &&
                !m.avoidInstead &&
                !isUntriggeredBossRoomMob(m, human) &&
                m.currentTarget === human,
            ) ?? null;

          if (mobTargetingCat) {
            cat.autoTarget = mobTargetingCat;
          } else if (!cat.autoTarget && mobTargetingHuman) {
            cat.autoTarget = mobTargetingHuman;
          }
        } else {
          // Passive — only retaliate when a mob is actively targeting the cat
          cat.autoTarget ??=
            mobs.find(
              (m) =>
                m.isAlive &&
                !m.avoidInstead &&
                !isUntriggeredBossRoomMob(m, human) &&
                m.currentTarget === cat &&
                Math.hypot(m.x - human.x, m.y - human.y) <= nearPlayerRange,
            ) ?? null;
        }
      }

      if (cat.autoTarget) {
        const tc = cat.autoTarget;
        const hasLOS = this.gameMap.hasLineOfSight(
          cat.x + TILE_SIZE * TILE_CENTER_OFFSET,
          cat.y + TILE_SIZE * TILE_CENTER_OFFSET,
          tc.x + TILE_SIZE * TILE_CENTER_OFFSET,
          tc.y + TILE_SIZE * TILE_CENTER_OFFSET,
        );
        if (hasLOS) cat.autoFireTick();
      }
    } else {
      // Clear human's target if it's dead or became an avoid-instead mob
      if (human.autoTarget && (!human.autoTarget.isAlive || human.autoTarget.avoidInstead))
        human.autoTarget = null;

      // Also clear if the current target is in an untriggered boss room
      if (human.autoTarget && isUntriggeredBossRoomMob(human.autoTarget, cat))
        human.autoTarget = null;

      if (!human.autoTarget) {
        if (this.humanStance.combatStance === 'aggressive') {
          let closestDist = HUMAN_ENGAGE_RANGE;
          let closest: Mob | null = null;
          const nearHuman = mobGrid.queryCircle(human.x, human.y, HUMAN_ENGAGE_RANGE);
          for (const mob of nearHuman) {
            if (!mob.isAlive || !mob.isHostile || mob.avoidInstead) continue;
            if (isUntriggeredBossRoomMob(mob, cat)) continue;
            const dist = Math.hypot(mob.x - human.x, mob.y - human.y);
            if (dist < closestDist) {
              closestDist = dist;
              closest = mob;
            }
          }
          human.autoTarget = closest;
        } else {
          // Passive — only retaliate when a mob is actively targeting the human
          human.autoTarget =
            mobs.find(
              (m) =>
                m.isAlive &&
                !m.avoidInstead &&
                !isUntriggeredBossRoomMob(m, cat) &&
                m.currentTarget === human,
            ) ?? null;
        }
      }

      if (human.autoTarget) {
        const th = human.autoTarget;
        const hasLOS = this.gameMap.hasLineOfSight(
          human.x + TILE_SIZE * TILE_CENTER_OFFSET,
          human.y + TILE_SIZE * TILE_CENTER_OFFSET,
          th.x + TILE_SIZE * TILE_CENTER_OFFSET,
          th.y + TILE_SIZE * TILE_CENTER_OFFSET,
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
        m.x + TILE_SIZE * TILE_CENTER_OFFSET - (companion.x + TILE_SIZE * TILE_CENTER_OFFSET),
        m.y + TILE_SIZE * TILE_CENTER_OFFSET - (companion.y + TILE_SIZE * TILE_CENTER_OFFSET),
      );
      if (dist < closestDist) {
        closestDist = dist;
        closest = m;
      }
    }
    if (!closest) return false;

    const dx =
      companion.x + TILE_SIZE * TILE_CENTER_OFFSET - (closest.x + TILE_SIZE * TILE_CENTER_OFFSET);
    const dy =
      companion.y + TILE_SIZE * TILE_CENTER_OFFSET - (closest.y + TILE_SIZE * TILE_CENTER_OFFSET);
    const n = normalize(dx, dy);
    this.entityMoveWithCollision(
      companion,
      n.x * FOLLOWER_SPEED * RECALL_CHASE_SPEED,
      n.y * FOLLOWER_SPEED * RECALL_CHASE_SPEED,
    );
    companion.isMoving = true;
    return true;
  }

  /** Move the companion out of any active hazard zone (acid puddles, etc.). Returns true if fleeing. */
  private fleeFromHazards(companion: HumanPlayer | CatPlayer, bossRoom: BossRoomSystem): boolean {
    const escape = bossRoom.getHazardEscapeVector(companion.x, companion.y);
    if (!escape) return false;
    this.entityMoveWithCollision(
      companion,
      escape.dx * FOLLOWER_SPEED * RECALL_CHASE_SPEED,
      escape.dy * FOLLOWER_SPEED * RECALL_CHASE_SPEED,
    );
    companion.isMoving = true;
    return true;
  }

  private updateFollower(
    human: HumanPlayer,
    cat: CatPlayer,
    mobs: Mob[],
    _mobGrid: SpatialGrid<Mob>,
    bossRoom: BossRoomSystem,
  ): void {
    if (this._followOverride) {
      const caster = human.isActive ? human : cat;
      const companion = human.isActive ? cat : human;
      const dist = Math.hypot(companion.x - caster.x, companion.y - caster.y);
      if (dist <= TILE_SIZE) {
        this._followOverride = false;
        companion.autoTarget = null;
      } else {
        this.companionFollow(
          companion,
          caster.x,
          caster.y,
          FOLLOWER_SPEED * RECALL_CHASE_SPEED,
          TILE_SIZE * ANCHOR_FOLLOW_DISTANCE,
        );
      }
      return;
    }

    // If any avoidInstead mob is nearby, flee from it — takes priority over all other movement.
    const companion = human.isActive ? cat : human;
    if (this.fleeFromAvoidMobs(companion, mobs, TILE_SIZE * FLEE_RADIUS_MULTIPLIER)) return;
    if (this.fleeFromHazards(companion, bossRoom)) return;

    const stance = human.isActive ? this.catStance : this.humanStance;

    if (stance.movementMode === 'anchored') {
      if (human.isActive) {
        // Cat anchored: hold at anchor position; fires from there via autoFireTick
        if (!cat.autoTarget?.isAlive) {
          this.companionFollow(
            cat,
            stance.anchorX,
            stance.anchorY,
            FOLLOWER_SPEED,
            TILE_SIZE * ANCHOR_CLOSE_DISTANCE,
          );
        }
      } else {
        // Human anchored: may pursue a target within ANCHOR_CHASE_RANGE of the anchor
        if (human.autoTarget?.isAlive) {
          const tDist = Math.hypot(
            human.autoTarget.x - stance.anchorX,
            human.autoTarget.y - stance.anchorY,
          );
          if (tDist <= ANCHOR_CHASE_RANGE) {
            this.companionFollow(
              human,
              human.autoTarget.x,
              human.autoTarget.y,
              FOLLOWER_SPEED,
              TILE_SIZE * NEARBY_TARGET_FOLLOW_DISTANCE,
            );
          } else {
            human.autoTarget = null;
            this.companionFollow(
              human,
              stance.anchorX,
              stance.anchorY,
              FOLLOWER_SPEED,
              TILE_SIZE * ANCHOR_CLOSE_DISTANCE,
            );
          }
        } else {
          this.companionFollow(
            human,
            stance.anchorX,
            stance.anchorY,
            FOLLOWER_SPEED,
            TILE_SIZE * ANCHOR_CLOSE_DISTANCE,
          );
        }
      }
      return;
    }

    if (human.isActive) {
      if (cat.autoTarget?.isAlive) {
        const enemy = cat.autoTarget;
        if (enemy.currentTarget === cat) {
          this.doCatKite(cat, enemy);
        } else if (enemy.currentTarget === human) {
          if (enemy.requiresEvasion) {
            this.doCatKite(cat, enemy);
          } else {
            this.doCatBehindHuman(cat, human, enemy);
          }
        } else {
          this.companionFollow(
            cat,
            enemy.x,
            enemy.y,
            FOLLOWER_SPEED,
            TILE_SIZE * FOLLOW_TARGET_CLOSE_DISTANCE_MULT,
          );
        }
      } else if (this.humanIdleFrames >= CAT_IDLE_WANDER_FRAMES) {
        // Cat wander — only once human has been idle for 5 seconds
        this.catWanderTimer--;
        if (this.catWanderTimer <= 0) {
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * TILE_SIZE;
          this.catWanderTargetX = human.x + Math.cos(angle) * radius;
          this.catWanderTargetY = human.y + Math.sin(angle) * radius;
          this.catWanderTimer = randomInt(WANDER_TIMER_MIN, WANDER_TIMER_MAX);
        }
        if (Math.hypot(cat.x - human.x, cat.y - human.y) > TILE_SIZE * DISTANT_COMPANION_DISTANCE) {
          this.catWanderTargetX = human.x;
          this.catWanderTargetY = human.y;
        }
        this.companionFollow(
          cat,
          this.catWanderTargetX,
          this.catWanderTargetY,
          FOLLOWER_SPEED,
          TILE_SIZE * NEARBY_COMPANION_SPEED,
        );
      } else {
        // Human recently moved — cat follows smoothly, no wander jitter
        this.catWanderTargetX = human.x;
        this.catWanderTargetY = human.y;
        this.catWanderTimer = randomInt(WANDER_TIMER_MIN, WANDER_TIMER_MAX);
        this.companionFollow(
          cat,
          human.x,
          human.y,
          FOLLOWER_SPEED,
          TILE_SIZE * NEARBY_COMPANION_SPEED,
        );
      }
    } else {
      if (human.autoTarget?.isAlive) {
        if (human.autoTarget.requiresEvasion) {
          this.doHumanEvasion(human, human.autoTarget);
        } else {
          this.companionFollow(
            human,
            human.autoTarget.x,
            human.autoTarget.y,
            FOLLOWER_SPEED,
            TILE_SIZE * NEARBY_TARGET_FOLLOW_DISTANCE,
          );
        }
      } else {
        this.companionFollow(
          human,
          cat.x,
          cat.y,
          FOLLOWER_SPEED,
          TILE_SIZE * HUMAN_PURSUE_DISTANCE,
        );
      }
    }
  }

  private doCatKite(cat: CatPlayer, enemy: Mob): void {
    const ex = enemy.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const ey = enemy.y + TILE_SIZE * TILE_CENTER_OFFSET;
    const cx = cat.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const cy = cat.y + TILE_SIZE * TILE_CENTER_OFFSET;
    const distToEnemy = Math.hypot(cx - ex, cy - ey);

    // Evasion-flagged enemies get a faster, less predictable orbit angle.
    const angleStep = enemy.requiresEvasion
      ? CAT_EVADE_ANGLE_MIN +
        Math.sin(this.catKiteAngle * CAT_EVADE_ANGLE_SIN_FACTOR) * CAT_EVADE_ANGLE_VARIATION
      : CAT_EVADE_ANGLE_STANDARD;
    this.catKiteAngle += angleStep;

    if (distToEnemy < CAT_KITE_DIST * KITE_DISTANCE_THRESHOLD) {
      if (distToEnemy > 0) {
        const nx = (cx - ex) / distToEnemy;
        const ny = (cy - ey) / distToEnemy;
        const cos = Math.cos(ROTATION_ANGLE),
          sin = Math.sin(ROTATION_ANGLE);
        const sx2 = nx * cos - ny * sin;
        const sy2 = nx * sin + ny * cos;
        this.entityMoveWithCollision(
          cat,
          sx2 * FOLLOWER_SPEED * KITE_SPEED_MULTIPLIER,
          sy2 * FOLLOWER_SPEED * KITE_SPEED_MULTIPLIER,
        );
        cat.isMoving = true;
      }
    } else {
      const targetX =
        ex + Math.cos(this.catKiteAngle) * CAT_KITE_DIST - TILE_SIZE * TILE_CENTER_OFFSET;
      const targetY =
        ey + Math.sin(this.catKiteAngle) * CAT_KITE_DIST - TILE_SIZE * TILE_CENTER_OFFSET;
      this.companionFollow(
        cat,
        targetX,
        targetY,
        FOLLOWER_SPEED,
        TILE_SIZE * ANCHOR_CLOSE_DISTANCE,
      );
    }
  }

  private doCatBehindHuman(cat: CatPlayer, human: HumanPlayer, enemy: Mob): void {
    const ex = enemy.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const ey = enemy.y + TILE_SIZE * TILE_CENTER_OFFSET;
    const hx = human.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const hy = human.y + TILE_SIZE * TILE_CENTER_OFFSET;

    const dx = hx - ex;
    const dy = hy - ey;
    const n = normalize(dx, dy);

    const targetX = hx + n.x * CAT_BEHIND_HUMAN_OFFSET - TILE_SIZE * TILE_CENTER_OFFSET;
    const targetY = hy + n.y * CAT_BEHIND_HUMAN_OFFSET - TILE_SIZE * TILE_CENTER_OFFSET;
    this.companionFollow(cat, targetX, targetY, FOLLOWER_SPEED, TILE_SIZE * ANCHOR_CLOSE_DISTANCE);
  }

  /**
   * Human companion evasion against `requiresEvasion` enemies: orbits the enemy
   * at melee range so attacks still connect while the human keeps moving.
   * Reverses orbit direction when the companion is stuck against a wall.
   */
  private doHumanEvasion(human: HumanPlayer, enemy: Mob): void {
    const ex = enemy.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const ey = enemy.y + TILE_SIZE * TILE_CENTER_OFFSET;

    const dir = this.humanEvasionClockwise ? 1 : -1;
    this.humanEvasionAngle += HUMAN_EVADE_ANGLE_SPEED * dir;

    const targetX =
      ex +
      Math.cos(this.humanEvasionAngle) * HUMAN_EVADE_ORBIT_RADIUS -
      TILE_SIZE * TILE_CENTER_OFFSET;
    const targetY =
      ey +
      Math.sin(this.humanEvasionAngle) * HUMAN_EVADE_ORBIT_RADIUS -
      TILE_SIZE * TILE_CENTER_OFFSET;

    const prevX = human.x;
    const prevY = human.y;
    this.companionFollow(
      human,
      targetX,
      targetY,
      FOLLOWER_SPEED * HUMAN_EVASION_SPEED,
      TILE_SIZE * HUMAN_EVASION_STOP_DISTANCE,
    );

    if (human.x === prevX && human.y === prevY) {
      this.humanEvasionStuckFrames++;
      if (this.humanEvasionStuckFrames >= EVASION_STUCK_THRESHOLD) {
        this.humanEvasionClockwise = !this.humanEvasionClockwise;
        this.humanEvasionStuckFrames = 0;
        // Jump the angle ahead so the companion immediately moves to an unblocked point.
        this.humanEvasionAngle +=
          Math.PI * EVASION_ANGLE_JUMP * (this.humanEvasionClockwise ? 1 : -1);
      }
    } else {
      this.humanEvasionStuckFrames = 0;
    }
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
      dist < ts * PATHFINDING_DISTANCE_THRESHOLD ||
      this.gameMap.hasLineOfSight(
        entity.x + ts * TILE_CENTER_OFFSET,
        entity.y + ts * TILE_CENTER_OFFSET,
        targetX + ts * TILE_CENTER_OFFSET,
        targetY + ts * TILE_CENTER_OFFSET,
      );

    let moveNx = dx / dist;
    let moveNy = dy / dist;

    if (!hasLOS) {
      const goalTX = Math.floor((targetX + ts * TILE_CENTER_OFFSET) / ts);
      const goalTY = Math.floor((targetY + ts * TILE_CENTER_OFFSET) / ts);

      let cached = this.companionPaths.get(entity);
      if (!cached) {
        cached = { path: [], timer: 0, targetTX: -1, targetTY: -1 };
        this.companionPaths.set(entity, cached);
      }

      cached.timer--;
      if (cached.timer <= 0 || cached.targetTX !== goalTX || cached.targetTY !== goalTY) {
        const startTX = Math.floor((entity.x + ts * TILE_CENTER_OFFSET) / ts);
        const startTY = Math.floor((entity.y + ts * TILE_CENTER_OFFSET) / ts);
        const raw = this.gameMap.findPath(startTX, startTY, goalTX, goalTY);
        cached.path = raw.length > 1 ? raw.slice(1) : [];
        cached.timer = PATHFINDING_RECALC_FRAMES;
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

        if (wpDist < ts * WAYPOINT_ARRIVAL_DISTANCE && cached.path.length > 1) {
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
      } else if (dist > ts * PATHING_FAILURE_DISTANCE) {
        // Path search failed and companion is too far for direct movement — stay put.
        return;
      }
    } else {
      const cached = this.companionPaths.get(entity);
      if (cached) {
        cached.path = [];
      }
    }

    this.entityMoveWithCollision(entity, moveNx * step, moveNy * step);
    entity.isMoving = true;
    entity.facingX = moveNx;
    entity.facingY = moveNy;
  }
}
