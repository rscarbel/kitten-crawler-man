/**
 * Everything gathering needs, as one field on the scene: the node ledger,
 * crawler harvesting, thralls, the chips and pops, and the resource HUD.
 *
 * Built for every overworld floor rather than inside the village kit, because
 * any tree or boulder on the floor can be worked whether or not a village was
 * generated there. It is entered two ways: a harvest from the scene's Space
 * chain, after citizen and villager talk so a townsperson in range always wins
 * the press; and a thrall summon from a tool's bag menu (`contextOptionsFor`).
 *
 * Durable node state lives in `BriarHollowState.nodes`, threaded across door
 * visits; everything else here is rebuilt with the scene.
 */

import type { AudioManager } from '../../audio/AudioManager';
import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import type { InventoryItem } from '../../core/ItemDefs';
import type { PartyTools, PartyToolsState } from '../../core/PartyTools';
import type { HarvestNodeState } from '../../core/briarHollowState';
import type { CrawlerKind } from '../../core/SkillManager';
import type { ToolKind, ToolTier } from '../../core/toolTiers';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { GameMap } from '../../map/GameMap';
import { mulberry32 } from '../../sprites/person/rng';
import type { ExtraContextOption } from '../../ui/InventoryInteraction';
import { type Rect, topCentreStripSlot } from '../DungeonUIRenderer';
import type { SystemContext } from '../GameSystem';
import type { MiniMapSystem } from '../MiniMapSystem';
import type { TownPropRenderable } from '../townPropRenderable';
import type { TreeSystem } from '../TreeSystem';
import { harvestKindAt } from './harvestNodes';
import { toolForHarvestKind } from '../../core/harvestYield';
import type { DefenseStructures } from './DefenseStructures';
import { HarvestEffects } from './HarvestEffects';
import { HarvestSystem } from './HarvestSystem';
import { NodeLedger, type NodeLedgerCheckpoint } from './NodeLedger';
import { NodeRegrowth, type StandingBody } from './NodeRegrowth';
import { ResourceHud, resourceHudFootprintWidth } from './ResourceHud';
import { ThrallSystem } from './ThrallSystem';
import { thrallCooldownSecondsLeft } from '../../core/thrallCooldowns';

type Crawler = HumanPlayer | CatPlayer;

/** The seed range the luck stream is drawn from. */
const LUCK_SEED_SPACE = 0x100000000;

/** The thin ring over a node being worked, showing how much it has left. */
const ARC_RADIUS_TILES = 0.32;
const ARC_LIFT_TILES = 1.25;
const ARC_WIDTH_PX = 3;
const ARC_TRACK_COLOR = 'rgba(0,0,0,0.45)';
const ARC_FILL_COLOR = '#facc15';
const ARC_START = -Math.PI / 2;
const FULL_TURN = Math.PI * 2;
const TILE_CENTER_OFFSET = 0.5;

/** The "Summon Thrall" entry on a tool's bag menu. */
const SUMMON_THRALL_LABEL = 'Summon Thrall';
/** Dismisses the active thralls for that tool. */
const UNSUMMON_THRALL_LABEL = 'Unsummon';
/** Toggles whether starting to harvest with that tool summons thralls automatically. */
const TOGGLE_AUTO_SUMMON_LABEL = 'Toggle Auto-Summon';

export interface GatheringKitDeps {
  readonly gameMap: GameMap;
  readonly bus: EventBus | null;
  readonly audio: AudioManager | null;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly tools: PartyToolsState;
  readonly partyTools: PartyTools;
  readonly nodes: Map<string, HarvestNodeState>;
  readonly trees: TreeSystem | null;
  readonly onTileChanged: (tileX: number, tileY: number) => void;
  readonly announce: (message: string) => void;
  /** Whose bag is on screen, so a tool's menu summons for the crawler who holds it. */
  readonly bagOwner: () => Crawler;
  /**
   * Whether the active crawler stands somewhere resources are the point — the
   * village's work yards and palisade — which keeps the HUD up. Always false
   * where there is no village.
   */
  readonly inResourceZone: (active: Crawler) => boolean;
  /**
   * Every body besides the crawlers that could stand on a regrowing quarry
   * deposit or grove tile — villagers, cows, mobs — so nothing is ever grown
   * up around someone.
   */
  readonly otherBodies: () => Iterable<StandingBody>;
  /** Whether `crawler`'s tools currently auto-summon thralls when a harvest starts. */
  readonly isAutoSummonEnabled: (crawler: CrawlerKind) => boolean;
  readonly setAutoSummonEnabled: (crawler: CrawlerKind, enabled: boolean) => void;
}

/** What regrowth asks of the village's constructions: is a tile built on, or claimed for a build. */
export type StructureClaims = Pick<DefenseStructures, 'at' | 'isReserved'>;

/** Transient gathering state a death rewind on the same scene puts back. */
export interface GatheringCheckpoint {
  readonly nodes: NodeLedgerCheckpoint;
}

export class GatheringKit {
  readonly harvest: HarvestSystem;
  readonly thralls: ThrallSystem;
  readonly hud = new ResourceHud();
  private readonly effects = new HarvestEffects();
  private readonly ledger: NodeLedger;
  private readonly regrowth: NodeRegrowth;
  private structureClaims: StructureClaims | null = null;

  constructor(private readonly deps: GatheringKitDeps) {
    const noteActivity = (): void => this.hud.noteActivity();
    const onTreeStruck = (tileX: number, tileY: number): void =>
      deps.trees?.flashStruck(tileX, tileY);
    this.ledger = new NodeLedger({
      gameMap: deps.gameMap,
      nodes: deps.nodes,
      trees: deps.trees,
      bus: deps.bus,
      onTileChanged: deps.onTileChanged,
      capacityRng: Math.random,
      onDepleted: (depletion) => {
        if (depletion.kind !== 'stone') return;
        this.effects.crumble(depletion.tileX, depletion.tileY);
        deps.audio?.playRandom(['rock_breaking_1', 'rock_breaking_2']);
      },
    });
    this.regrowth = new NodeRegrowth(
      {
        gameMap: deps.gameMap,
        nodes: deps.nodes,
        onTileChanged: deps.onTileChanged,
        bodies: () => [deps.human, deps.cat, ...deps.otherBodies()],
        isTileClaimed: (tileX, tileY) => this.isTileClaimed(tileX, tileY),
      },
      deps.gameMap.briarHollow,
    );
    this.harvest = new HarvestSystem({
      gameMap: deps.gameMap,
      ledger: this.ledger,
      tools: deps.tools,
      partyTools: deps.partyTools,
      effects: this.effects,
      bus: deps.bus,
      audio: deps.audio,
      announce: deps.announce,
      luckRng: mulberry32(Math.floor(Math.random() * LUCK_SEED_SPACE)),
      noteActivity,
      onTreeStruck,
    });
    this.thralls = new ThrallSystem({
      gameMap: deps.gameMap,
      ledger: this.ledger,
      partyTools: deps.partyTools,
      tierOf: (tool) => this.tierOf(tool),
      effects: this.effects,
      bus: deps.bus,
      audio: deps.audio,
      announce: deps.announce,
      noteActivity,
      onTreeStruck,
      harvestedNodeFor: (crawler) => this.harvest.nodeFor(crawler),
    });
  }

  /**
   * Hands regrowth the village's constructions, so a quarry deposit or grove
   * tree never grows back through a trebuchet or a snare built on its rubble
   * or stump. Whoever builds the `DefenseStructures` calls this with it.
   */
  setStructureClaims(claims: StructureClaims | null): void {
    this.structureClaims = claims;
  }

  private isTileClaimed(tileX: number, tileY: number): boolean {
    const claims = this.structureClaims;
    if (claims === null) return false;
    return claims.at(tileX, tileY) !== null || claims.isReserved(tileX, tileY);
  }

  private tierOf(tool: ToolKind): ToolTier | null {
    return tool === 'axe' ? this.deps.tools.axeTier : this.deps.tools.pickaxeTier;
  }

  /**
   * The Space chain's entry. See {@link HarvestSystem.tryStart}. A press that
   * starts a fresh channel — not one that resumes an already-running one, and
   * not one the crawler lacked the tool for — also tries the matching tool's
   * auto-summon, if the crawler has it on.
   */
  tryStartHarvest(active: Crawler): boolean {
    const wasHarvesting = this.harvest.isHarvesting(active);
    const claimed = this.harvest.tryStart(active);
    if (claimed && !wasHarvesting && this.harvest.isHarvesting(active)) {
      this.autoSummonFor(active);
    }
    return claimed;
  }

  private autoSummonFor(active: Crawler): void {
    if (!this.deps.isAutoSummonEnabled(active.crawlerKind)) return;
    const node = this.harvest.nodeFor(active);
    if (node === null) return;
    const kind = harvestKindAt(this.deps.gameMap, node.tileX, node.tileY);
    if (kind === null) return;
    const tool = toolForHarvestKind(kind);
    if (this.thralls.anyFor(active, tool)) return;
    if (this.thralls.trySummon(active, tool) === 'summoned') this.hud.noteActivity();
  }

  /**
   * Whether `crawler` is mid-channel, active or companion. What
   * `CompanionSystem` asks before deciding to leave a harvesting companion
   * standing at its node.
   */
  isHarvesting(crawler: Crawler): boolean {
    return this.harvest.isHarvesting(crawler);
  }

  /** Ends `crawler`'s own channel, if it has one, leaving the other crawler's untouched — the leash or a fight taking over from `CompanionSystem`. */
  stopHarvest(crawler: Crawler): void {
    this.harvest.stop(crawler);
  }

  /** See {@link HarvestSystem.wouldStartHarvest}. */
  wouldStartHarvest(active: Crawler): boolean {
    return this.harvest.wouldStartHarvest(active);
  }

  /** `menuOpen`: whether any overlay owns the screen, which pauses a channel rather than ending it. */
  update(ctx: SystemContext, menuOpen: boolean): void {
    this.harvest.update(ctx, menuOpen);
    this.thralls.update();
    this.regrowth.update();
    this.effects.update();
    this.hud.update(this.hudFrame(ctx.active));
  }

  /** Grove stumps waiting on their saplings, under every body. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.regrowth.renderGround(ctx, camX, camY);
  }

  /** Chips, pops and the worked node's capacity ring, over every body. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.effects.render(ctx, camX, camY);
    this.renderCapacityArc(ctx, camX, camY);
  }

  /** The thralls and the grove's saplings, merged into the scene's Y-sorted pass. */
  renderEntities(): ReadonlyArray<TownPropRenderable> {
    return [...this.thralls.renderables(), ...this.regrowth.renderables()];
  }

  /** The resource strip, between the top-left HUD panel and the minimap. */
  renderHud(
    ctx: CanvasRenderingContext2D,
    miniMap: MiniMapSystem,
    hudRect: Rect,
    active: Crawler,
  ): void {
    const frame = this.hudFrame(active);
    const width = resourceHudFootprintWidth(frame.thrallSecondsLeft !== null);
    this.hud.render(ctx, topCentreStripSlot(miniMap, hudRect, width), frame);
  }

  private hudFrame(active: Crawler): {
    human: HumanPlayer;
    cat: CatPlayer;
    inResourceZone: boolean;
    thrallSecondsLeft: number | null;
  } {
    return {
      human: this.deps.human,
      cat: this.deps.cat,
      inResourceZone: this.deps.inResourceZone(active),
      thrallSecondsLeft: this.thralls.anyWorking ? this.thralls.secondsLeft : null,
    };
  }

  private renderCapacityArc(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    // De-duplicated by `workedNodes` itself: two crawlers on the same tile
    // draw one ring, not two stacked on top of each other.
    for (const node of this.harvest.workedNodes) {
      this.renderOneCapacityArc(ctx, camX, camY, node);
    }
  }

  private renderOneCapacityArc(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    node: { readonly tileX: number; readonly tileY: number },
  ): void {
    const state = this.ledger.knownStateAt(node.tileX, node.tileY);
    if (state === null) return;
    const left = state.remaining / state.capacity;
    const x = (node.tileX + TILE_CENTER_OFFSET) * TILE_SIZE - camX;
    const y = (node.tileY + TILE_CENTER_OFFSET - ARC_LIFT_TILES) * TILE_SIZE - camY;
    const radius = ARC_RADIUS_TILES * TILE_SIZE;
    ctx.save();
    ctx.lineWidth = ARC_WIDTH_PX;
    ctx.lineCap = 'round';
    ctx.strokeStyle = ARC_TRACK_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, FULL_TURN);
    ctx.stroke();
    ctx.strokeStyle = ARC_FILL_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, radius, ARC_START, ARC_START + FULL_TURN * left);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * "Summon Thrall", "Unsummon" and "Toggle Auto-Summon" on a tool's bag menu.
   * Offered only when the crawler whose bag it is has the unlock — a skill is
   * never borrowed from the other crawler — with Summon greyed while their
   * summon is cooling down and Unsummon shown only while thralls for that
   * tool are actually out.
   */
  contextOptionsFor(item: InventoryItem): readonly ExtraContextOption[] {
    const tool = item.tool;
    if (tool === undefined) return [];
    const owner = this.deps.bagOwner();
    if (!this.thralls.canSummon(owner)) return [];

    const wait = thrallCooldownSecondsLeft(owner.crawlerKind);
    const summonRun = (): void => {
      if (this.thralls.trySummon(owner, tool.kind) === 'summoned') {
        this.hud.noteActivity();
      } else if (thrallCooldownSecondsLeft(owner.crawlerKind) > 0) {
        this.deps.announce('Your thralls need to rest a little longer.');
      }
    };
    const summon: ExtraContextOption =
      wait > 0
        ? { label: SUMMON_THRALL_LABEL, disabledReason: `${wait}s`, run: summonRun }
        : { label: SUMMON_THRALL_LABEL, run: summonRun };

    const options: ExtraContextOption[] = [summon];
    if (this.thralls.anyFor(owner, tool.kind)) {
      options.push({
        label: UNSUMMON_THRALL_LABEL,
        run: () => this.thralls.dismiss(owner, tool.kind),
      });
    }
    const autoOn = this.deps.isAutoSummonEnabled(owner.crawlerKind);
    options.push({
      label: `${TOGGLE_AUTO_SUMMON_LABEL} (${autoOn ? 'On' : 'Off'})`,
      run: () => this.deps.setAutoSummonEnabled(owner.crawlerKind, !autoOn),
    });
    return options;
  }

  captureCheckpoint(): GatheringCheckpoint {
    return { nodes: this.ledger.captureCheckpoint() };
  }

  restoreCheckpoint(checkpoint: GatheringCheckpoint): void {
    this.harvest.stopAll();
    this.thralls.dismissAll();
    this.ledger.restoreCheckpoint(checkpoint.nodes);
    this.regrowth.reconcileAfterRestore();
  }

  dispose(): void {
    this.harvest.stopAll();
    this.thralls.dismissAll();
  }
}
