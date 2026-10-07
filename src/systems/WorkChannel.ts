/**
 * One crawler standing at a job and working it for a fixed number of update
 * frames: a construction contract's repair or rebuild.
 *
 * Owns the parts every such job shares — the builder's working picture,
 * cancelling when the builder walks off, swings, is switched away or goes
 * down, and the progress count — and calls back once when the work is done.
 * What the job costs and what finishing it changes stay with the owner.
 */

import { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { ViewRows } from '../sprites/art/humanFigure';
import { viewForFacing } from '../sprites/humanSprite';

export type WorkChannelBuilder = HumanPlayer | CatPlayer;

/**
 * How far the builder may drift before the channel counts as walked off: a
 * separation push or a shove moves a crawler by a hair without its say.
 */
export const JOB_MOTION_TOLERANCE_PX = 0.5;

/**
 * Donut has no working row: her swipe lands on this cadence while she works,
 * at a job here and at a harvest alike.
 */
export const CAT_WORK_SWING_TICKS = 30;

export interface WorkChannelOptions {
  readonly builder: WorkChannelBuilder;
  readonly totalFrames: number;
  /** The unit vector the builder faces while working. */
  readonly faceX: number;
  readonly faceY: number;
  /** The rows Carl loops while working, one per view. */
  readonly humanRows: ViewRows;
  /** Asked every tick; false ends the channel unfinished (the job went away under it). */
  readonly stillWanted: () => boolean;
}

/** How a tick left the channel. */
export type WorkChannelTick = 'working' | 'finished' | 'cancelled';

export class WorkChannel {
  readonly builder: WorkChannelBuilder;
  readonly totalFrames: number;
  private framesLeft: number;
  private refX: number;
  private refY: number;
  /** Whether Carl's working row is this channel's, so ending it only ever stops its own. */
  private posing = false;
  private catSwingTicks = 0;
  private ended = false;

  constructor(private readonly options: WorkChannelOptions) {
    this.builder = options.builder;
    this.totalFrames = Math.max(1, options.totalFrames);
    this.framesLeft = this.totalFrames;
    this.refX = options.builder.x;
    this.refY = options.builder.y;
    options.builder.facingX = options.faceX;
    options.builder.facingY = options.faceY;
    if (options.builder instanceof HumanPlayer) this.playRow(options.builder);
    else options.builder.playWorkSwing();
  }

  /** How far through the work is, 0 to 1. */
  get progress(): number {
    return 1 - this.framesLeft / this.totalFrames;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  /**
   * One update frame. While `worldHalted` the work waits, but walking off or
   * going down still ends it. Returns `finished` exactly once, on the frame
   * the last of the work is done; the channel has already ended by then.
   */
  tick(worldHalted: boolean): WorkChannelTick {
    if (this.ended) return 'cancelled';
    if (this.shouldCancel()) {
      this.end();
      return 'cancelled';
    }
    if (worldHalted) return 'working';
    this.keepWorking();
    this.framesLeft--;
    if (this.framesLeft > 0) return 'working';
    this.end();
    return 'finished';
  }

  /** Ends the channel unfinished. Safe to call more than once. */
  cancel(): void {
    this.end();
  }

  private shouldCancel(): boolean {
    if (!this.options.stillWanted()) return true;
    const builder = this.builder;
    if (!builder.isActive || builder.isKnockedOut || !builder.isAlive) return true;
    if (builder.isSwinging) return true;
    const moved = Math.hypot(builder.x - this.refX, builder.y - this.refY);
    if (moved > JOB_MOTION_TOLERANCE_PX) {
      if (builder.isMoving) return true;
      this.refX = builder.x;
      this.refY = builder.y;
    }
    return false;
  }

  private playRow(human: HumanPlayer): void {
    const { faceX, faceY, humanRows } = this.options;
    this.posing = human.playAction(humanRows[viewForFacing(faceX, faceY)], {
      faceX,
      faceY,
      loop: true,
      onEnd: () => {
        this.posing = false;
      },
    });
  }

  /**
   * Carl's row loops until the channel ends. A row the animator refuses (he
   * is mid-flinch) or another system stops is asked for again next tick, so
   * the picture catches back up with the work.
   */
  private keepWorking(): void {
    const builder = this.builder;
    if (builder instanceof HumanPlayer) {
      if (!this.posing) this.playRow(builder);
      return;
    }
    this.catSwingTicks++;
    if (this.catSwingTicks < CAT_WORK_SWING_TICKS) return;
    this.catSwingTicks = 0;
    builder.playWorkSwing();
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.posing && this.builder instanceof HumanPlayer) this.builder.stopAction();
    this.posing = false;
  }
}
