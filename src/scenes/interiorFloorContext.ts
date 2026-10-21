import { ASSET_GROUPS, type AssetGroup } from '../core/assetGroups';
import type { SpriteKey } from '../core/SpriteLoader';
import { level3 } from '../levels/level3';
import type { LevelDef } from '../levels/types';
import { groundSheetKeysAmong } from '../map/ground/runtimeGroundSheets';
import type { InteriorVariant } from '../map/GameMap';
import type { StealthKeySnatchVisit } from '../systems/stealthKeySnatch/stealthKeySnatchVisit';

/**
 * What a building's interior takes from the floor it stands on.
 *
 * Every building on the overworld shares one answer ({@link TOWN_INTERIOR_FLOOR}),
 * but a building can stand on any floor, so nothing indoors may assume the
 * town: a room under a dungeon floor is painted, lit, scored and clocked by
 * that floor's rules.
 */
export interface InteriorFloorContext {
  /** The floor the building stands on: which props break and what advice applies indoors. */
  readonly floorNumber: number;
  /** The ground sheets the room's floor and walls are painted from. */
  readonly groundSheets: readonly SpriteKey[];
  /**
   * The environment groups the room's furniture is drawn from, the floor's
   * indoor-only groups among them. Requested before the room's loading card
   * goes up, so nothing in them is drawn unpainted.
   */
  readonly spriteGroups: readonly AssetGroup[];
  /** How far the active crawler can see indoors, for the off-screen markers. */
  readonly sightRadiusPx: number;
  /**
   * Whether the room plays its own soundtrack. When false, whatever the floor
   * outside was playing carries on through the visit.
   */
  readonly ownsMusic: boolean;
  /**
   * The floor's collapse clock as it stood at the door, shown paused for the
   * whole visit; null for a floor with no clock. Nothing indoors ticks it.
   */
  readonly heldLevelTimerFrames: number | null;
  /**
   * The room's shape when the floor decides it. Absent for a town building,
   * whose shape the town's own questlines choose.
   */
  readonly variant?: InteriorVariant;
  /**
   * The stealth gate's key quest, for the prison's door only: what the prison
   * reads (the phase, whether its explainer was read) and how it reports the
   * explainer read and the key taken or lost.
   */
  readonly stealthKeySnatch?: StealthKeySnatchVisit;
  /**
   * The outdoor floor's key for the AI's per-floor allowances (`aiFloorKey`),
   * so a visit indoors draws on the floor's allowance rather than a fresh one.
   */
  readonly aiFloorKey?: string;
}

/**
 * What a building's room is painted from: `outdoorGroups`, art of the floor
 * outside that the room shares (already held, so asking again costs nothing),
 * and the floor's indoor-only groups, which nothing but a room asks for.
 */
export function interiorArt(
  outdoorGroups: readonly AssetGroup[],
  floor: Pick<LevelDef, 'interiorSpriteGroups'>,
): Pick<InteriorFloorContext, 'groundSheets' | 'spriteGroups'> {
  const spriteGroups = [...outdoorGroups, ...floor.interiorSpriteGroups];
  return {
    groundSheets: groundSheetKeysAmong(spriteGroups.flatMap((group) => ASSET_GROUPS[group])),
    spriteGroups,
  };
}

/**
 * The town's buildings: lit end to end, so only the viewport edge hides anything.
 * Their counters and notice boards are the street's own `town` sheets.
 */
export const TOWN_INTERIOR_FLOOR: InteriorFloorContext = {
  floorNumber: level3.floorNumber,
  ...interiorArt(['town'], level3),
  sightRadiusPx: Number.POSITIVE_INFINITY,
  ownsMusic: true,
  heldLevelTimerFrames: null,
};
