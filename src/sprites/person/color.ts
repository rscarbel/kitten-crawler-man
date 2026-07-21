/**
 * Palette pools and hex shading for procedural people. Pools are grown from the
 * club-crowd palette in `clubNpcSprite.ts` but broadened so a town reads as a
 * genuinely varied population. `shade`/`tint` derive the darker fold shadows
 * and lighter highlights every garment and skin patch needs from a single base
 * color, so the genome only has to store one color per feature.
 */

import { clamp } from '../../utils';

export const SKIN_TONES = [
  '#ffe0bd',
  '#f8d5a8',
  '#f0c9a0',
  '#e8b98f',
  '#e0a878',
  '#d89b6a',
  '#c68a52',
  '#b57a44',
  '#a56b3a',
  '#8a5a2c',
  '#70481f',
  '#573418',
] as const;

export const HAIR_COLORS = [
  '#0a0a0a',
  '#150d06',
  '#2a1a0e',
  '#3a2410',
  '#5a3a18',
  '#6a4020',
  '#8a5a2c',
  '#b07a30',
  '#c8a850',
  '#e0c878',
  '#d8d4cc',
  '#e8e4dc',
  '#7a2a2a',
  '#9a3a2a',
  '#b0482a',
  '#5a5a62',
  '#8a8a92',
] as const;

export const EYE_COLORS = [
  '#3a2412',
  '#4a2e14',
  '#5a3a1a',
  '#2a1a0e',
  '#3a5a3a',
  '#4a6a4a',
  '#3a5a7a',
  '#4a6a8a',
  '#5a7a8a',
  '#6a6a6a',
] as const;

export const TOP_COLORS = [
  '#c0392b',
  '#2c6ba0',
  '#27824f',
  '#8e44ad',
  '#d68910',
  '#16a085',
  '#c0447a',
  '#34495e',
  '#7f8c8d',
  '#d0d3d4',
  '#2c3e50',
  '#a0522d',
  '#4a5a2a',
  '#5a2a3a',
  '#e0b040',
] as const;

export const BOTTOM_COLORS = [
  '#2c3e50',
  '#34495e',
  '#4a3a2a',
  '#5a4a38',
  '#3a3a4a',
  '#2a2a2e',
  '#5a5a5a',
  '#6a5a3a',
  '#3a4a5a',
  '#4a2a2a',
  '#556b2f',
  '#7a6a52',
] as const;

export const SHOE_COLORS = [
  '#1a1410',
  '#2a1a10',
  '#3a2a1a',
  '#0a0a0a',
  '#4a3a2a',
  '#5a4a3a',
] as const;

export const ACCENT_COLORS = [
  '#e0c060',
  '#e0d0c0',
  '#c0d0e0',
  '#e04848',
  '#40c0a0',
  '#f0f0f0',
  '#202020',
] as const;

const HEX_RADIX = 16;
const BYTE_MAX = 255;
const HEX_PER_CHANNEL = 2;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb {
  const body = hex.startsWith('#') ? hex.slice(1) : hex;
  return {
    r: parseInt(body.slice(0, HEX_PER_CHANNEL), HEX_RADIX),
    g: parseInt(body.slice(HEX_PER_CHANNEL, HEX_PER_CHANNEL * 2), HEX_RADIX),
    b: parseInt(body.slice(HEX_PER_CHANNEL * 2, HEX_PER_CHANNEL * 3), HEX_RADIX),
  };
}

function channelToHex(v: number): string {
  return clamp(Math.round(v), 0, BYTE_MAX).toString(HEX_RADIX).padStart(HEX_PER_CHANNEL, '0');
}

function toHex(rgb: Rgb): string {
  return `#${channelToHex(rgb.r)}${channelToHex(rgb.g)}${channelToHex(rgb.b)}`;
}

/** Darkens `hex` toward black by `amount` (0..1). */
export function shade(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  const factor = 1 - amount;
  return toHex({ r: r * factor, g: g * factor, b: b * factor });
}

/** Lightens `hex` toward white by `amount` (0..1). */
export function tint(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  return toHex({
    r: r + (BYTE_MAX - r) * amount,
    g: g + (BYTE_MAX - g) * amount,
    b: b + (BYTE_MAX - b) * amount,
  });
}
