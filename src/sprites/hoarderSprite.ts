import { drawSpriteKey, progressFrameIndex } from '../core/SpriteRenderer';

// Walk sequence: 1→2→3→2→1→4→5→4→repeat (0-indexed: 0,1,2,1,0,3,4,3)
const WALK_SEQ = [0, 1, 2, 1, 0, 3, 4, 3] as const;

function hoarderWalkFrame(walkFrame: number): number {
  const TAU = Math.PI * 2;
  const seqLen = WALK_SEQ.length;
  const cycle = ((walkFrame % TAU) + TAU) % TAU;
  const idx = Math.floor((cycle / TAU) * seqLen) % seqLen;
  return WALK_SEQ[idx] ?? 0;
}

export function drawHoarderSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  facingX: number,
  facingY: number,
  walkFrame: number,
  isMoving: boolean,
  isWindingUp: boolean,
  vomitWindupProgress: number,
): void {
  const flipX = facingX < 0;

  if (isWindingUp) {
    const frame = progressFrameIndex(vomitWindupProgress, 3);
    drawSpriteKey(ctx, 'hoarder', 'vomit_windup', frame, sx, sy, ts, { flipX });
    return;
  }

  const facingBack = facingY < -0.3 && Math.abs(facingY) > Math.abs(facingX);
  const state = facingBack ? 'walk_back' : 'walk';
  const frame = isMoving ? hoarderWalkFrame(walkFrame) : 0;
  drawSpriteKey(ctx, 'hoarder', state, frame, sx, sy, ts, { flipX });
}
