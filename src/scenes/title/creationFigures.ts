/**
 * The pictures on the creation screen's figure page: the two looks of the
 * body the player chose, standing head-on and breathing. They are painted
 * into cells of their own, sharp at the screen's density like the title's
 * heroes, and never into the shared figure cache, so the looks the player
 * chooses between take no room there; {@link CreationFigureCells.release}
 * lets every cell go at once.
 */

import type { Rect } from '../../ui/core/geom';
import type { CreationFigurePainter } from '../../ui/screens/creation/characterCreation';
import { HUMAN_CRAWLER_LOOKS } from '../../characters/humanCrawlerLooks';
import type { HumanCrawlerLookId } from '../../characters/crawlerChoices';
import { HUMAN_ROW_TABLE } from '../../sprites/art/humanFigure';
import { rowFrameAtTicks, rowLengthInTicks } from '../../sprites/humanSprite';
import type { FigureDef } from '../../sprites/figure/figureDef';
import { TITLE_STEP_MS } from './titleClock';
import { bareHumanFigure, HUMAN_HERO_CROP, HUMAN_IDLE_ROW } from './titleCast';
import { TitleHeroCells } from './titleHeroCells';

/** Before the idle row is baked whole, a figure stands still in this frame rather than stall on the rest. */
const STILL_FRAME = 0;

/** Device pixels per CSS pixel the context paints at, before any scale of the screen. */
function pixelRatioOf(ctx: CanvasRenderingContext2D): number {
  const transform = ctx.getTransform();
  return Math.hypot(transform.a, transform.b);
}

/** The tile size and tile origin that fit the hero crop of `def` into `rect`, feet on its floor. */
function fitInto(def: FigureDef, rect: Rect): { x: number; y: number; tileSize: number } {
  const crop = HUMAN_HERO_CROP;
  const scale = Math.min(rect.w / crop.width, rect.h / crop.height);
  const drawnWidth = crop.width * scale;
  const drawnHeight = crop.height * scale;
  return {
    tileSize: scale * def.tileScale,
    x: rect.x + (rect.w - drawnWidth) / 2 - (crop.left - def.tileX) * scale,
    y: rect.y + rect.h - drawnHeight - (crop.top - def.tileY) * scale,
  };
}

export class CreationFigureCells implements CreationFigurePainter {
  private cells: TitleHeroCells | null = null;
  /**
   * The density each figure's idle row was asked for at. It is asked for again
   * only when that changes (a resize), since asking every frame would queue
   * the row again each time it finished baking.
   */
  private readonly densityById = new Map<string, number>();
  /** The `nowMs` of the frame last begun, so two figures painted in one frame begin it once. */
  private frameNowMs: number | null = null;

  paint(ctx: CanvasRenderingContext2D, rect: Rect, look: HumanCrawlerLookId, nowMs: number): void {
    const cells = this.cells ?? new TitleHeroCells(() => HUMAN_HERO_CROP);
    this.cells = cells;
    const def = bareHumanFigure(HUMAN_CRAWLER_LOOKS[look]);
    if (this.frameNowMs !== nowMs) {
      this.frameNowMs = nowMs;
      if (cells.beginFrame()) this.densityById.clear();
    }
    const { x, y, tileSize } = fitInto(def, rect);
    const density = TitleHeroCells.densityFor(def, tileSize, pixelRatioOf(ctx));
    if (this.densityById.get(def.id) !== density) {
      this.densityById.set(def.id, density);
      cells.holdResident(def, HUMAN_IDLE_ROW);
    }
    const idle = HUMAN_ROW_TABLE[HUMAN_IDLE_ROW];
    const ticks = Math.floor(nowMs / TITLE_STEP_MS) % rowLengthInTicks(idle);
    const frame = cells.isReady(def, HUMAN_IDLE_ROW, density)
      ? rowFrameAtTicks(idle, ticks)
      : STILL_FRAME;
    cells.draw(ctx, def, HUMAN_IDLE_ROW, frame, x, y, tileSize, density);
    cells.bakeQueued((figure) => this.densityById.get(figure.id) ?? density);
  }

  release(): void {
    this.cells?.dispose();
    this.cells = null;
    this.densityById.clear();
    this.frameNowMs = null;
  }
}
