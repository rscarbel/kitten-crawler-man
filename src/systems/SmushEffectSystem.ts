import { drawSmushBlast, SMUSH_BLAST_FRAMES } from '../sprites/smushBlast';
import type { GameSystem } from './GameSystem';

/**
 * Owns the blasts Smush leaves behind: the burst of air under Carl's heel and
 * the compression wave that sweeps out to the edge of the damage radius.
 *
 * The blast is a separate system rather than frames of the human sheet because
 * its size is a gameplay value — the ability's radius grows with its level, and
 * the ring has to stop exactly where the damage did.
 */

/** Peak camera shake in px, at the moment of the stamp. */
const SHAKE_PEAK_PX = 7;
/** Frames the shake takes to die away. */
const SHAKE_FRAMES = 18;
/** A full-power stamp kicks the camera harder. */
const FULL_POWER_SHAKE = 1.5;
/** Centres `Math.random()` on zero so the shake swings both ways. */
const RANDOM_MIDPOINT = 0.5;
/** Blasts beyond this are dropped rather than drawn; nothing stacks that deep. */
const MAX_LIVE_BLASTS = 4;

interface LiveBlast {
  x: number;
  y: number;
  damageRadius: number;
  age: number;
  seed: number;
  fullPower: boolean;
}

export class SmushEffectSystem implements GameSystem {
  private blasts: LiveBlast[] = [];
  private shakeFrames = 0;
  private shakeStrength = 0;
  private shakeX = 0;
  private shakeY = 0;

  /** Set when a stamp lands; `DungeonScene` reads and clears it to play the boom. */
  blastSoundPending = false;

  /**
   * Called on the single frame the stamp connects.
   *
   * @param x            blast centre in world px
   * @param y            blast centre in world px
   * @param damageRadius outer damage radius in px — where the shockwave stops
   */
  spawn(x: number, y: number, damageRadius: number, fullPower: boolean): void {
    if (this.blasts.length >= MAX_LIVE_BLASTS) this.blasts.shift();
    this.blasts.push({
      x,
      y,
      damageRadius,
      age: 0,
      // Math.random is fine here: the seed only has to be stable for one blast,
      // and nothing about the effect is replayed or persisted.
      seed: Math.random(),
      fullPower,
    });
    this.shakeFrames = SHAKE_FRAMES;
    this.shakeStrength = SHAKE_PEAK_PX * (fullPower ? FULL_POWER_SHAKE : 1);
    this.blastSoundPending = true;
  }

  update(): void {
    for (const blast of this.blasts) blast.age++;
    this.blasts = this.blasts.filter((blast) => blast.age < SMUSH_BLAST_FRAMES);

    if (this.shakeFrames > 0) {
      this.shakeFrames--;
      const falloff = this.shakeFrames / SHAKE_FRAMES;
      const amplitude = this.shakeStrength * falloff * falloff;
      this.shakeX = (Math.random() - RANDOM_MIDPOINT) * 2 * amplitude;
      this.shakeY = (Math.random() - RANDOM_MIDPOINT) * 2 * amplitude;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  /** Camera displacement for this frame; the scene adds it after clamping. */
  get cameraOffset(): { x: number; y: number } {
    return { x: this.shakeX, y: this.shakeY };
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const blast of this.blasts) {
      drawSmushBlast(ctx, {
        cx: blast.x - camX,
        cy: blast.y - camY,
        damageRadius: blast.damageRadius,
        age: blast.age,
        seed: blast.seed,
        fullPower: blast.fullPower,
      });
    }
  }

  /** A checkpoint restore must not resume a blast from the run that died. */
  resetForCheckpoint(): void {
    this.blasts = [];
    this.shakeFrames = 0;
    this.shakeStrength = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.blastSoundPending = false;
  }
}
