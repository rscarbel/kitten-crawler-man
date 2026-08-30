import { walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';
import { BRINDLE_GRUB_FIGURE, COW_TAILED_GRUB_FIGURE } from './art/grubFigure';
import { figureFrameCount, type FigureDef } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

/** Which of the figure's three viewpoints a facing vector selects, mirroring Mantid's `viewFor()`. */
type GrubView = 'front' | 'side' | 'away';

/** The action a grub is showing, before it is resolved against a viewpoint. */
type GrubAction = 'idle' | 'walk' | 'attack';

function viewFor(facingX: number, facingY: number): GrubView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: GrubAction, view: GrubView): string {
  // The idle is one pose from any angle: the animal has stopped and there is
  // nothing for a viewpoint to change about a resting tube.
  if (base === 'idle') return base;
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/**
 * How many frames a row actually holds, read from the figure that paints it.
 *
 * Not a hand-copied table: `drawFigureCached` *clamps* the frame index, so a row
 * that got shorter would silently freeze on its last frame rather than throw.
 * There is nothing to notice until someone watches that one animation.
 */
function frameCountOf(figure: FigureDef, state: string): number {
  return Math.max(1, figureFrameCount(figure, state));
}

/** Everything either grub stage needs to pick a pose. */
export interface GrubSpriteState {
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0 at the first frame of a bite, 1 at the last; null when not biting. */
  readonly biteProgress?: number | null;
}

export function drawBrindleGrubSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: GrubSpriteState = {},
): void {
  const { walkFrame = 0, isMoving = false, facingX = 1, facingY = 0 } = state;
  const view = viewFor(facingX, facingY);
  const flipX = view === 'side' && facingX < 0;

  if (isMoving) {
    const key = stateFor('walk', view);
    drawFigureCached(
      ctx,
      BRINDLE_GRUB_FIGURE,
      key,
      walkFrameIndex(walkFrame, frameCountOf(BRINDLE_GRUB_FIGURE, key)),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }
  drawFigureCached(ctx, BRINDLE_GRUB_FIGURE, 'idle', 0, sx, sy, s, { flipX });
}

export function drawCowTailedGrubSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: GrubSpriteState = {},
): void {
  const { walkFrame = 0, isMoving = false, facingX = 1, facingY = 0, biteProgress = null } = state;
  const view = viewFor(facingX, facingY);
  const flipX = view === 'side' && facingX < 0;

  if (biteProgress !== null) {
    const key = stateFor('attack', view);
    drawFigureCached(
      ctx,
      COW_TAILED_GRUB_FIGURE,
      key,
      progressFrameIndex(biteProgress, frameCountOf(COW_TAILED_GRUB_FIGURE, key)),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }

  if (isMoving) {
    const key = stateFor('walk', view);
    drawFigureCached(
      ctx,
      COW_TAILED_GRUB_FIGURE,
      key,
      walkFrameIndex(walkFrame, frameCountOf(COW_TAILED_GRUB_FIGURE, key)),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }
  drawFigureCached(ctx, COW_TAILED_GRUB_FIGURE, 'idle', 0, sx, sy, s, { flipX });
}

const GRUB_VIEWS: ReadonlyArray<GrubView> = ['front', 'side', 'away'];

/**
 * Every state name a grub of this build's draw path can ask its figure for.
 *
 * Composed through `stateFor` rather than listed by hand, so a view or an action
 * added to one is present in the other. The narrowing is by *action* and never
 * by state: only the second instar has a bite, so a build that paints no attack
 * row at all cannot reach one — but a build that paints two of an action's three
 * views still asks for the third, and filtering by state would quietly drop the
 * missing name from the list instead of reporting it. The art gates feed this to
 * `missingStateFailures`: both draw paths return silently on a state the figure
 * does not paint, so a name only the runtime knows is an invisible creature and
 * no log line.
 */
export function grubReachableStates(figure: FigureDef): readonly string[] {
  const actions: readonly GrubAction[] = ['idle', 'walk', 'attack'];
  const reachable = actions.filter((action) =>
    GRUB_VIEWS.some((view) => figure.states.has(stateFor(action, view))),
  );
  return [
    ...new Set(reachable.flatMap((action) => GRUB_VIEWS.map((view) => stateFor(action, view)))),
  ];
}

/**
 * Warms the rows a grub of this build crosses the ground on.
 *
 * A larva that has just burst out of something wanders and rests, in whichever
 * of the three views it happens to face, and those rows are what the first
 * seconds of it draw. The bite is warmed with the evolution that unlocks it.
 */
function prewarmApproach(figure: FigureDef): void {
  for (const view of GRUB_VIEWS) {
    prewarmFigureState(figure, stateFor('idle', view));
    prewarmFigureState(figure, stateFor('walk', view));
  }
}

/**
 * Warms the larva's rows, called where a spawn is *scheduled* rather than where
 * the mob first renders: level 2's on-kill rule bursts up to five of them out of
 * one corpse, which is a row of cold cells if the first request for them is the
 * frame they appear on.
 */
export function prewarmBrindleGrub(): void {
  prewarmApproach(BRINDLE_GRUB_FIGURE);
}

/**
 * Warms the second instar's rows, called off the evolution clock rather than off
 * the evolution itself: a grub that changes shape on the frame it is next drawn
 * asks for a whole cold build at once.
 */
export function prewarmCowTailedGrub(): void {
  prewarmApproach(COW_TAILED_GRUB_FIGURE);
  for (const view of GRUB_VIEWS) {
    prewarmFigureState(COW_TAILED_GRUB_FIGURE, stateFor('attack', view));
  }
}
