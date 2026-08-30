#!/usr/bin/env tsx
/**
 * Headless checks on the one promise severed body parts make: a creature the
 * player just killed leaves its pieces on the floor.
 *
 * The reported bug was the Hoarder coming apart into nothing — her six pieces
 * burst out of her, flew, and vanished the moment they landed. Her fight is a
 * swarm fight, and the swarm's litter had taken every slot the settled-parts cap
 * allows, so the boss's own remains were the pieces the cap refused.
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
import { HOARDER_FIGURE } from '../src/sprites/art/hoarderFigure.js';
import { COCKROACH_BODY_PART_KEY, COCKROACH_GORE_PARTS } from '../src/sprites/cockroachSprite.js';
import { HOARDER_BODY_PART_KEY, HOARDER_GORE_PARTS } from '../src/sprites/hoarderSprite.js';
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
import { JUICER_BODY_PART_KEY, JUICER_GORE_PARTS } from '../src/sprites/juicerSprite.js';
import {
  BRINDLED_VESPA_BODY_PART_KEY,
  BRINDLED_VESPA_GORE_PARTS,
} from '../src/sprites/brindledVespaSprite.js';
import { KRAKAREN_BODY_PART_KEY, KRAKAREN_GORE_PARTS } from '../src/sprites/krakarenSprite.js';
import {
  KRAKAREN_TENTACLE_BODY_PART_KEY,
  KRAKAREN_TENTACLE_GORE_PARTS,
} from '../src/sprites/krakarenTentacleSprite.js';
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
  [HOARDER_BODY_PART_KEY, HOARDER_GORE_PARTS],
  [COCKROACH_BODY_PART_KEY, COCKROACH_GORE_PARTS],
  [RAT_BODY_PART_KEY, RAT_GORE_PARTS],
  [LLAMA_BODY_PART_KEY, LLAMA_GORE_PARTS],
  [MANTID_BODY_PART_KEY, MANTID_GORE_PARTS],
  [MANTIS_BODY_PART_KEY, MANTID_GORE_PARTS],
  [EVIL_CLOWN_BODY_PART_KEY, EVIL_CLOWN_GORE_PARTS],
  [DARK_KNIGHT_BODY_PART_KEY, DARK_KNIGHT_GORE_PARTS],
  [TROGLODYTE_BODY_PART_KEY, TROGLODYTE_GORE_PARTS],
  [TUSKLING_BODY_PART_KEY, TUSKLING_GORE_PARTS],
  [JUICER_BODY_PART_KEY, JUICER_GORE_PARTS],
  [BRINDLED_VESPA_BODY_PART_KEY, BRINDLED_VESPA_GORE_PARTS],
  [KRAKAREN_BODY_PART_KEY, KRAKAREN_GORE_PARTS],
  [KRAKAREN_TENTACLE_BODY_PART_KEY, KRAKAREN_TENTACLE_GORE_PARTS],
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

function checkBossRemainsSurviveHerOwnSwarm(): void {
  console.log("\nthe boss's remains outlive the litter of the swarm she spawned");
  const { map, centre } = openArena();
  const gore = new BodyPartGoreSystem(map);

  for (let corpse = 0; corpse < SWARM_CORPSES; corpse++) {
    gore.spawnParts(centre.x, centre.y, COCKROACH_BODY_PART_KEY, TILE_SIZE);
  }
  step(gore, FRAMES_TO_SETTLE);

  const litterOnTheFloor = gore.settledCount;
  check(
    litterOnTheFloor >= EXPECTED_MAX_SETTLED_PARTS,
    `the swarm saturated the cap before she died (${litterOnTheFloor} pieces resting)`,
  );

  gore.spawnParts(centre.x, centre.y, HOARDER_BODY_PART_KEY, TILE_SIZE);
  step(gore, FRAMES_TO_SETTLE);

  const hersOnTheFloor = gore.countSettledFrom(HOARDER_FIGURE);
  check(
    hersOnTheFloor === HOARDER_GORE_PARTS.length,
    `${hersOnTheFloor} of her ${HOARDER_GORE_PARTS.length} pieces are on the floor`,
  );
  check(
    gore.settledCount <= EXPECTED_MAX_SETTLED_PARTS,
    `the cap still bounds the floor (${gore.settledCount} pieces resting)`,
  );
  check(
    gore.countSettledFrom(COCKROACH_FIGURE) < litterOnTheFloor,
    'room for her was made out of the oldest litter, not out of her own pieces',
  );
}

console.log('gore: severed body parts');
checkEveryCorpseLandsOnEmptyGround();
checkBossRemainsSurviveHerOwnSwarm();

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
