/**
 * Checks for what an interior encounter can stand up in its room besides its
 * mobs: a chest its guards keep shut, and an exit fixture.
 *
 * Driven through the real `TreasureChestSystem`, `ChestKit` (the open and
 * grant path the dungeon uses too), `MobRoster` and spawn funnel on a real
 * generated room, and the real `InteriorExitFixtureSystem`. The scene needs a
 * DOM, so how `BuildingInteriorScene` wires these in — the order its frame
 * ticks them, and that a fixture ends in the same exit as the door mat — is
 * checked against its source, each fragment found before its order is trusted.
 */

import { readFileSync } from 'node:fs';
import { TILE_SIZE } from '../src/core/constants';
import { PlayerManager } from '../src/core/party/PlayerManager';
import { level3 } from '../src/levels/level3';
import { liveSpawnContext, spawnMob } from '../src/levels/spawnFunnel';
import type { LootDrop } from '../src/creatures/Mob';
import type { GameMap } from '../src/map/GameMap';
import { findNearbyWalkableTile } from '../src/map/findWalkableTile';
import { RewardFlySystem } from '../src/systems/RewardFlySystem';
import { SpellSystem } from '../src/systems/SpellSystem';
import { TreasureChestSystem } from '../src/systems/TreasureChestSystem';
import { ChestKit, chestPlacer, postChestBand } from '../src/systems/kits/ChestKit';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import {
  exitFixtureOnTile,
  INTERIOR_EXIT_FIXTURES,
  InteriorExitFixtureSystem,
} from '../src/systems/interiorExitFixtures';

type Check = (ok: boolean, message: string) => void;

/** The room the guards hold, inclusive tile corners as the maze layout writes its rectangles. */
interface RoomRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const CHEST_LOOT_COINS = 40;
const CHEST_LOOT: LootDrop = {
  coins: CHEST_LOOT_COINS,
  items: [{ id: 'health_potion', quantity: 1 }],
};
/** How far from a wanted tile the checks may look for open floor. */
const TILE_SEARCH_RADIUS = 4;
/** More frames than the chest's unlock animation runs. */
const MAX_UNLOCK_FRAMES = 600;
/** Comfortably outside any interaction reach. */
const FAR_AWAY_TILES = 12;
/** Frames the checks keep ticking after an exit has run, to see it does not run twice. */
const AFTER_EXIT_FRAMES = 10;
const HALF = 2;

function standBeside(body: { x: number; y: number }, tile: { x: number; y: number }): void {
  body.x = tile.x * TILE_SIZE;
  body.y = (tile.y + 1) * TILE_SIZE;
}

function guardedChestChecks(map: GameMap, room: RoomRect, check: Check): void {
  const centreX = Math.floor((room.x0 + room.x1) / HALF);
  const chestTile = findNearbyWalkableTile(map, centreX, room.y0 + 1, TILE_SEARCH_RADIUS);
  if (chestTile === null) {
    check(false, 'the room has open floor for a chest');
    return;
  }
  const guardTile = findNearbyWalkableTile(
    map,
    centreX,
    Math.floor((room.y0 + room.y1) / HALF),
    TILE_SEARCH_RADIUS,
    (x, y) => x !== chestTile.x || y !== chestTile.y,
  );
  if (guardTile === null) {
    check(false, 'the room has open floor for a guard');
    return;
  }

  const pm = new PlayerManager(chestTile.x, chestTile.y + 1, undefined);
  const { human, cat } = pm;
  const chests = new TreasureChestSystem();
  const kit = new ChestKit({
    pm,
    audio: null,
    rewardFly: new RewardFlySystem(),
    floorNumber: level3.floorNumber,
    partyOwnsGear: () => false,
  });
  kit.bind(chests);
  const placer = chestPlacer(chests, map);
  const chest = placer.heldByBand(chestTile, CHEST_LOOT);
  check(!map.isWalkable(chestTile.x, chestTile.y), 'a placed chest blocks its own tile');

  const roster = new MobRoster(map, new SpellSystem());
  chests.update(roster.mobs);
  check(
    chest.state === 'locked',
    'a band-held chest with no band posted yet stays locked (guards arrive when the party does)',
  );

  const guard = spawnMob('goblin', guardTile, map, liveSpawnContext('dev:spawn'));
  roster.add(guard);
  postChestBand(chest, [guard]);
  chests.update(roster.mobs);
  check(chest.state === 'locked', 'the chest is locked while its guard lives');

  standBeside(human, chestTile);
  const coinsBefore = human.coins + cat.coins;
  const potionsBefore =
    human.inventory.countOf('health_potion') + cat.inventory.countOf('health_potion');
  check(chests.tryInteract(human), 'a press at the locked chest is taken (it rattles)');
  check(
    chest.state === 'locked' && human.coins + cat.coins === coinsBefore,
    'and opens nothing while the guard lives',
  );

  guard.hp = 0;
  chests.update(roster.mobs);
  check(chest.state === 'unlocking', 'the chest starts to unlock on the frame its last guard dies');
  for (let frame = 0; frame < MAX_UNLOCK_FRAMES && chest.state !== 'unlocked'; frame++) {
    chests.update(roster.mobs);
  }
  check(chest.state === 'unlocked', 'and finishes unlocking');

  check(chests.tryInteract(human), 'a press at the unlocked chest opens it');
  check(chest.state === 'opened', 'the chest is open');
  const coinsGained = human.coins + cat.coins - coinsBefore;
  const potionsGained =
    human.inventory.countOf('health_potion') +
    cat.inventory.countOf('health_potion') -
    potionsBefore;
  check(
    coinsGained >= CHEST_LOOT_COINS && potionsGained === CHEST_LOOT.items[0]?.quantity,
    `its loot is paid to the party on the press (${coinsGained} coins, ${potionsGained} potion)`,
  );
  check(!chests.tryInteract(human), 'an opened chest takes no further press');

  const claimedTile = findNearbyWalkableTile(map, chestTile.x, chestTile.y, TILE_SEARCH_RADIUS);
  if (claimedTile === null) {
    check(false, 'the room has open floor for an emptied chest');
    return;
  }
  const claimed = placer.opened(claimedTile, 'wooden');
  standBeside(human, claimedTile);
  check(
    claimed.state === 'opened' && claimed.loot === null && !chests.tryInteract(human),
    'a chest placed as already emptied is drawn open and offers nothing',
  );
}

function exitFixtureChecks(map: GameMap, check: Check): void {
  const tile = map.startTile;
  const pm = new PlayerManager(tile.x, tile.y, undefined);
  const { human } = pm;
  let exitsRun = 0;
  const asked: { leave: (() => void) | null } = { leave: null };
  const exits = new InteriorExitFixtureSystem({
    confirm: (leave) => {
      asked.leave = leave;
    },
    exit: () => {
      exitsRun++;
    },
    playSound: () => undefined,
  });
  exits.place(exitFixtureOnTile('rope_ladder', tile));
  const ladder = INTERIOR_EXIT_FIXTURES.rope_ladder;

  human.x = (tile.x + FAR_AWAY_TILES) * TILE_SIZE;
  human.y = (tile.y + FAR_AWAY_TILES) * TILE_SIZE;
  check(
    !exits.wouldInteract(human) && !exits.tryInteract(human),
    'an exit fixture out of reach takes no press',
  );

  human.x = tile.x * TILE_SIZE;
  human.y = tile.y * TILE_SIZE;
  check(exits.wouldInteract(human), `the ladder in reach offers "${ladder.prompt}"`);
  check(exits.tryInteract(human), 'a press at the ladder is taken');
  check(
    asked.leave !== null && !exits.isDeparting && exitsRun === 0,
    'the press asks whether to leave and sets off on nothing until it is answered',
  );
  asked.leave?.();
  check(exitsRun === 0 && exits.isDeparting, 'a fading departure has not left yet on the yes');
  check(!exits.tryInteract(human), 'and a second press during the climb is refused');
  exits.update();
  check(exits.fadeAlpha > 0, 'the screen starts to darken');
  for (let frame = 0; frame < ladder.departure.frames && exitsRun === 0; frame++) exits.update();
  check(exitsRun === 1, `the room's exit runs once the fade is dark (${exitsRun} exit)`);
  for (let frame = 0; frame < AFTER_EXIT_FRAMES; frame++) exits.update();
  check(
    exitsRun === 1 && !exits.isDeparting && exits.fadeAlpha === 0,
    'exactly once, with the fade cleared',
  );
}

/**
 * The fragments, each present and each after the one before it, in `body`.
 * A fragment that is not there fails rather than passing by comparing two misses.
 */
function inOrder(body: string, fragments: readonly string[]): boolean {
  let from = 0;
  for (const fragment of fragments) {
    const at = body.indexOf(fragment, from);
    if (at < 0) return false;
    from = at + fragment.length;
  }
  return true;
}

/** The text from `opening` to the parenthesis that closes it, or '' when `opening` is absent. */
function callArgs(body: string, opening: string): string {
  const start = body.indexOf(opening);
  if (start < 0) return '';
  let depth = 0;
  for (let at = start; at < body.length; at++) {
    if (body[at] === '(') depth++;
    if (body[at] === ')') depth--;
    if (depth === 0 && at > start + opening.length - 1) return body.slice(start, at + 1);
  }
  return '';
}

function sceneWiringChecks(check: Check): void {
  const interior = readFileSync(
    new URL('../src/scenes/BuildingInteriorScene.ts', import.meta.url),
    'utf8',
  );
  const fixtureHost = callArgs(interior, 'new InteriorExitFixtureSystem(');
  check(
    fixtureHost.includes('exit: () => this.doExit()') &&
      interior.includes('this.openExitMenu(() => this.doExit())'),
    "an exit fixture ends in the room's own exit, the one the door mat takes out to the building's door",
  );
  check(
    fixtureHost.includes('confirm: (leave) => this.openExitMenu(leave)') &&
      callArgs(interior, 'exitBuildingPromptSurface(').includes(
        'exit: () => this.leaveByExitMenu()',
      ),
    "and it asks first through the door mat's own exit menu, the one that warns about a downed hire",
  );
  check(
    inOrder(interior, ['chests: new TreasureChestSystem()', 'this.chestKit.bind(floor.chests)']),
    "every storey's chests open through the scene's one chest kit",
  );
  check(
    inOrder(interior, ['combat.resolveKills();', 'this.chests.update(ctx.roster.mobs);']),
    "the storey's chests are judged against its roster after the frame's kills",
  );
  check(
    inOrder(interior, [
      'private startEncounter<',
      'chests: chestPlacer(chests, world.gameMap)',
      'exits,',
    ]),
    'an encounter is handed its storey’s chest placer and exit fixtures',
  );
  check(
    inOrder(interior, ['this.renderSortedEntities(', 'this.chests.sortedFigures(']),
    'chests are drawn in the Y-sorted pass with the room’s figures',
  );
  check(
    inOrder(interior, ['this.chestKit.surface()', 'EXIT_FIXTURE_FADE_SURFACE_ID']) &&
      interior.includes('this.chestKit.tick();') &&
      interior.includes('this.tryUseRoomFixture(player)') &&
      interior.includes('this.tryUseRoomFixture(active)'),
    'the chest card and the fixture fade are mounted, ticked, and reached by Space and by a tap',
  );

  const dungeon = readFileSync(new URL('../src/scenes/DungeonScene.ts', import.meta.url), 'utf8');
  check(
    dungeon.includes('this.chestKit.bind(this.treasureChests)') &&
      !dungeon.includes('splitChestLoot(') &&
      !dungeon.includes('new ChestRewardDialog('),
    'the dungeon opens its chests through the same chest kit, with no copy of its own',
  );
}

/** Runs every check above; `room` is the rectangle a guarded chest's guards hold. */
export function runInteriorFixtureChecks(map: GameMap, room: RoomRect, check: Check): void {
  guardedChestChecks(map, room, check);
  exitFixtureChecks(map, check);
  sceneWiringChecks(check);
}
