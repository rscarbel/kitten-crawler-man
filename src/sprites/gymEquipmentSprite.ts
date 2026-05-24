/**
 * Sprite functions for gym equipment items:
 *   - Dumbbell  (floor world, inventory icon, held-by-Juicer)
 *   - Bench press (floor world, inventory icon)
 *   - Treadmill   (floor world, inventory icon)
 */

const DUMBBELL_FLOOR_CX_OFFSET = 0.5;
const DUMBBELL_FLOOR_CY_OFFSET = 0.62;
const DUMBBELL_SHADOW_ELLIPSE_Y_OFFSET = 0.18;
const DUMBBELL_SHADOW_RX = 0.32;
const DUMBBELL_SHADOW_RY = 0.07;
const DUMBBELL_BAR_HALF_WIDTH = 0.3;
const DUMBBELL_BAR_HALF_HEIGHT = 0.045;
const DUMBBELL_BAR_HEIGHT = 0.09;
const DUMBBELL_PLATE_OUTER_RY = 0.17;
const DUMBBELL_PLATE_INNER_RY = 0.115;
const DUMBBELL_PLATE_INNER_RX = 0.055;
const DUMBBELL_PLATE_OUTER_RX = 0.09;
const DUMBBELL_PLATE_HOLE_R = 0.02;
const DUMBBELL_BAR_SHINE_HALF_W = 0.22;
const DUMBBELL_BAR_SHINE_OFFSET_Y = 0.04;
const DUMBBELL_BAR_SHINE_WIDTH = 0.44;
const DUMBBELL_BAR_SHINE_HEIGHT = 0.03;

const DUMBBELL_ICON_CX_OFFSET = 0.5;
const DUMBBELL_ICON_CY_OFFSET = 0.5;
const DUMBBELL_ICON_SHADOW_Y_OFFSET = 0.28;
const DUMBBELL_ICON_SHADOW_RX = 0.3;
const DUMBBELL_ICON_SHADOW_RY = 0.06;
const DUMBBELL_ICON_BAR_HALF = 0.3;
const DUMBBELL_ICON_BAR_HALF_H = 0.04;
const DUMBBELL_ICON_BAR_HEIGHT = 0.08;
const DUMBBELL_ICON_WEIGHT_X = 0.28;
const DUMBBELL_ICON_WEIGHT_OUTER_RX = 0.08;
const DUMBBELL_ICON_WEIGHT_OUTER_RY = 0.16;
const DUMBBELL_ICON_WEIGHT_INNER_RX = 0.05;
const DUMBBELL_ICON_WEIGHT_INNER_RY = 0.1;

const DUMBBELL_HELD_SWING_MIN = -0.8;
const DUMBBELL_HELD_SWING_RANGE = 1.6;
const DUMBBELL_HELD_BAR_HALF = 0.55;
const DUMBBELL_HELD_BAR_HALF_OFFSET = 0.5;
const DUMBBELL_HELD_BAR_H_HALF = 0.04;
const DUMBBELL_HELD_BAR_HEIGHT = 0.08;
const DUMBBELL_HELD_PLATE_X_FRAC = 0.47;
const DUMBBELL_HELD_PLATE_OUTER_RX = 0.07;
const DUMBBELL_HELD_PLATE_OUTER_RY = 0.14;
const DUMBBELL_HELD_PLATE_INNER_RX = 0.04;
const DUMBBELL_HELD_PLATE_INNER_RY = 0.09;

const BENCH_FLOOR_CX_OFFSET = 0.5;
const BENCH_FLOOR_CY_OFFSET = 0.55;
const BENCH_SHADOW_Y_OFFSET = 0.38;
const BENCH_SHADOW_RX = 0.65;
const BENCH_SHADOW_RY = 0.1;
const BENCH_LEG_WIDTH_FRAC = 0.08;
const BENCH_LEG_HEIGHT_FRAC = 0.2;
const BENCH_FRONT_LEG_Y_OFFSET = 0.12;
const BENCH_BACK_LEG_Y_OFFSET = 0.18;
const BENCH_BACK_LEG_HEIGHT_SCALE = 0.7;
const BENCH_FRONT_LEFT_X = 0.55;
const BENCH_FRONT_RIGHT_X = 0.47;
const BENCH_FRAME_BAR_X = 0.58;
const BENCH_FRAME_BAR_WIDTH = 1.16;
const BENCH_FRAME_BAR_HEIGHT = 0.12;
const BENCH_FRAME_SHINE_HEIGHT = 0.03;
const BENCH_UPRIGHT_X1 = 0.52;
const BENCH_UPRIGHT_X2 = 0.44;
const BENCH_UPRIGHT_WIDTH = 0.08;
const BENCH_UPRIGHT_HEIGHT = 0.62;
const BENCH_UPRIGHT_Y_OFFSET = 0.6;
const BENCH_JHOOK_X1 = 0.48;
const BENCH_JHOOK_X2 = 0.48;
const BENCH_JHOOK_Y_OFFSET = 0.6;
const BENCH_JHOOK_R = 0.07;
const BENCH_BARBELL_X = 0.8;
const BENCH_BARBELL_Y_OFFSET = 0.72;
const BENCH_BARBELL_WIDTH = 1.6;
const BENCH_BARBELL_HEIGHT = 0.1;
const BENCH_BARBELL_WEIGHT_Y_OFFSET = 0.67;
const BENCH_WEIGHT_OUTER_RX = 0.055;
const BENCH_WEIGHT_OUTER_RY = 0.13;
const BENCH_WEIGHT_INNER_RX = 0.03;
const BENCH_WEIGHT_INNER_RY = 0.08;
const BENCH_WEIGHT_OX1 = 0.72;
const BENCH_WEIGHT_OX2 = 0.62;
const BENCH_WEIGHT_OX3 = 0.54;
const BENCH_WEIGHT_OX4 = 0.64;
const BENCH_SEAT_X = 0.42;
const BENCH_SEAT_WIDTH = 0.84;
const BENCH_SEAT_HEIGHT = 0.22;
const BENCH_SEAT_RADIUS = 0.05;
const BENCH_SEAT_Y_OFFSET = 0.05;
const BENCH_SEAT_HIGHLIGHT_RX = 0.35;
const BENCH_SEAT_HIGHLIGHT_RY = 0.06;
const BENCH_SEAT_HIGHLIGHT_Y = 0.05;

const BENCH_ICON_CX_OFFSET = 0.5;
const BENCH_ICON_CY_OFFSET = 0.52;
const BENCH_ICON_FRAME_X = 0.45;
const BENCH_ICON_FRAME_H_OFFSET = 0.05;
const BENCH_ICON_FRAME_WIDTH = 0.9;
const BENCH_ICON_FRAME_HEIGHT = 0.1;
const BENCH_ICON_UPRIGHT_LEFT_X = 0.4;
const BENCH_ICON_UPRIGHT_RIGHT_X = 0.34;
const BENCH_ICON_UPRIGHT_Y = 0.45;
const BENCH_ICON_UPRIGHT_WIDTH = 0.06;
const BENCH_ICON_UPRIGHT_HEIGHT = 0.42;
const BENCH_ICON_BARBELL_X = 0.48;
const BENCH_ICON_BARBELL_Y = 0.45;
const BENCH_ICON_BARBELL_WIDTH = 0.96;
const BENCH_ICON_BARBELL_HEIGHT = 0.07;
const BENCH_ICON_WEIGHT_OX1 = 0.44;
const BENCH_ICON_WEIGHT_OX2 = 0.38;
const BENCH_ICON_WEIGHT_Y = 0.42;
const BENCH_ICON_WEIGHT_RX = 0.04;
const BENCH_ICON_WEIGHT_RY = 0.1;
const BENCH_ICON_SEAT_X = 0.32;
const BENCH_ICON_SEAT_Y = 0.05;
const BENCH_ICON_SEAT_WIDTH = 0.64;
const BENCH_ICON_SEAT_HEIGHT = 0.16;

const TREADMILL_FLOOR_CX_OFFSET = 0.5;
const TREADMILL_FLOOR_CY_OFFSET = 0.58;
const TREADMILL_SHADOW_Y_OFFSET = 0.35;
const TREADMILL_SHADOW_RX = 0.6;
const TREADMILL_SHADOW_RY = 0.1;
const TREADMILL_DECK_FRONT_X = 0.56;
const TREADMILL_DECK_BACK_X = 0.48;
const TREADMILL_DECK_FRONT_Y = 0.08;
const TREADMILL_DECK_BACK_Y = 0.15;
const TREADMILL_BELT_X = 0.44;
const TREADMILL_BELT_WIDTH = 0.88;
const TREADMILL_BELT_HEIGHT = 0.18;
const TREADMILL_BELT_TOP_Y = 0.13;
const TREADMILL_BELT_STRIPE_STEP = 0.12;
const TREADMILL_BELT_STRIPE_BOTTOM_Y = 0.05;
const TREADMILL_ROLLER_X = 0.44;
const TREADMILL_ROLLER_Y_OFFSET = 0.04;
const TREADMILL_ROLLER_R = 0.1;
const TREADMILL_LEG_X1 = 0.54;
const TREADMILL_LEG_X2 = 0.42;
const TREADMILL_LEG_Y = 0.08;
const TREADMILL_LEG_WIDTH = 0.12;
const TREADMILL_LEG_HEIGHT = 0.22;
const TREADMILL_HANDLEBAR_X = 0.28;
const TREADMILL_HANDLEBAR_BOTTOM_Y = 0.13;
const TREADMILL_HANDLEBAR_TOP_Y = 0.72;
const TREADMILL_HANDLEBAR_LINE_WIDTH = 0.07;
const TREADMILL_CROSSBAR_LINE_WIDTH = 0.06;
const TREADMILL_CONSOLE_X = 0.16;
const TREADMILL_CONSOLE_Y_OFFSET = 0.85;
const TREADMILL_CONSOLE_WIDTH = 0.32;
const TREADMILL_CONSOLE_HEIGHT = 0.18;
const TREADMILL_SCREEN_X = 0.12;
const TREADMILL_SCREEN_Y_OFFSET = 0.82;
const TREADMILL_SCREEN_WIDTH = 0.24;
const TREADMILL_SCREEN_HEIGHT = 0.12;
const TREADMILL_DISPLAY_X1 = 0.07;
const TREADMILL_DISPLAY_X2 = 0.03;
const TREADMILL_DISPLAY_Y = 0.79;
const TREADMILL_DISPLAY_WIDTH = 0.04;
const TREADMILL_DISPLAY_HEIGHT = 0.06;
const TREADMILL_BELT_STRIPE_RANGE = 3;

const TREADMILL_ICON_CX_OFFSET = 0.5;
const TREADMILL_ICON_CY_OFFSET = 0.58;
const TREADMILL_ICON_DECK_X = 0.4;
const TREADMILL_ICON_DECK_Y = 0.1;
const TREADMILL_ICON_DECK_WIDTH = 0.8;
const TREADMILL_ICON_DECK_HEIGHT = 0.18;
const TREADMILL_ICON_BELT_X = 0.35;
const TREADMILL_ICON_BELT_Y = 0.08;
const TREADMILL_ICON_BELT_WIDTH = 0.7;
const TREADMILL_ICON_BELT_HEIGHT = 0.14;
const TREADMILL_ICON_UPRIGHT_X = 0.22;
const TREADMILL_ICON_UPRIGHT_BOTTOM_Y = 0.1;
const TREADMILL_ICON_UPRIGHT_TOP_Y = 0.5;
const TREADMILL_ICON_LINE_WIDTH = 0.07;
const TREADMILL_ICON_SCREEN_X = 0.12;
const TREADMILL_ICON_SCREEN_Y = 0.62;
const TREADMILL_ICON_SCREEN_WIDTH = 0.24;
const TREADMILL_ICON_SCREEN_HEIGHT = 0.14;
const TREADMILL_ICON_DISPLAY_X = 0.08;
const TREADMILL_ICON_DISPLAY_Y = 0.59;
const TREADMILL_ICON_DISPLAY_WIDTH = 0.16;
const TREADMILL_ICON_DISPLAY_HEIGHT = 0.08;

export function drawDumbbellFloor(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  const cx = sx + s * DUMBBELL_FLOOR_CX_OFFSET;
  const cy = sy + s * DUMBBELL_FLOOR_CY_OFFSET;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + s * DUMBBELL_SHADOW_ELLIPSE_Y_OFFSET,
    s * DUMBBELL_SHADOW_RX,
    s * DUMBBELL_SHADOW_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Bar (horizontal rod)
  ctx.fillStyle = '#888';
  ctx.fillRect(
    cx - s * DUMBBELL_BAR_HALF_WIDTH,
    cy - s * DUMBBELL_BAR_HALF_HEIGHT,
    s * DUMBBELL_BAR_HALF_WIDTH * 2,
    s * DUMBBELL_BAR_HEIGHT,
  );

  // Left weight plate (outer)
  ctx.fillStyle = '#444';
  ctx.beginPath();
  ctx.ellipse(
    cx - s * DUMBBELL_BAR_HALF_WIDTH,
    cy,
    s * DUMBBELL_PLATE_OUTER_RX,
    s * DUMBBELL_PLATE_OUTER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Left weight plate (inner rim highlight)
  ctx.fillStyle = '#666';
  ctx.beginPath();
  ctx.ellipse(
    cx - s * DUMBBELL_BAR_HALF_WIDTH,
    cy,
    s * DUMBBELL_PLATE_INNER_RX,
    s * DUMBBELL_PLATE_INNER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Left weight plate hole
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(cx - s * DUMBBELL_BAR_HALF_WIDTH, cy, s * DUMBBELL_PLATE_HOLE_R, 0, Math.PI * 2);
  ctx.fill();

  // Right weight plate (outer)
  ctx.fillStyle = '#444';
  ctx.beginPath();
  ctx.ellipse(
    cx + s * DUMBBELL_BAR_HALF_WIDTH,
    cy,
    s * DUMBBELL_PLATE_OUTER_RX,
    s * DUMBBELL_PLATE_OUTER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Right weight plate (inner rim highlight)
  ctx.fillStyle = '#666';
  ctx.beginPath();
  ctx.ellipse(
    cx + s * DUMBBELL_BAR_HALF_WIDTH,
    cy,
    s * DUMBBELL_PLATE_INNER_RX,
    s * DUMBBELL_PLATE_INNER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Right weight plate hole
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(cx + s * DUMBBELL_BAR_HALF_WIDTH, cy, s * DUMBBELL_PLATE_HOLE_R, 0, Math.PI * 2);
  ctx.fill();

  // Bar shine
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(
    cx - s * DUMBBELL_BAR_SHINE_HALF_W,
    cy - s * DUMBBELL_BAR_SHINE_OFFSET_Y,
    s * DUMBBELL_BAR_SHINE_WIDTH,
    s * DUMBBELL_BAR_SHINE_HEIGHT,
  );
}

export function drawDumbbellInventoryIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size * DUMBBELL_ICON_CX_OFFSET;
  const cy = y + size * DUMBBELL_ICON_CY_OFFSET;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + size * DUMBBELL_ICON_SHADOW_Y_OFFSET,
    size * DUMBBELL_ICON_SHADOW_RX,
    size * DUMBBELL_ICON_SHADOW_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Bar
  ctx.fillStyle = '#999';
  ctx.fillRect(
    cx - size * DUMBBELL_ICON_BAR_HALF,
    cy - size * DUMBBELL_ICON_BAR_HALF_H,
    size * DUMBBELL_ICON_BAR_HALF * 2,
    size * DUMBBELL_ICON_BAR_HEIGHT,
  );

  // Left weight
  ctx.fillStyle = '#555';
  ctx.beginPath();
  ctx.ellipse(
    cx - size * DUMBBELL_ICON_WEIGHT_X,
    cy,
    size * DUMBBELL_ICON_WEIGHT_OUTER_RX,
    size * DUMBBELL_ICON_WEIGHT_OUTER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = '#777';
  ctx.beginPath();
  ctx.ellipse(
    cx - size * DUMBBELL_ICON_WEIGHT_X,
    cy,
    size * DUMBBELL_ICON_WEIGHT_INNER_RX,
    size * DUMBBELL_ICON_WEIGHT_INNER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Right weight
  ctx.fillStyle = '#555';
  ctx.beginPath();
  ctx.ellipse(
    cx + size * DUMBBELL_ICON_WEIGHT_X,
    cy,
    size * DUMBBELL_ICON_WEIGHT_OUTER_RX,
    size * DUMBBELL_ICON_WEIGHT_OUTER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = '#777';
  ctx.beginPath();
  ctx.ellipse(
    cx + size * DUMBBELL_ICON_WEIGHT_X,
    cy,
    size * DUMBBELL_ICON_WEIGHT_INNER_RX,
    size * DUMBBELL_ICON_WEIGHT_INNER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

/**
 * Dumbbell held by Juicer — rendered at hand position with throw-anim rotation.
 * `cx, cy` = world position of the hand. `throwAnim` 0→1 swings the arm forward.
 */
export function drawDumbbellHeld(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  throwAnim: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  // Rotate: pull back at 0, swing forward at 1
  const angle = DUMBBELL_HELD_SWING_MIN + throwAnim * DUMBBELL_HELD_SWING_RANGE;
  ctx.rotate(angle);

  const barLen = s * DUMBBELL_HELD_BAR_HALF;
  ctx.fillStyle = '#999';
  ctx.fillRect(
    -barLen * DUMBBELL_HELD_BAR_HALF_OFFSET,
    -s * DUMBBELL_HELD_BAR_H_HALF,
    barLen,
    s * DUMBBELL_HELD_BAR_HEIGHT,
  );

  // Plates
  for (const sign of [-1, 1]) {
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.ellipse(
      sign * barLen * DUMBBELL_HELD_PLATE_X_FRAC,
      0,
      s * DUMBBELL_HELD_PLATE_OUTER_RX,
      s * DUMBBELL_HELD_PLATE_OUTER_RY,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = '#666';
    ctx.beginPath();
    ctx.ellipse(
      sign * barLen * DUMBBELL_HELD_PLATE_X_FRAC,
      0,
      s * DUMBBELL_HELD_PLATE_INNER_RX,
      s * DUMBBELL_HELD_PLATE_INNER_RY,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.restore();
}

// Bench Press

export function drawBenchPressFloor(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  const cx = sx + s * BENCH_FLOOR_CX_OFFSET;
  const cy = sy + s * BENCH_FLOOR_CY_OFFSET;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + s * BENCH_SHADOW_Y_OFFSET,
    s * BENCH_SHADOW_RX,
    s * BENCH_SHADOW_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Base frame legs (4 contact points)
  ctx.fillStyle = '#3a3a3a';
  const legW = s * BENCH_LEG_WIDTH_FRAC;
  const legH = s * BENCH_LEG_HEIGHT_FRAC;
  // Front-left
  ctx.fillRect(cx - s * BENCH_FRONT_LEFT_X, cy + s * BENCH_FRONT_LEG_Y_OFFSET, legW, legH);
  // Front-right
  ctx.fillRect(cx + s * BENCH_FRONT_RIGHT_X, cy + s * BENCH_FRONT_LEG_Y_OFFSET, legW, legH);
  // Back-left
  ctx.fillRect(
    cx - s * BENCH_FRONT_LEFT_X,
    cy - s * BENCH_BACK_LEG_Y_OFFSET,
    legW,
    legH * BENCH_BACK_LEG_HEIGHT_SCALE,
  );
  // Back-right
  ctx.fillRect(
    cx + s * BENCH_FRONT_RIGHT_X,
    cy - s * BENCH_BACK_LEG_Y_OFFSET,
    legW,
    legH * BENCH_BACK_LEG_HEIGHT_SCALE,
  );

  // Main frame bar (horizontal)
  ctx.fillStyle = '#555';
  ctx.fillRect(
    cx - s * BENCH_FRAME_BAR_X,
    cy,
    s * BENCH_FRAME_BAR_WIDTH,
    s * BENCH_FRAME_BAR_HEIGHT,
  );
  // Frame shine
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(
    cx - s * BENCH_FRAME_BAR_X,
    cy,
    s * BENCH_FRAME_BAR_WIDTH,
    s * BENCH_FRAME_SHINE_HEIGHT,
  );

  // Upright supports (at one end for barbell rest)
  ctx.fillStyle = '#666';
  ctx.fillRect(
    cx - s * BENCH_UPRIGHT_X1,
    cy - s * BENCH_UPRIGHT_Y_OFFSET,
    s * BENCH_UPRIGHT_WIDTH,
    s * BENCH_UPRIGHT_HEIGHT,
  );
  ctx.fillRect(
    cx + s * BENCH_UPRIGHT_X2,
    cy - s * BENCH_UPRIGHT_Y_OFFSET,
    s * BENCH_UPRIGHT_WIDTH,
    s * BENCH_UPRIGHT_HEIGHT,
  );

  // Barbell rest (J-hooks)
  ctx.fillStyle = '#555';
  ctx.beginPath();
  ctx.arc(cx - s * BENCH_JHOOK_X1, cy - s * BENCH_JHOOK_Y_OFFSET, s * BENCH_JHOOK_R, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + s * BENCH_JHOOK_X2, cy - s * BENCH_JHOOK_Y_OFFSET, s * BENCH_JHOOK_R, Math.PI, 0);
  ctx.fill();

  // Barbell on rest
  ctx.fillStyle = '#888';
  ctx.fillRect(
    cx - s * BENCH_BARBELL_X,
    cy - s * BENCH_BARBELL_Y_OFFSET,
    s * BENCH_BARBELL_WIDTH,
    s * BENCH_BARBELL_HEIGHT,
  );
  // Weight plates on barbell
  for (const ox of [
    -s * BENCH_WEIGHT_OX1,
    -s * BENCH_WEIGHT_OX2,
    s * BENCH_WEIGHT_OX3,
    s * BENCH_WEIGHT_OX4,
  ]) {
    ctx.fillStyle = '#3a3a3a';
    ctx.beginPath();
    ctx.ellipse(
      cx + ox,
      cy - s * BENCH_BARBELL_WEIGHT_Y_OFFSET,
      s * BENCH_WEIGHT_OUTER_RX,
      s * BENCH_WEIGHT_OUTER_RY,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = '#5a5a5a';
    ctx.beginPath();
    ctx.ellipse(
      cx + ox,
      cy - s * BENCH_BARBELL_WEIGHT_Y_OFFSET,
      s * BENCH_WEIGHT_INNER_RX,
      s * BENCH_WEIGHT_INNER_RY,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Padded bench seat
  ctx.fillStyle = '#8B0000';
  ctx.beginPath();
  ctx.roundRect(
    cx - s * BENCH_SEAT_X,
    cy - s * BENCH_SEAT_Y_OFFSET,
    s * BENCH_SEAT_WIDTH,
    s * BENCH_SEAT_HEIGHT,
    s * BENCH_SEAT_RADIUS,
  );
  ctx.fill();
  // Padding highlight
  ctx.fillStyle = '#a00000';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + s * BENCH_SEAT_HIGHLIGHT_Y,
    s * BENCH_SEAT_HIGHLIGHT_RX,
    s * BENCH_SEAT_HIGHLIGHT_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

export function drawBenchPressInventoryIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size * BENCH_ICON_CX_OFFSET;
  const cy = y + size * BENCH_ICON_CY_OFFSET;

  // Frame
  ctx.fillStyle = '#555';
  ctx.fillRect(
    cx - size * BENCH_ICON_FRAME_X,
    cy - size * BENCH_ICON_FRAME_H_OFFSET,
    size * BENCH_ICON_FRAME_WIDTH,
    size * BENCH_ICON_FRAME_HEIGHT,
  );

  // Uprights
  ctx.fillStyle = '#666';
  ctx.fillRect(
    cx - size * BENCH_ICON_UPRIGHT_LEFT_X,
    cy - size * BENCH_ICON_UPRIGHT_Y,
    size * BENCH_ICON_UPRIGHT_WIDTH,
    size * BENCH_ICON_UPRIGHT_HEIGHT,
  );
  ctx.fillRect(
    cx + size * BENCH_ICON_UPRIGHT_RIGHT_X,
    cy - size * BENCH_ICON_UPRIGHT_Y,
    size * BENCH_ICON_UPRIGHT_WIDTH,
    size * BENCH_ICON_UPRIGHT_HEIGHT,
  );

  // Barbell
  ctx.fillStyle = '#888';
  ctx.fillRect(
    cx - size * BENCH_ICON_BARBELL_X,
    cy - size * BENCH_ICON_BARBELL_Y,
    size * BENCH_ICON_BARBELL_WIDTH,
    size * BENCH_ICON_BARBELL_HEIGHT,
  );

  // Weight plates
  for (const ox of [-size * BENCH_ICON_WEIGHT_OX1, size * BENCH_ICON_WEIGHT_OX2]) {
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.ellipse(
      cx + ox,
      cy - size * BENCH_ICON_WEIGHT_Y,
      size * BENCH_ICON_WEIGHT_RX,
      size * BENCH_ICON_WEIGHT_RY,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Seat
  ctx.fillStyle = '#8B0000';
  ctx.fillRect(
    cx - size * BENCH_ICON_SEAT_X,
    cy - size * BENCH_ICON_SEAT_Y,
    size * BENCH_ICON_SEAT_WIDTH,
    size * BENCH_ICON_SEAT_HEIGHT,
  );
}

// Treadmill

export function drawTreadmillFloor(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  const cx = sx + s * TREADMILL_FLOOR_CX_OFFSET;
  const cy = sy + s * TREADMILL_FLOOR_CY_OFFSET;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + s * TREADMILL_SHADOW_Y_OFFSET,
    s * TREADMILL_SHADOW_RX,
    s * TREADMILL_SHADOW_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Base frame / deck
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath();
  // Trapezoidal deck (slightly wider at front)
  ctx.moveTo(cx - s * TREADMILL_DECK_FRONT_X, cy + s * TREADMILL_DECK_FRONT_Y);
  ctx.lineTo(cx + s * TREADMILL_DECK_FRONT_X, cy + s * TREADMILL_DECK_FRONT_Y);
  ctx.lineTo(cx + s * TREADMILL_DECK_BACK_X, cy - s * TREADMILL_DECK_BACK_Y);
  ctx.lineTo(cx - s * TREADMILL_DECK_BACK_X, cy - s * TREADMILL_DECK_BACK_Y);
  ctx.closePath();
  ctx.fill();

  // Belt (dark rubber conveyor)
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(
    cx - s * TREADMILL_BELT_X,
    cy - s * TREADMILL_BELT_TOP_Y,
    s * TREADMILL_BELT_WIDTH,
    s * TREADMILL_BELT_HEIGHT,
  );
  // Belt stripes
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  for (let i = -TREADMILL_BELT_STRIPE_RANGE; i <= TREADMILL_BELT_STRIPE_RANGE; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * s * TREADMILL_BELT_STRIPE_STEP, cy - s * TREADMILL_BELT_TOP_Y);
    ctx.lineTo(cx + i * s * TREADMILL_BELT_STRIPE_STEP, cy + s * TREADMILL_BELT_STRIPE_BOTTOM_Y);
    ctx.stroke();
  }

  // Front roller (semicircle)
  ctx.fillStyle = '#444';
  ctx.beginPath();
  ctx.arc(
    cx + s * TREADMILL_ROLLER_X,
    cy - s * TREADMILL_ROLLER_Y_OFFSET,
    s * TREADMILL_ROLLER_R,
    -Math.PI / 2,
    Math.PI / 2,
  );
  ctx.fill();
  // Back roller
  ctx.beginPath();
  ctx.arc(
    cx - s * TREADMILL_ROLLER_X,
    cy - s * TREADMILL_ROLLER_Y_OFFSET,
    s * TREADMILL_ROLLER_R,
    Math.PI / 2,
    -Math.PI / 2,
  );
  ctx.fill();

  // Support legs
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(
    cx - s * TREADMILL_LEG_X1,
    cy + s * TREADMILL_LEG_Y,
    s * TREADMILL_LEG_WIDTH,
    s * TREADMILL_LEG_HEIGHT,
  );
  ctx.fillRect(
    cx + s * TREADMILL_LEG_X2,
    cy + s * TREADMILL_LEG_Y,
    s * TREADMILL_LEG_WIDTH,
    s * TREADMILL_LEG_HEIGHT,
  );

  // Handlebar uprights
  ctx.strokeStyle = '#666';
  ctx.lineWidth = s * TREADMILL_HANDLEBAR_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * TREADMILL_HANDLEBAR_X, cy - s * TREADMILL_HANDLEBAR_BOTTOM_Y);
  ctx.lineTo(cx - s * TREADMILL_HANDLEBAR_X, cy - s * TREADMILL_HANDLEBAR_TOP_Y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + s * TREADMILL_HANDLEBAR_X, cy - s * TREADMILL_HANDLEBAR_BOTTOM_Y);
  ctx.lineTo(cx + s * TREADMILL_HANDLEBAR_X, cy - s * TREADMILL_HANDLEBAR_TOP_Y);
  ctx.stroke();

  // Handlebar (horizontal crossbar)
  ctx.strokeStyle = '#777';
  ctx.lineWidth = s * TREADMILL_CROSSBAR_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(cx - s * TREADMILL_HANDLEBAR_X, cy - s * TREADMILL_HANDLEBAR_TOP_Y);
  ctx.lineTo(cx + s * TREADMILL_HANDLEBAR_X, cy - s * TREADMILL_HANDLEBAR_TOP_Y);
  ctx.stroke();

  // Console/screen (small rect at top)
  ctx.fillStyle = '#1a2a2a';
  ctx.fillRect(
    cx - s * TREADMILL_CONSOLE_X,
    cy - s * TREADMILL_CONSOLE_Y_OFFSET,
    s * TREADMILL_CONSOLE_WIDTH,
    s * TREADMILL_CONSOLE_HEIGHT,
  );
  // Screen glow
  ctx.fillStyle = '#0a4040';
  ctx.fillRect(
    cx - s * TREADMILL_SCREEN_X,
    cy - s * TREADMILL_SCREEN_Y_OFFSET,
    s * TREADMILL_SCREEN_WIDTH,
    s * TREADMILL_SCREEN_HEIGHT,
  );
  // Screen display (simple dots for numbers)
  ctx.fillStyle = '#00cc88';
  ctx.fillRect(
    cx - s * TREADMILL_DISPLAY_X1,
    cy - s * TREADMILL_DISPLAY_Y,
    s * TREADMILL_DISPLAY_WIDTH,
    s * TREADMILL_DISPLAY_HEIGHT,
  );
  ctx.fillRect(
    cx + s * TREADMILL_DISPLAY_X2,
    cy - s * TREADMILL_DISPLAY_Y,
    s * TREADMILL_DISPLAY_WIDTH,
    s * TREADMILL_DISPLAY_HEIGHT,
  );

  ctx.lineCap = 'butt';
}

export function drawTreadmillInventoryIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size * TREADMILL_ICON_CX_OFFSET;
  const cy = y + size * TREADMILL_ICON_CY_OFFSET;

  // Deck
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(
    cx - size * TREADMILL_ICON_DECK_X,
    cy - size * TREADMILL_ICON_DECK_Y,
    size * TREADMILL_ICON_DECK_WIDTH,
    size * TREADMILL_ICON_DECK_HEIGHT,
  );

  // Belt
  ctx.fillStyle = '#111';
  ctx.fillRect(
    cx - size * TREADMILL_ICON_BELT_X,
    cy - size * TREADMILL_ICON_BELT_Y,
    size * TREADMILL_ICON_BELT_WIDTH,
    size * TREADMILL_ICON_BELT_HEIGHT,
  );

  // Uprights
  ctx.strokeStyle = '#666';
  ctx.lineWidth = size * TREADMILL_ICON_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - size * TREADMILL_ICON_UPRIGHT_X, cy - size * TREADMILL_ICON_UPRIGHT_BOTTOM_Y);
  ctx.lineTo(cx - size * TREADMILL_ICON_UPRIGHT_X, cy - size * TREADMILL_ICON_UPRIGHT_TOP_Y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + size * TREADMILL_ICON_UPRIGHT_X, cy - size * TREADMILL_ICON_UPRIGHT_BOTTOM_Y);
  ctx.lineTo(cx + size * TREADMILL_ICON_UPRIGHT_X, cy - size * TREADMILL_ICON_UPRIGHT_TOP_Y);
  ctx.stroke();

  // Crossbar
  ctx.strokeStyle = '#777';
  ctx.beginPath();
  ctx.moveTo(cx - size * TREADMILL_ICON_UPRIGHT_X, cy - size * TREADMILL_ICON_UPRIGHT_TOP_Y);
  ctx.lineTo(cx + size * TREADMILL_ICON_UPRIGHT_X, cy - size * TREADMILL_ICON_UPRIGHT_TOP_Y);
  ctx.stroke();

  // Screen
  ctx.fillStyle = '#0a3a3a';
  ctx.fillRect(
    cx - size * TREADMILL_ICON_SCREEN_X,
    cy - size * TREADMILL_ICON_SCREEN_Y,
    size * TREADMILL_ICON_SCREEN_WIDTH,
    size * TREADMILL_ICON_SCREEN_HEIGHT,
  );
  ctx.fillStyle = '#00aa66';
  ctx.fillRect(
    cx - size * TREADMILL_ICON_DISPLAY_X,
    cy - size * TREADMILL_ICON_DISPLAY_Y,
    size * TREADMILL_ICON_DISPLAY_WIDTH,
    size * TREADMILL_ICON_DISPLAY_HEIGHT,
  );

  ctx.lineCap = 'butt';
}
