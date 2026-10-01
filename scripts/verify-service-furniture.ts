#!/usr/bin/env tsx
/**
 * Headless gate for the service level's breakable furniture.
 *
 * For every kind, on a hand-built flat floor:
 * - it breaks after exactly as many one-damage blows as its health, and every
 *   tile of its footprint is open floor afterwards with wreckage left behind
 * - a blow that covers both tiles of a two-tile piece lands on it once, and a
 *   blow that reaches only a piece's part tile still lands on the piece
 * - a checkpoint taken before the break stands the whole piece back up, part
 *   tiles included
 *
 * And:
 * - what a broken piece holds drops through the animated loot drop
 * - the vending machine and the boiler carry a light, and the vending
 *   machine's tile stops being one when it breaks, which puts the light out
 * - a broken gas bottle hisses for at least the locked-telegraph minimum,
 *   raises its hiss cue once, then hands exactly one detonation over; the
 *   dynamite system sets it off at the bottle's own radius, hurting a crawler
 *   inside the ring and not one outside it
 * - a checkpoint taken while a bottle hisses still goes off after a restore
 * - over a sweep of floor-2 seeds, each signature piece turns up in rooms of
 *   the character it belongs to
 *
 * Run: npm run verify:service-furniture
 */

import { TILE_SIZE } from '../src/core/constants';
import { PlayerManager } from '../src/core/PlayerManager';
import { withWorldSeed } from '../src/core/WorldRandom';
import type { LootDrop } from '../src/creatures/Mob';
import { LOCKED_TELEGRAPH_MIN_FRAMES } from '../src/creatures/mobLevelScaling';
import type { CatPlayer } from '../src/creatures/CatPlayer';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { level2 } from '../src/levels/level2';
import { generateDungeon } from '../src/map/DungeonGenerator';
import { GameMap } from '../src/map/GameMap';
import {
  MULTI_TILE_PROP_FOOTPRINTS,
  multiTileFootprintTiles,
  multiTilePieceTypes,
} from '../src/map/serviceLevelProps';
import {
  BOILER,
  FILING_CABINET,
  FloorTypeValue,
  GAS_CYLINDER,
  LOCKER_BANK,
  SERVICE_DESK,
  VENDING_MACHINE,
  placeProp,
  type TileContent,
} from '../src/map/tileTypes';
import { isWalkableTileType } from '../src/map/walkability';
import { DestructiblePropSystem } from '../src/systems/DestructiblePropSystem';
import { DynamiteSystem } from '../src/systems/DynamiteSystem';
import { STATIC_LIGHT_FIXTURES } from '../src/systems/DungeonLightingSystem';
import type { SystemContext } from '../src/systems/GameSystem';
import { LootSystem } from '../src/systems/LootSystem';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import {
  GAS_CYLINDER_BLAST_RADIUS_TILES,
  GAS_CYLINDER_CRAWLER_DAMAGE,
  GAS_CYLINDER_FUSE_FRAMES,
  SERVICE_PROP_KINDS,
  SERVICE_PROP_KIND_LIST,
} from '../src/systems/destruction/serviceLevelPropKinds';

const GRID_SIZE = 24;
const FLOOR_NUMBER = 2;
const ANCHOR_TILE = 10;
/** The crawler stands this far south of the piece's anchor. */
const CRAWLER_TILES_SOUTH = 2;
/** Reaches both tiles of a two-tile piece from where the crawler stands. */
const BLOW_RADIUS_TILES = 3;
const BLOW_RADIUS = TILE_SIZE * BLOW_RADIUS_TILES;
const ONE_DAMAGE = 1;
/** Blows past a kind's health after which the gate gives up on it breaking. */
const SPARE_BLOWS = 5;
/**
 * A projectile landing this far south of a tile's centre, with this reach,
 * reaches that tile's centre and not its neighbour's beside it.
 */
const PINPOINT_DROP_TILES = 0.7;
const PINPOINT_RADIUS_TILES = 0.8;
const HALF = 0.5;
/** How far into the fuse the mid-fuse checkpoint is taken. */
const CHECKPOINT_FUSE_FRAMES = 30;
/** Tiles from the bottle a crawler stands inside, and outside, its blast. */
const INSIDE_BLAST_TILES = 1;
const OUTSIDE_BLAST_TILES = GAS_CYLINDER_BLAST_RADIUS_TILES + 1;
const SWEEP_SEEDS = 12;
const SWEEP_SEED_BASE = 300_000;
/** Each character's signature piece, which a sweep must see it place. */
const SIGNATURES: Readonly<Record<string, number>> = {
  locker_room: LOCKER_BANK,
  break_room: VENDING_MACHINE,
  boiler_room: BOILER,
  records_office: FILING_CABINET,
};
/** The desk is checked separately: a narrow office can lack the two-tile wall run it needs. */
const DESK_CHARACTER = 'records_office';

let failures = 0;
function check(ok: boolean, message: string): void {
  if (ok) {
    console.log(`  ok   ${message}`);
  } else {
    failures++;
    console.log(`  FAIL ${message}`);
  }
}

function flatFloor(): TileContent[][] {
  return Array.from({ length: GRID_SIZE }, (_, y) =>
    Array.from({ length: GRID_SIZE }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: FloorTypeValue.tile_floor,
    })),
  );
}

/** A loot system that records how every drop was asked for. */
class RecordingLoot extends LootSystem {
  readonly drops: Array<{ readonly loot: LootDrop; readonly animateDrop: boolean }> = [];
  override addLoot(
    x: number,
    y: number,
    loot: LootDrop,
    owner: HumanPlayer | CatPlayer,
    isBossLoot = false,
    sharedCoins = false,
    animateDrop = false,
  ): void {
    this.drops.push({ loot, animateDrop });
    super.addLoot(x, y, loot, owner, isBossLoot, sharedCoins, animateDrop);
  }
}

interface Rig {
  readonly gameMap: GameMap;
  readonly loot: RecordingLoot;
  readonly props: DestructiblePropSystem;
  readonly human: HumanPlayer;
  readonly footprint: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

function rigFor(tileType: number): Rig {
  const gameMap = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: flatFloor() });
  const loot = new RecordingLoot(gameMap);
  const props = new DestructiblePropSystem(gameMap, loot, FLOOR_NUMBER);
  const footprintSize = MULTI_TILE_PROP_FOOTPRINTS.get(tileType) ?? { w: 1, h: 1 };
  const footprint = multiTileFootprintTiles(ANCHOR_TILE, ANCHOR_TILE, footprintSize);
  const types = multiTilePieceTypes(tileType, footprint);
  footprint.forEach((tile, index) => {
    placeProp(gameMap.structure[tile.y][tile.x], types[index] ?? tileType);
  });
  const human = new HumanPlayer(ANCHOR_TILE, ANCHOR_TILE + CRAWLER_TILES_SOUTH, TILE_SIZE);
  return { gameMap, loot, props, human, footprint };
}

function footprintOpen(rig: Rig): boolean {
  return rig.footprint.every((tile) => isWalkableTileType(rig.gameMap.structure[tile.y][tile.x]));
}

function breakWithBlows(rig: Rig, hp: number): void {
  for (let i = 0; i < hp; i++) rig.props.tryAreaHit(rig.human, BLOW_RADIUS, ONE_DAMAGE);
}

console.log('every kind breaks, once per blow, and leaves its wreckage:');
for (const kind of SERVICE_PROP_KIND_LIST) {
  const def = SERVICE_PROP_KINDS[kind];
  const rig = rigFor(def.tileType);
  check(!footprintOpen(rig), `${kind}: stands solid on all ${rig.footprint.length} tile(s)`);
  const before = rig.props.captureCheckpoint();
  let blows = 0;
  while (!footprintOpen(rig) && blows < def.hp + SPARE_BLOWS) {
    rig.props.tryAreaHit(rig.human, BLOW_RADIUS, ONE_DAMAGE);
    blows++;
  }
  check(footprintOpen(rig), `${kind}: broken, footprint open`);
  check(blows === def.hp, `${kind}: took ${blows} blows for ${def.hp} health`);
  const after = rig.props.captureCheckpoint();
  check(after.wreckage.length === 1, `${kind}: left ${after.wreckage.length} wreckage decal(s)`);

  rig.props.restoreCheckpoint(before);
  const types = multiTilePieceTypes(def.tileType, rig.footprint);
  const restored = rig.footprint.every(
    (tile, index) => rig.gameMap.structure[tile.y][tile.x].type === (types[index] ?? def.tileType),
  );
  check(restored, `${kind}: a checkpoint from before the break stands it back up whole`);
}

console.log("a blow on a two-tile piece's part tile alone:");
{
  const rig = rigFor(SERVICE_DESK);
  const part = rig.footprint[1];
  const partCentreX = (part.x + HALF) * TILE_SIZE;
  const impactY = (part.y + HALF + PINPOINT_DROP_TILES) * TILE_SIZE;
  const reach = PINPOINT_RADIUS_TILES * TILE_SIZE;
  let blows = 0;
  while (!footprintOpen(rig) && blows < SERVICE_PROP_KINDS.service_desk.hp + SPARE_BLOWS) {
    rig.props.tryProjectileHit(partCentreX, impactY, reach, ONE_DAMAGE, rig.human);
    blows++;
  }
  check(footprintOpen(rig), 'desk broken by blows on its part tile alone');
  check(
    blows === SERVICE_PROP_KINDS.service_desk.hp,
    `took ${blows} blows for ${SERVICE_PROP_KINDS.service_desk.hp} health`,
  );
}

console.log('contents:');
{
  const rig = rigFor(VENDING_MACHINE);
  breakWithBlows(rig, SERVICE_PROP_KINDS.vending_machine.hp);
  check(
    rig.loot.drops.length === 1,
    `a vending machine always pays out (${rig.loot.drops.length} drop)`,
  );
  check(
    rig.loot.drops.every((drop) => drop.animateDrop),
    'its drop falls and lands rather than appearing in the bag',
  );
}

console.log('lights:');
check(STATIC_LIGHT_FIXTURES.get(VENDING_MACHINE) === 'vending_glow', 'vending machine glows');
check(STATIC_LIGHT_FIXTURES.get(BOILER) === 'boiler_window', 'boiler window glows');
{
  const rig = rigFor(VENDING_MACHINE);
  breakWithBlows(rig, SERVICE_PROP_KINDS.vending_machine.hp);
  check(
    rig.gameMap.structure[ANCHOR_TILE][ANCHOR_TILE].type !== VENDING_MACHINE,
    'a broken vending machine no longer carries its light',
  );
}

console.log('gas bottle:');
// Widened to number: compared as literals the linter folds the check away,
// and the point is that it runs against whatever the constants say.
const fuseFrames: number = GAS_CYLINDER_FUSE_FRAMES;
const telegraphFloor: number = LOCKED_TELEGRAPH_MIN_FRAMES;
check(
  fuseFrames >= telegraphFloor,
  `fuse ${GAS_CYLINDER_FUSE_FRAMES} frames >= locked telegraph ${LOCKED_TELEGRAPH_MIN_FRAMES}`,
);

/** Burns a fuse `frames` frames down, counting the detonations handed over on the way. */
function burn(props: DestructiblePropSystem, frames: number): number {
  let detonations = 0;
  for (let frame = 0; frame < frames; frame++) {
    props.update();
    detonations += props.drainDetonations().length;
  }
  return detonations;
}

{
  const rig = rigFor(GAS_CYLINDER);
  breakWithBlows(rig, SERVICE_PROP_KINDS.gas_cylinder.hp);
  check(rig.props.drainFusesLit() === 1, 'breaking it lights one fuse, raising one hiss cue');
  check(rig.props.drainFusesLit() === 0, 'the hiss cue is raised once, not every frame');
  const early = burn(rig.props, GAS_CYLINDER_FUSE_FRAMES - 1);
  check(early === 0, `no detonation before the fuse burns out (saw ${early})`);
  const onTime = burn(rig.props, 1);
  check(onTime === 1, `one detonation when it does (saw ${onTime})`);
  check(rig.props.captureCheckpoint().fuses.length === 0, 'the fuse is spent');
}

{
  const rig = rigFor(GAS_CYLINDER);
  breakWithBlows(rig, SERVICE_PROP_KINDS.gas_cylinder.hp);
  burn(rig.props, CHECKPOINT_FUSE_FRAMES);
  const snapshot = rig.props.captureCheckpoint();
  const fired = burn(rig.props, GAS_CYLINDER_FUSE_FRAMES);
  rig.props.restoreCheckpoint(snapshot);
  const remaining = GAS_CYLINDER_FUSE_FRAMES - CHECKPOINT_FUSE_FRAMES;
  const early = burn(rig.props, remaining - 1);
  const afterRestore = burn(rig.props, 1);
  check(
    fired === 1 && early === 0 && afterRestore === 1,
    `a checkpoint taken mid-fuse still goes off on time after a restore (${afterRestore})`,
  );
}

/**
 * Sets a bottle's fuse off through the dynamite system with a crawler
 * standing `tilesAway` south of it, and reports the crawler's health lost.
 */
function blastDamageAt(tilesAway: number): number {
  const gameMap = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: flatFloor() });
  placeProp(gameMap.structure[ANCHOR_TILE][ANCHOR_TILE], GAS_CYLINDER);
  const players = new PlayerManager(ANCHOR_TILE, ANCHOR_TILE + tilesAway, undefined);
  // The cat is moved well clear so only the crawler under test is in reach.
  players.cat.x = 0;
  players.cat.y = 0;
  const roster = new MobRoster(gameMap, new SpellSystem());
  const ctx: SystemContext = {
    human: players.human,
    cat: players.cat,
    active: players.active(),
    inactive: players.inactive(),
    activeIsMoving: false,
    roster,
    gameMap,
  };
  const props = new DestructiblePropSystem(gameMap, new LootSystem(gameMap), FLOOR_NUMBER);
  const dynamite = new DynamiteSystem(gameMap, props);
  const bottle = new HumanPlayer(ANCHOR_TILE, ANCHOR_TILE + 1, TILE_SIZE);
  for (let i = 0; i < SERVICE_PROP_KINDS.gas_cylinder.hp; i++) {
    props.tryAreaHit(bottle, BLOW_RADIUS, ONE_DAMAGE);
  }
  const startHp = players.human.hp;
  for (let frame = 0; frame <= GAS_CYLINDER_FUSE_FRAMES; frame++) {
    props.update();
    dynamite.update(ctx);
  }
  return startHp - players.human.hp;
}

{
  const inside = blastDamageAt(INSIDE_BLAST_TILES);
  check(
    inside === GAS_CYLINDER_CRAWLER_DAMAGE,
    `a crawler ${INSIDE_BLAST_TILES} tile away loses ${inside} (expected ${GAS_CYLINDER_CRAWLER_DAMAGE})`,
  );
  const outside = blastDamageAt(OUTSIDE_BLAST_TILES);
  check(
    outside === 0,
    `a crawler ${OUTSIDE_BLAST_TILES} tiles away, outside the ring, loses ${outside}`,
  );
}

console.log('placement:');
{
  const placedIn = new Map<string, number>();
  const roomsOf = new Map<string, number>();
  for (let run = 1; run <= SWEEP_SEEDS; run++) {
    const data = withWorldSeed(SWEEP_SEED_BASE + run, () =>
      generateDungeon({ ...dungeonOptionsForLevel(level2), size: level2.mapSize }),
    );
    const assignments = data.regionCharacters.roomAssignments();
    for (const room of data.regionMap.rooms) {
      const assignment = assignments[room.id];
      if (assignment?.type !== 'room') continue;
      const id = assignment.character.id;
      const wanted = [SIGNATURES[id], id === DESK_CHARACTER ? SERVICE_DESK : undefined];
      for (const type of wanted) {
        if (type === undefined) continue;
        const key = `${id}:${type}`;
        roomsOf.set(key, (roomsOf.get(key) ?? 0) + 1);
        let found = false;
        for (let y = room.bounds.y; y < room.bounds.y + room.bounds.h && !found; y++) {
          for (let x = room.bounds.x; x < room.bounds.x + room.bounds.w && !found; x++) {
            found = data.grid[y][x].type === type;
          }
        }
        if (found) placedIn.set(key, (placedIn.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [key, rooms] of roomsOf) {
    const placed = placedIn.get(key) ?? 0;
    check(placed > 0, `${key}: placed in ${placed} of ${rooms} rooms`);
  }
}

console.log(failures === 0 ? '\nservice furniture: all checks passed' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
