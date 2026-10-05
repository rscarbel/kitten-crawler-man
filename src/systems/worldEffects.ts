/**
 * What the scene paints over the world itself rather than as chrome: the
 * red vignette of low health, the level-up and stat-boost fanfares over a
 * crawler, and the hover card naming whatever the mouse is over.
 */

import { TILE_SIZE } from '../core/constants';
import { STAT_BOOST_FLASH_FRAMES, type Player, type StatName } from '../Player';
import { drawEmbermote, drawGlow, rgba } from '../sprites/status/statusPaint';
import { STAT_BOOST_COLOR, STAT_BOOST_MOTE_HEAT } from '../sprites/statBoostColors';
import {
  LEVEL_UP_FLASH_COLOR,
  VIGNETTE_CENTER_COLOR,
  VIGNETTE_EDGE_COLOR,
} from '../sprites/worldEffectColors';
import type { Mob } from '../creatures/Mob';
import type { Villager } from './briarHollow/Villager';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { PlayerManager } from '../core/PlayerManager';
import { worldText } from '../ui/world/worldText';
import { inset, type Rect } from '../ui/core/geom';
import { paintEntityTooltip, type EntityTooltipContent } from '../ui/hud/entityTooltip';
import { chromeTarget, chromeTheme } from '../ui/screens/dialogs/canvasChrome';
import { viewportWidth, viewportHeight } from '../core/Viewport';

const VIGNETTE_HEALTH_THRESHOLD = 0.25;
const CRITICAL_HEALTH_THRESHOLD = 0.1;
const LOW_HEALTH_THRESHOLD = 0.1;
const LOW_HEALTH_OPACITY_BASE = 0.3;
const LOW_HEALTH_OPACITY_WAVE = 0.45;
const MEDIUM_HEALTH_OPACITY_BASE = 0.1;
const MEDIUM_HEALTH_OPACITY_WAVE = 0.25;
const HEALTH_RATIO_RANGE = 0.15;
const HEALTH_WAVE_PERIOD = 120;
const HEALTH_WAVE_OFFSET = 0.5;
const HEALTH_WAVE_AMPLITUDE = 0.5;

// Vignette gradient radii
const VIGNETTE_INNER_RADIUS_MULT = 0.25;
const VIGNETTE_OUTER_RADIUS_MULT = 0.85;

let cachedVignette: CanvasGradient | null = null;
let cachedVignetteWidth = 0;
let cachedVignetteHeight = 0;

const LEVEL_UP_FLASH_DURATION = 120;
const LEVEL_UP_RISE_DISTANCE = 28;
const LEVEL_UP_Y_OFFSET = 12;
const LEVEL_UP_TEXT_SIZE = 13;
const LEVEL_UP_TEXT_Y_RISE = 10;

// Stat-boost potion fanfare
const STAT_BOOST_Y_OFFSET = 46;
const STAT_BOOST_TEXT_SIZE = 30;
/** First half of the punch ramps up past 1x, second half settles back to it. */
const STAT_BOOST_PUNCH_FRAMES = 16;
const STAT_BOOST_PUNCH_START_SCALE = 0.4;
const STAT_BOOST_PUNCH_OVERSHOOT_SCALE = 1.3;
const STAT_BOOST_FADE_START_FRACTION = 0.55;
const STAT_BOOST_BURST_FRAMES = 20;
const STAT_BOOST_BURST_MAX_RADIUS = 64;
const STAT_BOOST_BURST_ALPHA = 0.5;
const STAT_BOOST_MOTE_COUNT = 8;
const STAT_BOOST_MOTE_RISE_PX = 44;
const STAT_BOOST_MOTE_RADIUS = 4;
const STAT_BOOST_MOTE_SPREAD_PX = 24;
/** Spaces each mote's lateral lane apart around the circle of `sin`, so the motes don't line up in a single column. */
const STAT_BOOST_MOTE_LANE_SPACING = 2.4;
const STAT_BOOST_MOTE_ALPHA = 0.85;

/** Full stat names, for the potion fanfare's "+1 STRENGTH" wording. */
const STAT_FULL_NAME: Record<StatName, string> = {
  strength: 'STRENGTH',
  intelligence: 'INTELLIGENCE',
  constitution: 'CONSTITUTION',
  dexterity: 'DEXTERITY',
};

/**
 * Scale of the reward text through its entrance: grows past full size, then
 * eases back down to it, which is what makes the pop read as a punch rather
 * than a plain fade-in.
 */
function statBoostPunchScale(elapsedFrames: number): number {
  if (elapsedFrames >= STAT_BOOST_PUNCH_FRAMES) return 1;
  const half = STAT_BOOST_PUNCH_FRAMES / 2;
  if (elapsedFrames < half) {
    const t = elapsedFrames / half;
    return (
      STAT_BOOST_PUNCH_START_SCALE +
      (STAT_BOOST_PUNCH_OVERSHOOT_SCALE - STAT_BOOST_PUNCH_START_SCALE) * t
    );
  }
  const t = (elapsedFrames - half) / half;
  return STAT_BOOST_PUNCH_OVERSHOOT_SCALE + (1 - STAT_BOOST_PUNCH_OVERSHOOT_SCALE) * t;
}

/** How far a cursor can sit from a villager's tile origin and still count as hovering it — matches the mob hit-test radius. */
const TOOLTIP_HOVER_RADIUS = TILE_SIZE * Math.SQRT2;

export function renderHealthVignette(
  ctx: CanvasRenderingContext2D,
  activePlayer: Player,
  gameOver: boolean,
): void {
  if (gameOver) return;
  const ratio = activePlayer.hp / activePlayer.maxHp;
  if (ratio >= VIGNETTE_HEALTH_THRESHOLD) return;

  const cw = viewportWidth();
  const ch = viewportHeight();

  let alpha: number;
  if (ratio < CRITICAL_HEALTH_THRESHOLD) {
    alpha =
      LOW_HEALTH_OPACITY_BASE +
      LOW_HEALTH_OPACITY_WAVE *
        (HEALTH_WAVE_OFFSET + HEALTH_WAVE_AMPLITUDE * Math.sin(Date.now() / HEALTH_WAVE_PERIOD));
  } else {
    alpha =
      MEDIUM_HEALTH_OPACITY_BASE +
      MEDIUM_HEALTH_OPACITY_WAVE * (1 - (ratio - LOW_HEALTH_THRESHOLD) / HEALTH_RATIO_RANGE);
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = vignetteGradient(ctx, cw, ch);
  ctx.fillRect(0, 0, cw, ch);
  ctx.restore();
}

/**
 * The vignette covers the whole screen and is rebuilt only when the viewport
 * changes size: its shape is fixed and only its opacity varies, which
 * `globalAlpha` carries. Rebuilding it per frame meant allocating a
 * screen-sized gradient on every frame the player was hurt.
 */
function vignetteGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): CanvasGradient {
  if (cachedVignette !== null && cachedVignetteWidth === width && cachedVignetteHeight === height) {
    return cachedVignette;
  }
  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * VIGNETTE_INNER_RADIUS_MULT,
    width / 2,
    height / 2,
    Math.max(width, height) * VIGNETTE_OUTER_RADIUS_MULT,
  );
  gradient.addColorStop(0, VIGNETTE_CENTER_COLOR);
  gradient.addColorStop(1, VIGNETTE_EDGE_COLOR);
  cachedVignette = gradient;
  cachedVignetteWidth = width;
  cachedVignetteHeight = height;
  return gradient;
}

export function renderLevelUpFlash(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  pm: PlayerManager,
): void {
  for (const p of pm.players()) {
    if (p.levelUpFlash <= 0 || !p.levelUpStat) continue;
    const alpha = p.levelUpFlash / LEVEL_UP_FLASH_DURATION;
    const rise = (1 - alpha) * LEVEL_UP_RISE_DISTANCE;
    const sx = p.x - camX + TILE_SIZE / 2;
    const sy = p.y - camY - LEVEL_UP_Y_OFFSET - rise;
    worldText(ctx, `LEVEL UP! +${p.levelUpStat}`, {
      x: sx,
      y: sy - LEVEL_UP_TEXT_Y_RISE,
      size: LEVEL_UP_TEXT_SIZE,
      bold: true,
      color: LEVEL_UP_FLASH_COLOR,
      alpha,
      align: 'center',
    });
  }
}

/**
 * The stat-boost potion's own fanfare: a large centred "+N STATNAME" with a
 * scale-punch entrance, a stat-coloured radial burst and rising motes. Kept
 * entirely separate from {@link renderLevelUpFlash} so a potion never reads as
 * a level-up.
 */
export function renderStatBoostFlash(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  pm: PlayerManager,
): void {
  for (const p of pm.players()) {
    if (p.statBoostFlashFrame <= 0 || p.statBoostFlashStat === null) continue;
    const stat = p.statBoostFlashStat;
    const elapsed = STAT_BOOST_FLASH_FRAMES - p.statBoostFlashFrame;
    const progress = elapsed / STAT_BOOST_FLASH_FRAMES;
    const alpha =
      progress < STAT_BOOST_FADE_START_FRACTION
        ? 1
        : Math.max(
            0,
            1 - (progress - STAT_BOOST_FADE_START_FRACTION) / (1 - STAT_BOOST_FADE_START_FRACTION),
          );
    if (alpha <= 0) continue;

    const color = STAT_BOOST_COLOR[stat];
    const cx = p.x - camX + TILE_SIZE / 2;
    const cy = p.y - camY - STAT_BOOST_Y_OFFSET;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (elapsed < STAT_BOOST_BURST_FRAMES) {
      const burstT = elapsed / STAT_BOOST_BURST_FRAMES;
      drawGlow(
        ctx,
        color,
        cx,
        cy,
        STAT_BOOST_BURST_MAX_RADIUS * burstT,
        STAT_BOOST_BURST_ALPHA * (1 - burstT) * alpha,
      );
    }

    for (let i = 0; i < STAT_BOOST_MOTE_COUNT; i++) {
      const stagger = i / STAT_BOOST_MOTE_COUNT;
      const phase = (progress + stagger) % 1;
      const moteAlpha = Math.sin(phase * Math.PI) * STAT_BOOST_MOTE_ALPHA * alpha;
      if (moteAlpha <= 0) continue;
      const lane = Math.sin(i * STAT_BOOST_MOTE_LANE_SPACING) * STAT_BOOST_MOTE_SPREAD_PX;
      drawEmbermote(
        ctx,
        color,
        STAT_BOOST_MOTE_HEAT,
        cx + lane,
        cy - phase * STAT_BOOST_MOTE_RISE_PX,
        STAT_BOOST_MOTE_RADIUS,
        moteAlpha,
      );
    }
    ctx.restore();

    const scale = statBoostPunchScale(elapsed);
    worldText(ctx, `+${p.statBoostFlashAmount} ${STAT_FULL_NAME[stat]}`, {
      x: cx,
      y: cy,
      size: STAT_BOOST_TEXT_SIZE * scale,
      bold: true,
      color: rgba(color, 1),
      glow: rgba(color, 1),
      outline: true,
      alpha,
      align: 'center',
    });
  }
}

/** Where the hover card may sit: the screen, less the theme's small edge margin. */
function tooltipBounds(): Rect {
  const margin = chromeTheme().space.xs;
  return inset({ x: 0, y: 0, w: viewportWidth(), h: viewportHeight() }, margin);
}

/** A villager's tooltip name and body, or null when nothing should show for them. */
function villagerTooltipContent(villager: Villager): EntityTooltipContent {
  return {
    name: villager.displayName ?? 'Ratkin Villager',
    subtitle: 'Ratkin',
    description: villager.description,
    hostile: false,
  };
}

export function renderEntityTooltip(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  mouseX: number,
  mouseY: number,
  mobGrid: SpatialGrid<Mob>,
  villagers: readonly Villager[] = [],
): void {
  const wx = mouseX + camX;
  const wy = mouseY + camY;

  // An entity can only be hovered when the cursor is inside its tile square,
  // so every candidate has its origin within that square's diagonal of the
  // cursor.
  let hoveredMob: Mob | null = null;
  for (const mob of mobGrid.queryCircle(wx, wy, TOOLTIP_HOVER_RADIUS)) {
    if (!mob.isAlive) continue;
    if (wx >= mob.x && wx <= mob.x + TILE_SIZE && wy >= mob.y && wy <= mob.y + TILE_SIZE) {
      hoveredMob = mob;
      break;
    }
  }

  if (hoveredMob !== null) {
    paintEntityTooltip(chromeTarget(ctx), { x: mouseX, y: mouseY }, tooltipBounds(), {
      name: hoveredMob.displayName,
      description: hoveredMob.description,
      hostile: hoveredMob.isHostile,
    });
    return;
  }

  const hoveredVillager = villagers.find(
    (villager) =>
      wx >= villager.x &&
      wx <= villager.x + TILE_SIZE &&
      wy >= villager.y &&
      wy <= villager.y + TILE_SIZE,
  );
  if (hoveredVillager !== undefined) {
    paintEntityTooltip(
      chromeTarget(ctx),
      { x: mouseX, y: mouseY },
      tooltipBounds(),
      villagerTooltipContent(hoveredVillager),
    );
  }
}
