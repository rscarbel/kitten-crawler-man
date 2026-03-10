import { Player } from '../Player';
import { Mob } from './Mob';
import { TILE_SIZE } from '../core/constants';
import {
  drawKrakarenSprite,
  drawSlamShadow,
  drawSlamImpact,
} from '../sprites/krakarenSprite';

const KRAKAREN_HP = 200;
const KRAKAREN_SPEED = 0; // immobile
const AGGRO_RANGE_PX = TILE_SIZE * 12;

// Melee tentacle attack
const MELEE_RANGE_PX = TILE_SIZE * 3;
const MELEE_DAMAGE = 3;
const MELEE_WINDUP_FRAMES = 20;
const MELEE_SWING_FRAMES = 15;
const MELEE_COOLDOWN_FRAMES = 60;

// Slam special attack (instant kill)
const SLAM_INTERVAL_BASE = 480; // 8 seconds
const SLAM_INTERVAL_ENRAGED = 300; // 5 seconds
const SLAM_SHADOW_FRAMES = 90; // 1.5 second warning shadow
const SLAM_IMPACT_FRAMES = 20; // visual impact duration
const SLAM_KILL_RADIUS_PX = TILE_SIZE * 1.5;
const SLAM_DAMAGE = 9999; // instant kill

const ENRAGE_THRESHOLD = 0.4; // 40% HP

type KrakarenState =
  | 'idle'
  | 'melee_windup'
  | 'melee_swing'
  | 'melee_cooldown'
  | 'slam_charging';

export class KrakarenClone extends Mob {
  readonly xpValue = 700;
  protected coinDropMin = 80;
  protected coinDropMax = 150;
  displayName = 'Krakaren Clone';
  description =
    'A 20-ft immobile octopus horror with tentacles covered in human-shaped mouths.';

  isEnraged = false;

  // State machine
  private state: KrakarenState = 'idle';
  private meleeWindupTimer = 0;
  private meleeSwingTimer = 0;
  private meleeCooldownTimer = 0;

  // Which tentacle is currently attacking (for animation)
  private attackTentacle = -1;
  private attackProgress = 0;

  // Slam attack
  private slamTimer: number;
  private slamTargetX = 0;
  private slamTargetY = 0;
  private slamShadowTimer = 0; // counts down during shadow phase
  private slamImpactTimer = 0; // counts down during impact visual
  private slamActive = false; // true while shadow is showing

  // Animation time
  private animTime = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, KRAKAREN_HP, KRAKAREN_SPEED);
    this.isBoss = true;
    this.slamTimer = SLAM_INTERVAL_BASE;
  }

  /** Override to prevent any movement — the Krakaren Clone is immobile. */
  protected moveWithCollision(_dx: number, _dy: number): void {
    // No-op: immobile boss
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    this.animTime += 1 / 60;

    // Enrage check
    if (!this.isEnraged && this.hp / this.maxHp < ENRAGE_THRESHOLD) {
      this.isEnraged = true;
    }

    // Find nearest living target
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if ((this.forceAggro || d < AGGRO_RANGE_PX) && d < nearestDist) {
        nearestDist = d;
        nearest = t;
      }
    }

    this.currentTarget = nearest;

    if (nearest) {
      // Face the target
      const dx = nearest.x - this.x;
      const dy = nearest.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 0) {
        this.facingX = dx / d;
        this.facingY = dy / d;
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
      this.state = 'melee_windup';
      this.meleeWindupTimer = MELEE_WINDUP_FRAMES;
      this.attackTentacle = Math.floor(Math.random() * 10);
      this.attackProgress = 0;
    }
  }

  private doMeleeWindup(): void {
    this.meleeWindupTimer--;
    this.attackProgress = 1 - this.meleeWindupTimer / MELEE_WINDUP_FRAMES;

    if (this.meleeWindupTimer <= 0) {
      this.state = 'melee_swing';
      this.meleeSwingTimer = MELEE_SWING_FRAMES;
    }
  }

  private doMeleeSwing(nearest: Player | null): void {
    this.meleeSwingTimer--;
    this.attackProgress = 1 - this.meleeSwingTimer / MELEE_SWING_FRAMES;

    // Deal damage at the midpoint of the swing
    if (
      this.meleeSwingTimer === Math.floor(MELEE_SWING_FRAMES / 2) &&
      nearest &&
      nearest.isAlive
    ) {
      const dist = Math.hypot(nearest.x - this.x, nearest.y - this.y);
      if (dist <= MELEE_RANGE_PX) {
        this.dealDamage(nearest, MELEE_DAMAGE);
        nearest.damageFlash = 8;
      }
    }

    if (this.meleeSwingTimer <= 0) {
      this.state = 'melee_cooldown';
      this.meleeCooldownTimer = MELEE_COOLDOWN_FRAMES;
      this.attackTentacle = -1;
      this.attackProgress = 0;
    }
  }

  private doMeleeCooldown(nearest: Player | null, nearestDist: number): void {
    this.meleeCooldownTimer--;
    if (this.meleeCooldownTimer <= 0) {
      // Immediately attack again if still in range
      if (nearest && nearestDist <= MELEE_RANGE_PX) {
        this.state = 'melee_windup';
        this.meleeWindupTimer = MELEE_WINDUP_FRAMES;
        this.attackTentacle = Math.floor(Math.random() * 10);
      } else {
        this.state = 'idle';
      }
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

    this.slamTargetX = slamTarget.x + ts * 0.5;
    this.slamTargetY = slamTarget.y + ts * 0.5;
    this.slamShadowTimer = SLAM_SHADOW_FRAMES;
    this.slamActive = true;
    this.state = 'slam_charging';

    const interval = this.isEnraged
      ? SLAM_INTERVAL_ENRAGED
      : SLAM_INTERVAL_BASE;
    this.slamTimer = interval;
  }

  private executeSlamImpact(targets: Player[]): void {
    this.slamActive = false;
    this.slamImpactTimer = SLAM_IMPACT_FRAMES;

    // Check if any player is in the kill zone
    const ts = this.tileSize;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dx = t.x + ts * 0.5 - this.slamTargetX;
      const dy = t.y + ts * 0.5 - this.slamTargetY;
      if (Math.hypot(dx, dy) < SLAM_KILL_RADIUS_PX) {
        this.dealDamage(t, SLAM_DAMAGE);
        t.damageFlash = 12;
      }
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

    // Draw slam warning shadow (before boss so it appears on the ground)
    if (this.slamActive) {
      const progress = 1 - this.slamShadowTimer / SLAM_SHADOW_FRAMES;
      drawSlamShadow(
        ctx,
        this.slamTargetX - camX,
        this.slamTargetY - camY,
        tileSize,
        progress,
      );
    }

    // Draw slam impact effect
    if (this.slamImpactTimer > 0) {
      const progress = 1 - this.slamImpactTimer / SLAM_IMPACT_FRAMES;
      drawSlamImpact(
        ctx,
        this.slamTargetX - camX,
        this.slamTargetY - camY,
        tileSize,
        progress,
      );
    }

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    drawKrakarenSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.animTime,
      this.isEnraged,
      this.facingX,
      this.facingY,
      this.attackTentacle,
      this.attackProgress,
    );

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
