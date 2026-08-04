/**
 * Localhost-only harness for watching the goblins move.
 *
 * Reached via `?goblins` in `devBootScene` (see `game.ts`); never on a production
 * path. It exists because stills genuinely cannot answer "does this look
 * smooth": the review harness in `scripts/render-goblins.ts` can show that an
 * arc is even and a loop closes, but only playback shows whether a swing has
 * weight. This scene is worth more than the rest of the review tooling put
 * together, which is why the plan puts it in Phase 4 rather than at the end.
 *
 * All four archetypes play every row simultaneously on a labelled grid, at a
 * chosen zoom and speed, over a backdrop that cycles the real floor palettes so
 * the contrast check happens against the thing the goblin actually stands on.
 * Killing an archetype fires the real `BodyPartGoreSystem`, which is the only
 * way to check that pieces tumble in place rather than orbiting.
 */

import { Scene } from '../core/Scene';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import { GameMap } from '../map/GameMap';
import { BodyPartGoreSystem } from '../systems/BodyPartGoreSystem';
import {
  ATTACK_MOVE_NAMES,
  GOBLIN_ATTACKS,
  drawGoblinSprite,
  goblinBodyPartKey,
  goblinSheetKey,
  GOBLIN_BOW_SHOTS,
  type GoblinArchetype,
} from '../sprites/goblinSprite';
import { getSpriteDefByKey, type SpriteStates } from '../core/SpriteLoader';

type GoblinState = SpriteStates['goblin_axe'];

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
 * absent: they are read from the loaded manifest at draw time, because a hand
 * -copied count here would silently desync from the sheet the moment a row's
 * length changed.
 */
const ROWS: ReadonlyArray<RowSpec> = [
  { state: 'walk', fps: 10 },
  { state: 'idle', fps: 8 },
  { state: 'idle_break', fps: 14 },
  { state: 'attack_light', fps: 14 },
  { state: 'attack_heavy', fps: 14 },
  { state: 'flinch', fps: 12 },
];

/** How many frames a row actually holds, from the sheet the game loaded. */
function frameCountOf(weapon: GoblinArchetype, state: GoblinState): number {
  const def = getSpriteDefByKey(goblinSheetKey(weapon));
  return def?.states.get(state)?.frameCount ?? 1;
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
/** The floor mids a goblin actually stands on, from `scripts/tilegen/palette.ts`. */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 1 — cellar stone', color: '#8c8170' },
  { name: 'floor 1 — dressed stone', color: '#b09668' },
  { name: 'floor 2 — poured concrete', color: '#888e96' },
  { name: 'floor 3 — grass', color: '#637032' },
];

const BASE_TILE_SIZE = 32;
const MARGIN = 16;
const HEADER_HEIGHT = 68;
const ROW_LABEL_WIDTH = 96;
const CELL_PADDING = 10;
const LABEL_SIZE = 11;
const TITLE_SIZE = 16;
const BUTTON_HEIGHT = 26;
const BUTTON_WIDTH = 92;
const BUTTON_GAP = 8;
/** Gap between the title and the row of controls under it. */
const CONTROL_ROW_GAP = 8;
/** Where a cell's goblin stands, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.86;
/** Inset of a cell's own caption from its left edge. */
const CELL_TEXT_INSET = 4;
const FRAMES_PER_SECOND = 60;
/** Gore needs a map to settle onto; a small empty one is enough for a preview. */
const PREVIEW_MAP_SIZE = 24;

export class GoblinPreviewScene extends Scene {
  private readonly map = new GameMap({ mapSize: PREVIEW_MAP_SIZE });
  private readonly gore = new BodyPartGoreSystem(this.map);
  private readonly buttons: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    action?: () => void;
  }> = [];

  // Two, not four: at 4× five of the six rows start below the bottom of the screen.
  private zoomIndex = ZOOM_LEVELS.indexOf(ZOOM_DOUBLE);
  private speedIndex = SPEED_LEVELS.length - 1;
  private backdropIndex = 0;
  private paused = false;
  /** Fractional frame counter, so a 0.25× speed still advances. */
  private clock = 0;
  private stepRequested = false;

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
    this.buttons.length = 0;

    ctx.fillStyle = BACKDROPS[this.backdropIndex].color;
    ctx.fillRect(0, 0, width, height);

    this.renderHeader(ctx, width);

    const cell = this.cellSize();
    const gridLeft = MARGIN + ROW_LABEL_WIDTH;
    const gridTop = HEADER_HEIGHT + MARGIN;

    ARCHETYPES.forEach((weapon, column) => {
      const x = gridLeft + column * (cell.w + CELL_PADDING);
      drawText(ctx, weapon, {
        x: x + cell.w / 2,
        y: gridTop - LABEL_SIZE - 2,
        size: LABEL_SIZE,
        align: 'center',
        color: '#f4efe4',
        outline: true,
      });
    });

    ROWS.forEach((row, rowIndex) => {
      const y = gridTop + rowIndex * (cell.h + CELL_PADDING);
      const isAttack = row.state === 'attack_light' || row.state === 'attack_heavy';
      drawText(ctx, row.state, {
        x: MARGIN,
        y: y + cell.h / 2 - LABEL_SIZE,
        size: LABEL_SIZE,
        color: '#f4efe4',
        outline: true,
      });
      // Every archetype's rows are the same length, so one is enough to label.
      const frame = this.frameOf(row, ARCHETYPES[0]);
      drawText(ctx, `f${frame}`, {
        x: MARGIN,
        y: y + cell.h / 2 + 2,
        size: LABEL_SIZE,
        color: '#cfd8c4',
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

        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.strokeRect(x, y, cell.w, cell.h);

        // The impact frame is the contract between the art and `Goblin.ts`, so
        // it is marked: stepping to it is how the two get confirmed to agree.
        if (isAttack) {
          const kind = row.state === 'attack_light' ? 'light' : 'heavy';
          if (shown === peakFrameOf(weapon, kind)) {
            ctx.strokeStyle = '#ff8a5c';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, cell.w - 2, cell.h - 2);
            ctx.lineWidth = 1;
          }
          drawText(ctx, moveNameOf(weapon, kind), {
            x: x + CELL_TEXT_INSET,
            y: y + cell.h - LABEL_SIZE - 2,
            size: LABEL_SIZE,
            color: '#e8dfc8',
            outline: true,
          });
        }
      });
    });

    this.gore.renderSettled(ctx, 0, 0);
    this.gore.renderFlying(ctx, 0, 0);
  }

  private control(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    label: string,
    action: () => void,
  ): number {
    addButton(ctx, this.buttons, {
      ...BUTTON_PRESETS.toggle,
      x,
      y,
      width: BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
      label,
      action,
    });
    return x + BUTTON_WIDTH + BUTTON_GAP;
  }

  private renderHeader(ctx: CanvasRenderingContext2D, width: number): void {
    drawText(ctx, 'goblin preview — ?goblins', {
      x: MARGIN,
      y: MARGIN + TITLE_SIZE,
      size: TITLE_SIZE,
      color: '#fdfaf2',
      outline: true,
    });

    let x = MARGIN;
    const y = MARGIN + TITLE_SIZE + CONTROL_ROW_GAP;
    x = this.control(ctx, x, y, `zoom ${ZOOM_LEVELS[this.zoomIndex]}x`, () => {
      this.zoomIndex = (this.zoomIndex + 1) % ZOOM_LEVELS.length;
    });
    x = this.control(ctx, x, y, this.paused ? 'play' : 'pause', () => {
      this.paused = !this.paused;
    });
    x = this.control(ctx, x, y, 'step', () => {
      this.paused = true;
      this.stepRequested = true;
    });
    x = this.control(ctx, x, y, `speed ${SPEED_LEVELS[this.speedIndex]}x`, () => {
      this.speedIndex = (this.speedIndex + 1) % SPEED_LEVELS.length;
    });
    x = this.control(ctx, x, y, 'backdrop', () => {
      this.backdropIndex = (this.backdropIndex + 1) % BACKDROPS.length;
    });
    for (const weapon of ARCHETYPES) {
      x = this.control(ctx, x, y, `kill ${weapon}`, () => {
        this.kill(weapon);
      });
    }

    drawText(ctx, BACKDROPS[this.backdropIndex].name, {
      x: width - MARGIN,
      y: MARGIN + TITLE_SIZE,
      size: LABEL_SIZE,
      align: 'right',
      color: '#e6e0d2',
      outline: true,
    });
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

  handleMouseMove(mx: number, my: number): void {
    setButtonMouseState(mx, my);
  }

  handleClick(mx: number, my: number): void {
    for (const button of this.buttons) {
      const inside =
        mx >= button.x && mx <= button.x + button.w && my >= button.y && my <= button.y + button.h;
      if (!inside) continue;
      // This scene has no `AudioManager` of its own; the call is here so the
      // control path matches every other button in the game rather than
      // quietly diverging from it.
      playButtonSound(null);
      button.action?.();
      return;
    }
  }
}
