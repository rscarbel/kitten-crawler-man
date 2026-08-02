import type { Player } from '../Player';
import { Mob } from './Mob';
import { maybeDropSkillBook } from './skillBookDrop';
import type { LootDrop } from './Mob';
import { HumanPlayer } from './HumanPlayer';
import { CatPlayer } from './CatPlayer';
import {
  GOBLIN_ATTACKS,
  GoblinAnimator,
  drawGoblinSprite,
  goblinBodyPartKey,
  type GoblinAttackKind,
  type GoblinWeapon,
} from '../sprites/goblinSprite';
import { AGGRO_PERSIST_MULTIPLIER } from '../core/constants';

const GOBLIN_HP = 6;
const GOBLIN_SPEED = 1.4;
const AGGRO_RANGE_TILES = 6;
const COIN_DROP_MAX = 3;
/** Fraction of attack range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.8;
/** Drop chance for dynamite when killed by human. */
const DYNAMITE_DROP_CHANCE_HUMAN = 0.2;
/** Drop chance for dynamite when killed by cat. */
const DYNAMITE_DROP_CHANCE_CAT = 0.05;
/**
 * Frames a goblin hesitates before the first blow of an engagement, so a player
 * who walks into one gets a beat to react rather than being hit on contact.
 */
const ATTACK_WINDUP_FRAMES = 15;
/** How often a goblin off cooldown and in range commits to its heavy attack. */
const HEAVY_ATTACK_CHANCE = 0.35;
/**
 * How far the sheets overhang the goblin's own tile.
 *
 * Measured from the baked frames: the tallest is the war hammer's, whose frame
 * is 208 px against a 64-px tile with the anchor 155 px down, so the art reaches
 * ~1.4 tiles above the tile and ~1.2 to either side. Without the override a
 * goblin mid-swing pops in at the screen edge with its hammer already visible.
 */
const GOBLIN_CULL_MARGIN_TILES = 1.5;
const FRAMES_PER_SECOND = 60;
/** Seconds one game frame covers, for the animator's idle-break clock. */
const SECONDS_PER_FRAME = 1 / FRAMES_PER_SECOND;
const MILLISECONDS_PER_SECOND = 1000;
/**
 * A one-shot row samples the *middle* of each frame, so its impact lands half a
 * frame past the impact frame's index. Getting this wrong puts the blow a whole
 * frame early at the short end of the timing table.
 */
const FRAME_MIDPOINT = 0.5;

export class Goblin extends Mob {
  readonly xpValue = 5;
  protected coinDropMin = 1;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Goblin';
  description = 'A scrappy little troublemaker armed with crude weapons.';
  override readonly audioTag = 'goblin';
  readonly weapon: GoblinWeapon;
  /** The gore sheet this goblin's flying pieces come from — one per archetype. */
  readonly bodyPartKey: string;

  protected aggroRangePx: number;
  protected attackRangePx: number;
  protected attackDamage: number;

  private readonly animator: GoblinAnimator;
  private readonly goblinTileSize: number;
  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private attackKind: GoblinAttackKind = 'light';
  /**
   * Frames left until the blow lands, or 0 when nothing is pending.
   *
   * Damage used to be dealt on the same tick the animation started, so the
   * player was hit before the swing began and no amount of animation quality
   * could fix it. The strike now lands on the sprite's own impact frame, which
   * is what makes a telegraphed heavy attack genuinely dodgeable.
   */
  private pendingImpact = 0;
  private isAggro = false;
  /** True when the goblin has not yet landed its first hit on the current target. */
  private firstHitPending = true;
  /** Windup frames remaining before the first strike connects. */
  private attackWindupTimer = 0;
  private previousHp: number;

  constructor(tileX: number, tileY: number, tileSize: number, weapon: GoblinWeapon) {
    super(tileX, tileY, tileSize, GOBLIN_HP, GOBLIN_SPEED);
    this.weapon = weapon;
    this.bodyPartKey = goblinBodyPartKey(weapon);
    this.animator = new GoblinAnimator(weapon);
    this.goblinTileSize = tileSize;
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.attackRangePx = tileSize * GOBLIN_ATTACKS[weapon].light.reachTiles;
    this.attackDamage = GOBLIN_ATTACKS[weapon].light.damage;
    this.previousHp = this.hp;
  }

  override get cullMarginTiles(): number {
    return GOBLIN_CULL_MARGIN_TILES;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.attackCooldown = 0;
    this.attackAnimTimer = 0;
    this.pendingImpact = 0;
    this.isAggro = false;
    this.firstHitPending = true;
    this.attackWindupTimer = 0;
    this.previousHp = this.hp;
    this.animator.reset();
  }

  protected rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    const chance =
      killer instanceof HumanPlayer
        ? DYNAMITE_DROP_CHANCE_HUMAN
        : killer instanceof CatPlayer
          ? DYNAMITE_DROP_CHANCE_CAT
          : 0;
    if (chance > 0 && Math.random() < chance) {
      items.push({ id: 'goblin_dynamite', quantity: 1 });
    }
    // Goblins are the dungeon's professional brawlers; the book is theirs to lose.
    maybeDropSkillBook(items, 'skill_book_pugilism');
    return items;
  }

  /**
   * Pick which attack to commit to. Heavy on a weighted roll, light otherwise —
   * deliberately simple, because smarter selection is a behaviour change and this
   * is a visual rework.
   */
  private chooseAttackKind(): GoblinAttackKind {
    return Math.random() < HEAVY_ATTACK_CHANCE ? 'heavy' : 'light';
  }

  private beginAttack(): void {
    const kind = this.chooseAttackKind();
    const timing = GOBLIN_ATTACKS[this.weapon][kind];
    this.attackKind = kind;
    this.attackAnimTimer = timing.animFrames;
    this.attackCooldown = timing.cooldownFrames;
    this.attackDamage = timing.damage;
    this.attackRangePx = this.goblinTileSize * timing.reachTiles;
    // Impact lands at `animFrames × (impactFrame + 0.5) / spriteFrames`, which is
    // the same sampling the sheet's one-shot rows use.
    this.pendingImpact = Math.max(
      1,
      Math.round((timing.animFrames * (timing.impactFrame + FRAME_MIDPOINT)) / timing.spriteFrames),
    );
  }

  /** Land the pending blow, re-checking range and line of sight at the moment of contact. */
  private resolvePendingImpact(target: Player | null): void {
    if (this.pendingImpact === 0) return;
    this.pendingImpact--;
    if (this.pendingImpact > 0) return;
    if (target?.isAlive !== true) return;
    const distance = Math.hypot(target.x - this.x, target.y - this.y);
    if (distance > this.attackRangePx) return;
    if (!(this.hasLOS(target) || this.onSameTile(target))) return;
    this.dealDamage(target, this.attackDamage);
  }

  /** Advances every per-frame timer. Shared by both AI modes. */
  private advanceCombatTimers(target: Player | null): void {
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;
    this.resolvePendingImpact(target);
    if (this.hp < this.previousHp && this.attackAnimTimer === 0) this.animator.startFlinch();
    this.previousHp = this.hp;
    this.animator.tick(this.isMoving, this.attackAnimTimer > 0, SECONDS_PER_FRAME);
  }

  private canStrike(target: Player, distance: number): boolean {
    return (
      distance <= this.attackRangePx &&
      this.attackCooldown === 0 &&
      this.attackWindupTimer === 0 &&
      // Same-tile contact always lands regardless of LOS — can't dodge point-blank.
      (this.hasLOS(target) || this.onSameTile(target))
    );
  }

  /**
   * AI update that keeps the goblin stationary but still attacks targets in melee range.
   * Intended for use by subclasses (e.g. TutorialGoblin defense-only mode).
   */
  protected updateAIStandAndFight(targets: Player[]): void {
    if (!this.isAlive) return;

    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y);
      if (dist < this.attackRangePx && dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    this.currentTarget = nearest;
    this.isMoving = false;
    this.advanceCombatTimers(nearest);

    if (nearest === null) {
      this.isAggro = false;
      this.firstHitPending = true;
      this.attackWindupTimer = 0;
      return;
    }

    this.isAggro = true;
    this.updateLastKnown(nearest);

    const inRange = nearestDist <= this.attackRangePx;
    if (inRange && this.firstHitPending && this.attackWindupTimer === 0) {
      this.attackWindupTimer = ATTACK_WINDUP_FRAMES;
      this.firstHitPending = false;
    }
    if (this.attackWindupTimer > 0) this.attackWindupTimer--;

    if (this.canStrike(nearest, nearestDist)) this.beginAttack();
  }

  updateAI(targets: Player[]) {
    if (!this.isAlive) return;

    // Find nearest living target within aggro range
    const aggroScanRange = this.isAggro
      ? this.aggroRangePx * AGGRO_PERSIST_MULTIPLIER
      : this.aggroRangePx;
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y);
      if (dist < aggroScanRange && dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.firstHitPending = true;
      this.attackWindupTimer = 0;
      this.clearAStarPath();
      this.returnHomeOrWander();
      this.advanceCombatTimers(null);
      return;
    }

    this.isAggro = true;

    // Track last known position while we have LOS (enables navigation around corners)
    this.updateLastKnown(nearest);

    // Chase toward last known position (= current position when LOS is clear).
    //
    // A camp resident that has strayed past its own leash stops *travelling* and
    // heads home instead — but it keeps its target, so it still turns and fights
    // anything that follows it or that is already on top of it. No-op for an
    // unleashed goblin: every one on floors 1 and 2. See `Mob.isBeyondLeash`.
    if (nearestDist > this.attackRangePx) {
      if (this.isBeyondLeash(this.x, this.y)) {
        this.returnHomeOrWander();
      } else {
        this.followTargetAStar(
          this.lastKnownTargetX,
          this.lastKnownTargetY,
          this.speed,
          this.attackRangePx * FOLLOW_STOP_FRACTION,
        );
      }
    } else {
      this.isMoving = false;
    }

    this.advanceCombatTimers(nearest);

    // Brief windup before the very first strike of each engagement
    const inRange = nearestDist <= this.attackRangePx;
    if (inRange && this.firstHitPending && this.attackWindupTimer === 0) {
      this.attackWindupTimer = ATTACK_WINDUP_FRAMES;
      this.firstHitPending = false;
    }
    if (this.attackWindupTimer > 0) this.attackWindupTimer--;

    if (this.canStrike(nearest, nearestDist)) this.beginAttack();
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ) {
    if (!this.isAlive) return;

    const sx = this.x - camX;
    const sy = this.y - camY;

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, sy, tileSize);
    }

    const animFrames = GOBLIN_ATTACKS[this.weapon][this.attackKind].animFrames;
    const attack =
      this.attackAnimTimer > 0
        ? { kind: this.attackKind, progress: 1 - this.attackAnimTimer / animFrames }
        : null;
    const resolved = this.animator.resolve(
      performance.now() / MILLISECONDS_PER_SECOND,
      this.walkFrame,
      this.isMoving,
      attack,
    );

    drawGoblinSprite(ctx, {
      weapon: this.weapon,
      x: sx,
      y: sy,
      tileSize,
      facingX: this.facingX,
      state: resolved.state,
      frame: resolved.frame,
    });

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
