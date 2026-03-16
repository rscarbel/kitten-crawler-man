import { Mob } from './Mob';
import { Player } from '../Player';
import { drawTusklingSprite } from '../sprites/tusklingSprite';
import type { LootDrop } from './Mob';

const TUSK_HP = 30;
const TUSK_SPEED = 1.0;

const AGGRO_RANGE_TILES = 7;
const CHARGE_RANGE_TILES = 5;
const MELEE_RANGE_TILES = 1.3;

const MELEE_DAMAGE = 2;
const CHARGE_DAMAGE = 4;

const MELEE_COOLDOWN = 70;
const CHARGE_WINDUP_FRAMES = 35;
/** Max frames the charge lasts before stopping on its own. */
const CHARGE_DURATION = 22;
const CHARGE_COOLDOWN = 180;
const CHARGE_SPEED = 5;

type TuskState =
  | 'idle'
  | 'stalking'
  | 'charge_windup'
  | 'charging'
  | 'cooldown';

export class Tuskling extends Mob {
  readonly xpValue = 18;
  protected coinDropMin = 2;
  protected coinDropMax = 5;
  displayName = 'Tuskling';
  description =
    'A hulking orc-hog hybrid. It lowers its tusks and charges without warning.';

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

  /** Direction the charge is locked to (unit vector). */
  private chargeDx = 0;
  private chargeDy = 0;
  /** Whether the charge has already dealt damage this lunge. */
  private chargeHitDealt = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, TUSK_HP, TUSK_SPEED);
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    // Dazed — can't act, just spin in place
    if (this.dazeTimer > 0) {
      this.dazeTimer--;
      this.isMoving = false;
      this.chargeWindup = 0;
      return;
    }

    const ts = this.tileSize;
    const aggroRangePx = ts * AGGRO_RANGE_TILES;
    const chargeRangePx = ts * CHARGE_RANGE_TILES;
    const meleeRangePx = ts * MELEE_RANGE_TILES;

    if (this.meleeCooldown > 0) this.meleeCooldown--;

    // Find nearest living target
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < aggroRangePx && d < nearestDist) {
        nearestDist = d;
        nearest = t;
      }
    }
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

        // Melee hit if close enough
        if (nearestDist <= meleeRangePx && this.meleeCooldown === 0) {
          this.dealDamage(nearest, MELEE_DAMAGE);
          this.meleeCooldown = MELEE_COOLDOWN;
        }

        // Initiate charge if in range and has LOS
        if (
          nearestDist <= chargeRangePx &&
          nearestDist > meleeRangePx &&
          this.hasLOS(nearest)
        ) {
          this.state = 'charge_windup';
          this.windupTimer = CHARGE_WINDUP_FRAMES;
          this.isMoving = false;
          this._faceToward(nearest);
          // Lock charge direction now
          const d = Math.hypot(nearest.x - this.x, nearest.y - this.y);
          this.chargeDx = d > 0 ? (nearest.x - this.x) / d : 0;
          this.chargeDy = d > 0 ? (nearest.y - this.y) / d : 1;
          break;
        }

        // Chase toward last known position
        this.followTargetAStar(
          this.lastKnownTargetX,
          this.lastKnownTargetY,
          this.speed,
          meleeRangePx * 0.8,
        );
        break;
      }

      case 'charge_windup': {
        this.windupTimer--;
        this.chargeWindup = 1 - this.windupTimer / CHARGE_WINDUP_FRAMES;
        this.isMoving = false;

        // Keep facing locked target direction
        if (nearest) this._faceToward(nearest);

        if (this.windupTimer <= 0) {
          this.state = 'charging';
          this.chargeTimer = CHARGE_DURATION;
          this.chargeHitDealt = false;
        }
        break;
      }

      case 'charging': {
        this.chargeWindup = 0;
        this.chargeTimer--;
        this.isMoving = true;

        // Move at charge speed in the locked direction
        const prevX = this.x;
        const prevY = this.y;
        this.moveWithCollision(
          this.chargeDx * CHARGE_SPEED,
          this.chargeDy * CHARGE_SPEED,
        );

        // Hit wall detection: if neither axis moved at all, the charge is blocked
        const movedX = Math.abs(this.x - prevX) > 0.05;
        const movedY = Math.abs(this.y - prevY) > 0.05;
        const wallHit = !movedX && !movedY;

        if (wallHit) {
          // Bonk — stagger into cooldown
          this.state = 'cooldown';
          this.cooldownTimer = CHARGE_COOLDOWN + 40; // extra penalty for hitting a wall
          this.isMoving = false;
          break;
        }

        // Damage any target we're close enough to (once per charge)
        if (!this.chargeHitDealt && nearest) {
          const distNow = Math.hypot(nearest.x - this.x, nearest.y - this.y);
          if (distNow <= this.tileSize * 1.4) {
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
    const d = Math.hypot(dx, dy);
    if (d > 0) {
      this.facingX = dx / d;
      this.facingY = dy / d;
    }
  }

  render(
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

    drawTusklingSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.walkFrame,
      this.isMoving,
      this.chargeWindup,
      this.facingX,
      this.facingY,
    );

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
