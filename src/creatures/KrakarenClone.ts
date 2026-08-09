import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { Mob } from './Mob';
import { TILE_SIZE } from '../core/constants';
import { randomInt, normalize } from '../utils';
import {
  drawKrakarenSprite,
  drawKrakarenEnrageGlow,
  krakarenOverheadLiftTiles,
  KRAKAREN_BODY_PART_KEY,
  KRAKAREN_ENRAGED_FILTER,
  type KrakarenSlamPhase,
} from '../sprites/krakarenSprite';
import { SLAM_RISE_SHARE, SLAM_LOOM_SHARE, SLAM_DIVE_SHARE } from '../sprites/krakarenAttackTiming';
import type { KrakarenTentacle } from './KrakarenTentacle';

const KRAKAREN_HP = 260; // +30% over the original 200
const KRAKAREN_SPEED = 0; // immobile
const AGGRO_RANGE_TILE_MULTIPLIER = 12;
const AGGRO_RANGE_PX = TILE_SIZE * AGGRO_RANGE_TILE_MULTIPLIER;

/**
 * How much bigger than her own tile her art is drawn.
 *
 * She stays a one-tile mob for movement, targeting and collision — only the
 * art passed to the sprite functions is inflated, anchored on the same feet
 * point, so nothing about how she is fought changes, only how she looks.
 */
export const KRAKAREN_VISUAL_SCALE = 3;

// Melee tentacle attack
const MELEE_RANGE_TILE_MULTIPLIER = 3;
const MELEE_RANGE_PX = TILE_SIZE * MELEE_RANGE_TILE_MULTIPLIER;
const MELEE_DAMAGE = 3;
const MELEE_WINDUP_FRAMES = 20;
const MELEE_SWING_FRAMES = 15;
const MELEE_COOLDOWN_FRAMES = 60;

// Slam special attack (instant kill)
const SLAM_INTERVAL_BASE = 480; // 8 seconds
const SLAM_INTERVAL_ENRAGED = 300; // 5 seconds
const SLAM_SHADOW_FRAMES = 90; // 1.5 second warning shadow
const SLAM_IMPACT_FRAMES = 20; // visual impact duration
const SLAM_KILL_RADIUS_TILE_MULTIPLIER = 1.5;
const SLAM_KILL_RADIUS_PX = TILE_SIZE * SLAM_KILL_RADIUS_TILE_MULTIPLIER;
const SLAM_DAMAGE = 9999; // instant kill

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

const ENRAGE_THRESHOLD = 0.4; // 40% HP
const COIN_DROP_MIN = 80;
const COIN_DROP_MAX = 150;
const MASS = 10;
const YELL_INTERVAL_MIN = 900;
const YELL_INTERVAL_MAX = 1200;
const DAMAGE_FLASH_SLAM = 12;
const DAMAGE_FLASH_SWING = 8;
const CENTER_OFFSET = 0.5;
const FRAMES_PER_SECOND = 60;
const KRAKAREN_CULL_MARGIN_TILES = 3;

/** The hit tell, brighter than the enrage tint so a landed blow always reads. */
const DAMAGE_FLASH_FILTER = 'brightness(3)';

/**
 * The same tell, damped, for a blow her guard tentacles have already eaten
 * three quarters of. A quartered hit that flashed like a full one would read as
 * the health bar being broken rather than as the guard doing its job.
 */
const GUARDED_DAMAGE_FLASH_FILTER = 'brightness(1.5)';

/** What a blow is worth while any guard tentacle still stands. */
const TENTACLE_GUARD_DAMAGE_SCALE = 0.25;

/** How many of them she is allowed up at once. */
export const MAX_GUARD_TENTACLES = 2;

const GUARD_SPAWN_INTERVAL_BASE = 600;
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

/**
 * Where to hang her health bar before the sheet has loaded — roughly the height
 * the baked mantle reaches above her tile.
 */
const FALLBACK_OVERHEAD_LIFT_TILES = 1.6;

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
  phase: KrakarenSlamPhase;
  /** 0–1 within {@link phase}. */
  progress: number;
  /** Where it breaks the floor beside her. */
  riseX: number;
  riseY: number;
  /** Where it comes back up, which is where the kill lands. */
  targetX: number;
  targetY: number;
  mirrored: boolean;
}

type KrakarenState = 'idle' | 'melee_windup' | 'melee_swing' | 'melee_cooldown' | 'slam_charging';

export class KrakarenClone extends Mob {
  readonly xpValue = 700;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Krakaren Clone';
  description = 'A 20-ft immobile octopus horror with tentacles covered in human-shaped mouths.';
  mass = MASS;
  override readonly audioTag = 'krakaren';
  override readonly bodyPartKey = KRAKAREN_BODY_PART_KEY;

  isEnraged = false;

  /** Set by BossRoomSystem each frame: true when the guard tentacle cap is full. */
  guardTentacleAtCap = false;

  /** Pending guard tentacle spawn positions. BossRoomSystem drains this each frame. */
  tentacleSpawns: Array<{ x: number; y: number }> = [];

  /**
   * The tentacles she is currently hiding behind.
   *
   * Pruned every frame rather than held: a dead mob left in here would pin it
   * for the rest of the floor and — far worse — would leave her guarded by a
   * corpse, with no way for the player to work out why their damage never came
   * back.
   */
  private readonly guardTentacles: KrakarenTentacle[] = [];

  /** Cached answer to "is anything guarding me", recomputed with the prune. */
  private guarded = false;

  /**
   * Set on the frame a blow of hers was quartered, consumed on the next tick.
   *
   * The scale is read from inside a getter on the damage path, which is no
   * place to walk a list and write to other mobs; the flag is the whole of the
   * work done there.
   */
  private guardHitPending = false;

  private guardSpawnTimer = GUARD_SPAWN_INTERVAL_BASE;

  /** Counts down to the next yell. Starts at 0 so the first yell fires on first aggro. */
  private yellTimer = 0;

  /**
   * Raised on the frame a slam's telegraph begins — the "look at the boss" cue,
   * separate from {@link specialSoundPending}'s yell because the two can fire
   * within the same fight without either owing the other a turn.
   */
  slamRiseSoundPending = false;

  // State machine
  private state: KrakarenState = 'idle';
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

  // Slam attack
  private slamTimer: number;
  private slamTargetX = 0;
  private slamTargetY = 0;
  private slamShadowTimer = 0; // counts down during shadow phase
  private slamImpactTimer = 0; // counts down during impact visual
  private slamActive = false; // true while shadow is showing
  private slamRiseX = 0;
  private slamRiseY = 0;
  private slamMirrored = false;

  // Animation time
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

  private slamTentacleAt(phase: KrakarenSlamPhase, progress: number): SlamTentacleMarker {
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
   * same {@link KRAKAREN_VISUAL_SCALE} the art itself is drawn at.
   */
  override get cullMarginTiles(): number {
    return KRAKAREN_CULL_MARGIN_TILES * KRAKAREN_VISUAL_SCALE;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, KRAKAREN_HP, KRAKAREN_SPEED);
    this.isBoss = true;
    this.slamTimer = SLAM_INTERVAL_BASE;
  }

  /** Override to prevent any movement — the Krakaren Clone is immobile. */
  protected moveWithCollision(_dx: number, _dy: number): void {
    // No-op: immobile boss
  }

  /** Told to her by BossRoomSystem the moment one of her tentacles is in the world. */
  registerGuardTentacle(tentacle: KrakarenTentacle): void {
    this.guardTentacles.push(tentacle);
    this.guarded = true;
  }

  /** True while at least one guard tentacle is up and not already leaving. */
  get hasLivingGuardTentacle(): boolean {
    return this.guarded;
  }

  /**
   * A quarter of every blow while a guard tentacle stands. The player's answer
   * is to kill the tentacle, which is why it is a scale rather than the
   * all-or-nothing shield: the health bar still moves, just barely.
   */
  protected override get incomingDamageScale(): number {
    if (!this.guarded) return 1;
    this.guardHitPending = true;
    return TENTACLE_GUARD_DAMAGE_SCALE;
  }

  /**
   * Run here rather than in `updateAI` because a fogged boss skips her AI
   * entirely — and a guard that outlived its tentacles for the length of a
   * confusion would be a boss the player cannot hurt for no visible reason.
   */
  override tickTimers(): void {
    super.tickTimers();
    this.pruneGuardTentacles();
    if (!this.guardHitPending) return;
    this.guardHitPending = false;
    for (const tentacle of this.guardTentacles) tentacle.flashGuardPulse();
  }

  private pruneGuardTentacles(): void {
    let kept = 0;
    for (const tentacle of this.guardTentacles) {
      if (!tentacle.isGuarding) continue;
      this.guardTentacles[kept] = tentacle;
      kept++;
    }
    this.guardTentacles.length = kept;
    this.guarded = kept > 0;
  }

  /**
   * A spawn request the drain has not picked up yet is the same shape as a
   * projectile in the air: it would hatch on a floor the party has left, or in
   * a world a checkpoint has already rewound.
   */
  override clearAirborneAttacks(): void {
    this.tentacleSpawns = [];
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
    this.guarded = false;
    this.guardHitPending = false;
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

    this.animTime += 1 / FRAMES_PER_SECOND;

    // Enrage check
    if (!this.isEnraged && this.hp / this.maxHp < ENRAGE_THRESHOLD) {
      this.isEnraged = true;
    }

    const nearest = this.acquireTarget(targets, AGGRO_RANGE_PX);
    const nearestDist = nearest ? this.distanceTo(nearest) : Infinity;

    this.currentTarget = nearest;

    if (nearest) {
      // Periodic yell: fires immediately on first aggro, then every 15–20 seconds
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
      if (this.guardSpawnTimer <= 0) {
        this.guardSpawnTimer = this.isEnraged
          ? GUARD_SPAWN_INTERVAL_ENRAGED
          : GUARD_SPAWN_INTERVAL_BASE;
        if (!this.guardTentacleAtCap) this.requestGuardTentacle(nearest);
      }
    }

    // Tick slam timer (always ticks when aggro'd)
    if (nearest && this.state !== 'slam_charging') {
      this.slamTimer--;
      if (this.slamTimer <= 0) {
        this.startSlam(nearest, targets);
      }
    }

    // Tick slam shadow countdown
    if (this.slamActive) {
      this.slamShadowTimer--;
      if (this.slamShadowTimer <= 0) {
        this.executeSlamImpact(targets);
      }
    }

    // Tick slam impact visual
    if (this.slamImpactTimer > 0) {
      this.slamImpactTimer--;
    }

    // State machine for melee
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
        // Just wait for the slam shadow timer (handled above)
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

    // If target is in melee range, start a tentacle attack
    if (nearestDist <= MELEE_RANGE_PX) {
      this.startMeleeWindup();
    }
  }

  /**
   * The lash commits here: facing freezes for the whole windup and swing, which
   * is 20 + the 8 swing frames before the damage frame = 28 locked frames, well
   * clear of the 21-frame minimum in `docs/difficulty-fairness-rules.md` (P2).
   */
  private startMeleeWindup(): void {
    this.state = 'melee_windup';
    this.meleeWindupTimer = MELEE_WINDUP_FRAMES;
    this.facingLocked = true;
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

    // Deal damage at the midpoint of the swing
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
      // Immediately attack again if still in range
      if (nearest && nearestDist <= MELEE_RANGE_PX) {
        this.startMeleeWindup();
      } else {
        this.state = 'idle';
      }
    }
  }

  /**
   * Queues one tentacle to come up beside this player.
   *
   * The bearing is filtered here only to avoid asking for a spawn inside a
   * wall; whether the ground is somewhere a fight can happen is decided by the
   * drain in `BossRoomSystem`, which owns the map the request lands on.
   */
  private requestGuardTentacle(target: Player): void {
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
      if (this.map !== null && !this.map.isWalkable(tileX, tileY)) continue;
      this.tentacleSpawns.push({ x, y });
      return;
    }
  }

  private startSlam(primary: Player, targets: Player[]): void {
    // Target the nearest player's current position
    const ts = this.tileSize;

    // Pick a target — prefer the one closest to the boss
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

    this.slamTargetX = slamTarget.x + ts * CENTER_OFFSET;
    this.slamTargetY = slamTarget.y + ts * CENTER_OFFSET;

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

    const interval = this.isEnraged ? SLAM_INTERVAL_ENRAGED : SLAM_INTERVAL_BASE;
    this.slamTimer = interval;
  }

  private executeSlamImpact(targets: Player[]): void {
    this.slamActive = false;
    this.slamImpactTimer = SLAM_IMPACT_FRAMES;

    // Check if any player is in the kill zone
    const ts = this.tileSize;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dx = t.x + ts * CENTER_OFFSET - this.slamTargetX;
      const dy = t.y + ts * CENTER_OFFSET - this.slamTargetY;
      if (Math.hypot(dx, dy) < SLAM_KILL_RADIUS_PX) {
        this.dealRangedDamage(t, SLAM_DAMAGE, 'slam');
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
    const sx = this.x - camX;
    const sy = this.y - camY;
    const artTileSize = tileSize * KRAKAREN_VISUAL_SCALE;

    // Underlay, so the tint the sprite is drawn through never touches it.
    if (this.isEnraged) {
      drawKrakarenEnrageGlow(ctx, sx, sy, artTileSize, this.animTime);
    }

    ctx.save();
    // One filter slot, two claims on it: a hit landing outranks a standing
    // condition, so the flash wins outright rather than compounding with the
    // enrage tint into a wash neither of them reads through.
    if (this.damageFlash > 0) {
      ctx.filter = this.guarded ? GUARDED_DAMAGE_FLASH_FILTER : DAMAGE_FLASH_FILTER;
    } else if (this.isEnraged) {
      ctx.filter = KRAKAREN_ENRAGED_FILTER;
    }

    drawKrakarenSprite(ctx, sx, sy, artTileSize, {
      facingX: this.facingX,
      facingY: this.facingY,
      swipeProgress: this.swipeProgress,
      isChanneling: this.state === 'slam_charging',
    });

    ctx.restore();

    // Anchored on the sheet's own overhang: the default offset is a few pixels
    // above her *tile*, which on art this tall lands inside the mantle. Uses
    // the scaled-up art size so the bar clears the enlarged mantle too.
    this.renderMobHealthBar(
      ctx,
      sx,
      sy - artTileSize * krakarenOverheadLiftTiles(FALLBACK_OVERHEAD_LIFT_TILES),
    );
  }

  /**
   * She already guarantees a slingshot below, so letting the base roll compete
   * for the same rare drop could only ever produce a wasteful second one.
   */
  protected override get slingshotEligible(): boolean {
    return false;
  }

  protected override rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    items.push({ id: 'slingshot', quantity: 1 });
    return items;
  }
}
