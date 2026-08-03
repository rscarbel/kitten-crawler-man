/**
 * The eight pieces a rat comes apart into.
 *
 * The cut face itself is not here — `scripts/goreWound.ts` owns that, and every
 * wound below routes through it.
 *
 * Two runtime constraints shape every decision here, and they are the same two
 * the goblin pieces are built against:
 *
 * 1. **Pieces spin continuously.** `BodyPartGoreSystem` tumbles every part, so
 *    no lighting cue may depend on the piece's orientation. Everything is lit
 *    ambiently with a rim, and blood runs away from the wound rather than
 *    downward.
 * 2. **Pieces render at 0.5×.** `TILE_SIZE / tileScale` is 32/64, so a detail
 *    drawn 6 px across shows at 3. Everything is exaggerated on purpose — and a
 *    rat is already a third the size of a goblin, so the exaggeration has to go
 *    further here than it does there.
 *
 * The pieces are chosen for silhouette rather than for anatomy. What has to be
 * true is that eight cells tumbling past at 16 px do not read as eight identical
 * red blobs, so the set is deliberately spread across a long thin whip (the
 * tail), a wedge with two spikes (the head), a bent L (the haunch), a short
 * straight stick (the foreleg), two slabs of different aspect, a rope, and a
 * pair of splayed digits.
 *
 * All drawing is in tile units with the origin at the centre of the piece's own
 * cell. The runtime pivots on the frame's *measured ink centre* rather than on
 * that origin (see `drawSpriteRotatedCenter`), so a piece painted off-centre
 * still tumbles in place — centring is for legibility and consistent cell
 * sizing, not a correctness requirement.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import {
  SKIN,
  TWO_PI,
  deg,
  hash1,
  lerp,
  mix,
  ovalOutline,
  pt,
  rgba,
  traceOutline,
  type Pt,
} from './ratArt';
// The cut face itself is creature-agnostic and shared; see `scripts/goreWound.ts`.
import {
  AMBIENT_ALPHA,
  BLOOD_DARK,
  BLOOD_GLOSS,
  BONE_CORTICAL,
  MUSCLE_DARK,
  MUSCLE_LIGHT,
  MUSCLE_MID,
  MUSCLE_SHADOW,
  RIM_ALPHA,
  SUBCUTANEOUS,
  FLESH_AMBIENT_INSET,
  FLESH_OUTLINE_GROW,
  FLESH_RIM_INSET,
  FLESH_RIM_WIDTH,
  drawWound,
  grownOutline,
  type CutSpec,
} from './goreWound';

// ── Rat tones ────────────────────────────────────────────────────────────────

/** Rat pelt, as seen on a piece rather than on a live animal. */
const PELT_MID = '#5d5041';
const PELT_DARK = '#2c251d';
const PELT_LIGHT = '#8e7c61';
const PELT_RIM = '#b09a76';
const OUTLINE_INK = '#17120e';

const INCISOR_ENAMEL = '#e0c579';
const INCISOR_ROOT = '#a8853c';
const EYE_DEAD = '#7f6d63';

// ── Piece body fill ──────────────────────────────────────────────────────────

/** Ambient pelt fill with a rotation-safe rim, for the meat of every piece. */
function paintPelt(ctx: Ctx, trace: (grow: number) => void): void {
  ctx.fillStyle = OUTLINE_INK;
  trace(FLESH_OUTLINE_GROW);
  ctx.fill();
  ctx.fillStyle = PELT_MID;
  trace(0);
  ctx.fill();

  ctx.save();
  trace(0);
  ctx.clip();
  // Ambient occlusion toward the middle rather than a directional key: the piece
  // spins, so any single light direction is wrong most of the time.
  ctx.fillStyle = rgba(PELT_DARK, AMBIENT_ALPHA);
  ctx.fillRect(-1, -1, 2, 2);
  ctx.fillStyle = rgba(PELT_LIGHT, AMBIENT_ALPHA * 1.4);
  trace(-FLESH_AMBIENT_INSET);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = rgba(PELT_RIM, RIM_ALPHA);
  ctx.lineWidth = FLESH_RIM_WIDTH;
  trace(-FLESH_RIM_INSET);
  ctx.stroke();
}

/** The same ambient treatment for the hairless pieces — tail, feet, ears. */
function paintBareSkin(ctx: Ctx, trace: (grow: number) => void): void {
  ctx.fillStyle = OUTLINE_INK;
  trace(FLESH_OUTLINE_GROW);
  ctx.fill();
  ctx.fillStyle = SKIN.base;
  trace(0);
  ctx.fill();

  ctx.save();
  trace(0);
  ctx.clip();
  ctx.fillStyle = rgba(SKIN.shadow, AMBIENT_ALPHA);
  ctx.fillRect(-1, -1, 2, 2);
  ctx.fillStyle = rgba(SKIN.light, AMBIENT_ALPHA * 1.5);
  trace(-FLESH_AMBIENT_INSET);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = rgba(SKIN.light, RIM_ALPHA);
  ctx.lineWidth = FLESH_RIM_WIDTH;
  trace(-FLESH_RIM_INSET);
  ctx.stroke();
}

/** A tapered segment lying across the cell, with its cut end at `from`. */
function traceSegment(
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
  // A rat's shank is thinner than the inset `paintPelt` uses for its ambient
  // pass, so the shrunk trace would ask for a negative arc radius and throw.
  const a = Math.max(0, rootHalf + grow);
  const b = Math.max(0, endHalf + grow);
  ctx.beginPath();
  ctx.moveTo(from.x + nx * a, from.y + ny * a);
  ctx.lineTo(to.x + nx * b, to.y + ny * b);
  ctx.arc(to.x, to.y, b, angle - Math.PI / 2, angle + Math.PI / 2);
  ctx.lineTo(from.x - nx * a, from.y - ny * a);
  ctx.arc(from.x, from.y, a, angle + Math.PI / 2, angle + (Math.PI * 3) / 2);
  ctx.closePath();
}

/** Grows a closed polygon outward from its own centroid by `grow` tile units. */
// ── The eight pieces ─────────────────────────────────────────────────────────

export type { CutSpec };

export interface GorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx) => void;
}

const PIECE_SEED_BASE = 4409;

/** Rat fur strokes on a piece: enough to read as pelt, not enough to be noise. */
const PELT_HAIR_COUNT = 26;
const PELT_HAIR_LENGTH = 0.03;

function scribblePelt(ctx: Ctx, trace: (grow: number) => void, seed: number, spread: number): void {
  ctx.save();
  trace(0);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.006;
  for (let i = 0; i < PELT_HAIR_COUNT; i++) {
    const x = (hash1(seed + i) - 0.5) * 2 * spread;
    const y = (hash1(seed + i * 3.1 + 11) - 0.5) * 2 * spread;
    const angle = hash1(seed + i * 7.7) * TWO_PI;
    ctx.strokeStyle = rgba(i % 3 === 0 ? PELT_LIGHT : PELT_DARK, 0.6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * PELT_HAIR_LENGTH, y + Math.sin(angle) * PELT_HAIR_LENGTH);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The eight pieces, in the order `BodyPartGoreSystem` spawns them.
 *
 * Sizes are deliberately unequal — the torso is several times the area of the
 * forepaw. A set of same-sized chunks reads as tiles, not as a body.
 */
export function ratGorePieces(): readonly GorePiece[] {
  let seedCounter = 0;
  /**
   * Seeds are drawn **here**, at construction, and never from inside a `paint`
   * closure. The bake paints every piece three times — measure, re-measure after
   * re-centring, then render — and a counter advanced during painting hands each
   * pass different art. The offsets would then re-centre a picture that is never
   * written, which is exactly the orbit-instead-of-tumble bug the two-pass
   * measurement exists to prevent.
   */
  const nextSeed = (): number => PIECE_SEED_BASE + seedCounter++ * 977;

  const HEAD_RADIUS = 0.13;
  /**
   * The ears are drawn larger than the rat wears them in life. They are the only
   * thing that makes this piece a *head* rather than one more rounded lump, and
   * the set has two other rounded lumps in it.
   */
  const EAR_LEGIBILITY_SCALE = 1.5;

  const headPeltSeed = nextSeed();
  const headWoundSeed = nextSeed();
  const head: GorePiece = {
    state: 'gore_head',
    paint: (ctx) => {
      const r = HEAD_RADIUS;
      const earRadius = r * 0.52 * EAR_LEGIBILITY_SCALE;

      for (const side of [-1, 1]) {
        const earOutline = ovalOutline(
          side * r * 0.72,
          -r * 0.7,
          earRadius,
          earRadius * 1.05,
          0,
          4.2 + side,
          0.1,
          20,
        );
        paintBareSkin(ctx, (grow) => traceOutline(ctx, grownOutline(earOutline, grow)));
      }

      // The skull and its snout, as one wedge: a rat's head has no stop, and
      // splitting it into two lumps here would lose the only line that matters.
      const skull: Pt[] = [
        { x: -r * 1.0, y: -r * 0.5 },
        { x: -r * 0.2, y: -r * 0.92 },
        { x: r * 0.55, y: -r * 0.6 },
        { x: r * 1.35, y: -r * 0.14 },
        { x: r * 1.32, y: r * 0.3 },
        { x: r * 0.4, y: r * 0.78 },
        { x: -r * 0.62, y: r * 0.8 },
        { x: -r * 1.02, y: r * 0.22 },
      ];
      const traceSkull = (grow: number): void => traceOutline(ctx, grownOutline(skull, grow));
      paintPelt(ctx, traceSkull);
      scribblePelt(ctx, traceSkull, headPeltSeed, r * 0.8);

      // Incisors jutting from the snout tip: the one detail nothing else in the
      // set has, and the reason this cell survives a blind naming test.
      const toothX = r * 1.02;
      const toothY = r * 0.16;
      const toothLength = r * 0.52;
      ctx.fillStyle = INCISOR_ENAMEL;
      ctx.beginPath();
      ctx.moveTo(toothX, toothY - r * 0.16);
      ctx.lineTo(toothX + toothLength, toothY + r * 0.08);
      ctx.lineTo(toothX + toothLength * 0.86, toothY + r * 0.3);
      ctx.lineTo(toothX, toothY + r * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(INCISOR_ROOT, 0.8);
      ctx.lineWidth = 0.005;
      ctx.stroke();

      // One dead eye, filmed over. A live glint on a severed head is a bug.
      ctx.fillStyle = EYE_DEAD;
      ctx.beginPath();
      ctx.arc(r * 0.28, -r * 0.18, r * 0.2, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = rgba(OUTLINE_INK, 0.8);
      ctx.lineWidth = 0.006;
      ctx.stroke();

      drawWound(ctx, {
        kind: 'torn',
        centre: pt(-r * 0.88, r * 0.36),
        radius: r * 0.52,
        squash: 0.72,
        angle: deg(128),
        bones: [{ at: pt(0, 0), size: 0.6, hollow: true }],
        runAngle: deg(150),
        seed: headWoundSeed,
        hide: PELT_DARK,
      });
    },
  };

  const TORSO_HALF_W = 0.19;
  const TORSO_HALF_H = 0.115;

  const torsoPeltSeed = nextSeed();
  const torsoSpineWoundSeed = nextSeed();
  const torsoPelvisWoundSeed = nextSeed();
  const torso: GorePiece = {
    state: 'gore_torso',
    paint: (ctx) => {
      ctx.save();
      ctx.rotate(deg(12));
      const slab: Pt[] = [
        { x: -TORSO_HALF_W, y: -TORSO_HALF_H * 0.6 },
        { x: -TORSO_HALF_W * 0.4, y: -TORSO_HALF_H },
        { x: TORSO_HALF_W * 0.55, y: -TORSO_HALF_H * 0.92 },
        { x: TORSO_HALF_W, y: -TORSO_HALF_H * 0.2 },
        { x: TORSO_HALF_W * 0.82, y: TORSO_HALF_H * 0.72 },
        { x: -TORSO_HALF_W * 0.1, y: TORSO_HALF_H },
        { x: -TORSO_HALF_W * 0.88, y: TORSO_HALF_H * 0.6 },
      ];
      const traceSlab = (grow: number): void => traceOutline(ctx, grownOutline(slab, grow));
      paintPelt(ctx, traceSlab);
      scribblePelt(ctx, traceSlab, torsoPeltSeed, TORSO_HALF_W * 0.8);

      // The open gut cavity with ribs arcing over it — the piece's whole reason
      // for being distinguishable from the rib chunk is that this one is bigger
      // and its ribs stay inside the outline.
      ctx.save();
      traceSlab(0);
      ctx.clip();
      const cavity = ovalOutline(
        -TORSO_HALF_W * 0.15,
        TORSO_HALF_H * 0.15,
        TORSO_HALF_W * 0.5,
        TORSO_HALF_H * 0.6,
        0,
        3.3,
        0.12,
        22,
      );
      ctx.fillStyle = MUSCLE_DARK;
      traceOutline(ctx, cavity);
      ctx.fill();
      ctx.fillStyle = rgba(BLOOD_DARK, 0.6);
      traceOutline(ctx, grownOutline(cavity, -0.02));
      ctx.fill();

      const RIB_COUNT = 4;
      ctx.strokeStyle = BONE_CORTICAL;
      ctx.lineWidth = 0.014;
      ctx.lineCap = 'round';
      for (let i = 0; i < RIB_COUNT; i++) {
        const t = (i + 0.5) / RIB_COUNT;
        const x = lerp(-TORSO_HALF_W * 0.6, TORSO_HALF_W * 0.3, t);
        ctx.beginPath();
        ctx.arc(x, TORSO_HALF_H * 0.1, TORSO_HALF_H * 0.55, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
      ctx.restore();

      drawWound(ctx, {
        kind: 'torn',
        centre: pt(TORSO_HALF_W * 0.86, -TORSO_HALF_H * 0.35),
        radius: 0.056,
        squash: 0.66,
        angle: deg(-16),
        bones: [{ at: pt(0, 0), size: 0.55, hollow: true }],
        runAngle: deg(-24),
        seed: torsoSpineWoundSeed,
        hide: PELT_DARK,
      });
      drawWound(ctx, {
        kind: 'crushed',
        centre: pt(-TORSO_HALF_W * 0.82, TORSO_HALF_H * 0.42),
        radius: 0.05,
        squash: 0.8,
        angle: deg(160),
        bones: [{ at: pt(0, 0), size: 0.5 }],
        runAngle: deg(168),
        seed: torsoPelvisWoundSeed,
        hide: PELT_DARK,
      });
      ctx.restore();
    },
  };

  /**
   * The haunch is the only piece drawn as a bent L. Nothing else in the set has
   * a concave side, and that is what a blind naming test picks it out by.
   */
  const haunchPeltSeed = nextSeed();
  const haunchWoundSeed = nextSeed();
  const haunch: GorePiece = {
    state: 'gore_haunch',
    paint: (ctx) => {
      const thighRoot = pt(-0.075, -0.095);
      const knee = pt(0.075, -0.02);
      const foot = pt(0.005, 0.145);

      const traceThigh = (grow: number): void =>
        traceSegment(ctx, thighRoot, knee, 0.062, 0.036, grow);
      const traceShank = (grow: number): void => traceSegment(ctx, knee, foot, 0.036, 0.022, grow);
      paintPelt(ctx, traceShank);
      paintPelt(ctx, traceThigh);
      scribblePelt(ctx, traceThigh, haunchPeltSeed, 0.07);

      // The naked hind foot, broken hard off the shank's axis — the ankle break
      // is what turns two sticks into an L.
      ctx.save();
      ctx.translate(foot.x, foot.y);
      ctx.rotate(deg(70));
      const TOE_COUNT = 5;
      const TOE_LENGTH = 0.062;
      for (let i = 0; i < TOE_COUNT; i++) {
        const t = i / (TOE_COUNT - 1);
        const angle = lerp(deg(-38), deg(38), t);
        const length = TOE_LENGTH * lerp(0.7, 1, Math.sin(t * Math.PI));
        const tip = pt(Math.cos(angle) * length, Math.sin(angle) * length);
        paintBareSkin(ctx, (grow) => traceSegment(ctx, pt(0, 0), tip, 0.011, 0.007, grow));
      }
      ctx.restore();

      drawWound(ctx, {
        kind: 'crushed',
        centre: thighRoot,
        radius: 0.055,
        squash: 0.72,
        angle: deg(-148),
        bones: [{ at: pt(0, 0), size: 0.62 }],
        runAngle: deg(-150),
        seed: haunchWoundSeed,
        hide: PELT_DARK,
      });
    },
  };

  /** A short, thin, near-straight stick — the opposite of the haunch by design. */
  const forelegPeltSeed = nextSeed();
  const forelegWoundSeed = nextSeed();
  const foreleg: GorePiece = {
    state: 'gore_foreleg',
    paint: (ctx) => {
      const shoulder = pt(-0.1, -0.075);
      const elbow = pt(0.02, 0.01);
      const wrist = pt(0.095, 0.075);

      paintPelt(ctx, (grow) => traceSegment(ctx, elbow, wrist, 0.028, 0.019, grow));
      const traceUpper = (grow: number): void =>
        traceSegment(ctx, shoulder, elbow, 0.042, 0.028, grow);
      paintPelt(ctx, traceUpper);
      scribblePelt(ctx, traceUpper, forelegPeltSeed, 0.05);

      ctx.save();
      ctx.translate(wrist.x, wrist.y);
      ctx.rotate(deg(-28));
      const TOE_COUNT = 4;
      const TOE_LENGTH = 0.05;
      for (let i = 0; i < TOE_COUNT; i++) {
        const t = i / (TOE_COUNT - 1);
        const angle = lerp(deg(-34), deg(34), t);
        const length = TOE_LENGTH * lerp(0.7, 1, Math.sin(t * Math.PI));
        const tip = pt(Math.cos(angle) * length, Math.sin(angle) * length);
        paintBareSkin(ctx, (grow) => traceSegment(ctx, pt(0, 0), tip, 0.01, 0.006, grow));
      }
      ctx.restore();

      drawWound(ctx, {
        kind: 'clean',
        centre: shoulder,
        radius: 0.042,
        squash: 0.7,
        angle: deg(-145),
        bones: [
          { at: pt(-0.2, -0.1), size: 0.42 },
          { at: pt(0.28, 0.16), size: 0.3 },
        ],
        runAngle: deg(-140),
        seed: forelegWoundSeed,
        hide: PELT_DARK,
      });
    },
  };

  /**
   * The tail: a long thin whip with scale rings. It is the most identifiable
   * piece in the set by a distance — nothing else here is even close to this
   * aspect ratio — and it is the reason a rat's gore reads as a *rat's*.
   */
  const TAIL_SPAN = 0.2;

  const tailWoundSeed = nextSeed();
  const tail: GorePiece = {
    state: 'gore_tail',
    paint: (ctx) => {
      const SEGMENTS = 12;
      const spine: Pt[] = [];
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        // An S-curve rather than an arc: a severed tail that traces a single arc
        // reads as a claw, and the set does not need another crescent.
        spine.push(pt(lerp(-TAIL_SPAN, TAIL_SPAN, t), Math.sin(t * Math.PI * 1.6) * 0.085 - 0.02));
      }
      const widthAt = (t: number): number => lerp(0.034, 0.008, Math.pow(t, 0.6));

      const traceTail = (grow: number): void => {
        const left: Pt[] = [];
        const right: Pt[] = [];
        for (let i = 0; i <= SEGMENTS; i++) {
          const prev = spine[Math.max(0, i - 1)];
          const next = spine[Math.min(SEGMENTS, i + 1)];
          const angle = Math.atan2(next.y - prev.y, next.x - prev.x);
          const w = widthAt(i / SEGMENTS) + grow;
          left.push(pt(spine[i].x - Math.sin(angle) * w, spine[i].y + Math.cos(angle) * w));
          right.push(pt(spine[i].x + Math.sin(angle) * w, spine[i].y - Math.cos(angle) * w));
        }
        traceOutline(ctx, [...left, ...right.reverse()]);
      };

      paintBareSkin(ctx, traceTail);

      ctx.save();
      traceTail(0);
      ctx.clip();
      const RING_COUNT = 14;
      ctx.strokeStyle = rgba(SKIN.shadow, 0.45);
      ctx.lineWidth = 0.006;
      for (let i = 0; i < RING_COUNT; i++) {
        const t = (i + 0.5) / RING_COUNT;
        const index = Math.min(SEGMENTS - 1, Math.floor(t * SEGMENTS));
        const p = spine[index];
        const next = spine[index + 1];
        const angle = Math.atan2(next.y - p.y, next.x - p.x);
        const w = widthAt(t) * 1.4;
        ctx.beginPath();
        ctx.moveTo(p.x - Math.sin(angle) * w, p.y + Math.cos(angle) * w);
        ctx.lineTo(p.x + Math.sin(angle) * w, p.y - Math.cos(angle) * w);
        ctx.stroke();
      }
      ctx.restore();

      drawWound(ctx, {
        kind: 'torn',
        centre: spine[0],
        radius: 0.034,
        squash: 0.62,
        angle: deg(-172),
        bones: [],
        runAngle: deg(-176),
        seed: tailWoundSeed,
        hide: PELT_DARK,
      });
    },
  };

  const RIB_HALF_W = 0.115;
  const RIB_HALF_H = 0.05;
  /** The only piece whose bone breaks its own outline; that is its signature. */
  const RIB_STUB_REACH = 1.35;

  const ribPeltSeed = nextSeed();
  const ribWoundSeed = nextSeed();
  const ribchunk: GorePiece = {
    state: 'gore_ribchunk',
    paint: (ctx) => {
      ctx.save();
      ctx.rotate(deg(-34));
      const slab: Pt[] = [
        { x: -RIB_HALF_W, y: -RIB_HALF_H * 0.5 },
        { x: -RIB_HALF_W * 0.3, y: -RIB_HALF_H },
        { x: RIB_HALF_W * 0.7, y: -RIB_HALF_H * 0.8 },
        { x: RIB_HALF_W, y: RIB_HALF_H * 0.1 },
        { x: RIB_HALF_W * 0.5, y: RIB_HALF_H },
        { x: -RIB_HALF_W * 0.6, y: RIB_HALF_H * 0.86 },
      ];
      const traceSlab = (grow: number): void => traceOutline(ctx, grownOutline(slab, grow));

      const RIB_COUNT = 3;
      ctx.strokeStyle = BONE_CORTICAL;
      ctx.lineWidth = 0.015;
      ctx.lineCap = 'round';
      for (let i = 0; i < RIB_COUNT; i++) {
        const t = (i + 0.5) / RIB_COUNT;
        const x = lerp(-RIB_HALF_W * 0.55, RIB_HALF_W * 0.45, t);
        ctx.beginPath();
        ctx.moveTo(x, RIB_HALF_H * 0.4);
        ctx.quadraticCurveTo(
          x + RIB_HALF_W * 0.16,
          -RIB_HALF_H * RIB_STUB_REACH,
          x + RIB_HALF_W * 0.34,
          -RIB_HALF_H * RIB_STUB_REACH * 1.25,
        );
        ctx.stroke();
      }

      paintPelt(ctx, traceSlab);
      scribblePelt(ctx, traceSlab, ribPeltSeed, RIB_HALF_W * 0.7);

      drawWound(ctx, {
        kind: 'crushed',
        centre: pt(0, RIB_HALF_H * 0.2),
        radius: 0.05,
        squash: 0.85,
        angle: deg(20),
        bones: [
          { at: pt(-0.3, 0), size: 0.36, hollow: true },
          { at: pt(0.34, 0.12), size: 0.3, hollow: true },
        ],
        runAngle: deg(96),
        seed: ribWoundSeed,
        hide: PELT_DARK,
      });
      ctx.restore();
    },
  };

  /** A rope of gut: the only piece with no wound face and no bone in it. */
  const entrails: GorePiece = {
    state: 'gore_entrails',
    paint: (ctx) => {
      const LOOP = 0.115;
      const TUBE = 0.03;
      const path: Pt[] = [
        pt(-LOOP, LOOP * 0.35),
        pt(-LOOP * 0.35, -LOOP * 0.8),
        pt(LOOP * 0.4, LOOP * 0.15),
        pt(LOOP * 0.95, -LOOP * 0.55),
      ];

      const traceGut = (width: number): void => {
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) {
          const prev = path[i - 1];
          const cur = path[i];
          ctx.quadraticCurveTo(prev.x + (cur.x - prev.x) * 0.2, cur.y, cur.x, cur.y);
        }
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      };

      traceGut(TUBE * 2 + FLESH_OUTLINE_GROW * 2);
      ctx.strokeStyle = OUTLINE_INK;
      ctx.stroke();
      traceGut(TUBE * 2);
      ctx.strokeStyle = mix(MUSCLE_LIGHT, SUBCUTANEOUS, 0.4);
      ctx.stroke();
      traceGut(TUBE * 1.1);
      ctx.strokeStyle = rgba(MUSCLE_MID, 0.75);
      ctx.stroke();

      // Segment ticks across the tube: without them the rope is a bent noodle.
      const SEGMENT_TICKS = 7;
      ctx.strokeStyle = rgba(MUSCLE_SHADOW, 0.55);
      ctx.lineWidth = 0.007;
      for (let i = 0; i < SEGMENT_TICKS; i++) {
        const t = (i + 0.5) / SEGMENT_TICKS;
        const index = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
        const local = t * (path.length - 1) - index;
        const a = path[index];
        const b = path[index + 1];
        const x = lerp(a.x, b.x, local);
        const y = lerp(a.y, b.y, local);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        ctx.beginPath();
        ctx.moveTo(x - Math.sin(angle) * TUBE, y + Math.cos(angle) * TUBE);
        ctx.lineTo(x + Math.sin(angle) * TUBE, y - Math.cos(angle) * TUBE);
        ctx.stroke();
      }

      const GLOSS_COUNT = 4;
      ctx.fillStyle = BLOOD_GLOSS;
      for (let i = 0; i < GLOSS_COUNT; i++) {
        const t = (i + 0.5) / GLOSS_COUNT;
        const index = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
        const local = t * (path.length - 1) - index;
        const a = path[index];
        const b = path[index + 1];
        ctx.beginPath();
        ctx.ellipse(
          lerp(a.x, b.x, local),
          lerp(a.y, b.y, local) - TUBE * 0.4,
          TUBE * 0.5,
          TUBE * 0.2,
          deg(-18),
          0,
          TWO_PI,
        );
        ctx.fill();
      }
    },
  };

  /**
   * A flayed strip of hide, folded so the wet underside shows. It carries the
   * only large area of unbroken fur in the set, which is what stops eight cells
   * of tumbling meat from reading as generic debris rather than as an animal.
   */
  const peltScribbleSeed = nextSeed();
  const peltWoundSeed = nextSeed();
  const pelt: GorePiece = {
    state: 'gore_pelt',
    paint: (ctx) => {
      const HALF_W = 0.145;
      const HALF_H = 0.085;
      // A flayed strip of hide, ragged on every edge and folded at one corner.
      const strip: Pt[] = [];
      const STRIP_STEPS = 16;
      for (let i = 0; i < STRIP_STEPS; i++) {
        const angle = (i / STRIP_STEPS) * TWO_PI;
        const ragged = 1 + 0.22 * Math.sin(angle * 5 + 1.7) + 0.12 * Math.sin(angle * 9);
        strip.push(pt(Math.cos(angle) * HALF_W * ragged, Math.sin(angle) * HALF_H * ragged));
      }
      const traceStrip = (grow: number): void => traceOutline(ctx, grownOutline(strip, grow));
      paintPelt(ctx, traceStrip);
      scribblePelt(ctx, traceStrip, peltScribbleSeed, HALF_W * 0.85);

      // The underside showing through the fold — the wet side of a hide is the
      // cue that says "skin off an animal" rather than "flat brown chip".
      ctx.save();
      traceStrip(0);
      ctx.clip();
      ctx.fillStyle = rgba(SUBCUTANEOUS, 0.85);
      ctx.beginPath();
      ctx.moveTo(HALF_W * 0.1, -HALF_H);
      ctx.quadraticCurveTo(HALF_W * 0.8, -HALF_H * 0.2, HALF_W, HALF_H);
      ctx.lineTo(HALF_W * 1.2, -HALF_H * 1.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(BLOOD_DARK, 0.6);
      ctx.lineWidth = 0.008;
      ctx.beginPath();
      ctx.moveTo(HALF_W * 0.1, -HALF_H);
      ctx.quadraticCurveTo(HALF_W * 0.8, -HALF_H * 0.2, HALF_W, HALF_H);
      ctx.stroke();
      ctx.restore();

      drawWound(ctx, {
        kind: 'clean',
        centre: pt(-HALF_W * 0.55, HALF_H * 0.3),
        radius: 0.04,
        squash: 0.9,
        angle: deg(-150),
        bones: [{ at: pt(0, 0), size: 0.34, hollow: true }],
        runAngle: deg(-158),
        seed: peltWoundSeed,
        hide: PELT_DARK,
      });
    },
  };

  return [head, torso, haunch, foreleg, tail, ribchunk, entrails, pelt];
}
