/**
 * Painted-once, blitted-thereafter surfaces for the keyboard-hero board.
 *
 * The board's art used to ship as five PNG sheets in the spider's image
 * directory: decoded the moment floor 2 loaded and resident for the whole floor
 * whether or not the player ever sat down at the terminal. The painter that
 * produced those pixels was an offline generator, so the runtime had no way to
 * make one for itself.
 *
 * Here the painter ships instead — `src/sprites/art/keyboardHeroArt.ts` — and
 * this cache stands where the sheets stood, the same trade
 * `src/sprites/figure/figureFrameCache.ts` makes for creatures. A piece is
 * painted once into an offscreen surface and blitted from then on, so the
 * steady-state cost per draw is still one `drawImage`, while the resident set is
 * the mini-game currently on screen rather than a floor's worth of console art
 * nobody looked at. `releaseKeyboardHeroArt` puts it back to nothing.
 *
 * Three decisions carry that:
 *
 *  - **Pieces are painted supersampled and blitted down**, at `BOARD_BAKE_SCALE`,
 *    exactly as the sheets were baked at 2× and drawn down. A piece painted at
 *    1:1 CSS size would go soft the moment the canvas has a retina backing store
 *    or the render-quality setting scales it up.
 *  - **The requested pixel size is part of the key, and a piece keeps one entry.**
 *    The board is fitted to the viewport, so a resize changes every rect; a
 *    request whose size differs from what is cached repaints and replaces, which
 *    is what stops a window being dragged from growing the cache without bound.
 *    Sizes are rounded to whole pixels first, so sub-pixel layout jitter cannot
 *    thrash it.
 *  - **The note keycap is the one piece keyed on nothing.** It is the only piece
 *    drawn at a varying scale — a struck note pops, a missed one shrinks — so
 *    keying it on its requested size would repaint it on every frame of that
 *    animation. It is cached at its board-space size at bake scale, which is the
 *    size the sheet cell was, and the caller's `drawImage` scales it, exactly as
 *    the fixed-size sheet did.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';
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
} from '../sprites/art/keyboardHeroArt';
import {
  BOARD_BAKE_SCALE,
  LANE_PALETTES,
  BOARD_IMG_W,
  LANE_BED_IMG_W,
  NOTE_IMG_SIZE,
  RECEPTOR_IMG_SIZE,
  TOUCH_IMG_SIZE,
  type LaneIndex,
} from './keyboardHeroLayout';

/** Paints one piece into a surface already sized to `w`×`h` supersampled pixels. */
type PiecePainter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/**
 * A piece is painted at `BOARD_BAKE_SCALE` times its display size, but never at
 * more pixels than the sheet it replaced held.
 *
 * Display size is a function of the viewport, so an uncapped supersample would
 * make the board's memory a function of the monitor: fullscreen on a 4K panel
 * asks for a board roughly 1259 CSS px wide, which at a flat 2× is a 2518×3888
 * surface — around 39 MB for the console frame alone, against the 6.3 MB the
 * baked sheet cost at any resolution. The cap holds the old ceiling exactly, and
 * at ordinary desktop fits it never binds: a 1280×720 viewport paints the frame
 * 840 px wide, well inside the 1036 the sheet had.
 */
function supersampleFor(requestedWidth: number, designWidth: number): number {
  return Math.min(BOARD_BAKE_SCALE, (BOARD_BAKE_SCALE * designWidth) / requestedWidth);
}

interface CachedPiece {
  readonly surface: CanvasSurface;
  /** The requested size this was painted for, in whole CSS pixels. */
  readonly width: number;
  readonly height: number;
}

const pieces = new Map<string, CachedPiece>();

/**
 * Clips to the piece's own rect before painting, mirroring the per-cell clip the
 * offline bake used: a painter that overshoots shows up as a clipped edge on its
 * own piece rather than as a smear across whatever the caller drew next.
 */
function paintPiece(
  width: number,
  height: number,
  designWidth: number,
  paint: PiecePainter,
): CanvasSurface {
  const supersample = supersampleFor(width, designWidth);
  const paintW = Math.max(1, Math.round(width * supersample));
  const paintH = Math.max(1, Math.round(height * supersample));
  const surface = allocCanvas(paintW, paintH);
  const ctx = surfaceContext(surface);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, paintW, paintH);
  ctx.clip();
  paint(ctx, paintW, paintH);
  ctx.restore();
  return surface;
}

/**
 * The surface for one piece at one size, painting it if the cached one is a
 * different size or there is none. Null when the layout has collapsed to nothing
 * — a viewport of zero width during a resize — because a zero-sized surface is
 * not something every browser will even allocate, let alone draw into.
 */
function pieceSurface(
  key: string,
  width: number,
  height: number,
  designWidth: number,
  paint: PiecePainter,
): CanvasSurface | null {
  const w = Math.round(width);
  const h = Math.round(height);
  if (w <= 0 || h <= 0) return null;

  const cached = pieces.get(key);
  if (cached?.width === w && cached.height === h) return cached.surface;
  if (cached !== undefined) discard(cached.surface);

  const surface = paintPiece(w, h, designWidth, paint);
  pieces.set(key, { surface, width: w, height: h });
  return surface;
}

const BOARD_FRAME_KEY = 'frame';
const LANE_HIGHLIGHT_KEY = 'highlight';

function laneBedKey(lane: LaneIndex): string {
  return `bed_${lane}`;
}

function noteKey(lane: LaneIndex, state: NoteState): string {
  return `note_${state}_${lane}`;
}

function receptorKey(lane: LaneIndex, state: ReceptorState): string {
  return `receptor_${state}_${lane}`;
}

function touchKey(lane: LaneIndex, state: TouchState): string {
  return `touch_${state}_${lane}`;
}

export function boardFrameArt(width: number, height: number): CanvasSurface | null {
  return pieceSurface(BOARD_FRAME_KEY, width, height, BOARD_IMG_W, paintBoardFrame);
}

export function laneBedArt(lane: LaneIndex, width: number, height: number): CanvasSurface | null {
  return pieceSurface(laneBedKey(lane), width, height, LANE_BED_IMG_W, (ctx, w, h) =>
    paintLaneBed(ctx, w, h, LANE_PALETTES[lane]),
  );
}

export function laneHighlightArt(width: number, height: number): CanvasSurface | null {
  return pieceSurface(LANE_HIGHLIGHT_KEY, width, height, LANE_BED_IMG_W, paintLaneHighlight);
}

/**
 * The note keycap at its board-space size, ready to be scaled into whatever the
 * caller's pop or shrink animation asks for.
 */
export function noteKeycapArt(lane: LaneIndex, state: NoteState): CanvasSurface | null {
  return pieceSurface(noteKey(lane, state), NOTE_IMG_SIZE, NOTE_IMG_SIZE, NOTE_IMG_SIZE, (ctx, w) =>
    paintNoteKeycap(ctx, w, LANE_PALETTES[lane], state),
  );
}

export function receptorArt(
  lane: LaneIndex,
  state: ReceptorState,
  size: number,
): CanvasSurface | null {
  return pieceSurface(receptorKey(lane, state), size, size, RECEPTOR_IMG_SIZE, (ctx, w) =>
    paintReceptor(ctx, w, LANE_PALETTES[lane], state),
  );
}

export function touchButtonArt(
  lane: LaneIndex,
  state: TouchState,
  size: number,
): CanvasSurface | null {
  return pieceSurface(touchKey(lane, state), size, size, TOUCH_IMG_SIZE, (ctx, w) =>
    paintTouchButton(ctx, w, LANE_PALETTES[lane], state),
  );
}

/**
 * An `HTMLCanvasElement` fallback holds its backing store until something tells
 * it not to, and dropping the reference alone leaves that up to the garbage
 * collector; resizing to nothing frees it now.
 */
function discard(surface: CanvasSurface): void {
  surface.width = 0;
  surface.height = 0;
}

/**
 * Drops every painted surface. Called when the mini-game is over, so the board's
 * art is resident only while the board is — the residency win that paying the
 * paint cost on entry buys.
 */
export function releaseKeyboardHeroArt(): void {
  for (const piece of pieces.values()) discard(piece.surface);
  pieces.clear();
}
