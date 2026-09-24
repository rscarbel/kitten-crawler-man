import type { Mob } from '../Mob';
import type { Player } from '../../Player';
import { isInPublishedRoster } from '../packAlert';
import { drawWardGlyph } from '../../sprites/art/fairyEffectsArt';
import {
  Fairy,
  type ActiveFairyCast,
  type FairyCast,
  type FairyCastIntent,
  type FairyPositioning,
} from './Fairy';
import type { FairyKind } from '../../sprites/art/fairyTiming';
import { applyFairyWardFrom, canTakeWardFrom, isWardedBy } from './fairyWards';
import { shieldWardsAtPotency } from './fairyPotency';
import {
  FAIRY_CAST_RECOVER_FRAMES,
  SHIELD_BETWEEN_CASTS_FRAMES,
  SHIELD_BETWEEN_CASTS_MIN_FRAMES,
  SHIELD_CAST_RANGE_TILES,
  SHIELD_ENGAGED_RECENT_FRAMES,
  SHIELD_PREFERRED_RANGE_TILES,
  SHIELD_SUPPORT_LEASH_TILES,
} from './fairyTuning';

const POSITIONING: FairyPositioning = {
  preferredRangeTiles: SHIELD_PREFERRED_RANGE_TILES,
  supportLeashTiles: SHIELD_SUPPORT_LEASH_TILES,
};

/**
 * The one spell, laid the frame it is chosen. Its cooldown is the short gap
 * between any two casts.
 */
export const WARD_CAST: FairyCast = {
  id: 'ward',
  row: 'cast_ward',
  cooldownFrames: SHIELD_BETWEEN_CASTS_FRAMES,
  minCooldownFrames: SHIELD_BETWEEN_CASTS_MIN_FRAMES,
};

const SHIELD_CASTS: readonly FairyCast[] = [WARD_CAST];

/** Height above the warded ally's ground point at which its glyph forms, in tiles. */
const GLYPH_LIFT_TILES = 0.25;

/** Range of the per-fairy seed that keeps two fairies' glyph jitter out of step. */
const GLYPH_SEED_RANGE = 1000;

/** Priority order: lower sorts first. */
const ENGAGED_RANK = 0;
const BOSS_RANK = 1;
const OTHER_RANK = 2;

interface WardCandidate {
  readonly mob: Mob;
  readonly rank: number;
  readonly distance: number;
}

/** Sorts engaged allies first, then bosses, then the nearest. */
function compareCandidates(a: WardCandidate, b: WardCandidate): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.distance - b.distance;
}

/** Whether `ally` is in the fight with the party right now, rather than merely nearby. */
function isEngagedWithParty(ally: Mob): boolean {
  if (ally.currentTarget?.isCrawler === true) return true;
  if (ally.framesSinceStruckPlayer < SHIELD_ENGAGED_RECENT_FRAMES) return true;
  return ally.wasDamagedByParty;
}

/**
 * The blue fairy: wards its allies into invulnerability for as long as it
 * lives, and chains a damage-reduction aegis to them when it dies.
 */
export class ShieldFairy extends Fairy {
  readonly kind: FairyKind = 'shield';
  protected readonly positioning = POSITIONING;
  readonly xpValue = 6;
  protected coinDropMin = 0;
  protected coinDropMax = 2;
  displayName = 'Shield Fairy';
  description =
    'A cobalt fairy whose ward makes its allies untouchable. Kill it and every ward falls.';

  /**
   * Every mob this fairy holds a ward on. Kept here rather than rebuilt from
   * `allies`, because a warded goblin that chases the crawler out of the search
   * radius still holds a ward and still counts against {@link wardCount}.
   */
  protected readonly warded: Mob[] = [];

  /** The ally the last ward was laid on, for the glyph drawn while the cast row plays out. */
  private glyphTarget: Mob | null = null;

  private readonly glyphSeed = Math.floor(Math.random() * GLYPH_SEED_RANGE);

  protected override get casts(): readonly FairyCast[] {
    return SHIELD_CASTS;
  }

  /** How many wards this fairy holds at once: one more than its stamped potency. */
  get wardCount(): number {
    return shieldWardsAtPotency(this.potencyCount);
  }

  /** Mobs this fairy currently holds a ward on. */
  get wardedAllies(): readonly Mob[] {
    return this.warded;
  }

  override updateAI(targets: Player[]): void {
    if (this.isAlive) this.forgetLostWards();
    super.updateAI(targets);
  }

  /**
   * Whether the player can see this fairy cast: every ward waits for it, the
   * first as much as a replacement, so the ward's sound is never heard from a
   * fairy off screen and always comes with the glyph that explains it. Wards
   * already laid stay up while nobody watches. The test is the live camera
   * view, so a wide desktop window watches from much farther than a phone —
   * a fixed radius small enough for every phone would let a desktop player
   * see the fairy and still never be warded against.
   */
  protected get isWatched(): boolean {
    return this.isOnScreen;
  }

  /**
   * Drops every ward whose carrier died or left the scene, or whose slot
   * another took, so the fairy can spend it on someone standing.
   */
  private forgetLostWards(): void {
    let kept = 0;
    for (const mob of this.warded) {
      if (!isInPublishedRoster(mob) || !mob.isAlive || !isWardedBy(mob, this)) continue;
      this.warded[kept++] = mob;
    }
    this.warded.length = kept;
  }

  /**
   * Whether the fairy can see `mob` and reach it with a ward: a ward that
   * crossed a wall would protect a goblin the player cannot see the fairy
   * tending, and a tether through masonry reads as a bug.
   */
  private canReach(mob: Mob): boolean {
    const ts = this.tileSize;
    const from = this.groundCentre;
    const toX = mob.x + ts / 2;
    const toY = mob.y + ts / 2;
    if (Math.hypot(toX - from.x, toY - from.y) > ts * SHIELD_CAST_RANGE_TILES) return false;
    const map = this.map;
    return map === null || map.hasLineOfSight(from.x, from.y, toX, toY);
  }

  /** The best unwarded ally to ward now, or null when every slot is spent or nobody is left. */
  private bestWardTarget(): Mob | null {
    if (this.warded.length >= this.wardCount) return null;
    let best: WardCandidate | null = null;
    for (const ally of this.allies) {
      if (isWardedBy(ally, this) || !canTakeWardFrom(ally, this) || !this.canReach(ally)) continue;
      const rank = isEngagedWithParty(ally) ? ENGAGED_RANK : ally.isBoss ? BOSS_RANK : OTHER_RANK;
      const candidate: WardCandidate = { mob: ally, rank, distance: this.distanceTo(ally) };
      if (best === null || compareCandidates(candidate, best) < 0) best = candidate;
    }
    return best?.mob ?? null;
  }

  protected override chooseCast(_crawler: Player | null): FairyCastIntent | null {
    if (!this.isWatched || !this.isCastReady(WARD_CAST)) return null;
    const target = this.bestWardTarget();
    if (target === null) return null;
    const ts = this.tileSize;
    return { cast: WARD_CAST, target, aimX: target.x + ts / 2, aimY: target.y + ts / 2 };
  }

  protected override onCastReleased(cast: ActiveFairyCast): void {
    const target = cast.target;
    if (!target?.isAlive) return;
    const ally = this.allies.find((mob) => mob === target);
    if (ally === undefined || this.warded.length >= this.wardCount) return;
    if (!applyFairyWardFrom(this, ally)) return;
    this.warded.push(ally);
    this.glyphTarget = ally;
  }

  /** Stays close to an ally it is warding, the one in the fight first. */
  protected override get supportTarget(): Mob | null {
    const firstWarded = this.warded.length > 0 ? this.warded[0] : null;
    return this.warded.find(isEngagedWithParty) ?? firstWarded;
  }

  protected override clearEncounterPhase(): void {
    super.clearEncounterPhase();
    this.warded.length = 0;
    this.glyphTarget = null;
  }

  /** The glyph forms over the newly warded ally while the cast row plays out. */
  override drawAirEffects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    frame: number,
  ): void {
    const cast = this.activeCast;
    const target = this.glyphTarget;
    if (cast?.cast !== WARD_CAST || target?.isAlive !== true) return;
    const ts = this.tileSize;
    const recoverPlayed =
      cast.phase === 'recover' ? FAIRY_CAST_RECOVER_FRAMES - cast.framesLeft + 1 : 0;
    const progress = Math.min(1, recoverPlayed / FAIRY_CAST_RECOVER_FRAMES);
    const glyphX = target.x + ts / 2 - camX;
    const glyphY = target.y - ts * GLYPH_LIFT_TILES - camY;
    const hands = this.castOrigin;
    const handsX = hands.x - camX;
    const handsY = hands.y - camY;
    drawWardGlyph(ctx, glyphX, glyphY, handsX, handsY, ts, progress, frame, this.glyphSeed);
  }
}
