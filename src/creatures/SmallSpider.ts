import { Mob } from './Mob';
import { maybeDropSkillBook } from './skillBookDrop';
import {
  drawSpiderSprite,
  type SpiderAnimation,
  type SpiderDeathStyle,
} from '../sprites/spiderSprite';
import type { LootDrop } from './Mob';
import type { Player } from '../Player';
import { TILE_SIZE, AGGRO_PERSIST_MULTIPLIER } from '../core/constants';

const SPIDER_HP = 20;
const SPIDER_SPEED = 3.8;
const SPIDER_XP = 15;
const SPIDER_COIN_DROP_MAX = 3;

const AGGRO_RANGE_TILES = 8;
const ATTACK_RANGE_TILES = 2.0;
const HIT_RANGE_TILES = 1.8;
const AGGRO_RANGE_PX = TILE_SIZE * AGGRO_RANGE_TILES;
const ATTACK_RANGE_PX = TILE_SIZE * ATTACK_RANGE_TILES;
const HIT_RANGE_PX = TILE_SIZE * HIT_RANGE_TILES;
const ATTACK_DAMAGE = 4;

const CROUCH_FRAMES = 22;
const POUNCE_FRAMES = 20;
const RECOVER_FRAMES = 80;

/** Where in the pounce the spider slams back down — matches the sprite row. */
const POUNCE_LANDING_PROGRESS = 0.62;
/** Fraction of the flight spent accelerating off the ground. */
const LEAP_LAUNCH_RAMP = 0.18;
/** Peak leap speed as a multiple of the walking pace. */
const LEAP_SPEED_MULTIPLIER = 2.3;
const LEAP_PEAK_SPEED = SPIDER_SPEED * LEAP_SPEED_MULTIPLIER;

/** Fraction of speed applied while backing off after a pounce. */
const RECOVER_RETREAT_SPEED_FRACTION = 0.6;
/** How far the spider backs away from its target before it settles. */
const RETREAT_RANGE_TILES = 4;
const RETREAT_RANGE_PX = TILE_SIZE * RETREAT_RANGE_TILES;

/** Shell block XP for spider attack */
const SHELL_BLOCK_XP = 2;

/** Approach fraction of attack range */
const APPROACH_STOP_FRACTION = 0.9;

const TILE_CENTER_FRACTION = 0.5;
const TAU = Math.PI * 2;

// Real spiders run in stop-start bursts rather than at a steady creep, so the
// spider dashes for a stretch, freezes, then dashes again. The burst speed is
// scaled up by the inverse of the duty cycle so the average pace still matches
// SPIDER_SPEED and the encounter stays balanced.
const SKITTER_BURST_FRAMES_MIN = 22;
const SKITTER_BURST_FRAMES_MAX = 40;
const SKITTER_PAUSE_FRAMES_MIN = 5;
const SKITTER_PAUSE_FRAMES_MAX = 12;
const SKITTER_BURST_SPEED_MULTIPLIER = 1.28;

/** Ground distance covered by one full eight-legged gait cycle. */
const STRIDE_TILES = 0.55;
const STRIDE_PIXELS = TILE_SIZE * STRIDE_TILES;
/** Frames one standing-still idle loop takes. */
const IDLE_CYCLE_FRAMES = 90;
const IDLE_CYCLE_SPEED = TAU / IDLE_CYCLE_FRAMES;

const DEATH_ANIM_FRAMES: Record<SpiderDeathStyle, number> = {
  death_curl: 78,
  death_spasm: 99,
  death_flip: 69,
};

/** How long the body lies where it fell before it starts to fade away. */
const CORPSE_LINGER_FRAMES = 900;
const CORPSE_FADE_FRAMES = 180;

/** Odds a killing blow that leaves the body intact ends in a thrashing fit. */
const SPASM_DEATH_CHANCE = 0.45;

type SpiderState = 'idle' | 'pursuing' | 'crouching' | 'pouncing' | 'recovering';

type DamageType = NonNullable<Parameters<Mob['takeDamageFrom']>[2]>;

/** Blows that throw the body clear rather than dropping it where it stood. */
const KNOCKBACK_DAMAGE_TYPES: ReadonlySet<DamageType> = new Set<DamageType>(['missile', 'smush']);

function pickDeathStyle(damageType: DamageType): SpiderDeathStyle {
  if (KNOCKBACK_DAMAGE_TYPES.has(damageType)) return 'death_flip';
  return Math.random() < SPASM_DEATH_CHANCE ? 'death_spasm' : 'death_curl';
}

function randomFrames(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Speed profile across a leap: a short kick off the ground, then a decay to a
 * dead stop at touchdown so the spider plants rather than skidding.
 */
function leapSpeedFactor(flightProgress: number): number {
  if (flightProgress < LEAP_LAUNCH_RAMP) return flightProgress / LEAP_LAUNCH_RAMP;
  const glide = (flightProgress - LEAP_LAUNCH_RAMP) / (1 - LEAP_LAUNCH_RAMP);
  return 1 - glide * glide;
}

export class SmallSpider extends Mob {
  readonly xpValue = SPIDER_XP;
  protected override coinDropMin = 0;
  protected override coinDropMax = SPIDER_COIN_DROP_MAX;
  override displayName = 'Spider';
  override description = 'A quick, venomous spider that pounces on its prey.';
  override mass = 1;

  private state: SpiderState = 'idle';
  private crouchTimer = 0;
  /** Counts down from POUNCE_FRAMES to 0. */
  private pounceTimer = 0;
  private recoverTimer = 0;
  private hasDealtDamage = false;
  /** Pixel-space direction the leap travels, locked in as the crouch releases. */
  private leapDirX = 0;
  private leapDirY = 0;

  /** Advanced by distance travelled, so the legs never skate over the ground. */
  private gaitCycle = 0;
  private idleCycle = 0;

  private skitterTimer = 0;
  private skitterPaused = false;

  /** Spiders leave a body, so kill resolution keeps them in the world. */
  override readonly rendersWhenDead = true;

  private deathStyle: SpiderDeathStyle | null = null;
  private corpseFrames = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, SPIDER_HP, SPIDER_SPEED);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.state = 'idle';
    this.crouchTimer = 0;
    this.pounceTimer = 0;
    this.recoverTimer = 0;
    this.hasDealtDamage = false;
    this.skitterTimer = 0;
    this.skitterPaused = false;
    this.deathStyle = null;
    this.corpseFrames = 0;
  }

  /**
   * Dead spiders get no AI updates, so the corpse runs off its own frame count
   * driven by kill resolution. Frames rather than wall-clock keeps the death
   * from playing out behind a pause screen.
   */
  override tickCorpse(): void {
    // Deaths that bypass takeDamageFrom still need a style to play.
    this.deathStyle ??= pickDeathStyle('melee');
    this.corpseFrames++;
  }

  override get corpseExpired(): boolean {
    return !this.isAlive && this.corpseFrames >= this._corpseTotalFrames();
  }

  private _corpseTotalFrames(): number {
    const style = this.deathStyle ?? 'death_curl';
    return DEATH_ANIM_FRAMES[style] + CORPSE_LINGER_FRAMES + CORPSE_FADE_FRAMES;
  }

  /** Skittering is a discipline. Someone wrote it down. */
  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    const items: LootDrop['items'] = [];
    maybeDropSkillBook(items, 'skill_book_cat_reflexes');
    return items;
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: DamageType = 'melee',
  ) {
    super.takeDamageFrom(amount, attacker, damageType);
    if (this.justDied && this.deathStyle === null) {
      this.deathStyle = pickDeathStyle(damageType);
    }
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    const startX = this.x;
    const startY = this.y;

    const nearest = this._findTarget(targets);
    this.currentTarget = nearest;
    const nearestDist =
      nearest === null ? Infinity : Math.hypot(nearest.x - this.x, nearest.y - this.y);

    switch (this.state) {
      case 'idle': {
        if (nearest) {
          this.state = 'pursuing';
        } else {
          this.doWander();
          if (this.wanderDx !== 0 || this.wanderDy !== 0) {
            const wanderDist = Math.hypot(this.wanderDx, this.wanderDy);
            this.facingX = this.wanderDx / wanderDist;
            this.facingY = this.wanderDy / wanderDist;
          }
        }
        break;
      }

      case 'pursuing': {
        if (!nearest) {
          this.state = 'idle';
          break;
        }
        this.updateLastKnown(nearest);

        if (nearestDist <= ATTACK_RANGE_PX) {
          this.state = 'crouching';
          this.crouchTimer = CROUCH_FRAMES;
          this.isMoving = false;
          this._faceToward(nearest);
        } else {
          this._tickSkitter();
          this._faceToward(nearest);
          if (this.skitterPaused) {
            this.isMoving = false;
          } else {
            this.followTargetCollide(
              nearest.x,
              nearest.y,
              this.speed * SKITTER_BURST_SPEED_MULTIPLIER,
              ATTACK_RANGE_PX * APPROACH_STOP_FRACTION,
            );
          }
        }
        break;
      }

      case 'crouching': {
        this.isMoving = false;
        if (nearest) this._faceToward(nearest);
        this.crouchTimer--;
        if (this.crouchTimer <= 0) {
          // The leap commits to wherever the spider was aimed at release.
          this.leapDirX = this.facingX;
          this.leapDirY = this.facingY;
          this.state = 'pouncing';
          this.pounceTimer = POUNCE_FRAMES;
          this.hasDealtDamage = false;
        }
        break;
      }

      case 'pouncing': {
        const progress = 1 - this.pounceTimer / POUNCE_FRAMES;

        if (progress < POUNCE_LANDING_PROGRESS) {
          const speed = LEAP_PEAK_SPEED * leapSpeedFactor(progress / POUNCE_LANDING_PROGRESS);
          this.moveWithCollision(this.leapDirX * speed, this.leapDirY * speed);
          this.isMoving = true;
        } else {
          this.isMoving = false;
          if (!this.hasDealtDamage) {
            this.hasDealtDamage = true;
            this._strikeOnLanding(targets);
          }
        }

        this.pounceTimer--;
        if (this.pounceTimer <= 0) {
          this.state = 'recovering';
          this.recoverTimer = RECOVER_FRAMES;
        }
        break;
      }

      case 'recovering': {
        // Back off out of reach before winding up for another pounce.
        if (nearest && nearestDist < RETREAT_RANGE_PX && nearestDist > 0) {
          const awayX = (this.x - nearest.x) / nearestDist;
          const awayY = (this.y - nearest.y) / nearestDist;
          this.facingX = awayX;
          this.facingY = awayY;
          this.moveWithCollision(
            awayX * this.speed * RECOVER_RETREAT_SPEED_FRACTION,
            awayY * this.speed * RECOVER_RETREAT_SPEED_FRACTION,
          );
          this.isMoving = true;
        } else {
          this.isMoving = false;
        }

        this.recoverTimer--;
        if (this.recoverTimer <= 0) {
          this.state = nearest ? 'pursuing' : 'idle';
        }
        break;
      }
    }

    this._advanceGait(startX, startY);
  }

  private _findTarget(targets: Player[]): Player | null {
    // An already-alerted spider keeps hunting further than it first noticed you.
    const scanRange =
      this.state === 'idle' ? AGGRO_RANGE_PX : AGGRO_RANGE_PX * AGGRO_PERSIST_MULTIPLIER;
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const target of targets) {
      if (!target.isAlive) continue;
      const dist = Math.hypot(target.x - this.x, target.y - this.y);
      if (dist < scanRange && dist < nearestDist && this.hasLOS(target)) {
        nearestDist = dist;
        nearest = target;
      }
    }
    return nearest;
  }

  private _strikeOnLanding(targets: Player[]): void {
    for (const target of targets) {
      if (!target.isAlive) continue;
      if (Math.hypot(target.x - this.x, target.y - this.y) > HIT_RANGE_PX) continue;
      if (
        this.spells?.isPointInsideShell(
          target.x + TILE_SIZE * TILE_CENTER_FRACTION,
          target.y + TILE_SIZE * TILE_CENTER_FRACTION,
        )
      ) {
        this.spells.addBlockXp(SHELL_BLOCK_XP);
        continue;
      }
      this.dealDamage(target, ATTACK_DAMAGE);
    }
  }

  private _tickSkitter(): void {
    if (this.skitterTimer > 0) {
      this.skitterTimer--;
      return;
    }
    this.skitterPaused = !this.skitterPaused;
    this.skitterTimer = this.skitterPaused
      ? randomFrames(SKITTER_PAUSE_FRAMES_MIN, SKITTER_PAUSE_FRAMES_MAX)
      : randomFrames(SKITTER_BURST_FRAMES_MIN, SKITTER_BURST_FRAMES_MAX);
  }

  /** Ties the leg animation to ground covered so the gait cannot slide. */
  private _advanceGait(startX: number, startY: number): void {
    const moved = Math.hypot(this.x - startX, this.y - startY);
    if (moved > 0) {
      this.gaitCycle += (moved / STRIDE_PIXELS) * TAU;
    } else {
      this.idleCycle += IDLE_CYCLE_SPEED;
    }
  }

  private _faceToward(target: Player): void {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    if (dx !== 0 || dy !== 0) {
      const dist = Math.hypot(dx, dy);
      this.facingX = dx / dist;
      this.facingY = dy / dist;
    }
  }

  private _animation(): SpiderAnimation {
    switch (this.state) {
      case 'crouching':
        return { kind: 'crouch', progress: 1 - this.crouchTimer / CROUCH_FRAMES };
      case 'pouncing':
        return { kind: 'pounce', progress: 1 - this.pounceTimer / POUNCE_FRAMES };
      case 'idle':
      case 'pursuing':
      case 'recovering':
        return this.isMoving
          ? { kind: 'walk', cycle: this.gaitCycle }
          : { kind: 'idle', cycle: this.idleCycle };
    }
  }

  private _deathAnimation(style: SpiderDeathStyle): SpiderAnimation {
    const progress = Math.min(1, this.corpseFrames / DEATH_ANIM_FRAMES[style]);
    return { kind: 'dying', style, progress };
  }

  /** Corpses hold their final frame, then fade out rather than piling up. */
  private _corpseAlpha(style: SpiderDeathStyle): number {
    const fadeStart = DEATH_ANIM_FRAMES[style] + CORPSE_LINGER_FRAMES;
    if (this.corpseFrames <= fadeStart) return 1;
    return Math.max(0, 1 - (this.corpseFrames - fadeStart) / CORPSE_FADE_FRAMES);
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const sx = this.x - camX;
    const sy = this.y - camY;

    if (!this.isAlive) {
      // Once the animation ends the corpse holds its last frame — curled on its
      // back, where it fell. Style is null only before the first corpse tick.
      const style = this.deathStyle;
      if (style === null) return;
      drawSpiderSprite(
        ctx,
        sx,
        sy,
        tileSize,
        this.facingX,
        this.facingY,
        this._deathAnimation(style),
        this._corpseAlpha(style),
      );
      return;
    }

    drawSpiderSprite(ctx, sx, sy, tileSize, this.facingX, this.facingY, this._animation());

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
