/**
 * Every animation the slot machine plays, on its own clock and without a
 * canvas: the reels' launch, spin, anticipation slow-down and bounce-back
 * landing; the celebration's payline traces, credit rollup, tier banner,
 * screen shake, coin shower and jackpot flash; the near-miss shimmer, the
 * scatter pops and the idle attract pattern.
 *
 * It never touches money or the machine. The host asks it which reel is due
 * to stop and when a celebration is over, and drains the beats it raises
 * (a reel striking its stop, a payline being traced, a banner slamming in)
 * to play their sounds at the moment they are seen.
 */

import { listAt } from '../../../systems/casino/poker/npc/listAt';
import type { SpinOutcome } from '../../../systems/casino/slots/evaluateSpin';
import type { WinTier } from '../../../systems/casino/slots/slotBets';
import { PAYLINES } from '../../../systems/casino/slots/slotPaylines';
import {
  REEL_COUNT,
  ROW_COUNT,
  wrapStop,
  type GridCell,
} from '../../../systems/casino/slots/slotReels';

export type ReelPhase = 'rest' | 'kick' | 'spin' | 'landing';

/** One reel's motion. `position` is the strip index at the top row; it falls while the reel scrolls down. */
export interface ReelMotion {
  phase: ReelPhase;
  position: number;
  /** Symbols per second, downward. */
  speed: number;
  targetSpeed: number;
  phaseAt: number;
  kickFrom: number;
  landFrom: number;
  landTo: number;
  landed: boolean;
  thunked: boolean;
  stopDueAt: number;
  anticipating: boolean;
  anticipationAt: number;
  nearMissAt: number | null;
}

/** Something the player should hear at the moment it is seen. */
export type MotionBeat =
  | { readonly kind: 'reel_thunk'; readonly reel: number }
  | { readonly kind: 'trace'; readonly index: number }
  | { readonly kind: 'small_win' }
  | { readonly kind: 'banner'; readonly tier: Exclude<WinTier, 'none'> }
  | { readonly kind: 'rollup_started' }
  | { readonly kind: 'rollup_landed' }
  | { readonly kind: 'shower_started' }
  | { readonly kind: 'shower_ended' }
  | { readonly kind: 'free_spins_banner' };

/** One traced line of a win: a payline's cells, or the scatters anywhere on the glass. */
export interface WinTrace {
  readonly lineIndex: number | null;
  readonly cells: ReadonlyArray<GridCell>;
  readonly amount: number;
}

export interface Celebration {
  readonly outcome: SpinOutcome;
  readonly tier: WinTier;
  readonly traces: ReadonlyArray<WinTrace>;
  readonly startedAt: number;
  readonly traceMs: number;
  rollupEndsAt: number;
  readonly rollupMs: number;
  endsAt: number;
  bannerAt: number | null;
  readonly freeSpinsAt: number | null;
  showerEndsAt: number;
  skipped: boolean;
  /** Every beat on the timeline is raised once; these mark which have been. */
  tracesRaised: number;
  bannerRaised: boolean;
  rollupStartedRaised: boolean;
  rollupLandedRaised: boolean;
  showerStartedRaised: boolean;
  showerEndedRaised: boolean;
  freeSpinsRaised: boolean;
}

/** A coin or spark, in fractions of the cabinet's width and height so a resize carries it along. */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  bornAt: number;
  readonly life: number;
  readonly spark: boolean;
}

export interface MotionPace {
  readonly turbo: boolean;
  readonly reducedMotion: boolean;
}

// ── Reels ────────────────────────────────────────────────────────────────

const SPIN_SPEED = 18;
const TURBO_SPIN_SPEED = 26;
const ANTICIPATION_SPEED = 6.5;
/** How fast a reel's speed closes on its target, per second: the anticipation slow-down's feel. */
const SPEED_EASE_RATE = 5;
const KICK_MS = 150;
/** The upward nudge each reel gives before it falls, in symbols. */
const KICK_SYMBOLS = 0.24;
const SPINUP_MS = 200;
const LAUNCH_STAGGER_MS = 85;
const TURBO_LAUNCH_STAGGER_MS = 30;
const FIRST_STOP_MS = 950;
const TURBO_FIRST_STOP_MS = 380;
const STOP_GAP_MS = 250;
const TURBO_STOP_GAP_MS = 95;
const ANTICIPATION_EXTRA_MS = 1600;
const TURBO_ANTICIPATION_EXTRA_MS = 700;
const LAND_MS = 400;
const TURBO_LAND_MS = 240;
/** Stops after a slam tap come this far apart, so they still read left to right. */
const SLAM_GAP_MS = 70;
/** Overshoot of the bounce-back landing (the "back" ease's constant). */
const LAND_OVERSHOOT = 1.25;
const LAND_OVERSHOOT_CUBE = LAND_OVERSHOOT + 1;
const CUBE = 3;
/** The back ease's slope at its start, which sets how far a reel travels to land at speed. */
const LAND_START_SLOPE = CUBE * LAND_OVERSHOOT_CUBE - 2 * LAND_OVERSHOOT;
/** Where in the landing the reel first strikes its stop and the thunk is heard. */
const LAND_IMPACT_FRACTION = 0.42;
/** At or above this speed a reel shows its smeared art. */
export const REEL_BLUR_SPEED = 4.5;

// ── Celebrations ─────────────────────────────────────────────────────────

const TRACE_MS = 560;
const TURBO_TRACE_MS = 260;
const SMALL_ROLLUP_MS = 900;
const ROLLUP_MS: Readonly<Record<WinTier, number>> = {
  none: SMALL_ROLLUP_MS,
  big: 3200,
  mega: 4800,
  epic: 6400,
  jackpot: 9000,
};
const HOLD_MS: Readonly<Record<WinTier, number>> = {
  none: 500,
  big: 1100,
  mega: 1400,
  epic: 1700,
  jackpot: 2400,
};
/** Turbo shortens a celebration to this share of its length. */
const TURBO_PACE = 0.4;
const BANNER_DELAY_MS = 220;
const FREE_SPINS_BANNER_MS = 1900;
const TURBO_FREE_SPINS_BANNER_MS = 900;
/** After a skip the final number is held this long, so the player sees what they won. */
const SKIP_HOLD_MS = 650;
export const BANNER_SLAM_MS = 280;

const SHAKE_MS = 520;
const SHAKE_AMPLITUDE: Readonly<Record<WinTier, number>> = {
  none: 0,
  big: 4,
  mega: 7,
  epic: 10,
  jackpot: 13,
};
const SHAKE_FREQUENCY = 0.045;

// ── Particles ────────────────────────────────────────────────────────────

/** Coins and sparks alive at once; past this the oldest are retired. */
export const MAX_SLOT_PARTICLES = 140;
const COINS_PER_SECOND: Readonly<Record<WinTier, number>> = {
  none: 0,
  big: 26,
  mega: 48,
  epic: 72,
  jackpot: 110,
};
const SPARK_SHARE = 0.25;
const COIN_LIFE_MS = 2200;
const SPARK_LIFE_MS = 900;
/** Cabinet heights per second squared. */
const COIN_GRAVITY = 1.6;
const COIN_SPREAD_X = 0.55;
const COIN_LIFT = 0.55;
const COIN_SPIN_RATE = 9;
const MS_PER_SECOND = 1000;

// ── Bulbs and flash ──────────────────────────────────────────────────────

/** Bulb-chase steps per second for each mood, escalating with the win. */
const BULB_CHASE: Readonly<Record<WinTier | 'idle' | 'spinning', number>> = {
  idle: 3,
  spinning: 7,
  none: 9,
  big: 12,
  mega: 16,
  epic: 20,
  jackpot: 26,
};
/**
 * The jackpot's light pulses. A pulse rises and then fades softly, and they
 * come a full second apart, well under the three-flashes-a-second limit for
 * photosensitive players.
 */
const FLASH_PULSES = 3;
const FLASH_PERIOD_MS = 1000;
const FLASH_RISE_MS = 140;
const FLASH_FALL_MS = 620;
export const FLASH_PEAK_ALPHA = 0.5;
const REDUCED_FLASH_PEAK_ALPHA = 0.18;

// ── Small effects ────────────────────────────────────────────────────────

export const NEAR_MISS_MS = 950;
export const SCATTER_POP_MS = 650;
export const ANTICIPATION_PULSE_MS = 420;
/** Idle long enough and the cabinet starts its attract pattern. */
const ATTRACT_DELAY_MS = 3500;
export const ATTRACT_WINK_MS = 650;

const HALF = 0.5;

function easeOutBack(u: number): number {
  const t = u - 1;
  return 1 + LAND_OVERSHOOT_CUBE * t * t * t + LAND_OVERSHOOT * t * t;
}

function easeOutBackSlope(u: number): number {
  const t = u - 1;
  return CUBE * LAND_OVERSHOOT_CUBE * t * t + 2 * LAND_OVERSHOOT * t;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function newReel(position: number): ReelMotion {
  return {
    phase: 'rest',
    position,
    speed: 0,
    targetSpeed: 0,
    phaseAt: 0,
    kickFrom: position,
    landFrom: position,
    landTo: position,
    landed: true,
    thunked: true,
    stopDueAt: 0,
    anticipating: false,
    anticipationAt: 0,
    nearMissAt: null,
  };
}

function tracesFor(outcome: SpinOutcome): WinTrace[] {
  const traces: WinTrace[] = outcome.lineWins.map((win) => ({
    lineIndex: win.lineIndex,
    cells: win.cells,
    amount: win.payout,
  }));
  if (outcome.scatter.payout > 0 || outcome.scatter.freeSpinsAwarded > 0) {
    traces.push({ lineIndex: null, cells: outcome.scatter.cells, amount: outcome.scatter.payout });
  }
  return traces;
}

export class SlotsMotion {
  time = 0;
  readonly reels: ReelMotion[];
  celebration: Celebration | null = null;
  /** The last win, kept on the glass while the machine waits for the next spin. */
  lastWin: { readonly traces: ReadonlyArray<WinTrace>; readonly since: number } | null = null;
  readonly particles: Particle[] = [];
  readonly scatterPops = new Map<string, number>();
  bulbPhase = 0;
  shakeAt: number | null = null;
  shakeTier: WinTier = 'none';
  flashAt: number | null = null;
  lastActivityAt = 0;
  private beats: MotionBeat[] = [];
  private pace: MotionPace = { turbo: false, reducedMotion: false };
  private spinning = false;
  private coinDebt = 0;

  constructor(
    private readonly stripLengths: ReadonlyArray<number>,
    private readonly random: () => number = Math.random,
  ) {
    this.reels = stripLengths.map(() => newReel(0));
  }

  setPace(pace: MotionPace): void {
    this.pace = pace;
  }

  get turbo(): boolean {
    return this.pace.turbo;
  }

  get reducedMotion(): boolean {
    return this.pace.reducedMotion;
  }

  /** Puts the reels at rest on `stops`, as a freshly opened machine shows its last spin. */
  restOn(stops: ReadonlyArray<number>): void {
    stops.forEach((stop, reel) => {
      const motion = listAt(this.reels, reel);
      if (motion !== undefined) Object.assign(motion, newReel(stop));
    });
  }

  drainBeats(): MotionBeat[] {
    const drained = this.beats;
    this.beats = [];
    return drained;
  }

  private beat(beat: MotionBeat): void {
    this.beats.push(beat);
  }

  /** Whether any reel is still moving. */
  get reelsMoving(): boolean {
    return this.reels.some((reel) => reel.phase !== 'rest');
  }

  /** Whether the attract pattern is running. */
  get attracting(): boolean {
    return (
      !this.reelsMoving &&
      this.celebration === null &&
      this.time - this.lastActivityAt >= ATTRACT_DELAY_MS
    );
  }

  /** Something happened the player made; the attract pattern waits again. */
  touch(): void {
    this.lastActivityAt = this.time;
  }

  // ── Spin ───────────────────────────────────────────────────────────────

  startSpin(anticipationReels: ReadonlyArray<number>): void {
    const turbo = this.pace.turbo;
    const stagger = turbo ? TURBO_LAUNCH_STAGGER_MS : LAUNCH_STAGGER_MS;
    const firstStop = turbo ? TURBO_FIRST_STOP_MS : FIRST_STOP_MS;
    const gap = turbo ? TURBO_STOP_GAP_MS : STOP_GAP_MS;
    const extra = turbo ? TURBO_ANTICIPATION_EXTRA_MS : ANTICIPATION_EXTRA_MS;
    let anticipationSoFar = 0;
    this.reels.forEach((reel, index) => {
      if (anticipationReels.includes(index)) anticipationSoFar++;
      reel.phase = 'kick';
      reel.phaseAt = this.time + index * stagger;
      reel.kickFrom = reel.position;
      reel.speed = 0;
      reel.targetSpeed = turbo ? TURBO_SPIN_SPEED : SPIN_SPEED;
      reel.landed = false;
      reel.thunked = false;
      reel.anticipating = false;
      reel.nearMissAt = null;
      reel.stopDueAt = this.time + firstStop + index * gap + anticipationSoFar * extra;
    });
    this.celebration = null;
    this.lastWin = null;
    this.scatterPops.clear();
    this.spinning = true;
    this.touch();
  }

  /** The leftmost reel still spinning, if its stop is due. */
  dueReel(): number | null {
    const next = this.reels.findIndex((reel) => !reel.landed);
    if (next === -1) return null;
    const reel = listAt(this.reels, next);
    if (reel === undefined || reel.phase === 'rest') return null;
    return this.time >= reel.stopDueAt ? next : null;
  }

  /** A tap on SPIN while the reels turn: every remaining reel stops at once, still left to right. */
  slam(): void {
    let order = 0;
    for (const reel of this.reels) {
      if (reel.landed) continue;
      reel.stopDueAt = Math.min(reel.stopDueAt, this.time + order * SLAM_GAP_MS);
      order++;
    }
  }

  /** The remaining reels slow, and the next one to stop wears the gold frame. */
  startAnticipation(reel: number): void {
    this.reels.forEach((motion, index) => {
      if (index < reel || motion.landed) return;
      motion.targetSpeed = ANTICIPATION_SPEED;
      if (index === reel) {
        motion.anticipating = true;
        motion.anticipationAt = this.time;
      }
    });
  }

  /** Lands `reel` on `stop`, travelling the distance its speed carries it so the stop never jerks. */
  landReel(reel: number, stop: number): void {
    const motion = listAt(this.reels, reel);
    if (motion === undefined) return;
    const length = this.stripLengths[reel] ?? 1;
    const landMs = this.pace.turbo ? TURBO_LAND_MS : LAND_MS;
    const speed = Math.max(motion.speed, ANTICIPATION_SPEED);
    const travel = (speed * landMs) / MS_PER_SECOND / LAND_START_SLOPE;
    // The reel is a smear at this speed, so which symbols it shows can jump;
    // keeping the fraction of a row it sits at keeps the smear itself steady.
    const fraction = motion.position - Math.floor(motion.position);
    const landTo = wrapStop(stop, length);
    motion.landFrom = landTo + Math.floor(travel) + 1 + fraction;
    motion.landTo = landTo;
    motion.phase = 'landing';
    motion.phaseAt = this.time;
    motion.landed = true;
    motion.anticipating = false;
  }

  nearMiss(reel: number): void {
    const motion = listAt(this.reels, reel);
    if (motion !== undefined) motion.nearMissAt = this.time;
  }

  scatterLanded(reel: number, row: number): void {
    this.scatterPops.set(`${reel}:${row}`, this.time);
  }

  // ── Celebration ────────────────────────────────────────────────────────

  celebrate(outcome: SpinOutcome): Celebration {
    const pace = this.pace.turbo ? TURBO_PACE : 1;
    const traces = tracesFor(outcome);
    const traceMs = this.pace.turbo ? TURBO_TRACE_MS : TRACE_MS;
    const tier = outcome.tier;
    const won = outcome.totalWin > 0;
    const rollupMs = won ? ROLLUP_MS[tier] * pace : 0;
    const tracesMs = traces.length * traceMs;
    const rollupEndsAt = this.time + rollupMs;
    const bannerAt = tier === 'none' ? null : this.time + BANNER_DELAY_MS * pace;
    const showEnd = Math.max(rollupEndsAt, this.time + Math.min(tracesMs, rollupMs + traceMs));
    const holdMs = won ? HOLD_MS[tier] * pace : 0;
    const freeSpinsMs = this.pace.turbo ? TURBO_FREE_SPINS_BANNER_MS : FREE_SPINS_BANNER_MS;
    const freeSpinsAt = outcome.scatter.freeSpinsAwarded > 0 ? showEnd + holdMs : null;
    const endsAt = freeSpinsAt === null ? showEnd + holdMs : freeSpinsAt + freeSpinsMs;
    const celebration: Celebration = {
      outcome,
      tier,
      traces,
      startedAt: this.time,
      traceMs,
      rollupEndsAt,
      rollupMs,
      endsAt,
      bannerAt,
      freeSpinsAt,
      showerEndsAt: tier === 'none' ? this.time : rollupEndsAt,
      skipped: false,
      tracesRaised: 0,
      bannerRaised: false,
      rollupStartedRaised: false,
      rollupLandedRaised: false,
      showerStartedRaised: tier === 'none',
      showerEndedRaised: tier === 'none',
      freeSpinsRaised: false,
    };
    this.celebration = celebration;
    if (won && tier === 'none') this.beat({ kind: 'small_win' });
    this.touch();
    return celebration;
  }

  /** The credit counter's value now: rolling up to the whole win. */
  get rollupValue(): number {
    const c = this.celebration;
    if (c === null) return 0;
    const total = c.outcome.totalWin;
    if (c.rollupMs <= 0 || this.time >= c.rollupEndsAt) return total;
    const progress = clamp01((this.time - c.startedAt) / c.rollupMs);
    return Math.floor(total * progress);
  }

  get rollingUp(): boolean {
    const c = this.celebration;
    return c !== null && c.rollupMs > 0 && this.time < c.rollupEndsAt;
  }

  /**
   * A tap, click or Space during a celebration: the first lands the rollup on
   * its final number and holds it for a beat, the next ends it outright.
   * Returns whether the celebration is now over.
   */
  skip(): boolean {
    const c = this.celebration;
    if (c === null) return true;
    if (!c.skipped && this.time < c.endsAt - SKIP_HOLD_MS) {
      c.skipped = true;
      this.quietBanner(c);
      c.rollupEndsAt = Math.min(c.rollupEndsAt, this.time);
      c.showerEndsAt = Math.min(c.showerEndsAt, this.time);
      const freeBannerMs = this.pace.turbo ? TURBO_FREE_SPINS_BANNER_MS : FREE_SPINS_BANNER_MS;
      const freeHold = c.freeSpinsAt === null ? 0 : freeBannerMs;
      c.endsAt = Math.min(c.endsAt, this.time + SKIP_HOLD_MS + freeHold);
      this.touch();
      return false;
    }
    c.endsAt = this.time;
    return true;
  }

  /**
   * A skip before the banner has slammed in shows it already settled: no
   * slam, shake, flash or fanfare for a moment the player chose to pass.
   * One already showing keeps its place but stops shaking and flashing.
   */
  private quietBanner(c: Celebration): void {
    this.shakeAt = null;
    this.flashAt = null;
    if (c.bannerAt === null || c.bannerRaised) return;
    c.bannerRaised = true;
    c.showerStartedRaised = true;
    c.showerEndedRaised = true;
    c.bannerAt = this.time - BANNER_SLAM_MS;
  }

  get celebrationDue(): boolean {
    return this.celebration !== null && this.time >= this.celebration.endsAt;
  }

  endCelebration(): void {
    const c = this.celebration;
    if (c === null) return;
    this.raiseCelebrationBeats(c, true);
    if (c.traces.length > 0) this.lastWin = { traces: c.traces, since: this.time };
    this.celebration = null;
    this.shakeAt = null;
    this.flashAt = null;
    this.touch();
  }

  /** The win tier on show, for the bulbs, banner and music. */
  get showingTier(): WinTier | null {
    const c = this.celebration;
    if (c === null) return null;
    const { bannerAt } = c;
    if (bannerAt === null || this.time < bannerAt) return null;
    return c.tier;
  }

  /** The trace lit now: during a celebration in turn, afterwards cycling slowly on the resting glass. */
  activeTrace(): { trace: WinTrace; startedAt: number } | null {
    const c = this.celebration;
    if (c !== null) {
      if (c.traces.length === 0) return null;
      const index = Math.floor((this.time - c.startedAt) / c.traceMs);
      const looped = ((index % c.traces.length) + c.traces.length) % c.traces.length;
      const trace = listAt(c.traces, looped);
      return trace === undefined ? null : { trace, startedAt: c.startedAt + index * c.traceMs };
    }
    const last = this.lastWin;
    if (last === null || this.reelsMoving) return null;
    const restingTraceMs = TRACE_MS * 2;
    const index = Math.floor((this.time - last.since) / restingTraceMs);
    const trace = listAt(last.traces, index % last.traces.length);
    return trace === undefined ? null : { trace, startedAt: last.since + index * restingTraceMs };
  }

  /** Every cell in any winning line of the celebration on show. */
  winningCells(): ReadonlySet<string> {
    const cells = new Set<string>();
    const traces = this.celebration?.traces ?? [];
    for (const trace of traces)
      for (const cell of trace.cells) cells.add(`${cell.reel}:${cell.row}`);
    return cells;
  }

  /** The screen shake now, in UI units. */
  shakeOffset(): { x: number; y: number } {
    if (this.shakeAt === null || this.pace.reducedMotion) return { x: 0, y: 0 };
    const age = this.time - this.shakeAt;
    if (age >= SHAKE_MS) return { x: 0, y: 0 };
    const fade = 1 - age / SHAKE_MS;
    const amplitude = SHAKE_AMPLITUDE[this.shakeTier] * fade * fade;
    const phase = age * SHAKE_FREQUENCY;
    return { x: Math.sin(phase * 2) * amplitude, y: Math.cos(phase * CUBE) * amplitude };
  }

  /** The jackpot flash's opacity now: soft pulses, never a strobe. */
  flashAlpha(): number {
    if (this.flashAt === null) return 0;
    const age = this.time - this.flashAt;
    if (age < 0 || age >= FLASH_PULSES * FLASH_PERIOD_MS) return 0;
    const pulses = this.pace.reducedMotion ? 1 : FLASH_PULSES;
    const pulse = Math.floor(age / FLASH_PERIOD_MS);
    if (pulse >= pulses) return 0;
    const within = age - pulse * FLASH_PERIOD_MS;
    const peak = this.pace.reducedMotion ? REDUCED_FLASH_PEAK_ALPHA : FLASH_PEAK_ALPHA;
    if (within < FLASH_RISE_MS) return peak * (within / FLASH_RISE_MS);
    const fall = (within - FLASH_RISE_MS) / FLASH_FALL_MS;
    return fall >= 1 ? 0 : peak * (1 - fall) * (1 - fall);
  }

  // ── Clock ──────────────────────────────────────────────────────────────

  advance(dtMs: number): void {
    this.time += dtMs;
    const seconds = dtMs / MS_PER_SECOND;
    for (let index = 0; index < this.reels.length; index++) this.advanceReel(index, seconds);
    if (this.spinning && !this.reelsMoving) this.spinning = false;
    const c = this.celebration;
    if (c !== null) this.raiseCelebrationBeats(c, false);
    this.bulbPhase += seconds * BULB_CHASE[this.bulbMood()];
    this.advanceParticles(seconds);
  }

  private bulbMood(): WinTier | 'idle' | 'spinning' {
    const tier = this.showingTier;
    if (tier !== null) return tier;
    if (this.celebration !== null) return 'none';
    if (this.reelsMoving) return 'spinning';
    return 'idle';
  }

  private advanceReel(index: number, seconds: number): void {
    const reel = listAt(this.reels, index);
    if (reel === undefined) return;
    const length = this.stripLengths[index] ?? 1;
    if (this.time < reel.phaseAt) return;
    const age = this.time - reel.phaseAt;
    switch (reel.phase) {
      case 'rest':
        return;
      case 'kick': {
        const kick = this.pace.reducedMotion ? 0 : KICK_SYMBOLS;
        const u = clamp01(age / KICK_MS);
        reel.position = reel.kickFrom + kick * Math.sin(Math.PI * u);
        if (u >= 1) {
          reel.phase = 'spin';
          reel.phaseAt = this.time;
          reel.position = reel.kickFrom;
        }
        return;
      }
      case 'spin': {
        const ramp = clamp01(age / SPINUP_MS);
        const ease = 1 - Math.exp(-SPEED_EASE_RATE * seconds);
        const target = reel.targetSpeed * ramp;
        reel.speed += (target - reel.speed) * (ramp < 1 ? 1 : ease);
        reel.position = wrapStop(reel.position - reel.speed * seconds, length);
        return;
      }
      case 'landing': {
        const landMs = this.pace.turbo ? TURBO_LAND_MS : LAND_MS;
        const u = clamp01(age / landMs);
        const distance = reel.landTo - reel.landFrom;
        reel.position = reel.landFrom + distance * easeOutBack(u);
        reel.speed = Math.abs((distance * easeOutBackSlope(u) * MS_PER_SECOND) / landMs);
        if (!reel.thunked && u >= LAND_IMPACT_FRACTION) {
          reel.thunked = true;
          this.beat({ kind: 'reel_thunk', reel: index });
        }
        if (u >= 1) {
          reel.phase = 'rest';
          reel.position = reel.landTo;
          reel.speed = 0;
        }
        return;
      }
    }
  }

  private raiseCelebrationBeats(c: Celebration, finishing: boolean): void {
    const now = finishing ? Number.POSITIVE_INFINITY : this.time;
    while (c.tracesRaised < c.traces.length && now >= c.startedAt + c.tracesRaised * c.traceMs) {
      if (!finishing) this.beat({ kind: 'trace', index: c.tracesRaised });
      c.tracesRaised++;
    }
    if (!c.rollupStartedRaised && c.rollupMs > 0) {
      c.rollupStartedRaised = true;
      if (!finishing) this.beat({ kind: 'rollup_started' });
    }
    if (c.bannerAt !== null && !c.bannerRaised && now >= c.bannerAt && c.tier !== 'none') {
      c.bannerRaised = true;
      if (!finishing) {
        this.beat({ kind: 'banner', tier: c.tier });
        this.shakeAt = this.time;
        this.shakeTier = c.tier;
        if (c.tier === 'jackpot') this.flashAt = this.time;
      }
    }
    if (!c.showerStartedRaised && c.bannerRaised) {
      c.showerStartedRaised = true;
      if (!finishing) this.beat({ kind: 'shower_started' });
    }
    if (c.bannerRaised && !c.showerEndedRaised && now >= c.showerEndsAt) {
      c.showerEndedRaised = true;
      this.beat({ kind: 'shower_ended' });
    }
    if (c.rollupStartedRaised && !c.rollupLandedRaised && now >= c.rollupEndsAt) {
      c.rollupLandedRaised = true;
      this.beat({ kind: 'rollup_landed' });
    }
    if (c.freeSpinsAt !== null && !c.freeSpinsRaised && now >= c.freeSpinsAt) {
      c.freeSpinsRaised = true;
      if (!finishing) this.beat({ kind: 'free_spins_banner' });
    }
  }

  private advanceParticles(seconds: number): void {
    const c = this.celebration;
    const showering =
      c !== null && c.bannerRaised && this.time < c.showerEndsAt && !this.pace.reducedMotion;
    if (showering) {
      this.coinDebt += COINS_PER_SECOND[c.tier] * seconds;
      while (this.coinDebt >= 1) {
        this.coinDebt -= 1;
        this.spawnParticle(this.random() < SPARK_SHARE);
      }
    } else {
      this.coinDebt = 0;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = listAt(this.particles, i);
      if (p === undefined) continue;
      if (this.time - p.bornAt >= p.life) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += COIN_GRAVITY * seconds;
      p.x += p.vx * seconds;
      p.y += p.vy * seconds;
      p.spin += COIN_SPIN_RATE * seconds;
    }
  }

  private spawnParticle(spark: boolean): void {
    if (this.particles.length >= MAX_SLOT_PARTICLES) this.particles.shift();
    this.particles.push({
      x: HALF + (this.random() - HALF) * COIN_SPREAD_X * HALF,
      y: 0,
      vx: (this.random() - HALF) * COIN_SPREAD_X,
      vy: -COIN_LIFT * (HALF + this.random() * HALF),
      spin: this.random() * Math.PI * 2,
      bornAt: this.time,
      life: spark ? SPARK_LIFE_MS : COIN_LIFE_MS,
      spark,
    });
  }

  /** The cell a payline crosses on `reel`. */
  static lineCell(lineIndex: number, reel: number): GridCell {
    const line = listAt(PAYLINES, lineIndex);
    return { reel, row: (line === undefined ? undefined : listAt(line, reel)) ?? 1 };
  }

  static readonly rows = ROW_COUNT;
  static readonly reelCount = REEL_COUNT;
}
