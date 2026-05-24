import { Mob } from './Mob';
import type { LootDrop } from './Mob';
import type { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';

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

const WINDUP_FRAMES = 25;
const ATTACK_FRAMES = 22;
const ATTACK_DAMAGE_FRAME = 8;
const COOLDOWN_FRAMES = 80;

/** Fraction of speed applied during cooldown retreat */
const COOLDOWN_RETREAT_SPEED_FRACTION = 0.6;
const COOLDOWN_WALK_SPEED = 0.2;

/** Shell block XP for spider attack */
const SHELL_BLOCK_XP = 2;

/** Wander walk cycle speed */
const WANDER_WALK_CYCLE_SPEED = 0.25;
const ATTACK_APPROACH_WALK_SPEED = 0.35;

/** Approach fraction of attack range */
const APPROACH_STOP_FRACTION = 0.9;

/** Lunge animation fractions */
const LUNGE_DECEL_FACTOR = 2;
const LUNGE_MIN_SPEED = 0.1;
const ATTACKING_WALK_SPEED = 0.5;

/** Speed multiplier during the lunge phase. */
const LUNGE_SPEED_MULTIPLIER = 3.5;
const LUNGE_SPEED = SPIDER_SPEED * LUNGE_SPEED_MULTIPLIER;

/** How far the spider backs away from its target during cooldown. */
const RETREAT_RANGE_TILES = 4;
const RETREAT_RANGE_PX = TILE_SIZE * RETREAT_RANGE_TILES;

// ── Render constants ─────────────────────────────────────────────────────────

/** Fraction of tileSize for the spider body radius. */
const SPIDER_BODY_RADIUS_FRACTION = 0.35;
/** Fraction of tileSize for screen-space center offset. */
const SPIDER_CENTER_FRACTION = 0.5;

// Leg Y anchors (fraction of r, front → back)
const SPIDER_LEG_Y_FRONT = -0.48;
const SPIDER_LEG_Y_MID_FRONT = -0.18;
const SPIDER_LEG_Y_MID_BACK = 0.14;
const SPIDER_LEG_Y_BACK = 0.42;
/** Number of leg pairs per side. */
const SPIDER_LEG_COUNT = 4;

// Walk animation
const SPIDER_WALK_BOB_AMP = 0.06;
const SPIDER_WALK_LIFT_AMP = 0.18;

// Leg windup coil amounts (fraction of r)
const SPIDER_COIL_X = 0.25;
const SPIDER_COIL_Y = 0.15;

// Leg lunge splay amounts (fraction of r)
const SPIDER_SPLAY_X = 0.6;
const SPIDER_SPLAY_Y = 0.4;

// Leg segment X positions (fraction of r)
const SPIDER_HIP_X = 0.4;
const SPIDER_KNEE_X = 1.15;
const SPIDER_FOOT_X = 1.65;

// Leg segment Y positions (fraction of r)
const SPIDER_KNEE_Y_LIFT = 0.18;
const SPIDER_FOOT_Y_DROP = 0.22;

// Leg splay modifiers for knee/foot
const SPIDER_KNEE_SPLAY_Y_FRACTION = 0.3;
const SPIDER_FOOT_SPLAY_X_FRACTION = 1.3;
const SPIDER_FOOT_SPLAY_Y_FRACTION = 0.8;
const SPIDER_COIL_KNEE_X_FRACTION = 0.5;
const SPIDER_COIL_FOOT_X_FRACTION = 0.3;
const SPIDER_WALK_FOOT_Y_FRACTION = 0.4;

// Leg line width fraction
const SPIDER_LEG_LINE_WIDTH_FRACTION = 0.05;

// Abdomen ellipse fractions
const SPIDER_ABDOMEN_BASE_RX = 0.65;
const SPIDER_ABDOMEN_LUNGE_RX_ADD = 0.1;
const SPIDER_ABDOMEN_COIL_RX_SUB = 0.05;
const SPIDER_ABDOMEN_BASE_RY = 0.85;
const SPIDER_ABDOMEN_LUNGE_RY_SUB = 0.2;
const SPIDER_ABDOMEN_COIL_RY_ADD = 0.1;
const SPIDER_ABDOMEN_Y_OFFSET = 0.5;

/** Number of abdomen stripe ellipses. */
const SPIDER_ABDOMEN_STRIPE_COUNT = 3;
const SPIDER_ABDOMEN_STRIPE_START_Y = 0.3;
const SPIDER_ABDOMEN_STRIPE_SPACING = 0.25;
const SPIDER_ABDOMEN_STRIPE_RX = 0.25;
const SPIDER_ABDOMEN_STRIPE_RY = 0.1;

// Cephalothorax fractions
const SPIDER_CF_BASE_RX = 0.5;
const SPIDER_CF_COIL_RX_SUB = 0.05;
const SPIDER_CF_LUNGE_RX_ADD = 0.08;
const SPIDER_CF_BASE_RY = 0.55;
const SPIDER_CF_COIL_RY_SUB = 0.08;
const SPIDER_CF_LUNGE_RY_ADD = 0.15;
const SPIDER_CF_Y_OFFSET = -0.3;
const SPIDER_CF_LUNGE_Y_OFFSET = 0.12;

// Eye layout fractions (fraction of r, relative to cfY)
const SPIDER_EYE_ROW1_X = 0.18;
const SPIDER_EYE_ROW1_Y = -0.25;
const SPIDER_EYE_ROW2_X = 0.1;
const SPIDER_EYE_ROW2_Y = -0.15;
const SPIDER_EYE_ROW3_X = 0.22;
const SPIDER_EYE_ROW3_Y = -0.06;
const SPIDER_EYE_ROW4_X = 0.08;
const SPIDER_EYE_ROW4_Y = 0.04;
const SPIDER_EYE_RADIUS_FRACTION = 0.055;
/** Glow threshold: above this windup/lunge progress, eyes glow bright. */
const SPIDER_EYE_GLOW_THRESHOLD = 0.4;
const SPIDER_EYE_WINDUP_GLOW_THRESHOLD = 0.3;

// Fang (chelicerae) fractions
const SPIDER_FANG_OPEN_THRESHOLD = 0.2;
const SPIDER_FANG_WINDUP_SCALE = 0.4;
const SPIDER_FANG_Y_DROP = 0.18;
const SPIDER_FANG_X_OFFSET = 0.11;
const SPIDER_FANG_SPLAY_X = 0.08;
const SPIDER_FANG_LUNGE_Y_ADD = 0.06;
const SPIDER_FANG_BASE_RX = 0.07;
const SPIDER_FANG_BASE_RY = 0.16;
const SPIDER_CF_FANG_Y_FRACTION = 0.7;
const SPIDER_FANG_TILT_BASE = 0.3;
const SPIDER_FANG_TILT_SPLAY = 0.7;

// Lunge settle speed: after this progress multiplier the lunge is done visually
const SPIDER_LUNGE_SETTLE_SPEED = 1.8;

type SpiderState = 'idle' | 'pursuing' | 'winding_up' | 'attacking' | 'cooldown';

export class SmallSpider extends Mob {
  readonly xpValue = SPIDER_XP;
  protected override coinDropMin = 0;
  protected override coinDropMax = SPIDER_COIN_DROP_MAX;
  override displayName = 'Spider';
  override description = 'A quick, venomous spider that lunges at its prey.';
  override mass = 1;

  private state: SpiderState = 'idle';
  private windupTimer = 0;
  /** Counts down from ATTACK_FRAMES to 0. */
  private attackTimer = 0;
  private cooldownTimer = 0;
  private hasDealtDamage = false;
  /** Pixel-space direction the lunge travels. */
  private lungeTargetX = 0;
  private lungeTargetY = 0;
  /** Walk cycle accumulator for leg animation. */
  private walkCycle = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, SPIDER_HP, SPIDER_SPEED);
  }

  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    // Find nearest living target with LOS within aggro range.
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < AGGRO_RANGE_PX && d < nearestDist && this.hasLOS(t)) {
        nearestDist = d;
        nearest = t;
      }
    }
    this.currentTarget = nearest;

    switch (this.state) {
      case 'idle': {
        if (nearest) {
          this.state = 'pursuing';
        } else {
          this.doWander();
          // Keep facing in sync with wander movement
          if (this.wanderDx !== 0 || this.wanderDy !== 0) {
            const wd = Math.hypot(this.wanderDx, this.wanderDy);
            this.facingX = this.wanderDx / wd;
            this.facingY = this.wanderDy / wd;
          }
        }
        if (this.isMoving) this.walkCycle += WANDER_WALK_CYCLE_SPEED;
        break;
      }

      case 'pursuing': {
        if (!nearest) {
          this.state = 'idle';
          break;
        }
        this.updateLastKnown(nearest);

        if (nearestDist <= ATTACK_RANGE_PX) {
          // Lock in lunge direction, enter windup.
          this.state = 'winding_up';
          this.windupTimer = WINDUP_FRAMES;
          this.isMoving = false;
          this._faceToward(nearest);
          this.lungeTargetX = this.facingX;
          this.lungeTargetY = this.facingY;
        } else {
          this.followTargetCollide(
            nearest.x,
            nearest.y,
            this.speed,
            ATTACK_RANGE_PX * APPROACH_STOP_FRACTION,
          );
          this.walkCycle += ATTACK_APPROACH_WALK_SPEED;
        }
        break;
      }

      case 'winding_up': {
        this.isMoving = false;
        if (nearest) this._faceToward(nearest);
        this.windupTimer--;
        if (this.windupTimer <= 0) {
          // Snapshot lunge direction at the moment of release
          this.lungeTargetX = this.facingX;
          this.lungeTargetY = this.facingY;
          this.state = 'attacking';
          this.attackTimer = ATTACK_FRAMES;
          this.hasDealtDamage = false;
        }
        break;
      }

      case 'attacking': {
        // Lunge forward for the first half of the attack, then slide to a stop.
        const lungeProgress = 1 - this.attackTimer / ATTACK_FRAMES;
        const lungeSpeed = LUNGE_SPEED * Math.max(0, 1 - lungeProgress * LUNGE_DECEL_FACTOR);
        if (lungeSpeed > LUNGE_MIN_SPEED) {
          this.moveWithCollision(this.lungeTargetX * lungeSpeed, this.lungeTargetY * lungeSpeed);
          this.isMoving = true;
          this.walkCycle += ATTACKING_WALK_SPEED;
        } else {
          this.isMoving = false;
        }

        this.attackTimer--;

        // Deal damage at the designated frame.
        if (!this.hasDealtDamage && this.attackTimer === ATTACK_FRAMES - ATTACK_DAMAGE_FRAME) {
          this.hasDealtDamage = true;
          for (const t of targets) {
            if (!t.isAlive) continue;
            if (Math.hypot(t.x - this.x, t.y - this.y) > HIT_RANGE_PX) continue;
            if (
              this.spells?.isPointInsideShell(
                t.x + TILE_SIZE * SPIDER_CENTER_FRACTION,
                t.y + TILE_SIZE * SPIDER_CENTER_FRACTION,
              )
            ) {
              this.spells.addBlockXp(SHELL_BLOCK_XP);
              continue;
            }
            this.dealDamage(t, ATTACK_DAMAGE);
          }
        }

        if (this.attackTimer <= 0) {
          this.state = 'cooldown';
          this.cooldownTimer = COOLDOWN_FRAMES;
        }
        break;
      }

      case 'cooldown': {
        // Move away from the nearest player during cooldown.
        if (nearest) {
          const dx = this.x - nearest.x;
          const dy = this.y - nearest.y;
          const dist = Math.hypot(dx, dy);
          if (dist < RETREAT_RANGE_PX && dist > 0) {
            const nx = dx / dist;
            const ny = dy / dist;
            this.facingX = nx;
            this.facingY = ny;
            this.moveWithCollision(
              nx * this.speed * COOLDOWN_RETREAT_SPEED_FRACTION,
              ny * this.speed * COOLDOWN_RETREAT_SPEED_FRACTION,
            );
            this.isMoving = true;
            this.walkCycle += COOLDOWN_WALK_SPEED;
          } else {
            this.isMoving = false;
          }
        } else {
          this.isMoving = false;
        }

        this.cooldownTimer--;
        if (this.cooldownTimer <= 0) {
          this.state = nearest ? 'pursuing' : 'idle';
        }
        break;
      }
    }
  }

  private _faceToward(target: Player): void {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    if (dx !== 0 || dy !== 0) {
      const d = Math.hypot(dx, dy);
      this.facingX = dx / d;
      this.facingY = dy / d;
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;

    const sx = this.x - camX;
    const sy = this.y - camY;
    const cx = sx + tileSize * SPIDER_CENTER_FRACTION;
    const cy = sy + tileSize * SPIDER_CENTER_FRACTION;
    const r = tileSize * SPIDER_BODY_RADIUS_FRACTION;

    ctx.save();
    if (this.damageFlash > 0) ctx.filter = 'brightness(3)';

    // Natural orientation faces south (+Y), so atan2 + π/2 aligns it.
    const angle = Math.atan2(this.facingY, this.facingX) + Math.PI / 2;
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // ── Animation state values ───────────────────────────────────────────────
    const isWindingUp = this.state === 'winding_up';
    const isAttacking = this.state === 'attacking';
    const windupProgress = isWindingUp ? 1 - this.windupTimer / WINDUP_FRAMES : 0;
    const lungeProgress = isAttacking ? 1 - this.attackTimer / ATTACK_FRAMES : 0;
    const lungeFlare = isAttacking ? Math.max(0, 1 - lungeProgress * SPIDER_LUNGE_SETTLE_SPEED) : 0;

    const walkBob =
      this.isMoving && !isAttacking ? Math.sin(this.walkCycle * 2) * r * SPIDER_WALK_BOB_AMP : 0;

    // ── Legs ────────────────────────────────────────────────────────────────
    ctx.strokeStyle = '#2a1a0a';
    ctx.lineWidth = Math.max(1, tileSize * SPIDER_LEG_LINE_WIDTH_FRACTION);
    ctx.lineCap = 'round';

    const legYBase = [
      r * SPIDER_LEG_Y_FRONT,
      r * SPIDER_LEG_Y_MID_FRONT,
      r * SPIDER_LEG_Y_MID_BACK,
      r * SPIDER_LEG_Y_BACK,
    ] as const;
    const legPhaseOffsets = [0, Math.PI, Math.PI, 0] as const;

    for (const side of [-1, 1] as const) {
      for (let i = 0; i < SPIDER_LEG_COUNT; i++) {
        const baseY = legYBase[i] + walkBob;
        const walkLift = this.isMoving
          ? Math.sin(this.walkCycle + legPhaseOffsets[i]) * r * SPIDER_WALK_LIFT_AMP
          : 0;

        const coilX = windupProgress * r * SPIDER_COIL_X;
        const coilY = windupProgress * r * SPIDER_COIL_Y;
        const splayX = lungeFlare * r * SPIDER_SPLAY_X;
        const splayY = lungeFlare * r * SPIDER_SPLAY_Y;

        const hipX = side * (r * SPIDER_HIP_X - coilX);
        const hipY = baseY + coilY;

        const kneeX = side * (r * SPIDER_KNEE_X + splayX - coilX * SPIDER_COIL_KNEE_X_FRACTION);
        const kneeY =
          baseY - r * SPIDER_KNEE_Y_LIFT - walkLift - splayY * SPIDER_KNEE_SPLAY_Y_FRACTION;

        const footX =
          side *
          (r * SPIDER_FOOT_X +
            splayX * SPIDER_FOOT_SPLAY_X_FRACTION -
            coilX * SPIDER_COIL_FOOT_X_FRACTION);
        const footY =
          baseY +
          r * SPIDER_FOOT_Y_DROP +
          walkLift * SPIDER_WALK_FOOT_Y_FRACTION +
          splayY * SPIDER_FOOT_SPLAY_Y_FRACTION;

        ctx.beginPath();
        ctx.moveTo(hipX, hipY);
        ctx.lineTo(kneeX, kneeY);
        ctx.lineTo(footX, footY);
        ctx.stroke();
      }
    }

    // ── Abdomen (rear, larger oval) ──────────────────────────────────────────
    const abRx =
      r *
      (SPIDER_ABDOMEN_BASE_RX +
        lungeFlare * SPIDER_ABDOMEN_LUNGE_RX_ADD -
        windupProgress * SPIDER_ABDOMEN_COIL_RX_SUB);
    const abRy =
      r *
      (SPIDER_ABDOMEN_BASE_RY -
        lungeFlare * SPIDER_ABDOMEN_LUNGE_RY_SUB +
        windupProgress * SPIDER_ABDOMEN_COIL_RY_ADD);
    ctx.fillStyle = '#1a0d04';
    ctx.beginPath();
    ctx.ellipse(0, r * SPIDER_ABDOMEN_Y_OFFSET + walkBob, abRx, abRy, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#3d1f0a';
    for (let i = 0; i < SPIDER_ABDOMEN_STRIPE_COUNT; i++) {
      ctx.beginPath();
      ctx.ellipse(
        0,
        r * SPIDER_ABDOMEN_STRIPE_START_Y + i * r * SPIDER_ABDOMEN_STRIPE_SPACING + walkBob,
        r * SPIDER_ABDOMEN_STRIPE_RX,
        r * SPIDER_ABDOMEN_STRIPE_RY,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // ── Cephalothorax (front, smaller oval) ──────────────────────────────────
    const cfRx =
      r *
      (SPIDER_CF_BASE_RX -
        windupProgress * SPIDER_CF_COIL_RX_SUB +
        lungeFlare * SPIDER_CF_LUNGE_RX_ADD);
    const cfRy =
      r *
      (SPIDER_CF_BASE_RY -
        windupProgress * SPIDER_CF_COIL_RY_SUB +
        lungeFlare * SPIDER_CF_LUNGE_RY_ADD);
    const cfY = r * SPIDER_CF_Y_OFFSET - lungeFlare * r * SPIDER_CF_LUNGE_Y_OFFSET + walkBob;
    ctx.fillStyle = '#2a1206';
    ctx.beginPath();
    ctx.ellipse(0, cfY, cfRx, cfRy, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── Eyes — 8 red dots in 2 staggered rows ────────────────────────────────
    const eyeGlow = windupProgress > SPIDER_EYE_WINDUP_GLOW_THRESHOLD ? windupProgress : lungeFlare;
    ctx.fillStyle = eyeGlow > SPIDER_EYE_GLOW_THRESHOLD ? '#ff4400' : '#cc2200';
    const eyeOffsets: Array<{ x: number; y: number }> = [
      { x: -r * SPIDER_EYE_ROW1_X, y: cfY + r * SPIDER_EYE_ROW1_Y },
      { x: r * SPIDER_EYE_ROW1_X, y: cfY + r * SPIDER_EYE_ROW1_Y },
      { x: -r * SPIDER_EYE_ROW2_X, y: cfY + r * SPIDER_EYE_ROW2_Y },
      { x: r * SPIDER_EYE_ROW2_X, y: cfY + r * SPIDER_EYE_ROW2_Y },
      { x: -r * SPIDER_EYE_ROW3_X, y: cfY + r * SPIDER_EYE_ROW3_Y },
      { x: r * SPIDER_EYE_ROW3_X, y: cfY + r * SPIDER_EYE_ROW3_Y },
      { x: -r * SPIDER_EYE_ROW4_X, y: cfY + r * SPIDER_EYE_ROW4_Y },
      { x: r * SPIDER_EYE_ROW4_X, y: cfY + r * SPIDER_EYE_ROW4_Y },
    ];
    if (eyeGlow > SPIDER_EYE_GLOW_THRESHOLD) {
      ctx.save();
      ctx.shadowColor = '#ff4400';
      ctx.shadowBlur = 6;
    }
    for (const eye of eyeOffsets) {
      ctx.beginPath();
      ctx.arc(eye.x, eye.y, r * SPIDER_EYE_RADIUS_FRACTION, 0, Math.PI * 2);
      ctx.fill();
    }
    if (eyeGlow > SPIDER_EYE_GLOW_THRESHOLD) ctx.restore();

    // ── Chelicerae / fangs ────────────────────────────────────────────────────
    const fangOpen =
      lungeFlare > SPIDER_FANG_OPEN_THRESHOLD
        ? lungeFlare
        : windupProgress * SPIDER_FANG_WINDUP_SCALE;
    const fangY = cfY - cfRy * SPIDER_CF_FANG_Y_FRACTION - fangOpen * r * SPIDER_FANG_Y_DROP;
    ctx.fillStyle = '#8b0000';
    ctx.beginPath();
    ctx.ellipse(
      -r * SPIDER_FANG_X_OFFSET - fangOpen * r * SPIDER_FANG_SPLAY_X,
      fangY,
      r * SPIDER_FANG_BASE_RX,
      r * SPIDER_FANG_BASE_RY + fangOpen * r * SPIDER_FANG_LUNGE_Y_ADD,
      -SPIDER_FANG_TILT_BASE + fangOpen * SPIDER_FANG_TILT_SPLAY,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(
      r * SPIDER_FANG_X_OFFSET + fangOpen * r * SPIDER_FANG_SPLAY_X,
      fangY,
      r * SPIDER_FANG_BASE_RX,
      r * SPIDER_FANG_BASE_RY + fangOpen * r * SPIDER_FANG_LUNGE_Y_ADD,
      SPIDER_FANG_TILT_BASE - fangOpen * SPIDER_FANG_TILT_SPLAY,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
