import { drawSpriteKey, walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';

const GRUB_WALK_FRAME_COUNT = 8;

/** Which of the sheet's three viewpoints a facing vector selects, mirroring Mantid's `viewFor()`. */
type GrubView = 'front' | 'side' | 'away';

function viewFor(facingX: number, facingY: number): GrubView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: 'idle' | 'walk' | 'attack', view: GrubView): string {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
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
    if (!isBrindleGrubState(key)) return;
    drawSpriteKey(
      ctx,
      'brindle_grub',
      key,
      walkFrameIndex(walkFrame, GRUB_WALK_FRAME_COUNT),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }
  drawSpriteKey(ctx, 'brindle_grub', 'idle', 0, sx, sy, s, { flipX });
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
    if (!isCowTailedGrubState(key)) return;
    const frameCount = COW_TAILED_ATTACK_FRAME_COUNT;
    drawSpriteKey(
      ctx,
      'cow_tailed_grub',
      key,
      progressFrameIndex(biteProgress, frameCount),
      sx,
      sy,
      s,
      {
        flipX,
      },
    );
    return;
  }

  if (isMoving) {
    const key = stateFor('walk', view);
    if (!isCowTailedGrubState(key)) return;
    drawSpriteKey(
      ctx,
      'cow_tailed_grub',
      key,
      walkFrameIndex(walkFrame, GRUB_WALK_FRAME_COUNT),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }
  drawSpriteKey(ctx, 'cow_tailed_grub', 'idle', 0, sx, sy, s, { flipX });
}

/** Matches the `attack*` row length baked by `scripts/generate-brindle-grub-sprite.ts`. */
const COW_TAILED_ATTACK_FRAME_COUNT = 7;

function isBrindleGrubState(state: string): state is 'walk' | 'walk_side' | 'walk_away' {
  return state === 'walk' || state === 'walk_side' || state === 'walk_away';
}

function isCowTailedGrubState(
  state: string,
): state is 'walk' | 'walk_side' | 'walk_away' | 'attack' | 'attack_side' | 'attack_away' {
  return (
    state === 'walk' ||
    state === 'walk_side' ||
    state === 'walk_away' ||
    state === 'attack' ||
    state === 'attack_side' ||
    state === 'attack_away'
  );
}
