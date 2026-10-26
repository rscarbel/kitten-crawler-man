/**
 * Localhost-only harness for watching Dr. Moult in motion.
 *
 * A contact sheet cannot show whether the walk plants or skates, how the run
 * reads at speed, or whether the fidget looks like nerves. This plays the
 * chosen action in all three views at the in-game tile and twice it, through
 * the real draw call and the real phase pacing, and a lane underneath walks
 * or runs him across the screen so the feet can be judged against the floor.
 *
 * Reached via `?scientist` (`?scientist=<action>` opens on one); never on a
 * production path.
 */

import { TILE_SIZE } from '../core/constants';
import { viewportHeight, viewportWidth } from '../core/rendering/Viewport';
import type { FacingSelection } from '../sprites/facingView';
import {
  advanceScientistPhase,
  drawScientist,
  SCIENTIST_ACTIONS,
  type ScientistAction,
} from '../sprites/art/scientistFigure';
import { previewInk } from '../ui/theme/previewInk';
import { worldText } from '../ui/world/worldText';
import { PreviewScene, type PreviewControl } from './PreviewScene';

const BG_COLOR = previewInk.slate.backdrop;
const GROUND_COLOR = previewInk.slate.ground;
const LABEL_COLOR = previewInk.slate.label;
const GROUND_THICKNESS = 2;
const MARGIN = 32;
const LABEL_SIZE = 14;
const LANE_TOP_GAP = 16;
/** He stands well over two tiles tall, so a lane is three. */
const LANE_TILES_TALL = 3;
const ZOOMS: readonly number[] = [1, 2];

const VIEWS: readonly { readonly label: string; readonly facing: FacingSelection }[] = [
  { label: 'front', facing: { view: 'front', flipX: false } },
  { label: 'side', facing: { view: 'side', flipX: false } },
  { label: 'side (west)', facing: { view: 'side', flipX: true } },
  { label: 'back', facing: { view: 'back', flipX: false } },
];

/** World pixels a tick he travels at in the crossing lane, walking and running. */
const WALK_SPEED_PX = 0.6;
const RUN_SPEED_PX = 1.8;

function isAction(value: string): value is ScientistAction {
  return SCIENTIST_ACTIONS.some((action) => action === value);
}

export class ScientistPreviewScene extends PreviewScene {
  private action: ScientistAction;
  private phase = 0;
  private crossingX = 0;
  private crossingPhase = 0;
  private crossingRuns = false;
  private paused = false;

  constructor(initial: string | null) {
    super();
    this.action = initial !== null && isAction(initial) ? initial : 'idle';
  }

  protected previewTitle(): string {
    return 'Dr. Moult preview — ?scientist';
  }

  protected previewCaptions(): readonly string[] {
    return [`${this.action}, phase ${this.phase.toFixed(2)}${this.paused ? ' (paused)' : ''}`];
  }

  protected previewControls(): readonly PreviewControl[] {
    const actions = SCIENTIST_ACTIONS.map((action): PreviewControl => ({
      label: action,
      selected: action === this.action,
      onTap: () => {
        this.action = action;
        this.phase = 0;
      },
    }));
    return [
      ...actions,
      {
        id: 'play',
        label: this.paused ? 'play' : 'pause',
        onTap: () => {
          this.paused = !this.paused;
        },
      },
      {
        id: 'crossing',
        label: this.crossingRuns ? 'crossing: run' : 'crossing: walk',
        onTap: () => {
          this.crossingRuns = !this.crossingRuns;
        },
      },
    ];
  }

  update(): void {
    if (this.paused) return;
    const travels = this.action === 'walk' || this.action === 'run';
    const ground = this.action === 'run' ? RUN_SPEED_PX : WALK_SPEED_PX;
    this.phase = advanceScientistPhase(this.action, this.phase, travels ? ground : 0);
    if (this.action === 'cower' && this.phase >= 1) this.phase = 0;
    const crossing: ScientistAction = this.crossingRuns ? 'run' : 'walk';
    const speed = this.crossingRuns ? RUN_SPEED_PX : WALK_SPEED_PX;
    this.crossingPhase = advanceScientistPhase(crossing, this.crossingPhase, speed);
    this.crossingX += speed;
    if (this.crossingX > viewportWidth()) this.crossingX = -TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, viewportHeight());

    let laneY = this.headerBottom + LANE_TOP_GAP;
    const slot = (width - MARGIN * 2) / VIEWS.length;
    for (const zoom of ZOOMS) {
      const tile = TILE_SIZE * zoom;
      const groundY = laneY + tile * LANE_TILES_TALL;
      ctx.fillStyle = GROUND_COLOR;
      ctx.fillRect(MARGIN, groundY, width - MARGIN * 2, GROUND_THICKNESS);
      VIEWS.forEach((view, index) => {
        const x = MARGIN + index * slot + slot / 2 - tile / 2;
        drawScientist(ctx, this.action, view.facing, this.phase, x, groundY - tile, tile);
        if (zoom === ZOOMS[0]) {
          worldText(ctx, view.label, {
            x: MARGIN + index * slot,
            y: laneY,
            size: LABEL_SIZE,
            color: LABEL_COLOR,
          });
        }
      });
      laneY = groundY + LANE_TOP_GAP;
    }

    const crossingGround = laneY + TILE_SIZE * LANE_TILES_TALL;
    ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, crossingGround, width, GROUND_THICKNESS);
    drawScientist(
      ctx,
      this.crossingRuns ? 'run' : 'walk',
      { view: 'side', flipX: false },
      this.crossingPhase,
      this.crossingX,
      crossingGround - TILE_SIZE,
      TILE_SIZE,
    );

    this.renderChrome(ctx);
  }
}
