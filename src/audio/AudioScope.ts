import { AMBIENT_RAMP_MS, type LoopLevel } from './loopLevels';
import type { SoundId } from './sounds';
import type {
  MusicClaim,
  MusicClaimHolder,
  MusicClaimOwner,
  MusicReleaseOptions,
} from './music/MusicDirector';
import { MS_PER_SECOND, type BufferVoice, type Voice } from './voiceFades';

/** The keyboard-hero mini-game's song, whose clock drives the note chart. */
export const KEYBOARD_HERO_SONG = 'keyboard_hero_music_track_1' as const satisfies SoundId;

/** How long everything a scope owns takes to fade when the scope is disposed. */
export const SCOPE_DISPOSE_FADE_MS = 250;

/**
 * Something a scope tears down with itself, handed to it with
 * {@link AudioScope.own}. The scope calls `dispose` once, with the fade its
 * own loops use.
 */
export interface ScopedDisposable {
  dispose(fadeMs: number): void;
}

/** How a scope reaches the music director. */
export interface ScopeMusicEngine {
  claim(claim: MusicClaim, holder: MusicClaimHolder): void;
  release(owner: MusicClaimOwner, holder: MusicClaimHolder, opts?: MusicReleaseOptions): void;
  releaseAll(holder: MusicClaimHolder): void;
  isClaimed(owner: MusicClaimOwner, holder: MusicClaimHolder): boolean;
}

/** The part of a scope a system claims music through. */
export type MusicClaims = Pick<AudioScope, 'claimMusic' | 'releaseMusic' | 'isMusicClaimed'>;

/** Options for {@link AudioScope.startAmbientLoop}. */
export interface LoopStartOptions {
  /** How long the loop takes to come in. Default {@link AMBIENT_RAMP_MS}. */
  readonly fadeInMs?: number;
}

/**
 * What a scope asks of the `AudioManager` that made it. Only the manager
 * implements it, so the only way to start a loop is through a scope.
 */
export interface ScopeEngine {
  /** The audio clock, in seconds. */
  nowS(): number;
  /** Whether a voice may start now: the context is running and the page is not backgrounded. */
  canStartVoices(): boolean;
  startLoopVoice(id: SoundId, volume: number, fadeInMs: number): Voice | null;
  rampVoice(voice: Voice, volume: number, rampMs: number): void;
  stopVoice(voice: Voice, fadeMs: number): void;
  /**
   * Starts the keyboard-hero song on the music bus, `offsetS` into the
   * recording. `onEnded` runs if it plays to its end, never on a stop.
   */
  startKeyboardHeroVoice(offsetS: number, onEnded: () => void): BufferVoice | null;
  /**
   * Whether the keyboard-hero song failed to load and so will never play.
   * False while it is merely still decoding.
   */
  keyboardHeroSongFailed(): boolean;
  outputLatencyS(): number;
  preload(ids: ReadonlyArray<SoundId>): Promise<void>;
  attach(hooks: ScopeHooks): void;
  detach(hooks: ScopeHooks): void;
  readonly music: ScopeMusicEngine;
}

/** How the manager reaches each live scope. */
export interface ScopeHooks {
  /** The page went to the background: stop every voice, keep every wish. */
  suspend(): void;
  /** Audio can run again: restart every loop the scope still wants. */
  restartWanted(): void;
  /** Whether the scope is playing, or wants to play, `id`. */
  holds(id: SoundId): boolean;
  /** Every id this scope preloaded. */
  readonly declared: ReadonlySet<SoundId>;
}

/** A loop the scope wants playing, and its voice when it is. */
interface WantedLoop {
  volume: number;
  readonly fadeInMs: number;
  voice: Voice | null;
}

type KeyboardHeroState =
  | {
      readonly kind: 'playing';
      readonly voice: BufferVoice;
      /** The audio-clock time at which the recording's first sample played. */
      readonly songZeroS: number;
    }
  | { readonly kind: 'suspended'; readonly positionS: number };

/**
 * One scene's share of the audio: every loop and ambient bed the scene starts
 * goes through its scope, along with anything handed to {@link own}, so
 * disposing the scope when the scene exits fades out everything the scene
 * left running.
 *
 * The scope remembers what it *wants* as well as what is playing. A
 * backgrounded page stops every voice; coming back restarts the ones still
 * wanted, including loops started by one-off events that nothing would ever
 * start again (the spider lab's machinery, the keyboard-hero song).
 *
 * Music claims are made through the scope too ({@link claimMusic}), so a
 * scene's claims are released with it.
 *
 * Create one per scene with `AudioManager.createScope()`.
 */
export class AudioScope {
  private readonly loops = new Map<SoundId, WantedLoop>();
  private keyboardHero: KeyboardHeroState | null = null;
  private readonly owned = new Set<ScopedDisposable>();
  private readonly declared = new Set<SoundId>();
  private disposed = false;
  /** Who the director sees as holding this scope's music claims. */
  private readonly musicHolder: MusicClaimHolder = {};

  private readonly hooks: ScopeHooks = {
    suspend: () => this.suspendVoices(),
    restartWanted: () => this.restartWanted(),
    holds: (id) => this.loops.has(id) || (id === KEYBOARD_HERO_SONG && this.keyboardHero !== null),
    declared: this.declared,
  };

  constructor(private readonly engine: ScopeEngine) {
    engine.attach(this.hooks);
  }

  /**
   * Fetches and decodes `ids` and declares them this scope's: when a scope
   * is disposed, decoded sounds no live scope declared are released.
   */
  preload(ids: ReadonlyArray<SoundId>): Promise<void> {
    for (const id of ids) this.declared.add(id);
    return this.engine.preload(ids);
  }

  /**
   * Starts a continuous loop at `volume`; no-op while it is already playing.
   * Several emitters of one sound share one voice. A start declined because
   * audio is still locked, the buffer is still decoding or the page is
   * backgrounded is remembered: the loop comes in on the next start, when
   * audio unlocks, or when the page returns.
   */
  startAmbientLoop(id: SoundId, volume: number, opts: LoopStartOptions = {}): void {
    if (this.disposed) return;
    const wanted = this.loops.get(id);
    if (wanted !== undefined) {
      if (wanted.voice !== null) return;
      wanted.volume = volume;
      this.tryStart(id, wanted);
      return;
    }
    const loop: WantedLoop = { volume, fadeInMs: opts.fadeInMs ?? AMBIENT_RAMP_MS, voice: null };
    this.loops.set(id, loop);
    this.tryStart(id, loop);
  }

  /**
   * Whether the loop is actually sounding. Per-frame callers read this rather
   * than remembering their own start: a start can be declined, and a
   * backgrounded page stops every voice without telling anyone.
   */
  isAmbientLoopRunning(id: SoundId): boolean {
    return (this.loops.get(id)?.voice ?? null) !== null;
  }

  /** Ramps a wanted loop to `volume`; a loop not yet sounding starts at it. */
  setAmbientLoopVolume(id: SoundId, volume: number): void {
    const loop = this.loops.get(id);
    if (loop === undefined) return;
    loop.volume = volume;
    if (loop.voice !== null) this.engine.rampVoice(loop.voice, volume, AMBIENT_RAMP_MS);
  }

  /** Stops a loop and forgets it, fading over `fadeMs`. No-op if it isn't wanted. */
  stopAmbientLoop(id: SoundId, fadeMs: number = AMBIENT_RAMP_MS): void {
    const loop = this.loops.get(id);
    if (loop === undefined) return;
    this.loops.delete(id);
    if (loop.voice !== null) this.engine.stopVoice(loop.voice, fadeMs);
  }

  stopAllAmbientLoops(fadeMs: number = AMBIENT_RAMP_MS): void {
    for (const id of [...this.loops.keys()]) this.stopAmbientLoop(id, fadeMs);
  }

  /** {@link startAmbientLoop} for a loop whose level and fades are fixed. */
  startLoop(loop: LoopLevel): void {
    this.startAmbientLoop(loop.id, loop.volume, { fadeInMs: loop.fadeInMs });
  }

  /** {@link stopAmbientLoop} for a loop whose level and fades are fixed. */
  stopLoop(loop: LoopLevel): void {
    this.stopAmbientLoop(loop.id, loop.fadeOutMs);
  }

  /**
   * Plays the keyboard-hero song on the music bus. No-op if it is already
   * wanted. A start declined because audio is locked or the song is still
   * decoding is held at the top of the song, and comes in when it can.
   */
  startKeyboardHeroMusic(): void {
    if (this.disposed || this.keyboardHero !== null) return;
    this.keyboardHero = { kind: 'suspended', positionS: 0 };
    this.playKeyboardHeroFrom(0);
  }

  stopKeyboardHeroMusic(fadeMs: number = AMBIENT_RAMP_MS): void {
    const state = this.keyboardHero;
    this.keyboardHero = null;
    if (state?.kind === 'playing') this.engine.stopVoice(state.voice, fadeMs);
  }

  /**
   * How far into the keyboard-hero song playback is, or null when it isn't
   * running. The note chart is driven off this rather than a frame counter so
   * the falling notes stay locked to the melody. While the song is wanted but
   * not sounding — audio still locked, or the page backgrounded — this holds
   * where it stands, so the chart waits for it.
   *
   * The device's output latency is subtracted: the clock reads when a sample
   * is handed to the hardware, and the player hears it that much later.
   *
   * Null too when the song failed to load: it will never play, so the chart
   * runs on the frame clock instead of waiting for it.
   */
  keyboardHeroMusicTimeMs(): number | null {
    const state = this.keyboardHero;
    if (state === null) return null;
    if (state.kind === 'suspended' && this.engine.keyboardHeroSongFailed()) return null;
    const positionS =
      state.kind === 'playing' ? this.engine.nowS() - state.songZeroS : state.positionS;
    return (positionS - this.engine.outputLatencyS()) * MS_PER_SECOND;
  }

  /** Adds or replaces this scene's claim for `claim.owner`; released with the scope. */
  claimMusic(claim: MusicClaim): void {
    if (this.disposed) return;
    this.engine.music.claim(claim, this.musicHolder);
  }

  /** Lets go of this scene's claim for `owner`; no-op when another scene holds it. */
  releaseMusic(owner: MusicClaimOwner, opts?: MusicReleaseOptions): void {
    this.engine.music.release(owner, this.musicHolder, opts);
  }

  /** Whether this scene holds a claim for `owner`. */
  isMusicClaimed(owner: MusicClaimOwner): boolean {
    return this.engine.music.isClaimed(owner, this.musicHolder);
  }

  /** Ties `handle` to this scope: it is disposed with the scope. */
  own<T extends ScopedDisposable>(handle: T): T {
    if (this.disposed) {
      handle.dispose(SCOPE_DISPOSE_FADE_MS);
      return handle;
    }
    this.owned.add(handle);
    return handle;
  }

  /** Lets go of `handle` without disposing it. */
  disown(handle: ScopedDisposable): void {
    this.owned.delete(handle);
  }

  /**
   * Fades out everything the scope owns and forgets it. Call once, when the
   * scene exits; the scope is inert afterwards.
   */
  dispose(fadeMs: number = SCOPE_DISPOSE_FADE_MS): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAllAmbientLoops(fadeMs);
    this.stopKeyboardHeroMusic(fadeMs);
    const owned = [...this.owned];
    this.owned.clear();
    for (const handle of owned) handle.dispose(fadeMs);
    this.engine.music.releaseAll(this.musicHolder);
    this.engine.detach(this.hooks);
  }

  private tryStart(id: SoundId, loop: WantedLoop): void {
    if (!this.engine.canStartVoices()) return;
    loop.voice = this.engine.startLoopVoice(id, loop.volume, loop.fadeInMs);
  }

  private playKeyboardHeroFrom(positionS: number): void {
    if (!this.engine.canStartVoices()) return;
    const voice = this.engine.startKeyboardHeroVoice(positionS, () => {
      const state = this.keyboardHero;
      if (state?.kind === 'playing' && state.voice === voice) this.keyboardHero = null;
    });
    if (voice === null) return;
    this.keyboardHero = { kind: 'playing', voice, songZeroS: this.engine.nowS() - positionS };
  }

  private suspendVoices(): void {
    for (const loop of this.loops.values()) {
      if (loop.voice === null) continue;
      this.engine.stopVoice(loop.voice, 0);
      loop.voice = null;
    }
    const state = this.keyboardHero;
    if (state?.kind === 'playing') {
      this.engine.stopVoice(state.voice, 0);
      this.keyboardHero = { kind: 'suspended', positionS: this.engine.nowS() - state.songZeroS };
    }
  }

  private restartWanted(): void {
    if (this.disposed) return;
    for (const [id, loop] of this.loops) {
      if (loop.voice === null) this.tryStart(id, loop);
    }
    const state = this.keyboardHero;
    if (state?.kind === 'suspended') this.playKeyboardHeroFrom(state.positionS);
  }
}
