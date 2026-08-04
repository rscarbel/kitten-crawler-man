/**
 * The eight pieces a Brindled Vespa comes apart into.
 *
 * Modelled directly on `scripts/mantidGore.ts`: the cut face itself lives in
 * `scripts/goreWound.ts` and every wound below routes through it, so a
 * dismembered hornet's injuries are recognisably the same ones a dismembered
 * mantis or rat has. What is here is each piece's shape, its chitin, and the
 * pale hemolymph that runs out of an insect rather than the red that runs out
 * of a mammal — the same reasoning `mantidGore.ts` documents at length.
 *
 * The eight: the head (mandibles and one dulled eye trailing), the thorax
 * (where the legs socketed), the banded abdomen, the curved stinger snapped
 * free on its own, one wing, one leg, an antenna, and a coil of entrails. Eight
 * cells tumbling past at 16 px must not read as eight identical chips, and this
 * spread — a hooked stinger, a banded cone, a ragged translucent sheet, a thin
 * zigzag leg — is chosen for silhouette variety the same way the mantis set is.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import {
  TWO_PI,
  deg,
  hash1,
  lerp,
  mix,
  rgba,
  segmentOutline,
  traceOutline,
  type Pt,
  type VespaBuild,
} from './brindledVespaArt.js';
import {
  AMBIENT_ALPHA,
  FLESH_AMBIENT_INSET,
  FLESH_OUTLINE_GROW,
  FLESH_RIM_INSET,
  FLESH_RIM_WIDTH,
  RIM_ALPHA,
  drawWound,
  grownOutline,
  type CutSpec,
} from './goreWound.js';

const HEMOLYMPH = '#c9d06a';
const HEMOLYMPH_DARK = '#61692a';
const HEMOLYMPH_GLOSS = 'rgba(244,248,196,0.55)';
const VISCERA_MID = '#8f7a4a';
const VISCERA_DARK = '#463a1e';
const VISCERA_LIGHT = '#c3b479';

const PIECE_DARKEN = 0.35;

interface PieceTones {
  readonly mid: string;
  readonly dark: string;
  readonly light: string;
  readonly ink: string;
}

function chitinTones(build: VespaBuild): PieceTones {
  const { palette } = build;
  return {
    mid: mix(palette.base, palette.dark, PIECE_DARKEN),
    dark: palette.dark,
    light: mix(palette.light, palette.dark, PIECE_DARKEN * 0.6),
    ink: palette.ink,
  };
}

type Trace = (grow: number) => void;

function traceFor(ctx: Ctx, outline: readonly Pt[]): Trace {
  return (grow: number) => {
    traceOutline(ctx, grow === 0 ? outline : grownOutline(outline, grow));
  };
}

function paintMass(ctx: Ctx, trace: Trace, tones: PieceTones): void {
  ctx.fillStyle = tones.ink;
  trace(FLESH_OUTLINE_GROW);
  ctx.fill();
  ctx.fillStyle = tones.mid;
  trace(0);
  ctx.fill();

  ctx.save();
  trace(0);
  ctx.clip();
  ctx.fillStyle = rgba(tones.dark, AMBIENT_ALPHA);
  ctx.fillRect(-1, -1, 2, 2);
  ctx.fillStyle = rgba(tones.light, AMBIENT_ALPHA * 1.4);
  trace(-FLESH_AMBIENT_INSET);
  ctx.fill();
  ctx.restore();

  ctx.save();
  trace(-FLESH_RIM_INSET);
  ctx.clip();
  ctx.strokeStyle = rgba(tones.light, RIM_ALPHA);
  ctx.lineWidth = FLESH_RIM_WIDTH;
  trace(-FLESH_RIM_INSET);
  ctx.stroke();
  ctx.restore();
}

function paintChitinMass(ctx: Ctx, trace: Trace, build: VespaBuild): void {
  paintMass(ctx, trace, chitinTones(build));
}

const WOUND_WASH_ALPHA = 0.5;

function washWound(ctx: Ctx, centre: Pt, radius: number, angle: number, squash: number): void {
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(angle);
  ctx.scale(1, squash);
  const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  wash.addColorStop(0, rgba(HEMOLYMPH, WOUND_WASH_ALPHA));
  wash.addColorStop(0.7, rgba(HEMOLYMPH_DARK, WOUND_WASH_ALPHA * 0.8));
  wash.addColorStop(1, rgba(HEMOLYMPH_DARK, 0));
  ctx.fillStyle = wash;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function cutAndWash(ctx: Ctx, cut: CutSpec): void {
  drawWound(ctx, cut);
  washWound(ctx, cut.centre, cut.radius, cut.angle, cut.squash);
}

function paintHemolymph(ctx: Ctx, from: Pt, runAngle: number, seed: number, reach: number): void {
  const RUNS = 4;
  ctx.lineCap = 'round';
  for (let i = 0; i < RUNS; i++) {
    const spread = (hash1(seed + i * 3.1) - 0.5) * deg(70);
    const angle = runAngle + spread;
    const len = reach * (0.5 + hash1(seed + i * 7.3) * 0.8);
    const width = 0.006 + hash1(seed + i * 5.7) * 0.008;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(
      from.x + Math.cos(angle) * len * 0.5 - Math.sin(angle) * len * 0.2,
      from.y + Math.sin(angle) * len * 0.5 + Math.cos(angle) * len * 0.2,
      from.x + Math.cos(angle) * len,
      from.y + Math.sin(angle) * len,
    );
    ctx.strokeStyle = rgba(i % 2 === 0 ? HEMOLYMPH : HEMOLYMPH_DARK, 0.85);
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(from.x + Math.cos(angle) * len, from.y + Math.sin(angle) * len, width * 0.9, 0, TWO_PI);
    ctx.fillStyle = rgba(HEMOLYMPH, 0.9);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(from.x, from.y, reach * 0.16, 0, TWO_PI);
  ctx.fillStyle = HEMOLYMPH_GLOSS;
  ctx.fill();
}

export interface VespaGorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx, build: VespaBuild) => void;
}

const PIECE_SEED_BASE = 6173;

/**
 * The eight pieces, in the order `BodyPartGoreSystem` spawns them.
 *
 * Seeds are drawn here, at construction, for the same reason `mantidGore.ts`
 * draws them here rather than inside a `paint` closure: the bake paints every
 * piece more than once (measure, then render), and a counter advanced during
 * painting would hand each pass a different picture.
 */
export function brindledVespaGorePieces(): readonly VespaGorePiece[] {
  let seedCounter = 0;
  const nextSeed = (): number => PIECE_SEED_BASE + seedCounter++ * 733;

  const headSeed = nextSeed();
  const headWoundSeed = nextSeed();
  const head: VespaGorePiece = {
    state: 'gore_head',
    paint: (ctx, build) => {
      const R = 0.09;
      const outline: Pt[] = [];
      const STEPS = 16;
      for (let i = 0; i < STEPS; i++) {
        const a = (i / STEPS) * TWO_PI;
        outline.push({ x: Math.cos(a) * R, y: Math.sin(a) * R * 0.86 });
      }
      paintChitinMass(ctx, traceFor(ctx, outline), build);

      for (const sign of [-1, 1]) {
        const ex = sign * R * 0.55;
        const ey = -R * 0.1;
        ctx.beginPath();
        ctx.ellipse(ex, ey, R * 0.32, R * 0.36, 0, 0, TWO_PI);
        ctx.fillStyle = mix(build.palette.eye, '#000000', 0.4);
        ctx.fill();
        ctx.strokeStyle = rgba(build.palette.ink, 0.85);
        ctx.lineWidth = 0.007;
        ctx.stroke();
      }

      // One trailing antenna — two would be tidy, one says it was torn off.
      ctx.beginPath();
      ctx.moveTo(R * 0.2, -R * 0.8);
      ctx.quadraticCurveTo(R * 1.4, -R * 1.3, R * 1.0, -R * 1.8);
      ctx.strokeStyle = rgba(build.palette.ink, 0.85);
      ctx.lineWidth = 0.008;
      ctx.lineCap = 'round';
      ctx.stroke();

      cutAndWash(ctx, {
        kind: 'torn',
        centre: { x: R * 0.9, y: R * 0.15 },
        radius: 0.048,
        squash: 0.82,
        angle: deg(6),
        bones: [{ at: { x: 0, y: 0 }, size: 0.36, hollow: true }],
        runAngle: deg(20),
        seed: headWoundSeed,
        hide: build.palette.dark,
      });
      paintHemolymph(ctx, { x: R * 0.95, y: R * 0.15 }, deg(20), headSeed, 0.1);
    },
  };

  const thoraxSeed = nextSeed();
  const thoraxWoundSeed = nextSeed();
  const thorax: VespaGorePiece = {
    state: 'gore_thorax',
    paint: (ctx, build) => {
      const outline: Pt[] = [];
      const RX = 0.1;
      const RY = 0.085;
      const STEPS = 18;
      for (let i = 0; i < STEPS; i++) {
        const a = (i / STEPS) * TWO_PI;
        outline.push({ x: Math.cos(a) * RX, y: Math.sin(a) * RY });
      }
      paintChitinMass(ctx, traceFor(ctx, outline), build);

      // Stumps of the six legs, snapped off close to the body.
      for (const sign of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const angle = deg(60) + sign * deg(20) * i;
          const bx = Math.cos(angle) * RX * 0.7;
          const by = Math.sin(angle) * RY * 0.7 + RY * 0.4;
          ctx.beginPath();
          ctx.arc(bx, by, 0.014, 0, TWO_PI);
          ctx.fillStyle = rgba(build.palette.ink, 0.7);
          ctx.fill();
        }
      }

      cutAndWash(ctx, {
        kind: 'crushed',
        centre: { x: -RX * 0.6, y: 0 },
        radius: 0.058,
        squash: 0.85,
        angle: deg(180),
        bones: [{ at: { x: 0, y: 0 }, size: 0.4, hollow: true }],
        runAngle: deg(190),
        seed: thoraxWoundSeed,
        hide: build.palette.dark,
      });
      paintHemolymph(ctx, { x: -RX * 0.75, y: 0 }, deg(190), thoraxSeed, 0.12);
    },
  };

  const abdomenSeed = nextSeed();
  const abdomenWoundSeed = nextSeed();
  const abdomen: VespaGorePiece = {
    state: 'gore_abdomen',
    paint: (ctx, build) => {
      const root: Pt = { x: -0.16, y: 0.02 };
      const tip: Pt = { x: 0.17, y: -0.03 };
      const mid: Pt = { x: (root.x + tip.x) / 2, y: (root.y + tip.y) / 2 };
      const bulge = segmentOutline(root, mid, 0.075, 0.1, 0.012);
      const taper = segmentOutline(mid, tip, 0.1, 0.014, 0.012);
      paintChitinMass(ctx, traceFor(ctx, bulge), build);
      paintChitinMass(ctx, traceFor(ctx, taper), build);

      ctx.save();
      traceOutline(ctx, [...bulge, ...taper]);
      ctx.clip();
      for (let b = 1; b <= 4; b++) {
        const t = b / 5;
        const cx = lerp(root.x, tip.x, t);
        const cy = lerp(root.y, tip.y, t);
        const half = lerp(0.09, 0.02, t) * 1.3;
        ctx.beginPath();
        ctx.moveTo(cx, cy - half);
        ctx.lineTo(cx, cy + half);
        ctx.strokeStyle = rgba(build.palette.band, 0.75);
        ctx.lineWidth = 0.024;
        ctx.stroke();
      }
      ctx.restore();

      cutAndWash(ctx, {
        kind: 'torn',
        centre: root,
        radius: 0.062,
        squash: 0.8,
        angle: deg(-8),
        bones: [],
        runAngle: deg(-172),
        seed: abdomenWoundSeed,
        hide: build.palette.dark,
      });
      paintHemolymph(ctx, root, deg(-172), abdomenSeed, 0.12);
    },
  };

  const stingerSeed = nextSeed();
  const stinger: VespaGorePiece = {
    state: 'gore_stinger',
    paint: (ctx, build) => {
      const root: Pt = { x: -0.12, y: 0.04 };
      const tip: Pt = { x: 0.13, y: -0.06 };
      const outline = segmentOutline(root, tip, 0.032, 0.004, 0.03);
      paintChitinMass(ctx, traceFor(ctx, outline), build);
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 0.012, 0, TWO_PI);
      ctx.fillStyle = build.palette.stinger;
      ctx.fill();

      cutAndWash(ctx, {
        kind: 'clean',
        centre: root,
        radius: 0.032,
        squash: 0.88,
        angle: deg(150),
        bones: [{ at: { x: 0, y: 0 }, size: 0.45, hollow: true }],
        runAngle: deg(160),
        seed: stingerSeed,
        hide: build.palette.dark,
      });
      paintHemolymph(ctx, root, deg(160), stingerSeed + 1.3, 0.08);
    },
  };

  const wingSeed = nextSeed();
  const wing: VespaGorePiece = {
    state: 'gore_wing',
    paint: (ctx, build) => {
      const root: Pt = { x: -0.15, y: 0.06 };
      const len = 0.32;
      const angle = deg(-14);
      const STEPS = 16;
      const half = 0.11;
      const outline: Pt[] = [];
      const edge = (t: number): number => Math.sin(Math.min(1, t * 1.1) * Math.PI * 0.6) * half;
      for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        outline.push({
          x: root.x + Math.cos(angle) * len * t - Math.sin(angle) * edge(t) * 0.3,
          y: root.y + Math.sin(angle) * len * t + Math.cos(angle) * edge(t) * 0.3,
        });
      }
      for (let i = STEPS; i >= 0; i--) {
        const t = i / STEPS;
        const notch = Math.max(0, hash1(wingSeed + i) - 0.5) * 0.18;
        outline.push({
          x: root.x + Math.cos(angle) * len * t + Math.sin(angle) * (edge(t) - notch),
          y: root.y + Math.sin(angle) * len * t - Math.cos(angle) * (edge(t) - notch),
        });
      }
      ctx.save();
      traceOutline(ctx, outline);
      ctx.fillStyle = rgba(build.palette.wing, 0.55);
      ctx.fill();
      ctx.strokeStyle = rgba(build.palette.ink, 0.55);
      ctx.lineWidth = 0.008;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(root.x, root.y);
      ctx.lineTo(root.x + Math.cos(angle) * len, root.y + Math.sin(angle) * len);
      ctx.strokeStyle = rgba(build.palette.ink, 0.5);
      ctx.lineWidth = 0.006;
      ctx.stroke();
      ctx.restore();

      cutAndWash(ctx, {
        kind: 'torn',
        centre: root,
        radius: 0.032,
        squash: 0.7,
        angle: deg(70),
        bones: [],
        runAngle: deg(150),
        seed: wingSeed + 2.1,
        hide: build.palette.dark,
      });
      paintHemolymph(ctx, root, deg(150), wingSeed, 0.07);
    },
  };

  const legSeed = nextSeed();
  const legWoundSeed = nextSeed();
  const leg: VespaGorePiece = {
    state: 'gore_leg',
    paint: (ctx, build) => {
      const hip: Pt = { x: -0.13, y: 0.13 };
      const knee: Pt = { x: 0.04, y: -0.15 };
      const foot: Pt = { x: 0.14, y: 0.12 };
      const upper = segmentOutline(hip, knee, 0.016, 0.011, 0.009);
      const lower = segmentOutline(knee, foot, 0.011, 0.006, -0.007);
      paintChitinMass(ctx, traceFor(ctx, upper), build);
      paintChitinMass(ctx, traceFor(ctx, lower), build);

      cutAndWash(ctx, {
        kind: 'clean',
        centre: hip,
        radius: 0.02,
        squash: 0.9,
        angle: deg(-58),
        bones: [{ at: { x: 0, y: 0 }, size: 0.5, hollow: true }],
        runAngle: deg(140),
        seed: legWoundSeed,
        hide: build.palette.dark,
      });
      paintHemolymph(ctx, hip, deg(140), legSeed, 0.08);
    },
  };

  const antennaSeed = nextSeed();
  const antenna: VespaGorePiece = {
    state: 'gore_antenna',
    paint: (ctx, build) => {
      const root: Pt = { x: -0.14, y: 0.03 };
      const tip: Pt = { x: 0.15, y: -0.09 };
      const outline = segmentOutline(root, tip, 0.012, 0.003, 0.05);
      paintChitinMass(ctx, traceFor(ctx, outline), build);

      cutAndWash(ctx, {
        kind: 'torn',
        centre: root,
        radius: 0.016,
        squash: 0.85,
        angle: deg(160),
        bones: [],
        runAngle: deg(172),
        seed: antennaSeed,
        hide: build.palette.dark,
      });
      paintHemolymph(ctx, root, deg(172), antennaSeed + 1.7, 0.05);
    },
  };

  const gutSeed = nextSeed();
  const gut: VespaGorePiece = {
    state: 'gore_entrails',
    paint: (ctx) => {
      const CONSTRICTIONS = 6;
      const INNER_RADIUS = 0.033;
      const OUTER_RADIUS = 0.19;
      const OUTLINE_WIDTH = 0.045;
      const BODY_WIDTH = 0.032;
      const SHEEN_WIDTH = 0.012;
      const COIL_SQUASH = 0.72;
      const radiusAt = (t: number): number => lerp(INNER_RADIUS, OUTER_RADIUS, t);
      const turns = (OUTER_RADIUS - INNER_RADIUS) / (OUTLINE_WIDTH * 1.5);
      const SEGMENTS_PER_TURN = 24;
      const STEPS = Math.ceil(turns * SEGMENTS_PER_TURN);

      const traceSpiral = (): void => {
        ctx.beginPath();
        for (let i = 0; i <= STEPS; i++) {
          const t = i / STEPS;
          const a = t * TWO_PI * turns;
          const r = radiusAt(t);
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r * COIL_SQUASH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      };

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      traceSpiral();
      ctx.strokeStyle = '#221f10';
      ctx.lineWidth = OUTLINE_WIDTH;
      ctx.stroke();
      traceSpiral();
      ctx.strokeStyle = VISCERA_MID;
      ctx.lineWidth = BODY_WIDTH;
      ctx.stroke();
      traceSpiral();
      ctx.strokeStyle = rgba(VISCERA_LIGHT, 0.5);
      ctx.lineWidth = SHEEN_WIDTH;
      ctx.stroke();

      for (let i = 0; i < CONSTRICTIONS; i++) {
        const t = (i + 0.5) / CONSTRICTIONS;
        const a = t * TWO_PI * turns;
        const r = radiusAt(t);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r * COIL_SQUASH, BODY_WIDTH * 0.4, 0, TWO_PI);
        ctx.fillStyle = rgba(VISCERA_DARK, 0.55);
        ctx.fill();
      }
      paintHemolymph(ctx, { x: OUTER_RADIUS * 0.8, y: 0 }, deg(20), gutSeed, 0.09);
    },
  };

  return [head, thorax, abdomen, stinger, wing, leg, antenna, gut];
}
