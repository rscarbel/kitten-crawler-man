import { Mob } from './Mob';
import { Player } from '../Player';
import { drawTroglodyteSprite } from '../sprites/troglodyteSprite';
import { makePoison } from '../core/StatusEffect';
import type { LootDrop } from './Mob';

const TROG_HP = 22;
const TROG_SPEED = 0.7;

const AGGRO_RANGE_TILES = 8;
const TONGUE_RANGE_TILES = 3;
const TONGUE_DAMAGE = 4;
const POISON_CHANCE = 0.25;

const WINDUP_FRAMES = 50; // slow, menacing windup
const STRIKE_FRAMES = 18; // 9 frames out, 9 frames back
const COOLDOWN_FRAMES = 150;

type TrogState = 'idle' | 'stalking' | 'winding_up' | 'striking' | 'cooldown';

export class Troglodyte extends Mob {
  readonly xpValue = 20;
  protected coinDropMin = 0;
  protected coinDropMax = 0;

  /** 0–1: how far the tongue is currently extended (for sprite). */
  tongueExtend = 0;
  /** 0–1: how wide the mouth is open (0 = barely open, 1 = full windup). */
  mouthOpenAmt = 0;

  private state: TrogState = 'idle';
  private windupTimer = 0;
  private strikeTimer = 0;
  private cooldownTimer = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, TROG_HP, TROG_SPEED);
  }

  /** Troglodytes drop no loot — no coins, no items. */
  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    const ts = this.tileSize;
    const aggroRangePx = ts * AGGRO_RANGE_TILES;
    const tongueRangePx = ts * TONGUE_RANGE_TILES;

    // Find nearest living target within aggro range
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
        this.mouthOpenAmt = 0;
        this.tongueExtend = 0;
        if (nearest) {
          this.state = 'stalking';
        } else {
          this.doWander();
        }
        break;
      }

      case 'stalking': {
        this.mouthOpenAmt = 0;
        this.tongueExtend = 0;
        if (!nearest) {
          this.state = 'idle';
          this.clearAStarPath();
          break;
        }
        this.updateLastKnown(nearest);

        if (nearestDist <= tongueRangePx && this.hasLOS(nearest)) {
          // In tongue range — start the slow windup
          this.state = 'winding_up';
          this.windupTimer = WINDUP_FRAMES;
          this.isMoving = false;
          this._faceToward(nearest);
        } else {
          // Slowly lumber toward the player
          this.followTargetAStar(
            this.lastKnownTargetX,
            this.lastKnownTargetY,
            this.speed,
            tongueRangePx * 0.85,
          );
        }
        break;
      }

      case 'winding_up': {
        this.windupTimer--;
        this.mouthOpenAmt = 1 - this.windupTimer / WINDUP_FRAMES;
        this.tongueExtend = 0;
        this.isMoving = false;

        // Keep tracking the target during windup
        if (nearest) this._faceToward(nearest);

        if (this.windupTimer <= 0) {
          this.state = 'striking';
          this.strikeTimer = STRIKE_FRAMES;

          // Apply damage to the target if still within range
          if (nearest) {
            const dist = Math.hypot(nearest.x - this.x, nearest.y - this.y);
            if (dist <= tongueRangePx * 1.25) {
              this.dealDamage(nearest, TONGUE_DAMAGE);
              if (Math.random() < POISON_CHANCE) {
                nearest.applyStatus(makePoison());
              }
            }
          }
        }
        break;
      }

      case 'striking': {
        this.strikeTimer--;
        this.isMoving = false;
        this.mouthOpenAmt = 0.75;

        // First half: tongue shoots out; second half: tongue retracts
        const half = STRIKE_FRAMES / 2;
        if (this.strikeTimer > half) {
          this.tongueExtend = (STRIKE_FRAMES - this.strikeTimer) / half;
        } else {
          this.tongueExtend = this.strikeTimer / half;
        }

        if (this.strikeTimer <= 0) {
          this.tongueExtend = 0;
          this.mouthOpenAmt = 0;
          this.state = 'cooldown';
          this.cooldownTimer = COOLDOWN_FRAMES;
        }
        break;
      }

      case 'cooldown': {
        this.cooldownTimer--;
        this.mouthOpenAmt = 0;
        this.tongueExtend = 0;
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

    drawTroglodyteSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.walkFrame,
      this.isMoving,
      this.tongueExtend,
      this.mouthOpenAmt,
      this.facingX,
      this.facingY,
    );

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
