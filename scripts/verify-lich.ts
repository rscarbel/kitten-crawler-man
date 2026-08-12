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
 * Every check below was negative-tested during development by mutating the rule
 * it measures and confirming the gate went red. Where a check depends on a
 * lookup — a phase name, a room, a neighbour set — the lookup failing is itself
 * a failure, never a skip: a gate that goes quiet when it cannot find what it
 * measures reports "all passed" while measuring nothing.
 *
 * Run: npx tsx scripts/verify-lich.ts
 */

import { readFileSync } from 'node:fs';

import { loadGameSpritesInNode } from './nodeCanvasGlobals';
import { CORE_SFX_IDS, sfxGroupsForLevelId } from '../src/audio/sfxGroups';
import { GameMap, TOWER_FLOOR_COUNT } from '../src/map/GameMap';
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import type { Mob } from '../src/creatures/Mob';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import { SpellSystem } from '../src/systems/SpellSystem';
import { CompanionSystem } from '../src/systems/CompanionSystem';
import { QuillConfrontationSystem } from '../src/systems/QuillConfrontationSystem';
import { PUSH_SLIDE_FRAMES, type LichBattleSystem } from '../src/systems/LichBattleSystem';

/** The rows a wave crosses, as `LichBattleSystem` reports them. */
type LichWaveBand = { readonly firstRow: number; readonly lastRow: number };
import {
  createMurderQuestProgress,
  type MurderQuestProgress,
  type MurderQuestStage,
} from '../src/core/MurderQuestProgress';
import { createDoomsdayProgress } from '../src/core/DoomsdayProgress';
import { partyLevelOf } from '../src/levels/spawner';
import { makeSepsis } from '../src/core/StatusEffect';
import type { SystemContext } from '../src/systems/GameSystem';
import type { DamageSource } from '../src/Player';
import {
  canHoldGap,
  columnBurns,
  DAZE_FRAMES,
  DAZE_HITS_REQUIRED,
  DODGE_SURVIVAL_FRAMES,
  FIREWALL_GAP_MAX_SHIFT_TILES,
  FIREWALL_GAP_WIDTH_TILES,
  FIREWALL_TRIGGER_HP_FRACTION,
  FIREWALL_WAVE_INTERVAL_FRAMES,
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
/** The floor the murder questline and its tower live on. */
const MURDER_QUEST_LEVEL_ID = 'level3';
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
// A room is not a rectangle. The magistrate's office has pillars in it and its
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
  const ORDER: ReadonlyArray<LichBattlePhase> = ['onslaught', 'firewall', 'tantrum', 'reckoning'];
  const rankOf = (phase: LichBattlePhase): number => {
    const rank = ORDER.indexOf(phase);
    // An unrecognised phase is a rule that grew a state this gate does not know
    // about, which is exactly when a silent skip would be worst.
    if (rank < 0)
      failures.push(`unknown phase "${phase}" — this gate's phase order is out of date`);
    return rank;
  };

  const machine = new LichPhaseMachine();
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

/**
 * Everything about the fight that a running frame would change.
 *
 * Compared as a string across a stretch of forced updates: if any of it moves
 * while a bark is on screen, the world was not held. Deliberately includes the
 * things that advance *within* a phase — a phase name alone is a constant, and
 * comparing constants is how a probe passes without measuring anything.
 */
function describeFightState(confrontation: QuillConfrontationSystem): string {
  const battle = confrontation.lichBattle;
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

/**
 * Reads the questline's stage opaquely.
 *
 * Through a call rather than off the field, because the compiler narrows the
 * field to the literal the harness assigned and then rejects a comparison
 * against the stage the fight is supposed to reach as unreachable — which is
 * exactly the transition under test.
 */
function stageOf(progress: MurderQuestProgress): MurderQuestStage {
  return progress.stage;
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
  const FIGHT_SOURCES = [
    'src/systems/LichBattleSystem.ts',
    'src/systems/QuillConfrontationSystem.ts',
  ];
  const PLAY_CALL = /\baudio\??\.play\(\s*'([a-z0-9_]+)'/g;
  const loadedOnFloorThree = new Set<string>([
    ...sfxGroupsForLevelId(MURDER_QUEST_LEVEL_ID),
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

// ─────────────────────────────────────── 8: the whole fight, end to end
//
// Every check above measures one rule in isolation. This one plays the
// encounter: a party walks into the magistrate's office, fights the Lich
// through all four phases under the same gates a real player is held to — the
// firewall's two-tile strike range, the tantrum's dodge clock, the daze count —
// and the run is only green if the fight can actually be finished. A phase
// nobody can leave is the one failure the isolated rules cannot see.

{
  await loadGameSpritesInNode();

  // Derived, not written down: the confrontation lives on the tower's last
  // storey, and a gate that hardcoded the number would quietly generate and
  // measure a different room the day the tower grew a floor.
  const TOWER_TOP_FLOOR = TOWER_FLOOR_COUNT - 1;
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior('tower', TOWER_TOP_FLOOR, 'Town Center Tower', false);

  const arrival = map._interiorStairDownTiles[0] ?? map.startTile;
  const human = new HumanPlayer(arrival.x, arrival.y + 1, TILE_SIZE);
  const cat = new CatPlayer(arrival.x + 1, arrival.y + 1, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;

  const roster = new MobRoster(map, new SpellSystem());
  const spawned: Mob[] = [];
  const progress = createMurderQuestProgress();
  // Straight into the Lich: Miss Quill's half of the room is the same fight it
  // has always been, and it has its own coverage in `verify:interiors`.
  progress.stage = 'quill_slain';
  const doomsday = createDoomsdayProgress();
  const companion = new CompanionSystem(map, arrival.x, arrival.y);
  const confrontation = new QuillConfrontationSystem(
    map,
    new EventBus(),
    (mob) => {
      spawned.push(mob);
      roster.add(mob);
    },
    progress,
    null,
    doomsday,
    partyLevelOf(human.level, cat.level),
    companion,
  );

  const lich = spawned.find((mob) => mob.displayName === 'The Lich') ?? null;
  check(lich !== null, 'the confrontation puts the Lich in the room');

  // A permanent damage-over-time, applied before the first phase change and
  // never removed. This is the shape of the worst thing a real build can do to
  // this fight: a DoT ticks through the scripted slides that open every phase,
  // where the player has no control and the phase logic is not running. Without
  // it the harness plays too politely to ever land a blow in one of those
  // windows, and the checks below would pass without ever being tested.
  if (lich !== null) lich.applyStatus(makeSepsis(human));

  const context: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
  };
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
  /** Frames of update pushed at the fight with a bark up — a phase clock would move. */
  const BARK_HALT_PROBE_FRAMES = 120;
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
        if (!map.isWalkable(col, row)) return false;
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
  let landedOrbsMeasured = 0;
  let closestOrbImpactTiles = Number.POSITIVE_INFINITY;
  let laneOrdersChecked = 0;
  let laneOrdersIntoFire = 0;
  let worstHandoffColumns = 0;
  /** The tile the orb-bite probe parked the player on, once one was chosen. */
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
    lich.takeDamageFrom(HARNESS_HIT_DAMAGE, human, 'melee');
    return true;
  };

  const stepToward = (targetX: number, targetY: number): void => {
    const dx = targetX - human.x;
    const dy = targetY - human.y;
    const length = Math.hypot(dx, dy);
    if (length < PLAYER_SPEED) return;
    stepAlong(dx / length, dy / length);
  };

  const stepAlong = (dx: number, dy: number): void => {
    const nextX = human.x + dx * PLAYER_SPEED;
    const nextY = human.y + dy * PLAYER_SPEED;
    // Axis by axis, so a diagonal into a corner still slides along the wall the
    // way `applyMovement` lets a real player slide.
    if (map.isWalkable(Math.round(nextX / TILE_SIZE), Math.round(human.y / TILE_SIZE))) {
      human.x = nextX;
    }
    if (map.isWalkable(Math.round(human.x / TILE_SIZE), Math.round(nextY / TILE_SIZE))) {
      human.y = nextY;
    }
  };

  for (framesSpent = 0; framesSpent < FIGHT_FRAME_BUDGET; framesSpent++) {
    if (lich === null) break;

    // The world is halted while a bark is on screen, and the only thing that
    // moves is the player turning the page.
    if (confrontation.isDialogOpen) {
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
      const beforeBark = describeFightState(confrontation);
      for (let probe = 0; probe < BARK_HALT_PROBE_FRAMES; probe++) {
        confrontation.update(context);
      }
      barksProbed++;
      if (describeFightState(confrontation) !== beforeBark) barkHaltBreaches++;
      confrontation.advanceDialog();
      barksRead++;
      continue;
    }

    // A hit that lands while the party is input-locked, on the first frame of
    // every scripted slide. Nothing about a player's input lock reaches the
    // companion's auto-fire or a damage-over-time already ticking, so this is
    // not a contrived case — it is what a real party with a burn on the boss
    // does every single time a phase changes. Banked and then spent by the
    // phase that opens, it skipped the entire firewall gauntlet.
    const lockRose = confrontation.playerLocked && !wasPartyLocked;
    wasPartyLocked = confrontation.playerLocked;
    if (lockRose && lich.isAlive) {
      // Measured across the call, not against maximum health: a sepsis tick has
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
      lich.takeDamageFrom(HARNESS_HIT_DAMAGE, human, 'melee');
      if (lich.hp < hpBeforeBlow) hitsLandedUnderLock++;
    }
    const battle = confrontation.lichBattle;
    if (battle !== null) {
      lastLiveBattle = battle;
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
        confrontation.leaveFloor(context);
        leaveFloorReleasedLock = !confrontation.playerLocked;
        // Looked up, not struck: a blow here would be banked and then spent as
        // the firewall's own "the player reached it" transition, and the probe
        // would skip the phase it is standing in.
        leaveFloorKeptGrid = lichFoundInGrid();
      }
      // Locked frames counted too: the entry slide is exactly when an
      // un-parked companion is walking north into a room that is about to be on
      // fire, and excluding those frames excludes the thing the opening order
      // exists to prevent.
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

      if (!confrontation.playerLocked) {
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
          // Lich.
          const angle = (framesSpent / TANTRUM_KITE_PERIOD_FRAMES) * Math.PI * 2;
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
      for (const key of armedLastFrame) {
        if (armedNow.has(key)) continue;
        const [col, row] = key.split(',').map(Number);
        landedOrbsMeasured++;
        closestOrbImpactTiles = Math.min(
          closestOrbImpactTiles,
          Math.hypot(Math.round(cat.x / TILE_SIZE) - col, Math.round(cat.y / TILE_SIZE) - row),
        );
      }
      armedLastFrame = armedNow;

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
    confrontation.update(context);
    for (const mob of roster.mobs) mob.tickTimers();

    if (lichDefeatedAtFrame < 0 && !lich.isAlive) lichDefeatedAtFrame = framesSpent;
    if (stageOf(progress) === 'lich_slain') break;
  }
  mobLoop.dispose();
  console.log(
    `fight: ${phasesSeen.join(' → ')} in ${framesSpent} frames ` +
      `(firewall ${framesInPhase.get('firewall') ?? 0}, tantrum ${framesInPhase.get('tantrum') ?? 0}), ` +
      `${barksRead} bark pages read, ${Math.max(0, firewallLocks - 1)} firewall reset(s)`,
  );

  check(
    lichDefeatedAtFrame >= 0,
    `the Lich survived ${FIGHT_FRAME_BUDGET} frames of being fought, so some phase cannot be left`,
  );
  check(
    phasesSeen.join(' → ') === 'onslaught → firewall → tantrum → reckoning',
    `the fight ran through ${phasesSeen.join(' → ')}, not all four phases in order`,
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
    (damageByPhase.get('firewall') ?? 0) > 0,
    'the party crossed the whole firewall without a wave ever burning anybody, so the fire does not bite',
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

  // The shipped run costs exactly this many. The fight's own randomness is
  // seeded and the room is fixed, but this harness drives a real
  // `CompanionSystem`, which can reach unseeded randomness of its own — so this
  // is a bound with one reset of headroom rather than an exact expectation. A
  // third reset means the gauntlet got harder to survive, which is the one thing
  // this phase is not allowed to do quietly.
  const MAX_FIREWALL_RESETS = 3;
  const firewallResets = Math.max(0, firewallLocks - 1);
  check(
    firewallResets <= MAX_FIREWALL_RESETS,
    `the firewall stage reset ${firewallResets} times in one run (at most ${MAX_FIREWALL_RESETS} expected) — somebody is being parked in the fire`,
  );
  // Bounded by the descent, not by the whole daze window: a bound as loose as
  // `DAZE_FRAMES` is satisfied by the sepsis tick that lands halfway through it,
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
  const finalStage = stageOf(progress);
  check(
    finalStage === 'lich_slain',
    `the questline is at "${finalStage}" after the Lich fell, not "lich_slain"`,
  );
  check(
    doomsday.stage === 'containment',
    `the Doomsday chain is at "${doomsday.stage}" after the fight, not "containment"`,
  );
  check(doomsday.deadlineAt !== null, 'the containment deadline was never set');
  check(
    doomsday.crystalTile !== null,
    'the crystal was never placed, so there is nothing to contain',
  );
  check(
    confrontation.lichBattle === null,
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
  console.error(`verify:lich — ${failures.length} failure(s)\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log(
  `verify:lich — all checks passed (${WAVES_SAMPLED} waves, ${ORB_FRAMES_SAMPLED} orb-rain frames, full phase sweep)`,
);
