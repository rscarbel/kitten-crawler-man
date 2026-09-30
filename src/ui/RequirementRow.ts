import { drawText, measureTextWidth, TEXT_PRESETS } from './TextBox';

/**
 * A one-line checklist of what a job needs against what the party holds —
 * "Boards 12/30   Rope 15/15 ✓   Stone 3/20" — each entry green with a tick
 * once met and red while short, so the moment the last one is covered reads
 * as a change of colour rather than a number the player has to compare.
 *
 * Laid out as a row where there is width to spare, or as a column, one entry
 * per line, where two captions stand side by side.
 */

/** One thing a job needs. */
export interface Requirement {
  readonly label: string;
  readonly have: number;
  readonly need: number;
}

const MET_MARK = '✓';
const ENTRY_GAP_PX = 10;

/** Whether every requirement is covered. */
export function requirementsMet(requirements: readonly Requirement[]): boolean {
  return requirements.every((requirement) => requirement.have >= requirement.need);
}

function isMet(requirement: Requirement): boolean {
  return requirement.have >= requirement.need;
}

/**
 * A met entry shows the need as its own count, so a surplus reads as "30/30",
 * not as the confusing "41/30".
 */
function entryText(requirement: Requirement): string {
  const shown = Math.min(requirement.have, requirement.need);
  const count = `${requirement.label} ${shown}/${requirement.need}`;
  return isMet(requirement) ? `${count} ${MET_MARK}` : count;
}

function entryStyle(requirement: Requirement) {
  return isMet(requirement) ? TEXT_PRESETS.requirementMet : TEXT_PRESETS.requirementShort;
}

/** The row's width in pixels, for sizing a panel round it. */
export function measureRequirementRow(
  ctx: CanvasRenderingContext2D,
  requirements: readonly Requirement[],
): number {
  let width = 0;
  requirements.forEach((requirement, index) => {
    if (index > 0) width += ENTRY_GAP_PX;
    width += measureTextWidth(ctx, entryText(requirement), entryStyle(requirement));
  });
  return width;
}

/** Draws the row centred on `centreX`, its top at `topY`. */
export function drawRequirementRow(
  ctx: CanvasRenderingContext2D,
  requirements: readonly Requirement[],
  centreX: number,
  topY: number,
): void {
  let x = centreX - measureRequirementRow(ctx, requirements) / 2;
  for (const requirement of requirements) {
    const text = entryText(requirement);
    const style = entryStyle(requirement);
    drawText(ctx, text, { x, y: topY, ...style });
    x += measureTextWidth(ctx, text, style) + ENTRY_GAP_PX;
  }
}

/** The widest entry in pixels, for sizing a panel round a column. */
export function measureRequirementColumn(
  ctx: CanvasRenderingContext2D,
  requirements: readonly Requirement[],
): number {
  let widest = 0;
  for (const requirement of requirements) {
    const width = measureTextWidth(ctx, entryText(requirement), entryStyle(requirement));
    widest = Math.max(widest, width);
  }
  return widest;
}

/** Draws one entry per line, each centred on `centreX`, the first line's top at `topY`. */
export function drawRequirementColumn(
  ctx: CanvasRenderingContext2D,
  requirements: readonly Requirement[],
  centreX: number,
  topY: number,
  lineHeightPx: number,
): void {
  requirements.forEach((requirement, index) => {
    drawText(ctx, entryText(requirement), {
      x: centreX,
      y: topY + index * lineHeightPx,
      align: 'center',
      ...entryStyle(requirement),
    });
  });
}
