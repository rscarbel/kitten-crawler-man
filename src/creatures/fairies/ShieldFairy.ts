import type { Mob } from '../Mob';
import type { Player } from '../../Player';
import { isInPublishedRoster } from '../packAlert';
import { BrindleGrub } from '../BrindleGrub';
import { drawWardCrushBubble, drawWardGlyph } from '../../sprites/art/fairyEffectsArt';
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
  SHIELD_BASE_SPEED,
  SHIELD_CRUSH_COOLDOWN_FRAMES,
  SHIELD_CRUSH_IMPLODE_FRAMES,
  SHIELD_CRUSH_MIN_COOLDOWN_FRAMES,
  SHIELD_ENGAGED_RECENT_FRAMES,
  SHIELD_MAX_SPEED,
  SHIELD_PREFERRED_RANGE_TILES,
  SHIELD_SUPPORT_LEASH_TILES,
  SHIELD_WARD_LINK_RANGE_TILES,
} from './fairyTuning';

const POSITIONING: FairyPositioning = {
  preferredRangeTiles: SHIELD_PREFERRED_RANGE_TILES,
  supportLeashTiles: SHIELD_SUPPORT_LEASH_TILES,
};

/**
 * The one ordinary spell, laid the frame it is chosen. Its cooldown is the
 * short gap between any two casts.
 */
export const WARD_CAST: FairyCast = {
  id: 'ward',
  row: 'cast_ward',
  cooldownFrames: SHIELD_BETWEEN_CASTS_FRAMES,
  minCooldownFrames: SHIELD_BETWEEN_CASTS_MIN_FRAMES,
};

/**
 * The fairy's other spell: a ward that never protects, laid on a hatched
 * vespa instead of an ally, and crushed shut around it a moment later. Reuses
 * the ward's own cast row — the hands motion of laying one on a body is the
 * same whichever kind of ward it turns out to be.
 */
export const CRUSH_CAST: FairyCast = {
  id: 'crush',
  row: 'cast_ward',
  cooldownFrames: SHIELD_CRUSH_COOLDOWN_FRAMES,
  minCooldownFrames: SHIELD_CRUSH_MIN_COOLDOWN_FRAMES,
};

const SHIELD_CASTS: readonly FairyCast[] = [WARD_CAST, CRUSH_CAST];

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

  /** The vespa a crushing ward is currently closing on, or null between casts. */
  private crushTarget: BrindleGrub | null = null;
  /** Frames left before {@link crushTarget} implodes; counts down from {@link SHIELD_CRUSH_IMPLODE_FRAMES}. */
  private crushFramesLeft = 0;

  /** Set on the frame the ward finishes closing; the audio pass reads and clears it. */
  crushImplodeSoundPending = false;

  /** Whether a crushing ward is currently closing on a vespa. Read by `FairySystem` and gates. */
  get hasInFlightCrush(): boolean {
    return this.crushTarget !== null;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, SHIELD_BASE_SPEED);
  }

  protected override get topSpeed(): number {
    return SHIELD_MAX_SPEED;
  }

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
    if (this.isAlive) {
      this.forgetLostWards();
      this.advanceCrush();
    }
    super.updateAI(targets);
  }

  /**
   * Counts an in-flight crush down and resolves it on the frame it reaches
   * zero, killing the vespa outright. `killOutright` rather than a damage
   * number: a vespa the fairy's own death aegis (`FAIRY_AEGIS_STATUS`) is
   * shielding would otherwise take this "hit" at half value through
   * `scaleIncomingDamage` and survive the implosion at half HP. This also
   * keeps the crash a verdict, not a blow, so it still earns the player no XP
   * for a kill they did not land.
   */
  private advanceCrush(): void {
    if (this.crushTarget === null) return;
    if (!this.crushTarget.isAlive) {
      this.cancelCrush();
      return;
    }
    this.crushFramesLeft--;
    if (this.crushFramesLeft > 0) return;
    this.crushTarget.killOutright();
    this.crushImplodeSoundPending = true;
    this.crushTarget = null;
  }

  /**
   * Drops an in-flight crush without finishing it — called when this fairy
   * dies, alongside stripping the wards it holds, so a crush already snapped
   * around a vespa does not go on to kill it after the fairy that cast it is
   * gone.
   */
  cancelCrush(): void {
    this.crushTarget = null;
    this.crushFramesLeft = 0;
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
   * Drops every ward whose carrier died, left the scene, or ran past
   * {@link SHIELD_WARD_LINK_RANGE_TILES}, or whose slot another took, so the
   * fairy can spend it on someone standing. A carrier that outruns the link
   * loses its ward on the spot rather than keeping it until the fairy dies —
   * otherwise the only way to stop it would be to chase it down and kill the
   * fairy that is no longer anywhere near it.
   */
  private forgetLostWards(): void {
    const linkRangePx = this.tileSize * SHIELD_WARD_LINK_RANGE_TILES;
    let kept = 0;
    for (const mob of this.warded) {
      if (!isInPublishedRoster(mob) || !mob.isAlive || !isWardedBy(mob, this)) continue;
      if (this.distanceTo(mob) > linkRangePx) {
        mob.removeWardsAppliedBy(this);
        continue;
      }
      this.warded[kept++] = mob;
    }
    this.warded.length = kept;
  }

  /**
   * Whether the fairy can see `mob` and reach it with a ward: a ward that
   * crossed a wall would protect a goblin the player cannot see the fairy
   * tending, and a tether through masonry reads as a bug. The same range
   * {@link forgetLostWards} holds an existing ward to, so a ward is never laid
   * at a distance it would be stripped at on the very next frame.
   */
  private canReach(mob: Mob): boolean {
    const ts = this.tileSize;
    const from = this.groundCentre;
    const toX = mob.x + ts / 2;
    const toY = mob.y + ts / 2;
    if (Math.hypot(toX - from.x, toY - from.y) > ts * SHIELD_WARD_LINK_RANGE_TILES) return false;
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

  /** The nearest hatched vespa in reach to crush, or null when none qualifies. */
  private bestCrushTarget(): BrindleGrub | null {
    let best: BrindleGrub | null = null;
    let bestDistance = Infinity;
    for (const ally of this.allies) {
      if (!(ally instanceof BrindleGrub) || !ally.isVespa || !this.canReach(ally)) continue;
      const distance = this.distanceTo(ally);
      if (distance < bestDistance) {
        best = ally;
        bestDistance = distance;
      }
    }
    return best;
  }

  protected override chooseCast(_crawler: Player | null): FairyCastIntent | null {
    if (!this.isWatched) return null;
    // The crush is checked first: it is the rarer, longer-cooldown cast, and a
    // vespa in reach is worth interrupting the ordinary ward rotation for.
    if (this.crushTarget === null && this.isCastReady(CRUSH_CAST)) {
      const vespa = this.bestCrushTarget();
      if (vespa !== null) {
        const ts = this.tileSize;
        return { cast: CRUSH_CAST, target: vespa, aimX: vespa.x + ts / 2, aimY: vespa.y + ts / 2 };
      }
    }
    if (!this.isCastReady(WARD_CAST)) return null;
    const target = this.bestWardTarget();
    if (target === null) return null;
    const ts = this.tileSize;
    return { cast: WARD_CAST, target, aimX: target.x + ts / 2, aimY: target.y + ts / 2 };
  }

  protected override onCastReleased(cast: ActiveFairyCast): void {
    if (cast.cast === CRUSH_CAST) {
      const vespa = cast.target;
      if (!(vespa instanceof BrindleGrub) || !vespa.isVespa || !vespa.isAlive) return;
      this.crushTarget = vespa;
      this.crushFramesLeft = SHIELD_CRUSH_IMPLODE_FRAMES;
      this.glyphTarget = vespa;
      return;
    }
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
    this.cancelCrush();
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
    if ((cast?.cast === WARD_CAST || cast?.cast === CRUSH_CAST) && target?.isAlive === true) {
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

    // The crush bubble telegraphs on its own timer once the cast row has
    // finished playing, independent of the glyph above: the glyph is "a ward
    // is being laid" and plays out over the recover phase, while the crush's
    // implosion is "the ward is now closing" and runs for its own, longer
    // {@link SHIELD_CRUSH_IMPLODE_FRAMES}.
    if (this.crushTarget?.isAlive === true) {
      const ts = this.tileSize;
      const bubbleX = this.crushTarget.x + ts / 2 - camX;
      const bubbleY = this.crushTarget.y + ts / 2 - camY;
      const shrinkProgress = 1 - this.crushFramesLeft / SHIELD_CRUSH_IMPLODE_FRAMES;
      drawWardCrushBubble(ctx, bubbleX, bubbleY, ts, shrinkProgress);
    }
  }
}
