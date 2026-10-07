/**
 * Working a construction contract's spots, in whichever scene the spots are
 * standing in: finding the spot in reach, its prompt and cost row, the work
 * channel, and what finishing a spot spends and marks.
 *
 * Shared by the interior scene (through `ContractInteriorSite`) and Briar
 * Hollow's overworld (through `ConstructionContractSystem`). Everything
 * durable is `state.contracts.active`; this part binds to whichever contract
 * is active whenever its site is one the owner says is here, and goes inert
 * the moment the contract is dropped, finished or replaced. The channel in
 * progress and the finish puffs are the only things held here.
 */

import type { AudioManager } from '../../audio/AudioManager';
import { TILE_SIZE } from '../../core/constants';
import type { ActiveContract, BriarHollowState } from '../../core/briarHollowState';
import { canAfford, costRequirements, spend, type ResourceCost } from '../../core/partyResources';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { GameMap } from '../../map/GameMap';
import { tileCoordKey } from '../../map/tileIndex';
import type { TilePoint, TileRect } from '../../map/town/townPlan';
import {
  contractSpotArtSeed,
  getContractBuildSite,
  getContractOverlay,
  type ContractArtImage,
  type ContractOverlaySpec,
  type ContractSettlement,
} from '../../sprites/art/constructionContracts/contractArtCache';
import {
  CONTRACT_FINISH_PUFF_SECONDS,
  drawContractFinishPuff,
  drawContractSpotGlow,
  type ContractRectPx,
} from '../../sprites/art/constructionContracts/contractEffectsArt';
import { REPAIR_ROWS } from '../../sprites/art/humanFigure';
import {
  drawInteractionPrompt,
  interactionPromptsSuppressed,
  interactionPromptTop,
} from '../../ui/InteractionPrompt';
import { drawRequirementRow } from '../../ui/RequirementRow';
import {
  drawAreaHighlightFrame,
  drawAreaHighlightGround,
  type AreaHighlightMood,
} from '../../ui/AreaHighlight';
import { activeInputMode, byInputMode } from '../../ui/core/inputMode';
import type { TopBandEntry } from '../../ui/hud/topBand';
import { worldPalette } from '../../ui/theme/worldInk';
import { worldBar } from '../../ui/world/worldShapes';
import { questCounterEntry } from '../briarHollow/QuestCounterHud';
import {
  CONSTRUCTION_XP,
  UPDATES_PER_SECOND,
  WALL_TIERS,
  jobFrames,
} from '../briarHollow/structureRules';
import { WorkChannel, type WorkChannelBuilder } from '../WorkChannel';
import {
  contractSiteFor,
  contractSpot,
  type ContractSiteDef,
  type ContractSpotDef,
} from './contractCatalog';
import { contractContactName } from './contractContacts';
import { isContractReady } from './contractGenerator';
import {
  contractMaterialCues,
  playContractCue,
  startContractWorkLoop,
  type ContractCue,
  type ContractLoopAudio,
  type ContractWorkLoopHandle,
} from './contractSoundCues';
import { footprintTiles, type ContractSpotFootprint } from './contractTargets';

/** How near the nearest tile of a spot's footprint the active crawler must stand to work it. */
export const CONTRACT_REACH_TILES = 1.5;
/** Every spot's channel takes this long before its materials are counted in. */
export const CONTRACT_SPOT_BASE_SECONDS = 1.5;
/** Added to the channel for every board, rope and stone the spot uses. */
export const CONTRACT_SECONDS_PER_MATERIAL = 0.25;
/** What the party is told when a spot is pressed, or finishes, without the materials for it. */
export const CONTRACT_SHORT_MESSAGE = 'Not enough materials.';
/** The top-band counter's id, in both scenes. */
export const CONTRACT_COUNTER_ENTRY_ID = 'construction_contract';

/**
 * Construction XP per material a spot uses, priced off a wooden wall so the
 * skill's level landmarks (counted in wooden walls) stay in one place.
 */
export const CONTRACT_XP_PER_MATERIAL = Math.round(
  CONSTRUCTION_XP.woodenWall / Math.max(1, costMaterialCount(WALL_TIERS.wood.upgradeCost ?? {})),
);

const FINISHED_TEXT: Readonly<Record<ContractSpotDef['kind'], string>> = {
  repair: 'Repaired',
  rebuild: 'Rebuilt',
};

const TILE_CENTRE = 0.5;
const MS_PER_SECOND = 1000;
/** How often the resource strip is kept up while a spot is worked, so it shows what is about to go. */
const RESOURCE_NOTE_INTERVAL_FRAMES = UPDATES_PER_SECOND;
const PROGRESS_BAR_WIDTH = 36;
const PROGRESS_BAR_HEIGHT = 5;
const PROGRESS_BAR_LIFT_PX = 10;
/** Gap between the SPACE prompt and the cost line stacked above it. */
const COST_LINE_GAP_PX = 12;
/** How far a finished prop's sheen climbs above its footprint: roughly one tile of standing furniture. */
const PROP_STANDING_HEIGHT_TILES = 1;
/**
 * Spots whose art stands up off the floor, so a body or the wall itself can
 * hide the ground outline: these are framed over every body as well.
 */
const STANDING_SURFACES: ReadonlySet<ContractSpotFootprint['surface']> = new Set(['prop', 'wall']);
/**
 * An overlay sorts this far past the thing it marks, so the Y-sort's tie
 * order can never put the prop back over its own damage.
 */
const SORT_AFTER_TARGET_PX = 0.5;
/**
 * Culling is on the overlay's anchor alone, so its reach is the spot's
 * longest side plus this tile for the art that spills past the footprint.
 */
const OVERLAY_CULL_SLACK_TILES = 1;

/** One spot of the bound contract, resolved onto the map the party is standing on. */
export interface ContractWorkSpot {
  /** Its index in the contract's `spotIds` and `spotsDone`. */
  readonly index: number;
  readonly def: ContractSpotDef;
  readonly footprint: ContractSpotFootprint;
  /** The spot's art cache key: unique across both towns. */
  readonly cacheKey: string;
  /**
   * The world-pixel line its damage overlay sorts on in the scene's Y-sorted
   * pass, in the convention of that pass's figures' `y`; null draws it on
   * the ground layer under every body.
   */
  readonly sortLine: number | null;
  /** Every tile of the footprint. */
  readonly tiles: readonly TilePoint[];
  /** `tileCoordKey` of every tile of the footprint. */
  readonly tileKeys: readonly number[];
  /** What its art is painted from; fixed for the spot's life, so built once. */
  readonly artSpec: ContractOverlaySpec;
}

/** A damage overlay entered into a scene's Y-sorted pass, shaped for both the interior's figures and the overworld's props. */
export interface ContractOverlayFigure {
  readonly x: number;
  readonly y: number;
  readonly cullMarginTiles: number;
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void;
}

export interface ContractSiteWorkDeps {
  /** The durable record; read through every time, since a restore replaces `contracts` wholesale. */
  readonly state: Pick<BriarHollowState, 'contracts'>;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly audio: (ContractLoopAudio & Pick<AudioManager, 'play'>) | null;
  /** Whether a contract at `site` is worked in this scene. */
  readonly siteHere: (site: ContractSiteDef) => boolean;
  /** Where a spot lies on this scene's map, or null when the map has lost its target. */
  readonly resolveFootprint: (
    site: ContractSiteDef,
    spot: ContractSpotDef,
  ) => ContractSpotFootprint | null;
  /** See {@link ContractWorkSpot.sortLine}. */
  readonly sortLineFor: (footprint: ContractSpotFootprint) => number | null;
  readonly settlement: ContractSettlement;
  /** A one-line toast over the HUD. */
  readonly announce: (message: string) => void;
  /** Whether the world is stopped under a menu; the channel waits while it is. */
  readonly worldHalted: () => boolean;
  /**
   * Why the spots refuse work right now ("Not while the village is under
   * siege."), or null while they take it. Absent means never.
   */
  readonly standDownReason?: () => string | null;
  /**
   * Whether a story state has taken the site over: the spots then show and
   * take nothing at all, and a channel under way ends. Absent means never.
   */
  readonly inert?: () => boolean;
  /** Keeps the resource strip up while a spot is being worked. */
  readonly noteResourceActivity?: () => void;
}

interface BoundSpot extends ContractWorkSpot {
  /** Its entry in the Y-sorted pass, or null when its art lies on the ground layer. */
  readonly figure: ContractOverlayFigure | null;
}

interface BoundContract {
  readonly active: ActiveContract;
  readonly site: ContractSiteDef;
  readonly spots: readonly BoundSpot[];
}

interface SpotJob {
  readonly spot: ContractWorkSpot;
  readonly channel: WorkChannel;
  readonly loop: ContractWorkLoopHandle;
  framesWorked: number;
}

/** The number of every material a cost uses. */
export function costMaterialCount(cost: ResourceCost): number {
  return Object.values(cost).reduce((sum, amount) => sum + amount, 0);
}

/** How many update frames a spot's channel takes for a builder at `constructionLevel`. */
export function contractSpotFrames(spot: ContractSpotDef, constructionLevel: number): number {
  const seconds =
    CONTRACT_SPOT_BASE_SECONDS + CONTRACT_SECONDS_PER_MATERIAL * costMaterialCount(spot.cost);
  return jobFrames(seconds, constructionLevel);
}

/** "Repairs 2/5" while the contract still has spots to work; null with none held or every spot done. */
export function contractCounterLabel(active: ActiveContract | null): string | null {
  if (active === null || isContractReady(active)) return null;
  const done = active.spotsDone.filter(Boolean).length;
  return `Repairs ${done}/${active.spotsDone.length}`;
}

/** The top band's contract counter, or null when there is no work to count. */
export function contractCounterEntry(active: ActiveContract | null): TopBandEntry | null {
  const label = contractCounterLabel(active);
  return label === null ? null : questCounterEntry(CONTRACT_COUNTER_ENTRY_ID, label);
}

/**
 * The latest sort line among the decorations under `rect`, converted to a
 * figure's `y` (both scenes' passes sort a figure one tile below its `y`), or
 * null when no decoration is drawn there.
 */
export function decorationFigureLine(
  rect: TileRect,
  gameMap: Pick<GameMap, 'decorationSortYAt'>,
): number | null {
  let latest: number | null = null;
  for (const tile of footprintTiles(rect)) {
    const line = gameMap.decorationSortYAt(tile.x, tile.y);
    if (line !== null && (latest === null || line > latest)) latest = line;
  }
  return latest === null ? null : latest - TILE_SIZE;
}

function constructionLevelOf(crawler: WorkChannelBuilder): number {
  const skills = crawler.craftSkills;
  return skills.isLearned('construction') ? skills.getLevel('construction') : 0;
}

/**
 * Distance in tiles from a crawler's centre to the nearest of `tiles`' centres:
 * the measure {@link CONTRACT_REACH_TILES} is held against.
 */
export function tilesToFootprint(
  crawler: Pick<WorkChannelBuilder, 'x' | 'y'>,
  tiles: readonly TilePoint[],
): number {
  const centreX = crawler.x / TILE_SIZE + TILE_CENTRE;
  const centreY = crawler.y / TILE_SIZE + TILE_CENTRE;
  let nearest = Number.POSITIVE_INFINITY;
  for (const tile of tiles) {
    const tiles = Math.hypot(tile.x + TILE_CENTRE - centreX, tile.y + TILE_CENTRE - centreY);
    nearest = Math.min(nearest, tiles);
  }
  return nearest;
}

/** A screen rectangle reused by the per-frame draws, so they allocate nothing. */
export interface ScratchRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectOnScreen(
  rect: TileRect,
  camX: number,
  camY: number,
  into: ScratchRect,
): ContractRectPx {
  into.x = rect.x * TILE_SIZE - camX;
  into.y = rect.y * TILE_SIZE - camY;
  into.w = rect.w * TILE_SIZE;
  into.h = rect.h * TILE_SIZE;
  return into;
}

function nowSeconds(): number {
  return performance.now() / MS_PER_SECOND;
}

/** A highlight's look and clock, reused by the per-frame draws so they allocate nothing. */
interface ScratchHighlight {
  color: string;
  nowMs: number;
  mood: AreaHighlightMood;
}

/**
 * The colour a spot's highlight takes in `mood`: gold while it can be worked,
 * orange while it would refuse, as the Blueprints station upgrades mark theirs.
 */
export function contractSpotHighlightColor(mood: AreaHighlightMood): string {
  return mood === 'ready' ? worldPalette.objective.ready : worldPalette.objective.pending;
}

/**
 * The screen rectangle a standing spot's frame spans, or null for a spot
 * that lies on the floor and is marked by its ground outline alone. A prop's
 * frame climbs to the top of the furniture rather than stopping at its foot.
 */
export function contractSpotFrameRect(
  footprint: ContractSpotFootprint,
  camX: number,
  camY: number,
  into: ScratchRect,
): ContractRectPx | null {
  if (!STANDING_SURFACES.has(footprint.surface)) return null;
  const rise = footprint.surface === 'prop' ? PROP_STANDING_HEIGHT_TILES * TILE_SIZE : 0;
  const { rect } = footprint;
  into.x = rect.x * TILE_SIZE - camX;
  into.y = rect.y * TILE_SIZE - camY - rise;
  into.w = rect.w * TILE_SIZE;
  into.h = rect.h * TILE_SIZE + rise;
  return into;
}

export class ContractSiteWork {
  private bound: BoundContract | null = null;
  /** The `active` record last bound from, so an unchanged contract (or one worked elsewhere) is never re-resolved. */
  private boundFrom: ActiveContract | null | undefined = undefined;
  private wasInert = false;
  private job: SpotJob | null = null;
  /** When each spot of the bound contract was finished this visit, by index, for its puff. */
  private readonly finishedAt = new Map<number, number>();
  /** Each spot's painted art, by index; repainted if the shared art cache gave it back. */
  private readonly artByIndex = new Map<number, ContractArtImage>();
  private readonly overlayBuffer: ContractOverlayFigure[] = [];
  private readonly scratchRect: ScratchRect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly scratchHighlight: ScratchHighlight = {
    color: contractSpotHighlightColor('ready'),
    nowMs: 0,
    mood: 'ready',
  };
  /** Distance in tiles to the spot {@link nearestInReach} last returned. */
  private reachTiles = Number.POSITIVE_INFINITY;
  private revisionCount = 0;

  constructor(private readonly deps: ContractSiteWorkDeps) {
    this.sync();
  }

  /**
   * Changes whenever which spots are unfinished here could have changed: a
   * new binding, a finished spot, the site going inert or coming back. Lets
   * an owner rebuild anything derived from the spots only when it must.
   */
  get revision(): number {
    this.sync();
    return this.revisionCount;
  }

  /** The active contract this scene is working, or null when its site is elsewhere, inert, or none is held. */
  get activeContract(): ActiveContract | null {
    return this.sync()?.active ?? null;
  }

  /** The bound contract's site, or null. */
  get activeSite(): ContractSiteDef | null {
    return this.sync()?.site ?? null;
  }

  /** Every spot of the bound contract that resolved onto this map, finished or not. */
  get spots(): readonly ContractWorkSpot[] {
    return this.sync()?.spots ?? [];
  }

  /** Whether a work channel is running. */
  get isWorking(): boolean {
    return this.job !== null;
  }

  /** The spot being worked, or null. */
  get workingSpot(): ContractWorkSpot | null {
    return this.job?.spot ?? null;
  }

  isSpotDone(spot: ContractWorkSpot): boolean {
    const bound = this.sync();
    return bound === null || bound.active.spotsDone[spot.index];
  }

  /** The unfinished spots, in contract order. */
  unfinishedSpots(): ContractWorkSpot[] {
    const bound = this.sync();
    if (bound === null) return [];
    return bound.spots.filter((spot) => !bound.active.spotsDone[spot.index]);
  }

  /**
   * Placed-prop ids (or village `contractSpotId`s) of every prop the bound
   * contract targets, finished or not: none of them may be smashed while the
   * contract stands.
   */
  targetedPropIds(): Set<string> {
    const ids = new Set<string>();
    for (const spot of this.spots) {
      if (spot.def.target.kind === 'prop') ids.add(spot.def.target.placedId);
    }
    return ids;
  }

  /** The props an unfinished rebuild spot hides behind its build site. */
  hiddenRebuildSpots(): ContractWorkSpot[] {
    return this.unfinishedSpots().filter(
      (spot) => spot.def.kind === 'rebuild' && spot.def.target.kind === 'prop',
    );
  }

  private standDownReason(): string | null {
    return this.deps.standDownReason?.() ?? null;
  }

  /** Why working `spot` would be refused right now, or null when it would start. */
  private refusal(spot: ContractWorkSpot): string | null {
    const standDown = this.standDownReason();
    if (standDown !== null) return standDown;
    return canAfford(this.deps.human, this.deps.cat, spot.def.cost) ? null : CONTRACT_SHORT_MESSAGE;
  }

  /**
   * Rebinds to the active contract whenever it changes (a new one, a drop, a
   * restore that replaced the record) and stands everything down while the
   * site is inert. Any channel on the old binding ends.
   */
  private sync(): BoundContract | null {
    const active = this.deps.state.contracts.active;
    if (active !== this.boundFrom) {
      this.boundFrom = active;
      this.endJob();
      this.finishedAt.clear();
      this.artByIndex.clear();
      this.bound = active === null ? null : this.bind(active);
      this.revisionCount++;
    }
    const inert = this.deps.inert?.() === true;
    if (inert !== this.wasInert) {
      this.wasInert = inert;
      this.revisionCount++;
    }
    if (inert) {
      this.endJob();
      return null;
    }
    return this.bound;
  }

  private bind(active: ActiveContract): BoundContract | null {
    const site = contractSiteFor(active.site);
    if (site === undefined || !this.deps.siteHere(site)) return null;
    const spots: BoundSpot[] = [];
    active.spotIds.forEach((spotId, index) => {
      const def = contractSpot(site, spotId);
      if (def === undefined) return;
      const footprint = this.deps.resolveFootprint(site, def);
      if (footprint === null) return;
      const cacheKey = `${site.slug}:${def.id}`;
      const tiles = footprintTiles(footprint.rect);
      const sortLine = this.deps.sortLineFor(footprint);
      const spot: ContractWorkSpot = {
        index,
        def,
        footprint,
        cacheKey,
        sortLine,
        tiles,
        tileKeys: tiles.map((tile) => tileCoordKey(tile.x, tile.y)),
        artSpec: {
          cacheKey,
          material: def.material,
          surface: footprint.surface,
          settlement: this.deps.settlement,
          widthTiles: footprint.rect.w,
          heightTiles: footprint.rect.h,
          tilePx: TILE_SIZE,
          seed: contractSpotArtSeed(cacheKey),
        },
      };
      spots.push({ ...spot, figure: this.figureFor(spot) });
    });
    return { active, site, spots };
  }

  /** A spot's entry in the Y-sorted pass, or null when its art lies on the ground layer. */
  private figureFor(spot: ContractWorkSpot): ContractOverlayFigure | null {
    // A rebuild's prop is hidden, so its stripped site lies flat on the floor.
    if (spot.def.kind === 'rebuild' || spot.sortLine === null) return null;
    const { rect } = spot.footprint;
    return {
      x: rect.x * TILE_SIZE,
      y: spot.sortLine + SORT_AFTER_TARGET_PX,
      cullMarginTiles: Math.max(rect.w, rect.h) + OVERLAY_CULL_SLACK_TILES,
      render: (ctx, camX, camY) => this.drawSpotArt(ctx, spot, camX, camY),
    };
  }

  /**
   * The unfinished spot nearest `crawler` within reach, or null; its
   * distance in tiles is left in {@link reachTiles}.
   */
  private nearestInReach(crawler: WorkChannelBuilder): BoundSpot | null {
    const bound = this.sync();
    if (bound === null) return null;
    let best: BoundSpot | null = null;
    let bestTiles = Number.POSITIVE_INFINITY;
    for (const spot of bound.spots) {
      if (bound.active.spotsDone[spot.index]) continue;
      const tiles = tilesToFootprint(crawler, spot.tiles);
      if (tiles > CONTRACT_REACH_TILES || tiles >= bestTiles) continue;
      best = spot;
      bestTiles = tiles;
    }
    this.reachTiles = bestTiles;
    return best;
  }

  /** The unfinished spot `crawler` could work from where it stands, or null. */
  spotInReach(crawler: WorkChannelBuilder): ContractWorkSpot | null {
    return this.nearestInReach(crawler);
  }

  /**
   * The spot a press from `crawler` would go to, or null when it goes
   * elsewhere. `competingTiles` is how far the nearest other thing the same
   * press would reach stands (a person to talk to, a machine to work), or
   * null when nothing else would take it. A nearer competitor wins, and a
   * spot that would only refuse (the siege, materials short) steps aside for
   * any competitor at all, so it never swallows a press meant for the saw.
   * While a channel runs, a spot in reach takes every press.
   */
  private pressTarget(
    crawler: WorkChannelBuilder,
    competingTiles: number | null,
  ): BoundSpot | null {
    const spot = this.nearestInReach(crawler);
    if (spot === null) return null;
    if (this.job !== null || competingTiles === null) return spot;
    if (competingTiles < this.reachTiles) return null;
    return this.refusal(spot) === null ? spot : null;
  }

  /** Whether a press from `crawler` would reach a spot; see {@link pressTarget}. */
  wouldInteract(crawler: WorkChannelBuilder, competingTiles: number | null = null): boolean {
    return this.pressTarget(crawler, competingTiles) !== null;
  }

  /**
   * Space: starts the channel on the spot in reach, or says why it cannot.
   * Returns whether the press was taken; see {@link pressTarget} for when it
   * is left to something else.
   */
  tryInteract(active: WorkChannelBuilder, competingTiles: number | null = null): boolean {
    const spot = this.pressTarget(active, competingTiles);
    if (spot === null) return false;
    if (this.job === null) this.startWork(spot, active);
    return true;
  }

  /**
   * A world tap at world pixel (`worldX`, `worldY`): taken only when it lands
   * on the footprint of the spot in reach, and then starts that spot's
   * channel the way Space would. A spot that would only refuse leaves the
   * tap to a competitor (`competingTiles` non-null), as Space does.
   */
  handleTap(
    worldX: number,
    worldY: number,
    active: WorkChannelBuilder,
    competingTiles: number | null = null,
  ): boolean {
    const spot = this.nearestInReach(active);
    if (spot === null) return false;
    const { x, y, w, h } = spot.footprint.rect;
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    const onSpot = tileX >= x && tileX < x + w && tileY >= y && tileY < y + h;
    if (!onSpot) return false;
    if (this.job !== null) return true;
    if (competingTiles !== null && this.refusal(spot) !== null) return false;
    this.startWork(spot, active);
    return true;
  }

  private startWork(spot: ContractWorkSpot, builder: WorkChannelBuilder): void {
    const refusal = this.refusal(spot);
    if (refusal !== null) {
      this.deps.announce(refusal);
      return;
    }
    const face = this.facingToward(spot.footprint.rect, builder);
    const channel = new WorkChannel({
      builder,
      totalFrames: contractSpotFrames(spot.def, constructionLevelOf(builder)),
      faceX: face.x,
      faceY: face.y,
      humanRows: REPAIR_ROWS,
      stillWanted: () => this.stillWanted(spot),
    });
    const cues = contractMaterialCues(spot.def.material);
    this.job = {
      spot,
      channel,
      loop: startContractWorkLoop(this.deps.audio, spot.def.material),
      framesWorked: 0,
    };
    if (cues.start !== null) this.cue(cues.start);
    this.deps.noteResourceActivity?.();
  }

  private stillWanted(spot: ContractWorkSpot): boolean {
    const bound = this.sync();
    if (bound === null || this.standDownReason() !== null) return false;
    return !bound.active.spotsDone[spot.index];
  }

  private facingToward(
    rect: TileRect,
    builder: WorkChannelBuilder,
  ): { readonly x: number; readonly y: number } {
    const fromX = builder.x + TILE_SIZE * TILE_CENTRE;
    const fromY = builder.y + TILE_SIZE * TILE_CENTRE;
    const toX = Math.min(Math.max(fromX, rect.x * TILE_SIZE), (rect.x + rect.w) * TILE_SIZE);
    const toY = Math.min(Math.max(fromY, rect.y * TILE_SIZE), (rect.y + rect.h) * TILE_SIZE);
    const distance = Math.hypot(toX - fromX, toY - fromY);
    if (distance === 0) return { x: builder.facingX, y: builder.facingY };
    return { x: (toX - fromX) / distance, y: (toY - fromY) / distance };
  }

  /** Once per gameplay frame: advances the channel, ending it however the work stopped. */
  update(): void {
    this.sync();
    const job = this.job;
    if (job === null) return;
    const result = job.channel.tick(this.deps.worldHalted());
    if (result === 'working') {
      job.loop.keepAlive();
      job.framesWorked++;
      if (job.framesWorked % RESOURCE_NOTE_INTERVAL_FRAMES === 0) {
        this.deps.noteResourceActivity?.();
      }
      return;
    }
    this.endJob();
    if (result === 'finished') this.finishSpot(job.spot.index, job.channel.builder);
  }

  /**
   * Finishes spot `index` of the bound contract as if `builder` had just
   * worked it: the materials are counted again and spent all or nothing,
   * the spot is marked done, and its cues, text and XP follow. The channel
   * calls this when its work runs out; a headless check calls it directly.
   * Returns whether the spot was finished.
   */
  finishSpot(index: number, builder: WorkChannelBuilder): boolean {
    const bound = this.sync();
    if (bound === null) return false;
    const spot = bound.spots.find((candidate) => candidate.index === index);
    if (spot === undefined || bound.active.spotsDone[index]) return false;
    const { human, cat } = this.deps;
    // Counted again rather than trusted from the press: the materials may
    // have left the packs while the work was going.
    if (!spend(human, cat, spot.def.cost, builder)) {
      this.deps.announce(CONTRACT_SHORT_MESSAGE);
      return false;
    }
    bound.active.spotsDone[index] = true;
    this.revisionCount++;
    this.finishedAt.set(index, nowSeconds());
    this.cue(contractMaterialCues(spot.def.material).finish);
    this.cue('spotFinished');
    builder.queueFloatingText(FINISHED_TEXT[spot.def.kind], 'buff');
    builder.craftSkills.addXp(
      'construction',
      CONTRACT_XP_PER_MATERIAL * costMaterialCount(spot.def.cost),
    );
    this.deps.noteResourceActivity?.();
    if (isContractReady(bound.active)) {
      this.cue('contractJobDone');
      this.deps.announce(`${bound.site.name} is done. See ${contractContactName(bound.site)}.`);
    }
    return true;
  }

  private cue(cue: ContractCue): void {
    playContractCue(this.deps.audio, cue);
  }

  private endJob(): void {
    const job = this.job;
    if (job === null) return;
    this.job = null;
    job.channel.cancel();
    job.loop.stop();
  }

  /**
   * Ends any channel under way and silences its loop. For the moments the
   * scene stops ticking this part but keeps drawing, such as the death
   * screen, where a loop left running would play over it.
   */
  cancelWork(): void {
    this.endJob();
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  private drawSpotArt(
    ctx: CanvasRenderingContext2D,
    spot: ContractWorkSpot,
    camX: number,
    camY: number,
  ): void {
    let image = this.artByIndex.get(spot.index);
    // The shared cache gives its pixels back by shrinking the surface to nothing.
    if (image === undefined || image.surface.width === 0) {
      image =
        spot.def.kind === 'rebuild'
          ? getContractBuildSite(spot.artSpec)
          : getContractOverlay(spot.artSpec);
      this.artByIndex.set(spot.index, image);
    }
    const x = spot.footprint.rect.x * TILE_SIZE - camX;
    const y = spot.footprint.rect.y * TILE_SIZE - camY;
    ctx.drawImage(image.surface, x + image.offsetX, y + image.offsetY, image.width, image.height);
  }

  /** `spot`'s highlight look this frame: quieter and orange while working it would be refused. */
  private highlightFor(spot: ContractWorkSpot, nowMs: number): ScratchHighlight {
    const mood: AreaHighlightMood = this.refusal(spot) === null ? 'ready' : 'pending';
    const highlight = this.scratchHighlight;
    highlight.mood = mood;
    highlight.color = contractSpotHighlightColor(mood);
    highlight.nowMs = nowMs;
    return highlight;
  }

  /**
   * Under every body: the build sites and the damage that lies flat, an
   * area highlight round every unfinished spot so each can be found from
   * across the room, and the reach glow on the one a press would work.
   */
  renderGround(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: WorkChannelBuilder,
  ): void {
    const bound = this.sync();
    if (bound === null) return;
    const done = bound.active.spotsDone;
    for (const spot of bound.spots) {
      if (!done[spot.index] && spot.figure === null) this.drawSpotArt(ctx, spot, camX, camY);
    }
    const nowMs = performance.now();
    for (const spot of bound.spots) {
      if (done[spot.index]) continue;
      const rect = rectOnScreen(spot.footprint.rect, camX, camY, this.scratchRect);
      drawAreaHighlightGround(ctx, rect, this.highlightFor(spot, nowMs));
    }
    const inReach = this.job === null ? this.nearestInReach(active) : null;
    if (inReach !== null) {
      const rect = rectOnScreen(inReach.footprint.rect, camX, camY, this.scratchRect);
      drawContractSpotGlow(ctx, rect, nowMs / MS_PER_SECOND);
    }
  }

  /** The damage on standing things, for the scene's Y-sorted pass. Reused between calls. */
  sortedOverlays(): readonly ContractOverlayFigure[] {
    const figures = this.overlayBuffer;
    figures.length = 0;
    const bound = this.sync();
    if (bound === null) return figures;
    for (const spot of bound.spots) {
      if (spot.figure !== null && !bound.active.spotsDone[spot.index]) figures.push(spot.figure);
    }
    return figures;
  }

  /**
   * Over every body: the highlight's frame round each unfinished standing
   * spot, the channel's bar, and the puff of each spot just finished.
   */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.renderFrames(ctx, camX, camY);
    const job = this.job;
    if (job !== null) {
      const rect = rectOnScreen(job.spot.footprint.rect, camX, camY, this.scratchRect);
      worldBar(
        ctx,
        {
          x: rect.x + rect.w / 2 - PROGRESS_BAR_WIDTH / 2,
          y: rect.y - PROGRESS_BAR_LIFT_PX,
          w: PROGRESS_BAR_WIDTH,
          h: PROGRESS_BAR_HEIGHT,
        },
        { style: 'build', value: job.channel.progress },
      );
    }
    if (this.finishedAt.size === 0) return;
    const bound = this.sync();
    if (bound === null) return;
    const time = nowSeconds();
    for (const spot of bound.spots) {
      const finishedAt = this.finishedAt.get(spot.index);
      if (finishedAt === undefined) continue;
      const age = time - finishedAt;
      if (age >= CONTRACT_FINISH_PUFF_SECONDS) {
        this.finishedAt.delete(spot.index);
        continue;
      }
      const standing = spot.footprint.surface === 'prop' ? PROP_STANDING_HEIGHT_TILES : 0;
      drawContractFinishPuff(
        ctx,
        rectOnScreen(spot.footprint.rect, camX, camY, this.scratchRect),
        age,
        standing * TILE_SIZE,
      );
    }
  }

  private renderFrames(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const bound = this.sync();
    if (bound === null) return;
    const nowMs = performance.now();
    for (const spot of bound.spots) {
      if (bound.active.spotsDone[spot.index]) continue;
      const rect = contractSpotFrameRect(spot.footprint, camX, camY, this.scratchRect);
      if (rect !== null) drawAreaHighlightFrame(ctx, rect, this.highlightFor(spot, nowMs));
    }
  }

  /**
   * The spot's prompt with its cost row above it, in the scene's prompt
   * order (the same order its Space chain asks {@link tryInteract} in, with
   * the same `competingTiles`). Returns whether it claimed the prompt slot;
   * while a channel runs, a spot in reach claims it without drawing, exactly
   * as the press is swallowed.
   */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: WorkChannelBuilder,
    competingTiles: number | null = null,
  ): boolean {
    const spot = this.pressTarget(active, competingTiles);
    if (spot === null) return false;
    if (this.job !== null) return true;
    const rect = rectOnScreen(spot.footprint.rect, camX, camY, this.scratchRect);
    const standDown = this.standDownReason();
    if (standDown !== null) {
      drawInteractionPrompt(ctx, rect.x, rect.y, rect.w, standDown);
      return true;
    }
    // In touch mode the key cap itself reads "TAP", so the label finishes its sentence.
    const label = byInputMode(activeInputMode(), {
      touch: `to ${spot.def.label.toLowerCase()}`,
      pointer: spot.def.label,
    });
    drawInteractionPrompt(ctx, rect.x, rect.y, rect.w, label);
    if (!interactionPromptsSuppressed()) {
      drawRequirementRow(
        ctx,
        costRequirements(this.deps.human, this.deps.cat, spot.def.cost),
        rect.x + rect.w / 2,
        interactionPromptTop(rect.y) - COST_LINE_GAP_PX,
      );
    }
    return true;
  }

  /** A death rewind on the same scene: drop any channel in progress. */
  onRewind(): void {
    this.endJob();
    this.finishedAt.clear();
  }

  /** The scene is going: end any channel and silence its loop. */
  dispose(): void {
    this.endJob();
    this.finishedAt.clear();
    this.artByIndex.clear();
  }
}
