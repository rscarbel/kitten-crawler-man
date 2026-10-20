import type { AssetGroup } from '../core/assetGroups';
import type { SpriteKey } from '../core/SpriteLoader';
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
  /** The environment groups the room's furniture is drawn from. */
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

/** Every enterable building in town stands on the level-3 overworld. */
const OVERWORLD_FLOOR_NUMBER = 3;

/** The town's buildings: lit end to end, so only the viewport edge hides anything. */
export const TOWN_INTERIOR_FLOOR: InteriorFloorContext = {
  floorNumber: OVERWORLD_FLOOR_NUMBER,
  groundSheets: ['ground_interior'],
  spriteGroups: ['town'],
  sightRadiusPx: Number.POSITIVE_INFINITY,
  ownsMusic: true,
  heldLevelTimerFrames: null,
};
