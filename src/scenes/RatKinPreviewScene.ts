/**
 * Localhost-only harness for eyeballing the ratkin art in motion: Mordecai,
 * and every Briar Hollow villager through the character picker along the top.
 *
 * A contact sheet cannot show gait speed, whether he floats or plants, or
 * whether the loop seam pops — so this walks him back and forth across the
 * screen at several zooms, driving the cycle from the ground he covers exactly
 * the way `SafeRoomSystem` does. Click the art to pause; paused, the wheel
 * steps frame by frame.
 *
 * Reached via `?ratkin` in `devBootScene` (see `game.ts`); never on a production
 * path.
 */

import { TILE_SIZE } from '../core/constants';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import type { WorldGesture } from '../ui/core/UiRoot';
import { worldText } from '../ui/world/worldText';
import { PreviewScene, type PreviewControl } from './PreviewScene';
import { RAT_KIN_TILES_PER_WALK_CYCLE, drawRatKinSprite } from '../sprites/ratKinSprite';
import { MORDECAI_MAX_PAUSE_FRAMES, MordecaiWanderer } from '../systems/mordecaiWander';
import { RATKIN_CAST_IDS, type RatkinCastId } from '../sprites/art/ratkin/cast';
import {
  type RatkinCastAction,
  drawRatkinCastSprite,
  ratkinCastActions,
  ratkinCastTilesPerWalkCycle,
} from '../sprites/ratkinCastSprite';
import { previewInk } from '../ui/theme/previewInk';

/** Who the picker can show: Mordecai first, then the cast in table order. */
type PreviewSubject = 'mordecai' | RatkinCastId;
const SUBJECTS: readonly PreviewSubject[] = ['mordecai', ...RATKIN_CAST_IDS];
/** Actions the picker cycles through; locomotion follows the wanderer. */
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

/** The tile sizes he is shown at, in-game size first — that is the one that counts. */
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
/** How much of a lane's height sits below his feet, so his soles read on the line. */
const LANE_GROUND_FRAC = 0.86;

/**
 * A synthetic safe room for the live wanderer to amble in.
 *
 * The harness drives a real `MordecaiWanderer` rather than reproducing its
 * pacing, because the whole reason this scene exists is that a contact sheet
 * cannot show gait speed — and a harness that shows a *different* gait speed
 * from the game is worse than none.
 */
const PREVIEW_ROOM = { x: 0, y: 0, w: 9, h: 9 };
const PREVIEW_HOME = { x: 4, y: 4 };
/**
 * Frames one wheel notch will skip through a pause before giving up. Derived
 * from the longest pause the wanderer can pick, so one notch always clears one
 * bout of standing about however that is retuned.
 */
const MAX_STEP_SKIP = MORDECAI_MAX_PAUSE_FRAMES + 1;

export class RatKinPreviewScene extends PreviewScene {
  private frame = 0;
  private paused = false;
  private subjectIndex = 0;
  private actionIndex = 0;
  private readonly wanderer = new MordecaiWanderer(
    PREVIEW_ROOM,
    PREVIEW_HOME,
    RAT_KIN_TILES_PER_WALK_CYCLE * TILE_SIZE,
    () => true,
  );

  private get subject(): PreviewSubject {
    return SUBJECTS[this.subjectIndex];
  }

  private actionsFor(subject: PreviewSubject): readonly PreviewAction[] {
    if (subject === 'mordecai') return [WANDER_ACTION];
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
    this.subjectIndex = (this.subjectIndex + delta + SUBJECTS.length) % SUBJECTS.length;
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
    const wander = this.wanderer.state;
    const subject = this.subject;
    if (subject === 'mordecai') {
      drawRatKinSprite(ctx, x, y, tile, {
        walkPhase: wander.walkPhase,
        isWalking: wander.isWalking,
        facingX,
        facingY,
      });
      return;
    }
    const action = this.action;
    // The wanderer paces a Mordecai-sized stride; a smaller build takes more
    // cycles over the same ground.
    const strideRatio = RAT_KIN_TILES_PER_WALK_CYCLE / ratkinCastTilesPerWalkCycle(subject);
    const castAction: RatkinCastAction =
      action === WANDER_ACTION ? (wander.isWalking ? 'walk' : 'idle') : action;
    drawRatkinCastSprite(ctx, subject, x, y, tile, {
      action: castAction,
      walkPhase: wander.walkPhase * strideRatio,
      facingX,
      facingY,
      progress: (this.frame % ONE_SHOT_PREVIEW_FRAMES) / ONE_SHOT_PREVIEW_FRAMES,
    });
  }

  /**
   * Steps the wanderer forward — which, paused, is how a loop seam is found.
   * There is no step-backward: the wanderer has no history to rewind.
   *
   * One step skips straight over the standing-about, because he pauses for
   * seconds at a time and the thing worth stepping through is the walk.
   */
  private stepPastStanding(): void {
    for (let step = 0; step < MAX_STEP_SKIP; step++) {
      this.frame += 1;
      this.wanderer.update();
      if (this.wanderer.state.isWalking) return;
    }
  }

  update(): void {
    if (this.paused) return;
    this.frame += 1;
    this.wanderer.update();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    const wander = this.wanderer.state;

    const laneTop = this.headerBottom + LANE_TOP_GAP;
    ZOOMS.forEach((zoom, lane) => {
      const tile = TILE_SIZE * zoom;
      const laneY = laneTop + lane * LANE_HEIGHT;
      // The tile guide's own bottom edge. His soles sit a little above it, the
      // same fraction down the tile the bake anchors him at — so a figure whose
      // feet land *on* this line is anchored wrong.
      const tileBottom = laneY + LANE_HEIGHT * LANE_GROUND_FRAC;
      ctx.fillStyle = GROUND_COLOR;
      ctx.fillRect(MARGIN, tileBottom, width - MARGIN * 2, GROUND_THICKNESS);

      const slot = (width - MARGIN * 2) / FACINGS.length;
      FACINGS.forEach((facing, index) => {
        // One lane per facing, all driven by the one wanderer: the point is to
        // compare the four views at the same instant of the same gait. Both axes
        // of his travel are applied, or the vertical legs of the amble animate a
        // full walk cycle without translating — in the one harness whose job is
        // telling a plant from a skate.
        const driftX = (wander.x / TILE_SIZE - PREVIEW_HOME.x) * (facing.facingX < 0 ? -1 : 1);
        const driftY = wander.y / TILE_SIZE - PREVIEW_HOME.y;
        const x = MARGIN + index * slot + driftX * tile;
        // Only locomotion drifts across the lane; a villager working or
        // talking stands still where the lane starts.
        const moving = this.action === WANDER_ACTION;
        this.drawSubject(
          ctx,
          moving ? x : MARGIN + index * slot,
          tileBottom - tile + (moving ? driftY * tile : 0),
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
      `frame ${this.frame}  phase ${wander.walkPhase.toFixed(2)}rad  ` +
        (wander.isWalking ? 'walking' : 'idle') +
        `  live facing ${wander.facingX},${wander.facingY}`,
      { x: MARGIN, y: height - MARGIN, size: LABEL_SIZE, color: LABEL_COLOR },
    );
    this.renderChrome(ctx);
  }
}
