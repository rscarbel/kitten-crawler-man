/**
 * Falling back during a fight: `kite` (back off toward a friend so the player
 * follows into two enemies) and `regroup` (a wounded mob walks over to a friend
 * and re-engages beside it).
 *
 * Both are the same bounded walk — a frame cap, a walked-distance cap, a stall
 * check and a hazard check, any of which ends it — and differ only in how the
 * walk is planned and where it is heading. Neither ever raises the mob's
 * speed: the creature walks the returned point at its own pace, and never
 * faster than `TACTICAL_RETREAT_MAX_SPEED` while falling back, so a player who
 * chases a kiter catches it.
 */

import type { Mob } from '../Mob';
import { collectPackmates } from '../packAlert';
import { isMarkedGround } from './markedGround';
import {
  distanceBetween,
  hasClearLine,
  isEngagedInFight,
  isOpenWalk,
  isOutsideLeash,
  walkStaysLeashed,
  type KiteAim,
  type TacticalFrame,
  type TacticalMove,
  type TacticalPoint,
} from './tacticalFrame';

// ── Kite ───────────────────────────────────────────────────────────────────

/**
 * How far past its own reach the player may be for a kite to start, in tiles.
 * A kite is an answer to trading blows, so it only begins close in.
 */
export const KITE_TRIGGER_MARGIN_TILES = 1;
/** How far away a friend can be and still be worth falling back on, in tiles. */
export const KITE_HELPER_RADIUS_TILES = 7;
/**
 * A friend already this close, in tiles, is fighting beside the mob; backing
 * toward it would only step away from the player for nothing.
 */
export const KITE_MIN_HELPER_GAP_TILES = 1.5;
/**
 * Weight of "away from the player" against "toward the friend" in the melee
 * retreat direction. Below one so the friend still decides where the fight
 * moves; above zero so a friend off to one side draws the kiter away from the
 * player rather than across its front. It does not cancel a friend standing
 * beyond the player — that aim still points at the player, and it is
 * {@link walkKeepsClearOf} that refuses it.
 */
export const KITE_AWAY_FROM_TARGET_WEIGHT = 0.75;
/** The longest a single kite lasts, in frames, before the mob commits and attacks. */
export const KITE_MAX_FRAMES = 90;
/** The furthest a single kite walks, in tiles, before the mob commits and attacks. */
export const KITE_MAX_DISTANCE_TILES = 3;
/** Frames after a kite ends before the same mob may start another. */
export const KITE_COOLDOWN_FRAMES = 300;
/**
 * Frames to wait after a kite could not be planned before asking again, so a
 * mob with nowhere to go fights on rather than re-searching every frame.
 */
export const KITE_RETRY_FRAMES = 20;

// ── Regroup ────────────────────────────────────────────────────────────────

/** At or below this share of its max HP, a mob with `regroup` looks for a friend. */
export const REGROUP_HP_FRACTION = 0.4;
/** How far away a friend can be and still be regrouped on, in tiles. */
export const REGROUP_ALLY_RADIUS_TILES = 6;
/** How close to the friend, in tiles, counts as having regrouped. */
export const REGROUP_JOIN_TILES = 1.25;
/** The longest a regroup lasts, in frames, before the mob turns and fights anyway. */
export const REGROUP_MAX_FRAMES = 120;
/** The furthest a regroup walks, in tiles, which is also what bounds it inside a leash. */
export const REGROUP_MAX_DISTANCE_TILES = 6;
/** Frames to wait after finding no friend to regroup on before looking again. */
export const REGROUP_RETRY_FRAMES = 30;

// ── The walk itself ────────────────────────────────────────────────────────

/** Within this many tiles of its point, a retreat has arrived. */
const RETREAT_ARRIVED_TILES = 0.25;
/**
 * Consecutive frames of standing still that end a retreat. Its walk is
 * measured in pixels rather than read from `isMoving`, which is also true for
 * a mob grinding into a wall — and a retreat into a wall must never become a
 * standing order the mob can never carry out.
 */
const RETREAT_STALL_FRAMES = 12;
/** Pixels a frame must cover to count as walking rather than grinding. */
const RETREAT_STALL_STEP_PX = 0.25;
/** How far ahead of the mob, in tiles, a retreat looks for marked ground. */
const RETREAT_HAZARD_LOOKAHEAD_TILES = 1;
/**
 * How near, in tiles, a falling-back mob may come to the player it is falling
 * back from. One tile is where the mob-versus-player separation starts
 * shoving the player; the other half is the mob's own body and a frame's step.
 * A mob already nearer than this — a brawler in melee — may only walk so that
 * it never gets nearer than it started.
 */
export const RETREAT_PLAYER_CLEARANCE_TILES = 1.5;
/**
 * How far, in pixels, a walk may graze inside its clearance and still count as
 * clear. Without it a friend standing a pixel off square beside a brawler in
 * melee would shut the walk to it: every walk to it closes on the player by a
 * few thousandths of a pixel. Kept under one: a brawler starts in contact,
 * where the mob-versus-player separation holds the gap by moving the player,
 * so every pixel a walk dips is paid for by shoving them the length of it.
 */
const RETREAT_CLEARANCE_GRAZE_PX = 0.25;

/** Why a retreat ended, for the creature and the gate to read. */
export type RetreatEnd =
  'arrived' | 'frame-cap' | 'distance-cap' | 'hazard' | 'stalled' | 'lost' | 'crowded';

/** The nearest a straight walk from `from` to `to` comes to `point`. */
function closestApproach(from: TacticalPoint, to: TacticalPoint, point: TacticalPoint): number {
  const walkX = to.x - from.x;
  const walkY = to.y - from.y;
  const walkLengthSq = walkX * walkX + walkY * walkY;
  if (walkLengthSq === 0) return distanceBetween(from, point);
  const along = ((point.x - from.x) * walkX + (point.y - from.y) * walkY) / walkLengthSq;
  const clamped = Math.min(1, Math.max(0, along));
  return distanceBetween({ x: from.x + walkX * clamped, y: from.y + walkY * clamped }, point);
}

/** The nearest a mob starting at `self` may come to `target` while falling back. */
function clearanceFloor(self: TacticalPoint, target: TacticalPoint, tileSize: number): number {
  const nearest = Math.min(
    distanceBetween(self, target),
    RETREAT_PLAYER_CLEARANCE_TILES * tileSize,
  );
  return nearest - RETREAT_CLEARANCE_GRAZE_PX;
}

/**
 * Whether a straight walk from where the mob stands to `end` keeps clear of
 * the player: never inside {@link RETREAT_PLAYER_CLEARANCE_TILES}, or, for a
 * mob already inside it, never nearer than it starts. Ending no nearer is not
 * enough — a walk long enough can pass straight through the player and out
 * the far side, shoving the player along ahead of it.
 */
export function walkKeepsClearOf(frame: TacticalFrame, end: TacticalPoint): boolean {
  const { self, target, tileSize } = frame;
  return closestApproach(self, end, target) >= clearanceFloor(self, target, tileSize);
}

/** A kite or regroup in progress. */
export class Retreat {
  private frames = 0;
  private walkedPx = 0;
  private lastX: number;
  private lastY: number;
  private stallFrames = 0;

  constructor(
    readonly behaviour: 'kite' | 'regroup',
    self: Mob,
    private readonly destination: TacticalPoint,
    /** The friend a regroup walks to; the kite's destination is fixed instead. */
    private readonly ally: Mob | null,
    private readonly maxFrames: number,
    private readonly maxWalkPx: number,
    private readonly stopPx: number,
  ) {
    this.lastX = self.x;
    this.lastY = self.y;
  }

  /** Frames this retreat has actually walked, for `?difficulty`'s average kite length. */
  get framesElapsed(): number {
    return this.frames;
  }

  /**
   * Account for the frame just walked and decide this frame's step, or why the
   * retreat is over. Every way out is checked before a step is handed back, so
   * a retreat can never outlast its caps by more than the frame that hit them.
   */
  advance(frame: TacticalFrame): TacticalMove | RetreatEnd {
    const { self, tileSize } = frame;
    const previous = { x: this.lastX, y: this.lastY };
    const stepPx = Math.hypot(self.x - this.lastX, self.y - this.lastY);
    this.walkedPx += stepPx;
    this.lastX = self.x;
    this.lastY = self.y;
    this.stallFrames = stepPx < RETREAT_STALL_STEP_PX ? this.stallFrames + 1 : 0;

    if (this.frames >= this.maxFrames) return 'frame-cap';
    if (this.walkedPx >= this.maxWalkPx) return 'distance-cap';
    if (this.frames > 0 && this.stallFrames >= RETREAT_STALL_FRAMES) return 'stalled';
    if (isOutsideLeash(self, tileSize)) return 'lost';

    const destination = this.currentDestination();
    if (destination === null) return 'lost';
    const remaining = distanceBetween(self, destination);
    if (remaining <= this.stopPx + RETREAT_ARRIVED_TILES * tileSize) return 'arrived';

    const lookahead = Math.min(remaining, RETREAT_HAZARD_LOOKAHEAD_TILES * tileSize);
    const aheadX = self.x + ((destination.x - self.x) / remaining) * lookahead;
    const aheadY = self.y + ((destination.y - self.y) / remaining) * lookahead;
    if (isMarkedGround(self.x, self.y) || isMarkedGround(aheadX, aheadY)) return 'hazard';
    // Planned clear of the player, but a regroup follows a friend who moves
    // and a player can step into the way. Judged on the mob's own movement —
    // the step it just took, and the one it is about to — never on the gap,
    // which the player controls: a player who follows a kiter closes that gap
    // every frame, and chasing is exactly what a kite invites. Both steps are
    // measured against where the player stands now, so a mob creeping a
    // fraction closer each frame is caught on the frame it does it.
    const ahead = { x: aheadX, y: aheadY };
    const target = frame.target;
    const steppedCloser =
      this.frames > 0 && distanceBetween(self, target) < clearanceFloor(previous, target, tileSize);
    const aboutToClose = distanceBetween(ahead, target) < clearanceFloor(self, target, tileSize);
    if (steppedCloser || aboutToClose) return 'crowded';

    this.frames++;
    return {
      behaviour: this.behaviour,
      x: destination.x,
      y: destination.y,
      stopPx: this.stopPx,
      breaksOff: true,
    };
  }

  private currentDestination(): TacticalPoint | null {
    if (this.ally === null) return this.destination;
    return isEngagedInFight(this.ally) ? this.ally : null;
  }
}

/** Scratch list reused across plans so asking for friends allocates nothing. */
const packmatesScratch: Mob[] = [];

/**
 * Whether `ally` is a friend a retreat can fall back on: alive, in the fight
 * itself, and not already falling back — two mobs each backing toward the
 * other would walk the whole fight away from the player.
 */
function canBeLeanedOn(ally: Mob): boolean {
  return isEngagedInFight(ally) && !ally.tactics.isRetreating;
}

/**
 * The melee kite: back off toward the friend, leaning away from the player.
 *
 * A friend standing beyond the player leaves this aim pointing at the player;
 * the planner refuses any walk that heads toward the player or passes near
 * them, and tries sideways instead.
 */
export const retreatTowardHelper: KiteAim = (self, target, helper) => {
  const toHelperX = helper.x - self.x;
  const toHelperY = helper.y - self.y;
  const helperDistance = Math.hypot(toHelperX, toHelperY);
  const awayX = self.x - target.x;
  const awayY = self.y - target.y;
  const awayDistance = Math.hypot(awayX, awayY);
  if (helperDistance === 0) return self;
  const awayWeight = awayDistance === 0 ? 0 : KITE_AWAY_FROM_TARGET_WEIGHT / awayDistance;
  const dirX = toHelperX / helperDistance + awayX * awayWeight;
  const dirY = toHelperY / helperDistance + awayY * awayWeight;
  const dirLength = Math.hypot(dirX, dirY);
  if (dirLength === 0) return self;
  return {
    x: self.x + (dirX / dirLength) * helperDistance,
    y: self.y + (dirY / dirLength) * helperDistance,
  };
};

/**
 * How far past its friend, in tiles, a ranged kiter aims to stand: far enough
 * that the friend's body is squarely in the player's way, near enough that the
 * shot back over it is still well inside a bow's or a spit's range.
 */
export const KITE_SCREEN_DEPTH_TILES = 1.5;

/**
 * The ranged kite: fall back to a point just behind the friend, on the far
 * side from the player, so the friend stands between the two and the player
 * has to go through it to reach the shooter.
 *
 * Shared by every ranged creature. A friend standing on the player's own side
 * puts that point beyond the player; the planner refuses a walk that heads
 * toward the player or passes near them and falls back to sideways, exactly
 * as it does for a melee aim.
 */
export const retreatBehindHelper: KiteAim = (_self, target, helper, tileSize) => {
  const screenX = helper.x - target.x;
  const screenY = helper.y - target.y;
  const screenLength = Math.hypot(screenX, screenY);
  if (screenLength === 0) return helper;
  const depthPx = KITE_SCREEN_DEPTH_TILES * tileSize;
  return {
    x: helper.x + (screenX / screenLength) * depthPx,
    y: helper.y + (screenY / screenLength) * depthPx,
  };
};

/** The nearest friend a kite could fall back on, or null when there is none. */
function findKiteHelper(frame: TacticalFrame): Mob | null {
  const { self, tileSize, target, map } = frame;
  collectPackmates(self, KITE_HELPER_RADIUS_TILES * tileSize, packmatesScratch);
  let best: Mob | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const minGapPx = KITE_MIN_HELPER_GAP_TILES * tileSize;
  for (const ally of packmatesScratch) {
    if (!canBeLeanedOn(ally)) continue;
    const distance = distanceBetween(self, ally);
    if (distance < minGapPx || distance >= bestDistance) continue;
    // A friend that cannot see the player cannot join in; the kite would only
    // be the mob walking out of the fight.
    if (!hasClearLine(map, tileSize, ally, target)) continue;
    best = ally;
    bestDistance = distance;
  }
  packmatesScratch.length = 0;
  return best;
}

/**
 * The end of the kite's walk when aiming at `aim`: clamped to the distance cap,
 * and accepted only if the walk there is open, never heads toward the player,
 * and keeps clear of them all the way.
 */
function acceptKiteEnd(frame: TacticalFrame, aim: TacticalPoint): TacticalPoint | null {
  const { self, tileSize, target, map } = frame;
  const maxPx = KITE_MAX_DISTANCE_TILES * tileSize;
  const aimDistance = distanceBetween(self, aim);
  if (aimDistance === 0) return null;
  const reach = Math.min(aimDistance, maxPx);
  const end = {
    x: self.x + ((aim.x - self.x) / aimDistance) * reach,
    y: self.y + ((aim.y - self.y) / aimDistance) * reach,
  };
  if (headsToward(self, end, target)) return null;
  if (!walkKeepsClearOf(frame, end)) return null;
  if (!isOpenWalk(map, tileSize, self, end)) return null;
  return end;
}

/** Whether walking from `self` to `end` makes any headway toward `target`. */
function headsToward(self: TacticalPoint, end: TacticalPoint, target: TacticalPoint): boolean {
  return (end.x - self.x) * (target.x - self.x) + (end.y - self.y) * (target.y - self.y) > 0;
}

/**
 * Plan a kite for this frame, or null when the mob should stand and fight.
 *
 * Every precondition is required: the mob has drawn or shed blood, the player
 * is close, a friend who is also fighting and can see the player is near, and
 * the whole walk fits inside the leash. With no such friend — the last one
 * standing — it never kites. When the way toward the friend is shut it tries
 * each side; when both are shut it fights.
 */
export function planKite(frame: TacticalFrame): Retreat | null {
  const { self, tileSize, target, attackRangePx } = frame;
  if (!frame.canBreakOff || !isEngagedInFight(self)) return null;
  if (distanceBetween(self, target) > attackRangePx + KITE_TRIGGER_MARGIN_TILES * tileSize) {
    return null;
  }
  const maxWalkPx = KITE_MAX_DISTANCE_TILES * tileSize;
  if (!walkStaysLeashed(self, tileSize, maxWalkPx)) return null;
  const helper = findKiteHelper(frame);
  if (helper === null) return null;

  const aim = frame.kiteAim(self, target, helper, tileSize);
  const straight = acceptKiteEnd(frame, aim);
  const end = straight ?? acceptSideways(frame, aim);
  if (end === null) return null;
  return new Retreat('kite', self, end, null, KITE_MAX_FRAMES, maxWalkPx, 0);
}

/** Try both perpendiculars to a refused aim, the one further from the player first. */
function acceptSideways(frame: TacticalFrame, aim: TacticalPoint): TacticalPoint | null {
  const { self, target, tileSize } = frame;
  const aimIsDegenerate = aim.x === self.x && aim.y === self.y;
  const base = aimIsDegenerate ? awayFrom(self, target, tileSize) : aim;
  const dx = base.x - self.x;
  const dy = base.y - self.y;
  const left = { x: self.x - dy, y: self.y + dx };
  const right = { x: self.x + dy, y: self.y - dx };
  const leftIsFurther = distanceBetween(left, target) >= distanceBetween(right, target);
  const first = leftIsFurther ? left : right;
  const second = leftIsFurther ? right : left;
  return acceptKiteEnd(frame, first) ?? acceptKiteEnd(frame, second);
}

/** A point one kite-length straight away from `target`, for when the aim cancelled out. */
function awayFrom(self: TacticalPoint, target: TacticalPoint, tileSize: number): TacticalPoint {
  const dx = self.x - target.x;
  const dy = self.y - target.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return self;
  const reach = KITE_MAX_DISTANCE_TILES * tileSize;
  return { x: self.x + (dx / length) * reach, y: self.y + (dy / length) * reach };
}

// ── Regroup planning ───────────────────────────────────────────────────────

/** Whether `self` is hurt enough to look for a friend. */
export function isWoundedEnoughToRegroup(self: Mob): boolean {
  return self.maxHp > 0 && self.hp / self.maxHp <= REGROUP_HP_FRACTION;
}

/**
 * Plan a regroup, or null when there is nobody to regroup on — in which case
 * the mob fights on where it stands. Regroup is not fleeing.
 *
 * With a {@link TacticalFrame.regroupAim}, the walk goes to that aim's point
 * rather than to the friend, clamped to the regroup's distance cap and taken
 * only if the way is open and never heads toward the player: a shooter
 * regroups behind its friend, never into the fight. Without one, the mob
 * walks up to the friend itself — but only to a friend it can reach in a
 * straight line that keeps clear of the player, never one beyond them.
 */
export function planRegroup(frame: TacticalFrame): Retreat | null {
  const { self, tileSize, map } = frame;
  if (!frame.canBreakOff || !isEngagedInFight(self) || !isWoundedEnoughToRegroup(self)) {
    return null;
  }
  const maxWalkPx = REGROUP_MAX_DISTANCE_TILES * tileSize;
  if (!walkStaysLeashed(self, tileSize, maxWalkPx)) return null;
  const joinPx = REGROUP_JOIN_TILES * tileSize;
  collectPackmates(self, REGROUP_ALLY_RADIUS_TILES * tileSize, packmatesScratch);
  let best: Mob | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAimedEnd: TacticalPoint | null = null;
  for (const ally of packmatesScratch) {
    if (!canBeLeanedOn(ally)) continue;
    const distance = distanceBetween(self, ally);
    if (distance <= joinPx || distance >= bestDistance) continue;
    let aimedEnd: TacticalPoint | null = null;
    if (frame.regroupAim !== undefined) {
      aimedEnd = acceptRegroupEnd(frame, frame.regroupAim(self, frame.target, ally, tileSize));
      if (aimedEnd === null) continue;
    } else if (!isOpenWalk(map, tileSize, self, ally) || !walkKeepsClearOf(frame, ally)) {
      // A friend on the player's far side is reached only through the player.
      continue;
    }
    best = ally;
    bestDistance = distance;
    bestAimedEnd = aimedEnd;
  }
  packmatesScratch.length = 0;
  if (best === null) return null;
  if (bestAimedEnd !== null) {
    return new Retreat('regroup', self, bestAimedEnd, null, REGROUP_MAX_FRAMES, maxWalkPx, 0);
  }
  return new Retreat('regroup', self, best, best, REGROUP_MAX_FRAMES, maxWalkPx, joinPx);
}

/**
 * The end of an aimed regroup's walk: clamped to the regroup's distance cap,
 * and accepted only if the walk there is open and never heads toward the
 * player. Ending no closer is not enough: a regroup is long enough to swing
 * round the player to reach the far side of a friend, passing within reach
 * on the way.
 */
function acceptRegroupEnd(frame: TacticalFrame, aim: TacticalPoint): TacticalPoint | null {
  const { self, tileSize, target, map } = frame;
  const aimDistance = distanceBetween(self, aim);
  if (aimDistance === 0) return null;
  const reach = Math.min(aimDistance, REGROUP_MAX_DISTANCE_TILES * tileSize);
  const end = {
    x: self.x + ((aim.x - self.x) / aimDistance) * reach,
    y: self.y + ((aim.y - self.y) / aimDistance) * reach,
  };
  if (headsToward(self, end, target)) return null;
  if (!isOpenWalk(map, tileSize, self, end)) return null;
  return end;
}
