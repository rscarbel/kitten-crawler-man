import { TILE_SIZE } from '../core/constants';
import type { Player } from '../Player';
import type { GameSystem } from './GameSystem';
import type { AudioManager } from '../audio/AudioManager';
import type { ClubMembership } from '../core/ClubMembership';
import type { MercenaryRoster } from '../core/MercenaryRoster';
import type { AchievementManager, AchievementId } from '../core/AchievementManager';
import {
  CLUB_STATIONS,
  CLUB_DANCE_FLOOR,
  CLUB_DJ_TILE,
  CLUB_DANCER_TILES,
  CLUB_INTERIOR_W,
  CLUB_PATRON_AREA,
  CLUB_PATRON_COUNT,
  type ClubStation,
  type ClubStationId,
} from '../core/clubLayout';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { QuestDialog } from '../ui/QuestDialog';
import { drawClubNpc, type ClubNpcVariant } from '../sprites/clubNpcSprite';
import { drawClubDecor } from '../sprites/clubDecor';
import { stepWander, type WanderParams } from '../creatures/townWander';
import { ShopSystem, type ShopConfig } from './ShopSystem';
import { ClubCasinoSystem } from './ClubCasinoSystem';
import { MercenaryGuildSystem } from './MercenaryGuildSystem';
import { ClubVipLoungeSystem } from './ClubVipLoungeSystem';

const STATION_INTERACT_RANGE = 2.6;
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

// Wandering patrons — cosmetic figures that stroll near the entrance so the floor feels alive.
const PATRON_SPEED_MIN = 0.5;
const PATRON_SPEED_MAX = 1.0;
const PATRON_ARRIVE_DIST = 4;
const PATRON_PAUSE_MIN = 24;
const PATRON_PAUSE_MAX = 120;
// Spread patron appearance seeds apart so adjacent patrons don't share a look.
const PATRON_SEED_STRIDE = 7;
const PATRON_SEED_OFFSET = 3;
// Minimum horizontal drift toward the target before a patron flips which way it faces.
const PATRON_FACING_DEADZONE = 1;

interface Patron {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  speed: number;
  seed: number;
  facingX: number;
  pause: number;
}

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
const SPEED_FIZZ_PRICE = 20;
const COOLDOWN_CRISP_PRICE = 25;
const JUGG_JUICE_PRICE = 30;

const BAR_SHOP_CONFIG: ShopConfig = {
  title: 'The Bar',
  items: [
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

/** Which sprite each station NPC uses. */
const STATION_VARIANT: Record<ClubStationId, ClubNpcVariant> = {
  sledge: 'sledge',
  bar: 'bartender',
  casino: 'dealer',
  market: 'merchant',
  mercenary: 'rosemarie',
  vip: 'vip',
};

/** Proximity-prompt verb for a station: "Talk" to the Sledge, "Shop" at the vendors, "Play" at the casino, else the room name. */
function promptLabel(station: ClubStation): string {
  if (station.id === 'sledge') return 'Talk';
  if (station.id === 'bar' || station.id === 'market') return 'Shop';
  if (station.id === 'casino') return 'Play';
  if (station.id === 'mercenary') return 'Hire';
  return 'Enter';
}

/**
 * Host system for the Desperado Club interior (the analog of SafeRoomSystem /
 * ShopSystem). Phase 1: the Sledge's greeting + membership gate, cosmetic
 * dance-floor lights, DJ and dancers, and proximity prompts for every station.
 * Later phases attach the bar/market shops, the casino, and the mercenary guild.
 */
export class DesperadoClubSystem implements GameSystem {
  private readonly dialog: QuestDialog;
  private animTime = 0;

  private readonly barShop: ShopSystem;
  private readonly marketShop: ShopSystem;
  private readonly casino: ClubCasinoSystem;
  private readonly guild: MercenaryGuildSystem;
  private readonly vip: ClubVipLoungeSystem;

  /** Escort Cretins trailing the player once hired from the VIP Lounge; lazily positioned on first render. */
  private escortFollowers: EscortFollower[] | null = null;

  /** Cosmetic patrons that wander the entrance floor; lazily seeded on first update. */
  private patrons: Patron[] | null = null;

  /** Shared wander tuning for the patrons (open floor, so no walkability gate). */
  private readonly patronWander: WanderParams = {
    pickTarget: () => this.randomPatronPoint(),
    arriveDist: PATRON_ARRIVE_DIST,
    pauseMin: PATRON_PAUSE_MIN,
    pauseMax: PATRON_PAUSE_MAX,
  };

  constructor(
    private readonly membership: ClubMembership,
    roster: MercenaryRoster,
    private readonly audio: AudioManager | null,
    private readonly humanAchievements?: AchievementManager,
    private readonly catAchievements?: AchievementManager,
  ) {
    this.dialog = new QuestDialog(audio);
    this.barShop = new ShopSystem(CLUB_INTERIOR_W, BAR_SHOP_CONFIG);
    this.marketShop = new ShopSystem(CLUB_INTERIOR_W, MARKET_SHOP_CONFIG);
    this.casino = new ClubCasinoSystem(audio);
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

  /** Coins staked at the casino since entering the club — the free-security perk hook (Phase 5). */
  get coinsWageredThisVisit(): number {
    return this.casino.coinsWageredThisVisit;
  }

  /** The bar/market shop whose buy panel is currently open, if any. */
  private activeShop(): ShopSystem | null {
    if (this.barShop.shopOpen) return this.barShop;
    if (this.marketShop.shopOpen) return this.marketShop;
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

  update(): void {
    this.animTime++;
    this.updatePatrons();
    this.barShop.update();
    this.marketShop.update();
    if (this.barShop.purchasePending || this.marketShop.purchasePending) {
      // A round at the bar pours; gear off the market rack does not.
      if (this.barShop.purchasePending) this.audio?.play('ambient_pouring_a_drink');
      this.barShop.purchasePending = false;
      this.marketShop.purchasePending = false;
      this.audio?.play('purchase_success');
    }
    // Sub-panels freeze this update() while open, so pending achievement flags set
    // during a hire/win/hire-escort are consumed here once the panel closes.
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

  private randomPatronPoint(): { x: number; y: number } {
    const tx = CLUB_PATRON_AREA.x0 + Math.random() * (CLUB_PATRON_AREA.x1 - CLUB_PATRON_AREA.x0);
    const ty = CLUB_PATRON_AREA.y0 + Math.random() * (CLUB_PATRON_AREA.y1 - CLUB_PATRON_AREA.y0);
    return { x: tx * TILE_SIZE, y: ty * TILE_SIZE };
  }

  private ensurePatrons(): void {
    if (this.patrons !== null) return;
    const patrons: Patron[] = [];
    for (let i = 0; i < CLUB_PATRON_COUNT; i++) {
      const start = this.randomPatronPoint();
      const target = this.randomPatronPoint();
      patrons.push({
        x: start.x,
        y: start.y,
        targetX: target.x,
        targetY: target.y,
        speed: PATRON_SPEED_MIN + Math.random() * (PATRON_SPEED_MAX - PATRON_SPEED_MIN),
        seed: i * PATRON_SEED_STRIDE + PATRON_SEED_OFFSET,
        facingX: 1,
        pause: Math.floor(Math.random() * PATRON_PAUSE_MAX),
      });
    }
    this.patrons = patrons;
  }

  private updatePatrons(): void {
    this.ensurePatrons();
    if (this.patrons === null) return;
    for (const p of this.patrons) {
      const step = stepWander(p, this.patronWander);
      if (step.moving && Math.abs(step.dx) > PATRON_FACING_DEADZONE) {
        p.facingX = step.dx < 0 ? -1 : 1;
      }
    }
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
  dismissModal(): void {
    const shop = this.activeShop();
    if (shop) {
      shop.shopOpen = false;
      return;
    }
    if (this.casino.open) {
      this.casino.close();
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

  /** Space/tap interaction: dismiss a modal, or open the station the player stands beside. */
  handleInteract(player: Player): void {
    if (this.dialog.isOpen) {
      this.dialog.advance();
      return;
    }
    const station = this.nearestStation(player);
    if (!station) return;
    if (station.id === 'sledge') {
      if (this.membership.hasDesperadoPass) this.openFlavor(station.label, SLEDGE_WELCOME);
      else this.openGreeting();
      return;
    }
    if (station.id === 'bar') {
      this.barShop.shopOpen = true;
      return;
    }
    if (station.id === 'market') {
      this.marketShop.shopOpen = true;
      return;
    }
    if (station.id === 'casino') {
      this.casino.openTable(player);
      return;
    }
    if (station.id === 'mercenary') {
      this.guild.openPanel();
      return;
    }
    this.vip.openPanel(this.coinsWageredThisVisit);
  }

  /** Route clicks to an open shop panel's buy buttons, else advance the modal; returns true when a modal/shop was open. */
  handleClick(mx: number, my: number, active: Player): boolean {
    const shop = this.activeShop();
    if (shop) {
      shop.handleClick(mx, my, active);
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

  closeModals(): void {
    this.dismissModal();
  }

  renderObjects(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    drawClubDecor(ctx, camX, camY);
    this.renderDanceFloorLights(ctx, camX, camY);
    this.renderNpcs(ctx, camX, camY);
    this.renderEscort(ctx, camX, camY, active);

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
  private renderEscort(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Player,
  ): void {
    if (!this.vip.escortActive) return;
    this.escortFollowers ??= [
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
    for (const follower of this.escortFollowers) {
      const targetX = active.x + follower.offsetX;
      const targetY = active.y + follower.offsetY;
      follower.x += (targetX - follower.x) * ESCORT_FOLLOW_LERP;
      follower.y += (targetY - follower.y) * ESCORT_FOLLOW_LERP;
      const facingX = follower.offsetX < 0 ? -1 : 1;
      drawClubNpc(
        ctx,
        follower.x - camX,
        follower.y - camY,
        TILE_SIZE,
        follower.variant,
        this.animTime,
        facingX,
      );
    }
  }

  private renderNpcs(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    CLUB_DANCER_TILES.forEach((dancer, i) => {
      drawClubNpc(
        ctx,
        dancer.x * TILE_SIZE - camX,
        dancer.y * TILE_SIZE - camY,
        TILE_SIZE,
        'dancer',
        this.animTime,
        i % 2 === 0 ? 1 : -1,
        i + 1,
      );
    });
    drawClubNpc(
      ctx,
      CLUB_DJ_TILE.x * TILE_SIZE - camX,
      CLUB_DJ_TILE.y * TILE_SIZE - camY,
      TILE_SIZE,
      'dj',
      this.animTime,
    );
    this.renderPatrons(ctx, camX, camY);
    for (const station of CLUB_STATIONS) {
      drawClubNpc(
        ctx,
        station.tile.x * TILE_SIZE - camX,
        station.tile.y * TILE_SIZE - camY,
        TILE_SIZE,
        STATION_VARIANT[station.id],
        this.animTime + station.tile.x,
      );
    }
  }

  private renderPatrons(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.patrons === null) return;
    for (const p of this.patrons) {
      drawClubNpc(
        ctx,
        p.x - camX,
        p.y - camY,
        TILE_SIZE,
        'patron',
        this.animTime,
        p.facingX,
        p.seed,
      );
    }
  }

  renderUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, active: Player): void {
    const shop = this.activeShop();
    if (shop) {
      shop.renderUI(ctx, canvas, active);
      shop.renderShopPanel(ctx, canvas, active);
      return;
    }

    if (this.casino.open) {
      this.casino.renderPanel(ctx, canvas, active);
      return;
    }

    if (this.guild.open) {
      this.guild.renderPanel(ctx, canvas, active);
      return;
    }

    if (this.vip.open) {
      this.vip.renderPanel(ctx, canvas, active);
      return;
    }

    this.dialog.render(ctx, canvas);
  }
}
