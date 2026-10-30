import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import { Mob } from './Mob';
import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../core/constants';
import { randomInt, normalize } from '../utils';
import {
  drawKrakenSprite,
  drawKrakenSubmergedSprite,
  drawKrakenEnrageGlow,
  krakenScaledArtOrigin,
  KRAKEN_BODY_PART_KEY,
  KRAKEN_ENRAGED_FILTER,
  KRAKEN_SLAM_RADIUS_TILES,
  prewarmKrakenPoseForFacing,
  prewarmKrakenSlam,
  type KrakenSlamPhase,
} from '../sprites/krakenSprite';
import { prewarmKrakenTentacle } from '../sprites/krakenTentacleSprite';
import { SLAM_RISE_SHARE, SLAM_LOOM_SHARE, SLAM_DIVE_SHARE } from '../sprites/krakenAttackTiming';
import type { KrakenTentacle } from './KrakenTentacle';
import type { TilePoint } from '../systems/bossRooms/bossRoomLayout';
import { feetPointPx } from '../map/collisionAnchors';

/**
 * Base HP for a floor-1 boss fought at levels 3–7: above the Trash Gremlin,
 * who is fought earlier on the floor and lower in the curve, and short of the
 * floor-2 bosses, since the drain before she can be hurt is already half of
 * her fight.
 */
const KRAKEN_HP = 180;
const KRAKEN_SPEED = 0;
const AGGRO_RANGE_TILE_MULTIPLIER = 12;
const AGGRO_RANGE_PX = TILE_SIZE * AGGRO_RANGE_TILE_MULTIPLIER;

/**
 * How much bigger than her own tile her art is drawn.
 *
 * The art is inflated about her feet point (`krakenScaledArtOrigin`), so it
 * stands centred on her tile. Targeting and reach stay measured from that one
 * tile's centre, exactly as for any other mob; only her collision footprint
 * grows with the art — see {@link KRAKEN_BODY_RADIUS_PX}.
 */
export const KRAKEN_VISUAL_SCALE = 3;

const KRAKEN_BODY_RADIUS_TILES = 1.5;

/**
 * How far from her centre her body keeps crawlers and other mobs.
 *
 * Measured off her rendered body at in-game size: the mantle and the roots of
 * her tentacles span about a tile and a half either side of her tile's centre
 * in every view, while the tentacle tips and the drop shadow reach well past
 * that and are left open. It also has to stay inside both crawlers'
 * `getMeleeRange`, since a crawler pressed against her stands exactly this far
 * away and must still be able to hit her.
 */
export const KRAKEN_BODY_RADIUS_PX = TILE_SIZE * KRAKEN_BODY_RADIUS_TILES;

const MELEE_RANGE_TILE_MULTIPLIER = 3;
const MELEE_RANGE_PX = TILE_SIZE * MELEE_RANGE_TILE_MULTIPLIER;
const MELEE_DAMAGE = 3;
const MELEE_WINDUP_FRAMES = 20;
const MELEE_SWING_FRAMES = 15;
const MELEE_COOLDOWN_FRAMES = 60;

const SLAM_INTERVAL_BASE = 480;
const SLAM_INTERVAL_ENRAGED = 300;
/** The slam's locked telegraph: the target is fixed when it starts and the blow lands when it ends. */
export const SLAM_SHADOW_FRAMES = 90;
export const SLAM_IMPACT_FRAMES = 20;
/** How far from the slam's target point the blow reaches. */
export const KRAKEN_SLAM_RADIUS_PX = TILE_SIZE * KRAKEN_SLAM_RADIUS_TILES;

/**
 * The slam's blow as a share of the victim's own max HP: a hard hit that a
 * healthy crawler survives twice, so standing in the red footprint is a
 * mistake to recover from rather than the end of the run.
 */
const KRAKEN_SLAM_MAX_HP_FRACTION = 0.4;

/**
 * How far from her centre the slam tentacle breaks the floor, on the bearing of
 * the slam target.
 *
 * Clear of the mantle so the rise reads as its own limb, inside the cull margin
 * her own art already claims.
 */
const SLAM_RISE_OFFSET_TILES = 1.6;

/** Where the telegraph window hands the tentacle from one slam row to the next. */
const SLAM_LOOM_START = SLAM_RISE_SHARE;
const SLAM_DIVE_START = SLAM_RISE_SHARE + SLAM_LOOM_SHARE;

/** The share of her max HP at which she enrages. */
const ENRAGE_THRESHOLD = 0.4;
const XP_VALUE = 700;
const COIN_DROP_MIN = 80;
const COIN_DROP_MAX = 150;
const MASS = 10;
const YELL_INTERVAL_MIN = 900;
const YELL_INTERVAL_MAX = 1200;
const DAMAGE_FLASH_SLAM = 12;
const DAMAGE_FLASH_SWING = 8;
const CENTER_OFFSET = 0.5;
const KRAKEN_CULL_MARGIN_TILES = 3;

/** The hit tell, brighter than the enrage tint so a landed blow always reads. */
const DAMAGE_FLASH_FILTER = 'brightness(3)';

/** How many of them she is allowed up at once. */
export const MAX_GUARD_TENTACLES = 2;

const GUARD_SPAWN_INTERVAL_BASE = 600;
/**
 * How far ahead of a guard tentacle erupting its art is warmed.
 *
 * The spawn itself is decided and executed on one frame, so the countdown is
 * the only place that knows a tentacle is coming before it is there. A second
 * and a half is longer than the whole `emerge` row and comfortably longer than
 * the cache needs to admit it a cell at a time.
 */
const GUARD_SPAWN_PREWARM_LEAD_FRAMES = 90;
const GUARD_SPAWN_INTERVAL_ENRAGED = 420;

/**
 * Where a guard tentacle comes up relative to the player: close enough that it
 * is immediately in the way, far enough that it is never on top of them when it
 * arrives.
 */
const GUARD_SPAWN_MIN_DIST_TILES = 1.5;
const GUARD_SPAWN_MAX_DIST_TILES = 2.5;

/**
 * How many bearings around the player she tries before giving the request up
 * for this interval. A boss room is open ground, so one is usually enough; a
 * player backed into a corner is the case this covers.
 */
const GUARD_SPAWN_ANGLE_ATTEMPTS = 6;

/** What a blow on her while she waits under the flood says over her head. */
const IMMUNE_LABEL = 'IMMUNE';
/**
 * Frames between two "IMMUNE" labels: short enough that every swing or spell
 * gets its own, long enough that the hits of one multi-hit blow do not stack.
 */
const IMMUNE_LABEL_THROTTLE_FRAMES = 12;

/**
 * What the room she lives in tells her. She waits submerged, immune and
 * passive, and nothing on the party's side aims at her, until the room says it
 * is drained; then her fight runs.
 */
export interface KrakenRoomControl {
  /**
   * True once the room's water is gone, which starts her fight; false puts her
   * back under, as a checkpoint taken before the drain is restored, and calls
   * off any fight in progress.
   */
  setRoomDrained(drained: boolean): void;
  /**
   * The tiles her guard tentacles rise from: the room's floor drains. With
   * none she raises them beside her target.
   */
  setGuardRisePoints(tiles: readonly TilePoint[]): void;
}

/** A slam telegraph or its impact, in world pixels, with its animation progress. */
export interface SlamMarker {
  x: number;
  y: number;
  progress: number;
}

/**
 * Where the slam tentacle is in its performance, in world pixels, for whoever
 * is drawing it this frame.
 */
export interface SlamTentacleMarker {
  phase: KrakenSlamPhase;
  /** 0–1 within {@link phase}. */
  progress: number;
  /** Where it breaks the floor beside her. */
  riseX: number;
  riseY: number;
  /** Where it comes back up, which is where the blow lands. */
  targetX: number;
  targetY: number;
  mirrored: boolean;
}

type KrakenState = 'idle' | 'melee_windup' | 'melee_swing' | 'melee_cooldown' | 'slam_charging';

export class Kraken extends Mob implements KrakenRoomControl {
  /** Its eyes are scattered along its tentacles; no one point is its head. */
  protected override get eyePlacement(): EyePlacement | null {
    return null;
  }

  readonly xpValue = XP_VALUE;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'The Kraken';
  description =
    'A rooted deep-water horror twenty feet across: a heaving mantle, a knot of tentacles and far too many eyes.';
  mass = MASS;
  override readonly audioTag = 'kraken';
  override get bodyPartKey(): string {
    return KRAKEN_BODY_PART_KEY;
  }

  isEnraged = false;

  /**
   * False until her room says its water is gone. Starts false because the
   * flooded pump room is the only place she lives, and a boss that woke on
   * the frame she spawned would fight through the room's opening scene.
   */
  private roomDrained = false;

  private guardRisePoints: readonly TilePoint[] = [];

  /** World ticks she has waited under the water, which drive its ripples. */
  private submergedTicks = 0;

  /** Set by BossRoomSystem each frame: true when the guard tentacle cap is full. */
  guardTentacleAtCap = false;

  /** Pending guard tentacle spawn positions. BossRoomSystem drains this each frame. */
  tentacleSpawns: Array<{ x: number; y: number }> = [];

  /**
   * The guard tentacles she has raised, so a called-off fight can send them
   * back under. Pruned every frame rather than held: a dead mob left in here
   * would pin it for the rest of the floor.
   */
  private readonly guardTentacles: KrakenTentacle[] = [];

  private guardSpawnTimer = GUARD_SPAWN_INTERVAL_BASE;

  /** Counts down to the next yell. Starts at 0 so the first yell fires on first aggro. */
  private yellTimer = 0;

  /**
   * Raised on the frame a slam's telegraph begins — the "look at the boss" cue,
   * separate from {@link specialSoundPending}'s yell because the two can fire
   * within the same fight without either owing the other a turn.
   */
  slamRiseSoundPending = false;

  private state: KrakenState = 'idle';
  private meleeWindupTimer = 0;
  private meleeSwingTimer = 0;
  private meleeCooldownTimer = 0;

  /**
   * Held from the moment a lash commits until it lands.
   *
   * The baked swipe row is picked off her facing, so a boss that keeps turning
   * through the windup lashes in a direction she only chose on the impact frame
   * — the telegraph would point wherever the player happened to be standing
   * last. Locking it makes the reared tentacle a promise about where the blow
   * goes.
   */
  private facingLocked = false;

  /**
   * 0–1 through the melee lash, or null when no lash is in flight.
   *
   * Derived from the swing timer rather than accumulated alongside it, so
   * retuning {@link MELEE_SWING_FRAMES} can never leave the art out of step
   * with the frame that deals the damage.
   */
  private get swipeProgress(): number | null {
    if (this.state !== 'melee_swing') return null;
    return 1 - this.meleeSwingTimer / MELEE_SWING_FRAMES;
  }

  private slamTimer: number;
  private slamTargetX = 0;
  private slamTargetY = 0;
  private slamShadowTimer = 0;
  private slamImpactTimer = 0;
  private slamActive = false;
  private slamRiseX = 0;
  private slamRiseY = 0;
  private slamMirrored = false;

  private animTime = 0;

  /**
   * Where the next slam lands and how far through its warning it is, or null
   * when no slam is charging. Rendered by `BossRoomSystem` in the ground pass:
   * the target is up to the full aggro range away from this mob, so drawing it
   * here would tie a twelve-tile-away marker to this mob's own cull margin and
   * silhouette composite box.
   */
  get slamShadow(): SlamMarker | null {
    if (!this.slamActive) return null;
    return {
      x: this.slamTargetX,
      y: this.slamTargetY,
      progress: 1 - this.slamShadowTimer / SLAM_SHADOW_FRAMES,
    };
  }

  /** Where the last slam landed and how far through its impact it is, or null. */
  get slamImpact(): SlamMarker | null {
    if (this.slamImpactTimer <= 0) return null;
    return {
      x: this.slamTargetX,
      y: this.slamTargetY,
      progress: 1 - this.slamImpactTimer / SLAM_IMPACT_FRAMES,
    };
  }

  /**
   * The slam tentacle's current beat, or null when no slam is in flight.
   *
   * Driven entirely off the same two timers the shadow and impact decals read,
   * so the art cannot drift from the telegraph it belongs to: the 90 telegraph
   * frames are divided between `rise`, `loom` and `dive` by the timing module's
   * shares, and the impact window is the `smash`.
   */
  get slamTentacle(): SlamTentacleMarker | null {
    if (this.slamActive) {
      const telegraph = 1 - this.slamShadowTimer / SLAM_SHADOW_FRAMES;
      if (telegraph < SLAM_LOOM_START) {
        return this.slamTentacleAt('rise', telegraph / SLAM_RISE_SHARE);
      }
      if (telegraph < SLAM_DIVE_START) {
        return this.slamTentacleAt('loom', (telegraph - SLAM_LOOM_START) / SLAM_LOOM_SHARE);
      }
      return this.slamTentacleAt('dive', (telegraph - SLAM_DIVE_START) / SLAM_DIVE_SHARE);
    }
    if (this.slamImpactTimer > 0) {
      return this.slamTentacleAt('smash', 1 - this.slamImpactTimer / SLAM_IMPACT_FRAMES);
    }
    return null;
  }

  private slamTentacleAt(phase: KrakenSlamPhase, progress: number): SlamTentacleMarker {
    return {
      phase,
      progress,
      riseX: this.slamRiseX,
      riseY: this.slamRiseY,
      targetX: this.slamTargetX,
      targetY: this.slamTargetY,
      mirrored: this.slamMirrored,
    };
  }

  /**
   * Its tentacles reach nearly three tiles past its one-tile footprint before
   * the visual scale-up, and the margin has to cover the *drawn* art or they
   * pop out of existence while most of them are still on screen — hence the
   * same {@link KRAKEN_VISUAL_SCALE} the art itself is drawn at.
   */
  override get cullMarginTiles(): number {
    return KRAKEN_CULL_MARGIN_TILES * KRAKEN_VISUAL_SCALE;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, KRAKEN_HP, KRAKEN_SPEED);
    this.isBoss = true;
    this.slamTimer = SLAM_INTERVAL_BASE;
  }

  /** She is rooted where she spawned; nothing she does or suffers moves her. */
  protected moveWithCollision(_dx: number, _dy: number): void {
    // Every step, shove and separation share ends here, refused.
  }

  /**
   * Nothing can push her, so whatever bumps into her takes the whole push —
   * crawlers included (`MobUpdateLoop`). Without it a crawler pressing into her
   * is handed only its mass share of the overlap and stays partly inside her.
   */
  override get separationAnchored(): boolean {
    return true;
  }

  override get collisionRadiusPx(): number {
    return KRAKEN_BODY_RADIUS_PX;
  }

  /**
   * Her pump room is wider than the activation radius, so a crawler in its far
   * corners would otherwise stop ticking her, and an unticked mob neither
   * collides nor fights. She is rooted and targets only within her aggro range,
   * so ticking her from anywhere on the floor costs one idle mob.
   */
  override get exemptFromAiActivationRadius(): boolean {
    return true;
  }

  /** She towers over a hovering fairy, so nothing flies across her. */
  override get fillsAirspace(): boolean {
    return true;
  }

  /**
   * A shove never moves her. `moveWithCollision` would swallow the motion
   * anyway; refusing it here keeps a knockback from ever starting, so nothing
   * reads her as mid-stagger.
   */
  override applyKnockback(
    _dirX: number,
    _dirY: number,
    _distancePx: number,
    _frames: number,
  ): void {
    // Refused outright rather than started and then swallowed step by step.
  }

  setRoomDrained(drained: boolean): void {
    if (drained === this.roomDrained) return;
    this.roomDrained = drained;
    if (!drained) this.clearEncounterPhase();
  }

  setGuardRisePoints(tiles: readonly TilePoint[]): void {
    this.guardRisePoints = tiles;
  }

  protected override get awaitingItsFight(): boolean {
    return !this.roomDrained;
  }

  protected override get isDamageImmune(): boolean {
    return !this.roomDrained;
  }

  protected override onDamageBlocked(): void {
    this.queueFloatingText(IMMUNE_LABEL, 'immune', {
      throttleFrames: IMMUNE_LABEL_THROTTLE_FRAMES,
    });
  }

  /** Told to her by BossRoomSystem the moment one of her tentacles is in the world. */
  registerGuardTentacle(tentacle: KrakenTentacle): void {
    this.guardTentacles.push(tentacle);
  }

  /** Run here rather than in `updateAI` because a smoke-blinded boss skips her AI entirely. */
  override tickTimers(): void {
    super.tickTimers();
    if (!this.roomDrained) this.submergedTicks++;
    this.pruneGuardTentacles();
  }

  private pruneGuardTentacles(): void {
    let kept = 0;
    for (const tentacle of this.guardTentacles) {
      if (!tentacle.isGuarding) continue;
      this.guardTentacles[kept] = tentacle;
      kept++;
    }
    this.guardTentacles.length = kept;
  }

  /**
   * A spawn request the drain has not picked up yet is the same shape as a
   * projectile in the air: it would hatch on a floor the party has left, or in
   * a world a checkpoint has already rewound.
   */
  override clearAirborneAttacks(): void {
    this.tentacleSpawns = [];
  }

  /**
   * Once enraged, never healed back out of it: the enrage is latched, and a
   * boss that was enraged at full health would read as the fight restarting
   * harder than it began.
   */
  override get fairyHealCeiling(): number {
    const pastEnrageLine = this.isEnraged || this.hp / this.maxHp <= ENRAGE_THRESHOLD;
    return pastEnrageLine ? Math.floor(this.maxHp * ENRAGE_THRESHOLD) : this.maxHp;
  }

  protected override clearEncounterPhase(): void {
    this.isEnraged = false;
    this.guardTentacleAtCap = false;
    this.tentacleSpawns = [];
    // Sent under before the registry is dropped: a fight being called off is a
    // fight that did not happen, and tentacles left standing in a room whose
    // boss is back at full health would guard her with nothing to link them to.
    for (const tentacle of this.guardTentacles) tentacle.beginRetreat();
    this.guardTentacles.length = 0;
    this.guardSpawnTimer = GUARD_SPAWN_INTERVAL_BASE;
    this.yellTimer = 0;
    this.slamRiseSoundPending = false;
    this.state = 'idle';
    this.meleeWindupTimer = 0;
    this.meleeSwingTimer = 0;
    this.meleeCooldownTimer = 0;
    this.facingLocked = false;
    this.slamTimer = SLAM_INTERVAL_BASE;
    this.slamShadowTimer = 0;
    this.slamImpactTimer = 0;
    this.slamActive = false;
    this.slamMirrored = false;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    this.animTime += 1 / WORLD_TICKS_PER_SECOND;

    if (!this.roomDrained) {
      this.currentTarget = null;
      this.isMoving = false;
      return;
    }

    if (!this.isEnraged && this.hp / this.maxHp < ENRAGE_THRESHOLD) {
      this.isEnraged = true;
    }

    const nearest = this.acquireTarget(targets, AGGRO_RANGE_PX);
    const nearestDist = nearest ? this.distanceTo(nearest) : Infinity;

    this.currentTarget = nearest;

    if (nearest) {
      if (this.yellTimer <= 0) {
        this.specialSoundPending = true;
        this.yellTimer = randomInt(YELL_INTERVAL_MIN, YELL_INTERVAL_MAX);
      } else {
        this.yellTimer--;
      }

      if (!this.facingLocked) {
        const dx = nearest.x - this.x;
        const dy = nearest.y - this.y;
        if (dx !== 0 || dy !== 0) {
          const n = normalize(dx, dy);
          this.facingX = n.x;
          this.facingY = n.y;
        }
      }
    }

    if (nearest?.isAlive === true) {
      this.guardSpawnTimer--;
      if (this.guardSpawnTimer === GUARD_SPAWN_PREWARM_LEAD_FRAMES && !this.guardTentacleAtCap) {
        prewarmKrakenTentacle();
      }
      if (this.guardSpawnTimer <= 0) {
        this.guardSpawnTimer = this.isEnraged
          ? GUARD_SPAWN_INTERVAL_ENRAGED
          : GUARD_SPAWN_INTERVAL_BASE;
        if (!this.guardTentacleAtCap) this.requestGuardTentacle(nearest);
      }
    }

    if (nearest && this.state !== 'slam_charging') {
      this.slamTimer--;
      if (this.slamTimer <= 0) {
        this.startSlam(nearest, targets);
      }
    }

    if (this.slamActive) {
      this.slamShadowTimer--;
      if (this.slamShadowTimer <= 0) {
        this.executeSlamImpact(targets);
      }
    }

    if (this.slamImpactTimer > 0) {
      this.slamImpactTimer--;
    }

    switch (this.state) {
      case 'idle':
        this.doIdleState(nearest, nearestDist);
        break;
      case 'melee_windup':
        this.doMeleeWindup();
        break;
      case 'melee_swing':
        this.doMeleeSwing(nearest);
        break;
      case 'melee_cooldown':
        this.doMeleeCooldown(nearest, nearestDist);
        break;
      case 'slam_charging':
        if (!this.slamActive && this.slamImpactTimer <= 0) {
          this.state = 'idle';
        }
        break;
    }
  }

  private doIdleState(nearest: Player | null, nearestDist: number): void {
    if (!nearest) {
      this.isMoving = false;
      return;
    }

    if (nearestDist <= MELEE_RANGE_PX) {
      this.startMeleeWindup();
    }
  }

  /**
   * The lash commits here: facing freezes for the whole windup and swing, which
   * is 20 + the 8 swing frames before the damage frame = 28 locked frames, well
   * clear of the 21-frame minimum in `docs/difficulty-fairness-rules.md`.
   */
  private startMeleeWindup(): void {
    this.state = 'melee_windup';
    this.meleeWindupTimer = MELEE_WINDUP_FRAMES;
    this.facingLocked = true;
    // The windup is the lash's only lead, and facing is frozen for all of it,
    // so the view the swing will be drawn in is already decided here.
    prewarmKrakenPoseForFacing('swipe', this.facingX, this.facingY);
  }

  private doMeleeWindup(): void {
    this.meleeWindupTimer--;

    if (this.meleeWindupTimer <= 0) {
      this.state = 'melee_swing';
      this.meleeSwingTimer = MELEE_SWING_FRAMES;
    }
  }

  private doMeleeSwing(nearest: Player | null): void {
    this.meleeSwingTimer--;

    if (this.meleeSwingTimer === Math.floor(MELEE_SWING_FRAMES / 2) && nearest?.isAlive) {
      const dist = Math.hypot(nearest.x - this.x, nearest.y - this.y);
      if (dist <= MELEE_RANGE_PX) {
        this.dealDamage(nearest, MELEE_DAMAGE, 'melee');
        nearest.damageFlash = DAMAGE_FLASH_SWING;
      }
    }

    if (this.meleeSwingTimer <= 0) {
      this.state = 'melee_cooldown';
      this.meleeCooldownTimer = MELEE_COOLDOWN_FRAMES;
      this.facingLocked = false;
    }
  }

  private doMeleeCooldown(nearest: Player | null, nearestDist: number): void {
    this.meleeCooldownTimer--;
    if (this.meleeCooldownTimer <= 0) {
      if (nearest && nearestDist <= MELEE_RANGE_PX) {
        this.startMeleeWindup();
      } else {
        this.state = 'idle';
      }
    }
  }

  /**
   * Queues one tentacle to come up near this player: from a floor drain when
   * the room gave her any, otherwise beside them.
   *
   * The bearing is filtered here only to avoid asking for a spawn inside a
   * wall; whether the ground is somewhere a fight can happen is decided by the
   * spawn pass in `BossRoomSystem`, which owns the map the request lands on.
   */
  private requestGuardTentacle(target: Player): void {
    if (this.guardRisePoints.length > 0) {
      const drain = this.drainNearest(target);
      if (drain !== null) {
        this.tentacleSpawns.push({
          x: (drain.x + CENTER_OFFSET) * this.tileSize,
          y: (drain.y + CENTER_OFFSET) * this.tileSize,
        });
      }
      return;
    }
    const ts = this.tileSize;
    const centreX = target.x + ts * CENTER_OFFSET;
    const centreY = target.y + ts * CENTER_OFFSET;
    const spread = GUARD_SPAWN_MAX_DIST_TILES - GUARD_SPAWN_MIN_DIST_TILES;
    for (let attempt = 0; attempt < GUARD_SPAWN_ANGLE_ATTEMPTS; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distTiles = GUARD_SPAWN_MIN_DIST_TILES + Math.random() * spread;
      const x = centreX + Math.cos(angle) * ts * distTiles;
      const y = centreY + Math.sin(angle) * ts * distTiles;
      const tileX = Math.floor(x / ts);
      const tileY = Math.floor(y / ts);
      if (this.map !== null && !this.map.isWalkable(tileX, tileY, this.mobility)) continue;
      this.tentacleSpawns.push({ x, y });
      return;
    }
  }

  /**
   * The free drain closest to `target` that is not right under them, so a
   * tentacle is in their way the moment it is up without rising on top of
   * them. A drain under them is used only when it is the one free drain.
   */
  private drainNearest(target: Player): TilePoint | null {
    const ts = this.tileSize;
    const targetX = target.x / ts + CENTER_OFFSET;
    const targetY = target.y / ts + CENTER_OFFSET;
    let best: TilePoint | null = null;
    let bestDist = Infinity;
    let fallback: TilePoint | null = null;
    let fallbackDist = Infinity;
    for (const drain of this.guardRisePoints) {
      if (this.drainOccupied(drain)) continue;
      const dist = Math.hypot(drain.x + CENTER_OFFSET - targetX, drain.y + CENTER_OFFSET - targetY);
      if (dist < fallbackDist) {
        fallbackDist = dist;
        fallback = drain;
      }
      if (dist < GUARD_SPAWN_MIN_DIST_TILES) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = drain;
      }
    }
    return best ?? fallback;
  }

  private drainOccupied(drain: TilePoint): boolean {
    const ts = this.tileSize;
    return this.guardTentacles.some(
      (tentacle) =>
        Math.floor(tentacle.x / ts + CENTER_OFFSET) === drain.x &&
        Math.floor(tentacle.y / ts + CENTER_OFFSET) === drain.y,
    );
  }

  private startSlam(primary: Player, targets: Player[]): void {
    const ts = this.tileSize;

    let slamTarget = primary;
    let bestDist = Math.hypot(primary.x - this.x, primary.y - this.y);
    for (const t of targets) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < bestDist) {
        bestDist = d;
        slamTarget = t;
      }
    }

    const targetFeet = feetPointPx(slamTarget, ts);
    this.slamTargetX = targetFeet.x;
    this.slamTargetY = targetFeet.y;

    // Snapshotted with the target and never revised: the rise is the first half
    // of the same promise the ring makes, and a tentacle that slid around her
    // as the player circled would be telling them the slam had been re-aimed.
    //
    // On the target's bearing rather than a fixed side, which puts it north of
    // her whenever the slam is north. The tentacle is painted in the ground
    // pass, under the Y-sorted body, so an anchor on the far side of her from
    // the target would have the body eat it.
    const bodyCentreX = this.x + ts * CENTER_OFFSET;
    const bodyCentreY = this.y + ts * CENTER_OFFSET;
    const bearing = normalize(this.slamTargetX - bodyCentreX, this.slamTargetY - bodyCentreY);
    this.slamRiseX = bodyCentreX + bearing.x * ts * SLAM_RISE_OFFSET_TILES;
    this.slamRiseY = bodyCentreY + bearing.y * ts * SLAM_RISE_OFFSET_TILES;
    this.slamMirrored = this.slamTargetX < bodyCentreX;

    this.slamShadowTimer = SLAM_SHADOW_FRAMES;
    this.slamActive = true;
    this.slamRiseSoundPending = true;
    this.state = 'slam_charging';
    // The telegraph is a second and a half of warning, and it is the only lead
    // either the braced body or the risen tentacle ever gets.
    prewarmKrakenPoseForFacing('channel', this.facingX, this.facingY);
    prewarmKrakenSlam();

    const interval = this.isEnraged ? SLAM_INTERVAL_ENRAGED : SLAM_INTERVAL_BASE;
    this.slamTimer = interval;
  }

  private executeSlamImpact(targets: Player[]): void {
    this.slamActive = false;
    this.slamImpactTimer = SLAM_IMPACT_FRAMES;

    const ts = this.tileSize;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const feet = feetPointPx(t, ts);
      const dx = feet.x - this.slamTargetX;
      const dy = feet.y - this.slamTargetY;
      if (Math.hypot(dx, dy) < KRAKEN_SLAM_RADIUS_PX) {
        // Priced as a share of the victim's own health, which already scales
        // with the party; level-scaling it again would count that twice.
        const blow = Math.ceil(t.maxHp * KRAKEN_SLAM_MAX_HP_FRACTION);
        this.dealPreScaledRangedDamage(t, blow, 'slam');
        t.damageFlash = DAMAGE_FLASH_SLAM;
      }
    }
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;
    const artTileSize = tileSize * KRAKEN_VISUAL_SCALE;
    const art = krakenScaledArtOrigin(this.x - camX, this.y - camY, tileSize, artTileSize);

    if (!this.roomDrained) {
      this.paintSpriteMeasuringTop(ctx, art.y, () => {
        drawKrakenSubmergedSprite(ctx, art.x, art.y, artTileSize, this.submergedTicks, {
          facingX: this.facingX,
          facingY: this.facingY,
        });
      });
      return;
    }

    // Underlay, so the tint the sprite is drawn through never touches it.
    if (this.isEnraged) {
      drawKrakenEnrageGlow(ctx, art.x, art.y, artTileSize, this.animTime);
    }

    ctx.save();
    // One filter slot, two claims on it: a hit landing outranks a standing
    // condition, so the flash wins outright rather than compounding with the
    // enrage tint into a wash neither of them reads through.
    if (this.damageFlash > 0) {
      ctx.filter = DAMAGE_FLASH_FILTER;
    } else if (this.isEnraged) {
      ctx.filter = KRAKEN_ENRAGED_FILTER;
    }

    const artTopY = this.paintSpriteMeasuringTop(ctx, art.y, () => {
      drawKrakenSprite(ctx, art.x, art.y, artTileSize, {
        facingX: this.facingX,
        facingY: this.facingY,
        swipeProgress: this.swipeProgress,
        isChanneling: this.state === 'slam_charging',
      });
    });

    ctx.restore();

    this.renderMobHealthBar(ctx, this.x - camX, this.y - camY, artTopY);
  }
}
