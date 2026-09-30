/**
 * What a Briar Hollow questline wants the player to do with their hands right
 * now, beyond talking to somebody: the seam between the quest systems
 * (`VillageQuestSystem`, `BlueprintsQuestSystem`), which decide the step, and
 * `VillageQuestGuide`, which picks the exact tree, rock, station or wall
 * segment and draws the highlight, the tool icon, the down-arrow and the
 * caption over it.
 *
 * Rebuilt every frame from the quest's state, like a tracker entry, so it
 * cannot go stale. `null` means no in-world guidance: either nothing is
 * needed or the step is a conversation, which the villager's own marker covers.
 */

import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import { partyCount, type ResourceCost } from '../../core/partyResources';
import type { TilePoint } from '../../map/town/townPlan';
import type { TrackerTarget } from '../questTracker';
import { BOARDS_PER_WOOD, ROPE_PER_WOOD } from './services/woodProcessing';

/** A count toward a target, shown as `${have}/${target}` under the caption. */
export interface GuidanceProgress {
  readonly have: number;
  readonly target: number;
}

export type ProcessingStationId = 'saw' | 'rope_walk';

export interface StationGuidance {
  readonly station: ProcessingStationId;
  readonly progress: GuidanceProgress;
}

/** A rectangle of tiles, top-left inclusive. */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type QuestGuidance =
  /**
   * Chop wood in the lumber yard. Until the player reaches the yard, the guide
   * only waypoints the yard itself; once inside, it highlights one grove tree
   * (the centre one first; a neighbour when that one falls; a forced regrow
   * of the centre tree when the grove is bare).
   */
  | { readonly kind: 'chop'; readonly progress: GuidanceProgress }
  /** Mine stone in the quarry: the upper-left rock first, then the nearest standing one. */
  | { readonly kind: 'mine'; readonly progress: GuidanceProgress }
  /** Work the named stations; a station already at its target is left out. */
  | { readonly kind: 'process'; readonly stations: readonly StationGuidance[] }
  /** Build a trebuchet; the zones are suggestions washed in light green, not requirements. */
  | { readonly kind: 'build_trebuchet'; readonly zones: readonly TileRect[] }
  /** Load the trebuchet whose top-left tile is `at`. */
  | { readonly kind: 'load_trebuchet'; readonly at: TilePoint }
  /** Upgrade any fence segment to a wooden wall; the guide marks the one nearest the player. */
  | { readonly kind: 'upgrade_wall' }
  /** Rebuild the broken bell tower. */
  | { readonly kind: 'repair_bell' }
  /** Rebuild a section of Merrit's pasture fence: the nearest unbuilt one, as the tiles it runs along. */
  | {
      readonly kind: 'fence_section';
      readonly tiles: readonly TilePoint[];
      readonly progress: GuidanceProgress;
    }
  /** Take Merrit's scythe down from the pegs on the barn wall at `at`. */
  | { readonly kind: 'scythe'; readonly at: TilePoint }
  /** Harvest grain in `field` with the scythe. */
  | {
      readonly kind: 'grain_field';
      readonly field: TileRect;
      readonly progress: GuidanceProgress;
    }
  /**
   * Go back for Midge, who has stopped where she is because the party got too
   * far ahead. She is a character and wears her own marker, so the guide
   * draws nothing over her; `at` is her tile, for the arrow.
   */
  | { readonly kind: 'lead_midge'; readonly at: TilePoint }
  /**
   * Lead Midge along the road toward Wendell's pasture, `yard`: to the
   * waypoint `at`, which can be walked to in a straight line from the one
   * before it. `ahead` holds the next few waypoints, nearest first (empty
   * when `at` is the pasture's own gate), and `trail` the road's tiles from
   * where the escort has got to on through the waypoint after `at`.
   */
  | {
      readonly kind: 'escort_waypoint';
      readonly at: TilePoint;
      readonly ahead: readonly TilePoint[];
      readonly trail: readonly TilePoint[];
      readonly yard: TileRect;
    }
  /** Lead Midge into Wendell's pasture, `yard`. */
  | { readonly kind: 'pasture'; readonly yard: TileRect }
  /** Upgrade `station`, which stands on `footprint`, from Tikka's blueprints. */
  | {
      readonly kind: 'station_upgrade';
      readonly station: ProcessingStationId;
      readonly footprint: TileRect;
    }
  /**
   * Walk to a town building across the overworld and speak with someone
   * inside — the step is a conversation, but the speaker is behind a door
   * the village guide cannot see through. `door` is the doorway's own
   * beacon target (`doorwayBeaconTarget`), which the scene's objective beacon
   * and the tracker arrow point at; the guide itself draws nothing for it.
   */
  | {
      readonly kind: 'town_building';
      readonly buildingName: string;
      /** Who the party is going to see there, for a caption; null when it is the building itself. */
      readonly residentName: string | null;
      readonly door: TrackerTarget;
    };

/** The guidance kinds a quest system can hand the guide with its target already chosen. */
export type PointedGuidance = Extract<
  QuestGuidance,
  {
    readonly kind:
      | 'fence_section'
      | 'scythe'
      | 'grain_field'
      | 'lead_midge'
      | 'escort_waypoint'
      | 'pasture'
      | 'station_upgrade'
      | 'town_building';
  }
>;

const HALF = 0.5;

/** The tile in the middle of a run of tiles, the stable point a highlight and an arrow sit on. */
function midTile(tiles: readonly TilePoint[]): TilePoint | null {
  if (tiles.length === 0) return null;
  return tiles[Math.floor(tiles.length * HALF)];
}

/** The bottom row of a rectangle the guide highlights itself, as a target as wide as the rectangle. */
function selfMarkedRectTarget(rect: TileRect): TrackerTarget {
  return {
    x: rect.x,
    y: rect.y + rect.height - 1,
    widthTiles: rect.width,
    wearsOwnMarker: true,
  };
}

/**
 * Where the tracker arrow and the minimap chevron point for a
 * {@link PointedGuidance}. Places the guide highlights itself (a fence run, the
 * scythe pegs, a station, the whole grain field, the whole pasture, a
 * waypoint on Midge's road) are
 * marked `wearsOwnMarker` so the scene's own beacon does not stand over them a
 * second time; the town door takes the scene's beacon.
 */
export function pointedGuidanceTarget(guidance: PointedGuidance): TrackerTarget | null {
  switch (guidance.kind) {
    case 'fence_section': {
      const tile = midTile(guidance.tiles);
      return tile === null ? null : { x: tile.x, y: tile.y, wearsOwnMarker: true };
    }
    case 'scythe':
      return { x: guidance.at.x, y: guidance.at.y, wearsOwnMarker: true };
    case 'grain_field':
      return selfMarkedRectTarget(guidance.field);
    case 'lead_midge':
    case 'escort_waypoint':
      return { x: guidance.at.x, y: guidance.at.y, wearsOwnMarker: true };
    case 'pasture':
      return selfMarkedRectTarget(guidance.yard);
    case 'station_upgrade':
      return selfMarkedRectTarget(guidance.footprint);
    case 'town_building':
      return guidance.door;
  }
}

/**
 * A resource shortfall while trying to build, repair or upgrade something:
 * mine the stone it is short of, process what wood is held, or chop for more.
 * Shared by every Briar Hollow questline, so "you can't afford this" always
 * sends the player to the same place for the same shortfall.
 */
export function shortfallGuidance(
  human: HumanPlayer,
  cat: CatPlayer,
  cost: ResourceCost,
): QuestGuidance {
  const stoneHeld = partyCount(human, cat, 'stone');
  const stoneNeeded = Math.max(0, (cost.stone ?? 0) - stoneHeld);
  if (stoneNeeded > 0) {
    return { kind: 'mine', progress: { have: stoneHeld, target: cost.stone ?? 0 } };
  }
  const boards = partyCount(human, cat, 'wood_board');
  const rope = partyCount(human, cat, 'rope');
  const boardsNeeded = Math.max(0, (cost.wood_board ?? 0) - boards);
  const ropeNeeded = Math.max(0, (cost.rope ?? 0) - rope);
  const woodNeeded =
    Math.ceil(boardsNeeded / BOARDS_PER_WOOD) + Math.ceil(ropeNeeded / ROPE_PER_WOOD);
  if (woodNeeded > 0 && partyCount(human, cat, 'wood') === 0) {
    return { kind: 'chop', progress: { have: 0, target: woodNeeded } };
  }
  const stations: StationGuidance[] = [];
  if (boardsNeeded > 0) {
    stations.push({ station: 'saw', progress: { have: boards, target: cost.wood_board ?? 0 } });
  }
  if (ropeNeeded > 0) {
    stations.push({ station: 'rope_walk', progress: { have: rope, target: cost.rope ?? 0 } });
  }
  return { kind: 'process', stations };
}
