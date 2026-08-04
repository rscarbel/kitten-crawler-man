import { Mob } from './Mob';
import { maybeDropSkillBook } from './skillBookDrop';
import type { Player } from '../Player';
import { TUSKLING_BODY_PART_KEY, drawTusklingSprite } from '../sprites/tusklingSprite';
import {
  TUSKLING_CHARGE_FRAMES,
  TUSKLING_CHARGE_FRAME_HOLD,
  TUSKLING_HOOK_FRAMES,
  TUSKLING_HOOK_IMPACT_PROGRESS,
  TUSKLING_WINDUP_GAME_FRAMES,
  tusklingActionFrames,
  tusklingImpactFrame,
} from '../sprites/tusklingAttackTiming';
import { normalize } from '../utils';
import type { LootDrop } from './Mob';

const TUSK_HP = 30;
const TUSK_SPEED = 1.0;

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

/** Game frames the tusk hook occupies, and the one its tusks connect on. */
const HOOK_FRAMES = tusklingActionFrames(TUSKLING_HOOK_FRAMES);
const HOOK_IMPACT_FRAME = tusklingImpactFrame(TUSKLING_HOOK_FRAMES, TUSKLING_HOOK_IMPACT_PROGRESS);

type TuskState = 'idle' | 'stalking' | 'hooking' | 'charge_windup' | 'charging' | 'cooldown';

export class Tuskling extends Mob {
  readonly xpValue = 18;
  protected coinDropMin = 2;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Tuskling';
  description = 'A hulking orc-hog hybrid. It lowers its tusks and charges without warning.';
  override readonly audioTag = 'tuskling';
  override readonly bodyPartKey = TUSKLING_BODY_PART_KEY;

  /** 0–1: charge windup progress (for sprite snort animation). */
  chargeWindup = 0;

  /**
   * When > 0, the tuskling is dazed (stunned) and cannot act.
   * Set to 600 (10 s) when spawned from Ball of Swine burst.
   */
  dazeTimer = 0;

  private state: TuskState = 'idle';
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
    super(tileX, tileY, tileSize, TUSK_HP, TUSK_SPEED);
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
    // The daze is owned by the Ball of Swine burst that produced this tuskling,
    // and the checkpoint restores that arena phase itself; a daze carried across
    // the rewind leaves the creature frozen out of step with it.
    this.dazeTimer = 0;
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
    return Math.floor(this.chargeAnimTimer / TUSKLING_CHARGE_FRAME_HOLD) % TUSKLING_CHARGE_FRAMES;
  }

  /** It eats anything. The book explains how. */
  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    const items: LootDrop['items'] = [];
    maybeDropSkillBook(items, 'skill_book_iron_stomach');
    return items;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    // Dazed — can't act, just spin in place. The action state is dropped too,
    // or a hook interrupted by the daze would resume mid-swing ten seconds
    // later with nothing in front of it.
    if (this.dazeTimer > 0) {
      this.dazeTimer--;
      this.isMoving = false;
      this.chargeWindup = 0;
      this.state = 'idle';
      this.hookTimer = 0;
      this.chargeAnimTimer = 0;
      return;
    }

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

        // Initiate charge if in range and has LOS
        if (nearestDist <= chargeRangePx && nearestDist > meleeRangePx && this.hasLOS(nearest)) {
          this.state = 'charge_windup';
          this.windupTimer = TUSKLING_WINDUP_GAME_FRAMES;
          this.isMoving = false;
          this._faceToward(nearest);
          // Lock charge direction now
          const d = Math.hypot(nearest.x - this.x, nearest.y - this.y);
          this.chargeDx = d > 0 ? (nearest.x - this.x) / d : 0;
          this.chargeDy = d > 0 ? (nearest.y - this.y) / d : 1;
          break;
        }

        // Chase toward last known position. It stops implicitly once inside the
        // follow radius — `followTargetCollide` returns before writing facing —
        // so a stalking tuskling in melee range needs pointing by hand.
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
        this.chargeWindup = 1 - this.windupTimer / TUSKLING_WINDUP_GAME_FRAMES;
        this.isMoving = false;

        // Keep facing locked target direction
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

        // Move at charge speed in the locked direction
        const prevX = this.x;
        const prevY = this.y;
        this.moveWithCollision(this.chargeDx * CHARGE_SPEED, this.chargeDy * CHARGE_SPEED);

        // Hit wall detection: if neither axis moved at all, the charge is blocked
        const movedX = Math.abs(this.x - prevX) > MIN_MOVEMENT_PX;
        const movedY = Math.abs(this.y - prevY) > MIN_MOVEMENT_PX;
        const wallHit = !movedX && !movedY;

        if (wallHit) {
          // Bonk — stagger into cooldown
          this.state = 'cooldown';
          this.cooldownTimer = CHARGE_COOLDOWN + WALL_BONK_PENALTY_FRAMES;
          this.isMoving = false;
          break;
        }

        // Damage any target we're close enough to (once per charge)
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

    drawTusklingSprite(ctx, sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      hookProgress: this.hookProgress,
      snortProgress: this.chargeWindup > 0 ? this.chargeWindup : null,
      chargeFrame: this.chargeFrame,
    });

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
