import { CatAlly } from '../creatures/CatAlly';
import type { Mob } from '../creatures/Mob';
import {
  WHOLE_PARTY_PRESENT,
  type CatAllyId,
  type CompanionRef,
  type PartyPresence,
} from '../core/party/partySplit';
import type { CrawlerKind } from '../core/skills/SkillManager';
import type { SpatialGrid } from '../core/world/SpatialGrid';
import type { GameMap } from '../map/GameMap';
import type { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import { companionLeader, type CarriedCompanion } from './companionCarry';
import type { CompanionDirective } from './CompanionSystem';
import type { GameSystem, SystemContext } from './GameSystem';
import type { MobRoster } from './kits/SceneWorld';
import { findSpawnTile } from './MercenarySystem';
import { PartyTrail, trailGroundOn } from './partyTrail';

/**
 * Owns one cat ally in a scene: brings her out beside the crawler she
 * follows, points her at that crawler every frame, walks her on the party's
 * trail where a room wants it, and carries her through doors and up stairs
 * with the rest of the party.
 *
 * While the party is together she follows the crawler the scene names through
 * {@link followCrawler}. While it is split she follows her own group's crawler,
 * as the presence reports it, and is put away whenever her group is on another
 * map.
 */
export class CatAllySystem implements GameSystem {
  private cat: CatAlly | null = null;
  private leader: CrawlerKind = 'cat';
  private trail: PartyTrail | null = null;
  private trailMap: GameMap | null = null;
  private owner: Player | null = null;
  private standingOrder: CompanionDirective | null = null;

  constructor(
    readonly ally: CatAllyId,
    private readonly presence: PartyPresence = WHOLE_PARTY_PRESENT,
  ) {}

  /** How the party model names her. */
  get companionRef(): CompanionRef {
    return { kind: 'cat_ally', ally: this.ally };
  }

  /** The cat standing in the scene, if she is out — added to the scene's extra targets so hostiles engage her. */
  get body(): CatAlly | null {
    return this.cat;
  }

  /** Makes `crawler` the one she follows, while the party is together, from the next frame. */
  followCrawler(crawler: CrawlerKind): void {
    this.leader = crawler;
  }

  /** Sends her to a spot to stay there (a plate to sit on), until {@link clearDirective}. */
  setDirective(directive: CompanionDirective): void {
    this.standingOrder = { x: directive.x, y: directive.y, hold: directive.hold };
    if (this.cat !== null) this.cat.directive = this.standingOrder;
  }

  /** Drops her standing order; she follows her crawler again. */
  clearDirective(): void {
    this.standingOrder = null;
    if (this.cat !== null) this.cat.directive = null;
  }

  /**
   * Puts her on the followed crawler's own trail at `spacingPx` of walked
   * distance, or (null) hands her back to her own feet. On the trail she
   * does not fight.
   */
  setTrailFollow(spacingPx: number | null): void {
    this.trail =
      spacingPx === null
        ? null
        : new PartyTrail(
            spacingPx,
            trailGroundOn(() => this.trailMap),
          );
    if (spacingPx === null && this.cat !== null) this.cat.walksTrail = false;
  }

  /**
   * Brings her out on the nearest tile behind `owner`, or nowhere when there
   * is no tile she could stand on. A cat already out stays where she is.
   */
  bringOut(owner: Player, map: GameMap, roster: MobRoster): CatAlly | null {
    if (this.cat !== null) return this.cat;
    const tile = findSpawnTile(owner, map);
    if (tile === null) return null;
    const cat = new CatAlly(tile.x, tile.y, TILE_SIZE, this.ally, owner);
    cat.setMap(map);
    roster.add(cat);
    this.cat = cat;
    this.owner = owner;
    return cat;
  }

  /** Takes her out of the scene; her cells go with her. */
  putAway(mobs: Mob[], grid: SpatialGrid<Mob>): void {
    const cat = this.cat;
    if (cat === null) return;
    grid.remove(cat);
    const index = mobs.indexOf(cat);
    if (index >= 0) mobs.splice(index, 1);
    cat.appearance.release();
    this.cat = null;
  }

  update(ctx: SystemContext): void {
    const cat = this.cat;
    if (cat === null) return;
    const owner = this.ownerFor(ctx);
    if (owner === null) {
      this.putAway(ctx.roster.mobs, ctx.roster.grid);
      return;
    }
    this.owner = owner;
    cat.owner = owner;
    cat.allMobs = ctx.roster.mobs;
    cat.directive = this.standingOrder;
    this.trailMap = ctx.gameMap;
    cat.walksTrail = this.trail !== null;
    this.trail?.tick(owner, cat);
  }

  /** The crawler she follows this frame; null when her group is away from this map. */
  private ownerFor(ctx: SystemContext): Player | null {
    const leader = companionLeader(this.presence, this.companionRef, ctx);
    switch (leader.kind) {
      case 'together':
        return ctx[this.leader];
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

  asCarriedCompanion(): CarriedCompanion {
    return {
      body: this.cat,
      followsLiveGroup: this.owner?.isAway !== true,
      landingTile: (map, isAcceptable) => {
        const owner = this.owner;
        return owner === null ? null : findSpawnTile(owner, map, isAcceptable);
      },
      putAway: (mobs, grid) => this.putAway(mobs, grid),
      onPlaced: (mobs) => {
        const cat = this.cat;
        if (cat === null) return;
        cat.allMobs = mobs;
        cat.onTeleported();
      },
    };
  }

  dispose(): void {
    this.cat?.appearance.release();
    this.cat = null;
  }
}
