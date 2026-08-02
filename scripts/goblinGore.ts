/**
 * The goblin wound engine and its nine body-part pieces.
 *
 * The art this replaces was a red ellipse with a white dot in it. What makes a
 * severed limb read as anatomy instead of as a coloured hole is *layers*: torn
 * everted skin, a pale subcutaneous band, striated muscle, held-open vessels and
 * — carrying the whole thing — cortical bone with marrow in it.
 *
 * Two constraints from the runtime shape every decision here, and neither is
 * negotiable:
 *
 * 1. **Pieces spin continuously.** `BodyPartGoreSystem` tumbles every part about
 *    the geometric centre of its cell, so no lighting cue may depend on the
 *    piece's orientation. A strong directional key that looks right on the sheet
 *    is wrong on nine frames out of ten in play. Everything here is lit
 *    ambiently, with a rim, and the wound's "pooling" runs toward the interior
 *    of the cavity rather than downward.
 * 2. **Pieces render at 0.5×.** `TILE_SIZE / tileScale` is 32/64, so a bone drawn
 *    8 px across shows at 4. Anything subtler than 4 screen pixels does not
 *    exist. Everything is exaggerated on purpose.
 *
 * All drawing is in tile units with the origin at the **cell centre**, because
 * that is the point the runtime rotates about. Art that drifts off it orbits
 * instead of tumbling.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import {
  FULL_CIRCLE_ANGLE,
  type GoblinStyle,
  type Pt,
  type Ramp,
  deg,
  lerp,
  mix,
  pt,
  rgba,
  seededNoise,
} from './goblinArt';

// ── Wound palette ────────────────────────────────────────────────────────────

/** Cut muscle: dark carmine, striated with a lighter fibre tone. */
const MUSCLE: Ramp = {
  shadow: '#340a0e',
  dark: '#5c1218',
  mid: '#8a1d24',
  light: '#b13a3a',
  rim: '#d06a5e',
};

/** The fat layer just under the skin — a small band that does a lot of work. */
const SUBCUTANEOUS = '#c7b070';
/** An artery held open by its own wall, against a collapsed vein. */
const ARTERY_RED = '#e4423a';
const VEIN = '#4a1018';
/** Wet blood, and the specular that sits on it. */
const BLOOD = '#6d0d12';
const BLOOD_DARK = '#2c0407';
const BLOOD_GLOSS = 'rgba(255,190,180,0.5)';

/** Ambient fill every piece receives regardless of how it is tumbling. */
const AMBIENT_ALPHA = 0.22;
const RIM_ALPHA = 0.3;

// ── Cut specification ────────────────────────────────────────────────────────

/**
 * How the limb came off. Distributed across a corpse's nine pieces so no two
 * wounds look stamped from the same die.
 */
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
  /** Rotation of the cut plane. */
  readonly angle: number;
  /** One entry per bone in the cut — two in a forearm or shin, one in a thigh. */
  readonly bones: readonly BoneSpec[];
  /**
   * Direction, in cell-local radians, that blood runs from this wound.
   *
   * It has to point *into the piece*, along the surface blood would actually run
   * down. The first cut fired drips radially outward from the wound centre in
   * every direction, which drew a red starburst: the severed arm looked like a
   * spider, not like something bleeding.
   */
  readonly runAngle: number;
  readonly seed: number;
}

const SKIN_LOBE_MIN = 5;
const SKIN_LOBE_MAX = 9;
const CORTICAL_FRACTION = 0.26;
/** Bone diameter as a fraction of the wound's, once a piece's own scale is applied. */
const BONE_OF_WOUND = 1.55;
const STRIATION_MIN = 3;
const STRIATION_MAX = 5;
const DRIP_MIN = 3;
const DRIP_MAX = 6;
const TAG_MIN = 2;
const TAG_MAX = 4;

function pick(noise: () => number, min: number, max: number): number {
  return Math.round(lerp(min, max, noise()));
}

/**
 * Paint one wound: the eight layers of §7.3, outward in. Every piece routes its
 * cut through here so all nine wounds on a corpse are recognisably the same
 * injury seen on different parts.
 */
export function drawWound(ctx: Ctx, cut: CutSpec, style: GoblinStyle): void {
  const noise = seededNoise(cut.seed);
  const skin = style.palette.skin;
  const bone = style.palette.bone;
  const r = cut.radius;

  ctx.save();
  ctx.translate(cut.centre.x, cut.centre.y);
  ctx.rotate(cut.angle);
  ctx.scale(1, cut.squash);

  // 1. Torn skin margin — irregular everted lobes, never a smooth ellipse. The
  // lobe count and their raggedness are what separate the three cut kinds.
  const lobes = pick(noise, SKIN_LOBE_MIN, SKIN_LOBE_MAX);
  const ragged = cut.kind === 'clean' ? 0.07 : cut.kind === 'crushed' ? 0.28 : 0.38;
  const lobeRadii: number[] = [];
  for (let i = 0; i < lobes; i++) lobeRadii.push(r * (1 + (noise() - 0.5) * 2 * ragged));

  const traceLobes = (scale: number): void => {
    ctx.beginPath();
    for (let i = 0; i <= lobes; i++) {
      const index = i % lobes;
      const angle = (index / lobes) * FULL_CIRCLE_ANGLE;
      const radius = lobeRadii[index] * scale;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else {
        const previous = lobeRadii[(index - 1 + lobes) % lobes] * scale;
        const midAngle = angle - FULL_CIRCLE_ANGLE / (lobes * 2);
        const midRadius = ((radius + previous) / 2) * 1.12;
        ctx.quadraticCurveTo(Math.cos(midAngle) * midRadius, Math.sin(midAngle) * midRadius, x, y);
      }
    }
    ctx.closePath();
  };

  ctx.fillStyle = skin.shadow;
  traceLobes(1.14);
  ctx.fill();
  ctx.fillStyle = skin.dark;
  traceLobes(1.05);
  ctx.fill();

  // 2. Subcutaneous band — a couple of pixels of pale yellow-olive. Small, and
  // the single thing that separates "cut flesh" from "coloured hole".
  ctx.fillStyle = SUBCUTANEOUS;
  traceLobes(0.94);
  ctx.fill();

  // 3. Muscle field with striations radiating from the bone.
  ctx.fillStyle = MUSCLE.dark;
  traceLobes(0.84);
  ctx.fill();

  ctx.save();
  traceLobes(0.84);
  ctx.clip();

  ctx.fillStyle = MUSCLE.mid;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.78, r * 0.78, 0, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();

  const striations = pick(noise, STRIATION_MIN, STRIATION_MAX);
  ctx.strokeStyle = rgba(MUSCLE.light, 0.7);
  ctx.lineWidth = r * 0.09;
  ctx.lineCap = 'round';
  for (let i = 0; i < striations; i++) {
    const angle = (i / striations) * FULL_CIRCLE_ANGLE + noise() * 0.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * r * 0.18, Math.sin(angle) * r * 0.18);
    ctx.lineTo(Math.cos(angle) * r * 0.74, Math.sin(angle) * r * 0.74);
    ctx.stroke();
  }

  // Clefts between muscle groups.
  ctx.strokeStyle = rgba(MUSCLE.shadow, 0.85);
  ctx.lineWidth = r * 0.13;
  const CLEFT_COUNT = 2;
  for (let i = 0; i < CLEFT_COUNT; i++) {
    const angle = noise() * FULL_CIRCLE_ANGLE;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * r * 0.2, Math.sin(angle) * r * 0.2);
    ctx.lineTo(Math.cos(angle) * r * 0.82, Math.sin(angle) * r * 0.82);
    ctx.stroke();
  }

  // 4. Vessels: two arteries held open, one collapsed vein.
  const ARTERY_RADIUS = 0.075;
  ctx.fillStyle = ARTERY_RED;
  for (const at of [pt(0.42, -0.34), pt(-0.36, 0.46)] as const) {
    ctx.beginPath();
    ctx.arc(at.x * r, at.y * r, r * ARTERY_RADIUS, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
  }
  ctx.fillStyle = VEIN;
  ctx.beginPath();
  ctx.ellipse(-r * 0.5, -r * 0.28, r * 0.1, r * 0.045, deg(30), 0, FULL_CIRCLE_ANGLE);
  ctx.fill();

  // 6a. Wet layer: blood pooled toward the cavity's interior edge. Drawn
  // *before* the bone, not after: a 72%-opacity wash over the one element gate
  // G9b requires to be the brightest in the wound is a contradiction, and blood
  // pools around bone rather than over it. The pooling is deliberately interior
  // rather than downward, because the piece is tumbling and "down" is meaningless.
  const pooling = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 0.95);
  pooling.addColorStop(0, rgba(BLOOD, 0));
  pooling.addColorStop(1, rgba(BLOOD_DARK, 0.72));
  ctx.fillStyle = pooling;
  traceLobes(0.84);
  ctx.fill();

  // 5. Bone. The highest-contrast element in the wound by design — gate G9b
  // measures exactly this, and it is what makes the piece read as a body part
  // rather than as a red smear.
  for (const spec of cut.bones) {
    const boneRadius = r * spec.size * BONE_OF_WOUND * 0.5;
    const at = pt(spec.at.x * r, spec.at.y * r);
    if (cut.kind === 'crushed') {
      // Splintered: three to five shards instead of a clean section.
      const SHARD_MIN = 3;
      const SHARD_MAX = 5;
      const shards = pick(noise, SHARD_MIN, SHARD_MAX);
      for (let i = 0; i < shards; i++) {
        const angle = (i / shards) * FULL_CIRCLE_ANGLE + noise() * 0.6;
        // Splinters are drawn long and bright. A crushed bone reduced to a few
        // small mid-tone chips loses the one element gate G9b requires to carry
        // the wound, and at 16 px it reads as gravel in a red hole.
        const reach = boneRadius * lerp(1.1, 2.1, noise());
        ctx.fillStyle = i % 2 === 0 ? bone.rim : bone.light;
        ctx.beginPath();
        ctx.moveTo(at.x, at.y);
        ctx.lineTo(at.x + Math.cos(angle) * reach, at.y + Math.sin(angle) * reach);
        ctx.lineTo(
          at.x + Math.cos(angle + 0.7) * reach * 0.6,
          at.y + Math.sin(angle + 0.7) * reach * 0.6,
        );
        ctx.closePath();
        ctx.fill();
      }
      continue;
    }

    ctx.fillStyle = bone.rim;
    ctx.beginPath();
    ctx.arc(at.x, at.y, boneRadius, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();

    if (spec.hollow === true) {
      const HOLLOW_BORE = 0.44;
      ctx.fillStyle = MUSCLE.shadow;
      ctx.beginPath();
      ctx.arc(at.x, at.y, boneRadius * HOLLOW_BORE, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
      continue;
    }

    // Cancellous marrow: mottled pink-grey with a darker core.
    ctx.fillStyle = mix(bone.dark, MUSCLE.light, 0.45);
    ctx.beginPath();
    ctx.arc(at.x, at.y, boneRadius * (1 - CORTICAL_FRACTION * 2), 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
    const MOTTLE_COUNT = 4;
    ctx.fillStyle = rgba(MUSCLE.dark, 0.55);
    for (let i = 0; i < MOTTLE_COUNT; i++) {
      const angle = noise() * FULL_CIRCLE_ANGLE;
      const reach = boneRadius * 0.5 * noise();
      ctx.beginPath();
      ctx.arc(
        at.x + Math.cos(angle) * reach,
        at.y + Math.sin(angle) * reach,
        boneRadius * 0.16,
        0,
        FULL_CIRCLE_ANGLE,
      );
      ctx.fill();
    }
  }

  // 6b. The gloss on the blood, which is the only thing that still goes on top.
  ctx.fillStyle = BLOOD_GLOSS;
  ctx.beginPath();
  ctx.ellipse(-r * 0.26, -r * 0.3, r * 0.26, r * 0.13, deg(-28), 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.restore();

  // 8. Flesh tags hanging off the cut. A chopped cut also peels one flap of skin
  // fully back, which is what makes `torn` look different from `clean`.
  const tags = pick(noise, TAG_MIN, TAG_MAX) + (cut.kind === 'torn' ? 2 : 0);
  ctx.strokeStyle = MUSCLE.dark;
  ctx.lineCap = 'round';
  for (let i = 0; i < tags; i++) {
    const angle = noise() * FULL_CIRCLE_ANGLE;
    const length = r * lerp(0.22, 0.5, noise()) * (cut.kind === 'torn' ? 1.3 : 1);
    ctx.lineWidth = r * lerp(0.05, 0.11, noise());
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * r * 0.95, Math.sin(angle) * r * 0.95);
    ctx.quadraticCurveTo(
      Math.cos(angle) * (r + length * 0.6) + length * 0.3,
      Math.sin(angle) * (r + length * 0.6),
      Math.cos(angle) * (r + length),
      Math.sin(angle) * (r + length) + length * 0.3,
    );
    ctx.stroke();
  }

  if (cut.kind === 'torn') {
    ctx.fillStyle = skin.dark;
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, -r * 0.4);
    ctx.quadraticCurveTo(-r * 1.4, -r * 0.85, -r * 1.15, r * 0.15);
    ctx.quadraticCurveTo(-r * 1.05, r * 0.55, -r * 0.85, r * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();

  // 7. Exterior blood: drip runs down the piece's surface, freckled spatter and
  // a drag smear. Drawn outside the cut's own transform so the runs are not
  // squashed with the wound face, and aimed along `runAngle` so they travel down
  // the limb rather than radiating out of it.
  const drips = pick(noise, DRIP_MIN, DRIP_MAX);
  const DRIP_SPREAD = 0.55;
  ctx.save();
  ctx.translate(cut.centre.x, cut.centre.y);
  for (let i = 0; i < drips; i++) {
    const angle = cut.runAngle + lerp(-DRIP_SPREAD, DRIP_SPREAD, noise());
    const start = r * lerp(0.6, 0.95, noise());
    const length = r * lerp(0.4, 0.95, noise());
    const halfWidth = r * lerp(0.06, 0.12, noise());
    const from = pt(Math.cos(angle) * start, Math.sin(angle) * start);
    const to = pt(Math.cos(angle) * (start + length), Math.sin(angle) * (start + length));
    const acrossX = -Math.sin(angle);
    const acrossY = Math.cos(angle);
    // A run is fat at the wound and beads to a rounded point, which is what
    // makes it read as liquid rather than as a drawn line.
    ctx.fillStyle = BLOOD;
    ctx.beginPath();
    ctx.moveTo(from.x + acrossX * halfWidth, from.y + acrossY * halfWidth);
    ctx.quadraticCurveTo(
      to.x + acrossX * halfWidth * 0.9,
      to.y + acrossY * halfWidth * 0.9,
      to.x,
      to.y,
    );
    ctx.quadraticCurveTo(
      to.x - acrossX * halfWidth * 0.9,
      to.y - acrossY * halfWidth * 0.9,
      from.x - acrossX * halfWidth,
      from.y - acrossY * halfWidth,
    );
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(to.x, to.y, halfWidth * 0.8, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
  }

  const SPATTER_COUNT = 5;
  ctx.fillStyle = rgba(BLOOD_DARK, 0.8);
  for (let i = 0; i < SPATTER_COUNT; i++) {
    const angle = cut.runAngle + lerp(-1, 1, noise());
    const reach = r * lerp(0.85, 1.25, noise());
    ctx.beginPath();
    ctx.arc(
      Math.cos(angle) * reach,
      Math.sin(angle) * reach,
      r * lerp(0.04, 0.09, noise()),
      0,
      FULL_CIRCLE_ANGLE,
    );
    ctx.fill();
  }
  ctx.restore();
}

// ── Piece geometry ───────────────────────────────────────────────────────────

/**
 * A limb or chunk, in cell-local tile units centred on the cell centre.
 *
 * Gate G10 measures the painted ink: nothing a piece paints may fall outside the
 * circle the cell inscribes, or the art clips at the corners as it spins.
 */
export interface GorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx, style: GoblinStyle) => void;
}

const FLESH_OUTLINE_GROW = 0.014;
const FLESH_AMBIENT_INSET = 0.03;
const FLESH_RIM_INSET = 0.006;
const FLESH_RIM_WIDTH = 0.012;
/** The jaw is bone, not flesh, so it outlines itself rather than via `paintFlesh`. */
const JAW_OUTLINE_GROW = 0.016;

/** Ambient body fill with a rotation-safe rim, for the meat of every piece. */
function paintFlesh(ctx: Ctx, trace: (grow: number) => void, style: GoblinStyle): void {
  const skin = style.palette.skin;
  ctx.fillStyle = style.palette.outline;
  trace(FLESH_OUTLINE_GROW);
  ctx.fill();
  ctx.fillStyle = skin.mid;
  trace(0);
  ctx.fill();

  ctx.save();
  trace(0);
  ctx.clip();
  // Ambient occlusion toward the middle rather than a directional key: the piece
  // spins, so any single light direction is wrong most of the time.
  ctx.fillStyle = rgba(skin.shadow, AMBIENT_ALPHA);
  ctx.fillRect(-1, -1, 2, 2);
  ctx.fillStyle = rgba(skin.light, AMBIENT_ALPHA * 1.4);
  trace(-FLESH_AMBIENT_INSET);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = rgba(skin.rim, RIM_ALPHA);
  ctx.lineWidth = FLESH_RIM_WIDTH;
  trace(-FLESH_RIM_INSET);
  ctx.stroke();
}

/** A tapered limb segment lying across the cell, with its cut end at `cutAt`. */
function traceLimb(
  ctx: Ctx,
  from: Pt,
  to: Pt,
  rootHalf: number,
  endHalf: number,
  grow: number,
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const a = rootHalf + grow;
  const b = endHalf + grow;
  ctx.beginPath();
  ctx.moveTo(from.x + nx * a, from.y + ny * a);
  ctx.lineTo(to.x + nx * b, to.y + ny * b);
  ctx.arc(to.x, to.y, b, angle - Math.PI / 2, angle + Math.PI / 2);
  ctx.lineTo(from.x - nx * a, from.y - ny * a);
  ctx.arc(from.x, from.y, a, angle + Math.PI / 2, angle + (Math.PI * 3) / 2);
  ctx.closePath();
}

const PIECE_SEED_BASE = 7717;
/** Legs are drawn longer than arms so the two never read as the same tick. */
const LEG_LENGTH_SCALE = 1.2;
/** How far each limb is folded at its joint, 0 straight and 1 fully bent. */
const ARM_NEAR_FOLD = 0.85;
const ARM_FAR_FOLD = 0.35;
const LEG_NEAR_FOLD = 0.12;
const LEG_FAR_FOLD = 0;

/**
 * The nine pieces of a goblin, in the order `BodyPartGoreSystem` spawns them.
 *
 * Sizes are deliberately unequal — the torso is roughly three times the area of
 * the jaw. A set of same-sized chunks reads as tiles, not as a body.
 */
export function gorePieces(style: GoblinStyle): readonly GorePiece[] {
  const p = style.proportions;
  const skin = style.palette.skin;
  const { bone, iron, leather, outline, toothEnamel, mouthInner, eye, sclera } = style.palette;
  let seedCounter = 0;
  const nextSeed = (): number => PIECE_SEED_BASE + seedCounter++ * 977;

  const head: GorePiece = {
    state: 'gore_head',
    paint: (ctx) => {
      const r = p.headRadius * 1.05;
      ctx.save();
      ctx.rotate(deg(-24));
      ctx.translate(-r * 0.1, -r * 0.12);
      // Ears stay intact: they are what identifies this as a goblin head at 16 px.
      for (const side of [-1, 1] as const) {
        ctx.save();
        ctx.rotate(deg(150 * side * 0.12));
        ctx.fillStyle = outline;
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r * 0.28 + side * r * 0.12);
        ctx.lineTo(-r * 0.5 - p.earLength * 0.9, r * 0.16 + side * r * 0.2);
        ctx.lineTo(-r * 0.42, r * 0.1 + side * r * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = side < 0 ? skin.dark : skin.mid;
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r * 0.22 + side * r * 0.12);
        ctx.lineTo(-r * 0.5 - p.earLength * 0.82, r * 0.16 + side * r * 0.2);
        ctx.lineTo(-r * 0.44, r * 0.06 + side * r * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      const traceHead = (grow: number): void => {
        ctx.beginPath();
        ctx.ellipse(0, 0, r + grow, r * 0.92 + grow, 0, 0, FULL_CIRCLE_ANGLE);
        ctx.closePath();
      };
      paintFlesh(ctx, traceHead, style);

      // A slack jaw hanging open, and one eye rolled back to white.
      ctx.fillStyle = mouthInner;
      ctx.beginPath();
      ctx.ellipse(r * 0.42, r * 0.42, r * 0.3, r * 0.2, deg(16), 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
      ctx.fillStyle = toothEnamel;
      ctx.beginPath();
      ctx.moveTo(r * 0.24, r * 0.32);
      ctx.lineTo(r * 0.36, r * 0.3);
      ctx.lineTo(r * 0.3, r * 0.52);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = sclera;
      ctx.beginPath();
      ctx.ellipse(r * 0.36, -r * 0.2, r * 0.17, r * 0.14, 0, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
      ctx.fillStyle = bone.light;
      ctx.beginPath();
      ctx.ellipse(r * 0.38, -r * 0.24, r * 0.1, r * 0.08, 0, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
      ctx.fillStyle = eye;
      ctx.beginPath();
      ctx.arc(-r * 0.06, -r * 0.18, r * 0.06, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
      ctx.restore();

      // The neck stump: a vertebra ring and a ribbed trachea, not a long bone.
      drawWound(
        ctx,
        {
          kind: 'torn',
          centre: pt(-p.headRadius * 0.1, p.headRadius * 0.86),
          radius: p.headRadius * 0.62,
          squash: 0.74,
          angle: deg(96),
          bones: [
            { at: pt(-0.02, -0.2), size: 0.78, hollow: true },
            { at: pt(0.1, 0.52), size: 0.44, hollow: true },
          ],
          runAngle: deg(96),
          seed: nextSeed(),
        },
        style,
      );
    },
  };

  const torso: GorePiece = {
    state: 'gore_torso',
    paint: (ctx) => {
      const halfW = p.shoulderHalfWidth * 0.95;
      const halfH = p.torsoLength * 0.52;
      ctx.save();
      ctx.rotate(deg(14));
      const traceTorso = (grow: number): void => {
        ctx.beginPath();
        ctx.moveTo(-halfW - grow, -halfH * 0.7);
        ctx.quadraticCurveTo(0, -halfH - grow, halfW * 0.9 + grow, -halfH * 0.6);
        ctx.quadraticCurveTo(halfW + grow, 0, halfW * 0.7 + grow, halfH * 0.8 + grow);
        ctx.quadraticCurveTo(0, halfH + grow, -halfW * 0.8 - grow, halfH * 0.6);
        ctx.quadraticCurveTo(-halfW - grow, 0, -halfW - grow, -halfH * 0.7);
        ctx.closePath();
      };
      paintFlesh(ctx, traceTorso, style);

      // The gut cavity, opened down one side with the rib ends sawn through.
      ctx.save();
      traceTorso(0);
      ctx.clip();
      ctx.fillStyle = MUSCLE.shadow;
      ctx.beginPath();
      ctx.ellipse(halfW * 0.2, halfH * 0.1, halfW * 0.6, halfH * 0.62, deg(-12), 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
      ctx.fillStyle = rgba(BLOOD_DARK, 0.7);
      ctx.beginPath();
      ctx.ellipse(halfW * 0.24, halfH * 0.18, halfW * 0.44, halfH * 0.46, deg(-12), 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
      const RIB_ARCS = 4;
      ctx.strokeStyle = bone.light;
      ctx.lineWidth = halfH * 0.11;
      ctx.lineCap = 'round';
      for (let i = 0; i < RIB_ARCS; i++) {
        const y = lerp(-halfH * 0.5, halfH * 0.35, i / (RIB_ARCS - 1));
        ctx.beginPath();
        ctx.moveTo(-halfW * 0.5, y);
        ctx.quadraticCurveTo(halfW * 0.1, y + halfH * 0.22, halfW * 0.62, y - halfH * 0.05);
        ctx.stroke();
      }
      ctx.restore();

      // Spine stub above, pelvis crest below.
      drawWound(
        ctx,
        {
          kind: 'torn',
          centre: pt(-halfW * 0.25, -halfH * 0.86),
          radius: halfW * 0.42,
          squash: 0.6,
          angle: deg(-84),
          bones: [{ at: pt(0, 0), size: 0.55, hollow: true }],
          runAngle: deg(-84),
          seed: nextSeed(),
        },
        style,
      );
      drawWound(
        ctx,
        {
          kind: 'crushed',
          centre: pt(halfW * 0.1, halfH * 0.86),
          radius: halfW * 0.46,
          squash: 0.58,
          angle: deg(88),
          bones: [
            { at: pt(-0.4, 0), size: 0.4 },
            { at: pt(0.42, 0.1), size: 0.4 },
          ],
          runAngle: deg(88),
          seed: nextSeed(),
        },
        style,
      );
      ctx.restore();
    },
  };

  /** Arm and leg pieces share their construction; only the fittings differ. */
  const limbPiece = (
    state: string,
    upper: number,
    lower: number,
    width: number,
    kind: CutKind,
    twoBones: boolean,
    fitting: 'greave' | 'bracer' | 'none',
    /** How sharply the limb is folded at its joint; a straight limb is a stick. */
    fold: number,
    extremity: (ctx: Ctx, at: Pt, angle: number) => void,
  ): GorePiece => ({
    state,
    paint: (ctx) => {
      const total = upper + lower;
      const start = pt(-total * 0.42, -total * 0.24);
      const knee = pt(start.x + upper * 0.86, start.y + upper * 0.34);
      // The fold is what separates four otherwise-identical limbs at 16 px: a
      // bent arm and a straight leg are different shapes even as silhouettes.
      const end = pt(
        knee.x + lower * lerp(0.3, -0.5, fold),
        knee.y + lower * lerp(0.82, 0.62, fold),
      );
      ctx.save();
      traceLimb(ctx, start, knee, width * 0.5, width * 0.46, 0);
      const traceUpper = (grow: number): void =>
        traceLimb(ctx, start, knee, width * 0.5, width * 0.46, grow);
      const traceLower = (grow: number): void =>
        traceLimb(ctx, knee, end, width * 0.46, width * 0.38, grow);
      paintFlesh(ctx, traceUpper, style);
      paintFlesh(ctx, traceLower, style);

      if (fitting === 'greave') {
        const RUST = 0.42;
        ctx.fillStyle = mix(iron.dark, leather.dark, RUST);
        traceLimb(ctx, pt(lerp(knee.x, end.x, 0.2), lerp(knee.y, end.y, 0.2)), pt(lerp(knee.x, end.x, 0.8), lerp(knee.y, end.y, 0.8)), width * 0.5, width * 0.44, 0);
        ctx.fill();
      }
      if (fitting === 'bracer') {
        ctx.fillStyle = leather.dark;
        traceLimb(ctx, pt(lerp(knee.x, end.x, 0.25), lerp(knee.y, end.y, 0.25)), pt(lerp(knee.x, end.x, 0.8), lerp(knee.y, end.y, 0.8)), width * 0.5, width * 0.44, 0);
        ctx.fill();
      }

      extremity(ctx, end, Math.atan2(end.y - knee.y, end.x - knee.x));

      drawWound(
        ctx,
        {
          kind,
          centre: start,
          // Deliberately wider than the limb it ends. At the runtime's 0.5×
          // gore scale an anatomically-sized cut on a 0.10-tile forearm is four
          // screen pixels across and the bone inside it is one — which is to say
          // it does not exist. §7.1 says exaggerate, and this is where.
          radius: width * 1.15,
          squash: 0.62,
          angle: Math.atan2(knee.y - start.y, knee.x - start.x) + Math.PI,
          bones: twoBones
            ? [
                { at: pt(-0.3, -0.1), size: 0.46 },
                { at: pt(0.36, 0.16), size: 0.32 },
              ]
            : [{ at: pt(0, 0), size: 0.52 }],
          // Down the limb, away from the cut face.
          runAngle: Math.atan2(knee.y - start.y, knee.x - start.x),
          seed: nextSeed(),
        },
        style,
      );
      ctx.restore();
    },
  });

  /** A curled fist still gripping a haft — the most satisfying piece in the set. */
  const grippingHand = (ctx: Ctx, at: Pt, angle: number): void => {
    const r = p.handRadius;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(angle);
    ctx.fillStyle = outline;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.15, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
    ctx.fillStyle = skin.mid;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
    // The haft the fingers are still closed around, snapped off at both ends.
    ctx.fillStyle = style.palette.wood.dark;
    ctx.fillRect(-r * 0.3, -r * 2.1, r * 0.6, r * 4.2);
    ctx.fillStyle = rgba(style.palette.wood.light, 0.6);
    ctx.fillRect(-r * 0.3, -r * 2.1, r * 0.22, r * 4.2);
    const KNUCKLE_COUNT = 3;
    ctx.fillStyle = skin.dark;
    for (let i = 0; i < KNUCKLE_COUNT; i++) {
      const t = (i + 0.5) / KNUCKLE_COUNT;
      ctx.beginPath();
      ctx.arc(r * 0.5, lerp(-r * 0.8, r * 0.8, t), r * 0.32, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
    }
    ctx.restore();
  };

  const openHand = (ctx: Ctx, at: Pt, angle: number): void => {
    const r = p.handRadius;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(angle);
    const FINGERS = 3;
    for (let i = 0; i < FINGERS + 1; i++) {
      const fan = i < FINGERS ? (i / (FINGERS - 1) - 0.5) * deg(74) : deg(-108);
      const length = r * (i < FINGERS ? 1.5 : 1.1);
      ctx.strokeStyle = outline;
      ctx.lineWidth = r * 0.66;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(fan) * length, Math.sin(fan) * length);
      ctx.stroke();
      ctx.strokeStyle = skin.mid;
      ctx.lineWidth = r * 0.46;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(fan) * length, Math.sin(fan) * length);
      ctx.stroke();
    }
    ctx.fillStyle = outline;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.05, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
    ctx.fillStyle = skin.mid;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
    ctx.restore();
  };

  const bareFoot = (ctx: Ctx, at: Pt, angle: number): void => {
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(angle);
    const length = p.footLength * 0.8;
    const height = p.footHeight * 1.4;
    ctx.fillStyle = outline;
    ctx.beginPath();
    ctx.ellipse(length * 0.3, 0, length * 0.6, height, deg(-10), 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
    ctx.fillStyle = skin.mid;
    ctx.beginPath();
    ctx.ellipse(length * 0.3, 0, length * 0.52, height * 0.82, deg(-10), 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
    const TOES = 3;
    ctx.fillStyle = skin.dark;
    for (let i = 0; i < TOES; i++) {
      const t = i / (TOES - 1);
      ctx.beginPath();
      ctx.arc(length * lerp(0.86, 0.62, t), lerp(-height * 0.4, height * 0.5, t), height * 0.34, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
    }
    ctx.restore();
  };

  const ribChunk: GorePiece = {
    state: 'gore_ribchunk',
    paint: (ctx) => {
      const RIB_CHUNK_LEGIBILITY_SCALE = 1.68;
      const w = p.shoulderHalfWidth * 0.66 * RIB_CHUNK_LEGIBILITY_SCALE;
      const h = p.torsoLength * 0.3 * RIB_CHUNK_LEGIBILITY_SCALE;
      ctx.save();
      ctx.rotate(deg(-32));
      const trace = (grow: number): void => {
        ctx.beginPath();
        ctx.moveTo(-w - grow, -h - grow);
        ctx.quadraticCurveTo(w * 0.3, -h * 1.25 - grow, w + grow, -h * 0.4);
        ctx.quadraticCurveTo(w * 1.1 + grow, h * 0.7, w * 0.2, h + grow);
        ctx.quadraticCurveTo(-w * 0.7 - grow, h * 1.1 + grow, -w - grow, -h - grow);
        ctx.closePath();
      };
      paintFlesh(ctx, trace, style);
      ctx.save();
      trace(0);
      ctx.clip();
      ctx.fillStyle = MUSCLE.dark;
      ctx.fillRect(-w, -h * 0.2, w * 2, h * 1.4);
      const ARCS = 3;
      ctx.strokeStyle = bone.rim;
      ctx.lineWidth = h * 0.2;
      ctx.lineCap = 'round';
      for (let i = 0; i < ARCS; i++) {
        const y = lerp(-h * 0.5, h * 0.6, i / (ARCS - 1));
        ctx.beginPath();
        ctx.moveTo(-w * 0.85, y);
        ctx.quadraticCurveTo(0, y + h * 0.4, w * 0.85, y - h * 0.1);
        ctx.stroke();
      }
      ctx.fillStyle = rgba(BLOOD_DARK, 0.55);
      ctx.fillRect(-w, h * 0.2, w * 2, h);
      ctx.restore();
      ctx.restore();
    },
  };

  const entrails: GorePiece = {
    state: 'gore_entrails',
    paint: (ctx) => {
      const loop = p.hipHalfWidth * 1.5;
      const tube = p.hipHalfWidth * 0.34;
      const noise = seededNoise(nextSeed());
      ctx.save();
      // A rope of gut folded back on itself, with mesentery webbing between the
      // folds. The wettest thing in the set, so the gloss is doubled.
      const LOOPS = 3;
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? outline : mix(MUSCLE.light, SUBCUTANEOUS, 0.4);
        ctx.lineWidth = pass === 0 ? tube * 2.3 : tube * 1.9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-loop, loop * 0.4);
        for (let i = 0; i < LOOPS; i++) {
          const t = (i + 1) / LOOPS;
          ctx.quadraticCurveTo(
            lerp(-loop, loop, t - 0.5 / LOOPS) * 1.3,
            (i % 2 === 0 ? -1 : 1) * loop * 0.85,
            lerp(-loop, loop, t),
            loop * 0.4 * (i % 2 === 0 ? -0.4 : 0.5),
          );
        }
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(MUSCLE.mid, 0.75);
      ctx.lineWidth = tube * 0.45;
      const SEGMENTS = 7;
      for (let i = 0; i < SEGMENTS; i++) {
        const x = lerp(-loop, loop, i / (SEGMENTS - 1));
        const y = lerp(-loop * 0.4, loop * 0.4, noise());
        ctx.beginPath();
        ctx.moveTo(x, y - tube * 0.7);
        ctx.lineTo(x + tube * 0.3, y + tube * 0.7);
        ctx.stroke();
      }
      ctx.fillStyle = BLOOD_GLOSS;
      for (let i = 0; i < 4; i++) {
        const x = lerp(-loop * 0.9, loop * 0.9, noise());
        const y = lerp(-loop * 0.6, loop * 0.6, noise());
        ctx.beginPath();
        ctx.ellipse(x, y, tube * 0.5, tube * 0.2, deg(-30), 0, FULL_CIRCLE_ANGLE);
        ctx.fill();
      }
      ctx.restore();
    },
  };

  const jaw: GorePiece = {
    state: 'gore_jaw',
    paint: (ctx) => {
      /**
       * A mandible, drawn as a thick horseshoe of bone with the teeth standing
       * up off its top edge and the tongue lolling inside it.
       *
       * The first cut was a thin arch with four cream spikes on a nearly
       * transparent field: at the 0.5× scale gore actually renders at, that is a
       * few stray specks. Mass first, detail second.
       */
      const JAW_LEGIBILITY_SCALE = 2.2;
      const w = p.headRadius * 0.62 * JAW_LEGIBILITY_SCALE;
      const h = p.headRadius * 0.5 * JAW_LEGIBILITY_SCALE;
      const RAMUS_HEIGHT = 0.75;
      const INNER_WIDTH = 0.5;
      const INNER_DEPTH = 0.4;

      ctx.save();
      ctx.rotate(deg(14));
      const trace = (grow: number): void => {
        ctx.beginPath();
        ctx.moveTo(-w - grow, -h * RAMUS_HEIGHT - grow);
        ctx.quadraticCurveTo(-w - grow, h * 1.1 + grow, 0, h + grow);
        ctx.quadraticCurveTo(w + grow, h * 1.1 + grow, w + grow, -h * RAMUS_HEIGHT - grow);
        ctx.lineTo(w * INNER_WIDTH + grow, -h * RAMUS_HEIGHT - grow);
        ctx.quadraticCurveTo(
          w * INNER_WIDTH + grow,
          h * INNER_DEPTH,
          0,
          h * INNER_DEPTH + grow,
        );
        ctx.quadraticCurveTo(
          -w * INNER_WIDTH - grow,
          h * INNER_DEPTH,
          -w * INNER_WIDTH - grow,
          -h * RAMUS_HEIGHT - grow,
        );
        ctx.closePath();
      };

      ctx.fillStyle = outline;
      trace(JAW_OUTLINE_GROW);
      ctx.fill();
      ctx.fillStyle = bone.mid;
      trace(0);
      ctx.fill();

      ctx.save();
      trace(0);
      ctx.clip();
      ctx.fillStyle = rgba(bone.rim, 0.6);
      ctx.fillRect(-w, -h, w * 2, h * 0.7);
      ctx.fillStyle = rgba(MUSCLE.dark, 0.5);
      ctx.fillRect(-w, h * 0.45, w * 2, h);
      ctx.restore();

      // The tongue, lolling out of the broken jaw and filling its arch.
      ctx.fillStyle = mix(MUSCLE.light, SUBCUTANEOUS, 0.3);
      ctx.beginPath();
      ctx.ellipse(0, h * 0.12, w * 0.5, h * 0.44, 0, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
      ctx.fillStyle = rgba(MUSCLE.shadow, 0.5);
      ctx.beginPath();
      ctx.ellipse(0, h * 0.12, w * 0.36, h * 0.08, 0, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();

      // Teeth stand up off the top edge, two of them broken off short.
      const TEETH = 5;
      for (let i = 0; i < TEETH; i++) {
        const t = (i + 0.5) / TEETH;
        const x = lerp(-w * 0.82, w * 0.82, t);
        const rim = -h * RAMUS_HEIGHT + h * Math.abs(t - 0.5) * 1.5;
        const broken = i === 1 || i === 4;
        ctx.fillStyle = broken ? bone.dark : toothEnamel;
        ctx.beginPath();
        ctx.moveTo(x - w * 0.09, rim);
        ctx.lineTo(x + w * 0.09, rim);
        ctx.lineTo(x, rim - h * (broken ? 0.22 : 0.5));
        ctx.closePath();
        ctx.fill();
      }

      // The torn gum line where the jaw came away from the skull.
      ctx.fillStyle = rgba(MUSCLE.mid, 0.75);
      ctx.fillRect(-w * INNER_WIDTH, -h * RAMUS_HEIGHT, w * INNER_WIDTH * 2, h * 0.12);
      ctx.restore();
    },
  };

  const armWidth = p.armWidth;
  const legWidth = p.legWidth;
  return [
    head,
    torso,
    // Sizes and folds deliberately spread: a set of same-sized chunks reads as
    // tiles rather than as a body coming apart.
    limbPiece('gore_arm_near', p.upperArmLength, p.forearmLength, armWidth, 'crushed', true, 'none', ARM_NEAR_FOLD, grippingHand),
    limbPiece('gore_arm_far', p.upperArmLength, p.forearmLength, armWidth, 'clean', true, style.gear.bracer ? 'bracer' : 'none', ARM_FAR_FOLD, openHand),
    limbPiece('gore_leg_near', p.thighLength * LEG_LENGTH_SCALE, p.shinLength * LEG_LENGTH_SCALE, legWidth, 'torn', false, style.gear.greave ? 'greave' : 'none', LEG_NEAR_FOLD, bareFoot),
    limbPiece('gore_leg_far', p.thighLength * LEG_LENGTH_SCALE, p.shinLength * LEG_LENGTH_SCALE, legWidth, 'clean', false, 'none', LEG_FAR_FOLD, bareFoot),
    ribChunk,
    entrails,
    jaw,
  ];
}

/**
 * Pieces with no cut face and therefore no bone.
 *
 * Gate G9b asks whether bone is the brightest thing in a wound. A rope of gut
 * has neither: it is torn from its mesentery, not cut through a limb, and the
 * gate would be asking a question the piece cannot answer.
 */
export const BONELESS_GORE_STATES: readonly string[] = ['gore_entrails'];

