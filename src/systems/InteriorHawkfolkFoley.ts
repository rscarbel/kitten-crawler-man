/** Ambient sounds of Hawkfolk occupants: talon steps while walking, feather ruffles while idle. */

import type { AudioManager } from '../audio/AudioManager';
import type { SoundId } from '../audio/sounds';
import { TILE_SIZE } from '../core/constants';
import type { Townsperson } from '../creatures/Townsperson';

const HEARING_RADIUS_TILES = 9;
const HEARING_RADIUS_PX = HEARING_RADIUS_TILES * TILE_SIZE;
const FRAMES_PER_SECOND = 60;
const TALON_STEPS_CLIP_SECONDS = 2;
const RUFFLE_MIN_GAP_SECONDS = 8;
const RUFFLE_MAX_GAP_SECONDS = 20;

/** The clip is a continuous run of steps, so it is not retriggered until it ends. */
const TALON_STEPS_CLIP_FRAMES = TALON_STEPS_CLIP_SECONDS * FRAMES_PER_SECOND;
const TALON_STEPS_MAX_VOLUME = 0.5;

const RUFFLE_MIN_GAP_FRAMES = RUFFLE_MIN_GAP_SECONDS * FRAMES_PER_SECOND;
const RUFFLE_MAX_GAP_FRAMES = RUFFLE_MAX_GAP_SECONDS * FRAMES_PER_SECOND;
const RUFFLE_MAX_VOLUME = 0.6;
const WING_RUFFLE_SOUNDS: ReadonlyArray<SoundId> = [
  'hawkfolk_wing_ruffle_1',
  'hawkfolk_wing_ruffle_2',
];

function nextRuffleGapFrames(): number {
  return RUFFLE_MIN_GAP_FRAMES + Math.random() * (RUFFLE_MAX_GAP_FRAMES - RUFFLE_MIN_GAP_FRAMES);
}

function volumeAt(distancePx: number, maxVolume: number): number {
  return maxVolume * Math.max(0, 1 - distancePx / HEARING_RADIUS_PX);
}

function nearestHawkfolkDistancePx(
  people: ReadonlyArray<Townsperson>,
  listenerX: number,
  listenerY: number,
  qualifies: (person: Townsperson) => boolean,
): number | null {
  let nearest: number | null = null;
  for (const person of people) {
    if (person.species !== 'hawkfolk' || !qualifies(person)) continue;
    const distancePx = Math.hypot(person.x - listenerX, person.y - listenerY);
    if (distancePx >= HEARING_RADIUS_PX) continue;
    if (nearest === null || distancePx < nearest) nearest = distancePx;
  }
  return nearest;
}

export class InteriorHawkfolkFoley {
  private framesUntilTalonSteps = 0;
  private framesUntilRuffle = nextRuffleGapFrames();

  update(
    audio: AudioManager | null,
    people: ReadonlyArray<Townsperson>,
    listenerX: number,
    listenerY: number,
  ): void {
    if (this.framesUntilTalonSteps > 0) this.framesUntilTalonSteps--;
    if (this.framesUntilRuffle > 0) this.framesUntilRuffle--;
    if (audio === null) return;

    if (this.framesUntilTalonSteps === 0) {
      const walkerDistancePx = nearestHawkfolkDistancePx(
        people,
        listenerX,
        listenerY,
        (person) => person.moving,
      );
      if (walkerDistancePx !== null) {
        audio.play('hawkfolk_talon_steps', {
          volume: volumeAt(walkerDistancePx, TALON_STEPS_MAX_VOLUME),
        });
        this.framesUntilTalonSteps = TALON_STEPS_CLIP_FRAMES;
      }
    }

    if (this.framesUntilRuffle === 0) {
      const idlerDistancePx = nearestHawkfolkDistancePx(
        people,
        listenerX,
        listenerY,
        (person) => !person.moving && !person.frozen,
      );
      // The timer stays at zero so the next bird to stop in earshot ruffles at once.
      if (idlerDistancePx === null) return;
      audio.playRandom(WING_RUFFLE_SOUNDS, {
        volume: volumeAt(idlerDistancePx, RUFFLE_MAX_VOLUME),
      });
      this.framesUntilRuffle = nextRuffleGapFrames();
    }
  }
}
