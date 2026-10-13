/**
 * Tito's Wheel of Fortune: the host that takes the bet, commits each spin to
 * the save before the wheel moves, plays the spin and the outcome's reveal, and
 * hands the prize to the crawler who spun. It mounts four surfaces: the
 * blaring warning, the "are you sure" prompt, the wheel screen and the
 * Nothing.
 *
 * Every spin does exactly one storage round-trip before the wheel turns, so
 * how long the wheel takes to start never gives the outcome away: a normal
 * outcome writes the save with the bet spent, the prize marked won and the
 * outcome pending; the Nothing's round-trip is the wipe itself. A tab closed
 * mid-spin leaves the pending outcome in the save, and the next load pays it.
 */

import type { AudioManager } from '../audio/AudioManager';
import type { SoundId } from '../audio/sounds';
import type { Player } from '../Player';
import { ITEM_DEF, type ItemId } from '../core/ItemDefs';
import { LootBoxOpener } from '../ui/LootBoxOpener';
import { partyCoins, spendPartyCoins, canAffordCoins } from '../core/partyCoins';
import {
  saveOutcomeCommitted,
  type SaveWriteOutcome,
  type WipeStatus,
} from '../core/progressPersistence';
import type { WheelCrawler, WheelLedger } from '../core/WheelLedger';
import { CatPlayer } from '../creatures/CatPlayer';
import { pickTitoLine, type TitoTrigger } from '../dialog/scripts/tito';
import type { TitoBustPose } from '../sprites/titoSprite';
import type { Surface, Ui } from '../ui/core/UiRoot';
import type { ToastTone } from '../ui/hud/toasts';
import type { ProgressWipe } from '../ui/screens/dialogs/wipeHold';
import { paintWheelWarning, type WheelWarningKind } from '../ui/casino/wheel/wheelWarnings';
import {
  WheelView,
  type WheelReveal,
  type WheelRevealEffect,
  type WheelViewModel,
} from '../ui/casino/wheel/WheelView';
import { paintNothing, type NothingModel } from '../ui/casino/wheel/nothingView';
import type { CasinoGameHost } from './casino/CasinoGameHost';
import type { CasinoSeat } from './ClubCasinoSystem';
import {
  BASE_WHEEL_BOARD,
  WHEEL_BET_STEP,
  WHEEL_MAX_BET,
  WHEEL_MIN_BET,
  boardForBet,
  isRedWedge,
  isWheelPrizeId,
  upgradeForStepAbove,
  type WheelBoard,
  type WheelPrizeId,
  type WheelWedge,
} from './casino/wheel/wheelBoard';
import { pickLuckyOutcome, pickOutcome, type WheelOutcome } from './casino/wheel/wheelOutcome';
import type { LuckCheck } from '../core/GodMode';
import {
  landingAngle,
  rotationForPointerAt,
  wedgeCenterAngle,
  pegCrossings,
  planSpin,
  type WheelSpinPlan,
} from './casino/wheel/wheelGeometry';
import {
  applyWheelPrize,
  markWheelPrizeWon,
  wheelPrizeRecipient,
  type WheelPrizeEffect,
  type WheelPrizeTarget,
} from './casino/wheel/wheelPrizes';

export const WHEEL_WARNING_SURFACE_ID = 'wheel-warning';
export const WHEEL_CONFIRM_SURFACE_ID = 'wheel-confirm';
export const WHEEL_SURFACE_ID = 'wheel';
export const NOTHING_SURFACE_ID = 'wheel-nothing';
export const WHEEL_PRIZE_SURFACE_ID = 'wheel-prize';

/** Every surface the wheel mounts, in stacking order. */
export const WHEEL_SURFACE_IDS: readonly string[] = [
  WHEEL_WARNING_SURFACE_ID,
  WHEEL_CONFIRM_SURFACE_ID,
  WHEEL_SURFACE_ID,
  WHEEL_PRIZE_SURFACE_ID,
  NOTHING_SURFACE_ID,
];

/**
 * How long each prompt's Yes stays disabled after it appears, so a held key
 * or a fast double tap cannot carry through it.
 */
export const WHEEL_ARMING_MS = 1500;
/** SPIN has to be held this long; letting go sooner cancels. */
export const WHEEL_SPIN_HOLD_MS = 1000;

/** The key that holds SPIN from the keyboard. */
export const WHEEL_SPIN_KEY = ' ';

export interface ClubWheelDeps {
  readonly audio: AudioManager | null;
  readonly ledger: WheelLedger;
  /** Writes the save as the party stands now; resolves once storage has answered. */
  readonly saveNow: () => Promise<SaveWriteOutcome>;
  /** The page's wipe, or null where nothing is saved: the Nothing then only pretends. */
  readonly progressWipe: ProgressWipe | null;
  /** Runs once the Nothing has played out and the save is gone: the page reload. */
  readonly afterNothing: () => void;
  /** Gives Carl the attack cow and stands her beside him; her arrival moo is the grant's own. */
  readonly grantAttackCow: () => void;
  /** A notice for the scene's toasts. */
  readonly onNotice?: (message: string, tone: ToastTone) => void;
  readonly clock?: () => number;
  readonly random?: () => number;
  /**
   * Picks Tito's patter. Kept apart from `random` so a seeded wheel's draws
   * stay the same whatever he says; only review fixtures pass one.
   */
  readonly titoRandom?: () => number;
  /**
   * Picks the next outcome instead of the rigged draw. Only the review harness
   * passes one; the real wheel always draws.
   */
  readonly forcedOutcome?: (board: WheelBoard) => WheelOutcome | null;
  /** Read as each spin is decided: while true, the wheel never lands on a red wedge. */
  readonly isLucky?: LuckCheck;
}

type WheelScreen = 'closed' | 'warning' | 'confirm' | 'wheel' | 'nothing';

/** A spin the bet and the save have committed to. */
interface CommittedSpin {
  readonly outcome: WheelOutcome;
  readonly board: WheelBoard;
  readonly crawler: Player;
  readonly kind: WheelCrawler;
  /** The crawler the prize goes to; see {@link wheelPrizeRecipient}. */
  readonly recipient: Player;
  readonly recipientKind: WheelCrawler;
  /** Coins staked: zero for a free spin. */
  readonly bet: number;
  /** The bet whose board the wheel shows, which a free spin keeps. */
  readonly boardBet: number;
  readonly free: boolean;
  readonly landing: number;
}

/** What a failed commit puts back. */
interface SpinUndo {
  readonly humanCoins: number;
  readonly catCoins: number;
  /** Won-set entries this spin added, taken back out if the save is refused. */
  readonly prizesMarked: readonly string[];
  readonly freeSpinOwed: boolean;
}

type WheelPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'committing'; readonly spin: CommittedSpin; readonly since: number }
  | {
      readonly kind: 'spinning';
      readonly spin: CommittedSpin;
      readonly plan: WheelSpinPlan;
      readonly startedAt: number;
      lastRotation: number;
      creaked: boolean;
    }
  | {
      readonly kind: 'revealing';
      readonly spin: CommittedSpin;
      readonly reveal: WheelReveal;
      readonly startedAt: number;
      sirenStarted: boolean;
      /** The item prize screen has been raised over the wheel. */
      prizeShown: boolean;
    }
  | { readonly kind: 'nothing'; readonly landedAt: number };

interface WedgeFlipState {
  readonly wedgeIndex: number;
  readonly from: WheelWedge;
  readonly to: WheelWedge;
  readonly startedAt: number;
}

interface SpinHold {
  readonly startedAt: number;
  readonly byKey: boolean;
}

/** One rim bulb going dark during the Nothing. */
interface DyingBulb {
  readonly at: number;
  sounded: boolean;
}

// ── Timing ────────────────────────────────────────────────────────────────

/** A wedge turning over as the bet changes. */
export const WHEEL_FLIP_MS = 420;
/** The pointer's kick when a peg passes under it, and when the wheel lands. */
const CLAPPER_KICK_MS = 120;
const LANDING_KICK_MS = 520;
/** Below this speed, in radians per millisecond, the last few pegs crawl and the wheel creaks. */
const CREAK_BELOW_VELOCITY = 0.0016;
/** Bulb chase steps per second while idle, and how many more as a spinning wheel slows. */
const BULB_IDLE_STEPS_PER_SECOND = 2.5;
const BULB_SLOWING_EXTRA_STEPS_PER_SECOND = 14;
/** A peg tick per frame at most: a fast wheel passes several, and a stack of ticks is a buzz. */
const MAX_TICKS_PER_UPDATE = 1;
/** Tito holds a line this long before it fades. */
const TITO_LINE_MS = 4200;
/** Bet-step quips are skipped when Tito spoke this recently, so the stepper is not a chatterbox. */
const TITO_QUIP_GAP_MS = 2500;
/** Tito fills a long silence while the wheel sits idle. */
const TITO_IDLE_LINE_MS = 14000;
/** How long the lunge, the slash and the shake of a stab take. */
const STAB_POSE_MS = 900;
/** A chuckle this long after a red landing, once the wedge has registered. */
const CHUCKLE_DELAY_MS = 450;
/** The siren after the 500,000 sliver's landing sting. */
const SIREN_DELAY_MS = 900;

/** How long each kind of reveal holds the screen before the wheel is idle again. */
const REVEAL_MS: Readonly<Record<WheelRevealEffect, number>> = {
  red: 3000,
  stab: 3400,
  robbed: 3600,
  freeze: 3000,
  pet: 4200,
  coins: 3800,
  coins_big: 5200,
  coins_jackpot: 8000,
  /** The landing banner's time before the prize screen takes over. */
  item: 1600,
  handies: 4200,
  heal: 3600,
  spin_again: 2400,
};

/** The Nothing, from the landing: the pause, each bulb, the swallow and the two lines. */
const NOTHING_LAND_PAUSE_MS = 1100;
const NOTHING_BULB_STAGGER_MS = 110;
const NOTHING_BULB_JITTER_MS = 70;
const NOTHING_AFTER_BULBS_MS = 500;
export const NOTHING_SWALLOW_MS = 2600;
const NOTHING_FIRST_LINE_DELAY_MS = 400;
const NOTHING_SECOND_LINE_DELAY_MS = 2400;
/** How long "Everything is gone." holds before the reload, when the wipe has finished. */
const NOTHING_HOLD_MS = 3200;
/** A dying bulb's pitch varies by up to this much either way, so the cascade is not a drone. */
const BULB_PITCH_SWING = 0.12;
const BULB_VOLUME = 0.7;
/** How many bulbs ring the rim. */
export const WHEEL_BULB_COUNT = 24;

/** A dry run of the wipe on a page with no save: it "finishes" after this long. */
const FAKE_WIPE_MS = 900;

const KLAXON_VOLUME = 0.55;
const HEARTBEAT_VOLUME = 0.75;
const MUSIC_FADE_MS = 700;
const LOWERED_FLIP_PLAYBACK_RATE = 0.8;
const PEG_TICK_VOLUME = 0.8;
const TICKS: readonly SoundId[] = [
  'wheel_peg_tick_1',
  'wheel_peg_tick_2',
  'wheel_peg_tick_3',
  'wheel_peg_tick_4',
];
const CHUCKLES: readonly SoundId[] = ['tito_chuckle_1', 'tito_chuckle_2', 'tito_chuckle_3'];
const MS_PER_SECOND = 1000;

/** A big enough cash prize gets the full coin shower; the 500,000 sliver gets the jackpot. */
const BIG_GOLD = 50_000;
const JACKPOT_GOLD = 500_000;

function revealEffectFor(wedge: WheelWedge): WheelRevealEffect {
  const prize = wedge.prize;
  switch (prize.kind) {
    case 'stab':
      return 'stab';
    case 'robbed':
      return 'robbed';
    case 'freeze':
      return 'freeze';
    case 'poison':
    case 'blood_vomit':
    case 'burn':
    case 'nothing':
      return 'red';
    case 'pet':
      return 'pet';
    case 'gold':
      if (prize.amount >= JACKPOT_GOLD) return 'coins_jackpot';
      return prize.amount >= BIG_GOLD ? 'coins_big' : 'coins';
    case 'heal_and_gold':
      return 'heal';
    case 'free_handies':
      return 'handies';
    case 'spin_again':
      return 'spin_again';
    case 'legendary_weapon_box':
    case 'platinum_box':
    case 'legendary_box':
    case 'gold_box':
    case 'silver_box':
      return 'item';
  }
}

/** Skips that take the prize screen from any point to closed: to the reveal, then past it. */
const PRIZE_SKIPS_TO_CLOSE = 2;
const CARL_NAME = 'Carl';
const DONUT_NAME = 'Princess Donut';

function plural(name: string): string {
  return name.endsWith('s') ? name : `${name}s`;
}

function crawlerName(kind: WheelCrawler): string {
  return kind === 'human' ? CARL_NAME : DONUT_NAME;
}

/**
 * The line under the landing banner: what the prize paid and to whom, never
 * the banner's own title over again.
 */
function prizeLine(wedge: WheelWedge, effect: WheelPrizeEffect, recipient: WheelCrawler): string {
  const name = crawlerName(recipient);
  const { prize } = wedge;
  if (prize.kind === 'pet') return `An attack cow of his very own for ${CARL_NAME}`;
  if (prize.kind === 'gold') return `Paid straight into ${name}'s purse`;
  if (prize.kind === 'heal_and_gold') {
    return `${name} is healed to full and paid ${prize.amount.toLocaleString()} gold`;
  }
  if (effect.tier === null || effect.items.length === 0) return wedge.label;
  const names = effect.items.map(({ id, quantity }) =>
    quantity > 1 ? `${quantity} ${plural(ITEM_DEF[id].name)}` : ITEM_DEF[id].name,
  );
  const coins = effect.coinsWon > 0 ? [`${effect.coinsWon.toLocaleString()} coins`] : [];
  return `For ${name}: ${[...names, ...coins].join(' and ')}`;
}

/** What a single named item does, for under the prize screen's reward line. */
function prizeDetail(items: ReadonlyArray<{ readonly id: ItemId }>): string | undefined {
  return items.length === 1 ? ITEM_DEF[items[0].id].description : undefined;
}

function titoTriggerFor(effect: WheelRevealEffect): TitoTrigger {
  switch (effect) {
    case 'stab':
      return 'stab';
    case 'robbed':
      return 'robbed';
    case 'pet':
      return 'pet';
    case 'coins_big':
    case 'coins_jackpot':
      return 'big_gold';
    case 'spin_again':
      return 'land_spin_again';
    case 'red':
    case 'freeze':
      return 'land_red';
    case 'coins':
    case 'item':
    case 'handies':
    case 'heal':
      return 'land_good';
  }
}

/** A wipe for a page with nothing saved: it pretends, on the wheel's own clock. */
function dryRunWipe(clock: () => number): ProgressWipe {
  let startedAt: number | null = null;
  return {
    wipe: () => {
      startedAt ??= clock();
      return Promise.resolve();
    },
    get wipeStatus(): WipeStatus {
      if (startedAt === null) return 'idle';
      return clock() - startedAt >= FAKE_WIPE_MS ? 'wiped' : 'erasing';
    },
  };
}

/** The first storage attempt has answered, one way or the other: the wheel may turn. */
function wipeAnswered(status: WipeStatus): boolean {
  return status === 'wiped' || status === 'retrying' || status === 'signInRequired';
}

export class ClubWheelSystem implements CasinoGameHost {
  private screen: WheelScreen = 'closed';
  private screenOpenedAt = 0;
  private phase: WheelPhase = { kind: 'idle' };
  private seat: CasinoSeat | null = null;
  private bet = WHEEL_MIN_BET;
  private flip: WedgeFlipState | null = null;
  private hold: SpinHold | null = null;
  /** Rests with the Nothing under the pointer, so the first thing seen is what is at stake. */
  private rotation = rotationForPointerAt(wedgeCenterAngle(BASE_WHEEL_BOARD, 0));
  private lastPegAt = Number.NEGATIVE_INFINITY;
  private landedAt = Number.NEGATIVE_INFINITY;
  private bulbPhase = 0;
  private lastUpdateAt: number | null = null;
  private titoLine: string | null = null;
  private titoLineAt = Number.NEGATIVE_INFINITY;
  private lastActivityAt = 0;
  private chuckleAt: number | null = null;
  private wagered = 0;
  private wipe: ProgressWipe | null = null;
  private dyingBulbs: DyingBulb[] = [];
  private nothingSwallowSounded = false;
  private nothingToneSounded = false;
  private nothingFinished = false;
  private nothingEndsInRestart = true;
  private readonly view = new WheelView();
  /** The item prize screen: the loot reveal, showing what the wheel already handed over. */
  private readonly prizes = new LootBoxOpener();
  private readonly clock: () => number;
  private readonly random: () => number;
  private readonly titoRandom: () => number;

  constructor(private readonly deps: ClubWheelDeps) {
    this.clock = deps.clock ?? (() => performance.now());
    this.random = deps.random ?? Math.random;
    this.titoRandom = deps.titoRandom ?? Math.random;
    this.prizes.setAudio(deps.audio);
  }

  // ── CasinoGameHost ──────────────────────────────────────────────────────

  get anySurfaceOpen(): boolean {
    return this.screen !== 'closed';
  }

  get coinsWageredThisVisit(): number {
    return this.wagered;
  }

  /** Every time the wheel is picked, the warning comes first; there is no way to skip it. */
  open(seat: CasinoSeat): void {
    if (this.screen !== 'closed') return;
    this.seat = seat;
    this.showScreen('warning');
    this.deps.audio?.pauseMusic('wheel', MUSIC_FADE_MS);
  }

  update(): void {
    const now = this.clock();
    const dt = this.lastUpdateAt === null ? 0 : Math.max(0, now - this.lastUpdateAt);
    this.lastUpdateAt = now;
    this.syncLoops();
    if (this.screen !== 'wheel' && this.screen !== 'nothing') return;
    this.tickHold(now);
    if (this.prizes.isOpen) this.prizes.tick();
    this.tickPhase(now);
    this.advanceBulbs(dt);
    if (this.chuckleAt !== null && now >= this.chuckleAt) {
      this.chuckleAt = null;
      this.deps.audio?.playRandomFresh(CHUCKLES);
    }
    if (this.phase.kind === 'idle' && now - this.lastActivityAt >= TITO_IDLE_LINE_MS) {
      this.say('idle');
    }
    if (this.flip !== null && now - this.flip.startedAt >= WHEEL_FLIP_MS) this.flip = null;
  }

  /**
   * The scene is going away under the wheel: a spin already turning lands on
   * the spot so its prize is paid, then everything closes as if the player
   * had left. The Nothing is never interrupted; the page reload ends it.
   */
  forceClose(): void {
    if (this.screen === 'closed') return;
    const phase = this.phase;
    const turning = phase.kind === 'spinning' || phase.kind === 'committing' ? phase.spin : null;
    const nothing = turning?.outcome.wedge.prize.kind === 'nothing' || this.screen === 'nothing';
    if (nothing) {
      // The cinematic goes with the scene, but the save is already being
      // erased: the page must still restart once it is gone, or play would
      // carry on with every save silently refused.
      const wipe = this.wipe ?? this.deps.progressWipe ?? dryRunWipe(this.clock);
      this.wipe = wipe;
      if (this.nothingEndsInRestart && !this.nothingFinished) {
        this.nothingFinished = true;
        void wipe.wipe().then(() => this.deps.afterNothing());
      }
      return;
    }
    if (turning !== null) this.land(turning, this.clock());
    this.dismissPrizes();
    this.phase = { kind: 'idle' };
    this.deps.audio?.stopSound('slots_jackpot_siren');
    this.closeToFloor();
  }

  surfaces(seat: CasinoSeat): Surface[] {
    return this.surfacesPrefixed(seat, '');
  }

  /** {@link surfaces} with every id prefixed, for a harness that mounts several wheels on one root. */
  surfacesPrefixed(seat: CasinoSeat, prefix: string): Surface[] {
    return [
      this.warningSurface(`${prefix}${WHEEL_WARNING_SURFACE_ID}`, 'warning', seat),
      this.warningSurface(`${prefix}${WHEEL_CONFIRM_SURFACE_ID}`, 'confirm', seat),
      this.wheelSurface(`${prefix}${WHEEL_SURFACE_ID}`, seat),
      this.prizeSurface(`${prefix}${WHEEL_PRIZE_SURFACE_ID}`),
      this.nothingSurface(`${prefix}${NOTHING_SURFACE_ID}`),
    ];
  }

  // ── State a harness reads ───────────────────────────────────────────────

  get currentScreen(): WheelScreen {
    return this.screen;
  }

  get currentBet(): number {
    return this.bet;
  }

  get phaseKind(): WheelPhase['kind'] {
    return this.phase.kind;
  }

  get busy(): boolean {
    return this.phase.kind !== 'idle';
  }

  /** Puts the wheel straight up on its screen, skipping both prompts: review harnesses only. */
  openWheelForReview(seat: CasinoSeat): void {
    this.seat = seat;
    this.showScreen('wheel');
  }

  /** Opens one of the prompts directly: review harnesses only. */
  openPromptForReview(seat: CasinoSeat, kind: WheelWarningKind): void {
    this.seat = seat;
    this.showScreen(kind);
  }

  /** Sets the bet without the flip, for a harness that wants a board shown as it stands. */
  setBetForReview(bet: number): void {
    this.bet = Math.max(WHEEL_MIN_BET, Math.min(WHEEL_MAX_BET, bet));
    this.flip = null;
  }

  /**
   * Lands the wheel on wedge `wedgeIndex` of the current board at once, with
   * no bet and no save, and plays its reveal from the start: review harnesses
   * only, which then step the clock to the frame they want.
   */
  landForReview(seat: CasinoSeat, wedgeIndex: number): void {
    this.openWheelForReview(seat);
    const spin = this.reviewSpin(seat, wedgeIndex);
    this.rotation = planSpin(this.rotation, spin.landing, this.random).endRotation;
    this.land(spin, this.clock());
  }

  /**
   * Plays the Nothing without ever calling {@link ClubWheelDeps.afterNothing}:
   * a gate auditing the screen must not reload the page under itself.
   */
  openNothingForReview(seat: CasinoSeat): void {
    const index = boardForBet(this.bet).findIndex((wedge) => wedge.prize.kind === 'nothing');
    this.nothingEndsInRestart = false;
    this.landForReview(seat, Math.max(0, index));
  }

  /** Shuts every wheel screen at once, the Nothing included: review harnesses only. */
  resetForReview(): void {
    if (this.screen === 'closed') return;
    this.dismissPrizes();
    this.phase = { kind: 'idle' };
    this.screen = 'wheel';
    this.closeToFloor();
  }

  /**
   * Lands on wedge `wedgeIndex` and raises its item prize screen at once,
   * skipping the landing banner: review harnesses only.
   */
  presentPrizeForReview(seat: CasinoSeat, wedgeIndex: number): void {
    this.landForReview(seat, wedgeIndex);
    const phase = this.phase;
    if (phase.kind === 'revealing') this.presentPrize(phase);
  }

  /** Throws the wheel toward wedge `wedgeIndex` with no bet and no save: review harnesses only. */
  spinForReview(seat: CasinoSeat, wedgeIndex: number): void {
    this.openWheelForReview(seat);
    this.launch(this.reviewSpin(seat, wedgeIndex));
  }

  /** Starts holding SPIN as a held Space would, released only by its keyup: review harnesses only. */
  holdSpinForReview(): void {
    this.pressSpin(true);
  }

  /** Steps the bet up one rung with its wedge flip: review harnesses only. */
  betUpForReview(): void {
    this.betUp();
  }

  /** Steps the bet down one rung with its wedge flip: review harnesses only. */
  betDownForReview(): void {
    this.betDown();
  }

  private reviewSpin(seat: CasinoSeat, wedgeIndex: number): CommittedSpin {
    const board = boardForBet(this.bet);
    const index = Math.max(0, Math.min(board.length - 1, wedgeIndex));
    const crawler = seat.active();
    const kind: WheelCrawler = crawler instanceof CatPlayer ? 'cat' : 'human';
    const wedge = board[index];
    const recipientKind = wheelPrizeRecipient(wedge, kind, this.deps.ledger.prizesWon);
    return {
      outcome: { wedgeIndex: index, wedge },
      board,
      crawler,
      kind,
      recipient: this.crawlerOf(seat, recipientKind),
      recipientKind,
      bet: 0,
      boardBet: this.bet,
      free: false,
      landing: landingAngle(board, index, this.random),
    };
  }

  // ── Prompts ─────────────────────────────────────────────────────────────

  private showScreen(screen: WheelScreen): void {
    this.screen = screen;
    this.screenOpenedAt = this.clock();
    this.lastActivityAt = this.screenOpenedAt;
    if (screen === 'wheel') {
      this.phase = { kind: 'idle' };
      this.hold = null;
      this.say('greet');
    }
  }

  /** No, at either prompt: everything closes, back to the club floor. */
  private answerNo(): void {
    this.closeToFloor();
  }

  private answerYes(kind: WheelWarningKind): void {
    if (this.clock() - this.screenOpenedAt < WHEEL_ARMING_MS) return;
    this.showScreen(kind === 'warning' ? 'confirm' : 'wheel');
  }

  private closeToFloor(): void {
    if (this.screen === 'nothing') return;
    this.screen = 'closed';
    this.hold = null;
    this.flip = null;
    this.titoLine = null;
    this.deps.audio?.stopSound('wheel_hold_charge');
    this.deps.audio?.stopSound('slots_jackpot_siren');
    this.syncLoops();
    this.deps.audio?.resumeMusic('wheel', MUSIC_FADE_MS);
    this.deps.audio?.resumeAmbience('nothing');
    const ledger = this.deps.ledger;
    const frozen = ledger.owedFreeze;
    const seat = this.seat;
    if (frozen !== null && seat !== null) {
      ledger.owedFreeze = null;
      applyWheelPrize({ kind: 'freeze' }, this.prizeTarget(this.crawlerOf(seat, frozen), frozen));
      void this.deps.saveNow();
    }
  }

  private syncLoops(): void {
    const audio = this.deps.audio;
    if (audio === null) return;
    if (this.screen === 'warning')
      audio.startAmbientLoop('wheel_warning_klaxon_loop', KLAXON_VOLUME);
    else audio.stopAmbientLoop('wheel_warning_klaxon_loop');
    if (this.screen === 'confirm') {
      audio.startAmbientLoop('wheel_confirm_heartbeat_loop', HEARTBEAT_VOLUME);
    } else {
      audio.stopAmbientLoop('wheel_confirm_heartbeat_loop');
    }
  }

  private warningSurface(id: string, kind: WheelWarningKind, seat: CasinoSeat): Surface {
    return {
      id,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      isOpen: () => this.screen === kind,
      close: () => this.answerNo(),
      render: (ui) => {
        this.seat = seat;
        paintWheelWarning(ui, {
          kind,
          elapsedMs: this.clock() - this.screenOpenedAt,
          armingMs: WHEEL_ARMING_MS,
          onNo: () => this.answerNo(),
          onYes: () => this.answerYes(kind),
        });
      },
    };
  }

  // ── The wheel screen ────────────────────────────────────────────────────

  private wheelSurface(id: string, seat: CasinoSeat): Surface {
    // `blocksEscape` is read live by the root, so the surface carries it as a getter.
    const blocking = (): boolean => this.busy || this.screen === 'nothing';
    return {
      id,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      isOpen: () => this.screen === 'wheel' || this.screen === 'nothing',
      get blocksEscape() {
        return blocking();
      },
      wantsEscape: () => !this.busy && this.screen === 'wheel',
      close: () => this.leave(),
      onKey: (key, mods) =>
        this.wheelKey(key, mods.repeat === true || mods.predatesSurface === true),
      onKeyUp: (key) => {
        if (key === WHEEL_SPIN_KEY && this.hold?.byKey === true) this.releaseSpin();
      },
      onBlur: () => this.releaseSpin(),
      render: (ui) => {
        this.seat = seat;
        this.renderWheel(ui);
      },
    };
  }

  private wheelKey(key: string, stale: boolean): boolean {
    if (this.screen !== 'wheel') return false;
    if (key === WHEEL_SPIN_KEY) {
      if (!stale) this.pressSpin(true);
      return true;
    }
    if (key === 'ArrowLeft' || key === '-') {
      if (!stale) this.betDown();
      return true;
    }
    if (key === 'ArrowRight' || key === '+' || key === '=') {
      if (!stale) this.betUp();
      return true;
    }
    return false;
  }

  private leave(): void {
    if (this.busy || this.screen !== 'wheel') return;
    this.closeToFloor();
  }

  private get betLocked(): string | null {
    if (this.busy) return 'Locked while the wheel turns';
    if (this.freeSpinBet !== null) return 'The free spin plays on the same board';
    return null;
  }

  private betUp(): void {
    if (this.betLocked !== null) return;
    const upgrade = upgradeForStepAbove(this.bet);
    if (upgrade === null) return;
    this.bet += WHEEL_BET_STEP;
    this.flip = {
      wedgeIndex: upgrade.wedgeIndex,
      from: upgrade.from,
      to: upgrade.to,
      startedAt: this.clock(),
    };
    this.deps.audio?.play('wheel_bet_wedge_flip');
    this.quip('bet_up');
  }

  private betDown(): void {
    if (this.betLocked !== null || this.bet <= WHEEL_MIN_BET) return;
    const upgrade = upgradeForStepAbove(this.bet - WHEEL_BET_STEP);
    this.bet -= WHEEL_BET_STEP;
    if (upgrade !== null) {
      this.flip = {
        wedgeIndex: upgrade.wedgeIndex,
        from: upgrade.to,
        to: upgrade.from,
        startedAt: this.clock(),
      };
    }
    this.deps.audio?.play('wheel_bet_wedge_flip', { playbackRate: LOWERED_FLIP_PLAYBACK_RATE });
    this.quip('bet_down');
  }

  /** Why SPIN cannot be held right now, or null when it can. */
  private spinBlocked(seat: CasinoSeat): string | null {
    if (this.busy) return 'Wait for the wheel';
    if (this.freeSpinBet !== null) return null;
    if (!canAffordCoins(seat.active(), seat.companion(), this.bet)) {
      const short = this.bet - partyCoins(seat.active(), seat.companion());
      return `Need ${short.toLocaleString()} more coins`;
    }
    return null;
  }

  private pressSpin(byKey: boolean): void {
    const seat = this.seat;
    if (seat === null || this.hold !== null || this.spinBlocked(seat) !== null) return;
    this.hold = { startedAt: this.clock(), byKey };
    this.lastActivityAt = this.hold.startedAt;
    this.deps.audio?.play('wheel_hold_charge');
  }

  private releaseSpin(): void {
    if (this.hold === null) return;
    this.hold = null;
    this.deps.audio?.stopSound('wheel_hold_charge');
  }

  private holdProgress(now: number): number {
    if (this.hold === null) return 0;
    return Math.min(1, (now - this.hold.startedAt) / WHEEL_SPIN_HOLD_MS);
  }

  private tickHold(now: number): void {
    if (this.hold === null || this.holdProgress(now) < 1) return;
    this.hold = null;
    this.deps.audio?.stopSound('wheel_hold_charge');
    void this.commitSpin();
  }

  // ── Committing a spin ──────────────────────────────────────────────────

  private wonPrizes(): Set<WheelPrizeId> {
    return new Set(this.deps.ledger.prizesWon.filter(isWheelPrizeId));
  }

  private async commitSpin(): Promise<void> {
    const seat = this.seat;
    if (seat === null || this.busy) return;
    const crawler = seat.active();
    const companion = seat.companion();
    const human = crawler instanceof CatPlayer ? companion : crawler;
    const cat = crawler instanceof CatPlayer ? crawler : companion;
    const free = this.freeSpinBet !== null;
    const bet = this.freeSpinBet ?? this.bet;
    const board = boardForBet(bet);
    const undo: SpinUndo = {
      humanCoins: human.coins,
      catCoins: cat.coins,
      prizesMarked: [],
      freeSpinOwed: free,
    };
    if (!free && !spendPartyCoins(human, cat, bet, crawler)) return;
    if (!free) this.wagered += bet;
    this.freeSpinBet = null;

    const lucky = this.deps.isLucky?.() ?? false;
    const drawOutcome = lucky ? pickLuckyOutcome : pickOutcome;
    const outcome =
      this.deps.forcedOutcome?.(board) ?? drawOutcome(board, this.wonPrizes(), this.random);
    const kind: WheelCrawler = crawler instanceof CatPlayer ? 'cat' : 'human';
    const ledger = this.deps.ledger;
    const recipientKind = wheelPrizeRecipient(outcome.wedge, kind, ledger.prizesWon);
    const spin: CommittedSpin = {
      outcome,
      board,
      crawler,
      kind,
      recipient: recipientKind === 'human' ? human : cat,
      recipientKind,
      bet: free ? 0 : bet,
      boardBet: bet,
      free,
      landing: landingAngle(board, outcome.wedgeIndex, this.random),
    };
    const now = this.clock();
    this.phase = { kind: 'committing', spin, since: now };
    this.lastActivityAt = now;

    if (outcome.wedge.prize.kind === 'nothing') {
      // The wipe is this spin's round-trip; nothing after it can be saved.
      this.wipe = this.deps.progressWipe ?? dryRunWipe(this.clock);
      void this.wipe.wipe();
      return;
    }

    const prizeId = outcome.wedge.prizeId;
    const marked = markWheelPrizeWon(ledger, outcome.wedge, recipientKind);
    const previousPending = ledger.pendingOutcome;
    ledger.pendingOutcome = {
      wedgeId: outcome.wedge.id,
      prizeId,
      crawler: kind,
      recipient: recipientKind,
      bet: spin.bet,
      boardBet: spin.boardBet,
    };
    const saved = await this.deps.saveNow().catch((): SaveWriteOutcome => 'failed');
    // The screen may have been torn down while storage answered.
    if (!this.stillCommitting(spin)) return;
    if (!saveOutcomeCommitted(saved)) {
      this.undoCommit(human, cat, { ...undo, prizesMarked: marked }, bet);
      ledger.pendingOutcome = previousPending;
      this.phase = { kind: 'idle' };
      this.deps.onNotice?.(
        "The house couldn't record your spin, so it never happened. Nothing was taken.",
        'warning',
      );
      return;
    }
    this.launch(spin);
  }

  /** Spin Again's free spin, kept in the ledger so a reload never takes it back. */
  private get freeSpinBet(): number | null {
    return this.deps.ledger.freeSpinBet;
  }

  private set freeSpinBet(bet: number | null) {
    this.deps.ledger.freeSpinBet = bet;
  }

  private crawlerOf(seat: CasinoSeat, kind: WheelCrawler): Player {
    const active = seat.active();
    const activeKind: WheelCrawler = active instanceof CatPlayer ? 'cat' : 'human';
    return activeKind === kind ? active : seat.companion();
  }

  private stillCommitting(spin: CommittedSpin): boolean {
    return this.phase.kind === 'committing' && this.phase.spin === spin;
  }

  private undoCommit(human: Player, cat: Player, undo: SpinUndo, bet: number): void {
    human.coins = undo.humanCoins;
    cat.coins = undo.catCoins;
    if (!undo.freeSpinOwed) this.wagered -= bet;
    else this.freeSpinBet = bet;
    const ledger = this.deps.ledger;
    for (const entry of undo.prizesMarked) {
      const index = ledger.prizesWon.lastIndexOf(entry);
      if (index >= 0) ledger.prizesWon.splice(index, 1);
    }
  }

  private launch(spin: CommittedSpin): void {
    const now = this.clock();
    const plan = planSpin(this.rotation, spin.landing, this.random);
    this.phase = {
      kind: 'spinning',
      spin,
      plan,
      startedAt: now,
      lastRotation: plan.startRotation,
      creaked: false,
    };
    this.deps.audio?.play('wheel_launch');
    this.say('spin');
  }

  // ── The spin and the reveal ────────────────────────────────────────────

  private tickPhase(now: number): void {
    const phase = this.phase;
    switch (phase.kind) {
      case 'committing':
        if (this.wipe !== null && wipeAnswered(this.wipe.wipeStatus)) this.launch(phase.spin);
        return;
      case 'spinning':
        this.tickSpin(phase, now);
        return;
      case 'revealing':
        this.tickReveal(phase, now);
        return;
      case 'nothing':
        this.tickNothing(phase, now);
        return;
      case 'idle':
        return;
    }
  }

  private tickSpin(phase: Extract<WheelPhase, { kind: 'spinning' }>, now: number): void {
    const elapsed = now - phase.startedAt;
    const rotation = phase.plan.angleAt(elapsed);
    const crossed = pegCrossings(phase.spin.board, phase.lastRotation, rotation);
    phase.lastRotation = rotation;
    this.rotation = rotation;
    if (crossed > 0) {
      this.lastPegAt = now;
      for (let tick = 0; tick < Math.min(crossed, MAX_TICKS_PER_UPDATE); tick++) {
        this.deps.audio?.playRandomFresh(TICKS, { volume: PEG_TICK_VOLUME });
      }
    }
    if (!phase.creaked && phase.plan.velocityAt(elapsed) < CREAK_BELOW_VELOCITY) {
      phase.creaked = true;
      this.deps.audio?.play('wheel_slow_creak');
    }
    if (elapsed >= phase.plan.durationMs) this.land(phase.spin, now);
  }

  private land(spin: CommittedSpin, now: number): void {
    this.landedAt = now;
    const wedge = spin.outcome.wedge;
    const audio = this.deps.audio;
    if (wedge.prize.kind === 'nothing') {
      audio?.play('wheel_land_bad');
      this.enterNothing(now);
      return;
    }
    if (wedge.prize.kind === 'spin_again') audio?.play('wheel_spin_again');
    else if (isRedWedge(wedge)) audio?.play('wheel_land_bad');
    else audio?.play('wheel_land_good');

    const effectKind = revealEffectFor(wedge);
    const applied =
      effectKind === 'freeze'
        ? null
        : applyWheelPrize(wedge.prize, this.prizeTarget(spin.recipient, spin.recipientKind));
    const ledger = this.deps.ledger;
    ledger.pendingOutcome = null;
    // Both outlive a reload: the spin that earned them was paid for.
    if (effectKind === 'freeze') ledger.owedFreeze = spin.kind;
    if (effectKind === 'spin_again') ledger.freeSpinBet = spin.boardBet;
    void this.deps.saveNow();

    if (effectKind === 'stab') audio?.play('tito_stab');
    if (effectKind === 'robbed') audio?.play('wheel_robbed_coin_drain');
    if (effectKind === 'red' || effectKind === 'freeze' || effectKind === 'robbed') {
      this.chuckleAt = now + CHUCKLE_DELAY_MS;
    }
    if (effectKind === 'handies') {
      this.deps.onNotice?.('Unlimited Free Handies at Bitches or Penis Parade. Enjoy.', 'accent');
    }
    this.say(titoTriggerFor(effectKind));

    const seat = this.seat;
    const purseAfter = seat === null ? 0 : partyCoins(seat.active(), seat.companion());
    const effect: WheelPrizeEffect = applied ?? {
      hpLost: 0,
      coinsTaken: 0,
      coinsWon: 0,
      items: [],
      tier: null,
    };
    this.phase = {
      kind: 'revealing',
      spin,
      startedAt: now,
      sirenStarted: false,
      prizeShown: false,
      reveal: {
        wedge,
        effect: effectKind,
        durationMs: REVEAL_MS[effectKind],
        itemTier: effect.tier,
        items: effect.items,
        prizeLine: prizeLine(wedge, effect, spin.recipientKind),
        coinsTaken: effect.coinsTaken,
        coinsWon: effect.coinsWon,
        purseBefore: purseAfter + effect.coinsTaken - effect.coinsWon,
        purseAfter,
      },
    };
  }

  private tickReveal(phase: Extract<WheelPhase, { kind: 'revealing' }>, now: number): void {
    const elapsed = now - phase.startedAt;
    if (
      phase.reveal.effect === 'coins_jackpot' &&
      !phase.sirenStarted &&
      elapsed >= SIREN_DELAY_MS
    ) {
      phase.sirenStarted = true;
      this.deps.audio?.play('slots_jackpot_siren');
    }
    if (elapsed < phase.reveal.durationMs || phase.prizeShown) return;
    if (this.presentPrize(phase)) return;
    if (phase.sirenStarted) this.deps.audio?.stopSound('slots_jackpot_siren');
    this.finishReveal();
  }

  /** Raises the item prize screen over the wheel; false for a prize with no items to show. */
  private presentPrize(phase: Extract<WheelPhase, { kind: 'revealing' }>): boolean {
    const { reveal } = phase;
    if (reveal.itemTier !== null && reveal.items.length > 0) {
      phase.prizeShown = true;
      this.prizes.present(
        {
          tier: reveal.itemTier,
          title: `${reveal.itemTier} prize`,
          playerName: crawlerName(phase.spin.recipientKind),
          contents: { coins: reveal.coinsWon, itemRewards: reveal.items },
          detail: prizeDetail(reveal.items),
        },
        () => this.finishReveal(),
      );
      return true;
    }
    return false;
  }

  private finishReveal(): void {
    this.phase = { kind: 'idle' };
    this.lastActivityAt = this.clock();
  }

  /** Hurries the prize screen to its end; the items in it are already the crawler's. */
  private dismissPrizes(): void {
    for (let press = 0; press < PRIZE_SKIPS_TO_CLOSE && this.prizes.isOpen; press++) {
      this.prizes.skip();
    }
  }

  private prizeSurface(id: string): Surface {
    return {
      id,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      isOpen: () => this.prizes.isOpen,
      close: () => this.prizes.skip(),
      onKey: (key, mods) => {
        if (key !== 'Enter' && key !== WHEEL_SPIN_KEY) return false;
        if (mods.repeat !== true && mods.predatesSurface !== true) this.prizes.skip();
        return true;
      },
      render: (ui) => {
        this.prizes.paint(ui, ui.screen.w, ui.screen.h);
        ui.hit('skip', ui.screen, {
          onTap: () => this.prizes.skip(),
          focusable: false,
          sound: null,
        });
      },
    };
  }

  private prizeTarget(crawler: Player, kind?: WheelCrawler): WheelPrizeTarget {
    const crawlerKind: WheelCrawler = kind ?? (crawler instanceof CatPlayer ? 'cat' : 'human');
    return {
      crawler,
      kind: crawlerKind,
      grantAttackCow: this.deps.grantAttackCow,
    };
  }

  // ── The Nothing ────────────────────────────────────────────────────────

  private enterNothing(now: number): void {
    this.phase = { kind: 'nothing', landedAt: now };
    this.screen = 'nothing';
    this.say('nothing');
    // The Nothing is a void, not a corner of the club: the crowd and every
    // other world bed fall silent with the lights. Its own cues are one-shots
    // on the effects bus, so they still play over the muted ambience.
    this.deps.audio?.pauseAmbience('nothing');
    const firstDeath = now + NOTHING_LAND_PAUSE_MS;
    this.dyingBulbs = Array.from({ length: WHEEL_BULB_COUNT }, (_, index) => ({
      at: firstDeath + index * NOTHING_BULB_STAGGER_MS + this.random() * NOTHING_BULB_JITTER_MS,
      sounded: false,
    }));
  }

  private nothingTimeline(landedAt: number): {
    bulbsOutAt: number;
    swallowAt: number;
    firstLineAt: number;
    secondLineAt: number;
    doneAt: number;
  } {
    const lastBulb = this.dyingBulbs.reduce((latest, bulb) => Math.max(latest, bulb.at), landedAt);
    const swallowAt = lastBulb + NOTHING_AFTER_BULBS_MS;
    const firstLineAt = swallowAt + NOTHING_SWALLOW_MS + NOTHING_FIRST_LINE_DELAY_MS;
    const secondLineAt = firstLineAt + NOTHING_SECOND_LINE_DELAY_MS;
    return {
      bulbsOutAt: lastBulb,
      swallowAt,
      firstLineAt,
      secondLineAt,
      doneAt: secondLineAt + NOTHING_HOLD_MS,
    };
  }

  private tickNothing(phase: Extract<WheelPhase, { kind: 'nothing' }>, now: number): void {
    const audio = this.deps.audio;
    for (const bulb of this.dyingBulbs) {
      if (bulb.sounded || now < bulb.at) continue;
      bulb.sounded = true;
      const pitch = 1 + (this.random() * 2 - 1) * BULB_PITCH_SWING;
      audio?.play('wheel_light_bulb_dying', { playbackRate: pitch, volume: BULB_VOLUME });
    }
    const timeline = this.nothingTimeline(phase.landedAt);
    if (!this.nothingSwallowSounded && now >= timeline.swallowAt) {
      this.nothingSwallowSounded = true;
      audio?.play('nothing_void_swallow');
    }
    if (!this.nothingToneSounded && now >= timeline.secondLineAt) {
      this.nothingToneSounded = true;
      audio?.play('nothing_final_tone');
    }
    const wiped = this.wipe === null || this.wipe.wipeStatus === 'wiped';
    if (!this.nothingFinished && now >= timeline.doneAt && wiped) {
      this.nothingFinished = true;
      if (this.nothingEndsInRestart) this.deps.afterNothing();
    }
  }

  private nothingModel(now: number): NothingModel | null {
    const phase = this.phase;
    if (phase.kind !== 'nothing') return null;
    const timeline = this.nothingTimeline(phase.landedAt);
    const wiped = this.wipe === null || this.wipe.wipeStatus === 'wiped';
    return {
      swallow: Math.max(0, Math.min(1, (now - timeline.swallowAt) / NOTHING_SWALLOW_MS)),
      firstLineAgeMs: now - timeline.firstLineAt,
      secondLineAgeMs: now - timeline.secondLineAt,
      holding: now >= timeline.doneAt && !wiped,
      signInRequired: this.wipe?.wipeStatus === 'signInRequired',
      nowMs: now,
    };
  }

  private nothingSurface(id: string): Surface {
    return {
      id,
      band: 'system',
      haltsWorld: true,
      locksKeyboard: true,
      blocksEscape: true,
      isOpen: () => this.screen === 'nothing',
      render: (ui) => {
        const model = this.nothingModel(this.clock());
        if (model !== null) paintNothing(ui, model);
      },
    };
  }

  // ── Tito ───────────────────────────────────────────────────────────────

  private say(trigger: TitoTrigger): void {
    this.titoLine = pickTitoLine(trigger, this.titoLine, this.titoRandom);
    this.titoLineAt = this.clock();
    this.lastActivityAt = this.titoLineAt;
  }

  /** A quip that waits its turn behind whatever Tito just said. */
  private quip(trigger: TitoTrigger): void {
    if (this.clock() - this.titoLineAt < TITO_QUIP_GAP_MS) return;
    this.say(trigger);
  }

  private titoPose(now: number): { pose: TitoBustPose; progress: number } {
    const phase = this.phase;
    if (phase.kind === 'revealing') {
      const elapsed = now - phase.startedAt;
      if (phase.reveal.effect === 'stab' && elapsed < STAB_POSE_MS) {
        return { pose: 'lunge', progress: elapsed / STAB_POSE_MS };
      }
      const red = isRedWedge(phase.reveal.wedge);
      return red
        ? { pose: 'chuckle', progress: (elapsed % STAB_POSE_MS) / STAB_POSE_MS }
        : { pose: 'grin', progress: 1 };
    }
    if (phase.kind === 'nothing') return { pose: 'grin', progress: 1 };
    if (phase.kind === 'spinning') return { pose: 'grin', progress: 1 };
    return { pose: 'idle', progress: 0 };
  }

  // ── Paint ──────────────────────────────────────────────────────────────

  private advanceBulbs(dt: number): void {
    const phase = this.phase;
    let rate = BULB_IDLE_STEPS_PER_SECOND;
    if (phase.kind === 'spinning') {
      const elapsed = this.clock() - phase.startedAt;
      const launch = Math.max(Number.EPSILON, phase.plan.velocityAt(0));
      const slowing = 1 - Math.min(1, phase.plan.velocityAt(elapsed) / launch);
      rate += BULB_SLOWING_EXTRA_STEPS_PER_SECOND * slowing;
    }
    this.bulbPhase += (rate * dt) / MS_PER_SECOND;
  }

  private bulbsDark(now: number): number {
    if (this.phase.kind !== 'nothing') return 0;
    return this.dyingBulbs.filter((bulb) => now >= bulb.at).length;
  }

  private viewModel(seat: CasinoSeat, now: number): WheelViewModel {
    const phase = this.phase;
    const free = this.freeSpinBet !== null;
    const board = boardForBet(this.freeSpinBet ?? this.bet);
    const flip = this.flip;
    const blocked = this.spinBlocked(seat);
    const reveal =
      phase.kind === 'revealing' ? { ...phase.reveal, elapsedMs: now - phase.startedAt } : null;
    const tito = this.titoPose(now);
    const lineAge = now - this.titoLineAt;
    const betLocked = this.betLocked;
    return {
      nowMs: now,
      board,
      flip:
        flip === null
          ? null
          : {
              wedgeIndex: flip.wedgeIndex,
              from: flip.from,
              to: flip.to,
              progress: Math.min(1, (now - flip.startedAt) / WHEEL_FLIP_MS),
            },
      rotation: this.rotation,
      clapperKick: Math.max(0, 1 - (now - this.lastPegAt) / CLAPPER_KICK_MS),
      landingKick: Math.max(0, 1 - (now - this.landedAt) / LANDING_KICK_MS),
      bulbPhase: this.bulbPhase,
      bulbsDark: this.bulbsDark(now),
      bulbsSteady: phase.kind === 'nothing',
      bet: this.freeSpinBet ?? this.bet,
      purse: partyCoins(seat.active(), seat.companion()),
      betDown: betLocked ?? (this.bet <= WHEEL_MIN_BET ? 'Already at the minimum bet' : null),
      betUp: betLocked ?? (this.bet >= WHEEL_MAX_BET ? 'Already at the maximum bet' : null),
      spin: {
        free,
        hold: this.holdProgress(now),
        heldByPointer: this.hold !== null && !this.hold.byKey,
        disabled: blocked,
      },
      leaveDisabled: this.busy ? 'Not while the wheel is turning' : null,
      tito: {
        pose: tito.pose,
        progress: tito.progress,
        line: lineAge < TITO_LINE_MS ? this.titoLine : null,
        lineAgeMs: lineAge,
      },
      reveal,
      committing: phase.kind === 'committing',
    };
  }

  private renderWheel(ui: Ui): void {
    const seat = this.seat;
    if (seat === null) return;
    const now = this.clock();
    // A pointer hold is timed on the same clock the update uses, so a frame
    // that lands on the second it completes commits it straight away.
    this.tickHold(now);
    this.view.render(ui, this.viewModel(seat, now), {
      betDown: () => this.betDown(),
      betUp: () => this.betUp(),
      leave: () => this.leave(),
      spinDown: () => this.pressSpin(false),
      spinRelease: () => this.releaseSpin(),
    });
  }
}
