/**
 * Localhost-only harness for watching the three skeletons move.
 *
 * Reached via `?skeletons` in `devBootScene`; never on a production path. It
 * exists because stills genuinely cannot answer "does this look alive":
 * `scripts/render-skeletons.ts` can show that the ribs read and that a loop
 * closes, but only playback shows whether a bone figure walks with weight,
 * whether the grasping-hands wind-up gives the player enough warning in the time
 * they actually have, and whether the rise reads as climbing out of the ground
 * rather than as sliding up from behind something.
 *
 * Every row of the selected variant plays at once across the four facings, over
 * a backdrop that cycles the real floor palettes so the contrast check happens
 * against the ground they stand on. The bottom strip plays the encounter's own
 * effects, because the soul bolt, its burst, the bone arrow and the hands are as
 * much of this creature as its animation is. "kill" fires the real
 * `BodyPartGoreSystem`, which is the only way to check that bones tumble in
 * place rather than orbiting.
 */

import { Scene } from '../core/Scene';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import { GameMap } from '../map/GameMap';
import { BodyPartGoreSystem } from '../systems/BodyPartGoreSystem';
import {
  SKELETON_ARCHER_BODY_PART_KEY,
  SKELETON_LORD_BODY_PART_KEY,
  SKELETON_SWORD_BODY_PART_KEY,
  drawSkeletonArcherSprite,
  drawSkeletonLordSprite,
  drawSkeletonWarriorSprite,
} from '../sprites/skeletonSprite';
import {
  drawBoneArrow,
  drawGraspingHands,
  drawSoulBolt,
  drawSoulBurst,
} from '../sprites/skeletonEffectsSprite';
import { drawDangerCone } from '../sprites/dangerTelegraph';
import {
  BONE_ARROW_DRAW_FRAMES,
  SKELETON_RISE_FRAMES,
  SOUL_BOLT_CAST_FRAMES,
  SWORD_SLASH_FRAMES,
} from '../sprites/skeletonTiming';

/** A facing vector per column, chosen so each draw wrapper picks each viewpoint. */
interface ViewSpec {
  readonly label: string;
  readonly facingX: number;
  readonly facingY: number;
}

const VIEWS: ReadonlyArray<ViewSpec> = [
  { label: 'side →', facingX: 1, facingY: 0 },
  { label: 'side ←', facingX: -1, facingY: 0 },
  { label: 'toward', facingX: 0, facingY: 1 },
  { label: 'away', facingX: 0, facingY: -1 },
];

/** Which rows a variant has, and how long each one runs for. */
type RowKind = 'walk' | 'idle' | 'attack' | 'hands' | 'summon' | 'rise';

interface RowSpec {
  readonly kind: RowKind;
  readonly label: string;
  /** Frames the one-shot runs for; unused by the looping rows. */
  readonly shotFrames: number;
}

/** Frames the looping rows advance one cell in, at full speed. */
const WALK_LOOP_FRAMES = 48;
const IDLE_LOOP_FRAMES = 96;
/** The lord's grasping-hands wind-up, matching `SkeletonLord`'s own constant. */
const HANDS_WINDUP_FRAMES = 55;
const SUMMON_ANIM_FRAMES = 70;

const LORD_ROWS: ReadonlyArray<RowSpec> = [
  { kind: 'walk', label: 'walk', shotFrames: WALK_LOOP_FRAMES },
  { kind: 'idle', label: 'idle', shotFrames: IDLE_LOOP_FRAMES },
  { kind: 'attack', label: 'cast', shotFrames: SOUL_BOLT_CAST_FRAMES },
  { kind: 'hands', label: 'hands_cast', shotFrames: HANDS_WINDUP_FRAMES },
  { kind: 'summon', label: 'summon', shotFrames: SUMMON_ANIM_FRAMES },
];

const SWORD_ROWS: ReadonlyArray<RowSpec> = [
  { kind: 'walk', label: 'walk', shotFrames: WALK_LOOP_FRAMES },
  { kind: 'idle', label: 'idle', shotFrames: IDLE_LOOP_FRAMES },
  { kind: 'attack', label: 'slash', shotFrames: SWORD_SLASH_FRAMES },
  { kind: 'rise', label: 'rise', shotFrames: SKELETON_RISE_FRAMES },
];

const ARCHER_ROWS: ReadonlyArray<RowSpec> = [
  { kind: 'walk', label: 'walk', shotFrames: WALK_LOOP_FRAMES },
  { kind: 'idle', label: 'idle', shotFrames: IDLE_LOOP_FRAMES },
  { kind: 'attack', label: 'draw_loose', shotFrames: BONE_ARROW_DRAW_FRAMES },
  { kind: 'rise', label: 'rise', shotFrames: SKELETON_RISE_FRAMES },
];

type VariantId = 'lord' | 'sword' | 'archer';

interface VariantSpec {
  readonly id: VariantId;
  readonly label: string;
  readonly rows: ReadonlyArray<RowSpec>;
  readonly bodyPartKey: string;
  /** Tiles tall the art is, so the preview cells can hold it. */
  readonly heightTiles: number;
}

const VARIANTS: ReadonlyArray<VariantSpec> = [
  {
    id: 'lord',
    label: 'skeleton lord',
    rows: LORD_ROWS,
    bodyPartKey: SKELETON_LORD_BODY_PART_KEY,
    heightTiles: 2.5,
  },
  {
    id: 'sword',
    label: 'sword warrior',
    rows: SWORD_ROWS,
    bodyPartKey: SKELETON_SWORD_BODY_PART_KEY,
    heightTiles: 1.55,
  },
  {
    id: 'archer',
    label: 'bow warrior',
    rows: ARCHER_ROWS,
    bodyPartKey: SKELETON_ARCHER_BODY_PART_KEY,
    heightTiles: 1.5,
  },
];

/** 1× is what a player sees; 4× is where a rib gap becomes visible at all. */
const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_REVIEW = 4;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE, ZOOM_REVIEW];

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

/** The floor mids a skeleton actually stands on, from `scripts/tilegen/palette.ts`. */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 3 — grass', color: '#637032' },
  { name: 'floor 3 — dirt track', color: '#6b5638' },
  { name: 'floor 1 — cellar stone', color: '#8c8170' },
  { name: 'floor 2 — poured concrete', color: '#888e96' },
];

const BASE_TILE_SIZE = 32;
const MARGIN = 16;
const HEADER_HEIGHT = 68;
const ROW_LABEL_WIDTH = 96;
const CELL_PADDING = 8;
const LABEL_SIZE = 11;
const TITLE_SIZE = 16;
const BUTTON_HEIGHT = 26;
const BUTTON_WIDTH = 100;
const BUTTON_GAP = 8;
const CONTROL_ROW_GAP = 8;
/** How much wider than the figure a cell is, so a cast arm is not clipped. */
const CELL_WIDTH_TILES = 3;
/** Where a cell's skeleton stands, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.92;

/** Frames the effect strip's demos run before repeating. */
const BURST_DEMO_FRAMES = 22;
const HANDS_DEMO_FRAMES = 60;
/** The heading the demo bolt and arrow travel at — off-axis, so rotation shows. */
const PROJECTILE_DEMO_HEADING = 0.35;
/** Tiles between the effect demos, wide enough to clear a full burst. */
const EFFECT_DEMO_GAP_TILES = 3;
/** The cone demo's reach, matching `SkeletonLord`'s own grasping-hands range. */
const CONE_DEMO_RADIUS_TILES = 4;
const CONE_DEMO_HALF_ANGLE = 0.87;
/** Gore needs a map to settle onto; a small empty one is enough for a preview. */
const PREVIEW_MAP_SIZE = 24;
const KILL_IMPACT_X = 1;
const KILL_IMPACT_Y = -0.4;

export class SkeletonPreviewScene extends Scene {
  private readonly map = new GameMap({ mapSize: PREVIEW_MAP_SIZE });
  private readonly gore = new BodyPartGoreSystem(this.map);
  private readonly buttons: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    action?: () => void;
  }> = [];

  private variantIndex = 0;
  private zoomIndex = ZOOM_LEVELS.indexOf(ZOOM_DOUBLE);
  private speedIndex = SPEED_LEVELS.length - 1;
  private backdropIndex = 0;
  private paused = false;
  /** Fractional frame counter, so a 0.25× speed still advances. */
  private clock = 0;
  private stepRequested = false;

  private get variant(): VariantSpec {
    return VARIANTS[this.variantIndex];
  }

  update(): void {
    if (this.stepRequested) {
      this.clock += 1;
      this.stepRequested = false;
    } else if (!this.paused) {
      this.clock += SPEED_LEVELS[this.speedIndex];
    }
    this.gore.update();
  }

  /** How far through a one-shot row the preview is right now, 0 to 1. */
  private shotProgress(row: RowSpec): number {
    return (Math.floor(this.clock) % row.shotFrames) / row.shotFrames;
  }

  private cellSize(): { readonly w: number; readonly h: number } {
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    return {
      w: tile * CELL_WIDTH_TILES,
      h: tile * (this.variant.heightTiles + 1),
    };
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    this.buttons.length = 0;

    ctx.fillStyle = BACKDROPS[this.backdropIndex].color;
    ctx.fillRect(0, 0, width, viewportHeight());

    this.renderHeader(ctx, width);

    const cell = this.cellSize();
    const gridLeft = MARGIN + ROW_LABEL_WIDTH;
    const gridTop = HEADER_HEIGHT + MARGIN;
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];

    VIEWS.forEach((view, column) => {
      drawText(ctx, view.label, {
        x: gridLeft + column * (cell.w + CELL_PADDING) + cell.w / 2,
        y: gridTop - LABEL_SIZE - 2,
        size: LABEL_SIZE,
        align: 'center',
        color: '#f4efe4',
        outline: true,
      });
    });

    this.variant.rows.forEach((row, rowIndex) => {
      const y = gridTop + rowIndex * (cell.h + CELL_PADDING);
      drawText(ctx, row.label, {
        x: MARGIN,
        y: y + cell.h / 2,
        size: LABEL_SIZE,
        color: '#f4efe4',
        outline: true,
      });

      VIEWS.forEach((view, column) => {
        const x = gridLeft + column * (cell.w + CELL_PADDING);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell.w, cell.h);
        ctx.clip();
        const drawX = x + cell.w / 2 - tile / 2;
        const drawY = y + cell.h * GROUND_FRACTION - tile;
        // The cone is drawn under the figure for the same reason the game draws
        // it there: it is on the ground, and the boss stands on top of it.
        if (row.kind === 'hands') {
          drawDangerCone(
            ctx,
            drawX + tile / 2,
            drawY + tile / 2,
            tile * CONE_DEMO_RADIUS_TILES,
            Math.atan2(view.facingY, view.facingX),
            CONE_DEMO_HALF_ANGLE,
            this.shotProgress(row),
          );
        }
        this.drawFigure(ctx, row, view, drawX, drawY, tile);
        ctx.restore();

        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.strokeRect(x, y, cell.w, cell.h);
      });
    });

    this.renderEffectStrip(ctx, gridTop + this.variant.rows.length * (cell.h + CELL_PADDING), tile);

    this.gore.renderSettled(ctx, 0, 0);
    this.gore.renderFlying(ctx, 0, 0);
  }

  private drawFigure(
    ctx: CanvasRenderingContext2D,
    row: RowSpec,
    view: ViewSpec,
    x: number,
    y: number,
    tile: number,
  ): void {
    const motion = {
      walkFrame: ((this.clock / WALK_LOOP_FRAMES) % 1) * Math.PI * 2,
      isMoving: row.kind === 'walk',
      facingX: view.facingX,
      facingY: view.facingY,
    };
    const progress = this.shotProgress(row);

    if (this.variant.id === 'lord') {
      drawSkeletonLordSprite(ctx, x, y, tile, {
        ...motion,
        castProgress: row.kind === 'attack' ? progress : null,
        handsProgress: row.kind === 'hands' ? progress : null,
        summonProgress: row.kind === 'summon' ? progress : null,
      });
      return;
    }
    const warriorState = {
      ...motion,
      attackProgress: row.kind === 'attack' ? progress : null,
      riseProgress: row.kind === 'rise' ? progress : null,
    };
    if (this.variant.id === 'sword') {
      drawSkeletonWarriorSprite(ctx, x, y, tile, warriorState);
      return;
    }
    drawSkeletonArcherSprite(ctx, x, y, tile, warriorState);
  }

  /**
   * Fire the real gore system at the middle of the screen.
   *
   * Deliberately the real one rather than a mock: the question this answers is
   * whether a bone tumbles about its own centre or orbits it, and only the
   * runtime's own `drawSpriteRotatedCenter` path can answer that.
   */
  private kill(): void {
    this.gore.spawnParts(
      viewportWidth() / 2,
      viewportHeight() / 2,
      this.variant.bodyPartKey,
      BASE_TILE_SIZE,
      KILL_IMPACT_X,
      KILL_IMPACT_Y,
    );
  }

  /** The bolt, its burst, a bone arrow and one patch of grasping hands. */
  private renderEffectStrip(ctx: CanvasRenderingContext2D, top: number, tile: number): void {
    const y = top + tile;
    let x = MARGIN + ROW_LABEL_WIDTH + tile;

    drawText(ctx, 'effects', {
      x: MARGIN,
      y: y - LABEL_SIZE,
      size: LABEL_SIZE,
      color: '#f4efe4',
      outline: true,
    });

    drawSoulBolt(ctx, x, y, tile, this.clock);
    x += tile * EFFECT_DEMO_GAP_TILES;

    drawSoulBurst(
      ctx,
      x,
      y,
      tile,
      (Math.floor(this.clock) % BURST_DEMO_FRAMES) / BURST_DEMO_FRAMES,
    );
    x += tile * EFFECT_DEMO_GAP_TILES;

    drawBoneArrow(ctx, x, y, tile, PROJECTILE_DEMO_HEADING);
    x += tile * EFFECT_DEMO_GAP_TILES;

    drawGraspingHands(
      ctx,
      x,
      y,
      tile,
      (Math.floor(this.clock) % HANDS_DEMO_FRAMES) / HANDS_DEMO_FRAMES,
    );
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
    drawText(ctx, 'skeleton preview — ?skeletons', {
      x: MARGIN,
      y: MARGIN + TITLE_SIZE,
      size: TITLE_SIZE,
      color: '#fdfaf2',
      outline: true,
    });

    let x = MARGIN;
    const y = MARGIN + TITLE_SIZE + CONTROL_ROW_GAP;
    x = this.control(ctx, x, y, this.variant.label, () => {
      this.variantIndex = (this.variantIndex + 1) % VARIANTS.length;
    });
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
    this.control(ctx, x, y, 'kill', () => {
      this.kill();
    });

    drawText(ctx, BACKDROPS[this.backdropIndex].name, {
      x: width - MARGIN,
      y: MARGIN + TITLE_SIZE,
      size: LABEL_SIZE,
      align: 'right',
      color: '#e6e0d2',
      outline: true,
    });
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
      // control path matches every other button in the game rather than quietly
      // diverging from it.
      playButtonSound(null);
      button.action?.();
      return;
    }
  }
}
