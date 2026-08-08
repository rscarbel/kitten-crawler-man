import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { Mob } from './Mob';
import { TILE_SIZE } from '../core/constants';
import { normalize } from '../utils';
import { drawDangerCircle } from '../sprites/dangerTelegraph';
import {
  drawJuicerSprite,
  drawThrownDumbbell,
  drawJuicerSpeechBubble,
  JUICER_BODY_PART_KEY,
  JUICER_HEAD_CLEARANCE_TILES,
} from '../sprites/juicerSprite';
import {
  JUICER_PUNCH_IMPACT_PROGRESS,
  JUICER_SPRINT_FRAMES,
  JUICER_SPRINT_FRAME_HOLD,
  JUICER_THROW_RELEASE_PROGRESS,
} from '../sprites/juicerAttackTiming';

const JUICER_HP = 120;
const JUICER_SPEED = 1.0;
const JUICER_SPEED_ENRAGED = 1.7;
const AGGRO_RANGE_TILE_MULTIPLIER = 10;
const AGGRO_RANGE_PX = TILE_SIZE * AGGRO_RANGE_TILE_MULTIPLIER;
const THROW_RANGE_MIN_TILES = 4;
const THROW_RANGE_MIN = TILE_SIZE * THROW_RANGE_MIN_TILES;
const THROW_RANGE_MAX_TILES = 9;
const THROW_RANGE_MAX = TILE_SIZE * THROW_RANGE_MAX_TILES;
const THROW_SPEED = 7;
const THROW_DAMAGE = 3;
const THROW_WINDUP_FRAMES = 60;
const THROW_COOLDOWN_FRAMES = 90;
const PROJECTILE_TTL = 240;
const THROW_BOUNCE_DAMPING = 0.7;
const ENRAGE_THRESHOLD = 0.4;
const TAUNT_INTERVAL = 300;
/** Frames without attacking before forcing an attack grab. */
const FORCE_ATTACK_FRAMES = 300; // 5 seconds at 60 fps
const COIN_DROP_MIN = 60;
const COIN_DROP_MAX = 120;
const MASS = 10;
const DUMBBELL_PICKUP_RANGE_TILES = 1.2;
const DUMBBELL_FOLLOW_STOP_RANGE_RATIO = 0.8;
const DUMBBELL_SEEK_PATHFIND_MAX = 40;
const NO_DUMBBELL_SPEED_RATIO = 0.7;
const NO_DUMBBELL_STOP_RANGE_TILES = 3;
const NO_DUMBBELL_PATHFIND_MAX = 40;
const THROW_RANGE_FORCE_ATTACK_RATIO = 0.85;
const THROW_PATHFIND_MAX = 40;
const CENTER_OFFSET = 0.5;
const HIT_RADIUS_TILES = 1.5;
/** Rounded up from his measured headroom, the largest overhang his art has. */
const JUICER_ART_MARGIN_TILES = 1.5;
const BLOCK_XP = 5;

/**
 * How much faster than his walk he covers ground on the way to a dumbbell.
 *
 * Derived from {@link Mob.moveSpeed} every frame rather than assigned to
 * `this.speed`: `applyMobLevel` multiplies speed in place, so a stored override
 * would throw the level scaling away the moment it was written back.
 */
const SPRINT_SPEED_MULTIPLIER = 1.8;
/** Inside this he drops back to a walk, so the pickup is not overshot. */
const SPRINT_MIN_DISTANCE_TILES = 2;
/**
 * Radians of sprint phase per game frame, so one cycle of the row lasts its own
 * frame count times its hold. Driving the sprint off the distance-based walk
 * phase instead undersamples a gait this fast into a vibration.
 */
const SPRINT_PHASE_STEP = (Math.PI * 2) / (JUICER_SPRINT_FRAMES * JUICER_SPRINT_FRAME_HOLD);

/** How close a target has to be before he stops throwing and starts punching. */
const PUNCH_TRIGGER_TILES = 1.7;
/** How far in front of himself his fists come down, in tiles. */
const PUNCH_REACH_TILES = 1.1;
/** Radius of the impact disc, and of the circle painted on the floor. */
const PUNCH_RADIUS_TILES = 1.8;
/**
 * Frames of rearing back before the fists land. This is the whole counter-play:
 * the circle sits on the floor for three quarters of a second and the point it
 * marks is never revised, so walking off it is always available.
 */
const PUNCH_WINDUP_FRAMES = 45;
/** Frames of settling out of the crouch before he can act again. */
const PUNCH_RECOVER_FRAMES = 30;
const PUNCH_COOLDOWN_FRAMES = 360;
const PUNCH_COOLDOWN_ENRAGED_FRAMES = 240;
const PUNCH_DAMAGE = 4;
const PUNCH_KNOCKBACK_TILES = 2.2;
const PUNCH_KNOCKBACK_FRAMES = 14;
/** Frames the wave takes to travel from his fists out to {@link PUNCH_RADIUS_TILES}. */
const PUNCH_SHOCKWAVE_FRAMES = 20;
/** Recorded on the damage so the death screen can name the fist, not the weight. */
/** Recorded on punch damage so `DeathCauseSystem` can tell it apart from a thrown dumbbell. */
export const GROUND_PUNCH_ATTACK_TYPE = 'ground_punch';

/**
 * Hit-flash lengths. Both of his attacks are heavy blows and both flash for
 * longer than an ordinary swing would.
 */
const DAMAGE_FLASH_PUNCH = 12;
const DAMAGE_FLASH_DUMBBELL = 12;
/** How far a dumbbell shoves what it hits, and over how many frames. */
const DUMBBELL_KNOCKBACK_TILES = 1.4;
const DUMBBELL_KNOCKBACK_FRAMES = 10;

/**
 * The frame of the wind-up on which the dumbbell leaves his hands.
 *
 * Compared as a frame counter rather than tested against a fraction: the
 * progress is a float and the release has to happen on exactly one frame, or
 * the throw either fires twice or never fires at all.
 */
const THROW_RELEASE_FRAME = Math.max(
  1,
  Math.round(THROW_WINDUP_FRAMES * JUICER_THROW_RELEASE_PROGRESS),
);

/**
 * How far through the throw row he is, given frames elapsed in the wind-up.
 *
 * Split at the release rather than ramped straight across, so the release frame
 * lands on {@link JUICER_THROW_RELEASE_PROGRESS} exactly whatever
 * {@link THROW_WINDUP_FRAMES} is retuned to. That equality is what closes the
 * hand-off: the sprite layer drops the held dumbbell at exactly that progress,
 * so the overlay disappears on the same frame the projectile appears rather
 * than half a second earlier.
 */
function throwProgressAt(elapsedFrames: number): number {
  if (elapsedFrames <= THROW_RELEASE_FRAME) {
    return (elapsedFrames / THROW_RELEASE_FRAME) * JUICER_THROW_RELEASE_PROGRESS;
  }
  const followThrough =
    (elapsedFrames - THROW_RELEASE_FRAME) / (THROW_WINDUP_FRAMES - THROW_RELEASE_FRAME);
  return JUICER_THROW_RELEASE_PROGRESS + followThrough * (1 - JUICER_THROW_RELEASE_PROGRESS);
}

const TAUNT_PHRASES = [
  'Bro',
  'I need a spot, bro',
  "Excuses don't lose calories",
  'What are you doing, bro?',
  'Release the beast',
  'Come at me, bro',
  'Stop it, bro',
];

type JuicerState =
  | 'idle'
  | 'seeking_dumbbell'
  | 'pursuing'
  | 'winding_up'
  | 'cooldown'
  | 'punch_windup'
  | 'punch_recover';

/** Where the ground punch landed and how far its wave has travelled. */
export interface JuicerShockwaveMarker {
  readonly x: number;
  readonly y: number;
  /** 0 on the frame the fists land, 1 when the front reaches the punch radius. */
  readonly progress: number;
  /** Where the front stops — the same radius the blow damaged. */
  readonly radiusPx: number;
  /** Stable per-wave noise seed, so the chalk does not crawl frame to frame. */
  readonly seed: number;
}

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  /** Frames in flight. Drives the spin, which a wall clock cannot do honestly. */
  age: number;
}

export class Juicer extends Mob {
  override readonly audioTag = 'juicer';
  override readonly bodyPartKey = JUICER_BODY_PART_KEY;
  readonly xpValue = 600;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'The Juicer';
  description = 'A roided-up gym rat who hurls dumbbells with reckless abandon.';
  mass = MASS;

  isEnraged = false;

  // State machine
  private state: JuicerState = 'idle';
  private windupTimer = 0;
  private cooldownTimer = 0;
  private framesSinceLastAttack = 0;
  /** True once the dumbbell has left his hands but the row is still playing. */
  private throwReleased = false;

  /** Sprinting to a dumbbell, which the sprite draws on its own rows. */
  private isSprinting = false;
  /** Sprint-cycle phase in radians, on its own clock — see {@link SPRINT_PHASE_STEP}. */
  private sprintPhase = 0;

  // Ground punch
  private punchTimer = 0;
  private punchCooldownTimer = 0;
  /**
   * Where the fists will land, in world pixels, chosen when the wind-up begins
   * and never revised. Null outside a punch.
   */
  private punchPoint: { x: number; y: number } | null = null;
  /** Frames left of the shockwave's travel; zero when no wave is running. */
  private shockwaveTimer = 0;
  /** Keeps the wave's chalk and debris from crawling between frames. */
  private shockwaveSeed = 0;

  /** Raised on the frame he rears back; the scene plays the cue. */
  punchWindupSoundPending = false;
  /** Raised on the frame his fists land. */
  punchImpactSoundPending = false;

  // Dumbbell / throw
  heldDumbbell = false;
  /** Set to signal JuicerRoomSystem to consume a nearby dumbbell pickup. */
  requestDumbbellAt: { x: number; y: number } | null = null;
  /** Target position for the nearest dumbbell (set each frame by JuicerRoomSystem). */
  nearestDumbbellPos: { x: number; y: number } | null = null;

  /** Active thrown projectile (null if not in flight). */
  private activeThrow: Projectile | null = null;

  override clearAirborneAttacks(): void {
    this.activeThrow = null;
  }
  throwAnim = 0; // 0–1 for sprite animation

  // Taunts
  private tauntPhrases = TAUNT_PHRASES;
  private tauntIndex = 0;
  private tauntTimer = 0;
  currentTaunt: string | null = null;

  private bubblePulse = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, JUICER_HP, JUICER_SPEED);
    this.isBoss = true;
  }

  protected override clearEncounterPhase(): void {
    this.isEnraged = false;
    this.setBaseSpeed(JUICER_SPEED);
    this.state = 'idle';
    this.windupTimer = 0;
    this.cooldownTimer = 0;
    this.framesSinceLastAttack = 0;
    this.heldDumbbell = false;
    this.requestDumbbellAt = null;
    this.nearestDumbbellPos = null;
    this.activeThrow = null;
    this.throwAnim = 0;
    this.throwReleased = false;
    this.isSprinting = false;
    this.sprintPhase = 0;
    this.punchTimer = 0;
    this.punchCooldownTimer = 0;
    this.punchPoint = null;
    this.shockwaveTimer = 0;
    this.punchWindupSoundPending = false;
    this.punchImpactSoundPending = false;
    this.tauntTimer = 0;
    this.currentTaunt = null;
  }

  /**
   * Where his last punch landed and how far its wave has run, or null when no
   * wave is travelling. Read by `JuicerRoomSystem`, which paints it into the
   * ground pass: drawn from `drawSelf` the wave would be clipped to his own
   * silhouette composite, and it is nearly four tiles across.
   */
  get punchShockwave(): JuicerShockwaveMarker | null {
    if (this.shockwaveTimer <= 0 || !this.isAlive) return null;
    const point = this.punchPoint;
    if (point === null) return null;
    return {
      x: point.x,
      y: point.y,
      // `shockwaveTimer - 1` over `PUNCH_SHOCKWAVE_FRAMES - 1` so the wave
      // actually reaches progress 1 on its last visible frame, rather than
      // decrementing past it and disappearing while still short of the
      // radius it is meant to sweep to.
      progress: 1 - (this.shockwaveTimer - 1) / (PUNCH_SHOCKWAVE_FRAMES - 1),
      radiusPx: this.tileSize * PUNCH_RADIUS_TILES,
      seed: this.shockwaveSeed,
    };
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    this.framesSinceLastAttack++;
    // A cooldown, unlike an attack clock, runs whether or not anyone is in
    // range — otherwise a player who backs out of the room freezes it.
    if (this.punchCooldownTimer > 0) this.punchCooldownTimer--;
    if (this.shockwaveTimer > 0) this.shockwaveTimer--;

    // Enrage check
    if (!this.isEnraged && this.hp / this.maxHp < ENRAGE_THRESHOLD) {
      this.isEnraged = true;
      this.setBaseSpeed(JUICER_SPEED_ENRAGED);
    }

    // Update thrown projectile physics
    this.updateProjectile(targets);

    const nearest = this.acquireTarget(targets, AGGRO_RANGE_PX);
    const nearestDist = nearest ? this.distanceTo(nearest) : Infinity;

    this.currentTarget = nearest;

    // Taunt cycling when aggro'd
    if (nearest) {
      this.tauntTimer++;
      this.bubblePulse++;
      if (this.tauntTimer >= TAUNT_INTERVAL || this.currentTaunt === null) {
        this.currentTaunt = this.tauntPhrases[this.tauntIndex];
        this.tauntIndex = (this.tauntIndex + 1) % this.tauntPhrases.length;
        this.tauntTimer = 0;
      }
    } else {
      this.currentTaunt = null;
      this.tauntTimer = 0;
    }

    // Checked ahead of the state machine, so a target that walks into arm's
    // reach is answered with the fists whatever he was doing about the throw.
    if (nearest !== null && this.canStartPunch(nearestDist)) this.beginPunch(nearest);

    // Decided once, ahead of the state that acts on it, so the speed the follow
    // is given, the row the sprite draws and the phase that row is sampled at
    // are all reading the same answer.
    this.isSprinting = this.shouldSprintToDumbbell();

    // State machine
    switch (this.state) {
      case 'idle':
        this.doIdleState(nearest);
        break;
      case 'seeking_dumbbell':
        this.doSeekDumbbellState(nearest);
        break;
      case 'pursuing':
        this.doPursuingState(nearest, nearestDist);
        break;
      case 'winding_up':
        this.doWindupState(nearest);
        break;
      case 'cooldown':
        this.doCooldownState(nearest);
        break;
      case 'punch_windup':
        this.doPunchWindupState(targets);
        break;
      case 'punch_recover':
        this.doPunchRecoverState(nearest);
        break;
    }

    this.sprintPhase = this.isSprinting ? this.sprintPhase + SPRINT_PHASE_STEP : 0;
  }

  /**
   * Whether he runs for the weight this frame.
   *
   * He wants it badly enough to sprint, but only while there is ground to
   * cover: inside {@link SPRINT_MIN_DISTANCE_TILES} he walks the last stretch
   * in so the pickup is not overshot.
   */
  private shouldSprintToDumbbell(): boolean {
    if (this.state !== 'seeking_dumbbell' || this.heldDumbbell) return false;
    const target = this.nearestDumbbellPos;
    if (target === null) return false;
    const distance = Math.hypot(target.x - this.x, target.y - this.y);
    return distance > TILE_SIZE * SPRINT_MIN_DISTANCE_TILES;
  }

  /**
   * Whether the fists are available this frame.
   *
   * A wind-up already under way keeps its commitment: interrupting a throw he
   * has been visibly loading for half a second to start a second attack reads
   * as the boss changing its mind, and it would cancel the one telegraph the
   * player had already begun reacting to.
   */
  private canStartPunch(nearestDist: number): boolean {
    if (this.punchCooldownTimer > 0) return false;
    if (this.state === 'winding_up') return false;
    if (this.state === 'punch_windup' || this.state === 'punch_recover') return false;
    return nearestDist <= this.tileSize * PUNCH_TRIGGER_TILES;
  }

  private beginPunch(target: Player): void {
    this.state = 'punch_windup';
    this.punchTimer = PUNCH_WINDUP_FRAMES;
    this.isMoving = false;
    this.clearAStarPath();
    this.faceToward(target);
    // Locked here and never revised. `faceToward` above already points him at
    // the target, so the fists come down a step in front of him along that
    // facing rather than wherever the player has moved to by the time they
    // land — that fixed point is the whole dodge.
    const facingLength = Math.hypot(this.facingX, this.facingY);
    const reach = this.tileSize * PUNCH_REACH_TILES;
    const stepX = facingLength === 0 ? 0 : (this.facingX / facingLength) * reach;
    const stepY = facingLength === 0 ? 0 : (this.facingY / facingLength) * reach;
    this.punchPoint = {
      x: this.x + this.tileSize * CENTER_OFFSET + stepX,
      y: this.y + this.tileSize * CENTER_OFFSET + stepY,
    };
    this.punchWindupSoundPending = true;
  }

  private doPunchWindupState(targets: Player[]): void {
    this.isMoving = false;
    // Deliberately not re-facing the target: his facing is what chose the
    // impact point, and turning with the player would leave him swinging at
    // one spot while pointing at another.
    this.punchTimer--;
    if (this.punchTimer > 0) return;
    this.resolvePunch(targets);
    this.state = 'punch_recover';
    this.punchTimer = PUNCH_RECOVER_FRAMES;
  }

  private doPunchRecoverState(nearest: Player | null): void {
    this.isMoving = false;
    if (nearest !== null) this.faceToward(nearest);
    this.punchTimer--;
    if (this.punchTimer > 0) return;
    this.state = nearest !== null ? 'seeking_dumbbell' : 'idle';
  }

  private resolvePunch(targets: Player[]): void {
    const point = this.punchPoint;
    if (point === null) return;
    const radius = this.tileSize * PUNCH_RADIUS_TILES;
    for (const target of targets) {
      if (!target.isAlive) continue;
      const cx = target.x + this.tileSize * CENTER_OFFSET;
      const cy = target.y + this.tileSize * CENTER_OFFSET;
      const dx = cx - point.x;
      const dy = cy - point.y;
      if (Math.hypot(dx, dy) > radius) continue;
      if (this.spells?.isPointInsideShell(cx, cy) === true) {
        this.spells.addBlockXp(BLOCK_XP);
        continue;
      }
      this.dealDamage(target, PUNCH_DAMAGE, GROUND_PUNCH_ATTACK_TYPE);
      target.damageFlash = DAMAGE_FLASH_PUNCH;
      // Radially away from the crater. `applyKnockback` normalises, so a target
      // standing exactly on the point is simply not shoved anywhere.
      target.applyKnockback(dx, dy, this.tileSize * PUNCH_KNOCKBACK_TILES, PUNCH_KNOCKBACK_FRAMES);
    }
    this.shockwaveTimer = PUNCH_SHOCKWAVE_FRAMES;
    // Math.random is fine here: the seed only has to be stable for one wave,
    // and nothing about the effect is replayed or persisted.
    this.shockwaveSeed = Math.random();
    this.punchImpactSoundPending = true;
    this.framesSinceLastAttack = 0;
    this.punchCooldownTimer = this.scaledCooldownFrames(
      this.isEnraged ? PUNCH_COOLDOWN_ENRAGED_FRAMES : PUNCH_COOLDOWN_FRAMES,
    );
  }

  private doIdleState(nearest: Player | null): void {
    if (nearest) {
      this.state = 'seeking_dumbbell';
    } else {
      this.doWander();
    }
  }

  private doSeekDumbbellState(nearest: Player | null): void {
    if (!nearest) {
      this.state = 'idle';
      return;
    }

    if (this.heldDumbbell) {
      this.state = 'pursuing';
      return;
    }

    // Navigate to nearest dumbbell position
    if (this.nearestDumbbellPos) {
      const dist = Math.hypot(
        this.nearestDumbbellPos.x - this.x,
        this.nearestDumbbellPos.y - this.y,
      );
      if (dist < TILE_SIZE * DUMBBELL_PICKUP_RANGE_TILES) {
        // Close enough — request pickup
        this.requestDumbbellAt = {
          x: this.nearestDumbbellPos.x,
          y: this.nearestDumbbellPos.y,
        };
      } else {
        // Derived from `moveSpeed` every frame rather than written back to
        // `speed`, which `applyMobLevel` has already multiplied in place.
        const speed = this.isSprinting ? this.moveSpeed * SPRINT_SPEED_MULTIPLIER : this.moveSpeed;
        this.followTargetAStar(
          this.nearestDumbbellPos.x,
          this.nearestDumbbellPos.y,
          speed,
          TILE_SIZE * DUMBBELL_FOLLOW_STOP_RANGE_RATIO,
          DUMBBELL_SEEK_PATHFIND_MAX,
        );
      }
    } else {
      // No dumbbell available — pursue with melee approach (wait near player)
      this.updateLastKnown(nearest);
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed * NO_DUMBBELL_SPEED_RATIO,
        TILE_SIZE * NO_DUMBBELL_STOP_RANGE_TILES,
        NO_DUMBBELL_PATHFIND_MAX,
      );
    }
  }

  private doPursuingState(nearest: Player | null, nearestDist: number): void {
    if (!nearest) {
      this.state = 'idle';
      return;
    }
    if (!this.heldDumbbell) {
      this.state = 'seeking_dumbbell';
      return;
    }

    this.updateLastKnown(nearest);

    const forceAttack = this.framesSinceLastAttack >= FORCE_ATTACK_FRAMES;

    // In throw range and has LOS → wind up (force-attack ignores minimum range)
    if (
      (nearestDist >= THROW_RANGE_MIN || forceAttack) &&
      nearestDist <= THROW_RANGE_MAX &&
      this.hasLOS(nearest)
    ) {
      this.state = 'winding_up';
      this.windupTimer = THROW_WINDUP_FRAMES;
      this.throwAnim = 0;
      this.throwReleased = false;
      return;
    }

    // Too close — back off, but only if not in force-attack mode
    if (!forceAttack && nearestDist < THROW_RANGE_MIN) {
      const dx = this.x - nearest.x;
      const dy = this.y - nearest.y;
      if (dx !== 0 || dy !== 0) {
        const n = normalize(dx, dy);
        this.moveWithCollision(n.x * this.speed, n.y * this.speed);
        this.isMoving = true;
      }
      this.faceToward(nearest);
      return;
    }

    // Too far (or forced + no LOS) — chase
    this.followTargetAStar(
      this.lastKnownTargetX,
      this.lastKnownTargetY,
      this.speed,
      forceAttack ? TILE_SIZE : THROW_RANGE_MAX * THROW_RANGE_FORCE_ATTACK_RATIO,
      THROW_PATHFIND_MAX,
    );

    // A follow that is already inside its stop range returns without writing
    // facing, which used to be invisible on a side-only sheet and now leaves him
    // standing with his back to a player he is squaring up to throw at.
    if (!this.isMoving) this.faceToward(nearest);
  }

  /**
   * The throw, from the first crouch to the end of the follow-through.
   *
   * The dumbbell leaves on {@link THROW_RELEASE_FRAME}, not on the last frame:
   * the sprite layer stops drawing the held overlay at
   * {@link JUICER_THROW_RELEASE_PROGRESS}, so releasing at the end of the row
   * left the weight existing nowhere on screen for the whole follow-through.
   * The remaining frames are the arms finishing their drive, and only then does
   * he cool down.
   */
  private doWindupState(nearest: Player | null): void {
    // A release already spent survives losing the target — the arms have to
    // finish the motion. Losing it before the release cancels the whole throw.
    if (!this.throwReleased && (!nearest || !this.heldDumbbell)) {
      this.state = 'idle';
      this.throwAnim = 0;
      return;
    }

    this.isMoving = false;
    this.windupTimer--;
    const elapsed = THROW_WINDUP_FRAMES - this.windupTimer;
    this.throwAnim = throwProgressAt(elapsed);

    if (nearest) {
      const dx = nearest.x - this.x;
      const dy = nearest.y - this.y;
      if (dx !== 0 || dy !== 0) {
        const n = normalize(dx, dy);
        this.facingX = n.x;
        this.facingY = n.y;
      }
    }

    if (!this.throwReleased && elapsed >= THROW_RELEASE_FRAME && nearest) {
      this.throwDumbbell(nearest);
    }

    if (this.windupTimer <= 0) this.enterThrowCooldown();
  }

  private doCooldownState(nearest: Player | null): void {
    this.isMoving = false;
    this.throwAnim = 0;
    this.cooldownTimer--;

    if (this.cooldownTimer <= 0) {
      this.state = nearest ? 'seeking_dumbbell' : 'idle';
    }
  }

  private throwDumbbell(target: Player): void {
    this.specialSoundPending = true;
    const ts = this.tileSize;
    const ox = this.x + ts * CENTER_OFFSET;
    const oy = this.y + ts * CENTER_OFFSET;
    const tx = target.x + ts * CENTER_OFFSET;
    const ty = target.y + ts * CENTER_OFFSET;
    const d = Math.hypot(tx - ox, ty - oy);
    if (d > 0) {
      this.activeThrow = {
        x: ox,
        y: oy,
        vx: ((tx - ox) / d) * THROW_SPEED,
        vy: ((ty - oy) / d) * THROW_SPEED,
        ttl: PROJECTILE_TTL,
        age: 0,
      };
    }
    this.heldDumbbell = false;
    this.throwReleased = true;
    this.framesSinceLastAttack = 0;
  }

  private enterThrowCooldown(): void {
    this.throwAnim = 0;
    this.throwReleased = false;
    this.state = 'cooldown';
    this.cooldownTimer = THROW_COOLDOWN_FRAMES;
  }

  private updateProjectile(targets: Player[]): void {
    if (!this.activeThrow) return;
    const proj = this.activeThrow;

    proj.ttl--;
    proj.age++;
    if (proj.ttl <= 0) {
      this.activeThrow = null;
      return;
    }

    proj.x += proj.vx;
    proj.y += proj.vy;

    // Wall bounce
    if (this.map) {
      const ts = this.tileSize;
      const tileX = Math.floor(proj.x / ts);
      const tileY = Math.floor(proj.y / ts);

      if (!this.map.isWalkable(tileX, tileY)) {
        const prevX = proj.x - proj.vx;
        const prevY = proj.y - proj.vy;
        const prevTX = Math.floor(prevX / ts);
        const prevTY = Math.floor(prevY / ts);

        // Test each axis from the previous (walkable) position so wall-tile
        // coordinates don't corrupt the other axis's check.
        const hitsWallOnX = !this.map.isWalkable(Math.floor((prevX + proj.vx) / ts), prevTY);
        const hitsWallOnY = !this.map.isWalkable(prevTX, Math.floor((prevY + proj.vy) / ts));

        if (hitsWallOnX) proj.vx *= -THROW_BOUNCE_DAMPING;
        if (hitsWallOnY) proj.vy *= -THROW_BOUNCE_DAMPING;
        // Corner hit: neither axis test caught it individually — reflect both.
        if (!hitsWallOnX && !hitsWallOnY) {
          proj.vx *= -THROW_BOUNCE_DAMPING;
          proj.vy *= -THROW_BOUNCE_DAMPING;
        }

        proj.x = prevX + proj.vx;
        proj.y = prevY + proj.vy;

        if (!this.map.isWalkable(Math.floor(proj.x / ts), Math.floor(proj.y / ts))) {
          this.activeThrow = null;
          return;
        }
      }
    }

    // Check player hit
    const ts = this.tileSize;
    const hitRadius = ts * HIT_RADIUS_TILES;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const tcx = t.x + ts * CENTER_OFFSET;
      const tcy = t.y + ts * CENTER_OFFSET;
      const dx = proj.x - tcx;
      const dy = proj.y - tcy;
      if (Math.hypot(dx, dy) < hitRadius) {
        if (this.spells?.isPointInsideShell(tcx, tcy)) {
          this.spells.addBlockXp(BLOCK_XP);
          this.activeThrow = null;
          return;
        }
        this.dealDamage(t, THROW_DAMAGE);
        t.damageFlash = DAMAGE_FLASH_DUMBBELL;
        // Shoved along the weight's own flight rather than away from him: it
        // has bounced off walls by now, and being knocked back towards the
        // thrower would read as the wrong object having hit you.
        t.applyKnockback(
          proj.vx,
          proj.vy,
          this.tileSize * DUMBBELL_KNOCKBACK_TILES,
          DUMBBELL_KNOCKBACK_FRAMES,
        );
        this.activeThrow = null;
        return;
      }
    }
  }

  /** Called by JuicerRoomSystem when it confirms a dumbbell was picked up. */
  onDumbbellPickedUp(): void {
    this.heldDumbbell = true;
    this.requestDumbbellAt = null;
  }

  protected rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    // Guaranteed crown drop
    items.push({ id: 'enchanted_crown_sepsis_whore', quantity: 1 });
    return items;
  }

  /**
   * How far through the punch row he is, or null when he is not punching.
   *
   * Mapped so the row's own impact frame lands on the frame the damage fired:
   * the wind-up and the recovery have their own lengths, so a linear ramp
   * across the pair would drift the fists away from the blow.
   */
  private get punchProgress(): number | null {
    if (this.state === 'punch_windup') {
      const elapsed = (PUNCH_WINDUP_FRAMES - this.punchTimer) / PUNCH_WINDUP_FRAMES;
      return elapsed * JUICER_PUNCH_IMPACT_PROGRESS;
    }
    if (this.state === 'punch_recover') {
      const elapsed = (PUNCH_RECOVER_FRAMES - this.punchTimer) / PUNCH_RECOVER_FRAMES;
      return JUICER_PUNCH_IMPACT_PROGRESS + elapsed * (1 - JUICER_PUNCH_IMPACT_PROGRESS);
    }
    return null;
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

    // The hit flash and the enrage tint are both `ctx.filter` values and only
    // one of them can be set, so the sprite module owns the choice between them
    // rather than each caller half-applying one.
    drawJuicerSprite(ctx, sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      sprintFrame: this.sprintPhase,
      isMoving: this.isMoving,
      isSprinting: this.isSprinting,
      punchProgress: this.punchProgress,
      throwProgress: this.throwAnim > 0 ? this.throwAnim : null,
      facingX: this.facingX,
      facingY: this.facingY,
      isEnraged: this.isEnraged,
      isDamageFlashing: this.damageFlash > 0,
      heldDumbbell: this.heldDumbbell,
    });

    // Speech bubble (drawn outside the sprite's own filter)
    if (this.currentTaunt) {
      drawJuicerSpeechBubble(ctx, sx, sy, tileSize, this.currentTaunt, this.bubblePulse);
    }

    // Active throw projectile
    if (this.activeThrow) {
      drawThrownDumbbell(
        ctx,
        this.activeThrow.x,
        this.activeThrow.y,
        camX,
        camY,
        tileSize,
        this.activeThrow.vx,
        this.activeThrow.vy,
        this.activeThrow.age,
      );
    }

    // Anchored on his own headroom rather than his tile: he stands most of two
    // tiles tall, and a bar at the default offset is drawn across his chest.
    this.renderMobHealthBar(ctx, sx, sy - tileSize * JUICER_HEAD_CLEARANCE_TILES);
  }

  /**
   * His art reaches almost a tile and a half above the tile he occupies, so the
   * default one-tile margin would cull him — and cut his head off the hit-flash
   * composite — while he was still on screen.
   */
  override get cullMarginTiles(): number {
    return JUICER_ART_MARGIN_TILES;
  }

  protected override get statusLabelClearanceTiles(): number {
    return JUICER_HEAD_CLEARANCE_TILES;
  }

  /**
   * The punch's disc, drawn **outside** the silhouette composite.
   *
   * It is anchored where the fists will land — {@link PUNCH_REACH_TILES} in
   * front of him — not on him, so it cannot live in `drawSelf`: `Player.render`
   * composites `drawSelf` into a box sized by `silhouetteMarginTiles` whenever
   * the character is hit-flashing or carrying a status, and a disc offset past
   * that box is simply cropped away. He spends most of his fight flashing, so
   * the one warning the player has to read would strobe in and out. Inside the
   * composite it would also be repainted by his own status coat.
   */
  protected override drawWorldFeedback(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
  ): void {
    super.drawWorldFeedback(ctx, sx, sy);
    if (!this.isAlive || this.state !== 'punch_windup') return;
    const point = this.punchPoint;
    if (point === null) return;
    const fade = (PUNCH_WINDUP_FRAMES - this.punchTimer) / PUNCH_WINDUP_FRAMES;
    // `sx` is `this.x - camX`, so the camera offset is recovered from it rather
    // than passed in — `drawWorldFeedback` is given screen coordinates only.
    drawDangerCircle(
      ctx,
      sx + (point.x - this.x),
      sy + (point.y - this.y),
      this.tileSize * PUNCH_RADIUS_TILES,
      fade,
    );
  }
}
