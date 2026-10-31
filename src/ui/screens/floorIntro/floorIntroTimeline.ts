/**
 * The "Find the Key" intro's beats, shared by every floor, as pure functions
 * of the milliseconds since the intro started: the floor's name fades up over
 * its ambience, the key's dark silhouette rises and counts its sockets out
 * with a knock each, "FIND THE KEY" slams in with a flash and a shake while
 * the silhouette's edges catch gold, and the subline fades in under it.
 *
 * The picture is fitted to the floor's swell, never the swell to the
 * picture: the swell plays whole from the intro's first frame, the slam lands
 * where the recording cuts out, and the beats before it are paced to fill the
 * time up to there. A recording that rings on past its cut-out keeps ringing
 * over the card and on into play.
 */

import { INTRO_SOCKET_KNOCKS, KEY_CUES } from '../../../audio/keySoundCues';
import type { SoundId } from '../../../audio/sounds';
import type { IntroSwell } from './floorIntroThemes';

/**
 * The slam time the beats before it are laid out for. A floor whose swell cuts
 * out sooner or later runs those beats faster or slower in proportion.
 */
const DESIGN_SLAM_AT_MS = 3200;
/** How long the finished card holds after the slam before the intro fades to the floor. */
const CARD_HOLD_AFTER_SLAM_MS = 2000;

const AMBIENCE_IN_AT_MS = 150;
const AMBIENCE_FADE_MS = 1300;
const KICKER_IN_AT_MS = 350;
const KICKER_FADE_MS = 700;
const SILHOUETTE_RISE_AT_MS = 1000;
const SILHOUETTE_RISE_MS = 800;
/** The first knock never comes before the silhouette has finished rising and settled. */
const KNOCK_AFTER_RISE_MS = 100;
const EARLIEST_KNOCK_AT_MS = SILHOUETTE_RISE_AT_MS + SILHOUETTE_RISE_MS + KNOCK_AFTER_RISE_MS;
/** The last knock leaves this much quiet before the slam. */
const LAST_KNOCK_BEFORE_SLAM_MS = 420;
/** The gap between knocks when there is room for it; more sockets squeeze it. */
const KNOCK_SPACING_MS = 400;
const SOCKET_PULSE_RISE_MS = 60;
const SOCKET_PULSE_MS = 420;
/** The title's fall from far too big down to its size. */
const TITLE_SLAM_MS = 170;
const TITLE_SLAM_FROM_SCALE = 2.6;
/** After landing the title overshoots small and springs back over this long. */
const TITLE_SETTLE_MS = 260;
const TITLE_SETTLE_DIP = 0.05;
const FLASH_MS = 360;
const SHAKE_MS = 520;
const EDGE_CATCH_RISE_MS = 90;
const EDGE_CATCH_MS = 1300;
/** The subline waits for the slam's ring to start decaying. */
const SUBLINE_AFTER_SLAM_MS = 450;
const SUBLINE_FADE_MS = 650;
const CUBIC = 3;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** CUBIC;
}

function easeInCubic(t: number): number {
  return t ** CUBIC;
}

function fadeIn(ms: number, at: number, length: number): number {
  return clamp01((ms - at) / length);
}

/** A quick rise to 1 over `riseMs`, then an ease back to 0 by `lengthMs`. */
function blip(ms: number, at: number, riseMs: number, lengthMs: number): number {
  const age = ms - at;
  if (age < 0 || age >= lengthMs) return 0;
  if (age < riseMs) return age / riseMs;
  return 1 - easeOutCubic((age - riseMs) / (lengthMs - riseMs));
}

/**
 * One floor's beat times, all derived from where its swell cuts out and how
 * many sockets its key has.
 */
export interface IntroTiming {
  /** Where "FIND THE KEY" lands: the swell's cut-out. */
  readonly slamAtMs: number;
  /** When the finished card starts its fade to the floor. */
  readonly holdMs: number;
  /** When each socket is counted. */
  readonly knockAtMs: readonly number[];
  /** How much faster (below 1) or slower the beats before the slam run than designed. */
  readonly pace: number;
}

export function introTiming(swell: IntroSwell, sockets: number): IntroTiming {
  const slamAtMs = swell.cutsOutAtMs;
  const pace = slamAtMs / DESIGN_SLAM_AT_MS;
  return {
    slamAtMs,
    holdMs: slamAtMs + CARD_HOLD_AFTER_SLAM_MS,
    knockAtMs: knockTimes(sockets, slamAtMs, pace),
    pace,
  };
}

function knockTimes(sockets: number, slamAtMs: number, pace: number): readonly number[] {
  if (sockets <= 0) return [];
  const lastAt = slamAtMs - LAST_KNOCK_BEFORE_SLAM_MS * pace;
  const room = lastAt - EARLIEST_KNOCK_AT_MS * pace;
  const spacing = sockets === 1 ? 0 : Math.min(KNOCK_SPACING_MS * pace, room / (sockets - 1));
  return Array.from({ length: sockets }, (_, index) => lastAt - (sockets - 1 - index) * spacing);
}

/** Everything the intro draws at one instant, each 0..1 unless noted. */
export interface IntroBeatState {
  readonly ambience: number;
  readonly kicker: number;
  /** 0 below the screen's middle, 1 risen into place. */
  readonly silhouetteRise: number;
  /** How strongly each socket is pulsing, one entry per fragment. */
  readonly socketPulse: readonly number[];
  /** Whether the title has landed yet. */
  readonly titleShown: boolean;
  /** The title's scale: large while it falls, 1 once settled. */
  readonly titleScale: number;
  readonly flash: number;
  /** How hard the screen shakes, 1 at the slam, falling to 0. */
  readonly shake: number;
  readonly edgeCatch: number;
  readonly subline: number;
}

function titleScaleAt(age: number): number {
  if (age >= TITLE_SLAM_MS + TITLE_SETTLE_MS) return 1;
  if (age >= TITLE_SLAM_MS) {
    const settle = (age - TITLE_SLAM_MS) / TITLE_SETTLE_MS;
    return 1 - TITLE_SETTLE_DIP * Math.sin(Math.PI * settle);
  }
  const falling = easeInCubic(clamp01(age / TITLE_SLAM_MS));
  return TITLE_SLAM_FROM_SCALE + (1 - TITLE_SLAM_FROM_SCALE) * falling;
}

/** The intro's look `ms` after it started. */
export function introBeatAt(ms: number, timing: IntroTiming): IntroBeatState {
  const { pace, slamAtMs } = timing;
  const sinceSlam = ms - slamAtMs;
  const sinceLanding = sinceSlam - TITLE_SLAM_MS;
  const landed = sinceLanding >= 0;
  return {
    ambience: easeOutCubic(fadeIn(ms, AMBIENCE_IN_AT_MS * pace, AMBIENCE_FADE_MS * pace)),
    kicker: easeOutCubic(fadeIn(ms, KICKER_IN_AT_MS * pace, KICKER_FADE_MS * pace)),
    silhouetteRise: easeOutCubic(
      fadeIn(ms, SILHOUETTE_RISE_AT_MS * pace, SILHOUETTE_RISE_MS * pace),
    ),
    socketPulse: timing.knockAtMs.map((at) =>
      blip(ms, at, SOCKET_PULSE_RISE_MS, SOCKET_PULSE_MS * pace),
    ),
    titleShown: sinceSlam >= 0,
    titleScale: titleScaleAt(sinceSlam),
    flash: landed ? blip(sinceLanding, 0, 1, FLASH_MS) : 0,
    shake: landed ? 1 - clamp01(sinceLanding / SHAKE_MS) : 0,
    edgeCatch: landed ? blip(sinceLanding, 0, EDGE_CATCH_RISE_MS, EDGE_CATCH_MS) : 0,
    subline: easeOutCubic(fadeIn(sinceSlam, SUBLINE_AFTER_SLAM_MS, SUBLINE_FADE_MS)),
  };
}

/** One sound the intro plays, from the top of its recording, `atMs` into the intro. */
export interface IntroSoundCue {
  readonly atMs: number;
  readonly id: SoundId;
}

/** The one take a cue plays: the intro cues each hold a single recording. */
function firstTake(takes: readonly [SoundId, ...SoundId[]]): SoundId {
  return takes[0];
}

/**
 * Every sound of a floor's intro, in the order it plays: the whole swell from
 * the first frame, a knock per socket (cycling through the knocks when a key
 * has more sockets than there are takes) and the slam at the swell's cut-out.
 */
export function introSoundCues(swell: IntroSwell, timing: IntroTiming): readonly IntroSoundCue[] {
  const swellCue: IntroSoundCue = { atMs: 0, id: firstTake(KEY_CUES[swell.cue]) };
  const knocks = timing.knockAtMs.map((atMs, index): IntroSoundCue => ({
    atMs,
    id: INTRO_SOCKET_KNOCKS[index % INTRO_SOCKET_KNOCKS.length],
  }));
  const slam: IntroSoundCue = { atMs: timing.slamAtMs, id: firstTake(KEY_CUES.introSlam) };
  return [swellCue, ...knocks, slam].sort((a, b) => a.atMs - b.atMs);
}
