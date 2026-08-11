#!/usr/bin/env tsx
/**
 * Headless checks on the four behaviours the companion-AI work fixed: an
 * attributable status-effect kill, a boss-room veto that answers to blood
 * rather than to a mob's glance, a leash that actually ends a chase, and a
 * companion cat that uses her claws.
 *
 * Everything here is arithmetic and state, which is exactly the half of
 * companion behaviour a human cannot sign off by eye. The other half — whether
 * the swipe reads as opportunistic rather than suicidal, whether the leash
 * turnaround looks deliberate — still needs a playthrough; `requestAnimationFrame`
 * stalls to about a frame a second in an occluded window, so nothing about feel
 * or timing can be trusted from automation.
 *
 * Run: npx tsx scripts/verify-companion.ts
 */
import { createCanvas } from 'canvas';

import { TILE_SIZE, COMPANION_LEASH_PX } from '../src/core/constants';
import { GameMap } from '../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../src/map/tileTypes';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { Mob } from '../src/creatures/Mob';
import { createMob } from '../src/levels/spawner';
import { makeSepsis, makeBurn } from '../src/core/StatusEffect';
import { CompanionSystem } from '../src/systems/CompanionSystem';
import { MELEE_POINT_BLANK_RANGE } from '../src/systems/CombatSystem';
import { MIN_STAT_VALUE } from '../src/Player';
import { BossRoomSystem } from '../src/systems/BossRoomSystem';
import { MiniMapSystem } from '../src/systems/MiniMapSystem';
import { TreasureChestSystem } from '../src/systems/TreasureChestSystem';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import type { SystemContext } from '../src/systems/GameSystem';

/**
 * The one browser global the minimap reaches for when `OffscreenCanvas` is
 * absent, backed by node-canvas — `BossRoomSystem` needs a real minimap and a
 * real minimap needs a tile cache to draw into.
 */
interface CanvasGlobals {
  document?: unknown;
}
const globals: CanvasGlobals = globalThis;
globals.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`verify-companion cannot create <${tag}>`);
    return createCanvas(1, 1);
  },
};

const MAP_SIZE = 80;
/** Redraws allowed when an unseeded layout comes up without the feature a check needs. */
const MAP_GENERATION_ATTEMPTS = 20;
/**
 * Every map here is built at the game's own tile size. A `GameMap` left on its
 * default tile height measures world pixels against a ten-pixel grid, and every
 * `hasLineOfSight` call then returns false — which would make the sight-gated
 * checks below pass for entirely the wrong reason.
 */
const MAP_OPTIONS = { mapSize: MAP_SIZE, tileHeight: TILE_SIZE } as const;
/**
 * Long enough for a one-damage-per-two-seconds sepsis tick to finish any
 * ordinary floor-1 mob, with room to spare. The loops below stop on death, so
 * this only bounds a failure.
 */
const MAX_STATUS_FRAMES = 60 * 60 * 10;
/** Frames of companion AI to run before reading a decision off it. */
const SETTLE_FRAMES = 3;
/** The ban a broken leash imposes, mirrored from `CompanionSystem`. */
const EXPECTED_TARGET_BAN_FRAMES = 90;
/** Comfortably inside the cat's 1.6-tile claw reach. */
const POINT_BLANK_TILES = 1;
/** Comfortably outside it, and inside her missile range. */
const MISSILE_RANGE_TILES = 5;
/** How far outside the leash the cat is dragged for the leash-break check. */
const BEYOND_LEASH_PX = COMPANION_LEASH_PX * 2;
/** Ten seconds — far longer than a goblin standing next to somebody needs to hit them. */
const MAX_ENGAGE_FRAMES = 600;
/** Any boss-room index; the chest checks only care that one system agrees with itself. */
const BOSS_ROOM_UNDER_TEST = 0;
/** Any walkable-looking tile: nothing in the chest checks reads the map. */
const CHEST_TILE = 10;
/** How far outside the boss room's wall the party waits in the corridor. */
const PARTY_STANDOFF_TILES = 2;
/** One frame past the un-entered regen delay, mirrored from `BossRoomSystem`. */
const EXPECTED_UNENTERED_REGEN_FRAMES = 302;
/** Enough to be unambiguously a wound, and nowhere near a kill. */
const DOORWAY_SNIPE_DAMAGE = 5;
/** Comfortably inside the regen delay — the player takes a couple of seconds to cross the threshold. */
const THRESHOLD_ENTRY_FRAMES = 120;
/** A swipe is committed half an animation before it lands, so a pursuer is allowed to back out of some. */
const MIN_SWIPE_CONNECT_RATE = 0.6;
/** Enough strength that the claw out-damages the missile she would otherwise be firing. */
const BRAWLER_STRENGTH = 12;
/** The cat's own claw reach, restated so the two fights are compared against one number. */
const CAT_MELEE_REACH_PX = TILE_SIZE * 1.6;
/** Roughly a companion cat's cadence at a levelled missile. */
const SNIPE_INTERVAL_FRAMES = 10;
/** Long enough for several regen windows to come and go under fire. */
const SNIPE_ROUNDS = 3;
/** Twenty seconds of fighting — several full missile and claw cycles at any ability level. */
const KITE_FIGHT_FRAMES = 1200;
/** Deep enough past any boss's enrage threshold to be unambiguous. */
const ENRAGE_CHIP_FRACTION = 0.75;
/** Far longer than any swing animation in the game. */
const SWING_SETTLE_FRAMES = 600;
/** Twenty seconds at her slowest cadence is a dozen shots; anything near zero means she stopped. */
const MIN_CASTS_PER_FIGHT = 5;
/** Enough pursuers that standing still would be fatal; the crowd rule has to see them. */
const SWARM_SIZE = 3;
/** Far enough from the human that a mob chasing the cat is unambiguously chasing the cat. */
const CAT_STANDOFF_TILES = 3;
/** Low enough that a single unblocked tick would be visible, high enough not to be a rounding artefact. */
const SHIELDED_DUMMY_HP = 20;
/** Several sepsis intervals — one unblocked tick anywhere in there fails the check. */
const SHIELDED_TICK_FRAMES = 900;
/** Where the chasing rat starts: outside claw reach, inside the cat's acquisition range. */
const CHASER_START_TILES = 5;
/**
 * Half-width of the clear floor a staged fight needs: the kite's own stand-off,
 * plus room to give ground and still be retreating rather than cornered. The
 * largest a generated dungeon reliably offers — at nine, no map has one.
 */
const OPEN_GROUND_RADIUS_TILES = 8;

/** The building a tower interior is generated for; nothing here reads the name but the generator wants one. */
const INTERIOR_BUILDING_NAME = 'Verification Tower';
/** Storeys of that tower the interior checks use: one to fight on, one to climb to. */
const INTERIOR_GROUND_FLOOR = 0;
const INTERIOR_UPPER_FLOOR = 1;
/**
 * Where a staged interior combatant stands: past the tile the party occupies, and
 * well inside the cat's acquisition range in a room only a few tiles across.
 */
const INTERIOR_NEIGHBOUR_MIN_TILES = 2;
const INTERIOR_NEIGHBOUR_MAX_TILES = 4;

/**
 * A hand-built floor plan, split by one sealed wall column, for proving
 * `setMap` re-seeds the map `CompanionSystem` actually collides against —
 * rather than just the position it drops the companion at.
 *
 * Companion positions are absolute pixels, so a cat closing distance on the
 * human after `update()` is true whichever `GameMap` is behind it — the whole
 * floor could still be the one `setMap` was supposed to leave. Two floors that
 * differ only in whether one tile blocks movement turn that into something a
 * distance check can't paper over: only the correct map ever stops her at the
 * wall, and only the wrong one ever lets her walk through where it stood.
 *
 * Bounded on every side, not just at the partition, so a map that survived
 * the bug can't be told apart from one that got A* to route around it.
 */
const PARTITION_FLOOR_SIZE = 16;
const PARTITION_WALL_TILE_X = 8;
const PARTITION_CAT_TILE = { x: 6, y: 8 };
const PARTITION_HUMAN_TILE = { x: 10, y: 8 };
/** Comfortably enough steps at `FOLLOWER_SPEED` to close on — or be stopped at — the wall. */
const PARTITION_FOLLOW_FRAMES = 90;

/**
 * A dungeon that actually generated a boss room, and one with clear floor to
 * stage a fight on.
 *
 * The generator runs on unseeded randomness, so a layout missing either turns
 * up every so often. Retrying is not papering over anything — the checks below
 * are about companion behaviour, not about map generation — and a gate that
 * fails on the weather is a gate somebody eventually mutes.
 */
function makeBossRoomMap(): GameMap | null {
  for (let attempt = 0; attempt < MAP_GENERATION_ATTEMPTS; attempt++) {
    const map = new GameMap(MAP_OPTIONS);
    if (map.bossRooms.length > 0) return map;
  }
  return null;
}

function makeOpenGroundMap(): { map: GameMap; ground: { x: number; y: number } } | null {
  for (let attempt = 0; attempt < MAP_GENERATION_ATTEMPTS; attempt++) {
    const map = new GameMap(MAP_OPTIONS);
    const ground = findOpenGround(map);
    if (ground !== null) return { map, ground };
  }
  return null;
}

/** Straight-line distance between two entities, in tiles. */
function distanceTiles(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

interface Party {
  map: GameMap;
  human: HumanPlayer;
  cat: CatPlayer;
  roster: MobRoster;
}

/** A human-active party standing on the map's start tile, with an empty world. */
function makeParty(map: GameMap): Party {
  const start = map.startTile;
  const human = new HumanPlayer(start.x, start.y, TILE_SIZE);
  const cat = new CatPlayer(start.x, start.y, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  return { map, human, cat, roster: new MobRoster(map, new SpellSystem()) };
}

function addMob(party: Party, type: string, tileX: number, tileY: number): Mob {
  const mob = createMob(type, tileX, tileY, party.map);
  party.roster.add(mob);
  return mob;
}

/**
 * The slice of `SystemContext` the companion AI reads, built by hand so a field
 * it starts depending on surfaces here as a compile error rather than as
 * silently absent behaviour.
 */
function makeContext(party: Party, bossRoom?: BossRoomSystem): SystemContext {
  const active = party.human.isActive ? party.human : party.cat;
  const inactive = party.human.isActive ? party.cat : party.human;
  return {
    human: party.human,
    cat: party.cat,
    active,
    inactive,
    activeIsMoving: false,
    roster: party.roster,
    gameMap: party.map,
    ...(bossRoom ? { bossRoom } : {}),
  };
}

function runCompanion(
  system: CompanionSystem,
  party: Party,
  frames: number,
  bossRoom?: BossRoomSystem,
): void {
  for (let frame = 0; frame < frames; frame++) system.update(makeContext(party, bossRoom));
}

/**
 * One frame of the scene loop as far as a companion fight is concerned: mob AI
 * and movement, then the companion's decision, then the crawler timers that
 * clear her attack cooldowns.
 *
 * Everything here matters. Driving `CompanionSystem.update` on its own leaves
 * every cooldown frozen at whatever it was, so the cat would appear to swing
 * once and never again — which is precisely the kind of stall a harness that
 * only calls the system under test cannot see.
 */
function runFightFrame(system: CompanionSystem, party: Party): void {
  for (const mob of party.roster.mobs) {
    if (!mob.isAlive) continue;
    const ox = mob.x;
    const oy = mob.y;
    mob.updateAI([party.human, party.cat]);
    mob.tickTimers();
    party.roster.grid.move(mob, ox, oy);
  }
  system.update(makeContext(party));
  party.human.updateAttack();
  party.cat.updateAttack();
  party.cat.updateMissiles(party.roster.grid);
  party.human.tickTimers();
  party.cat.tickTimers();
}

/**
 * A tile with clear floor all around it, for the checks that need something to
 * actually walk. A generated dungeon puts the start tile against a wall as
 * often as not, and a rat that cannot cross the room never gets close enough to
 * be clawed — a failure that reads exactly like the AI refusing to swipe.
 */
function findOpenGround(map: GameMap): { x: number; y: number } | null {
  const size = map.structure.length;
  for (let y = OPEN_GROUND_RADIUS_TILES; y < size - OPEN_GROUND_RADIUS_TILES; y++) {
    for (let x = OPEN_GROUND_RADIUS_TILES; x < size - OPEN_GROUND_RADIUS_TILES; x++) {
      let clear = true;
      for (let dy = -OPEN_GROUND_RADIUS_TILES; dy <= OPEN_GROUND_RADIUS_TILES && clear; dy++) {
        for (let dx = -OPEN_GROUND_RADIUS_TILES; dx <= OPEN_GROUND_RADIUS_TILES && clear; dx++) {
          if (!map.isWalkable(x + dx, y + dy)) clear = false;
        }
      }
      if (clear) return { x, y };
    }
  }
  return null;
}

/** One storey of a tower interior, in the state the scene generates it. */
function makeInterior(floor: number): GameMap {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior('tower', floor, INTERIOR_BUILDING_NAME, false);
  return map;
}

function makePartitionFloorTile(x: number, y: number, type: number): TileContent {
  return { tileId: `${x}#${y}`, type };
}

/**
 * A `PARTITION_FLOOR_SIZE`-square room, walled on every edge, with an
 * unbroken wall column at `PARTITION_WALL_TILE_X` when `withWall` is true.
 * With the wall, the two halves have no route between them at all — not even
 * through the pathfinder — so nothing short of the real map switch can carry
 * a companion from one side to the other.
 */
function makePartitionFloor(withWall: boolean): GameMap {
  const grid: TileContent[][] = Array.from({ length: PARTITION_FLOOR_SIZE }, (_, y) =>
    Array.from({ length: PARTITION_FLOOR_SIZE }, (_, x) => {
      const isBorder =
        x === 0 || y === 0 || x === PARTITION_FLOOR_SIZE - 1 || y === PARTITION_FLOOR_SIZE - 1;
      const isPartition = withWall && x === PARTITION_WALL_TILE_X;
      const type = isBorder || isPartition ? FloorTypeValue.wall : FloorTypeValue.tile_floor;
      return makePartitionFloorTile(x, y, type);
    }),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

/**
 * Somewhere in the same room to stand, a couple of tiles off `from`.
 *
 * An interior is a handful of tiles across and full of furniture, so the
 * dungeon's clear-floor search finds nothing here — this asks only for a tile
 * that is walkable and in plain sight of the party, which is all a follow or an
 * acquisition needs.
 */
function nearbyWalkable(
  map: GameMap,
  from: { x: number; y: number },
): { x: number; y: number } | null {
  const centre = TILE_SIZE * 0.5;
  for (
    let radius = INTERIOR_NEIGHBOUR_MIN_TILES;
    radius <= INTERIOR_NEIGHBOUR_MAX_TILES;
    radius++
  ) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const tile = { x: from.x + dx, y: from.y + dy };
        if (!map.isWalkable(tile.x, tile.y)) continue;
        if (
          !map.hasLineOfSight(
            from.x * TILE_SIZE + centre,
            from.y * TILE_SIZE + centre,
            tile.x * TILE_SIZE + centre,
            tile.y * TILE_SIZE + centre,
          )
        ) {
          continue;
        }
        return tile;
      }
    }
  }
  return null;
}

/** Ticks a mob's timers until its statuses have killed it, or the cap runs out. */
function tickUntilDead(mob: Mob): number {
  let frames = 0;
  while (mob.hp > 0 && frames < MAX_STATUS_FRAMES) {
    mob.tickTimers();
    frames++;
  }
  return frames;
}

console.log('A status-effect kill is an attributable kill');
{
  const party = makeParty(new GameMap(MAP_OPTIONS));
  const victim = addMob(party, 'goblin', party.map.startTile.x + 3, party.map.startTile.y);
  const startingHp = victim.hp;
  victim.applyStatus(makeSepsis(party.human));
  const frames = tickUntilDead(victim);

  check(victim.hp === 0, `sepsis alone finishes the mob (${frames} frames)`);
  check(victim.justDied, 'a death nobody swung for still latches justDied');
  check(victim.killedBy === party.human, 'the crawler who applied the sepsis is the killer');
  check(
    victim.damageTakenBy.get(party.human) === startingHp,
    `every tick lands in the damage ledger (${victim.damageTakenBy.get(party.human) ?? 0}/${startingHp})`,
  );
  check(victim.wasDamagedByParty, 'the party reads as having damaged it');
  check(victim.killType === null, 'a status is not a weapon, so killType stays null');
}

console.log('\nThe one boss with its own death path credits the same crawler');
{
  const party = makeParty(new GameMap(MAP_OPTIONS));
  // The Ball of Swine converts a lethal tick into a real death of its own, so
  // that its burst can be held and its Tusklings can spawn. That bespoke path
  // used to credit whichever crawler it happened to be charging, which handed
  // the human a melee kill — and the boss chest — off the cat's crown.
  const swine = addMob(party, 'ball_of_swine', party.map.startTile.x + 3, party.map.startTile.y);
  swine.currentTarget = party.human;
  swine.applyStatus(makeSepsis(party.cat));
  tickUntilDead(swine);

  check(swine.hp === 0, 'sepsis finishes the ball');
  check(swine.killedBy === party.cat, 'and credits the crawler whose crown did it');
  check(swine.killType === null, 'without calling a status a punch');
}

console.log('\nAn ownerless damage-over-time still kills, just anonymously');
{
  const party = makeParty(new GameMap(MAP_OPTIONS));
  const victim = addMob(party, 'goblin', party.map.startTile.x + 3, party.map.startTile.y);
  victim.applyStatus(makeBurn());
  tickUntilDead(victim);

  check(victim.hp === 0 && victim.justDied, 'an unowned burn still resolves the death');
  check(victim.killedBy === null, 'nobody is credited for it');
  check(!victim.wasDamagedByParty, 'and the party is not credited either');
}

console.log('\nA damage-over-time tick cannot walk through a boss shield');
{
  /**
   * Stands in for Grimaldi behind his tendrils and Miss Quill behind her
   * capacitor: both refuse damage while the thing guarding them lives.
   *
   * The shield used to live only on the swung route, so one sepsis proc — which
   * lands even on a blow the shield swallowed — dissolved the whole "kill the
   * adds first" mechanic, and after the attribution work it would have been
   * paid the kill credit, the XP and the boss chest for doing it.
   */
  class ShieldedDummy extends Mob {
    readonly xpValue = 0;
    protected override get isDamageImmune(): boolean {
      return true;
    }
    updateAI(): void {}
    protected drawSelf(): void {}
  }

  const map = new GameMap(MAP_OPTIONS);
  const party = makeParty(map);
  const shielded = new ShieldedDummy(
    map.startTile.x,
    map.startTile.y,
    TILE_SIZE,
    SHIELDED_DUMMY_HP,
    0,
  );
  shielded.applyStatus(makeSepsis(party.human));
  check(shielded.statusEffects.length === 0, 'the shield refuses the status, not just its damage');

  // Driven straight at the damage door as well, because the refusal above means
  // no tick would ever reach it — and that door is the one the whole exploit
  // went through.
  shielded.takeDamage(SHIELDED_DUMMY_HP, {
    kind: 'status',
    effectType: 'sepsis',
    applier: party.human,
  });
  shielded.takeDamageFrom(SHIELDED_DUMMY_HP, party.human, 'melee');
  for (let frame = 0; frame < SHIELDED_TICK_FRAMES; frame++) shielded.tickTimers();

  check(shielded.hp === shielded.maxHp, 'and holds against a tick aimed straight at it');
  check(!shielded.justDied && shielded.killedBy === null, 'so nobody is credited with anything');
}

console.log('\nCalling a fight off puts the boss back the way the party found it');
{
  const party = makeParty(new GameMap(MAP_OPTIONS));
  const juicer = addMob(party, 'juicer', party.map.startTile.x + 3, party.map.startTile.y);
  const restingSpeed = juicer.moveSpeed;

  juicer.takeDamageFrom(Math.ceil(juicer.maxHp * ENRAGE_CHIP_FRACTION), party.human, 'melee');
  juicer.updateAI([party.human, party.cat]);
  check(juicer.isEnraged === true, 'chipping the Juicer enrages him');
  check(juicer.moveSpeed > restingSpeed, 'and speeds him up');

  juicer.healAndForgetFight();
  check(juicer.hp === juicer.maxHp, 'calling the fight off heals him');
  check(juicer.isEnraged === false, 'and un-enrages him');
  check(
    juicer.moveSpeed === restingSpeed,
    `so the next fight is the one the party first met (${juicer.moveSpeed} vs ${restingSpeed})`,
  );

  // The checkpoint route to the same place. Both rewinds share one hook, and a
  // boss that un-enrages down one of them and not the other is the harder bug
  // to notice, because only one of them happens on a good run.
  juicer.takeDamageFrom(Math.ceil(juicer.maxHp * ENRAGE_CHIP_FRACTION), party.human, 'melee');
  juicer.updateAI([party.human, party.cat]);
  juicer.resetToSpawn();
  check(
    juicer.isEnraged === false && juicer.moveSpeed === restingSpeed,
    'and a checkpoint rewind unwinds the same phase',
  );
}

console.log('\nA swing is over when its animation is');
{
  const party = makeParty(new GameMap(MAP_OPTIONS));
  check(!party.human.isSwinging, 'nobody starts mid-swing');
  party.human.triggerAttack();
  check(party.human.isSwinging, 'and a punch reads as one while it plays');
  for (let frame = 0; frame < SWING_SETTLE_FRAMES; frame++) party.human.updateAttack();
  // A latch here strands the human companion facing whichever way he threw his
  // first punch, for the rest of the floor: the follower stops re-aiming him
  // for exactly as long as this reads true.
  check(!party.human.isSwinging, 'and stops reading as one once it finishes');
}

console.log('\nA mob that has only looked at the party has not engaged it');
{
  const party = makeParty(new GameMap(MAP_OPTIONS));
  const watcher = addMob(party, 'goblin', party.map.startTile.x + 3, party.map.startTile.y);
  watcher.currentTarget = party.human;

  check(!watcher.hasStruckPlayer, 'noticing a crawler is not striking one');
  check(!watcher.wasDamagedByParty, 'and nobody has hit it back');

  watcher.takeDamageFrom(1, party.cat, 'missile');
  check(watcher.wasDamagedByParty, 'one real blow from the cat is engagement');

  watcher.resetToSpawn();
  check(
    !watcher.hasStruckPlayer && !watcher.wasDamagedByParty,
    'a checkpoint rewind unlearns the whole fight',
  );
}

console.log('\nThe companion holds fire on a boss nobody has touched or walked in on');
{
  const map = makeBossRoomMap();
  const room = map?.bossRooms[0];
  if (map === null || room === undefined) {
    check(false, 'a generated dungeon offered a boss room to test with');
  } else {
    const party = makeParty(map);
    const bossRoom = new BossRoomSystem(map, new MiniMapSystem(map), ['krakaren_clone']);
    const companion = new CompanionSystem(map, map.startTile.x, map.startTile.y);

    // Boss just inside the room's west wall and the party just outside it: a
    // boss room is wider than the companion's acquisition radius, so a boss
    // parked at the far centre would be ignored on distance alone and the veto
    // below would never be the thing under test.
    const boss = addMob(party, 'krakaren_clone', room.bounds.x + 1, room.centre.y);
    party.human.x = (room.bounds.x - PARTY_STANDOFF_TILES) * TILE_SIZE;
    party.human.y = room.centre.y * TILE_SIZE;
    party.cat.x = party.human.x;
    party.cat.y = party.human.y;
    boss.currentTarget = party.human;

    runCompanion(companion, party, SETTLE_FRAMES, bossRoom);
    check(party.cat.autoTarget === null, 'a boss that has merely noticed the party is left alone');

    // The active player opening fire from the doorway is engagement by action,
    // and legitimately commissions the companion.
    boss.takeDamageFrom(1, party.human, 'melee');
    runCompanion(companion, party, SETTLE_FRAMES, bossRoom);
    check(party.cat.autoTarget === boss, 'once the player draws blood the companion joins in');
  }
}

console.log('\nA boss the party pokes from the corridor and abandons goes back to full');
{
  const map = makeBossRoomMap();
  const room = map?.bossRooms[0];
  if (map === null || room === undefined) {
    check(false, 'a generated dungeon offered a boss room to test with');
  } else {
    const party = makeParty(map);
    const bossRoom = new BossRoomSystem(map, new MiniMapSystem(map), ['krakaren_clone']);
    const boss = addMob(party, 'krakaren_clone', room.centre.x, room.centre.y);
    party.human.x = (room.bounds.x - PARTY_STANDOFF_TILES) * TILE_SIZE;
    party.human.y = room.centre.y * TILE_SIZE;
    party.cat.x = party.human.x;
    party.cat.y = party.human.y;

    boss.takeDamageFrom(DOORWAY_SNIPE_DAMAGE, party.human, 'missile');
    bossRoom.update(makeContext(party, bossRoom));
    check(boss.hp < boss.maxHp, 'a shot through the doorway lands');
    check(
      !bossRoom.getBossRoomStates()[0].locked,
      'and does not start the fight, because nobody walked in',
    );

    for (let frame = 0; frame < EXPECTED_UNENTERED_REGEN_FRAMES; frame++) {
      bossRoom.update(makeContext(party, bossRoom));
    }
    check(boss.hp === boss.maxHp, 'left alone, the boss heals the damage back off');
    check(!boss.wasDamagedByParty, 'and forgets the fight, so the companion veto re-arms');

    // Under continuous fire, not merely left alone — that is the whole point.
    // A clock any ongoing damage could reset is a clock the companion cat's
    // fire rate makes unreachable, and a boss that can be emptied from the
    // corridor is a boss fight with no fight, no intro and no room lock.
    boss.applyStatus(makeSepsis(party.human));
    let sniped = 0;
    for (let frame = 0; frame < EXPECTED_UNENTERED_REGEN_FRAMES * SNIPE_ROUNDS; frame++) {
      if (frame % SNIPE_INTERVAL_FRAMES === 0) {
        boss.takeDamageFrom(DOORWAY_SNIPE_DAMAGE, party.human, 'missile');
        sniped += DOORWAY_SNIPE_DAMAGE;
      }
      boss.tickTimers();
      bossRoom.update(makeContext(party, bossRoom));
    }
    check(
      sniped > boss.maxHp,
      `the corridor barrage was lethal on paper (${sniped} vs ${boss.maxHp} HP)`,
    );
    check(boss.isAlive, 'but a boss nobody walked in on cannot be ground down from outside');
    check(
      !bossRoom.getBossRoomStates()[0].locked,
      'and the fight still has not started, which is the point',
    );
  }
}

console.log('\nAn opener thrown from the threshold still counts for the player who walks in');
{
  const map = makeBossRoomMap();
  const room = map?.bossRooms[0];
  if (map === null || room === undefined) {
    check(false, 'a generated dungeon offered a boss room to test with');
  } else {
    const party = makeParty(map);
    const bossRoom = new BossRoomSystem(map, new MiniMapSystem(map), ['krakaren_clone']);
    const boss = addMob(party, 'krakaren_clone', room.centre.x, room.centre.y);
    party.human.x = (room.bounds.x - PARTY_STANDOFF_TILES) * TILE_SIZE;
    party.human.y = room.centre.y * TILE_SIZE;
    party.cat.x = party.human.x;
    party.cat.y = party.human.y;

    // The forgiving half of the same rule, and the one a retune is most likely
    // to break: the punitive half is only fair if walking in promptly keeps
    // what you opened with.
    boss.takeDamageFrom(DOORWAY_SNIPE_DAMAGE, party.human, 'missile');
    const wounded = boss.hp;
    for (let frame = 0; frame < THRESHOLD_ENTRY_FRAMES; frame++) {
      bossRoom.update(makeContext(party, bossRoom));
    }
    party.human.x = room.centre.x * TILE_SIZE;
    party.human.y = room.centre.y * TILE_SIZE;
    bossRoom.update(makeContext(party, bossRoom));

    check(bossRoom.getBossRoomStates()[0].locked, 'walking in starts the fight');
    check(boss.hp === wounded, 'and the opener is still on the boss');
  }
}

console.log('\nA boss killed without its room ever locking still counts as defeated');
{
  const map = makeBossRoomMap();
  const room = map?.bossRooms[0];
  if (map === null || room === undefined) {
    check(false, 'a generated dungeon offered a boss room to test with');
  } else {
    const party = makeParty(map);
    const bossRoom = new BossRoomSystem(map, new MiniMapSystem(map), ['krakaren_clone']);
    const boss = addMob(party, 'krakaren_clone', room.centre.x, room.centre.y);
    party.human.x = (room.bounds.x - PARTY_STANDOFF_TILES) * TILE_SIZE;
    party.human.y = room.centre.y * TILE_SIZE;
    party.cat.x = party.human.x;
    party.cat.y = party.human.y;

    boss.takeDamageFrom(boss.maxHp, party.human, 'missile');
    bossRoom.update(makeContext(party, bossRoom));

    check(bossRoom.getBossRoomStates()[0].defeated, 'the room records the defeat');
    check(
      bossRoom.newlyDefeatedRooms.some((entry) => entry.boss === boss),
      'and queues the body so the boss chest can still be filled',
    );
    check(
      bossRoom.defeatedBossTypes.has('krakaren_clone'),
      'so a gateway floor will let the party past',
    );
  }
}

console.log('\nThe leash does not cut the companion loose inside a locked boss room');
{
  const map = makeBossRoomMap();
  const room = map?.bossRooms[0];
  if (map === null || room === undefined) {
    check(false, 'a generated dungeon offered a boss room to test with');
  } else {
    const party = makeParty(map);
    const bossRoom = new BossRoomSystem(map, new MiniMapSystem(map), ['krakaren_clone']);
    const companion = new CompanionSystem(map, map.startTile.x, map.startTile.y);
    const boss = addMob(party, 'krakaren_clone', room.centre.x, room.centre.y);

    // A boss room is wider than the leash is long, so the two crawlers are
    // routinely further apart inside one than the leash allows — and neither of
    // them can leave. Cutting the cat loose there strands the player alone with
    // a boss for as long as they hang back.
    party.human.x = (room.bounds.x + 1) * TILE_SIZE;
    party.human.y = room.centre.y * TILE_SIZE;
    party.cat.x = (room.bounds.x + room.bounds.w - 2) * TILE_SIZE;
    party.cat.y = room.centre.y * TILE_SIZE;
    bossRoom.update(makeContext(party, bossRoom));
    check(bossRoom.getBossRoomStates()[0].locked, 'walking in locks the room');
    check(
      Math.hypot(party.cat.x - party.human.x, party.cat.y - party.human.y) > COMPANION_LEASH_PX,
      'and the two of them are further apart than the leash',
    );

    party.cat.autoTarget = boss;
    runCompanion(companion, party, SETTLE_FRAMES, bossRoom);
    check(party.cat.autoTarget === boss, 'the cat keeps fighting the boss anyway');
  }
}

console.log('\nA boss room stops being a no-go zone once its fight is over');
{
  const map = makeBossRoomMap();
  const room = map?.bossRooms[0];
  if (map === null || room === undefined) {
    check(false, 'a generated dungeon offered a boss room to test with');
  } else {
    const party = makeParty(map);
    const bossRoom = new BossRoomSystem(map, new MiniMapSystem(map), ['krakaren_clone']);
    const companion = new CompanionSystem(map, map.startTile.x, map.startTile.y);
    const boss = addMob(party, 'krakaren_clone', room.bounds.x + 1, room.centre.y);
    party.human.x = (room.bounds.x - PARTY_STANDOFF_TILES) * TILE_SIZE;
    party.human.y = room.centre.y * TILE_SIZE;
    party.cat.x = party.human.x;
    party.cat.y = party.human.y;

    // A goblin standing where a boss used to. The bounds outlive the fight, so
    // a veto that only asks "is this mob inside a boss room" leaves every mob
    // that later wanders in invisible to the companion for the rest of the run.
    const squatter = addMob(party, 'goblin', room.bounds.x + 1, room.centre.y + 1);
    squatter.currentTarget = party.human;

    runCompanion(companion, party, SETTLE_FRAMES, bossRoom);
    check(party.cat.autoTarget === null, 'while the boss lives, the room is left alone');

    boss.takeDamageFrom(boss.maxHp, party.human, 'missile');
    bossRoom.update(makeContext(party, bossRoom));
    check(bossRoom.getBossRoomStates()[0].defeated, 'the boss dies and the room is cleared');

    runCompanion(companion, party, SETTLE_FRAMES, bossRoom);
    check(party.cat.autoTarget === squatter, 'and the companion will fight in it again');
  }
}

console.log('\nThe leash is off inside a boss room, not across the whole floor');
{
  const map = makeBossRoomMap();
  const room = map?.bossRooms[0];
  if (map === null || room === undefined) {
    check(false, 'a generated dungeon offered a boss room to test with');
  } else {
    const party = makeParty(map);
    const bossRoom = new BossRoomSystem(map, new MiniMapSystem(map), ['krakaren_clone']);
    const companion = new CompanionSystem(map, map.startTile.x, map.startTile.y);
    addMob(party, 'krakaren_clone', room.centre.x, room.centre.y);
    const quarry = addMob(party, 'goblin', map.startTile.x + 2, map.startTile.y);
    quarry.currentTarget = party.human;

    // The player walks in alone. The cat was left outside, is under no clamp,
    // and is nowhere near the fight — so the exemption that keeps a companion
    // engaged *inside* a boss room must not reach her.
    party.human.x = room.centre.x * TILE_SIZE;
    party.human.y = room.centre.y * TILE_SIZE;
    party.cat.x = map.startTile.x * TILE_SIZE;
    party.cat.y = map.startTile.y * TILE_SIZE;
    party.cat.autoTarget = quarry;
    bossRoom.update(makeContext(party, bossRoom));
    check(bossRoom.getBossRoomStates()[0].locked, 'the player locks the room behind them');
    check(
      distanceTiles(party.cat, party.human) > COMPANION_LEASH_PX / TILE_SIZE,
      'and the cat is far outside the leash',
    );

    companion.update(makeContext(party, bossRoom));
    check(party.cat.autoTarget === null, 'so her own leash still cuts her loose');
  }
}

console.log('\nThe leash ends a chase, and the ban keeps it ended');
{
  const map = new GameMap(MAP_OPTIONS);
  const party = makeParty(map);
  const companion = new CompanionSystem(map, map.startTile.x, map.startTile.y);
  const quarry = addMob(party, 'goblin', map.startTile.x + 2, map.startTile.y);
  quarry.currentTarget = party.human;

  runCompanion(companion, party, SETTLE_FRAMES);
  check(party.cat.autoTarget === quarry, 'the cat picks up a mob hunting the active player');

  // Dragged past the leash the way a long chase would take her.
  party.cat.x = party.human.x + BEYOND_LEASH_PX;
  party.cat.y = party.human.y;
  companion.update(makeContext(party));
  check(party.cat.autoTarget === null, 'stretching the leash drops the target');

  // Home again with the quarry still in range: a drop without a ban would
  // re-acquire on this very frame and start the lap over.
  party.cat.x = party.human.x;
  party.cat.y = party.human.y;
  runCompanion(companion, party, SETTLE_FRAMES);
  check(party.cat.autoTarget === null, 'and the ban stops her turning straight back around');

  runCompanion(companion, party, EXPECTED_TARGET_BAN_FRAMES);
  check(party.cat.autoTarget === quarry, 'the ban expires rather than lasting the whole level');
}

console.log('\nA mob that hits from where it stands does not pin the companion');
{
  const map = new GameMap(MAP_OPTIONS);
  const party = makeParty(map);
  const companion = new CompanionSystem(map, map.startTile.x, map.startTile.y);
  const sniper = addMob(party, 'goblin', map.startTile.x + 2, map.startTile.y);
  sniper.currentTarget = party.cat;

  runCompanion(companion, party, SETTLE_FRAMES);
  check(party.cat.autoTarget === sniper, 'the cat engages a mob hunting her');

  // The chase, played out: both of them end up far from the player, and the mob
  // keeps landing hits so it never stops reading as "still biting".
  const previousX = sniper.x;
  const previousY = sniper.y;
  sniper.x = party.human.x + BEYOND_LEASH_PX;
  sniper.y = party.human.y;
  party.roster.grid.move(sniper, previousX, previousY);
  party.cat.x = sniper.x;
  party.cat.y = sniper.y;
  sniper.noteStruckPlayer(party.cat);

  // One frame is the whole test. The drop happens at the top of the companion's
  // update and acquisition runs immediately after it, so a target that was
  // dropped without being banned is already back by the time this returns —
  // which is what reading the ban exemption off the *companion's* distance did,
  // since the mob she just chased is by construction the mob she is next to.
  companion.update(makeContext(party));
  check(party.cat.autoTarget === null, 'stretching the leash drops it, ban and all');

  companion.update(makeContext(party));
  check(party.cat.autoTarget === null, 'and it does not come straight back');
}

console.log('\nA mob that is biting the party is exempt from the ban');
{
  const map = new GameMap(MAP_OPTIONS);
  const party = makeParty(map);
  const companion = new CompanionSystem(map, map.startTile.x, map.startTile.y);
  const biter = addMob(party, 'goblin', map.startTile.x + 1, map.startTile.y);

  // Driven until it actually connects rather than assumed to: the exemption is
  // keyed on a landed blow, so a test that only assumed one would pass whether
  // the flag worked or not. The human is topped up each frame because what is
  // being measured is the goblin's swing, not the party's survival.
  let engageFrames = 0;
  while (!biter.hasStruckPlayer && engageFrames < MAX_ENGAGE_FRAMES) {
    biter.updateAI([party.human, party.cat]);
    biter.tickTimers();
    party.human.hp = party.human.maxHp;
    engageFrames++;
  }
  check(biter.hasStruckPlayer, `the goblin lands a real blow (${engageFrames} frames)`);

  runCompanion(companion, party, SETTLE_FRAMES);
  check(party.cat.autoTarget === biter, 'the cat picks the biter up');

  party.cat.x = party.human.x + BEYOND_LEASH_PX;
  party.cat.y = party.human.y;
  companion.update(makeContext(party));
  party.cat.x = party.human.x;
  party.cat.y = party.human.y;
  runCompanion(companion, party, SETTLE_FRAMES);
  check(
    party.cat.autoTarget === biter,
    'and takes it straight back rather than spectating the mauling',
  );
}

console.log('\nThe companion cat casts first and claws in the gaps');
{
  const map = new GameMap(MAP_OPTIONS);
  const party = makeParty(map);
  const companion = new CompanionSystem(map, map.startTile.x, map.startTile.y);
  const prey = addMob(party, 'rat', map.startTile.x + POINT_BLANK_TILES, map.startTile.y);
  prey.currentTarget = party.cat;

  companion.update(makeContext(party));
  check(party.cat.autoTarget === prey, 'the cat engages what is chasing her');
  check(party.cat.getMissiles().length > 0, 'a ready missile is spent even point-blank');
  check(!party.cat.isSwinging, 'the claw never costs her a cast');

  // Second frame: the missile is cooling, so the claw has the frame to itself.
  // A cat with neither available is a cat standing next to a rat doing nothing,
  // which is what this whole branch exists to prevent.
  companion.update(makeContext(party));
  check(party.cat.isSwinging, 'with the missile cooling, the claw takes the frame');
}
{
  const staged = makeOpenGroundMap();
  if (staged === null) {
    check(false, 'a generated dungeon offered open floor to stage a fight on');
  } else {
    const { map, ground } = staged;
    const party = makeParty(map);
    const companion = new CompanionSystem(map, ground.x, ground.y);
    // Staged on clear floor: a wall between the two of them fails the sight
    // gate, and a cat who never fires because she cannot see would read exactly
    // like a cat who chose the claw.
    party.human.x = ground.x * TILE_SIZE;
    party.human.y = ground.y * TILE_SIZE;
    party.cat.x = ground.x * TILE_SIZE;
    party.cat.y = ground.y * TILE_SIZE;
    const prey = addMob(party, 'rat', ground.x + MISSILE_RANGE_TILES, ground.y);
    prey.currentTarget = party.cat;

    companion.update(makeContext(party));
    companion.update(makeContext(party));
    check(!party.cat.isSwinging, 'a target across the room gets no claw');
    check(party.cat.getMissiles().length > 0, 'it gets a missile, as it always did');
  }
}

console.log('\nStanding her ground is a strength build, not the default');
{
  /**
   * One rat chasing the companion cat for twenty seconds, driven the way the
   * scene drives a fight. Returns what the cat spent and what she landed.
   *
   * Her health is deliberately not topped up: it is the exact thing standing
   * her ground puts at risk, and a harness that heals her every frame cannot
   * tell an opportunistic swipe from a suicidal one.
   */
  function runChaseFight(strength: number): {
    swipes: number;
    peaks: number;
    peaksOnTarget: number;
    facingOnTarget: number;
    casts: number;
    closest: number;
    hpSpent: number;
    alive: boolean;
  } | null {
    const staged = makeOpenGroundMap();
    if (staged === null) return null;
    const { map, ground } = staged;
    const party = makeParty(map);
    const companion = new CompanionSystem(map, ground.x, ground.y);
    party.cat.setBaseStat('strength', strength);
    party.human.x = ground.x * TILE_SIZE;
    party.human.y = ground.y * TILE_SIZE;
    // The cat stands apart from the human and the rat is after *her*: the kite
    // is the only follower branch that can put her in claw range, and it only
    // runs for a mob chasing the cat herself.
    party.cat.x = ground.x * TILE_SIZE;
    party.cat.y = (ground.y + CAT_STANDOFF_TILES) * TILE_SIZE;
    const chaser = addMob(
      party,
      'rat',
      ground.x + CHASER_START_TILES,
      ground.y + CAT_STANDOFF_TILES,
    );
    chaser.currentTarget = party.cat;

    const startingHp = party.cat.hp;
    let swipes = 0;
    let peaks = 0;
    let peaksOnTarget = 0;
    let facingOnTarget = 0;
    let casts = 0;
    let liveMissiles = 0;
    let closest = Infinity;
    let wasSwiping = false;
    for (let frame = 0; frame < KITE_FIGHT_FRAMES; frame++) {
      party.human.hp = party.human.maxHp;
      runFightFrame(companion, party);
      if (party.cat.isSwinging && !wasSwiping) swipes++;
      wasSwiping = party.cat.isSwinging;
      // The frame the claw actually connects, measured by the same rule the
      // combat resolver uses. A swipe that starts is not a swipe that lands:
      // the follower walks her while the animation plays, and if it re-aimed
      // her at the step she would be clawing the floor beside the rat.
      if (party.cat.isAttackPeak()) {
        peaks++;
        const dx = chaser.x - party.cat.x;
        const dy = chaser.y - party.cat.y;
        const reach = Math.hypot(dx, dy);
        const facingDot =
          reach === 0 ? 1 : (dx / reach) * party.cat.facingX + (dy / reach) * party.cat.facingY;
        // Split deliberately. Facing is the thing the follower's mid-swing hold
        // protects, and it must be right every single time. Reach is not: the
        // swipe is committed half an animation earlier, and a rat is allowed to
        // back out of it in between — demanding a hundred per cent hit rate
        // from a system permitted to whiff makes the gate a coin toss, and a
        // gate that fails at random is a gate somebody eventually mutes.
        if (reach <= MELEE_POINT_BLANK_RANGE || facingDot > 0) facingOnTarget++;
        if (reach <= party.cat.getMeleeRange()) peaksOnTarget++;
      }
      casts += party.cat.getMissiles().length > liveMissiles ? 1 : 0;
      liveMissiles = party.cat.getMissiles().length;
      closest = Math.min(closest, Math.hypot(chaser.x - party.cat.x, chaser.y - party.cat.y));
    }
    return {
      swipes,
      peaks,
      peaksOnTarget,
      facingOnTarget,
      casts,
      closest,
      hpSpent: startingHp - party.cat.hp,
      alive: party.cat.isAlive,
    };
  }

  const brawler = runChaseFight(BRAWLER_STRENGTH);
  if (brawler === null) {
    check(false, 'a generated dungeon offered open floor to stage a fight on');
  } else {
    check(
      brawler.closest <= CAT_MELEE_REACH_PX,
      `a strong cat lets the rat inside claw reach (${brawler.closest.toFixed(0)}px)`,
    );
    check(brawler.swipes > 0, `and claws it (${brawler.swipes} swipes)`);
    check(
      brawler.peaks > 0 && brawler.facingOnTarget === brawler.peaks,
      `every swipe aimed at the rat (${brawler.facingOnTarget}/${brawler.peaks})`,
    );
    check(
      brawler.peaks > 0 && brawler.peaksOnTarget / brawler.peaks >= MIN_SWIPE_CONNECT_RATE,
      `and most of them connected (${brawler.peaksOnTarget}/${brawler.peaks})`,
    );
    check(
      brawler.casts > MIN_CASTS_PER_FIGHT,
      `without ever stopping casting to allow it (${brawler.casts} casts)`,
    );
    check(brawler.alive, `and she survives twenty seconds of it (${brawler.hpSpent} HP spent)`);
  }

  const caster = runChaseFight(MIN_STAT_VALUE);
  if (caster === null) {
    check(false, 'a generated dungeon offered open floor to stage a fight on');
  } else {
    // Two damage a swing, bought with half a six-point health pool, against a
    // rat the missile was already killing. She should not take that trade, and
    // measuring it as health rather than as intent is the only way to be sure.
    check(
      caster.closest > CAT_MELEE_REACH_PX,
      `a cat with no strength keeps the rat out instead (${caster.closest.toFixed(0)}px)`,
    );
    check(caster.hpSpent === 0, `and pays nothing for it (${caster.hpSpent} HP spent)`);
    check(caster.casts > MIN_CASTS_PER_FIGHT, `still casting throughout (${caster.casts} casts)`);
  }
}

console.log('\nA crowd is not a duel, and she does not stand in one');
{
  const staged = makeOpenGroundMap();
  if (staged === null) {
    check(false, 'a generated dungeon offered open floor to stage a fight on');
  } else {
    const { map, ground } = staged;
    const party = makeParty(map);
    const companion = new CompanionSystem(map, ground.x, ground.y);
    party.human.x = ground.x * TILE_SIZE;
    party.human.y = ground.y * TILE_SIZE;
    party.cat.x = ground.x * TILE_SIZE;
    party.cat.y = (ground.y + CAT_STANDOFF_TILES) * TILE_SIZE;
    for (let i = 0; i < SWARM_SIZE; i++) {
      const rat = addMob(party, 'rat', ground.x + CHASER_START_TILES, ground.y + i);
      rat.currentTarget = party.cat;
    }

    // One rat reaching her is the point of the claw; three reaching her is a
    // six-health crawler being eaten. The single-chaser check above proves a rat
    // *can* close the gap, so surviving this one means she declined to let them.
    for (let frame = 0; frame < KITE_FIGHT_FRAMES; frame++) {
      party.human.hp = party.human.maxHp;
      runFightFrame(companion, party);
      if (!party.cat.isAlive) break;
    }

    check(party.cat.isAlive, `she kites a swarm instead of trading with it (${party.cat.hp} HP)`);
  }
}

console.log('\nA companion fights indoors, and forgets the target it left');
{
  const groundFloor = makeInterior(INTERIOR_GROUND_FLOOR);
  const upperFloor = makeInterior(INTERIOR_UPPER_FLOOR);
  const groundStart = groundFloor.startTile;
  const cultistTile = nearbyWalkable(groundFloor, groundStart);
  const party = makeParty(groundFloor);
  const companion = new CompanionSystem(groundFloor, groundStart.x, groundStart.y);

  // An empty room is the common case indoors: most buildings hold nothing at
  // all, and a companion drive that only survives a populated roster would take
  // every shop in town down with it.
  runCompanion(companion, party, SETTLE_FRAMES);
  check(party.cat.autoTarget === null, 'an empty room gives the companion nothing to do');

  if (cultistTile === null) {
    check(false, 'a generated interior offered floor to stage a fight on');
  } else {
    const cultist = addMob(party, 'city_elf_cultist', cultistTile.x, cultistTile.y);
    cultist.currentTarget = party.human;
    runCompanion(companion, party, SETTLE_FRAMES);
    // The whole point of the interior context: it carries no boss room, and the
    // veto has to read that as "nothing to veto" rather than as a reason to sit
    // the fight out.
    check(
      party.cat.autoTarget === cultist,
      'with no boss room in the context she answers what is attacking the human',
    );

    const upperStart = upperFloor.startTile;
    party.human.x = upperStart.x * TILE_SIZE;
    party.human.y = upperStart.y * TILE_SIZE;
    party.cat.x = upperStart.x * TILE_SIZE;
    party.cat.y = upperStart.y * TILE_SIZE;
    companion.setMap(upperFloor, party.human, party.cat);
    check(
      party.cat.autoTarget === null,
      'and drops it at the stairs, a storey away from anything she could reach',
    );
  }
}

console.log('\nsetMap re-seeds the map she collides with, not just where she stands');
{
  // A cat closing distance on the human after `update()` is true on whichever
  // `GameMap` `CompanionSystem` is holding — companion positions are absolute
  // pixels, so that alone can't tell a re-seeded map from a stale one. Putting
  // a sealed wall between them on the map `setMap` switches to, and nothing
  // between them on the map it starts with, makes the two cases diverge: only
  // a companion actually colliding against the new floor stops at the wall.
  const party = makeParty(makePartitionFloor(false));
  const companion = new CompanionSystem(party.map, PARTITION_CAT_TILE.x, PARTITION_CAT_TILE.y);
  const partitioned = makePartitionFloor(true);

  party.human.x = PARTITION_HUMAN_TILE.x * TILE_SIZE;
  party.human.y = PARTITION_HUMAN_TILE.y * TILE_SIZE;
  party.cat.x = PARTITION_CAT_TILE.x * TILE_SIZE;
  party.cat.y = PARTITION_CAT_TILE.y * TILE_SIZE;
  companion.setMap(partitioned, party.human, party.cat);

  runCompanion(companion, party, PARTITION_FOLLOW_FRAMES);
  check(
    party.cat.x / TILE_SIZE < PARTITION_WALL_TILE_X,
    `she is stopped by the new floor's own wall instead of walking through where it stands on the old floor's open plan (cat at tile ${(party.cat.x / TILE_SIZE).toFixed(1)})`,
  );
}

console.log('\nsetMap also drops the ban a floor change did not earn');
{
  // The same ban check as the leash tests above, but proving `targetBans`
  // itself gets cleared rather than merely outlasted: reacquiring within
  // `SETTLE_FRAMES` is only possible if the ban is gone, since the ban itself
  // runs for `EXPECTED_TARGET_BAN_FRAMES`.
  const map = new GameMap(MAP_OPTIONS);
  const party = makeParty(map);
  const companion = new CompanionSystem(map, map.startTile.x, map.startTile.y);
  const quarry = addMob(party, 'goblin', map.startTile.x + 2, map.startTile.y);
  quarry.currentTarget = party.human;

  runCompanion(companion, party, SETTLE_FRAMES);
  party.cat.x = party.human.x + BEYOND_LEASH_PX;
  party.cat.y = party.human.y;
  companion.update(makeContext(party));
  party.cat.x = party.human.x;
  party.cat.y = party.human.y;
  runCompanion(companion, party, SETTLE_FRAMES);
  check(
    party.cat.autoTarget === null,
    'stretching the leash bans the quarry before the floor changes',
  );

  companion.setMap(map, party.human, party.cat);
  runCompanion(companion, party, SETTLE_FRAMES);
  check(
    party.cat.autoTarget === quarry,
    'and setMap clears the ban rather than making her wait out the full ban window',
  );
}

console.log('\nA boss chest that cannot be filled says so');
{
  const chests = new TreasureChestSystem();
  const loot = { coins: 1, items: [] };
  check(
    !chests.hasLockedBossChest(BOSS_ROOM_UNDER_TEST),
    'a system with no chests has none locked',
  );
  check(
    !chests.receiveBossLoot(BOSS_ROOM_UNDER_TEST, loot),
    'loot with nowhere to go reports the miss',
  );

  chests.addBossChest(CHEST_TILE, CHEST_TILE, BOSS_ROOM_UNDER_TEST);
  check(
    chests.hasLockedBossChest(BOSS_ROOM_UNDER_TEST),
    'a fresh boss chest is locked and waiting',
  );
  check(chests.receiveBossLoot(BOSS_ROOM_UNDER_TEST, loot), 'and takes the loot it was built for');
  check(
    !chests.hasLockedBossChest(BOSS_ROOM_UNDER_TEST),
    'after which nothing is left locked for that room',
  );
}

console.log(failures === 0 ? '\nAll companion checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
