import { Player } from '../Player';
import { Mob } from './Mob';
import { TILE_SIZE } from '../core/constants';

const HOARDER_HP = 80;
const HOARDER_SPEED = 0.45;
const HOARDER_SPEED_ENRAGED = 0.75;
const AGGRO_RANGE_PX = TILE_SIZE * 10;
const ATTACK_RANGE_PX = TILE_SIZE * 1.8;
const ATTACK_DAMAGE = 1;
const ATTACK_COOLDOWN = 150;
const VOMIT_INTERVAL = 480; // 8 s @ 60 fps
const VOMIT_INTERVAL_ENRAGED = 240; // 4 s @ 60 fps
const ENRAGE_THRESHOLD = 0.5; // below 50% HP

export class TheHoarder extends Mob {
  readonly xpValue = 500;
  protected coinDropMin = 50;
  protected coinDropMax = 100;

  private attackCooldown = 60;
  private vomitTimer = VOMIT_INTERVAL;
  isEnraged = false;

  /**
   * Pending cockroach spawn positions. DungeonScene drains this each frame
   * and creates Cockroach mobs at each position.
   */
  cockroachSpawns: Array<{ x: number; y: number }> = [];

  /** Vomit animation timer (frames remaining to show green glow). */
  private vomitFlash = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, HOARDER_HP, HOARDER_SPEED);
    this.isBoss = true;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    // Enrage check
    if (!this.isEnraged && this.hp / this.maxHp < ENRAGE_THRESHOLD) {
      this.isEnraged = true;
      this.speed = HOARDER_SPEED_ENRAGED;
    }

    // Tick vomit flash
    if (this.vomitFlash > 0) this.vomitFlash--;

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

    // Vomit timer ticks regardless of target
    this.vomitTimer--;
    const interval = this.isEnraged ? VOMIT_INTERVAL_ENRAGED : VOMIT_INTERVAL;
    if (this.vomitTimer <= 0) {
      this.vomitTimer = interval;
      this.triggerVomit();
    }

    if (!nearest) {
      // Guard the spawn — slowly return if far
      const toHome = Math.hypot(this.x - this.spawnX, this.y - this.spawnY);
      if (toHome > TILE_SIZE * 2) {
        this.followTargetCollide(
          this.spawnX,
          this.spawnY,
          this.speed * 0.6,
          TILE_SIZE,
        );
      } else {
        this.isMoving = false;
      }
      return;
    }

    this.updateLastKnown(nearest);

    // Melee attack
    if (nearestDist <= ATTACK_RANGE_PX && this.attackCooldown <= 0) {
      nearest.takeDamage(ATTACK_DAMAGE);
      nearest.damageFlash = 8;
      this.attackCooldown = ATTACK_COOLDOWN;
      this.isMoving = false;
      return;
    }

    // Pursue via A*
    this.followTargetAStar(
      this.lastKnownTargetX,
      this.lastKnownTargetY,
      this.speed,
      ATTACK_RANGE_PX * 0.9,
      40,
    );
  }

  private triggerVomit(): void {
    this.vomitFlash = 40;
    // Spawn 3–5 cockroaches in a scatter around the boss
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = TILE_SIZE * (0.5 + Math.random() * 1.5);
      this.cockroachSpawns.push({
        x: this.x + TILE_SIZE * 0.5 + Math.cos(angle) * dist,
        y: this.y + TILE_SIZE * 0.5 + Math.sin(angle) * dist,
      });
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

    this.drawHoarderSprite(ctx, sx, sy, tileSize);

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }

  private drawHoarderSprite(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    ts: number,
  ): void {
    const cx = sx + ts * 0.5;
    const cy = sy + ts * 0.5;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, sy + ts * 0.92, ts * 0.55, ts * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── Purple mumu dress ────────────────────────────────────────────────────
    ctx.fillStyle = this.isEnraged ? '#6b21a8' : '#7c3aed';
    // Main dress body (wide trapezoid)
    ctx.beginPath();
    ctx.moveTo(cx - ts * 0.52, sy + ts * 0.38);
    ctx.lineTo(cx + ts * 0.52, sy + ts * 0.38);
    ctx.lineTo(cx + ts * 0.62, sy + ts * 0.9);
    ctx.lineTo(cx - ts * 0.62, sy + ts * 0.9);
    ctx.closePath();
    ctx.fill();

    // Dress highlight
    ctx.fillStyle = this.isEnraged ? '#7c3aed' : '#8b5cf6';
    ctx.beginPath();
    ctx.moveTo(cx - ts * 0.3, sy + ts * 0.38);
    ctx.lineTo(cx + ts * 0.1, sy + ts * 0.38);
    ctx.lineTo(cx + ts * 0.2, sy + ts * 0.7);
    ctx.lineTo(cx - ts * 0.4, sy + ts * 0.7);
    ctx.closePath();
    ctx.fill();

    // ── Body / skin ───────────────────────────────────────────────────────────
    const skinColor = '#d4956a';
    const skinDark = '#b87850';

    // Large belly bulge (lower body, round)
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.ellipse(cx, sy + ts * 0.55, ts * 0.42, ts * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // Upper torso / chest
    ctx.fillStyle = skinDark;
    ctx.beginPath();
    ctx.ellipse(cx, sy + ts * 0.3, ts * 0.35, ts * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.ellipse(cx, sy + ts * 0.28, ts * 0.32, ts * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── Head ─────────────────────────────────────────────────────────────────
    // Head (large round)
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.ellipse(cx, sy + ts * 0.1, ts * 0.3, ts * 0.27, 0, 0, Math.PI * 2);
    ctx.fill();

    // Double chin
    ctx.fillStyle = skinDark;
    ctx.beginPath();
    ctx.ellipse(cx, sy + ts * 0.26, ts * 0.25, ts * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.ellipse(cx, sy + ts * 0.24, ts * 0.22, ts * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── Hair — messy bun ────────────────────────────────────────────────────
    ctx.fillStyle = '#3d1f0a';
    ctx.beginPath();
    ctx.ellipse(cx, sy - ts * 0.08, ts * 0.22, ts * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    // Messy strands
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(
        cx + i * ts * 0.07,
        sy - ts * 0.17,
        ts * 0.06,
        ts * 0.08,
        i * 0.3,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // ── Face ─────────────────────────────────────────────────────────────────
    // Eyes — wide and vacant
    const eyeOffX = ts * 0.1;
    const eyeY = sy + ts * 0.07;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(cx - eyeOffX, eyeY, ts * 0.07, ts * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + eyeOffX, eyeY, ts * 0.07, ts * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    // Pupils
    ctx.fillStyle = this.isEnraged ? '#ef4444' : '#1a0a00';
    ctx.beginPath();
    ctx.ellipse(
      cx - eyeOffX + this.facingX * ts * 0.02,
      eyeY + this.facingY * ts * 0.01,
      ts * 0.035,
      ts * 0.04,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(
      cx + eyeOffX + this.facingX * ts * 0.02,
      eyeY + this.facingY * ts * 0.01,
      ts * 0.035,
      ts * 0.04,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Mouth — open frown
    ctx.strokeStyle = '#7a3010';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, sy + ts * 0.17, ts * 0.1, 0.2, Math.PI - 0.2);
    ctx.stroke();

    // ── Vomit glow effect ────────────────────────────────────────────────────
    if (this.vomitFlash > 0) {
      const alpha = Math.min(1, this.vomitFlash / 20);
      // Green splatter from mouth
      ctx.save();
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillStyle = '#7fff00';
      for (let i = 0; i < 5; i++) {
        const angle = -Math.PI * 0.3 + i * 0.18;
        const len = ts * (0.3 + i * 0.12);
        ctx.beginPath();
        ctx.ellipse(
          cx + this.facingX * len + Math.cos(angle) * ts * 0.1,
          sy + ts * 0.18 + this.facingY * len + Math.sin(angle) * ts * 0.1,
          ts * 0.07,
          ts * 0.05,
          angle,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.restore();
    }

    // ── Arms — short stubby ───────────────────────────────────────────────────
    ctx.fillStyle = skinColor;
    // Left arm
    ctx.beginPath();
    ctx.ellipse(
      cx - ts * 0.42,
      sy + ts * 0.32,
      ts * 0.12,
      ts * 0.08,
      -0.5,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    // Right arm
    ctx.beginPath();
    ctx.ellipse(
      cx + ts * 0.42,
      sy + ts * 0.32,
      ts * 0.12,
      ts * 0.08,
      0.5,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // ── Enrage indicator ─────────────────────────────────────────────────────
    if (this.isEnraged) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(Date.now() / 200);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, cy, ts * 0.68, ts * 0.68, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
