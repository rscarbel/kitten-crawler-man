/**
 * The village's working economy, as one member of `BriarHollowKit`: Pipkin's
 * cookhouse, Sella's infirmary, Vetch's trading post, Oren's forge, the
 * sawmill's two machines and Fenna's bulk processing.
 *
 * Each shop is a module that hands the villager system a topic provider, so
 * the rows appear under that villager's own conversation. This class owns
 * what they share: the one priced menu and the one quantity picker they open
 * over the village, the treatment Sella plays out, the sawmill's run, and the
 * saw's sound. The kit forwards its hooks here a line each.
 *
 * Nothing durable lives here. Stock, one-shots and the quest phase are in the
 * threaded `BriarHollowState`; tool tiers and explainers seen are the party's
 * craft progress. A door visit rebuilds this with the scene and loses nothing.
 */

import type { AudioManager } from '../../../audio/AudioManager';
import { VILLAGE_CUES } from '../../../audio/villageSoundCues';
import { TILE_SIZE } from '../../../core/constants';
import type { EventBus } from '../../../core/EventBus';
import type { GrantedReward } from '../../../core/GrantedReward';
import type { PartyTools } from '../../../core/PartyTools';
import type { PartyCraftsState } from '../../../core/partyCrafts';
import type { BriarHollowState } from '../../../core/briarHollowState';
import type { HumanPlayer } from '../../../creatures/HumanPlayer';
import type { CatPlayer } from '../../../creatures/CatPlayer';
import type { BriarHollowSite } from '../../../map/overworld/briarHollowSite';
import { PricedMenuPanel } from '../../../ui/PricedMenuPanel';
import { QuantityPicker } from '../../../ui/QuantityPicker';
import type { OverlayInputClaim } from '../../kits/OverlayClaims';
import type { ProcessingStationKind } from '../processingStations';
import type { Circumstance, VillagerId } from '../ratkinDialogue';
import type { VillagerSystem } from '../VillagerSystem';
import type { ConversationController } from '../villagerTopics';
import { COOK, cookhouseTopics } from './cookhouse';
import { SMITH, forgeTopics, type ForgeHost } from './forge';
import { DOCTOR, infirmaryTopics, type InfirmaryHost } from './infirmary';
import { lumberForemanTopics, type LumberForemanHost } from './lumberForeman';
import { SawmillService } from './sawmill';
import type { Crawler, ServiceParty, ShopDefinition } from './serviceContext';
import { MERCHANT, tradingPostTopics } from './tradingPost';
import { renderTreatmentShimmer } from './treatmentShimmer';

/**
 * Every villager who takes coin over a counter, read off the same ids each
 * shop module barks its own lines through — a villager added to a shop's
 * topics without joining this list is a contradiction the typechecker cannot
 * catch, so keep it beside the imports it is built from rather than hand-rolled.
 */
const VENDOR_VILLAGER_IDS: readonly VillagerId[] = [COOK, DOCTOR, MERCHANT, SMITH];

/** What the services need from the scene's menus: the reward cards, the explainer and the notice strip. */
export interface ServiceMenus {
  enqueueReward(reward: GrantedReward): void;
  /** Runs `run` once every reward card on screen has been dismissed, or at once if none is. */
  afterRewardsDrain(run: () => void): void;
  openResourcingExplainer(): void;
  announce(message: string): void;
}

export interface VillageServicesDeps {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly state: BriarHollowState;
  readonly partyTools: PartyTools;
  readonly partyCrafts: PartyCraftsState;
  readonly site: BriarHollowSite;
  readonly villagers: VillagerSystem;
  readonly bus: EventBus | null;
  readonly audio: AudioManager | null;
  /** The sawmill's working switch: its blade spins while set. */
  readonly sawmill: { working: boolean };
  readonly menus: ServiceMenus;
  /** Whether a key is the one bound to interact, so holding it can carry a sawmill run on. */
  readonly isInteractKey: (key: string) => boolean;
  readonly noteResourceActivity: () => void;
  /** Whether the world is stopped under a menu; the treatment and the saw wait while it is. */
  readonly worldHalted: () => boolean;
}

const UPDATES_PER_SECOND = 60;
/** How long Sella's bandaging plays over the party before she pronounces them mended. */
export const TREATMENT_SECONDS = 1.5;
const TREATMENT_FRAMES = Math.round(TREATMENT_SECONDS * UPDATES_PER_SECOND);

/** A real cut at the machine, right next to the player. */
const SAWING_VOLUME = 0.7;
/** Fenna working the saw herself, heard from across the yard. */
const IDLE_SAWING_VOLUME = 0.18;
/** How far from the saw her working can still be heard, fading to nothing at the edge. */
const IDLE_SAWING_RANGE_TILES = 10;
const SAWING_LOOP = 'loopable_sawing';
const UPGRADE_SOUND = 'tool_upgrade';

/** The claim the priced menu has always had wherever it is shown; its buttons are ringed under this id. */
const PRICED_MENU_FOCUS_ID = 'priced-menu';

const TILE_CENTRE = 0.5;

export class VillageServices {
  readonly panel = new PricedMenuPanel();
  readonly picker: QuantityPicker;
  readonly sawmill: SawmillService;
  private treatmentFramesLeft = 0;
  private disposed = false;
  private readonly party: ServiceParty;
  private readonly removeKeyListeners: () => void;

  constructor(private readonly deps: VillageServicesDeps) {
    this.picker = new QuantityPicker(deps.audio);
    this.party = {
      human: deps.human,
      cat: deps.cat,
      active: () => (deps.human.isActive ? deps.human : deps.cat),
    };
    this.sawmill = new SawmillService({
      party: this.party,
      site: deps.site,
      bus: deps.bus,
      audio: deps.audio,
      sawmill: deps.sawmill,
      announce: (message) => deps.menus.announce(message),
      noteResourceActivity: deps.noteResourceActivity,
      fennaTilesFrom: (crawler) => this.fennaTilesFrom(crawler),
      fennaNoWood: () => void deps.villagers.bark('fenna', 'no_logs', true),
    });
    const counter = { openShop: (shop: ShopDefinition): void => this.openShop(shop) };
    const announce = (message: string): void => deps.menus.announce(message);
    deps.villagers.addTopicProvider(cookhouseTopics(counter, announce));
    deps.villagers.addTopicProvider(infirmaryTopics(this.party, this.infirmaryHost(counter)));
    deps.villagers.addTopicProvider(tradingPostTopics(deps.state, counter, announce));
    // "Shop" leads Oren's list ahead of the built-in "About the axe" small talk.
    deps.villagers.addTopicProvider(forgeTopics(this.forgeHost(counter)), { first: true });
    // "Process a batch" leads Fenna's list ahead of the built-in "How does the mill work?" small talk.
    deps.villagers.addTopicProvider(lumberForemanTopics(this.lumberForemanHost()), { first: true });
    this.removeKeyListeners = this.listenForInteractKey();
  }

  // ── Hosts the shop modules act through ─────────────────────────────────

  private infirmaryHost(counter: { openShop(shop: ShopDefinition): void }): InfirmaryHost {
    return {
      openShop: (shop) => counter.openShop(shop),
      beginTreatment: () => this.beginTreatment(),
    };
  }

  private forgeHost(counter: { openShop(shop: ShopDefinition): void }): ForgeHost {
    const { deps } = this;
    return {
      openShop: (shop) => counter.openShop(shop),
      party: this.party,
      partyTools: deps.partyTools,
      tools: deps.partyCrafts.tools,
      crafts: deps.partyCrafts,
      state: deps.state,
      bus: deps.bus,
      enqueueReward: (reward) => {
        if (!this.disposed) deps.menus.enqueueReward(reward);
      },
      showResourcingExplainer: () => {
        if (this.disposed) return;
        deps.menus.afterRewardsDrain(() => {
          if (!this.disposed) deps.menus.openResourcingExplainer();
        });
      },
      playUpgradeSound: () => deps.audio?.play(UPGRADE_SOUND),
    };
  }

  private lumberForemanHost(): LumberForemanHost {
    const { deps } = this;
    return {
      party: this.party,
      state: deps.state,
      bus: deps.bus,
      audio: deps.audio,
      openPicker: (options) => this.picker.open(options),
      respond: (ctl, lines) => this.fennaResponds(ctl, lines),
      announce: (message) => deps.menus.announce(message),
      noteResourceActivity: deps.noteResourceActivity,
    };
  }

  private fennaResponds(
    ctl: ConversationController,
    lines: readonly [Circumstance, ...Circumstance[]],
  ): void {
    if (this.deps.villagers.isConversationOpen) {
      ctl.say(...lines);
      return;
    }
    this.deps.villagers.bark('fenna', lines[0], true);
  }

  private fennaTilesFrom(crawler: Crawler): number | null {
    const fenna = this.deps.villagers.villagerFor('fenna');
    if (fenna === null) return null;
    return Math.hypot(fenna.x - crawler.x, fenna.y - crawler.y) / TILE_SIZE;
  }

  // ── The priced menu ────────────────────────────────────────────────────

  private openShop(shop: ShopDefinition): void {
    if (this.disposed) return;
    const audio = this.deps.audio;
    this.panel.open(
      shop.build,
      (option, buyer) => {
        const result = shop.purchase(option, buyer);
        audio?.play(result.ok ? 'purchase_success' : 'error');
        return result;
      },
      () => audio?.play('error'),
      shop.blockedLine,
      shop.rebuyGuardFrames,
    );
    audio?.play('menu_open');
  }

  // ── Sella's treatment ──────────────────────────────────────────────────

  /**
   * The party is already healed and charged by the time this runs; what
   * follows is the part the player watches. The menu gets out of the way so
   * the bandaging is seen over the crawlers rather than behind a dimmed panel.
   */
  private beginTreatment(): void {
    this.panel.close();
    this.treatmentFramesLeft = TREATMENT_FRAMES;
    const active = this.party.active();
    this.deps.villagers.villagerFor('sella')?.faceToward(active.x, active.y);
    this.deps.villagers.bark('sella', 'buy_healing', true);
    this.deps.audio?.playRandom(VILLAGE_CUES.doctorTreatment);
  }

  /** Whether Sella's bandaging is still playing over the party. */
  get isTreating(): boolean {
    return this.treatmentFramesLeft > 0;
  }

  private tickTreatment(): void {
    if (this.treatmentFramesLeft <= 0) return;
    this.treatmentFramesLeft--;
    if (this.treatmentFramesLeft === 0) this.deps.villagers.bark('sella', 'healing_complete', true);
  }

  // ── Per frame ──────────────────────────────────────────────────────────

  update(): void {
    const halted = this.deps.worldHalted();
    this.panel.update();
    this.picker.update();
    // The picker is Fenna's question; once she is no longer being talked to it has no one to answer.
    if (this.picker.isOpen && !this.deps.villagers.isConversationOpen) this.picker.close();
    if (!halted) this.tickTreatment();
    this.sawmill.update(halted);
    this.updateSawSound(halted);
  }

  /** One loop, two uses: loud while a cut runs at the machine, faint while Fenna works the saw. */
  private updateSawSound(halted: boolean): void {
    const audio = this.deps.audio;
    if (audio === null) return;
    const volume = halted ? 0 : this.sawVolume();
    if (volume <= 0) {
      audio.stopAmbientLoop(SAWING_LOOP);
      return;
    }
    if (audio.isAmbientLoopRunning(SAWING_LOOP)) audio.setAmbientLoopVolume(SAWING_LOOP, volume);
    else audio.startAmbientLoop(SAWING_LOOP, volume);
  }

  private sawVolume(): number {
    if (this.sawmill.isSawing) return SAWING_VOLUME;
    const fenna = this.deps.villagers.villagerFor('fenna');
    if (fenna?.state !== 'working') return 0;
    const tiles = this.sawmill.tilesToStation(this.party.active());
    if (tiles >= IDLE_SAWING_RANGE_TILES) return 0;
    return IDLE_SAWING_VOLUME * (1 - tiles / IDLE_SAWING_RANGE_TILES);
  }

  // ── The interact key, held ─────────────────────────────────────────────

  /**
   * Tracks the interact key's own down/up, not the scene's held-key set:
   * only a press that started while no menu was up counts, so a key already
   * held when a menu opened and closed never quietly restarts the saw.
   */
  private listenForInteractKey(): () => void {
    // Headless checks run with no window, or a stub of one that has no events.
    const hasKeyEvents =
      typeof window !== 'undefined' && typeof window.addEventListener === 'function';
    if (!hasKeyEvents) return () => undefined;
    const down = (event: KeyboardEvent): void => {
      if (event.repeat || !this.deps.isInteractKey(event.key)) return;
      this.sawmill.setKeyHeld(!this.isAnyPanelOpen);
    };
    const up = (event: KeyboardEvent): void => {
      if (this.deps.isInteractKey(event.key)) this.sawmill.setKeyHeld(false);
    };
    const blur = (): void => this.sawmill.setKeyHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }

  private get isAnyPanelOpen(): boolean {
    return this.isShopBusy || this.deps.villagers.isConversationOpen;
  }

  /**
   * Whether the priced menu or the quantity picker is still up, independent
   * of the conversation that opened it — the conversation closes first, so
   * `VillagerSystem` reads this to know its villager is still mid-transaction
   * and should not yet be sent back to work.
   */
  get isShopBusy(): boolean {
    return this.panel.isOpen || this.picker.isOpen;
  }

  // ── The Space chain and taps ───────────────────────────────────────────

  /**
   * Whether a press from `active` goes to a machine rather than a villager:
   * the machine must be in reach, and nearer than whoever could be talked to.
   */
  private machineTakesPress(active: Crawler): boolean {
    if (this.sawmill.isWorking) return true;
    if (this.sawmill.stationFor(active) === null) return false;
    const villager = this.deps.villagers.talkTarget(active);
    if (villager === null) return true;
    const villagerTiles = Math.hypot(villager.x - active.x, villager.y - active.y) / TILE_SIZE;
    return this.sawmill.tilesToStation(active) <= villagerTiles;
  }

  /** The Space chain's machine link. Returns whether the press was taken. */
  tryInteract(active: Crawler): boolean {
    if (!this.machineTakesPress(active)) return false;
    return this.sawmill.press(active) !== null || this.sawmill.isWorking;
  }

  wouldInteract(active: Crawler): boolean {
    return this.machineTakesPress(active);
  }

  /** A tap on a machine's footprint while in reach of it: work it once. */
  handleTap(worldX: number, worldY: number, active: Crawler): boolean {
    if (!this.tappedStation(worldX, worldY, active)) return false;
    this.sawmill.press(active);
    return true;
  }

  /** A long-press on a machine: work it until the wood runs out, a tap lands or the crawler moves. */
  handleLongPress(worldX: number, worldY: number, active: Crawler): boolean {
    if (!this.tappedStation(worldX, worldY, active)) return false;
    this.sawmill.press(active, true);
    return true;
  }

  private tappedStation(worldX: number, worldY: number, active: Crawler): boolean {
    const station = this.sawmill.stationFor(active);
    if (station === null) return false;
    const { x, y, w, h } = station.footprint;
    const tileX = worldX / TILE_SIZE;
    const tileY = worldY / TILE_SIZE;
    return tileX >= x && tileX <= x + w && tileY >= y && tileY <= y + h;
  }

  // ── Drawing ────────────────────────────────────────────────────────────

  /** The sawmill's reach glow: ground-layer, so it never draws over the machine, the player or a mob. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const active = this.party.active();
    if (!this.machineTakesPress(active)) return;
    this.sawmill.renderGround(ctx, camX, camY, active);
  }

  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Crawler,
  ): boolean {
    // Mid-cut the press is the machine's, so no one else's prompt may show; the progress bar is the cue.
    if (this.sawmill.isWorking) return true;
    if (!this.machineTakesPress(active)) return false;
    return this.sawmill.renderPrompt(ctx, camX, camY, active);
  }

  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.sawmill.renderFarIndicators(ctx, camX, camY, this.party.active());
    this.sawmill.renderAbove(ctx, camX, camY);
    if (this.treatmentFramesLeft <= 0) return;
    const progress = 1 - this.treatmentFramesLeft / TREATMENT_FRAMES;
    for (const crawler of [this.deps.human, this.deps.cat]) {
      renderTreatmentShimmer(
        ctx,
        crawler.x + TILE_SIZE * TILE_CENTRE - camX,
        crawler.y + TILE_SIZE * TILE_CENTRE - camY,
        progress,
      );
    }
  }

  renderDialog(ctx: CanvasRenderingContext2D): void {
    this.panel.render(ctx, this.party.active());
    this.picker.render(ctx);
  }

  /** The sawmill's two machines, in tile coordinates with their output, for the minimap. */
  minimapProcessingStations(): Array<{ x: number; y: number; kind: ProcessingStationKind }> {
    return this.sawmill.minimapStations();
  }

  /** Every present vendor villager's tile position, for the minimap's `$` markers. */
  minimapVendorPositions(): Array<{ x: number; y: number }> {
    const positions: Array<{ x: number; y: number }> = [];
    for (const id of VENDOR_VILLAGER_IDS) {
      const villager = this.deps.villagers.villagerFor(id);
      if (villager === null) continue;
      positions.push({ x: villager.x, y: villager.y });
    }
    return positions;
  }

  // ── Input ──────────────────────────────────────────────────────────────

  handleKeyDown(key: string): boolean {
    if (this.picker.handleKey(key)) return true;
    if (this.panel.isOpen && key === 'Escape') {
      this.panel.close();
      return true;
    }
    return false;
  }

  handleClick(mx: number, my: number): boolean {
    if (this.picker.handleClick(mx, my)) return true;
    return this.panel.handleClick(mx, my, this.party.active());
  }

  handleWheel(deltaY: number): void {
    this.panel.handleWheel(deltaY);
  }

  get isMenuOpen(): boolean {
    return this.panel.isOpen || this.picker.isOpen;
  }

  /** Topmost first: the picker opens over Fenna's conversation, the priced menu over the village. */
  overlayClaims(): OverlayInputClaim[] {
    return [
      this.picker.overlayClaim(),
      {
        isOpen: this.panel.isOpen,
        // The panel's own focus ring answers Space; the claim keeps it from the world.
        space: { kind: 'swallow' },
        locksKeyboard: true,
        haltsWorld: true,
        focusContext: PRICED_MENU_FOCUS_ID,
      },
    ];
  }

  /** Takes the priced menu and the picker down: drawn over a death screen they would take its clicks. */
  closePanels(): void {
    this.panel.close();
    this.picker.close();
  }

  /** Stops the saw's loop for a hard stop the village is not ticked through; it resumes on the next tick. */
  silenceLoops(): void {
    this.deps.audio?.stopAmbientLoop(SAWING_LOOP);
  }

  /** A death rewind: nothing mid-cut or mid-treatment survives the respawn, and no menu stays up. */
  onRewind(): void {
    this.sawmill.cancel();
    this.treatmentFramesLeft = 0;
    this.panel.close();
    this.picker.close();
  }

  dispose(): void {
    this.disposed = true;
    this.removeKeyListeners();
    this.onRewind();
    this.deps.audio?.stopAmbientLoop(SAWING_LOOP);
  }
}
