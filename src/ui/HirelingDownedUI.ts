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
import { inset, type Rect } from './core/geom';
import { chromeTarget } from './screens/dialogs/canvasChrome';
import { skinsFor } from './theme/skins';
import { drawGlass } from './widgets/paint';
import { measureText, text } from './widgets/text';
import {
  ARROW_PRIORITY,
  drawArrowAbovePlayer,
  isWorldPointOnScreen,
  type ArrowCandidate,
} from './WorldArrow';

/**
 * The world-space half of a downed hireling's UI: a countdown over the body and
 * the revive bar under it, drawn with the crawler knockout's own pulse, colours
 * and bar so both revives read as one mechanic. The screen-space half is the
 * arrow from the active crawler, for a body out of sight.
 */

/** Height of the countdown pill's centre above the body's tile, in tiles. */
const COUNTDOWN_LIFT_TILES = 1.15;
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

  drawCountdownPill(
    ctx,
    centerX,
    tileTop - TILE_SIZE * COUNTDOWN_LIFT_TILES,
    `${body.displayName}  ${secondsLeft}s`,
    color,
    reviving ? 1 : knockoutPulse(),
  );

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

/** A glass pill centred on (`centerX`, `centerY`), edged and lettered in the countdown's colour. */
function drawCountdownPill(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  content: string,
  color: string,
  alpha: number,
): void {
  const target = chromeTarget(ctx);
  const { space, type } = target.theme;
  const style = type.label;
  const textWidth = Math.ceil(measureText(target, content, { style, tabular: true }));
  const width = textWidth + space.sm * 2;
  const height = style.lineHeight + space.xs * 2;
  const pill: Rect = {
    x: Math.round(centerX - width / 2),
    y: Math.round(centerY - height / 2),
    w: width,
    h: height,
  };
  const skin = skinsFor(target.theme).panel.hud;
  ctx.save();
  ctx.globalAlpha *= alpha;
  drawGlass(target, pill, { ...skin, border: color }, target.theme.radius.pill);
  text(target, inset(pill, { l: space.sm, r: space.sm }), {
    text: content,
    style,
    color,
    align: 'center',
    tabular: true,
  });
  ctx.restore();
}

/**
 * The knockout's revive arrow over the active crawler, pointing at a downed
 * hireling the player cannot see: off the screen, or out past the fog's
 * reach, where the body is drawn but painted over. Returned as a candidate
 * for the shared arrow arbiter rather than drawn directly, so it never
 * appears alongside a downed crawler's own arrow.
 */
export function hirelingDownedArrowCandidate(
  ctx: CanvasRenderingContext2D,
  body: DownedBody,
  active: Player,
  camX: number,
  camY: number,
  visibleRadiusPx: number,
  avoidRect?: Rect,
): ArrowCandidate | null {
  if (!body.survival.downed) return null;
  const bodyCenterX = body.x + TILE_SIZE * CENTER_OFFSET;
  const bodyCenterY = body.y + TILE_SIZE * CENTER_OFFSET;
  const insideViewport = isWorldPointOnScreen(
    bodyCenterX,
    bodyCenterY,
    camX,
    camY,
    viewportWidth(),
    viewportHeight(),
    0,
  );
  const distanceFromActive = Math.hypot(body.x - active.x, body.y - active.y);
  if (insideViewport && distanceFromActive <= visibleRadiusPx) return null;
  return {
    priority: ARROW_PRIORITY.DOWNED_COMPANION,
    draw: () =>
      drawArrowAbovePlayer(
        ctx,
        active.x,
        active.y,
        bodyCenterX,
        bodyCenterY,
        camX,
        camY,
        REVIVE_ARROW_COLOR,
        {
          avoidRect,
        },
      ),
  };
}
