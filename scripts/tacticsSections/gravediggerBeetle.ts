/**
 * `verify:tactics` sections for the gravedigger beetle line, the one creature
 * whose body changes under its traits: a wandering larva, a pupa that never
 * moves, and a flying adult that hovers and picks fights with other mobs. No
 * stage's AI acts on a trait, so none may learn one.
 *
 * Traits are rolled once, at spawn, while it is still a larva, so the gate
 * grows real larvae through their real growth clock rather than building an
 * adult directly.
 */

import { TILE_SIZE } from '../../src/core/constants';
import type { GameMap } from '../../src/map/GameMap';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import type { BeetleStage, GravediggerBeetle } from '../../src/creatures/GravediggerBeetle';
import { MAX_MOB_LEVEL } from '../../src/levels/spawner';
import { liveSpawnContext, spawnMob } from '../../src/levels/spawnFunnel';
import { DIFFICULTY_PROFILES } from '../../src/core/difficulty/difficultyProfiles';
import type { Rng } from '../../src/sprites/person/rng';
import { GUARD_COOLDOWN_FRAMES } from '../../src/creatures/tactics/blockGuard';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { SpellSystem } from '../../src/systems/SpellSystem';
import type { SystemContext } from '../../src/systems/GameSystem';
import type { TacticsHarness } from './special';
import { harnessHit } from '../crawlerHitHarness';
import { cameraAt, UNZOOMED } from '../../src/core/rendering/camera.js';

/** A source that says yes to every roll, so "no trait" can only mean "not eligible". */
const ALWAYS_YES: Rng = () => 0;

const GROWTH_ORDER: readonly BeetleStage[] = ['larva', 'pupa', 'adult'];
/** Longer than both growth clocks together, so a larva that never hatches is a failure. */
const MAX_GROWTH_FRAMES = 3000;

const PROBE_TILE = 12;
const HUMAN_TILE = { x: 17, y: 12 };
const CAT_TILE = { x: 1, y: 1 };
const START_GAP_TILES = 4.5;
const PACK_ROW_OFFSETS = [-1, 0, 1];
/** Long enough for a pack of adults to close, bite and spit several times. */
const ADULT_RUN_FRAMES = 900;
/** Blows struck at an adult; a real guard chance at the top level would turn several aside. */
const ADULT_GUARD_PROBE_BLOWS = 40;
const PROBE_BLOW_DAMAGE = 1;

interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/** A top-level larva whose spawn roll answered yes to everything, grown to `stage`, or null if it never got there. */
function grownBeetle(
  map: GameMap,
  tile: TilePoint,
  stage: BeetleStage,
  harness: TacticsHarness,
): GravediggerBeetle | null {
  const mob = spawnMob('gravedigger_beetle', tile, map, liveSpawnContext('dev:spawn'));
  mob.applyMobLevel(MAX_MOB_LEVEL);
  mob.rollTactics(DIFFICULTY_PROFILES.hard.tacticsChanceScale, ALWAYS_YES);
  const wanted = GROWTH_ORDER.indexOf(stage);
  for (
    let frame = 0;
    frame < MAX_GROWTH_FRAMES && GROWTH_ORDER.indexOf(mob.stage) < wanted;
    frame++
  ) {
    mob.tickEvolve();
  }
  if (mob.stage !== stage) {
    harness.check(false, `a larva reaches the ${stage} stage within ${MAX_GROWTH_FRAMES} frames`);
    return null;
  }
  return mob;
}

function checkNoStageLearnsATrait(map: GameMap, harness: TacticsHarness): void {
  harness.section('Gravedigger beetle: no stage learns a trait, even rolled at the top level');
  for (const stage of GROWTH_ORDER) {
    const beetle = grownBeetle(map, { x: PROBE_TILE, y: PROBE_TILE }, stage, harness);
    if (beetle === null) continue;
    harness.check(
      !beetle.tactics.hasAnyTrait && !beetle.hasActiveTactics,
      `a ${stage} learns [${beetle.tactics.traits.join(', ') || 'nothing'}] and shows no rank mark`,
    );
  }
}

function checkAdultActsOnNothing(map: GameMap, harness: TacticsHarness): void {
  harness.section('Gravedigger beetle: an adult never moves tactically or guards');

  const human = new HumanPlayer(HUMAN_TILE.x, HUMAN_TILE.y, TILE_SIZE);
  human.godMode = true;
  const cat = new CatPlayer(CAT_TILE.x, CAT_TILE.y, TILE_SIZE);
  cat.godMode = true;
  const roster = new MobRoster(map, new SpellSystem());
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    partner: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
    camera: cameraAt({ x: 0, y: 0 }, UNZOOMED),
  };
  const loop = new MobUpdateLoop();
  const pack: GravediggerBeetle[] = [];
  for (const offset of PACK_ROW_OFFSETS) {
    const tile = { x: HUMAN_TILE.x - START_GAP_TILES, y: HUMAN_TILE.y + offset };
    const adult = grownBeetle(map, tile, 'adult', harness);
    if (adult === null) return;
    roster.add(adult);
    pack.push(adult);
  }
  let tacticalFrames = 0;
  let engagedFrames = 0;
  for (let frame = 0; frame < ADULT_RUN_FRAMES; frame++) {
    loop.update(ctx);
    for (const adult of pack) {
      if (adult.currentTarget !== null) engagedFrames++;
      if (adult.tactics.lastMove !== null) tacticalFrames++;
    }
  }
  loop.dispose();
  harness.check(
    engagedFrames > 0,
    `the adults were in the fight (${engagedFrames} engaged frames)`,
  );
  harness.check(
    tacticalFrames === 0,
    `${tacticalFrames} frames of an adult taking a tactical move`,
  );

  const target = grownBeetle(map, { x: PROBE_TILE, y: PROBE_TILE }, 'adult', harness);
  if (target === null) return;
  const striker = new HumanPlayer(PROBE_TILE + 1, PROBE_TILE, TILE_SIZE);
  let unhurtBlows = 0;
  for (let blow = 0; blow < ADULT_GUARD_PROBE_BLOWS; blow++) {
    const before = target.hp;
    target.takeHit(harnessHit(striker, PROBE_BLOW_DAMAGE, 'melee'));
    if (target.hp >= before) unhurtBlows++;
    for (let frame = 0; frame < GUARD_COOLDOWN_FRAMES; frame++) target.tickTimers();
  }
  harness.check(
    target.tactics.guardChancePerBlow === 0 && unhurtBlows === 0,
    `an adult turns aside ${unhurtBlows} of ${ADULT_GUARD_PROBE_BLOWS} sword blows (guard chance ${target.tactics.guardChancePerBlow})`,
  );
}

export function checkGravediggerBeetleTactics(map: GameMap, harness: TacticsHarness): void {
  checkNoStageLearnsATrait(map, harness);
  checkAdultActsOnNothing(map, harness);
}
