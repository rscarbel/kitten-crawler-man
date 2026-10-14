import { activeMusicLibrary, onMusicLibraryBound } from '../../core/MusicLibrary';
import type { MusicBusId, MusicTrackId } from '../sounds';
import { musicLoopStartS } from '../sounds';

/**
 * The layers a claim is made on, lowest first. The highest layer holding a
 * claim decides what plays; within a layer the most recent claim does.
 */
export const MUSIC_LAYERS = ['area', 'activity', 'battle', 'boss', 'player', 'exclusive'] as const;
export type MusicLayer = (typeof MUSIC_LAYERS)[number];

/**
 * What a claim wants on the music bus.
 *
 * - `silence`: nothing.
 * - `loop`: one recording, looping from its loop point; `skipIntro` starts
 *   there too, for a play site that wants the body without the intro.
 * - `playlist`: a shuffled set, one song after another. `advance` moves on to
 *   another song when the claim takes over a set that is already playing,
 *   so walking through a door into the same set is still heard as a change.
 * - `held`: a recording the claimant plays itself on the music bus, because a
 *   game clock is read off its own voice (the keyboard-hero song). The
 *   director plays nothing of its own while it wins and credits the song
 *   once the claimant reports it sounding.
 */
export type MusicSelection =
  | { readonly kind: 'silence' }
  | { readonly kind: 'loop'; readonly id: MusicBusId; readonly skipIntro?: boolean }
  | { readonly kind: 'playlist'; readonly ids: readonly MusicBusId[]; readonly advance?: boolean }
  | { readonly kind: 'held'; readonly id: MusicBusId };

/** Every system that may claim music. A closed set, so a misspelt owner is a type error. */
export type MusicClaimOwner =
  | 'floor'
  | 'overworld_zone'
  | 'interior'
  | 'pipe_board'
  | 'prison'
  | 'casino_tables'
  | 'free_spins'
  | 'defend_quest'
  | 'circus_waves'
  | 'big_top_maze'
  | 'night_attack'
  | 'escort'
  | 'siege'
  | 'boss'
  | 'tower_finale'
  | 'keyboard_hero'
  | 'player';

export interface MusicClaim {
  readonly owner: MusicClaimOwner;
  readonly layer: MusicLayer;
  readonly selection: MusicSelection;
  /** Overrides the layer's default fade for this claim's entrance. */
  readonly fadeInMs?: number;
}

export interface MusicReleaseOptions {
  /** How long the change this release causes takes. Default: the incoming claim's own fade. */
  readonly fadeOutMs?: number;
}

/**
 * How long an overridden track is remembered: a claim that wins again within
 * this many seconds carries on from where its song was cut, and after it a
 * playlist moves on to its next song and a loop starts at its loop point.
 */
export const MUSIC_RESUME_WINDOW_S = 90;

/** How long each layer's claims take to come in, unless a claim names its own fade. */
export const MUSIC_LAYER_FADE_MS = {
  area: 2000,
  activity: 800,
  battle: 1000,
  boss: 1500,
  player: 1000,
  exclusive: 400,
} as const satisfies Record<MusicLayer, number>;

/** How long the music takes to fade when the last claim lets go and nothing replaces it. */
export const MUSIC_SILENCE_FADE_MS = 500;

/**
 * How a track repeats: from its loop point (`loopPoint`), from the top
 * (`whole`), or not at all (`once`).
 */
export type TrackLoopMode = 'loopPoint' | 'whole' | 'once';

export type TrackStopShape = 'db' | 'equalPowerOut';

export interface MusicTrackRequest {
  readonly id: MusicBusId;
  readonly loop: TrackLoopMode;
  readonly offsetS: number;
  readonly fadeInMs: number;
  /** Runs when a track that does not loop plays to its end; never on a stop. */
  readonly onEnded: () => void;
  /** Runs each time the track is really sounding; never for a request still waiting on audio. */
  readonly onPlaying: () => void;
  /** Runs when the recording cannot be loaded, so the track will never sound. */
  readonly onUnavailable: () => void;
}

export interface MusicTrackHandle {
  /** Where in the recording playback stands, in seconds. */
  positionS(): number;
  stop(fadeMs: number, shape: TrackStopShape): void;
}

/** What the director needs of the `AudioManager` that plays its tracks. */
export interface MusicEngine {
  /** Whether a track can start now: the audio context is running. */
  canPlay(): boolean;
  /** The audio clock, in seconds. */
  nowS(): number;
  startTrack(request: MusicTrackRequest): MusicTrackHandle;
}

/** Who holds a claim. A scene's scope holds the claims it makes; the player's choice has no holder. */
export type MusicClaimHolder = object;

/** The player's choice of music from the music page. */
export type MusicPlayerMode =
  | { readonly kind: 'area' }
  | { readonly kind: 'shuffle' }
  | { readonly kind: 'repeat'; readonly id: MusicTrackId }
  | { readonly kind: 'once'; readonly id: MusicTrackId };

/** What the music page drives the player's choice through. */
export interface MusicPlayerControls {
  readonly playerMode: MusicPlayerMode;
  readonly audibleTrack: MusicBusId | null;
  /** Plays `id` through once, then whatever it covered carries on. */
  playOnce(id: MusicTrackId): void;
  /** Plays `id` over and over, the whole recording each time. */
  repeat(id: MusicTrackId): void;
  /** Shuffles every unlocked song, growing as songs unlock. */
  shuffleUnlocked(): void;
  /** Hands the music back to wherever the player is. */
  areaMusic(): void;
  onTrackAudible(listener: (id: MusicBusId) => void): () => void;
}

interface ClaimEntry {
  readonly claim: MusicClaim;
  readonly holder: MusicClaimHolder | null;
  readonly seq: number;
  /** Whether this claim's `advance` has been spent; it moves a set on once, not on every resolve. */
  advanceSpent: boolean;
}

/** The song the director is playing, or is waiting on audio to play. */
interface PlayingTrack {
  /** The selection it plays, as {@link selectionKey} names it. */
  key: string;
  readonly kind: 'loop' | 'playlist' | 'held';
  readonly id: MusicBusId;
  /**
   * The claim it plays for. A claim that takes over the same selection (a
   * building carrying the floor's set on) takes the track over too, so what
   * comes after the song follows the claim still holding it.
   */
  layer: MusicLayer;
  owner: MusicClaimOwner;
  selection: MusicSelection;
  readonly loop: TrackLoopMode;
  readonly offsetS: number;
  readonly fadeInMs: number;
  /** Null while audio is locked, or for a held song. */
  handle: MusicTrackHandle | null;
  audible: boolean;
}

interface PlaylistState {
  order: MusicBusId[];
  pos: number;
}

interface RememberedTrack {
  readonly id: MusicBusId;
  readonly positionS: number;
  readonly atS: number;
}

const SILENCE: MusicSelection = { kind: 'silence' };

function idsOf(selection: MusicSelection): readonly MusicBusId[] {
  switch (selection.kind) {
    case 'silence':
      return [];
    case 'loop':
    case 'held':
      return [selection.id];
    case 'playlist':
      return selection.ids;
  }
}

function playlistKey(ids: readonly MusicBusId[]): string {
  return `playlist:${[...new Set(ids)].sort().join(',')}`;
}

function loopKey(id: MusicBusId, loop: TrackLoopMode): string {
  return `${loop}:${id}`;
}

function sameSelection(a: MusicSelection, b: MusicSelection): boolean {
  switch (a.kind) {
    case 'silence':
      return b.kind === 'silence';
    case 'loop':
      return (
        b.kind === 'loop' && a.id === b.id && (a.skipIntro ?? false) === (b.skipIntro ?? false)
      );
    case 'held':
      return b.kind === 'held' && a.id === b.id;
    case 'playlist':
      return (
        b.kind === 'playlist' &&
        (a.advance ?? false) === (b.advance ?? false) &&
        playlistKey(a.ids) === playlistKey(b.ids)
      );
  }
}

function sameClaim(a: MusicClaim, b: MusicClaim): boolean {
  return (
    a.layer === b.layer && a.fadeInMs === b.fadeInMs && sameSelection(a.selection, b.selection)
  );
}

/** How the `player` layer's claims loop: a repeat plays the whole recording, a play-once ends. */
const PLAYER_LOOP_MODES = {
  repeat: 'whole',
  once: 'once',
} as const satisfies Record<'repeat' | 'once', TrackLoopMode>;

/**
 * The one owner of music. Systems claim music on a layer rather than playing
 * it; the highest claim plays, and releasing a claim falls back to the next
 * one down, so nothing restores music by hand.
 *
 * - A claim for what is already playing changes nothing.
 * - A change is an equal-power crossfade over the incoming claim's fade.
 * - A track that is overridden is remembered with its position; if its
 *   claim wins again within {@link MUSIC_RESUME_WINDOW_S} it resumes there.
 * - Playlists reshuffle after every pass and never play a song twice in a
 *   row, across the reshuffle too.
 * - Every claim unlocks its songs in the run's music library, audible or
 *   not; a song is credited only once the engine reports it sounding.
 *
 * Scene changes run inside {@link beginHandover} / {@link endHandover}:
 * nothing is resolved in between, so a new scene that claims the track
 * already playing carries it on with no restart.
 *
 * Bus pauses and ducks are not claims: they lower the bus and never change
 * what is chosen.
 */
export class MusicDirector implements MusicPlayerControls {
  private readonly claims = new Map<MusicClaimOwner, ClaimEntry>();
  private nextSeq = 0;
  private current: PlayingTrack | null = null;
  private readonly playlists = new Map<string, PlaylistState>();
  private readonly remembered = new Map<string, RememberedTrack>();
  private handoverDepth = 0;
  /** Songs that failed to load; a set skips them until one is heard after all. */
  private readonly unavailable = new Set<MusicBusId>();
  private readonly audibleListeners = new Set<(id: MusicBusId) => void>();
  private mode: MusicPlayerMode = { kind: 'area' };
  private stopShuffleRebuild: (() => void) | null = null;
  private readonly stopFollowingLibrary: () => void;

  constructor(
    private readonly engine: MusicEngine,
    private readonly random: () => number = Math.random,
  ) {
    this.stopFollowingLibrary = onMusicLibraryBound(() => this.libraryRebound());
  }

  /** Adds or replaces `holder`'s claim for `claim.owner`. */
  claim(claim: MusicClaim, holder: MusicClaimHolder | null): void {
    activeMusicLibrary()?.markRequested(idsOf(claim.selection));
    const existing = this.claims.get(claim.owner);
    if (existing?.holder === holder && sameClaim(existing.claim, claim)) {
      return;
    }
    this.claims.set(claim.owner, { claim, holder, seq: this.nextSeq++, advanceSpent: false });
    this.resolve();
  }

  /**
   * Lets go of `owner`'s claim. With a `holder`, only a claim that holder
   * made is released, so a scene being torn down never drops the claim its
   * successor has just made under the same owner.
   */
  release(
    owner: MusicClaimOwner,
    holder: MusicClaimHolder | null,
    opts: MusicReleaseOptions = {},
  ): void {
    const entry = this.claims.get(owner);
    if (entry?.holder !== holder) return;
    this.claims.delete(owner);
    this.resolve(opts.fadeOutMs);
  }

  /** Releases every claim `holder` made. */
  releaseAll(holder: MusicClaimHolder): void {
    let released = false;
    for (const [owner, entry] of this.claims) {
      if (entry.holder !== holder) continue;
      this.claims.delete(owner);
      released = true;
    }
    if (released) this.resolve();
  }

  isClaimed(owner: MusicClaimOwner, holder?: MusicClaimHolder | null): boolean {
    const entry = this.claims.get(owner);
    if (entry === undefined) return false;
    return holder === undefined || entry.holder === holder;
  }

  /** The song really sounding now, or null. */
  get audibleTrack(): MusicBusId | null {
    const current = this.current;
    return current?.audible === true ? current.id : null;
  }

  /** The song playing or waiting on audio to play, or null. */
  get currentTrack(): MusicBusId | null {
    return this.current?.id ?? null;
  }

  /**
   * What an area claim is playing now, for a scene that should carry it on:
   * a building with no soundtrack of its own keeps the floor's. Null when
   * nothing is playing or what plays is not area music.
   */
  get areaSelection(): MusicSelection | null {
    const current = this.current;
    if (current?.layer !== 'area') return null;
    return current.selection;
  }

  /** Whether `selection` is what is playing now, so claiming it would carry it on unchanged. */
  isPlaying(selection: MusicSelection): boolean {
    const current = this.current;
    if (current === null) return selection.kind === 'silence';
    switch (selection.kind) {
      case 'silence':
        return false;
      case 'loop':
        return current.key === loopKey(selection.id, 'loopPoint');
      case 'held':
        return current.kind === 'held' && current.id === selection.id;
      case 'playlist':
        return current.key === playlistKey(selection.ids);
    }
  }

  /** Calls `listener` each time a song starts really sounding. Returns the unsubscribe. */
  onTrackAudible(listener: (id: MusicBusId) => void): () => void {
    this.audibleListeners.add(listener);
    return () => this.audibleListeners.delete(listener);
  }

  /** Holds every resolution until the matching {@link endHandover}. */
  beginHandover(): void {
    this.handoverDepth++;
  }

  endHandover(): void {
    if (this.handoverDepth === 0) return;
    this.handoverDepth--;
    if (this.handoverDepth === 0) this.resolve();
  }

  /** Audio can play again: start whatever was chosen while it could not. */
  engineReady(): void {
    this.resolve();
    const current = this.current;
    if (current !== null && current.handle === null && current.kind !== 'held') {
      this.startHandle(current);
    }
  }

  /**
   * A claimant's own voice for a `held` song started. It counts as audible
   * only while that song's claim is the one winning.
   */
  heldVoiceStarted(id: MusicBusId): void {
    const current = this.current;
    if (current?.kind !== 'held' || current.id !== id) return;
    this.markAudible(current);
  }

  /** Stops the music outright, for an engine shutting down. */
  stopAll(fadeMs: number): void {
    this.stopFollowingLibrary();
    this.stopShuffleRebuild?.();
    this.stopShuffleRebuild = null;
    this.claims.clear();
    this.stopCurrent(fadeMs, 'db');
  }

  get playerMode(): MusicPlayerMode {
    return this.mode;
  }

  playOnce(id: MusicTrackId): void {
    this.setPlayerMode({ kind: 'once', id });
  }

  repeat(id: MusicTrackId): void {
    this.setPlayerMode({ kind: 'repeat', id });
  }

  shuffleUnlocked(): void {
    this.setPlayerMode({ kind: 'shuffle' });
  }

  areaMusic(): void {
    this.setPlayerMode({ kind: 'area' });
  }

  private setPlayerMode(mode: MusicPlayerMode): void {
    this.mode = mode;
    this.stopShuffleRebuild?.();
    this.stopShuffleRebuild = null;
    switch (mode.kind) {
      case 'area':
        this.release('player', null);
        return;
      case 'repeat':
      case 'once':
        // The same song under another mode is the same claim, which would
        // change nothing, so the old one is dropped first.
        this.claims.delete('player');
        this.claim(
          { owner: 'player', layer: 'player', selection: { kind: 'loop', id: mode.id } },
          null,
        );
        return;
      case 'shuffle': {
        const library = activeMusicLibrary();
        this.claimShuffle();
        if (library !== null) this.stopShuffleRebuild = library.onUnlock(() => this.claimShuffle());
        return;
      }
    }
  }

  /**
   * A load bound another run's library: a shuffle is rebuilt from, and grows
   * with, the new save's songs, and a chosen song the new save has not
   * unlocked hands the music back to the area.
   */
  private libraryRebound(): void {
    const mode = this.mode;
    switch (mode.kind) {
      case 'area':
        return;
      case 'shuffle':
        this.setPlayerMode(mode);
        return;
      case 'repeat':
      case 'once': {
        const library = activeMusicLibrary();
        if (library !== null && !library.isUnlocked(mode.id)) this.areaMusic();
        return;
      }
    }
  }

  private claimShuffle(): void {
    const unlocked = activeMusicLibrary()?.unlocked ?? [];
    if (unlocked.length === 0) {
      this.release('player', null);
      return;
    }
    this.claim(
      { owner: 'player', layer: 'player', selection: { kind: 'playlist', ids: unlocked } },
      null,
    );
  }

  private winningEntry(): ClaimEntry | null {
    let best: ClaimEntry | null = null;
    let bestRank = -1;
    for (const entry of this.claims.values()) {
      const rank = MUSIC_LAYERS.indexOf(entry.claim.layer);
      if (rank > bestRank || (rank === bestRank && best !== null && entry.seq > best.seq)) {
        best = entry;
        bestRank = rank;
      }
    }
    return best;
  }

  /** How a winning claim's loop selection repeats: the player's repeat and play-once differ. */
  private loopModeOf(entry: ClaimEntry): TrackLoopMode {
    if (entry.claim.owner !== 'player') return 'loopPoint';
    const mode = this.mode;
    return mode.kind === 'repeat' || mode.kind === 'once'
      ? PLAYER_LOOP_MODES[mode.kind]
      : 'loopPoint';
  }

  private resolve(transitionFadeMs?: number): void {
    if (this.handoverDepth > 0) return;
    const winner = this.winningEntry();
    const selection = winner?.claim.selection ?? SILENCE;
    if (winner === null || selection.kind === 'silence') {
      this.stopCurrent(transitionFadeMs ?? MUSIC_SILENCE_FADE_MS, 'db');
      return;
    }
    const fadeMs =
      transitionFadeMs ?? winner.claim.fadeInMs ?? MUSIC_LAYER_FADE_MS[winner.claim.layer];
    switch (selection.kind) {
      case 'held':
        this.resolveHeld(winner, selection, fadeMs);
        return;
      case 'loop':
        this.resolveLoop(winner, selection, fadeMs);
        return;
      case 'playlist':
        this.resolvePlaylist(winner, selection, fadeMs);
        return;
    }
  }

  private resolveHeld(
    winner: ClaimEntry,
    selection: Extract<MusicSelection, { kind: 'held' }>,
    fadeMs: number,
  ): void {
    const key = `held:${selection.id}`;
    if (this.carriesOn(winner, key, selection)) return;
    this.stopCurrent(fadeMs, 'equalPowerOut');
    this.current = {
      key,
      kind: 'held',
      id: selection.id,
      layer: winner.claim.layer,
      owner: winner.claim.owner,
      selection,
      loop: 'once',
      offsetS: 0,
      fadeInMs: fadeMs,
      handle: null,
      audible: false,
    };
  }

  private resolveLoop(
    winner: ClaimEntry,
    selection: Extract<MusicSelection, { kind: 'loop' }>,
    fadeMs: number,
  ): void {
    const loop = this.loopModeOf(winner);
    const key = loopKey(selection.id, loop);
    if (this.carriesOn(winner, key, selection)) return;
    const loopStartS = loop === 'loopPoint' ? (musicLoopStartS(selection.id) ?? 0) : 0;
    const remembered = this.takeRemembered(key);
    let offsetS = selection.skipIntro === true ? loopStartS : 0;
    if (remembered !== null) offsetS = remembered.fresh ? remembered.track.positionS : loopStartS;
    this.startTrack(winner, selection, key, 'loop', selection.id, loop, offsetS, fadeMs);
  }

  private resolvePlaylist(
    winner: ClaimEntry,
    selection: Extract<MusicSelection, { kind: 'playlist' }>,
    fadeMs: number,
  ): void {
    if (selection.ids.length === 0) {
      this.stopCurrent(fadeMs, 'db');
      return;
    }
    const key = playlistKey(selection.ids);
    const wantsAdvance = selection.advance === true && !winner.advanceSpent;
    winner.advanceSpent = true;
    const current = this.current;
    if (this.carriesOn(winner, key, selection)) {
      if (wantsAdvance) this.playNextInPlaylist(key, selection.ids, fadeMs);
      return;
    }
    if (this.adoptsPlayingSong(winner, current, selection, key)) return;
    const remembered = this.takeRemembered(key);
    const state = this.playlistState(key, selection.ids);
    if (remembered !== null && remembered.fresh && !wantsAdvance) {
      const index = state.order.indexOf(remembered.track.id);
      if (index >= 0) state.pos = index;
      this.startTrack(
        winner,
        selection,
        key,
        'playlist',
        remembered.track.id,
        'once',
        remembered.track.positionS,
        fadeMs,
      );
      return;
    }
    if (!this.stepToPlayable(state)) {
      this.stopCurrent(fadeMs, 'db');
      if (winner.claim.owner === 'player') this.areaMusic();
      return;
    }
    this.startTrack(winner, selection, key, 'playlist', state.order[state.pos], 'once', 0, fadeMs);
  }

  /**
   * A set rebuilt by its own owner while one of its songs plays (a shuffle of
   * unlocked songs growing) carries that song on rather than starting over.
   */
  private adoptsPlayingSong(
    winner: ClaimEntry,
    current: PlayingTrack | null,
    selection: Extract<MusicSelection, { kind: 'playlist' }>,
    key: string,
  ): boolean {
    if (current?.kind !== 'playlist') return false;
    if (current.owner !== winner.claim.owner || !selection.ids.includes(current.id)) return false;
    const rest = this.shuffled(selection.ids.filter((id) => id !== current.id));
    this.playlists.set(key, { order: [current.id, ...rest], pos: 0 });
    current.key = key;
    this.carriesOn(winner, key, selection);
    return true;
  }

  /**
   * Whether what plays is already `key`; if so the winning claim takes it
   * over, so a set carried on by a new owner still moves on when a song ends.
   */
  private carriesOn(winner: ClaimEntry, key: string, selection: MusicSelection): boolean {
    const current = this.current;
    if (current?.key !== key) return false;
    current.owner = winner.claim.owner;
    current.layer = winner.claim.layer;
    current.selection = selection;
    return true;
  }

  private playlistState(key: string, ids: readonly MusicBusId[]): PlaylistState {
    const existing = this.playlists.get(key);
    if (existing !== undefined) return existing;
    const state: PlaylistState = { order: this.shuffled([...new Set(ids)]), pos: -1 };
    this.playlists.set(key, state);
    return state;
  }

  /** Moves a set on one song, reshuffling at the end of a pass so its last song never comes next. */
  private stepPlaylist(state: PlaylistState): void {
    const next = state.pos + 1;
    if (next < state.order.length) {
      state.pos = next;
      return;
    }
    const last = state.order[state.order.length - 1];
    let order = this.shuffled(state.order);
    if (order.length > 1 && order[0] === last) {
      const swapWith = 1 + Math.floor(this.random() * (order.length - 1));
      order = [...order];
      [order[0], order[swapWith]] = [order[swapWith], order[0]];
    }
    state.order = order;
    state.pos = 0;
  }

  /**
   * Moves a set on to its next song that can load. False when none can, so
   * the caller ends the set rather than fetching a dead song forever.
   */
  private stepToPlayable(state: PlaylistState): boolean {
    if (state.order.every((id) => this.unavailable.has(id))) return false;
    do this.stepPlaylist(state);
    while (this.unavailable.has(state.order[state.pos]));
    return true;
  }

  private playNextInPlaylist(key: string, ids: readonly MusicBusId[], fadeMs: number): void {
    const current = this.current;
    if (current === null) return;
    const state = this.playlistState(key, ids);
    if (state.pos < 0) state.pos = Math.max(0, state.order.indexOf(current.id));
    if (!this.stepToPlayable(state)) return;
    const entry = this.claims.get(current.owner);
    if (entry === undefined) return;
    const selection = current.selection;
    this.stopCurrent(fadeMs, 'equalPowerOut', false);
    this.startTrack(entry, selection, key, 'playlist', state.order[state.pos], 'once', 0, fadeMs);
  }

  private shuffled<T>(items: readonly T[]): T[] {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** The remembered position for `key`, and whether it is recent enough to resume. */
  private takeRemembered(key: string): { track: RememberedTrack; fresh: boolean } | null {
    const track = this.remembered.get(key);
    if (track === undefined) return null;
    this.remembered.delete(key);
    return { track, fresh: this.engine.nowS() - track.atS <= MUSIC_RESUME_WINDOW_S };
  }

  private startTrack(
    winner: ClaimEntry,
    selection: MusicSelection,
    key: string,
    kind: 'loop' | 'playlist',
    id: MusicBusId,
    loop: TrackLoopMode,
    offsetS: number,
    fadeMs: number,
  ): void {
    this.stopCurrent(fadeMs, 'equalPowerOut');
    const track: PlayingTrack = {
      key,
      kind,
      id,
      layer: winner.claim.layer,
      owner: winner.claim.owner,
      selection,
      loop,
      offsetS,
      fadeInMs: fadeMs,
      handle: null,
      audible: false,
    };
    this.current = track;
    if (this.engine.canPlay()) this.startHandle(track);
  }

  private startHandle(track: PlayingTrack): void {
    track.handle = this.engine.startTrack({
      id: track.id,
      loop: track.loop,
      offsetS: track.offsetS,
      fadeInMs: track.fadeInMs,
      onEnded: () => this.trackEnded(track),
      onUnavailable: () => this.trackUnavailable(track),
      onPlaying: () => {
        if (this.current === track) this.markAudible(track);
      },
    });
  }

  private markAudible(track: PlayingTrack): void {
    const firstReport = !track.audible;
    track.audible = true;
    this.unavailable.delete(track.id);
    if (!firstReport) return;
    activeMusicLibrary()?.markAudible(track.id);
    for (const listener of this.audibleListeners) listener(track.id);
  }

  /**
   * A song that cannot load is passed over as if it had ended: a set moves on
   * and a play-once lets go. A repeat of it would be silence for good, so the
   * player's choice goes back to the area.
   */
  private trackUnavailable(track: PlayingTrack): void {
    if (this.current !== track) return;
    this.unavailable.add(track.id);
    if (track.owner === 'player' && this.mode.kind === 'repeat') {
      this.areaMusic();
      return;
    }
    this.trackEnded(track);
  }

  private trackEnded(track: PlayingTrack): void {
    if (this.current !== track) return;
    track.handle = null;
    if (track.owner === 'player' && this.mode.kind === 'once') {
      this.current = null;
      this.mode = { kind: 'area' };
      this.claims.delete('player');
      this.resolve();
      return;
    }
    if (track.kind !== 'playlist' || track.selection.kind !== 'playlist') return;
    const entry = this.claims.get(track.owner);
    const state = this.playlistState(track.key, track.selection.ids);
    this.current = null;
    if (!this.stepToPlayable(state)) {
      if (track.owner === 'player') this.areaMusic();
      return;
    }
    if (entry === undefined) return;
    this.startTrack(
      entry,
      track.selection,
      track.key,
      'playlist',
      state.order[state.pos],
      'once',
      0,
      0,
    );
  }

  /**
   * Fades out what is playing, remembering where it stood so its claim can
   * resume it. A skipped song is not remembered: moving a set on means
   * leaving that song behind.
   */
  private stopCurrent(fadeMs: number, shape: TrackStopShape, remember = true): void {
    const current = this.current;
    if (current === null) return;
    this.current = null;
    if (remember && current.kind !== 'held') {
      this.remembered.set(current.key, {
        id: current.id,
        positionS: current.handle?.positionS() ?? current.offsetS,
        atS: this.engine.nowS(),
      });
    }
    current.handle?.stop(fadeMs, shape);
  }
}
