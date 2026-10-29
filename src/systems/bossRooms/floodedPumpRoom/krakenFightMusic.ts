/**
 * The Kraken's fight music, following her flooded pump room from outside it.
 *
 * The growl that opens the intro starts the flooded loop. Each pump shut off
 * takes a layer out of it, crossfading to the next stem at the same point in
 * the loop. The last pump starts the drain, and the flooded loop gives way
 * to the battle loop. Her death fades the battle loop out, and the floor's
 * music comes back on its own. A death in the room rewinds the fight, and
 * its music starts again from the top.
 */

import type { MusicClaims } from '../../../audio/AudioScope';
import type { MusicClaimOwner } from '../../../audio/music/MusicDirector';
import { KRAKEN_BATTLE_TRACK } from '../../../audio/music/bossTracks';
import type { MusicStemOf } from '../../../audio/music/stemSets';
import type { FloodedPumpRoomState } from './floodedPumpRoomState';

/**
 * What the fight plays: nothing before the intro, the flooded loop with all
 * three pumps running, two or one, the battle loop from the drain on, and the
 * fade after her death.
 */
type KrakenMusicStage =
  'silent' | 'flooded' | 'flooded_2pumps' | 'flooded_1pump' | 'battle' | 'defeated';

type FloodedStage = Extract<KrakenMusicStage, `flooded${string}`>;

/** The flooded stage for each count of pumps shut off; the last shut-off starts the drain instead. */
const FLOODED_STAGE_BY_PUMPS_SHUT = [
  'flooded',
  'flooded_2pumps',
  'flooded_1pump',
] as const satisfies readonly FloodedStage[];

const FLOODED_STEMS = {
  flooded: 'the_kraken_flooded',
  flooded_2pumps: 'the_kraken_flooded_2pumps',
  flooded_1pump: 'the_kraken_flooded_1pump',
} as const satisfies Record<FloodedStage, MusicStemOf<'kraken_flooded'>>;

const MUSIC_OWNER = 'flooded_pump_room' as const satisfies MusicClaimOwner;

/** A layer leaving as a pump shuts off. */
const STEM_SWITCH_FADE_MS = 300;
/** The flooded loop coming in under the growl, short so it lands with the shake. */
const FLOODED_ENTRANCE_FADE_MS = 300;
/** The flooded loop giving way to the battle loop as the room drains. */
const BATTLE_CROSSFADE_MS = 500;
const DEFEAT_FADE_OUT_MS = 2000;
/** The fight's music leaving when a rewind puts the party back before the intro. */
const REWIND_FADE_OUT_MS = 500;

/** What the music reads off the room each frame. */
export interface KrakenFightReading {
  readonly fightState: FloodedPumpRoomState;
  readonly pumpsShutOff: number;
}

function isFloodedStage(stage: KrakenMusicStage): stage is FloodedStage {
  return FLOODED_STAGE_BY_PUMPS_SHUT.some((flooded) => flooded === stage);
}

function floodedStage(pumpsShutOff: number): FloodedStage {
  const lastIndex = FLOODED_STAGE_BY_PUMPS_SHUT.length - 1;
  const index = Math.min(Math.max(pumpsShutOff, 0), lastIndex);
  return FLOODED_STAGE_BY_PUMPS_SHUT[index];
}

/** The music `room` calls for. */
function krakenMusicStage(room: KrakenFightReading): KrakenMusicStage {
  const { fightState } = room;
  switch (fightState.kind) {
    case 'approach':
      return 'silent';
    case 'intro_cutscene':
    case 'flooded':
      return floodedStage(room.pumpsShutOff);
    case 'draining':
    case 'drained':
      return 'battle';
    case 'defeated':
      return 'defeated';
    default: {
      const unhandled: never = fightState;
      throw new Error(`unhandled room state ${JSON.stringify(unhandled)}`);
    }
  }
}

export class KrakenFightMusic {
  private stage: KrakenMusicStage = 'silent';

  constructor(private readonly music: MusicClaims) {}

  /** Claims what `room` calls for when it changes. */
  update(room: KrakenFightReading): void {
    const next = krakenMusicStage(room);
    if (next === this.stage) return;
    this.enter(next, this.stage);
  }

  /**
   * The fight was rewound to a checkpoint: whatever the room now calls for
   * starts from its top, the flooded loop on the stem for the pumps the
   * checkpoint kept shut, and a room back before its intro goes quiet until
   * the growl.
   */
  restart(room: KrakenFightReading): void {
    this.enter(krakenMusicStage(room), 'silent');
  }

  private enter(next: KrakenMusicStage, previous: KrakenMusicStage): void {
    this.stage = next;
    switch (next) {
      case 'silent':
        this.music.releaseMusic(MUSIC_OWNER, { fadeOutMs: REWIND_FADE_OUT_MS });
        return;
      case 'flooded':
      case 'flooded_2pumps':
      case 'flooded_1pump': {
        const switchingLayer = isFloodedStage(previous);
        this.music.claimMusic({
          owner: MUSIC_OWNER,
          layer: 'boss',
          selection: {
            kind: 'stems',
            set: 'kraken_flooded',
            stem: FLOODED_STEMS[next],
            fromTop: !switchingLayer,
          },
          fadeInMs: switchingLayer ? STEM_SWITCH_FADE_MS : FLOODED_ENTRANCE_FADE_MS,
        });
        return;
      }
      case 'battle':
        this.music.claimMusic({
          owner: MUSIC_OWNER,
          layer: 'boss',
          selection: { kind: 'loop', id: KRAKEN_BATTLE_TRACK, fromTop: true },
          fadeInMs: BATTLE_CROSSFADE_MS,
        });
        return;
      case 'defeated':
        this.music.releaseMusic(MUSIC_OWNER, { fadeOutMs: DEFEAT_FADE_OUT_MS });
        return;
      default: {
        const unhandled: never = next;
        throw new Error(`unhandled music stage ${String(unhandled)}`);
      }
    }
  }
}
