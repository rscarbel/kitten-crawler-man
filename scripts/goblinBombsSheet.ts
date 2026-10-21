/**
 * Review sheet for what the bomber goblins throw: the black powder bomb and
 * the goblin dynamite stick in the air, the stick burning down on the floor,
 * both blasts through their lives, and both warning circles. Everything is
 * drawn at the in-game tile size, because that is the only size these are
 * ever seen at, with a zoomed copy of the projectiles beside it.
 *
 * Run through `npm run render:goblins -- --mode=bombs`.
 */

import { createCanvas } from 'canvas';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { writePreviewPng } from './previewOut.js';
import { TILE_SIZE } from '../src/core/constants.js';
import {
  BLACK_POWDER_EXPLOSION_TOTAL_FRAMES,
  drawDynamiteExplosion,
  drawScorchMark,
  EXPLOSION_TOTAL_FRAMES,
  type ExplosionPicture,
} from '../src/sprites/dynamiteExplosion.js';
import {
  drawBlackPowderBombFlight,
  drawBlackPowderExplosion,
  drawThrownBombShadow,
} from '../src/sprites/blackPowderBombSprite.js';
import { drawLitDynamiteStick } from '../src/sprites/dynamiteSprite.js';
import { paintFuseFloorGlow } from '../src/sprites/fuseEffects.js';
import { DANGER_CIRCLE_PALETTE, drawDangerCircle } from '../src/sprites/dangerTelegraph.js';
import {
  BLACK_POWDER_BLAST_RADIUS_PX,
  GOBLIN_DYNAMITE_BLAST_RADIUS_PX,
  activeBomberTuning,
} from '../src/systems/goblinBombConstants.js';

const BACKDROP_DARK = '#2a2622';
const BACKDROP_LIGHT = '#77705f';
const GRID_INK = 'rgba(255,255,255,0.07)';
const LABEL_INK = '#e8e2d8';
const LABEL_FONT = '12px sans-serif';
const LABEL_HEIGHT = 16;
const LABEL_DESCENT = 4;
const PAGE_INK = '#141414';
/** Half a pixel, so a one-pixel grid line lands on a pixel rather than across two. */
const PIXEL_CENTRE = 0.5;
/** Blasts sit low in their cells: the plume needs the room above. */
const BLAST_GROUND_SHARE = 2 / 3;
const PAD = 8;
const SEED = 17;
const FULL_TURN = Math.PI * 2;

const FLIGHT_FRAMES = 8;
/** Game frames between the flight frames shown, so the fuse's sparks visibly move on. */
const FLIGHT_FRAME_STRIDE = 3;
/** Bomb and stick, zoomed; each at size on two floors; each blast on two floors. */
const ZOOMED_ROWS = 2;
const AT_SIZE_ROWS = 4;
const BLAST_ROWS = 4;
const FLIGHT_CELL = TILE_SIZE * 2;
/** Tall enough for the highest shadow height shown plus the object above it. */
const AT_SIZE_CELL = TILE_SIZE * 3;
const ZOOM = 4;
const SHADOW_HEIGHTS_TILES = [0, 0.25, 0.6, 1, 1.5, 2];
const FUSE_SHARES = [1, 0.8, 0.6, 0.4, 0.2, 0.05];
const EXPLOSION_AGES = [0, 2, 4, 7, 11, 16, 24, 36, 55, 80, 105, 130];
const EXPLOSION_CELL = TILE_SIZE * 6;
const CIRCLE_PROGRESS = [0.1, 0.5, 0.9];
const CIRCLE_CELL = TILE_SIZE * 5;
/** The bomb's speed across the screen mid-lob, px per frame, so its trail has somewhere to go. */
const DEMO_VELOCITY_X = 3;
const DEMO_VELOCITY_Y = -1;
const STICK_REST_ANGLE = Math.PI * 0.42;
const URGENT_SHARE = 0.25;

function backdrop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ink: string,
): void {
  ctx.fillStyle = ink;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = GRID_INK;
  ctx.lineWidth = 1;
  for (let gx = x; gx <= x + w; gx += TILE_SIZE) {
    ctx.beginPath();
    ctx.moveTo(gx + PIXEL_CENTRE, y);
    ctx.lineTo(gx + PIXEL_CENTRE, y + h);
    ctx.stroke();
  }
  for (let gy = y; gy <= y + h; gy += TILE_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x, gy + PIXEL_CENTRE);
    ctx.lineTo(x + w, gy + PIXEL_CENTRE);
    ctx.stroke();
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = LABEL_INK;
  ctx.font = LABEL_FONT;
  ctx.fillText(text, x, y + LABEL_HEIGHT - LABEL_DESCENT);
}

function picture(ageFrames: number, radius: number): ExplosionPicture {
  return {
    x: 0,
    y: 0,
    radius,
    coreRadius: radius,
    cores: [{ x: 0, y: 0, delayFrames: 0, seed: SEED }],
    ageFrames,
  };
}

/** Renders the sheet to `out` and returns the written path. */
export function renderGoblinBombSheet(out: string): string {
  installCanvasGlobals();
  const width = PAD * 2 + EXPLOSION_AGES.length * EXPLOSION_CELL;
  const rowsHeight =
    (LABEL_HEIGHT + FLIGHT_CELL * ZOOM + PAD) * ZOOMED_ROWS +
    (LABEL_HEIGHT + AT_SIZE_CELL + PAD) * AT_SIZE_ROWS +
    (LABEL_HEIGHT + EXPLOSION_CELL + PAD) * BLAST_ROWS +
    (LABEL_HEIGHT + CIRCLE_CELL + PAD);
  const canvas = createCanvas(width, rowsHeight + PAD);
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.fillStyle = PAGE_INK;
  ctx.fillRect(0, 0, width, rowsHeight + PAD);
  let y = PAD;

  // Bomb and stick in flight: zoomed for detail, then at size on both floors.
  for (const kind of ['bomb', 'stick'] as const) {
    label(ctx, `${kind} in flight, x${ZOOM} (spin through ${FLIGHT_FRAMES} frames)`, PAD, y);
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < FLIGHT_FRAMES; frame++) {
      const cellX = PAD + frame * FLIGHT_CELL * ZOOM;
      backdrop(
        ctx,
        cellX,
        y,
        FLIGHT_CELL * ZOOM,
        FLIGHT_CELL * ZOOM,
        frame % 2 === 0 ? BACKDROP_DARK : BACKDROP_LIGHT,
      );
      ctx.save();
      ctx.translate(cellX + (FLIGHT_CELL * ZOOM) / 2, y + (FLIGHT_CELL * ZOOM) / 2);
      ctx.scale(ZOOM, ZOOM);
      paintFlying(ctx, kind, frame);
      ctx.restore();
    }
    y += FLIGHT_CELL * ZOOM + PAD;
  }
  for (const kind of ['bomb', 'stick'] as const) {
    for (const floor of [BACKDROP_DARK, BACKDROP_LIGHT]) {
      label(
        ctx,
        `${kind} in flight at size, shadow below at heights ${SHADOW_HEIGHTS_TILES.join('/')} tiles`,
        PAD,
        y,
      );
      y += LABEL_HEIGHT;
      backdrop(ctx, PAD, y, width - PAD * 2, AT_SIZE_CELL, floor);
      for (let frame = 0; frame < FLIGHT_FRAMES; frame++) {
        const cx = PAD + FLIGHT_CELL * (frame + 1 / 2);
        const heightTiles = SHADOW_HEIGHTS_TILES[frame % SHADOW_HEIGHTS_TILES.length] ?? 0;
        const heightPx = heightTiles * TILE_SIZE;
        const groundY = y + AT_SIZE_CELL - TILE_SIZE / 2;
        drawThrownBombShadow(ctx, cx, groundY, heightPx, TILE_SIZE);
        ctx.save();
        ctx.translate(cx, groundY - heightPx);
        paintFlying(ctx, kind, frame);
        ctx.restore();
      }
      // The stick burning down on the floor, with its glow, past the flight frames.
      if (kind === 'stick') {
        FUSE_SHARES.forEach((share, index) => {
          const cx = PAD + FLIGHT_CELL * (FLIGHT_FRAMES + index + 1 / 2) + PAD;
          const cy = y + AT_SIZE_CELL - TILE_SIZE / 2;
          const burn = {
            ageFrames: Math.round((1 - share) * activeBomberTuning().fuse.frames),
            seed: SEED,
            velocityX: 0,
            velocityY: 0,
            urgent: share < URGENT_SHARE,
          };
          paintFuseFloorGlow(ctx, cx, cy, TILE_SIZE, burn);
          drawLitDynamiteStick(ctx, cx, cy, TILE_SIZE, {
            ...burn,
            angle: STICK_REST_ANGLE,
            fuseLeft: share,
          });
        });
      }
      y += AT_SIZE_CELL + PAD;
    }
  }

  // Both blasts through their lives, on both floors.
  const blasts = [
    {
      name: 'dynamite',
      radius: GOBLIN_DYNAMITE_BLAST_RADIUS_PX,
      total: EXPLOSION_TOTAL_FRAMES,
      paint: drawDynamiteExplosion,
    },
    {
      name: 'black powder',
      radius: BLACK_POWDER_BLAST_RADIUS_PX,
      total: BLACK_POWDER_EXPLOSION_TOTAL_FRAMES,
      paint: drawBlackPowderExplosion,
    },
  ];
  for (const blast of blasts) {
    for (const floor of [BACKDROP_DARK, BACKDROP_LIGHT]) {
      label(
        ctx,
        `${blast.name} blast at ages ${EXPLOSION_AGES.join(', ')} (of ${blast.total})`,
        PAD,
        y,
      );
      y += LABEL_HEIGHT;
      EXPLOSION_AGES.forEach((age, index) => {
        const cellX = PAD + index * EXPLOSION_CELL;
        backdrop(ctx, cellX, y, EXPLOSION_CELL, EXPLOSION_CELL, floor);
        const cx = cellX + EXPLOSION_CELL / 2;
        const cy = y + EXPLOSION_CELL * BLAST_GROUND_SHARE;
        ctx.save();
        ctx.beginPath();
        ctx.rect(cellX, y, EXPLOSION_CELL, EXPLOSION_CELL);
        ctx.clip();
        drawScorchMark(ctx, cx, cy, blast.radius, SEED, age);
        if (age < blast.total) blast.paint(ctx, picture(age, blast.radius), -cx, -cy);
        ctx.restore();
      });
      y += EXPLOSION_CELL + PAD;
    }
  }

  // The warning circles: the stick's on the floor filling with its fuse, the bomb's during the lock.
  label(
    ctx,
    `dynamite stick circle (fuse ${CIRCLE_PROGRESS.join('/')}), then black powder lock circle`,
    PAD,
    y,
  );
  y += LABEL_HEIGHT;
  const circles = [
    ...CIRCLE_PROGRESS.map((progress) => ({
      radius: GOBLIN_DYNAMITE_BLAST_RADIUS_PX,
      progress,
      stick: true,
    })),
    ...CIRCLE_PROGRESS.map((progress) => ({
      radius: BLACK_POWDER_BLAST_RADIUS_PX,
      progress,
      stick: false,
    })),
  ];
  circles.forEach((circle, index) => {
    const cellX = PAD + index * CIRCLE_CELL;
    backdrop(
      ctx,
      cellX,
      y,
      CIRCLE_CELL,
      CIRCLE_CELL,
      index % 2 === 0 ? BACKDROP_DARK : BACKDROP_LIGHT,
    );
    const cx = cellX + CIRCLE_CELL / 2;
    const cy = y + CIRCLE_CELL / 2;
    drawDangerCircle(ctx, cx, cy, circle.radius, 1, DANGER_CIRCLE_PALETTE, {
      fillProgress: circle.progress,
    });
    if (circle.stick) {
      const burn = {
        ageFrames: Math.round(circle.progress * activeBomberTuning().fuse.frames),
        seed: SEED,
        velocityX: 0,
        velocityY: 0,
        urgent: 1 - circle.progress < URGENT_SHARE,
      };
      paintFuseFloorGlow(ctx, cx, cy, TILE_SIZE, burn);
      drawLitDynamiteStick(ctx, cx, cy, TILE_SIZE, {
        ...burn,
        angle: STICK_REST_ANGLE,
        fuseLeft: 1 - circle.progress,
      });
    }
  });

  return writePreviewPng(out, canvas.toBuffer('image/png'));
}

function paintFlying(ctx: CanvasRenderingContext2D, kind: 'bomb' | 'stick', frame: number): void {
  const turn = frame / FLIGHT_FRAMES;
  const burn = {
    ageFrames: frame * FLIGHT_FRAME_STRIDE,
    seed: SEED,
    velocityX: DEMO_VELOCITY_X,
    velocityY: DEMO_VELOCITY_Y,
    urgent: false,
  };
  if (kind === 'bomb') {
    drawBlackPowderBombFlight(ctx, 0, 0, TILE_SIZE, { ...burn, spin: turn * FULL_TURN });
    return;
  }
  drawLitDynamiteStick(ctx, 0, 0, TILE_SIZE, { ...burn, angle: turn * FULL_TURN, fuseLeft: 1 });
}
