import { drawSpriteKey, walkFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';

const GRUB_WALK_FRAME_COUNT = 8;

const VESPA_HOVER_FRAME_COUNT = 8;
const VESPA_HOVER_FRAME_RATE = 8;
const PERF_NOW_TO_SECONDS = 1000;

const SPIT_HIT_SPLAT_COUNT = 5;
const SPIT_HIT_ORBIT_RADIUS = 5;
const SPIT_HIT_BLOB_R = 3;
const SPIT_PULSE_FREQ = 12;
const SPIT_PULSE_AMPLITUDE = 0.15;
const SPIT_GLOW_RADIUS = 8;
const SPIT_CORE_RADIUS_DIVISOR = 4; // core is 1/4 of outer
const SPIT_HIGHLIGHT_OFFSET_X = 1.2;
const SPIT_HIGHLIGHT_OFFSET_Y = 1.4;
const SPIT_HIGHLIGHT_R = 1.5;

export function drawBrindleGrubSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
): void {
  if (isMoving) {
    drawSpriteKey(
      ctx,
      'brindle_grub',
      'walk',
      walkFrameIndex(walkFrame, GRUB_WALK_FRAME_COUNT),
      sx,
      sy,
      s,
    );
    return;
  }
  drawSpriteKey(ctx, 'brindle_grub', 'idle', 0, sx, sy, s);
}

export function drawCowTailedGrubSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
): void {
  if (isMoving) {
    drawSpriteKey(
      ctx,
      'cow_tailed_grub',
      'walk',
      walkFrameIndex(walkFrame, GRUB_WALK_FRAME_COUNT),
      sx,
      sy,
      s,
    );
    return;
  }
  drawSpriteKey(ctx, 'cow_tailed_grub', 'idle', 0, sx, sy, s);
}

export function drawBrindledVespaSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  _walkFrame = 0,
  _isMoving = false,
  facingX = 1,
): void {
  // Vespa uses separate left/right rows instead of flipX
  const state = facingX < 0 ? 'hover_left' : 'hover';
  drawSpriteKey(
    ctx,
    'brindled_vespa',
    state,
    timeFrameIndex(
      performance.now() / PERF_NOW_TO_SECONDS,
      VESPA_HOVER_FRAME_COUNT,
      VESPA_HOVER_FRAME_RATE,
    ),
    sx,
    sy,
    s,
  );
}

export function drawAcidSpit(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  hit: boolean,
): void {
  const t = performance.now() / PERF_NOW_TO_SECONDS;
  const pulse = 1 + Math.sin(t * SPIT_PULSE_FREQ) * SPIT_PULSE_AMPLITUDE;

  if (hit) {
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = '#a8e040';
    for (let i = 0; i < SPIT_HIT_SPLAT_COUNT; i++) {
      const a = (i / SPIT_HIT_SPLAT_COUNT) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(
        sx + Math.cos(a) * SPIT_HIT_ORBIT_RADIUS,
        sy + Math.sin(a) * SPIT_HIT_ORBIT_RADIUS,
        SPIT_HIT_BLOB_R,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  ctx.save();
  const outerR = SPIT_GLOW_RADIUS * pulse;
  const grd = ctx.createRadialGradient(sx, sy, 1, sx, sy, outerR);
  grd.addColorStop(0, 'rgba(180,240,60,0.55)');
  grd.addColorStop(1, 'rgba(80,180,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(sx, sy, outerR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#c8f050';
  ctx.beginPath();
  ctx.arc(sx, sy, (outerR / SPIT_CORE_RADIUS_DIVISOR) * pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,200,0.8)';
  ctx.beginPath();
  ctx.arc(
    sx - SPIT_HIGHLIGHT_OFFSET_X,
    sy - SPIT_HIGHLIGHT_OFFSET_Y,
    SPIT_HIGHLIGHT_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.restore();
}
