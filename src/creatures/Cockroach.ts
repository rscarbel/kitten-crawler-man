import { Player } from '../Player';
import { Mob } from './Mob';
import { TILE_SIZE } from '../core/constants';

const COCKROACH_HP = 4;
const COCKROACH_SPEED = 2.2;
const AGGRO_RANGE_PX = TILE_SIZE * 5;
const ATTACK_RANGE_PX = TILE_SIZE * 0.85;
const ATTACK_DAMAGE = 1;
const ATTACK_COOLDOWN = 90;

export class Cockroach extends Mob {
  readonly xpValue = 2;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Cockroach';
  description = 'Scurries out of dark corners to overwhelm its prey.';

  /** Frames until this cockroach despawns even if alive (30 s @ 60 fps). */
  ttl = 1800;

  private attackCooldown = Math.floor(Math.random() * ATTACK_COOLDOWN);

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, COCKROACH_HP, COCKROACH_SPEED);
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    // Find nearest living target
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < AGGRO_RANGE_PX && d < nearestDist) {
        nearestDist = d;
        nearest = t;
      }
    }

    this.currentTarget = nearest;
    if (this.attackCooldown > 0) this.attackCooldown--;

    if (!nearest) {
      this.doWander();
      return;
    }

    this.updateLastKnown(nearest);

    // Melee attack when close enough
    if (nearestDist <= ATTACK_RANGE_PX && this.attackCooldown <= 0) {
      this.dealDamage(nearest, ATTACK_DAMAGE);
      this.attackCooldown = ATTACK_COOLDOWN;
      this.isMoving = false;
      return;
    }

    this.followTargetAStar(
      this.lastKnownTargetX,
      this.lastKnownTargetY,
      COCKROACH_SPEED,
      ATTACK_RANGE_PX * 0.8,
      20,
    );
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
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(this.damageFlash * 0.8);
      ctx.filter = 'brightness(3)';
    }

    const w = tileSize * 0.5;
    const h = tileSize * 0.3;
    const cx = sx + tileSize * 0.5;
    const cy = sy + tileSize * 0.5;

    // Body — dark brown oval
    ctx.fillStyle = '#4a2c0a';
    ctx.beginPath();
    ctx.ellipse(cx, cy, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head — slightly lighter, rounder
    ctx.fillStyle = '#5a3810';
    ctx.beginPath();
    ctx.ellipse(
      cx + w * 0.38 * this.facingX,
      cy + h * 0.38 * this.facingY,
      w * 0.2,
      h * 0.2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Antennae
    ctx.strokeStyle = '#3a1e06';
    ctx.lineWidth = 0.6;
    const hx = cx + w * 0.45 * this.facingX;
    const hy = cy + h * 0.45 * this.facingY;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(
      hx + w * 0.3 * this.facingX - h * 0.25 * this.facingY,
      hy + h * 0.3 * this.facingY + w * 0.25 * this.facingX,
    );
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(
      hx + w * 0.3 * this.facingX + h * 0.25 * this.facingY,
      hy + h * 0.3 * this.facingY - w * 0.25 * this.facingX,
    );
    ctx.stroke();

    // Six legs (3 per side)
    const perpX = -this.facingY;
    const perpY = this.facingX;
    ctx.strokeStyle = '#3a1e06';
    ctx.lineWidth = 0.7;
    for (let i = -1; i <= 1; i++) {
      const legBase = {
        x: cx + i * w * 0.22 * this.facingX,
        y: cy + i * w * 0.22 * this.facingY,
      };
      // Left leg
      ctx.beginPath();
      ctx.moveTo(legBase.x, legBase.y);
      ctx.lineTo(legBase.x - perpX * w * 0.45, legBase.y - perpY * w * 0.45);
      ctx.stroke();
      // Right leg
      ctx.beginPath();
      ctx.moveTo(legBase.x, legBase.y);
      ctx.lineTo(legBase.x + perpX * w * 0.45, legBase.y + perpY * w * 0.45);
      ctx.stroke();
    }

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
