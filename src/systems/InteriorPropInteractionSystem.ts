/**
 * Examine, search and use for a building's placed props: whatever
 * `TOWN_INTERIOR_PROPS[propId].interaction` names, resolved against the
 * scene's own `Conversation` (owned by handle, the same way every other
 * speaker in the room talks) rather than a second dialog surface.
 *
 * `InteriorReadableSystem` stays the mechanism for documents — a ledger, a
 * letter, a price board — paged in `ReadablePanel`. This system is for the
 * shorter interactions beside it: a one-line look at an object, a
 * container's first-search payout, and a flavour use.
 */

import { TILE_SIZE } from '../core/constants';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { Conversation } from '../dialog/Conversation';
import type { BarkLine } from '../dialog/line';
import type { LootSystem } from './LootSystem';
import type { GameMap, PlacedTownInteriorProp } from '../map/GameMap';
import { interiorPropPayoutKey, type TownMemory } from '../core/TownMemory';
import {
  TOWN_INTERIOR_PROPS,
  type TownInteriorExamineId,
  type TownInteriorInteraction,
} from '../sprites/art/townInterior/townInteriorProps';
import { randomInt } from '../utils';
import {
  EXAMINE_LINES,
  SEARCH_TABLES,
  SEARCH_EMPTY_LINE,
  SEARCH_FOUND_LINE,
  SEARCH_NOTHING_FOUND_LINE,
  SHOP_BELL_KEEPER_LINE,
  USE_LINES,
} from '../dialog/scripts/interiorObjects';

const INTERACT_RADIUS_TILES = 1.4;
const INTERACT_RADIUS = TILE_SIZE * INTERACT_RADIUS_TILES;
const TILE_CENTER_OFFSET = 0.5;

/** What pressing interact shows for one placed, interactable prop instance. */
export interface PlacedInteraction {
  readonly placed: PlacedTownInteriorProp;
  readonly interaction: TownInteriorInteraction;
  readonly x: number;
  readonly y: number;
}

/**
 * Tracks which containers have already paid out. In-memory only — scoped to
 * one visit, since this system is rebuilt with the room every time the door
 * opens. A `TownMemory`-backed implementation of this same interface is what
 * makes "first search only" survive across visits; nothing else here has to
 * change to take one.
 */
export interface InteriorPayoutRecord {
  hasPaidOut(id: string): boolean;
  markPaidOut(id: string): void;
}

export class InMemoryInteriorPayoutRecord implements InteriorPayoutRecord {
  private readonly paidOut = new Set<string>();
  hasPaidOut(id: string): boolean {
    return this.paidOut.has(id);
  }
  markPaidOut(id: string): void {
    this.paidOut.add(id);
  }
}

/**
 * The record a real room plays against: backed by `TownMemory.paidOutInteriorProps`,
 * so a first-time drop survives leaving and re-entering the room, and rewinds
 * with the rest of the town's memory on a death.
 *
 * Scoped to one room at construction (`buildingName`/`floor`), matching the
 * scene that builds one fresh per entry — every `id` this record is asked
 * about is a placed prop's own stable id, never a full room key.
 */
export class TownMemoryInteriorPayoutRecord implements InteriorPayoutRecord {
  constructor(
    private readonly memory: TownMemory,
    private readonly buildingName: string,
    private readonly floor: number,
  ) {}

  private key(id: string): string {
    return interiorPropPayoutKey(this.buildingName, this.floor, id);
  }

  hasPaidOut(id: string): boolean {
    return this.memory.paidOutInteriorProps.has(this.key(id));
  }

  markPaidOut(id: string): void {
    this.memory.paidOutInteriorProps.add(this.key(id));
  }
}

const INTERACT_PROMPT_LABEL: Record<TownInteriorInteraction['kind'], string> = {
  examine: 'Examine',
  search: 'Search',
  use: 'Use',
};

export class InteriorPropInteractionSystem {
  private readonly placed: PlacedInteraction[] = [];

  /**
   * The room's own word on an examine, ahead of `EXAMINE_LINES`: null leaves
   * the usual line. For a room a quest changes while it stands, where the
   * usual line describes the room as it was before.
   */
  examineOverride: ((id: TownInteriorExamineId) => BarkLine | null) | null = null;

  /** `null` when the room placed nothing with an interaction — what `BuildingInteriorScene` builds against. */
  static forBuilding(
    map: GameMap,
    payoutRecord: InteriorPayoutRecord,
  ): InteriorPropInteractionSystem | null {
    const system = new InteriorPropInteractionSystem(map, payoutRecord);
    return system.placed.length > 0 ? system : null;
  }

  /**
   * The plain constructor, public so a test can build one against a room
   * with no placed interactables and still exercise `perform` against a
   * hand-built `PlacedInteraction`.
   */
  constructor(
    map: GameMap,
    private readonly payoutRecord: InteriorPayoutRecord,
  ) {
    for (const placedProp of map.placedInteriorProps) {
      const interaction = TOWN_INTERIOR_PROPS[placedProp.propId].interaction;
      if (interaction === undefined) continue;
      this.placed.push({
        placed: placedProp,
        interaction,
        x: placedProp.tile.x * TILE_SIZE,
        y: placedProp.tile.y * TILE_SIZE,
      });
    }
  }

  /** The nearest interactable to `(x, y)` in reach, or `null`. */
  findTarget(x: number, y: number): PlacedInteraction | null {
    let best: PlacedInteraction | null = null;
    let bestDistance = INTERACT_RADIUS;
    for (const candidate of this.placed) {
      const cx = candidate.x + TILE_SIZE * TILE_CENTER_OFFSET;
      const cy = candidate.y + TILE_SIZE * TILE_CENTER_OFFSET;
      const distance = Math.hypot(cx - x, cy - y);
      if (distance > bestDistance) continue;
      best = candidate;
      bestDistance = distance;
    }
    return best;
  }

  /** What the interact prompt should read for `target`. */
  promptFor(target: PlacedInteraction): string {
    return INTERACT_PROMPT_LABEL[target.interaction.kind];
  }

  /**
   * Runs `target`'s interaction: opens the scene's conversation with the
   * right line(s), rolling and dropping loot for a first-time search.
   * `hasKeeperNearby` only matters for the shop bell — it decides whether the
   * bell's own line is followed by someone answering it.
   */
  perform(
    target: PlacedInteraction,
    conversation: Conversation,
    loot: LootSystem,
    activePlayer: HumanPlayer | CatPlayer,
    hasKeeperNearby: boolean,
  ): void {
    if (target.interaction.kind === 'examine') {
      const examineId = target.interaction.id;
      const line = this.examineOverride?.(examineId) ?? EXAMINE_LINES[examineId];
      this.openBark(conversation, target, line);
      return;
    }
    if (target.interaction.kind === 'use') {
      const [first, ...rest] = USE_LINES[target.interaction.id];
      const chained =
        target.interaction.id === 'shop_bell' && hasKeeperNearby
          ? [...rest, SHOP_BELL_KEEPER_LINE]
          : rest;
      this.openBarks(conversation, target, first, ...chained);
      return;
    }
    this.performSearch(target, conversation, loot, activePlayer);
  }

  private performSearch(
    target: PlacedInteraction,
    conversation: Conversation,
    loot: LootSystem,
    activePlayer: HumanPlayer | CatPlayer,
  ): void {
    const id = target.placed.id;
    if (this.payoutRecord.hasPaidOut(id)) {
      this.openBark(conversation, target, SEARCH_EMPTY_LINE);
      return;
    }
    this.payoutRecord.markPaidOut(id);
    const table =
      target.interaction.kind === 'search' ? SEARCH_TABLES[target.interaction.id] : undefined;
    const coins = table === undefined ? 0 : randomInt(table.coinsMin, table.coinsMax);
    if (coins > 0) {
      const centerX = target.x + TILE_SIZE * TILE_CENTER_OFFSET;
      const centerY = target.y + TILE_SIZE * TILE_CENTER_OFFSET;
      // Falls, lands, then auto-collects, like every other loot drop.
      loot.addLoot(centerX, centerY, { coins, items: [] }, activePlayer, false, true, true);
      this.openBark(conversation, target, SEARCH_FOUND_LINE);
    } else {
      this.openBark(conversation, target, SEARCH_NOTHING_FOUND_LINE);
    }
  }

  private openBark(conversation: Conversation, target: PlacedInteraction, line: BarkLine): void {
    this.openBarks(conversation, target, line);
  }

  private openBarks(
    conversation: Conversation,
    target: PlacedInteraction,
    first: BarkLine,
    ...rest: BarkLine[]
  ): void {
    conversation.open({
      lines: [first, ...rest],
      reward: null,
      questRelated: false,
      ending: { kind: 'close', onClosed: () => undefined },
      dismiss: { kind: 'allowed', onDismissed: () => undefined },
      haltsWorld: false,
      // The prop's centre, measured from the player's origin, as `findTarget` measures reach.
      anchor: {
        position: () => ({
          x: target.x + TILE_SIZE * TILE_CENTER_OFFSET,
          y: target.y + TILE_SIZE * TILE_CENTER_OFFSET,
        }),
        talkRangeTiles: INTERACT_RADIUS_TILES,
      },
      locksKeyboard: true,
    });
  }
}
