/**
 * Fixtures for the two mini-games that keep their own layouts: the Desperado
 * Club's blackjack table (betting, mid-hand, a won hand, turned away) and the
 * keyboard-hero board (mid-song, a breached firewall, access granted). Each is
 * the real system driven to that state on a fake clock and painted through its
 * `PaintTarget` entry point at UI units, the way a surface would.
 */

import { HumanPlayer } from '../../../creatures/HumanPlayer';
import { CatPlayer } from '../../../creatures/CatPlayer';
import { TILE_SIZE } from '../../../core/constants';
import { createClubMembership } from '../../../core/ClubMembership';
import { ClubCasinoSystem, type CasinoAction } from '../../../systems/ClubCasinoSystem';
import { CHIP_DENOMINATIONS } from '../../../systems/casino/BlackjackTable';
import { RANKS, SUITS, type Card, type Rank, type Suit } from '../../../systems/casino/Deck';
import { KeyboardHeroSystem } from '../../../systems/KeyboardHeroSystem';
import { KEYBOARD_HERO_CHART } from '../../../systems/keyboardHeroChart';
import { computeKeyboardHeroLayout } from '../../../systems/keyboardHeroLayout';
import { casinoFit, fitRectToScreen } from '../../../ui/casino/casinoLayout';
import type { Surface } from '../../../ui/core/UiRoot';
import type { DialogFixture } from './fixture';

const [SMALL_CHIP, MEDIUM_CHIP] = CHIP_DENOMINATIONS;

/** A table-sized bankroll, and one too thin to sit down with. */
const BANKROLL = 340;
const BROKE = 4;

/** One clock step while the table plays its beats and animations out. */
const TABLE_STEP_MS = 50;
/** Steps that see any deal, flight or dealer turn through to rest. */
const TABLE_SETTLE_STEPS = 80;

/** The opening deal goes player, dealer, player, dealer; the hit comes next. */
const STACKED_DECK: readonly Card[] = [
  card('9', 'hearts'),
  card('10', 'spades'),
  card('7', 'diamonds'),
  card('6', 'clubs'),
  card('3', 'hearts'),
  card('K', 'clubs'),
];

function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function shoe(): Card[] {
  const stacked = new Set(STACKED_DECK.map((c) => `${c.rank}${c.suit}`));
  const rest: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      if (!stacked.has(`${rank}${suit}`)) rest.push(card(rank, suit));
    }
  }
  return [...STACKED_DECK, ...rest];
}

type TableState = 'betting' | 'mid-hand' | 'won' | 'turned-away';

function casinoFixture(name: string, state: TableState): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      let now = 0;
      const membership = createClubMembership();
      membership.casinoShoe = { cards: shoe(), cursor: 0 };
      const player = new HumanPlayer(0, 0, TILE_SIZE);
      player.coins = state === 'turned-away' ? BROKE : BANKROLL;
      const companion = new CatPlayer(1, 0, TILE_SIZE);
      const casino = new ClubCasinoSystem(null, membership, () => now);
      const settle = (): void => {
        for (let i = 0; i < TABLE_SETTLE_STEPS; i++) {
          now += TABLE_STEP_MS;
          casino.update(player, companion);
        }
      };
      const act = (action: CasinoAction): void => {
        casino.act(action, player, companion);
        settle();
      };
      casino.openTable(player, companion);
      casino.dismissRules();
      settle();
      if (state !== 'turned-away') {
        act({ kind: 'chip', denomination: MEDIUM_CHIP });
        act({ kind: 'chip', denomination: SMALL_CHIP });
      }
      if (state === 'mid-hand' || state === 'won') act({ kind: 'deal' });
      if (state === 'won') {
        act({ kind: 'hit' });
        act({ kind: 'stand' });
      }

      const surface: Surface = {
        id: name,
        band: 'modal',
        haltsWorld: true,
        locksKeyboard: true,
        isOpen: () => shown() && casino.open,
        render: (ui) => {
          const fit = casinoFit(ui.screen.w, ui.screen.h);
          casino.paintTable(
            {
              target: ui,
              viewportW: ui.screen.w,
              viewportH: ui.screen.h,
              fit,
              keyHints: ui.density === 'pointer',
              control: (control) =>
                ui.hit(`${name}/${control.id}`, fitRectToScreen(fit, control.rect), {
                  onTap: () => casino.act(control.action, player, companion),
                  disabled: control.disabled,
                  primary: control.primary,
                  focusable: control.focusable,
                }),
              focusGroup: () => undefined,
            },
            player,
            companion,
          );
        },
      };
      return [surface];
    },
  };
}

type BoardState = 'mid-song' | 'breached' | 'granted';

/** One fake frame of song and wall clock. */
const BOARD_FRAME_MS = 16;
/** Where the mid-song capture sits, and where the breached run gives way. */
const MID_SONG_MS = 14000;
const BREACH_MS = 9000;
/** A run is driven past the song's end; the success flourish stops it first. */
const SONG_OVERRUN_MS = 40000;
/** Wrong-lane presses played into the run's last stretch: one forgiven, or both strikes. */
const MID_SONG_MISSES = 1;
const BREACH_MISSES = 2;
/**
 * The stretch before the capture that the misses land in. The breach's is short
 * so its fatal lane is still burning red when the board is captured.
 */
const MISS_STRETCH_MS = 3000;
const BREACH_MISS_STRETCH_MS = 1500;
/** Spread a few presses off the beat so both PERFECT and HIT grades turn up. */
const PRESS_SPREAD_MS = 30;
const PRESS_SPREAD_STEPS = 3;
/** How far into the ACCESS GRANTED flourish the capture sits. */
const FLOURISH_CAPTURE_MS = 350;
const LANE_KEYS = ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight'] as const;
const LANE_COUNT = LANE_KEYS.length;

function laneKey(lane: number): string {
  return LANE_KEYS[lane % LANE_COUNT] ?? LANE_KEYS[0];
}

function playBoard(
  board: KeyboardHeroSystem,
  state: BoardState,
  advance: (ms: number) => void,
): void {
  const endMs =
    state === 'mid-song' ? MID_SONG_MS : state === 'breached' ? BREACH_MS : SONG_OVERRUN_MS;
  let missesLeft =
    state === 'mid-song' ? MID_SONG_MISSES : state === 'breached' ? BREACH_MISSES : 0;
  let songMs = 0;
  let next = 0;
  let succeeded = false;
  board.start(
    () => undefined,
    () => undefined,
  );
  while (songMs < endMs && !succeeded) {
    songMs += BOARD_FRAME_MS;
    advance(BOARD_FRAME_MS);
    board.update(songMs);
    while (next < KEYBOARD_HERO_CHART.length && KEYBOARD_HERO_CHART[next].timeMs <= songMs) {
      const note = KEYBOARD_HERO_CHART[next];
      const stretchMs = state === 'breached' ? BREACH_MISS_STRETCH_MS : MISS_STRETCH_MS;
      const inMissStretch = songMs > endMs - stretchMs && missesLeft > 0;
      if (inMissStretch) {
        missesLeft--;
        board.handleKeyDown(laneKey(note.column + 1), note.timeMs);
      } else {
        const offset = (next % PRESS_SPREAD_STEPS) * PRESS_SPREAD_MS;
        board.handleKeyDown(laneKey(note.column), note.timeMs + offset);
      }
      next++;
    }
    succeeded = board.accessGrantedPending;
  }
  if (succeeded) advance(FLOURISH_CAPTURE_MS);
}

function boardFixture(name: string, state: BoardState): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      let now = 0;
      const board = new KeyboardHeroSystem(() => now);
      playBoard(board, state, (ms) => {
        now += ms;
      });
      const surface: Surface = {
        id: name,
        band: 'modal',
        haltsWorld: true,
        locksKeyboard: true,
        isOpen: shown,
        render: (ui) => {
          const layout = computeKeyboardHeroLayout(
            ui.screen.w,
            ui.screen.h,
            ui.density === 'touch',
          );
          board.paint(ui, layout, ui.screen.w, ui.screen.h);
        },
      };
      return [surface];
    },
  };
}

export const FIXTURES: readonly DialogFixture[] = [
  casinoFixture('casino-betting', 'betting'),
  casinoFixture('casino-mid-hand', 'mid-hand'),
  casinoFixture('casino-won', 'won'),
  casinoFixture('casino-turned-away', 'turned-away'),
  boardFixture('keyboard-hero-mid-song', 'mid-song'),
  boardFixture('keyboard-hero-breached', 'breached'),
  boardFixture('keyboard-hero-granted', 'granted'),
];
