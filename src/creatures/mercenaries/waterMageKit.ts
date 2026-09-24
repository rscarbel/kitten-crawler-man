import { TILE_SIZE } from '../../core/constants';
import type { MercenaryTemplate } from '../../core/mercenaryTemplates';
import {
  SPLASH_ZONE_CAST_WAVE_RELEASE_TICK,
  SPLASH_ZONE_CAST_WAVE_TICKS,
  SPLASH_ZONE_HURT_TICKS,
  SPLASH_ZONE_SHOOT_RELEASE_TICK,
  SPLASH_ZONE_SHOOT_TICKS,
} from '../../sprites/splashZoneTiming';
import type { HirelingShot } from '../../systems/HirelingBoltSystem';
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
  type MercenaryDrawState,
  type MercenaryKit,
  type MercenaryKitContext,
} from './MercenaryKit';

/**
 * Splash Zone's kit: an otter lifeguard with a small crossbow and one big trick.
 *
 * He fights from range, holding three to five tiles off his target and plinking
 * crossbow bolts. When a crowd bunches up in front of him he throws the Wet Spot
 * routine: a wave that rolls out across a cone, hits everything it reaches and
 * carries them back. Water magic is an offensive spell, so it never goes off in
 * a safe room — in the books a saferoom blocked this exact routine.
 *
 * He is small and fragile, so a hostile that closes to arm's length makes him
 * back off before he shoots again.
 */

const CENTER_OFFSET = 0.5;

// ── The crossbow ────────────────────────────────────────────────────────────

/** Furthest he looses a bolt from. Past the far edge of the band he holds. */
const BOLT_RANGE_TILES = 6.5;
/** A bolt flies a little past its aim point, so a target stepping back is still reached. */
const BOLT_FLIGHT_RANGE_RATIO = 1.3;
/** Frames between the starts of two shots: slower than a sword swing, since the bolt cannot miss a still target. */
const SHOT_COOLDOWN_FRAMES = 70;
/** The crossbow sits this far ahead of his centre, so the bolt leaves the drawn weapon. */
const BOLT_MUZZLE_FORWARD_TILES = 0.4;

// ── Holding range ───────────────────────────────────────────────────────────

/** Further than this and he walks in; the band is where he stands and shoots. */
const HOLD_MAX_TILES = 5;
/** Where a walk in stops. Short of the band's far edge, so one step back does not restart it. */
const CLOSE_STOP_TILES = 4;
/** With no line to the target he walks in this close, around whatever is in the way. */
const LOST_SIGHT_STOP_TILES = 1;
/** Nearer than this and he eases back out to the near edge of the band. */
const BACKOFF_ENTER_TILES = 2.5;
/**
 * The near edge of the band, where an ease-back stops. The gap from
 * `BACKOFF_ENTER_TILES` keeps the ease-back and standing still from taking
 * turns; it is also where a kite ends, so a finished kite never starts one.
 */
const HOLD_MIN_TILES = 3;
/** An ease-back is a shuffle, not a flight: this share of his walking speed. */
const BACKOFF_SPEED_RATIO = 0.6;

// ── Kiting ──────────────────────────────────────────────────────────────────

/** A hostile this close is at arm's length, and he backs off before shooting. */
const KITE_ENTER_TILES = 1.5;
/**
 * Near enough to be trading blows. A body this close counts as a melee threat
 * even standing still; further out, only one still closing on him does.
 */
const KITE_CONTACT_TILES = 1.1;
/** A step toward him smaller than this is jostle from separation, not an advance. */
const MIN_ADVANCE_PX = 0.1;
/**
 * He keeps backing off until the threat is this far away. The gap from
 * `KITE_ENTER_TILES` is the hysteresis that stops the back-off and the shell's
 * close-in taking alternate frames while a melee mob chases him.
 */
const KITE_CLEAR_TILES = HOLD_MIN_TILES;
/**
 * A retreat is given up after this long. Anything fast enough to keep pace
 * would otherwise be kited forever and never shot at.
 */
const KITE_MAX_RETREAT_FRAMES = 90;
/** After giving up, or being cornered, he stands and shoots this long before retreating again. */
const KITE_REARM_FRAMES = 75;
/** How much a retreat leans back toward his crawler, so he backs toward the party, not off the leash. */
const KITE_OWNER_PULL = 0.35;
/** A step that covered less than this share of his speed was refused by a wall. */
const MIN_ESCAPE_STEP_RATIO = 0.25;
/** A kite runs at his full walking speed. */
const KITE_SPEED_RATIO = 1;
/**
 * How far behind square a fallback step may point and still count as "not
 * toward the threat". Just under zero, so a slide straight along the wall he
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

// ── The Wet Spot routine ────────────────────────────────────────────────────

/** A wave is only worth it for a crowd. */
const WAVE_MIN_HOSTILES = 3;
/** The cone's full opening, straight ahead of him. */
const WAVE_CONE_DEGREES = 60;
const DEGREES_PER_HALF_TURN = 180;
const WAVE_CONE_HALF_ANGLE = (WAVE_CONE_DEGREES / 2) * (Math.PI / DEGREES_PER_HALF_TURN);
/** How far out a hostile counts toward the crowd. */
const WAVE_TRIGGER_REACH_TILES = 4;
/** How far the crest rolls: a little past the trigger reach, so the far edge of the crowd is caught. */
const WAVE_TRAVEL_TILES = 4.5;
/** Ten seconds between waves. */
const WAVE_COOLDOWN_FRAMES = 600;
/** Wave damage as a multiple of a bolt's: moderate, since it lands on everyone in the cone. */
const WAVE_DAMAGE_RATIO = 2;

type Action =
  | {
      readonly row: 'shoot';
      tick: number;
      released: boolean;
      readonly victim: Mob;
    }
  | {
      readonly row: 'cast_wave';
      tick: number;
      released: boolean;
      readonly heading: number;
    };

const ACTION_TICKS = {
  shoot: SPLASH_ZONE_SHOOT_TICKS,
  cast_wave: SPLASH_ZONE_CAST_WAVE_TICKS,
} as const;

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

/** Signed difference `a - b`, wrapped to (-π, π]. */
function angleBetween(a: number, b: number): number {
  const full = Math.PI * 2;
  let delta = (a - b) % full;
  if (delta > Math.PI) delta -= full;
  if (delta <= -Math.PI) delta += full;
  return delta;
}

/** The best cone he could throw the wave down, and how many it would catch. */
export interface WaveAim {
  readonly heading: number;
  readonly caught: number;
}

export class WaterMageKit implements MercenaryKit {
  readonly engageRadiusTiles = DEFAULT_ENGAGE_RADIUS_TILES;
  readonly leashRadiusTiles = DEFAULT_LEASH_RADIUS_TILES;
  readonly strikeRangeTiles = BOLT_RANGE_TILES;
  readonly followBand = DEFAULT_FOLLOW_BAND;

  private readonly boltDamage: number;
  private readonly waveDamage: number;
  private action: Action | null = null;
  private waveCooldown = 0;
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
   * Where each nearby hostile stood one frame ago, so a body walking at him
   * can be told from one standing off. Refreshed on every tick, whatever he is
   * doing, so the step read from it is always a single frame's: compared after
   * a whole shot, a mob's one step at the start of it would add up past the
   * per-frame threshold and look like a charge. Its own step is what is read,
   * not the gap, since he may be easing away faster than it walks.
   */
  private lastSeenAt: SeenAt[] = [];
  private seenNow: SeenAt[] = [];
  private pending: HirelingShot[] = [];

  constructor(template: MercenaryTemplate) {
    this.boltDamage = template.damage;
    this.waveDamage = template.damage * WAVE_DAMAGE_RATIO;
  }

  /** Frames until the next wave may go; zero when it is ready. For gates. */
  get waveCooldownFrames(): number {
    return this.waveCooldown;
  }

  /** Whether he is backing away from something at arm's length. For gates. */
  get isRetreating(): boolean {
    return this.retreating;
  }

  /** Whether he is easing back out to the near edge of his band. For gates. */
  get isEasingBack(): boolean {
    return this.backingOff;
  }

  tick(ctx: MercenaryKitContext): void {
    this.noteWhereHostilesStand(ctx);
    if (this.waveCooldown > 0) this.waveCooldown--;
    if (this.kiteRearm > 0) this.kiteRearm--;
    if (this.hurtTicks > 0) this.hurtTicks--;
    const hp = ctx.merc.hp;
    if (this.lastHp !== null && hp < this.lastHp) this.hurtTicks = SPLASH_ZONE_HURT_TICKS;
    this.lastHp = hp;
  }

  update(ctx: MercenaryKitContext): boolean {
    if (this.action !== null) {
      this.advanceAction(ctx, this.action);
      return true;
    }
    return this.tryWave(ctx);
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
    // A shove owns his feet; a refused step now would read as a wall.
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
    if (distancePx > TILE_SIZE * BOLT_RANGE_TILES) return false;
    if (ctx.isInSafeRoom(ctx.merc) || ctx.isInSafeRoom(target)) return false;
    return ctx.merc.canSee(target);
  }

  startAttack(ctx: MercenaryKitContext, target: Mob, _distancePx: number): void {
    const merc = ctx.merc;
    this.action = { row: 'shoot', tick: 0, released: false, victim: target };
    merc.isMoving = false;
    merc.faceToward(target);
    merc.attackCooldown = SHOT_COOLDOWN_FRAMES;
  }

  drawState(merc: Mercenary): MercenaryDrawState {
    const action = this.action;
    if (action !== null) {
      return { row: action.row, progress: action.tick / ACTION_TICKS[action.row] };
    }
    if (this.hurtTicks > 0) {
      return { row: 'hurt', progress: 1 - this.hurtTicks / SPLASH_ZONE_HURT_TICKS };
    }
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
    this.action = null;
    // Whatever HP it had before is no baseline for what it has now: a hire
    // stood up by a revive would otherwise flinch at its own fall.
    this.lastHp = null;
    this.endRetreat(0);
    this.backingOff = false;
    this.lastSeenAt = [];
    this.seenNow = [];
  }

  /**
   * The cone that would catch the most hostiles he can see within reach,
   * aimed down the bearing of one of them. Hostiles inside a safe room are not
   * counted: the water would stop at the threshold.
   */
  bestWaveAim(ctx: MercenaryKitContext): WaveAim | null {
    const merc = ctx.merc;
    const origin = centreOf(merc);
    const reachPx = TILE_SIZE * WAVE_TRIGGER_REACH_TILES;
    const bearings: number[] = [];
    for (const mob of ctx.allMobs) {
      if (mob === merc || !mob.isAlive || !mob.isHostile) continue;
      // Held out of its fight by a script, it cannot answer a blow; going for it is a free kill.
      if (mob.offLimitsToAllies) continue;
      const centre = centreOf(mob);
      const dx = centre.x - origin.x;
      const dy = centre.y - origin.y;
      if (Math.hypot(dx, dy) > reachPx) continue;
      if (ctx.isInSafeRoom(mob)) continue;
      if (!merc.hasClearLine(origin.x, origin.y, centre.x, centre.y)) continue;
      bearings.push(Math.atan2(dy, dx));
    }
    let best: WaveAim | null = null;
    for (const heading of bearings) {
      let caught = 0;
      for (const bearing of bearings) {
        if (Math.abs(angleBetween(bearing, heading)) <= WAVE_CONE_HALF_ANGLE) caught++;
      }
      if (best === null || caught > best.caught) best = { heading, caught };
    }
    return best;
  }

  private tryWave(ctx: MercenaryKitContext): boolean {
    if (this.waveCooldown > 0) return false;
    const merc = ctx.merc;
    if (ctx.isInSafeRoom(merc) || ctx.isInSafeRoom(ctx.owner)) return false;
    const aim = this.bestWaveAim(ctx);
    if (aim === null || aim.caught < WAVE_MIN_HOSTILES) return false;

    this.action = { row: 'cast_wave', tick: 0, released: false, heading: aim.heading };
    this.waveCooldown = WAVE_COOLDOWN_FRAMES;
    this.endRetreat(0);
    merc.isMoving = false;
    merc.facingX = Math.cos(aim.heading);
    merc.facingY = Math.sin(aim.heading);
    ctx.bark('special');
    return true;
  }

  private advanceAction(ctx: MercenaryKitContext, action: Action): void {
    const merc = ctx.merc;
    merc.isMoving = false;
    action.tick++;
    if (action.row === 'shoot') {
      if (!action.released && action.victim.isAlive) merc.faceToward(action.victim);
      if (!action.released && action.tick >= SPLASH_ZONE_SHOOT_RELEASE_TICK) {
        action.released = true;
        this.releaseBolt(ctx, action.victim);
      }
    } else if (!action.released && action.tick >= SPLASH_ZONE_CAST_WAVE_RELEASE_TICK) {
      action.released = true;
      this.releaseWave(ctx, action.heading);
    }
    if (action.tick >= ACTION_TICKS[action.row]) this.action = null;
  }

  /** Looses at wherever the victim stands now; a victim that died mid-draw gets the shot anyway, along the facing. */
  private releaseBolt(ctx: MercenaryKitContext, victim: Mob): void {
    const merc = ctx.merc;
    if (ctx.isInSafeRoom(merc)) return;
    const origin = centreOf(merc);
    const aim = victim.isAlive ? centreOf(victim) : null;
    const heading =
      aim === null
        ? { x: merc.facingX, y: merc.facingY }
        : normalize(aim.x - origin.x, aim.y - origin.y);
    this.pending.push({
      kind: 'bolt',
      bolt: {
        x: origin.x + heading.x * TILE_SIZE * BOLT_MUZZLE_FORWARD_TILES,
        y: origin.y + heading.y * TILE_SIZE * BOLT_MUZZLE_FORWARD_TILES,
        dirX: heading.x,
        dirY: heading.y,
        damage: this.boltDamage,
        rangePx: TILE_SIZE * BOLT_RANGE_TILES * BOLT_FLIGHT_RANGE_RATIO,
        shooter: merc,
        owner: ctx.owner,
      },
    });
    merc.attackSoundPending = true;
  }

  private releaseWave(ctx: MercenaryKitContext, heading: number): void {
    const merc = ctx.merc;
    // Checked again on release: the party may have stepped into a safe room during the cast.
    if (ctx.isInSafeRoom(merc) || ctx.isInSafeRoom(ctx.owner)) return;
    const origin = centreOf(merc);
    this.pending.push({
      kind: 'wave',
      wave: {
        originX: origin.x,
        originY: origin.y,
        heading,
        halfAngle: WAVE_CONE_HALF_ANGLE,
        reachPx: TILE_SIZE * WAVE_TRAVEL_TILES,
        damage: this.waveDamage,
        caster: merc,
        owner: ctx.owner,
      },
    });
  }

  // ── Kiting ────────────────────────────────────────────────────────────────

  /**
   * The nearest hostile at arm's length that is fighting hand to hand: one he
   * can see (a mob across a wall corner is diagonally close but cannot reach
   * him), and either in contact or still closing. A ranged mob that stands off
   * at arm's length is left to the crossbow rather than run from.
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
   * Backs away from a melee threat. Returns true while the retreat owns his
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
   * Returns true while it owns his feet this frame.
   *
   * It never gives up his line on the target: a step that would put a wall
   * between them is taken back and the ease-back ends, because walking back in
   * to find the target again and then easing back out of sight is a loop. A
   * refused step ends it too, and both wait out `KITE_REARM_FRAMES` like a
   * cornered kite, so he stands and shoots rather than grinding a wall.
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
   * @returns whether he actually moved.
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
