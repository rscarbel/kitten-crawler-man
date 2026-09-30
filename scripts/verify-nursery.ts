/**
 * The goblin nursery's building rules, checked headless against a real floor-1
 * `GameMap` and the live `DefendQuestSystem`:
 *
 * - a boardless tap on a grate with a bugaboo on or beside it is left for the
 *   attack, while the same tap on a quiet grate is refused for want of wood;
 * - only the crawler the player is driving takes boards off the pile, so a
 *   companion standing on it neither pockets the stock nor sends it to restock;
 * - a repair whose barrier gives way mid-hammer finishes as a fresh barrier on
 *   the now-open grate, charged once.
 *
 *   npx tsx scripts/verify-nursery.ts
 */

import { TILE_SIZE } from '../src/core/constants.js';
import { EventBus } from '../src/core/EventBus.js';
import { GameMap } from '../src/map/GameMap.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { level1 } from '../src/levels/level1.js';
import { DefendQuestSystem } from '../src/systems/DefendQuestSystem.js';
import { Conversation } from '../src/dialog/Conversation.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { CatPlayer } from '../src/creatures/CatPlayer.js';
import { Bugaboo } from '../src/creatures/Bugaboo.js';
import { MobRoster } from '../src/systems/kits/SceneWorld.js';
import { SpellSystem } from '../src/systems/SpellSystem.js';
import type { SystemContext } from '../src/systems/GameSystem.js';

const BOARDS = 'quest_wood_board';
const BOARDS_PER_PICKUP = 8;
const BOARDS_PER_BUILD = 4;
const BARRIER_MAX_HP = 36;
const WEAKENED_HP = 5;
const SMASHING_BLOW = 100;
/** Comfortably past the human's (and even the cat's) build time. */
const BUILD_SETTLE_FRAMES = 400;
const STAGED_DEFENSE_FRAMES = 3000;
/** Tiles off the pile the driven crawler waits at while the companion stands on it. */
const AWAY_FROM_PILE_TILES = 6;

let failures = 0;
let checks = 0;
function check(condition: boolean, message: string): void {
  checks++;
  if (condition) return;
  failures++;
  console.log(`  FAIL: ${message}`);
}

const gameMap = new GameMap({
  mapSize: level1.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'dungeon',
  dungeon: dungeonOptionsForLevel(level1),
});
if (gameMap.questRooms.length === 0) throw new Error('floor 1 generated no nursery');
const room = gameMap.questRooms[0];
const grate = room.grateTiles[0];

function freshQuest() {
  const quest = new DefendQuestSystem(
    gameMap,
    new EventBus(),
    () => undefined,
    new Conversation(null),
    () => 1,
    undefined,
  );
  const human = new HumanPlayer(grate.x, grate.y + 1, TILE_SIZE);
  const cat = new CatPlayer(room.centre.x, room.centre.y + 1, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  const roster = new MobRoster(gameMap, new SpellSystem());
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap,
  };
  quest.update(ctx);
  const snapshot = quest.captureCheckpoint();
  quest.restoreCheckpoint({
    ...snapshot,
    phase: 'defending',
    defenseTimer: STAGED_DEFENSE_FRAMES,
    spawnTimer: STAGED_DEFENSE_FRAMES,
    woodPileAvailable: true,
  });
  return { quest, human, cat, roster, ctx };
}

const grateScreenX = grate.x * TILE_SIZE + TILE_SIZE / 2;
const grateScreenY = grate.y * TILE_SIZE + TILE_SIZE / 2;

console.log('── a boardless tap on a grate ──');
{
  const { quest, human, ctx } = freshQuest();
  quest.update(ctx);
  check(
    quest.tryMobileTapOnGrate(grateScreenX, grateScreenY, 0, 0, human),
    'a boardless tap on a quiet grate is not refused for want of wood',
  );
  quest.noWoodSoundPending = false;
}
{
  const { quest, human, roster, ctx } = freshQuest();
  const bug = new Bugaboo(grate.x + 1, grate.y, TILE_SIZE);
  bug.setMap(gameMap);
  roster.add(bug);
  quest.update(ctx);
  check(
    !quest.tryMobileTapOnGrate(grateScreenX, grateScreenY, 0, 0, human),
    'a boardless tap beside a bugaboo was taken for "need wood" instead of left for the attack',
  );
  check(!quest.noWoodSoundPending, 'the boardless tap beside a bugaboo still played the refusal');
}

console.log('── who takes the wood ──');
{
  const { quest, human, cat, ctx } = freshQuest();
  human.x = (room.woodPileTile.x + AWAY_FROM_PILE_TILES) * TILE_SIZE;
  human.y = (room.woodPileTile.y + AWAY_FROM_PILE_TILES) * TILE_SIZE;
  cat.x = room.woodPileTile.x * TILE_SIZE;
  cat.y = room.woodPileTile.y * TILE_SIZE;
  quest.update(ctx);
  check(cat.inventory.countOf(BOARDS) === 0, 'the companion on the pile took the boards');
  human.x = cat.x;
  human.y = cat.y;
  quest.update(ctx);
  check(
    human.inventory.countOf(BOARDS) === BOARDS_PER_PICKUP,
    'the driven crawler reaching the pile after the companion found it empty',
  );
}

console.log('── a repair whose barrier gives way ──');
{
  const { quest, human, ctx } = freshQuest();
  const snapshot = quest.captureCheckpoint();
  quest.restoreCheckpoint({
    ...snapshot,
    barriers: [
      {
        tileX: grate.x,
        tileY: grate.y,
        worldX: grate.x * TILE_SIZE,
        worldY: grate.y * TILE_SIZE,
        hp: WEAKENED_HP,
        maxHp: BARRIER_MAX_HP,
        grateIdx: 0,
        hitFlash: 0,
      },
    ],
  });
  human.inventory.addItem(BOARDS, BOARDS_PER_PICKUP);
  check(quest.tryBuildBarrier(human), 'the repair did not start');
  quest.damageBarrier(grate, SMASHING_BLOW);
  check(!quest.hasBarrierAt(0), 'the smashing blow did not break the barrier');
  for (let frame = 0; frame < BUILD_SETTLE_FRAMES; frame++) quest.update(ctx);
  check(quest.hasBarrierAt(0), 'the interrupted repair charged for boards and left the grate open');
  check(
    human.inventory.countOf(BOARDS) === BOARDS_PER_PICKUP - BOARDS_PER_BUILD,
    `the interrupted repair charged ${BOARDS_PER_PICKUP - human.inventory.countOf(BOARDS)} boards, expected ${BOARDS_PER_BUILD}`,
  );
}

console.log(
  failures === 0
    ? `\nPASS — ${checks}/${checks} checks passed`
    : `\nFAIL — ${checks - failures}/${checks} checks passed`,
);
if (failures > 0) process.exit(1);
