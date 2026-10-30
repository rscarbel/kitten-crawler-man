import { TILE_SIZE } from '../core/constants';
import { Mercenary } from '../creatures/Mercenary';
import { MERCENARY_ART } from '../sprites/mercenaryArt';
import { ANY_TILE, findNearbyWalkableTile, type TileFilter } from '../map/findWalkableTile';
import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/world/SpatialGrid';
import type { GameMap } from '../map/GameMap';
import {
  canWalkTrail,
  trailGroundOn,
  type PartyLine,
  type PartyLineLink,
  type TrailFollowSwitch,
  type TrailStance,
} from './partyTrail';
import {
  contractIsCurrent,
  hirelingStartingHp,
  type MercenaryRoster,
} from '../core/party/MercenaryRoster';
import { REVIVE_RANGE_PX } from '../core/party/reviveRules';
import { activeRunStats } from '../core/progression/GameStats';
import type { SoundId } from '../audio/sounds';
import { prewarmHealSparkle } from '../sprites/healSparkleSprite';
import { hirelingDownedArrowCandidate, renderHirelingDownedMarker } from '../ui/HirelingDownedUI';
import type { ArrowCandidate } from '../ui/WorldArrow';
import type { Rect } from '../ui/core/geom';
import type { GameSystem, SystemContext } from './GameSystem';
import type { MobRoster } from './kits/SceneWorld';
import { hasAiAttention } from './MobUpdateLoop';
import { companionLeader, type CarriedCompanion } from './companionCarry';
import { hirelingShouldCatchUp } from '../creatures/mercenaries/hirelingCatchUp';
import type { Camera } from '../core/rendering/camera';
import type { TowerErrandLeg } from '../core/quests/missingCatsProgress';
import {
  WHOLE_PARTY_PRESENT,
  type CompanionRef,
  type PartyPresence,
} from '../core/party/partySplit';

/**
 * A point-in-time copy of the spawn state, for the in-run safe-room checkpoint.
 * The hire itself is durable state and is snapshotted with the roster.
 */
export interface MercenaryCheckpoint {
  /** Stored by reference: a snapshot names the merc, it does not clone it. */
  merc: Mercenary | null;
  spawnAttempted: boolean;
}

/** How far from the tile behind its owner a hire may be put when that tile is taken. */
const SPAWN_SEARCH_RADIUS_TILES = 3;
const TILE_CENTER = 0.5;

/** How close the active crawler must stand to talk to their hireling. */
const TALK_RANGE_TILES = 1.6;

/** A scene with no gore system (or a hireling with no `goreBodyPartKey`) needs nothing done. */
const NO_OP_GORE = (): void => {
  // Falling over is the whole death for a figure with no rubble to scatter.
};

/**
 * How the system reaches the player, which it cannot do itself: it holds no
 * audio and no HUD, so the scene hands in the two it has.
 */
export interface HirelingFeedback {
  toast(message: string): void;
  sound(id: SoundId): void;
}

const SILENT_FEEDBACK: HirelingFeedback = {
  toast: () => {
    // A harness has no toast strip.
  },
  sound: () => {
    // A harness has no speakers.
  },
};

const REVIVE_STARTED_SOUND = 'reviving_tone' as const satisfies SoundId;
const POTION_SOUND = 'healing_potion' as const satisfies SoundId;

function downedToast(name: string): string {
  return `${name} is down! Stand beside them to revive.`;
}

function diedToast(name: string): string {
  return `${name} has died.`;
}

function leavingDownedToast(name: string): string {
  return `${name} is down — revive them or leave them behind`;
}

/** A hire never walks off on its own; it leaves the line only by going down. */
function mercTrailStance(merc: Mercenary): TrailStance {
  return { isAlive: merc.isAlive, standing: !merc.isDowned, retreating: false };
}

/**
 * Manager for a hired mercenary (The Barracks Mercenaries' desk),
 * modelled on `DeinonychusSystem`. Each scene — a floor or a building's interior —
 * constructs a fresh instance from the persisted `MercenaryRoster`; if the
 * roster holds a contract for this floor, the merc is spawned near the active
 * player on the first frame and then follows and fights each frame like any
 * other mob.
 *
 * At zero HP a hire goes down rather than dying. Either crawler standing over
 * the body fills a revive exactly as for a knocked-out crawler; the hire's
 * revive window runs only while nobody is. A body left until the window runs
 * out, or left behind by the party walking out of the scene, dies.
 *
 * A contract ends two ways. Death is final: the body plays out and fades, the
 * roster forgets the hire and remembers the name for the desk. And the floor
 * ending ends it too, which is how the Barracks sells them — a roster that still
 * names a contract from another floor is cleared rather than respawned.
 * Leaving the scene goes through `dismissForTransition`, which despawns the
 * mob and leaves the roster to respawn it from the next scene's system.
 */
export class MercenarySystem implements GameSystem, TrailFollowSwitch {
  private merc: Mercenary | null = null;
  /** A hireling that has died and is still lying there. */
  private corpse: Mercenary | null = null;
  private spawnAttempted = false;
  /** Scratch list for the hireling's allies, refilled each frame. */
  private readonly allies: Player[] = [];
  /**
   * The crawlers who can revive a downed hire, as of the last `update`. Held by
   * reference, so their positions are always the current ones.
   */
  private reviverCandidates: readonly Player[] = [];
  /** The scene's mob list as of the last `update`, for letting go of a fallen hire. */
  private sceneMobs: readonly Mob[] = [];
  /** Whether the player has been warned, for this fall, that leaving loses the hire. */
  private warnedAboutLeaving = false;
  /** The hire's place on the party's line, while a room wants it there. */
  private trailLink: PartyLineLink | null = null;
  private trailMap: GameMap | null = null;

  /**
   * @param levelId the floor this scene stands on, stamped on the roster. Null
   *   in a building, which stands on the floor outside it and leaves the stamp
   *   that floor already wrote.
   */
  constructor(
    private readonly roster: MercenaryRoster,
    levelId: string | null,
    private readonly isInSafeRoom: (entity: {
      readonly x: number;
      readonly y: number;
    }) => boolean = () => false,
    private readonly feedback: HirelingFeedback = SILENT_FEEDBACK,
    private readonly presence: PartyPresence = WHOLE_PARTY_PRESENT,
    /** The leg of the tower errand the party is on, which keeps the hire's small talk to it; null off it. */
    private readonly towerErrandLeg: () => TowerErrandLeg | null = () => null,
  ) {
    if (levelId !== null) roster.floorLevelId = levelId;
  }

  /**
   * Puts the hire in its place on the party's line, or (null) hands it back
   * to its own feet. On the line it does not fight, the same as the crawler
   * it follows.
   */
  setTrailFollow(line: PartyLine | null): void {
    this.trailLink =
      line?.join(
        'hire',
        trailGroundOn(() => this.trailMap),
        () => this.trailWalker(),
      ) ?? null;
    if (line === null && this.merc !== null) this.merc.walksTrail = false;
  }

  /** The hire, while it is walking the line: on its feet, alive, and put there. */
  private trailWalker(): Mercenary | null {
    const merc = this.merc;
    if (merc?.walksTrail !== true) return null;
    return canWalkTrail(mercTrailStance(merc)) ? merc : null;
  }

  /**
   * The hireling standing and fighting, if there is one — added to the scene's
   * extra targets so hostiles engage it. Null while it is down: a body waiting
   * for a revive is nobody's target and nobody's ally to heal or shield.
   */
  get activeMerc(): Mercenary | null {
    const merc = this.merc;
    return merc !== null && !merc.isDowned ? merc : null;
  }

  /** The hireling lying on the floor waiting for a revive, if there is one. */
  get downedMerc(): Mercenary | null {
    const merc = this.merc;
    return merc?.isDowned === true ? merc : null;
  }

  /**
   * Whether a save must wait. The roster only ever records a standing hire, so
   * a save taken while one lies downed would hold its contract and its health
   * from before the fall, and a reload would stand it up for free — the same
   * free revive a save refused over a knocked-out crawler.
   */
  get revivePending(): boolean {
    return this.downedMerc !== null;
  }

  update(ctx: SystemContext): void {
    const { gameMap, active, partner } = ctx;
    const presentCrawlers = partner === null ? [active] : [active, partner];
    this.reviverCandidates = presentCrawlers;
    this.sceneMobs = ctx.roster.mobs;

    this.sweepCorpse(ctx.roster.mobs, ctx.roster.grid);
    this.announceDeath();

    const hired = this.roster.active;
    const hireRef: CompanionRef | null =
      hired === null ? null : { kind: 'mercenary', hire: hired.id };
    const owner = hireRef === null ? active : this.ownerOf(hireRef, ctx);
    if (!this.spawnAttempted && owner !== null) {
      this.spawnAttempted = this.spawn(owner, gameMap, ctx.roster);
    }

    const merc = this.merc;
    if (merc !== null && owner === null) {
      this.dismissForTransition(ctx.roster.mobs, ctx.roster.grid);
      return;
    }
    if (!merc?.isAlive || owner === null) return;

    merc.keepToTowerErrand(this.towerErrandLeg());
    merc.owner = owner;
    merc.cat = ctx.cat;
    merc.allMobs = ctx.roster.mobs;
    this.allies.length = 0;
    this.allies.push(...presentCrawlers);
    for (const extra of ctx.extraTargets ?? []) {
      if (extra !== merc) this.allies.push(extra);
    }
    merc.allies = this.allies;
    this.catchUpIfLeftBehind(merc, gameMap, ctx.roster.grid, ctx.camera);
    this.trailMap = gameMap;
    const trailLink = this.trailLink;
    merc.walksTrail = trailLink !== null && canWalkTrail(mercTrailStance(merc));
    if (merc.walksTrail && trailLink !== null) trailLink.step(merc, ctx, ctx.roster.grid);

    const heal = merc.tickSurvival();
    if (heal?.kind === 'potion') this.feedback.sound(POTION_SOUND);
    this.recordHp(merc);
  }

  /**
   * The hire's health for the frame, called (like `DeinonychusSystem.checkHealth`)
   * after mob damage resolution but *before* `resolveKills`.
   *
   * A standing hire at zero HP goes down here instead of dying: the killing
   * blow's `justDied` is cleared so combat resolution never processes the
   * player's own paid ally as a slain enemy — no kill XP, kill stat or
   * `mobKilled` — and the body keeps its place in the mob list and the grid.
   * A downed hire has its frame on the floor run here: the revive, or the
   * window running down. When the window runs out the hire dies for good, and
   * its body plays out its fade through the corpse sweep in `resolveKills`.
   *
   * `mobKilled` never fires for a hire, so `spawnGore` is the only chance a
   * figure that comes apart on death (a `goreBodyPartKey` set on its art,
   * currently just Tumbledown) gets to scatter its rubble — the caller is
   * expected to be the scene's own gore spawn, not the kill-XP path.
   */
  checkHealth(spawnGore: (merc: Mercenary) => void = NO_OP_GORE): void {
    const merc = this.merc;
    if (!merc) return;
    if (merc.isDowned) {
      this.tickDowned(merc, spawnGore);
      return;
    }
    if (merc.isAlive && merc.hp > 0) return;
    this.knockDown(merc);
  }

  /**
   * The killing blow put the hire on the floor instead. Everything the blow
   * latched for a kill is undone here, the way `DeinonychusSystem.checkHealth` does
   * it, so `resolveKills` never sees one: no `mobKilled`, no XP, no gore.
   */
  private knockDown(merc: Mercenary): void {
    merc.justDied = false;
    merc.killedBy = null;
    merc.killedByDealer = null;
    merc.killType = null;
    merc.damageTakenBy.clear();
    merc.goDown();
    this.releaseTargeting(merc);
    this.warnedAboutLeaving = false;
    this.feedback.toast(downedToast(merc.displayName));
  }

  /**
   * Drops every reference a hostile holds to the fallen hire. Hostiles pick
   * their targets from the live list each frame, but one that was mid-swing at
   * it would otherwise keep its hold on the body until the next pick.
   */
  private releaseTargeting(merc: Mercenary): void {
    for (const mob of this.sceneMobs) {
      if (mob.retaliateMob === merc) mob.retaliateMob = null;
      if (mob.currentTarget === merc) mob.currentTarget = null;
    }
  }

  /** Stands a downed hire back up on the spot, silently, as a script gathering the party does. */
  reviveDownedQuietly(): void {
    const merc = this.downedMerc;
    if (merc === null) return;
    merc.getUpQuietly();
    this.recordHp(merc);
  }

  /** One frame on the floor: the revive, or the window running down. */
  private tickDowned(merc: Mercenary, spawnGore: (merc: Mercenary) => void): void {
    const tick = merc.tickDowned(this.crawlerInReviveReach(merc));
    if (tick === 'revive_started') this.feedback.sound(REVIVE_STARTED_SOUND);
    else if (tick === 'revived') {
      merc.getUp();
      this.recordHp(merc);
    } else if (tick === 'expired') this.killForGood(merc, spawnGore);
  }

  /**
   * Whether either crawler, up and about, stands close enough to revive the
   * body — measured the way a knocked-out crawler's reviver is.
   */
  private crawlerInReviveReach(merc: Mercenary): boolean {
    return this.reviverCandidates.some(
      (crawler) =>
        crawler.isAlive &&
        !crawler.isKnockedOut &&
        Math.hypot(crawler.x - merc.x, crawler.y - merc.y) <= REVIVE_RANGE_PX,
    );
  }

  /** The end of the contract: the body plays out and fades, and the desk is told. */
  private killForGood(merc: Mercenary, spawnGore: (merc: Mercenary) => void): void {
    merc.justDied = false;
    merc.beginDeath();
    if (merc.bodyPartKey !== null) spawnGore(merc);
    this.corpse = merc;
    this.merc = null;
    this.recordDeath(merc);
  }

  private recordDeath(merc: Mercenary): void {
    const name = this.roster.active?.name ?? merc.displayName;
    this.roster.lastDeceased = name;
    this.roster.unannouncedDeath = name;
    this.roster.active = null;
    activeRunStats()?.recordMercenaryLost();
  }

  /**
   * Every permanent death is announced from here and nowhere else, one frame
   * after it is recorded, so a death that two paths could each resolve is still
   * told once — and one resolved at a door is told by the scene on the far side.
   */
  private announceDeath(): void {
    const name = this.roster.unannouncedDeath;
    if (name === undefined || name === null) return;
    this.roster.unannouncedDeath = null;
    this.feedback.toast(diedToast(name));
  }

  /**
   * Puts a hire that has fallen out of reach back behind its owner — too far
   * off to be seen, or stuck on its way home — the way `DeinonychusSystem` rescues a
   * stranded pet: onto a tile the owner can see and it can move in, re-indexed
   * in the grid so blows aimed at it land. Never mid-fight — its own or a
   * hostile's with it — which would be pulling it out of a fight it is in.
   */
  private catchUpIfLeftBehind(
    merc: Mercenary,
    gameMap: GameMap,
    mobGrid: SpatialGrid<Mob>,
    camera: Pick<Camera, 'viewWidth' | 'viewHeight'>,
  ): void {
    if (merc.isFighting) return;
    const owner = merc.owner;
    const offsetX = merc.x - owner.x;
    const offsetY = merc.y - owner.y;
    // The camera follows the active crawler, whom the hire follows, so the
    // screen is judged as the camera's view centred on its owner.
    const onScreen =
      Math.abs(offsetX) <= camera.viewWidth / 2 && Math.abs(offsetY) <= camera.viewHeight / 2;
    const leftBehind = hirelingShouldCatchUp({
      distancePx: Math.hypot(offsetX, offsetY),
      onScreen,
      followStallFrames: merc.followStallFrames,
      // Only a hostile the mob loop still ticks: one the party has walked away
      // from holds its target frozen, and would hold the hire beside it forever.
      engagedByHostile: this.sceneMobs.some(
        (mob) =>
          mob.isAlive &&
          mob.isHostile &&
          (mob.currentTarget === merc || mob.retaliateMob === merc) &&
          hasAiAttention(mob, this.reviverCandidates),
      ),
    });
    if (!leftBehind) return;
    const tile = findSpawnTile(owner, gameMap);
    if (tile === null) return;
    const previousX = merc.x;
    const previousY = merc.y;
    merc.x = tile.x * TILE_SIZE;
    merc.y = tile.y * TILE_SIZE;
    mobGrid.move(merc, previousX, previousY);
    merc.onTeleported();
  }

  /** The standing hire, as one of the companions a scene moves with the party. */
  asCarriedCompanion(): CarriedCompanion {
    return {
      body: this.activeMerc,
      followsLiveGroup: this.merc?.owner.isAway !== true,
      landingTile: (map, isAcceptable) => {
        const merc = this.merc;
        return merc === null ? null : findSpawnTile(merc.owner, map, isAcceptable);
      },
      putAway: (mobs, grid) => this.dismissForTransition(mobs, grid),
      onPlaced: (mobs) => {
        this.sceneMobs = mobs;
        const merc = this.merc;
        if (merc === null) return;
        merc.allMobs = mobs;
        merc.onTeleported();
        // A shot readied where it stood belongs to the ground it left; the new
        // storey's projectile systems would otherwise fly it here.
        merc.clearAirborneAttacks();
      },
    };
  }

  /**
   * The party is taking the stairs inside one building. A standing hire goes
   * with them as a carried companion; this clears what cannot come off the
   * storey being left. A downed hire dies here, as at any door — its revive
   * belongs to the spot it fell — and a body still fading is swept, since the
   * storey's roster stops being ticked the moment the party is gone.
   */
  leaveStorey(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    const downed = this.downedMerc;
    if (downed !== null) {
      this.recordDeath(downed);
      removeMob(downed, mobs, mobGrid);
      this.merc = null;
    }
    if (this.corpse !== null) {
      removeMob(this.corpse, mobs, mobGrid);
      this.corpse = null;
    }
  }

  /**
   * The desk signed or ended a contract while the party stands in the room with
   * it. Whatever stood for the old contract leaves without its health being
   * written — the roster no longer describes it — and the next `update` stands
   * up whoever the roster names now.
   */
  onContractChanged(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    if (this.merc !== null) removeMob(this.merc, mobs, mobGrid);
    this.merc = null;
    this.spawnAttempted = false;
  }

  /** The live hire's health, written where a save or a scene change reads it. */
  private recordHp(merc: Mercenary): void {
    const hired = this.roster.active;
    if (hired !== null && merc.isAlive) hired.hp = merc.hp;
  }

  /**
   * Warns, once per fall, that the transition the party is about to make will
   * lose a downed hire — for the moment a door's prompt or a recall's channel
   * begins, when the player can still turn back.
   */
  warnIfLeavingDowned(): void {
    const merc = this.downedMerc;
    if (merc === null || this.warnedAboutLeaving) return;
    this.warnedAboutLeaving = true;
    this.feedback.toast(leavingDownedToast(merc.displayName));
  }

  /**
   * The floor is won, and the contract signed for it is over. The hireling says
   * goodbye; it is dismissed with the rest of the scene when the party leaves.
   */
  endContractForFloor(): void {
    this.merc?.bark('floor_end');
    this.roster.active = null;
  }

  /**
   * The Warden is gone, and the tower loan with him. A lent hire says goodbye
   * and walks with the party until it leaves the scene, as at a floor's end.
   *
   * @returns whether a loan was running and has now ended.
   */
  endTowerLoan(): boolean {
    if (this.roster.active?.terms !== 'tower_loan') return false;
    this.merc?.bark('loan_end');
    this.roster.active = null;
    return true;
  }

  /**
   * The hireling the active crawler can talk to from where they stand, if any.
   *
   * Talking is last in the Space chain, after the attack it would otherwise
   * share a key with, and the hireling stands inside talking range most of the
   * floor. So it is refused while any hostile is within reach of the crawler's
   * longest attack or of the hireling's own engage radius: with a fight on, the
   * press is a shot, never a chat.
   */
  talkTarget(active: HumanPlayer | CatPlayer, mobs: readonly Mob[]): Mercenary | null {
    const merc = this.merc;
    if (!merc?.isAlive) return null;
    const distance = Math.hypot(merc.x - active.x, merc.y - active.y);
    if (distance > TILE_SIZE * TALK_RANGE_TILES) return null;
    const clearancePx = Math.max(active.attackReachPx(), TILE_SIZE * merc.kit.engageRadiusTiles);
    const fightOn = mobs.some(
      (mob) => mob.isHostileTarget && Math.hypot(mob.x - active.x, mob.y - active.y) <= clearancePx,
    );
    return fightOn ? null : merc;
  }

  /** Talks to the hireling if the active crawler is beside it and no fight is on. */
  tryTalk(active: HumanPlayer | CatPlayer, mobs: readonly Mob[]): boolean {
    const merc = this.talkTarget(active, mobs);
    if (merc === null) return false;
    merc.talkTo(active);
    return true;
  }

  /**
   * Speech bubbles for the hireling, living or fallen, and a downed hire's
   * countdown and revive bar. Drawn over the entities.
   */
  renderSpeech(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const merc = this.merc;
    if (merc !== null) {
      renderHirelingDownedMarker(ctx, merc, merc.displayName, camX, camY);
      merc.renderSpeech(ctx, camX, camY);
    }
    this.corpse?.renderSpeech(ctx, camX, camY);
  }

  /** A candidate for the shared arrow arbiter, pointing at a downed hire it cannot see. */
  downedArrowCandidate(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    active: Player,
    visibleRadiusPx: number,
    avoidRect?: Rect,
  ): ArrowCandidate | null {
    const merc = this.downedMerc;
    if (merc === null) return null;
    return hirelingDownedArrowCandidate(ctx, merc, active, camera, visibleRadiusPx, avoidRect);
  }

  captureCheckpoint(): MercenaryCheckpoint {
    return { merc: this.merc, spawnAttempted: this.spawnAttempted };
  }

  /**
   * Rewinds the spawn state to match the restored roster.
   *
   * A merc that died after the checkpoint cannot simply be re-referenced: its
   * body is gone from the scene or on its way out. The hire lives in the
   * roster, which is rewound separately, so the honest rewind is to forget the
   * mob entirely and let the next `update` spawn a fresh one beside the player
   * from whatever the roster now says — the same path a scene rebuild takes.
   *
   * Precondition: any merc hired *after* the checkpoint, and any body, must
   * already be off the map (`dismiss`) when this runs. No mob list reaches this
   * method, so it cannot splice one out itself, and a merc left standing while
   * the roster forgets it is an orphan following the party for free.
   */
  restoreCheckpoint(snapshot: MercenaryCheckpoint): void {
    const sameMercStillStanding =
      this.merc !== null && this.merc === snapshot.merc && this.merc.isAlive;
    if (sameMercStillStanding) {
      this.spawnAttempted = snapshot.spawnAttempted;
      return;
    }
    this.merc = null;
    this.spawnAttempted = false;
  }

  /** The crawler the hire follows; null when its group is away from this map. */
  private ownerOf(hire: CompanionRef, ctx: SystemContext): Player | null {
    const leader = companionLeader(this.presence, hire, ctx);
    switch (leader.kind) {
      case 'together':
        return ctx.active;
      case 'away':
        return null;
      case 'group':
        return leader.crawler;
      default: {
        const unreachable: never = leader;
        return unreachable;
      }
    }
  }

  /**
   * Puts the hire on the ground behind its owner, if the contract is current.
   *
   * @returns whether spawning is settled for this scene: true once the hire
   *   stands, or when there is no current contract to stand; false when there
   *   was nowhere to put it this frame, so the next frame tries again.
   */
  private spawn(active: Player, gameMap: GameMap, roster: MobRoster): boolean {
    const hired = this.roster.active;
    if (!hired) return true;
    if (!contractIsCurrent(this.roster, hired)) {
      this.roster.active = null;
      return true;
    }

    const tile = findSpawnTile(active, gameMap);
    if (tile === null) return false;

    const merc = new Mercenary(tile.x, tile.y, TILE_SIZE, active, hired.id, hired.name);
    merc.hp = hirelingStartingHp(hired);
    // The desk warms the figure when the contract is signed, but a hire loaded
    // from a save, or walking back out of a building whose visit let its idle
    // cells go, arrives here cold: every spawn warms it again. Warming only
    // the hired figure keeps the other hirelings' cells out of memory.
    MERCENARY_ART[merc.template.art].prewarm();
    // Every hire drinks and heals up, and that is the sparkle it shows.
    prewarmHealSparkle();
    merc.safeRoomTest = this.isInSafeRoom;
    this.merc = merc;
    roster.add(merc);
    merc.keepToTowerErrand(this.towerErrandLeg());
    if (!hired.introduced) {
      hired.introduced = true;
      merc.bark('hired');
    }
    return true;
  }

  /** Drops a body whose fade has finished out of the mob list; the grid already let it go. */
  private sweepCorpse(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    const corpse = this.corpse;
    if (!corpse?.corpseExpired) return;
    removeMob(corpse, mobs, mobGrid);
    this.corpse = null;
  }

  /**
   * The party is leaving — through a door, down the stairs, by a recall warp —
   * and a standing hire goes with it: its health is written to the roster and
   * it is despawned, to be stood up again by whichever scene comes next.
   *
   * A downed hire cannot come. Its revive window is tied to the spot it fell,
   * and nobody is carrying the body, so leaving it forfeits it: it dies here,
   * exactly as if the window had run out.
   */
  dismissForTransition(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    const downed = this.downedMerc;
    if (downed !== null) this.recordDeath(downed);
    this.dismiss(mobs, mobGrid);
  }

  /**
   * The party leaves somewhere a downed hire cannot follow but a standing one
   * stays on with it — down the escape stairs at the end of the run. The body
   * dies as it would at a door; a hire on its feet is left where it is.
   */
  forfeitDownedHire(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    if (this.downedMerc !== null) this.dismissForTransition(mobs, mobGrid);
  }

  /**
   * Despawn the merc and any body without touching the contract (rewinds, and
   * every transition through `dismissForTransition`).
   *
   * The next `update` spawns the hire afresh beside the party if its contract
   * still stands: a warp keeps the same scene, and a hire that is only
   * despawned there would be gone for the rest of it. Every other caller
   * either replaces the scene or rewinds the spawn state itself.
   */
  dismiss(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    if (this.merc) {
      this.recordHp(this.merc);
      removeMob(this.merc, mobs, mobGrid);
    }
    if (this.corpse) removeMob(this.corpse, mobs, mobGrid);
    this.merc = null;
    this.corpse = null;
    this.spawnAttempted = false;
  }
}

/**
 * The tile behind the owner if the hire can stand there, else the nearest one
 * it can, or null if there is none.
 *
 * The owner's tile is read from her centre: `floor(x / TILE_SIZE)` is the tile
 * under her sprite's top-left corner, which in a corridor is the masonry her
 * sprite overhangs. Candidates must be in her sight, or the ring search would
 * solve a blocked corridor by putting the hire in the room through the wall,
 * and must not be stairwells, which `isWalkable` admits but
 * `Mob.moveWithCollision` refuses to enter. `isAcceptable` narrows the search
 * to a region the caller owns.
 */
export function findSpawnTile(
  active: Player,
  gameMap: GameMap,
  isAcceptable: TileFilter = ANY_TILE,
): { x: number; y: number } | null {
  const ownerCentreX = active.x + TILE_SIZE * TILE_CENTER;
  const ownerCentreY = active.y + TILE_SIZE * TILE_CENTER;
  const behindX = Math.floor(ownerCentreX / TILE_SIZE) - Math.round(active.facingX);
  const behindY = Math.floor(ownerCentreY / TILE_SIZE) - Math.round(active.facingY);
  const inOwnersSight = (x: number, y: number): boolean =>
    gameMap.hasLineOfSight(
      ownerCentreX,
      ownerCentreY,
      (x + TILE_CENTER) * TILE_SIZE,
      (y + TILE_CENTER) * TILE_SIZE,
    );
  return findNearbyWalkableTile(
    gameMap,
    behindX,
    behindY,
    SPAWN_SEARCH_RADIUS_TILES,
    (x, y) => inOwnersSight(x, y) && !gameMap.isStairwellTile(x, y) && isAcceptable(x, y),
  );
}

function removeMob(mob: Mob, mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
  mobGrid.remove(mob);
  const idx = mobs.indexOf(mob);
  if (idx >= 0) mobs.splice(idx, 1);
}
