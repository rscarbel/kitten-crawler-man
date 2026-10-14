/**
 * Fixtures for Tito's Wheel of Fortune: both danger prompts (arming and
 * armed), the wheel at the minimum and maximum bet, a wedge turning over as
 * the bet rises, SPIN half held, the wheel mid-spin, every outcome's reveal,
 * a quest's free spin with the Nothing taped over, and the Nothing. Each drives a real `ClubWheelSystem` on a fake clock with no
 * storage behind it, so the screens show what the game ships.
 */

import { HumanPlayer } from '../../../creatures/HumanPlayer';
import { CatPlayer } from '../../../creatures/CatPlayer';
import { TILE_SIZE } from '../../../core/constants';
import { createWheelLedger, grantQuestFreeSpin } from '../../../core/WheelLedger';
import { mulberry32 } from '../../../sprites/person/rng';
import { ClubWheelSystem, WHEEL_ARMING_MS } from '../../../systems/ClubWheelSystem';
import {
  WHEEL_BET_STEP,
  WHEEL_MAX_BET,
  WHEEL_MIN_BET,
  boardForBet,
} from '../../../systems/casino/wheel/wheelBoard';
import type { WheelWarningKind } from '../../../ui/casino/wheel/wheelWarnings';
import type { DialogFixture } from './fixture';

/** Enough coins for any bet, with change to rob. */
const FIXTURE_PURSE = 18_450;
const FIXTURE_SEED = 0x77ee1;
/** Tito's patter draws from its own stream, so every render of a fixture says the same line. */
const TITO_SEED = 0x7170;
/** Part way through the arming delay, with Yes still disabled. */
const ARMING_FRAME_MS = 900;
/** Long enough for Tito's greeting to have faded in. */
const GREETING_FRAME_MS = 600;
/** One fake clock step. */
const STEP_MS = 16;
/** A moment into each reveal: the banner is in, the effect is under way. */
const REVEAL_FRAME_MS = 900;
/** The stab is caught just after the slash lands, with the shake and the red still on screen. */
const STAB_FRAME_MS = 500;
const ROBBED_FRAME_MS = 1100;
const PET_FRAME_MS = 900;
const JACKPOT_FRAME_MS = 1600;
/** Mid-spin: the wheel is still fast and the bulbs are chasing. */
const SPINNING_FRAME_MS = 1800;
/** The bet flip caught with the wedge edge-on. */
const FLIP_FRAME_MS = 160;
/** SPIN held a little over half way. */
const HOLD_FRAME_MS = 600;
/** The prize screen once its lines have popped in and settled. */
const PRIZE_FRAME_MS = 2200;
/** The prize screen mid-burst, with the item still growing in and the confetti flying. */
const PRIZE_OPENING_MS = 300;
/** The Nothing caught as the bulbs go dark, and again on its last words. */
const NOTHING_BULBS_FRAME_MS = 2600;
const NOTHING_TEXT_FRAME_MS = 11_000;

/** Any quest id: the fixture only needs a free spin on the ledger. */
const FIXTURE_FREE_SPIN_QUEST = 'grotesque_spider';
/** Two rungs above the minimum, so the free spin's upgrade price shows. */
const FREE_SPIN_UPGRADED_BET = WHEEL_MIN_BET + 2 * WHEEL_BET_STEP;

type WheelState =
  | { readonly kind: 'prompt'; readonly prompt: WheelWarningKind; readonly armed: boolean }
  | { readonly kind: 'freeSpin'; readonly bet: number }
  | { readonly kind: 'freeSpinTapedLanding' }
  | { readonly kind: 'idle'; readonly bet: number }
  | { readonly kind: 'flip' }
  | { readonly kind: 'hold' }
  | { readonly kind: 'spinning' }
  | {
      readonly kind: 'reveal';
      readonly wedgeId: string;
      readonly bet: number;
      readonly atMs: number;
    }
  | {
      readonly kind: 'prize';
      readonly wedgeId: string;
      readonly bet: number;
      readonly spinner: 'human' | 'cat';
      readonly atMs: number;
    };

function wheelFixture(name: string, state: WheelState): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      let now = 0;
      const human = new HumanPlayer(0, 0, TILE_SIZE);
      const cat = new CatPlayer(1, 0, TILE_SIZE);
      human.coins = FIXTURE_PURSE;
      const donutSpins = state.kind === 'prize' && state.spinner === 'cat';
      const seat = donutSpins
        ? { active: () => cat, companion: () => human }
        : { active: () => human, companion: () => cat };
      const ledger = createWheelLedger();
      grantQuestFreeSpin(ledger, FIXTURE_FREE_SPIN_QUEST);
      const wheel = new ClubWheelSystem({
        audio: null,
        audioScope: null,
        ledger,
        saveNow: () => Promise.resolve('disabled'),
        progressWipe: null,
        afterNothing: () => undefined,
        grantAttackCow: () => undefined,
        clock: () => now,
        random: mulberry32(FIXTURE_SEED),
        titoRandom: mulberry32(TITO_SEED),
      });
      const advance = (ms: number): void => {
        for (let elapsed = 0; elapsed < ms; elapsed += STEP_MS) {
          now += STEP_MS;
          wheel.update();
        }
      };
      switch (state.kind) {
        case 'prompt':
          wheel.openPromptForReview(seat, state.prompt);
          if (state.armed) advance(WHEEL_ARMING_MS + STEP_MS);
          else advance(ARMING_FRAME_MS);
          break;
        case 'freeSpin':
          wheel.openFreeSpin(seat);
          wheel.setBetForReview(state.bet);
          advance(GREETING_FRAME_MS);
          break;
        case 'freeSpinTapedLanding': {
          wheel.openFreeSpin(seat);
          const index = wheel.currentBoard.findIndex((wedge) => wedge.tapedOver !== undefined);
          if (index < 0)
            throw new Error(`wheel fixture ${name}: the free spin's board is not taped`);
          wheel.landForReview(seat, index);
          advance(REVEAL_FRAME_MS);
          break;
        }
        case 'idle':
          wheel.openWheelForReview(seat);
          wheel.setBetForReview(state.bet);
          advance(GREETING_FRAME_MS);
          break;
        case 'flip':
          wheel.openWheelForReview(seat);
          wheel.betUpForReview();
          advance(FLIP_FRAME_MS);
          break;
        case 'hold':
          wheel.openWheelForReview(seat);
          wheel.holdSpinForReview();
          advance(HOLD_FRAME_MS);
          break;
        case 'spinning':
          wheel.spinForReview(seat, 0);
          advance(SPINNING_FRAME_MS);
          break;
        case 'reveal': {
          wheel.setBetForReview(state.bet);
          const board = boardForBet(state.bet);
          const index = board.findIndex((wedge) => wedge.id === state.wedgeId);
          if (index < 0) throw new Error(`wheel fixture ${name}: no wedge ${state.wedgeId}`);
          wheel.landForReview(seat, index);
          advance(state.atMs);
          break;
        }
        case 'prize': {
          wheel.setBetForReview(state.bet);
          const board = boardForBet(state.bet);
          const index = board.findIndex((wedge) => wedge.id === state.wedgeId);
          if (index < 0) throw new Error(`wheel fixture ${name}: no wedge ${state.wedgeId}`);
          wheel.presentPrizeForReview(seat, index);
          advance(state.atMs);
          break;
        }
      }
      return wheel.surfacesPrefixed(seat, `${name}-`).map((surface) => ({
        ...surface,
        isOpen: () => shown() && surface.isOpen(),
      }));
    },
  };
}

function reveal(name: string, wedgeId: string, atMs = REVEAL_FRAME_MS, bet = WHEEL_MIN_BET) {
  return wheelFixture(name, { kind: 'reveal', wedgeId, bet, atMs });
}

function prize(
  name: string,
  wedgeId: string,
  spinner: 'human' | 'cat',
  bet = WHEEL_MIN_BET,
  atMs = PRIZE_FRAME_MS,
) {
  return wheelFixture(name, { kind: 'prize', wedgeId, bet, spinner, atMs });
}

export const FIXTURES: readonly DialogFixture[] = [
  wheelFixture('wheel-warning', { kind: 'prompt', prompt: 'warning', armed: false }),
  wheelFixture('wheel-warning-armed', { kind: 'prompt', prompt: 'warning', armed: true }),
  wheelFixture('wheel-confirm', { kind: 'prompt', prompt: 'confirm', armed: false }),
  wheelFixture('wheel-confirm-armed', { kind: 'prompt', prompt: 'confirm', armed: true }),
  wheelFixture('wheel-min-bet', { kind: 'idle', bet: WHEEL_MIN_BET }),
  wheelFixture('wheel-free-spin', { kind: 'freeSpin', bet: WHEEL_MIN_BET }),
  wheelFixture('wheel-free-spin-upgraded', { kind: 'freeSpin', bet: FREE_SPIN_UPGRADED_BET }),
  wheelFixture('wheel-free-spin-taped-landing', { kind: 'freeSpinTapedLanding' }),
  wheelFixture('wheel-max-bet', { kind: 'idle', bet: WHEEL_MAX_BET }),
  wheelFixture('wheel-bet-flip', { kind: 'flip' }),
  wheelFixture('wheel-hold', { kind: 'hold' }),
  wheelFixture('wheel-spinning', { kind: 'spinning' }),
  reveal('wheel-reveal-stabbed', 'stabbed_1', STAB_FRAME_MS),
  reveal('wheel-reveal-poisoned', 'poisoned_1'),
  reveal('wheel-reveal-vomit-blood', 'vomit_blood_1'),
  reveal('wheel-reveal-on-fire', 'set_on_fire'),
  reveal('wheel-reveal-frozen', 'frozen_solid'),
  reveal('wheel-reveal-robbed', 'robbed', ROBBED_FRAME_MS),
  reveal('wheel-reveal-pet', 'pet', PET_FRAME_MS),
  reveal('wheel-reveal-50k', 'gold_50k'),
  reveal('wheel-reveal-500k', 'gold_500k', JACKPOT_FRAME_MS),
  reveal('wheel-reveal-legendary-weapon', 'legendary_weapon_box'),
  reveal('wheel-reveal-free-handies', 'free_handies'),
  reveal('wheel-reveal-platinum-frost', 'platinum_box_frost'),
  reveal('wheel-reveal-platinum-ember', 'platinum_box_ember'),
  reveal('wheel-reveal-legendary-ring', 'legendary_box'),
  reveal('wheel-reveal-spin-again', 'spin_again_1'),
  reveal('wheel-reveal-10k', 'gold_10k', REVEAL_FRAME_MS, WHEEL_MAX_BET),
  reveal('wheel-reveal-gold-prize', 'gold_box', REVEAL_FRAME_MS, WHEEL_MAX_BET),
  reveal('wheel-reveal-25k', 'gold_25k', REVEAL_FRAME_MS, WHEEL_MAX_BET),
  reveal('wheel-reveal-silver-prize', 'silver_box', REVEAL_FRAME_MS, WHEEL_MAX_BET),
  reveal('wheel-reveal-heal', 'heal_and_gold', REVEAL_FRAME_MS, WHEEL_MAX_BET),
  prize('wheel-prize-legendary-weapon-carl', 'legendary_weapon_box', 'human'),
  prize('wheel-prize-legendary-weapon-donut', 'legendary_weapon_box', 'cat'),
  prize('wheel-prize-platinum-frost', 'platinum_box_frost', 'human'),
  prize('wheel-prize-platinum-ember', 'platinum_box_ember', 'cat'),
  prize('wheel-prize-legendary-signet', 'legendary_box', 'human'),
  prize('wheel-prize-gold', 'gold_box', 'human', WHEEL_MAX_BET),
  prize('wheel-prize-silver', 'silver_box', 'cat', WHEEL_MAX_BET),
  prize('wheel-prize-opening', 'legendary_weapon_box', 'human', WHEEL_MIN_BET, PRIZE_OPENING_MS),
  reveal('wheel-nothing-bulbs', 'nothing', NOTHING_BULBS_FRAME_MS),
  reveal('wheel-nothing', 'nothing', NOTHING_TEXT_FRAME_MS),
];
