/**
 * Keeps Wendell's room in step with "The Borrowed Blueprints": the plan
 * chest shows Fenna's blueprints for as long as they are in his keeping, and
 * the dairy corner wakes up once Midge lives in his pasture.
 *
 * The room is one layout; the quest only swaps variants of four of its
 * props. It is checked every frame the room is open, because the hand-over
 * happens mid-visit and an eviction can send the blueprints home at any time,
 * but the props are only touched on the frames that state actually changes.
 */

import {
  blueprintsPhaseAtLeast,
  type BlueprintsQuestPhase,
} from '../../../core/blueprintsQuestPhase';
import type { BarkLine } from '../../../dialog/line';
import { DAIRY_LIVE_EXAMINE_LINES } from '../../../dialog/scripts/interiorObjects';
import type { GameMap } from '../../../map/GameMap';
import type { TownInteriorExamineId } from '../../../sprites/art/townInterior/townInteriorProps';
import {
  plumblineFarmPropVariants,
  type PlumblineFarmState,
} from '../../../map/town/interiors/plumblineFarm';
import { isHeld, type BlueprintsItemHolder } from './blueprintsProgress';

/** Whether a cow lives in Wendell's pasture again, so his dairy corner is in use. */
function isDairyCornerLive(phase: BlueprintsQuestPhase): boolean {
  return blueprintsPhaseAtLeast(phase, 'midge_delivered');
}

/**
 * What the quest has done to the room. The blueprints are Wendell's until he
 * hands them over, and his again whenever no crawler holds them before the
 * stations are built; once the quest is complete they are retired for good.
 */
export function plumblineFarmStateFor(
  phase: BlueprintsQuestPhase,
  holders: readonly BlueprintsItemHolder[],
): PlumblineFarmState {
  const handedOver = blueprintsPhaseAtLeast(phase, 'build_stations');
  const retired = phase === 'complete';
  const carried = isHeld(holders, 'quest_blueprints');
  return {
    dairyCornerLive: isDairyCornerLive(phase),
    blueprintsInPlanChest: !retired && (!handedOver || !carried),
  };
}

/**
 * Keeps Plumbline Farm's swapped props in the variants the quest calls for.
 * Built only for Plumbline Farm, so no other room pays for the check.
 */
export class PlumblineFarmRoomSync {
  private applied: PlumblineFarmState | null = null;

  constructor(private readonly map: GameMap) {}

  /** Puts every swapped prop into the variant `phase` and the crawlers' packs call for, if that changed. */
  sync(phase: BlueprintsQuestPhase, holders: readonly BlueprintsItemHolder[]): void {
    const state = plumblineFarmStateFor(phase, holders);
    const previous = this.applied;
    const unchanged =
      previous !== null &&
      previous.dairyCornerLive === state.dairyCornerLive &&
      previous.blueprintsInPlanChest === state.blueprintsInPlanChest;
    if (unchanged) return;
    this.applied = state;
    for (const { id, variant } of plumblineFarmPropVariants(state)) {
      this.map.setPlacedInteriorPropVariant(id, variant);
    }
  }
}

/**
 * What examining `id` in Wendell's room says at `phase`, where it differs
 * from the room's usual line; null where the usual line still holds.
 */
export function plumblineFarmExamineLine(
  id: TownInteriorExamineId,
  phase: BlueprintsQuestPhase,
): BarkLine | null {
  if (!isDairyCornerLive(phase)) return null;
  if (id === 'milk_churn') return DAIRY_LIVE_EXAMINE_LINES.milk_churn;
  if (id === 'dairy_wall') return DAIRY_LIVE_EXAMINE_LINES.dairy_wall;
  return null;
}
