/**
 * Illustrations for Belle's senses explainer: a scent trail that appears only
 * once control passes to her, her following it from where it starts to where
 * it leads, and her stopping on its strongest patch to sniff. The trail and
 * the ring at her feet are painted with the same painters as in play, so the
 * picture and the street look alike.
 */

import { crawlerDisplayName } from '../../../characters/characters';
import { worldPx } from '../../../core/rendering/camera';
import { ACTIVE_RING_RADIUS_TILES, drawActiveCrawlerRing } from '../../world/activeCrawlerRing';
import {
  catCellFor,
  drawCatSprite,
  type CatOneShotState,
  type CatSpriteState,
} from '../../../sprites/catSprite';
import { selectFacing } from '../../../sprites/facingView';
import { drawHumanSprite } from '../../../sprites/humanSprite';
import type { InputMode } from '../../core/inputMode';
import { framesIn } from '../../screens/dialogs/explainerPages';
import { worldPalette } from '../../theme/worldInk';
import {
  measurePath,
  paintScentTrail,
  paintSenseCueRing,
  type MeasuredPath,
  type SensePaintView,
  type SensePoint,
} from '../../world/worldSenses';
import { worldText } from '../../world/worldText';
import {
  drawKeycap,
  drawMobileSwitchButton,
  drawTap,
  KEY_PRESS_FRAMES,
  KEYCAP_DEPTH,
  KEYCAP_H,
  keycapWidth,
  MOBILE_SWITCH_SIZE,
} from './controlsArt';
import { EXPLAINER_CAT } from './explainerCat';
import type { IllustrationRect } from './illustration';
import { WORLD_TICKS_PER_SECOND } from '../../../core/constants';

const HALF = 0.5;
const TWO_PI = Math.PI * 2;
const MS_PER_SECOND = 1000;
const MS_PER_FRAME = MS_PER_SECOND / WORLD_TICKS_PER_SECOND;

const ACTOR_TILE = 64;
/** Where a figure's feet sit within its tile. */
const FEET_IN_TILE = 0.92;
/** The far edge of the street, and the line every figure's feet stand on, as fractions of the band's height. */
const STREET_TOP_FRACTION = 0.5;
const FEET_FRACTION = 0.8;
const STREET_FILL = '#3a3631';
const STREET_EDGE = '#4d4740';
const STREET_EDGE_PX = 2;
const COBBLE_LINE = 'rgba(255,255,255,0.05)';
const COBBLE_STEP = 22;
const SHADOW_FILL = 'rgba(0,0,0,0.4)';
const SHADOW_RX = 16;
const SHADOW_RY = 5;

const CAT_HEAD_TILES = 0.7;
const RING_RADIUS = ACTOR_TILE * ACTIVE_RING_RADIUS_TILES;

/** How far the trail meanders either side of the feet line, and over how many waves across the band. */
const TRAIL_WAVE_PX = 7;
const TRAIL_WAVES = 2;
const TRAIL_POINTS = 24;
/** How long the trail takes to come up after the switch, as it does in play. */
const TRAIL_FADE_IN_MS = 450;
const TRAIL_FADE_IN_FRAMES = framesIn(TRAIL_FADE_IN_MS);

const WALK_PHASE_PER_FRAME = 0.18;
const CAT_FACING = selectFacing(1, 0);
/** How long her sniff takes, matched to the beat she holds in play. */
const SNIFF_FRAMES = 60;

const CAPTION_SIZE = 14;
const CAPTION_COLOR = '#fde68a';
const CAPTION_TOP = 14;
const CAPTION_FADE_MS = 350;
const CAPTION_FADE_FRAMES = framesIn(CAPTION_FADE_MS);
const LABEL_SIZE = 12;
const LABEL_COLOR = '#e2e8f0';
const LABEL_ABOVE_TRAIL = 30;
const CONTROL_CAPTION_GAP = 6;
const CONTROL_CAPTION_SIZE = 12;
const CONTROL_TOP = 12;
/** The control comes into view a beat before it is pressed, so the eye finds it first. */
const CONTROL_LEAD_MS = 500;
const CONTROL_LEAD_FRAMES = framesIn(CONTROL_LEAD_MS);

const POP_FRAMES = 50;
const POP_RISE_PX = 26;
const POP_SIZE = 15;
const POP_COLOR = '#fde68a';
/** How far over her head the pop starts. */
const POP_ABOVE_HEAD_PX = 36;

const PATCH_RADIUS_X = 44;
const PATCH_RADIUS_Y = 14;
const PATCH_ALPHA = 1;
const PATCH_BREATH_PERIOD_FRAMES = 90;
const PATCH_MIN_SHARE = 0.55;

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

const SMOOTHSTEP_SQUARE = 3;
const SMOOTHSTEP_CUBE = 2;

function smooth(t: number): number {
  return t * t * (SMOOTHSTEP_SQUARE - SMOOTHSTEP_CUBE * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function span(frame: number, start: number, end: number): number {
  return end <= start ? (frame >= end ? 1 : 0) : clamp01((frame - start) / (end - start));
}

function feetY(rect: IllustrationRect): number {
  return rect.y + rect.height * FEET_FRACTION;
}

function at(rect: IllustrationRect, fraction: number): number {
  return rect.x + rect.width * fraction;
}

function drawStreet(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
  const top = rect.y + rect.height * STREET_TOP_FRACTION;
  const bottom = rect.y + rect.height;
  ctx.save();
  ctx.fillStyle = STREET_FILL;
  ctx.fillRect(rect.x, top, rect.width, bottom - top);
  ctx.strokeStyle = COBBLE_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = top + COBBLE_STEP; y < bottom; y += COBBLE_STEP) {
    ctx.moveTo(rect.x, y);
    ctx.lineTo(rect.x + rect.width, y);
  }
  for (let x = rect.x; x < rect.x + rect.width; x += COBBLE_STEP) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  ctx.stroke();
  ctx.fillStyle = STREET_EDGE;
  ctx.fillRect(rect.x, top, rect.width, STREET_EDGE_PX);
  ctx.restore();
}

function shadow(ctx: CanvasRenderingContext2D, cx: number, feet: number): void {
  ctx.fillStyle = SHADOW_FILL;
  ctx.beginPath();
  ctx.ellipse(cx, feet, SHADOW_RX, SHADOW_RY, 0, 0, TWO_PI);
  ctx.fill();
}

function tileTopLeft(cx: number, feet: number): { x: number; y: number } {
  return { x: cx - ACTOR_TILE * HALF, y: feet - ACTOR_TILE * FEET_IN_TILE };
}

function view(rect: IllustrationRect, frame: number): SensePaintView {
  return {
    camX: 0,
    camY: 0,
    width: worldPx(rect.x + rect.width),
    height: worldPx(rect.y + rect.height),
    nowMs: frame * MS_PER_FRAME,
  };
}

/** The trail along the feet line from `from` to `to` (fractions of the band's width), meandering gently. */
function trailPath(rect: IllustrationRect, from: number, to: number): MeasuredPath {
  const points: SensePoint[] = [];
  const feet = feetY(rect);
  for (let index = 0; index <= TRAIL_POINTS; index++) {
    const share = index / TRAIL_POINTS;
    points.push({
      x: at(rect, lerp(from, to, share)),
      y: feet + Math.sin(share * TWO_PI * TRAIL_WAVES) * TRAIL_WAVE_PX,
    });
  }
  return measurePath(points);
}

/** The trail's height under a point `share` of the way along it, so she walks on it. */
function trailYAt(rect: IllustrationRect, share: number): number {
  return feetY(rect) + Math.sin(share * TWO_PI * TRAIL_WAVES) * TRAIL_WAVE_PX;
}

interface CatPose {
  readonly x: number;
  readonly feet: number;
  readonly moving: boolean;
  readonly frame: number;
  readonly active: boolean;
  readonly oneShot?: CatOneShotState | null;
}

function drawCat(ctx: CanvasRenderingContext2D, pose: CatPose): void {
  shadow(ctx, pose.x, pose.feet);
  if (pose.active) drawRing(ctx, pose.x, pose.feet, pose.frame);
  const state: CatSpriteState = {
    facing: CAT_FACING,
    isMoving: pose.moving,
    walkFrame: (pose.frame * WALK_PHASE_PER_FRAME) % TWO_PI,
    oneShot: pose.oneShot ?? null,
  };
  const tile = tileTopLeft(pose.x, pose.feet);
  drawCatSprite(ctx, EXPLAINER_CAT, tile.x, tile.y, ACTOR_TILE, catCellFor(state), state);
}

function drawRing(ctx: CanvasRenderingContext2D, x: number, feet: number, frame: number): void {
  drawActiveCrawlerRing(ctx, { x, y: feet, radiusX: RING_RADIUS, timeMs: frame * MS_PER_FRAME });
}

function drawHuman(ctx: CanvasRenderingContext2D, cx: number, feet: number): void {
  shadow(ctx, cx, feet);
  const tile = tileTopLeft(cx, feet);
  drawHumanSprite(ctx, tile.x, tile.y, ACTOR_TILE, { facingX: 1, facingY: 0 });
}

function caption(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  text: string,
  since: number,
): void {
  if (since < 0) return;
  worldText(ctx, text, {
    x: at(rect, HALF),
    y: rect.y + CAPTION_TOP,
    size: CAPTION_SIZE,
    bold: true,
    color: CAPTION_COLOR,
    outline: true,
    align: 'center',
    alpha: clamp01(since / CAPTION_FADE_FRAMES),
  });
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  worldText(ctx, text, {
    x,
    y,
    size: LABEL_SIZE,
    bold: true,
    color: LABEL_COLOR,
    outline: true,
    align: 'center',
  });
}

function pop(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  since: number,
): void {
  if (since < 0 || since >= POP_FRAMES) return;
  worldText(ctx, text, {
    x,
    y: y - (since / POP_FRAMES) * POP_RISE_PX,
    size: POP_SIZE,
    bold: true,
    color: POP_COLOR,
    outline: true,
    align: 'center',
    alpha: 1 - since / POP_FRAMES,
  });
}

function drawSwitchControl(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  top: number,
  pressedSince: number,
  mode: InputMode,
  switchKey: string,
): void {
  const pressed = pressedSince >= 0 && pressedSince < KEY_PRESS_FRAMES;
  let below: number;
  if (mode === 'touch') {
    drawMobileSwitchButton(ctx, centreX - MOBILE_SWITCH_SIZE * HALF, top, pressed);
    drawTap(ctx, centreX, top + MOBILE_SWITCH_SIZE * HALF, pressedSince);
    below = top + MOBILE_SWITCH_SIZE;
  } else {
    drawKeycap(ctx, centreX - keycapWidth(switchKey) * HALF, top, switchKey, pressed);
    below = top + KEYCAP_H + KEYCAP_DEPTH;
  }
  worldText(ctx, `Switch to ${crawlerDisplayName('cat')}`, {
    x: centreX,
    y: below + CONTROL_CAPTION_GAP,
    size: CONTROL_CAPTION_SIZE,
    bold: true,
    color: LABEL_COLOR,
    outline: true,
    align: 'center',
  });
}

// ── Page 1: only she can see it ─────────────────────────────────────────────

const SWITCH_LOOP_MS = 6000;
const SWITCH_AT_MS = 1600;
const SWITCHED_AT_MS = 2100;
const SWITCH_LOOP_FRAMES = framesIn(SWITCH_LOOP_MS);
const SWITCH_AT = framesIn(SWITCH_AT_MS);
const SWITCHED_AT = framesIn(SWITCHED_AT_MS);
const SWITCH_HUMAN_X = 0.12;
const SWITCH_CAT_X = 0.26;
const SWITCH_TRAIL_FROM = 0.33;
const SWITCH_TRAIL_TO = 0.96;
const SWITCH_CONTROL_X = 0.62;

/**
 * The human is steered and the street looks empty; the switch is pressed,
 * control hops to the cat and her scent trail comes up at her feet.
 */
export function drawCatSensesSwitchPage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  rawFrame: number,
  mode: InputMode,
  switchKey: string,
): void {
  const frame = rawFrame % SWITCH_LOOP_FRAMES;
  drawStreet(ctx, rect);
  const paintView = view(rect, frame);
  const feet = feetY(rect);
  const trailStrength = span(frame, SWITCH_AT, SWITCH_AT + TRAIL_FADE_IN_FRAMES);
  paintScentTrail(
    ctx,
    trailPath(rect, SWITCH_TRAIL_FROM, SWITCH_TRAIL_TO),
    trailStrength,
    paintView,
  );
  const catX = at(rect, SWITCH_CAT_X);
  paintSenseCueRing(ctx, { x: catX, y: feet }, 1, paintView);

  const humanX = at(rect, SWITCH_HUMAN_X);
  const slide = smooth(span(frame, SWITCH_AT, SWITCHED_AT));
  drawRing(ctx, lerp(humanX, catX, slide), feet, frame);
  drawHuman(ctx, humanX, feet);
  drawCat(ctx, { x: catX, feet, moving: false, frame, active: false });

  if (frame >= SWITCH_AT - CONTROL_LEAD_FRAMES && frame < SWITCHED_AT) {
    const controlX = at(rect, SWITCH_CONTROL_X);
    drawSwitchControl(ctx, controlX, rect.y + CONTROL_TOP, frame - SWITCH_AT, mode, switchKey);
  }
  if (frame < SWITCH_AT - CONTROL_LEAD_FRAMES) {
    caption(ctx, rect, `${crawlerDisplayName('cat')}'s portrait glows: something is near`, frame);
  }
  caption(ctx, rect, `Only ${crawlerDisplayName('cat')} can see it`, frame - SWITCHED_AT);
}

// ── Page 2: follow it from the start ───────────────────────────────────────

const FOLLOW_LOOP_MS = 7000;
const FOLLOW_WALK_AT_MS = 1000;
const FOLLOW_WALK_END_MS = 5200;
const FOLLOW_LOOP_FRAMES = framesIn(FOLLOW_LOOP_MS);
const FOLLOW_WALK_AT = framesIn(FOLLOW_WALK_AT_MS);
const FOLLOW_WALK_END = framesIn(FOLLOW_WALK_END_MS);
const FOLLOW_TRAIL_FROM = 0.1;
const FOLLOW_TRAIL_TO = 0.88;
/** How far along the walk she is still near enough the start for the ring to show. */
const FOLLOW_RING_SHARE = 0.25;

/** She stands at the trail's faint start, then walks it to where it leads. */
export function drawCatSensesFollowPage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  rawFrame: number,
): void {
  const frame = rawFrame % FOLLOW_LOOP_FRAMES;
  drawStreet(ctx, rect);
  const paintView = view(rect, frame);
  const feet = feetY(rect);
  paintScentTrail(ctx, trailPath(rect, FOLLOW_TRAIL_FROM, FOLLOW_TRAIL_TO), 1, paintView);

  const walk = span(frame, FOLLOW_WALK_AT, FOLLOW_WALK_END);
  const catX = at(rect, lerp(FOLLOW_TRAIL_FROM, FOLLOW_TRAIL_TO, walk));
  const catFeet = trailYAt(rect, walk);
  const ringStrength = 1 - clamp01(walk / FOLLOW_RING_SHARE);
  paintSenseCueRing(ctx, { x: catX, y: catFeet }, ringStrength, paintView);
  const moving = walk > 0 && walk < 1;
  drawCat(ctx, { x: catX, feet: catFeet, moving, frame, active: true });

  const labelY = feet - ACTOR_TILE - LABEL_ABOVE_TRAIL;
  label(ctx, 'Start here', at(rect, FOLLOW_TRAIL_FROM), labelY);
  label(ctx, 'Where it leads', at(rect, FOLLOW_TRAIL_TO), labelY);
  caption(ctx, rect, 'Follow the wisps the way they drift', frame - FOLLOW_WALK_AT);
}

// ── Page 3: stop and sniff ─────────────────────────────────────────────────

const SNIFF_LOOP_MS = 6000;
const SNIFF_WALK_END_MS = 1800;
/** She settles a beat after she stops before her nose goes down. */
const SNIFF_SETTLE_MS = 200;
const SNIFF_LOOP_FRAMES = framesIn(SNIFF_LOOP_MS);
const SNIFF_WALK_END = framesIn(SNIFF_WALK_END_MS);
const SNIFF_AT = SNIFF_WALK_END + framesIn(SNIFF_SETTLE_MS);
const SNIFF_POP_AT = SNIFF_AT + Math.round(SNIFF_FRAMES * HALF);
const SNIFF_TRAIL_FROM = 0.05;
const SNIFF_TRAIL_TO = 0.95;
const SNIFF_CAT_FROM = 0.18;
const SNIFF_PATCH_X = 0.6;

function strongestPatch(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number): void {
  const ink = worldPalette.senses;
  const breath = HALF - HALF * Math.cos((TWO_PI * frame) / PATCH_BREATH_PERIOD_FRAMES);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, PATCH_RADIUS_Y / PATCH_RADIUS_X);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, PATCH_RADIUS_X);
  glow.addColorStop(0, ink.scentCore);
  glow.addColorStop(HALF, ink.scentHaze);
  glow.addColorStop(1, ink.scentFade);
  ctx.globalAlpha = PATCH_ALPHA * lerp(PATCH_MIN_SHARE, 1, breath);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, PATCH_RADIUS_X, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** She walks onto the trail's strongest patch, stops, and puts her nose down. */
export function drawCatSensesSniffPage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  rawFrame: number,
): void {
  const frame = rawFrame % SNIFF_LOOP_FRAMES;
  drawStreet(ctx, rect);
  const paintView = view(rect, frame);
  const pathFrom = SNIFF_TRAIL_FROM;
  const pathTo = SNIFF_TRAIL_TO;
  const shareOf = (fraction: number): number => (fraction - pathFrom) / (pathTo - pathFrom);
  const patchX = at(rect, SNIFF_PATCH_X);
  const patchY = trailYAt(rect, shareOf(SNIFF_PATCH_X));
  strongestPatch(ctx, patchX, patchY, frame);
  paintScentTrail(ctx, trailPath(rect, pathFrom, pathTo), 1, paintView);

  const walk = smooth(span(frame, 0, SNIFF_WALK_END));
  const catFraction = lerp(SNIFF_CAT_FROM, SNIFF_PATCH_X, walk);
  const catX = at(rect, catFraction);
  const catFeet = trailYAt(rect, shareOf(catFraction));
  const sinceSniff = frame - SNIFF_AT;
  const sniffing = sinceSniff >= 0 && sinceSniff < SNIFF_FRAMES;
  const oneShot: CatOneShotState | null = sniffing
    ? { action: 'sniff', progress: sinceSniff / SNIFF_FRAMES }
    : null;
  drawCat(ctx, { x: catX, feet: catFeet, moving: walk < 1, frame, active: true, oneShot });

  const popY = catFeet - ACTOR_TILE * CAT_HEAD_TILES - POP_ABOVE_HEAD_PX;
  pop(ctx, 'Sniff!', catX, popY, frame - SNIFF_POP_AT);
  if (frame < SNIFF_AT)
    label(ctx, 'Strongest here', patchX, catFeet - ACTOR_TILE - LABEL_ABOVE_TRAIL);
  caption(ctx, rect, 'Stand still on it to sniff', frame - SNIFF_WALK_END);
}

/** Queues her rows so a page never paints a cold figure mid-walk. */
export function prewarmCatSensesArt(): void {
  EXPLAINER_CAT.prewarm();
}
