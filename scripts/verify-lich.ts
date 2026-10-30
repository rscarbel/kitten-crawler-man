#!/usr/bin/env tsx
/**
 * The Lich fight's fairness contract, checked without playing it.
 *
 * The four-phase finale makes promises the player cannot verify and the author
 * cannot see: that every wall of fire has a gap they can reach from the last
 * one, that a rain of orbs never covers every tile they could step to, that the
 * dodge clock means ten uninterrupted seconds and not ten seconds of luck, and
 * that the phases only ever move forward. Each of those is a property of
 * `src/systems/lichBattleRules.ts` alone, which is why the rules live in a
 * module with no canvas and no creature in it.
 *
 * The opening binding (the ritual circle shielding the Lich while any pillar
 * holds a bound cat, the cat unbinding them, the carrier coming in through the
 * observatory) is checked the same way, as rules and then played on storey 5
 * of the tower.
 *
 * Every check below was negative-tested during development by mutating the rule
 * it measures and confirming the gate went red. The binding's checks carry
 * their own negative tests: each `--fault=<name>` below breaks one rule from
 * outside and must turn the gate red. Where a check depends on a
 * lookup — a phase name, a room, a neighbour set — the lookup failing is itself
 * a failure, never a skip: a gate that goes quiet when it cannot find what it
 * measures reports "all passed" while measuring nothing.
 *
 * Run: npx tsx scripts/verify-lich.ts
 *      npx tsx scripts/verify-lich.ts --fault=<name>   (must fail)
 *
 * Faults: unshielded, lich-turns-on-the-worker, carrier-takes-worked-pillar,
 * no-return-wait, pillar-in-the-fire, channel-spot-in-the-wall,
 * freed-cats-still-bound, reveal-not-owed.
 */

import { readFileSync } from 'node:fs';

import { isRecord } from '../src/core/util/guards';
import { loadGameSpritesInNode } from './nodeCanvasGlobals';
import { CORE_SFX_IDS, sfxGroupsForLevelId } from '../src/audio/sfxGroups';
import type { MusicClaims } from '../src/audio/AudioScope';
import type { MusicClaim, MusicClaimOwner } from '../src/audio/music/MusicDirector';
import { GameMap } from '../src/map/GameMap';
import { TOWN_TOWER_ID } from '../src/map/buildingIds';
import {
  towerConditionsFor,
  towerStoreyIndex,
  type TowerConditions,
} from '../src/map/town/interiors/townCenterTower';
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import type { Mob } from '../src/creatures/Mob';
import type { TheLich } from '../src/creatures/TheLich';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import { SpellSystem } from '../src/systems/SpellSystem';
import { CompanionSystem } from '../src/systems/CompanionSystem';
import { TowerRitualSystem } from '../src/systems/tower/TowerRitualSystem';
import { LichBattleSystem, PUSH_SLIDE_FRAMES } from '../src/systems/LichBattleSystem';
import {
  missingCatsProgressAt,
  type MissingCatsPhase,
  type MissingCatsProgress,
} from '../src/core/quests/missingCatsProgress';
import { TOWN_CAT_IDS, type TownCatId } from '../src/core/state/townCatIds';
import { findNearbyWalkableTile } from '../src/map/findWalkableTile';
import { partyLevelOf } from '../src/levels/spawner';
import { makePoison } from '../src/core/combat/StatusEffect';
import type { SystemContext } from '../src/systems/GameSystem';
import type { DamageSource } from '../src/Player';
import { Conversation } from '../src/dialog/Conversation';
import { wardenReveal } from '../src/dialog/scripts/scenes/towerRitual';
import {
  BINDING_CHANNEL_FRAMES,
  BindingCircle,
  bindingSparesCrawler,
  CARRIER_ARRIVAL_FRAMES,
  CARRIER_FLIGHT_FRAMES,
  CARRIER_LIFT_FRAMES,
  CHANNEL_RETURN_CLEAR_FRAMES,
  ChannelReturnGate,
  FIREWALL_WAVE_INTERVAL_FRAMES,
  canHoldGap,
  columnBurns,
  DAZE_FRAMES,
  DAZE_HITS_REQUIRED,
  DODGE_SURVIVAL_FRAMES,
  FIREWALL_GAP_MAX_SHIFT_TILES,
  FIREWALL_GAP_WIDTH_TILES,
  FIREWALL_TRIGGER_HP_FRACTION,
  FirewallGapPlanner,
  LichPhaseMachine,
  MAX_CONCURRENT_ORB_WARNINGS,
  ORB_IMPACT_RADIUS_TILES,
  ORB_SPAWN_INTERVAL_FRAMES,
  ORB_WARNING_FRAMES,
  OrbRainPlanner,
  stepTowardSafety,
  walkableNeighbours,
  type LichBattlePhase,
  type OrbRainRoom,
  type TilePos,
} from '../src/systems/lichBattleRules';
import { mulberry32 } from '../src/sprites/person/rng';
import { useDevPlayerIdentity } from '../src/dev/devPlayerIdentity.js';
import { harnessHit } from './crawlerHitHarness';
import { cameraAt, UNZOOMED } from '../src/core/rendering/camera.js';

useDevPlayerIdentity();

/**
 * One rule of the binding broken from outside, to watch the check that
 * guards it go red. Each names the rule it breaks.
 */
const LICH_FAULTS = [
  'unshielded',
  'lich-turns-on-the-worker',
  'carrier-takes-worked-pillar',
  'no-return-wait',
  'pillar-in-the-fire',
  'channel-spot-in-the-wall',
  'freed-cats-still-bound',
  'reveal-not-owed',
] as const;
type LichFault = (typeof LICH_FAULTS)[number];

const FAULT_FLAG = '--fault=';

function parseFault(): LichFault | null {
  const flag = process.argv.find((arg) => arg.startsWith(FAULT_FLAG));
  if (flag === undefined) return null;
  const name = flag.slice(FAULT_FLAG.length);
  const fault = LICH_FAULTS.find((candidate) => candidate === name);
  if (fault === undefined) {
    console.error(`unknown fault "${name}"; known: ${LICH_FAULTS.join(', ')}`);
    process.exit(2);
  }
  return fault;
}

const FAULT = parseFault();

/** Replaces a method on a class's prototype, private ones included, for a fault that breaks it. */
function breakMethod(prototype: object, name: string, replacement: unknown): void {
  if (typeof Reflect.get(prototype, name) !== 'function') {
    throw new Error(`no method "${name}" to break`);
  }
  if (typeof replacement !== 'function') throw new Error(`no replacement for "${name}"`);
  Reflect.set(prototype, name, replacement);
}

/**
 * The faults that break the fight's own code rather than what the gate feeds
 * it: the reveal decided after the questline has already moved to the ritual,
 * the walls of fire born at the Lich's feet, through the circle, and each
 * pillar worked only from its own stone.
 */
function applyCodeFaults(): void {
  if (FAULT === 'reveal-not-owed') {
    const arrive: unknown = Reflect.get(TowerRitualSystem.prototype, 'arrive');
    breakMethod(TowerRitualSystem.prototype, 'arrive', function (this: object) {
      const deps: unknown = Reflect.get(this, 'deps');
      if (!isRecord(deps) || !isRecord(deps.progress) || typeof arrive !== 'function') {
        throw new Error('the ritual has no progress to arrive with');
      }
      Reflect.set(deps.progress, 'phase', 'ritual');
      const arrived: unknown = Reflect.apply(arrive, this, []);
      return arrived;
    });
  }
  if (FAULT === 'pillar-in-the-fire') {
    breakMethod(LichBattleSystem.prototype, 'findWaveSpawnRow', function (this: object) {
      const anchor: unknown = Reflect.get(this, 'firewallAnchorTile');
      if (!isRecord(anchor) || typeof anchor.row !== 'number') {
        throw new Error('the fight has no firewall anchor');
      }
      return anchor.row + 1;
    });
  }
  if (FAULT === 'channel-spot-in-the-wall') {
    const pillarWork: unknown = Reflect.get(LichBattleSystem.prototype, 'pillarWork');
    breakMethod(LichBattleSystem.prototype, 'pillarWork', function (this: object, pillar: unknown) {
      if (typeof pillarWork !== 'function' || !isRecord(pillar)) {
        throw new Error('the fight has no pillar to work');
      }
      const work: unknown = Reflect.apply(pillarWork, this, [pillar]);
      if (!isRecord(work)) throw new Error('the pillar gave no work');
      return { ...work, spots: [pillar.tile] };
    });
  }
}

applyCodeFaults();

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

/**
 * The contract, written out as literals.
 *
 * Deliberately not expressed in terms of the module's own constants: a gate
 * that measures a rule against the number the rule is built from moves with it,
 * and passes for every value anybody ever sets. These are the numbers the fight
 * was designed around; the module is checked against them, and a retune has to
 * come here and say so out loud.
 */
const CONTRACT = {
  gapWidthTiles: 2,
  gapMaxShiftTiles: 3,
  maxConcurrentWarnings: 8,
  dodgeSurvivalFrames: 600,
  dazeFrames: 180,
  dazeHitsRequired: 2,
  firewallTriggerHpFraction: 0.6,
} as const;

check(
  FIREWALL_GAP_WIDTH_TILES === CONTRACT.gapWidthTiles,
  `FIREWALL_GAP_WIDTH_TILES is ${FIREWALL_GAP_WIDTH_TILES}, but the fight's contract is ${CONTRACT.gapWidthTiles}`,
);
check(
  FIREWALL_GAP_MAX_SHIFT_TILES === CONTRACT.gapMaxShiftTiles,
  `FIREWALL_GAP_MAX_SHIFT_TILES is ${FIREWALL_GAP_MAX_SHIFT_TILES}, but the fight's contract is ${CONTRACT.gapMaxShiftTiles}`,
);
check(
  MAX_CONCURRENT_ORB_WARNINGS === CONTRACT.maxConcurrentWarnings,
  `MAX_CONCURRENT_ORB_WARNINGS is ${MAX_CONCURRENT_ORB_WARNINGS}, but the fight's contract is ${CONTRACT.maxConcurrentWarnings}`,
);
check(
  DODGE_SURVIVAL_FRAMES === CONTRACT.dodgeSurvivalFrames,
  `DODGE_SURVIVAL_FRAMES is ${DODGE_SURVIVAL_FRAMES}, but the fight's contract is ${CONTRACT.dodgeSurvivalFrames}`,
);
check(
  DAZE_FRAMES === CONTRACT.dazeFrames,
  `DAZE_FRAMES is ${DAZE_FRAMES}, but the fight's contract is ${CONTRACT.dazeFrames}`,
);
check(
  DAZE_HITS_REQUIRED === CONTRACT.dazeHitsRequired,
  `DAZE_HITS_REQUIRED is ${DAZE_HITS_REQUIRED}, but the fight's contract is ${CONTRACT.dazeHitsRequired}`,
);
check(
  FIREWALL_TRIGGER_HP_FRACTION === CONTRACT.firewallTriggerHpFraction,
  `FIREWALL_TRIGGER_HP_FRACTION is ${FIREWALL_TRIGGER_HP_FRACTION}, but the fight's contract is ${CONTRACT.firewallTriggerHpFraction}`,
);

/**
 * The tower's office, as generated: a rectangular room inside a wall ring.
 * Twenty by sixteen tiles of storey, minus the wall, is eighteen by fourteen of
 * floor — see `TOWER_INTERIOR_W` in `src/map/GameMap.ts`.
 */
const ROOM_MIN_COL = 1;
const ROOM_MAX_COL = 18;
const ROOM_MIN_ROW = 1;
const ROOM_MAX_ROW = 14;
const ROOM: OrbRainRoom = {
  minCol: ROOM_MIN_COL,
  maxCol: ROOM_MAX_COL,
  minRow: ROOM_MIN_ROW,
  maxRow: ROOM_MAX_ROW,
  isWalkable: (col, row) =>
    col >= ROOM_MIN_COL && col <= ROOM_MAX_COL && row >= ROOM_MIN_ROW && row <= ROOM_MAX_ROW,
};

const SEED = 0x5e11c4;
/** The floor the tower and its Lich fight live on. */
const LICH_FIGHT_LEVEL_ID = 'level3';
/** Waves sampled for the gap rules. Far past any real fight, which is the point. */
const WAVES_SAMPLED = 500;
/** Frames simulated per orb-rain scenario. */
const ORB_FRAMES_SAMPLED = 4000;
/**
 * The cadence used to press a rule rather than to reproduce the fight: one orb
 * every frame, so the planner is always the thing saying no, never the clock.
 */
const PRESSURE_CADENCE_FRAMES = 1;

// ─────────────────────────────────────── 1 & 2: the firewall's gaps

{
  check(
    canHoldGap({ minCol: ROOM.minCol, maxCol: ROOM.maxCol }),
    'the sample room is too narrow to hold a gap, so the wave checks below would measure nothing',
  );

  const planner = new FirewallGapPlanner(mulberry32(SEED));
  const span = { minCol: ROOM.minCol, maxCol: ROOM.maxCol };
  const gaps: number[] = [];
  let frames = 0;
  // A frame ceiling rather than `while (true)`: a planner that stopped
  // returning waves must fail the count check below, not hang the gate.
  const FRAMES_PER_WAVE_CEILING = 1000;
  const FRAME_CEILING = WAVES_SAMPLED * FRAMES_PER_WAVE_CEILING;
  while (gaps.length < WAVES_SAMPLED && frames < FRAME_CEILING) {
    frames++;
    const gap = planner.tick(span);
    if (gap !== null) gaps.push(gap);
  }

  check(
    gaps.length === WAVES_SAMPLED,
    `the planner produced ${gaps.length} of ${WAVES_SAMPLED} waves before the frame ceiling`,
  );

  for (const [index, gapStart] of gaps.entries()) {
    const safeColumns: number[] = [];
    for (let col = span.minCol; col <= span.maxCol; col++) {
      if (!columnBurns(col, gapStart)) safeColumns.push(col);
    }
    if (safeColumns.length !== CONTRACT.gapWidthTiles) {
      check(
        false,
        `wave ${index} has ${safeColumns.length} safe columns, not exactly ${CONTRACT.gapWidthTiles}`,
      );
      break;
    }
    const isContiguous =
      safeColumns[safeColumns.length - 1] - safeColumns[0] === safeColumns.length - 1;
    if (!isContiguous) {
      check(
        false,
        `wave ${index}'s safe columns are not one contiguous gap: ${safeColumns.join(',')}`,
      );
      break;
    }
  }

  let worstShift = 0;
  for (let index = 1; index < gaps.length; index++) {
    worstShift = Math.max(worstShift, Math.abs(gaps[index] - gaps[index - 1]));
  }
  check(
    worstShift <= CONTRACT.gapMaxShiftTiles,
    `a gap jumped ${worstShift} columns between consecutive waves, past the ${CONTRACT.gapMaxShiftTiles}-column fairness bound`,
  );
  check(
    worstShift > 0,
    'no gap ever moved across 500 waves, so the shift bound above passed without measuring anything',
  );
}

// ─────────────────────────────────────── 2b: a gap is somewhere you can stand
//
// A room is not a rectangle. The top of the tower has pillars in it and its
// corners are notched, and a gap placed on masonry is not a gap — it is a safe
// column the player is shown and cannot walk into, with an unavoidable wall of
// fire behind it. The planner takes a usability test from the caller; this is
// that test being honoured, and the reachability bound surviving it.

{
  // Mirrors the shape the tower actually generates: a clear band with one
  // pillar block punched out of it.
  const PILLAR_MIN_COL = 8;
  const PILLAR_MAX_COL = 11;
  const isStandable = (gapStart: number): boolean => {
    for (let col = gapStart; col < gapStart + CONTRACT.gapWidthTiles; col++) {
      if (col >= PILLAR_MIN_COL && col <= PILLAR_MAX_COL) return false;
    }
    return true;
  };

  const planner = new FirewallGapPlanner(mulberry32(SEED));
  const span = { minCol: ROOM.minCol, maxCol: ROOM.maxCol };
  const gaps: number[] = [];
  let frames = 0;
  const FRAME_CEILING = WAVES_SAMPLED * 1000;
  while (gaps.length < WAVES_SAMPLED && frames < FRAME_CEILING) {
    frames++;
    const gap = planner.tick(span, isStandable);
    if (gap !== null) gaps.push(gap);
  }

  check(gaps.length === WAVES_SAMPLED, 'the planner stalled under a usability test');
  check(
    gaps.every((gapStart) => isStandable(gapStart)),
    'a wave put its gap on masonry, where the player is being shown a safe column they cannot enter',
  );
  let worstShift = 0;
  for (let index = 1; index < gaps.length; index++) {
    worstShift = Math.max(worstShift, Math.abs(gaps[index] - gaps[index - 1]));
  }
  check(
    worstShift <= CONTRACT.gapMaxShiftTiles,
    `honouring the usability test broke the reachability bound: a gap jumped ${worstShift} columns`,
  );
  // Both sides of the pillar have to be reachable over a long run, or the test
  // is being honoured by the planner simply refusing to move.
  check(
    gaps.some((gapStart) => gapStart < PILLAR_MIN_COL) ||
      gaps.some((gapStart) => gapStart > PILLAR_MAX_COL),
    'every gap landed in one place, so the usability test passed by standing still',
  );
}

// ─────────────────────────────────────── 3: the orb rain never boxes the player in

/** One orb-rain scenario, run to exhaustion. */
interface OrbRainResult {
  readonly orbsPlaced: number;
  readonly peakWarnings: number;
  readonly boxedInFrames: number;
  readonly framesWithNoEscape: number;
  /** The most of the player's escapes that were ever simultaneously warned. */
  readonly worstCoverage: number;
  /** How many escapes the player had, when it never changed. */
  readonly escapeCount: number;
  /** Orbs aimed at the tile the player was standing on when they were planned. */
  readonly orbsAimedAtPlayer: number;
}

function simulateOrbRain(
  room: OrbRainRoom,
  intervalFrames: number,
  frames: number,
  playerAt: (frame: number) => TilePos,
): OrbRainResult {
  const planner = new OrbRainPlanner(mulberry32(SEED));
  planner.setInterval(intervalFrames);
  const warnings: Array<{ tile: TilePos; framesLeft: number }> = [];
  let orbsPlaced = 0;
  let peakWarnings = 0;
  let boxedInFrames = 0;
  let framesWithNoEscape = 0;
  let worstCoverage = 0;
  let escapeCount = 0;
  let orbsAimedAtPlayer = 0;

  for (let frame = 0; frame < frames; frame++) {
    const playerTile = playerAt(frame);
    const escapes = walkableNeighbours(room, playerTile);
    escapeCount = escapes.length;
    if (escapes.length === 0) framesWithNoEscape++;

    const spawn = planner.tick(
      room,
      playerTile,
      warnings.map((warning) => warning.tile),
    );
    if (spawn !== null) {
      warnings.push({ tile: spawn, framesLeft: ORB_WARNING_FRAMES });
      orbsPlaced++;
      if (spawn.col === playerTile.col && spawn.row === playerTile.row) orbsAimedAtPlayer++;
    }
    peakWarnings = Math.max(peakWarnings, warnings.length);

    // Coverage measured at the blast radius, the same way the rule measures it:
    // an orb hurts everything within `ORB_IMPACT_RADIUS_TILES`, so counting only
    // a direct hit on an escape tile would call a boxed-in player free.
    const covered = escapes.filter((escape) =>
      warnings.some(
        (warning) =>
          Math.hypot(warning.tile.col - escape.col, warning.tile.row - escape.row) <=
          ORB_IMPACT_RADIUS_TILES,
      ),
    ).length;
    worstCoverage = Math.max(worstCoverage, covered);
    if (escapes.length > 0 && covered === escapes.length) boxedInFrames++;

    for (const warning of warnings) warning.framesLeft--;
    for (let index = warnings.length - 1; index >= 0; index--) {
      if (warnings[index].framesLeft <= 0) warnings.splice(index, 1);
    }
  }

  return {
    orbsPlaced,
    peakWarnings,
    boxedInFrames,
    framesWithNoEscape,
    worstCoverage,
    escapeCount,
    orbsAimedAtPlayer,
  };
}

// 3a. The fight as it is actually played: the office, the tantrum's own cadence,
// and a player walking a lap rather than standing still — a stationary target
// lets every player-aimed orb pile onto one tile, which is the easy case.
{
  let lapTile: TilePos = { col: ROOM.minCol + 1, row: ROOM.minRow + 1 };
  const result = simulateOrbRain(ROOM, ORB_SPAWN_INTERVAL_FRAMES, ORB_FRAMES_SAMPLED, (frame) => {
    lapTile = stepAroundRoom(lapTile, frame);
    return lapTile;
  });
  // The rain has to survive its own fairness rules. Measuring throughput as well
  // as safety is what separates "never boxes the player in" from "never rains" —
  // widening the box-in test to the blast radius costs about one spawn in
  // twenty, and a change that started refusing half of them would still satisfy
  // every safety check in this file.
  const unrefusedOrbs = Math.floor(ORB_FRAMES_SAMPLED / ORB_SPAWN_INTERVAL_FRAMES);
  const MIN_ORB_THROUGHPUT = 0.8;
  check(
    result.orbsPlaced >= unrefusedOrbs * MIN_ORB_THROUGHPUT,
    `only ${result.orbsPlaced} of a possible ${unrefusedOrbs} orbs were placed at the tantrum cadence — the fairness rules are refusing the rain out of existence`,
  );
  // "One orb in three targets the player's current tile" is what makes the phase
  // a dodge rather than a stroll, and it is the one orb rule with no safety
  // consequence — so nothing else in this file would notice it disappearing.
  const playerAimedShare = result.orbsAimedAtPlayer / Math.max(1, result.orbsPlaced);
  const EXPECTED_PLAYER_AIMED_SHARE = 1 / 3;
  const PLAYER_AIMED_TOLERANCE = 0.08;
  check(
    Math.abs(playerAimedShare - EXPECTED_PLAYER_AIMED_SHARE) <= PLAYER_AIMED_TOLERANCE,
    `${Math.round(playerAimedShare * 100)}% of orbs were aimed at the player's own tile, not the one in three the phase is built on`,
  );
  check(
    result.framesWithNoEscape === 0,
    'the simulated player stood on a tile with no walkable neighbour, so 3c below would have nothing to prove',
  );
  // No box-in assertion here, and that is deliberate. At this cadence three
  // warnings are live at once against eight escapes, so "never covered all
  // eight" is true by arithmetic whether or not the rule exists — a check that
  // stays green with `wouldBoxIn` stubbed out to `false`. The rule is tested in
  // 3c, in a room narrow enough for it to be the thing that says no.
}

// 3b. The cap, pressed until it binds. At the tantrum's own cadence only three
// warnings are ever live at once, so a run at that speed would report the cap
// holding without having reached it — which is the same as not checking it.
{
  const STANDING_TILE: TilePos = {
    col: Math.floor((ROOM_MIN_COL + ROOM_MAX_COL) / 2),
    row: Math.floor((ROOM_MIN_ROW + ROOM_MAX_ROW) / 2),
  };
  const result = simulateOrbRain(
    ROOM,
    PRESSURE_CADENCE_FRAMES,
    ORB_FRAMES_SAMPLED,
    () => STANDING_TILE,
  );
  check(
    result.peakWarnings <= CONTRACT.maxConcurrentWarnings,
    `${result.peakWarnings} orb warnings were live at once, past the cap of ${CONTRACT.maxConcurrentWarnings}`,
  );
  check(
    result.peakWarnings === CONTRACT.maxConcurrentWarnings,
    `a one-frame cadence only ever reached ${result.peakWarnings} live warnings, so the cap of ${CONTRACT.maxConcurrentWarnings} was never tested`,
  );
}

// 3c. The never-box-in rule, in a room narrow enough to press it.
//
// A one-tile corridor: the player has exactly two tiles they can step to, and
// the warning cap is four times that. Anything that fills the floor at all will
// try to cover both, so the rule is the one and only thing standing between the
// player and nowhere to go. A wider room cannot test this — with eight
// neighbours and eight slots the planner runs out of orbs before it runs out of
// escapes, and the rule never gets a chance to refuse anything.
{
  const CORRIDOR_MIN_COL = 1;
  const CORRIDOR_MAX_COL = 5;
  const CORRIDOR_ROW = 1;
  const CORRIDOR: OrbRainRoom = {
    minCol: CORRIDOR_MIN_COL,
    maxCol: CORRIDOR_MAX_COL,
    minRow: CORRIDOR_ROW,
    maxRow: CORRIDOR_ROW,
    isWalkable: (col, row) =>
      col >= CORRIDOR_MIN_COL && col <= CORRIDOR_MAX_COL && row === CORRIDOR_ROW,
  };
  const MIDDLE: TilePos = {
    col: Math.floor((CORRIDOR_MIN_COL + CORRIDOR_MAX_COL) / 2),
    row: CORRIDOR_ROW,
  };
  const CORRIDOR_ESCAPES = 2;
  const result = simulateOrbRain(
    CORRIDOR,
    PRESSURE_CADENCE_FRAMES,
    ORB_FRAMES_SAMPLED,
    () => MIDDLE,
  );
  check(
    result.escapeCount === CORRIDOR_ESCAPES,
    `the corridor gave the player ${result.escapeCount} escapes, not the ${CORRIDOR_ESCAPES} this check is built on`,
  );
  check(result.orbsPlaced > 0, 'the corridor scenario placed no orbs at all, so it proved nothing');
  check(
    result.boxedInFrames === 0,
    `in a corridor with two ways out, ${result.boxedInFrames} frame(s) covered both of them`,
  );
  check(
    result.worstCoverage === CORRIDOR_ESCAPES - 1,
    `the corridor scenario never got closer than ${result.worstCoverage} of ${CORRIDOR_ESCAPES} escapes covered, so the rule was never the thing that stopped it`,
  );
}

// ─────────────────────────────────────── 4: the dodge clock

{
  const machine = reachTantrum();

  for (let frame = 0; frame < DODGE_SURVIVAL_FRAMES - 1; frame++) machine.tickTantrum(false);
  check(
    machine.tantrumMode === 'float',
    `the Lich dazed after ${DODGE_SURVIVAL_FRAMES - 1} frames, one short of the required ${DODGE_SURVIVAL_FRAMES}`,
  );
  // One hit, one frame short of the target, must cost the whole clock.
  machine.tickTantrum(true);
  check(machine.dodgeFrames === 0, 'an orb hit did not empty the dodge clock');
  check(machine.tantrumMode === 'float', 'an orb hit on the last frame still produced a daze');

  for (let frame = 0; frame < DODGE_SURVIVAL_FRAMES - 1; frame++) machine.tickTantrum(false);
  check(machine.tantrumMode === 'float', 'the clock dazed early after a reset');
  const tick = machine.tickTantrum(false);
  check(
    tick === 'daze_started' && machine.tantrumMode === 'daze',
    `${DODGE_SURVIVAL_FRAMES} uninterrupted frames did not produce a daze`,
  );
}

// ─────────────────────────────────────── 5: daze hits, across one or several windows

{
  const single = reachDaze();
  for (let hit = 1; hit < DAZE_HITS_REQUIRED; hit++) {
    check(
      !single.registerDazeHit(),
      `hit ${hit} of ${DAZE_HITS_REQUIRED} advanced the phase on its own`,
    );
    check(single.phase === 'tantrum', `hit ${hit} left the fight outside the tantrum`);
  }
  check(
    single.registerDazeHit(),
    `${DAZE_HITS_REQUIRED} hits in one window did not reach reckoning`,
  );
  check(single.phase === 'reckoning', 'the fight did not enter reckoning after the required hits');

  // The same count, spread over separate windows, must land in the same place.
  const spread = reachDaze();
  check(!spread.registerDazeHit(), 'the first hit of a split count advanced the phase on its own');
  for (let frame = 0; frame < DAZE_FRAMES; frame++) spread.tickTantrum(false);
  check(spread.tantrumMode === 'float', 'the daze window did not expire after its full length');
  check(spread.phase === 'tantrum', 'an expired daze walked the fight out of the tantrum');
  for (let frame = 0; frame < DODGE_SURVIVAL_FRAMES; frame++) spread.tickTantrum(false);
  check(spread.tantrumMode === 'daze', 'a second daze window never opened');
  check(
    spread.registerDazeHit(),
    'a hit in a second window did not complete a count started in the first',
  );
  check(spread.phase === 'reckoning', 'a split hit count did not reach reckoning');
}

// ─────────────────────────────────────── 6: phase order is monotonic

{
  const ORDER: ReadonlyArray<LichBattlePhase> = [
    'binding',
    'onslaught',
    'firewall',
    'tantrum',
    'reckoning',
  ];
  const rankOf = (phase: LichBattlePhase): number => {
    const rank = ORDER.indexOf(phase);
    // An unrecognised phase is a rule that grew a state this gate does not know
    // about, which is exactly when a silent skip would be worst.
    if (rank < 0)
      failures.push(`unknown phase "${phase}" — this gate's phase order is out of date`);
    return rank;
  };

  check(
    new LichPhaseMachine().phase === 'onslaught',
    'a circle with no cat bound in it did not open on the onslaught',
  );
  const machine = new LichPhaseMachine(true);
  const seen: LichBattlePhase[] = [machine.phase];
  let rank = rankOf(machine.phase);
  const observe = (): void => {
    if (machine.phase === seen[seen.length - 1]) return;
    const next = rankOf(machine.phase);
    check(next > rank, `the fight went from "${seen[seen.length - 1]}" back to "${machine.phase}"`);
    rank = next;
    seen.push(machine.phase);
  };

  // Every out-of-order call the fight could plausibly make, refused.
  check(!machine.isVulnerable, 'the Lich could be hurt inside its binding');
  check(!machine.observeHealth(0), 'health observation moved the fight out of the binding');
  check(!machine.registerFirewallStrike(), 'a firewall strike advanced the fight from the binding');
  check(!machine.registerDazeHit(), 'a daze hit advanced the fight from the binding');
  check(machine.tickTantrum(false) === 'none', 'the tantrum ticked inside the binding');
  observe();
  check(machine.registerBindingBroken(), 'breaking the circle did not open the onslaught');
  observe();
  check(!machine.registerBindingBroken(), 'a second break re-entered the onslaught');

  check(!machine.registerFirewallStrike(), 'a firewall strike advanced the fight from onslaught');
  check(!machine.registerDazeHit(), 'a daze hit advanced the fight from onslaught');
  check(machine.tickTantrum(false) === 'none', 'the tantrum ticked from onslaught');
  observe();

  check(!machine.observeHealth(1), 'full health opened the firewall');
  check(
    !machine.observeHealth(FIREWALL_TRIGGER_HP_FRACTION + 0.01),
    'the firewall opened above its health threshold',
  );
  check(
    machine.observeHealth(FIREWALL_TRIGGER_HP_FRACTION),
    'the firewall did not open at its threshold',
  );
  observe();
  check(!machine.observeHealth(0.1), 'a second health observation re-opened the firewall');
  check(!machine.registerDazeHit(), 'a daze hit advanced the fight from the firewall');
  observe();

  check(machine.registerFirewallStrike(), 'a close strike did not end the firewall');
  observe();
  check(!machine.registerFirewallStrike(), 'a second strike re-entered the tantrum');
  observe();

  for (let frame = 0; frame < DODGE_SURVIVAL_FRAMES; frame++) machine.tickTantrum(false);
  for (let hit = 0; hit < DAZE_HITS_REQUIRED; hit++) machine.registerDazeHit();
  observe();

  check(!machine.observeHealth(0), 'health observation moved the fight out of reckoning');
  check(!machine.registerBindingBroken(), 'a broken circle moved the fight out of reckoning');
  check(!machine.registerFirewallStrike(), 'a strike moved the fight out of reckoning');
  check(machine.tickTantrum(false) === 'none', 'the tantrum ticked during reckoning');
  observe();

  check(
    seen.length === ORDER.length && seen.every((phase, index) => phase === ORDER[index]),
    `the fight visited ${seen.join(' → ')}, not ${ORDER.join(' → ')}`,
  );
}

// ─────────────────────────────────────── 6b: the escape search

/**
 * `stepTowardSafety` decides where a companion runs, and its tie-breaks are the
 * difference between a dodge and a slow walk into a corner. Checked here as
 * arithmetic rather than through the fight, because in the fight they are
 * covered for by margins wide enough to survive a bad choice — which makes a
 * live run a poor witness for whether the choice was good.
 */
{
  const OPEN_ROOM_SIZE = 9;
  const openRoom: OrbRainRoom = {
    minCol: 0,
    maxCol: OPEN_ROOM_SIZE - 1,
    minRow: 0,
    maxRow: OPEN_ROOM_SIZE - 1,
    isWalkable: () => true,
  };
  const middle = { col: 4, row: 4 };

  check(
    stepTowardSafety(openRoom, () => 0, middle) === null,
    'the escape search sent a walker off safe ground',
  );
  check(
    stepTowardSafety(openRoom, () => 5, middle) === null,
    'the escape search moved a walker somewhere no better than where it stood',
  );

  // Danger everywhere north of the walker, safe everywhere south and level with
  // it. North and north-east are the same distance in steps; the search must
  // take neither, because both give up ground for nothing.
  const northIsBad = stepTowardSafety(openRoom, (tile) => (tile.row <= middle.row ? 9 : 0), middle);
  check(
    northIsBad !== null && northIsBad.row > middle.row,
    `the escape search walked toward the danger instead of away (${JSON.stringify(northIsBad)})`,
  );

  // Two tiles of equal safety, one orthogonal and one diagonal. Taking whichever
  // the neighbour list named first is what drifted the companion north into the
  // fire it was dodging; the nearer one is the answer.
  const eastOrNorthEast = stepTowardSafety(
    openRoom,
    (tile) =>
      (tile.col === middle.col + 1 && tile.row === middle.row) ||
      (tile.col === middle.col + 1 && tile.row === middle.row - 1)
        ? 0
        : 9,
    middle,
  );
  check(
    eastOrNorthEast !== null && eastOrNorthEast.row === middle.row,
    `the escape search took a diagonal where a straight step was as safe and as near (${JSON.stringify(eastOrNorthEast)})`,
  );

  // The same again, but the two candidates are equally near as well as equally
  // safe, and one of them is a dead end. A tile you cannot leave is not a safe
  // tile, and a walker that keeps choosing them banks a corner over a phase.
  const POCKET_COL = 3;
  const pocketRoom: OrbRainRoom = {
    ...openRoom,
    isWalkable: (col, row) =>
      !(col === POCKET_COL && row !== middle.row) &&
      !(col === POCKET_COL - 1 && row !== middle.row),
  };
  const openOrPocket = stepTowardSafety(
    pocketRoom,
    (tile) => (tile.col === middle.col - 1 || tile.col === middle.col + 1 ? 0 : 9),
    middle,
  );
  check(
    openOrPocket !== null && openOrPocket.col === middle.col + 1,
    `the escape search backed into the dead end rather than the open floor (${JSON.stringify(openOrPocket)})`,
  );
}

// ─────────────────────────────────────── 6c: the binding's rules
//
// The circle shields the Lich while any pillar is lit, the carrier comes once
// and never for the pillar a crawler is working, the Lich leaves the worker
// alone while somebody else stands, and a companion sent off her pillar by a
// threat is not sent back until the ground has stayed clear. Each is a rule of
// `lichBattleRules` alone, so it is pressed here as arithmetic.

{
  const PILLARS = ['north', 'east', 'south'] as const;
  type Pillar = (typeof PILLARS)[number];
  const ORDER: ReadonlyArray<Pillar> = PILLARS;

  const circle = new BindingCircle<Pillar>(PILLARS, ORDER);
  check(circle.shieldsLich, 'a circle with three lit pillars did not shield the Lich');
  check(circle.shatter('north'), 'a lit pillar could not be unbound');
  check(circle.shieldsLich, 'one pillar going dark left the Lich unshielded while two were lit');
  check(!circle.shatter('north'), 'a pillar already dark shattered a second time');

  // The carrier comes at its time and not a frame before, and never for the
  // pillar a crawler is working — even when that pillar is the first in its
  // order. The fault hands the circle no worker, which is the rule removed.
  const worked: Pillar = 'east';
  const told = (): Pillar | null => (FAULT === 'carrier-takes-worked-pillar' ? null : worked);
  let arrivedOn: Pillar | null = null;
  let arrivedAtFrame = -1;
  for (let frame = 1; frame <= CARRIER_ARRIVAL_FRAMES; frame++) {
    const tick = circle.tick(told());
    if (tick.kind === 'carrier_arrives') {
      arrivedOn = tick.pillar;
      arrivedAtFrame = frame;
    }
  }
  check(
    arrivedAtFrame === CARRIER_ARRIVAL_FRAMES,
    `the carrier arrived on frame ${arrivedAtFrame}, not ${CARRIER_ARRIVAL_FRAMES}`,
  );
  check(arrivedOn !== null, 'the carrier never came, so the pillar it chose was never checked');
  check(arrivedOn !== worked, 'the carrier went for the pillar a crawler was working');
  check(
    arrivedOn === null || !circle.workable(arrivedOn),
    'a crawler may still work the pillar the carrier is lifting the cat from',
  );

  let freed = 0;
  let gone = false;
  const CARRIER_FRAMES = CARRIER_FLIGHT_FRAMES * 2 + CARRIER_LIFT_FRAMES;
  for (let frame = 0; frame < CARRIER_FRAMES * 2; frame++) {
    const tick = circle.tick(worked);
    if (tick.kind === 'carrier_frees') freed++;
    if (tick.kind === 'carrier_gone') gone = true;
    check(tick.kind !== 'carrier_arrives', 'the carrier came a second time');
  }
  check(freed === 1, `the carrier freed ${freed} cats, not one`);
  check(gone, 'the carrier never left through the window');
  check(circle.bound.size === 1, `${circle.bound.size} pillars are lit, not the one still worked`);
  check(circle.shatter(worked), 'the last pillar could not be unbound');
  check(!circle.shieldsLich, 'a circle with every pillar dark still shields the Lich');

  // With only the worked pillar left, the carrier waits rather than taking it.
  const lastOne = new BindingCircle<Pillar>([worked], ORDER);
  let tookTheWorkedPillar = false;
  for (let frame = 0; frame < CARRIER_ARRIVAL_FRAMES * 2; frame++) {
    if (lastOne.tick(told()).kind === 'carrier_arrives') tookTheWorkedPillar = true;
  }
  check(
    !tookTheWorkedPillar,
    'the carrier took the only lit pillar out from under the crawler working it',
  );

  const empty = new BindingCircle<Pillar>([], ORDER);
  check(!empty.shieldsLich, 'a circle with no cat bound in it shielded the Lich');
  let emptyCarrierCame = false;
  for (let frame = 0; frame < CARRIER_ARRIVAL_FRAMES * 2; frame++) {
    if (empty.tick(null).kind === 'carrier_arrives') emptyCarrierCame = true;
  }
  check(!emptyCarrierCame, 'the carrier came to a circle with no cat to carry');

  // The worker is spared only during the binding, only while working, and
  // only while somebody else stands.
  check(
    bindingSparesCrawler('binding', true, true),
    'the Lich did not spare the crawler working a pillar',
  );
  check(
    !bindingSparesCrawler('binding', true, false),
    'the Lich spared the worker with nobody else left standing',
  );
  check(
    !bindingSparesCrawler('binding', false, true),
    'the Lich spared a crawler that was not working',
  );
  check(
    !bindingSparesCrawler('onslaught', true, true),
    'the Lich kept sparing the worker after the binding',
  );

  // Threatened ground keeps her off for the whole wait, and lets her go after it.
  const gate = new ChannelReturnGate(FAULT === 'no-return-wait' ? 0 : CHANNEL_RETURN_CLEAR_FRAMES);
  check(gate.tick(false), 'a companion was held off a channel spot that was never threatened');
  check(!gate.tick(true), 'a companion was sent onto threatened ground');
  let framesHeldAfter = 0;
  while (!gate.tick(false) && framesHeldAfter <= CHANNEL_RETURN_CLEAR_FRAMES) framesHeldAfter++;
  check(
    framesHeldAfter === CHANNEL_RETURN_CLEAR_FRAMES - 1,
    `a companion went back to her spot ${framesHeldAfter + 1} frame(s) after the threat cleared, not ${CHANNEL_RETURN_CLEAR_FRAMES}`,
  );
}

// ─────────────────────────────────────── 7: the health threshold

{
  // Swept rather than sampled at the boundary alone: an off-by-one in the
  // comparison shows up as a fraction above the threshold that still opens.
  const STEPS = 200;
  let openedAt: number | null = null;
  for (let step = STEPS; step >= 0; step--) {
    const fraction = step / STEPS;
    const machine = new LichPhaseMachine();
    if (!machine.observeHealth(fraction)) continue;
    openedAt = fraction;
    break;
  }
  check(openedAt !== null, 'the firewall never opened at any health fraction from 1 down to 0');
  if (openedAt !== null) {
    check(
      openedAt <= FIREWALL_TRIGGER_HP_FRACTION,
      `the firewall opened at ${openedAt} of maximum health, above the ${FIREWALL_TRIGGER_HP_FRACTION} threshold`,
    );
  }
}

// ─────────────────────────────────────── helpers

function reachTantrum(): LichPhaseMachine {
  const machine = new LichPhaseMachine();
  machine.observeHealth(FIREWALL_TRIGGER_HP_FRACTION);
  machine.registerFirewallStrike();
  if (machine.phase !== 'tantrum') {
    failures.push(
      'the harness could not reach the tantrum, so every check under it measured nothing',
    );
  }
  return machine;
}

function reachDaze(): LichPhaseMachine {
  const machine = reachTantrum();
  for (let frame = 0; frame < DODGE_SURVIVAL_FRAMES; frame++) machine.tickTantrum(false);
  if (machine.tantrumMode !== 'daze') {
    failures.push(
      'the harness could not reach a daze window, so every check under it measured nothing',
    );
  }
  return machine;
}

/** Walks the simulated player one tile around the room's interior, deterministically. */
function stepAroundRoom(tile: TilePos, frame: number): TilePos {
  const STEP_INTERVAL_FRAMES = 7;
  if (frame % STEP_INTERVAL_FRAMES !== 0) return tile;
  const width = ROOM.maxCol - ROOM.minCol - 1;
  const height = ROOM.maxRow - ROOM.minRow - 1;
  const lap = Math.floor(frame / STEP_INTERVAL_FRAMES);
  const along = lap % (2 * (width + height));
  if (along < width) return { col: ROOM.minCol + 1 + along, row: ROOM.minRow + 1 };
  if (along < width + height) {
    return { col: ROOM.maxCol - 1, row: ROOM.minRow + 1 + (along - width) };
  }
  if (along < 2 * width + height) {
    return { col: ROOM.maxCol - 1 - (along - width - height), row: ROOM.maxRow - 1 };
  }
  return { col: ROOM.minCol + 1, row: ROOM.maxRow - 1 - (along - 2 * width - height) };
}

// ─────────────────────────────────────── 7b: every cue the fight plays is loaded
//
// `AudioManager.play` returns silently on a sound whose buffer never loaded, so
// a cue missing from the floor's preload bundle is not an error — it is a beat
// that simply does not happen, and nothing on screen says so. Two of this
// fight's cues were silent on floor 3 for exactly that reason, one of them the
// one that announces the three-second strike window.
//
// Scanned out of the source rather than listed here, so the check cannot drift
// away from the code it is checking.

{
  const FIGHT_SOURCES = ['src/systems/LichBattleSystem.ts'];
  const PLAY_CALL = /\baudio\??\.play\(\s*'([a-z0-9_]+)'/g;
  const loadedOnFloorThree = new Set<string>([
    ...sfxGroupsForLevelId(LICH_FIGHT_LEVEL_ID),
    ...CORE_SFX_IDS,
  ]);

  const played = new Set<string>();
  for (const path of FIGHT_SOURCES) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(PLAY_CALL)) played.add(match[1]);
  }

  check(
    played.size > 0,
    `no sound cue was found in ${FIGHT_SOURCES.join(' or ')}, so the coverage check below proved nothing`,
  );
  const silent = [...played].filter((id) => !loadedOnFloorThree.has(id));
  check(
    silent.length === 0,
    `${silent.join(', ')} played by the tower fight but never preloaded on its own floor — those beats are silent`,
  );
}

/**
 * Everything about the fight that a running frame would change.
 *
 * Compared as a string across a stretch of forced updates: if any of it moves
 * while a bark is on screen, the world was not held. Deliberately includes the
 * things that advance *within* a phase — a phase name alone is a constant, and
 * comparing constants is how a probe passes without measuring anything.
 */
function describeFightState(ritual: TowerRitualSystem): string {
  const battle = ritual.lichBattle;
  if (battle === null) return 'no-battle';
  const band = battle.waveBand;
  return [
    battle.phase,
    battle.objectiveLine,
    // Rows and not just gaps: a wave's row advances every frame it is alive,
    // which is what makes this fingerprint sharp enough to catch a world that
    // ran on underneath a bark.
    battle.liveWaves.map((wave) => `${wave.gapStart}@${wave.row.toFixed(3)}`).join('/'),
    battle.liveOrbThreatCount,
    [...battle.litPillars].join('+'),
    battle.carrierStage,
    battle.channellingPillar ?? 'idle',
    band.firstRow,
    band.lastRow,
  ].join('|');
}

/**
 * Names the fight's own ground when it is what hurt the companion, else null.
 *
 * A soul bolt returns null on purpose. The companion is meant to be in this
 * fight and being shot at is what that costs; being cooked by a wall of fire,
 * flattened by an orb she was shown fifty frames of warning about, or caught by
 * a telegraphed cone is not — those are the three things she is supposed to be
 * able to read and step out of, and every one of them killed her before she
 * could.
 */
function companionHazardCause(source: DamageSource | null): string | null {
  if (source === null) return null;
  if (source.kind === 'environmental') {
    if (source.hazard === 'lichFirewall' || source.hazard === 'lichOrb') return source.hazard;
    return null;
  }
  if (source.kind === 'mob' && source.attackType === 'grasping_hands') return 'grasping_hands';
  return null;
}

/** The wave that will next burn across a row, or null when none will. */
function arrivingWaveFor(
  battle: LichBattleSystem,
  row: number,
): { readonly gapStart: number; readonly row: number } | null {
  let arriving: { readonly gapStart: number; readonly row: number } | null = null;
  for (const wave of battle.liveWaves) {
    if (Math.round(wave.row) > row) continue;
    if (arriving === null || wave.row > arriving.row) arriving = wave;
  }
  return arriving;
}

// ─────────────────────────────────────── 8: storey 5, built from the questline

/** The rows a wave crosses, as `LichBattleSystem` reports them. */
type LichWaveBand = { readonly firstRow: number; readonly lastRow: number };

const CATTERY_STOREY = towerStoreyIndex('cattery');
/** A credited damage-over-time that outlasts every watch here: poison held on far past its usual run. */
const LASTING_POISON_TICKS = 999999;
/** How far the harness looks for open floor near a corner it wants to stand in. */
const STANDING_SEARCH_RADIUS_TILES = 3;

/**
 * Reads the questline's phase opaquely, through a call, so the compiler does
 * not narrow it to the literal the harness set and reject a comparison against
 * the phase the fight is supposed to reach.
 */
function phaseOf(progress: MissingCatsProgress): MissingCatsPhase {
  return progress.phase;
}

/** Everything one ritual is fought with: the cattery as the questline builds it, the party and the system. */
interface RitualRig {
  readonly map: GameMap;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly roster: MobRoster;
  readonly companion: CompanionSystem;
  readonly ritual: TowerRitualSystem;
  readonly progress: MissingCatsProgress;
  readonly context: SystemContext;
  /** Where the party came up: the landing below the stair down. */
  readonly landing: TilePos;
  readonly claims: readonly MusicClaim[];
  readonly releases: readonly MusicClaimOwner[];
  readonly fallenHookRuns: () => number;
}

/**
 * The questline at `from` with `catsFreed` let out of their cages, the
 * cattery built from it, the party on the landing, and the ritual's first
 * frame run. From `ritual`, with the reveal already behind the party, that
 * frame starts the fight; from `ascent` it opens the Warden's reveal.
 */
function ritualRig(
  catsFreed: ReadonlyArray<TownCatId>,
  from: Extract<MissingCatsPhase, 'ascent' | 'ritual'> = 'ritual',
): RitualRig {
  const progress = missingCatsProgressAt(from);
  const beforeAnyWasFreed: TowerConditions = towerConditionsFor(progress);
  for (const freed of catsFreed) progress.catsFreed.add(freed);
  const conditions =
    FAULT === 'freed-cats-still-bound' ? beforeAnyWasFreed : towerConditionsFor(progress);
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior('tower', CATTERY_STOREY, TOWN_TOWER_ID, false, {
    kind: 'tower',
    conditions,
  });

  // The landing the scene sets an ascending party down on: the row below the
  // whole stair block, in its leftmost column.
  const stair = map._interiorStairDownTiles;
  const first = stair[0] ?? map.startTile;
  const landing: TilePos = {
    col: stair.reduce((leftmost, tile) => Math.min(leftmost, tile.x), first.x),
    row: stair.reduce((lowest, tile) => Math.max(lowest, tile.y), first.y) + 1,
  };
  const human = new HumanPlayer(landing.col, landing.row, TILE_SIZE);
  const cat = new CatPlayer(landing.col + 1, landing.row, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;

  const roster = new MobRoster(map, new SpellSystem());
  const companion = new CompanionSystem(map, landing.col, landing.row);
  const claims: MusicClaim[] = [];
  const releases: MusicClaimOwner[] = [];
  const music: MusicClaims = {
    claimMusic: (claim) => {
      claims.push(claim);
    },
    releaseMusic: (owner) => {
      releases.push(owner);
    },
    isMusicClaimed: (owner) => claims.some((claim) => claim.owner === owner),
  };
  let fallenHookRuns = 0;
  const ritual = new TowerRitualSystem({
    map,
    bus: new EventBus(),
    addMob: (mob: Mob) => roster.add(mob),
    progress,
    conditions,
    audio: null,
    music,
    companion,
    conversation: new Conversation(null),
    partyLevel: () => partyLevelOf(human.level, cat.level),
    saveBeforeFight: () => undefined,
    onWardenFallen: () => {
      fallenHookRuns++;
    },
  });
  const context: SystemContext = {
    human,
    cat,
    active: human,
    partner: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
    camera: cameraAt({ x: 0, y: 0 }, UNZOOMED),
  };
  ritual.update(context, CATTERY_STOREY);
  return {
    map,
    human,
    cat,
    roster,
    companion,
    ritual,
    progress,
    context,
    landing,
    claims,
    releases,
    fallenHookRuns: () => fallenHookRuns,
  };
}

/**
 * Breaks one rule of the binding from outside the fight, for the fault that
 * names it: the circle stops shielding the Lich, or the Lich stops sparing the
 * crawler at a pillar.
 */
function injectDriverFault(lich: TheLich, battle: LichBattleSystem): void {
  const driver = lich.battleDriver;
  if (driver === null) return;
  if (FAULT === 'unshielded') {
    lich.battleDriver = {
      ...driver,
      blocksDamage: () => (battle.phase === 'binding' ? false : driver.blocksDamage()),
    };
  }
  if (FAULT === 'lich-turns-on-the-worker') {
    lich.battleDriver = { ...driver, spares: () => false };
  }
}

/** Every walkable tile reachable from `from` on the storey, as `col,row` keys. */
function walkableFrom(map: GameMap, from: TilePos): ReadonlySet<string> {
  const reached = new Set<string>([tileKeyOf(from)]);
  let frontier: TilePos[] = [from];
  while (frontier.length > 0) {
    const next: TilePos[] = [];
    for (const tile of frontier) {
      for (const step of ORTHOGONAL_STEPS) {
        const neighbour = { col: tile.col + step.col, row: tile.row + step.row };
        const key = tileKeyOf(neighbour);
        if (reached.has(key) || !map.isWalkable(neighbour.col, neighbour.row, 'walker')) continue;
        reached.add(key);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return reached;
}

const ORTHOGONAL_STEPS: ReadonlyArray<TilePos> = [
  { col: 1, row: 0 },
  { col: -1, row: 0 },
  { col: 0, row: 1 },
  { col: 0, row: -1 },
];

function tileKeyOf(tile: TilePos): string {
  return `${tile.col},${tile.row}`;
}

/**
 * 8a. Cats let out of their cages before the ritual are never bound: the
 * circle has a lit pillar for every cat nobody freed and no more, a circle
 * with none opens straight onto the onslaught, and the music opens on the
 * stem without the cat theme only while some cat is bound.
 */
function checkRitualOpenings(): void {
  const SOME_FREED = 3;
  const FREED_COUNTS = [0, SOME_FREED, TOWN_CAT_IDS.length];
  for (const freedCount of FREED_COUNTS) {
    const rig = ritualRig(TOWN_CAT_IDS.slice(0, freedCount));
    const battle = rig.ritual.lichBattle;
    const expected = TOWN_CAT_IDS.length - freedCount;
    check(battle !== null, `with ${freedCount} cats freed the fight never started`);
    if (battle === null) continue;
    check(
      battle.litPillars.size === expected,
      `with ${freedCount} of ${TOWN_CAT_IDS.length} cats freed in the cattery, ${battle.litPillars.size} pillars are lit, not ${expected}`,
    );
    const opening: LichBattlePhase = expected > 0 ? 'binding' : 'onslaught';
    check(
      battle.phase === opening,
      `with ${freedCount} cats freed the fight opened on "${battle.phase}", not "${opening}"`,
    );
    const firstClaim = rig.claims.find((claim) => claim.owner === 'tower_finale');
    const wantedStem = expected > 0 ? 'warden_ritual_battle_bound' : 'warden_ritual_battle';
    const firstSelection = firstClaim?.selection;
    const firstStem = firstSelection?.kind === 'stems' ? firstSelection.stem : null;
    check(
      firstStem === wantedStem,
      `with ${freedCount} cats freed the fight opened on ${firstStem ?? 'no stem'}, not ${wantedStem}`,
    );
    battle.dispose();
  }
}

/**
 * More presses than any reveal has pages, so a reveal that never closes is a
 * failure rather than a hang. Headless, with no canvas to lay it out on, the
 * box pages its text a few words at a time, so the bound is per word.
 */
const REVEAL_PRESSES_PER_WORD = 2;
const REVEAL_MAX_PRESSES =
  wardenReveal(true)
    .flatMap((line) => ('paragraphs' in line ? line.paragraphs : []))
    .join(' ')
    .split(/\s+/).length * REVEAL_PRESSES_PER_WORD;

/**
 * 8c. A party whole again at `ascent` comes up onto the cattery to the
 * Warden's reveal, not the fight: the questline moves to `ritual`, the
 * Warden stands held in the circle while it speaks, and reading the reveal to
 * its end is what starts the fight, on its music.
 */
function checkRevealPath(): void {
  const rig = ritualRig([], 'ascent');
  const { ritual, progress } = rig;
  const arrivedAt = phaseOf(progress);
  check(
    arrivedAt === 'ritual',
    `arriving at ascent left the questline at "${arrivedAt}", not "ritual"`,
  );
  check(ritual.isDialogOpen, 'arriving at ascent opened no reveal');
  check(ritual.lichBattle === null, 'the fight started under the reveal');
  const warden = ritual.wardenMob;
  check(warden !== null, 'arriving at ascent raised no Warden');
  check(warden?.aiHeld === true, 'the Warden was free to act while it spoke');
  let presses = 0;
  while (ritual.isDialogOpen && presses < REVEAL_MAX_PRESSES) {
    ritual.advanceDialog();
    presses++;
  }
  check(!ritual.isDialogOpen, `the reveal was still open after ${presses} presses`);
  const battle = ritual.lichBattle;
  check(battle !== null, 'reading the reveal to its end never started the fight');
  const finaleClaims = rig.claims.filter((claim) => claim.owner === 'tower_finale').length;
  check(
    finaleClaims === 1,
    `the reveal and fight claimed the finale ${finaleClaims} times, not once`,
  );
  battle?.dispose();
}

/**
 * 8b. The circle against the room. The walls of fire are born on the first
 * row from which every column runs clear to the south wall, so a pillar at or
 * below it is a hole in a wave nobody can stand in; and every pillar has a
 * tile beside it to be worked from, on the floor the party arrived on.
 */
function checkBindingGeometry(): void {
  const rig = ritualRig([]);
  const battle = rig.ritual.lichBattle;
  check(
    battle !== null,
    'the fight never started, so the circle was never measured against the room',
  );
  if (battle === null) return;
  const band = battle.waveBand;
  const pillars = battle.pillarSpots.map((pillar) => pillar.tile);
  check(
    pillars.length === TOWN_CAT_IDS.length,
    `the circle has ${pillars.length} pillars to measure, not ${TOWN_CAT_IDS.length}`,
  );
  const inTheFire = pillars.filter((tile) => tile.row >= band.firstRow);
  check(
    inTheFire.length === 0,
    `${inTheFire.length} binding pillar(s) stand at or below row ${band.firstRow}, where the walls of fire are born`,
  );

  const reachable = walkableFrom(rig.map, rig.landing);
  const stranded = battle.pillarSpots.filter((pillar) => {
    return !pillar.spots.some((spot) => reachable.has(tileKeyOf(spot)));
  });
  check(
    stranded.length === 0,
    `${stranded.length} pillar(s) have no tile beside them to be worked from that the party can walk to`,
  );
  battle.dispose();
}

// ─────────────────────────────────────── 8: the whole fight, end to end
//
// Every check above measures one rule in isolation. This one plays the
// encounter: the questline stands at `ritual`, the party comes up onto the
// cattery with every town cat still bound to its pillar, and fights the
// Warden through the binding and all four phases after it under the same gates
// a real player is held to — the circle's shield, the firewall's two-tile
// strike range, the tantrum's dodge clock, the daze count — and the run is
// only green if the fight can actually be finished. A phase nobody can leave
// is the one failure the isolated rules cannot see. The player steers the
// human; the cat is the companion, and unbinds the pillars on her own.
//
// It is played over several streams, because whether the companion is ever
// caught by the rain turns on where she happens to be standing when an orb
// comes down, and one fight sees one handful of those moments. The Lich's own
// generator is fixed by design, and seeding `Math.random` alone barely moves
// the fight: the harness drives the player, so every stream would replay
// nearly the same one. What moves it is the player: each stream starts the
// tantrum's kite at a different point round its ring, so the orbs aimed at the
// player fall elsewhere and the companion is somewhere else for every one of
// them after. `Math.random`, which `CompanionSystem` rolls for her wander and
// the cat for her missiles, is seeded per stream so a failure replays exactly.

/** Fights played, each from its own point on the tantrum kite and its own `Math.random` seed. */
const WHOLE_FIGHT_STREAMS = 8;
/** How many rows ahead of a wave the fire-bite probe stands the player, so the wave reaches them while they are held. */
const FIRE_PROBE_ROWS_AHEAD = 2;

await loadGameSpritesInNode();
checkRitualOpenings();
checkRevealPath();
checkBindingGeometry();
for (let stream = 0; stream < WHOLE_FIGHT_STREAMS; stream++) {
  const failuresBefore = failures.length;
  const unseededRandom = Math.random;
  Math.random = mulberry32(SEED + stream);
  try {
    playWholeFight(stream);
  } finally {
    Math.random = unseededRandom;
  }
  for (let index = failuresBefore; index < failures.length; index++) {
    failures[index] = `fight stream ${stream}: ${failures[index]}`;
  }
}

function playWholeFight(stream: number): void {
  const rig = ritualRig([]);
  const { map, human, cat, roster, companion, ritual, progress, context } = rig;

  const lich = ritual.wardenMob;
  check(lich !== null, 'the ritual puts the Warden in the room');
  const farCornerTile =
    findNearbyWalkableTile(
      map,
      (map.structure[0]?.length ?? 0) - 2,
      map.structure.length - 2,
      STANDING_SEARCH_RADIUS_TILES,
    ) ?? map.startTile;
  const farCorner: TilePos = { col: farCornerTile.x, row: farCornerTile.y };

  // A permanent damage-over-time, applied before the first phase change and
  // never removed. This is the shape of the worst thing a real build can do to
  // this fight: a DoT ticks through the scripted slides that open every phase,
  // where the player has no control and the phase logic is not running, and
  // through the whole of the binding, where the circle is meant to refuse it.
  // Without it the harness plays too politely to ever land a blow in one of
  // those windows, and the checks below would pass without ever being tested.
  if (lich !== null) lich.applyStatus(makePoison(human, LASTING_POISON_TICKS));

  const mobLoop = new MobUpdateLoop();

  /** One crawler's swing, in the harness. Small, so no phase is skipped by a spike. */
  const HARNESS_HIT_DAMAGE = 4;
  const HARNESS_SWING_INTERVAL_FRAMES = 18;
  /** Five minutes of game time — many times what the fight needs when it works. */
  const FIGHT_BUDGET_MINUTES = 5;
  const SECONDS_PER_MINUTE = 60;
  const FRAMES_PER_SECOND = 60;
  const FIGHT_FRAME_BUDGET = FIGHT_BUDGET_MINUTES * SECONDS_PER_MINUTE * FRAMES_PER_SECOND;
  const STRIKE_RANGE_TILES = 2;
  /** A swing's search box, in tiles: one tile either side of where the Lich is drawn. */
  const SWING_REACH_TILES = 3;
  /** Frames the harness takes to walk one lap of its dodging ring. */
  const TANTRUM_KITE_PERIOD_FRAMES = 240;
  /** How wide that ring is — far enough to keep moving, near enough to reach the daze. */
  const TANTRUM_KITE_RADIUS_TILES = 3;
  const roomCentreCol = Math.floor(map.structure[0].length / 2);
  const roomCentreRow = Math.floor(map.structure.length / 2);

  const phasesSeen: LichBattlePhase[] = [];
  /** Frames actually spent fighting in each phase, so a phase cannot be merely visited. */
  const framesInPhase = new Map<LichBattlePhase, number>();
  let barksRead = 0;
  let framesSpent = 0;
  let swingCooldown = 0;
  let lichDefeatedAtFrame = -1;
  let wasPartyLocked = false;
  let hitsLandedUnderLock = 0;
  let firstDazeFrame = -1;
  let reckoningFrame = -1;
  /** The fight, held past its own teardown so the cleanup contract can be swept. */
  let lastLiveBattle: LichBattleSystem | null = null;
  /** Rising edges of the party input lock during the firewall: one entry, then one per reset. */
  let firewallLocks = 0;
  const southWallY = (map.structure.length - 2) * TILE_SIZE;
  let firewallStartFrame = -1;
  /**
   * How long the harness watches the fire before walking into it.
   *
   * Long enough for the gap to random-walk the width of the room, which is what
   * gives the per-wave standability check above a chance to see the planner
   * reach the notched columns at the edges. A cautious opening is also what a
   * first-time player does.
   */
  const FIREWALL_OBSERVE_FRAMES = 3600;
  let leaveFloorProbed = false;
  let leaveFloorReleasedLock = false;
  let leaveFloorKeptGrid = false;
  let barksProbed = 0;
  let barkHaltBreaches = 0;
  let bindingFrames = 0;
  let pillarsAtStart = -1;
  let lichHpLostInBinding = 0;
  let catChannelFrames = 0;
  const carrierPillarsSeen = new Set<string>();
  let carrierLeft = false;
  let carrierOnWorkedPillarFrames = 0;
  let ordersOntoThreatenedGround = 0;
  let companionHeldBackFrames = 0;
  /**
   * The spare probe: while the cat works a pillar, the human is stood in the
   * far corner, so she is the nearer target by far, and the Lich is watched
   * for turning on her.
   */
  let spareProbeFrames = 0;
  let spareProbeSettled = false;
  let spareBreaches = 0;
  const SPARE_PROBE_FRAMES = 90;
  /** Frames into the probe before the Lich's choice of target is read, so the choice it made before the probe has gone. */
  const SPARE_PROBE_SETTLE_FRAMES = 10;
  let faultInjected = false;
  /** Frames of update pushed at the fight with a bark up — a phase clock would move. */
  const BARK_HALT_PROBE_FRAMES = 120;
  /**
   * Presses that close any one bark. Headless, with no canvas to lay it out
   * on, the box pages a bark a few words at a time, and each page takes a
   * skip-reveal and a turn: the bound is per word of the longest line a bark
   * can say, with room to spare.
   */
  const BARK_MAX_TURNS = 256;
  let swingsThatFoundTheLich = 0;
  let swingsThatMissedTheGrid = 0;
  /** Damage the party took, per phase, so a hazard that stopped biting is visible. */
  const damageByPhase = new Map<LichBattlePhase, number>();
  let damageDuringDaze = 0;
  let dazeFramesSeen = 0;
  let companionFledDuringDaze = 0;
  let armedOrbsDuringDaze = 0;
  let unstandableGaps = 0;
  let gapsInspected = 0;
  let observedWaveBand: LichWaveBand | null = null;
  /**
   * Columns the standability test may refuse before the gap stops being free to
   * cross the room. The tower's two notched corner columns are expected; a birth
   * row level with the pillar bar refuses ten and pens the gap into one half.
   */
  const MAX_REFUSED_GAP_COLUMNS = 4;

  /** Whether a gap column is walkable for the whole of a wave's path on this storey. */
  const gapStandableOnStorey = (gapStart: number, band: LichWaveBand): boolean => {
    for (let col = gapStart; col < gapStart + CONTRACT.gapWidthTiles; col++) {
      for (let row = band.firstRow; row <= band.lastRow; row++) {
        if (!map.isWalkable(col, row, 'walker')) return false;
      }
    }
    return true;
  };
  let battlePhaseThisFrame: LichBattlePhase | null = null;
  let dazedThisFrame = false;
  /** Whether the room's live-hazard count was ever seen to fall during the tantrum. */
  let hazardFieldEverShrank = false;
  let previousHazardTiles = 0;
  /** Frames the companion spent standing somewhere the fire was about to reach. */
  let companionInDangerFrames = 0;
  /**
   * The nearest a wall of fire ever got to the companion while she stood in a
   * column it was going to burn, in rows.
   */
  let closestDoomedApproach = Number.POSITIVE_INFINITY;
  /** How near a wall has to be for the handoff to be the thing being measured. */
  const HANDOFF_WINDOW_ROWS = 1;
  let handoffsMeasured = 0;
  let armedLastFrame = new Set<string>();
  /** The frame each armed orb was first seen on, keyed like `armedLastFrame`. */
  const orbArmedSinceFrame = new Map<string, number>();
  let landedOrbsMeasured = 0;
  let closestOrbImpactTiles = Number.POSITIVE_INFINITY;
  let laneOrdersChecked = 0;
  let laneOrdersIntoFire = 0;
  let worstHandoffColumns = 0;
  /** The tile the orb-bite probe parked the player on, once one was chosen. */
  /** The tile the fire-bite probe holds the player on, in the path of a wave, once one was chosen. */
  let fireBiteProbeTile: TilePos | null = null;
  let fireBiteProbeSettled = false;
  let fireBiteProbeBit = false;
  let orbBiteProbeTile: TilePos | null = null;
  let orbBiteProbeSettled = false;
  let orbBiteProbeBit = false;
  /**
   * Damage the companion took from the fight's own ground, by cause.
   *
   * Soul bolts are deliberately not counted. The companion is meant to be in
   * this fight and being shot at is what that costs; being cooked by a wall of
   * fire, flattened by an orb it was shown fifty frames of warning about, or
   * caught by a telegraphed cone is not.
   */
  const companionHazardDamage = new Map<string, number>();
  let firewallFramesCounted = 0;

  const hazardousTileCount = (battle: LichBattleSystem): number => {
    let count = 0;
    for (let row = 0; row < map.structure.length; row++) {
      for (let col = 0; col < map.structure[row].length; col++) {
        if (battle.getHazardEscapeVector(col * TILE_SIZE, row * TILE_SIZE) !== null) count++;
      }
    }
    return count;
  };

  /**
   * Whether the companion is standing in a column the very next wall to reach
   * her will burn.
   *
   * The *next* one, not any of them. Waves already south of her have swept by,
   * and a column that merely was on fire is the safest ground in the room; a
   * wave two walls back is a problem she has a full cadence to solve, and she is
   * deliberately parked on the edge of her lane nearest where that one's gap
   * will be. Counting either of those as danger measures the fight's design
   * rather than its safety.
   */
  /**
   * How far the companion still has to walk, in columns, at the moment the wall
   * in front of her is about to pass — measured to the nearest column of the
   * *next* wall's gap, which is where she has to be standing when it arrives.
   *
   * This is the "waits until the last minute" complaint made into a number. She
   * always made it, because a wave cadence is long; what she did was stand dead
   * centre in her lane until the fire physically swept over her and then dart.
   * Waiting on the edge of the lane nearest where she is going next turns the
   * handoff into a step, and turns this number down with it.
   *
   * Null unless a wall is right on top of her and another is behind it, which is
   * the only moment the question means anything.
   */
  const companionHandoffDistance = (battle: LichBattleSystem): number | null => {
    const col = Math.round(cat.x / TILE_SIZE);
    const row = Math.round(cat.y / TILE_SIZE);
    const arriving = arrivingWaveFor(battle, row);
    if (arriving === null || row - arriving.row > HANDOFF_WINDOW_ROWS) return null;
    let following: { readonly gapStart: number; readonly row: number } | null = null;
    for (const wave of battle.liveWaves) {
      if (wave.row >= arriving.row) continue;
      if (following === null || wave.row > following.row) following = wave;
    }
    if (following === null) return null;
    const lowest = following.gapStart;
    const highest = following.gapStart + FIREWALL_GAP_WIDTH_TILES - 1;
    if (col >= lowest && col <= highest) return 0;
    return col < lowest ? lowest - col : col - highest;
  };

  const companionRowsOfWarning = (battle: LichBattleSystem): number | null => {
    const col = Math.round(cat.x / TILE_SIZE);
    const row = Math.round(cat.y / TILE_SIZE);
    const arriving = arrivingWaveFor(battle, row);
    if (arriving === null || !columnBurns(col, arriving.gapStart)) return null;
    return row - arriving.row;
  };

  /**
   * Swings at whatever the mob grid reports standing where the Lich is drawn.
   *
   * Through the grid rather than at the object directly, because that is how the
   * game finds a target: a mob moved without `mobGrid.move` keeps its hit-test
   * entry in the cell it left, and every swing aimed at where it is drawn misses.
   * A harness that held the reference would never notice.
   */
  const lichFoundInGrid = (): boolean => {
    if (lich === null) return false;
    const found = roster.grid.queryRect(
      lich.x - TILE_SIZE,
      lich.y - TILE_SIZE,
      TILE_SIZE * SWING_REACH_TILES,
      TILE_SIZE * SWING_REACH_TILES,
    );
    return found.includes(lich);
  };

  const swingAtLich = (): boolean => {
    if (lich === null || !lichFoundInGrid()) return false;
    lich.takeHit(harnessHit(human, HARNESS_HIT_DAMAGE, 'melee'));
    return true;
  };

  // A player walking somewhere on purpose does not walk into ground the fight
  // has marked. Stepping blind, the harness walked into the next wave as often
  // as the waves caught it, and every reset it cost was charged to the fight.
  const stepToward = (targetX: number, targetY: number): void => {
    const dx = targetX - human.x;
    const dy = targetY - human.y;
    const length = Math.hypot(dx, dy);
    if (length < PLAYER_SPEED) return;
    const battle = ritual.lichBattle;
    const fromX = human.x;
    const fromY = human.y;
    const wasMarked = (battle?.getHazardEscapeVector(fromX, fromY) ?? null) !== null;
    stepAlong(dx / length, dy / length);
    const nowMarked = (battle?.getHazardEscapeVector(human.x, human.y) ?? null) !== null;
    if (!wasMarked && nowMarked) {
      human.x = fromX;
      human.y = fromY;
    }
  };

  const stepAlong = (dx: number, dy: number): void => {
    const nextX = human.x + dx * PLAYER_SPEED;
    const nextY = human.y + dy * PLAYER_SPEED;
    // Axis by axis, so a diagonal into a corner still slides along the wall the
    // way `applyMovement` lets a real player slide.
    if (map.isWalkable(Math.round(nextX / TILE_SIZE), Math.round(human.y / TILE_SIZE), 'walker')) {
      human.x = nextX;
    }
    if (map.isWalkable(Math.round(human.x / TILE_SIZE), Math.round(nextY / TILE_SIZE), 'walker')) {
      human.y = nextY;
    }
  };

  for (framesSpent = 0; framesSpent < FIGHT_FRAME_BUDGET; framesSpent++) {
    if (lich === null) break;

    // The world is halted while a bark is on screen, and the only thing that
    // moves is the player turning the page.
    if (ritual.isDialogOpen) {
      // Once, before turning the first page: prove the fight holds still on its
      // own account rather than because the scene remembered to stop calling it.
      // The scene's early return is one list; the system's own guard is the
      // other, and the two have to agree.
      // Probed on every bark, and against state that *moves*. The firewall's
      // phase and objective line are constants for the whole phase, so comparing
      // only those was a probe that could not fail — a fight running underneath
      // the page would have looked identical. The wave list and the hazard field
      // both advance every frame the firewall is live, and the tantrum's
      // objective line carries a countdown.
      const beforeBark = describeFightState(ritual);
      for (let probe = 0; probe < BARK_HALT_PROBE_FRAMES; probe++) {
        ritual.update(context, CATTERY_STOREY);
      }
      barksProbed++;
      if (describeFightState(ritual) !== beforeBark) barkHaltBreaches++;
      // Every press the bark takes, same frame: each page's first press skips
      // the sentence reveal and only the second turns it — the harness has to
      // spend them all here or the reveal's own frames would leak into the
      // phase-timing budget below.
      let turnsSpent = 0;
      while (ritual.isDialogOpen && turnsSpent < BARK_MAX_TURNS) {
        ritual.advanceDialog();
        turnsSpent++;
      }
      barksRead++;
      continue;
    }

    // A hit that lands while the party is input-locked, on the first frame of
    // every scripted slide. Nothing about a player's input lock reaches the
    // companion's auto-fire or a damage-over-time already ticking, so this is
    // not a contrived case — it is what a real party with a burn on the boss
    // does every single time a phase changes. Banked and then spent by the
    // phase that opens, it skipped the entire firewall gauntlet.
    const lockRose = ritual.playerLocked && !wasPartyLocked;
    wasPartyLocked = ritual.playerLocked;
    if (lockRose && lich.isAlive) {
      // Measured across the call, not against maximum health: a poison tick has
      // the Lich below maximum from the first second, so "is it hurt?" is true
      // whether or not this blow ever connected.
      // Stood next to the Lich for the swing. The firewall refuses damage from
      // outside its strike range, so a blow thrown from wherever the crawler
      // happened to be when the phase flipped lands or misses on a coin toss —
      // and a miss makes this whole check vacuous while looking like a pass. The
      // slide that owns this frame overwrites the position on its next tick.
      human.x = lich.x + TILE_SIZE;
      human.y = lich.y;
      const hpBeforeBlow = lich.hp;
      lich.takeHit(harnessHit(human, HARNESS_HIT_DAMAGE, 'melee'));
      if (lich.hp < hpBeforeBlow) hitsLandedUnderLock++;
    }
    const battle = ritual.lichBattle;
    const lichHpAtFrameStart = lich.hp;
    const frameOpenedBound = battle?.phase === 'binding';
    if (battle !== null) {
      lastLiveBattle = battle;
      if (FAULT !== null && !faultInjected) {
        faultInjected = true;
        injectDriverFault(lich, battle);
      }
      const phase = battle.phase;
      battlePhaseThisFrame = phase;
      const isDazed = battle.objectiveLine.startsWith('The Lich is spent');
      dazedThisFrame = isDazed;
      if (isDazed) {
        dazeFramesSeen++;
        armedOrbsDuringDaze = Math.max(armedOrbsDuringDaze, battle.liveOrbThreatCount);
        // The daze is the one stretch of the phase the companion is supposed to
        // spend hitting the Lich. Every orb in the air has been defanged by now,
        // so a hazard vector here is the fight sending it to flee scenery.
        if (battle.getHazardEscapeVector(cat.x, cat.y) !== null) companionFledDuringDaze++;
      }
      if (lockRose && phase === 'firewall') firewallLocks++;
      // Once, on the first scripted slide: walk off the storey mid-slide, the
      // way a player standing on the stairs can. Only `update` advances a slide,
      // and `update` only runs on the storey the party is on — so without a
      // hand-off the input lock would be held for the rest of the building.
      // On the tantrum's entry slide, not the firewall's: the firewall's own
      // slide is what the phase-skip check upstream measures, and a probe that
      // called `leaveFloor` there would clear the hit bank itself and stand in
      // for the very code that check exists to test.
      if (lockRose && phase === 'tantrum' && !leaveFloorProbed) {
        leaveFloorProbed = true;
        ritual.leaveFloor(context);
        leaveFloorReleasedLock = !ritual.playerLocked;
        // Looked up, not struck: a blow here would be banked and then spent as
        // the firewall's own "the player reached it" transition, and the probe
        // would skip the phase it is standing in.
        leaveFloorKeptGrid = lichFoundInGrid();
      }
      // Locked frames counted too: the entry slide is exactly when an
      // un-parked companion is walking north into a room that is about to be on
      // fire, and excluding those frames excludes the thing the opening order
      // exists to prevent.
      if (phase === 'binding') {
        bindingFrames++;
        if (pillarsAtStart < 0) pillarsAtStart = battle.litPillars.size;
        const working = battle.channellingPillar;
        if (working !== null) catChannelFrames++;
        const carrierPillar = battle.carrierPillar;
        if (carrierPillar !== null) carrierPillarsSeen.add(carrierPillar);
        if (carrierPillar !== null && working === carrierPillar) carrierOnWorkedPillarFrames++;
        // The order, not where she ends up: her hazard escape rescues a
        // companion sent onto threatened ground, which is exactly what makes
        // the outcome a poor witness for whether the order was right.
        const spot = battle.companionSpotOrder;
        if (battle.companionHeldBack) companionHeldBackFrames++;
        else if (spot !== null) {
          const threatened =
            battle.getHazardEscapeVector(spot.col * TILE_SIZE, spot.row * TILE_SIZE) !== null;
          if (threatened) ordersOntoThreatenedGround++;
        }
      }
      if (battle.carrierStage === 'gone') carrierLeft = true;
      if (phase === 'firewall') {
        // The planner honouring a usability test is checked in isolation above.
        // This is the other half: that the fight hands it a correct one, on the
        // storey the player is actually standing in.
        const band = battle.waveBand;
        observedWaveBand = band;
        for (const wave of battle.liveWaves) {
          gapsInspected++;
          if (!gapStandableOnStorey(wave.gapStart, band)) unstandableGaps++;
        }
      }
      if (phase === 'firewall') {
        firewallFramesCounted++;
        // The directive is supposed to park the companion in the gap of the wave
        // that arrives *next*. When it points at the wrong wave's gap instead,
        // the companion spends the phase standing in a column that is about to
        // burn, which is what this counts.
        //
        // Measured against the waves themselves rather than through the escape
        // vector. The vector is what the companion is *told*, and reading the
        // instruction back is not a measurement of where it ends up standing —
        // it also fires a tile out from anything dangerous, by design, so a
        // companion doing exactly the right thing registers as being in danger.
        const rowsOfWarning = companionRowsOfWarning(battle);
        if (rowsOfWarning !== null) {
          companionInDangerFrames++;
          closestDoomedApproach = Math.min(closestDoomedApproach, rowsOfWarning);
        }
        // The order itself, not where she ends up. She ends up safe either way —
        // the hazard field rescues a companion sent to the wrong wave's gap —
        // so the outcome cannot tell a correct order from a rescued one.
        const ordered = battle.companionLaneOrder;
        const arriving = arrivingWaveFor(battle, Math.round(cat.y / TILE_SIZE));
        if (ordered !== null && arriving !== null) {
          laneOrdersChecked++;
          if (columnBurns(ordered, arriving.gapStart)) laneOrdersIntoFire++;
        }
        const handoff = companionHandoffDistance(battle);
        if (handoff !== null) {
          handoffsMeasured++;
          worstHandoffColumns = Math.max(worstHandoffColumns, handoff);
        }
      }
      if (phase === 'tantrum') {
        // An orb that never lands never leaves the floor either, so a rain that
        // stopped resolving shows up here as a hazard field that only ever
        // grows. Watching it shrink is the cheapest proof that impacts resolve.
        const hazardTiles = hazardousTileCount(battle);
        if (hazardTiles < previousHazardTiles) hazardFieldEverShrank = true;
        previousHazardTiles = hazardTiles;
      }
      if (phasesSeen[phasesSeen.length - 1] !== phase) phasesSeen.push(phase);
      framesInPhase.set(phase, (framesInPhase.get(phase) ?? 0) + 1);

      if (!ritual.playerLocked) {
        // A grounded Lich is charged, not danced around. The window is three
        // seconds long and it is the only one in the phase, so a player runs at
        // it and stops dodging — which is also what makes "everything still in
        // the air is defanged" a promise the harness can hold the fight to: any
        // orb that lands on it here would be felt.
        const escape = isDazed ? null : battle.getHazardEscapeVector(human.x, human.y);
        if (isDazed) stepToward(lich.x, lich.y);
        else if (escape !== null) stepAlong(escape.dx, escape.dy);
        else if (phase === 'firewall') {
          // A cautious opening: hold the back of the room and read a few waves
          // before committing to the walk. That is what a first-time player
          // does, and it is also what gives the companion-safety check below
          // enough of the phase to measure — a harness that sprints the
          // gauntlet is only ever exposed to two or three waves.
          if (firewallStartFrame < 0) firewallStartFrame = framesSpent;
          const watching = framesSpent - firewallStartFrame < FIREWALL_OBSERVE_FRAMES;
          if (watching) stepToward(human.x, southWallY);
          else stepToward(lich.x, lich.y);
        } else if (phase === 'tantrum') {
          // Kite a small ring around the room's middle rather than parking on
          // it. Standing still is not a dodge: one orb in three is aimed at the
          // tile the player is on, so a stationary target is hit every second
          // however wide the room is — and the ring keeps the harness near the
          // centre, which is where the daze it is working toward will land the
          // Lich. Each stream starts at its own point round the ring.
          const kiteTurns = framesSpent / TANTRUM_KITE_PERIOD_FRAMES + stream / WHOLE_FIGHT_STREAMS;
          const angle = kiteTurns * Math.PI * 2;
          stepToward(
            (roomCentreCol + Math.cos(angle) * TANTRUM_KITE_RADIUS_TILES) * TILE_SIZE,
            (roomCentreRow + Math.sin(angle) * TANTRUM_KITE_RADIUS_TILES) * TILE_SIZE,
          );
        } else stepToward(lich.x, lich.y);
      }

      // The whole daze requirement landed during the Lich's descent — one blow
      // per frame, while the system is early-returning through the scripted
      // slide and its phase logic is not running. A player who sprints in and
      // swings the moment the Lich touches down is doing exactly this, and a
      // fight that banked only the last of those blows would silently charge
      // them another ten-second dodge for hits they already landed.
      //
      // Ordinary swings are withheld for this first window, so those two blows
      // are the only thing that can end it and the check below cannot be
      // satisfied by a lucky swing after the descent.
      if (isDazed && firstDazeFrame < 0) firstDazeFrame = framesSpent;
      // One frame per blow, so the window is as many frames as the daze demands
      // blows. Named rather than reusing the hit count inline, because a frame
      // window and a hit count are different things that happen to be equal.
      const DESCENT_SCRIPT_FRAMES = DAZE_HITS_REQUIRED;
      const inDescentScript =
        firstDazeFrame >= 0 && framesSpent - firstDazeFrame < DESCENT_SCRIPT_FRAMES;
      const inFirstDazeWindow = isDazed && firstDazeFrame >= 0 && reckoningFrame < 0;
      if (inDescentScript) swingAtLich();
      if (phase === 'reckoning' && reckoningFrame < 0) reckoningFrame = framesSpent;

      if (swingCooldown > 0) swingCooldown--;
      const inStrikeRange =
        Math.hypot(human.x - lich.x, human.y - lich.y) / TILE_SIZE <= STRIKE_RANGE_TILES;
      const swings = phase === 'firewall' ? inStrikeRange : !inFirstDazeWindow;
      if (swingCooldown === 0 && swings) {
        swingCooldown = HARNESS_SWING_INTERVAL_FRAMES;
        if (swingAtLich()) swingsThatFoundTheLich++;
        else swingsThatMissedTheGrid++;
      }

      // Once, on purpose: while the cat works a pillar, stand the human in the
      // far corner, so the cat is much the nearer target, and watch the Lich
      // keep its back to her. A probe rather than a count, because with the
      // human fighting at its side the Lich would choose the human anyway,
      // and a rule that is never asked anything cannot fail.
      if (phase === 'binding' && !spareProbeSettled) {
        if (battle.channellingPillar === null) spareProbeFrames = 0;
        else {
          spareProbeFrames++;
          human.x = farCorner.col * TILE_SIZE;
          human.y = farCorner.row * TILE_SIZE;
          const settled = spareProbeFrames > SPARE_PROBE_SETTLE_FRAMES;
          if (settled && lich.currentTarget === cat) spareBreaches++;
          if (spareProbeFrames >= SPARE_PROBE_FRAMES) spareProbeSettled = true;
        }
      }

      // Once, on purpose: stand the player under a falling orb and hold them
      // there until it lands. Watching for a hit to happen by itself is not a
      // measurement — "nobody was hurt" is equally what a rain that stopped
      // dealing damage looks like, and it is exactly what this phase looked like
      // for as long as its only reliable victim was a companion that could not
      // dodge. Last in the frame so it outranks the steering above, which would
      // otherwise walk the player back off the tile it is being held on.
      if (phase === 'tantrum' && !isDazed && orbBiteProbeTile === null) {
        const [aimed] = battle.armedOrbTiles;
        if (aimed !== undefined) orbBiteProbeTile = aimed;
      }
      // How near an orb ever landed to the companion, in tiles. Hits alone make a
      // gate that can only see a regression once it is already fatal — and one
      // that has to get lucky with the fight's own randomness to see it at all.
      // A near miss is the same failure with the dice rolling the other way.
      const armedNow = new Set(battle.armedOrbTiles.map((tile) => `${tile.col},${tile.row}`));
      for (const key of armedNow) {
        if (!orbArmedSinceFrame.has(key)) orbArmedSinceFrame.set(key, framesSpent);
      }
      for (const key of armedLastFrame) {
        if (armedNow.has(key)) continue;
        const framesArmed = framesSpent - (orbArmedSinceFrame.get(key) ?? framesSpent);
        orbArmedSinceFrame.delete(key);
        // An orb leaves `armedOrbTiles` early when a daze defangs it mid-fall, and
        // the companion is right to stop avoiding it then. Counting that as a
        // landing measured her mid-retreat against an orb that could never land
        // armed — only one that ran its whole warning is a near miss.
        const ranFullWarning = framesArmed >= ORB_WARNING_FRAMES;
        if (!ranFullWarning) continue;
        const [col, row] = key.split(',').map(Number);
        landedOrbsMeasured++;
        closestOrbImpactTiles = Math.min(
          closestOrbImpactTiles,
          Math.hypot(Math.round(cat.x / TILE_SIZE) - col, Math.round(cat.y / TILE_SIZE) - row),
        );
      }
      armedLastFrame = armedNow;

      // Once, on purpose, the same for the fire: stand the player on a burning
      // column a couple of rows ahead of a wave and hold them there until it
      // has swept over. Counting burns that happen by themselves measures the
      // harness's misreads, and a party that reads the fire well would make a
      // fire that stopped burning look exactly like this one.
      if (phase === 'firewall' && fireBiteProbeTile === null) {
        const [wave] = battle.liveWaves;
        if (wave !== undefined) {
          const row = Math.round(wave.row) + FIRE_PROBE_ROWS_AHEAD;
          const standCol = Math.round(human.x / TILE_SIZE);
          let bestCol: number | null = null;
          for (let col = 0; col < (map.structure[row]?.length ?? 0); col++) {
            if (!columnBurns(col, wave.gapStart) || !map.isWalkable(col, row, 'walker')) continue;
            if (bestCol === null || Math.abs(col - standCol) < Math.abs(bestCol - standCol)) {
              bestCol = col;
            }
          }
          if (bestCol !== null) fireBiteProbeTile = { col: bestCol, row };
        }
      }
      const fireTile = fireBiteProbeTile;
      if (fireTile !== null && !fireBiteProbeSettled) {
        if (
          human.hp < human.maxHp &&
          companionHazardCause(human.lastDamageSource) === 'lichFirewall'
        ) {
          fireBiteProbeBit = true;
        }
        const waveStillComing = battle.liveWaves.some(
          (wave) =>
            columnBurns(fireTile.col, wave.gapStart) && Math.round(wave.row) <= fireTile.row,
        );
        if (fireBiteProbeBit || !waveStillComing || phase !== 'firewall') {
          fireBiteProbeSettled = true;
        } else {
          human.x = fireTile.col * TILE_SIZE;
          human.y = fireTile.row * TILE_SIZE;
        }
      }

      const probeTile = orbBiteProbeTile;
      if (probeTile !== null && !orbBiteProbeSettled) {
        // Damage the last frame's update dealt is still on the books here: the
        // pin that puts the party back on their feet runs after this block, so
        // reading health across a single frame of this loop would compare a
        // value with itself and never see a hit at all.
        if (human.hp < human.maxHp && companionHazardCause(human.lastDamageSource) === 'lichOrb') {
          orbBiteProbeBit = true;
        }
        const stillFalling = battle.armedOrbTiles.some(
          (tile) => tile.col === probeTile.col && tile.row === probeTile.row,
        );
        if (orbBiteProbeBit || !stillFalling) orbBiteProbeSettled = true;
        else {
          human.x = probeTile.col * TILE_SIZE;
          human.y = probeTile.row * TILE_SIZE;
        }
      }
    }

    // The party is not what is under test here: a run that ended because the
    // harness played badly would say nothing about whether the fight can be
    // finished, so both crawlers are kept on their feet. The damage is counted
    // before it is undone, though — pinning health to maximum and looking no
    // further made every "does this hazard still bite?" rule unobservable, and
    // the whole of the orb and wave damage model with it.
    // Read before the pin below undoes it. The companion's own share is taken
    // apart by cause, because the whole question the fight has to answer about
    // her is whether she keeps out of the ground it marks.
    const companionDamage = cat.maxHp - cat.hp;
    if (companionDamage > 0) {
      const cause = companionHazardCause(cat.lastDamageSource);
      if (cause !== null) {
        companionHazardDamage.set(cause, (companionHazardDamage.get(cause) ?? 0) + companionDamage);
      }
    }
    const partyDamage = human.maxHp - human.hp + (cat.maxHp - cat.hp);
    if (partyDamage > 0 && battlePhaseThisFrame !== null) {
      damageByPhase.set(
        battlePhaseThisFrame,
        (damageByPhase.get(battlePhaseThisFrame) ?? 0) + partyDamage,
      );
      if (dazedThisFrame) damageDuringDaze += partyDamage;
    }
    human.hp = human.maxHp;
    cat.hp = cat.maxHp;

    companion.update(context);
    mobLoop.update(context);
    ritual.update(context, CATTERY_STOREY);
    for (const mob of roster.mobs) mob.tickTimers();

    if (frameOpenedBound && lich.hp < lichHpAtFrameStart) {
      lichHpLostInBinding += lichHpAtFrameStart - lich.hp;
    }
    if (lichDefeatedAtFrame < 0 && !lich.isAlive) lichDefeatedAtFrame = framesSpent;
    if (phaseOf(progress) === 'aftermath') break;
  }
  mobLoop.dispose();
  console.log(
    `fight stream ${stream}: ${phasesSeen.join(' → ')} in ${framesSpent} frames ` +
      `(binding ${bindingFrames}, firewall ${framesInPhase.get('firewall') ?? 0}, tantrum ${framesInPhase.get('tantrum') ?? 0}), ` +
      `${pillarsAtStart} pillars lit, the carrier on ${[...carrierPillarsSeen].join('/') || 'none'}, ` +
      `the companion held off her pillar ${companionHeldBackFrames} frame(s); ` +
      `${barksRead} bark pages read, ${Math.max(0, firewallLocks - 1)} firewall reset(s); ` +
      `${landedOrbsMeasured} orbs landed, nearest ${closestOrbImpactTiles.toFixed(2)} tiles from the companion, ` +
      `who ended at (${cat.x.toFixed(1)}, ${cat.y.toFixed(1)}) px`,
  );

  check(
    lichDefeatedAtFrame >= 0,
    `the Lich survived ${FIGHT_FRAME_BUDGET} frames of being fought, so some phase cannot be left`,
  );
  check(
    phasesSeen.join(' → ') === 'binding → onslaught → firewall → tantrum → reckoning',
    `the fight ran through ${phasesSeen.join(' → ')}, not the binding and all four phases in order`,
  );

  // The binding, fought rather than visited.
  check(
    pillarsAtStart === TOWN_CAT_IDS.length,
    `${pillarsAtStart} pillars were lit with no cat let out, not ${TOWN_CAT_IDS.length}`,
  );
  check(
    bindingFrames >= BINDING_CHANNEL_FRAMES,
    `the binding lasted ${bindingFrames} frames, less than one pillar's ${BINDING_CHANNEL_FRAMES} frames of work — it was skipped, not fought`,
  );
  check(
    catChannelFrames >= BINDING_CHANNEL_FRAMES,
    `the cat worked a pillar for ${catChannelFrames} frames in all, less than the ${BINDING_CHANNEL_FRAMES} one pillar takes — she is not unbinding them`,
  );
  check(
    lichHpLostInBinding === 0,
    `the Lich lost ${lichHpLostInBinding} health while pillars of the circle were still lit — the circle does not shield it`,
  );
  check(
    carrierPillarsSeen.size === 1,
    `the carrier came for ${carrierPillarsSeen.size} pillar(s) over the binding, not one`,
  );
  check(carrierLeft, 'the carrier never flew back out of the observatory window');
  check(
    carrierOnWorkedPillarFrames === 0,
    `the carrier was on the pillar the cat was working for ${carrierOnWorkedPillarFrames} frame(s)`,
  );
  check(
    ordersOntoThreatenedGround === 0,
    `the companion was ordered onto a channel spot the hazard field marks on ${ordersOntoThreatenedGround} frame(s) — the order and the flee rule disagree about her pillar`,
  );
  check(
    spareProbeSettled,
    'the spare probe never ran its length, so the Lich was never asked to choose',
  );
  check(
    spareBreaches === 0,
    `the Lich turned on the cat working a pillar on ${spareBreaches} frame(s) while the human stood to be fought`,
  );
  check(barksRead > 0, 'no phase ever opened a bark, so the transition beats never played');
  check(leaveFloorProbed, 'the leave-floor probe never ran, so it proved nothing');
  check(
    leaveFloorReleasedLock,
    'walking off the storey mid-slide left the party input-locked, with nothing left running to release them',
  );
  check(
    leaveFloorKeptGrid,
    'walking off the storey mid-slide left the Lich in a stale mob-grid cell, where swings pass through it',
  );
  check(barksProbed > 0, 'the bark-halt probe never ran, so it proved nothing');
  check(
    barkHaltBreaches === 0,
    `the fight advanced under ${barkHaltBreaches} of ${barksProbed} barks — a phase was running beneath a page the player was still reading`,
  );
  check(
    hitsLandedUnderLock > 0,
    'no blow ever landed while the party was input-locked, so the phase-skip check below proved nothing',
  );
  check(firstDazeFrame >= 0, 'the Lich never dazed, so the daze-hit checks below proved nothing');
  check(
    swingsThatFoundTheLich > 0,
    'no swing ever found the Lich through the mob grid, so the grid checks below proved nothing',
  );
  check(
    swingsThatMissedTheGrid === 0,
    `${swingsThatMissedTheGrid} swing(s) aimed at where the Lich is drawn found nothing there — a system-driven move skipped the mob grid`,
  );
  check(
    hazardFieldEverShrank,
    'no orb warning was ever seen to leave the floor, so the rain accumulates instead of landing',
  );
  // A hazard that stopped hurting anybody is a hazard that stopped existing, and
  // nothing else in this gate would notice.
  check(
    fireBiteProbeSettled,
    'the fire-bite probe never resolved, so "the fire still bites" was never tested',
  );
  check(
    fireBiteProbeBit,
    'a wave swept over the player where they stood and cost them nothing — the fire does not bite',
  );
  check(
    (damageByPhase.get('tantrum') ?? 0) > 0,
    'no orb ever hurt anybody across the whole tantrum, so the rain does not bite',
  );
  // The other half of the same rule: an orb still falling when the Lich touches
  // down is defanged, so the window the player is being told to charge into
  // cannot cost them health on the way in.
  check(
    gapsInspected > 0,
    'no wave gap was ever inspected, so the standability check below proved nothing',
  );
  check(
    unstandableGaps === 0,
    `${unstandableGaps} of ${gapsInspected} inspected wave gaps sat on ground the player cannot stand on — the safe column is masonry`,
  );
  // The birth-row search and the planner's usability test do different jobs, and
  // both are needed. The search moves waves below the pillars so the gap can
  // wander the whole room; the test still refuses the outermost columns, whose
  // notched corners never clear at any birth row. Counting how many of the
  // room's columns the test has to refuse is what proves it is load-bearing
  // rather than decorative.
  check(
    observedWaveBand !== null,
    'the wave band was never observed, so the standability checks proved nothing',
  );
  if (observedWaveBand !== null) {
    let refusedCandidates = 0;
    for (
      let gapStart = ROOM_MIN_COL;
      gapStart <= ROOM_MAX_COL - CONTRACT.gapWidthTiles + 1;
      gapStart++
    ) {
      if (!gapStandableOnStorey(gapStart, observedWaveBand)) refusedCandidates++;
    }
    check(
      refusedCandidates > 0,
      'every column of the room is standable across the chosen wave band, so the usability test above was never the thing keeping a gap off masonry',
    );
    check(
      refusedCandidates <= MAX_REFUSED_GAP_COLUMNS,
      `${refusedCandidates} of the room's columns cannot host a gap across the wave band the fight chose (rows ${observedWaveBand.firstRow}–${observedWaveBand.lastRow}) — the waves are being born level with an obstruction, and the gap is penned into a fragment of the room`,
    );
  }

  check(dazeFramesSeen > 0, 'no daze frame was ever observed, so the checks below proved nothing');
  check(
    companionFledDuringDaze === 0,
    `the companion was told to run from a defanged orb on ${companionFledDuringDaze} frame(s) of the daze — the one window it is meant to spend engaging`,
  );
  check(
    armedOrbsDuringDaze === 0,
    `${armedOrbsDuringDaze} orb(s) were still armed while the Lich was grounded — the window the player is told to charge into can cost them health on the way in`,
  );
  check(
    damageDuringDaze === 0,
    `the party took ${damageDuringDaze} damage during a daze window, when every orb still in the air is supposed to have been defanged`,
  );
  // A companion caught by a wall resets the gauntlet for a player who did
  // nothing wrong, so what matters is not whether she is ever in a burning
  // column — she has to cross several to reach each new gap — but how much room
  // she has left when she is. Measured as the nearest a wall ever got to her
  // while she stood in a column it was going to burn.
  //
  // The shipped fight leaves her the best part of a full wave cadence: she is
  // parked on the edge of her lane nearest the next gap before the current wall
  // has even reached her, and starts across the moment it clears. Parked in the
  // wrong wave's gap instead, this collapses to nothing — she is still standing
  // in the fire's own column when it arrives.
  const MIN_COMPANION_ROWS_OF_WARNING = 4;
  check(
    firewallFramesCounted > 0,
    'the firewall never ran a free frame, so the companion-safety check below measured nothing',
  );
  check(
    companionInDangerFrames > 0,
    'the companion was never once in a burning column, so the margin check below proved nothing — the harness is not watching the handoff at all',
  );
  check(
    closestDoomedApproach >= MIN_COMPANION_ROWS_OF_WARNING,
    `a wall of fire came within ${closestDoomedApproach.toFixed(1)} row(s) of the companion while she stood in a column it was about to burn (${MIN_COMPANION_ROWS_OF_WARNING} expected) — she is being left to cross too late`,
  );

  // The other half of the same complaint, and the half a player actually sees.
  // Being safe is not the same as looking like she meant it: parked dead centre
  // in her lane she cleared every wall, but only ever by standing still until
  // the fire swept over her and then darting sideways.
  //
  // Waiting on the edge of the lane nearest the next gap bounds the dart. A gap
  // moves at most FIREWALL_GAP_MAX_SHIFT_TILES between walls, and standing on
  // the near edge of a gap FIREWALL_GAP_WIDTH_TILES wide spends the width of it
  // in advance — so this is what the geometry allows, not a number read off a
  // passing run. From the centre it is the full shift.
  check(
    laneOrdersChecked > 0,
    'the fight never ordered the companion anywhere with a wall bearing down on her, so the order below was never checked',
  );
  check(
    laneOrdersIntoFire === 0,
    `the companion was ordered into a column the arriving wall burns on ${laneOrdersIntoFire} of ${laneOrdersChecked} frame(s) — the directive names the wrong wave's gap`,
  );

  const MAX_HANDOFF_COLUMNS = FIREWALL_GAP_MAX_SHIFT_TILES - (FIREWALL_GAP_WIDTH_TILES - 1);
  check(
    handoffsMeasured > 0,
    'no wall ever passed the companion with another behind it, so the handoff check below measured nothing',
  );
  check(
    worstHandoffColumns <= MAX_HANDOFF_COLUMNS,
    `the companion was still ${worstHandoffColumns} column(s) from the next gap as a wall passed her (at most ${MAX_HANDOFF_COLUMNS} expected) — she is not moving to the edge of her lane before the handoff`,
  );

  // The rule the player watches, rather than the geometry underneath it. The
  // companion is the one crawler nobody is steering, and every hazard this fight
  // puts down is one it has to read for itself: it burned in the fire, it stood
  // under the orbs until they killed it, and it fought the Lich from inside a
  // cone that takes forty percent of its health. A player cannot do anything
  // about any of that, which is what makes it the fight's problem and not
  // theirs.
  const companionHarm = [...companionHazardDamage.entries()]
    .map(([cause, amount]) => `${cause} ${amount}`)
    .join(', ');
  check(
    companionHazardDamage.size === 0,
    `the companion took damage from ground it was warned about (${companionHarm}) — it is not avoiding the fight's own hazards`,
  );
  // How near an orb ever landed to the companion, rather than whether one hit
  // her. A gate that only counts hits cannot see a regression until it is
  // already fatal, and has to get lucky with the fight's own randomness even
  // then — halving the keep-out put her back in the blast on one run in four,
  // which is a gate that passes three times out of four on broken code.
  //
  // The clearance is built from what it has to survive rather than read off a
  // passing run: the blast itself, plus the whole tile the separation that keeps
  // crawlers out of mobs can shove her in a single frame, plus the tile a
  // diagonal rounding flip can cost on top of it. She ends up parked on exactly
  // this line — the fight's own keep-out is the same sum — so the measured
  // figure sits just above it and a shortened keep-out falls straight through.
  const SEPARATION_SHOVE_TILES = 1;
  const TILE_ROUNDING_TILES = 1;
  const MIN_ORB_IMPACT_CLEARANCE_TILES =
    ORB_IMPACT_RADIUS_TILES + SEPARATION_SHOVE_TILES + TILE_ROUNDING_TILES;
  check(
    landedOrbsMeasured > 0,
    'no orb was ever seen to land, so the clearance check below measured nothing',
  );
  check(
    closestOrbImpactTiles >= MIN_ORB_IMPACT_CLEARANCE_TILES,
    `an orb landed ${closestOrbImpactTiles.toFixed(2)} tiles from the companion (${MIN_ORB_IMPACT_CLEARANCE_TILES.toFixed(2)} expected) — she is dodging by luck rather than by margin`,
  );
  check(
    orbBiteProbeSettled,
    'the orb-bite probe never resolved, so "the rain still bites" was never tested',
  );
  check(
    orbBiteProbeBit,
    'an orb landed on the player where they stood and cost them nothing — the rain does not bite',
  );

  // A bound with headroom rather than an exact expectation: each stream replays
  // exactly, but the companion's own rolls differ between streams, and so does
  // how often the party is caught. More resets than this means the gauntlet got
  // harder to survive, which is the one thing this phase is not allowed to do
  // quietly.
  const MAX_FIREWALL_RESETS = 3;
  const firewallResets = Math.max(0, firewallLocks - 1);
  check(
    firewallResets <= MAX_FIREWALL_RESETS,
    `the firewall stage reset ${firewallResets} times in one run (at most ${MAX_FIREWALL_RESETS} expected) — somebody is being parked in the fire`,
  );
  // Bounded by the descent, not by the whole daze window: a bound as loose as
  // `DAZE_FRAMES` is satisfied by the poison tick that lands halfway through it,
  // which is not the thing under test. Paying out on the first frame after the
  // Lich touches down is the only way both descent blows can have counted.
  const DAZE_PAYOUT_MARGIN_FRAMES = 4;
  const dazePayoutFrames = reckoningFrame - firstDazeFrame;
  check(
    reckoningFrame > firstDazeFrame &&
      dazePayoutFrames <= PUSH_SLIDE_FRAMES + DAZE_PAYOUT_MARGIN_FRAMES,
    `every required hit landed during the first daze's ${PUSH_SLIDE_FRAMES}-frame descent, but reckoning took ${dazePayoutFrames} frames to arrive — blows landed while the descent was playing were not all counted`,
  );

  // Visiting a phase is not fighting it. The firewall in particular can be
  // skipped in a single frame by a blow banked before it opened — a companion's
  // missile or a burn tick landing during the entry slide — and a check that
  // only looked at the order of phases would call that a complete fight.
  const firewallFrames = framesInPhase.get('firewall') ?? 0;
  const tantrumFrames = framesInPhase.get('tantrum') ?? 0;
  check(
    firewallFrames >= FIREWALL_WAVE_INTERVAL_FRAMES,
    `the firewall lasted ${firewallFrames} frames, less than the ${FIREWALL_WAVE_INTERVAL_FRAMES} it takes to send one wave — the gauntlet was skipped, not fought`,
  );
  check(
    tantrumFrames >= DODGE_SURVIVAL_FRAMES,
    `the tantrum lasted ${tantrumFrames} frames, less than the ${DODGE_SURVIVAL_FRAMES} of clean dodging its daze is supposed to cost`,
  );
  const finalPhase = phaseOf(progress);
  check(
    finalPhase === 'aftermath',
    `the questline is at "${finalPhase}" after the Warden fell, not "aftermath"`,
  );
  check(
    rig.fallenHookRuns() === 1,
    `the aftermath hook ran ${rig.fallenHookRuns()} times after the Warden fell, not once`,
  );
  const finaleStems = rig.claims
    .filter((claim) => claim.owner === 'tower_finale')
    .map((claim) =>
      claim.selection.kind === 'stems' ? claim.selection.stem : claim.selection.kind,
    );
  // The leave-floor probe walks off the storey and the fight plays on as if
  // the party came straight back, which claims the full mix again.
  const expectedStems = [
    'warden_ritual_battle_bound',
    'warden_ritual_battle',
    ...(leaveFloorProbed ? ['warden_ritual_battle'] : []),
  ];
  check(
    finaleStems.join(',') === expectedStems.join(','),
    `the fight claimed ${finaleStems.join(', ') || 'nothing'}, not the bound stem, then the full mix once the circle broke${leaveFloorProbed ? ', then the full mix again on coming back up' : ''}`,
  );
  check(
    rig.releases.includes('tower_finale'),
    'the fight never let its music go after the Warden fell',
  );
  check(
    ritual.lichBattle === null,
    'the battle system outlived the fight, so its hazards are still registered with the companion',
  );

  // Nothing the fight put in the air may still be there. The hazard oracle is
  // the public surface for that — it answers non-null for any tile standing in
  // fire or under an impact circle — so a sweep of every tile in the room that
  // comes back empty is the cleanup contract, tested rather than asserted.
  check(
    lastLiveBattle !== null,
    'the harness never captured the battle system, so the cleanup sweep below would measure nothing',
  );
  if (lastLiveBattle !== null) {
    let hazardousTiles = 0;
    for (let row = 0; row < map.structure.length; row++) {
      for (let col = 0; col < map.structure[row].length; col++) {
        if (lastLiveBattle.getHazardEscapeVector(col * TILE_SIZE, row * TILE_SIZE) !== null) {
          hazardousTiles++;
        }
      }
    }
    check(
      hazardousTiles === 0,
      `${hazardousTiles} tile(s) still report a live hazard after the fight ended`,
    );
  }
}

// ─────────────────────────────────────── report

if (failures.length > 0) {
  if (FAULT !== null) console.error(`fault injected: ${FAULT}`);
  console.error(`verify:lich — ${failures.length} failure(s)\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

if (FAULT !== null) console.log(`fault injected: ${FAULT}`);
console.log(
  `verify:lich — all checks passed (${WAVES_SAMPLED} waves, ${ORB_FRAMES_SAMPLED} orb-rain frames, the binding and every phase over ${WHOLE_FIGHT_STREAMS} streams)`,
);
