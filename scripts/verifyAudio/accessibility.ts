/**
 * The accessibility options, for `verify-audio.ts`: sound captions posted
 * from the cues a real `AudioManager` plays, and mute, mono and background
 * audio leaving the graph whole. Imported after the fake audio and the
 * browser shim are installed.
 */

import { AudioManager } from '../../src/audio/AudioManager.js';
import { soundTraits } from '../../src/audio/soundTraits.js';
import type { SoundId } from '../../src/audio/sounds.js';
import { TILE_SIZE } from '../../src/core/constants.js';
import type { VisibleWorldView } from '../../src/core/rendering/visibleWorldView.js';
import { listenForCaptions, SoundCaptions } from '../../src/ui/hud/captions.js';
import {
  FakeChannelMergerNode,
  FakeGainNode,
  type AudioHarness,
  type FakeAudioNode,
} from '../audioHarness.js';

type Check = (ok: boolean, message: string) => void;
type Manager = InstanceType<typeof AudioManager>;

/** Longer than any id's minimum interval, so the next start is a fresh one. */
const PAST_INTERVAL_MS = 40;
/** Long enough for every setting's ramp to land. */
const RAMP_SETTLE_MS = 200;
const LISTENER_X = 1000;
const LISTENER_Y = 1000;
/** A camera window around the listener, small enough that a cry in earshot can be off it. */
const VIEW_HALF_W = 200;
const VIEW_HALF_H = 120;
/** A cry inside the camera window, just right of the listener. */
const ON_SCREEN_OFFSET_TILES = 2;
/** A cry left of the window but well inside hearing range. */
const OFF_SCREEN_LEFT_TILES = 9;
/** How close the chevron must point to straight left, in radians. */
const DIRECTION_TOLERANCE = 0.05;
/** A gain below this carries nothing audible. */
const SILENT_GAIN = 1e-4;
const ALWAYS_ID = 'bell_alarm' as const satisfies SoundId;
const OFFSCREEN_TAKES = ['goblin_1', 'goblin_2'] as const satisfies readonly SoundId[];
/** A sound with no caption. */
const PLAIN_ID = 'splat_1' as const satisfies SoundId;
/** The off-screen cry is heard three times, across both takes. */
const MERGED_REPEATS = 3;

const VIEW: VisibleWorldView = {
  left: LISTENER_X - VIEW_HALF_W,
  top: LISTENER_Y - VIEW_HALF_H,
  width: VIEW_HALF_W * 2,
  height: VIEW_HALF_H * 2,
  sight: null,
};

async function freshManager(harness: AudioHarness, ids: readonly SoundId[]): Promise<Manager> {
  const audio = new AudioManager();
  await audio.createScope().preload(ids);
  await harness.flush();
  return audio;
}

function captionText(id: SoundId): string {
  return soundTraits(id).caption?.text ?? '(no caption)';
}

export async function checkCaptions(harness: AudioHarness, check: Check): Promise<void> {
  const audio = await freshManager(harness, [ALWAYS_ID, ...OFFSCREEN_TAKES, PLAIN_ID]);
  const captions = new SoundCaptions();
  let enabled = true;
  const stop = listenForCaptions(
    audio,
    captions,
    () => VIEW,
    () => enabled,
  );
  audio.setListener(LISTENER_X, LISTENER_Y);
  const [firstTake, secondTake] = OFFSCREEN_TAKES;
  const snarl = captionText(firstTake);

  audio.play(ALWAYS_ID);
  const alarm = captions.shown.find((line) => line.text === captionText(ALWAYS_ID));
  check(
    alarm?.direction === null,
    `an always cue posts its caption, with no chevron for a sound with no place (${captions.shown.length} line(s))`,
  );

  audio.play(PLAIN_ID);
  check(captions.shown.length === 1, 'a sound with no caption posts nothing');

  audio.playAt(firstTake, LISTENER_X + ON_SCREEN_OFFSET_TILES * TILE_SIZE, LISTENER_Y);
  check(
    !captions.shown.some((line) => line.text === snarl),
    'an offscreen cue whose source is on screen posts nothing',
  );

  harness.advance(PAST_INTERVAL_MS);
  const offX = LISTENER_X - OFF_SCREEN_LEFT_TILES * TILE_SIZE;
  audio.playAt(firstTake, offX, LISTENER_Y);
  const offscreen = captions.shown.filter((line) => line.text === snarl);
  const direction = offscreen[0]?.direction ?? null;
  check(
    offscreen.length === 1 &&
      direction !== null &&
      Math.abs(Math.abs(direction) - Math.PI) < DIRECTION_TOLERANCE,
    `an offscreen cue from off screen left posts one caption pointing left (${
      direction === null ? 'no direction' : `${direction.toFixed(2)} rad`
    })`,
  );

  harness.advance(PAST_INTERVAL_MS);
  audio.playAt(secondTake, offX, LISTENER_Y);
  harness.advance(PAST_INTERVAL_MS);
  audio.playAt(firstTake, offX, LISTENER_Y);
  const merged = captions.shown.filter((line) => line.text === snarl);
  check(
    merged.length === 1 && merged[0]?.count === MERGED_REPEATS,
    `repeats across takes merge into one line (${merged.length} line(s), ×${merged[0]?.count ?? 0})`,
  );

  captions.clear();
  audio.setMuted(true);
  harness.advance(PAST_INTERVAL_MS);
  audio.play(ALWAYS_ID);
  check(captions.shown.length === 1, 'a caption still posts while everything is muted');
  audio.setMuted(false);

  captions.clear();
  enabled = false;
  harness.advance(PAST_INTERVAL_MS);
  audio.play(ALWAYS_ID);
  check(captions.shown.length === 0, 'nothing posts while captions are off');

  stop();
  audio.dispose();
}

interface PathToSpeakers {
  /** Every gain on the way multiplied together: zero means nothing reaches the speakers. */
  readonly gain: number;
  readonly merger: FakeChannelMergerNode | null;
  /** The node feeding the merger, which must sum to one channel. */
  readonly intoMerger: FakeAudioNode | null;
}

/** Every route from `node` to `destination`, with what it carries. */
function pathsToSpeakers(node: FakeAudioNode, destination: FakeAudioNode): PathToSpeakers[] {
  const walk = (
    at: FakeAudioNode,
    gain: number,
    previous: FakeAudioNode | null,
    merger: FakeChannelMergerNode | null,
    intoMerger: FakeAudioNode | null,
  ): PathToSpeakers[] => {
    const here = at instanceof FakeGainNode ? gain * at.gain.value : gain;
    const isMerger = at instanceof FakeChannelMergerNode;
    const nextMerger = isMerger ? at : merger;
    const nextInto = isMerger ? previous : intoMerger;
    if (at === destination) return [{ gain: here, merger: nextMerger, intoMerger: nextInto }];
    return [...at.outputs].flatMap((next) => walk(next, here, at, nextMerger, nextInto));
  };
  return walk(node, 1, null, null, null);
}

function audible(paths: readonly PathToSpeakers[]): PathToSpeakers[] {
  return paths.filter((path) => path.gain > SILENT_GAIN);
}

/**
 * Plays a fresh one-shot and returns its routes to the speakers that carry
 * sound, or null when the voice never started.
 */
function audibleRoutesOfNewVoice(harness: AudioHarness, audio: Manager): PathToSpeakers[] | null {
  harness.advance(PAST_INTERVAL_MS);
  const before = harness.sources.length;
  audio.play(PLAIN_ID);
  const voice = harness.sources[before]?.firstOutput ?? null;
  if (voice === null) return null;
  return audible(pathsToSpeakers(voice, harness.context().destination));
}

function routeCount(routes: readonly PathToSpeakers[] | null): string {
  return routes === null ? 'no voice started' : `${routes.length} audible route(s)`;
}

function isDownmixedToBothSpeakers(path: PathToSpeakers): boolean {
  const { merger, intoMerger } = path;
  if (merger === null || intoMerger === null) return false;
  const feedsBothSides = merger.inputsFed.has(0) && merger.inputsFed.has(1);
  const oneChannel =
    intoMerger.channelCount === 1 &&
    intoMerger.channelCountMode === 'explicit' &&
    intoMerger.channelInterpretation === 'speakers';
  return feedsBothSides && oneChannel;
}

export async function checkMuteAndMono(
  harness: AudioHarness,
  check: Check,
  window: { blur(): void; focus(): void },
): Promise<void> {
  const audio = await freshManager(harness, [PLAIN_ID]);

  const stereo = audibleRoutesOfNewVoice(harness, audio);
  check(
    stereo !== null && stereo.length === 1 && stereo[0]?.merger === null,
    `stereo: one audible route to the speakers, past no downmix (${routeCount(stereo)})`,
  );

  audio.setMonoAudio(true);
  harness.advance(RAMP_SETTLE_MS);
  const mono = audibleRoutesOfNewVoice(harness, audio);
  check(
    mono !== null && mono.length === 1 && mono.every(isDownmixedToBothSpeakers),
    `mono: the one audible route is downmixed to one channel and fed to both speakers (${routeCount(mono)})`,
  );

  audio.setMuted(true);
  harness.advance(RAMP_SETTLE_MS);
  const muted = audibleRoutesOfNewVoice(harness, audio);
  check(
    muted !== null && muted.length === 0,
    `muted: voices still start but no route reaches the speakers (${routeCount(muted)})`,
  );

  audio.setMuted(false);
  harness.advance(RAMP_SETTLE_MS);
  const unmuted = audibleRoutesOfNewVoice(harness, audio);
  check(
    unmuted !== null && unmuted.length === 1 && unmuted.every(isDownmixedToBothSpeakers),
    `unmuted: mono is still on and the route is back (${routeCount(unmuted)})`,
  );

  audio.setMonoAudio(false);
  harness.advance(RAMP_SETTLE_MS);
  const back = audibleRoutesOfNewVoice(harness, audio);
  check(
    back !== null && back.length === 1 && back[0]?.merger === null,
    `stereo again: the straight route is back (${routeCount(back)})`,
  );

  audio.setPlaysInBackground(true);
  window.blur();
  harness.advance(RAMP_SETTLE_MS);
  const kept = audibleRoutesOfNewVoice(harness, audio);
  check(
    harness.contextRunning() && kept !== null && kept.length === 1,
    `with background audio on, a blurred window keeps playing (${routeCount(kept)})`,
  );
  window.focus();

  audio.setPlaysInBackground(false);
  window.blur();
  harness.advance(RAMP_SETTLE_MS);
  const before = harness.sources.length;
  audio.play(PLAIN_ID);
  check(
    harness.sources.length === before,
    'with background audio off, a blurred window falls silent as before',
  );
  window.focus();
  harness.advance(RAMP_SETTLE_MS);
  await harness.flush();

  audio.dispose();
}
