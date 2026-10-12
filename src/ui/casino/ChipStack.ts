/**
 * Casino chip art and the stacks it forms.
 *
 * Chips are the player's gold rendered as chips — one balance, not a buy-in
 * wallet — so the tray and the felt stack between them always account for every
 * coin the player owns. The faces are the casino's chip tokens, the red, blue
 * and brass already painted onto the club's table sprite, so the chips in the
 * tray match the chips on the furniture.
 *
 * Chip geometry is vector illustration with no widget equivalent, so raw `ctx`
 * path drawing is confined to this module alongside `PlayingCard.ts`.
 */

import { CHIP_DENOMINATIONS, type ChipDenomination } from '../../systems/casino/BlackjackTable';
import { chipDenominations, type PokerTierId } from '../../systems/casino/poker/pokerStakes';
import { darken, withAlpha } from '../theme/color';
import { skinsFor } from '../theme/skins';
import type { Theme } from '../theme/tokens';
import type { PaintTarget } from '../widgets/paint';
import { text } from '../widgets/text';

export interface ChipPalette {
  readonly face: string;
  readonly edge: string;
  readonly stripe: string;
  readonly label: string;
}

/** How far a chip's rim falls into shadow from its face. */
const CHIP_EDGE_DARKEN = 0.42;
const CHIP_SHADOW_ALPHA = 0.5;
const EMPTY_TRAY_ALPHA = 0.35;
const CHIP_LABEL_WEIGHT = 800;

const [SMALL_CHIP, MEDIUM_CHIP, LARGE_CHIP] = CHIP_DENOMINATIONS;

function chipPalettes(theme: Theme): Record<ChipDenomination, ChipPalette> {
  const { material, text: ink } = theme.palette;
  const stripe = skinsFor(theme).casinoChip.stripe;
  const chip = (face: string, label: string): ChipPalette => ({
    face,
    edge: darken(face, CHIP_EDGE_DARKEN),
    stripe,
    label,
  });
  return {
    [SMALL_CHIP]: chip(material.chipRed, material.chipWhite),
    [MEDIUM_CHIP]: chip(material.chipBlue, material.chipWhite),
    [LARGE_CHIP]: chip(material.brass, ink.inverse),
  };
}

const paletteCache = new WeakMap<Theme, Record<ChipDenomination, ChipPalette>>();

/** A chip is this many times wider than tall — the shallow ellipse of a chip seen from the table. */
const CHIP_SQUASH = 0.42;
/** Each chip in a stack sits this fraction of a chip radius above the one below. */
export const CHIP_STACK_STEP = 0.3;
const CHIP_EDGE_WIDTH_FRACTION = 0.12;
const CHIP_STRIPE_COUNT = 6;
const CHIP_STRIPE_ARC = 0.22;
const CHIP_INNER_FACE_FRACTION = 0.62;
const CHIP_LABEL_SIZE_FRACTION = 0.72;

/** Beyond this a rich player's tray becomes a skyscraper; the numeric total carries the rest. */
export const TRAY_MAX_VISIBLE_CHIPS = 12;

const TWO_PI = Math.PI * 2;
const HALF = 0.5;

export function chipPalette(theme: Theme, denomination: number): ChipPalette {
  let palettes = paletteCache.get(theme);
  if (palettes === undefined) {
    palettes = chipPalettes(theme);
    paletteCache.set(theme, palettes);
  }
  return palettes[nearestDenomination(denomination)];
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
  /** Colours to paint instead of the blackjack chip's, for a table with its own chip set. */
  palette?: ChipPalette;
  /** Text printed on the face instead of the bare denomination. */
  label?: string;
}

/** One chip lying face-up, centred on (cx, cy), `radius` being its half-width. */
export function drawChip(
  target: PaintTarget,
  cx: number,
  cy: number,
  radius: number,
  denomination: number,
  opts: ChipDrawOpts = {},
): void {
  const { ctx, theme } = target;
  const palette = opts.palette ?? chipPalette(theme, denomination);
  const ry = radius * CHIP_SQUASH;

  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  if (opts.shadow === true) {
    ctx.shadowColor = withAlpha(theme.palette.surface.sunken, CHIP_SHADOW_ALPHA);
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
    const size = Math.max(1, radius * CHIP_LABEL_SIZE_FRACTION);
    ctx.save();
    ctx.globalAlpha = opts.alpha ?? 1;
    text(
      target,
      { x: cx - radius, y: cy - size * HALF, w: radius * 2, h: size },
      {
        text: opts.label ?? `${denomination}`,
        style: { size, weight: CHIP_LABEL_WEIGHT, lineHeight: size },
        color: palette.label,
        align: 'center',
        valign: 'middle',
      },
    );
    ctx.restore();
  }
}

/**
 * A stack of chips growing upward from `baseY`. Only the topmost chip carries a
 * label — a stack of labelled discs reads as noise.
 */
export function drawChipStack(
  target: PaintTarget,
  cx: number,
  baseY: number,
  radius: number,
  chips: ReadonlyArray<number>,
  alpha = 1,
): void {
  const step = radius * CHIP_STACK_STEP;
  chips.forEach((denomination, index) => {
    drawChip(target, cx, baseY - index * step, radius, denomination, {
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
  target: PaintTarget,
  cx: number,
  baseY: number,
  radius: number,
): void {
  const { ctx, theme } = target;
  ctx.save();
  ctx.strokeStyle = withAlpha(skinsFor(theme).casinoChip.rim, EMPTY_TRAY_ALPHA);
  ctx.lineWidth = Math.max(1, radius * CHIP_EDGE_WIDTH_FRACTION);
  ctx.setLineDash([radius * CHIP_STACK_STEP, radius * CHIP_STACK_STEP]);
  ctx.beginPath();
  ctx.ellipse(cx, baseY, radius, radius * CHIP_SQUASH, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();
}

/** One chip of a poker stack: its value and which of the tier's four colours it wears. */
export interface PokerChip {
  readonly value: number;
  readonly colourIndex: number;
}

const THOUSAND = 1000;
const THOUSANDS_SUFFIX = 'K';

/** "25", "250", "2.5K", "10K": a chip face has room for three or four characters. */
export function chipFaceLabel(value: number): string {
  if (value < THOUSAND) return `${value}`;
  return `${value / THOUSAND}${THOUSANDS_SUFFIX}`;
}

const pokerPaletteCache = new WeakMap<Theme, Map<string, ChipPalette>>();

/** The colours of the `colourIndex`th chip value at a poker tier, smallest value first. */
export function pokerChipPalette(
  theme: Theme,
  tier: PokerTierId,
  colourIndex: number,
): ChipPalette {
  let cache = pokerPaletteCache.get(theme);
  if (cache === undefined) {
    cache = new Map();
    pokerPaletteCache.set(theme, cache);
  }
  const key = `${tier}/${colourIndex}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const set = skinsFor(theme).pokerChips[tier];
  const face = set[Math.max(0, Math.min(set.length - 1, colourIndex))];
  const palette: ChipPalette = {
    face: face.face,
    edge: darken(face.face, CHIP_EDGE_DARKEN),
    stripe: skinsFor(theme).casinoChip.stripe,
    label: face.label,
  };
  cache.set(key, palette);
  return palette;
}

/**
 * `amount` broken greedily into a poker tier's chips, largest at the bottom,
 * capped at `maxChips`; the amount printed beside the stack carries whatever
 * the cap leaves out. Any remainder smaller than the smallest chip shows as one
 * smallest chip, so a non-zero bet never draws as an empty spot.
 */
export function pokerChips(amount: number, tier: PokerTierId, maxChips: number): PokerChip[] {
  const values = chipDenominations(tier);
  const chips: PokerChip[] = [];
  let left = amount;
  for (let index = values.length - 1; index >= 0; index--) {
    while (left >= values[index] && chips.length < maxChips) {
      chips.push({ value: values[index], colourIndex: index });
      left -= values[index];
    }
  }
  if (chips.length === 0 && amount > 0) chips.push({ value: values[0], colourIndex: 0 });
  return chips;
}

/** A poker stack standing on `baseY`; only the top chip is labelled. */
export function drawPokerChipStack(
  target: PaintTarget,
  cx: number,
  baseY: number,
  radius: number,
  tier: PokerTierId,
  chips: ReadonlyArray<PokerChip>,
  opts: { readonly alpha?: number; readonly shadow?: boolean; readonly labelTop?: boolean } = {},
): void {
  const step = radius * CHIP_STACK_STEP;
  chips.forEach((chip, index) => {
    const top = index === chips.length - 1 && opts.labelTop !== false;
    drawChip(target, cx, baseY - index * step, radius, chip.value, {
      alpha: opts.alpha,
      shadow: opts.shadow === true && index === 0,
      palette: pokerChipPalette(target.theme, tier, chip.colourIndex),
      showLabel: top,
      label: chipFaceLabel(chip.value),
    });
  });
}
