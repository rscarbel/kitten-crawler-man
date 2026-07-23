/**
 * AmbientSoundSystem — distance-attenuated ambient loops.
 *
 * Each emitter is a point in tile space that radiates one sound. Every frame the
 * system takes, per sound id, the loudest contribution across that sound's
 * emitters and ramps a single shared loop to it — so a room with four hearths
 * crackles at the volume of the nearest hearth rather than four times over.
 *
 * Emitters with `constant: true` ignore distance entirely; they are the "you are
 * inside this room" beds (tavern murmur, apothecary hum).
 *
 * Whether a loop is playing is read back from the AudioManager each frame rather
 * than remembered here: `startAmbientLoop` declines while the AudioContext is
 * still locked or the buffer is still decoding, and a backgrounded tab stops every
 * loop behind our back. A local "I started it" flag would go stale in all three
 * cases and the loop would never be heard again.
 */

import { TILE_SIZE } from '../core/constants';
import type { AudioManager } from '../audio/AudioManager';
import type { SoundId } from '../audio/sounds';
import type { GameSystem, SystemContext } from './GameSystem';

export interface AmbientEmitter {
  soundId: SoundId;
  /** Emitter position in tile coordinates. Ignored when `constant` is set. */
  x: number;
  y: number;
  /** Distance in tiles at which the emitter fades to silence. */
  radiusTiles: number;
  /** Gain at the emitter's own tile (0–1). */
  maxVolume: number;
  /** When true the emitter plays at `maxVolume` everywhere in the scene. */
  constant?: boolean;
}

/** Below this gain a loop is inaudible, so it is not worth starting a voice for. */
const AUDIBLE_GAIN_THRESHOLD = 0.01;
/**
 * Frames a loop must stay silent before it is torn down. Without this hysteresis,
 * pacing back and forth across an emitter's edge restarts the voice every frame.
 */
const SILENT_FRAMES_BEFORE_STOP = 120;

export class AmbientSoundSystem implements GameSystem {
  private readonly emitters: AmbientEmitter[] = [];
  /**
   * Every sound id this system has ever been responsible for. Kept even after an
   * emitter set is replaced, so a loop whose emitters are gone still gets faded
   * out instead of playing on forever at its last gain.
   */
  private readonly ownedSounds = new Set<SoundId>();
  /** Frames each sound has been below the audible threshold. */
  private readonly silentFrames = new Map<SoundId, number>();

  constructor(
    private readonly audio: AudioManager,
    emitters: ReadonlyArray<AmbientEmitter>,
  ) {
    this.setEmitters(emitters);
  }

  /** Replace the emitter set (e.g. when a scene swaps to another interior floor). */
  setEmitters(emitters: ReadonlyArray<AmbientEmitter>): void {
    this.emitters.length = 0;
    this.emitters.push(...emitters);
    for (const emitter of emitters) this.ownedSounds.add(emitter.soundId);
  }

  update(ctx: SystemContext): void {
    this.updateListener(ctx.active.x, ctx.active.y);
  }

  /**
   * Tick the loops for a listener at the given world position. Scenes that don't
   * assemble a full `SystemContext` every frame (building interiors only do so
   * during combat) call this directly.
   */
  updateListener(listenerWorldX: number, listenerWorldY: number): void {
    const listenerTileX = listenerWorldX / TILE_SIZE;
    const listenerTileY = listenerWorldY / TILE_SIZE;
    const targetGains = new Map<SoundId, number>();
    for (const emitter of this.emitters) {
      const gain = this.gainFor(emitter, listenerTileX, listenerTileY);
      const loudestSoFar = targetGains.get(emitter.soundId) ?? 0;
      if (gain > loudestSoFar) targetGains.set(emitter.soundId, gain);
    }

    for (const soundId of this.ownedSounds) {
      const gain = targetGains.get(soundId) ?? 0;
      const isRunning = this.audio.isAmbientLoopRunning(soundId);

      if (gain >= AUDIBLE_GAIN_THRESHOLD) {
        this.silentFrames.set(soundId, 0);
        if (isRunning) this.audio.setAmbientLoopVolume(soundId, gain);
        else this.audio.startAmbientLoop(soundId, gain);
        continue;
      }

      if (!isRunning) continue;
      this.audio.setAmbientLoopVolume(soundId, 0);
      const silent = (this.silentFrames.get(soundId) ?? 0) + 1;
      this.silentFrames.set(soundId, silent);
      if (silent >= SILENT_FRAMES_BEFORE_STOP) {
        this.audio.stopAmbientLoop(soundId);
        this.silentFrames.delete(soundId);
      }
    }
  }

  private gainFor(emitter: AmbientEmitter, listenerX: number, listenerY: number): number {
    if (emitter.constant === true) return emitter.maxVolume;
    if (emitter.radiusTiles <= 0) return 0;
    const distance = Math.hypot(emitter.x - listenerX, emitter.y - listenerY);
    const falloff = 1 - distance / emitter.radiusTiles;
    if (falloff <= 0) return 0;
    return emitter.maxVolume * falloff;
  }

  dispose(): void {
    for (const soundId of this.ownedSounds) this.audio.stopAmbientLoop(soundId);
    this.ownedSounds.clear();
    this.silentFrames.clear();
  }
}
