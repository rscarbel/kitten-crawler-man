import { TILE_SIZE } from '../../core/constants';
import type { MercenaryTemplate } from '../../core/mercenaryTemplates';
import {
  MAXX_CRUSH_FRAMES,
  MAXX_CRUSH_IMPACT_FRAME,
  MAXX_CRUSH_SEAT_REACH_TILES,
  MAXX_CRUSH_TICKS,
  MAXX_HURT_TICKS,
  MAXX_JAB_FRAMES,
  MAXX_JAB_IMPACT_FRAME,
  MAXX_JAB_TICKS,
  maxxTicksPerFrame,
} from '../../sprites/gluteusMaxxTiming';
import { normalize } from '../../utils';
import type { Mob } from '../Mob';
import type { Mercenary } from '../Mercenary';
import { BasicMeleeKit } from './basicMeleeKit';
import type { MercenaryDrawState, MercenaryKitContext } from './MercenaryKit';
import type { StrikeTiming } from './mercenaryStrike';

/**
 * Gluteus Maxx's kit: twin war gauntlets, left and right jabs taking turns on
 * a short cooldown, and the Glute Crush.
 *
 * He is reckless. He ranges further from his owner than any other hire and
 * comes back later, and he never backs off when hurt — the shell only lets him
 * complain about it, which is all he does.
 *
 * The Glute Crush is the move the cat boasts he has: when whatever he is
 * fighting is nearly dead, he turns his back on it, hops onto it and sits
 * down, which finishes it. It is for finishing small fry, so it is never tried
 * on a boss or on anything much bigger than he is.
 */

/** Game ticks from the start of a row to the drawn frame its blow lands on. */
function impactTick(impactFrame: number, rowTicks: number, rowFrames: number): number {
  return Math.ceil(impactFrame * maxxTicksPerFrame(rowTicks, rowFrames));
}

/** A jab lands a little past strike range, so a victim leaning back is still reached. */
const JAB_REACH_RATIO = 1.3;
/** A jab and a breath: twice the swing's own length, which is what makes his damage rate high. */
const JAB_COOLDOWN_FRAMES = 30;
const BRAWLER_ENGAGE_RADIUS_TILES = 14;
const BRAWLER_LEASH_RADIUS_TILES = 16;

const JAB_LEFT: StrikeTiming = {
  row: 'jab_left',
  frames: MAXX_JAB_TICKS,
  impactFrame: impactTick(MAXX_JAB_IMPACT_FRAME, MAXX_JAB_TICKS, MAXX_JAB_FRAMES),
  reachRatio: JAB_REACH_RATIO,
};
const JAB_RIGHT: StrikeTiming = { ...JAB_LEFT, row: 'jab_right' };

/** Below this share of its health a target is close enough to dead to sit on. */
export const CRUSH_TARGET_HP_FRACTION = 0.2;
/** Nothing with more than this multiple of his own max HP is small enough to sit on. */
export const CRUSH_MAX_TARGET_HP_MULTIPLE = 2;
/** Twelve seconds: a finisher, not a rotation. */
export const CRUSH_COOLDOWN_FRAMES = 720;
/** He starts a crush from the same distance he would start a jab from, in strike ranges. */
const CRUSH_TRIGGER_RANGE_RATIO = 1.2;
const CRUSH_IMPACT_TICK = impactTick(MAXX_CRUSH_IMPACT_FRAME, MAXX_CRUSH_TICKS, MAXX_CRUSH_FRAMES);
const CRUSH_SEAT_REACH_PX = TILE_SIZE * MAXX_CRUSH_SEAT_REACH_TILES;
/**
 * How far the target may be from where his seat comes down and still be sat
 * on, in tiles. About half a body: one that has scuttled clear is missed.
 */
export const CRUSH_SEAT_TOLERANCE_TILES = 0.45;
/**
 * The most he shuffles toward his seating spot per tick while turning round,
 * in pixels. A little under his run speed, so the correction reads as a
 * backward step rather than a slide.
 */
const CRUSH_SHUFFLE_PX_PER_TICK = 2.5;
/**
 * The crush is dealt as this multiple of the target's remaining health, so
 * armour or a resistance cannot leave a sliver standing. A hireling's blow is
 * never guarded; only a target immune to the hit (`isDamageImmune`, or one
 * that refuses crawler damage through `takesPlayerDamage`) survives it.
 */
const CRUSH_FINISH_DAMAGE_MULTIPLE = 4;

/**
 * Whether a mob is a boss for the crush's purposes. `isBoss` alone misses the
 * bosses whose own systems leave it false on purpose (Terror the Clown among
 * them); every boss claims a reduced `blastDamageScale` instead, which is the
 * same test `DynamiteSystem` uses so a cheap trick cannot skip a boss fight.
 */
function isAnyBoss(target: Mob): boolean {
  return target.isBoss || target.blastDamageScale < 1;
}

/** Whether `target` is something he may sit on: nearly dead, not a boss, not much bigger than him. */
export function isCrushable(merc: Mercenary, target: Mob): boolean {
  if (!target.isAlive || isAnyBoss(target)) return false;
  if (target.maxHp > merc.maxHp * CRUSH_MAX_TARGET_HP_MULTIPLE) return false;
  return target.hp < target.maxHp * CRUSH_TARGET_HP_FRACTION;
}

interface Crush {
  readonly victim: Mob;
  tick: number;
  resolved: boolean;
}

export class BrawlerKit extends BasicMeleeKit {
  private crush: Crush | null = null;
  private crushCooldown = 0;
  private hurtTicks = 0;
  private lastHp: number | null = null;

  constructor(template: MercenaryTemplate) {
    super({
      damage: template.damage,
      swings: [JAB_LEFT, JAB_RIGHT],
      cooldownFrames: JAB_COOLDOWN_FRAMES,
      engageRadiusTiles: BRAWLER_ENGAGE_RADIUS_TILES,
      leashRadiusTiles: BRAWLER_LEASH_RADIUS_TILES,
    });
  }

  /** Frames until the Glute Crush may be tried again. */
  get crushCooldownFrames(): number {
    return this.crushCooldown;
  }

  get isCrushing(): boolean {
    return this.crush !== null;
  }

  override tick(ctx: MercenaryKitContext): void {
    if (this.crushCooldown > 0) this.crushCooldown--;
    this.tickHurt(ctx.merc);
  }

  override update(ctx: MercenaryKitContext): boolean {
    if (this.crush !== null) return this.advanceCrush(ctx, this.crush);
    return super.update(ctx);
  }

  override canStartAttack(ctx: MercenaryKitContext, target: Mob, distancePx: number): boolean {
    if (this.canCrush(ctx.merc, target, distancePx)) return true;
    return super.canStartAttack(ctx, target, distancePx);
  }

  override startAttack(ctx: MercenaryKitContext, target: Mob, distancePx: number): void {
    this.hurtTicks = 0;
    if (this.canCrush(ctx.merc, target, distancePx)) {
      this.beginCrush(ctx.merc, target);
      return;
    }
    super.startAttack(ctx, target, distancePx);
  }

  override drawState(merc: Mercenary): MercenaryDrawState {
    const crush = this.crush;
    if (crush !== null) return { row: 'crush', progress: crush.tick / MAXX_CRUSH_TICKS };
    const swing = this.strike.drawState();
    if (swing !== null) return swing;
    if (this.hurtTicks > 0) {
      return { row: 'hurt', progress: 1 - this.hurtTicks / MAXX_HURT_TICKS };
    }
    return super.drawState(merc);
  }

  override clearAirborne(): void {
    this.crush = null;
    super.clearAirborne();
  }

  /**
   * A wound he takes standing flinches him; one taken mid-swing or on the move
   * does not, because a reckless brawler does not stop for either.
   */
  private tickHurt(merc: Mercenary): void {
    const previous = this.lastHp;
    this.lastHp = merc.hp;
    if (this.hurtTicks > 0) this.hurtTicks--;
    if (merc.isMoving) this.hurtTicks = 0;
    const busy = this.crush !== null || this.strike.isSwinging || merc.isMoving;
    if (previous !== null && merc.hp < previous && !busy) this.hurtTicks = MAXX_HURT_TICKS;
  }

  private canCrush(merc: Mercenary, target: Mob, distancePx: number): boolean {
    if (this.crushCooldown > 0) return false;
    if (distancePx > merc.strikeRangePx * CRUSH_TRIGGER_RANGE_RATIO) return false;
    return isCrushable(merc, target);
  }

  private beginCrush(merc: Mercenary, victim: Mob): void {
    this.crush = { victim, tick: 0, resolved: false };
    this.crushCooldown = CRUSH_COOLDOWN_FRAMES;
    merc.attackCooldown = MAXX_CRUSH_TICKS;
    merc.isMoving = false;
    merc.faceToward(victim);
  }

  /** Plays one tick of the crush; it owns every tick until the row ends. */
  private advanceCrush(ctx: MercenaryKitContext, crush: Crush): boolean {
    const merc = ctx.merc;
    if (!crush.resolved && crush.tick < CRUSH_IMPACT_TICK && crush.victim.isAlive) {
      this.shuffleIntoSeat(merc, crush.victim);
    }
    merc.isMoving = false;

    if (!crush.resolved && crush.tick >= CRUSH_IMPACT_TICK) {
      crush.resolved = true;
      this.landCrush(ctx, crush.victim);
    }

    crush.tick++;
    if (crush.tick >= MAXX_CRUSH_TICKS) this.crush = null;
    return true;
  }

  /**
   * Keeps him facing the target and steps him toward the spot that puts the
   * target under his seat, since the seat lands a fixed distance along his
   * facing whatever distance he started from.
   */
  private shuffleIntoSeat(merc: Mercenary, victim: Mob): void {
    merc.faceToward(victim);
    const seatX = victim.x - merc.facingX * CRUSH_SEAT_REACH_PX;
    const seatY = victim.y - merc.facingY * CRUSH_SEAT_REACH_PX;
    const offX = seatX - merc.x;
    const offY = seatY - merc.y;
    const offPx = Math.hypot(offX, offY);
    if (offPx === 0) return;
    const stepPx = Math.min(offPx, CRUSH_SHUFFLE_PX_PER_TICK);
    const step = normalize(offX, offY);
    merc.stepBy(step.x * stepPx, step.y * stepPx);
    merc.faceToward(victim);
  }

  private landCrush(ctx: MercenaryKitContext, victim: Mob): void {
    const merc = ctx.merc;
    merc.attackSoundPending = true;
    if (!victim.isAlive) return;
    const seatX = merc.x + merc.facingX * CRUSH_SEAT_REACH_PX;
    const seatY = merc.y + merc.facingY * CRUSH_SEAT_REACH_PX;
    const missPx = Math.hypot(victim.x - seatX, victim.y - seatY);
    if (missPx > TILE_SIZE * CRUSH_SEAT_TOLERANCE_TILES) return;
    const damage = Math.ceil(victim.hp * CRUSH_FINISH_DAMAGE_MULTIPLE);
    victim.takeCreditedDamage(damage, ctx.owner, 'melee', merc);
    if (victim.hp <= 0) ctx.bark('special');
    merc.noteBlowLanded(victim);
  }
}
