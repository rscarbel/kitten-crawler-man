import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import type { VineTendril } from './VineTendril';
import { drawRingmasterGrimaldiSprite } from '../sprites/ringmasterGrimaldiSprite';

const GRIMALDI_HP = 500;
/** Rooted in place — the vine core never moves. */
const GRIMALDI_SPEED = 0;
const ATTACK_RANGE_TILES = 3.5;
const ATTACK_DAMAGE = 14;
/** Frames between vine lash attacks (~1.5 s at 60 fps) — the core still threatens players even while its tendrils protect it. */
const ATTACK_COOLDOWN = 90;
/** Frames the slam limb visibly rears up before damage lands — the player's dodge window. */
const ATTACK_WINDUP_FRAMES = 36;
/** Frames the limb takes to whip back down after the hit. */
const ATTACK_SLAM_FRAMES = 14;
/** attackAnim value at the top of the windup — the sprite rears until here, slams after. */
const ATTACK_ANIM_WINDUP_PEAK = 0.5;
/** Frames the "hit while invulnerable" flash plays, giving the player feedback that damage was blocked. */
const INVULN_HIT_FLASH_FRAMES = 8;
/** Frames the health bar stays visible after a blocked hit. */
const INVULN_HIT_HEALTHBAR_FRAMES = 180;
const COIN_DROP_MIN = 20;
const COIN_DROP_MAX = 40;

/**
 * Ringmaster Grimaldi — the Over City's City Boss, a Pestiferous Vine that
 * sustains and endlessly resurrects his corrupted circus troupe. Rooted in
 * the big top, his core is invulnerable while any of his spawned
 * `VineTendril` sub-entities survive; only once all tendrils are destroyed
 * can the core itself be killed.
 */
export class RingmasterGrimaldi extends Mob {
  readonly xpValue = 800;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Grimaldi the Pestiferous Vine';
  description =
    'An enormous pale-green vine wrapped around the big top pole — all that remains of Redstone Grimaldi, sustaining his troupe through spore parasites.';
  override readonly audioTag = 'grimaldi';

  private tendrils: VineTendril[] = [];
  private invulnerable = true;
  private attackCooldown = 0;
  private windupTimer = 0;
  private slamTimer = 0;
  private phase = 0;
  private hitFlashTimer = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, GRIMALDI_HP, GRIMALDI_SPEED);
    this.isBoss = true;
  }

  /** Bind the tendrils spawned alongside Grimaldi — invulnerability tracks their survival. */
  setTendrils(tendrils: VineTendril[]): void {
    this.tendrils = tendrils;
  }

  get isInvulnerable(): boolean {
    return this.invulnerable;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: 'melee' | 'missile' | 'shell' | 'smush' = 'melee',
  ): void {
    if (this.invulnerable) {
      this.hitFlashTimer = INVULN_HIT_FLASH_FRAMES;
      this.healthBarTimer = INVULN_HIT_HEALTHBAR_FRAMES;
      return;
    }
    super.takeDamageFrom(amount, attacker, damageType);
    this.damageSoundPending = true;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    this.phase++;
    if (this.hitFlashTimer > 0) this.hitFlashTimer--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.slamTimer > 0) this.slamTimer--;
    this.invulnerable = this.tendrils.some((t) => t.isAlive);
    this.isMoving = false;

    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y);
      if (dist < attackRangePx && dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    this.currentTarget = nearest;

    // A windup in flight resolves even if the target slipped away — the limb
    // slams the ground either way; damage lands only if someone is still there.
    if (this.windupTimer > 0) {
      this.windupTimer--;
      if (this.windupTimer === 0) {
        this.slamTimer = ATTACK_SLAM_FRAMES;
        this.attackCooldown = ATTACK_COOLDOWN;
        if (nearest && (this.hasLOS(nearest) || this.onSameTile(nearest))) {
          this.dealDamage(nearest, ATTACK_DAMAGE);
        }
      }
      return;
    }

    if (!nearest) return;

    const dx = nearest.x - this.x;
    const dy = nearest.y - this.y;
    if (dx !== 0 || dy !== 0) {
      const d = Math.hypot(dx, dy);
      this.facingX = dx / d >= 0 ? 1 : -1;
    }

    if (this.attackCooldown === 0 && (this.hasLOS(nearest) || this.onSameTile(nearest))) {
      this.windupTimer = ATTACK_WINDUP_FRAMES;
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    ctx.save();
    if (this.damageFlash > 0 || this.hitFlashTimer > 0) {
      ctx.filter = 'brightness(3)';
    }

    // Windup maps to 0–0.5 (limb rearing), slam to 0.5–1 (limb crashing down).
    let attackAnim = 0;
    if (this.windupTimer > 0) {
      attackAnim = (1 - this.windupTimer / ATTACK_WINDUP_FRAMES) * ATTACK_ANIM_WINDUP_PEAK;
    } else if (this.slamTimer > 0) {
      attackAnim =
        ATTACK_ANIM_WINDUP_PEAK +
        (1 - this.slamTimer / ATTACK_SLAM_FRAMES) * (1 - ATTACK_ANIM_WINDUP_PEAK);
    }

    drawRingmasterGrimaldiSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.phase,
      this.invulnerable,
      this.hitFlashTimer > 0,
      attackAnim,
    );

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
