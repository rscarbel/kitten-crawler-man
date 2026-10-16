/**
 * Carl and Donut standing on the floor line at hero scale, and Mongo tearing
 * across the back of the hall now and then. The heroes stand in the dark until
 * the spotlight (`stage.lights.spotlight`) finds them.
 *
 * Every pose is a pure function of the clock: which stance shift or grooming
 * break plays, and when, is hashed from the time slot it falls in. A frozen
 * moment therefore always shows the same pose, and nothing here keeps state
 * that a resize or a review render could disturb.
 */

import { TILE_SIZE } from '../../../core/constants';
import { progressFrameIndex, timeFrameIndex } from '../../../core/SpriteRenderer';
import { mulberry32 } from '../../../sprites/person/rng';
import {
  drawHumanSelection,
  emptyHandedHumanFigure,
  rowFrameAtTicks,
  rowLengthInTicks,
} from '../../../sprites/humanSprite';
import { prewarmFigureState } from '../../../sprites/figure/figureFrameCache';
import {
  GROUND_OFFSET_IN_TILE,
  HUMAN_ROW_TABLE,
  type HumanRowName,
} from '../../../sprites/art/humanFigure';
import { GROUND_Y as CAT_GROUND_BELOW_CENTRE } from '../../../sprites/art/catArt';
import { GROUND_Y as MONGO_GROUND_BELOW_CENTRE } from '../../../sprites/art/mongoArt';
import { activeCatFigure, drawCatSprite, type CatState } from '../../../sprites/catSprite';
import { figureFrameCount } from '../../../sprites/figure/figureDef';
import {
  drawMongoSprite,
  MONGO_MAX_WALK_RADIANS_PER_TICK,
  mongoWalkRadiansPerPixel,
} from '../../../sprites/mongoSprite';
import { TITLE_INK } from '../../../ui/theme/titleInk';
import type { Rect } from '../../../ui/core/geom';
import { TITLE_STEP_MS, type TitleClock } from '../titleClock';
import { applyTitleCamera, type TitleCamera, type TitleLayer } from '../titleLayer';
import type { TitleStage } from '../titleStage';
import type { TitleEventFire } from '../titleEvents';
import { TitleShadeBuffer } from '../titleShade';
import { TitleHeroCells } from '../titleHeroCells';
import type { FigureDef } from '../../../sprites/figure/figureDef';
import { HALL_DEPTH, rowAtHeight, scaleAtDistance, sideWallColumn, titleHall } from '../titleHall';
import {
  CARL_FIDGET_ROWS,
  CARL_HERO_CROP,
  DONUT_HERO_CROP,
  CARL_IDLE_ROW,
  DONUT_BREAK_ROWS,
  DONUT_IDLE_ROW,
  prewarmTitleCast,
  TITLE_MONGO_STAGE,
} from '../titleCast';

/** The heroes' plane: near, but behind the logo and the spotlight. */
const HEROES_DEPTH = 0.8;
/** Mongo runs across the hall's own floor, so he rides the hall's plane. */
const MONGO_DEPTH = HALL_DEPTH;

/** Where each hero's feet sit, in hero tiles from the stage's hero spot. */
const CARL_FOOT_OFFSET_TILES = { x: 0.42, y: 0 } as const;
/** Donut sits at his left, a little in front of him, so she is drawn over his boot. */
const DONUT_FOOT_OFFSET_TILES = { x: -0.5, y: 0.1 } as const;

/** Figures are centred across their tile; their feet sit at a depth into it each figure declares. */
const HALF = 0.5;
const DONUT_GROUND_IN_TILE = HALF + CAT_GROUND_BELOW_CENTRE;
const MONGO_GROUND_IN_TILE = HALF + MONGO_GROUND_BELOW_CENTRE;

/** The box a hero's shading is painted in, in hero tiles around the feet. */
const HERO_SHADE_BOX_TILES = { left: -1.6, top: -2.3, width: 3.2, height: 2.7 } as const;

/** The pool of shade each hero stands in, in hero tiles: wide and flat, as a floor sees it. */
const CONTACT_SHADOW_RADIUS_TILES = { carl: 0.46, donut: 0.36 } as const;
const CONTACT_SHADOW_SQUASH = 0.28;
const CONTACT_SHADOW_ALPHA = 0.85;
const GRADIENT_START = 0;
const GRADIENT_END = 1;

/** How much of the dark lies over the heroes before the spotlight finds them. */
const DORMANT_SHADE = 0.74;

const MS_PER_SECOND = 1000;

/** Each stance shift falls somewhere inside its own slot of this length. */
const CARL_FIDGET_SLOT_MS = 9000;
/** Her grooming breaks come round a little less often, and out of step with his shifts. */
const DONUT_BREAK_SLOT_MS = 11500;
/** Kept clear at each end of a slot, so a gesture never runs into the next slot's. */
const SLOT_MARGIN_MS = 1200;
/** Some slots pass with no gesture at all, so the rhythm never reads as a metronome. */
const SLOT_SKIP_CHANCE = 0.25;
/** Salts keep his slot draws and hers apart. */
const CARL_SLOT_SALT = 0x51ca;
const DONUT_SLOT_SALT = 0xd0ae;
/**
 * How far ahead a gesture's row is asked for again. A gesture plays seconds
 * apart from the last, long enough for the cache to let its row go between
 * them, so each is re-warmed shortly before it plays.
 */
const GESTURE_PREWARM_LEAD_MS = 1500;
/** Spreads consecutive slots' seeds across the stream. */
const SLOT_SEED_STRIDE = 7919;

/** Donut's idle loop rate: the rate the game's own idle runs at. */
const DONUT_IDLE_FPS = 6;
/** How long each of her breaks plays, in fixed ticks, as the game plays them. */
const DONUT_BREAK_TICKS: Readonly<Record<(typeof DONUT_BREAK_ROWS)[number], number>> = {
  groom_paw: 110,
  groom_flank: 110,
  look_around: 90,
};

/** How far down the hall behind the heroes he crosses it, wall to wall. */
const MONGO_BEHIND_HEROES_TILES = 6;
/** How far behind each side wall he starts and ends, in his own tiles: he bolts out of one side passage and into the other. */
const MONGO_OFFSTAGE_TILES = 2.5;
/** He runs in the dark behind the light, so he stays mostly shadow. */
const MONGO_SHADE = 0.42;
const MONGO_SHADE_BOX_TILES = { left: -1.6, top: -2, width: 3.2, height: 2.6 } as const;
/** A variant below this sends him right to left. */
const MONGO_LEFTWARD_BELOW = 0.5;

interface Gesture<Row extends string> {
  readonly row: Row;
  readonly startMs: number;
  readonly lengthMs: number;
}

/** The gesture a slot holds, if any: which one and when it starts, drawn from the slot's own seed. */
function gestureInSlot<Row extends string>(
  slot: number,
  slotMs: number,
  salt: number,
  rows: readonly Row[],
  lengthOf: (row: Row) => number,
): Gesture<Row> | null {
  const random = mulberry32(slot * SLOT_SEED_STRIDE + salt);
  if (random() < SLOT_SKIP_CHANCE) return null;
  const row = rows[Math.min(rows.length - 1, Math.floor(random() * rows.length))];
  const lengthMs = lengthOf(row);
  const room = Math.max(0, slotMs - lengthMs - SLOT_MARGIN_MS * 2);
  return { row, startMs: slot * slotMs + SLOT_MARGIN_MS + random() * room, lengthMs };
}

/** The next gesture to start within `leadMs` of `timeMs`, if one does. */
function gestureStartingSoon<Row extends string>(
  timeMs: number,
  leadMs: number,
  slotMs: number,
  salt: number,
  rows: readonly Row[],
  lengthOf: (row: Row) => number,
): Gesture<Row> | null {
  const slot = Math.floor((timeMs + leadMs) / slotMs);
  const gesture = gestureInSlot(slot, slotMs, salt, rows, lengthOf);
  if (gesture === null) return null;
  const untilStart = gesture.startMs - timeMs;
  return untilStart >= 0 && untilStart <= leadMs ? gesture : null;
}

/** The gesture playing at `timeMs`, or null while the figure only breathes. */
function gestureAt<Row extends string>(
  timeMs: number,
  slotMs: number,
  salt: number,
  rows: readonly Row[],
  lengthOf: (row: Row) => number,
): Gesture<Row> | null {
  const gesture = gestureInSlot(Math.floor(timeMs / slotMs), slotMs, salt, rows, lengthOf);
  if (gesture === null) return null;
  const into = timeMs - gesture.startMs;
  return into >= 0 && into < gesture.lengthMs ? gesture : null;
}

function carlRowLengthMs(row: HumanRowName): number {
  return rowLengthInTicks(HUMAN_ROW_TABLE[row]) * TITLE_STEP_MS;
}

function donutBreakLengthMs(row: (typeof DONUT_BREAK_ROWS)[number]): number {
  return DONUT_BREAK_TICKS[row] * TITLE_STEP_MS;
}

function ticksOf(ms: number): number {
  return Math.floor(ms / TITLE_STEP_MS);
}

function carlSelectionAt(timeMs: number): { row: HumanRowName; frame: number } {
  const fidget = gestureAt(
    timeMs,
    CARL_FIDGET_SLOT_MS,
    CARL_SLOT_SALT,
    CARL_FIDGET_ROWS,
    carlRowLengthMs,
  );
  if (fidget !== null) {
    const ticks = ticksOf(timeMs - fidget.startMs);
    return { row: fidget.row, frame: rowFrameAtTicks(HUMAN_ROW_TABLE[fidget.row], ticks) };
  }
  const idle = HUMAN_ROW_TABLE[CARL_IDLE_ROW];
  const ticks = ticksOf(timeMs) % rowLengthInTicks(idle);
  return { row: CARL_IDLE_ROW, frame: rowFrameAtTicks(idle, ticks) };
}

function donutCellAt(timeMs: number): { state: CatState; frame: number } {
  const figure = activeCatFigure();
  const groom = gestureAt(
    timeMs,
    DONUT_BREAK_SLOT_MS,
    DONUT_SLOT_SALT,
    DONUT_BREAK_ROWS,
    donutBreakLengthMs,
  );
  if (groom !== null) {
    const progress = (timeMs - groom.startMs) / groom.lengthMs;
    return {
      state: groom.row,
      frame: progressFrameIndex(progress, figureFrameCount(figure, groom.row)),
    };
  }
  const frames = figureFrameCount(figure, DONUT_IDLE_ROW);
  return {
    state: DONUT_IDLE_ROW,
    frame: timeFrameIndex(timeMs / MS_PER_SECOND, DONUT_IDLE_FPS, Math.max(1, frames)),
  };
}

/** 0 while the heroes stand in the dark, 1 in the full spotlight. */
function revealAt(stage: TitleStage): number {
  return Math.min(1, Math.max(0, stage.lights.spotlight));
}

function heroTile(stage: TitleStage): number {
  return TILE_SIZE * stage.heroScale;
}

function drawContactShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, CONTACT_SHADOW_SQUASH);
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  pool.addColorStop(GRADIENT_START, TITLE_INK.cast.contactShadow);
  pool.addColorStop(GRADIENT_END, TITLE_INK.cast.contactShadowFade);
  ctx.globalAlpha *= CONTACT_SHADOW_ALPHA;
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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

/** Device pixels per CSS pixel the context paints at, before the camera's zoom. */
function pixelRatioOf(ctx: CanvasRenderingContext2D): number {
  const transform = ctx.getTransform();
  return Math.hypot(transform.a, transform.b);
}

export function heroesLayer(): TitleLayer {
  const heroShade = new TitleShadeBuffer();
  const heroCells = new TitleHeroCells((def) =>
    def.id === activeCatFigure().id ? DONUT_HERO_CROP : CARL_HERO_CROP,
  );
  /** Where the heroes were last drawn: the tile size and pixel ratio their cells are painted for. */
  let drawnAt: { tile: number; pixelRatio: number } | null = null;
  const densityOf = (def: FigureDef): number =>
    drawnAt === null ? 1 : TitleHeroCells.densityFor(def, drawnAt.tile, drawnAt.pixelRatio);
  const requestIdleRows = (): void => {
    heroCells.request(emptyHandedHumanFigure(), CARL_IDLE_ROW);
    heroCells.request(activeCatFigure(), DONUT_IDLE_ROW);
  };
  const mongoShade = new TitleShadeBuffer();
  let mongoDash: TitleEventFire | null = null;
  let lastWarmedCarlStart = -1;
  let lastWarmedDonutStart = -1;

  const warmUpcomingGestures = (timeMs: number): void => {
    const carl = gestureStartingSoon(
      timeMs,
      GESTURE_PREWARM_LEAD_MS,
      CARL_FIDGET_SLOT_MS,
      CARL_SLOT_SALT,
      CARL_FIDGET_ROWS,
      carlRowLengthMs,
    );
    if (carl !== null && carl.startMs !== lastWarmedCarlStart) {
      lastWarmedCarlStart = carl.startMs;
      prewarmFigureState(emptyHandedHumanFigure(), carl.row);
      heroCells.request(emptyHandedHumanFigure(), carl.row);
    }
    const donut = gestureStartingSoon(
      timeMs,
      GESTURE_PREWARM_LEAD_MS,
      DONUT_BREAK_SLOT_MS,
      DONUT_SLOT_SALT,
      DONUT_BREAK_ROWS,
      donutBreakLengthMs,
    );
    if (donut !== null && donut.startMs !== lastWarmedDonutStart) {
      lastWarmedDonutStart = donut.startMs;
      prewarmFigureState(activeCatFigure(), donut.row);
      heroCells.request(activeCatFigure(), donut.row);
    }
  };

  const renderMongo = (
    ctx: CanvasRenderingContext2D,
    clock: TitleClock,
    stage: TitleStage,
    camera: TitleCamera,
  ): void => {
    const dash = mongoDash;
    if (dash === null) return;
    const sinceMs = clock.elapsedMs - dash.startedAtMs;
    if (sinceMs < 0 || sinceMs >= dash.durationMs) return;
    const hall = titleHall(stage);
    const scale = scaleAtDistance(hall, hall.heroDistanceTiles + MONGO_BEHIND_HEROES_TILES);
    const tile = hall.farPxPerTile * scale;
    const leftWall = sideWallColumn(hall, scale, -1);
    const rightWall = sideWallColumn(hall, scale, 1);
    const leftward = dash.variant < MONGO_LEFTWARD_BELOW;
    const startX = leftWall - MONGO_OFFSTAGE_TILES * tile;
    const endX = rightWall + MONGO_OFFSTAGE_TILES * tile;
    const travelled = (endX - startX) * (sinceMs / dash.durationMs);
    const footX = leftward ? endX - travelled : startX + travelled;
    const footY = rowAtHeight(hall, scale, 0);
    // His legs follow the ground he covers until that would skip frames of
    // the stride; past it they hold the fastest stride the art can show.
    const naturalPerTick =
      (travelled / Math.max(1, ticksOf(sinceMs))) *
      mongoWalkRadiansPerPixel(TITLE_MONGO_STAGE, tile);
    const walkFrame = ticksOf(sinceMs) * Math.min(naturalPerTick, MONGO_MAX_WALK_RADIANS_PER_TICK);
    ctx.save();
    applyTitleCamera(ctx, camera, MONGO_DEPTH);
    ctx.beginPath();
    ctx.rect(leftWall, 0, rightWall - leftWall, stage.height);
    ctx.clip();
    mongoShade.draw(
      ctx,
      boxAround(footX, footY, tile, MONGO_SHADE_BOX_TILES),
      MONGO_SHADE,
      TITLE_INK.cast.shadow,
      (target) =>
        drawMongoSprite(target, footX - tile * HALF, footY - tile * MONGO_GROUND_IN_TILE, tile, {
          stage: TITLE_MONGO_STAGE,
          isMoving: true,
          walkFrame,
          facingX: leftward ? -1 : 1,
          facingY: 0,
        }),
    );
    ctx.restore();
  };

  return {
    id: 'heroes',
    depth: HEROES_DEPTH,
    layout: () => {
      prewarmTitleCast();
      requestIdleRows();
    },
    update: (clock) => warmUpcomingGestures(clock.elapsedMs),
    onEvent: (fire) => {
      if (fire.id === 'mongoDash') mongoDash = fire;
    },
    render: (ctx, clock, stage, camera) => {
      renderMongo(ctx, clock, stage, camera);

      const tile = heroTile(stage);
      const pixelRatio = pixelRatioOf(ctx);
      drawnAt = { tile, pixelRatio };
      if (heroCells.beginFrame()) requestIdleRows();
      applyTitleCamera(ctx, camera, HEROES_DEPTH);
      const carlX = stage.heroSpot.x + CARL_FOOT_OFFSET_TILES.x * tile;
      const carlY = stage.heroSpot.y + CARL_FOOT_OFFSET_TILES.y * tile;
      const donutX = stage.heroSpot.x + DONUT_FOOT_OFFSET_TILES.x * tile;
      const donutY = stage.heroSpot.y + DONUT_FOOT_OFFSET_TILES.y * tile;
      const reveal = revealAt(stage);

      ctx.save();
      ctx.globalAlpha *= reveal;
      drawContactShadow(ctx, carlX, carlY, CONTACT_SHADOW_RADIUS_TILES.carl * tile);
      drawContactShadow(ctx, donutX, donutY, CONTACT_SHADOW_RADIUS_TILES.donut * tile);
      ctx.restore();

      const timeMs = clock.elapsedMs;
      const carl = carlSelectionAt(timeMs);
      const donut = donutCellAt(timeMs);
      const heroBox = boxAround(stage.heroSpot.x, stage.heroSpot.y, tile, HERO_SHADE_BOX_TILES);
      heroShade.draw(
        ctx,
        heroBox,
        DORMANT_SHADE * (1 - reveal),
        TITLE_INK.cast.shadow,
        (target) => {
          const carlLeft = carlX - tile * HALF;
          const carlTop = carlY - tile * GROUND_OFFSET_IN_TILE;
          const carlFigure = emptyHandedHumanFigure();
          const carlSharp = heroCells.draw(
            target,
            carlFigure,
            carl.row,
            carl.frame,
            carlLeft,
            carlTop,
            tile,
            densityOf(carlFigure),
          );
          if (!carlSharp) {
            drawHumanSelection(target, carlLeft, carlTop, tile, {
              row: carl.row,
              frame: carl.frame,
              flipX: false,
            });
          }
          const donutLeft = donutX - tile * HALF;
          const donutTop = donutY - tile * DONUT_GROUND_IN_TILE;
          const donutFigure = activeCatFigure();
          const donutSharp = heroCells.draw(
            target,
            donutFigure,
            donut.state,
            donut.frame,
            donutLeft,
            donutTop,
            tile,
            densityOf(donutFigure),
          );
          if (!donutSharp) {
            drawCatSprite(
              target,
              donutLeft,
              donutTop,
              tile,
              {},
              { state: donut.state, frame: donut.frame, flipX: false },
            );
          }
        },
      );
      heroCells.bakeQueued(densityOf);
    },
    dispose: () => {
      heroCells.dispose();
      heroShade.dispose();
      mongoShade.dispose();
    },
  };
}
