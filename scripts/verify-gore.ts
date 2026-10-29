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
import { LLAMA_BODY_PART_KEY, LLAMA_GORE_PARTS } from '../src/sprites/llamaSprite.js';
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
import {
  TROGLODYTE_BODY_PART_KEY,
  TROGLODYTE_GORE_PARTS,
} from '../src/sprites/troglodyteSprite.js';
import { TUSKLING_BODY_PART_KEY, TUSKLING_GORE_PARTS } from '../src/sprites/tusklingSprite.js';
import { ROOSTER_BODY_PART_KEYS, ROOSTER_GORE_PARTS } from '../src/sprites/roosterSprite.js';
import {
  BRINDLED_VESPA_BODY_PART_KEY,
  BRINDLED_VESPA_GORE_PARTS,
} from '../src/sprites/brindledVespaSprite.js';
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

/**
 * A `GameMap` left on its default tile height measures world pixels against a
 * ten-pixel grid, which silently breaks anything that mixes tiles and pixels.
 */
const MAP_OPTIONS = { mapSize: 60, tileHeight: TILE_SIZE } as const;

/**
 * The clear ground a corpse needs around it. Pieces glide for about three tiles
 * before they touch down, and the widest of them reaches most of a tile from its
 * own centre, so a smaller room would have them tumbling into whatever walls the
 * generator happened to put nearby — motion this gate has no reason to exercise.
 */
const OPEN_GROUND_RADIUS_TILES = 5;

/** Where in a tile its centre point sits. */
const TILE_CENTRE_RATIO = 0.5;

/** Long enough for the highest pop to fall, tumble the full slide, and settle. */
const FRAMES_TO_SETTLE = 240;

/**
 * The cap the system enforces, restated rather than imported: a gate that reads
 * the constant it is testing can only prove the code agrees with itself.
 */
const EXPECTED_MAX_SETTLED_PARTS = 200;

/** How many random dungeons to try before giving up on finding a wide enough room. */
const ARENA_GENERATION_ATTEMPTS = 40;

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

function findOpenGroundCentre(map: GameMap): { x: number; y: number } | null {
  for (let tileY = OPEN_GROUND_RADIUS_TILES; tileY < MAP_OPTIONS.mapSize; tileY++) {
    for (let tileX = OPEN_GROUND_RADIUS_TILES; tileX < MAP_OPTIONS.mapSize; tileX++) {
      let allWalkable = true;
      for (
        let dy = -OPEN_GROUND_RADIUS_TILES;
        dy <= OPEN_GROUND_RADIUS_TILES && allWalkable;
        dy++
      ) {
        for (let dx = -OPEN_GROUND_RADIUS_TILES; dx <= OPEN_GROUND_RADIUS_TILES; dx++) {
          if (map.isWalkable(tileX + dx, tileY + dy)) continue;
          allWalkable = false;
          break;
        }
      }
      if (allWalkable) {
        return {
          x: (tileX + TILE_CENTRE_RATIO) * TILE_SIZE,
          y: (tileY + TILE_CENTRE_RATIO) * TILE_SIZE,
        };
      }
    }
  }
  return null;
}

/**
 * A generated dungeon with a room wide enough to drop a corpse in the middle of,
 * and that room's centre. Dungeons are generated at random and a given one may
 * have no room that wide, so this retries rather than trusting the first.
 */
function openArena(): { map: GameMap; centre: { x: number; y: number } } {
  for (let attempt = 0; attempt < ARENA_GENERATION_ATTEMPTS; attempt++) {
    const map = new GameMap(MAP_OPTIONS);
    const centre = findOpenGroundCentre(map);
    if (centre !== null) return { map, centre };
  }
  throw new Error('no generated dungeon offered a room wide enough to drop a corpse in');
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
  [LLAMA_BODY_PART_KEY, LLAMA_GORE_PARTS],
  [MANTID_BODY_PART_KEY, MANTID_GORE_PARTS],
  [MANTIS_BODY_PART_KEY, MANTID_GORE_PARTS],
  [EVIL_CLOWN_BODY_PART_KEY, EVIL_CLOWN_GORE_PARTS],
  [DARK_KNIGHT_BODY_PART_KEY, DARK_KNIGHT_GORE_PARTS],
  [TROGLODYTE_BODY_PART_KEY, TROGLODYTE_GORE_PARTS],
  [TUSKLING_BODY_PART_KEY, TUSKLING_GORE_PARTS],
  [ROOSTER_BODY_PART_KEYS.big, ROOSTER_GORE_PARTS],
  [ROOSTER_BODY_PART_KEYS.little, ROOSTER_GORE_PARTS],
  [ROOSTER_BODY_PART_KEYS.bent, ROOSTER_GORE_PARTS],
  [BRINDLED_VESPA_BODY_PART_KEY, BRINDLED_VESPA_GORE_PARTS],
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
