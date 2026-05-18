import { Mob } from './Mob';
import type { LootDrop } from './Mob';
import type { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';

const SPIDER_HP = 20;
const SPIDER_SPEED = 3.8;
const SPIDER_XP = 15;

const AGGRO_RANGE_PX = TILE_SIZE * 8;
const ATTACK_RANGE_PX = TILE_SIZE * 2.0;
const HIT_RANGE_PX = TILE_SIZE * 1.8;
const ATTACK_DAMAGE = 4;

const WINDUP_FRAMES = 25;
const ATTACK_FRAMES = 22;
const ATTACK_DAMAGE_FRAME = 8;
const COOLDOWN_FRAMES = 80;

/** Speed multiplier during the lunge phase. */
const LUNGE_SPEED = SPIDER_SPEED * 3.5;

/** How far the spider backs away from its target during cooldown. */
const RETREAT_RANGE_PX = TILE_SIZE * 4;

type SpiderState = 'idle' | 'pursuing' | 'winding_up' | 'attacking' | 'cooldown';

export class SmallSpider extends Mob {
  readonly xpValue = SPIDER_XP;
  protected override coinDropMin = 0;
  protected override coinDropMax = 3;
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
        if (this.isMoving) this.walkCycle += 0.25;
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
          this.followTargetCollide(nearest.x, nearest.y, this.speed, ATTACK_RANGE_PX * 0.9);
          this.walkCycle += 0.35;
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
        const lungeSpeed = LUNGE_SPEED * Math.max(0, 1 - lungeProgress * 2);
        if (lungeSpeed > 0.1) {
          this.moveWithCollision(this.lungeTargetX * lungeSpeed, this.lungeTargetY * lungeSpeed);
          this.isMoving = true;
          this.walkCycle += 0.5;
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
            if (this.spells?.isPointInsideShell(t.x + TILE_SIZE * 0.5, t.y + TILE_SIZE * 0.5)) {
              this.spells.addBlockXp(2);
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
            this.moveWithCollision(nx * this.speed * 0.6, ny * this.speed * 0.6);
            this.isMoving = true;
            this.walkCycle += 0.2;
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
    const cx = sx + tileSize * 0.5;
    const cy = sy + tileSize * 0.5;
    const r = tileSize * 0.35;

    ctx.save();
    if (this.damageFlash > 0) ctx.filter = 'brightness(3)';

    // Translate to center, rotate to face direction, draw in local space.
    // Natural orientation faces south (+Y), so atan2 + π/2 aligns it.
    const angle = Math.atan2(this.facingY, this.facingX) + Math.PI / 2;
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // ── Animation state values ───────────────────────────────────────────────
    const isWindingUp = this.state === 'winding_up';
    const isAttacking = this.state === 'attacking';
    const windupProgress = isWindingUp ? 1 - this.windupTimer / WINDUP_FRAMES : 0;
    // 0→1 as lunge launches, then 1→0 as it settles
    const lungeProgress = isAttacking ? 1 - this.attackTimer / ATTACK_FRAMES : 0;
    const lungeFlare = isAttacking ? Math.max(0, 1 - lungeProgress * 1.8) : 0;

    // Body bob while walking
    const walkBob = this.isMoving && !isAttacking ? Math.sin(this.walkCycle * 2) * r * 0.06 : 0;

    // ── Legs ────────────────────────────────────────────────────────────────
    ctx.strokeStyle = '#2a1a0a';
    ctx.lineWidth = Math.max(1, tileSize * 0.05);
    ctx.lineCap = 'round';

    // Leg Y anchors along body (front → back)
    const legYBase = [-r * 0.48, -r * 0.18, r * 0.14, r * 0.42] as const;
    // Phase offsets per leg pair so legs alternate (pairs 0+2 vs 1+3)
    const legPhaseOffsets = [0, Math.PI, Math.PI, 0] as const;

    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 4; i++) {
        const baseY = legYBase[i] + walkBob;
        // Walk oscillation: pairs alternate up/down
        const walkLift = this.isMoving
          ? Math.sin(this.walkCycle + legPhaseOffsets[i]) * r * 0.18
          : 0;

        // During windup, legs gather close to body (crouching coil)
        const coilX = windupProgress * r * 0.25;
        const coilY = windupProgress * r * 0.15;

        // During lunge, legs splay dramatically outward and backward
        const splayX = lungeFlare * r * 0.6;
        const splayY = lungeFlare * r * 0.4;

        const hipX = side * (r * 0.4 - coilX);
        const hipY = baseY + coilY;

        const kneeX = side * (r * 1.15 + splayX - coilX * 0.5);
        const kneeY = baseY - r * 0.18 - walkLift - splayY * 0.3;

        const footX = side * (r * 1.65 + splayX * 1.3 - coilX * 0.3);
        const footY = baseY + r * 0.22 + walkLift * 0.4 + splayY * 0.8;

        ctx.beginPath();
        ctx.moveTo(hipX, hipY);
        ctx.lineTo(kneeX, kneeY);
        ctx.lineTo(footX, footY);
        ctx.stroke();
      }
    }

    // ── Abdomen (rear, larger oval) ──────────────────────────────────────────
    // Squishes during windup, stretches forward during lunge
    const abRx = r * (0.65 + lungeFlare * 0.1 - windupProgress * 0.05);
    const abRy = r * (0.85 - lungeFlare * 0.2 + windupProgress * 0.1);
    ctx.fillStyle = '#1a0d04';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.5 + walkBob, abRx, abRy, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#3d1f0a';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(0, r * 0.3 + i * r * 0.25 + walkBob, r * 0.25, r * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Cephalothorax (front, smaller oval) ──────────────────────────────────
    const cfRx = r * (0.5 - windupProgress * 0.05 + lungeFlare * 0.08);
    const cfRy = r * (0.55 - windupProgress * 0.08 + lungeFlare * 0.15);
    const cfY = -r * 0.3 - lungeFlare * r * 0.12 + walkBob;
    ctx.fillStyle = '#2a1206';
    ctx.beginPath();
    ctx.ellipse(0, cfY, cfRx, cfRy, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── Eyes — 8 red dots in 2 staggered rows ────────────────────────────────
    // Glow red during windup, bright red during lunge
    const eyeGlow = windupProgress > 0.3 ? windupProgress : lungeFlare;
    ctx.fillStyle = eyeGlow > 0.4 ? '#ff4400' : '#cc2200';
    const eyeOffsets: Array<{ x: number; y: number }> = [
      { x: -r * 0.18, y: cfY - r * 0.25 },
      { x: r * 0.18, y: cfY - r * 0.25 },
      { x: -r * 0.1, y: cfY - r * 0.15 },
      { x: r * 0.1, y: cfY - r * 0.15 },
      { x: -r * 0.22, y: cfY - r * 0.06 },
      { x: r * 0.22, y: cfY - r * 0.06 },
      { x: -r * 0.08, y: cfY + r * 0.04 },
      { x: r * 0.08, y: cfY + r * 0.04 },
    ];
    if (eyeGlow > 0.4) {
      ctx.save();
      ctx.shadowColor = '#ff4400';
      ctx.shadowBlur = 6;
    }
    for (const eye of eyeOffsets) {
      ctx.beginPath();
      ctx.arc(eye.x, eye.y, r * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
    if (eyeGlow > 0.4) ctx.restore();

    // ── Chelicerae / fangs ────────────────────────────────────────────────────
    // Splay open during lunge
    const fangOpen = lungeFlare > 0.2 ? lungeFlare : windupProgress * 0.4;
    const fangY = cfY - cfRy * 0.7 - fangOpen * r * 0.18;
    ctx.fillStyle = '#8b0000';
    ctx.beginPath();
    ctx.ellipse(
      -r * 0.11 - fangOpen * r * 0.08,
      fangY,
      r * 0.07,
      r * 0.16 + fangOpen * r * 0.06,
      -0.3 + fangOpen * 0.7,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(
      r * 0.11 + fangOpen * r * 0.08,
      fangY,
      r * 0.07,
      r * 0.16 + fangOpen * r * 0.06,
      0.3 - fangOpen * 0.7,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
