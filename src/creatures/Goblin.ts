import { Player } from '../Player';
import { Mob } from './Mob';
import { drawGoblinSprite, GoblinWeapon } from '../sprites/goblinSprite';

export { GoblinWeapon };

const GOBLIN_HP = 6;
const GOBLIN_SPEED = 1.4;
const AGGRO_RANGE_TILES = 6;
const ATTACK_RANGE_TILES = 1.2;
/** Frames between attacks (~1.5 s at 60 fps) */
const ATTACK_COOLDOWN = 90;

export class Goblin extends Mob {
  readonly xpValue = 5;
  readonly weapon: GoblinWeapon;
  readonly skinColor: string;
  readonly eyeColor: string;

  protected aggroRangePx: number;
  protected attackRangePx: number;
  protected attackDamage: number;

  private attackCooldown = 0;
  private isAggro = false;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    weapon: GoblinWeapon,
    skinColor: string,
    eyeColor: string,
  ) {
    super(tileX, tileY, tileSize, GOBLIN_HP, GOBLIN_SPEED);
    this.weapon = weapon;
    this.skinColor = skinColor;
    this.eyeColor = eyeColor;
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.attackRangePx = tileSize * ATTACK_RANGE_TILES;
    // Hammers hit harder than clubs
    this.attackDamage = weapon === 'hammer' ? 2 : 1;
  }

  updateAI(targets: Player[]) {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;

    // Find nearest living target within aggro range
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y);
      if (dist < this.aggroRangePx && dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      return;
    }

    this.isAggro = true;

    // Chase — stop just inside attack range so the goblin doesn't overlap the target
    if (nearestDist > this.attackRangePx) {
      this.followTarget(nearest.x, nearest.y, this.speed, this.attackRangePx * 0.8);
    }

    // Attack on cooldown
    if (nearestDist <= this.attackRangePx && this.attackCooldown === 0) {
      nearest.takeDamage(this.attackDamage);
      this.attackCooldown = ATTACK_COOLDOWN;
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ) {
    if (!this.isAlive) return;

    const sx = this.x - camX;
    const sy = this.y - camY;

    // Red outline when aggro'd
    if (this.isAggro) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, tileSize, tileSize);
    }

    drawGoblinSprite(ctx, sx, sy, tileSize, this.weapon, this.skinColor, this.eyeColor);
    this.renderHealthBar(ctx, sx, sy);
  }
}
