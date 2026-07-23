import { Player } from '../Player';
import type { Mob } from './Mob';
import { drawHumanSprite, type HumanAttackPhase } from '../sprites/humanSprite';
import type { AbilityManager } from '../core/AbilityManager';
import { getSmushStats } from '../abilities/smush';
import { ITEM_DEF } from '../core/ItemDefs';

/**
 * This is a playable character.
 * The human has the power "brawl"
 * which is a powerful short range attack
 * it can be a punch of a stomp called "smush"
 */
export class HumanPlayer extends Player {
  /** Increases dynamite damage and throw distance. */
  explosivesHandling = 1;

  private abilityManager: AbilityManager | null = null;

  attackPhase: HumanAttackPhase = null;
  attackTimer = 0;
  readonly ATTACK_FRAMES = 18;
  private nextSideType: 'punch_side' | 'kick_side' = 'punch_side';
  private autoAttackCooldown = 0;
  private readonly AUTO_ATTACK_COOLDOWN = 90;

  smushTimer = 0;
  smushCooldown = 0;
  readonly SMUSH_FRAMES = 44;
  // Impact frame: [6,4] is the 5th of 11 visual frames → progressFrameIndex(t, 11) === 4
  // t = 4/11 ≈ 0.364 → smushTimer = SMUSH_FRAMES * (1 - 0.364) ≈ 28
  private readonly SMUSH_HIT_TIMER = 28;

  /** The mob the human will automatically fight when not player-controlled. */
  autoTarget: Mob | null = null;

  private static readonly HUMAN_STARTING_HP = 10;
  private static readonly STARTING_POTIONS = 10;
  private static readonly FACING_Y_THRESHOLD = 0.5;
  private static readonly MELEE_RANGE_MULTIPLIER = 1.95;
  private static readonly ACTIVE_SPHERE_RADIUS = 4;
  /** Distance above the sprite so the sphere sits just below the health bar. */
  private static readonly ACTIVE_SPHERE_GAP = 3;
  /** Offset from tile anchor so sphere sits in the gap between head top and health bar bottom. */
  private static readonly ACTIVE_SPHERE_SPRITE_TOP = 19;
  private static readonly SPHERE_HIGHLIGHT_OFFSET = 0.3;
  private static readonly SPHERE_INNER_RADIUS_RATIO = 0.1;
  private static readonly SPHERE_MID_STOP = 0.4;
  private static readonly HEALTH_BAR_Y_OFFSET = 30;
  private static readonly SPRITE_HORIZONTAL_OFFSET = 0.5;
  private static readonly SPRITE_VERTICAL_OFFSET = 0.5;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, HumanPlayer.HUMAN_STARTING_HP);
    // Pre-equip Enchanted BigBoi Boxers — adds +2 CON (+4 maxHp)
    this.inventory.addItem('enchanted_bigboi_boxers', 1);
    this.inventory.equipByItemId('enchanted_bigboi_boxers');
    const boxersSlot = this.inventory.bag.slots.find((s) => s?.id === 'enchanted_bigboi_boxers');
    if (boxersSlot) this.applyItemBonus(boxersSlot);
    // Pre-equip Smush tome in hotbar slot 0
    this.inventory.actionBar.slots[0] = { ...ITEM_DEF.smush_tome, quantity: 1 };
    // Move starting potions from bag to hotbar slot 1 for quick access
    this.inventory.removeItems('health_potion', HumanPlayer.STARTING_POTIONS);
    this.inventory.actionBar.slots[1] = {
      ...ITEM_DEF.health_potion,
      quantity: HumanPlayer.STARTING_POTIONS,
    };
  }

  setAbilityManager(manager: AbilityManager): void {
    this.abilityManager = manager;
  }

  getProtectiveShellLevel(): number {
    return this.abilityManager?.getLevel('protective_shell') ?? 1;
  }

  getSmushLevel(): number {
    return this.abilityManager?.getLevel('smush') ?? 1;
  }

  getSmushCooldownMax(): number {
    return getSmushStats(this.getSmushLevel()).cooldownFrames;
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
    return 1 + this.strength + this.drunkDamageBonus;
  }

  triggerAttack() {
    if (this.attackTimer > 0 || this.smushTimer > 0) return;
    if (Math.abs(this.facingY) > HumanPlayer.FACING_Y_THRESHOLD) {
      this.attackPhase = this.facingY < 0 ? 'punch_up' : 'kick_down';
    } else {
      this.attackPhase = this.nextSideType;
      this.nextSideType = this.nextSideType === 'punch_side' ? 'kick_side' : 'punch_side';
    }
    this.attackTimer = this.ATTACK_FRAMES;
  }

  triggerSmush(): boolean {
    if (this.smushCooldown > 0 || this.smushTimer > 0 || this.attackTimer > 0) return false;
    this.smushTimer = this.SMUSH_FRAMES;
    return true;
  }

  updateAttack() {
    if (this.attackTimer > 0) this.attackTimer--;
    this.smushCooldown = this.tickCooldown(this.smushCooldown);
    if (this.smushTimer > 0) {
      this.smushTimer--;
      if (this.smushTimer === 0) {
        this.smushCooldown = getSmushStats(this.getSmushLevel()).cooldownFrames;
      }
    }
  }

  /** Returns true on the single frame when the melee hit connects (peak of the swing). */
  isAttackPeak(): boolean {
    return this.attackTimer === Math.ceil(this.ATTACK_FRAMES / 2);
  }

  /** Returns true on the single frame when the smush impact hits the ground ([6,4]). */
  isSmushPeak(): boolean {
    return this.smushTimer === this.SMUSH_HIT_TIMER;
  }

  getMeleeRange(): number {
    return this.tileSize * HumanPlayer.MELEE_RANGE_MULTIPLIER;
  }

  /**
   * Called every frame when the human is the follower and has an autoTarget.
   * Faces the target and attacks when in melee range.
   */
  autoFightTick() {
    if (!this.autoTarget?.isAlive) {
      this.autoTarget = null;
      return;
    }

    const dx =
      this.autoTarget.x +
      this.tileSize * HumanPlayer.SPRITE_HORIZONTAL_OFFSET -
      (this.x + this.tileSize * HumanPlayer.SPRITE_HORIZONTAL_OFFSET);
    const dy =
      this.autoTarget.y +
      this.tileSize * HumanPlayer.SPRITE_VERTICAL_OFFSET -
      (this.y + this.tileSize * HumanPlayer.SPRITE_VERTICAL_OFFSET);
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      this.facingX = dx / dist;
      this.facingY = dy / dist;
    }

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

    if (this.isActive) {
      const r = HumanPlayer.ACTIVE_SPHERE_RADIUS;
      const sphereCX = sx + s * HumanPlayer.SPRITE_HORIZONTAL_OFFSET;
      const sphereCY =
        sy - HumanPlayer.ACTIVE_SPHERE_SPRITE_TOP - HumanPlayer.ACTIVE_SPHERE_GAP - r;
      ctx.save();
      const highlightOffset = r * HumanPlayer.SPHERE_HIGHLIGHT_OFFSET;
      const grad = ctx.createRadialGradient(
        sphereCX - highlightOffset,
        sphereCY - highlightOffset,
        r * HumanPlayer.SPHERE_INNER_RADIUS_RATIO,
        sphereCX,
        sphereCY,
        r,
      );
      grad.addColorStop(0, '#e9d5ff');
      grad.addColorStop(HumanPlayer.SPHERE_MID_STOP, '#a855f7');
      grad.addColorStop(1, '#6b21a8');
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sphereCX, sphereCY, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawHumanSprite(
      ctx,
      sx,
      sy,
      s,
      this.attackPhase,
      this.attackTimer,
      this.ATTACK_FRAMES,
      this.smushTimer,
      this.SMUSH_FRAMES,
      this.walkFrame,
      this.isMoving,
      this.facingY,
      this.facingX,
    );

    // Health bar above the sprite top (~32px above tile origin)
    this.renderHealthBar(ctx, sx, sy - HumanPlayer.HEALTH_BAR_Y_OFFSET);
    this.renderDamageFlash(ctx, sx, sy);
    this.renderStatusEffects(ctx, sx, sy);
    this.renderKnockedOutOverlay(ctx, sx, sy);
  }
}
