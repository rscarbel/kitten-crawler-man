import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { LootDrop } from '../creatures/Mob';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { playPickupGesture } from '../creatures/humanGestures';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { ItemId } from '../core/ItemDefs';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawText } from '../ui/TextBox';
import { drawItemIcon } from '../ui/InventoryPanel';
import { ITEM_DEF } from '../core/ItemDefs';
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

// Ground loot presentation: a gentle bob, a glow disc, a periodic shine,
// and the pile's actual contents drawn on the floor.
/** Arbitrary irrational-ish multipliers so a pile's bob/shine phase looks seeded, not periodic across piles. */
const LOOT_PHASE_SEED_X = 0.013;
const LOOT_PHASE_SEED_Y = 0.017;
const LOOT_BOB_TIME_DIVISOR = 260;
const LOOT_BOB_SPEED = 1;
const LOOT_BOB_AMPLITUDE_PX = 3;
const LOOT_GLOW_RADIUS = 20;
const LOOT_GLOW_INNER_ALPHA = 0.35;
const LOOT_GLOW_CORE_FRACTION = 0.15;
/** How many seconds pass, on average, between one shine sweep and the next. */
const LOOT_SWEEP_PERIOD = 4;
const LOOT_SWEEP_SPEED = 1;
/** The fraction of `LOOT_SWEEP_PERIOD` the sweep is actually visible for. */
const LOOT_SWEEP_ACTIVE_FRACTION = 0.25;
const LOOT_SWEEP_MAX_ALPHA = 0.35;
const LOOT_SWEEP_RADIUS = 10;
const LOOT_CONTENT_SPACING = 16;
const LOOT_ITEM_ICON_SIZE = 22;
const LOOT_EXTRA_ITEMS_BADGE_SIZE = 9;
const LOOT_EXTRA_ITEMS_BADGE_OFFSET = 4;
const LOOT_COIN_RADIUS = 5;
/** How far the coin pile's three discs sit from its centre, as a share of one coin's own radius. */
const LOOT_COIN_PILE_FRONT_Y_SHARE = 0.3;
const LOOT_COIN_PILE_SIDE_X_SHARE = 0.7;
const LOOT_COIN_PILE_SIDE_Y_SHARE = 0.2;
const LOOT_COIN_PILE_BACK_Y_SHARE = 0.1;

// A kill or a break must be *seen* to pay out: coins and items burst from the
// body, arc up, fall with gravity, land with a small bounce, and only then
// settle into the collectable pile above. `PendingLoot.pickupDelay` already
// blocks both auto-collect and click-collect while it counts down, so the
// fall's whole duration rides on it — nothing can be picked up mid-flight.
/** How many coins one falling piece stands in for, before capping how many piece the burst spawns. */
const DROP_COINS_PER_PIECE = 6;
const DROP_MIN_COIN_PIECES = 1;
const DROP_MAX_COIN_PIECES = 6;
/** At most this many of a pile's item stacks fall individually — a boss dropping a dozen items bursts the first few, not all of them. */
const DROP_MAX_ITEM_PIECES = 3;
/** Frames between one piece launching and the next, within one burst. */
const DROP_PIECE_STAGGER_FRAMES = 4;
/** The up-and-over arc: how long it takes, and how high it peaks. */
const DROP_ARC_FRAMES = 16;
const DROP_ARC_HEIGHT_PX = 26;
/** The small settle bounce once a piece first touches ground. */
const DROP_BOUNCE_FRAMES = 10;
const DROP_BOUNCE_HEIGHT_PX = 6;
/** A readable pause once every piece has settled, before the pile becomes collectable. */
const DROP_SETTLE_BEAT_FRAMES = 10;
/** How far from the pile's centre a piece can scatter before landing, at most. */
const DROP_SCATTER_RADIUS_FRACTION = 0.35;
const DROP_SCATTER_RADIUS_PX = TILE_SIZE * DROP_SCATTER_RADIUS_FRACTION;
/** Shrinking fractions of the scatter radius tried in turn until one lands on walkable ground. */
const DROP_SCATTER_SCALE_FULL = 1;
const DROP_SCATTER_SCALE_MEDIUM = 0.6;
const DROP_SCATTER_SCALE_SMALL = 0.3;
const DROP_SCATTER_SCALE_NONE = 0;
const DROP_SCATTER_FALLBACK_SCALES = [
  DROP_SCATTER_SCALE_FULL,
  DROP_SCATTER_SCALE_MEDIUM,
  DROP_SCATTER_SCALE_SMALL,
  DROP_SCATTER_SCALE_NONE,
] as const;
const DROP_ITEM_ICON_SIZE = 18;
const DROP_SHADOW_COLOR = 'rgba(0,0,0,0.35)';
const DROP_SHADOW_RX = 6;
const DROP_SHADOW_RY = 2.5;
/** The shadow shrinks toward this fraction of its size at the top of the arc. */
const DROP_SHADOW_MIN_SCALE = 0.5;
/** Parabola `t(1-t)` peaks at a quarter, so this scales it to peak at exactly the named height. */
const DROP_ARC_PARABOLA_SCALE = 4;

/** Width in characters of one `#rrggbb` colour channel. */
const HEX_CHANNEL_WIDTH = 2;
/** Base for parsing a hex colour channel. */
const HEX_RADIX = 16;

/** `#rrggbb` plus an alpha, for a glow whose color is picked at runtime (owner gold vs. blue). */
function withAlpha(hexColor: string, alpha: number): string {
  const channel = (index: number): number =>
    parseInt(
      hexColor.slice(1 + index * HEX_CHANNEL_WIDTH, 1 + (index + 1) * HEX_CHANNEL_WIDTH),
      HEX_RADIX,
    );
  return `rgba(${channel(0)},${channel(1)},${channel(2)},${alpha})`;
}

/**
 * One coin or item bursting out of a kill/break and falling to its landed
 * spot. Purely a visual — what it pays out is already decided by the pile
 * it belongs to; this only describes the trip there.
 */
interface DropPiece {
  readonly kind: 'coin' | 'item';
  readonly itemId?: ItemId;
  /** Offset from the pile's (x, y) once landed, already clamped to walkable ground. */
  readonly landX: number;
  readonly landY: number;
  /** Frames after the pile spawns before this piece starts moving — staggers a burst. */
  readonly startDelay: number;
}

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
  /** Set only while the pile is still falling; `render` reads this instead of the landed pile art. */
  dropPieces?: DropPiece[];
  /** How many frames the whole fall (stagger + arc + bounce + settle beat) takes; `pickupDelay` counts down from this. */
  dropTotalFrames?: number;
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
 *
 * @param landed Finalises an in-flight drop animation to its landed state
 *   instead of copying it verbatim — for `restoreCheckpoint`, where a pile
 *   captured mid-fall must come back as an ordinary collectable pile rather
 *   than resuming a fall whose timing no longer means anything.
 */
function clonePendingLoot(pile: PendingLoot, landed = false): PendingLoot {
  return {
    x: pile.x,
    y: pile.y,
    loot: cloneLootDrop(pile.loot),
    owner: pile.owner,
    collected: pile.collected,
    ttl: pile.ttl,
    pickupDelay: landed ? 0 : pile.pickupDelay,
    droppedByPlayer: pile.droppedByPlayer,
    isBossLoot: pile.isBossLoot,
    sharedCoins: pile.sharedCoins,
    dropPieces: landed ? undefined : pile.dropPieces?.map((p) => ({ ...p })),
    dropTotalFrames: landed ? undefined : pile.dropTotalFrames,
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

  /**
   * Fired the moment a pile is actually credited, so the scene can fly its
   * coins and items to the HUD from the pile's own world position. Not fired
   * for a `sweepUncollected` payout — there is nowhere on the ground left to
   * fly from once the party has already left the room.
   */
  onCredited: ((loot: PendingLoot) => void) | null = null;

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

  /**
   * @param animateDrop Whether this pile came from a kill or a break, and so
   *   must fall and land before it can be collected. Chest and quest rewards
   *   (no body to fall from) pass `false` and appear already settled.
   */
  addLoot(
    x: number,
    y: number,
    loot: LootDrop,
    owner: HumanPlayer | CatPlayer,
    isBossLoot = false,
    sharedCoins = false,
    animateDrop = false,
  ): void {
    const dropPieces = animateDrop ? this.buildDropPieces(x, y, loot) : [];
    const dropTotalFrames = this.dropAnimationFrames(dropPieces);
    this.pendingLoots.push({
      x,
      y,
      loot,
      owner,
      collected: false,
      ttl: LOOT_DEFAULT_TTL,
      pickupDelay: dropTotalFrames,
      isBossLoot,
      sharedCoins,
      dropPieces: dropPieces.length > 0 ? dropPieces : undefined,
      dropTotalFrames: dropTotalFrames > 0 ? dropTotalFrames : undefined,
    });
  }

  /** Total frames a burst takes: its latest piece's own stagger plus the fall, bounce and settle beat. */
  private dropAnimationFrames(pieces: ReadonlyArray<DropPiece>): number {
    if (pieces.length === 0) return 0;
    const maxStartDelay = pieces.reduce((max, p) => Math.max(max, p.startDelay), 0);
    return maxStartDelay + DROP_ARC_FRAMES + DROP_BOUNCE_FRAMES + DROP_SETTLE_BEAT_FRAMES;
  }

  /**
   * One falling piece per handful of coins and per item stack (capped), each
   * scattered to a nearby walkable landing spot so a burst doesn't read as a
   * single object multiplied.
   */
  private buildDropPieces(x: number, y: number, loot: LootDrop): DropPiece[] {
    const pieces: DropPiece[] = [];
    let pieceIndex = 0;

    if (loot.coins > 0) {
      const count = Math.min(
        DROP_MAX_COIN_PIECES,
        Math.max(DROP_MIN_COIN_PIECES, Math.round(loot.coins / DROP_COINS_PER_PIECE)),
      );
      for (let i = 0; i < count; i++) {
        const land = this.scatterLandingSpot(x, y);
        pieces.push({
          kind: 'coin',
          landX: land.x,
          landY: land.y,
          startDelay: pieceIndex * DROP_PIECE_STAGGER_FRAMES,
        });
        pieceIndex++;
      }
    }

    for (const item of loot.items.slice(0, DROP_MAX_ITEM_PIECES)) {
      const land = this.scatterLandingSpot(x, y);
      pieces.push({
        kind: 'item',
        itemId: item.id,
        landX: land.x,
        landY: land.y,
        startDelay: pieceIndex * DROP_PIECE_STAGGER_FRAMES,
      });
      pieceIndex++;
    }

    return pieces;
  }

  /**
   * A random offset from `(x, y)` within {@link DROP_SCATTER_RADIUS_PX}, shrunk
   * toward the centre until it lands on walkable ground — `(x, y)` itself is
   * always tried last and is assumed walkable, since it's already a resolved
   * death or drop position.
   */
  private scatterLandingSpot(x: number, y: number): { x: number; y: number } {
    const angle = Math.random() * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    for (const scale of DROP_SCATTER_FALLBACK_SCALES) {
      const offsetX = dirX * DROP_SCATTER_RADIUS_PX * scale;
      const offsetY = dirY * DROP_SCATTER_RADIUS_PX * scale;
      if (scale === 0) return { x: offsetX, y: offsetY };
      const tileX = Math.floor((x + offsetX) / TILE_SIZE);
      const tileY = Math.floor((y + offsetY) / TILE_SIZE);
      if (this.gameMap.isWalkable(tileX, tileY)) return { x: offsetX, y: offsetY };
    }
    return { x: 0, y: 0 };
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
      for (const member of party) member.earnCoins(loot.loot.coins);
    } else {
      recipient.earnCoins(loot.loot.coins);
    }
    for (const it of loot.loot.items) {
      recipient.inventory.addItem(it.id, it.quantity);
    }
    loot.collected = true;
    // Counted here rather than at each call site so the click-to-collect path
    // gets its pickup cue too, not just the walk-over one.
    if (loot.loot.coins > 0) this._coinPickupsThisFrame++;
    if (loot.loot.items.length > 0) this._itemPickupsThisFrame++;
    this.onCredited?.(loot);
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
              playPickupGesture(player, loot);
              break;
            }
          }
        } else {
          for (const player of party) {
            if (player !== active && companion.autoTarget?.isAlive) continue;
            if (this.isWithinPickupRange(player, loot, LOOT_PICKUP_RANGE)) {
              this.creditLoot(loot, loot.owner, party);
              // The one who stooped for it, not the one it was credited to.
              playPickupGesture(player, loot);
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
      // Still falling — nothing is drawn to click on yet, and letting a click
      // reach through to `creditLoot` here would collect it before it lands.
      if (loot.pickupDelay > 0) continue;
      const dist = Math.hypot(active.x + HALF_TILE - loot.x, active.y + HALF_TILE - loot.y);
      if (dist > LOOT_CLICK_RANGE_TILES * TILE_SIZE) continue;

      const { bx, by, bw, bh } = this.labelBox(loot, this.lootLabel(loot, active), camX, camY);
      if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
        const recipient = (loot.droppedByPlayer ?? false) ? active : loot.owner;
        this.creditLoot(loot, recipient, [active, inactive]);
        playPickupGesture(active, loot);
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

      ctx.save();

      if (!loot.isBossLoot && !loot.droppedByPlayer && loot.ttl < LOOT_FADE_START_FRAMES) {
        ctx.globalAlpha = Math.max(LOOT_MIN_ALPHA, loot.ttl / LOOT_FADE_START_FRAMES);
      }

      // Still falling: the burst is most of the show. No label, no glow, no
      // pile art — none of that is true yet, and `pickupDelay` already
      // refuses collection until it lands, so nothing here needs to invite a
      // click. Boss loot keeps its sparkle running underneath regardless —
      // it's decoration, not an invitation to collect.
      const isFalling = loot.pickupDelay > 0 && (loot.dropPieces?.length ?? 0) > 0;
      if (isFalling) {
        this.renderDropPieces(ctx, loot, sx, sy);
      }

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

      if (isFalling) {
        ctx.restore();
        continue;
      }

      const fullLabel = this.lootLabel(loot, active);
      const ownColor = loot.isBossLoot ? '#ffd700' : loot.owner === active ? '#fbbf24' : '#60a5fa';
      const dist = Math.hypot(active.x + HALF_TILE - loot.x, active.y + HALF_TILE - loot.y);
      const isNear = dist <= LOOT_CLICK_RANGE_TILES * TILE_SIZE;

      // A per-pile phase, seeded off its own position, keeps a room's worth of
      // loot from bobbing and shining in lockstep.
      const phase = (loot.x * LOOT_PHASE_SEED_X + loot.y * LOOT_PHASE_SEED_Y) % (Math.PI * 2);
      const t = performance.now() / LOOT_BOB_TIME_DIVISOR;
      const bobY = Math.sin(t * LOOT_BOB_SPEED + phase) * LOOT_BOB_AMPLITUDE_PX;
      const iconY = sy + bobY;

      if (!loot.isBossLoot) {
        drawRadialGlow(
          ctx,
          sx,
          iconY,
          LOOT_GLOW_RADIUS,
          [
            { offset: 0, color: withAlpha(ownColor, LOOT_GLOW_INNER_ALPHA) },
            { offset: 1, color: withAlpha(ownColor, 0) },
          ],
          LOOT_GLOW_CORE_FRACTION,
        );
      }

      this.renderContents(ctx, loot, sx, iconY);

      // A soft diagonal sweep of light crosses the pile every few seconds,
      // rather than a constant sparkle, so a room full of loot doesn't shimmer
      // uniformly all the time.
      const sweepT = ((t * LOOT_SWEEP_SPEED + phase) % LOOT_SWEEP_PERIOD) / LOOT_SWEEP_PERIOD;
      if (sweepT < LOOT_SWEEP_ACTIVE_FRACTION) {
        const sweepAlpha =
          Math.sin((sweepT / LOOT_SWEEP_ACTIVE_FRACTION) * Math.PI) * LOOT_SWEEP_MAX_ALPHA;
        ctx.save();
        ctx.globalAlpha *= sweepAlpha;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(sx, iconY, LOOT_SWEEP_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (isNear) {
        const { bx, by, bw, bh } = this.labelBox(loot, fullLabel, camX, camY);
        ctx.fillStyle = 'rgba(15,23,42,0.85)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = ownColor;
        ctx.lineWidth = loot.isBossLoot ? 2 : 1;
        ctx.strokeRect(bx, by, bw, bh);

        ctx.fillStyle = ownColor;
        ctx.beginPath();
        ctx.arc(bx + LOOT_DOT_RADIUS * 2, by + bh / 2, LOOT_DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();

        drawText(ctx, fullLabel, {
          x: bx + LOOT_LABEL_TEXT_OFFSET_X,
          y: by + bh / 2 - LOOT_LABEL_TEXT_OFFSET_Y,
          size: LOOT_LABEL_FONT_SIZE,
          color: loot.isBossLoot ? '#fff8dc' : loot.owner === active ? '#fde68a' : '#93c5fd',
        });

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

  /**
   * The pile's actual contents on the ground: a small coin heap when it holds
   * coins, and the first item's icon (with a "+N" badge for the rest) when it
   * holds items. Both can show at once for a mixed pile.
   */
  private renderContents(
    ctx: CanvasRenderingContext2D,
    loot: PendingLoot,
    cx: number,
    cy: number,
  ): void {
    const hasCoins = loot.loot.coins > 0;
    const hasItems = loot.loot.items.length > 0;
    const coinCx = hasItems ? cx - LOOT_CONTENT_SPACING / 2 : cx;
    const itemCx = hasCoins ? cx + LOOT_CONTENT_SPACING / 2 : cx;

    if (hasCoins) this.renderCoinPile(ctx, coinCx, cy);

    if (hasItems) {
      const first = loot.loot.items[0];
      const size = LOOT_ITEM_ICON_SIZE;
      drawItemIcon(
        ctx,
        { ...ITEM_DEF[first.id], quantity: first.quantity },
        itemCx - size / 2,
        cy - size / 2,
        size,
      );
      if (loot.loot.items.length > 1) {
        drawText(ctx, `+${loot.loot.items.length - 1}`, {
          x: itemCx + size / 2,
          y: cy + size / 2 - LOOT_EXTRA_ITEMS_BADGE_OFFSET,
          size: LOOT_EXTRA_ITEMS_BADGE_SIZE,
          bold: true,
          color: '#e2e8f0',
          outline: true,
        });
      }
    }
  }

  /** A handful of overlapping coin discs, standing in for the pile's actual count. */
  private renderCoinPile(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const positions: ReadonlyArray<[number, number]> = [
      [0, LOOT_COIN_RADIUS * LOOT_COIN_PILE_FRONT_Y_SHARE],
      [
        -LOOT_COIN_RADIUS * LOOT_COIN_PILE_SIDE_X_SHARE,
        -LOOT_COIN_RADIUS * LOOT_COIN_PILE_SIDE_Y_SHARE,
      ],
      [
        LOOT_COIN_RADIUS * LOOT_COIN_PILE_SIDE_X_SHARE,
        -LOOT_COIN_RADIUS * LOOT_COIN_PILE_BACK_Y_SHARE,
      ],
    ];
    for (const [dx, dy] of positions) this.drawSingleCoin(ctx, cx + dx, cy + dy);
  }

  private drawSingleCoin(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, LOOT_COIN_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  /**
   * A pile's burst of falling pieces: each arcs from the pile's centre out to
   * its landing spot, bounces once, then sits still for the settle beat.
   * World-space throughout, so the whole burst pans and lands with the camera
   * exactly where the pile itself will end up.
   */
  private renderDropPieces(
    ctx: CanvasRenderingContext2D,
    loot: PendingLoot,
    originX: number,
    originY: number,
  ): void {
    const pieces = loot.dropPieces;
    const total = loot.dropTotalFrames;
    if (!pieces || total === undefined) return;
    const elapsed = total - loot.pickupDelay;

    for (const piece of pieces) {
      const pieceElapsed = elapsed - piece.startDelay;
      if (pieceElapsed < 0) continue; // Not launched yet.

      let groundX: number;
      let groundY: number;
      let height: number;
      if (pieceElapsed < DROP_ARC_FRAMES) {
        const t = pieceElapsed / DROP_ARC_FRAMES;
        groundX = piece.landX * t;
        groundY = piece.landY * t;
        height = DROP_ARC_HEIGHT_PX * DROP_ARC_PARABOLA_SCALE * t * (1 - t);
      } else if (pieceElapsed < DROP_ARC_FRAMES + DROP_BOUNCE_FRAMES) {
        const t = (pieceElapsed - DROP_ARC_FRAMES) / DROP_BOUNCE_FRAMES;
        groundX = piece.landX;
        groundY = piece.landY;
        height = DROP_BOUNCE_HEIGHT_PX * DROP_ARC_PARABOLA_SCALE * t * (1 - t);
      } else {
        groundX = piece.landX;
        groundY = piece.landY;
        height = 0;
      }

      const px = originX + groundX;
      const py = originY + groundY;

      // The shadow lives on the ground plane regardless of height, and
      // shrinks while the piece is airborne so the two read as connected.
      const airFraction = Math.min(1, height / DROP_ARC_HEIGHT_PX);
      const shadowScale = 1 - airFraction * (1 - DROP_SHADOW_MIN_SCALE);
      ctx.save();
      ctx.fillStyle = DROP_SHADOW_COLOR;
      ctx.beginPath();
      ctx.ellipse(
        px,
        py,
        DROP_SHADOW_RX * shadowScale,
        DROP_SHADOW_RY * shadowScale,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();

      const drawY = py - height;
      if (piece.kind === 'coin') {
        this.drawSingleCoin(ctx, px, drawY);
      } else if (piece.itemId !== undefined) {
        const size = DROP_ITEM_ICON_SIZE;
        drawItemIcon(
          ctx,
          { ...ITEM_DEF[piece.itemId], quantity: 1 },
          px - size / 2,
          drawY - size / 2,
          size,
        );
      }
    }
  }

  captureCheckpoint(): LootCheckpoint {
    return {
      pendingLoots: this.pendingLoots.map((pile) => clonePendingLoot(pile)),
      floorItems: this.floorItems.map(cloneFloorItem),
    };
  }

  /**
   * Drops made after the capture are discarded outright, including piles from
   * mobs the restore is about to revive — leaving them would let the player
   * bank the loot and then kill the same mob again.
   */
  restoreCheckpoint(snapshot: LootCheckpoint): void {
    // Landed rather than replayed: a checkpoint can be captured mid-fall and
    // restored long after, when the animation's own timing no longer means
    // anything. Coming back as an ordinary settled pile is instant, safe, and
    // loses nothing the checkpoint owes the player.
    this.pendingLoots = snapshot.pendingLoots.map((pile) => clonePendingLoot(pile, true));
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
