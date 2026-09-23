import {
  drawSmushBlastAir,
  drawSmushBlastGround,
  SMUSH_BLAST_FRAMES,
  type SmushBlastFrame,
} from '../sprites/smushBlast';
import type { GameSystem } from './GameSystem';

/**
 * Owns the blasts Smush leaves behind: the burst of air under Carl's heel and
 * the compression wave that sweeps out to the edge of the damage radius.
 *
 * The blast is a separate system rather than frames of the human sheet because
 * its size is a gameplay value — the ability's radius grows with its level, and
 * the ring has to stop exactly where the damage did.
 *
 * It renders in two passes off the one live blast: `renderGround` in the
 * floor layer under the Y-sorted figures, and `render` in the effects layer
 * over them. Both read the same blast at the same age, so the two halves of
 * the picture cannot drift apart.
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

/**
 * Which grind of the Smush is on screen this tick, counted from 1, or null on
 * every frame that is not one — read off the row Carl is actually drawn in.
 */
export type SmushGrindSource = () => number | null;

interface LiveBlast {
  x: number;
  y: number;
  damageRadius: number;
  age: number;
  seed: number;
  fullPower: boolean;
  grindSource: SmushGrindSource | null;
  /** The grind on screen, and the ticks since it came on screen. */
  grindBeat: number | null;
  grindAge: number;
  /** The most grinds this blast has seen: the cracks they left stay open. */
  grindsSeen: number;
}

/**
 * Follows the grind on screen. A beat restarts its pulse the tick it first
 * shows, so the pulse lands on the frame the heel grinds rather than on a
 * clock of its own; once the row moves on (or is cut short) there is no beat
 * and no pulse.
 */
function trackGrind(blast: LiveBlast): void {
  const beat = blast.grindSource?.() ?? null;
  if (beat !== null && beat !== blast.grindBeat) blast.grindAge = 0;
  else blast.grindAge++;
  blast.grindBeat = beat;
  if (beat !== null) blast.grindsSeen = Math.max(blast.grindsSeen, beat);
}

function blastFrame(blast: LiveBlast, camX: number, camY: number): SmushBlastFrame {
  return {
    cx: blast.x - camX,
    cy: blast.y - camY,
    damageRadius: blast.damageRadius,
    age: blast.age,
    seed: blast.seed,
    fullPower: blast.fullPower,
    grind: blast.grindBeat === null ? null : { beat: blast.grindBeat, age: blast.grindAge },
    cracks: blast.grindsSeen,
  };
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
   * @param grindSource  which grind of the stamp is drawn each tick, so the
   *                     heel's grind into the floor shows in the blast too
   */
  spawn(
    x: number,
    y: number,
    damageRadius: number,
    fullPower: boolean,
    grindSource: SmushGrindSource | null = null,
  ): void {
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
      grindSource,
      grindBeat: null,
      grindAge: 0,
      grindsSeen: 0,
    });
    this.shakeFrames = SHAKE_FRAMES;
    this.shakeStrength = SHAKE_PEAK_PX * (fullPower ? FULL_POWER_SHAKE : 1);
    this.blastSoundPending = true;
  }

  update(): void {
    for (const blast of this.blasts) {
      blast.age++;
      trackGrind(blast);
    }
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

  /** The floor under Carl's feet: rings, cracks, dust, and what is behind him. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const blast of this.blasts) drawSmushBlastGround(ctx, blastFrame(blast, camX, camY));
  }

  /** The air in front of Carl: the near half of the burst, flying chips, haze. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const blast of this.blasts) drawSmushBlastAir(ctx, blastFrame(blast, camX, camY));
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
