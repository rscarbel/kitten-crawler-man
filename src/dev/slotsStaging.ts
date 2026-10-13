/**
 * Drives a real {@link ClubSlotsSystem} on a fake clock to a chosen moment:
 * idle, mid-spin, a line win, each win tier's banner, the free-spin feature,
 * the jackpot or a purse too light for the bet. The gallery, the `?slots` route and the gates all stage the
 * machine through here, so each shows exactly what the game ships.
 */

import { CatPlayer } from '../creatures/CatPlayer';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { TILE_SIZE } from '../core/constants';
import { createClubMembership } from '../core/ClubMembership';
import type { CasinoSeat } from '../systems/ClubCasinoSystem';
import { ClubSlotsSystem, type SlotsAudio } from '../systems/ClubSlotsSystem';
import { MAX_BET_PER_LINE, stepBet } from '../systems/casino/slots/slotBets';
import type { ForcedOutcome } from '../systems/casino/slots/forcedOutcomes';
import { mulberry32 } from '../sprites/person/rng';

export const SLOTS_STAGES = [
  'idle',
  'attract',
  'spinning',
  'anticipation',
  'line-win',
  'big-win',
  'mega-win',
  'epic-win',
  'free-spins',
  'jackpot',
  'broke',
] as const;

export type SlotsStage = (typeof SLOTS_STAGES)[number];

/** A bankroll deep enough for any bet the fixtures place. */
const STAGE_BANKROLL = 25000;
/** A pool grown past its floor, so the meter shows a believable number. */
const STAGE_JACKPOT_POOL = 18437.5;
export const SLOTS_STAGE_SEED = 0x51075;
const EFFECTS_SEED = 0xc014;
/** One fake frame. */
export const SLOTS_STAGE_STEP_MS = 16;
const MAX_STAGE_STEPS = 4000;
/** Mid-spin: every reel is up to speed and none has stopped. */
const SPINNING_MS = 640;
/** Into a celebration: the first line traced, or the banner slammed in with coins in the air. */
const LINE_WIN_HOLD_MS = 420;
const BANNER_HOLD_MS = 1150;
/** Long enough idle for the attract pattern to start. */
const ATTRACT_MS = 4200;
/** Into a free spin: the feature is running and its reels are spinning. */
const FREE_SPIN_HOLD_MS = 500;
/** The bet the tier fixtures play at, two rungs up the ladder. */
const STAGE_BET_STEPS = 2;

export interface StagedSlots {
  readonly host: ClubSlotsSystem;
  readonly seat: CasinoSeat;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  /** Moves the fake clock on by `ms` and ticks the host each frame. */
  readonly advance: (ms: number) => void;
  readonly now: () => number;
}

/** A fresh machine with a seated party, opened on its fake clock. */
export function openStagedSlots(audio: SlotsAudio | null = null): StagedSlots {
  let now = 0;
  const membership = createClubMembership();
  membership.slotsJackpotPool = STAGE_JACKPOT_POOL;
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(1, 0, TILE_SIZE);
  human.coins = STAGE_BANKROLL;
  const seat: CasinoSeat = { active: () => human, companion: () => cat };
  const host = new ClubSlotsSystem(audio, membership, () => now, {
    seed: SLOTS_STAGE_SEED,
    effectsRandom: mulberry32(EFFECTS_SEED),
  });
  host.open(seat);
  const advance = (ms: number): void => {
    const target = now + ms;
    while (now < target) {
      now = Math.min(target, now + SLOTS_STAGE_STEP_MS);
      host.update();
    }
  };
  advance(SLOTS_STAGE_STEP_MS);
  return { host, seat, human, cat, advance, now: () => now };
}

/** Steps until `done` holds, or gives up; returns whether it held. */
export function stepUntil(staged: StagedSlots, done: () => boolean): boolean {
  for (let step = 0; step < MAX_STAGE_STEPS; step++) {
    if (done()) return true;
    staged.advance(SLOTS_STAGE_STEP_MS);
  }
  return done();
}

function spinForced(staged: StagedSlots, kind: ForcedOutcome): void {
  if (!staged.host.forceNext(kind)) throw new Error(`the slots stage could not force a ${kind}`);
  if (!staged.host.spin()) throw new Error(`the slots stage could not spin for a ${kind}`);
}

function untilCelebrating(staged: StagedSlots): void {
  if (!stepUntil(staged, () => staged.host.motion.celebration !== null)) {
    throw new Error('the slots stage never reached a celebration');
  }
}

/** Puts the machine at `stage`. */
export function stageSlots(staged: StagedSlots, stage: SlotsStage): void {
  const { host } = staged;
  host.betPerLine = stepBet(host.betPerLine, STAGE_BET_STEPS);
  switch (stage) {
    case 'idle':
      return;
    case 'attract':
      staged.advance(ATTRACT_MS);
      return;
    case 'spinning':
      spinForced(staged, 'loss');
      staged.advance(SPINNING_MS);
      return;
    case 'anticipation':
      spinForced(staged, 'near_miss_scatter');
      if (!stepUntil(staged, () => host.motion.reels.some((reel) => reel.anticipating))) {
        throw new Error('the slots stage never slowed a reel in anticipation');
      }
      staged.advance(SPINNING_MS);
      return;
    case 'line-win':
      spinForced(staged, 'line_win');
      untilCelebrating(staged);
      staged.advance(LINE_WIN_HOLD_MS);
      return;
    case 'big-win':
      spinForced(staged, 'big_win');
      untilCelebrating(staged);
      staged.advance(BANNER_HOLD_MS);
      return;
    case 'mega-win':
      spinForced(staged, 'mega_win');
      untilCelebrating(staged);
      staged.advance(BANNER_HOLD_MS);
      return;
    case 'epic-win':
      spinForced(staged, 'epic_win');
      untilCelebrating(staged);
      staged.advance(BANNER_HOLD_MS);
      return;
    case 'free-spins':
      spinForced(staged, 'free_spins');
      untilCelebrating(staged);
      if (!stepUntil(staged, () => host.machine.freeSpins !== null && host.motion.reelsMoving)) {
        throw new Error('the slots stage never started a free spin');
      }
      staged.advance(FREE_SPIN_HOLD_MS);
      return;
    case 'broke':
      staged.human.coins = 0;
      staged.cat.coins = 0;
      staged.advance(SLOTS_STAGE_STEP_MS);
      return;
    case 'jackpot':
      host.betPerLine = MAX_BET_PER_LINE;
      spinForced(staged, 'jackpot');
      untilCelebrating(staged);
      staged.advance(BANNER_HOLD_MS);
      return;
  }
}
