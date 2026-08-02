/**
 * Localhost-only harness for eyeballing Mordecai's Rat Kin sheet in motion.
 *
 * A contact sheet cannot show gait speed, whether he floats or plants, or
 * whether the loop seam pops — so this walks him back and forth across the
 * screen at several zooms, driving the cycle from the ground he covers exactly
 * the way `SafeRoomSystem` does. Click to pause and step frame by frame.
 *
 * Reached via `?ratkin` in `devBootScene` (see `game.ts`); never on a production
 * path.
 */

import { Scene } from '../core/Scene';
import { TILE_SIZE } from '../core/constants';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { RAT_KIN_TILES_PER_WALK_CYCLE, drawRatKinSprite } from '../sprites/ratKinSprite';
import { MORDECAI_MAX_PAUSE_FRAMES, MordecaiWanderer } from '../systems/mordecaiWander';

const BG_COLOR = '#20242e';
const GROUND_COLOR = '#2c3342';
const LABEL_COLOR = '#c9d2e0';
const GROUND_THICKNESS = 3;
const MARGIN = 32;
const LABEL_SIZE = 14;
const TITLE_SIZE = 20;

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
const LANE_TOP = 66;
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
 * from the game is worse than none. Reproducing it by hand is exactly how the
 * first version ended up 13% fast against a comment claiming it matched.
 */
const PREVIEW_ROOM = { x: 0, y: 0, w: 9, h: 9 };
const PREVIEW_HOME = { x: 4, y: 4 };
/**
 * Frames one wheel notch will skip through a pause before giving up. Derived
 * from the longest pause the wanderer can pick, so one notch always clears one
 * bout of standing about however that is retuned.
 */
const MAX_STEP_SKIP = MORDECAI_MAX_PAUSE_FRAMES + 1;

export class RatKinPreviewScene extends Scene {
  private frame = 0;
  private paused = false;
  private readonly wanderer = new MordecaiWanderer(
    PREVIEW_ROOM,
    PREVIEW_HOME,
    RAT_KIN_TILES_PER_WALK_CYCLE * TILE_SIZE,
    () => true,
  );

  handleClick(): void {
    this.paused = !this.paused;
  }

  /**
   * Paused, scrolling *down* steps the wanderer forward — which is how a loop
   * seam is found. There is no step-backward: the wanderer has no history to
   * rewind, so scrolling up does nothing.
   *
   * One notch skips straight over the standing-about, because he pauses for
   * seconds at a time and the thing worth stepping through is the walk.
   */
  handleWheel(deltaY: number): void {
    if (!this.paused || deltaY <= 0) return;
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

    drawText(ctx, 'Rat Kin — click to pause; paused, the wheel steps frame by frame', {
      x: MARGIN,
      y: 16,
      size: TITLE_SIZE,
      bold: true,
      color: LABEL_COLOR,
      outline: true,
    });

    ZOOMS.forEach((zoom, lane) => {
      const tile = TILE_SIZE * zoom;
      const laneY = LANE_TOP + lane * LANE_HEIGHT;
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
        drawRatKinSprite(ctx, x, tileBottom - tile + driftY * tile, tile, {
          walkPhase: wander.walkPhase,
          isWalking: wander.isWalking,
          facingX: facing.facingX,
          facingY: facing.facingY,
        });
        if (zoom === ZOOMS[0]) {
          drawText(ctx, facing.label, {
            x: MARGIN + index * slot,
            y: laneY,
            size: LABEL_SIZE,
            color: LABEL_COLOR,
          });
        }
      });

      drawText(ctx, `${tile}px tile${zoom === ZOOMS[0] ? ' — in-game size' : ''}`, {
        x: width - MARGIN - LABEL_GUTTER,
        y: laneY,
        size: LABEL_SIZE,
        color: LABEL_COLOR,
      });
    });

    drawText(
      ctx,
      `frame ${this.frame}  phase ${wander.walkPhase.toFixed(2)}rad  ` +
        (wander.isWalking ? 'walking' : 'idle') +
        `  live facing ${wander.facingX},${wander.facingY}`,
      { x: MARGIN, y: height - MARGIN, size: LABEL_SIZE, color: LABEL_COLOR },
    );
  }
}
