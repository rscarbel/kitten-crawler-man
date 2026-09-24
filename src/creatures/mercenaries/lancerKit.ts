import { TILE_SIZE } from '../../core/constants';
import type { MercenaryTemplate } from '../../core/mercenaryTemplates';
import {
  DONG_CHARGE_TILES_PER_CYCLE,
  dongLanceReachTiles,
  prewarmDongQuixoteAction,
} from '../../sprites/dongQuixoteSprite';
import {
  DONG_CHARGE_FRAMES,
  DONG_CHARGE_RECOVER_MS,
  DONG_CHARGE_WINDUP_MS,
  DONG_HURT_MS,
  DONG_SALUTE_MS,
  DONG_THRUST_FRAMES,
  DONG_THRUST_IMPACT_FRAME,
  DONG_THRUST_MS,
  dongFrameAtProgress,
} from '../../sprites/dongQuixoteTiming';
import { normalize } from '../../utils';
import type { Player } from '../../Player';
import { MOB_SLOWED_SPEED_FRACTION, type Mob } from '../Mob';
import type { Mercenary } from '../Mercenary';
import { BasicMeleeKit } from './basicMeleeKit';
import type { MercenaryDrawState, MercenaryKitContext } from './MercenaryKit';
import type { StrikeTiming } from './mercenaryStrike';
import type { MercenaryBarkTrigger } from './mercenaryVoices';

/**
 * Dong Quixote's kit. He fights with a war lance: a jab that reaches further
 * than a fist, and a charge on foot — he has no horse, and charges anyway.
 *
 * The charge is his signature. With a hostile a few tiles off down a clear,
 * straight lane, he lowers the lance and digs in his heels, then runs the
 * lane at three times his walking pace, skewering and bowling aside every
 * hostile on it. He stops at the first wall or when his legs give out, and
 * stands winded afterwards, open to whatever is left.
 */

const TICKS_PER_SECOND = 60;
const MS_PER_SECOND = 1000;

function ticksForMs(ms: number): number {
  return Math.round((ms * TICKS_PER_SECOND) / MS_PER_SECOND);
}

/** How far the centre of a body stands from its edge, in tiles: a blow reaching the edge lands. */
const BODY_RADIUS_TILES = 0.35;

// ── The thrust ───────────────────────────────────────────────────────────────

/** A lance outreaches a fist, so he closes only to this far before jabbing. */
export const LANCE_STRIKE_RANGE_TILES = 1.6;
const THRUST_TICKS = ticksForMs(DONG_THRUST_MS);

/**
 * The first tick of the jab on which the drawn frame is the impact frame. The
 * frame drawn after an update is the one for the tick count *after* that
 * update, hence the `+ 1`.
 */
function firstTickShowingFrame(rowTicks: number, rowFrames: number, frame: number): number {
  for (let tick = 0; tick < rowTicks; tick++) {
    if (dongFrameAtProgress(rowFrames, (tick + 1) / rowTicks) >= frame) return tick;
  }
  return rowTicks - 1;
}

export const THRUST_IMPACT_TICK = firstTickShowingFrame(
  THRUST_TICKS,
  DONG_THRUST_FRAMES,
  DONG_THRUST_IMPACT_FRAME,
);

/**
 * How far the drawn point reaches on the impact frame, read off the rig, plus
 * a body's half-width: the jab lands wherever the painted lance touches.
 */
const THRUST_HIT_REACH_TILES =
  dongLanceReachTiles('thrust', DONG_THRUST_IMPACT_FRAME) + BODY_RADIUS_TILES;
const THRUST_REACH_RATIO = THRUST_HIT_REACH_TILES / LANCE_STRIKE_RANGE_TILES;
/** A jab and a steadying breath: he is old, and the lance is heavy. */
const THRUST_COOLDOWN_FRAMES = 50;

const THRUST: StrikeTiming = {
  row: 'thrust',
  frames: THRUST_TICKS,
  impactFrame: THRUST_IMPACT_TICK,
  reachRatio: THRUST_REACH_RATIO,
};

// ── The charge ───────────────────────────────────────────────────────────────

/** Nearer than this and the lance is the better answer; there is no run-up to be had. */
export const CHARGE_MIN_TRIGGER_TILES = 3;
/** Further than this and the foe would see him coming from the next room. */
export const CHARGE_MAX_TRIGGER_TILES = 7;
/**
 * The furthest a charge runs, in tiles. Past the furthest foe he will charge
 * at, so the point carries through it rather than stopping short.
 */
export const CHARGE_MAX_LENGTH_TILES = 8;
export const CHARGE_SPEED_MULTIPLE = 3;
export const CHARGE_WINDUP_TICKS = ticksForMs(DONG_CHARGE_WINDUP_MS);
export const CHARGE_RECOVER_TICKS = ticksForMs(DONG_CHARGE_RECOVER_MS);
/** Eight seconds from one charge to the next: a burst, not a rotation. */
export const CHARGE_COOLDOWN_FRAMES = 480;
/** A charge lands this many jabs' worth on everything it runs through. */
export const CHARGE_DAMAGE_MULTIPLE = 2.5;
const CHARGE_KNOCKBACK_TILES = 1.5;
const CHARGE_KNOCKBACK_FRAMES = 16;
/**
 * How much a skewered foe is flung aside, against along the lane. Equal
 * weights throw it off at 45°, clear of the lane he is still running.
 */
const CHARGE_KNOCKBACK_SIDE_WEIGHT = 1;
/** Nothing heavier than this is carried less than this share of the full shove. */
const MIN_MASS_FOR_KNOCKBACK = 1;
/** The couched point's reach ahead of his centre, read off the rig. */
const CHARGE_LANCE_REACH_TILES = dongLanceReachTiles('charge', 0);
/** How far to either side of the lane a body is still run down. */
const CHARGE_HIT_HALF_WIDTH_TILES = 0.6;
/**
 * A step that carries him less than this share of its length down the lane
 * has met a wall, or slid along one: either way, the charge is over.
 */
const CHARGE_STALL_RATIO = 0.9;
/**
 * A friend within this many tiles of the lane blocks it. Wider than a body,
 * so a crawler brushed by the shaft is not a crawler run through.
 */
export const LANE_FRIEND_CLEARANCE_TILES = 0.9;
/** A friend who steps into the lane this close ahead stops a charge already running. */
const CHARGE_BRAKE_TILES = 1.5;
/** Rounding in a run summed step by step; far less than any wall could hide in. */
const LANE_RUN_SLACK_PX = 0.5;
/** A lane that came up blocked is not looked at again for this many frames. */
const LANE_RECHECK_FRAMES = 12;
/** A charge aborted at the end of its wind-up may be tried again this soon. */
const CHARGE_ABORT_RETRY_FRAMES = 60;

// ── Salute and flinch ────────────────────────────────────────────────────────

const SALUTE_TICKS = ticksForMs(DONG_SALUTE_MS);
/** He salutes only with no other hostile this close: a knight does not pose mid-melee. */
const SALUTE_CLEAR_RADIUS_TILES = 4;
/** A kill is saluted if the moment comes this soon after it, or not at all. */
const SALUTE_PENDING_FRAMES = 60;
/**
 * He breaks off a salute once his owner is this much further off than when it
 * began, or than his follow band, whichever is further: a charge can leave him
 * well past the band, and he may still salute there so long as she stays put.
 */
const SALUTE_OWNER_SLACK_TILES = 2;
const HURT_TICKS = ticksForMs(DONG_HURT_MS);

const CENTER_OFFSET = 0.5;

/** A lane down which he may charge: a unit heading from his centre. */
export interface ChargeLane {
  readonly dirX: number;
  readonly dirY: number;
}

type ChargePhase =
  | { readonly kind: 'windup'; tick: number; readonly target: Mob }
  | {
      readonly kind: 'charging';
      readonly lane: ChargeLane;
      travelledPx: number;
      cyclePhase: number;
      /** A list rather than a set, and gone with the charge, so it never pins a dead mob. */
      readonly struck: Mob[];
    }
  | { readonly kind: 'recover'; tick: number };

/**
 * Bosses stand their charge, and so does anything rooted: a rooted mob
 * carried off its post is a turret walking the room, and a boss carried out of
 * its arena breaks the fight it is scripted for.
 */
function canBeShoved(mob: Mob): boolean {
  return !mob.isBoss && mob.moveSpeed > 0;
}

function centreOf(body: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return { x: body.x + TILE_SIZE * CENTER_OFFSET, y: body.y + TILE_SIZE * CENTER_OFFSET };
}

export class LancerKit extends BasicMeleeKit {
  private readonly chargeDamage: number;
  private charge: ChargePhase | null = null;
  private chargeCooldown = 0;
  private laneRecheck = 0;
  /** The lane `canStartAttack` found, for `startAttack` on the same frame. */
  private plannedLane: ChargeLane | null = null;
  private thrustVictim: Mob | null = null;
  private saluteTick: number | null = null;
  /** How far off his owner stood when the salute began, in pixels. */
  private saluteOwnerStartPx = 0;
  private salutePendingFrames = 0;
  private hurtTicks = 0;
  private lastHp: number | null = null;

  constructor(template: MercenaryTemplate) {
    super({
      damage: template.damage,
      swings: [THRUST],
      cooldownFrames: THRUST_COOLDOWN_FRAMES,
      strikeRangeTiles: LANCE_STRIKE_RANGE_TILES,
    });
    this.chargeDamage = Math.round(template.damage * CHARGE_DAMAGE_MULTIPLE);
  }

  /** Frames until a charge may be started again. */
  get chargeCooldownFrames(): number {
    return this.chargeCooldown;
  }

  /** Which part of a charge is playing, or null between charges. */
  get chargeStage(): ChargePhase['kind'] | null {
    return this.charge?.kind ?? null;
  }

  get isSaluting(): boolean {
    return this.saluteTick !== null;
  }

  override tick(ctx: MercenaryKitContext): void {
    if (this.chargeCooldown > 0) this.chargeCooldown--;
    if (this.laneRecheck > 0) this.laneRecheck--;
    // A kill made on the charge waits out the run and the winded stop, which
    // own every frame between the kill and the moment he could salute it.
    if (this.salutePendingFrames > 0 && this.charge === null) this.salutePendingFrames--;
    this.tickHurt(ctx.merc);
  }

  override update(ctx: MercenaryKitContext): boolean {
    const charge = this.charge;
    if (charge !== null) {
      this.advanceCharge(ctx, charge);
      return true;
    }
    if (this.strike.isSwinging) return this.advanceThrust(ctx);
    if (this.salutePendingFrames > 0 && this.saluteTick === null && !this.hostileNear(ctx)) {
      this.beginSalute(ctx.merc, ctx.owner);
    }
    if (this.saluteTick !== null) return this.advanceSalute(ctx, this.saluteTick);
    return false;
  }

  override canStartAttack(ctx: MercenaryKitContext, target: Mob, distancePx: number): boolean {
    this.plannedLane = null;
    if (this.chargeCooldown === 0 && this.laneRecheck === 0) {
      const lane = chargeLaneTo(ctx, target, CHARGE_MIN_TRIGGER_TILES, CHARGE_MAX_TRIGGER_TILES);
      if (lane !== null) {
        this.plannedLane = lane;
        return true;
      }
      this.laneRecheck = LANE_RECHECK_FRAMES;
    }
    return super.canStartAttack(ctx, target, distancePx);
  }

  override startAttack(ctx: MercenaryKitContext, target: Mob, distancePx: number): void {
    this.hurtTicks = 0;
    this.saluteTick = null;
    if (this.plannedLane !== null) {
      this.plannedLane = null;
      this.beginWindup(ctx.merc, target);
      return;
    }
    this.thrustVictim = target;
    super.startAttack(ctx, target, distancePx);
  }

  onBark(ctx: MercenaryKitContext, trigger: MercenaryBarkTrigger): void {
    if (trigger === 'hired') this.beginSalute(ctx.merc, ctx.owner);
  }

  override drawState(merc: Mercenary): MercenaryDrawState {
    const charge = this.charge;
    if (charge !== null) {
      switch (charge.kind) {
        case 'windup':
          return { row: 'charge_windup', progress: charge.tick / CHARGE_WINDUP_TICKS };
        case 'charging':
          return { row: 'charge', progress: charge.cyclePhase };
        case 'recover':
          return { row: 'charge_recover', progress: charge.tick / CHARGE_RECOVER_TICKS };
      }
    }
    const swing = this.strike.drawState();
    if (swing !== null) return swing;
    if (this.saluteTick !== null)
      return { row: 'salute', progress: this.saluteTick / SALUTE_TICKS };
    if (this.hurtTicks > 0) return { row: 'hurt', progress: 1 - this.hurtTicks / HURT_TICKS };
    return super.drawState(merc);
  }

  override clearAirborne(): void {
    this.charge = null;
    // Whatever HP it had before is no baseline for what it has now: a hire
    // stood up by a revive would otherwise flinch at its own fall.
    this.lastHp = null;
    this.plannedLane = null;
    this.thrustVictim = null;
    this.saluteTick = null;
    this.salutePendingFrames = 0;
    this.strike.cancel();
    super.clearAirborne();
  }

  // ── Thrust ────────────────────────────────────────────────────────────────

  private advanceThrust(ctx: MercenaryKitContext): boolean {
    const victim = this.thrustVictim;
    const victimWasAlive = victim?.isAlive === true;
    const owned = this.strike.advance(ctx);
    const jabKilled = victimWasAlive && victim.hp <= 0;
    if (jabKilled) this.queueSalute();
    if (!owned) this.thrustVictim = null;
    return owned;
  }

  // ── Charge ────────────────────────────────────────────────────────────────

  private beginWindup(merc: Mercenary, target: Mob): void {
    this.charge = { kind: 'windup', tick: 0, target };
    this.chargeCooldown = CHARGE_COOLDOWN_FRAMES;
    merc.isMoving = false;
    merc.faceToward(target);
    // The run and the winded stop come half a second from now; the wind-up
    // itself was warmed when he picked the fight.
    prewarmDongQuixoteAction('charge');
    prewarmDongQuixoteAction('charge_recover');
  }

  private advanceCharge(ctx: MercenaryKitContext, charge: ChargePhase): void {
    const merc = ctx.merc;
    switch (charge.kind) {
      case 'windup':
        merc.isMoving = false;
        if (charge.target.isAlive) merc.faceToward(charge.target);
        charge.tick++;
        if (charge.tick >= CHARGE_WINDUP_TICKS) this.launch(ctx, charge.target);
        return;
      case 'charging':
        this.run(ctx, charge);
        return;
      case 'recover':
        merc.isMoving = false;
        charge.tick++;
        if (charge.tick >= CHARGE_RECOVER_TICKS) this.charge = null;
        return;
    }
  }

  /**
   * The wind-up is over: the lane is looked at once more, since the foe or a
   * friend may have moved in the half-second the telegraph took. A foe that
   * has come closer is still charged; one that has left the lane is not.
   */
  private launch(ctx: MercenaryKitContext, target: Mob): void {
    const lane = target.isAlive ? chargeLaneTo(ctx, target, 0, CHARGE_MAX_LENGTH_TILES) : null;
    if (lane === null) {
      this.charge = null;
      this.chargeCooldown = CHARGE_ABORT_RETRY_FRAMES;
      return;
    }
    this.charge = { kind: 'charging', lane, travelledPx: 0, cyclePhase: 0, struck: [] };
    ctx.bark('special');
  }

  private run(ctx: MercenaryKitContext, charge: Extract<ChargePhase, { kind: 'charging' }>): void {
    const merc = ctx.merc;
    const { dirX, dirY } = charge.lane;
    merc.facingX = dirX;
    merc.facingY = dirY;
    // Something that hit him has knocked him back: the shove owns his feet,
    // and the charge is broken.
    if (merc.knockbackFramesRemaining > 0 || friendInLane(ctx, charge.lane, CHARGE_BRAKE_TILES)) {
      this.endCharge(merc);
      return;
    }

    const maxPx = TILE_SIZE * CHARGE_MAX_LENGTH_TILES;
    const stepPx = Math.min(chargeStepPx(merc), maxPx - charge.travelledPx);
    const coveredPx = stepDownLane(merc, charge.lane, stepPx);
    merc.isMoving = true;
    charge.travelledPx += coveredPx;
    const cyclesPerPx = 1 / (TILE_SIZE * DONG_CHARGE_TILES_PER_CYCLE);
    charge.cyclePhase += Math.min(coveredPx * cyclesPerPx, 1 / DONG_CHARGE_FRAMES);

    this.skewer(ctx, charge);

    const hitWall = coveredPx < stepPx * CHARGE_STALL_RATIO;
    if (hitWall || charge.travelledPx >= maxPx) this.endCharge(merc);
  }

  /** Every hostile the couched point or his body reaches, once per charge. */
  private skewer(
    ctx: MercenaryKitContext,
    charge: Extract<ChargePhase, { kind: 'charging' }>,
  ): void {
    const merc = ctx.merc;
    const { dirX, dirY } = charge.lane;
    const origin = centreOf(merc);
    const reachAheadPx = TILE_SIZE * (CHARGE_LANCE_REACH_TILES + BODY_RADIUS_TILES);
    const reachBehindPx = TILE_SIZE * BODY_RADIUS_TILES;
    const halfWidthPx = TILE_SIZE * CHARGE_HIT_HALF_WIDTH_TILES;
    for (const mob of ctx.allMobs) {
      if (mob === merc || !mob.isAlive || !mob.isHostile || charge.struck.includes(mob)) continue;
      const centre = centreOf(mob);
      const offX = centre.x - origin.x;
      const offY = centre.y - origin.y;
      const along = offX * dirX + offY * dirY;
      const across = offX * -dirY + offY * dirX;
      if (along < -reachBehindPx || along > reachAheadPx || Math.abs(across) > halfWidthPx)
        continue;
      if (!merc.hasClearLine(origin.x, origin.y, centre.x, centre.y)) continue;

      charge.struck.push(mob);
      const hpBefore = mob.hp;
      mob.takeCreditedDamage(this.chargeDamage, ctx.owner, 'melee', merc);
      // A foe the blow could not hurt — one still rising, one immune for now —
      // is not bowled aside either.
      const wounded = mob.hp < hpBefore;
      merc.attackSoundPending = true;
      merc.noteBlowLanded(mob);
      if (mob.hp <= 0) {
        this.queueSalute();
        continue;
      }
      if (!wounded || !canBeShoved(mob)) continue;
      const side = across >= 0 ? 1 : -1;
      const flung = normalize(
        dirX + -dirY * side * CHARGE_KNOCKBACK_SIDE_WEIGHT,
        dirY + dirX * side * CHARGE_KNOCKBACK_SIDE_WEIGHT,
      );
      const pushPx =
        (TILE_SIZE * CHARGE_KNOCKBACK_TILES) / Math.max(MIN_MASS_FOR_KNOCKBACK, mob.mass);
      mob.applyKnockback(flung.x, flung.y, pushPx, CHARGE_KNOCKBACK_FRAMES);
    }
  }

  private endCharge(merc: Mercenary): void {
    merc.isMoving = false;
    this.charge = { kind: 'recover', tick: 0 };
  }

  // ── Salute ────────────────────────────────────────────────────────────────

  private queueSalute(): void {
    this.salutePendingFrames = SALUTE_PENDING_FRAMES;
  }

  private beginSalute(merc: Mercenary, owner: Player): void {
    this.saluteTick = 0;
    this.saluteOwnerStartPx = Math.hypot(owner.x - merc.x, owner.y - merc.y);
    this.salutePendingFrames = 0;
    this.hurtTicks = 0;
    merc.isMoving = false;
  }

  /** Plays a tick of the salute; broken off by a foe coming close, a wound, or his owner leaving. */
  private advanceSalute(ctx: MercenaryKitContext, tick: number): boolean {
    const merc = ctx.merc;
    const followStartPx = TILE_SIZE * this.followBand.startTiles;
    const ownerGonePx =
      Math.max(followStartPx, this.saluteOwnerStartPx) + TILE_SIZE * SALUTE_OWNER_SLACK_TILES;
    const ownerGone = Math.hypot(ctx.owner.x - merc.x, ctx.owner.y - merc.y) > ownerGonePx;
    if (this.hostileNear(ctx) || this.hurtTicks > 0 || ownerGone || tick >= SALUTE_TICKS) {
      this.saluteTick = null;
      return false;
    }
    merc.isMoving = false;
    this.saluteTick = tick + 1;
    return true;
  }

  private hostileNear(ctx: MercenaryKitContext): boolean {
    const merc = ctx.merc;
    const radiusPx = TILE_SIZE * SALUTE_CLEAR_RADIUS_TILES;
    return ctx.allMobs.some(
      (mob) =>
        mob !== merc &&
        mob.isAlive &&
        mob.isHostile &&
        Math.hypot(mob.x - merc.x, mob.y - merc.y) <= radiusPx,
    );
  }

  // ── Flinch ────────────────────────────────────────────────────────────────

  /**
   * A wound he takes standing flinches him. One taken mid-charge, mid-jab or
   * mid-stride does not: the charge and the jab are committed, and the walk
   * reads better unbroken. A wound breaks off a salute.
   */
  private tickHurt(merc: Mercenary): void {
    const previous = this.lastHp;
    this.lastHp = merc.hp;
    if (this.hurtTicks > 0) this.hurtTicks--;
    if (merc.isMoving) this.hurtTicks = 0;
    const busy = this.charge !== null || this.strike.isSwinging || merc.isMoving;
    if (previous !== null && merc.hp < previous && !busy) this.hurtTicks = HURT_TICKS;
  }
}

/**
 * The lane from the hireling to `target`, if he may charge it: the foe
 * between `minTiles` and `maxTiles` off, in plain sight, with nothing of the
 * party's in the way, and the ground to the foe one he can actually run.
 */
export function chargeLaneTo(
  ctx: MercenaryKitContext,
  target: Mob,
  minTiles: number,
  maxTiles: number,
): ChargeLane | null {
  const merc = ctx.merc;
  const from = centreOf(merc);
  const to = centreOf(target);
  const distancePx = Math.hypot(to.x - from.x, to.y - from.y);
  if (distancePx < TILE_SIZE * minTiles || distancePx > TILE_SIZE * maxTiles) return null;
  if (distancePx === 0) return null;
  if (!merc.hasClearLine(from.x, from.y, to.x, to.y)) return null;
  const lane = { dirX: (to.x - from.x) / distancePx, dirY: (to.y - from.y) / distancePx };
  if (friendInLane(ctx, lane, CHARGE_MAX_LENGTH_TILES + LANE_FRIEND_CLEARANCE_TILES)) return null;
  // He must be able to run far enough that the couched point reaches the foe.
  const neededPx = Math.max(0, distancePx - TILE_SIZE * CHARGE_LANCE_REACH_TILES);
  if (runnablePx(merc, lane, neededPx) < neededPx - LANE_RUN_SLACK_PX) return null;
  return lane;
}

/**
 * Whether a crawler, Mongo, a quest ally or any other friendly body stands in
 * the lane within `aheadTiles` of him. He never runs his lance through a friend.
 */
function friendInLane(ctx: MercenaryKitContext, lane: ChargeLane, aheadTiles: number): boolean {
  const merc = ctx.merc;
  const origin = centreOf(merc);
  const aheadPx = TILE_SIZE * aheadTiles;
  const clearancePx = TILE_SIZE * LANE_FRIEND_CLEARANCE_TILES;
  const inLane = (body: Player): boolean => {
    if (body === merc || !body.isAlive) return false;
    const centre = centreOf(body);
    const offX = centre.x - origin.x;
    const offY = centre.y - origin.y;
    const along = offX * lane.dirX + offY * lane.dirY;
    const across = offX * -lane.dirY + offY * lane.dirX;
    return along > 0 && along <= aheadPx && Math.abs(across) <= clearancePx;
  };
  if (inLane(ctx.owner) || inLane(ctx.cat) || ctx.allies.some(inLane)) return true;
  return ctx.allMobs.some((mob) => !mob.isHostile && inLane(mob));
}

/**
 * How far he gets down the lane, up to `limitPx`, before a step comes up
 * short against a wall. Measured by walking him there with his own collision
 * and putting him back, so the lane passes only if it is a walk his body can
 * really take — per-axis wall tests, stairwells, water and all — rather than
 * one a line through tile centres says is open.
 */
function runnablePx(merc: Mercenary, lane: ChargeLane, limitPx: number): number {
  const startX = merc.x;
  const startY = merc.y;
  const stepPx = chargeStepPx(merc);
  let coveredPx = 0;
  try {
    while (coveredPx < limitPx) {
      const wantedPx = Math.min(stepPx, limitPx - coveredPx);
      const gainedPx = stepDownLane(merc, lane, wantedPx);
      coveredPx += gainedPx;
      if (gainedPx < wantedPx * CHARGE_STALL_RATIO) break;
    }
  } finally {
    merc.x = startX;
    merc.y = startY;
  }
  return coveredPx;
}

/**
 * His running stride per tick. A slow slows the charge as it slows his walk:
 * `stepBy` goes straight to the wall collision, past the chase code that
 * applies the slow to every other step he takes.
 */
function chargeStepPx(merc: Mercenary): number {
  const slowFactor = merc.isSlowed ? MOB_SLOWED_SPEED_FRACTION : 1;
  return merc.moveSpeed * CHARGE_SPEED_MULTIPLE * slowFactor;
}

/** Steps him `stepPx` down the lane through his own wall collision; returns the ground gained along it. */
function stepDownLane(merc: Mercenary, lane: ChargeLane, stepPx: number): number {
  const beforeX = merc.x;
  const beforeY = merc.y;
  merc.stepBy(lane.dirX * stepPx, lane.dirY * stepPx);
  return (merc.x - beforeX) * lane.dirX + (merc.y - beforeY) * lane.dirY;
}
