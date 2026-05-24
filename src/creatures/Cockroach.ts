import type { Player } from '../Player';
import { Mob } from './Mob';
import { TILE_SIZE } from '../core/constants';
import { randomInt } from '../utils';

const COCKROACH_HP = 4;
const COCKROACH_SPEED = 2.2;
const AGGRO_RANGE_TILE_MULTIPLIER = 5;
const ATTACK_RANGE_TILE_MULTIPLIER = 1.3;
const AGGRO_RANGE_PX = TILE_SIZE * AGGRO_RANGE_TILE_MULTIPLIER;
const ATTACK_RANGE_PX = TILE_SIZE * ATTACK_RANGE_TILE_MULTIPLIER;
const ATTACK_DAMAGE = 1;
const ATTACK_COOLDOWN = 90;
const COCKROACH_DESPAWN_TTL = 1800;
const MASS = 0.3;
const FOLLOW_STOP_RANGE_MULTIPLIER = 0.8;
const FOLLOW_STOP_RANGE_TILES = 20;
const DAMAGE_FLASH_ALPHA_OFFSET = 0.5;
const DAMAGE_FLASH_FREQUENCY = 0.8;
const BODY_WIDTH_MULTIPLIER = 0.5;
const BODY_HEIGHT_MULTIPLIER = 0.3;
const BODY_ELLIPSE_WIDTH = 0.5;
const BODY_ELLIPSE_HEIGHT = 0.5;
const HEAD_OFFSET_MULTIPLIER = 0.38;
const HEAD_WIDTH = 0.2;
const HEAD_HEIGHT = 0.2;
const ANTENNA_LINE_WIDTH = 0.6;
const ANTENNA_BASE_OFFSET = 0.45;
const ANTENNA_LENGTH_X = 0.3;
const ANTENNA_ANGLE_OFFSET = 0.25;
const LEG_LINE_WIDTH = 0.7;
const LEG_BASE_SPACING = 0.22;
const LEG_LENGTH = 0.45;
const CENTER_OFFSET = 0.5;

export class Cockroach extends Mob {
  readonly xpValue = 2;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Cockroach';
  description = 'Scurries out of dark corners to overwhelm its prey.';

  mass = MASS;

  /** Frames until this cockroach despawns even if alive (30 s @ 60 fps). */
  ttl = COCKROACH_DESPAWN_TTL;

  private attackCooldown = randomInt(0, ATTACK_COOLDOWN - 1);

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
      ATTACK_RANGE_PX * FOLLOW_STOP_RANGE_MULTIPLIER,
      FOLLOW_STOP_RANGE_TILES,
    );
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.globalAlpha =
        DAMAGE_FLASH_ALPHA_OFFSET +
        DAMAGE_FLASH_ALPHA_OFFSET * Math.sin(this.damageFlash * DAMAGE_FLASH_FREQUENCY);
      ctx.filter = 'brightness(3)';
    }

    const w = tileSize * BODY_WIDTH_MULTIPLIER;
    const h = tileSize * BODY_HEIGHT_MULTIPLIER;
    const cx = sx + tileSize * CENTER_OFFSET;
    const cy = sy + tileSize * CENTER_OFFSET;

    // Body — dark brown oval
    ctx.fillStyle = '#4a2c0a';
    ctx.beginPath();
    ctx.ellipse(cx, cy, w * BODY_ELLIPSE_WIDTH, h * BODY_ELLIPSE_HEIGHT, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head — slightly lighter, rounder
    ctx.fillStyle = '#5a3810';
    ctx.beginPath();
    ctx.ellipse(
      cx + w * HEAD_OFFSET_MULTIPLIER * this.facingX,
      cy + h * HEAD_OFFSET_MULTIPLIER * this.facingY,
      w * HEAD_WIDTH,
      h * HEAD_HEIGHT,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Antennae
    ctx.strokeStyle = '#3a1e06';
    ctx.lineWidth = ANTENNA_LINE_WIDTH;
    const hx = cx + w * ANTENNA_BASE_OFFSET * this.facingX;
    const hy = cy + h * ANTENNA_BASE_OFFSET * this.facingY;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(
      hx + w * ANTENNA_LENGTH_X * this.facingX - h * ANTENNA_ANGLE_OFFSET * this.facingY,
      hy + h * ANTENNA_LENGTH_X * this.facingY + w * ANTENNA_ANGLE_OFFSET * this.facingX,
    );
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(
      hx + w * ANTENNA_LENGTH_X * this.facingX + h * ANTENNA_ANGLE_OFFSET * this.facingY,
      hy + h * ANTENNA_LENGTH_X * this.facingY - w * ANTENNA_ANGLE_OFFSET * this.facingX,
    );
    ctx.stroke();

    // Six legs (3 per side)
    const perpX = -this.facingY;
    const perpY = this.facingX;
    ctx.strokeStyle = '#3a1e06';
    ctx.lineWidth = LEG_LINE_WIDTH;
    for (let i = -1; i <= 1; i++) {
      const legBase = {
        x: cx + i * w * LEG_BASE_SPACING * this.facingX,
        y: cy + i * w * LEG_BASE_SPACING * this.facingY,
      };
      // Left leg
      ctx.beginPath();
      ctx.moveTo(legBase.x, legBase.y);
      ctx.lineTo(legBase.x - perpX * w * LEG_LENGTH, legBase.y - perpY * w * LEG_LENGTH);
      ctx.stroke();
      // Right leg
      ctx.beginPath();
      ctx.moveTo(legBase.x, legBase.y);
      ctx.lineTo(legBase.x + perpX * w * LEG_LENGTH, legBase.y + perpY * w * LEG_LENGTH);
      ctx.stroke();
    }

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
