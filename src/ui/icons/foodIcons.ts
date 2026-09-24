/**
 * Icons for Briar Hollow's two prepared meals.
 *
 * The hamburger is painted here; the stew reuses the bopca counter's bowl
 * painter (`drawDishIcon` in `safeRoomCounter.ts`) with the moss-broth-stew
 * recipe, so the stew's inventory icon and the bowl Pipkin actually serves
 * never drift apart.
 */

import type { ItemId } from '../../core/ItemDefs';
import { DISH_DEF } from '../../systems/bopcaDialog';
import { drawDishIcon } from '../../sprites/safeRoomCounter';

/** The two food ids this module can draw. Closed, so a new dish cannot ship iconless. */
export type FoodIconId = 'hamburger' | 'hollow_stew';

/** Every id this module can draw, the single source of truth for the id set below and for the icon bake gate. */
export const FOOD_ICON_ID_LIST: readonly FoodIconId[] = ['hamburger', 'hollow_stew'];

const FOOD_ICON_IDS: ReadonlySet<string> = new Set<FoodIconId>(FOOD_ICON_ID_LIST);

/** Whether `id` is a food item, and so drawable by {@link drawFoodIcon}. */
export function isFoodIconId(id: ItemId): id is FoodIconId {
  return FOOD_ICON_IDS.has(id);
}

const FULL_CIRCLE = Math.PI * 2;
const OUTLINE = '#3a2410';
const OUTLINE_WIDTH = 1;
const THIN_LINE_WIDTH = 1;

const BURGER_CX = 0.5;
const BURGER_HALF_WIDTH = 0.4;

const BUN_TOP_DOME_Y = 0.28;
const BUN_TOP_DOME_RY = 0.17;
const BUN_TOP_FLAT_Y = 0.35;

const LETTUCE_TOP = 0.4;
const LETTUCE_BOTTOM = 0.48;
const LETTUCE_TOOTH_DEPTH = 0.03;
const LETTUCE_TEETH = 6;
/** How far the lettuce frill's ends reach past the layers below, as a fraction of the half-width. */
const LETTUCE_EDGE_FRACTION = 0.92;
const LETTUCE_FULL_WIDTH_FRACTION = LETTUCE_EDGE_FRACTION * 2;

const CHEESE_TOP = 0.48;
const CHEESE_BOTTOM = 0.55;
const CHEESE_DRIPS = 3;
const CHEESE_DRIP_DEPTH = 0.05;
const CHEESE_EDGE_FRACTION = 0.88;
const CHEESE_FULL_WIDTH_FRACTION = CHEESE_EDGE_FRACTION * 2;
/** Each drip is centred on its slice of the cheese's width. */
const DRIP_CENTER_OFFSET = 0.5;

const PATTY_TOP = 0.55;
const PATTY_BOTTOM = 0.65;
const PATTY_EDGE_FRACTION = 0.85;
const PATTY_FULL_WIDTH_FRACTION = PATTY_EDGE_FRACTION * 2;
const THIN_SHADE_INSET = 0.015;

const BUN_BOTTOM_TOP_Y = 0.65;
const BUN_BOTTOM_BOTTOM_Y = 0.84;
const BUN_BOTTOM_EDGE_FRACTION = 0.9;

const SESAME_RADIUS_X = 0.02;
const SESAME_RADIUS_Y = 0.012;
const SESAME_1_X = 0.4;
const SESAME_1_Y = 0.3;
const SESAME_2_X = 0.5;
const SESAME_2_Y = 0.26;
const SESAME_3_X = 0.6;
const SESAME_3_Y = 0.3;
const SESAME_4_X = 0.45;
const SESAME_4_Y = 0.36;
const SESAME_5_X = 0.56;
const SESAME_5_Y = 0.36;
const SESAME_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [SESAME_1_X, SESAME_1_Y],
  [SESAME_2_X, SESAME_2_Y],
  [SESAME_3_X, SESAME_3_Y],
  [SESAME_4_X, SESAME_4_Y],
  [SESAME_5_X, SESAME_5_Y],
];

const BUN_COLOR = '#d99a4e';
const BUN_SHADE = '#b97730';
const SESAME_COLOR = '#f3d9a0';
const LETTUCE_COLOR = '#7cb342';
const LETTUCE_SHADE = '#5a8a2c';
const CHEESE_COLOR = '#f4c430';
const CHEESE_SHADE = '#d9a418';
const PATTY_COLOR = '#6b4226';
const PATTY_SHADE = '#4a2c18';

function drawHamburgerIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size * BURGER_CX;
  const halfWidth = size * BURGER_HALF_WIDTH;

  // Bottom bun: a rounded-bottom trapezoid the fillings sit on.
  const bunBottomHalf = halfWidth * BUN_BOTTOM_EDGE_FRACTION;
  ctx.fillStyle = BUN_COLOR;
  ctx.beginPath();
  ctx.moveTo(cx - bunBottomHalf, y + size * BUN_BOTTOM_TOP_Y);
  ctx.lineTo(cx + bunBottomHalf, y + size * BUN_BOTTOM_TOP_Y);
  ctx.quadraticCurveTo(
    cx + bunBottomHalf,
    y + size * BUN_BOTTOM_BOTTOM_Y,
    cx,
    y + size * BUN_BOTTOM_BOTTOM_Y,
  );
  ctx.quadraticCurveTo(
    cx - bunBottomHalf,
    y + size * BUN_BOTTOM_BOTTOM_Y,
    cx - bunBottomHalf,
    y + size * BUN_BOTTOM_TOP_Y,
  );
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();

  // Patty.
  const pattyLeft = cx - halfWidth * PATTY_EDGE_FRACTION;
  const pattyWidth = halfWidth * PATTY_FULL_WIDTH_FRACTION;
  ctx.fillStyle = PATTY_COLOR;
  ctx.fillRect(pattyLeft, y + size * PATTY_TOP, pattyWidth, size * (PATTY_BOTTOM - PATTY_TOP));
  ctx.fillStyle = PATTY_SHADE;
  ctx.fillRect(
    pattyLeft,
    y + size * (PATTY_BOTTOM - THIN_SHADE_INSET),
    pattyWidth,
    THIN_LINE_WIDTH,
  );
  ctx.strokeStyle = OUTLINE;
  ctx.strokeRect(pattyLeft, y + size * PATTY_TOP, pattyWidth, size * (PATTY_BOTTOM - PATTY_TOP));

  // Cheese, with a few drips hanging over the patty's edge.
  const cheeseLeft = cx - halfWidth * CHEESE_EDGE_FRACTION;
  const cheeseWidth = halfWidth * CHEESE_FULL_WIDTH_FRACTION;
  ctx.fillStyle = CHEESE_COLOR;
  ctx.beginPath();
  ctx.moveTo(cheeseLeft, y + size * CHEESE_TOP);
  ctx.lineTo(cheeseLeft + cheeseWidth, y + size * CHEESE_TOP);
  for (let drip = CHEESE_DRIPS - 1; drip >= 0; drip--) {
    const dripX = cheeseLeft + (cheeseWidth * (drip + DRIP_CENTER_OFFSET)) / CHEESE_DRIPS;
    const dripY = y + size * (CHEESE_BOTTOM + (drip % 2 === 0 ? CHEESE_DRIP_DEPTH : 0));
    ctx.lineTo(dripX, dripY);
  }
  ctx.lineTo(cheeseLeft, y + size * CHEESE_BOTTOM);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = CHEESE_SHADE;
  ctx.lineWidth = THIN_LINE_WIDTH;
  ctx.stroke();

  // Lettuce frill, a zigzag band peeking out above the cheese.
  const lettuceLeft = cx - halfWidth * LETTUCE_EDGE_FRACTION;
  const lettuceWidth = halfWidth * LETTUCE_FULL_WIDTH_FRACTION;
  ctx.fillStyle = LETTUCE_COLOR;
  ctx.beginPath();
  ctx.moveTo(lettuceLeft, y + size * LETTUCE_BOTTOM);
  for (let tooth = 0; tooth <= LETTUCE_TEETH; tooth++) {
    const tx = lettuceLeft + (lettuceWidth * tooth) / LETTUCE_TEETH;
    const ty = y + size * (tooth % 2 === 0 ? LETTUCE_TOP : LETTUCE_TOP + LETTUCE_TOOTH_DEPTH);
    ctx.lineTo(tx, ty);
  }
  ctx.lineTo(lettuceLeft + lettuceWidth, y + size * LETTUCE_BOTTOM);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = LETTUCE_SHADE;
  ctx.lineWidth = THIN_LINE_WIDTH;
  ctx.stroke();

  // Top bun: a dome with a flat underside and sesame seeds.
  ctx.fillStyle = BUN_COLOR;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, y + size * BUN_TOP_FLAT_Y);
  ctx.quadraticCurveTo(
    cx - halfWidth,
    y + size * (BUN_TOP_DOME_Y - BUN_TOP_DOME_RY),
    cx,
    y + size * (BUN_TOP_DOME_Y - BUN_TOP_DOME_RY),
  );
  ctx.quadraticCurveTo(
    cx + halfWidth,
    y + size * (BUN_TOP_DOME_Y - BUN_TOP_DOME_RY),
    cx + halfWidth,
    y + size * BUN_TOP_FLAT_Y,
  );
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
  ctx.fillStyle = BUN_SHADE;
  ctx.fillRect(
    cx - halfWidth,
    y + size * (BUN_TOP_FLAT_Y - THIN_SHADE_INSET),
    halfWidth * 2,
    THIN_LINE_WIDTH,
  );

  ctx.fillStyle = SESAME_COLOR;
  for (const [fx, fy] of SESAME_POSITIONS) {
    ctx.beginPath();
    ctx.ellipse(
      x + size * fx,
      y + size * fy,
      size * SESAME_RADIUS_X,
      size * SESAME_RADIUS_Y,
      0,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();
  }
}

/** Draws one food item's icon into a square icon region at `x`,`y`. */
export function drawFoodIcon(
  ctx: CanvasRenderingContext2D,
  id: FoodIconId,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();

  if (id === 'hamburger') {
    drawHamburgerIcon(ctx, x, y, size);
  } else {
    drawDishIcon(ctx, DISH_DEF.moss_broth_stew.visual, x, y, size);
  }

  ctx.restore();
}
