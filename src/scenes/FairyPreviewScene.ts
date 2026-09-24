/**
 * Localhost-only harness for the five fairy kinds and their spell effects.
 * Reached via `?fairies` in `devBootScene`; never on a production path.
 *
 * A still cannot show whether an eight-frame wingbeat strobes, whether a
 * windup's lock reads before the release, or whether a death burst finishes
 * before the next fairy's own animation starts. This scene plays every row of
 * every kind, from every view, at the game's own frame rate, and a second tab
 * loops the standalone effects painters (chains, beams, wisps, the fireball's
 * whole life) that never appear on a mob's own figure.
 */

import { Scene } from '../core/Scene';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { drawBox, drawOverlay } from '../ui/Box';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import { figureFrameCount } from '../sprites/figure/figureDef';
import { drawFigureCached } from '../sprites/figure/figureFrameCache';
import { fairyFigureOf, fairyStateName, FAIRY_VIEWS } from '../sprites/art/fairyFigure';
import type { FairyView } from '../sprites/art/fairyArt';
import {
  FAIRY_KINDS,
  fairyRowsOf,
  fairyRowSpec,
  type FairyKind,
  type FairyRow,
} from '../sprites/art/fairyTiming';
import {
  drawAegisChain,
  drawShieldTether,
  drawShieldDeathBurst,
  drawWardGlyph,
  drawNecroTether,
  drawHealingWaveRing,
  drawHealStream,
  drawChillBlastRing,
  drawIceBolt,
  drawFireballFlight,
  drawLandingReticle,
  drawFillingDangerCircle,
  drawChargeCore,
  drawFlamePatch,
  drawExplosion,
  drawNecroWisps,
  drawResurrectionColumn,
  drawResurrectionVeil,
  drawTelekineticRing,
  type FireballTrailPoint,
} from '../sprites/art/fairyEffectsArt';

type Tab = FairyKind | 'effects';

const TAB_LABEL: Readonly<Record<Tab, string>> = {
  shield: 'shield',
  healer: 'healer',
  ice: 'ice',
  fire: 'fire',
  necro: 'necro',
  effects: 'effects',
};

interface ViewSpec {
  readonly label: string;
  readonly view: FairyView;
}

const VIEWS: ReadonlyArray<ViewSpec> = FAIRY_VIEWS.map((view) => ({ label: view, view }));

/** How many game frames a one-shot row's own cycle spans, per art frame. */
const PROGRESS_ROW_FRAME_HOLD = 6;

const BASE_TILE_SIZE = 32;
const MARGIN = 16;
const HEADER_HEIGHT = 92;
const ROW_LABEL_WIDTH = 96;
const CELL_PADDING = 10;
const LABEL_SIZE = 11;
const LABEL_GAP = 2;
const TITLE_SIZE = 16;
const BUTTON_HEIGHT = 24;
const TAB_BUTTON_WIDTH = 76;
const CONTROL_BUTTON_WIDTH = 92;
const BUTTON_GAP = 8;
const CONTROL_ROW_GAP = 8;
const CELL_WIDTH_TILES = 3;
const CELL_HEIGHT_TILES = 3.4;
/** Where a fairy's ground point sits, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.82;

const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE];

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

const BACKDROP_COLOR = '#2a2f3d';
/** The backdrop covers the whole canvas, so nothing from the last frame shows through. */
const BACKDROP_ALPHA = 1;
const CELL_BORDER_COLOR = 'rgba(255,255,255,0.14)';
const CELL_BORDER_WIDTH = 1;

/**
 * Layout fractions shared by the effects panel's cells. Each effect is drawn
 * at an arbitrary size that keeps its whole shape inside its cell — these are
 * proportions of the cell, not gameplay distances.
 */
const CELL_REACH_WIDE = 0.35;
const CELL_REACH_NARROW = 0.3;
const CELL_RADIUS_LARGE = 0.45;
const CELL_RADIUS_MEDIUM = 0.4;
const FIREBALL_ARC_HEIGHT_FRACTION = 0.5;

function drawCellBorder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  drawBox(ctx, { x, y, width, height, border: CELL_BORDER_COLOR, borderWidth: CELL_BORDER_WIDTH });
}

/** One cell in the effects panel: a name and how to paint it at a given clock share. */
interface EffectSpec {
  readonly name: string;
  readonly draw: (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    w: number,
    h: number,
    progress: number,
    frame: number,
    seed: number,
  ) => void;
}

const TRAIL_SAMPLE_COUNT = 6;
const TRAIL_SAMPLE_SPACING = 0.05;

/** A short trail for the flight previews, oldest point first; `archPx` 0 keeps it flat. */
function fireballTrail(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  progress: number,
  archPx: number,
): readonly FireballTrailPoint[] {
  const points: FireballTrailPoint[] = [];
  for (let i = TRAIL_SAMPLE_COUNT - 1; i >= 0; i--) {
    const t = Math.max(0, Math.min(1, progress - i * TRAIL_SAMPLE_SPACING));
    const x = fromX + (toX - fromX) * t;
    const arc = Math.sin(Math.PI * t) * archPx;
    const y = fromY + (toY - fromY) * t - arc;
    points.push({ x, y });
  }
  return points;
}

const EFFECTS: ReadonlyArray<EffectSpec> = [
  {
    name: 'aegis chain',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawAegisChain(
        ctx,
        cx - w * CELL_REACH_WIDE,
        cy,
        cx + w * CELL_REACH_WIDE,
        cy,
        progress,
        frame,
        seed,
      ),
  },
  {
    name: 'shield tether',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawShieldTether(
        ctx,
        cx,
        cy - h * CELL_REACH_NARROW,
        cx,
        cy + h * CELL_REACH_NARROW,
        progress,
        frame,
        seed,
      ),
  },
  {
    name: 'ward glyph',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawWardGlyph(
        ctx,
        cx,
        cy,
        cx,
        cy + h * CELL_REACH_NARROW,
        BASE_TILE_SIZE,
        progress,
        frame,
        seed,
      ),
  },
  {
    name: 'shield death burst',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawShieldDeathBurst(ctx, cx, cy, BASE_TILE_SIZE, progress, seed),
  },
  {
    name: 'necro tether',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawNecroTether(
        ctx,
        cx,
        cy - h * CELL_REACH_NARROW,
        cx,
        cy + h * CELL_REACH_NARROW,
        progress,
        frame,
        seed,
      ),
  },
  {
    name: 'heal ring',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawHealingWaveRing(ctx, cx, cy, Math.min(w, h) * CELL_RADIUS_LARGE, progress, frame, seed),
  },
  {
    name: 'heal stream',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawHealStream(
        ctx,
        cx - w * CELL_REACH_WIDE,
        cy - h * CELL_REACH_NARROW,
        cx + w * CELL_REACH_WIDE,
        cy + h * CELL_REACH_NARROW,
        progress,
        frame,
        seed,
      ),
  },
  {
    name: 'chill blast ring',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawChillBlastRing(ctx, cx, cy, Math.min(w, h) * CELL_RADIUS_LARGE, progress, frame, seed),
  },
  {
    name: 'ice bolt',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) => {
      const fromX = cx - w * CELL_RADIUS_MEDIUM;
      const toX = cx + w * CELL_RADIUS_MEDIUM;
      const trail = fireballTrail(fromX, cy, toX, cy, progress, 0);
      const headX = fromX + (toX - fromX) * progress;
      drawIceBolt(ctx, trail, headX, cy, 1, 0, BASE_TILE_SIZE, frame, seed);
    },
  },
  {
    name: 'fireball flight',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) => {
      const fromX = cx - w * CELL_RADIUS_MEDIUM;
      const toX = cx + w * CELL_RADIUS_MEDIUM;
      const groundY = cy + h * CELL_REACH_NARROW;
      const archPx = h * FIREBALL_ARC_HEIGHT_FRACTION;
      const trail = fireballTrail(fromX, groundY, toX, groundY, progress, archPx);
      const height = archPx * Math.sin(Math.PI * progress);
      drawFireballFlight(ctx, trail, toX, groundY, height, BASE_TILE_SIZE, frame, seed);
    },
  },
  {
    name: 'landing reticle',
    draw: (ctx, cx, cy, w, h, progress, frame) =>
      drawLandingReticle(ctx, cx, cy, Math.min(w, h) * CELL_REACH_WIDE, progress, frame),
  },
  {
    name: 'filling danger circle',
    draw: (ctx, cx, cy, w, h, progress) =>
      drawFillingDangerCircle(ctx, cx, cy, Math.min(w, h) * CELL_RADIUS_MEDIUM, progress),
  },
  {
    name: 'charge core',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawChargeCore(ctx, cx, cy, BASE_TILE_SIZE, progress, frame, seed),
  },
  {
    name: 'flame patch',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawFlamePatch(ctx, cx, cy, Math.min(w, h) * CELL_RADIUS_MEDIUM, progress, frame, seed),
  },
  {
    name: 'explosion',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawExplosion(ctx, cx, cy, Math.min(w, h) * CELL_RADIUS_LARGE, progress, seed),
  },
  {
    name: 'necro wisps',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawNecroWisps(ctx, cx, cy, BASE_TILE_SIZE, progress, frame, seed),
  },
  {
    name: 'resurrection column',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawResurrectionColumn(
        ctx,
        cx,
        cy + h * CELL_REACH_WIDE,
        BASE_TILE_SIZE,
        progress,
        frame,
        seed,
      ),
  },
  {
    name: 'resurrection veil',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawResurrectionVeil(
        ctx,
        cx,
        cy + h * CELL_REACH_WIDE,
        BASE_TILE_SIZE,
        progress,
        frame,
        seed,
      ),
  },
  {
    name: 'telekinetic ring — gather',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawTelekineticRing(
        ctx,
        cx,
        cy,
        Math.min(w, h) * CELL_RADIUS_LARGE,
        'gather',
        progress,
        frame,
        seed,
      ),
  },
  {
    name: 'telekinetic ring — burst',
    draw: (ctx, cx, cy, w, h, progress, frame, seed) =>
      drawTelekineticRing(
        ctx,
        cx,
        cy,
        Math.min(w, h) * CELL_RADIUS_LARGE,
        'burst',
        progress,
        frame,
        seed,
      ),
  },
];

const EFFECTS_COLUMNS = 4;
const EFFECTS_CELL_WIDTH = 168;
const EFFECTS_CELL_HEIGHT = 128;
/** Sprite-frame span of one effect loop in the preview, matching a fairy row's own cycle length in feel. */
const EFFECTS_CYCLE_FRAME_COUNT = 90;

export class FairyPreviewScene extends Scene {
  private readonly buttons: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    action?: () => void;
  }> = [];

  private tab: Tab = 'shield';
  private zoomIndex = ZOOM_LEVELS.indexOf(ZOOM_DOUBLE);
  private speedIndex = SPEED_LEVELS.length - 1;
  private paused = false;
  private clock = 0;
  private missingStates = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;

  update(): void {
    if (!this.paused) this.clock += SPEED_LEVELS[this.speedIndex];
  }

  private tile(): number {
    return BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
  }

  private cellSize(): { readonly w: number; readonly h: number } {
    const tile = this.tile();
    return { w: tile * CELL_WIDTH_TILES, h: tile * CELL_HEIGHT_TILES };
  }

  /** 0–1 through a row's own cycle: real time for a loop, a fixed-length cycle for a one-shot. */
  private progressOf(row: FairyRow): number {
    const spec = fairyRowSpec(row);
    if (spec.playback === 'loop') return 0;
    const cycleFrames = spec.frames * PROGRESS_ROW_FRAME_HOLD;
    return (Math.floor(this.clock) % cycleFrames) / cycleFrames;
  }

  private drawFairyGrid(ctx: CanvasRenderingContext2D, kind: FairyKind): void {
    const cell = this.cellSize();
    const tile = this.tile();
    const gridLeft = MARGIN + ROW_LABEL_WIDTH;
    const gridTop = HEADER_HEIGHT + MARGIN;
    const rows = fairyRowsOf(kind);
    const figure = fairyFigureOf(kind);

    VIEWS.forEach((view, column) => {
      const x = gridLeft + column * (cell.w + CELL_PADDING);
      drawText(ctx, view.label, {
        x: x + cell.w / 2,
        y: gridTop - LABEL_SIZE - LABEL_GAP,
        size: LABEL_SIZE,
        align: 'center',
        color: '#f4efe4',
        outline: true,
      });
    });

    rows.forEach((row, rowIndex) => {
      const y = gridTop + rowIndex * (cell.h + CELL_PADDING);
      const spec = fairyRowSpec(row);
      const progress = this.progressOf(row);
      const frame =
        spec.playback === 'loop'
          ? Math.floor((this.clock / PROGRESS_ROW_FRAME_HOLD) % spec.frames)
          : Math.min(spec.frames - 1, Math.floor(progress * spec.frames));

      drawText(ctx, row, {
        x: MARGIN,
        y: y + cell.h / 2 - LABEL_SIZE,
        size: LABEL_SIZE,
        color: '#f4efe4',
        outline: true,
        width: ROW_LABEL_WIDTH - LABEL_GAP,
      });
      drawText(ctx, `f${frame}/${spec.frames}`, {
        x: MARGIN,
        y: y + cell.h / 2 + LABEL_GAP,
        size: LABEL_SIZE,
        color: '#e8dcd4',
        outline: true,
      });

      VIEWS.forEach((view, column) => {
        const x = gridLeft + column * (cell.w + CELL_PADDING);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell.w, cell.h);
        ctx.clip();
        const stateName = fairyStateName(row, view.view);
        if (figureFrameCount(figure, stateName) === 0) {
          this.missingStates.add(stateName);
        } else {
          drawFigureCached(
            ctx,
            figure,
            stateName,
            frame,
            x + cell.w / 2 - tile / 2,
            y + cell.h * GROUND_FRACTION - tile,
            tile,
          );
        }
        ctx.restore();
        drawCellBorder(ctx, x, y, cell.w, cell.h);
      });
    });
  }

  private drawEffectsGrid(ctx: CanvasRenderingContext2D, width: number): void {
    const gridLeft = MARGIN;
    const gridTop = HEADER_HEIGHT + MARGIN;
    const cycleFrames = EFFECTS_CYCLE_FRAME_COUNT * PROGRESS_ROW_FRAME_HOLD;
    const progress = (Math.floor(this.clock) % cycleFrames) / cycleFrames;
    const frame = Math.floor(this.clock);

    EFFECTS.forEach((effect, index) => {
      const column = index % EFFECTS_COLUMNS;
      const row = Math.floor(index / EFFECTS_COLUMNS);
      const x = gridLeft + column * (EFFECTS_CELL_WIDTH + CELL_PADDING);
      const y = gridTop + row * (EFFECTS_CELL_HEIGHT + CELL_PADDING);
      if (x + EFFECTS_CELL_WIDTH > width) return;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, EFFECTS_CELL_WIDTH, EFFECTS_CELL_HEIGHT);
      ctx.clip();
      effect.draw(
        ctx,
        x + EFFECTS_CELL_WIDTH / 2,
        y + EFFECTS_CELL_HEIGHT / 2,
        EFFECTS_CELL_WIDTH,
        EFFECTS_CELL_HEIGHT,
        progress,
        frame,
        index + 1,
      );
      ctx.restore();
      drawCellBorder(ctx, x, y, EFFECTS_CELL_WIDTH, EFFECTS_CELL_HEIGHT);
      drawText(ctx, effect.name, {
        x: x + EFFECTS_CELL_WIDTH / 2,
        y: y + EFFECTS_CELL_HEIGHT - LABEL_SIZE - LABEL_GAP,
        size: LABEL_SIZE,
        align: 'center',
        color: '#f4efe4',
        outline: true,
        width: EFFECTS_CELL_WIDTH - LABEL_GAP * 2,
      });
    });
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    this.buttons.length = 0;
    this.missingStates.clear();

    setButtonMouseState(this.mouseX, this.mouseY);
    drawOverlay(ctx, {
      canvasWidth: width,
      canvasHeight: height,
      color: BACKDROP_COLOR,
      alpha: BACKDROP_ALPHA,
    });

    this.renderHeader(ctx, width);

    if (this.tab === 'effects') {
      this.drawEffectsGrid(ctx, width);
    } else {
      this.drawFairyGrid(ctx, this.tab);
    }

    if (this.missingStates.size > 0) {
      drawText(ctx, `manifest is missing: ${[...this.missingStates].join(', ')}`, {
        x: MARGIN,
        y: height - MARGIN - LABEL_SIZE,
        size: LABEL_SIZE,
        color: '#ff9a76',
        outline: true,
        width: width - MARGIN * 2,
      });
    }
  }

  private control(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    label: string,
    active: boolean,
    action: () => void,
  ): number {
    addButton(ctx, this.buttons, {
      ...(active ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
      x,
      y,
      width,
      height: BUTTON_HEIGHT,
      label,
      action,
    });
    return x + width + BUTTON_GAP;
  }

  private renderHeader(ctx: CanvasRenderingContext2D, width: number): void {
    drawText(ctx, 'fairy preview — ?fairies', {
      x: MARGIN,
      y: MARGIN + TITLE_SIZE,
      size: TITLE_SIZE,
      color: '#fdfaf2',
      outline: true,
    });

    const tabsY = MARGIN + TITLE_SIZE + CONTROL_ROW_GAP;
    let x = MARGIN;
    const tabs: readonly Tab[] = [...FAIRY_KINDS, 'effects'];
    for (const tab of tabs) {
      x = this.control(ctx, x, tabsY, TAB_BUTTON_WIDTH, TAB_LABEL[tab], this.tab === tab, () => {
        this.tab = tab;
      });
    }

    const controlsY = tabsY + BUTTON_HEIGHT + CONTROL_ROW_GAP;
    x = MARGIN;
    x = this.control(
      ctx,
      x,
      controlsY,
      CONTROL_BUTTON_WIDTH,
      `zoom ${ZOOM_LEVELS[this.zoomIndex]}x`,
      false,
      () => {
        this.zoomIndex = (this.zoomIndex + 1) % ZOOM_LEVELS.length;
      },
    );
    x = this.control(
      ctx,
      x,
      controlsY,
      CONTROL_BUTTON_WIDTH,
      this.paused ? 'play' : 'pause',
      false,
      () => {
        this.paused = !this.paused;
      },
    );
    this.control(
      ctx,
      x,
      controlsY,
      CONTROL_BUTTON_WIDTH,
      `speed ${SPEED_LEVELS[this.speedIndex]}x`,
      false,
      () => {
        this.speedIndex = (this.speedIndex + 1) % SPEED_LEVELS.length;
      },
    );

    drawText(ctx, 'front / side / away, one kind per tab; effects tab loops the standalone VFX', {
      x: width - MARGIN,
      y: MARGIN + TITLE_SIZE,
      size: LABEL_SIZE,
      align: 'right',
      color: '#e6e0d2',
      outline: true,
    });
  }

  handleMouseMove(mx: number, my: number): void {
    this.mouseX = mx;
    this.mouseY = my;
  }

  handleClick(mx: number, my: number): void {
    for (const button of this.buttons) {
      const inside =
        mx >= button.x && mx <= button.x + button.w && my >= button.y && my <= button.y + button.h;
      if (!inside) continue;
      playButtonSound(null);
      button.action?.();
      return;
    }
  }
}
