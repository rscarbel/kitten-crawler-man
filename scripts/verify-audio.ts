#!/usr/bin/env tsx
/**
 * Headless gate on how the audio engine behaves: a real `AudioManager` over
 * the fake Web Audio graph in `audioHarness.ts`, driven on the fake clock.
 * It checks behaviour only — what starts, what stops and how — never levels
 * or balance.
 *
 * Each check is one entry in `CHECKS`, numbered as the audio gate's list
 * numbers them; a check for a new behaviour is one more entry. Every check
 * builds its own manager and disposes it, so none can lean on another's state.
 *
 *    1. Highest claim wins: a release falls back to the next claim down, and a
 *       claim for the track already playing never restarts it.
 *    2. Handover: a new scene claiming the playing track keeps it playing.
 *    3. Resume: a short override resumes the track's position; a long one
 *       moves the playlist on.
 *    4. Unlock and credit: a playlist claim unlocks every member; only an
 *       audible song is credited, each once.
 *    5. Player modes: under repeat, area claims unlock but play nothing, and
 *       area music plays the latest area claim.
 *    6. Play once: on `ended` the claim releases and the music below resumes.
 *    7. Autoplay lock: a claim behind the lock is credited only once audio plays.
 *       Where an element may start only inside a gesture, a tap's `touchend`
 *       starts the waiting song, and the next gesture retries a refused one.
 *    8. Exclusive: the keyboard-hero claim outranks the player's choice.
 *    9. Shuffle: no song plays twice in a row, across reshuffles.
 *   10. Jingles: never unlock or credit.
 *   11. Save round-trip: a save keeps the music library through storage,
 *       and the save the stairs write, which carries no world, keeps it too.
 *   12. Backfill: saves written before the library unlock exactly the songs
 *       their progress proves, none heard, under one summary notice; the
 *       songs every library starts with are unlocked and heard, unannounced.
 *   13. Voices and rate limits: a copy past an id's cap steals its oldest,
 *       ramped; past the global cap a sound steals the oldest voice it
 *       outranks or is dropped; a frame of repeats makes one voice per take,
 *       and a repeat inside the minimum interval is dropped.
 *   14. Scope disposal: disposing a scene's scope stops every loop it owns,
 *       and a page coming back from the background restarts the loops its
 *       scopes still want, the keyboard-hero song from where it stopped. A
 *       keyboard-hero song that failed to load leaves the chart on its frame clock.
 *   15. Ramped stops: every way a voice is silenced ramps its own gain to
 *       silence first, so no voice stops with its gain above zero.
 *   16. Notices across a scene change: unlock toasts still waiting or barely
 *       up, and a credit card still showing, go back to the library when the
 *       scene ends, and the next scene posts them.
 *   17. Stings duck the music for their length and let it back up after.
 *   18. Placed sounds: dropped beyond hearing range before taking a voice,
 *       quieter with distance, panned toward their side and never past the
 *       cap, and reported with their source.
 *   19. Captions: an `always` cue posts its caption; an `offscreen` cue posts
 *       nothing from on screen and one pointing its way from off it; repeats
 *       merge; captions post while muted and not while switched off.
 *   20. Mute, mono and background audio: muting silences every route to the
 *       speakers and unmuting restores it; mono sends the one audible route
 *       through a one-channel downmix into both sides of a merger; with
 *       background audio on, a blurred window keeps playing.
 *   23. On-demand stings: preloading one plays nothing, its first play
 *       decodes it and then sounds, and a stop before the decode lands
 *       cancels that play.
 *   24. Gated floor-3 groups: each is decoded on approach before its first
 *       cue, held through the band between taking hold and letting go, held
 *       anywhere while its activity runs or a recall is landing by it, and
 *       released once left, without cutting a voice still sounding.
 *   25. Gated groups' safety net: the Evil Clown's troupe and the party's own
 *       defences sound wherever they fight; a gated cue played with its group
 *       let go still sounds from its kept file; a group let go before its
 *       decode lands stays let go, and so does a play waiting on it, while a
 *       play asked for after that release still sounds, once, whether or not
 *       its file is kept; an
 *       on-demand sting's unplayed file goes with its scope.
 *
 *   npm run verify:audio
 *   npx tsx scripts/verify-audio.ts --only=15
 */

import type { MusicBusId } from '../src/audio/sounds.js';
import { firstOf, installFakeAudio, type SilenceRecord } from './audioHarness.js';

const { installBrowserShim, ShimEvent } = await import('./browserShim.js');
const VIEWPORT = { width: 1280, height: 720, devicePixelRatio: 1 } as const;
const shim = installBrowserShim(VIEWPORT);
const harness = installFakeAudio({
  initialState: 'running',
  decodesEverything: true,
  fakeTimers: true,
});

const RNG_SEED = 14;
const { mulberry32 } = await import('../src/sprites/person/rng.js');
Math.random = mulberry32(RNG_SEED);

const { AudioManager } = await import('../src/audio/AudioManager.js');
const { compressedSfxForLevelId, CORE_SFX_IDS, GATED_SFX_GROUPS, SFX_GROUPS, sfxGroupsForLevelId } =
  await import('../src/audio/sfxGroups.js');
const { FloorSfxGates, groupsActiveAnywhere, SFX_GATE_APPROACH_TILES, SFX_GATE_LEAVE_TILES } =
  await import('../src/systems/FloorSfxGates.js');
const { AmbientSoundSystem } = await import('../src/systems/AmbientSoundSystem.js');
const { ON_DEMAND_SOUND_IDS, SOUND_MANIFEST } = await import('../src/audio/sounds.js');
const { MACHINERY_LOOP, SPIDER_WALKING_LOOP, WADING_LOOP, WALKING_LOOP } =
  await import('../src/audio/loopLevels.js');
const { useDevPlayerIdentity } = await import('../src/dev/devPlayerIdentity.js');
useDevPlayerIdentity();
const { checkBackfill, checkSaveRoundTrip } = await import('./verifyAudio/musicLibrary.js');
const director = await import('./verifyAudio/director.js');
const { checkNoticesSurviveSceneChange } = await import('./verifyAudio/musicNotices.js');
const voices = await import('./verifyAudio/voices.js');
const accessibility = await import('./verifyAudio/accessibility.js');
type Manager = InstanceType<typeof AudioManager>;
type SoundId = keyof typeof SOUND_MANIFEST;

/** A gain this small at the instant a voice stops cannot be heard as a click. */
const SILENT_GAIN = 1e-4;
/**
 * The most a voice's gain may still be a millisecond before it stops. The
 * shortest stop's curves are well under it by then; a gain cut to zero in one
 * step is still at its full level.
 */
const MAX_GAIN_JUST_BEFORE_STOP = 0.25;
/** Long enough for every fade, and the pause behind it, to have finished. */
const SETTLE_MS = 3000;
/** How far into the keyboard-hero song the page is backgrounded. */
const SONG_POSITION_AT_BLUR_MS = 2000;
/** How long the page stays in the background. */
const BACKGROUND_MS = 5000;
/** Played after the page returns, to show the song clock running on from where it stopped. */
const AFTER_RETURN_MS = 500;
/** Slack on clock readings: one harness step either way. */
const CLOCK_TOLERANCE_MS = 2;
/** A crossfade long enough to look inside. */
const CROSSFADE_MS = 1000;
const HALF = 0.5;
const MS_PER_SECOND = 1000;
/** More beds than the pool holds, started and stopped in turn. */
const POOL_CHURN_STARTS = 20;
/** The `<audio>` elements an ambient bed may draw on, beyond the two music slots. */
const AMBIENT_POOL_LIMIT = 6;
const BED_VOLUME = 0.5;
const ONE_SHOT_VOLUME = 0.6;
const SKIPPED_FADE_MS = 400;

/** Holds the claims the ramped-stop paths make, as a scene's scope would. */
const STOP_CHECK_HOLDER = {};

/** Plays `id` on the floor's area claim, crossfading over `fadeInMs`. */
function playTrack(audio: Manager, id: MusicBusId, fadeInMs = 0): void {
  audio.music.claim(
    { owner: 'floor', layer: 'area', selection: { kind: 'loop', id }, fadeInMs },
    STOP_CHECK_HOLDER,
  );
}

function stopTrack(audio: Manager, fadeOutMs?: number): void {
  audio.music.release('floor', STOP_CHECK_HOLDER, { fadeOutMs });
}

/** Streamed ambient beds, played through pooled media elements. */
const STREAMED_BEDS = [
  'ambient_fountain',
  'ambient_forge',
  'ambient_bar_crowd',
  'ambient_cookhouse',
  'ambient_magic_shop',
  'ambient_village',
  'ambient_river_flowing',
] as const satisfies readonly SoundId[];

const failures: string[] = [];

function check(ok: boolean, message: string): void {
  if (ok) {
    console.log(`  ok    ${message}`);
    return;
  }
  console.log(`  FAIL  ${message}`);
  failures.push(message);
}

/**
 * A manager over a fresh, running fake context, with `preloaded` decoded and
 * declared by a scope that outlives the check, so no other scope's disposal
 * releases them.
 */
async function freshManager(preloaded: readonly SoundId[]): Promise<Manager> {
  const audio = new AudioManager();
  await audio.createScope().preload(preloaded);
  await harness.flush();
  return audio;
}

/** Background the page the way alt-tabbing away does, then bring it back. */
function blurWindow(): void {
  shim.window.dispatch(new ShimEvent('blur', '', 0));
}

function focusWindow(): void {
  shim.window.dispatch(new ShimEvent('focus', '', 0));
}

function labelOf(id: SoundId): string {
  return SOUND_MANIFEST[id];
}

const GAIN_DIGITS = 4;
const SECONDS_DIGITS = 3;

function describe(record: SilenceRecord): string {
  const gain =
    record.gain === null || record.gainJustBefore === null
      ? 'no own gain'
      : `gain ${record.gainJustBefore.toFixed(GAIN_DIGITS)} → ${record.gain.toFixed(GAIN_DIGITS)}`;
  return `${record.how} of ${record.label} at ${record.atS.toFixed(SECONDS_DIGITS)}s with ${gain}`;
}

/** A silence that would be heard as a click: no own gain, or a gain not ramped to zero. */
function clicks(record: SilenceRecord): boolean {
  if (record.gain === null || record.gainJustBefore === null) return true;
  if (record.gain > SILENT_GAIN) return true;
  return record.contextRunning && record.gainJustBefore > MAX_GAIN_JUST_BEFORE_STOP;
}

/**
 * Runs `path`, settles every fade it started, and checks that it silenced
 * at least one voice and that every voice it silenced was already silent.
 */
async function expectRampedStops(name: string, path: () => void | Promise<void>): Promise<void> {
  const before = harness.silences.length;
  await path();
  harness.advance(SETTLE_MS);
  await harness.flush();
  const silenced = harness.silences.slice(before);
  const clicked = silenced.filter(clicks);
  check(
    silenced.length > 0 && clicked.length === 0,
    `${name}: ${silenced.length} voice(s) silenced, ${
      clicked.length === 0 ? 'every one ramped to silence' : clicked.map(describe).join('; ')
    }`,
  );
}

async function checkScopeDisposal(): Promise<void> {
  const audio = await freshManager([
    WALKING_LOOP.id,
    SPIDER_WALKING_LOOP.id,
    MACHINERY_LOOP.id,
    'keyboard_hero_music_track_1',
    'bopca_cooking',
  ]);
  const scope = audio.createScope();
  const sourcesBefore = harness.sources.length;
  scope.startLoop(WALKING_LOOP);
  scope.startLoop(SPIDER_WALKING_LOOP);
  scope.startLoop(MACHINERY_LOOP);
  scope.startAmbientLoop('bopca_cooking', BED_VOLUME);
  scope.startAmbientLoop('ambient_fountain', BED_VOLUME);
  scope.startKeyboardHeroMusic();
  let ownedDisposals = 0;
  scope.own({
    dispose: () => {
      ownedDisposals++;
    },
  });
  const started = harness.sources.slice(sourcesBefore);
  const decodedVoicesStarted = 5;
  const bed = harness.elements().find((el) => el.src === labelOf('ambient_fountain'));
  harness.advance(SETTLE_MS);
  check(
    started.length === decodedVoicesStarted && started.every((source) => !source.isSilenced()),
    `a scope's decoded loops and the song are playing (${started.length} started)`,
  );
  check(bed !== undefined && !bed.paused, "the scope's streamed bed is playing");

  scope.dispose();
  harness.advance(SETTLE_MS);
  check(
    started.every((source) => source.isSilenced()),
    'disposing the scope stops every buffer loop it owns, the keyboard-hero song included',
  );
  check(bed?.paused === true, 'disposing the scope pauses its streamed bed');
  check(ownedDisposals === 1, 'disposing the scope disposes what it owns, once');
  check(
    !scope.isAmbientLoopRunning('bopca_cooking') && scope.keyboardHeroMusicTimeMs() === null,
    'a disposed scope reports nothing running',
  );
  scope.startAmbientLoop('bopca_cooking', BED_VOLUME);
  check(!scope.isAmbientLoopRunning('bopca_cooking'), 'a disposed scope starts nothing');

  const backgrounded = audio.createScope();
  const beforeBackground = harness.sources.length;
  backgrounded.startLoop(MACHINERY_LOOP);
  backgrounded.startAmbientLoop('ambient_forge', BED_VOLUME);
  backgrounded.startKeyboardHeroMusic();
  harness.advance(SONG_POSITION_AT_BLUR_MS);
  const startedBeforeBlur = harness.sources.slice(beforeBackground);
  const machinery = startedBeforeBlur.find((source) => source.label === labelOf(MACHINERY_LOOP.id));
  const song = startedBeforeBlur.find(
    (source) => source.label === labelOf('keyboard_hero_music_track_1'),
  );
  const forge = harness.elements().find((el) => el.src === labelOf('ambient_forge'));
  blurWindow();
  harness.advance(BACKGROUND_MS);
  await harness.flush();
  check(
    machinery?.isSilenced() === true && song?.isSilenced() === true && forge?.paused === true,
    'backgrounding the page stops the machinery, the song and the bed',
  );
  const heldMs = backgrounded.keyboardHeroMusicTimeMs() ?? Number.NaN;
  check(
    Math.abs(heldMs - SONG_POSITION_AT_BLUR_MS) <= CLOCK_TOLERANCE_MS,
    `the song clock holds where the page left it (${heldMs.toFixed(0)} ms)`,
  );

  const beforeReturn = harness.sources.length;
  focusWindow();
  await harness.flush();
  harness.advance(AFTER_RETURN_MS);
  const restarted = harness.sources.slice(beforeReturn);
  const restartedMachinery = restarted.find(
    (source) => source.label === labelOf(MACHINERY_LOOP.id),
  );
  const restartedSong = restarted.find(
    (source) => source.label === labelOf('keyboard_hero_music_track_1'),
  );
  check(
    restartedMachinery !== undefined && !restartedMachinery.isSilenced(),
    'coming back restarts the machinery loop, which nothing else would start again',
  );
  check(
    restartedSong !== undefined &&
      Math.abs(restartedSong.offsetS * MS_PER_SECOND - SONG_POSITION_AT_BLUR_MS) <=
        CLOCK_TOLERANCE_MS,
    `coming back restarts the keyboard-hero song from where it stopped (offset ${
      restartedSong === undefined
        ? 'none'
        : `${(restartedSong.offsetS * MS_PER_SECOND).toFixed(0)} ms`
    })`,
  );
  const runningMs = backgrounded.keyboardHeroMusicTimeMs() ?? Number.NaN;
  check(
    Math.abs(runningMs - (SONG_POSITION_AT_BLUR_MS + AFTER_RETURN_MS)) <= CLOCK_TOLERANCE_MS,
    `the song clock runs on from there (${runningMs.toFixed(0)} ms)`,
  );
  check(forge?.paused === false, 'coming back restarts the streamed bed');
  backgrounded.dispose();

  // `playNow` reads a decoded buffer, which an on-demand sting holds only once played.
  const decodedOnPreload = (id: SoundId): boolean => !ON_DEMAND_SOUND_IDS.has(id);
  const level1Only = sfxGroupsForLevelId('level1').filter(
    (id) => !CORE_SFX_IDS.includes(id) && decodedOnPreload(id),
  );
  const level2Only = sfxGroupsForLevelId('level2').filter(
    (id) => !CORE_SFX_IDS.includes(id) && !level1Only.includes(id) && decodedOnPreload(id),
  );
  const shared = level1Only.find((id) => sfxGroupsForLevelId('level2').includes(id));
  const universal = CORE_SFX_IDS.find(decodedOnPreload);
  const evicted = level1Only.find((id) => id !== shared);
  const kept = firstOf(level2Only);
  await audio.preload(universal === undefined ? [] : [universal]);
  const leaving = audio.createScope();
  await leaving.preload(level1Only);
  const arriving = audio.createScope();
  await arriving.preload([...level2Only, ...(shared === undefined ? [] : [shared])]);
  await harness.flush();
  leaving.dispose();
  check(
    evicted !== undefined && audio.playNow(evicted) === null,
    'a buffer only the departing scene declared is released as its scope is disposed',
  );
  check(
    kept !== null && audio.playNow(kept) !== null,
    'a buffer the arriving scene declared stays decoded',
  );
  check(
    shared === undefined || audio.playNow(shared) !== null,
    'a buffer both scenes declared stays decoded',
  );
  check(
    universal !== undefined && audio.playNow(universal) !== null,
    'a universal buffer is never released',
  );
  arriving.dispose();

  const elementsBefore = harness.elements().length;
  const churn = audio.createScope();
  for (let i = 0; i < POOL_CHURN_STARTS; i++) {
    const bed = STREAMED_BEDS[i % STREAMED_BEDS.length];
    churn.startAmbientLoop(bed, BED_VOLUME);
    if (i % 2 === 1) churn.stopAllAmbientLoops();
    harness.advance(SETTLE_MS);
  }
  churn.dispose();
  const madeForBeds = harness.elements().length - elementsBefore;
  check(
    madeForBeds <= AMBIENT_POOL_LIMIT,
    `ambient beds reuse a pool of at most ${AMBIENT_POOL_LIMIT} elements (${madeForBeds} made)`,
  );

  const silentEmitter = audio.createScope();
  const emitters = new AmbientSoundSystem(silentEmitter, [
    {
      soundId: 'ambient_village',
      x: 0,
      y: 0,
      radiusTiles: 0,
      maxVolume: BED_VOLUME,
      constant: true,
    },
  ]);
  blurWindow();
  emitters.updateListener(0, 0);
  emitters.setGainScale(0);
  emitters.updateListener(0, 0);
  focusWindow();
  await harness.flush();
  check(
    !silentEmitter.isAmbientLoopRunning('ambient_village'),
    'an emitter that fell silent while its loop was refused does not come back with the page',
  );
  silentEmitter.dispose();

  const locked = audio.createScope();
  void harness.context().suspend();
  locked.startKeyboardHeroMusic();
  check(
    locked.keyboardHeroMusicTimeMs() === 0,
    'a song refused while audio is locked holds the chart at its top',
  );
  shim.window.dispatch(new ShimEvent('keydown', '', 0));
  await harness.flush();
  harness.advance(AFTER_RETURN_MS);
  const lockedMs = locked.keyboardHeroMusicTimeMs() ?? Number.NaN;
  check(
    Math.abs(lockedMs - AFTER_RETURN_MS) <= CLOCK_TOLERANCE_MS,
    `the refused song starts when audio unlocks (${lockedMs.toFixed(0)} ms in)`,
  );
  locked.dispose();

  // Restored after this case, so later preloads in this run still decode.
  const decodingFetch: unknown = Reflect.get(globalThis, 'fetch');
  Reflect.set(globalThis, 'fetch', (url: string) =>
    url === labelOf('keyboard_hero_music_track_1')
      ? Promise.resolve({ ok: false, status: 404 })
      : typeof decodingFetch === 'function'
        ? Promise.resolve<unknown>(Reflect.apply(decodingFetch, globalThis, [url]))
        : Promise.reject(new Error('no fetch')),
  );
  const songless = new AudioManager();
  const songlessScope = songless.createScope();
  await songlessScope.preload(['keyboard_hero_music_track_1']);
  await harness.flush();
  Reflect.set(globalThis, 'fetch', decodingFetch);
  songlessScope.startKeyboardHeroMusic();
  check(
    songlessScope.keyboardHeroMusicTimeMs() === null,
    'a keyboard-hero song that failed to load leaves the chart on its frame clock',
  );
  songlessScope.dispose();
  songless.dispose();
  audio.dispose();
}

async function checkOnDemandStings(): Promise<void> {
  const sting = 'accepted_bounty' as const satisfies SoundId;
  const stopped = 'bounty_fight_engaged' as const satisfies SoundId;
  check(
    ON_DEMAND_SOUND_IDS.has(sting) && ON_DEMAND_SOUND_IDS.has(stopped),
    'both stings checked here decode on demand',
  );
  const sourcesBefore = harness.sources.length;
  const audio = await freshManager([sting, stopped]);
  const startedOf = (id: SoundId): number =>
    harness.sources.slice(sourcesBefore).filter((source) => source.label === labelOf(id)).length;
  check(startedOf(sting) === 0, 'preloading an on-demand sting plays nothing');

  audio.play(sting);
  await harness.flush();
  check(startedOf(sting) === 1, 'its first play decodes it and then sounds');

  audio.play(stopped);
  audio.stopSound(stopped);
  await harness.flush();
  check(startedOf(stopped) === 0, 'a stop before the decode lands cancels that play');
  audio.play(stopped);
  await harness.flush();
  check(startedOf(stopped) === 1, 'once decoded it plays like any other sound');
}

/** Nothing under way on the overworld. */
const QUIET_OVERWORLD = {
  siegeRunning: false,
  siegeDeadStanding: false,
  escortUnderWay: false,
  escortAmbushersStanding: false,
  bountyOut: false,
};

/** Where the scripted village stands, in tiles. */
const GATED_VILLAGE = { x: 200, y: 200, w: 20, h: 20 } as const;
/** Where the scripted circus grounds stand, in tiles. */
const GATED_GROUNDS = { x: 20, y: 200, w: 10, h: 10 } as const;
/** Far from both places. */
const FAR_TILE = { x: 0, y: 0 } as const;
/** A cue each gated group plays, decoded on preload rather than on demand. */
const FIRST_CUES = {
  briarHollowSiege: 'bell_alarm',
  bounty: 'mantid_hiss_1',
  starlightTent: 'high_striker_bell',
} as const satisfies Record<(typeof GATED_SFX_GROUPS)[number], SoundId>;

/** A tile `tiles` west of the scripted village's west edge. */
function westOfVillage(tiles: number): { x: number; y: number } {
  return { x: GATED_VILLAGE.x - tiles, y: GATED_VILLAGE.y };
}

async function checkGatedGroups(): Promise<void> {
  // The boot group first: gated groups borrow some of its ids, which stay decoded.
  const audio = await freshManager(CORE_SFX_IDS);
  const activity = { ...QUIET_OVERWORLD };
  const anywhere = (group: (typeof GATED_SFX_GROUPS)[number]) => (): boolean =>
    groupsActiveAnywhere(activity)[group];
  const gates = new FloorSfxGates(audio, [
    {
      group: 'briarHollowSiege',
      activeAnywhere: anywhere('briarHollowSiege'),
      places: [GATED_VILLAGE],
    },
    { group: 'bounty', activeAnywhere: anywhere('bounty'), places: [] },
    { group: 'starlightTent', activeAnywhere: anywhere('starlightTent'), places: [GATED_GROUNDS] },
  ]);
  const residentAt = async (party: readonly { x: number; y: number }[]): Promise<number> => {
    gates.update(party);
    await harness.flush();
    return audio.decodedBufferCount;
  };
  const siegeOnly = new Set(
    SFX_GROUPS.briarHollowSiege.filter(
      (id) => !ON_DEMAND_SOUND_IDS.has(id) && !CORE_SFX_IDS.includes(id),
    ),
  );
  // Played and run out, so no voice of it holds its buffer past a later let-go.
  const firstCueHeard = (group: (typeof GATED_SFX_GROUPS)[number]): boolean => {
    const heard = audio.playNow(FIRST_CUES[group]) !== null;
    audio.stopSound(FIRST_CUES[group]);
    harness.advance(SETTLE_MS);
    return heard;
  };

  const baseline = await residentAt([FAR_TILE]);
  check(
    GATED_SFX_GROUPS.every((group) => !audio.holdsSfxGroup(group)),
    `far from everything, no gated group is decoded (${baseline} buffers)`,
  );
  const outsideApproach = await residentAt([westOfVillage(SFX_GATE_APPROACH_TILES + 1)]);
  check(outsideApproach === baseline, 'one tile short of the approach radius decodes nothing');
  const approached = await residentAt([westOfVillage(SFX_GATE_APPROACH_TILES)]);
  check(
    approached - baseline === siegeOnly.size && firstCueHeard('briarHollowSiege'),
    `nearing the village decodes the siege's ${siegeOnly.size} buffers before its first cue ` +
      `(${approached - baseline} decoded)`,
  );
  const inBand = await residentAt([westOfVillage(SFX_GATE_LEAVE_TILES)]);
  check(inBand === approached, 'walking back out to the leave radius keeps them');
  audio.play('bell_crack');
  harness.advance(1);
  const sounding = firstOf(harness.sources.slice(-1));
  const left = await residentAt([westOfVillage(SFX_GATE_LEAVE_TILES + 1)]);
  check(
    left === baseline + 1 && sounding?.label === labelOf('bell_crack') && !sounding.isSilenced(),
    `past it they are let go, all but the one still sounding (${left - baseline} kept)`,
  );
  audio.stopSound('bell_crack');
  harness.advance(SETTLE_MS);
  activity.bountyOut = true;
  await residentAt([FAR_TILE]);
  check(
    audio.holdsSfxGroup('bounty') && firstCueHeard('bounty'),
    "a bounty out decodes the bosses' group wherever the party is",
  );
  activity.bountyOut = false;
  await residentAt([FAR_TILE]);
  check(!audio.holdsSfxGroup('bounty'), 'collecting it lets the group go');
  activity.siegeRunning = true;
  await residentAt([FAR_TILE]);
  check(
    audio.holdsSfxGroup('briarHollowSiege') &&
      firstCueHeard('briarHollowSiege') &&
      audio.holdsSfxGroup('bounty') &&
      firstCueHeard('bounty') &&
      !audio.holdsSfxGroup('starlightTent'),
    "a siege holds its own group and the bounty marks it fields, not the circus's",
  );
  activity.siegeRunning = false;
  activity.siegeDeadStanding = true;
  await residentAt([FAR_TILE]);
  check(
    audio.holdsSfxGroup('briarHollowSiege') && audio.holdsSfxGroup('bounty'),
    'after a siege, its dead walking back out keep both its groups decoded',
  );
  activity.siegeDeadStanding = false;
  activity.escortAmbushersStanding = true;
  await residentAt([FAR_TILE]);
  check(
    audio.holdsSfxGroup('briarHollowSiege'),
    "with Midge delivered, her ambushers still standing keep the siege's dead decoded",
  );
  activity.escortAmbushersStanding = false;
  const landing = { x: GATED_GROUNDS.x, y: GATED_GROUNDS.y };
  await residentAt([FAR_TILE, landing]);
  check(
    audio.holdsSfxGroup('starlightTent') && !audio.holdsSfxGroup('briarHollowSiege'),
    "a recall landing on the grounds decodes the circus's group before the party arrives",
  );
  const released = await residentAt([FAR_TILE]);
  check(
    released === baseline && GATED_SFX_GROUPS.every((group) => !audio.holdsSfxGroup(group)),
    `with nothing near and nothing under way every gated group is let go (${released} buffers)`,
  );
}

/** The party's own defences, and its soldiers' hurt and fall, which fight anywhere and play unplaced. */
const DEFENCE_SOUNDS = [
  'trebuchet_fire_1',
  'trebuchet_fire_2',
  'boulder_impact_1',
  'boulder_fire_whoosh',
  'miasma_hiss',
  'trebuchet_break',
  'snare_trigger',
  'snare_break',
  'snare_convert',
  'spikes_impale',
  'wall_hit_wood',
  'wall_break_stone',
  'fence_break',
  'gate_thud',
  'ratkin_soldier_hurt_1',
  'ratkin_soldier_down',
] as const satisfies readonly SoundId[];

/** The Evil Clown bounty's troupe, which fights at a bounty site far from the circus grounds. */
const CLOWN_TROUPE_SOUNDS = ['clown_burp', 'clown_horn'] as const satisfies readonly SoundId[];

/** The clowns and lemurs a Briar Hollow siege sends, far from the circus grounds. */
const SIEGE_TROUPE_SOUNDS = [
  'clown_burp',
  'clown_laughing_1',
  'lemur_attack',
  'lemur_sound',
] as const satisfies readonly SoundId[];

async function checkGatedSafetyNet(): Promise<void> {
  const troupeMissing = CLOWN_TROUPE_SOUNDS.filter((id) => !SFX_GROUPS.bounty.includes(id));
  check(
    troupeMissing.length === 0,
    `an Evil Clown bounty's troupe is voiced by the bounty group (${troupeMissing.join(', ') || 'all there'})`,
  );
  const siegeTroupeMissing = SIEGE_TROUPE_SOUNDS.filter(
    (id) => !SFX_GROUPS.briarHollowSiege.includes(id),
  );
  check(
    siegeTroupeMissing.length === 0,
    `a siege's clowns and lemurs are voiced by the siege group (${siegeTroupeMissing.join(', ') || 'all there'})`,
  );
  const floorWide = new Set<SoundId>([...CORE_SFX_IDS, ...sfxGroupsForLevelId('level3')]);
  const defencesMissing = DEFENCE_SOUNDS.filter((id) => !floorWide.has(id));
  check(
    defencesMissing.length === 0,
    `the party's defences are decoded anywhere on floor 3 (${defencesMissing.join(', ') || 'all there'})`,
  );

  const audio = await freshManager(CORE_SFX_IDS);
  const floor = audio.createScope();
  await floor.keepCompressed(compressedSfxForLevelId('level3'));
  await harness.flush();
  const sourcesBefore = harness.sources.length;
  const startedOf = (id: SoundId): number =>
    harness.sources.slice(sourcesBefore).filter((source) => source.label === labelOf(id)).length;
  audio.play('mantid_hiss_2');
  await harness.flush();
  check(
    startedOf('mantid_hiss_2') === 1,
    'a gated cue played with its group never held still sounds, decoded from its kept file',
  );
  audio.holdSfxGroup('starlightTent', true);
  await harness.flush();
  audio.holdSfxGroup('starlightTent', false);
  await harness.flush();
  audio.play('high_striker_bell');
  await harness.flush();
  check(startedOf('high_striker_bell') === 1, 'and so does one whose group was decoded and let go');

  const racing = await freshManager(CORE_SFX_IDS);
  const racingFloor = racing.createScope();
  await racingFloor.keepCompressed(compressedSfxForLevelId('level3'));
  await harness.flush();
  const decodedBefore = racing.decodedBufferCount;
  racing.holdSfxGroup('bounty', true);
  racing.playWhenReady('mantid_furious');
  racing.holdSfxGroup('bounty', false);
  await harness.flush();
  check(
    racing.decodedBufferCount === decodedBefore,
    `a group let go before its decodes land stays let go (${racing.decodedBufferCount - decodedBefore} came back)`,
  );
  racing.holdSfxGroup('bounty', true);
  await harness.flush();
  check(
    startedOf('mantid_furious') === 0,
    'and a play waiting on it is dropped with it, not played when the group comes back',
  );
  racing.holdSfxGroup('bounty', false);

  const replaying = await freshManager(CORE_SFX_IDS);
  await replaying.createScope().keepCompressed(compressedSfxForLevelId('level3'));
  await harness.flush();
  replaying.holdSfxGroup('bounty', true);
  replaying.holdSfxGroup('bounty', false);
  replaying.play('mantid_hiss_3');
  await harness.flush();
  check(
    startedOf('mantid_hiss_3') === 1,
    'a play just after its group is let go mid-decode still sounds, decoded afresh',
  );

  const unkept = 'mantid_hiss_4' as const satisfies SoundId;
  const fetching = await freshManager([]);
  const fetchingScope = fetching.createScope();
  void fetchingScope.preload([unkept]);
  fetchingScope.dispose();
  fetching.play(unkept);
  await harness.flush();
  const startedPromptly = startedOf(unkept);
  harness.advance(SETTLE_MS);
  await harness.flush();
  check(
    startedPromptly === 1 && startedOf(unkept) === 1,
    `a play after a release mid-fetch of a file nobody keeps sounds at once, and once ` +
      `(${startedPromptly} then ${startedOf(unkept)})`,
  );

  const stopped = await freshManager([]);
  const stoppedScope = stopped.createScope();
  void stoppedScope.preload(['death_sequence']);
  stopped.playWhenReady('death_sequence');
  stopped.fadeOutSound('death_sequence', 0);
  await harness.flush();
  check(
    startedOf('death_sequence') === 0,
    'a stop before a waiting sound has loaded drops it rather than playing it after',
  );

  const sting = 'accepted_bounty' as const satisfies SoundId;
  const owner = await freshManager([]);
  const stingScope = owner.createScope();
  await stingScope.preload([sting]);
  await harness.flush();
  stingScope.dispose();
  owner.play(sting);
  await harness.flush();
  check(startedOf(sting) === 0, "an on-demand sting's unplayed file is let go with its scope");
}

async function checkRampedStops(): Promise<void> {
  const audio = await freshManager([
    'splat_1',
    'slots_jackpot_siren',
    'death_sequence',
    WALKING_LOOP.id,
    WADING_LOOP.id,
    SPIDER_WALKING_LOOP.id,
    MACHINERY_LOOP.id,
    'bopca_cooking',
    'keyboard_hero_music_track_1',
  ]);

  await expectRampedStops('stopSound on a full-volume one-shot', async () => {
    audio.play('death_sequence');
    await harness.flush();
    harness.advance(SETTLE_MS);
    audio.stopSound('death_sequence');
  });
  await expectRampedStops('fadeOutSound on a full-volume one-shot', async () => {
    audio.play('slots_jackpot_siren');
    await harness.flush();
    harness.advance(SETTLE_MS);
    audio.fadeOutSound('slots_jackpot_siren', SKIPPED_FADE_MS);
  });
  await expectRampedStops('fadeOutSound with no fade on a quieter one-shot', () => {
    audio.play('slots_jackpot_siren', { volume: ONE_SHOT_VOLUME });
    harness.advance(SETTLE_MS);
    audio.fadeOutSound('slots_jackpot_siren', 0);
  });
  await expectRampedStops('a one-shot cut by its scheduled fade', () => {
    audio.play('death_sequence', { fadeOut: { atS: 1, durationS: HALF } });
  });

  const scope = audio.createScope();
  for (const loop of [WALKING_LOOP, WADING_LOOP, SPIDER_WALKING_LOOP, MACHINERY_LOOP]) {
    await expectRampedStops(`stopping the ${loop.id} loop`, () => {
      scope.startLoop(loop);
      harness.advance(SETTLE_MS);
      scope.stopLoop(loop);
    });
  }
  await expectRampedStops('stopping a decoded ambient loop', () => {
    scope.startAmbientLoop('bopca_cooking', BED_VOLUME);
    harness.advance(SETTLE_MS);
    scope.stopAmbientLoop('bopca_cooking');
  });
  await expectRampedStops('stopping a streamed ambient bed', () => {
    scope.startAmbientLoop('ambient_fountain', BED_VOLUME);
    harness.advance(SETTLE_MS);
    scope.stopAmbientLoop('ambient_fountain');
  });
  await expectRampedStops('stopping the keyboard-hero song', () => {
    scope.startKeyboardHeroMusic();
    harness.advance(SETTLE_MS);
    scope.stopKeyboardHeroMusic();
  });

  await expectRampedStops('releasing a streamed track', () => {
    playTrack(audio, 'bg_level_1');
    harness.advance(SETTLE_MS);
    stopTrack(audio);
  });
  await expectRampedStops('a streamed track replaced with no fade', () => {
    playTrack(audio, 'bg_level_1');
    harness.advance(SETTLE_MS);
    playTrack(audio, 'bg_level_2');
  });
  await expectRampedStops('a streamed track crossfaded out', () => {
    playTrack(audio, 'town_music_1');
    harness.advance(SETTLE_MS);
    playTrack(audio, 'town_music_2', CROSSFADE_MS);
    harness.advance(CROSSFADE_MS * HALF);
    const sounding = (id: SoundId): boolean =>
      harness.elements().some((el) => !el.paused && el.src === labelOf(id));
    check(
      sounding('town_music_1') && sounding('town_music_2'),
      'mid-crossfade, the outgoing and incoming tracks both play',
    );
  });
  await expectRampedStops('three changes of track inside one crossfade', () => {
    playTrack(audio, 'town_music_1');
    harness.advance(SETTLE_MS);
    playTrack(audio, 'forest_path', CROSSFADE_MS);
    harness.advance(CROSSFADE_MS * HALF);
    playTrack(audio, 'town_music_2', CROSSFADE_MS);
    harness.advance(CROSSFADE_MS * HALF);
    playTrack(audio, 'bg_level_1', CROSSFADE_MS);
  });
  const superseded = 'bg_level_2';
  await expectRampedStops(
    'more changes of track than there are slots, inside one crossfade',
    () => {
      for (const id of [
        'town_music_1',
        'forest_path',
        'town_music_2',
        'bg_level_1',
        superseded,
      ] as const) {
        playTrack(audio, id, CROSSFADE_MS);
      }
      // Stopped while its stolen slot is still fading the old track out.
      stopTrack(audio, CROSSFADE_MS);
    },
  );
  check(
    harness.elements().every((el) => el.paused || el.src !== labelOf(superseded)),
    'a track stopped while its stolen slot was still fading never starts',
  );
  await expectRampedStops('a decoded track stopped', () => {
    playTrack(audio, 'keyboard_hero_music_track_1');
    harness.advance(SETTLE_MS);
    stopTrack(audio, 0);
  });

  await expectRampedStops('backgrounding the page with loops running', async () => {
    scope.startLoop(MACHINERY_LOOP);
    scope.startAmbientLoop('ambient_forge', BED_VOLUME);
    scope.startKeyboardHeroMusic();
    harness.advance(SETTLE_MS);
    blurWindow();
    harness.advance(SETTLE_MS);
    focusWindow();
    await harness.flush();
  });
  await expectRampedStops('disposing a scope with loops running', () => {
    scope.startLoop(WALKING_LOOP);
    scope.startAmbientLoop('ambient_fountain', BED_VOLUME);
    harness.advance(SETTLE_MS);
    scope.dispose();
  });
  audio.dispose();
}

interface AudioCheck {
  readonly id: number;
  readonly name: string;
  readonly run: () => Promise<void>;
}

const unlockGesture = (type: string): void => {
  harness.gesture(() => shim.window.dispatch(new ShimEvent(type, '', 0)));
};

const CHECKS: readonly AudioCheck[] = [
  {
    id: 1,
    name: 'the highest claim wins',
    run: () => director.checkHighestClaimWins(harness, check),
  },
  { id: 2, name: 'scene handover', run: () => director.checkHandover(harness, check) },
  { id: 3, name: 'resume on return', run: () => director.checkResume(harness, check) },
  { id: 4, name: 'unlock and credit', run: () => director.checkUnlockAndCredit(harness, check) },
  {
    id: 5,
    name: 'player modes',
    run: async () => {
      await director.checkPlayerModes(harness, check);
      await director.checkPlayerModesFollowTheLibrary(harness, check);
    },
  },
  {
    id: 6,
    name: 'play once',
    run: async () => {
      await director.checkPlayOnce(harness, check);
      await director.checkPlayOnceOfAnUndecodedSong(harness, check);
    },
  },
  {
    id: 7,
    name: 'autoplay lock',
    run: () => director.checkAutoplayLock(harness, check, unlockGesture),
  },
  {
    id: 8,
    name: 'exclusive outranks the player',
    run: () => director.checkExclusive(harness, check),
  },
  { id: 9, name: 'shuffle never repeats', run: () => director.checkShuffle(harness, check) },
  { id: 10, name: 'jingles', run: () => director.checkJingles(harness, check) },
  { id: 11, name: 'save round-trip keeps the music library', run: () => checkSaveRoundTrip(check) },
  { id: 12, name: "what a run's music library starts with", run: () => checkBackfill(check) },
  { id: 13, name: 'voices and rate limits', run: () => voices.checkVoices(harness, check) },
  { id: 14, name: 'scope disposal and background resume', run: checkScopeDisposal },
  { id: 15, name: 'ramped stops', run: checkRampedStops },
  {
    id: 16,
    name: 'music notices survive a scene change',
    run: () => Promise.resolve(checkNoticesSurviveSceneChange(check)),
  },
  { id: 17, name: 'stings duck the music', run: () => voices.checkStingerDuck(harness, check) },
  { id: 18, name: 'placed sounds', run: () => voices.checkPlacedSounds(harness, check) },
  { id: 19, name: 'captions', run: () => accessibility.checkCaptions(harness, check) },
  {
    id: 20,
    name: 'mute, mono and background audio',
    run: () =>
      accessibility.checkMuteAndMono(harness, check, { blur: blurWindow, focus: focusWindow }),
  },
  { id: 21, name: 'effects hush', run: () => voices.checkEffectsHush(harness, check) },
  {
    id: 22,
    name: 'the pause menu holds the music',
    run: () => director.checkPauseMenuHoldsMusic(harness, check),
  },
  { id: 23, name: 'on-demand stings', run: checkOnDemandStings },
  { id: 24, name: 'gated floor-3 groups', run: checkGatedGroups },
  { id: 25, name: "gated groups' safety net", run: checkGatedSafetyNet },
];

const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const only = onlyArg === undefined ? null : Number(onlyArg.slice('--only='.length));

for (const entry of CHECKS) {
  if (only !== null && entry.id !== only) continue;
  console.log(`\n${entry.id}. ${entry.name}`);
  await entry.run();
}

if (failures.length > 0) {
  console.log(`\nFAIL verify:audio — ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nPASS verify:audio');
