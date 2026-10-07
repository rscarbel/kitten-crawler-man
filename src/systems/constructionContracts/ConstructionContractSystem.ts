/**
 * Wendell's construction contracts on the floor-3 overworld: working a Briar
 * Hollow building's spots, and the contract's counter in the top band.
 *
 * Owned by `BriarHollowKit` beside `BlueprintsQuestSystem` and rebuilt with
 * it on every door visit, so it keeps nothing durable: the contract is
 * `state.contracts`. Briar Hollow's buildings are roofless rooms painted into
 * the overworld's tiles, so a rebuild spot's prop is held out of the map's
 * Y-sorted pass at draw time (the tile itself is never edited), and every
 * overlay is a dynamic layer drawn over the tile and prop pass, never baked
 * into a chunk cache. While the village is under siege the spots refuse
 * work.
 *
 * A Skyfowl Town contract is worked indoors (`ContractInteriorSite`); out
 * here it only shows its counter.
 *
 * Because it runs town-wide, it is also the contract's Journal row, the
 * village guide's say while a contract is short of materials, and a Briar
 * Hollow contact's thanks and payout once the work is done.
 */

import type { ActiveContract, BriarHollowState } from '../../core/briarHollowState';
import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import { canAfford, formatCost, partyCount, type ResourceCost } from '../../core/partyResources';
import { isVillageUnderSiege, type VillageQuestPhase } from '../../core/villageQuestPhase';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { NPCMarkerType } from '../../creatures/QuestNPC';
import type { Conversation } from '../../dialog/Conversation';
import { contractThanksLines } from '../../dialog/scripts/contractThanks';
import type { VillagerId } from '../../dialog/scripts/briarHollow';
import type { GameMap } from '../../map/GameMap';
import type { TilePoint } from '../../map/town/townPlan';
import { BUILDINGS, doorwayTiles, outwardStep } from '../../map/overworld/briarHollowLayout';
import { rectContains, type BriarHollowSite } from '../../map/overworld/briarHollowSite';
import { releaseContractArt } from '../../sprites/art/constructionContracts/contractArtCache';
import type { TopBandEntry } from '../../ui/hud/topBand';
import { PLUMBLINE_FARM_NAME } from '../briarHollow/blueprints/blueprintsProgress';
import {
  pointedGuidanceTarget,
  shortfallGuidance,
  type QuestGuidance,
} from '../briarHollow/questGuidance';
import type { QuestLineProvider, QuestOpening } from '../briarHollow/villagerCircumstances';
import type { VillagerSystem } from '../briarHollow/VillagerSystem';
import type { GameSystem } from '../GameSystem';
import type { QuestMarkerType } from '../MiniMapSystem';
import { doorwayBeaconTarget } from '../objectiveBeaconTargets';
import {
  characterTarget,
  type TrackerEntry,
  type TrackerSource,
  type TrackerTarget,
} from '../questTracker';
import type { TownPropRenderable } from '../townPropRenderable';
import type { WorkChannelBuilder } from '../WorkChannel';
import {
  contractSiteFor,
  contractSpot,
  type BriarHollowContractSiteDef,
  type ContractMaterialId,
  type ContractSiteDef,
} from './contractCatalog';
import { contractContactName } from './contractContacts';
import { contractPayout, isContractReady, remainingContractCost } from './contractGenerator';
import {
  CONSTRUCTION_CONTRACT_QUEST_ID,
  CONSTRUCTION_CONTRACT_QUEST_NAME,
  contractsUnlocked,
} from './contractQuest';
import { ContractSettlement, type ContractSettlementDeps } from './ContractSettlement';
import {
  ContractSiteWork,
  contractCounterEntry,
  decorationFigureLine,
  type ContractSiteWorkDeps,
} from './ContractSiteWork';
import { briarHollowSpotFootprint } from './contractTargets';

/** What a spot in reach says, and what a press on it is told, while the siege is on. */
export const CONTRACT_SIEGE_LINE = 'Not while the village is under siege.';

const IDLE_OBJECTIVE = 'Ask Wendell for a construction contract';
const SIEGE_HINT = 'Wait out the siege.';
const STORY_OWNED_HINT = 'Come back once things settle down.';

const CONTRACT_MATERIALS: readonly ContractMaterialId[] = ['wood_board', 'rope', 'stone'];

const HALF = 0.5;
const TILE_CENTRE = 0.5;

type TownBuildingGuidance = Extract<QuestGuidance, { readonly kind: 'town_building' }>;

export interface ConstructionContractSystemDeps {
  /** The village's durable state; the contract is `state.contracts`. */
  readonly state: BriarHollowState;
  readonly gameMap: GameMap;
  readonly site: BriarHollowSite;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly audio: ContractSiteWorkDeps['audio'];
  /** The scene's bus, which the payout's `questCompleted` goes out on. */
  readonly bus: EventBus;
  /** The scene's one conversation, which Wendell's note after a payout opens on. */
  readonly conversation: Conversation;
  /** The village's civilians, whose contacts pay out through a quest line of this system's. */
  readonly villagers: Pick<
    VillagerSystem,
    'addQuestLineProvider' | 'removeQuestLineProvider' | 'villagerFor'
  >;
  /** Flies paid coins from a world position to the HUD's coin pill. */
  readonly flyCoins: ContractSettlementDeps['flyCoins'];
  /**
   * Where a soldier contact stands right now, or null when `id` is no
   * soldier on this map; the militia are not among the civilians.
   */
  readonly soldierTile: (id: VillagerId) => TilePoint | null;
  /**
   * Whether a story state owns a Skyfowl Town room right now, so its spots
   * are inert and its contact away. Absent means none ever does.
   */
  readonly skyfowlRoomOwnedByStory?: (buildingName: string) => boolean;
  /** A one-line toast over the HUD. */
  readonly announce: (message: string) => void;
  /** Keeps the resource strip up while a spot is being worked. */
  readonly noteResourceActivity: () => void;
  /** Whether the world is stopped under a menu. */
  readonly worldHalted: () => boolean;
  /** "Briar Hollow's Plea"'s phase, for the siege. */
  readonly pleaPhase: () => VillageQuestPhase;
}

export class ConstructionContractSystem implements GameSystem, QuestLineProvider, TrackerSource {
  /** The shared spot work, exposed for a headless check to finish spots through. */
  readonly work: ContractSiteWork;
  /** A Briar Hollow contact's payout and Wendell's note after it, exposed for a headless check. */
  readonly settlement: ContractSettlement;
  /** Decoration tiles this system holds out of the map's Y-sorted pass. */
  private readonly hiddenTileKeys = new Set<number>();
  /** Scratch for {@link syncHiddenTiles}, reused so the per-frame check allocates nothing. */
  private readonly wantedTileKeys = new Set<number>();
  /** The work's revision the hidden tiles were last synced at. */
  private hiddenTilesRevision: number | null = null;

  constructor(private readonly deps: ConstructionContractSystemDeps) {
    const { gameMap, site } = deps;
    this.work = new ContractSiteWork({
      state: deps.state,
      human: deps.human,
      cat: deps.cat,
      audio: deps.audio,
      siteHere: (candidate) => candidate.town === 'briar_hollow',
      resolveFootprint: (candidate, spot) =>
        candidate.town === 'briar_hollow' ? briarHollowSpotFootprint(candidate, spot, site) : null,
      // The roofless walls, and the props standing against them, are Y-sorted
      // decorations; damage on them sorts with what it marks, so a full-height
      // north wall that covers a prop south of it covers that prop's damage too.
      sortLineFor: (footprint) =>
        footprint.surface === 'floor' ? null : decorationFigureLine(footprint.rect, gameMap),
      settlement: 'hollow',
      announce: deps.announce,
      worldHalted: deps.worldHalted,
      standDownReason: () => (this.underSiege ? CONTRACT_SIEGE_LINE : null),
      noteResourceActivity: deps.noteResourceActivity,
    });
    this.settlement = new ContractSettlement({
      state: deps.state,
      bus: deps.bus,
      audio: deps.audio,
      conversation: deps.conversation,
      flyCoins: deps.flyCoins,
    });
    this.syncHiddenTiles();
    // Ahead of every other questline: it speaks only while a client owes the
    // party, and a questline that always has a word for its villager (the
    // Mayor's after the Plea) would otherwise keep the payment from ever
    // being made.
    deps.villagers.addQuestLineProvider(this, { first: true });
  }

  /** The state this system reads and writes, for whatever else the contract's overworld side needs. */
  get state(): BriarHollowState {
    return this.deps.state;
  }

  /** Whether the village's siege has the spots standing down. */
  get underSiege(): boolean {
    return isVillageUnderSiege(this.deps.pleaPhase());
  }

  /** The active contract's site in either town, or null with none held. */
  get activeSite(): ContractSiteDef | null {
    const active = this.deps.state.contracts.active;
    return active === null ? null : (contractSiteFor(active.site) ?? null);
  }

  /** Whether the active contract has every spot done and waits on its contact's payment. */
  get isReady(): boolean {
    const active = this.deps.state.contracts.active;
    return active !== null && isContractReady(active);
  }

  /** Whether a spot channel is running. */
  get isWorking(): boolean {
    return this.work.isWorking;
  }

  update(): void {
    this.work.update();
    this.syncHiddenTiles();
    this.settlement.update();
  }

  /**
   * Keeps the map's hidden decorations in step with the unfinished rebuild
   * spots, so a finished spot's prop is back on the next frame and a
   * dropped contract leaves nothing stripped.
   */
  private syncHiddenTiles(): void {
    const revision = this.work.revision;
    if (revision === this.hiddenTilesRevision) return;
    this.hiddenTilesRevision = revision;
    const wanted = this.wantedTileKeys;
    wanted.clear();
    for (const spot of this.work.hiddenRebuildSpots()) {
      for (const key of spot.tileKeys) wanted.add(key);
    }
    const hidden = this.deps.gameMap.hiddenDecorationTiles;
    for (const key of this.hiddenTileKeys) {
      if (wanted.has(key)) continue;
      hidden.delete(key);
      this.hiddenTileKeys.delete(key);
    }
    for (const key of wanted) {
      if (this.hiddenTileKeys.has(key)) continue;
      hidden.add(key);
      this.hiddenTileKeys.add(key);
    }
  }

  // ── The contact ──────────────────────────────────────────────────────────

  /** The Briar Hollow site whose finished contract `villager` is due to pay for, or null. */
  private payingSite(villager: VillagerId): BriarHollowContractSiteDef | null {
    if (!this.isReady || this.underSiege) return null;
    const site = this.activeSite;
    if (site?.town !== 'briar_hollow' || site.contact !== villager) return null;
    return site;
  }

  /** The Briar Hollow villager or soldier a finished contract waits to be paid by, siege allowing; null otherwise. */
  get owedContact(): VillagerId | null {
    if (!this.isReady || this.underSiege) return null;
    const site = this.activeSite;
    return site?.town === 'briar_hollow' ? site.contact : null;
  }

  /** A Briar Hollow contact's thanks, which pays the party out however the talk ends. */
  lineFor(villager: VillagerId): QuestOpening | null {
    const site = this.payingSite(villager);
    const active = this.deps.state.contracts.active;
    if (site === null || active === null) return null;
    return {
      pages: contractThanksLines(
        { town: 'briar_hollow', contact: site.contact },
        {
          siteName: site.name,
          payout: contractPayout(active),
          variant: this.deps.state.contracts.contractsCompleted,
        },
      ),
      questRelated: true,
      after: { kind: 'close', onClosed: () => void this.settlement.settle(this.activeCrawler()) },
    };
  }

  /** The green `?` over a Briar Hollow contact while their payment waits, siege allowing. */
  markerFor(villager: VillagerId): NPCMarkerType {
    return this.payingSite(villager) === null ? 'none' : 'question';
  }

  /** Whether Wendell's note after a payout is on screen. */
  get isFollowUpOpen(): boolean {
    return this.settlement.isFollowUpOpen;
  }

  /** Escape on Wendell's note. Returns whether it was showing. */
  dismissFollowUp(): boolean {
    return this.settlement.dismissFollowUp();
  }

  private activeCrawler(): HumanPlayer | CatPlayer {
    return this.deps.human.isActive ? this.deps.human : this.deps.cat;
  }

  // ── Guidance ─────────────────────────────────────────────────────────────

  /** Whether the active site is held by a story state: the siege, or a Skyfowl Town room's fight. */
  private siteHeldByStory(site: ContractSiteDef): boolean {
    if (site.town === 'briar_hollow') return this.underSiege;
    return this.deps.skyfowlRoomOwnedByStory?.(site.buildingName) === true;
  }

  /**
   * What the village guide should highlight while a contract has work left:
   * where to gather what the party is short of, or the site itself. Null with
   * nothing to work, and while the site is held by a story state.
   */
  guidance(): QuestGuidance | null {
    const active = this.deps.state.contracts.active;
    const site = this.activeSite;
    if (active === null || site === null || isContractReady(active)) return null;
    if (this.siteHeldByStory(site)) return null;
    const remaining = remainingContractCost(active);
    if (!canAfford(this.deps.human, this.deps.cat, remaining)) {
      return shortfallGuidance(this.deps.human, this.deps.cat, remaining);
    }
    return this.siteGuidance(site);
  }

  /** The site's door, as the guide and the Journal point at it. */
  private siteGuidance(site: ContractSiteDef): TownBuildingGuidance | null {
    const door =
      site.town === 'skyfowl' ? this.townBuildingDoor(site.buildingName) : this.villageDoor(site);
    if (door === null) return null;
    return {
      kind: 'town_building',
      buildingName: site.name,
      residentName: contractContactName(site),
      door,
    };
  }

  private townBuildingDoor(buildingName: string): TrackerTarget | null {
    const entry = this.deps.gameMap.buildingEntries.find(
      (candidate) => candidate.name === buildingName,
    );
    return doorwayBeaconTarget(entry ?? null);
  }

  /**
   * The tile just outside a Briar Hollow building's first doorway, at its
   * middle; for the forge, sawmill and barn, whose doorway is the whole open
   * side, that is the middle of the open side.
   */
  private villageDoor(site: BriarHollowContractSiteDef): TrackerTarget | null {
    const building = this.deps.site.buildings.find((candidate) => candidate.id === site.buildingId);
    const spec = BUILDINGS.find((template) => template.id === site.buildingId)?.doorways[0];
    if (building === undefined || spec === undefined) return null;
    const tiles = doorwayTiles(building.rect, spec);
    if (tiles.length === 0) return null;
    const middle = tiles[Math.floor(tiles.length * HALF)];
    const step = outwardStep(spec.side);
    return { x: middle.x + step.dx, y: middle.y + step.dy };
  }

  /** Where the Journal points for the active site: its door, or its contact once they owe the party. */
  private siteTarget(site: ContractSiteDef, ready: boolean): TrackerTarget | undefined {
    if (ready && site.town === 'briar_hollow') {
      const tile =
        this.deps.villagers.villagerFor(site.contact)?.tile ?? this.deps.soldierTile(site.contact);
      if (tile !== null) return characterTarget(tile);
    }
    const guidance = this.siteGuidance(site);
    const door = guidance === null ? null : pointedGuidanceTarget(guidance);
    if (door === null) return undefined;
    // Once the party is inside, the spots' own ground highlights say where the
    // work is, and a beam back at the doorway would point the wrong way.
    return site.town === 'briar_hollow' && this.crawlerInsideBuilding(site)
      ? { ...door, wearsOwnMarker: true }
      : door;
  }

  private crawlerInsideBuilding(site: BriarHollowContractSiteDef): boolean {
    const building = this.deps.site.buildings.find((candidate) => candidate.id === site.buildingId);
    if (building === undefined) return false;
    const crawler = this.activeCrawler();
    return rectContains(
      building.rect,
      Math.floor(crawler.x / TILE_SIZE + TILE_CENTRE),
      Math.floor(crawler.y / TILE_SIZE + TILE_CENTRE),
    );
  }

  // ── The journal ──────────────────────────────────────────────────────────

  trackerEntries(): ReadonlyArray<TrackerEntry> {
    const entry = this.trackerEntry();
    return entry === null ? [] : [entry];
  }

  private trackerEntry(): TrackerEntry | null {
    if (!contractsUnlocked(this.deps.state)) return null;
    const base = { id: CONSTRUCTION_CONTRACT_QUEST_ID, name: CONSTRUCTION_CONTRACT_QUEST_NAME };
    const active = this.deps.state.contracts.active;
    const site = this.activeSite;
    if (active === null || site === null) {
      return {
        ...base,
        status: 'available',
        objective: IDLE_OBJECTIVE,
        target: this.wendellsDoor(),
      };
    }
    const ready = isContractReady(active);
    const blockedHint = this.blockedHint(site);
    const target = this.siteTarget(site, ready);
    if (ready) {
      return {
        ...base,
        status: 'active',
        objective: `Collect payment from ${contractContactName(site)}`,
        hint: blockedHint ?? undefined,
        target,
      };
    }
    const done = active.spotsDone.filter(Boolean).length;
    return {
      ...base,
      status: 'active',
      objective: `Repairs at ${site.name}: ${done}/${active.spotsDone.length} done`,
      hint: blockedHint ?? this.workHint(site, active),
      target,
    };
  }

  /**
   * Plumbline Farm's door, beamed only once the player pins the offer: Wendell
   * wears his own `!` and glow indoors, so until then only the minimap pip
   * points at the farm.
   */
  private wendellsDoor(): TrackerTarget | undefined {
    const door = this.townBuildingDoor(PLUMBLINE_FARM_NAME);
    return door === null ? undefined : { ...door, litOnlyWhenPinned: true };
  }

  private blockedHint(site: ContractSiteDef): string | null {
    if (!this.siteHeldByStory(site)) return null;
    return site.town === 'briar_hollow' ? SIEGE_HINT : STORY_OWNED_HINT;
  }

  /** Each unfinished spot with its bill, then what the party is still short of. */
  private workHint(site: ContractSiteDef, active: ActiveContract): string {
    const spots = active.spotIds.flatMap((id, index) => {
      const spot = active.spotsDone[index] ? undefined : contractSpot(site, id);
      return spot === undefined ? [] : [`${spot.label} (${formatCost(spot.cost)})`];
    });
    const short = this.shortfall(remainingContractCost(active));
    const shortText = formatCost(short);
    const spotText = `${spots.join('; ')}.`;
    return shortText === '' ? spotText : `${spotText} Still short: ${shortText}.`;
  }

  private shortfall(cost: ResourceCost): ResourceCost {
    const short: ResourceCost = {};
    for (const material of CONTRACT_MATERIALS) {
      const held = partyCount(this.deps.human, this.deps.cat, material);
      short[material] = Math.max(0, (cost[material] ?? 0) - held);
    }
    return short;
  }

  /** A minimap pip wherever the Journal points. */
  get questMarkers(): Array<{ x: number; y: number; type: QuestMarkerType }> {
    const entry = this.trackerEntry();
    const target = entry?.target;
    if (entry === null || target === undefined) return [];
    const type: QuestMarkerType = entry.status === 'available' ? 'exclamation' : 'question';
    return [{ x: target.x, y: target.y, type }];
  }

  /** The contract's counter while any of its spots, in either town, are unfinished. */
  topBandEntries(): TopBandEntry[] {
    const entry = contractCounterEntry(this.deps.state.contracts.active);
    return entry === null ? [] : [entry];
  }

  /**
   * See `ContractSiteWork.wouldInteract`. `competingTiles` is how far the
   * nearest other target the same press would reach stands (a villager, a
   * machine), or null when nothing else would take it.
   */
  wouldInteract(active: WorkChannelBuilder, competingTiles: number | null): boolean {
    return this.work.wouldInteract(active, competingTiles);
  }

  /** Space, from `BriarHollowKit.tryInteract`; see `ContractSiteWork.tryInteract`. */
  tryInteract(active: WorkChannelBuilder, competingTiles: number | null): boolean {
    return this.work.tryInteract(active, competingTiles);
  }

  /** A world tap in world pixels, from `BriarHollowKit.handleTap`. */
  handleTap(
    worldX: number,
    worldY: number,
    active: WorkChannelBuilder,
    competingTiles: number | null,
  ): boolean {
    return this.work.handleTap(worldX, worldY, active, competingTiles);
  }

  /** Ends a channel under way, for the death screen, which stops this system's ticks. */
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

  /** Damage on walls and standing props, merged into the overworld's Y-sorted pass. */
  renderEntities(): readonly TownPropRenderable[] {
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

  onRewind(): void {
    this.work.onRewind();
    this.syncHiddenTiles();
  }

  dispose(): void {
    this.deps.villagers.removeQuestLineProvider(this);
    this.work.dispose();
    for (const key of this.hiddenTileKeys) this.deps.gameMap.hiddenDecorationTiles.delete(key);
    this.hiddenTileKeys.clear();
    releaseContractArt();
  }
}
