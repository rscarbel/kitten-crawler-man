/**
 * Localhost-only harness for judging status-effect visuals.
 *
 * Reached via `?status` in `devBootScene`; never on a production path.
 *
 * A status effect cannot be reviewed from a still. Fire that reads as fire, silk
 * that reads as taut, arcs that read as arcs — all of them are motion, and all of
 * them are also *contrast*: the same flame that looks convincing on a dark
 * dungeon floor can vanish over lava, and the poison tint that reads as sickly
 * over stone can read as camouflage over grass. So every effect plays at once,
 * on the real figure, over a backdrop that cycles through the palettes the game
 * actually stands characters on.
 *
 * The grid runs the production path — `drawWithSilhouetteLayers` fed by
 * `statusBodyLayers`, then the registry's overlay — rather than a
 * reimplementation of it, because a harness that draws the effect a second way
 * can only ever prove that the second way works.
 */

import { TILE_SIZE } from '../core/constants';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { worldText } from '../ui/world/worldText';
import { PreviewScene, type PreviewControl } from './PreviewScene';
import { drawWithSilhouetteLayers } from '../core/silhouetteComposite';
import { drawHumanSprite, prewarmHumanSprite } from '../sprites/humanSprite';
import { HUMAN_STATUS_FIGURE_BOX } from '../creatures/HumanPlayer';
import { PLAYER_HIT_FLASH_MARGIN_TILES } from '../Player';
import type { StatusEffect } from '../core/StatusEffect';
import {
  statusBadge,
  statusBodyLayers,
  statusFade,
  statusVisual,
  type StatusVisualFrame,
} from '../sprites/status/statusEffectVisuals';
import { previewInk } from '../ui/theme/previewInk';

/** Every status the registry knows, in the order they are worth comparing. */
const PREVIEW_STATUSES: readonly string[] = [
  'burn',
  'magic_burn',
  'poison',
  'sepsis',
  'spit_venom',
  'stuck',
  'stun',
  'electrified',
  'speed_fizz',
  'jugg_juice',
  'cooldown_crisp',
  'whetstone',
  'drunk',
  'well_rested',
  'hearth_warmed',
  'deep_slumber',
  'hamburger_fed',
  'shield',
  'chilled',
  'frozen',
  'fairy_ward',
  'fairy_aegis',
  'overheal',
];

/** The grounds a character is actually seen standing on, worst contrast first. */
interface Backdrop {
  readonly label: string;
  readonly color: string;
}

const BACKDROPS: readonly Backdrop[] = [
  { label: 'dungeon stone', color: previewInk.status.dungeonStone },
  { label: 'dark corridor', color: previewInk.status.darkCorridor },
  { label: 'grass', color: previewInk.status.grass },
  { label: 'sand', color: previewInk.status.sand },
  { label: 'snow', color: previewInk.status.snow },
  { label: 'lava rock', color: previewInk.status.lavaRock },
];

/** In-game size first: that is the one the judgement has to be made at. */
const ZOOM_IN_GAME = 1;
const ZOOM_REVIEW = 2;
const ZOOM_DETAIL = 3;
const ZOOMS: readonly number[] = [ZOOM_IN_GAME, ZOOM_REVIEW, ZOOM_DETAIL];

const COLUMNS = 6;
const CELL_W = 150;
const CELL_H = 170;
/** Gap between the header and the grid. */
const GRID_GAP = 20;
const GRID_LEFT = 40;
/** Where in a cell the figure's feet sit, leaving room for rising art above. */
const CELL_FOOT_FRACTION = 0.74;

const PANEL_BG = previewInk.status.panel;
const LABEL_COLOR = previewInk.status.label;
const LABEL_SIZE = 13;
const HINT_SIZE = 12;

/** Walk cycle advance per frame while the "walking" toggle is on. */
const WALK_FRAME_SPEED = 0.14;

/**
 * How long an effect is pretended to have left. Held at full so the fade-out
 * ramp does not quietly dim everything under review; the expiry ramp is checked
 * with the "expiring" toggle instead.
 */
const FULL_DURATION_TICKS = 600;
const EXPIRING_TICKS = 12;

const HINT_Y_OFFSET = 22;

export class StatusPreviewScene extends PreviewScene {
  private frame = 0;
  private zoomIndex = 0;
  private backdropIndex = 0;
  private walking = false;
  private expiring = false;

  // Carl is the whole subject of this scene and there is no player object to
  // have warmed his rows, so the scene warms them itself.
  override onEnter(): void {
    prewarmHumanSprite();
  }

  update(): void {
    this.frame++;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const backdrop = BACKDROPS[this.backdropIndex];
    const zoom = ZOOMS[this.zoomIndex];

    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, 0, viewportWidth(), viewportHeight());

    this.drawGrid(ctx, backdrop, zoom);
    this.renderChrome(ctx);
  }

  protected previewTitle(): string {
    return 'Status effect visuals — ?status';
  }

  protected previewControls(): readonly PreviewControl[] {
    return [
      {
        id: 'zoom',
        label: `zoom ${ZOOMS[this.zoomIndex]}x`,
        onTap: () => {
          this.zoomIndex = (this.zoomIndex + 1) % ZOOMS.length;
        },
      },
      {
        id: 'backdrop',
        label: BACKDROPS[this.backdropIndex].label,
        onTap: () => {
          this.backdropIndex = (this.backdropIndex + 1) % BACKDROPS.length;
        },
      },
      {
        id: 'walking',
        label: this.walking ? 'walking' : 'standing',
        onTap: () => {
          this.walking = !this.walking;
        },
      },
      {
        id: 'expiring',
        label: this.expiring ? 'expiring' : 'full',
        onTap: () => {
          this.expiring = !this.expiring;
        },
      },
    ];
  }

  private drawGrid(ctx: CanvasRenderingContext2D, backdrop: Backdrop, zoom: number): void {
    const size = TILE_SIZE * zoom;
    const cellW = CELL_W * zoom;
    const cellH = CELL_H * zoom;
    const gridTop = this.headerBottom + GRID_GAP;

    for (let i = 0; i < PREVIEW_STATUSES.length; i++) {
      const type = PREVIEW_STATUSES[i];
      const column = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);
      const cellX = GRID_LEFT + column * cellW;
      const cellY = gridTop + row * cellH;

      ctx.fillStyle = backdrop.color;
      ctx.fillRect(cellX, cellY, cellW - 1, cellH - 1);

      const footY = cellY + cellH * CELL_FOOT_FRACTION;
      const left = cellX + (cellW - size) / 2;
      const top = footY - size;

      this.drawSubject(ctx, type, left, top, size);

      const badge = statusBadge(type);
      worldText(ctx, `${badge.label}  ${type}`, {
        x: cellX + cellW / 2,
        y: cellY + cellH - HINT_Y_OFFSET,
        size: LABEL_SIZE,
        align: 'center',
        color: badge.color,
        outline: true,
      });
    }

    worldText(ctx, 'click a control to cycle it — every cell runs the production draw path', {
      x: GRID_LEFT,
      y: gridTop + Math.ceil(PREVIEW_STATUSES.length / COLUMNS) * cellH + HINT_Y_OFFSET,
      size: HINT_SIZE,
      color: LABEL_COLOR,
    });
  }

  private drawSubject(
    ctx: CanvasRenderingContext2D,
    type: string,
    left: number,
    top: number,
    size: number,
  ): void {
    const ticks = this.expiring ? EXPIRING_TICKS : FULL_DURATION_TICKS;
    const effect: StatusEffect = {
      type,
      ticksRemaining: ticks,
      totalTicks: FULL_DURATION_TICKS,
      // Nobody inflicted this one — it is a swatch in a review harness, and
      // there is no kill for it to be credited to.
      applier: null,
    };
    const frame: StatusVisualFrame = {
      centerX: left + size * HUMAN_STATUS_FIGURE_BOX.centerX,
      footY: top + size * HUMAN_STATUS_FIGURE_BOX.bottom,
      width: size * HUMAN_STATUS_FIGURE_BOX.halfWidth * 2,
      height: size * (HUMAN_STATUS_FIGURE_BOX.bottom - HUMAN_STATUS_FIGURE_BOX.top),
      tileSize: size,
      timeMs: performance.now(),
      // Seeded off the status so every cell has its own particle scatter, the
      // way twelve different creatures would.
      seed: type.length * PREVIEW_STATUSES.indexOf(type) + 1,
      fade: statusFade(effect),
      moving: this.walking,
      facingX: 1,
      facingY: 0,
    };

    const drawFigure = (target: CanvasRenderingContext2D) => {
      drawHumanSprite(target, left, top, size, {
        attackPhase: null,
        attackTimer: 0,
        attackFrames: 1,
        walkFrame: this.walking ? this.frame * WALK_FRAME_SPEED : 0,
        isMoving: this.walking,
        facingX: 1,
        facingY: 0,
      });
    };

    // Same two steps, in the same order, with the same box as `Player.render`:
    // body coats through the silhouette, then the world overlay *outside* the
    // composite. Drawing the overlay inside would give this harness a different
    // picture from the game, which is the one thing it must not do.
    const layers = statusBodyLayers([effect], () => frame);
    const margin = PLAYER_HIT_FLASH_MARGIN_TILES * size;
    drawWithSilhouetteLayers(
      ctx,
      { x: left - margin, y: top - margin, width: size + margin * 2, height: size + margin * 2 },
      layers,
      drawFigure,
    );

    const overlay = statusVisual(type)?.overlay;
    if (overlay !== undefined) {
      ctx.save();
      overlay(ctx, frame, effect);
      ctx.restore();
    }
  }
}
