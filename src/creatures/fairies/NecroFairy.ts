import { Mob } from '../Mob';
import type { Player } from '../../Player';
import type { SkeletonSummonRequest } from '../SkeletonLord';
import type { Difficulty } from '../../core/difficultyProfiles';
import { randomInt } from '../../utils';
import {
  Fairy,
  type ActiveFairyCast,
  type FairyCast,
  type FairyCastIntent,
  type FairyPositioning,
} from './Fairy';
import type { FairyKind } from '../../sprites/art/fairyTiming';
import { collectResurrectableCorpses, type FairyCorpse } from './fairyCorpses';
import {
  drawNecroTether,
  drawNecroWisps,
  drawTelekineticRing,
} from '../../sprites/art/fairyEffectsArt';
import {
  NECRO_ARMY,
  NECRO_ARMY_LAST_STANDING,
  NECRO_DEATH_ARMY,
  NECRO_PREFERRED_RANGE_TILES,
  NECRO_RESUMMON_AFTER_WIPE_MAX_FRAMES,
  NECRO_RESUMMON_AFTER_WIPE_MIN_FRAMES,
  NECRO_RESUMMON_LAST_STANDING_FRAMES,
  NECRO_SUMMON_TRIGGER_TILES,
  FAIRY_CAST_RECOVER_FRAMES,
  NECRO_SUPPORT_LEASH_TILES,
  RESURRECT_COOLDOWN_FRAMES,
  RESURRECT_COOLDOWN_MIN_FRAMES,
  TK_COOLDOWN_FRAMES,
  type NecroSkeletonArmy,
  TK_KNOCKBACK_FRAMES,
  TK_KNOCKBACK_TILES,
  TK_RADIUS_TILES,
  TK_TRIGGER_RADIUS_TILES,
} from './fairyTuning';

const POSITIONING: FairyPositioning = {
  preferredRangeTiles: NECRO_PREFERRED_RANGE_TILES,
  supportLeashTiles: NECRO_SUPPORT_LEASH_TILES,
};

const NO_SUMMONS: readonly SkeletonSummonRequest[] = [];
const NO_RESURRECTIONS: readonly Mob[] = [];

/** Offset from a body's top-left to its centre, as a share of a tile. */
const TILE_CENTRE = 0.5;

/** Frames the telekinetic burst ring stays on screen after the wave lands. */
const TK_BURST_DRAW_FRAMES = 18;

/** Seeds for the effect painters are drawn from this range, so two fairies' wisps never swirl in step. */
const EFFECT_SEED_RANGE = 1000;

/**
 * Raises every eligible corpse in reach the frame it is released. A corpse it
 * cannot see is never raised, because `collectResurrectableCorpses` requires
 * line of sight.
 */
export const NECRO_RESURRECT_CAST: FairyCast = {
  id: 'necro_resurrect',
  row: 'cast_raise',
  cooldownFrames: RESURRECT_COOLDOWN_FRAMES,
  minCooldownFrames: RESURRECT_COOLDOWN_MIN_FRAMES,
};

/** The army's own re-summon delays pace the summon, so the cast itself carries none. */
const NO_CAST_COOLDOWN_FRAMES = 0;

/** Calls up whatever the army is short of, up to `NECRO_ARMY`. */
export const NECRO_SUMMON_CAST: FairyCast = {
  id: 'necro_summon',
  row: 'cast_raise',
  cooldownFrames: NO_CAST_COOLDOWN_FRAMES,
  minCooldownFrames: NO_CAST_COOLDOWN_FRAMES,
  cooldownScalesWithLevel: false,
};

type SkeletonKind = SkeletonSummonRequest['kind'];
const ARMY_KINDS: readonly SkeletonKind[] = ['sword', 'archer'];

/** Why a re-summon is counting down: the whole army fell, or it is down to its last. */
type ResummonReason = 'wipe' | 'last_standing';

/**
 * The shove, released the frame a crawler comes within its trigger. It deals
 * no damage and applies no status, only distance, so it needs no telegraph;
 * its cooldown is a rhythm the player learns, so it is the same at every level.
 */
export const NECRO_TELEKINETIC_CAST: FairyCast = {
  id: 'necro_telekinetic_wave',
  row: 'cast_push',
  cooldownFrames: TK_COOLDOWN_FRAMES,
  minCooldownFrames: TK_COOLDOWN_FRAMES,
  cooldownScalesWithLevel: false,
};

const NECRO_CASTS: readonly FairyCast[] = [
  NECRO_TELEKINETIC_CAST,
  NECRO_RESURRECT_CAST,
  NECRO_SUMMON_CAST,
];

/**
 * The black fairy: raises every fallen ally it can see, keeps a skeleton army
 * at its side, shoves crawlers back, and leaves a bigger army when it dies.
 */
export class NecroFairy extends Fairy {
  readonly kind: FairyKind = 'necro';
  protected readonly positioning = POSITIONING;
  readonly xpValue = 8;
  protected coinDropMin = 0;
  protected coinDropMax = 2;
  displayName = 'Necro Fairy';
  description = 'A black-winged fairy that raises the dead and shoves the living away.';

  /**
   * Written by `SkeletonSummonSystem` every frame it runs, through
   * {@link reportArmy}: true while this fairy's army is at full strength. Read
   * before starting a summon, so the fairy never spends a cast the system will
   * throw away.
   */
  escortAtCap = false;

  private pendingSummons: SkeletonSummonRequest[] = [];
  private pendingResurrections: Mob[] = [];

  /** Living skeletons of each kind this fairy raised, as last reported. */
  private armyLiving: Record<SkeletonKind, number> = { sword: 0, archer: 0 };
  /** Whether this fairy has called its army up yet in this encounter. */
  private hasFieldedArmy = false;
  /**
   * True from a summon's release until `SkeletonSummonSystem` drains it, so the
   * army's count is never read before the system has reported the new bodies.
   */
  private summonInFlight = false;
  private resummonFramesLeft: number | null = null;
  private resummonReason: ResummonReason | null = null;

  private stampedDeathArmy: NecroSkeletonArmy = NECRO_DEATH_ARMY.normal;
  private deathArmyStamped = false;

  /**
   * The party as `MobUpdateLoop` handed it over this frame, read by the
   * telekinetic wave's trigger and its release. Holds the loop's own array, so
   * it is only trusted inside the same `updateAI` call.
   */
  private partyThisFrame: readonly Player[] = [];

  private waveBurst: { x: number; y: number; age: number } | null = null;

  private readonly corpseScratch: FairyCorpse[] = [];
  private readonly effectSeed = Math.floor(Math.random() * EFFECT_SEED_RANGE);

  /** The army this fairy's death leaves behind, fixed by {@link stampPotency}. */
  get deathArmy(): NecroSkeletonArmy {
    return this.stampedDeathArmy;
  }

  /** Also fixes {@link deathArmy} from the difficulty this fairy was spawned under. */
  override stampPotency(difficulty: Difficulty): void {
    super.stampPotency(difficulty);
    if (this.deathArmyStamped) return;
    this.deathArmyStamped = true;
    this.stampedDeathArmy = NECRO_DEATH_ARMY[difficulty];
  }

  /** Called by `SkeletonSummonSystem` every frame it runs with this fairy's living skeletons. */
  reportArmy(living: Readonly<Record<SkeletonKind, number>>): void {
    this.armyLiving = { sword: living.sword, archer: living.archer };
    this.escortAtCap = ARMY_KINDS.every((kind) => living[kind] >= NECRO_ARMY[kind]);
  }

  /**
   * Asks for every skeleton the army is short of to climb out beside this
   * fairy. Placed and held to `NECRO_ARMY` by `SkeletonSummonSystem`, which
   * marks them as paying nothing.
   */
  protected queueSkeletonSummon(): void {
    for (const kind of ARMY_KINDS) {
      const missing = NECRO_ARMY[kind] - this.armyLiving[kind];
      for (let i = 0; i < missing; i++) {
        this.pendingSummons.push({ kind, originX: this.x, originY: this.y });
      }
    }
    this.hasFieldedArmy = true;
    this.summonInFlight = true;
    this.resummonFramesLeft = null;
    this.resummonReason = null;
  }

  /** Drained by `SkeletonSummonSystem`. */
  takePendingSummons(): readonly SkeletonSummonRequest[] {
    this.summonInFlight = false;
    if (this.pendingSummons.length === 0) return NO_SUMMONS;
    const taken = this.pendingSummons;
    this.pendingSummons = [];
    return taken;
  }

  /**
   * Asks for `corpse` to be raised. Resolved by `FairySystem`, which re-checks
   * that it is still eligible (another necromancer may have raised it first).
   * Pick `corpse` from `collectResurrectableCorpses`.
   */
  protected queueResurrection(corpse: Mob): void {
    this.pendingResurrections.push(corpse);
  }

  /** Drained by `FairySystem`. */
  takePendingResurrections(): readonly Mob[] {
    if (this.pendingResurrections.length === 0) return NO_RESURRECTIONS;
    const taken = this.pendingResurrections;
    this.pendingResurrections = [];
    return taken;
  }

  protected override clearEncounterPhase(): void {
    super.clearEncounterPhase();
    this.pendingSummons = [];
    this.pendingResurrections = [];
    this.armyLiving = { sword: 0, archer: 0 };
    this.hasFieldedArmy = false;
    this.summonInFlight = false;
    this.resummonFramesLeft = null;
    this.resummonReason = null;
    this.escortAtCap = false;
    this.waveBurst = null;
  }

  // ── Casting ───────────────────────────────────────────────────────────────

  protected override get casts(): readonly FairyCast[] {
    return NECRO_CASTS;
  }

  override updateAI(targets: Player[]): void {
    this.partyThisFrame = targets;
    if (this.waveBurst !== null) {
      this.waveBurst.age++;
      if (this.waveBurst.age >= TK_BURST_DRAW_FRAMES) this.waveBurst = null;
    }
    if (this.isAlive) this.advanceResummonTimer();
    super.updateAI(targets);
    this.partyThisFrame = [];
  }

  /**
   * Starts, re-rolls or cancels the re-summon countdown from the army's last
   * reported strength, and counts it down. A wipe while the last-standing
   * countdown runs keeps whichever of the two would summon sooner.
   */
  private advanceResummonTimer(): void {
    if (this.summonInFlight || !this.hasFieldedArmy) return;
    const living = this.armyLiving.sword + this.armyLiving.archer;
    if (this.escortAtCap || living > NECRO_ARMY_LAST_STANDING) {
      this.resummonFramesLeft = null;
      this.resummonReason = null;
      return;
    }
    if (living === 0 && this.resummonReason !== 'wipe') {
      const wipeDelay = randomInt(
        NECRO_RESUMMON_AFTER_WIPE_MIN_FRAMES,
        NECRO_RESUMMON_AFTER_WIPE_MAX_FRAMES,
      );
      this.resummonFramesLeft = Math.min(this.resummonFramesLeft ?? wipeDelay, wipeDelay);
      this.resummonReason = 'wipe';
    } else if (this.resummonReason === null) {
      this.resummonFramesLeft = NECRO_RESUMMON_LAST_STANDING_FRAMES;
      this.resummonReason = 'last_standing';
    }
    if (this.resummonFramesLeft !== null && this.resummonFramesLeft > 0) {
      this.resummonFramesLeft--;
    }
  }

  /** Whether the army is due: never yet fielded this encounter, or its re-summon countdown has run out. */
  private get armyDue(): boolean {
    if (this.escortAtCap || this.summonInFlight) return false;
    if (!this.hasFieldedArmy) return true;
    return this.resummonFramesLeft !== null && this.resummonFramesLeft <= 0;
  }

  /**
   * Self-defence first: a crawler close enough to swing at a fragile fairy is
   * shoved away. Then every corpse in sight is raised, because a returned
   * veteran is worth more than a new skeleton. The army is called when it is
   * due and a crawler it has noticed is within `NECRO_SUMMON_TRIGGER_TILES`.
   *
   * Raising and summoning wait until the fairy is on screen, so the player
   * watches every body stand up and learns who is doing it; a refill that
   * comes due off screen is held, not lost, since its countdown stops at
   * zero. The shove needs a crawler within arm's reach, which is on screen
   * already.
   */
  protected override chooseCast(crawler: Player | null): FairyCastIntent | null {
    const wave = this.chooseTelekineticWave();
    if (wave !== null) return wave;
    if (!this.isOnScreen) return null;

    const raise = this.chooseResurrection();
    if (raise !== null) return raise;

    if (crawler === null || !this.armyDue || !this.isCastReady(NECRO_SUMMON_CAST)) return null;
    const triggerPx = this.tileSize * NECRO_SUMMON_TRIGGER_TILES;
    if (this.distanceFromCentre(this.groundCentre, crawler) > triggerPx) return null;
    return { cast: NECRO_SUMMON_CAST, target: null, aimX: crawler.x, aimY: crawler.y };
  }

  private chooseTelekineticWave(): FairyCastIntent | null {
    if (!this.isCastReady(NECRO_TELEKINETIC_CAST)) return null;
    const centre = this.groundCentre;
    const triggerPx = this.tileSize * TK_TRIGGER_RADIUS_TILES;
    let closest: Player | null = null;
    let closestDist = Infinity;
    for (const member of this.partyThisFrame) {
      if (!this.isShovable(member)) continue;
      const dist = this.distanceFromCentre(centre, member);
      if (dist > triggerPx || dist >= closestDist) continue;
      if (!this.seesFromCentre(centre, member)) continue;
      closest = member;
      closestDist = dist;
    }
    if (closest === null) return null;
    return { cast: NECRO_TELEKINETIC_CAST, target: closest, aimX: closest.x, aimY: closest.y };
  }

  /** Aimed at the strongest corpse in reach, which the tether is drawn to; the release raises them all. */
  private chooseResurrection(): FairyCastIntent | null {
    if (!this.isCastReady(NECRO_RESURRECT_CAST)) return null;
    const corpses = this.corpseScratch;
    collectResurrectableCorpses(this, this.map, corpses);
    let best: Mob | null = null;
    for (const corpse of corpses) {
      if (best === null || corpse.mob.maxHp > best.maxHp) best = corpse.mob;
    }
    corpses.length = 0;
    if (best === null) return null;
    return { cast: NECRO_RESURRECT_CAST, target: best, aimX: best.x, aimY: best.y };
  }

  protected override onCastReleased(active: ActiveFairyCast): void {
    switch (active.cast) {
      case NECRO_TELEKINETIC_CAST:
        this.releaseTelekineticWave(active);
        break;
      case NECRO_RESURRECT_CAST:
        this.queueEveryResurrection();
        break;
      case NECRO_SUMMON_CAST:
        this.queueSkeletonSummon();
        break;
    }
  }

  private queueEveryResurrection(): void {
    const corpses = this.corpseScratch;
    collectResurrectableCorpses(this, this.map, corpses);
    for (const corpse of corpses) this.queueResurrection(corpse.mob);
    corpses.length = 0;
  }

  /**
   * Shoves every party member in reach straight away from where the fairy is
   * on the release frame. No damage and no status: the wave buys the fairy room and
   * breaks up a crowd, and a knockback already stops dead against masonry.
   */
  private releaseTelekineticWave(active: ActiveFairyCast): void {
    const centre = this.groundCentre;
    this.waveBurst = { x: centre.x, y: centre.y, age: 0 };
    const radiusPx = this.tileSize * TK_RADIUS_TILES;
    const distancePx = this.tileSize * TK_KNOCKBACK_TILES;
    for (const member of this.partyThisFrame) {
      if (!this.isShovable(member)) continue;
      if (this.distanceFromCentre(centre, member) > radiusPx) continue;
      if (!this.seesFromCentre(centre, member)) continue;
      const memberCentre = this.centreOf(member);
      let dirX = memberCentre.x - centre.x;
      let dirY = memberCentre.y - centre.y;
      if (dirX === 0 && dirY === 0) {
        dirX = this.facingX;
        dirY = this.facingY;
      }
      if (dirX === 0 && dirY === 0) continue;
      member.applyKnockback(dirX, dirY, distancePx, TK_KNOCKBACK_FRAMES);
    }
    if (active.target !== null) this.faceToward(active.target);
  }

  /**
   * A living member of the party. `MobUpdateLoop` can append whoever struck
   * the fairy last, which is a party member in every case but a stray hostile
   * blow — and the wave never shoves the fairy's own side.
   */
  private isShovable(member: Player): boolean {
    if (!member.isAlive || member === this) return false;
    if (!this.mayFight(member)) return false;
    return !(member instanceof Mob && member.isHostile);
  }

  private centreOf(body: Player): { x: number; y: number } {
    return { x: body.x + this.tileSize * TILE_CENTRE, y: body.y + this.tileSize * TILE_CENTRE };
  }

  private distanceFromCentre(centre: { x: number; y: number }, body: Player): number {
    const bodyCentre = this.centreOf(body);
    return Math.hypot(bodyCentre.x - centre.x, bodyCentre.y - centre.y);
  }

  /** The wave does not pass through walls: a crawler on the far side of one is untouched. */
  private seesFromCentre(centre: { x: number; y: number }, body: Player): boolean {
    const map = this.map;
    if (map === null) return true;
    const bodyCentre = this.centreOf(body);
    return map.hasLineOfSight(centre.x, centre.y, bodyCentre.x, bodyCentre.y);
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  /** 0 → 1 as a released raise's row plays out, for its wisps and tether. */
  private afterReleaseProgress(active: ActiveFairyCast): number {
    if (active.phase === 'release') return 0;
    return Math.min(
      1,
      (FAIRY_CAST_RECOVER_FRAMES - active.framesLeft + 1) / FAIRY_CAST_RECOVER_FRAMES,
    );
  }

  override drawGroundEffects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    frame: number,
  ): void {
    const ts = this.tileSize;
    const active = this.activeCast;
    if (active !== null) {
      const progress = this.afterReleaseProgress(active);
      if (active.cast === NECRO_RESURRECT_CAST) {
        drawNecroWisps(
          ctx,
          active.aimX + ts * TILE_CENTRE - camX,
          active.aimY + ts * TILE_CENTRE - camY,
          ts,
          progress,
          frame,
          this.effectSeed,
        );
      } else if (active.cast === NECRO_SUMMON_CAST) {
        const centre = this.groundCentre;
        drawNecroWisps(ctx, centre.x - camX, centre.y - camY, ts, progress, frame, this.effectSeed);
      }
    }
    const burst = this.waveBurst;
    if (burst !== null) {
      drawTelekineticRing(
        ctx,
        burst.x - camX,
        burst.y - camY,
        ts * TK_RADIUS_TILES,
        'burst',
        burst.age / TK_BURST_DRAW_FRAMES,
        frame,
        this.effectSeed,
      );
    }
  }

  override drawAirEffects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    frame: number,
  ): void {
    const active = this.activeCast;
    if (active?.cast !== NECRO_RESURRECT_CAST) return;
    const ts = this.tileSize;
    const hands = this.castOrigin;
    drawNecroTether(
      ctx,
      hands.x - camX,
      hands.y - camY,
      active.aimX + ts * TILE_CENTRE - camX,
      active.aimY + ts * TILE_CENTRE - camY,
      this.afterReleaseProgress(active),
      frame,
      this.effectSeed,
    );
  }
}
