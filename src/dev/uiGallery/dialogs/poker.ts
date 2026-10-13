/**
 * Fixtures for the casino's game picker and the Texas Hold'em screens: the
 * buy-in with one tier out of reach, the table mid-deal, the player's turn,
 * the raise sizing tray, a showdown that split into side pots, the
 * fold-and-leave question, the bust prompt, the game-over prompt, the hand
 * history and a regular's
 * seat card. Each drives a real `ClubPokerSystem` on a fake clock with a
 * seeded shuffle, so the screens show what the game ships.
 */

import { HumanPlayer } from '../../../creatures/HumanPlayer';
import { CatPlayer } from '../../../creatures/CatPlayer';
import { TILE_SIZE } from '../../../core/constants';
import { ClubPokerSystem, POKER_MIN_BUY_IN } from '../../../systems/ClubPokerSystem';
import { TABLE_MAXIMUM, TABLE_MINIMUM } from '../../../systems/casino/BlackjackTable';
import { POKER_DEV_SEED } from '../../../systems/casino/poker/npc/personality';
import { EMPTY_PLAYER_READ } from '../../../systems/casino/poker/npc/playerRead';
import { REGULAR_IDS } from '../../../systems/casino/poker/npc/regulars';
import { PokerRules } from '../../../ui/screens/dialogs/PokerRules';
import { SEAT_INFO_BIO_HANDS } from '../../../ui/casino/pokerSeatInfo';
import type { PokerReads } from '../../../core/ClubMembership';
import { POKER_STAKES } from '../../../systems/casino/poker/pokerStakes';
import { buildPots } from '../../../systems/casino/poker/pots';
import {
  PLAYER_SEAT,
  POKER_SEAT_COUNT,
  type PokerTable,
} from '../../../systems/casino/poker/PokerTable';
import { mulberry32 } from '../../../sprites/person/rng';
import type { Surface } from '../../../ui/core/UiRoot';
import { casinoGamePickerSurface } from '../../../ui/screens/dialogs/casinoGamePicker';
import type { DialogFixture } from './fixture';

/** Enough for the card room but not the high rollers, so one tier shows "Need N more". */
const MID_BANKROLL = POKER_STAKES.card_room.buyIn + POKER_STAKES.penny.buyIn;
/** The shuffle stream: fixed so every render deals the same hands. */
const FIXTURE_SHUFFLE_SEED = 0x5eed;

/** One clock step while the table plays its beats out. */
const TABLE_STEP_MS = 50;
/** Ceiling on steps spent waiting for the player's first decision. */
const MAX_STEPS_TO_TURN = 2000;
/** Ceiling on steps spent shoving until the player's stack is gone. */
const MAX_STEPS_TO_BUST = 40000;
/** Ceiling on steps spent playing hands until one ends in a showdown with side pots. */
const MAX_STEPS_TO_SIDE_POT = 60000;
/**
 * Steps of the clock after a side pot is awarded: every pot has swept home and
 * the winners are lit, one step before the table moves on (and, here, busts
 * the player who shoved).
 */
const SHOWDOWN_SETTLE_STEPS = 25;
/** Steps after the player's turn comes up, so the action bar has slid in and the cards have turned. */
const TURN_SETTLE_STEPS = 12;
/** Regulars who have acted before the mid-deal fixture is taken, with the next one thinking. */
const PREFLOP_ACTIONS_SEEN = 2;
/** Hands played before the history is opened: enough rows to scroll on a phone. */
const HISTORY_FIXTURE_HANDS = 6;
/** Ceiling on steps spent playing those hands. */
const MAX_STEPS_TO_HISTORY = 60000;
/** The player calls anything up to this many big blinds and folds to more, so hands vary. */
const HISTORY_CALL_BIG_BLINDS = 4;
/** Long enough for the leaving regulars' plates to fade and the last hand's cards to clear. */
const GAME_OVER_SETTLE_STEPS = 60;
/** The regular across the table who stays in the short-handed fixture, beside the one in seat 1. */
const SHORT_HANDED_FAR_SEAT = 4;
/** Every chair the short-handed fixture empties after the first hand, leaving three seats in play. */
const SHORT_HANDED_EMPTY_SEATS = Array.from({ length: POKER_SEAT_COUNT }, (_, seat) => seat).filter(
  (seat) => seat !== PLAYER_SEAT && seat !== 1 && seat !== SHORT_HANDED_FAR_SEAT,
);
/** Hands the banter fixture plays at most, waiting for a regular to speak. */
const MAX_HANDS_TO_BANTER = 20;
/** Long enough for a bubble to finish fading in. */
const BUBBLE_SETTLE_MS = 400;
/** The regular whose card the seat-info fixture opens: the first seat clockwise from the player. */
const SEAT_INFO_FIXTURE_SEAT = 1;
/** A loose, raise-happy regular who has been caught bluffing twice, as the seat card describes them. */
const SEAT_INFO_EXTRA_HANDS = 14;
const SEAT_INFO_VPIP_HANDS = 9;
const SEAT_INFO_PFR_HANDS = 6;
const SEAT_INFO_AGGRESSIVE_ACTIONS = 14;
const SEAT_INFO_PASSIVE_ACTIONS = 5;
const SEAT_INFO_SHOWDOWNS = 5;
const SEAT_INFO_BLUFFS = 2;

type PokerState =
  | 'buy-in'
  | 'preflop'
  | 'player-turn'
  | 'raise-tray'
  | 'skipping'
  | 'showdown-side-pot'
  | 'leave-confirm'
  | 'bust'
  | 'game-over'
  | 'short-handed'
  | 'history'
  | 'seat-info'
  | 'banter';

/**
 * Shoves at every decision until the player busts, stepping the table's own
 * clock. False when the bound ran out first. Shared with the menu audit, which
 * needs a busted table to open the rebuy prompt.
 */
export function playUntilBust(table: PokerTable): boolean {
  for (let step = 0; step < MAX_STEPS_TO_BUST; step++) {
    if (table.phase === 'player_busted') return true;
    const legal = table.playerLegalActions();
    if (legal !== null) {
      if (legal.allIn !== null) table.playerAct({ kind: 'all_in' });
      else if (legal.call !== null) table.playerAct({ kind: 'call' });
      else if (legal.canCheck) table.playerAct({ kind: 'check' });
      else table.playerAct({ kind: 'fold' });
    }
    table.update(TABLE_STEP_MS);
  }
  return table.phase === 'player_busted';
}

/**
 * Plays one hand, then has every regular stand up between hands, so the next
 * deal finds nobody to play and the game ends. False when the bound ran out
 * first. Shared with the menu audit, which needs a finished game to open the
 * game-over prompt.
 */
export function playUntilGameOver(table: PokerTable): boolean {
  for (let step = 0; step < MAX_STEPS_TO_BUST && table.phase !== 'game_over'; step++) {
    if (table.phase === 'between_hands' && table.handNumber >= 1) {
      for (const seat of table.seats) if (!seat.isPlayer) table.vacateSeat(seat.index);
    }
    const legal = table.playerLegalActions();
    if (legal !== null) table.playerAct(legal.canCheck ? { kind: 'check' } : { kind: 'fold' });
    if (table.phase === 'player_busted') table.rebuy();
    table.update(TABLE_STEP_MS);
  }
  return table.phase === 'game_over';
}

function pokerFixture(name: string, state: PokerState): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      let now = 0;
      const player = new HumanPlayer(0, 0, TILE_SIZE);
      player.coins = MID_BANKROLL;
      const companion = new CatPlayer(1, 0, TILE_SIZE);
      const poker = new ClubPokerSystem(
        null,
        POKER_DEV_SEED,
        () => now,
        mulberry32(FIXTURE_SHUFFLE_SEED),
        {
          pokerFast: false,
          pokerShowCards: false,
          pokerReads: {},
          pokerNotes: state === 'seat-info' ? SEAT_INFO_FIXTURE_NOTES : {},
        },
        mulberry32(FIXTURE_SHUFFLE_SEED),
      );
      const sit = (): void => {
        poker.buyIn('penny', player, companion);
        poker.dismissRules();
      };
      const step = (): void => {
        now += TABLE_STEP_MS;
        poker.update();
      };
      const stepUntil = (done: () => boolean, maxSteps: number): void => {
        for (let i = 0; i < maxSteps && !done(); i++) step();
      };
      if (state === 'buy-in') {
        poker.openBuyIn();
      } else if (state === 'preflop') {
        sit();
        stepUntil(() => {
          const table = poker.pokerTable;
          if (table === null || table.awaitingPlayer) return true;
          const regularThinking = table.actingSeat !== null && table.actingSeat !== PLAYER_SEAT;
          return regularThinking && table.history.length >= PREFLOP_ACTIONS_SEEN;
        }, MAX_STEPS_TO_TURN);
        if (poker.pokerTable?.awaitingPlayer === true) {
          for (let i = 0; i < TURN_SETTLE_STEPS; i++) step();
        }
      } else if (state === 'showdown-side-pot') {
        sit();
        playUntilSidePotShowdown(poker, step, player, companion);
        for (let i = 0; i < SHOWDOWN_SETTLE_STEPS; i++) step();
      } else if (state === 'history') {
        sit();
        playHands(poker, step, HISTORY_FIXTURE_HANDS);
        poker.openHistory();
      } else if (state === 'banter') {
        sit();
        // Taken once the bubble has faded in and no chip or card is still in the air.
        playHands(poker, step, MAX_HANDS_TO_BANTER, () => {
          const bubble = poker.speechBubble;
          return bubble !== null && bubble.ageMs >= BUBBLE_SETTLE_MS && poker.flightsLanded;
        });
      } else if (state === 'short-handed') {
        sit();
        stepUntil(() => {
          const table = poker.pokerTable;
          if (table === null) return true;
          const legal = table.playerLegalActions();
          if (legal !== null) poker.act(legal.canCheck ? { kind: 'check' } : { kind: 'fold' });
          if (table.phase !== 'between_hands' || table.handNumber < 1) return false;
          for (const seat of SHORT_HANDED_EMPTY_SEATS) table.vacateSeat(seat);
          return true;
        }, MAX_STEPS_TO_HISTORY);
        stepUntil(() => poker.pokerTable?.awaitingPlayer === true, MAX_STEPS_TO_TURN);
        for (let i = 0; i < TURN_SETTLE_STEPS; i++) step();
      } else if (state === 'seat-info') {
        sit();
        stepUntil(() => poker.pokerTable?.awaitingPlayer === true, MAX_STEPS_TO_TURN);
        poker.openSeatInfo(SEAT_INFO_FIXTURE_SEAT);
      } else {
        sit();
        stepUntil(() => poker.pokerTable?.awaitingPlayer === true, MAX_STEPS_TO_TURN);
        for (let i = 0; i < TURN_SETTLE_STEPS; i++) step();
        if (state === 'raise-tray') poker.openRaiseTray();
        if (state === 'skipping') {
          poker.act({ kind: 'fold' });
          poker.skip();
          step();
        }
      }
      const table = poker.pokerTable;
      if (state === 'leave-confirm') poker.requestLeave(player);
      if (state === 'bust' && table !== null) {
        playUntilBust(table);
        step();
      }
      if (state === 'game-over' && table !== null) {
        if (!playUntilGameOver(table)) {
          throw new Error('the game-over fixture never saw the last regular leave');
        }
        for (let i = 0; i < GAME_OVER_SETTLE_STEPS; i++) step();
      }

      const seat = { active: () => player, companion: () => companion };
      const surfaces: Surface[] = [
        poker.buyInSurface(`${name}-buy-in`, seat),
        poker.tableSurface(`${name}-table`, seat),
        poker.historySurface(`${name}-history`),
        poker.seatInfoSurface(`${name}-seat-info`),
        poker.rulesSurface(`${name}-rules`),
        poker.bustSurface(`${name}-bust`, seat),
        poker.gameOverSurface(`${name}-game-over`, seat),
        poker.leaveConfirmSurface(`${name}-leave`),
      ];
      return surfaces.map((surface) => ({
        ...surface,
        isOpen: () => shown() && surface.isOpen(),
      }));
    },
  };
}

/**
 * Plays hands — the player calls everything — until one is being awarded
 * after a showdown in which the chips split into a main pot and side pots.
 * Rebuys when the player busts, so the search never stalls on the prompt.
 */
function playUntilSidePotShowdown(
  poker: ClubPokerSystem,
  step: () => void,
  player: HumanPlayer,
  companion: CatPlayer,
): boolean {
  for (let i = 0; i < MAX_STEPS_TO_SIDE_POT; i++) {
    const table = poker.pokerTable;
    if (table === null) return false;
    if (table.phase === 'player_busted') poker.rebuy(player, companion);
    const legal = table.playerLegalActions();
    if (legal !== null) {
      if (legal.call !== null) poker.act({ kind: 'call' });
      else if (legal.canCheck) poker.act({ kind: 'check' });
      else if (legal.allIn !== null) poker.act({ kind: 'all_in' });
      else poker.act({ kind: 'fold' });
    }
    step();
    if (table.phase === 'awarding' && sidePotShowdown(table)) return true;
  }
  return false;
}

/** Plays `hands` hands, or until `done`, calling small bets and folding to big ones, so the rows differ. */
function playHands(
  poker: ClubPokerSystem,
  step: () => void,
  hands: number,
  done: () => boolean = () => false,
): void {
  for (let i = 0; i < MAX_STEPS_TO_HISTORY && poker.handHistory.length < hands && !done(); i++) {
    const table = poker.pokerTable;
    if (table === null || table.phase === 'player_busted') return;
    const legal = table.playerLegalActions();
    if (legal !== null) {
      const cheap =
        legal.call !== null && legal.call <= table.stakes.bigBlind * HISTORY_CALL_BIG_BLINDS;
      if (legal.canCheck) poker.act({ kind: 'check' });
      else if (cheap) poker.act({ kind: 'call' });
      else poker.act({ kind: 'fold' });
    }
    step();
  }
}

/**
 * Notes on every regular as if the player had sat with them a long while,
 * so the seat card shows its figures and the settled read.
 */
const SEAT_INFO_FIXTURE_NOTES: PokerReads = Object.fromEntries(
  REGULAR_IDS.map((id) => [
    id,
    {
      ...EMPTY_PLAYER_READ,
      handsSeen: SEAT_INFO_BIO_HANDS + SEAT_INFO_EXTRA_HANDS,
      hands: SEAT_INFO_BIO_HANDS,
      vpipHands: SEAT_INFO_VPIP_HANDS,
      pfrHands: SEAT_INFO_PFR_HANDS,
      aggressiveActions: SEAT_INFO_AGGRESSIVE_ACTIONS,
      passiveActions: SEAT_INFO_PASSIVE_ACTIONS,
      showdownsShown: SEAT_INFO_SHOWDOWNS,
      bluffsShown: SEAT_INFO_BLUFFS,
    },
  ]),
);

function sidePotShowdown(table: PokerTable): boolean {
  const shown = table.seats.filter((seat) => seat.faceUp).length;
  const pots = buildPots(
    table.seats.map((seat) => seat.contributed),
    table.seats.map((seat) => !seat.inHand || seat.folded),
  );
  return pots.length > 1 && shown >= 2 && table.seats[PLAYER_SEAT].faceUp;
}

function pickerFixture(name: string, canBuyIntoPoker: boolean): DialogFixture {
  return {
    name,
    surfaces: (shown) => [
      casinoGamePickerSurface({
        id: name,
        isOpen: shown,
        minPokerBuyIn: POKER_MIN_BUY_IN,
        blackjackBets: { min: TABLE_MINIMUM, max: TABLE_MAXIMUM },
        canBuyIntoPoker: () => canBuyIntoPoker,
        onSlots: () => undefined,
        onPoker: () => undefined,
        onBlackjack: () => undefined,
        onWheel: () => undefined,
        onClose: () => undefined,
      }),
    ],
  };
}

const RULES_RANKINGS_PAGE = 1;

function rulesFixture(name: string, page: 'first' | 'rankings' | 'last'): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const rules = new PokerRules();
      if (page === 'first') rules.show(true);
      else rules.showPage(page === 'rankings' ? RULES_RANKINGS_PAGE : rules.pageCount - 1);
      const surface = rules.surface(name);
      return [{ ...surface, isOpen: () => shown() && surface.isOpen() }];
    },
  };
}

export const FIXTURES: readonly DialogFixture[] = [
  pickerFixture('casino-game-picker', true),
  pickerFixture('casino-game-picker-broke', false),
  pokerFixture('poker-buy-in', 'buy-in'),
  pokerFixture('poker-preflop', 'preflop'),
  pokerFixture('poker-player-turn', 'player-turn'),
  pokerFixture('poker-raise-tray', 'raise-tray'),
  pokerFixture('poker-skipping', 'skipping'),
  pokerFixture('poker-showdown-side-pot', 'showdown-side-pot'),
  pokerFixture('poker-leave-confirm', 'leave-confirm'),
  pokerFixture('poker-bust', 'bust'),
  pokerFixture('poker-game-over', 'game-over'),
  pokerFixture('poker-short-handed', 'short-handed'),
  pokerFixture('poker-history', 'history'),
  pokerFixture('poker-seat-info', 'seat-info'),
  pokerFixture('poker-banter', 'banter'),
  rulesFixture('poker-rules', 'first'),
  rulesFixture('poker-rules-rankings', 'rankings'),
  rulesFixture('poker-rules-last', 'last'),
];
