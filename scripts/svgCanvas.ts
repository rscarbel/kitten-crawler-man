/**
 * A Canvas2D context that records SVG instead of rasterising.
 *
 * The game's art is code — every character is a `draw…` function full of
 * `ctx` calls — so the vector original already exists; it is just thrown away
 * at `fill()` time. This replays those calls into an SVG document, which makes
 * any character exportable as scalable art without redrawing it by hand.
 *
 * It implements the subset of the 2D API the sprite modules actually reach for.
 * Anything outside that subset either throws (an unimplemented method is simply
 * absent) or records a warning on {@link SvgRecorder.warnings}, so a sprite that
 * uses something unrepresentable says so rather than silently losing geometry.
 */

import { createCanvas } from 'canvas';
import type { CanvasRenderingContext2D as NodeCanvasContext } from 'canvas';

/** A cubic bezier tracks a circular arc well below this sweep and poorly above it. */
const BEZIER_ARC_MAX_SWEEP = Math.PI / 2;
const FULL_TURN = Math.PI * 2;
/** Canvas `shadowBlur` is roughly twice the Gaussian deviation SVG filters take. */
const BLUR_TO_STD_DEVIATION = 0.5;
/** Coordinates are emitted at this many decimals; finer is noise at any zoom. */
const OUTPUT_DECIMALS = 4;
const DEFAULT_FONT = '10px sans-serif';
const DEFAULT_FONT_SIZE_PX = 10;

/** Control-handle length for a cubic approximation of an arc of `sweep` radians. */
const arcHandle = (sweep: number) => (4 / 3) * Math.tan(sweep / 4);

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** The uniform scale a matrix applies, taken from the area it multiplies. */
const matrixScale = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

const ROUNDING_FACTOR = 10 ** OUTPUT_DECIMALS;

const num = (value: number) => {
  const rounded = Math.round(value * ROUNDING_FACTOR) / ROUNDING_FACTOR;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const escapeText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const UNBOUNDED: Box = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };
const EMPTY: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

const intersect = (a: Box, b: Box): Box => ({
  minX: Math.max(a.minX, b.minX),
  minY: Math.max(a.minY, b.minY),
  maxX: Math.min(a.maxX, b.maxX),
  maxY: Math.min(a.maxY, b.maxY),
});

const isEmptyBox = (box: Box) => box.minX > box.maxX || box.minY > box.maxY;

class SvgGradient {
  readonly stops: Array<{ offset: number; color: string }> = [];

  constructor(
    readonly kind: 'linear' | 'radial',
    readonly coords: readonly number[],
  ) {}

  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }
}

type Paint = string | SvgGradient;

/**
 * Canvas composite modes that CSS can express directly. The `destination-*` and
 * `source-in`/`source-out` family have no blend-mode equivalent — they erase
 * what is already painted, which SVG can only do with a mask — so they are
 * warned about instead of being quietly approximated.
 */
const BLEND_MODES: ReadonlyMap<string, string> = new Map([
  ['lighter', 'plus-lighter'],
  ['multiply', 'multiply'],
  ['screen', 'screen'],
  ['overlay', 'overlay'],
  ['darken', 'darken'],
  ['lighten', 'lighten'],
  ['color-dodge', 'color-dodge'],
  ['color-burn', 'color-burn'],
  ['hard-light', 'hard-light'],
  ['soft-light', 'soft-light'],
  ['difference', 'difference'],
  ['exclusion', 'exclusion'],
  ['hue', 'hue'],
  ['saturation', 'saturation'],
  ['color', 'color'],
  ['luminosity', 'luminosity'],
]);

const TEXT_ANCHORS: ReadonlyMap<string, string> = new Map([
  ['left', 'start'],
  ['start', 'start'],
  ['center', 'middle'],
  ['right', 'end'],
  ['end', 'end'],
]);

const DOMINANT_BASELINES: ReadonlyMap<string, string> = new Map([
  ['top', 'text-before-edge'],
  ['hanging', 'hanging'],
  ['middle', 'central'],
  ['alphabetic', 'auto'],
  ['ideographic', 'auto'],
  ['bottom', 'text-after-edge'],
]);

interface State {
  matrix: Matrix;
  fillStyle: Paint;
  strokeStyle: Paint;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  miterLimit: number;
  globalAlpha: number;
  globalCompositeOperation: string;
  shadowBlur: number;
  shadowColor: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  /** Device-space box outside which nothing painted in this state can be seen. */
  clipBounds: Box;
  /** How many `<g>` elements this state opened and must close on `restore`. */
  openGroups: number;
}

interface Point {
  x: number;
  y: number;
}

/** Anything with pixels that SVG can embed, however it was produced. */
interface EmbeddableImage {
  width: number;
  height: number;
  toDataURL?: () => string;
  src?: unknown;
}

const isEmbeddableImage = (value: unknown): value is EmbeddableImage =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'width') === 'number' &&
  typeof Reflect.get(value, 'height') === 'number';

export class SvgRecorder {
  /** Everything the recording could not represent faithfully. */
  readonly warnings: string[] = [];

  private state: State = {
    matrix: IDENTITY,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    font: DEFAULT_FONT,
    textAlign: 'start',
    textBaseline: 'alphabetic',
    clipBounds: UNBOUNDED,
    openGroups: 0,
  };

  private stack: State[] = [];
  private path: string[] = [];
  private pathPoints: Point[] = [];
  private currentPoint: Point | null = null;
  private subpathStart: Point | null = null;
  private body: string[] = [];
  private defs: string[] = [];
  private nextId = 0;
  private bounds: Box = { ...EMPTY };
  /**
   * Text metrics are a font-rasteriser question, not a geometry one, so they
   * are delegated to a real canvas rather than guessed at.
   */
  private readonly measuringContext = createCanvas(1, 1).getContext('2d');

  /** Device-space box enclosing everything actually painted so far. */
  get paintedBounds(): Box {
    return { ...this.bounds };
  }

  /* ── State ───────────────────────────────────────────────────────────── */

  save(): void {
    this.stack.push({ ...this.state });
    this.state = { ...this.state, openGroups: 0 };
  }

  restore(): void {
    this.closeOpenGroups();
    const previous = this.stack.pop();
    if (previous !== undefined) this.state = previous;
  }

  get fillStyle(): Paint {
    return this.state.fillStyle;
  }
  set fillStyle(value: Paint) {
    this.state.fillStyle = value;
  }

  get strokeStyle(): Paint {
    return this.state.strokeStyle;
  }
  set strokeStyle(value: Paint) {
    this.state.strokeStyle = value;
  }

  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(value: number) {
    this.state.lineWidth = value;
  }

  get lineCap(): string {
    return this.state.lineCap;
  }
  set lineCap(value: string) {
    this.state.lineCap = value;
  }

  get lineJoin(): string {
    return this.state.lineJoin;
  }
  set lineJoin(value: string) {
    this.state.lineJoin = value;
  }

  get miterLimit(): number {
    return this.state.miterLimit;
  }
  set miterLimit(value: number) {
    this.state.miterLimit = value;
  }

  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(value: number) {
    this.state.globalAlpha = value;
  }

  get globalCompositeOperation(): string {
    return this.state.globalCompositeOperation;
  }
  set globalCompositeOperation(value: string) {
    this.state.globalCompositeOperation = value;
  }

  get shadowBlur(): number {
    return this.state.shadowBlur;
  }
  set shadowBlur(value: number) {
    this.state.shadowBlur = value;
  }

  get shadowColor(): string {
    return this.state.shadowColor;
  }
  set shadowColor(value: string) {
    this.state.shadowColor = value;
  }

  get font(): string {
    return this.state.font;
  }
  set font(value: string) {
    this.state.font = value;
  }

  get textAlign(): string {
    return this.state.textAlign;
  }
  set textAlign(value: string) {
    this.state.textAlign = value;
  }

  get textBaseline(): string {
    return this.state.textBaseline;
  }
  set textBaseline(value: string) {
    this.state.textBaseline = value;
  }

  /* ── Transforms ──────────────────────────────────────────────────────── */

  translate(x: number, y: number): void {
    this.state.matrix = multiply(this.state.matrix, [1, 0, 0, 1, x, y]);
  }

  scale(x: number, y: number): void {
    this.state.matrix = multiply(this.state.matrix, [x, 0, 0, y, 0, 0]);
  }

  rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.state.matrix = multiply(this.state.matrix, [cos, sin, -sin, cos, 0, 0]);
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.state.matrix = multiply(this.state.matrix, [a, b, c, d, e, f]);
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.state.matrix = [a, b, c, d, e, f];
  }

  resetTransform(): void {
    this.state.matrix = IDENTITY;
  }

  /* ── Path building ───────────────────────────────────────────────────── */

  beginPath(): void {
    this.path = [];
    this.pathPoints = [];
    this.currentPoint = null;
    this.subpathStart = null;
  }

  moveTo(x: number, y: number): void {
    this.path.push(`M${num(x)} ${num(y)}`);
    this.pathPoints.push({ x, y });
    this.currentPoint = { x, y };
    this.subpathStart = { x, y };
  }

  lineTo(x: number, y: number): void {
    if (this.currentPoint === null) return this.moveTo(x, y);
    this.path.push(`L${num(x)} ${num(y)}`);
    this.pathPoints.push({ x, y });
    this.currentPoint = { x, y };
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    if (this.currentPoint === null) this.moveTo(cx, cy);
    this.path.push(`Q${num(cx)} ${num(cy)} ${num(x)} ${num(y)}`);
    this.pathPoints.push({ x: cx, y: cy }, { x, y });
    this.currentPoint = { x, y };
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    if (this.currentPoint === null) this.moveTo(c1x, c1y);
    this.path.push(`C${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(x)} ${num(y)}`);
    this.pathPoints.push({ x: c1x, y: c1y }, { x: c2x, y: c2y }, { x, y });
    this.currentPoint = { x, y };
  }

  closePath(): void {
    if (this.currentPoint === null) return;
    this.path.push('Z');
    if (this.subpathStart !== null) this.currentPoint = { ...this.subpathStart };
  }

  arc(cx: number, cy: number, r: number, start: number, end: number, ccw = false): void {
    this.ellipse(cx, cy, r, r, 0, start, end, ccw);
  }

  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    ccw = false,
  ): void {
    const sweep = arcSweep(start, end, ccw);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    const at = (angle: number): Point => {
      const ux = Math.cos(angle) * rx;
      const uy = Math.sin(angle) * ry;
      return { x: cx + ux * cos - uy * sin, y: cy + ux * sin + uy * cos };
    };
    const tangentAt = (angle: number): Point => {
      const ux = -Math.sin(angle) * rx;
      const uy = Math.cos(angle) * ry;
      return { x: ux * cos - uy * sin, y: ux * sin + uy * cos };
    };

    const first = at(start);
    if (this.currentPoint === null) this.moveTo(first.x, first.y);
    else this.lineTo(first.x, first.y);

    const segments = Math.max(1, Math.ceil(Math.abs(sweep) / BEZIER_ARC_MAX_SWEEP));
    const step = sweep / segments;
    const handle = arcHandle(step);
    for (let i = 0; i < segments; i += 1) {
      const from = start + step * i;
      const to = from + step;
      const p0 = at(from);
      const p1 = at(to);
      const t0 = tangentAt(from);
      const t1 = tangentAt(to);
      this.bezierCurveTo(
        p0.x + t0.x * handle,
        p0.y + t0.y * handle,
        p1.x - t1.x * handle,
        p1.y - t1.y * handle,
        p1.x,
        p1.y,
      );
    }
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    const from = this.currentPoint;
    if (from === null) return this.moveTo(x1, y1);

    const toStart = { x: from.x - x1, y: from.y - y1 };
    const toEnd = { x: x2 - x1, y: y2 - y1 };
    const startLength = Math.hypot(toStart.x, toStart.y);
    const endLength = Math.hypot(toEnd.x, toEnd.y);
    if (startLength === 0 || endLength === 0 || radius === 0) return this.lineTo(x1, y1);

    const startUnit = { x: toStart.x / startLength, y: toStart.y / startLength };
    const endUnit = { x: toEnd.x / endLength, y: toEnd.y / endLength };
    const cornerAngle = Math.acos(
      Math.min(1, Math.max(-1, startUnit.x * endUnit.x + startUnit.y * endUnit.y)),
    );
    if (cornerAngle === 0 || cornerAngle === Math.PI) return this.lineTo(x1, y1);

    const tangentDistance = radius / Math.tan(cornerAngle / 2);
    const tangentIn = {
      x: x1 + startUnit.x * tangentDistance,
      y: y1 + startUnit.y * tangentDistance,
    };
    const tangentOut = { x: x1 + endUnit.x * tangentDistance, y: y1 + endUnit.y * tangentDistance };

    this.lineTo(tangentIn.x, tangentIn.y);
    const clockwise = startUnit.x * endUnit.y - startUnit.y * endUnit.x < 0;
    this.path.push(
      `A${num(radius)} ${num(radius)} 0 0 ${clockwise ? 1 : 0} ` +
        `${num(tangentOut.x)} ${num(tangentOut.y)}`,
    );
    this.pathPoints.push(tangentOut, { x: x1, y: y1 });
    this.currentPoint = tangentOut;
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }

  roundRect(x: number, y: number, w: number, h: number, radii: number | number[] = 0): void {
    const requested = typeof radii === 'number' ? radii : (radii[0] ?? 0);
    const r = Math.min(requested, Math.abs(w) / 2, Math.abs(h) / 2);
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.arcTo(x + w, y, x + w, y + r, r);
    this.lineTo(x + w, y + h - r);
    this.arcTo(x + w, y + h, x + w - r, y + h, r);
    this.lineTo(x + r, y + h);
    this.arcTo(x, y + h, x, y + h - r, r);
    this.lineTo(x, y + r);
    this.arcTo(x, y, x + r, y, r);
    this.closePath();
  }

  /* ── Painting ────────────────────────────────────────────────────────── */

  fill(): void {
    this.emitPath('fill');
  }

  stroke(): void {
    this.emitPath('stroke');
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.withScratchPath(() => {
      this.rect(x, y, w, h);
      this.emitPath('fill');
    });
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.withScratchPath(() => {
      this.rect(x, y, w, h);
      this.emitPath('stroke');
    });
  }

  clip(): void {
    const id = this.claimId('clip');
    this.defs.push(
      `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">` +
        `<path d="${this.path.join(' ')}" transform="${this.transformAttr()}"/></clipPath>`,
    );
    this.body.push(`<g clip-path="url(#${id})">`);
    this.state.openGroups += 1;
    this.state.clipBounds = intersect(this.state.clipBounds, this.pathDeviceBox(0));
  }

  measureText(text: string): { width: number } {
    this.measuringContext.font = this.state.font;
    return { width: this.measuringContext.measureText(text).width };
  }

  fillText(text: string, x: number, y: number): void {
    this.emitText(text, x, y, 'fill');
  }

  strokeText(text: string, x: number, y: number): void {
    this.emitText(text, x, y, 'stroke');
  }

  drawImage(image: unknown, ...coords: number[]): void {
    if (!isEmbeddableImage(image)) {
      this.warnings.push('drawImage skipped: source is not an image');
      return;
    }

    const placement = imagePlacement(image, coords);
    if (placement === null) {
      this.warnings.push(`drawImage skipped: unsupported argument count (${coords.length})`);
      return;
    }

    const href = imageDataUrl(image);
    if (href === null) {
      this.warnings.push('drawImage skipped: source pixels are not readable as a data URL');
      return;
    }

    const { source, dest } = placement;
    const scaleX = dest.w / source.w;
    const scaleY = dest.h / source.h;
    const drawn = {
      x: dest.x - source.x * scaleX,
      y: dest.y - source.y * scaleY,
      w: image.width * scaleX,
      h: image.height * scaleY,
    };

    const cropsSource =
      source.x !== 0 || source.y !== 0 || source.w !== image.width || source.h !== image.height;
    const clipId = cropsSource ? this.claimId('imgclip') : null;
    if (clipId !== null) {
      this.defs.push(
        `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><rect x="${num(dest.x)}" ` +
          `y="${num(dest.y)}" width="${num(dest.w)}" height="${num(dest.h)}"/></clipPath>`,
      );
    }

    const attrs = [
      `x="${num(drawn.x)}"`,
      `y="${num(drawn.y)}"`,
      `width="${num(drawn.w)}"`,
      `height="${num(drawn.h)}"`,
      'preserveAspectRatio="none"',
      `href="${escapeAttr(href)}"`,
      `transform="${this.transformAttr()}"`,
    ];
    if (clipId !== null) attrs.push(`clip-path="url(#${clipId})"`);
    if (this.state.globalAlpha < 1) attrs.push(`opacity="${num(this.state.globalAlpha)}"`);

    this.body.push(`<image ${attrs.join(' ')}${this.blendAttr()}${this.shadowFilterAttr()}/>`);
    this.expandBounds(
      this.deviceBoxOf([
        { x: dest.x, y: dest.y },
        { x: dest.x + dest.w, y: dest.y + dest.h },
      ]),
    );
  }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SvgGradient {
    return new SvgGradient('linear', [x0, y0, x1, y1]);
  }

  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): SvgGradient {
    return new SvgGradient('radial', [x0, y0, r0, x1, y1, r1]);
  }

  /* ── Output ──────────────────────────────────────────────────────────── */

  toSvg(options: {
    viewBox: Box;
    pixelWidth: number;
    pixelHeight: number;
    title: string;
    background?: string;
  }): string {
    while (this.stack.length > 0) this.restore();
    this.closeOpenGroups();

    const { minX, minY, maxX, maxY } = options.viewBox;
    const width = maxX - minX;
    const height = maxY - minY;
    const backdrop =
      options.background === undefined
        ? ''
        : `<rect x="${num(minX)}" y="${num(minY)}" width="${num(width)}" ` +
          `height="${num(height)}" fill="${escapeAttr(options.background)}"/>`;

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${options.pixelWidth}" ` +
        `height="${options.pixelHeight}" ` +
        `viewBox="${num(minX)} ${num(minY)} ${num(width)} ${num(height)}">`,
      `<title>${escapeText(options.title)}</title>`,
      this.defs.length > 0 ? `<defs>${this.defs.join('')}</defs>` : '',
      backdrop,
      ...this.body,
      '</svg>',
      '',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  /* ── Internals ───────────────────────────────────────────────────────── */

  private claimId(prefix: string): string {
    this.nextId += 1;
    return `${prefix}${this.nextId}`;
  }

  private closeOpenGroups(): void {
    for (let i = 0; i < this.state.openGroups; i += 1) this.body.push('</g>');
    this.state.openGroups = 0;
  }

  private withScratchPath(build: () => void): void {
    const savedPath = this.path;
    const savedPoints = this.pathPoints;
    const savedCurrent = this.currentPoint;
    const savedStart = this.subpathStart;
    this.beginPath();
    build();
    this.path = savedPath;
    this.pathPoints = savedPoints;
    this.currentPoint = savedCurrent;
    this.subpathStart = savedStart;
  }

  private deviceBoxOf(points: readonly Point[], outset = 0): Box {
    const m = this.state.matrix;
    const box: Box = { ...EMPTY };
    for (const point of points) {
      const x = m[0] * point.x + m[2] * point.y + m[4];
      const y = m[1] * point.x + m[3] * point.y + m[5];
      box.minX = Math.min(box.minX, x - outset);
      box.minY = Math.min(box.minY, y - outset);
      box.maxX = Math.max(box.maxX, x + outset);
      box.maxY = Math.max(box.maxY, y + outset);
    }
    return box;
  }

  private pathDeviceBox(outset: number): Box {
    return this.deviceBoxOf(this.pathPoints, outset);
  }

  /**
   * Bezier control points overshoot the curve they steer, and clipped fills are
   * routinely drawn far wider than the window they show through, so what is
   * visible is the painted hull intersected with the clip in force. Without the
   * intersection an auto-cropped viewBox strands the figure in empty space.
   */
  private expandBounds(box: Box): void {
    const visible = intersect(box, this.state.clipBounds);
    if (isEmptyBox(visible)) return;
    this.bounds.minX = Math.min(this.bounds.minX, visible.minX);
    this.bounds.minY = Math.min(this.bounds.minY, visible.minY);
    this.bounds.maxX = Math.max(this.bounds.maxX, visible.maxX);
    this.bounds.maxY = Math.max(this.bounds.maxY, visible.maxY);
  }

  private transformAttr(): string {
    return `matrix(${this.state.matrix.map(num).join(' ')})`;
  }

  private paintAttr(paint: Paint): string {
    if (typeof paint === 'string') return escapeAttr(paint);

    const id = this.claimId('grad');
    const stops = paint.stops
      .map((stop) => `<stop offset="${num(stop.offset)}" stop-color="${escapeAttr(stop.color)}"/>`)
      .join('');

    if (paint.kind === 'linear') {
      const [x0, y0, x1, y1] = paint.coords;
      this.defs.push(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(x0)}" ` +
          `y1="${num(y0)}" x2="${num(x1)}" y2="${num(y1)}">${stops}</linearGradient>`,
      );
    } else {
      const [focusX, focusY, , centreX, centreY, radius] = paint.coords;
      this.defs.push(
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(centreX)}" ` +
          `cy="${num(centreY)}" r="${num(radius)}" fx="${num(focusX)}" fy="${num(focusY)}">` +
          `${stops}</radialGradient>`,
      );
    }
    return `url(#${id})`;
  }

  /**
   * Canvas measures shadow blur in device pixels and ignores the transform,
   * while an SVG filter lives in the element's own user space — so the radius
   * has to be divided back down or every glow blooms with the figure.
   */
  private shadowFilterAttr(): string {
    if (this.state.shadowBlur <= 0) return '';
    const id = this.claimId('glow');
    const deviation =
      (this.state.shadowBlur * BLUR_TO_STD_DEVIATION) / matrixScale(this.state.matrix);
    this.defs.push(
      `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">` +
        `<feDropShadow dx="0" dy="0" stdDeviation="${num(deviation)}" ` +
        `flood-color="${escapeAttr(this.state.shadowColor)}"/></filter>`,
    );
    return ` filter="url(#${id})"`;
  }

  private blendAttr(): string {
    const mode = this.state.globalCompositeOperation;
    if (mode === 'source-over') return '';
    const css = BLEND_MODES.get(mode);
    if (css === undefined) {
      this.warnings.push(`globalCompositeOperation "${mode}" has no SVG equivalent; ignored`);
      return '';
    }
    return ` style="mix-blend-mode:${css}"`;
  }

  private paintAttrs(mode: 'fill' | 'stroke'): string[] {
    if (mode === 'fill') {
      return [`fill="${this.paintAttr(this.state.fillStyle)}"`, 'stroke="none"'];
    }
    const attrs = [
      'fill="none"',
      `stroke="${this.paintAttr(this.state.strokeStyle)}"`,
      `stroke-width="${num(this.state.lineWidth)}"`,
    ];
    if (this.state.lineCap !== 'butt') attrs.push(`stroke-linecap="${this.state.lineCap}"`);
    if (this.state.lineJoin !== 'miter') attrs.push(`stroke-linejoin="${this.state.lineJoin}"`);
    return attrs;
  }

  private emitPath(mode: 'fill' | 'stroke'): void {
    if (this.path.length === 0) return;

    const strokeReach =
      mode === 'stroke' ? (this.state.lineWidth * matrixScale(this.state.matrix)) / 2 : 0;
    this.expandBounds(this.pathDeviceBox(strokeReach));

    const attrs = [`d="${this.path.join(' ')}"`, ...this.paintAttrs(mode)];
    if (this.state.globalAlpha < 1) attrs.push(`opacity="${num(this.state.globalAlpha)}"`);
    attrs.push(`transform="${this.transformAttr()}"`);

    this.body.push(`<path ${attrs.join(' ')}${this.blendAttr()}${this.shadowFilterAttr()}/>`);
  }

  private emitText(text: string, x: number, y: number, mode: 'fill' | 'stroke'): void {
    const font = parseFont(this.state.font);
    const attrs = [`x="${num(x)}"`, `y="${num(y)}"`, ...this.paintAttrs(mode)];

    attrs.push(`font-family="${escapeAttr(font.family)}"`, `font-size="${num(font.sizePx)}"`);
    if (font.weight !== null) attrs.push(`font-weight="${escapeAttr(font.weight)}"`);
    if (font.style !== null) attrs.push(`font-style="${escapeAttr(font.style)}"`);

    const anchor = TEXT_ANCHORS.get(this.state.textAlign);
    if (anchor !== undefined && anchor !== 'start') attrs.push(`text-anchor="${anchor}"`);
    const baseline = DOMINANT_BASELINES.get(this.state.textBaseline);
    if (baseline !== undefined && baseline !== 'auto')
      attrs.push(`dominant-baseline="${baseline}"`);

    if (this.state.globalAlpha < 1) attrs.push(`opacity="${num(this.state.globalAlpha)}"`);
    attrs.push(`transform="${this.transformAttr()}"`);

    this.body.push(
      `<text ${attrs.join(' ')}${this.blendAttr()}${this.shadowFilterAttr()}>` +
        `${escapeText(text)}</text>`,
    );

    const width = this.measureText(text).width;
    this.expandBounds(
      this.deviceBoxOf([
        { x, y: y - font.sizePx },
        { x: x + width, y: y + font.sizePx },
      ]),
    );
  }
}

/** Canvas normalises an arc sweep by direction; SVG needs the signed angle. */
function arcSweep(start: number, end: number, counterClockwise: boolean): number {
  let sweep = end - start;
  if (counterClockwise) {
    while (sweep > 0) sweep -= FULL_TURN;
    return Math.max(sweep, -FULL_TURN);
  }
  while (sweep < 0) sweep += FULL_TURN;
  return Math.min(sweep, FULL_TURN);
}

interface ParsedFont {
  sizePx: number;
  family: string;
  weight: string | null;
  style: string | null;
}

const FONT_PATTERN = /^\s*(?<leading>[a-z0-9 ]*?)\s*(?<size>[\d.]+)px\s+(?<family>.+)$/i;
const FONT_STYLES = new Set(['italic', 'oblique']);

function parseFont(font: string): ParsedFont {
  const match = FONT_PATTERN.exec(font);
  if (match?.groups === undefined) {
    return { sizePx: DEFAULT_FONT_SIZE_PX, family: font, weight: null, style: null };
  }

  const leadingWords = match.groups.leading.split(/\s+/).filter((word) => word !== '');
  const style = leadingWords.find((word) => FONT_STYLES.has(word.toLowerCase())) ?? null;
  const weight = leadingWords.find((word) => word !== style) ?? null;

  return {
    sizePx: Number(match.groups.size),
    family: match.groups.family.trim(),
    weight,
    style,
  };
}

interface Rectangle {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Resolves `drawImage`'s three overloads into an explicit source and destination. */
function imagePlacement(
  image: EmbeddableImage,
  coords: readonly number[],
): { source: Rectangle; dest: Rectangle } | null {
  const whole: Rectangle = { x: 0, y: 0, w: image.width, h: image.height };

  if (coords.length === 2) {
    return { source: whole, dest: { x: coords[0], y: coords[1], w: whole.w, h: whole.h } };
  }
  if (coords.length === 4) {
    return { source: whole, dest: { x: coords[0], y: coords[1], w: coords[2], h: coords[3] } };
  }
  if (coords.length === 8) {
    return {
      source: { x: coords[0], y: coords[1], w: coords[2], h: coords[3] },
      dest: { x: coords[4], y: coords[5], w: coords[6], h: coords[7] },
    };
  }
  return null;
}

function imageDataUrl(image: EmbeddableImage): string | null {
  if (typeof image.toDataURL === 'function') return image.toDataURL();
  if (typeof image.src === 'string' && image.src.startsWith('data:')) return image.src;

  const copy = createCanvas(image.width, image.height);
  const copyContext = copy.getContext('2d');
  if (!isDrawableSource(image)) return null;
  copyContext.drawImage(image, 0, 0);
  return copy.toDataURL();
}

type NodeDrawableSource = Parameters<NodeCanvasContext['drawImage']>[0];

function isDrawableSource(image: EmbeddableImage): image is EmbeddableImage & NodeDrawableSource {
  return 'src' in image || 'getContext' in image;
}

/* ── Context adapters ────────────────────────────────────────────────────── */

interface CanvasGlobals {
  CanvasRenderingContext2D?: unknown;
}

/**
 * Hands the recorder to code written against the DOM's `CanvasRenderingContext2D`
 * — everything under `src/sprites/`.
 *
 * The recorder cannot structurally satisfy that interface (it implements the
 * drawing subset, not the hundred-odd members the DOM declares), and the rule
 * against casts stands, so the type is obtained the only honest way left: Node
 * has no `CanvasRenderingContext2D` global, so this installs one whose
 * constructor hands back the recorder. TypeScript's ambient declaration then
 * types the result correctly and the runtime value is the recorder.
 * `scripts/nodeCanvasGlobals.ts` shims `Image` and `document` the same way.
 */
export function asDomContext(recorder: SvgRecorder): CanvasRenderingContext2D {
  const globals: CanvasGlobals = globalThis;
  globals.CanvasRenderingContext2D = function () {
    return recorder;
  };
  return new CanvasRenderingContext2D();
}

/**
 * Hands the recorder to code written against node-canvas's context type — the
 * offline art modules in `scripts/` (`carlArt`, `catArt`, `clownArt`, …).
 *
 * A real 1×1 node-canvas context supplies the type; the proxy means not one of
 * its calls ever reaches it.
 */
export function asNodeCanvasContext(recorder: SvgRecorder): NodeCanvasContext {
  const typeCarrier = createCanvas(1, 1).getContext('2d');
  return new Proxy(typeCarrier, {
    get: (_target, property) => {
      const value: unknown = Reflect.get(recorder, property);
      return typeof value === 'function' ? value.bind(recorder) : value;
    },
    set: (_target, property, value) => Reflect.set(recorder, property, value),
  });
}
