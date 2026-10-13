/**
 * Where the high striker's puck is, how brightly its bell is lit and when its
 * recording is cut, as pure functions of the swing's power and the seconds
 * since the mallet's impact. Kept apart from the system so a timing check can
 * run them without a canvas.
 *
 * Power runs 0 to 1. At or above {@link HIGH_STRIKER_RING_THRESHOLD} the puck
 * runs the whole track, the bell rings and the whole recording plays. Below
 * it the puck climbs the same curve only to a height proportional to the
 * power, and the recording is faded out from the moment it peaks, so the bell
 * never sounds.
 */

import {
  HIGH_STRIKER_PUCK,
  HIGH_STRIKER_PUCK_STRIKE_UP,
} from '../../sprites/art/circusOverlayAnchors';

// ── The recording ─────────────────────────────────────────────────────────────

/**
 * Seconds into `high_striker_bell` that the puck starts rattling up the
 * track, measured from the recording. Zero is the mallet's thud.
 */
export const HIGH_STRIKER_PUCK_RISE_START_S = 0.15;
/** Seconds into `high_striker_bell` that the rattle up the track stops, measured from the recording. */
export const HIGH_STRIKER_RATTLE_END_S = 0.43;
/** Seconds into `high_striker_bell` that the bell is struck (its sharp onset), measured from the recording. */
export const HIGH_STRIKER_BELL_STRIKE_S = 0.45;
/** Seconds into `high_striker_bell` that the bell's ring has died to its faint tail, measured from the recording. */
export const HIGH_STRIKER_RING_OUT_END_S = 1.2;
/** The whole of `high_striker_bell`, faint tail included, measured from the recording. */
export const HIGH_STRIKER_SOUND_DURATION_S = 2.07;

// ── Power ─────────────────────────────────────────────────────────────────────

/**
 * The least power that rings the bell: the top tenth of the meter.
 *
 * Invariant, with {@link HIGH_STRIKER_CUT_FADE_S}: the cut for the strongest
 * swing that falls short ends before the bell's onset —
 * `highStrikerPeakAtS(HIGH_STRIKER_RING_THRESHOLD) + HIGH_STRIKER_CUT_FADE_S <
 * HIGH_STRIKER_BELL_STRIKE_S` (0.392 + 0.035 = 0.427 s, inside even the rattle,
 * which ends at 0.43 s). The peak time only grows with power, so every weaker
 * swing is cut sooner. `npm run verify:high-striker` checks it across powers.
 */
export const HIGH_STRIKER_RING_THRESHOLD = 0.9;
/**
 * How long a short swing's recording takes to fade to silence once its puck
 * peaks: long enough not to click, short enough to keep the invariant on
 * {@link HIGH_STRIKER_RING_THRESHOLD}.
 */
export const HIGH_STRIKER_CUT_FADE_S = 0.035;

/**
 * One sweep of the power meter, bottom to top and back. At an even pace the
 * fill spends `2 × (1 − threshold)` of a sweep in the ring zone, about 0.2 s
 * a pass: a reaction to the lamp lighting, not a guess.
 */
export const HIGH_STRIKER_METER_SWEEP_S = 2;

/** Where the meter's sweep is, 0 to 1, `seconds` after it appeared: up and down at an even pace from the bottom. */
export function highStrikerMeterPower(seconds: number): number {
  const phase = (seconds / HIGH_STRIKER_METER_SWEEP_S) % 1;
  return 1 - Math.abs(2 * phase - 1);
}

/** Whether a swing of this power rings the bell. */
export function highStrikerRings(power: number): boolean {
  return power >= HIGH_STRIKER_RING_THRESHOLD;
}

/** How far up the track a swing of this power sends the puck, 0 to 1: the whole track if it rings. */
export function highStrikerPeakShare(power: number): number {
  if (highStrikerRings(power)) return 1;
  return Math.max(0, Math.min(1, power));
}

// ── The puck ──────────────────────────────────────────────────────────────────

/**
 * How much the puck slows on its way up, as a share of its launch speed lost
 * by the top: it is thrown, so it decelerates, but still meets the bell hard.
 */
const PUCK_RISE_DECELERATION = 0.6;
const RISE_WINDOW_S = HIGH_STRIKER_BELL_STRIKE_S - HIGH_STRIKER_PUCK_RISE_START_S;
/** How long a ringing puck stays pressed to the bell before it falls. */
const PUCK_HANG_S = 0.04;
/** The fall back down the whole track; a shorter drop takes less, as under gravity. */
const PUCK_FULL_FALL_S = 0.42;
/** One small bounce at the foot of the track: how long, and how high as a share of the drop. */
const PUCK_BOUNCE_S = 0.16;
const PUCK_BOUNCE_HEIGHT_SHARE = 0.05;
/** `4u(1 - u)` peaks at 1 halfway through. */
const PARABOLA_PEAK_SCALE = 4;
/** The rattle shakes the puck side to side in its track: how far, in tiles, and how fast, in radians a second. */
const PUCK_RATTLE_TILES = 0.02;
const PUCK_RATTLE_RATE = 140;

/** The rise's easing: share of the track climbed at share `s` of the rise window. */
function climbed(s: number): number {
  return (1 + PUCK_RISE_DECELERATION) * s - PUCK_RISE_DECELERATION * s * s;
}

/** The quadratic formula's discriminant is `b² - 4ac`. */
const DISCRIMINANT_AC_SCALE = 4;

/**
 * The inverse of {@link climbed}: the share of the rise window at which
 * `share` of the track is reached — the smaller root of `k s² - (1 + k) s +
 * share = 0`, the one inside the window.
 */
function riseShareAt(share: number): number {
  const k = PUCK_RISE_DECELERATION;
  const b = 1 + k;
  return (b - Math.sqrt(b * b - DISCRIMINANT_AC_SCALE * k * share)) / (2 * k);
}

/**
 * Seconds after the impact that a swing of this power's puck is at its
 * highest: on the bell's onset if it rings, else where the full rise's curve
 * reaches its height.
 */
export function highStrikerPeakAtS(power: number): number {
  if (highStrikerRings(power)) return HIGH_STRIKER_BELL_STRIKE_S;
  return HIGH_STRIKER_PUCK_RISE_START_S + RISE_WINDOW_S * riseShareAt(highStrikerPeakShare(power));
}

/** When a swing of this power's recording is cut, in seconds into it, or null if it plays out. */
export function highStrikerCutAtS(power: number): number | null {
  return highStrikerRings(power) ? null : highStrikerPeakAtS(power);
}

function fallSeconds(share: number): number {
  return PUCK_FULL_FALL_S * Math.sqrt(share);
}

function bounceSeconds(share: number): number {
  return PUCK_BOUNCE_S * Math.sqrt(share);
}

function hangSeconds(power: number): number {
  return highStrikerRings(power) ? PUCK_HANG_S : 0;
}

/** Seconds after the impact that the puck is back at rest. */
export function highStrikerPuckRestAtS(power: number): number {
  const share = highStrikerPeakShare(power);
  return highStrikerPeakAtS(power) + hangSeconds(power) + fallSeconds(share) + bounceSeconds(share);
}

/**
 * How long after the impact the striker stays in use: the whole recording
 * when the bell rings, else until both the puck is at rest and the cut's fade
 * is done.
 */
export function highStrikerCycleS(power: number): number {
  const cut = highStrikerCutAtS(power);
  if (cut === null) return HIGH_STRIKER_SOUND_DURATION_S;
  return Math.max(highStrikerPuckRestAtS(power), cut + HIGH_STRIKER_CUT_FADE_S);
}

/**
 * Where the puck's foot is, in tiles above the striker's ground line, a
 * given number of seconds after the impact of a swing of this power: at rest
 * until the rattle, up the track to its peak, a moment pressed to the bell if
 * it rang, then down under gravity with one small bounce.
 */
export function highStrikerPuckUp(secondsSinceImpact: number, power: number): number {
  const rest = HIGH_STRIKER_PUCK.restUp;
  const track = HIGH_STRIKER_PUCK_STRIKE_UP - rest;
  const share = highStrikerPeakShare(power);
  const peakAt = highStrikerPeakAtS(power);
  const t = secondsSinceImpact;
  if (t < HIGH_STRIKER_PUCK_RISE_START_S) return rest;
  if (t < peakAt) {
    return rest + track * climbed((t - HIGH_STRIKER_PUCK_RISE_START_S) / RISE_WINDOW_S);
  }
  const drop = track * share;
  const sincePeak = t - peakAt;
  const hang = hangSeconds(power);
  if (sincePeak < hang) return rest + drop;
  const falling = sincePeak - hang;
  const fall = fallSeconds(share);
  if (falling < fall) {
    const u = falling / fall;
    return rest + drop * (1 - u * u);
  }
  const bouncing = falling - fall;
  const bounce = bounceSeconds(share);
  if (bouncing < bounce) {
    const u = bouncing / bounce;
    return rest + drop * PUCK_BOUNCE_HEIGHT_SHARE * PARABOLA_PEAK_SCALE * u * (1 - u);
  }
  return rest;
}

/** How far the rattle has the puck to one side of its track, in tiles: only while it climbs. */
export function highStrikerPuckRattleTiles(secondsSinceImpact: number, power: number): number {
  const t = secondsSinceImpact;
  const rattleEnd = Math.min(HIGH_STRIKER_RATTLE_END_S, highStrikerPeakAtS(power));
  if (t < HIGH_STRIKER_PUCK_RISE_START_S || t >= rattleEnd) return 0;
  return PUCK_RATTLE_TILES * Math.sin(t * PUCK_RATTLE_RATE);
}

// ── The bell ──────────────────────────────────────────────────────────────────

/** How sharply the bell's glow dies over the ring-out: higher is a brighter strike and a quicker fade. */
const RING_DECAY_POWER = 2.2;
/** The ringing bell's light beats as it rings: how deep, and how fast in radians a second. */
const RING_SHIMMER_DEPTH = 0.25;
const RING_SHIMMER_RATE = 38;
/** A cosine's swing, halved: `HALF - HALF * cos` runs 0 to 1. */
const HALF = 1 / 2;

/**
 * How brightly the bell is lit, 0 to 1, a given number of seconds after the
 * impact of a swing of this power: dark unless it rang, then at its brightest
 * on the strike, beating as it rings and gone by the end of the ring-out.
 */
export function highStrikerBellGlow(secondsSinceImpact: number, power: number): number {
  if (!highStrikerRings(power)) return 0;
  const t = secondsSinceImpact;
  if (t < HIGH_STRIKER_BELL_STRIKE_S || t >= HIGH_STRIKER_RING_OUT_END_S) return 0;
  const sinceStrike = t - HIGH_STRIKER_BELL_STRIKE_S;
  const ringOut = sinceStrike / (HIGH_STRIKER_RING_OUT_END_S - HIGH_STRIKER_BELL_STRIKE_S);
  const decay = Math.pow(1 - ringOut, RING_DECAY_POWER);
  const beat = HALF - HALF * Math.cos(sinceStrike * RING_SHIMMER_RATE);
  return decay * (1 - RING_SHIMMER_DEPTH * beat);
}

// ── The verdict ───────────────────────────────────────────────────────────────

/** The barker's verdicts on a swing that fell short, weakest first, each up to the share of the track it names. */
const SHORT_VERDICTS: ReadonlyArray<{ readonly belowShare: number; readonly text: string }> = [
  { belowShare: 0.25, text: 'Limp Noodle' },
  { belowShare: 0.5, text: 'Crawler Fodder' },
  { belowShare: 0.75, text: 'Mid-Tier Meat' },
  { belowShare: 1, text: 'Almost Viral' },
];
const RING_VERDICT = 'HERCULES!';

/** What the striker calls a swing of this power. */
export function highStrikerVerdict(power: number): string {
  if (highStrikerRings(power)) return RING_VERDICT;
  const share = highStrikerPeakShare(power);
  return SHORT_VERDICTS.find((verdict) => share < verdict.belowShare)?.text ?? RING_VERDICT;
}
