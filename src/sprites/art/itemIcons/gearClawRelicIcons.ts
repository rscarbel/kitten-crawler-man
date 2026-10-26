/**
 * Icons for the cat's claw sets and the relics either crawler carries.
 *
 * The claw sets share one idea — hooked claws raised mid-swipe — and tell
 * themselves apart by material and by how far they curl: blunt thimble caps,
 * glossy green hooks that drip, slim ice hooks on a rimed strap, deep black
 * sickles, ivory claws dipped black, and long gold talons in front of a
 * sunburst. At hotbar size hue alone would not tell six sets of claws apart.
 */

import type { Rect } from '../../../ui/core/geom';
import {
  bandedFill,
  disc,
  FULL_TURN,
  glint,
  hairlineWidth,
  ICON_OUTLINE,
  litFill,
  MEDIUM_DETAIL,
  offsetShade,
  paintForm,
  paintIconArt,
  strokeDetail,
  tone,
  traceEllipse,
  tracePoints,
  withShapeClip,
  type IconPoint,
} from './iconPaint';

export type GearClawRelicIconId =
  | 'tin_claw_caps'
  | 'venom_claws'
  | 'frostbite_claws'
  | 'prowler_claws'
  | 'ink_dipped_claws'
  | 'sunsteel_talons'
  | 'ember_wisp'
  | 'ward_stone'
  | 'sproutling_seed';

type Point = readonly [x: number, y: number];

/**
 * One curved claw: its base centred on (x, y), leaning `angle` radians
 * clockwise from straight up, `length` from base to tip, `width` across the
 * base. `hook` is how far the tip curls toward the lean, as a share of the
 * length; `belly` how far the inner edge bows back toward the outer one.
 */
interface ClawShape {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly length: number;
  readonly width: number;
  readonly hook: number;
  readonly belly: number;
}

/** How far the outer (back) edge's control point rises past the tip, as a share of the length. */
const CLAW_BACK_RISE = 1.08;
/** The inner edge's control sits this far up the claw. */
const CLAW_INNER_HEIGHT = 0.42;

function rotate(local: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [local[0] * cos - local[1] * sin, local[0] * sin + local[1] * cos];
}

function place(claw: ClawShape, local: Point, dx: number, dy: number): Point {
  const [rx, ry] = rotate(local, claw.angle);
  return [claw.x + rx + dx, claw.y + ry + dy];
}

function clawTip(claw: ClawShape): Point {
  return place(claw, [claw.hook * claw.length, -claw.length], 0, 0);
}

function traceClaw(ctx: CanvasRenderingContext2D, claw: ClawShape, dx = 0, dy = 0): void {
  const half = claw.width / 2;
  const tipLocal: Point = [claw.hook * claw.length, -claw.length];
  const baseLeft = place(claw, [-half, 0], dx, dy);
  const baseRight = place(claw, [half, 0], dx, dy);
  const tip = place(claw, tipLocal, dx, dy);
  const back = place(claw, [-half, -claw.length * CLAW_BACK_RISE], dx, dy);
  const inner = place(
    claw,
    [half - claw.belly * claw.length, -claw.length * CLAW_INNER_HEIGHT],
    dx,
    dy,
  );
  ctx.beginPath();
  ctx.moveTo(baseLeft[0], baseLeft[1]);
  ctx.quadraticCurveTo(back[0], back[1], tip[0], tip[1]);
  ctx.quadraticCurveTo(inner[0], inner[1], baseRight[0], baseRight[1]);
  ctx.closePath();
}

/** Lit side of a claw is its back, toward the top-left; the far layer turns the belly into shade. */
const CLAW_LIGHT_SHIFT = 0.022;
const CLAW_SHADE_SHIFT = 0.05;
/** The shade layers slide half as far down as across, so the terminator runs along the claw's length. */
const CLAW_SHADE_SLOPE = 0.5;
/** A detail line outlined in near-black is drawn this much wider underneath, so it reads on any material. */
const DETAIL_OUTLINE_SCALE = 2;

/** Paints `claw` outlined, shaded by its own silhouette shifted down-right. */
function paintClaw(
  ctx: CanvasRenderingContext2D,
  px: number,
  claw: ClawShape,
  base: string,
  highlight: string,
  shade: string,
): void {
  paintForm(ctx, px, () => traceClaw(ctx, claw), highlight);
  offsetShade(ctx, (dx, dy) => traceClaw(ctx, claw, dx, dy), [
    [base, CLAW_LIGHT_SHIFT, CLAW_LIGHT_SHIFT * CLAW_SHADE_SLOPE],
    [shade, CLAW_SHADE_SHIFT, CLAW_SHADE_SHIFT * CLAW_SHADE_SLOPE],
  ]);
}

/** Three claws fanned from a swipe, the middle one longest, their roots laid across the lean. */
function fan(spec: {
  /** The tips curl toward the lean, so a fan sits left of centre to keep its hooks inside the cell. */
  readonly centreX: number;
  readonly baseY: number;
  readonly spread: number;
  readonly tilt: number;
  readonly lean: number;
  readonly length: number;
  readonly sideLength: number;
  readonly width: number;
  readonly hook: number;
  readonly belly: number;
}): readonly ClawShape[] {
  const sides = [-1, 0, 1] as const;
  return sides.map((side) => {
    const [offsetX, offsetY] = rotate(
      [side * spec.spread, Math.abs(side) * SIDE_CLAW_DROP],
      spec.lean,
    );
    return {
      x: spec.centreX + offsetX,
      y: spec.baseY + offsetY,
      angle: spec.lean + side * spec.tilt,
      length: side === 0 ? spec.length : spec.sideLength,
      width: spec.width,
      hook: spec.hook,
      belly: spec.belly,
    };
  });
}

/** The middle claw of a {@link fan}, the longest. */
const MIDDLE_CLAW = 1;

/** The outer claws sit a little lower than the middle one, the way toes splay round a pad. */
const SIDE_CLAW_DROP = 0.04;

// ── Tin claw caps ────────────────────────────────────────────────────────────

const TIN = '#8d9196';
const TIN_LIGHT = '#b9bdc2';
const TIN_DARK = '#55595f';
const TIN_RIM = '#6c7076';
const CAP_HOLLOW = '#1d1f24';

/**
 * Three loose caps, each a crescent sheath shaped like the claw tip it slips
 * over: two standing at odd angles and one tumbled onto its side with its open
 * mouth toward the viewer, so they read as caps and not a crown or bullets.
 */
const CAPS: readonly ClawShape[] = [
  { x: 0.28, y: 0.6, angle: -0.12, length: 0.44, width: 0.22, hook: 0.42, belly: 0.13 },
  { x: 0.66, y: 0.56, angle: 0.22, length: 0.44, width: 0.22, hook: 0.42, belly: 0.13 },
  { x: 0.2, y: 0.84, angle: 1.42, length: 0.44, width: 0.22, hook: 0.42, belly: 0.13 },
];
const TUMBLED_CAP = 2;
/** The rolled rim at a cap's mouth: a band a little wider than the cap, straddling its open end. */
const CAP_RIM_OVERHANG = 0.014;
const CAP_RIM_HALF_DEPTH = 0.028;
const CAP_RIM_ROUND = 0.014;
/** Seen end-on, the mouth is an ellipse this deep; the hollow is the mouth less the rim's thickness. */
const CAP_MOUTH_DEPTH = 0.06;
const CAP_HOLLOW_SHARE = 0.7;
/** One pressed ridge round each cap, a third of the way up. */
const CAP_RIDGE_ALONG = 0.3;
/** Tin is dull: a soft pale spot, never the four-armed glint polished metal gets. */
const CAP_SHINE_R = 0.026;
const CAP_SHINE_ALONG = 0.55;

function paintCapMouth(ctx: CanvasRenderingContext2D, px: number, cap: ClawShape): void {
  const half = cap.width / 2 + CAP_RIM_OVERHANG;
  const traceMouth = (share: number): void => {
    ctx.beginPath();
    ctx.ellipse(cap.x, cap.y, half * share, CAP_MOUTH_DEPTH * share, cap.angle, 0, FULL_TURN);
  };
  paintForm(ctx, px, () => traceMouth(1), TIN_RIM);
  traceMouth(CAP_HOLLOW_SHARE);
  ctx.fillStyle = CAP_HOLLOW;
  ctx.fill();
}

function paintTinCaps(ctx: CanvasRenderingContext2D, px: number): void {
  CAPS.forEach((cap, index) => {
    paintClaw(ctx, px, cap, TIN, TIN_LIGHT, TIN_DARK);
    withShapeClip(
      ctx,
      () => traceClaw(ctx, cap),
      () =>
        strokeDetail(
          ctx,
          px,
          [pointAlong(cap, CAP_RIDGE_ALONG, -1), pointAlong(cap, CAP_RIDGE_ALONG, 1)],
          TIN_DARK,
          MEDIUM_DETAIL,
        ),
    );
    const rim = rootBlock(cap, cap.width / 2 + CAP_RIM_OVERHANG, CAP_RIM_HALF_DEPTH, CAP_RIM_ROUND);
    paintForm(ctx, px, () => tracePoints(ctx, rim), TIN_RIM);
    if (index === TUMBLED_CAP) paintCapMouth(ctx, px, cap);
    const [sx, sy] = pointAlong(cap, CAP_SHINE_ALONG, GLOSS_ACROSS);
    disc(ctx, sx, sy, CAP_SHINE_R, TIN_LIGHT);
  });
}

// ── Shared claw details ──────────────────────────────────────────────────────

/** Where a claw's gloss sits across it: a quarter of its width toward the lit back. */
const GLOSS_ACROSS = -0.25;

function pointAlong(claw: ClawShape, along: number, across: number): Point {
  return place(claw, [across * claw.width, -claw.length * along], 0, 0);
}

/** A rounded block centred on `claw`'s root, lying across it: a cuff, a strap or a cap's rim. */
function rootBlock(
  claw: ClawShape,
  halfLength: number,
  halfDepth: number,
  round: number,
): readonly IconPoint[] {
  const corners: readonly Point[] = [
    [-halfLength, -halfDepth],
    [halfLength, -halfDepth],
    [halfLength, halfDepth],
    [-halfLength, halfDepth],
  ];
  return corners.map((corner) => {
    const [x, y] = place(claw, corner, 0, 0);
    return [x, y, round];
  });
}

// ── Venom claws ──────────────────────────────────────────────────────────────

const VENOM = '#2f8a3a';
const VENOM_LIGHT = '#9ef07a';
const VENOM_DARK = '#123a1c';
const VENOM_DRIP = '#b4f560';
const VENOM_CUFF = '#4a3a34';
/** A compact cluster of curved claws swiping up and right out of a cuff at the lower left. */
const VENOM_CLAWS = fan({
  centreX: 0.36,
  baseY: 0.78,
  spread: 0.15,
  tilt: 0.26,
  lean: 0.32,
  length: 0.58,
  sideLength: 0.46,
  width: 0.14,
  hook: 0.32,
  belly: 0.12,
});
const VENOM_CUFF_HALF_LENGTH = 0.2;
const VENOM_CUFF_HALF_DEPTH = 0.05;
const VENOM_CUFF_ROUND = 0.03;
/** One drop has let go of the leading claw's tip and falls clear of the others. */
const DRIPPING_CLAW = 2;
const DRIP_STRAND_DROP = 0.07;
const DRIP_BEAD_DROP = 0.17;
const DRIP_BEAD_R = 0.06;
const DRIP_POINT_RISE = 0.07;
const GLOSS_GLINT_R = 0.06;
const GLOSS_ALONG = 0.6;

function traceDrop(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const half = r / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r - DRIP_POINT_RISE);
  ctx.quadraticCurveTo(cx + r, cy - half, cx + r, cy);
  ctx.arc(cx, cy, r, 0, Math.PI);
  ctx.quadraticCurveTo(cx - r, cy - half, cx, cy - r - DRIP_POINT_RISE);
  ctx.closePath();
}

function paintVenomClaws(ctx: CanvasRenderingContext2D, px: number): void {
  for (const claw of VENOM_CLAWS) {
    paintClaw(ctx, px, claw, VENOM, VENOM_LIGHT, VENOM_DARK);
    const [gx, gy] = pointAlong(claw, GLOSS_ALONG, GLOSS_ACROSS);
    glint(ctx, gx, gy, GLOSS_GLINT_R);
  }
  const cuff = rootBlock(
    VENOM_CLAWS[MIDDLE_CLAW],
    VENOM_CUFF_HALF_LENGTH,
    VENOM_CUFF_HALF_DEPTH,
    VENOM_CUFF_ROUND,
  );
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, cuff),
    litFill(ctx, VENOM_CUFF, [cuff[0][0], cuff[0][1]], [cuff[2][0], cuff[2][1]]),
  );
  const [tx, ty] = clawTip(VENOM_CLAWS[DRIPPING_CLAW]);
  strokeDetail(
    ctx,
    px,
    [
      [tx, ty],
      [tx, ty + DRIP_STRAND_DROP],
    ],
    VENOM_DRIP,
    MEDIUM_DETAIL,
  );
  paintForm(ctx, px, () => traceDrop(ctx, tx, ty + DRIP_BEAD_DROP, DRIP_BEAD_R), VENOM_DRIP);
}

// ── Frostbite claws ──────────────────────────────────────────────────────────

const ICE_LIGHT = '#eaf8ff';
const ICE = '#8fd3f2';
const ICE_DARK = '#3d82b8';
const RIME = '#f4fbff';

/** An icicle claw: straight tapered sides meeting at a facet ridge, cut rather than grown. */
interface Icicle {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly length: number;
  readonly halfWidth: number;
}
/** Long straight spikes fanned wide from one root at the lower left, all pointing up and right. */
const ICICLES: readonly Icicle[] = [
  { x: 0.26, y: 0.82, angle: 0.12, length: 0.6, halfWidth: 0.09 },
  { x: 0.3, y: 0.8, angle: 0.6, length: 0.7, halfWidth: 0.1 },
  { x: 0.32, y: 0.82, angle: 1.08, length: 0.56, halfWidth: 0.09 },
];
/** A frost clump bunched round the roots, with crystal shards standing out of it. */
const FROST_CLUMP: readonly IconPoint[] = [
  [0.14, 0.88, 0.03],
  [0.16, 0.76],
  [0.22, 0.79],
  [0.27, 0.71],
  [0.33, 0.78],
  [0.4, 0.75],
  [0.4, 0.84],
  [0.46, 0.88],
  [0.38, 0.93, 0.03],
  [0.2, 0.94, 0.03],
];
const FROST_CRYSTALS: readonly (readonly [x: number, y: number, r: number])[] = [
  [0.14, 0.72, 0.06],
  [0.48, 0.76, 0.05],
];
const ICE_GLINT_ALONG = 0.7;
const ICE_GLINT_R = 0.065;

function iciclePoint(icicle: Icicle, local: Point): Point {
  const [rx, ry] = rotate(local, icicle.angle);
  return [icicle.x + rx, icicle.y + ry];
}

function icicleOutline(icicle: Icicle): readonly IconPoint[] {
  return [
    iciclePoint(icicle, [-icicle.halfWidth, 0]),
    iciclePoint(icicle, [0, -icicle.length]),
    iciclePoint(icicle, [icicle.halfWidth, 0]),
  ];
}

function icicleShadeFacet(icicle: Icicle): readonly IconPoint[] {
  return [
    iciclePoint(icicle, [0, 0]),
    iciclePoint(icicle, [0, -icicle.length]),
    iciclePoint(icicle, [icicle.halfWidth, 0]),
  ];
}

function paintFrostbiteClaws(ctx: CanvasRenderingContext2D, px: number): void {
  for (const icicle of ICICLES) {
    const outline = icicleOutline(icicle);
    paintForm(ctx, px, () => tracePoints(ctx, outline), ICE);
    withShapeClip(
      ctx,
      () => tracePoints(ctx, outline),
      () => {
        tracePoints(ctx, icicleShadeFacet(icicle));
        ctx.fillStyle = ICE_DARK;
        ctx.fill();
      },
    );
    strokeDetail(
      ctx,
      px,
      [iciclePoint(icicle, [0, 0]), iciclePoint(icicle, [0, -icicle.length])],
      ICE_LIGHT,
    );
    const [gx, gy] = iciclePoint(icicle, [-icicle.halfWidth / 2, -icicle.length * ICE_GLINT_ALONG]);
    glint(ctx, gx, gy, ICE_GLINT_R);
  }
  paintForm(ctx, px, () => tracePoints(ctx, FROST_CLUMP), RIME);
  for (const [x, y, r] of FROST_CRYSTALS) {
    glint(ctx, x, y, r + outlineAllowance(px), ICE_DARK);
    glint(ctx, x, y, r, ICE_LIGHT);
  }
}

// ── Prowler claws ────────────────────────────────────────────────────────────

const BLACKENED = '#4b5468';
/** Blackened steel is lifted to a gunmetal mid value and given a bright rim, or it vanishes into a dark slot. */
const BLACKENED_RIM = '#c8cedc';
const BLACKENED_DARK = '#333948';
const RIM_LIGHT = '#b8d4f2';
const STRAP = '#3e3a46';
const STITCH_SILVER = '#c3c8d2';
/** Two big sickles on a diagonal, the smaller one behind, worn on a felt cuff at their roots. */
const PROWLER_HOOKS: readonly ClawShape[] = [
  { x: 0.6, y: 0.84, angle: 0.24, length: 0.5, width: 0.22, hook: 0.6, belly: 0.18 },
  { x: 0.32, y: 0.86, angle: 0.06, length: 0.68, width: 0.28, hook: 0.6, belly: 0.22 },
];
/** A bright line along each sickle's back, the one place blackened steel catches light. */
const RIM_FROM = 0.12;
const RIM_TO = 0.78;
const RIM_ACROSS = -0.38;
const PROWLER_CUFF: readonly IconPoint[] = [
  [0.14, 0.8, 0.04],
  [0.8, 0.8, 0.04],
  [0.8, 0.94, 0.04],
  [0.14, 0.94, 0.04],
];
const CUFF_STITCH_Y = 0.87;
const CUFF_STITCH_FROM = 0.19;
const CUFF_STITCH_TO = 0.75;
const STITCH_DASH = 0.035;
const CUFF_TOP = 0.8;
const CUFF_BOTTOM = 0.94;

function paintProwlerClaws(ctx: CanvasRenderingContext2D, px: number): void {
  for (const hook of PROWLER_HOOKS) {
    paintClaw(ctx, px, hook, BLACKENED, BLACKENED_RIM, BLACKENED_DARK);
    withShapeClip(
      ctx,
      () => traceClaw(ctx, hook),
      () =>
        strokeDetail(
          ctx,
          px,
          [pointAlong(hook, RIM_FROM, RIM_ACROSS), pointAlong(hook, RIM_TO, RIM_ACROSS)],
          RIM_LIGHT,
          MEDIUM_DETAIL * DETAIL_OUTLINE_SCALE,
        ),
    );
  }
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, PROWLER_CUFF),
    litFill(ctx, STRAP, [0, CUFF_TOP], [0, CUFF_BOTTOM]),
  );
  ctx.save();
  try {
    ctx.setLineDash([STITCH_DASH, STITCH_DASH]);
    strokeDetail(
      ctx,
      px,
      [
        [CUFF_STITCH_FROM, CUFF_STITCH_Y],
        [CUFF_STITCH_TO, CUFF_STITCH_Y],
      ],
      STITCH_SILVER,
      MEDIUM_DETAIL,
    );
  } finally {
    ctx.restore();
  }
}

// ── Ink-dipped claws ─────────────────────────────────────────────────────────

const IVORY = '#e4d8bd';
const IVORY_LIGHT = '#fbf4e2';
const IVORY_DARK = '#a8987a';
const INK = '#14121c';
const INK_SHEEN = '#4a4766';
const INK_CLAWS = fan({
  centreX: 0.44,
  baseY: 0.84,
  spread: 0.2,
  tilt: 0.36,
  lean: -0.06,
  length: 0.56,
  sideLength: 0.46,
  width: 0.2,
  hook: 0.45,
  belly: 0.11,
});
/** How far up each claw the ink reaches, as a share of its length: the tip half is dipped. */
const INK_LINE = 0.48;
/** The ink line tilts across the claw, the way a dipped edge sets as it is lifted out. */
const INK_LINE_TILT = 0.06;
const INK_SPLATS: readonly (readonly [x: number, y: number, r: number])[] = [
  [0.14, 0.2, 0.05],
  [0.22, 0.12, 0.025],
  [0.86, 0.46, 0.045],
  [0.9, 0.36, 0.022],
  [0.12, 0.42, 0.022],
];
const INK_GLINT_R = 0.04;
/** The ink mask is drawn well past the claw on every side and clipped back to it. */
const INK_MASK_REACH = 2;

function paintInkClaws(ctx: CanvasRenderingContext2D, px: number): void {
  for (const [x, y, r] of INK_SPLATS) {
    disc(ctx, x, y, r + outlineAllowance(px), ICON_OUTLINE);
    disc(ctx, x, y, r, INK);
  }
  for (const claw of INK_CLAWS) {
    paintClaw(ctx, px, claw, IVORY, IVORY_LIGHT, IVORY_DARK);
    withShapeClip(
      ctx,
      () => traceClaw(ctx, claw),
      () => {
        const lineLeft = place(
          claw,
          [-claw.width * INK_MASK_REACH, -claw.length * (INK_LINE + INK_LINE_TILT)],
          0,
          0,
        );
        const lineRight = place(
          claw,
          [claw.width * INK_MASK_REACH, -claw.length * (INK_LINE - INK_LINE_TILT)],
          0,
          0,
        );
        const farLeft = place(
          claw,
          [-claw.width * INK_MASK_REACH, -claw.length * INK_MASK_REACH],
          0,
          0,
        );
        const farRight = place(
          claw,
          [claw.width * INK_MASK_REACH, -claw.length * INK_MASK_REACH],
          0,
          0,
        );
        tracePoints(ctx, [lineLeft, farLeft, farRight, lineRight]);
        ctx.fillStyle = INK;
        ctx.fill();
      },
    );
    const [gx, gy] = pointAlong(claw, INK_GLINT_ALONG, GLOSS_ACROSS);
    glint(ctx, gx, gy, INK_GLINT_R, INK_SHEEN);
  }
}
const INK_GLINT_ALONG = 0.75;

function outlineAllowance(px: number): number {
  return hairlineWidth(px) * MEDIUM_DETAIL;
}

// ── Sunsteel talons ──────────────────────────────────────────────────────────

const GOLD = '#e0a72e';
const GOLD_LIGHT = '#fff0a0';
const GOLD_DARK = '#8a5a14';
const FLARE_OUTER = '#ff8a1c';
const FLARE_INNER = '#ffd54a';
const TALONS = fan({
  centreX: 0.44,
  baseY: 0.92,
  spread: 0.17,
  tilt: 0.42,
  lean: -0.06,
  length: 0.76,
  sideLength: 0.62,
  width: 0.16,
  hook: 0.2,
  belly: 0.04,
});
const FLARE_CENTRE: Point = [0.52, 0.38];
const FLARE_RAYS = 8;
const FLARE_OUTER_R = 0.36;
const FLARE_INNER_R = 0.19;
const FLARE_CORE_R = 0.17;
/** Every other ray is shorter, which is what makes a burst read as a sun and not a star. */
const FLARE_SHORT_RAY = 0.72;
const LONG_RAY_EVERY = 2;
/** Each ray is a point and the valley after it. */
const VERTICES_PER_RAY = 2;
const TALON_GLINT_R = 0.07;
const TALON_GLINT_ALONG = 0.62;

function traceFlare(ctx: CanvasRenderingContext2D): void {
  const [cx, cy] = FLARE_CENTRE;
  ctx.beginPath();
  const points = FLARE_RAYS * VERTICES_PER_RAY;
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * FULL_TURN;
    const isRay = i % VERTICES_PER_RAY === 0;
    const isLongRay = (i / VERTICES_PER_RAY) % LONG_RAY_EVERY === 0;
    const rayReach = isLongRay ? FLARE_OUTER_R : FLARE_OUTER_R * FLARE_SHORT_RAY;
    const reach = isRay ? rayReach : FLARE_INNER_R;
    const x = cx + Math.sin(angle) * reach;
    const y = cy - Math.cos(angle) * reach;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function paintSunsteelTalons(ctx: CanvasRenderingContext2D, px: number): void {
  paintForm(ctx, px, () => traceFlare(ctx), FLARE_OUTER);
  disc(ctx, FLARE_CENTRE[0], FLARE_CENTRE[1], FLARE_CORE_R, FLARE_INNER);
  for (const claw of TALONS) paintClaw(ctx, px, claw, GOLD, GOLD_LIGHT, GOLD_DARK);
  for (const claw of TALONS) {
    const [gx, gy] = pointAlong(claw, TALON_GLINT_ALONG, GLOSS_ACROSS);
    glint(ctx, gx, gy, TALON_GLINT_R);
  }
}

// ── Ember wisp ───────────────────────────────────────────────────────────────

const FLAME_OUTER = '#e2481c';
const FLAME_MID = '#ff9a22';
const FLAME_CORE = '#ffe68a';
const FLAME_HEART = '#fffbe6';
const WISP_EYE = '#3a1206';

/** A flame's outline from its round belly up through three licking tongues. */
const FLAME: readonly IconPoint[] = [
  [0.5, 0.92, 0.1],
  [0.24, 0.8, 0.1],
  [0.2, 0.56, 0.04],
  [0.3, 0.36],
  [0.34, 0.46],
  [0.44, 0.08],
  [0.54, 0.34],
  [0.64, 0.2],
  [0.7, 0.44],
  [0.76, 0.34],
  [0.8, 0.58, 0.04],
  [0.76, 0.8, 0.1],
];
const FLAME_INNER: readonly IconPoint[] = [
  [0.5, 0.86, 0.08],
  [0.32, 0.76, 0.08],
  [0.32, 0.58],
  [0.42, 0.42],
  [0.46, 0.5],
  [0.54, 0.3],
  [0.6, 0.48],
  [0.66, 0.42],
  [0.7, 0.6, 0.04],
  [0.66, 0.78, 0.08],
];
const FLAME_HEART_ELLIPSE: readonly [cx: number, cy: number, rx: number, ry: number] = [
  0.5, 0.72, 0.13, 0.12,
];
/** Two coal-dark eyes: it is a creature that likes you, not a campfire. */
const WISP_EYES: readonly Point[] = [
  [0.44, 0.66],
  [0.57, 0.66],
];
const WISP_EYE_RX = 0.026;
const WISP_EYE_RY = 0.042;
const SPARKS: readonly (readonly [x: number, y: number, r: number])[] = [
  [0.16, 0.26, 0.08],
  [0.86, 0.14, 0.07],
  [0.88, 0.72, 0.06],
];

function paintEmberWisp(ctx: CanvasRenderingContext2D, px: number): void {
  for (const [x, y, r] of SPARKS) glint(ctx, x, y, r, FLAME_MID);
  paintForm(ctx, px, () => tracePoints(ctx, FLAME), FLAME_OUTER);
  tracePoints(ctx, FLAME_INNER);
  ctx.fillStyle = FLAME_MID;
  ctx.fill();
  const [hx, hy, hrx, hry] = FLAME_HEART_ELLIPSE;
  traceEllipse(ctx, hx, hy, hrx * FLAME_CORE_SCALE, hry * FLAME_CORE_SCALE);
  ctx.fillStyle = FLAME_CORE;
  ctx.fill();
  traceEllipse(ctx, hx, hy, hrx, hry);
  ctx.fillStyle = FLAME_HEART;
  ctx.fill();
  for (const [ex, ey] of WISP_EYES) {
    traceEllipse(ctx, ex, ey, WISP_EYE_RX, WISP_EYE_RY);
    ctx.fillStyle = WISP_EYE;
    ctx.fill();
  }
}
/** The core glow is the heart's ellipse grown by this much. */
const FLAME_CORE_SCALE = 1.7;

// ── Ward stone ───────────────────────────────────────────────────────────────

const STONE = '#7f8e96';
const STONE_DARK = '#4b5860';
const RUNE_GLOW = '#8ff0e4';
const HOVER_SHADOW = '#0b0d10';

const STONE_ELLIPSE: readonly [cx: number, cy: number, rx: number, ry: number] = [
  0.5, 0.44, 0.36, 0.28,
];
const STONE_LIGHT_SHIFT = 0.04;
const STONE_SHADE_SHIFT = 0.11;
/** The carved ring sits inside the stone's face, a ring of short cut marks. */
const RUNE_RING_RX = 0.24;
const RUNE_RING_RY = 0.17;
const RUNE_COUNT = 8;
const RUNE_HALF = 0.035;
/** The ring alternates a straight cut and a chevron. */
const RUNE_PATTERN_LENGTH = 2;
/** Its shadow on the ground, well below it, says the stone floats. */
const HOVER: readonly [cx: number, cy: number, rx: number, ry: number] = [0.5, 0.9, 0.24, 0.045];
const HOVER_ALPHA = 0.6;
const STONE_GLINT: Point = [0.32, 0.27];
const STONE_GLINT_R = 0.045;

function paintWardStone(ctx: CanvasRenderingContext2D, px: number): void {
  const [hx, hy, hrx, hry] = HOVER;
  const baseAlpha = ctx.globalAlpha;
  ctx.globalAlpha = baseAlpha * HOVER_ALPHA;
  traceEllipse(ctx, hx, hy, hrx, hry);
  ctx.fillStyle = HOVER_SHADOW;
  ctx.fill();
  ctx.globalAlpha = baseAlpha;

  const [cx, cy, rx, ry] = STONE_ELLIPSE;
  const traceStone = (dx: number, dy: number): void => traceEllipse(ctx, cx + dx, cy + dy, rx, ry);
  paintForm(ctx, px, () => traceStone(0, 0), tone(STONE, STONE_HIGHLIGHT));
  offsetShade(ctx, traceStone, [
    [STONE, STONE_LIGHT_SHIFT, STONE_LIGHT_SHIFT],
    [STONE_DARK, STONE_SHADE_SHIFT, STONE_SHADE_SHIFT],
  ]);
  for (let i = 0; i < RUNE_COUNT; i++) {
    const angle = (i / RUNE_COUNT) * FULL_TURN;
    const x = cx + Math.cos(angle) * RUNE_RING_RX;
    const y = cy + Math.sin(angle) * RUNE_RING_RY;
    const tangentX = -Math.sin(angle) * RUNE_HALF;
    const tangentY = Math.cos(angle) * RUNE_HALF;
    const radialX = Math.cos(angle) * RUNE_HALF;
    const radialY = Math.sin(angle) * RUNE_HALF;
    const isStroke = i % RUNE_PATTERN_LENGTH === 0;
    const mark: readonly IconPoint[] = isStroke
      ? [
          [x - radialX, y - radialY],
          [x + radialX, y + radialY],
        ]
      : [
          [x - tangentX - radialX, y - tangentY - radialY],
          [x + radialX, y + radialY],
          [x + tangentX - radialX, y + tangentY - radialY],
        ];
    strokeDetail(ctx, px, mark, ICON_OUTLINE, MEDIUM_DETAIL * DETAIL_OUTLINE_SCALE);
    strokeDetail(ctx, px, mark, RUNE_GLOW, MEDIUM_DETAIL);
  }
  glint(ctx, STONE_GLINT[0], STONE_GLINT[1], STONE_GLINT_R);
}
const STONE_HIGHLIGHT = 0.3;

// ── Sproutling seed ──────────────────────────────────────────────────────────

const SEED = '#9a6233';
const SEED_LIGHT = '#c98d55';
const SEED_DARK = '#5a3519';
const LEAF = '#5fbf3a';
const LEAF_LIGHT = '#a6e86a';
const LEAF_DARK = '#2f7a24';
const STEM = '#4c9a2e';

const SEED_ELLIPSE: readonly [cx: number, cy: number, rx: number, ry: number] = [
  0.48, 0.7, 0.26, 0.21,
];
const SEED_LIGHT_SHIFT = 0.03;
const SEED_SHADE_SHIFT = 0.09;
/** The walnut's seam and its wrinkles, the marks that make it a nut and not a potato. */
const SEED_SEAM: readonly IconPoint[] = [
  [0.48, 0.5],
  [0.45, 0.6],
  [0.5, 0.7],
  [0.46, 0.8],
  [0.49, 0.9],
];
const SEED_WRINKLES: readonly (readonly IconPoint[])[] = [
  [
    [0.32, 0.62],
    [0.38, 0.68],
    [0.33, 0.76],
  ],
  [
    [0.62, 0.6],
    [0.58, 0.68],
    [0.64, 0.76],
  ],
];
const SHOOT: readonly IconPoint[] = [
  [0.48, 0.52],
  [0.5, 0.36, 0.06],
  [0.6, 0.2],
];
const LEAVES: readonly (readonly IconPoint[])[] = [
  [
    [0.5, 0.36],
    [0.32, 0.24, 0.06],
    [0.16, 0.3],
    [0.3, 0.4, 0.06],
  ],
  [
    [0.6, 0.2],
    [0.72, 0.08, 0.05],
    [0.88, 0.1],
    [0.78, 0.24, 0.05],
  ],
];
const LEAF_VEINS: readonly (readonly IconPoint[])[] = [
  [
    [0.48, 0.36],
    [0.22, 0.31],
  ],
  [
    [0.62, 0.19],
    [0.82, 0.12],
  ],
];
const STEM_WIDTH = 4;
const SEED_GLINT: Point = [0.36, 0.58];
const SEED_GLINT_R = 0.035;

function paintSproutlingSeed(ctx: CanvasRenderingContext2D, px: number): void {
  strokeDetail(ctx, px, SHOOT, ICON_OUTLINE, STEM_WIDTH * DETAIL_OUTLINE_SCALE);
  strokeDetail(ctx, px, SHOOT, STEM, STEM_WIDTH);
  for (const leaf of LEAVES) {
    paintForm(
      ctx,
      px,
      () => tracePoints(ctx, leaf),
      bandedFill(
        ctx,
        [leaf[0][0], leaf[1][1]],
        [leaf[0][0], leaf[3][1]],
        [
          [LEAF_LIGHT, LEAF_SPLIT],
          [LEAF, LEAF_MID_UNTIL],
          [LEAF_DARK, 1],
        ],
      ),
    );
  }
  for (const vein of LEAF_VEINS) strokeDetail(ctx, px, vein, LEAF_DARK);

  const [cx, cy, rx, ry] = SEED_ELLIPSE;
  const traceSeed = (dx: number, dy: number): void => traceEllipse(ctx, cx + dx, cy + dy, rx, ry);
  paintForm(ctx, px, () => traceSeed(0, 0), SEED_LIGHT);
  offsetShade(ctx, traceSeed, [
    [SEED, SEED_LIGHT_SHIFT, SEED_LIGHT_SHIFT],
    [SEED_DARK, SEED_SHADE_SHIFT, SEED_SHADE_SHIFT],
  ]);
  strokeDetail(ctx, px, SEED_SEAM, SEED_DARK, MEDIUM_DETAIL);
  for (const wrinkle of SEED_WRINKLES) strokeDetail(ctx, px, wrinkle, SEED_DARK);
  glint(ctx, SEED_GLINT[0], SEED_GLINT[1], SEED_GLINT_R);
}
const LEAF_SPLIT = 0.35;
const LEAF_MID_UNTIL = 0.7;

type ArtPainter = (ctx: CanvasRenderingContext2D, px: number) => void;

/** A three-claw fan spans wider than the cell once its hooks curl, so it is shrunk about the cell centre to fit. */
const FAN_FIT = 0.86;
const FIT_PIVOT = 0.5;

function fitted(painter: ArtPainter): ArtPainter {
  return (ctx, px) => {
    ctx.save();
    try {
      ctx.translate(FIT_PIVOT, FIT_PIVOT);
      ctx.scale(FAN_FIT, FAN_FIT);
      ctx.translate(-FIT_PIVOT, -FIT_PIVOT);
      painter(ctx, px / FAN_FIT);
    } finally {
      ctx.restore();
    }
  };
}

const PAINTERS: Record<GearClawRelicIconId, ArtPainter> = {
  tin_claw_caps: paintTinCaps,
  venom_claws: fitted(paintVenomClaws),
  frostbite_claws: paintFrostbiteClaws,
  prowler_claws: fitted(paintProwlerClaws),
  ink_dipped_claws: fitted(paintInkClaws),
  sunsteel_talons: fitted(paintSunsteelTalons),
  ember_wisp: paintEmberWisp,
  ward_stone: paintWardStone,
  sproutling_seed: paintSproutlingSeed,
};

export function drawGearClawRelicIcon(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  id: GearClawRelicIconId,
): void {
  paintIconArt(ctx, rect, PAINTERS[id]);
}
