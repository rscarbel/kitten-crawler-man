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
import { QuestDialog } from '../ui/QuestDialog';
import { drawClubNpc, type ClubNpcVariant } from '../sprites/clubNpcSprite';
import { drawCasinoDealer } from '../sprites/casinoDealerSprite';
import { drawClubProp } from '../sprites/clubFurnitureSprite';
import { drawClubDecor } from '../sprites/clubDecor';
import { ShopSystem, type ShopConfig } from './ShopSystem';
import { ClubCasinoSystem } from './ClubCasinoSystem';
import { MercenaryGuildSystem } from './MercenaryGuildSystem';
import { ClubVipLoungeSystem } from './ClubVipLoungeSystem';
import { ClubCrowdSystem, tileBody, playerBody, type CrowdBody } from './ClubCrowdSystem';

const STATION_INTERACT_RANGE = 2.6;
/**
 * `animTime` counts frames, but the dealer sprite times its motion in real
 * milliseconds so the two renderings of Deuce move at the same speed.
 */
const MS_PER_SECOND = 1000;
const FRAMES_PER_SECOND = 60;
const MS_PER_FRAME = MS_PER_SECOND / FRAMES_PER_SECOND;
const TILE_HALF = 0.5;

// VIP bodyguard escort: two Cretins that trail the player around the club (cosmetic — the club is a safe zone).
const ESCORT_FOLLOW_LERP = 0.12;
const ESCORT_OFFSET_X_TILES = 0.9;
const ESCORT_OFFSET_Y_TILES = 0.7;
const ESCORT_OFFSET_X = TILE_SIZE * ESCORT_OFFSET_X_TILES;
const ESCORT_OFFSET_Y = TILE_SIZE * ESCORT_OFFSET_Y_TILES;

interface EscortFollower {
  variant: ClubNpcVariant;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
}

/** Below this per-frame travel an escort counts as standing still, not walking. */
const ESCORT_WALK_EPSILON = 0.12;

// Dance-floor light overlay
const DANCE_LIGHT_COLORS = ['#ff2d78', '#2d9bff', '#a94dff', '#4dffb0', '#ffd23d'];
const DANCE_LIGHT_PERIOD_MS = 900;
const DANCE_LIGHT_TILE_PHASE_X = 0.7;
const DANCE_LIGHT_TILE_PHASE_Y = 1.3;
const DANCE_LIGHT_ALPHA_BASE = 0.16;
const DANCE_LIGHT_ALPHA_SWING = 0.22;
const DANCE_LIGHT_CENTER_FRACTION = 0.5;
const DANCE_LIGHT_RADIUS_FRACTION = 0.62;

/** The Sledge's welcome + house rules, shown once and granting the Desperado Pass on dismiss. */
const GREETING_LINES: ReadonlyArray<string> = [
  'A seven-foot slab of tuxedoed granite steps into your path.',
  '"Welcome to the Desperado Club. Name\'s Sledge. Two house rules:"',
  '"No fighting inside — the club is neutral ground, always."',
  '"First membership\'s on the house. Take the Pass. Spend well."',
];

const GREETING_TITLE = '🔪  The Desperado Club  🔪';
const SLEDGE_WELCOME = '"Back again? Good. Enjoy yourself — and mind the rules."';

// Bar drinks — the club's buff consumables, priced as premium members' pours.
/** The house special leads the board, because that is what a house special is. */
const DIRTY_SHIRLEY_PRICE = 15;
const SPEED_FIZZ_PRICE = 20;
const COOLDOWN_CRISP_PRICE = 25;
const JUGG_JUICE_PRICE = 30;

const BAR_SHOP_CONFIG: ShopConfig = {
  title: 'The Bar',
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
const STAT_BOOST_PRICE = 80;
const TROLLSKIN_SHIRT_PRICE = 120;
const SEPSIS_CROWN_PRICE = 150;

const MARKET_SHOP_CONFIG: ShopConfig = {
  title: 'The Market',
  items: [
    {
      id: 'stat_boost_potion',
      label: 'Stat Boost',
      price: STAT_BOOST_PRICE,
      desc: '+2-4 to a random stat, permanent',
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

/** Which shared club-NPC sprite each station uses; the casino has its own renderer. */
const STATION_VARIANT: Record<Exclude<ClubStationId, 'casino'>, ClubNpcVariant> = {
  sledge: 'sledge',
  bar: 'bartender',
  market: 'merchant',
  mercenary: 'rosemarie',
  vip: 'vip',
};

/** Proximity-prompt verb for a station: "Talk" to the Sledge, "Shop" at the vendors, "Play" at the casino, else the room name. */
function promptLabel(station: ClubStation): string {
  if (station.id === 'sledge') return 'Talk';
  if (station.id === 'bar' || station.id === 'market') return 'Shop';
  if (station.id === 'casino') return 'Play Blackjack';
  if (station.id === 'mercenary') return 'Hire';
  return 'Enter';
}

/**
 * Host system for the Desperado Club interior (the analog of SafeRoomSystem /
 * ShopSystem): the Sledge's greeting + membership gate, the floor dressing and
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
  private readonly dialog: QuestDialog;
  private animTime = 0;

  private readonly barShop: ShopSystem;
  private readonly marketShop: ShopSystem;
  private readonly casino: ClubCasinoSystem;
  private readonly guild: MercenaryGuildSystem;
  private readonly vip: ClubVipLoungeSystem;

  /** Escort Cretins trailing the player once hired from the VIP Lounge; lazily positioned on first update. */
  private escortFollowers: EscortFollower[] | null = null;
  /** Per-escort travel last frame, so a stationary bodyguard doesn't play a walk cycle. */
  private readonly escortWalking: boolean[] = [false, false];

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

  constructor(
    map: GameMap,
    private readonly membership: ClubMembership,
    roster: MercenaryRoster,
    private readonly audio: AudioManager | null,
    private readonly humanAchievements?: AchievementManager,
    private readonly catAchievements?: AchievementManager,
  ) {
    this.dialog = new QuestDialog(audio);
    this.crowd = new ClubCrowdSystem(map);
    this.barShop = new ShopSystem(CLUB_INTERIOR_W, BAR_SHOP_CONFIG);
    this.marketShop = new ShopSystem(CLUB_INTERIOR_W, MARKET_SHOP_CONFIG);
    this.casino = new ClubCasinoSystem(audio, membership);
    this.guild = new MercenaryGuildSystem(roster, audio);
    this.vip = new ClubVipLoungeSystem(audio);
    if (membership.hasDesperadoPass) {
      this.unlockAchievement('desperado_member');
    } else {
      this.openGreeting();
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
    if (this.dialog.isOpen) return 'quest-dialog';
    return null;
  }

  get modalOpen(): boolean {
    return (
      this.dialog.isOpen ||
      this.activeShop() !== null ||
      this.casino.open ||
      this.guild.open ||
      this.vip.open
    );
  }

  update(active: Player, companion: Player | null): void {
    this.animTime++;
    this.updateEscort(active);
    this.crowd.update(this.staticCrowdBodies(active, companion));
    this.barShop.update();
    this.marketShop.update();
    this.casino.update(active);
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
  tickOpenModals(active: Player): void {
    this.animTime++;
    this.casino.update(active);
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
   * all of them, which is what stops the crowd wading through the Sledge.
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

  /** Grants the Desperado Pass once the greeting dialog is taken to its final page. */
  private openGreeting(): void {
    this.dialog.open(
      [{ title: GREETING_TITLE, lines: GREETING_LINES, button: 'Take the Pass' }],
      () => {
        if (this.membership.hasDesperadoPass) return;
        this.membership.hasDesperadoPass = true;
        this.unlockAchievement('desperado_member');
        this.audio?.play('achievement_awarded');
      },
    );
  }

  private openFlavor(title: string, line: string): void {
    this.dialog.open([{ title, lines: [line], button: 'Continue' }], () => undefined);
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
    this.dialog.advance();
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
  handleInteract(player: Player): boolean {
    if (this.dialog.isOpen) {
      this.dialog.advance();
      return true;
    }
    const station = this.nearestStation(player);
    if (!station) return false;
    if (station.id === 'sledge') {
      if (this.membership.hasDesperadoPass) this.openFlavor(station.label, SLEDGE_WELCOME);
      else this.openGreeting();
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
      this.casino.openTable(player);
      return true;
    }
    if (station.id === 'mercenary') {
      this.guild.openPanel();
      return true;
    }
    this.vip.openPanel(this.coinsWageredThisVisit);
    return true;
  }

  /** Route clicks to an open shop panel's buy buttons, else advance the modal; returns true when a modal/shop was open. */
  handleClick(mx: number, my: number, active: Player): boolean {
    const shop = this.activeShop();
    if (shop) {
      shop.handleClick(mx, my);
      return true;
    }
    if (this.casino.open) {
      this.casino.handleClick(mx, my, active);
      return true;
    }
    if (this.guild.open) {
      this.guild.handleClick(mx, my, active);
      return true;
    }
    if (this.vip.open) {
      this.vip.handleClick(mx, my, active);
      return true;
    }
    if (!this.dialog.isOpen) return false;
    this.dialog.handleClick(mx, my);
    return true;
  }

  closeModals(player: Player): void {
    this.dismissModal(player);
  }

  /**
   * Shut every sub-panel outright, for the scene being torn down under an open
   * modal. Deliberately *not* `dismissModal`, which is a one-level Esc: with the
   * rules overlay up it would close only the overlay and leave the blackjack
   * table holding the player's stake, and with the greeting up it would fall
   * through to `dialog.advance()` and award the Desperado Pass nobody accepted.
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

    CLUB_DANCER_TILES.forEach((dancer, i) => {
      figures.push(this.npcFigure(dancer, 'dancer', 0, i % 2 === 0 ? 1 : -1, i + 1));
    });
    figures.push(this.npcFigure(CLUB_DJ_TILE, 'dj', 0));
    for (const station of CLUB_STATIONS) {
      if (station.id === 'casino') {
        figures.push(this.dealerFigure(station.tile));
        continue;
      }
      figures.push(this.npcFigure(station.tile, STATION_VARIANT[station.id], station.tile.x));
    }
    return figures;
  }

  /**
   * A figure standing still on `tile`. `phaseOffset` staggers the idle animation
   * so a room of NPCs doesn't breathe in lockstep.
   */
  private npcFigure(
    tile: { x: number; y: number },
    variant: ClubNpcVariant,
    phaseOffset: number,
    facingX = 1,
    seed = 0,
  ): InteriorFigure {
    return {
      y: tile.y * TILE_SIZE,
      render: (ctx, camX, camY, tileSize) =>
        drawClubNpc(
          ctx,
          tile.x * TILE_SIZE - camX,
          tile.y * TILE_SIZE - camY,
          tileSize,
          variant,
          this.animTime + phaseOffset,
          facingX,
          seed,
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

  renderObjects(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
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

  /** Once the VIP escort is hired, two Cretins ease toward flanking offsets behind the player. */
  private updateEscort(active: Player): void {
    if (!this.vip.escortActive) return;
    if (this.escortFollowers === null) {
      this.escortFollowers = [
        {
          variant: 'sledge',
          offsetX: -ESCORT_OFFSET_X,
          offsetY: ESCORT_OFFSET_Y,
          x: active.x - ESCORT_OFFSET_X,
          y: active.y + ESCORT_OFFSET_Y,
        },
        {
          variant: 'bomo',
          offsetX: ESCORT_OFFSET_X,
          offsetY: ESCORT_OFFSET_Y,
          x: active.x + ESCORT_OFFSET_X,
          y: active.y + ESCORT_OFFSET_Y,
        },
      ];
      this.escortFigureList = this.escortFollowers.map((follower, i) => ({
        y: follower.y,
        render: (ctx, camX, camY, tileSize) =>
          drawClubNpc(
            ctx,
            follower.x - camX,
            follower.y - camY,
            tileSize,
            follower.variant,
            this.animTime,
            follower.offsetX < 0 ? -1 : 1,
            0,
            { walking: this.escortWalking[i] },
          ),
      }));
    }
    this.escortFollowers.forEach((follower, i) => {
      const targetX = active.x + follower.offsetX;
      const targetY = active.y + follower.offsetY;
      const stepX = (targetX - follower.x) * ESCORT_FOLLOW_LERP;
      const stepY = (targetY - follower.y) * ESCORT_FOLLOW_LERP;
      follower.x += stepX;
      follower.y += stepY;
      this.escortWalking[i] = Math.hypot(stepX, stepY) > ESCORT_WALK_EPSILON;
      this.escortFigureList[i].y = follower.y;
    });
  }

  private escortFigures(): ReadonlyArray<InteriorFigure> {
    return this.vip.escortActive ? this.escortFigureList : [];
  }

  renderUI(ctx: CanvasRenderingContext2D, active: Player): void {
    const shop = this.activeShop();
    if (shop) {
      shop.renderUI(ctx, active);
      shop.renderShopPanel(ctx, active);
      return;
    }

    if (this.casino.open) {
      this.casino.renderPanel(ctx, active);
      return;
    }

    if (this.guild.open) {
      this.guild.renderPanel(ctx, active);
      return;
    }

    if (this.vip.open) {
      this.vip.renderPanel(ctx, active);
      return;
    }

    this.dialog.render(ctx);
  }
}
