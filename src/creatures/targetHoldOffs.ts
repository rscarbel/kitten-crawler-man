import type { Mob } from './Mob';

/** How long a target with no route to it stays held off. */
export const NO_ROUTE_FORGET_FRAMES = 180;
/** Frames of a chase covering no ground before the chaser writes the target off. */
export const CHASE_STALL_LIMIT_FRAMES = 45;
/** An owner-distance no mob can be inside, for holds that must run their full term. */
const NO_EARLY_LIFT = -1;

/**
 * A mob held off a companion's target list, and the ways the hold ends.
 *
 * `liftAtOwnerDistancePx` is what makes a hold safe to apply to a mob that may
 * yet come to the party: rather than guess from proxies whether it will, the
 * mob answers with its feet — closing on the owner is what a mob in a fight
 * does, and one sitting out past a detour never will.
 */
interface TargetHold {
  framesLeft: number;
  /**
   * Owner-distance at which the hold lifts early, in pixels. Negative for a
   * hold that only ever expires — there is no route to that mob, so it walking
   * closer would just restart the grinding this recorded.
   */
  liftAtOwnerDistancePx: number;
  /**
   * Whether a mob attacking the party has already spent its one free attempt
   * at this hold, and must now serve the full term like anything else.
   *
   * A hold is a claim that the companion cannot get to something, and a mob
   * that has walked up to the party has disproved the version of that claim
   * which said "it is over there". So a party threat is let through — but
   * exactly once, and this is what makes "once" true. Ungated, the exemption
   * and the hold feed each other every single frame: the companion re-acquires
   * the mob, the search fails, the hold is set again, and the next frame the
   * exemption deletes it. That is a full A* search per frame for as long as
   * the mob lives, and it pins the companion on a chase it cannot finish.
   */
  refusesPartyThreatLift: boolean;
}

/** What a candidate is to the companion asking whether it may pick it. */
export interface HoldOffQuery {
  /** Centre-to-centre distance from the companion's owner to the mob, in pixels. */
  readonly ownerDistancePx: number;
  /** Whether the mob is fighting the party, which spends the hold's one free pass. */
  readonly partyThreat: boolean;
  /**
   * Whether the companion could hit it from where it stands without walking,
   * which no claim about routes can stand against. Lifts the hold outright.
   */
  readonly inReach: boolean;
}

/**
 * The mobs a companion may not pick right now, and the chase-stall count that
 * decides when a chase is hopeless — the shared part of how Mongo and a
 * hireling give up on a target they cannot get to.
 *
 * A failed A* search makes `followTargetAStar` fall back to a straight-line
 * walk, so a mob sealed behind a wall does not read as unreachable — it reads
 * as the companion grinding into the masonry between them. And a target that
 * has broken line of sight leaves the chase aimed at its last known position,
 * a perfectly routable tile: the search succeeds, the companion walks there
 * and stops, and nothing about that is a pathfinding failure. The stall count
 * catches the second; the caller checks `astarSearchFailed` for the first.
 * Every hold expires: doors open, walls come down, and the owner moves the
 * whole frame of reference.
 */
export class TargetHoldOffs {
  private readonly holds = new Map<Mob, TargetHold>();
  /**
   * Every mob this scan let past its hold for fighting the party.
   *
   * A set rather than "the last one": a scan can exempt more than one
   * candidate, and recording only the most recent forgets an attempt spent on
   * a mob the scan did not end up choosing — the shape of near-miss that turns
   * the exemption into a per-frame A* lap. Cleared by {@link beginScan}.
   */
  private readonly partyThreatExemptionsUsed = new Set<Mob>();
  /**
   * The mob being chased, and whether the chase began on its exemption.
   *
   * Kept for the life of the chase rather than read from the scan: a chase
   * gives up long after the scan that let it start — two stalls, or a search
   * the per-frame budget put off — and by then every later scan has cleared
   * its exemptions. Read from the scan alone, the new hold would forget the
   * attempt was spent and grant it again, for ever.
   */
  private chaseTarget: Mob | null = null;
  private chaseBeganOnExemption = false;
  private stallFrames = 0;

  /** Counts every hold down a frame, dropping the expired and the dead. */
  tick(): void {
    for (const [mob, hold] of this.holds) {
      if (hold.framesLeft <= 1 || !mob.isAlive) this.holds.delete(mob);
      else hold.framesLeft--;
    }
  }

  /** Starts a target scan; a hold set later this frame reads only this scan's exemptions. */
  beginScan(): void {
    this.partyThreatExemptionsUsed.clear();
  }

  /** Whether `mob` is held off, without spending or lifting anything. */
  isHeld(mob: Mob): boolean {
    return this.holds.has(mob);
  }

  /**
   * Whether `mob` may be picked, lifting its hold when the mob has disproved
   * it: in reach, close enough to the owner, or fighting the party for the
   * first time since the hold was set.
   */
  admits(mob: Mob, query: HoldOffQuery): boolean {
    const hold = this.holds.get(mob);
    if (hold === undefined) return true;
    const exempt = query.partyThreat && !hold.refusesPartyThreatLift;
    const holdStands =
      !exempt && !query.inReach && query.ownerDistancePx > hold.liftAtOwnerDistancePx;
    if (holdStands) return false;
    if (exempt) this.partyThreatExemptionsUsed.add(mob);
    this.holds.delete(mob);
    return true;
  }

  /** Starts a chase on `target` (null for none), with a fresh stall count. */
  beginChase(target: Mob | null): void {
    this.chaseTarget = target;
    this.chaseBeganOnExemption = target !== null && this.partyThreatExemptionsUsed.has(target);
    this.stallFrames = 0;
  }

  /**
   * The chase reached the target — in strike range of it, or a blow started.
   * A retry that got that far was not spent on a hopeless chase, so a route
   * failure afterwards (a knockback, a door shut behind it) leaves the mob
   * its free pass for the next time it goes for the party.
   */
  noteChaseConnected(): void {
    this.chaseBeganOnExemption = false;
  }

  /** Holds off a mob there is no way to, for the full term. */
  holdOffUnreachable(mob: Mob): void {
    const spentOnThisChase = mob === this.chaseTarget && this.chaseBeganOnExemption;
    this.holds.set(mob, {
      framesLeft: NO_ROUTE_FORGET_FRAMES,
      liftAtOwnerDistancePx: NO_EARLY_LIFT,
      // Only if the exemption is what let it be tried in the first place. Keyed
      // on the exemption having been *used* rather than on the mob being a
      // party threat now: a mob held for the first time has no prior hold for
      // the exemption to have lifted, and marking it as having spent an attempt
      // it was never granted would refuse to peel the mob biting the owner for
      // the full term — the behaviour the exemption exists to prevent.
      refusesPartyThreatLift: spentOnThisChase || this.partyThreatExemptionsUsed.has(mob),
    });
    if (mob === this.chaseTarget) this.beginChase(null);
    this.stallFrames = 0;
  }

  /**
   * Holds off a mob there is nothing wrong with — the companion simply cannot
   * have it and stay with its owner — until it comes within
   * `liftAtOwnerDistancePx` of the owner or `frames` run out.
   */
  holdOffUntilCloser(mob: Mob, frames: number, liftAtOwnerDistancePx: number): void {
    this.holds.set(mob, {
      framesLeft: frames,
      liftAtOwnerDistancePx,
      refusesPartyThreatLift: false,
    });
    this.stallFrames = 0;
  }

  /** Records one frame of the chase: `stalled` when it got the companion nowhere. */
  noteChaseFrame(stalled: boolean): void {
    this.stallFrames = stalled ? this.stallFrames + 1 : 0;
  }

  resetStall(): void {
    this.stallFrames = 0;
  }

  /** Whether the chase has gone nowhere for longer than {@link CHASE_STALL_LIMIT_FRAMES}. */
  get chaseStalled(): boolean {
    return this.stallFrames > CHASE_STALL_LIMIT_FRAMES;
  }
}
