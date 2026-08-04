/**
 * The painter library behind the Brindle Grub sheets.
 *
 * Two creatures are baked from this one module — the newly-hatched larva
 * (`brindle_grub`) and the older, biting instar (`cow_tailed_grub`) — because
 * they are the same animal at two points in its life. Only the `GrubBuild`
 * differs: palette, size (applied by the generator via `variant.scale`, not
 * here) and whether the tail appendage that gives the second stage its name
 * exists at all.
 *
 * A legless larva has no view-split convention to borrow the way a legged
 * animal does, so this module invents one from the same physical model: every
 * silhouette is a tube traced along a body centreline, parametrised by `t`
 * from 0 (the head) to 1 (the tail). The **side** view walks that centreline
 * left to right. The **front** and **away** views walk the same centreline
 * *vertically* instead — the same physical animal, seen end-on, so a viewer
 * looking down its length sees the near segments large and the far segments
 * compressed toward the horizon. Which end is nearest is the only thing that
 * changes between the two: front puts the head at the bottom, away puts the
 * tail there, and that single swap is why the head's face is drawn only when
 * it is the near end and never on the away view.
 *
 * What makes the shape read as a *larva* rather than as a bean:
 *
 *   - a body built of visible **rings** — segment creases cut across the tube
 *     at regular intervals, the single cue that turns a smooth capsule into a
 *     segmented grub;
 *   - a row of dark **spiracles** down each side, the paired breathing pores
 *     every soft-bodied insect larva carries;
 *   - a **brindle** coat — the animal's own namesake pattern, streaky and
 *     mottled rather than a flat fill, scattered across the rings rather than
 *     painted as a uniform brown;
 *   - a **peristaltic crawl**: the arch that makes it move is a hump
 *     travelling from tail to head along the body, not the whole thing
 *     rocking as one rigid unit;
 *   - on the second stage only, a **cow-like tail** — an actual tapering
 *     appendage with a bristle tuft at the tip, socketed off the tail end of
 *     the body — because that is the feature the name promises and the two
 *     stages must not otherwise be told apart at a glance.
 *
 * Skin is painted through `paintChitin` (from `mantidArt.ts`): that engine is
 * a generic directional-gradient-plus-specular-plus-rim painter, not
 * anything specific to chitin, and reusing it here is the same shared-engine
 * decision `goreWound.ts` makes for wounds. Iridescence and scarring are left
 * at zero — a grub has neither — via a small adapter that reshapes a
 * `GrubPalette` into the `ChitinPalette` shape the engine expects.
 *
 * Coordinates are tile units, +Y down, origin at the tile centre. The side
 * view faces +X (head foremost); the runtime mirrors it for the other
 * direction.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import {
  TWO_PI,
  clamp01,
  deg,
  easeInOut,
  hash1,
  hump,
  lerp,
  paintChitin,
  ramp,
  rgba,
  segmentOutline,
  type MantidBuild,
  type Pt,
} from './mantidArt.js';

export { TWO_PI, clamp01, deg, easeInOut, hump, lerp, ramp };
export type { Pt };

// ── Build ────────────────────────────────────────────────────────────────────

export interface GrubPalette {
  readonly base: string;
  readonly dark: string;
  readonly light: string;
  readonly rim: string;
  readonly ink: string;
  /** The brindle mottling — darker streaks scattered over the base coat. */
  readonly streak: string;
  /** Wet ooze sheen along the back. */
  readonly ooze: string;
  readonly eye: string;
  readonly mouth: string;
}

export interface GrubBuild {
  readonly palette: GrubPalette;
  /** Only the cow-tailed instar has grown the namesake appendage. */
  readonly hasTail: boolean;
  readonly seed: number;
}

/** The pale, freshly-hatched first instar. */
export const BRINDLE_GRUB_BUILD: GrubBuild = {
  palette: {
    base: '#ab8f56',
    dark: '#4c3a20',
    light: '#dcc78e',
    rim: '#f2e6b4',
    ink: '#251a0d',
    streak: '#402d14',
    ooze: '#eaf2c4',
    eye: '#120d07',
    mouth: '#2c1c11',
  },
  hasTail: false,
  seed: 5.2,
};

/** The older, browner, angrier instar — the one that has grown a tail and a bite. */
export const COW_TAILED_GRUB_BUILD: GrubBuild = {
  palette: {
    base: '#8d6c3b',
    dark: '#3c2b13',
    light: '#c8a961',
    rim: '#e9d191',
    ink: '#1d1509',
    streak: '#2d1e0b',
    ooze: '#dbe9a2',
    eye: '#0d0a05',
    mouth: '#211509',
  },
  hasTail: true,
  seed: 9.7,
};

/** Reshapes the grub's own palette into the generic chitin engine's shape. */
function chitinAdapter(build: GrubBuild): MantidBuild {
  return {
    palette: {
      base: build.palette.base,
      dark: build.palette.dark,
      light: build.palette.light,
      rim: build.palette.rim,
      ink: build.palette.ink,
      sheen: build.palette.light,
      eye: build.palette.eye,
      eyeDark: build.palette.ink,
      membrane: build.palette.ooze,
      spine: build.palette.light,
    },
    wingWear: 0,
    scarring: 0,
    heft: 0,
    iridescence: 0,
    seed: build.seed,
  };
}

// ── Anatomy (tile units) ─────────────────────────────────────────────────────

export const GROUND_Y = 0.42;

const HEAD_X = 0.26;
const TAIL_X = -0.28;
const BODY_HALF_HEAD = 0.095;
const BODY_HALF_MID = 0.135;
const BODY_HALF_TAIL = 0.024;
export const SEGMENT_COUNT = 7;
const ARCH_AMPLITUDE = 0.045;
const SWAY_AMPLITUDE = 0.018;
const HEAD_WIDEN_AT = 0.35;

export const TAIL_LENGTH = 0.16;
const TAIL_HALF = 0.022;
const TAIL_TIP_HALF = 0.006;
const TAIL_BOW = 0.02;
const TAIL_CURL = deg(-25);
const TAIL_WAG_RANGE = deg(18);
const TAIL_TUFT_COUNT = 3;
const TAIL_TUFT_SPREAD = deg(22);
const TAIL_TUFT_LENGTH = 0.03;

const BRINDLE_STREAK_COUNT = 14;
const STREAK_LENGTH_MIN = 0.02;
const STREAK_LENGTH_MAX = 0.045;

/** Vertical rise the front/away tube covers, tallest at the far end. */
const STACK_VISUAL_HEIGHT = 0.34;
const STACK_COMPRESS_EXPONENT = 0.85;
const STACK_JITTER = 0.03;

// ── Pose ─────────────────────────────────────────────────────────────────────

export interface GrubPose {
  /** 0–1: phase of the tail-to-head peristaltic hump. */
  readonly crawlPhase: number;
  /** Lateral rock, mostly visible front/away. */
  readonly sway: number;
  readonly tailWag: number;
  /** 0 closed, 1 mandibles fully spread — the bite. */
  readonly mouthOpen: number;
  /** Forward drive of a strike, weighted toward the head end. */
  readonly lunge: number;
  readonly breathe: number;
  readonly time: number;
}

export function restGrubPose(): GrubPose {
  return {
    crawlPhase: 0,
    sway: 0,
    tailWag: 0,
    mouthOpen: 0,
    lunge: 0,
    breathe: 0,
    time: 0,
  };
}

// ── Body sampling ────────────────────────────────────────────────────────────

interface BodySample {
  readonly point: Pt;
  /** Direction `t` increases in, radians. */
  readonly angle: number;
  readonly half: number;
}

type Sampler = (t: number) => BodySample;

function halfWidthAt(t: number): number {
  if (t < HEAD_WIDEN_AT) return lerp(BODY_HALF_HEAD, BODY_HALF_MID, t / HEAD_WIDEN_AT);
  return lerp(BODY_HALF_MID, BODY_HALF_TAIL, (t - HEAD_WIDEN_AT) / (1 - HEAD_WIDEN_AT));
}

const TANGENT_EPSILON = 0.001;

function crawlSpinePoint(t: number, pose: GrubPose): Pt {
  // The hump travels from tail to head as the phase advances — a peristaltic
  // wave, not the whole body rocking as one rigid plank.
  const localPhase = (((t * 1.6 - pose.crawlPhase) % 1) + 1) % 1;
  const arch = hump(localPhase) * ARCH_AMPLITUDE;
  const x = lerp(HEAD_X, TAIL_X, t) + pose.lunge * (1 - t);
  const y = GROUND_Y - arch + Math.sin(t * TWO_PI + pose.time * TWO_PI) * SWAY_AMPLITUDE * 0.3;
  return { x, y };
}

function sideSampler(pose: GrubPose): Sampler {
  const swell = 1 + pose.breathe * 0.04;
  return (t: number): BodySample => {
    const clamped = clamp01(t);
    const before = crawlSpinePoint(Math.max(0, clamped - TANGENT_EPSILON), pose);
    const after = crawlSpinePoint(Math.min(1, clamped + TANGENT_EPSILON), pose);
    const angle = Math.atan2(after.y - before.y, after.x - before.x);
    return { point: crawlSpinePoint(clamped, pose), angle, half: halfWidthAt(clamped) * swell };
  };
}

/**
 * Front and away share this sampler and differ only in which end of the body
 * — `nearT` — is placed nearest the viewer, at the bottom of the stack.
 */
function frontAwaySampler(pose: GrubPose, build: GrubBuild, nearT: number): Sampler {
  const swell = 1 + pose.breathe * 0.04;
  // One smooth lean for the whole body, not a per-sample wiggle: a value that
  // oscillates along `t` bends the silhouette into a zigzag instead of a worm
  // leaning as a single unit.
  const lean = Math.sin(pose.time * TWO_PI + build.seed) * STACK_JITTER * (1 + pose.sway);
  // `nearT` sits at one edge of the [0, 1] domain (0 for front, 1 for away),
  // so `t` only ever moves away from it in one direction. That direction is
  // the true tangent: for front, increasing `t` climbs toward the far/top end
  // (up); for away, increasing `t` descends toward the near/bottom end
  // (down) — the mirror image, not the same "up" the front tube uses. Every
  // consumer of `angle` (body width normals, creases, spiracles, streaks) is
  // symmetric under a sign flip, so correcting this per-view does not change
  // how those already-correct parts render — it only fixes end-mounted
  // features (mouth, tail) that read the true outward direction from here.
  const tangentAngle = nearT === 0 ? -Math.PI / 2 : Math.PI / 2;
  return (t: number): BodySample => {
    const clamped = clamp01(t);
    const depth = Math.abs(clamped - nearT);
    const compress = Math.pow(depth, STACK_COMPRESS_EXPONENT);
    return {
      point: { x: lean * compress, y: GROUND_Y - compress * STACK_VISUAL_HEIGHT },
      angle: tangentAngle,
      half: halfWidthAt(clamped) * swell,
    };
  };
}

function normalOf(angle: number): Pt {
  return { x: -Math.sin(angle), y: Math.cos(angle) };
}

const TUBE_STEPS = 24;

function buildWormOutline(sampler: Sampler): Pt[] {
  const top: Pt[] = [];
  const bottom: Pt[] = [];
  for (let i = 0; i <= TUBE_STEPS; i++) {
    const t = i / TUBE_STEPS;
    const sample = sampler(t);
    const n = normalOf(sample.angle);
    top.push({ x: sample.point.x + n.x * sample.half, y: sample.point.y + n.y * sample.half });
    bottom.push({ x: sample.point.x - n.x * sample.half, y: sample.point.y - n.y * sample.half });
  }
  return [...top, ...bottom.reverse()];
}

// ── Surface detail ───────────────────────────────────────────────────────────

function drawSegmentCreases(ctx: Ctx, sampler: Sampler, build: GrubBuild, count: number): void {
  for (let s = 1; s < count; s++) {
    const t = s / count;
    const sample = sampler(t);
    const n = normalOf(sample.angle);
    const reach = sample.half * 1.15;
    ctx.beginPath();
    ctx.moveTo(sample.point.x - n.x * reach, sample.point.y - n.y * reach);
    ctx.lineTo(sample.point.x + n.x * reach, sample.point.y + n.y * reach);
    ctx.strokeStyle = rgba(build.palette.ink, 0.3);
    ctx.lineWidth = 0.006;
    ctx.stroke();
  }
}

const SPIRACLE_RADIUS_RATIO = 0.16;
const SPIRACLE_OFFSET_RATIO = 0.62;

function drawSpiracles(ctx: Ctx, sampler: Sampler, build: GrubBuild, count: number): void {
  for (let s = 0; s < count; s++) {
    const t = (s + 0.5) / count;
    const sample = sampler(t);
    const n = normalOf(sample.angle);
    for (const sign of [-1, 1]) {
      const cx = sample.point.x + n.x * sample.half * SPIRACLE_OFFSET_RATIO * sign;
      const cy = sample.point.y + n.y * sample.half * SPIRACLE_OFFSET_RATIO * sign;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.003, sample.half * SPIRACLE_RADIUS_RATIO), 0, TWO_PI);
      ctx.fillStyle = rgba(build.palette.ink, 0.62);
      ctx.fill();
    }
  }
}

/** The brindle mottling: short dark streaks scattered across the coat. */
function drawBrindleStreaks(ctx: Ctx, sampler: Sampler, build: GrubBuild): void {
  for (let i = 0; i < BRINDLE_STREAK_COUNT; i++) {
    const t = hash1(build.seed + i * 3.3);
    const sample = sampler(t);
    const n = normalOf(sample.angle);
    const sideSign = hash1(build.seed + i * 7.1) < 0.5 ? -1 : 1;
    const offset = (hash1(build.seed + i * 1.7) - 0.3) * sample.half * sideSign;
    const baseX = sample.point.x + n.x * offset;
    const baseY = sample.point.y + n.y * offset;
    const angle = hash1(build.seed + i * 4.9) * TWO_PI;
    const length = lerp(STREAK_LENGTH_MIN, STREAK_LENGTH_MAX, hash1(build.seed + i * 2.3));
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(baseX + Math.cos(angle) * length, baseY + Math.sin(angle) * length);
    ctx.strokeStyle = rgba(build.palette.streak, 0.45 + hash1(build.seed + i * 6.1) * 0.35);
    ctx.lineWidth = 0.008;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

// ── Head ─────────────────────────────────────────────────────────────────────

const EYE_RADIUS = 0.017;
const EYE_HIGHLIGHT_RADIUS = 0.006;
const EYE_OFFSET_RATIO = 0.55;
const EYE_FORWARD_RATIO = 0.35;
const MOUTH_HOOK_LENGTH_RATIO = 1.15;
const MOUTH_CLOSED_LENGTH_RATIO = 0.4;

function drawGrubHead(ctx: Ctx, sampler: Sampler, build: GrubBuild, pose: GrubPose): void {
  const head = sampler(0);
  const n = normalOf(head.angle);
  // t=0 is the head; the direction *t increases in* points toward the tail, so
  // the mouth and gaze face the opposite way.
  const forward = { x: -Math.cos(head.angle), y: -Math.sin(head.angle) };

  for (const sign of [-1, 1]) {
    const ex =
      head.point.x +
      n.x * head.half * EYE_OFFSET_RATIO * sign +
      forward.x * head.half * EYE_FORWARD_RATIO;
    const ey =
      head.point.y +
      n.y * head.half * EYE_OFFSET_RATIO * sign +
      forward.y * head.half * EYE_FORWARD_RATIO;
    ctx.beginPath();
    ctx.arc(ex, ey, EYE_RADIUS, 0, TWO_PI);
    ctx.fillStyle = build.palette.eye;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex - EYE_RADIUS * 0.3, ey - EYE_RADIUS * 0.3, EYE_HIGHLIGHT_RADIUS, 0, TWO_PI);
    ctx.fillStyle = rgba(build.palette.rim, 0.8);
    ctx.fill();
  }

  const spread = pose.mouthOpen;
  for (const sign of [-1, 1]) {
    const hookAngle = Math.atan2(forward.y, forward.x) + sign * (deg(8) + spread * deg(34));
    const length = head.half * lerp(MOUTH_CLOSED_LENGTH_RATIO, MOUTH_HOOK_LENGTH_RATIO, spread);
    const tipX = head.point.x + forward.x * head.half * 0.5 + Math.cos(hookAngle) * length;
    const tipY = head.point.y + forward.y * head.half * 0.5 + Math.sin(hookAngle) * length;
    ctx.beginPath();
    ctx.moveTo(
      head.point.x + forward.x * head.half * 0.5,
      head.point.y + forward.y * head.half * 0.5,
    );
    ctx.quadraticCurveTo(
      head.point.x + forward.x * head.half * (0.5 + spread * 0.4) + n.x * sign * head.half * 0.15,
      head.point.y + forward.y * head.half * (0.5 + spread * 0.4) + n.y * sign * head.half * 0.15,
      tipX,
      tipY,
    );
    ctx.strokeStyle = build.palette.mouth;
    ctx.lineWidth = 0.012;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

const HINDQUARTERS_REACH_RATIO = 0.5 + MOUTH_CLOSED_LENGTH_RATIO;
const HINDQUARTERS_NORMAL_PINCH_RATIO = 0.6;

/**
 * The front view's near end (the head) gets pushed outward by the mouth
 * hook's stroke; the away view deliberately draws no face at its near end
 * (the tail-root/hindquarters area), so without this it has nothing
 * analogous pushing its own bounding box outward. This reuses the mouth
 * hook's own reach ratio (`MOUTH_CLOSED_LENGTH_RATIO`) rather than an
 * arbitrary new constant, so the two views end up comparably sized without
 * drawing anything that reads as a face.
 */
function drawGrubHindquarters(ctx: Ctx, sampler: Sampler, build: GrubBuild): void {
  const rear = sampler(1);
  const outward = { x: Math.cos(rear.angle), y: Math.sin(rear.angle) };
  const reach = BODY_HALF_HEAD * HINDQUARTERS_REACH_RATIO;
  const tip: Pt = { x: rear.point.x + outward.x * reach, y: rear.point.y + outward.y * reach };
  // Routed through the same tapered-tube outline + chitin shader every other
  // part of the body uses, so this reads as a rounded continuation of the
  // tube rather than a flat-filled patch stitched onto its end.
  const outline = segmentOutline(
    rear.point,
    tip,
    rear.half,
    rear.half * HINDQUARTERS_NORMAL_PINCH_RATIO,
  );
  paintChitin(ctx, { outline, build: chitinAdapter(build), gloss: 0.4 });
}

// ── Tail ─────────────────────────────────────────────────────────────────────

/** The namesake appendage: a tapering, curved tail with a bristle tuft. */
function drawCowTail(ctx: Ctx, sampler: Sampler, build: GrubBuild, pose: GrubPose): void {
  const tailRoot = sampler(1);
  const wag = pose.tailWag * TAIL_WAG_RANGE;
  const tipAngle = tailRoot.angle + TAIL_CURL + wag;
  const root = tailRoot.point;
  const tip: Pt = {
    x: root.x + Math.cos(tipAngle) * TAIL_LENGTH,
    y: root.y + Math.sin(tipAngle) * TAIL_LENGTH,
  };
  const outline = segmentOutline(root, tip, TAIL_HALF, TAIL_TIP_HALF, TAIL_BOW);
  paintChitin(ctx, { outline, build: chitinAdapter(build), gloss: 0.4 });

  for (let i = 0; i < TAIL_TUFT_COUNT; i++) {
    const spread = lerp(-TAIL_TUFT_SPREAD, TAIL_TUFT_SPREAD, i / (TAIL_TUFT_COUNT - 1));
    const bristleAngle = tipAngle + spread;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(
      tip.x + Math.cos(bristleAngle) * TAIL_TUFT_LENGTH,
      tip.y + Math.sin(bristleAngle) * TAIL_TUFT_LENGTH,
    );
    ctx.strokeStyle = rgba(build.palette.ink, 0.75);
    ctx.lineWidth = 0.007;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

// ── Composed views ───────────────────────────────────────────────────────────

export type GrubView = 'front' | 'side' | 'away';

function drawGrub(ctx: Ctx, build: GrubBuild, pose: GrubPose, view: GrubView): void {
  const sampler =
    view === 'side' ? sideSampler(pose) : frontAwaySampler(pose, build, view === 'front' ? 0 : 1);
  const outline = buildWormOutline(sampler);
  paintChitin(ctx, { outline, build: chitinAdapter(build), gloss: 0.55 });
  drawSegmentCreases(ctx, sampler, build, SEGMENT_COUNT);
  drawSpiracles(ctx, sampler, build, SEGMENT_COUNT);
  drawBrindleStreaks(ctx, sampler, build);
  // The face reads only on the end nearest the viewer: side always shows it
  // (the head is always t=0, in profile), front shows it because the head is
  // the near end there, and away deliberately withholds it.
  if (view !== 'away') drawGrubHead(ctx, sampler, build, pose);
  if (build.hasTail) drawCowTail(ctx, sampler, build, pose);
  // The cow tail already gives the away view's near end its own outward
  // push; only the tailless build needs the hindquarters stand-in.
  else if (view === 'away') drawGrubHindquarters(ctx, sampler, build);
}

export function drawGrubSide(ctx: Ctx, build: GrubBuild, pose: GrubPose): void {
  drawGrub(ctx, build, pose, 'side');
}

export function drawGrubFront(ctx: Ctx, build: GrubBuild, pose: GrubPose): void {
  drawGrub(ctx, build, pose, 'front');
}

export function drawGrubAway(ctx: Ctx, build: GrubBuild, pose: GrubPose): void {
  drawGrub(ctx, build, pose, 'away');
}

// ── Bite phases (cow-tailed grub only) ──────────────────────────────────────

const BITE_COCK_END = 0.4;
const BITE_SNAP_END = 0.6;
const BITE_LUNGE_DISTANCE = 0.05;

export interface BitePhases {
  readonly cock: number;
  readonly snap: number;
  readonly recover: number;
}

export function bitePhases(progress: number): BitePhases {
  return {
    cock: easeInOut(ramp(progress, 0, BITE_COCK_END)),
    snap: easeInOut(ramp(progress, BITE_COCK_END, BITE_SNAP_END)),
    recover: easeInOut(ramp(progress, BITE_SNAP_END, 1)),
  };
}

export function bitePose(progress: number): GrubPose {
  const phases = bitePhases(progress);
  const cocked = phases.cock * (1 - phases.snap);
  const driven = phases.snap * (1 - phases.recover);
  return {
    ...restGrubPose(),
    crawlPhase: progress * 0.4,
    lunge: BITE_LUNGE_DISTANCE * driven - BITE_LUNGE_DISTANCE * 0.2 * cocked,
    mouthOpen: clamp01(cocked * 0.5 + driven),
    tailWag: (cocked - driven) * 0.6,
    breathe: cocked,
    time: progress,
  };
}
