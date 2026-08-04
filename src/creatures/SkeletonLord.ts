import type { Player } from '../Player';
import { Mob, type LootDrop } from './Mob';
import { MAX_MOB_CULL_MARGIN_TILES } from '../core/constants';
import { makeStuck } from '../core/StatusEffect';
import { drawDangerCone } from '../sprites/dangerTelegraph';
import { SKELETON_LORD_BODY_PART_KEY, drawSkeletonLordSprite } from '../sprites/skeletonSprite';
import { drawGraspingHands } from '../sprites/skeletonEffectsSprite';
import { SOUL_BOLT_CAST_FRAMES, soulBoltReleaseFrame } from '../sprites/skeletonTiming';
import { maybeDropSkillBook } from './skillBookDrop';
import type { SkeletonShot } from '../systems/SkeletonProjectileSystem';

/**
 * The Skeleton Lord — a bounty boss.
 *
 * A caster who never wants to be in melee. He holds a mid-range band, throws
 * soul bolts down it, and when the party closes anyway he sweeps a cone of
 * grasping hands out of the ground in front of him: heavy damage and a brief
 * root, telegraphed long enough to walk out of. When his escort thins he raises
 * both hands and more of them climb out of the earth.
 *
 * State machine: `idle → repositioning → cast | hands | summon → cooldown`.
 * Only one attack runs at a time, and each runs to completion — an attack a
 * player can cause to be abandoned is not a telegraph, it is a bluff.
 */

const LORD_HP = 110;
const LORD_SPEED = 0.8;
const AGGRO_RANGE_TILES = 15;

/**
 * The band he wants to fight from. Closer than the minimum he drifts back,
 * further than the maximum he closes; inside it he stands and casts.
 */
const PREFERRED_MIN_TILES = 4.5;
const PREFERRED_MAX_TILES = 8;

/**
 * Boss-tier reward. The named bosses in this game run 500 (the Hoarder) to 2000
 * (the Grotesque Spider); a bounty is meant to be a strong source of XP, so it
 * sits high in that band. `scripts/verify-bounty.ts` asserts every bounty boss
 * stays inside it — three of the five originally shipped near 250, below every
 * named boss in the game and barely above a regular floor-3 mob.
 */
const LORD_XP = 1300;
/** The lowest of the five: his summons keep paying out for as long as he lives. */
const COIN_DROP_MIN = 100;
const COIN_DROP_MAX = 180;
const CENTER_OFFSET = 0.5;

// ── Soul bolts ───────────────────────────────────────────────────────────────

const SOUL_BOLT_COOLDOWN_FRAMES = 165;
const SOUL_BOLT_DAMAGE = 3;
/** Half-angle between adjacent bolts of a fan, in radians. */
const BOLT_FAN_STEP = 0.21;
/** Bolts thrown at full health, and at death's door. */
const BOLT_COUNT_MIN = 1;
const BOLT_COUNT_MAX = 3;
/** Where a bolt leaves him, as a fraction of a tile from his centre. */
const PALM_OFFSET_X = 0.26;
const PALM_OFFSET_Y = -0.1;

/** The value `castTimer` holds on the frame the bolts leave the palm. */
const CAST_RELEASE_TIMER = SOUL_BOLT_CAST_FRAMES - soulBoltReleaseFrame();

// ── Grasping hands ───────────────────────────────────────────────────────────

/**
 * How long the red cone sits on the ground before the hands come up.
 *
 * "Just enough time to get out" — a little under a second at 60 fps, which is
 * one deliberate sidestep and no dithering.
 */
const HANDS_WINDUP_FRAMES = 55;
/** Frames the hands stay up afterwards. Purely a visual; the damage is one frame. */
const HANDS_ERUPTION_FRAMES = 60;
const HANDS_COOLDOWN_FRAMES = 330;
const HANDS_RANGE_TILES = 4;
const HANDS_HALF_ANGLE = 0.87;
/**
 * Fraction of the victim's own maximum health the hands take, following the
 * Grotesque Spider's convention for a fully telegraphed attack: it has to be
 * frightening enough that walking out of the cone is obviously worth doing.
 */
const HANDS_HP_FRACTION = 0.4;
const HANDS_BONUS_DAMAGE = 2;
/** Frames a caught player is rooted. A quarter of the spider's web, not all of it. */
const HANDS_STUCK_FRAMES = 90;
const HANDS_BLOCK_XP = 12;
/** Eruption patches drawn across the cone, spread over its arc and its reach. */
const ERUPTION_ARC_STEPS = 5;
const ERUPTION_RING_STEPS = 2;
/** How much later an outer ring of hands erupts, as a share of the eruption. */
const ERUPTION_RING_DELAY = 0.18;
/**
 * Keeps the outermost ring of hands inside the cone's own radius rather than on
 * its rim, where half of each patch would be drawn over ground the telegraph
 * never covered.
 */
const ERUPTION_OUTER_INSET = 0.4;
/** Where along the arc index the cone's centre line falls. */
const ARC_CENTRE_FRACTION = 0.5;

// ── Summoning ────────────────────────────────────────────────────────────────

const SUMMON_COOLDOWN_FRAMES = 620;
const SUMMON_ANIM_FRAMES = 70;
/** How far into the summon animation the reinforcements are requested. */
const SUMMON_RELEASE_PROGRESS = 0.45;
const SUMMON_SWORD_COUNT = 2;
const SUMMON_ARCHER_COUNT = 1;

/** One reinforcement the lord has asked for; `SkeletonSummonSystem` places it. */
export interface SkeletonSummonRequest {
  readonly kind: 'sword' | 'archer';
  /** World pixels the risen skeleton should appear near — the lord's own position. */
  readonly originX: number;
  readonly originY: number;
}

type LordState = 'idle' | 'cast' | 'hands' | 'summon' | 'cooldown';

/** Frames of enforced quiet after any attack, so two never chain back to back. */
const RECOVERY_FRAMES = 45;

/** Shared empty results so the common nothing-queued path allocates nothing. */
const NO_SHOTS: readonly SkeletonShot[] = [];
const NO_SUMMONS: readonly SkeletonSummonRequest[] = [];

/** Mob levels at which his drop table opens up. */
const LOOT_TIER_TWO_LEVEL = 6;
const LOOT_TIER_THREE_LEVEL = 12;

/**
 * How far off screen he keeps being drawn.
 *
 * Two things set the floor. His art reaches 2.45 tiles above his own tile
 * (`tileY` 157 at `tileScale` 64, measured off the baked sheet), so anything
 * less and he pops in with his crown already visible — and the same number
 * floors `hitFlashMarginTiles`, which would then slice the top off him during
 * the frames he is flashing.
 *
 * The larger floor is the grasping-hands cone: `RenderPipeline` skips `drawSelf`
 * entirely past this margin, and both the telegraph and the eruption are drawn
 * from there. A lord just off screen still passes his own range check against a
 * player near the edge, so at any margin under the cone's reach that player
 * takes the full hit from a warning that was never drawn.
 */
const LORD_CULL_MARGIN_TILES = Math.min(MAX_MOB_CULL_MARGIN_TILES, HANDS_RANGE_TILES);
/** The composite also has to hold the grasping-hands cone, which reaches further. */
const LORD_SILHOUETTE_MARGIN_TILES = HANDS_RANGE_TILES + 1;

export class SkeletonLord extends Mob {
  readonly xpValue = LORD_XP;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  override readonly audioTag = 'skeleton_lord';
  override readonly bodyPartKey = SKELETON_LORD_BODY_PART_KEY;
  displayName = 'Skeleton Lord';
  description = 'A crowned thing of bone and green fire that raises the dead to serve it.';

  /**
   * Written back by `SkeletonSummonSystem` every frame. The lord stops casting
   * summon while it is true rather than queueing requests the system will only
   * throw away — otherwise he burns his cooldown on nothing and the fight has a
   * long silent gap in it for no visible reason.
   */
  escortAtCap = false;

  /**
   * Set on the frame the hands erupt, so the scene can play the cue. Drained by
   * `playMobAudioCues` through the `specialSoundPending` flag; this field only
   * says *which* of his two special cues it was.
   */
  lastSpecial: 'hands' | 'summon' = 'hands';

  private state: LordState = 'idle';
  private castTimer = 0;
  private handsTimer = 0;
  private eruptionTimer = 0;
  private summonTimer = 0;
  private recoveryTimer = 0;
  private boltCooldown = 0;
  private handsCooldown = 0;
  private summonCooldown = SUMMON_COOLDOWN_FRAMES;
  private isAggro = false;
  private summonRequested = false;
  /** Facing frozen for the length of an attack, so a telegraph cannot be re-aimed. */
  private lockedFacingX = 1;
  private lockedFacingY = 0;

  private pendingShots: SkeletonShot[] = [];
  private pendingSummons: SkeletonSummonRequest[] = [];

  private readonly aggroRangePx: number;
  private readonly preferredMinPx: number;
  private readonly preferredMaxPx: number;
  private readonly handsRangePx: number;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, LORD_HP, LORD_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.preferredMinPx = tileSize * PREFERRED_MIN_TILES;
    this.preferredMaxPx = tileSize * PREFERRED_MAX_TILES;
    this.handsRangePx = tileSize * HANDS_RANGE_TILES;
  }

  override get cullMarginTiles(): number {
    return LORD_CULL_MARGIN_TILES;
  }

  protected override get silhouetteMarginTiles(): number {
    // Floored at the base rather than replacing it: the composite box has to
    // clear the telegraph cone *and* whatever the base class already knew it had
    // to clear, and a plain override silently gives up the second of those.
    return Math.max(super.silhouetteMarginTiles, LORD_SILHOUETTE_MARGIN_TILES);
  }

  /** The companion sidesteps him: every one of his attacks is dodgeable. */
  override get requiresEvasion(): boolean {
    return true;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.state = 'idle';
    this.castTimer = 0;
    this.handsTimer = 0;
    this.eruptionTimer = 0;
    this.summonTimer = 0;
    this.recoveryTimer = 0;
    this.boltCooldown = 0;
    this.handsCooldown = 0;
    this.summonCooldown = SUMMON_COOLDOWN_FRAMES;
    this.isAggro = false;
    this.summonRequested = false;
    this.pendingShots = [];
    this.pendingSummons = [];
    this.escortAtCap = false;
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: 'melee' | 'missile' | 'shell' | 'smush' = 'melee',
  ): void {
    const previousHp = this.hp;
    super.takeDamageFrom(amount, attacker, damageType);
    if (this.hp < previousHp) this.damageSoundPending = true;
  }

  /** Hands over every bolt cast since the last call and clears the queue. */
  takePendingShots(): readonly SkeletonShot[] {
    if (this.pendingShots.length === 0) return NO_SHOTS;
    const shots = this.pendingShots;
    this.pendingShots = [];
    return shots;
  }

  /** Hands over every reinforcement requested since the last call. */
  takePendingSummons(): readonly SkeletonSummonRequest[] {
    if (this.pendingSummons.length === 0) return NO_SUMMONS;
    const summons = this.pendingSummons;
    this.pendingSummons = [];
    return summons;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.boltCooldown > 0) this.boltCooldown--;
    if (this.handsCooldown > 0) this.handsCooldown--;
    if (this.summonCooldown > 0) this.summonCooldown--;
    if (this.eruptionTimer > 0) this.eruptionTimer--;

    const nearest = this.acquireTarget(targets, this.aggroRangePx);
    this.currentTarget = nearest;
    this.isAggro = nearest !== null;

    if (this.state !== 'idle') {
      this.advanceAttack(targets);
      return;
    }

    if (!nearest) {
      this.clearAStarPath();
      // Not `doWander`: an un-aggroed bounty mark is leashed to its site, and
      // only this path consults the leash.
      this.returnHomeOrWander();
      return;
    }

    if (this.recoveryTimer > 0) {
      this.recoveryTimer--;
      this.reposition(nearest);
      return;
    }

    if (this.tryStartAttack(nearest)) return;
    this.reposition(nearest);
  }

  /**
   * Picks the next attack.
   *
   * Ordered by urgency rather than by cooldown: the hands exist to punish a
   * player who has closed to melee, so they get first refusal whenever one has.
   * Summoning is last because it is the only one that does no damage.
   */
  private tryStartAttack(target: Player): boolean {
    const distance = this.distanceTo(target);

    if (this.handsCooldown === 0 && distance <= this.handsRangePx) {
      this.beginAttack('hands', target);
      this.handsTimer = HANDS_WINDUP_FRAMES;
      this.handsCooldown = HANDS_COOLDOWN_FRAMES;
      return true;
    }
    if (this.boltCooldown === 0 && this.hasLOS(target)) {
      this.beginAttack('cast', target);
      this.castTimer = SOUL_BOLT_CAST_FRAMES;
      this.boltCooldown = SOUL_BOLT_COOLDOWN_FRAMES;
      return true;
    }
    if (this.summonCooldown === 0 && !this.escortAtCap) {
      this.beginAttack('summon', target);
      this.summonTimer = SUMMON_ANIM_FRAMES;
      this.summonCooldown = SUMMON_COOLDOWN_FRAMES;
      this.summonRequested = false;
      return true;
    }
    return false;
  }

  private beginAttack(state: LordState, target: Player): void {
    this.state = state;
    this.isMoving = false;
    this.faceToward(target);
    // Frozen here, once. A cone that keeps tracking is not a telegraph — the
    // player can be standing clear of the drawn shape and still be caught by it.
    this.lockedFacingX = this.facingX;
    this.lockedFacingY = this.facingY;
  }

  private advanceAttack(targets: Player[]): void {
    this.isMoving = false;

    if (this.state === 'cast') {
      this.castTimer--;
      if (this.castTimer === CAST_RELEASE_TIMER) this.releaseBolts();
      if (this.castTimer <= 0) this.enterCooldown();
      return;
    }

    if (this.state === 'hands') {
      this.handsTimer--;
      if (this.handsTimer <= 0) {
        this.eruptHands(targets);
        this.enterCooldown();
      }
      return;
    }

    if (this.state === 'summon') {
      this.summonTimer--;
      const elapsed = SUMMON_ANIM_FRAMES - this.summonTimer;
      if (!this.summonRequested && elapsed >= SUMMON_ANIM_FRAMES * SUMMON_RELEASE_PROGRESS) {
        this.summonRequested = true;
        this.queueReinforcements();
      }
      if (this.summonTimer <= 0) this.enterCooldown();
    }
  }

  private enterCooldown(): void {
    this.state = 'idle';
    this.castTimer = 0;
    this.handsTimer = 0;
    this.summonTimer = 0;
    this.recoveryTimer = RECOVERY_FRAMES;
  }

  /**
   * Holds the band. He backs off a player closing in and closes on one running
   * away, so the fight keeps its shape whichever the party tries.
   */
  private reposition(target: Player): void {
    const distance = this.distanceTo(target);
    if (distance < this.preferredMinPx) {
      const dx = this.x - target.x;
      const dy = this.y - target.y;
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        this.moveWithCollision((dx / length) * this.speed, (dy / length) * this.speed);
        this.isMoving = true;
      }
      this.faceToward(target);
      return;
    }
    if (distance > this.preferredMaxPx) {
      this.updateLastKnown(target);
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.preferredMaxPx,
      );
      return;
    }
    this.isMoving = false;
    this.faceToward(target);
  }

  /** Where a bolt leaves him, offset toward whichever way he faces. */
  private palmPosition(): { readonly x: number; readonly y: number } {
    const facing = Math.sign(this.lockedFacingX) || 1;
    return {
      x: this.x + this.tileSize * (CENTER_OFFSET + PALM_OFFSET_X * facing),
      y: this.y + this.tileSize * (CENTER_OFFSET + PALM_OFFSET_Y),
    };
  }

  /**
   * How many bolts this cast throws. He escalates as he is worn down, which is
   * what stops the second half of the fight being the same as the first.
   */
  private boltCount(): number {
    const wounded = 1 - this.hp / this.maxHp;
    return Math.min(BOLT_COUNT_MAX, BOLT_COUNT_MIN + Math.floor(wounded * BOLT_COUNT_MAX));
  }

  /**
   * Queues the fan, aimed at wherever the target is on the release frame rather
   * than where it was when the cast began — otherwise the wind-up is free to
   * dodge and the attack never lands on a moving player.
   */
  private releaseBolts(): void {
    const target = this.currentTarget;
    const palm = this.palmPosition();
    const aimX = target ? target.x + this.tileSize * CENTER_OFFSET : palm.x + this.lockedFacingX;
    const aimY = target ? target.y + this.tileSize * CENTER_OFFSET : palm.y + this.lockedFacingY;
    let dirX = aimX - palm.x;
    let dirY = aimY - palm.y;
    // A target standing exactly on the palm would give a zero direction, which
    // normalises to NaN and produces a bolt that never moves and never expires.
    if (dirX === 0 && dirY === 0) {
      dirX = this.lockedFacingX || 1;
      dirY = this.lockedFacingY;
    }
    const heading = Math.atan2(dirY, dirX);
    const count = this.boltCount();
    const damage = this.scaledDamage(SOUL_BOLT_DAMAGE);

    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) / 2) * BOLT_FAN_STEP;
      const angle = heading + spread;
      this.pendingShots.push({
        kind: 'soul_bolt',
        x: palm.x,
        y: palm.y,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
        damage,
        mobType: this.mobType,
        aimedAt: target,
      });
    }
    this.projectileSoundPending = true;
  }

  /**
   * The hands arrive. Damage lands on this one frame rather than over the
   * eruption: an attack that keeps hurting for the length of its own animation
   * punishes a player who was already clear of it by the time they could react.
   */
  private eruptHands(targets: Player[]): void {
    this.eruptionTimer = HANDS_ERUPTION_FRAMES;
    this.lastSpecial = 'hands';
    this.specialSoundPending = true;

    const originX = this.x + this.tileSize * CENTER_OFFSET;
    const originY = this.y + this.tileSize * CENTER_OFFSET;
    const facingAngle = Math.atan2(this.lockedFacingY, this.lockedFacingX);

    // `dealDamage` would have checked this; going round it to avoid its level
    // scaling means checking it here instead, or a harmless lord still lands the
    // one attack in his kit that can kill outright.
    if (this.harmless) return;

    for (const target of targets) {
      if (!target.isAlive) continue;
      const cx = target.x + this.tileSize * CENTER_OFFSET;
      const cy = target.y + this.tileSize * CENTER_OFFSET;
      const dx = cx - originX;
      const dy = cy - originY;
      const distance = Math.hypot(dx, dy);
      if (distance > this.handsRangePx) continue;
      // Angular test against the same facing the cone was drawn from, so what
      // the player saw on the ground is exactly what catches them.
      const offset = Math.abs(normaliseAngle(Math.atan2(dy, dx) - facingAngle));
      if (offset > HANDS_HALF_ANGLE) continue;
      if (this.spells?.isPointInsideShell(cx, cy)) {
        this.spells.addBlockXp(HANDS_BLOCK_XP);
        continue;
      }
      // `takeDamage` rather than `dealDamage`, which is the one place in this
      // class that route is wrong. `dealDamage` multiplies its argument by the
      // mob-level damage scale, and this argument is *already* a fraction of the
      // victim's own health — level-independent by construction. Scaled again at
      // the bounty cap of level 20 it comes to nearly twice the target's maximum
      // HP, so a single cone would be an unconditional kill on any build.
      const connected = target.takeDamage(
        Math.ceil(target.maxHp * HANDS_HP_FRACTION) + HANDS_BONUS_DAMAGE,
        { kind: 'mob', mobType: this.mobType, attackType: 'grasping_hands' },
      );
      // Gated on the hit landing: a dodge that avoids the damage but still roots
      // the player in the middle of the cone is worse than no dodge at all.
      if (connected) target.applyStatus(makeStuck(HANDS_STUCK_FRAMES));
    }
  }

  /**
   * Boss-tier loot.
   *
   * There is no rarity model in this game, so "high quality" means a curated
   * handful of the strong consumables plus the level-scaled coins the base class
   * already rolls. The night-vision book is the thematic one: he is the thing
   * that hunts by green light in the dark.
   */
  protected override rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    items.push({ id: 'health_potion', quantity: 2 });
    items.push({ id: 'jugg_juice', quantity: 1 });
    if (this.mobLevel >= LOOT_TIER_TWO_LEVEL) {
      items.push({ id: 'cooldown_crisp', quantity: 1 });
      items.push({ id: 'speed_fizz', quantity: 1 });
    }
    if (this.mobLevel >= LOOT_TIER_THREE_LEVEL) {
      items.push({ id: 'stat_boost_potion', quantity: 1 });
    }
    maybeDropSkillBook(items, 'skill_book_night_vision');
    return items;
  }

  private queueReinforcements(): void {
    this.lastSpecial = 'summon';
    this.specialSoundPending = true;
    for (let i = 0; i < SUMMON_SWORD_COUNT; i++) {
      this.pendingSummons.push({ kind: 'sword', originX: this.x, originY: this.y });
    }
    for (let i = 0; i < SUMMON_ARCHER_COUNT; i++) {
      this.pendingSummons.push({ kind: 'archer', originX: this.x, originY: this.y });
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

    if (this.handsTimer > 0) this.renderConeTelegraph(ctx, sx, sy, tileSize);
    if (this.eruptionTimer > 0) this.renderEruption(ctx, sx, sy, tileSize);

    if (this.isAggro) this.renderAggroIndicator(ctx, sx, sy, tileSize);

    drawSkeletonLordSprite(ctx, sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      castProgress: this.castTimer > 0 ? 1 - this.castTimer / SOUL_BOLT_CAST_FRAMES : null,
      handsProgress: this.handsTimer > 0 ? 1 - this.handsTimer / HANDS_WINDUP_FRAMES : null,
      summonProgress: this.summonTimer > 0 ? 1 - this.summonTimer / SUMMON_ANIM_FRAMES : null,
    });

    this.renderMobHealthBar(ctx, sx, sy);
  }

  private renderConeTelegraph(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
  ): void {
    const elapsed = HANDS_WINDUP_FRAMES - this.handsTimer;
    const fade = Math.min(1, elapsed / TELEGRAPH_FADE_IN_FRAMES);
    drawDangerCone(
      ctx,
      sx + tileSize * CENTER_OFFSET,
      sy + tileSize * CENTER_OFFSET,
      this.handsRangePx,
      Math.atan2(this.lockedFacingY, this.lockedFacingX),
      HANDS_HALF_ANGLE,
      fade,
    );
  }

  /**
   * The hands themselves, drawn from here rather than from a system.
   *
   * They are pure decoration — every point of damage they do landed on the frame
   * they came up — so nothing is lost if the lord dies underneath them and stops
   * being drawn. That is not true of his bolts, which is exactly why those live
   * in `SkeletonProjectileSystem` instead.
   */
  private renderEruption(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
  ): void {
    const originX = sx + tileSize * CENTER_OFFSET;
    const originY = sy + tileSize * CENTER_OFFSET;
    const facingAngle = Math.atan2(this.lockedFacingY, this.lockedFacingX);
    const elapsed = HANDS_ERUPTION_FRAMES - this.eruptionTimer;
    const progress = elapsed / HANDS_ERUPTION_FRAMES;

    for (let ring = 0; ring < ERUPTION_RING_STEPS; ring++) {
      const reach = this.handsRangePx * ((ring + 1) / (ERUPTION_RING_STEPS + ERUPTION_OUTER_INSET));
      // Outer rings come up late, so the wave visibly travels away from him
      // rather than the whole cone popping at once.
      const ringProgress = progress - ring * ERUPTION_RING_DELAY;
      if (ringProgress <= 0 || ringProgress >= 1) continue;
      for (let i = 0; i < ERUPTION_ARC_STEPS; i++) {
        const t = i / (ERUPTION_ARC_STEPS - 1) - ARC_CENTRE_FRACTION;
        const angle = facingAngle + t * HANDS_HALF_ANGLE * 2;
        drawGraspingHands(
          ctx,
          originX + Math.cos(angle) * reach,
          originY + Math.sin(angle) * reach,
          tileSize,
          ringProgress,
        );
      }
    }
  }
}

/** Frames the cone takes to reach full opacity — long enough to notice, short enough to act. */
const TELEGRAPH_FADE_IN_FRAMES = 10;

/** Wraps an angle difference into −π…π so a cone test never straddles the seam. */
function normaliseAngle(angle: number): number {
  const wrapped = ((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2;
  return (wrapped % (Math.PI * 2)) - Math.PI;
}
