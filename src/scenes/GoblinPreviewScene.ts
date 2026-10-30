/**
 * Localhost-only harness for watching the goblins move.
 *
 * Reached via `?goblins` in `devBootScene` (see `game.ts`); never on a production
 * path. It exists because stills genuinely cannot answer "does this look
 * smooth": the review harness in `scripts/render-goblins.ts` can show that an
 * arc is even and a loop closes, but only playback shows whether a swing has
 * weight. This scene is worth more than the rest of the review tooling put
 * together, which is why it was built before the goblin rework shipped rather
 * than left as a nice-to-have.
 *
 * The armed archetypes play every row simultaneously on a labelled grid, at a
 * chosen zoom and speed, over a backdrop that cycles the real floor palettes so
 * the contrast check happens against the thing the goblin actually stands on.
 * The two bombers have rows of their own and play on a second grid, behind the
 * "show bombers" control.
 * Killing an archetype fires the real `BodyPartGoreSystem`, which is the only
 * way to check that pieces tumble in place rather than orbiting.
 */

import { viewportWidth, viewportHeight } from '../core/rendering/Viewport';
import { worldText } from '../ui/world/worldText';
import { PreviewScene, type PreviewControl } from './PreviewScene';
import { GameMap } from '../map/GameMap';
import { openFloorGrid } from '../map/openFloorGrid';
import { BodyPartGoreSystem } from '../systems/BodyPartGoreSystem';
import {
  ATTACK_MOVE_NAMES,
  GOBLIN_ATTACKS,
  drawGoblinSprite,
  goblinBodyPartKey,
  goblinFigure,
  GOBLIN_BOW_SHOTS,
  type GoblinArchetype,
  type GoblinState,
  GOBLIN_IDLE_BREAK_FPS,
  GOBLIN_IDLE_FPS,
} from '../sprites/goblinSprite';
import { figureFrameCount } from '../sprites/figure/figureDef';
import {
  GOBLIN_BOMBER_ROWS,
  GOBLIN_BOMBER_EVENT_FRAMES,
  type GoblinBomberRow,
} from '../sprites/art/goblinBomberFigure';
import { GOBLIN_BOMBER_ARCHETYPES, type GoblinBomberArchetype } from '../sprites/art/goblinArt';
import { drawGoblinBomberSprite } from '../sprites/goblinBomberSprite';
import { previewInk } from '../ui/theme/previewInk';

const ARCHETYPES: ReadonlyArray<GoblinArchetype> = ['sword', 'axe', 'mace', 'warhammer', 'bow'];

/**
 * What the archer's two attack rows depict, and on which frame the string goes.
 *
 * Kept beside the melee tables rather than in them: `GOBLIN_ATTACKS` carries a
 * reach and a damage number an arrow has no use for, and the frame this harness
 * marks is a *release* rather than a moment of contact.
 */
const BOW_MOVE_NAMES: Record<'light' | 'heavy', string> = {
  light: 'hurried shot',
  heavy: 'aimed shot',
};

/** The frame an archetype's attack row peaks on — impact, or the loose. */
function peakFrameOf(archetype: GoblinArchetype, kind: 'light' | 'heavy'): number {
  if (archetype === 'bow') return GOBLIN_BOW_SHOTS[kind].releaseFrame;
  return GOBLIN_ATTACKS[archetype][kind].impactFrame;
}

function moveNameOf(archetype: GoblinArchetype, kind: 'light' | 'heavy'): string {
  if (archetype === 'bow') return BOW_MOVE_NAMES[kind];
  return ATTACK_MOVE_NAMES[archetype][kind];
}

interface RowSpec {
  readonly state: GoblinState;
  readonly fps: number;
}

/**
 * The rows to show and how fast to play them. Frame counts are deliberately
 * absent: they are read from the figure at draw time, because a hand-copied
 * count here would silently desync from the art the moment a row's length
 * changed.
 */
const ROWS: ReadonlyArray<RowSpec> = [
  { state: 'walk', fps: 10 },
  { state: 'idle', fps: GOBLIN_IDLE_FPS },
  { state: 'idle_break', fps: GOBLIN_IDLE_BREAK_FPS },
  { state: 'attack_light', fps: 14 },
  { state: 'attack_heavy', fps: 14 },
  { state: 'flinch', fps: 12 },
];

/** The bombers' rows, in the order the grid shows them, and how fast each plays. */
const BOMBER_ROWS: ReadonlyArray<{ readonly state: GoblinBomberRow; readonly fps: number }> = [
  { state: 'walk', fps: 10 },
  { state: 'run', fps: 14 },
  { state: 'idle', fps: GOBLIN_IDLE_FPS },
  { state: 'light', fps: 12 },
  { state: 'aim', fps: 8 },
  { state: 'throw', fps: 14 },
  { state: 'flinch', fps: 12 },
];

/** The frame a bomber row's event lands on, outlined like a strike's impact. */
function bomberPeakFrameOf(archetype: GoblinBomberArchetype, row: GoblinBomberRow): number | null {
  const events = GOBLIN_BOMBER_EVENT_FRAMES[archetype];
  if (row === 'light') return events.fuseCatch;
  if (row === 'throw') return events.release;
  return null;
}

/** How many frames a bomber row holds, or null when that bomber does not paint it. */
function bomberFrameCountOf(archetype: GoblinBomberArchetype, row: GoblinBomberRow): number | null {
  return (
    GOBLIN_BOMBER_ROWS[archetype].find((candidate) => candidate.name === row)?.frameCount ?? null
  );
}

/** How many frames a row actually holds, from the figure that paints it. */
function frameCountOf(weapon: GoblinArchetype, state: GoblinState): number {
  return figureFrameCount(goblinFigure(weapon), state);
}

/** 1× is what a player sees; 4× is where an ear notch becomes visible at all. */
const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_REVIEW = 4;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE, ZOOM_REVIEW];

/** Quarter speed is slow enough to read a 52-frame hammer strike beat by beat. */
const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];
/** The floor mids a goblin actually stands on, from `src/map/tilegen/palette.ts`. */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 1 — cellar stone', color: previewInk.floor.cellarStone },
  { name: 'floor 1 — dressed stone', color: previewInk.floor.dressedStone },
  { name: 'floor 2 — poured concrete', color: previewInk.floor.pouredConcrete },
  { name: 'floor 3 — grass', color: previewInk.floor.grass },
];

const BASE_TILE_SIZE = 32;
const MARGIN = 16;
const ROW_LABEL_WIDTH = 96;
const CELL_PADDING = 10;
const LABEL_SIZE = 11;
/** Space between a label and the cell edge it captions. */
const LABEL_GAP = 2;
/** Width of the outline marking a cell on its impact or release frame. */
const PEAK_FRAME_OUTLINE_WIDTH = 2;
/** Where a cell's goblin stands, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.86;
/** Inset of a cell's own caption from its left edge. */
const CELL_TEXT_INSET = 4;
const FRAMES_PER_SECOND = 60;
/** Gore needs a map to settle onto; a small empty one is enough for a preview. */
const PREVIEW_MAP_SIZE = 24;

export class GoblinPreviewScene extends PreviewScene {
  private readonly map = new GameMap({ prebuiltStructure: openFloorGrid(PREVIEW_MAP_SIZE) });
  private readonly gore = new BodyPartGoreSystem(this.map);

  // Two, not four: at 4× five of the six rows start below the bottom of the screen.
  private zoomIndex = ZOOM_LEVELS.indexOf(ZOOM_DOUBLE);
  private speedIndex = SPEED_LEVELS.length - 1;
  private backdropIndex = 0;
  private paused = false;
  /** Fractional frame counter, so a 0.25× speed still advances. */
  private clock = 0;
  private stepRequested = false;
  /** The armed goblins share one grid and the bombers another: their rows differ. */
  private showBombers = false;

  update(): void {
    if (this.stepRequested) {
      this.clock += 1;
      this.stepRequested = false;
    } else if (!this.paused) {
      this.clock += SPEED_LEVELS[this.speedIndex];
    }
    this.gore.update();
  }

  /** Which frame of a row is showing right now, at the chosen playback speed. */
  private frameOf(row: RowSpec, weapon: GoblinArchetype): number {
    const elapsedSeconds = this.clock / FRAMES_PER_SECOND;
    return Math.floor(elapsedSeconds * row.fps) % frameCountOf(weapon, row.state);
  }

  private cellSize(): { readonly w: number; readonly h: number } {
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    // Generous around the tile: a war hammer hauled overhead reaches well past
    // the goblin's own footprint, and a cell that crops it hides the very frame
    // this scene exists to judge.
    const OVERHANG_TILES = 3;
    return { w: tile * OVERHANG_TILES, h: tile * OVERHANG_TILES };
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();

    ctx.fillStyle = BACKDROPS[this.backdropIndex].color;
    ctx.fillRect(0, 0, width, height);

    const cell = this.cellSize();
    const gridLeft = MARGIN + ROW_LABEL_WIDTH;
    const gridTop = this.headerBottom + MARGIN + LABEL_SIZE;

    if (this.showBombers) {
      this.renderBombers(ctx, gridLeft, gridTop);
      this.renderChrome(ctx);
      return;
    }

    ARCHETYPES.forEach((weapon, column) => {
      const x = gridLeft + column * (cell.w + CELL_PADDING);
      worldText(ctx, weapon, {
        x: x + cell.w / 2,
        y: gridTop - LABEL_SIZE - LABEL_GAP,
        size: LABEL_SIZE,
        align: 'center',
        color: previewInk.grid.caption,
        outline: true,
      });
    });

    ROWS.forEach((row, rowIndex) => {
      const y = gridTop + rowIndex * (cell.h + CELL_PADDING);
      const isAttack = row.state === 'attack_light' || row.state === 'attack_heavy';
      worldText(ctx, row.state, {
        x: MARGIN,
        y: y + cell.h / 2 - LABEL_SIZE,
        size: LABEL_SIZE,
        color: previewInk.grid.caption,
        outline: true,
      });
      // Every archetype's rows are the same length, so one is enough to label.
      const frame = this.frameOf(row, ARCHETYPES[0]);
      worldText(ctx, `f${frame}`, {
        x: MARGIN,
        y: y + cell.h / 2 + LABEL_GAP,
        size: LABEL_SIZE,
        color: previewInk.grid.frameCounter,
        outline: true,
      });

      ARCHETYPES.forEach((weapon, column) => {
        const x = gridLeft + column * (cell.w + CELL_PADDING);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell.w, cell.h);
        ctx.clip();
        const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
        const shown = this.frameOf(row, weapon);
        drawGoblinSprite(ctx, {
          archetype: weapon,
          x: x + cell.w / 2 - tile / 2,
          y: y + cell.h * GROUND_FRACTION - tile,
          tileSize: tile,
          facingX: 1,
          state: row.state,
          frame: shown,
        });
        ctx.restore();

        ctx.strokeStyle = previewInk.grid.cellBorder;
        ctx.strokeRect(x, y, cell.w, cell.h);

        // The impact frame is the contract between the art and `Goblin.ts`, so
        // it is marked: stepping to it is how the two get confirmed to agree.
        if (isAttack) {
          const kind = row.state === 'attack_light' ? 'light' : 'heavy';
          if (shown === peakFrameOf(weapon, kind)) {
            ctx.strokeStyle = previewInk.grid.impactFrame;
            ctx.lineWidth = PEAK_FRAME_OUTLINE_WIDTH;
            const outlineInset = PEAK_FRAME_OUTLINE_WIDTH / 2;
            ctx.strokeRect(
              x + outlineInset,
              y + outlineInset,
              cell.w - PEAK_FRAME_OUTLINE_WIDTH,
              cell.h - PEAK_FRAME_OUTLINE_WIDTH,
            );
            ctx.lineWidth = 1;
          }
          worldText(ctx, moveNameOf(weapon, kind), {
            x: x + CELL_TEXT_INSET,
            y: y + cell.h - LABEL_SIZE - LABEL_GAP,
            size: LABEL_SIZE,
            color: previewInk.grid.moveName,
            outline: true,
          });
        }
      });
    });

    this.gore.renderSettled(ctx, 0, 0);
    this.gore.renderFlying(ctx, 0, 0);
    this.renderChrome(ctx);
  }

  private renderBombers(ctx: CanvasRenderingContext2D, gridLeft: number, gridTop: number): void {
    const cell = this.cellSize();
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    const elapsedSeconds = this.clock / FRAMES_PER_SECOND;
    GOBLIN_BOMBER_ARCHETYPES.forEach((archetype, column) => {
      worldText(ctx, archetype, {
        x: gridLeft + column * (cell.w + CELL_PADDING) + cell.w / 2,
        y: gridTop - LABEL_SIZE - LABEL_GAP,
        size: LABEL_SIZE,
        align: 'center',
        color: previewInk.grid.caption,
        outline: true,
      });
    });
    BOMBER_ROWS.forEach((row, rowIndex) => {
      const y = gridTop + rowIndex * (cell.h + CELL_PADDING);
      worldText(ctx, row.state, {
        x: MARGIN,
        y: y + cell.h / 2 - LABEL_SIZE,
        size: LABEL_SIZE,
        color: previewInk.grid.caption,
        outline: true,
      });
      GOBLIN_BOMBER_ARCHETYPES.forEach((archetype, column) => {
        const frames = bomberFrameCountOf(archetype, row.state);
        if (frames === null) return;
        const x = gridLeft + column * (cell.w + CELL_PADDING);
        const shown = Math.floor(elapsedSeconds * row.fps) % frames;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell.w, cell.h);
        ctx.clip();
        drawGoblinBomberSprite(ctx, {
          archetype,
          x: x + cell.w / 2 - tile / 2,
          y: y + cell.h * GROUND_FRACTION - tile,
          tileSize: tile,
          facingX: 1,
          state: row.state,
          frame: shown,
        });
        ctx.restore();
        ctx.strokeStyle = previewInk.grid.cellBorder;
        ctx.strokeRect(x, y, cell.w, cell.h);
        if (shown !== bomberPeakFrameOf(archetype, row.state)) return;
        ctx.strokeStyle = previewInk.grid.impactFrame;
        ctx.lineWidth = PEAK_FRAME_OUTLINE_WIDTH;
        const outlineInset = PEAK_FRAME_OUTLINE_WIDTH / 2;
        ctx.strokeRect(
          x + outlineInset,
          y + outlineInset,
          cell.w - PEAK_FRAME_OUTLINE_WIDTH,
          cell.h - PEAK_FRAME_OUTLINE_WIDTH,
        );
        ctx.lineWidth = 1;
      });
    });
  }

  protected previewTitle(): string {
    return 'goblin preview — ?goblins';
  }

  protected previewCaptions(): readonly string[] {
    return [BACKDROPS[this.backdropIndex].name];
  }

  protected previewControls(): readonly PreviewControl[] {
    return [
      {
        id: 'zoom',
        label: `zoom ${ZOOM_LEVELS[this.zoomIndex]}x`,
        onTap: () => {
          this.zoomIndex = (this.zoomIndex + 1) % ZOOM_LEVELS.length;
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
          this.stepRequested = true;
        },
      },
      {
        id: 'speed',
        label: `speed ${SPEED_LEVELS[this.speedIndex]}x`,
        onTap: () => {
          this.speedIndex = (this.speedIndex + 1) % SPEED_LEVELS.length;
        },
      },
      {
        id: 'family',
        label: this.showBombers ? 'show armed' : 'show bombers',
        onTap: () => {
          this.showBombers = !this.showBombers;
        },
      },
      {
        label: 'backdrop',
        onTap: () => {
          this.backdropIndex = (this.backdropIndex + 1) % BACKDROPS.length;
        },
      },
      ...ARCHETYPES.map((weapon) => ({
        label: `kill ${weapon}`,
        onTap: () => {
          this.kill(weapon);
        },
      })),
    ];
  }

  /**
   * Fire the real gore system at the middle of the screen.
   *
   * Deliberately the real one rather than a mock: the question this answers is
   * whether a piece tumbles about its own centre or orbits it, and only the
   * runtime's own `drawSpriteRotatedCenter` path can answer that.
   */
  private kill(weapon: GoblinArchetype): void {
    const IMPACT_DIRECTION_X = 1;
    const IMPACT_DIRECTION_Y = -0.4;
    this.gore.spawnParts(
      viewportWidth() / 2,
      viewportHeight() / 2,
      goblinBodyPartKey(weapon),
      BASE_TILE_SIZE,
      IMPACT_DIRECTION_X,
      IMPACT_DIRECTION_Y,
    );
  }
}
