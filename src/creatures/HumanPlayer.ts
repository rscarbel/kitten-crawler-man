import { Player } from '../Player';
import { drawHumanSprite, drawHumanAttack } from '../sprites/humanSprite';

/**
 * This is a playable character.
 * The human has the power "brawl"
 * which is a powerful short range attack
 * it can be a punch of a stomp called "smush"
 */
export class HumanPlayer extends Player {
  /** Increases dynamite damage and throw distance. */
  explosivesHandling = 1;

  private attackPhase: 'punch' | 'kick' | null = null;
  private attackTimer = 0;
  private readonly ATTACK_FRAMES = 18;
  public nextType: 'punch' | 'kick' = 'punch';
  private autoAttackCooldown = 0;
  private readonly AUTO_ATTACK_COOLDOWN = 90;

  /** The mob the human will automatically fight when not player-controlled. */
  autoTarget: Player | null = null;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, 10);
    // Pre-equip Enchanted BigBoi Boxers — adds +2 CON (+4 maxHp)
    this.inventory.addItem('enchanted_bigboi_boxers', 1);
    this.inventory.equipByItemId('enchanted_bigboi_boxers');
    this.applyItemBonus(this.inventory.slots.find((s) => s?.id === 'enchanted_bigboi_boxers')!);
  }

  spendPoint(stat: 'STR' | 'INT' | 'CON' | 'EXP') {
    if (stat === 'EXP') {
      if (this.unspentPoints <= 0) return;
      this.unspentPoints--;
      this.explosivesHandling++;
      this.levelUpStat = 'EXP';
      this.levelUpFlash = 60;
      return;
    }
    super.spendPoint(stat);
  }

  getMeleeDamage(): number {
    return 1 + this.strength;
  }

  triggerAttack() {
    if (this.attackTimer > 0) return;
    this.attackPhase = this.nextType;
    this.nextType = this.nextType === 'punch' ? 'kick' : 'punch';
    this.attackTimer = this.ATTACK_FRAMES;
  }

  updateAttack() {
    if (this.attackTimer > 0) this.attackTimer--;
  }

  /** Returns true on the single frame when the hit connects (peak of the swing). */
  isAttackPeak(): boolean {
    return this.attackTimer === Math.ceil(this.ATTACK_FRAMES / 2);
  }

  getMeleeRange(): number {
    return this.tileSize * 1.95;
  }

  /**
   * Called every frame when the human is the follower and has an autoTarget.
   * Faces the target and attacks when in melee range.
   * Movement toward the target is handled in game.ts.
   */
  autoFightTick() {
    if (!this.autoTarget || !this.autoTarget.isAlive) {
      this.autoTarget = null;
      return;
    }

    // Face the target
    const dx = this.autoTarget.x + this.tileSize * 0.5 - (this.x + this.tileSize * 0.5);
    const dy = this.autoTarget.y + this.tileSize * 0.5 - (this.y + this.tileSize * 0.5);
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      this.facingX = dx / dist;
      this.facingY = dy / dist;
    }

    // Attack when in range, gated by a slower auto-attack cooldown
    if (dist <= this.getMeleeRange()) {
      if (this.autoAttackCooldown > 0) {
        this.autoAttackCooldown--;
      } else {
        this.triggerAttack();
        this.autoAttackCooldown = this.AUTO_ATTACK_COOLDOWN;
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number) {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const s = tileSize;

    // Active indicator — yellow tile outline
    if (this.isActive) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, s - 2, s - 2);
    }

    const isKicking = this.attackTimer > 0 && this.attackPhase === 'kick';
    drawHumanSprite(ctx, sx, sy, s, isKicking, this.walkFrame, this.isMoving, this.facingY);

    if (this.attackTimer > 0 && this.attackPhase) {
      drawHumanAttack(
        ctx,
        sx,
        sy,
        s,
        this.attackPhase,
        this.attackTimer,
        this.ATTACK_FRAMES,
        this.facingX,
        this.facingY,
      );
    }

    this.renderHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
    this.renderStatusEffects(ctx, sx, sy);
  }
}
