/**
 * The two crawlers standing on the floor line at hero scale, and Deinonychus tearing
 * across the back of the hall now and then. The heroes stand in the dark until
 * the spotlight (`stage.lights.spotlight`) finds them.
 *
 * Which stance shift or grooming break each slot of time holds, and when it
 * starts, is hashed from the slot, so a frozen moment always asks for the same
 * pose. A gesture plays only if its row was baked sharp by the time it was
 * first due; otherwise the hero keeps breathing through that slot.
 */

import { TILE_SIZE } from '../../../core/constants';
import { progressFrameIndex, timeFrameIndex } from '../../../core/spriteAssets/SpriteRenderer';
import { mulberry32 } from '../../../sprites/person/rng';
import {
  emptyHandedHumanFigure,
  rowFrameAtTicks,
  rowLengthInTicks,
} from '../../../sprites/humanSprite';
import {
  GROUND_OFFSET_IN_TILE,
  HUMAN_ROW_TABLE,
  type HumanRowName,
} from '../../../sprites/art/humanFigure';
import { PLAYER_HUMAN_SIZE_OVER_RIG } from '../../../sprites/art/human/figureScale';
import { GROUND_Y as CAT_GROUND_BELOW_CENTRE } from '../../../sprites/art/catArt';
import { GROUND_Y as DEINONYCHUS_GROUND_BELOW_CENTRE } from '../../../sprites/art/deinonychusArt';
import { activeCatFigure, type CatState } from '../../../sprites/catSprite';
import { figureFrameCount } from '../../../sprites/figure/figureDef';
import {
  drawDeinonychusSprite,
  DEINONYCHUS_MAX_WALK_RADIANS_PER_TICK,
  deinonychusWalkRadiansPerPixel,
} from '../../../sprites/deinonychusSprite';
import { TITLE_INK } from '../../../ui/theme/titleInk';
import type { Rect } from '../../../ui/core/geom';
import { TITLE_STEP_MS, type TitleClock } from '../titleClock';
import { applyTitleCamera, type TitleCamera, type TitleLayer } from '../titleLayer';
import type { TitleStage } from '../titleStage';
import type { TitleEventFire } from '../titleEvents';
import { TitleShadeBuffer } from '../titleShade';
import { IDLE_BAKE_TIMEOUT_MS, TitleHeroCells } from '../titleHeroCells';
import type { FigureDef } from '../../../sprites/figure/figureDef';
import { HALL_DEPTH, rowAtHeight, scaleAtDistance, sideWallColumn, titleHall } from '../titleHall';
import {
  HUMAN_FIDGET_ROWS,
  HUMAN_HERO_CROP,
  CAT_HERO_CROP,
  HUMAN_IDLE_ROW,
  CAT_BREAK_ROWS,
  CAT_IDLE_ROW,
  prewarmTitleCast,
  TITLE_DEINONYCHUS_STAGE,
} from '../titleCast';

/** The heroes' plane: near, but behind the logo and the spotlight. */
const HEROES_DEPTH = 0.8;
/** Deinonychus runs across the hall's own floor, so he rides the hall's plane. */
const DEINONYCHUS_DEPTH = HALL_DEPTH;

/**
 * How much larger than the stage's own scale the heroes stand, and the tile
 * their placement on the stage is laid out in. The crawlers are drawn to slim,
 * real proportions, which at the hall's scale read as smaller than the stage
 * around them.
 */
const HERO_ZOOM = 1.27;
/**
 * The human already stands larger than the rig everywhere he is drawn, so he
 * is zoomed only as far as brings him to {@link HERO_ZOOM} of the rig's size;
 * zoomed the whole way he towers over the cat and runs off a phone's stage.
 */
const HUMAN_HERO_ZOOM = HERO_ZOOM / PLAYER_HUMAN_SIZE_OVER_RIG;

/** Where each hero's feet sit, in hero tiles from the stage's hero spot. */
const HUMAN_FOOT_OFFSET_TILES = { x: 0.42, y: 0 } as const;
/** The cat sits at the human's left, a little in front of him, so she is drawn over his boot. */
const CAT_FOOT_OFFSET_TILES = { x: -0.5, y: 0.1 } as const;

/** Figures are centred across their tile; their feet sit at a depth into it each figure declares. */
const HALF = 0.5;
const CAT_GROUND_IN_TILE = HALF + CAT_GROUND_BELOW_CENTRE;
const DEINONYCHUS_GROUND_IN_TILE = HALF + DEINONYCHUS_GROUND_BELOW_CENTRE;

/** The box a hero's shading is painted in, in hero tiles around the feet. */
const HERO_SHADE_BOX_TILES = { left: -1.6, top: -2.3, width: 3.2, height: 2.7 } as const;

/** The pool of shade each hero stands in, in hero tiles: wide and flat, as a floor sees it. */
const CONTACT_SHADOW_RADIUS_TILES = { human: 0.46, cat: 0.36 } as const;
const CONTACT_SHADOW_SQUASH = 0.28;
const CONTACT_SHADOW_ALPHA = 0.85;
const GRADIENT_START = 0;
const GRADIENT_END = 1;

/** How much of the dark lies over the heroes before the spotlight finds them. */
const DORMANT_SHADE = 0.74;

const MS_PER_SECOND = 1000;

/** Each stance shift falls somewhere inside its own slot of this length. */
const HUMAN_FIDGET_SLOT_MS = 9000;
/** Her grooming breaks come round a little less often, and out of step with his shifts. */
const CAT_BREAK_SLOT_MS = 11500;
/** Kept clear at each end of a slot, so a gesture never runs into the next slot's. */
const SLOT_MARGIN_MS = 1200;
/** Some slots pass with no gesture at all, so the rhythm never reads as a metronome. */
const SLOT_SKIP_CHANCE = 0.25;
/** Salts keep his slot draws and hers apart. */
const HUMAN_SLOT_SALT = 0x51ca;
const CAT_SLOT_SALT = 0xd0ae;
/**
 * How many cells of a gesture's row can bake between its being asked for and
 * its start on a device whose idle periods never have room for one, where a
 * cell bakes once per {@link IDLE_BAKE_TIMEOUT_MS}: a little more than the
 * longest gesture row. A gesture plays seconds apart from the last, long
 * enough for its row to be let go between them, so each is asked for again
 * ahead of its start. The lead stays shorter than either hero's slot.
 */
const GESTURE_CELLS_WARMED_AHEAD = 14;
const GESTURE_PREWARM_LEAD_MS = GESTURE_CELLS_WARMED_AHEAD * IDLE_BAKE_TIMEOUT_MS;
/** Spreads consecutive slots' seeds across the stream. */
const SLOT_SEED_STRIDE = 7919;

/** The cat's idle loop rate: the rate the game's own idle runs at. */
const CAT_IDLE_FPS = 6;
/** How long each of her breaks plays, in fixed ticks, as the game plays them. */
const CAT_BREAK_TICKS: Readonly<Record<CatBreakRow, number>> = {
  groom_paw: 110,
  groom_flank: 110,
  look_around: 90,
};

/** How far down the hall behind the heroes he crosses it, wall to wall. */
const DEINONYCHUS_BEHIND_HEROES_TILES = 6;
/** How far behind each side wall he starts and ends, in his own tiles: he bolts out of one side passage and into the other. */
const DEINONYCHUS_OFFSTAGE_TILES = 2.5;
/** He runs in the dark behind the light, so he stays mostly shadow. */
const DEINONYCHUS_SHADE = 0.42;
const DEINONYCHUS_SHADE_BOX_TILES = { left: -1.6, top: -2, width: 3.2, height: 2.6 } as const;
/** A variant below this sends him right to left. */
const DEINONYCHUS_LEFTWARD_BELOW = 0.5;

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

function humanRowLengthMs(row: HumanRowName): number {
  return rowLengthInTicks(HUMAN_ROW_TABLE[row]) * TITLE_STEP_MS;
}

function catBreakLengthMs(row: CatBreakRow): number {
  return CAT_BREAK_TICKS[row] * TITLE_STEP_MS;
}

function ticksOf(ms: number): number {
  return Math.floor(ms / TITLE_STEP_MS);
}

/**
 * Decides once per gesture, when it is first due, whether it plays: only if
 * its row is ready then, so a gesture never shows a frame soft or stalls one
 * to bake it.
 */
class GestureGate<Row extends string> {
  private decidedStartMs: number | null = null;
  private plays = false;

  constructor(private readonly ready: (row: Row) => boolean) {}

  admits(gesture: Gesture<Row>): boolean {
    if (gesture.startMs !== this.decidedStartMs) {
      this.decidedStartMs = gesture.startMs;
      this.plays = this.ready(gesture.row);
    }
    return this.plays;
  }
}

type HumanFidgetRow = (typeof HUMAN_FIDGET_ROWS)[number];
type CatBreakRow = (typeof CAT_BREAK_ROWS)[number];

function humanSelectionAt(
  timeMs: number,
  gate: GestureGate<HumanFidgetRow>,
): { row: HumanRowName; frame: number } {
  const fidget = gestureAt(
    timeMs,
    HUMAN_FIDGET_SLOT_MS,
    HUMAN_SLOT_SALT,
    HUMAN_FIDGET_ROWS,
    humanRowLengthMs,
  );
  if (fidget !== null && gate.admits(fidget)) {
    const ticks = ticksOf(timeMs - fidget.startMs);
    return { row: fidget.row, frame: rowFrameAtTicks(HUMAN_ROW_TABLE[fidget.row], ticks) };
  }
  const idle = HUMAN_ROW_TABLE[HUMAN_IDLE_ROW];
  const ticks = ticksOf(timeMs) % rowLengthInTicks(idle);
  return { row: HUMAN_IDLE_ROW, frame: rowFrameAtTicks(idle, ticks) };
}

function catCellAt(
  timeMs: number,
  gate: GestureGate<CatBreakRow>,
): { state: CatState; frame: number } {
  const figure = activeCatFigure();
  const groom = gestureAt(
    timeMs,
    CAT_BREAK_SLOT_MS,
    CAT_SLOT_SALT,
    CAT_BREAK_ROWS,
    catBreakLengthMs,
  );
  if (groom !== null && gate.admits(groom)) {
    const progress = (timeMs - groom.startMs) / groom.lengthMs;
    return {
      state: groom.row,
      frame: progressFrameIndex(progress, figureFrameCount(figure, groom.row)),
    };
  }
  const frames = figureFrameCount(figure, CAT_IDLE_ROW);
  return {
    state: CAT_IDLE_ROW,
    frame: timeFrameIndex(timeMs / MS_PER_SECOND, CAT_IDLE_FPS, Math.max(1, frames)),
  };
}

/** 0 while the heroes stand in the dark, 1 in the full spotlight. */
function revealAt(stage: TitleStage): number {
  return Math.min(1, Math.max(0, stage.lights.spotlight));
}

/** The tile the heroes' placement, shading box and the cat are drawn in. */
function heroTile(stage: TitleStage): number {
  return TILE_SIZE * stage.heroScale * HERO_ZOOM;
}

function humanHeroTile(stage: TitleStage): number {
  return TILE_SIZE * stage.heroScale * HUMAN_HERO_ZOOM;
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
    def.id === activeCatFigure().id ? CAT_HERO_CROP : HUMAN_HERO_CROP,
  );
  /** Where the heroes were last drawn: the tile sizes and pixel ratio their cells are painted for. */
  let drawnAt: { catTile: number; humanTile: number; pixelRatio: number } | null = null;
  const densityOf = (def: FigureDef): number => {
    if (drawnAt === null) return 1;
    const tile = def.id === activeCatFigure().id ? drawnAt.catTile : drawnAt.humanTile;
    return TitleHeroCells.densityFor(def, tile, drawnAt.pixelRatio);
  };
  const holdIdleRows = (): void => {
    heroCells.holdResident(emptyHandedHumanFigure(), HUMAN_IDLE_ROW);
    heroCells.holdResident(activeCatFigure(), CAT_IDLE_ROW);
  };
  const humanGate = new GestureGate<HumanFidgetRow>((row) => {
    const figure = emptyHandedHumanFigure();
    return heroCells.isReady(figure, row, densityOf(figure));
  });
  const catGate = new GestureGate<CatBreakRow>((row) => {
    const figure = activeCatFigure();
    return heroCells.isReady(figure, row, densityOf(figure));
  });
  const deinonychusShade = new TitleShadeBuffer();
  let deinonychusDash: TitleEventFire | null = null;
  let lastWarmedHumanStart = -1;
  let lastWarmedCatStart = -1;

  const warmUpcomingGestures = (timeMs: number): void => {
    const human = gestureStartingSoon(
      timeMs,
      GESTURE_PREWARM_LEAD_MS,
      HUMAN_FIDGET_SLOT_MS,
      HUMAN_SLOT_SALT,
      HUMAN_FIDGET_ROWS,
      humanRowLengthMs,
    );
    if (human !== null && human.startMs !== lastWarmedHumanStart) {
      lastWarmedHumanStart = human.startMs;
      heroCells.request(emptyHandedHumanFigure(), human.row);
    }
    const cat = gestureStartingSoon(
      timeMs,
      GESTURE_PREWARM_LEAD_MS,
      CAT_BREAK_SLOT_MS,
      CAT_SLOT_SALT,
      CAT_BREAK_ROWS,
      catBreakLengthMs,
    );
    if (cat !== null && cat.startMs !== lastWarmedCatStart) {
      lastWarmedCatStart = cat.startMs;
      heroCells.request(activeCatFigure(), cat.row);
    }
  };

  const renderDeinonychus = (
    ctx: CanvasRenderingContext2D,
    clock: TitleClock,
    stage: TitleStage,
    camera: TitleCamera,
  ): void => {
    const dash = deinonychusDash;
    if (dash === null) return;
    const sinceMs = clock.elapsedMs - dash.startedAtMs;
    if (sinceMs < 0 || sinceMs >= dash.durationMs) return;
    const hall = titleHall(stage);
    const scale = scaleAtDistance(hall, hall.heroDistanceTiles + DEINONYCHUS_BEHIND_HEROES_TILES);
    const tile = hall.farPxPerTile * scale;
    const leftWall = sideWallColumn(hall, scale, -1);
    const rightWall = sideWallColumn(hall, scale, 1);
    const leftward = dash.variant < DEINONYCHUS_LEFTWARD_BELOW;
    const startX = leftWall - DEINONYCHUS_OFFSTAGE_TILES * tile;
    const endX = rightWall + DEINONYCHUS_OFFSTAGE_TILES * tile;
    const travelled = (endX - startX) * (sinceMs / dash.durationMs);
    const footX = leftward ? endX - travelled : startX + travelled;
    const footY = rowAtHeight(hall, scale, 0);
    // His legs follow the ground he covers until that would skip frames of
    // the stride; past it they hold the fastest stride the art can show.
    const naturalPerTick =
      (travelled / Math.max(1, ticksOf(sinceMs))) *
      deinonychusWalkRadiansPerPixel(TITLE_DEINONYCHUS_STAGE, tile);
    const walkFrame =
      ticksOf(sinceMs) * Math.min(naturalPerTick, DEINONYCHUS_MAX_WALK_RADIANS_PER_TICK);
    ctx.save();
    applyTitleCamera(ctx, camera, DEINONYCHUS_DEPTH);
    ctx.beginPath();
    ctx.rect(leftWall, 0, rightWall - leftWall, stage.height);
    ctx.clip();
    deinonychusShade.draw(
      ctx,
      boxAround(footX, footY, tile, DEINONYCHUS_SHADE_BOX_TILES),
      DEINONYCHUS_SHADE,
      TITLE_INK.cast.shadow,
      (target) =>
        drawDeinonychusSprite(
          target,
          footX - tile * HALF,
          footY - tile * DEINONYCHUS_GROUND_IN_TILE,
          tile,
          {
            stage: TITLE_DEINONYCHUS_STAGE,
            isMoving: true,
            walkFrame,
            facingX: leftward ? -1 : 1,
            facingY: 0,
          },
        ),
    );
    ctx.restore();
  };

  return {
    id: 'heroes',
    depth: HEROES_DEPTH,
    layout: () => {
      prewarmTitleCast();
      holdIdleRows();
    },
    update: (clock) => warmUpcomingGestures(clock.elapsedMs),
    onEvent: (fire) => {
      if (fire.id === 'deinonychusDash') deinonychusDash = fire;
    },
    render: (ctx, clock, stage, camera) => {
      renderDeinonychus(ctx, clock, stage, camera);

      const tile = heroTile(stage);
      const humanTile = humanHeroTile(stage);
      const pixelRatio = pixelRatioOf(ctx);
      drawnAt = { catTile: tile, humanTile, pixelRatio };
      if (heroCells.beginFrame()) holdIdleRows();
      applyTitleCamera(ctx, camera, HEROES_DEPTH);
      const humanX = stage.heroSpot.x + HUMAN_FOOT_OFFSET_TILES.x * tile;
      const humanY = stage.heroSpot.y + HUMAN_FOOT_OFFSET_TILES.y * tile;
      const catX = stage.heroSpot.x + CAT_FOOT_OFFSET_TILES.x * tile;
      const catY = stage.heroSpot.y + CAT_FOOT_OFFSET_TILES.y * tile;
      const reveal = revealAt(stage);

      ctx.save();
      ctx.globalAlpha *= reveal;
      drawContactShadow(ctx, humanX, humanY, CONTACT_SHADOW_RADIUS_TILES.human * tile);
      drawContactShadow(ctx, catX, catY, CONTACT_SHADOW_RADIUS_TILES.cat * tile);
      ctx.restore();

      const timeMs = clock.elapsedMs;
      const human = humanSelectionAt(timeMs, humanGate);
      const cat = catCellAt(timeMs, catGate);
      const heroBox = boxAround(stage.heroSpot.x, stage.heroSpot.y, tile, HERO_SHADE_BOX_TILES);
      heroShade.draw(
        ctx,
        heroBox,
        DORMANT_SHADE * (1 - reveal),
        TITLE_INK.cast.shadow,
        (target) => {
          const humanLeft = humanX - humanTile * HALF;
          const humanTop = humanY - humanTile * GROUND_OFFSET_IN_TILE;
          const humanFigure = emptyHandedHumanFigure();
          heroCells.draw(
            target,
            humanFigure,
            human.row,
            human.frame,
            humanLeft,
            humanTop,
            humanTile,
            densityOf(humanFigure),
          );
          const catLeft = catX - tile * HALF;
          const catTop = catY - tile * CAT_GROUND_IN_TILE;
          const catFigure = activeCatFigure();
          heroCells.draw(
            target,
            catFigure,
            cat.state,
            cat.frame,
            catLeft,
            catTop,
            tile,
            densityOf(catFigure),
          );
        },
      );
      heroCells.bakeQueued(densityOf);
    },
    dispose: () => {
      heroCells.dispose();
      heroShade.dispose();
      deinonychusShade.dispose();
    },
  };
}
