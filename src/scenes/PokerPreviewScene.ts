/**
 * Localhost-only harness for reviewing the Texas Hold'em table, reached via
 * `?poker` in `devBootScene`. Ships no behaviour to players, and plays no music.
 *
 * Five tabs:
 *  - **Table** — a real `ClubPokerSystem` on its own clock and `UiRoot`,
 *    letterboxed into a chosen viewport, seated at a chosen tier and seed, with
 *    pause, step and fast-forward.
 *  - **Hands** — all ten hand ranks and the evaluator's tricky showdowns,
 *    labelled by `evaluateBest` and drawn with real card faces.
 *  - **Seats** — every regular's seat plate (and the player's, and an empty
 *    seat) in every state the plate painter knows.
 *  - **Personalities** — what one seed rolls for every regular: archetype,
 *    parameters and tells.
 *  - **Sim** — the engine invariants `verify:poker` gates on, run live under
 *    the current seed, one line per check.
 */

import { crawlerName } from '../characters/characters';
import { setViewportSize, viewportHeight, viewportWidth } from '../core/rendering/Viewport';
import { settings } from '../core/input/Settings';
import { TILE_SIZE } from '../core/constants';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import { mulberry32, subSeed } from '../sprites/person/rng';
import { ClubPokerSystem } from '../systems/ClubPokerSystem';
import type { CasinoSeat } from '../systems/ClubCasinoSystem';
import type { Card } from '../systems/casino/Deck';
import { evaluateBest, handRank } from '../systems/casino/poker/handEvaluator';
import {
  comparisonChecks,
  knownHandChecks,
  newTally,
  parseCards,
  runSimStream,
  simTallyChecks,
  type PokerCheck,
  type SimTally,
} from '../systems/casino/poker/pokerInvariants';
import {
  POKER_STAKES,
  POKER_TIER_IDS,
  type PokerTierId,
} from '../systems/casino/poker/pokerStakes';
import type { PokerTable } from '../systems/casino/poker/PokerTable';
import {
  POKER_DEV_SEED,
  rollPokerPersonalities,
  type PokerPersonalities,
  type PokerPersonality,
} from '../systems/casino/poker/npc/personality';
import { listAt } from '../systems/casino/poker/npc/listAt';
import { UNIT_PARAMETERS } from '../systems/casino/poker/npc/profiles';
import { POKER_REGULARS, REGULAR_IDS } from '../systems/casino/poker/npc/regulars';
import type { PokerTell, TellSignal } from '../systems/casino/poker/npc/tells';
import { CARD_ASPECT, drawCardFace } from '../ui/casino/PlayingCard';
import { pokerTableColors } from '../ui/casino/pokerColors';
import { computePokerLayout, type PokerSeatLayout } from '../ui/casino/pokerLayout';
import {
  paintSeatPlate,
  type SeatAvatar,
  type SeatPlateModel,
  type SeatTag,
} from '../ui/casino/pokerSeat';
import { contains, inset, type Rect } from '../ui/core/geom';
import { PRIMARY_BUTTON } from '../ui/core/pointer';
import {
  UiRoot,
  type KeyModifiers,
  type Surface,
  type Ui,
  type WorldGesture,
} from '../ui/core/UiRoot';
import { NO_INSETS, type ViewportInput } from '../ui/core/viewport';
import type { Density } from '../ui/theme/tokens';
import { previewInk } from '../ui/theme/previewInk';
import { worldText } from '../ui/world/worldText';
import { SearchInput, searchField } from '../ui/widgets/searchField';
import { scrollView } from '../ui/widgets/scrollView';
import { lineHeightOf, measureTextHeight, text } from '../ui/widgets/text';
import type { TextRole } from '../ui/theme/skins';
import { PreviewScene, type PreviewControl } from './PreviewScene';

const BG_COLOR = previewInk.casino.backdrop;
const PANEL_COLOR = previewInk.casino.panel;
const SUBLABEL_COLOR = previewInk.casino.sublabel;

const MARGIN = 24;
const SMALL_LABEL_SIZE = 10;
/** Gap between the header and the tab's content, in canvas pixels. */
const CONTENT_GAP = 16;
/** Room under the letterboxed table for its caption line. */
const TABLE_CAPTION_ROOM = 18;

const TABS = ['Table', 'Hands', 'Seats', 'Personalities', 'Sim'] as const;
type PreviewTab = (typeof TABS)[number];

const BODY_SURFACE_ID = 'poker-preview-body';
const SEED_FIELD_ID = 'seed';

const HEX_RADIX = 16;
const SEED_HEX_DIGITS = 8;
const PERCENT = 100;
/** Two decimals is enough to tell rolled parameters apart at a glance. */
const PARAMETER_DECIMALS = 2;

// ── Table tab ──────────────────────────────────────────────────────────────

interface PreviewViewport {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

const VIEWPORT_MATRIX: ReadonlyArray<PreviewViewport> = [
  { label: '360×640', width: 360, height: 640 },
  { label: '390×844', width: 390, height: 844 },
  { label: '568×320', width: 568, height: 320 },
  { label: '844×390', width: 844, height: 390 },
  { label: '768×1024', width: 768, height: 1024 },
  { label: '1280×720', width: 1280, height: 720 },
  { label: '1920×1080', width: 1920, height: 1080 },
];
/** Opens on the desktop layout most reviewers see first. */
const DEFAULT_VIEWPORT_LABEL = '1280×720';
const DEFAULT_VIEWPORT_INDEX = Math.max(
  0,
  VIEWPORT_MATRIX.findIndex((viewport) => viewport.label === DEFAULT_VIEWPORT_LABEL),
);

/** The dev party's purse holds this many of the seated tier's buy-ins, so a few rebuys never run dry. */
const DEV_BANKROLL_BUY_INS = 5;
/** Keeps the table's shuffle stream apart from everything else the seed drives. */
const SHUFFLE_SALT = 0x5e47;

const MS_PER_SECOND = 1000;
const PREVIEW_UPDATES_PER_SECOND = 60;
/** Table time one scene update covers at normal speed. */
const UPDATE_MS = MS_PER_SECOND / PREVIEW_UPDATES_PER_SECOND;
/** The table's own clock refuses frames longer than 100 ms, so fast-forward feeds it in steps below that. */
const TABLE_STEP_MS = 50;
const NORMAL_SPEED = 1;
const FAST_SPEED = 4;
const FASTEST_SPEED = 16;
const SPEEDS = [NORMAL_SPEED, FAST_SPEED, FASTEST_SPEED] as const;
/** How far Step or "To my turn" may run the clock before giving up on a change. */
const MAX_SKIP_MS = 60_000;

/** A pointer id the hover feed uses, apart from every real gesture's. */
const HOVER_POINTER_ID = -1;

// ── Hands tab ──────────────────────────────────────────────────────────────

const CARD_WIDTH = 30;
const CARD_HEIGHT = CARD_WIDTH * CARD_ASPECT;
const CARD_GAP = 4;
const BEST_FIVE_GAP = 16;

interface RankExample {
  readonly name: string;
  readonly cards: string;
}

const RANK_EXAMPLES: ReadonlyArray<RankExample> = [
  { name: 'Royal flush', cards: 'As Ks Qs Js 10s' },
  { name: 'Straight flush', cards: '9h 8h 7h 6h 5h' },
  { name: 'Four of a kind', cards: 'Kc Kd Kh Ks 7d' },
  { name: 'Full house', cards: 'Qc Qd Qh 9s 9d' },
  { name: 'Flush', cards: 'Ah Jh 9h 6h 3h' },
  { name: 'Straight', cards: '8c 7d 6h 5s 4c' },
  { name: 'Three of a kind', cards: '7c 7d 7h Ks 2c' },
  { name: 'Two pair', cards: 'Kc Kd 7h 7s 3c' },
  { name: 'Pair', cards: 'Kc Kd 4h 7s 9c' },
  { name: 'High card', cards: 'Ac Qd 9h 7s 4c' },
];

type ShowdownVerdict = 'first' | 'second' | 'split';

interface ShowdownCase {
  readonly title: string;
  readonly board: string;
  readonly hands: readonly [string, string];
  readonly expected: ShowdownVerdict;
}

const SHOWDOWN_CASES: ReadonlyArray<ShowdownCase> = [
  {
    title: 'The wheel is the lowest straight',
    board: '3h 4s 5c 9d Kh',
    hands: ['Ac 2d', '6c 7d'],
    expected: 'second',
  },
  {
    title: 'Same pair, the kicker decides',
    board: 'Ah 9c 7d 4s 2h',
    hands: ['Ac Kd', 'Ad Qs'],
    expected: 'first',
  },
  {
    title: 'Three pairs: the kicker can beat the third pair',
    board: 'Kh Kd 7c 7s 5d',
    hands: ['5c 6h', 'Qc 2h'],
    expected: 'second',
  },
  {
    title: 'Counterfeited: the board pairs over a pocket pair',
    board: 'Kh Kd 9s 9c 2h',
    hands: ['6c 6d', 'Ac 3d'],
    expected: 'second',
  },
  {
    title: 'Flushes compare all five cards',
    board: 'Ah Kh 9h 2c 3d',
    hands: ['6h 4h', 'Qh 2h'],
    expected: 'second',
  },
  {
    title: 'The board plays: split pot',
    board: 'Ac Kc Qc Jc 10c',
    hands: ['2d 3h', '4s 5d'],
    expected: 'split',
  },
  {
    title: 'Quads on board, the ace kicker plays for both: split pot',
    board: 'Qs Qd Qh Qc Ad',
    hands: ['Kd Ks', '2c 3c'],
    expected: 'split',
  },
];

const VERDICT_TEXT: Readonly<Record<ShowdownVerdict, string>> = {
  first: 'first hand wins',
  second: 'second hand wins',
  split: 'split pot',
};

function showdownVerdict(
  board: ReadonlyArray<Card>,
  hands: readonly [Card[], Card[]],
): ShowdownVerdict {
  const first = handRank([...hands[0], ...board]);
  const second = handRank([...hands[1], ...board]);
  if (first === second) return 'split';
  return first > second ? 'first' : 'second';
}

// ── Seats tab ──────────────────────────────────────────────────────────────

/** One "thinking" pulse on an acting plate. */
const ACTING_PULSE_MS = 1200;
/** One chip-fidget riffle, looped so the tell is seen moving. */
const FIDGET_LOOP_MS = 1600;
/** A seat changing hands, caught halfway through its fade. */
const HALF_PRESENT = 0.5;
/** The plates are laid out from a desktop table, where seat 1 is a regular's ordinary seat. */
const PLATE_SOURCE_VIEWPORT = { width: 1280, height: 720 } as const;
const PLATE_SOURCE_SEAT = 1;
const SAMPLE_TAG: SeatTag = { label: 'Raise 60', tone: 'warning', alpha: 1 };
const FOLD_TAG: SeatTag = { label: 'Fold', tone: 'neutral', alpha: 1 };

type PlateFlags = Omit<SeatPlateModel, 'name' | 'stack' | 'avatar'>;

const RESTING_PLATE: PlateFlags = {
  presence: 1,
  folded: false,
  allIn: false,
  actingPulseMs: null,
  winner: false,
  tilted: false,
  busted: false,
  tag: null,
  blind: null,
  fidget: null,
};

interface PlateState {
  readonly label: string;
  readonly flags: (now: number) => Partial<PlateFlags>;
}

const PLATE_STATES: ReadonlyArray<PlateState> = [
  { label: 'Waiting', flags: () => ({}) },
  { label: 'Acting', flags: () => ({ actingPulseMs: ACTING_PULSE_MS }) },
  { label: 'Last action', flags: () => ({ tag: SAMPLE_TAG }) },
  { label: 'Folded', flags: () => ({ folded: true, tag: FOLD_TAG }) },
  { label: 'All-in', flags: () => ({ allIn: true }) },
  { label: 'Winner', flags: () => ({ winner: true }) },
  { label: 'Tilted', flags: () => ({ tilted: true }) },
  { label: 'Chip fidget', flags: (now) => ({ fidget: (now % FIDGET_LOOP_MS) / FIDGET_LOOP_MS }) },
  { label: 'Small blind', flags: () => ({ blind: 'SB' }) },
  { label: 'Big blind', flags: () => ({ blind: 'BB' }) },
  { label: 'Busted', flags: () => ({ busted: true }) },
  { label: 'Changing hands', flags: () => ({ presence: HALF_PRESENT }) },
];

interface PlateSubject {
  readonly name: string;
  readonly avatar: SeatAvatar;
}

const PLATE_SUBJECTS: ReadonlyArray<PlateSubject> = [
  ...REGULAR_IDS.map((id) => ({
    name: POKER_REGULARS[id].name,
    avatar: { kind: 'regular', key: id, look: POKER_REGULARS[id].look } as const,
  })),
  { name: `You (${crawlerName('human')})`, avatar: { kind: 'crawler', crawler: 'human' } },
  { name: `You (${crawlerName('cat')})`, avatar: { kind: 'crawler', crawler: 'cat' } },
  { name: 'Empty seat', avatar: { kind: 'empty' } },
];

/** Everything a plate paints, including the avatar's overhang, the tag and the blind marker. */
function plateFootprint(seat: PokerSeatLayout, markerRoom: number): Rect {
  const left = Math.min(seat.plate.x, seat.avatar.x, seat.tag.x);
  const top = Math.min(seat.plate.y, seat.avatar.y, seat.blindMarker.y - markerRoom);
  const right = Math.max(
    seat.plate.x + seat.plate.w,
    seat.avatar.x + seat.avatar.w,
    seat.blindMarker.x + markerRoom,
  );
  const bottom = Math.max(
    seat.plate.y + seat.plate.h,
    seat.avatar.y + seat.avatar.h,
    seat.tag.y + seat.tag.h,
  );
  return { x: left, y: top, w: right - left, h: bottom - top };
}

// ── Sim tab ────────────────────────────────────────────────────────────────

const SIM_STREAMS = 12;
const SIM_HANDS_PER_STREAM = 400;
/** Keeps the preview's sim streams apart from the table's shuffle and from each other. */
const SIM_BRAIN_SALT = 2000;
const SIM_TABLE_SALT = 1000;
const SIM_PLAYER_SALT = 3000;

type SimLine =
  | { readonly kind: 'section'; readonly text: string }
  | { readonly kind: 'check'; readonly check: PokerCheck };

interface SimRun {
  readonly seed: number;
  readonly lines: SimLine[];
  readonly tally: SimTally;
  nextStream: number;
  done: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatSeed(seed: number): string {
  return `0x${(seed >>> 0).toString(HEX_RADIX).padStart(SEED_HEX_DIGITS, '0')}`;
}

/** `0x…` hex or plain decimal; null for anything else. */
function parseSeed(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^0x[0-9a-f]+$/i.test(trimmed)) return parseInt(trimmed.slice(2), HEX_RADIX) >>> 0;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) >>> 0;
  return null;
}

function percent(share: number): string {
  return `${Math.round(share * PERCENT)}%`;
}

function words(id: string): string {
  return id.split('_').join(' ');
}

function describeSignal(signal: TellSignal): string {
  switch (signal.kind) {
    case 'think_time':
      return signal.pace === 'tank' ? 'tanks' : 'snaps';
    case 'bet_size':
      return `bets ${signal.size}`;
    case 'chip_fidget':
      return 'fidgets with chips';
    case 'card_recheck':
      return 're-checks cards';
    case 'chatter':
      return signal.direction === 'up' ? 'chatters more' : 'goes quiet';
    case 'bet_motion':
      return signal.style === 'neat' ? 'stacks bets neatly' : 'splashes the pot';
  }
}

function describeTell(tell: PokerTell): string {
  return `${describeSignal(tell.signal)} → ${tell.polarity} (${percent(tell.reliability)} true)`;
}

function personalityLines(personality: PokerPersonality): string[] {
  const profile = personality.profile;
  const tiers = POKER_TIER_IDS.map(
    (tier) =>
      `${POKER_STAKES[tier].name} ×${personality.tierPreference[tier].toFixed(PARAMETER_DECIMALS)}`,
  ).join(' · ');
  const tells =
    personality.tells.length === 0 ? 'none' : personality.tells.map(describeTell).join(' · ');
  const parameters = UNIT_PARAMETERS.map(
    (parameter) => `${parameter} ${profile[parameter].toFixed(PARAMETER_DECIMALS)}`,
  ).join(' · ');
  return [
    `Sizing ${profile.sizing} · thinks ${Math.round(profile.thinkBaseMs)} ms · buys in ${profile.buyInBigBlinds.min}–${profile.buyInBigBlinds.max} BB · banter ${words(profile.banterSet)}`,
    `Tables: ${tiers}`,
    `Tells: ${tells}`,
    parameters,
  ];
}

// ── Scene ──────────────────────────────────────────────────────────────────

export class PokerPreviewScene extends PreviewScene {
  private tab: PreviewTab = 'Table';

  private seed = POKER_DEV_SEED;
  private readonly seedInput = new SearchInput();
  private personalities: PokerPersonalities = rollPokerPersonalities(POKER_DEV_SEED);

  private tier: PokerTierId = 'penny';
  private viewportIndex = DEFAULT_VIEWPORT_INDEX;
  private density: Density = 'pointer';
  private paused = false;
  private speedIndex = 0;
  private tableClockMs = 0;
  private readonly player = new HumanPlayer(0, 0, TILE_SIZE);
  private readonly companion = new CatPlayer(1, 0, TILE_SIZE);
  private readonly seat: CasinoSeat = {
    active: () => this.player,
    companion: () => this.companion,
  };
  private poker: ClubPokerSystem;
  private tableUi: UiRoot;
  /** Where the letterboxed table was last drawn, in canvas CSS pixels. */
  private tableBox: { readonly x: number; readonly y: number; readonly scale: number } | null =
    null;
  /** Gestures that went down on the table, so the rest of each reaches it too. */
  private readonly forwardedPointers = new Set<number>();

  private simRun: SimRun | null = null;

  constructor() {
    super();
    this.seedInput.value = formatSeed(this.seed);
    this.poker = this.buildPoker();
    this.tableUi = this.buildTableUi();
    this.seatAt(this.tier);
    this.ui.mount(this.bodySurface());
    this.ui.addKeyHook((key, mods) => this.forwardKey(key, mods));
  }

  onExit(): void {
    this.poker.forceClose(this.player);
    this.tableUi.dispose();
  }

  protected previewTitle(): string {
    return "Texas Hold'em — Desperado Club review harness";
  }

  protected previewControls(): readonly PreviewControl[] {
    const tabs: PreviewControl[] = TABS.map((tab) => ({
      label: tab,
      selected: tab === this.tab,
      onTap: () => {
        this.tab = tab;
      },
    }));
    switch (this.tab) {
      case 'Table':
        return [...tabs, ...this.tableControls()];
      case 'Personalities':
        return [...tabs, ...this.seedControls()];
      case 'Sim':
        return [
          ...tabs,
          ...this.seedControls(),
          {
            id: 'run-sim',
            label: this.simRun === null ? 'Run invariants' : 'Run again',
            onTap: () => {
              this.startSim();
            },
          },
        ];
      case 'Hands':
      case 'Seats':
        return tabs;
    }
  }

  protected previewCaptions(): readonly string[] {
    if (this.tab === 'Table') {
      const table = this.poker.pokerTable;
      const state =
        table === null
          ? 'not seated'
          : `hand ${table.handNumber} · ${words(table.phase)} · pot ${table.pot}`;
      return [`seed ${formatSeed(this.seed)}`, state];
    }
    if (this.tab === 'Sim') {
      const run = this.simRun;
      if (run === null) return [`seed ${formatSeed(this.seed)}`];
      const checks = run.lines.flatMap((line) => (line.kind === 'check' ? [line.check] : []));
      const passed = checks.filter((check) => check.passed).length;
      const progress = run.done
        ? `${passed} of ${checks.length} checks passed`
        : `stream ${run.nextStream + 1} of ${SIM_STREAMS}`;
      return [`seed ${formatSeed(run.seed)}`, progress];
    }
    return [`seed ${formatSeed(this.seed)}`];
  }

  private seedControls(): PreviewControl[] {
    return [
      {
        id: 'next-seed',
        label: 'Next seed',
        onTap: () => {
          this.applySeed((this.seed + 1) >>> 0);
        },
      },
      {
        id: 'dev-seed',
        label: 'Dev seed',
        onTap: () => {
          this.applySeed(POKER_DEV_SEED);
        },
      },
    ];
  }

  private tableControls(): PreviewControl[] {
    const tiers: PreviewControl[] = POKER_TIER_IDS.map((tier) => ({
      id: `tier-${tier}`,
      label: POKER_STAKES[tier].name,
      selected: tier === this.tier && this.poker.tableOpen,
      onTap: () => {
        this.seatAt(tier);
      },
    }));
    const viewports: PreviewControl[] = VIEWPORT_MATRIX.map((viewport, index) => ({
      id: `viewport-${viewport.label}`,
      label: viewport.label,
      selected: index === this.viewportIndex,
      onTap: () => {
        this.viewportIndex = index;
      },
    }));
    const speed = SPEEDS[this.speedIndex];
    return [
      ...tiers,
      ...viewports,
      {
        id: 'density',
        label: this.density === 'touch' ? 'Touch' : 'Pointer',
        onTap: () => {
          this.density = this.density === 'touch' ? 'pointer' : 'touch';
        },
      },
      {
        id: 'pause',
        label: this.paused ? 'Play' : 'Pause',
        onTap: () => {
          this.paused = !this.paused;
        },
      },
      {
        id: 'step',
        label: 'Step',
        onTap: () => {
          this.paused = true;
          this.stepToNextChange();
        },
      },
      {
        id: 'speed',
        label: `×${speed}`,
        onTap: () => {
          this.speedIndex = (this.speedIndex + 1) % SPEEDS.length;
        },
      },
      {
        id: 'to-turn',
        label: 'To my turn',
        onTap: () => {
          this.runUntil(
            (table) =>
              table.awaitingPlayer ||
              table.phase === 'player_busted' ||
              table.phase === 'game_over',
          );
        },
      },
      ...this.seedControls(),
    ];
  }

  // ── Seed ───────────────────────────────────────────────────────────────

  private applySeed(seed: number): void {
    this.seedInput.value = formatSeed(seed);
    this.adoptSeed(seed);
  }

  /** Re-rolls the regulars and re-deals the table under `seed`. */
  private adoptSeed(seed: number): void {
    if (seed === this.seed) return;
    this.seed = seed;
    this.personalities = rollPokerPersonalities(seed);
    const wasSeated = this.poker.tableOpen;
    this.poker.forceClose(this.player);
    this.tableUi.dispose();
    this.tableClockMs = 0;
    this.poker = this.buildPoker();
    this.tableUi = this.buildTableUi();
    if (wasSeated) this.seatAt(this.tier);
  }

  // ── Table ──────────────────────────────────────────────────────────────

  private buildPoker(): ClubPokerSystem {
    return new ClubPokerSystem(
      null,
      this.seed,
      () => this.tableClockMs,
      mulberry32(subSeed(this.seed, SHUFFLE_SALT)),
    );
  }

  private buildTableUi(): UiRoot {
    const tableUi = new UiRoot({
      audio: null,
      viewport: () => this.tableViewportInput(),
    });
    tableUi.mount(this.poker.buyInSurface('poker-buy-in', this.seat));
    tableUi.mount(this.poker.tableSurface('poker-table', this.seat));
    tableUi.mount(this.poker.historySurface('poker-history'));
    tableUi.mount(this.poker.seatInfoSurface('poker-seat-info'));
    tableUi.mount(this.poker.rulesSurface('poker-rules'));
    tableUi.mount(this.poker.bustSurface('poker-bust', this.seat));
    tableUi.mount(this.poker.gameOverSurface('poker-game-over', this.seat));
    tableUi.mount(this.poker.leaveConfirmSurface('poker-leave'));
    return tableUi;
  }

  private tableViewportInput(): ViewportInput {
    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    return {
      cssWidth: viewport.width,
      cssHeight: viewport.height,
      density: this.density,
      uiSize: settings.uiSize,
      safeArea: NO_INSETS,
    };
  }

  /** The dev party carries enough coin for the tier, so the real buy-in and rebuy code pays as it would in play. */
  private fundParty(tier: PokerTierId): void {
    const bankroll = POKER_STAKES[tier].buyIn * DEV_BANKROLL_BUY_INS;
    if (this.player.coins < POKER_STAKES[tier].buyIn) this.player.coins = bankroll;
  }

  private seatAt(tier: PokerTierId): void {
    this.tier = tier;
    this.poker.forceClose(this.player);
    this.fundParty(tier);
    this.poker.buyIn(tier, this.player, this.companion);
    // A reviewer reseats often; the sheet is a button away rather than in the way every time.
    this.poker.dismissRules();
  }

  private advanceTable(ms: number): void {
    let remaining = ms;
    while (remaining > 0) {
      const step = Math.min(TABLE_STEP_MS, remaining);
      this.tableClockMs += step;
      this.poker.update();
      remaining -= step;
    }
  }

  /** Runs the clock until `done` holds, or {@link MAX_SKIP_MS} passes. */
  private runUntil(done: (table: PokerTable) => boolean): void {
    for (let elapsed = 0; elapsed < MAX_SKIP_MS; elapsed += TABLE_STEP_MS) {
      const table = this.poker.pokerTable;
      if (table === null || done(table)) return;
      this.advanceTable(TABLE_STEP_MS);
    }
  }

  /** Runs the clock until something visible changes: an action, a street, a phase or a new hand. */
  private stepToNextChange(): void {
    const table = this.poker.pokerTable;
    if (table === null) return;
    const before = {
      actions: table.history.length,
      phase: table.phase,
      hand: table.handNumber,
      board: table.board.length,
    };
    this.advanceTable(TABLE_STEP_MS);
    this.runUntil(
      (now) =>
        now.history.length !== before.actions ||
        now.phase !== before.phase ||
        now.handNumber !== before.hand ||
        now.board.length !== before.board,
    );
  }

  private forwardKey(key: string, mods: KeyModifiers): boolean {
    if (this.tab !== 'Table') return false;
    return this.tableUi.key(key, mods) === 'consumed';
  }

  /** Presses that land on the letterboxed table go to the table's own `UiRoot`, mapped into its viewport. */
  protected handlePreviewWorldPointer(gesture: WorldGesture): void {
    if (this.tab !== 'Table') return;
    const box = this.tableBox;
    if (box === null) return;
    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    const tableCssX = (gesture.cssX - box.x) / box.scale;
    const tableCssY = (gesture.cssY - box.y) / box.scale;
    const inside = contains(
      { x: 0, y: 0, w: viewport.width, h: viewport.height },
      tableCssX,
      tableCssY,
    );
    const pointerId = gesture.pointerId;
    if (gesture.kind === 'down') {
      if (!inside) return;
      this.forwardedPointers.add(pointerId);
    } else if (gesture.kind === 'wheel') {
      if (!inside) return;
    } else if (!this.forwardedPointers.has(pointerId)) {
      return;
    }
    if (gesture.kind === 'up' || gesture.kind === 'cancel')
      this.forwardedPointers.delete(pointerId);
    const scale = this.tableUi.uiScale;
    this.tableUi.pointer({
      ...gesture,
      x: tableCssX / scale,
      y: tableCssY / scale,
      cssX: tableCssX,
      cssY: tableCssY,
    });
  }

  /** Feeds the resting mouse to the table so its controls show hover, which a world handler never sees. */
  private feedTableHover(): void {
    const mouse = this.ui.mouse;
    const box = this.tableBox;
    if (mouse === null || box === null) {
      this.tableUi.pointerLeft();
      return;
    }
    if (mouse.down) return;
    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    const outerScale = this.ui.uiScale;
    const tableCssX = (mouse.x * outerScale - box.x) / box.scale;
    const tableCssY = (mouse.y * outerScale - box.y) / box.scale;
    if (!contains({ x: 0, y: 0, w: viewport.width, h: viewport.height }, tableCssX, tableCssY)) {
      this.tableUi.pointerLeft();
      return;
    }
    const scale = this.tableUi.uiScale;
    this.tableUi.pointer({
      kind: 'move',
      pointerId: HOVER_POINTER_ID,
      source: 'mouse',
      x: tableCssX / scale,
      y: tableCssY / scale,
      cssX: tableCssX,
      cssY: tableCssY,
      button: PRIMARY_BUTTON,
      deltaY: 0,
    });
  }

  // ── Sim ────────────────────────────────────────────────────────────────

  private startSim(): void {
    const lines: SimLine[] = [
      { kind: 'section', text: 'Hand evaluator: known hands' },
      ...knownHandChecks().map((check): SimLine => ({ kind: 'check', check })),
      { kind: 'section', text: 'Hand evaluator: comparisons and ties' },
      ...comparisonChecks().map((check): SimLine => ({ kind: 'check', check })),
      {
        kind: 'section',
        text: `Table sims: ${SIM_STREAMS} streams × ${SIM_HANDS_PER_STREAM} hands, all tiers, random brains`,
      },
    ];
    this.simRun = { seed: this.seed, lines, tally: newTally(), nextStream: 0, done: false };
  }

  /** One sim stream per update, so the page keeps drawing while the run goes. */
  private advanceSim(): void {
    const run = this.simRun;
    if (run === null || run.done) return;
    if (run.nextStream >= SIM_STREAMS) {
      const checks = simTallyChecks(run.tally, SIM_STREAMS * SIM_HANDS_PER_STREAM);
      run.lines.push(...checks.map((check): SimLine => ({ kind: 'check', check })));
      run.done = true;
      return;
    }
    const index = run.nextStream;
    const tier = POKER_TIER_IDS[index % POKER_TIER_IDS.length];
    runSimStream(
      `${tier} stream ${index}`,
      tier,
      {
        brain: mulberry32(subSeed(run.seed, SIM_BRAIN_SALT + index)),
        table: mulberry32(subSeed(run.seed, SIM_TABLE_SALT + index)),
        player: mulberry32(subSeed(run.seed, SIM_PLAYER_SALT + index)),
      },
      run.tally,
      SIM_HANDS_PER_STREAM,
    );
    run.nextStream += 1;
  }

  // ── Frame ──────────────────────────────────────────────────────────────

  update(): void {
    const typedSeed = parseSeed(this.seedInput.value);
    if (!this.seedInput.active && typedSeed !== null) this.adoptSeed(typedSeed);

    if (this.tab === 'Sim') this.advanceSim();
    if (this.tab !== 'Table') return;
    this.feedTableHover();
    if (this.poker.tableOpen) this.fundParty(this.tier);
    if (!this.poker.anySurfaceOpen) this.poker.openBuyIn();
    if (this.paused) {
      this.poker.update();
      return;
    }
    this.advanceTable(UPDATE_MS * SPEEDS[this.speedIndex]);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);
    this.tableBox = null;
    if (this.tab === 'Table') this.renderTableTab(ctx, width, height);
    this.renderChrome(ctx);
  }

  private renderTableTab(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    const top = this.headerBottom + CONTENT_GAP;
    const room: Rect = {
      x: MARGIN,
      y: top,
      w: Math.max(1, width - MARGIN * 2),
      h: Math.max(1, height - top - MARGIN - TABLE_CAPTION_ROOM),
    };
    const scale = Math.min(1, room.w / viewport.width, room.h / viewport.height);
    const box = { x: room.x, y: room.y, scale };
    this.tableBox = box;

    ctx.save();
    ctx.translate(box.x, box.y);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(0, 0, viewport.width, viewport.height);
    ctx.clip();
    ctx.fillStyle = PANEL_COLOR;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    // The table reads the viewport globals, so the simulated size is installed
    // only for the duration of its frame.
    setViewportSize(viewport.width, viewport.height);
    this.tableUi.frame(ctx);
    setViewportSize(width, height);
    ctx.restore();

    const shownAt = scale < 1 ? ` shown at ${percent(scale)}` : '';
    const speed = this.paused ? 'paused' : `×${SPEEDS[this.speedIndex]}`;
    worldText(
      ctx,
      `${viewport.label}${shownAt} · ${this.density} · ${speed} · play by tapping inside`,
      {
        x: box.x,
        y: box.y + viewport.height * scale + CARD_GAP,
        width: room.w,
        size: SMALL_LABEL_SIZE,
        color: SUBLABEL_COLOR,
      },
    );
  }

  // ── Body surface: every tab but the table ──────────────────────────────

  private bodySurface(): Surface {
    return {
      id: BODY_SURFACE_ID,
      band: 'hud',
      haltsWorld: false,
      isOpen: () => this.tab !== 'Table',
      onKey: (key, mods) => this.seedInput.handleKey(key, mods.repeat === true),
      render: (ui) => {
        this.renderBody(ui);
      },
    };
  }

  private renderBody(ui: Ui): void {
    const { space } = ui.theme;
    const top = this.headerBottom / ui.uiScale + space.md;
    const outer = inset(ui.viewport, space.md);
    let area: Rect = { x: outer.x, y: top, w: outer.w, h: Math.max(0, outer.y + outer.h - top) };

    if (this.tab === 'Personalities' || this.tab === 'Sim') {
      const fieldHeight = ui.theme.size.control;
      const fieldWidth = Math.min(area.w, ui.theme.panelWidth.sm);
      searchField(
        ui,
        { x: area.x, y: area.y, w: fieldWidth, h: fieldHeight },
        {
          id: SEED_FIELD_ID,
          input: this.seedInput,
          placeholder: 'Seed: 0x… or decimal',
        },
      );
      const below = fieldHeight + space.sm;
      area = { ...area, y: area.y + below, h: Math.max(0, area.h - below) };
    }

    switch (this.tab) {
      case 'Hands':
        this.renderHands(ui, area);
        return;
      case 'Seats':
        this.renderSeats(ui, area);
        return;
      case 'Personalities':
        this.renderPersonalities(ui, area);
        return;
      case 'Sim':
        this.renderSim(ui, area);
        return;
      case 'Table':
        return;
    }
  }

  private drawCards(ui: Ui, cards: ReadonlyArray<Card>, x: number, y: number): number {
    let cursor = x;
    for (const card of cards) {
      drawCardFace(ui.ctx, card, { x: cursor, y, width: CARD_WIDTH });
      cursor += CARD_WIDTH + CARD_GAP;
    }
    return cursor;
  }

  private renderHands(ui: Ui, area: Rect): void {
    const { space } = ui.theme;
    const heading = lineHeightOf(ui, 'heading');
    const label = lineHeightOf(ui, 'label');
    const caption = lineHeightOf(ui, 'caption');
    const rankRow = label + space.xs + CARD_HEIGHT + space.md;
    const handRow = caption + space.xs + CARD_HEIGHT + space.sm;
    const caseRow =
      label +
      space.xs +
      caption +
      space.xs +
      CARD_HEIGHT +
      space.sm +
      handRow * 2 +
      caption +
      space.lg;
    const contentHeight =
      heading +
      space.sm +
      RANK_EXAMPLES.length * rankRow +
      heading +
      space.sm +
      SHOWDOWN_CASES.length * caseRow;

    scrollView(ui, area, {
      id: 'hands',
      contentHeight,
      draw: (content) => {
        let y = content.y;
        const line = (role: TextRole, value: string, height: number): void => {
          text(ui, { x: content.x, y, w: content.w, h: height }, { text: value, role });
          y += height;
        };

        line('heading', 'All ten hand ranks', heading);
        y += space.sm;
        for (const example of RANK_EXAMPLES) {
          const cards = parseCards(example.cards);
          const hand = evaluateBest(cards);
          line('label', `${example.name} — evaluateBest: "${hand.label}"`, label);
          y += space.xs;
          this.drawCards(ui, cards, content.x, y);
          y += CARD_HEIGHT + space.md;
        }

        line('heading', 'Tricky showdowns', heading);
        y += space.sm;
        for (const showdown of SHOWDOWN_CASES) {
          const board = parseCards(showdown.board);
          const holes: readonly [Card[], Card[]] = [
            parseCards(showdown.hands[0]),
            parseCards(showdown.hands[1]),
          ];
          line('label', showdown.title, label);
          y += space.xs;
          line('caption', 'Board', caption);
          y += space.xs;
          this.drawCards(ui, board, content.x, y);
          y += CARD_HEIGHT + space.sm;
          holes.forEach((hole, index) => {
            const best = evaluateBest([...hole, ...board]);
            line('caption', `Hand ${index + 1}: ${best.label} — hole, then the best five`, caption);
            y += space.xs;
            const afterHole = this.drawCards(ui, hole, content.x, y);
            this.drawCards(ui, best.best5, afterHole + BEST_FIVE_GAP, y);
            y += CARD_HEIGHT + space.sm;
          });
          const verdict = showdownVerdict(board, holes);
          const passed = verdict === showdown.expected;
          line(
            passed ? 'success' : 'danger',
            `${passed ? 'PASS' : 'FAIL'}  ${VERDICT_TEXT[verdict]} (expected ${VERDICT_TEXT[showdown.expected]})`,
            caption,
          );
          y += space.lg;
        }
      },
    });
  }

  private renderSeats(ui: Ui, area: Rect): void {
    const { space } = ui.theme;
    const sourceSeat = listAt(
      computePokerLayout({
        width: PLATE_SOURCE_VIEWPORT.width,
        height: PLATE_SOURCE_VIEWPORT.height,
        uiScale: ui.uiScale,
        theme: ui.theme,
      }).seats,
      PLATE_SOURCE_SEAT,
    );
    if (sourceSeat === undefined) return;
    const footprint = plateFootprint(sourceSeat, space.md);
    const cellWidth = footprint.w + space.lg;
    const cellHeight = footprint.h + space.md;
    const columns = Math.max(1, Math.floor(area.w / cellWidth));
    const rowsPerState = Math.ceil(PLATE_SUBJECTS.length / columns);
    const heading = lineHeightOf(ui, 'label');
    const stateHeight = heading + space.sm + rowsPerState * cellHeight + space.md;
    const colors = pokerTableColors(ui.theme);
    const stack = POKER_STAKES[this.tier].buyIn;

    scrollView(ui, area, {
      id: 'seats',
      contentHeight: PLATE_STATES.length * stateHeight,
      draw: (content) => {
        PLATE_STATES.forEach((state, stateIndex) => {
          const top = content.y + stateIndex * stateHeight;
          text(
            ui,
            { x: content.x, y: top, w: content.w, h: heading },
            {
              text: state.label,
              role: 'label',
            },
          );
          const flags = { ...RESTING_PLATE, ...state.flags(ui.now) };
          PLATE_SUBJECTS.forEach((subject, index) => {
            const cellX = content.x + (index % columns) * cellWidth;
            const cellY = top + heading + space.sm + Math.floor(index / columns) * cellHeight;
            ui.ctx.save();
            ui.ctx.translate(cellX - footprint.x, cellY - footprint.y);
            paintSeatPlate(
              ui,
              sourceSeat,
              { ...flags, name: subject.name, stack, avatar: subject.avatar },
              colors,
              this.tier,
              ui.now,
            );
            ui.ctx.restore();
          });
        });
      },
    });
  }

  private renderPersonalities(ui: Ui, area: Rect): void {
    const { space } = ui.theme;
    const heading = lineHeightOf(ui, 'label');
    const width = Math.max(1, area.w - space.md);
    const blocks = REGULAR_IDS.map((id) => {
      const personality = this.personalities[id];
      const title = `${POKER_REGULARS[id].name} — ${words(personality.archetype)}`;
      const lines = personalityLines(personality).map((value) => ({
        value,
        height: measureTextHeight(ui, width, { text: value, role: 'caption' }),
      }));
      const height = heading + lines.reduce((total, line) => total + line.height, 0) + space.md;
      return { title, lines, height };
    });
    const contentHeight = blocks.reduce((total, block) => total + block.height, 0);

    scrollView(ui, area, {
      id: 'personalities',
      contentHeight,
      draw: (content) => {
        let y = content.y;
        for (const block of blocks) {
          text(
            ui,
            { x: content.x, y, w: content.w, h: heading },
            { text: block.title, role: 'label' },
          );
          y += heading;
          for (const line of block.lines) {
            text(
              ui,
              { x: content.x, y, w: width, h: line.height },
              {
                text: line.value,
                role: 'caption',
                wrap: true,
              },
            );
            y += line.height;
          }
          y += space.md;
        }
      },
    });
  }

  private renderSim(ui: Ui, area: Rect): void {
    const { space } = ui.theme;
    const run = this.simRun;
    if (run === null) {
      text(
        ui,
        { ...area, h: lineHeightOf(ui, 'body') },
        {
          text: `Not run yet. "Run invariants" plays ${SIM_STREAMS * SIM_HANDS_PER_STREAM} hands under the seed above.`,
          role: 'body',
        },
      );
      return;
    }
    const width = Math.max(1, area.w - space.md);
    const rows = run.lines.map((line) => {
      const value =
        line.kind === 'section'
          ? line.text
          : `${line.check.passed ? 'PASS' : 'FAIL'}  ${line.check.description}`;
      const role: TextRole =
        line.kind === 'section' ? 'label' : line.check.passed ? 'success' : 'danger';
      const height = measureTextHeight(ui, width, { text: value, role });
      return { value, role, height, gapBefore: line.kind === 'section' ? space.md : 0 };
    });
    const contentHeight = rows.reduce((total, row) => total + row.gapBefore + row.height, 0);

    scrollView(ui, area, {
      id: 'sim',
      contentHeight,
      draw: (content) => {
        let y = content.y;
        for (const row of rows) {
          y += row.gapBefore;
          text(
            ui,
            { x: content.x, y, w: width, h: row.height },
            {
              text: row.value,
              role: row.role,
              wrap: true,
            },
          );
          y += row.height;
        }
      },
    });
  }
}
