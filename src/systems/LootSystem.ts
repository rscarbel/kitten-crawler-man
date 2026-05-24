import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { LootDrop } from '../creatures/Mob';
import { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { ItemId } from '../core/ItemDefs';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawText } from '../ui/TextBox';

/** Half of TILE_SIZE — used to find the center of a tile from its top-left corner. */
const HALF_TILE = TILE_SIZE / 2;
/** Default loot TTL in frames (60 fps × 60 s = 3600). */
const LOOT_DEFAULT_TTL = 3600;
/** Pickup range for dropper-owned loot: 1.5 tiles = TILE_SIZE + HALF_TILE. */
const DROPPED_PICKUP_RANGE = TILE_SIZE + TILE_SIZE / 2;
/** Pickup range for normal loot: 1.5 tiles = TILE_SIZE + HALF_TILE. */
const LOOT_PICKUP_RANGE = TILE_SIZE + TILE_SIZE / 2;
/** Clickable collection range (tiles from active player). */
const LOOT_CLICK_RANGE_TILES = 3;
/** Loot starts fading this many frames before expiry. */
const LOOT_FADE_START_FRAMES = 600;
/** Minimum opacity for fading loot. */
const LOOT_MIN_ALPHA = 0.15;
/** Width of the loot label dot indicator. */
const LOOT_DOT_RADIUS = 5;
/** Horizontal offset from loot dot to label text start. */
const LOOT_LABEL_TEXT_OFFSET_X = 18;
/** Vertical offset from label box center to text baseline. */
const LOOT_LABEL_TEXT_OFFSET_Y = 4;
/** Approximate pixel width per character for label sizing. */
const LOOT_CHARS_PER_PX = 7;
/** Extra padding around label text. */
const LOOT_LABEL_PADDING = 16;
/** Minimum label box width. */
const LOOT_LABEL_MIN_WIDTH = 54;
/** Label box height. */
const LOOT_LABEL_HEIGHT = 20;
/** Vertical offset above loot position for the label box. */
const LOOT_LABEL_ABOVE_PX = 26;
/** "[click]" hint vertical offset above label box. */
const LOOT_CLICK_HINT_ABOVE_PX = 9;
/** Font size for loot labels. */
const LOOT_LABEL_FONT_SIZE = 10;
/** Font size for "[click]" hint. */
const LOOT_CLICK_HINT_FONT_SIZE = 8;
/** Boss loot pulse base radius. */
const BOSS_LOOT_GLOW_BASE_RADIUS = 18;
/** Boss loot glow pulse range (added to base radius). */
const BOSS_LOOT_GLOW_PULSE_RANGE = 6;
/** Boss loot inner alpha base value. */
const BOSS_LOOT_INNER_ALPHA_BASE = 0.55;
/** Boss loot inner alpha pulse amount. */
const BOSS_LOOT_INNER_ALPHA_PULSE = 0.25;
/** Boss loot mid alpha base value. */
const BOSS_LOOT_MID_ALPHA_BASE = 0.25;
/** Boss loot mid alpha pulse amount. */
const BOSS_LOOT_MID_ALPHA_PULSE = 0.15;
/** Boss loot sparkle rotation speed (radians per second). */
const BOSS_LOOT_SPARKLE_ROTATION_SPEED = 3;
/** Boss loot sparkle orbit base distance (pixels). */
const BOSS_LOOT_SPARKLE_DIST_BASE = 10;
/** Boss loot sparkle orbit pulse distance (pixels). */
const BOSS_LOOT_SPARKLE_DIST_PULSE = 4;
/** Boss loot sparkle orbit offset. */
const BOSS_LOOT_SPARKLE_OFFSET_Y = 10;
/** Boss loot sparkle vertical scale factor. */
const BOSS_LOOT_SPARKLE_Y_SCALE = 0.6;
/** Boss loot sparkle base size. */
const BOSS_LOOT_SPARKLE_SIZE_BASE = 1.5;
/** Boss loot sparkle alpha base. */
const BOSS_LOOT_SPARKLE_ALPHA_BASE = 0.6;
/** Boss loot sparkle alpha pulse. */
const BOSS_LOOT_SPARKLE_ALPHA_PULSE = 0.4;
/** Sparkle arm width as a fraction of sparkle size. */
const BOSS_LOOT_SPARKLE_ARM_WIDTH = 0.3;
/** Number of sparkles around boss loot. */
const BOSS_LOOT_SPARKLE_COUNT = 4;
/** Milliseconds per second — used to convert performance.now() to seconds. */
const BOSS_LOOT_TIME_DIVISOR = 1000;
/** Mid gradient stop position for boss loot glow. */
const BOSS_LOOT_MID_STOP = 0.5;
/** Pulse midpoint offset (shifts sine from [-1,1] to [0,1]). */
const BOSS_LOOT_PULSE_OFFSET = 0.5;
/** Minimum drop-search radius (tiles from dropper). */
const DROP_SEARCH_MIN_RADIUS = 2;
/** Maximum drop-search radius (tiles from dropper). */
const DROP_SEARCH_MAX_RADIUS = 4;

interface PendingLoot {
  x: number;
  y: number;
  loot: LootDrop;
  owner: HumanPlayer | CatPlayer;
  collected: boolean;
  ttl: number;
  pickupDelay: number;
  droppedByPlayer?: boolean;
  isBossLoot?: boolean;
}

export interface FloorItem {
  x: number;
  y: number;
  id: ItemId;
  quantity: number;
}

export class LootSystem implements GameSystem {
  private pendingLoots: PendingLoot[] = [];
  readonly floorItems: FloorItem[] = [];
  private _pickupsThisFrame = 0;

  constructor(private readonly gameMap: GameMap) {}

  drainPickups(): number {
    const n = this._pickupsThisFrame;
    this._pickupsThisFrame = 0;
    return n;
  }

  addLoot(
    x: number,
    y: number,
    loot: LootDrop,
    owner: HumanPlayer | CatPlayer,
    isBossLoot = false,
  ): void {
    this.pendingLoots.push({
      x,
      y,
      loot,
      owner,
      collected: false,
      ttl: LOOT_DEFAULT_TTL,
      pickupDelay: 0,
      isBossLoot,
    });
  }

  addPlayerDrop(
    x: number,
    y: number,
    id: ItemId,
    quantity: number,
    dropper: HumanPlayer | CatPlayer,
  ): void {
    const dropPos = this.findDropPosition(x, y);
    this.pendingLoots.push({
      x: dropPos.x,
      y: dropPos.y,
      loot: { coins: 0, items: [{ id, quantity }] },
      owner: dropper,
      collected: false,
      ttl: LOOT_DEFAULT_TTL,
      pickupDelay: 0,
      droppedByPlayer: true,
    });
  }

  update(ctx: SystemContext): void {
    const { active, inactive: companion } = ctx;
    this._pickupsThisFrame = 0;
    for (const loot of this.pendingLoots) {
      if (loot.collected) continue;
      if (loot.pickupDelay > 0) {
        loot.pickupDelay--;
        continue;
      }

      if (loot.droppedByPlayer) {
        for (const player of [active, companion]) {
          if (loot.collected) break;
          const dist = Math.hypot(player.x + HALF_TILE - loot.x, player.y + HALF_TILE - loot.y);
          if (dist <= DROPPED_PICKUP_RANGE) {
            player.coins += loot.loot.coins;
            for (const it of loot.loot.items) {
              player.inventory.addItem(it.id, it.quantity);
            }
            loot.collected = true;
            this._pickupsThisFrame++;
          }
        }
        continue;
      }

      for (const player of [active, companion]) {
        if (loot.collected) break;
        if (player !== active && companion.autoTarget?.isAlive) continue;
        const dist = Math.hypot(player.x + HALF_TILE - loot.x, player.y + HALF_TILE - loot.y);
        if (dist <= LOOT_PICKUP_RANGE) {
          loot.owner.coins += loot.loot.coins;
          for (const it of loot.loot.items) {
            loot.owner.inventory.addItem(it.id, it.quantity);
          }
          loot.collected = true;
          this._pickupsThisFrame++;
        }
      }
    }

    for (const loot of this.pendingLoots) {
      if (!loot.isBossLoot && !loot.droppedByPlayer && !loot.collected) {
        loot.ttl--;
      }
    }
    this.pendingLoots = this.pendingLoots.filter(
      (l) => !l.collected && ((l.isBossLoot ?? false) || (l.droppedByPlayer ?? false) || l.ttl > 0),
    );
  }

  tryCollectLootAt(
    mx: number,
    my: number,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): boolean {
    for (const loot of this.pendingLoots) {
      const dist = Math.hypot(active.x + HALF_TILE - loot.x, active.y + HALF_TILE - loot.y);
      if (dist > LOOT_CLICK_RANGE_TILES * TILE_SIZE) continue;

      const sx = loot.x - camX;
      const sy = loot.y - camY;
      const parts: string[] = [];
      if (loot.loot.coins > 0) parts.push(`\u{1FA99}${loot.loot.coins}`);
      if (loot.loot.items.length > 0) parts.push(`+${loot.loot.items.length} item`);
      const label = parts.join(' ');
      const bw = Math.max(
        LOOT_LABEL_MIN_WIDTH,
        label.length * LOOT_CHARS_PER_PX + LOOT_LABEL_PADDING,
      );
      const bh = LOOT_LABEL_HEIGHT;
      const bx = sx - bw / 2;
      const by = sy - LOOT_LABEL_ABOVE_PX;

      if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
        const recipient = loot.droppedByPlayer ? active : loot.owner;
        recipient.coins += loot.loot.coins;
        for (const it of loot.loot.items) {
          recipient.inventory.addItem(it.id, it.quantity);
        }
        loot.collected = true;
        return true;
      }
    }
    return false;
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): void {
    for (const loot of this.pendingLoots) {
      const sx = loot.x - camX;
      const sy = loot.y - camY;

      const parts: string[] = [];
      if (loot.loot.coins > 0) parts.push(`\u{1FA99}${loot.loot.coins}`);
      if (loot.loot.items.length > 0) parts.push(`+${loot.loot.items.length} item`);
      const label = parts.join(' ');

      ctx.save();

      if (!loot.isBossLoot && !loot.droppedByPlayer && loot.ttl < LOOT_FADE_START_FRAMES) {
        ctx.globalAlpha = Math.max(LOOT_MIN_ALPHA, loot.ttl / LOOT_FADE_START_FRAMES);
      }

      const ownerLabel = loot.owner instanceof HumanPlayer ? 'Human' : 'Cat';
      const ownerTag = !loot.droppedByPlayer && loot.owner !== active ? ` →${ownerLabel}` : '';
      const fullLabel = label + ownerTag;

      const bw = Math.max(
        LOOT_LABEL_MIN_WIDTH,
        fullLabel.length * LOOT_CHARS_PER_PX + LOOT_LABEL_PADDING,
      );
      const bh = LOOT_LABEL_HEIGHT;
      const bx = sx - bw / 2;
      const by = sy - LOOT_LABEL_ABOVE_PX;

      if (loot.isBossLoot) {
        const t = performance.now() / BOSS_LOOT_TIME_DIVISOR;
        const pulse =
          BOSS_LOOT_PULSE_OFFSET +
          BOSS_LOOT_PULSE_OFFSET * Math.sin(t * BOSS_LOOT_SPARKLE_ROTATION_SPEED);
        const glowR = BOSS_LOOT_GLOW_BASE_RADIUS + pulse * BOSS_LOOT_GLOW_PULSE_RANGE;
        const grad = ctx.createRadialGradient(sx, sy, 2, sx, sy, glowR);
        grad.addColorStop(
          0,
          `rgba(255,215,0,${BOSS_LOOT_INNER_ALPHA_BASE + pulse * BOSS_LOOT_INNER_ALPHA_PULSE})`,
        );
        grad.addColorStop(
          BOSS_LOOT_MID_STOP,
          `rgba(255,165,0,${BOSS_LOOT_MID_ALPHA_BASE + pulse * BOSS_LOOT_MID_ALPHA_PULSE})`,
        );
        grad.addColorStop(1, 'rgba(255,165,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fff';
        for (let i = 0; i < BOSS_LOOT_SPARKLE_COUNT; i++) {
          const angle = t * 2 + i * (Math.PI / 2);
          const sparkleDist = BOSS_LOOT_SPARKLE_DIST_BASE + pulse * BOSS_LOOT_SPARKLE_DIST_PULSE;
          const sparkX = sx + Math.cos(angle) * sparkleDist;
          const sparkY =
            sy -
            BOSS_LOOT_SPARKLE_OFFSET_Y +
            Math.sin(angle) * sparkleDist * BOSS_LOOT_SPARKLE_Y_SCALE;
          const sparkSize = BOSS_LOOT_SPARKLE_SIZE_BASE + pulse;
          ctx.globalAlpha = BOSS_LOOT_SPARKLE_ALPHA_BASE + pulse * BOSS_LOOT_SPARKLE_ALPHA_PULSE;
          ctx.beginPath();
          ctx.moveTo(sparkX, sparkY - sparkSize);
          ctx.lineTo(sparkX + sparkSize * BOSS_LOOT_SPARKLE_ARM_WIDTH, sparkY);
          ctx.lineTo(sparkX, sparkY + sparkSize);
          ctx.lineTo(sparkX - sparkSize * BOSS_LOOT_SPARKLE_ARM_WIDTH, sparkY);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(sparkX - sparkSize, sparkY);
          ctx.lineTo(sparkX, sparkY + sparkSize * BOSS_LOOT_SPARKLE_ARM_WIDTH);
          ctx.lineTo(sparkX + sparkSize, sparkY);
          ctx.lineTo(sparkX, sparkY - sparkSize * BOSS_LOOT_SPARKLE_ARM_WIDTH);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = 'rgba(15,23,42,0.85)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = loot.isBossLoot ? '#ffd700' : loot.owner === active ? '#fbbf24' : '#60a5fa';
      ctx.lineWidth = loot.isBossLoot ? 2 : 1;
      ctx.strokeRect(bx, by, bw, bh);

      ctx.fillStyle = loot.isBossLoot ? '#ffd700' : loot.owner === active ? '#fbbf24' : '#60a5fa';
      ctx.beginPath();
      ctx.arc(bx + LOOT_DOT_RADIUS * 2, by + bh / 2, LOOT_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      drawText(ctx, fullLabel, {
        x: bx + LOOT_LABEL_TEXT_OFFSET_X,
        y: by + bh / 2 - LOOT_LABEL_TEXT_OFFSET_Y,
        size: LOOT_LABEL_FONT_SIZE,
        color: loot.isBossLoot ? '#fff8dc' : loot.owner === active ? '#fde68a' : '#93c5fd',
      });

      const dist = Math.hypot(active.x + HALF_TILE - loot.x, active.y + HALF_TILE - loot.y);
      if (dist <= LOOT_CLICK_RANGE_TILES * TILE_SIZE) {
        drawText(ctx, '[click]', {
          x: sx,
          y: by - LOOT_CLICK_HINT_ABOVE_PX,
          size: LOOT_CLICK_HINT_FONT_SIZE,
          color: '#94a3b8',
          align: 'center',
        });
      }

      ctx.restore();
    }
  }

  findDropPosition(dropperX: number, dropperY: number): { x: number; y: number } {
    const ts = TILE_SIZE;
    const cx = Math.floor((dropperX + HALF_TILE) / ts);
    const cy = Math.floor((dropperY + HALF_TILE) / ts);
    for (let r = DROP_SEARCH_MIN_RADIUS; r <= DROP_SEARCH_MAX_RADIUS; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) < r && Math.abs(dy) < r) continue;
          if (this.gameMap.isWalkable(cx + dx, cy + dy)) {
            return {
              x: (cx + dx) * ts + HALF_TILE,
              y: (cy + dy) * ts + HALF_TILE,
            };
          }
        }
      }
    }
    return { x: dropperX + HALF_TILE, y: dropperY + HALF_TILE };
  }
}
