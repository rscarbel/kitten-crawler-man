/**
 * The title music's energy at this instant, 0 to 1, read from the envelope
 * measured offline from the track (`titlePulse.generated.ts`) at the track's
 * playback time.
 *
 * The music director keeps where its track stands to itself, so the playback
 * time is taken from the audio clock since the director reported the title
 * track audible. A track resumed part-way (a player back on the title within
 * the director's resume window) runs out of step with the envelope by that
 * offset; the pulse is a slow, gentle swell, so it still reads as the music's.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { MusicBusId } from '../../audio/sounds';
import type { TitleClock } from './titleClock';
import {
  TITLE_PULSE_ENVELOPE,
  TITLE_PULSE_FRAME_MS,
  TITLE_PULSE_RADIX,
  TITLE_PULSE_TRACK_MS,
} from './titlePulse.generated';
import { IGNITION_DURATION_MS } from './titleTimeline';

const MS_PER_SECOND = 1000;
const LEVEL_STEPS = TITLE_PULSE_RADIX - 1;

function levelAt(frame: number): number {
  const digit = parseInt(TITLE_PULSE_ENVELOPE.charAt(frame), TITLE_PULSE_RADIX);
  return Number.isNaN(digit) ? 0 : digit / LEVEL_STEPS;
}

/** The envelope at `positionMs` into the track, between its frames, wrapping as the track loops. */
export function titlePulseAt(positionMs: number): number {
  const frameCount = TITLE_PULSE_ENVELOPE.length;
  if (frameCount === 0) return 0;
  const wrapped =
    ((positionMs % TITLE_PULSE_TRACK_MS) + TITLE_PULSE_TRACK_MS) % TITLE_PULSE_TRACK_MS;
  const along = wrapped / TITLE_PULSE_FRAME_MS;
  const frame = Math.floor(along);
  const here = levelAt(frame % frameCount);
  const next = levelAt((frame + 1) % frameCount);
  return here + (next - here) * (along - frame);
}

/**
 * Where the track would stand with no audio to ask: as if it had started with
 * the reveal, so a review render shows the pulse a player would see then.
 */
function silentPositionMs(clock: TitleClock): number {
  switch (clock.state) {
    case 'dormant':
      return 0;
    case 'ignition':
      return clock.stateElapsedMs;
    case 'alive':
      return IGNITION_DURATION_MS + clock.stateElapsedMs;
    case 'dive':
      return clock.elapsedMs;
  }
}

/** Follows the title track's playback for the scene, and reads its pulse. */
export class TitleMusicPulse {
  private audibleAtS: number | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly audio: AudioManager | null,
    track: MusicBusId,
  ) {
    if (audio === null) {
      this.unsubscribe = () => undefined;
      return;
    }
    if (audio.music.audibleTrack === track) this.audibleAtS = audio.clockSeconds;
    this.unsubscribe = audio.music.onTrackAudible((id) => {
      this.audibleAtS = id === track ? audio.clockSeconds : null;
    });
  }

  /** 0 before the music starts; the envelope at the track's playback time once it does. */
  sample(clock: TitleClock): number {
    if (clock.state === 'dormant') return 0;
    const audio = this.audio;
    if (audio === null) return titlePulseAt(silentPositionMs(clock));
    const audibleAtS = this.audibleAtS;
    if (audibleAtS === null) return 0;
    return titlePulseAt((audio.clockSeconds - audibleAtS) * MS_PER_SECOND);
  }

  dispose(): void {
    this.unsubscribe();
  }
}
