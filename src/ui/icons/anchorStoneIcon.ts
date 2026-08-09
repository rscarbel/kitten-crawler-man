/**
 * The Wayfinder's Anchor and the shards it is welded from.
 *
 * Two drawings, not four: the three shards differ only in which townsperson
 * parted with them, and a player reads "broken piece of the same stone" off the
 * silhouette long before they read a tint. The whole stone earns its own art
 * because it is the thing the errand is for — it is rounder, warmer, and lit
 * from inside, so a full hotbar never leaves you wondering whether you finished.
 */

// Geometry as fractions of the icon square.
const STONE_CX = 0.5;
const STONE_CY = 0.54;
const STONE_RX = 0.31;
const STONE_RY = 0.34;
/** Even, so the crown can take every other vertex and still close. */
const STONE_VERTEX_COUNT = 10;
/**
 * The rim radius wobbles by two sine terms whose steps do not divide the ring,
 * so no dent repeats and the outline never settles back into an ellipse. The
 * combined swing is deliberately narrow — the assembled stone has to read as
 * whole beside the shard's deep notches, so it wants dents and corners, not
 * spikes.
 */
const WOBBLE_PRIMARY_AMPLITUDE = 0.085;
const WOBBLE_PRIMARY_STEP = 2.4;
const WOBBLE_SECONDARY_AMPLITUDE = 0.05;
const WOBBLE_SECONDARY_STEP = 1.1;
const WOBBLE_PHASE = 0.7;
/** Turns the widest facet off vertical, so the stone does not read as a gem. */
const STONE_ROTATION = -0.35;

/**
 * The crown is the flat top plane a rounded rock wears where it has been worn
 * down; the side facets fall away from its edges to the silhouette. Its centre
 * sits up and left of the stone's so the planes face the light unevenly.
 */
const CROWN_CX_OFFSET = -0.05;
const CROWN_CY_OFFSET = -0.07;
/** Fraction of the way from the crown centre out to the silhouette vertex. */
const CROWN_INSET = 0.44;
/** Each side facet spans two rim edges, so the crown takes every other vertex. */
const RIM_VERTICES_PER_FACET = 2;

/**
 * Facet shading is angular, not painted: a plane's tone is picked by how far it
 * faces from the light, so the six planes stay consistent if the ring changes.
 * Up and to the left, in canvas coordinates where y grows downward.
 */
const LIGHT_ANGLE = -2.1;
const HALF_TURN = Math.PI;

/** The rune: a stem with two arms and a foot — a compass needle, read small. */
const RUNE_STEM_TOP = 0.32;
const RUNE_STEM_BOTTOM = 0.74;
const RUNE_ARM_Y = 0.44;
const RUNE_ARM_SPREAD = 0.13;
const RUNE_ARM_DROP = 0.09;
const RUNE_FOOT_SPREAD = 0.08;
const RUNE_WIDTH = 1.6;
const RUNE_GLOW_BLUR = 6;

/** The shine is a sliver of the crown, shrunk toward the crown's lit corner. */
const HIGHLIGHT_SCALE = 0.55;

const OUTLINE_WIDTH = 1.5;
const SEAM_WIDTH = 1;
const FULL_CIRCLE = Math.PI * 2;

/**
 * Light to dark. Five steps rather than a smooth ramp: at hotbar size a subtle
 * gradient between planes collapses into one grey blob, so each facet has to
 * land on a tone a reader can tell from its neighbour's.
 */
const STONE_TONES = ['#6d798c', '#5c6678', '#4b5563', '#3e4655', '#334155'] as const;
const STONE_CROWN_TONE = '#66718a';
const STONE_OUTLINE = '#1e293b';
const STONE_SEAM = 'rgba(30,41,59,0.5)';
const STONE_HIGHLIGHT = 'rgba(226,232,240,0.55)';
const RUNE_COLOR = '#5eead4';

/**
 * The shard is generated rather than listed: a ring of vertices alternating
 * between a far radius and a near one, which is what a chipped lump of stone
 * looks like in silhouette. Listing the corners by hand would be a dozen bare
 * decimals whose only meaning is "a corner goes here".
 */
const SHARD_CX = 0.5;
const SHARD_CY = 0.52;
const SHARD_OUTER_R = 0.33;
const SHARD_INNER_R = 0.22;
/** Even, so the ring closes on an outer point rather than doubling a facet. */
const SHARD_VERTEX_COUNT = 8;
/** Turns the widest facet off vertical, so the piece does not read as a gem. */
const SHARD_ROTATION = -0.45;
/** Radial pull of the seam's midpoint, drawn from the top vertex to the bottom. */
const SHARD_SEAM_BOW = 0.09;
const SHARD_FILL = '#57606f';
const SHARD_SHADE = '#3b4453';
const SHARD_OUTLINE = '#1e293b';
/** A single spark of the rune survives on each piece — the only warm note. */
const SHARD_SPARK_X = 0.58;
const SHARD_SPARK_Y = 0.46;
const SHARD_SPARK_R = 0.05;
const SHARD_SPARK_COLOR = 'rgba(94,234,212,0.75)';

/** Draws the assembled Wayfinder's Anchor into a square icon region. */
export function drawAnchorStoneIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size * STONE_CX;
  const cy = y + size * STONE_CY;
  const rx = size * STONE_RX;
  const ry = size * STONE_RY;
  const crownCx = cx + size * CROWN_CX_OFFSET;
  const crownCy = cy + size * CROWN_CY_OFFSET;

  const angleAt = (index: number): number =>
    STONE_ROTATION + (index / STONE_VERTEX_COUNT) * FULL_CIRCLE;

  const rimVertexAt = (index: number): readonly [number, number] => {
    const wrapped = index % STONE_VERTEX_COUNT;
    const angle = angleAt(wrapped);
    const wobble =
      1 +
      Math.sin(wrapped * WOBBLE_PRIMARY_STEP + WOBBLE_PHASE) * WOBBLE_PRIMARY_AMPLITUDE +
      Math.sin(wrapped * WOBBLE_SECONDARY_STEP) * WOBBLE_SECONDARY_AMPLITUDE;
    return [cx + Math.cos(angle) * rx * wobble, cy + Math.sin(angle) * ry * wobble];
  };

  const crownVertexAt = (index: number): readonly [number, number] => {
    const [rimX, rimY] = rimVertexAt(index * RIM_VERTICES_PER_FACET);
    return [crownCx + (rimX - crownCx) * CROWN_INSET, crownCy + (rimY - crownCy) * CROWN_INSET];
  };

  const crownVertexCount = STONE_VERTEX_COUNT / RIM_VERTICES_PER_FACET;

  /** 0 where a plane faces straight into the light, 1 where it faces fully away. */
  const litness = (angle: number): number => {
    const raw = Math.abs(angle - LIGHT_ANGLE) % FULL_CIRCLE;
    const shortest = raw > HALF_TURN ? FULL_CIRCLE - raw : raw;
    return shortest / HALF_TURN;
  };

  const traceRim = (): void => {
    ctx.beginPath();
    for (let index = 0; index < STONE_VERTEX_COUNT; index++) {
      const [vx, vy] = rimVertexAt(index);
      if (index === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
  };

  // Each side facet is the quad between one crown edge and the two rim edges
  // below it, so the planes tile the whole silhouette with no gaps to fill first.
  for (let facet = 0; facet < crownVertexCount; facet++) {
    const [startX, startY] = crownVertexAt(facet);
    const [endX, endY] = crownVertexAt((facet + 1) % crownVertexCount);
    const firstRimIndex = facet * RIM_VERTICES_PER_FACET;
    const facingAngle = angleAt(firstRimIndex + 1);
    const toneIndex = Math.round(litness(facingAngle) * (STONE_TONES.length - 1));

    ctx.fillStyle = STONE_TONES[toneIndex] ?? STONE_TONES[STONE_TONES.length - 1];
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    for (let step = 0; step <= RIM_VERTICES_PER_FACET; step++) {
      const [vx, vy] = rimVertexAt(firstRimIndex + step);
      ctx.lineTo(vx, vy);
    }
    ctx.lineTo(endX, endY);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = STONE_CROWN_TONE;
  ctx.strokeStyle = STONE_SEAM;
  ctx.lineWidth = SEAM_WIDTH;
  ctx.beginPath();
  for (let index = 0; index < crownVertexCount; index++) {
    const [vx, vy] = crownVertexAt(index);
    if (index === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = STONE_OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  traceRim();
  ctx.stroke();

  ctx.save();
  ctx.strokeStyle = RUNE_COLOR;
  ctx.lineWidth = RUNE_WIDTH;
  ctx.shadowColor = RUNE_COLOR;
  ctx.shadowBlur = RUNE_GLOW_BLUR;
  ctx.beginPath();
  ctx.moveTo(cx, y + size * RUNE_STEM_TOP);
  ctx.lineTo(cx, y + size * RUNE_STEM_BOTTOM);
  ctx.moveTo(cx - size * RUNE_ARM_SPREAD, y + size * (RUNE_ARM_Y + RUNE_ARM_DROP));
  ctx.lineTo(cx, y + size * RUNE_ARM_Y);
  ctx.lineTo(cx + size * RUNE_ARM_SPREAD, y + size * (RUNE_ARM_Y + RUNE_ARM_DROP));
  ctx.moveTo(cx - size * RUNE_FOOT_SPREAD, y + size * RUNE_STEM_BOTTOM);
  ctx.lineTo(cx + size * RUNE_FOOT_SPREAD, y + size * RUNE_STEM_BOTTOM);
  ctx.stroke();
  ctx.restore();

  // The shine is a shrunken slice of the crown around whichever of its corners
  // points nearest the light, so it lands flat on the plane instead of floating.
  let litCorner = 0;
  for (let index = 1; index < crownVertexCount; index++) {
    const facesLightBetter =
      litness(angleAt(index * RIM_VERTICES_PER_FACET)) <
      litness(angleAt(litCorner * RIM_VERTICES_PER_FACET));
    if (facesLightBetter) litCorner = index;
  }

  ctx.fillStyle = STONE_HIGHLIGHT;
  ctx.beginPath();
  for (let step = -1; step <= 1; step++) {
    const corner = (litCorner + step + crownVertexCount) % crownVertexCount;
    const [vx, vy] = crownVertexAt(corner);
    const hx = crownCx + (vx - crownCx) * HIGHLIGHT_SCALE;
    const hy = crownCy + (vy - crownCy) * HIGHLIGHT_SCALE;
    if (step === -1) ctx.moveTo(hx, hy);
    else ctx.lineTo(hx, hy);
  }
  ctx.closePath();
  ctx.fill();
}

/** Draws one broken shard. Shared by all three — they are the same stone. */
export function drawAnchorShardIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size * SHARD_CX;
  const cy = y + size * SHARD_CY;
  const vertexAt = (index: number): readonly [number, number] => {
    const angle = SHARD_ROTATION + (index / SHARD_VERTEX_COUNT) * FULL_CIRCLE;
    const radius = size * (index % 2 === 0 ? SHARD_OUTER_R : SHARD_INNER_R);
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  };

  ctx.fillStyle = SHARD_FILL;
  ctx.beginPath();
  for (let index = 0; index < SHARD_VERTEX_COUNT; index++) {
    const [vx, vy] = vertexAt(index);
    if (index === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = SHARD_OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();

  // The fracture: a bowed line across the face, so the piece reads as broken
  // off something rather than carved.
  const [topX, topY] = vertexAt(0);
  const [bottomX, bottomY] = vertexAt(SHARD_VERTEX_COUNT / 2);
  ctx.strokeStyle = SHARD_SHADE;
  ctx.beginPath();
  ctx.moveTo(topX, topY);
  ctx.quadraticCurveTo(cx + size * SHARD_SEAM_BOW, cy, bottomX, bottomY);
  ctx.stroke();

  ctx.fillStyle = SHARD_SPARK_COLOR;
  ctx.beginPath();
  ctx.arc(x + size * SHARD_SPARK_X, y + size * SHARD_SPARK_Y, size * SHARD_SPARK_R, 0, FULL_CIRCLE);
  ctx.fill();
}
