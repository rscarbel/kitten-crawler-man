import { TILE_SIZE } from '../../core/constants';
import type { MercenaryTemplate, MercenaryTemplateId } from '../../core/mercenaryTemplates';
import { makeShield, isAbsorbing, SHIELD_STATUS } from '../../core/StatusEffect';
import type { Player } from '../../Player';
import { normalize } from '../../utils';
import { CatPlayer } from '../CatPlayer';
import { Mob } from '../Mob';
import type { Mercenary } from '../Mercenary';
import {
  CRETIN_CAST_SHIELD_CAST_FRAME,
  CRETIN_CAST_SHIELD_FRAMES,
  CRETIN_CAST_SHIELD_TICKS_PER_FRAME,
  CRETIN_HURT_FRAMES,
  CRETIN_HURT_TICKS_PER_FRAME,
  CRETIN_PUNCH_FRAMES,
  CRETIN_PUNCH_IMPACT_FRAME,
  CRETIN_PUNCH_TICKS_PER_FRAME,
  CRETIN_ROBOT_FRAMES,
  CRETIN_ROBOT_TICKS_PER_FRAME,
} from '../../sprites/cretinTiming';
import { BasicMeleeKit } from './basicMeleeKit';
import { locomotionState, type MercenaryDrawState, type MercenaryKitContext } from './MercenaryKit';
import type { StrikeTiming } from './mercenaryStrike';

/**
 * The cretin bodyguards' kit, shared by Sledge and Bomo: seven feet of rock in
 * a tuxedo, throwing heavy punches, and a Shield spell bought with their own
 * money. What sets the two apart is carried in a per-hire
 * {@link CretinGuardConfig} rather than in two kits, because they are the same
 * kind of creature trained the same way — they differ in whom they guard.
 *
 * - Sledge is the cat's bodyguard. Whoever hurts her becomes his target, his
 *   Shield goes to her first, and when a fight is over and she is near he
 *   sometimes dances the robot, the dance the two of them share.
 * - Bomo is the party's shield. His Shield comes round sooner and goes to
 *   whoever on the party's side is worst hurt, Mongo included, and when his
 *   owner is hurt and something is closing on them he steps into its path.
 */

const TILE_CENTER_OFFSET = TILE_SIZE / 2;

// ── Punch ────────────────────────────────────────────────────────────────────

export const PUNCH_TOTAL_TICKS = CRETIN_PUNCH_FRAMES * CRETIN_PUNCH_TICKS_PER_FRAME;
/** The fist lands on the tick its fully extended frame is first drawn. */
export const PUNCH_IMPACT_TICK = CRETIN_PUNCH_IMPACT_FRAME * CRETIN_PUNCH_TICKS_PER_FRAME;
/** A stone fist carries a little further than a flesh one before the victim is clear of it. */
const PUNCH_REACH_RATIO = 1.6;
/** Stone is slow: a beat of recovery after the row before the next wind-up. */
const PUNCH_COOLDOWN_FRAMES = 50;

const PUNCH: StrikeTiming = {
  row: 'punch',
  frames: PUNCH_TOTAL_TICKS,
  impactFrame: PUNCH_IMPACT_TICK,
  reachRatio: PUNCH_REACH_RATIO,
};

// ── Shield ───────────────────────────────────────────────────────────────────

const TICKS_PER_SECOND = 60;
/** Damage one Shield soaks up before it breaks. */
export const SHIELD_ABSORB = 12;
const SHIELD_DURATION_SECONDS = 8;
export const SHIELD_DURATION_TICKS = SHIELD_DURATION_SECONDS * TICKS_PER_SECOND;
/** How far from the caster an ally may stand and still be shielded. */
export const SHIELD_RANGE_TILES = 6;

export const SHIELD_CAST_TOTAL_TICKS =
  CRETIN_CAST_SHIELD_FRAMES * CRETIN_CAST_SHIELD_TICKS_PER_FRAME;
/** The dome goes up on the tick the glyph over his hands flares brightest. */
export const SHIELD_CAST_RELEASE_TICK =
  CRETIN_CAST_SHIELD_CAST_FRAME * CRETIN_CAST_SHIELD_TICKS_PER_FRAME;

/** Whom a cretin's Shield goes to when more than one ally could use it. */
export type ShieldPriority =
  /** The crawlers only, and the cat before the other whenever she qualifies. */
  | 'princess_first'
  /** Anyone on the party's side, Mongo included, lowest share of health first. */
  | 'worst_hurt';

export interface CretinShieldConfig {
  readonly cooldownFrames: number;
  /** An ally below this share of max HP is worth a Shield. */
  readonly triggerHpFraction: number;
  readonly priority: ShieldPriority;
}

// ── Protect the Princess ─────────────────────────────────────────────────────

/**
 * How long Sledge stays locked on whoever hurt the cat. Long enough to see the
 * fight through; short enough that a foe which slips away is let go.
 */
export const PRINCESS_FOCUS_FRAMES = 600;

// ── The robot ────────────────────────────────────────────────────────────────

/** Quiet this long after a fight before the dance is considered. */
export const ROBOT_LULL_FRAMES = 60;
/** The cat has to be this close to dance with. */
export const ROBOT_CAT_RANGE_TILES = 4;
/** He does not dance after every fight; that would stop being a treat. */
export const ROBOT_CHANCE = 0.35;
const ROBOT_PASS_TICKS = CRETIN_ROBOT_FRAMES * CRETIN_ROBOT_TICKS_PER_FRAME;
/** One dance is the row twice through: once reads as a twitch, not a routine. */
const ROBOT_PASSES = 2;
export const ROBOT_DANCE_TICKS = ROBOT_PASS_TICKS * ROBOT_PASSES;

// ── Body-block ───────────────────────────────────────────────────────────────

/** A hostile coming for the owner is a threat once it is this close to them. */
export const BODY_BLOCK_THREAT_TILES = 4;
/** And stops being one once it is this far away again. */
export const BODY_BLOCK_RELEASE_TILES = 6;
/**
 * Once blocking, he keeps at it until the owner is this much above the trigger:
 * a regen tick carrying her a point over the line should not send him back to
 * her shoulder with the threat still coming.
 */
const BODY_BLOCK_RELEASE_HP_MARGIN = 0.1;
/**
 * Where he plants himself: this far out from the owner along the line to the
 * threat. A tile is a body-width in front of her; any further and a threat
 * coming in at an angle walks round him.
 */
export const BODY_BLOCK_STANDOFF_TILES = 1;
/** Close enough to the spot to stop and face the threat. */
const BODY_BLOCK_ARRIVE_TILES = 0.25;
/**
 * A threat's distance to the owner has to shrink by at least this many pixels
 * in a frame to count as closing: mobs jostled by separation drift by less.
 */
const CLOSING_MIN_STEP_PX = 0.1;

// ── Hurt ─────────────────────────────────────────────────────────────────────

const HURT_TOTAL_TICKS = CRETIN_HURT_FRAMES * CRETIN_HURT_TICKS_PER_FRAME;

// ── Configs ──────────────────────────────────────────────────────────────────

export interface CretinGuardConfig {
  /** Punch damage as a multiple of the template's damage. */
  readonly punchDamageRatio: number;
  readonly shield: CretinShieldConfig;
  /** Whoever hurts the cat becomes this cretin's target. */
  readonly protectsPrincess: boolean;
  /** Dances the robot with the cat after a fight, now and then. */
  readonly dancesTheRobot: boolean;
  /** Steps into the path of whatever is closing on a hurt owner. */
  readonly bodyBlocks: boolean;
}

const SLEDGE_PUNCH_DAMAGE_RATIO = 1;
/** Bomo is the party's shield more than its fist, and hits a little softer than Sledge. */
const BOMO_PUNCH_DAMAGE_RATIO = 0.85;

const SLEDGE_SHIELD_COOLDOWN_SECONDS = 20;
export const SLEDGE_SHIELD_COOLDOWN_FRAMES = SLEDGE_SHIELD_COOLDOWN_SECONDS * TICKS_PER_SECOND;
export const SLEDGE_SHIELD_TRIGGER_HP_FRACTION = 0.6;
/** Shielding is Bomo's whole purpose, so it comes round sooner and for smaller wounds. */
const BOMO_SHIELD_COOLDOWN_SECONDS = 14;
export const BOMO_SHIELD_COOLDOWN_FRAMES = BOMO_SHIELD_COOLDOWN_SECONDS * TICKS_PER_SECOND;
export const BOMO_SHIELD_TRIGGER_HP_FRACTION = 0.7;

export const SLEDGE_CONFIG: CretinGuardConfig = {
  punchDamageRatio: SLEDGE_PUNCH_DAMAGE_RATIO,
  shield: {
    cooldownFrames: SLEDGE_SHIELD_COOLDOWN_FRAMES,
    triggerHpFraction: SLEDGE_SHIELD_TRIGGER_HP_FRACTION,
    priority: 'princess_first',
  },
  protectsPrincess: true,
  dancesTheRobot: true,
  bodyBlocks: false,
};

export const BOMO_CONFIG: CretinGuardConfig = {
  punchDamageRatio: BOMO_PUNCH_DAMAGE_RATIO,
  shield: {
    cooldownFrames: BOMO_SHIELD_COOLDOWN_FRAMES,
    triggerHpFraction: BOMO_SHIELD_TRIGGER_HP_FRACTION,
    priority: 'worst_hurt',
  },
  protectsPrincess: false,
  dancesTheRobot: false,
  bodyBlocks: true,
};

const CRETIN_GUARD_CONFIGS: Partial<Record<MercenaryTemplateId, CretinGuardConfig>> = {
  sledge: SLEDGE_CONFIG,
  bomo: BOMO_CONFIG,
};

/** A cretin with no config of its own fights like Bomo, the plainer of the two. */
export function cretinGuardConfigFor(id: MercenaryTemplateId): CretinGuardConfig {
  return CRETIN_GUARD_CONFIGS[id] ?? BOMO_CONFIG;
}

const MIN_PUNCH_DAMAGE = 1;

interface ShieldCast {
  readonly ally: Player;
  tick: number;
  released: boolean;
}

function centerDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function hpFraction(body: Player): number {
  return body.maxHp > 0 ? body.hp / body.maxHp : 1;
}

/** A living ally who can still be helped: not down, and not somewhere already safe. */
function canBeHelped(ctx: MercenaryKitContext, ally: Player): boolean {
  return ally.isAlive && !ally.isKnockedOut && !ctx.isInSafeRoom(ally);
}

function carriesLiveShield(ally: Player): boolean {
  for (const effect of ally.statusEffects) {
    if (effect.type === SHIELD_STATUS && isAbsorbing(effect)) return true;
  }
  return false;
}

export class CretinGuardKit extends BasicMeleeKit {
  private shieldCooldown = 0;
  private cast: ShieldCast | null = null;

  private princessFoe: Mob | null = null;
  private princessFocusFrames = 0;

  private robotTick: number | null = null;
  private fightSeen = false;
  private lullFrames = 0;

  private blockThreat: Mob | null = null;
  /**
   * Each nearby hostile's distance to the owner as of last frame, so a threat
   * can be told to be closing. Rebuilt every frame from living mobs only, so a
   * mob that dies or wanders off is never held past the next one.
   */
  private lastOwnerDistance = new Map<Mob, number>();

  /** Whether anything hostile is within engage range of the owner, as of this frame's tick. */
  private hostileNearOwner = false;
  private lastHp: number | null = null;
  private hurtTick: number | null = null;

  constructor(
    template: MercenaryTemplate,
    readonly guard: CretinGuardConfig = cretinGuardConfigFor(template.id),
    private readonly random: () => number = () => Math.random(),
  ) {
    super({
      damage: Math.max(MIN_PUNCH_DAMAGE, Math.round(template.damage * guard.punchDamageRatio)),
      swings: [PUNCH],
      cooldownFrames: PUNCH_COOLDOWN_FRAMES,
    });
  }

  /** Frames until the Shield can be cast again. */
  get shieldCooldownFrames(): number {
    return this.shieldCooldown;
  }

  get isCastingShield(): boolean {
    return this.cast !== null;
  }

  get isDancing(): boolean {
    return this.robotTick !== null;
  }

  /** Whoever hurt the cat, while Sledge is still locked on them. */
  get princessTarget(): Mob | null {
    return this.princessFoe;
  }

  /** The hostile Bomo is standing in the way of, if any. */
  get bodyBlockTarget(): Mob | null {
    return this.blockThreat;
  }

  override tick(ctx: MercenaryKitContext): void {
    if (this.shieldCooldown > 0) this.shieldCooldown--;
    this.tickHurt(ctx.merc);
    this.tickPrincessFocus(ctx);
    this.hostileNearOwner = this.anyHostileNearOwner(ctx);
    if (this.guard.dancesTheRobot) this.tickRobotLull(ctx, this.hostileNearOwner);
    if (this.guard.bodyBlocks) this.tickBodyBlock(ctx);
  }

  override update(ctx: MercenaryKitContext): boolean {
    if (this.cast !== null) {
      this.advanceCast(ctx, this.cast);
      return true;
    }
    if (this.strike.isSwinging) return this.strike.advance(ctx);
    if (this.robotTick !== null) {
      this.advanceRobot(ctx, this.robotTick);
      return true;
    }
    return this.tryStartCast(ctx);
  }

  chooseTarget(_ctx: MercenaryKitContext, nearest: Mob | null): Mob | null {
    if (this.princessFoe !== null) return this.princessFoe;
    if (this.blockThreat !== null) return this.blockThreat;
    return nearest;
  }

  approach(ctx: MercenaryKitContext, target: Mob, distancePx: number): boolean {
    const threat = this.blockThreat;
    if (threat === null || target !== threat) return false;
    // Already in its face: the shell closes and swings as it would anyway.
    if (distancePx <= ctx.merc.strikeRangePx) return false;
    const owner = ctx.owner;
    const toThreat = normalize(threat.x - owner.x, threat.y - owner.y);
    const standoffPx = TILE_SIZE * BODY_BLOCK_STANDOFF_TILES;
    const spotX = owner.x + toThreat.x * standoffPx;
    const spotY = owner.y + toThreat.y * standoffPx;
    const merc = ctx.merc;
    const arrivePx = TILE_SIZE * BODY_BLOCK_ARRIVE_TILES;
    if (Math.hypot(merc.x - spotX, merc.y - spotY) > arrivePx) {
      merc.walkTo(spotX, spotY, arrivePx);
    } else {
      merc.isMoving = false;
      merc.faceToward(threat);
    }
    return true;
  }

  onFriendHurt(ctx: MercenaryKitContext, friend: Player, attacker: Mob | null): void {
    if (!this.guard.protectsPrincess) return;
    if (!(friend instanceof CatPlayer) || attacker === null) return;
    if (!attacker.isAlive || !attacker.isHostile) return;
    if (!this.withinEngageOfOwner(ctx, attacker)) return;
    this.princessFoe = attacker;
    this.princessFocusFrames = PRINCESS_FOCUS_FRAMES;
  }

  override drawState(merc: Mercenary): MercenaryDrawState {
    if (this.cast !== null) {
      return { row: 'cast_shield', progress: this.cast.tick / SHIELD_CAST_TOTAL_TICKS };
    }
    const swing = this.strike.drawState();
    if (swing !== null) return swing;
    if (this.robotTick !== null) {
      // Progress through the current pass, so the figure can draw it from its
      // own row length without knowing how many passes a dance is.
      const passTick = this.robotTick % ROBOT_PASS_TICKS;
      return { row: 'robot', progress: passTick / ROBOT_PASS_TICKS };
    }
    // A flinch while walking would slide him along the ground in a hurt pose;
    // on the move the walk carries on instead.
    if (this.hurtTick !== null && !merc.isMoving) {
      return { row: 'hurt', progress: this.hurtTick / HURT_TOTAL_TICKS };
    }
    return locomotionState(merc);
  }

  override clearAirborne(): void {
    super.clearAirborne();
    this.cast = null;
    this.robotTick = null;
    this.blockThreat = null;
    this.princessFoe = null;
    this.lastOwnerDistance.clear();
  }

  // ── Shield ─────────────────────────────────────────────────────────────────

  private tryStartCast(ctx: MercenaryKitContext): boolean {
    if (this.shieldCooldown > 0) return false;
    // A Shield between fights would be spent on a wound nobody is adding to.
    if (!this.hostileNearOwner) return false;
    const ally = this.pickShieldTarget(ctx);
    if (ally === null) return false;
    this.cast = { ally, tick: 0, released: false };
    this.shieldCooldown = this.guard.shield.cooldownFrames;
    ctx.merc.isMoving = false;
    ctx.merc.faceToward(ally);
    return true;
  }

  private advanceCast(ctx: MercenaryKitContext, cast: ShieldCast): void {
    const merc = ctx.merc;
    merc.isMoving = false;
    if (!cast.released && cast.tick >= SHIELD_CAST_RELEASE_TICK) {
      cast.released = true;
      // Raised on whoever it was cast at even if they stepped back out of
      // range mid-cast: the glyph is already over his hands by then.
      if (cast.ally.isAlive && !cast.ally.isKnockedOut) {
        cast.ally.applyStatus(makeShield(SHIELD_ABSORB, SHIELD_DURATION_TICKS));
        ctx.bark('special');
      }
    }
    cast.tick++;
    if (cast.tick >= SHIELD_CAST_TOTAL_TICKS) this.cast = null;
  }

  private pickShieldTarget(ctx: MercenaryKitContext): Player | null {
    const shield = this.guard.shield;
    const qualifies = (ally: Player): boolean =>
      canBeHelped(ctx, ally) &&
      hpFraction(ally) < shield.triggerHpFraction &&
      !carriesLiveShield(ally) &&
      this.inShieldReach(ctx.merc, ally);

    if (shield.priority === 'princess_first') {
      if (ctx.allies.includes(ctx.cat) && qualifies(ctx.cat)) return ctx.cat;
      return this.worstHurt(ctx.allies, (ally) => !(ally instanceof Mob) && qualifies(ally));
    }
    return this.worstHurt(ctx.allies, qualifies);
  }

  private worstHurt(
    allies: readonly Player[],
    qualifies: (ally: Player) => boolean,
  ): Player | null {
    let best: Player | null = null;
    let bestFraction = Infinity;
    for (const ally of allies) {
      if (!qualifies(ally)) continue;
      const fraction = hpFraction(ally);
      if (fraction < bestFraction) {
        bestFraction = fraction;
        best = ally;
      }
    }
    return best;
  }

  private inShieldReach(merc: Mercenary, ally: Player): boolean {
    if (centerDistance(merc, ally) > TILE_SIZE * SHIELD_RANGE_TILES) return false;
    return merc.hasClearLine(
      merc.x + TILE_CENTER_OFFSET,
      merc.y + TILE_CENTER_OFFSET,
      ally.x + TILE_CENTER_OFFSET,
      ally.y + TILE_CENTER_OFFSET,
    );
  }

  // ── Protect the Princess ───────────────────────────────────────────────────

  private tickPrincessFocus(ctx: MercenaryKitContext): void {
    const foe = this.princessFoe;
    if (foe === null) return;
    this.princessFocusFrames--;
    const stillWorthIt =
      this.princessFocusFrames > 0 &&
      foe.isAlive &&
      foe.isHostile &&
      this.withinEngageOfOwner(ctx, foe);
    if (!stillWorthIt) this.princessFoe = null;
  }

  // ── The robot ──────────────────────────────────────────────────────────────

  private tickRobotLull(ctx: MercenaryKitContext, hostileNear: boolean): void {
    if (hostileNear) {
      this.fightSeen = true;
      this.lullFrames = 0;
      this.robotTick = null;
      return;
    }
    if (!this.fightSeen) return;
    this.lullFrames++;
    if (this.lullFrames < ROBOT_LULL_FRAMES) return;
    // One roll per fight, win or lose, so the dance stays a now-and-then thing.
    this.fightSeen = false;
    const catNear = centerDistance(ctx.merc, ctx.cat) <= TILE_SIZE * ROBOT_CAT_RANGE_TILES;
    const busy = this.cast !== null || this.strike.isSwinging;
    if (!catNear || busy || !ctx.cat.isAlive) return;
    if (this.random() < ROBOT_CHANCE) this.robotTick = 0;
  }

  private advanceRobot(ctx: MercenaryKitContext, tick: number): void {
    const merc = ctx.merc;
    merc.isMoving = false;
    merc.faceToward(ctx.cat);
    const next = tick + 1;
    this.robotTick = next >= ROBOT_DANCE_TICKS ? null : next;
  }

  // ── Body-block ─────────────────────────────────────────────────────────────

  private tickBodyBlock(ctx: MercenaryKitContext): void {
    const owner = ctx.owner;
    const trigger = this.guard.shield.triggerHpFraction;
    const distances = new Map<Mob, number>();
    const threatPx = TILE_SIZE * BODY_BLOCK_THREAT_TILES;
    const releasePx = TILE_SIZE * BODY_BLOCK_RELEASE_TILES;
    let closest: Mob | null = null;
    let closestDistance = Infinity;
    for (const mob of ctx.allMobs) {
      if (mob === ctx.merc || !mob.isAlive || !mob.isHostile) continue;
      const d = centerDistance(mob, owner);
      if (d > releasePx) continue;
      distances.set(mob, d);
      const previous = this.lastOwnerDistance.get(mob);
      const closing = previous !== undefined && previous - d >= CLOSING_MIN_STEP_PX;
      // Something coming for her on foot: it has noticed her, it is near, and
      // it is still coming. A ranged mob holds its distance, so it never
      // closes, and he stays at her side instead of wandering into its fire.
      if (mob.currentTarget !== owner || !closing || d > threatPx) continue;
      if (d < closestDistance) {
        closestDistance = d;
        closest = mob;
      }
    }
    this.lastOwnerDistance = distances;

    const ownerDown = !owner.isAlive || owner.isKnockedOut;
    const current = this.blockThreat;
    if (current !== null) {
      const recovered = hpFraction(owner) >= trigger + BODY_BLOCK_RELEASE_HP_MARGIN;
      if (ownerDown || recovered || !distances.has(current)) this.blockThreat = null;
      return;
    }
    if (ownerDown || hpFraction(owner) >= trigger) return;
    this.blockThreat = closest;
  }

  // ── Shared ─────────────────────────────────────────────────────────────────

  private tickHurt(merc: Mercenary): void {
    if (this.lastHp !== null && merc.hp < this.lastHp) this.hurtTick = 0;
    this.lastHp = merc.hp;
    if (this.hurtTick === null) return;
    this.hurtTick++;
    if (this.hurtTick >= HURT_TOTAL_TICKS) this.hurtTick = null;
  }

  private withinEngageOfOwner(ctx: MercenaryKitContext, mob: Mob): boolean {
    return centerDistance(mob, ctx.owner) <= TILE_SIZE * this.engageRadiusTiles;
  }

  private anyHostileNearOwner(ctx: MercenaryKitContext): boolean {
    for (const mob of ctx.allMobs) {
      if (mob === ctx.merc || !mob.isAlive || !mob.isHostile) continue;
      if (this.withinEngageOfOwner(ctx, mob)) return true;
    }
    return false;
  }
}
