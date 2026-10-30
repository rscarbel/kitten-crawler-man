import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../core/constants';
import type { GearOwnership } from './market/vendorMenu';
import { NEVER_LUCKY, type LuckCheck } from '../core/state/GodMode';
import { playInteriorCue } from '../audio/interiorInteractionSoundCues';
import type { Player } from '../Player';
import type { AudioManager } from '../audio/AudioManager';
import type { AudioScope, MusicClaims } from '../audio/AudioScope';
import { CASINO_MUSIC_TRACKS } from '../audio/sounds';
import type { CasinoState } from '../core/club/CasinoState';
import type { AchievementId } from '../core/progression/achievementSave';
import type { AchievementAwards } from './AchievementAwards';
import type { GameMap } from '../map/GameMap';
import type { InteriorFigure } from '../core/rendering/InteriorFigure';
import {
  CLUB_STATIONS,
  CLUB_DANCE_FLOOR,
  CLUB_DONALD_POST,
  CLUB_DANCER_TILES,
  CLUB_INTERIOR_W,
  CLUB_PERFORMER_POSTS,
  CLUB_STAFFED_POSTS,
  CLUB_DEALER_POST,
  type ClubPerformerPost,
  type ClubStation,
  type ClubStationId,
} from '../core/club/clubLayout';
import { CLUB_PROPS, propSortY, type ClubProp } from '../core/club/clubProps';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { beginOverheadMeasure, endOverheadMeasure } from '../ui/world/overheadStack';
import { drawClubCastFigure, type ClubFigureRef } from '../sprites/clubCastFigure';
import {
  IconAnchor,
  drawOverheadIcon,
  overheadIconFor,
  type ShopSign,
} from '../sprites/overheadIcon';
import { scaleHumanoidBox } from '../sprites/humanoidScale';
import {
  CLUB_BARTENDER,
  clubDancerAt,
  type ClubDancer,
  CLUB_MARKET_VENDOR,
} from '../sprites/clubCastRoster';
import { drawCasinoDealer, drawCasinoDealerHands } from '../sprites/casinoDealerSprite';
import { drawDonaldFigure } from '../sprites/donaldSprite';
import { CLUB_PERFORMER_ACTS, clubStageLiftPx } from '../sprites/clubPerformers';
import { drawClubProp } from '../sprites/clubFurnitureSprite';
import { drawClubDecor } from '../sprites/clubDecor';
import { ShopSystem } from './ShopSystem';
import { ClubCasinoSystem, type CasinoSeat } from './ClubCasinoSystem';
import { ClubPokerSystem, POKER_MIN_BUY_IN } from './ClubPokerSystem';
import { ClubGamblerSystem } from './ClubGamblerSystem';
import { TABLE_MAXIMUM, TABLE_MINIMUM } from './casino/BlackjackTable';
import { POKER_DEV_SEED } from './casino/poker/npc/personality';
import { canAffordCoins } from '../core/party/partyCoins';
import { casinoGamePickerSurface } from '../ui/screens/dialogs/casinoGamePicker';
import { ClubSlotsSystem } from './ClubSlotsSystem';
import {
  idleCasinoGameHost,
  idleWheelGameHost,
  type CasinoGameHost,
  type CasinoGameHosts,
} from './casino/CasinoGameHost';
import type { ToastTone } from '../ui/hud/toasts';
import type { Surface } from '../ui/core/UiRoot';
import { shopScreenSurface } from '../ui/screens/shop/ShopScreen';
import { priceBreakdownsShown } from '../ui/screens/shop/priceBreakdowns';
import type { ShopParty } from '../ui/screens/shop/shopSession';
import {
  createClubCrowd,
  tileBody,
  placeMovingBody,
  type MovingBodyKind,
  type ClubCrowdSystem,
  type CrowdBody,
} from './ClubCrowdSystem';
import type { ShopStock } from '../economy/shopStock';
import { worldPalette } from '../ui/theme/worldInk';

const STATION_INTERACT_RANGE = 2.6;
/** How long the club set and the jazz set take to crossfade, either way. */
const CASINO_MUSIC_CROSSFADE_MS = 800;
/**
 * `animTime` counts frames, but the dealer sprite times its motion in real
 * milliseconds so the two renderings of Deuce move at the same speed.
 */
const MS_PER_SECOND = 1000;
const MS_PER_FRAME = MS_PER_SECOND / WORLD_TICKS_PER_SECOND;

function casinoTableSortY(): number {
  const table = CLUB_PROPS.find((prop) => prop.sprite === 'club_casino_table');
  if (table === undefined) throw new Error('the club layout has no blackjack table');
  return propSortY(table);
}

/** The blackjack table's place in the Y-sort; Deuce's hands sort just after it. */
const CASINO_TABLE_SORT_Y = casinoTableSortY();
/** Enough to break the tie with the table so the hands always paint over it. */
const DEALER_HANDS_AFTER_TABLE_PX = 0.5;
/**
 * A dancer sorts this far after her stage's front row, so she is painted on
 * top of the platform she stands on and still behind a crawler on the row in
 * front of it.
 */
const PERFORMER_AFTER_STAGE_PX = 0.5;
const TILE_HALF = 0.5;
/**
 * Seconds each stage's act runs ahead of the one before it, so the two dancers
 * never hit the same beat at once and the room never looks choreographed.
 */
const PERFORMER_STAGGER_SECONDS = 5.3;

// Dance-floor light overlay
const DANCE_LIGHT_COLORS = worldPalette.danceFloorLights;
const DANCE_LIGHT_PERIOD_MS = 900;
const DANCE_LIGHT_TILE_PHASE_X = 0.7;
const DANCE_LIGHT_TILE_PHASE_Y = 1.3;
const DANCE_LIGHT_ALPHA_BASE = 0.16;
const DANCE_LIGHT_ALPHA_SWING = 0.22;
const DANCE_LIGHT_CENTER_FRACTION = 0.5;
const DANCE_LIGHT_RADIUS_FRACTION = 0.62;

/**
 * The one place the club's market shop is built, so a gate that wants to
 * assert on the Stat Boost row's real price and stock exercises the same
 * `SHOPS` entry and the same stock wiring the club actually plays with,
 * rather than a copy that could drift from it unnoticed.
 */
export function createClubMarketShop(shopStock: ShopStock, owns: GearOwnership): ShopSystem {
  return new ShopSystem(CLUB_INTERIOR_W, 'club_market', shopStock, owns);
}

/** The bar and the market both sell at any hour, so each keeper wears the coin. */
const STATION_SHOP_SIGN = 'trades' as const satisfies ShopSign;
/** Which cast figure each counter's keeper draws as; the casino's staff have their own painters. */
const STATION_FIGURE: Readonly<Record<Exclude<ClubStationId, 'casino'>, ClubFigureRef>> = {
  bar: CLUB_BARTENDER,
  market: CLUB_MARKET_VENDOR,
};

const CLUB_BAR_SURFACE_ID = 'club-bar-shop';
const CLUB_MARKET_SURFACE_ID = 'club-market-shop';
const CASINO_GAME_PICKER_SURFACE_ID = 'casino-game-picker';
const POKER_BUY_IN_SURFACE_ID = 'poker-buy-in';
const POKER_TABLE_SURFACE_ID = 'poker-table';
const POKER_RULES_SURFACE_ID = 'poker-rules';
const POKER_HISTORY_SURFACE_ID = 'poker-history';
const POKER_SEAT_INFO_SURFACE_ID = 'poker-seat-info';
const POKER_BUST_SURFACE_ID = 'poker-bust';
const POKER_GAME_OVER_SURFACE_ID = 'poker-game-over';
const POKER_LEAVE_CONFIRM_SURFACE_ID = 'poker-leave-confirm';

/** Every surface {@link CloakAndDaggerSystem.stationSurfaces} mounts. */
export const CLUB_STATION_SURFACE_IDS: readonly string[] = [
  CLUB_BAR_SURFACE_ID,
  CLUB_MARKET_SURFACE_ID,
];

const STATION_PROMPT: Readonly<Record<ClubStationId, string>> = {
  bar: 'Shop',
  market: 'Shop',
  casino: 'Play',
};

/**
 * Host system for the Cloak & Dagger interior (the analog of SafeRoomSystem /
 * ShopSystem): the floor dressing and dance-floor lights, the furniture,
 * staff, stages and gamblers that join the interior's Y-sorted pass, the
 * wandering crowd, and proximity prompts for every station. The bar and
 * market shops and the casino attach to it. The host at the door is a
 * resident of the room's occupant system, not of this one.
 *
 * Deliberately not a `GameSystem`: its update needs the crawlers' positions to
 * push the crowd around, which the generic per-frame `SystemContext` contract
 * doesn't carry. `BuildingInteriorScene` owns and drives it directly.
 */
export class CloakAndDaggerSystem {
  private animTime = 0;

  private readonly barShop: ShopSystem;
  private readonly marketShop: ShopSystem;
  private readonly casino: ClubCasinoSystem;
  private readonly poker: ClubPokerSystem;
  /** The picker's slots and wheel, each run by its own host system. */
  private readonly games: CasinoGameHosts = {
    slots: idleCasinoGameHost(),
    wheel: idleWheelGameHost(),
  };
  /** The casino's "which game?" question is up. */
  private gamePickerOpen = false;

  private readonly crowd: ClubCrowdSystem;
  private readonly gamblers: ClubGamblerSystem;

  /**
   * Rebuilt each frame: the figures a patron must not walk into. Held as a field
   * so a floor full of people costs no per-frame allocation.
   */
  private readonly crowdObstacles: CrowdBody[] = [];
  /** The staff and the floor's dancers, who never move: their bodies are made once. */
  private readonly fixedBodies: ReadonlyArray<CrowdBody> = [
    ...CLUB_STAFFED_POSTS,
    ...CLUB_DANCER_TILES,
  ].map(tileBody);
  /** Bodies for whoever moves — crawlers and residents — refilled in place each frame. */
  private readonly movingBodies: CrowdBody[] = [];
  private movingBodiesUsed = 0;

  /**
   * How far above its tile each staffed station's last draw reached — its
   * keeper, and the badge they wear — keyed by the station's own tile.
   */
  private readonly postOverheadReachPx = new Map<ClubStation['tile'], number>();

  /** The club's standing cast — furniture, staff and stages — none of which ever moves. */
  private readonly fixtureFigures: ReadonlyArray<InteriorFigure> = this.buildFixtureFigures();
  /** Refilled each frame from the fixtures plus whoever is walking around. */
  private readonly sortedFigures: InteriorFigure[] = [];

  /** Passed straight through from the casino's own `onWinnings` — see there for the flight's origin and timing. */
  onCasinoWinnings: ((coins: number, screenX: number, screenY: number) => void) | null = null;
  /** A casino notice for the scene's toasts, such as the poker cash-out. */
  onCasinoNotice: ((message: string, tone: ToastTone) => void) | null = null;

  /**
   * Edge-triggered rather than per surface, so moving between casino surfaces
   * in one sitting never restarts the jazz.
   */
  private casinoMusicActive = false;
  private readonly music: MusicClaims | null;

  constructor(
    map: GameMap,
    casinoState: CasinoState,
    private readonly audio: AudioManager | null,
    audioScope: AudioScope | null,
    shopStock: ShopStock,
    owns: GearOwnership,
    private readonly awards?: AchievementAwards,
    worldSeed: number = POKER_DEV_SEED,
    isLucky: LuckCheck = NEVER_LUCKY,
  ) {
    this.music = audioScope;
    this.crowd = createClubCrowd(map);
    this.gamblers = new ClubGamblerSystem();
    this.barShop = new ShopSystem(CLUB_INTERIOR_W, 'club_bar', shopStock, owns);
    this.marketShop = createClubMarketShop(shopStock, owns);
    this.casino = new ClubCasinoSystem(audio, casinoState);
    this.casino.isLucky = isLucky;
    this.casino.onWinnings = (coins, screenX, screenY) =>
      this.onCasinoWinnings?.(coins, screenX, screenY);
    this.poker = new ClubPokerSystem(
      audio,
      worldSeed,
      () => performance.now(),
      Math.random,
      casinoState,
    );
    this.poker.onWinnings = (coins, screenX, screenY) =>
      this.onCasinoWinnings?.(coins, screenX, screenY);
    this.poker.onNotice = (message, tone) => this.onCasinoNotice?.(message, tone);
    this.poker.isLucky = isLucky;
    const slots = new ClubSlotsSystem(audio, audioScope, casinoState);
    slots.isLucky = isLucky;
    slots.onWinnings = (coins, screenX, screenY) =>
      this.onCasinoWinnings?.(coins, screenX, screenY);
    this.games.slots = slots;
    for (const post of CLUB_PERFORMER_POSTS) CLUB_PERFORMER_ACTS[post.performer].prewarm();
    this.gamblers.prewarm();
  }

  /** The furniture this interior places, for whatever plays from a piece of it. */
  get props(): ReadonlyArray<ClubProp> {
    return CLUB_PROPS;
  }

  /** Unlock a club achievement for both crawlers; one already held is left alone. */
  private unlockAchievement(id: AchievementId): void {
    this.awards?.unlockParty(id);
  }

  /**
   * Seats a game whose host the scene builds, in place of its idle stand-in.
   * Call before the club's surfaces are mounted, which is when the host's own
   * surfaces join them.
   */
  installCasinoGame<Game extends keyof CasinoGameHosts>(
    game: Game,
    host: CasinoGameHosts[Game],
  ): void {
    this.games[game] = host;
    this.games.wheel.bindPicker(() => {
      this.gamePickerOpen = true;
    });
  }

  private casinoGameHosts(): readonly CasinoGameHost[] {
    return [this.games.slots, this.games.wheel];
  }

  /** The bar/market shop whose counter is currently open, if any. */
  private activeShop(): ShopSystem | null {
    if (this.barShop.isOpen) return this.barShop;
    if (this.marketShop.isOpen) return this.marketShop;
    return null;
  }

  /** The bar and market counters. */
  stationSurfaces(party: () => ShopParty): Surface[] {
    return [
      shopScreenSurface({
        id: CLUB_BAR_SURFACE_ID,
        session: this.barShop.session,
        party,
        showPriceBreakdowns: priceBreakdownsShown,
      }),
      shopScreenSurface({
        id: CLUB_MARKET_SURFACE_ID,
        session: this.marketShop.session,
        party,
        showPriceBreakdowns: priceBreakdownsShown,
      }),
    ];
  }

  /** The blackjack table and its rules sheet, in stacking order: the sheet sits above the table. */
  casinoSurfaces(seat: CasinoSeat): Surface[] {
    return [
      this.casino.tableSurface('club-casino', seat),
      this.casino.rulesSurface('blackjack-rules'),
    ];
  }

  /**
   * The game picker and every poker surface: the buy-in, the table, the hand
   * history, a seat's card, the rules sheet, the bust prompt and the leave
   * confirm, then every surface of the slots and wheel hosts. All are modal,
   * and surfaces in one band stack in the order they open, so whichever opened
   * last sits on top.
   */
  pokerSurfaces(seat: CasinoSeat): Surface[] {
    return [
      casinoGamePickerSurface({
        id: CASINO_GAME_PICKER_SURFACE_ID,
        isOpen: () => this.gamePickerOpen,
        minPokerBuyIn: POKER_MIN_BUY_IN,
        blackjackBets: { min: TABLE_MINIMUM, max: TABLE_MAXIMUM },
        canBuyIntoPoker: () => canAffordCoins(seat.active(), seat.companion(), POKER_MIN_BUY_IN),
        onSlots: () => {
          this.gamePickerOpen = false;
          this.games.slots.open(seat);
        },
        onWheel: () => {
          this.gamePickerOpen = false;
          this.games.wheel.open(seat);
        },
        freeSpins: () => this.games.wheel.freeSpinOffer,
        onFreeSpin: () => {
          if (this.games.wheel.openFreeSpin(seat)) this.gamePickerOpen = false;
        },
        onBlackjack: () => {
          this.gamePickerOpen = false;
          this.casino.openTable(seat.active(), seat.companion());
        },
        onPoker: () => {
          this.gamePickerOpen = false;
          this.poker.openBuyIn();
        },
        onClose: () => {
          this.gamePickerOpen = false;
        },
      }),
      this.poker.buyInSurface(POKER_BUY_IN_SURFACE_ID, seat),
      this.poker.tableSurface(POKER_TABLE_SURFACE_ID, seat),
      this.poker.historySurface(POKER_HISTORY_SURFACE_ID),
      this.poker.seatInfoSurface(POKER_SEAT_INFO_SURFACE_ID),
      this.poker.rulesSurface(POKER_RULES_SURFACE_ID),
      this.poker.bustSurface(POKER_BUST_SURFACE_ID, seat),
      this.poker.gameOverSurface(POKER_GAME_OVER_SURFACE_ID, seat),
      this.poker.leaveConfirmSurface(POKER_LEAVE_CONFIRM_SURFACE_ID),
      ...this.casinoGameHosts().flatMap((host) => host.surfaces(seat)),
    ];
  }

  get modalOpen(): boolean {
    return this.activeShop() !== null || this.anyCasinoSurfaceOpen();
  }

  /**
   * `standing` is everyone else who holds a mark on the floor — the host at
   * the door — so the crowd walks round them as it does the staff.
   */
  update(
    active: Player,
    companion: Player | null,
    standing: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  ): void {
    this.animTime++;
    this.crowd.update(this.staticCrowdBodies(active, companion, standing));
    this.tickCounters();
    // Only the coin-pool total this drives matters, and the casino is never open
    // while this update runs — an open table routes through `tickOpenModals`
    // instead — so a missing companion here falls back to the active crawler alone.
    this.casino.update(active, companion ?? active);
    this.tickCasino();
  }

  /**
   * Drive the sub-panels that keep running while they are open. The club's
   * `update` is gated behind `modalOpen` by the interior scene, so anything with
   * its own clock — the casino's dealing and dealer beats — has to be pumped
   * from here instead.
   */
  tickOpenModals(active: Player, companion: Player): void {
    this.animTime++;
    this.tickCounters();
    this.casino.update(active, companion);
    this.tickCasino();
  }

  private tickCounters(): void {
    this.barShop.update();
    this.marketShop.update();
    this.drainShopTrades();
  }

  /**
   * Everything after the blackjack table: the poker table and the hosted
   * games, the gamblers watching them, and the flags and music they leave.
   * The jackpot flag is drained on both paths, because a natural can settle
   * while the panel is still open and that panel can be the last thing the
   * player touches before leaving.
   */
  private tickCasino(): void {
    this.poker.update();
    this.updateCasinoGameHosts();
    this.gamblers.update(this.animTime, {
      blackjackOpen: this.casino.open,
      pokerSeats: this.poker.pokerTable?.seats ?? null,
    });
    this.consumePendingUnlocks();
    this.syncCasinoMusic();
  }

  private updateCasinoGameHosts(): void {
    for (const host of this.casinoGameHosts()) host.update();
  }

  private anyCasinoSurfaceOpen(): boolean {
    return (
      this.casino.open ||
      this.gamePickerOpen ||
      this.poker.anySurfaceOpen ||
      this.casinoGameHosts().some((host) => host.anySurfaceOpen)
    );
  }

  /**
   * Runs from both `update` and `tickOpenModals`, because the interior scene
   * calls only one of them on any frame depending on whether a modal is open.
   */
  private syncCasinoMusic(): void {
    const casinoOpen = this.anyCasinoSurfaceOpen();
    if (casinoOpen === this.casinoMusicActive) return;
    this.casinoMusicActive = casinoOpen;
    if (!casinoOpen) {
      this.music?.releaseMusic('casino_tables', { fadeOutMs: CASINO_MUSIC_CROSSFADE_MS });
      return;
    }
    this.music?.claimMusic({
      owner: 'casino_tables',
      layer: 'activity',
      selection: { kind: 'playlist', ids: CASINO_MUSIC_TRACKS },
      fadeInMs: CASINO_MUSIC_CROSSFADE_MS,
    });
  }

  /** Sounds whatever went over either counter since the last tick. */
  private drainShopTrades(): void {
    if (!this.barShop.purchasePending && !this.marketShop.purchasePending) return;
    // A round at the bar pours; gear off the market rack goes through the till.
    if (this.barShop.purchasePending) this.audio?.play('ambient_pouring_a_drink');
    if (this.marketShop.purchasePending) playInteriorCue(this.audio, 'tillDrawer');
    this.barShop.purchasePending = false;
    this.marketShop.purchasePending = false;
    this.audio?.play('purchase_success');
  }

  /** Drain every sub-panel's "something unlockable happened" flag. */
  private consumePendingUnlocks(): void {
    if (!this.casino.jackpotPending) return;
    this.casino.jackpotPending = false;
    this.unlockAchievement('casino_jackpot');
  }

  /**
   * The immovable figures on the floor this frame: every station keeper, the
   * dancers, the crawlers and whoever else holds a mark. Patrons are pushed
   * clear of all of them, which is what stops the crowd wading through the
   * staff.
   */
  private staticCrowdBodies(
    active: Player,
    companion: Player | null,
    standing: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  ): ReadonlyArray<CrowdBody> {
    this.crowdObstacles.length = 0;
    for (const body of this.fixedBodies) this.crowdObstacles.push(body);
    this.movingBodiesUsed = 0;
    this.addMovingObstacle(active, 'crawler');
    if (companion !== null) this.addMovingObstacle(companion, 'crawler');
    for (const figure of standing) this.addMovingObstacle(figure, 'standing');
    return this.crowdObstacles;
  }

  /** Takes the next pooled body, growing the pool only the first frame it is short. */
  private addMovingObstacle(
    pos: { readonly x: number; readonly y: number },
    kind: MovingBodyKind,
  ): void {
    if (this.movingBodiesUsed === this.movingBodies.length) {
      this.movingBodies.push({ cx: 0, cy: 0, radius: 0 });
    }
    const body = this.movingBodies[this.movingBodiesUsed];
    this.movingBodiesUsed++;
    placeMovingBody(body, pos, kind);
    this.crowdObstacles.push(body);
  }

  private isNear(tile: { x: number; y: number }, player: Player): boolean {
    return this.distanceTo(tile, player) < TILE_SIZE * STATION_INTERACT_RANGE;
  }

  private distanceTo(tile: { x: number; y: number }, player: Player): number {
    const stationPx = (tile.x + TILE_HALF) * TILE_SIZE;
    const stationPy = (tile.y + TILE_HALF) * TILE_SIZE;
    const px = player.x + TILE_SIZE * TILE_HALF;
    const py = player.y + TILE_SIZE * TILE_HALF;
    return Math.hypot(px - stationPx, py - stationPy);
  }

  /** The closest station in reach: the casino's games stand near enough that two can be. */
  private nearestStation(player: Player): ClubStation | null {
    let nearest: ClubStation | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const station of CLUB_STATIONS) {
      if (!this.isNear(station.tile, player)) continue;
      const distance = this.distanceTo(station.tile, player);
      if (distance >= nearestDistance) continue;
      nearest = station;
      nearestDistance = distance;
    }
    return nearest;
  }

  /**
   * Space/tap interaction: open the station the player stands beside. Returns
   * whether the press was consumed, so a press with no station in range can
   * still fall through to whoever else is standing there.
   */
  handleInteract(player: Player): boolean {
    const station = this.nearestStation(player);
    if (station === null) return false;
    switch (station.id) {
      case 'bar':
        this.barShop.open();
        return true;
      case 'market':
        this.marketShop.open();
        return true;
      case 'casino':
        this.gamePickerOpen = true;
        return true;
      default: {
        const unhandled: never = station.id;
        throw new Error(`unhandled club station ${String(unhandled)}`);
      }
    }
  }

  /**
   * Shut every sub-panel outright, for the scene being torn down under an open
   * modal: a teardown has to close every sub-panel at once regardless of which
   * happens to sit on top, and the rules overlay is one level under the
   * blackjack table it sits on.
   */
  closeAll(player: Player): void {
    this.barShop.close();
    this.marketShop.close();
    if (this.casino.open) this.casino.close(player);
    this.gamePickerOpen = false;
    this.poker.forceClose(player);
    for (const host of this.casinoGameHosts()) host.forceClose?.();
    this.casinoMusicActive = false;
    this.music?.releaseMusic('casino_tables');
    // No tick runs after a teardown to notice a flag a panel set on its way out
    // — and closing the casino can fast-forward a live hand into a natural.
    this.consumePendingUnlocks();
  }

  /**
   * Flat-on-the-ground dressing: zone rugs, floor wear and the dance-floor
   * lights. Drawn before the interior's Y-sorted pass so everything that stands
   * on the club floor — furniture, staff, crawlers — draws on top of it.
   */
  renderFloor(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    drawClubDecor(ctx, camX, camY);
    this.renderDanceFloorLights(ctx, camX, camY);
  }

  /**
   * Everything in the club that occupies space and must sort against the
   * crawlers by depth: the furniture, the station staff behind their counters,
   * the stages and their dancers, the gamblers, and the crowd.
   *
   * Each entry reports the `y` the interior's pass sorts on — for furniture that
   * is the top of its footprint row, so a counter sorts exactly like a figure
   * standing on the same tile.
   */
  sortedRenderables(): ReadonlyArray<InteriorFigure> {
    this.sortedFigures.length = 0;
    this.sortedFigures.push(...this.fixtureFigures);
    this.sortedFigures.push(...this.gamblers.renderables());
    this.sortedFigures.push(...this.crowd.renderables());
    return this.sortedFigures;
  }

  /**
   * The furniture, the staff and the stage acts, built once: none of them ever
   * moves, so the only thing a per-frame rebuild would recompute is the
   * animation phase, which the render closures read live off `animTime`.
   */
  private buildFixtureFigures(): ReadonlyArray<InteriorFigure> {
    const figures: InteriorFigure[] = CLUB_PROPS.map((prop) => ({
      y: propSortY(prop),
      render: (ctx: CanvasRenderingContext2D, camX: number, camY: number) =>
        drawClubProp(ctx, prop, camX, camY, this.animTime / WORLD_TICKS_PER_SECOND),
    }));

    CLUB_DANCER_TILES.forEach((tile, i) => figures.push(this.dancerFigure(tile, clubDancerAt(i))));
    CLUB_PERFORMER_POSTS.forEach((post, i) =>
      figures.push(this.performerFigure(post, i * PERFORMER_STAGGER_SECONDS)),
    );
    figures.push(this.donaldFigure(CLUB_DONALD_POST));
    figures.push(this.dealerFigure(CLUB_DEALER_POST));
    figures.push(this.dealerHandsFigure(CLUB_DEALER_POST));
    for (const station of CLUB_STATIONS) {
      if (station.id === 'casino') continue;
      figures.push(
        this.castFigure(
          station.tile,
          STATION_FIGURE[station.id],
          'idle',
          1,
          station.tile.x,
          STATION_SHOP_SIGN,
        ),
      );
    }
    return figures;
  }

  /**
   * A figure standing still on `tile`, drawn from the Hawkfolk or human closed
   * cast. `seed` staggers the animation loop so a room of NPCs doesn't breathe
   * in lockstep.
   */
  private castFigure(
    tile: { x: number; y: number },
    ref: ClubFigureRef,
    action: 'idle',
    facingX: number,
    seed: number,
    shopSign: ShopSign,
  ): InteriorFigure {
    // The club's staff have no questline, so the only icon one can wear is the coin.
    const icon = overheadIconFor('none', shopSign);
    return {
      y: tile.y * TILE_SIZE,
      render: (ctx, camX, camY, tileSize) => {
        const sx = tile.x * TILE_SIZE - camX;
        const sy = tile.y * TILE_SIZE - camY;
        let overheadTop: number | null;
        beginOverheadMeasure(ctx, 'all');
        try {
          const drawnRow = drawClubCastFigure(ctx, ref, sx, sy, tileSize, {
            action,
            walkPhase: 0,
            facingX,
            facingY: 1,
            loopOffsetSeconds: seed / WORLD_TICKS_PER_SECOND,
          });
          if (icon !== 'none') {
            const box = scaleHumanoidBox(sx, sy, tileSize);
            const anchor = IconAnchor.ofRow(drawnRow, sy, tileSize);
            drawOverheadIcon(ctx, box.sx, anchor, box.s, icon);
          }
        } finally {
          overheadTop = endOverheadMeasure();
        }
        if (overheadTop !== null) this.postOverheadReachPx.set(tile, sy - overheadTop);
      },
    };
  }

  /** A dancer on the floor, facing the room, dancing its own routine on its own count. */
  private dancerFigure(tile: { x: number; y: number }, dancer: ClubDancer): InteriorFigure {
    return {
      y: tile.y * TILE_SIZE,
      render: (ctx, camX, camY, tileSize) =>
        drawClubCastFigure(
          ctx,
          dancer.ref,
          tile.x * TILE_SIZE - camX,
          tile.y * TILE_SIZE - camY,
          tileSize,
          {
            action: 'dance',
            walkPhase: 0,
            facingX: 0,
            facingY: 1,
            loopOffsetSeconds: dancer.loopOffsetSeconds,
            danceStyle: dancer.style,
          },
        ),
    };
  }

  /**
   * A stage's act, drawn at the pole raised by the stage's riser. The lift
   * belongs to the stage, not the dancer, so any act put on a stage stands on
   * its boards.
   */
  private performerFigure(post: ClubPerformerPost, offsetSeconds: number): InteriorFigure {
    const act = CLUB_PERFORMER_ACTS[post.performer];
    return {
      y: post.stage.y1 * TILE_SIZE + PERFORMER_AFTER_STAGE_PX,
      render: (ctx, camX, camY, tileSize) =>
        act.draw(
          ctx,
          post.pole.x * TILE_SIZE - camX,
          post.pole.y * TILE_SIZE - camY - clubStageLiftPx(tileSize),
          tileSize,
          this.animTime / WORLD_TICKS_PER_SECOND + offsetSeconds,
        ),
    };
  }

  /** Donald behind his counter at the foot of the wheel: dressing, not a station. */
  private donaldFigure(tile: { x: number; y: number }): InteriorFigure {
    return {
      y: tile.y * TILE_SIZE,
      render: (ctx, camX, camY, tileSize) =>
        drawDonaldFigure(ctx, tile.x * TILE_SIZE - camX, tile.y * TILE_SIZE - camY, {
          size: tileSize,
          timeMs: this.animTime * MS_PER_FRAME,
        }),
    };
  }

  /**
   * Deuce behind the blackjack table. Works the deck while the table is open
   * and rests otherwise, so the figure in the room tracks what the panel is
   * doing.
   */
  private dealerFigure(tile: { x: number; y: number }): InteriorFigure {
    return {
      y: tile.y * TILE_SIZE,
      render: (ctx, camX, camY, tileSize) =>
        drawCasinoDealer(
          ctx,
          tile.x * TILE_SIZE - camX,
          tile.y * TILE_SIZE - camY,
          tileSize,
          this.animTime * MS_PER_FRAME,
          this.casino.open || this.poker.tableOpen,
        ),
    };
  }

  /**
   * Deuce's arms and hands, which reach over the rim onto the felt: sorted just behind the
   * blackjack table so they paint over it instead of vanishing under its rim.
   */
  private dealerHandsFigure(tile: { x: number; y: number }): InteriorFigure {
    return {
      y: CASINO_TABLE_SORT_Y + DEALER_HANDS_AFTER_TABLE_PX,
      render: (ctx, camX, camY, tileSize) =>
        drawCasinoDealerHands(
          ctx,
          tile.x * TILE_SIZE - camX,
          tile.y * TILE_SIZE - camY,
          tileSize,
          this.animTime * MS_PER_FRAME,
          this.casino.open || this.poker.tableOpen,
        ),
    };
  }

  renderObjects(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    if (this.modalOpen) return;
    const station = this.nearestStation(active);
    if (station === null) return;
    const sx = station.tile.x * TILE_SIZE - camX;
    const sy = station.tile.y * TILE_SIZE - camY;
    drawInteractionPrompt(
      ctx,
      sx,
      this.stationTop(station, sx, sy),
      TILE_SIZE,
      sy + TILE_SIZE,
      STATION_PROMPT[station.id],
    );
  }

  /**
   * The line a station's prompt must clear. A staffed station's keeper stands
   * on its tile, enlarged past it, so the prompt clears them and any badge
   * they wear; a keeper painted by hand rather than from the figure cache
   * reports nothing, and is cleared by the box they are drawn in instead.
   */
  private stationTop(station: ClubStation, sx: number, sy: number): number {
    const staffed = CLUB_STAFFED_POSTS.some(
      (post) => post.x === station.tile.x && post.y === station.tile.y,
    );
    if (!staffed) return sy;
    const reach = this.postOverheadReachPx.get(station.tile);
    if (reach !== undefined) return sy - reach;
    return scaleHumanoidBox(sx, sy, TILE_SIZE).sy;
  }

  private renderDanceFloorLights(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const now = Date.now();
    ctx.save();
    for (let ty = CLUB_DANCE_FLOOR.y0; ty <= CLUB_DANCE_FLOOR.y1; ty++) {
      for (let tx = CLUB_DANCE_FLOOR.x0; tx <= CLUB_DANCE_FLOOR.x1; tx++) {
        const phase =
          now / DANCE_LIGHT_PERIOD_MS +
          tx * DANCE_LIGHT_TILE_PHASE_X +
          ty * DANCE_LIGHT_TILE_PHASE_Y;
        const color = DANCE_LIGHT_COLORS[Math.floor(Math.abs(phase)) % DANCE_LIGHT_COLORS.length];
        const alpha =
          DANCE_LIGHT_ALPHA_BASE +
          (Math.sin(phase * Math.PI) * TILE_HALF + TILE_HALF) * DANCE_LIGHT_ALPHA_SWING;
        const sx = tx * TILE_SIZE - camX;
        const sy = ty * TILE_SIZE - camY;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(
          sx + TILE_SIZE * DANCE_LIGHT_CENTER_FRACTION,
          sy + TILE_SIZE * DANCE_LIGHT_CENTER_FRACTION,
          TILE_SIZE * DANCE_LIGHT_RADIUS_FRACTION,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
