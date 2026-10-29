#!/usr/bin/env tsx
/**
 * Headless gate on the Wheel of Fortune engine (`src/systems/casino/wheel/`):
 * the board's red share and fixed wedges, the bet upgrades flipping one wedge
 * per step in order, once-won prizes never coming up again while staying on the
 * rim, Spin Again never retiring, landings that always sit inside the chosen
 * wedge, spin plans that come to rest exactly on that landing, the save
 * latch that stops every write once Permanent Death's wipe starts, and a quest's
 * free spin: Permanent Death unreachable through its whole Spin Again chain, the
 * spin spent with its commit, and the wheel back at the picker afterwards.
 *
 * Also the crawler mechanics the wheel's curses ride on: every status with an
 * incoming-damage scale scaling a mob blow and a status tick alike, a blow's
 * HP floor, and each HP band firing once on entry (a blow landing exactly on
 * its line included), never at 0 HP, and again only after HP climbs above it.
 *
 * Every random source is a seeded `mulberry32` stream, and the spin sims run
 * across many streams so one extra draw anywhere cannot reshuffle the verdict.
 *
 * Run: npm run verify:wheel
 */

import {
  BASE_WHEEL_BOARD,
  PERMANENT_RED_WEDGE_IDS,
  WHEEL_BETS,
  WHEEL_MAX_BET,
  WHEEL_MIN_BET,
  WHEEL_PRIZE_IDS,
  WHEEL_UPGRADES,
  boardForBet,
  boardUnits,
  isRedWedge,
  isWheelPrizeId,
  type WheelBoard,
  type WheelPrizeId,
  type WheelWedge,
} from '../src/systems/casino/wheel/wheelBoard';
import { outcomeWeights, pickOutcome } from '../src/systems/casino/wheel/wheelOutcome';
import {
  SPIN_MAX_DURATION_MS,
  SPIN_MIN_DURATION_MS,
  SPIN_MIN_EXTRA_TURNS,
  landingAngle,
  normalizeAngle,
  pegCrossings,
  planSpin,
  rotationForPointerAt,
  wedgeAtAngle,
  wedgeAtPointer,
  wedgeEndAngle,
  wedgeStartAngle,
} from '../src/systems/casino/wheel/wheelGeometry';
import { mulberry32, subSeed, type Rng } from '../src/sprites/person/rng';
import {
  ProgressPersistence,
  bootProgress,
  createSaveLatch,
  type OwedWipe,
  type WipeMarkerStore,
  writePathsThatEscapeTheLatch,
  type LatchedWritePath,
} from '../src/core/save/progressPersistence';
import { LOCAL_PROGRESS_STORAGE, writeLocalProgress } from '../src/core/save/LocalProgress';
import { stampGameProgress } from '../src/core/save/saveFormat';
import { AuthClient, type GameProgressInput } from '../src/auth/AuthClient';
import { restorePlayer, snapPlayer } from '../src/core/save/PlayerSnapshot';
import { parsePlayerSnapshot } from '../src/core/save/playerSnapshotFormat';
import { AbilityManager } from '../src/core/skills/AbilityManager';
import { AchievementManager } from '../src/core/progression/AchievementManager';
import { GameStats } from '../src/core/progression/GameStats';
import { createPartyCraftsState } from '../src/core/labour/partyCrafts';
import { createWheelQuestFreeSpins } from '../src/core/save/WheelLedger';
import { MusicLibrary } from '../src/core/music/MusicLibrary';
import {
  BLOOD_VOMIT_RETCH_FRAMES,
  DOUBLE_DAMAGE_FRAMES,
  DOUBLE_DAMAGE_SCALE,
} from '../src/core/combat/statusTuning';
import {
  BLOOD_VOMIT_STATUS,
  DOUBLE_DAMAGE_STATUS,
  INCURABLE_STATUSES,
  STATUS_DEFS,
  STATUS_IDS,
  makeBloodVomit,
  makeDoubleDamage,
  type StatusEffect,
} from '../src/core/combat/StatusEffect';
import type { ItemId } from '../src/core/items/defs/ItemDefs';
import { applyWheelPrize, type WheelPrizeTarget } from '../src/systems/casino/wheel/wheelPrizes';
import { WHEEL_DAMAGE_MAX_HP_SHARE } from '../src/systems/casino/wheel/wheelPenalties';
import { doubleDamageRemainingOf, withDoubleDamageFrames } from '../src/core/save/doubleDamageSave';
import { statusShowsHudPill } from '../src/sprites/status/statusEffectVisuals';
import {
  PERMANENT_DEATH_FIRST_LINE,
  PERMANENT_DEATH_SECOND_LINE,
} from '../src/ui/casino/wheel/permanentDeathView';
import { DONALD_LINES, donaldLinesFor } from '../src/dialog/scripts/donald';
import { PetNameBook, petWords } from '../src/core/party/petNames';
import { parsePlayerName } from '../src/core/naming/playerName';
import type { PlayerIdentity } from '../src/characters/playerIdentity';
import {
  CRAWLER_HP_THRESHOLDS,
  HP_THRESHOLD_IDS,
  hpThresholdTop,
} from '../src/core/combat/hpThresholds';
import { drainHpThresholdCrossings } from '../src/systems/hpThresholdCrossings';
import { drainBloodVomitRetches } from '../src/systems/bloodVomitRetches';
import { EventBus } from '../src/core/EventBus';
import type { DamageSource } from '../src/Player';
import { BOUNTY_MAX_BLOW_HP_SHARE } from '../src/creatures/mobLevelScaling';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { TILE_SIZE } from '../src/core/constants';
import { level1 } from '../src/levels/level1';
import { useDevPlayerIdentity } from '../src/dev/devPlayerIdentity';

useDevPlayerIdentity();

let failures = 0;

function check(condition: boolean, description: string): void {
  if (condition) {
    console.log(`  ok   ${description}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${description}`);
}

function runSection(title: string, body: () => void): void {
  console.log(`\n${title}`);
  body();
}

const BASE_SEED = 0x7e7e_0f0f;
const SIM_STREAMS = 12;
const SPINS_PER_STREAM = 1000;
const LANDING_DRAWS_PER_WEDGE = 400;
const SPIN_PLANS_PER_STREAM = 200;
const PLAN_SAMPLE_STEPS = 240;
const WEIGHT_DRAWS = 200_000;
/** Loose relative tolerance on observed pick shares; this checks weighting exists, not balance. */
const WEIGHT_SHARE_TOLERANCE = 0.25;
const ANGLE_EPSILON = 1e-9;
const FULL_TURN = Math.PI * 2;
/** The highest float `Math.random`-style sources can return. */
const RNG_CEILING = 1 - Number.EPSILON;

const BASE_RED_UNITS = 11;
/** The seven base good wedges plus the quarter-unit 500,000 sliver. */
const BASE_GOOD_UNITS = 7.25;
const BASE_SPIN_AGAIN_UNITS = 2;
/** Chance each prize starts a sim stream already won. */
const STARTS_WON_CHANCE = 0.5;
/** Chance per spin, once every prize is won, that the sim starts a fresh save. */
const FRESH_SAVE_CHANCE = 0.1;
/** How many times the average speed the opening speed must reach to read as a hard launch. */
const HARD_LAUNCH_FACTOR = 2;
const MAX_BET_RED_UNITS = 6;
const EXPECTED_UPGRADE_ORDER = [
  'set_on_fire',
  'frozen_solid',
  'robbed',
  'poisoned_2',
  'take_damage_2',
] as const;
const BIG_GOOD_PRIZES: readonly WheelPrizeId[] = ['gold_50k', 'legendary_weapon', 'gold_500k'];

// Salts keep every family of streams independent of the others.
const SIM_SALT = 100;
const LANDING_SALT = 2000;
const PLAN_SALT = 3000;
const WEIGHT_SALT = 4000;

function stream(salt: number): Rng {
  return mulberry32(subSeed(BASE_SEED, salt));
}

function unitsWhere(board: WheelBoard, keep: (wedge: WheelWedge) => boolean): number {
  return board.filter(keep).reduce((sum, wedge) => sum + wedge.units, 0);
}

function isGood(wedge: WheelWedge): boolean {
  return wedge.prizeId !== null;
}

function isNeutral(wedge: WheelWedge): boolean {
  return wedge.tone === 'neutral';
}

function neighbours(board: WheelBoard, index: number): readonly [WheelWedge, WheelWedge] {
  const before = board[(index - 1 + board.length) % board.length];
  const after = board[(index + 1) % board.length];
  return [before, after];
}

function checkBoard(): void {
  const board = boardForBet(WHEEL_MIN_BET);
  const total = boardUnits(board);
  const redUnits = unitsWhere(board, isRedWedge);
  check(
    redUnits === BASE_RED_UNITS &&
      unitsWhere(board, isGood) === BASE_GOOD_UNITS &&
      unitsWhere(board, isNeutral) === BASE_SPIN_AGAIN_UNITS,
    `minimum-bet board is ${BASE_RED_UNITS} red, ${BASE_GOOD_UNITS} good, 2 Spin Again and the 500,000 sliver (red ${redUnits} of ${total})`,
  );
  check(
    redUnits > total / 2,
    `red is more than half the units at the minimum bet (${redUnits} of ${total})`,
  );

  const ids = board.map((wedge) => wedge.id);
  check(new Set(ids).size === ids.length, 'every wedge face has a unique id');

  const goodBesideGood = board.filter(
    (wedge, index) => isGood(wedge) && neighbours(board, index).some(isGood),
  );
  check(
    goodBesideGood.length === 0,
    `no two good wedges sit side by side at the minimum bet${goodBesideGood.length === 0 ? '' : ` (${goodBesideGood.map((w) => w.id).join(', ')})`}`,
  );

  const deathIndex = board.findIndex((wedge) => wedge.prize.kind === 'permanent_death');
  const deathNeighbours = deathIndex < 0 ? [] : neighbours(board, deathIndex);
  check(
    deathNeighbours.some(
      (wedge) => wedge.prizeId !== null && BIG_GOOD_PRIZES.includes(wedge.prizeId),
    ),
    'one Permanent Death edge touches a big good prize',
  );

  const sliverIndex = board.findIndex((wedge) => wedge.prizeId === 'gold_500k');
  const sliverNeighbours = sliverIndex < 0 ? [] : neighbours(board, sliverIndex);
  check(
    sliverNeighbours.length === 2 &&
      sliverNeighbours.every((wedge) => wedge.prize.kind === 'spin_again'),
    'the 500,000 sliver sits between the two Spin Again wedges',
  );

  const prizeIdsOnBoards = [
    ...BASE_WHEEL_BOARD.flatMap((wedge) => (wedge.prizeId === null ? [] : [wedge.prizeId])),
    ...WHEEL_UPGRADES.flatMap((upgrade) =>
      upgrade.to.prizeId === null ? [] : [upgrade.to.prizeId],
    ),
  ];
  check(
    prizeIdsOnBoards.length === WHEEL_PRIZE_IDS.length &&
      WHEEL_PRIZE_IDS.every((id) => prizeIdsOnBoards.includes(id)),
    `every good prize (base, sliver and upgrades) carries exactly one once-only prize id (${prizeIdsOnBoards.length})`,
  );
  check(
    board.every((wedge) => (wedge.tone === 'red' || isNeutral(wedge)) === (wedge.prizeId === null)),
    'red and Spin Again wedges carry no prize id, so they never retire',
  );
}

function checkBets(): void {
  for (const bet of WHEEL_BETS) {
    const board = boardForBet(bet);
    const missing = PERMANENT_RED_WEDGE_IDS.filter((id) => {
      const baseIndex = BASE_WHEEL_BOARD.findIndex((wedge) => wedge.id === id);
      return baseIndex < 0 || board[baseIndex].id !== id || !isRedWedge(board[baseIndex]);
    });
    check(
      missing.length === 0 && board.length === BASE_WHEEL_BOARD.length,
      `bet ${bet}: Permanent Death, both Double Damage, first Take Damage and first Poisoned are red in place${missing.length === 0 ? '' : ` (missing ${missing.join(', ')})`}`,
    );
  }

  for (let step = 1; step < WHEEL_BETS.length; step++) {
    const below = boardForBet(WHEEL_BETS[step - 1]);
    const above = boardForBet(WHEEL_BETS[step]);
    const flipped = above.flatMap((wedge, index) => (wedge.id === below[index].id ? [] : [index]));
    const expectedFrom = EXPECTED_UPGRADE_ORDER[step - 1];
    const upgrade = WHEEL_UPGRADES[step - 1];
    const flippedIndex = flipped.length === 1 ? flipped[0] : -1;
    check(
      flipped.length === 1 &&
        flippedIndex === upgrade.wedgeIndex &&
        below[flippedIndex].id === expectedFrom &&
        isRedWedge(below[flippedIndex]) &&
        !isRedWedge(above[flippedIndex]) &&
        above[flippedIndex].units === below[flippedIndex].units,
      `bet ${WHEEL_BETS[step - 1]} → ${WHEEL_BETS[step]} flips exactly ${expectedFrom} in place (flipped ${flipped.length})`,
    );
  }

  const maxBoard = boardForBet(WHEEL_MAX_BET);
  const maxRed = unitsWhere(maxBoard, isRedWedge);
  check(
    maxRed === MAX_BET_RED_UNITS,
    `maximum bet leaves ${MAX_BET_RED_UNITS} units red (${maxRed})`,
  );
  check(
    WHEEL_UPGRADES.length === WHEEL_BETS.length - 1,
    'one upgrade per bet step above the minimum',
  );
}

function randomWonSet(rng: Rng): Set<WheelPrizeId> {
  return new Set(WHEEL_PRIZE_IDS.filter(() => rng() < STARTS_WON_CHANCE));
}

function checkPicks(): void {
  let spins = 0;
  let wonPicked = 0;
  let wonLeftBoard = 0;
  let spinAgainIneligible = 0;
  let redIneligible = 0;
  for (let streamIndex = 0; streamIndex < SIM_STREAMS; streamIndex++) {
    const rng = stream(SIM_SALT + streamIndex);
    let won = randomWonSet(rng);
    for (let spin = 0; spin < SPINS_PER_STREAM; spin++) {
      const bet = WHEEL_BETS[Math.floor(rng() * WHEEL_BETS.length)];
      const board = boardForBet(bet);
      const before = board.map((wedge) => wedge.id).join();
      const weights = outcomeWeights(board, won);
      board.forEach((wedge, index) => {
        if (wedge.prize.kind === 'spin_again' && weights[index] <= 0) spinAgainIneligible++;
        if (isRedWedge(wedge) && weights[index] <= 0) redIneligible++;
      });
      const outcome = pickOutcome(board, won, rng);
      spins++;
      if (outcome.wedge.prizeId !== null && won.has(outcome.wedge.prizeId)) wonPicked++;
      if (board.map((wedge) => wedge.id).join() !== before) wonLeftBoard++;
      if (outcome.wedge.prizeId !== null) won.add(outcome.wedge.prizeId);
      if (won.size === WHEEL_PRIZE_IDS.length && rng() < FRESH_SAVE_CHANCE) won = randomWonSet(rng);
    }
  }
  check(wonPicked === 0, `a won prize is never picked across ${spins} seeded spins (${wonPicked})`);
  check(wonLeftBoard === 0, 'picking never changes the board, so won wedges stay on the rim');
  check(spinAgainIneligible === 0, 'Spin Again is eligible on every spin');
  check(redIneligible === 0, 'red wedges are eligible on every spin');

  const allWon = new Set(WHEEL_PRIZE_IDS);
  const rng = stream(SIM_SALT - 1);
  let goodWithAllWon = 0;
  for (let spin = 0; spin < SPINS_PER_STREAM; spin++) {
    const outcome = pickOutcome(boardForBet(WHEEL_MAX_BET), allWon, rng);
    if (outcome.wedge.prizeId !== null) goodWithAllWon++;
  }
  check(goodWithAllWon === 0, 'with every prize won only red and Spin Again come up');

  const board = boardForBet(WHEEL_MIN_BET);
  const weightRng = stream(WEIGHT_SALT);
  const counts = board.map(() => 0);
  for (let draw = 0; draw < WEIGHT_DRAWS; draw++) {
    counts[pickOutcome(board, new Set(), weightRng).wedgeIndex]++;
  }
  const total = boardUnits(board);
  const offShare = board.filter((wedge, index) => {
    const expected = wedge.units / total;
    const observed = counts[index] / WEIGHT_DRAWS;
    return Math.abs(observed - expected) > expected * WEIGHT_SHARE_TOLERANCE;
  });
  check(
    offShare.length === 0,
    `picks are weighted by units across ${WEIGHT_DRAWS} draws${offShare.length === 0 ? '' : ` (off: ${offShare.map((w) => w.id).join(', ')})`}`,
  );
}

function strictlyInside(board: WheelBoard, index: number, angle: number): boolean {
  return (
    angle > wedgeStartAngle(board, index) &&
    angle < wedgeEndAngle(board, index) &&
    wedgeAtAngle(board, angle) === index
  );
}

function checkLandings(): void {
  let draws = 0;
  let outside = 0;
  for (const bet of WHEEL_BETS) {
    const board = boardForBet(bet);
    const rng = stream(LANDING_SALT + bet);
    board.forEach((_, index) => {
      for (let draw = 0; draw < LANDING_DRAWS_PER_WEDGE; draw++) {
        draws++;
        if (!strictlyInside(board, index, landingAngle(board, index, rng))) outside++;
      }
      for (const extreme of [0, RNG_CEILING]) {
        draws++;
        if (
          !strictlyInside(
            board,
            index,
            landingAngle(board, index, () => extreme),
          )
        )
          outside++;
      }
    });
  }
  check(
    outside === 0,
    `every landing angle is strictly inside its wedge (${outside} of ${draws} outside)`,
  );
}

function checkSpinPlans(): void {
  let plans = 0;
  let missed = 0;
  let notExact = 0;
  let backwards = 0;
  let outOfRange = 0;
  let softLaunch = 0;
  let tickMismatch = 0;
  for (let streamIndex = 0; streamIndex < SIM_STREAMS; streamIndex++) {
    const rng = stream(PLAN_SALT + streamIndex);
    let rotation = rng() * FULL_TURN;
    for (let spin = 0; spin < SPIN_PLANS_PER_STREAM; spin++) {
      const board = boardForBet(WHEEL_BETS[Math.floor(rng() * WHEEL_BETS.length)]);
      const outcome = pickOutcome(board, new Set(), rng);
      const landing = landingAngle(board, outcome.wedgeIndex, rng);
      const plan = planSpin(rotation, landing, rng);
      plans++;

      const finalRotation = plan.angleAt(plan.durationMs);
      if (wedgeAtPointer(board, finalRotation) !== outcome.wedgeIndex) missed++;
      const landedAt = normalizeAngle(finalRotation);
      const wanted = rotationForPointerAt(landing);
      const gap = Math.abs(landedAt - wanted);
      if (finalRotation !== plan.endRotation || Math.min(gap, FULL_TURN - gap) > ANGLE_EPSILON) {
        notExact++;
      }
      if (
        plan.durationMs < SPIN_MIN_DURATION_MS ||
        plan.durationMs > SPIN_MAX_DURATION_MS ||
        plan.endRotation - plan.startRotation < SPIN_MIN_EXTRA_TURNS * FULL_TURN
      ) {
        outOfRange++;
      }
      const averageVelocity = (plan.endRotation - plan.startRotation) / plan.durationMs;
      if (plan.velocityAt(0) <= averageVelocity * HARD_LAUNCH_FACTOR) softLaunch++;

      let previous = plan.angleAt(0);
      let ticks = 0;
      for (let step = 1; step <= PLAN_SAMPLE_STEPS; step++) {
        const now = plan.angleAt((plan.durationMs * step) / PLAN_SAMPLE_STEPS);
        if (now < previous) backwards++;
        ticks += pegCrossings(board, previous, now);
        previous = now;
      }
      if (ticks !== pegCrossings(board, plan.startRotation, plan.endRotation)) tickMismatch++;
      rotation = finalRotation;
    }
  }
  check(missed === 0, `every spin plan stops on the chosen wedge (${missed} of ${plans} missed)`);
  check(notExact === 0, `every spin plan ends exactly at its landing angle (${notExact} off)`);
  check(backwards === 0, 'the wheel never turns backwards during a spin');
  check(
    outOfRange === 0,
    `every spin lasts ${SPIN_MIN_DURATION_MS}–${SPIN_MAX_DURATION_MS} ms and makes at least ${SPIN_MIN_EXTRA_TURNS} full turns`,
  );
  check(softLaunch === 0, 'every spin launches hard, well above its average speed');
  check(tickMismatch === 0, 'clapper ticks summed frame by frame match the whole spin');
  const board = boardForBet(WHEEL_MIN_BET);
  check(
    pegCrossings(board, 0, FULL_TURN) === board.length,
    'one full turn passes every peg exactly once',
  );
}

class FakeLocalStorage implements Storage {
  private readonly items = new Map<string, string>();
  writes = 0;

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.writes++;
    this.items.set(key, value);
  }
}

/** Deletes that fail before the wipe's retry loop gets one through. */
const FAILED_DELETES_BEFORE_SUCCESS = 2;

function latchFixtureIdentity(): PlayerIdentity {
  const name = parsePlayerName('Sam');
  if (name === null) throw new Error('the fixture name is not a legal player name');
  return { name, body: 'male', complexion: 'light' };
}

function latchFixture(): GameProgressInput {
  return {
    levelId: level1.id,
    humanSnap: snapPlayer(new HumanPlayer(0, 0, TILE_SIZE)),
    catSnap: snapPlayer(new CatPlayer(0, 0, TILE_SIZE)),
    abilityStates: new AbilityManager().serializeStates(),
    deinonychusUnlocked: false,
    deinonychusPetHp: 0,
    deinonychusPetResting: false,
    crafts: createPartyCraftsState(),
    humanAchievements: new AchievementManager().serialize(),
    catAchievements: new AchievementManager().serialize(),
    gameStats: new GameStats().snapshot(),
    wheelPrizesWon: [],
    pendingWheelOutcome: null,
    wheelFreeSpinBet: null,
    wheelOwedFreeze: null,
    wheelQuestFreeSpins: createWheelQuestFreeSpins(),
    doubleDamageRemaining: { human: 0, cat: 0 },
    attackCowOwned: false,
    attackCowResting: false,
    musicLibrary: new MusicLibrary().serialize(),
    storyBeatsSeen: [],
    objectivesBriefed: [],
    petNames: {},
    playerIdentity: latchFixtureIdentity(),
  };
}

/**
 * Once `wipeAllProgress` starts, every save write path is a no-op: the
 * persistence the game boots with, `writeLocalProgress`, the local save slot
 * and `AuthClient.saveProgress`, each against fake storage. Each path is first
 * shown to reach storage before the wipe, so a path that never writes cannot
 * pass by accident. This engages the process-wide page latch, so it runs last.
 */
async function checkSaveLatchBlocksWritesAfterWipe(): Promise<void> {
  const fakeLocal = new FakeLocalStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: fakeLocal, configurable: true });
  let serverWrites = 0;
  const fakeFetch: typeof fetch = (_input, init) => {
    if (init?.method === 'POST') serverWrites++;
    return Promise.resolve(new Response(JSON.stringify({ ok: true })));
  };
  Object.defineProperty(globalThis, 'fetch', { value: fakeFetch, configurable: true });

  let slotWrites = 0;
  let deleteAttempts = 0;
  let latchedBeforeFirstDelete = false;
  const persistence = new ProgressPersistence(
    {
      write: () => {
        slotWrites++;
        return Promise.resolve();
      },
      remove: () => {
        if (deleteAttempts === 0) latchedBeforeFirstDelete = persistence.writesBlocked;
        deleteAttempts++;
        return deleteAttempts > FAILED_DELETES_BEFORE_SUCCESS
          ? Promise.resolve()
          : Promise.reject(new Error('fake delete failure'));
      },
    },
    { wait: () => Promise.resolve() },
  );
  const fixture = latchFixture();
  const server = new AuthClient();

  const paths: LatchedWritePath[] = [
    {
      label: 'ProgressPersistence.save',
      attempt: async () => {
        const before = slotWrites;
        await persistence.save(fixture);
        return slotWrites > before;
      },
    },
    {
      label: 'writeLocalProgress',
      attempt: () => {
        const before = fakeLocal.writes;
        writeLocalProgress(fixture);
        return Promise.resolve(fakeLocal.writes > before);
      },
    },
    {
      label: 'LOCAL_PROGRESS_STORAGE.write',
      attempt: async () => {
        const before = fakeLocal.writes;
        await LOCAL_PROGRESS_STORAGE.write(stampGameProgress(fixture));
        return fakeLocal.writes > before;
      },
    },
    {
      label: 'AuthClient.saveProgress',
      attempt: async () => {
        const before = serverWrites;
        await server.saveProgress(stampGameProgress(fixture));
        return serverWrites > before;
      },
    },
  ];

  const silentBeforeWipe: string[] = [];
  for (const path of paths) {
    if (!(await path.attempt())) silentBeforeWipe.push(path.label);
  }
  check(
    silentBeforeWipe.length === 0,
    `every write path reaches fake storage before the wipe${silentBeforeWipe.length === 0 ? '' : ` (silent: ${silentBeforeWipe.join(', ')})`}`,
  );

  const escaped = await writePathsThatEscapeTheLatch(persistence, paths);
  check(
    escaped.length === 0,
    `no write path reaches storage once the wipe starts${escaped.length === 0 ? '' : ` (escaped: ${escaped.join(', ')})`}`,
  );
  check(latchedBeforeFirstDelete, 'the latch is engaged before the first delete');
  check(
    persistence.wipeComplete && deleteAttempts === FAILED_DELETES_BEFORE_SUCCESS + 1,
    `the wipe retries failed deletes until one lands (${deleteAttempts} attempts)`,
  );
}

/**
 * A save already sent when the wipe starts must not outlive it: the delete
 * waits for that write to settle, so the slot ends empty even though the
 * write lands after the wipe began.
 */
async function checkInFlightSaveCannotResurrectWipe(): Promise<void> {
  let stored: unknown = null;
  let finishWrite: () => void = () => undefined;
  let removeCalledWhileWriteInFlight = false;
  let writeInFlight = false;
  const persistence = new ProgressPersistence(
    {
      write: (progress) => {
        writeInFlight = true;
        return new Promise<void>((resolve) => {
          finishWrite = () => {
            stored = progress;
            writeInFlight = false;
            resolve();
          };
        });
      },
      remove: () => {
        if (writeInFlight) removeCalledWhileWriteInFlight = true;
        stored = null;
        return Promise.resolve();
      },
    },
    { latch: createSaveLatch(), wait: () => Promise.resolve() },
  );
  const save = persistence.save(latchFixture());
  const wipe = persistence.wipe();
  finishWrite();
  await save;
  await wipe;
  check(!removeCalledWhileWriteInFlight, 'the wipe waits for a save already in flight');
  check(stored === null, 'a save in flight at the wipe does not survive it');
}

const EXPIRED_SESSION_ACCOUNT = { id: 'expired-session', label: 'crawler' } as const;

/**
 * A delete refused for an expired session asks the player to sign in rather
 * than retrying on a timer forever, and finishes once they have.
 */
async function checkAuthFailureAsksForSignIn(): Promise<void> {
  const authFailure = new Error('fake 401');
  let signedIn = false;
  let timedRetries = 0;
  let statusWhileSigningIn = '';
  const persistence = new ProgressPersistence(
    {
      write: () => Promise.resolve(),
      remove: () => (signedIn ? Promise.resolve() : Promise.reject(authFailure)),
    },
    {
      latch: createSaveLatch(),
      wait: () => {
        timedRetries++;
        return Promise.resolve();
      },
      isAuthFailure: (error) => error === authFailure,
      reauthenticate: () => {
        statusWhileSigningIn = persistence.wipeStatus;
        signedIn = true;
        return Promise.resolve(EXPIRED_SESSION_ACCOUNT);
      },
    },
  );
  await persistence.wipe();
  check(
    statusWhileSigningIn === 'signInRequired',
    `the wipe reports it needs a sign-in (${statusWhileSigningIn})`,
  );
  check(timedRetries === 0, 'an auth failure is not retried on a timer');
  check(persistence.wipeComplete, 'the wipe finishes once the player signs in');
}

/**
 * A sign-in the wipe asks for that comes back as another account is signed
 * out and asked again: the delete only ever runs as the account the wipe
 * started on, so nobody else's save is erased.
 */
async function checkWipeRefusesOtherAccount(): Promise<void> {
  const authFailure = new Error('fake 401');
  const owner = { id: 'owner', label: 'owner' };
  const stranger = { id: 'stranger', label: 'stranger' };
  const signInQueue = [stranger, owner];
  let session: string | null = null;
  const deletedAs: string[] = [];
  let signOuts = 0;
  const persistence = new ProgressPersistence(
    {
      write: () => Promise.resolve(),
      remove: () => {
        if (session === null) return Promise.reject(authFailure);
        deletedAs.push(session);
        return Promise.resolve();
      },
    },
    {
      latch: createSaveLatch(),
      wait: () => Promise.resolve(),
      isAuthFailure: (error) => error === authFailure,
      account: () => owner,
      reauthenticate: () => {
        const next = signInQueue.shift() ?? owner;
        session = next.id;
        return Promise.resolve(next);
      },
      signOut: () => {
        signOuts++;
        session = null;
        return Promise.resolve();
      },
    },
  );
  await persistence.wipe();
  check(
    deletedAs.length === 1 && deletedAs[0] === owner.id,
    `the wipe deletes only as the account it started on (${deletedAs.join(', ')})`,
  );
  check(
    signOuts === 1 && persistence.refusedOtherAccount,
    'a sign-in as another account is signed out and refused',
  );
  check(persistence.wipeAccountLabel === owner.label, 'the hold can name the account to sign in');
}

/**
 * The host's side of "reloading can never undo a spin": a held SPIN does one
 * save before the wheel turns, with the bet spent, the prize marked won and
 * the outcome pending; a refused save puts everything back and never turns
 * the wheel; and a pending outcome found on load is paid once.
 */
async function checkHostCommitsBeforeTurning(): Promise<void> {
  const { ClubWheelSystem, UNNAMED_WHEEL_PETS, WHEEL_SPIN_HOLD_MS } =
    await import('../src/systems/ClubWheelSystem');
  const { createWheelLedger } = await import('../src/core/save/WheelLedger');
  const { settleWheelLedger } = await import('../src/systems/casino/wheel/wheelPrizes');
  const { adoptWhenCommitted } = await import('../src/core/save/adoptWhenCommitted');
  const FILLER_ITEM = 'scrapmail_vest';
  const { BAG_PAGE_SLOTS } = await import('../src/core/items/defs/ItemDefs');
  const { FROZEN_STATUS } = await import('../src/core/combat/StatusEffect');
  const HOST_STEP_MS = 16;
  const HOST_PURSE = 10_000;
  const forcedPrize = 'gold_50k';

  const run = async (answer: 'saved' | 'failed') => {
    let now = 0;
    let saves = 0;
    let release: () => void = () => undefined;
    const human = new HumanPlayer(0, 0, TILE_SIZE);
    const cat = new CatPlayer(1, 0, TILE_SIZE);
    human.coins = HOST_PURSE;
    const seat = { active: () => human, companion: () => cat };
    const ledger = createWheelLedger();
    const wheel = new ClubWheelSystem({
      audio: null,
      audioScope: null,
      ledger,
      saveNow: () => {
        saves++;
        return new Promise((resolve) => {
          release = () => resolve(answer);
        });
      },
      progressWipe: null,
      afterPermanentDeath: () => undefined,
      grantAttackCow: () => undefined,
      pets: UNNAMED_WHEEL_PETS,
      clock: () => now,
      random: mulberry32(1),
      forcedOutcome: (board) => {
        const index = board.findIndex((wedge) => wedge.prizeId === forcedPrize);
        return index < 0 ? null : { wedgeIndex: index, wedge: board[index] };
      },
    });
    wheel.openWheelForReview(seat);
    wheel.holdSpinForReview();
    for (let t = 0; t <= WHEEL_SPIN_HOLD_MS; t += HOST_STEP_MS) {
      now += HOST_STEP_MS;
      wheel.update();
    }
    const waiting = wheel.phaseKind === 'committing';
    const pendingWhileSaving = ledger.pendingOutcome?.prizeId === forcedPrize;
    const markedWhileSaving = ledger.prizesWon.includes(forcedPrize);
    const spentWhileSaving = human.coins === HOST_PURSE - WHEEL_MIN_BET;
    release();
    await Promise.resolve();
    await Promise.resolve();
    now += HOST_STEP_MS;
    wheel.update();
    return {
      waiting,
      pendingWhileSaving,
      markedWhileSaving,
      spentWhileSaving,
      saves,
      wheel,
      ledger,
      human,
    };
  };

  const saved = await run('saved');
  check(saved.waiting, 'a completed hold waits on the save before the wheel turns');
  check(
    saved.pendingWhileSaving && saved.markedWhileSaving && saved.spentWhileSaving,
    'the save carries the bet spent, the prize marked won and the outcome pending',
  );
  check(saved.saves === 1, `one save before the wheel turns (saw ${saved.saves})`);
  check(saved.wheel.phaseKind === 'spinning', 'once the save lands, the wheel turns');

  const refused = await run('failed');
  check(refused.wheel.phaseKind === 'idle', 'a refused save never turns the wheel');
  check(
    refused.human.coins === HOST_PURSE &&
      !refused.ledger.prizesWon.includes(forcedPrize) &&
      refused.ledger.pendingOutcome === null,
    'a refused save gives the bet back and forgets the spin',
  );

  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(1, 0, TILE_SIZE);
  const before = human.coins;
  const owing = createWheelLedger(
    [forcedPrize],
    {
      wedgeId: forcedPrize,
      prizeId: forcedPrize,
      crawler: 'human',
      recipient: 'human',
      bet: WHEEL_MIN_BET,
      boardBet: WHEEL_MIN_BET,
    },
    null,
    'cat',
  );
  const paid = settleWheelLedger(owing, {
    human,
    cat,
    grantAttackCow: () => undefined,
  });
  check(
    paid?.id === forcedPrize && human.coins > before,
    'a pending outcome found on load is paid to the crawler who spun',
  );
  check(
    cat.hasStatus(FROZEN_STATUS) && owing.owedFreeze === null && owing.pendingOutcome === null,
    'a freeze still owed on load lands on its crawler, and the ledger is clear after',
  );

  // Spin Again's free spin survives the reload: a fresh wheel on the same ledger owes it.
  const again = await (async () => {
    let now = 0;
    const ledger = createWheelLedger();
    const spinner = new HumanPlayer(0, 0, TILE_SIZE);
    spinner.coins = HOST_PURSE;
    const seat = { active: () => spinner, companion: () => cat };
    const build = () =>
      new ClubWheelSystem({
        audio: null,
        audioScope: null,
        ledger,
        saveNow: () => Promise.resolve('saved'),
        progressWipe: null,
        afterPermanentDeath: () => undefined,
        grantAttackCow: () => undefined,
        pets: UNNAMED_WHEEL_PETS,
        clock: () => now,
        random: mulberry32(1),
      });
    const first = build();
    const board = boardForBet(WHEEL_MIN_BET);
    first.landForReview(
      seat,
      board.findIndex((wedge) => wedge.prize.kind === 'spin_again'),
    );
    const owed = ledger.freeSpinBet;
    const second = build();
    second.openWheelForReview(seat);
    second.holdSpinForReview();
    for (let t = 0; t <= WHEEL_SPIN_HOLD_MS; t += HOST_STEP_MS) {
      now += HOST_STEP_MS;
      second.update();
    }
    await Promise.resolve();
    await Promise.resolve();
    return { owed, spent: HOST_PURSE - spinner.coins, after: ledger.freeSpinBet };
  })();
  // Item prizes are paid into the bag the moment the wheel lands, never as a box to open later.
  const landed = (() => {
    const winner = new HumanPlayer(0, 0, TILE_SIZE);
    const seat = { active: () => winner, companion: () => cat };
    const wheel = new ClubWheelSystem({
      audio: null,
      audioScope: null,
      ledger: createWheelLedger(),
      saveNow: () => Promise.resolve('saved'),
      progressWipe: null,
      afterPermanentDeath: () => undefined,
      grantAttackCow: () => undefined,
      pets: UNNAMED_WHEEL_PETS,
      random: mulberry32(1),
    });
    const board = boardForBet(WHEEL_MIN_BET);
    const queuedBefore = winner.inventory.countOf('frostward_charm');
    wheel.landForReview(
      seat,
      board.findIndex((wedge) => wedge.prizeId === 'epic_charm_frost'),
    );
    return {
      gained: winner.inventory.countOf('frostward_charm') - queuedBefore,
    };
  })();
  check(landed.gained === 1, 'an Epic (frost) landing puts the ring in the bag at once');
  const loader = new HumanPlayer(0, 0, TILE_SIZE);
  const legendaryCharmLedger = createWheelLedger(['legendary_charm'], {
    wedgeId: 'legendary_charm',
    prizeId: 'legendary_charm',
    crawler: 'human',
    recipient: 'human',
    bet: WHEEL_MIN_BET,
    boardBet: WHEEL_MIN_BET,
  });
  const loadParty = {
    human: loader,
    cat,
    grantAttackCow: () => undefined,
  };
  settleWheelLedger(legendaryCharmLedger, loadParty);
  settleWheelLedger(legendaryCharmLedger, loadParty);
  check(
    loader.inventory.countOf('fae_iron_charm') === 1,
    'a pending item prize found on load goes into the bag exactly once',
  );
  // A Spin Again left pending by a closed tab owes its free spin on the board it turned on.
  const pendingAgain = createWheelLedger([], {
    wedgeId: 'spin_again_1',
    prizeId: null,
    crawler: 'human',
    recipient: 'human',
    bet: WHEEL_MAX_BET,
    boardBet: WHEEL_MAX_BET,
  });
  settleWheelLedger(pendingAgain, loadParty);
  check(
    pendingAgain.freeSpinBet === WHEEL_MAX_BET,
    `a pending Spin Again found on load owes its free spin on the same board (${String(pendingAgain.freeSpinBet)})`,
  );

  // A bag packed past its first page still takes the prize the moment the wheel lands.
  const packed = new HumanPlayer(0, 0, TILE_SIZE);
  for (let slot = 0; slot < BAG_PAGE_SLOTS; slot++) packed.inventory.addItem(FILLER_ITEM, 1);
  const packedLedger = createWheelLedger();
  const packedWheel = new ClubWheelSystem({
    audio: null,
    audioScope: null,
    ledger: packedLedger,
    saveNow: () => Promise.resolve('saved'),
    progressWipe: null,
    afterPermanentDeath: () => undefined,
    grantAttackCow: () => undefined,
    pets: UNNAMED_WHEEL_PETS,
    random: mulberry32(1),
  });
  packedWheel.landForReview(
    { active: () => packed, companion: () => cat },
    boardForBet(WHEEL_MIN_BET).findIndex((wedge) => wedge.prizeId === 'legendary_charm'),
  );
  check(
    packed.inventory.countOf('fae_iron_charm') === 1,
    'a prize won with a packed bag goes into the bag',
  );

  // A commit storage refused never becomes the save a death returns to.
  const adopted: string[] = [];
  await adoptWhenCommitted(
    Promise.resolve('failed'),
    () => true,
    () => adopted.push('failed'),
  );
  await adoptWhenCommitted(
    Promise.resolve('saved'),
    () => false,
    () => adopted.push('stale'),
  );
  await adoptWhenCommitted(
    Promise.resolve('saved'),
    () => true,
    () => adopted.push('saved'),
  );
  check(
    adopted.join(',') === 'saved',
    `only a committed, still-current save becomes the respawn point (${adopted.join(',') || 'none'})`,
  );

  check(again.owed === WHEEL_MIN_BET, 'a landed Spin Again writes its free spin into the ledger');
  check(
    again.spent === 0 && again.after === null,
    `a wheel built after a reload plays the owed free spin without a bet (spent ${again.spent})`,
  );
}

/**
 * A wipe the previous page left owed is finished at boot before anything is
 * loaded: the latch goes on first, the row still in storage is deleted, the
 * marker is cleared only after, and no save is handed back.
 */
async function checkOwedWipeFinishesBeforeAnyLoad(): Promise<void> {
  let markerState: OwedWipe | null = { account: null };
  const marker: WipeMarkerStore = {
    read: () => markerState,
    write: (owed) => {
      markerState = owed;
    },
    clear: () => {
      markerState = null;
    },
  };
  let row: unknown = latchFixture();
  let loads = 0;
  let deletedBeforeLoad = true;
  const markerWatch = { heldUntilDelete: true };
  const latch = createSaveLatch();
  const boot = await bootProgress({
    marker,
    latch,
    finishWith: (owed) =>
      new ProgressPersistence(
        {
          write: (progress) => {
            row = progress;
            return Promise.resolve();
          },
          remove: () => {
            if (markerState === null) markerWatch.heldUntilDelete = false;
            row = null;
            return Promise.resolve();
          },
        },
        { latch, owedAccount: owed.account, marker, wait: () => Promise.resolve() },
      ),
    load: () => {
      loads++;
      if (row !== null) deletedBeforeLoad = false;
      return Promise.resolve(row);
    },
  });
  check(boot.kind === 'wipeFinished', 'boot finishes an owed wipe instead of loading');
  check(loads === 0 && deletedBeforeLoad, 'no save is loaded while a wipe is owed');
  check(row === null, 'the row a previous page left is deleted at boot');
  check(latch.engaged, 'writes are latched while the owed wipe runs');
  check(
    markerWatch.heldUntilDelete && marker.read() === null,
    'the marker clears only once the delete lands',
  );
}

/**
 * An owed wipe whose session nobody could identify at boot asks the server
 * until it can say, and never deletes before then; a session that turns out
 * to be someone else's is signed out first.
 */
async function checkOwedWipeIdentifiesSessionFirst(): Promise<void> {
  const owner = { id: 'owner', label: 'owner' };
  const stranger = { id: 'stranger', label: 'stranger' };
  const identifyFailuresBeforeAnswer = 2;
  let identifyCalls = 0;
  let session: string | null = stranger.id;
  let knownSession: { id: string; label: string } | null = null;
  const deletedAs: string[] = [];
  let deletedBeforeIdentified = false;
  const persistence = new ProgressPersistence(
    {
      write: () => Promise.resolve(),
      remove: () => {
        if (knownSession === null) deletedBeforeIdentified = true;
        if (session !== null) deletedAs.push(session);
        return Promise.resolve();
      },
    },
    {
      latch: createSaveLatch(),
      wait: () => Promise.resolve(),
      owedAccount: owner,
      account: () => knownSession,
      identify: () => {
        identifyCalls++;
        if (identifyCalls <= identifyFailuresBeforeAnswer) {
          return Promise.reject(new Error('fake server error'));
        }
        knownSession = session === owner.id ? owner : stranger;
        return Promise.resolve(knownSession);
      },
      reauthenticate: () => {
        session = owner.id;
        knownSession = owner;
        return Promise.resolve(owner);
      },
      signOut: () => {
        session = null;
        knownSession = null;
        return Promise.resolve();
      },
    },
  );
  await persistence.wipe();
  check(!deletedBeforeIdentified, 'an owed wipe never deletes before the session is identified');
  check(
    identifyCalls === identifyFailuresBeforeAnswer + 1,
    `identity is asked again until the server answers (${identifyCalls} asks)`,
  );
  check(
    deletedAs.length === 1 && deletedAs[0] === owner.id,
    `an identified stranger is signed out before the delete (${deletedAs.join(', ')})`,
  );
}

/**
 * The Legendary Weapon wedge pays each crawler's weapon once: the spinner's
 * own first, then the other crawler's to the other crawler, and it retires
 * only once both are out. A refused save takes back exactly what it marked,
 * a pending second weapon found on load goes to its owner, and a save that
 * holds the wedge as won with no per-crawler claim is split by which weapon
 * the party still has.
 */
async function checkLegendaryWeaponPaysBoth(): Promise<void> {
  const { ClubWheelSystem, UNNAMED_WHEEL_PETS, WHEEL_SPIN_HOLD_MS } =
    await import('../src/systems/ClubWheelSystem');
  const { createWheelLedger } = await import('../src/core/save/WheelLedger');
  const { settleWheelLedger } = await import('../src/systems/casino/wheel/wheelPrizes');
  const { LEGENDARY_WEAPON_CLAIM_IDS, STORMCALLER_ITEM_ID, KALEIDOSCOPE_SPECS_ITEM_ID } =
    await import('../src/systems/casino/wheel/wheelBoard');
  const HOST_STEP_MS = 16;
  const HOST_PURSE = 10_000;
  const LANDING_SETTLE_MS = 20_000;
  const weaponWedge = 'legendary_weapon';
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(1, 0, TILE_SIZE);
  const ledger = createWheelLedger();

  const spinWeapon = async (spinner: HumanPlayer | CatPlayer, answer: 'saved' | 'failed') => {
    let now = 0;
    spinner.coins = HOST_PURSE;
    const companion = spinner === human ? cat : human;
    const wheel = new ClubWheelSystem({
      audio: null,
      audioScope: null,
      ledger,
      saveNow: () => Promise.resolve(answer),
      progressWipe: null,
      afterPermanentDeath: () => undefined,
      grantAttackCow: () => undefined,
      pets: UNNAMED_WHEEL_PETS,
      clock: () => now,
      random: mulberry32(1),
      forcedOutcome: (board) => {
        const index = board.findIndex((wedge) => wedge.prizeId === weaponWedge);
        return index < 0 ? null : { wedgeIndex: index, wedge: board[index] };
      },
    });
    wheel.openWheelForReview({ active: () => spinner, companion: () => companion });
    wheel.holdSpinForReview();
    for (let t = 0; t <= WHEEL_SPIN_HOLD_MS; t += HOST_STEP_MS) {
      now += HOST_STEP_MS;
      wheel.update();
    }
    await Promise.resolve();
    await Promise.resolve();
    for (let t = 0; t <= LANDING_SETTLE_MS && wheel.phaseKind === 'spinning'; t += HOST_STEP_MS) {
      now += HOST_STEP_MS;
      wheel.update();
    }
  };
  const retired = () =>
    outcomeWeights(boardForBet(WHEEL_MIN_BET), new Set(ledger.prizesWon.filter(isWheelPrizeId)))[
      BASE_WHEEL_BOARD.findIndex((wedge) => wedge.prizeId === weaponWedge)
    ] === 0;

  await spinWeapon(human, 'saved');
  check(
    human.inventory.countOf(STORMCALLER_ITEM_ID) === 1 &&
      cat.inventory.countOf(KALEIDOSCOPE_SPECS_ITEM_ID) === 0,
    "The human's first Legendary Weapon is his own sword",
  );
  check(!retired(), 'the wedge stays live after one weapon');

  const wonBefore = [...ledger.prizesWon];
  await spinWeapon(human, 'failed');
  check(
    ledger.prizesWon.join(',') === wonBefore.join(',') &&
      cat.inventory.countOf(KALEIDOSCOPE_SPECS_ITEM_ID) === 0,
    'a refused save on the second weapon takes back every mark it made',
  );

  await spinWeapon(human, 'saved');
  check(
    cat.inventory.countOf(KALEIDOSCOPE_SPECS_ITEM_ID) === 1 &&
      human.inventory.countOf(KALEIDOSCOPE_SPECS_ITEM_ID) === 0 &&
      human.inventory.countOf(STORMCALLER_ITEM_ID) === 1,
    "The human landing it again sends the cat's glasses to the cat",
  );
  check(retired(), 'the wedge retires once both weapons are out');

  const loadHuman = new HumanPlayer(0, 0, TILE_SIZE);
  const loadCat = new CatPlayer(1, 0, TILE_SIZE);
  const loadParty = { human: loadHuman, cat: loadCat, grantAttackCow: () => undefined };
  const pendingSecond = createWheelLedger(
    [LEGENDARY_WEAPON_CLAIM_IDS.cat, LEGENDARY_WEAPON_CLAIM_IDS.human, weaponWedge],
    {
      wedgeId: weaponWedge,
      prizeId: weaponWedge,
      crawler: 'cat',
      recipient: 'human',
      bet: WHEEL_MIN_BET,
      boardBet: WHEEL_MIN_BET,
    },
  );
  settleWheelLedger(pendingSecond, loadParty);
  check(
    loadHuman.inventory.countOf(STORMCALLER_ITEM_ID) === 1 &&
      loadCat.inventory.countOf(STORMCALLER_ITEM_ID) === 0,
    'a pending second weapon found on load goes to the crawler it belongs to',
  );
}

/**
 * A quest's free spin from the picker: the warnings are skipped, every board
 * the chain draws from has no Permanent Death (a forced Permanent Death finds
 * nothing to land on, and the taped wedge pays Spin Again), the spin is spent in the commit's
 * own save, the chain ends at the picker, and the next pick of the wheel shows
 * the warnings again. Then the ledger: one spin per quest, a save with no
 * record fails validation, and a reload mid-chain still owes a taped spin.
 */
async function checkQuestFreeSpin(): Promise<void> {
  const { ClubWheelSystem, UNNAMED_WHEEL_PETS, WHEEL_SPIN_HOLD_MS } =
    await import('../src/systems/ClubWheelSystem');
  const {
    createWheelLedger,
    grantQuestFreeSpin,
    parseWheelQuestFreeSpins,
    questFreeSpinsLeft,
    tapedChainOwed,
  } = await import('../src/core/save/WheelLedger');
  const { settleWheelLedger } = await import('../src/systems/casino/wheel/wheelPrizes');
  const { BASE_WHEEL_BOARD, TAPED_PERMANENT_DEATH, WHEEL_BET_STEP, tapedBoard } =
    await import('../src/systems/casino/wheel/wheelBoard');
  const STEP_MS = 16;
  /** Long enough for any spin and its reveal to play out. */
  const SPIN_BUDGET_MS = 40_000;
  const PURSE = 10_000;
  const FINAL_PRIZE = 'gold_50k';
  const finalPrize = BASE_WHEEL_BOARD.find((wedge) => wedge.prizeId === FINAL_PRIZE)?.prize;
  const FINAL_PRIZE_GOLD = finalPrize?.kind === 'gold' ? finalPrize.amount : Number.NaN;
  /** The chain lands on the taped wedge this many times before it pays out. */
  const TAPED_LANDINGS = 2;
  const UPGRADE_STEPS = 2;

  check(
    WHEEL_BETS.every((bet) =>
      tapedBoard(boardForBet(bet)).every((wedge) => wedge.prize.kind !== 'permanent_death'),
    ),
    'no taped board at any bet has a wedge that wipes',
  );
  check(
    TAPED_PERMANENT_DEATH.prize.kind === 'spin_again' &&
      TAPED_PERMANENT_DEATH.tapedOver?.prize.kind === 'permanent_death',
    'the taped Permanent Death pays Spin Again and still shows Permanent Death under the tape',
  );

  const ledger = createWheelLedger();
  check(grantQuestFreeSpin(ledger, 'quest_a'), 'a quest grants its free spin');
  check(!grantQuestFreeSpin(ledger, 'quest_a'), 'the same quest never grants a second one');
  grantQuestFreeSpin(ledger, 'quest_b');
  check(questFreeSpinsLeft(ledger) === 2, 'two quests leave two free spins');

  let now = 0;
  let saves = 0;
  const firstSave: { used: number | null } = { used: null };
  let forcedCalls = 0;
  let boardsWithPermanentDeath = 0;
  let tapedForced = 0;
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(1, 0, TILE_SIZE);
  human.coins = PURSE;
  const seat = { active: () => human, companion: () => cat };
  const wheel = new ClubWheelSystem({
    audio: null,
    audioScope: null,
    ledger,
    saveNow: () => {
      saves++;
      firstSave.used ??= ledger.questFreeSpins.used;
      return Promise.resolve('saved');
    },
    progressWipe: null,
    afterPermanentDeath: () => undefined,
    grantAttackCow: () => undefined,
    pets: UNNAMED_WHEEL_PETS,
    clock: () => now,
    random: mulberry32(1),
    forcedOutcome: (board) => {
      forcedCalls++;
      if (board.some((wedge) => wedge.prize.kind === 'permanent_death')) boardsWithPermanentDeath++;
      const taped = board.findIndex((wedge) => wedge.tapedOver !== undefined);
      if (tapedForced < TAPED_LANDINGS && taped >= 0) {
        tapedForced++;
        return { wedgeIndex: taped, wedge: board[taped] };
      }
      const index = board.findIndex((wedge) => wedge.prizeId === FINAL_PRIZE);
      return index < 0 ? null : { wedgeIndex: index, wedge: board[index] };
    },
  });
  const spinAndSettle = async (): Promise<void> => {
    wheel.holdSpinForReview();
    for (let t = 0; t <= WHEEL_SPIN_HOLD_MS + STEP_MS; t += STEP_MS) {
      now += STEP_MS;
      wheel.update();
    }
    for (let t = 0; t < SPIN_BUDGET_MS && wheel.busy; t += STEP_MS) {
      await Promise.resolve();
      now += STEP_MS;
      wheel.update();
    }
  };

  let backAtPicker = 0;
  check(wheel.freeSpinOffer?.count === 2, 'the picker offers both free spins');
  wheel.bindPicker(() => {
    backAtPicker++;
  });
  wheel.openFreeSpin(seat);
  check(wheel.currentScreen === 'wheel', 'a free spin opens on the wheel, past the warnings');
  for (let step = 0; step < UPGRADE_STEPS; step++) wheel.betUpForReview();
  check(
    wheel.currentBet === WHEEL_MIN_BET + UPGRADE_STEPS * WHEEL_BET_STEP,
    'the bet can still be raised to buy upgrades on a free spin',
  );
  await spinAndSettle();
  check(
    human.coins === PURSE - UPGRADE_STEPS * WHEEL_BET_STEP,
    `a free spin charges only the upgrades (spent ${PURSE - human.coins})`,
  );
  check(firstSave.used === 1, 'the free spin is spent in the save that commits it');
  for (let landing = 1; landing < TAPED_LANDINGS && wheel.currentScreen === 'wheel'; landing++) {
    check(
      wheel.currentBoard.every((wedge) => wedge.prize.kind !== 'permanent_death'),
      'the Spin Again chained from a free spin is still taped',
    );
    await spinAndSettle();
  }
  check(
    wheel.currentScreen === 'wheel',
    'landing on the taped Permanent Death keeps the wheel spinning',
  );
  await spinAndSettle();
  check(forcedCalls === TAPED_LANDINGS + 1, `the chain drew three spins (drew ${forcedCalls})`);
  check(boardsWithPermanentDeath === 0, 'no spin in the chain could land on Permanent Death');
  check(
    human.coins === PURSE - UPGRADE_STEPS * WHEEL_BET_STEP + FINAL_PRIZE_GOLD,
    'the chain pays its final prize, and no Spin Again in it charged anything',
  );
  check(
    wheel.currentScreen === 'closed' && backAtPicker === 1,
    'once the chain pays out the wheel closes back to the picker',
  );
  check(
    questFreeSpinsLeft(ledger) === 1 && !ledger.questFreeSpins.tapedChain,
    'one free spin is used and the taped chain is over',
  );
  check(saves > 0, 'the chain was saved');
  wheel.open(seat);
  check(
    wheel.currentScreen === 'warning',
    'picking the wheel again after a free spin shows the warnings',
  );

  // A chain left part way and finished from an ordinary, warned visit still ends at the picker.
  const resumed = createWheelLedger();
  grantQuestFreeSpin(resumed, 'quest_a');
  let resumedTaped = 0;
  let resumedPicker = 0;
  const resumedHuman = new HumanPlayer(0, 0, TILE_SIZE);
  resumedHuman.coins = PURSE;
  const resumedSeat = { active: () => resumedHuman, companion: () => cat };
  const resumedWheel = new ClubWheelSystem({
    audio: null,
    audioScope: null,
    ledger: resumed,
    saveNow: () => Promise.resolve('saved'),
    progressWipe: null,
    afterPermanentDeath: () => undefined,
    grantAttackCow: () => undefined,
    pets: UNNAMED_WHEEL_PETS,
    clock: () => now,
    random: mulberry32(1),
    forcedOutcome: (board) => {
      const taped = board.findIndex((wedge) => wedge.tapedOver !== undefined);
      if (resumedTaped === 0 && taped >= 0) {
        resumedTaped++;
        return { wedgeIndex: taped, wedge: board[taped] };
      }
      const index = board.findIndex((wedge) => wedge.prizeId === FINAL_PRIZE);
      return index < 0 ? null : { wedgeIndex: index, wedge: board[index] };
    },
  });
  const settleResumed = async (): Promise<void> => {
    resumedWheel.holdSpinForReview();
    for (let t = 0; t <= WHEEL_SPIN_HOLD_MS + STEP_MS; t += STEP_MS) {
      now += STEP_MS;
      resumedWheel.update();
    }
    for (let t = 0; t < SPIN_BUDGET_MS && resumedWheel.busy; t += STEP_MS) {
      await Promise.resolve();
      now += STEP_MS;
      resumedWheel.update();
    }
  };
  resumedWheel.bindPicker(() => {
    resumedPicker++;
  });
  resumedWheel.openFreeSpin(resumedSeat);
  await settleResumed();
  resumedWheel.leaveForReview();
  check(
    resumedPicker === 1,
    'leaving a free spin part way through its chain returns to the picker',
  );
  resumedWheel.openWheelForReview(resumedSeat);
  check(
    resumedWheel.currentBoard.every((wedge) => wedge.prize.kind !== 'permanent_death'),
    'the owed chain spin is taped on an ordinary visit too',
  );
  await settleResumed();
  check(
    resumedWheel.currentScreen === 'closed' && resumedPicker === 2,
    'a taped chain finished from an ordinary visit returns to the picker',
  );

  check(
    parseWheelQuestFreeSpins(undefined) === undefined,
    'a save with no quest free-spin record fails validation',
  );

  const midChain = createWheelLedger(
    [],
    {
      wedgeId: TAPED_PERMANENT_DEATH.id,
      prizeId: null,
      crawler: 'human',
      recipient: 'human',
      bet: 0,
      boardBet: WHEEL_MIN_BET,
    },
    null,
    null,
    { earnedBy: ['quest_a'], used: 1, tapedChain: true },
  );
  settleWheelLedger(midChain, { human, cat, grantAttackCow: () => undefined });
  check(
    tapedChainOwed(midChain) && midChain.freeSpinBet === WHEEL_MIN_BET,
    'a reload mid-chain still owes the taped Spin Again',
  );
}

/** A blow nothing can sidestep, so a measurement never rolls a dodge. */
const STEADY_MOB_BLOW: DamageSource = { kind: 'mob', mobType: 'goblin', undodgeable: true };
const STATUS_TICK: DamageSource = { kind: 'status', effectType: 'poison', applier: null };
/** Unscaled by difficulty, so the HP a blow leaves is exactly HP minus the blow. */
const FLAT_HAZARD: DamageSource = { kind: 'environmental', hazard: 'fireballFlames' };
/** Small enough that a doubled blow still fits inside a fresh crawler's HP. */
const SCALE_TEST_BLOW = 4;
const SCALE_TOLERANCE = 1e-9;
/** A bounty mob's blow, held to {@link BOUNTY_MAX_BLOW_HP_SHARE} of the target's bar. */
const CAPPED_BOUNTY_BLOW: DamageSource = {
  ...STEADY_MOB_BLOW,
  maxShareOfTargetHp: BOUNTY_MAX_BLOW_HP_SHARE,
};
/** Far past any cap, so the blow is priced by the cap alone. */
const OVERWHELMING_BLOW_MAX_HP_MULTIPLE = 4;
const STATUS_SCALE_TICKS = 600;
const FLOOR_TEST_HP = 1;

function hpLostTo(source: DamageSource, effect: StatusEffect | null): number {
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  if (effect !== null) human.applyStatus(effect);
  const before = human.hp;
  human.takeDamage(SCALE_TEST_BLOW, source);
  return before - human.hp;
}

function checkStatusDamageScale(): void {
  const scaled = STATUS_IDS.filter((id) => STATUS_DEFS[id].incomingDamageScale !== 1);
  check(scaled.length > 0, 'at least one status scales incoming damage');
  for (const id of scaled) {
    const scale = STATUS_DEFS[id].incomingDamageScale;
    const effect: StatusEffect = {
      type: id,
      ticksRemaining: STATUS_SCALE_TICKS,
      totalTicks: STATUS_SCALE_TICKS,
      applier: null,
    };
    for (const [label, source] of [
      ['a mob blow', STEADY_MOB_BLOW],
      ['a status tick', STATUS_TICK],
    ] as const) {
      const bare = hpLostTo(source, null);
      const carried = hpLostTo(source, effect);
      check(
        bare > 0 && Math.abs(carried - bare * scale) < SCALE_TOLERANCE,
        `${id} scales ${label} on a crawler by ${scale} (${bare} → ${carried})`,
      );
    }
  }

  const floored = new HumanPlayer(0, 0, TILE_SIZE);
  floored.takeDamage(floored.maxHp * 2, FLAT_HAZARD, { floorHp: FLOOR_TEST_HP });
  check(
    floored.hp === FLOOR_TEST_HP,
    `a blow with an HP floor stops at it (${floored.hp} HP left)`,
  );
}

function occurrences<T>(list: readonly T[], item: T): number {
  return list.filter((entry) => entry === item).length;
}

function checkHpThresholds(): void {
  for (const id of HP_THRESHOLD_IDS) {
    const threshold = CRAWLER_HP_THRESHOLDS[id];
    const human = new HumanPlayer(0, 0, TILE_SIZE);
    const top = hpThresholdTop(threshold, human.maxHp);
    const firesFor = (crawler: HumanPlayer) => occurrences(crawler.takeHpThresholdCrossings(), id);

    human.takeDamage(human.hp - top, FLAT_HAZARD);
    check(
      human.hp === top && firesFor(human) === 1,
      `${id}: a blow landing exactly on ${top} HP fires`,
    );

    if (top > 1) {
      human.takeDamage(1, FLAT_HAZARD);
      check(firesFor(human) === 0, `${id}: a second blow inside the band does not fire again`);
    }
    human.hp = top;
    human.takeDamage(1, FLAT_HAZARD);
    check(firesFor(human) === 0, `${id}: climbing back only to the line does not re-arm it`);

    human.hp = human.maxHp;
    human.hp = top;
    check(firesFor(human) === 1, `${id}: once HP climbs above the band, entering it fires again`);

    const oneShot = new HumanPlayer(0, 0, TILE_SIZE);
    oneShot.takeDamage(oneShot.maxHp, FLAT_HAZARD);
    check(
      oneShot.hp === 0 && firesFor(oneShot) === 0,
      `${id}: a blow from full straight to 0 HP does not fire`,
    );

    const restored = new HumanPlayer(0, 0, TILE_SIZE);
    restorePlayer(restored, { ...snapPlayer(restored), hp: top });
    check(firesFor(restored) === 0, `${id}: a crawler loaded inside the band does not fire`);

    const healedOut = new HumanPlayer(0, 0, TILE_SIZE);
    healedOut.takeDamage(healedOut.hp - top, FLAT_HAZARD);
    healedOut.hp = healedOut.maxHp;
    check(
      firesFor(healedOut) === 0,
      `${id}: a blow into the band healed back out before the drain does not fire`,
    );
  }

  const bus = new EventBus();
  let healthLowEvents = 0;
  bus.on('healthLow', () => healthLowEvents++);
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(1, 0, TILE_SIZE);
  cat.hp = hpThresholdTop(CRAWLER_HP_THRESHOLDS.low_health, cat.maxHp);
  drainHpThresholdCrossings({ human, cat }, bus);
  drainHpThresholdCrossings({ human, cat }, bus);
  check(healthLowEvents === 1, `entering low health emits healthLow once (${healthLowEvents})`);
}

/** The wedges each red penalty is printed on, and the size each keeps on the rim. */
const PENALTY_WEDGES = [
  { id: 'permanent_death', kind: 'permanent_death', label: 'Permanent Death', units: 2 },
  { id: 'take_damage_1', kind: 'take_damage', label: 'Take Damage', units: 1 },
  { id: 'take_damage_2', kind: 'take_damage', label: 'Take Damage', units: 1 },
  {
    id: 'double_damage_1',
    kind: 'double_damage',
    label: 'Double all incoming damage for 5 minutes',
    units: 1,
  },
  {
    id: 'double_damage_2',
    kind: 'double_damage',
    label: 'Double all incoming damage for 5 minutes',
    units: 1,
  },
] as const;
const DOUBLE_DAMAGE_SHORT_LABEL = 'DOUBLE DAMAGE';
/** Words no player-facing wheel text may carry. */
const RETIRED_WHEEL_WORDS = ['stab', 'knife', 'vomit'];
const RETCH_TEST_MOB_BLOW = 3;
const RETCH_SHARE_EXPECTED = 0.05;

function wheelTarget(crawler: HumanPlayer | CatPlayer): WheelPrizeTarget {
  return {
    crawler,
    kind: crawler instanceof HumanPlayer ? 'human' : 'cat',
    party: [crawler],
    grantAttackCow: () => undefined,
  };
}

function wedgeById(id: string): WheelWedge | undefined {
  return BASE_WHEEL_BOARD.find((wedge) => wedge.id === id);
}

function checkPenaltyWedges(): void {
  for (const expected of PENALTY_WEDGES) {
    const wedge = wedgeById(expected.id);
    check(
      wedge !== undefined &&
        wedge.prize.kind === expected.kind &&
        wedge.label === expected.label &&
        wedge.units === expected.units &&
        isRedWedge(wedge),
      `${expected.id} is a red ${expected.kind} wedge of ${expected.units} unit(s) labelled "${expected.label}"`,
    );
  }
  check(
    BASE_WHEEL_BOARD.filter((wedge) => wedge.prize.kind === 'double_damage').every(
      (wedge) => wedge.shortLabel === DOUBLE_DAMAGE_SHORT_LABEL,
    ),
    `double damage wedges read ${DOUBLE_DAMAGE_SHORT_LABEL} on the face`,
  );
  check(
    PERMANENT_RED_WEDGE_IDS.includes('double_damage_1') &&
      PERMANENT_RED_WEDGE_IDS.includes('double_damage_2'),
    'both double damage wedges stay red at every bet',
  );

  const playerText = [
    ...boardForBet(WHEEL_MAX_BET).flatMap((wedge) => [wedge.label, wedge.shortLabel]),
    ...BASE_WHEEL_BOARD.flatMap((wedge) => [wedge.label, wedge.shortLabel]),
    PERMANENT_DEATH_FIRST_LINE,
    PERMANENT_DEATH_SECOND_LINE,
    ...Object.values(DONALD_LINES).flatMap((lines) => lines.map((line) => line.paragraphs[0])),
    ...donaldLinesFor('pet', petWords(new PetNameBook(), 'attackCow')).map(
      (line) => line.paragraphs[0],
    ),
  ];
  const retired = playerText.filter((line) =>
    RETIRED_WHEEL_WORDS.some((word) => line.toLowerCase().includes(word.toLowerCase())),
  );
  check(
    retired.length === 0,
    `no wheel label, Permanent Death line or Donald line names a retired penalty${retired.length === 0 ? '' : ` (${retired.join(' | ')})`}`,
  );
}

const NINTH_LIFE_ITEM = 'halo_of_the_ninth_life' as const satisfies ItemId;
/** Under the halo's save share, where a downing blow would lift her rather than leave her. */
const NINTH_LIFE_TEST_HP_SHARE = 0.4;

function checkTakeDamage(): void {
  const wedge = wedgeById('take_damage_1');
  if (wedge === undefined) {
    check(false, 'take_damage_1 is on the board');
    return;
  }
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const wound = Math.round(human.maxHp * WHEEL_DAMAGE_MAX_HP_SHARE);
  const effect = applyWheelPrize(wedge.prize, wheelTarget(human));
  check(
    effect.hpLost === wound && human.hp === human.maxHp - wound,
    `Take Damage costs ${wound} of ${human.maxHp} HP (lost ${effect.hpLost})`,
  );
  check(
    human.lastDamageSource?.kind === 'wheelPenalty',
    `Take Damage lands as a wheel penalty through takeDamage (${human.lastDamageSource?.kind ?? 'no source'})`,
  );

  const cursed = new HumanPlayer(0, 0, TILE_SIZE);
  cursed.applyStatus(makeDoubleDamage());
  const cursedWound = Math.min(cursed.maxHp - 1, wound * DOUBLE_DAMAGE_SCALE);
  const cursedEffect = applyWheelPrize(wedge.prize, wheelTarget(cursed));
  check(
    cursedEffect.hpLost === cursedWound,
    `under double damage Take Damage costs ${cursedWound} (lost ${cursedEffect.hpLost})`,
  );

  for (const startHp of [1, 2, wound]) {
    const low = new HumanPlayer(0, 0, TILE_SIZE);
    low.hp = startHp;
    applyWheelPrize(wedge.prize, wheelTarget(low));
    check(low.hp === 1, `Take Damage from ${startHp} HP leaves 1 HP, never a kill (${low.hp})`);
  }

  const haloed = new CatPlayer(1, 0, TILE_SIZE);
  haloed.inventory.addItem(NINTH_LIFE_ITEM, 1);
  haloed.inventory.equipByItemId(NINTH_LIFE_ITEM);
  const lowHp = Math.floor(haloed.maxHp * NINTH_LIFE_TEST_HP_SHARE);
  haloed.hp = lowHp;
  applyWheelPrize(wedge.prize, wheelTarget(haloed));
  const ninthLifeSpent = haloed.gear.of(NINTH_LIFE_ITEM).floorOnceSpent.includes('ninthLife');
  check(
    haloed.inventory.equipment.isEquipped(NINTH_LIFE_ITEM) && !ninthLifeSpent && haloed.hp === 1,
    `Take Damage from ${lowHp} HP on a Ninth Life wearer is floored before the halo judges it: unspent, not healed (${haloed.hp} HP, ${ninthLifeSpent ? 'spent' : 'unspent'})`,
  );
}

function checkDoubleDamage(): void {
  check(
    STATUS_DEFS[DOUBLE_DAMAGE_STATUS].incomingDamageScale === DOUBLE_DAMAGE_SCALE &&
      DOUBLE_DAMAGE_SCALE === 2,
    'double damage doubles every incoming blow',
  );
  const curse = makeDoubleDamage();
  for (const [label, source] of [
    ['a mob hit', STEADY_MOB_BLOW],
    ['a status tick', STATUS_TICK],
  ] as const) {
    const bare = hpLostTo(source, null);
    const cursed = hpLostTo(source, curse);
    check(
      bare > 0 && cursed === bare * DOUBLE_DAMAGE_SCALE,
      `double damage doubles ${label} (${bare} → ${cursed})`,
    );
  }

  const capped = new HumanPlayer(0, 0, TILE_SIZE);
  capped.applyStatus(makeDoubleDamage());
  const blowCap = capped.maxHp * BOUNTY_MAX_BLOW_HP_SHARE;
  const beforeCapped = capped.hp;
  capped.takeDamage(capped.maxHp * OVERWHELMING_BLOW_MAX_HP_MULTIPLE, CAPPED_BOUNTY_BLOW);
  const cappedLoss = beforeCapped - capped.hp;
  check(
    cappedLoss > 0 && cappedLoss <= blowCap + SCALE_TOLERANCE,
    `under double damage a capped bounty blow still costs at most ${blowCap} of ${capped.maxHp} HP (lost ${cappedLoss})`,
  );

  const wedge = wedgeById('double_damage_1');
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  if (wedge !== undefined) applyWheelPrize(wedge.prize, wheelTarget(human));
  const laid = human.statusEffects.find((effect) => effect.type === DOUBLE_DAMAGE_STATUS);
  check(
    laid !== undefined && laid.ticksRemaining === DOUBLE_DAMAGE_FRAMES,
    `the wedge lays double damage for five minutes (${laid?.ticksRemaining ?? 0} frames)`,
  );
  human.clearStatusEffects();
  human.cureStatuses([DOUBLE_DAMAGE_STATUS]);
  check(
    INCURABLE_STATUSES.includes(DOUBLE_DAMAGE_STATUS) &&
      human.statusEffects.some((effect) => effect.type === DOUBLE_DAMAGE_STATUS),
    'double damage is incurable: no cure or clear lifts it',
  );
  check(statusShowsHudPill(DOUBLE_DAMAGE_STATUS), 'double damage shows a HUD pill');

  const snap = snapPlayer(human);
  const remaining = doubleDamageRemainingOf(snap, snapPlayer(new CatPlayer(1, 0, TILE_SIZE)));
  const stripped = { ...snap, statusEffects: [] };
  const restored = withDoubleDamageFrames(stripped, remaining.human);
  check(
    remaining.human > 0 &&
      remaining.cat === 0 &&
      restored.statusEffects.some(
        (effect) =>
          effect.type === DOUBLE_DAMAGE_STATUS && effect.ticksRemaining === remaining.human,
      ),
    `double damage crosses a save through its own field (${remaining.human} frames)`,
  );
}

function retchCount(bus: EventBus, crawlers: { human: HumanPlayer; cat: CatPlayer }): number {
  let retches = 0;
  const off = bus.on('bloodVomitRetch', () => retches++);
  drainHpThresholdCrossings(crawlers, bus);
  drainBloodVomitRetches([crawlers.human, crawlers.cat], bus);
  off();
  return retches;
}

/** A five-minute retch, longer than any bout lasts, so a replayed one would show. */
const STALE_SAVED_RETCH_FRAMES = DOUBLE_DAMAGE_FRAMES;

function checkRetch(): void {
  const threshold = CRAWLER_HP_THRESHOLDS.retch;
  check(
    threshold.share === RETCH_SHARE_EXPECTED,
    `the retch band is the bottom ${threshold.share * 100}% of HP`,
  );
  check(!INCURABLE_STATUSES.includes(BLOOD_VOMIT_STATUS), 'a retch is not incurable');
  check(!statusShowsHudPill(BLOOD_VOMIT_STATUS), 'a retch shows no HUD pill');

  const stale = new HumanPlayer(0, 0, TILE_SIZE);
  const staleRetch = {
    ...makeBloodVomit(),
    ticksRemaining: STALE_SAVED_RETCH_FRAMES,
    totalTicks: STALE_SAVED_RETCH_FRAMES,
  };
  stale.statusEffects.push(staleRetch);
  const snapped = snapPlayer(stale);
  check(
    !snapped.statusEffects.some((effect) => effect.type === BLOOD_VOMIT_STATUS),
    'a retch is never written into a snapshot, however long it has left',
  );
  const storedWithRetch: unknown = JSON.parse(
    JSON.stringify({ ...snapped, statusEffects: [{ ...staleRetch, applier: null }] }),
  );
  check(
    parsePlayerSnapshot(storedWithRetch, 'human') === undefined,
    'a stored snapshot carrying a retch fails validation',
  );

  for (const which of ['human', 'cat'] as const) {
    const bus = new EventBus();
    const crawlers = {
      human: new HumanPlayer(0, 0, TILE_SIZE),
      cat: new CatPlayer(1, 0, TILE_SIZE),
    };
    const crawler = crawlers[which];
    const top = hpThresholdTop(threshold, crawler.maxHp);

    crawler.takeDamage(crawler.hp - top, FLAT_HAZARD);
    const hpBeforeRetch = crawler.hp;
    const entered = retchCount(bus, crawlers);
    const bout = crawler.statusEffects.find((effect) => effect.type === BLOOD_VOMIT_STATUS);
    check(
      entered === 1 && crawler.hp === hpBeforeRetch,
      `${which}: a blow landing exactly on ${top} HP retches once and costs no HP (${entered} retches, ${hpBeforeRetch} → ${crawler.hp} HP)`,
    );
    check(
      bout !== undefined && bout.totalTicks === BLOOD_VOMIT_RETCH_FRAMES,
      `${which}: the retch lasts one bout (${bout?.totalTicks ?? 0} frames)`,
    );

    if (top > 1) {
      crawler.takeDamage(1, FLAT_HAZARD);
      check(
        retchCount(bus, crawlers) === 0,
        `${which}: a second blow inside the band does not retch again`,
      );
    }
    crawler.hp = crawler.maxHp;
    check(retchCount(bus, crawlers) === 0, `${which}: healing out of the band does not retch`);
    crawler.takeDamage(crawler.hp - top, FLAT_HAZARD);
    check(
      retchCount(bus, crawlers) === 1,
      `${which}: entering the band again after rising above it retches again`,
    );

    const killed =
      which === 'human' ? new HumanPlayer(0, 0, TILE_SIZE) : new CatPlayer(1, 0, TILE_SIZE);
    const killedCrawlers =
      killed instanceof HumanPlayer
        ? { human: killed, cat: new CatPlayer(1, 0, TILE_SIZE) }
        : { human: new HumanPlayer(0, 0, TILE_SIZE), cat: killed };
    killed.takeDamage(killed.maxHp, FLAT_HAZARD);
    check(
      killed.hp === 0 && retchCount(bus, killedCrawlers) === 0,
      `${which}: a blow straight to 0 HP does not retch`,
    );
  }

  const mobHit = new HumanPlayer(0, 0, TILE_SIZE);
  mobHit.hp = hpThresholdTop(threshold, mobHit.maxHp) + RETCH_TEST_MOB_BLOW;
  mobHit.takeHpThresholdCrossings();
  mobHit.takeDamage(RETCH_TEST_MOB_BLOW, STEADY_MOB_BLOW);
  check(
    mobHit.takeHpThresholdCrossings().includes('retch'),
    'a mob hit carrying a crawler into the band is seen entering it',
  );
}

runSection('board', checkBoard);
runSection('bets', checkBets);
runSection('picks', checkPicks);
runSection('landings', checkLandings);
runSection('spin plans', checkSpinPlans);
runSection('status damage scale', checkStatusDamageScale);
runSection('hp thresholds', checkHpThresholds);
runSection('penalty wedges', checkPenaltyWedges);
runSection('take damage', checkTakeDamage);
runSection('double damage', checkDoubleDamage);
runSection('retch', checkRetch);
console.log('\nsave latch');
await checkInFlightSaveCannotResurrectWipe();
await checkAuthFailureAsksForSignIn();
await checkWipeRefusesOtherAccount();
await checkOwedWipeFinishesBeforeAnyLoad();
await checkOwedWipeIdentifiesSessionFirst();
await checkSaveLatchBlocksWritesAfterWipe();
console.log('\nhost');
await checkHostCommitsBeforeTurning();
await checkLegendaryWeaponPaysBoth();
console.log('\nquest free spin');
await checkQuestFreeSpin();

console.log(
  failures === 0
    ? '\nverify:wheel — all checks passed'
    : `\nverify:wheel — ${failures} check(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
