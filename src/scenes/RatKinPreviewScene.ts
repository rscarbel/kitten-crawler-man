/**
 * Localhost-only harness for eyeballing the ratkin art in motion: every Briar
 * Hollow villager, through the character picker along the top.
 *
 * A contact sheet cannot show gait speed, whether a figure floats or plants, or
 * whether the loop seam pops — so this paces the picked villager back and forth
 * across the screen at several zooms, driving the cycle from the ground covered
 * the way the village does. Click the art to pause; paused, the wheel steps
 * frame by frame.
 *
 * Reached via `?ratkin` in `devBootScene` (see `game.ts`); never on a production
 * path.
 */

import { TILE_SIZE } from '../core/constants';
import { viewportWidth, viewportHeight } from '../core/rendering/Viewport';
import type { WorldGesture } from '../ui/core/UiRoot';
import { worldText } from '../ui/world/worldText';
import { PreviewScene, type PreviewControl } from './PreviewScene';
import { RATKIN_CAST_IDS, type RatkinCastId } from '../sprites/art/ratkin/cast';
import {
  type RatkinCastAction,
  drawRatkinCastSprite,
  ratkinCastActions,
  ratkinCastTilesPerWalkCycle,
} from '../sprites/ratkinCastSprite';
import { previewInk } from '../ui/theme/previewInk';

/** Actions the picker cycles through; locomotion follows the pacer. */
const WANDER_ACTION = 'wander';
type PreviewAction = typeof WANDER_ACTION | Exclude<RatkinCastAction, 'walk' | 'idle'>;
/** Frames a one-shot action (strike, down…) takes to play through in the preview. */
const ONE_SHOT_PREVIEW_FRAMES = 48;

const BG_COLOR = previewInk.slate.backdrop;
const GROUND_COLOR = previewInk.slate.ground;
const LABEL_COLOR = previewInk.slate.label;
const GROUND_THICKNESS = 3;
const MARGIN = 32;
const LABEL_SIZE = 14;

/** The tile sizes the art is shown at, in-game size first — that is the one that counts. */
const IN_GAME_ZOOM = 1;
const REVIEW_ZOOM = 2;
const DETAIL_ZOOM = 3;
const ZOOMS: readonly number[] = [IN_GAME_ZOOM, REVIEW_ZOOM, DETAIL_ZOOM];

/** One lane per facing, so all four views can be judged in motion side by side. */
const FACINGS: ReadonlyArray<{ label: string; facingX: number; facingY: number }> = [
  { label: 'right', facingX: 1, facingY: 0 },
  { label: 'left', facingX: -1, facingY: 0 },
  { label: 'toward', facingX: 0, facingY: 1 },
  { label: 'away', facingX: 0, facingY: -1 },
];
/** Gap between the header and the first lane's facing captions. */
const LANE_TOP_GAP = 12;
const LANE_HEIGHT = 132;
/** Room kept at the right of a lane for its zoom label. */
const LABEL_GUTTER = 120;
/** How much of a lane's height sits below the feet, so the soles read on the line. */
const LANE_GROUND_FRAC = 0.86;

/** How far the pacer walks before turning back, in tiles. */
const PACE_SPAN_TILES = 3;
/** World pixels a frame the pacer strolls at. */
const PACE_SPEED_PX = 0.6;
/** Frames the pacer stands at each end of its walk, long enough to judge the idle. */
const PACE_PAUSE_FRAMES = 90;
const FULL_TURN = Math.PI * 2;

/**
 * Walks a fixed span to the right and back, pausing at each end. The walk
 * phase is not kept here: it is read off the ground covered, against the picked
 * villager's own stride, so switching builds never makes the feet skate.
 */
class PreviewPacer {
  private offsetPx = 0;
  private direction = 1;
  private pauseFrames = 0;
  private walkedPx = 0;

  get isWalking(): boolean {
    return this.pauseFrames === 0;
  }

  /** How far along the span the pacer stands, in tiles. */
  get offsetTiles(): number {
    return this.offsetPx / TILE_SIZE;
  }

  get facingX(): number {
    return this.direction;
  }

  walkPhase(pixelsPerCycle: number): number {
    return (this.walkedPx / pixelsPerCycle) * FULL_TURN;
  }

  update(): void {
    if (this.pauseFrames > 0) {
      this.pauseFrames -= 1;
      return;
    }
    const spanPx = PACE_SPAN_TILES * TILE_SIZE;
    const next = this.offsetPx + this.direction * PACE_SPEED_PX;
    const clamped = Math.min(spanPx, Math.max(0, next));
    this.walkedPx += Math.abs(clamped - this.offsetPx);
    this.offsetPx = clamped;
    if (clamped === next) return;
    this.direction = -this.direction;
    this.pauseFrames = PACE_PAUSE_FRAMES;
  }
}

/**
 * Frames one wheel notch will skip through a pause before giving up, so one
 * notch always clears one bout of standing about.
 */
const MAX_STEP_SKIP = PACE_PAUSE_FRAMES + 1;

export class RatKinPreviewScene extends PreviewScene {
  private frame = 0;
  private paused = false;
  private subjectIndex = 0;
  private actionIndex = 0;
  private readonly pacer = new PreviewPacer();

  private get subject(): RatkinCastId {
    return RATKIN_CAST_IDS[this.subjectIndex];
  }

  private actionsFor(subject: RatkinCastId): readonly PreviewAction[] {
    const extra = ratkinCastActions(subject).filter(
      (action): action is Exclude<RatkinCastAction, 'walk' | 'idle'> =>
        action !== 'walk' && action !== 'idle',
    );
    return [WANDER_ACTION, ...extra];
  }

  private get action(): PreviewAction {
    const actions = this.actionsFor(this.subject);
    return actions[this.actionIndex % actions.length];
  }

  private stepSubject(delta: number): void {
    const count = RATKIN_CAST_IDS.length;
    this.subjectIndex = (this.subjectIndex + delta + count) % count;
    this.actionIndex = 0;
  }

  protected previewTitle(): string {
    return 'ratkin preview — ?ratkin';
  }

  protected previewCaptions(): readonly string[] {
    return [`frame ${this.frame}${this.paused ? ' (paused)' : ''}`];
  }

  protected previewControls(): readonly PreviewControl[] {
    return [
      { label: '<', onTap: () => this.stepSubject(-1) },
      { id: 'subject', label: this.subject, onTap: () => this.stepSubject(1) },
      { label: '>', onTap: () => this.stepSubject(1) },
      {
        id: 'action',
        label: this.action,
        onTap: () => {
          this.actionIndex = (this.actionIndex + 1) % this.actionsFor(this.subject).length;
        },
      },
      {
        id: 'play',
        label: this.paused ? 'play' : 'pause',
        onTap: () => {
          this.paused = !this.paused;
        },
      },
      {
        label: 'step',
        onTap: () => {
          this.paused = true;
          this.stepPastStanding();
        },
      },
    ];
  }

  /** A tap on the art pauses and resumes; paused, the wheel steps. */
  protected handlePreviewWorldPointer(gesture: WorldGesture): void {
    if (gesture.kind === 'up' && gesture.tap) {
      this.paused = !this.paused;
      return;
    }
    if (gesture.kind !== 'wheel') return;
    if (!this.paused || gesture.deltaY <= 0) return;
    this.stepPastStanding();
  }

  /** Draws the picked subject at one lane position, facing one way. */
  private drawSubject(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    tile: number,
    facingX: number,
    facingY: number,
  ): void {
    const subject = this.subject;
    const action = this.action;
    const castAction: RatkinCastAction =
      action === WANDER_ACTION ? (this.pacer.isWalking ? 'walk' : 'idle') : action;
    drawRatkinCastSprite(ctx, subject, x, y, tile, {
      action: castAction,
      walkPhase: this.pacer.walkPhase(ratkinCastTilesPerWalkCycle(subject) * TILE_SIZE),
      facingX,
      facingY,
      progress: (this.frame % ONE_SHOT_PREVIEW_FRAMES) / ONE_SHOT_PREVIEW_FRAMES,
    });
  }

  /**
   * Steps the pacer forward — which, paused, is how a loop seam is found.
   * There is no step-backward: the pacer has no history to rewind.
   *
   * One step skips straight over the standing-about, because the pacer pauses
   * for seconds at a time and the thing worth stepping through is the walk.
   */
  private stepPastStanding(): void {
    for (let step = 0; step < MAX_STEP_SKIP; step++) {
      this.frame += 1;
      this.pacer.update();
      if (this.pacer.isWalking) return;
    }
  }

  update(): void {
    if (this.paused) return;
    this.frame += 1;
    this.pacer.update();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    const laneTop = this.headerBottom + LANE_TOP_GAP;
    ZOOMS.forEach((zoom, lane) => {
      const tile = TILE_SIZE * zoom;
      const laneY = laneTop + lane * LANE_HEIGHT;
      // The tile guide's own bottom edge. The soles sit a little above it, the
      // same fraction down the tile the bake anchors a figure at — so a figure whose
      // feet land *on* this line is anchored wrong.
      const tileBottom = laneY + LANE_HEIGHT * LANE_GROUND_FRAC;
      ctx.fillStyle = GROUND_COLOR;
      ctx.fillRect(MARGIN, tileBottom, width - MARGIN * 2, GROUND_THICKNESS);

      const slot = (width - MARGIN * 2) / FACINGS.length;
      FACINGS.forEach((facing, index) => {
        // One lane per facing, all driven by the one pacer: the point is to
        // compare the four views at the same instant of the same gait. Every
        // lane translates with the walk, or a head-on lane would animate a full
        // walk cycle without moving — in the one harness whose job is telling a
        // plant from a skate.
        const driftX = this.pacer.offsetTiles * (facing.facingX < 0 ? -1 : 1);
        const x = MARGIN + index * slot + driftX * tile;
        // Only locomotion drifts across the lane; a villager working or
        // talking stands still where the lane starts.
        const moving = this.action === WANDER_ACTION;
        this.drawSubject(
          ctx,
          moving ? x : MARGIN + index * slot,
          tileBottom - tile,
          tile,
          facing.facingX,
          facing.facingY,
        );
        if (zoom === ZOOMS[0]) {
          worldText(ctx, facing.label, {
            x: MARGIN + index * slot,
            y: laneY,
            size: LABEL_SIZE,
            color: LABEL_COLOR,
          });
        }
      });

      worldText(ctx, `${tile}px tile${zoom === ZOOMS[0] ? ' — in-game size' : ''}`, {
        x: width - MARGIN - LABEL_GUTTER,
        y: laneY,
        size: LABEL_SIZE,
        color: LABEL_COLOR,
      });
    });

    worldText(
      ctx,
      `frame ${this.frame}  ` +
        (this.pacer.isWalking ? 'walking' : 'idle') +
        `  pacing ${this.pacer.facingX > 0 ? 'right' : 'left'}`,
      { x: MARGIN, y: height - MARGIN, size: LABEL_SIZE, color: LABEL_COLOR },
    );
    this.renderChrome(ctx);
  }
}
