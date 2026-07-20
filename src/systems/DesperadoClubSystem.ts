import { TILE_SIZE } from '../core/constants';
import type { Player } from '../Player';
import type { GameSystem } from './GameSystem';
import type { AudioManager } from '../audio/AudioManager';
import type { ClubMembership } from '../core/ClubMembership';
import {
  CLUB_STATIONS,
  CLUB_DANCE_FLOOR,
  CLUB_DJ_TILE,
  CLUB_DANCER_TILES,
  type ClubStation,
  type ClubStationId,
} from '../core/clubLayout';
import { drawText } from '../ui/TextBox';
import { drawModal, drawOverlay, BOX_PRESETS } from '../ui/Box';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { drawClubNpc, type ClubNpcVariant } from '../sprites/clubNpcSprite';

const STATION_INTERACT_RANGE = 2.6;
const TILE_HALF = 0.5;

// Dance-floor light overlay
const DANCE_LIGHT_COLORS = ['#ff2d78', '#2d9bff', '#a94dff', '#4dffb0', '#ffd23d'];
const DANCE_LIGHT_PERIOD_MS = 900;
const DANCE_LIGHT_TILE_PHASE_X = 0.7;
const DANCE_LIGHT_TILE_PHASE_Y = 1.3;
const DANCE_LIGHT_ALPHA_BASE = 0.16;
const DANCE_LIGHT_ALPHA_SWING = 0.22;
const DANCE_LIGHT_CENTER_FRACTION = 0.5;
const DANCE_LIGHT_RADIUS_FRACTION = 0.62;

// Modal layout
const MODAL_W = 440;
const MODAL_H = 240;
const MODAL_PADDING = 22;
const MODAL_TITLE_SIZE = 18;
const MODAL_LINE_SIZE = 13;
const MODAL_LINE_HEIGHT = 26;
const MODAL_TITLE_GAP = 16;
const MODAL_HINT_SIZE = 11;
const MODAL_HINT_FROM_BOTTOM = 26;

/** The Sledge's welcome + house rules, shown once and granting the Desperado Pass on dismiss. */
const GREETING_LINES: ReadonlyArray<string> = [
  'A seven-foot slab of tuxedoed granite steps into your path.',
  '"Welcome to the Desperado Club. Name\'s Sledge. Two house rules:"',
  '"No fighting inside — the club is neutral ground, always."',
  '"First membership\'s on the house. Take the Pass. Spend well."',
];

const GREETING_TITLE = '🔪  The Desperado Club  🔪';
const SLEDGE_WELCOME = '"Back again? Good. Enjoy yourself — and mind the rules."';

/** Flavour shown for stations whose feature ships in a later phase. */
const STATION_COMING_SOON: Record<Exclude<ClubStationId, 'sledge'>, string> = {
  bar: 'The bartender wipes down the counter. "Bar\'s not pouring just yet — soon."',
  casino: 'A dealer shuffles an empty deck. "Tables aren\'t open tonight, friend."',
  market: 'A vendor stacks crates. "Stock\'s still on the truck. Nothing to sell yet."',
  mercenary: 'A gruff voice from behind the desk: "Meat Shields ain\'t hiring here yet."',
  vip: 'A velvet rope bars the VIP Lounge. "Members-only back room... opening soon."',
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

interface ClubModal {
  title: string;
  lines: ReadonlyArray<string>;
  isGreeting: boolean;
}

/**
 * Host system for the Desperado Club interior (the analog of SafeRoomSystem /
 * ShopSystem). Phase 1: the Sledge's greeting + membership gate, cosmetic
 * dance-floor lights, DJ and dancers, and proximity prompts for every station.
 * Later phases attach the bar/market shops, the casino, and the mercenary guild.
 */
export class DesperadoClubSystem implements GameSystem {
  private modal: ClubModal | null = null;
  private animTime = 0;

  constructor(
    private readonly membership: ClubMembership,
    private readonly audio: AudioManager | null,
  ) {
    if (!membership.hasDesperadoPass) {
      this.openGreeting();
    }
  }

  get modalOpen(): boolean {
    return this.modal !== null;
  }

  update(): void {
    this.animTime++;
  }

  private openGreeting(): void {
    this.modal = { title: GREETING_TITLE, lines: GREETING_LINES, isGreeting: true };
  }

  private openFlavor(title: string, line: string): void {
    this.modal = { title, lines: [line], isGreeting: false };
  }

  /** Advance/close the open modal. Dismissing the greeting grants the Desperado Pass. */
  dismissModal(): void {
    const modal = this.modal;
    if (!modal) return;
    this.modal = null;
    if (modal.isGreeting && !this.membership.hasDesperadoPass) {
      this.membership.hasDesperadoPass = true;
      this.audio?.play('achievement_awarded');
    }
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
    if (this.modal) {
      this.dismissModal();
      return;
    }
    const station = this.nearestStation(player);
    if (!station) return;
    if (station.id === 'sledge') {
      if (this.membership.hasDesperadoPass) this.openFlavor(station.label, SLEDGE_WELCOME);
      else this.openGreeting();
      return;
    }
    this.openFlavor(station.label, STATION_COMING_SOON[station.id]);
  }

  /** Clicks are consumed to advance the modal; returns true when a modal was open. */
  handleClick(): boolean {
    if (!this.modal) return false;
    this.dismissModal();
    return true;
  }

  closeModals(): void {
    this.dismissModal();
  }

  renderObjects(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    this.renderDanceFloorLights(ctx, camX, camY);
    this.renderNpcs(ctx, camX, camY);

    if (this.modal) return;
    const station = this.nearestStation(active);
    if (station) {
      const sx = station.tile.x * TILE_SIZE - camX;
      const sy = station.tile.y * TILE_SIZE - camY;
      const label = station.id === 'sledge' ? 'Talk' : station.label;
      drawInteractionPrompt(ctx, sx, sy, TILE_SIZE, label);
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

  private renderNpcs(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const dancer of CLUB_DANCER_TILES) {
      drawClubNpc(
        ctx,
        dancer.x * TILE_SIZE - camX,
        dancer.y * TILE_SIZE - camY,
        TILE_SIZE,
        'dancer',
        this.animTime + dancer.x * dancer.y,
      );
    }
    drawClubNpc(
      ctx,
      CLUB_DJ_TILE.x * TILE_SIZE - camX,
      CLUB_DJ_TILE.y * TILE_SIZE - camY,
      TILE_SIZE,
      'dj',
      this.animTime,
    );
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

  renderUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const modal = this.modal;
    if (!modal) return;

    drawOverlay(ctx, { canvasWidth: canvas.width, canvasHeight: canvas.height, alpha: 0.55 });
    const box = drawModal(ctx, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      width: MODAL_W,
      height: MODAL_H,
      padding: MODAL_PADDING,
      ...BOX_PRESETS.modal,
      border: '#c8a840',
    });

    drawText(ctx, modal.title, {
      x: canvas.width / 2,
      y: box.inner.y,
      size: MODAL_TITLE_SIZE,
      bold: true,
      color: '#f0d870',
      align: 'center',
    });

    drawText(ctx, modal.lines.join('\n'), {
      x: box.inner.x,
      y: box.inner.y + MODAL_TITLE_GAP + MODAL_LINE_HEIGHT,
      size: MODAL_LINE_SIZE,
      color: '#d8d2c0',
      align: 'center',
      width: box.inner.width,
      lineHeight: MODAL_LINE_HEIGHT,
    });

    drawText(ctx, '[Space / Click]  Continue', {
      x: canvas.width / 2,
      y: box.inner.y + box.inner.height - MODAL_HINT_FROM_BOTTOM,
      size: MODAL_HINT_SIZE,
      color: '#8a7a50',
      align: 'center',
    });
  }
}
