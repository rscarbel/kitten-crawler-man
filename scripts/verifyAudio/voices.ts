/**
 * How one-shots share the mixer, for `verify-audio.ts`: per-id voice caps
 * and the oldest copy stolen, the global cap and its priorities, same-frame
 * dedupe, stings ducking the music, the effects hush, and sounds placed in
 * the world. A real `AudioManager` over the fake graph; imported after the
 * fake audio and the browser shim are installed.
 */

import {
  AudioManager,
  GLOBAL_VOICE_LIMIT,
  PLACED_MAX_PAN,
  type PlayedCue,
} from '../../src/audio/AudioManager.js';
import { soundTraits, STINGER_IDS } from '../../src/audio/soundTraits.js';
import { SOUND_MANIFEST, type SoundId } from '../../src/audio/sounds.js';
import { dbToGain } from '../../src/audio/voiceFades.js';
import { TILE_SIZE } from '../../src/core/constants.js';
import { EventBus } from '../../src/core/EventBus.js';
import { BallOfSwine } from '../../src/creatures/BallOfSwine.js';
import { ARENA_INTERIOR_RADIUS_TILES } from '../../src/map/arenaGeometry.js';
import { playMobAudioCues } from '../../src/systems/GameLoopPhases.js';
import {
  setVisibleWorldView,
  visibleWorldView,
  type VisibleWorldView,
} from '../../src/core/rendering/visibleWorldView.js';
import {
  FakeBiquadFilterNode,
  FakeGainNode,
  FakeStereoPannerNode,
  firstOf,
  type AudioHarness,
  type SourceRecord,
} from '../audioHarness.js';

type Check = (ok: boolean, message: string) => void;
type Manager = InstanceType<typeof AudioManager>;

/** Longer than any id's minimum interval, so the next start is a fresh one. */
const PAST_INTERVAL_MS = 40;
/** Shorter than the default minimum interval. */
const INSIDE_INTERVAL_MS = 10;
/** A gain this small at the instant a voice stops cannot be heard as a click. */
const SILENT_GAIN = 1e-4;
const MS_PER_SECOND = 1000;
/** Long enough for any steal fade or duck release to finish. */
const SETTLE_MS = 1000;
/** More copies than any per-id cap allows. */
const OVER_CAP_COPIES = 6;
/** Ten goblins swinging on one frame. */
const SAME_FRAME_SWINGS = 10;
const GOBLIN_TAKES = ['goblin_1', 'goblin_2'] as const satisfies readonly SoundId[];
/** Normal-priority voices with no traits of their own, enough of them to fill the global cap. */
const FILLER_IDS = [
  'goblin_1',
  'goblin_2',
  'rat_squeak_1',
  'rat_squeak_2',
  'rat_squeak_3',
  'hawkfolk_1',
  'hawkfolk_2',
  'clown_horn',
] as const satisfies readonly SoundId[];
const LOW_PRIORITY_ID = 'coin_land_tick' as const satisfies SoundId;
const HIGH_PRIORITY_ID = 'menu_click' as const satisfies SoundId;
const STINGER = 'level_complete' as const satisfies SoundId;
const STINGER_LENGTH_S = 2;
/** A sound with no duck of its own. */
const PLAIN_ID = 'splat_1' as const satisfies SoundId;
const DECODED_TRACK = 'keyboard_hero_music_track_1' as const satisfies SoundId;
const STINGER_DUCK_DB = -8;
/** How close to its target the ducked bus must sit. */
const GAIN_TOLERANCE = 0.02;
/** Halfway through the sting, the duck has long since landed. */
const MID_STING_MS = 1000;
/** A placed sound's distance to the listener's right, inside hearing range. */
const NEAR_RIGHT_TILES = 5;
/** Far enough to the left that the pan is at its cap. */
const FAR_LEFT_TILES = 12;
/** Beyond any default hearing range. */
const OUT_OF_RANGE_TILES = 30;
/** From one side of the boss arena's floor to the other: further than ordinary hearing. */
const ACROSS_ARENA_TILES = ARENA_INTERIOR_RADIUS_TILES * 2;
const LISTENER_X = 1000;
const LISTENER_Y = 1000;
/** A siege engine's throw, which carries further muffled when out of sight. */
const SIEGE_ENGINE_ID = 'trebuchet_fire_1' as const satisfies SoundId;
/** To the right of the listener: inside on-screen hearing, off a narrow view. */
const SIEGE_ENGINE_NEAR_TILES = 20;
/** Past even the off-screen hearing range of a siege engine. */
const SIEGE_ENGINE_BEYOND_TILES = 45;
/** A view wide enough to show the near siege engine, centred on the listener. */
const WIDE_VIEW_TILES = 48;
/** A view too narrow to show it. */
const NARROW_VIEW_TILES = 10;

function viewAroundListener(widthTiles: number): VisibleWorldView {
  const widthPx = widthTiles * TILE_SIZE;
  return {
    left: LISTENER_X - widthPx / 2,
    top: LISTENER_Y - widthPx / 2,
    width: widthPx,
    height: widthPx,
    sight: null,
  };
}

function labelOf(id: SoundId): string {
  return SOUND_MANIFEST[id];
}

async function freshManager(harness: AudioHarness, ids: readonly SoundId[]): Promise<Manager> {
  const audio = new AudioManager();
  await audio.createScope().preload(ids);
  await harness.flush();
  return audio;
}

function startedSince(harness: AudioHarness, before: number): SourceRecord[] {
  return harness.sources.slice(before);
}

function soundingOf(sources: readonly SourceRecord[], id: SoundId): SourceRecord[] {
  return sources.filter((source) => source.label === labelOf(id) && !source.isSilenced());
}

/** The low-pass a source plays through after its own gain, or null when it is unfiltered. */
function filterOf(source: SourceRecord): FakeBiquadFilterNode | null {
  const ownGain = source.firstOutput;
  if (ownGain === null) return null;
  const next = firstOf(ownGain.outputs);
  return next instanceof FakeBiquadFilterNode ? next : null;
}

/** The pan of the panner a source plays through, or 0 when it plays centred. */
function panOf(source: SourceRecord): number {
  const ownGain = source.firstOutput;
  if (ownGain === null) return 0;
  const afterGain = filterOf(source) ?? ownGain;
  const panner = firstOf(afterGain.outputs);
  return panner instanceof FakeStereoPannerNode ? panner.pan.value : 0;
}

function levelOf(source: SourceRecord): number {
  const ownGain = source.firstOutput;
  return ownGain instanceof FakeGainNode ? ownGain.gain.value : Number.NaN;
}

/** 13. Voice caps, stealing and same-frame dedupe. */
export async function checkVoices(harness: AudioHarness, check: Check): Promise<void> {
  const audio = await freshManager(harness, [
    ...FILLER_IDS,
    LOW_PRIORITY_ID,
    HIGH_PRIORITY_ID,
    'hawkfolk_talon_steps',
  ]);

  const perIdBefore = harness.sources.length;
  for (let i = 0; i < OVER_CAP_COPIES; i++) {
    audio.play('goblin_1');
    harness.advance(PAST_INTERVAL_MS);
  }
  const goblinCopies = startedSince(harness, perIdBefore);
  const goblinCap = soundTraits('goblin_1').maxVoices;
  const stillSounding = soundingOf(goblinCopies, 'goblin_1');
  check(
    goblinCopies.length === OVER_CAP_COPIES && stillSounding.length === goblinCap,
    `${OVER_CAP_COPIES} spaced goblin cries keep ${goblinCap} voices (${stillSounding.length} sounding)`,
  );
  check(
    goblinCopies.slice(0, OVER_CAP_COPIES - goblinCap).every((source) => source.isSilenced()),
    'the copies past the cap stole the oldest voices',
  );
  const stolen = harness.silences.filter((silence) => silence.label === labelOf('goblin_1'));
  check(
    stolen.length > 0 &&
      stolen.every((silence) => silence.gain !== null && silence.gain < SILENT_GAIN),
    'a stolen voice ramps to silence before it stops',
  );

  const footstepsBefore = harness.sources.length;
  for (let i = 0; i < OVER_CAP_COPIES; i++) {
    audio.play('hawkfolk_talon_steps');
    harness.advance(PAST_INTERVAL_MS);
  }
  const footsteps = soundingOf(startedSince(harness, footstepsBefore), 'hawkfolk_talon_steps');
  check(
    footsteps.length === soundTraits('hawkfolk_talon_steps').maxVoices,
    `footsteps hold ${soundTraits('hawkfolk_talon_steps').maxVoices} voices (${footsteps.length} sounding)`,
  );
  harness.advance(SETTLE_MS);
  audio.stopSound('goblin_1');
  audio.stopSound('hawkfolk_talon_steps');
  harness.advance(SETTLE_MS);

  const dedupeBefore = harness.sources.length;
  for (let i = 0; i < SAME_FRAME_SWINGS; i++) audio.playRandom(GOBLIN_TAKES);
  const sameFrame = startedSince(harness, dedupeBefore).length;
  check(
    sameFrame === GOBLIN_TAKES.length,
    `${SAME_FRAME_SWINGS} goblins swinging on one frame make ${GOBLIN_TAKES.length} voices (${sameFrame})`,
  );
  harness.advance(INSIDE_INTERVAL_MS);
  const insideBefore = harness.sources.length;
  audio.play('goblin_1');
  check(harness.sources.length === insideBefore, 'a repeat inside the minimum interval is dropped');
  harness.advance(PAST_INTERVAL_MS);
  audio.play('goblin_1');
  check(harness.sources.length === insideBefore + 1, 'a repeat after the interval plays');
  for (const id of FILLER_IDS) audio.stopSound(id);
  harness.advance(SETTLE_MS);

  const fillCap = soundTraits(FILLER_IDS[0]).maxVoices;
  const fillBefore = harness.sources.length;
  for (let round = 0; round < fillCap; round++) {
    for (const id of FILLER_IDS) audio.play(id);
    harness.advance(PAST_INTERVAL_MS);
  }
  const filled = startedSince(harness, fillBefore);
  check(
    audio.liveVoiceCount === GLOBAL_VOICE_LIMIT,
    `the mixer fills to ${GLOBAL_VOICE_LIMIT} voices (${audio.liveVoiceCount})`,
  );
  const lowBefore = harness.sources.length;
  audio.play(LOW_PRIORITY_ID);
  check(
    harness.sources.length === lowBefore && filled.every((source) => !source.isSilenced()),
    'a low-priority sound is dropped when everything playing outranks it',
  );
  audio.play(HIGH_PRIORITY_ID);
  const oldest = filled[0];
  check(
    harness.sources.length === lowBefore + 1 &&
      oldest.isSilenced() &&
      filled.slice(1).every((source) => !source.isSilenced()),
    'a high-priority sound steals the oldest lower-priority voice, and only that one',
  );
  check(
    audio.liveVoiceCount === GLOBAL_VOICE_LIMIT,
    `the mixer stays at ${GLOBAL_VOICE_LIMIT} voices after a steal (${audio.liveVoiceCount})`,
  );
  audio.dispose();
}

/** 17. A sting ducks the music for its length, and lets it back up when it ends. */
export async function checkStingerDuck(harness: AudioHarness, check: Check): Promise<void> {
  check(
    STINGER_IDS.every((id) => soundTraits(id).duckMusic !== null),
    'every sting carries a music duck',
  );
  harness.setDuration(labelOf(STINGER), STINGER_LENGTH_S);
  const audio = await freshManager(harness, [STINGER, PLAIN_ID, DECODED_TRACK]);
  const holder = {};
  const trackBefore = harness.sources.length;
  audio.music.claim(
    { owner: 'floor', layer: 'area', selection: { kind: 'loop', id: DECODED_TRACK } },
    holder,
  );
  harness.advance(SETTLE_MS);
  const track = harness.sources
    .slice(trackBefore)
    .find((source) => source.label === labelOf(DECODED_TRACK));
  const musicBus = track?.firstOutput === null ? null : firstOf(track?.firstOutput?.outputs ?? []);
  if (!(musicBus instanceof FakeGainNode)) {
    check(false, 'the decoded track feeds the music bus');
    audio.dispose();
    return;
  }
  const open = musicBus.gain.value;

  audio.play(PLAIN_ID);
  harness.advance(MID_STING_MS);
  check(
    Math.abs(musicBus.gain.value - open) < GAIN_TOLERANCE,
    'a sound with no duck leaves the music alone',
  );

  audio.play(STINGER);
  harness.advance(MID_STING_MS);
  const ducked = musicBus.gain.value;
  const expected = open * dbToGain(STINGER_DUCK_DB);
  check(
    Math.abs(ducked - expected) < GAIN_TOLERANCE,
    `under the sting the music sits about 8 dB down (${ducked.toFixed(3)} of ${open.toFixed(3)})`,
  );
  harness.advance(STINGER_LENGTH_S * MS_PER_SECOND + SETTLE_MS);
  check(
    Math.abs(musicBus.gain.value - open) < GAIN_TOLERANCE,
    `once the sting ends the music comes back (${musicBus.gain.value.toFixed(3)})`,
  );
  audio.dispose();
}

/** The bus a one-shot's own gain feeds, or null when it plays through a panner. */
function busOf(source: SourceRecord | undefined): FakeGainNode | null {
  const ownGain = source?.firstOutput ?? null;
  if (ownGain === null) return null;
  const bus = firstOf(ownGain.outputs);
  return bus instanceof FakeGainNode ? bus : null;
}

/** An Effects slider position other than the player's, to see a move during the hush. */
const MOVED_SFX_SLIDER = 0.4;

/**
 * 21. A hush silences the effects bus while the `ui` bus plays on, holds
 * through a slider move, and gives the slider's level back when it lets go.
 */
export async function checkEffectsHush(harness: AudioHarness, check: Check): Promise<void> {
  const audio = await freshManager(harness, [PLAIN_ID, HIGH_PRIORITY_ID]);
  const playedBefore = harness.sources.length;
  audio.play(PLAIN_ID);
  audio.play(HIGH_PRIORITY_ID, { bus: 'ui' });
  const [effect, interfaceCue] = startedSince(harness, playedBefore);
  const sfxBus = busOf(effect);
  const uiBus = busOf(interfaceCue);
  if (sfxBus === null || uiBus === null || sfxBus === uiBus) {
    check(false, 'an effect and an interface cue play through two different buses');
    audio.dispose();
    return;
  }
  const openLevel = sfxBus.gain.value;
  const uiLevel = uiBus.gain.value;
  harness.advance(SETTLE_MS);

  audio.hushEffects('siege_victory', 0);
  harness.advance(SETTLE_MS);
  check(
    sfxBus.gain.value < SILENT_GAIN,
    `a hush silences the effects bus (${sfxBus.gain.value.toFixed(3)})`,
  );
  check(
    Math.abs(uiBus.gain.value - uiLevel) < GAIN_TOLERANCE,
    `a hush leaves the ui bus at the player's level (${uiBus.gain.value.toFixed(3)})`,
  );
  harness.advance(PAST_INTERVAL_MS);
  const hushedBefore = harness.sources.length;
  audio.play(HIGH_PRIORITY_ID, { bus: 'ui' });
  const hushedCue = startedSince(harness, hushedBefore)[0];
  check(
    hushedCue !== undefined && busOf(hushedCue) === uiBus && uiBus.gain.value > SILENT_GAIN,
    'a ui one-shot plays, and is heard, through a hush',
  );

  const playerLevel = audio.sfxVolume;
  audio.setSfxVolumePreference(MOVED_SFX_SLIDER);
  harness.advance(SETTLE_MS);
  check(
    sfxBus.gain.value < SILENT_GAIN,
    `moving the Effects slider during a hush keeps the effects bus silent (${sfxBus.gain.value.toFixed(3)})`,
  );
  audio.setSfxVolumePreference(playerLevel);
  harness.advance(SETTLE_MS);

  audio.unhushEffects('siege_victory', 0);
  harness.advance(SETTLE_MS);
  check(
    Math.abs(sfxBus.gain.value - openLevel) < GAIN_TOLERANCE,
    `letting go of the hush brings the effects bus back to the slider's level (${sfxBus.gain.value.toFixed(3)} of ${openLevel.toFixed(3)})`,
  );
  audio.dispose();
}

/** 18. Placed sounds: culled out of range before taking a voice, quieter with distance, panned and capped. */
export async function checkPlacedSounds(harness: AudioHarness, check: Check): Promise<void> {
  const audio = await freshManager(harness, ['goblin_1', 'rat_squeak_1']);
  const cues: PlayedCue[] = [];
  const unsubscribe = audio.onCuePlayed((cue) => cues.push(cue));
  audio.setListener(LISTENER_X, LISTENER_Y);

  const farBefore = harness.sources.length;
  audio.playAt('goblin_1', LISTENER_X + OUT_OF_RANGE_TILES * TILE_SIZE, LISTENER_Y);
  check(
    harness.sources.length === farBefore && audio.liveVoiceCount === 0,
    'a sound beyond hearing range is dropped before it takes a voice',
  );

  audio.play('rat_squeak_1');
  audio.playAt('goblin_1', LISTENER_X + NEAR_RIGHT_TILES * TILE_SIZE, LISTENER_Y);
  harness.advance(PAST_INTERVAL_MS);
  audio.playAt('goblin_1', LISTENER_X - FAR_LEFT_TILES * TILE_SIZE, LISTENER_Y);
  const [beside, right, left] = startedSince(harness, farBefore);
  if (beside === undefined || right === undefined || left === undefined) {
    check(false, 'the near placed sounds play');
    audio.dispose();
    return;
  }
  const rightPan = panOf(right);
  const leftPan = panOf(left);
  check(
    rightPan > 0 && rightPan <= PLACED_MAX_PAN,
    `a sound to the right pans right (${rightPan.toFixed(2)})`,
  );
  check(
    Math.abs(leftPan + PLACED_MAX_PAN) < GAIN_TOLERANCE,
    `a sound far to the left pans left, no further than ${PLACED_MAX_PAN} (${leftPan.toFixed(2)})`,
  );
  check(panOf(beside) === 0, 'an unplaced sound plays centred');
  check(levelOf(left) < levelOf(right), 'the farther placed sound is quieter');
  const placed = cues.filter((cue) => cue.source !== null);
  check(
    placed.length === 2 && cues.length === 3,
    `every started cue is reported, the placed ones with their source (${placed.length} of ${cues.length})`,
  );
  const audioFar = 'deep_rumbling' as const satisfies SoundId;
  await audio.createScope().preload([audioFar, 'cat_missile_impact', 'arrow_impact']);
  await harness.flush();
  harness.advance(PAST_INTERVAL_MS);

  const swine = new BallOfSwine(
    LISTENER_X / TILE_SIZE + ACROSS_ARENA_TILES,
    LISTENER_Y / TILE_SIZE,
    TILE_SIZE,
  );
  swine.spinupSoundPending = true;
  const swineBefore = harness.sources.length;
  playMobAudioCues([swine], audio);
  const telegraph = startedSince(harness, swineBefore).find(
    (source) => source.label === labelOf(audioFar),
  );
  check(
    telegraph !== undefined && levelOf(telegraph) > 0 && panOf(telegraph) > 0,
    `a boss's telegraph from across its arena still plays, panned toward it (${
      telegraph === undefined ? 'dropped' : `level ${levelOf(telegraph).toFixed(2)}`
    })`,
  );

  const bus = new EventBus();
  audio.wireEvents(bus);
  const shotsBefore = harness.sources.length;
  const farShotX = LISTENER_X + OUT_OF_RANGE_TILES * TILE_SIZE;
  bus.emit('missileImpact', { x: farShotX, y: LISTENER_Y });
  bus.emit('slingshotImpact', { x: farShotX, y: LISTENER_Y });
  const shots = startedSince(harness, shotsBefore);
  check(
    shots.length === 2 && shots.every((source) => panOf(source) > 0),
    `the party's own shots landing far off still play, panned toward where they land (${shots.length} of 2)`,
  );
  unsubscribe();
  audio.dispose();
  await checkOffscreenSoundsDistant(harness, check);
}

/** Part of 18: a siege engine out of sight is heard further, but quieter and muffled. */
async function checkOffscreenSoundsDistant(harness: AudioHarness, check: Check): Promise<void> {
  const audio = await freshManager(harness, [SIEGE_ENGINE_ID]);
  audio.setListener(LISTENER_X, LISTENER_Y);
  const publishedView = visibleWorldView();
  const nearX = LISTENER_X + SIEGE_ENGINE_NEAR_TILES * TILE_SIZE;

  setVisibleWorldView(viewAroundListener(WIDE_VIEW_TILES));
  const inViewBefore = harness.sources.length;
  audio.playAt(SIEGE_ENGINE_ID, nearX, LISTENER_Y);
  const [inView] = startedSince(harness, inViewBefore);
  harness.advance(PAST_INTERVAL_MS);

  setVisibleWorldView(viewAroundListener(NARROW_VIEW_TILES));
  const offViewBefore = harness.sources.length;
  audio.playAt(SIEGE_ENGINE_ID, nearX, LISTENER_Y);
  const [offView] = startedSince(harness, offViewBefore);
  harness.advance(PAST_INTERVAL_MS);

  const beyondBefore = harness.sources.length;
  audio.playAt(SIEGE_ENGINE_ID, LISTENER_X + SIEGE_ENGINE_BEYOND_TILES * TILE_SIZE, LISTENER_Y);
  const beyondStarted = harness.sources.length - beyondBefore;
  setVisibleWorldView(publishedView);

  check(
    inView !== undefined && filterOf(inView) === null && panOf(inView) > 0,
    'a siege engine in view plays unfiltered, panned toward it',
  );
  check(
    inView !== undefined &&
      offView !== undefined &&
      filterOf(offView) !== null &&
      levelOf(offView) < levelOf(inView) &&
      panOf(offView) > 0,
    `the same throw off the view plays quieter through a low-pass (${
      offView === undefined ? 'dropped' : `level ${levelOf(offView).toFixed(3)}`
    }${inView === undefined ? '' : ` vs ${levelOf(inView).toFixed(3)}`})`,
  );
  check(beyondStarted === 0, 'past its off-screen hearing range it takes no voice');
  audio.dispose();
}
