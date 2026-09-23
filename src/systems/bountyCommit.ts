import type { Mob } from '../creatures/Mob';

/**
 * The shortest gap between one member of a committed bounty encounter being let
 * loose and the next.
 *
 * Above the 21-frame floor every locked telegraph in the game keeps, so two
 * members who start the same distance from the crawler — the mirrored pairs
 * every def is drawn with — land their first blows at least a reaction apart
 * rather than on one frame, and the cooldowns they share then keep them apart.
 */
export const BOUNTY_COMMIT_STAGGER_MIN_FRAMES = 30;
/**
 * The longest gap: a full second, the time a crawler who has just been hit
 * needs to answer it — a potion, a step back — before the next body arrives.
 * Small encounters get all of it.
 */
export const BOUNTY_COMMIT_STAGGER_MAX_FRAMES = 60;
/**
 * The whole stagger is shared out over this many frames, so a large group does
 * not leave its last member standing idle for most of the fight: a six-body
 * troupe is loose within three seconds. Only the minimum gap can stretch it.
 */
export const BOUNTY_COMMIT_SPREAD_FRAMES = 180;

/** The gap between members for a group of `memberCount` living members. */
export function bountyCommitStaggerFrames(memberCount: number): number {
  const gaps = Math.max(1, memberCount - 1);
  const shared = Math.floor(BOUNTY_COMMIT_SPREAD_FRAMES / gaps);
  return Math.min(
    BOUNTY_COMMIT_STAGGER_MAX_FRAMES,
    Math.max(BOUNTY_COMMIT_STAGGER_MIN_FRAMES, shared),
  );
}

/**
 * A bounty encounter going from leashed to committed, one member at a time.
 *
 * Letting the whole group loose on one frame is what turned a formation into a
 * single blow: a mirrored pair of escorts reaches a crawler on the frame and
 * swings on the frame, and two blows that each leave her a quarter of her bar
 * land as one that kills from full. So the member that noticed first goes at
 * once and the rest follow in encounter order, a stagger apart. A member that is
 * struck while it waits goes immediately: holding still under a beating reads
 * as broken, not as tactics.
 */
export class StaggeredCommit {
  private framesSinceCommit = 0;
  private readonly releaseFrame = new Map<Mob, number>();
  private readonly lastReleaseFrame: number;

  constructor(encounter: readonly Mob[]) {
    // The dead take no turn, or a pack thinned before it committed would
    // still wait out the gaps of members who are no longer there.
    const living = encounter.filter((mob) => mob.isAlive);
    const firstToNotice = living.find((mob) => mob.currentTarget !== null);
    const order = firstToNotice === undefined ? [] : [firstToNotice];
    for (const mob of living) if (mob !== firstToNotice) order.push(mob);
    const stagger = bountyCommitStaggerFrames(order.length);
    order.forEach((mob, place) => {
      const releaseAt = place * stagger;
      this.releaseFrame.set(mob, releaseAt);
      if (releaseAt > 0) mob.aiHeld = true;
    });
    this.lastReleaseFrame = Math.max(0, order.length - 1) * stagger;
  }

  /** True once every member has been let loose. */
  get isComplete(): boolean {
    return this.framesSinceCommit >= this.lastReleaseFrame;
  }

  /** Advances one frame and lets loose every member whose turn has come or who was struck. */
  tick(): void {
    if (this.isComplete) return;
    this.framesSinceCommit++;
    for (const [mob, releaseAt] of this.releaseFrame) {
      if (!mob.aiHeld) continue;
      const wasStruck = mob.hp < mob.maxHp;
      if (this.framesSinceCommit >= releaseAt || wasStruck) mob.aiHeld = false;
    }
  }

  /** Lets every member loose at once, for when the encounter is torn down mid-stagger. */
  releaseAll(): void {
    for (const mob of this.releaseFrame.keys()) mob.aiHeld = false;
    this.framesSinceCommit = this.lastReleaseFrame;
  }
}

/**
 * A bounty encounter's commitment to the fight, run once a frame.
 *
 * Once anything in the group has a target the whole group commits: the leashes
 * come off and every member hunts the party anywhere, town included, let loose
 * through a {@link StaggeredCommit}. The commitment is re-asserted every frame
 * rather than once: a safe-room checkpoint restore runs `resetToSpawn()` on
 * every hostile mob, which clears `forceAggro`, and out on the overworld there
 * is no boss room to put it back.
 */
export class EncounterCommitment {
  private commit: StaggeredCommit | null = null;

  get hasCommitted(): boolean {
    return this.commit !== null;
  }

  /** @returns true on the one frame the group commits. */
  update(encounter: readonly Mob[]): boolean {
    let justCommitted = false;
    if (this.commit === null) {
      if (!encounter.some((mob) => mob.isAlive && mob.currentTarget !== null)) return false;
      this.commit = new StaggeredCommit(encounter);
      justCommitted = true;
    }
    this.commit.tick();
    for (const mob of encounter) {
      if (!mob.isAlive) continue;
      mob.forceAggro = true;
      mob.homePoint = undefined;
      mob.leashRadiusTiles = undefined;
    }
    return justCommitted;
  }

  /** Drops the commitment, letting loose anyone still waiting their turn. */
  release(): void {
    this.commit?.releaseAll();
    this.commit = null;
  }
}
