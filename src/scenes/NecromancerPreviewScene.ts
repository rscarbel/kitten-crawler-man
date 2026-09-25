/**
 * Localhost-only harness for Vordrick Boneharrow in motion, with each attack's
 * ground telegraph drawn under it.
 *
 * A contact sheet cannot show whether the hem's ripple reads as floating, how
 * long a raise's sigils burn before the dead come up, or whether a pulse's
 * channel holds without a hitch — so this plays every row at the tick rates
 * the creature plays them, one column per action, one lane per view. Click
 * the left half to pause (the wheel then steps a tick at a time); click the
 * right half to switch between in-game size and double size.
 *
 * Reached via `?necromancer` in `devBootScene`; never on a production path.
 */

import { Scene } from '../core/Scene';
import { TILE_SIZE } from '../core/constants';
import { viewportHeight, viewportWidth } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { drawFigureCached } from '../sprites/figure/figureFrameCache';
import {
  GROUND_OFFSET_PX,
  NECROMANCER_ACTION_VIEWS,
  NECROMANCER_FIGURE,
  NECROMANCER_TICKS_PER_FRAME,
  TILE_SCALE,
  necromancerRow,
  necromancerStateName,
  type NecromancerAction,
  type NecromancerRowSpec,
} from '../sprites/art/necromancerFigure';
import { paintedLanternPoint, type NecromancerView } from '../sprites/art/necromancerArt';
import {
  drawBlinkMark,
  drawBoltFan,
  drawPulseTelegraph,
  drawRaiseSigil,
} from '../sprites/necromancerTelegraphs';
import {
  prewarmNecromancerArrival,
  prewarmNecromancerStanding,
} from '../sprites/necromancerSprite';

const BG_COLOR = '#262b22';
const GROUND_COLOR = '#3f4d31';
const LABEL_COLOR = '#c9d2e0';
const MARGIN = 24;
const LABEL_SIZE = 13;
const TITLE_SIZE = 18;
const TITLE_Y = 14;
const LANE_TOP = 60;

const ACTIONS: readonly NecromancerAction[] = [
  'drift',
  'idle',
  'cast_raise',
  'cast_bolt',
  'cast_pulse',
  'blink_out',
  'blink_in',
  'hurt',
  'death',
];
const VIEWS: readonly NecromancerView[] = ['front', 'side', 'away'];

/** How tall a lane is, in tiles — room for the raised staff and a label. */
const LANE_TILES = 4.4;
/** How long a one-shot rests on its last frame before it replays. */
const REST_TICKS = 40;
/** How long the grave pulse's channel is held in the preview: its real length. */
const PULSE_CHANNEL_TICKS = 90;
/** Where the preview's pulse target and blink landing sit, in tiles from him. */
const PULSE_TARGET_TILES = { x: 2.2, y: 0.3 } as const;
const BLINK_TARGET_TILES = { x: -1.6, y: 0.3 } as const;
/** The three raise sigils, in tiles from his feet. */
const SIGIL_OFFSETS: readonly { readonly x: number; readonly y: number }[] = [
  { x: -1.3, y: 0.15 },
  { x: 1.2, y: 0.3 },
  { x: -0.2, y: 0.5 },
];
/** Which way each view's bolt fan points: at the camera, forward, away. */
const FAN_ANGLE: Readonly<Record<NecromancerView, number>> = {
  front: Math.PI / 2,
  side: 0,
  away: -Math.PI / 2,
};
const ZOOMS: readonly number[] = [1, 2];
/** Where a lane's ground line sits above the lane's bottom, and the ground band round it. */
const GROUND_LINE_LIFT_TILES = 0.6;
const GROUND_BAND_ABOVE_TILES = 0.2;
const GROUND_BAND_TILES = 0.8;

/** Which frame a row shows at a tick of its own cycle, and how far its telegraph has run. */
interface Playhead {
  readonly frame: number;
  /** 0–1 through the telegraph, or null when the telegraph is not showing. */
  readonly telegraph: number | null;
}

function playheadOf(row: NecromancerRowSpec, tick: number): Playhead {
  const hold = NECROMANCER_TICKS_PER_FRAME[row.action];
  const rowTicks = row.frameCount * hold;
  if (row.kind === 'loop')
    return { frame: Math.floor(tick / hold) % row.frameCount, telegraph: null };
  if (row.loopFrom !== undefined) {
    const intro = row.loopFrom * hold;
    const channelLoop = (row.frameCount - row.loopFrom) * hold;
    const cycle = intro + PULSE_CHANNEL_TICKS + REST_TICKS;
    const t = tick % cycle;
    if (t < intro)
      return { frame: Math.floor(t / hold), telegraph: t / (intro + PULSE_CHANNEL_TICKS) };
    if (t < intro + PULSE_CHANNEL_TICKS) {
      const inLoop = (t - intro) % channelLoop;
      return {
        frame: row.loopFrom + Math.floor(inLoop / hold),
        telegraph: t / (intro + PULSE_CHANNEL_TICKS),
      };
    }
    return { frame: 0, telegraph: null };
  }
  const cycle = rowTicks + REST_TICKS;
  const t = tick % cycle;
  const frame = Math.min(row.frameCount - 1, Math.floor(t / hold));
  const eventFrame = row.eventFrames?.release;
  if (eventFrame === undefined) {
    const showsMark = row.action === 'blink_out';
    return { frame, telegraph: showsMark && t < rowTicks ? t / rowTicks : null };
  }
  const eventTick = eventFrame * hold;
  return { frame, telegraph: t <= eventTick ? t / eventTick : null };
}

export class NecromancerPreviewScene extends Scene {
  private tick = 0;
  private paused = false;
  private zoomIndex = 0;

  onEnter(): void {
    prewarmNecromancerArrival();
    prewarmNecromancerStanding();
  }

  handleClick(mx: number): void {
    if (mx < viewportWidth() / 2) this.paused = !this.paused;
    else this.zoomIndex = (this.zoomIndex + 1) % ZOOMS.length;
  }

  handleWheel(deltaY: number): void {
    if (!this.paused || deltaY <= 0) return;
    this.tick++;
  }

  update(): void {
    if (!this.paused) this.tick++;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);
    const zoom = ZOOMS[this.zoomIndex] ?? 1;
    const tile = TILE_SIZE * zoom;
    drawText(
      ctx,
      `Vordrick Boneharrow — ${tile}px tile${zoom === 1 ? ' (in-game)' : ''}. Left click: pause/step with wheel. Right click: zoom.`,
      { x: MARGIN, y: TITLE_Y, size: TITLE_SIZE, bold: true, color: LABEL_COLOR, outline: true },
    );
    const column = (width - MARGIN * 2) / ACTIONS.length;
    const laneHeight = tile * LANE_TILES;
    VIEWS.forEach((view, lane) => {
      const groundY = LANE_TOP + (lane + 1) * laneHeight - tile * GROUND_LINE_LIFT_TILES;
      ctx.fillStyle = GROUND_COLOR;
      ctx.fillRect(
        MARGIN,
        groundY - tile * GROUND_BAND_ABOVE_TILES,
        width - MARGIN * 2,
        tile * GROUND_BAND_TILES,
      );
      drawText(ctx, view, {
        x: MARGIN,
        y: groundY - laneHeight + tile,
        size: LABEL_SIZE,
        color: LABEL_COLOR,
      });
      ACTIONS.forEach((action, index) => {
        if (lane === 0) {
          drawText(ctx, action, {
            x: MARGIN + index * column + LABEL_SIZE,
            y: LANE_TOP - LABEL_SIZE,
            size: LABEL_SIZE,
            color: LABEL_COLOR,
          });
        }
        if (!NECROMANCER_ACTION_VIEWS[action].includes(view)) return;
        const row = necromancerRow(necromancerStateName(action, view));
        if (row === undefined) return;
        const footX = MARGIN + index * column + column / 2;
        this.drawCell(ctx, row, footX, groundY, tile);
      });
    });
    drawText(ctx, `tick ${this.tick}${this.paused ? ' (paused)' : ''}`, {
      x: MARGIN,
      y: height - MARGIN,
      size: LABEL_SIZE,
      color: LABEL_COLOR,
    });
  }

  /** One row at its playhead, its telegraph under it, stood on (footX, groundY). */
  private drawCell(
    ctx: CanvasRenderingContext2D,
    row: NecromancerRowSpec,
    footX: number,
    groundY: number,
    tile: number,
  ): void {
    const head = playheadOf(row, this.tick);
    if (head.telegraph !== null) this.drawTelegraph(ctx, row, head, footX, groundY, tile);
    const tileLeft = footX - tile / 2;
    const tileTop = groundY - (GROUND_OFFSET_PX / TILE_SCALE) * tile;
    drawFigureCached(ctx, NECROMANCER_FIGURE, row.name, head.frame, tileLeft, tileTop, tile);
  }

  private drawTelegraph(
    ctx: CanvasRenderingContext2D,
    row: NecromancerRowSpec,
    head: Playhead,
    footX: number,
    groundY: number,
    tile: number,
  ): void {
    const progress = head.telegraph ?? 0;
    switch (row.action) {
      case 'cast_raise':
        for (const { x: dx, y: dy } of SIGIL_OFFSETS)
          drawRaiseSigil(ctx, footX + dx * tile, groundY + dy * tile, tile, progress);
        return;
      case 'cast_bolt': {
        const lantern = paintedLanternPoint(row.view, row.pose(head.frame));
        drawBoltFan(
          ctx,
          footX + lantern.x * tile,
          groundY + lantern.y * tile,
          FAN_ANGLE[row.view],
          tile,
          progress,
        );
        return;
      }
      case 'cast_pulse':
        drawPulseTelegraph(
          ctx,
          footX,
          groundY,
          footX + PULSE_TARGET_TILES.x * tile,
          groundY + PULSE_TARGET_TILES.y * tile,
          tile,
          progress,
        );
        return;
      case 'blink_out':
        drawBlinkMark(
          ctx,
          footX + BLINK_TARGET_TILES.x * tile,
          groundY + BLINK_TARGET_TILES.y * tile,
          tile,
          progress,
        );
        return;
      case 'drift':
      case 'idle':
      case 'blink_in':
      case 'hurt':
      case 'death':
        return;
    }
  }
}
