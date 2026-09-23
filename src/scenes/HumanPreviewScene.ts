/**
 * Localhost-only harness for Carl in motion. Reached via `?human` in
 * `devBootScene`; `?human=<row>` opens on that row.
 *
 * Two panes, both at the game's real timing:
 *
 * - **Row**: one row of the figure looped on the dungeon floor at 128, 64 and
 *   the in-game 32 px, paced exactly as the runtime paces it — a clock row at
 *   its own hold, a gait cycle by the ground base speed covers, a blow over the
 *   swing's own ticks. Click to step to the next row.
 * - **Live**: a real `HumanPlayer` ticked through a fixed script — stand, run,
 *   stop, strike, get hit, stand long enough to fidget — and drawn through the
 *   same selection `drawSelf` uses, so it shows the animator's hand-offs rather
 *   than any one row.
 *
 * A contact sheet cannot show timing; this is where a floating stride or a
 * strobing cycle shows up.
 */

import { Scene } from '../core/Scene';
import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import { progressFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { HUMAN_SWING_FRAMES } from '../core/crawlerFormulas';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { drawText } from '../ui/TextBox';
import { drawBox, drawOverlay } from '../ui/Box';
import { HUMAN_ROWS, type RowSpec } from '../sprites/art/humanFigure';
import {
  drawHumanSelection,
  type HumanRowSelection,
  isGaitCycle,
  prewarmHumanSprite,
  rowFrameAtTicks,
  rowLengthInTicks,
  rowTicksPerFrame,
} from '../sprites/humanSprite';
import { gaitRadiansPerPx } from '../sprites/humanAnimator';
import { groundPxPerFrame } from '../sprites/art/human/probe';
import { TICKS_PER_SECOND } from '../sprites/art/human/timing';

const BG_COLOR = '#12111a';
/** The dungeon floor's tone, the colour every in-game judgement is made against. */
const FLOOR_COLOR = '#191720';
/** The backdrop covers whatever the last scene left on the canvas. */
const OPAQUE = 1;
const LABEL_COLOR = '#e2e8f0';
const SUBLABEL_COLOR = '#93a2c0';

const MARGIN = 40;
const TITLE_SIZE = 18;
const LABEL_SIZE = 12;
const TITLE_Y = 14;
const SUBTITLE_Y = 40;
const PANE_TOP = 90;
const PANE_GAP = 60;
const CAPTION_GAP = 8;
/** Each square pane, in tiles: Carl stands over a tile and a half above his own, so the pane is that much taller than a tile. */
const PANE_SIZE_TILES = 2.2;
/** A one-shot rests this long on its last frame before it plays again. */
const ONE_SHOT_REST_TICKS = 30;

const REVIEW_TILE_SIZE = 128;
const HALF_REVIEW_TILE_SIZE = 64;
/** Review size first, the in-game tile last: only the last one is what a player sees. */
const ROW_TILE_SIZES: ReadonlyArray<number> = [REVIEW_TILE_SIZE, HALF_REVIEW_TILE_SIZE, TILE_SIZE];
const LIVE_TILE_SIZE = HALF_REVIEW_TILE_SIZE;

/** One step of the live pane's script: how long, and what the stick is doing. */
interface ScriptStep {
  readonly ticks: number;
  readonly label: string;
  readonly move?: { readonly x: number; readonly y: number };
  readonly strike?: boolean;
  readonly hit?: boolean;
}

/** Long enough for the guard to drop and the relaxed idle to come back. */
const GUARD_THEN_IDLE_SECONDS = 4;
/** Past the longest fidget delay plus a full idle loop, so a fidget always shows. */
const UNTIL_FIDGET_SECONDS = 14;
const SECONDS = TICKS_PER_SECOND;
const LIVE_SCRIPT: ReadonlyArray<ScriptStep> = [
  { ticks: 2 * SECONDS, label: 'standing' },
  { ticks: 2 * SECONDS, label: 'running right', move: { x: 1, y: 0 } },
  { ticks: 1 * SECONDS, label: 'stopped' },
  { ticks: 1 * SECONDS, label: 'running left, striking', move: { x: -1, y: 0 }, strike: true },
  { ticks: 1 * SECONDS, label: 'running down', move: { x: 0, y: 1 } },
  { ticks: 1 * SECONDS, label: 'hit', hit: true },
  { ticks: GUARD_THEN_IDLE_SECONDS * SECONDS, label: 'guard, then idle' },
  { ticks: UNTIL_FIDGET_SECONDS * SECONDS, label: 'idle long enough to fidget' },
];

/** The frame a row shows `ticks` into playing it, paced the way the runtime paces it. */
function frameAt(row: RowSpec, ticks: number): number {
  if (isGaitCycle(row)) {
    const phase = ticks * PLAYER_SPEED * gaitRadiansPerPx(row.gait);
    return walkFrameIndex(phase, row.frameCount);
  }
  const isBlow = row.role === 'strike' || row.role === 'stomp';
  const hold = rowTicksPerFrame(row);
  if (row.kind === 'loop') return rowFrameAtTicks(row, ticks % rowLengthInTicks(row));
  // The run's start is paced by the ground he covers, like the cycle it leads into.
  const groundPaced = !isBlow && row.locomotion === 'travelling';
  const ticksPerFrame = groundPaced ? groundPxPerFrame(row.name) / PLAYER_SPEED : hold;
  const length = isBlow ? HUMAN_SWING_FRAMES : row.frameCount * ticksPerFrame;
  const withinPlay = ticks % (length + ONE_SHOT_REST_TICKS);
  const progress = Math.min(withinPlay / length, 1);
  return progressFrameIndex(progress, row.frameCount);
}

function initialRowIndex(): number {
  const wanted = new URLSearchParams(window.location.search).get('human');
  const index = HUMAN_ROWS.findIndex((row) => row.name === wanted);
  return Math.max(0, index);
}

export class HumanPreviewScene extends Scene {
  private rowIndex = initialRowIndex();
  private rowTicks = 0;
  private readonly live = new HumanPlayer(0, 0, TILE_SIZE);
  private scriptStep = 0;
  private stepTicks = 0;

  constructor() {
    super();
    prewarmHumanSprite();
  }

  handleClick(): void {
    this.rowIndex = (this.rowIndex + 1) % HUMAN_ROWS.length;
    this.rowTicks = 0;
  }

  update(): void {
    this.rowTicks++;
    this.tickLive();
  }

  private tickLive(): void {
    const step = LIVE_SCRIPT[this.scriptStep];
    if (this.stepTicks === 0 && step.hit === true) {
      this.live.takeDamage(1, { kind: 'mob', mobType: 'preview' });
      // The script loops forever; a scratch per lap would eventually knock him out.
      this.live.hp = this.live.maxHp;
    }
    if (step.move !== undefined) {
      this.live.isMoving = true;
      this.live.facingX = step.move.x;
      this.live.facingY = step.move.y;
      this.live.x += step.move.x * PLAYER_SPEED;
      this.live.y += step.move.y * PLAYER_SPEED;
    } else {
      this.live.isMoving = false;
    }
    if (step.strike === true && this.live.attackTimer === 0) this.live.triggerAttack();
    this.live.updateAttack();
    this.live.tickTimers();
    this.stepTicks++;
    if (this.stepTicks < step.ticks) return;
    this.stepTicks = 0;
    this.scriptStep = (this.scriptStep + 1) % LIVE_SCRIPT.length;
    // The live pane stays in view however far the script walks him.
    if (this.scriptStep === 0) {
      this.live.x = 0;
      this.live.y = 0;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    drawOverlay(ctx, {
      canvasWidth: width,
      canvasHeight: viewportHeight(),
      color: BG_COLOR,
      alpha: OPAQUE,
    });

    const row = HUMAN_ROWS[this.rowIndex];
    const frame = frameAt(row, this.rowTicks);
    drawText(ctx, `Carl — ${row.name} (${row.view}, ${row.kind}) — click for the next row`, {
      x: MARGIN,
      y: TITLE_Y,
      size: TITLE_SIZE,
      bold: true,
      color: LABEL_COLOR,
      outline: true,
    });
    drawText(ctx, `frame ${frame + 1} of ${row.frameCount}, at game timing`, {
      x: MARGIN,
      y: SUBTITLE_Y,
      size: LABEL_SIZE,
      color: SUBLABEL_COLOR,
    });

    let x = MARGIN;
    for (const size of ROW_TILE_SIZES) {
      this.drawPane(ctx, x, size, `${size}px`, { row: row.name, frame, flipX: false });
      x += size * PANE_SIZE_TILES + PANE_GAP;
    }

    const step = LIVE_SCRIPT[this.scriptStep];
    const live = this.live.spriteSelection();
    this.drawPane(ctx, x, LIVE_TILE_SIZE, `live: ${step.label} — ${live.row}[${live.frame}]`, live);
  }

  private drawPane(
    ctx: CanvasRenderingContext2D,
    left: number,
    size: number,
    caption: string,
    selection: HumanRowSelection,
  ): void {
    const paneWidth = size * PANE_SIZE_TILES;
    const paneHeight = size * PANE_SIZE_TILES;
    drawBox(ctx, {
      x: left,
      y: PANE_TOP,
      width: paneWidth,
      height: paneHeight,
      fill: FLOOR_COLOR,
    });
    const tileLeft = left + (paneWidth - size) / 2;
    const tileTop = PANE_TOP + paneHeight - size;
    drawHumanSelection(ctx, tileLeft, tileTop, size, selection);
    drawText(ctx, caption, {
      x: left,
      y: PANE_TOP + paneHeight + CAPTION_GAP,
      size: LABEL_SIZE,
      color: SUBLABEL_COLOR,
    });
  }
}
