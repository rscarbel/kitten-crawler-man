/**
 * The Desperado Club's slot machine — the host over {@link SlotMachine}.
 *
 * It owns everything with money or a clock in it that the engine leaves to
 * its host: taking each bet from the party's purse, paying wins with
 * blackjack's split (the returned stake straight back to the purse, the
 * profit through `earnCoins` so it counts as income), storing the
 * progressive pool on the club membership, running autospin and the
 * free-spin feature, deciding when each reel stops and when a celebration is
 * over, and every sound and music cue. The reels and the celebration are
 * animated by {@link SlotsMotion} and painted by {@link SlotsView}.
 *
 * Leaving never forfeits a win: a spin in flight is settled on the way out,
 * and leaving mid-feature plays the remaining free spins out in turbo, on
 * screen, before the machine closes.
 */

import type { Player } from '../Player';
import type { AudioManager } from '../audio/AudioManager';
import { CASINO_MUSIC_TRACKS, SLOTS_FREE_SPINS_MUSIC_TRACKS, type SoundId } from '../audio/sounds';
import type { ClubMembership } from '../core/ClubMembership';
import { NEVER_LUCKY, type LuckCheck } from '../core/GodMode';
import { keybindings } from '../core/Keybindings';
import { canAffordCoins, partyCoins, spendPartyCoins } from '../core/partyCoins';
import { ACTIVATE_KEYS, type Surface } from '../ui/core/UiRoot';
import { computeSlotsLayout, type SlotsLayout } from '../ui/casino/slots/slotsLayout';
import { SlotsMotion, type MotionBeat } from '../ui/casino/slots/slotsMotion';
import {
  AUTOSPIN_CHOICES,
  SlotsView,
  type SlotsViewActions,
  type SlotsViewModel,
  type SpinSource,
} from '../ui/casino/slots/SlotsView';
import { SlotsRules } from '../ui/screens/dialogs/SlotsRules';
import type { CasinoGameHost } from './casino/CasinoGameHost';
import type { CasinoSeat } from './ClubCasinoSystem';
import { type ForcedOutcome } from './casino/slots/forcedOutcomes';
import { SlotMachine, type SlotEvent } from './casino/slots/SlotMachine';
import {
  MAX_BET_PER_LINE,
  MIN_BET_PER_LINE,
  jackpotPayableCoins,
  normalizeJackpotPool,
  stepBet,
  totalBetFor,
  type BetPerLine,
} from './casino/slots/slotBets';
import { REEL_STRIPS, randomStops } from './casino/slots/slotReels';
import {
  CROWD_CHEER_SOUNDS,
  SLOTS_LOOPS,
  paylineTraceSound,
  scatterLandSound,
  slotsCueSound,
  type SlotsCue,
  type SlotsLoop,
} from './casino/slots/slotsSoundCues';

export const SLOTS_SURFACE_ID = 'club-slots';
export const SLOTS_RULES_SURFACE_ID = 'slots-rules';

/** The audio the machine reaches for; a fake records cues in a harness. */
export type SlotsAudio = Pick<
  AudioManager,
  | 'play'
  | 'stopSound'
  | 'fadeOutSound'
  | 'startAmbientLoop'
  | 'stopAmbientLoop'
  | 'isAmbientLoopRunning'
  | 'duckMusic'
  | 'unduckMusic'
  | 'pauseMusic'
  | 'resumeMusic'
  | 'stopMusic'
  | 'playMusicPlaylist'
>;

/** What the machine keeps on the club membership between visits. */
export type SlotsSettings = Pick<ClubMembership, 'slotsJackpotPool' | 'slotsTurbo'>;

export interface ClubSlotsOptions {
  /** Seeds the reels, for the preview and gates. */
  readonly seed?: number;
  /** Feeds the coin shower's scatter; separate from the reels so effects never change a spin. */
  readonly effectsRandom?: () => number;
}

/** The jazz under the machine sits at this share of the player's music volume. */
const SLOTS_MUSIC_SHARE_DIVISOR = 3;
export const SLOTS_MUSIC_LEVEL = 1 / SLOTS_MUSIC_SHARE_DIVISOR;
const SLOTS_MUSIC_RAMP_MS = 500;
/** BIG WIN and above take the jazz almost to silence, and give it back over this long. */
const BIG_WIN_MUSIC_FADE_MS = 250;
const BIG_WIN_MUSIC_RETURN_MS = 1500;
const FREE_SPINS_MUSIC_SWAP_MS = 600;
/** The jackpot siren runs about fifteen seconds; a skip cuts it on this fade. */
const JACKPOT_SIREN_FADE_MS = 400;
const JACKPOT_SIREN_VOLUME = 0.9;
/** Each reel's thunk is pitched a little higher than the last, left to right. */
const REEL_STOP_PITCH_STEP = 0.045;
const REEL_STOP_BASE_PITCH = 0.94;
const LOOP_VOLUME: Readonly<Record<SlotsLoop, number>> = {
  reels: 0.55,
  rollup: 0.6,
  hopper: 0.7,
};
/** Rests between spins the machine plays itself. */
const AUTOSPIN_GAP_MS = 450;
const FREE_SPIN_GAP_MS = 700;
const LEAVING_GAP_MS = 120;
/** The idle machine's chime, no oftener than this. */
const ATTRACT_CHIME_MS = 24000;
/** Frames longer than this are a tab-away, not a slow frame; the clock refuses to jump. */
const MAX_FRAME_MS = 100;
const CREDIT_TICKER_RATE = 0.16;
const CREDIT_TICKER_SNAP = 1;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const HALF = 0.5;

const NOT_ENOUGH_COINS = 'Not enough coins';

function prefersReducedMotion(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export class ClubSlotsSystem implements CasinoGameHost {
  readonly machine: SlotMachine;
  readonly motion: SlotsMotion;
  private readonly view = new SlotsView();
  private readonly rules = new SlotsRules(() => this.betPerLine);
  private readonly reducedMotion = prefersReducedMotion();

  private isOpen = false;
  private seat: CasinoSeat | null = null;
  betPerLine: BetPerLine = MIN_BET_PER_LINE;
  private autoRemaining: number | null = null;
  private autoMenuOpen = false;
  /** Leaving was asked for mid-feature: the rest of the free spins play out in turbo first. */
  private leaving = false;
  private nextSpinAt: number | null = null;

  private wagered = 0;
  private sessionWinnings = 0;
  /** The stake the spin being revealed was paid with; zero for a free spin. */
  private inFlightStake = 0;
  private displayedCredits = 0;
  /** The last settled win, shown in the WIN readout until the next spin. */
  private lastWin: number | null = null;

  private animClock = 0;
  private lastFrameStamp: number | null = null;
  private lastChimeAt = 0;
  private bigWinMusicPaused = false;
  private freeSpinsMusic = false;
  private readonly wantedLoops = new Set<SlotsLoop>();
  /** Sounds held back until their reel is seen to strike its stop. */
  private readonly cuesOnThunk = new Map<number, Array<() => void>>();
  private lastLayout: SlotsLayout | null = null;
  private lastUiScale = 1;
  private keyboardOnAControl = false;

  /**
   * Fired once, as the machine closes, with the session's profit and where
   * the credits readout sat on screen in canvas CSS pixels; the club flies it
   * to the HUD the way the card tables do.
   */
  onWinnings: ((coins: number, screenX: number, screenY: number) => void) | null = null;

  /** Read as each spin starts: while it answers true, every spin pays. */
  isLucky: LuckCheck = NEVER_LUCKY;

  constructor(
    private readonly audio: SlotsAudio | null,
    private readonly settings: SlotsSettings,
    private readonly clock: () => number = () => performance.now(),
    options: ClubSlotsOptions = {},
  ) {
    const isLucky = (): boolean => this.isLucky();
    this.machine = new SlotMachine(
      options.seed === undefined ? { isLucky } : { seed: options.seed, isLucky },
    );
    this.motion = new SlotsMotion(
      REEL_STRIPS.map((strip) => strip.length),
      options.effectsRandom ?? Math.random,
    );
    this.settings.slotsJackpotPool = normalizeJackpotPool(this.settings.slotsJackpotPool);
    this.motion.restOn(randomStops(this.machine.strips, options.effectsRandom ?? Math.random));
  }

  // ── CasinoGameHost ─────────────────────────────────────────────────────

  get anySurfaceOpen(): boolean {
    return this.isOpen;
  }

  get coinsWageredThisVisit(): number {
    return this.wagered;
  }

  get rulesOpen(): boolean {
    return this.rules.isOpen;
  }

  get turbo(): boolean {
    return this.settings.slotsTurbo;
  }

  get jackpotPool(): number {
    return this.settings.slotsJackpotPool;
  }

  get sessionProfit(): number {
    return this.sessionWinnings;
  }

  open(seat: CasinoSeat): void {
    this.seat = seat;
    this.isOpen = true;
    this.leaving = false;
    this.autoRemaining = null;
    this.autoMenuOpen = false;
    this.nextSpinAt = null;
    this.sessionWinnings = 0;
    this.lastWin = null;
    this.lastFrameStamp = null;
    this.displayedCredits = partyCoins(seat.active(), seat.companion());
    this.machine.drainEvents();
    this.motion.touch();
    this.lastChimeAt = this.motion.time;
    this.audio?.duckMusic('slots', SLOTS_MUSIC_LEVEL, SLOTS_MUSIC_RAMP_MS);
  }

  update(): void {
    const dtMs = this.tickClock();
    if (!this.isOpen) return;
    this.motion.setPace({
      turbo: this.settings.slotsTurbo || this.leaving,
      reducedMotion: this.reducedMotion,
    });
    this.motion.advance(dtMs);
    this.stopDueReels();
    this.startCelebrationWhenSettled();
    if (this.motion.celebrationDue) this.finishCelebration();
    for (const beat of this.motion.drainBeats()) this.onBeat(beat);
    this.playMachineSelf();
    this.tickCredits();
    this.maybeChime();
    this.reconcileLoops();
  }

  surfaces(seat: CasinoSeat): Surface[] {
    return [this.machineSurface(SLOTS_SURFACE_ID, seat), this.rulesSurface(SLOTS_RULES_SURFACE_ID)];
  }

  /** The scene is being torn down: settle everything owed and shut at once. */
  forceClose(): void {
    if (!this.isOpen) return;
    this.settleEverything();
    this.closeNow();
  }

  // ── Clock ──────────────────────────────────────────────────────────────

  private tickClock(): number {
    const now = this.clock();
    const previous = this.lastFrameStamp;
    this.lastFrameStamp = now;
    if (previous === null) return 0;
    const dtMs = Math.max(0, Math.min(MAX_FRAME_MS, now - previous));
    this.animClock += dtMs;
    return dtMs;
  }

  private tickCredits(): void {
    const seat = this.seat;
    if (seat === null) return;
    const total = partyCoins(seat.active(), seat.companion());
    const gap = total - this.displayedCredits;
    if (Math.abs(gap) <= CREDIT_TICKER_SNAP || gap < 0) {
      this.displayedCredits = total;
      return;
    }
    this.displayedCredits += gap * CREDIT_TICKER_RATE;
  }

  private maybeChime(): void {
    if (!this.motion.attracting) {
      this.lastChimeAt = this.motion.time;
      return;
    }
    if (this.motion.time - this.lastChimeAt < ATTRACT_CHIME_MS) return;
    this.lastChimeAt = this.motion.time;
    this.cue('attract_chime');
  }

  // ── Spinning ───────────────────────────────────────────────────────────

  private get atRest(): boolean {
    return this.machine.atRest && !this.motion.reelsMoving && this.motion.celebration === null;
  }

  /** Why SPIN cannot start a spin right now, or true when it can. */
  private spinAvailability(): true | string {
    const seat = this.seat;
    if (seat === null) return NOT_ENOUGH_COINS;
    if (this.machine.freeSpins !== null) return true;
    if (!this.atRest) return true;
    const totalBet = totalBetFor(this.betPerLine);
    return canAffordCoins(seat.active(), seat.companion(), totalBet) ? true : NOT_ENOUGH_COINS;
  }

  /** Starts a spin if the machine is at rest and the party can cover it. Returns whether it did. */
  spin(): boolean {
    const seat = this.seat;
    if (seat === null || !this.atRest) return false;
    const active = seat.active();
    const companion = seat.companion();
    const free = this.machine.freeSpins !== null;
    if (!free && !canAffordCoins(active, companion, totalBetFor(this.betPerLine))) return false;
    const start = this.machine.spin({
      betPerLine: this.betPerLine,
      jackpotPool: this.settings.slotsJackpotPool,
    });
    if (start.kind === 'refused') return false;
    this.settings.slotsJackpotPool = start.jackpotPool;
    if (start.charged > 0) {
      spendPartyCoins(active, companion, start.charged, active);
      this.wagered += start.charged;
    }
    this.inFlightStake = start.charged;
    this.lastWin = null;
    this.nextSpinAt = null;
    this.drainMachine();
    return true;
  }

  private spinPressed(source: SpinSource): void {
    if (this.motion.celebration !== null) {
      this.skip();
      return;
    }
    if (this.motion.reelsMoving) {
      this.motion.slam();
      return;
    }
    if (this.autoRemaining !== null && source !== 'lever') {
      this.autoRemaining = null;
      return;
    }
    if (source === 'key' && this.spinAvailability() === true) this.cue('spin_button');
    this.spin();
  }

  private stopDueReels(): void {
    let due = this.motion.dueReel();
    while (due !== null) {
      if (this.machine.stopReel() === null) break;
      this.drainMachine();
      due = this.motion.dueReel();
    }
  }

  private startCelebrationWhenSettled(): void {
    if (this.machine.phase !== 'celebrating' || this.motion.reelsMoving) return;
    if (this.motion.celebration !== null) return;
    const outcome = this.machine.outcome;
    if (outcome !== null) this.motion.celebrate(outcome);
  }

  /** A tap, click or Space while something plays: skip the rollup, then the rest. */
  skip(): void {
    if (this.motion.celebration === null) {
      if (this.motion.reelsMoving) this.motion.slam();
      return;
    }
    const over = this.motion.skip();
    this.wantedLoops.delete('rollup');
    this.wantedLoops.delete('hopper');
    this.audio?.fadeOutSound('slots_jackpot_siren', JACKPOT_SIREN_FADE_MS);
    this.releaseBigWinMusic();
    if (over) this.finishCelebration();
  }

  private finishCelebration(): void {
    if (this.machine.phase === 'celebrating') this.machine.finishCelebration();
    this.drainMachine();
    this.motion.endCelebration();
    for (const beat of this.motion.drainBeats()) this.onBeat(beat);
    this.wantedLoops.delete('rollup');
    this.wantedLoops.delete('hopper');
    this.audio?.fadeOutSound('slots_jackpot_siren', JACKPOT_SIREN_FADE_MS);
    this.releaseBigWinMusic();
  }

  /** The machine playing itself: free spins, autospin, and a feature played out on the way out. */
  private playMachineSelf(): void {
    if (!this.atRest) return;
    const featureRunning = this.machine.freeSpins !== null;
    if (this.leaving && !featureRunning) {
      this.closeNow();
      return;
    }
    const wantsSpin = featureRunning || (this.autoRemaining !== null && this.autoRemaining > 0);
    if (!wantsSpin) {
      if (this.autoRemaining !== null && this.autoRemaining <= 0) this.autoRemaining = null;
      return;
    }
    const gap = this.leaving ? LEAVING_GAP_MS : featureRunning ? FREE_SPIN_GAP_MS : AUTOSPIN_GAP_MS;
    if (this.nextSpinAt === null) {
      this.nextSpinAt = this.motion.time + gap;
      return;
    }
    if (this.motion.time < this.nextSpinAt) return;
    this.nextSpinAt = null;
    if (!featureRunning && this.autoRemaining !== null) {
      if (this.spinAvailability() !== true) {
        this.autoRemaining = null;
        return;
      }
      this.autoRemaining--;
    }
    if (!this.spin() && !featureRunning) this.autoRemaining = null;
  }

  // ── Events ─────────────────────────────────────────────────────────────

  private drainMachine(): void {
    for (const event of this.machine.drainEvents()) this.onEvent(event, true);
  }

  private onThunk(reel: number, play: () => void): void {
    const list = this.cuesOnThunk.get(reel) ?? [];
    list.push(play);
    this.cuesOnThunk.set(reel, list);
  }

  private onEvent(event: SlotEvent, live: boolean): void {
    switch (event.kind) {
      case 'bet_placed':
        this.inFlightStake = event.totalBet;
        return;
      case 'free_spin_started':
        this.inFlightStake = 0;
        return;
      case 'spin_started':
        if (event.free) this.inFlightStake = 0;
        if (!live) return;
        this.cuesOnThunk.clear();
        this.motion.startSpin(event.anticipationReels);
        this.wantedLoops.add('reels');
        return;
      case 'reel_stopped': {
        if (!live) return;
        this.motion.landReel(event.reel, event.stop);
        const reel = event.reel;
        const last = event.last;
        this.onThunk(reel, () => {
          this.cue('reel_stop', {
            playbackRate: REEL_STOP_BASE_PITCH + reel * REEL_STOP_PITCH_STEP,
          });
          this.audio?.fadeOutSound('slots_anticipation_riser', SLOTS_MUSIC_RAMP_MS * HALF);
          if (last) this.wantedLoops.delete('reels');
        });
        return;
      }
      case 'scatter_landed': {
        if (!live) return;
        const { reel, row, ordinal } = event;
        this.onThunk(reel, () => {
          this.motion.scatterLanded(reel, row);
          this.play(scatterLandSound(ordinal));
          if (ordinal === SCATTER_TRIGGER_ORDINAL) this.cue('free_spins_trigger');
        });
        return;
      }
      case 'anticipation_started': {
        if (!live) return;
        const reel = event.reel;
        this.motion.startAnticipation(reel);
        this.onThunk(reel - 1, () => this.cue('anticipation_riser'));
        return;
      }
      case 'near_miss': {
        if (!live) return;
        const reel = event.miss.reel;
        this.onThunk(reel, () => {
          this.motion.nearMiss(reel);
          this.cue('near_miss');
        });
        return;
      }
      case 'spin_settled':
        return;
      case 'jackpot_won':
        this.settings.slotsJackpotPool = event.poolAfter;
        return;
      case 'win_paid':
        this.pay(event.amount);
        if (live) this.lastWin = event.amount;
        if (live && this.autoRemaining !== null && event.tier !== 'none') this.autoRemaining = null;
        return;
      case 'free_spins_awarded':
        this.autoRemaining = null;
        if (live && !event.retrigger) this.swapMusic(true);
        return;
      case 'free_spins_ended':
        if (live) this.swapMusic(false);
        return;
    }
  }

  private onBeat(beat: MotionBeat): void {
    switch (beat.kind) {
      case 'reel_thunk': {
        const cues = this.cuesOnThunk.get(beat.reel) ?? [];
        this.cuesOnThunk.delete(beat.reel);
        for (const play of cues) play();
        return;
      }
      case 'trace':
        this.play(paylineTraceSound(beat.index));
        return;
      case 'small_win':
        this.cue('line_win_small');
        return;
      case 'banner':
        this.onBanner(beat.tier);
        return;
      case 'rollup_started':
        this.wantedLoops.add('rollup');
        return;
      case 'rollup_landed':
        this.wantedLoops.delete('rollup');
        return;
      case 'shower_started':
        this.wantedLoops.add('hopper');
        return;
      case 'shower_ended':
        this.wantedLoops.delete('hopper');
        return;
      case 'free_spins_banner':
        return;
    }
  }

  private onBanner(tier: 'big' | 'mega' | 'epic' | 'jackpot'): void {
    this.audio?.pauseMusic('slots_big_win', BIG_WIN_MUSIC_FADE_MS);
    this.bigWinMusicPaused = true;
    if (tier === 'jackpot') {
      this.audio?.play('slots_jackpot_siren', { volume: JACKPOT_SIREN_VOLUME });
    } else {
      this.cue(TIER_CUES[tier]);
    }
    if (tier !== 'big')
      this.audio?.play(
        CROWD_CHEER_SOUNDS[Math.floor(Math.random() * CROWD_CHEER_SOUNDS.length)] ??
          CROWD_CHEER_SOUNDS[0],
      );
  }

  private releaseBigWinMusic(): void {
    if (!this.bigWinMusicPaused) return;
    this.bigWinMusicPaused = false;
    this.audio?.resumeMusic('slots_big_win', BIG_WIN_MUSIC_RETURN_MS);
  }

  private swapMusic(freeSpins: boolean): void {
    if (this.freeSpinsMusic === freeSpins) return;
    this.freeSpinsMusic = freeSpins;
    this.audio?.stopMusic(FREE_SPINS_MUSIC_SWAP_MS);
    this.audio?.playMusicPlaylist(freeSpins ? SLOTS_FREE_SPINS_MUSIC_TRACKS : CASINO_MUSIC_TRACKS, {
      fadeInMs: FREE_SPINS_MUSIC_SWAP_MS,
    });
  }

  /** Blackjack's split: the stake back to the purse untouched, only the profit counted as income. */
  private pay(amount: number): void {
    const seat = this.seat;
    if (seat === null || amount <= 0) return;
    const active: Player = seat.active();
    const stakeBack = Math.min(amount, this.inFlightStake);
    const profit = amount - stakeBack;
    active.coins += stakeBack;
    active.earnCoins(profit);
    this.sessionWinnings += profit;
  }

  // ── Sound ──────────────────────────────────────────────────────────────

  private play(id: SoundId, opts?: { playbackRate?: number }): void {
    this.audio?.play(id, opts);
  }

  private cue(cue: SlotsCue, opts?: { playbackRate?: number }): void {
    const id = slotsCueSound(cue);
    if (id !== null) this.play(id, opts);
  }

  private reconcileLoops(): void {
    const audio = this.audio;
    if (audio === null) return;
    for (const loop of LOOP_NAMES) {
      const id = SLOTS_LOOPS[loop];
      const wanted = this.isOpen && this.wantedLoops.has(loop);
      const running = audio.isAmbientLoopRunning(id);
      if (wanted && !running) audio.startAmbientLoop(id, LOOP_VOLUME[loop]);
      else if (!wanted && running) audio.stopAmbientLoop(id);
    }
  }

  // ── Bet and toggles ────────────────────────────────────────────────────

  private get betLocked(): boolean {
    return (
      !this.atRest || this.machine.freeSpins !== null || this.autoRemaining !== null || this.leaving
    );
  }

  changeBet(steps: number): void {
    if (this.betLocked) return;
    this.betPerLine = stepBet(this.betPerLine, steps);
  }

  private maxBet(): void {
    if (this.betLocked) return;
    this.betPerLine = MAX_BET_PER_LINE;
  }

  toggleTurbo(): void {
    this.settings.slotsTurbo = !this.settings.slotsTurbo;
  }

  startAutospin(spins: number): void {
    this.autoMenuOpen = false;
    if (this.machine.freeSpins !== null || this.leaving) return;
    this.autoRemaining = spins;
    this.nextSpinAt = null;
  }

  private autoPressed(): void {
    if (this.autoRemaining !== null) {
      this.autoRemaining = null;
      return;
    }
    this.autoMenuOpen = !this.autoMenuOpen;
  }

  /** Lands the next spin on a chosen kind of outcome, for the preview. */
  forceNext(kind: ForcedOutcome): boolean {
    return this.machine.forceNext(kind, this.betPerLine, this.settings.slotsJackpotPool);
  }

  openRules(page = 0): void {
    this.rules.show(page);
  }

  dismissRules(): void {
    this.rules.dismiss();
  }

  // ── Leaving ────────────────────────────────────────────────────────────

  /**
   * Leave, Escape or the attack key. At rest the machine closes. Mid-feature
   * the remaining free spins play out in turbo first, and asking again
   * settles them at once. A plain spin in flight is settled on the way out.
   */
  requestLeave(): void {
    if (!this.isOpen) return;
    this.autoRemaining = null;
    this.autoMenuOpen = false;
    if (this.atRest && this.machine.freeSpins === null) {
      this.closeNow();
      return;
    }
    const featureOwed = this.machine.freeSpins !== null || this.awardsFreeSpins();
    if (featureOwed && !this.leaving) {
      this.leaving = true;
      if (this.motion.celebration !== null) this.skip();
      else this.motion.slam();
      return;
    }
    this.settleEverything();
    this.closeNow();
  }

  private awardsFreeSpins(): boolean {
    const outcome = this.machine.outcome;
    return (
      this.machine.phase !== 'idle' && outcome !== null && outcome.scatter.freeSpinsAwarded > 0
    );
  }

  /** Pays out the spin in flight and every free spin still owed, instantly. */
  private settleEverything(): void {
    if (this.machine.phase !== 'idle' || this.machine.freeSpins !== null) {
      this.drainMachine();
      this.settings.slotsJackpotPool = this.machine.settleAll(this.settings.slotsJackpotPool);
      for (const event of this.machine.drainEvents()) this.onEvent(event, false);
    }
    const grid = this.machine.outcome;
    if (grid !== null) this.motion.restOn(grid.stops);
    this.motion.endCelebration();
    this.motion.drainBeats();
  }

  private closeNow(): void {
    this.isOpen = false;
    this.leaving = false;
    this.autoRemaining = null;
    this.autoMenuOpen = false;
    this.rules.dismiss();
    this.wantedLoops.clear();
    this.cuesOnThunk.clear();
    this.reconcileLoops();
    this.audio?.fadeOutSound('slots_jackpot_siren', JACKPOT_SIREN_FADE_MS);
    this.audio?.fadeOutSound('slots_anticipation_riser', JACKPOT_SIREN_FADE_MS);
    this.releaseBigWinMusic();
    if (this.freeSpinsMusic) this.swapMusic(false);
    this.audio?.unduckMusic('slots', SLOTS_MUSIC_RAMP_MS);
    this.flySessionWinnings();
  }

  private flySessionWinnings(): void {
    const winnings = this.sessionWinnings;
    this.sessionWinnings = 0;
    if (winnings <= 0) return;
    const anchor = this.view.creditsAnchor ?? { x: 0, y: 0 };
    this.onWinnings?.(winnings, anchor.x * this.lastUiScale, anchor.y * this.lastUiScale);
  }

  // ── Surfaces ───────────────────────────────────────────────────────────

  private viewModel(): SlotsViewModel {
    const free = this.machine.freeSpins;
    const celebration = this.motion.celebration;
    const canSpin = this.leaving ? 'Leaving…' : this.spinAvailability();
    const win = celebration !== null ? this.motion.rollupValue : this.lastWin;
    return {
      strips: this.machine.strips,
      credits: this.displayedCredits,
      betPerLine: free?.betPerLine ?? this.betPerLine,
      totalBet: totalBetFor(free?.betPerLine ?? this.betPerLine),
      win,
      jackpotCoins: jackpotPayableCoins(this.settings.slotsJackpotPool),
      jackpotHot: celebration?.outcome.jackpot.won === true,
      freeSpins:
        free === null
          ? null
          : { remaining: free.remaining, played: free.played, totalWon: free.totalWon },
      autoRemaining: this.autoRemaining,
      autoMenuOpen: this.autoMenuOpen,
      turbo: this.settings.slotsTurbo,
      canSpin,
      canBetDown: !this.betLocked && this.betPerLine !== MIN_BET_PER_LINE,
      canBetUp: !this.betLocked && this.betPerLine !== MAX_BET_PER_LINE,
      canMaxBet: !this.betLocked && this.betPerLine !== MAX_BET_PER_LINE,
      betLocked: this.betLocked,
      spinLabel: this.spinLabel(),
      leaving: this.leaving,
      keyHints: false,
    };
  }

  private spinLabel(): string {
    if (this.motion.celebration !== null) return 'SKIP';
    if (this.motion.reelsMoving) return 'STOP';
    if (this.machine.freeSpins !== null) return 'FREE';
    if (this.autoRemaining !== null) return 'AUTO';
    return 'SPIN';
  }

  private readonly actions: SlotsViewActions = {
    spinPressed: (source) => this.spinPressed(source),
    betDown: () => this.changeBet(-1),
    betUp: () => this.changeBet(1),
    maxBet: () => this.maxBet(),
    toggleTurbo: () => this.toggleTurbo(),
    autoPressed: () => this.autoPressed(),
    chooseAuto: (spins) => this.startAutospin(spins),
    closeAutoMenu: () => {
      this.autoMenuOpen = false;
    },
    rules: () => this.openRules(),
    leave: () => this.requestLeave(),
    tapMachine: () => this.skip(),
  };

  /**
   * The machine: modal and halting. Space and Enter spin (and skip or slam
   * while something plays), the arrows step the bet, Escape and the attack
   * key leave, unless the keyboard has walked focus onto a control, which then
   * takes the accept keys and arrows as any focused control would.
   */
  machineSurface(id: string, seat: CasinoSeat): Surface {
    return {
      id,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      isOpen: () => this.isOpen,
      render: (ui) => {
        this.seat = seat;
        const layout = computeSlotsLayout({
          viewport: ui.viewport,
          screen: ui.screen,
          uiScale: ui.uiScale,
          controlHeight: ui.theme.size.control,
        });
        this.lastLayout = layout;
        this.lastUiScale = ui.uiScale;
        const model = { ...this.viewModel(), keyHints: ui.density === 'pointer' };
        this.keyboardOnAControl = this.view.paint(ui, layout, model, this.motion, this.actions);
      },
      close: () => this.requestLeave(),
      onKey: (key, mods) => this.onKey(key, mods.repeat === true || mods.predatesSurface === true),
    };
  }

  private onKey(key: string, stale: boolean): boolean {
    const focusTakesIt =
      this.keyboardOnAControl && (ACTIVATE_KEYS.has(key) || key.startsWith('Arrow'));
    if (focusTakesIt) return false;
    if (ACTIVATE_KEYS.has(key)) {
      if (!stale) this.spinPressed('key');
      return true;
    }
    if (key === 'ArrowUp' || key === 'ArrowRight') {
      if (!this.betLocked && this.betPerLine !== MAX_BET_PER_LINE) this.cue('bet_up');
      this.changeBet(1);
      return true;
    }
    if (key === 'ArrowDown' || key === 'ArrowLeft') {
      if (!this.betLocked && this.betPerLine !== MIN_BET_PER_LINE) this.cue('bet_down');
      this.changeBet(-1);
      return true;
    }
    // The accept keys spin, so an attack key left on Space spins too; one
    // rebound elsewhere leaves, as it does at the card tables.
    if (keybindings.actionFor(key) === 'attack') {
      if (!stale) this.requestLeave();
      return true;
    }
    return false;
  }

  rulesSurface(id: string): Surface {
    return this.rules.surface(id);
  }

  /** Where the machine was last drawn, for harnesses that aim at its controls. */
  get layout(): SlotsLayout | null {
    return this.lastLayout;
  }

  /** The current time on the machine's own animation clock. */
  get animationTime(): number {
    return this.animClock;
  }
}

const SCATTER_TRIGGER_ORDINAL = 3;

const LOOP_NAMES: ReadonlyArray<SlotsLoop> = ['reels', 'rollup', 'hopper'];

const TIER_CUES: Readonly<Record<'big' | 'mega' | 'epic', SlotsCue>> = {
  big: 'big_win',
  mega: 'mega_win',
  epic: 'epic_win',
};

export { AUTOSPIN_CHOICES };
