import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import { figureFrameCount, type FigureDef } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  BUCKET_BOY_FIGURE,
  CLARABELLE_FIGURE,
  TRIAGE_SPARKLE_FIGURE,
  TRIAGE_SPARKLE_STATE,
  crocStateName,
} from './art/crocodilianFigure';
import {
  BUCKET_BOY_COWER_FPS,
  BUCKET_BOY_IDLE_FPS,
  CLARABELLE_IDLE_FPS,
  CLARABELLE_TALK_FPS,
} from './crocodilianTiming';

export {
  BUCKET_BOY_TILES_PER_FLEE_CYCLE,
  BUCKET_BOY_TILES_PER_WALK_CYCLE,
  CLARABELLE_TILES_PER_WALK_CYCLE,
} from './art/crocodilianFigure';

/** Which of the two crocodilians is being drawn. */
export type CrocodilianVariant = 'bucket_boy' | 'clarabelle';

/** Bucket Boy's rows. */
export type BucketBoyRow =
  'idle' | 'walk' | 'flee' | 'slap' | 'cast_triage' | 'cower' | 'hurt' | 'death';

/** Clarabelle's rows. She works the door; she does not fight. */
export type ClarabelleRow = 'idle' | 'walk' | 'talk';

/** Which of the three viewpoints a facing vector selects. */
export type CrocodilianView = 'front' | 'side' | 'away';

/** What drives each row's frame. */
type RowClock = 'walk' | 'progress' | 'loop';

const BUCKET_BOY_CLOCKS: Readonly<Record<BucketBoyRow, RowClock>> = {
  idle: 'loop',
  walk: 'walk',
  flee: 'walk',
  slap: 'progress',
  cast_triage: 'progress',
  cower: 'loop',
  hurt: 'progress',
  death: 'progress',
};

const CLARABELLE_CLOCKS: Readonly<Record<ClarabelleRow, RowClock>> = {
  idle: 'loop',
  walk: 'walk',
  talk: 'loop',
};

const BUCKET_BOY_LOOP_FPS: Partial<Record<BucketBoyRow, number>> = {
  idle: BUCKET_BOY_IDLE_FPS,
  cower: BUCKET_BOY_COWER_FPS,
};

const CLARABELLE_LOOP_FPS: Partial<Record<ClarabelleRow, number>> = {
  idle: CLARABELLE_IDLE_FPS,
  talk: CLARABELLE_TALK_FPS,
};

/** Fields every crocodilian draw takes. All optional but the row. */
interface CrocodilianCommonState {
  readonly facingX?: number;
  readonly facingY?: number;
  /** The walk cycle angle, radians (0–2π), for `walk` and `flee`. */
  readonly walkFrame?: number;
  /** 0 at a one-shot's first frame, 1 at its last. `death` holds its corpse at 1. */
  readonly progress?: number;
  /** Seconds on a monotonic clock, for the looping rows; defaults to `performance.now()`. */
  readonly elapsedSeconds?: number;
  /** Whole-figure opacity, for a corpse fading out. */
  readonly alpha?: number;
}

export interface BucketBoySpriteState extends CrocodilianCommonState {
  readonly variant: 'bucket_boy';
  readonly row: BucketBoyRow;
}

export interface ClarabelleSpriteState extends CrocodilianCommonState {
  readonly variant: 'clarabelle';
  readonly row: ClarabelleRow;
}

export type CrocodilianSpriteState = BucketBoySpriteState | ClarabelleSpriteState;

function figureFor(variant: CrocodilianVariant): FigureDef {
  return variant === 'clarabelle' ? CLARABELLE_FIGURE : BUCKET_BOY_FIGURE;
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
  if (state.variant === 'clarabelle') {
    return { clock: CLARABELLE_CLOCKS[state.row], fps: CLARABELLE_LOOP_FPS[state.row] };
  }
  return { clock: BUCKET_BOY_CLOCKS[state.row], fps: BUCKET_BOY_LOOP_FPS[state.row] };
}

/** A loop row's fallback speed when a table entry is missing. */
const DEFAULT_LOOP_FPS = 6;
const MS_PER_SECOND = 1000;

/**
 * Draw Bucket Boy or Clarabelle.
 *
 * Only the profile is mirrored: the head-on views are painted with the bucket
 * and armband in the figure's own left hand, and flipping them would swap it.
 */
export function drawCrocodilianSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: CrocodilianSpriteState,
): void {
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
}

/**
 * Draw the Triage sparkle on a healed creature's tile. `progress` runs 0 (the
 * heal lands) to 1 (gone), over `TRIAGE_SPARKLE_DURATION_MS`.
 */
export function drawTriageSparkleSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  progress: number,
): void {
  const frame = progressFrameIndex(
    progress,
    frameCountOf(TRIAGE_SPARKLE_FIGURE, TRIAGE_SPARKLE_STATE),
  );
  drawFigureCached(ctx, TRIAGE_SPARKLE_FIGURE, TRIAGE_SPARKLE_STATE, frame, sx, sy, tileSize);
}

const VIEWS: readonly CrocodilianView[] = ['front', 'side', 'away'];

export const BUCKET_BOY_ROW_NAMES: readonly BucketBoyRow[] = [
  'idle',
  'walk',
  'flee',
  'slap',
  'cast_triage',
  'cower',
  'hurt',
  'death',
];

export const CLARABELLE_ROW_NAMES: readonly ClarabelleRow[] = ['idle', 'walk', 'talk'];

/**
 * Every state name the draw path can compose for a variant, built through the
 * same `crocStateName` the draw call uses so the prewarm list, the gates and the
 * draw call can never name different rows.
 */
export function crocodilianReachableStates(variant: CrocodilianVariant): readonly string[] {
  const rows: readonly string[] =
    variant === 'clarabelle' ? CLARABELLE_ROW_NAMES : BUCKET_BOY_ROW_NAMES;
  return rows.flatMap((row) => VIEWS.map((view) => crocStateName(row, view)));
}

/**
 * Warms a crocodilian's rows at the moment its spawn is scheduled — a hire at
 * the desk, the club being built — rather than when it first renders.
 *
 * With no `rows`, warms what it crosses the ground on (idle and walk in every
 * view); pass the rows a coming action needs to warm those as well.
 */
export function prewarmCrocodilian(
  variant: CrocodilianVariant,
  rows: readonly string[] = ['idle', 'walk'],
): void {
  const def = figureFor(variant);
  for (const row of rows) {
    for (const view of VIEWS) prewarmFigureState(def, crocStateName(row, view));
  }
}

/** Bucket Boy's full working set: everything his kit can ask for. */
export function prewarmBucketBoy(): void {
  prewarmCrocodilian('bucket_boy', BUCKET_BOY_ROW_NAMES);
}

/** Clarabelle's full working set: she stands at the door, turns and talks. */
export function prewarmClarabelle(): void {
  prewarmCrocodilian('clarabelle', CLARABELLE_ROW_NAMES);
}

/** The sparkle, warmed when Bucket Boy starts his channel, so it is ready when the heal lands. */
export function prewarmTriageSparkle(): void {
  prewarmFigureState(TRIAGE_SPARKLE_FIGURE, TRIAGE_SPARKLE_STATE);
}
