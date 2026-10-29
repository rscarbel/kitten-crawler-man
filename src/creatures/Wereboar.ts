import {
  FULL_DAMAGE_SCALE,
  IMMUNE_DAMAGE_SCALE,
  Mob,
  type LootDrop,
  type PlayerDamageType,
} from './Mob';
import type { EyePlacement } from '../sprites/eyePlacement';
import { maybeDropSkillBook } from './skillBookDrop';
import type { Player } from '../Player';
import {
  WEREBOAR_BODY_PART_KEY,
  drawWereboarSprite,
  prewarmWereboarGore,
} from '../sprites/wereboarSprite';
import {
  WEREBOAR_CHARGE_FRAMES,
  WEREBOAR_CHARGE_FRAME_HOLD,
  WEREBOAR_HOOK_FRAMES,
  WEREBOAR_HOOK_IMPACT_PROGRESS,
  WEREBOAR_WINDUP_GAME_FRAMES,
  wereboarActionFrames,
  wereboarImpactFrame,
} from '../sprites/wereboarAttackTiming';
import { normalize } from '../utils';

const WEREBOAR_HP = 30;
const WEREBOAR_SPEED = 1.0;

const AGGRO_RANGE_TILES = 7;
const CHARGE_RANGE_TILES = 5;
const MELEE_RANGE_TILES = 1.3;

const MELEE_DAMAGE = 2;
const CHARGE_DAMAGE = 4;

const MELEE_COOLDOWN = 70;

/** Max frames the charge lasts before stopping on its own. */
const CHARGE_DURATION = 22;
const CHARGE_COOLDOWN = 180;
const CHARGE_SPEED = 5;
const COIN_DROP_MAX = 5;
/** Fraction of melee range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.8;
/** Minimum pixel movement to detect a non-wall step. */
const MIN_MOVEMENT_PX = 0.05;
/** Extra cooldown frames added when a charge hits a wall. */
const WALL_BONK_PENALTY_FRAMES = 40;
/** Tile fraction of charge hit detection range. */
const CHARGE_HIT_RANGE_TILES = 1.4;

/** The share of a mundane weapon's blow the curse lets through. */
const NON_MAGICAL_DAMAGE_SCALE = 0.5;

/**
 * Steel bites a were-creature half as deep and a blast passes it by; only
 * magic lands in full. A `Record` over every weapon, so a new damage type does
 * not compile until someone decides whether it is magic.
 */
const WEREBOAR_DAMAGE_SCALE = {
  melee: NON_MAGICAL_DAMAGE_SCALE,
  slingshot: NON_MAGICAL_DAMAGE_SCALE,
  seismic_stomp: NON_MAGICAL_DAMAGE_SCALE,
  missile: FULL_DAMAGE_SCALE,
  energy_shield: FULL_DAMAGE_SCALE,
  explosion: IMMUNE_DAMAGE_SCALE,
} as const satisfies Record<PlayerDamageType, number>;

/** Game frames the tusk hook occupies, and the one its tusks connect on. */
const HOOK_FRAMES = wereboarActionFrames(WEREBOAR_HOOK_FRAMES);
const HOOK_IMPACT_FRAME = wereboarImpactFrame(WEREBOAR_HOOK_FRAMES, WEREBOAR_HOOK_IMPACT_PROGRESS);

type WereboarState = 'idle' | 'stalking' | 'hooking' | 'charge_windup' | 'charging' | 'cooldown';

const WEREBOAR_EYES: EyePlacement = {
  sideForward: 0.08,
  sideHeight: -0.07,
  sideSpacing: 0.05,
  frontMirrors: false,
  frontAcross: 0,
  frontHeight: -0.05,
  frontSpacing: 0.14,
};

export class Wereboar extends Mob {
  protected override get eyePlacement(): EyePlacement {
    return WEREBOAR_EYES;
  }

  /** Knee-high to a man, so a crawler kicks or stomps it rather than punching. */
  override get lowProfile(): boolean {
    return true;
  }

  readonly xpValue = 18;
  protected coinDropMin = 2;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Wereboar';
  description =
    'A boar-headed brute under an old curse. Steel bites it half as deep, and blasts do not touch it at all. Use magic.';
  override readonly audioTag = 'wereboar';
  override get bodyPartKey(): string {
    return WEREBOAR_BODY_PART_KEY;
  }

  /** 0–1: charge windup progress (for sprite snort animation). */
  chargeWindup = 0;

  private state: WereboarState = 'idle';
  private windupTimer = 0;
  private chargeTimer = 0;
  private cooldownTimer = 0;
  private meleeCooldown = 0;
  /** Counts up through the hook one-shot; the tusks connect partway through. */
  private hookTimer = 0;
  /** Advances while charging, so the sprint row is not sampled off the walk phase. */
  private chargeAnimTimer = 0;

  /** Direction the charge is locked to (unit vector). */
  private chargeDx = 0;
  private chargeDy = 0;
  /** Whether the charge has already dealt damage this lunge. */
  private chargeHitDealt = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, WEREBOAR_HP, WEREBOAR_SPEED);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.chargeWindup = 0;
    this.state = 'idle';
    this.windupTimer = 0;
    this.chargeTimer = 0;
    this.cooldownTimer = 0;
    this.meleeCooldown = 0;
    this.hookTimer = 0;
    this.chargeAnimTimer = 0;
    this.chargeHitDealt = false;
    this.chargeDx = 0;
    this.chargeDy = 0;
  }

  /** 0–1 through the tusk hook, or null when it is not swinging. */
  private get hookProgress(): number | null {
    if (this.state !== 'hooking') return null;
    return Math.min(1, this.hookTimer / HOOK_FRAMES);
  }

  /** The sprite frame of the charging run, or null when it is not charging. */
  private get chargeFrame(): number | null {
    if (this.state !== 'charging') return null;
    return Math.floor(this.chargeAnimTimer / WEREBOAR_CHARGE_FRAME_HOLD) % WEREBOAR_CHARGE_FRAMES;
  }

  /** An unaimed blow — an ally's strike, a scripted kill — is as mundane as steel. */
  protected override playerDamageScale(damageType: PlayerDamageType | null): number {
    if (damageType === null) return NON_MAGICAL_DAMAGE_SCALE;
    return WEREBOAR_DAMAGE_SCALE[damageType];
  }

  /** It eats anything. The book explains how. */
  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    const items: LootDrop['items'] = [];
    maybeDropSkillBook(items, 'glutton');
    return items;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    const ts = this.tileSize;
    const aggroRangePx = ts * AGGRO_RANGE_TILES;
    const chargeRangePx = ts * CHARGE_RANGE_TILES;
    const meleeRangePx = ts * MELEE_RANGE_TILES;

    if (this.meleeCooldown > 0) this.meleeCooldown--;

    const nearest = this.acquireTarget(targets, aggroRangePx);
    const nearestDist = nearest ? this.distanceTo(nearest) : Infinity;
    this.currentTarget = nearest;

    switch (this.state) {
      case 'idle': {
        this.chargeWindup = 0;
        if (nearest) {
          this.state = 'stalking';
          // The eight severed pieces are drawn once, all at once, on the frame
          // it comes apart, and nothing telegraphs that. Noticing a crawler is
          // the only warning there is that this creature's fight has started.
          prewarmWereboarGore();
        } else {
          this.doWander();
        }
        break;
      }

      case 'stalking': {
        this.chargeWindup = 0;
        if (!nearest) {
          this.state = 'idle';
          this.clearAStarPath();
          break;
        }

        this.updateLastKnown(nearest);

        // Commit to a tusk hook if close enough. The damage lands partway
        // through the swing rather than the instant the range check passes, so
        // what the player sees and what hits them are the same event.
        if (nearestDist <= meleeRangePx && this.meleeCooldown === 0) {
          this.state = 'hooking';
          this.hookTimer = 0;
          this.isMoving = false;
          this._faceToward(nearest);
          this.clearAStarPath();
          break;
        }

        if (nearestDist <= chargeRangePx && nearestDist > meleeRangePx && this.hasLOS(nearest)) {
          this.state = 'charge_windup';
          this.windupTimer = WEREBOAR_WINDUP_GAME_FRAMES;
          this.isMoving = false;
          this._faceToward(nearest);
          const d = Math.hypot(nearest.x - this.x, nearest.y - this.y);
          this.chargeDx = d > 0 ? (nearest.x - this.x) / d : 0;
          this.chargeDy = d > 0 ? (nearest.y - this.y) / d : 1;
          break;
        }

        // Chase toward last known position. It stops implicitly once inside the
        // follow radius — `followTargetCollide` returns before writing facing —
        // so a stalking wereboar in melee range needs pointing by hand.
        this._faceToward(nearest);
        this.followTargetAStar(
          this.lastKnownTargetX,
          this.lastKnownTargetY,
          this.speed,
          meleeRangePx * FOLLOW_STOP_FRACTION,
        );
        break;
      }

      case 'hooking': {
        this.chargeWindup = 0;
        this.isMoving = false;
        this.hookTimer++;

        if (nearest) this._faceToward(nearest);

        if (
          this.hookTimer === HOOK_IMPACT_FRAME &&
          nearest &&
          this.distanceTo(nearest) <= meleeRangePx
        ) {
          this.dealDamage(nearest, MELEE_DAMAGE);
        }

        if (this.hookTimer >= HOOK_FRAMES) {
          this.meleeCooldown = MELEE_COOLDOWN;
          this.hookTimer = 0;
          this.state = nearest ? 'stalking' : 'idle';
        }
        break;
      }

      case 'charge_windup': {
        this.windupTimer--;
        this.chargeWindup = 1 - this.windupTimer / WEREBOAR_WINDUP_GAME_FRAMES;
        this.isMoving = false;

        if (nearest) this._faceToward(nearest);

        if (this.windupTimer <= 0) {
          this.state = 'charging';
          this.chargeTimer = CHARGE_DURATION;
          this.chargeAnimTimer = 0;
          this.chargeHitDealt = false;
        }
        break;
      }

      case 'charging': {
        this.chargeWindup = 0;
        this.chargeTimer--;
        this.chargeAnimTimer++;
        this.isMoving = true;

        const prevX = this.x;
        const prevY = this.y;
        this.moveWithCollision(this.chargeDx * CHARGE_SPEED, this.chargeDy * CHARGE_SPEED);

        const movedX = Math.abs(this.x - prevX) > MIN_MOVEMENT_PX;
        const movedY = Math.abs(this.y - prevY) > MIN_MOVEMENT_PX;
        const wallHit = !movedX && !movedY;

        if (wallHit) {
          this.state = 'cooldown';
          this.cooldownTimer = CHARGE_COOLDOWN + WALL_BONK_PENALTY_FRAMES;
          this.isMoving = false;
          break;
        }

        if (!this.chargeHitDealt && nearest) {
          const distNow = Math.hypot(nearest.x - this.x, nearest.y - this.y);
          if (distNow <= this.tileSize * CHARGE_HIT_RANGE_TILES) {
            this.dealDamage(nearest, CHARGE_DAMAGE);
            this.chargeHitDealt = true;
          }
        }

        if (this.chargeTimer <= 0) {
          this.state = 'cooldown';
          this.cooldownTimer = CHARGE_COOLDOWN;
          this.isMoving = false;
        }
        break;
      }

      case 'cooldown': {
        this.chargeWindup = 0;
        this.cooldownTimer--;
        this.isMoving = false;

        if (this.cooldownTimer <= 0) {
          this.state = nearest ? 'stalking' : 'idle';
        }
        break;
      }
    }
  }

  private _faceToward(target: Player): void {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    if (dx !== 0 || dy !== 0) {
      const n = normalize(dx, dy);
      this.facingX = n.x;
      this.facingY = n.y;
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

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawWereboarSprite(ctx, sx, sy, tileSize, {
        walkFrame: this.walkFrame,
        isMoving: this.isMoving,
        facingX: this.facingX,
        facingY: this.facingY,
        hookProgress: this.hookProgress,
        snortProgress: this.chargeWindup > 0 ? this.chargeWindup : null,
        chargeFrame: this.chargeFrame,
      });
    });

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }
}
