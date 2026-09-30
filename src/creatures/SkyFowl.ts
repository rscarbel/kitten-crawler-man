import { Mob } from './Mob';
import type { PlayerDamageType } from './Mob';
import { maybeDropSkillBook } from './skillBookDrop';
import type { Player } from '../Player';
import { drawSkyfowlCastSprite } from '../sprites/skyfowlCastSprite';
import {
  RUN_FRAMES,
  WALK_FRAMES,
  skyfowlRunCyclePx,
  skyfowlWalkCyclePx,
} from '../sprites/art/skyfowlCastFigure';
import { gaitCyclesForDistance } from '../sprites/gaitCadence';
import { SKYFOWL_TOUGH_LOOKS, type SkyfowlLookId } from '../sprites/art/skyfowl/cast';
import type { LootDrop } from './Mob';
import { randomInt } from '../utils';
import type { TacticsTrait } from './tactics/tacticsTraits';

/** Picks which of the four street-tough looks this fowl wears for its lifetime. */
function randomSkyfowlToughLookId(): SkyfowlLookId {
  const look = SKYFOWL_TOUGH_LOOKS[Math.floor(Math.random() * SKYFOWL_TOUGH_LOOKS.length)];
  return look.id;
}

/** The blows the player lands by hand, as opposed to anything fired or thrown. */
const HAND_SWUNG_DAMAGE_TYPES: ReadonlySet<PlayerDamageType | null> =
  new Set<PlayerDamageType | null>(['melee', 'smush']);

const FOWL_HP = 14;
const FOWL_SPEED_NEUTRAL = 0.55;
const FOWL_SPEED_AGGRO = 1.5;

/** How far (in tiles) the fowl wanders from its spawn point when neutral. */
const WANDER_RADIUS_TILES = 10;

/** Tile range within which a peck can land. */
const PECK_RANGE_TILES = 0.9;
const PECK_DAMAGE = 3;
/** Frames between peck attacks (~1.4 s at 60 fps). */
const PECK_COOLDOWN = 85;
/** Frames the peck lunge animation plays. */
const PECK_ANIM_FRAMES = 12;
/** Probability of pausing during a wander cycle. */
const WANDER_PAUSE_CHANCE = 0.35;
/** Fraction of base speed used while wandering. */
const WANDER_SPEED_FRACTION = 0.4;
/** Min and max frames between direction changes when wandering. */
const WANDER_TIMER_MIN = 110;
const WANDER_TIMER_MAX = 309;
/** Fraction of base speed used when pulling back toward spawn. */
const WANDER_PULLBACK_FRACTION = 0.45;
/** Fraction of peck range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.7;
/** Fraction of peck range within which the peck attack is attempted. */
const PECK_ENGAGE_FRACTION = 1.2;
const FOWL_TACTICS: readonly TacticsTrait[] = ['flank', 'regroup'];
/**
 * Ground covered per tick, in tiles, above which the legs change from a walk
 * to a run, and below which they change back — two thresholds, so a speed
 * hovering at one does not flicker between the rows. The walk's own stride
 * holds the feet still up to about a thirtieth of a tile a tick, where its
 * one-frame-a-tick cadence cap binds; the angry sprint covers more than that,
 * which the walk could only play by skating.
 */
const RUN_ENTER_TILES_PER_TICK = 0.025;
const RUN_EXIT_TILES_PER_TICK = 0.019;
/**
 * Less ground than this in a tick is standing still: a fowl grinding into a
 * wall reports it is walking but goes nowhere, and must not tread air.
 */
const STILL_TILES_PER_TICK = 0.002;
/**
 * Ticks the legs keep walking after the fowl last moved, so a collision slide
 * that loses one tick's motion does not snap the row to idle and back.
 */
const MOTION_HOLD_TICKS = 4;

/**
 * The speeds a fowl actually travels at, in world pixels a tick at base
 * stats: wandering, pulled back toward its spawn, and chasing. The foot-lock
 * gate holds the walk and run rows to exactly these.
 */
export const SKYFOWL_MOB_TRAVEL_SPEEDS: readonly { readonly pxPerTick: number }[] = [
  { pxPerTick: FOWL_SPEED_NEUTRAL * WANDER_SPEED_FRACTION },
  { pxPerTick: FOWL_SPEED_NEUTRAL * WANDER_PULLBACK_FRACTION },
  { pxPerTick: FOWL_SPEED_AGGRO },
];

/** Whether legs covering `tilesPerTick` run, from a standing start. */
export function skyfowlMobRunsAt(tilesPerTick: number): boolean {
  return tilesPerTick > RUN_ENTER_TILES_PER_TICK;
}

const TWO_PI = Math.PI * 2;

export class SkyFowl extends Mob {
  readonly xpValue = 8;
  protected coinDropMin = 0;
  protected coinDropMax = 2;
  displayName = 'Sky Fowl';
  description = 'A feathery wanderer that pecks at anything that gets too close.';
  override readonly audioTag = 'skyfowl';

  /**
   * Which of the four street-tough looks this fowl wears, chosen at
   * construction and kept for its lifetime — bruised-plum, unkempt plumage
   * and a hunched stance, the colour family and posture no citizen wears, so
   * a player can never mistake a fightable fowl for a friendly one.
   */
  readonly toughLookId: SkyfowlLookId;

  private isAggressive = false;

  get isHostile(): boolean {
    return this.isAggressive;
  }

  /**
   * Mongo hunts the town fowl whether or not they have been provoked. Players
   * cannot melee a calm one; the pet raptor has no such manners.
   */
  override get isPetAttackable(): boolean {
    return true;
  }

  /**
   * A calm fowl is provokable rather than protected: it is nobody's ally, and
   * putting a missile into one is how the player picks the fight. Only the
   * hand-swung blows stay blocked, so that swinging at something else while a
   * bird is underfoot never starts it by accident.
   */
  protected override admitsPlayerDamage(damageType: PlayerDamageType | null): boolean {
    return super.admitsPlayerDamage(damageType) || !HAND_SWUNG_DAMAGE_TYPES.has(damageType);
  }
  private peckCooldown = 0;
  private peckAnimTimer = 0;
  /** Where the legs last measured the fowl from, so the gait turns by ground actually covered. */
  private gaitSampleX: number;
  private gaitSampleY: number;
  /** Position through the walk or run cycle, 0–1. */
  private gaitPhase = 0;
  private gaitRunning = false;
  private gaitMotionTicks = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, FOWL_HP, FOWL_SPEED_NEUTRAL);
    this.toughLookId = randomSkyfowlToughLookId();
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.isAggressive = false;
    this.setBaseSpeed(FOWL_SPEED_NEUTRAL);
    this.peckCooldown = 0;
    this.peckAnimTimer = 0;
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    this.gaitPhase = 0;
    this.gaitRunning = false;
    this.gaitMotionTicks = 0;
  }

  /**
   * Turns the legs by the ground the fowl actually covered since the last
   * tick — measured from position, so collision slides, separation shoves and
   * a grind into a wall all count for what they really moved, not for what
   * the AI asked for. Walk or run is chosen by that same measured speed.
   */
  private syncGaitToDistanceCovered(): void {
    const coveredPx = Math.hypot(this.x - this.gaitSampleX, this.y - this.gaitSampleY);
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    const tilesPerTick = coveredPx / this.tileSize;
    if (tilesPerTick > STILL_TILES_PER_TICK) this.gaitMotionTicks = MOTION_HOLD_TICKS;
    else if (this.gaitMotionTicks > 0) this.gaitMotionTicks--;
    if (this.gaitRunning) this.gaitRunning = tilesPerTick > RUN_EXIT_TILES_PER_TICK;
    else this.gaitRunning = tilesPerTick > RUN_ENTER_TILES_PER_TICK;
    const cyclePx = this.gaitRunning
      ? skyfowlRunCyclePx(this.toughLookId, this.tileSize)
      : skyfowlWalkCyclePx(this.toughLookId, this.tileSize);
    const rowFrames = this.gaitRunning ? RUN_FRAMES : WALK_FRAMES;
    this.gaitPhase = (this.gaitPhase + gaitCyclesForDistance(coveredPx, cyclePx, rowFrames)) % 1;
  }

  /**
   * A provoked fowl is a walking melee pecker: it can learn to come at the
   * player from several sides when a flock has been stirred up together, and
   * to fall back on a flock-mate when hurt. Never `block` — a bird turning a
   * sword aside reads as silly — and never `kite`: it has no reach to fight
   * from and nothing to draw the player toward.
   */
  protected override get tacticsEligibility(): readonly TacticsTrait[] {
    return FOWL_TACTICS;
  }

  /** No dungeon loot — only, very rarely, the book on being this quick. */
  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    const items: LootDrop['items'] = [];
    maybeDropSkillBook(items, 'skill_book_cat_reflexes');
    return items;
  }

  /**
   * Any hit turns this fowl aggressive for the rest of its life.
   * Also bumps movement speed to the angry sprint value.
   */
  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ) {
    super.takeDamageFrom(amount, attacker, damageType);
    if (amount > 0) this.provoke();
  }

  /** Turns this fowl aggressive for the rest of its life, at the angry sprint. */
  provoke(): void {
    if (this.isAggressive) return;
    this.isAggressive = true;
    this.setBaseSpeed(FOWL_SPEED_AGGRO);
  }

  /**
   * Wide-radius wander — uses the same logic as Mob.doWander() but allows
   * roaming up to WANDER_RADIUS_TILES from the spawn point so they can
   * meander across the whole town square rather than hovering in one spot.
   */
  private doWiderWander(): void {
    if (this.wanderTimer > 0) {
      this.wanderTimer--;
    } else {
      if (Math.random() < WANDER_PAUSE_CHANCE) {
        this.wanderDx = 0;
        this.wanderDy = 0;
      } else {
        const angle = Math.random() * Math.PI * 2;
        const spd = this.speed * WANDER_SPEED_FRACTION;
        this.wanderDx = Math.cos(angle) * spd;
        this.wanderDy = Math.sin(angle) * spd;
      }
      this.wanderTimer = randomInt(WANDER_TIMER_MIN, WANDER_TIMER_MAX);
    }

    if (this.wanderDx !== 0 || this.wanderDy !== 0) {
      const dx = this.spawnX - this.x;
      const dy = this.spawnY - this.y;
      const distToSpawn = Math.hypot(dx, dy);
      const maxPx = this.tileSize * WANDER_RADIUS_TILES;
      if (distToSpawn > maxPx) {
        const nx = dx / distToSpawn;
        const ny = dy / distToSpawn;
        this.wanderDx = nx * this.speed * WANDER_PULLBACK_FRACTION;
        this.wanderDy = ny * this.speed * WANDER_PULLBACK_FRACTION;
      }
      if (this.wanderDx !== 0) this.facingX = this.wanderDx > 0 ? 1 : -1;
      if (this.wanderDy !== 0) this.facingY = this.wanderDy > 0 ? 1 : -1;
      this.moveWithCollision(this.wanderDx, this.wanderDy);
      this.isMoving = true;
    } else {
      this.isMoving = false;
    }
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    this.syncGaitToDistanceCovered();

    if (this.peckCooldown > 0) this.peckCooldown--;
    if (this.peckAnimTimer > 0) this.peckAnimTimer--;

    if (!this.isAggressive) {
      this.doWiderWander();
      return;
    }

    const peckRangePx = this.tileSize * PECK_RANGE_TILES;
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = t;
      }
    }
    this.currentTarget = nearest;

    if (!nearest) {
      this.tactics.disengage();
      this.doWiderWander();
      return;
    }

    this.updateLastKnown(nearest);

    const tacticalMove = this.chooseTacticalStep(nearest, peckRangePx, this.peckAnimTimer === 0);
    if (tacticalMove?.breaksOff === true) {
      this.walkTacticalStep(tacticalMove, nearest);
      return;
    }

    if (nearestDist > peckRangePx) {
      if (tacticalMove !== null) {
        this.walkTacticalStep(tacticalMove, nearest);
      } else {
        this.followTargetAStar(
          this.lastKnownTargetX,
          this.lastKnownTargetY,
          this.speed,
          peckRangePx * FOLLOW_STOP_FRACTION,
        );
      }
    } else {
      this.isMoving = false;
      this.faceToward(nearest);
    }

    if (
      nearestDist <= peckRangePx * PECK_ENGAGE_FRACTION &&
      this.peckCooldown === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.dealDamage(nearest, PECK_DAMAGE);
      this.peckCooldown = this.scaledCooldownFrames(PECK_COOLDOWN);
      this.peckAnimTimer = PECK_ANIM_FRAMES;
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

    const peckAmt =
      this.peckAnimTimer > 0 ? Math.sin((1 - this.peckAnimTimer / PECK_ANIM_FRAMES) * Math.PI) : 0;
    const travelling = this.gaitMotionTicks > 0;
    const gait = this.gaitRunning ? 'run' : 'walk';
    const action =
      peckAmt > 0 ? 'strike' : travelling ? gait : this.isAggressive ? 'aggro' : 'idle';

    drawSkyfowlCastSprite(ctx, this.toughLookId, sx, sy, tileSize, {
      action,
      walkPhase: this.gaitPhase * TWO_PI,
      facingX: this.facingX,
      facingY: this.facingY,
      progress: peckAmt,
    });

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
