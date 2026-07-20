/** Figure proportions (fractions of tile size, centred coordinates). */
const CULTIST_HOOD_R = 0.15;
const CULTIST_HOOD_Y = -0.22;
const CULTIST_SHOULDER_HALF_WIDTH = 0.14;
const CULTIST_SHOULDER_Y = -0.08;
const CULTIST_ROBE_HEM_HALF_WIDTH = 0.19;
const CULTIST_ROBE_HEM_Y = 0.42;
/** Idle sway of the robe hem while walking. */
const CULTIST_ROBE_SWAY_AMP = 0.03;

/** Arms — sleeves that raise toward the target while casting. */
const CULTIST_ARM_WIDTH = 0.05;
const CULTIST_ARM_LENGTH = 0.2;
const CULTIST_ARM_REST_ANGLE = 0.35;
/** Casting swings the leading sleeve up to horizontal, pointing at the target. */
const CULTIST_CAST_POINT_ANGLE = 1.55;

/** Glowing eyes inside the hood shadow. */
const CULTIST_EYE_R = 0.022;
const CULTIST_EYE_X = 0.05;
const CULTIST_EYE_GLOW_RADIUS = 4;

/** Rope belt with a feather fetish. */
const CULTIST_BELT_Y = 0.12;
const CULTIST_FEATHER_LENGTH = 0.1;
const CULTIST_FEATHER_X = 0.08;

const ROBE_COLOR = '#3b2a52';
const ROBE_TRIM = '#5b4380';
const HOOD_SHADOW = '#170f24';
const EYE_COLOR = '#c4a5ff';
const BELT_COLOR = '#8a7a52';
const FEATHER_COLOR = '#e8e4d8';

/**
 * Draw a city elf cultist — a hooded figure in a violet robe, eyes glowing
 * under the cowl, a skyfowl feather fetish hanging from the rope belt. They
 * believe the skyfowl are angels; the murders are their tithe.
 *
 * @param castAnim 0–1 progress through the soul-bolt cast (0 = idle/walk).
 */
export function drawCityElfCultistSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  castAnim = 0,
  facingX = 1,
): void {
  const cx = sx + s / 2;
  const cy = sy + s / 2;

  ctx.save();
  ctx.translate(cx, cy);
  if (facingX < 0) ctx.scale(-1, 1);

  const swayPhase = isMoving ? Math.sin(walkFrame) : 0;
  const hemSway = swayPhase * CULTIST_ROBE_SWAY_AMP * s;
  const castEase = castAnim > 0 ? Math.sin(castAnim * Math.PI) : 0;

  // Robe — hooded silhouette flaring from the shoulders to the hem
  ctx.fillStyle = ROBE_COLOR;
  ctx.beginPath();
  ctx.moveTo(-CULTIST_SHOULDER_HALF_WIDTH * s, CULTIST_SHOULDER_Y * s);
  ctx.lineTo(CULTIST_SHOULDER_HALF_WIDTH * s, CULTIST_SHOULDER_Y * s);
  ctx.lineTo(CULTIST_ROBE_HEM_HALF_WIDTH * s + hemSway, CULTIST_ROBE_HEM_Y * s);
  ctx.lineTo(-CULTIST_ROBE_HEM_HALF_WIDTH * s + hemSway, CULTIST_ROBE_HEM_Y * s);
  ctx.closePath();
  ctx.fill();

  // Trim line down the robe front
  ctx.strokeStyle = ROBE_TRIM;
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.beginPath();
  ctx.moveTo(0, CULTIST_SHOULDER_Y * s);
  ctx.lineTo(hemSway, CULTIST_ROBE_HEM_Y * s);
  ctx.stroke();

  // Rope belt with a hanging skyfowl feather
  ctx.strokeStyle = BELT_COLOR;
  ctx.beginPath();
  ctx.moveTo(-CULTIST_SHOULDER_HALF_WIDTH * s, CULTIST_BELT_Y * s);
  ctx.lineTo(CULTIST_SHOULDER_HALF_WIDTH * s, CULTIST_BELT_Y * s);
  ctx.stroke();
  ctx.strokeStyle = FEATHER_COLOR;
  ctx.beginPath();
  ctx.moveTo(CULTIST_FEATHER_X * s, CULTIST_BELT_Y * s);
  ctx.quadraticCurveTo(
    CULTIST_FEATHER_X * s + s * 0.03,
    CULTIST_BELT_Y * s + CULTIST_FEATHER_LENGTH * s * 0.5,
    CULTIST_FEATHER_X * s,
    CULTIST_BELT_Y * s + CULTIST_FEATHER_LENGTH * s,
  );
  ctx.stroke();

  // Sleeves — the leading arm points at the target while casting
  ctx.strokeStyle = ROBE_COLOR;
  ctx.lineWidth = CULTIST_ARM_WIDTH * s;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const restAngle = side * CULTIST_ARM_REST_ANGLE;
    // Only the forward (facing) arm raises; measured from straight-down.
    const castAngle = side === 1 ? CULTIST_CAST_POINT_ANGLE : restAngle;
    const angle = restAngle + (castAngle - restAngle) * castEase;
    ctx.save();
    ctx.translate(side * CULTIST_SHOULDER_HALF_WIDTH * s * 0.8, CULTIST_SHOULDER_Y * s);
    ctx.rotate(angle * (side === 1 ? -1 : 1) * -1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, CULTIST_ARM_LENGTH * s);
    ctx.stroke();
    ctx.restore();
  }

  // Hood — a rounded cowl with a shadowed opening
  ctx.fillStyle = ROBE_COLOR;
  ctx.beginPath();
  ctx.arc(0, CULTIST_HOOD_Y * s, CULTIST_HOOD_R * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = HOOD_SHADOW;
  ctx.beginPath();
  ctx.arc(s * 0.015, CULTIST_HOOD_Y * s + s * 0.01, CULTIST_HOOD_R * s * 0.72, 0, Math.PI * 2);
  ctx.fill();

  // Glowing eyes in the hood shadow — brighter mid-cast
  ctx.save();
  ctx.shadowColor = EYE_COLOR;
  ctx.shadowBlur = CULTIST_EYE_GLOW_RADIUS + castEase * CULTIST_EYE_GLOW_RADIUS;
  ctx.fillStyle = EYE_COLOR;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * CULTIST_EYE_X * s, CULTIST_HOOD_Y * s, CULTIST_EYE_R * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.restore();
}
