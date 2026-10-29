import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import { Mob } from './Mob';
import {
  ACID_LLAMA_BODY_PART_KEY,
  drawAcidLlamaSprite,
  prewarmAcidLlamaGore,
  prewarmAcidLlamaSpit,
} from '../sprites/acidLlamaSprite';
import { ACID_LLAMA_SPIT_FRAMES, acidLlamaSpitReleaseFrame } from '../sprites/acidLlamaSpitTiming';
import { prewarmAcidGlob } from '../sprites/acidGlobSprite';
import { type GlobShooter, type GlobShot, NO_GLOB_SHOTS } from '../systems/globShot';
import type { TacticsTrait } from './tactics/tacticsTraits';
import { retreatBehindHelper } from './tactics/retreat';
import type { KiteAim } from './tactics/tacticalFrame';

const ACID_LLAMA_HP = 10;
const ACID_LLAMA_SPEED = 1.0;
const AGGRO_RANGE_TILES = 8;
/** Llamas keep their distance and spit from afar */
const SPIT_RANGE_TILES = 5.5;
/** Frames between spits (~2.5 s at 60 fps) */
const SPIT_COOLDOWN = 150;
const ACID_GLOB_DAMAGE = 2;
const COIN_DROP_MIN = 4;
const COIN_DROP_MAX = 5;
const CENTER_OFFSET = 0.5;
/** An even coin flip, for picking which side to sidestep to. */
const HALF = 0.5;
const MOUTH_OFFSET_X = 0.22;
const MOUTH_OFFSET_Y = 0.22;
const FOLLOW_STOP_RANGE_TILES = 1.5;
const FOLLOW_CLOSE_RANGE_RATIO = 0.85;

/**
 * The level at which a llama starts working the ground between shots.
 *
 * Gated rather than universal so floor 1's opening llamas — the first ranged
 * enemy a crawler meets — stay the stationary target they are today, and the
 * behaviour arrives as something the player notices the animal *learning*.
 */
const EVASIVE_MIN_LEVEL = 4;

/** Tiles a llama sidesteps perpendicular to its shot after taking it. */
const STRAFE_MIN_TILES = 1;
const STRAFE_MAX_TILES = 2;

/** Closer than this and the llama gives ground rather than firing point-blank. */
const RETREAT_TRIGGER_TILES = 2.5;
/** How far it tries to open the gap back up to. */
const RETREAT_TARGET_TILES = 4;
/**
 * Ceiling on a single retreat, in frames, and the wait before another may start.
 *
 * Both exist for the same reason: a llama that can always open the gap is a
 * llama that can never be caught, which is the frustrating version of this
 * behaviour rather than the pressuring one. Backing off is something it gets to
 * do once per exchange, not a permanent state.
 */
const RETREAT_MAX_FRAMES = 60;
const RETREAT_COOLDOWN_FRAMES = 180;

/**
 * The value `spitAnimTimer` holds on the release frame.
 *
 * The timer counts *down*, so it is the animation's length minus the elapsed
 * frame the shared timing module names.
 */
const SPIT_RELEASE_TIMER = ACID_LLAMA_SPIT_FRAMES - acidLlamaSpitReleaseFrame();

const ACID_LLAMA_TACTICS: readonly TacticsTrait[] = ['kite', 'regroup'];

/** Where its eyes sit, for eye-shine in the dark. The head rides high and forward on the long neck, above the tile. */
const ACID_LLAMA_EYES: EyePlacement = {
  sideForward: 0.36,
  sideHeight: -0.2,
  sideSpacing: 0.05,
  frontMirrors: false,
  frontAcross: 0,
  frontHeight: -0.26,
  frontSpacing: 0.12,
};

export class AcidLlama extends Mob implements GlobShooter {
  protected override get eyePlacement(): EyePlacement {
    return ACID_LLAMA_EYES;
  }

  readonly xpValue = 8;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  override readonly audioTag = 'acid_llama';
  override get bodyPartKey(): string {
    return ACID_LLAMA_BODY_PART_KEY;
  }
  displayName = 'Acid Llama';
  description = 'Hawks up globs of acid that splash into a toxic puddle where they land.';
  private spitCooldown = 0;
  private spitAnimTimer = 0;
  /**
   * Shots fired but not yet handed to `GlobProjectileSystem`, which drains this
   * every frame. The llama never owns a glob in flight: it stops being updated
   * and drawn the instant it dies, and a projectile stored here would be
   * deleted in mid-air along with it.
   */
  private pendingGlobs: GlobShot[] = [];

  override clearAirborneAttacks(): void {
    this.pendingGlobs = [];
  }

  override get globShooter(): GlobShooter {
    return this;
  }
  private aggroRangePx: number;
  private spitRangePx: number;
  private isAggro = false;
  /** Frames left in the current sidestep, and the direction it runs in. */
  private strafeFrames = 0;
  private strafeDirX = 0;
  private strafeDirY = 0;
  /** Set on the release frame; the sidestep itself waits for the animation to finish. */
  private strafeQueued = false;
  /** Frames left in the current backpedal, and the wait before another may start. */
  private retreatFrames = 0;
  private retreatCooldown = 0;
  /**
   * Whether this llama has already warmed the rows a fight needs.
   *
   * The spit rows and the eight severed pieces are both requested with no
   * warning of their own — the wind-up draws its first frame the frame it
   * starts, and a body comes apart into all eight pieces at once — so they are
   * warmed off the one thing that does precede them: noticing a target, which
   * happens a whole approach before either is drawn.
   */
  private hasWarmedForCombat = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, ACID_LLAMA_HP, ACID_LLAMA_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.spitRangePx = tileSize * SPIT_RANGE_TILES;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.spitCooldown = 0;
    this.spitAnimTimer = 0;
    this.pendingGlobs = [];
    this.isAggro = false;
    this.strafeFrames = 0;
    this.strafeQueued = false;
    this.retreatFrames = 0;
    this.retreatCooldown = 0;
  }

  /**
   * A spitter that works alongside its own herd: it can learn to fall back so
   * another llama stands between it and the player, and to fall back on one
   * when hurt. Never `block` — nothing about a llama turns a blow aside.
   *
   * Its own spits leave the puddles the tactics treat as marked ground, which
   * is safe here because every puddle lands where the player was standing: a
   * kite leads away from the player, and one that would cross a puddle is refused
   * and retried rather than taken, while the llama spits on as it always has.
   */
  protected override get tacticsEligibility(): readonly TacticsTrait[] {
    return ACID_LLAMA_TACTICS;
  }

  /** A spitter regroups behind its friend, never up to it and into the fight. */
  protected override get regroupAim(): KiteAim {
    return retreatBehindHelper;
  }

  /** Whether this llama is experienced enough to move between shots. */
  private get isEvasive(): boolean {
    return this.mobLevel >= EVASIVE_MIN_LEVEL;
  }

  takePendingGlobs(): readonly GlobShot[] {
    if (this.pendingGlobs.length === 0) return NO_GLOB_SHOTS;
    const globs = this.pendingGlobs;
    this.pendingGlobs = [];
    return globs;
  }

  updateAI(targets: Player[]) {
    if (!this.isAlive) return;

    if (this.spitCooldown > 0) this.spitCooldown--;
    if (this.retreatCooldown > 0) this.retreatCooldown--;

    const nearest = this.acquireTarget(targets, this.aggroRangePx);
    this.currentTarget = nearest;
    if (nearest !== null && !this.hasWarmedForCombat) {
      this.hasWarmedForCombat = true;
      prewarmAcidLlamaSpit();
      prewarmAcidLlamaGore();
    }

    // The wind-up runs to completion whatever happens to the target: it is the
    // player's warning that a shot is coming, and a llama that abandons it
    // mid-charge because the player stepped behind a pillar has told them a lie.
    //
    // It does keep tracking until the moment it commits, though. Facing locked
    // from the first frame of a 26-frame charge, a llama that a player simply
    // walks around fires at where they used to be — and worse, plays a
    // forward-facing spit while the glob leaves in the opposite direction.
    if (this.spitAnimTimer > 0) {
      this.spitAnimTimer--;
      this.isMoving = false;
      this.isAggro = nearest !== null;
      if (this.spitAnimTimer > SPIT_RELEASE_TIMER && nearest) this.faceToward(nearest);
      if (this.spitAnimTimer === SPIT_RELEASE_TIMER) this.releaseSpit();
      return;
    }

    if (!nearest) {
      this.isAggro = false;
      this.strafeFrames = 0;
      this.strafeQueued = false;
      this.retreatFrames = 0;
      this.tactics.disengage();
      this.clearAStarPath();
      this.doWander();
      return;
    }
    this.isAggro = true;
    const nearestDist = this.distanceTo(nearest);

    const targetCX = nearest.x + this.tileSize * CENTER_OFFSET;
    const targetCY = nearest.y + this.tileSize * CENTER_OFFSET;
    const launch = this.launchPoint();

    const hasLOS = this.map
      ? this.map.hasLineOfSight(launch.x, launch.y, targetCX, targetCY)
      : true;

    if (hasLOS) {
      this.lastKnownTargetX = nearest.x;
      this.lastKnownTargetY = nearest.y;
    }

    // A kite or regroup outranks the llama's own backpedal and sidestep: it is
    // this exchange's retreat, so both are cancelled and the backpedal's
    // cooldown spent rather than left to follow straight on. Like the
    // backpedal, it never spits on the move — the wind-up waits for the walk
    // to end, which the kite's frame cap bounds. Only reached between
    // wind-ups — one returns before this — so breaking off here never abandons
    // a committed spit.
    const tacticalMove = this.chooseTacticalStep(
      nearest,
      this.tileSize * RETREAT_TRIGGER_TILES,
      true,
      retreatBehindHelper,
    );
    if (tacticalMove?.breaksOff === true) {
      this.strafeQueued = false;
      this.strafeFrames = 0;
      this.retreatFrames = 0;
      this.retreatCooldown = RETREAT_COOLDOWN_FRAMES;
      this.walkTacticalStep(tacticalMove, nearest);
      return;
    }

    // The sidestep is queued on the release frame and started here, once the
    // spit animation has played out — begun any earlier it would run underneath
    // the animation's own hold and be over before the llama finished spitting.
    if (this.strafeQueued) {
      this.strafeQueued = false;
      this.beginStrafe(nearest);
    }
    const isCrowded = nearestDist < this.tileSize * RETREAT_TRIGGER_TILES;
    if (this.isEvasive && isCrowded && this.retreatFrames === 0 && this.retreatCooldown === 0) {
      this.retreatFrames = RETREAT_MAX_FRAMES;
      this.retreatCooldown = RETREAT_COOLDOWN_FRAMES;
      this.strafeFrames = 0;
    }

    // Movement: give ground first, then finish any sidestep, then the standing
    // behaviour — navigate toward last known pos when no LOS, hold when in range.
    if (this.retreatFrames > 0) {
      this.retreatFrames--;
      if (nearestDist >= this.tileSize * RETREAT_TARGET_TILES) {
        this.retreatFrames = 0;
        this.isMoving = false;
      } else {
        this.stepAwayFrom(nearest);
      }
    } else if (this.strafeFrames > 0) {
      this.strafeFrames--;
      this.stepInDirection(this.strafeDirX, this.strafeDirY);
    } else if (!hasLOS) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.tileSize * FOLLOW_STOP_RANGE_TILES,
      );
    } else if (nearestDist > this.spitRangePx) {
      this.followTargetAStar(
        nearest.x,
        nearest.y,
        this.speed,
        this.spitRangePx * FOLLOW_CLOSE_RANGE_RATIO,
      );
    } else {
      this.isMoving = false;
    }

    // Nothing else points a stopped llama at anything, and spitting is the whole
    // of its combat: unfaced, it fires backwards for the entire engagement. Only
    // while stopped, though — a llama pathing round a corner has to face its
    // path, or it moonwalks the whole detour.
    if (!this.isMoving) this.faceToward(nearest);

    // Begin the wind-up. The glob itself is not created here — it leaves the
    // mouth partway through the animation, on the frame the neck whips forward.
    // Never mid-retreat: giving ground is a commitment, and a llama that fired
    // while backing away would make the retreat pure profit.
    const isGivingGround = this.retreatFrames > 0;
    if (!isGivingGround && hasLOS && nearestDist <= this.spitRangePx && this.spitCooldown === 0) {
      this.spitCooldown = this.scaledCooldownFrames(SPIT_COOLDOWN);
      this.spitAnimTimer = ACID_LLAMA_SPIT_FRAMES;
      this.strafeFrames = 0;
      this.isMoving = false;
      prewarmAcidGlob();
    }
  }

  /**
   * Starts a sidestep across the shot the llama has just taken.
   *
   * Perpendicular to the target line rather than in a free direction, because
   * the point is to leave the spot the player has just been given the range of.
   * The side is a coin flip, so two llamas covering the same doorway do not
   * drift into each other's line.
   */
  private beginStrafe(target: Player): void {
    if (!this.isEvasive) return;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    const side = Math.random() < HALF ? 1 : -1;
    this.strafeDirX = (-dy / distance) * side;
    this.strafeDirY = (dx / distance) * side;
    const tiles = STRAFE_MIN_TILES + Math.random() * (STRAFE_MAX_TILES - STRAFE_MIN_TILES);
    this.strafeFrames = Math.max(1, Math.round((tiles * this.tileSize) / this.speed));
  }

  /** One frame of walking directly away from `target`. */
  private stepAwayFrom(target: Player): void {
    const dx = this.x - target.x;
    const dy = this.y - target.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    this.stepInDirection(dx / distance, dy / distance);
  }

  /**
   * One frame of walking along a unit direction, facing the way it walks.
   *
   * Facing matters as much as the movement: the sprite mirrors on `facingX`, so
   * a llama that kept aiming at the player while sidestepping would moonwalk the
   * whole way across.
   */
  private stepInDirection(dirX: number, dirY: number): void {
    this.facingX = dirX;
    this.facingY = dirY;
    this.moveWithCollision(dirX * this.speed, dirY * this.speed);
    this.isMoving = true;
  }

  /** Where the glob leaves the animal, offset toward whichever way it faces. */
  private mouthPosition(): { readonly x: number; readonly y: number } {
    return {
      x: this.x + this.tileSize * (CENTER_OFFSET + MOUTH_OFFSET_X * Math.sign(this.facingX || 1)),
      y: this.y + this.tileSize * MOUTH_OFFSET_Y,
    };
  }

  /**
   * Where the glob actually leaves from: the mouth, or the nearest point short
   * of it when the head is pressed into a wall.
   *
   * Sight is judged from here rather than from the mouth because a line-of-sight
   * test never checks its own starting tile: from a mouth inside a wall it would
   * see straight out the far side of that wall, and the llama would wind up at a
   * target its glob could never reach.
   */
  private launchPoint(): { readonly x: number; readonly y: number } {
    const mouth = this.mouthPosition();
    if (!this.map) return mouth;
    return this.map.clearLaunchPoint(
      this.x + this.tileSize * CENTER_OFFSET,
      this.y + this.tileSize * CENTER_OFFSET,
      mouth.x,
      mouth.y,
    );
  }

  /**
   * Queues one shot, aimed at wherever the target is on the release frame
   * rather than where it was when the wind-up began — otherwise the telegraph
   * is free to dodge and the attack never lands on a moving player.
   */
  private releaseSpit(): void {
    const target = this.currentTarget;
    const mouth = this.launchPoint();
    const aimX = target ? target.x + this.tileSize * CENTER_OFFSET : mouth.x + this.facingX;
    const aimY = target ? target.y + this.tileSize * CENTER_OFFSET : mouth.y + this.facingY;
    const dirX = aimX - mouth.x;
    const dirY = aimY - mouth.y;
    // A target standing exactly on the mouth would give a zero direction, which
    // normalises to NaN and produces a glob that never moves and never expires.
    const degenerate = dirX === 0 && dirY === 0;
    this.pendingGlobs.push({
      kind: 'acid',
      x: mouth.x,
      y: mouth.y,
      dirX: degenerate ? this.facingX || 1 : dirX,
      dirY: degenerate ? this.facingY : dirY,
      damage: this.scaledDamage(ACID_GLOB_DAMAGE),
      mobType: this.mobType,
      mobLevel: this.mobLevel,
      // Carried unconditionally and deduplicated by the system: the interesting
      // case is a target that is neither player — a mob made hostile to its own
      // kind — which nothing else would tell the projectile about.
      aimedAt: target,
    });
    this.projectileSoundPending = true;
    this.strafeQueued = true;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ) {
    if (!this.isAlive) return;

    const sx = this.x - camX;
    const sy = this.y - camY;

    const spitProgress =
      this.spitAnimTimer > 0 ? 1 - this.spitAnimTimer / ACID_LLAMA_SPIT_FRAMES : null;

    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawAcidLlamaSprite(ctx, sx, sy, tileSize, {
        walkFrame: this.walkFrame,
        isMoving: this.isMoving,
        facingX: this.facingX,
        facingY: this.facingY,
        spitProgress,
      });
    });

    if (this.isAggro) this.renderAggroIndicator(ctx, sx, artTopY, sy, tileSize);
    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }
}
