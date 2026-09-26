/**
 * Small procedural glyphs for Briar Hollow's processing stations, used both on
 * the minimap (a few pixels across) and on the far bobbing badge over each
 * machine in the world. Centred on `(cx, cy)` and sized by `radius` rather
 * than a top-left box, since both call sites already have a centre point to
 * hang the icon from.
 *
 * Kept apart from `resourceIcons.ts`: those paint the *item* a station
 * produces at inventory-slot scale, with soft shading that a saw blade's
 * spokes and a rope's coil need to shed to stay readable this small. A saw
 * blade in particular does not survive being reduced from a plank icon —
 * the sawmill needs its own glyph rather than reusing the boards art.
 */

const TWO_PI = Math.PI * 2;

const SAW_TEETH = 8;
/** Outer tooth tip as a fraction of `radius`; the inner scallop between teeth. */
const SAW_TOOTH_OUTER = 1;
const SAW_TOOTH_INNER = 0.72;
const SAW_CENTRE_HOLE_FRACTION = 0.32;
const SAW_BLADE_COLOR = '#c9c9c9';
const SAW_CENTRE_HOLE_COLOR = 'rgba(15, 15, 15, 0.9)';
const SAW_OUTLINE_COLOR = 'rgba(0, 0, 0, 0.85)';
/** Outline stroke width as a fraction of `radius`, floored so it never vanishes at minimap scale. */
const SAW_OUTLINE_WIDTH_FRACTION = 0.3;
const SAW_OUTLINE_WIDTH_MIN = 1.1;

/** A small circular saw blade: an outer ring of teeth around a dark arbor hole. */
export function drawSawBladeGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
): void {
  const points = SAW_TEETH * 2;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * TWO_PI;
    const r = radius * (i % 2 === 0 ? SAW_TOOTH_OUTER : SAW_TOOTH_INNER);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = SAW_OUTLINE_COLOR;
  ctx.lineWidth = Math.max(SAW_OUTLINE_WIDTH_MIN, radius * SAW_OUTLINE_WIDTH_FRACTION);
  ctx.stroke();
  ctx.fillStyle = SAW_BLADE_COLOR;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, radius * SAW_CENTRE_HOLE_FRACTION, 0, TWO_PI);
  ctx.fillStyle = SAW_CENTRE_HOLE_COLOR;
  ctx.fill();
  ctx.restore();
}

/** How far short of a full turn each coil arc stops, so the two loops read as an open coil rather than a closed ring. */
const ROPE_OUTER_ARC_TURNS = 1.65;
const ROPE_INNER_ARC_TURNS = 1.15;

/** Two nested open arcs, offset from each other, read as a coiled rope at any size. */
const ROPE_COIL_ARCS: ReadonlyArray<{
  readonly rFraction: number;
  readonly start: number;
  readonly end: number;
}> = [
  { rFraction: 0.85, start: 0.35, end: Math.PI * ROPE_OUTER_ARC_TURNS },
  { rFraction: 0.48, start: -0.55, end: Math.PI * ROPE_INNER_ARC_TURNS },
];
const ROPE_COLOR = '#b98a4a';
const ROPE_OUTLINE_COLOR = 'rgba(0, 0, 0, 0.85)';
const ROPE_OUTLINE_WIDTH_FRACTION = 0.55;
const ROPE_OUTLINE_WIDTH_MIN = 1.4;
const ROPE_LINE_WIDTH_FRACTION = 0.32;
const ROPE_LINE_WIDTH_MIN = 1;

/** A coiled loop of rope: two open arcs, dark outline underneath a warm rope-colour stroke. */
export function drawRopeCoilGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
): void {
  ctx.save();
  ctx.lineCap = 'round';

  ctx.strokeStyle = ROPE_OUTLINE_COLOR;
  ctx.lineWidth = Math.max(ROPE_OUTLINE_WIDTH_MIN, radius * ROPE_OUTLINE_WIDTH_FRACTION);
  for (const arc of ROPE_COIL_ARCS) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * arc.rFraction, arc.start, arc.end);
    ctx.stroke();
  }

  ctx.strokeStyle = ROPE_COLOR;
  ctx.lineWidth = Math.max(ROPE_LINE_WIDTH_MIN, radius * ROPE_LINE_WIDTH_FRACTION);
  for (const arc of ROPE_COIL_ARCS) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * arc.rFraction, arc.start, arc.end);
    ctx.stroke();
  }
  ctx.restore();
}
