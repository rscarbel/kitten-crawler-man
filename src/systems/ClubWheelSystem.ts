/**
 * Donald's Wheel of Fortune: the host that takes the bet, commits each spin to
 * the save before the wheel moves, plays the spin and the outcome's reveal, and
 * hands the prize to the crawler who spun. It mounts four surfaces: the
 * blaring warning, the "are you sure" prompt, the wheel screen and
 * Permanent Death.
 *
 * Every spin does exactly one storage round-trip before the wheel turns, so
 * how long the wheel takes to start never gives the outcome away: a normal
 * outcome writes the save with the bet spent, the prize marked won and the
 * outcome pending; Permanent Death's round-trip is the wipe itself. A tab closed
 * mid-spin leaves the pending outcome in the save, and the next load pays it.
 *
 * A free spin a quest paid for opens straight on the wheel, past both prompts,
 * with Permanent Death taped over: the board it draws from has no wedge that wipes,
 * for that spin and every Spin Again it chains into. The free spin is counted
 * as used in the same save that commits it, so a reload mid-spin cannot hand
 * it back, and the wheel closes back to the picker once the chain resolves.
 */

import { crawlerDisplayName } from '../characters/characters';
import { crawlerPronouns } from '../characters/crawlerPronouns';
import type { AudioManager } from '../audio/AudioManager';
import type { AudioScope } from '../audio/AudioScope';
import type { SoundId } from '../audio/sounds';
import type { Player } from '../Player';
import { ITEM_DEF, type ItemId } from '../core/items/defs/ItemDefs';
import { RewardChestScreen } from '../ui/screens/rewardChest/RewardChestScreen';
import { CHEST_SOURCE_TITLES } from '../loot/rewardChest';
import { type GrantedLine } from '../core/progression/achievementSave';
import { partyCoins, spendPartyCoins, canAffordCoins } from '../core/party/partyCoins';
import {
  saveOutcomeCommitted,
  type SaveWriteOutcome,
  type WipeStatus,
} from '../core/save/progressPersistence';
import {
  questFreeSpinsLeft,
  tapedChainOwed,
  type WheelCrawler,
  type WheelLedger,
} from '../core/save/WheelLedger';
import { CatPlayer } from '../creatures/CatPlayer';
import { pickDonaldLine, type DonaldTrigger } from '../dialog/scripts/donald';
import { petWords, type PetName, type PetNames, type PetWords } from '../core/party/petNames';
import type { DonaldBustPose } from '../sprites/donaldSprite';
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
import {
  paintPermanentDeath,
  type PermanentDeathModel,
} from '../ui/casino/wheel/permanentDeathView';
import type { WheelFreeSpinOffer, WheelGameHost } from './casino/CasinoGameHost';
import type { CasinoSeat } from './ClubCasinoSystem';
import {
  BASE_WHEEL_BOARD,
  WHEEL_BET_STEP,
  WHEEL_MAX_BET,
  WHEEL_MIN_BET,
  boardForBet,
  isRedWedge,
  isWheelPrizeId,
  tapedBoard,
  upgradeForStepAbove,
  type WheelBoard,
  type WheelPrizeId,
  type WheelWedge,
} from './casino/wheel/wheelBoard';
import { pickLuckyOutcome, pickOutcome, type WheelOutcome } from './casino/wheel/wheelOutcome';
import type { LuckCheck } from '../core/state/GodMode';
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
export const PERMANENT_DEATH_SURFACE_ID = 'wheel-permanent-death';
export const WHEEL_PRIZE_SURFACE_ID = 'wheel-prize';

/** Every surface the wheel mounts, in stacking order. */
export const WHEEL_SURFACE_IDS: readonly string[] = [
  WHEEL_WARNING_SURFACE_ID,
  WHEEL_CONFIRM_SURFACE_ID,
  WHEEL_SURFACE_ID,
  WHEEL_PRIZE_SURFACE_ID,
  PERMANENT_DEATH_SURFACE_ID,
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

/** The run's pets as the wheel speaks of them and names the cow it gives. */
export interface WheelPets {
  readonly petNames: PetNames;
  /** Asks for the attack cow's name unless she has one, then runs `next`. */
  nameAttackCow(next: () => void): void;
}

/** For a review wheel, where no pet is ever named and nothing is asked. */
export const UNNAMED_WHEEL_PETS: WheelPets = {
  petNames: { nameOf: () => null },
  nameAttackCow: (next) => next(),
};

export interface ClubWheelDeps {
  readonly audio: AudioManager | null;
  /** Where the klaxon and heartbeat loops run, faded out with the scene. */
  readonly audioScope: AudioScope | null;
  readonly ledger: WheelLedger;
  /** Writes the save as the party stands now; resolves once storage has answered. */
  readonly saveNow: () => Promise<SaveWriteOutcome>;
  /** The page's wipe, or null where nothing is saved: Permanent Death then only pretends. */
  readonly progressWipe: ProgressWipe | null;
  /** Runs once Permanent Death has played out and the save is gone: the page reload. */
  readonly afterPermanentDeath: () => void;
  /** Gives the human crawler the attack cow and stands her beside him; her arrival moo is the grant's own. */
  readonly grantAttackCow: () => void;
  readonly pets: WheelPets;
  /** A notice for the scene's toasts. */
  readonly onNotice?: (message: string, tone: ToastTone) => void;
  readonly clock?: () => number;
  readonly random?: () => number;
  /**
   * Picks Donald's patter. Kept apart from `random` so a seeded wheel's draws
   * stay the same whatever he says; only review fixtures pass one.
   */
  readonly donaldRandom?: () => number;
  /**
   * Picks the next outcome instead of the rigged draw. Only the review harness
   * passes one; the real wheel always draws.
   */
  readonly forcedOutcome?: (board: WheelBoard) => WheelOutcome | null;
  /** Read as each spin is decided: while true, the wheel never lands on a red wedge. */
  readonly isLucky?: LuckCheck;
}

type WheelScreen = 'closed' | 'warning' | 'confirm' | 'wheel' | 'permanent_death';

/** A spin the bet and the save have committed to. */
interface CommittedSpin {
  readonly outcome: WheelOutcome;
  readonly board: WheelBoard;
  readonly crawler: Player;
  readonly kind: WheelCrawler;
  /** The crawler the prize goes to; see {@link wheelPrizeRecipient}. */
  readonly recipient: Player;
  readonly recipientKind: WheelCrawler;
  /** Coins staked: zero for a Spin Again, only the upgrades for a quest's free spin. */
  readonly bet: number;
  /** The bet whose board the wheel shows, which a free spin keeps. */
  readonly boardBet: number;
  readonly free: boolean;
  /** Turns on the taped board: part of a quest free spin's chain. */
  readonly taped: boolean;
  readonly landing: number;
}

/** What a failed commit puts back. */
interface SpinUndo {
  readonly humanCoins: number;
  readonly catCoins: number;
  readonly freeSpinBet: number | null;
  readonly questFreeSpinsUsed: number;
  readonly tapedChain: boolean;
  /** Won-set entries this spin added, taken back out if the save is refused. */
  readonly prizesMarked: readonly string[];
}

/** How the next spin is paid for. */
type SpinPayment =
  /** A landed Spin Again's spin on the same board. */
  | { readonly kind: 'owed' }
  /** A quest's free spin: the minimum bet is covered, upgrades above it are paid. */
  | { readonly kind: 'quest'; readonly price: number }
  | { readonly kind: 'paid'; readonly price: number };

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
  | { readonly kind: 'permanent_death'; readonly landedAt: number };

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

/** One rim bulb going dark during Permanent Death. */
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
/** Donald holds a line this long before it fades. */
const DONALD_LINE_MS = 4200;
/** Bet-step quips are skipped when Donald spoke this recently, so the stepper is not a chatterbox. */
const DONALD_QUIP_GAP_MS = 2500;
/** Donald fills a long silence while the wheel sits idle. */
const DONALD_IDLE_LINE_MS = 14000;
/** One loop of Donald's chuckle while a red landing's reveal holds. */
const CHUCKLE_CYCLE_MS = 900;
/** A chuckle this long after a red landing, once the wedge has registered. */
const CHUCKLE_DELAY_MS = 450;
/** The siren after the 500,000 sliver's landing sting. */
const SIREN_DELAY_MS = 900;

/** How long each kind of reveal holds the screen before the wheel is idle again. */
const REVEAL_MS: Readonly<Record<WheelRevealEffect, number>> = {
  red: 3000,
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

/** Permanent Death, from the landing: the pause, each bulb, the swallow and the two lines. */
const PERMANENT_DEATH_LAND_PAUSE_MS = 1100;
const PERMANENT_DEATH_BULB_STAGGER_MS = 110;
const PERMANENT_DEATH_BULB_JITTER_MS = 70;
const PERMANENT_DEATH_AFTER_BULBS_MS = 500;
const PERMANENT_DEATH_SWALLOW_MS = 2600;
const PERMANENT_DEATH_FIRST_LINE_DELAY_MS = 400;
const PERMANENT_DEATH_SECOND_LINE_DELAY_MS = 2400;
/** How long "Everything is gone." holds before the reload, when the wipe has finished. */
const PERMANENT_DEATH_HOLD_MS = 3200;
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
const CHUCKLES: readonly SoundId[] = ['donald_chuckle_1', 'donald_chuckle_2', 'donald_chuckle_3'];
const MS_PER_SECOND = 1000;

/** A big enough cash prize gets the full coin shower; the 500,000 sliver gets the jackpot. */
const BIG_GOLD = 50_000;
const JACKPOT_GOLD = 500_000;

function revealEffectFor(wedge: WheelWedge): WheelRevealEffect {
  const prize = wedge.prize;
  switch (prize.kind) {
    case 'robbed':
      return 'robbed';
    case 'freeze':
      return 'freeze';
    case 'take_damage':
    case 'poison':
    case 'double_damage':
    case 'burn':
    case 'permanent_death':
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
    case 'legendary_weapon':
    case 'epic_charm':
    case 'legendary_charm':
    case 'rare_chest':
    case 'uncommon_chest':
      return 'item';
  }
}

function plural(name: string): string {
  return name.endsWith('s') ? name : `${name}s`;
}

/**
 * The line under the landing banner: what the prize paid and to whom, never
 * the banner's own title over again.
 */
function prizeLine(
  wedge: WheelWedge,
  effect: WheelPrizeEffect,
  recipient: WheelCrawler,
  cowName: PetName | null,
): string {
  const name = crawlerDisplayName(recipient);
  const { prize } = wedge;
  if (prize.kind === 'pet') return attackCowPrizeLine(cowName);
  if (prize.kind === 'gold') return `Paid straight into ${name}'s purse`;
  if (prize.kind === 'take_damage') return `${name} loses ${effect.hpLost} HP`;
  if (prize.kind === 'heal_and_gold') {
    return `${name} is healed to full and paid ${prize.amount.toLocaleString()} gold`;
  }
  if (effect.rarity === null || effect.items.length === 0) return wedge.label;
  const names = effect.items.map(({ id, quantity }) =>
    quantity > 1 ? `${quantity} ${plural(ITEM_DEF[id].name)}` : ITEM_DEF[id].name,
  );
  const coins = effect.coinsWon > 0 ? [`${effect.coinsWon.toLocaleString()} coins`] : [];
  return `For ${name}: ${[...names, ...coins].join(' and ')}`;
}

/**
 * The cow is named once her banner is down, so her own name reaches this
 * line only when the run named her before she was won.
 */
function attackCowPrizeLine(cowName: PetName | null): string {
  const owner = crawlerDisplayName('human');
  const theirs = crawlerPronouns('human').possessive;
  return cowName === null
    ? `An attack cow of ${theirs} very own for ${owner}`
    : `${cowName}, an attack cow of ${theirs} very own for ${owner}`;
}

/** What a single named item does, for under the prize screen's title. */
function prizeDetail(items: ReadonlyArray<{ readonly id: ItemId }>): string {
  const only = items.length === 1 ? items[0] : undefined;
  return only === undefined ? '' : (ITEM_DEF[only.id].description ?? '');
}

function donaldTriggerFor(effect: WheelRevealEffect): DonaldTrigger {
  switch (effect) {
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

export class ClubWheelSystem implements WheelGameHost {
  private screen: WheelScreen = 'closed';
  private screenOpenedAt = 0;
  private phase: WheelPhase = { kind: 'idle' };
  private seat: CasinoSeat | null = null;
  private bet = WHEEL_MIN_BET;
  private flip: WedgeFlipState | null = null;
  private hold: SpinHold | null = null;
  /** Rests with Permanent Death under the pointer, so the first thing seen is what is at stake. */
  private rotation = rotationForPointerAt(wedgeCenterAngle(BASE_WHEEL_BOARD, 0));
  private lastPegAt = Number.NEGATIVE_INFINITY;
  private landedAt = Number.NEGATIVE_INFINITY;
  private bulbPhase = 0;
  private lastUpdateAt: number | null = null;
  private donaldLine: string | null = null;
  private donaldLineAt = Number.NEGATIVE_INFINITY;
  private lastActivityAt = 0;
  private chuckleAt: number | null = null;
  private wipe: ProgressWipe | null = null;
  private dyingBulbs: DyingBulb[] = [];
  private permanentDeathSwallowSounded = false;
  private permanentDeathToneSounded = false;
  private permanentDeathFinished = false;
  private permanentDeathEndsInRestart = true;
  /** The wheel was opened from the picker's free spin rather than through the warnings. */
  private freeSpinVisit = false;
  /** Puts the club's game picker back up; null until the club binds it. */
  private reopenPicker: (() => void) | null = null;
  /** The scene is tearing the wheel down: nothing it closes may raise the picker again. */
  private tearingDown = false;
  private readonly view = new WheelView();
  /** The item prize screen: a reward chest showing what the wheel already handed over. */
  private readonly prizes: RewardChestScreen;
  private readonly clock: () => number;
  private readonly random: () => number;
  private readonly donaldRandom: () => number;

  constructor(private readonly deps: ClubWheelDeps) {
    this.clock = deps.clock ?? (() => performance.now());
    this.random = deps.random ?? Math.random;
    this.donaldRandom = deps.donaldRandom ?? Math.random;
    this.prizes = new RewardChestScreen(deps.audio);
  }

  // ── CasinoGameHost ──────────────────────────────────────────────────────

  get anySurfaceOpen(): boolean {
    return this.screen !== 'closed';
  }

  /**
   * Every time the wheel is picked, the warning comes first; only a quest's
   * free spin ({@link openFreeSpin}) goes around it.
   */
  open(seat: CasinoSeat): void {
    if (this.screen !== 'closed') return;
    this.seat = seat;
    this.showScreen('warning');
    this.deps.audio?.pauseMusic('wheel', MUSIC_FADE_MS);
  }

  get freeSpinOffer(): WheelFreeSpinOffer | null {
    const ledger = this.deps.ledger;
    const chainOwed = tapedChainOwed(ledger);
    const count = questFreeSpinsLeft(ledger) + (chainOwed ? 1 : 0);
    if (count === 0) return null;
    // A paid Spin Again turns on the untaped board, so it is played behind the warnings first.
    const untapedSpinOwed = ledger.freeSpinBet !== null && !chainOwed;
    return { count, blocked: untapedSpinOwed ? 'Play your owed Spin Again first' : null };
  }

  bindPicker(reopen: () => void): void {
    this.reopenPicker = reopen;
  }

  /** Straight onto the wheel with Permanent Death taped over: the warnings guard a wipe it cannot reach. */
  openFreeSpin(seat: CasinoSeat): boolean {
    const takeable = this.freeSpinOffer?.blocked === null;
    if (this.screen !== 'closed' || !takeable) return false;
    this.seat = seat;
    this.freeSpinVisit = true;
    this.showScreen('wheel');
    this.deps.audio?.pauseMusic('wheel', MUSIC_FADE_MS);
    return true;
  }

  update(): void {
    const now = this.clock();
    const dt = this.lastUpdateAt === null ? 0 : Math.max(0, now - this.lastUpdateAt);
    this.lastUpdateAt = now;
    this.syncLoops();
    if (this.screen !== 'wheel' && this.screen !== 'permanent_death') return;
    this.tickHold(now);
    this.prizes.tick();
    this.tickPhase(now);
    this.advanceBulbs(dt);
    if (this.chuckleAt !== null && now >= this.chuckleAt) {
      this.chuckleAt = null;
      this.deps.audio?.playRandom(CHUCKLES);
    }
    if (this.phase.kind === 'idle' && now - this.lastActivityAt >= DONALD_IDLE_LINE_MS) {
      this.say('idle');
    }
    if (this.flip !== null && now - this.flip.startedAt >= WHEEL_FLIP_MS) this.flip = null;
  }

  /**
   * The scene is going away under the wheel: a spin already turning lands on
   * the spot so its prize is paid, then everything closes as if the player
   * had left. Permanent Death is never interrupted; the page reload ends it.
   */
  forceClose(): void {
    if (this.screen === 'closed') return;
    const phase = this.phase;
    const turning = phase.kind === 'spinning' || phase.kind === 'committing' ? phase.spin : null;
    const wiping =
      turning?.outcome.wedge.prize.kind === 'permanent_death' || this.screen === 'permanent_death';
    if (wiping) {
      // The cinematic goes with the scene, but the save is already being
      // erased: the page must still restart once it is gone, or play would
      // carry on with every save silently refused.
      const wipe = this.wipe ?? this.deps.progressWipe ?? dryRunWipe(this.clock);
      this.wipe = wipe;
      if (this.permanentDeathEndsInRestart && !this.permanentDeathFinished) {
        this.permanentDeathFinished = true;
        void wipe.wipe().then(() => this.deps.afterPermanentDeath());
      }
      return;
    }
    // Skipping the prize screen can finish a reveal that would raise the picker; a teardown never does.
    this.tearingDown = true;
    if (turning !== null) this.land(turning, this.clock());
    this.dismissPrizes();
    this.phase = { kind: 'idle' };
    this.deps.audio?.stopSound('slots_jackpot_siren');
    this.closeToFloor();
    this.tearingDown = false;
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
      this.permanentDeathSurface(`${prefix}${PERMANENT_DEATH_SURFACE_ID}`),
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

  /** The board the wheel shows right now, taped or not. */
  get currentBoard(): WheelBoard {
    return this.boardOnShow();
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
   * Plays Permanent Death without ever calling {@link ClubWheelDeps.afterPermanentDeath}:
   * a gate auditing the screen must not reload the page under itself.
   */
  openPermanentDeathForReview(seat: CasinoSeat): void {
    const index = boardForBet(this.bet).findIndex(
      (wedge) => wedge.prize.kind === 'permanent_death',
    );
    this.permanentDeathEndsInRestart = false;
    this.landForReview(seat, Math.max(0, index));
  }

  /** Shuts every wheel screen at once, Permanent Death included: review harnesses only. */
  resetForReview(): void {
    if (this.screen === 'closed') return;
    this.dismissPrizes();
    this.phase = { kind: 'idle' };
    this.freeSpinVisit = false;
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
    const board = this.boardOnShow();
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
      taped: this.tapedNow,
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
      this.say(this.freeSpinVisit ? 'free_spin_greet' : 'greet');
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

  /**
   * Shuts the wheel. `toPicker` puts the club's game picker back up instead
   * of leaving the player on the floor.
   */
  private closeToFloor(toPicker = false): void {
    if (this.screen === 'permanent_death') return;
    this.freeSpinVisit = false;
    this.screen = 'closed';
    this.hold = null;
    this.flip = null;
    this.donaldLine = null;
    this.deps.audio?.stopSound('wheel_hold_charge');
    this.deps.audio?.stopSound('slots_jackpot_siren');
    this.syncLoops();
    this.deps.audio?.resumeMusic('wheel', MUSIC_FADE_MS);
    this.deps.audio?.resumeAmbience('permanent_death');
    const ledger = this.deps.ledger;
    const frozen = ledger.owedFreeze;
    const seat = this.seat;
    if (frozen !== null && seat !== null) {
      ledger.owedFreeze = null;
      applyWheelPrize({ kind: 'freeze' }, this.prizeTarget(this.crawlerOf(seat, frozen), frozen));
      void this.deps.saveNow();
    }
    if (toPicker && !this.tearingDown) this.reopenPicker?.();
  }

  private syncLoops(): void {
    const audio = this.deps.audioScope;
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
    const blocking = (): boolean => this.busy || this.screen === 'permanent_death';
    return {
      id,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      isOpen: () => this.screen === 'wheel' || this.screen === 'permanent_death',
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
    this.closeToFloor(this.freeSpinVisit);
  }

  /** Leave, as the wheel's own button would: review harnesses only. */
  leaveForReview(): void {
    this.leave();
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
    const payment = this.nextPayment;
    if (payment.kind === 'owed' || payment.price === 0) return null;
    if (!canAffordCoins(seat.active(), seat.companion(), payment.price)) {
      const short = payment.price - partyCoins(seat.active(), seat.companion());
      return `Need ${short.toLocaleString()} more coins`;
    }
    return null;
  }

  /**
   * What the next spin costs. An owed Spin Again comes first; a quest's free
   * spin is only ever taken on a wheel opened for it, never by a paying visit.
   */
  private get nextPayment(): SpinPayment {
    if (this.freeSpinBet !== null) return { kind: 'owed' };
    const questSpinReady = this.freeSpinVisit && questFreeSpinsLeft(this.deps.ledger) > 0;
    if (questSpinReady) return { kind: 'quest', price: this.bet - WHEEL_MIN_BET };
    return { kind: 'paid', price: this.bet };
  }

  /** The next spin, or the one in play, turns on the taped board. */
  private get tapedNow(): boolean {
    const phase = this.phase;
    if (phase.kind === 'committing' || phase.kind === 'spinning' || phase.kind === 'revealing') {
      return phase.spin.taped;
    }
    const payment = this.nextPayment;
    if (payment.kind === 'owed') return this.deps.ledger.questFreeSpins.tapedChain;
    return payment.kind === 'quest';
  }

  private boardOnShow(): WheelBoard {
    const phase = this.phase;
    const inPlay =
      phase.kind === 'committing' || phase.kind === 'spinning' || phase.kind === 'revealing';
    if (inPlay) return phase.spin.board;
    const board = boardForBet(this.freeSpinBet ?? this.bet);
    return this.tapedNow ? tapedBoard(board) : board;
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
    const ledger = this.deps.ledger;
    const payment = this.nextPayment;
    const taped = this.tapedNow;
    const board = this.boardOnShow();
    const bet = this.freeSpinBet ?? this.bet;
    const price = payment.kind === 'owed' ? 0 : payment.price;
    const undo: SpinUndo = {
      humanCoins: human.coins,
      catCoins: cat.coins,
      freeSpinBet: this.freeSpinBet,
      questFreeSpinsUsed: ledger.questFreeSpins.used,
      tapedChain: ledger.questFreeSpins.tapedChain,
      prizesMarked: [],
    };
    if (price > 0 && !spendPartyCoins(human, cat, price, crawler)) return;
    this.freeSpinBet = null;
    if (payment.kind === 'quest') {
      // Spent with the commit's own save, so a reload mid-spin never gives it back.
      ledger.questFreeSpins.used++;
      ledger.questFreeSpins.tapedChain = true;
    }

    const lucky = this.deps.isLucky?.() ?? false;
    const drawOutcome = lucky ? pickLuckyOutcome : pickOutcome;
    const outcome =
      this.deps.forcedOutcome?.(board) ?? drawOutcome(board, this.wonPrizes(), this.random);
    const kind: WheelCrawler = crawler instanceof CatPlayer ? 'cat' : 'human';
    const recipientKind = wheelPrizeRecipient(outcome.wedge, kind, ledger.prizesWon);
    const spin: CommittedSpin = {
      outcome,
      board,
      crawler,
      kind,
      recipient: recipientKind === 'human' ? human : cat,
      recipientKind,
      bet: price,
      boardBet: bet,
      free: payment.kind !== 'paid',
      taped,
      landing: landingAngle(board, outcome.wedgeIndex, this.random),
    };
    const now = this.clock();
    this.phase = { kind: 'committing', spin, since: now };
    this.lastActivityAt = now;

    if (outcome.wedge.prize.kind === 'permanent_death') {
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
      this.undoCommit(human, cat, { ...undo, prizesMarked: marked });
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

  private undoCommit(human: Player, cat: Player, undo: SpinUndo): void {
    human.coins = undo.humanCoins;
    cat.coins = undo.catCoins;
    this.freeSpinBet = undo.freeSpinBet;
    const ledger = this.deps.ledger;
    ledger.questFreeSpins.used = undo.questFreeSpinsUsed;
    ledger.questFreeSpins.tapedChain = undo.tapedChain;
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
      case 'permanent_death':
        this.tickPermanentDeath(phase, now);
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
        this.deps.audio?.playRandom(TICKS, { volume: PEG_TICK_VOLUME });
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
    if (wedge.prize.kind === 'permanent_death') {
      audio?.play('wheel_land_bad');
      this.enterPermanentDeath(now);
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
    if (spin.taped && effectKind !== 'spin_again') ledger.questFreeSpins.tapedChain = false;
    void this.deps.saveNow();

    if (effectKind === 'robbed') audio?.play('wheel_robbed_coin_drain');
    if (effectKind === 'red' || effectKind === 'freeze' || effectKind === 'robbed') {
      this.chuckleAt = now + CHUCKLE_DELAY_MS;
    }
    if (effectKind === 'handies') {
      this.deps.onNotice?.('Unlimited Free Handies at Bitches or Penis Parade. Enjoy.', 'accent');
    }
    this.say(donaldTriggerFor(effectKind));

    const seat = this.seat;
    const purseAfter = seat === null ? 0 : partyCoins(seat.active(), seat.companion());
    const effect: WheelPrizeEffect = applied ?? {
      hpLost: 0,
      coinsTaken: 0,
      coinsWon: 0,
      items: [],
      rarity: null,
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
        itemRarity: effect.rarity,
        items: effect.items,
        prizeLine: prizeLine(
          wedge,
          effect,
          spin.recipientKind,
          this.deps.pets.petNames.nameOf('attackCow'),
        ),
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

  /**
   * Raises what follows the landing banner: the name prompt for a cow just
   * won, or the item prize screen. False when nothing follows.
   */
  private presentPrize(phase: Extract<WheelPhase, { kind: 'revealing' }>): boolean {
    const { reveal } = phase;
    if (reveal.effect === 'pet') {
      phase.prizeShown = true;
      this.deps.pets.nameAttackCow(() => this.finishReveal());
      return true;
    }
    if (reveal.itemRarity !== null && reveal.items.length > 0) {
      phase.prizeShown = true;
      const items = reveal.items.map(({ id, quantity }): GrantedLine => ({
        kind: 'item',
        id,
        quantity,
      }));
      const coins: GrantedLine[] =
        reveal.coinsWon > 0 ? [{ kind: 'coins', amount: reveal.coinsWon }] : [];
      this.prizes.present(
        {
          origin: { kind: 'chest', source: 'wheel' },
          rarity: reveal.itemRarity,
          title: CHEST_SOURCE_TITLES.wheel,
          subtitle: prizeDetail(reveal.items),
          crawler: phase.spin.recipientKind,
          rewards: [...coins, ...items],
        },
        () => this.finishReveal(),
      );
      return true;
    }
    return false;
  }

  private finishReveal(): void {
    const phase = this.phase;
    const chainResolved =
      phase.kind === 'revealing' && phase.spin.taped && phase.reveal.effect !== 'spin_again';
    this.phase = { kind: 'idle' };
    this.lastActivityAt = this.clock();
    // The free spin has paid out, however the wheel was entered: back to the picker rather than
    // sit ready for a paid spin no warning has guarded.
    if (chainResolved) this.closeToFloor(true);
  }

  /** Puts the prize screen away at once; the items in it are already the crawler's. */
  private dismissPrizes(): void {
    this.prizes.dismiss();
  }

  private prizeSurface(id: string): Surface {
    return this.prizes.surface(id);
  }

  private prizeTarget(crawler: Player, kind?: WheelCrawler): WheelPrizeTarget {
    const crawlerKind: WheelCrawler = kind ?? (crawler instanceof CatPlayer ? 'cat' : 'human');
    const seat = this.seat;
    return {
      crawler,
      kind: crawlerKind,
      party: seat === null ? [crawler] : [seat.active(), seat.companion()],
      grantAttackCow: this.deps.grantAttackCow,
    };
  }

  // ── Permanent Death ────────────────────────────────────────────────────────

  private enterPermanentDeath(now: number): void {
    this.phase = { kind: 'permanent_death', landedAt: now };
    this.screen = 'permanent_death';
    this.say('permanent_death');
    // Permanent Death is a void, not a corner of the club: the crowd and every
    // other world bed fall silent with the lights. Its own cues are one-shots
    // on the effects bus, so they still play over the muted ambience.
    this.deps.audio?.pauseAmbience('permanent_death');
    const firstDeath = now + PERMANENT_DEATH_LAND_PAUSE_MS;
    this.dyingBulbs = Array.from({ length: WHEEL_BULB_COUNT }, (_, index) => ({
      at:
        firstDeath +
        index * PERMANENT_DEATH_BULB_STAGGER_MS +
        this.random() * PERMANENT_DEATH_BULB_JITTER_MS,
      sounded: false,
    }));
  }

  private permanentDeathTimeline(landedAt: number): {
    bulbsOutAt: number;
    swallowAt: number;
    firstLineAt: number;
    secondLineAt: number;
    doneAt: number;
  } {
    const lastBulb = this.dyingBulbs.reduce((latest, bulb) => Math.max(latest, bulb.at), landedAt);
    const swallowAt = lastBulb + PERMANENT_DEATH_AFTER_BULBS_MS;
    const firstLineAt =
      swallowAt + PERMANENT_DEATH_SWALLOW_MS + PERMANENT_DEATH_FIRST_LINE_DELAY_MS;
    const secondLineAt = firstLineAt + PERMANENT_DEATH_SECOND_LINE_DELAY_MS;
    return {
      bulbsOutAt: lastBulb,
      swallowAt,
      firstLineAt,
      secondLineAt,
      doneAt: secondLineAt + PERMANENT_DEATH_HOLD_MS,
    };
  }

  private tickPermanentDeath(
    phase: Extract<WheelPhase, { kind: 'permanent_death' }>,
    now: number,
  ): void {
    const audio = this.deps.audio;
    for (const bulb of this.dyingBulbs) {
      if (bulb.sounded || now < bulb.at) continue;
      bulb.sounded = true;
      const pitch = 1 + (this.random() * 2 - 1) * BULB_PITCH_SWING;
      audio?.play('wheel_light_bulb_dying', { playbackRate: pitch, volume: BULB_VOLUME });
    }
    const timeline = this.permanentDeathTimeline(phase.landedAt);
    if (!this.permanentDeathSwallowSounded && now >= timeline.swallowAt) {
      this.permanentDeathSwallowSounded = true;
      audio?.play('permanent_death_swallow');
    }
    if (!this.permanentDeathToneSounded && now >= timeline.secondLineAt) {
      this.permanentDeathToneSounded = true;
      audio?.play('permanent_death_final_tone');
    }
    const wiped = this.wipe === null || this.wipe.wipeStatus === 'wiped';
    if (!this.permanentDeathFinished && now >= timeline.doneAt && wiped) {
      this.permanentDeathFinished = true;
      if (this.permanentDeathEndsInRestart) this.deps.afterPermanentDeath();
    }
  }

  private permanentDeathModel(now: number): PermanentDeathModel | null {
    const phase = this.phase;
    if (phase.kind !== 'permanent_death') return null;
    const timeline = this.permanentDeathTimeline(phase.landedAt);
    const wiped = this.wipe === null || this.wipe.wipeStatus === 'wiped';
    return {
      swallow: Math.max(0, Math.min(1, (now - timeline.swallowAt) / PERMANENT_DEATH_SWALLOW_MS)),
      firstLineAgeMs: now - timeline.firstLineAt,
      secondLineAgeMs: now - timeline.secondLineAt,
      holding: now >= timeline.doneAt && !wiped,
      signInRequired: this.wipe?.wipeStatus === 'signInRequired',
      nowMs: now,
    };
  }

  private permanentDeathSurface(id: string): Surface {
    return {
      id,
      band: 'system',
      haltsWorld: true,
      locksKeyboard: true,
      blocksEscape: true,
      isOpen: () => this.screen === 'permanent_death',
      render: (ui) => {
        const model = this.permanentDeathModel(this.clock());
        if (model !== null) paintPermanentDeath(ui, model);
      },
    };
  }

  // ── Donald ───────────────────────────────────────────────────────────────

  private get cowWords(): PetWords {
    return petWords(this.deps.pets.petNames, 'attackCow');
  }

  private say(trigger: DonaldTrigger): void {
    this.donaldLine = pickDonaldLine(trigger, this.donaldLine, this.cowWords, this.donaldRandom);
    this.donaldLineAt = this.clock();
    this.lastActivityAt = this.donaldLineAt;
  }

  /** A quip that waits its turn behind whatever Donald just said. */
  private quip(trigger: DonaldTrigger): void {
    if (this.clock() - this.donaldLineAt < DONALD_QUIP_GAP_MS) return;
    this.say(trigger);
  }

  private donaldPose(now: number): { pose: DonaldBustPose; progress: number } {
    const phase = this.phase;
    if (phase.kind === 'revealing') {
      const elapsed = now - phase.startedAt;
      const red = isRedWedge(phase.reveal.wedge);
      return red
        ? { pose: 'chuckle', progress: (elapsed % CHUCKLE_CYCLE_MS) / CHUCKLE_CYCLE_MS }
        : { pose: 'grin', progress: 1 };
    }
    if (phase.kind === 'permanent_death') return { pose: 'grin', progress: 1 };
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
    if (this.phase.kind !== 'permanent_death') return 0;
    return this.dyingBulbs.filter((bulb) => now >= bulb.at).length;
  }

  private viewModel(seat: CasinoSeat, now: number): WheelViewModel {
    const phase = this.phase;
    const payment = this.nextPayment;
    const board = this.boardOnShow();
    const flip = this.flip;
    const blocked = this.spinBlocked(seat);
    const reveal =
      phase.kind === 'revealing' ? { ...phase.reveal, elapsedMs: now - phase.startedAt } : null;
    const donald = this.donaldPose(now);
    const lineAge = now - this.donaldLineAt;
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
      bulbsSteady: phase.kind === 'permanent_death',
      bet: this.freeSpinBet ?? this.bet,
      purse: partyCoins(seat.active(), seat.companion()),
      betDown: betLocked ?? (this.bet <= WHEEL_MIN_BET ? 'Already at the minimum bet' : null),
      betUp: betLocked ?? (this.bet >= WHEEL_MAX_BET ? 'Already at the maximum bet' : null),
      spin: {
        free: payment.kind !== 'paid',
        upgradePrice: payment.kind === 'quest' ? payment.price : 0,
        hold: this.holdProgress(now),
        heldByPointer: this.hold !== null && !this.hold.byKey,
        disabled: blocked,
      },
      leaveDisabled: this.busy ? 'Not while the wheel is turning' : null,
      donald: {
        pose: donald.pose,
        progress: donald.progress,
        line: lineAge < DONALD_LINE_MS ? this.donaldLine : null,
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
