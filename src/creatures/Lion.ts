import { Mob } from './Mob';
import type { EyePlacement } from '../sprites/eyePlacement';
import type { Player } from '../Player';
import type { LootDrop, PlayerDamageType } from './Mob';
import { drawLionSprite } from '../sprites/lionSprite';
import { riposteCooldown } from './tactics/riposte';
import type { TacticsTrait } from './tactics/tacticsTraits';

const LION_HP = 24;
const LION_SPEED = 1.3;
const AGGRO_RANGE_TILES = 7;
const ATTACK_RANGE_TILES = 1.3;
const ATTACK_DAMAGE = 8;
/** Frames between bites (~1.5 s at 60 fps). */
const ATTACK_COOLDOWN = 90;
/** Frames the bite animation plays. */
const ATTACK_ANIM_FRAMES = 22;
const COIN_DROP_MIN = 1;
const COIN_DROP_MAX = 3;
/** Fraction of attack range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.8;
/** Frames between pain snarls, so a flurry of blows doesn't stack cries. */
const HURT_SNARL_COOLDOWN = 60;

const LION_TACTICS: readonly TacticsTrait[] = ['flank', 'block', 'regroup', 'riposte'];

/** Drawn only in profile, so facing the camera it still shows that profile. */
const LION_EYES: EyePlacement = {
  sideForward: 0.49,
  sideHeight: 0.3,
  sideSpacing: 0.05,
  frontMirrors: true,
  frontAcross: 0.49,
  frontHeight: 0.3,
  frontSpacing: 0.05,
};

/**
 * A lion — a mid-tier bruiser that hunts the open fields of floor 3 and closes
 * in to bite.
 */
export class Lion extends Mob {
  protected override get eyePlacement(): EyePlacement {
    return LION_EYES;
  }

  readonly xpValue = 22;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Lion';
  description =
    'A maned hunter of the open grass. It stalks, then closes the gap fast and bites hard.';
  override readonly audioTag = 'lion';

  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private isAggro = false;
  private hurtSnarlCooldown = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, LION_HP, LION_SPEED);
  }

  /** A flank can be walking it while its swing still plays, and turning then would flip the arc. */
  protected override get isSwingAnimating(): boolean {
    return this.attackAnimTimer > 0;
  }

  /**
   * A pouncing brawler: it can learn to come at its prey from an angle, turn a
   * blow aside and answer it, and fall back on the pride when hurt. Never
   * `kite` — its bite is its only weapon, and it only works up close.
   */
  protected override get tacticsEligibility(): readonly TacticsTrait[] {
    return LION_TACTICS;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.attackCooldown = 0;
    this.attackAnimTimer = 0;
    this.isAggro = false;
    this.hurtSnarlCooldown = 0;
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    const previousHp = this.hp;
    super.takeDamageFrom(amount, attacker, damageType);
    const wasHurt = this.hp < previousHp;
    if (wasHurt && this.hurtSnarlCooldown === 0) {
      this.damageSoundPending = true;
      this.hurtSnarlCooldown = HURT_SNARL_COOLDOWN;
    }
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;
    if (this.hurtSnarlCooldown > 0) this.hurtSnarlCooldown--;

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    const nearest = this.acquireTarget(targets, aggroRangePx);

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.tactics.disengage();
      this.clearAStarPath();
      this.doWander();
      return;
    }

    // The hunting roar: once as it turns on the party, not again until it has
    // lost them and found them anew.
    if (!this.isAggro) this.specialSoundPending = true;
    this.isAggro = true;
    const nearestDist = this.distanceTo(nearest);
    this.updateLastKnown(nearest);

    if (this.tactics.claimRiposte()) {
      this.attackCooldown = riposteCooldown(this.attackCooldown, this.attackAnimTimer);
    }
    const tacticalMove = this.chooseTacticalStep(
      nearest,
      attackRangePx,
      this.attackAnimTimer === 0,
    );
    if (tacticalMove?.breaksOff === true) {
      this.walkTacticalStep(tacticalMove, nearest);
      return;
    }

    if (nearestDist > attackRangePx) {
      if (tacticalMove !== null) {
        this.walkTacticalStep(tacticalMove, nearest);
      } else {
        this.followTargetAStar(
          this.lastKnownTargetX,
          this.lastKnownTargetY,
          this.speed,
          attackRangePx * FOLLOW_STOP_FRACTION,
        );
      }
    } else {
      this.isMoving = false;
    }

    // The strike plays out while stopped and nothing else writes facing then.
    // Held still mid-swing so the pounce cannot flip halfway through.
    if (nearestDist <= attackRangePx && this.attackAnimTimer === 0) {
      this.faceToward(nearest);
    }

    if (
      nearestDist <= attackRangePx &&
      this.attackCooldown === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.dealDamage(nearest, ATTACK_DAMAGE);
      this.attackCooldown = ATTACK_COOLDOWN;
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
    }
  }

  protected override drawSelf(
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

    const attackAnim = this.attackAnimTimer > 0 ? 1 - this.attackAnimTimer / ATTACK_ANIM_FRAMES : 0;

    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawLionSprite(
        ctx,
        sx,
        sy,
        tileSize,
        this.walkFrame,
        this.isMoving,
        attackAnim,
        this.facingX,
      );
    });

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    if (this.isAggro) this.renderAggroIndicator(ctx, sx, artTopY, sy, tileSize);
    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }
}
