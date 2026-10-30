/**
 * The Starlight Tent's centre ring stood up headless the way the scene stands it
 * up: a real `TreasureChestSystem` bound to a real `ChestKit`, a real
 * `InteriorExitFixtureSystem`, and the chest placer the scene hands an
 * encounter. The exit menu the scene asks before a fixture's climb is
 * answered yes at once, and each exit the room takes is counted.
 */

import type { StarlightTentProgress } from '../src/core/state/StarlightTentProgress';
import { PlayerManager } from '../src/core/party/PlayerManager';
import type { Mob } from '../src/creatures/Mob';
import { level3 } from '../src/levels/level3';
import type { GameMap } from '../src/map/GameMap';
import { StarlightTentFinale } from '../src/systems/starlightTent/StarlightTentFinale';
import { InteriorExitFixtureSystem } from '../src/systems/interiorExitFixtures';
import { ChestKit, chestPlacer } from '../src/systems/kits/ChestKit';
import { RewardFlySystem } from '../src/systems/RewardFlySystem';
import { TreasureChestSystem } from '../src/systems/TreasureChestSystem';

/** A party level the guards' authored level is not lifted for. */
export const RING_TEST_PARTY_LEVEL = 1;

export interface RingHarness {
  readonly finale: StarlightTentFinale;
  readonly chests: TreasureChestSystem;
  readonly exits: InteriorExitFixtureSystem;
  /** The party whose crawlers the chest pays. */
  readonly pm: PlayerManager;
  /** How many times the room has asked whether to leave, and how many exits it then took. */
  readonly counts: { confirms: number; exits: number };
}

export function standRing(
  map: GameMap,
  addMob: (mob: Mob) => void,
  progress: StarlightTentProgress,
): RingHarness {
  const start = map.startTile;
  const pm = new PlayerManager(start.x, start.y, undefined);
  const chests = new TreasureChestSystem();
  new ChestKit({
    pm,
    audio: null,
    rewardFly: new RewardFlySystem(),
    floorNumber: level3.floorNumber,
    partyOwnsGear: () => false,
  }).bind(chests);
  const counts = { confirms: 0, exits: 0 };
  const exits = new InteriorExitFixtureSystem({
    confirm: (_destination, leave) => {
      counts.confirms++;
      leave();
    },
    exit: () => {
      counts.exits++;
    },
    playSound: () => undefined,
  });
  const finale = new StarlightTentFinale({
    map,
    chests: chestPlacer(chests, map),
    exits,
    addMob,
    progress,
    partyLevel: RING_TEST_PARTY_LEVEL,
  });
  return { finale, chests, exits, pm, counts };
}
