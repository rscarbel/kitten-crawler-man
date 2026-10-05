/**
 * Illustrations for the goblin mother's defend-quest tutorial: her and her
 * child, the wood pile becoming a barrier, and a clawed barrier over a grate
 * with the enemies coming up beneath it.
 */

import { drawChildSprite, drawQuestNPCSprite } from '../../../sprites/questNPCSprite';
import { drawNurseryBarrier, drawNurseryWoodPile } from '../../../sprites/nurserySprites';
import { BARRIER_DAMAGE_STAGES, BARRIER_PLANK_COUNT } from '../../../sprites/art/nurseryArt';
import { worldText } from '../../world/worldText';
import type { IllustrationRect } from './illustration';

/** The figures fill this share of the band's height, up to `SPRITE_MAX_SIZE`. */
const SPRITE_HEIGHT_SHARE = 0.8;
const SPRITE_MAX_SIZE = 72;
const TILE_CENTER_OFFSET = 0.5;
/** A glyph's drawn height as a share of its font size, for centring it on a point. */
const TEXT_HEIGHT_FACTOR = 0.8;

const NPC_X_FACTOR = 1.3;
const NPC_Y_FACTOR = 0.5;
const CHILD_X_FACTOR = 0.45;
const CHILD_Y_FACTOR = 0.35;
const CHILD_SIZE_FACTOR = 0.72;
const CHILD_STRIDE_PHASE = 0;
const CHILD_FACING_LEFT = -1;
const HEART_X_FACTOR = 0.08;
const HEART_Y_FACTOR = 0.08;
const HEART_SIZE_FACTOR = 0.38;
const HEART_COLOR = '#f87171';

const PANEL_CENTER_FRACTION = 0.5;
const ARROW_Y_FACTOR = 0.06;
const ARROW_SIZE_FACTOR = 0.5;
const ARROW_COLOR = '#fbbf24';
const BUILD_LABEL_Y_FACTOR = 0.68;
const BUILD_LABEL_ASCENT = 9;
const BUILD_LABEL_SIZE = 11;
const BUILD_LABEL = '[R] to build';

/** A well-chewed barrier, not yet broken through. */
const CLAWED_DAMAGE_STAGE = BARRIER_DAMAGE_STAGES - 2;
const THREAT_COLOR = '#ef4444';
const THREAT_LINE_WIDTH = 2;
const THREAT_ARROW_BOTTOM_FACTOR = 1.05;
const THREAT_ARROW_MID_FACTOR = 0.65;
const THREAT_ARROWHEAD_OUTER_Y = 0.72;
const THREAT_ARROWHEAD_TIP_Y = 0.58;
const THREAT_ARROW_NOTCH_OFFSET = 6;
const THREAT_DASH_LENGTH = 3;
const THREAT_DASH_GAP = 3;
const THREAT_LABEL_Y_FACTOR = 1.2;
const THREAT_LABEL_ASCENT = 9;
const THREAT_LABEL_SIZE = 11;
const THREAT_LABEL = 'enemies spawn below!';

interface Stage {
  readonly size: number;
  readonly cx: number;
  readonly cy: number;
}

function stageOf(rect: IllustrationRect): Stage {
  return {
    size: Math.min(rect.height * SPRITE_HEIGHT_SHARE, SPRITE_MAX_SIZE),
    cx: rect.x + rect.width / 2,
    cy: rect.y + rect.height / 2,
  };
}

/** The goblin mother and her child, with a heart between them. */
export function drawDefendQuestPage(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
  const { size: s, cx, cy } = stageOf(rect);
  drawQuestNPCSprite(ctx, cx - s * NPC_X_FACTOR, cy - s * NPC_Y_FACTOR, s);
  drawChildSprite(
    ctx,
    cx + s * CHILD_X_FACTOR,
    cy - s * CHILD_Y_FACTOR,
    s * CHILD_SIZE_FACTOR,
    CHILD_STRIDE_PHASE,
    false,
    CHILD_FACING_LEFT,
  );
  const heartSize = Math.floor(s * HEART_SIZE_FACTOR);
  worldText(ctx, '♥', {
    x: cx - s * HEART_X_FACTOR,
    y: cy + s * HEART_Y_FACTOR - Math.round(heartSize * TEXT_HEIGHT_FACTOR),
    size: heartSize,
    bold: true,
    color: HEART_COLOR,
    align: 'center',
  });
}

/** The wood pile, an arrow, and the boarded grate it becomes. */
export function drawDefendBuildPage(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
  const { size: s, cy } = stageOf(rect);
  const half = rect.width / 2;
  drawNurseryWoodPile(
    ctx,
    rect.x + half * PANEL_CENTER_FRACTION - s * TILE_CENTER_OFFSET,
    cy - s * TILE_CENTER_OFFSET,
    s,
    true,
  );
  const arrowSize = Math.floor(s * ARROW_SIZE_FACTOR);
  worldText(ctx, '→', {
    x: rect.x + half,
    y: cy + s * ARROW_Y_FACTOR - Math.round(arrowSize * TEXT_HEIGHT_FACTOR),
    size: arrowSize,
    bold: true,
    color: ARROW_COLOR,
    align: 'center',
  });
  drawNurseryBarrier(
    ctx,
    rect.x + half + half * PANEL_CENTER_FRACTION - s * TILE_CENTER_OFFSET,
    cy - s * TILE_CENTER_OFFSET,
    s,
    { variant: 0, damageStage: 0, planksLaid: BARRIER_PLANK_COUNT },
  );
  worldText(ctx, BUILD_LABEL, {
    x: rect.x + half + half * PANEL_CENTER_FRACTION,
    y: cy + s * BUILD_LABEL_Y_FACTOR - BUILD_LABEL_ASCENT,
    size: BUILD_LABEL_SIZE,
    bold: true,
    color: ARROW_COLOR,
    align: 'center',
    outline: true,
  });
}

/** A clawed barrier with a dashed arrow coming up from beneath it. */
export function drawDefendThreatPage(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
  const { size: s, cx, cy } = stageOf(rect);
  drawNurseryBarrier(ctx, cx - s * TILE_CENTER_OFFSET, cy - s * TILE_CENTER_OFFSET, s, {
    variant: 0,
    damageStage: CLAWED_DAMAGE_STAGE,
    planksLaid: BARRIER_PLANK_COUNT,
  });
  ctx.save();
  ctx.strokeStyle = THREAT_COLOR;
  ctx.lineWidth = THREAT_LINE_WIDTH;
  ctx.setLineDash([THREAT_DASH_LENGTH, THREAT_DASH_GAP]);
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * THREAT_ARROW_BOTTOM_FACTOR);
  ctx.lineTo(cx, cy + s * THREAT_ARROW_MID_FACTOR);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(cx - THREAT_ARROW_NOTCH_OFFSET, cy + s * THREAT_ARROWHEAD_OUTER_Y);
  ctx.lineTo(cx, cy + s * THREAT_ARROWHEAD_TIP_Y);
  ctx.lineTo(cx + THREAT_ARROW_NOTCH_OFFSET, cy + s * THREAT_ARROWHEAD_OUTER_Y);
  ctx.stroke();
  ctx.restore();
  worldText(ctx, THREAT_LABEL, {
    x: cx,
    y: cy + s * THREAT_LABEL_Y_FACTOR - THREAT_LABEL_ASCENT,
    size: THREAT_LABEL_SIZE,
    bold: true,
    color: THREAT_COLOR,
    align: 'center',
  });
}
