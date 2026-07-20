/** Figure proportions (fractions of tile size, centred coordinates). */
const QUILL_HEAD_R = 0.12;
const QUILL_HEAD_Y = -0.26;
const QUILL_BUN_R = 0.06;
const QUILL_BUN_Y_OFFSET = -0.13;
const QUILL_SHOULDER_HALF_WIDTH = 0.11;
const QUILL_SHOULDER_Y = -0.13;
const QUILL_WAIST_HALF_WIDTH = 0.07;
const QUILL_WAIST_Y = 0.04;
const QUILL_SKIRT_HEM_HALF_WIDTH = 0.17;
const QUILL_SKIRT_HEM_Y = 0.44;

/** High lace collar — the schoolteacher's one indulgence. */
const QUILL_COLLAR_HALF_WIDTH = 0.06;
const QUILL_COLLAR_HEIGHT = 0.05;

/** Spectacles. */
const QUILL_LENS_R = 0.035;
const QUILL_LENS_X = 0.045;
const QUILL_GLINT_SPEED = 1.3;

/** Arms. */
const QUILL_ARM_WIDTH = 0.035;
const QUILL_ARM_LENGTH = 0.2;
const QUILL_ARM_REST_ANGLE = 0.2;
const QUILL_CAST_RAISE_ANGLE = 2.2;

/** The floating quill pen orbiting her shoulder. */
const PEN_ORBIT_RX = 0.28;
const PEN_ORBIT_RY = 0.1;
const PEN_ORBIT_Y = -0.2;
const PEN_ORBIT_SPEED = 1.8;
const PEN_LENGTH = 0.16;

/** Soul-shield sheen while Remex keeps her invulnerable. */
const SHIELD_RX = 0.26;
const SHIELD_RY = 0.42;
const SHIELD_ALPHA_BASE = 0.16;
const SHIELD_ALPHA_PULSE = 0.08;
const SHIELD_PULSE_SPEED = 2.4;

const MS_PER_SECOND = 1000;

const SKIN_COLOR = '#e9d9c8';
const HAIR_COLOR = '#b8b4ac';
const DRESS_COLOR = '#2a2330';
const DRESS_TRIM = '#4a3f56';
const COLLAR_COLOR = '#efe9dc';
/** Spectacle lens tint (r, g, b) — alpha carries the animated glint. */
const LENS_TINT = '216, 236, 244';
const FRAME_COLOR = '#4a4038';
const PEN_COLOR = '#f5f0e0';
const SHIELD_COLOR = '150, 80, 255';

/**
 * Draw Miss Quill — the town's prim elf schoolteacher and the questline's
 * hidden necromancer: grey bun, spectacles, high-collared mourning dress,
 * and a floating quill pen that never stops taking notes.
 *
 * @param castAnim 0–1 progress through the cast gesture (0 = idle).
 * @param shielded true while Remex's soul shield keeps her invulnerable.
 */
export function drawMissQuillSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  castAnim = 0,
  shielded = false,
  facingX = 1,
): void {
  const cx = sx + s / 2;
  const cy = sy + s / 2;
  const timeSec = performance.now() / MS_PER_SECOND;

  ctx.save();
  ctx.translate(cx, cy);
  if (facingX < 0) ctx.scale(-1, 1);

  const castEase = castAnim > 0 ? Math.sin(castAnim * Math.PI) : 0;

  // Soul shield sheen — drawn first so the figure sits inside it
  if (shielded) {
    const pulse = SHIELD_ALPHA_BASE + Math.sin(timeSec * SHIELD_PULSE_SPEED) * SHIELD_ALPHA_PULSE;
    ctx.fillStyle = `rgba(${SHIELD_COLOR}, ${Math.max(0, pulse).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(0, s * 0.05, SHIELD_RX * s, SHIELD_RY * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Skirt — a stiff bell from waist to hem
  ctx.fillStyle = DRESS_COLOR;
  ctx.beginPath();
  ctx.moveTo(-QUILL_WAIST_HALF_WIDTH * s, QUILL_WAIST_Y * s);
  ctx.lineTo(QUILL_WAIST_HALF_WIDTH * s, QUILL_WAIST_Y * s);
  ctx.lineTo(QUILL_SKIRT_HEM_HALF_WIDTH * s, QUILL_SKIRT_HEM_Y * s);
  ctx.lineTo(-QUILL_SKIRT_HEM_HALF_WIDTH * s, QUILL_SKIRT_HEM_Y * s);
  ctx.closePath();
  ctx.fill();

  // Bodice
  ctx.fillStyle = DRESS_COLOR;
  ctx.beginPath();
  ctx.moveTo(-QUILL_SHOULDER_HALF_WIDTH * s, QUILL_SHOULDER_Y * s);
  ctx.lineTo(QUILL_SHOULDER_HALF_WIDTH * s, QUILL_SHOULDER_Y * s);
  ctx.lineTo(QUILL_WAIST_HALF_WIDTH * s, QUILL_WAIST_Y * s);
  ctx.lineTo(-QUILL_WAIST_HALF_WIDTH * s, QUILL_WAIST_Y * s);
  ctx.closePath();
  ctx.fill();

  // Button seam
  ctx.strokeStyle = DRESS_TRIM;
  ctx.lineWidth = Math.max(1, s * 0.015);
  ctx.beginPath();
  ctx.moveTo(0, QUILL_SHOULDER_Y * s);
  ctx.lineTo(0, QUILL_SKIRT_HEM_Y * s);
  ctx.stroke();

  // Arms — both rise while casting
  ctx.strokeStyle = DRESS_COLOR;
  ctx.lineWidth = QUILL_ARM_WIDTH * s;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const restAngle = side * QUILL_ARM_REST_ANGLE;
    const raisedAngle = side * QUILL_CAST_RAISE_ANGLE;
    const angle = restAngle + (raisedAngle - restAngle) * castEase;
    ctx.save();
    ctx.translate(side * QUILL_SHOULDER_HALF_WIDTH * s * 0.9, QUILL_SHOULDER_Y * s);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, QUILL_ARM_LENGTH * s);
    ctx.stroke();
    ctx.restore();
  }

  // High lace collar
  ctx.fillStyle = COLLAR_COLOR;
  ctx.fillRect(
    -QUILL_COLLAR_HALF_WIDTH * s,
    QUILL_SHOULDER_Y * s - QUILL_COLLAR_HEIGHT * s,
    QUILL_COLLAR_HALF_WIDTH * s * 2,
    QUILL_COLLAR_HEIGHT * s,
  );

  // Head
  const headY = QUILL_HEAD_Y * s;
  ctx.fillStyle = SKIN_COLOR;
  ctx.beginPath();
  ctx.arc(0, headY, QUILL_HEAD_R * s, 0, Math.PI * 2);
  ctx.fill();

  // Grey hair pulled into a tight bun
  ctx.fillStyle = HAIR_COLOR;
  ctx.beginPath();
  ctx.arc(0, headY, QUILL_HEAD_R * s, Math.PI * 1.1, Math.PI * 1.9);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, headY + QUILL_BUN_Y_OFFSET * s, QUILL_BUN_R * s, 0, Math.PI * 2);
  ctx.fill();

  // Spectacles — lenses glint on a cycle
  const glint = 0.6 + 0.4 * Math.sin(timeSec * QUILL_GLINT_SPEED);
  ctx.strokeStyle = FRAME_COLOR;
  ctx.lineWidth = Math.max(1, s * 0.012);
  ctx.fillStyle = `rgba(${LENS_TINT}, ${glint.toFixed(3)})`;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * QUILL_LENS_X * s, headY, QUILL_LENS_R * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-QUILL_LENS_X * s + QUILL_LENS_R * s, headY);
  ctx.lineTo(QUILL_LENS_X * s - QUILL_LENS_R * s, headY);
  ctx.stroke();

  // The floating quill pen, orbiting and scribbling
  const orbit = timeSec * PEN_ORBIT_SPEED;
  const penX = Math.cos(orbit) * PEN_ORBIT_RX * s;
  const penY = PEN_ORBIT_Y * s + Math.sin(orbit) * PEN_ORBIT_RY * s;
  ctx.save();
  ctx.translate(penX, penY);
  ctx.rotate(Math.sin(orbit) * 0.4 - 0.6);
  ctx.strokeStyle = PEN_COLOR;
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -PEN_LENGTH * s);
  ctx.stroke();
  ctx.fillStyle = PEN_COLOR;
  ctx.beginPath();
  ctx.moveTo(0, -PEN_LENGTH * s);
  ctx.lineTo(-s * 0.025, -PEN_LENGTH * s * 0.6);
  ctx.lineTo(s * 0.025, -PEN_LENGTH * s * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}
