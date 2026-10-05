/**
 * The UI icon set.
 *
 * Path data copied from Lucide (https://lucide.dev), used under the ISC licence:
 *
 *   ISC License
 *
 *   Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
 *   part of Feather (MIT). All other copyright (c) for Lucide are held by
 *   Lucide Contributors 2022.
 *
 *   Permission to use, copy, modify, and/or distribute this software for any
 *   purpose with or without fee is hereby granted, provided that the above
 *   copyright notice and this permission notice appear in all copies.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 *   WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 *   MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 *   ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 *   WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 *   ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 *   OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * Lucide's `<circle>`, `<rect>` and `<line>` elements are written here as the
 * equivalent path data, so every glyph is a list of SVG path strings.
 *
 * node-canvas has no `Path2D`, so the path data is parsed once into a list of
 * canvas path calls. The browser replays that list into a cached `Path2D`; a
 * render script replays it straight onto its context. Both draw the same
 * geometry from the same parse.
 */

import type { Rect } from '../core/geom';

/** Lucide's drawing grid. */
const GLYPH_VIEWBOX = 24;

/** Lucide's stroke width, in viewbox units. */
export const GLYPH_STROKE_WIDTH = 2;

export const GLYPH_PATHS = {
  close: ['M18 6 6 18', 'm6 6 12 12'],
  back: ['m15 18-6-6 6-6'],
  chevronUp: ['m18 15-6-6-6 6'],
  chevronDown: ['m6 9 6 6 6-6'],
  search: ['m21 21-4.34-4.34', 'M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0'],
  sort: ['m3 16 4 4 4-4', 'M7 20V4', 'M11 4h10', 'M11 8h7', 'M11 12h4'],
  filter: [
    'M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z',
  ],
  bag: [
    'M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
    'M8 10h8',
    'M8 18h8',
    'M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6',
    'M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2',
  ],
  hammer: [
    'm15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9',
    'm18 15 4-4',
    'm21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5',
  ],
  book: [
    'M12 5v16',
    'M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z',
  ],
  pause: [
    'M15 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
    'M6 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
  ],
  map: [
    'M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z',
    'M15 5.764v15',
    'M9 3.236v15',
  ],
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M16 3.128a4 4 0 0 1 0 7.744',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  ],
  coin: [
    'M13.744 17.736a6 6 0 1 1-7.48-7.48',
    'M15 6h1v4',
    'm6.134 14.768.866-.5 2 3.464',
    'M10 8a6 6 0 1 0 12 0a6 6 0 1 0-12 0',
  ],
  heart: [
    'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5',
  ],
  star: [
    'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
  ],
  lock: [
    'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z',
    'M7 11V7a5 5 0 0 1 10 0v4',
  ],
  check: ['M20 6 9 17l-5-5'],
  alert: [
    'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
    'M12 9v4',
    'M12 17h.01',
  ],
  info: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M12 16v-4', 'M12 8h.01'],
  plus: ['M5 12h14', 'M12 5v14'],
  minus: ['M5 12h14'],
  trash: [
    'M10 11v6',
    'M14 11v6',
    'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
    'M3 6h18',
    'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  ],
  swap: ['M8 3 4 7l4 4', 'M4 7h16', 'm16 21 4-4-4-4', 'M20 17H4'],
  sparkle: [
    'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
    'M20 2v4',
    'M22 4h-4',
    'M2 20a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ],
  play: ['M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'],
  chevronRight: ['m9 18 6-6-6-6'],
  compass: [
    'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0',
    'm16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z',
  ],
  user: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0'],
  zap: [
    'M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z',
  ],
  trophy: [
    'M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2',
    'M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2',
    'M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3',
    'M4 22h16',
    'M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z',
    'M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3',
  ],
  settings: [
    'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
    'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  ],
  keyboard: [
    'M10 8h.01',
    'M12 12h.01',
    'M14 8h.01',
    'M16 12h.01',
    'M18 8h.01',
    'M6 8h.01',
    'M7 16h10',
    'M8 12h.01',
    'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  ],
  logOut: ['m16 17 5-5-5-5', 'M21 12H9', 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'],
  anchor: ['M12 22V8', 'M5 12H2a10 10 0 0 0 20 0h-3', 'M9 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  shield: [
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
  ],
  swords: [
    'M14.5 17.5 3 6V3h3l11.5 11.5',
    'M13 19l6-6',
    'M16 16l4 4',
    'M19 21l2-2',
    'M14.5 6.5 18 3h3v3l-3.5 3.5',
    'M5 14l4 4',
    'M7 17l-3 3',
    'M3 19l2 2',
  ],
  cat: [
    'M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z',
    'M8 14v.5',
    'M16 14v.5',
    'M11.25 16.25h1.5L12 17l-.75-.75Z',
  ],
  maximize: ['M15 3h6v6', 'm21 3-7 7', 'm3 21 7-7', 'M9 21H3v-6'],
  minimize: ['m14 10 7-7', 'M20 10h-6V4', 'm3 21 7-7', 'M4 14h6v6'],
  pawPrint: [
    'M9 4a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M16 8a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M18 16a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z',
  ],
  save: [
    'M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7',
    'M7 3v4a1 1 0 0 0 1 1h7',
  ],
  ban: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M4.929 4.929 19.07 19.071'],
  hourglass: [
    'M5 22h14',
    'M5 2h14',
    'M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22',
    'M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2',
  ],
  flask: [
    'M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2',
    'M6.453 15h11.094',
    'M8.5 2h7',
  ],
} as const satisfies Record<string, readonly string[]>;

export type GlyphId = keyof typeof GLYPH_PATHS;

/** Every glyph id, in declaration order (for galleries and tests). */
export const GLYPH_IDS: readonly GlyphId[] = Object.keys(GLYPH_PATHS).filter(isGlyphId);

function isGlyphId(key: string): key is GlyphId {
  return Object.prototype.hasOwnProperty.call(GLYPH_PATHS, key);
}

/** One absolute canvas path call, the parse result of SVG path data. */
type PathCall =
  | { readonly op: 'moveTo'; readonly x: number; readonly y: number }
  | { readonly op: 'lineTo'; readonly x: number; readonly y: number }
  | {
      readonly op: 'bezierCurveTo';
      readonly c1x: number;
      readonly c1y: number;
      readonly c2x: number;
      readonly c2y: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly op: 'quadraticCurveTo';
      readonly cx: number;
      readonly cy: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly op: 'ellipse';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
      readonly rotation: number;
      readonly start: number;
      readonly end: number;
      readonly counterclockwise: boolean;
    }
  | { readonly op: 'closePath' };

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const SEPARATOR_PATTERN = /^[\s,]+/;
const COMMAND_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz]/;

/** A cursor over SVG path data that reads numbers, arc flags and commands. */
class PathReader {
  private index = 0;

  constructor(private readonly data: string) {}

  private skipSeparators(): void {
    const match = SEPARATOR_PATTERN.exec(this.data.slice(this.index));
    if (match !== null) this.index += match[0].length;
  }

  atEnd(): boolean {
    this.skipSeparators();
    return this.index >= this.data.length;
  }

  /** The next command letter, or `null` when the next token is a number (an implicit repeat). */
  command(): string | null {
    this.skipSeparators();
    const match = COMMAND_PATTERN.exec(this.data.slice(this.index));
    if (match === null) return null;
    this.index += match[0].length;
    return match[0];
  }

  number(): number {
    this.skipSeparators();
    const match = NUMBER_PATTERN.exec(this.data.slice(this.index));
    if (match === null)
      throw new Error(`glyph path: expected a number at ${this.index} in "${this.data}"`);
    this.index += match[0].length;
    return Number(match[0]);
  }

  /** Arc flags are a single `0` or `1` and may run straight into the next number (`a5 5 0 014 2`). */
  flag(): boolean {
    this.skipSeparators();
    const char = this.data.charAt(this.index);
    if (char !== '0' && char !== '1')
      throw new Error(`glyph path: expected an arc flag in "${this.data}"`);
    this.index++;
    return char === '1';
  }
}

const FULL_TURN = Math.PI * 2;
const DEGREES_PER_HALF_TURN = 180;

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

/**
 * Converts an SVG endpoint-parameterised arc to the centre parameterisation
 * `ctx.ellipse` takes (SVG 1.1 implementation notes, F.6.5).
 */
function arcToEllipse(
  x1: number,
  y1: number,
  radiusX: number,
  radiusY: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): PathCall {
  let rx = Math.abs(radiusX);
  let ry = Math.abs(radiusY);
  if (rx === 0 || ry === 0) return { op: 'lineTo', x: x2, y: y2 };
  const phi = (rotationDeg * Math.PI) / DEGREES_PER_HALF_TURN;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const halfDx = (x1 - x2) / 2;
  const halfDy = (y1 - y2) / 2;
  const x1p = cosPhi * halfDx + sinPhi * halfDy;
  const y1p = -sinPhi * halfDx + cosPhi * halfDy;
  const radiiScale = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (radiiScale > 1) {
    const grow = Math.sqrt(radiiScale);
    rx *= grow;
    ry *= grow;
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const centreSign = largeArc === sweep ? -1 : 1;
  const coefficient = centreSign * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coefficient * rx * y1p) / ry;
  const cyp = (-coefficient * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  const startX = (x1p - cxp) / rx;
  const startY = (y1p - cyp) / ry;
  const endX = (-x1p - cxp) / rx;
  const endY = (-y1p - cyp) / ry;
  const start = vectorAngle(1, 0, startX, startY);
  let delta = vectorAngle(startX, startY, endX, endY) % FULL_TURN;
  if (!sweep && delta > 0) delta -= FULL_TURN;
  if (sweep && delta < 0) delta += FULL_TURN;
  return {
    op: 'ellipse',
    cx,
    cy,
    rx,
    ry,
    rotation: phi,
    start,
    end: start + delta,
    counterclockwise: delta < 0,
  };
}

/** Parses SVG path data (M L H V C S Q T A Z, absolute and relative) into absolute canvas calls. */
export function parsePathData(data: string): PathCall[] {
  const reader = new PathReader(data);
  const calls: PathCall[] = [];
  let x = 0;
  let y = 0;
  let subpathX = 0;
  let subpathY = 0;
  let lastCubicX: number | null = null;
  let lastCubicY = 0;
  let lastQuadX: number | null = null;
  let lastQuadY = 0;
  let command: string | null = null;

  while (!reader.atEnd()) {
    const explicit = reader.command();
    if (explicit !== null) command = explicit;
    else if (command === null)
      throw new Error(`glyph path: data must start with a command: "${data}"`);
    else if (command === 'M') command = 'L';
    else if (command === 'm') command = 'l';

    const relative = command === command.toLowerCase();
    const baseX = relative ? x : 0;
    const baseY = relative ? y : 0;
    let cubicControl: { x: number; y: number } | null = null;
    let quadControl: { x: number; y: number } | null = null;

    switch (command.toUpperCase()) {
      case 'M': {
        x = baseX + reader.number();
        y = baseY + reader.number();
        subpathX = x;
        subpathY = y;
        calls.push({ op: 'moveTo', x, y });
        break;
      }
      case 'L': {
        x = baseX + reader.number();
        y = baseY + reader.number();
        calls.push({ op: 'lineTo', x, y });
        break;
      }
      case 'H': {
        x = baseX + reader.number();
        calls.push({ op: 'lineTo', x, y });
        break;
      }
      case 'V': {
        y = baseY + reader.number();
        calls.push({ op: 'lineTo', x, y });
        break;
      }
      case 'C': {
        const c1x = baseX + reader.number();
        const c1y = baseY + reader.number();
        const c2x = baseX + reader.number();
        const c2y = baseY + reader.number();
        x = baseX + reader.number();
        y = baseY + reader.number();
        calls.push({ op: 'bezierCurveTo', c1x, c1y, c2x, c2y, x, y });
        cubicControl = { x: c2x, y: c2y };
        break;
      }
      case 'S': {
        const c1x: number = lastCubicX === null ? x : 2 * x - lastCubicX;
        const c1y: number = lastCubicX === null ? y : 2 * y - lastCubicY;
        const c2x = baseX + reader.number();
        const c2y = baseY + reader.number();
        x = baseX + reader.number();
        y = baseY + reader.number();
        calls.push({ op: 'bezierCurveTo', c1x, c1y, c2x, c2y, x, y });
        cubicControl = { x: c2x, y: c2y };
        break;
      }
      case 'Q': {
        const cx = baseX + reader.number();
        const cy = baseY + reader.number();
        x = baseX + reader.number();
        y = baseY + reader.number();
        calls.push({ op: 'quadraticCurveTo', cx, cy, x, y });
        quadControl = { x: cx, y: cy };
        break;
      }
      case 'T': {
        const cx: number = lastQuadX === null ? x : 2 * x - lastQuadX;
        const cy: number = lastQuadX === null ? y : 2 * y - lastQuadY;
        x = baseX + reader.number();
        y = baseY + reader.number();
        calls.push({ op: 'quadraticCurveTo', cx, cy, x, y });
        quadControl = { x: cx, y: cy };
        break;
      }
      case 'A': {
        const rx = reader.number();
        const ry = reader.number();
        const rotation = reader.number();
        const largeArc = reader.flag();
        const sweep = reader.flag();
        const endX = baseX + reader.number();
        const endY = baseY + reader.number();
        // An arc that ends where it starts is omitted entirely (SVG 1.1, F.6.2).
        const zeroLength = endX === x && endY === y;
        if (!zeroLength) {
          calls.push(arcToEllipse(x, y, rx, ry, rotation, largeArc, sweep, endX, endY));
        }
        x = endX;
        y = endY;
        break;
      }
      case 'Z': {
        calls.push({ op: 'closePath' });
        x = subpathX;
        y = subpathY;
        break;
      }
      default:
        throw new Error(`glyph path: unsupported command "${command}"`);
    }

    lastCubicX = cubicControl?.x ?? null;
    lastCubicY = cubicControl?.y ?? 0;
    lastQuadX = quadControl?.x ?? null;
    lastQuadY = quadControl?.y ?? 0;
  }
  return calls;
}

/** Replays parsed calls onto anything with the canvas path API: a context or a `Path2D`. */
function replay(target: CanvasPath, calls: readonly PathCall[]): void {
  for (const call of calls) {
    switch (call.op) {
      case 'moveTo':
        target.moveTo(call.x, call.y);
        break;
      case 'lineTo':
        target.lineTo(call.x, call.y);
        break;
      case 'bezierCurveTo':
        target.bezierCurveTo(call.c1x, call.c1y, call.c2x, call.c2y, call.x, call.y);
        break;
      case 'quadraticCurveTo':
        target.quadraticCurveTo(call.cx, call.cy, call.x, call.y);
        break;
      case 'ellipse':
        target.ellipse(
          call.cx,
          call.cy,
          call.rx,
          call.ry,
          call.rotation,
          call.start,
          call.end,
          call.counterclockwise,
        );
        break;
      case 'closePath':
        target.closePath();
        break;
    }
  }
}

interface CompiledGlyph {
  readonly calls: readonly (readonly PathCall[])[];
  /** `null` where the runtime has no `Path2D` (node-canvas). */
  readonly paths: readonly Path2D[] | null;
}

const compiled = new Map<GlyphId, CompiledGlyph>();

function compileGlyph(id: GlyphId): CompiledGlyph {
  const cached = compiled.get(id);
  if (cached !== undefined) return cached;
  const calls = GLYPH_PATHS[id].map((data) => parsePathData(data));
  const paths =
    typeof Path2D === 'undefined'
      ? null
      : calls.map((list) => {
          const path = new Path2D();
          replay(path, list);
          return path;
        });
  const glyph: CompiledGlyph = { calls, paths };
  compiled.set(id, glyph);
  return glyph;
}

export interface GlyphStyle {
  /** Stroke colour; defaults to the context's current stroke style. */
  readonly color?: string;
  /** Stroke width in viewbox units (the glyph is drawn on a 24-unit grid). */
  readonly strokeWidth?: number;
}

/**
 * Strokes glyph `id` scaled to fit `rect` (the largest centred square inside
 * it), with round caps and joins as Lucide draws them.
 */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  id: GlyphId,
  rect: Rect,
  style: GlyphStyle = {},
): void {
  const glyph = compileGlyph(id);
  const side = Math.min(rect.w, rect.h);
  const scale = side / GLYPH_VIEWBOX;
  ctx.save();
  ctx.translate(rect.x + (rect.w - side) / 2, rect.y + (rect.h - side) / 2);
  ctx.scale(scale, scale);
  if (style.color !== undefined) ctx.strokeStyle = style.color;
  ctx.lineWidth = style.strokeWidth ?? GLYPH_STROKE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (glyph.paths !== null) {
    for (const path of glyph.paths) ctx.stroke(path);
  } else {
    for (const calls of glyph.calls) {
      ctx.beginPath();
      replay(ctx, calls);
      ctx.stroke();
    }
  }
  ctx.restore();
}
