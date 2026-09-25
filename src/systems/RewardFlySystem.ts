/**
 * Screen-space fly-to-HUD animation for coins and items: a handful of coin
 * sprites arcing from where they were earned to the coin readout, and item
 * icons arcing to the bag button with a landing bounce and a rising label.
 *
 * Coins and inventory changes are already applied the moment they are earned
 * — this system only draws the trip from there to the HUD. `hold()` returns a
 * token; grants enqueued while it's outstanding queue under that token alone
 * and fly (or, on `cancel`, vanish) only for that token's own
 * `release`/`cancel` — never another caller's overlapping hold — so a loot-box
 * reveal and an unrelated chest dialog can be open at once without one's
 * teardown reaching into the other's queue.
 */

import { ITEM_DEF } from '../core/ItemDefs';
import type { ItemId } from '../core/ItemDefs';
import { drawItemIcon } from '../ui/InventoryPanel';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';

export interface FlyTargets {
  coinX: number;
  coinY: number;
  bagRect: { x: number; y: number; w: number; h: number };
}

/** How many coin sprites a single grant spawns, before capping. */
const COINS_PER_SPRITE = 8;
const MIN_COIN_SPRITES = 1;
const MAX_COIN_SPRITES = 10;
/** Frames between one coin sprite launching and the next, within one grant. */
const COIN_STAGGER_FRAMES = 3;
const COIN_FLY_DURATION_FRAMES = 32;
const COIN_RADIUS = 5;
const COIN_ARC_HEIGHT_MIN = 30;
const COIN_ARC_HEIGHT_VARIANCE = 40;
const COIN_SPAWN_JITTER_PX = 10;
/** Centres `Math.random() - this` on zero, for a jitter that can land either side. */
const JITTER_CENTER_FRACTION = 0.5;
const COIN_FILL = '#facc15';
const COIN_EDGE = '#b45309';
/** How long the coin counter keeps pulsing after the last coin lands. */
const COIN_PULSE_DECAY_FRAMES = 14;

/** Frames between one queued item launching and the next. */
const ITEM_STAGGER_FRAMES = 10;
const ITEM_FLY_DURATION_FRAMES = 40;
const ITEM_ICON_SIZE = 30;
const ITEM_ARC_HEIGHT = 60;
/** How long the bag button keeps its squash-bounce after an item lands. */
const BAG_BOUNCE_DECAY_FRAMES = 16;
const LABEL_RISE_DURATION_FRAMES = 50;
const LABEL_RISE_PX = 34;
/** Fraction of a flight's own duration into which its fade-out is compressed. */
const FLIGHT_FADE_START_FRACTION = 0.85;
/** Fraction of a label's own rise into which its fade-out is compressed. */
const LABEL_FADE_START_FRACTION = 0.6;
const COIN_EDGE_WIDTH = 1.5;
/** How much a flying item shrinks over its final fade, as a fraction of its size. */
const ITEM_LANDING_SHRINK = 0.4;

interface FlyingCoin {
  fromX: number;
  fromY: number;
  value: number;
  age: number;
  delay: number;
  arcHeight: number;
}

interface FlyingItem {
  itemId: ItemId;
  name: string;
  fromX: number;
  fromY: number;
  age: number;
  delay: number;
}

interface RisingLabel {
  text: string;
  x: number;
  y: number;
  age: number;
}

interface HeldCoinGrant {
  amount: number;
  fromX: number;
  fromY: number;
}

interface HeldItemGrant {
  itemId: ItemId;
  name: string;
  fromX: number;
  fromY: number;
}

/**
 * An outstanding `hold()`. Opaque to callers — its only use is being handed
 * back to `release()`/`cancel()` — so each holder's queue stays isolated from
 * every other holder's, however their holds happen to overlap in time.
 */
export interface RewardFlyHold {
  readonly id: number;
}

interface HeldBucket {
  coins: HeldCoinGrant[];
  items: HeldItemGrant[];
}

export class RewardFlySystem {
  private coins: FlyingCoin[] = [];
  private items: FlyingItem[] = [];
  private labels: RisingLabel[] = [];

  private nextHoldId = 1;
  /**
   * Every hold currently outstanding, most recent last. An `enqueue*` call
   * with no explicit hold attributes to whichever is last here — the
   * innermost hold active at the time — so a caller that never sees another
   * system's hold still queues correctly without having to pass one.
   */
  private activeHolds: RewardFlyHold[] = [];
  /** Each hold's own queue, keyed by id — never shared, so cancelling one can never touch another's. */
  private heldGrants = new Map<number, HeldBucket>();

  /** Items already spawned but not yet landed — the source of stagger delay. */
  private inFlightItemCount = 0;

  private pendingCoinTotal = 0;
  private coinPulseFrames = 0;
  private bagBounceFrames = 0;

  /**
   * Queue every grant made until the matching `release()`/`cancel()`, rather
   * than flying it immediately. Returns a handle identifying this hold and no
   * other — pass it back to `release`/`cancel`, or to `enqueueCoins`/
   * `enqueueItem` directly when a grant might otherwise land under a
   * different, unrelated hold that happens to be active at the same time.
   */
  hold(): RewardFlyHold {
    const handle: RewardFlyHold = { id: this.nextHoldId++ };
    this.activeHolds.push(handle);
    this.heldGrants.set(handle.id, { coins: [], items: [] });
    return handle;
  }

  /** Flushes exactly this hold's own queued grants, flying them now. */
  release(handle: RewardFlyHold): void {
    const bucket = this.takeBucket(handle);
    if (!bucket) return;
    for (const grant of bucket.coins) this.spawnCoins(grant.amount, grant.fromX, grant.fromY);
    for (const grant of bucket.items) {
      this.spawnItem(grant.itemId, grant.name, grant.fromX, grant.fromY);
    }
  }

  /**
   * Drops exactly this hold's own queued grants without flying them — for a
   * reward overlay that is discarded rather than dismissed (a checkpoint
   * restore rewinding a chest that was never actually opened). Untouched by,
   * and never touches, any other hold outstanding at the same time.
   */
  cancel(handle: RewardFlyHold): void {
    this.takeBucket(handle);
  }

  /** Removes and returns a hold's bucket, dropping it from the active list either way. */
  private takeBucket(handle: RewardFlyHold): HeldBucket | undefined {
    const idx = this.activeHolds.indexOf(handle);
    if (idx !== -1) this.activeHolds.splice(idx, 1);
    const bucket = this.heldGrants.get(handle.id);
    this.heldGrants.delete(handle.id);
    return bucket;
  }

  /** The bucket a new grant lands in: the explicit hold if given, else the innermost active one, else none (fly now). */
  private bucketFor(explicit: RewardFlyHold | undefined): HeldBucket | null {
    const innermost =
      this.activeHolds.length > 0 ? this.activeHolds[this.activeHolds.length - 1] : undefined;
    const handle = explicit ?? innermost;
    if (handle === undefined) return null;
    return this.heldGrants.get(handle.id) ?? null;
  }

  enqueueCoins(amount: number, fromX: number, fromY: number, hold?: RewardFlyHold): void {
    if (amount <= 0) return;
    const bucket = this.bucketFor(hold);
    if (bucket) {
      bucket.coins.push({ amount, fromX, fromY });
      return;
    }
    this.spawnCoins(amount, fromX, fromY);
  }

  enqueueItem(
    itemId: ItemId,
    name: string,
    fromX: number,
    fromY: number,
    hold?: RewardFlyHold,
  ): void {
    const bucket = this.bucketFor(hold);
    if (bucket) {
      bucket.items.push({ itemId, name, fromX, fromY });
      return;
    }
    this.spawnItem(itemId, name, fromX, fromY);
  }

  /**
   * Drops every in-flight and held animation without paying out or clawing
   * back anything — coins/items are already applied the instant they're
   * earned, so this only ever discards a picture in progress. Called on a
   * scene teardown so a held grant from a scene that's going away can never
   * surface later and leave the next scene's coin counter reading low.
   */
  reset(): void {
    this.coins = [];
    this.items = [];
    this.labels = [];
    this.activeHolds = [];
    this.heldGrants.clear();
    this.inFlightItemCount = 0;
    this.pendingCoinTotal = 0;
    this.coinPulseFrames = 0;
    this.bagBounceFrames = 0;
  }

  private spawnCoins(amount: number, fromX: number, fromY: number): void {
    const count = Math.min(
      MAX_COIN_SPRITES,
      Math.max(MIN_COIN_SPRITES, Math.round(amount / COINS_PER_SPRITE)),
    );
    this.pendingCoinTotal += amount;
    const base = Math.floor(amount / count);
    let remainder = amount - base * count;
    for (let i = 0; i < count; i++) {
      // The remainder is folded into the first few sprites rather than the
      // last, so the pulse still fires (and the tally still lands on the
      // right number) even if only one sprite makes it before a scene change.
      const value = remainder > 0 ? base + 1 : base;
      if (remainder > 0) remainder--;
      this.coins.push({
        fromX: fromX + (Math.random() - JITTER_CENTER_FRACTION) * COIN_SPAWN_JITTER_PX,
        fromY: fromY + (Math.random() - JITTER_CENTER_FRACTION) * COIN_SPAWN_JITTER_PX,
        value,
        age: 0,
        delay: i * COIN_STAGGER_FRAMES,
        arcHeight: COIN_ARC_HEIGHT_MIN + Math.random() * COIN_ARC_HEIGHT_VARIANCE,
      });
    }
  }

  private spawnItem(itemId: ItemId, name: string, fromX: number, fromY: number): void {
    this.items.push({
      itemId,
      name,
      fromX,
      fromY,
      age: 0,
      delay: this.inFlightItemCount * ITEM_STAGGER_FRAMES,
    });
    this.inFlightItemCount++;
  }

  /** Advance every animation. Call once per frame regardless of hold state. */
  update(): void {
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      coin.age++;
      if (coin.age >= coin.delay + COIN_FLY_DURATION_FRAMES) {
        this.pendingCoinTotal = Math.max(0, this.pendingCoinTotal - coin.value);
        this.coinPulseFrames = COIN_PULSE_DECAY_FRAMES;
        this.coins[i] = this.coins[this.coins.length - 1];
        this.coins.pop();
      }
    }

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.age++;
      if (item.age >= item.delay + ITEM_FLY_DURATION_FRAMES) {
        this.bagBounceFrames = BAG_BOUNCE_DECAY_FRAMES;
        this.inFlightItemCount = Math.max(0, this.inFlightItemCount - 1);
        this.items[i] = this.items[this.items.length - 1];
        this.items.pop();
        // The label's target position is stamped in `render`, which knows the
        // bag rect this frame; land it invisibly here and let render place it.
        this.labels.push({ text: `+${item.name}`, x: 0, y: 0, age: 0 });
      }
    }

    for (let i = this.labels.length - 1; i >= 0; i--) {
      this.labels[i].age++;
      if (this.labels[i].age >= LABEL_RISE_DURATION_FRAMES) {
        this.labels[i] = this.labels[this.labels.length - 1];
        this.labels.pop();
      }
    }

    if (this.coinPulseFrames > 0) this.coinPulseFrames--;
    if (this.bagBounceFrames > 0) this.bagBounceFrames--;
  }

  /** Coin amount not yet visually landed — subtract from a displayed total so it ticks up as sprites arrive. */
  pendingCoinAmount(): number {
    return this.pendingCoinTotal;
  }

  /** 0 (settled) to 1 (just landed) — drive a brief scale/glow pulse on the coin counter. */
  coinCounterPulse(): number {
    return this.coinPulseFrames / COIN_PULSE_DECAY_FRAMES;
  }

  /** 0 (settled) to 1 (just landed) — drive a squash-bounce on the bag button. */
  bagBouncePulse(): number {
    return this.bagBounceFrames / BAG_BOUNCE_DECAY_FRAMES;
  }

  render(ctx: CanvasRenderingContext2D, targets: FlyTargets): void {
    const bagCenterX = targets.bagRect.x + targets.bagRect.w / 2;
    const bagCenterY = targets.bagRect.y + targets.bagRect.h / 2;

    ctx.save();
    for (const coin of this.coins) {
      const t = (coin.age - coin.delay) / COIN_FLY_DURATION_FRAMES;
      if (t < 0 || t > 1) continue;
      const x = lerp(coin.fromX, targets.coinX, t);
      const arcedY = lerp(coin.fromY, targets.coinY, t) - Math.sin(t * Math.PI) * coin.arcHeight;
      ctx.globalAlpha =
        t > FLIGHT_FADE_START_FRACTION ? (1 - t) / (1 - FLIGHT_FADE_START_FRACTION) : 1;
      ctx.fillStyle = COIN_FILL;
      ctx.strokeStyle = COIN_EDGE;
      ctx.lineWidth = COIN_EDGE_WIDTH;
      ctx.beginPath();
      ctx.arc(x, arcedY, COIN_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    for (const item of this.items) {
      const t = (item.age - item.delay) / ITEM_FLY_DURATION_FRAMES;
      if (t < 0 || t > 1) continue;
      const x = lerp(item.fromX, bagCenterX, t) - ITEM_ICON_SIZE / 2;
      const arcedY =
        lerp(item.fromY, bagCenterY, t) -
        Math.sin(t * Math.PI) * ITEM_ARC_HEIGHT -
        ITEM_ICON_SIZE / 2;
      const scale =
        t > FLIGHT_FADE_START_FRACTION
          ? 1 -
            ((t - FLIGHT_FADE_START_FRACTION) / (1 - FLIGHT_FADE_START_FRACTION)) *
              ITEM_LANDING_SHRINK
          : 1;
      ctx.save();
      ctx.translate(x + ITEM_ICON_SIZE / 2, arcedY + ITEM_ICON_SIZE / 2);
      ctx.scale(scale, scale);
      ctx.translate(-ITEM_ICON_SIZE / 2, -ITEM_ICON_SIZE / 2);
      drawItemIcon(ctx, { ...ITEM_DEF[item.itemId], quantity: 1 }, 0, 0, ITEM_ICON_SIZE, 1);
      ctx.restore();
    }

    for (const label of this.labels) {
      if (label.x === 0 && label.y === 0) {
        label.x = bagCenterX;
        label.y = targets.bagRect.y;
      }
      const t = label.age / LABEL_RISE_DURATION_FRAMES;
      const alpha =
        t > LABEL_FADE_START_FRACTION
          ? Math.max(0, 1 - (t - LABEL_FADE_START_FRACTION) / (1 - LABEL_FADE_START_FRACTION))
          : 1;
      drawText(ctx, label.text, {
        x: label.x,
        y: label.y - t * LABEL_RISE_PX,
        align: 'center',
        ...TEXT_PRESETS.success,
        color: `rgba(74,222,128,${alpha})`,
      });
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
