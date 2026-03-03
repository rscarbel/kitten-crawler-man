import { Player } from '../Player';
import { drawCatSprite, drawMissiles, Missile } from '../sprites/catSprite';
import { GameMap } from '../map/GameMap';

/**
 * This is a playable character.
 * The cat has the power "magic missile"
 * which is a long range attack
 */

export class CatPlayer extends Player {
  private missiles: Missile[] = [];
  private readonly MISSILE_SPEED = 4.5;
  private readonly EXPLODE_FRAMES = 22;
  private autoFireCooldown = 0;
  private readonly AUTO_FIRE_COOLDOWN = 180;
  private map: GameMap | null = null;

  /** The mob the cat will automatically shoot at when not player-controlled. */
  autoTarget: Player | null = null;

  setMap(map: GameMap) {
    this.map = map;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, 8);
  }

  getMissileDamage(): number {
    return 2 + this.intelligence;
  }

  private fireMissile(angleOffset = 0) {
    const baseAngle = Math.atan2(this.facingY, this.facingX) + angleOffset;
    this.missiles.push({
      x: this.x + this.tileSize * 0.5,
      y: this.y + this.tileSize * 0.5,
      vx: Math.cos(baseAngle) * this.MISSILE_SPEED,
      vy: Math.sin(baseAngle) * this.MISSILE_SPEED,
      distTraveled: 0,
      maxDist: (3.5 + this.intelligence * 0.5) * this.tileSize,
      state: 'flying',
      explodeTimer: this.EXPLODE_FRAMES,
      hit: false,
    });
  }

  triggerAttack() {
    this.fireMissile();
  }

  getMissiles(): Missile[] {
    return this.missiles;
  }

  /**
   * Called every frame when the cat is the follower and has an autoTarget.
   * Faces the target and fires missiles on cooldown.
   * @param missChance 0–1 probability the shot flies slightly off-target (visible miss).
   */
  autoFireTick(missChance = 0) {
    if (!this.autoTarget || !this.autoTarget.isAlive) {
      this.autoTarget = null;
      return;
    }

    // Always face the target
    const dx =
      this.autoTarget.x + this.tileSize * 0.5 - (this.x + this.tileSize * 0.5);
    const dy =
      this.autoTarget.y + this.tileSize * 0.5 - (this.y + this.tileSize * 0.5);
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      this.facingX = dx / dist;
      this.facingY = dy / dist;
    }

    // Fire on cooldown
    if (this.autoFireCooldown > 0) {
      this.autoFireCooldown--;
    } else {
      // Apply angular miss offset (±~25° spread when missChance > 0)
      const offset =
        Math.random() < missChance ? (Math.random() - 0.5) * 2 * 0.44 : 0;
      this.fireMissile(offset);
      this.autoFireCooldown = this.AUTO_FIRE_COOLDOWN;
    }
  }

  updateMissiles() {
    for (const m of this.missiles) {
      if (m.state === 'flying') {
        const nextX = m.x + m.vx;
        const nextY = m.y + m.vy;
        // Explode on wall contact
        if (this.map) {
          const tx = Math.floor(nextX / this.tileSize);
          const ty = Math.floor(nextY / this.tileSize);
          if (!this.map.isWalkable(tx, ty)) {
            m.state = 'exploding';
            continue;
          }
        }
        m.x = nextX;
        m.y = nextY;
        m.distTraveled += Math.hypot(m.vx, m.vy);
        if (m.distTraveled >= m.maxDist) {
          m.state = 'exploding';
        }
      } else {
        m.explodeTimer--;
      }
    }
    this.missiles = this.missiles.filter(
      (m) => !(m.state === 'exploding' && m.explodeTimer <= 0),
    );
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ) {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const s = tileSize;

    // Active indicator — yellow tile outline
    if (this.isActive) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, s - 2, s - 2);
    }

    drawCatSprite(ctx, sx, sy, s, this.walkFrame, this.isMoving, this.facingY);
    drawMissiles(ctx, this.missiles, camX, camY, s, this.EXPLODE_FRAMES);

    this.renderHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
    this.renderStatusEffects(ctx, sx, sy);
  }
}
