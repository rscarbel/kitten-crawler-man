import { TILE_SIZE } from '../core/constants';
import { viewportHeight, viewportWidth } from '../core/Viewport';
import type { Player } from '../Player';
import {
  HIRELING_REVIVE_WINDOW_FRAMES,
  type HirelingSurvival,
} from '../creatures/mercenaries/hirelingSurvival';
import {
  drawRevivingBar,
  knockoutCountdownColor,
  knockoutPulse,
  knockoutSecondsLeft,
  REVIVE_ARROW_COLOR,
} from '../systems/KnockoutRevive';
import { drawText, TEXT_PRESETS } from './TextBox';
import { drawArrowAbovePlayer, type ArrowAvoidRect } from './WorldArrow';

/**
 * The world-space half of a downed hireling's UI: a countdown over the body and
 * the revive bar under it, drawn with the crawler knockout's own pulse, colours
 * and bar so both revives read as one mechanic. The screen-space half is the
 * arrow from the active crawler, for a body out of sight.
 */

/** Height of the countdown pill's centre above the body's tile, in tiles. */
const COUNTDOWN_LIFT_TILES = 1.15;
const COUNTDOWN_TEXT_SIZE = 12;
const COUNTDOWN_PADDING = 3;
const COUNTDOWN_BACKGROUND = 'rgba(15, 10, 10, 0.78)';
const COUNTDOWN_BORDER_WIDTH = 1;
/** Below the body, clear of the knockout ring drawn over it. */
const REVIVE_BAR_DROP_TILES = 1.1;
/** Wide enough for its label at world scale, narrow enough to sit under one body. */
const REVIVE_BAR_WIDTH_PX = 84;
const CENTER_OFFSET = 0.5;

/** A body the downed UI can be drawn for. */
export interface DownedBody {
  readonly x: number;
  readonly y: number;
  readonly displayName: string;
  readonly survival: HirelingSurvival;
}

/** Countdown over the body, and the revive bar under it once someone is reviving. */
export function renderHirelingDownedMarker(
  ctx: CanvasRenderingContext2D,
  body: DownedBody,
  camX: number,
  camY: number,
): void {
  const { survival } = body;
  if (!survival.downed) return;
  const centerX = body.x - camX + TILE_SIZE * CENTER_OFFSET;
  const tileTop = body.y - camY;
  const spentFrames = HIRELING_REVIVE_WINDOW_FRAMES - survival.reviveWindowLeft;
  const secondsLeft = knockoutSecondsLeft(HIRELING_REVIVE_WINDOW_FRAMES, spentFrames);
  const color = knockoutCountdownColor(secondsLeft);
  // Held steady while someone is reviving, because the clock is too: a pulse
  // there would read as time running out.
  const reviving = survival.reviveProgress > 0;

  drawText(ctx, `${body.displayName}  ${secondsLeft}s`, {
    ...TEXT_PRESETS.danger,
    x: centerX,
    y: tileTop - TILE_SIZE * COUNTDOWN_LIFT_TILES,
    align: 'center',
    size: COUNTDOWN_TEXT_SIZE,
    color,
    outline: true,
    alpha: reviving ? 1 : knockoutPulse(),
    padding: COUNTDOWN_PADDING,
    background: COUNTDOWN_BACKGROUND,
    border: color,
    borderWidth: COUNTDOWN_BORDER_WIDTH,
  });

  if (reviving) {
    drawRevivingBar(
      ctx,
      centerX,
      tileTop + TILE_SIZE * REVIVE_BAR_DROP_TILES,
      survival.reviveFraction,
      REVIVE_BAR_WIDTH_PX,
    );
  }
}

/**
 * The knockout's revive arrow over the active crawler, pointing at a downed
 * hireling the player cannot see: off the screen, or out past the fog's
 * reach, where the body is drawn but painted over.
 */
export function renderHirelingDownedArrow(
  ctx: CanvasRenderingContext2D,
  body: DownedBody,
  active: Player,
  camX: number,
  camY: number,
  visibleRadiusPx: number,
  avoidRect?: ArrowAvoidRect,
): void {
  if (!body.survival.downed) return;
  const bodyCenterX = body.x + TILE_SIZE * CENTER_OFFSET;
  const bodyCenterY = body.y + TILE_SIZE * CENTER_OFFSET;
  const screenX = bodyCenterX - camX;
  const screenY = bodyCenterY - camY;
  const insideViewport =
    screenX >= 0 && screenY >= 0 && screenX <= viewportWidth() && screenY <= viewportHeight();
  const distanceFromActive = Math.hypot(body.x - active.x, body.y - active.y);
  if (insideViewport && distanceFromActive <= visibleRadiusPx) return;
  drawArrowAbovePlayer(
    ctx,
    active.x,
    active.y,
    bodyCenterX,
    bodyCenterY,
    camX,
    camY,
    REVIVE_ARROW_COLOR,
    { avoidRect },
  );
}
