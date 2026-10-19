/**
 * The music director's behaviour, for `verify-audio.ts`: which claim plays,
 * what a release falls back to, what a scene change carries, what resumes,
 * what unlocks and what is credited. A real `AudioManager` over the fake
 * graph; imported after the fake audio and the browser shim are installed.
 */

import { AudioManager } from '../../src/audio/AudioManager.js';
import { KEYBOARD_HERO_SONG } from '../../src/audio/AudioScope.js';
import {
  MUSIC_RESUME_WINDOW_S,
  type MusicClaim,
  type MusicClaimOwner,
  type MusicLayer,
  type MusicSelection,
} from '../../src/audio/music/MusicDirector.js';
import {
  CLUB_MUSIC_TRACKS,
  SLOTS_FREE_SPINS_MUSIC_TRACKS,
  SOUND_MANIFEST,
  TOWN_MUSIC_TRACKS,
  type MusicBusId,
  type MusicTrackId,
} from '../../src/audio/sounds.js';
import {
  ALWAYS_UNLOCKED_TRACK_IDS,
  bindMusicLibrary,
  MusicLibrary,
} from '../../src/core/MusicLibrary.js';
import {
  seededStreams,
  type AudioHarness,
  type FakeAudioElement,
  type SourceRecord,
} from '../audioHarness.js';

type Check = (ok: boolean, message: string) => void;
type Manager = InstanceType<typeof AudioManager>;

/** Long enough for any claim's fade to finish. */
const SETTLE_MS = 3000;
const MS_PER_SECOND = 1000;
/** How long a track plays before it is overridden, in the resume checks. */
const PLAYED_BEFORE_OVERRIDE_S = 20;
/** An override short enough to resume from. */
const SHORT_OVERRIDE_S = 10;
/** Slack on a resumed position: the fades either side of the override. */
const RESUME_TOLERANCE_S = 8;
/** Recordings that must not end while a check is looking at them. */
const LONG_RECORDING_S = 1000;
/** Recordings a check plays through end to end. */
const SHORT_RECORDING_S = 5;
/** A play-once song, shorter than the track it plays over has been running. */
const PLAY_ONCE_RECORDING_S = 8;
/** Seeded streams the shuffle check runs across, so a pass is never one lucky draw. */
const SHUFFLE_STREAMS = 12;
/** Songs played per stream: several passes of a three-song set, so reshuffles are crossed. */
const SHUFFLE_SONGS_PER_STREAM = 15;
const SHUFFLE_SEED = 9;
const SHUFFLE_SET = [
  'forest_path',
  'terrifying_woods',
  'briar_hollow_theme',
] as const satisfies readonly MusicTrackId[];

/** Key presses made after a song fails to load, each a chance to fetch it again. */
const KEY_PRESSES_AFTER_A_FAILED_LOAD = 3;
/** The streamed song the title screen claims before any gesture. */
const GESTURE_GATED_TRACK = 'welcome_to_the_dungeon' as const satisfies MusicTrackId;

/** `MediaError.MEDIA_ERR_NETWORK`: the download broke off after the element had started. */
const MEDIA_ERR_NETWORK = 2;

/** Holds claims the way a scene's scope does: one object per scene. */
type Holder = object;

function loopOf(id: MusicBusId): MusicSelection {
  return { kind: 'loop', id };
}

function claimOn(
  audio: Manager,
  holder: Holder,
  owner: MusicClaimOwner,
  layer: MusicLayer,
  selection: MusicSelection,
): void {
  const claim: MusicClaim = { owner, layer, selection };
  audio.music.claim(claim, holder);
}

interface DirectorRig {
  readonly audio: Manager;
  readonly library: MusicLibrary;
  /** Every song reported audible, in order. */
  readonly audible: MusicBusId[];
  settle(ms?: number): Promise<void>;
  /** The element playing `id` now, if any. */
  sounding(id: MusicBusId): FakeAudioElement | null;
  /** Disposes the manager and lets its fades and pauses finish, so no element of it sounds on. */
  dispose(): Promise<void>;
}

async function rig(harness: AudioHarness, random?: () => number): Promise<DirectorRig> {
  const audio = new AudioManager({ musicRandom: random });
  const library = new MusicLibrary();
  bindMusicLibrary(library);
  const audible: MusicBusId[] = [];
  audio.music.onTrackAudible((id) => audible.push(id));
  await harness.flush();
  return {
    audio,
    library,
    audible,
    async settle(ms = SETTLE_MS) {
      harness.advance(ms);
      await harness.flush();
    },
    sounding(id) {
      return harness.elements().find((el) => !el.paused && el.src === SOUND_MANIFEST[id]) ?? null;
    },
    async dispose() {
      bindMusicLibrary(null);
      audio.dispose();
      harness.advance(SETTLE_MS);
      await harness.flush();
    },
  };
}

function setDurations(harness: AudioHarness, ids: readonly MusicBusId[], seconds: number): void {
  for (const id of ids) harness.setDuration(SOUND_MANIFEST[id], seconds);
}

/** 1. The highest claim wins, a release falls back, and a same-track claim never restarts it. */
export async function checkHighestClaimWins(harness: AudioHarness, check: Check): Promise<void> {
  setDurations(
    harness,
    ['bg_level_1', 'brace_for_the_horde', 'fix_the_plumbing_music'],
    LONG_RECORDING_S,
  );
  const r = await rig(harness);
  const scene = {};
  claimOn(r.audio, scene, 'floor', 'area', loopOf('bg_level_1'));
  await r.settle();
  check(r.audio.music.audibleTrack === 'bg_level_1', 'an area claim plays');
  claimOn(r.audio, scene, 'defend_quest', 'battle', loopOf('brace_for_the_horde'));
  claimOn(r.audio, scene, 'pipe_board', 'activity', loopOf('fix_the_plumbing_music'));
  await r.settle();
  check(
    r.audio.music.audibleTrack === 'brace_for_the_horde',
    `a battle claim outranks a newer activity claim (${r.audio.music.audibleTrack ?? 'none'})`,
  );
  r.audio.music.release('defend_quest', scene);
  await r.settle();
  check(
    r.audio.music.audibleTrack === 'fix_the_plumbing_music',
    'releasing the battle claim falls back to the activity claim',
  );
  r.audio.music.release('pipe_board', scene);
  await r.settle();
  check(r.audio.music.audibleTrack === 'bg_level_1', 'and releasing that falls back to the area');
  const heardBefore = r.audible.length;
  const element = r.sounding('bg_level_1');
  const positionBefore = element?.currentTime ?? Number.NaN;
  claimOn(r.audio, scene, 'interior', 'area', loopOf('bg_level_1'));
  claimOn(r.audio, scene, 'floor', 'area', loopOf('bg_level_1'));
  await r.settle();
  check(
    r.audible.length === heardBefore &&
      element !== null &&
      !element.paused &&
      element.currentTime > positionBefore,
    'claiming the track already playing carries it on rather than restarting it',
  );
  await r.dispose();
}

/** 2. A scene change whose new scene claims the playing track carries it with no restart. */
export async function checkHandover(harness: AudioHarness, check: Check): Promise<void> {
  setDurations(harness, ['bg_level_2'], LONG_RECORDING_S);
  const r = await rig(harness);
  const leaving = {};
  claimOn(r.audio, leaving, 'floor', 'area', loopOf('bg_level_2'));
  await r.settle();
  const element = r.sounding('bg_level_2');
  const silencesBefore = harness.silences.length;
  const heardBefore = r.audible.length;
  const arriving = {};
  r.audio.music.beginHandover();
  r.audio.music.releaseAll(leaving);
  claimOn(r.audio, arriving, 'floor', 'area', loopOf('bg_level_2'));
  r.audio.music.endHandover();
  await r.settle();
  check(
    element !== null &&
      !element.paused &&
      r.audible.length === heardBefore &&
      harness.silences.length === silencesBefore,
    'a new scene claiming the playing track keeps it playing across the handover',
  );
  r.audio.music.release('floor', leaving);
  check(
    r.audio.music.isClaimed('floor'),
    "a departing scene's release never drops the claim its successor made",
  );
  r.audio.music.releaseAll(arriving);
  await r.dispose();

  setDurations(harness, SHUFFLE_SET, SHORT_RECORDING_S);
  const carry = await rig(harness);
  const outside = {};
  const playlist: MusicSelection = { kind: 'playlist', ids: SHUFFLE_SET };
  claimOn(carry.audio, outside, 'overworld_zone', 'area', playlist);
  await carry.settle();
  const carriedSong = carry.audio.music.audibleTrack;
  const building = {};
  carry.audio.music.beginHandover();
  carry.audio.music.releaseAll(outside);
  const walkedInWith = carry.audio.music.areaSelection;
  if (walkedInWith !== null) claimOn(carry.audio, building, 'interior', 'area', walkedInWith);
  carry.audio.music.endHandover();
  claimOn(carry.audio, building, 'interior', 'area', { ...playlist, advance: true });
  await carry.settle();
  const advancedTo = carry.audio.music.audibleTrack;
  check(
    carriedSong !== null && advancedTo !== null && advancedTo !== carriedSong,
    `an advancing claim of the carried set changes the song (${carriedSong ?? 'none'} → ${advancedTo ?? 'none'})`,
  );
  await carry.settle(SHORT_RECORDING_S * MS_PER_SECOND);
  const nextSong = carry.audio.music.audibleTrack;
  check(
    advancedTo !== null && nextSong !== null && nextSong !== advancedTo,
    `and the carried set moves on when that song ends (${advancedTo ?? 'none'} → ${nextSong ?? 'none'})`,
  );
  await carry.dispose();
}

/** 3. A short override resumes the track's position; a long one moves the set on. */
export async function checkResume(harness: AudioHarness, check: Check): Promise<void> {
  setDurations(harness, ['bg_level_1', 'boss_music_1', ...TOWN_MUSIC_TRACKS], LONG_RECORDING_S);
  const r = await rig(harness);
  const scene = {};
  claimOn(r.audio, scene, 'floor', 'area', loopOf('bg_level_1'));
  await r.settle(PLAYED_BEFORE_OVERRIDE_S * MS_PER_SECOND);
  claimOn(r.audio, scene, 'boss', 'boss', loopOf('boss_music_1'));
  await r.settle(SHORT_OVERRIDE_S * MS_PER_SECOND);
  r.audio.music.release('boss', scene);
  await r.settle(SETTLE_MS);
  const resumed = r.sounding('bg_level_1')?.currentTime ?? Number.NaN;
  const expected = PLAYED_BEFORE_OVERRIDE_S + SETTLE_MS / MS_PER_SECOND;
  check(
    Math.abs(resumed - expected) <= RESUME_TOLERANCE_S,
    `a short boss fight resumes the floor's track where it was (${resumed.toFixed(1)} s, about ${expected} s)`,
  );

  claimOn(r.audio, scene, 'overworld_zone', 'area', {
    kind: 'playlist',
    ids: TOWN_MUSIC_TRACKS,
  });
  await r.settle();
  const before = r.audio.music.audibleTrack;
  claimOn(r.audio, scene, 'boss', 'boss', loopOf('boss_music_1'));
  await r.settle((MUSIC_RESUME_WINDOW_S + SHORT_OVERRIDE_S) * MS_PER_SECOND);
  r.audio.music.release('boss', scene);
  await r.settle();
  const after = r.audio.music.audibleTrack;
  check(
    before !== null && after !== null && after !== before,
    `a long override moves the playlist on to its next song (${before ?? 'none'} → ${after ?? 'none'})`,
  );
  await r.dispose();
}

/** 4. A playlist claim unlocks every member; only an audible song is credited, once. */
export async function checkUnlockAndCredit(harness: AudioHarness, check: Check): Promise<void> {
  setDurations(harness, CLUB_MUSIC_TRACKS, SHORT_RECORDING_S);
  const r = await rig(harness);
  claimOn(r.audio, {}, 'interior', 'area', { kind: 'playlist', ids: CLUB_MUSIC_TRACKS });
  check(
    CLUB_MUSIC_TRACKS.every((id) => r.library.isUnlocked(id)),
    'a playlist claim unlocks every song in it at once',
  );
  await r.settle(SHORT_RECORDING_S * MS_PER_SECOND - SETTLE_MS);
  const first = r.audio.music.audibleTrack;
  const heardAfterFirst = CLUB_MUSIC_TRACKS.filter((id) => r.library.isHeard(id));
  check(
    first !== null && heardAfterFirst.length === 1 && heardAfterFirst[0] === first,
    `only the audible song is credited (${heardAfterFirst.join(', ') || 'none'})`,
  );
  await r.settle(SHORT_RECORDING_S * MS_PER_SECOND);
  const second = r.audio.music.audibleTrack;
  const credits = r.library
    .drainNotices()
    .filter((notice) => notice.kind === 'attribution')
    .map((notice) => notice.id);
  check(
    second !== null &&
      second !== first &&
      credits.length === 2 &&
      credits[0] === first &&
      credits[1] === second,
    `the next song is credited when it plays, each once (${credits.join(', ')})`,
  );
  await r.dispose();
}

/** 5. Under repeat, area claims unlock but play nothing; releasing it plays the latest area claim. */
export async function checkPlayerModes(harness: AudioHarness, check: Check): Promise<void> {
  setDurations(harness, ['temple_music', 'bg_level_1', ...TOWN_MUSIC_TRACKS], LONG_RECORDING_S);
  const r = await rig(harness);
  const scene = {};
  claimOn(r.audio, scene, 'floor', 'area', loopOf('bg_level_1'));
  r.audio.music.repeat('temple_music');
  await r.settle();
  claimOn(r.audio, scene, 'overworld_zone', 'area', { kind: 'playlist', ids: TOWN_MUSIC_TRACKS });
  claimOn(r.audio, scene, 'boss', 'boss', loopOf('boss_music_1'));
  await r.settle();
  check(
    r.audio.music.audibleTrack === 'temple_music',
    `the player's repeat outranks area and boss claims (${r.audio.music.audibleTrack ?? 'none'})`,
  );
  check(
    TOWN_MUSIC_TRACKS.every((id) => r.library.isUnlocked(id)) &&
      TOWN_MUSIC_TRACKS.every((id) => !r.library.isHeard(id)),
    'the claims under it still unlock their songs, unheard',
  );
  r.audio.music.release('boss', scene);
  r.audio.music.areaMusic();
  await r.settle();
  const now = r.audio.music.audibleTrack;
  check(
    now !== null && TOWN_MUSIC_TRACKS.some((id) => id === now),
    `area music plays the latest area claim (${now ?? 'none'})`,
  );
  await r.dispose();
}

/** Part of 5: the player's mode follows the run's library when a load binds another one. */
export async function checkPlayerModesFollowTheLibrary(
  harness: AudioHarness,
  check: Check,
): Promise<void> {
  setDurations(harness, [...TOWN_MUSIC_TRACKS, 'temple_music'], LONG_RECORDING_S);
  // Every library holds these, so they sit in both shuffles; kept short so
  // they never stand between a check and the songs it is about.
  setDurations(harness, ALWAYS_UNLOCKED_TRACK_IDS, SHORT_RECORDING_S);
  const r = await rig(harness);
  r.library.markRequested(['temple_music', 'town_music_1']);
  r.audio.music.shuffleUnlocked();
  await r.settle();
  const reloaded = new MusicLibrary();
  reloaded.markRequested(['town_music_2']);
  bindMusicLibrary(reloaded);
  const audibleBeforeReload = r.audible.length;
  await r.settle();
  await r.settle(SHORT_RECORDING_S * MS_PER_SECOND);
  check(
    r.audio.music.audibleTrack === 'town_music_2',
    `a shuffle after a reload plays the reloaded save's songs (${r.audio.music.audibleTrack ?? 'none'})`,
  );
  r.library.markRequested(['town_music_1', 'tavern_music_1']);
  reloaded.markRequested(['temple_music']);
  await r.settle(LONG_RECORDING_S * MS_PER_SECOND);
  const heardAfterReload = new Set(r.audible.slice(audibleBeforeReload));
  check(
    !heardAfterReload.has('tavern_music_1') && heardAfterReload.has('temple_music'),
    "and grows with the reloaded save's unlocks, not the old save's",
  );
  r.audio.music.repeat('town_music_2');
  bindMusicLibrary(new MusicLibrary());
  await r.settle();
  check(
    r.audio.music.playerMode.kind === 'area' && !r.audio.music.isClaimed('player'),
    'a repeat of a song the newly loaded save has not unlocked goes back to area music',
  );
  await r.dispose();
}

/** 6. A play-once releases on `ended`, and the music under it resumes. */
export async function checkPlayOnce(harness: AudioHarness, check: Check): Promise<void> {
  setDurations(harness, ['bg_level_1'], LONG_RECORDING_S);
  setDurations(harness, ['temple_music'], PLAY_ONCE_RECORDING_S);
  const r = await rig(harness);
  claimOn(r.audio, {}, 'floor', 'area', loopOf('bg_level_1'));
  await r.settle(PLAYED_BEFORE_OVERRIDE_S * MS_PER_SECOND);
  r.audio.music.playOnce('temple_music');
  await r.settle();
  check(r.audio.music.audibleTrack === 'temple_music', 'play-once plays the chosen song');
  await r.settle(PLAY_ONCE_RECORDING_S * MS_PER_SECOND);
  const resumed = r.sounding('bg_level_1')?.currentTime ?? Number.NaN;
  check(
    r.audio.music.playerMode.kind === 'area' &&
      !r.audio.music.isClaimed('player') &&
      r.audio.music.audibleTrack === 'bg_level_1',
    'when it ends its claim is released and the floor track comes back',
  );
  const expected = PLAYED_BEFORE_OVERRIDE_S + SETTLE_MS / MS_PER_SECOND;
  check(
    Math.abs(resumed - expected) <= RESUME_TOLERANCE_S,
    `from where it was (${resumed.toFixed(1)} s, about ${expected} s)`,
  );
  await r.dispose();
}

/**
 * Part of 6: a decoded song with no buffer yet (the keyboard-hero song, away
 * from the floor that decodes it) plays once it has decoded, and one that
 * cannot load hands the music back to the area.
 */
export async function checkPlayOnceOfAnUndecodedSong(
  harness: AudioHarness,
  check: Check,
): Promise<void> {
  setDurations(harness, ['bg_level_1'], LONG_RECORDING_S);
  harness.setDuration(SOUND_MANIFEST[KEYBOARD_HERO_SONG], PLAY_ONCE_RECORDING_S);
  const r = await rig(harness);
  claimOn(r.audio, {}, 'floor', 'area', loopOf('bg_level_1'));
  await r.settle();
  r.audio.music.playOnce(KEYBOARD_HERO_SONG);
  await r.settle();
  check(
    r.audio.music.audibleTrack === KEYBOARD_HERO_SONG,
    `a play-once of a song not yet decoded plays once it decodes (${r.audio.music.audibleTrack ?? 'none'})`,
  );
  await r.settle(PLAY_ONCE_RECORDING_S * MS_PER_SECOND + SETTLE_MS);
  check(
    r.audio.music.playerMode.kind === 'area' && r.audio.music.audibleTrack === 'bg_level_1',
    'and hands back to the area when it ends',
  );
  await r.dispose();

  const decodingFetch: unknown = Reflect.get(globalThis, 'fetch');
  Reflect.set(globalThis, 'fetch', (url: string) =>
    url === SOUND_MANIFEST[KEYBOARD_HERO_SONG]
      ? Promise.resolve({ ok: false, status: 404 })
      : typeof decodingFetch === 'function'
        ? Reflect.apply(decodingFetch, globalThis, [url])
        : Promise.reject(new Error('no fetch')),
  );
  const failing = await rig(harness);
  claimOn(failing.audio, {}, 'floor', 'area', loopOf('bg_level_1'));
  await failing.settle();
  failing.audio.music.repeat(KEYBOARD_HERO_SONG);
  await failing.settle();
  check(
    failing.audio.music.playerMode.kind === 'area' &&
      failing.audio.music.audibleTrack === 'bg_level_1',
    `a repeat of a song that cannot load goes back to area music (${failing.audio.music.playerMode.kind})`,
  );
  await failing.dispose();

  const fetchesOfTheSong = { count: 0 };
  const failingFetch: unknown = Reflect.get(globalThis, 'fetch');
  Reflect.set(globalThis, 'fetch', (url: string) => {
    if (url === SOUND_MANIFEST[KEYBOARD_HERO_SONG]) fetchesOfTheSong.count++;
    return typeof failingFetch === 'function'
      ? Reflect.apply(failingFetch, globalThis, [url])
      : Promise.reject(new Error('no fetch'));
  });
  setDurations(harness, ALWAYS_UNLOCKED_TRACK_IDS, LONG_RECORDING_S);

  // The always-unlocked songs stream, and a stream never fails to load, so no
  // library leaves a shuffle with nothing playable any more. The shuffle's set
  // is narrowed to the failing song by hand, which is the set a library of
  // only decoded songs would give it.
  const lonely = await rig(harness);
  claimOn(lonely.audio, {}, 'floor', 'area', loopOf('bg_level_1'));
  await lonely.settle();
  lonely.audio.music.shuffleUnlocked();
  await lonely.settle();
  // Unlocked while the shuffle plays, so the narrowed claim below unlocks
  // nothing new and the shuffle does not rebuild itself over it.
  lonely.library.markRequested([KEYBOARD_HERO_SONG]);
  await lonely.settle();
  check(
    lonely.audio.music.playerMode.kind === 'shuffle',
    'the shuffle is playing before its set is narrowed',
  );
  lonely.audio.music.claim(
    {
      owner: 'player',
      layer: 'player',
      selection: { kind: 'playlist', ids: [KEYBOARD_HERO_SONG] },
    },
    null,
  );
  await lonely.settle();
  await lonely.settle();
  check(
    fetchesOfTheSong.count <= 1 &&
      lonely.audio.music.playerMode.kind === 'area' &&
      lonely.audio.music.audibleTrack === 'bg_level_1',
    `a shuffle whose only song cannot load fetches it once and goes back to area music (${fetchesOfTheSong.count} fetches, ${lonely.audio.music.playerMode.kind})`,
  );
  await lonely.dispose();

  fetchesOfTheSong.count = 0;
  const mixed = await rig(harness);
  claimOn(mixed.audio, {}, 'floor', 'area', loopOf('bg_level_1'));
  await mixed.settle();
  const withTheFailingSong = new MusicLibrary();
  withTheFailingSong.markRequested([KEYBOARD_HERO_SONG]);
  bindMusicLibrary(withTheFailingSong);
  mixed.audio.music.shuffleUnlocked();
  await mixed.settle();
  await mixed.settle();
  Reflect.set(globalThis, 'fetch', decodingFetch);
  const playingInstead = mixed.audio.music.audibleTrack;
  check(
    fetchesOfTheSong.count <= 1 &&
      mixed.audio.music.playerMode.kind === 'shuffle' &&
      ALWAYS_UNLOCKED_TRACK_IDS.some((id) => id === playingInstead),
    `a shuffle holding a song that cannot load fetches it once and plays the rest (${fetchesOfTheSong.count} fetches, ${playingInstead ?? 'nothing'})`,
  );
  await mixed.dispose();
}

/** 7. A claim made behind the autoplay lock is credited only once audio really plays. */
export async function checkAutoplayLock(
  harness: AudioHarness,
  check: Check,
  unlockGesture: (type: string) => void,
): Promise<void> {
  setDurations(harness, ['bg_level_2'], LONG_RECORDING_S);
  const r = await rig(harness);
  void harness.context().suspend();
  claimOn(r.audio, {}, 'floor', 'area', loopOf('bg_level_2'));
  await r.settle();
  check(
    r.library.isUnlocked('bg_level_2') &&
      !r.library.isHeard('bg_level_2') &&
      r.audio.music.audibleTrack === null &&
      r.sounding('bg_level_2') === null,
    'a claim behind the lock unlocks its song but neither plays nor credits it',
  );
  unlockGesture('keydown');
  await r.settle();
  check(
    r.library.isHeard('bg_level_2') && r.audio.music.audibleTrack === 'bg_level_2',
    'once audio unlocks the director starts it, and only then credits it',
  );
  await r.dispose();

  setDurations(harness, [GESTURE_GATED_TRACK], LONG_RECORDING_S);
  harness.mediaNeedsGesture = true;
  try {
    const tapped = await rig(harness);
    void harness.context().suspend();
    claimOn(tapped.audio, {}, 'title', 'area', loopOf(GESTURE_GATED_TRACK));
    await tapped.settle();
    unlockGesture('touchend');
    await tapped.settle();
    check(
      tapped.sounding(GESTURE_GATED_TRACK) !== null,
      "a tap's touchend unlocks audio and starts the waiting stream inside the gesture",
    );
    await tapped.dispose();

    const refused = await rig(harness);
    claimOn(refused.audio, {}, 'title', 'area', loopOf(GESTURE_GATED_TRACK));
    await refused.settle();
    const refusedOutsideGesture = refused.sounding(GESTURE_GATED_TRACK) === null;
    unlockGesture('keydown');
    await refused.settle();
    check(
      refusedOutsideGesture && refused.sounding(GESTURE_GATED_TRACK) !== null,
      'a stream refused outside a gesture, with the context already running, starts on the next gesture',
    );
    await refused.dispose();
  } finally {
    harness.mediaNeedsGesture = false;
  }

  const osPaused = await rig(harness);
  claimOn(osPaused.audio, {}, 'title', 'area', loopOf(GESTURE_GATED_TRACK));
  await osPaused.settle();
  const element = osPaused.sounding(GESTURE_GATED_TRACK);
  element?.pause();
  await osPaused.settle();
  const silentAfterSystemPause = osPaused.sounding(GESTURE_GATED_TRACK) === null;
  unlockGesture('keydown');
  await osPaused.settle();
  check(
    element !== null && silentAfterSystemPause && !element.paused,
    'a stream the system paused itself, with the context running, restarts on the next key press',
  );
  await osPaused.dispose();

  const brokenOff = await rig(harness);
  claimOn(brokenOff.audio, {}, 'title', 'area', loopOf(GESTURE_GATED_TRACK));
  await brokenOff.settle();
  const failed = brokenOff.sounding(GESTURE_GATED_TRACK);
  const positionAtFailureS = failed?.currentTime ?? 0;
  if (failed !== null) failed.error = { code: MEDIA_ERR_NETWORK };
  unlockGesture('keydown');
  await brokenOff.settle();
  check(
    failed !== null &&
      failed.error === null &&
      !failed.paused &&
      failed.currentTime >= positionAtFailureS &&
      positionAtFailureS > 0,
    'a stream whose download broke off is reloaded on the next key press and carries on from where it stopped',
  );
  await brokenOff.dispose();

  const decoded = await rig(harness);
  const scope = decoded.audio.createScope();
  await scope.preload([KEYBOARD_HERO_SONG]);
  void harness.context().suspend();
  decoded.audio.music.repeat(KEYBOARD_HERO_SONG);
  await decoded.settle();
  unlockGesture('keydown');
  const creditedInsideGesture = decoded.audible.includes(KEYBOARD_HERO_SONG);
  await decoded.settle();
  check(
    !creditedInsideGesture && decoded.audible.includes(KEYBOARD_HERO_SONG),
    'a decoded song a gesture starts counts as heard only once the context renders',
  );
  scope.dispose();
  await decoded.dispose();

  const failedFetches = { count: 0 };
  const decodingFetch: unknown = Reflect.get(globalThis, 'fetch');
  Reflect.set(globalThis, 'fetch', (url: string) => {
    if (url !== SOUND_MANIFEST[KEYBOARD_HERO_SONG]) {
      return typeof decodingFetch === 'function'
        ? Reflect.apply(decodingFetch, globalThis, [url])
        : Promise.reject(new Error('no fetch'));
    }
    failedFetches.count++;
    return Promise.resolve({ ok: false, status: 404 });
  });
  try {
    const unloadable = await rig(harness);
    claimOn(unloadable.audio, {}, 'floor', 'area', loopOf(KEYBOARD_HERO_SONG));
    await unloadable.settle();
    for (let press = 0; press < KEY_PRESSES_AFTER_A_FAILED_LOAD; press++) {
      unlockGesture('keydown');
      await unloadable.settle();
    }
    check(
      failedFetches.count <= 1,
      `a looped song that cannot load is not fetched again by each key press (${failedFetches.count} fetches)`,
    );
    await unloadable.dispose();
  } finally {
    Reflect.set(globalThis, 'fetch', decodingFetch);
  }
}

/** 8. The keyboard-hero claim outranks the player's choice. */
export async function checkExclusive(harness: AudioHarness, check: Check): Promise<void> {
  setDurations(harness, ['temple_music'], LONG_RECORDING_S);
  const r = await rig(harness);
  const scope = r.audio.createScope();
  await scope.preload([KEYBOARD_HERO_SONG]);
  await harness.flush();
  r.audio.music.repeat('temple_music');
  await r.settle();
  scope.claimMusic({
    owner: 'keyboard_hero',
    layer: 'exclusive',
    selection: { kind: 'held', id: KEYBOARD_HERO_SONG },
  });
  scope.startKeyboardHeroMusic();
  await r.settle();
  check(
    r.audio.music.audibleTrack === KEYBOARD_HERO_SONG && r.sounding('temple_music') === null,
    `the hack's song outranks the player's repeat (${r.audio.music.audibleTrack ?? 'none'})`,
  );
  scope.stopKeyboardHeroMusic();
  scope.releaseMusic('keyboard_hero');
  await r.settle();
  check(r.audio.music.audibleTrack === 'temple_music', "releasing it hands back the player's song");
  scope.dispose();
  await r.dispose();
}

/** 9. No song plays twice in a row, across reshuffles. */
export async function checkShuffle(harness: AudioHarness, check: Check): Promise<void> {
  setDurations(harness, SHUFFLE_SET, SHORT_RECORDING_S);
  const streams = seededStreams(SHUFFLE_SEED);
  let repeats = 0;
  let songs = 0;
  for (let stream = 0; stream < SHUFFLE_STREAMS; stream++) {
    const r = await rig(harness, streams(`shuffle-${stream}`));
    claimOn(r.audio, {}, 'overworld_zone', 'area', { kind: 'playlist', ids: SHUFFLE_SET });
    for (let song = 0; song < SHUFFLE_SONGS_PER_STREAM; song++) {
      await r.settle(SHORT_RECORDING_S * MS_PER_SECOND);
    }
    for (let i = 1; i < r.audible.length; i++) {
      if (r.audible[i] === r.audible[i - 1]) repeats++;
    }
    songs += r.audible.length;
    await r.dispose();
  }
  check(
    repeats === 0,
    `${songs} songs over ${SHUFFLE_STREAMS} seeded streams, ${repeats} played twice in a row`,
  );
}

/** 10. Jingles never unlock or credit. */
export async function checkJingles(harness: AudioHarness, check: Check): Promise<void> {
  const r = await rig(harness);
  claimOn(r.audio, {}, 'free_spins', 'activity', {
    kind: 'playlist',
    ids: SLOTS_FREE_SPINS_MUSIC_TRACKS,
  });
  await r.settle();
  const playing = r.audio.music.audibleTrack;
  check(
    playing !== null && SLOTS_FREE_SPINS_MUSIC_TRACKS.some((id) => id === playing),
    'a jingle playlist plays',
  );
  const unlockedBeyondTheStandingSet = r.library.unlocked.filter(
    (id) => !ALWAYS_UNLOCKED_TRACK_IDS.some((alwaysId) => alwaysId === id),
  );
  check(
    unlockedBeyondTheStandingSet.length === 0 && r.library.drainNotices().length === 0,
    'and unlocks and credits nothing',
  );
  await r.dispose();
}

/** Longer than the pause menu's fade, so a hold has had time to land. */
const MENU_FADE_SETTLE_MS = 500;
/** A song short enough that waiting in the menu outlasts it. */
const HELD_SONG_RECORDING_S = 30;
/** How long the menu stays open: well past the end of the held song. */
const MENU_OPEN_S = 60;
/** Slack on a held position: the menu's fades either side of the hold. */
const HOLD_TOLERANCE_S = 1;

/**
 * 22. The pause menu holds the music where it is: a playlist song does not
 * play on unheard and hand over to the next song behind the menu, and it
 * carries on from the same place when the menu closes. A casino silencer
 * only mutes the bus.
 */
export async function checkPauseMenuHoldsMusic(harness: AudioHarness, check: Check): Promise<void> {
  setDurations(harness, TOWN_MUSIC_TRACKS, HELD_SONG_RECORDING_S);
  const r = await rig(harness);
  claimOn(r.audio, {}, 'overworld_zone', 'area', { kind: 'playlist', ids: TOWN_MUSIC_TRACKS });
  await r.settle();
  const song = r.audio.music.audibleTrack;
  const element = song === null ? null : r.sounding(song);
  check(song !== null && element !== null, 'a playlist song plays');
  if (song === null || element === null) {
    await r.dispose();
    return;
  }

  r.audio.pauseMusic('menu');
  await r.settle(MENU_FADE_SETTLE_MS);
  const heldAtS = element.currentTime;
  await r.settle(MENU_OPEN_S * MS_PER_SECOND);
  check(
    r.audio.music.currentTrack === song && element.paused,
    `the pause menu holds the song rather than playing it on unheard (${r.audio.music.currentTrack ?? 'none'})`,
  );
  r.audio.resumeMusic('menu');
  await r.settle(MENU_FADE_SETTLE_MS);
  const resumedAtS = r.sounding(song)?.currentTime ?? Number.NaN;
  check(
    r.audio.music.audibleTrack === song &&
      Math.abs(resumedAtS - heldAtS) <= HOLD_TOLERANCE_S + MENU_FADE_SETTLE_MS / MS_PER_SECOND,
    `closing the menu carries the same song on from where it stopped (${resumedAtS.toFixed(1)} s, about ${heldAtS.toFixed(1)} s)`,
  );

  r.audio.pauseMusic('wheel');
  await r.settle(MENU_FADE_SETTLE_MS);
  check(r.sounding(song) !== null, 'a casino silencer mutes the bus but holds nothing');
  r.audio.resumeMusic('wheel');
  await r.settle(MENU_FADE_SETTLE_MS);

  r.audio.pauseMusic('background');
  await r.settle(MENU_FADE_SETTLE_MS);
  void harness.context().suspend();
  await harness.flush();
  const heldInBackgroundAtS = element.currentTime;
  r.audio.resumeMusic('background');
  await r.settle(MENU_FADE_SETTLE_MS);
  check(
    element.paused && r.audio.music.currentTrack === song,
    'back from the background with audio still suspended, the held song waits rather than playing into silence',
  );
  void harness.context().resume();
  await r.settle(MENU_FADE_SETTLE_MS);
  const afterUnlockS = r.sounding(song)?.currentTime ?? Number.NaN;
  check(
    Math.abs(afterUnlockS - heldInBackgroundAtS) <=
      HOLD_TOLERANCE_S + MENU_FADE_SETTLE_MS / MS_PER_SECOND,
    `once audio unlocks it carries on from where it was held (${afterUnlockS.toFixed(1)} s, about ${heldInBackgroundAtS.toFixed(1)} s)`,
  );
  await r.dispose();

  const previousFetch: unknown = Reflect.get(globalThis, 'fetch');
  Reflect.set(globalThis, 'fetch', (url: string) => {
    const body = new ArrayBuffer(0);
    harness.fetchedLabels.set(body, url);
    return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(body) });
  });
  harness.setDuration(SOUND_MANIFEST[KEYBOARD_HERO_SONG], LONG_RECORDING_S);
  const sourcesOfTheSong = (): SourceRecord[] =>
    harness.sources.filter((source) => source.label === SOUND_MANIFEST[KEYBOARD_HERO_SONG]);
  const runsBeforeClaim = sourcesOfTheSong().length;
  const decoded = await rig(harness);
  claimOn(decoded.audio, {}, 'floor', 'area', loopOf(KEYBOARD_HERO_SONG));
  await decoded.settle();
  await decoded.settle();
  const decodedPlays = decoded.audio.music.audibleTrack === KEYBOARD_HERO_SONG;
  decoded.audio.pauseMusic('menu');
  await decoded.settle(MENU_FADE_SETTLE_MS);
  const heldDecodedAtS =
    harness.audioTimeS() - (sourcesOfTheSong()[runsBeforeClaim]?.startedAtS ?? 0);
  const soundingWhileHeld = sourcesOfTheSong().filter((source) => !source.isSilenced()).length;
  const runsBeforeRelease = sourcesOfTheSong().length;
  await decoded.settle(MENU_OPEN_S * MS_PER_SECOND);
  decoded.audio.resumeMusic('menu');
  await decoded.settle(MENU_FADE_SETTLE_MS);
  const restarted = sourcesOfTheSong().slice(runsBeforeRelease);
  check(
    decodedPlays &&
      soundingWhileHeld === 0 &&
      decoded.audio.music.audibleTrack === KEYBOARD_HERO_SONG &&
      restarted.length === 1 &&
      Math.abs(restarted[0].offsetS - heldDecodedAtS) <= HOLD_TOLERANCE_S,
    `a decoded song is stopped while held and restarted from its place (${restarted.map((run) => run.offsetS.toFixed(1)).join(', ') || 'no restart'}, about ${heldDecodedAtS.toFixed(1)} s)`,
  );
  await decoded.dispose();
  Reflect.set(globalThis, 'fetch', previousFetch);
}
