import {
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/spriteAssets/SpriteRenderer';
import {
  drawnFigureRow,
  figureFrameCount,
  type DrawnFigureRow,
  type FigureDef,
} from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { JANITOR_FIGURE, SYDNEY_FIGURE, crocStateName } from './art/crocodilianFigure';
import { JANITOR_IDLE_FPS, SYDNEY_IDLE_FPS, SYDNEY_TALK_FPS } from './crocodilianTiming';

export { JANITOR_TILES_PER_WALK_CYCLE, SYDNEY_TILES_PER_WALK_CYCLE } from './art/crocodilianFigure';

/** Which of the two crocodilians is being drawn. */
export type CrocodilianVariant = 'janitor' | 'sydney';

/** The janitor's rows. Every pub janitor wears this one figure. */
export type JanitorRow = 'idle' | 'walk_mop' | 'mop' | 'wring';

/** Sydney's rows. She keeps the mercenaries' desk; she does not fight. */
export type SydneyRow = 'idle' | 'walk' | 'talk';

/** Which of the three viewpoints a facing vector selects. */
export type CrocodilianView = 'front' | 'side' | 'away';

/** What drives each row's frame. */
type RowClock = 'walk' | 'progress' | 'loop';

/** `mop` loops, but on its routine's progress, so the swish sounds where the stroke is fastest. */
const JANITOR_CLOCKS: Readonly<Record<JanitorRow, RowClock>> = {
  idle: 'loop',
  walk_mop: 'walk',
  mop: 'progress',
  wring: 'progress',
};

const SYDNEY_CLOCKS: Readonly<Record<SydneyRow, RowClock>> = {
  idle: 'loop',
  walk: 'walk',
  talk: 'loop',
};

const JANITOR_LOOP_FPS: Partial<Record<JanitorRow, number>> = {
  idle: JANITOR_IDLE_FPS,
};

const SYDNEY_LOOP_FPS: Partial<Record<SydneyRow, number>> = {
  idle: SYDNEY_IDLE_FPS,
  talk: SYDNEY_TALK_FPS,
};

/** Fields every crocodilian draw takes. All optional but the row. */
interface CrocodilianCommonState {
  readonly facingX?: number;
  readonly facingY?: number;
  /** The walk cycle angle, radians (0–2π), for `walk` and `walk_mop`. */
  readonly walkFrame?: number;
  /** 0 at a one-shot's first frame, 1 at its last; for `mop`, 0–1 is one two-stroke cycle. */
  readonly progress?: number;
  /** Seconds on a monotonic clock, for the looping rows; defaults to `performance.now()`. */
  readonly elapsedSeconds?: number;
  /** Whole-figure opacity. */
  readonly alpha?: number;
}

export interface JanitorSpriteState extends CrocodilianCommonState {
  readonly variant: 'janitor';
  readonly row: JanitorRow;
}

export interface SydneySpriteState extends CrocodilianCommonState {
  readonly variant: 'sydney';
  readonly row: SydneyRow;
}

export type CrocodilianSpriteState = JanitorSpriteState | SydneySpriteState;

const FIGURES: Readonly<Record<CrocodilianVariant, FigureDef>> = {
  janitor: JANITOR_FIGURE,
  sydney: SYDNEY_FIGURE,
};

/** The row each variant crosses the ground in. */
const WALK_ROWS = {
  janitor: 'walk_mop',
  sydney: 'walk',
} as const satisfies Readonly<Record<CrocodilianVariant, JanitorRow | SydneyRow>>;

function figureFor(variant: CrocodilianVariant): FigureDef {
  return FIGURES[variant];
}

/** Views split on whichever axis the figure faces hardest along. */
function viewFor(facingX: number, facingY: number): CrocodilianView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/**
 * How many frames a row holds, read from the figure that paints it — a
 * hand-copied table would let a shortened row freeze on its last frame, since
 * the cache clamps the frame index rather than throwing.
 */
function frameCountOf(def: FigureDef, state: string): number {
  return Math.max(1, figureFrameCount(def, state));
}

function clockOf(state: CrocodilianSpriteState): { clock: RowClock; fps: number | undefined } {
  if (state.variant === 'sydney') {
    return { clock: SYDNEY_CLOCKS[state.row], fps: SYDNEY_LOOP_FPS[state.row] };
  }
  return { clock: JANITOR_CLOCKS[state.row], fps: JANITOR_LOOP_FPS[state.row] };
}

/** A loop row's fallback speed when a table entry is missing. */
const DEFAULT_LOOP_FPS = 6;
const MS_PER_SECOND = 1000;

/**
 * Draw the janitor or Sydney, returning the row drawn so a caller can hang
 * a label or icon over the art's measured top.
 *
 * Only the profile is mirrored: the head-on views are painted with the pail in
 * the figure's own left hand and the mop in his right, and flipping them would
 * swap them.
 */
export function drawCrocodilianSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: CrocodilianSpriteState,
): DrawnFigureRow {
  const { facingX = 1, facingY = 0, walkFrame = 0, progress = 0, alpha = 1 } = state;
  const def = figureFor(state.variant);
  const view = viewFor(facingX, facingY);
  const name = crocStateName(state.row, view);
  const count = frameCountOf(def, name);
  const { clock, fps } = clockOf(state);
  const elapsed = state.elapsedSeconds ?? performance.now() / MS_PER_SECOND;
  let frame: number;
  if (clock === 'walk') frame = walkFrameIndex(walkFrame, count);
  else if (clock === 'progress') frame = progressFrameIndex(progress, count);
  else frame = timeFrameIndex(elapsed, fps ?? DEFAULT_LOOP_FPS, count);
  const flipX = view === 'side' && facingX < 0;
  drawFigureCached(ctx, def, name, frame, sx, sy, tileSize, { flipX, alpha });
  return drawnFigureRow(def, name);
}

const VIEWS: readonly CrocodilianView[] = ['front', 'side', 'away'];

const JANITOR_ROW_NAMES: readonly JanitorRow[] = ['idle', 'walk_mop', 'mop', 'wring'];

const SYDNEY_ROW_NAMES: readonly SydneyRow[] = ['idle', 'walk', 'talk'];

/**
 * Every state name the draw path can compose for a variant, built through the
 * same `crocStateName` the draw call uses so the prewarm list, the gates and the
 * draw call can never name different rows.
 */
export function crocodilianReachableStates(variant: CrocodilianVariant): readonly string[] {
  const rows: readonly string[] = variant === 'sydney' ? SYDNEY_ROW_NAMES : JANITOR_ROW_NAMES;
  return rows.flatMap((row) => VIEWS.map((view) => crocStateName(row, view)));
}

/**
 * Warms a crocodilian's `rows` in every view at the moment its figure is
 * scheduled — a room being built, a desk being opened — rather than when it
 * first renders.
 */
function prewarmCrocodilian(variant: CrocodilianVariant, rows: readonly string[]): void {
  const def = figureFor(variant);
  for (const row of rows) {
    for (const view of VIEWS) prewarmFigureState(def, crocStateName(row, view));
  }
}

/** The janitor's full working set: every row his mop routine can ask for, in every view. */
export function prewarmJanitor(): void {
  prewarmCrocodilian('janitor', JANITOR_ROW_NAMES);
}

/** Frames in a variant's walk row: the most one tick may advance its cycle is one of them. */
export function crocodilianWalkFrames(variant: CrocodilianVariant): number {
  return frameCountOf(figureFor(variant), crocStateName(WALK_ROWS[variant], 'side'));
}

/** Sydney's face-on idle, for a portrait framed by the art's measured top. */
export function sydneyPortraitRow(): DrawnFigureRow {
  return drawnFigureRow(SYDNEY_FIGURE, crocStateName('idle', 'front'));
}

/** Sydney's full working set: she stands at her desk, turns and talks. */
export function prewarmSydney(): void {
  prewarmCrocodilian('sydney', SYDNEY_ROW_NAMES);
}
