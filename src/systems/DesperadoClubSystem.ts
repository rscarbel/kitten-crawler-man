import { TILE_SIZE } from '../core/constants';
import type { Player } from '../Player';
import type { AudioManager } from '../audio/AudioManager';
import type { ClubMembership } from '../core/ClubMembership';
import type { MercenaryRoster } from '../core/MercenaryRoster';
import type { AchievementManager, AchievementId } from '../core/AchievementManager';
import type { GameMap } from '../map/GameMap';
import type { InteriorFigure } from '../core/InteriorFigure';
import {
  CLUB_STATIONS,
  CLUB_DANCE_FLOOR,
  CLUB_DJ_TILE,
  CLUB_DANCER_TILES,
  CLUB_INTERIOR_W,
  type ClubStation,
  type ClubStationId,
} from '../core/clubLayout';
import { CLUB_PROPS, propSortY } from '../core/clubProps';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import type { Conversation } from '../dialog/Conversation';
import type { ConversationHandle } from '../dialog/request';
import type { DialogLine, NonEmpty } from '../dialog/line';
import { CLARABELLE } from '../dialog/scripts/scenes/clarabelle';
import { CLUB_ANIM_FRAMES_PER_SECOND, drawClubNpc } from '../sprites/clubNpcSprite';
import { drawClubCastFigure, type ClubFigureRef } from '../sprites/clubCastFigure';
import {
  CLUB_BARTENDER,
  clubDancerAt,
  type ClubDancer,
  CLUB_MARKET_VENDOR,
  CLUB_VIP_HOST,
} from '../sprites/clubCastRoster';
import { drawCasinoDealer } from '../sprites/casinoDealerSprite';
import { drawCrocodilianSprite, prewarmClarabelle } from '../sprites/crocodilianSprite';
import { drawCretinSprite, prewarmCretin, type CretinVariant } from '../sprites/cretinSprite';
import { CRETIN_WALK_FRAMES, CRETIN_WALK_TILES_PER_CYCLE } from '../sprites/cretinTiming';
import { CatPlayer } from '../creatures/CatPlayer';
import { drawClubProp } from '../sprites/clubFurnitureSprite';
import { drawClubDecor } from '../sprites/clubDecor';
import { ShopSystem, type ShopConfig } from './ShopSystem';
import { CLUB_BAR_PRICING, CLUB_MARKET_PRICING } from './market/shopProfiles';
import { ClubCasinoSystem } from './ClubCasinoSystem';
import { MercenaryGuildSystem } from './MercenaryGuildSystem';
import { ClubVipLoungeSystem, type EscortPair } from './ClubVipLoungeSystem';
import { ClubCrowdSystem, tileBody, playerBody, type CrowdBody } from './ClubCrowdSystem';
import type { MarketStock } from './market/MarketStock';

/** Keys the club market's stock lines the same way the overworld stalls key theirs. */
export const DESPERADO_MARKET_VENDOR_ID = 'desperado_market';

const STATION_INTERACT_RANGE = 2.6;
/**
 * `animTime` counts frames, but the dealer sprite times its motion in real
 * milliseconds so the two renderings of Deuce move at the same speed.
 */
const MS_PER_SECOND = 1000;
const MS_PER_FRAME = MS_PER_SECOND / CLUB_ANIM_FRAMES_PER_SECOND;
const TILE_HALF = 0.5;

// VIP bodyguard escort: two Cretins that trail the player around the club (cosmetic — the club is a safe zone).
const ESCORT_FOLLOW_LERP = 0.12;
const ESCORT_OFFSET_X_TILES = 0.9;
const ESCORT_OFFSET_Y_TILES = 0.7;
const ESCORT_OFFSET_X = TILE_SIZE * ESCORT_OFFSET_X_TILES;
const ESCORT_OFFSET_Y = TILE_SIZE * ESCORT_OFFSET_Y_TILES;

interface EscortFollower {
  variant: CretinVariant;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  /** The heading of its last step, held while it stands so it stops facing where it was going. */
  facingX: number;
  facingY: number;
  /** Gait angle in radians, advanced by ground covered so the planted foot never skates. */
  walkPhase: number;
  walking: boolean;
}

/** Below this per-frame travel an escort counts as standing still, not walking. */
const ESCORT_WALK_EPSILON = 0.12;

/** An escort that has not moved yet faces the room, like the rest of the club's staff. */
const ESCORT_REST_FACING_X = 0;
const ESCORT_REST_FACING_Y = 1;

const FULL_TURN_RADIANS = Math.PI * 2;
/** Gait radians per world pixel covered: one full cycle over the ground the Cretin's stride carries it. */
const ESCORT_WALK_RADIANS_PER_PIXEL = FULL_TURN_RADIANS / (CRETIN_WALK_TILES_PER_CYCLE * TILE_SIZE);
/** One sheet frame a tick: any faster and the walk row is undersampled into a vibration. */
const ESCORT_MAX_WALK_RADIANS_PER_TICK = FULL_TURN_RADIANS / CRETIN_WALK_FRAMES;

// Dance-floor light overlay
const DANCE_LIGHT_COLORS = ['#ff2d78', '#2d9bff', '#a94dff', '#4dffb0', '#ffd23d'];
const DANCE_LIGHT_PERIOD_MS = 900;
const DANCE_LIGHT_TILE_PHASE_X = 0.7;
const DANCE_LIGHT_TILE_PHASE_Y = 1.3;
const DANCE_LIGHT_ALPHA_BASE = 0.16;
const DANCE_LIGHT_ALPHA_SWING = 0.22;
const DANCE_LIGHT_CENTER_FRACTION = 0.5;
const DANCE_LIGHT_RADIUS_FRACTION = 0.62;

/**
 * She stands facing the south door, so the crawlers walking in see her face
 * rather than her profile.
 */
const CLARABELLE_FACING_X = 0;
const CLARABELLE_FACING_Y = 1;

/** An escort Cretin taking up its flank `offsetX` behind the crawler it shadows. */
function escortFollower(variant: CretinVariant, offsetX: number, active: Player): EscortFollower {
  return {
    variant,
    offsetX,
    offsetY: ESCORT_OFFSET_Y,
    x: active.x + offsetX,
    y: active.y + ESCORT_OFFSET_Y,
    facingX: ESCORT_REST_FACING_X,
    facingY: ESCORT_REST_FACING_Y,
    walkPhase: 0,
    walking: false,
  };
}

/** Warms both escort Cretins when their walk-on is booked, not when they first draw. */
function prewarmEscort(pair: EscortPair): void {
  for (const variant of pair.variants) prewarmCretin(variant);
}

// Bar drinks — the club's buff consumables, priced as premium members' pours.
/** The house special leads the board, because that is what a house special is. */
const DIRTY_SHIRLEY_PRICE = 15;
const SPEED_FIZZ_PRICE = 20;
const COOLDOWN_CRISP_PRICE = 25;
const JUGG_JUICE_PRICE = 30;

/** Keys the bar's stock lines the same way the market stall/club counter keys theirs. */
export const DESPERADO_BAR_VENDOR_ID = 'desperado_bar';

const BAR_SHOP_CONFIG: ShopConfig = {
  title: 'The Bar',
  pricing: CLUB_BAR_PRICING,
  items: [
    {
      id: 'dirty_shirley',
      label: 'The Dirty Shirley',
      price: DIRTY_SHIRLEY_PRICE,
      desc: 'The house special. Ask for it dirty',
    },
    {
      id: 'speed_fizz',
      label: 'Speed Fizz',
      price: SPEED_FIZZ_PRICE,
      desc: 'Double move speed, 25s',
    },
    {
      id: 'cooldown_crisp',
      label: 'Cooldown Crisp',
      price: COOLDOWN_CRISP_PRICE,
      desc: 'Halve ability cooldowns, 25s',
    },
    {
      id: 'jugg_juice',
      label: 'Jugg Juice',
      price: JUGG_JUICE_PRICE,
      desc: '+50% max HP & full heal, 30s',
    },
  ],
};

// Market gear — club-exclusive equipment otherwise only won off dangerous foes.
export const STAT_BOOST_PRICE = 1000;
/** Never restocks: one permanent stat roll per run is what keeps it worth the price. */
export const STAT_BOOST_STOCK = 1;
const TROLLSKIN_SHIRT_PRICE = 120;
const SEPSIS_CROWN_PRICE = 150;

export const MARKET_SHOP_CONFIG: ShopConfig = {
  title: 'The Market',
  pricing: CLUB_MARKET_PRICING,
  items: [
    {
      id: 'stat_boost_potion',
      label: 'Stat Boost',
      price: STAT_BOOST_PRICE,
      desc: '+2-4 to a random stat, permanent',
      stock: STAT_BOOST_STOCK,
    },
    {
      id: 'trollskin_shirt',
      label: 'Trollskin Shirt',
      price: TROLLSKIN_SHIRT_PRICE,
      desc: '+3 CON, 2.5x regen, negates melee debuffs',
    },
    {
      id: 'enchanted_crown_sepsis_whore',
      label: 'Crown of the Sepsis Whore',
      price: SEPSIS_CROWN_PRICE,
      desc: '+5 INT, attacks can inflict Sepsis',
    },
  ],
};

/**
 * The one place the club's market shop is built, so a gate that wants to
 * assert on the Stat Boost row's real price and stock exercises the same
 * `ShopItem` list and the same `MarketStock` wiring the club actually plays
 * with, rather than a copy that could drift from it unnoticed.
 */
export function createClubMarketShop(marketStock: MarketStock): ShopSystem {
  return new ShopSystem(CLUB_INTERIOR_W, MARKET_SHOP_CONFIG, {
    stock: marketStock,
    vendorId: DESPERADO_MARKET_VENDOR_ID,
  });
}

/** Which cast figure each station's staff draws as; the casino and the door have their own renderers. */
const STATION_FIGURE: Readonly<
  Record<Exclude<ClubStationId, 'casino' | 'clarabelle' | 'mercenary'>, ClubFigureRef>
> = {
  bar: CLUB_BARTENDER,
  market: CLUB_MARKET_VENDOR,
  vip: CLUB_VIP_HOST,
};

/** Proximity-prompt verb for a station: "Talk" to Clarabelle, "Shop" at the vendors, "Play" at the casino, else the room name. */
function promptLabel(station: ClubStation): string {
  if (station.id === 'clarabelle') return 'Talk';
  if (station.id === 'bar' || station.id === 'market') return 'Shop';
  if (station.id === 'casino') return 'Play Blackjack';
  if (station.id === 'mercenary') return 'Hire';
  return 'Enter';
}

/**
 * Host system for the Desperado Club interior (the analog of SafeRoomSystem /
 * ShopSystem): Clarabelle's greeting + membership gate, the floor dressing and
 * dance-floor lights, the furniture and staff that join the interior's Y-sorted
 * pass, the wandering crowd, and proximity prompts for every station. The
 * bar/market shops, the casino, the mercenary guild and the VIP lounge attach
 * to it.
 *
 * Deliberately not a `GameSystem`: its update needs the crawlers' positions to
 * push the crowd around, which the generic per-frame `SystemContext` contract
 * doesn't carry. `BuildingInteriorScene` owns and drives it directly.
 */
export class DesperadoClubSystem {
  /** The handle Clarabelle's open conversation was returned, if any. */
  private conversationHandle: ConversationHandle | null = null;
  private animTime = 0;

  private readonly barShop: ShopSystem;
  private readonly marketShop: ShopSystem;
  private readonly casino: ClubCasinoSystem;
  private readonly guild: MercenaryGuildSystem;
  private readonly vip: ClubVipLoungeSystem;

  /** Escort Cretins trailing the player once hired from the VIP Lounge; lazily positioned on first update. */
  private escortFollowers: [EscortFollower, EscortFollower] | null = null;

  private readonly crowd: ClubCrowdSystem;

  /**
   * Rebuilt each frame: the figures a patron must not walk into. Held as a field
   * so a floor full of people costs no per-frame allocation.
   */
  private readonly crowdObstacles: CrowdBody[] = [];

  /** The club's standing cast — furniture and staff — neither of which ever moves. */
  private readonly fixtureFigures: ReadonlyArray<InteriorFigure> = this.buildFixtureFigures();
  /** Refilled each frame from the fixtures plus whoever is walking around. */
  private readonly sortedFigures: InteriorFigure[] = [];
  /** Built with the escort itself; empty until the VIP lounge hires one. */
  private escortFigureList: ReadonlyArray<InteriorFigure> = [];

  /** Passed straight through from the casino's own `onWinnings` — see there for the flight's origin and timing. */
  onCasinoWinnings: ((coins: number, screenX: number, screenY: number) => void) | null = null;

  constructor(
    map: GameMap,
    private readonly membership: ClubMembership,
    roster: MercenaryRoster,
    private readonly conversation: Conversation,
    private readonly audio: AudioManager | null,
    hasPassTattoo: boolean,
    arrivingCrawler: Player,
    marketStock: MarketStock,
    private readonly humanAchievements?: AchievementManager,
    private readonly catAchievements?: AchievementManager,
  ) {
    this.crowd = new ClubCrowdSystem(map);
    this.barShop = new ShopSystem(CLUB_INTERIOR_W, BAR_SHOP_CONFIG, {
      stock: marketStock,
      vendorId: DESPERADO_BAR_VENDOR_ID,
    });
    this.marketShop = createClubMarketShop(marketStock);
    this.casino = new ClubCasinoSystem(audio, membership);
    this.casino.onWinnings = (coins, screenX, screenY) =>
      this.onCasinoWinnings?.(coins, screenX, screenY);
    this.guild = new MercenaryGuildSystem(roster, audio);
    this.vip = new ClubVipLoungeSystem(audio, roster);
    prewarmClarabelle();
    if (membership.hasDesperadoPass) {
      this.unlockAchievement('desperado_member');
    } else if (hasPassTattoo) {
      // The tattoo is the pass; the door only has to read it, so membership is
      // granted here rather than waiting on the dialog the way the giveaway does.
      membership.hasDesperadoPass = true;
      this.openTattooGreeting(arrivingCrawler);
    } else {
      this.openGreeting(arrivingCrawler);
    }
  }

  /** Unlock a club achievement for both crawlers (idempotent), mirroring the doomsday-containment pattern. */
  private unlockAchievement(id: AchievementId): void {
    this.humanAchievements?.tryUnlock(id);
    this.catAchievements?.tryUnlock(id);
  }

  /** Coins staked at the casino since entering the club — the free-security perk hook. */
  get coinsWageredThisVisit(): number {
    return this.casino.coinsWageredThisVisit;
  }

  /** Whether the shared conversation is currently showing one of Clarabelle's lines, rather than someone else's. */
  private get conversationOwned(): boolean {
    return this.conversationHandle !== null && this.conversation.isActive(this.conversationHandle);
  }

  /** The bar/market shop whose buy panel is currently open, if any. */
  private activeShop(): ShopSystem | null {
    if (this.barShop.shopOpen) return this.barShop;
    if (this.marketShop.shopOpen) return this.marketShop;
    return null;
  }

  /**
   * The keyboard focus context of whichever station is on screen — the promise
   * the interior's overlay claim makes on the club's behalf.
   *
   * Mirrors `renderUI`'s order exactly, because that early-return chain decides
   * which of the five stations actually draws, and only the one that draws
   * declares a ring.
   */
  get focusContext(): string | null {
    if (this.activeShop() !== null) return 'shop';
    if (this.casino.open) return 'casino';
    if (this.guild.open) return 'club-guild';
    if (this.vip.open) return 'club-vip';
    if (this.conversationOwned) return 'quest-dialog';
    return null;
  }

  /** The bar/market buy panel on screen, exposed so the scene can feed it scroll gestures. */
  get openShop(): ShopSystem | null {
    return this.activeShop();
  }

  get modalOpen(): boolean {
    return (
      this.conversationOwned ||
      this.activeShop() !== null ||
      this.casino.open ||
      this.guild.open ||
      this.vip.open
    );
  }

  update(active: Player, companion: Player | null): void {
    this.animTime++;
    this.guild.updateDesk();
    this.updateEscort(active);
    this.crowd.update(this.staticCrowdBodies(active, companion));
    this.barShop.update();
    this.marketShop.update();
    // Only the coin-pool total this drives matters, and the casino is never open
    // while this update runs — an open table routes through `tickOpenModals`
    // instead — so a missing companion here falls back to the active crawler alone.
    this.casino.update(active, companion ?? active);
    if (this.barShop.purchasePending || this.marketShop.purchasePending) {
      // A round at the bar pours; gear off the market rack does not.
      if (this.barShop.purchasePending) this.audio?.play('ambient_pouring_a_drink');
      this.barShop.purchasePending = false;
      this.marketShop.purchasePending = false;
      this.audio?.play('purchase_success');
    }
    // Sub-panels freeze this update() while open, so pending achievement flags set
    // during a hire/win/hire-escort are consumed here once the panel closes.
    this.consumePendingUnlocks();
  }

  /**
   * Drive the sub-panels that keep running while they are open. The club's
   * `update` is gated behind `modalOpen` by the interior scene, so anything with
   * its own clock — the casino's dealing and dealer beats — has to be pumped
   * from here instead.
   */
  tickOpenModals(active: Player, companion: Player): void {
    this.animTime++;
    this.guild.updateDesk();
    this.casino.update(active, companion);
    // A natural can settle while the panel is still open, and that panel can be
    // the last thing the player touches before leaving — so the flags are
    // drained here too, or the achievement is lost with the system.
    this.consumePendingUnlocks();
  }

  /** Drain every sub-panel's "something unlockable happened" flag. */
  private consumePendingUnlocks(): void {
    if (this.guild.hirePending) {
      this.guild.hirePending = false;
      this.unlockAchievement('merc_hired');
    }
    if (this.casino.jackpotPending) {
      this.casino.jackpotPending = false;
      this.unlockAchievement('casino_jackpot');
    }
    if (this.vip.escortPending) {
      this.vip.escortPending = false;
      this.unlockAchievement('club_bodyguards');
    }
  }

  /**
   * The immovable figures on the floor this frame: every station NPC, the DJ,
   * the dancers, the crawlers, and any hired escort. Patrons are pushed clear of
   * all of them, which is what stops the crowd wading through the bouncer.
   */
  private staticCrowdBodies(active: Player, companion: Player | null): ReadonlyArray<CrowdBody> {
    this.crowdObstacles.length = 0;
    for (const station of CLUB_STATIONS) this.crowdObstacles.push(tileBody(station.tile));
    this.crowdObstacles.push(tileBody(CLUB_DJ_TILE));
    for (const dancer of CLUB_DANCER_TILES) this.crowdObstacles.push(tileBody(dancer));
    this.crowdObstacles.push(playerBody(active));
    if (companion !== null) this.crowdObstacles.push(playerBody(companion));
    for (const follower of this.escortFollowers ?? []) {
      this.crowdObstacles.push(playerBody(follower));
    }
    return this.crowdObstacles;
  }

  /**
   * Opens a Clarabelle beat on the shared conversation. `onClosed` fires once
   * the last page is read through to its own advance — never from Esc or a
   * walk-away, which close the box via `onDismissed` instead and grant
   * nothing. None of her beats hold a stake the way the blackjack table does,
   * so every one of them can be walked away from.
   */
  private openConversation(lines: NonEmpty<DialogLine>, onClosed: () => void): void {
    this.conversationHandle = this.conversation.open({
      lines,
      reward: null,
      questRelated: false,
      ending: {
        kind: 'close',
        onClosed,
      },
      dismiss: {
        kind: 'allowed',
        onDismissed: () => undefined,
      },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    });
  }

  /** Grants the Desperado Pass once the greeting is taken to its final page. */
  private openGreeting(crawler: Player): void {
    this.openConversation(CLARABELLE.greeting(crawler instanceof CatPlayer), () => {
      if (this.membership.hasDesperadoPass) return;
      this.membership.hasDesperadoPass = true;
      this.unlockAchievement('desperado_member');
      this.audio?.play('achievement_awarded');
    });
  }

  /** Clarabelle waving through a crawler wearing the Juicer's ink. */
  private openTattooGreeting(crawler: Player): void {
    this.openConversation(CLARABELLE.tattooGreeting(crawler instanceof CatPlayer), () => {
      this.unlockAchievement('desperado_member');
      this.audio?.play('achievement_awarded');
    });
  }

  private openWelcomeBack(crawler: Player): void {
    this.openConversation(CLARABELLE.welcomeBack(crawler instanceof CatPlayer), () => undefined);
  }

  /** Close the open shop panel, or advance the open sub-panel/dialog. */
  dismissModal(player: Player): void {
    const shop = this.activeShop();
    if (shop) {
      shop.shopOpen = false;
      return;
    }
    if (this.casino.open) {
      // The rules overlay sits above the table, so Esc backs out of it first
      // rather than closing the table underneath it.
      if (this.casino.rulesOpen) this.casino.dismissRules();
      else this.casino.close(player);
      return;
    }
    if (this.guild.open) {
      this.guild.close();
      return;
    }
    if (this.vip.open) {
      this.vip.close();
      return;
    }
    if (this.conversationOwned) this.conversation.advance();
  }

  private isNear(tile: { x: number; y: number }, player: Player): boolean {
    const stationPx = (tile.x + TILE_HALF) * TILE_SIZE;
    const stationPy = (tile.y + TILE_HALF) * TILE_SIZE;
    const px = player.x + TILE_SIZE * TILE_HALF;
    const py = player.y + TILE_SIZE * TILE_HALF;
    return Math.hypot(px - stationPx, py - stationPy) < TILE_SIZE * STATION_INTERACT_RANGE;
  }

  private nearestStation(player: Player): ClubStation | null {
    for (const station of CLUB_STATIONS) {
      if (this.isNear(station.tile, player)) return station;
    }
    return null;
  }

  /**
   * Space/tap interaction: dismiss a modal, or open the station the player
   * stands beside. Returns whether the press was consumed, so a press with no
   * station in range can still fall through to whoever else is standing there.
   */
  handleInteract(player: Player, companion: Player): boolean {
    if (this.conversationOwned) {
      this.conversation.advance();
      return true;
    }
    const station = this.nearestStation(player);
    if (!station) return false;
    if (station.id === 'clarabelle') {
      if (this.membership.hasDesperadoPass) {
        this.openWelcomeBack(player);
      } else {
        this.openGreeting(player);
      }
      return true;
    }
    if (station.id === 'bar') {
      this.barShop.shopOpen = true;
      return true;
    }
    if (station.id === 'market') {
      this.marketShop.shopOpen = true;
      return true;
    }
    if (station.id === 'casino') {
      this.casino.openTable(player, companion);
      return true;
    }
    if (station.id === 'mercenary') {
      this.guild.openPanel();
      return true;
    }
    this.vip.openPanel(this.coinsWageredThisVisit);
    prewarmEscort(this.vip.escortPair);
    return true;
  }

  /** Route clicks to an open shop panel's buy buttons, else advance the modal; returns true when a modal/shop was open. */
  handleClick(mx: number, my: number, active: Player, companion: Player): boolean {
    const shop = this.activeShop();
    if (shop) {
      shop.handleClick(mx, my);
      return true;
    }
    if (this.casino.open) {
      this.casino.handleClick(mx, my, active, companion);
      return true;
    }
    if (this.guild.open) {
      this.guild.handleClick(mx, my, active, companion);
      return true;
    }
    if (this.vip.open) {
      this.vip.handleClick(mx, my, active, companion);
      return true;
    }
    if (!this.conversationOwned) return false;
    this.conversation.handleClick(mx, my);
    return true;
  }

  /**
   * Escape. Deliberately not `dismissModal`, whose tail advances an open
   * conversation the way Space does: Escape backs out of it instead, through
   * `Conversation.dismiss()`, which grants nothing for a beat still mid-read.
   */
  closeModals(player: Player): void {
    const shop = this.activeShop();
    if (shop) {
      shop.shopOpen = false;
      return;
    }
    if (this.casino.open) {
      if (this.casino.rulesOpen) this.casino.dismissRules();
      else this.casino.close(player);
      return;
    }
    if (this.guild.open) {
      this.guild.close();
      return;
    }
    if (this.vip.open) {
      this.vip.close();
      return;
    }
    if (this.conversationOwned) this.conversation.dismiss();
  }

  /**
   * Shut every sub-panel outright, for the scene being torn down under an open
   * modal. Deliberately *not* `dismissModal` or `closeModals`, which both
   * return after closing the first thing they find open: a teardown has to
   * close every sub-panel at once regardless of which happens to sit on top,
   * and the rules overlay is one level under the blackjack table it sits on.
   */
  closeAll(player: Player): void {
    const shop = this.activeShop();
    if (shop) shop.shopOpen = false;
    if (this.casino.open) this.casino.close(player);
    this.guild.close();
    this.vip.close();
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
   * the DJ and dancers, the crowd, and any hired escort.
   *
   * Each entry reports the `y` the interior's pass sorts on — for furniture that
   * is the top of its footprint row, so a counter sorts exactly like a figure
   * standing on the same tile.
   */
  sortedRenderables(): ReadonlyArray<InteriorFigure> {
    this.sortedFigures.length = 0;
    this.sortedFigures.push(...this.fixtureFigures);
    this.sortedFigures.push(...this.crowd.renderables());
    this.sortedFigures.push(...this.escortFigures());
    return this.sortedFigures;
  }

  /**
   * The furniture and the staff, built once: neither ever moves, so the only
   * thing a per-frame rebuild would recompute is the animation phase, which the
   * render closures read live off `animTime`.
   */
  private buildFixtureFigures(): ReadonlyArray<InteriorFigure> {
    const figures: InteriorFigure[] = CLUB_PROPS.map((prop) => ({
      y: propSortY(prop),
      render: (ctx: CanvasRenderingContext2D, camX: number, camY: number) =>
        drawClubProp(ctx, prop, camX, camY),
    }));

    CLUB_DANCER_TILES.forEach((tile, i) => figures.push(this.dancerFigure(tile, clubDancerAt(i))));
    figures.push(this.djFigure(CLUB_DJ_TILE));
    for (const station of CLUB_STATIONS) {
      if (station.id === 'casino') {
        figures.push(this.dealerFigure(station.tile));
        continue;
      }
      if (station.id === 'clarabelle') {
        figures.push(this.clarabelleFigure(station.tile));
        continue;
      }
      if (station.id === 'mercenary') {
        // Read through `this.guild` at draw time: this list is built by a field
        // initializer, before the constructor has made the guild.
        figures.push({
          y: station.tile.y * TILE_SIZE,
          render: (ctx, camX, camY, tileSize) => this.guild.renderDesk(ctx, camX, camY, tileSize),
        });
        continue;
      }
      figures.push(
        this.castFigure(station.tile, STATION_FIGURE[station.id], 'idle', 1, station.tile.x),
      );
    }
    return figures;
  }

  /**
   * A figure standing still on `tile`, drawn from the skyfowl or human closed
   * cast. `seed` staggers the animation loop so a room of NPCs doesn't breathe
   * in lockstep.
   */
  private castFigure(
    tile: { x: number; y: number },
    ref: ClubFigureRef,
    action: 'idle',
    facingX: number,
    seed: number,
  ): InteriorFigure {
    return {
      y: tile.y * TILE_SIZE,
      render: (ctx, camX, camY, tileSize) =>
        drawClubCastFigure(
          ctx,
          ref,
          tile.x * TILE_SIZE - camX,
          tile.y * TILE_SIZE - camY,
          tileSize,
          {
            action,
            walkPhase: 0,
            facingX,
            facingY: 1,
            loopOffsetSeconds: seed / CLUB_ANIM_FRAMES_PER_SECOND,
          },
        ),
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

  /** Doctor Bones, at his decks. Not part of the closed-set casts — his own fixed painter. */
  private djFigure(tile: { x: number; y: number }): InteriorFigure {
    return {
      y: tile.y * TILE_SIZE,
      render: (ctx, camX, camY, tileSize) =>
        drawClubNpc(
          ctx,
          tile.x * TILE_SIZE - camX,
          tile.y * TILE_SIZE - camY,
          tileSize,
          this.animTime,
        ),
    };
  }

  /**
   * Deuce behind the blackjack table. Sweeps a hand across the felt while the
   * table is open and rests otherwise, so the figure in the room tracks what the
   * panel is doing.
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
          this.casino.open,
        ),
    };
  }

  /**
   * Clarabelle at the door. She talks with her palm out for as long as her
   * dialog is up — the only dialog the club's own box ever shows is hers — and
   * stands with her arms crossed otherwise.
   */
  private clarabelleFigure(tile: { x: number; y: number }): InteriorFigure {
    return {
      y: tile.y * TILE_SIZE,
      render: (ctx, camX, camY, tileSize) =>
        drawCrocodilianSprite(ctx, tile.x * TILE_SIZE - camX, tile.y * TILE_SIZE - camY, tileSize, {
          variant: 'clarabelle',
          row: this.conversationOwned ? 'talk' : 'idle',
          facingX: CLARABELLE_FACING_X,
          facingY: CLARABELLE_FACING_Y,
          elapsedSeconds: this.animTime / CLUB_ANIM_FRAMES_PER_SECOND,
        }),
    };
  }

  renderObjects(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    this.guild.renderDeskOverlay(ctx, camX, camY);
    if (this.modalOpen) return;
    const station = this.nearestStation(active);
    if (station) {
      const sx = station.tile.x * TILE_SIZE - camX;
      const sy = station.tile.y * TILE_SIZE - camY;
      drawInteractionPrompt(ctx, sx, sy, TILE_SIZE, promptLabel(station));
    }
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

  /**
   * Once the VIP escort is hired, two Cretins ease toward flanking offsets
   * behind the player. The pair is re-read every tick: hiring Sledge or Bomo at
   * the desk mid-visit hands the escort to the relief pair on the spot.
   */
  private updateEscort(active: Player): void {
    if (!this.vip.escortActive) return;
    const pair = this.vip.escortPair;
    const [leftVariant, rightVariant] = pair.variants;
    if (this.escortFollowers === null) {
      prewarmEscort(pair);
      this.escortFollowers = [
        escortFollower(leftVariant, -ESCORT_OFFSET_X, active),
        escortFollower(rightVariant, ESCORT_OFFSET_X, active),
      ];
      this.escortFigureList = this.escortFollowers.map((follower) => ({
        y: follower.y,
        render: (ctx, camX, camY, tileSize) =>
          drawCretinSprite(ctx, follower.x - camX, follower.y - camY, tileSize, {
            variant: follower.variant,
            row: follower.walking ? 'walk' : 'idle',
            facingX: follower.facingX,
            facingY: follower.facingY,
            walkPhase: follower.walkPhase,
            ticks: this.animTime,
          }),
      }));
    }
    const [leftFollower, rightFollower] = this.escortFollowers;
    if (leftFollower.variant !== leftVariant || rightFollower.variant !== rightVariant) {
      prewarmEscort(pair);
      leftFollower.variant = leftVariant;
      rightFollower.variant = rightVariant;
    }
    this.escortFollowers.forEach((follower, i) => {
      const targetX = active.x + follower.offsetX;
      const targetY = active.y + follower.offsetY;
      const stepX = (targetX - follower.x) * ESCORT_FOLLOW_LERP;
      const stepY = (targetY - follower.y) * ESCORT_FOLLOW_LERP;
      follower.x += stepX;
      follower.y += stepY;
      const stepLength = Math.hypot(stepX, stepY);
      follower.walking = stepLength > ESCORT_WALK_EPSILON;
      if (follower.walking) {
        follower.facingX = stepX;
        follower.facingY = stepY;
        const gaitAdvance = Math.min(
          stepLength * ESCORT_WALK_RADIANS_PER_PIXEL,
          ESCORT_MAX_WALK_RADIANS_PER_TICK,
        );
        follower.walkPhase = (follower.walkPhase + gaitAdvance) % FULL_TURN_RADIANS;
      }
      this.escortFigureList[i].y = follower.y;
    });
  }

  private escortFigures(): ReadonlyArray<InteriorFigure> {
    return this.vip.escortActive ? this.escortFigureList : [];
  }

  renderUI(ctx: CanvasRenderingContext2D, active: Player, companion: Player): void {
    const shop = this.activeShop();
    if (shop) {
      shop.renderUI(ctx, active);
      shop.renderShopPanel(ctx, active, companion);
      return;
    }

    if (this.casino.open) {
      this.casino.renderPanel(ctx, active, companion);
      return;
    }

    if (this.guild.open) {
      this.guild.renderPanel(ctx, active, companion);
      return;
    }

    if (this.vip.open) {
      this.vip.renderPanel(ctx, active, companion);
    }
    // Clarabelle's own lines draw through the scene's shared conversation panel.
  }
}
