/**
 * The keyboard-hero board's art gates.
 *
 * The mini-game's art is six kinds of painted piece that only mean anything
 * together: the console frame is a window that the four lane beds have to land
 * inside, a keycap is only readable against the bed it falls down, and a piece
 * that paints identical to its neighbour is a press the player never sees
 * register. None of that is visible in any single piece, so every gate here
 * measures pixels the game's own painter produced, positioned by the same
 * `computeKeyboardHeroLayout` the runtime positions them with.
 *
 * The art used to ship as five baked PNGs and these gates used to decode them.
 * It is painted at runtime now, so a cell here is produced by running the
 * painter through `nodeGameContext` at the same supersampled size the runtime
 * paints it at. One gate went with the bake: K4 checked that the manifest's
 * frame sizes divided the sheets they described, and there is no longer a
 * manifest, a sheet or a frame grid for it to disagree about. The other gate IDs
 * keep their numbers so a failure means the same thing it used to.
 *
 * Failures accumulate rather than throwing one at a time, and a gate that cannot
 * find the piece it was going to measure fails loudly instead of skipping — a
 * lookup that quietly returns nothing turns the whole module green while
 * measuring nothing at all.
 *
 * Run by the review harness: `npm run render:keyboard-hero`.
 */

import { nothingMeasuredFailures } from './figureGates.js';
import { gameContext } from './nodeGameContext.js';
import { HIT_ZONE_IMG_CENTER } from '../src/systems/keyboardHeroGeometry.js';
import {
  BOARD_BAKE_SCALE,
  BOARD_IMG_H,
  BOARD_IMG_W,
  LANE_BED_IMG_H,
  LANE_BED_IMG_W,
  LANE_DOWN,
  LANE_INDICES,
  LANE_LEFT,
  LANE_RIGHT,
  LANE_UP,
  LANE_PALETTES,
  NOTE_IMG_SIZE,
  RECEPTOR_IMG_SIZE,
  TOUCH_IMG_SIZE,
  computeKeyboardHeroLayout,
  type KeyboardHeroLayout,
  type LaneIndex,
  type Rect,
} from '../src/systems/keyboardHeroLayout.js';
import {
  paintBoardFrame,
  paintLaneBed,
  paintLaneHighlight,
  paintNoteKeycap,
  paintReceptor,
  paintTouchButton,
  type NoteState,
  type ReceptorState,
  type TouchState,
} from '../src/sprites/art/keyboardHeroArt.js';

export const NOTE_STATES: readonly NoteState[] = ['normal', 'hit', 'missed'];
export const RECEPTOR_STATES: readonly ReceptorState[] = ['idle', 'pressed', 'flash'];
export const TOUCH_STATES: readonly TouchState[] = ['idle', 'pressed'];

export const BOARD_FRAME_PIECE = 'frame';
export const LANE_HIGHLIGHT_PIECE = 'highlight';

export function laneBedPiece(lane: LaneIndex): string {
  return `lane_${lane}`;
}

export function notePiece(state: NoteState, lane: LaneIndex): string {
  return `note_${state}_${lane}`;
}

export function receptorPiece(state: ReceptorState, lane: LaneIndex): string {
  return `receptor_${state}_${lane}`;
}

export function touchPiece(state: TouchState, lane: LaneIndex): string {
  return `touch_${state}_${lane}`;
}

const RGBA_STRIDE = 4;
const RED_OFFSET = 0;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;
const MAX_CHANNEL = 255;

/** Alpha at or above which a pixel counts as part of the keycap's solid body. */
const OPAQUE_ALPHA = 200;

/**
 * The viewport the gates position the board at. Any viewport would do — the
 * layout is a pure scale of one design space — but a fixed one keeps every
 * reported number comparable between runs.
 */
const GATE_VIEWPORT_W = 1280;
const GATE_VIEWPORT_H = 720;

// ── Painting the pieces ─────────────────────────────────────────────────────

/** One painted piece, at the supersampled size the runtime paints it at. */
interface Cell {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface KeyboardHeroArt {
  readonly cells: ReadonlyMap<string, Cell>;
}

/**
 * Clips to the piece's own rect before painting, exactly as the runtime cache
 * does, so a painter that overshoots its budget shows up as a clipped edge on
 * its own piece — which is the state K7 is written to catch.
 */
function paintCell(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): Cell {
  const w = width * BOARD_BAKE_SCALE;
  const h = height * BOARD_BAKE_SCALE;
  const ctx = gameContext(w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  paint(ctx, w, h);
  ctx.restore();
  return { pixels: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
}

/**
 * Every piece the board can ask for, painted once, under the same names the
 * runtime cache keys them by. Built by walking the painter's own state unions
 * rather than a restated list, so a state added to the painter and forgotten
 * here is a compile error rather than a piece nothing ever measures.
 */
export function paintKeyboardHeroArt(): KeyboardHeroArt {
  const cells = new Map<string, Cell>();
  cells.set(
    BOARD_FRAME_PIECE,
    paintCell(BOARD_IMG_W, BOARD_IMG_H, (ctx, w, h) => paintBoardFrame(ctx, w, h)),
  );
  cells.set(
    LANE_HIGHLIGHT_PIECE,
    paintCell(LANE_BED_IMG_W, LANE_BED_IMG_H, (ctx, w, h) => paintLaneHighlight(ctx, w, h)),
  );
  for (const lane of LANE_INDICES) {
    const palette = LANE_PALETTES[lane];
    cells.set(
      laneBedPiece(lane),
      paintCell(LANE_BED_IMG_W, LANE_BED_IMG_H, (ctx, w, h) => paintLaneBed(ctx, w, h, palette)),
    );
    for (const state of NOTE_STATES) {
      cells.set(
        notePiece(state, lane),
        paintCell(NOTE_IMG_SIZE, NOTE_IMG_SIZE, (ctx, w) =>
          paintNoteKeycap(ctx, w, palette, state),
        ),
      );
    }
    for (const state of RECEPTOR_STATES) {
      cells.set(
        receptorPiece(state, lane),
        paintCell(RECEPTOR_IMG_SIZE, RECEPTOR_IMG_SIZE, (ctx, w) =>
          paintReceptor(ctx, w, palette, state),
        ),
      );
    }
    for (const state of TOUCH_STATES) {
      cells.set(
        touchPiece(state, lane),
        paintCell(TOUCH_IMG_SIZE, TOUCH_IMG_SIZE, (ctx, w) =>
          paintTouchButton(ctx, w, palette, state),
        ),
      );
    }
  }
  return { cells };
}

// ── Pixel access ────────────────────────────────────────────────────────────

function channelToLinear(channel: number): number {
  const normalized = channel / MAX_CHANNEL;
  const LOW_SLOPE_CUTOFF = 0.03928;
  const LOW_SLOPE = 12.92;
  const OFFSET = 0.055;
  const GAMMA = 2.4;
  if (normalized <= LOW_SLOPE_CUTOFF) return normalized / LOW_SLOPE;
  return Math.pow((normalized + OFFSET) / (1 + OFFSET), GAMMA);
}

const RED_WEIGHT = 0.2126;
const GREEN_WEIGHT = 0.7152;
const BLUE_WEIGHT = 0.0722;

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luminance(r: number, g: number, b: number): number {
  return (
    RED_WEIGHT * channelToLinear(r) +
    GREEN_WEIGHT * channelToLinear(g) +
    BLUE_WEIGHT * channelToLinear(b)
  );
}

function luminanceAt(cell: Cell, x: number, y: number): number {
  const i = (y * cell.width + x) * RGBA_STRIDE;
  return luminance(
    cell.pixels[i + RED_OFFSET],
    cell.pixels[i + GREEN_OFFSET],
    cell.pixels[i + BLUE_OFFSET],
  );
}

function alphaAt(cell: Cell, x: number, y: number): number {
  return cell.pixels[(y * cell.width + x) * RGBA_STRIDE + ALPHA_OFFSET];
}

/** The WCAG contrast ratio between two relative luminances, order-independent. */
const CONTRAST_FLARE = 0.05;
function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + CONTRAST_FLARE) / (Math.min(a, b) + CONTRAST_FLARE);
}

// ── Failure plumbing ────────────────────────────────────────────────────────

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

/**
 * Every measurement below goes through this. A gate that cannot find the piece
 * it was going to measure reports that as its failure and measures nothing
 * further, rather than skipping the row and reporting the family clean.
 */
function lookup(gateId: string, art: KeyboardHeroArt, piece: string): Cell | null {
  const cell = art.cells.get(piece);
  if (cell === undefined) {
    fail(gateId, `nothing paints "${piece}", so nothing about it was measured`);
    return null;
  }
  return cell;
}

// ── K1 lane alignment and lane-bed visibility ───────────────────────────────

/**
 * Relative luminance at or below which a frame pixel is the console's near-black
 * lane well. The rails, the bezel strips and the well's own dividers all sit an
 * order of magnitude above it — the well measures 0.0006 to 0.0015 while the
 * dividers between lanes measure 0.006 and the rail hardware 0.05 and up — so
 * the line has plenty of room either side.
 */
const WELL_MAX_LUMINANCE = 0.003;

/**
 * Board-space slack at a lane rect's edges, covering the well's own inner bevel.
 * The frame paints a light bevel along the well's bottom and right edges that is
 * `WELL_BEVEL_FRACTION` of the board deep — about five board pixels — and a lane
 * rect legitimately runs under it.
 */
const WELL_BEVEL_TOLERANCE_IMG = 6;

/**
 * How much the lane beds must change the board's picture at the hit line, as a
 * mean absolute difference in relative luminance over the lane rect.
 *
 * The point of baking the frame and the beds as separate layers is that the beds
 * are seen: they carry the per-lane hue that tells a player which key a falling
 * note belongs to. Composited in the order the runtime composites them, a bed
 * that changes nothing is a bed nobody can see. The shipped art measures about
 * 0.27, so the floor sits far below it and only catches a genuinely lost layer.
 */
const MIN_BED_VISIBILITY = 0.05;

/** Board space → baked-sheet space is a fixed multiple; the layout supplies the rest. */
function boardToSheetX(layout: KeyboardHeroLayout, screenX: number): number {
  return ((screenX - layout.board.x) / layout.scale) * BOARD_BAKE_SCALE;
}

function boardToSheetY(layout: KeyboardHeroLayout, screenY: number): number {
  return ((screenY - layout.board.y) / layout.scale) * BOARD_BAKE_SCALE;
}

/** The mean relative luminance of a rect of a cell. */
function meanLuminance(cell: Cell, rect: Rect): number {
  let total = 0;
  let counted = 0;
  const right = Math.min(cell.width, Math.round(rect.x + rect.width));
  const bottom = Math.min(cell.height, Math.round(rect.y + rect.height));
  for (let y = Math.max(0, Math.round(rect.y)); y < bottom; y++) {
    for (let x = Math.max(0, Math.round(rect.x)); x < right; x++) {
      total += luminanceAt(cell, x, y);
      counted++;
    }
  }
  return counted === 0 ? 0 : total / counted;
}

/** The brightest pixel in a rect of a cell, as relative luminance. */
function peakLuminance(cell: Cell, rect: Rect): number {
  let peak = 0;
  const right = Math.min(cell.width, Math.round(rect.x + rect.width));
  const bottom = Math.min(cell.height, Math.round(rect.y + rect.height));
  for (let y = Math.max(0, Math.round(rect.y)); y < bottom; y++) {
    for (let x = Math.max(0, Math.round(rect.x)); x < right; x++) {
      peak = Math.max(peak, luminanceAt(cell, x, y));
    }
  }
  return peak;
}

/** The lane's rect in baked-frame pixels, shrunk by the well's own bevel. */
function laneRectInSheet(layout: KeyboardHeroLayout, lane: LaneIndex): Rect {
  const rect = layout.lanes[lane];
  const inset = WELL_BEVEL_TOLERANCE_IMG * BOARD_BAKE_SCALE;
  return {
    x: boardToSheetX(layout, rect.x) + inset,
    y: boardToSheetY(layout, rect.y) + inset,
    width: (rect.width / layout.scale) * BOARD_BAKE_SCALE - inset * 2,
    height: (rect.height / layout.scale) * BOARD_BAKE_SCALE - inset * 2,
  };
}

function gateLaneAlignment(art: KeyboardHeroArt, layout: KeyboardHeroLayout): void {
  const frame = lookup('K1', art, BOARD_FRAME_PIECE);
  if (frame === null) return;

  if (
    frame.width !== BOARD_IMG_W * BOARD_BAKE_SCALE ||
    frame.height !== BOARD_IMG_H * BOARD_BAKE_SCALE
  ) {
    fail(
      'K1',
      `the frame paints ${frame.width}x${frame.height} but board space is ` +
        `${BOARD_IMG_W}x${BOARD_IMG_H} at ${BOARD_BAKE_SCALE}x — every lane rect below would ` +
        'be positioned against art of the wrong size',
    );
    return;
  }

  let lanesMeasured = 0;
  for (const lane of LANE_INDICES) {
    const bed = lookup('K1', art, laneBedPiece(lane));
    if (bed === null) continue;
    lanesMeasured++;

    const sheetRect = laneRectInSheet(layout, lane);
    const peak = peakLuminance(frame, sheetRect);
    console.log(
      `  K1 ${LANE_PALETTES[lane].name}: the frame under the lane rect peaks at ` +
        `${peak.toFixed(5)} luminance (well ceiling ${WELL_MAX_LUMINANCE})`,
    );
    if (peak > WELL_MAX_LUMINANCE) {
      fail(
        'K1',
        `lane ${lane} (${LANE_PALETTES[lane].name}) covers frame pixels as bright as ` +
          `${peak.toFixed(5)}, above the ${WELL_MAX_LUMINANCE} the near-black lane well sits ` +
          'at — the lane rect has slid off the well onto a rail, a divider or a bezel strip',
      );
    }

    for (const failure of bedVisibilityFailures(frame, bed, layout, lane)) fail('K1', failure);
  }
  failUnlessMeasured('K1', lanesMeasured, 'lanes for alignment');
}

/**
 * Composites the lane bed and the frame in the order `KeyboardHeroSystem.render`
 * composites them — housing down first, beds into its well — and asks whether the
 * bed actually changed the picture. A bed baked black, or baked transparent, is a
 * bed nobody can see even though every other gate here would still pass it.
 */
function bedVisibilityFailures(
  frame: Cell,
  bed: Cell,
  layout: KeyboardHeroLayout,
  lane: LaneIndex,
): string[] {
  const laneRect = layout.lanes[lane];
  const sheetX = Math.round(boardToSheetX(layout, laneRect.x));
  const sheetW = Math.round((laneRect.width / layout.scale) * BOARD_BAKE_SCALE);
  const hitSheetY = Math.round(boardToSheetY(layout, layout.hitLineY));
  const bandTop = Math.round(hitSheetY - (NOTE_IMG_SIZE * BOARD_BAKE_SCALE) / 2);
  const bandH = NOTE_IMG_SIZE * BOARD_BAKE_SCALE;

  // The bed cell's own vertical origin is the top of the lane area, so the hit
  // line sits at the frozen note-space depth rather than at the band's screen Y.
  const bedHitY = Math.round(HIT_ZONE_IMG_CENTER * BOARD_BAKE_SCALE);
  const bedTop = bedHitY - bandH / 2;

  let delta = 0;
  let counted = 0;
  for (let row = 0; row < bandH; row++) {
    const frameY = bandTop + row;
    const bedY = bedTop + row;
    if (frameY < 0 || frameY >= frame.height || bedY < 0 || bedY >= bed.height) continue;
    for (let column = 0; column < sheetW; column++) {
      const frameX = sheetX + column;
      const bedX = Math.round((column / sheetW) * bed.width);
      if (frameX < 0 || frameX >= frame.width || bedX >= bed.width) continue;
      const frameAlpha = alphaAt(frame, frameX, frameY) / MAX_CHANNEL;
      const frameIndex = (frameY * frame.width + frameX) * RGBA_STRIDE;
      const bedIndex = (bedY * bed.width + bedX) * RGBA_STRIDE;
      const channels: number[] = [];
      const frameOverBlack: number[] = [];
      for (const channel of [RED_OFFSET, GREEN_OFFSET, BLUE_OFFSET]) {
        const frameChannel = frame.pixels[frameIndex + channel] * frameAlpha;
        const bedAlpha = bed.pixels[bedIndex + ALPHA_OFFSET] / MAX_CHANNEL;
        const bedChannel = bed.pixels[bedIndex + channel] * bedAlpha;
        frameOverBlack.push(frameChannel);
        channels.push(bedChannel + frameChannel * (1 - bedAlpha));
      }
      delta += Math.abs(
        luminance(channels[0], channels[1], channels[2]) -
          luminance(frameOverBlack[0], frameOverBlack[1], frameOverBlack[2]),
      );
      counted++;
    }
  }
  if (counted === 0) {
    return [
      `lane ${lane}'s hit-line band mapped to no pixels of either the frame or the bed, so ` +
        'nothing about the bed being visible was measured',
    ];
  }

  const visibility = delta / counted;
  console.log(
    `  K1 ${LANE_PALETTES[lane].name}: composited in the runtime's order the bed moves the ` +
      `board by ${visibility.toFixed(4)} luminance at the hit line (floor ${MIN_BED_VISIBILITY})`,
  );
  if (visibility >= MIN_BED_VISIBILITY) return [];
  return [
    `lane ${lane} (${LANE_PALETTES[lane].name}) bed changes the board by only ` +
      `${visibility.toFixed(4)} luminance once it is composited into the frame's well, under ` +
      `the ${MIN_BED_VISIBILITY} floor — the bed layer has been lost, and with it the per-lane ` +
      'hue, the hit window band and the press and error highlights that ride on it',
  ];
}

// ── K2 keycap against the bed it falls down ─────────────────────────────────

/**
 * The contrast ratio a keycap's face must hold against the lane bed directly
 * behind it at the hit line.
 *
 * Deliberately low, and deliberately not an absolute brightness: the keycap's
 * face *is* the lane's own hue, because that colour coding is what tells a player
 * which key the note belongs to, and a face driven bright enough to clear a
 * graphics-contrast bar on its own would throw the coding away. The shipped art
 * measures 1.44 to 3.77 depending on state; the floor sits just under the worst
 * of them. What carries the rest of the separation is the rim below.
 */
const KEYCAP_FACE_MIN_CONTRAST = 1.3;

/**
 * The contrast ratio the keycap's dark outline must hold against the same bed.
 *
 * A lane-hued cap on a lane-hued bed is a smudge without one — the same trap a
 * near-black creature on a dark floor falls into — so the rim is load-bearing
 * rather than decorative and is measured as such. Read as the tenth percentile of
 * the cap's solid pixels, which is the outline plus the darkest bevel shadow.
 * Shipped art measures 2.88 to 6.40.
 */
const KEYCAP_RIM_MIN_CONTRAST = 2.5;

/** Percentile of a keycap's solid pixels taken to stand for its outline. */
const RIM_PERCENTILE = 0.1;

function gateKeycapContrast(art: KeyboardHeroArt, layout: KeyboardHeroLayout): void {
  let measured = 0;
  for (const lane of LANE_INDICES) {
    const bed = lookup('K2', art, laneBedPiece(lane));
    if (bed === null) continue;

    // The bed behind the note, at the hit line, in the bed cell's own pixels —
    // never an absolute threshold, because both cap and bed are dark and an
    // absolute metric would fail them for being dark rather than for being alike.
    const noteSheetSize = NOTE_IMG_SIZE * BOARD_BAKE_SCALE;
    const bedBehind: Rect = {
      x: (bed.width - noteSheetSize) / 2,
      y: HIT_ZONE_IMG_CENTER * BOARD_BAKE_SCALE - noteSheetSize / 2,
      width: noteSheetSize,
      height: noteSheetSize,
    };
    const bedLuminance = meanLuminance(bed, bedBehind);

    for (const state of NOTE_STATES) {
      const cap = lookup('K2', art, notePiece(state, lane));
      if (cap === null) continue;

      const solid: number[] = [];
      for (let y = 0; y < cap.height; y++) {
        for (let x = 0; x < cap.width; x++) {
          if (alphaAt(cap, x, y) < OPAQUE_ALPHA) continue;
          solid.push(luminanceAt(cap, x, y));
        }
      }
      if (solid.length === 0) {
        fail(
          'K2',
          `${notePiece(state, lane)} has no pixels solid enough to measure, so its contrast ` +
            'against the bed was never judged',
        );
        continue;
      }
      measured++;

      solid.sort((a, b) => a - b);
      const face = solid.reduce((total, value) => total + value, 0) / solid.length;
      const rim = solid[Math.floor(solid.length * RIM_PERCENTILE)];
      const faceContrast = contrastRatio(face, bedLuminance);
      const rimContrast = contrastRatio(rim, bedLuminance);
      console.log(
        `  K2 ${LANE_PALETTES[lane].name}/${state}: bed ${bedLuminance.toFixed(3)}, face ` +
          `${face.toFixed(3)} (${faceContrast.toFixed(2)}:1), rim ${rim.toFixed(3)} ` +
          `(${rimContrast.toFixed(2)}:1)`,
      );
      if (faceContrast < KEYCAP_FACE_MIN_CONTRAST) {
        fail(
          'K2',
          `${notePiece(state, lane)}'s face reads ${faceContrast.toFixed(2)}:1 against the bed ` +
            `behind it at the hit line, under the ${KEYCAP_FACE_MIN_CONTRAST}:1 floor — the ` +
            'keycap has sunk into its own lane',
        );
      }
      if (rimContrast < KEYCAP_RIM_MIN_CONTRAST) {
        fail(
          'K2',
          `${notePiece(state, lane)}'s outline reads ${rimContrast.toFixed(2)}:1 against the bed ` +
            `behind it, under the ${KEYCAP_RIM_MIN_CONTRAST}:1 floor — without a dark rim a ` +
            'lane-hued cap on a lane-hued bed has no silhouette',
        );
      }
    }
  }
  failUnlessMeasured('K2', measured, 'keycaps against their lane beds');
}

// ── K6 receptor against the bed it sits on ──────────────────────────────────

/**
 * The contrast ratio a receptor's ring must hold against the lane bed it sits on
 * at the hit line.
 *
 * The receptor is the board's only answer to "where do I press", and unlike a
 * keycap it is hollow: almost all of its solid pixels are the dim interior, so a
 * mean would be dominated by the part nobody navigates by. The ring is read as
 * the ninetieth percentile instead — the lit outline itself.
 *
 * Measured against the bed rather than an absolute brightness for the same reason
 * K2 is: the ring carries the lane's hue on purpose, and a ring driven bright
 * enough to clear an absolute bar would stop being lane-coloured. The `idle`
 * state is the one that matters — `pressed` and `flash` are only ever seen for a
 * few frames, while `idle` is what a player reads for the whole run.
 */
const RECEPTOR_RING_MIN_CONTRAST = 1.6;

/** Percentile of a receptor's solid pixels taken to stand for its lit ring. */
const RING_PERCENTILE = 0.9;

function gateReceptorContrast(art: KeyboardHeroArt): void {
  let measured = 0;
  for (const lane of LANE_INDICES) {
    const bed = lookup('K6', art, laneBedPiece(lane));
    if (bed === null) continue;

    const receptorSheetSize = RECEPTOR_IMG_SIZE * BOARD_BAKE_SCALE;
    const bedBehind: Rect = {
      x: (bed.width - receptorSheetSize) / 2,
      y: HIT_ZONE_IMG_CENTER * BOARD_BAKE_SCALE - receptorSheetSize / 2,
      width: receptorSheetSize,
      height: receptorSheetSize,
    };
    const bedLuminance = meanLuminance(bed, bedBehind);

    for (const state of RECEPTOR_STATES) {
      const ring = lookup('K6', art, receptorPiece(state, lane));
      if (ring === null) continue;

      const solid: number[] = [];
      for (let y = 0; y < ring.height; y++) {
        for (let x = 0; x < ring.width; x++) {
          if (alphaAt(ring, x, y) < OPAQUE_ALPHA) continue;
          solid.push(luminanceAt(ring, x, y));
        }
      }
      if (solid.length === 0) {
        fail(
          'K6',
          `${receptorPiece(state, lane)} has no pixels solid enough to measure, so whether the ` +
            'player can see where to press was never judged',
        );
        continue;
      }
      measured++;

      solid.sort((a, b) => a - b);
      const ringLuminance = solid[Math.floor((solid.length - 1) * RING_PERCENTILE)];
      const ringContrast = contrastRatio(ringLuminance, bedLuminance);
      console.log(
        `  K6 ${LANE_PALETTES[lane].name}/${state}: bed ${bedLuminance.toFixed(3)}, ring ` +
          `${ringLuminance.toFixed(3)} (${ringContrast.toFixed(2)}:1)`,
      );
      if (ringContrast < RECEPTOR_RING_MIN_CONTRAST) {
        fail(
          'K6',
          `${receptorPiece(state, lane)}'s ring reads ${ringContrast.toFixed(2)}:1 against the ` +
            `bed it sits on, under the ${RECEPTOR_RING_MIN_CONTRAST}:1 floor — the one mark ` +
            'telling the player where to press has sunk into its own lane',
        );
      }
    }
  }
  failUnlessMeasured('K6', measured, 'receptors against their lane beds');
}

// ── K3 states that bake apart ───────────────────────────────────────────────

/**
 * Mean per-channel difference between two premultiplied cells, 0 (identical) to
 * 1 (black against white). Premultiplied so a state that differs only in alpha
 * — a glow that faded out — still registers as a difference.
 */
function stateDifference(a: Cell, b: Cell): number {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  let total = 0;
  let counted = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ia = (y * a.width + x) * RGBA_STRIDE;
      const ib = (y * b.width + x) * RGBA_STRIDE;
      const alphaA = a.pixels[ia + ALPHA_OFFSET] / MAX_CHANNEL;
      const alphaB = b.pixels[ib + ALPHA_OFFSET] / MAX_CHANNEL;
      for (const channel of [RED_OFFSET, GREEN_OFFSET, BLUE_OFFSET]) {
        total += Math.abs(a.pixels[ia + channel] * alphaA - b.pixels[ib + channel] * alphaB);
        counted++;
      }
    }
  }
  return counted === 0 ? 0 : total / (counted * MAX_CHANNEL);
}

/**
 * Three floors rather than one, because the three families are asked to say
 * different things and a single number would either be vacuous for two of them
 * or unmeetable by the third.
 *
 * A note's states are three different events — falling, caught, dropped — and the
 * shipped art keeps them 0.26 apart at worst. A receptor's states are one shape
 * at three brightnesses, so its pairs run closest together: the binding one is
 * `idle`/`pressed` at 0.17, which is what K6's demand for a legible idle ring
 * costs — lifting `idle` toward its lane's lighter shade walks it up towards
 * `pressed`. Anyone brightening `idle` further to buy K6 headroom is spending
 * this margin, so re-measure the pair rather than trusting the number here. A
 * touch button only has to say pressed or not, and measures 0.23.
 */
const NOTE_STATE_MIN_DIFFERENCE = 0.2;
const RECEPTOR_STATE_MIN_DIFFERENCE = 0.15;
const TOUCH_STATE_MIN_DIFFERENCE = 0.17;

interface FamilyState {
  readonly name: string;
  /** The piece each lane paints for this state, indexed by `LaneIndex`. */
  readonly pieceByLane: readonly [string, string, string, string];
}

interface StateFamily {
  readonly prefix: string;
  readonly states: readonly FamilyState[];
  readonly minDifference: number;
}

/**
 * Resolves a family's piece names once, which is what lets the gates below index
 * a lane without a lookup that could come back empty and quietly measure nothing.
 */
function familyStates<TState extends string>(
  states: readonly TState[],
  piece: (state: TState, lane: LaneIndex) => string,
): readonly FamilyState[] {
  return states.map((state) => ({
    name: state,
    pieceByLane: [
      piece(state, LANE_LEFT),
      piece(state, LANE_UP),
      piece(state, LANE_DOWN),
      piece(state, LANE_RIGHT),
    ],
  }));
}

const STATE_FAMILIES: readonly StateFamily[] = [
  {
    prefix: 'note',
    states: familyStates(NOTE_STATES, notePiece),
    minDifference: NOTE_STATE_MIN_DIFFERENCE,
  },
  {
    prefix: 'receptor',
    states: familyStates(RECEPTOR_STATES, receptorPiece),
    minDifference: RECEPTOR_STATE_MIN_DIFFERENCE,
  },
  {
    prefix: 'touch',
    states: familyStates(TOUCH_STATES, touchPiece),
    minDifference: TOUCH_STATE_MIN_DIFFERENCE,
  },
];

function gateStateDistinctness(art: KeyboardHeroArt): void {
  let pairsMeasured = 0;
  for (const family of STATE_FAMILIES) {
    let mildestPair = '';
    let mildestDifference = Number.POSITIVE_INFINITY;
    for (const lane of LANE_INDICES) {
      for (let i = 0; i < family.states.length; i++) {
        for (let j = i + 1; j < family.states.length; j++) {
          const first = lookup('K3', art, family.states[i].pieceByLane[lane]);
          const second = lookup('K3', art, family.states[j].pieceByLane[lane]);
          if (first === null || second === null) continue;
          pairsMeasured++;
          const difference = stateDifference(first, second);
          if (difference < mildestDifference) {
            mildestDifference = difference;
            mildestPair = `${LANE_PALETTES[lane].name} ${family.states[i].name}/${family.states[j].name}`;
          }
          if (difference >= family.minDifference) continue;
          fail(
            'K3',
            `${family.prefix} ${family.states[i].name} and ${family.states[j].name} on lane ` +
              `${lane} (${LANE_PALETTES[lane].name}) differ by only ${difference.toFixed(4)}, ` +
              `under the ${family.minDifference} this family is held to — the two states are ` +
              'painting the same picture, so the player never sees the change',
          );
        }
      }
    }
    if (mildestPair !== '') {
      console.log(
        `  K3 ${family.prefix}: mildest pair is ${mildestPair} at ` +
          `${mildestDifference.toFixed(4)} (floor ${family.minDifference})`,
      );
    }
  }
  failUnlessMeasured('K3', pairsMeasured, 'state pairs');
}

// ── K7 ink that stays inside its own cell ───────────────────────────────────

/**
 * Alpha above which a pixel counts as ink rather than antialiasing dust.
 */
const CELL_EDGE_INK_ALPHA = 8;

/**
 * The three per-lane families are drawn into explicit screen rects, so a painter
 * that strays outside its piece does not overflow — the piece's own surface clips
 * it, and the art ships with a stroke sliced off flush at a straight edge. That
 * reads as a rendering fault rather than as a drawing, and it is invisible in the
 * source (the painter's arithmetic looks fine), invisible in a per-piece contrast
 * or distinctness measurement, and invisible on a contact sheet unless the
 * reviewer already suspects it.
 *
 * The board frame and the lane beds are deliberately excluded: both are meant to
 * fill their piece edge to edge, which is why this walks `STATE_FAMILIES` rather
 * than every piece.
 */
/** The heaviest ink found anywhere on a cell's outermost ring of pixels. */
function peakEdgeAlpha(cell: Cell): number {
  let peak = 0;
  const lastX = cell.width - 1;
  const lastY = cell.height - 1;
  for (let x = 0; x < cell.width; x++) {
    peak = Math.max(peak, alphaAt(cell, x, 0), alphaAt(cell, x, lastY));
  }
  for (let y = 0; y < cell.height; y++) {
    peak = Math.max(peak, alphaAt(cell, 0, y), alphaAt(cell, lastX, y));
  }
  return peak;
}

function gateInkStaysInsideCell(art: KeyboardHeroArt): void {
  let cellsMeasured = 0;
  for (const family of STATE_FAMILIES) {
    for (const lane of LANE_INDICES) {
      for (const state of family.states) {
        const piece = state.pieceByLane[lane];
        const cell = lookup('K7', art, piece);
        if (cell === null) continue;
        cellsMeasured++;

        const peak = peakEdgeAlpha(cell);
        if (peak <= CELL_EDGE_INK_ALPHA) continue;
        fail(
          'K7',
          `${piece} paints ink of alpha ${peak} onto the outermost ring of its own piece, above ` +
            `the ${CELL_EDGE_INK_ALPHA} an antialiased edge leaves — the drawing runs past its ` +
            'frame and the surface it is painted into cuts it off flush',
        );
      }
    }
  }
  console.log(`  K7: ${cellsMeasured} painted pieces checked for ink running off their frame`);
  failUnlessMeasured('K7', cellsMeasured, 'painted pieces for edge clearance');
}

// ── K5 every name the board can ask for ────────────────────────────────────

/**
 * The piece names built the way `keyboardHeroArtCache` builds them — one walk of
 * the lanes and the painter's own state unions rather than a restated list — so a
 * renamed state fails here instead of dropping silently out of both sides of the
 * comparison.
 *
 * The bake is gone, but the failure this guards has not gone with it: the cache
 * resolves a name to a painter call, and a name nothing paints is a `drawImage`
 * that never happens, which on the board's dark scrim is indistinguishable from
 * drawing correctly. The other half matters just as much now — a piece painted
 * that nothing on the board ever asks for is a surface allocated for nobody.
 */
function reachablePieceNames(): readonly string[] {
  const names = [BOARD_FRAME_PIECE, LANE_HIGHLIGHT_PIECE];
  for (const lane of LANE_INDICES) names.push(laneBedPiece(lane));
  for (const family of STATE_FAMILIES) {
    for (const state of family.states) {
      for (const lane of LANE_INDICES) names.push(state.pieceByLane[lane]);
    }
  }
  return names;
}

/** Alpha below which a whole piece counts as having painted nothing at all. */
const PIECE_INK_ALPHA = 8;

function paintsSomething(cell: Cell): boolean {
  for (let i = ALPHA_OFFSET; i < cell.pixels.length; i += RGBA_STRIDE) {
    if (cell.pixels[i] > PIECE_INK_ALPHA) return true;
  }
  return false;
}

function gateEveryPieceExists(art: KeyboardHeroArt): void {
  const reachable = reachablePieceNames();
  let namesMeasured = 0;
  for (const name of reachable) {
    namesMeasured++;
    const cell = art.cells.get(name);
    if (cell === undefined) {
      fail(
        'K5',
        `the board asks for "${name}", which nothing paints — at runtime that draw silently ` +
          'paints nothing onto a black scrim',
      );
      continue;
    }
    if (paintsSomething(cell)) continue;
    fail(
      'K5',
      `"${name}" paints, but every pixel of it comes out transparent — the board draws it and ` +
        'nothing appears',
    );
  }
  for (const painted of art.cells.keys()) {
    if (reachable.includes(painted)) continue;
    fail(
      'K5',
      `"${painted}" is painted, but nothing on the board ever draws it — it is a surface ` +
        'allocated for nobody',
    );
  }
  failUnlessMeasured('K5', namesMeasured, 'piece names the board can reach');
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** Runs every keyboard-hero gate and returns one message per failure. */
export function keyboardHeroGateFailures(art: KeyboardHeroArt): string[] {
  failures.length = 0;
  const layout = computeKeyboardHeroLayout(GATE_VIEWPORT_W, GATE_VIEWPORT_H, false);
  gateEveryPieceExists(art);
  gateLaneAlignment(art, layout);
  gateKeycapContrast(art, layout);
  gateReceptorContrast(art);
  gateStateDistinctness(art);
  gateInkStaysInsideCell(art);
  return [...failures];
}
