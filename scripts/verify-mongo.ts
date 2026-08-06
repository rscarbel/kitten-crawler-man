#!/usr/bin/env tsx
/**
 * Headless checks for the pet raptor's reliability — the failures that need
 * distance and time, and were therefore invisible to every other gate.
 *
 * The reported bug was "Mongo vanishes". It was never a teleport: it was a
 * *freeze*, reachable three ways, with no recovery path the player could see. A
 * freeze produces no exception, no type error and no lint complaint; it produces
 * an absent raptor twenty seconds and forty tiles later. So the checks below
 * drive real frames on a real generated map and assert the one property that
 * matters: **a summoned Mongo is never far from the cat for long, and never
 * unrecoverable at all.**
 *
 * Deliberately independent numbers. The tolerances here are written down again
 * rather than imported from `Mongo.ts`, because a gate that reads the constant
 * it is checking can only ever prove the code agrees with itself.
 *
 * The map generators run on unseeded `Math.random()`, so this is a random sample
 * rather than a deterministic gate — run it more than once if something looks
 * marginal. How the rescue *reads* on screen is still a `[HUMAN]` check.
 *
 * Run: npx tsx scripts/verify-mongo.ts
 */

import { GameMap } from '../src/map/GameMap';
import { SpatialGrid } from '../src/core/SpatialGrid';
import { MOB_GRID_CELL_SIZE, PLAYER_SPEED, TILE_SIZE } from '../src/core/constants';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import type { Mob } from '../src/creatures/Mob';
import type { Mongo } from '../src/creatures/Mongo';
import {
  MONGO_BUTTON_LABELS,
  MONGO_BUTTON_TEXT_MIN_GAP,
  MONGO_BUTTON_TEXT_SIZES,
  MongoSystem,
  SUMMON_BUTTON_WIDTH,
} from '../src/systems/MongoSystem';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import { createMongoPetState, type MongoPetState } from '../src/core/MongoPetState';
import {
  getMongoStats,
  MONGO_DAMAGE_PER_XP,
  MONGO_DEF,
  MONGO_MAX_LEVEL,
} from '../src/abilities/mongo';
import type { SystemContext } from '../src/systems/GameSystem';
import { createMob } from '../src/levels/spawner';
import { hasRoomToMove } from '../src/map/findWalkableTile';
import { setPackAlertGrid } from '../src/creatures/packAlert';

const MAP_SIZE = 220;

/**
 * The cat-distance a summoned Mongo may never exceed, in tiles.
 *
 * Above the distance at which he asks to be rescued and below the mob loop's
 * 22-tile activation radius, which is the band the whole fix has to live inside:
 * past 22 the old code stopped ticking him entirely, so any lag allowance at or
 * above it would be asserting the bug is fine.
 */
const MAX_LAG_TILES = 20;
/**
 * Frames a fully blocked Mongo may spend stuck before the rescue lands.
 *
 * Comfortably over the pathfinder's failure backoff plus its denial cap, which
 * together are how long a single failed search can keep reading as a failure —
 * and which the stall limit has to outlast, or it cannot tell one unlucky search
 * from a sealed door. Two-and-a-bit seconds of a visibly stuck raptor is the
 * price of never teleporting one who was fine, and he is on the minimap and the
 * screen edge throughout.
 */
const MAX_STALL_RESCUE_FRAMES = 240;
/** How close to the cat a rescue has to put him for it to count as "brought home". */
const RESCUE_ARRIVAL_TILES = 5;
/** Long enough that a level-1 raptor at 2.0 px/frame falls badly behind a 2.5 px/frame cat. */
const WALK_AWAY_FRAMES = 1800;
/**
 * Ground the cat must cover for the walk-away run to have tested anything.
 *
 * Well under the ~75 tiles an unobstructed walk of `WALK_AWAY_FRAMES` covers, so
 * ordinary detours around geometry do not fail it — but far enough that a cat
 * stuck against a wall does.
 */
const MIN_CAT_TRAVEL_TILES = 40;
/**
 * Lag the walk-away run has to produce before its upper bound means anything.
 *
 * Above the 3-tile follow threshold, so clearing it proves he spent the run in
 * the follow path rather than standing at her shoulder the whole way.
 */
const MIN_MEANINGFUL_LAG_TILES = 4;
/**
 * Maps the walk-away run may re-roll before giving up.
 *
 * The generator is unseeded, so roughly one map in twenty pens the cat into a
 * region she cannot leave — she walks her forty tiles going nowhere, and a slower
 * pet cuts every corner. Re-rolling keeps the premise strict rather than
 * loosening it to accommodate the bad map.
 */
const WALK_AWAY_ATTEMPTS = 4;
/**
 * A single-frame move larger than any walk step, i.e. certainly a rescue.
 *
 * Read off the creature rather than off the cat-distance, because a rescue that
 * lands beside an already-nearby cat barely changes that distance at all.
 */
const TELEPORT_JUMP_TILES = 3;
/**
 * Cat-distance under which, on open ground, a rescue is a bug rather than a fix.
 *
 * Inside the 18-tile hard bar with room to spare, so only the stall counter could
 * have produced a teleport here — and on ground he has a route across, the stall
 * counter firing means it fired on nothing.
 */
const NO_RESCUE_EXPECTED_TILES = 15;
/**
 * Frames of a stalled recall to let run before the button's forced rescue is
 * expected to be honoured.
 *
 * Must sit above the creature's own grace period and below its stall limit, or
 * the check stops distinguishing "the press worked" from "he asked for himself".
 */
const RECALL_GRACE_TICKS = 120;
/** Frames allowed for a stuck recall to finish despawning after its rescue. */
const RECALL_COMPLETION_FRAMES = 400;

/** A cat-distance no pet should ever reach, used to place one absurdly far away. */
const FAR_EXILE_TILES = 40;

/**
 * Where a pinned pet is placed for the stall runs: past the follow threshold so
 * he is actually trying to walk home, and well inside the hard rescue distance
 * so the stall counter — not the distance bar — is what fires.
 */
const STALL_BAND_MIN_TILES = 5;
const STALL_BAND_MAX_TILES = 14;

/**
 * The hostile used to put a threat on the cat.
 *
 * An ordinary early-floor melee mob on purpose: the behaviour under test is
 * Mongo's target selection, so the attacker wants no special abilities of its
 * own that could end the run for an unrelated reason.
 */
const ATTACKER_MOB_ID = 'goblin';

/** Ranges the two targeting-test hostiles stand at, both inside the engage bubble. */
const BYSTANDER_TILES = 3;
const CONTENDER_TILES = 6;
/** Frames given to the AI to settle on a target before it is read. */
const TARGETING_SETTLE_FRAMES = 20;

/**
 * A blow large enough that the resistance's effect on it is unambiguous, and the
 * fraction of it he should actually take.
 *
 * Written down again rather than imported, per the note at the top of the file:
 * a gate reading `MONGO_DAMAGE_TAKEN_MULTIPLIER` would pass whatever that
 * constant said.
 */
const BIG_BLOW_DAMAGE = 20;
const EXPECTED_DAMAGE_MULTIPLIER = 0.6;
/** Whole hit points of slack, for the ledger's carried fraction. */
const DAMAGE_ROUNDING_SLACK = 1;
/** Enough one-point ticks that per-blow rounding could not hide inside the slack. */
const STATUS_TICKS = 10;
/**
 * A long run of one-point mob-on-mob damage, standing in for a pet loitering on
 * a protective shell's edge. Long enough that an unbounded ledger would have
 * banked tens of hit points of free immunity by the end of it.
 */
const SHELL_TICKS = 200;
/** Blows thrown after that run, to prove no credit was banked. */
const BLOWS_AFTER_TICKS = 4;

/** Health fraction the wounded-retreat run puts him at: comfortably under the threshold. */
const WOUNDED_HP_FRACTION = 0.15;
/** The fraction at which he is expected to stop fighting, written down independently. */
const RETREAT_HP_FRACTION = 0.25;
/**
 * Health, as a fraction of his maximum, that a freshly summoned pet must have
 * above the retreat threshold — i.e. how much fighting a summon is worth at the
 * very worst. A couple of blows, not a single point.
 */
const MIN_FIGHTING_ROOM_FRACTION = 0.1;
const PERCENT = 100;

/**
 * A monospace em width no real browser font exceeds.
 *
 * Above the 0.6 the canvas default actually measures at, because the button's
 * text budget must survive a fallback font rather than only the expected one.
 */
const PESSIMISTIC_EM_RATIO = 0.65;
/** Frames run after a one-shot notice to prove it is a one-shot. */
const NOTICE_REPEAT_FRAMES = 30;
/** The largest health number the button ever prints, for the width budget. */
const MONGO_LARGEST_HP = getMongoStats(MONGO_MAX_LEVEL).maxHp;

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

/**
 * The slice of `SystemContext` these systems read. Built by hand rather than
 * mocked wholesale so a field they start depending on shows up here as a compile
 * error rather than as silently absent behaviour.
 */
function makeContext(
  human: HumanPlayer,
  cat: CatPlayer,
  map: GameMap,
  mobs: Mob[],
  mobGrid: SpatialGrid<Mob>,
): SystemContext {
  return {
    human,
    cat,
    active: cat,
    inactive: human,
    activeIsMoving: true,
    mobs,
    mobGrid,
    gameMap: map,
  };
}

/**
 * A blocked tile, all four of whose neighbours are also blocked, within a band
 * of `from` — somewhere a creature dropped into it genuinely cannot move.
 *
 * Real geometry rather than a poked speed field, because the stall watchdog is
 * meant to answer real geometry: a closed boss door, a one-tile pocket, a
 * diagonal gap A* will not route. All three present identically to him — no
 * route home and no ground covered — and solid masonry is the version of that
 * a generated map can be relied on to contain.
 *
 * Returned inside a band rather than anywhere: too close and he is not
 * following at all, too far and the hard distance rescue fires first and this
 * check silently stops testing the counter it names.
 */
function findEnclosedBlockedTile(
  map: GameMap,
  from: { x: number; y: number },
  minTiles: number,
  maxTiles: number,
): { x: number; y: number } | null {
  const size = map.structure.length;
  const isSolid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < size && y < size && !map.isWalkable(x, y);
  for (let radius = Math.ceil(minTiles); radius <= Math.floor(maxTiles); radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = from.x + dx;
        const y = from.y + dy;
        if (!isSolid(x, y)) continue;
        if (!isSolid(x + 1, y) || !isSolid(x - 1, y)) continue;
        if (!isSolid(x, y + 1) || !isSolid(x, y - 1)) continue;
        return { x, y };
      }
    }
  }
  return null;
}

/**
 * A cat that keeps walking, the way a player leaving a fight behind does.
 *
 * Routed rather than steered: an earlier version aimed her straight at a distant
 * tile and she spent the whole run pressed into the first wall between, which
 * made the run look like a pass while testing nothing — the pet caught up
 * because nobody was going anywhere. She now walks A* hops, preferring each next
 * hop to be further from where she started, so the gap she opens on a slower
 * animal is the gap ordinary forward progress opens.
 */
function makeCatWalker(map: GameMap, cat: CatPlayer): () => void {
  const HOP_TILES = 20;
  const HOP_ATTEMPTS = 300;
  const HALF_TILE = TILE_SIZE / 2;

  const tileOf = (px: number): number => Math.floor((px + HALF_TILE) / TILE_SIZE);
  const origin = { x: tileOf(cat.x), y: tileOf(cat.y) };
  let route: Array<{ x: number; y: number }> = [];

  const tryHopsFrom = (from: { x: number; y: number }, mustHeadOut: boolean): boolean => {
    const outwardNow = Math.hypot(from.x - origin.x, from.y - origin.y);
    for (let attempt = 0; attempt < HOP_ATTEMPTS; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const gx = Math.round(from.x + Math.cos(angle) * HOP_TILES);
      const gy = Math.round(from.y + Math.sin(angle) * HOP_TILES);
      if (!map.isWalkable(gx, gy)) continue;
      if (mustHeadOut && Math.hypot(gx - origin.x, gy - origin.y) <= outwardNow) continue;
      const path = map.findPath(from.x, from.y, gx, gy);
      if (path.length === 0) continue;
      route = path;
      return true;
    }
    return false;
  };

  const planHop = (): void => {
    const from = { x: tileOf(cat.x), y: tileOf(cat.y) };
    if (tryHopsFrom(from, true)) return;
    // Nothing further out is reachable — a cove, a cliff, the map edge. Re-anchor
    // on where she stands rather than accepting an inward hop: accepting one lets
    // her oscillate around a point, and a cat who doubles back is one a slower
    // animal cuts the corner on and never falls behind. That produces a run that
    // covers plenty of ground while never testing the follow at all.
    origin.x = from.x;
    origin.y = from.y;
    tryHopsFrom(from, true);
  };

  return () => {
    if (route.length === 0) planHop();
    const waypoint = route[0];
    if (waypoint === undefined) return;
    const targetX = waypoint.x * TILE_SIZE;
    const targetY = waypoint.y * TILE_SIZE;
    const dx = targetX - cat.x;
    const dy = targetY - cat.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= PLAYER_SPEED) {
      cat.x = targetX;
      cat.y = targetY;
      route.shift();
      return;
    }
    cat.x += (dx / distance) * PLAYER_SPEED;
    cat.y += (dy / distance) * PLAYER_SPEED;
  };
}

interface Harness {
  map: GameMap;
  /** The durable pet record, so a run can put his health where it needs it. */
  petState: MongoPetState;
  /** Everything the System said, in order — the notices are a feature, so they are checked. */
  announced: string[];
  human: HumanPlayer;
  cat: CatPlayer;
  mobs: Mob[];
  mobGrid: SpatialGrid<Mob>;
  system: MongoSystem;
  ctx: SystemContext;
}

/**
 * A second harness sharing an existing pet record, the way a stairwell or a shop
 * door builds a new scene around the one the party carries with them.
 */
function adoptPetState(petState: MongoPetState): Harness {
  const adopted = buildHarness(petState);
  adopted.announced.length = 0;
  return adopted;
}

function buildHarness(existingPetState?: MongoPetState): Harness {
  // `tileHeight` is not optional in practice, whatever its default says: the map
  // measures line of sight in these units while every caller passes world pixels,
  // so a map built without it silently answers every sight question against a
  // grid three times too fine. The scene passes TILE_SIZE; so must this.
  const map = new GameMap({ mapSize: MAP_SIZE, tileHeight: TILE_SIZE, mapType: 'overworld' });
  const start = map.startTile;
  const human = new HumanPlayer(start.x, start.y, TILE_SIZE);
  const cat = new CatPlayer(start.x, start.y, TILE_SIZE);
  const mobs: Mob[] = [];
  const mobGrid = new SpatialGrid<Mob>(MOB_GRID_CELL_SIZE);
  // The pack-alert grid is a module global that `MobUpdateLoop` normally
  // publishes. Left unset, a scenario that never runs the loop queries whichever
  // grid the *previous* scenario installed — and the shout it was meant to raise
  // silently reaches nobody.
  setPackAlertGrid(mobGrid);
  const petState =
    existingPetState ?? createMongoPetState(getMongoStats(1).maxHp, getMongoStats(1).maxHp);
  const announced: string[] = [];
  const system = new MongoSystem(
    petState,
    () => 1,
    () => {
      /* XP pacing is checked arithmetically below, not by driving fights */
    },
    () => 0,
    (message) => announced.push(message),
  );
  system.unlocked = true;
  return {
    map,
    petState,
    announced,
    human,
    cat,
    mobs,
    mobGrid,
    system,
    ctx: makeContext(human, cat, map, mobs, mobGrid),
  };
}

function summonInto(h: Harness): Mongo | null {
  const mongo = h.system.summon(h.cat, h.map);
  if (mongo === null) return null;
  h.mobs.push(mongo);
  h.mobGrid.insert(mongo);
  return mongo;
}

/**
 * A walkable tile roughly `tiles` away from `from` that the pet can both stand
 * in and see, or null.
 *
 * Searched over a band of radii rather than one exact ring, and falling back
 * from "room to move" to plain walkability: on a generated overworld a single
 * ring of 24 samples at one distance regularly finds nothing at all, and a
 * targeting check that cannot place its mobs reports a failure about the map
 * rather than about the code.
 */
function findOpenTileNear(
  map: GameMap,
  from: { x: number; y: number },
  tiles: number,
): { x: number; y: number } | null {
  const STEPS_AROUND = 32;
  const RADIUS_SLACK_TILES = 2;
  const visibleFrom = (x: number, y: number): boolean =>
    map.hasLineOfSight(
      (from.x + 0.5) * TILE_SIZE,
      (from.y + 0.5) * TILE_SIZE,
      (x + 0.5) * TILE_SIZE,
      (y + 0.5) * TILE_SIZE,
    );

  for (const roomy of [true, false]) {
    for (let slack = 0; slack <= RADIUS_SLACK_TILES; slack++) {
      for (const radius of [tiles + slack, tiles - slack]) {
        if (radius < 1) continue;
        for (let step = 0; step < STEPS_AROUND; step++) {
          const angle = (step / STEPS_AROUND) * Math.PI * 2;
          const x = Math.round(from.x + Math.cos(angle) * radius);
          const y = Math.round(from.y + Math.sin(angle) * radius);
          if (!map.isWalkable(x, y)) continue;
          if (roomy && !hasRoomToMove(map, x, y)) continue;
          if (!visibleFrom(x, y)) continue;
          return { x, y };
        }
      }
    }
  }
  return null;
}

/** Puts a live hostile on the map, wired the way the spawner would. */
function spawnHostile(h: Harness, tile: { x: number; y: number }): Mob {
  const mob = createMob(ATTACKER_MOB_ID, tile.x, tile.y, h.map);
  mob.setMap(h.map);
  h.mobs.push(mob);
  h.mobGrid.insert(mob);
  return mob;
}

/** Drops `mongo` into `tile` and re-indexes him, the way the game must after any teleport. */
function pinInto(h: Harness, mongo: Mongo, tile: { x: number; y: number }): void {
  const preX = mongo.x;
  const preY = mongo.y;
  mongo.x = tile.x * TILE_SIZE;
  mongo.y = tile.y * TILE_SIZE;
  h.mobGrid.move(mongo, preX, preY);
}

/** One frame of the real ordering: mob AI, then the pet system that answers it. */
function tickWithLoop(h: Harness, loop: MobUpdateLoop): void {
  loop.update(h.ctx);
  h.system.update(h.ctx);
}

console.log('\nthe activation-radius exemption');
{
  const h = buildHarness();
  const mongo = summonInto(h);
  if (mongo === null) {
    check(false, 'a Mongo could be summoned beside the cat on a generated overworld');
  } else {
    // Exiled far outside the mob loop's activation radius by hand. Before the
    // exemption this is precisely the state that froze him: `updateAI` never
    // ran, so he could not follow, could not recall, and could not even count
    // down his own despawn.
    const preX = mongo.x;
    const preY = mongo.y;
    mongo.x = h.cat.x + TILE_SIZE * FAR_EXILE_TILES;
    mongo.y = h.cat.y;
    h.mobGrid.move(mongo, preX, preY);

    check(mongo.exemptFromAiActivationRadius, 'Mongo opts out of the activation radius');

    const loop = new MobUpdateLoop();
    loop.update(h.ctx);
    check(
      mongo.needsRescue,
      `his AI ran ${FAR_EXILE_TILES} tiles from both players and asked for a rescue`,
    );

    // And the system answers it on the same frame the AI raised it.
    h.system.update(h.ctx);
    const afterRescue = Math.hypot(mongo.x - h.cat.x, mongo.y - h.cat.y) / TILE_SIZE;
    check(
      h.system.mongo === null || afterRescue <= RESCUE_ARRIVAL_TILES,
      `the rescue landed him ${afterRescue.toFixed(1)} tiles from the cat (or despawned him)`,
    );
    if (h.system.mongo !== null) {
      const gridTX = Math.floor(mongo.x / TILE_SIZE);
      const gridTY = Math.floor(mongo.y / TILE_SIZE);
      check(
        h.mobGrid.queryCircle(mongo.x, mongo.y, TILE_SIZE).has(mongo),
        `the mob grid found him at his new tile (${gridTX},${gridTY}) — a teleport that skips mobGrid.move is a mob nothing can hit`,
      );
      check(!mongo.needsRescue, 'the rescue cleared the latch rather than firing every frame');
    }
  }
}

console.log('\nwalking away from a juvenile at full player speed');
{
  check(
    getMongoStats(1).speed < PLAYER_SPEED,
    `a level-1 raptor (${getMongoStats(1).speed} px/frame) really is slower than the cat (${PLAYER_SPEED}) — the premise of this run`,
  );

  interface WalkResult {
    worstLagTiles: number;
    teleports: number;
    prematureTeleports: number;
    catTravelTiles: number;
    endDistanceTiles: number;
    despawned: boolean;
  }

  const walkAwayOnce = (): WalkResult | null => {
    const h = buildHarness();
    const mongo = summonInto(h);
    if (mongo === null) return null;

    const walkCat = makeCatWalker(h.map, h.cat);
    const loop = new MobUpdateLoop();
    const result: WalkResult = {
      worstLagTiles: 0,
      teleports: 0,
      prematureTeleports: 0,
      catTravelTiles: 0,
      endDistanceTiles: 0,
      despawned: false,
    };

    for (let frame = 0; frame < WALK_AWAY_FRAMES; frame++) {
      const catPreX = h.cat.x;
      const catPreY = h.cat.y;
      walkCat();
      result.catTravelTiles += Math.hypot(h.cat.x - catPreX, h.cat.y - catPreY) / TILE_SIZE;

      const live = h.system.mongo;
      if (live === null) break;
      const petPreX = live.x;
      const petPreY = live.y;
      const distanceBefore = Math.hypot(live.x - h.cat.x, live.y - h.cat.y) / TILE_SIZE;

      tickWithLoop(h, loop);
      if (h.system.mongo === null) break;

      // A jump no walk step could produce is a rescue, measured on the creature
      // rather than inferred from the distance — a rescue that lands him beside a
      // cat who was already close changes the distance by very little.
      const jumpedTiles = Math.hypot(live.x - petPreX, live.y - petPreY) / TILE_SIZE;
      if (jumpedTiles > TELEPORT_JUMP_TILES) {
        result.teleports++;
        // The regression guard for a watchdog that fires on nothing. On open
        // ground with a route home available he is never stuck; a teleport from
        // well inside the hard-rescue distance means the stall counter tripped on
        // a walk that was going perfectly well, and on screen that is a glitch.
        if (distanceBefore < NO_RESCUE_EXPECTED_TILES) result.prematureTeleports++;
      }
      result.worstLagTiles = Math.max(result.worstLagTiles, distanceBefore);
    }

    const live = h.system.mongo;
    result.despawned = live === null;
    result.endDistanceTiles =
      live === null ? 0 : Math.hypot(live.x - h.cat.x, live.y - h.cat.y) / TILE_SIZE;
    return result;
  };

  // Re-rolled until the map actually lets the cat out of sight of her pet, and
  // failed loudly if none of them do. The map is unseeded, so a run can land on a
  // pocket of terrain the cat cannot escape — she covers plenty of ground, doubles
  // back constantly, and a slower animal cuts every corner and never falls behind.
  // Loosening the premise to accommodate that would leave the strongest assertion
  // in this file passing on runs that test nothing; re-rolling keeps it strict.
  const attempts: WalkResult[] = [];
  for (let attempt = 0; attempt < WALK_AWAY_ATTEMPTS; attempt++) {
    const result = walkAwayOnce();
    if (result === null) break;
    attempts.push(result);
    if (result.worstLagTiles > MIN_MEANINGFUL_LAG_TILES) break;
  }

  if (attempts.length === 0) {
    check(false, 'the walk-away run had a summoned pet');
  } else {
    const best = attempts.reduce((a, b) => (b.worstLagTiles > a.worstLagTiles ? b : a));
    // The safety property is asserted over *every* attempt, not just the chosen
    // one: a run that failed the premise still measured the bound.
    const worstOfAll = Math.max(...attempts.map((r) => r.worstLagTiles));
    const prematureOfAll = attempts.reduce((sum, r) => sum + r.prematureTeleports, 0);

    check(
      best.catTravelTiles >= MIN_CAT_TRAVEL_TILES,
      `the cat actually walked ${best.catTravelTiles.toFixed(0)} tiles (want >= ${MIN_CAT_TRAVEL_TILES})`,
    );
    check(
      worstOfAll <= MAX_LAG_TILES,
      `never lagged past ${MAX_LAG_TILES} tiles over ${attempts.length} walk(s) (worst ${worstOfAll.toFixed(1)})`,
    );
    // He was genuinely behind her, not glued to her heel — otherwise the bound
    // above is satisfied by a follow that was never under any strain.
    check(
      best.worstLagTiles > MIN_MEANINGFUL_LAG_TILES,
      `he was really made to chase (fell ${best.worstLagTiles.toFixed(1)} tiles behind over ${attempts.length} walk(s), want > ${MIN_MEANINGFUL_LAG_TILES})`,
    );
    check(
      prematureOfAll === 0,
      `no rescue fired while he was inside ${NO_RESCUE_EXPECTED_TILES} tiles and walking (${prematureOfAll} spurious)`,
    );
    // The total is not asserted either way. On open ground a routed cat detours
    // enough that a 2.0 px/frame raptor often keeps up on his own feet, and a run
    // finishing with zero rescues is a *good* outcome — the teleport is a
    // backstop, not the mechanism. That it fires when it is genuinely needed is
    // proven above, at 40 tiles, and below, on a pet pinned in masonry.
    console.log(`  info  ${best.teleports} rescue teleport(s) over the walk`);
    check(
      best.despawned || best.endDistanceTiles <= MAX_LAG_TILES,
      `ends beside the cat or despawned (${best.despawned ? 'despawned' : `${best.endDistanceTiles.toFixed(1)} tiles`})`,
    );
  }
}

console.log('\na pet who cannot move at all');
{
  const h = buildHarness();
  const mongo = summonInto(h);
  const catTile = {
    x: Math.floor((h.cat.x + TILE_SIZE / 2) / TILE_SIZE),
    y: Math.floor((h.cat.y + TILE_SIZE / 2) / TILE_SIZE),
  };
  const pocket = findEnclosedBlockedTile(
    h.map,
    catTile,
    STALL_BAND_MIN_TILES,
    STALL_BAND_MAX_TILES,
  );
  if (mongo === null || pocket === null) {
    // Loudly, not silently: a check that cannot find its subject and passes
    // anyway reports "all gates passed" while measuring nothing.
    check(
      false,
      `the stall run had a summoned pet and solid ground to pin him in (${STALL_BAND_MIN_TILES}–${STALL_BAND_MAX_TILES} tiles from the cat)`,
    );
  } else {
    pinInto(h, mongo, pocket);
    const loop = new MobUpdateLoop();
    let framesToRescue = -1;
    let arrivedByTeleport = false;
    for (let frame = 0; frame < MAX_STALL_RESCUE_FRAMES; frame++) {
      const preX = mongo.x;
      const preY = mongo.y;
      tickWithLoop(h, loop);
      const live = h.system.mongo;
      // Measured as a jump, not as an arrival. "He ended up near her" is
      // satisfied by a pet who simply walked over, which is the one outcome this
      // run is built to rule out — the whole premise is that he cannot.
      const jumped = Math.hypot(mongo.x - preX, mongo.y - preY) / TILE_SIZE > TELEPORT_JUMP_TILES;
      const distance =
        live === null ? 0 : Math.hypot(live.x - h.cat.x, live.y - h.cat.y) / TILE_SIZE;
      if (live === null || distance <= RESCUE_ARRIVAL_TILES) {
        framesToRescue = frame;
        arrivedByTeleport = jumped || live === null;
        break;
      }
    }
    check(
      framesToRescue >= 0,
      `a pet who covers no ground is rescued within ${MAX_STALL_RESCUE_FRAMES} frames (took ${framesToRescue < 0 ? 'never' : framesToRescue})`,
    );
    check(arrivedByTeleport, 'and he got there by being rescued rather than by walking');
  }
}

console.log('\nstuck, with something biting the cat');
{
  // The nastiest shape this whole change has, and the one a reasonable-looking
  // fix walks straight into. A mob attacking the owner is top priority *and* is
  // exempt from the unreachable-route ban, so a Mongo who cannot reach it will
  // re-acquire it the instant he bans it — an A* search per frame, forever. The
  // damage is not the cost: it holds him inside `engage`, and the homeward
  // watchdog only runs on the paths where he is walking to the cat. He laps
  // there with no route to the mob and no route to a rescue, which is the
  // original vanish wearing a different hat.
  const h = buildHarness();
  const mongo = summonInto(h);
  const catTile = {
    x: Math.floor((h.cat.x + TILE_SIZE / 2) / TILE_SIZE),
    y: Math.floor((h.cat.y + TILE_SIZE / 2) / TILE_SIZE),
  };
  const pocket = findEnclosedBlockedTile(
    h.map,
    catTile,
    STALL_BAND_MIN_TILES,
    STALL_BAND_MAX_TILES,
  );
  if (mongo === null || pocket === null) {
    check(false, 'the engage-lap run had a summoned pet and solid ground to pin him in');
  } else {
    const attacker = createMob(ATTACKER_MOB_ID, catTile.x + 1, catTile.y, h.map);
    attacker.setMap(h.map);
    attacker.currentTarget = h.cat;
    h.mobs.push(attacker);
    h.mobGrid.insert(attacker);
    pinInto(h, mongo, pocket);

    const loop = new MobUpdateLoop();
    let framesToRescue = -1;
    for (let frame = 0; frame < MAX_STALL_RESCUE_FRAMES; frame++) {
      // Re-asserted each frame: the mob's own AI will retarget, and the whole
      // point of this run is that Mongo sees a live threat on his owner
      // throughout — a lapse would let him fall into `standBy` for the wrong
      // reason and the run would pass while testing nothing.
      attacker.currentTarget = h.cat;
      tickWithLoop(h, loop);
      const live = h.system.mongo;
      const distance =
        live === null ? 0 : Math.hypot(live.x - h.cat.x, live.y - h.cat.y) / TILE_SIZE;
      if (live === null || distance <= RESCUE_ARRIVAL_TILES) {
        framesToRescue = frame;
        break;
      }
    }
    check(
      framesToRescue >= 0,
      `a threat on the cat he cannot reach does not block his own rescue (took ${framesToRescue < 0 ? 'never' : framesToRescue} frames)`,
    );
  }
}

console.log('\nthe button is never dead');
{
  const h = buildHarness();
  const mongo = summonInto(h);
  if (mongo === null) {
    check(false, 'the button run had a summoned pet');
  } else {
    check(h.system.canPress, 'pressable while he is out');
    h.system.toggleRecall();
    check(mongo.recalling, 'the first press orders the recall');
    // Greyed out through the opening of the recall, and honestly so: a press
    // there is a double-tap, the creature will refuse it, and a button that looks
    // live while swallowing presses is the dead-button complaint all over again.
    check(!h.system.canPress, 'not pressable through the opening of the recall');
    check(!mongo.needsRescue, 'ordering the recall does not by itself force a rescue');

    // Stranded mid-recall: exactly the state where the old button did nothing.
    const catTile = {
      x: Math.floor((h.cat.x + TILE_SIZE / 2) / TILE_SIZE),
      y: Math.floor((h.cat.y + TILE_SIZE / 2) / TILE_SIZE),
    };
    const pocket = findEnclosedBlockedTile(
      h.map,
      catTile,
      STALL_BAND_MIN_TILES,
      STALL_BAND_MAX_TILES,
    );
    if (pocket === null) {
      check(false, 'the button run found solid ground to strand him in');
    } else {
      pinInto(h, mongo, pocket);
    }

    const loop = new MobUpdateLoop();

    // A double-tap must NOT be read as "he is not coming". Answering the second
    // press of an ordinary two-frame double-tap by snapping him to her feet and
    // completing the despawn deletes the run home entirely, and the run home is
    // what makes a recall read as a pet rather than as a toggle.
    h.system.toggleRecall();
    check(!mongo.needsRescue, 'a double-tap of recall is not a rescue request');

    for (let frame = 0; frame < RECALL_GRACE_TICKS; frame++) tickWithLoop(h, loop);
    check(h.system.canPress, 'and it goes live again once the recall has had time to work');
    h.system.toggleRecall();
    check(
      mongo.needsRescue,
      `a press after ${RECALL_GRACE_TICKS} frames of a recall that is going nowhere does force it`,
    );

    let despawnedAfter = -1;
    for (let frame = 0; frame < RECALL_COMPLETION_FRAMES; frame++) {
      tickWithLoop(h, loop);
      if (h.system.mongo === null) {
        despawnedAfter = frame;
        break;
      }
    }
    check(
      despawnedAfter >= 0,
      `the rescued recall then completes its despawn (after ${despawnedAfter < 0 ? 'never' : despawnedAfter} frames)`,
    );
    check(
      h.system.canSummon,
      'and the button is back to Summon — the unrecoverable state has an exit',
    );
  }
}

console.log('\nthe level table');
{
  // The perk text promises a *growth spurt* at 5 and 10, and nothing but a check
  // holds the numbers to it: fattening one band without re-taping the next
  // produced a level-4 raptor healthier than a level-5 one, under a line reading
  // GROWTH SPURT.
  const SPURT_LEVELS = [5, 10];
  let monotonic = true;
  for (let level = 2; level <= MONGO_MAX_LEVEL; level++) {
    if (getMongoStats(level).maxHp <= getMongoStats(level - 1).maxHp) monotonic = false;
  }
  check(monotonic, 'max HP rises at every single level');

  for (const spurt of SPURT_LEVELS) {
    const jump = getMongoStats(spurt).maxHp - getMongoStats(spurt - 1).maxHp;
    const ordinaryBefore = getMongoStats(spurt - 1).maxHp - getMongoStats(spurt - 2).maxHp;
    const ordinaryAfter = getMongoStats(spurt + 1).maxHp - getMongoStats(spurt).maxHp;
    check(
      jump > ordinaryBefore && jump > ordinaryAfter,
      `level ${spurt} is a visible growth spurt (+${jump} HP against +${ordinaryBefore} before and +${ordinaryAfter} after)`,
    );
  }

  // The spurt test above is purely *relative*, which makes it gameable in a way
  // that already happened once: restoring a spurt by flattening its neighbours
  // passes it, and would pass on 78/79/80/81/82. So the ordinary steps get their
  // own absolute rule — they never shrink as he grows. Without it the adolescent
  // band ended up the slowest-growing stretch in the table, with a level-6 raptor
  // gaining less health per level than a level-2 one.
  let worstRegression = '';
  let previousOrdinaryStep = 0;
  for (let level = 2; level <= MONGO_MAX_LEVEL; level++) {
    if (SPURT_LEVELS.includes(level)) continue;
    const step = getMongoStats(level).maxHp - getMongoStats(level - 1).maxHp;
    if (step < previousOrdinaryStep && worstRegression === '') {
      worstRegression = `level ${level} gains +${step} where an earlier level gained +${previousOrdinaryStep}`;
    }
    previousOrdinaryStep = step;
  }
  check(
    worstRegression === '',
    `ordinary HP steps never shrink as he grows${worstRegression === '' ? '' : ` — ${worstRegression}`}`,
  );

  let damageRises = true;
  for (let level = 2; level <= MONGO_MAX_LEVEL; level++) {
    if (getMongoStats(level).biteDamage < getMongoStats(level - 1).biteDamage) damageRises = false;
  }
  check(damageRises, 'bite damage never goes backwards');
}

console.log('\nwho he picks a fight with');
{
  // The largest behavioural change in the rework, and the one a headless run can
  // check exactly: he guards the cat, helps with her target, otherwise hunts what
  // is nearest. Each tier gets its own run, because the inputs overlap — a mob the
  // cat has hit is one its own AI will happily start targeting her over, and a
  // scenario that cannot hold its inputs still is measuring the goblin's mood
  // rather than Mongo's rule.
  for (const tier of ['party threat', "the cat's quarry", 'nearest'] as const) {
    const h = buildHarness();
    const mongo = summonInto(h);
    const catTile = {
      x: Math.floor((h.cat.x + TILE_SIZE / 2) / TILE_SIZE),
      y: Math.floor((h.cat.y + TILE_SIZE / 2) / TILE_SIZE),
    };
    const nearTile = findOpenTileNear(h.map, catTile, BYSTANDER_TILES);
    const farTile = findOpenTileNear(h.map, catTile, CONTENDER_TILES);
    if (mongo === null || nearTile === null || farTile === null) {
      check(false, `the '${tier}' run had a pet and two open tiles at different ranges`);
      continue;
    }

    const bystander = spawnHostile(h, nearTile);
    const contender = spawnHostile(h, farTile);
    const nearDist = Math.hypot(bystander.x - mongo.x, bystander.y - mongo.y) / TILE_SIZE;
    const farDist = Math.hypot(contender.x - mongo.x, contender.y - mongo.y) / TILE_SIZE;
    // The premise every tier check rests on. If the contender happens to be the
    // nearer of the two, picking it proves nothing about priority at all.
    check(
      farDist > nearDist,
      `'${tier}': the contender is the further mob (${farDist.toFixed(1)} vs ${nearDist.toFixed(1)} tiles)`,
    );

    // Damaging the contender also raises a pack shout, which alerts the bystander
    // to the cat without her ever having touched it — so this run doubles as the
    // check that the quarry tier means "the cat hit *this* mob" rather than "the
    // cat hit something near it". If it meant the latter, both would rank alike
    // and the nearer bystander would win.
    if (tier === "the cat's quarry") contender.takeDamageFrom(1, h.cat, 'melee');

    for (let frame = 0; frame < TARGETING_SETTLE_FRAMES; frame++) {
      // Only Mongo is ticked, and the hostiles' aggro is pinned by hand. Running
      // their AI would rewrite `currentTarget`, which is one of the two inputs
      // under test.
      contender.currentTarget = tier === 'party threat' ? h.cat : null;
      bystander.currentTarget = null;
      mongo.allMobs = h.mobs;
      mongo.updateAI([]);
    }

    const expected = tier === 'nearest' ? bystander : contender;
    const chose =
      mongo.engagedTarget === bystander
        ? 'the nearer one'
        : mongo.engagedTarget === contender
          ? 'the contender'
          : 'nothing';
    check(
      mongo.engagedTarget === expected,
      `'${tier}': he picks ${tier === 'nearest' ? 'the nearer one' : 'the contender'} (picked ${chose})`,
    );
  }
}

console.log('\nwhat a blow actually costs him');
{
  const h = buildHarness();
  const mongo = summonInto(h);
  if (mongo === null) {
    check(false, 'the resistance run had a summoned pet');
  } else {
    const before = mongo.hp;
    mongo.takeDamage(BIG_BLOW_DAMAGE);
    const taken = before - mongo.hp;
    const expected = Math.round(BIG_BLOW_DAMAGE * EXPECTED_DAMAGE_MULTIPLIER);
    check(
      Math.abs(taken - expected) <= DAMAGE_ROUNDING_SLACK,
      `a ${BIG_BLOW_DAMAGE}-damage blow costs him ${taken} (want ~${expected})`,
    );

    // The case rounding silently exempted. Every damage-over-time tick in the
    // game is one point, and one point softened and rounded is still one point —
    // so before the ledger, burn and poison landed at full strength on the one
    // animal who cannot walk out of them.
    const beforeTicks = mongo.hp;
    for (let tick = 0; tick < STATUS_TICKS; tick++) {
      mongo.takeDamage(1, { kind: 'status', effectType: 'poison', applier: null });
    }
    const ticked = beforeTicks - mongo.hp;
    const expectedTicked = STATUS_TICKS * EXPECTED_DAMAGE_MULTIPLIER;
    check(
      Math.abs(ticked - expectedTicked) <= DAMAGE_ROUNDING_SLACK,
      `${STATUS_TICKS} one-point status ticks cost him ${ticked} (want ~${expectedTicked}) — a DoT is resisted like anything else`,
    );

    // The other one-point door, and the one that turned the ledger into a damage
    // shield. A protective shell's edge does exactly this, once a second, with no
    // friendly-fire filter — so a pet loitering on one is a long run of one-point
    // blows through the entry point that returns nothing at all.
    let tickedByShell = 0;
    for (let tick = 0; tick < SHELL_TICKS; tick++) {
      mongo.hp = mongo.maxHp;
      const beforeTick = mongo.hp;
      mongo.takeDamageFrom(1, null, 'shell');
      tickedByShell += beforeTick - mongo.hp;
    }
    const expectedShell = SHELL_TICKS * EXPECTED_DAMAGE_MULTIPLIER;
    check(
      Math.abs(tickedByShell - expectedShell) <= DAMAGE_ROUNDING_SLACK,
      `${SHELL_TICKS} one-point mob-on-mob ticks cost him ${tickedByShell} (want ~${expectedShell})`,
    );

    // And the run left no credit behind. A ledger with no floor on the credit
    // side banks the difference of every forced point and spends it later as flat
    // immunity — measured, at seventy-six free hit points after two hundred ticks.
    const freeBlows: number[] = [];
    for (let blow = 0; blow < BLOWS_AFTER_TICKS; blow++) {
      mongo.hp = mongo.maxHp;
      const beforeBlow = mongo.hp;
      mongo.takeDamage(BIG_BLOW_DAMAGE);
      freeBlows.push(beforeBlow - mongo.hp);
    }
    const expectedBlow = Math.round(BIG_BLOW_DAMAGE * EXPECTED_DAMAGE_MULTIPLIER);
    check(
      freeBlows.every((cost) => Math.abs(cost - expectedBlow) <= DAMAGE_ROUNDING_SLACK),
      `blows after that run still cost full price (${freeBlows.join(', ')}, want ~${expectedBlow} each)`,
    );
  }
}

console.log('\nwounded, and not summonable while he would not fight');
{
  const h = buildHarness();
  const mongo = summonInto(h);
  const catTile = {
    x: Math.floor((h.cat.x + TILE_SIZE / 2) / TILE_SIZE),
    y: Math.floor((h.cat.y + TILE_SIZE / 2) / TILE_SIZE),
  };
  const spot = findOpenTileNear(h.map, catTile, BYSTANDER_TILES);
  if (mongo === null || spot === null) {
    check(false, 'the wounded run had a pet and somewhere to put a hostile');
  } else {
    const hostile = spawnHostile(h, spot);
    const loop = new MobUpdateLoop();
    for (let frame = 0; frame < TARGETING_SETTLE_FRAMES; frame++) tickWithLoop(h, loop);
    check(mongo.engagedTarget === hostile, 'at full health he takes the fight');

    mongo.hp = Math.max(1, Math.floor(mongo.maxHp * WOUNDED_HP_FRACTION));
    for (let frame = 0; frame < TARGETING_SETTLE_FRAMES; frame++) tickWithLoop(h, loop);
    check(
      mongo.engagedTarget === null,
      `at ${Math.round(WOUNDED_HP_FRACTION * PERCENT)}% health he breaks off and sticks to the cat`,
    );

    // …and therefore must not be *summonable* down there either. A pet who walks
    // out, never picks a target and never bites, for two usage XP and a green
    // button, is a trap rather than a decision.
    h.system.dismiss(h.mobs, h.mobGrid);
    check(
      !h.system.canSummon,
      `the button refuses to send in a pet too wounded to fight (${h.system.hp}/${h.system.maxHp})`,
    );

    check(
      h.system.framesUntilReady > 0,
      'and its countdown is counting toward that same floor rather than to one hit point',
    );

    // And the floor leaves him room to actually fight once he is over it. Set at
    // the retreat threshold plus a hit point, a summoned pet drops back under it
    // after one point of damage — which is what every status tick delivers — so
    // the trap would reopen a second after it closed.
    const maxHp = h.system.maxHp;
    let floorHp = 1;
    for (let hp = 1; hp <= maxHp; hp++) {
      h.petState.hp = hp;
      if (h.system.canSummon) {
        floorHp = hp;
        break;
      }
    }
    const fightingRoom = floorHp - Math.floor(maxHp * RETREAT_HP_FRACTION);
    check(
      fightingRoom >= Math.ceil(maxHp * MIN_FIGHTING_ROOM_FRACTION),
      `the summon floor (${floorHp}/${maxHp}) leaves ${fightingRoom} HP of fighting before he breaks off`,
    );
  }
}

console.log('\nthe knockout rule is stated once, when it is true');
{
  // Said from the settled state rather than from the despawn that produced it.
  // A party wipe spends him and *then* rewinds: with a checkpoint the restore
  // puts the latch back, so a line said at despawn announces a knockout that has
  // just been undone — and burns its one-shot, leaving the next real knockout
  // explained by nothing.
  const h = buildHarness();
  const mongo = summonInto(h);
  if (mongo === null) {
    check(false, 'the notice run had a summoned pet');
  } else {
    // Matched against a fragment of the toast `explainKnockoutOnce` actually
    // raises. Its sibling line is "Mongo heals only while recalled", which this
    // must not catch.
    const knockoutSaid = (): number =>
      h.announced.filter((line) => line.includes('heal fully')).length;

    // Spent, then dismissed the way every death path dismisses him.
    mongo.exhausted = true;
    h.system.dismiss(h.mobs, h.mobGrid);
    check(knockoutSaid() === 0, 'the dismissal itself announces nothing');

    // A checkpoint rewind undoes the spend before the next frame runs.
    h.petState.restingUntilFull = false;
    h.petState.hp = h.system.maxHp;
    h.system.update(h.ctx);
    check(
      knockoutSaid() === 0,
      'a rewound knockout is never announced — the state it would describe is gone',
    );

    // A knockout that actually sticks is announced on the first frame it holds…
    h.petState.restingUntilFull = true;
    h.petState.hp = 0;
    h.system.update(h.ctx);
    check(knockoutSaid() === 1, 'a knockout that stands is announced');

    // …and only once.
    for (let frame = 0; frame < NOTICE_REPEAT_FRAMES; frame++) h.system.update(h.ctx);
    check(knockoutSaid() === 1, 'and not once per frame thereafter');

    // Nor once per scene. The latch it describes stays true for the two minutes
    // of regen a knockout costs, which outlasts a stairwell and a shop door —
    // each of which builds a new system around the same pet record.
    const nextScene = adoptPetState(h.petState);
    for (let frame = 0; frame < NOTICE_REPEAT_FRAMES; frame++)
      nextScene.system.update(nextScene.ctx);
    check(
      nextScene.announced.length === 0,
      `a new scene over the same resting pet says nothing again (${nextScene.announced.length} line(s))`,
    );
  }
}

console.log('\nthe summon button has room for its own text');
{
  // Both strings sit on one row, left- and right-aligned. At the sizes this
  // shipped with they came to 79.4 px of 80 in the worst live pairing — touching,
  // not overlapping, and only on the assumption that the browser's monospace is
  // exactly 0.6 em. Arithmetic rather than an eyeball, so the next size change
  // cannot quietly close the gap.
  const widest = `${MONGO_LARGEST_HP}/${MONGO_LARGEST_HP}`;
  // Measured over every label the button can draw, read from the same record the
  // render reads — a hand-copied "longest" goes stale the first time one is
  // renamed, and leaves this gate green over a row that overflows.
  const longestLabel = Object.values(MONGO_BUTTON_LABELS).reduce((longest, label) =>
    label.length > longest.length ? label : longest,
  );
  const labelWidth = longestLabel.length * MONGO_BUTTON_TEXT_SIZES.label * PESSIMISTIC_EM_RATIO;
  const hpWidth = widest.length * MONGO_BUTTON_TEXT_SIZES.hp * PESSIMISTIC_EM_RATIO;
  const used = labelWidth + hpWidth + MONGO_BUTTON_TEXT_SIZES.inset * 2;
  const gap = SUMMON_BUTTON_WIDTH - used;
  check(
    gap >= MONGO_BUTTON_TEXT_MIN_GAP,
    `'${longestLabel}' and '${widest}' leave ${gap.toFixed(1)}px between them (want >= ${MONGO_BUTTON_TEXT_MIN_GAP})`,
  );
}

console.log('\nthe first level-up is reachable');
{
  // The complaint was not that levelling was slow — it was that players never
  // saw the level-up dialog at all, because at the old rate the first level was
  // five-plus minutes of *uninterrupted* biting from an animal who dies in a few
  // hits. This bounds the fixed rate against the same arithmetic.
  const BITE_COOLDOWN_FRAMES = 46;
  const FRAMES_PER_SECOND = 60;
  /** The first level-up has to land inside a single session of real use. */
  const MAX_ACCEPTABLE_SECONDS = 150;

  const damagePerSecond = (getMongoStats(1).biteDamage / BITE_COOLDOWN_FRAMES) * FRAMES_PER_SECOND;
  const xpPerSecond = damagePerSecond / MONGO_DAMAGE_PER_XP;
  const secondsOfBiting = MONGO_DEF.baseXpToLevel2 / xpPerSecond;
  check(
    secondsOfBiting <= MAX_ACCEPTABLE_SECONDS,
    `level 2 is ~${secondsOfBiting.toFixed(0)}s of continuous biting from a juvenile (want <= ${MAX_ACCEPTABLE_SECONDS})`,
  );
}

console.log(failures === 0 ? '\nAll Mongo checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
