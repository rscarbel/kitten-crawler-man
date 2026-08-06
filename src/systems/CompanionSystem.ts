import type { GameMap } from '../map/GameMap';
import {
  TILE_SIZE,
  FOLLOWER_SPEED,
  CAT_KITE_DIST,
  CAT_BEHIND_HUMAN_OFFSET,
  COMPANION_LEASH_PX,
  HUMAN_ENGAGE_RANGE,
} from '../core/constants';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameSystem, SystemContext } from './GameSystem';
import type { GroundHazardSource } from './GroundHazardSource';
import type { BossRoomSystem } from './BossRoomSystem';
import { normalize, clamp, randomInt } from '../utils';

type Entity = {
  x: number;
  y: number;
  isMoving: boolean;
  facingX: number;
  facingY: number;
  /** See {@link CompanionSystem.companionFollow} for why the follower reads this. */
  readonly isSwinging: boolean;
};

export type MovementMode = 'follow' | 'anchored';
export type CombatStance = 'aggressive' | 'passive';

/**
 * Combat stance that survives scene transitions. Threaded by reference through
 * scene options (like club membership) so choosing "passive" persists when the
 * players duck into a building and come back — unlike the movement mode, which
 * intentionally resets to "follow" so the companion reappears at the player's
 * side rather than anchored in another map.
 */
export interface CompanionStanceState {
  human: CombatStance;
  cat: CombatStance;
}

export function createCompanionStanceState(): CompanionStanceState {
  return { human: 'aggressive', cat: 'aggressive' };
}

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
const COLLISION_BOX_RIGHT_FRACTION = 0.72;
const COLLISION_BOX_LEFT_FRACTION = 0.28;
const COLLISION_BOX_BOTTOM_FRACTION = 0.8;
const COLLISION_BOX_TOP_FRACTION = 0.2;
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
/**
 * How far a companion will path to catch up. Unlike a mob, a companion is not
 * leashed to an activation radius — it must be able to cross the whole town to
 * rejoin the player, and a failed path leaves it standing still forever.
 */
const COMPANION_MAX_PATH_DISTANCE_TILES = 96;

/**
 * How long a companion refuses to re-acquire the mob it just broke its leash
 * on. Mirrors `Mongo`'s own forget window, for the same reason: the drop is
 * only half a disengage, and without the ban the companion turns around the
 * moment it is back within range of what it just walked away from.
 */
const COMPANION_TARGET_BAN_FRAMES = 90;

/**
 * How much of her claw reach the cat holds at when she has stopped retreating.
 * Comfortably inside it rather than on the edge, so the swipe still connects
 * when the pursuer's own separation shove nudges her back a few pixels.
 */
const CLAW_HOLD_FRACTION = 0.8;

/**
 * How much health the cat needs before she will stand her ground for a swipe.
 * Above this the trade is a small bonus; below it the missile she can fire from
 * across the room is the only thing keeping her upright.
 */
const CAT_BRAWL_MIN_HP_FRACTION = 0.6;
/**
 * How many hostiles may be near her before standing her ground stops being a
 * trade and becomes a mugging. One is a duel; the second is a free hit on the
 * crawler with the smallest health pool in the game.
 */
const CAT_BRAWL_MAX_CROWD = 1;
/** The crowd is counted a little beyond claw reach, so she reads a swarm closing rather than one already on her. */
const CAT_BRAWL_CROWD_RADIUS_MULTIPLIER = 2;

/** Floor on how often a goal-tile change may trigger a fresh companion path. */
const MIN_REPATH_GAP_FRAMES = 8;
/** Sentinel goal tile for a freshly created path cache — no real tile is negative. */
const NO_CACHED_GOAL_TILE = -1;
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

  /** Cross-scene combat-stance store; combat stance mirrors into it so it persists. */
  private readonly stanceState: CompanionStanceState;

  /** Reused result set for companion proximity queries. */
  private readonly _proximityQuery = new Set<Mob>();

  /** Mobs the companion broke its leash on, mapped to frames of ban remaining. */
  private readonly targetBans = new Map<Mob, number>();

  /**
   * Whether the cat had a missile ready this frame, sampled before she spends
   * it. The kite reads it to decide whether backing off is worth anything —
   * see {@link catStandOff} — and by the time the kite runs, the shot has
   * already been fired and the cooldown already restarted.
   */
  private catMissileWasReady = true;

  private companionPaths = new Map<
    object,
    {
      path: Array<{ x: number; y: number }>;
      timer: number;
      targetTX: number;
      targetTY: number;
      /** Frames since the last findPath, so goal-tile changes can't repath every frame. */
      framesSinceRecalc: number;
    }
  >();

  private readonly hazardSources: GroundHazardSource[] = [];

  constructor(
    private readonly gameMap: GameMap,
    startTileX: number,
    startTileY: number,
    stanceState: CompanionStanceState = createCompanionStanceState(),
  ) {
    this.catWanderTargetX = (startTileX + 1) * TILE_SIZE;
    this.catWanderTargetY = startTileY * TILE_SIZE;
    this.stanceState = stanceState;
    this.humanStance.combatStance = stanceState.human;
    this.catStance.combatStance = stanceState.cat;
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
    this.syncStanceState();
  }

  /** Companion only retaliates when directly attacked. */
  setPassive(humanIsActive: boolean): void {
    this.stanceFor(humanIsActive).combatStance = 'passive';
    this.syncStanceState();
  }

  /** Mirror both characters' combat stance into the cross-scene store. */
  private syncStanceState(): void {
    this.stanceState.human = this.humanStance.combatStance;
    this.stanceState.cat = this.catStance.combatStance;
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
    const { human, cat, mobGrid, activeIsMoving } = ctx;
    // Track human idle frames
    if (human.isActive) {
      if (activeIsMoving) this.humanIdleFrames = 0;
      else this.humanIdleFrames++;
    } else {
      this.humanIdleFrames = 0;
    }

    // Ahead of the knockout check: a ban is a wall-clock penalty on the
    // companion, and freezing it through a knockout and a revive would leave a
    // mob still banned minutes after the chase that banned it.
    this.tickTargetBans();

    const companion = human.isActive ? cat : human;
    if (companion.isKnockedOut) {
      companion.isMoving = false;
      return;
    }

    const chaseBlocked = this.isLeashStretched(human, cat, ctx.bossRoom);
    this.updateAutoAI(human, cat, mobGrid, ctx.bossRoom, chaseBlocked);
    this.updateFollower(human, cat, mobGrid, chaseBlocked);
  }

  entityMoveWithCollision(entity: { x: number; y: number }, dx: number, dy: number): void {
    const mapPxW = (this.gameMap.structure[0]?.length ?? this.gameMap.structure.length) * TILE_SIZE;
    const mapPxH = this.gameMap.structure.length * TILE_SIZE;
    const ts = TILE_SIZE;
    if (dx !== 0) {
      const nextX = clamp(entity.x + dx, 0, mapPxW - ts);
      const tileXnext =
        dx >= 0
          ? Math.floor((nextX + ts * COLLISION_BOX_RIGHT_FRACTION) / ts)
          : Math.floor((nextX + ts * COLLISION_BOX_LEFT_FRACTION) / ts);
      const tileYtop = Math.floor((entity.y + ts * COLLISION_BOX_TOP_FRACTION) / ts);
      const tileYbot = Math.floor((entity.y + ts * COLLISION_BOX_BOTTOM_FRACTION) / ts);
      if (
        this.gameMap.isWalkable(tileXnext, tileYtop) &&
        this.gameMap.isWalkable(tileXnext, tileYbot)
      ) {
        entity.x = nextX;
      }
    }
    if (dy !== 0) {
      const nextY = clamp(entity.y + dy, 0, mapPxH - ts);
      const tileYnext =
        dy >= 0
          ? Math.floor((nextY + ts * COLLISION_BOX_BOTTOM_FRACTION) / ts)
          : Math.floor((nextY + ts * COLLISION_BOX_TOP_FRACTION) / ts);
      const tileXleft = Math.floor((entity.x + ts * COLLISION_BOX_LEFT_FRACTION) / ts);
      const tileXright = Math.floor((entity.x + ts * COLLISION_BOX_RIGHT_FRACTION) / ts);
      if (
        this.gameMap.isWalkable(tileXleft, tileYnext) &&
        this.gameMap.isWalkable(tileXright, tileYnext)
      ) {
        entity.y = nextY;
      }
    }
  }

  /** Clear line of sight between two entities, measured centre to centre. */
  private hasSightLine(
    from: { readonly x: number; readonly y: number },
    to: { readonly x: number; readonly y: number },
  ): boolean {
    return this.gameMap.hasLineOfSight(
      from.x + TILE_SIZE * TILE_CENTER_OFFSET,
      from.y + TILE_SIZE * TILE_CENTER_OFFSET,
      to.x + TILE_SIZE * TILE_CENTER_OFFSET,
      to.y + TILE_SIZE * TILE_CENTER_OFFSET,
    );
  }

  private updateAutoAI(
    human: HumanPlayer,
    cat: CatPlayer,
    mobGrid: SpatialGrid<Mob>,
    bossRoom: BossRoomSystem | undefined,
    chaseBlocked: boolean,
  ): void {
    // Whether a mob sits in a boss room whose fight has not started, in which
    // case the companion must leave it alone.
    //
    // Engagement is harm or entry, never notice. A mob's `currentTarget` used to
    // stand in for "the fight is on", and it cannot: the Krakaren's aggro radius
    // reaches out through its own doorway, so it acquired a crawler standing in
    // the corridor, the veto lifted, and the companion cat shot an untouched
    // boss to death through a wall — no intro, no room lock, no chest.
    const isUntriggeredBossRoomMob = (m: Mob, activePlayer: { x: number; y: number }): boolean => {
      if (!bossRoom) return false;
      for (const state of bossRoom.getBossRoomStates()) {
        if (!bossRoom.isEntityInRoom(m, state.bounds)) continue;
        // A room whose fight is over — or that never had one — vetoes nothing.
        // The bounds outlive the boss, and without this every goblin that later
        // wandered into a cleared boss room was invisible to the companion for
        // the rest of the run.
        if (!bossRoom.isFightPending(state)) return false;
        const playerInRoom = bossRoom.isEntityInRoom(activePlayer, state.bounds);
        const bloodDrawn = m.hasStruckPlayer || m.wasDamagedByParty;
        return !playerInRoom && !state.locked && !bloodDrawn;
      }
      return false;
    };

    this.breakStretchedLeash(human, cat, chaseBlocked);
    // Capped at the leash, because a job the companion has to break its leash to
    // start is a job it will be pulled off two seconds later — and then re-given
    // the moment the ban lapses, which is a lap rather than a disengage.
    const nearPlayerRange = Math.min(
      HUMAN_ENGAGE_RANGE * NEARBY_PLAYER_RANGE_MULTIPLIER,
      COMPANION_LEASH_PX,
    );

    if (human.isActive) {
      // Clear cat's target if it's dead or became an avoid-instead mob
      if (cat.autoTarget && (!cat.autoTarget.isAlive || cat.autoTarget.avoidInstead))
        cat.autoTarget = null;

      // Also clear if the current target is in an untriggered boss room
      if (cat.autoTarget && isUntriggeredBossRoomMob(cat.autoTarget, human)) cat.autoTarget = null;

      // While the companion is being recalled, nothing is assigned at all.
      if (!this._followOverride) {
        // Something chewing on the companion herself is hers to answer, leash or
        // no leash: the leash is there to stop a chase, not to disarm the
        // crawler being chased. In practice it rarely has to do anything —
        // heading home she outruns every mob in the game — but the frames where
        // it does are the ones where a six-health cat is being hit and has no
        // other reason to be allowed to hit back.
        const mobTargetingCat = this.findMobTargetingNear(
          mobGrid,
          cat,
          cat,
          nearPlayerRange,
          human,
          isUntriggeredBossRoomMob,
        );
        // Joining the player's fight is the part the leash does govern — and
        // without the gate the drop below is undone on the frame it happens,
        // because whatever the companion just walked away from is still the
        // nearest thing it can see.
        const mobTargetingHuman =
          this.catStance.combatStance === 'aggressive' && !chaseBlocked
            ? this.findMobTargetingNear(
                mobGrid,
                human,
                human,
                nearPlayerRange,
                human,
                isUntriggeredBossRoomMob,
              )
            : null;

        if (mobTargetingCat) {
          cat.autoTarget = mobTargetingCat;
        } else if (!cat.autoTarget && mobTargetingHuman) {
          cat.autoTarget = mobTargetingHuman;
        }
      }

      // Read before the shot, not after, and outside the sight test: the kite
      // asks this on every frame it runs, while `autoFireTick` writes the
      // cooldown it starts. Sampled afterwards it always answers "cooling", and
      // sampled only when she can see would leave a stale answer standing her
      // in melee range of something behind a pillar that she can neither shoot
      // nor reach.
      this.catMissileWasReady = cat.missileCooldownCurrent === 0;
      if (cat.autoTarget && this.hasSightLine(cat, cat.autoTarget)) {
        // The missile first, always, and the claw in the gaps between casts.
        // Her missile out-damages her claw several times over at every ability
        // level, so a swipe that costs her a shot is a straight loss — but the
        // frames between shots used to be frames a companion with one attack
        // spent doing nothing at all, however close the thing chewing on her
        // was. That is what the claw is for.
        // Captured first: `autoFireTick` drops the target if it died between
        // acquisition and the shot, and the distance test below would then be
        // measured against nothing.
        const target = cat.autoTarget;
        const fired = cat.autoFireTick();
        if (!fired && this.centreDistance(cat, target) <= cat.getMeleeRange()) {
          cat.autoMeleeTick();
        }
      }
    } else {
      // Clear human's target if it's dead or became an avoid-instead mob
      if (human.autoTarget && (!human.autoTarget.isAlive || human.autoTarget.avoidInstead))
        human.autoTarget = null;

      // Also clear if the current target is in an untriggered boss room
      if (human.autoTarget && isUntriggeredBossRoomMob(human.autoTarget, cat))
        human.autoTarget = null;

      // Same rule the other way round: he answers whatever is hitting him
      // regardless of the leash, and only goes looking for a fight when he is
      // close enough to the player to be allowed one. A recall silences both,
      // as it does for the cat — a companion being called back should not be
      // picking new fights on the way.
      if (!this._followOverride) {
        human.autoTarget ??= this.findMobTargetingNear(
          mobGrid,
          human,
          human,
          nearPlayerRange,
          cat,
          isUntriggeredBossRoomMob,
        );
      }

      if (!human.autoTarget && !this._followOverride && !chaseBlocked) {
        if (this.humanStance.combatStance === 'aggressive') {
          let closestDist = HUMAN_ENGAGE_RANGE;
          let closest: Mob | null = null;
          const nearHuman = mobGrid.queryCircle(human.x, human.y, HUMAN_ENGAGE_RANGE);
          for (const mob of nearHuman) {
            if (!mob.isAlive || !mob.isHostile || mob.avoidInstead) continue;
            if (this.targetBans.has(mob)) continue;
            if (isUntriggeredBossRoomMob(mob, cat)) continue;
            const dist = Math.hypot(mob.x - human.x, mob.y - human.y);
            if (dist >= closestDist) continue;
            // Picking an unseen target is what sent the companion jogging into a
            // wall to fight something on the other side of it. A mob that has
            // actually spat on somebody — or been hit by somebody — is exempt:
            // that fight is a known fact, wall or no wall. A vespa that has
            // merely locked on through the bricks is not, and it was exactly
            // that exemption that walked the human companion off the map.
            const bloodDrawn = mob.hasStruckPlayer || mob.wasDamagedByParty;
            if (!bloodDrawn && !this.hasSightLine(human, mob)) continue;
            closestDist = dist;
            closest = mob;
          }
          human.autoTarget = closest;
        }
      }

      if (human.autoTarget && this.hasSightLine(human, human.autoTarget)) human.autoFightTick();
    }
  }

  /** Centre-to-centre distance between two tile-aligned entities, in world pixels. */
  private centreDistance(
    a: { readonly x: number; readonly y: number },
    b: { readonly x: number; readonly y: number },
  ): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Counts every active target ban down, dropping the ones that have run out. */
  private tickTargetBans(): void {
    for (const [mob, framesLeft] of this.targetBans) {
      if (framesLeft <= 1) this.targetBans.delete(mob);
      else this.targetBans.set(mob, framesLeft - 1);
    }
  }

  /**
   * Drops the companion's target once the chase has pulled it further from the
   * active player than {@link COMPANION_LEASH_PX}, and bans that mob briefly.
   *
   * Both halves are required. A drop on its own re-acquires the same mob the
   * frame the companion gets home — it is still the nearest thing in range —
   * and the companion spends the rest of the fight running laps. That is the
   * lesson `Mongo`'s own leash had to learn, and the ban is what ends it.
   *
   * A mob that has drawn blood recently *and is still beside the party* is
   * exempt from the ban, though never from the drop — so a chaser that follows
   * the player home is picked straight back up, and nobody is left spectating a
   * mauling. Exempting it from the drop as well was worse than not exempting it
   * at all: anything that lands a hit every second or so then pins the
   * companion at whatever range it likes.
   *
   * An anchored companion is exempt entirely. It is not chasing anything — the
   * player parked it — and it already has a leash of its own to its anchor.
   *
   * So is a locked boss room, which is wider than the leash is long: the party
   * is sealed in with the boss and neither of them can leave, so the distance
   * the leash measures is the fight working as designed rather than a chase
   * getting away from anybody. Cutting the companion loose there strands the
   * player alone with a boss for as long as they hang back.
   */
  private isLeashStretched(
    human: HumanPlayer,
    cat: CatPlayer,
    bossRoom: BossRoomSystem | undefined,
  ): boolean {
    if (this.stanceFor(human.isActive).movementMode !== 'follow') return false;
    const companion = human.isActive ? cat : human;
    const activePlayer = human.isActive ? human : cat;
    if (this.sealedInTogether(companion, activePlayer, bossRoom)) return false;
    return this.centreDistance(companion, activePlayer) > COMPANION_LEASH_PX;
  }

  /**
   * Whether both crawlers are shut inside the same boss room.
   *
   * A boss room is wider than the leash is long, so the two of them are
   * routinely further apart inside one than the leash allows — and neither can
   * leave. Cutting the companion loose there strands the player alone with a
   * boss for as long as they hang back.
   *
   * Both of them, in the *same* room, deliberately. Asking merely whether any
   * room on the floor is locked switched the leash off floor-wide for the whole
   * of every boss encounter, including for a companion that was outside the
   * bounds when the door shut and is under no clamp at all — which is the
   * cross-map runaway, re-enabled at exactly the time adds are on the floor.
   */
  private sealedInTogether(
    companion: HumanPlayer | CatPlayer,
    activePlayer: HumanPlayer | CatPlayer,
    bossRoom: BossRoomSystem | undefined,
  ): boolean {
    if (!bossRoom) return false;
    for (const state of bossRoom.getBossRoomStates()) {
      if (!state.locked) continue;
      if (
        bossRoom.isEntityInRoom(activePlayer, state.bounds) &&
        bossRoom.isEntityInRoom(companion, state.bounds)
      ) {
        return true;
      }
    }
    return false;
  }

  private breakStretchedLeash(human: HumanPlayer, cat: CatPlayer, stretched: boolean): void {
    if (!stretched) return;
    const companion = human.isActive ? cat : human;
    const activePlayer = human.isActive ? human : cat;
    const quarry = companion.autoTarget;
    if (quarry === null) return;

    // Always dropped. Holding it instead — however good the reason — leaves the
    // companion pathing at something up to ninety-six tiles away with nothing
    // bounding it, which is the runaway this whole leash exists to end.
    companion.autoTarget = null;

    // Recently, not ever. `hasStruckPlayer` is a latch that never clears, so a
    // wasp that spat on somebody once at the start of the floor would be exempt
    // for the rest of it — the original runaway again, wearing the exemption
    // meant to prevent a different one.
    const stillBiting = quarry.framesSinceStruckPlayer < COMPANION_TARGET_BAN_FRAMES;
    // And still where the *player* is. Measured against the companion instead,
    // or as well, the clause is satisfied by construction — the mob it just
    // chased is the mob it is now standing next to — so the ban is never set
    // and the same target is re-acquired on the same frame, forever. A chaser
    // that follows the player home is picked straight back up, which is the
    // whole point of the exemption; an archer plinking from where it stands is
    // left behind, which is the whole point of the leash.
    const nearParty = this.centreDistance(quarry, activePlayer) <= COMPANION_LEASH_PX;
    if (stillBiting && nearParty) return;
    this.targetBans.set(quarry, COMPANION_TARGET_BAN_FRAMES);
  }

  /**
   * The nearest engageable mob that is chasing `quarry` and is itself within
   * `range` of `centre` — always the quarry's own neighbourhood, so the answer
   * to "is something biting this crawler" does not depend on where the *other*
   * crawler happens to be standing. What stops the companion running back
   * across the level to a fight the player has left is the leash, which bounds
   * the whole acquisition before this is ever called.
   *
   * `activePlayer` is passed on to the boss-room veto, which asks whether the
   * player driving the party is standing in the room; it is not always the same
   * crawler as `centre` or as `quarry`.
   */
  private findMobTargetingNear(
    mobGrid: SpatialGrid<Mob>,
    centre: { readonly x: number; readonly y: number },
    quarry: HumanPlayer | CatPlayer,
    range: number,
    activePlayer: HumanPlayer | CatPlayer,
    isUntriggeredBossRoomMob: (mob: Mob, activePlayer: { x: number; y: number }) => boolean,
  ): Mob | null {
    this._proximityQuery.clear();
    const nearby = mobGrid.queryCircle(centre.x, centre.y, range, this._proximityQuery);
    // Genuinely the nearest, rather than whichever the grid's Set happened to
    // hand over first. At this radius several mobs routinely qualify, and a
    // companion that picks an arbitrary one of them fights a different enemy
    // depending on spawn order.
    let closest: Mob | null = null;
    let closestDistSq = range * range;
    for (const mob of nearby) {
      if (!mob.isAlive || mob.avoidInstead) continue;
      if (mob.currentTarget !== quarry) continue;
      if (this.targetBans.has(mob)) continue;
      if (isUntriggeredBossRoomMob(mob, activePlayer)) continue;
      const dx = mob.x - centre.x;
      const dy = mob.y - centre.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= closestDistSq) continue;
      closestDistSq = distSq;
      closest = mob;
    }
    return closest;
  }

  private fleeFromAvoidMobs(
    companion: HumanPlayer | CatPlayer,
    mobGrid: SpatialGrid<Mob>,
    fleeRadius: number,
  ): boolean {
    let closest: Mob | null = null;
    let closestDistSq = fleeRadius * fleeRadius;
    // Centres cancel in the difference, so the query and the compare can both
    // use raw origins.
    this._proximityQuery.clear();
    const nearby = mobGrid.queryCircle(companion.x, companion.y, fleeRadius, this._proximityQuery);
    for (const m of nearby) {
      if (!m.isAlive || !m.avoidInstead) continue;
      const dx = m.x - companion.x;
      const dy = m.y - companion.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < closestDistSq) {
        closestDistSq = distSq;
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

  /**
   * Registers a system whose damaging ground the companion should keep out of.
   * Registration rather than a constructor dependency because the hazard owners
   * (a boss room, an encounter's gas system) come and go with the encounter.
   */
  registerHazardSource(source: GroundHazardSource): void {
    if (this.hazardSources.includes(source)) return;
    this.hazardSources.push(source);
  }

  /** Move the companion out of any active hazard zone (acid puddles, gas, ...). Returns true if fleeing. */
  private fleeFromHazards(companion: HumanPlayer | CatPlayer): boolean {
    let escape: { dx: number; dy: number } | null = null;
    for (const source of this.hazardSources) {
      escape = source.getHazardEscapeVector(companion.x, companion.y);
      if (escape) break;
    }
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
    mobGrid: SpatialGrid<Mob>,
    chaseBlocked: boolean,
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
    if (this.fleeFromAvoidMobs(companion, mobGrid, TILE_SIZE * FLEE_RADIUS_MULTIPLIER)) return;
    if (this.fleeFromHazards(companion)) return;

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

    if (chaseBlocked) {
      // Past the leash, the companion's feet belong to the player whatever its
      // hands are doing. It keeps whatever it is shooting back at — being
      // stretched is not a reason to stand there and be hit — but walking home
      // stops depending on the target having been successfully dropped, which
      // is one latch too many to trust with the whole runaway.
      const activePlayer = human.isActive ? human : cat;
      this.companionFollow(
        companion,
        activePlayer.x,
        activePlayer.y,
        FOLLOWER_SPEED * RECALL_CHASE_SPEED,
        TILE_SIZE * HUMAN_PURSUE_DISTANCE,
      );
      return;
    }

    if (human.isActive) {
      if (cat.autoTarget?.isAlive) {
        const enemy = cat.autoTarget;
        if (enemy.currentTarget === cat) {
          this.doCatKite(cat, enemy, mobGrid);
        } else if (enemy.currentTarget === human) {
          if (enemy.requiresEvasion) {
            this.doCatKite(cat, enemy, mobGrid);
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

  /**
   * How far the kiting cat tries to stay from what she is fighting.
   *
   * Her casting distance whenever she has a cast to make. While the missile is
   * cooling she has nothing to protect that distance for, and giving more
   * ground costs her the only other attack she owns: her claws reach a tile and
   * a half, and the kite's usual stand-off is more than twice that, so a cat
   * holding it through a cooldown is a cat doing nothing at all.
   *
   * She still never walks *in* — the hold is clamped to wherever she already
   * is, so closing the gap is the pursuer's job and the swipe is its reward.
   *
   * And she only offers the trade at all when it is one she can win, because
   * the claw is a rounding error next to a levelled missile while the exposure
   * it buys is not: she has the smallest health pool in the game.
   */
  private catStandOff(
    cat: CatPlayer,
    enemy: Mob,
    distToEnemy: number,
    mobGrid: SpatialGrid<Mob>,
  ): number {
    if (this.catMissileWasReady) return CAT_KITE_DIST;
    if (!this.catMayTradeBlows(cat, enemy, mobGrid)) return CAT_KITE_DIST;
    return clamp(distToEnemy, cat.getMeleeRange() * CLAW_HOLD_FRACTION, CAT_KITE_DIST);
  }

  /**
   * Whether standing her ground is a fight the cat should take.
   *
   * Four refusals, each earned. A boss or a telegraphed attacker is what the
   * orbit exists for in the first place, and dodging by movement has to stay
   * possible. A crowd kills her outright: her claw answers one pursuer, and the
   * other four in a swarm simply get free hits on the six-health crawler while
   * she takes it. Once she is already hurt, the missile she can fire from
   * across the room is worth far more than the swipe she can trade for.
   *
   * And the trade has to be worth taking at all. Giving up the retreat costs
   * her roughly the same health whatever she is fighting, while what it buys
   * scales entirely with strength — so a cat who has put nothing into strength
   * spends half a six-point health pool to add two damage a swing to a missile
   * that was already killing the thing. Pricing one against the other is what
   * makes strength the stat that decides it, which is the whole reason the claw
   * exists on a companion at all. She still swipes whatever wanders into reach;
   * she simply will not stop running to arrange it.
   */
  private catMayTradeBlows(cat: CatPlayer, enemy: Mob, mobGrid: SpatialGrid<Mob>): boolean {
    if (enemy.isBoss || enemy.requiresEvasion) return false;
    if (cat.hp < cat.maxHp * CAT_BRAWL_MIN_HP_FRACTION) return false;

    const clawPerFrame = cat.getMeleeDamage() / cat.autoSwipeIntervalFrames;
    const missilePerFrame = cat.getMissileDamage() / cat.autoFireIntervalFrames;
    if (clawPerFrame < missilePerFrame) return false;

    const crowdRadius = cat.getMeleeRange() * CAT_BRAWL_CROWD_RADIUS_MULTIPLIER;
    this._proximityQuery.clear();
    let closeHostiles = 0;
    for (const mob of mobGrid.queryCircle(cat.x, cat.y, crowdRadius, this._proximityQuery)) {
      if (!mob.isAlive || !mob.isHostile) continue;
      if (this.centreDistance(cat, mob) > crowdRadius) continue;
      closeHostiles++;
      if (closeHostiles > CAT_BRAWL_MAX_CROWD) return false;
    }
    return true;
  }

  private doCatKite(cat: CatPlayer, enemy: Mob, mobGrid: SpatialGrid<Mob>): void {
    const ex = enemy.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const ey = enemy.y + TILE_SIZE * TILE_CENTER_OFFSET;
    const cx = cat.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const cy = cat.y + TILE_SIZE * TILE_CENTER_OFFSET;
    const distToEnemy = Math.hypot(cx - ex, cy - ey);
    const standOff = this.catStandOff(cat, enemy, distToEnemy, mobGrid);

    // Evasion-flagged enemies get a faster, less predictable orbit angle.
    const angleStep = enemy.requiresEvasion
      ? CAT_EVADE_ANGLE_MIN +
        Math.sin(this.catKiteAngle * CAT_EVADE_ANGLE_SIN_FACTOR) * CAT_EVADE_ANGLE_VARIATION
      : CAT_EVADE_ANGLE_STANDARD;
    this.catKiteAngle += angleStep;

    if (distToEnemy < standOff * KITE_DISTANCE_THRESHOLD) {
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
      const targetX = ex + Math.cos(this.catKiteAngle) * standOff - TILE_SIZE * TILE_CENTER_OFFSET;
      const targetY = ey + Math.sin(this.catKiteAngle) * standOff - TILE_SIZE * TILE_CENTER_OFFSET;
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
        cached = {
          path: [],
          timer: 0,
          targetTX: NO_CACHED_GOAL_TILE,
          targetTY: NO_CACHED_GOAL_TILE,
          framesSinceRecalc: MIN_REPATH_GAP_FRAMES,
        };
        this.companionPaths.set(entity, cached);
      }

      cached.timer--;
      cached.framesSinceRecalc++;
      // A diagonally moving player crosses tile boundaries constantly, so the
      // goal-change trigger alone would bypass the timer almost every frame.
      const goalTileChanged = cached.targetTX !== goalTX || cached.targetTY !== goalTY;
      const goalChangeIsDue = goalTileChanged && cached.framesSinceRecalc >= MIN_REPATH_GAP_FRAMES;
      if (cached.timer <= 0 || goalChangeIsDue) {
        const startTX = Math.floor((entity.x + ts * TILE_CENTER_OFFSET) / ts);
        const startTY = Math.floor((entity.y + ts * TILE_CENTER_OFFSET) / ts);
        const raw = this.gameMap.findPath(
          startTX,
          startTY,
          goalTX,
          goalTY,
          COMPANION_MAX_PATH_DISTANCE_TILES,
        );
        cached.path = raw.length > 1 ? raw.slice(1) : [];
        cached.timer = PATHFINDING_RECALC_FRAMES;
        cached.targetTX = goalTX;
        cached.targetTY = goalTY;
        cached.framesSinceRecalc = 0;
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
    // A crawler mid-swing keeps the facing that swing committed to. The step
    // still happens — the kite has to keep moving — but re-aiming at it would
    // draw the companion clawing the floor beside whatever she is actually
    // hitting, since the blow itself resolves against the committed facing.
    if (!entity.isSwinging) {
      entity.facingX = moveNx;
      entity.facingY = moveNy;
    }
  }
}
