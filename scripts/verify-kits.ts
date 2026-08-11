#!/usr/bin/env tsx
/**
 * Headless checks on the scene kits: the roster that is the single spawn path,
 * the combat stack a place gets by constructing `CombatKit`, and the breakables
 * and floor loot it gets by constructing `DestructionKit`.
 *
 * Every check here guards a failure that is *invisible in the game*. A mob added
 * without the roster's `SpellSystem` walks through a protective shell and
 * nothing anywhere says so. A `replaceAll` that swapped the array instead of its
 * contents would strand the per-frame `SystemContext` and every quest spawn
 * closure on a list that stops being updated — the scene keeps running, it just
 * fights the wrong population. A barrel indoors that has no prop system behind
 * it is scenery a swing passes through, which is exactly what "destructible
 * objects don't behave" looked like from a playtest. And loot left lying on an
 * interior floor is destroyed by the door, because the room is regenerated from
 * scratch on the next entry.
 *
 * The interior is a real generated one rather than a hand-built grid: the point
 * of these checks is that the props the *generator* emits are the props the kit
 * breaks, so a layout change that stops emitting them has to fail here.
 *
 * Also covered: `interiorHostiles`, which is content rather than a kit but is
 * the proof that a room gains a fight from a table entry alone.
 *
 * What this does **not** cover, so a green run is not read as more than it is:
 *
 *  - **The scenes.** `BuildingInteriorScene` and `DungeonScene` need a DOM, a
 *    canvas and a running frame loop, so their input bindings, overlay claim
 *    ladders and render order are checked by reading them, not by running them.
 *    `GameplayInputHandler`, `MenusKit`, `ChatKit` and `hotbarActions` are not
 *    imported here at all for the same reason.
 *  - **Anything audio-shaped.** `CombatKit.drainMobAudioCues` and
 *    `DestructionKit.drainAudioCues` — including the latter's report that a prop
 *    gave way, which the interior uses to re-scan its ambient emitters.
 *  - **The rest of the kit surface nothing here calls:** `DynamiteSystem`,
 *    `DestructionKit`'s `update`, checkpoint pair and render methods, and
 *    `CombatKit`'s `resolveSpellAftermath`, `updatePostCombat`, `leaveFloor`,
 *    `spawnGore`, `resetForCheckpoint` and render methods.
 *
 * Run: npx tsx scripts/verify-kits.ts
 */

import { TILE_SIZE } from '../src/core/constants';
import { AbilityManager } from '../src/core/AbilityManager';
import { EventBus } from '../src/core/EventBus';
import { PlayerManager } from '../src/core/PlayerManager';
import { GameMap } from '../src/map/GameMap';
import { BARREL, CRATE } from '../src/map/tileTypes';
import { Mob, type ShellContext } from '../src/creatures/Mob';
import { alertPackAround } from '../src/creatures/packAlert';
import { createMob } from '../src/levels/spawner';
import { hasRoomToMove } from '../src/map/findWalkableTile';
import type { SystemContext } from '../src/systems/GameSystem';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster, type SceneWorld } from '../src/systems/kits/SceneWorld';
import { CombatKit } from '../src/systems/kits/CombatKit';
import { DestructionKit } from '../src/systems/kits/DestructionKit';
import {
  distinctSpawnTiles,
  interiorHostilesFor,
  noteRoomCleared,
  STAIR_GUARD_OFFSETS,
  type InteriorHostileContext,
} from '../src/systems/interiorHostiles';
import { CULT_HIDEOUT_CULTIST_LEVEL } from '../src/systems/CultHideoutSystem';
import { createTownMemory } from '../src/core/TownMemory';
import { createMurderQuestProgress } from '../src/core/MurderQuestProgress';

const HALF_TILE = TILE_SIZE / 2;

/**
 * The building whose generated interior these checks run in. The store is the
 * kind that lays down barrels, and barrels are what the destruction checks need
 * the generator to have actually produced.
 */
const INTERIOR_KIND = 'store';
const INTERIOR_NAME = 'verify-kits store';
/** Interiors hang off the overworld, which is the floor their drops are rolled against. */
const OVERWORLD_FLOOR_NUMBER = 3;
/** The storey a single-room building has, and the one a tower is entered on. */
const GROUND_FLOOR = 0;

/** Radius of a grid query aimed at one mob's own position — anything under a cell. */
const PINPOINT_QUERY_RADIUS = 1;

const PROBE_MOB_HP = 10;
const PROBE_MOB_SPEED = 1;
const PROBE_MOB_XP = 1;

/**
 * Frames of swinging allowed to finish one ordinary floor-1 mob, and to reduce
 * one barrel to splinters. Both are a handful of swings; this only bounds a
 * failure so the harness reports rather than hangs.
 */
const MAX_FIGHT_FRAMES = 3600;

/** Coins and potions staged on the floor for the sweep check. */
const SWEPT_COINS = 37;
const SWEPT_POTIONS = 2;
/** A second pile, dropped after the first sweep, to prove the floor still works. */
const RESWEPT_COINS = 11;

/**
 * Where the pack-alert probes stand: comfortably past `MobUpdateLoop`'s
 * activation radius, so the AI never runs on them and the only thing that can
 * ever give one of them a target is the shout the check is measuring. Not
 * derived from that radius because it is private to the loop — deliberately far
 * enough that a retune would have to more than double it to matter.
 */
const PACK_STANDOFF_TILES = 40;
/** How far a shout carries in this check. The two probes are neighbours. */
const PACK_ALERT_RADIUS_PX = TILE_SIZE * 3;

const TOWER_NAME = 'verify-kits tower';
/**
 * Where the party is parked in a check that does not care where they stand —
 * the first interior tile inside the north-west corner.
 */
const PARKED_TILE = 1;
/** The nudge radius `interiorHostiles` uses, mirrored so the contract is tested at its own scale. */
const SPAWN_SEARCH_RADIUS = 4;
/** Three, strung back along the crossing the party has to make. */
const EXPECTED_STAIR_GUARDS = 3;
/**
 * The party these gates place their guards for. Low enough that the quest's own
 * authored level wins, so what is measured stays placement rather than tuning.
 */
const GATE_PARTY_LEVEL = 1;
/** The storeys the cult holds — mirrored from the content table under test. */
const FIRST_GUARDED_TOWER_FLOOR = 1;
const SECOND_GUARDED_TOWER_FLOOR = 2;
const GUARDED_TOWER_FLOORS = [FIRST_GUARDED_TOWER_FLOOR, SECOND_GUARDED_TOWER_FLOOR] as const;
/** Quill's own confrontation owns the top of the tower. */
const TOP_TOWER_FLOOR = 3;
/** How far off the arrival tile the nearest guard must stand to be seen coming. */
const MIN_GUARD_STANDOFF_TILES = 3;
/** How much of the run between the two stairs the guard line has to span. */
const MIN_LINE_SPREAD_FRACTION = 0.5;
/** How far south of the stair row a guard may stand and still be on the crossing. */
const MAX_GUARD_BAND_TILES = 5;

/**
 * Where `changeFloor` puts a party down at a stair: one tile south of it, so the
 * step they just used does not immediately re-trigger. Climbing lands them at
 * the stair *down*; retreating lands them at the stair up.
 */
function arrivalBelow(stair: { x: number; y: number }): { x: number; y: number } {
  return { x: stair.x, y: stair.y + 1 };
}

let failures = 0;

function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
}

/**
 * A mob that does nothing, so a check about the roster measures the roster.
 *
 * It exists for one reason a real mob cannot serve: `Mob.spells` is `protected`
 * and has no tell until a shell is up and something is in flight at it, and a
 * subclass can read it without a cast.
 */
class ProbeMob extends Mob {
  readonly xpValue = PROBE_MOB_XP;

  constructor(tileX: number, tileY: number) {
    super(tileX, tileY, TILE_SIZE, PROBE_MOB_HP, PROBE_MOB_SPEED);
  }

  /** The shell context the roster injected, or null if it never did. */
  get injectedShellContext(): ShellContext | null {
    return this.spells;
  }

  override updateAI(): void {
    // A probe makes no decisions; every check drives it by hand.
  }

  protected override drawSelf(): void {
    // Nothing here is ever rendered.
  }
}

/** A generated store interior, at the tile size the rest of the game measures in. */
function makeInterior(): GameMap {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior(INTERIOR_KIND, GROUND_FLOOR, INTERIOR_NAME);
  return map;
}

interface Stage {
  readonly map: GameMap;
  readonly bus: EventBus;
  readonly pm: PlayerManager;
  readonly roster: MobRoster;
  readonly world: SceneWorld;
}

/**
 * A room with a party in it, wired the way `BuildingInteriorScene` wires one.
 *
 * The cat is parked on the human's own tile: she is never driven here, and a cat
 * standing a tile away is a second body inside every melee query the checks
 * below make.
 */
function makeStage(map: GameMap, humanTileX: number, humanTileY: number): Stage {
  const bus = new EventBus();
  const pm = new PlayerManager(humanTileX, humanTileY);
  pm.cat.x = pm.human.x;
  pm.cat.y = pm.human.y;
  const roster = new MobRoster(map, new SpellSystem());
  const world: SceneWorld = { gameMap: map, bus, audio: null, pm, roster };
  return { map, bus, pm, roster, world };
}

function makeCombatKit(stage: Stage): CombatKit {
  return new CombatKit({
    world: stage.world,
    abilityManager: new AbilityManager(),
    // Null exactly as an interior passes it: there is no safe room to narrow
    // attacks against, so every swing resolves.
    safeRoom: null,
  });
}

function makeContext(stage: Stage): SystemContext {
  return {
    human: stage.pm.human,
    cat: stage.pm.cat,
    active: stage.pm.active(),
    inactive: stage.pm.inactive(),
    activeIsMoving: false,
    roster: stage.roster,
    gameMap: stage.map,
  };
}

interface TilePos {
  readonly x: number;
  readonly y: number;
}

/** The first tile of open floor with open floor immediately east of it. */
function findFloorPairEastward(map: GameMap): TilePos | null {
  for (let y = 0; y < map.structure.length; y++) {
    const row = map.structure[y];
    for (let x = 0; x < row.length - 1; x++) {
      if (map.isWalkable(x, y) && map.isWalkable(x + 1, y)) return { x, y };
    }
  }
  return null;
}

/** Every tile the generator laid a barrel or a crate on. */
function findSmashableTiles(map: GameMap): TilePos[] {
  const found: TilePos[] = [];
  for (let y = 0; y < map.structure.length; y++) {
    const row = map.structure[y];
    for (let x = 0; x < row.length; x++) {
      const tileType = row[x].type;
      if (tileType === BARREL || tileType === CRATE) found.push({ x, y });
    }
  }
  return found;
}

/**
 * Puts the human a tile west of a world point and points them at it.
 *
 * A tile is the melee point-blank range, so the swing lands without depending on
 * how wide the facing cone happens to be.
 */
function standWestFacing(stage: Stage, targetCentreX: number, targetCentreY: number): void {
  const { human } = stage.pm;
  human.x = targetCentreX - TILE_SIZE - HALF_TILE;
  human.y = targetCentreY - HALF_TILE;
  human.facingX = 1;
  human.facingY = 0;
  stage.pm.cat.x = human.x;
  stage.pm.cat.y = human.y;
}

console.log('MobRoster.add is the single spawn path');
{
  const map = makeInterior();
  const floor = findFloorPairEastward(map);
  check(floor !== null, 'the generated store has open floor to stand a mob on');
  if (floor !== null) {
    const stage = makeStage(map, floor.x, floor.y);
    const probe = new ProbeMob(floor.x + 1, floor.y);

    check(!probe.hasMap, 'a mob built outside the roster starts with no map');
    check(probe.injectedShellContext === null, 'and with no shell context');

    stage.roster.add(probe);

    check(stage.roster.mobs.includes(probe), 'add() puts the mob in the render/update list');
    const nearby = stage.roster.grid.queryCircle(probe.x, probe.y, PINPOINT_QUERY_RADIUS);
    check(nearby.has(probe), 'add() indexes it where it stands, so a swing can find it');
    check(probe.hasMap, 'add() hands it the map, without which it cannot path or collide');
    check(
      probe.injectedShellContext === stage.roster.spells,
      "add() hands it the roster's own SpellSystem, not a second instance",
    );

    // A real mob off the spawner, not just the harness's probe: the roster is
    // the only thing that puts one in the grid, and a mob the grid cannot find
    // is a mob nothing can hit.
    const rat = createMob('rat', floor.x + 1, floor.y, map);
    stage.roster.add(rat);
    check(
      stage.roster.grid.queryCircle(rat.x, rat.y, PINPOINT_QUERY_RADIUS).has(rat),
      'and is indexed by the same call',
    );
  }
}

console.log('\nreplaceAll swaps the population without swapping the array');
{
  const map = makeInterior();
  const stage = makeStage(map, PARKED_TILE, PARKED_TILE);
  const original = new ProbeMob(1, 1);
  stage.roster.add(original);

  // Exactly what a `SystemContext` and every spawn closure hold: the array
  // itself, captured before the rewind.
  const holder = stage.roster.mobs;
  const replacement = new ProbeMob(2, 1);
  stage.roster.replaceAll([replacement]);

  // Not the array identity — `readonly mobs` makes reassigning it a compile
  // error, so there is nothing here a test could catch. What can break is the
  // contents: a `replaceAll` that built a new array would leave the holder
  // reading the old population for ever.
  check(holder.length === 1 && holder[0] === replacement, 'and it sees the new population');
  check(!holder.includes(original), 'the replaced mob is gone from it');
}

console.log('\nrebuildGrid keeps exactly the mobs that still claim a cell');
{
  const map = makeInterior();
  const stage = makeStage(map, PARKED_TILE, PARKED_TILE);
  const survivor = new ProbeMob(1, 1);
  const casualty = new ProbeMob(3, 1);
  stage.roster.add(survivor);
  stage.roster.add(casualty);

  casualty.takeDamageFrom(casualty.maxHp, stage.pm.human, 'melee');
  // A probe mob does not draw when dead, so it should leave the grid on the very
  // frame it falls — no corpse animation to wait out.
  check(!casualty.belongsInMobGrid, 'and it stops claiming a cell the moment it falls');

  stage.roster.rebuildGrid();

  const survivorFound = stage.roster.grid
    .queryCircle(survivor.x, survivor.y, PINPOINT_QUERY_RADIUS)
    .has(survivor);
  const casualtyFound = stage.roster.grid
    .queryCircle(casualty.x, casualty.y, PINPOINT_QUERY_RADIUS)
    .has(casualty);
  check(survivorFound, 'a mob that still belongs in the grid is in the rebuilt one');
  check(!casualtyFound, 'a mob that no longer belongs is not');
  check(
    stage.roster.mobs.includes(casualty),
    'and it stays in the render list, where its corpse is drawn from',
  );
}

console.log('\nA kill through CombatKit pays out');
{
  const map = makeInterior();
  const floor = findFloorPairEastward(map);
  check(floor !== null, 'the generated store has open floor to stage a fight on');
  if (floor !== null) {
    const stage = makeStage(map, floor.x, floor.y);
    const combat = makeCombatKit(stage);
    const { human, cat } = stage.pm;

    const victim = createMob('rat', floor.x + 1, floor.y, map);
    stage.roster.add(victim);
    standWestFacing(stage, victim.x + HALF_TILE, victim.y + HALF_TILE);

    let killedEvents = 0;
    let killerWasHuman = false;
    const goreErrors: unknown[] = [];
    let bloodSpawnedByKill = 0;
    let partsSpawnedByKill = 0;
    stage.bus.on('mobKilled', (event) => {
      killedEvents++;
      killerWasHuman = event.killer === human;
      // Measured across the call rather than from zero because a landed swing
      // spatters blood of its own before the mob ever dies.
      const bloodBefore = combat.gore.liveCount;
      const partsBefore = combat.bodyPartGore.liveCount;
      // The scene's own subscription is what calls this; a throw in here would
      // otherwise take the whole harness down with it and report nothing.
      try {
        combat.spawnKillGore(event.mob, event.killer);
      } catch (error) {
        goreErrors.push(error);
      }
      bloodSpawnedByKill = combat.gore.liveCount - bloodBefore;
      partsSpawnedByKill = combat.bodyPartGore.liveCount - partsBefore;
    });

    const humanXpBefore = human.xp;
    const humanLevelBefore = human.level;
    const catXpBefore = cat.xp;
    const catLevelBefore = cat.level;

    let frames = 0;
    while (victim.isAlive && frames < MAX_FIGHT_FRAMES) {
      if (human.attackTimer === 0) human.triggerAttack();
      combat.updatePlayerAttacks();
      combat.resolvePlayerAttacks();
      combat.resolveKills();
      frames++;
    }

    check(!victim.isAlive, `swinging through the kit kills the mob (${frames} frames)`);
    check(killedEvents === 1, 'the death raises exactly one mobKilled on the world bus');
    check(killerWasHuman, 'and credits the crawler who swung');

    const humanGained = human.level > humanLevelBefore || human.xp > humanXpBefore;
    const catGained = cat.level > catLevelBefore || cat.xp > catXpBefore;
    check(humanGained, 'the killer is paid XP');
    check(catGained, 'and the companion is paid her share');

    check(goreErrors.length === 0, 'spawnKillGore runs on the death without throwing');
    check(bloodSpawnedByKill > 0, `and spatters blood (${bloodSpawnedByKill})`);
    check(partsSpawnedByKill > 0, `and scatters body parts (${partsSpawnedByKill})`);

    check(!victim.justDied, 'resolveKills consumes the death rather than re-resolving it');

    // A second pass with nothing left to resolve must stay silent — a death that
    // re-latched would pay the party for the same mob every frame.
    combat.resolveKills();
    check(killedEvents === 1, 'and a further pass raises no second mobKilled');
  }
}

console.log('\nFloor loot survives the door');
{
  const map = makeInterior();
  const floor = findFloorPairEastward(map);
  check(floor !== null, 'the generated store has open floor to drop loot on');
  if (floor !== null) {
    const stage = makeStage(map, floor.x, floor.y);
    const destruction = new DestructionKit(stage.world, OVERWORLD_FLOOR_NUMBER);
    const { human, cat } = stage.pm;

    const coinsBefore = human.coins;
    const potionsBefore = human.inventory.countOf('health_potion');
    const catCoinsBefore = cat.coins;

    destruction.loot.addLoot(
      human.x + HALF_TILE,
      human.y + HALF_TILE,
      { coins: SWEPT_COINS, items: [{ id: 'health_potion', quantity: SWEPT_POTIONS }] },
      human,
    );

    destruction.loot.sweepUncollected(stage.pm.players());

    check(human.coins === coinsBefore + SWEPT_COINS, "the pile's coins reach the owner's purse");
    check(
      human.inventory.countOf('health_potion') === potionsBefore + SWEPT_POTIONS,
      "and its items reach the owner's pack",
    );
    check(cat.coins === catCoinsBefore, 'an unshared pile pays nobody else');

    // A pile the player put down on purpose is the one thing the sweep must not
    // hand back: dropping to make room is the only way to get rid of an item,
    // and an interior that returns it at the door is the one place in the game
    // where that cannot be done.
    const droppedBefore = human.inventory.countOf('health_potion');
    destruction.loot.addPlayerDrop(human.x, human.y, 'health_potion', 1, human);
    destruction.loot.sweepUncollected(stage.pm.players());
    check(
      human.inventory.countOf('health_potion') === droppedBefore,
      'and an item the player dropped on purpose stays dropped',
    );

    // What this pins is "a pile is paid exactly once", with a fresh pile added
    // so the check cannot pass by sweeping doing nothing at all. It does not
    // pin *how*: `sweepUncollected` both empties the list and marks each pile
    // collected, and either alone would satisfy this. `pendingLoots` is private,
    // so which of the two is load-bearing is not observable from out here.
    destruction.loot.addLoot(
      human.x + HALF_TILE,
      human.y + HALF_TILE,
      { coins: RESWEPT_COINS, items: [] },
      human,
    );
    destruction.loot.sweepUncollected(stage.pm.players());
    check(
      human.coins === coinsBefore + SWEPT_COINS + RESWEPT_COINS &&
        human.inventory.countOf('health_potion') === potionsBefore + SWEPT_POTIONS,
      'a later sweep pays the new pile and not the one already taken',
    );
  }
}

console.log('\nDestructibles exist indoors and break');
{
  const map = makeInterior();
  const smashable = findSmashableTiles(map);
  check(
    smashable.length > 0,
    `the generated store lays down barrels or crates (${smashable.length})`,
  );
  const target = smashable[0];
  if (target !== undefined) {
    const stage = makeStage(map, PARKED_TILE, PARKED_TILE);
    const combat = makeCombatKit(stage);
    const destruction = new DestructionKit(stage.world, OVERWORLD_FLOOR_NUMBER);
    const extras = { destructibles: destruction.destructibles } as const;

    standWestFacing(stage, target.x * TILE_SIZE + HALF_TILE, target.y * TILE_SIZE + HALF_TILE);

    const targetTile = map.structure[target.y][target.x];
    const originalType = targetTile.type;
    let swingsThatConnected = 0;
    stage.bus.on('humanMeleeSwing', (event) => {
      if (event.hit) swingsThatConnected++;
    });

    const { human } = stage.pm;
    let frames = 0;
    while (targetTile.type === originalType && frames < MAX_FIGHT_FRAMES) {
      if (human.attackTimer === 0) human.triggerAttack();
      combat.updatePlayerAttacks();
      combat.resolvePlayerAttacks(extras);
      frames++;
    }

    check(swingsThatConnected > 0, 'a swing through the kit connects with the prop');
    check(targetTile.type !== originalType, `enough hits open the tile up (${frames} frames)`);

    // The count, not merely "some": one barrel is one cue, and the scene plays
    // a single sample however many props gave way — a prop double-counted here
    // is a smash that sounds like a blast.
    const smashes = destruction.destructibles.drainSmashes();
    check(smashes.wood === 1, `the break is reported as one splitting-wood cue (${smashes.wood})`);
    // Drained, not merely read: a counter that reports without resetting replays
    // the same cue every frame for the rest of the floor.
    check(
      destruction.destructibles.drainSmashes().wood === 0,
      'and the count is drained by reading it',
    );
  }
}

console.log('\nCombatKit.dispose releases the module-level pack-alert grid');
{
  const map = makeInterior();
  const stage = makeStage(map, PARKED_TILE, PARKED_TILE);
  const combat = makeCombatKit(stage);

  const shouter = new ProbeMob(PACK_STANDOFF_TILES, PACK_STANDOFF_TILES);
  const listener = new ProbeMob(PACK_STANDOFF_TILES + 1, PACK_STANDOFF_TILES);
  stage.roster.add(shouter);
  stage.roster.add(listener);

  // `MobUpdateLoop` is what publishes the grid, so the kit has to have run a
  // frame before there is anything for dispose to release.
  combat.updateMobs(makeContext(stage));
  alertPackAround(shouter, PACK_ALERT_RADIUS_PX, stage.pm.human);
  check(listener.currentTarget === stage.pm.human, 'a live kit lets a packmate hear a shout');

  listener.currentTarget = null;
  combat.dispose();
  alertPackAround(shouter, PACK_ALERT_RADIUS_PX, stage.pm.human);
  check(
    listener.currentTarget === null,
    'after dispose the shout reaches nobody, so the grid was dropped',
  );
}

console.log('\nCombatKit re-reads the world it was handed');
{
  const map = makeInterior();
  const stage = makeStage(map, PARKED_TILE, PARKED_TILE);
  const combat = makeCombatKit(stage);

  // `updateMobs` documents spells-then-mob-AI; the spell half is observable
  // through the shell's own cooldown, which only ticks when it is updated.
  const shellLevel = stage.pm.human.getProtectiveShellLevel();
  combat.spells.triggerProtectiveShell(stage.pm.human, stage.pm.cat, stage.roster.grid, shellLevel);
  const cooldownBefore = combat.spells.shellCooldown;
  combat.updateMobs(makeContext(stage));
  check(
    cooldownBefore > 0 && combat.spells.shellCooldown < cooldownBefore,
    'updateMobs ticks the spell system as well as the mob AI',
  );

  // `resolveKills` re-reads the grid so a checkpoint rewind that replaced it
  // cannot leave a corpse indexed in the live one. The rewind has to happen
  // while the mob is still alive — a corpse is excluded by `rebuildGrid` itself,
  // so killing it first would make this pass whichever grid was read.
  const casualty = new ProbeMob(PARKED_TILE + 2, PARKED_TILE);
  stage.roster.add(casualty);
  stage.roster.rebuildGrid();
  casualty.takeDamageFrom(casualty.maxHp, stage.pm.human, 'melee');
  combat.resolveKills();
  check(
    !stage.roster.grid.queryCircle(casualty.x, casualty.y, PINPOINT_QUERY_RADIUS).has(casualty),
    'and resolveKills clears the corpse out of the grid the rewind just built',
  );
}

console.log('\nA swing resolves against the grid the roster holds now');
{
  const map = makeInterior();
  const floor = findFloorPairEastward(map);
  check(floor !== null, 'the generated store has open floor to swing on');
  if (floor !== null) {
    const stage = makeStage(map, floor.x, floor.y);
    const combat = makeCombatKit(stage);

    // The rewind happens *before* the target joins, so the grid the kit was
    // constructed around has never contained it. A swing that resolved against
    // that stale index would pass straight through the mob.
    stage.roster.rebuildGrid();
    const target = createMob('rat', floor.x + 1, floor.y, map);
    stage.roster.add(target);
    standWestFacing(stage, target.x + HALF_TILE, target.y + HALF_TILE);

    const hpBefore = target.hp;
    let landed = false;
    let frames = 0;
    while (!landed && frames < MAX_FIGHT_FRAMES) {
      if (stage.pm.human.attackTimer === 0) stage.pm.human.triggerAttack();
      combat.updatePlayerAttacks();
      landed = combat.resolvePlayerAttacks().hitLanded;
      frames++;
    }
    check(landed, `the swing reports a hit (${frames} frames)`);
    check(target.hp < hpBefore, 'and the mob added after the rewind actually takes the damage');
  }
}

console.log('\nSpawn placement never stacks two bodies on one tile');
{
  const map = makeInterior();
  const start = map.startTile;
  // Three requests for the *same* tile. Nothing on the shipped tower layout ever
  // collides, so asking the real placement helper for a collision is the only
  // way to exercise the guard that keeps two guards off one square.
  const crowded = [start, start, start];
  const placed = distinctSpawnTiles(map, crowded, SPAWN_SEARCH_RADIUS);
  check(placed.length === crowded.length, `every crowded request is placed (${placed.length}/3)`);
  check(
    new Set(placed.map((tile) => `${tile.x},${tile.y}`)).size === placed.length,
    'and no two of them land on the same tile',
  );

  // Aimed at the wall, not at open ground: a request that already stands on
  // floor is placed there whether or not anything tested it, so the walkability
  // half of the contract is only visible when the request is somewhere a body
  // cannot go.
  const inWall = [{ x: 0, y: 0 }];
  const nudged = distinctSpawnTiles(map, inWall, SPAWN_SEARCH_RADIUS);
  check(nudged.length === 1, 'a request aimed into the masonry still finds a tile');
  check(
    nudged.every((tile) => map.isWalkable(tile.x, tile.y)),
    'and that tile is open floor rather than the wall it was aimed at',
  );
}

console.log('\nRoom to move is measured on both axes');
{
  // A tower storey is 20 wide and 16 tall. A bound taken from the row count
  // alone calls every column past 15 out of bounds, which walls off the eastern
  // strip — where the stair up and the counters are — to the flood fill.
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior('tower', FIRST_GUARDED_TOWER_FLOOR, TOWER_NAME);
  const rows = map.structure.length;
  const columns = map.structure[0].length;
  check(columns > rows, `the storey is wider than it is tall (${columns}x${rows})`);
  const eastern = { x: columns - 2, y: 2 };
  check(map.isWalkable(eastern.x, eastern.y), 'and its eastern strip is open floor');
  check(hasRoomToMove(map, eastern.x, eastern.y), 'which the room-to-move test can see');
}

console.log('\nA room with hostiles in it is content, not wiring');
{
  const memory = createTownMemory();
  const quiet = createMurderQuestProgress();
  const confronting = { ...quiet, stage: 'confrontation' as const };

  // Every guarded storey, not one of them: each tower floor lays out its own
  // furniture, so an offset that clears the library can still land in the
  // quarters, and a gate that measures one floor would ship the other broken.
  for (const floor of GUARDED_TOWER_FLOORS) {
    const towerFloor = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
    towerFloor.generateInterior('tower', floor, TOWER_NAME);
    const base: InteriorHostileContext = {
      buildingName: TOWER_NAME,
      buildingType: 'tower',
      floor,
      map: towerFloor,
      memory,
      murderQuest: quiet,
      partyLevel: GATE_PARTY_LEVEL,
    };
    const held: InteriorHostileContext = { ...base, murderQuest: confronting };

    check(
      interiorHostilesFor(base).length === 0,
      `floor ${floor} is empty until the questline gives the cult a reason to hold it`,
    );

    const guards = interiorHostilesFor(held);
    const fullGarrison = guards.length === EXPECTED_STAIR_GUARDS;
    check(
      fullGarrison,
      `floor ${floor} posts every stair guard (${guards.length}/${EXPECTED_STAIR_GUARDS})`,
    );
    // Gated on the count: `every` over a short list is vacuously true, so a
    // dropped guard would otherwise be one FAIL wearing three false greens.
    if (fullGarrison) {
      check(
        guards.every((guard) => guard.mobLevel === CULT_HIDEOUT_CULTIST_LEVEL),
        `floor ${floor}'s guards match the congregation the party already fought`,
      );
      check(
        guards.every((guard) => guard.forceAggro),
        `floor ${floor}'s guards wake on arrival rather than waiting to be walked up to`,
      );
      const tiles = guards.map((guard) => ({
        x: Math.floor(guard.x / TILE_SIZE),
        y: Math.floor(guard.y / TILE_SIZE),
      }));
      check(
        new Set(tiles.map((tile) => `${tile.x},${tile.y}`)).size === tiles.length,
        `floor ${floor}'s guards each stand on a tile of their own`,
      );

      // The tiles the table *asks* for, not the tiles the search settled on:
      // `findNearbyWalkableTile` rescues an offset that lands in furniture, so
      // asserting the result is walkable only re-states what the search did.
      const anchor = towerFloor._interiorStairUpTiles[0];
      const intended = STAIR_GUARD_OFFSETS.map((offset) => ({
        x: anchor.x + offset.dx,
        y: anchor.y + offset.dy,
      }));
      // Both halves of what the nudger's *first* pass accepts. `isWalkable` is
      // what catches an offset aimed at furniture; `hasRoomToMove` is the half
      // that would catch one aimed at a pocket, which this map has none of —
      // carried anyway, because the map is the thing most likely to change.
      check(
        intended.every(
          (tile) =>
            towerFloor.isWalkable(tile.x, tile.y) && hasRoomToMove(towerFloor, tile.x, tile.y),
        ),
        `floor ${floor}'s offsets name open floor rather than relying on the nudge`,
      );

      // Spread across the crossing rather than huddled at one end of it, so the
      // party meets the line instead of walking past it.
      const stairUp = towerFloor._interiorStairUpTiles[0];
      const stairDown = towerFloor._interiorStairDownTiles[0];
      const spread = Math.max(...tiles.map((t) => t.x)) - Math.min(...tiles.map((t) => t.x));
      const crossing = Math.abs(stairUp.x - stairDown.x);
      check(
        spread >= crossing * MIN_LINE_SPREAD_FRACTION,
        `floor ${floor}'s line spans the crossing (${spread}/${crossing} tiles)`,
      );

      // And inside the band the crossing runs through, rather than off in a
      // corner of the room the party has no reason to walk into. `forceAggro`
      // means a guard anywhere would eventually arrive; being *met* on the way
      // is what makes it a picket line rather than a chase.
      check(
        tiles.every((tile) => tile.y - stairUp.y <= MAX_GUARD_BAND_TILES),
        `floor ${floor}'s guards stay in the band the crossing runs through`,
      );

      // Far enough off *both* landings that the party sees them before they are
      // being cast at — a party can arrive at either stair, climbing or
      // retreating, and a caster spawned underfoot is an ambush nobody can read.
      const landings = [arrivalBelow(stairDown), arrivalBelow(stairUp)];
      const closest = Math.min(
        ...landings.flatMap((landing) =>
          tiles.map((tile) => Math.hypot(tile.x - landing.x, tile.y - landing.y)),
        ),
      );
      check(
        closest >= MIN_GUARD_STANDOFF_TILES,
        `floor ${floor} keeps its nearest guard off either landing (${closest.toFixed(1)} tiles)`,
      );
    }
  }

  // One storey's clearing is its own; the roster and the memory are per room.
  const cleared = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  cleared.generateInterior('tower', FIRST_GUARDED_TOWER_FLOOR, TOWER_NAME);
  const clearedContext: InteriorHostileContext = {
    buildingName: TOWER_NAME,
    buildingType: 'tower',
    floor: FIRST_GUARDED_TOWER_FLOOR,
    map: cleared,
    memory,
    murderQuest: confronting,
    partyLevel: GATE_PARTY_LEVEL,
  };
  const stage = makeStage(cleared, PARKED_TILE, PARKED_TILE);
  const guards = interiorHostilesFor(clearedContext);
  // Through the roster the storey already had: the whole claim of the kit
  // architecture is that this is all a new fight costs.
  for (const guard of guards) stage.roster.add(guard);
  const anyGuard = guards[0];
  check(
    anyGuard !== undefined && stage.roster.mobs.includes(anyGuard),
    'they join through the roster the storey already had',
  );
  check(
    anyGuard !== undefined &&
      stage.roster.grid.queryCircle(anyGuard.x, anyGuard.y, PINPOINT_QUERY_RADIUS).has(anyGuard),
    'so they are in its spatial index and can be hit',
  );

  noteRoomCleared(memory, TOWER_NAME, FIRST_GUARDED_TOWER_FLOOR);
  check(
    interiorHostilesFor(clearedContext).length === 0,
    'a cleared room stays cleared, so walking back in is not a farm',
  );
  check(
    interiorHostilesFor({ ...clearedContext, floor: SECOND_GUARDED_TOWER_FLOOR }).length > 0,
    'and clearing one storey does not clear the next',
  );
  // Built from an *uncleared* room, or the cleared-rooms guard answers first and
  // the branch under test is never reached.
  const uncleared: InteriorHostileContext = {
    ...clearedContext,
    buildingName: `${TOWER_NAME} (untouched)`,
  };
  check(
    interiorHostilesFor({ ...uncleared, floor: GROUND_FLOOR }).length === 0,
    'the ground floor stays walkable, so the party can get in and back out',
  );
  check(
    interiorHostilesFor({ ...uncleared, floor: TOP_TOWER_FLOOR }).length === 0,
    "and the top floor is left to Quill's own confrontation",
  );
  check(
    interiorHostilesFor({ ...uncleared, buildingType: 'store' }).length === 0,
    'and no other building type is garrisoned',
  );
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('\nAll kit checks passed.\n');
