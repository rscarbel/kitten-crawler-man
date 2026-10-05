/**
 * Sprites for the defend-NPC quest:
 *  - The goblin mother with her baby, painted by `art/goblinMotherArt.ts`
 *  - Yellow/green exclamation/question mark
 *  - Her toddler, from the same painter
 *  - The Anchor quest's wood pile pickup (the nursery's own props are in `nurserySprites.ts`)
 */
import { timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import { worldText, worldTextInkExtent, type WorldTextInkExtent } from '../ui/world/worldText';
import {
  GOBLIN_MOTHER_FIGURE,
  GOBLIN_TODDLER_FIGURE,
  MOTHER_HURT_FPS,
  MOTHER_IDLE_FPS,
  type MotherRow,
  TODDLER_IDLE_FPS,
  TODDLER_IDLE_FRAMES,
  TODDLER_WALK_FRAMES,
} from './art/goblinMotherFigure';
import { type DrawnFigureRow, figureFrameCount, drawnFigureRow } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState, touchFigureState } from './figure/figureFrameCache';
import { deferAboveDarkness } from '../systems/lighting/aboveDarkness';

// ── Goblin mother ───────────────────────────────────────────────────────────

const MS_TO_SECONDS = 1000;

const NPC_BUBBLE_FADE_FRAMES = 15;
const NPC_BUBBLE_W = 0.92;
const NPC_BUBBLE_H = 0.28;
const NPC_BUBBLE_OFFSET_X = 0.04;
/** The bubble clears the scarf's knot and the hand she waves above it. */
const NPC_BUBBLE_OFFSET_Y = 0.9;
const NPC_BUBBLE_CORNER_R = 0.07;
const NPC_BUBBLE_LINE_W = 0.03;
const NPC_BUBBLE_TAIL_LEFT = 0.62;
const NPC_BUBBLE_TAIL_MID = 0.5;
const NPC_BUBBLE_TAIL_RIGHT = 0.38;
const NPC_BUBBLE_TAIL_DROP = 0.2;
const NPC_BUBBLE_TEXT_SIZE_RATIO = 0.2;
const NPC_BUBBLE_TEXT_CENTER_X = 0.5;
const NPC_BUBBLE_TEXT_CENTER_Y = 0.5;

/**
 * The goblin mother, cradling her baby. `hurtTimer` above zero plays her call
 * for help — the baby clutched tight, her free arm waving — with a "Help!!!"
 * bubble fading out over its last frames. Faces toward +X unless `facingX` is
 * negative.
 */
export function drawQuestNPCSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  facingX = 1,
  hurtTimer = 0,
): DrawnFigureRow {
  const hurt = hurtTimer > 0;
  const row: MotherRow = hurt ? 'hurt' : 'idle';
  const seconds = performance.now() / MS_TO_SECONDS;
  const fps = hurt ? MOTHER_HURT_FPS : MOTHER_IDLE_FPS;
  const frame = timeFrameIndex(seconds, fps, figureFrameCount(GOBLIN_MOTHER_FIGURE, row));
  drawFigureCached(ctx, GOBLIN_MOTHER_FIGURE, row, frame, sx, sy, s, { flipX: facingX < 0 });
  // Her alarm row plays on the first blow, which lands with no telegraph, and
  // each of its cells costs a couple of milliseconds to paint. Holding it warm
  // for as long as she is on screen keeps that first hit from stalling a frame.
  if (!hurt && !touchFigureState(GOBLIN_MOTHER_FIGURE, 'hurt')) {
    prewarmFigureState(GOBLIN_MOTHER_FIGURE, 'hurt');
  }

  if (hurt) {
    const bubbleAlpha = Math.min(1, hurtTimer / NPC_BUBBLE_FADE_FRAMES);
    ctx.save();
    ctx.globalAlpha = bubbleAlpha;

    const bw = s * NPC_BUBBLE_W;
    const bh = s * NPC_BUBBLE_H;
    const bx = sx + s * NPC_BUBBLE_OFFSET_X;
    const by = sy - s * NPC_BUBBLE_OFFSET_Y;
    const r = s * NPC_BUBBLE_CORNER_R;

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = s * NPC_BUBBLE_LINE_W;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    ctx.lineTo(bx + bw * NPC_BUBBLE_TAIL_LEFT, by + bh);
    ctx.lineTo(bx + bw * NPC_BUBBLE_TAIL_MID, by + bh + s * NPC_BUBBLE_TAIL_DROP);
    ctx.lineTo(bx + bw * NPC_BUBBLE_TAIL_RIGHT, by + bh);
    ctx.lineTo(bx + r, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const helpFontSize = Math.floor(s * NPC_BUBBLE_TEXT_SIZE_RATIO);
    worldText(ctx, 'Help!!!', {
      x: bx + bw * NPC_BUBBLE_TEXT_CENTER_X,
      y: by + bh * NPC_BUBBLE_TEXT_CENTER_Y - helpFontSize / 2,
      size: helpFontSize,
      bold: true,
      family: 'sans-serif',
      color: '#ef4444',
      alpha: bubbleAlpha,
      align: 'center',
    });

    ctx.restore();
  }
  return drawnFigureRow(GOBLIN_MOTHER_FIGURE, row);
}

/** The top edge of her "Help!!!" bubble while she is hurt, for anything stacked over it. */
export function questNPCHelpBubbleTop(sy: number, s: number): number {
  return sy - s * NPC_BUBBLE_OFFSET_Y;
}

// ── Exclamation/question mark constants ──────────────────────────────────────

const EXCLAMATION_BOUNCE_FREQ = 3;
const EXCLAMATION_BOUNCE_AMP = 0.04;
const EXCLAMATION_CENTER_X = 0.5;
const EXCLAMATION_FONT_SIZE_RATIO = 0.45;
const EXCLAMATION_OUTLINE_WIDTH = 3;
const EXCLAMATION_GLOW_BLUR = 8;
const EXCLAMATION_FONT = 'monospace';
/**
 * Clear air between the marker at the bottom of its bounce and the top of the
 * art it floats over, in screen pixels. Enough that the glyph's black outline
 * never reads as touching a hat brim or an ear tip.
 */
export const QUEST_MARKER_HEAD_GAP_PX = 3;

/** Standard gold of an available-quest marker. */
export const QUEST_MARKER_GOLD = '#fbbf24';
/** Standard green of a turn-in marker. */
export const QUEST_MARKER_GREEN = '#4ade80';

/** The two overhead glyphs quest-givers wear. */
export type QuestMarkerGlyph = '!' | '?';

/** What a quest giver has for the player: something to say, something to hand in, or nothing. */
export type QuestMarkerState = 'exclamation' | 'question' | 'none';

/**
 * The colour of a marker state, or `undefined` for a giver with nothing to say.
 *
 * Shared so a giver's glyph and its beacon are painted from one branch on one
 * state. Drawn from two branches they drift: a state added to one and not the
 * other leaves an NPC with a column of light and no glyph, or the reverse.
 */
export function questMarkerColorFor(state: QuestMarkerState): string | undefined {
  if (state === 'exclamation') return QUEST_MARKER_GOLD;
  if (state === 'question') return QUEST_MARKER_GREEN;
  return undefined;
}

const glyphInkBySize = new Map<QuestMarkerGlyph, Map<number, WorldTextInkExtent>>();

/** Where the glyph's ink sits below its text `y`, measured once per glyph and size. */
function glyphInk(ctx: CanvasRenderingContext2D, glyph: QuestMarkerGlyph, size: number) {
  let bySize = glyphInkBySize.get(glyph);
  if (bySize === undefined) {
    bySize = new Map<number, WorldTextInkExtent>();
    glyphInkBySize.set(glyph, bySize);
  }
  let ink = bySize.get(size);
  if (ink === undefined) {
    ink = worldTextInkExtent(ctx, glyph, { size, bold: true, family: EXCLAMATION_FONT });
    bySize.set(size, ink);
  }
  return ink;
}

/** The marker's glyph size and its text `y` at rest, for art ending at `artTopY`. */
function markerLayout(
  ctx: CanvasRenderingContext2D,
  artTopY: number,
  s: number,
  glyph: QuestMarkerGlyph,
) {
  const bounceAmplitude = s * EXCLAMATION_BOUNCE_AMP;
  const glyphFontSize = Math.floor(s * EXCLAMATION_FONT_SIZE_RATIO);
  const ink = glyphInk(ctx, glyph, glyphFontSize);
  const outlineHalfWidth = EXCLAMATION_OUTLINE_WIDTH / 2;
  const lowestInkBelowTextY = ink.bottom + outlineHalfWidth;
  const restingTextY = artTopY - QUEST_MARKER_HEAD_GAP_PX - bounceAmplitude - lowestInkBelowTextY;
  const highestInkBelowTextY = ink.top - outlineHalfWidth;
  return { bounceAmplitude, glyphFontSize, restingTextY, highestInkBelowTextY };
}

/**
 * The screen y of the marker's highest pixel at the top of its bounce, for the
 * same `artTopY`, `s` and glyph handed to {@link drawQuestMarker} — the line a
 * bubble or label stacked over a marked NPC has to stay above.
 */
export function questMarkerTopY(
  ctx: CanvasRenderingContext2D,
  artTopY: number,
  s: number,
  glyph: QuestMarkerGlyph,
): number {
  const layout = markerLayout(ctx, artTopY, s, glyph);
  return layout.restingTextY - layout.bounceAmplitude + layout.highestInkBelowTextY;
}

/**
 * Bouncing overhead quest marker, hung over whatever it marks.
 *
 * `artTopY` is the screen y of the highest pixel the wearer paints — its hat,
 * crest or ear tips at the tallest point of its animation, or a health bar or
 * prompt above that — and the marker places itself from it: the glyph's lowest
 * pixel, outline included, at the very bottom of its bounce still sits
 * {@link QUEST_MARKER_HEAD_GAP_PX} above that line. Callers say where their art
 * ends; how far the glyph hangs and bounces is decided here alone.
 *
 * `sx` and `s` are the box the glyph centres over and is sized from.
 *
 * The glyph is a parameter rather than something inferred from `color`:
 * deriving it by string-comparing the colour to the turn-in green would make
 * any caller with a slightly different hex silently show an exclamation.
 */
export function drawQuestMarker(
  ctx: CanvasRenderingContext2D,
  sx: number,
  artTopY: number,
  s: number,
  glyph: QuestMarkerGlyph,
  color: string,
) {
  // Drawn from inside the entity pass, it waits for the dungeon's darkness so
  // a quest marker is never dimmed by it.
  if (deferAboveDarkness((target) => drawQuestMarker(target, sx, artTopY, s, glyph, color))) {
    return;
  }
  const t = performance.now() / MS_TO_SECONDS;
  const { bounceAmplitude, glyphFontSize, restingTextY } = markerLayout(ctx, artTopY, s, glyph);
  const bounce = Math.sin(t * EXCLAMATION_BOUNCE_FREQ) * bounceAmplitude;
  const cx = sx + s * EXCLAMATION_CENTER_X;

  ctx.save();
  worldText(ctx, glyph, {
    x: cx,
    y: restingTextY + bounce,
    size: glyphFontSize,
    bold: true,
    family: EXCLAMATION_FONT,
    color,
    align: 'center',
    outline: '#000',
    outlineWidth: EXCLAMATION_OUTLINE_WIDTH,
    glow: color,
    glowBlur: EXCLAMATION_GLOW_BLUR,
  });
  ctx.restore();
}

// ── Goblin toddler ───────────────────────────────────────────────────────────

/**
 * The goblin mother's toddler. `walkFrame` is his stride phase in radians (one
 * full stride per 2π) while `isMoving`; standing still he reaches up for her.
 * Faces toward +X unless `facingX` is negative.
 */
export function drawChildSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  facingX = 1,
) {
  const flipX = facingX < 0;
  if (isMoving) {
    const frame = walkFrameIndex(walkFrame, TODDLER_WALK_FRAMES);
    drawFigureCached(ctx, GOBLIN_TODDLER_FIGURE, 'walk', frame, sx, sy, s, { flipX });
    return;
  }
  const seconds = performance.now() / MS_TO_SECONDS;
  const frame = timeFrameIndex(seconds, TODDLER_IDLE_FPS, TODDLER_IDLE_FRAMES);
  drawFigureCached(ctx, GOBLIN_TODDLER_FIGURE, 'idle', frame, sx, sy, s, { flipX });
}

// ── Wood pile sprite constants ────────────────────────────────────────────────

const WOODPILE_GLOW_FREQ = 2.5;
const WOODPILE_GLOW_BASE = 0.15;
const WOODPILE_GLOW_AMP = 0.08;
const WOODPILE_GLOW_RING_X = 0.5;
const WOODPILE_GLOW_RING_Y = 0.55;
const WOODPILE_GLOW_RING_R = 0.4;
const WOODPILE_GLOW_LINE_W = 2;
const WOODPILE_BOTTOM_LOG_COUNT = 3;
const WOODPILE_BOTTOM_LOG_START = 0.15;
const WOODPILE_BOTTOM_LOG_SPACING = 0.22;
const WOODPILE_BOTTOM_LOG_Y = 0.65;
const WOODPILE_BOTTOM_LOG_W = 0.2;
const WOODPILE_BOTTOM_LOG_H = 0.12;
const WOODPILE_BOTTOM_GRAIN_X = 0.1;
const WOODPILE_BOTTOM_GRAIN_Y = 0.71;
const WOODPILE_BOTTOM_GRAIN_R = 0.04;
const WOODPILE_MID_LOG_COUNT = 2;
const WOODPILE_MID_LOG_START = 0.25;
const WOODPILE_MID_LOG_SPACING = 0.25;
const WOODPILE_MID_LOG_Y = 0.54;
const WOODPILE_MID_LOG_W = 0.2;
const WOODPILE_MID_LOG_H = 0.12;
const WOODPILE_MID_GRAIN_X = 0.1;
const WOODPILE_MID_GRAIN_Y = 0.6;
const WOODPILE_MID_GRAIN_R = 0.04;
const WOODPILE_TOP_LOG_X = 0.32;
const WOODPILE_TOP_LOG_Y = 0.44;
const WOODPILE_TOP_LOG_W = 0.22;
const WOODPILE_TOP_LOG_H = 0.11;
const WOODPILE_TOP_GRAIN_X = 0.43;
const WOODPILE_TOP_GRAIN_Y = 0.495;
const WOODPILE_TOP_GRAIN_R = 0.035;
const WOODPILE_TEXT_Y = 0.38;
const WOODPILE_TEXT_SIZE = 0.22;
const WOODPILE_TEXT_BASELINE_RATIO = 0.8; // canvas text baseline sits ~80% down from top
const WOODPILE_TEXT_OUTLINE_WIDTH = 3;
const WOODPILE_ARROW_BOUNCE_FREQ = 3.5;
const WOODPILE_ARROW_BOUNCE_AMP = 0.18;
const WOODPILE_ARROW_X = 0.5;
const WOODPILE_ARROW_OFFSET_Y = 0.22;
const WOODPILE_ARROW_W = 0.28;
const WOODPILE_ARROW_H = 0.22;
const WOODPILE_ARROW_LINE_W = 3;
const WOODPILE_ARROW_HALF = 0.5;
const WOODPILE_ARROW_NOTCH = 0.2;
const WOODPILE_ARROW_STEM = 0.55;

export function drawWoodPileSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  showArrow = true,
) {
  const t = performance.now() / MS_TO_SECONDS;
  const glow = WOODPILE_GLOW_BASE + WOODPILE_GLOW_AMP * Math.sin(t * WOODPILE_GLOW_FREQ);

  ctx.save();
  ctx.globalAlpha = glow;
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = WOODPILE_GLOW_LINE_W;
  ctx.beginPath();
  ctx.arc(
    sx + s * WOODPILE_GLOW_RING_X,
    sy + s * WOODPILE_GLOW_RING_Y,
    s * WOODPILE_GLOW_RING_R,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#8b6914';
  for (let i = 0; i < WOODPILE_BOTTOM_LOG_COUNT; i++) {
    const lx = sx + s * WOODPILE_BOTTOM_LOG_START + i * s * WOODPILE_BOTTOM_LOG_SPACING;
    ctx.fillRect(
      lx,
      sy + s * WOODPILE_BOTTOM_LOG_Y,
      s * WOODPILE_BOTTOM_LOG_W,
      s * WOODPILE_BOTTOM_LOG_H,
    );
    ctx.fillStyle = '#a0782a';
    ctx.beginPath();
    ctx.arc(
      lx + s * WOODPILE_BOTTOM_GRAIN_X,
      sy + s * WOODPILE_BOTTOM_GRAIN_Y,
      s * WOODPILE_BOTTOM_GRAIN_R,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = '#8b6914';
  }

  ctx.fillStyle = '#9b7924';
  for (let i = 0; i < WOODPILE_MID_LOG_COUNT; i++) {
    const lx = sx + s * WOODPILE_MID_LOG_START + i * s * WOODPILE_MID_LOG_SPACING;
    ctx.fillRect(lx, sy + s * WOODPILE_MID_LOG_Y, s * WOODPILE_MID_LOG_W, s * WOODPILE_MID_LOG_H);
    ctx.fillStyle = '#b08d34';
    ctx.beginPath();
    ctx.arc(
      lx + s * WOODPILE_MID_GRAIN_X,
      sy + s * WOODPILE_MID_GRAIN_Y,
      s * WOODPILE_MID_GRAIN_R,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = '#9b7924';
  }

  ctx.fillStyle = '#a8842e';
  ctx.fillRect(
    sx + s * WOODPILE_TOP_LOG_X,
    sy + s * WOODPILE_TOP_LOG_Y,
    s * WOODPILE_TOP_LOG_W,
    s * WOODPILE_TOP_LOG_H,
  );
  ctx.fillStyle = '#c0993e';
  ctx.beginPath();
  ctx.arc(
    sx + s * WOODPILE_TOP_GRAIN_X,
    sy + s * WOODPILE_TOP_GRAIN_Y,
    s * WOODPILE_TOP_GRAIN_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  const woodFontSize = Math.floor(s * WOODPILE_TEXT_SIZE);
  worldText(ctx, 'WOOD', {
    x: sx + s * WOODPILE_ARROW_X,
    y: sy + s * WOODPILE_TEXT_Y - Math.round(woodFontSize * WOODPILE_TEXT_BASELINE_RATIO),
    size: woodFontSize,
    bold: true,
    color: '#fbbf24',
    align: 'center',
    outline: '#3a2500',
    outlineWidth: WOODPILE_TEXT_OUTLINE_WIDTH,
  });

  if (!showArrow) return;

  const bounce = Math.abs(Math.sin(t * WOODPILE_ARROW_BOUNCE_FREQ)) * s * WOODPILE_ARROW_BOUNCE_AMP;
  const ax = sx + s * WOODPILE_ARROW_X;
  const ay = sy - s * WOODPILE_ARROW_OFFSET_Y - bounce;
  const aw = s * WOODPILE_ARROW_W;
  const ah = s * WOODPILE_ARROW_H;
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = WOODPILE_ARROW_LINE_W;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay + ah);
  ctx.lineTo(ax - aw * WOODPILE_ARROW_HALF, ay);
  ctx.lineTo(ax - aw * WOODPILE_ARROW_NOTCH, ay);
  ctx.lineTo(ax - aw * WOODPILE_ARROW_NOTCH, ay - ah * WOODPILE_ARROW_STEM);
  ctx.lineTo(ax + aw * WOODPILE_ARROW_NOTCH, ay - ah * WOODPILE_ARROW_STEM);
  ctx.lineTo(ax + aw * WOODPILE_ARROW_NOTCH, ay);
  ctx.lineTo(ax + aw * WOODPILE_ARROW_HALF, ay);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = '#4ade80';
  ctx.fill();
  ctx.restore();
}
