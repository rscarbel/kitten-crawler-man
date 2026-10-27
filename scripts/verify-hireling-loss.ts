/**
 * The ways a hireling (and Mongo) could be lost to a scripted moment rather than
 * to a fight, each checked against the real systems on the real third floor.
 *
 * - A hire is signed inside whichever building keeps the mercenaries' desk,
 *   which cannot save. Leaving it lands inside the town wall, whose entry is a
 *   save, and that save carries the new hire through capture, the save format,
 *   and the restore a death respawn runs.
 * - Nothing on the third floor seals a room: no boss room, no swine arena, no
 *   spider lab. Hirelings exist only on the third floor, so none of the systems
 *   that lock a door behind the party can shut one outside.
 * - A hire taken from the town to the circus and on to a defeat in the Starlight
 *   Tent's maze is still with the party after every step
 *   (`verifyHirelingLoss/circusJourney.ts`).
 * - A hire's permanent death is announced once, whichever way it died
 *   (`verifyHirelingLoss/deathNotice.ts`).
 *
 * Every rule is paired with a run where it must go the other way, so a check
 * that cannot see its effect fails rather than passes.
 *
 *   npx tsx scripts/verify-hireling-loss.ts
 */

import { TILE_SIZE } from '../src/core/constants';
import { interiorKeepsDesk } from '../src/systems/townServices';
import { withWorldSeed } from '../src/core/world/WorldRandom';
import {
  captureMercenaryRoster,
  createMercenaryRoster,
  restoreMercenaryRoster,
} from '../src/core/party/MercenaryRoster';
import { getMercenaryTemplate, MERCENARY_TEMPLATE_IDS } from '../src/core/party/mercenaryTemplates';
import { parseMercenaryRosterCheckpoint } from '../src/core/save/PersistedWorldState';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { level2 } from '../src/levels/level2';
import { level3 } from '../src/levels/level3';
import type { LevelDef } from '../src/levels/types';
import { GameMap } from '../src/map/GameMap';
import { STARLIGHT_TENT_NAME } from '../src/map/overworld/circusGroundsLayout';
import { mulberry32 } from '../src/sprites/person/rng';
import { checkCircusJourney } from './verifyHirelingLoss/circusJourney';
import { checkDeathNotice } from './verifyHirelingLoss/deathNotice';
import { checkCatchUpAttention } from './verifyHirelingLoss/catchUpAttention';

/** Overworlds built per rule: enough layouts that one lucky placement cannot pass the gate. */
const SEED_COUNT = 5;
/** Root of the seed sequence, fixed so a red run replays. */
const SEED_ROOT = 0x5eed_1055;
/** Scales a unit roll to a full 32-bit world seed. */
const UINT32_RANGE = 0x1_0000_0000;

const seedRoll = mulberry32(SEED_ROOT);
const SEEDS: ReadonlyArray<number> = Array.from({ length: SEED_COUNT }, () =>
  Math.floor(seedRoll() * UINT32_RANGE),
);

/**
 * Rows south of a door that a building exit sets the party down on — the
 * `returnTile` the scene's building callback builds from `doorTile`.
 */
const RETURN_TILE_ROWS_SOUTH_OF_DOOR = 1;
/** Offset from a tile's origin to its centre, as a fraction of a tile. */
const TILE_CENTRE_FRACTION = 0.5;

let failures = 0;
let checks = 0;

function check(condition: boolean, message: string): void {
  checks++;
  if (condition) return;
  failures++;
  console.error(`FAIL ${message}`);
}

/** A rule run where it must fail; passes only if it did. */
function checkCatches(ruleHolds: boolean, message: string): void {
  check(!ruleHolds, `negative control held when it should not: ${message}`);
}

function buildMap(levelDef: LevelDef, worldSeed: number): GameMap {
  return withWorldSeed(
    worldSeed,
    () =>
      new GameMap({
        mapSize: levelDef.mapSize,
        tileHeight: TILE_SIZE,
        mapType: levelDef.isOverworld ? 'overworld' : 'dungeon',
        dungeon: dungeonOptionsForLevel(levelDef),
        worldSeed,
      }),
  );
}

// ── A new hire survives the save that leaving the desk's building writes ─────

function returnTileOf(entry: { doorTile: { x: number; y: number } }): { x: number; y: number } {
  return { x: entry.doorTile.x, y: entry.doorTile.y + RETURN_TILE_ROWS_SOUTH_OF_DOOR };
}

function isInsideWallAtTile(map: GameMap, tile: { x: number; y: number }): boolean {
  return map.isInsideTownWall(
    (tile.x + TILE_CENTRE_FRACTION) * TILE_SIZE,
    (tile.y + TILE_CENTRE_FRACTION) * TILE_SIZE,
  );
}

function checkDeskExitSaves(worldSeed: number): void {
  const label = `seed ${worldSeed}`;
  const map = buildMap(level3, worldSeed);
  const desks = map.buildingEntries.filter((entry) =>
    interiorKeepsDesk(entry.name, 'mercenary_guild'),
  );
  check(
    desks.length === 1,
    `${label}: ${desks.length} buildings keep the mercenaries' desk, expected one`,
  );
  for (const desk of desks) {
    check(
      isInsideWallAtTile(map, returnTileOf(desk)),
      `${label}: leaving ${desk.name} lands outside the town wall, so no save carries a new hire`,
    );
  }
  const starlightTent = map.buildingEntries.find((entry) => entry.name === STARLIGHT_TENT_NAME);
  check(
    starlightTent !== undefined,
    `${label}: no Starlight Tent to stand in for an exit that does not save`,
  );
  if (starlightTent !== undefined) {
    checkCatches(
      isInsideWallAtTile(map, returnTileOf(starlightTent)),
      `${label}: the Starlight Tent's exit, out on the circus grounds, reads as inside the wall`,
    );
  }
}

function checkNewHireRoundTrips(): void {
  // Signed the way the desk signs one: fresh, unintroduced, no recorded health.
  const id = MERCENARY_TEMPLATE_IDS[0];
  const atDesk = createMercenaryRoster();
  atDesk.floorLevelId = level3.id;
  atDesk.active = {
    id,
    name: getMercenaryTemplate(id).name,
    contractLevelId: level3.id,
    introduced: false,
  };

  const onDisk: unknown = JSON.parse(JSON.stringify(captureMercenaryRoster(atDesk)));
  const parsed = parseMercenaryRosterCheckpoint(onDisk);
  check(parsed !== undefined, 'a roster holding a fresh hire does not parse back from the save');
  if (parsed === undefined) return;

  const respawned = createMercenaryRoster();
  respawned.floorLevelId = level3.id;
  restoreMercenaryRoster(respawned, parsed);
  check(
    respawned.active?.id === id && respawned.active.contractLevelId === level3.id,
    "a hire signed at the desk is gone after a death respawns from the save its building's exit writes",
  );

  // The same save restored on another floor must drop it, or the check above
  // would pass for a restore that ignores the snapshot altogether.
  const elsewhere = createMercenaryRoster();
  elsewhere.floorLevelId = level2.id;
  restoreMercenaryRoster(elsewhere, parsed);
  checkCatches(
    elsewhere.active !== null,
    'a floor-3 contract restored on another floor still names its hire',
  );
}

// ── Nothing on the third floor seals a room ──────────────────────────────────

function checkNoSealingRooms(worldSeed: number): void {
  const label = `seed ${worldSeed}`;
  const map = buildMap(level3, worldSeed);
  check(map.bossRooms.length === 0, `${label}: the overworld has a boss room that can lock`);
  check(map.arenaExteriors.length === 0, `${label}: the overworld has an arena that can lock`);
  check(map.spiderLabRoom === null, `${label}: the overworld has a spider lab that can lock`);
}

function checkSealingRoomsAreVisible(): void {
  check(
    (level3.bossRooms ?? []).length === 0,
    'the third floor declares a boss room, which can seal a hireling outside',
  );
  // A floor that does have them must show up, or the overworld's empty lists
  // above prove nothing.
  const map = buildMap(level2, SEEDS[0]);
  checkCatches(
    map.bossRooms.length === 0 && map.arenaExteriors.length === 0 && map.spiderLabRoom === null,
    'the second floor, which has sealing rooms, reads as having none',
  );
}

for (const seed of SEEDS) {
  checkDeskExitSaves(seed);
  checkNoSealingRooms(seed);
}
checkNewHireRoundTrips();
checkSealingRoomsAreVisible();
checkCircusJourney({ check, checkCatches }, SEEDS);
checkDeathNotice({ check, checkCatches });
checkCatchUpAttention({ check, checkCatches });

console.log(`${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
