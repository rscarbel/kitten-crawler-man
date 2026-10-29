import { walkFrameIndex, progressFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import {
  BEETLE_ACTIONS,
  BEETLE_VIEWS,
  GORE_STATES,
  GRAVEDIGGER_BEETLE_FIGURE,
  GRAVEDIGGER_LARVA_FIGURE,
  GRAVEDIGGER_PUPA_FIGURE,
  PUPA_HATCH_STATE,
  PUPA_PULSE_STATE,
  viewedRowName,
  type BeetleAction,
  type View,
} from './art/gravediggerBeetleFigure';
import { figureFrameCount, type FigureDef } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

function viewFor(facingX: number, facingY: number): View {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/**
 * How many frames a row actually holds, read from the figure that paints it.
 * `drawFigureCached` clamps the frame index, so a row that got shorter would
 * silently freeze on its last frame rather than throw.
 */
function frameCountOf(figure: FigureDef, state: string): number {
  return Math.max(1, figureFrameCount(figure, state));
}

// ── Larva ────────────────────────────────────────────────────────────────────

export interface LarvaSpriteState {
  readonly walkFrame: number;
  readonly isMoving: boolean;
  readonly facingX: number;
  readonly facingY: number;
}

export function drawGravediggerLarvaSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: LarvaSpriteState,
): void {
  const view = viewFor(state.facingX, state.facingY);
  // The idle is painted in profile, so it mirrors with the facing whatever the view.
  if (!state.isMoving) {
    drawFigureCached(ctx, GRAVEDIGGER_LARVA_FIGURE, 'idle', 0, sx, sy, s, {
      flipX: state.facingX < 0,
    });
    return;
  }
  const key = viewedRowName('walk', view);
  drawFigureCached(
    ctx,
    GRAVEDIGGER_LARVA_FIGURE,
    key,
    walkFrameIndex(state.walkFrame, frameCountOf(GRAVEDIGGER_LARVA_FIGURE, key)),
    sx,
    sy,
    s,
    { flipX: view === 'side' && state.facingX < 0 },
  );
}

/** Every state name `drawGravediggerLarvaSprite` can ask the larva figure for. */
export const LARVA_REACHABLE_STATES: readonly string[] = [
  'idle',
  ...BEETLE_VIEWS.map((view) => viewedRowName('walk', view)),
];

/**
 * Warms the larva's rows where a spawn is *scheduled* rather than where it
 * first renders: level 2's on-kill rule bursts up to five of them out of one
 * corpse, which is a row of cold cells if the first request is the frame they
 * appear on.
 */
export function prewarmGravediggerLarva(): void {
  for (const state of LARVA_REACHABLE_STATES) prewarmFigureState(GRAVEDIGGER_LARVA_FIGURE, state);
}

// ── Pupa ─────────────────────────────────────────────────────────────────────

/** What a pupa is showing: its pulse at some phase, or its hatch at some progress. */
export type PupaSpriteState =
  | { readonly kind: 'pulse'; readonly phase: number }
  | { readonly kind: 'hatch'; readonly progress: number };

export function drawGravediggerPupaSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: PupaSpriteState,
): void {
  switch (state.kind) {
    case 'pulse':
      drawFigureCached(
        ctx,
        GRAVEDIGGER_PUPA_FIGURE,
        PUPA_PULSE_STATE,
        walkFrameIndex(state.phase, frameCountOf(GRAVEDIGGER_PUPA_FIGURE, PUPA_PULSE_STATE)),
        sx,
        sy,
        s,
      );
      return;
    case 'hatch':
      drawFigureCached(
        ctx,
        GRAVEDIGGER_PUPA_FIGURE,
        PUPA_HATCH_STATE,
        progressFrameIndex(state.progress, frameCountOf(GRAVEDIGGER_PUPA_FIGURE, PUPA_HATCH_STATE)),
        sx,
        sy,
        s,
      );
      return;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

export const PUPA_REACHABLE_STATES: readonly string[] = [PUPA_PULSE_STATE, PUPA_HATCH_STATE];

/** Warms the sac, a second before a larva seals itself into one. */
export function prewarmGravediggerPupa(): void {
  for (const state of PUPA_REACHABLE_STATES) prewarmFigureState(GRAVEDIGGER_PUPA_FIGURE, state);
}

// ── Adult ────────────────────────────────────────────────────────────────────

export interface BeetleSpriteState {
  readonly facingX: number;
  readonly facingY: number;
  /** 0 at the first frame of the bite, 1 at the last; null when not biting. */
  readonly biteProgress: number | null;
  /** 0 at the first frame of the spit, 1 at the last; null when not spitting. */
  readonly spitProgress: number | null;
}

const HOVER_FPS = 10;
const MILLISECONDS_PER_SECOND = 1000;

export function drawGravediggerBeetleSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: BeetleSpriteState,
): void {
  const view = viewFor(state.facingX, state.facingY);
  const flipX = view === 'side' && state.facingX < 0;
  const oneShot: { readonly action: BeetleAction; readonly progress: number } | null =
    state.biteProgress !== null
      ? { action: 'bite', progress: state.biteProgress }
      : state.spitProgress !== null
        ? { action: 'spit', progress: state.spitProgress }
        : null;
  if (oneShot !== null) {
    const key = viewedRowName(oneShot.action, view);
    drawFigureCached(
      ctx,
      GRAVEDIGGER_BEETLE_FIGURE,
      key,
      progressFrameIndex(oneShot.progress, frameCountOf(GRAVEDIGGER_BEETLE_FIGURE, key)),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }
  const key = viewedRowName('fly', view);
  const frames = frameCountOf(GRAVEDIGGER_BEETLE_FIGURE, key);
  const frame = Math.floor((performance.now() / MILLISECONDS_PER_SECOND) * HOVER_FPS) % frames;
  drawFigureCached(ctx, GRAVEDIGGER_BEETLE_FIGURE, key, frame, sx, sy, s, { flipX });
}

/**
 * Every pose state `drawGravediggerBeetleSprite` can ask the adult figure for,
 * composed through `viewedRowName` rather than listed by hand.
 */
export const ADULT_REACHABLE_STATES: readonly string[] = BEETLE_ACTIONS.flatMap((action) =>
  BEETLE_VIEWS.map((view) => viewedRowName(action, view)),
);

/**
 * Warms every row the adult can draw, a second before it hatches: it hovers
 * from the frame it appears and opens with a bite or a spit as soon as
 * anything is in range, with no second telegraph between them.
 */
export function prewarmGravediggerBeetle(): void {
  for (const state of ADULT_REACHABLE_STATES) {
    prewarmFigureState(GRAVEDIGGER_BEETLE_FIGURE, state);
  }
}

/** Warms the severed pieces, all drawn on the one frame the beetle comes apart. */
export function prewarmGravediggerBeetleGore(): void {
  for (const state of GORE_STATES) prewarmFigureState(GRAVEDIGGER_BEETLE_FIGURE, state);
}

/** The pieces an adult comes apart into, in the order `BodyPartGoreSystem` spawns them. */
export const GRAVEDIGGER_BEETLE_GORE_PARTS: readonly string[] = GORE_STATES;

/** The `BodyPartGoreSystem` registry key the adult's pieces come from. */
export const GRAVEDIGGER_BEETLE_BODY_PART_KEY = 'gravedigger_beetle';
