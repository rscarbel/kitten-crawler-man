import { TILE_SIZE } from '../../core/constants';
import type {
  EarthElementalGuardStyle,
  MercenaryTemplate,
} from '../../core/party/mercenaryTemplates';
import { makeShield, isAbsorbing, SHIELD_STATUS } from '../../core/combat/StatusEffect';
import type { Player } from '../../Player';
import { normalize } from '../../utils';
import { CatPlayer } from '../CatPlayer';
import { Mob } from '../Mob';
import type { Mercenary } from '../Mercenary';
import {
  EARTH_ELEMENTAL_CAST_SHIELD_CAST_FRAME,
  EARTH_ELEMENTAL_CAST_SHIELD_FRAMES,
  EARTH_ELEMENTAL_CAST_SHIELD_TICKS_PER_FRAME,
  EARTH_ELEMENTAL_HURT_FRAMES,
  EARTH_ELEMENTAL_HURT_TICKS_PER_FRAME,
  EARTH_ELEMENTAL_PUNCH_FRAMES,
  EARTH_ELEMENTAL_PUNCH_IMPACT_FRAME,
  EARTH_ELEMENTAL_PUNCH_TICKS_PER_FRAME,
} from '../../sprites/earthElementalTiming';
import { BasicMeleeKit } from './basicMeleeKit';
import {
  locomotionState,
  type EarthElementalGuardRow,
  type MercenaryDrawState,
  type MercenaryKitContext,
} from './MercenaryKit';
import type { StrikeTiming } from './mercenaryStrike';

/**
 * The earth elemental bodyguards' kit, shared by Crush and Hammer Hands: seven
 * feet of rock throwing heavy punches, and a warding Shield spell. What sets
 * the two apart is an {@link EarthElementalGuardConfig} chosen by the guard
 * style each template's kit names, rather than two kits, because they are the
 * same kind of creature trained the same way — they differ in whom they guard.
 *
 * - Crush guards the smaller crawler, the cat. Whoever hurts her becomes his
 *   target, and his Shield goes to her first.
 * - Hammer Hands is the party's shield. His Shield comes round sooner and goes to
 *   whoever on the party's side is worst hurt, Mongo included, and when his
 *   owner is hurt and something is closing on them he steps into its path.
 */

const TILE_CENTER_OFFSET = TILE_SIZE / 2;

// ── Punch ────────────────────────────────────────────────────────────────────

export const PUNCH_TOTAL_TICKS =
  EARTH_ELEMENTAL_PUNCH_FRAMES * EARTH_ELEMENTAL_PUNCH_TICKS_PER_FRAME;
/** The fist lands on the tick its fully extended frame is first drawn. */
export const PUNCH_IMPACT_TICK =
  EARTH_ELEMENTAL_PUNCH_IMPACT_FRAME * EARTH_ELEMENTAL_PUNCH_TICKS_PER_FRAME;
/** A stone fist carries a little further than a flesh one before the victim is clear of it. */
const PUNCH_REACH_RATIO = 1.6;
/** Stone is slow: a beat of recovery after the row before the next wind-up. */
const PUNCH_COOLDOWN_FRAMES = 50;

const PUNCH: StrikeTiming<EarthElementalGuardRow> = {
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
const SHIELD_RANGE_TILES = 6;

export const SHIELD_CAST_TOTAL_TICKS =
  EARTH_ELEMENTAL_CAST_SHIELD_FRAMES * EARTH_ELEMENTAL_CAST_SHIELD_TICKS_PER_FRAME;
/** The dome goes up on the tick the glyph over his hands flares brightest. */
export const SHIELD_CAST_RELEASE_TICK =
  EARTH_ELEMENTAL_CAST_SHIELD_CAST_FRAME * EARTH_ELEMENTAL_CAST_SHIELD_TICKS_PER_FRAME;

/** Whom an earth elemental's Shield goes to when more than one ally could use it. */
type ShieldPriority =
  /** The crawlers only, and the cat before the other whenever she qualifies. */
  | 'cat_first'
  /** Anyone on the party's side, Mongo included, lowest share of health first. */
  | 'worst_hurt';

interface EarthElementalShieldConfig {
  readonly cooldownFrames: number;
  /** An ally below this share of max HP is worth a Shield. */
  readonly triggerHpFraction: number;
  readonly priority: ShieldPriority;
}

// ── Guarding the cat ─────────────────────────────────────────────────────────

/**
 * How long Crush stays locked on whoever hurt the cat. Long enough to see the
 * fight through; short enough that a foe which slips away is let go.
 */
const CAT_GUARD_FOCUS_FRAMES = 600;

// ── Body-block ───────────────────────────────────────────────────────────────

/** A hostile coming for the owner is a threat once it is this close to them. */
const BODY_BLOCK_THREAT_TILES = 4;
/** And stops being one once it is this far away again. */
const BODY_BLOCK_RELEASE_TILES = 6;
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

const HURT_TOTAL_TICKS = EARTH_ELEMENTAL_HURT_FRAMES * EARTH_ELEMENTAL_HURT_TICKS_PER_FRAME;

// ── Configs ──────────────────────────────────────────────────────────────────

interface EarthElementalGuardConfig {
  /** Punch damage as a multiple of the template's damage. */
  readonly punchDamageRatio: number;
  readonly shield: EarthElementalShieldConfig;
  /** Whoever hurts the cat becomes this earth elemental's target. */
  readonly guardsCat: boolean;
  /** Steps into the path of whatever is closing on a hurt owner. */
  readonly bodyBlocks: boolean;
}

const CRUSH_PUNCH_DAMAGE_RATIO = 1;
/** Hammer Hands is the party's shield more than its fist, and hits a little softer than Crush. */
const HAMMER_HANDS_PUNCH_DAMAGE_RATIO = 0.85;

const CRUSH_SHIELD_COOLDOWN_SECONDS = 20;
export const CRUSH_SHIELD_COOLDOWN_FRAMES = CRUSH_SHIELD_COOLDOWN_SECONDS * TICKS_PER_SECOND;
const CRUSH_SHIELD_TRIGGER_HP_FRACTION = 0.6;
/** Shielding is Hammer Hands' whole purpose, so it comes round sooner and for smaller wounds. */
const HAMMER_HANDS_SHIELD_COOLDOWN_SECONDS = 14;
const HAMMER_HANDS_SHIELD_COOLDOWN_FRAMES = HAMMER_HANDS_SHIELD_COOLDOWN_SECONDS * TICKS_PER_SECOND;
const HAMMER_HANDS_SHIELD_TRIGGER_HP_FRACTION = 0.7;

export const CRUSH_CONFIG: EarthElementalGuardConfig = {
  punchDamageRatio: CRUSH_PUNCH_DAMAGE_RATIO,
  shield: {
    cooldownFrames: CRUSH_SHIELD_COOLDOWN_FRAMES,
    triggerHpFraction: CRUSH_SHIELD_TRIGGER_HP_FRACTION,
    priority: 'cat_first',
  },
  guardsCat: true,
  bodyBlocks: false,
};

const HAMMER_HANDS_CONFIG: EarthElementalGuardConfig = {
  punchDamageRatio: HAMMER_HANDS_PUNCH_DAMAGE_RATIO,
  shield: {
    cooldownFrames: HAMMER_HANDS_SHIELD_COOLDOWN_FRAMES,
    triggerHpFraction: HAMMER_HANDS_SHIELD_TRIGGER_HP_FRACTION,
    priority: 'worst_hurt',
  },
  guardsCat: false,
  bodyBlocks: true,
};

export const EARTH_ELEMENTAL_GUARD_CONFIGS: Readonly<
  Record<EarthElementalGuardStyle, EarthElementalGuardConfig>
> = {
  cat_guard: CRUSH_CONFIG,
  party_shield: HAMMER_HANDS_CONFIG,
};

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

export class EarthElementalGuardKit extends BasicMeleeKit<EarthElementalGuardRow> {
  private shieldCooldown = 0;
  private cast: ShieldCast | null = null;

  private catFoe: Mob | null = null;
  private catFocusFrames = 0;

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
    readonly guard: EarthElementalGuardConfig,
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

  /** Whoever hurt the cat, while Crush is still locked on them. */
  get catGuardTarget(): Mob | null {
    return this.catFoe;
  }

  /** The hostile Hammer Hands is standing in the way of, if any. */
  get bodyBlockTarget(): Mob | null {
    return this.blockThreat;
  }

  override tick(ctx: MercenaryKitContext): void {
    if (this.shieldCooldown > 0) this.shieldCooldown--;
    this.tickHurt(ctx.merc);
    this.tickCatFocus(ctx);
    this.hostileNearOwner = this.anyHostileNearOwner(ctx);
    if (this.guard.bodyBlocks) this.tickBodyBlock(ctx);
  }

  override update(ctx: MercenaryKitContext): boolean {
    if (this.cast !== null) {
      this.advanceCast(ctx, this.cast);
      return true;
    }
    if (this.strike.isSwinging) return this.strike.advance(ctx);
    return this.tryStartCast(ctx);
  }

  chooseTarget(_ctx: MercenaryKitContext, nearest: Mob | null): Mob | null {
    if (this.catFoe !== null) return this.catFoe;
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
    // A block spot inside a wall or a prop has no route, and the walk's failed
    // search would read as the threat being out of reach: go for it instead.
    if (!merc.canStandAt(spotX + TILE_CENTER_OFFSET, spotY + TILE_CENTER_OFFSET)) return false;
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
    if (!this.guard.guardsCat) return;
    if (!(friend instanceof CatPlayer) || attacker === null) return;
    if (!attacker.isAlive || !attacker.isHostile) return;
    if (!this.withinEngageOfOwner(ctx, attacker)) return;
    this.catFoe = attacker;
    this.catFocusFrames = CAT_GUARD_FOCUS_FRAMES;
  }

  override drawState(merc: Mercenary): MercenaryDrawState<EarthElementalGuardRow> {
    if (this.cast !== null) {
      return { row: 'cast_shield', progress: this.cast.tick / SHIELD_CAST_TOTAL_TICKS };
    }
    const swing = this.strike.drawState();
    if (swing !== null) return swing;
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
    // Whatever HP it had before is no baseline for what it has now: a hire
    // stood up by a revive would otherwise flinch at its own fall.
    this.lastHp = null;
    this.blockThreat = null;
    this.catFoe = null;
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

    if (shield.priority === 'cat_first') {
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

  // ── Guarding the cat ───────────────────────────────────────────────────────

  private tickCatFocus(ctx: MercenaryKitContext): void {
    const foe = this.catFoe;
    if (foe === null) return;
    this.catFocusFrames--;
    const stillWorthIt =
      this.catFocusFrames > 0 && foe.isAlive && foe.isHostile && this.withinEngageOfOwner(ctx, foe);
    if (!stillWorthIt) this.catFoe = null;
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
      // A held mob threatens nobody yet, and blocking it would be picking a fight.
      if (mob.offLimitsToAllies) continue;
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
