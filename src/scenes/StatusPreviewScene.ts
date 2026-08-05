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

import { Scene } from '../core/Scene';
import { TILE_SIZE } from '../core/constants';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import { drawWithSilhouetteLayers } from '../core/silhouetteComposite';
import { drawHumanSprite } from '../sprites/humanSprite';
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
];

/** The grounds a character is actually seen standing on, worst contrast first. */
interface Backdrop {
  readonly label: string;
  readonly color: string;
}

const BACKDROPS: readonly Backdrop[] = [
  { label: 'dungeon stone', color: '#3a3630' },
  { label: 'dark corridor', color: '#191b21' },
  { label: 'grass', color: '#3f5b32' },
  { label: 'sand', color: '#b7a173' },
  { label: 'snow', color: '#d9e2ea' },
  { label: 'lava rock', color: '#5c2317' },
];

/** In-game size first: that is the one the judgement has to be made at. */
const ZOOM_IN_GAME = 1;
const ZOOM_REVIEW = 2;
const ZOOM_DETAIL = 3;
const ZOOMS: readonly number[] = [ZOOM_IN_GAME, ZOOM_REVIEW, ZOOM_DETAIL];

const COLUMNS = 4;
const CELL_W = 150;
const CELL_H = 170;
const GRID_TOP = 96;
const GRID_LEFT = 40;
/** Where in a cell the figure's feet sit, leaving room for rising art above. */
const CELL_FOOT_FRACTION = 0.74;

const PANEL_BG = '#14161c';
const LABEL_COLOR = '#d6dde8';
const TITLE_SIZE = 20;
const LABEL_SIZE = 13;
const HINT_SIZE = 12;

const BUTTON_Y = 46;
const BUTTON_H = 30;
const BUTTON_W = 128;
const BUTTON_GAP = 10;
const BUTTON_LEFT = 40;

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

export class StatusPreviewScene extends Scene {
  private frame = 0;
  private zoomIndex = 0;
  private backdropIndex = 0;
  private walking = false;
  private expiring = false;
  private buttons: { x: number; y: number; w: number; h: number; action?: () => void }[] = [];

  update(): void {
    this.frame++;
  }

  handleMouseMove(mx: number, my: number): void {
    setButtonMouseState(mx, my);
  }

  handleClick(mx: number, my: number): void {
    for (const button of this.buttons) {
      const inside =
        mx >= button.x && mx <= button.x + button.w && my >= button.y && my <= button.y + button.h;
      if (inside && button.action !== undefined) {
        playButtonSound(null);
        button.action();
        return;
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const backdrop = BACKDROPS[this.backdropIndex];
    const zoom = ZOOMS[this.zoomIndex];

    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, 0, viewportWidth(), viewportHeight());

    drawText(ctx, 'Status effect visuals', {
      x: GRID_LEFT,
      y: 30,
      size: TITLE_SIZE,
      bold: true,
      color: LABEL_COLOR,
    });

    this.drawControls(ctx, backdrop, zoom);
    this.drawGrid(ctx, backdrop, zoom);
  }

  private drawControls(ctx: CanvasRenderingContext2D, backdrop: Backdrop, zoom: number): void {
    this.buttons = [];
    const controls: readonly { label: string; action: () => void }[] = [
      {
        label: `zoom ${zoom}x`,
        action: () => (this.zoomIndex = (this.zoomIndex + 1) % ZOOMS.length),
      },
      {
        label: backdrop.label,
        action: () => (this.backdropIndex = (this.backdropIndex + 1) % BACKDROPS.length),
      },
      {
        label: this.walking ? 'walking' : 'standing',
        action: () => (this.walking = !this.walking),
      },
      {
        label: this.expiring ? 'expiring' : 'full',
        action: () => (this.expiring = !this.expiring),
      },
    ];

    let x = BUTTON_LEFT;
    for (const control of controls) {
      addButton(ctx, this.buttons, {
        ...BUTTON_PRESETS.toggle,
        x,
        y: BUTTON_Y,
        width: BUTTON_W,
        height: BUTTON_H,
        label: control.label,
        action: control.action,
      });
      x += BUTTON_W + BUTTON_GAP;
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D, backdrop: Backdrop, zoom: number): void {
    const size = TILE_SIZE * zoom;
    const cellW = CELL_W * zoom;
    const cellH = CELL_H * zoom;

    for (let i = 0; i < PREVIEW_STATUSES.length; i++) {
      const type = PREVIEW_STATUSES[i];
      const column = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);
      const cellX = GRID_LEFT + column * cellW;
      const cellY = GRID_TOP + row * cellH;

      ctx.fillStyle = backdrop.color;
      ctx.fillRect(cellX, cellY, cellW - 1, cellH - 1);

      const footY = cellY + cellH * CELL_FOOT_FRACTION;
      const left = cellX + (cellW - size) / 2;
      const top = footY - size;

      this.drawSubject(ctx, type, left, top, size);

      const badge = statusBadge(type);
      drawText(ctx, `${badge.label}  ${type}`, {
        x: cellX + cellW / 2,
        y: cellY + cellH - HINT_Y_OFFSET,
        size: LABEL_SIZE,
        align: 'center',
        color: badge.color,
        outline: true,
      });
    }

    drawText(ctx, 'click a control to cycle it — every cell runs the production draw path', {
      x: GRID_LEFT,
      y: GRID_TOP + Math.ceil(PREVIEW_STATUSES.length / COLUMNS) * cellH + HINT_Y_OFFSET,
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
        smushTimer: 0,
        smushFrames: 1,
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
      overlay(ctx, frame);
      ctx.restore();
    }
  }
}
