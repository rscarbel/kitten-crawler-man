/**
 * The town's own furniture, as Journal entries, until the player has been to it.
 *
 * A first arrival in the Over City drops the party in the middle of a plaza with
 * sixteen buildings, a notice board, a fortune teller, a market and three
 * questlines, and says nothing about any of it. The questlines announce
 * themselves — that is what the beacons and the quest markers are for — but the
 * *services* do not: nothing tells you the town has a shop, or that the man in
 * the barracks will tell you what is worth doing, or that there is a circus out
 * past the walls at all.
 *
 * So each of those gets a Journal row with a direction on it, and the row
 * disappears the first time the player stands near the thing. No new state
 * machine: a stop is a target and a latch.
 *
 * Deliberately **not** a list of the quest givers. Shady and GumGum already have
 * rows of their own from `BountySystem` and `MurderMysteryQuestSystem`, and a
 * guide that repeated them would show the player the same objective twice with
 * two different names on it.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { GameSystem, SystemContext } from './GameSystem';
import type { TrackerEntry, TrackerTarget } from './questTracker';
import type { JournalProgress } from '../core/JournalProgress';

/** How close counts as "you have found it". A little over a conversation's reach. */
const VISIT_RADIUS_TILES = 3;

/** The Journal name every guide row carries, so they group together on sight. */
const GUIDE_QUEST_NAME = 'Town Guide';

/** Ids are stable across sessions — they are what a checkpoint's latches name. */
type GuideStopId = 'notice_board' | 'general_store' | 'safe_room';

interface GuideStop {
  readonly id: GuideStopId;
  readonly objective: string;
  readonly hint: string;
  readonly target: TrackerTarget;
  readonly visitRadiusTiles: number;
}

/** The general store's name in the `TownPlan`. A rename here breaks the row, not the town. */
const GENERAL_STORE_NAME = 'General Store';

export class TownGuideSystem implements GameSystem {
  private readonly stops: ReadonlyArray<GuideStop>;

  /**
   * `noticeBoardTile` is passed in rather than looked up: the board's tile is
   * owned by `TownPropSystem`, which the scene builds alongside this and which
   * is the only thing that knows where its own props ended up.
   *
   * The visit latches live on `progress` rather than on this object, because
   * this object is thrown away and rebuilt every time the player walks through
   * a door — see `JournalProgress`.
   */
  constructor(
    gameMap: GameMap,
    noticeBoardTile: { x: number; y: number } | null,
    private readonly progress: JournalProgress,
  ) {
    const stops: GuideStop[] = [];

    if (noticeBoardTile !== null) {
      stops.push({
        id: 'notice_board',
        objective: 'Read the town notice board',
        hint: 'On the plaza. Bounties, gossip, and whatever the town is worried about.',
        target: noticeBoardTile,
        visitRadiusTiles: VISIT_RADIUS_TILES,
      });
    }

    const store = gameMap.buildingEntries.find((entry) => entry.name === GENERAL_STORE_NAME);
    if (store !== undefined) {
      stops.push({
        id: 'general_store',
        objective: 'Visit the General Store',
        hint: 'Potions and supplies. Walk into the doorway to go in.',
        target: store.doorTile,
        visitRadiusTiles: VISIT_RADIUS_TILES,
      });
    }

    // Found by kind, not by name: the town's safe room is whichever building is
    // the one with a kitchen in it, and that is what `BuildingInteriorScene`
    // itself keys Mordecai and the Bopcas off.
    const safeRoom = gameMap.buildingEntries.find((entry) => entry.type === 'restaurant');
    if (safeRoom !== undefined) {
      stops.push({
        id: 'safe_room',
        objective: `Find Mordecai in ${safeRoom.name}`,
        hint: 'He cooks, he saves your progress, and he will tell you what is worth doing.',
        target: safeRoom.doorTile,
        visitRadiusTiles: VISIT_RADIUS_TILES,
      });
    }

    // No circus stop, though the plan called for one: `CircusQuestSystem`'s own
    // first entry already says "Find the Tsarina at the circus" and points at
    // the same tile, and two rows sending the player to one place with two
    // different names on them is worse guidance than one.

    this.stops = stops;
  }

  update(ctx: SystemContext): void {
    const tileX = ctx.active.x / TILE_SIZE;
    const tileY = ctx.active.y / TILE_SIZE;
    for (const stop of this.stops) {
      if (this.progress.visitedGuideStops.has(stop.id)) continue;
      const distance = Math.hypot(stop.target.x - tileX, stop.target.y - tileY);
      if (distance <= stop.visitRadiusTiles) this.progress.visitedGuideStops.add(stop.id);
    }
  }

  /**
   * One row per stop the player has not been to yet. Nothing once the town has
   * been walked — the Journal is for what is outstanding, and a permanent list
   * of places already visited would push the real questlines off the panel.
   */
  trackerEntries(): ReadonlyArray<TrackerEntry> {
    const entries: TrackerEntry[] = [];
    for (const stop of this.stops) {
      if (this.progress.visitedGuideStops.has(stop.id)) continue;
      entries.push({
        id: `town_guide_${stop.id}`,
        name: GUIDE_QUEST_NAME,
        status: 'available',
        objective: stop.objective,
        hint: stop.hint,
        target: stop.target,
      });
    }
    return entries;
  }
}
