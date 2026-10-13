/**
 * Rows a figure keeps warm for as long as it is drawn, whether or not they are
 * the ones on screen — a crawler's turning rows in every view.
 *
 * Held from the draw path, on the cache's own clock: a world halted under a
 * menu stops ticking but keeps drawing, so a hold run from a tick would let
 * the idle sweep take every view he is not facing; and a flushed cache is
 * noticed on the next draw rather than on some later refresh.
 */

import { type FigureDef } from './figureDef';
import {
  figureCacheFlushCount,
  figureCacheFrame,
  prewarmFigureState,
  touchFigureState,
} from './figureFrameCache';

/** A row held warm: the whole of it, or its first `frames` frames. */
export interface ResidentSpan {
  readonly row: string;
  readonly frames: number;
}

/**
 * Cache frames a row found cold waits before it is asked for again. A row
 * held to its first frames never reads as wholly warm, so without the wait it
 * would be queued afresh on every draw.
 */
const REASK_FRAMES = 30;

export class ResidentRows {
  private readonly askedAt = new Map<string, number>();
  private heldFor: FigureDef | null = null;
  private heldSinceFlush = figureCacheFlushCount();

  constructor(private readonly spans: readonly ResidentSpan[]) {}

  /**
   * Marks every held row of `def` as used this frame, and queues any that is
   * not warm. Call on every draw of the figure.
   */
  hold(def: FigureDef): void {
    const flushes = figureCacheFlushCount();
    if (this.heldFor !== def || this.heldSinceFlush !== flushes) {
      this.heldFor = def;
      this.heldSinceFlush = flushes;
      this.askedAt.clear();
    }
    const now = figureCacheFrame();
    for (const span of this.spans) {
      if (touchFigureState(def, span.row)) continue;
      const asked = this.askedAt.get(span.row);
      if (asked !== undefined && now - asked < REASK_FRAMES) continue;
      this.askedAt.set(span.row, now);
      prewarmFigureState(def, span.row, span.frames);
    }
  }
}
