import { TILE_SIZE } from '../../core/constants';
import type { MercenaryTemplate } from '../../core/party/mercenaryTemplates';
import {
  IVY_HURT_DURATION_MS,
  IVY_SHOT_DURATION_MS,
  IVY_SHOT_RELEASE_PROGRESS,
} from '../../sprites/ivyAshgroveTiming';
import type { HirelingShot } from '../../systems/HirelingShotSystem';
import { normalize } from '../../utils';
import type { Mob } from '../Mob';
import type { Mercenary } from '../Mercenary';
import {
  DEFAULT_ENGAGE_RADIUS_TILES,
  DEFAULT_FOLLOW_BAND,
  DEFAULT_LEASH_RADIUS_TILES,
  NO_PROJECTILES,
  locomotionState,
  type HirelingProjectile,
  type ArcherRow,
  type MercenaryDrawState,
  type MercenaryKit,
  type MercenaryKitContext,
} from './MercenaryKit';

/**
 * The archer's kit: a longbow, and the discipline to stay out of reach of
 * whatever she is shooting.
 *
 * She fights from range, holding three to five tiles off her target and
 * loosing one arrow per draw. She is lightly built, so a hostile that closes
 * to arm's length makes her back off before she draws again, and one that
 * edges inside the band has her ease back out to its near edge.
 */

const CENTER_OFFSET = 0.5;
const TICKS_PER_SECOND = 60;
const MS_PER_SECOND = 1000;

function ticksFor(durationMs: number): number {
  return Math.round((durationMs * TICKS_PER_SECOND) / MS_PER_SECOND);
}

// ── The bow ─────────────────────────────────────────────────────────────────

/** Furthest she looses from. Past the far edge of the band she holds. */
const ARROW_RANGE_TILES = 6.5;
/** An arrow flies a little past its aim point, so a target stepping back is still reached. */
const ARROW_FLIGHT_RANGE_RATIO = 1.3;
export const ARCHER_SHOT_TICKS = ticksFor(IVY_SHOT_DURATION_MS);
/** The tick of the shot row on which the string is loosed and the arrow leaves. */
export const ARCHER_SHOT_RELEASE_TICK = Math.round(ARCHER_SHOT_TICKS * IVY_SHOT_RELEASE_PROGRESS);
const HURT_TICKS = ticksFor(IVY_HURT_DURATION_MS);
/** She lowers the bow this long between one shot's end and the next draw. */
const SHOT_REST_FRAMES = 15;
/** Frames between the starts of two shots: the whole draw and loose, then the rest. */
const SHOT_COOLDOWN_FRAMES = ARCHER_SHOT_TICKS + SHOT_REST_FRAMES;
/** The bow sits this far ahead of her centre, so the arrow leaves the drawn string. */
const ARROW_NOCK_FORWARD_TILES = 0.4;

// ── Holding range ───────────────────────────────────────────────────────────

/** Further than this and she walks in; the band is where she stands and shoots. */
const HOLD_MAX_TILES = 5;
/** Where a walk in stops. Short of the band's far edge, so one step back does not restart it. */
const CLOSE_STOP_TILES = 4;
/** With no line to the target she walks in this close, around whatever is in the way. */
const LOST_SIGHT_STOP_TILES = 1;
/** Nearer than this and she eases back out to the near edge of the band. */
const BACKOFF_ENTER_TILES = 2.5;
/**
 * The near edge of the band, where an ease-back stops. The gap from
 * `BACKOFF_ENTER_TILES` keeps the ease-back and standing still from taking
 * turns; it is also where a kite ends, so a finished kite never starts one.
 */
const HOLD_MIN_TILES = 3;
/** An ease-back is a shuffle, not a flight: this share of her walking speed. */
const BACKOFF_SPEED_RATIO = 0.6;

// ── Kiting ──────────────────────────────────────────────────────────────────

/** A hostile this close is at arm's length, and she backs off before shooting. */
const KITE_ENTER_TILES = 1.5;
/**
 * Near enough to be trading blows. A body this close counts as a melee threat
 * even standing still; further out, only one still closing on her does.
 */
const KITE_CONTACT_TILES = 1.1;
/** A step toward her smaller than this is jostle from separation, not an advance. */
const MIN_ADVANCE_PX = 0.1;
/**
 * She keeps backing off until the threat is this far away. The gap from
 * `KITE_ENTER_TILES` is the hysteresis that stops the back-off and the shell's
 * close-in taking alternate frames while a melee mob chases her.
 */
const KITE_CLEAR_TILES = HOLD_MIN_TILES;
/**
 * A retreat is given up after this long. Anything fast enough to keep pace
 * would otherwise be kited forever and never shot at.
 */
const KITE_MAX_RETREAT_FRAMES = 90;
/** After giving up, or being cornered, she stands and shoots this long before retreating again. */
const KITE_REARM_FRAMES = 75;
/** How much a retreat leans back toward her crawler, so she backs toward the party, not off the leash. */
const KITE_OWNER_PULL = 0.35;
/** A step that covered less than this share of her speed was refused by a wall. */
const MIN_ESCAPE_STEP_RATIO = 0.25;
/** A kite runs at her full walking speed. */
const KITE_SPEED_RATIO = 1;
/**
 * How far behind square a fallback step may point and still count as "not
 * toward the threat". Just under zero, so a slide straight along the wall she
 * is backed against is allowed; anything that closes on the threat is not,
 * because alternating one step toward it with one away is a visible shake.
 */
const SIDESTEP_DOT_TOLERANCE = -0.05;
/** The four cardinals, tried in turn when the direct way out is walled off. */
const CARDINALS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
] as const;

interface Shot {
  tick: number;
  released: boolean;
  readonly victim: Mob;
}

interface SeenAt {
  readonly mob: Mob;
  readonly x: number;
  readonly y: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function centreOf(body: Point): Point {
  return { x: body.x + TILE_SIZE * CENTER_OFFSET, y: body.y + TILE_SIZE * CENTER_OFFSET };
}

export class ArcherKit implements MercenaryKit {
  readonly engageRadiusTiles = DEFAULT_ENGAGE_RADIUS_TILES;
  readonly leashRadiusTiles = DEFAULT_LEASH_RADIUS_TILES;
  readonly strikeRangeTiles = ARROW_RANGE_TILES;
  readonly followBand = DEFAULT_FOLLOW_BAND;

  private readonly arrowDamage: number;
  private shot: Shot | null = null;
  private hurtTicks = 0;
  private lastHp: number | null = null;
  /** Walking in on a target past the band, until inside `CLOSE_STOP_TILES`. */
  private closing = false;
  private retreating = false;
  /** Whatever the retreat is running from, held for the length of it. */
  private retreatFrom: Mob | null = null;
  private retreatFrames = 0;
  private kiteRearm = 0;
  /** Easing back out to the near edge of the band from a target standing too close. */
  private backingOff = false;
  /**
   * Where each nearby hostile stood one frame ago, so a body walking at her
   * can be told from one standing off. Refreshed on every tick, whatever she is
   * doing, so the step read from it is always a single frame's: compared after
   * a whole shot, a mob's one step at the start of it would add up past the
   * per-frame threshold and look like a charge. Its own step is what is read,
   * not the gap, since she may be easing away faster than it walks.
   */
  private lastSeenAt: SeenAt[] = [];
  private seenNow: SeenAt[] = [];
  private pending: HirelingShot[] = [];

  constructor(template: MercenaryTemplate) {
    this.arrowDamage = template.damage;
  }

  /** Whether she is backing away from something at arm's length. For gates. */
  get isRetreating(): boolean {
    return this.retreating;
  }

  /** Whether she is easing back out to the near edge of her band. For gates. */
  get isEasingBack(): boolean {
    return this.backingOff;
  }

  tick(ctx: MercenaryKitContext): void {
    this.noteWhereHostilesStand(ctx);
    if (this.kiteRearm > 0) this.kiteRearm--;
    if (this.hurtTicks > 0) this.hurtTicks--;
    const hp = ctx.merc.hp;
    if (this.lastHp !== null && hp < this.lastHp) this.hurtTicks = HURT_TICKS;
    this.lastHp = hp;
  }

  update(ctx: MercenaryKitContext): boolean {
    if (this.shot === null) return false;
    this.advanceShot(ctx, this.shot);
    return true;
  }

  /** A fight that ends mid-retreat must not leave the next one starting in a back-off. */
  chooseTarget(_ctx: MercenaryKitContext, nearest: Mob | null): Mob | null {
    if (nearest === null) {
      this.endRetreat(0);
      this.backingOff = false;
      this.lastSeenAt = [];
      this.seenNow = [];
    }
    return nearest;
  }

  approach(ctx: MercenaryKitContext, target: Mob, distancePx: number): boolean {
    const merc = ctx.merc;
    // A shove owns her feet; a refused step now would read as a wall.
    if (merc.knockbackFramesRemaining > 0) return true;
    if (this.kite(ctx)) return true;

    if (!merc.canSee(target)) {
      this.closing = true;
      merc.walkTo(target.x, target.y, TILE_SIZE * LOST_SIGHT_STOP_TILES);
      return true;
    }
    if (distancePx > TILE_SIZE * HOLD_MAX_TILES) this.closing = true;
    if (this.closing && distancePx <= TILE_SIZE * CLOSE_STOP_TILES) this.closing = false;
    if (this.closing) {
      merc.walkTo(target.x, target.y, TILE_SIZE * CLOSE_STOP_TILES);
      return true;
    }
    if (this.easeBack(ctx, target, distancePx)) return true;
    merc.isMoving = false;
    merc.faceToward(target);
    return true;
  }

  canStartAttack(ctx: MercenaryKitContext, target: Mob, distancePx: number): boolean {
    if (this.retreating) return false;
    return this.hitsWithoutClosing(ctx, target, distancePx);
  }

  /** An arrow reaches anything in range and in sight, with or without a way round. */
  hitsWithoutClosing(ctx: MercenaryKitContext, target: Mob, distancePx: number): boolean {
    if (distancePx > TILE_SIZE * ARROW_RANGE_TILES) return false;
    if (ctx.isInSafeRoom(ctx.merc) || ctx.isInSafeRoom(target)) return false;
    return ctx.merc.canSee(target);
  }

  startAttack(ctx: MercenaryKitContext, target: Mob, _distancePx: number): void {
    const merc = ctx.merc;
    this.shot = { tick: 0, released: false, victim: target };
    merc.isMoving = false;
    merc.faceToward(target);
    merc.attackCooldown = SHOT_COOLDOWN_FRAMES;
  }

  drawState(merc: Mercenary): MercenaryDrawState<ArcherRow> {
    const shot = this.shot;
    if (shot !== null) return { row: 'shoot', progress: shot.tick / ARCHER_SHOT_TICKS };
    if (this.hurtTicks > 0) return { row: 'hurt', progress: 1 - this.hurtTicks / HURT_TICKS };
    return locomotionState(merc);
  }

  drainProjectiles(): readonly HirelingProjectile[] {
    if (this.pending.length === 0) return NO_PROJECTILES;
    const launched = this.pending;
    this.pending = [];
    return launched;
  }

  clearAirborne(): void {
    this.pending = [];
    this.shot = null;
    // Whatever HP it had before is no baseline for what it has now: a hire
    // stood up by a revive would otherwise flinch at its own fall.
    this.lastHp = null;
    this.endRetreat(0);
    this.backingOff = false;
    this.lastSeenAt = [];
    this.seenNow = [];
  }

  private advanceShot(ctx: MercenaryKitContext, shot: Shot): void {
    const merc = ctx.merc;
    merc.isMoving = false;
    shot.tick++;
    if (!shot.released && shot.victim.isAlive) merc.faceToward(shot.victim);
    if (!shot.released && shot.tick >= ARCHER_SHOT_RELEASE_TICK) {
      shot.released = true;
      this.loose(ctx, shot.victim);
    }
    if (shot.tick >= ARCHER_SHOT_TICKS) this.shot = null;
  }

  /** Looses at wherever the victim stands now; a victim that died mid-draw gets the arrow anyway, along the facing. */
  private loose(ctx: MercenaryKitContext, victim: Mob): void {
    const merc = ctx.merc;
    if (ctx.isInSafeRoom(merc)) return;
    const origin = centreOf(merc);
    const aim = victim.isAlive ? centreOf(victim) : null;
    const heading =
      aim === null
        ? { x: merc.facingX, y: merc.facingY }
        : normalize(aim.x - origin.x, aim.y - origin.y);
    this.pending.push({
      kind: 'arrow',
      x: origin.x + heading.x * TILE_SIZE * ARROW_NOCK_FORWARD_TILES,
      y: origin.y + heading.y * TILE_SIZE * ARROW_NOCK_FORWARD_TILES,
      dirX: heading.x,
      dirY: heading.y,
      damage: this.arrowDamage,
      rangePx: TILE_SIZE * ARROW_RANGE_TILES * ARROW_FLIGHT_RANGE_RATIO,
      shooter: merc,
      owner: ctx.owner,
    });
    merc.attackSoundPending = true;
  }

  // ── Kiting ────────────────────────────────────────────────────────────────

  /**
   * The nearest hostile at arm's length that is fighting hand to hand: one she
   * can see (a mob across a wall corner is diagonally close but cannot reach
   * her), and either in contact or still closing. A ranged mob that stands off
   * at arm's length is left to the bow rather than run from.
   */
  private meleeThreat(ctx: MercenaryKitContext): Mob | null {
    const merc = ctx.merc;
    const origin = centreOf(merc);
    const previous = this.lastSeenAt;
    let best: { mob: Mob; distancePx: number } | null = null;
    for (const mob of ctx.allMobs) {
      if (mob === merc || !mob.isAlive || !mob.isHostile) continue;
      const distancePx = Math.hypot(mob.x - merc.x, mob.y - merc.y);
      if (distancePx > TILE_SIZE * KITE_CLEAR_TILES) continue;
      if (distancePx > TILE_SIZE * KITE_ENTER_TILES) continue;
      const centre = centreOf(mob);
      if (!merc.hasClearLine(origin.x, origin.y, centre.x, centre.y)) continue;
      const before = previous.find((entry) => entry.mob === mob);
      const toHim = normalize(merc.x - mob.x, merc.y - mob.y);
      const advance =
        before === undefined ? 0 : (mob.x - before.x) * toHim.x + (mob.y - before.y) * toHim.y;
      const closing = advance > MIN_ADVANCE_PX;
      const inContact = distancePx <= TILE_SIZE * KITE_CONTACT_TILES;
      if (!closing && !inContact) continue;
      if (best === null || distancePx < best.distancePx) best = { mob, distancePx };
    }
    return best?.mob ?? null;
  }

  /** Rolls the one-frame-old positions forward and records where nearby hostiles stand now. */
  private noteWhereHostilesStand(ctx: MercenaryKitContext): void {
    const merc = ctx.merc;
    this.lastSeenAt = this.seenNow;
    const seen: SeenAt[] = [];
    for (const mob of ctx.allMobs) {
      if (mob === merc || !mob.isAlive || !mob.isHostile) continue;
      const distancePx = Math.hypot(mob.x - merc.x, mob.y - merc.y);
      if (distancePx > TILE_SIZE * KITE_CLEAR_TILES) continue;
      seen.push({ mob, x: mob.x, y: mob.y });
    }
    this.seenNow = seen;
  }

  /**
   * Backs away from a melee threat. Returns true while the retreat owns her
   * feet this frame.
   *
   * Latched on the one threat that started it: it runs until that body is
   * `KITE_CLEAR_TILES` off or out of sight, the retreat times out, or every
   * way out is walled — so the back-off and the walk back in never take turns
   * on alternate frames.
   */
  private kite(ctx: MercenaryKitContext): boolean {
    const merc = ctx.merc;
    if (!this.retreating) {
      const threat = this.kiteRearm > 0 ? null : this.meleeThreat(ctx);
      if (threat === null) return false;
      this.retreating = true;
      this.retreatFrom = threat;
      this.retreatFrames = 0;
    }
    const threat = this.retreatFrom;
    if (threat?.isAlive !== true) {
      this.endRetreat(0);
      return false;
    }
    const origin = centreOf(merc);
    const centre = centreOf(threat);
    const clear = Math.hypot(threat.x - merc.x, threat.y - merc.y) >= TILE_SIZE * KITE_CLEAR_TILES;
    const outOfSight = !merc.hasClearLine(origin.x, origin.y, centre.x, centre.y);
    if (clear || outOfSight) {
      this.endRetreat(0);
      return false;
    }
    this.retreatFrames++;
    if (this.retreatFrames > KITE_MAX_RETREAT_FRAMES) {
      this.endRetreat(KITE_REARM_FRAMES);
      return false;
    }
    if (!this.stepAwayFrom(ctx, threat, KITE_SPEED_RATIO)) {
      this.endRetreat(KITE_REARM_FRAMES);
      return false;
    }
    return true;
  }

  private endRetreat(rearmFrames: number): void {
    this.retreating = false;
    this.retreatFrom = null;
    this.retreatFrames = 0;
    this.kiteRearm = Math.max(this.kiteRearm, rearmFrames);
  }

  /**
   * Eases back out to `HOLD_MIN_TILES` from a target standing inside the band.
   * Returns true while it owns her feet this frame.
   *
   * It never gives up her line on the target: a step that would put a wall
   * between them is taken back and the ease-back ends, because walking back in
   * to find the target again and then easing back out of sight is a loop. A
   * refused step ends it too, and both wait out `KITE_REARM_FRAMES` like a
   * cornered kite, so she stands and shoots rather than grinding a wall.
   */
  private easeBack(ctx: MercenaryKitContext, target: Mob, distancePx: number): boolean {
    const merc = ctx.merc;
    if (!this.backingOff) {
      const tooClose = distancePx < TILE_SIZE * BACKOFF_ENTER_TILES;
      if (!tooClose || this.kiteRearm > 0) return false;
      this.backingOff = true;
    }
    if (distancePx >= TILE_SIZE * HOLD_MIN_TILES) {
      this.backingOff = false;
      return false;
    }
    const beforeX = merc.x;
    const beforeY = merc.y;
    const moved = this.stepAwayFrom(ctx, target, BACKOFF_SPEED_RATIO);
    const origin = centreOf(merc);
    const centre = centreOf(target);
    const keptSight = merc.hasClearLine(origin.x, origin.y, centre.x, centre.y);
    if (moved && keptSight) return true;
    merc.x = beforeX;
    merc.y = beforeY;
    merc.isMoving = false;
    this.backingOff = false;
    this.kiteRearm = Math.max(this.kiteRearm, KITE_REARM_FRAMES);
    return false;
  }

  /**
   * One step away from `threat`, leaning toward the owner. When the wall
   * refuses it, each cardinal that does not lead back toward the threat is
   * tried, best first: a body wedged against masonry refuses the same step on every frame, so a
   * retreat that only ever tried the one direction would stand there forever.
   *
   * @returns whether she actually moved.
   */
  private stepAwayFrom(ctx: MercenaryKitContext, threat: Mob, speedRatio: number): boolean {
    const merc = ctx.merc;
    const rawAway = normalize(merc.x - threat.x, merc.y - threat.y);
    const standingOnIt = rawAway.x === 0 && rawAway.y === 0;
    const away = standingOnIt ? { x: -merc.facingX, y: -merc.facingY } : rawAway;
    const toOwner = normalize(ctx.owner.x - merc.x, ctx.owner.y - merc.y);
    const leaned = normalize(
      away.x + toOwner.x * KITE_OWNER_PULL,
      away.y + toOwner.y * KITE_OWNER_PULL,
    );
    const leanStillAway = leaned.x * away.x + leaned.y * away.y > 0;
    const first = leanStillAway ? leaned : away;
    if (this.tryStep(merc, first, speedRatio)) return true;

    const awayness = (dir: Point): number => dir.x * away.x + dir.y * away.y;
    const fallbacks = CARDINALS.filter((dir) => awayness(dir) > SIDESTEP_DOT_TOLERANCE).sort(
      (a, b) => awayness(b) - awayness(a),
    );
    for (const dir of fallbacks) {
      if (this.tryStep(merc, dir, speedRatio)) return true;
    }
    merc.isMoving = false;
    return false;
  }

  private tryStep(merc: Mercenary, dir: Point, speedRatio: number): boolean {
    const beforeX = merc.x;
    const beforeY = merc.y;
    const speed = merc.moveSpeed * speedRatio;
    merc.stepBy(dir.x * speed, dir.y * speed);
    const moved = Math.hypot(merc.x - beforeX, merc.y - beforeY);
    if (moved < speed * MIN_ESCAPE_STEP_RATIO) return false;
    merc.isMoving = true;
    merc.facingX = dir.x;
    merc.facingY = dir.y;
    return true;
  }
}
