/**
 * The Grave Bull: a stray bull the necromancer raised to batter down the
 * palisade. The look, its decorations, the chains, the snort, the heap it
 * falls into and its loose bones — the rows live in `graveBullFigure.ts`.
 *
 * It is painted by the cow painter (`cowArt.ts`) through a `CowLook`, so it has
 * a cow's anatomy, views and gait for free. What makes it a raised bull rather
 * than a big cow is layered on:
 *
 * - **Bigger and horned.** An adult bull's build — no udder, a heavier neck —
 *   drawn at 1.2× a cow, with long upswept horns split by cracks.
 * - **Rotten.** A grey-brown hide with dark rot patches, blue eyes.
 * - **Opened up.** The spine standing out of the back, and a tear in the flank
 *   showing the ribs with the necromancer's blue light inside them.
 * - **Chained.** Lengths of chain trailing from both horns, which say "dragged
 *   here" and swing with every stride.
 */

import { deg, lerp, mix, rgba, type Pt } from './carlArt';
import {
  cowPollPoint,
  hash1,
  type CowDecorations,
  type CowHide,
  type CowLook,
  type CowPose,
  type CowView,
  type HornSpec,
} from './cowArt';
import { ADULT_COW_BUILD } from './cowLooks';
import { hollowSoulPalette } from '../soulPalette';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;

function pt(x: number, y: number): Pt {
  return { x, y };
}

function soul(rgb: readonly [number, number, number], alpha: number): string {
  const [r, g, b] = rgb;
  return rgba(`rgb(${r}, ${g}, ${b})`, alpha);
}

// ── Palette ──────────────────────────────────────────────────────────────────

const BONE = '#ddd2b3';
const BONE_SHADOW = '#9c8e6e';
const CAVITY = '#120d0b';
const IRON = '#6b707d';
const IRON_LIGHT = '#a4aab8';
const IRON_DARK = '#1c1d22';
const INK = '#110d0b';
const DUST = '#8a7a60';

const BONE_INK_WIDTH = 0.012;
const WOUND_INK_WIDTH = 0.014;
const SKULL_INK_WIDTH = 0.014;
const CHAIN_INK_WIDTH = 0.016;
const PILE_INK_WIDTH = 0.016;
/** Below this much light left, the blue is not worth painting. */
const MIN_VISIBLE_LIGHT = 0.01;

/**
 * A hide gone grey in the ground, with darker rot where it has sloughed. No
 * living coat is this colour: every cow in the village is black-and-white, fawn
 * or ginger.
 */
const GRAVE_HIDE: CowHide = {
  base: '#5e5750',
  shadow: '#302b27',
  light: '#80776c',
  patch: '#35302c',
  patchCover: 0.3,
  belly: null,
  points: '#2b2522',
  face: '#4c4640',
  muzzle: '#2a2421',
  nostril: '#0a0706',
  muzzleRing: null,
  eyeRing: null,
  earInner: '#5a4c46',
  horn: BONE,
  hornTip: '#6a5a42',
  hoof: '#1d1816',
  tailSwitch: '#2e2824',
  udder: '#5e5750',
  ink: INK,
  eye: '#bfe2ff',
};

/** Long, upswept and split: a bull's horns, weathered in the ground. */
const GRAVE_HORNS: HornSpec = { shape: 'upswept', length: 0.3, baseHalfWidth: 0.034, cracks: 3 };

/** How much heavier than an adult cow's each part of the bull's front end is. */
const BULL_FRONT_SCALE = {
  neckRoot: 1.2,
  neckTip: 1.15,
  dewlap: 1.3,
  headDepth: 1.08,
} as const;

/** An adult bull: no udder, a heavier neck and head. Drawn at {@link GRAVE_BULL_SCALE}. */
const GRAVE_BULL_BUILD = {
  ...ADULT_COW_BUILD,
  udderRadius: 0,
  neckRootHalfWidth: ADULT_COW_BUILD.neckRootHalfWidth * BULL_FRONT_SCALE.neckRoot,
  neckTipHalfWidth: ADULT_COW_BUILD.neckTipHalfWidth * BULL_FRONT_SCALE.neckTip,
  dewlapDrop: ADULT_COW_BUILD.dewlapDrop * BULL_FRONT_SCALE.dewlap,
  headDepth: ADULT_COW_BUILD.headDepth * BULL_FRONT_SCALE.headDepth,
};

/** How much bigger than an adult cow the bull is drawn. */
export const GRAVE_BULL_SCALE = 1.2;

// ── Decorations ──────────────────────────────────────────────────────────────

interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function boxOf(points: readonly Pt[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * The top of a closed outline at a given x: the highest point where any of its
 * edges crosses that vertical. Interpolated along the edges, because a straight
 * back is two outline points a body-length apart with nothing in between.
 */
function topAt(outline: readonly Pt[], x: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) continue;
    const y = lerp(a.y, b.y, (x - a.x) / (b.x - a.x));
    if (best === null || y < best) best = y;
  }
  return best;
}

const SPINE_KNOBS = 7;
const SPINE_KNOB_RX = 0.035;
const SPINE_KNOB_RY = 0.028;
/** The share of the back the spine shows along, from the withers back. */
const SPINE_SPAN = 0.62;
/** How far behind the front of the body the withers are, as a share of its length. */
const SPINE_WITHERS_INSET = 0.18;
/** Head-on and from behind, the share of the body's height the spine runs down. */
const SPINE_AXIAL_SPAN = 0.5;
/**
 * One spinous fin, as multiples of the knob radii: how deep it sits in the
 * back, how far its tip leans forward, how tall it stands and where its shaded
 * rear face begins.
 */
const SPINE_FIN = { sink: 0.2, tipLean: 0.2, height: 1.6, shadowBase: 0.2 } as const;

/** The spine standing out of the back as a row of pale knobs. */
function drawSpine(ctx: Ctx, outline: readonly Pt[], box: Box, view: CowView): void {
  const width = box.maxX - box.minX;
  ctx.save();
  ctx.lineWidth = BONE_INK_WIDTH;
  ctx.strokeStyle = INK;
  for (let i = 0; i < SPINE_KNOBS; i++) {
    const t = i / (SPINE_KNOBS - 1);
    const x =
      view === 'side'
        ? lerp(
            box.maxX - width * SPINE_WITHERS_INSET,
            box.maxX - width * (SPINE_WITHERS_INSET + SPINE_SPAN),
            t,
          )
        : lerp(box.minX, box.maxX, 0.5);
    const top =
      view === 'side' ? topAt(outline, x) : box.minY + (box.maxY - box.minY) * t * SPINE_AXIAL_SPAN;
    if (top === null) continue;
    const y = top + SPINE_KNOB_RY * SPINE_FIN.sink;
    // A spinous process: a pale fin of bone standing out of the back, lit on
    // its leading face — round knobs read as a string of pearls.
    ctx.fillStyle = BONE;
    ctx.beginPath();
    ctx.moveTo(x - SPINE_KNOB_RX, y + SPINE_KNOB_RY);
    ctx.lineTo(x - SPINE_KNOB_RX * SPINE_FIN.tipLean, y - SPINE_KNOB_RY * SPINE_FIN.height);
    ctx.lineTo(x + SPINE_KNOB_RX, y + SPINE_KNOB_RY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = BONE_SHADOW;
    ctx.beginPath();
    ctx.moveTo(x - SPINE_KNOB_RX * SPINE_FIN.tipLean, y - SPINE_KNOB_RY * SPINE_FIN.height);
    ctx.lineTo(x + SPINE_KNOB_RX, y + SPINE_KNOB_RY);
    ctx.lineTo(x + SPINE_KNOB_RX * SPINE_FIN.shadowBase, y + SPINE_KNOB_RY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

const RIB_COUNT = 5;

/**
 * Where the tear sits and how big it is, as shares of the body's bounding box:
 * a long wound along the barrel in profile, a smaller rent head-on or behind.
 */
const RIB_TEAR = {
  side: { across: 0.55, down: 0.48, halfWidth: 0.15, halfHeight: 0.24 },
  axial: { across: 0.62, down: 0.55, halfWidth: 0.12, halfHeight: 0.16 },
} as const;
/** Scatters each gash point's hash seed so neighbouring points jag independently. */
const TEAR_HASH_STRIDE = 7;
const TEAR_HASH_OFFSET = 3;
/** The glow inside the wound: bright core fading to nothing at the edges. */
const WOUND_GLOW = { innerStop: 0.3, innerAlpha: 0.75, midStop: 0.65, midAlpha: 0.45 } as const;
/** How many wound radii the glow fill reaches past the centre; the clip trims it. */
const WOUND_GLOW_FILL_REACH = 2;
const WOUND_GLOW_FILL_SPAN = WOUND_GLOW_FILL_REACH * 2;
/**
 * The ribs across the tear, as multiples of its radii: where the first sits,
 * how far they spread, and each one's lean, bow and reach past the edges so
 * the clip cuts them rather than showing their ends.
 */
const TEAR_RIB = {
  firstOffset: 0.6,
  spread: 1.2,
  topLead: 0.35,
  bottomTrail: 0.45,
  reach: 1.2,
  bowLead: 0.35,
  bowDrop: 0.1,
} as const;
/** A rib's ink outline, as a multiple of its bone width. */
const RIB_INK_SCALE = 1.6;

/**
 * A tear in the flank showing the ribcage, the necromancer's blue burning in
 * the dark between the ribs. In profile it is a long wound along the barrel;
 * head-on and from behind it is a smaller rent in the chest or the rump.
 */
function drawRibTear(ctx: Ctx, box: Box, view: CowView): void {
  const placement = view === 'side' ? RIB_TEAR.side : RIB_TEAR.axial;
  const cx = lerp(box.minX, box.maxX, placement.across);
  const cy = lerp(box.minY, box.maxY, placement.down);
  const rx = (box.maxX - box.minX) * placement.halfWidth;
  const ry = (box.maxY - box.minY) * placement.halfHeight;
  const tear = (): void => {
    ctx.beginPath();
    // A ragged gash, not a window: every point's reach is hashed, and the
    // whole wound is slanted along the barrel the way hide splits.
    const points = TEAR_POINTS;
    for (let i = 0; i <= points; i++) {
      const a = (i / points) * TWO_PI;
      const jag =
        TEAR_MIN_REACH + hash1(i * TEAR_HASH_STRIDE + TEAR_HASH_OFFSET) * (1 - TEAR_MIN_REACH);
      const local = pt(Math.cos(a) * rx * jag, Math.sin(a) * ry * jag);
      const slanted = pt(local.x + local.y * TEAR_SLANT, local.y);
      if (i === 0) ctx.moveTo(cx + slanted.x, cy + slanted.y);
      else ctx.lineTo(cx + slanted.x, cy + slanted.y);
    }
    ctx.closePath();
  };
  ctx.save();
  tear();
  ctx.fillStyle = CAVITY;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = WOUND_INK_WIDTH;
  ctx.stroke();
  tear();
  ctx.clip();
  // The light is inside the body, behind the ribs, strongest at the heart of
  // the wound and going dark toward its edges.
  const { core, mid, deep } = hollowSoulPalette;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
  glow.addColorStop(0, soul(core, 1));
  glow.addColorStop(WOUND_GLOW.innerStop, soul(core, WOUND_GLOW.innerAlpha));
  glow.addColorStop(WOUND_GLOW.midStop, soul(mid, WOUND_GLOW.midAlpha));
  glow.addColorStop(1, soul(deep, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(
    cx - rx * WOUND_GLOW_FILL_REACH,
    cy - ry * WOUND_GLOW_FILL_REACH,
    rx * WOUND_GLOW_FILL_SPAN,
    ry * WOUND_GLOW_FILL_SPAN,
  );
  // Ribs sweep down and back round the barrel, thick at the spine and
  // thinning toward the belly, each bowed outward.
  ctx.lineCap = 'round';
  const ribs = view === 'side' ? SIDE_RIBS : AXIAL_RIBS;
  for (let i = 0; i < ribs; i++) {
    const x = cx - rx * TEAR_RIB.firstOffset + (i / Math.max(1, ribs - 1)) * rx * TEAR_RIB.spread;
    const top = pt(x + rx * TEAR_RIB.topLead, cy - ry * TEAR_RIB.reach);
    const bottom = pt(x - rx * TEAR_RIB.bottomTrail, cy + ry * TEAR_RIB.reach);
    const bow = pt(x + rx * TEAR_RIB.bowLead, cy + ry * TEAR_RIB.bowDrop);
    for (const [colour, width] of [
      [INK, RIB_WIDTH * RIB_INK_SCALE],
      [BONE, RIB_WIDTH],
    ] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.quadraticCurveTo(bow.x, bow.y, bottom.x, bottom.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const TEAR_POINTS = 14;
/** The shortest a gash point reaches, as a share of its full reach. */
const TEAR_MIN_REACH = 0.55;
/** How far the wound leans back along the barrel with depth. */
const TEAR_SLANT = -0.35;
const SIDE_RIBS = 3;
const AXIAL_RIBS = 2;
const RIB_WIDTH = 0.026;

const EYE_GLOW_RADIUS = 0.055;
const EYE_GLOW = { coreAlpha: 0.95, midStop: 0.4, midAlpha: 0.6 } as const;

function eyeGlow(ctx: Ctx, at: Pt, flare = 0): void {
  const { core, mid, deep } = hollowSoulPalette;
  const radius = EYE_GLOW_RADIUS * (1 + flare * EYE_FLARE_GROWTH);
  const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
  g.addColorStop(0, soul(core, EYE_GLOW.coreAlpha));
  g.addColorStop(EYE_GLOW.midStop, soul(mid, EYE_GLOW.midAlpha));
  g.addColorStop(1, soul(deep, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, TWO_PI);
  ctx.fill();
}

/** How much wider the eye-light burns at the peak of the charge's wind-up. */
const EYE_FLARE_GROWTH = 1.2;

/**
 * Where the cow painter puts the eyes in each view's head space, as fractions
 * of the head's own length and depth (profile) or of the face's half-width and
 * height (head-on). Read off `cowArt.ts`'s `drawHeadSide` and
 * `drawCowFrontHead`; the eye-glow gate re-measures that the light lands on
 * the eyes.
 */
const SIDE_EYE = { along: 0.3, down: -0.24 } as const;
const FRONT_EYE = { across: 0.86, down: 0.34 } as const;

/** A snort's puffs, off the nostrils: position and drift in the head's own space. */
const PUFFS = 3;

function snortPuffs(ctx: Ctx, nostril: Pt, forward: Pt, across: Pt, amount: number): void {
  const { core, mid } = hollowSoulPalette;
  for (let i = 0; i < PUFFS; i++) {
    const spread = (i - (PUFFS - 1) / 2) * SNORT_SPREAD;
    const drift = amount * (SNORT_DRIFT + i * SNORT_DRIFT_STEP);
    const at = pt(
      nostril.x + forward.x * drift + across.x * spread,
      nostril.y + forward.y * drift + across.y * spread,
    );
    const r = SNORT_START_RADIUS + amount * SNORT_GROWTH;
    const alpha = Math.max(0, 1 - amount * SNORT_FADE);
    const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, r);
    g.addColorStop(0, soul(core, alpha));
    g.addColorStop(SNORT_MID_STOP, soul(mid, alpha * SNORT_MID_ALPHA));
    g.addColorStop(1, soul(mid, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(at.x, at.y, r, 0, TWO_PI);
    ctx.fill();
  }
}

const SNORT_SPREAD = 0.05;
const SNORT_DRIFT = 0.05;
const SNORT_DRIFT_STEP = 0.03;
const SNORT_START_RADIUS = 0.05;
const SNORT_GROWTH = 0.06;
/** How much of a puff's light is gone by the end of the snort. */
const SNORT_FADE = 0.5;
const SNORT_MID_STOP = 0.5;
const SNORT_MID_ALPHA = 0.7;
/** Where the profile nostril is, in head space, as fractions of the head's length and depth. */
const SIDE_NOSTRIL = { along: 0.98, down: -0.1 } as const;
/** The way the profile breath blows: forward and a little down, along the line of the face. */
const SIDE_SNORT_FORWARD = pt(1, 0.35);
const SIDE_SNORT_ACROSS = pt(0, 1);
/**
 * The head-on nostrils: how far out from the middle, as a share of the face's
 * half-width, and how far up from its bottom edge, as a share of its height.
 */
const FRONT_NOSTRIL = { across: 0.35, up: 0.12 } as const;
/** Head-on, each nostril's breath blows outward to its own side and down toward the ground. */
const FRONT_SNORT_FORWARD = { out: 0.6, down: 0.8 } as const;

function graveDecorations(snort: number, glare: number): CowDecorations {
  return {
    body: (ctx, view, outline) => {
      const box = boxOf(outline);
      drawSpine(ctx, outline, box, view);
      drawRibTear(ctx, box, view);
    },
    head: (ctx, view, outline) => {
      const b = GRAVE_BULL_BUILD;
      if (view === 'side') {
        eyeGlow(ctx, pt(SIDE_EYE.along * b.headLength, SIDE_EYE.down * b.headDepth), glare);
        // Blown from the nostrils along the line of the face, so the breath
        // comes out of the bull rather than floating in front of it.
        if (snort > 0) {
          const nostril = pt(SIDE_NOSTRIL.along * b.headLength, SIDE_NOSTRIL.down * b.headDepth);
          snortPuffs(ctx, nostril, SIDE_SNORT_FORWARD, SIDE_SNORT_ACROSS, snort);
        }
        return;
      }
      if (view !== 'front') return;
      const box = boxOf(outline);
      const w = b.headFrontHalfWidth;
      const h = box.maxY - box.minY;
      for (const side of [-1, 1]) {
        eyeGlow(ctx, pt(side * w * FRONT_EYE.across, box.minY + FRONT_EYE.down * h), glare);
      }
      if (snort > 0) {
        for (const side of [-1, 1]) {
          const nostril = pt(side * w * FRONT_NOSTRIL.across, box.maxY - FRONT_NOSTRIL.up * h);
          const forward = pt(side * FRONT_SNORT_FORWARD.out, FRONT_SNORT_FORWARD.down);
          snortPuffs(ctx, nostril, forward, pt(1, 0), snort);
        }
      }
    },
  };
}

/**
 * The Grave Bull's look with a snort of `snort` (0–1) blowing from its
 * nostrils and its eyes burning `glare` (0–1) wider, for the charge's
 * wind-up. Every variant keeps one id, so its rot patches never move.
 */
export function graveBullLook(snort: number, glare = 0): CowLook {
  return {
    id: 'grave_bull',
    build: GRAVE_BULL_BUILD,
    hide: GRAVE_HIDE,
    horns: GRAVE_HORNS,
    shag: 0,
    forelock: 0,
    decorations: graveDecorations(snort, glare),
  };
}

/** The Grave Bull's look at rest, for the cow painter. */
export const GRAVE_BULL_LOOK: CowLook = graveBullLook(0);

// ── Chains ───────────────────────────────────────────────────────────────────

const CHAIN_LINKS = 9;
const LINK_RX = 0.048;
const LINK_RY = 0.03;
const CHAIN_LENGTH = 0.58;
/** How far a chain swings at the bottom for a full swing, in tiles. */
const CHAIN_SWING = 0.1;
/**
 * The chain's sag curve: its control point swings only a little and hangs just
 * past halfway down, so the top hangs straight and the tail does the swinging.
 */
const CHAIN_CONTROL_SWING = 0.2;
const CHAIN_CONTROL_DROP = 0.55;
/** An edge-on link's width as a share of a face-on one's. */
const LINK_EDGE_ON_WIDTH = 0.55;
/** The dark hole through a face-on link, as shares of the link's radii. */
const LINK_HOLE = { across: 0.4, along: 0.55 } as const;
/**
 * How the chains swing from the pose: a walk's sway lagging the stride, and a
 * lunge dragging them back hard.
 */
const CHAIN_MOTION = { strideLag: 0.8, strideSwing: 0.6, lungeDrag: 4, swayFollow: 3 } as const;
/** The second horn's chain is a little shorter and swung a little out of step, so the pair never mirror. */
const SECOND_CHAIN_LENGTH = 0.85;
const SECOND_CHAIN_SWING_OFFSET = 0.2;

/**
 * One length of chain hanging from `from`, sagging under gravity and swung
 * sideways by `swing` (−1…1). Links alternate face-on and edge-on, which is
 * what makes a row of ovals read as chain.
 */
function drawChain(ctx: Ctx, from: Pt, swing: number, length: number): void {
  const end = pt(from.x + swing * CHAIN_SWING, from.y + length);
  const control = pt(
    from.x + swing * CHAIN_SWING * CHAIN_CONTROL_SWING,
    from.y + length * CHAIN_CONTROL_DROP,
  );
  ctx.save();
  ctx.lineWidth = CHAIN_INK_WIDTH;
  for (let i = 0; i < CHAIN_LINKS; i++) {
    const t = (i + 0.5) / CHAIN_LINKS;
    const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * end.x;
    const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * end.y;
    const edgeOn = i % 2 === 1;
    ctx.strokeStyle = IRON_DARK;
    ctx.fillStyle = edgeOn ? IRON_LIGHT : IRON;
    ctx.beginPath();
    if (edgeOn) ctx.ellipse(x, y, LINK_RY * LINK_EDGE_ON_WIDTH, LINK_RX, 0, 0, TWO_PI);
    else ctx.ellipse(x, y, LINK_RY, LINK_RX, 0, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();
    if (!edgeOn) {
      ctx.fillStyle = IRON_DARK;
      ctx.beginPath();
      ctx.ellipse(x, y, LINK_RY * LINK_HOLE.across, LINK_RX * LINK_HOLE.along, 0, 0, TWO_PI);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Where each horn's chain is fastened, from the poll, per view. */
const CHAIN_ANCHORS: Readonly<Record<CowView, readonly Pt[]>> = {
  side: [pt(0.06, -0.05)],
  front: [pt(-0.2, -0.02), pt(0.2, -0.02)],
  back: [pt(-0.22, -0.02), pt(0.22, -0.02)],
};

/**
 * The chains trailing from the horns, in the cow painter's space. Swung by the
 * pose's own lunge and sway, lagging the body, so they trail a charge and
 * swing through a walk.
 */
export function drawGraveBullChains(ctx: Ctx, view: CowView, pose: CowPose): void {
  const poll = cowPollPoint(pose, GRAVE_BULL_LOOK, view);
  const swing =
    Math.sin(pose.time * TWO_PI - CHAIN_MOTION.strideLag) * CHAIN_MOTION.strideSwing -
    pose.lunge * CHAIN_MOTION.lungeDrag +
    pose.sway * CHAIN_MOTION.swayFollow;
  CHAIN_ANCHORS[view].forEach((offset, i) => {
    const from = pt(poll.x + offset.x, poll.y + offset.y);
    const length = CHAIN_LENGTH * (i === 0 ? 1 : SECOND_CHAIN_LENGTH);
    const swingOffset = i === 0 ? 0 : SECOND_CHAIN_SWING_OFFSET;
    drawChain(ctx, from, Math.max(-1, Math.min(1, swing + swingOffset)), length);
  });
}

// ── Dust ─────────────────────────────────────────────────────────────────────

const DUST_CLODS = 5;
/**
 * The clods over one scrape: each flung further back than the last, the middle
 * ones highest, the later ones bigger, all thinning as the scrape ends.
 */
const DUST_CLOD = {
  spacing: 0.045,
  lift: 0.08,
  radius: 0.025,
  radiusStep: 0.006,
  alpha: 0.7,
  fade: 0.5,
} as const;

/**
 * Dust kicked up where the forefoot scrapes, in the cow painter's space. `x`
 * is where the hoof is along the ground; `amount` 0–1 through one scrape.
 */
export function drawHoofDust(ctx: Ctx, x: number, groundY: number, amount: number): void {
  if (amount <= 0) return;
  ctx.save();
  for (let i = 0; i < DUST_CLODS; i++) {
    const back = (i + 1) * DUST_CLOD.spacing * amount;
    const up = Math.sin((i / DUST_CLODS) * Math.PI) * DUST_CLOD.lift * amount;
    const r = DUST_CLOD.radius + i * DUST_CLOD.radiusStep;
    ctx.fillStyle = rgba(DUST, Math.max(0, DUST_CLOD.alpha * (1 - amount * DUST_CLOD.fade)));
    ctx.beginPath();
    ctx.arc(x - back, groundY - up, r, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

// ── Bones ────────────────────────────────────────────────────────────────────

/**
 * A long bone's ends, as multiples of its half-width: each end is a pair of
 * knobs set just inside the shaft's edges and a little fatter than it, and the
 * shaded underside takes the lower part of the shaft.
 */
const LONG_BONE = { knobSpread: 0.9, knobRadius: 1.2, shadowEdge: 0.4 } as const;

/** A long bone with knobbed ends, from `a` to `b`. */
export function drawLongBone(ctx: Ctx, a: Pt, b: Pt, half: number): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const nx = Math.cos(angle + Math.PI / 2) * half;
  const ny = Math.sin(angle + Math.PI / 2) * half;
  ctx.save();
  ctx.fillStyle = BONE;
  ctx.strokeStyle = INK;
  ctx.lineWidth = BONE_INK_WIDTH;
  ctx.beginPath();
  ctx.moveTo(a.x + nx, a.y + ny);
  ctx.lineTo(b.x + nx, b.y + ny);
  ctx.lineTo(b.x - nx, b.y - ny);
  ctx.lineTo(a.x - nx, a.y - ny);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (const end of [a, b]) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      const knobX = end.x + nx * side * LONG_BONE.knobSpread;
      const knobY = end.y + ny * side * LONG_BONE.knobSpread;
      ctx.arc(knobX, knobY, half * LONG_BONE.knobRadius, 0, TWO_PI);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.fillStyle = BONE_SHADOW;
  ctx.beginPath();
  ctx.moveTo(a.x - nx * LONG_BONE.shadowEdge, a.y - ny * LONG_BONE.shadowEdge);
  ctx.lineTo(b.x - nx * LONG_BONE.shadowEdge, b.y - ny * LONG_BONE.shadowEdge);
  ctx.lineTo(b.x - nx, b.y - ny);
  ctx.lineTo(a.x - nx, a.y - ny);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The skull's horn, sweeping up and back from the poll: out along one curve, home along the other. */
const SKULL_HORN = {
  root: pt(-0.08, -0.06),
  outerControl: pt(-0.2, -0.2),
  tip: pt(-0.1, -0.34),
  innerControl: pt(-0.14, -0.2),
  innerRoot: pt(-0.02, -0.08),
} as const;
/** The skull's profile: deep at the brow and occiput, tapering to the muzzle. */
const SKULL_OUTLINE = {
  occiput: pt(-0.13, -0.07),
  browControl: pt(-0.02, -0.12),
  brow: pt(0.12, -0.06),
  snoutTop: pt(0.24, -0.02),
  muzzleControl: pt(0.27, 0.03),
  chin: pt(0.22, 0.06),
  jaw: pt(0.02, 0.07),
  jawControl: pt(-0.13, 0.06),
} as const;
const SKULL_EYE_SOCKET = { centre: pt(-0.02, -0.03), rx: 0.035, ry: 0.028 } as const;
const SKULL_NOSTRIL = { centre: pt(0.2, 0.0), rx: 0.02, ry: 0.025 } as const;

/**
 * A bull's skull, horns and all, in profile facing +X, about its own centre.
 * `light` is how much of the blue is left in its eye socket.
 */
export function drawBullSkull(ctx: Ctx, light: number): void {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = SKULL_INK_WIDTH;
  const horn = SKULL_HORN;
  ctx.fillStyle = BONE;
  ctx.beginPath();
  ctx.moveTo(horn.root.x, horn.root.y);
  ctx.quadraticCurveTo(horn.outerControl.x, horn.outerControl.y, horn.tip.x, horn.tip.y);
  ctx.quadraticCurveTo(
    horn.innerControl.x,
    horn.innerControl.y,
    horn.innerRoot.x,
    horn.innerRoot.y,
  );
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const skull = SKULL_OUTLINE;
  ctx.beginPath();
  ctx.moveTo(skull.occiput.x, skull.occiput.y);
  ctx.quadraticCurveTo(skull.browControl.x, skull.browControl.y, skull.brow.x, skull.brow.y);
  ctx.lineTo(skull.snoutTop.x, skull.snoutTop.y);
  ctx.quadraticCurveTo(skull.muzzleControl.x, skull.muzzleControl.y, skull.chin.x, skull.chin.y);
  ctx.lineTo(skull.jaw.x, skull.jaw.y);
  ctx.quadraticCurveTo(skull.jawControl.x, skull.jawControl.y, skull.occiput.x, skull.occiput.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = CAVITY;
  for (const hole of [SKULL_EYE_SOCKET, SKULL_NOSTRIL]) {
    ctx.beginPath();
    ctx.ellipse(hole.centre.x, hole.centre.y, hole.rx, hole.ry, 0, 0, TWO_PI);
    ctx.fill();
  }
  if (light > MIN_VISIBLE_LIGHT) {
    ctx.globalAlpha *= Math.min(1, light);
    eyeGlow(ctx, SKULL_EYE_SOCKET.centre);
  }
  ctx.restore();
}

/**
 * The heap the Grave Bull falls into, in profile: the hide slumped into a
 * long low mound — as long as the animal was, so it still reads as a bull —
 * the ribs arching out of it with the last of the blue fading between them,
 * the skull and a long bone on top, and the chains lying slack beside it.
 * `settle` runs 0 (the heap forming) to 1 (settled).
 */
export function drawBullBonePile(ctx: Ctx, settle: number): void {
  const grow = Math.max(0, Math.min(1, settle));
  const h = PILE_HEIGHT * (PILE_FRESH_HEIGHT + (1 - PILE_FRESH_HEIGHT) * grow);
  const w = PILE_HALF_LENGTH;
  ctx.save();
  ctx.fillStyle = GRAVE_HIDE.base;
  ctx.strokeStyle = INK;
  ctx.lineWidth = PILE_INK_WIDTH;
  const mound = PILE_MOUND;
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.quadraticCurveTo(-w * mound.rumpControl.x, -h * mound.rumpControl.y, -w * mound.crestX, -h);
  ctx.quadraticCurveTo(w * mound.headControl.x, -h * mound.headControl.y, w, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const light = 1 - grow;
  if (light > MIN_VISIBLE_LIGHT) {
    const { mid } = hollowSoulPalette;
    ctx.fillStyle = soul(mid, PILE_GLOW.alpha * light);
    ctx.beginPath();
    const glowX = -w * PILE_GLOW.centre.x;
    const glowY = -h * PILE_GLOW.centre.y;
    ctx.ellipse(glowX, glowY, w * PILE_GLOW.rx, h * PILE_GLOW.ry, 0, 0, TWO_PI);
    ctx.fill();
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < RIB_COUNT; i++) {
    const ribs = PILE_RIBS;
    const x = -w * ribs.first + (i / (RIB_COUNT - 1)) * w * ribs.spread;
    for (const [colour, width] of [
      [INK, ribs.inkWidth],
      [BONE, RIB_WIDTH],
    ] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x - ribs.foot.x, -h * ribs.foot.y);
      ctx.quadraticCurveTo(x + ribs.arch.x, -h * ribs.arch.y, x + ribs.tip.x, -h * ribs.tip.y);
      ctx.stroke();
    }
  }
  const bone = PILE_BONE;
  const boneFrom = pt(w * bone.from.x, -h * bone.from.y);
  const boneTo = pt(w * bone.to.x, -h * bone.to.y);
  drawLongBone(ctx, boneFrom, boneTo, bone.half);
  drawChain(ctx, pt(w * PILE_CHAIN_ANCHOR.x, -h * PILE_CHAIN_ANCHOR.y), 1, PILE_CHAIN_LENGTH);
  ctx.save();
  ctx.translate(w * PILE_SKULL_AT.x, -h * PILE_SKULL_AT.y);
  drawBullSkull(ctx, light);
  ctx.restore();
  ctx.restore();
}

/** As long as the standing bull's barrel, so the heap still reads as the animal. */
const PILE_HALF_LENGTH = 0.72;
const PILE_HEIGHT = 0.22;
const PILE_CHAIN_LENGTH = 0.2;
/** A fresh heap stands this share of its settled height, then slumps out to it. */
const PILE_FRESH_HEIGHT = 0.5;
/**
 * Everything on the heap is placed as shares of its half-length (x) and height
 * (y), so it slumps along with the mound. The mound's rump end is rounder, its
 * head end rises higher.
 */
const PILE_MOUND = { rumpControl: pt(0.85, 1.1), crestX: 0.1, headControl: pt(0.5, 1.25) } as const;
/** The last of the blue, glowing up through the hide around the ribs. */
const PILE_GLOW = { alpha: 0.6, centre: pt(0.05, 0.9), rx: 0.3, ry: 0.6 } as const;
/**
 * The ribs arching out of the heap. Their sideways offsets are in piece units
 * rather than heap shares, so the arches keep their width as the heap grows.
 */
const PILE_RIBS = {
  first: 0.35,
  spread: 0.6,
  inkWidth: 0.042,
  foot: pt(0.05, 0.6),
  arch: pt(0.02, 2),
  tip: pt(0.09, 0.7),
} as const;
const PILE_BONE = { from: pt(0.3, 0.5), to: pt(0.85, 0.15), half: 0.024 } as const;
const PILE_CHAIN_ANCHOR = pt(0.55, 0.9);
const PILE_SKULL_AT = pt(0.72, 1.05);

// ── Gore ─────────────────────────────────────────────────────────────────────

/** The bones a Grave Bull flies apart into. No meat: it has had none for a while. */
export const GRAVE_BULL_GORE_STATES = [
  'gore_skull',
  'gore_ribcage',
  'gore_spine',
  'gore_femur',
  'gore_horn',
  'gore_chain',
] as const;

export type GraveBullGoreState = (typeof GRAVE_BULL_GORE_STATES)[number];

/** A loose run of ribs, bowed forward, with a length of spine across their tops. */
const GORE_RIBCAGE = {
  firstX: -0.15,
  spacing: 0.1,
  halfHeight: 0.2,
  bow: 0.12,
  inkWidth: 0.05,
  boneWidth: 0.03,
  spine: { from: pt(-0.2, -0.2), to: pt(0.22, -0.2), half: 0.02 },
} as const;
/**
 * A loose length of spine: vertebrae along a gentle wave, alternately lit and
 * shaded, each with its process standing up.
 */
const GORE_SPINE = {
  vertebrae: 5,
  firstX: -0.2,
  spacing: 0.1,
  waveStep: 0.9,
  waveHeight: 0.03,
  rx: 0.045,
  ry: 0.035,
  processBack: pt(-0.015, -0.03),
  processTip: pt(0.01, -0.09),
  processFront: pt(0.025, -0.03),
} as const;
const GORE_FEMUR = { from: pt(-0.22, 0.06), to: pt(0.22, -0.06), half: 0.03 } as const;
/** A snapped-off horn, with its crack and its chain still fastened at the root. */
const GORE_HORN = {
  root: pt(-0.2, 0.06),
  outerControl: pt(0.05, 0.02),
  tip: pt(0.2, -0.16),
  innerControl: pt(0.02, -0.04),
  innerRoot: pt(-0.2, -0.04),
  crackFrom: pt(-0.02, 0.02),
  crackTo: pt(0.0, -0.04),
  crackInk: 0.2,
  chainAnchor: pt(-0.18, 0.02),
  chainSwing: 0.6,
  chainLength: 0.22,
} as const;
/** A loose chain, laid diagonally so it fills its square cell. */
const GORE_CHAIN = { tilt: -60, anchor: pt(0, -0.22), swing: 0.3, length: 0.44 } as const;

/** Paints one loose piece about its own centre, in piece units. */
export function paintGraveBullGore(ctx: Ctx, state: GraveBullGoreState): void {
  switch (state) {
    case 'gore_skull':
      drawBullSkull(ctx, 0);
      return;
    case 'gore_ribcage': {
      ctx.save();
      ctx.strokeStyle = INK;
      ctx.lineCap = 'round';
      const cage = GORE_RIBCAGE;
      for (let i = 0; i < RIB_COUNT - 1; i++) {
        const x = cage.firstX + i * cage.spacing;
        for (const [colour, width] of [
          [INK, cage.inkWidth],
          [BONE, cage.boneWidth],
        ] as const) {
          ctx.strokeStyle = colour;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(x, -cage.halfHeight);
          ctx.quadraticCurveTo(x + cage.bow, 0, x, cage.halfHeight);
          ctx.stroke();
        }
      }
      drawLongBone(ctx, cage.spine.from, cage.spine.to, cage.spine.half);
      ctx.restore();
      return;
    }
    case 'gore_spine': {
      ctx.save();
      ctx.strokeStyle = INK;
      ctx.lineWidth = BONE_INK_WIDTH;
      const spine = GORE_SPINE;
      for (let i = 0; i < spine.vertebrae; i++) {
        const x = spine.firstX + i * spine.spacing;
        const y = Math.sin(i * spine.waveStep) * spine.waveHeight;
        ctx.fillStyle = i % 2 === 0 ? BONE : BONE_SHADOW;
        ctx.beginPath();
        ctx.ellipse(x, y, spine.rx, spine.ry, 0, 0, TWO_PI);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + spine.processBack.x, y + spine.processBack.y);
        ctx.lineTo(x + spine.processTip.x, y + spine.processTip.y);
        ctx.lineTo(x + spine.processFront.x, y + spine.processFront.y);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    case 'gore_femur':
      drawLongBone(ctx, GORE_FEMUR.from, GORE_FEMUR.to, GORE_FEMUR.half);
      return;
    case 'gore_horn': {
      const horn = GORE_HORN;
      ctx.save();
      ctx.fillStyle = BONE;
      ctx.strokeStyle = INK;
      ctx.lineWidth = SKULL_INK_WIDTH;
      ctx.beginPath();
      ctx.moveTo(horn.root.x, horn.root.y);
      ctx.quadraticCurveTo(horn.outerControl.x, horn.outerControl.y, horn.tip.x, horn.tip.y);
      ctx.quadraticCurveTo(
        horn.innerControl.x,
        horn.innerControl.y,
        horn.innerRoot.x,
        horn.innerRoot.y,
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = mix(INK, BONE, horn.crackInk);
      ctx.beginPath();
      ctx.moveTo(horn.crackFrom.x, horn.crackFrom.y);
      ctx.lineTo(horn.crackTo.x, horn.crackTo.y);
      ctx.stroke();
      ctx.restore();
      drawChain(ctx, horn.chainAnchor, horn.chainSwing, horn.chainLength);
      return;
    }
    case 'gore_chain':
      ctx.save();
      ctx.rotate(deg(GORE_CHAIN.tilt));
      drawChain(ctx, GORE_CHAIN.anchor, GORE_CHAIN.swing, GORE_CHAIN.length);
      ctx.restore();
      return;
  }
}
