/**
 * The two papers the Krasue murder mystery hands the party at the alley: the
 * magistrate's writ and the letter Mordecai calls necro-script. Drawn as a
 * matched pair that reads as opposites at a glance — one crisp and official,
 * one warm and wrong — since both sit in the bag at once and a player has to
 * tell them apart without reading a tooltip.
 */

// Shared page geometry, as fractions of the icon square.
const PAGE_X = 0.22;
const PAGE_Y = 0.14;
const PAGE_W = 0.56;
const PAGE_H = 0.72;

// ── Magistrate's Writ: a straight-edged page and a wax seal ──

const WRIT_PAGE_FILL = '#f3ead2';
const WRIT_PAGE_OUTLINE = '#3f3120';
const WRIT_PAGE_OUTLINE_WIDTH = 1.5;
const WRIT_LINE_COLOR = 'rgba(63,49,32,0.55)';
const WRIT_LINE_WIDTH = 1;
const WRIT_LINE_ROW_1 = 0.24;
const WRIT_LINE_ROW_2 = 0.34;
const WRIT_LINE_ROW_3 = 0.44;
const WRIT_LINE_ROW_4 = 0.54;
/** Text lines stop short of the seal rather than running under it. */
const WRIT_LINE_ROWS = [
  WRIT_LINE_ROW_1,
  WRIT_LINE_ROW_2,
  WRIT_LINE_ROW_3,
  WRIT_LINE_ROW_4,
] as const;
const WRIT_LINE_INSET = 0.1;
const WRIT_LAST_LINE_SHORTEN = 0.22;

const WRIT_SEAL_CX = 0.65;
const WRIT_SEAL_CY = 0.72;
const WRIT_SEAL_R = 0.16;
const WRIT_SEAL_FILL = '#8b1e2b';
const WRIT_SEAL_RIM = '#5c1019';
const WRIT_SEAL_RIM_WIDTH = 1.5;
/** The pressed cross a signet leaves — two strokes lighter than the wax around them. */
const WRIT_SEAL_CROSS_COLOR = 'rgba(0,0,0,0.35)';
const WRIT_SEAL_CROSS_WIDTH = 1.5;
const WRIT_SEAL_CROSS_REACH = 0.7;
const WRIT_SEAL_SHINE_COLOR = 'rgba(255,255,255,0.3)';
const WRIT_SEAL_SHINE_OFFSET = 0.4;
const WRIT_SEAL_SHINE_R = 0.28;

const FULL_CIRCLE = Math.PI * 2;

/** Draws Magistrate's Writ: a crisp cream page with a red wax seal. */
export function drawMagistratesWritIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const pageX = x + size * PAGE_X;
  const pageY = y + size * PAGE_Y;
  const pageW = size * PAGE_W;
  const pageH = size * PAGE_H;

  ctx.fillStyle = WRIT_PAGE_FILL;
  ctx.fillRect(pageX, pageY, pageW, pageH);
  ctx.strokeStyle = WRIT_PAGE_OUTLINE;
  ctx.lineWidth = WRIT_PAGE_OUTLINE_WIDTH;
  ctx.strokeRect(pageX, pageY, pageW, pageH);

  ctx.strokeStyle = WRIT_LINE_COLOR;
  ctx.lineWidth = WRIT_LINE_WIDTH;
  ctx.beginPath();
  for (let row = 0; row < WRIT_LINE_ROWS.length; row++) {
    const ly = y + size * WRIT_LINE_ROWS[row];
    const isLastLine = row === WRIT_LINE_ROWS.length - 1;
    const shorten = isLastLine ? WRIT_LAST_LINE_SHORTEN : 0;
    ctx.moveTo(pageX + size * WRIT_LINE_INSET, ly);
    ctx.lineTo(pageX + pageW - size * (WRIT_LINE_INSET + shorten), ly);
  }
  ctx.stroke();

  const sealCx = x + size * WRIT_SEAL_CX;
  const sealCy = y + size * WRIT_SEAL_CY;
  const sealR = size * WRIT_SEAL_R;

  ctx.fillStyle = WRIT_SEAL_FILL;
  ctx.beginPath();
  ctx.arc(sealCx, sealCy, sealR, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.strokeStyle = WRIT_SEAL_RIM;
  ctx.lineWidth = WRIT_SEAL_RIM_WIDTH;
  ctx.stroke();

  ctx.strokeStyle = WRIT_SEAL_CROSS_COLOR;
  ctx.lineWidth = WRIT_SEAL_CROSS_WIDTH;
  ctx.beginPath();
  ctx.moveTo(sealCx - sealR * WRIT_SEAL_CROSS_REACH, sealCy);
  ctx.lineTo(sealCx + sealR * WRIT_SEAL_CROSS_REACH, sealCy);
  ctx.moveTo(sealCx, sealCy - sealR * WRIT_SEAL_CROSS_REACH);
  ctx.lineTo(sealCx, sealCy + sealR * WRIT_SEAL_CROSS_REACH);
  ctx.stroke();

  ctx.fillStyle = WRIT_SEAL_SHINE_COLOR;
  ctx.beginPath();
  ctx.arc(
    sealCx - sealR * WRIT_SEAL_SHINE_OFFSET,
    sealCy - sealR * WRIT_SEAL_SHINE_OFFSET,
    sealR * WRIT_SEAL_SHINE_R,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();
}

// ── The Unreadable Letter: sickly ink on a warm page ──

const LETTER_PAGE_FILL = '#7a7440';
const LETTER_PAGE_OUTLINE = '#3a3418';
const LETTER_PAGE_OUTLINE_WIDTH = 1.5;
const LETTER_CURL_ROW_1 = 0.28;
const LETTER_CURL_ROW_2 = 0.42;
const LETTER_CURL_ROW_3 = 0.56;
const LETTER_CURL_ROW_4 = 0.7;
/** A crawling curl instead of the writ's straight rules — this page was never ruled. */
const LETTER_CURL_ROWS = [
  LETTER_CURL_ROW_1,
  LETTER_CURL_ROW_2,
  LETTER_CURL_ROW_3,
  LETTER_CURL_ROW_4,
] as const;
const LETTER_CURL_INSET = 0.09;
const LETTER_CURL_AMP = 3;
const LETTER_CURL_COLOR = '#2e2410';
const LETTER_CURL_WIDTH = 1.4;
/** Bezier control points as a fraction of the curl's own span, near end then far end. */
const LETTER_CURL_CONTROL_NEAR = 0.3;
const LETTER_CURL_CONTROL_FAR = 0.7;

/** A triangle dropped between two curl rows, per the clue's "squiggles and triangles". */
const LETTER_TRIANGLE_ROW = 1;
const LETTER_TRIANGLE_CX = 0.72;
const LETTER_TRIANGLE_SIZE = 0.09;
const LETTER_TRIANGLE_COLOR = '#2e2410';

/** The page is warm to the touch — a faint sick-orange glow bleeding through the paper. */
const LETTER_GLOW_COLOR = 'rgba(217,119,6,0.35)';
const LETTER_GLOW_BLUR = 5;

/** Draws The Unreadable Letter: warm, sickly parchment covered in necro-script. */
export function drawUnreadableLetterIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const pageX = x + size * PAGE_X;
  const pageY = y + size * PAGE_Y;
  const pageW = size * PAGE_W;
  const pageH = size * PAGE_H;

  ctx.save();
  ctx.shadowColor = LETTER_GLOW_COLOR;
  ctx.shadowBlur = LETTER_GLOW_BLUR;
  ctx.fillStyle = LETTER_PAGE_FILL;
  ctx.fillRect(pageX, pageY, pageW, pageH);
  ctx.restore();

  ctx.strokeStyle = LETTER_PAGE_OUTLINE;
  ctx.lineWidth = LETTER_PAGE_OUTLINE_WIDTH;
  ctx.strokeRect(pageX, pageY, pageW, pageH);

  ctx.strokeStyle = LETTER_CURL_COLOR;
  ctx.lineWidth = LETTER_CURL_WIDTH;
  ctx.beginPath();
  for (const row of LETTER_CURL_ROWS) {
    const ly = y + size * row;
    const startX = pageX + size * LETTER_CURL_INSET;
    const endX = pageX + pageW - size * LETTER_CURL_INSET;
    ctx.moveTo(startX, ly);
    ctx.bezierCurveTo(
      startX + (endX - startX) * LETTER_CURL_CONTROL_NEAR,
      ly - LETTER_CURL_AMP,
      startX + (endX - startX) * LETTER_CURL_CONTROL_FAR,
      ly + LETTER_CURL_AMP,
      endX,
      ly,
    );
  }
  ctx.stroke();

  const triY = y + size * LETTER_CURL_ROWS[LETTER_TRIANGLE_ROW];
  const triCx = x + size * LETTER_TRIANGLE_CX;
  const triR = size * LETTER_TRIANGLE_SIZE;
  ctx.fillStyle = LETTER_TRIANGLE_COLOR;
  ctx.beginPath();
  ctx.moveTo(triCx, triY - triR);
  ctx.lineTo(triCx + triR, triY + triR);
  ctx.lineTo(triCx - triR, triY + triR);
  ctx.closePath();
  ctx.fill();
}
