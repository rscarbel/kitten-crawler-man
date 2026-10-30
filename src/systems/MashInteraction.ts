/**
 * Things a crawler works at by standing beside them and pressing interact: a
 * small family that shares its reach, its prompt, its world-painted progress
 * bar and its persistence. A crawler who walks off leaves the work exactly as
 * far along as it was, and coming back picks it up there.
 *
 * - {@link MashInteraction} — **press**: each press is one heave (a valve
 *   wheel hauled a quarter turn, a crank, a stuck lever); the last finishes it.
 * - {@link TimingInteraction} — **timing**: a press only counts while its
 *   watcher is looking away (a latch worked behind a guard's back); a press
 *   under the watcher's eye is seen, and the owner decides what that costs.
 * - {@link ChannelInteraction} — **channel**: one press starts a steady
 *   working that runs on frames while the crawler stands at it; walking off
 *   pauses it, and a hit interrupts it and knocks some of it back.
 *
 * What the thing is — its prompt wording, how much work, the rows the human
 * plays, the bar's look, how tall its art stands — is a def its owner
 * supplies. What each step sounds like and what finishing changes stay with
 * the owner, told through the `onPress` callback.
 */

import { TILE_SIZE } from '../core/constants';
import type { CatPlayer } from '../creatures/CatPlayer';
import { HumanPlayer } from '../creatures/HumanPlayer';
import type { ViewRows } from '../sprites/art/humanFigure';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import type { WorldBarStyleId } from '../ui/theme/worldInk';
import { worldBar } from '../ui/world/worldShapes';
import type { TileRect } from './bossRooms/bossRoomLayout';
import { JOB_MOTION_TOLERANCE_PX, type WorkChannelBuilder } from './WorkChannel';

/** What every member of the family is told about the thing it works: its look and its reach. */
export interface TimedInteractionLook {
  /**
   * What the work does, lower case, finishing the prompt's sentence after
   * its key: the keyboard pill reads "SPACE to turn off" and the touch pill
   * "TAP to turn off" from the deed "turn off".
   */
  readonly deed: string;
  /** The rows the human crawler plays: once per press, or looped through a channel. */
  readonly humanRows: ViewRows;
  readonly barStyle: WorldBarStyleId;
  /** How far, in tiles from the crawler's centre to the nearest footprint tile's centre, a press reaches. */
  readonly reachTiles: number;
  /** How far the object's art stands above its footprint's top edge, in pixels; the prompt and the bar clear it. */
  readonly artRisePx: number;
}

/** What one kind of mash object is: the data a pump, a crank or a valve differs by. */
export interface MashInteractionDef extends TimedInteractionLook {
  readonly pressesRequired: number;
}

/** A latch or a lock worked only while someone looks away. */
export interface TimingInteractionDef extends TimedInteractionLook {
  readonly pressesRequired: number;
  /** The bar's look while the watcher is looking, so the moment to hold off reads. */
  readonly watchedBarStyle: WorldBarStyleId;
}

/** A thing held at for a stretch: an unbinding, a long pull. */
export interface ChannelInteractionDef extends TimedInteractionLook {
  readonly framesRequired: number;
  /** The share of the whole work (0 to 1) a hit taken while channelling knocks back. */
  readonly damageSetbackShare: number;
}

/** What one press did. */
export type MashPress =
  { readonly kind: 'advanced'; readonly pressesDone: number } | { readonly kind: 'finished' };

/** What one timing press did. */
export type TimingPress =
  | { readonly kind: 'advanced'; readonly pressesDone: number }
  | { readonly kind: 'finished' }
  /** Pressed under the watcher's eye: nothing moved, and the watcher saw it. */
  | { readonly kind: 'seen' };

/** What a channel did on the frame it changed. */
export type ChannelStep =
  | { readonly kind: 'started' }
  /** The crawler walked off, or was switched away or went down; the work waits where it is. */
  | { readonly kind: 'paused' }
  /** A hit broke the channel and knocked part of it back. */
  | { readonly kind: 'interrupted' }
  | { readonly kind: 'finished' };

/** Whoever a timing press must not be seen by. */
export interface MashWatcher {
  /** Whether the watcher is looking at the work this frame. */
  readonly isLooking: () => boolean;
}

interface TimedInteractionOptions<D extends TimedInteractionLook, E> {
  readonly def: D;
  /** The tiles the object stands on. */
  readonly footprint: Readonly<TileRect>;
  /** Called on every step the work takes: play its cue, and on `finished` change the world. */
  readonly onPress: (event: E) => void;
}

export interface MashInteractionOptions extends TimedInteractionOptions<
  MashInteractionDef,
  MashPress
> {
  /** How many presses it already holds, for an object restored half-worked. */
  readonly pressesDone?: number;
}

export interface TimingInteractionOptions extends TimedInteractionOptions<
  TimingInteractionDef,
  TimingPress
> {
  readonly watcher: MashWatcher;
  readonly pressesDone?: number;
}

export interface ChannelInteractionOptions extends TimedInteractionOptions<
  ChannelInteractionDef,
  ChannelStep
> {
  /** How many frames of work it already holds, for an object restored half-worked. */
  readonly framesDone?: number;
}

const PROGRESS_BAR_WIDTH = 36;
const PROGRESS_BAR_HEIGHT = 5;
/** The gap between the top of the object's art and the bottom of its bar. */
const PROGRESS_BAR_LIFT_PX = 10;
const TILE_CENTRE = 0.5;
const HALF = 0.5;
const FACE_UP = { x: 0, y: -1 } as const;

/** A position measured in tiles, fractions included. */
interface TilePosition {
  readonly x: number;
  readonly y: number;
}

function centreInTiles(crawler: WorkChannelBuilder): TilePosition {
  return { x: crawler.x / TILE_SIZE + TILE_CENTRE, y: crawler.y / TILE_SIZE + TILE_CENTRE };
}

/**
 * Who is working: the crawler the player steers, or one the player is not
 * steering, sent to the work by a fight's order.
 */
type Worker = 'steered' | 'directed';

function canWork(crawler: WorkChannelBuilder, worker: Worker = 'steered'): boolean {
  const steeredEnough = worker === 'directed' || crawler.isActive;
  return steeredEnough && !crawler.isKnockedOut && crawler.isAlive && crawler.canAct;
}

/** The parts every member shares: the reach, the prompt, the bar and the turn toward the work. */
abstract class TimedInteraction<D extends TimedInteractionLook> {
  readonly def: D;
  protected readonly footprint: Readonly<TileRect>;

  constructor(def: D, footprint: Readonly<TileRect>) {
    this.def = def;
    this.footprint = footprint;
  }

  /** How far through the work is, 0 to 1. */
  abstract get progress(): number;

  get isFinished(): boolean {
    return this.progress >= 1;
  }

  /** The bar's look this frame. */
  protected barStyle(): WorldBarStyleId {
    return this.def.barStyle;
  }

  /** Whether the work takes a press right now, whoever presses. */
  protected acceptsPress(): boolean {
    return !this.isFinished;
  }

  /** Whether `crawler` stands near enough to work the object, whoever steers it. */
  inReach(crawler: WorkChannelBuilder): boolean {
    return this.tilesFrom(crawler) <= this.def.reachTiles;
  }

  /** Whether an interact press from `crawler` would go to this object. */
  wouldInteract(crawler: WorkChannelBuilder): boolean {
    if (!this.acceptsPress() || !canWork(crawler)) return false;
    return this.tilesFrom(crawler) <= this.def.reachTiles;
  }

  /**
   * The prompt over the object, in the scene's prompt order. Returns whether
   * it claimed the prompt slot, which it does exactly when
   * {@link wouldInteract} would take the press.
   */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    crawler: WorkChannelBuilder,
  ): boolean {
    if (!this.wouldInteract(crawler)) return false;
    const { x, y, w, h } = this.footprint;
    const left = x * TILE_SIZE - camX;
    const top = y * TILE_SIZE - camY;
    const artTop = top - this.def.artRisePx;
    const footprintBottom = top + h * TILE_SIZE;
    drawInteractionPrompt(ctx, left, artTop, w * TILE_SIZE, footprintBottom, `to ${this.def.deed}`);
    return true;
  }

  /** The progress bar over the object, from the first work until the last. */
  renderProgress(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.progress <= 0 || this.isFinished) return;
    const { x, y, w } = this.footprint;
    const centreX = (x + w * HALF) * TILE_SIZE - camX;
    const artTop = y * TILE_SIZE - camY - this.def.artRisePx;
    worldBar(
      ctx,
      {
        x: centreX - PROGRESS_BAR_WIDTH * HALF,
        y: artTop - PROGRESS_BAR_LIFT_PX - PROGRESS_BAR_HEIGHT,
        w: PROGRESS_BAR_WIDTH,
        h: PROGRESS_BAR_HEIGHT,
      },
      { style: this.barStyle(), value: this.progress },
    );
  }

  /** Turns the crawler to the object and returns the way it faces. */
  protected faceWork(crawler: WorkChannelBuilder): TilePosition {
    const face = this.facingFrom(crawler);
    crawler.facingX = face.x;
    crawler.facingY = face.y;
    return face;
  }

  /** Plays the human's row once, or the cat's `catMove` once. */
  protected playOnce(crawler: WorkChannelBuilder, catMove: (cat: CatPlayer) => void): void {
    const face = this.faceWork(crawler);
    if (crawler instanceof HumanPlayer) {
      crawler.playAction(crawler.rowFacing(this.def.humanRows, face.x, face.y), {
        faceX: face.x,
        faceY: face.y,
      });
      return;
    }
    catMove(crawler);
  }

  /**
   * The point nearest the crawler's centre within the box spanned by the
   * footprint's tile centres, in tiles: the reach is measured to a tile's
   * centre, as a crawler standing on a tile is measured from its own.
   */
  private nearestPoint(centre: TilePosition): TilePosition {
    const { x, y, w, h } = this.footprint;
    return {
      x: Math.min(Math.max(centre.x, x + TILE_CENTRE), x + w - TILE_CENTRE),
      y: Math.min(Math.max(centre.y, y + TILE_CENTRE), y + h - TILE_CENTRE),
    };
  }

  protected tilesFrom(crawler: WorkChannelBuilder): number {
    const centre = centreInTiles(crawler);
    const near = this.nearestPoint(centre);
    return Math.hypot(near.x - centre.x, near.y - centre.y);
  }

  /** The unit vector from the crawler toward the object; straight up when it stands inside the footprint. */
  private facingFrom(crawler: WorkChannelBuilder): TilePosition {
    const centre = centreInTiles(crawler);
    const near = this.nearestPoint(centre);
    const dx = near.x - centre.x;
    const dy = near.y - centre.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return FACE_UP;
    return { x: dx / length, y: dy / length };
  }
}

/** The **press** mode: every press is one heave, and the last finishes it. */
export class MashInteraction extends TimedInteraction<MashInteractionDef> {
  private readonly onPress: (press: MashPress) => void;
  private done: number;

  constructor(options: MashInteractionOptions) {
    super(options.def, options.footprint);
    this.onPress = options.onPress;
    this.done = Math.min(options.pressesDone ?? 0, options.def.pressesRequired);
  }

  get pressesDone(): number {
    return this.done;
  }

  get progress(): number {
    return this.done / this.def.pressesRequired;
  }

  /** Interact: one press, when it reaches. Returns whether the press was taken. */
  tryInteract(crawler: WorkChannelBuilder): boolean {
    if (!this.wouldInteract(crawler)) return false;
    this.playOnce(crawler, (cat) => cat.playWorkSwing());
    this.done++;
    this.onPress(
      this.isFinished ? { kind: 'finished' } : { kind: 'advanced', pressesDone: this.done },
    );
    return true;
  }
}

/** The **timing** mode: a press counts only while the watcher looks away. */
export class TimingInteraction extends TimedInteraction<TimingInteractionDef> {
  private readonly onPress: (press: TimingPress) => void;
  private readonly watcher: MashWatcher;
  private done: number;

  constructor(options: TimingInteractionOptions) {
    super(options.def, options.footprint);
    this.onPress = options.onPress;
    this.watcher = options.watcher;
    this.done = Math.min(options.pressesDone ?? 0, options.def.pressesRequired);
  }

  get pressesDone(): number {
    return this.done;
  }

  get progress(): number {
    return this.done / this.def.pressesRequired;
  }

  protected override barStyle(): WorldBarStyleId {
    return this.watcher.isLooking() ? this.def.watchedBarStyle : this.def.barStyle;
  }

  /** Interact: one try at the work. Returns whether the press was taken, seen or not. */
  tryInteract(crawler: WorkChannelBuilder): boolean {
    if (!this.wouldInteract(crawler)) return false;
    this.playOnce(crawler, (cat) => cat.playVerb('latch_paw'));
    if (this.watcher.isLooking()) {
      this.onPress({ kind: 'seen' });
      return true;
    }
    this.done++;
    this.onPress(
      this.isFinished ? { kind: 'finished' } : { kind: 'advanced', pressesDone: this.done },
    );
    return true;
  }

  /** Warms the cat's latch row while she stands in reach, so her first try plays at once. */
  cue(crawler: WorkChannelBuilder): void {
    if (crawler instanceof HumanPlayer || !this.wouldInteract(crawler)) return;
    crawler.cueVerb('latch_paw');
  }
}

/** The crawler a channel is running for, and what it measures the run against. */
interface RunningChannel {
  readonly crawler: WorkChannelBuilder;
  readonly worker: Worker;
  readonly hpAtStart: number;
  refX: number;
  refY: number;
  /** Whether the human's looped row is this channel's, so ending it only stops its own. */
  posing: boolean;
}

/** The **channel** mode: one press starts it, and it runs on frames while the crawler stays. */
export class ChannelInteraction extends TimedInteraction<ChannelInteractionDef> {
  private readonly onPress: (step: ChannelStep) => void;
  private framesWorked: number;
  private running: RunningChannel | null = null;

  constructor(options: ChannelInteractionOptions) {
    super(options.def, options.footprint);
    this.onPress = options.onPress;
    this.framesWorked = Math.min(options.framesDone ?? 0, options.def.framesRequired);
  }

  get framesDone(): number {
    return this.framesWorked;
  }

  get progress(): number {
    return this.framesWorked / this.def.framesRequired;
  }

  get isChannelling(): boolean {
    return this.running !== null;
  }

  protected override acceptsPress(): boolean {
    return !this.isFinished && this.running === null;
  }

  /** Interact: starts the channel, when it reaches. Returns whether the press was taken. */
  tryInteract(crawler: WorkChannelBuilder): boolean {
    if (!this.wouldInteract(crawler)) return false;
    this.begin(crawler, 'steered');
    return true;
  }

  /**
   * Starts the channel for a crawler the player is not steering, sent to the
   * work by a fight's order. The run ends on everything a steered one does
   * (walking off, a swing, going down, a hit) except not being steered.
   * Returns whether it started.
   */
  beginDirected(crawler: WorkChannelBuilder): boolean {
    if (!this.acceptsPress() || !canWork(crawler, 'directed') || !this.inReach(crawler)) {
      return false;
    }
    this.begin(crawler, 'directed');
    return true;
  }

  /** The crawler working the channel right now, or null. */
  get worker(): WorkChannelBuilder | null {
    return this.running?.crawler ?? null;
  }

  private begin(crawler: WorkChannelBuilder, worker: Worker): void {
    this.faceWork(crawler);
    this.running = {
      crawler,
      worker,
      hpAtStart: crawler.hp,
      refX: crawler.x,
      refY: crawler.y,
      posing: false,
    };
    if (!(crawler instanceof HumanPlayer)) crawler.cueVerb('channel');
    this.keepPosing(this.running);
    this.onPress({ kind: 'started' });
  }

  /** One update frame. While `worldHalted` the work waits, but walking off or going down still pauses it. */
  tick(worldHalted: boolean): void {
    const run = this.running;
    if (run === null) return;
    if (run.crawler.hp < run.hpAtStart) {
      const setback = Math.round(this.def.framesRequired * this.def.damageSetbackShare);
      this.framesWorked = Math.max(0, this.framesWorked - setback);
      this.end(run);
      this.onPress({ kind: 'interrupted' });
      return;
    }
    if (this.walkedOff(run)) {
      this.end(run);
      this.onPress({ kind: 'paused' });
      return;
    }
    if (worldHalted) return;
    this.keepPosing(run);
    this.framesWorked++;
    if (this.framesWorked < this.def.framesRequired) return;
    this.end(run);
    this.onPress({ kind: 'finished' });
  }

  /** Ends a running channel where it stands, keeping its work. Safe to call when none runs. */
  pause(): void {
    const run = this.running;
    if (run === null) return;
    this.end(run);
    this.onPress({ kind: 'paused' });
  }

  private walkedOff(run: RunningChannel): boolean {
    const crawler = run.crawler;
    if (!canWork(crawler, run.worker) || crawler.isSwinging) return true;
    const moved = Math.hypot(crawler.x - run.refX, crawler.y - run.refY);
    if (moved <= JOB_MOTION_TOLERANCE_PX) return false;
    if (crawler.isMoving) return true;
    run.refX = crawler.x;
    run.refY = crawler.y;
    return false;
  }

  /**
   * The human's row loops until the channel ends, asked for again when the
   * animator refused it or another system stopped it; the cat replays one
   * cycle of her strain whenever the last has run out.
   */
  private keepPosing(run: RunningChannel): void {
    const crawler = run.crawler;
    if (crawler instanceof HumanPlayer) {
      if (run.posing) return;
      run.posing = crawler.playAction(
        crawler.rowFacing(this.def.humanRows, crawler.facingX, crawler.facingY),
        {
          faceX: crawler.facingX,
          faceY: crawler.facingY,
          loop: true,
          onEnd: () => {
            run.posing = false;
          },
        },
      );
      return;
    }
    if (!crawler.isPlayingVerb('channel')) crawler.playVerb('channel');
  }

  private end(run: RunningChannel): void {
    this.running = null;
    if (run.posing && run.crawler instanceof HumanPlayer) run.crawler.stopAction();
    run.posing = false;
  }
}
