/**
 * The eight pieces a cow comes apart into.
 *
 * The cut faces are not here — `goreWound.ts` owns them, and every wound below
 * routes through it so a dismembered cow's injuries are the same injuries the
 * rest of the bestiary shows. What is here is the shape of each piece and the
 * hide on it, in the look's own colours: a Jersey drops fawn pieces and a
 * Holstein drops patched ones.
 *
 * The set is chosen for **silhouette**, so eight cells tumbling past at 16 px do
 * not read as eight red blobs: a wedge head with an ear and the square muzzle,
 * a shoulder on a whole straight foreleg ending in a cloven hoof, a shoulder
 * snapped at the knee with the bone out, a ham on a hind leg with its hock
 * angle, a ham with the thigh bone showing, a pale ribbed slab, a long thin
 * tail with its tuft (nothing else in the bestiary drops that), and a flat
 * ragged sheet of hide.
 *
 * All drawing is in piece units — tile units of an adult — about an arbitrary
 * origin; each piece reports the centre of its own outline, and the figure
 * places that centre on the middle of the cell, because the gore field spins a
 * piece about the centre of its ink.
 */

import { type CowLook, boundsOfPoints, hash1, ovalPoints, traceSmooth } from './cowArt';
import { type Pt, deg, lerp, mix, rgba } from './carlArt';
import {
  BLOOD_DARK,
  BONE_CORTICAL,
  BONE_SHADOW,
  MUSCLE_DARK,
  MUSCLE_LIGHT,
  MUSCLE_MID,
  drawBoneBreak,
  drawWound,
  grownOutline,
  paintGoreMass,
} from './goreWound';

type Ctx = CanvasRenderingContext2D;

/** One severed piece: its state name, the centre of its outline, and its painter. */
export interface CowGorePiece {
  readonly state: string;
  readonly centre: Pt;
  readonly paint: (ctx: Ctx) => void;
}

/**
 * The piece names, in the order `BodyPartGoreSystem` spawns them. The runtime
 * list in `cowSprite.ts` is this one, so a rename here is a missing piece there
 * rather than a silent no-op.
 */
export const COW_GORE_STATES = [
  'gore_head',
  'gore_forequarter_left',
  'gore_forequarter_right',
  'gore_hindquarter_left',
  'gore_hindquarter_right',
  'gore_ribs',
  'gore_tail',
  'gore_hide',
] as const;

type GoreState = (typeof COW_GORE_STATES)[number];

const PIECE_SEED_BASE = 5519;
const HIDE_SLANT = deg(-24);
const SEED_STRIDE = 977;

/** A tapered capsule between two points, for limb segments. */
function segmentOutline(a: Pt, b: Pt, halfA: number, halfB: number, seed: number): Pt[] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const nx = Math.cos(angle - Math.PI / 2);
  const ny = Math.sin(angle - Math.PI / 2);
  const STEPS = 10;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const x = lerp(a.x, b.x, t);
    const y = lerp(a.y, b.y, t);
    const half = lerp(halfA, halfB, t) * (1 + 0.08 * Math.sin(t * 7 + seed));
    left.push({ x: x + nx * half, y: y + ny * half });
    right.push({ x: x - nx * half, y: y - ny * half });
  }
  return [...left, ...right.reverse()];
}

function centreOf(outlines: ReadonlyArray<readonly Pt[]>): Pt {
  const box = boundsOfPoints(outlines.flat());
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/**
 * Builds the eight pieces for one look. Seeds are drawn here, at construction,
 * and never inside a paint closure: a counter advanced while painting would give
 * the same cell a different picture each time it was baked.
 */
export function cowGorePieces(look: CowLook): readonly CowGorePiece[] {
  const { hide } = look;
  const seedOf = (index: number): number => PIECE_SEED_BASE + index * SEED_STRIDE;
  const tone = { mid: hide.base, dark: hide.shadow, light: hide.light };
  const meat = { mid: MUSCLE_MID, dark: MUSCLE_DARK, light: MUSCLE_LIGHT };
  const ink = hide.ink;

  const traceOf =
    (ctx: Ctx, outline: readonly Pt[]) =>
    (grow: number): void =>
      traceSmooth(ctx, grownOutline(outline, grow));

  /** Hide with its markings, clipped to a piece. */
  const paintHide = (ctx: Ctx, outline: readonly Pt[], seed: number, patchScale: number): void => {
    const trace = traceOf(ctx, outline);
    paintGoreMass(ctx, trace, tone, ink);
    const patch = hide.patch;
    if (patch === null || hide.patchCover <= 0) return;
    ctx.save();
    try {
      trace(0);
      ctx.clip();
      const box = boundsOfPoints(outline);
      const PATCHES = 2;
      for (let i = 0; i < PATCHES; i++) {
        const x = lerp(box.minX, box.maxX, 0.2 + 0.6 * hash1(seed + i * 3.1));
        const y = lerp(box.minY, box.maxY, 0.2 + 0.6 * hash1(seed + i * 5.3));
        traceSmooth(
          ctx,
          ovalPoints(x, y, patchScale, patchScale * 0.75, hash1(seed + i) * 3, 0.25, seed + i, 20),
        );
        ctx.fillStyle = patch;
        ctx.fill();
      }
    } finally {
      ctx.restore();
    }
  };

  const hoof = (ctx: Ctx, at: Pt, angle: number, width: number): void => {
    ctx.save();
    try {
      ctx.translate(at.x, at.y);
      ctx.rotate(angle);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * 0.004, 0);
        ctx.lineTo(side * width, 0);
        ctx.lineTo(side * width * 1.15, width * 1.3);
        ctx.lineTo(side * 0.004, width * 1.3);
        ctx.closePath();
        ctx.strokeStyle = rgba(ink, 0.95);
        ctx.lineWidth = 0.014;
        ctx.stroke();
        ctx.fillStyle = hide.hoof;
        ctx.fill();
      }
    } finally {
      ctx.restore();
    }
  };

  const pieces: Record<GoreState, CowGorePiece> = {
    gore_head: (() => {
      const seed = seedOf(0);
      const L = 0.34;
      const D = 0.2;
      const skull: Pt[] = [
        { x: -0.5 * L, y: -0.5 * D },
        { x: 0.3 * L, y: -0.52 * D },
        { x: 0.5 * L, y: -0.3 * D },
        { x: 0.56 * L, y: 0.05 * D },
        { x: 0.48 * L, y: 0.34 * D },
        { x: 0.1 * L, y: 0.42 * D },
        { x: -0.3 * L, y: 0.55 * D },
        { x: -0.56 * L, y: 0.2 * D },
      ];
      const ear = ovalPoints(-0.62 * L, -0.5 * D, 0.1, 0.036, deg(-150), 0.06, seed, 16);
      const hornLength = look.horns === null ? 0 : look.horns.length;
      const outlines = [skull, ear];
      return {
        state: 'gore_head',
        centre: centreOf(outlines),
        paint: (ctx) => {
          paintGoreMass(ctx, traceOf(ctx, ear), tone, ink);
          if (hornLength > 0) {
            ctx.strokeStyle = rgba(ink, 0.95);
            ctx.lineWidth = 0.034;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(-0.34 * L, -0.46 * D);
            ctx.quadraticCurveTo(
              -0.34 * L,
              -0.46 * D - hornLength,
              -0.12 * L,
              -0.5 * D - hornLength,
            );
            ctx.stroke();
            ctx.strokeStyle = hide.horn;
            ctx.lineWidth = 0.02;
            ctx.stroke();
          }
          paintHide(ctx, skull, seed, 0.07);
          // The square wet muzzle: the one part of this lump that says "cow".
          ctx.save();
          try {
            traceSmooth(ctx, skull);
            ctx.clip();
            ctx.fillStyle = hide.muzzleRing ?? hide.muzzle;
            ctx.beginPath();
            ctx.ellipse(0.5 * L, 0.02 * D, 0.2 * L, 0.46 * D, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = hide.muzzle;
            ctx.beginPath();
            ctx.ellipse(0.55 * L, 0.02 * D, 0.14 * L, 0.4 * D, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = hide.nostril;
            ctx.beginPath();
            ctx.ellipse(0.52 * L, -0.1 * D, 0.03, 0.02, deg(-25), 0, Math.PI * 2);
            ctx.fill();
          } finally {
            ctx.restore();
          }
          // A dead eye: a pale, lidless disc.
          ctx.fillStyle = mix(hide.eye, '#b8b0a4', 0.55);
          ctx.beginPath();
          ctx.ellipse(-0.05 * L, -0.22 * D, 0.022, 0.018, 0, 0, Math.PI * 2);
          ctx.fill();
          drawWound(ctx, {
            kind: 'torn',
            centre: { x: -0.5 * L, y: 0.14 * D },
            radius: 0.06,
            squash: 0.7,
            angle: deg(180),
            bones: [{ at: { x: 0, y: 0 }, size: 0.4, hollow: true }],
            runAngle: deg(170),
            seed: seed + 1,
            hide: hide.shadow,
          });
        },
      };
    })(),

    gore_forequarter_left: (() => {
      const seed = seedOf(1);
      const shoulder = ovalPoints(0, -0.14, 0.14, 0.1, deg(-20), 0.08, seed, 22);
      const leg = segmentOutline({ x: 0.02, y: -0.1 }, { x: 0.05, y: 0.26 }, 0.055, 0.03, seed);
      const outlines = [shoulder, leg];
      return {
        state: 'gore_forequarter_left',
        centre: centreOf([...outlines, [{ x: 0.05, y: 0.3 }]]),
        paint: (ctx) => {
          paintHide(ctx, leg, seed + 2, 0.04);
          hoof(ctx, { x: 0.05, y: 0.255 }, deg(-4), 0.024);
          paintHide(ctx, shoulder, seed + 3, 0.07);
          drawWound(ctx, {
            kind: 'clean',
            centre: { x: -0.06, y: -0.19 },
            radius: 0.07,
            squash: 0.75,
            angle: deg(-130),
            bones: [{ at: { x: 0.1, y: 0 }, size: 0.36 }],
            runAngle: deg(-140),
            seed: seed + 4,
            hide: hide.shadow,
          });
        },
      };
    })(),

    gore_forequarter_right: (() => {
      const seed = seedOf(2);
      const shoulder = ovalPoints(0, 0, 0.12, 0.11, deg(15), 0.1, seed, 22);
      const forearm = segmentOutline({ x: 0.04, y: 0.04 }, { x: 0.2, y: 0.15 }, 0.05, 0.036, seed);
      const outlines = [shoulder, forearm];
      return {
        state: 'gore_forequarter_right',
        centre: centreOf(outlines),
        paint: (ctx) => {
          paintHide(ctx, forearm, seed + 2, 0.04);
          paintHide(ctx, shoulder, seed + 3, 0.07);
          drawBoneBreak(ctx, {
            kind: 'torn',
            centre: { x: 0.205, y: 0.155 },
            radius: 0.028,
            squash: 0.7,
            angle: deg(35),
            seed: seed + 4,
            cortical: BONE_CORTICAL,
            shadow: BONE_SHADOW,
          });
          drawWound(ctx, {
            kind: 'crushed',
            centre: { x: -0.08, y: -0.04 },
            radius: 0.065,
            squash: 0.85,
            angle: deg(200),
            bones: [{ at: { x: 0, y: 0 }, size: 0.34, hollow: true }],
            runAngle: deg(190),
            seed: seed + 5,
            hide: hide.shadow,
          });
        },
      };
    })(),

    gore_hindquarter_left: (() => {
      const seed = seedOf(3);
      const ham = ovalPoints(0, -0.12, 0.16, 0.13, deg(-10), 0.08, seed, 24);
      const gaskin = segmentOutline(
        { x: -0.02, y: -0.04 },
        { x: -0.1, y: 0.12 },
        0.06,
        0.035,
        seed,
      );
      const cannon = segmentOutline(
        { x: -0.1, y: 0.12 },
        { x: -0.04, y: 0.3 },
        0.033,
        0.028,
        seed + 1,
      );
      const outlines = [ham, gaskin, cannon];
      return {
        state: 'gore_hindquarter_left',
        centre: centreOf([...outlines, [{ x: -0.04, y: 0.34 }]]),
        paint: (ctx) => {
          paintHide(ctx, cannon, seed + 2, 0.03);
          hoof(ctx, { x: -0.04, y: 0.295 }, deg(-18), 0.024);
          paintHide(ctx, gaskin, seed + 3, 0.04);
          paintHide(ctx, ham, seed + 4, 0.08);
          drawWound(ctx, {
            kind: 'torn',
            centre: { x: 0.08, y: -0.2 },
            radius: 0.075,
            squash: 0.8,
            angle: deg(-40),
            bones: [{ at: { x: -0.1, y: 0.1 }, size: 0.42 }],
            runAngle: deg(-30),
            seed: seed + 5,
            hide: hide.shadow,
          });
        },
      };
    })(),

    gore_hindquarter_right: (() => {
      const seed = seedOf(4);
      const ham = ovalPoints(0, 0, 0.17, 0.12, deg(25), 0.1, seed, 24);
      const stub = segmentOutline({ x: 0.08, y: 0.06 }, { x: 0.19, y: 0.2 }, 0.05, 0.042, seed);
      const outlines = [ham, stub];
      return {
        state: 'gore_hindquarter_right',
        centre: centreOf(outlines),
        paint: (ctx) => {
          paintHide(ctx, stub, seed + 2, 0.04);
          paintHide(ctx, ham, seed + 3, 0.09);
          // The ball of the thigh bone standing out of the cut: a round bright
          // knob, which is what says "haunch" rather than "rock".
          drawWound(ctx, {
            kind: 'clean',
            centre: { x: -0.1, y: -0.05 },
            radius: 0.08,
            squash: 0.8,
            angle: deg(205),
            bones: [{ at: { x: 0.05, y: 0 }, size: 0.5 }],
            runAngle: deg(200),
            seed: seed + 4,
            hide: hide.shadow,
          });
          drawBoneBreak(ctx, {
            kind: 'crushed',
            centre: { x: 0.195, y: 0.205 },
            radius: 0.03,
            squash: 0.75,
            angle: deg(40),
            seed: seed + 5,
            cortical: BONE_CORTICAL,
            shadow: BONE_SHADOW,
          });
        },
      };
    })(),

    gore_ribs: (() => {
      const seed = seedOf(5);
      const HALF_W = 0.16;
      const HALF_H = 0.13;
      const slab = ovalPoints(0, 0, HALF_W, HALF_H, deg(6), 0.1, seed, 24);
      return {
        state: 'gore_ribs',
        centre: centreOf([slab]),
        paint: (ctx) => {
          const trace = traceOf(ctx, slab);
          paintGoreMass(ctx, trace, meat, ink);
          ctx.save();
          try {
            trace(0);
            ctx.clip();
            // A strip of hide still on the back edge, so the slab is plainly off
            // this animal and not a generic cut of meat.
            traceSmooth(
              ctx,
              ovalPoints(0, -HALF_H * 0.85, HALF_W * 1.2, HALF_H * 0.42, 0, 0.1, seed, 20),
            );
            ctx.fillStyle = hide.base;
            ctx.fill();
            const RIB_COUNT = 5;
            ctx.lineCap = 'round';
            for (let i = 0; i < RIB_COUNT; i++) {
              const t = (i + 0.5) / RIB_COUNT;
              const x = lerp(-HALF_W * 0.85, HALF_W * 0.85, t);
              ctx.strokeStyle = i % 2 === 0 ? BONE_CORTICAL : mix(BONE_CORTICAL, BONE_SHADOW, 0.4);
              ctx.lineWidth = 0.02;
              ctx.beginPath();
              ctx.moveTo(x, -HALF_H * 0.4);
              ctx.quadraticCurveTo(x + 0.035, HALF_H * 0.2, x - 0.01, HALF_H * 0.95);
              ctx.stroke();
            }
            ctx.fillStyle = rgba(BLOOD_DARK, 0.45);
            ctx.fillRect(-HALF_W * 1.2, HALF_H * 0.45, HALF_W * 2.4, HALF_H);
          } finally {
            ctx.restore();
          }
        },
      };
    })(),

    gore_tail: (() => {
      const seed = seedOf(6);
      // Long, thin and gently curved, with the tuft: a shape no other piece in
      // the bestiary has, and the most "cow" silhouette of the eight.
      const pts: Pt[] = [];
      const STEPS = 9;
      for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        pts.push({ x: lerp(-0.26, 0.2, t), y: 0.07 * Math.sin(t * Math.PI * 1.2) - 0.03 });
      }
      const left: Pt[] = [];
      const right: Pt[] = [];
      pts.forEach((p, i) => {
        const w = lerp(0.026, 0.012, i / STEPS);
        left.push({ x: p.x, y: p.y - w });
        right.push({ x: p.x, y: p.y + w });
      });
      const rope = [...left, ...right.reverse()];
      const tip = pts[pts.length - 1];
      const tuft = ovalPoints(tip.x + 0.06, tip.y - 0.01, 0.085, 0.042, deg(-12), 0.14, seed, 18);
      return {
        state: 'gore_tail',
        centre: centreOf([rope, tuft]),
        paint: (ctx) => {
          paintGoreMass(ctx, traceOf(ctx, rope), tone, ink);
          const traceTuft = traceOf(ctx, tuft);
          paintGoreMass(
            ctx,
            traceTuft,
            { mid: hide.tailSwitch, dark: hide.shadow, light: hide.light },
            ink,
          );
          ctx.save();
          try {
            traceTuft(0);
            ctx.clip();
            ctx.strokeStyle = rgba(hide.shadow, 0.5);
            ctx.lineWidth = 0.008;
            for (let i = 0; i < 5; i++) {
              const y = tip.y - 0.03 + i * 0.015;
              ctx.beginPath();
              ctx.moveTo(tip.x, y);
              ctx.lineTo(tip.x + 0.15, y + 0.01 * Math.sin(i + seed));
              ctx.stroke();
            }
          } finally {
            ctx.restore();
          }
          drawWound(ctx, {
            kind: 'torn',
            centre: { x: -0.26, y: -0.03 },
            radius: 0.03,
            squash: 0.6,
            angle: deg(180),
            bones: [{ at: { x: 0, y: 0 }, size: 0.4, hollow: true }],
            runAngle: deg(185),
            seed: seed + 1,
            hide: hide.shadow,
          });
        },
      };
    })(),

    gore_hide: (() => {
      const seed = seedOf(7);
      const HALF_W = 0.25;
      const HALF_H = 0.09;
      const SHEET_STEPS = 16;
      const sheet: Pt[] = [];
      for (let i = 0; i < SHEET_STEPS; i++) {
        const angle = (i / SHEET_STEPS) * Math.PI * 2;
        const ragged = 1 + 0.22 * Math.sin(angle * 5 + 1.7) + 0.12 * Math.sin(angle * 9);
        const along = Math.cos(angle) * HALF_W * ragged;
        const across = Math.sin(angle) * HALF_H * ragged;
        // Laid on a slant, so a flat sheet of hide never lines up with the
        // ribbed slab it is the same size as.
        sheet.push({
          x: along * Math.cos(HIDE_SLANT) - across * Math.sin(HIDE_SLANT),
          y: along * Math.sin(HIDE_SLANT) + across * Math.cos(HIDE_SLANT),
        });
      }
      return {
        state: 'gore_hide',
        centre: centreOf([sheet]),
        paint: (ctx) => {
          paintHide(ctx, sheet, seed, 0.09);
          const trace = traceOf(ctx, sheet);
          ctx.save();
          try {
            trace(0);
            ctx.clip();
            ctx.strokeStyle = rgba(hide.shadow, 0.3 + 0.2 * look.shag);
            ctx.lineWidth = 0.008 * (1 + look.shag);
            for (let i = 0; i < 18; i++) {
              const x = lerp(-HALF_W, HALF_W, hash1(seed + i * 1.3));
              const y = lerp(-HALF_H, HALF_H, hash1(seed + i * 2.9));
              const len = 0.025 * (1 + look.shag * 1.5);
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(x + len * 0.3, y + len);
              ctx.stroke();
            }
            // The fold turned over to show the wet pink underside.
            ctx.fillStyle = mix(MUSCLE_LIGHT, '#e8b4a8', 0.55);
            ctx.beginPath();
            ctx.moveTo(HALF_W * 0.15, -HALF_H * 1.2);
            ctx.quadraticCurveTo(HALF_W * 0.75, -HALF_H * 0.2, HALF_W * 1.1, HALF_H * 1.0);
            ctx.lineTo(HALF_W * 1.3, -HALF_H * 1.3);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = rgba(MUSCLE_DARK, 0.7);
            ctx.lineWidth = 0.01;
            ctx.beginPath();
            ctx.moveTo(HALF_W * 0.15, -HALF_H * 1.2);
            ctx.quadraticCurveTo(HALF_W * 0.75, -HALF_H * 0.2, HALF_W * 1.1, HALF_H * 1.0);
            ctx.stroke();
          } finally {
            ctx.restore();
          }
        },
      };
    })(),
  };

  return COW_GORE_STATES.map((state) => {
    const piece = pieces[state];
    const correction = goreCentreCorrection(state, look);
    return {
      ...piece,
      centre: { x: piece.centre.x + correction.x, y: piece.centre.y + correction.y },
    };
  });
}

/**
 * How far each piece's ink centre sits from the centre of its outline, in piece
 * units: the hoof, the wound's drips and a snapped bone all reach past the
 * outline the centre is computed from. Keyed by piece, and for the head by the
 * horns on it, since a pair of horns moves the head's ink up.
 *
 * Measuring ink is something only an offline pass can do, so these are frozen;
 * `scripts/gates-cow.ts` re-measures every piece of every figure on each render
 * and prints the value to paste when a redrawn piece drifts.
 */
export const GORE_CENTRE_CORRECTION: ReadonlyMap<string, Pt> = new Map<string, Pt>([
  ['gore_head:upswept', { x: -0.0049, y: -0.0488 }],
  ['gore_forequarter_left', { x: -0.0049, y: -0.0635 }],
  ['gore_forequarter_right', { x: -0.0537, y: 0.0 }],
  ['gore_hindquarter_left', { x: 0.0342, y: -0.0293 }],
  ['gore_hindquarter_right', { x: -0.0488, y: -0.0293 }],
]);

/** The key a piece's correction is frozen under. */
export function goreCorrectionKey(state: string, look: CowLook): string {
  if (state !== 'gore_head') return state;
  return `${state}:${look.horns?.shape ?? 'polled'}`;
}

function goreCentreCorrection(state: string, look: CowLook): Pt {
  return GORE_CENTRE_CORRECTION.get(goreCorrectionKey(state, look)) ?? { x: 0, y: 0 };
}
