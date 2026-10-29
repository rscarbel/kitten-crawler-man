/**
 * A thing a crawler works by pressing interact again and again: a valve
 * wheel hauled shut a quarter turn at a time, a crank, a stuck lever. Each
 * press is one heave — the human's row plays once, the cat swipes once — and
 * moves a progress bar on; the last press finishes it.
 *
 * Unlike a {@link WorkChannel}, which is held and runs on frames, nothing
 * here runs on its own: a crawler who walks off leaves the work exactly as
 * far along as it was, and coming back picks it up there.
 *
 * What the thing is — its prompt wording, how many presses, the rows the
 * human plays, the bar's look, how tall its art stands — is a
 * {@link MashInteractionDef} its owner supplies, so every such object shares
 * this class. What a press sounds like and what finishing changes stay with
 * the owner, told through {@link MashInteractionOptions.onPress}.
 */

import { TILE_SIZE } from '../core/constants';
import { HumanPlayer } from '../creatures/HumanPlayer';
import type { ViewRows } from '../sprites/art/humanFigure';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import type { WorldBarStyleId } from '../ui/theme/worldInk';
import { worldBar } from '../ui/world/worldShapes';
import type { TileRect } from './bossRooms/bossRoomLayout';
import type { WorkChannelBuilder } from './WorkChannel';

/** What one kind of mash object is: the data a pump, a crank or a valve differs by. */
export interface MashInteractionDef {
  readonly pressesRequired: number;
  /**
   * What the presses do, lower case, finishing the prompt's sentence after
   * its key: the keyboard pill reads "SPACE to turn off" and the touch pill
   * "TAP to turn off" from the deed "turn off".
   */
  readonly deed: string;
  /** The rows the human crawler plays once per press, one per view. */
  readonly humanRows: ViewRows;
  readonly barStyle: WorldBarStyleId;
  /** How far, in tiles from the crawler's centre to the nearest footprint tile's centre, a press reaches. */
  readonly reachTiles: number;
  /** How far the object's art stands above its footprint's top edge, in pixels; the prompt and the bar clear it. */
  readonly artRisePx: number;
}

/** What one press did. */
export type MashPress =
  { readonly kind: 'advanced'; readonly pressesDone: number } | { readonly kind: 'finished' };

export interface MashInteractionOptions {
  readonly def: MashInteractionDef;
  /** The tiles the object stands on. */
  readonly footprint: Readonly<TileRect>;
  /** Called on every press the object takes: play its cue, and on `finished` change the world. */
  readonly onPress: (press: MashPress) => void;
  /** How many presses it already holds, for an object restored half-worked. */
  readonly pressesDone?: number;
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

export class MashInteraction {
  readonly def: MashInteractionDef;
  private readonly footprint: Readonly<TileRect>;
  private readonly onPress: (press: MashPress) => void;
  private done: number;

  constructor(options: MashInteractionOptions) {
    this.def = options.def;
    this.footprint = options.footprint;
    this.onPress = options.onPress;
    this.done = Math.min(options.pressesDone ?? 0, options.def.pressesRequired);
  }

  get pressesDone(): number {
    return this.done;
  }

  /** How far through the work is, 0 to 1. */
  get progress(): number {
    return this.done / this.def.pressesRequired;
  }

  get isFinished(): boolean {
    return this.done >= this.def.pressesRequired;
  }

  /** Whether an interact press from `crawler` would go to this object. */
  wouldInteract(crawler: WorkChannelBuilder): boolean {
    if (this.isFinished) return false;
    if (!crawler.isActive || crawler.isKnockedOut || !crawler.isAlive || !crawler.canAct) {
      return false;
    }
    return this.tilesFrom(crawler) <= this.def.reachTiles;
  }

  /** Interact: one press, when it reaches. Returns whether the press was taken. */
  tryInteract(crawler: WorkChannelBuilder): boolean {
    if (!this.wouldInteract(crawler)) return false;
    this.heave(crawler);
    this.done++;
    this.onPress(
      this.isFinished ? { kind: 'finished' } : { kind: 'advanced', pressesDone: this.done },
    );
    return true;
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

  /** The progress bar over the object, from the first press until the last. */
  renderProgress(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.done === 0 || this.isFinished) return;
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
      { style: this.def.barStyle, value: this.progress },
    );
  }

  /** Turns the crawler to the object and plays one heave. */
  private heave(crawler: WorkChannelBuilder): void {
    const face = this.facingFrom(crawler);
    crawler.facingX = face.x;
    crawler.facingY = face.y;
    if (crawler instanceof HumanPlayer) {
      crawler.playAction(crawler.rowFacing(this.def.humanRows, face.x, face.y), {
        faceX: face.x,
        faceY: face.y,
      });
      return;
    }
    crawler.playWorkSwing();
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

  private tilesFrom(crawler: WorkChannelBuilder): number {
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
