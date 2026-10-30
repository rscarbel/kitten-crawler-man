/**
 * Conveyors: a named foot and head, which may stand on different storeys or
 * in different places, carrying things between them through the party's
 * exchange record (`PartySplitState.exchange`). The record is the same one
 * whether the party is split or together, so a load sent while together is
 * waiting at the far end exactly as one sent across a split is; the far end
 * shows it whenever its map is built or live.
 *
 * An item conveyor (a dumbwaiter, a chute) takes the first thing it accepts
 * from the crawler at one end and leaves it at the other; at an end with a
 * load waiting, interact takes it. A signal fixture (a bell on a pull) is a
 * conveyor of a flag: working either end raises it at the other, and it
 * stays raised there until a crawler at that end works any conveyor end on
 * its map, which is the ring answered.
 *
 * A storey's own works may claim an end whose presses follow a story of their
 * own: the conveyor then never offers or acts on it, and does only what the
 * works ask of it through the claim.
 */

import type { SoundId } from '../../audio/sounds';
import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import type { ItemId } from '../../core/items/defs/ItemDefs';
import {
  clearExchangeFlag,
  exchangeFlag,
  exchangeFlagSet,
  exchangePoint,
  itemsWaitingAt,
  leaveExchangeItem,
  setExchangeFlag,
  takeExchangeItems,
  takeExchangeItemsOf,
  type ExchangeItem,
  type ExchangeFlagId,
  type ExchangePointId,
  type PartySplitState,
} from '../../core/party/partySplit';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import {
  ITEM_CONVEYOR_KINDS,
  SIGNAL_FIXTURE_KINDS,
  type ConveyorEndId,
  type ConveyorPlacement,
} from '../../map/interiorMechanisms';
import { endStandsIn, type MechanismPlace } from '../../map/town/interiors/roomMechanisms';
import type { TilePoint } from '../../map/town/townPlan';
import { ITEM_ICONS } from '../../ui/icons/itemIcons';
import { drawInteractionPrompt } from '../../ui/InteractionPrompt';
import { worldPalette } from '../../ui/theme/worldInk';

type Crawler = HumanPlayer | CatPlayer;

/** One end of a conveyor that stands on this map. */
interface ConveyorEnd {
  readonly placement: ConveyorPlacement;
  /** Whether a storey's works have claimed it, so presses there are theirs to answer. */
  claimed: boolean;
  readonly end: ConveyorEndId;
  readonly tile: TilePoint;
  /** Where loads sent to this end wait. */
  readonly point: ExchangePointId;
  /** Where loads sent from this end go. */
  readonly farPoint: ExchangePointId;
}

/** The flag a signal fixture raises at `end` when its other end is rung, lowered once a crawler there answers. */
function signalRaisedAt(
  placement: Extract<ConveyorPlacement, { kind: 'signal' }>,
  end: ConveyorEndId,
): ExchangeFlagId {
  return exchangeFlag(`${placement.flag}_${end}`);
}

const OTHER_END: Readonly<Record<ConveyorEndId, ConveyorEndId>> = { foot: 'head', head: 'foot' };

/** Where loads sent to `end` of the conveyor `id` wait. */
export function conveyorEndPoint(id: string, end: ConveyorEndId): ExchangePointId {
  return exchangePoint(`${id}_${end}`);
}

/** How far, in tiles from the crawler's centre to the end's tile centre, an end reaches. */
const END_REACH_TILES = 1.3;
const TILE_CENTRE = 0.5;
const ICON_SIZE_PX = 18;
const ICON_LIFT_PX = 26;
const ICON_BOB_PX = 2;
const ICON_BOB_PERIOD_MS = 1400;
const GLOW_RADIUS_PX = 18;
const SIGNAL_RADIUS_PX = 5;
const SIGNAL_EDGE_PX = 1.5;
const TAU = Math.PI * 2;
const HALF = 0.5;

export interface ConveyorSystemOptions {
  readonly place: MechanismPlace;
  readonly placements: readonly ConveyorPlacement[];
  readonly split: PartySplitState;
  readonly bus: EventBus;
  readonly playSound: (cue: SoundId, at: { readonly x: number; readonly y: number }) => void;
}

function tileCentrePx(tile: TilePoint): { x: number; y: number } {
  return { x: (tile.x + TILE_CENTRE) * TILE_SIZE, y: (tile.y + TILE_CENTRE) * TILE_SIZE };
}

/** An item conveyor's end claimed by a storey's works, worked only as they ask. */
export interface ClaimedItemEnd {
  readonly tile: TilePoint;
  inReach(crawler: Crawler): boolean;
  waiting(): readonly ExchangeItem[];
  /** Moves every load of `item` waiting here into `crawler`'s bag; false when none waits. */
  take(item: ItemId, crawler: Crawler): boolean;
  /** Puts one `item` here to wait, unless one already does. */
  stock(item: ItemId): void;
  /** Takes every load of `item` waiting here out of the world. */
  clear(item: ItemId): void;
  /**
   * Sends one `item` from `crawler`'s bag to someone waiting at the far end,
   * who takes it as it arrives, so nothing is left there; false when the bag
   * holds none.
   */
  sendTaken(item: ItemId, crawler: Crawler): boolean;
}

/** A signal fixture's end claimed by a storey's works, rung only when they ask. */
export interface ClaimedSignalEnd {
  readonly tile: TilePoint;
  inReach(crawler: Crawler): boolean;
  signal(): void;
}

/** The ends of every conveyor that stand on one map. */
export class ConveyorSystem {
  private readonly ends: ConveyorEnd[] = [];
  private readonly split: PartySplitState;
  private readonly bus: EventBus;
  private readonly playSound: ConveyorSystemOptions['playSound'];

  constructor(options: ConveyorSystemOptions) {
    this.split = options.split;
    this.bus = options.bus;
    this.playSound = options.playSound;
    for (const placement of options.placements) {
      for (const end of ['foot', 'head'] as const) {
        const place = placement[end];
        if (!endStandsIn(place, options.place)) continue;
        this.ends.push({
          placement,
          claimed: false,
          end,
          tile: place.tile,
          point: conveyorEndPoint(placement.id, end),
          farPoint: conveyorEndPoint(placement.id, OTHER_END[end]),
        });
      }
    }
  }

  get isEmpty(): boolean {
    return this.ends.length === 0;
  }

  /**
   * Claims the end `end` of the item conveyor `id` for a storey's works, or
   * null when that end does not stand on this map.
   */
  claimItemEnd(id: string, end: ConveyorEndId): ClaimedItemEnd | null {
    const claimed = this.claim(id, end);
    if (claimed === null) return null;
    const placement = claimed.placement;
    if (placement.kind !== 'items') return null;
    const fixture = ITEM_CONVEYOR_KINDS[placement.fixture];
    const at = tileCentrePx(claimed.tile);
    return {
      tile: claimed.tile,
      inReach: (crawler) => this.reaches(crawler, claimed),
      waiting: () => itemsWaitingAt(this.split, claimed.point),
      take: (item, crawler) => {
        const loads = takeExchangeItemsOf(this.split, claimed.point, item);
        if (loads.length === 0) return false;
        for (const load of loads) crawler.inventory.addItem(load.item, load.quantity);
        this.playSound(fixture.arriveCue, at);
        this.answerSignalsHere();
        return true;
      },
      stock: (item) => {
        if (itemsWaitingAt(this.split, claimed.point).some((load) => load.item === item)) return;
        leaveExchangeItem(this.split, { item, quantity: 1, to: claimed.point });
      },
      clear: (item) => {
        takeExchangeItemsOf(this.split, claimed.point, item);
      },
      sendTaken: (item, crawler) => {
        if (!crawler.inventory.removeOne(item)) return false;
        this.reportSent(claimed, placement, item);
        this.answerSignalsHere();
        return true;
      },
    };
  }

  /**
   * Claims the end `end` of the signal fixture `id` for a storey's works, or
   * null when that end does not stand on this map.
   */
  claimSignalEnd(id: string, end: ConveyorEndId): ClaimedSignalEnd | null {
    const claimed = this.claim(id, end);
    if (claimed === null) return null;
    const placement = claimed.placement;
    if (placement.kind !== 'signal') return null;
    return {
      tile: claimed.tile,
      inReach: (crawler) => this.reaches(crawler, claimed),
      signal: () => this.signal(claimed, placement),
    };
  }

  private claim(id: string, end: ConveyorEndId): ConveyorEnd | null {
    const found = this.ends.find(
      (candidate) => candidate.placement.id === id && candidate.end === end,
    );
    if (found === undefined) return null;
    found.claimed = true;
    return found;
  }

  /**
   * A thing that came down into an end's tile: an item conveyor there sends it
   * on as `item`. Returns whether an end took it.
   */
  deliverAt(tile: TilePoint, item: ItemId): boolean {
    const end = this.ends.find(
      (candidate) =>
        candidate.placement.kind === 'items' &&
        candidate.tile.x === tile.x &&
        candidate.tile.y === tile.y,
    );
    if (end?.placement.kind !== 'items') return false;
    this.send(end, end.placement, item);
    return true;
  }

  private send(
    end: ConveyorEnd,
    placement: Extract<ConveyorPlacement, { kind: 'items' }>,
    item: ItemId,
  ): void {
    leaveExchangeItem(this.split, { item, quantity: 1, to: end.farPoint });
    this.reportSent(end, placement, item);
  }

  private reportSent(
    end: ConveyorEnd,
    placement: Extract<ConveyorPlacement, { kind: 'items' }>,
    item: ItemId,
  ): void {
    this.playSound(ITEM_CONVEYOR_KINDS[placement.fixture].sendCue, tileCentrePx(end.tile));
    this.bus.emit('conveyorSent', { conveyor: placement.id, item, to: OTHER_END[end.end] });
  }

  private distanceTo(crawler: Crawler, end: ConveyorEnd): number {
    const centreX = crawler.x / TILE_SIZE + TILE_CENTRE;
    const centreY = crawler.y / TILE_SIZE + TILE_CENTRE;
    return Math.hypot(end.tile.x + TILE_CENTRE - centreX, end.tile.y + TILE_CENTRE - centreY);
  }

  private reaches(crawler: Crawler, end: ConveyorEnd): boolean {
    return this.distanceTo(crawler, end) <= END_REACH_TILES;
  }

  private endInReach(crawler: Crawler): ConveyorEnd | null {
    let best: ConveyorEnd | null = null;
    let bestDistance = END_REACH_TILES;
    for (const end of this.ends) {
      if (end.claimed) continue;
      const distance = this.distanceTo(crawler, end);
      if (distance > bestDistance) continue;
      best = end;
      bestDistance = distance;
    }
    return best;
  }

  /** What interact at `end` would do for `crawler`, or null when nothing. */
  private deedAt(end: ConveyorEnd, crawler: Crawler): string | null {
    const placement = end.placement;
    switch (placement.kind) {
      case 'items':
        if (itemsWaitingAt(this.split, end.point).length > 0) return 'take what came';
        return this.firstSendable(placement.accepts, crawler) === null
          ? null
          : ITEM_CONVEYOR_KINDS[placement.fixture].deed;
      case 'signal':
        return SIGNAL_FIXTURE_KINDS[placement.fixture].deed;
      default: {
        const unreachable: never = placement;
        return unreachable;
      }
    }
  }

  private firstSendable(accepts: readonly ItemId[], crawler: Crawler): ItemId | null {
    return accepts.find((item) => crawler.inventory.countOf(item) > 0) ?? null;
  }

  wouldInteract(crawler: Crawler): boolean {
    const end = this.endInReach(crawler);
    return end !== null && this.deedAt(end, crawler) !== null;
  }

  /** Interact at the end in reach: take a waiting load, send one, or ring. Returns whether it acted. */
  tryInteract(crawler: Crawler): boolean {
    const end = this.endInReach(crawler);
    if (end === null) return false;
    const placement = end.placement;
    const at = tileCentrePx(end.tile);
    switch (placement.kind) {
      case 'items': {
        const waiting = takeExchangeItems(this.split, end.point);
        if (waiting.length > 0) {
          for (const load of waiting) crawler.inventory.addItem(load.item, load.quantity);
          this.playSound(ITEM_CONVEYOR_KINDS[placement.fixture].arriveCue, at);
          this.answerSignalsHere();
          return true;
        }
        const item = this.firstSendable(placement.accepts, crawler);
        if (item === null || !crawler.inventory.removeOne(item)) return false;
        this.send(end, placement, item);
        this.answerSignalsHere();
        return true;
      }
      case 'signal':
        this.signal(end, placement);
        return true;
      default: {
        const unreachable: never = placement;
        return unreachable;
      }
    }
  }

  private signal(
    end: ConveyorEnd,
    placement: Extract<ConveyorPlacement, { kind: 'signal' }>,
  ): void {
    this.answerSignalsHere();
    setExchangeFlag(this.split, signalRaisedAt(placement, OTHER_END[end.end]));
    this.playSound(SIGNAL_FIXTURE_KINDS[placement.fixture].signalCue, tileCentrePx(end.tile));
    this.bus.emit('conveyorSignalled', {
      conveyor: placement.id,
      flag: placement.flag,
      from: end.end,
    });
  }

  /** Lowers every signal raised at an end on this map: a crawler here has worked its conveyors. */
  private answerSignalsHere(): void {
    for (const end of this.ends) {
      if (end.placement.kind !== 'signal') continue;
      clearExchangeFlag(this.split, signalRaisedAt(end.placement, end.end));
    }
  }

  /** The prompt over the end in reach. Returns whether it claimed the prompt slot. */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    crawler: Crawler,
  ): boolean {
    const end = this.endInReach(crawler);
    if (end === null) return false;
    const deed = this.deedAt(end, crawler);
    if (deed === null) return false;
    const left = end.tile.x * TILE_SIZE - camX;
    const top = end.tile.y * TILE_SIZE - camY;
    drawInteractionPrompt(ctx, left, top, TILE_SIZE, top + TILE_SIZE, `to ${deed}`);
    return true;
  }

  /** A waiting load's icon over its end, and a raised signal's mark. */
  renderMarkers(ctx: CanvasRenderingContext2D, camX: number, camY: number, nowMs: number): void {
    const ink = worldPalette.mechanism;
    for (const end of this.ends) {
      const centre = tileCentrePx(end.tile);
      const x = centre.x - camX;
      const bob = Math.sin((nowMs / ICON_BOB_PERIOD_MS) * TAU) * ICON_BOB_PX;
      const y = centre.y - camY - ICON_LIFT_PX + bob;
      const placement = end.placement;
      if (placement.kind === 'signal') {
        if (!exchangeFlagSet(this.split, signalRaisedAt(placement, end.end))) continue;
        ctx.save();
        ctx.fillStyle = ink.signalRaised;
        ctx.strokeStyle = ink.signalEdge;
        ctx.lineWidth = SIGNAL_EDGE_PX;
        ctx.beginPath();
        ctx.arc(x, y, SIGNAL_RADIUS_PX, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        continue;
      }
      const waitingLoads = itemsWaitingAt(this.split, end.point);
      if (waitingLoads.length === 0) continue;
      const waiting = waitingLoads[0];
      ctx.save();
      const glow = ctx.createRadialGradient(x, y, 0, x, y, GLOW_RADIUS_PX);
      glow.addColorStop(0, ink.waitingGlow);
      glow.addColorStop(1, ink.waitingFade);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, GLOW_RADIUS_PX, 0, TAU);
      ctx.fill();
      ITEM_ICONS[waiting.item](ctx, {
        x: x - ICON_SIZE_PX * HALF,
        y: y - ICON_SIZE_PX * HALF,
        w: ICON_SIZE_PX,
        h: ICON_SIZE_PX,
      });
      ctx.restore();
    }
  }
}
