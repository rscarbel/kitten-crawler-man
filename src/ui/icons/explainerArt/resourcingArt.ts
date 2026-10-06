/**
 * Illustrations for the Resourcing explainer: Carl chopping, where wood and
 * stone come from, and the tool tiers.
 */

import type { IllustrationRect } from './illustration';
import { drawSpriteKey } from '../../../core/SpriteRenderer';
import { MAX_TOOL_TIER, TOOL_TIER_BASIC, TOOL_TIERS } from '../../../core/toolTiers';
import { HUMAN_FIGURE, CHOP_ROWS, humanRowOf } from '../../../sprites/art/humanFigure';
import { drawFigureCached } from '../../../sprites/figure/figureFrameCache';
import { drawToolOverlay, toolOverlayOf } from '../../../sprites/toolOverlaySprite';
import { worldText } from '../../world/worldText';
import { drawToolIcon, isToolIconId } from '../../../sprites/art/itemIcons/toolIcons';

// ── Illustration stage ─────────────────────────────────────────────────────

/** Tile size the world art is drawn at in the illustrations. */
const STAGE_TILE = 64;
/** The ground line, as a fraction of the band's height. */
const GROUND_FRACTION = 0.78;
const GROUND_FILL = '#2b3a22';
const GROUND_EDGE = '#3c5230';
const TREE_KEY = 'tree_oak_a';
const STUMP_KEY = 'tree_remains';
const BOULDER_KEY = 'boulder_large_a';
const RUBBLE_FILL = '#8d8d88';
const RUBBLE_SHADOW = '#5f5f5b';
/**
 * The rubble is a few stones laid out on a golden-angle spiral: evenly spread
 * without looking gridded, and without a table of hand-placed coordinates.
 */
const RUBBLE_STONE_COUNT = 5;
const RUBBLE_SPREAD_TILES = 0.2;
const RUBBLE_STONE_RADIUS_TILES = 0.07;
/** Stones toward the edge of the pile are smaller, the way loose scree settles. */
const RUBBLE_EDGE_SHRINK = 0.45;
/** A pile is flatter than it is wide. */
const RUBBLE_FLATTEN = 0.45;
/** The golden angle, π(3 − √5): successive points on it never line up. */
const GOLDEN_ANGLE = 2.399963229728653;
const FULL_TURN = Math.PI * 2;
/** Frames per chop frame in the illustration: the swing at the game's own pace. */
const CHOP_TICKS_PER_FRAME = 5;
/** The "+1 Wood" rises over this many frames after each impact. */
const POP_FRAMES = 40;
const POP_RISE_PX = 28;
const POP_COLOR = '#4ade80';
const ARROW_COLOR = '#e2e8f0';
const TOOL_ICON_SIZE = 40;
const LABEL_GAP = 6;
const TOOL_ROW_GAP = 10;
const TOOL_KIND_ROW_GAP = 56;
const GROUND_EDGE_PX = 2;
/** Where Carl and the tree stand either side of the band's centre, in tiles. */
const CHOPPER_OFFSET_TILES = 0.35;
const CHOPPED_TREE_OFFSET_TILES = 0.55;
const POP_TEXT_SIZE = 13;
const ARROW_TEXT_SIZE = 22;
const LABEL_TEXT_SIZE = 11;
/** Rubble sits a hair above the ground line, the way the stones rest on it. */
const RUBBLE_LIFT_PX = 2;
const RUBBLE_SHADOW_DROP_PX = 1;
/** Tree, stump, rock, rubble — one column each, left to right. */
const WHERE_COLUMN_COUNT = 4;
const COLUMN_CENTRE = 0.5;

function groundY(rect: IllustrationRect): number {
  return rect.y + rect.height * GROUND_FRACTION;
}

function drawGround(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
  const top = groundY(rect);
  ctx.fillStyle = GROUND_FILL;
  ctx.fillRect(rect.x, top, rect.width, rect.y + rect.height - top);
  ctx.fillStyle = GROUND_EDGE;
  ctx.fillRect(rect.x, top, rect.width, GROUND_EDGE_PX);
}

/** A world tile's top-left for something standing at `centreX` on the ground line. */
function standingTile(rect: IllustrationRect, centreX: number): { x: number; y: number } {
  return { x: centreX - STAGE_TILE / 2, y: groundY(rect) - STAGE_TILE };
}

function drawRubble(ctx: CanvasRenderingContext2D, centreX: number, baseY: number): void {
  for (let i = 0; i < RUBBLE_STONE_COUNT; i++) {
    const outward = Math.sqrt((i + 1) / RUBBLE_STONE_COUNT);
    const angle = i * GOLDEN_ANGLE;
    const x = centreX + Math.cos(angle) * outward * RUBBLE_SPREAD_TILES * STAGE_TILE;
    const y = baseY + Math.sin(angle) * outward * RUBBLE_SPREAD_TILES * RUBBLE_FLATTEN * STAGE_TILE;
    const radius = RUBBLE_STONE_RADIUS_TILES * STAGE_TILE * (1 - outward * RUBBLE_EDGE_SHRINK);
    ctx.fillStyle = RUBBLE_SHADOW;
    ctx.beginPath();
    ctx.arc(x, y + RUBBLE_SHADOW_DROP_PX, radius, 0, FULL_TURN);
    ctx.fill();
    ctx.fillStyle = RUBBLE_FILL;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, FULL_TURN);
    ctx.fill();
  }
}

/** Carl mid-chop beside a tree, with the wood rising off each blow. */
export function drawGatheringScene(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
): void {
  drawGround(ctx, rect);
  const centreX = rect.x + rect.width / 2;
  const tree = standingTile(rect, centreX + STAGE_TILE * CHOPPED_TREE_OFFSET_TILES);
  drawSpriteKey(ctx, TREE_KEY, 'idle', 0, tree.x, tree.y, STAGE_TILE);

  const row = CHOP_ROWS.side;
  const frameCount = humanRowOf(row)?.frameCount ?? 1;
  const chopFrame = Math.floor(frame / CHOP_TICKS_PER_FRAME) % frameCount;
  const carl = standingTile(rect, centreX - STAGE_TILE * CHOPPER_OFFSET_TILES);
  drawFigureCached(ctx, HUMAN_FIGURE, row, chopFrame, carl.x, carl.y, STAGE_TILE);
  const placement = toolOverlayOf({ row, frame: chopFrame, flipX: false });
  if (placement !== null) {
    drawToolOverlay(ctx, 'axe', TOOL_TIER_BASIC, placement, carl.x, carl.y, STAGE_TILE);
  }

  const loopTicks = frameCount * CHOP_TICKS_PER_FRAME;
  const sincePop = frame % loopTicks;
  if (sincePop < POP_FRAMES) {
    const rise = (sincePop / POP_FRAMES) * POP_RISE_PX;
    worldText(ctx, '+1 Wood', {
      x: tree.x + STAGE_TILE / 2,
      y: tree.y - rise,
      size: POP_TEXT_SIZE,
      bold: true,
      color: POP_COLOR,
      outline: true,
      align: 'center',
      alpha: 1 - sincePop / POP_FRAMES,
    });
  }
}

/** A tree and its stump, a rock and its rubble. */
export function drawWhereScene(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
  drawGround(ctx, rect);
  const columnWidth = rect.width / WHERE_COLUMN_COUNT;
  const columnCentre = (index: number): number => rect.x + columnWidth * (index + COLUMN_CENTRE);
  const [treeX, stumpX, rockX, rubbleX] = Array.from(
    { length: WHERE_COLUMN_COUNT },
    (_unused, index) => columnCentre(index),
  );
  const base = groundY(rect);
  const tree = standingTile(rect, treeX);
  drawSpriteKey(ctx, TREE_KEY, 'idle', 0, tree.x, tree.y, STAGE_TILE);
  const stump = standingTile(rect, stumpX);
  drawSpriteKey(ctx, STUMP_KEY, 'idle', 0, stump.x, stump.y, STAGE_TILE);
  const rock = standingTile(rect, rockX);
  drawSpriteKey(ctx, BOULDER_KEY, 'idle', 0, rock.x, rock.y, STAGE_TILE);
  drawRubble(ctx, rubbleX, base - RUBBLE_LIFT_PX);
  drawArrow(ctx, (treeX + stumpX) / 2, base - STAGE_TILE / 2);
  drawArrow(ctx, (rockX + rubbleX) / 2, base - STAGE_TILE / 2);
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  worldText(ctx, '→', {
    x,
    y,
    size: ARROW_TEXT_SIZE,
    bold: true,
    color: ARROW_COLOR,
    align: 'center',
  });
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  worldText(ctx, text, {
    x,
    y,
    size: LABEL_TEXT_SIZE,
    color: ARROW_COLOR,
    align: 'center',
    outline: true,
  });
}

/** Every axe tier over every pickaxe tier, cheapest first. */
export function drawToolTiersScene(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
  const tiers = TOOL_TIERS.axe.length;
  const rowWidth = tiers * TOOL_ICON_SIZE + (tiers - 1) * TOOL_ROW_GAP;
  const left = rect.x + (rect.width - rowWidth) / 2;
  const top = rect.y + (rect.height - TOOL_ICON_SIZE * 2 - TOOL_KIND_ROW_GAP) / 2;
  for (let tier = 0; tier <= MAX_TOOL_TIER; tier++) {
    const x = left + tier * (TOOL_ICON_SIZE + TOOL_ROW_GAP);
    drawTierIcon(ctx, 'axe', tier, x, top);
    drawTierIcon(ctx, 'pickaxe', tier, x, top + TOOL_ICON_SIZE + TOOL_KIND_ROW_GAP);
  }
  drawLabel(
    ctx,
    'Better tools work faster, and the best ones gather more per swing',
    rect.x + rect.width / 2,
    top + TOOL_ICON_SIZE + LABEL_GAP * 2,
  );
}

function drawTierIcon(
  ctx: CanvasRenderingContext2D,
  kind: 'axe' | 'pickaxe',
  tier: number,
  x: number,
  y: number,
): void {
  const tiers = TOOL_TIERS[kind];
  if (tier >= tiers.length) return;
  const def = tiers[tier];
  if (!isToolIconId(def.id)) return;
  drawToolIcon(ctx, { x, y, w: TOOL_ICON_SIZE, h: TOOL_ICON_SIZE }, def.id);
}

// ── Pages ──────────────────────────────────────────────────────────────────
