import type { Player } from '../../Player';
import { Mob } from '../Mob';
import {
  Fairy,
  type ActiveFairyCast,
  type FairyCast,
  type FairyCastIntent,
  type FairyPositioning,
} from './Fairy';
import type { FairyKind } from '../../sprites/art/fairyTiming';
import {
  FIRE_PREFERRED_RANGE_TILES,
  FIRE_SUPPORT_LEASH_TILES,
  FIREBALL_BLAST_DAMAGE,
  FIREBALL_BLAST_RADIUS_TILES,
  FIREBALL_COOLDOWN_FRAMES,
  FIREBALL_COOLDOWN_MIN_FRAMES,
  FIREBALL_DAMAGE,
  FIREBALL_FLIGHT_FRAMES,
  FIREBALL_FUSE_FRAMES,
  FIREBALL_MAX_RANGE_TILES,
} from './fairyTuning';

const POSITIONING: FairyPositioning = {
  preferredRangeTiles: FIRE_PREFERRED_RANGE_TILES,
  supportLeashTiles: FIRE_SUPPORT_LEASH_TILES,
  keepsSightOfCrawler: true,
};

/**
 * One fireball a fire fairy has let go of, handed to `FairyFireballSystem`.
 * Every coordinate is a world-pixel point: `from` where it leaves the fairy's
 * hands on the ground plane, `to` the landing point fixed on the release frame.
 */
export interface PendingFireball {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  /** Direct-hit damage on landing, already level-scaled. */
  readonly damage: number;
  /** The landed charge's explosion; flat, because a radial burst never scales. */
  readonly burstDamage: number;
}

const NO_FIREBALLS: readonly PendingFireball[] = [];

const NO_TARGETS: readonly Player[] = [];

/**
 * The lob, thrown the frame it is chosen. Its landing point is fixed then and
 * its blast circle marked for the whole flight, so the flight is the crawler's
 * time to step out of the circle, and the fuse after it a second chance. One
 * cast throws a ball at each crawler the fairy may lob at, on one cooldown.
 */
export const FIREBALL_CAST: FairyCast = {
  id: 'fireball',
  row: 'cast_lob',
  cooldownFrames: FIREBALL_COOLDOWN_FRAMES,
  minCooldownFrames: FIREBALL_COOLDOWN_MIN_FRAMES,
};

const FIRE_CASTS: readonly FairyCast[] = [FIREBALL_CAST];

/** Frames from a release until the charge that ball leaves has gone off. */
const THROW_LIFETIME_FRAMES = FIREBALL_FLIGHT_FRAMES + FIREBALL_FUSE_FRAMES;

/** A landing this fairy has thrown at whose ball or charge is still live. */
interface OwnLanding {
  readonly x: number;
  readonly y: number;
  framesLeft: number;
}

/** The red fairy: lobs fused fireballs, and leaves a flame patch that explodes when it dies. */
export class FireFairy extends Fairy {
  readonly kind: FairyKind = 'fire';
  protected readonly positioning = POSITIONING;
  readonly xpValue = 7;
  protected coinDropMin = 0;
  protected coinDropMax = 2;
  displayName = 'Fire Fairy';
  description = 'A crimson fairy that lobs fireballs which burn on after they land.';

  /**
   * Released throws not yet collected. Queued here and drained by
   * `FairyFireballSystem`, which owns the ball from then on: a lob kept on the
   * fairy would vanish mid-air the frame the fairy died.
   */
  private pendingFireballs: PendingFireball[] = [];

  /**
   * Where this fairy's own balls and charges will be until each goes off. A
   * crawler still standing inside one of them is already being dealt with, and
   * a second lob onto the same spot would only stack a blast they are about to
   * walk out of anyway.
   */
  private ownLandings: OwnLanding[] = [];

  /**
   * The party this frame's AI tick was handed. Held only for the length of
   * `updateAI`, because the caller reuses the array.
   */
  private party: readonly Player[] = NO_TARGETS;

  /** Hands a released throw to the fireball system. Call on the release frame. */
  protected queueFireball(fireball: PendingFireball): void {
    this.pendingFireballs.push(fireball);
  }

  /** Drains the throws released since the last call. */
  takePendingFireballs(): readonly PendingFireball[] {
    if (this.pendingFireballs.length === 0) return NO_FIREBALLS;
    const taken = this.pendingFireballs;
    this.pendingFireballs = [];
    return taken;
  }

  protected override get casts(): readonly FairyCast[] {
    return FIRE_CASTS;
  }

  override updateAI(targets: Player[]): void {
    if (this.isAlive) this.ageOwnLandings();
    this.party = targets;
    try {
      super.updateAI(targets);
    } finally {
      this.party = NO_TARGETS;
    }
  }

  /**
   * Throws a lob at the feet of the crawler the fairy is aware of or, when
   * that one is hidden or out of reach, the other living crawler: a fairy
   * that held its throw because the nearer crawler stepped behind a pillar
   * would stand idle while the other walked up to it.
   */
  protected override chooseCast(crawler: Player | null): FairyCastIntent | null {
    if (!crawler?.isAlive) return null;
    if (!this.isCastReady(FIREBALL_CAST)) return null;
    const candidates = [crawler, ...this.otherCrawlers(crawler)];
    for (const candidate of candidates) {
      const intent = this.lobAt(candidate);
      if (intent !== null) return intent;
    }
    return null;
  }

  /**
   * A lob at `target`, but only at one the fairy can see and reach. A ball
   * thrown past its range is pulled short of the reticle it was shown with,
   * and one lobbed over a wall comes from a fairy the crawler cannot see, so
   * neither telegraph would tell the truth.
   */
  private lobAt(target: Player): FairyCastIntent | null {
    const aim = crawlerCentre(target, this.tileSize);
    const origin = this.groundCentre;
    const maxRangePx = this.tileSize * FIREBALL_MAX_RANGE_TILES;
    const inRange = Math.hypot(aim.x - origin.x, aim.y - origin.y) <= maxRangePx;
    if (!inRange || !this.hasLOS(target)) return null;
    if (this.isOwnLandingAt(aim.x, aim.y)) return null;
    return { cast: FIREBALL_CAST, target, aimX: aim.x, aimY: aim.y };
  }

  /**
   * Living crawlers in the party other than `acquired`. Mongo and the
   * mercenaries are never what a lob is aimed at, a defend-quest ward is never
   * aimed at by anything, and a crawler in the town's safe zone is out of bounds.
   */
  private otherCrawlers(acquired: Player): Player[] {
    return this.party.filter(
      (member) =>
        member !== acquired &&
        member.isAlive &&
        member.isDefendTarget !== true &&
        !(member instanceof Mob) &&
        this.mayFight(member),
    );
  }

  /**
   * Throws the chosen lob and, with it, a twin at every other crawler the
   * fairy could have lobbed at this frame, each landing on that crawler's own
   * feet. The twins are chosen before any of this cast's landings is recorded,
   * so a crawler standing beside the chosen one still draws a ball of its own.
   */
  protected override onCastReleased(cast: ActiveFairyCast): void {
    if (cast.cast.id !== FIREBALL_CAST.id) return;
    const twins: FairyCastIntent[] = [];
    if (cast.target !== null) {
      for (const other of this.otherCrawlers(cast.target)) {
        const twin = this.lobAt(other);
        if (twin !== null) twins.push(twin);
      }
    }
    this.throwAt(cast.aimX, cast.aimY);
    for (const twin of twins) this.throwAt(twin.aimX, twin.aimY);
  }

  private throwAt(aimX: number, aimY: number): void {
    const from = this.groundCentre;
    this.queueFireball({
      fromX: from.x,
      fromY: from.y,
      toX: aimX,
      toY: aimY,
      damage: this.scaledDamage(FIREBALL_DAMAGE),
      burstDamage: FIREBALL_BLAST_DAMAGE,
    });
    this.ownLandings.push({ x: aimX, y: aimY, framesLeft: THROW_LIFETIME_FRAMES });
  }

  protected override clearEncounterPhase(): void {
    super.clearEncounterPhase();
    this.pendingFireballs = [];
    this.ownLandings = [];
    this.party = NO_TARGETS;
  }

  private ageOwnLandings(): void {
    if (this.ownLandings.length === 0) return;
    for (const landing of this.ownLandings) landing.framesLeft--;
    this.ownLandings = this.ownLandings.filter((landing) => landing.framesLeft > 0);
  }

  private isOwnLandingAt(x: number, y: number): boolean {
    const blastPx = this.tileSize * FIREBALL_BLAST_RADIUS_TILES;
    return this.ownLandings.some((landing) => Math.hypot(landing.x - x, landing.y - y) <= blastPx);
  }
}

/** A crawler's ground centre in world pixels: where a landing ball is measured against. */
function crawlerCentre(crawler: Player, tileSize: number): { x: number; y: number } {
  return { x: crawler.x + tileSize / 2, y: crawler.y + tileSize / 2 };
}
