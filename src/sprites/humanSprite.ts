import { drawSpriteKey, walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';

export type HumanAttackPhase = 'punch_side' | 'kick_side' | 'punch_up' | 'kick_down' | null;

// Horizontal walk cycle: walk_side[0], walk_side[1], walk_side[0], walk_side[2]
const WALK_SIDE_FRAMES = [
  { state: 'walk_side', frame: 0 },
  { state: 'walk_side', frame: 1 },
  { state: 'walk_side', frame: 0 },
  { state: 'walk_side', frame: 2 },
] as const;

// Forward walk cycle: idle, walk[0], walk[1], walk[0], idle, walk[2], walk[3], walk[2]
const WALK_FWD_FRAMES = [
  { state: 'idle', frame: 0 },
  { state: 'walk', frame: 0 },
  { state: 'walk', frame: 1 },
  { state: 'walk', frame: 0 },
  { state: 'idle', frame: 0 },
  { state: 'walk', frame: 2 },
  { state: 'walk', frame: 3 },
  { state: 'walk', frame: 2 },
] as const;

// Away walk cycle: idle_away, walk_away[0], walk_away[1], walk_away[0], idle_away, walk_away[2], walk_away[3], walk_away[2]
const WALK_AWAY_FRAMES = [
  { state: 'idle_away', frame: 0 },
  { state: 'walk_away', frame: 0 },
  { state: 'walk_away', frame: 1 },
  { state: 'walk_away', frame: 0 },
  { state: 'idle_away', frame: 0 },
  { state: 'walk_away', frame: 2 },
  { state: 'walk_away', frame: 3 },
  { state: 'walk_away', frame: 2 },
] as const;

// Punch-up sequence with reversal: idle_away, punch_up[0-4], punch_up[3-0]
const PUNCH_UP_FRAMES = [
  { state: 'idle_away', frame: 0 },
  { state: 'punch_up', frame: 0 },
  { state: 'punch_up', frame: 1 },
  { state: 'punch_up', frame: 2 },
  { state: 'punch_up', frame: 3 },
  { state: 'punch_up', frame: 4 },
  { state: 'punch_up', frame: 3 },
  { state: 'punch_up', frame: 2 },
  { state: 'punch_up', frame: 1 },
  { state: 'punch_up', frame: 0 },
] as const;

// Kick-down sequence: idle[0,0], then kick_down[0-7]
const KICK_DOWN_FRAMES = [
  { state: 'idle', frame: 0 },
  { state: 'kick_down', frame: 0 },
  { state: 'kick_down', frame: 1 },
  { state: 'kick_down', frame: 2 },
  { state: 'kick_down', frame: 3 },
  { state: 'kick_down', frame: 4 },
  { state: 'kick_down', frame: 5 },
  { state: 'kick_down', frame: 6 },
  { state: 'kick_down', frame: 7 },
] as const;

/**
 * Non-linear frame index for punch_side: frames 0–3 (wind-up) play at 2× speed,
 * occupying the first 1/3 of the animation; frames 4–7 (strike) play at normal
 * speed over the remaining 2/3.
 *
 * t in [0, 1/3]  → frame 0–3  (fast wind-up)
 * t in [1/3, 1]  → frame 4–7  (strike at normal pace)
 */
function punchSideFrameIndex(t: number): number {
  const FAST_END = 1 / 3;
  if (t < FAST_END) {
    return Math.min(3, Math.floor(t * 12));
  }
  return Math.min(7, 4 + Math.floor((t - FAST_END) * 6));
}

/**
 * Draw the complete human player sprite, including body, attack, and smush animations.
 * All animations are full-body frames from the single sprite sheet — no overlays.
 *
 * Priority (highest first): smush > attack > walk/idle.
 */
export function drawHumanSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  attackPhase: HumanAttackPhase,
  attackTimer: number,
  attackFrames: number,
  smushTimer: number,
  smushFrames: number,
  walkFrame = 0,
  isMoving = false,
  facingY = 0,
  facingX = 0,
): void {
  const flipX = facingX < 0;

  // Smush overrides all other animations
  if (smushTimer > 0) {
    const t = 1 - smushTimer / smushFrames;
    const frameIdx = progressFrameIndex(t, 11);
    if (frameIdx < 8) {
      drawSpriteKey(ctx, 'human', 'smush', frameIdx, sx, sy, s);
    } else {
      drawSpriteKey(ctx, 'human', 'smush_end', frameIdx - 8, sx, sy, s);
    }
    return;
  }

  // Active attack animation replaces walk/idle
  if (attackPhase !== null && attackTimer > 0) {
    const t = 1 - attackTimer / attackFrames;
    switch (attackPhase) {
      case 'punch_side': {
        drawSpriteKey(ctx, 'human', 'punch_side', punchSideFrameIndex(t), sx, sy, s, { flipX });
        return;
      }
      case 'kick_side': {
        const frame = progressFrameIndex(t, 4);
        drawSpriteKey(ctx, 'human', 'kick_side', frame, sx, sy, s, { flipX });
        return;
      }
      case 'punch_up': {
        const entry = PUNCH_UP_FRAMES[progressFrameIndex(t, PUNCH_UP_FRAMES.length)];
        drawSpriteKey(ctx, 'human', entry.state, entry.frame, sx, sy, s);
        return;
      }
      case 'kick_down': {
        const entry = KICK_DOWN_FRAMES[progressFrameIndex(t, KICK_DOWN_FRAMES.length)];
        drawSpriteKey(ctx, 'human', entry.state, entry.frame, sx, sy, s);
        return;
      }
    }
  }

  // Walking away from camera — 2× animation rate
  if (isMoving && facingY < -0.5) {
    const entry = WALK_AWAY_FRAMES[walkFrameIndex(walkFrame * 2, 8)];
    drawSpriteKey(ctx, 'human', entry.state, entry.frame, sx, sy, s);
    return;
  }

  // Walking sideways (horizontal component dominant) — 2× animation rate, flip for left
  if (isMoving && Math.abs(facingX) > 0.5) {
    const entry = WALK_SIDE_FRAMES[walkFrameIndex(walkFrame, WALK_SIDE_FRAMES.length)];
    drawSpriteKey(ctx, 'human', entry.state, entry.frame, sx, sy, s, { flipX });
    return;
  }

  // Walking toward camera — 2× animation rate
  if (isMoving) {
    const entry = WALK_FWD_FRAMES[walkFrameIndex(walkFrame * 2, 8)];
    drawSpriteKey(ctx, 'human', entry.state, entry.frame, sx, sy, s, { flipX });
    return;
  }

  // Idle
  if (facingY < -0.5) {
    drawSpriteKey(ctx, 'human', 'idle_away', 0, sx, sy, s);
  } else {
    drawSpriteKey(ctx, 'human', 'idle', 0, sx, sy, s, { flipX });
  }
}
