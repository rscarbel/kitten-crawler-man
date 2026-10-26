/**
 * The Wheel of Fortune's face as the wheel screen shows it: every wedge in its
 * tone with its short label, the pegs on the wedge boundaries, the gilded rim
 * and the hub. Painted once per board into an offscreen canvas and rotated,
 * because the wheel turns every frame and a board only changes when the bet
 * does. The rim bulbs are not part of the face: they chase and die on their
 * own clock, so the screen paints them live over it.
 *
 * Angles here are canvas angles (clockwise from +x). A wheel-frame angle `a`
 * from `wheelGeometry` sits at canvas angle `a - π/2` on an unturned face, so
 * wedge 0's leading edge starts under the pointer at the top.
 */

import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../core/rendering/canvasSurface';
import { onCanvasRecovery } from '../../core/rendering/canvasRecovery';
import type { WheelBoard, WheelWedge } from '../../systems/casino/wheel/wheelBoard';
import { wedgeEndAngle, wedgeStartAngle } from '../../systems/casino/wheel/wheelGeometry';
import { MARKER_FONT_STACK, UI_FONT_STACK } from '../../ui/theme/fonts';
import { measureWorldText, worldText } from '../../ui/world/worldText';
import { WHEEL_GOLD, WHEEL_TAPE, WHEEL_TONE_INK } from './wheelPalette';

/** Every radius on the face as a share of the rim's outer edge. */
export const WHEEL_FACE_RADII = {
  rimOuter: 1,
  rimInner: 0.885,
  bulbs: 0.943,
  pegs: 0.86,
  labelOuter: 0.83,
  labelInner: 0.25,
  hub: 0.17,
} as const;

const QUARTER_TURN = Math.PI / 2;
const FULL_TURN = Math.PI * 2;
const HALF = 0.5;

/** Label type, as shares of the rim's radius unless noted. */
const WEDGE_LABEL = {
  /** A wedge narrower than this across its middle keeps a two-word label on one line. */
  minTwoLineWidth: 0.11,
  maxSize: 0.075,
  /** The type fills this share of the wedge's width, split between its lines. */
  fillAcross: 0.8,
  /** Line spacing, as a share of the type size. */
  lineSpacing: 1.08,
} as const;

/** Rim, spoke and hub keylines, as shares of the rim's radius. */
const KEYLINES = { rim: 0.008, spoke: 0.007, hub: 0.01, minPx: 1 } as const;

/** Peg proportions; everything after `size` is a share of the peg's radius. */
const PEG = {
  size: 0.022,
  minSizePx: 1.5,
  shadowRight: 0.25,
  shadowDown: 0.3,
  highlightOffset: 0.35,
  highlightCore: 0.1,
} as const;

/** The hub cap's highlight and stamped star, as shares of the hub's radius. */
const HUB = {
  highlightOffset: 0.3,
  highlightCore: 0.1,
  starPoints: 5,
  starOuter: 0.62,
  /** The star's inner points, as a share of its outer radius. */
  starInner: 0.45,
} as const;

/**
 * The tape over a taped wedge: two strips slapped across the old label where
 * the wedge is wide enough to show them, then one broad strip laid down its
 * middle for the new label to be written on. Positions, lengths and widths are
 * shares of the rim's radius, measured along the wedge from the hub; tilts are
 * radians off the wedge's middle line.
 */
const TAPE_STRIPS = {
  outerCross: { along: 0.72, tilt: 1.05, length: 0.52, width: 0.1 },
  innerCross: { along: 0.4, tilt: -1.15, length: 0.34, width: 0.085 },
  /** Tape laid by hand is never quite straight. */
  label: { along: 0.55, tilt: -0.025, length: 0.6, width: 0.17 },
} as const;

const TAPE = {
  alpha: 0.86,
  /** The darker band along each long edge, as a share of the strip's width. */
  edgeBand: 0.14,
  /** How many teeth a torn end has, and how deep they bite, as a share of the strip's width. */
  tornTeeth: 5,
  tornDepth: 0.16,
  sheenAlpha: 0.5,
} as const;

/** The marker lettering on the tape, as shares of the rim's radius unless noted. */
const MARKER = {
  maxSize: 0.12,
  /** The writing fills this share of the tape's length. */
  fillAlong: 0.86,
  /** A hand never writes level: the whole line leans this far, in radians. */
  lean: -0.05,
  /** Each letter turns up to this far either way, in radians. */
  letterTurn: 0.12,
  /** Each letter rides up to this share of its size off the line. */
  letterLift: 0.08,
  /** Letters crowd together a little, as a share of the type size. */
  squeeze: 0.04,
} as const;

/** The classic shader hash's two constants: any pair that scatters well would do. */
const WOBBLE_FREQUENCY = 12.9898;
const WOBBLE_SCALE = 43758.5453;

/** A repeatable wobble in [-1, 1] for letter `index`, so the cached face never shimmers. */
function letterWobble(index: number, salt: number): number {
  const raw = Math.sin((index + 1) * (salt + 1) * WOBBLE_FREQUENCY) * WOBBLE_SCALE;
  return (raw - Math.floor(raw)) * 2 - 1;
}

/** The canvas angle on an unturned face of a wheel-frame angle. */
export function faceCanvasAngle(wheelAngle: number): number {
  return wheelAngle - QUARTER_TURN;
}

/**
 * One wedge, in its tone and with its label, between canvas angles `a0` and
 * `a1` around the origin, out to `radius` (the rim's outer edge). Used for the
 * cached face and, live, for a wedge turning over while the bet changes.
 */
export function paintWheelWedge(
  ctx: CanvasRenderingContext2D,
  wedge: WheelWedge,
  a0: number,
  a1: number,
  radius: number,
): void {
  const covered = wedge.tapedOver;
  if (covered !== undefined) {
    paintWheelWedge(ctx, covered, a0, a1, radius);
    paintTapedLabel(ctx, wedge.label, a0, a1, radius);
    return;
  }
  const ink = WHEEL_TONE_INK[wedge.tone];
  const faceR = radius * WHEEL_FACE_RADII.rimInner;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, faceR, a0, a1);
  ctx.closePath();
  const shade = ctx.createRadialGradient(0, 0, radius * WHEEL_FACE_RADII.hub, 0, 0, faceR);
  shade.addColorStop(0, ink.dark);
  shade.addColorStop(0.35, ink.base);
  shade.addColorStop(0.8, ink.base);
  shade.addColorStop(1, ink.light);
  ctx.fillStyle = shade;
  ctx.fill();
  ctx.restore();
  // A flagged wedge is too narrow for type that reads; the wheel screen flies its flag instead.
  if (wedge.flagLabel === null) paintWedgeLabel(ctx, wedge, a0, a1, radius);
}

function paintWedgeLabel(
  ctx: CanvasRenderingContext2D,
  wedge: WheelWedge,
  a0: number,
  a1: number,
  radius: number,
): void {
  const span = a1 - a0;
  const outer = radius * WHEEL_FACE_RADII.labelOuter;
  const inner = radius * WHEEL_FACE_RADII.labelInner;
  const along = outer - inner;
  // The tangential room at the label's middle decides how tall the type may be.
  const midR = (outer + inner) / 2;
  const across = span * midR;
  const words = wedge.shortLabel.split(' ');
  const twoLines = words.length > 1 && across > radius * WEDGE_LABEL.minTwoLineWidth;
  const lines = twoLines ? splitInTwo(words) : [wedge.shortLabel];
  let size = Math.min(
    radius * WEDGE_LABEL.maxSize,
    (across * WEDGE_LABEL.fillAcross) / lines.length,
  );
  const family = UI_FONT_STACK;
  const widest = (s: number): number =>
    Math.max(
      ...lines.map((line) => measureWorldText(ctx, line, { size: s, bold: true, family }).width),
    );
  const measured = widest(size);
  if (measured > along) size *= along / measured;
  const lineGap = size * WEDGE_LABEL.lineSpacing;
  const ink = WHEEL_TONE_INK[wedge.tone];
  ctx.save();
  ctx.rotate((a0 + a1) / 2);
  lines.forEach((line, index) => {
    const offset = (index - (lines.length - 1) / 2) * lineGap;
    worldText(ctx, line, {
      x: outer,
      y: offset,
      size,
      bold: true,
      family,
      color: ink.label,
      align: 'right',
      baseline: 'middle',
    });
  });
  ctx.restore();
}

/**
 * Strips of masking tape across a wedge's old label and `label` written over
 * them by hand in marker, clipped to the wedge's face.
 */
function paintTapedLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  a0: number,
  a1: number,
  radius: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius * WHEEL_FACE_RADII.rimInner, a0, a1);
  ctx.closePath();
  ctx.clip();
  ctx.rotate((a0 + a1) / 2);
  for (const strip of [TAPE_STRIPS.outerCross, TAPE_STRIPS.innerCross, TAPE_STRIPS.label]) {
    paintTapeStrip(
      ctx,
      radius * strip.along,
      strip.tilt,
      radius * strip.length,
      radius * strip.width,
    );
  }
  const labelStrip = TAPE_STRIPS.label;
  ctx.rotate(labelStrip.tilt);
  paintMarkerLine(
    ctx,
    label,
    radius * labelStrip.along,
    radius * labelStrip.length * MARKER.fillAlong,
    radius,
  );
  ctx.restore();
}

/** One strip of tape, centred `along` the wedge's middle line and turned `tilt` off it. */
function paintTapeStrip(
  ctx: CanvasRenderingContext2D,
  along: number,
  tilt: number,
  length: number,
  width: number,
): void {
  const halfL = length / 2;
  const halfW = width / 2;
  const toothDepth = width * TAPE.tornDepth;
  ctx.save();
  ctx.translate(along, 0);
  ctx.rotate(tilt);
  ctx.globalAlpha = TAPE.alpha;
  ctx.beginPath();
  ctx.moveTo(-halfL, -halfW);
  ctx.lineTo(halfL, -halfW);
  tornEnd(ctx, halfL, -halfW, toothDepth, 1);
  ctx.lineTo(-halfL, halfW);
  tornEnd(ctx, -halfL, halfW, toothDepth, -1);
  ctx.closePath();
  const band = ctx.createLinearGradient(0, -halfW, 0, halfW);
  band.addColorStop(0, WHEEL_TAPE.edge);
  band.addColorStop(TAPE.edgeBand, WHEEL_TAPE.face);
  band.addColorStop(1 - TAPE.edgeBand, WHEEL_TAPE.face);
  band.addColorStop(1, WHEEL_TAPE.edge);
  ctx.fillStyle = band;
  ctx.fill();
  ctx.globalAlpha = TAPE.alpha * TAPE.sheenAlpha;
  ctx.fillStyle = WHEEL_TAPE.sheen;
  ctx.fillRect(
    -halfL + toothDepth,
    -halfW * TAPE.edgeBand,
    length - toothDepth * 2,
    halfW * TAPE.edgeBand,
  );
  ctx.restore();
}

/**
 * A torn end from the corner at (`x`, `fromY`) across to the other edge:
 * teeth of alternating depth, biting inward (`inward` is +1 at the right end, -1 at the left).
 */
function tornEnd(
  ctx: CanvasRenderingContext2D,
  x: number,
  fromY: number,
  depth: number,
  inward: number,
): void {
  const teeth = TAPE.tornTeeth;
  const step = (-2 * fromY) / teeth;
  for (let tooth = 1; tooth <= teeth; tooth++) {
    const bite = tooth % 2 === 0 ? 0 : depth * (1 + letterWobble(tooth, inward) * HALF);
    ctx.lineTo(x - inward * bite, fromY + step * tooth);
  }
}

/** `text` written by hand down the wedge's middle line, centred at `centre`, no longer than `span`. */
function paintMarkerLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  centre: number,
  span: number,
  radius: number,
): void {
  const family = MARKER_FONT_STACK;
  const letters = Array.from(text);
  const natural = radius * MARKER.maxSize;
  const widthAt = (size: number): number =>
    letters.reduce(
      (sum, letter) =>
        sum +
        measureWorldText(ctx, letter, { size, bold: true, family }).width -
        size * MARKER.squeeze,
      0,
    );
  const fullWidth = widthAt(natural);
  const size = fullWidth > span ? natural * (span / fullWidth) : natural;
  const lineWidth = widthAt(size);
  ctx.save();
  ctx.translate(centre, 0);
  ctx.rotate(MARKER.lean);
  let x = -lineWidth / 2;
  letters.forEach((letter, index) => {
    const advance = measureWorldText(ctx, letter, { size, bold: true, family }).width;
    ctx.save();
    ctx.translate(x + advance / 2, letterWobble(index, 1) * size * MARKER.letterLift);
    ctx.rotate(letterWobble(index, 2) * MARKER.letterTurn);
    worldText(ctx, letter, {
      x: 0,
      y: 0,
      size,
      bold: true,
      family,
      color: WHEEL_TAPE.marker,
      align: 'center',
      baseline: 'middle',
    });
    ctx.restore();
    x += advance - size * MARKER.squeeze;
  });
  ctx.restore();
}

/** Splits a label into two lines as evenly as its words allow. */
function splitInTwo(words: readonly string[]): string[] {
  let best = 1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let cut = 1; cut < words.length; cut++) {
    const left = words.slice(0, cut).join(' ').length;
    const right = words.slice(cut).join(' ').length;
    const diff = Math.abs(left - right);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = cut;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

function paintRim(ctx: CanvasRenderingContext2D, radius: number): void {
  const inner = radius * WHEEL_FACE_RADII.rimInner;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, FULL_TURN);
  ctx.arc(0, 0, inner, 0, FULL_TURN, true);
  const gild = ctx.createRadialGradient(0, 0, inner, 0, 0, radius);
  gild.addColorStop(0, WHEEL_GOLD.dark);
  gild.addColorStop(0.3, WHEEL_GOLD.light);
  gild.addColorStop(0.6, WHEEL_GOLD.base);
  gild.addColorStop(1, WHEEL_GOLD.deep);
  ctx.fillStyle = gild;
  ctx.fill('evenodd');
  ctx.lineWidth = Math.max(KEYLINES.minPx, radius * KEYLINES.rim);
  ctx.strokeStyle = WHEEL_GOLD.deep;
  ctx.beginPath();
  ctx.arc(0, 0, inner, 0, FULL_TURN);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius - ctx.lineWidth / 2, 0, FULL_TURN);
  ctx.stroke();
  ctx.restore();
}

function paintSpokesAndPegs(
  ctx: CanvasRenderingContext2D,
  board: WheelBoard,
  radius: number,
): void {
  const inner = radius * WHEEL_FACE_RADII.hub;
  const outer = radius * WHEEL_FACE_RADII.rimInner;
  const pegR = radius * WHEEL_FACE_RADII.pegs;
  const pegSize = Math.max(PEG.minSizePx, radius * PEG.size);
  ctx.save();
  ctx.strokeStyle = WHEEL_GOLD.base;
  ctx.lineWidth = Math.max(KEYLINES.minPx, radius * KEYLINES.spoke);
  board.forEach((_, index) => {
    const angle = faceCanvasAngle(wedgeStartAngle(board, index));
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    ctx.stroke();
  });
  board.forEach((_, index) => {
    const angle = faceCanvasAngle(wedgeStartAngle(board, index));
    const x = Math.cos(angle) * pegR;
    const y = Math.sin(angle) * pegR;
    ctx.fillStyle = WHEEL_GOLD.deep;
    ctx.beginPath();
    ctx.arc(x + pegSize * PEG.shadowRight, y + pegSize * PEG.shadowDown, pegSize, 0, FULL_TURN);
    ctx.fill();
    const head = ctx.createRadialGradient(
      x - pegSize * PEG.highlightOffset,
      y - pegSize * PEG.highlightOffset,
      pegSize * PEG.highlightCore,
      x,
      y,
      pegSize,
    );
    head.addColorStop(0, WHEEL_GOLD.glint);
    head.addColorStop(0.5, WHEEL_GOLD.light);
    head.addColorStop(1, WHEEL_GOLD.dark);
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.arc(x, y, pegSize, 0, FULL_TURN);
    ctx.fill();
  });
  ctx.restore();
}

function paintHub(ctx: CanvasRenderingContext2D, radius: number): void {
  const hubR = radius * WHEEL_FACE_RADII.hub;
  ctx.save();
  const cap = ctx.createRadialGradient(
    -hubR * HUB.highlightOffset,
    -hubR * HUB.highlightOffset,
    hubR * HUB.highlightCore,
    0,
    0,
    hubR,
  );
  cap.addColorStop(0, WHEEL_GOLD.glint);
  cap.addColorStop(0.45, WHEEL_GOLD.base);
  cap.addColorStop(1, WHEEL_GOLD.deep);
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.arc(0, 0, hubR, 0, FULL_TURN);
  ctx.fill();
  ctx.strokeStyle = WHEEL_GOLD.deep;
  ctx.lineWidth = Math.max(KEYLINES.minPx, radius * KEYLINES.hub);
  ctx.stroke();
  // A five-pointed star stamped in the cap: the Desperado's sheriff star.
  const points = HUB.starPoints;
  const outer = hubR * HUB.starOuter;
  const inner = outer * HUB.starInner;
  ctx.fillStyle = WHEEL_GOLD.dark;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = -QUARTER_TURN + (i * Math.PI) / points;
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Paints a whole unturned face centred on the origin, rim edge at `radius`. */
export function paintWheelFace(
  ctx: CanvasRenderingContext2D,
  board: WheelBoard,
  radius: number,
): void {
  board.forEach((wedge, index) => {
    paintWheelWedge(
      ctx,
      wedge,
      faceCanvasAngle(wedgeStartAngle(board, index)),
      faceCanvasAngle(wedgeEndAngle(board, index)),
      radius,
    );
  });
  paintSpokesAndPegs(ctx, board, radius);
  paintRim(ctx, radius);
  paintHub(ctx, radius);
}

/** Faces kept at once: one per board a bet ladder visits is plenty. */
const MAX_CACHED_FACES = 8;
/** Face pixels are capped so a huge display never allocates a giant canvas. */
const MAX_FACE_PX = 2048;
const faceCache = new Map<string, CanvasSurface | null>();
// A purged canvas would stay blank for good, so recovery repaints every face.
onCanvasRecovery(releaseFaces);

/** Every face is drawn the moment it is fetched and never held, so dropping one may free it. */
function releaseFaces(): void {
  for (const face of faceCache.values()) {
    if (face !== null) releaseSurface(face);
  }
  faceCache.clear();
}

function boardKey(board: WheelBoard): string {
  return board.map((wedge) => wedge.id).join('|');
}

/**
 * The face for `board` painted `pixels` across, cached; `null` when the
 * browser refused a canvas, and the caller paints the face directly.
 */
export function cachedWheelFace(board: WheelBoard, pixels: number): CanvasSurface | null {
  const size = Math.max(1, Math.min(MAX_FACE_PX, Math.round(pixels)));
  const key = `${boardKey(board)}@${size}`;
  const cached = faceCache.get(key);
  if (cached !== undefined) return cached;
  if (faceCache.size >= MAX_CACHED_FACES) releaseFaces();
  let face: CanvasSurface | null = null;
  try {
    face = allocCanvas('casino', size, size);
    const ctx = surfaceContext(face);
    ctx.translate(size / 2, size / 2);
    paintWheelFace(ctx, board, size / 2);
  } catch {
    if (face !== null) releaseSurface(face);
    face = null;
  }
  faceCache.set(key, face);
  return face;
}
