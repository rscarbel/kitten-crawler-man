/**
 * Fixtures for the two mini-games that keep their own layouts: the Cloak & Dagger
 * Club's blackjack table (betting, mid-hand, a won hand, turned away) and the
 * keyboard-hero board (mid-song, a breached firewall, access granted, and a
 * Nightmare double note on its way down). Each is
 * the real system driven to that state on a fake clock. The table is the
 * club's own `tableSurface`, so the phone close-button audit tests the layout
 * the game ships; the board is painted through its `PaintTarget` entry point
 * at UI units, the way its surface does.
 */

import { HumanPlayer } from '../../../creatures/HumanPlayer';
import { CatPlayer } from '../../../creatures/CatPlayer';
import { TILE_SIZE } from '../../../core/constants';
import { createCasinoState } from '../../../core/club/CasinoState';
import { ClubCasinoSystem, type CasinoAction } from '../../../systems/ClubCasinoSystem';
import { CHIP_DENOMINATIONS } from '../../../systems/casino/BlackjackTable';
import { RANKS, SUITS, type Card, type Rank, type Suit } from '../../../systems/casino/Deck';
import { KeyboardHeroSystem } from '../../../systems/KeyboardHeroSystem';
import type { Difficulty } from '../../../core/difficulty/difficultyProfiles';
import {
  KEYBOARD_HERO_CHARTS,
  type KeyboardHeroChartNote,
} from '../../../systems/keyboardHeroChart';
import { KEYBOARD_HERO_GEOMETRY } from '../../../systems/keyboardHeroGeometry';
import { computeKeyboardHeroLayout } from '../../../systems/keyboardHeroLayout';
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
      const casinoState = createCasinoState();
      casinoState.casinoShoe = { cards: shoe(), cursor: 0 };
      const player = new HumanPlayer(0, 0, TILE_SIZE);
      player.coins = state === 'turned-away' ? BROKE : BANKROLL;
      const companion = new CatPlayer(1, 0, TILE_SIZE);
      const casino = new ClubCasinoSystem(null, casinoState, () => now);
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

      const table = casino.tableSurface(name, {
        active: () => player,
        companion: () => companion,
      });
      const surface: Surface = {
        ...table,
        isOpen: () => shown() && table.isOpen(),
      };
      return [surface];
    },
  };
}

type BoardState = 'mid-song' | 'breached' | 'granted' | 'double-note';

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
/**
 * How long before the first double note lands the capture sits: far enough up
 * the lanes that the rung joining the pair is clear of the receptors.
 */
const DOUBLE_NOTE_CAPTURE_LEAD_MS = 520;
/** How far into the ACCESS GRANTED flourish the capture sits. */
const FLOURISH_CAPTURE_MS = 350;
const LANE_KEYS = ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight'] as const;
const LANE_COUNT = LANE_KEYS.length;

function laneKey(lane: number): string {
  return LANE_KEYS[lane % LANE_COUNT] ?? LANE_KEYS[0];
}

/**
 * A lane with no note anywhere near `pressMs`, so pressing it is a miss
 * whatever the chart holds — the neighbouring lane is not safe, because on
 * Crawler and Nightmare a double note's partner can be sitting in it.
 */
function emptyLaneAt(
  notes: readonly KeyboardHeroChartNote[],
  pressMs: number,
  difficulty: Difficulty,
): number {
  const windowMs = KEYBOARD_HERO_GEOMETRY[difficulty].hitWindowMs;
  const busy = new Set<number>(
    notes.filter((note) => Math.abs(note.timeMs - pressMs) <= windowMs).map((note) => note.column),
  );
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    if (!busy.has(lane)) return lane;
  }
  throw new Error(`every lane holds a note at ${pressMs} ms`);
}

function endMsFor(state: BoardState, notes: readonly KeyboardHeroChartNote[]): number {
  switch (state) {
    case 'mid-song':
      return MID_SONG_MS;
    case 'breached':
      return BREACH_MS;
    case 'granted':
      return SONG_OVERRUN_MS;
    case 'double-note': {
      const firstChord = notes.find((note) => note.chordId !== undefined);
      if (firstChord === undefined) throw new Error('this chart has no double note to capture');
      return firstChord.timeMs - DOUBLE_NOTE_CAPTURE_LEAD_MS;
    }
  }
}

function playBoard(
  board: KeyboardHeroSystem,
  state: BoardState,
  difficulty: Difficulty,
  advance: (ms: number) => void,
): void {
  const notes = KEYBOARD_HERO_CHARTS[difficulty].notes;
  const endMs = endMsFor(state, notes);
  let missesLeft =
    state === 'mid-song' ? MID_SONG_MISSES : state === 'breached' ? BREACH_MISSES : 0;
  let songMs = 0;
  let next = 0;
  let succeeded = false;
  board.start(
    difficulty,
    () => undefined,
    () => undefined,
  );
  while (songMs < endMs && !succeeded) {
    songMs += BOARD_FRAME_MS;
    advance(BOARD_FRAME_MS);
    board.update(songMs);
    while (next < notes.length && notes[next].timeMs <= songMs) {
      const note = notes[next];
      const stretchMs = state === 'breached' ? BREACH_MISS_STRETCH_MS : MISS_STRETCH_MS;
      const inMissStretch = songMs > endMs - stretchMs && missesLeft > 0;
      if (inMissStretch) {
        missesLeft--;
        board.handleKeyDown(laneKey(emptyLaneAt(notes, note.timeMs, difficulty)), note.timeMs);
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

function boardFixture(name: string, state: BoardState, difficulty: Difficulty): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      let now = 0;
      const board = new KeyboardHeroSystem(() => now);
      playBoard(board, state, difficulty, (ms) => {
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
  boardFixture('keyboard-hero-mid-song', 'mid-song', 'normal'),
  boardFixture('keyboard-hero-breached', 'breached', 'normal'),
  boardFixture('keyboard-hero-granted', 'granted', 'normal'),
  boardFixture('keyboard-hero-double-note', 'double-note', 'hard'),
];
