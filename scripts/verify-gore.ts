#!/usr/bin/env tsx
/**
 * Headless checks on the one promise severed body parts make: a creature the
 * player just killed leaves its pieces on the floor.
 *
 * The failure this guards against is the Trash Gremlin coming apart into
 * nothing — its pieces burst out of it, fly, and vanish the moment they land.
 * Its fight is a swarm fight, and the swarm's litter can take every slot the
 * settled-parts cap allows, so the boss's own remains would be the pieces the
 * cap refused.
 *
 * Both halves of that are checked here, because either alone passes vacuously:
 * a cap that never fills makes the boss check meaningless, and a cap that has
 * quietly become unbounded makes it trivial. So the swarm is asserted to have
 * saturated the cap before the boss dies, and the cap is asserted to still hold
 * afterwards.
 *
 * Run: npx tsx scripts/verify-gore.ts
 */

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { openFloorGrid } from '../src/map/openFloorGrid.js';
import { BodyPartGoreSystem } from '../src/systems/BodyPartGoreSystem.js';
import { COCKROACH_FIGURE } from '../src/sprites/art/cockroachFigure.js';
import { TRASH_GREMLIN_FIGURE } from '../src/sprites/art/trashGremlinFigure.js';
import { COCKROACH_BODY_PART_KEY, COCKROACH_GORE_PARTS } from '../src/sprites/cockroachSprite.js';
import {
  TRASH_GREMLIN_BODY_PART_KEY,
  TRASH_GREMLIN_GORE_PARTS,
} from '../src/sprites/trashGremlinSprite.js';
import { GOBLIN_GORE_PARTS, goblinBodyPartKey } from '../src/sprites/goblinSprite.js';
import { RAT_BODY_PART_KEY, RAT_GORE_PARTS } from '../src/sprites/ratSprite.js';
import { ACID_LLAMA_BODY_PART_KEY, ACID_LLAMA_GORE_PARTS } from '../src/sprites/acidLlamaSprite.js';
import {
  MANTID_BODY_PART_KEY,
  MANTID_GORE_PARTS,
  MANTIS_BODY_PART_KEY,
} from '../src/sprites/mantidSprite.js';
import { EVIL_CLOWN_BODY_PART_KEY, EVIL_CLOWN_GORE_PARTS } from '../src/sprites/evilClownSprite.js';
import {
  DARK_KNIGHT_BODY_PART_KEY,
  DARK_KNIGHT_GORE_PARTS,
} from '../src/sprites/darkKnightSprite.js';
import { LIZARDMAN_BODY_PART_KEY, LIZARDMAN_GORE_PARTS } from '../src/sprites/lizardmanSprite.js';
import { WEREBOAR_BODY_PART_KEY, WEREBOAR_GORE_PARTS } from '../src/sprites/wereboarSprite.js';
import { ROOSTER_BODY_PART_KEYS, ROOSTER_GORE_PARTS } from '../src/sprites/roosterSprite.js';
import { GIANT_WASP_BODY_PART_KEY, GIANT_WASP_GORE_PARTS } from '../src/sprites/giantWaspSprite.js';
import {
  GRAVEDIGGER_BEETLE_BODY_PART_KEY,
  GRAVEDIGGER_BEETLE_GORE_PARTS,
} from '../src/sprites/gravediggerBeetleSprite.js';
import { KRAKEN_BODY_PART_KEY, KRAKEN_GORE_PARTS } from '../src/sprites/krakenSprite.js';
import {
  KRAKEN_TENTACLE_BODY_PART_KEY,
  KRAKEN_TENTACLE_GORE_PARTS,
} from '../src/sprites/krakenTentacleSprite.js';
import {
  SKELETON_ARCHER_BODY_PART_KEY,
  SKELETON_GORE_PARTS,
  SKELETON_LORD_BODY_PART_KEY,
  SKELETON_SWORD_BODY_PART_KEY,
} from '../src/sprites/skeletonSprite.js';
import { LICH_BODY_PART_KEY } from '../src/sprites/lichSprite.js';
import {
  ROCK_GOLEM_BODY_PART_KEY,
  ROCK_GOLEM_BOSS_BODY_PART_KEY,
  ROCK_GOLEM_GORE_PARTS,
} from '../src/sprites/rockGolemSprite.js';

installCanvasGlobals();

/** Wide enough that nothing dropped in the middle of the arena reaches its edge. */
const ARENA_SIZE_TILES = 60;

/** Where in a tile its centre point sits. */
const TILE_CENTRE_RATIO = 0.5;

/** Long enough for the highest pop to fall, tumble the full slide, and settle. */
const FRAMES_TO_SETTLE = 240;

/**
 * The cap the system enforces, restated rather than imported: a gate that reads
 * the constant it is testing can only prove the code agrees with itself.
 */
const EXPECTED_MAX_SETTLED_PARTS = 200;

/**
 * Roach corpses the swarm leaves behind during the fight. Eight pieces apiece,
 * so this is comfortably more litter than the cap can hold — and it is dropped
 * all at once, well inside one part's lifetime, because a swarm spread thinly
 * enough for its earliest litter to despawn frees the very slots the bug is
 * about the boss being denied.
 */
const SWARM_CORPSES = 30;

let failures = 0;

function check(passed: boolean, description: string): void {
  if (passed) {
    console.log(`  PASS  ${description}`);
    return;
  }
  console.log(`  FAIL  ${description}`);
  failures++;
}

/**
 * An open floor with nothing to tumble into, and its centre. Built at the game's
 * own tile size: a `GameMap` left on its default tile height measures world
 * pixels against a ten-pixel grid, which silently breaks anything that mixes
 * tiles and pixels.
 */
function openArena(): { map: GameMap; centre: { x: number; y: number } } {
  const map = new GameMap({
    tileHeight: TILE_SIZE,
    prebuiltStructure: openFloorGrid(ARENA_SIZE_TILES),
  });
  const centreTile = Math.floor(ARENA_SIZE_TILES / 2);
  const centrePx = (centreTile + TILE_CENTRE_RATIO) * TILE_SIZE;
  return { map, centre: { x: centrePx, y: centrePx } };
}

function step(gore: BodyPartGoreSystem, frames: number): void {
  for (let frame = 0; frame < frames; frame++) gore.update();
}

/**
 * Every key a mob can carry into `spawnParts`, with the pieces it owes. Written
 * out from the sprite modules rather than read off the system's own registry, so
 * a key the registry never learned about fails here instead of silently
 * dropping that creature's whole corpse.
 */
const GORE_CONTRACT: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  [TRASH_GREMLIN_BODY_PART_KEY, TRASH_GREMLIN_GORE_PARTS],
  [COCKROACH_BODY_PART_KEY, COCKROACH_GORE_PARTS],
  [RAT_BODY_PART_KEY, RAT_GORE_PARTS],
  [ACID_LLAMA_BODY_PART_KEY, ACID_LLAMA_GORE_PARTS],
  [MANTID_BODY_PART_KEY, MANTID_GORE_PARTS],
  [MANTIS_BODY_PART_KEY, MANTID_GORE_PARTS],
  [EVIL_CLOWN_BODY_PART_KEY, EVIL_CLOWN_GORE_PARTS],
  [DARK_KNIGHT_BODY_PART_KEY, DARK_KNIGHT_GORE_PARTS],
  [LIZARDMAN_BODY_PART_KEY, LIZARDMAN_GORE_PARTS],
  [WEREBOAR_BODY_PART_KEY, WEREBOAR_GORE_PARTS],
  [ROOSTER_BODY_PART_KEYS.big, ROOSTER_GORE_PARTS],
  [ROOSTER_BODY_PART_KEYS.little, ROOSTER_GORE_PARTS],
  [ROOSTER_BODY_PART_KEYS.bent, ROOSTER_GORE_PARTS],
  [GIANT_WASP_BODY_PART_KEY, GIANT_WASP_GORE_PARTS],
  [GRAVEDIGGER_BEETLE_BODY_PART_KEY, GRAVEDIGGER_BEETLE_GORE_PARTS],
  [KRAKEN_BODY_PART_KEY, KRAKEN_GORE_PARTS],
  [KRAKEN_TENTACLE_BODY_PART_KEY, KRAKEN_TENTACLE_GORE_PARTS],
  [SKELETON_LORD_BODY_PART_KEY, SKELETON_GORE_PARTS],
  [SKELETON_SWORD_BODY_PART_KEY, SKELETON_GORE_PARTS],
  [SKELETON_ARCHER_BODY_PART_KEY, SKELETON_GORE_PARTS],
  [LICH_BODY_PART_KEY, SKELETON_GORE_PARTS],
  [ROCK_GOLEM_BODY_PART_KEY, ROCK_GOLEM_GORE_PARTS],
  [ROCK_GOLEM_BOSS_BODY_PART_KEY, ROCK_GOLEM_GORE_PARTS],
  [goblinBodyPartKey('sword'), GOBLIN_GORE_PARTS],
  [goblinBodyPartKey('axe'), GOBLIN_GORE_PARTS],
  [goblinBodyPartKey('mace'), GOBLIN_GORE_PARTS],
  [goblinBodyPartKey('warhammer'), GOBLIN_GORE_PARTS],
];

function checkEveryCorpseLandsOnEmptyGround(): void {
  console.log('\nevery registered corpse leaves its full set of pieces on open ground');
  const { map, centre } = openArena();
  for (const [bodyPartKey, parts] of GORE_CONTRACT) {
    const gore = new BodyPartGoreSystem(map);
    gore.spawnParts(centre.x, centre.y, bodyPartKey, TILE_SIZE);
    step(gore, FRAMES_TO_SETTLE);
    check(
      gore.settledCount === parts.length,
      `${bodyPartKey}: ${gore.settledCount} of ${parts.length} pieces at rest`,
    );
  }
}

function checkBossRemainsSurviveItsSwarm(): void {
  console.log("\nthe boss's remains outlive the litter of the swarm it summoned");
  const { map, centre } = openArena();
  const gore = new BodyPartGoreSystem(map);

  for (let corpse = 0; corpse < SWARM_CORPSES; corpse++) {
    gore.spawnParts(centre.x, centre.y, COCKROACH_BODY_PART_KEY, TILE_SIZE);
  }
  step(gore, FRAMES_TO_SETTLE);

  const litterOnTheFloor = gore.settledCount;
  check(
    litterOnTheFloor >= EXPECTED_MAX_SETTLED_PARTS,
    `the swarm saturated the cap before it died (${litterOnTheFloor} pieces resting)`,
  );

  gore.spawnParts(centre.x, centre.y, TRASH_GREMLIN_BODY_PART_KEY, TILE_SIZE);
  step(gore, FRAMES_TO_SETTLE);

  const bossPiecesOnTheFloor = gore.countSettledFrom(TRASH_GREMLIN_FIGURE);
  check(
    bossPiecesOnTheFloor === TRASH_GREMLIN_GORE_PARTS.length,
    `${bossPiecesOnTheFloor} of its ${TRASH_GREMLIN_GORE_PARTS.length} pieces are on the floor`,
  );
  check(
    gore.settledCount <= EXPECTED_MAX_SETTLED_PARTS,
    `the cap still bounds the floor (${gore.settledCount} pieces resting)`,
  );
  check(
    gore.countSettledFrom(COCKROACH_FIGURE) < litterOnTheFloor,
    'room for the boss was made out of the oldest litter, not out of its own pieces',
  );
}

console.log('gore: severed body parts');
checkEveryCorpseLandsOnEmptyGround();
checkBossRemainsSurviveItsSwarm();

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
