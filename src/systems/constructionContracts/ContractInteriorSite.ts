/**
 * A Skyfowl Town building's construction contract, worked from inside it.
 *
 * Built by `BuildingInteriorScene` beside the resident quest hooks, and only
 * for the ground floor of the building that hosts the active contract while
 * no story state owns the room. Wraps the shared `ContractSiteWork` with what
 * only the interior knows: where a spot lies in this room's generated grid,
 * how its overlays sort among the room's figures, which placed props a
 * rebuild hides, and which ones a swing must leave standing.
 */

import { TILE_SIZE } from '../../core/constants';
import type { InteriorFigure } from '../../core/InteriorFigure';
import type { BriarHollowState } from '../../core/briarHollowState';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { GameMap } from '../../map/GameMap';
import { releaseContractArt } from '../../sprites/art/constructionContracts/contractArtCache';
import { interiorRoomOwnedByStory, type InteriorStoryState } from '../interiorStoryOwnership';
import type { WorkChannelBuilder } from '../WorkChannel';
import { contractSiteFor, skyfowlContractSite } from './contractCatalog';
import {
  ContractSiteWork,
  decorationFigureLine,
  type ContractSiteWorkDeps,
} from './ContractSiteWork';
import { skyfowlSpotFootprint, type ContractSpotFootprint } from './contractTargets';

/** Every Skyfowl Town contract building is worked on its ground floor. */
const CONTRACT_FLOOR = 0;

export interface ContractInteriorSiteDeps {
  readonly state: BriarHollowState;
  /**
   * The story records that decide whether a story state owns this room,
   * read live: a quest accepted inside the room can take it over mid-visit.
   */
  readonly story: () => InteriorStoryState;
  /** The ground floor's map, the one the building's layout was generated into. */
  readonly gameMap: GameMap;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly audio: ContractSiteWorkDeps['audio'];
  /** A one-line toast over the hotbar. */
  readonly toast: (message: string) => void;
  /** Whether the world is stopped under a menu. */
  readonly worldHalted: () => boolean;
}

export class ContractInteriorSite {
  /** The shared spot work, exposed for a headless check to finish spots through. */
  readonly work: ContractSiteWork;
  /** {@link hiddenProps}'s answer, rebuilt only when the spots or the broken props change. */
  private readonly hiddenBuffer = new Set<string>();
  private hiddenFor: {
    revision: number;
    broken: ReadonlySet<string> | undefined;
    brokenCount: number;
    answer: ReadonlySet<string> | undefined;
  } | null = null;
  private protectedFor: { revision: number; ids: ReadonlySet<string> } | null = null;

  private constructor(buildingName: string, deps: ContractInteriorSiteDeps) {
    const gameMap = deps.gameMap;
    this.work = new ContractSiteWork({
      state: deps.state,
      human: deps.human,
      cat: deps.cat,
      audio: deps.audio,
      siteHere: (site) => site.town === 'skyfowl' && site.buildingName === buildingName,
      resolveFootprint: (site, spot) =>
        site.town === 'skyfowl' ? skyfowlSpotFootprint(site, spot, gameMap) : null,
      sortLineFor: (footprint) => interiorSortLine(footprint, gameMap),
      settlement: 'skyfowl',
      announce: deps.toast,
      worldHalted: deps.worldHalted,
      inert: () => interiorRoomOwnedByStory(buildingName, deps.story()),
    });
  }

  /**
   * The contract site for this room, or null unless it is the ground floor of
   * the building the active contract names and no story state owns the room.
   * A contract issued for a room a fight later took over waits, inert, until
   * the room is free again.
   */
  static forBuilding(
    buildingName: string,
    floor: number,
    deps: ContractInteriorSiteDeps,
  ): ContractInteriorSite | null {
    if (floor !== CONTRACT_FLOOR) return null;
    const site = skyfowlContractSite(buildingName);
    const active = deps.state.contracts.active;
    if (site === undefined || active === null) return null;
    if (contractSiteFor(active.site) !== site) return null;
    if (interiorRoomOwnedByStory(buildingName, deps.story())) return null;
    return new ContractInteriorSite(buildingName, deps);
  }

  update(): void {
    this.work.update();
  }

  /**
   * Space, ahead of examine/search/use; see `ContractSiteWork.tryInteract`.
   * `competingTiles` is how far the occupant the same press would talk to
   * stands, or null when nobody would answer.
   */
  tryInteract(active: WorkChannelBuilder, competingTiles: number | null): boolean {
    return this.work.tryInteract(active, competingTiles);
  }

  /** A world tap in world pixels; see `ContractSiteWork.handleTap`. */
  handleTap(
    worldX: number,
    worldY: number,
    active: WorkChannelBuilder,
    competingTiles: number | null,
  ): boolean {
    return this.work.handleTap(worldX, worldY, active, competingTiles);
  }

  /** Ends a channel under way, for the death screen, which stops this site's ticks. */
  cancelWork(): void {
    this.work.cancelWork();
  }

  renderGround(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: WorkChannelBuilder,
  ): void {
    this.work.renderGround(ctx, camX, camY, active);
  }

  /** Damage on the room's standing props, for its Y-sorted pass; list them after the props. */
  sortedFigures(): readonly InteriorFigure[] {
    return this.work.sortedOverlays();
  }

  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.work.renderAbove(ctx, camX, camY);
  }

  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: WorkChannelBuilder,
    competingTiles: number | null,
  ): boolean {
    return this.work.renderPrompt(ctx, camX, camY, active, competingTiles);
  }

  /**
   * `broken` plus every placed prop an unfinished rebuild spot hides, for the
   * room's prop draw lists. Returns `broken` itself when nothing is hidden.
   */
  hiddenProps(broken: ReadonlySet<string> | undefined): ReadonlySet<string> | undefined {
    const revision = this.work.revision;
    const brokenCount = broken?.size ?? 0;
    const cached = this.hiddenFor;
    if (
      cached !== null &&
      cached.revision === revision &&
      cached.broken === broken &&
      cached.brokenCount === brokenCount
    ) {
      return cached.answer;
    }
    const rebuilds = this.work.hiddenRebuildSpots();
    let answer = broken;
    if (rebuilds.length > 0) {
      const hidden = this.hiddenBuffer;
      hidden.clear();
      for (const id of broken ?? []) hidden.add(id);
      for (const spot of rebuilds) {
        if (spot.def.target.kind === 'prop') hidden.add(spot.def.target.placedId);
      }
      answer = hidden;
    }
    this.hiddenFor = { revision, broken, brokenCount, answer };
    return answer;
  }

  /** Every placed prop the contract targets; a swing or a blast must leave these standing. */
  protectedProps(): ReadonlySet<string> {
    const revision = this.work.revision;
    if (this.protectedFor?.revision !== revision) {
      this.protectedFor = { revision, ids: this.work.targetedPropIds() };
    }
    return this.protectedFor.ids;
  }

  dispose(): void {
    this.work.dispose();
    releaseContractArt();
  }
}

/**
 * Where a spot's damage sorts among the room's figures: a prop's on the prop's
 * own sort line, a wall's or doorway's on the decoration it lies on, and a
 * floor's nowhere (it lies on the ground layer).
 */
function interiorSortLine(footprint: ContractSpotFootprint, gameMap: GameMap): number | null {
  const { rect } = footprint;
  if (footprint.surface === 'prop') return (rect.y + rect.h - 1) * TILE_SIZE;
  if (footprint.surface === 'floor') return null;
  return decorationFigureLine(rect, gameMap);
}
