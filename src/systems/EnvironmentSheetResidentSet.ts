/**
 * A floor's painted environment sheets as resident sets: each building's
 * sheets held by distance from the party, everything else the floor paints
 * held for the whole visit.
 *
 * A building wears two sheets. Its still frame is placed over its art and held
 * well ahead of the camera, because one let go and walked back to is a
 * building missing for the frames its repaint takes. Its life row (lit
 * windows, smoke, glow) is most of its bytes and is held only while in view;
 * a building without it draws still, never missing. Within its ring a sheet is
 * touched on every decision and, if never painted or let go, asked for
 * nearest first, so it lands before the camera reaches it. Past its release
 * ring it is let go within a fifth of a second (`RELEASED_GRACE_FRAMES`).
 *
 * Every other sheet a floor's groups paint (street furniture, trees, rocks,
 * the props every floor carries) is shared by the whole floor, so it is
 * placed over the whole map and always held. Ground materials and the sheets
 * only an interior paints are not in a set: chunks touch the materials they
 * draw, and a scene asking for a sheet the idle sweep let go queues its
 * repaint behind its arrival card, so the sweep alone is right for them.
 */

import type { AssetGroup } from '../core/spriteAssets/assetGroups';
import { getSpriteFootprintByKey, type SpriteKey } from '../core/spriteAssets/SpriteLoader';
import {
  environmentSheetState,
  paintEnvironmentArtFor,
  releaseEnvironmentSheet,
  wantEnvironmentSheet,
} from '../map/environmentArtCache';
import { SPRITE_BUILDING, type TileContent } from '../map/tileTypes';
import type { TileRect } from '../map/town/townPlan';
import {
  BUILDING_KEYS,
  buildingLifeKeyOf,
  buildingLifeKeys,
  buildingSheetsNotYetQueued,
  forgetWaitingBuildingSheet,
  wantBuildingSheet,
} from '../sprites/buildinggen/runtimeBuildingSheets';
import { plannedEnvironmentSheetSizes } from '../sprites/sheets/environmentSheets';
import type {
  ResidentPlacement,
  ResidentSet,
  ResidentUrgency,
  ResidentWarmth,
} from './WorldResidency';

/** How far ahead of coming into view a set holds its sheets. */
export interface SheetRing {
  /** Seconds of fastest walk; see `ResidentSet.leadSeconds`. */
  readonly leadSeconds: number;
  readonly releaseHysteresisTiles: number;
}

/**
 * Seconds of fastest walk a facade's still frame is held ahead of coming into
 * view.
 *
 * Measured headless on a 3×3 grid of floor 3's town with every block's
 * facades its own (135 sheets), the hardest case a bigger floor brings: at
 * the cache's paced budget a facade takes 7–25 frames to paint at node's
 * canvas cost, 13 on average. Walked cold at the fastest walk along every
 * row and column of blocks, each facade asked for nearest first as it came
 * within the ring, a one-second lead left 12 facades unpainted as they came
 * into view and a second and a half left none. Two seconds keeps a margin
 * for paint costs above node's. A longer lead buys nothing once facades
 * enter view faster than they paint: at twice node's cost no lead up to
 * five seconds came out clean.
 */
const FACADE_LEAD_SECONDS = 2;

/**
 * Tiles past the hold ring a facade must be before it is released: about a
 * second of the fastest walk, so a party pacing on the edge of the ring does
 * not let go of a facade and paint it again every few steps.
 */
const FACADE_RELEASE_HYSTERESIS_TILES = 10;

export const FACADE_RING: SheetRing = {
  leadSeconds: FACADE_LEAD_SECONDS,
  releaseHysteresisTiles: FACADE_RELEASE_HYSTERESIS_TILES,
};

/**
 * Seconds of fastest walk a facade's life row is held ahead of coming into
 * view: none, so a life row is resident only while its building is in view.
 * A row paints in 1–3 frames of the cache's paced budget at node's cost (it
 * may wait behind a facade, up to 25), and a building whose row has not
 * landed only stands still for those frames. Held any further out, the life
 * rows of a dense city of buildings with art of their own outgrow the sheet
 * budget on a 1080p view.
 */
const FACADE_LIFE_LEAD_SECONDS = 0;

/** Tiles past the life ring a life row must be before it is let go: a few steps' worth. */
const FACADE_LIFE_RELEASE_HYSTERESIS_TILES = 3;

export const FACADE_LIFE_RING: SheetRing = {
  leadSeconds: FACADE_LIFE_LEAD_SECONDS,
  releaseHysteresisTiles: FACADE_LIFE_RELEASE_HYSTERESIS_TILES,
};

const STILL_KEYS: ReadonlySet<string> = new Set(BUILDING_KEYS);
const LIFE_KEYS: ReadonlySet<string> = new Set(buildingLifeKeys());

/** Whether a sheet is placed by the buildings that wear it rather than over the whole floor. */
export function isPlacedSheetKey(key: string): boolean {
  return STILL_KEYS.has(key) || LIFE_KEYS.has(key);
}

/** Where a floor's sheets are needed, split by the ring that holds them. */
export interface EnvironmentSheetPlacements {
  /** Facades' still frames over their buildings, and every floor-wide sheet over the map. */
  readonly still: ResidentPlacement<string>[];
  /** Facades' life rows over their buildings. */
  readonly life: ResidentPlacement<string>[];
}

/**
 * Where each sheet the given groups paint is needed on a map: each building's
 * sheets over the art of every building wearing them, every other sheet over
 * the whole map. A building sheet nobody wears is placed nowhere, so nothing
 * asks for it. For the game and for the gate that measures a floor's working
 * set.
 */
export function environmentSheetPlacements(
  structure: ReadonlyArray<ReadonlyArray<TileContent>>,
  groups: ReadonlyArray<AssetGroup>,
): EnvironmentSheetPlacements {
  const planned = new Map<string, SpriteKey>(
    plannedEnvironmentSheetSizes(groups).map((sheet) => [sheet.key, sheet.key]),
  );
  const rows = structure.length;
  const cols = structure[0]?.length ?? rows;
  const wholeMap: TileRect = { x: 0, y: 0, w: cols, h: rows };
  const still: ResidentPlacement<string>[] = [];
  const life: ResidentPlacement<string>[] = [];
  for (const key of planned.values()) {
    if (!isPlacedSheetKey(key)) still.push({ entry: key, area: wholeMap });
  }
  for (let y = 0; y < rows; y++) {
    const row = structure[y];
    for (let x = 0; x < row.length; x++) {
      const tile = row[x];
      if (tile.type !== SPRITE_BUILDING || tile.spriteKey === undefined) continue;
      const key = planned.get(tile.spriteKey);
      if (key === undefined) continue;
      const footprint = getSpriteFootprintByKey(key);
      if (footprint === undefined) continue;
      const area = { x: x + footprint.dx, y: y + footprint.dy, w: footprint.w, h: footprint.h };
      still.push({ entry: key, area });
      const lifeKey = buildingLifeKeyOf(key);
      if (lifeKey !== undefined && planned.has(lifeKey)) life.push({ entry: lifeKey, area });
    }
  }
  return { still, life };
}

export class EnvironmentSheetResidentSet implements ResidentSet<string> {
  readonly leadSeconds: number;
  readonly releaseHysteresisTiles: number;
  /** A sheet no decision has reached is not asked for; the sweep takes one painted anyway. */
  readonly entriesStartHeld = false;
  private readonly held = new Set<string>();

  /**
   * Paints the environment cache for a loading screen. Every sheet set drains
   * the one cache queue, so only one of a floor's sets bakes; another would
   * only take a share of the screen's budget for the same queue.
   */
  readonly bakeFor?: (budgetMs: number, mustProgress: boolean) => void;

  /** `bakesUnderLoadingScreen` for the one set of a floor that paints the cache there. */
  constructor(
    ring: SheetRing,
    private readonly placed: ReadonlyArray<ResidentPlacement<string>>,
    options: { readonly bakesUnderLoadingScreen: boolean },
  ) {
    this.leadSeconds = ring.leadSeconds;
    this.releaseHysteresisTiles = ring.releaseHysteresisTiles;
    if (options.bakesUnderLoadingScreen) this.bakeFor = paintEnvironmentArtFor;
  }

  keyOf(key: string): string {
    return key;
  }

  placements(): ReadonlyArray<ResidentPlacement<string>> {
    return this.placed;
  }

  hold(key: string): void {
    this.held.add(key);
  }

  /**
   * Past the release ring nothing will draw it soon, so it goes within a
   * fifth of a second rather than after the idle window; a scene rebuilt around the floor
   * takes it back on its first decision.
   */
  release(key: string): void {
    this.held.delete(key);
    forgetWaitingBuildingSheet(key);
    releaseEnvironmentSheet(key);
  }

  /**
   * A held sheet is touched, and asked for if it is missing. One released is
   * not: painting back a sheet nothing is about to draw would only undo the
   * release.
   */
  warm(key: string, urgency: ResidentUrgency): boolean {
    if (urgency === 'speculative' && !this.held.has(key)) return false;
    const missing = wantEnvironmentSheet(key);
    if (missing && environmentSheetState(key) === 'absent') wantBuildingSheet(key);
    return missing;
  }

  warmth(key: string): ResidentWarmth {
    const state = environmentSheetState(key);
    if (state === 'resident') return 'warm';
    if (state === 'owed') return 'queued';
    const facadeStillQueueing =
      state === 'absent' && STILL_KEYS.has(key) && buildingSheetsNotYetQueued() > 0;
    return facadeStillQueueing ? 'queued' : 'stalled';
  }
}
