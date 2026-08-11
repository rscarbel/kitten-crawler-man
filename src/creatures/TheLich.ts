import type { Player } from '../Player';
import { Mob, type LootDrop, type PlayerDamageType } from './Mob';
import { MAX_MOB_CULL_MARGIN_TILES, PLAYER_SPEED } from '../core/constants';
import { makeStuck } from '../core/StatusEffect';
import { drawDangerCone } from '../sprites/dangerTelegraph';
import { LICH_BODY_PART_KEY, drawTheLichSprite } from '../sprites/lichSprite';
import { drawGraspingHands } from '../sprites/skeletonEffectsSprite';
import { SOUL_BOLT_CAST_FRAMES, soulBoltReleaseFrame } from '../sprites/skeletonTiming';
import type { SkeletonShot } from '../systems/SkeletonProjectileSystem';
import type { SkeletonSummonRequest } from './SkeletonLord';

/**
 * The Lich — the thing that has been wearing Magistrate Featherfall's office.
 *
 * Featherfall died weeks before the murders started. Somebody still kept his
 * appointments, still signed his letters, still suspected nothing on his behalf;
 * that somebody is a clerk-robed revenant that has been running a magistracy
 * from behind a corpse, and it fights the way it has been governing — at arm's
 * length, from behind a queue of subordinates it can raise more of.
 *
 * Its kit is deliberately the Skeleton Lord's, which the bounty board owns and
 * which nothing here may touch: soul bolts down a mid-range band, a telegraphed
 * cone of grasping hands for anyone who closes, and a raised escort. The
 * *structure* is copied rather than inherited so retuning one can never retune
 * the other — this fight is indoors in a single room, and it is tuned for that.
 *
 * State machine: `idle → cast | hands | summon → cooldown`. One attack at a
 * time, each running to completion.
 */

/**
 * Base health, before the encounter's spawn level multiplies it. Levelled as
 * the confrontation spawns it, this clears Miss Quill's own bar — the thing
 * that has been running the magistracy behind her is the real fight in the
 * room, and a shorter bar than the fight the player just finished would read
 * as an anticlimax rather than the reveal it is.
 */
const LICH_HP = 190;
/** Marginally quicker than the Skeleton Lord: the office is small and it kites. */
const LICH_SPEED = 0.85;
const AGGRO_RANGE_TILES = 15;

/**
 * Ceiling on the Lich's post-level walk speed, expressed the same way as the
 * other levelled-speed-cap creatures (Goblin, GoblinArcher, SkeletonWarrior):
 * a fixed ratio of the player's own speed, so a future retune of
 * {@link LICH_SPEED} or the level curve cannot quietly reopen the goblin
 * runaway for a boss the player is meant to be able to kite.
 */
const LICH_MAX_SPEED_RATIO = 0.9;
export const LICH_MAX_SPEED = PLAYER_SPEED * LICH_MAX_SPEED_RATIO;

/**
 * The band it wants to fight from, tightened against the Skeleton Lord's.
 *
 * The magistrate's office is one room. A band sized for open ground would have
 * the Lich backed into a wall for most of the fight, where the retreat leg of
 * its repositioning does nothing and it simply stands still.
 *
 * `PREFERRED_MIN_TILES` sits just outside `HANDS_RANGE_TILES` (4), the same
 * way the Skeleton Lord's own preferred-min sits outside its hands range —
 * the hands exist to punish a player who has closed, so the kiting band it
 * retreats to can never itself be within their reach.
 */
const PREFERRED_MIN_TILES = 4.5;
const PREFERRED_MAX_TILES = 6.5;

/**
 * Quest-boss reward, between Miss Quill's 600 and the bounty bosses' band: it
 * is the last thing standing between the party and the end of the questline.
 */
const LICH_XP = 900;
/** In line with the Quill fight's own payout rather than with a bounty's. */
const COIN_DROP_MIN = 35;
const COIN_DROP_MAX = 70;
const CENTER_OFFSET = 0.5;

// ── Soul bolts ───────────────────────────────────────────────────────────────

/**
 * Shorter than the Skeleton Lord's, deliberately.
 *
 * The Lich carries more health than he does, and health alone is the one thing
 * that must never be what makes a fight harder — a longer time to kill at the
 * same rate of incoming pressure is a fight that drags. The extra health buys
 * the escort time to matter; the shorter cooldowns are what make it dangerous.
 */
const SOUL_BOLT_COOLDOWN_FRAMES = 135;
const SOUL_BOLT_DAMAGE = 3;
/** Half-angle between adjacent bolts of a fan, in radians. */
const BOLT_FAN_STEP = 0.21;
/** Bolts thrown at full health, and at death's door. */
const BOLT_COUNT_MIN = 1;
const BOLT_COUNT_MAX = 3;
/** Where a bolt leaves it, as a fraction of a tile from its centre. */
const PALM_OFFSET_X = 0.26;
const PALM_OFFSET_Y = -0.1;

/** The value `castTimer` holds on the frame the bolts leave the palm. */
const CAST_RELEASE_TIMER = SOUL_BOLT_CAST_FRAMES - soulBoltReleaseFrame();

// ── Grasping hands ───────────────────────────────────────────────────────────

/**
 * How long the cone sits on the ground before the hands come up.
 *
 * Kept at the Skeleton Lord's number rather than shortened with the rest of the
 * clocks: a locked telegraph is the player's whole defence against an attack
 * that takes a flat share of their maximum health, and it is floored at 21
 * frames for every creature in the game. This one has margin over that floor
 * and is keeping it.
 */
export const HANDS_WINDUP_FRAMES = 55;
/** Frames the hands stay up afterwards. Purely a visual; the damage is one frame. */
const HANDS_ERUPTION_FRAMES = 60;
const HANDS_COOLDOWN_FRAMES = 285;
const HANDS_RANGE_TILES = 4;
const HANDS_HALF_ANGLE = 0.87;
/** Fraction of the victim's own maximum health the hands take. */
const HANDS_HP_FRACTION = 0.4;
const HANDS_BONUS_DAMAGE = 2;
/** Frames a caught player is rooted. */
const HANDS_STUCK_FRAMES = 90;
const HANDS_BLOCK_XP = 12;
/** Eruption patches drawn across the cone, spread over its arc and its reach. */
const ERUPTION_ARC_STEPS = 5;
const ERUPTION_RING_STEPS = 2;
/** How much later an outer ring of hands erupts, as a share of the eruption. */
const ERUPTION_RING_DELAY = 0.18;
/** Keeps the outermost ring inside the cone's radius rather than on its rim. */
const ERUPTION_OUTER_INSET = 0.4;
/** Where along the arc index the cone's centre line falls. */
const ARC_CENTRE_FRACTION = 0.5;
/** Frames the cone takes to reach full opacity. */
const TELEGRAPH_FADE_IN_FRAMES = 10;

// ── Summoning ────────────────────────────────────────────────────────────────

const SUMMON_COOLDOWN_FRAMES = 540;
const SUMMON_ANIM_FRAMES = 70;
/** How far into the summon animation the reinforcements are requested. */
const SUMMON_RELEASE_PROGRESS = 0.45;
const SUMMON_SWORD_COUNT = 2;
const SUMMON_ARCHER_COUNT = 1;

/**
 * Living escorts the Lich may hold at once.
 *
 * Far below the Skeleton Lord's, and for a reason that is a property of the
 * room rather than of the creature: this fight happens in the magistrate's
 * office, and a crowd that would merely be thick on open ground makes a single
 * chamber impassable — the party cannot sidestep the cone it is being warned
 * about if there is nowhere left to step.
 */
export const LICH_ESCORT_CAP = 5;

type LichState = 'idle' | 'cast' | 'hands' | 'summon' | 'cooldown';

/** Frames of enforced quiet after any attack, so two never chain back to back. */
const RECOVERY_FRAMES = 40;

/** Shared empty results so the common nothing-queued path allocates nothing. */
const NO_SHOTS: readonly SkeletonShot[] = [];
const NO_SUMMONS: readonly SkeletonSummonRequest[] = [];

/**
 * How far off screen it keeps being drawn.
 *
 * Floored by the grasping-hands cone rather than by the art: `RenderPipeline`
 * skips `drawSelf` past this margin, and the telegraph is drawn from there — so
 * at any margin under the cone's reach, a Lich just off screen still lands the
 * full hit from a warning that was never drawn.
 */
const LICH_CULL_MARGIN_TILES = Math.min(MAX_MOB_CULL_MARGIN_TILES, HANDS_RANGE_TILES);
/** The composite also has to hold the cone, which reaches further than the art. */
const LICH_SILHOUETTE_MARGIN_TILES = HANDS_RANGE_TILES + 1;

export class TheLich extends Mob {
  readonly xpValue = LICH_XP;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  override readonly audioTag = 'the_lich';
  override readonly bodyPartKey = LICH_BODY_PART_KEY;
  displayName = 'The Lich';
  description =
    'A clerk-robed revenant with a magistrate’s seal at its belt and nothing under the hood but green fire.';

  /**
   * How many raised skeletons this caster is allowed to hold.
   *
   * Read by `SkeletonSummonSystem` rather than baked into it: the cap is a
   * property of the encounter's room, and the same system also serves an
   * outdoor boss whose ceiling is nearly twice this.
   */
  readonly escortCap = LICH_ESCORT_CAP;

  /** Written back by `SkeletonSummonSystem` every frame. */
  escortAtCap = false;

  /**
   * Which of its two special cues fired, drained through `specialSoundPending`.
   */
  lastSpecial: 'hands' | 'summon' = 'hands';

  /** Set on the frame a cast begins, a full second before the bolts leave. */
  castWindupSoundPending = false;

  private state: LichState = 'idle';
  private castTimer = 0;
  private handsTimer = 0;
  private eruptionTimer = 0;
  /**
   * The wave's own heading and world origin, taken the frame the hands come up.
   *
   * `lockedFacing` cannot carry this: the eruption outlives its own recovery
   * window, so the next cast overwrites the lock while these hands are still
   * rising and the wave would swing onto the new heading mid-animation. Once
   * cast, the wave is committed to the line it started on.
   */
  private eruptionFacingAngle = 0;
  private eruptionOriginX = 0;
  private eruptionOriginY = 0;
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
    super(tileX, tileY, tileSize, LICH_HP, LICH_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.preferredMinPx = tileSize * PREFERRED_MIN_TILES;
    this.preferredMaxPx = tileSize * PREFERRED_MAX_TILES;
    this.handsRangePx = tileSize * HANDS_RANGE_TILES;
  }

  override clearAirborneAttacks(): void {
    this.pendingShots = [];
    this.pendingSummons = [];
  }

  override get cullMarginTiles(): number {
    return LICH_CULL_MARGIN_TILES;
  }

  protected override get silhouetteMarginTiles(): number {
    // Floored at the base rather than replacing it: the composite box has to
    // clear the telegraph cone *and* whatever the base class already knew about.
    return Math.max(super.silhouetteMarginTiles, LICH_SILHOUETTE_MARGIN_TILES);
  }

  protected override get levelledSpeedCap(): number {
    return LICH_MAX_SPEED;
  }

  /** The companion sidesteps it: every one of its attacks is dodgeable. */
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
    this.castWindupSoundPending = false;
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
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
      this.doWander();
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
   * Picks the next attack, ordered by urgency rather than by cooldown: the
   * hands exist to punish a player who has closed, so they get first refusal
   * whenever one has. Summoning is last because it is the only one that does no
   * damage.
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
      this.castWindupSoundPending = true;
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

  private beginAttack(state: LichState, target: Player): void {
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
   * Holds the band. It backs off a player closing in and closes on one running
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

  /** Where a bolt leaves it, offset toward whichever way it faces. */
  private palmPosition(): { readonly x: number; readonly y: number } {
    const facing = Math.sign(this.lockedFacingX) || 1;
    return {
      x: this.x + this.tileSize * (CENTER_OFFSET + PALM_OFFSET_X * facing),
      y: this.y + this.tileSize * (CENTER_OFFSET + PALM_OFFSET_Y),
    };
  }

  /**
   * How many bolts this cast throws. It escalates as it is worn down, which is
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
    this.eruptionFacingAngle = facingAngle;
    this.eruptionOriginX = originX;
    this.eruptionOriginY = originY;

    // `dealDamage` would have checked this; going round it to avoid its level
    // scaling means checking it here instead, or a harmless Lich still lands the
    // one attack in its kit that can kill outright.
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
      // `dealPreScaledRangedDamage` rather than `dealDamage`: this argument is
      // already a fraction of the victim's own health, so it is level-independent
      // by construction and scaling it again would make one cone an
      // unconditional kill. It is also an area shockwave with no single point of
      // contact for armour to bite into, so it does not reflect.
      const handsDamage = Math.ceil(target.maxHp * HANDS_HP_FRACTION) + HANDS_BONUS_DAMAGE;
      const connected = this.dealPreScaledRangedDamage(target, handsDamage, 'grasping_hands');
      // Gated on the hit landing: a dodge that avoids the damage but still roots
      // the player in the middle of the cone is worse than no dodge at all.
      if (connected) {
        target.applyStatus(makeStuck(HANDS_STUCK_FRAMES));
      }
    }
  }

  /**
   * Quest-boss loot. No skill book: this is a scripted story fight the player
   * arrives at once, and the questline pays its own reward on top.
   */
  protected override rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    items.push({ id: 'health_potion', quantity: 2 });
    items.push({ id: 'stat_boost_potion', quantity: 1 });
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

    drawTheLichSprite(ctx, sx, sy, tileSize, {
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
   * they came up — so nothing is lost if the Lich dies underneath them and stops
   * being drawn. That is not true of its bolts, which is exactly why those live
   * in `SkeletonProjectileSystem` instead.
   */
  private renderEruption(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
  ): void {
    // Drawn from where the wave began rather than from where he now stands: a
    // knockback mid-eruption would otherwise drag the whole cone along with him.
    const cameraOffsetX = sx - this.x;
    const cameraOffsetY = sy - this.y;
    const originX = this.eruptionOriginX + cameraOffsetX;
    const originY = this.eruptionOriginY + cameraOffsetY;
    const facingAngle = this.eruptionFacingAngle;
    const elapsed = HANDS_ERUPTION_FRAMES - this.eruptionTimer;
    const progress = elapsed / HANDS_ERUPTION_FRAMES;

    for (let ring = 0; ring < ERUPTION_RING_STEPS; ring++) {
      const reach = this.handsRangePx * ((ring + 1) / (ERUPTION_RING_STEPS + ERUPTION_OUTER_INSET));
      // Outer rings come up late, so the wave visibly travels away from it
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

/** Wraps an angle difference into −π…π so a cone test never straddles the seam. */
function normaliseAngle(angle: number): number {
  const wrapped = ((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2;
  return (wrapped % (Math.PI * 2)) - Math.PI;
}
