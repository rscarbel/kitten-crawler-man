#!/usr/bin/env tsx
/**
 * Headless gate on the Wheel of Fortune engine (`src/systems/casino/wheel/`):
 * the board's red share and fixed wedges, the bet upgrades flipping one wedge
 * per step in order, once-won prizes never coming up again while staying on the
 * rim, Spin Again never retiring, landings that always sit inside the chosen
 * wedge, spin plans that come to rest exactly on that landing, and the save
 * latch that stops every write once the Nothing's wipe starts.
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
} from '../src/core/progressPersistence';
import { LOCAL_PROGRESS_STORAGE, writeLocalProgress } from '../src/core/LocalProgress';
import { stampGameProgress } from '../src/core/saveFormat';
import { AuthClient, type GameProgressInput } from '../src/auth/AuthClient';
import { snapPlayer } from '../src/core/PlayerSnapshot';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { TILE_SIZE } from '../src/core/constants';
import { level1 } from '../src/levels/level1';

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
  'stabbed_2',
] as const;
const BIG_GOOD_PRIZES: readonly WheelPrizeId[] = ['gold_50k', 'legendary_weapon_box', 'gold_500k'];

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

  const nothingIndex = board.findIndex((wedge) => wedge.prize.kind === 'nothing');
  const nothingNeighbours = nothingIndex < 0 ? [] : neighbours(board, nothingIndex);
  check(
    nothingNeighbours.some(
      (wedge) => wedge.prizeId !== null && BIG_GOOD_PRIZES.includes(wedge.prizeId),
    ),
    'one Nothing! edge touches a big good prize',
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
      `bet ${bet}: Nothing!, both Vomit Blood, first Stabbed and first Poisoned are red in place${missing.length === 0 ? '' : ` (missing ${missing.join(', ')})`}`,
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

function latchFixture(): GameProgressInput {
  return {
    levelId: level1.id,
    humanSnap: snapPlayer(new HumanPlayer(0, 0, TILE_SIZE)),
    catSnap: snapPlayer(new CatPlayer(0, 0, TILE_SIZE)),
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
  const { ClubWheelSystem, WHEEL_SPIN_HOLD_MS } = await import('../src/systems/ClubWheelSystem');
  const { createWheelLedger } = await import('../src/core/WheelLedger');
  const { settleWheelLedger } = await import('../src/systems/casino/wheel/wheelPrizes');
  const { parseWheelOwedItems } = await import('../src/core/WheelLedger');
  const { adoptWhenCommitted } = await import('../src/core/adoptWhenCommitted');
  /** A bag holds far fewer than this; the loop stops as soon as it is full. */
  const BAG_FILL_LIMIT = 200;
  const FILLER_ITEM = 'trollskin_shirt';
  const { FROZEN_STATUS } = await import('../src/core/StatusEffect');
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
      ledger,
      saveNow: () => {
        saves++;
        return new Promise((resolve) => {
          release = () => resolve(answer);
        });
      },
      progressWipe: null,
      afterNothing: () => undefined,
      grantAttackCow: () => undefined,
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
        ledger,
        saveNow: () => Promise.resolve('saved'),
        progressWipe: null,
        afterNothing: () => undefined,
        grantAttackCow: () => undefined,
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
      ledger: createWheelLedger(),
      saveNow: () => Promise.resolve('saved'),
      progressWipe: null,
      afterNothing: () => undefined,
      grantAttackCow: () => undefined,
      random: mulberry32(1),
    });
    const board = boardForBet(WHEEL_MIN_BET);
    const queuedBefore = winner.inventory.countOf('ring_of_the_cold_shoulder');
    wheel.landForReview(
      seat,
      board.findIndex((wedge) => wedge.prizeId === 'platinum_box_frost'),
    );
    return {
      gained: winner.inventory.countOf('ring_of_the_cold_shoulder') - queuedBefore,
    };
  })();
  check(landed.gained === 1, 'a Platinum (frost) landing puts the ring in the bag at once');
  const loader = new HumanPlayer(0, 0, TILE_SIZE);
  const signetLedger = createWheelLedger(['legendary_box'], {
    wedgeId: 'legendary_box',
    prizeId: 'legendary_box',
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
  settleWheelLedger(signetLedger, loadParty);
  settleWheelLedger(signetLedger, loadParty);
  check(
    loader.inventory.countOf('fairy_repellent_signet') === 1,
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

  // A full bag: the prize is held in the ledger, saved, never dropped where a reload loses it.
  const packed = new HumanPlayer(0, 0, TILE_SIZE);
  for (let slot = 0; slot < BAG_FILL_LIMIT && packed.inventory.hasRoomFor(FILLER_ITEM); slot++) {
    packed.inventory.addItem(FILLER_ITEM, 1);
  }
  const packedLedger = createWheelLedger();
  const packedWheel = new ClubWheelSystem({
    audio: null,
    ledger: packedLedger,
    saveNow: () => Promise.resolve('saved'),
    progressWipe: null,
    afterNothing: () => undefined,
    grantAttackCow: () => undefined,
    random: mulberry32(1),
  });
  packedWheel.landForReview(
    { active: () => packed, companion: () => cat },
    boardForBet(WHEEL_MIN_BET).findIndex((wedge) => wedge.prizeId === 'legendary_box'),
  );
  const heldItem = packedLedger.owedItems[0];
  check(
    packed.inventory.countOf('fairy_repellent_signet') === 0 &&
      packedLedger.owedItems.length === 1 &&
      heldItem.id === 'fairy_repellent_signet',
    'a prize won with a full bag is held in the ledger, not dropped',
  );
  const reloaded = createWheelLedger(
    [],
    null,
    null,
    null,
    parseWheelOwedItems(JSON.parse(JSON.stringify(packedLedger.owedItems))) ?? [],
  );
  const roomy = new HumanPlayer(0, 0, TILE_SIZE);
  const roomyParty = { human: roomy, cat, grantAttackCow: () => undefined };
  settleWheelLedger(reloaded, roomyParty);
  settleWheelLedger(reloaded, roomyParty);
  check(
    roomy.inventory.countOf('fairy_repellent_signet') === 1 && reloaded.owedItems.length === 0,
    'a held prize survives the save and lands in the bag once there is room, exactly once',
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
  let markerHeldUntilDelete = true;
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
            if (markerState === null) markerHeldUntilDelete = false;
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
    markerHeldUntilDelete && markerState === null,
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
  const { ClubWheelSystem, WHEEL_SPIN_HOLD_MS } = await import('../src/systems/ClubWheelSystem');
  const { createWheelLedger } = await import('../src/core/WheelLedger');
  const { settleWheelLedger } = await import('../src/systems/casino/wheel/wheelPrizes');
  const { LEGENDARY_WEAPON_CLAIM_IDS, FURY_OF_TARANIS_ITEM_ID, EYES_OF_SPLATTER_ITEM_ID } =
    await import('../src/systems/casino/wheel/wheelBoard');
  const HOST_STEP_MS = 16;
  const HOST_PURSE = 10_000;
  const LANDING_SETTLE_MS = 20_000;
  const weaponWedge = 'legendary_weapon_box';
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(1, 0, TILE_SIZE);
  const ledger = createWheelLedger();

  const spinWeapon = async (spinner: HumanPlayer | CatPlayer, answer: 'saved' | 'failed') => {
    let now = 0;
    spinner.coins = HOST_PURSE;
    const companion = spinner === human ? cat : human;
    const wheel = new ClubWheelSystem({
      audio: null,
      ledger,
      saveNow: () => Promise.resolve(answer),
      progressWipe: null,
      afterNothing: () => undefined,
      grantAttackCow: () => undefined,
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
    human.inventory.countOf(FURY_OF_TARANIS_ITEM_ID) === 1 &&
      cat.inventory.countOf(EYES_OF_SPLATTER_ITEM_ID) === 0,
    "Carl's first Legendary Weapon is his own sword",
  );
  check(!retired(), 'the wedge stays live after one weapon');

  const wonBefore = [...ledger.prizesWon];
  await spinWeapon(human, 'failed');
  check(
    ledger.prizesWon.join(',') === wonBefore.join(',') &&
      cat.inventory.countOf(EYES_OF_SPLATTER_ITEM_ID) === 0,
    'a refused save on the second weapon takes back every mark it made',
  );

  await spinWeapon(human, 'saved');
  check(
    cat.inventory.countOf(EYES_OF_SPLATTER_ITEM_ID) === 1 &&
      human.inventory.countOf(EYES_OF_SPLATTER_ITEM_ID) === 0 &&
      human.inventory.countOf(FURY_OF_TARANIS_ITEM_ID) === 1,
    "Carl landing it again sends Donut's glasses to Donut",
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
    loadHuman.inventory.countOf(FURY_OF_TARANIS_ITEM_ID) === 1 &&
      loadCat.inventory.countOf(FURY_OF_TARANIS_ITEM_ID) === 0,
    'a pending second weapon found on load goes to the crawler it belongs to',
  );

  const legacyParty = {
    human: new HumanPlayer(0, 0, TILE_SIZE),
    cat: new CatPlayer(1, 0, TILE_SIZE),
    grantAttackCow: () => undefined,
  };
  legacyParty.cat.inventory.addItem(EYES_OF_SPLATTER_ITEM_ID, 1);
  const legacyHeld = createWheelLedger([weaponWedge]);
  settleWheelLedger(legacyHeld, legacyParty);
  check(
    legacyHeld.prizesWon.join(',') === LEGENDARY_WEAPON_CLAIM_IDS.cat,
    `a legacy claim with Donut's glasses in hand becomes her claim alone (${legacyHeld.prizesWon.join(',')})`,
  );
  const legacyLost = createWheelLedger([weaponWedge]);
  settleWheelLedger(legacyLost, {
    human: new HumanPlayer(0, 0, TILE_SIZE),
    cat: new CatPlayer(1, 0, TILE_SIZE),
    grantAttackCow: () => undefined,
  });
  check(
    legacyLost.prizesWon.includes(weaponWedge) &&
      legacyLost.prizesWon.includes(LEGENDARY_WEAPON_CLAIM_IDS.human) &&
      legacyLost.prizesWon.includes(LEGENDARY_WEAPON_CLAIM_IDS.cat),
    'a legacy claim with no telling which weapon was won stays retired',
  );
}

runSection('board', checkBoard);
runSection('bets', checkBets);
runSection('picks', checkPicks);
runSection('landings', checkLandings);
runSection('spin plans', checkSpinPlans);
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

console.log(
  failures === 0
    ? '\nverify:wheel — all checks passed'
    : `\nverify:wheel — ${failures} check(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
