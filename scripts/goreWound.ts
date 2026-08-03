/**
 * The wound engine: one severed-flesh cut face, shared by every creature that
 * comes apart into body parts.
 *
 * It lives on its own rather than inside any one creature's gore module because
 * a cut is a cut. What differs between a rat, a goblin and a llama is the hide
 * at the margin of the wound and the shape of the piece around it — both of
 * which the caller supplies — not the muscle, the fat, the artery or the bone.
 *
 * Two runtime constraints shape every decision here:
 *
 * 1. **Pieces spin continuously.** `BodyPartGoreSystem` tumbles every part, so
 *    no lighting cue may depend on the piece's orientation. Everything is lit
 *    ambiently, and blood runs away from the wound rather than downward.
 * 2. **Pieces render at 0.5x.** `TILE_SIZE / tileScale` is 32/64, so a detail
 *    drawn 6 px across shows at 3. Everything is exaggerated on purpose.
 *
 * All drawing is in tile units with the origin at the centre of the piece's own
 * cell. The runtime pivots on the frame's *measured ink centre* rather than on
 * that origin (see `drawSpriteRotatedCenter`), so a piece painted off-centre
 * still tumbles in place — centring is for legibility and consistent cell
 * sizing, not a correctness requirement.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import { TWO_PI, deg, lerp, mix, rgba, type Pt } from './ratArt';

// ── Wound palette ────────────────────────────────────────────────────────────

/** Cut muscle: a rat's is paler and pinker than a goblin's, and it matters. */
export const MUSCLE_SHADOW = '#3a0d10';
export const MUSCLE_DARK = '#68161b';
export const MUSCLE_MID = '#9c262b';
export const MUSCLE_LIGHT = '#c4494a';
/** The fat layer just under the skin — a small band that does a lot of work. */
export const SUBCUTANEOUS = '#cbb87e';
export const ARTERY_RED = '#e4423a';
export const BLOOD = '#710d13';
export const BLOOD_DARK = '#2e0508';
export const BLOOD_GLOSS = 'rgba(255,190,180,0.5)';
export const BONE_CORTICAL = '#efe6cf';
export const BONE_SHADOW = '#a89a7c';
export const MARROW = '#a8544e';

/** Ambient fill every piece receives regardless of how it is tumbling. */
export const AMBIENT_ALPHA = 0.24;
export const RIM_ALPHA = 0.32;

/** Deterministic stream so a re-bake produces byte-identical art. */
export function seededNoise(seed: number): () => number {
  const MULTIPLIER = 1664525;
  const INCREMENT = 1013904223;
  const MODULUS = 4294967296;
  let state = Math.floor(seed) % MODULUS;
  return () => {
    state = (state * MULTIPLIER + INCREMENT) % MODULUS;
    return state / MODULUS;
  };
}

/** The near-black the everted skin margin is outlined against. */
const WOUND_RIM_INK = '#17120e';

// ── Cut specification ────────────────────────────────────────────────────────

/** How the part came off. Spread across the set so no two wounds look stamped. */
export type CutKind = 'clean' | 'crushed' | 'torn';

export interface BoneSpec {
  /** Offset from the wound centre, in wound-local units where 1 is its radius. */
  readonly at: Pt;
  /** Bone diameter, as a fraction of the wound's radius. */
  readonly size: number;
  /** A ring rather than a disc — a vertebra or a sawn rib. */
  readonly hollow?: boolean;
}

export interface CutSpec {
  readonly kind: CutKind;
  /** Centre of the wound face, in cell-local tile units. */
  readonly centre: Pt;
  /** Radius of the wound face along its long axis, in tile units. */
  readonly radius: number;
  /** Foreshortening of the face; 1 is a cut seen square on. */
  readonly squash: number;
  readonly angle: number;
  readonly bones: readonly BoneSpec[];
  /**
   * Direction, in cell-local radians, that blood runs from this wound. It has to
   * point away from the piece: drips fired radially in every direction draw a
   * red starburst, and the severed part then reads as a spider.
   */
  readonly runAngle: number;
  readonly seed: number;
  /**
   * The creature's own darkest hide tone, painted as the everted skin margin.
   * Required rather than defaulted: a wound ringed in some other animal's
   * colour is the one part of this engine that cannot be shared, and a default
   * would make getting it wrong silent.
   */
  readonly hide: string;
}

const SKIN_LOBE_MIN = 5;
const SKIN_LOBE_MAX = 8;
/** Bone diameter as a fraction of the wound's, once a piece's own scale applies. */
const BONE_OF_WOUND = 1.5;
const CORTICAL_FRACTION = 0.3;
const STRIATION_MIN = 3;
const STRIATION_MAX = 5;
const DRIP_MIN = 3;
const DRIP_MAX = 5;
const TAG_MIN = 2;
const TAG_MAX = 4;
const SPATTER_COUNT = 5;

export function pick(noise: () => number, min: number, max: number): number {
  return Math.round(lerp(min, max, noise()));
}

/**
 * Paint one wound, outward in. Every piece routes its cut through here so all
 * eight wounds on a corpse are recognisably the same injury seen on different
 * parts.
 */
export function drawWound(ctx: Ctx, cut: CutSpec): void {
  const noise = seededNoise(cut.seed);
  const r = cut.radius;

  ctx.save();
  ctx.translate(cut.centre.x, cut.centre.y);
  ctx.rotate(cut.angle);
  ctx.scale(1, cut.squash);

  // 1. Torn skin margin — irregular everted lobes, never a smooth ellipse. The
  // lobe count and their raggedness are what separate the three cut kinds.
  const lobes = pick(noise, SKIN_LOBE_MIN, SKIN_LOBE_MAX);
  const ragged = cut.kind === 'clean' ? 0.08 : cut.kind === 'crushed' ? 0.3 : 0.4;
  const lobeRadii: number[] = [];
  for (let i = 0; i < lobes; i++) lobeRadii.push(r * (1 + (noise() - 0.5) * 2 * ragged));

  const traceLobes = (scale: number): void => {
    ctx.beginPath();
    for (let i = 0; i <= lobes; i++) {
      const index = i % lobes;
      const angle = (index / lobes) * TWO_PI;
      const radius = lobeRadii[index] * scale;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else {
        const previous = lobeRadii[(index - 1 + lobes) % lobes] * scale;
        const midAngle = angle - TWO_PI / (lobes * 2);
        const midRadius = ((radius + previous) / 2) * 1.12;
        ctx.quadraticCurveTo(Math.cos(midAngle) * midRadius, Math.sin(midAngle) * midRadius, x, y);
      }
    }
    ctx.closePath();
  };

  ctx.fillStyle = WOUND_RIM_INK;
  traceLobes(1.15);
  ctx.fill();
  ctx.fillStyle = cut.hide;
  traceLobes(1.05);
  ctx.fill();

  // 2. Subcutaneous band — the single thing that separates "cut flesh" from
  // "coloured hole". Two pixels wide in game, and worth every one of them.
  ctx.fillStyle = SUBCUTANEOUS;
  traceLobes(0.93);
  ctx.fill();

  // 3. Muscle field with striations radiating from the bone.
  ctx.fillStyle = MUSCLE_DARK;
  traceLobes(0.83);
  ctx.fill();

  ctx.save();
  traceLobes(0.83);
  ctx.clip();

  ctx.fillStyle = MUSCLE_MID;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.76, r * 0.76, 0, 0, TWO_PI);
  ctx.fill();

  const striations = pick(noise, STRIATION_MIN, STRIATION_MAX);
  ctx.strokeStyle = rgba(MUSCLE_LIGHT, 0.7);
  ctx.lineWidth = r * 0.1;
  ctx.lineCap = 'round';
  for (let i = 0; i < striations; i++) {
    const angle = (i / striations) * TWO_PI + noise() * 0.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * r * 0.18, Math.sin(angle) * r * 0.18);
    ctx.lineTo(Math.cos(angle) * r * 0.72, Math.sin(angle) * r * 0.72);
    ctx.stroke();
  }

  ctx.strokeStyle = rgba(MUSCLE_SHADOW, 0.85);
  ctx.lineWidth = r * 0.14;
  const CLEFT_COUNT = 2;
  for (let i = 0; i < CLEFT_COUNT; i++) {
    const angle = noise() * TWO_PI;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * r * 0.2, Math.sin(angle) * r * 0.2);
    ctx.lineTo(Math.cos(angle) * r * 0.8, Math.sin(angle) * r * 0.8);
    ctx.stroke();
  }

  // 4. A single artery held open by its own wall. One, not two: on a rat's cut
  // face there is not room for a second before they merge into a smear.
  const ARTERY_RADIUS = 0.09;
  ctx.fillStyle = ARTERY_RED;
  ctx.beginPath();
  ctx.arc(r * 0.4, r * -0.32, r * ARTERY_RADIUS, 0, TWO_PI);
  ctx.fill();

  // 5. Wet blood pooling, laid down *before* the bone: a dark wash over the
  // brightest element in the piece would undo the contrast the bone is for.
  const pool = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 0.86);
  pool.addColorStop(0, rgba(BLOOD, 0));
  pool.addColorStop(1, rgba(BLOOD_DARK, 0.7));
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.86, 0, TWO_PI);
  ctx.fill();

  // 6. Bone. The brightest thing in the piece by a wide margin — it is what
  // makes a wound read as a cut rather than as a red smudge.
  for (const spec of cut.bones) {
    const boneRadius = r * spec.size * BONE_OF_WOUND * 0.5;
    const bx = spec.at.x * r;
    const by = spec.at.y * r;

    if (cut.kind === 'crushed') {
      const SHARD_MIN = 3;
      const SHARD_MAX = 5;
      const shards = pick(noise, SHARD_MIN, SHARD_MAX);
      for (let i = 0; i < shards; i++) {
        const angle = (i / shards) * TWO_PI + noise() * 0.6;
        const reach = boneRadius * lerp(1.1, 2.1, noise());
        const half = boneRadius * 0.34;
        ctx.fillStyle = i % 2 === 0 ? BONE_CORTICAL : mix(BONE_CORTICAL, BONE_SHADOW, 0.4);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(angle) * reach, by + Math.sin(angle) * reach);
        ctx.lineTo(bx + Math.cos(angle + 0.9) * half, by + Math.sin(angle + 0.9) * half);
        ctx.closePath();
        ctx.fill();
      }
      continue;
    }

    ctx.fillStyle = BONE_CORTICAL;
    ctx.beginPath();
    ctx.arc(bx, by, boneRadius, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = spec.hollow ? MUSCLE_DARK : MARROW;
    ctx.beginPath();
    ctx.arc(bx, by, boneRadius * (1 - CORTICAL_FRACTION), 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = rgba(BONE_SHADOW, 0.8);
    ctx.lineWidth = boneRadius * 0.16;
    ctx.beginPath();
    ctx.arc(bx, by, boneRadius * (1 - CORTICAL_FRACTION * 0.5), 0, TWO_PI);
    ctx.stroke();
  }

  // 7. Blood gloss — the only thing still allowed on top of the bone.
  ctx.fillStyle = BLOOD_GLOSS;
  ctx.beginPath();
  ctx.ellipse(r * -0.3, r * 0.34, r * 0.2, r * 0.1, deg(-25), 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  // 8. Flesh tags hanging off the rim.
  const tags = pick(noise, TAG_MIN, TAG_MAX) + (cut.kind === 'torn' ? 2 : 0);
  ctx.fillStyle = MUSCLE_MID;
  for (let i = 0; i < tags; i++) {
    const angle = noise() * TWO_PI;
    const reach = r * lerp(1.1, 1.5, noise());
    const half = r * 0.13;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle - 0.2) * r, Math.sin(angle - 0.2) * r);
    ctx.quadraticCurveTo(
      Math.cos(angle) * reach,
      Math.sin(angle) * reach,
      Math.cos(angle + 0.2) * r,
      Math.sin(angle + 0.2) * r,
    );
    ctx.lineTo(Math.cos(angle) * (r - half), Math.sin(angle) * (r - half));
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();

  // 9. Exterior blood, drawn outside the cut's transform so the runs are not
  // squashed along with the face they leave.
  ctx.save();
  ctx.translate(cut.centre.x, cut.centre.y);
  const drips = pick(noise, DRIP_MIN, DRIP_MAX);
  for (let i = 0; i < drips; i++) {
    const angle = cut.runAngle + (noise() - 0.5) * 1.1;
    const length = r * lerp(0.9, 2.2, noise());
    const width = r * lerp(0.14, 0.26, noise());
    const tipX = Math.cos(angle) * length;
    const tipY = Math.sin(angle) * length;
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    ctx.fillStyle = i % 2 === 0 ? BLOOD : BLOOD_DARK;
    ctx.beginPath();
    ctx.moveTo(nx * width, ny * width);
    ctx.quadraticCurveTo(tipX + nx * width * 0.4, tipY + ny * width * 0.4, tipX, tipY);
    ctx.quadraticCurveTo(
      tipX - nx * width * 0.4,
      tipY - ny * width * 0.4,
      -nx * width,
      -ny * width,
    );
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = rgba(BLOOD_DARK, 0.85);
  for (let i = 0; i < SPATTER_COUNT; i++) {
    const angle = cut.runAngle + (noise() - 0.5) * 2;
    const dist = r * lerp(1.2, 2.6, noise());
    ctx.beginPath();
    ctx.arc(
      Math.cos(angle) * dist,
      Math.sin(angle) * dist,
      r * lerp(0.05, 0.13, noise()),
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.restore();
}

// ── Piece body fill ──────────────────────────────────────────────────────────

/**
 * Geometry of the ambient fill every severed piece receives: an ink border
 * grown off the silhouette, an inset the ambient highlight fills to, and the
 * rotation-safe rim inside that.
 */
export const FLESH_OUTLINE_GROW = 0.014;
export const FLESH_AMBIENT_INSET = 0.026;
export const FLESH_RIM_INSET = 0.006;
export const FLESH_RIM_WIDTH = 0.011;

/** Grows a closed outline outward along its own radii, for the ink border. */
export function grownOutline(outline: readonly Pt[], grow: number): Pt[] {
  let sx = 0;
  let sy = 0;
  for (const p of outline) {
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / outline.length;
  const cy = sy / outline.length;
  return outline.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * grow, y: p.y + (dy / len) * grow };
  });
}
