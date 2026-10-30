import type { BuildingEntry } from '../../map/buildingEntry';
import { TOWN_TOWER_ID } from '../../map/buildingIds';
import { TOWER_DOOR_REFUSALS, type TowerDoorStanding } from '../../dialog/scripts/scenes/towerDoor';
import { phaseReached, type MissingCatsProgress } from '../../core/quests/missingCatsProgress';

/**
 * The Town Center Tower's front door's refusal for
 * `BuildingEntryGate.blockedMessage`, or null for any other door. The front
 * door never opens: nothing in any questline lifts it, and the way into the
 * tower is not through it. `standing` only changes what the door says.
 */
export function towerDoorRefusal(entry: BuildingEntry, standing: TowerDoorStanding): string | null {
  if (entry.id !== TOWN_TOWER_ID) return null;
  return TOWER_DOOR_REFUSALS[standing];
}

/**
 * What the door and its guards answer with as the questline stands: barred
 * until the Warden is gone, silent-belled while the cats are walking home,
 * and after that closed by an order nobody can trace.
 */
export function towerDoorStandingFor(
  progress: Pick<MissingCatsProgress, 'phase'>,
): TowerDoorStanding {
  if (phaseReached(progress, 'complete')) return 'closedByOrder';
  return phaseReached(progress, 'aftermath') ? 'bellsStopped' : 'barred';
}
