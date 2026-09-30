/**
 * Icons for the two items "The Borrowed Blueprints" puts in the quest slot:
 * Merrit's scythe and Tikka's blueprints.
 *
 * Both are read at hotbar size first, so each is one bold silhouette on the
 * diagonal — the scythe a long snath with a pale crescent blade, the
 * blueprints a blue roll with a sheet half unfurled — rather than detail that
 * smears at 24px.
 */

import type { ItemId } from '../../core/ItemDefs';

/** The two ids this module can draw. Closed, so neither item can ship iconless. */
export type BlueprintsQuestIconId = 'quest_scythe' | 'quest_blueprints';

/** Every id this module can draw, the single source of truth for the id set below and for the icon bake gate. */
export const BLUEPRINTS_QUEST_ICON_ID_LIST: readonly BlueprintsQuestIconId[] = [
  'quest_scythe',
  'quest_blueprints',
];

const BLUEPRINTS_QUEST_ICON_IDS: ReadonlySet<string> = new Set<BlueprintsQuestIconId>(
  BLUEPRINTS_QUEST_ICON_ID_LIST,
);

/** Whether `id` is one of this quest's items, and so drawable by {@link drawBlueprintsQuestIcon}. */
export function isBlueprintsQuestIconId(id: ItemId): id is BlueprintsQuestIconId {
  return BLUEPRINTS_QUEST_ICON_IDS.has(id);
}

const OUTLINE = '#2a1a10';
const OUTLINE_WIDTH = 1;

// ── The scythe ────────────────────────────────────────────────────────────

/** The snath runs corner to corner, bottom-left to top-right. */
const SNATH_START_X = 0.2;
const SNATH_START_Y = 0.9;
const SNATH_END_X = 0.74;
const SNATH_END_Y = 0.14;
const SNATH_WIDTH_FRACTION = 0.085;
const SNATH_COLOR = '#9a6a3a';
const SNATH_SHADE = '#6e4722';
/** The two hand grips, as fractions of the way along the snath. */
const LOWER_GRIP_POSITION = 0.3;
const UPPER_GRIP_POSITION = 0.62;
const GRIP_POSITIONS = [LOWER_GRIP_POSITION, UPPER_GRIP_POSITION] as const;
const GRIP_LENGTH_FRACTION = 0.14;
const GRIP_WIDTH_FRACTION = 0.06;
const GRIP_COLOR = '#c48a4a';
/** The blade sweeps back from the snath's top as a crescent. */
const BLADE_TIP_X = 0.12;
const BLADE_TIP_Y = 0.3;
const BLADE_OUTER_CONTROL_X = 0.36;
const BLADE_OUTER_CONTROL_Y = 0.02;
const BLADE_INNER_CONTROL_X = 0.36;
const BLADE_INNER_CONTROL_Y = 0.16;
const BLADE_HEEL_DROP = 0.07;
const BLADE_COLOR = '#dfe6ec';
const BLADE_EDGE = '#8b98a5';

function drawScythe(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const px = (fraction: number): number => x + fraction * size;
  const py = (fraction: number): number => y + fraction * size;

  ctx.lineCap = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = size * SNATH_WIDTH_FRACTION + OUTLINE_WIDTH * 2;
  ctx.beginPath();
  ctx.moveTo(px(SNATH_START_X), py(SNATH_START_Y));
  ctx.lineTo(px(SNATH_END_X), py(SNATH_END_Y));
  ctx.stroke();
  ctx.strokeStyle = SNATH_COLOR;
  ctx.lineWidth = size * SNATH_WIDTH_FRACTION;
  ctx.stroke();
  ctx.strokeStyle = SNATH_SHADE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();

  const dx = SNATH_END_X - SNATH_START_X;
  const dy = SNATH_END_Y - SNATH_START_Y;
  const length = Math.hypot(dx, dy);
  const normalX = -dy / length;
  const normalY = dx / length;
  ctx.strokeStyle = GRIP_COLOR;
  ctx.lineWidth = size * GRIP_WIDTH_FRACTION;
  for (const along of GRIP_POSITIONS) {
    const cx = SNATH_START_X + dx * along;
    const cy = SNATH_START_Y + dy * along;
    ctx.beginPath();
    ctx.moveTo(px(cx), py(cy));
    ctx.lineTo(px(cx + normalX * GRIP_LENGTH_FRACTION), py(cy + normalY * GRIP_LENGTH_FRACTION));
    ctx.stroke();
  }

  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(px(SNATH_END_X), py(SNATH_END_Y));
  ctx.quadraticCurveTo(
    px(BLADE_OUTER_CONTROL_X),
    py(BLADE_OUTER_CONTROL_Y),
    px(BLADE_TIP_X),
    py(BLADE_TIP_Y),
  );
  ctx.quadraticCurveTo(
    px(BLADE_INNER_CONTROL_X),
    py(BLADE_INNER_CONTROL_Y),
    px(SNATH_END_X),
    py(SNATH_END_Y + BLADE_HEEL_DROP),
  );
  ctx.closePath();
  ctx.fillStyle = BLADE_COLOR;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
  ctx.strokeStyle = BLADE_EDGE;
  ctx.beginPath();
  ctx.moveTo(px(BLADE_TIP_X), py(BLADE_TIP_Y));
  ctx.quadraticCurveTo(
    px(BLADE_INNER_CONTROL_X),
    py(BLADE_INNER_CONTROL_Y),
    px(SNATH_END_X),
    py(SNATH_END_Y + BLADE_HEEL_DROP),
  );
  ctx.stroke();
}

// ── The blueprints ────────────────────────────────────────────────────────

/** The unfurled sheet, lying flat behind the roll. */
const SHEET_LEFT = 0.14;
const SHEET_TOP = 0.16;
const SHEET_WIDTH = 0.62;
const SHEET_HEIGHT = 0.56;
const SHEET_COLOR = '#2f6fb0';
const SHEET_LINE_COLOR = '#cfe4f7';
/** A floor plan's walls, drawn as fractions of the sheet. */
const PLAN_INSET = 0.16;
const PLAN_DIVIDER_X = 0.55;
const PLAN_DIVIDER_Y = 0.5;
const PLAN_LINE_WIDTH = 1;
/** The roll the sheet comes off, across the bottom. */
const ROLL_LEFT = 0.1;
const ROLL_CENTRE_Y = 0.76;
const ROLL_LENGTH = 0.7;
const ROLL_RADIUS = 0.1;
const ROLL_COLOR = '#3f82c4';
const ROLL_SHADE = '#24578a';
const ROLL_END_COLOR = '#e8f1fa';
const FULL_CIRCLE = Math.PI * 2;

function drawBlueprints(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const sheetX = x + SHEET_LEFT * size;
  const sheetY = y + SHEET_TOP * size;
  const sheetW = SHEET_WIDTH * size;
  const sheetH = SHEET_HEIGHT * size;
  ctx.fillStyle = SHEET_COLOR;
  ctx.fillRect(sheetX, sheetY, sheetW, sheetH);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.strokeRect(sheetX, sheetY, sheetW, sheetH);

  const planX = sheetX + sheetW * PLAN_INSET;
  const planY = sheetY + sheetH * PLAN_INSET;
  const planW = sheetW * (1 - PLAN_INSET * 2);
  const planH = sheetH * (1 - PLAN_INSET * 2);
  ctx.strokeStyle = SHEET_LINE_COLOR;
  ctx.lineWidth = PLAN_LINE_WIDTH;
  ctx.strokeRect(planX, planY, planW, planH);
  ctx.beginPath();
  ctx.moveTo(planX + planW * PLAN_DIVIDER_X, planY);
  ctx.lineTo(planX + planW * PLAN_DIVIDER_X, planY + planH);
  ctx.moveTo(planX, planY + planH * PLAN_DIVIDER_Y);
  ctx.lineTo(planX + planW * PLAN_DIVIDER_X, planY + planH * PLAN_DIVIDER_Y);
  ctx.stroke();

  const rollX = x + ROLL_LEFT * size;
  const rollY = y + ROLL_CENTRE_Y * size;
  const rollW = ROLL_LENGTH * size;
  const radius = ROLL_RADIUS * size;
  ctx.fillStyle = ROLL_COLOR;
  ctx.fillRect(rollX, rollY - radius, rollW, radius * 2);
  ctx.fillStyle = ROLL_SHADE;
  ctx.fillRect(rollX, rollY, rollW, radius);
  ctx.strokeStyle = OUTLINE;
  ctx.strokeRect(rollX, rollY - radius, rollW, radius * 2);
  ctx.fillStyle = ROLL_END_COLOR;
  ctx.beginPath();
  ctx.arc(rollX + rollW, rollY, radius, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.stroke();
}

/** Draws `id` into the `size`-pixel square at (`x`, `y`). */
export function drawBlueprintsQuestIcon(
  ctx: CanvasRenderingContext2D,
  id: BlueprintsQuestIconId,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  if (id === 'quest_scythe') drawScythe(ctx, x, y, size);
  else drawBlueprints(ctx, x, y, size);
  ctx.restore();
}
