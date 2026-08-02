import type { EventBus } from '../core/EventBus';
import { settings } from '../core/Settings';
import type { SoundId } from './sounds';
import { ALL_SOUND_IDS, SOUND_MANIFEST } from './sounds';

const WALKING_VOLUME = 0.25;
/**
 * The wading loop has to beat the river bed, not merely the footsteps it
 * replaces, and that is a much higher bar: both are broadband water noise, so
 * they mask each other almost perfectly and a few dB of difference is inaudible
 * rather than quiet. Measured effective levels (file loudness + this gain): the
 * Tuned by ear over several passes and finally set by measurement: the river bed
 * lands at an effective -22.2 dB, and this puts the wading loop 3 dB under it,
 * at -25.2. Under rather than over, which is the opposite of where it started —
 * the loop only has to be *distinguishable* from the bed, and both being
 * broadband water noise it reads as part of the river rather than as a separate
 * sound when it sits above.
 *
 * The number is not comparable to earlier values: the file itself was remastered
 * 8 dB louder partway through. Only the effective levels are.
 */
const WADING_VOLUME = 0.32;
/**
 * Fade applied when the wading loop stops.
 *
 * Deliberately far shorter than `AMBIENT_RAMP_MS`: this tracks the player's own
 * footfalls, so it has to stop when they stop, not a tenth of a second later.
 * Not zero either — cutting a looping noise source dead puts a click on the end
 * of every step the player takes in the water.
 */
const WADING_FADE_OUT_MS = 40;
const SPIDER_WALKING_VOLUME = 0.4;
const MACHINERY_VOLUME = 0.35;
const MS_PER_SECOND = 1000;
const DEFAULT_STOP_MUSIC_FADE_MS = 500;
const GOBLIN_ENCOUNTER_CHANCE = 0.15;
const MENU_MUSIC_FADE_MS = 200;
/** Ramp time applied to ambient-loop volume changes, short enough to track the player. */
const AMBIENT_RAMP_MS = 100;
/** A dodge borrows the whiffed-punch cue, quieter and quicker so it reads as air. */
const DODGE_WHIFF_VOLUME = 0.5;
const DODGE_WHIFF_RATE = 1.35;

export interface PlayOptions {
  /** Volume multiplier (0–1). Default: 1. */
  volume?: number;
  /** Playback speed multiplier. Default: 1. */
  playbackRate?: number;
  /** Start playback this many seconds into the buffer. Default: 0. */
  startOffset?: number;
}

export interface MusicOptions {
  /** Fade-in duration in milliseconds. Default: 0. */
  fadeInMs?: number;
}

/** Fisher–Yates shuffle into a fresh array (leaves the source untouched). */
function shuffleTracks(ids: ReadonlyArray<SoundId>): SoundId[] {
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Web Audio API manager for the game.
 *
 * Volume hierarchy:
 *   AudioContext → masterGain → sfxGain  → one-shot SFX buffers
 *                             → musicGain → looping music source
 *
 * Usage:
 *   const audio = new AudioManager();
 *   void audio.preload();           // decode everything in the background
 *   audio.resume();                 // call on first user gesture
 *   audio.play('splat_1');
 *   audio.playMusic('bg_level_1', { fadeInMs: 2000 });
 */
export class AudioManager {
  private readonly ctx: AudioContext;
  private readonly masterGain: GainNode;
  private readonly sfxGain: GainNode;
  private readonly musicGain: GainNode;

  private readonly buffers = new Map<SoundId, AudioBuffer>();
  private currentMusicSource: AudioBufferSourceNode | null = null;
  private currentMusicGain: GainNode | null = null;
  private _currentMusicId: SoundId | null = null;
  private pendingMusic: { id: SoundId; opts: MusicOptions } | null = null;
  // Shuffled track list when a playlist is active (advances on each track's end); null for a single looping track.
  private musicPlaylist: SoundId[] | null = null;
  private musicPlaylistPos = 0;
  private walkingSource: AudioBufferSourceNode | null = null;
  /** Kept with its gain node, unlike the walking loop, so stopping can fade. */
  private wadingLoop: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private spiderWalkingSource: AudioBufferSourceNode | null = null;
  private machinerySource: AudioBufferSourceNode | null = null;
  private keyboardHeroMusicSource: AudioBufferSourceNode | null = null;
  // Distance-attenuated ambient loops, keyed by sound id so several emitters of
  // the same sound (every hearth in a building) share one voice.
  private readonly ambientLoops = new Map<
    SoundId,
    { source: AudioBufferSourceNode; gain: GainNode }
  >();

  // Sounds queued because their buffer wasn't decoded yet when requested.
  private readonly pendingSfx = new Map<SoundId, PlayOptions>();
  // Sounds queued because the AudioContext was suspended when the buffer became ready.
  private readonly pendingOnUnlock: Array<{ id: SoundId; opts: PlayOptions }> = [];
  // Tracks the most recently started source node (and optional per-sound gain node)
  // per sound id for stoppable one-shots.
  private readonly activeSources = new Map<
    SoundId,
    { source: AudioBufferSourceNode; gain: GainNode | null }
  >();

  private masterVol = settings.masterVolume;
  private sfxVol = settings.sfxVolume;
  private musicVol = settings.musicVolume;

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

  constructor() {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.masterGain.gain.value = this.masterVol;
    this.sfxGain.gain.value = this.sfxVol;
    this.musicGain.gain.value = this.musicVol;
    this.sfxGain.connect(this.masterGain);
    this.musicGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    // pagehide fires when the page enters the BFCache (lock screen / app switch on
    // iOS) — more reliable than visibilitychange alone on some mobile browsers.
    window.addEventListener('pagehide', this.handlePageHide);
    window.addEventListener('pageshow', this.handlePageShow);
    // Mobile browsers start AudioContext suspended and only allow resume() inside
    // a direct user-gesture handler. Register capture-phase listeners so the very
    // first touch/click/key unlocks audio before any scene handler runs.
    window.addEventListener('touchstart', this.handleUnlockGesture, {
      capture: true,
      passive: true,
    });
    window.addEventListener('click', this.handleUnlockGesture, { capture: true });
    window.addEventListener('keydown', this.handleUnlockGesture, { capture: true });
  }

  private readonly handleVisibilityChange = (): void => {
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

  private muteForBackground(): void {
    if (this.backgrounded) return;
    this.backgrounded = true;
    // Zero gain immediately — ctx.suspend() is async and some mobile browsers
    // don't honor it fast enough before the screen fully locks.
    this.masterGain.gain.value = 0;
    // Stop looping sources so they don't resume audibly on a buggy ctx.resume().
    this.stopWalkingLoop();
    this.stopWadingLoop();
    this.stopSpiderWalkingLoop();
    this.stopMachineryLoop();
    this.stopKeyboardHeroMusic();
    this.stopAllAmbientLoops();
    void this.ctx.suspend();
  }

  private unmuteFromBackground(): void {
    if (!this.backgrounded) return;
    this.backgrounded = false;
    this.masterGain.gain.value = this.masterVol;
    void this.ctx.resume().then(() => {
      if (this.ctx.state === 'running') {
        this.onContextUnlocked();
      }
    });
  }

  // Called on the first touchstart/click/keydown. Resumes the AudioContext from
  // inside a user-gesture handler, then flushes any sounds that were queued while
  // the context was suspended.
  private readonly handleUnlockGesture = (): void => {
    if (this.ctx.state === 'running') {
      this.removeUnlockListeners();
      return;
    }
    void this.ctx.resume().then(() => {
      if (this.ctx.state === 'running') {
        this.removeUnlockListeners();
        this.onContextUnlocked();
      }
    });
  };

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
    window.removeEventListener('touchstart', this.handleUnlockGesture, { capture: true });
    window.removeEventListener('click', this.handleUnlockGesture, { capture: true });
    window.removeEventListener('keydown', this.handleUnlockGesture, { capture: true });
  }

  private onContextUnlocked(): void {
    // Fire one-time callbacks registered via onRunning().
    const callbacks = this.runningCallbacks.splice(0);
    for (const cb of callbacks) cb();

    const pending = this.pendingOnUnlock.splice(0);
    for (const { id, opts } of pending) {
      this.play(id, opts);
    }

    if (this.pendingMusic !== null) {
      const { id, opts } = this.pendingMusic;
      this.pendingMusic = null;
      this.resumePendingMusic(id, opts);
    }
  }

  /** Resume the AudioContext. Must be called from a user-gesture handler. */
  resume(): void {
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(() => {
        if (this.ctx.state === 'running') {
          this.onContextUnlocked();
        }
      });
    }
  }

  /**
   * Fetch and decode sounds into memory in parallel.
   * Defaults to every sound in the manifest.
   * Failures emit a console warning and are skipped — they will not throw.
   */
  async preload(ids: ReadonlyArray<SoundId> = ALL_SOUND_IDS): Promise<void> {
    await Promise.all(
      ids.map(async (id) => {
        if (this.buffers.has(id)) return;
        const path = SOUND_MANIFEST[id];
        try {
          const response = await fetch(path);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
          this.buffers.set(id, audioBuffer);
          const pendingOpts = this.pendingSfx.get(id);
          if (pendingOpts !== undefined) {
            this.pendingSfx.delete(id);
            this.play(id, pendingOpts);
          }
        } catch (err) {
          console.warn(`[AudioManager] Failed to load "${id}":`, err);
        }
      }),
    );
    // Fulfill any music request that arrived before buffers were ready.
    if (this.pendingMusic !== null) {
      const { id, opts } = this.pendingMusic;
      this.pendingMusic = null;
      this.resumePendingMusic(id, opts);
    }
  }

  /** Play a one-shot sound effect. Silently skips if the buffer is not yet loaded. */
  play(id: SoundId, opts: PlayOptions = {}): void {
    const buffer = this.buffers.get(id);
    if (!buffer) return;
    if (this.ctx.state !== 'running') {
      this.pendingOnUnlock.push({ id, opts });
      return;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = opts.playbackRate ?? 1;

    const { volume } = opts;
    let perSoundGain: GainNode | null = null;
    if (volume !== undefined && volume !== 1) {
      perSoundGain = this.ctx.createGain();
      perSoundGain.gain.value = volume;
      source.connect(perSoundGain);
      perSoundGain.connect(this.sfxGain);
    } else {
      source.connect(this.sfxGain);
    }

    this.activeSources.set(id, { source, gain: perSoundGain });
    source.onended = () => {
      const current = this.activeSources.get(id);
      if (current?.source === source) {
        current.gain?.disconnect();
        this.activeSources.delete(id);
      }
    };

    source.start(0, opts.startOffset ?? 0);
  }

  /** Stop a currently-playing one-shot sound immediately. No-op if it already finished. */
  stopSound(id: SoundId): void {
    const entry = this.activeSources.get(id);
    if (!entry) return;
    try {
      entry.source.stop();
    } catch {
      // already stopped
    }
    entry.gain?.disconnect();
    this.activeSources.delete(id);
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
    }
  }

  /** Pick one of the given IDs at random and play it. */
  playRandom(ids: ReadonlyArray<SoundId>, opts: PlayOptions = {}): void {
    if (ids.length === 0) return;
    this.play(ids[Math.floor(Math.random() * ids.length)], opts);
  }

  /** The looping track currently playing (or pending), if any. */
  get currentMusicId(): SoundId | null {
    return this._currentMusicId;
  }

  /**
   * Start a looping background music track.
   * Immediately stops any currently-playing track (and cancels any active playlist).
   */
  playMusic(id: SoundId, opts: MusicOptions = {}): void {
    this.musicPlaylist = null;
    this.startMusicTrack(id, opts, true, null);
  }

  /**
   * Play a shuffled playlist of tracks as one continuous set: each track plays
   * once (no per-track loop), the next starts when it ends, and the list wraps
   * after the last. Immediately replaces any current track or playlist.
   */
  playMusicPlaylist(ids: ReadonlyArray<SoundId>, opts: MusicOptions = {}): void {
    if (ids.length === 0) return;
    this.musicPlaylist = shuffleTracks(ids);
    this.musicPlaylistPos = 0;
    this.startPlaylistTrack(opts.fadeInMs ?? 0);
  }

  private startPlaylistTrack(fadeInMs: number): void {
    const playlist = this.musicPlaylist;
    if (playlist === null) return;
    const id = playlist[this.musicPlaylistPos];
    this.startMusicTrack(id, { fadeInMs }, false, () => {
      // Ignore the end event if the playlist was swapped or stopped meanwhile.
      if (this.musicPlaylist !== playlist) return;
      this.musicPlaylistPos = (this.musicPlaylistPos + 1) % playlist.length;
      this.startPlaylistTrack(0);
    });
  }

  private startMusicTrack(
    id: SoundId,
    opts: MusicOptions,
    loop: boolean,
    onEnded: (() => void) | null,
  ): void {
    this.stopCurrentMusicSource(0);
    this._currentMusicId = id;
    const buffer = this.buffers.get(id);
    if (!buffer || this.ctx.state !== 'running') {
      this.pendingMusic = { id, opts };
      return;
    }

    const perTrackGain = this.ctx.createGain();
    const fadeInMs = opts.fadeInMs ?? 0;
    if (fadeInMs > 0) {
      perTrackGain.gain.setValueAtTime(0, this.ctx.currentTime);
      perTrackGain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + fadeInMs / MS_PER_SECOND);
    }
    perTrackGain.connect(this.musicGain);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(perTrackGain);
    if (onEnded !== null) source.onended = onEnded;
    source.start();

    this.currentMusicSource = source;
    this.currentMusicGain = perTrackGain;
  }

  /** Start a looping walking SFX. No-op if already playing or buffer not loaded. */
  startWalkingLoop(): void {
    if (this.walkingSource !== null) return;
    const buffer = this.buffers.get('player_walking');
    if (!buffer) return;
    const gain = this.ctx.createGain();
    gain.gain.value = WALKING_VOLUME;
    gain.connect(this.sfxGain);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    this.walkingSource = source;
  }

  /** Stop the looping walking SFX. No-op if not playing. */
  stopWalkingLoop(): void {
    if (this.walkingSource === null) return;
    try {
      this.walkingSource.stop();
    } catch {
      /* already stopped */
    }
    this.walkingSource = null;
  }

  /**
   * Start the looping wading SFX. No-op if already playing or not yet decoded.
   */
  startWadingLoop(): void {
    if (this.wadingLoop !== null) return;
    const buffer = this.buffers.get('player_wading');
    if (!buffer) return;
    const gain = this.ctx.createGain();
    gain.gain.value = WADING_VOLUME;
    gain.connect(this.sfxGain);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    this.wadingLoop = { source, gain };
  }

  /**
   * Stop the wading loop on a very short fade. No-op if it isn't running.
   *
   * The handle is dropped before the fade finishes, so a player who takes one
   * step, stops, and steps again gets a fresh voice immediately rather than
   * being refused for the length of the fade — the old one is already detached
   * and rides its ramp to zero on its own.
   */
  stopWadingLoop(): void {
    const loop = this.wadingLoop;
    if (loop === null) return;
    this.wadingLoop = null;
    const now = this.ctx.currentTime;
    const fadeSeconds = WADING_FADE_OUT_MS / MS_PER_SECOND;
    try {
      loop.gain.gain.cancelScheduledValues(now);
      loop.gain.gain.setValueAtTime(loop.gain.gain.value, now);
      loop.gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
      loop.source.stop(now + fadeSeconds);
    } catch {
      /* already stopped */
    }
    loop.source.onended = () => {
      loop.gain.disconnect();
    };
  }

  /** Start a looping spider walking SFX. No-op if already playing or buffer not loaded. */
  startSpiderWalkingLoop(): void {
    if (this.spiderWalkingSource !== null) return;
    const buffer = this.buffers.get('spider_walking');
    if (!buffer) return;
    const gain = this.ctx.createGain();
    gain.gain.value = SPIDER_WALKING_VOLUME;
    gain.connect(this.sfxGain);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    this.spiderWalkingSource = source;
  }

  /** Stop the looping spider walking SFX. No-op if not playing. */
  stopSpiderWalkingLoop(): void {
    if (this.spiderWalkingSource === null) return;
    try {
      this.spiderWalkingSource.stop();
    } catch {
      /* already stopped */
    }
    this.spiderWalkingSource = null;
  }

  /** Start a looping ambient machinery SFX (spider lab). No-op if already playing or buffer not loaded. */
  startMachineryLoop(): void {
    if (this.machinerySource !== null) return;
    const buffer = this.buffers.get('tech_machinery_running');
    if (!buffer) return;
    const gain = this.ctx.createGain();
    gain.gain.value = MACHINERY_VOLUME;
    gain.connect(this.sfxGain);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    this.machinerySource = source;
  }

  /** Stop the looping machinery SFX. No-op if not playing. */
  stopMachineryLoop(): void {
    if (this.machinerySource === null) return;
    try {
      this.machinerySource.stop();
    } catch {
      /* already stopped */
    }
    this.machinerySource = null;
  }

  /**
   * Start a positional ambient loop at `volume`. No-op if the loop is already
   * running, the buffer hasn't decoded, or the AudioContext is still locked —
   * callers drive these from a per-frame distance calculation, so the next frame
   * simply retries once audio unlocks rather than needing a queue.
   */
  startAmbientLoop(id: SoundId, volume: number): void {
    if (this.ambientLoops.has(id)) return;
    if (!this.isRunning) return;
    const buffer = this.buffers.get(id);
    if (!buffer) return;
    const gain = this.ctx.createGain();
    // Fade in rather than snapping to `volume`: a room-wide bed starts at full
    // gain the instant you walk in, and an instant step would click.
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + AMBIENT_RAMP_MS / MS_PER_SECOND);
    gain.connect(this.sfxGain);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    this.ambientLoops.set(id, { source, gain });
  }

  /**
   * Whether an ambient loop is actually playing. Callers drive these from a
   * per-frame distance calculation and `startAmbientLoop` silently declines while
   * the context is locked or the buffer is still decoding — so the truth has to
   * live here rather than in a caller-side "I started it" flag that would go
   * stale (a backgrounded tab stops every loop without telling anyone).
   */
  isAmbientLoopRunning(id: SoundId): boolean {
    return this.ambientLoops.has(id);
  }

  /**
   * Ramp a running ambient loop to `volume`. Ramping rather than assigning is
   * what keeps a loop that tracks the player's distance from zippering.
   */
  setAmbientLoopVolume(id: SoundId, volume: number): void {
    const loop = this.ambientLoops.get(id);
    if (loop === undefined) return;
    const now = this.ctx.currentTime;
    loop.gain.gain.cancelScheduledValues(now);
    loop.gain.gain.setValueAtTime(loop.gain.gain.value, now);
    loop.gain.gain.linearRampToValueAtTime(volume, now + AMBIENT_RAMP_MS / MS_PER_SECOND);
  }

  /**
   * Stop an ambient loop. No-op if it isn't running. The voice is ramped to zero
   * before it is torn down, so stopping a loop that is still audible — leaving a
   * tavern mid-murmur — doesn't cut the waveform dead and click. The map entry is
   * dropped immediately so re-entering can start a fresh voice at once.
   */
  stopAmbientLoop(id: SoundId): void {
    const loop = this.ambientLoops.get(id);
    if (loop === undefined) return;
    this.ambientLoops.delete(id);
    const now = this.ctx.currentTime;
    const rampSeconds = AMBIENT_RAMP_MS / MS_PER_SECOND;
    try {
      loop.gain.gain.cancelScheduledValues(now);
      loop.gain.gain.setValueAtTime(loop.gain.gain.value, now);
      loop.gain.gain.linearRampToValueAtTime(0, now + rampSeconds);
      loop.source.stop(now + rampSeconds);
    } catch {
      /* already stopped */
    }
    loop.source.onended = () => {
      loop.gain.disconnect();
    };
  }

  /** Stop every ambient loop. Call on scene swap and teardown. */
  stopAllAmbientLoops(): void {
    for (const id of [...this.ambientLoops.keys()]) this.stopAmbientLoop(id);
  }

  /** Play the keyboard hero music track (one-shot, stoppable). No-op if already playing. */
  startKeyboardHeroMusic(): void {
    if (this.keyboardHeroMusicSource !== null) return;
    const buffer = this.buffers.get('keyboard_hero_music_track_1');
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = false;
    source.connect(this.sfxGain);
    source.start();
    source.onended = () => {
      this.keyboardHeroMusicSource = null;
    };
    this.keyboardHeroMusicSource = source;
  }

  /** Stop the keyboard hero music track early. No-op if not playing. */
  stopKeyboardHeroMusic(): void {
    if (this.keyboardHeroMusicSource === null) return;
    try {
      this.keyboardHeroMusicSource.stop();
    } catch {
      /* already stopped */
    }
    this.keyboardHeroMusicSource = null;
  }

  private musicPaused = false;

  /** Fade music out quickly (e.g. when a menu opens). Idempotent. */
  pauseMusic(): void {
    if (this.musicPaused) return;
    this.musicPaused = true;
    const now = this.ctx.currentTime;
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
    this.musicGain.gain.linearRampToValueAtTime(0, now + MENU_MUSIC_FADE_MS / MS_PER_SECOND);
  }

  /** Fade music back in (e.g. when a menu closes). Idempotent. */
  resumeMusic(): void {
    if (!this.musicPaused) return;
    this.musicPaused = false;
    const now = this.ctx.currentTime;
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
    this.musicGain.gain.linearRampToValueAtTime(
      this.musicVol,
      now + MENU_MUSIC_FADE_MS / MS_PER_SECOND,
    );
  }

  /**
   * Stop the currently-playing music track (and cancel any active playlist).
   * @param fadeMs - fade-out duration in ms (default: 500)
   */
  stopMusic(fadeMs = DEFAULT_STOP_MUSIC_FADE_MS): void {
    this.musicPlaylist = null;
    this.stopCurrentMusicSource(fadeMs);
  }

  /** Stop just the active music source without touching the playlist (used when swapping tracks). */
  private stopCurrentMusicSource(fadeMs: number): void {
    this.musicPaused = false;
    this.pendingMusic = null;
    this._currentMusicId = null;
    const src = this.currentMusicSource;
    const gain = this.currentMusicGain;
    if (src === null || gain === null) return;
    this.currentMusicSource = null;
    this.currentMusicGain = null;
    // Detach the advance handler so a deliberate swap/stop never triggers the next playlist track.
    src.onended = null;

    if (fadeMs > 0) {
      const now = this.ctx.currentTime;
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fadeMs / MS_PER_SECOND);
      try {
        src.stop(now + fadeMs / MS_PER_SECOND);
      } catch {
        /* already stopped */
      }
    } else {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
  }

  /** Restart whatever music was pending (a single track or the current playlist slot) once the context unlocks. */
  private resumePendingMusic(id: SoundId, opts: MusicOptions): void {
    if (this.musicPlaylist !== null) {
      this.startPlaylistTrack(opts.fadeInMs ?? 0);
    } else {
      this.playMusic(id, opts);
    }
  }

  /** Set the overall master volume (0–1). */
  setMasterVolume(v: number): void {
    this.masterVol = v;
    // Don't restore the gain while backgrounded — the zero is intentional.
    if (!this.backgrounded) {
      this.masterGain.gain.value = v;
    }
  }

  /** Set the SFX bus volume (0–1). */
  setSfxVolume(v: number): void {
    this.sfxVol = v;
    this.sfxGain.gain.value = v;
  }

  /** Set the music bus volume (0–1). */
  setMusicVolume(v: number): void {
    this.musicVol = v;
    this.musicGain.gain.value = v;
  }

  /*
   * The `...Preference` setters are what the player's own volume controls call.
   * They are separate from the plain setters above because those are also used
   * for transient ducking (the tutorial quiets the music, for instance), which
   * must not be mistaken for a choice and remembered across sessions.
   */

  /** Set and remember the master volume the player chose. */
  setMasterVolumePreference(v: number): void {
    this.setMasterVolume(v);
    settings.setMasterVolume(v);
  }

  /** Set and remember the SFX volume the player chose. */
  setSfxVolumePreference(v: number): void {
    this.setSfxVolume(v);
    settings.setSfxVolume(v);
  }

  /** Set and remember the music volume the player chose. */
  setMusicVolumePreference(v: number): void {
    this.setMusicVolume(v);
    settings.setMusicVolume(v);
  }

  /**
   * Subscribe to EventBus events and fire the appropriate sounds.
   * The bus is cleared on scene exit, so this must be called once per scene.
   *
   * @param defaultMusicId - Track to resume after boss fights/quests interrupt music
   *   with their own track. Defaults to `bg_level_1` for scenes that don't pass one
   *   (e.g. the Bopca safe-room bus in BuildingInteriorScene).
   */
  wireEvents(bus: EventBus, defaultMusicId: SoundId = 'bg_level_1'): void {
    bus.on('mobKilled', () => {
      this.playRandom(['splat_1', 'splat_2', 'splat_3']);
    });

    bus.on('safeRoomEntered', () => {
      this.play('entered_safe_room');
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

    bus.on('bopcaFoodEaten', () => {
      this.play('bopca_eating');
    });

    // No bespoke assets exist for the skill system yet, so each of these borrows
    // the closest existing cue: a whiffed punch for a dodge, the unlock/level-up
    // stings for skill progress, and the revival tone for Cockroach's save.
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
      if (e.skillId === 'cockroach') this.play('reviving_tone');
    });

    bus.on('humanMeleeSwing', (e) => {
      if (e.hit) {
        this.playRandom(['human_punch_1', 'human_punch_2', 'human_punch_3']);
      } else {
        this.play('human_punch_weak');
      }
    });

    bus.on('catMeleeSwing', () => {
      this.play('cat_scratch');
    });

    bus.on('missileImpact', () => {
      this.play('cat_missile_impact');
    });

    bus.on('combatStarted', (e) => {
      if (e.mobType === 'Goblin' && Math.random() < GOBLIN_ENCOUNTER_CHANCE) {
        this.play('goblin_found_you');
      }
    });

    bus.on('playerLevelUp', () => {
      this.play('player_level_up');
    });

    bus.on('bossFightInitiated', (e) => {
      const track =
        e.bossType === 'the_hoarder'
          ? 'boss_music_1'
          : e.bossType === 'juicer'
            ? 'boss_music_2'
            : 'boss_music_3';
      this.playMusic(track, { fadeInMs: 1500 });
    });

    bus.on('bossDefeated', (e) => {
      this.play('boss_defeated');
      if (e.bossType === 'krakaren_clone') {
        this.play('new_unlock');
      }
      this.playMusic(defaultMusicId, { fadeInMs: 2000 });
    });

    bus.on('questStarted', (e) => {
      if (e.questId === 'defend_goblin_mother') {
        this.playMusic('defense_quest_music', { fadeInMs: 1000 });
      }
      if (e.questId === 'the_show_must_go_on' || e.questId === 'krasue_murders') {
        this.play('menu_open');
      }
    });

    bus.on('objectiveComplete', (e) => {
      if (e.objectiveId === 'goblin_child_returned') {
        this.playMusic(defaultMusicId, { fadeInMs: 1000 });
      }
    });

    bus.on('questCompleted', (e) => {
      if (
        e.questId === 'defend_goblin_mother' ||
        e.questId === 'grotesque_spider' ||
        e.questId === 'the_show_must_go_on' ||
        e.questId === 'krasue_murders'
      ) {
        this.play('quest_complete');
      }
    });

    bus.on('levelComplete', () => {
      this.play('level_complete');
    });

    bus.on('objectiveComplete', () => {
      this.play('objective_complete');
    });

    bus.on('achievementUnlocked', () => {
      this.play('achievement_unlocked');
    });

    bus.on('questFailed', (e) => {
      if (e.questId === 'defend_goblin_mother') {
        this.playMusic(defaultMusicId, { fadeInMs: 1500 });
      }
    });
  }

  /** Stop music and release the AudioContext. Call when the page/game is torn down. */
  dispose(): void {
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('pagehide', this.handlePageHide);
    window.removeEventListener('pageshow', this.handlePageShow);
    this.removeUnlockListeners();
    this.stopWalkingLoop();
    this.stopWadingLoop();
    this.stopSpiderWalkingLoop();
    this.stopMachineryLoop();
    this.stopKeyboardHeroMusic();
    this.stopAllAmbientLoops();
    this.stopMusic(0);
    void this.ctx.close();
  }
}
