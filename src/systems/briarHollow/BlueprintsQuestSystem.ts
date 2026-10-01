/**
 * BlueprintsQuestSystem — "The Borrowed Blueprints", Fenna's side quest in
 * Briar Hollow: borrow Tikka's blueprints back from Wendell at Plumbline
 * Farm, pay his price (a dairy cow, which Merrit parts with for a new fence
 * and a hundred grain), walk Midge across the wilds to him, and build the
 * upgraded saw and rope walk.
 *
 * This class owns the phase, the journal row, the guidance and the villager
 * seams; each hands-on piece of the quest is a part in `./blueprints/` that
 * owns its own behaviour behind the hooks this class and `BriarHollowKit`
 * route to it:
 * - `fenna` / `merrit` — the two villagers' openings, topics and markers;
 * - `fence` — rebuilding Merrit's pasture fence;
 * - `harvest` — the scythe and the grain field;
 * - `escort` — Midge's call, the escort and her life at Wendell's;
 * - `stations` — the station upgrades.
 * Wendell lives indoors, where this system does not run; his side is
 * `WendellBlueprintsHook`, one of `BuildingInteriorScene`'s resident hooks.
 *
 * The phase lives in `BriarHollowState.blueprints`, threaded by reference and
 * rebuilt around on every door visit; this class and its parts hold nothing
 * a rebuild could lose.
 *
 * While "Briar Hollow's Plea" is under siege this quest stands down: no
 * guidance, and the journal row says the village is under attack.
 */

import type { BlueprintsQuestState } from '../../core/briarHollowState';
import {
  BLUEPRINTS_GRAIN_TARGET,
  BLUEPRINTS_STATION_IDS,
  hasAcceptedBlueprintsQuest,
  type BlueprintsQuestPhase,
} from '../../core/blueprintsQuestPhase';
import { canAfford } from '../../core/partyResources';
import { constructionUnlocked } from '../../core/villageUnlocks';
import { isVillageUnderSiege } from '../../core/villageQuestPhase';
import { TILE_SIZE } from '../../core/constants';
import type { NPCMarkerType } from '../../creatures/QuestNPC';
import type { VillagerId } from '../../dialog/scripts/briarHollow';
import type { ConversationTopic } from '../../dialog/request';
import type { TilePoint } from '../../map/town/townPlan';
import type { Player } from '../../Player';
import type { MiniMapSystem, QuestMarkerType } from '../MiniMapSystem';
import { phoneHudButtonRects, type Rect } from '../DungeonUIRenderer';
import { hotbarStripRect } from '../../ui/InventoryPanel';
import { doorwayBeaconTarget } from '../objectiveBeaconTargets';
import {
  characterTarget,
  type TrackerEntry,
  type TrackerSource,
  type TrackerTarget,
} from '../questTracker';
import {
  pointedGuidanceTarget,
  shortfallGuidance,
  type PointedGuidance,
  type QuestGuidance,
  type TileRect,
} from './questGuidance';
import type { QuestLineProvider, QuestOpening, VillagerContext } from './villagerCircumstances';
import type { TopicProvider, VillagerConversationFlow } from './villagerTopics';
import { drawQuestCounter, questCounterRect } from './QuestCounterHud';
import type { BlueprintsCrawler, BlueprintsQuestContext } from './blueprints/blueprintsContext';
import { FENNA_COMPLETION_BARK } from './blueprints/blueprintsDialog';
import {
  BLUEPRINTS_QUEST_ID,
  BLUEPRINTS_QUEST_NAME,
  PLUMBLINE_FARM_NAME,
  WENDELL_PASTURE_YARD_NAME,
  isHeld,
  moveBlueprintsPhase,
  takeBlueprintsItem,
} from './blueprints/blueprintsProgress';
import { playBlueprintsCue, type BlueprintsCue } from './blueprints/blueprintsSoundCues';
import { FennaBlueprintsLines } from './blueprints/FennaBlueprintsLines';
import { BlueprintsStepMoments } from './blueprints/BlueprintsStepMoments';
import { blueprintsRewardSpec } from './blueprints/blueprintsRewardSpec';
import { GrainHarvest } from './blueprints/GrainHarvest';
import { MerritBlueprintsLines } from './blueprints/MerritBlueprintsLines';
import { MidgeEscort } from './blueprints/MidgeEscort';
import { EscortRouteProgress, escortReplannerFor, escortRouteFor } from './blueprints/escortRoute';
import { FENCE_SECTION_COST, PastureFenceWork } from './blueprints/PastureFenceWork';
import { stationUpgradeCost, StationUpgrades } from './blueprints/StationUpgrades';
import type { ProcessingStationKind } from './processingStations';
import { PASTURE_FENCE_SECTION_COUNT } from '../../map/overworld/briarHollowLayout';
import { createMidgeEscortCarry } from '../../core/midgeEscortCarry';

/** The journal's hint while the Plea's siege has the village's questlines standing down. */
export const BLUEPRINTS_SIEGE_HINT = 'Briar Hollow is under attack.';
/** The journal's hint while Midge stands at Merrit's gate waiting to be led again. */
export const BLUEPRINTS_MIDGE_WAITING_HINT = "Midge is waiting at Merrit's gate.";

/** Ambushers for a system built with no level to give them: level 1, the creatures as authored. */
const UNLEVELLED_ESCORT_LEVEL = 1;

/** The context entries Midge's escort reads, which a system built outside the kit may leave out. */
type EscortContextKey = 'livestock' | 'music' | 'escortLevel' | 'midgeCarry';

/**
 * What `BlueprintsQuestSystem` is built with: the shared context, minus the
 * entries it supplies itself. The escort's own entries may be left out by a
 * system built without a whole village — no herd, no zone music, a fresh
 * carry record, and ambushers as authored.
 */
export type BlueprintsQuestSystemDeps = Omit<
  BlueprintsQuestContext,
  'setPhase' | 'cue' | EscortContextKey
> &
  Partial<Pick<BlueprintsQuestContext, EscortContextKey>> & {
    /**
     * Where `VillageQuestGuide` is highlighting while it shows this quest's
     * guidance — the tree, rock or station it picked for a shortfall — or null
     * while it shows the Plea's, or nothing. Lazy, as the guide is built after
     * this system.
     */
    readonly guideTarget: () => TrackerTarget | null;
    /**
     * Told of every cue the quest raises, whether or not anything plays it —
     * for a headless gate, which has no audio to hear it through.
     */
    readonly onCue?: (cue: BlueprintsCue) => void;
  };

const TILE_CENTRE = 0.5;
/** Clear space between the counter's slot and a step banner under it. */
const BANNER_GAP_UNDER_COUNTER_PX = 10;

export class BlueprintsQuestSystem implements QuestLineProvider, TopicProvider, TrackerSource {
  readonly fenna: FennaBlueprintsLines;
  readonly merrit: MerritBlueprintsLines;
  readonly fence: PastureFenceWork;
  readonly harvest: GrainHarvest;
  readonly escort: MidgeEscort;
  readonly stations: StationUpgrades;
  /** The banners and Midge's `!` at the seams between the steps. */
  readonly moments: BlueprintsStepMoments;
  /**
   * Whether this build of the system has asked for the quest-complete screen.
   * Not durable: the screen's own dismissal sets `completionScreenSeen`, so a
   * rebuild after a screen dropped unread (a rewind) asks again.
   */
  private rewardScreenRequested = false;
  /** Takes rotated per cue, so a cue with several recordings walks through them. */
  private readonly cueTakesPlayed = new Map<BlueprintsCue, number>();
  private readonly ctx: BlueprintsQuestContext;
  private readonly guideTarget: () => TrackerTarget | null;
  /** Where the escort has got to along Midge's road; planned the first time the escort needs it. */
  private escortRoute: EscortRouteProgress | null | undefined = undefined;

  constructor(deps: BlueprintsQuestSystemDeps) {
    const { guideTarget, onCue, livestock, music, escortLevel, midgeCarry, ...shared } = deps;
    this.guideTarget = guideTarget;
    this.ctx = {
      ...shared,
      livestock: livestock ?? null,
      music: music ?? (() => null),
      escortLevel: escortLevel ?? (() => UNLEVELLED_ESCORT_LEVEL),
      midgeCarry: midgeCarry ?? createMidgeEscortCarry(),
      setPhase: (phase) => this.setPhase(phase),
      cue: (cue) => {
        onCue?.(cue);
        playBlueprintsCue(deps.audio, cue, this.cueTakesPlayed);
      },
    };
    this.fenna = new FennaBlueprintsLines(this.ctx);
    // Lazy: the escort is built after Merrit, and only called on once the grain is in.
    this.merrit = new MerritBlueprintsLines(this.ctx, (onArrived) =>
      this.escort.beginCall(onArrived),
    );
    this.fence = new PastureFenceWork(this.ctx);
    this.harvest = new GrainHarvest(this.ctx);
    this.escort = new MidgeEscort(this.ctx);
    this.stations = new StationUpgrades(this.ctx, () => this.complete());
    this.moments = new BlueprintsStepMoments(this.ctx, this.escort);
    // Registered after the Plea's provider, which the kit builds first, so the
    // Plea's openings and markers win wherever both have something to say.
    deps.villagers.addQuestLineProvider(this);
    deps.villagers.addTopicProvider(this);
  }

  // ── The phase ────────────────────────────────────────────────────────────

  private get quest(): BlueprintsQuestState {
    return this.ctx.state.blueprints;
  }

  get phase(): BlueprintsQuestPhase {
    return this.quest.phase;
  }

  /** Moves the quest to `phase`, with `questStarted` / `questCompleted` where they belong. */
  setPhase(phase: BlueprintsQuestPhase): void {
    const from = this.quest.phase;
    if (moveBlueprintsPhase(this.quest, phase, this.ctx.bus))
      this.moments.onPhaseChanged(from, phase);
  }

  /** Whether Construction is open to the party, the condition for Fenna's offer. */
  get offerAvailable(): boolean {
    return constructionUnlocked([this.ctx.human, this.ctx.cat], this.ctx.state.unlocks);
  }

  /** Whether the Plea's siege has this quest standing down. */
  get suppressedBySiege(): boolean {
    return isVillageUnderSiege(this.ctx.pleaPhase());
  }

  /** Grain toward Merrit's hundred. */
  get grain(): number {
    return this.quest.grain;
  }

  /**
   * Whether the crawler's hands are busy with this quest's work — hammering a
   * fence section, a scythe swing, a station upgrade — or its "upgraded!"
   * callout is still up. The guide's arrow and caption stand down meanwhile:
   * each channel draws its own bar right where the arrow would hang.
   */
  get busyWithWork(): boolean {
    return (
      this.fence.isWorking ||
      this.harvest.isSwinging ||
      this.stations.isUpgrading ||
      this.stations.isCelebrating
    );
  }

  /** Whether either crawler holds Merrit's scythe. */
  get scytheHeld(): boolean {
    return isHeld(this.crawlers(), 'quest_scythe');
  }

  /** Whether either crawler holds the blueprints. */
  get blueprintsHeld(): boolean {
    return isHeld(this.crawlers(), 'quest_blueprints');
  }

  private crawlers(): readonly BlueprintsCrawler[] {
    return [this.ctx.human, this.ctx.cat];
  }

  /**
   * Both stations stand upgraded: Fenna's shout, the blueprints retired from
   * whichever crawler carries them, and the quest complete. Idempotent, so a
   * second call after completion does nothing.
   */
  complete(): void {
    if (this.phase === 'complete') return;
    this.ctx.villagers.bark('fenna', FENNA_COMPLETION_BARK, true);
    takeBlueprintsItem(this.crawlers(), 'quest_blueprints');
    this.setPhase('complete');
  }

  /**
   * Asks for the quest-complete screen once the finish has been seen: the
   * last upgrade's "upgraded!" callout played out and the Plea's siege not
   * on. The screen itself then waits out any conversation or other halt.
   */
  private requestRewardScreenWhenDue(): void {
    if (this.rewardScreenRequested) return;
    const quest = this.quest;
    if (quest.phase !== 'complete' || quest.completionScreenSeen) return;
    if (this.suppressedBySiege || this.stations.isCelebrating) return;
    this.rewardScreenRequested = true;
    this.ctx.bus.emit(
      'questRewardShown',
      blueprintsRewardSpec(() => {
        quest.completionScreenSeen = true;
      }),
    );
  }

  // ── Polling: steps the world itself finishes ─────────────────────────────

  /**
   * Every gameplay frame: ticks the parts, then moves a step on the moment
   * its world condition is met — the last fence section built, the hundredth
   * grain cut, the second station upgraded.
   */
  update(): void {
    this.merrit.update();
    this.fence.update();
    this.harvest.update();
    this.escort.update();
    this.updateEscortRoute();
    this.stations.update();
    this.moments.update();
    this.requestRewardScreenWhenDue();
    switch (this.phase) {
      case 'build_fence':
        if (this.fence.allSectionsBuilt) this.setPhase('report_fence');
        return;
      case 'harvest_grain':
        if (this.grain >= BLUEPRINTS_GRAIN_TARGET) this.setPhase('deliver_grain');
        return;
      case 'build_stations':
        if (this.stations.allUpgraded) this.complete();
        return;
      case 'unoffered':
      case 'declined':
      case 'ask_wendell':
      case 'ask_merrit':
      case 'report_fence':
      case 'deliver_grain':
      case 'escort_midge':
      case 'midge_delivered':
      case 'complete':
        return;
    }
  }

  // ── Guidance ─────────────────────────────────────────────────────────────

  /**
   * What the village guide should highlight right now; null while the step
   * is a villager conversation (their marker covers it), while there is
   * nothing to do, and throughout the Plea's siege.
   */
  guidance(): QuestGuidance | null {
    if (this.suppressedBySiege) return null;
    switch (this.phase) {
      case 'ask_wendell':
      case 'midge_delivered':
        return this.wendellGuidance();
      case 'build_fence':
        return this.fenceGuidance();
      case 'harvest_grain':
        return this.harvestGuidance();
      case 'escort_midge':
        return this.escortGuidance();
      case 'build_stations':
        return this.blueprintsHeld ? this.stationGuidance() : this.wendellGuidance();
      case 'unoffered':
      case 'declined':
      case 'ask_merrit':
      case 'report_fence':
      case 'deliver_grain':
      case 'complete':
        return null;
    }
  }

  private wendellGuidance(): QuestGuidance | null {
    const entry = this.ctx.gameMap.buildingEntries.find(
      (candidate) => candidate.name === PLUMBLINE_FARM_NAME,
    );
    const door = doorwayBeaconTarget(entry ?? null);
    if (door === null) return null;
    return {
      kind: 'town_building',
      buildingName: PLUMBLINE_FARM_NAME,
      residentName: 'Wendell',
      door,
    };
  }

  private fenceGuidance(): QuestGuidance | null {
    if (!canAfford(this.ctx.human, this.ctx.cat, FENCE_SECTION_COST)) {
      return shortfallGuidance(this.ctx.human, this.ctx.cat, FENCE_SECTION_COST);
    }
    const tiles = this.fence.nearestUnbuiltSectionTiles(this.activeTile());
    if (tiles === null) return null;
    return {
      kind: 'fence_section',
      tiles,
      progress: { have: this.fence.sectionsBuilt, target: PASTURE_FENCE_SECTION_COUNT },
    };
  }

  private harvestGuidance(): QuestGuidance | null {
    if (!this.scytheHeld) {
      const at = this.harvest.scytheTile();
      return at === null ? null : { kind: 'scythe', at };
    }
    const field = this.harvest.grainField();
    if (field === null) return null;
    return {
      kind: 'grain_field',
      field,
      progress: { have: this.grain, target: BLUEPRINTS_GRAIN_TARGET },
    };
  }

  private escortGuidance(): QuestGuidance | null {
    const midge = this.escort.midgeTile();
    if (midge !== null && (this.escort.isOutOfLeadRange || this.escort.isWaitingAtGate)) {
      return { kind: 'lead_midge', at: midge };
    }
    const yard = this.wendellPasture();
    if (yard === null) return null;
    const waypoint = this.escortRouteProgress()?.guidance() ?? null;
    return waypoint === null
      ? { kind: 'pasture', yard }
      : { kind: 'escort_waypoint', ...waypoint, yard };
  }

  /**
   * Progress along Midge's road; null on a map where the road to Garrison
   * Green cannot be planned. Built on the road a door carried in, when the
   * party had already led her off the road as planned.
   */
  private escortRouteProgress(): EscortRouteProgress | null {
    if (this.escortRoute === undefined) {
      const { gameMap, site, midgeCarry } = this.ctx;
      const route = escortRouteFor(gameMap, site);
      const progress =
        route === null ? null : new EscortRouteProgress(route, escortReplannerFor(gameMap, site));
      const carriedFrom = midgeCarry.routeFrom;
      if (progress !== null && carriedFrom !== null) progress.replanFrom(carriedFrom);
      this.escortRoute = progress;
    }
    return this.escortRoute;
  }

  /**
   * Moves the escort along its road, and writes where the road was planned
   * from for a door to carry. Midge standing at Merrit's gate — loaded,
   * rewound or scared home — puts the road back as planned from there.
   */
  private updateEscortRoute(): void {
    const carry = this.ctx.midgeCarry;
    if (this.phase !== 'escort_midge') {
      carry.routeFrom = null;
      return;
    }
    const progress = this.escortRouteProgress();
    if (progress === null) return;
    if (this.escort.isWaitingAtGate) progress.restart();
    progress.update(this.escort.midgeTile(), this.activeTile());
    carry.routeFrom = progress.replannedFrom;
  }

  private stationGuidance(): QuestGuidance | null {
    const next = this.stations.stationToGuide(this.ctx.active());
    if (next === null) return null;
    const cost = stationUpgradeCost(next.station);
    if (!canAfford(this.ctx.human, this.ctx.cat, cost)) {
      return shortfallGuidance(this.ctx.human, this.ctx.cat, cost);
    }
    return { kind: 'station_upgrade', station: next.guidanceId, footprint: next.footprint };
  }

  /** Wendell's pasture behind Plumbline Farm, where Midge is delivered; null off the town floor. */
  wendellPasture(): TileRect | null {
    const yard = this.ctx.gameMap.townPlan?.yards.find(
      (candidate) => candidate.name === WENDELL_PASTURE_YARD_NAME,
    );
    if (yard === undefined) return null;
    const { x, y, w, h } = yard.bounds;
    return { x, y, width: w, height: h };
  }

  private activeTile(): TilePoint {
    const active = this.ctx.active();
    return {
      x: Math.floor(active.x / TILE_SIZE + TILE_CENTRE),
      y: Math.floor(active.y / TILE_SIZE + TILE_CENTRE),
    };
  }

  // ── Villager seams ───────────────────────────────────────────────────────

  lineFor(villager: VillagerId, ctx: VillagerContext): QuestOpening | null {
    if (villager === 'fenna') return this.fenna.lineFor(ctx);
    if (villager === 'merrit') return this.merrit.lineFor(ctx);
    return null;
  }

  markerFor(villager: VillagerId, ctx: VillagerContext): NPCMarkerType {
    if (villager === 'fenna') return this.fenna.markerFor(ctx);
    if (villager === 'merrit') return this.merrit.markerFor(ctx);
    return 'none';
  }

  topics(
    villager: VillagerId,
    ctx: VillagerContext,
    flow: VillagerConversationFlow,
  ): readonly ConversationTopic[] {
    return villager === 'fenna' ? this.fenna.topics(ctx, flow) : [];
  }

  // ── Kit hooks ────────────────────────────────────────────────────────────

  /** Space: the fence first, then the scythe and the harvest. Returns whether the press was taken. */
  tryInteract(active: BlueprintsCrawler): boolean {
    if (this.fence.tryInteract(active)) return true;
    return this.harvest.tryInteract(active);
  }

  /**
   * A single world tap: a live swing claims it first, then the fence, then
   * the harvest. `eventTimeStampMs` is the tap's own event time, which a
   * live swing grades its timed press by.
   */
  handleTap(
    worldX: number,
    worldY: number,
    active: BlueprintsCrawler,
    eventTimeStampMs: number,
  ): boolean {
    if (this.harvest.claimsWorldTaps) {
      return this.harvest.handleTap(worldX, worldY, active, eventTimeStampMs);
    }
    if (this.fence.handleTap(worldX, worldY, active)) return true;
    return this.harvest.handleTap(worldX, worldY, active, eventTimeStampMs);
  }

  /**
   * A raw keydown, ahead of every other key consumer: a live scythe swing
   * takes the attack key as its timed press. Returns whether it was taken.
   */
  handleKeyDown(key: string, repeat: boolean, eventTimeStampMs: number): boolean {
    return this.harvest.handleKeyDown(key, repeat, eventTimeStampMs);
  }

  /** X: a station upgrade in reach. Returns whether the press was taken. */
  tryUpgradeStation(active: BlueprintsCrawler): boolean {
    return this.stations.tryUpgrade(active);
  }

  /** A double tap: a station upgrade under the finger. Returns whether it was taken. */
  handleDoubleTap(worldX: number, worldY: number, active: BlueprintsCrawler): boolean {
    return this.stations.handleDoubleTap(worldX, worldY, active);
  }

  /** The prompt for whichever part a press would reach, in `tryInteract` order, then the stations. */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: BlueprintsCrawler,
  ): boolean {
    if (this.fence.renderPrompt(ctx, camX, camY, active)) return true;
    if (this.harvest.renderPrompt(ctx, camX, camY, active)) return true;
    return this.stations.renderPrompt(active);
  }

  /** Under every body. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.harvest.renderGround(ctx, camX, camY);
    this.fence.renderGround(ctx, camX, camY);
    this.stations.renderGround(ctx, camX, camY);
  }

  /**
   * Whether this quest marks the machine that makes `kind` itself — every
   * station still to upgrade, through `build_stations`, outside the siege —
   * so the village guide draws no second highlight over it.
   */
  marksStation(kind: ProcessingStationKind): boolean {
    return this.stations.marksStation(kind);
  }

  /**
   * The top of this quest's upgrade caption over the machine making `kind`,
   * in world pixels, for the village guide to stack its own caption above;
   * null while none stands there.
   */
  stationCaptionTopWorldY(kind: ProcessingStationKind): number | null {
    return this.stations.captionTopWorldY(kind);
  }

  /** Over every body. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.fence.renderAbove(ctx, camX, camY);
    this.stations.renderAbove(ctx, camX, camY);
    this.escort.renderAbove(ctx, camX, camY);
    this.moments.renderAbove(ctx, camX, camY);
  }

  /**
   * Screen space. The scythe's timing bar across the screen, clear of the HUD
   * and a phone's buttons, whenever a swing is up. Under the resource strip,
   * the step's own count while the party works through it — fence sections,
   * then grain — and a step's banner under that. The count and the banner are
   * hidden through the Plea's siege, when this quest stands down and the siege
   * panel wants the room.
   */
  renderHud(ctx: CanvasRenderingContext2D, miniMap: MiniMapSystem, hudRect: Rect): void {
    const keepouts = [
      ...phoneHudButtonRects(miniMap),
      miniMap.screenRect,
      hudRect,
      hotbarStripRect(),
    ];
    this.harvest.renderHud(ctx, keepouts);
    if (this.suppressedBySiege) return;
    const text = this.counterText();
    if (text !== null) drawQuestCounter(ctx, miniMap, hudRect, text);
    const counter = questCounterRect(miniMap, hudRect);
    this.moments.renderHud(ctx, counter.y + counter.h + BANNER_GAP_UNDER_COUNTER_PX);
  }

  /** The step's count as the HUD shows it, or null in a step without one. */
  counterText(): string | null {
    switch (this.phase) {
      case 'build_fence':
        return `${this.fence.sectionsBuilt}/${PASTURE_FENCE_SECTION_COUNT} fence sections`;
      case 'harvest_grain':
        return `${Math.min(this.grain, BLUEPRINTS_GRAIN_TARGET)}/${BLUEPRINTS_GRAIN_TARGET} grain`;
      case 'unoffered':
      case 'declined':
      case 'ask_wendell':
      case 'ask_merrit':
      case 'report_fence':
      case 'deliver_grain':
      case 'escort_midge':
      case 'midge_delivered':
      case 'build_stations':
      case 'complete':
        return null;
    }
  }

  /** Midge, for the hostiles' target list while she is led. */
  pushEscortTargets(out: Player[]): void {
    this.escort.pushEscortTargets(out);
  }

  /** A death rewind on the same scene: every part drops its transient work. */
  onRewind(): void {
    this.merrit.onRewind();
    this.fence.onRewind();
    this.harvest.onRewind();
    this.escort.onRewind();
    this.escortRoute?.restart();
    this.ctx.midgeCarry.routeFrom = null;
    this.stations.onRewind();
    this.moments.onRewind();
    this.rewardScreenRequested = false;
  }

  // ── The journal ──────────────────────────────────────────────────────────

  trackerEntries(): ReadonlyArray<TrackerEntry> {
    const entry = this.trackerEntry();
    return entry === null ? [] : [entry];
  }

  private trackerEntry(): TrackerEntry | null {
    const entry = this.stepEntry();
    if (entry === null) return null;
    if (!this.suppressedBySiege || entry.status === 'completed') return entry;
    // The village is fighting for its life: nothing here is worth an arrow,
    // not even Fenna's offer, which she will not make until the fight is over.
    // Every open row says why, including those whose target is a town away.
    return {
      id: entry.id,
      name: entry.name,
      status: entry.status,
      objective: entry.objective,
      hint: BLUEPRINTS_SIEGE_HINT,
    };
  }

  /** The row for the current step, before the siege has its say. */
  private stepEntry(): TrackerEntry | null {
    const base = { id: BLUEPRINTS_QUEST_ID, name: BLUEPRINTS_QUEST_NAME } as const;
    const fenna = (): TrackerTarget | undefined => this.villagerTarget('fenna');
    const merrit = (): TrackerTarget | undefined => this.villagerTarget('merrit');
    switch (this.phase) {
      case 'unoffered':
        if (!this.offerAvailable) return null;
        return {
          ...base,
          status: 'available',
          objective: 'Speak with Fenna at the sawmill',
          target: fenna(),
        };
      case 'declined':
        return {
          ...base,
          status: 'available',
          objective: 'Speak with Fenna about the work stations',
          target: fenna(),
        };
      case 'ask_wendell':
        return {
          ...base,
          status: 'active',
          objective: 'Ask Wendell at Plumbline Farm about the blueprints',
          target: this.guidedTarget(undefined),
        };
      case 'ask_merrit':
        return {
          ...base,
          status: 'active',
          objective: 'Ask Merrit Roottail for a dairy cow',
          target: merrit(),
        };
      case 'build_fence':
        return {
          ...base,
          status: 'active',
          objective: `Rebuild Merrit's fence — ${this.fence.sectionsBuilt}/${PASTURE_FENCE_SECTION_COUNT} sections`,
          target: this.guidedTarget(merrit()),
        };
      case 'report_fence':
        return {
          ...base,
          status: 'active',
          objective: 'Tell Merrit the fence is finished',
          target: merrit(),
        };
      case 'harvest_grain':
        return {
          ...base,
          status: 'active',
          objective: this.scytheHeld
            ? `Harvest grain for Merrit — ${Math.min(this.grain, BLUEPRINTS_GRAIN_TARGET)}/${BLUEPRINTS_GRAIN_TARGET} grain`
            : "Take Merrit's scythe from the barn wall",
          target: this.guidedTarget(merrit()),
        };
      case 'deliver_grain':
        return {
          ...base,
          status: 'active',
          objective: 'Bring Merrit the grain',
          // Once Merrit has called, Midge wears the marker and Merrit none.
          target: this.midgeTarget() ?? merrit(),
        };
      case 'escort_midge':
        return {
          ...base,
          status: 'active',
          objective: "Lead Midge to Wendell's pasture",
          hint: this.escort.isWaitingAtGate ? BLUEPRINTS_MIDGE_WAITING_HINT : undefined,
          target: this.guidedTarget(undefined),
        };
      case 'midge_delivered':
        return {
          ...base,
          status: 'active',
          objective: 'Speak with Wendell at Plumbline Farm',
          target: this.guidedTarget(undefined),
        };
      case 'build_stations':
        return {
          ...base,
          status: 'active',
          objective: this.blueprintsHeld
            ? `Upgrade the saw and the rope walk — ${this.stations.upgradedCount}/${BLUEPRINTS_STATION_IDS.length}`
            : 'Fetch the blueprints from Wendell at Plumbline Farm',
          target: this.guidedTarget(fenna()),
        };
      case 'complete':
        return {
          ...base,
          status: 'completed',
          objective: "Fenna's saw and rope walk are upgraded.",
        };
    }
  }

  /** Midge, while she is out of the herd for the quest; undefined while she is not. */
  private midgeTarget(): TrackerTarget | undefined {
    const tile = this.escort.midgeTile();
    return tile === null ? undefined : characterTarget(tile);
  }

  private villagerTarget(id: VillagerId): TrackerTarget | undefined {
    const villager = this.ctx.villagers.villagerFor(id);
    return villager === null ? undefined : characterTarget(villager.tile);
  }

  /**
   * Where the current guidance points: its own target when it carries one,
   * the guide's pick for a shortfall (a tree, a rock, a station), or
   * `fallback` when neither has anywhere to point.
   */
  private guidedTarget(fallback: TrackerTarget | undefined): TrackerTarget | undefined {
    const guidance = this.guidance();
    if (guidance === null) return fallback;
    if (isPointed(guidance)) return pointedGuidanceTarget(guidance) ?? fallback;
    return this.guideTarget() ?? fallback;
  }

  /** Minimap pips at wherever the journal points. */
  get questMarkers(): Array<{ x: number; y: number; type: QuestMarkerType }> {
    // A declined offer stays in the journal, but the party said no: nothing
    // on the map nags them back to Fenna.
    if (this.phase === 'declined') return [];
    const target = this.trackerEntry()?.target;
    if (target === undefined) return [];
    const type: QuestMarkerType = hasAcceptedBlueprintsQuest(this.phase)
      ? 'question'
      : 'exclamation';
    return [{ x: target.x, y: target.y, type }];
  }

  // ── Teardown ─────────────────────────────────────────────────────────────

  dispose(): void {
    this.fence.dispose();
    this.harvest.dispose();
    this.escort.dispose();
    this.stations.dispose();
    this.moments.dispose();
    this.ctx.villagers.removeQuestLineProvider(this);
  }
}

/** Whether `guidance` carries its own target, rather than leaving the pick to the guide. */
function isPointed(guidance: QuestGuidance): guidance is PointedGuidance {
  switch (guidance.kind) {
    case 'fence_section':
    case 'scythe':
    case 'grain_field':
    case 'lead_midge':
    case 'escort_waypoint':
    case 'pasture':
    case 'station_upgrade':
    case 'town_building':
      return true;
    case 'chop':
    case 'mine':
    case 'process':
    case 'build_trebuchet':
    case 'load_trebuchet':
    case 'upgrade_wall':
    case 'repair_bell':
      return false;
  }
}
