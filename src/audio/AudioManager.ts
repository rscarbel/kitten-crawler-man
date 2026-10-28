import type { EventBus } from '../core/EventBus';
import type { Mob } from '../creatures/Mob';
import { DISH_DEF } from '../systems/bopcaDialog';
import { bindCue, equipChangeCue } from './gearSoundCues';
import {
  clawSoundsOf,
  handWeaponSoundsOf,
  WEAPON_FAMILY_SOUNDS,
  WEAPON_SOUND_OVERRIDES,
} from './weaponSoundCues';
import { settings } from '../core/input/Settings';
import type { SoundId } from './sounds';
import {
  musicLoopStartS,
  ON_DEMAND_SOUND_IDS,
  SOUND_MANIFEST,
  STREAMING_SOUND_IDS,
} from './sounds';
import { CORE_SFX_IDS, GATED_SFX_IDS, SFX_GROUPS, type GatedSfxGroup } from './sfxGroups';
import { TILE_SIZE } from '../core/constants';
import { isWorldPointInView } from '../core/rendering/visibleWorldView';
import { SOUND_PRIORITY_RANK, soundTraits, type SoundTraits } from './soundTraits';
import { AudioScope, KEYBOARD_HERO_SONG, type ScopeEngine, type ScopeHooks } from './AudioScope';
import { LIMITER, sliderGain, VOLUME_RAMP_MS, type OneShotBus } from './buses';
import { loudnessTrimDb } from './loudness';
import {
  MusicDirector,
  type MusicEngine,
  type MusicTrackHandle,
  type MusicTrackRequest,
} from './music/MusicDirector';
import {
  dbToGain,
  glideParam,
  MIN_STOP_FADE_MS,
  MS_PER_SECOND,
  STREAM_PAUSE_SLACK_MS,
  stopVoice,
  type BufferVoice,
  type StreamVoice,
  type Voice,
} from './voiceFades';

/** Set by the bundler: true in `npm run serve` / `npm run dev` builds, absent under tsx. */
declare const __DEV_BUILD__: boolean | undefined;

const WARNS_ON_MISSING_BUFFER = typeof __DEV_BUILD__ !== 'undefined' && __DEV_BUILD__;

/** One take per retch of blood; the heave and its splash are in each. */
const BLOOD_VOMIT_TAKES: readonly SoundId[] = [
  'blood_vomit_1',
  'blood_vomit_2',
  'blood_vomit_3',
  'blood_vomit_4',
];

const STORMCALLER_SOUNDS = WEAPON_SOUND_OVERRIDES.stormcaller;
const GOBLIN_ENCOUNTER_CHANCE = 0.15;
const MENU_MUSIC_FADE_MS = 200;
/** How long the music bus takes to settle on a new partial-duck level by default. */
export const MUSIC_DUCK_RAMP_MS = 500;
/**
 * Fade applied to the ambience bus when a menu opens or closes. Matched to the
 * music fade so the whole world goes quiet as one gesture rather than the bed
 * trailing the track.
 */
const MENU_AMBIENCE_FADE_MS = MENU_MUSIC_FADE_MS;
/**
 * At most this many `<audio>` elements carry ambient beds at once. iOS caps
 * live media elements, and one element per start would leak toward that cap.
 */
const AMBIENT_STREAM_POOL_SIZE = 6;

const STEREO_CHANNELS = 2;
const LEFT_CHANNEL = 0;
const RIGHT_CHANNEL = 1;

/**
 * At most this many `<audio>` elements carry music at once: enough for a
 * crossfade with two more changes of track inside it before a fading track
 * has to be cut short.
 */
const MUSIC_STREAM_SLOT_LIMIT = 4;
/**
 * The input events that may unlock audio. `touchend` is the one a phone
 * counts as a gesture, not `touchstart`, and the canvas cancels touches, which
 * also suppresses the `click` a tap would otherwise end in.
 */
const UNLOCK_GESTURE_EVENTS = ['touchstart', 'touchend', 'click', 'keydown'] as const;
const UNLOCK_LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };
/** A dodge borrows the whiffed-punch cue, quieter and quicker so it reads as air. */
const DODGE_WHIFF_VOLUME = 0.5;
const DODGE_WHIFF_RATE = 1.35;
/**
 * A checkpoint save and a safe-room save can land on the same frame (entering
 * a safe room takes both), so the cue is suppressed if one already played
 * within this window rather than firing once per write.
 */
const GAME_SAVED_DEBOUNCE_MS = 1000;
/**
 * At most this many one-shots sound at once. Past it a pile-up is mush, and
 * every voice still costs the mixer.
 */
export const GLOBAL_VOICE_LIMIT = 32;
/** How long a voice taken for a newer sound takes to fall silent: quick, but never a click. */
export const VOICE_STEAL_FADE_MS = 15;
/** How quickly a sting pulls the music down under it. */
const STINGER_DUCK_ATTACK_MS = 50;
/**
 * Closer than this a placed sound plays at full level; beyond it the level
 * falls off as one over the distance, the way a point source's pressure does.
 */
const PLACED_FULL_LEVEL_TILES = 3;
/** The last share of the hearing range over which a placed sound fades to silence. */
const PLACED_EDGE_FADE_SHARE = 0.25;
/** A sound this many tiles to the side is panned as far as placed sounds go. */
const PLACED_PAN_SPREAD_TILES = 8;
/** Placed sounds never pan further than this, so nothing is heard in one ear only. */
export const PLACED_MAX_PAN = 0.7;
/** Below this a placed sound is not worth a voice. */
const PLACED_AUDIBLE_GAIN = 0.02;
/** A gentle, resonance-free roll-off for a sound heard from out of sight. */
const DISTANT_LOWPASS_Q = 0.7;
const TILE_CENTRE_FRACTION = 0.5;

/**
 * The party's own shots land far past ordinary hearing (a missile flies the
 * width of the screen, and without limit at its top level), and the player
 * fired them, so where they land only sets the side they are heard on.
 */
const PARTY_SHOT_REACH = 'panOnly' as const satisfies PlacedReach;

/** A point in the world, in pixels. */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The level of a sound placed `distanceTiles` from the listener: full up
 * close, falling off with distance, and silent at `hearingTiles`.
 */
export function placedGain(distanceTiles: number, hearingTiles: number): number {
  if (!(distanceTiles < hearingTiles)) return 0;
  const falloff = PLACED_FULL_LEVEL_TILES / Math.max(PLACED_FULL_LEVEL_TILES, distanceTiles);
  const edgeFadeFrom = hearingTiles * (1 - PLACED_EDGE_FADE_SHARE);
  const edgeFade =
    distanceTiles <= edgeFadeFrom
      ? 1
      : (hearingTiles - distanceTiles) / (hearingTiles - edgeFadeFrom);
  return falloff * edgeFade;
}

/** The stereo position of a sound `dxTiles` to the listener's right (negative: left). */
export function placedPan(dxTiles: number): number {
  const side = Math.max(-1, Math.min(1, dxTiles / PLACED_PAN_SPREAD_TILES));
  return side * PLACED_MAX_PAN;
}

/** A one-shot or loop that started, and where in the world it came from. */
export interface PlayedCue {
  readonly id: SoundId;
  /** Where a `playAt` sound was placed; null for a sound with no place (UI, the party, stings, loops). */
  readonly source: WorldPoint | null;
}

/**
 * How far a placed sound carries: `hearing` falls off with distance and is
 * dropped past the id's `hearingTiles`; `panOnly` keeps only the side.
 */
export type PlacedReach = 'hearing' | 'panOnly';

/** Plays cues from one point in the world; see {@link AudioManager.placedAt}. */
export interface PlacedCuePlayer {
  play(id: SoundId, opts?: PlayOptions): void;
  playRandom(ids: ReadonlyArray<SoundId>, opts?: PlayOptions): void;
}

/** A one-shot the manager is tracking until it ends. */
interface LiveVoice {
  readonly id: SoundId;
  readonly voice: BufferVoice;
  readonly rank: number;
  readonly traits: SoundTraits;
  readonly release: () => void;
  /** Set once a stop has begun; a stopping voice no longer counts toward any cap. */
  stopping: boolean;
}

/** Takes one off `id`'s count, forgetting it at zero. */
function countDown(counts: Map<SoundId, number>, id: SoundId): void {
  const remaining = (counts.get(id) ?? 1) - 1;
  if (remaining > 0) counts.set(id, remaining);
  else counts.delete(id);
}

/** A decode under way, and the release generation it began in. */
interface RunningDecode {
  readonly generation: number;
  readonly decoding: Promise<void>;
}

/** A one-shot waiting for the audio context to unlock. */
interface QueuedPlay {
  readonly id: SoundId;
  readonly opts: PlayOptions;
  readonly source: WorldPoint | null;
}

function jittered(value: number, spread: number): number {
  if (spread <= 0) return value;
  return value * (1 + (Math.random() * 2 - 1) * spread);
}

export interface PlayOptions {
  /** Volume multiplier (0–1). Default: 1. */
  volume?: number;
  /** Playback speed multiplier. Default: 1. */
  playbackRate?: number;
  /** Start playback this many seconds into the buffer. Default: 0. */
  startOffset?: number;
  /** Stereo position, -1 (hard left) to 1 (hard right). Default: 0, centred. */
  pan?: number;
  /**
   * Cuts the sound partway: a linear fade to silence starting `atS` seconds
   * into the recording and lasting `durationS`, scheduled on the audio clock
   * when the sound starts, so the cut lands on the same sample however late
   * the next frame is.
   */
  fadeOut?: ScheduledFadeOut;
  /** Which bus it plays on. Default `sfx`; menu taps use `ui`. */
  bus?: OneShotBus;
  /** Plays through a low-pass filter at this cut-off. Default: unfiltered. */
  lowpassHz?: number;
}

/** A fade to silence scheduled from a sound's own start, in seconds of the recording. */
export interface ScheduledFadeOut {
  readonly atS: number;
  readonly durationS: number;
}

export interface AudioManagerOptions {
  /** The music director's shuffles draw on this. Default `Math.random`; gates seed it. */
  readonly musicRandom?: () => number;
}

/**
 * Why the music/ambience bus is ramped down. Tracked as a set rather than a
 * single boolean: backgrounding and the pause menu can each want the bus
 * silent at overlapping times (the player can alt-tab while the pause menu is
 * open), and a single flag has one owner — whichever of the two last touched
 * it wins, and can resume audio the other reason still wants silent, or leave
 * it silent forever if the reason that set the flag never clears it. The bus
 * only comes back once every reason that asked for silence has let go.
 */
export type MusicPauseReason =
  'menu' | 'background' | 'slots_big_win' | 'wheel' | 'permanent_death' | 'siege_victory';

/**
 * The pause reasons that also freeze the music where it is, once the bus has
 * faded. These are the moments nothing in the game happens, so a playlist
 * must not reach the end of its song unheard and move on. The other reasons
 * are short, timed effects that systems schedule against, and only mute.
 */
const MUSIC_HOLD_REASONS: ReadonlySet<MusicPauseReason> = new Set(['menu', 'background']);

/**
 * Why the sound-effects bus is held silent. A set, like the pause reasons, so
 * one moment letting go cannot bring back effects another still wants quiet.
 */
export type EffectsHushReason = 'siege_victory';

/**
 * Why the music bus is held below the player's level without being silenced.
 * Several can be active at once; the bus sits at the lowest level any of them
 * asks for, and a pause reason still silences it outright on top of that.
 */
export type MusicDuckReason = 'slots' | 'tutorial' | 'stinger';

/**
 * One `<audio>` element streamed music plays through, wired for good to its
 * own gain node. A track fading out keeps its slot until it is paused, so a
 * crossfade — or several music changes inside one — never repoints an
 * element that is still sounding.
 */
interface MusicStreamSlot {
  readonly el: HTMLAudioElement;
  readonly gain: GainNode;
  /**
   * Bumped each time a track claims the slot. Deferred work for a track (its
   * fade-out pause, its loop seek, a stolen slot's delayed start) checks it
   * first, so a stale timer never touches a later track that reused the element.
   */
  gen: number;
  /** `idle` once its last track has faded out and been paused. */
  state: 'idle' | 'playing' | 'fading';
  /** True while a stolen slot fades its old track before starting the new one. */
  awaitingStart: boolean;
  /** The current track's `playing` report; the element's listener calls it. */
  onPlaying: (() => void) | null;
  /** Whether the browser's autoplay policy refused the element's last play(). */
  refusedPlay: boolean;
  /** Paused on purpose by a music hold; nothing but the hold's release may play it. */
  held: boolean;
}

/**
 * One of the pooled `<audio>` elements ambient beds stream through, wired for
 * good to its own gain node. A media element can be wired into the graph only
 * once, so the element is reused rather than replaced.
 */
interface PooledStream {
  readonly voice: StreamVoice;
  /** `idle` once its last bed has faded out and the element is paused. */
  state: 'idle' | 'playing' | 'stopping';
  /** Whether the browser's autoplay policy refused the element's last play(). */
  refusedPlay: boolean;
}

/**
 * Whether a rejected play() was the autoplay policy turning it down, rather
 * than a failed load or a play() cut short by a pause.
 */
function isAutoplayRefusal(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotAllowedError';
}

/** `MediaError.MEDIA_ERR_NETWORK`: the download broke off after the element had started. */
const MEDIA_ERR_NETWORK = 2;

/** Paused, or failed mid-stream: a failed element stops sounding without reporting itself paused. */
function streamElementStalled(el: HTMLAudioElement): boolean {
  return el.paused || el.error !== null;
}

function ambientStreamStalled(pooled: PooledStream): boolean {
  return pooled.state === 'playing' && streamElementStalled(pooled.voice.el);
}

/** A retried play() that fails again is retried by the next gesture or unlock. */
function ignoreRetryFailure(): void {
  return;
}

/** Where a looping buffer stands after `elapsedS`, wrapping at its loop point. */
function loopedPositionS(elapsedS: number, durationS: number, loopStartS: number): number {
  if (elapsedS < durationS) return elapsedS;
  const loopLengthS = durationS - loopStartS;
  if (loopLengthS <= 0) return durationS;
  return loopStartS + ((elapsedS - durationS) % loopLengthS);
}

/**
 * Web Audio API manager for the game.
 *
 * Bus graph:
 *   music, sfx, ambience, ui → master → limiter → destination
 *                                        └→ mono downmix → destination
 *
 * Mute holds `master` at silence without moving a slider; mono crossfades
 * the limiter's output onto the downmix path.
 *
 * One-shots play on `sfx` (menu taps on `ui`, which follows the Effects
 * slider). Continuous world sounds play on `ambience`, which can be muted on
 * its own: pausing the game silences every loop while menu clicks still play.
 * Music and the keyboard-hero song play on `music`. What music plays is
 * decided by {@link music}, the director every system claims through.
 *
 * Every voice owns a gain node, and every stop ramps it to silence first
 * (`stopVoice`). Loops and ambient beds are started only through an
 * {@link AudioScope}, one per scene, which fades them all out when the scene
 * exits and restarts the ones it still wants after the page is backgrounded.
 *
 * Usage:
 *   const audio = new AudioManager();
 *   void audio.preload(CORE_SFX_IDS); // decode the boot group in the background
 *   audio.resume();                 // call on first user gesture
 *   audio.play('splat_1');
 *   const scope = audio.createScope();
 *   scope.claimMusic({ owner: 'floor', layer: 'area', selection: { kind: 'loop', id: 'bg_level_1' } });
 *   scope.startAmbientLoop('ambient_fountain', 0.5);
 */
export class AudioManager {
  private readonly ctx: AudioContext;
  private readonly masterGain: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  /** The limiter's output straight to the speakers; silent while mono audio is on. */
  private readonly stereoOut: GainNode;
  /** The limiter's output downmixed to one channel and fed to both speakers; silent while off. */
  private readonly monoOut: GainNode;
  private readonly sfxGain: GainNode;
  /** Looping world sounds: footsteps, machinery, ambient beds. */
  private readonly ambienceGain: GainNode;
  private readonly musicGain: GainNode;
  private readonly uiGain: GainNode;

  private readonly buffers = new Map<SoundId, AudioBuffer>();
  /**
   * Compressed files kept for a decode on demand: `ON_DEMAND_SOUND_IDS` waiting
   * for their first play, and files a scope keeps (`AudioScope.keepCompressed`).
   */
  private readonly encoded = new Map<SoundId, ArrayBuffer>();
  /** Each id's fetch under way, so a second load waits on the same one. */
  private readonly fetches = new Map<SoundId, Promise<ArrayBuffer>>();
  /** How many loads of each id are fetching or decoding, so a release sees them too. */
  private readonly loadsInFlight = new Map<SoundId, number>();
  /** How many of those began since the id was last released; a release clears it. */
  private readonly currentLoads = new Map<SoundId, number>();
  /**
   * Bumped each time an id is released: a fetch or decode begun before the
   * release drops its result rather than bringing the sound back.
   */
  private readonly releaseGenerations = new Map<SoundId, number>();
  /** Gated ids already reported as played with their group let go, so dev builds name each once. */
  private readonly gatedFallbackWarned = new Set<SoundId>();
  /**
   * Each id's decode under way and the release generation it began in, so a
   * second request waits on the same one, unless a release has since made it
   * stale.
   */
  private readonly onDemandDecodes = new Map<SoundId, RunningDecode>();
  /** The newest play each on-demand id was asked for while it decoded; a stop clears it. */
  private readonly playsAwaitingDecode = new Map<SoundId, QueuedPlay>();
  /** Every id a `preload` has fetched or is fetching, whether or not it decoded. */
  private readonly preloadRequested = new Set<SoundId>();
  private readonly missingBufferWarned = new Set<SoundId>();
  /** Ids whose fetch or decode failed, as opposed to ones still on the way. */
  private readonly failedDecodes = new Set<SoundId>();
  /** Streamed music's elements, made as overlapping tracks need them. */
  private readonly musicStreamSlots: MusicStreamSlot[] = [];
  /** Every music track started for the director and not yet stopped. */
  private readonly unstoppedMusicTracks = new Set<MusicTrackHandle>();
  /** Decides what music plays. Systems claim through their scene's scope; the music page through this. */
  readonly music: MusicDirector;
  /** Every scope not yet disposed. */
  private readonly scopes = new Set<ScopeHooks>();
  private readonly ambientStreamPool: PooledStream[] = [];

  // Sounds queued because their buffer wasn't decoded yet when requested.
  private readonly pendingSfx = new Map<SoundId, PlayOptions>();
  // Sounds queued because the AudioContext was suspended when the buffer became ready.
  private readonly pendingOnUnlock: QueuedPlay[] = [];
  /** Every one-shot still sounding, oldest first. */
  private readonly liveVoices: LiveVoice[] = [];
  /** When each id last started, on the audio clock. */
  private readonly lastStartS = new Map<SoundId, number>();
  /** The stings currently holding the music down. */
  private readonly duckingStingers = new Set<LiveVoice>();
  /** Where `playAt` hears from: the active crawler's centre, set each frame by the scene. */
  private listener: WorldPoint | null = null;
  private readonly cueListeners = new Set<(cue: PlayedCue) => void>();

  private masterVol = settings.masterVolume;
  private sfxVol = settings.sfxVolume;
  private musicVol = settings.musicVolume;
  private ambienceVol = settings.ambienceVolume;
  private mutedPreference = settings.muted;
  private monoPreference = settings.monoAudio;
  private backgroundPreference = settings.audioInBackground;

  // True while the page is backgrounded (lock screen, app switch). Used to keep
  // the master gain at 0 without clobbering the user's stored volume.
  private backgrounded = false;

  // Callbacks queued until the AudioContext first reaches 'running' state.
  private readonly runningCallbacks: Array<() => void> = [];

  get masterVolume(): number {
    return this.masterVol;
  }
  get sfxVolume(): number {
    return this.sfxVol;
  }
  get musicVolume(): number {
    return this.musicVol;
  }
  get ambienceVolume(): number {
    return this.ambienceVol;
  }
  get muted(): boolean {
    return this.mutedPreference;
  }
  get monoAudio(): boolean {
    return this.monoPreference;
  }
  get playsInBackground(): boolean {
    return this.backgroundPreference;
  }

  constructor(options: AudioManagerOptions = {}) {
    this.ctx = new AudioContext();
    this.music = new MusicDirector(this.musicEngine, options.musicRandom);
    this.masterGain = this.ctx.createGain();
    this.limiter = this.ctx.createDynamicsCompressor();
    this.sfxGain = this.ctx.createGain();
    this.ambienceGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.uiGain = this.ctx.createGain();
    this.stereoOut = this.ctx.createGain();
    this.monoOut = this.ctx.createGain();
    this.limiter.threshold.value = LIMITER.thresholdDb;
    this.limiter.knee.value = LIMITER.kneeDb;
    this.limiter.ratio.value = LIMITER.ratio;
    this.limiter.attack.value = LIMITER.attackS;
    this.limiter.release.value = LIMITER.releaseS;
    this.masterGain.gain.value = this.masterBusLevel;
    this.sfxGain.gain.value = sliderGain(this.sfxVol);
    this.uiGain.gain.value = sliderGain(this.sfxVol);
    this.ambienceGain.gain.value = this.openAmbienceBusLevel;
    this.musicGain.gain.value = this.openMusicBusLevel;
    this.sfxGain.connect(this.masterGain);
    this.uiGain.connect(this.masterGain);
    this.ambienceGain.connect(this.masterGain);
    this.musicGain.connect(this.masterGain);
    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.stereoOut);
    this.stereoOut.connect(this.ctx.destination);
    this.connectMonoPath();
    this.stereoOut.gain.value = this.monoPreference ? 0 : 1;
    this.monoOut.gain.value = this.monoPreference ? 1 : 0;
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    // pagehide fires when the page enters the BFCache (lock screen / app switch on
    // iOS) — more reliable than visibilitychange alone on some mobile browsers.
    window.addEventListener('pagehide', this.handlePageHide);
    window.addEventListener('pageshow', this.handlePageShow);
    // The tab can stay visible (document.hidden stays false) while the browser
    // *window* loses OS focus — alt-tabbing to another application on desktop.
    // Some platforms still reclaim the audio device from an unfocused window,
    // and visibilitychange never fires to tell us, so this is watched
    // separately rather than folded into muteForBackground/unmuteFromBackground.
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('focus', this.handleWindowFocus);
    // Mobile browsers start AudioContext suspended and only allow resume() inside
    // a direct user-gesture handler. Kept attached for the life of the manager
    // (rather than removed after the first success): iOS can drop a running
    // context back into 'interrupted' on its own (an incoming call, another app
    // claiming audio, the screen locking) and resuming out of that also needs a
    // fresh gesture, so every future touch/click/key has to be able to retry it.
    for (const type of UNLOCK_GESTURE_EVENTS) {
      window.addEventListener(type, this.handleUnlockGesture, UNLOCK_LISTENER_OPTIONS);
    }
    // iOS drops a running context to 'interrupted' (a call, another app taking
    // audio) and brings it back on its own; without this the music and beds
    // stay stalled until the next gesture.
    this.ctx.onstatechange = this.handleContextStateChange;
  }

  /**
   * limiter → downmix → both inputs of a merger → monoOut → destination. A
   * gain node forced to one channel with speaker interpretation sums left and
   * right at half each, which is the downmix; the merger then puts that one
   * channel on both speakers.
   */
  private connectMonoPath(): void {
    const downmix = this.ctx.createGain();
    downmix.channelCount = 1;
    downmix.channelCountMode = 'explicit';
    downmix.channelInterpretation = 'speakers';
    const merger = this.ctx.createChannelMerger(STEREO_CHANNELS);
    this.limiter.connect(downmix);
    downmix.connect(merger, 0, LEFT_CHANNEL);
    downmix.connect(merger, 0, RIGHT_CHANNEL);
    merger.connect(this.monoOut);
    this.monoOut.connect(this.ctx.destination);
  }

  private readonly handleContextStateChange = (): void => {
    if (this.ctx.state === 'running' && !this.backgrounded) this.onContextUnlocked();
  };

  private readonly handleVisibilityChange = (): void => {
    if (this.backgroundPreference) return;
    if (document.hidden) {
      this.muteForBackground();
    } else {
      this.unmuteFromBackground();
    }
  };

  private readonly handlePageHide = (): void => {
    this.muteForBackground();
  };

  private readonly handlePageShow = (e: PageTransitionEvent): void => {
    // persisted=false means this is the initial page load, not a BFCache restore.
    if (!e.persisted) return;
    this.unmuteFromBackground();
  };

  private readonly handleWindowBlur = (): void => {
    if (this.backgroundPreference) return;
    this.muteForBackground();
  };

  private readonly handleWindowFocus = (): void => {
    this.unmuteFromBackground();
  };

  private muteForBackground(): void {
    if (this.backgrounded) return;
    this.backgrounded = true;
    this.pendingOnUnlock.length = 0;
    // Also marks music/ambience paused "for background" specifically, so a
    // pause-menu-open at the same moment (its own 'menu' reason) isn't
    // silently cleared by this reason letting go later — see MusicPauseReason.
    this.pauseMusic('background');
    this.pauseAmbience('background');
    // Zero gain immediately — ctx.suspend() is async and some mobile browsers
    // don't honor it fast enough before the screen fully locks.
    this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.masterGain.gain.value = 0;
    // Stop looping voices so they don't resume audibly on a buggy ctx.resume().
    // Each scope keeps the loops it wants and restarts them on the way back.
    for (const scope of this.scopes) scope.suspend();
    void this.ctx.suspend();
  }

  private unmuteFromBackground(): void {
    if (!this.backgrounded) return;
    this.backgrounded = false;
    this.resumeMusic('background');
    this.resumeAmbience('background');
    glideParam(
      this.masterGain.gain,
      this.ctx.currentTime,
      this.masterBusLevel,
      VOLUME_RAMP_MS / MS_PER_SECOND,
      'linear',
    );
    if (this.ctx.state === 'running') this.restartScopeLoops();
    this.attemptResume();
  }

  private restartScopeLoops(): void {
    if (this.backgrounded || this.ctx.state !== 'running') return;
    for (const scope of this.scopes) scope.restartWanted();
  }

  /**
   * Resume the AudioContext if it isn't already running, and flush whatever
   * was waiting on it once it is. Safe to call repeatedly and from any of the
   * several signals (a gesture, a visibility/focus change) that can observe
   * the same "audio should be alive again" moment — `onContextUnlocked` and
   * the browsers' own state machines are what make the repeats harmless.
   */
  private attemptResume(): void {
    if (this.ctx.state === 'running' || this.ctx.state === 'closed') return;
    void this.ctx
      .resume()
      .then(() => {
        if (this.ctx.state === 'running') this.onContextUnlocked();
      })
      .catch(() => {
        // iOS can refuse a resume() that isn't called from inside a gesture
        // handler (e.g. one fired from a visibilitychange/focus listener) —
        // the persistent gesture listener below is the fallback that catches it.
      });
  }

  /**
   * Kept attached for the life of the manager. Besides resuming the context,
   * it starts music inside the gesture itself: Safari lets an `<audio>`
   * element start only there, and `resume()` settles after the gesture has
   * ended, so a stream started from `onContextUnlocked` alone can be refused.
   * A refused stream leaves the context running, so no later unlock would
   * ever retry it; every gesture retries the refused ones.
   *
   * Once the context runs, every gesture also wakes any stream that should be
   * sounding and is not. A browser can pause or fail a streamed element on
   * its own while the page stays in front (a dropped range request, a media
   * session pause, an audio-session hiccup), and with the context running no
   * unlock fires to notice, so without this only backgrounding the page and
   * bringing it back would wake the music.
   */
  private readonly handleUnlockGesture = (): void => {
    this.attemptResume();
    if (this.backgrounded || this.ctx.state === 'closed') return;
    this.music.engineReady();
    if (this.ctx.state === 'running') {
      this.restartStalledStreams();
      return;
    }
    this.retryRefusedStreams();
  };

  /** play() on a streamed element, remembering on `stream` whether autoplay refused it. */
  private playStream(
    el: HTMLAudioElement,
    stream: { refusedPlay: boolean },
    onFailed: (err: unknown) => void,
  ): void {
    stream.refusedPlay = false;
    void el.play().catch((err: unknown) => {
      if (isAutoplayRefusal(err)) stream.refusedPlay = true;
      onFailed(err);
    });
  }

  private retryRefusedStreams(): void {
    for (const slot of this.musicStreamSlots) {
      if (slot.refusedPlay && this.musicSlotStalled(slot)) this.wakeStream(slot.el, slot);
    }
    for (const pooled of this.ambientStreamPool) {
      if (pooled.refusedPlay && ambientStreamStalled(pooled))
        this.wakeStream(pooled.voice.el, pooled);
    }
  }

  /**
   * A slot whose track should be sounding and is not. A held slot was paused
   * on purpose, a stolen one is still fading its old track, and an element
   * that played to its end is never woken: play() would start its song over
   * on top of whatever followed it.
   */
  private musicSlotStalled(slot: MusicStreamSlot): boolean {
    if (slot.state !== 'playing' || slot.awaitingStart || slot.held) return false;
    return !slot.el.ended && streamElementStalled(slot.el);
  }

  /**
   * play() again on a stalled element. An element whose download broke off
   * is reloaded first, since play() alone does not fetch again after a
   * network error, and is put back where it stopped.
   */
  private wakeStream(el: HTMLAudioElement, stream: { refusedPlay: boolean }): void {
    if (el.error?.code === MEDIA_ERR_NETWORK) {
      const resumeAtS = el.currentTime;
      el.load();
      el.currentTime = resumeAtS;
    }
    this.playStream(el, stream, ignoreRetryFailure);
  }

  /** True when the AudioContext is actively processing audio. */
  get isRunning(): boolean {
    return this.ctx.state === 'running';
  }

  /**
   * Call `cb` immediately if the AudioContext is already running, otherwise
   * queue it to fire the first time the context reaches the running state.
   * Each callback is called at most once.
   */
  onRunning(cb: () => void): void {
    if (this.ctx.state === 'running') {
      cb();
    } else {
      this.runningCallbacks.push(cb);
    }
  }

  private removeUnlockListeners(): void {
    for (const type of UNLOCK_GESTURE_EVENTS) {
      window.removeEventListener(type, this.handleUnlockGesture, UNLOCK_LISTENER_OPTIONS);
    }
  }

  private onContextUnlocked(): void {
    this.restartStalledStreams();
    this.restartScopeLoops();

    const callbacks = this.runningCallbacks.splice(0);
    for (const cb of callbacks) cb();

    const pending = this.pendingOnUnlock.splice(0);
    for (const { id, opts, source } of pending) {
      this.request(id, opts, source);
    }

    this.music.engineReady();
  }

  /**
   * Streamed music and ambience play through `<audio>` elements, and some
   * browsers pause a background tab's media elements outright rather than
   * merely suspending the Web Audio graph they feed. Resuming the
   * AudioContext alone leaves those elements paused forever, silent even
   * though `ctx.state` is back to 'running' and nothing else ever calls
   * `.play()` on them again — so every element still logically "playing" is
   * nudged back into motion here, whenever the context is known to be alive:
   * as it comes back, and on every gesture while it runs.
   */
  private restartStalledStreams(): void {
    for (const slot of this.musicStreamSlots) {
      if (this.musicSlotStalled(slot)) this.wakeStream(slot.el, slot);
    }
    for (const pooled of this.ambientStreamPool) {
      if (ambientStreamStalled(pooled)) this.wakeStream(pooled.voice.el, pooled);
    }
  }

  /** Resume the AudioContext. Best called from a user-gesture handler. */
  resume(): void {
    this.attemptResume();
  }

  /**
   * Fetch and decode sounds into memory in parallel. Music and ambience
   * (`STREAMING_SOUND_IDS`) are played via `MediaElementAudioSourceNode`
   * instead and are never decoded into `buffers`, so they are skipped.
   * Failures emit a console warning and are skipped — they will not throw.
   */
  async preload(ids: ReadonlyArray<SoundId>): Promise<void> {
    await Promise.all(ids.map((id) => this.load(id, 'decoded')));
    // Loops a scope was refused while these were decoding can start now.
    this.restartScopeLoops();
  }

  private async preloadCompressed(ids: ReadonlyArray<SoundId>): Promise<void> {
    await Promise.all(ids.map((id) => this.load(id, 'compressed')));
  }

  private generationOf(id: SoundId): number {
    return this.releaseGenerations.get(id) ?? 0;
  }

  /** Whether a live scope keeps `id`'s compressed file once it is decoded. */
  private keepsCompressed(id: SoundId): boolean {
    return [...this.scopes].some((scope) => scope.declaredCompressed.has(id));
  }

  /** Whether a play of `id` is waiting on its file or its decode. */
  private hasPlayWaiting(id: SoundId): boolean {
    return this.pendingSfx.has(id) || this.playsAwaitingDecode.has(id);
  }

  private fetchFile(id: SoundId): Promise<ArrayBuffer> {
    const running = this.fetches.get(id);
    if (running !== undefined) return running;
    const fetching = fetch(SOUND_MANIFEST[id])
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .finally(() => {
        this.fetches.delete(id);
      });
    this.fetches.set(id, fetching);
    return fetching;
  }

  /**
   * Fetches `id` and, when `want` is `decoded` and the id is not one decoded on
   * its first play, decodes it. A release while this runs drops the result,
   * except a compressed file some scope still keeps.
   */
  private async load(id: SoundId, want: 'decoded' | 'compressed'): Promise<void> {
    if (this.buffers.has(id) || STREAMING_SOUND_IDS.has(id)) return;
    this.preloadRequested.add(id);
    const generation = this.generationOf(id);
    this.loadsInFlight.set(id, (this.loadsInFlight.get(id) ?? 0) + 1);
    this.currentLoads.set(id, (this.currentLoads.get(id) ?? 0) + 1);
    try {
      const file = this.encoded.get(id) ?? (await this.fetchFile(id));
      const released = this.generationOf(id) !== generation;
      if (released && !this.keepsCompressed(id)) return;
      if (!this.encoded.has(id)) this.encoded.set(id, file);
      if (released) {
        this.decodeForWaitingPlay(id);
        return;
      }
      const decodesNow = want === 'decoded' && !ON_DEMAND_SOUND_IDS.has(id);
      if (decodesNow || this.hasPlayWaiting(id)) await this.decodeEncoded(id);
    } catch (err) {
      this.failedDecodes.add(id);
      console.warn(`[AudioManager] Failed to load "${id}":`, err);
    } finally {
      countDown(this.loadsInFlight, id);
      if (this.generationOf(id) === generation) countDown(this.currentLoads, id);
    }
  }

  private storeDecoded(id: SoundId, buffer: AudioBuffer): void {
    this.buffers.set(id, buffer);
    this.failedDecodes.delete(id);
    const pendingOpts = this.pendingSfx.get(id);
    if (pendingOpts !== undefined) {
      this.pendingSfx.delete(id);
      this.play(id, pendingOpts);
    }
  }

  /**
   * Decodes `id`'s fetched file, then plays whatever was asked of it meanwhile.
   * The decoder detaches the file it is given, so a file a scope keeps is
   * decoded from a copy and every other is dropped here. A release before the
   * decode lands drops the buffer and the plays waiting on it.
   */
  private decodeEncoded(id: SoundId): Promise<void> {
    const generation = this.generationOf(id);
    const running = this.onDemandDecodes.get(id);
    if (running?.generation === generation) return running.decoding;
    const file = this.encoded.get(id);
    if (file === undefined) return Promise.resolve();
    const keepsFile = this.keepsCompressed(id);
    if (!keepsFile) this.encoded.delete(id);
    const decoding = this.ctx
      .decodeAudioData(keepsFile ? file.slice(0) : file)
      .then((buffer) => {
        if (this.generationOf(id) !== generation) {
          this.decodeForWaitingPlay(id);
          return;
        }
        this.storeDecoded(id, buffer);
        const awaiting = this.playsAwaitingDecode.get(id);
        this.playsAwaitingDecode.delete(id);
        if (awaiting !== undefined) this.request(id, awaiting.opts, awaiting.source);
      })
      .catch((err: unknown) => {
        this.failedDecodes.add(id);
        this.playsAwaitingDecode.delete(id);
        console.warn(`[AudioManager] Failed to decode "${id}":`, err);
      })
      .finally(() => {
        if (this.onDemandDecodes.get(id)?.decoding === decoding) this.onDemandDecodes.delete(id);
      });
    this.onDemandDecodes.set(id, { generation, decoding });
    return decoding;
  }

  /**
   * A load or decode made stale by a release drops its result, but a play
   * asked for since the release still wants the sound: decode it afresh from
   * the kept file.
   */
  private decodeForWaitingPlay(id: SoundId): void {
    if (this.hasPlayWaiting(id) && this.encoded.has(id)) void this.decodeEncoded(id);
  }

  /**
   * Bytes held outside the JS heap for sound effects: every decoded buffer's
   * float samples, plus the compressed files kept for on-demand decoding.
   */
  get residentAudioBytes(): number {
    let bytes = 0;
    for (const buffer of this.buffers.values()) {
      bytes += buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
    }
    for (const file of this.encoded.values()) bytes += file.byteLength;
    return bytes;
  }

  /** How many decoded buffers are resident. */
  get decodedBufferCount(): number {
    return this.buffers.size;
  }

  /**
   * Drop decoded buffers for ids no longer needed, so a floor change can shed
   * the previous floor's SFX instead of only ever accumulating them. Skips
   * any id that is mid-playback — as a one-shot, a scope's loop, or the
   * current music track — rather than risk cutting audio off; a skipped id
   * just gets re-decoded on the next `preload` call for its group, which is a
   * fine failure mode.
   */
  releaseSounds(ids: ReadonlyArray<SoundId>): void {
    for (const id of ids) this.releaseSound(id, { keepFile: false });
  }

  /**
   * Drops `id`'s buffer, and its compressed file unless `keepFile`, along with
   * every play still waiting on it; a load or decode under way drops its
   * result. Skipped while the id is sounding or a scope holds it.
   */
  private releaseSound(id: SoundId, { keepFile }: { readonly keepFile: boolean }): void {
    if (this.liveVoices.some((live) => live.id === id)) return;
    if (this.music.currentTrack === id) return;
    if ([...this.scopes].some((scope) => scope.holds(id))) return;
    this.releaseGenerations.set(id, this.generationOf(id) + 1);
    this.currentLoads.delete(id);
    this.buffers.delete(id);
    if (!keepFile) this.encoded.delete(id);
    this.pendingSfx.delete(id);
    this.playsAwaitingDecode.delete(id);
  }

  /**
   * Opens a scope for one scene: every loop and ambient bed the scene starts
   * goes through it, and disposing it when the scene exits fades them all out.
   */
  createScope(): AudioScope {
    return new AudioScope(this.scopeEngine);
  }

  /** The scope each held SFX group declares through, while it is held. */
  private readonly heldGroupScopes = new Map<GatedSfxGroup, AudioScope>();

  /**
   * Keeps `group` decoded or lets it go. A held group outlives the scene that
   * asked for it, so a building's door does not release and then re-decode
   * what the floor outside will want again; letting go releases whatever no
   * scope still declares and no voice is playing.
   */
  holdSfxGroup(group: GatedSfxGroup, held: boolean): void {
    const scope = this.heldGroupScopes.get(group);
    if (held === (scope !== undefined)) return;
    if (scope !== undefined) {
      this.heldGroupScopes.delete(group);
      scope.dispose();
      return;
    }
    const holding = this.createScope();
    this.heldGroupScopes.set(group, holding);
    void holding.preload(SFX_GROUPS[group]);
  }

  /** Whether {@link holdSfxGroup} is keeping `group` decoded. */
  holdsSfxGroup(group: GatedSfxGroup): boolean {
    return this.heldGroupScopes.has(group);
  }

  /**
   * Releases every decoded buffer no live scope declared, except the boot
   * group every scene relies on. Runs as a scope is disposed, by which time
   * the scene replacing it has already declared what it needs.
   */
  private evictUndeclaredSounds(): void {
    const keptDecoded = new Set<SoundId>(CORE_SFX_IDS);
    const keptFiles = new Set<SoundId>();
    for (const scope of this.scopes) {
      for (const id of scope.declared) keptDecoded.add(id);
      for (const id of scope.declaredCompressed) keptFiles.add(id);
    }
    const resident = new Set<SoundId>([
      ...this.buffers.keys(),
      ...this.encoded.keys(),
      ...this.loadsInFlight.keys(),
    ]);
    for (const id of resident) {
      if (keptDecoded.has(id)) continue;
      this.releaseSound(id, { keepFile: keptFiles.has(id) });
    }
  }

  private readonly scopeEngine: ScopeEngine = {
    nowS: () => this.ctx.currentTime,
    canStartVoices: () => this.ctx.state === 'running' && !this.backgrounded,
    startLoopVoice: (id, volume, fadeInMs) => this.startLoopVoice(id, volume, fadeInMs),
    rampVoice: (voice, volume, rampMs) =>
      glideParam(
        voice.gain.gain,
        this.ctx.currentTime,
        volume * (this.loopTrimGains.get(voice) ?? 1),
        rampMs / MS_PER_SECOND,
        'linear',
      ),
    stopVoice: (voice, fadeMs) => this.stopLoopVoice(voice, fadeMs),
    startKeyboardHeroVoice: (offsetS, onEnded) => this.startKeyboardHeroVoice(offsetS, onEnded),
    keyboardHeroSongFailed: () => this.failedDecodes.has(KEYBOARD_HERO_SONG),
    outputLatencyS: () => this.outputLatencySeconds(),
    preload: (ids) => this.preload(ids),
    preloadCompressed: (ids) => this.preloadCompressed(ids),
    attach: (hooks) => {
      this.scopes.add(hooks);
    },
    detach: (hooks) => {
      if (this.scopes.delete(hooks)) this.evictUndeclaredSounds();
    },
    music: {
      claim: (claim, holder) => this.music.claim(claim, holder),
      release: (owner, holder, opts) => this.music.release(owner, holder, opts),
      releaseAll: (holder) => this.music.releaseAll(holder),
      isClaimed: (owner, holder) => this.music.isClaimed(owner, holder),
    },
  };

  private readonly musicEngine: MusicEngine = {
    canPlay: () => this.ctx.state === 'running',
    nowS: () => this.ctx.currentTime,
    startTrack: (request) => this.startMusicTrack(request),
  };

  /**
   * Which creatures may be heard, or null for all of them. A battle with
   * dozens of attackers sets one so their cries, blows and deaths do not
   * pile into a single roar.
   */
  private creatureHearing: ((mob: Mob) => boolean) | null = null;

  /** Installs the rule {@link hearsCreature} answers by; null hears every creature. */
  setCreatureHearing(rule: ((mob: Mob) => boolean) | null): void {
    this.creatureHearing = rule;
  }

  /** Whether a sound this creature makes should play. */
  hearsCreature(mob: Mob): boolean {
    return this.creatureHearing?.(mob) ?? true;
  }

  /** Play a one-shot sound effect. Silently skips if the buffer is not yet loaded. */
  play(id: SoundId, opts: PlayOptions = {}): void {
    this.request(id, opts, null);
  }

  /**
   * Plays a one-shot from a point in the world, heard from the active
   * crawler (see {@link setListener}): quieter with distance, panned toward
   * its side, and dropped before it takes a voice when it is beyond the id's
   * `hearingTiles`. For the world's own sounds; the interface, the party's
   * own cues and stings use {@link play}. `reach: 'panOnly'` keeps the side
   * but drops the distance: for a sound that must carry however far off it
   * is, a boss's telegraph or the party's own shot landing.
   */
  playAt(
    id: SoundId,
    worldX: number,
    worldY: number,
    opts: PlayOptions = {},
    reach: PlacedReach = 'hearing',
  ): void {
    const placed = this.placeAt(id, worldX, worldY, opts, reach);
    if (placed !== null) this.request(id, placed, { x: worldX, y: worldY });
  }

  /** {@link playRandom} from a point in the world, as {@link playAt} places it. */
  playRandomAt(
    ids: ReadonlyArray<SoundId>,
    worldX: number,
    worldY: number,
    opts: PlayOptions = {},
    reach: PlacedReach = 'hearing',
  ): void {
    const take = this.pickFreshTake(ids);
    if (take !== null) this.playAt(take, worldX, worldY, opts, reach);
  }

  /** A player whose cues all come from `(worldX, worldY)`, as {@link playAt} places them. */
  placedAt(worldX: number, worldY: number, reach: PlacedReach = 'hearing'): PlacedCuePlayer {
    return {
      play: (id, opts) => this.playAt(id, worldX, worldY, opts, reach),
      playRandom: (ids, opts) => this.playRandomAt(ids, worldX, worldY, opts, reach),
    };
  }

  /**
   * Where {@link playAt} hears from, in world pixels: the active crawler's
   * centre. Scenes set it every frame; until one does, placed sounds play as
   * if beside the listener.
   */
  setListener(worldX: number, worldY: number): void {
    const listener = this.listener;
    if (listener !== null && listener.x === worldX && listener.y === worldY) return;
    this.listener = { x: worldX, y: worldY };
  }

  /** {@link setListener} for a crawler, by the top-left corner of its tile. */
  setListenerToCrawler(crawler: WorldPoint): void {
    this.setListener(
      crawler.x + TILE_SIZE * TILE_CENTRE_FRACTION,
      crawler.y + TILE_SIZE * TILE_CENTRE_FRACTION,
    );
  }

  /**
   * Runs `listener` for every one-shot that starts, and every loop a scope
   * starts, with where a placed one came from, so a caption can say what was
   * heard and point at it. Returns the unsubscribe.
   */
  onCuePlayed(listener: (cue: PlayedCue) => void): () => void {
    this.cueListeners.add(listener);
    return () => {
      this.cueListeners.delete(listener);
    };
  }

  private reportCue(cue: PlayedCue): void {
    for (const listener of this.cueListeners) listener(cue);
  }

  /** `opts` with distance and side applied, or null when the sound is out of earshot. */
  private placeAt(
    id: SoundId,
    worldX: number,
    worldY: number,
    opts: PlayOptions,
    reach: PlacedReach,
  ): PlayOptions | null {
    const listener = this.listener;
    if (listener === null) return opts;
    const dxTiles = (worldX - listener.x) / TILE_SIZE;
    if (reach === 'panOnly') return { ...opts, pan: placedPan(dxTiles) };
    const dyTiles = (worldY - listener.y) / TILE_SIZE;
    const distanceTiles = Math.hypot(dxTiles, dyTiles);
    const traits = soundTraits(id);
    const distant = traits.distantWhenOffscreen;
    const heardAsDistant = distant !== null && !isWorldPointInView(worldX, worldY, 0);
    const level = heardAsDistant
      ? placedGain(distanceTiles, distant.hearingTiles) * distant.gainScale
      : placedGain(distanceTiles, traits.hearingTiles);
    const volume = (opts.volume ?? 1) * level;
    if (volume < PLACED_AUDIBLE_GAIN) return null;
    const placed = { ...opts, volume, pan: placedPan(dxTiles) };
    return heardAsDistant ? { ...placed, lowpassHz: distant.lowpassHz } : placed;
  }

  private request(id: SoundId, opts: PlayOptions, source: WorldPoint | null): void {
    const buffer = this.buffers.get(id);
    if (!buffer) {
      const generation = this.generationOf(id);
      const fileOnTheWay =
        this.currentLoads.has(id) || this.onDemandDecodes.get(id)?.generation === generation;
      if (this.encoded.has(id) || fileOnTheWay) {
        this.warnGatedFallback(id);
        this.playsAwaitingDecode.set(id, { id, opts, source });
        void this.decodeEncoded(id);
        return;
      }
      // Work begun before a release drops what it brings, so this play starts its own.
      if (this.loadsInFlight.has(id)) {
        this.warnGatedFallback(id);
        this.playsAwaitingDecode.set(id, { id, opts, source });
        void this.load(id, 'compressed');
        return;
      }
      this.warnNeverPreloaded(id);
      return;
    }
    // A one-shot belongs to the moment it was cued. The world keeps ticking
    // while the window is blurred, so queueing here would bank every moo and
    // footstep and fire them all at once on return.
    if (this.backgrounded) return;
    if (this.ctx.state !== 'running') {
      // One take per sound, whatever its volume: everything queued here fires on
      // the same frame the first gesture unlocks audio, and a second copy of a
      // sound on that frame is only the first one louder.
      const alreadyQueued = this.pendingOnUnlock.some((pending) => pending.id === id);
      if (!alreadyQueued) this.pendingOnUnlock.push({ id, opts, source });
      return;
    }

    this.startSource(id, buffer, opts, source);
  }

  /**
   * A gated group's id played before its group was decoded still sounds,
   * decoded from its kept file a few milliseconds late; dev builds name it
   * once, since the gate should have held the group in time.
   */
  private warnGatedFallback(id: SoundId): void {
    if (!WARNS_ON_MISSING_BUFFER || ON_DEMAND_SOUND_IDS.has(id) || !GATED_SFX_IDS.has(id)) return;
    if (this.gatedFallbackWarned.has(id)) return;
    this.gatedFallbackWarned.add(id);
    console.warn(
      `[AudioManager] "${id}" played before its gated group decoded; decoding on demand`,
    );
  }

  /**
   * A cue whose id is in no preload group the scene declared never sounds and
   * raises no error, so dev builds name it once. An id still decoding is not
   * reported: its buffer is on the way.
   */
  private warnNeverPreloaded(id: SoundId): void {
    if (!WARNS_ON_MISSING_BUFFER) return;
    if (this.preloadRequested.has(id) || this.missingBufferWarned.has(id)) return;
    this.missingBufferWarned.add(id);
    console.warn(`[AudioManager] "${id}" was played but no SFX group preloads it here`);
  }

  /**
   * Plays a one-shot this instant or not at all, and returns the audio-clock
   * time it started at (see {@link clockSeconds}), or null when it did not
   * play: not decoded, the page backgrounded, the context not running, or
   * refused a voice. It is never queued for later — for a sound something on
   * screen is timed to, where a cue arriving seconds late would be worse than none.
   */
  playNow(id: SoundId, opts: PlayOptions = {}): number | null {
    const buffer = this.buffers.get(id);
    if (!buffer || this.backgrounded || this.ctx.state !== 'running') return null;
    return this.startSource(id, buffer, opts, null);
  }

  /**
   * The audio clock, in seconds. It stops while the context is suspended or
   * interrupted, as the sounds do, so a picture timed to a sound off this
   * clock pauses and resumes with it.
   */
  get clockSeconds(): number {
    return this.ctx.currentTime;
  }

  /** How many one-shots are sounding now, not counting ones already fading out; for the gates. */
  get liveVoiceCount(): number {
    return this.liveVoices.filter((live) => !live.stopping).length;
  }

  private oneShotBus(bus: OneShotBus | undefined): GainNode {
    return bus === 'ui' ? this.uiGain : this.sfxGain;
  }

  /**
   * Makes room for one more voice of `id` at `rank`: drops it when the id
   * started too recently, stops its oldest copy past the id's cap, and past
   * {@link GLOBAL_VOICE_LIMIT} steals the oldest voice of the lowest rank at
   * or below its own. False when the sound must not play.
   */
  private claimVoice(id: SoundId, traits: SoundTraits, rank: number): boolean {
    const nowS = this.ctx.currentTime;
    const lastS = this.lastStartS.get(id);
    if (lastS !== undefined && (nowS - lastS) * MS_PER_SECOND < traits.minIntervalMs) return false;

    const sounding = this.liveVoices.filter((live) => !live.stopping);
    const copies = sounding.filter((live) => live.id === id);
    const excessCopies = copies.length - traits.maxVoices + 1;
    for (let i = 0; i < excessCopies; i++) this.stealVoice(copies[i]);
    const soundingAfterCopies = sounding.length - Math.max(0, excessCopies);
    if (soundingAfterCopies < GLOBAL_VOICE_LIMIT) return true;

    let victim: LiveVoice | null = null;
    for (const live of this.liveVoices) {
      if (live.stopping || live.rank > rank) continue;
      if (victim === null || live.rank < victim.rank) victim = live;
    }
    if (victim === null) return false;
    this.stealVoice(victim);
    return true;
  }

  private stealVoice(live: LiveVoice): void {
    live.stopping = true;
    stopVoice(this.ctx, live.voice, VOICE_STEAL_FADE_MS, { onStopped: live.release });
  }

  private lowpassInto(destination: AudioNode, cutoffHz: number): BiquadFilterNode {
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoffHz;
    filter.Q.value = DISTANT_LOWPASS_Q;
    filter.connect(destination);
    return filter;
  }

  /**
   * Starts `buffer` now on its bus, varied and limited by the id's traits;
   * returns the audio-clock time it started at, or null when it was refused a voice.
   */
  private startSource(
    id: SoundId,
    buffer: AudioBuffer,
    opts: PlayOptions,
    placedFrom: WorldPoint | null,
  ): number | null {
    const traits = soundTraits(id);
    const rank = SOUND_PRIORITY_RANK[opts.bus === 'ui' ? 'high' : traits.priority];
    if (!this.claimVoice(id, traits, rank)) return null;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const rate = jittered(opts.playbackRate ?? 1, traits.pitchJitter);
    source.playbackRate.value = rate;

    const { pan } = opts;
    const bus = this.oneShotBus(opts.bus);
    const panner = pan !== undefined && pan !== 0 ? this.ctx.createStereoPanner() : null;
    if (panner !== null) {
      panner.pan.value = Math.max(-1, Math.min(1, pan ?? 0));
      panner.connect(bus);
    }
    const volume = jittered(opts.volume ?? 1, traits.volumeJitter);
    const level = volume * dbToGain(loudnessTrimDb(id));
    const gain = this.ctx.createGain();
    gain.gain.value = level;
    source.connect(gain);
    const { lowpassHz } = opts;
    const filter = lowpassHz === undefined ? null : this.lowpassInto(panner ?? bus, lowpassHz);
    gain.connect(filter ?? panner ?? bus);

    const voice: BufferVoice = { kind: 'buffer', source, gain };
    const live: LiveVoice = {
      id,
      voice,
      rank,
      traits,
      stopping: false,
      release: () => {
        gain.disconnect();
        filter?.disconnect();
        panner?.disconnect();
        const index = this.liveVoices.indexOf(live);
        if (index !== -1) this.liveVoices.splice(index, 1);
        this.releaseStingerDuck(live);
      },
    };
    this.liveVoices.push(live);
    source.onended = live.release;

    const startedAt = this.ctx.currentTime;
    this.lastStartS.set(id, startedAt);
    const startOffset = opts.startOffset ?? 0;
    source.start(startedAt, startOffset);
    const fadeOut = opts.fadeOut;
    if (fadeOut !== undefined) {
      const fadeFrom = startedAt + Math.max(0, fadeOut.atS - startOffset) / rate;
      const fadeTo = fadeFrom + fadeOut.durationS / rate;
      gain.gain.setValueAtTime(level, fadeFrom);
      gain.gain.linearRampToValueAtTime(0, fadeTo);
      source.stop(fadeTo);
    }
    this.applyStingerDuck(live);
    this.reportCue({ id, source: placedFrom });
    return startedAt;
  }

  /** A sting holds the music down for as long as it sounds. */
  private applyStingerDuck(live: LiveVoice): void {
    if (live.traits.duckMusic === null) return;
    this.duckingStingers.add(live);
    this.duckMusic('stinger', this.stingerDuckLevel, STINGER_DUCK_ATTACK_MS);
  }

  private releaseStingerDuck(live: LiveVoice): void {
    if (!this.duckingStingers.delete(live)) return;
    const releaseMs = live.traits.duckMusic?.releaseMs ?? MUSIC_DUCK_RAMP_MS;
    if (this.duckingStingers.size === 0) {
      this.unduckMusic('stinger', releaseMs);
      return;
    }
    this.duckMusic('stinger', this.stingerDuckLevel, releaseMs);
  }

  /** The deepest duck any sounding sting asks for, as a gain. */
  private get stingerDuckLevel(): number {
    let deepestDb = 0;
    for (const live of this.duckingStingers) {
      deepestDb = Math.min(deepestDb, live.traits.duckMusic?.depthDb ?? 0);
    }
    return dbToGain(deepestDb);
  }

  /** Stop every copy of a playing one-shot at once (a click-free minimum fade). No-op if none is playing. */
  stopSound(id: SoundId): void {
    this.fadeOutSound(id, MIN_STOP_FADE_MS);
  }

  /**
   * Stops every copy of a playing one-shot over `fadeMs` rather than dead,
   * for a long cue a skip has to cut (the slot machine's jackpot siren).
   */
  fadeOutSound(id: SoundId, fadeMs: number): void {
    this.playsAwaitingDecode.delete(id);
    this.pendingSfx.delete(id);
    for (const live of this.liveVoices) {
      if (live.id !== id || live.stopping) continue;
      live.stopping = true;
      stopVoice(this.ctx, live.voice, fadeMs, { onStopped: live.release });
    }
  }

  /**
   * Play a one-shot sound as soon as its buffer is ready.
   * If the buffer is already loaded, plays immediately (same as `play`).
   * Otherwise queues it so the preload loop fires it the moment decoding finishes.
   */
  playWhenReady(id: SoundId, opts: PlayOptions = {}): void {
    if (this.buffers.has(id)) {
      this.play(id, opts);
    } else {
      this.pendingSfx.set(id, opts);
      void this.decodeEncoded(id);
    }
  }

  /** The take each variant set last played, keyed by the set's first id. */
  private readonly lastTakeOfSet = new Map<SoundId, SoundId>();

  /**
   * Plays one of `ids` at random, never the take the same set played last:
   * one recording twice running is heard as a stutter rather than as the
   * same sound again.
   */
  playRandom(ids: ReadonlyArray<SoundId>, opts: PlayOptions = {}): void {
    const take = this.pickFreshTake(ids);
    if (take !== null) this.play(take, opts);
  }

  /**
   * {@link playRandom} through {@link playWhenReady}: the picked take waits
   * for its buffer instead of being dropped — for a cue raised as a room
   * opens, before its group has finished decoding.
   */
  playRandomWhenReady(ids: ReadonlyArray<SoundId>, opts: PlayOptions = {}): void {
    const take = this.pickFreshTake(ids);
    if (take !== null) this.playWhenReady(take, opts);
  }

  private pickFreshTake(ids: ReadonlyArray<SoundId>): SoundId | null {
    if (ids.length === 0) return null;
    const setKey = ids[0];
    const last = this.lastTakeOfSet.get(setKey);
    const fresh = ids.length > 1 ? ids.filter((id) => id !== last) : ids;
    const take = fresh[Math.floor(Math.random() * fresh.length)];
    this.lastTakeOfSet.set(setKey, take);
    return take;
  }

  /**
   * Starts a track for the director on the music bus at its measured trim,
   * fading in on the equal-power curve the outgoing track fades out on.
   *
   * The music bus carries one track at a time, crossfades aside: any earlier
   * track the director has not stopped is faded out under this one first, so
   * a voice the director lost hold of can never play alongside its successor.
   */
  private startMusicTrack(request: MusicTrackRequest): MusicTrackHandle {
    for (const stray of [...this.unstoppedMusicTracks]) {
      stray.stop(request.fadeInMs, 'equalPowerOut');
    }
    const handle = this.startMusicVoice(request);
    const tracked: MusicTrackHandle = {
      positionS: () => handle.positionS(),
      stop: (fadeMs, shape) => {
        this.unstoppedMusicTracks.delete(tracked);
        handle.stop(fadeMs, shape);
      },
      hold: () => handle.hold(),
      release: () => handle.release(),
    };
    this.unstoppedMusicTracks.add(tracked);
    return tracked;
  }

  private startMusicVoice(request: MusicTrackRequest): MusicTrackHandle {
    const trimGain = dbToGain(loudnessTrimDb(request.id));
    if (STREAMING_SOUND_IDS.has(request.id)) {
      return this.startStreamingMusicTrack(request, trimGain);
    }
    const buffer = this.buffers.get(request.id);
    if (buffer !== undefined) return this.startDecodedMusicTrack(request, buffer, trimGain);
    return this.startMusicTrackOnceDecoded(request, trimGain);
  }

  /**
   * A decoded song whose buffer is not resident — the keyboard-hero song away
   * from the floor that decodes it — is fetched and starts once decoded,
   * unless it was stopped first. While it is the director's track no eviction
   * releases it. A song that cannot load reports itself unavailable.
   */
  private startMusicTrackOnceDecoded(
    request: MusicTrackRequest,
    trimGain: number,
  ): MusicTrackHandle {
    let started: MusicTrackHandle | null = null;
    let stopped = false;
    let heldBeforeStart = false;
    void this.preload([request.id]).then(() => {
      if (stopped) return;
      const decoded = this.buffers.get(request.id);
      if (decoded === undefined) {
        request.onUnavailable();
        return;
      }
      const handle = this.startDecodedMusicTrack(request, decoded, trimGain);
      if (heldBeforeStart) handle.hold();
      started = handle;
    });
    return {
      positionS: () => started?.positionS() ?? request.offsetS,
      stop: (fadeMs, shape) => {
        stopped = true;
        started?.stop(fadeMs, shape);
      },
      hold: () => {
        heldBeforeStart = true;
        started?.hold();
      },
      release: () => {
        heldBeforeStart = false;
        started?.release();
      },
    };
  }

  private startDecodedMusicTrack(
    request: MusicTrackRequest,
    buffer: AudioBuffer,
    trimGain: number,
  ): MusicTrackHandle {
    const loops = request.loop !== 'once';
    const loopStartS = request.loop === 'loopPoint' ? (musicLoopStartS(request.id) ?? 0) : 0;
    let stopped = false;
    let heldAtS: number | null = null;
    const startSegment = (offsetS: number): { voice: BufferVoice; startedAtS: number } => {
      const voice = this.startDecodedMusicSegment(request, buffer, trimGain, offsetS, () => {
        if (!stopped) request.onEnded();
      });
      return { voice, startedAtS: this.ctx.currentTime };
    };
    let segment = startSegment(request.offsetS);
    let segmentOffsetS = request.offsetS;
    // A gesture starts a waiting track before its resume() settles, and that
    // resume can be refused, so the track counts as sounding only once the
    // context really renders.
    this.onRunning(() => {
      if (!stopped) request.onPlaying();
    });
    const positionS = (): number => {
      if (heldAtS !== null) return heldAtS;
      const elapsedS = segmentOffsetS + this.ctx.currentTime - segment.startedAtS;
      return loops ? loopedPositionS(elapsedS, buffer.duration, loopStartS) : elapsedS;
    };
    return {
      positionS,
      stop: (fadeMs, shape) => {
        if (stopped) return;
        stopped = true;
        if (heldAtS !== null) return;
        stopVoice(this.ctx, segment.voice, fadeMs, { shape });
      },
      hold: () => {
        if (stopped || heldAtS !== null) return;
        heldAtS = positionS();
        stopVoice(this.ctx, segment.voice, MIN_STOP_FADE_MS);
      },
      release: () => {
        if (heldAtS === null) return;
        const resumeAtS = heldAtS;
        heldAtS = null;
        if (stopped) return;
        segmentOffsetS = resumeAtS;
        segment = startSegment(resumeAtS);
      },
    };
  }

  /**
   * One run of a decoded song from `offsetS`, on a gain of its own fading in
   * to `trimGain`. A held song is restarted as a fresh run, since a buffer
   * source cannot be paused.
   */
  private startDecodedMusicSegment(
    request: MusicTrackRequest,
    buffer: AudioBuffer,
    trimGain: number,
    offsetS: number,
    onEnded: () => void,
  ): BufferVoice {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    this.fadeInMusicGain(gain, request.fadeInMs, trimGain);
    gain.connect(this.musicGain);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = request.loop !== 'once';
    if (request.loop === 'loopPoint') {
      source.loopStart = musicLoopStartS(request.id) ?? 0;
      source.loopEnd = buffer.duration;
    }
    source.connect(gain);
    source.onended = () => {
      gain.disconnect();
      onEnded();
    };
    source.start(0, offsetS);
    return { kind: 'buffer', source, gain };
  }

  /**
   * Brings a new track's gain up from silence to `level` on the equal-power
   * curve that matches the outgoing track's fade. Never instant: even an
   * unfaded start takes the minimum ramp, since a track can start mid-waveform.
   */
  private fadeInMusicGain(gain: GainNode, fadeInMs: number, level: number): void {
    const rampS = Math.max(MIN_STOP_FADE_MS, fadeInMs) / MS_PER_SECOND;
    gain.gain.cancelScheduledValues(this.ctx.currentTime);
    gain.gain.value = 0;
    glideParam(gain.gain, this.ctx.currentTime, level, rampS, 'equalPowerIn');
  }

  /**
   * A slot for a new streamed track: an idle one, a new one while under
   * {@link MUSIC_STREAM_SLOT_LIMIT}, or else the quietest fading one, which
   * is `stolen` and must be faded out before it can be repointed.
   */
  private acquireMusicSlot(): { readonly slot: MusicStreamSlot; readonly stolen: boolean } {
    const idle = this.musicStreamSlots.find((slot) => slot.state === 'idle');
    if (idle !== undefined) return { slot: idle, stolen: false };
    if (this.musicStreamSlots.length < MUSIC_STREAM_SLOT_LIMIT) {
      const el = new Audio();
      const gain = this.ctx.createGain();
      this.ctx.createMediaElementSource(el).connect(gain);
      gain.connect(this.musicGain);
      const slot: MusicStreamSlot = {
        el,
        gain,
        gen: 0,
        state: 'idle',
        awaitingStart: false,
        refusedPlay: false,
        held: false,
        onPlaying: null,
      };
      el.addEventListener('playing', () => slot.onPlaying?.());
      this.musicStreamSlots.push(slot);
      return { slot, stolen: false };
    }
    const quietest = this.musicStreamSlots
      .filter((slot) => slot.state === 'fading')
      .reduce<MusicStreamSlot | null>(
        (best, slot) =>
          best === null || slot.gain.gain.value < best.gain.gain.value ? slot : best,
        null,
      );
    return { slot: quietest ?? this.musicStreamSlots[0], stolen: true };
  }

  /**
   * Start a streamed music track on a slot of its own, so every track still
   * fading out keeps playing through the crossfade. The element's `playing`
   * event, scoped to this track's claim on the slot, is what reports it audible.
   */
  private startStreamingMusicTrack(request: MusicTrackRequest, trimGain: number): MusicTrackHandle {
    const { slot, stolen } = this.acquireMusicSlot();
    const gen = ++slot.gen;
    slot.state = 'playing';
    slot.held = false;
    const { el, gain } = slot;
    let stopped = false;
    let begun = false;
    const ownsSlot = (): boolean => slot.gen === gen;
    slot.onPlaying = () => {
      if (ownsSlot() && !stopped) request.onPlaying();
    };

    const begin = (): void => {
      slot.awaitingStart = false;
      if (!ownsSlot() || stopped) return;
      const loopStartS = request.loop === 'loopPoint' ? musicLoopStartS(request.id) : undefined;
      // A media element's own `loop` always restarts at zero, so a track with a
      // later loop point plays through once and seeks back on `ended` instead.
      el.loop =
        request.loop === 'whole' || (request.loop === 'loopPoint' && loopStartS === undefined);
      el.onended =
        loopStartS !== undefined
          ? () => {
              if (!ownsSlot()) return;
              el.currentTime = loopStartS;
              this.playStream(el, slot, (err) => {
                console.warn(`[AudioManager] Failed to loop streaming music "${request.id}":`, err);
              });
            }
          : request.loop === 'once'
            ? () => {
                if (!ownsSlot() || stopped) return;
                // An ended element is paused at its end, and play() on it starts
                // the song over, so the slot must not stay `playing` for
                // restartStalledStreams to wake.
                stopped = true;
                slot.state = 'idle';
                request.onEnded();
              }
            : null;
      el.src = SOUND_MANIFEST[request.id];
      el.currentTime = request.offsetS;
      begun = true;
      this.fadeInMusicGain(gain, request.fadeInMs, trimGain);
      if (slot.held) return;
      this.playStream(el, slot, (err) => {
        console.warn(`[AudioManager] Failed to play streaming music "${request.id}":`, err);
      });
    };

    if (!stolen) {
      begin();
    } else {
      // Every slot is still sounding: the quietest is faded the rest of the way
      // and paused before it is repointed, and the new track comes in after it
      // unless it was itself stopped in the meantime.
      slot.awaitingStart = true;
      el.onended = null;
      glideParam(gain.gain, this.ctx.currentTime, 0, MIN_STOP_FADE_MS / MS_PER_SECOND, 'db');
      window.setTimeout(() => {
        if (!ownsSlot()) return;
        el.pause();
        if (stopped) {
          slot.awaitingStart = false;
          slot.state = 'idle';
          return;
        }
        begin();
      }, MIN_STOP_FADE_MS + STREAM_PAUSE_SLACK_MS);
    }

    return {
      positionS: () => (ownsSlot() && !slot.awaitingStart ? el.currentTime : request.offsetS),
      hold: () => {
        if (!ownsSlot() || stopped) return;
        slot.held = true;
        if (begun) el.pause();
      },
      release: () => {
        if (!ownsSlot() || !slot.held) return;
        slot.held = false;
        if (stopped || !begun || el.ended) return;
        // A suspended graph would let the element run on unheard, maybe to its
        // end; restartStalledStreams wakes it once the context really runs.
        if (this.ctx.state !== 'running') return;
        this.playStream(el, slot, (err) => {
          console.warn(`[AudioManager] Failed to resume streaming music "${request.id}":`, err);
        });
      },
      stop: (fadeMs, shape) => {
        if (stopped) return;
        stopped = true;
        if (!ownsSlot()) return;
        slot.held = false;
        slot.state = 'fading';
        if (slot.awaitingStart) return;
        stopVoice(this.ctx, { kind: 'stream', el, gain }, fadeMs, {
          shape,
          // A slot stolen by a newer track while this fade ran belongs to it now.
          stillOwnsElement: ownsSlot,
          onStopped: () => {
            slot.state = 'idle';
          },
        });
      },
    };
  }

  /**
   * Starts a scope's loop voice on the ambience bus at `volume` on top of its
   * measured trim, or returns null when its buffer has not decoded yet or
   * every pooled element is busy.
   */
  private startLoopVoice(id: SoundId, volume: number, fadeInMs: number): Voice | null {
    const trimGain = dbToGain(loudnessTrimDb(id));
    const voice = this.startLoopVoiceAtLevel(id, volume * trimGain, fadeInMs);
    if (voice === null) return null;
    this.loopTrimGains.set(voice, trimGain);
    this.reportCue({ id, source: null });
    return voice;
  }

  /**
   * Each loop voice's loudness trim as a gain, so a scope ramping it to a new
   * volume lands on the same levelled scale it started on. A pooled element's
   * voice is reused, and its entry is replaced as each bed starts.
   */
  private readonly loopTrimGains = new WeakMap<Voice, number>();

  private startLoopVoiceAtLevel(id: SoundId, level: number, fadeInMs: number): Voice | null {
    const rampS = Math.max(MIN_STOP_FADE_MS, fadeInMs) / MS_PER_SECOND;
    if (STREAMING_SOUND_IDS.has(id)) {
      const pooled = this.acquireAmbientStream();
      if (pooled === null) return null;
      const { el, gain } = pooled.voice;
      el.loop = true;
      el.src = SOUND_MANIFEST[id];
      el.currentTime = 0;
      gain.gain.cancelScheduledValues(this.ctx.currentTime);
      gain.gain.value = 0;
      glideParam(gain.gain, this.ctx.currentTime, level, rampS, 'db');
      this.playStream(el, pooled, (err) => {
        console.warn(`[AudioManager] Failed to play streaming ambient loop "${id}":`, err);
      });
      pooled.state = 'playing';
      return pooled.voice;
    }
    const buffer = this.buffers.get(id);
    if (!buffer) return null;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    glideParam(gain.gain, this.ctx.currentTime, level, rampS, 'db');
    gain.connect(this.ambienceGain);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    return { kind: 'buffer', source, gain };
  }

  /** An idle pooled element for an ambient bed, made on first need; null when all are busy. */
  private acquireAmbientStream(): PooledStream | null {
    const idle = this.ambientStreamPool.find((pooled) => pooled.state === 'idle');
    if (idle !== undefined) return idle;
    if (this.ambientStreamPool.length >= AMBIENT_STREAM_POOL_SIZE) return null;
    const el = new Audio();
    const gain = this.ctx.createGain();
    this.ctx.createMediaElementSource(el).connect(gain);
    gain.connect(this.ambienceGain);
    const pooled: PooledStream = {
      voice: { kind: 'stream', el, gain },
      state: 'idle',
      refusedPlay: false,
    };
    this.ambientStreamPool.push(pooled);
    return pooled;
  }

  private stopLoopVoice(voice: Voice, fadeMs: number): void {
    const pooled = this.ambientStreamPool.find((entry) => entry.voice === voice);
    if (pooled === undefined) {
      stopVoice(this.ctx, voice, fadeMs);
      return;
    }
    pooled.state = 'stopping';
    stopVoice(this.ctx, voice, fadeMs, {
      onStopped: () => {
        pooled.state = 'idle';
      },
    });
  }

  /**
   * Starts the keyboard-hero song on the music bus, so the music slider
   * governs it, `offsetS` into the recording. Null until its buffer decodes.
   */
  private startKeyboardHeroVoice(offsetS: number, onEnded: () => void): BufferVoice | null {
    const buffer = this.buffers.get(KEYBOARD_HERO_SONG);
    if (!buffer) return null;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    glideParam(
      gain.gain,
      this.ctx.currentTime,
      dbToGain(loudnessTrimDb(KEYBOARD_HERO_SONG)),
      MIN_STOP_FADE_MS / MS_PER_SECOND,
      'linear',
    );
    gain.connect(this.musicGain);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = false;
    source.connect(gain);
    source.onended = () => {
      gain.disconnect();
      onEnded();
    };
    source.start(0, offsetS);
    this.music.heldVoiceStarted(KEYBOARD_HERO_SONG);
    return { kind: 'buffer', source, gain };
  }

  /**
   * `outputLatency` is typed as always present but is unimplemented in some browsers,
   * where it reads back as undefined; the base latency is the honest floor there.
   */
  private outputLatencySeconds(): number {
    const reported = this.ctx.outputLatency;
    return Number.isFinite(reported) ? reported : this.ctx.baseLatency;
  }

  private readonly musicPauseReasons = new Set<MusicPauseReason>();
  private readonly ambiencePauseReasons = new Set<MusicPauseReason>();

  /**
   * Fade every continuous world sound out (e.g. when the pause menu opens):
   * footsteps, wading, spider steps, machinery and every distance-attenuated
   * ambient bed. One-shot SFX are untouched, so menu clicks still play while
   * the world is silent. Idempotent per reason.
   *
   * The loops keep running behind a muted bus rather than being stopped: several
   * of them (machinery) are started by one-off events and would never come back
   * if they were torn down here.
   */
  pauseAmbience(reason: MusicPauseReason = 'menu'): void {
    const wasSilenced = this.ambiencePauseReasons.size > 0;
    this.ambiencePauseReasons.add(reason);
    if (wasSilenced) return;
    this.rampBus(this.ambienceGain, 0, MENU_AMBIENCE_FADE_MS);
  }

  /** Fade the continuous world sounds back in once every reason has cleared. Idempotent per reason. */
  resumeAmbience(reason: MusicPauseReason = 'menu'): void {
    this.ambiencePauseReasons.delete(reason);
    if (this.ambiencePauseReasons.size > 0) return;
    this.rampBus(this.ambienceGain, this.openAmbienceBusLevel, MENU_AMBIENCE_FADE_MS);
  }

  private readonly effectsHushReasons = new Set<EffectsHushReason>();

  /**
   * Fade the sound-effects bus to silence until every reason has let go.
   * The `ui` bus is left alone on purpose: it is the one bus a celebration
   * can still speak on while the world's own effects are hushed under it.
   */
  hushEffects(reason: EffectsHushReason, fadeMs: number): void {
    const wasHushed = this.effectsHushReasons.size > 0;
    this.effectsHushReasons.add(reason);
    if (wasHushed) return;
    this.rampBus(this.sfxGain, 0, fadeMs);
  }

  /** Fade the sound-effects bus back to the player's level once every reason has cleared. */
  unhushEffects(reason: EffectsHushReason, fadeMs: number): void {
    if (!this.effectsHushReasons.delete(reason)) return;
    if (this.effectsHushReasons.size > 0) return;
    this.rampBus(this.sfxGain, this.openSfxBusLevel, fadeMs);
  }

  /** Where the sound-effects bus sits: silent while hushed, else the Effects slider's level. */
  private get openSfxBusLevel(): number {
    return this.effectsHushReasons.size > 0 ? 0 : sliderGain(this.sfxVol);
  }

  private readonly musicDuckLevels = new Map<MusicDuckReason, number>();

  /** Fade music out quickly (e.g. when a menu opens). Idempotent per reason. */
  pauseMusic(reason: MusicPauseReason = 'menu', fadeMs = MENU_MUSIC_FADE_MS): void {
    const wasSilenced = this.musicPauseReasons.size > 0;
    const wasHolding = this.anyMusicHoldReason();
    this.musicPauseReasons.add(reason);
    if (!wasHolding && MUSIC_HOLD_REASONS.has(reason)) this.scheduleMusicHold(fadeMs);
    if (wasSilenced) return;
    this.rampBus(this.musicGain, 0, fadeMs);
  }

  /**
   * Fade music back in once every reason that silenced it has cleared, to the
   * ducked level when a duck is still active. Idempotent per reason.
   */
  resumeMusic(reason: MusicPauseReason = 'menu', fadeMs = MENU_MUSIC_FADE_MS): void {
    this.musicPauseReasons.delete(reason);
    if (!this.anyMusicHoldReason()) this.releaseMusicHold();
    if (this.musicPauseReasons.size > 0) return;
    this.rampBus(this.musicGain, this.openMusicBusLevel, fadeMs);
  }

  private anyMusicHoldReason(): boolean {
    for (const reason of this.musicPauseReasons) {
      if (MUSIC_HOLD_REASONS.has(reason)) return true;
    }
    return false;
  }

  /** Bumped whenever a hold is scheduled or let go, so a hold timer outrun by a resume does nothing. */
  private musicHoldGen = 0;
  private musicHoldApplied = false;

  /** Holds the music once the bus has faded to silence, so the hold itself is never heard. */
  private scheduleMusicHold(fadeMs: number): void {
    const gen = ++this.musicHoldGen;
    window.setTimeout(() => {
      if (gen !== this.musicHoldGen) return;
      this.musicHoldApplied = true;
      this.music.hold();
    }, fadeMs);
  }

  /** Lets the held music carry on before the bus comes back up, so it restarts under the fade-in. */
  private releaseMusicHold(): void {
    this.musicHoldGen++;
    if (!this.musicHoldApplied) return;
    this.musicHoldApplied = false;
    this.music.releaseHold();
  }

  /**
   * Hold the music at `level` (0–1 gain) of the player's music volume until
   * {@link unduckMusic} lets go of `reason`. Calling again for the same reason
   * moves it to the new level. While any pause reason is active the bus stays
   * silent, and the duck is what it comes back to. The player's own volume
   * setting is never touched.
   */
  duckMusic(reason: MusicDuckReason, level: number, rampMs = MUSIC_DUCK_RAMP_MS): void {
    const clampedLevel = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 1;
    this.musicDuckLevels.set(reason, clampedLevel);
    if (this.musicPauseReasons.size > 0) return;
    this.rampBus(this.musicGain, this.openMusicBusLevel, rampMs);
  }

  /** Release one duck; the bus settles on whatever the remaining ducks allow. */
  unduckMusic(reason: MusicDuckReason, rampMs = MUSIC_DUCK_RAMP_MS): void {
    if (!this.musicDuckLevels.delete(reason)) return;
    if (this.musicPauseReasons.size > 0) return;
    this.rampBus(this.musicGain, this.openMusicBusLevel, rampMs);
  }

  private get musicDuckLevel(): number {
    let lowest = 1;
    for (const level of this.musicDuckLevels.values()) lowest = Math.min(lowest, level);
    return lowest;
  }

  /** Where the master bus sits when the page is in the foreground. */
  private get masterBusLevel(): number {
    return this.mutedPreference ? 0 : sliderGain(this.masterVol);
  }

  /** Where the music bus sits when nothing is silencing it. */
  private get openMusicBusLevel(): number {
    return sliderGain(this.musicVol) * this.musicDuckLevel;
  }

  /** Where the ambience bus sits when nothing is silencing it. */
  private get openAmbienceBusLevel(): number {
    return sliderGain(this.ambienceVol);
  }

  private rampBus(bus: GainNode, target: number, rampMs: number): void {
    glideParam(bus.gain, this.ctx.currentTime, target, rampMs / MS_PER_SECOND, 'linear');
  }

  /** Set and remember the master volume the player chose (0–1 slider position). */
  setMasterVolumePreference(v: number): void {
    this.masterVol = v;
    settings.setMasterVolume(v);
    // Don't restore the gain while backgrounded — the zero is intentional.
    if (!this.backgrounded) this.rampBus(this.masterGain, this.masterBusLevel, VOLUME_RAMP_MS);
  }

  /** Silence or restore everything, remembered; the sliders keep their places. */
  setMuted(muted: boolean): void {
    this.mutedPreference = muted;
    settings.setMuted(muted);
    if (!this.backgrounded) this.rampBus(this.masterGain, this.masterBusLevel, VOLUME_RAMP_MS);
  }

  toggleMuted(): void {
    this.setMuted(!this.mutedPreference);
  }

  /** Downmix to mono or return to stereo, remembered; the two paths crossfade so nothing clicks. */
  setMonoAudio(mono: boolean): void {
    this.monoPreference = mono;
    settings.setMonoAudio(mono);
    this.rampBus(this.stereoOut, mono ? 0 : 1, VOLUME_RAMP_MS);
    this.rampBus(this.monoOut, mono ? 1 : 0, VOLUME_RAMP_MS);
  }

  /**
   * Whether the game stays audible while its tab or window is in the
   * background, remembered. A page frozen into the back-forward cache is
   * silenced either way.
   */
  setPlaysInBackground(enabled: boolean): void {
    this.backgroundPreference = enabled;
    settings.setAudioInBackground(enabled);
    if (enabled) this.unmuteFromBackground();
  }

  /** Set and remember the Effects volume the player chose; menu taps follow it. */
  setSfxVolumePreference(v: number): void {
    this.sfxVol = v;
    settings.setSfxVolume(v);
    this.rampBus(this.sfxGain, this.openSfxBusLevel, VOLUME_RAMP_MS);
    this.rampBus(this.uiGain, sliderGain(v), VOLUME_RAMP_MS);
  }

  /** Set and remember the music volume the player chose. */
  setMusicVolumePreference(v: number): void {
    this.musicVol = v;
    settings.setMusicVolume(v);
    if (this.musicPauseReasons.size > 0) return;
    this.rampBus(this.musicGain, this.openMusicBusLevel, VOLUME_RAMP_MS);
  }

  /** Set and remember the ambience volume the player chose. */
  setAmbienceVolumePreference(v: number): void {
    this.ambienceVol = v;
    settings.setAmbienceVolume(v);
    if (this.ambiencePauseReasons.size > 0) return;
    this.rampBus(this.ambienceGain, this.openAmbienceBusLevel, VOLUME_RAMP_MS);
  }

  /**
   * Subscribe to EventBus events and fire the appropriate sounds.
   * The bus is cleared on scene exit, so this must be called once per scene.
   * Music is not wired here: systems claim it through their scene's scope.
   */
  wireEvents(bus: EventBus): void {
    bus.on('mobKilled', (e) => {
      if (!this.hearsCreature(e.mob)) return;
      const remains = this.placedAt(
        e.mob.x + TILE_SIZE * TILE_CENTRE_FRACTION,
        e.mob.y + TILE_SIZE * TILE_CENTRE_FRACTION,
        e.mob.countsAsBossKill ? 'panOnly' : 'hearing',
      );
      // A skeleton has no meat to make a splat. The lord gets his own send-off
      // and the rank and file collapse into a heap of bones.
      if (e.mob.audioTag === 'skeleton_lord' || e.mob.audioTag === 'the_lich') {
        remains.play('skeleton_lord_death');
        return;
      }
      if (e.mob.audioTag === 'skeleton') {
        remains.play('bones_rattling');
        return;
      }
      if (e.mob.audioTag === 'rock_golem' && e.mob.isBoss) {
        remains.play('rock_golem_death');
        return;
      }
      if (e.mob.audioTag === 'big_rooster') {
        remains.play('big_rooster_death');
        return;
      }
      if (e.mob.audioTag === 'trash_gremlin') {
        remains.play('trash_gremlin_death');
        return;
      }
      // A guard tentacle's death sound cannot be a `playMobAudioCues` flag: it
      // is cut down and compacted out of the mob array well before the next
      // frame's cue drain would see one — see `playKrakarenTentacleCues`.
      if (e.mob.audioTag === 'krakaren_tentacle') {
        remains.play('krakaren_tentacle_death');
        return;
      }
      // A fairy has no meat either. Its kind's own parting effect — the ward
      // shatter, the heal wave, the chill, the flame, the wail — is voiced
      // separately by the fairy systems' cue drains, on top of this pop.
      if (e.mob.audioTag === 'fairy') {
        remains.play('fairy_death_pop');
        return;
      }
      remains.playRandom(['splat_1', 'splat_2', 'splat_3']);
    });

    bus.on('safeRoomEntered', () => {
      this.play('entered_safe_room');
    });

    let lastGameSavedCueAt = 0;
    bus.on('gameSaved', () => {
      const now = Date.now();
      if (now - lastGameSavedCueAt < GAME_SAVED_DEBOUNCE_MS) return;
      lastGameSavedCueAt = now;
      this.play('game_saving');
    });

    bus.on('healingPotionUsed', () => {
      this.play('healing_potion');
    });

    // The Bopca's one-shots. The cook sizzle is deliberately absent: it is a loop
    // that has to be stopped as well as started, so `BopcaSystem` drives it from
    // its own per-frame state instead — see `updateCookingLoop` there.
    bus.on('bopcaGreeted', (e) => {
      this.play(e.tone === 'toCat' ? 'bopca_happy_grunt' : 'bopca_grunt');
    });

    bus.on('bopcaServedFood', () => {
      this.play('bopca_dish_set_down');
    });

    bus.on('bopcaFoodEaten', (e) => {
      this.play(DISH_DEF[e.dishId].eating === 'slurp' ? 'slurping_soup' : 'bopca_eating');
    });

    // No bespoke assets exist for the skill system yet, so each of these borrows
    // the closest existing cue: a whiffed punch for a dodge, the unlock/level-up
    // stings for skill progress, and the revival tone for 9 Lives' save.
    bus.on('playerDodged', () => {
      this.play('human_punch_weak', {
        volume: DODGE_WHIFF_VOLUME,
        playbackRate: DODGE_WHIFF_RATE,
      });
    });

    bus.on('skillUnlocked', () => {
      this.play('new_unlock');
    });

    bus.on('skillLevelUp', () => {
      this.play('ability_level_up');
    });

    bus.on('skillTriggered', (e) => {
      if (e.skillId === 'nine_lives') this.play('reviving_tone');
    });

    bus.on('humanMeleeSwing', (e) => {
      if (e.hit) {
        this.playRandom(['human_punch_1', 'human_punch_2', 'human_punch_3']);
      } else {
        this.play('human_punch_weak');
      }
    });

    bus.on('bloodVomitRetch', () => {
      this.playRandom(BLOOD_VOMIT_TAKES);
    });

    bus.on('stormcallerSwing', () => {
      this.playRandom(STORMCALLER_SOUNDS.swing.takes);
    });

    bus.on('stormcallerStrike', () => {
      this.playRandom(STORMCALLER_SOUNDS.hit.takes);
    });

    bus.on('stormcallerChain', () => {
      this.playRandom(STORMCALLER_SOUNDS.proc.takes);
    });

    bus.on('weaponSwing', (e) => {
      const sounds = handWeaponSoundsOf(e.weaponId);
      if (sounds === null) return;
      this.playRandom(sounds.swing.takes);
      if (e.hit) this.playRandom(sounds.hit.takes);
    });

    bus.on('equipmentChanged', (e) => {
      this.playRandom(equipChangeCue(e, e.crawler));
      this.playRandom(bindCue(e));
    });

    bus.on('catMeleeSwing', (e) => {
      this.play('cat_scratch');
      const claws = e.clawsId === null ? null : clawSoundsOf(e.clawsId);
      if (claws !== null) this.playRandom(claws.swipe.takes);
    });

    bus.on('missileImpact', (e) => {
      this.playAt('cat_missile_impact', e.x, e.y, {}, PARTY_SHOT_REACH);
    });

    bus.on('slingshotImpact', (e) => {
      this.playRandomAt(WEAPON_FAMILY_SOUNDS.sling.hit.takes, e.x, e.y, {}, PARTY_SHOT_REACH);
    });

    bus.on('combatStarted', (e) => {
      if (e.mobType === 'Goblin' && Math.random() < GOBLIN_ENCOUNTER_CHANCE) {
        this.play('goblin_found_you');
      }
    });

    bus.on('playerLevelUp', () => {
      this.play('player_level_up');
    });

    bus.on('bossDefeated', (e) => {
      this.play('boss_defeated');
      if (e.bossType === 'krakaren_clone') {
        this.play('new_unlock');
      }
    });

    bus.on('questStarted', (e) => {
      if (e.questId === 'krasue_murders') {
        this.play('menu_open');
      }
    });

    // No `questCompleted` fanfare: `quest_complete` plays when the
    // quest-complete screen goes up, which can be a while after the quest completes.

    bus.on('levelComplete', () => {
      this.play('level_complete');
    });

    bus.on('objectiveComplete', () => {
      this.play('objective_complete');
    });

    bus.on('achievementUnlocked', () => {
      this.play('achievement_unlocked');
    });

    // The hearts' own chime; the cow's contented moo is its own voice, played
    // with the rest of the mob cues.
    bus.on('cowPetted', () => {
      this.play('happy_hearts');
    });
  }

  /** Stop music and release the AudioContext. Call when the page/game is torn down. */
  dispose(): void {
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('pagehide', this.handlePageHide);
    window.removeEventListener('pageshow', this.handlePageShow);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('focus', this.handleWindowFocus);
    this.removeUnlockListeners();
    for (const scope of this.scopes) scope.suspend();
    this.music.stopAll(0);
    for (const stray of [...this.unstoppedMusicTracks]) stray.stop(0, 'db');
    this.ctx.onstatechange = null;
    void this.ctx.close();
  }
}
