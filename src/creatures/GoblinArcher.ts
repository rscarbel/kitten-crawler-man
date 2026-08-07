import type { Player } from '../Player';
import { Mob } from './Mob';
import type { LootDrop } from './Mob';
import { maybeDropSkillBook } from './skillBookDrop';
import {
  GOBLIN_BOW_SHOTS,
  GoblinAnimator,
  drawGoblinSprite,
  goblinArrowReleaseFrame,
  goblinBodyPartKey,
  type GoblinAttackKind,
} from '../sprites/goblinSprite';
import { GOBLIN_PACK_ALERT_RADIUS_TILES, GOBLIN_PACK_KIND } from './Goblin';
import type { GoblinArrowShot } from '../systems/GoblinArrowSystem';

/**
 * A goblin that will not close.
 *
 * The point of it is target priority. Four melee goblins are a fight the player
 * solves by backing into a doorway and swinging; put one of these behind them
 * and the doorway stops working, because standing still is what the archer
 * punishes. It holds a band, gives ground when the player closes, and the only
 * way to stop it is to go and get it — which means walking through the melee
 * line that is there to stop you.
 *
 * It never spawns alone. On its own it is a slow, fragile plinker the player
 * simply walks down; attached to a melee group it is the reason the group is
 * dangerous. See the `escorts` field on `MobSpawnRule`.
 */

const ARCHER_HP = 5;
const ARCHER_SPEED = 1.2;
const AGGRO_RANGE_TILES = 9;

/**
 * The band it works in. Inside the minimum it backs off, past the maximum it
 * closes, and only between the two does it shoot.
 *
 * The minimum is what makes it a *ranged* threat rather than another body in
 * the scrum: at melee range a bow is useless, and an archer that let itself be
 * cornered would just be a weaker goblin.
 */
const BAND_MIN_TILES = 3.5;
const BAND_MAX_TILES = 6;

/**
 * How far it will give ground in one continuous retreat, in frames, and how
 * long before it may do so again.
 *
 * Both exist for the same reason the llama's do: an archer that can always open
 * the gap can never be caught, which is the frustrating version of this rather
 * than the pressuring one. Backed into a wall it simply stops, which is the
 * correct outcome — cornering the archer is how the player beats it.
 */
const RETREAT_MAX_FRAMES = 70;
const RETREAT_COOLDOWN_FRAMES = 150;

const COIN_DROP_MIN = 2;
const COIN_DROP_MAX = 4;
const CENTER_OFFSET = 0.5;

/** Where the arrow leaves the archer, as a fraction of a tile from its origin. */
const BOW_OFFSET_X = 0.62;
const BOW_OFFSET_Y = 0.28;

const FRAMES_PER_SECOND = 60;
const SECONDS_PER_FRAME = 1 / FRAMES_PER_SECOND;
const MILLISECONDS_PER_SECOND = 1000;

/** Shared empty result so the common no-shots-this-frame path allocates nothing. */
const NO_SHOTS: readonly GoblinArrowShot[] = [];

export class GoblinArcher extends Mob {
  readonly xpValue = 7;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Goblin Archer';
  description = 'Hangs back behind its own line and punishes anyone who stands still.';
  override readonly audioTag = 'goblin';
  override readonly bodyPartKey = goblinBodyPartKey('bow');

  private readonly animator = new GoblinAnimator('bow');
  private readonly aggroRangePx: number;
  private readonly bandMinPx: number;
  private readonly bandMaxPx: number;

  private shotCooldown = 0;
  /** Frames left in the current draw, or 0 when nothing is being drawn. */
  private drawTimer = 0;
  private shotKind: GoblinAttackKind = 'heavy';
  private isAggro = false;
  private retreatFrames = 0;
  private retreatCooldown = 0;
  /**
   * Where the shot is going, captured on the last frame of aim tracking, or null
   * when this draw has not aimed at anything yet.
   *
   * World pixels, at the target's centre. This is the telegraph: everything
   * after the lock — the rest of the draw, the release, the arrow's heading — is
   * resolved against this point and not against wherever the target has got to
   * since. See {@link tickDraw}.
   *
   * Nullable rather than a zeroed pair, and cleared at the start of every draw:
   * a sentinel would have to be a coordinate no aim point can occupy, and
   * "never aimed at anything this shot" is a real state — a target that dies on
   * the frame the draw begins leaves every tracking frame with nothing to aim
   * at, and the last shot's aim point must not stand in for it.
   */
  private lockedAim: { x: number; y: number } | null = null;
  private previousHp: number;
  /**
   * Arrows loosed but not yet handed to `GoblinArrowSystem`, which drains this
   * every frame. The archer never owns an arrow in flight: it stops being
   * updated and drawn the instant it dies, and a shot stored here would be
   * deleted in mid-air along with it.
   */
  private pendingShots: GoblinArrowShot[] = [];

  override clearAirborneAttacks(): void {
    this.pendingShots = [];
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, ARCHER_HP, ARCHER_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.bandMinPx = tileSize * BAND_MIN_TILES;
    this.bandMaxPx = tileSize * BAND_MAX_TILES;
    this.previousHp = this.hp;
  }

  /**
   * Shares the melee goblins' pack, so a room answers as one group.
   *
   * This is the whole reason {@link Mob.packKind} exists as something separate
   * from the class name: an archer that only ever called other archers would
   * stand and watch its own front line get pulled apart a goblin at a time.
   */
  override get packKind(): string {
    return GOBLIN_PACK_KIND;
  }

  protected override get packAlertRadiusTiles(): number {
    return GOBLIN_PACK_ALERT_RADIUS_TILES;
  }

  /** Its telegraphs are long and its shots are dodgeable — so the companion dodges. */
  override get requiresEvasion(): boolean {
    return true;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.shotCooldown = 0;
    this.drawTimer = 0;
    this.isAggro = false;
    this.retreatFrames = 0;
    this.retreatCooldown = 0;
    this.lockedAim = null;
    this.pendingShots = [];
    this.previousHp = this.hp;
    this.animator.reset();
  }

  /** Arrows, and the odd stolen book on staying out of reach. */
  protected override rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    maybeDropSkillBook(items, 'skill_book_cat_reflexes');
    return items;
  }

  /**
   * Hands over every arrow loosed since the last call and clears the queue.
   *
   * Returning the array wholesale rather than one at a time is deliberate: the
   * caller must be able to drain an archer that has since died, and a
   * pull-one-per-frame interface would strand the rest.
   */
  takePendingShots(): readonly GoblinArrowShot[] {
    if (this.pendingShots.length === 0) return NO_SHOTS;
    const shots = this.pendingShots;
    this.pendingShots = [];
    return shots;
  }

  /**
   * Whether a draw is under way.
   *
   * Public only so `scripts/verify-difficulty.ts` can drive one archer through a
   * whole shot and check that the aim lock is real — the constants alone cannot
   * prove that, and the constants are what the rest of that harness sees.
   */
  get isDrawing(): boolean {
    return this.drawTimer > 0;
  }

  /**
   * How far through its current draw the archer is, 0–1, or null when it is not
   * drawing. Read by the sprite, and by nothing else.
   */
  private get drawProgress(): number | null {
    if (this.drawTimer === 0) return null;
    return 1 - this.drawTimer / GOBLIN_BOW_SHOTS[this.shotKind].animFrames;
  }

  /** The value `drawTimer` holds on the frame the string is let go. */
  private releaseTimerFor(kind: GoblinAttackKind): number {
    return GOBLIN_BOW_SHOTS[kind].animFrames - goblinArrowReleaseFrame(kind);
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    if (this.shotCooldown > 0) this.shotCooldown--;
    if (this.retreatCooldown > 0) this.retreatCooldown--;

    const nearest = this.acquireTarget(targets, this.aggroRangePx);
    this.currentTarget = nearest;

    if (this.drawTimer > 0) {
      this.tickDraw(nearest);
      this.advanceAnimator();
      return;
    }

    if (!nearest) {
      this.isAggro = false;
      this.retreatFrames = 0;
      this.clearAStarPath();
      // Not `doWander`: a floor-3 camp resident is leashed to its camp, and only
      // this path consults the leash.
      this.returnHomeOrWander();
      this.advanceAnimator();
      return;
    }

    this.isAggro = true;
    this.hold(nearest);
    this.advanceAnimator();
  }

  /**
   * One frame of a draw already under way.
   *
   * The draw runs to completion whatever happens to the target — it is the
   * player's warning that a shot is coming, and an archer that abandoned it
   * because they stepped behind a pillar would have told them a lie. It keeps
   * tracking until the aim locks, though: facing frozen from the first frame, an
   * archer that a player simply walks around looses at where they used to be,
   * playing a forward-facing draw while the arrow leaves the other way.
   *
   * The lock freezes **the aim point**, not merely the facing. Freezing the
   * sprite's direction while resolving the shot vector at release is the
   * cosmetic version of this: it looks like a telegraph, it satisfies a check
   * that a constant is 21, and the arrow still tracks a moving player perfectly
   * — so moving out of the line, which is the one answer the fairness rules
   * require to exist, does nothing.
   */
  private tickDraw(nearest: Player | null): void {
    this.drawTimer--;
    this.isMoving = false;
    this.isAggro = nearest !== null;
    const releaseTimer = this.releaseTimerFor(this.shotKind);
    const lockTimer = releaseTimer + GOBLIN_BOW_SHOTS[this.shotKind].lockedFrames;
    if (this.drawTimer > lockTimer && nearest) {
      this.faceToward(nearest);
      this.lockedAim = {
        x: nearest.x + this.tileSize * CENTER_OFFSET,
        y: nearest.y + this.tileSize * CENTER_OFFSET,
      };
    }
    if (this.drawTimer === releaseTimer) this.loose();
  }

  /** Movement and shot selection for an archer that is not mid-draw. */
  private hold(nearest: Player): void {
    const bow = this.bowPosition();
    const targetCx = nearest.x + this.tileSize * CENTER_OFFSET;
    const targetCy = nearest.y + this.tileSize * CENTER_OFFSET;
    const hasLineOfSight = this.map
      ? this.map.hasLineOfSight(bow.x, bow.y, targetCx, targetCy)
      : true;
    if (hasLineOfSight) {
      this.lastKnownTargetX = nearest.x;
      this.lastKnownTargetY = nearest.y;
    }

    const distance = this.distanceTo(nearest);
    const isCrowded = distance < this.bandMinPx;
    if (isCrowded && this.retreatFrames === 0 && this.retreatCooldown === 0) {
      this.retreatFrames = RETREAT_MAX_FRAMES;
      this.retreatCooldown = RETREAT_COOLDOWN_FRAMES;
    }

    if (this.retreatFrames > 0) {
      this.retreatFrames--;
      if (distance >= this.bandMaxPx) {
        this.retreatFrames = 0;
        this.isMoving = false;
      } else {
        this.backAwayFrom(nearest);
      }
    } else if (!hasLineOfSight) {
      // Blocked: move onto the last place it could see them, looking for an
      // angle. Standing still and drawing at a wall is what a turret does.
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.bandMinPx,
      );
    } else if (distance > this.bandMaxPx) {
      if (this.isBeyondLeash(this.x, this.y)) {
        this.returnHomeOrWander();
      } else {
        this.followTargetAStar(nearest.x, nearest.y, this.speed, this.bandMaxPx);
      }
    } else {
      this.isMoving = false;
    }

    if (!this.isMoving) this.faceToward(nearest);

    if (!hasLineOfSight || distance > this.bandMaxPx || this.shotCooldown > 0) return;
    // The hurried shot is for a target that has closed inside the band and is
    // being backed away from; the aimed one is the archer's standard. Both keep
    // the same locked telegraph, so what the hurried one buys is committing
    // sooner rather than warning the player less.
    this.shotKind = isCrowded ? 'light' : 'heavy';
    const shot = GOBLIN_BOW_SHOTS[this.shotKind];
    this.shotCooldown = this.scaledCooldownFrames(shot.cooldownFrames);
    this.drawTimer = shot.animFrames;
    // Every draw starts having aimed at nothing, so a shot whose target dies
    // before the first tracking frame cannot inherit the previous shot's line.
    this.lockedAim = null;
  }

  /**
   * Retreats directly away from a target that has closed inside the band.
   *
   * Straight-line rather than pathfound on purpose: an archer that A*s its way
   * backwards around a corner spends the whole retreat facing its own path and
   * never shoots.
   */
  private backAwayFrom(target: Player): void {
    const dx = this.x - target.x;
    const dy = this.y - target.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    this.moveWithCollision((dx / distance) * this.speed, (dy / distance) * this.speed);
    this.isMoving = true;
    this.faceToward(target);
  }

  /** Where the arrow leaves the archer, offset toward whichever way it faces. */
  private bowPosition(): { readonly x: number; readonly y: number } {
    const facing = Math.sign(this.facingX) || 1;
    return {
      x: this.x + this.tileSize * (CENTER_OFFSET + BOW_OFFSET_X * facing),
      y: this.y + this.tileSize * BOW_OFFSET_Y,
    };
  }

  /**
   * Queues one arrow along the line the aim locked onto.
   *
   * Deliberately **not** aimed at where the target is now: that is the whole
   * telegraph. An archer that re-aimed on the release frame would hit a player
   * who reacted to its draw exactly as reliably as one who ignored it, which
   * makes the 21 frames of frozen aim a lie the animation tells.
   */
  private loose(): void {
    const target = this.currentTarget;
    const bow = this.bowPosition();
    // Falls back to straight ahead only when the lock never ran — an archer
    // whose target vanished before it had aimed at anything.
    const lock = this.lockedAim;
    const aimX = lock === null ? bow.x + this.facingX : lock.x;
    const aimY = lock === null ? bow.y + this.facingY : lock.y;
    const dirX = aimX - bow.x;
    const dirY = aimY - bow.y;
    // A target standing exactly on the bow would give a zero direction, which
    // normalises to NaN and produces an arrow that never moves and never expires.
    const degenerate = dirX === 0 && dirY === 0;
    this.pendingShots.push({
      x: bow.x,
      y: bow.y,
      dirX: degenerate ? this.facingX || 1 : dirX,
      dirY: degenerate ? this.facingY : dirY,
      damage: this.scaledDamage(GOBLIN_BOW_SHOTS[this.shotKind].damage),
      mobType: this.mobType,
      aimedAt: target,
    });
    this.projectileSoundPending = true;
  }

  private advanceAnimator(): void {
    if (this.hp < this.previousHp && this.drawTimer === 0) this.animator.startFlinch();
    this.previousHp = this.hp;
    this.animator.tick(this.isMoving, this.drawTimer > 0, SECONDS_PER_FRAME);
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

    if (this.isAggro) this.renderAggroIndicator(ctx, sx, sy, tileSize);

    const progress = this.drawProgress;
    const resolved = this.animator.resolve(
      performance.now() / MILLISECONDS_PER_SECOND,
      this.walkFrame,
      this.isMoving,
      progress === null ? null : { kind: this.shotKind, progress },
    );

    drawGoblinSprite(ctx, {
      archetype: 'bow',
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
