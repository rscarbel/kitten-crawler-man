#!/usr/bin/env tsx
/**
 * Headless check that a skeleton or goblin archer only looses arrows that can
 * arrive: sight passes over low props (`isSightTransparentTileType`, e.g. Briar
 * Hollow's palisade) but an arrow stops on every unwalkable tile.
 *
 * Behind a palisade no arrow may be loosed; on open ground at the same spacing
 * arrows must still land, so the check cannot pass by silencing the archer.
 *
 * Run: npx tsx scripts/verify-archer-clear-shot.ts
 */
import { level3 } from '../src/levels/level3';
import { GameMap } from '../src/map/GameMap';
import { HOLLOW_PALISADE } from '../src/map/tileTypes';
import { TILE_SIZE } from '../src/core/constants';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { SkeletonArcher } from '../src/creatures/SkeletonArcher';
import { SkeletonProjectileSystem } from '../src/systems/SkeletonProjectileSystem';
import { GoblinArcher } from '../src/creatures/GoblinArcher';
import { GoblinArrowSystem } from '../src/systems/GoblinArrowSystem';
import type { Mob } from '../src/creatures/Mob';
import type { GameSystem } from '../src/systems/GameSystem';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import type { SystemContext } from '../src/systems/GameSystem';

const MAP_SIZE = level3.mapSize;
/** Per side: six apart keeps the pair inside the archer's four-to-seven-tile band. */
const STANDOFF_TILES = 3;
/** Enough for several full shot cooldowns. */
const FRAMES_TO_RUN = 1200;
/** Far enough that the parked cat is never a target. */
const CAT_PARK_OFFSET_TILES = 60;
const MAX_MAP_ATTEMPTS = 5;

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

interface Crossing {
  readonly archerTile: { readonly x: number; readonly y: number };
  readonly crawlerTile: { readonly x: number; readonly y: number };
}

/** A palisade tile with straight open ground {@link STANDOFF_TILES} deep on both sides. */
function findPalisadeCrossing(map: GameMap): Crossing | null {
  const size = map.gridSize;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (map.structure[y][x].type !== HOLLOW_PALISADE) continue;
      for (const [dx, dy] of [
        [0, 1],
        [1, 0],
      ] as const) {
        let clear = true;
        for (let step = 1; step <= STANDOFF_TILES && clear; step++) {
          clear =
            map.isWalkable(x + dx * step, y + dy * step) &&
            map.isWalkable(x - dx * step, y - dy * step);
        }
        if (!clear) continue;
        const near = { x: x - dx * STANDOFF_TILES, y: y - dy * STANDOFF_TILES };
        const far = { x: x + dx * STANDOFF_TILES, y: y + dy * STANDOFF_TILES };
        const nearInside = map.isInBriarHollow(near.x * TILE_SIZE, near.y * TILE_SIZE);
        return nearInside
          ? { archerTile: far, crawlerTile: near }
          : { archerTile: near, crawlerTile: far };
      }
    }
  }
  return null;
}

function findOpenRun(map: GameMap): Crossing | null {
  const size = map.gridSize;
  const span = STANDOFF_TILES * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x + span < size; x++) {
      let clear = true;
      for (let step = 0; step <= span && clear; step++) clear = map.isWalkable(x + step, y);
      if (!clear) continue;
      return { archerTile: { x, y }, crawlerTile: { x: x + span, y } };
    }
  }
  return null;
}

interface Outcome {
  readonly loosed: number;
  readonly landedOnCrawler: number;
}

interface Bowman {
  readonly name: string;
  readonly make: (tileX: number, tileY: number) => Mob;
  readonly arrows: (map: GameMap) => Required<Pick<GameSystem, 'update'>>;
}

const BOWMEN: readonly Bowman[] = [
  {
    name: 'skeleton archer',
    make: (tileX, tileY) => new SkeletonArcher(tileX, tileY, TILE_SIZE),
    arrows: (map) => new SkeletonProjectileSystem(map),
  },
  {
    name: 'goblin archer',
    make: (tileX, tileY) => new GoblinArcher(tileX, tileY, TILE_SIZE),
    arrows: (map) => new GoblinArrowSystem(map),
  },
];

function runDuel(map: GameMap, crossing: Crossing, bowman: Bowman): Outcome {
  const human = new HumanPlayer(crossing.crawlerTile.x, crossing.crawlerTile.y, TILE_SIZE);
  const cat = new CatPlayer(
    crossing.crawlerTile.x + CAT_PARK_OFFSET_TILES,
    crossing.crawlerTile.y,
    TILE_SIZE,
  );
  const archer = bowman.make(crossing.archerTile.x, crossing.archerTile.y);
  archer.setMap(map);
  const roster = new MobRoster(map, new SpellSystem());
  roster.add(archer);
  const shots = bowman.arrows(map);
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
  };

  let loosed = 0;
  let landedOnCrawler = 0;
  for (let frame = 0; frame < FRAMES_TO_RUN; frame++) {
    archer.updateAI([human]);
    archer.tickTimers();
    if (archer.projectileSoundPending) {
      archer.projectileSoundPending = false;
      loosed++;
    }
    const hpBefore = human.hp;
    shots.update(ctx);
    if (human.hp < hpBefore) landedOnCrawler++;
    // Topped up every frame so a long duel never kills the target it measures.
    human.hp = human.maxHp;
    human.invulnerableFrames = 0;
  }
  return { loosed, landedOnCrawler };
}

let crossingMap: GameMap | null = null;
let crossing: Crossing | null = null;
for (let attempt = 0; attempt < MAX_MAP_ATTEMPTS && crossing === null; attempt++) {
  crossingMap = new GameMap({ mapSize: MAP_SIZE, tileHeight: TILE_SIZE, mapType: 'overworld' });
  crossing = findPalisadeCrossing(crossingMap);
}

const TILE_CENTRE_FRACTION = 0.5;

function tileCentrePx(tile: number): number {
  return (tile + TILE_CENTRE_FRACTION) * TILE_SIZE;
}

if (crossingMap === null || crossing === null) {
  check(false, 'found a straight crossing through the Briar Hollow palisade');
} else {
  const palisadeSeen = crossingMap.hasLineOfSight(
    tileCentrePx(crossing.archerTile.x),
    tileCentrePx(crossing.archerTile.y),
    tileCentrePx(crossing.crawlerTile.x),
    tileCentrePx(crossing.crawlerTile.y),
  );
  check(palisadeSeen, 'a crawler is seen over the palisade (the premise)');
  const openRun = findOpenRun(crossingMap);
  if (openRun === null) check(false, 'found a straight run of open ground');

  for (const bowman of BOWMEN) {
    console.log(`\n${bowman.name}:`);
    const behindPalisade = runDuel(crossingMap, crossing, bowman);
    check(
      behindPalisade.landedOnCrawler === 0,
      `behind a palisade: no arrow reaches the crawler (${behindPalisade.landedOnCrawler})`,
    );
    check(
      behindPalisade.loosed === 0,
      `behind a palisade: no arrow is loosed into it (${behindPalisade.loosed} loosed in ${FRAMES_TO_RUN} frames)`,
    );
    if (openRun === null) continue;
    const inTheOpen = runDuel(crossingMap, openRun, bowman);
    check(inTheOpen.loosed > 0, `open ground: it still shoots (${inTheOpen.loosed} loosed)`);
    check(
      inTheOpen.landedOnCrawler > 0,
      `open ground: its arrows still land (${inTheOpen.landedOnCrawler} hits)`,
    );
  }
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll archer clear-shot checks passed.');
