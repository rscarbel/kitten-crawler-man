/**
 * Places the reinforcements a skeleton caster calls up, and holds the ceiling on
 * how many of them can exist.
 *
 * The Hoarder pattern: the boss queues requests and a system drains them, so the
 * cap is enforced in one place by something that can see the whole mob list
 * rather than by a creature guessing at it. The count is written back to the
 * lord so he stops *casting* summon at the cap instead of casting it and having
 * every request thrown away — which from the player's side is a boss standing
 * still doing nothing for a second and a half.
 *
 * Everything `BountySystem` applies uniformly to an encounter at issue time —
 * the level, the willingness to chase into town, the commitment to the fight —
 * has to be applied here as well. Summons arrive mid-fight and never pass
 * through that staging, and a warrior that missed it is a level-1 mob that
 * gives up at the town line while its brothers do not.
 */

import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import { SkeletonLord } from '../creatures/SkeletonLord';
import { TheLich } from '../creatures/TheLich';
import { SkeletonWarrior } from '../creatures/SkeletonWarrior';
import { SkeletonArcher } from '../creatures/SkeletonArcher';
import { NecroFairy } from '../creatures/fairies/NecroFairy';
import {
  NECRO_ARMY,
  NECRO_SKELETON_STRENGTH,
  type NecroSkeletonArmy,
} from '../creatures/fairies/fairyTuning';
import type { SkeletonSummonRequest } from '../creatures/SkeletonLord';
import { necroSkeletonLevel } from '../creatures/fairies/fairyPotency';
import type { LevelledCurve } from '../creatures/mobLevelScaling';
import { prewarmSkeletonEscortSprites } from '../sprites/skeletonSprite';
import { RisingSkeleton } from '../creatures/RisingSkeleton';
import { TILE_SIZE } from '../core/constants';
import { hasRoomToMove } from '../map/findWalkableTile';
import { applySpawnDifficulty } from '../core/difficultyProfiles';
import type { GameSystem, SystemContext } from './GameSystem';

/**
 * Living escorts the Skeleton Lord is allowed at once.
 *
 * Two waves' worth plus the three he starts with. Past that the party is fighting
 * a crowd rather than a boss, and the lord himself becomes unreachable behind it.
 *
 * It is his number rather than the system's because the ceiling is a property of
 * the ground the fight happens on: the Lich holds the same escort inside a single
 * tower room and carries a far lower one of its own.
 */
const SKELETON_LORD_ESCORT_CAP = 9;

/** Anything that queues reinforcements for this system to place. */
type SkeletonSummoner = SkeletonLord | TheLich | NecroFairy;

function isSkeletonSummoner(mob: Mob): mob is SkeletonSummoner {
  return mob instanceof SkeletonLord || mob instanceof TheLich || mob instanceof NecroFairy;
}

/** A boss's ceiling on living escorts, of any kind. A necro fairy's is per kind; see `NECRO_ARMY`. */
function escortCapOf(summoner: SkeletonLord | TheLich): number {
  if (summoner instanceof TheLich) return summoner.escortCap;
  return SKELETON_LORD_ESCORT_CAP;
}

type SkeletonKind = SkeletonSummonRequest['kind'];

/** Raise order within one army: swords first, so a short ring still fields the front line. */
const ARMY_KINDS: readonly SkeletonKind[] = ['sword', 'archer'];

/**
 * Skeletons raised with nobody left to own them — a necro fairy's parting gift
 * as it dies. Levelled on what the request says rather than on a summoner, and
 * outside every escort cap: the caster the cap belonged to is gone.
 */
export interface SkeletonRaiseRequest {
  /** World pixels the skeletons climb out around. */
  readonly originX: number;
  readonly originY: number;
  readonly army: NecroSkeletonArmy;
  readonly level: number;
  readonly curve: LevelledCurve;
  /** Share of a warrior's authored HP and bite they rise with; see `RisingSkeleton.raiseAsLesser`. */
  readonly strength: number;
  /** Their kills pay no XP, coin or loot. */
  readonly paysNoRewards: boolean;
}

/** How one skeleton is staged as it rises, whoever asked for it. */
interface RaiseStaging {
  readonly level: number;
  readonly curve: LevelledCurve;
  readonly strength: number;
  readonly blowCapShareOfTargetHp: number | null;
  readonly ignoresTownSafeZone: boolean;
  readonly paysNoRewards: boolean;
}

/** A boss's escort rises at the strength it was authored with. */
const ESCORT_STRENGTH = 1;

/**
 * The staging a summoner hands its skeletons. A boss's escort chases into town
 * with the boss it fights beside; a fairy's is an ordinary room mob, respects
 * the town line like its neighbours, and pays nothing, because a fairy that can
 * summon on a cooldown would otherwise be an XP tap. A fairy's also rises
 * lesser, below the fairy's level, as the skeletons its death leaves do.
 */
function stagingFor(summoner: SkeletonSummoner): RaiseStaging {
  const isFairy = summoner instanceof NecroFairy;
  return {
    level: isFairy ? necroSkeletonLevel(summoner.mobLevel) : summoner.mobLevel,
    curve: summoner.levelledCurve,
    strength: isFairy ? NECRO_SKELETON_STRENGTH : ESCORT_STRENGTH,
    blowCapShareOfTargetHp: summoner.blowCapShareOfTargetHp,
    ignoresTownSafeZone: !isFairy,
    paysNoRewards: isFairy,
  };
}

/** Rings of tiles searched outward from the lord for somewhere to put a summon. */
const MIN_SPAWN_RADIUS_TILES = 2;
const MAX_SPAWN_RADIUS_TILES = 5;

/**
 * How far from the lord a skeleton counts as one of *his*.
 *
 * The cap is a property of one encounter, not of the map. Counting every living
 * skeleton everywhere would let a crypt full of ambient warriors on the far side
 * of the floor silently forbid the boss from ever summoning — and the sword and
 * archer are registered as standalone spawner ids precisely so a future level
 * can do that. Generous enough to cover a fight that has spread out, far short
 * of anywhere else on the map.
 */
const ESCORT_RADIUS_TILES = 24;

export class SkeletonSummonSystem implements GameSystem {
  /** Set when anything rises; `DungeonScene` reads and clears it to play the cue. */
  riseSoundPending = false;

  constructor(
    private readonly gameMap: GameMap,
    private readonly addMob: (mob: Mob) => void,
  ) {}

  /**
   * Drops the pending rise cue on a checkpoint restore.
   *
   * Without it, a safe-room restore on the exact frame a wave rose would play
   * the cue for a summon that the restore has just undone — a sound with nothing
   * on screen behind it. The other three encounter systems already do this.
   */
  resetForCheckpoint(): void {
    this.riseSoundPending = false;
    this.pendingRaises = [];
  }

  /**
   * Summoner-less skeletons waiting to rise, drained on the next update. Held
   * here rather than on the mob that asked, because that mob is dead.
   */
  private pendingRaises: SkeletonRaiseRequest[] = [];

  /** Which necro fairy raised each of its skeletons; see {@link summonNecroArmy}. */
  private readonly raisedBy = new WeakMap<Mob, NecroFairy>();

  /** Queues skeletons to rise with no summoner; see {@link SkeletonRaiseRequest}. */
  requestRaise(request: SkeletonRaiseRequest): void {
    this.pendingRaises.push(request);
  }

  update(ctx: SystemContext): void {
    this.drainRaiseRequests();
    const summoners = ctx.roster.mobs.filter(
      (mob): mob is SkeletonSummoner => isSkeletonSummoner(mob) && mob.isAlive,
    );
    if (summoners.length === 0) return;

    const escortRadiusPx = TILE_SIZE * ESCORT_RADIUS_TILES;
    const skeletons = ctx.roster.mobs.filter(
      (mob): mob is RisingSkeleton => mob instanceof RisingSkeleton && mob.isAlive,
    );

    for (const summoner of summoners) {
      const pending = summoner.takePendingSummons();
      // Every summoner's wave, not just the Lich's: the Skeleton Lord raises
      // his own escort through this loop and the bodies are all created on one
      // frame, so the rows have to be admitted before the first of them draws.
      if (pending.length > 0) prewarmSkeletonEscortSprites();
      if (summoner instanceof NecroFairy) {
        this.summonNecroArmy(summoner, pending, skeletons);
        continue;
      }
      const cap = escortCapOf(summoner);
      let living = 0;
      for (const skeleton of skeletons) {
        if (Math.hypot(skeleton.x - summoner.x, skeleton.y - summoner.y) <= escortRadiusPx) {
          living++;
        }
      }
      const taken = new Set<string>();
      for (const request of pending) {
        // A rising skeleton is already alive and already counted, so the cap can
        // never be double-booked by a wave that has not finished climbing out.
        if (living >= cap) continue;
        const tile = this.findSpawnTile(request.originX, request.originY, taken);
        if (tile === null) continue;
        this.raise(request.kind, tile.x, tile.y, stagingFor(summoner));
        living++;
      }
      summoner.escortAtCap = living >= cap;
    }
  }

  /**
   * Places a necro fairy's requests, each kind held to its count in
   * {@link NECRO_ARMY}, and tells the fairy what it now fields. Only skeletons
   * this fairy raised count: a radius count would let an ambient crypt, or the
   * Skeleton Lord's whole escort, forbid a fairy that has raised nothing from
   * ever summoning.
   */
  private summonNecroArmy(
    fairy: NecroFairy,
    pending: readonly SkeletonSummonRequest[],
    skeletons: readonly RisingSkeleton[],
  ): void {
    const living: Record<SkeletonKind, number> = { sword: 0, archer: 0 };
    for (const skeleton of skeletons) {
      if (this.raisedBy.get(skeleton) === fairy) living[kindOf(skeleton)]++;
    }
    const taken = new Set<string>();
    for (const request of pending) {
      if (living[request.kind] >= NECRO_ARMY[request.kind]) continue;
      const tile = this.findSpawnTile(request.originX, request.originY, taken);
      if (tile === null) continue;
      const risen = this.raise(request.kind, tile.x, tile.y, stagingFor(fairy));
      this.raisedBy.set(risen, fairy);
      living[request.kind]++;
    }
    fairy.reportArmy(living);
  }

  private drainRaiseRequests(): void {
    if (this.pendingRaises.length === 0) return;
    const requests = this.pendingRaises;
    this.pendingRaises = [];
    prewarmSkeletonEscortSprites();
    for (const request of requests) {
      const staging: RaiseStaging = {
        level: request.level,
        curve: request.curve,
        strength: request.strength,
        blowCapShareOfTargetHp: null,
        ignoresTownSafeZone: false,
        paysNoRewards: request.paysNoRewards,
      };
      const taken = new Set<string>();
      for (const kind of ARMY_KINDS) {
        for (let i = 0; i < request.army[kind]; i++) {
          const tile = this.findSpawnTile(request.originX, request.originY, taken);
          if (tile === null) break;
          this.raise(kind, tile.x, tile.y, staging);
        }
      }
    }
  }

  private raise(
    kind: SkeletonKind,
    tileX: number,
    tileY: number,
    staging: RaiseStaging,
  ): RisingSkeleton {
    const risen =
      kind === 'sword'
        ? new SkeletonWarrior(tileX, tileY, TILE_SIZE)
        : new SkeletonArcher(tileX, tileY, TILE_SIZE);
    risen.setMap(this.gameMap);
    // Before the roll below: a skeleton learns what it may know from whether
    // it was summoned, and only this call marks it so.
    risen.beginRising();
    // Before the level, which scales whatever max HP it finds.
    risen.raiseAsLesser(staging.strength);
    // The flags BountySystem would have applied at issue time. Summons never
    // pass through it, so they are applied here — exactly once each.
    risen.applyMobLevel(staging.level, staging.curve);
    applySpawnDifficulty(risen);
    risen.ignoresTownSafeZone = staging.ignoresTownSafeZone;
    // A summon fights the summoner's fight, so it keeps the summoner's promise
    // about how much one blow may take.
    risen.blowCapShareOfTargetHp = staging.blowCapShareOfTargetHp;
    risen.paysNoRewards = staging.paysNoRewards;
    // Deliberately unleashed: they climb out into a fight that is already
    // happening, so there is no site for them to be anchored to.
    risen.forceAggro = true;
    this.addMob(risen);
    this.riseSoundPending = true;
    return risen;
  }

  /**
   * Finds open ground near the summoner to raise something on.
   *
   * Searched outward from a minimum radius rather than from zero: a warrior that
   * climbs out on top of the caster blocks the very shot it was buying time for,
   * and the two immediately shove each other apart, which looks like a bug.
   *
   * Placement demands room to move rather than mere walkability: a one-tile
   * pocket between a desk and a wall passes `isWalkable` and traps whatever
   * rises in it for the rest of the fight.
   *
   * `taken` holds the tiles this batch has already used, and is added to: a
   * wave of several shares no tile while the search still has a free one. Once
   * every walkable tile in reach is taken, skeletons double up on them and the
   * separation pass spreads them out, rather than the wave losing bodies.
   */
  private findSpawnTile(
    originX: number,
    originY: number,
    taken: Set<string>,
  ): { x: number; y: number } | null {
    const centreTileX = Math.floor(originX / TILE_SIZE);
    const centreTileY = Math.floor(originY / TILE_SIZE);
    const roomy: Array<{ x: number; y: number }> = [];
    const cramped: Array<{ x: number; y: number }> = [];
    const doubledUp: Array<{ x: number; y: number }> = [];
    const claim = (tile: { x: number; y: number }): { x: number; y: number } => {
      taken.add(tileKey(tile.x, tile.y));
      return tile;
    };
    for (let radius = MIN_SPAWN_RADIUS_TILES; radius <= MAX_SPAWN_RADIUS_TILES; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const tileX = centreTileX + dx;
          const tileY = centreTileY + dy;
          if (!this.gameMap.isWalkable(tileX, tileY)) continue;
          const tile = { x: tileX, y: tileY };
          if (taken.has(tileKey(tileX, tileY))) doubledUp.push(tile);
          else if (hasRoomToMove(this.gameMap, tileX, tileY)) roomy.push(tile);
          else cramped.push(tile);
        }
      }
      // Picked at random from the whole ring rather than taking the first hit,
      // so a wave does not always come up on the caster's western side.
      if (roomy.length > 0) return claim(pickAtRandom(roomy));
    }
    // Nowhere with elbow room inside the search: a cramped tile still beats
    // swallowing the summon outright, and indoors — where a room is furniture
    // wall to wall — it is often the only kind there is.
    if (cramped.length > 0) return claim(pickAtRandom(cramped));
    if (doubledUp.length > 0) return pickAtRandom(doubledUp);
    return null;
  }
}

function tileKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}

function pickAtRandom<T>(options: readonly T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

function kindOf(skeleton: RisingSkeleton): SkeletonKind {
  return skeleton instanceof SkeletonArcher ? 'archer' : 'sword';
}
