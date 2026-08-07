import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { LootDrop } from '../creatures/Mob';
import { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { ItemId } from '../core/ItemDefs';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawText } from '../ui/TextBox';
import { drawRadialGlow } from '../sprites/radialGlow';
import { cloneLootDrop } from '../core/lootDrop';

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
/** Distinct brightness steps the pulsing boss-loot glow is baked at. */
const BOSS_LOOT_PULSE_STEPS = 12;
/** Radius of the glow's flat bright core, in pixels at the base glow radius. */
const BOSS_LOOT_GLOW_CORE_PX = 2;
const BOSS_LOOT_GLOW_CORE_FRACTION = BOSS_LOOT_GLOW_CORE_PX / BOSS_LOOT_GLOW_BASE_RADIUS;
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

export interface PendingLoot {
  x: number;
  y: number;
  loot: LootDrop;
  owner: HumanPlayer | CatPlayer;
  collected: boolean;
  ttl: number;
  pickupDelay: number;
  droppedByPlayer?: boolean;
  isBossLoot?: boolean;
  /**
   * Pay the *full* coin amount to both party members rather than only `owner`.
   *
   * Not a split: a smashed prop on floor 1 can roll a single coin, and halving
   * that pays one player nothing.
   */
  sharedCoins?: boolean;
}

export interface FloorItem {
  x: number;
  y: number;
  id: ItemId;
  quantity: number;
}

export interface LootCheckpoint {
  pendingLoots: PendingLoot[];
  floorItems: FloorItem[];
}

/**
 * `owner` stays a bare reference — it identifies which player the pile pays,
 * and copying the Player would hand the credit to a detached clone.
 */
function clonePendingLoot(pile: PendingLoot): PendingLoot {
  return {
    x: pile.x,
    y: pile.y,
    loot: cloneLootDrop(pile.loot),
    owner: pile.owner,
    collected: pile.collected,
    ttl: pile.ttl,
    pickupDelay: pile.pickupDelay,
    droppedByPlayer: pile.droppedByPlayer,
    isBossLoot: pile.isBossLoot,
    sharedCoins: pile.sharedCoins,
  };
}

function cloneFloorItem(item: FloorItem): FloorItem {
  return { x: item.x, y: item.y, id: item.id, quantity: item.quantity };
}

export class LootSystem implements GameSystem {
  private pendingLoots: PendingLoot[] = [];
  /** Reused per-frame party list handed to `creditLoot`. */
  private readonly party: Array<HumanPlayer | CatPlayer> = [];
  readonly floorItems: FloorItem[] = [];
  private _itemPickupsThisFrame = 0;
  private _coinPickupsThisFrame = 0;

  constructor(private readonly gameMap: GameMap) {}

  /**
   * Piles collected this frame, split by what they held so the scene can pick
   * the matching cue — a purse of coins should not sound like a picked-up item.
   * A pile holding both counts in both.
   */
  drainPickups(): { withItems: number; withCoins: number } {
    const drained = {
      withItems: this._itemPickupsThisFrame,
      withCoins: this._coinPickupsThisFrame,
    };
    this._itemPickupsThisFrame = 0;
    this._coinPickupsThisFrame = 0;
    return drained;
  }

  addLoot(
    x: number,
    y: number,
    loot: LootDrop,
    owner: HumanPlayer | CatPlayer,
    isBossLoot = false,
    sharedCoins = false,
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
      sharedCoins,
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

  /**
   * Hands a pile over and marks it collected. Items always go to `recipient`;
   * coins go to `recipient` too, unless the pile is `sharedCoins`, in which case
   * every party member is paid the full amount.
   */
  private creditLoot(
    loot: PendingLoot,
    recipient: HumanPlayer | CatPlayer,
    party: ReadonlyArray<HumanPlayer | CatPlayer>,
  ): void {
    if (loot.sharedCoins ?? false) {
      for (const member of party) member.coins += loot.loot.coins;
    } else {
      recipient.coins += loot.loot.coins;
    }
    for (const it of loot.loot.items) {
      recipient.inventory.addItem(it.id, it.quantity);
    }
    loot.collected = true;
    // Counted here rather than at each call site so the click-to-collect path
    // gets its pickup cue too, not just the walk-over one.
    if (loot.loot.coins > 0) this._coinPickupsThisFrame++;
    if (loot.loot.items.length > 0) this._itemPickupsThisFrame++;
  }

  /**
   * Empties the floor, paying every pile to its owner except the ones the player
   * put down deliberately.
   *
   * For places the party leaves for good rather than walks out of: a building
   * interior is rebuilt from scratch on the next entry, so a barrel's drop left
   * lying by the door would simply cease to exist. Sweeping it into the pack on
   * the way out is the only way earned loot survives the door.
   */
  sweepUncollected(party: ReadonlyArray<HumanPlayer | CatPlayer>): void {
    for (const loot of this.pendingLoots) {
      if (loot.collected) continue;
      // A pile the player put there on purpose goes with the room rather than
      // back into the pack. They dropped it to make space; handing it straight
      // back at the door would make an interior the one place in the game where
      // an item cannot be thrown away.
      if (loot.droppedByPlayer ?? false) continue;
      this.creditLoot(loot, loot.owner, party);
    }
    this.pendingLoots.length = 0;
  }

  /**
   * The text drawn above a pile. Shared between `render` and the click hit-test
   * so the box the player aims at is exactly the box they can see.
   */
  private lootLabel(loot: PendingLoot, active: HumanPlayer | CatPlayer): string {
    const parts: string[] = [];
    if (loot.loot.coins > 0) {
      parts.push(`\u{1FA99}${loot.loot.coins}`);
      if (loot.sharedCoins ?? false) parts.push('(each)');
    }
    if (loot.loot.items.length > 0) parts.push(`+${loot.loot.items.length} item`);
    const ownerLabel = loot.owner instanceof HumanPlayer ? 'Human' : 'Cat';
    const ownerIsElsewhere = !(loot.droppedByPlayer ?? false) && loot.owner !== active;
    const paysEveryone = loot.sharedCoins ?? false;
    if (ownerIsElsewhere && !paysEveryone) parts.push(`→${ownerLabel}`);
    return parts.join(' ');
  }

  /** Screen-space rectangle of a pile's label box. */
  private labelBox(
    loot: PendingLoot,
    label: string,
    camX: number,
    camY: number,
  ): { bx: number; by: number; bw: number; bh: number } {
    const bw = Math.max(
      LOOT_LABEL_MIN_WIDTH,
      label.length * LOOT_CHARS_PER_PX + LOOT_LABEL_PADDING,
    );
    return {
      bx: loot.x - camX - bw / 2,
      by: loot.y - camY - LOOT_LABEL_ABOVE_PX,
      bw,
      bh: LOOT_LABEL_HEIGHT,
    };
  }

  update(ctx: SystemContext): void {
    const { active, inactive: companion } = ctx;
    // Hoisted: the party is the same two players for every piece of loot.
    const party = this.party;
    party.length = 0;
    party.push(active, companion);

    // Pickup, TTL and compaction in one backwards pass — swap-pop rather than a
    // fresh filtered array every frame.
    for (let i = this.pendingLoots.length - 1; i >= 0; i--) {
      const loot = this.pendingLoots[i];

      if (!loot.collected) {
        if (loot.pickupDelay > 0) {
          loot.pickupDelay--;
        } else if (loot.droppedByPlayer) {
          for (const player of party) {
            if (this.isWithinPickupRange(player, loot, DROPPED_PICKUP_RANGE)) {
              this.creditLoot(loot, player, party);
              break;
            }
          }
        } else {
          for (const player of party) {
            if (player !== active && companion.autoTarget?.isAlive) continue;
            if (this.isWithinPickupRange(player, loot, LOOT_PICKUP_RANGE)) {
              this.creditLoot(loot, loot.owner, party);
              break;
            }
          }
        }
      }

      if (!loot.isBossLoot && !loot.droppedByPlayer && !loot.collected) {
        loot.ttl--;
      }

      const keep =
        !loot.collected &&
        ((loot.isBossLoot ?? false) || (loot.droppedByPlayer ?? false) || loot.ttl > 0);
      if (!keep) {
        this.pendingLoots[i] = this.pendingLoots[this.pendingLoots.length - 1];
        this.pendingLoots.pop();
      }
    }
  }

  private isWithinPickupRange(
    player: { x: number; y: number },
    loot: { x: number; y: number },
    range: number,
  ): boolean {
    const dx = player.x + HALF_TILE - loot.x;
    const dy = player.y + HALF_TILE - loot.y;
    return dx * dx + dy * dy <= range * range;
  }

  tryCollectLootAt(
    mx: number,
    my: number,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
    inactive: HumanPlayer | CatPlayer,
  ): boolean {
    for (const loot of this.pendingLoots) {
      const dist = Math.hypot(active.x + HALF_TILE - loot.x, active.y + HALF_TILE - loot.y);
      if (dist > LOOT_CLICK_RANGE_TILES * TILE_SIZE) continue;

      const { bx, by, bw, bh } = this.labelBox(loot, this.lootLabel(loot, active), camX, camY);
      if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
        const recipient = (loot.droppedByPlayer ?? false) ? active : loot.owner;
        this.creditLoot(loot, recipient, [active, inactive]);
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

      const fullLabel = this.lootLabel(loot, active);

      ctx.save();

      if (!loot.isBossLoot && !loot.droppedByPlayer && loot.ttl < LOOT_FADE_START_FRAMES) {
        ctx.globalAlpha = Math.max(LOOT_MIN_ALPHA, loot.ttl / LOOT_FADE_START_FRAMES);
      }

      const { bx, by, bw, bh } = this.labelBox(loot, fullLabel, camX, camY);

      if (loot.isBossLoot) {
        const t = performance.now() / BOSS_LOOT_TIME_DIVISOR;
        const pulse =
          BOSS_LOOT_PULSE_OFFSET +
          BOSS_LOOT_PULSE_OFFSET * Math.sin(t * BOSS_LOOT_SPARKLE_ROTATION_SPEED);
        const glowR = BOSS_LOOT_GLOW_BASE_RADIUS + pulse * BOSS_LOOT_GLOW_PULSE_RANGE;
        // The two inner stops brighten with the pulse, so the glow is baked per
        // quantized step rather than per frame. Twelve steps is below the point
        // where the brightening reads as stepped.
        const pulseStep = Math.round(pulse * BOSS_LOOT_PULSE_STEPS) / BOSS_LOOT_PULSE_STEPS;
        drawRadialGlow(
          ctx,
          sx,
          sy,
          glowR,
          [
            {
              offset: 0,
              color: `rgba(255,215,0,${BOSS_LOOT_INNER_ALPHA_BASE + pulseStep * BOSS_LOOT_INNER_ALPHA_PULSE})`,
            },
            {
              offset: BOSS_LOOT_MID_STOP,
              color: `rgba(255,165,0,${BOSS_LOOT_MID_ALPHA_BASE + pulseStep * BOSS_LOOT_MID_ALPHA_PULSE})`,
            },
            { offset: 1, color: 'rgba(255,165,0,0)' },
          ],
          BOSS_LOOT_GLOW_CORE_FRACTION,
        );

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

  captureCheckpoint(): LootCheckpoint {
    return {
      pendingLoots: this.pendingLoots.map(clonePendingLoot),
      floorItems: this.floorItems.map(cloneFloorItem),
    };
  }

  /**
   * Drops made after the capture are discarded outright, including piles from
   * mobs the restore is about to revive — leaving them would let the player
   * bank the loot and then kill the same mob again.
   */
  restoreCheckpoint(snapshot: LootCheckpoint): void {
    this.pendingLoots = snapshot.pendingLoots.map(clonePendingLoot);
    // `floorItems` is a public readonly array other code may already hold, so
    // it is emptied and refilled rather than reassigned.
    this.floorItems.length = 0;
    for (const item of snapshot.floorItems) {
      this.floorItems.push(cloneFloorItem(item));
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
