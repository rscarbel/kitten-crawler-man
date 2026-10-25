/**
 * Illustrations for the Goblin High Security Prison's explainer: a guard's
 * flashlight and a tower spotlight sweeping a dark floor while the human
 * crawler keeps to the shadows, a swing at a crate drawing a guard over to
 * look, and the human
 * breaking out of a holding cell's flimsy door with one punch.
 */

import { GOBLIN_GUARD_FIGURE } from '../../../sprites/art/goblinGuardFigure';
import { figureFrameCount } from '../../../sprites/figure/figureDef';
import { drawGoblinGuardSprite, type GoblinGuardState } from '../../../sprites/goblinGuardSprite';
import { drawHumanSprite } from '../../../sprites/humanSprite';
import { worldPalette } from '../../theme/worldInk';
import { worldText } from '../../world/worldText';
import type { IllustrationRect } from './illustration';

const TWO_PI = Math.PI * 2;
const HALF = 0.5;
const ACTOR_TILE = 48;
const FLOOR_FILL = '#1d1b1e';
const FLOOR_GRID = 'rgba(255,255,255,0.05)';
const FLOOR_RADIUS = 10;
const FLOOR_INSET = 6;
const GRID_STEP = 24;
const SHADOW_FILL = 'rgba(0,0,0,0.45)';
const SHADOW_RX = 14;
const SHADOW_RY = 5;
/** Where a 48px figure's feet are within its tile. */
const FEET_IN_TILE = 0.92;

const CONE_CALM = 'rgba(255,226,150,0.32)';
const CONE_ALERT = 'rgba(255,170,60,0.5)';
const SPOT_CALM = 'rgba(255,244,210,0.3)';
const SPOT_RIM = 'rgba(255,248,225,0.75)';
const SPOT_ALERT = 'rgba(255,170,60,0.5)';
const BEAM_FILL = 'rgba(255,244,210,0.12)';
const TOWER_FILL = '#3b3a40';
const CRATE_FILL = '#7a5530';
const CRATE_EDGE = '#3d2a17';
const BAR_FILL = '#6d7078';
const BAR_EDGE = '#2a2b30';
const PLANK_FILL = '#8a6236';
const PLANK_EDGE = '#3d2a17';
const CHIP_FILL = '#a87a46';

const GUARD_FPS_DIVISOR = 3;
const WALK_PHASE_PER_FRAME = 0.18;

function walkPhase(frame: number): number {
  return (frame * WALK_PHASE_PER_FRAME) % TWO_PI;
}

function floor(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
  const x = rect.x + FLOOR_INSET;
  const y = rect.y + FLOOR_INSET;
  const w = rect.width - FLOOR_INSET * 2;
  const h = rect.height - FLOOR_INSET * 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, FLOOR_RADIUS);
  ctx.fillStyle = FLOOR_FILL;
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = FLOOR_GRID;
  ctx.lineWidth = 1;
  for (let gx = x; gx < x + w; gx += GRID_STEP) {
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + h);
    ctx.stroke();
  }
  for (let gy = y; gy < y + h; gy += GRID_STEP) {
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
    ctx.stroke();
  }
  ctx.restore();
}

function shadow(ctx: CanvasRenderingContext2D, cx: number, feetY: number): void {
  ctx.fillStyle = SHADOW_FILL;
  ctx.beginPath();
  ctx.ellipse(cx, feetY, SHADOW_RX, SHADOW_RY, 0, 0, TWO_PI);
  ctx.fill();
}

/** Draws a 48px figure standing with its feet at `(cx, feetY)`. */
function tileTopLeft(cx: number, feetY: number): { x: number; y: number } {
  return { x: cx - ACTOR_TILE * HALF, y: feetY - ACTOR_TILE * FEET_IN_TILE };
}

function drawHuman(
  ctx: CanvasRenderingContext2D,
  cx: number,
  feetY: number,
  state: Parameters<typeof drawHumanSprite>[4],
): void {
  shadow(ctx, cx, feetY);
  const at = tileTopLeft(cx, feetY);
  drawHumanSprite(ctx, at.x, at.y, ACTOR_TILE, state);
}

function drawGuard(
  ctx: CanvasRenderingContext2D,
  cx: number,
  feetY: number,
  facingX: number,
  state: GoblinGuardState,
  frame: number,
): void {
  shadow(ctx, cx, feetY);
  const at = tileTopLeft(cx, feetY);
  const frames = Math.max(1, figureFrameCount(GOBLIN_GUARD_FIGURE, state));
  drawGoblinGuardSprite(ctx, {
    x: at.x,
    y: at.y,
    tileSize: ACTOR_TILE,
    facingX,
    state,
    frame: Math.floor(frame / GUARD_FPS_DIVISOR) % frames,
  });
}

function suspicionMark(
  ctx: CanvasRenderingContext2D,
  cx: number,
  headY: number,
  text: '?' | '!',
): void {
  worldText(ctx, text, {
    x: cx,
    y: headY,
    style: 'suspicionMark',
    align: 'center',
    baseline: 'alphabetic',
  });
}

interface Cone {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly halfAngle: number;
  readonly range: number;
}

function drawCone(ctx: CanvasRenderingContext2D, cone: Cone, alert: boolean): void {
  const glow = ctx.createRadialGradient(cone.x, cone.y, 0, cone.x, cone.y, cone.range);
  const fill = alert ? CONE_ALERT : CONE_CALM;
  glow.addColorStop(0, fill);
  glow.addColorStop(1, 'rgba(255,226,150,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.moveTo(cone.x, cone.y);
  ctx.arc(cone.x, cone.y, cone.range, cone.angle - cone.halfAngle, cone.angle + cone.halfAngle);
  ctx.closePath();
  ctx.fill();
}

function insideCone(cone: Cone, px: number, py: number): boolean {
  const dx = px - cone.x;
  const dy = py - cone.y;
  if (Math.hypot(dx, dy) > cone.range) return false;
  const offset = Math.atan2(dy, dx) - cone.angle;
  const wrapped = Math.atan2(Math.sin(offset), Math.cos(offset));
  return Math.abs(wrapped) <= cone.halfAngle;
}

// ── Page 1: stay out of the lights ──────────────────────────────────────────

const LIGHTS_PERIOD = 360;
const LIGHTS_GUARD_X = 0.2;
const LIGHTS_GUARD_FEET = 0.62;
const LIGHTS_CONE = { halfAngle: 0.42, range: 150, sweep: 0.45, period: 200 } as const;
const LENS_FORWARD = 14;
const LENS_UP = 22;
const SPOT = { radius: 30, y: 0.66, fromX: 0.58, toX: 0.9, period: 240 } as const;
const TOWER = { x: 0.74, y: 0.12, w: 16, h: 18 } as const;
const HUMAN_PATH = { fromX: 0.34, toX: 0.94, y: 0.92 } as const;
const HEAD_ABOVE_FEET = 46;

export function drawPrisonLightsPage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
): void {
  floor(ctx, rect);
  const guardX = rect.x + rect.width * LIGHTS_GUARD_X;
  const guardFeet = rect.y + rect.height * LIGHTS_GUARD_FEET;
  const sweep = Math.sin((frame / LIGHTS_CONE.period) * TWO_PI) * LIGHTS_CONE.sweep;
  const cone: Cone = {
    x: guardX + LENS_FORWARD,
    y: guardFeet - LENS_UP,
    angle: sweep,
    halfAngle: LIGHTS_CONE.halfAngle,
    range: LIGHTS_CONE.range,
  };

  const spotT = (1 - Math.cos((frame / SPOT.period) * TWO_PI)) * HALF;
  const spotX = rect.x + rect.width * (SPOT.fromX + (SPOT.toX - SPOT.fromX) * spotT);
  const spotY = rect.y + rect.height * SPOT.y;

  const walk = (frame % LIGHTS_PERIOD) / LIGHTS_PERIOD;
  const humanX =
    rect.x + rect.width * (HUMAN_PATH.fromX + (HUMAN_PATH.toX - HUMAN_PATH.fromX) * walk);
  const humanFeet = rect.y + rect.height * HUMAN_PATH.y - FLOOR_INSET;
  const humanBodyY = humanFeet - SHADOW_RY;
  const seenByCone = insideCone(cone, humanX, humanBodyY);
  const seenBySpot = Math.hypot(humanX - spotX, humanBodyY - spotY) <= SPOT.radius;

  drawCone(ctx, cone, seenByCone);

  const towerX = rect.x + rect.width * TOWER.x;
  const towerY = rect.y + rect.height * TOWER.y;
  ctx.fillStyle = BEAM_FILL;
  ctx.beginPath();
  ctx.moveTo(towerX - TOWER.w * HALF, towerY + TOWER.h);
  ctx.lineTo(spotX - SPOT.radius, spotY);
  ctx.lineTo(spotX + SPOT.radius, spotY);
  ctx.lineTo(towerX + TOWER.w * HALF, towerY + TOWER.h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = TOWER_FILL;
  ctx.fillRect(towerX - TOWER.w * HALF, towerY, TOWER.w, TOWER.h);
  ctx.fillStyle = seenBySpot ? SPOT_ALERT : SPOT_CALM;
  ctx.beginPath();
  ctx.ellipse(spotX, spotY, SPOT.radius, SPOT.radius * HALF, 0, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = SPOT_RIM;
  ctx.lineWidth = 2;
  ctx.stroke();

  drawGuard(ctx, guardX, guardFeet, 1, 'sweep', frame);
  if (seenByCone) suspicionMark(ctx, guardX, guardFeet - HEAD_ABOVE_FEET, '?');
  drawHuman(ctx, humanX, humanFeet, {
    isMoving: true,
    walkFrame: walkPhase(frame),
    facingX: 1,
    facingY: 0,
  });
  if (seenBySpot) suspicionMark(ctx, humanX, humanFeet - HEAD_ABOVE_FEET, '!');
}

// ── Page 2: guards hear fighting ────────────────────────────────────────────

const NOISE_PERIOD = 300;
const SWING_AT = 20;
const SWING_FRAMES = 30;
const IMPACT_AT = SWING_AT + SWING_FRAMES * HALF;
const RING_COUNT = 3;
const RING_GAP = 14;
const RING_LIFE = 60;
const RING_GROWTH = 1.6;
const NOISE_HUMAN_X = 0.16;
const NOISE_CRATE_X = 0.3;
const NOISE_FEET_Y = 0.8;
const CRATE_SIZE = 26;
const NOISE_GUARD = { fromX: 0.86, toX: 0.56 } as const;
/** Frames between the thud and the guard turning to it, then before it sets off. */
const HEAR_DELAY = 24;
const SET_OFF_DELAY = 18;
const TURN_AT = IMPACT_AT + HEAR_DELAY;
const WALK_FROM = TURN_AT + SET_OFF_DELAY;
const WALK_FRAMES = 90;
const LOOK_FRAMES = 60;
const NOISE_CONE = { halfAngle: 0.38, range: 120 } as const;

export function drawPrisonNoisePage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
): void {
  floor(ctx, rect);
  const t = frame % NOISE_PERIOD;
  const feetY = rect.y + rect.height * NOISE_FEET_Y;
  const humanX = rect.x + rect.width * NOISE_HUMAN_X;
  const crateX = rect.x + rect.width * NOISE_CRATE_X;

  ctx.fillStyle = CRATE_FILL;
  ctx.strokeStyle = CRATE_EDGE;
  ctx.lineWidth = 2;
  ctx.fillRect(crateX - CRATE_SIZE * HALF, feetY - CRATE_SIZE, CRATE_SIZE, CRATE_SIZE);
  ctx.strokeRect(crateX - CRATE_SIZE * HALF, feetY - CRATE_SIZE, CRATE_SIZE, CRATE_SIZE);

  if (t >= IMPACT_AT && t < IMPACT_AT + RING_LIFE + RING_GAP * RING_COUNT) {
    ctx.strokeStyle = worldPalette.ink.secondary;
    for (let ring = 0; ring < RING_COUNT; ring++) {
      const age = t - IMPACT_AT - ring * RING_GAP;
      if (age < 0 || age > RING_LIFE) continue;
      ctx.globalAlpha = 1 - age / RING_LIFE;
      ctx.beginPath();
      ctx.arc(crateX, feetY - CRATE_SIZE * HALF, age * RING_GROWTH, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    worldText(ctx, 'THUD', {
      x: crateX,
      y: feetY - CRATE_SIZE - FLOOR_INSET,
      style: 'soundWord',
      align: 'center',
      baseline: 'alphabetic',
    });
  }

  const turned = t >= TURN_AT;
  const walking = t >= WALK_FROM && t < WALK_FROM + WALK_FRAMES;
  const walked = Math.min(1, Math.max(0, (t - WALK_FROM) / WALK_FRAMES));
  const looking = t >= WALK_FROM + WALK_FRAMES && t < WALK_FROM + WALK_FRAMES + LOOK_FRAMES;
  const guardX =
    rect.x + rect.width * (NOISE_GUARD.fromX + (NOISE_GUARD.toX - NOISE_GUARD.fromX) * walked);
  const facing = turned ? -1 : 1;
  const cone: Cone = {
    x: guardX + LENS_FORWARD * facing,
    y: feetY - LENS_UP,
    angle: facing < 0 ? Math.PI : 0,
    halfAngle: NOISE_CONE.halfAngle,
    range: NOISE_CONE.range,
  };
  drawCone(ctx, cone, turned);

  const swinging = t >= SWING_AT && t < SWING_AT + SWING_FRAMES;
  drawHuman(ctx, humanX, feetY, {
    attackPhase: swinging ? 'jab_side' : null,
    attackTimer: swinging ? SWING_AT + SWING_FRAMES - t : 0,
    attackFrames: SWING_FRAMES,
    facingX: 1,
    facingY: 0,
  });
  const guardState: GoblinGuardState = walking ? 'walk' : looking ? 'sweep' : 'idle';
  drawGuard(ctx, guardX, feetY, facing, guardState, frame);
  if (turned) suspicionMark(ctx, guardX, feetY - HEAD_ABOVE_FEET, '?');
}

// ── Page 3: caught means a cell, and anything breaks the door ───────────────

const CELL_PERIOD = 200;
const CELL = { x: 0.32, y: 0.18, w: 0.3, h: 0.7 } as const;
const BAR_SPACING = 12;
const BAR_WIDTH = 4;
const DOOR_PLANKS = 3;
const PLANK_HALF_WIDTH = 7;
const DOOR_PLANK_GAP = 2;
const CELL_SWING_AT = 50;
const CELL_SWING_FRAMES = 30;
const BREAK_AT = CELL_SWING_AT + CELL_SWING_FRAMES * HALF;
const FLY_FRAMES = 40;
const FLY_DISTANCE = 46;
const FLY_SPIN = 1.6;
const CHIP_COUNT = 6;
const CHIP_SIZE = 4;
const CHIP_SPREAD = 0.9;
const STEP_OUT_DELAY = 40;
const STEP_OUT_AT = BREAK_AT + STEP_OUT_DELAY;
const STEP_OUT_FRAMES = 60;
const STEP_OUT_DISTANCE = 0.26;

export function drawPrisonCellPage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
): void {
  floor(ctx, rect);
  const t = frame % CELL_PERIOD;
  const left = rect.x + rect.width * CELL.x;
  const top = rect.y + rect.height * CELL.y;
  const w = rect.width * CELL.w;
  const h = rect.height * CELL.h;
  const right = left + w;

  ctx.fillStyle = BAR_FILL;
  ctx.strokeStyle = BAR_EDGE;
  ctx.lineWidth = 1;
  ctx.fillRect(left, top, w, BAR_WIDTH);
  ctx.fillRect(left, top + h - BAR_WIDTH, w, BAR_WIDTH);
  for (let bx = left; bx <= left + w * HALF; bx += BAR_SPACING) {
    ctx.fillRect(bx, top, BAR_WIDTH, h);
    ctx.strokeRect(bx, top, BAR_WIDTH, h);
  }

  const feetY = top + h - BAR_WIDTH * 2;
  const stepOut = Math.min(1, Math.max(0, (t - STEP_OUT_AT) / STEP_OUT_FRAMES));
  const humanX = left + w * HALF + rect.width * STEP_OUT_DISTANCE * stepOut;

  const plankH = (h - DOOR_PLANK_GAP * (DOOR_PLANKS - 1)) / DOOR_PLANKS;
  const broken = t >= BREAK_AT;
  const flight = broken ? Math.min(1, (t - BREAK_AT) / FLY_FRAMES) : 0;
  for (let plank = 0; plank < DOOR_PLANKS; plank++) {
    const py = top + plank * (plankH + DOOR_PLANK_GAP);
    ctx.save();
    ctx.translate(right, py + plankH * HALF);
    if (broken) {
      const spread = plank - (DOOR_PLANKS - 1) * HALF;
      ctx.translate(FLY_DISTANCE * flight, spread * FLY_DISTANCE * HALF * flight);
      ctx.rotate(spread * FLY_SPIN * flight + FLY_SPIN * HALF * flight);
      ctx.globalAlpha = 1 - flight * HALF;
    }
    ctx.fillStyle = PLANK_FILL;
    ctx.strokeStyle = PLANK_EDGE;
    ctx.lineWidth = 2;
    ctx.fillRect(-PLANK_HALF_WIDTH, -plankH * HALF, PLANK_HALF_WIDTH * 2, plankH);
    ctx.strokeRect(-PLANK_HALF_WIDTH, -plankH * HALF, PLANK_HALF_WIDTH * 2, plankH);
    ctx.restore();
  }
  if (broken && flight < 1) {
    ctx.fillStyle = CHIP_FILL;
    for (let chip = 0; chip < CHIP_COUNT; chip++) {
      const angle = (chip / CHIP_COUNT - HALF) * Math.PI * CHIP_SPREAD;
      const reach = FLY_DISTANCE * flight * (1 + (chip % 2) * HALF);
      ctx.fillRect(
        right + Math.cos(angle) * reach,
        top + h * HALF + Math.sin(angle) * reach,
        CHIP_SIZE,
        CHIP_SIZE,
      );
    }
  }

  const swinging = t >= CELL_SWING_AT && t < CELL_SWING_AT + CELL_SWING_FRAMES;
  const walkingOut = t >= STEP_OUT_AT && stepOut < 1;
  drawHuman(ctx, humanX, feetY, {
    attackPhase: swinging ? 'jab_side' : null,
    attackTimer: swinging ? CELL_SWING_AT + CELL_SWING_FRAMES - t : 0,
    attackFrames: CELL_SWING_FRAMES,
    isMoving: walkingOut,
    walkFrame: walkPhase(frame),
    facingX: 1,
    facingY: 0,
  });
}
