import { TILE_SIZE } from '../core/constants';
import type { AttackCowState } from '../core/AttackCowState';
import { REVIVE_RANGE_PX } from '../core/reviveRules';
import type { SpatialGrid } from '../core/SpatialGrid';
import { viewportHeight, viewportWidth } from '../core/Viewport';
import type { SoundId } from '../audio/sounds';
import { AttackCow, attackCowMaxHpForFloor } from '../creatures/AttackCow';
import type { Mob } from '../creatures/Mob';
import { hirelingShouldCatchUp } from '../creatures/mercenaries/hirelingCatchUp';
import type { GameMap } from '../map/GameMap';
import type { Player } from '../Player';
import { hirelingDownedArrowCandidate, renderHirelingDownedMarker } from '../ui/HirelingDownedUI';
import type { ArrowCandidate } from '../ui/WorldArrow';
import type { CarriedCompanion } from './companionCarry';
import type { GameSystem, SystemContext } from './GameSystem';
import type { MobRoster } from './kits/SceneWorld';
import { findSpawnTile } from './MercenarySystem';
import { hasAiAttention } from './MobUpdateLoop';

/**
 * Hostiles within this many tiles of her, that she can see, turn on her. A
 * little inside her engage radius, so what she draws is what she is about to
 * butt rather than a room she will never reach.
 */
export const ATTACK_COW_TAUNT_RADIUS_TILES = 4.5;
const TILE_CENTRE = 0.5;

const ARRIVAL_SOUND: SoundId = 'attack_cow_arrival';
const REVIVE_STARTED_SOUND: SoundId = 'reviving_tone';
const DOWNED_TOAST = 'The attack cow is down! Stand beside her to revive.';
const RESTING_TOAST = 'The attack cow limps off to rest. She will be back on the next floor.';

/**
 * How the system reaches the player: it holds no audio and no HUD of its own,
 * so the scene hands in the two it has.
 */
export interface AttackCowFeedback {
  toast(message: string): void;
  sound(id: SoundId): void;
}

const SILENT_FEEDBACK: AttackCowFeedback = {
  toast: () => {
    // A harness has no toast strip.
  },
  sound: () => {
    // A harness has no speakers.
  },
};

/**
 * Carl's attack cow, modelled on `MongoSystem` and `MercenarySystem`.
 *
 * Each scene — a floor or a building's interior — builds one from the shared
 * {@link AttackCowState}. If the party owns her and she is not resting, she is
 * stood up beside Carl on the scene's first frame and walks with him from
 * then on. There is no summon or recall: she is always out.
 *
 * At zero health she goes down for a crawler to revive. Left there past the
 * window, she limps off and lies down; the state records her as resting, and
 * she is back at full health on the next floor ({@link prepareForNewFloor}) or
 * the next load. She never dies for good.
 *
 * Her taunt lives here too: every frame the hostiles near her that can see her
 * are pointed at her through `Mob.tauntedBy`, and let go once they are not.
 */
export class AttackCowSystem implements GameSystem {
  cow: AttackCow | null = null;
  /** Hostiles currently pointed at her, so a lapsed taunt can be let go. */
  private readonly taunted = new Set<Mob>();
  private readonly tauntQuery = new Set<Mob>();
  private sceneMobs: readonly Mob[] = [];
  private crawlers: readonly Player[] = [];

  /**
   * @param floorNumber the floor she fights on, which levels her.
   * @param admitted false where she waits outside (the goblin prison), so
   *   this scene never stands her up.
   */
  constructor(
    private readonly state: AttackCowState,
    private readonly floorNumber: number,
    private readonly feedback: AttackCowFeedback = SILENT_FEEDBACK,
    private readonly admitted = true,
  ) {}

  /** On her feet, for the scene's extra targets: what hostiles may go for. */
  get standingCow(): AttackCow | null {
    const cow = this.cow;
    return cow?.isStanding === true ? cow : null;
  }

  get downedCow(): AttackCow | null {
    const cow = this.cow;
    return cow?.isDowned === true ? cow : null;
  }

  /** A save waits while she is down, or a reload would stand her up for free. */
  get revivePending(): boolean {
    return this.downedCow !== null;
  }

  /** Her maximum on this floor, for anything reading her health while she is not out. */
  get maxHp(): number {
    return attackCowMaxHpForFloor(this.floorNumber);
  }

  /**
   * The wheel's prize: the party owns her from now on, and she is standing
   * beside Carl at once, with a moo. Does nothing if she is already owned.
   *
   * @returns whether she was granted now.
   */
  grant(owner: Player, gameMap: GameMap, roster: MobRoster): boolean {
    if (this.state.owned) return false;
    this.state.owned = true;
    this.state.hp = null;
    this.state.scaledAgainstMaxHp = null;
    this.state.restingUntilFull = false;
    this.feedback.sound(ARRIVAL_SOUND);
    if (this.admitted) this.spawn(owner, gameMap, roster);
    return true;
  }

  /**
   * The party is taking the stairs to a new floor: she is rested and whole
   * again there, whatever she went through on this one.
   */
  prepareForNewFloor(): void {
    this.state.restingUntilFull = false;
    this.state.hp = null;
    this.state.scaledAgainstMaxHp = null;
  }

  update(ctx: SystemContext): void {
    this.sceneMobs = ctx.roster.mobs;
    this.crawlers = [ctx.human, ctx.cat];
    const owner = ctx.human;
    if (this.cow === null) {
      const due = this.admitted && this.state.owned && !this.state.restingUntilFull;
      if (due) this.spawn(owner, ctx.gameMap, ctx.roster);
      return;
    }
    const cow = this.cow;
    cow.owner = owner;
    cow.setLeader(owner);
    cow.allMobs = ctx.roster.mobs;
    if (cow.isStanding) {
      this.catchUpIfLeftBehind(cow, ctx.gameMap, ctx.roster.grid);
      this.taunt(cow, ctx.gameMap, ctx.roster.grid);
    } else {
      this.releaseTaunts();
    }
    this.recordState(cow);
  }

  /**
   * Her health for the frame, after mob damage and before `resolveKills`, the
   * way `MercenarySystem.checkHealth` takes a hireling's: a standing cow at
   * zero goes down instead of dying; a downed one has her frame on the ground.
   */
  checkHealth(): void {
    const cow = this.cow;
    if (cow === null) return;
    if (cow.isDowned) {
      this.tickDowned(cow);
      return;
    }
    if (!cow.isStanding || cow.hp > 0) return;
    cow.goDown();
    this.releaseTargeting(cow);
    this.feedback.toast(DOWNED_TOAST);
  }

  private tickDowned(cow: AttackCow): void {
    const inReach = this.crawlers.some(
      (crawler) =>
        crawler.isAlive &&
        !crawler.isKnockedOut &&
        Math.hypot(crawler.x - cow.x, crawler.y - cow.y) <= REVIVE_RANGE_PX,
    );
    const tick = cow.tickDowned(inReach);
    if (tick === 'revive_started') this.feedback.sound(REVIVE_STARTED_SOUND);
    else if (tick === 'revived') cow.getUp();
    else if (tick === 'expired') this.sendToRest(cow);
  }

  private sendToRest(cow: AttackCow): void {
    cow.limpOffToRest();
    this.state.restingUntilFull = true;
    this.state.hp = 0;
    this.feedback.toast(RESTING_TOAST);
  }

  /**
   * Writes her health where a save or the next scene reads it. Spent — down,
   * limping, lying in the grass — she is recorded at nothing: the one point
   * she is held at to stay drawn is not health she has.
   */
  private recordState(cow: AttackCow): void {
    this.state.hp = cow.isStanding ? cow.hp : 0;
    this.state.scaledAgainstMaxHp = cow.maxHp;
    if (cow.isOutForTheFloor) this.state.restingUntilFull = true;
  }

  /** Her starting health on this floor, carried from the state onto this floor's maximum. */
  private startingHp(): number | null {
    const hp = this.state.hp;
    const measuredAgainst = this.state.scaledAgainstMaxHp;
    if (hp === null || hp <= 0) return null;
    if (measuredAgainst === null || measuredAgainst <= 0) return hp;
    return Math.ceil((hp / measuredAgainst) * this.maxHp);
  }

  private spawn(owner: Player, gameMap: GameMap, roster: MobRoster): void {
    const tile = findSpawnTile(owner, gameMap);
    if (tile === null) return;
    const cow = new AttackCow(
      tile.x,
      tile.y,
      TILE_SIZE,
      owner,
      this.floorNumber,
      this.startingHp(),
    );
    cow.setMap(gameMap);
    cow.allMobs = roster.mobs;
    this.cow = cow;
    roster.add(cow);
    this.recordState(cow);
  }

  /** Every hostile near her that can see her turns on her; those that drift off are let go. */
  private taunt(cow: AttackCow, gameMap: GameMap, grid: SpatialGrid<Mob>): void {
    this.tauntQuery.clear();
    const nearby = grid.queryCircle(
      cow.x,
      cow.y,
      ATTACK_COW_TAUNT_RADIUS_TILES * TILE_SIZE,
      this.tauntQuery,
    );
    const cowCentreX = cow.x + TILE_SIZE * TILE_CENTRE;
    const cowCentreY = cow.y + TILE_SIZE * TILE_CENTRE;
    for (const mob of this.taunted) {
      if (nearby.has(mob) && this.canTaunt(mob)) continue;
      if (mob.tauntedBy === cow) mob.tauntedBy = null;
      this.taunted.delete(mob);
    }
    for (const mob of nearby) {
      if (!this.canTaunt(mob)) continue;
      const mobCentreX = mob.x + TILE_SIZE * TILE_CENTRE;
      const mobCentreY = mob.y + TILE_SIZE * TILE_CENTRE;
      if (!gameMap.hasLineOfSight(cowCentreX, cowCentreY, mobCentreX, mobCentreY)) continue;
      mob.tauntedBy = cow;
      mob.retaliateMob = cow;
      this.taunted.add(mob);
    }
  }

  /** A boss keeps its own mind, and a script's held mob is not hers to pull. */
  private canTaunt(mob: Mob): boolean {
    if (!mob.isAlive || !mob.isHostile || mob.isBoss) return false;
    if (mob.offLimitsToAllies || mob.isConverted) return false;
    return hasAiAttention(mob, this.crawlers);
  }

  private releaseTaunts(): void {
    for (const mob of this.taunted) {
      if (mob.tauntedBy === this.cow) mob.tauntedBy = null;
    }
    this.taunted.clear();
  }

  /** Drops every reference a mob holds to her: down, rested or gone, she is nobody's target. */
  private releaseTargeting(cow: AttackCow): void {
    this.releaseTaunts();
    for (const mob of this.sceneMobs) {
      if (mob.retaliateMob === cow) mob.retaliateMob = null;
      if (mob.currentTarget === cow) mob.currentTarget = null;
      if (mob.tauntedBy === cow) mob.tauntedBy = null;
    }
  }

  /**
   * Puts her back behind Carl when she has fallen out of sight or stuck on
   * the way, as a hireling is, never out of a fight of her own or one a hostile
   * is holding her in.
   */
  private catchUpIfLeftBehind(cow: AttackCow, gameMap: GameMap, grid: SpatialGrid<Mob>): void {
    if (cow.isFighting) return;
    const offsetX = cow.x - cow.owner.x;
    const offsetY = cow.y - cow.owner.y;
    const onScreen =
      Math.abs(offsetX) <= viewportWidth() / 2 && Math.abs(offsetY) <= viewportHeight() / 2;
    const leftBehind = hirelingShouldCatchUp({
      distancePx: Math.hypot(offsetX, offsetY),
      onScreen,
      followStallFrames: cow.followStallFrames,
      engagedByHostile: this.sceneMobs.some(
        (mob) =>
          mob.isAlive &&
          mob.isHostile &&
          (mob.currentTarget === cow || mob.retaliateMob === cow) &&
          hasAiAttention(mob, this.crawlers),
      ),
    });
    if (!leftBehind) return;
    const tile = findSpawnTile(cow.owner, gameMap);
    if (tile === null) return;
    const previousX = cow.x;
    const previousY = cow.y;
    cow.x = tile.x * TILE_SIZE;
    cow.y = tile.y * TILE_SIZE;
    grid.move(cow, previousX, previousY);
    cow.onTeleported();
  }

  /** Her, standing, as one of the companions a scene moves with the party. */
  asCarriedCompanion(): CarriedCompanion {
    return {
      body: this.standingCow,
      landingTile: (map) => {
        const cow = this.cow;
        return cow === null ? null : findSpawnTile(cow.owner, map);
      },
      putAway: (mobs, grid) => this.dismiss(mobs, grid),
      onPlaced: (mobs) => {
        this.sceneMobs = mobs;
        const cow = this.cow;
        if (cow === null) return;
        cow.allMobs = mobs;
        cow.dropTarget();
        cow.onTeleported();
      },
    };
  }

  /**
   * The party takes a tower's stairs. A cow standing goes with them as a
   * carried companion; one down or resting cannot be carried, and is put away
   * resting, exactly as at any door.
   */
  leaveStorey(mobs: Mob[], grid: SpatialGrid<Mob>): void {
    if (this.cow !== null && !this.cow.isStanding) this.dismiss(mobs, grid);
  }

  /**
   * Takes her off the map — a door, a warp, the stairs, a rewind — with her
   * health written into the state for whichever scene stands her up next. A
   * cow down or out for the floor goes to rest: nobody carries a body through
   * a door, and she never dies for good.
   */
  dismiss(mobs: Mob[], grid: SpatialGrid<Mob>): void {
    const cow = this.cow;
    if (cow === null) return;
    this.recordState(cow);
    if (!cow.isStanding) {
      this.state.restingUntilFull = true;
      this.state.hp = 0;
    }
    this.releaseTargeting(cow);
    grid.remove(cow);
    const index = mobs.indexOf(cow);
    if (index >= 0) mobs.splice(index, 1);
    this.cow = null;
  }

  /** The countdown over her while she is down, and the revive bar once someone is reviving. */
  renderOverlay(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const cow = this.downedCow;
    if (cow !== null) renderHirelingDownedMarker(ctx, cow, camX, camY);
  }

  /** A candidate for the shared arrow arbiter, pointing at her while she is down out of sight. */
  downedArrowCandidate(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Player,
    visibleRadiusPx: number,
  ): ArrowCandidate | null {
    const cow = this.downedCow;
    if (cow === null) return null;
    return hirelingDownedArrowCandidate(ctx, cow, active, camX, camY, visibleRadiusPx);
  }
}
