/**
 * The scene that opens a sealed stairwell: the camera eases onto the seal,
 * the Golden Key flies to it from the Keys button, turns in the padlock, gold
 * light runs out along the seal, the padlock bursts, the chains fall, the
 * cover gets off the stairs in its material's way, and light rises from below.
 *
 * Each beat's length is fitted to the recording that plays on it, measured
 * from the delivered files rather than taken from what was asked for: the key
 * turn's one heavy clunk lands about a second in, the chains pile up about
 * 0.7 s after they start, and each cover's slam lands where its own file has
 * it. The script and the seal's animation both read the beats from here; the
 * script tells the stairwell when each beat begins, so the picture can never
 * drift from the sound.
 */

import { KEY_CUES, SEAL_COVER_SOUNDS } from '../audio/keySoundCues';
import type { SoundId } from '../audio/sounds';
import type { StairwellStyleId } from '../sprites/art/stairwellArt';
import type { CutscenePoint } from './cutscene/cutsceneCamera';
import type { CutsceneScript, CutsceneStep, CutsceneWorldAction } from './cutscene/cutsceneSteps';

export const UNSEAL_BEATS = [
  'approach',
  'keyFlight',
  'keyTurn',
  'runes',
  'burst',
  'cover',
  'light',
  'return',
] as const;

/** One beat of the unseal scene. */
export type UnsealBeat = (typeof UNSEAL_BEATS)[number];

/** World ticks per beat, except the cover's, which follows its own recording. */
const BEAT_FRAMES = {
  approach: 24,
  /** `stairwell_key_flight` swells and is spent by about 0.9 s. */
  keyFlight: 54,
  /** `stairwell_key_turn`'s deep clunk lands at about 1.0 s. */
  keyTurn: 60,
  runes: 30,
  burst: 42,
  light: 48,
  return: 24,
} as const satisfies Record<Exclude<UnsealBeat, 'cover'>, number>;

/**
 * World ticks from the cover starting to move to it landing open: where each
 * cover's recording puts its heavy hit (the oak slab dropping flat, the hatch
 * slamming, the grate's second leaf).
 */
const COVER_HIT_FRAMES = {
  cellars: 108,
  service_level: 90,
  street: 93,
} as const satisfies Record<StairwellStyleId, number>;

/** After the hit, the cover breaks up into a gust of gold motes. */
export const COVER_SETTLE_FRAMES = 18;

/** The padlock's burst comes first; the chains start slithering a beat after. */
const BURST_TO_CHAINS_FRAMES = 12;

/** How long `beat` lasts for a seal of `style`. */
export function unsealBeatFrames(beat: UnsealBeat, style: StairwellStyleId): number {
  return beat === 'cover' ? coverHitFrames(style) + COVER_SETTLE_FRAMES : BEAT_FRAMES[beat];
}

export function coverHitFrames(style: StairwellStyleId): number {
  return COVER_HIT_FRAMES[style];
}

export interface UnsealScriptOptions<Action extends CutsceneWorldAction> {
  /** The footprint's centre, in world pixels: where the camera eases and the sounds are placed. */
  readonly center: CutscenePoint;
  readonly style: StairwellStyleId;
  /** No camera ease and no shake; the cover crossfades open. */
  readonly reducedMotion: boolean;
  /** The scene's world action that tells the stairwell a beat has begun. */
  readonly beginBeat: (beat: UnsealBeat) => Action;
}

/** The unseal scene as a cutscene script, timed beat by beat. */
export function unsealScript<Action extends CutsceneWorldAction>(
  options: UnsealScriptOptions<Action>,
): CutsceneScript<Action> {
  const { center, style, reducedMotion, beginBeat } = options;
  const begin = (beat: UnsealBeat): CutsceneStep<Action> => ({
    kind: 'run',
    action: beginBeat(beat),
  });
  const wait = (frames: number): CutsceneStep<Action> => ({ kind: 'wait', frames });
  const sound = (takes: readonly SoundId[]): CutsceneStep<Action> => ({
    kind: 'sound',
    cue: { takes },
    at: center,
  });
  const shake = (profile: 'light' | 'heavy'): CutsceneStep<Action>[] =>
    reducedMotion ? [] : [{ kind: 'shake', profile }];

  return [
    begin('approach'),
    ...(reducedMotion
      ? []
      : [
          {
            kind: 'panCamera',
            to: center,
            frames: BEAT_FRAMES.approach,
          } satisfies CutsceneStep<Action>,
        ]),
    begin('keyFlight'),
    sound(KEY_CUES.sealKeyFlight),
    wait(BEAT_FRAMES.keyFlight),
    begin('keyTurn'),
    sound(KEY_CUES.sealKeyTurn),
    wait(BEAT_FRAMES.keyTurn),
    begin('runes'),
    sound(KEY_CUES.sealRunesIgnite),
    wait(BEAT_FRAMES.runes),
    begin('burst'),
    sound(KEY_CUES.sealPadlockBurst),
    ...shake('light'),
    wait(BURST_TO_CHAINS_FRAMES),
    sound(KEY_CUES.sealChainsFall),
    wait(BEAT_FRAMES.burst - BURST_TO_CHAINS_FRAMES),
    begin('cover'),
    sound([SEAL_COVER_SOUNDS[style]]),
    wait(coverHitFrames(style)),
    ...shake('heavy'),
    wait(COVER_SETTLE_FRAMES),
    begin('light'),
    sound(KEY_CUES.sealLightFromBelow),
    wait(BEAT_FRAMES.light),
    begin('return'),
    reducedMotion ? wait(BEAT_FRAMES.return) : { kind: 'returnCamera', frames: BEAT_FRAMES.return },
  ];
}
