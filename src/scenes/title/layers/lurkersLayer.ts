/**
 * What watches from the dark: pairs of goblin eye-shine that blink, wink out
 * and come back on staggered timers, and the goblin that now and then creeps
 * up to the edge of the light, stares at the heroes and ducks away.
 *
 * Every eye pair is a pure function of the clock and its own seeded timings,
 * so a frozen moment shows the same eyes open every time.
 */

import { TILE_SIZE } from '../../../core/constants';
import { renderQuality } from '../../../core/RenderQuality';
import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../../../core/SpriteRenderer';
import { mulberry32, type Rng } from '../../../sprites/person/rng';
import { drawRadialGlow, type GlowStop } from '../../../sprites/radialGlow';
import {
  drawGoblinSprite,
  GOBLIN_IDLE_BREAK_FPS,
  GOBLIN_IDLE_FPS,
  goblinFigure,
  type GoblinState,
} from '../../../sprites/goblinSprite';
import { goblinWalkGroundPerCycleTiles } from '../../../sprites/art/goblinFigure';
import { figureFrameCount } from '../../../sprites/figure/figureDef';
import { TITLE_INK } from '../../../ui/theme/titleInk';
import type { Rect } from '../../../ui/core/geom';
import type { TitleClock } from '../titleClock';
import { applyTitleCamera, type TitleCamera, type TitleLayer } from '../titleLayer';
import type { TitleComposition, TitleStage } from '../titleStage';
import type { TitleEventFire } from '../titleEvents';
import { TitleShadeBuffer } from '../titleShade';
import { PEEKING_GOBLIN } from '../titleCast';
import {
  HALL_DEPTH,
  rowAtHeight,
  scaleAtDistance,
  sideWallColumn,
  titleHall,
  type TitleHall,
} from '../titleHall';

/**
 * The eyes are fixed to the hall's walls and doorway, so they ride its plane;
 * the peeking goblin stands beside the heroes, so he rides theirs.
 */
const EYES_DEPTH = HALL_DEPTH;
const PEEK_DEPTH = 0.8;
/** Of the two planes, the one this layer reports: where most of what it draws sits. */
const LURKERS_DEPTH = EYES_DEPTH;

/** Eye pairs on screen at once, by composition, at full detail and on a device that dropped it. */
const EYE_PAIR_COUNT: Readonly<Record<TitleComposition, { full: number; reduced: number }>> = {
  landscape: { full: 9, reduced: 5 },
  portrait: { full: 6, reduced: 3 },
};

/** Fixes where the eyes sit, so a layout is the same picture every time it is built. */
const EYE_LAYOUT_SEED = 0x3e7e5;

/** Eye geometry in goblin tiles at the eyes' own distance: larger than the dungeon's own, to read across a title screen. */
const EYE_READ_BOOST = 1.6;
const EYE_DOT_RADIUS_TILES = 0.045;
const EYE_SPACING_TILES = 0.17;
const EYE_GLOW_RADIUS_TILES = 0.3;

/** How high a crouching goblin's eyes sit off the floor. */
const EYE_HEIGHT_TILES = 0.7;
/** A goblin pressed to a side wall stands this far out from it. */
const WALL_STANDOFF_TILES = 0.45;
/** Side-wall eyes keep this far down the hall from the heroes, and this far short of the far wall. */
const WALL_NEAREST_BEHIND_HEROES_TILES = 1.5;
const WALL_FAR_MARGIN_TILES = 1;
/** One pair in this many watches from the doorway's dark rather than a side wall. */
const DOORWAY_EVERY = 3;
/** The share of the doorway's width eyes may sit across, centred. */
const DOORWAY_SPREAD = 0.6;
/** Side-wall eyes keep this many of their tiles clear of the column under a torch, so they sit between its pools of light. */
const TORCH_CLEAR_TILES = 0.6;
/** And this far inside the screen's edges. */
const SCREEN_MARGIN_PX = 12;

/** Two pairs nearer than this many glow radii (the smaller pair's) read as one creature with four eyes. */
const MIN_PAIR_GAP_GLOWS = 2.5;
/** Spots tried for a pair before it is left out rather than crowded in. */
const SPOT_ATTEMPTS = 30;

/** A pair blinks once per period, shut for only a moment. */
const BLINK_PERIOD_MIN_MS = 2600;
const BLINK_PERIOD_RANDOM_MS = 3600;
const BLINK_SHUT_MS = 150;
/** Two quick blinks sometimes: the period's second blink, this long after the first. */
const DOUBLE_BLINK_GAP_MS = 260;
const DOUBLE_BLINK_CHANCE = 0.3;

/** A pair watches for a while, then is gone (the goblin moved), then comes back. */
const PRESENCE_PERIOD_MIN_MS = 9000;
const PRESENCE_PERIOD_RANDOM_MS = 8000;
const ABSENCE_MIN_SHARE = 0.15;
const ABSENCE_RANDOM_SHARE = 0.25;
const PRESENCE_FADE_MS = 500;

/** As the hall lights up the eyes fade towards this share; they belong to the dark. */
const LIT_EYE_FLOOR = 0.45;

/** The peeking goblin, in hero tiles: where he stops, how far he creeps from, how far behind the heroes. */
const PEEK_STAND_TILES = 1.9;
const PEEK_TRAVEL_TILES = 1.5;
const PEEK_BEHIND_TILES = 0.3;
const PEEK_SCALE = 0.92;
/** The beat's shape, as shares of its length: creep in, stare, startle, bolt. */
const PEEK_CREEP_END = 0.26;
const PEEK_STARE_END = 0.72;
const PEEK_FLINCH_END = 0.78;
/** The stare's fidget starts this far into the stare. */
const PEEK_FIDGET_AT = 0.3;
/** Shade on him at the edge he creeps from, and standing at the light's edge. */
const PEEK_DARK_SHADE = 0.88;
const PEEK_LIT_SHADE = 0.42;
const PEEK_SHADE_BOX_TILES = { left: -1.5, top: -1.8, width: 3, height: 2.3 } as const;
/** A variant at or above this asks him to come from the heroes' right, where there is room. */
const PEEK_RIGHT_FROM = 0.5;
/** Room he needs on the right before the menu, in hero tiles. */
const PEEK_RIGHT_ROOM_TILES = 3.2;
const HALF = 0.5;
/** A goblin's soles stand on the bottom of its own tile. */
const GOBLIN_GROUND_IN_TILE = 1;
const MS_PER_SECOND = 1000;

interface EyePair {
  readonly x: number;
  readonly y: number;
  /** Goblin tile size at this depth, in CSS pixels. */
  readonly tile: number;
  readonly blinkPeriodMs: number;
  readonly blinkPhaseMs: number;
  readonly doubleBlink: boolean;
  readonly presencePeriodMs: number;
  readonly presencePhaseMs: number;
  readonly absenceMs: number;
}

const EYE_GLOW_STOPS: readonly GlowStop[] = [
  { offset: 0, color: TITLE_INK.cast.eyeGlow },
  { offset: 1, color: TITLE_INK.cast.eyeGlowFade },
];

interface EyeSpot {
  readonly x: number;
  readonly y: number;
  readonly tile: number;
  /** On a side wall, where the torches hang; the doorway has none. */
  readonly onSideWall: boolean;
}

function sideWallSpot(random: Rng, hall: TitleHall, side: -1 | 1): EyeSpot {
  const near = hall.heroDistanceTiles + WALL_NEAREST_BEHIND_HEROES_TILES;
  const far = hall.farDistanceTiles - WALL_FAR_MARGIN_TILES;
  const scale = scaleAtDistance(hall, near + random() * Math.max(0, far - near));
  const pxPerTile = hall.farPxPerTile * scale;
  return {
    x: sideWallColumn(hall, scale, side) - side * WALL_STANDOFF_TILES * pxPerTile,
    y: rowAtHeight(hall, scale, EYE_HEIGHT_TILES),
    tile: pxPerTile * EYE_READ_BOOST,
    onSideWall: true,
  };
}

function doorwaySpot(random: Rng, hall: TitleHall): EyeSpot {
  const { door } = hall;
  const spread = door.w * DOORWAY_SPREAD;
  return {
    x: door.x + (door.w - spread) * HALF + random() * spread,
    y: rowAtHeight(hall, 1, EYE_HEIGHT_TILES),
    tile: hall.farPxPerTile * EYE_READ_BOOST,
    onSideWall: false,
  };
}

function insideRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function spotFits(spot: EyeSpot, stage: TitleStage, placed: readonly EyePair[]): boolean {
  const onScreen =
    spot.x >= SCREEN_MARGIN_PX &&
    spot.x <= stage.width - SCREEN_MARGIN_PX &&
    spot.y >= SCREEN_MARGIN_PX &&
    spot.y <= stage.height - SCREEN_MARGIN_PX;
  if (!onScreen || insideRect(stage.menuRect, spot.x, spot.y)) return false;
  const torchClear = (spot.tile / EYE_READ_BOOST) * TORCH_CLEAR_TILES;
  const nearTorch =
    spot.onSideWall && stage.torches.some((torch) => Math.abs(torch.x - spot.x) < torchClear);
  if (nearTorch) return false;
  return placed.every((pair) => {
    const gap = Math.min(pair.tile, spot.tile) * EYE_GLOW_RADIUS_TILES * MIN_PAIR_GAP_GLOWS;
    return Math.hypot(pair.x - spot.x, pair.y - spot.y) >= gap;
  });
}

function placeEyes(stage: TitleStage, hall: TitleHall): EyePair[] {
  const random: Rng = mulberry32(EYE_LAYOUT_SEED);
  const counts = EYE_PAIR_COUNT[stage.composition];
  const count = renderQuality.fullDetail ? counts.full : counts.reduced;
  const pairs: EyePair[] = [];
  for (let index = 0; index < count; index++) {
    const side = index % 2 === 0 ? -1 : 1;
    let spot: EyeSpot | null = null;
    for (let attempt = 0; attempt < SPOT_ATTEMPTS && spot === null; attempt++) {
      const candidate =
        index % DOORWAY_EVERY === DOORWAY_EVERY - 1
          ? doorwaySpot(random, hall)
          : sideWallSpot(random, hall, side);
      if (spotFits(candidate, stage, pairs)) spot = candidate;
    }
    if (spot === null) continue;
    const blinkPeriodMs = BLINK_PERIOD_MIN_MS + random() * BLINK_PERIOD_RANDOM_MS;
    const presencePeriodMs = PRESENCE_PERIOD_MIN_MS + random() * PRESENCE_PERIOD_RANDOM_MS;
    pairs.push({
      x: spot.x,
      y: spot.y,
      tile: spot.tile,
      blinkPeriodMs,
      blinkPhaseMs: random() * blinkPeriodMs,
      doubleBlink: random() < DOUBLE_BLINK_CHANCE,
      presencePeriodMs,
      presencePhaseMs: random() * presencePeriodMs,
      absenceMs: presencePeriodMs * (ABSENCE_MIN_SHARE + random() * ABSENCE_RANDOM_SHARE),
    });
  }
  return pairs;
}

function positiveModulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/** 0 shut or gone, 1 wide open. */
function eyeOpenness(pair: EyePair, timeMs: number): number {
  const presenceMs = positiveModulo(timeMs + pair.presencePhaseMs, pair.presencePeriodMs);
  const shownMs = pair.presencePeriodMs - pair.absenceMs;
  if (presenceMs >= shownMs) return 0;
  const fadeIn = Math.min(1, presenceMs / PRESENCE_FADE_MS);
  const fadeOut = Math.min(1, (shownMs - presenceMs) / PRESENCE_FADE_MS);
  const blinkMs = positiveModulo(timeMs + pair.blinkPhaseMs, pair.blinkPeriodMs);
  const inFirstBlink = blinkMs < BLINK_SHUT_MS;
  const secondBlinkMs = blinkMs - DOUBLE_BLINK_GAP_MS;
  const inSecondBlink = pair.doubleBlink && secondBlinkMs >= 0 && secondBlinkMs < BLINK_SHUT_MS;
  if (inFirstBlink || inSecondBlink) return 0;
  return Math.min(fadeIn, fadeOut);
}

function drawEyes(ctx: CanvasRenderingContext2D, pair: EyePair, strength: number): void {
  const spacing = pair.tile * EYE_SPACING_TILES;
  ctx.save();
  ctx.globalAlpha *= strength;
  ctx.globalCompositeOperation = 'lighter';
  drawRadialGlow(ctx, pair.x, pair.y, pair.tile * EYE_GLOW_RADIUS_TILES, EYE_GLOW_STOPS);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = TITLE_INK.cast.eyeShine;
  const radius = pair.tile * EYE_DOT_RADIUS_TILES;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(pair.x + side * spacing * HALF, pair.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

interface PeekPose {
  readonly x: number;
  readonly state: GoblinState;
  readonly frame: number;
  readonly facingX: number;
  /** 0 at the dark edge he creeps from, 1 standing at the light's edge. */
  readonly nearness: number;
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeInQuad(t: number): number {
  return t * t;
}

/** Where the peeking goblin is and what he is doing, `progress` (0..1) through the beat. */
function peekPoseAt(
  progress: number,
  durationMs: number,
  standX: number,
  hiddenX: number,
  tile: number,
): PeekPose {
  const figure = goblinFigure(PEEKING_GOBLIN);
  const towardHeroes = standX > hiddenX ? 1 : -1;
  const radiansPerPx = (Math.PI * 2) / (goblinWalkGroundPerCycleTiles(PEEKING_GOBLIN) * tile);
  const walkFrames = figureFrameCount(figure, 'walk');
  const span = standX - hiddenX;

  if (progress < PEEK_CREEP_END) {
    const nearness = easeOutQuad(progress / PEEK_CREEP_END);
    const x = hiddenX + span * nearness;
    const frame = walkFrameIndex(Math.abs(x - hiddenX) * radiansPerPx, walkFrames);
    return { x, state: 'walk', frame, facingX: towardHeroes, nearness };
  }
  if (progress < PEEK_STARE_END) {
    const stareShare = (progress - PEEK_CREEP_END) / (PEEK_STARE_END - PEEK_CREEP_END);
    const stareMs = stareShare * (PEEK_STARE_END - PEEK_CREEP_END) * durationMs;
    const breakFrames = figureFrameCount(figure, 'idle_break');
    const breakStartMs = PEEK_FIDGET_AT * (PEEK_STARE_END - PEEK_CREEP_END) * durationMs;
    const breakFrame = Math.floor(
      ((stareMs - breakStartMs) / MS_PER_SECOND) * GOBLIN_IDLE_BREAK_FPS,
    );
    if (breakFrame >= 0 && breakFrame < breakFrames) {
      return {
        x: standX,
        state: 'idle_break',
        frame: breakFrame,
        facingX: towardHeroes,
        nearness: 1,
      };
    }
    const idleFrames = Math.max(1, figureFrameCount(figure, 'idle'));
    const frame = timeFrameIndex(stareMs / MS_PER_SECOND, GOBLIN_IDLE_FPS, idleFrames);
    return { x: standX, state: 'idle', frame, facingX: towardHeroes, nearness: 1 };
  }
  if (progress < PEEK_FLINCH_END) {
    const flinchShare = (progress - PEEK_STARE_END) / (PEEK_FLINCH_END - PEEK_STARE_END);
    const frame = progressFrameIndex(flinchShare, figureFrameCount(figure, 'flinch'));
    return { x: standX, state: 'flinch', frame, facingX: towardHeroes, nearness: 1 };
  }
  const boltShare = (progress - PEEK_FLINCH_END) / (1 - PEEK_FLINCH_END);
  const away = easeInQuad(boltShare);
  const x = standX - span * away;
  const frame = walkFrameIndex(Math.abs(standX - x) * radiansPerPx, walkFrames);
  return { x, state: 'walk', frame, facingX: -towardHeroes, nearness: 1 - away };
}

function boxAround(
  x: number,
  y: number,
  tile: number,
  box: { left: number; top: number; width: number; height: number },
): Rect {
  return {
    x: x + box.left * tile,
    y: y + box.top * tile,
    w: box.width * tile,
    h: box.height * tile,
  };
}

export function lurkersLayer(): TitleLayer {
  let eyes: EyePair[] = [];
  let peek: TitleEventFire | null = null;
  const shade = new TitleShadeBuffer();

  const renderPeek = (
    ctx: CanvasRenderingContext2D,
    clock: TitleClock,
    stage: TitleStage,
  ): void => {
    const fire = peek;
    if (fire === null) return;
    const sinceMs = clock.elapsedMs - fire.startedAtMs;
    if (sinceMs < 0 || sinceMs >= fire.durationMs) return;
    const heroTile = TILE_SIZE * stage.heroScale;
    const roomOnRight =
      stage.composition === 'portrait' ||
      stage.menuRect.x - stage.heroSpot.x > PEEK_RIGHT_ROOM_TILES * heroTile;
    const side = fire.variant >= PEEK_RIGHT_FROM && roomOnRight ? 1 : -1;
    const standX = stage.heroSpot.x + side * PEEK_STAND_TILES * heroTile;
    const hiddenX = standX + side * PEEK_TRAVEL_TILES * heroTile;
    const footY = stage.floorY - PEEK_BEHIND_TILES * heroTile;
    const tile = heroTile * PEEK_SCALE;
    const pose = peekPoseAt(sinceMs / fire.durationMs, fire.durationMs, standX, hiddenX, tile);
    const darkness = PEEK_DARK_SHADE + (PEEK_LIT_SHADE - PEEK_DARK_SHADE) * pose.nearness;
    shade.draw(
      ctx,
      boxAround(pose.x, footY, tile, PEEK_SHADE_BOX_TILES),
      darkness,
      TITLE_INK.cast.shadow,
      (target) =>
        drawGoblinSprite(target, {
          archetype: PEEKING_GOBLIN,
          x: pose.x - tile * HALF,
          y: footY - tile * GOBLIN_GROUND_IN_TILE,
          tileSize: tile,
          facingX: pose.facingX,
          state: pose.state,
          frame: pose.frame,
        }),
    );
  };

  return {
    id: 'lurkers',
    depth: LURKERS_DEPTH,
    layout: (stage) => {
      eyes = placeEyes(stage, titleHall(stage));
    },
    onEvent: (fire) => {
      if (fire.id === 'goblinPeek') peek = fire;
    },
    render: (ctx, clock, stage, camera: TitleCamera) => {
      ctx.save();
      applyTitleCamera(ctx, camera, EYES_DEPTH);
      const litFade = 1 - (1 - LIT_EYE_FLOOR) * stage.lights.ambient;
      for (const pair of eyes) {
        const openness = eyeOpenness(pair, clock.elapsedMs);
        if (openness <= 0) continue;
        drawEyes(ctx, pair, openness * litFade);
      }
      ctx.restore();
      applyTitleCamera(ctx, camera, PEEK_DEPTH);
      renderPeek(ctx, clock, stage);
    },
    dispose: () => shade.dispose(),
  };
}
