/**
 * The three-page explainer for Mongo, the cat's velociraptor.
 *
 * Opened once when he is first granted from the Krakaren's chest, and again on
 * request from his entry in the pause menu's Abilities tab. He is the one
 * ability with no tome and no hotbar slot, whose health outlives a summon and
 * who picks his own targets, so none of what the rest of the game teaches about
 * abilities carries over — each page shows one of those rules being played out
 * by the real sprites, and says it in a few lines underneath.
 */

import type { AudioManager } from '../audio/AudioManager';
import { getMongoStats } from '../abilities/mongo';
import { keybindings } from '../core/Keybindings';
import { MONGO_KILL_RECOVERY_FRAMES } from '../core/MongoPetState';
import { platform } from '../core/Platform';
import { mongoMinFightingHp } from '../creatures/Mongo';
import {
  MONGO_BUTTON_LABELS,
  SUMMON_BUTTON_HEIGHT,
  SUMMON_BUTTON_WIDTH,
} from '../systems/MongoSystem';
import { drawActivePlayerMarker } from '../sprites/activePlayerMarker';
import { drawCatSprite, prewarmCatSprite, type CatOneShotState } from '../sprites/catSprite';
import { figureFrameCount } from '../sprites/figure/figureDef';
import { prewarmFigureState } from '../sprites/figure/figureFrameCache';
import {
  drawGoblinSprite,
  GOBLIN_ATTACKS,
  goblinFigure,
  type GoblinState,
} from '../sprites/goblinSprite';
import {
  drawMongoIcon,
  drawMongoSprite,
  mongoActionDuration,
  MONGO_WALK_FRAMES,
  MONGO_WALK_FRAMES_PER_TICK_AT_BASE_SPEED,
  prewarmMongoCombat,
  prewarmMongoWalk,
  type MongoAction,
  type MongoStage,
} from '../sprites/mongoSprite';
import { drawBox, drawProgressBar, PROGRESS_PRESETS } from './Box';
import { BUTTON_PRESETS } from './Button';
import { drawCooldownOverlay } from './CooldownOverlay';
import {
  HowToPlayOverlay,
  type HowToPlayConfig,
  type HowToPlayPage,
  type IllustrationRect,
} from './HowToPlayOverlay';
import { drawText } from './TextBox';

/** The focus-ring id, which the scenes' overlay claims name as well. */
export const MONGO_EXPLAINER_FOCUS_ID = 'mongo-explainer';

/** The frame's header, ring id and closing label, shared with the review harness. */
export const MONGO_EXPLAINER_CONFIG: HowToPlayConfig = {
  title: 'HOW MONGO WORKS',
  focusId: MONGO_EXPLAINER_FOCUS_ID,
  finalLabel: 'Got it!',
};

// ── Shared stage ────────────────────────────────────────────────────────────

/**
 * Every illustration is laid out in a band this tall and as wide as the band's
 * aspect allows, then scaled to the band — so a compact band on a short phone
 * keeps every figure in proportion and spreads the scene sideways instead.
 */
const DESIGN_H = 250;
const WALL_BOTTOM_Y = 118;
const FOOT_Y = 212;
const FLOOR_TILE = 38;
const WALL_COURSE_H = 14;
const WALL_BRICK_W = 34;
const WALL_FILL = '#141b2b';
const WALL_MORTAR = 'rgba(0,0,0,0.35)';
const WALL_LIP_FILL = '#26314a';
const WALL_LIP_H = 5;
const FLOOR_FILL = '#1c2436';
const FLOOR_ALT_FILL = '#1f283c';
const FLOOR_GROUT = 'rgba(0,0,0,0.28)';
const TORCH_GLOW = 'rgba(251,191,36,0.10)';
const TORCH_GLOW_RADIUS = 90;
const TORCH_X_FRACTION = 0.5;
const TORCH_Y = 58;

/** The tile size every creature is drawn at, so they keep their true relative sizes. */
const ACTOR_TILE = 72;
/** Where a figure's feet sit below its tile's top edge, in tiles — measured off the art. */
const SPRITE_FOOT_TILES = 0.95;
/** A figure's horizontal centre inside its tile, in tiles. */
const SPRITE_CENTRE_TILES = 0.5;
/** Where the cat's head sits above her feet, in tiles, for her marker and barks. */
const CAT_HEAD_TILES = 0.72;
const GOBLIN_HEAD_TILES = 0.8;
/** Mongo's head height above his feet, per growth stage, in tiles. */
const MONGO_HEAD_TILES: Record<MongoStage, number> = {
  juvenile: 0.66,
  adolescent: 0.92,
  adult: 1.14,
};
/**
 * How much smaller than true scale each stage is drawn. A grown raptor at the
 * cat's scale spans a third of the band and tramples the controls beside him;
 * shrinking the older stages keeps him the biggest thing in the picture without
 * crowding it.
 */
const MONGO_DRAW_SCALE: Record<MongoStage, number> = {
  juvenile: 1,
  adolescent: 0.85,
  adult: 0.72,
};
const SHADOW_FILL = 'rgba(0,0,0,0.35)';
const SHADOW_RX = 22;
const SHADOW_RY = 5;
const MARKER_RADIUS = 5;
const MARKER_GAP = 9;
const BARK_GAP = 4;
const BARK_TEXT_SIZE = 11;
const BARK_PAD_X = 7;
const BARK_PAD_Y = 5;
const BARK_TAIL = 6;
const BARK_RADIUS = 5;
/** Keeps a bubble over a cat near the band's edge from being clipped by it. */
const BARK_EDGE_MARGIN = 4;
const BARK_FILL = '#f8fafc';
const BARK_BORDER = '#60a5fa';
const BARK_TEXT = '#0f172a';

/** How far one game frame advances his walk cycle at his listed speed — the same rate `Mongo.walkAt` uses. */
const MONGO_WALK_PHASE_PER_FRAME =
  (Math.PI * 2 * MONGO_WALK_FRAMES_PER_TICK_AT_BASE_SPEED) / MONGO_WALK_FRAMES;

const POOF_PUFFS = 7;
const POOF_RADIUS = 26;
const POOF_PUFF_RADIUS = 9;
const POOF_COLOR = '#cbd5e1';
const POOF_RISE = 14;

const CAST_FRAMES = 36;
/** The point in the cast where the bolt leaves her paw. */
const CAST_RELEASE_PROGRESS = 0.55;
const BOLT_FLIGHT_FRAMES = 18;
const BOLT_RADIUS = 5;
const BOLT_GLOW_RADIUS = 13;
const BOLT_CORE = '#e9d5ff';
const BOLT_GLOW = 'rgba(168,85,247,0.45)';
const BOLT_HEIGHT_TILES = 0.4;

const GOBLIN_ARCHETYPE = 'sword';
const GOBLIN_IDLE_FPS = 6;
/** Offsets each goblin's idle so a row of them does not breathe in lockstep. */
const GOBLIN_IDLE_PHASE_STEP = 5;
const FLINCH_HOLD_FRAMES = 2;
const GOBLIN_STATES_DRAWN: readonly GoblinState[] = ['idle', 'attack_light', 'flinch'];

const HALF = 0.5;
const FRAMES_PER_SECOND = 60;
const PERCENT = 100;
const TWO_PI = Math.PI * 2;

// ── Controls: keycaps, taps, the Summon button ──────────────────────────────

const KEYCAP_H = 34;
const KEYCAP_MIN_W = 40;
const KEYCAP_CHAR_W = 10;
const KEYCAP_PAD_X = 12;
const KEYCAP_RADIUS = 6;
const KEYCAP_LABEL_SIZE = 14;
const KEYCAP_DEPTH = 4;
const KEYCAP_SKIRT = '#020617';
const KEYCAP_PRESSED_FILL = '#1e3a5f';
const KEYCAP_PRESSED_BORDER = '#60a5fa';
const KEY_PRESS_FRAMES = 12;
const TAP_RING_FRAMES = 22;
const TAP_RING_MAX_RADIUS = 22;
const TAP_RING_COLOR = 'rgba(255,255,255,0.8)';
const TAP_DOT_RADIUS = 6;
const CAPTION_SIZE = 11;
const CAPTION_COLOR = '#94a3b8';
const CAPTION_ACTIVE_COLOR = '#e2e8f0';
const CAPTION_GAP = 10;
const ARROW_COLOR = '#475569';
const ARROW_SIZE = 16;

/** The mobile HUD's switch control, as the player sees it while playing the human. */
const MOBILE_SWITCH_ICON = '🐱';
const MOBILE_SWITCH_LABEL = 'Cat';
const MOBILE_SWITCH_SIZE = 50;
const MOBILE_SWITCH_ICON_SIZE = 20;
const MOBILE_SWITCH_ICON_Y = 8;
const MOBILE_SWITCH_LABEL_Y = 32;
const MOBILE_SWITCH_LABEL_SIZE = 10;

/** The Summon button drawn larger than it is on the HUD, so its label and bars can be read. */
const BUTTON_MOCK_SCALE = 1.6;
const BUTTON_ICON_SIZE_RATIO = 0.52;
const BUTTON_ICON_Y_OFFSET = 9;
const BUTTON_LABEL_GAP = 12;
const BUTTON_LABEL_SIZE = 8;
const BUTTON_TEXT_INSET = 2;
const BUTTON_HP_BAR_H = 4;
const BUTTON_HP_BAR_INSET = 4;
const BUTTON_HP_BAR_BOTTOM_GAP = 2;
const BUTTON_XP_BAR_H = 2;
const BUTTON_XP_BAR_GAP = 2;
const BUTTON_XP_SHOWN = 0.35;
const BUTTON_READY_COLOR = '#4ade80';
const BUTTON_SPENT_COLOR = '#ef4444';
const BUTTON_XP_COLOR = '#38bdf8';
const BUTTON_ACTIVE_FILL = 'rgba(37,99,235,0.30)';
const BUTTON_ACTIVE_BORDER = '#2563eb';
const BUTTON_IDLE_FILL = 'rgba(0,0,0,0.65)';
const BUTTON_IDLE_BORDER = '#475569';
const BUTTON_PRESSED_FILL = 'rgba(96,165,250,0.35)';
const BUTTON_LIVE_TEXT = '#94a3b8';
const BUTTON_DIM_TEXT = '#64748b';
/** An illustrative pool: what matters is the ratio the bar shows, not the number. */
const ILLUSTRATIVE_MAX_HP = 40;

// ── Page 1: calling him ─────────────────────────────────────────────────────

const CALL_PERIOD = 450;
const CALL_SWITCH_AT = 30;
const CALL_SUMMON_AT = 90;
const CALL_SPAWN_END = 110;
const CALL_RUN_OUT_END = 160;
const CALL_POUNCE_AT = 185;
const CALL_RECALL_AT = 285;
const CALL_RUN_HOME_END = 335;
const CALL_FADE_END = 360;
const CALL_BARK_FRAMES = 70;
const CALL_CAT_X = 0.13;
const CALL_SPAWN_OFFSET = 56;
const CALL_ROAM_X = 0.37;
const CALL_CONTROLS_X = 0.53;
const CALL_SWITCH_ROW_Y = 30;
const CALL_SUMMON_ROW_Y = 104;

// ── Page 2: how he fights ───────────────────────────────────────────────────

const FIGHT_PERIOD = 540;
const FIGHT_FADE_IN_END = 20;
const FIGHT_FADE_OUT_START = 480;
const FIGHT_FADE_OUT_END = 510;
const FIGHT_CAT_X = 0.09;
const FIGHT_MONGO_START_X = 0.17;
const FIGHT_ATTACKER_X = 0.31;
const FIGHT_CAT_TARGET_X = 0.59;
const FIGHT_NEAREST_X = 0.86;
const FIGHT_GOBLIN_X: readonly [number, number, number] = [
  FIGHT_ATTACKER_X,
  FIGHT_CAT_TARGET_X,
  FIGHT_NEAREST_X,
];
/** Where he stands to strike, measured back from his target. */
const STRIKE_STANDOFF = 46;
const FIGHT_POOF_FRAMES = 25;
const FIGHT_CAST_EVERY = 70;
const FIGHT_CAST_FIRST = 10;
const FIGHT_LEGEND_Y = 10;
const FIGHT_LEGEND_GAP = 14;
const FIGHT_LEGEND_SIZE = 11;
const FIGHT_CHIP_RADIUS = 8;
const FIGHT_CHIP_TEXT_SIZE = 10;
const FIGHT_CHIP_GAP = 6;
const FIGHT_CHIP_ABOVE_HEAD = 12;
const FIGHT_CHIP_ACTIVE = '#fbbf24';
const FIGHT_CHIP_IDLE = '#334155';
const FIGHT_CHIP_ACTIVE_TEXT = '#1f2937';
const FIGHT_CHIP_IDLE_TEXT = '#cbd5e1';
const FIGHT_RETICLE_COLOR = 'rgba(248,113,113,0.85)';
const FIGHT_RETICLE_RADIUS = 16;
const FIGHT_RETICLE_TICK = 5;
const FIGHT_RETICLE_SPIN = 0.03;
const FIGHT_RETICLE_TICKS = 4;
const FIGHT_LEGEND: readonly [string, string, string] = [
  'Attacking the Cat',
  "The Cat's target",
  'Nearest',
];

interface Strike {
  readonly action: MongoAction;
  readonly repeats: number;
}

/** One target in turn: the run to it, the blows, and the poof it leaves. */
interface FightLeg {
  readonly runStart: number;
  readonly strikeStart: number;
  readonly strike: Strike;
}

const FIGHT_STRIKES: readonly [Strike, Strike, Strike] = [
  { action: 'bite', repeats: 2 },
  { action: 'slash', repeats: 2 },
  { action: 'pounce', repeats: 1 },
];
const FIGHT_RUN_TO_ATTACKER = 35;
const FIGHT_RUN_TO_CAT_TARGET = 50;
const FIGHT_RUN_TO_NEAREST = 45;
const FIGHT_RUN_FRAMES: readonly [number, number, number] = [
  FIGHT_RUN_TO_ATTACKER,
  FIGHT_RUN_TO_CAT_TARGET,
  FIGHT_RUN_TO_NEAREST,
];
const FIGHT_LEG_GAP = 10;

// ── Page 3: his health ──────────────────────────────────────────────────────

const HEALTH_PERIOD = 600;
const HEALTH_FIGHT_END = 180;
const HEALTH_HP_AFTER_FIGHT = 0.3;
const HEALTH_RETREAT_END = 220;
const HEALTH_RECALL_AT = 245;
const HEALTH_FADE_END = 270;
const HEALTH_KILL_CAST_AT = 300;
const HEALTH_REGEN_END = 540;
const HEALTH_BARK_FRAMES = 70;
const HEALTH_CAT_X = 0.11;
const HEALTH_GOBLIN_X = 0.42;
const HEALTH_BESIDE_CAT = 52;
const HEALTH_BUTTON_X = 0.68;
const HEALTH_BUTTON_Y = 70;
const HEALTH_GOBLIN_SWING_FRAMES = GOBLIN_ATTACKS.sword.light.animFrames;
const HEALTH_BAR_W = 64;
const HEALTH_BAR_H = 7;
const HEALTH_BAR_ABOVE_HEAD = 14;
const HEALTH_THRESHOLD_TICK_COLOR = '#fbbf24';
const HEALTH_THRESHOLD_TICK_OVERHANG = 3;
const HEALTH_THRESHOLD_LABEL_SIZE = 9;
const HEALTH_TOAST_FRAMES = 70;
const HEALTH_TOAST_RISE = 26;
const HEALTH_TOAST_SIZE = 13;
const HEALTH_TOAST_COLOR = '#4ade80';
const HEALTH_TOAST_DECIMALS = 1;
/** How far one kill visibly lifts the bar: one regen tick of twenty-five to full. */
const HEALTH_KILL_BOOST = 0.04;
const HEALTH_CAPTION_Y_GAP = 10;
const HEALTH_CAPTION_OUT = 'Still hurt next time';
const HEALTH_CAPTION_RESTING = 'Heals while recalled';
const HEALTH_CAPTION_FIT = 'Fit to fight again';

// ── Timeline helpers ────────────────────────────────────────────────────────

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/** 0 before `start`, 1 after `end`, linear between. */
function span(frame: number, start: number, end: number): number {
  if (end <= start) return frame >= end ? 1 : 0;
  return clamp01((frame - start) / (end - start));
}

/** Smoothstep: eases in and out of a 0–1 progress. */
function smooth(t: number): number {
  const SMOOTHSTEP_CUBIC = 3;
  const SMOOTHSTEP_SQUARE = 2;
  return t * t * (SMOOTHSTEP_CUBIC - SMOOTHSTEP_SQUARE * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function within(frame: number, start: number, length: number): boolean {
  return frame >= start && frame < start + length;
}

/**
 * Lays the illustration out in a `DESIGN_H`-tall space as wide as the band's
 * aspect gives it, then hands the painter that width.
 */
function inDesignSpace(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  paint: (width: number) => void,
): void {
  const scale = rect.height / DESIGN_H;
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.scale(scale, scale);
  paint(rect.width / scale);
  ctx.restore();
}

// ── Scenery and actors ──────────────────────────────────────────────────────

function drawRoom(ctx: CanvasRenderingContext2D, width: number): void {
  ctx.save();
  ctx.fillStyle = WALL_FILL;
  ctx.fillRect(0, 0, width, WALL_BOTTOM_Y);
  ctx.strokeStyle = WALL_MORTAR;
  ctx.lineWidth = 1;
  for (let y = WALL_COURSE_H, course = 0; y < WALL_BOTTOM_Y; y += WALL_COURSE_H, course++) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    const stagger = course % 2 === 0 ? 0 : WALL_BRICK_W * HALF;
    for (let x = stagger; x < width; x += WALL_BRICK_W) {
      ctx.moveTo(x, y - WALL_COURSE_H);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const glow = ctx.createRadialGradient(
    width * TORCH_X_FRACTION,
    TORCH_Y,
    0,
    width * TORCH_X_FRACTION,
    TORCH_Y,
    TORCH_GLOW_RADIUS,
  );
  glow.addColorStop(0, TORCH_GLOW);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, WALL_BOTTOM_Y);

  for (let y = WALL_BOTTOM_Y, row = 0; y < DESIGN_H; y += FLOOR_TILE, row++) {
    for (let x = 0, col = 0; x < width; x += FLOOR_TILE, col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? FLOOR_FILL : FLOOR_ALT_FILL;
      ctx.fillRect(x, y, FLOOR_TILE, FLOOR_TILE);
    }
  }
  ctx.strokeStyle = FLOOR_GROUT;
  ctx.beginPath();
  for (let y = WALL_BOTTOM_Y; y < DESIGN_H; y += FLOOR_TILE) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  for (let x = 0; x < width; x += FLOOR_TILE) {
    ctx.moveTo(x, WALL_BOTTOM_Y);
    ctx.lineTo(x, DESIGN_H);
  }
  ctx.stroke();
  ctx.fillStyle = WALL_LIP_FILL;
  ctx.fillRect(0, WALL_BOTTOM_Y - WALL_LIP_H, width, WALL_LIP_H);
  ctx.restore();
}

function drawShadow(ctx: CanvasRenderingContext2D, cx: number, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = SHADOW_FILL;
  ctx.beginPath();
  ctx.ellipse(cx, FOOT_Y, SHADOW_RX, SHADOW_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function tileLeft(cx: number, tile = ACTOR_TILE): number {
  return cx - tile * SPRITE_CENTRE_TILES;
}

function tileTop(tile = ACTOR_TILE): number {
  return FOOT_Y - tile * SPRITE_FOOT_TILES;
}

function mongoTile(stage: MongoStage): number {
  return ACTOR_TILE * MONGO_DRAW_SCALE[stage];
}

interface MongoPose {
  readonly x: number;
  readonly facingX: number;
  readonly moving: boolean;
  readonly frame: number;
  readonly action?: MongoAction | null;
  readonly actionProgress?: number;
  readonly alpha?: number;
}

function drawMongo(ctx: CanvasRenderingContext2D, stage: MongoStage, pose: MongoPose): void {
  const alpha = pose.alpha ?? 1;
  if (alpha <= 0) return;
  drawShadow(ctx, pose.x, alpha);
  const tile = mongoTile(stage);
  drawMongoSprite(ctx, tileLeft(pose.x, tile), tileTop(tile), tile, {
    stage,
    walkFrame: pose.frame * MONGO_WALK_PHASE_PER_FRAME,
    isMoving: pose.moving,
    facingX: pose.facingX,
    facingY: 0,
    action: pose.action ?? null,
    actionProgress: pose.actionProgress ?? 0,
    alpha,
  });
}

function drawCat(
  ctx: CanvasRenderingContext2D,
  cx: number,
  options: { readonly active: boolean; readonly oneShot?: CatOneShotState | null },
): void {
  drawShadow(ctx, cx);
  drawCatSprite(ctx, tileLeft(cx), tileTop(), ACTOR_TILE, {
    facingX: 1,
    facingY: 0,
    oneShot: options.oneShot ?? null,
  });
  if (options.active) {
    const headY = FOOT_Y - ACTOR_TILE * CAT_HEAD_TILES;
    drawActivePlayerMarker(ctx, cx, headY - MARKER_GAP, MARKER_RADIUS);
  }
}

/**
 * What the cat says as she gives the order — the same lines `MongoSystem` has
 * her say in play, so the picture and the game agree.
 */
function catBark(ctx: CanvasRenderingContext2D, cx: number, text: string): void {
  ctx.save();
  ctx.font = `bold ${BARK_TEXT_SIZE}px monospace`;
  const textWidth = ctx.measureText(text).width;
  ctx.restore();
  const boxW = textWidth + BARK_PAD_X * 2;
  const boxH = BARK_TEXT_SIZE + BARK_PAD_Y * 2;
  const tailTipY = FOOT_Y - ACTOR_TILE * CAT_HEAD_TILES - BARK_GAP;
  const boxY = tailTipY - BARK_TAIL - boxH;
  const boxX = Math.max(BARK_EDGE_MARGIN, cx - boxW * HALF);
  ctx.save();
  ctx.fillStyle = BARK_FILL;
  ctx.beginPath();
  ctx.moveTo(cx - BARK_TAIL, boxY + boxH - 1);
  ctx.lineTo(cx, tailTipY);
  ctx.lineTo(cx + BARK_TAIL, boxY + boxH - 1);
  ctx.fill();
  ctx.restore();
  drawBox(ctx, {
    x: boxX,
    y: boxY,
    width: boxW,
    height: boxH,
    fill: BARK_FILL,
    border: BARK_BORDER,
    borderWidth: 1,
    radius: BARK_RADIUS,
  });
  drawText(ctx, text, {
    size: BARK_TEXT_SIZE,
    bold: true,
    x: boxX + BARK_PAD_X,
    y: boxY + BARK_PAD_Y,
    color: BARK_TEXT,
  });
}

function goblinFrame(state: GoblinState, frame: number): number {
  const count = figureFrameCount(goblinFigure(GOBLIN_ARCHETYPE), state);
  if (count === 0) return 0;
  return Math.floor(frame) % count;
}

function drawGoblin(
  ctx: CanvasRenderingContext2D,
  cx: number,
  state: GoblinState,
  frame: number,
  alpha = 1,
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  drawShadow(ctx, cx);
  drawGoblinSprite(ctx, {
    archetype: GOBLIN_ARCHETYPE,
    x: tileLeft(cx),
    y: tileTop(),
    tileSize: ACTOR_TILE,
    facingX: -1,
    state,
    frame,
  });
  ctx.restore();
}

/** The goblin's idle loop, from the frame clock. */
function goblinIdleFrame(frame: number): number {
  const idleFrames = (frame / FRAMES_PER_SECOND) * GOBLIN_IDLE_FPS;
  return goblinFrame('idle', idleFrames);
}

/** Its light swing, looped — spread across the swing's frames the way the mob plays it. */
function goblinSwingFrame(frame: number): number {
  const { spriteFrames, animFrames } = GOBLIN_ATTACKS.sword.light;
  const progress = (frame % animFrames) / animFrames;
  return Math.floor(progress * spriteFrames);
}

function drawPoof(ctx: CanvasRenderingContext2D, cx: number, t: number): void {
  if (t <= 0 || t >= 1) return;
  const centreY = FOOT_Y - ACTOR_TILE * HALF * HALF - POOF_RISE * t;
  ctx.save();
  ctx.globalAlpha *= 1 - t;
  ctx.fillStyle = POOF_COLOR;
  for (let i = 0; i < POOF_PUFFS; i++) {
    const angle = (i / POOF_PUFFS) * TWO_PI;
    const reach = POOF_RADIUS * smooth(t);
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(angle) * reach,
      centreY + Math.sin(angle) * reach * HALF,
      POOF_PUFF_RADIUS * (1 - t * HALF),
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawBolt(ctx: CanvasRenderingContext2D, fromX: number, toX: number, t: number): void {
  if (t <= 0 || t >= 1) return;
  const x = lerp(fromX, toX, t);
  const y = FOOT_Y - ACTOR_TILE * BOLT_HEIGHT_TILES;
  ctx.save();
  ctx.fillStyle = BOLT_GLOW;
  ctx.beginPath();
  ctx.arc(x, y, BOLT_GLOW_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = BOLT_CORE;
  ctx.beginPath();
  ctx.arc(x, y, BOLT_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** Her cast, as a one-shot the sprite can draw, while `frame` is inside it. */
function castOneShot(frame: number, castAt: number): CatOneShotState | null {
  if (!within(frame, castAt, CAST_FRAMES)) return null;
  return { action: 'cast', progress: (frame - castAt) / CAST_FRAMES };
}

/** How far a bolt cast at `castAt` has flown, 0–1, or 0 before it leaves her paw. */
function boltFlight(frame: number, castAt: number): number {
  const releaseAt = castAt + CAST_FRAMES * CAST_RELEASE_PROGRESS;
  return span(frame, releaseAt, releaseAt + BOLT_FLIGHT_FRAMES);
}

// ── Controls ────────────────────────────────────────────────────────────────

function keycapWidth(label: string): number {
  return Math.max(KEYCAP_MIN_W, label.length * KEYCAP_CHAR_W + KEYCAP_PAD_X * 2);
}

/** A keycap with a visible skirt, sunk while the key is held. */
function drawKeycap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  pressed: boolean,
): number {
  const width = keycapWidth(label);
  const sink = pressed ? KEYCAP_DEPTH : 0;
  drawBox(ctx, {
    x,
    y: y + KEYCAP_DEPTH,
    width,
    height: KEYCAP_H,
    fill: KEYCAP_SKIRT,
    radius: KEYCAP_RADIUS,
  });
  drawBox(ctx, {
    x,
    y: y + sink,
    width,
    height: KEYCAP_H,
    fill: pressed ? KEYCAP_PRESSED_FILL : BUTTON_PRESETS.keyChip.fill,
    border: pressed ? KEYCAP_PRESSED_BORDER : BUTTON_PRESETS.keyChip.border,
    borderWidth: BUTTON_PRESETS.keyChip.borderWidth,
    radius: KEYCAP_RADIUS,
    glow: pressed ? KEYCAP_PRESSED_BORDER : undefined,
  });
  drawText(ctx, label, {
    x: x + width * HALF,
    y: y + sink + (KEYCAP_H - KEYCAP_LABEL_SIZE) * HALF,
    size: KEYCAP_LABEL_SIZE,
    bold: true,
    color: BUTTON_PRESETS.keyChip.labelColor,
    align: 'center',
  });
  return width;
}

/** A fingertip landing: a dot and a ring spreading from it. */
function drawTap(ctx: CanvasRenderingContext2D, cx: number, cy: number, sinceTap: number): void {
  if (sinceTap < 0 || sinceTap >= TAP_RING_FRAMES) return;
  const t = sinceTap / TAP_RING_FRAMES;
  ctx.save();
  ctx.strokeStyle = TAP_RING_COLOR;
  ctx.fillStyle = TAP_RING_COLOR;
  ctx.globalAlpha *= 1 - t;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, TAP_RING_MAX_RADIUS * t, 0, TWO_PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, TAP_DOT_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function drawMobileSwitchButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pressed: boolean,
): void {
  drawBox(ctx, {
    x,
    y,
    width: MOBILE_SWITCH_SIZE,
    height: MOBILE_SWITCH_SIZE,
    fill: pressed ? BUTTON_PRESSED_FILL : BUTTON_IDLE_FILL,
    border: BUTTON_IDLE_BORDER,
    borderWidth: 1.5,
    radius: KEYCAP_RADIUS,
  });
  drawText(ctx, MOBILE_SWITCH_ICON, {
    x: x + MOBILE_SWITCH_SIZE * HALF,
    y: y + MOBILE_SWITCH_ICON_Y,
    size: MOBILE_SWITCH_ICON_SIZE,
    align: 'center',
  });
  drawText(ctx, MOBILE_SWITCH_LABEL, {
    x: x + MOBILE_SWITCH_SIZE * HALF,
    y: y + MOBILE_SWITCH_LABEL_Y,
    size: MOBILE_SWITCH_LABEL_SIZE,
    color: CAPTION_ACTIVE_COLOR,
    align: 'center',
  });
}

interface SummonButtonFace {
  readonly label: string;
  readonly hpRatio: number;
  /** Out on the field: the button is the Recall control. */
  readonly out: boolean;
  /** Healthy enough to be sent in. */
  readonly fit: boolean;
  readonly pressed: boolean;
  readonly cooldown?: { readonly remainingFrames: number; readonly totalFrames: number };
}

/**
 * The HUD's Summon button, drawn to its real proportions and scaled up.
 *
 * An illustration, not a control: drawn from boxes rather than `drawButton`, so
 * it never joins the focus ring or the click-sound registry of the panel it
 * sits in.
 */
function drawSummonButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  stage: MongoStage,
  face: SummonButtonFace,
): void {
  const w = SUMMON_BUTTON_WIDTH;
  const h = SUMMON_BUTTON_HEIGHT;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(BUTTON_MOCK_SCALE, BUTTON_MOCK_SCALE);
  const idleFill = face.pressed ? BUTTON_PRESSED_FILL : BUTTON_IDLE_FILL;
  drawBox(ctx, {
    x: 0,
    y: 0,
    width: w,
    height: h,
    fill: face.out ? BUTTON_ACTIVE_FILL : idleFill,
    border: face.out ? BUTTON_ACTIVE_BORDER : BUTTON_IDLE_BORDER,
    borderWidth: 1.5,
    radius: 0,
  });
  drawMongoIcon(
    ctx,
    stage,
    w * HALF,
    h * HALF - BUTTON_ICON_Y_OFFSET,
    Math.min(w, h) * BUTTON_ICON_SIZE_RATIO,
  );
  const hpBarY = h - BUTTON_HP_BAR_H - BUTTON_HP_BAR_BOTTOM_GAP;
  const xpBarY = hpBarY - BUTTON_XP_BAR_H - BUTTON_XP_BAR_GAP;
  const textRowY = xpBarY - BUTTON_LABEL_GAP;
  const usable = face.out || face.fit;
  const textColor = usable ? BUTTON_LIVE_TEXT : BUTTON_DIM_TEXT;
  drawText(ctx, face.label, {
    x: BUTTON_TEXT_INSET,
    y: textRowY,
    size: BUTTON_LABEL_SIZE,
    color: textColor,
  });
  const hpShown = Math.round(face.hpRatio * ILLUSTRATIVE_MAX_HP);
  drawText(ctx, `${hpShown}/${ILLUSTRATIVE_MAX_HP}`, {
    x: w - BUTTON_TEXT_INSET,
    y: textRowY,
    size: BUTTON_LABEL_SIZE - 1,
    color: textColor,
    align: 'right',
  });
  drawProgressBar(ctx, {
    x: BUTTON_HP_BAR_INSET,
    y: xpBarY,
    width: w - BUTTON_HP_BAR_INSET * 2,
    height: BUTTON_XP_BAR_H,
    value: BUTTON_XP_SHOWN,
    ...PROGRESS_PRESETS.xp,
    fill: BUTTON_XP_COLOR,
  });
  drawProgressBar(ctx, {
    x: BUTTON_HP_BAR_INSET,
    y: hpBarY,
    width: w - BUTTON_HP_BAR_INSET * 2,
    height: BUTTON_HP_BAR_H,
    value: face.hpRatio,
    ...PROGRESS_PRESETS.hp,
    fill: usable ? BUTTON_READY_COLOR : BUTTON_SPENT_COLOR,
  });
  if (face.cooldown !== undefined) {
    drawCooldownOverlay(ctx, { x: 0, y: 0, width: w, height: h, ...face.cooldown });
  }
  ctx.restore();
}

function drawArrowRight(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  drawText(ctx, '→', { x, y, size: ARROW_SIZE, bold: true, color: ARROW_COLOR });
}

function caption(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, lit: boolean) {
  drawText(ctx, text, {
    x,
    y,
    size: CAPTION_SIZE,
    color: lit ? CAPTION_ACTIVE_COLOR : CAPTION_COLOR,
  });
}

// ── Page 1 ──────────────────────────────────────────────────────────────────

interface Labels {
  readonly isMobile: boolean;
  readonly switchKey: string;
  readonly summonKey: string;
  readonly followKey: string;
}

function mongoOnCallPage(frame: number, width: number): MongoPose | null {
  const catX = width * CALL_CAT_X;
  const spawnX = catX + CALL_SPAWN_OFFSET;
  const roamX = width * CALL_ROAM_X;
  if (frame < CALL_SUMMON_AT || frame >= CALL_FADE_END) return null;
  const alpha =
    frame < CALL_SPAWN_END
      ? span(frame, CALL_SUMMON_AT, CALL_SPAWN_END)
      : 1 - span(frame, CALL_RUN_HOME_END, CALL_FADE_END);
  if (frame < CALL_SPAWN_END) {
    return { x: spawnX, facingX: 1, moving: false, frame, alpha };
  }
  if (frame < CALL_RUN_OUT_END) {
    const t = span(frame, CALL_SPAWN_END, CALL_RUN_OUT_END);
    return { x: lerp(spawnX, roamX, t), facingX: 1, moving: true, frame, alpha };
  }
  const pounceFrames = mongoActionDuration('pounce');
  if (within(frame, CALL_POUNCE_AT, pounceFrames)) {
    const actionProgress = (frame - CALL_POUNCE_AT) / pounceFrames;
    return { x: roamX, facingX: 1, moving: false, frame, action: 'pounce', actionProgress };
  }
  if (frame < CALL_RECALL_AT) return { x: roamX, facingX: -1, moving: false, frame, alpha };
  const t = span(frame, CALL_RECALL_AT, CALL_RUN_HOME_END);
  return { x: lerp(roamX, spawnX, t), facingX: -1, moving: t < 1, frame, alpha };
}

function drawCallPage(
  ctx: CanvasRenderingContext2D,
  stage: MongoStage,
  labels: Labels,
  rawFrame: number,
  width: number,
): void {
  const frame = rawFrame % CALL_PERIOD;
  drawRoom(ctx, width);

  const catX = width * CALL_CAT_X;
  const catActive = frame >= CALL_SWITCH_AT;
  drawCat(ctx, catX, { active: catActive });
  const mongo = mongoOnCallPage(frame, width);
  if (mongo !== null) drawMongo(ctx, stage, mongo);
  if (within(frame, CALL_SUMMON_AT, CALL_BARK_FRAMES)) catBark(ctx, catX, 'Mongo!');
  if (within(frame, CALL_RECALL_AT, CALL_BARK_FRAMES)) catBark(ctx, catX, 'Mongo, come back!');

  const controlsX = width * CALL_CONTROLS_X;
  const switchPressed = within(frame, CALL_SWITCH_AT, KEY_PRESS_FRAMES);
  const summonPressed =
    within(frame, CALL_SUMMON_AT, KEY_PRESS_FRAMES) ||
    within(frame, CALL_RECALL_AT, KEY_PRESS_FRAMES);
  const out = mongo !== null && frame < CALL_RUN_HOME_END;
  const face: SummonButtonFace = {
    label: out ? MONGO_BUTTON_LABELS.recall : MONGO_BUTTON_LABELS.summon,
    hpRatio: 1,
    out,
    fit: true,
    pressed: labels.isMobile && summonPressed,
  };

  if (labels.isMobile) {
    drawMobileSwitchButton(ctx, controlsX, CALL_SWITCH_ROW_Y, switchPressed);
    drawTap(
      ctx,
      controlsX + MOBILE_SWITCH_SIZE * HALF,
      CALL_SWITCH_ROW_Y + MOBILE_SWITCH_SIZE * HALF,
      frame - CALL_SWITCH_AT,
    );
    caption(
      ctx,
      'Switch to the Cat',
      controlsX + MOBILE_SWITCH_SIZE + CAPTION_GAP,
      CALL_SWITCH_ROW_Y + MOBILE_SWITCH_SIZE * HALF - CAPTION_SIZE * HALF,
      catActive,
    );
    drawSummonButton(ctx, controlsX, CALL_SUMMON_ROW_Y, stage, face);
    const buttonW = SUMMON_BUTTON_WIDTH * BUTTON_MOCK_SCALE;
    const buttonH = SUMMON_BUTTON_HEIGHT * BUTTON_MOCK_SCALE;
    const lastTap = frame >= CALL_RECALL_AT ? frame - CALL_RECALL_AT : frame - CALL_SUMMON_AT;
    drawTap(ctx, controlsX + buttonW * HALF, CALL_SUMMON_ROW_Y + buttonH * HALF, lastTap);
    caption(
      ctx,
      'Summon · Recall',
      controlsX + buttonW + CAPTION_GAP,
      CALL_SUMMON_ROW_Y + buttonH * HALF - CAPTION_SIZE * HALF,
      out,
    );
    return;
  }

  const switchW = drawKeycap(ctx, controlsX, CALL_SWITCH_ROW_Y, labels.switchKey, switchPressed);
  caption(
    ctx,
    'Switch to the Cat',
    controlsX + switchW + CAPTION_GAP,
    CALL_SWITCH_ROW_Y + (KEYCAP_H - CAPTION_SIZE) * HALF,
    catActive,
  );
  const buttonH = SUMMON_BUTTON_HEIGHT * BUTTON_MOCK_SCALE;
  const keyY = CALL_SUMMON_ROW_Y + (buttonH - KEYCAP_H) * HALF;
  const summonW = drawKeycap(ctx, controlsX, keyY, labels.summonKey, summonPressed);
  const arrowX = controlsX + summonW + CAPTION_GAP;
  drawArrowRight(ctx, arrowX, keyY + (KEYCAP_H - ARROW_SIZE) * HALF);
  drawSummonButton(ctx, arrowX + ARROW_SIZE + CAPTION_GAP, CALL_SUMMON_ROW_Y, stage, face);
  caption(
    ctx,
    `Summon · press again to recall`,
    controlsX,
    CALL_SUMMON_ROW_Y + buttonH + CAPTION_GAP,
    out,
  );
}

// ── Page 2 ──────────────────────────────────────────────────────────────────

function fightLegs(): readonly FightLeg[] {
  const legs: FightLeg[] = [];
  let cursor = FIGHT_FADE_IN_END;
  FIGHT_STRIKES.forEach((strike, i) => {
    const runStart = cursor;
    const strikeStart = runStart + FIGHT_RUN_FRAMES[i];
    legs.push({ runStart, strikeStart, strike });
    cursor = strikeStart + mongoActionDuration(strike.action) * strike.repeats + FIGHT_LEG_GAP;
  });
  return legs;
}

const FIGHT_LEGS = fightLegs();

function legEnd(leg: FightLeg): number {
  return leg.strikeStart + mongoActionDuration(leg.strike.action) * leg.strike.repeats;
}

function drawFightPage(
  ctx: CanvasRenderingContext2D,
  stage: MongoStage,
  rawFrame: number,
  width: number,
): void {
  const frame = rawFrame % FIGHT_PERIOD;
  drawRoom(ctx, width);

  const sceneAlpha = Math.min(
    span(frame, 0, FIGHT_FADE_IN_END),
    1 - span(frame, FIGHT_FADE_OUT_START, FIGHT_FADE_OUT_END),
  );
  ctx.save();
  ctx.globalAlpha *= sceneAlpha;

  const catX = width * FIGHT_CAT_X;
  const goblinXs = FIGHT_GOBLIN_X.map((fraction) => fraction * width);
  const legIndex = FIGHT_LEGS.findIndex((leg) => frame < legEnd(leg));
  const currentTarget = legIndex;

  // The cat keeps casting at her own target until Mongo takes it off her.
  const catTargetAlive = frame < legEnd(FIGHT_LEGS[1]);
  const castAt = catTargetAlive ? latestCast(frame) : null;
  drawCat(ctx, catX, {
    active: true,
    oneShot: castAt === null ? null : castOneShot(frame, castAt),
  });

  goblinXs.forEach((gx, i) => {
    const leg = FIGHT_LEGS[i];
    const deathAt = legEnd(leg);
    const poof = span(frame, deathAt, deathAt + FIGHT_POOF_FRAMES);
    if (frame < deathAt) {
      drawGoblin(ctx, gx, ...goblinPose(i, frame, leg, castAt));
      drawPriorityChip(ctx, gx, i, currentTarget === i);
    }
    drawPoof(ctx, gx, poof);
  });

  if (castAt !== null) drawBolt(ctx, catX, goblinXs[1], boltFlight(frame, castAt));
  if (catTargetAlive) drawReticle(ctx, goblinXs[1], frame);

  drawMongo(ctx, stage, mongoOnFightPage(frame, width, goblinXs));
  drawLegend(ctx, width, currentTarget);
  ctx.restore();
}

function latestCast(frame: number): number | null {
  if (frame < FIGHT_CAST_FIRST) return null;
  const since = frame - FIGHT_CAST_FIRST;
  return FIGHT_CAST_FIRST + Math.floor(since / FIGHT_CAST_EVERY) * FIGHT_CAST_EVERY;
}

/** What a goblin is doing: the first swings at the cat, the second flinches from her bolts. */
function goblinPose(
  index: number,
  frame: number,
  leg: FightLeg,
  castAt: number | null,
): [GoblinState, number] {
  const beingBitten = frame >= leg.strikeStart;
  if (beingBitten) {
    const strikeFrames = mongoActionDuration(leg.strike.action);
    const intoBlow = (frame - leg.strikeStart) % strikeFrames;
    const flinchFrames = figureFrameCount(goblinFigure(GOBLIN_ARCHETYPE), 'flinch');
    const flinchLength = flinchFrames * FLINCH_HOLD_FRAMES;
    const hitAt = strikeFrames * HALF;
    if (intoBlow >= hitAt && intoBlow < hitAt + flinchLength) {
      return ['flinch', Math.floor((intoBlow - hitAt) / FLINCH_HOLD_FRAMES)];
    }
  }
  if (index === 0) return ['attack_light', goblinSwingFrame(frame)];
  if (index === 1 && castAt !== null) {
    const flight = boltFlight(frame, castAt);
    const landedAt = castAt + CAST_FRAMES * CAST_RELEASE_PROGRESS + BOLT_FLIGHT_FRAMES;
    const sinceLanding = frame - landedAt;
    const flinchFrames = figureFrameCount(goblinFigure(GOBLIN_ARCHETYPE), 'flinch');
    if (flight >= 1 && sinceLanding < flinchFrames * FLINCH_HOLD_FRAMES) {
      return ['flinch', Math.floor(sinceLanding / FLINCH_HOLD_FRAMES)];
    }
  }
  return ['idle', goblinIdleFrame(frame + index * GOBLIN_IDLE_PHASE_STEP)];
}

function mongoOnFightPage(frame: number, width: number, goblinXs: readonly number[]): MongoPose {
  const startX = width * FIGHT_MONGO_START_X;
  let fromX = startX;
  for (let i = 0; i < FIGHT_LEGS.length; i++) {
    const leg = FIGHT_LEGS[i];
    const standX = (goblinXs[i] ?? startX) - STRIKE_STANDOFF;
    if (frame < leg.runStart) return { x: fromX, facingX: 1, moving: false, frame };
    if (frame < leg.strikeStart) {
      const t = span(frame, leg.runStart, leg.strikeStart);
      return { x: lerp(fromX, standX, t), facingX: 1, moving: true, frame };
    }
    if (frame < legEnd(leg)) {
      const strikeFrames = mongoActionDuration(leg.strike.action);
      const intoBlow = (frame - leg.strikeStart) % strikeFrames;
      return {
        x: standX,
        facingX: 1,
        moving: false,
        frame,
        action: leg.strike.action,
        actionProgress: intoBlow / strikeFrames,
      };
    }
    fromX = standX;
  }
  return { x: fromX, facingX: -1, moving: false, frame };
}

function drawPriorityChip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  index: number,
  active: boolean,
): void {
  const cy = FOOT_Y - ACTOR_TILE * GOBLIN_HEAD_TILES - FIGHT_CHIP_ABOVE_HEAD;
  drawChip(ctx, cx, cy, index, active);
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  index: number,
  active: boolean,
): void {
  ctx.save();
  ctx.fillStyle = active ? FIGHT_CHIP_ACTIVE : FIGHT_CHIP_IDLE;
  ctx.beginPath();
  ctx.arc(cx, cy, FIGHT_CHIP_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
  drawText(ctx, String(index + 1), {
    x: cx,
    y: cy - FIGHT_CHIP_TEXT_SIZE * HALF,
    size: FIGHT_CHIP_TEXT_SIZE,
    bold: true,
    color: active ? FIGHT_CHIP_ACTIVE_TEXT : FIGHT_CHIP_IDLE_TEXT,
    align: 'center',
  });
}

function drawReticle(ctx: CanvasRenderingContext2D, cx: number, frame: number): void {
  const cy = FOOT_Y - ACTOR_TILE * BOLT_HEIGHT_TILES;
  ctx.save();
  ctx.strokeStyle = FIGHT_RETICLE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, FIGHT_RETICLE_RADIUS, 0, TWO_PI);
  ctx.stroke();
  const tickStep = TWO_PI / FIGHT_RETICLE_TICKS;
  for (let i = 0; i < FIGHT_RETICLE_TICKS; i++) {
    const angle = frame * FIGHT_RETICLE_SPIN + i * tickStep;
    const inner = FIGHT_RETICLE_RADIUS - FIGHT_RETICLE_TICK;
    const outer = FIGHT_RETICLE_RADIUS + FIGHT_RETICLE_TICK;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }
  ctx.restore();
}

/** The key to the numbered chips, across the top of the wall. */
function drawLegend(ctx: CanvasRenderingContext2D, width: number, activeIndex: number): void {
  ctx.save();
  ctx.font = `${FIGHT_LEGEND_SIZE}px monospace`;
  const entryWidths = FIGHT_LEGEND.map(
    (text) => FIGHT_CHIP_RADIUS * 2 + FIGHT_CHIP_GAP + ctx.measureText(text).width,
  );
  ctx.restore();
  const total =
    entryWidths.reduce((sum, w) => sum + w, 0) + FIGHT_LEGEND_GAP * (entryWidths.length - 1);
  let x = (width - total) * HALF;
  const chipY = FIGHT_LEGEND_Y + FIGHT_CHIP_RADIUS;
  FIGHT_LEGEND.forEach((text, i) => {
    const lit = i === activeIndex;
    drawChip(ctx, x + FIGHT_CHIP_RADIUS, chipY, i, lit);
    drawText(ctx, text, {
      x: x + FIGHT_CHIP_RADIUS * 2 + FIGHT_CHIP_GAP,
      y: chipY - FIGHT_LEGEND_SIZE * HALF,
      size: FIGHT_LEGEND_SIZE,
      color: lit ? CAPTION_ACTIVE_COLOR : CAPTION_COLOR,
    });
    x += (entryWidths[i] ?? 0) + FIGHT_LEGEND_GAP;
  });
}

// ── Page 3 ──────────────────────────────────────────────────────────────────

/** His health across the page's loop: worn down, held, then climbing while he rests. */
function healthAt(frame: number, killBoostAt: number): number {
  if (frame < HEALTH_FIGHT_END) {
    const swings = Math.floor(frame / HEALTH_GOBLIN_SWING_FRAMES);
    const totalSwings = Math.floor(HEALTH_FIGHT_END / HEALTH_GOBLIN_SWING_FRAMES);
    return lerp(1, HEALTH_HP_AFTER_FIGHT, swings / totalSwings);
  }
  if (frame < HEALTH_FADE_END) return HEALTH_HP_AFTER_FIGHT;
  const regen = lerp(HEALTH_HP_AFTER_FIGHT, 1, span(frame, HEALTH_FADE_END, HEALTH_REGEN_END));
  const boost = frame >= killBoostAt ? HEALTH_KILL_BOOST : 0;
  return Math.min(1, regen + boost);
}

function drawHealthPage(
  ctx: CanvasRenderingContext2D,
  stage: MongoStage,
  minFightingFraction: number,
  rawFrame: number,
  width: number,
): void {
  const frame = rawFrame % HEALTH_PERIOD;
  drawRoom(ctx, width);

  const catX = width * HEALTH_CAT_X;
  const goblinX = width * HEALTH_GOBLIN_X;
  const castAt = HEALTH_KILL_CAST_AT;
  const killLandsAt = castAt + CAST_FRAMES * CAST_RELEASE_PROGRESS + BOLT_FLIGHT_FRAMES;
  const hp = healthAt(frame, killLandsAt);

  drawCat(ctx, catX, { active: true, oneShot: castOneShot(frame, castAt) });
  drawBolt(ctx, catX, goblinX, boltFlight(frame, castAt));
  if (frame < killLandsAt) {
    const fighting = frame < HEALTH_FIGHT_END;
    const state: GoblinState = fighting ? 'attack_light' : 'idle';
    const goblinFrameIndex = fighting ? goblinSwingFrame(frame) : goblinIdleFrame(frame);
    drawGoblin(ctx, goblinX, state, goblinFrameIndex);
  }
  drawPoof(ctx, goblinX, span(frame, killLandsAt, killLandsAt + FIGHT_POOF_FRAMES));

  const pose = mongoOnHealthPage(frame, catX, goblinX);
  if (pose !== null) {
    drawMongo(ctx, stage, pose);
    drawMongoHealthBar(ctx, stage, pose, hp, minFightingFraction);
  }
  if (within(frame, HEALTH_RECALL_AT, HEALTH_BARK_FRAMES)) catBark(ctx, catX, 'Rest up, Mongo.');

  const buttonX = width * HEALTH_BUTTON_X;
  const out = frame < HEALTH_FADE_END;
  const fit = hp >= minFightingFraction;
  const restingSpan = span(frame, HEALTH_FADE_END, HEALTH_REGEN_END);
  const framesToFit = Math.max(
    0,
    ((minFightingFraction - hp) / (1 - HEALTH_HP_AFTER_FIGHT)) *
      (HEALTH_REGEN_END - HEALTH_FADE_END),
  );
  const totalToFit =
    ((minFightingFraction - HEALTH_HP_AFTER_FIGHT) / (1 - HEALTH_HP_AFTER_FIGHT)) *
    (HEALTH_REGEN_END - HEALTH_FADE_END);
  const face: SummonButtonFace = {
    label: out
      ? MONGO_BUTTON_LABELS.recall
      : fit
        ? MONGO_BUTTON_LABELS.summon
        : MONGO_BUTTON_LABELS.resting,
    hpRatio: hp,
    out,
    fit,
    pressed: within(frame, HEALTH_RECALL_AT, KEY_PRESS_FRAMES),
    cooldown:
      out || fit || restingSpan <= 0
        ? undefined
        : { remainingFrames: framesToFit, totalFrames: totalToFit },
  };
  drawSummonButton(ctx, buttonX, HEALTH_BUTTON_Y, stage, face);

  const buttonW = SUMMON_BUTTON_WIDTH * BUTTON_MOCK_SCALE;
  const buttonH = SUMMON_BUTTON_HEIGHT * BUTTON_MOCK_SCALE;
  const sinceKill = frame - killLandsAt;
  if (sinceKill >= 0 && sinceKill < HEALTH_TOAST_FRAMES) {
    const t = sinceKill / HEALTH_TOAST_FRAMES;
    const seconds = MONGO_KILL_RECOVERY_FRAMES / FRAMES_PER_SECOND;
    ctx.save();
    ctx.globalAlpha *= 1 - t * t;
    drawText(ctx, `-${seconds.toFixed(HEALTH_TOAST_DECIMALS)}s`, {
      x: buttonX + buttonW * HALF,
      y: HEALTH_BUTTON_Y - HEALTH_TOAST_SIZE - HEALTH_TOAST_RISE * t,
      size: HEALTH_TOAST_SIZE,
      bold: true,
      color: HEALTH_TOAST_COLOR,
      align: 'center',
      outline: true,
    });
    ctx.restore();
  }
  const buttonCaption = out
    ? HEALTH_CAPTION_OUT
    : fit
      ? HEALTH_CAPTION_FIT
      : HEALTH_CAPTION_RESTING;
  drawText(ctx, buttonCaption, {
    x: buttonX + buttonW * HALF,
    y: HEALTH_BUTTON_Y + buttonH + HEALTH_CAPTION_Y_GAP,
    size: CAPTION_SIZE,
    color: out ? CAPTION_COLOR : CAPTION_ACTIVE_COLOR,
    align: 'center',
  });
}

function mongoOnHealthPage(frame: number, catX: number, goblinX: number): MongoPose | null {
  const fightX = goblinX - STRIKE_STANDOFF;
  const besideCatX = catX + HEALTH_BESIDE_CAT;
  if (frame < HEALTH_FIGHT_END) {
    const biteFrames = mongoActionDuration('bite');
    return {
      x: fightX,
      facingX: 1,
      moving: false,
      frame,
      action: 'bite',
      actionProgress: (frame % biteFrames) / biteFrames,
    };
  }
  if (frame < HEALTH_RETREAT_END) {
    const t = span(frame, HEALTH_FIGHT_END, HEALTH_RETREAT_END);
    return { x: lerp(fightX, besideCatX, t), facingX: -1, moving: true, frame };
  }
  if (frame >= HEALTH_FADE_END) return null;
  const alpha = 1 - span(frame, HEALTH_RECALL_AT, HEALTH_FADE_END);
  return { x: besideCatX, facingX: 1, moving: false, frame, alpha };
}

function drawMongoHealthBar(
  ctx: CanvasRenderingContext2D,
  stage: MongoStage,
  pose: MongoPose,
  hp: number,
  minFightingFraction: number,
): void {
  const alpha = pose.alpha ?? 1;
  const barX = pose.x - HEALTH_BAR_W * HALF;
  const barY = FOOT_Y - mongoTile(stage) * MONGO_HEAD_TILES[stage] - HEALTH_BAR_ABOVE_HEAD;
  ctx.save();
  ctx.globalAlpha *= alpha;
  drawProgressBar(ctx, {
    x: barX,
    y: barY,
    width: HEALTH_BAR_W,
    height: HEALTH_BAR_H,
    value: hp,
    ...PROGRESS_PRESETS.hp,
    fill: hp >= minFightingFraction ? BUTTON_READY_COLOR : BUTTON_SPENT_COLOR,
  });
  const tickX = barX + HEALTH_BAR_W * minFightingFraction;
  ctx.strokeStyle = HEALTH_THRESHOLD_TICK_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tickX, barY - HEALTH_THRESHOLD_TICK_OVERHANG);
  ctx.lineTo(tickX, barY + HEALTH_BAR_H + HEALTH_THRESHOLD_TICK_OVERHANG);
  ctx.stroke();
  ctx.restore();
  drawText(ctx, `${Math.round(minFightingFraction * PERCENT)}%`, {
    x: tickX,
    y: barY - HEALTH_THRESHOLD_TICK_OVERHANG - HEALTH_THRESHOLD_LABEL_SIZE - 1,
    size: HEALTH_THRESHOLD_LABEL_SIZE,
    bold: true,
    color: HEALTH_THRESHOLD_TICK_COLOR,
    align: 'center',
    alpha,
  });
}

// ── Copy and pages ──────────────────────────────────────────────────────────

/** The health below which he will not be sent in, as a fraction of his maximum. */
function minFightingFractionOfHealth(): number {
  return mongoMinFightingHp(PERCENT) / PERCENT;
}

function currentLabels(isMobile: boolean): Labels {
  return {
    isMobile,
    switchKey: keybindings.labelFor('switchCharacter'),
    summonKey: keybindings.labelFor('buildSummon'),
    followKey: keybindings.labelFor('companionFollow'),
  };
}

function callLines(labels: Labels): readonly string[] {
  if (labels.isMobile) {
    return [
      'Mongo answers to the Cat. Tap the Cat button to switch to her, then tap Summon.',
      'Tap it again — it reads Recall while he is out — to call him back. He runs home to her.',
      "Stuck somewhere? Tap Recall once more while he's on his way and he's brought straight to you.",
    ];
  }
  const summon = `[${labels.summonKey}]`;
  return [
    `Mongo answers to the Cat. Press [${labels.switchKey}] to switch to her, then ${summon} to summon him.`,
    `Press ${summon} again to call him back. He runs home to her.`,
    `Stuck somewhere? Press ${summon} once more while he's on his way and he's brought straight to you.`,
  ];
}

function fightLines(labels: Labels): readonly string[] {
  const whereToTurnOff = labels.isMobile
    ? 'Settings or the follower menu'
    : `Settings or the follower menu [${labels.followKey}]`;
  return [
    'He picks his own fights: first whatever is attacking the Cat, then whatever she is hitting, then the nearest enemy.',
    `While you play the human, the Cat sends him in herself when enemies come close. Turn that off in ${whereToTurnOff}.`,
    'He follows you indoors too.',
  ];
}

function healthLines(minFightingFraction: number): readonly string[] {
  const percent = Math.round(minFightingFraction * PERCENT);
  return [
    'Damage stays with him between summons, and he only heals while recalled.',
    `Below ${percent}% health he won't go in — the button reads Resting until he's fit.`,
    'Knocked out, he runs home and must heal all the way to full. Every kill while he rests speeds that up.',
  ];
}

/**
 * The three pages, with key labels read from the live bindings and touch
 * wording on a phone. Built fresh on every open, so a rebind made since the
 * last one is what the page says.
 */
export function buildMongoExplainerPages(
  stage: MongoStage,
  isMobile: boolean,
): readonly HowToPlayPage[] {
  const labels = currentLabels(isMobile);
  const minFightingFraction = minFightingFractionOfHealth();
  return [
    {
      subtitle: 'Calling him',
      lines: callLines(labels),
      drawIllustration: (ctx, rect, frame) =>
        inDesignSpace(ctx, rect, (width) => drawCallPage(ctx, stage, labels, frame, width)),
    },
    {
      subtitle: 'How he fights',
      lines: fightLines(labels),
      drawIllustration: (ctx, rect, frame) =>
        inDesignSpace(ctx, rect, (width) => drawFightPage(ctx, stage, frame, width)),
    },
    {
      subtitle: 'His health',
      lines: healthLines(minFightingFraction),
      drawIllustration: (ctx, rect, frame) =>
        inDesignSpace(ctx, rect, (width) =>
          drawHealthPage(ctx, stage, minFightingFraction, frame, width),
        ),
    },
  ];
}

/** Queues every row the illustrations draw, so no page paints a cold figure mid-animation. */
function prewarmExplainerArt(stage: MongoStage): void {
  prewarmMongoWalk(stage);
  prewarmMongoCombat(stage);
  prewarmCatSprite();
  const goblin = goblinFigure(GOBLIN_ARCHETYPE);
  for (const state of GOBLIN_STATES_DRAWN) prewarmFigureState(goblin, state);
}

export class MongoExplainer {
  private readonly overlay: HowToPlayOverlay;

  /**
   * @param petLevel His current pet level, so the pages draw the animal the
   *   player actually has rather than a stock adult.
   */
  constructor(
    audio: AudioManager | null,
    private readonly petLevel: () => number,
    clockMs?: () => number,
  ) {
    this.overlay = new HowToPlayOverlay(audio, MONGO_EXPLAINER_CONFIG, clockMs);
  }

  get isOpen(): boolean {
    return this.overlay.isOpen;
  }

  get currentPage(): number {
    return this.overlay.currentPage;
  }

  open(): void {
    const stage = getMongoStats(this.petLevel()).stage;
    prewarmExplainerArt(stage);
    this.overlay.open(buildMongoExplainerPages(stage, platform.isMobile));
  }

  close(): void {
    this.overlay.close();
  }

  advance(): void {
    this.overlay.advance();
  }

  handleClick(mx: number, my: number): boolean {
    return this.overlay.handleClick(mx, my);
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.overlay.render(ctx);
  }

  /** The overlay at a chosen illustration frame, for the review harness. */
  renderFrame(ctx: CanvasRenderingContext2D, frame: number): void {
    this.overlay.renderFrame(ctx, frame);
  }
}
