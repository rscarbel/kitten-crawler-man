/**
 * Casino chip art and the stacks it forms.
 *
 * Chips are the player's gold rendered as chips — one balance, not a buy-in
 * wallet — so the tray and the felt stack between them always account for every
 * coin the player owns. The palette is the one already painted onto the club's
 * table sprite, so the chips in the tray match the chips on the furniture.
 *
 * Chip geometry is vector illustration with no shared-utility equivalent, so raw
 * `ctx` path drawing is confined to this module alongside `PlayingCard.ts`.
 */

import { CHIP_DENOMINATIONS, type ChipDenomination } from '../../systems/casino/BlackjackTable';
import { drawText } from '../TextBox';

interface ChipPalette {
  readonly face: string;
  readonly edge: string;
  readonly stripe: string;
  readonly label: string;
}

const CHIP_PALETTES: Record<ChipDenomination, ChipPalette> = {
  10: { face: '#c8323c', edge: '#7d1a22', stripe: '#f2dede', label: '#fff0f0' },
  25: { face: '#2f5ec8', edge: '#1a3474', stripe: '#dde6f8', label: '#eef3ff' },
  50: { face: '#d8b432', edge: '#87681a', stripe: '#fff4d0', label: '#3a2c08' },
};

/** A chip is this many times wider than tall — the shallow ellipse of a chip seen from the table. */
const CHIP_SQUASH = 0.42;
/** Each chip in a stack sits this fraction of a chip radius above the one below. */
export const CHIP_STACK_STEP = 0.3;
const CHIP_EDGE_WIDTH_FRACTION = 0.12;
const CHIP_STRIPE_COUNT = 6;
const CHIP_STRIPE_ARC = 0.22;
const CHIP_INNER_FACE_FRACTION = 0.62;
const CHIP_LABEL_SIZE_FRACTION = 0.72;
const CHIP_LABEL_Y_FRACTION = 0.36;

/** Beyond this a rich player's tray becomes a skyscraper; the numeric total carries the rest. */
export const TRAY_MAX_VISIBLE_CHIPS = 12;

const TWO_PI = Math.PI * 2;
const HALF = 0.5;

export function chipPalette(denomination: number): ChipPalette {
  return CHIP_PALETTES[nearestDenomination(denomination)];
}

/** The chip colour a loose coin amount reads as — used for the tray's odd remainder. */
function nearestDenomination(value: number): ChipDenomination {
  let best: ChipDenomination = CHIP_DENOMINATIONS[0];
  for (const denomination of CHIP_DENOMINATIONS) {
    if (denomination <= value) best = denomination;
  }
  return best;
}

export interface ChipDrawOpts {
  alpha?: number;
  /** Draw the denomination across the chip face; skipped on stacked chips below the top. */
  showLabel?: boolean;
  /** Lift shadow, for a chip in flight between the tray and the felt. */
  shadow?: boolean;
}

/** One chip lying face-up, centred on (cx, cy), `radius` being its half-width. */
export function drawChip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  denomination: number,
  opts: ChipDrawOpts = {},
): void {
  const palette = chipPalette(denomination);
  const ry = radius * CHIP_SQUASH;

  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  if (opts.shadow === true) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = radius * HALF;
    ctx.shadowOffsetY = radius * CHIP_STACK_STEP;
  }

  ctx.fillStyle = palette.edge;
  ctx.beginPath();
  ctx.ellipse(cx, cy, radius, ry, 0, 0, TWO_PI);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.fillStyle = palette.face;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy,
    radius * (1 - CHIP_EDGE_WIDTH_FRACTION),
    ry * (1 - CHIP_EDGE_WIDTH_FRACTION),
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Edge spots — the reason a chip reads as a chip and not a coloured disc.
  ctx.strokeStyle = palette.stripe;
  ctx.lineWidth = Math.max(1, radius * CHIP_EDGE_WIDTH_FRACTION);
  for (let i = 0; i < CHIP_STRIPE_COUNT; i++) {
    const angle = (i / CHIP_STRIPE_COUNT) * TWO_PI;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      cy,
      radius * (1 - CHIP_EDGE_WIDTH_FRACTION * HALF),
      ry * (1 - CHIP_EDGE_WIDTH_FRACTION * HALF),
      0,
      angle - CHIP_STRIPE_ARC * HALF,
      angle + CHIP_STRIPE_ARC * HALF,
    );
    ctx.stroke();
  }

  ctx.fillStyle = palette.face;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy,
    radius * CHIP_INNER_FACE_FRACTION,
    ry * CHIP_INNER_FACE_FRACTION,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.strokeStyle = palette.stripe;
  ctx.lineWidth = Math.max(1, radius * CHIP_EDGE_WIDTH_FRACTION * HALF);
  ctx.stroke();
  ctx.restore();

  if (opts.showLabel === true) {
    drawText(ctx, `${denomination}`, {
      x: cx,
      y: cy - radius * CHIP_LABEL_Y_FRACTION,
      size: Math.max(1, radius * CHIP_LABEL_SIZE_FRACTION),
      bold: true,
      color: palette.label,
      align: 'center',
      alpha: opts.alpha ?? 1,
    });
  }
}

/**
 * A stack of chips growing upward from `baseY`. Only the topmost chip carries a
 * label — a stack of labelled discs reads as noise.
 */
export function drawChipStack(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  radius: number,
  chips: ReadonlyArray<number>,
  alpha = 1,
): void {
  const step = radius * CHIP_STACK_STEP;
  chips.forEach((denomination, index) => {
    drawChip(ctx, cx, baseY - index * step, radius, denomination, {
      alpha,
      showLabel: index === chips.length - 1,
    });
  });
}

/** Where the top of a stack of `count` chips sits, so a chip in flight can land on it. */
export function chipStackTopY(baseY: number, radius: number, count: number): number {
  return baseY - Math.max(0, count) * radius * CHIP_STACK_STEP;
}

/**
 * `coins` broken greedily into the largest denominations that fit, capped at
 * `TRAY_MAX_VISIBLE_CHIPS`. The numeric total drawn beneath the tray carries
 * whatever the cap dropped.
 */
export function trayChips(coins: number): ReadonlyArray<number> {
  const chips: number[] = [];
  let left = coins;
  for (let i = CHIP_DENOMINATIONS.length - 1; i >= 0; i--) {
    const denomination = CHIP_DENOMINATIONS[i];
    while (left >= denomination && chips.length < TRAY_MAX_VISIBLE_CHIPS) {
      chips.push(denomination);
      left -= denomination;
    }
  }
  // Largest at the bottom reads as a real stack; the greedy pass produces the reverse.
  return chips.reverse();
}

/**
 * The outline drawn where the chips would be when the tray is empty. Drawn, not
 * hidden, so a turned-away player reads the situation at a glance without having
 * to read the line.
 */
export function drawEmptyTrayOutline(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  radius: number,
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(200,168,64,0.35)';
  ctx.lineWidth = Math.max(1, radius * CHIP_EDGE_WIDTH_FRACTION);
  ctx.setLineDash([radius * CHIP_STACK_STEP, radius * CHIP_STACK_STEP]);
  ctx.beginPath();
  ctx.ellipse(cx, baseY, radius, radius * CHIP_SQUASH, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();
}
