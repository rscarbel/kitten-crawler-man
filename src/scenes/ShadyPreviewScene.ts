/**
 * Localhost-only harness for eyeballing Shady in motion.
 *
 * A contact sheet cannot show whether the fidget reads as nerves or as a
 * twitch, how often the neck scratch should fire, or whether the hood's lag
 * lands — so this runs the real `Shady` mob's own timers at several zooms, with
 * all three bounty markers side by side. Paused, the wheel steps frame by
 * frame. Press S (or the scratch button) to fire the scratch on demand rather
 * than waiting out its several-second gap.
 *
 * Reached via `?shady` in `devBootScene`; never on a production path.
 */

import { TILE_SIZE } from '../core/constants';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import type { WorldGesture } from '../ui/core/UiRoot';
import { worldText } from '../ui/world/worldText';
import { PreviewScene, type PreviewControl } from './PreviewScene';
import { Shady, type ShadyMarker } from '../creatures/Shady';
import { previewInk } from '../ui/theme/previewInk';

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

/** Gap between the header and the first lane's column captions. */
const LANE_TOP_GAP = 12;
/**
 * Lane heights follow their own zoom rather than sharing one constant: his art
 * stands 1.42 tiles tall, so a fixed lane tall enough for the 32px row lets the
 * 96px row climb into the lane above it and the three zooms stack into a totem.
 */
const LANE_TILES_TALL = 1.9;
const LANE_PADDING = 18;
/** Room kept at the right of a lane for its zoom label. */
const LABEL_GUTTER = 130;

/**
 * One column per state he can be in, so the three markers and the talk lean can
 * be compared at the same instant of the same fidget.
 */
interface Column {
  readonly label: string;
  readonly marker: ShadyMarker;
  readonly talking: boolean;
}

const COLUMNS: readonly Column[] = [
  { label: 'available (!)', marker: 'exclamation', talking: false },
  { label: 'active (none)', marker: 'none', talking: false },
  { label: 'kill pending (?)', marker: 'question', talking: false },
  { label: 'talking', marker: 'none', talking: true },
];

/** Wheel notches only ever step forward — there is no history to rewind. */
const STEP_FRAMES = 1;

export class ShadyPreviewScene extends PreviewScene {
  private frame = 0;
  private paused = false;
  /**
   * One mob per column, all ticked together. Separate instances rather than one
   * drawn four times because each owns its own scratch timer, and seeing four
   * of him scratch at four different moments is itself the check that the
   * per-instance phase offset works.
   */
  private readonly figures = COLUMNS.map(() => new Shady(0, 0, TILE_SIZE));

  constructor() {
    super();
    this.ui.addKeyHook((key) => {
      if (key.toLowerCase() !== 's') return false;
      this.scratch();
      return true;
    });
  }

  private scratch(): void {
    for (const figure of this.figures) figure.forceScratch();
  }

  protected handlePreviewWorldPointer(gesture: WorldGesture): void {
    if (gesture.kind !== 'wheel') return;
    if (!this.paused || gesture.deltaY <= 0) return;
    this.step();
  }

  protected previewTitle(): string {
    return 'Shady preview — ?shady';
  }

  protected previewCaptions(): readonly string[] {
    return [`frame ${this.frame}${this.paused ? ' (paused)' : ''}`];
  }

  protected previewControls(): readonly PreviewControl[] {
    return [
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
          this.step();
        },
      },
      {
        label: 'scratch (S)',
        onTap: () => {
          this.scratch();
        },
      },
    ];
  }

  private step(): void {
    this.frame += STEP_FRAMES;
    for (let i = 0; i < this.figures.length; i++) {
      this.figures[i].isTalking = COLUMNS[i].talking;
      this.figures[i].markerType = COLUMNS[i].marker;
      this.figures[i].updateAI([]);
    }
  }

  update(): void {
    if (this.paused) return;
    this.step();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    let laneY = this.headerBottom + LANE_TOP_GAP;
    ZOOMS.forEach((zoom) => {
      const tile = TILE_SIZE * zoom;
      const laneHeight = tile * LANE_TILES_TALL + LANE_PADDING;
      const tileBottom = laneY + laneHeight - LANE_PADDING;
      ctx.fillStyle = GROUND_COLOR;
      ctx.fillRect(MARGIN, tileBottom, width - MARGIN * 2, GROUND_THICKNESS);

      const slot = (width - MARGIN * 2) / COLUMNS.length;
      COLUMNS.forEach((column, index) => {
        const figure = this.figures[index];
        const x = MARGIN + index * slot + slot / 2 - tile / 2;
        const y = tileBottom - tile;
        // The mob draws itself in world space, so it is placed by moving it
        // rather than by translating the context — that keeps the marker
        // offsets under test rather than under a transform the game never
        // applies.
        figure.x = x;
        figure.y = y;
        figure.render(ctx, 0, 0, tile);
        figure.renderMarker(ctx, 0, 0, tile);
        if (zoom === ZOOMS[0]) {
          worldText(ctx, column.label, {
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
      laneY += laneHeight;
    });

    this.renderChrome(ctx);
  }
}
