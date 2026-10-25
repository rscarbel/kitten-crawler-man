/**
 * The illustration for the dual-harvest hint: the human crawler chops alone,
 * the switch is pressed and control passes to the cat, then she mines a
 * boulder while he
 * keeps chopping, both hauls climbing.
 */

import { crawlerName } from '../../../characters/characters';
import type { IllustrationRect } from './illustration';
import {
  BOULDER_KEY,
  chopLoopFrames,
  drawChoppingHuman,
  drawGround,
  drawResourcePop,
  groundY,
  STAGE_TILE,
  standingTile,
  TREE_KEY,
} from './resourcingArt';
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
import { drawSpriteKey } from '../../../core/SpriteRenderer';
import { TOOL_TIER_BASIC } from '../../../core/toolTiers';
import { drawActivePlayerMarker } from '../../../sprites/activePlayerMarker';
import {
  CAT_WORK_SWING_DURATION_TICKS,
  drawCatSprite,
  prewarmCatHold,
  prewarmCatSprite,
  type CatHeldDraw,
  type CatOneShotState,
} from '../../../sprites/catSprite';
import { selectFacing } from '../../../sprites/facingView';
import { workingToolHeldVisual } from '../../../sprites/held/heldVisuals';
import { CAT_WORK_SWING_TICKS } from '../../../systems/WorkChannel';
import type { InputMode } from '../../core/inputMode';
import { framesIn } from '../../screens/dialogs/explainerPages';
import { worldText } from '../../world/worldText';

const LOOP_MS = 6000;
const SWITCH_AT_MS = 1500;
const BOTH_AT_MS = 2000;
/** The control comes into view a beat before it is pressed, so the eye finds it first. */
const CONTROL_LEAD_MS = 500;
const CAPTION_FADE_MS = 350;
const LOOP_FRAMES = framesIn(LOOP_MS);
const SWITCH_AT = framesIn(SWITCH_AT_MS);
const BOTH_AT = framesIn(BOTH_AT_MS);
const CONTROL_LEAD_FRAMES = framesIn(CONTROL_LEAD_MS);
const CAPTION_FADE_FRAMES = framesIn(CAPTION_FADE_MS);

/** Where each figure stands across the band, as a fraction of its width. */
const HUMAN_X = 0.13;
const TREE_X = 0.28;
const CAT_X = 0.71;
const BOULDER_X = 0.87;
/**
 * The oak's crown towers well over its tile; drawn a little under the stage
 * tile it fits the band instead of being cut off at the top.
 */
const TREE_TILE = 48;
const HALF = 0.5;

/** Heights above the ground line the marker floats over each crawler's head. */
const HUMAN_HEAD_TILES = 1.62;
const CAT_HEAD_TILES = 0.92;
const MARKER_RADIUS = 6;
const MARKER_GAP = 9;
/** The marker hops in an arc on its way across, clearing the switch control below it. */
const MARKER_HOP_PX = 16;

/** Low between the two pairs, under the path the marker slides along overhead. */
const CONTROL_ABOVE_GROUND = 76;
const CONTROL_CAPTION_GAP = 6;
const CONTROL_CAPTION = `Switch to ${crawlerName('cat')}`;
const CONTROL_CAPTION_SIZE = 12;
const CONTROL_CAPTION_COLOR = '#e2e8f0';

const BOTH_CAPTION = 'Both gathering!';
const BOTH_CAPTION_SIZE = 16;
const BOTH_CAPTION_COLOR = '#fde68a';
const BOTH_CAPTION_TOP = 18;

const TALLY_SIZE = 12;
const TALLY_COLOR = '#e2e8f0';
/** The running hauls sit in the ground strip, this far below its top edge. */
const TALLY_DROP = 12;

/** Her pickaxe lands this far through each swing, where the stone pops. */
const CAT_IMPACT_PROGRESS = 0.5;
const CAT_IMPACT_FRAMES = Math.round(CAT_WORK_SWING_DURATION_TICKS * CAT_IMPACT_PROGRESS);

const CAT_FACING = selectFacing(1, 0);
const CAT_PICKAXE = workingToolHeldVisual({ kind: 'pickaxe', tier: TOOL_TIER_BASIC });

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Smoothstep, 3t² − 2t³: eases in and out of the marker's slide. */
const SMOOTHSTEP_SQUARE = 3;
const SMOOTHSTEP_CUBE = 2;

function smooth(t: number): number {
  return t * t * (SMOOTHSTEP_SQUARE - SMOOTHSTEP_CUBE * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function catSwingStart(frame: number): number | null {
  if (frame < BOTH_AT) return null;
  return frame - ((frame - BOTH_AT) % CAT_WORK_SWING_TICKS);
}

function catOneShot(frame: number): CatOneShotState | null {
  const start = catSwingStart(frame);
  if (start === null) return null;
  const since = frame - start;
  if (since >= CAT_WORK_SWING_DURATION_TICKS) return null;
  return { action: 'mine', progress: since / CAT_WORK_SWING_DURATION_TICKS };
}

function stoneMined(frame: number): number {
  const sinceFirstImpact = frame - BOTH_AT - CAT_IMPACT_FRAMES;
  if (sinceFirstImpact < 0) return 0;
  return Math.floor(sinceFirstImpact / CAT_WORK_SWING_TICKS) + 1;
}

function drawCat(
  ctx: CanvasRenderingContext2D,
  tile: { readonly x: number; readonly y: number },
  frame: number,
): void {
  const working = frame >= SWITCH_AT;
  const held: CatHeldDraw | null =
    working && CAT_PICKAXE !== null ? { look: CAT_PICKAXE, phase: 0, hold: 'mine' } : null;
  drawCatSprite(
    ctx,
    tile.x,
    tile.y,
    STAGE_TILE,
    {
      facing: CAT_FACING,
      oneShot: catOneShot(frame),
      working: working ? 'mine' : null,
    },
    undefined,
    held,
  );
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  ground: number,
  humanX: number,
  catX: number,
  frame: number,
): void {
  const t = smooth(clamp01((frame - SWITCH_AT) / (BOTH_AT - SWITCH_AT)));
  const x = lerp(humanX, catX, t);
  const headTiles = lerp(HUMAN_HEAD_TILES, CAT_HEAD_TILES, t);
  const hop = Math.sin(Math.PI * t) * MARKER_HOP_PX;
  const y = ground - STAGE_TILE * headTiles - MARKER_GAP - hop;
  drawActivePlayerMarker(ctx, x, y, MARKER_RADIUS);
}

function drawSwitchControl(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  frame: number,
  mode: InputMode,
  switchKey: string,
  ground: number,
): void {
  const top = ground - CONTROL_ABOVE_GROUND;
  const pressed = frame >= SWITCH_AT && frame < SWITCH_AT + KEY_PRESS_FRAMES;
  if (mode === 'touch') {
    const left = centreX - MOBILE_SWITCH_SIZE * HALF;
    drawMobileSwitchButton(ctx, left, top, pressed);
    drawTap(ctx, centreX, top + MOBILE_SWITCH_SIZE * HALF, frame - SWITCH_AT);
    drawControlCaption(ctx, centreX, top + MOBILE_SWITCH_SIZE);
    return;
  }
  drawKeycap(ctx, centreX - keycapWidth(switchKey) * HALF, top, switchKey, pressed);
  drawControlCaption(ctx, centreX, top + KEYCAP_H + KEYCAP_DEPTH);
}

function drawControlCaption(ctx: CanvasRenderingContext2D, centreX: number, above: number): void {
  worldText(ctx, CONTROL_CAPTION, {
    x: centreX,
    y: above + CONTROL_CAPTION_GAP,
    size: CONTROL_CAPTION_SIZE,
    bold: true,
    color: CONTROL_CAPTION_COLOR,
    outline: true,
    align: 'center',
  });
}

function drawTally(ctx: CanvasRenderingContext2D, text: string, x: number, ground: number): void {
  worldText(ctx, text, {
    x,
    y: ground + TALLY_DROP,
    size: TALLY_SIZE,
    bold: true,
    color: TALLY_COLOR,
    outline: true,
    align: 'center',
  });
}

/**
 * The whole loop. `switchKey` labels the pointer keycap; a touch page draws
 * the phone HUD's switch button instead.
 */
export function drawDualHarvestScene(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  rawFrame: number,
  mode: InputMode,
  switchKey: string,
): void {
  const frame = rawFrame % LOOP_FRAMES;
  drawGround(ctx, rect);
  const ground = groundY(rect);
  const at = (fraction: number): number => rect.x + rect.width * fraction;

  const treeX = at(TREE_X);
  drawSpriteKey(ctx, TREE_KEY, 'idle', 0, treeX - TREE_TILE * HALF, ground - TREE_TILE, TREE_TILE);
  const boulder = standingTile(rect, at(BOULDER_X));
  drawSpriteKey(ctx, BOULDER_KEY, 'idle', 0, boulder.x, boulder.y, STAGE_TILE);

  const human = standingTile(rect, at(HUMAN_X));
  drawChoppingHuman(ctx, human, frame);
  const cat = standingTile(rect, at(CAT_X));
  drawCat(ctx, cat, frame);

  const chopFrames = chopLoopFrames();
  const woodPopTile = standingTile(rect, (at(HUMAN_X) + treeX) * HALF);
  drawResourcePop(ctx, '+1 Wood', woodPopTile, frame % chopFrames);
  const swingStart = catSwingStart(frame);
  if (swingStart !== null) {
    drawResourcePop(ctx, '+1 Stone', boulder, frame - swingStart - CAT_IMPACT_FRAMES);
  }

  drawMarker(ctx, ground, at(HUMAN_X), at(CAT_X), frame);

  const woodChopped = Math.floor(frame / chopFrames) + 1;
  drawTally(ctx, `Wood ${woodChopped}`, (at(HUMAN_X) + at(TREE_X)) * HALF, ground);
  drawTally(ctx, `Stone ${stoneMined(frame)}`, (at(CAT_X) + at(BOULDER_X)) * HALF, ground);

  const centreX = (at(TREE_X) + at(CAT_X)) * HALF;
  if (frame >= SWITCH_AT - CONTROL_LEAD_FRAMES && frame < BOTH_AT) {
    drawSwitchControl(ctx, centreX, frame, mode, switchKey, ground);
  }
  if (frame >= BOTH_AT) {
    worldText(ctx, BOTH_CAPTION, {
      x: centreX,
      y: rect.y + BOTH_CAPTION_TOP,
      size: BOTH_CAPTION_SIZE,
      bold: true,
      color: BOTH_CAPTION_COLOR,
      outline: true,
      align: 'center',
      alpha: clamp01((frame - BOTH_AT) / CAPTION_FADE_FRAMES),
    });
  }
}

/** Queues the cat's idle and mining rows so the page never paints a cold figure mid-swing. */
export function prewarmDualHarvestArt(): void {
  prewarmCatSprite();
  prewarmCatHold('mine', CAT_FACING, false);
}
