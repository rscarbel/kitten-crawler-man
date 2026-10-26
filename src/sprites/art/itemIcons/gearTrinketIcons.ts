/**
 * Icons for the trinkets: small charms and bands worn in the trinket slot.
 *
 * Every trinket is small and roughly round in life, so each icon leans on the
 * one feature that sets it apart at slot size — a band seen edge-on, a coin's
 * punched hole and cord, a curved tooth, a frosted sphere, a cage with a coal
 * in it, a nail's head and point, an hourglass's waist.
 */

import type { Rect } from '../../../ui/core/geom';
import {
  appendPoints,
  bandedFill,
  BOLD_DETAIL,
  disc,
  FULL_TURN,
  glint,
  hairlineWidth,
  ICON_OUTLINE,
  litFill,
  MEDIUM_DETAIL,
  offsetShade,
  outlineWidth,
  paintForm,
  paintIconArt,
  strokeDetail,
  tone,
  tracePoints,
  traceEllipse,
  withShapeClip,
  type IconArtPainter,
  type IconPoint,
} from './iconPaint';

export type GearTrinketIconId =
  | 'nimble_bangle'
  | 'lucky_penny'
  | 'fang_charm'
  | 'frostward_charm'
  | 'emberward_charm'
  | 'fae_iron_charm'
  | 'hourglass_charm';

type Painter = (ctx: CanvasRenderingContext2D, px: number) => void;

const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;

/**
 * A wire loop of `thickness` drawn as an outlined stroke: the jump ring or
 * bail every hanging charm hangs from.
 */
function strokeLoop(
  ctx: CanvasRenderingContext2D,
  px: number,
  trace: () => void,
  thickness: number,
  color: string,
): void {
  trace();
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = thickness + outlineWidth(px) * 2;
  ctx.stroke();
  trace();
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.stroke();
}

function traceCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, FULL_TURN);
}

// ---------------------------------------------------------------- bangle

const COPPER = '#c0703c';
const COPPER_INNER = '#6e3519';
const BANGLE_CX = 0.5;
const BANGLE_CY = 0.52;
const BANGLE_RX = 0.4;
const BANGLE_RY = 0.19;
/** The band's height, seen from above at a tilt: thin, which is what tells it from a ring or a coin. */
const BANGLE_HEIGHT = 0.12;
/** A little roll off level, so the band reads as lying in space rather than a flat oval sticker. */
const BANGLE_TILT = -0.28;
const BANGLE_GLINT: readonly [number, number] = [0.22, 0.6];
const BANGLE_GLINT_R = 0.07;
const BANGLE_RIM_LIGHT = 0.3;
/** Half the side of a square about the band's centre that covers the whole icon, for clipping everything outside the rim. */
const BANGLE_CLIP_REACH = 1;

function paintBangle(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.translate(BANGLE_CX, BANGLE_CY);
  ctx.rotate(BANGLE_TILT);
  const topY = -BANGLE_HEIGHT / 2;
  const bottomY = BANGLE_HEIGHT / 2;
  const traceTop = (): void => traceEllipse(ctx, 0, topY, BANGLE_RX, BANGLE_RY);

  withShapeClip(ctx, traceTop, () => {
    ctx.beginPath();
    ctx.ellipse(0, topY, BANGLE_RX, BANGLE_RY, 0, 0, FULL_TURN);
    ctx.ellipse(0, bottomY, BANGLE_RX, BANGLE_RY, 0, 0, FULL_TURN);
    ctx.fillStyle = COPPER_INNER;
    ctx.fill('evenodd');
  });

  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(-BANGLE_CLIP_REACH, -BANGLE_CLIP_REACH, BANGLE_CLIP_REACH * 2, BANGLE_CLIP_REACH * 2);
    ctx.ellipse(0, topY, BANGLE_RX, BANGLE_RY, 0, 0, FULL_TURN);
    ctx.clip('evenodd');
    ctx.beginPath();
    ctx.rect(-BANGLE_RX, topY, BANGLE_RX * 2, BANGLE_HEIGHT);
    ctx.ellipse(0, bottomY, BANGLE_RX, BANGLE_RY, 0, 0, FULL_TURN);
    ctx.fillStyle = litFill(ctx, COPPER, [-BANGLE_RX, 0], [BANGLE_RX, 0]);
    ctx.fill();
  } finally {
    ctx.restore();
  }

  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = outlineWidth(px);
  traceTop();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, bottomY, BANGLE_RX, BANGLE_RY, 0, 0, FULL_TURN);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-BANGLE_RX, topY);
  ctx.lineTo(-BANGLE_RX, bottomY);
  ctx.moveTo(BANGLE_RX, topY);
  ctx.lineTo(BANGLE_RX, bottomY);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(0, topY, BANGLE_RX, BANGLE_RY, 0, HALF_TURN, HALF_TURN + QUARTER_TURN);
  ctx.strokeStyle = tone(COPPER, BANGLE_RIM_LIGHT);
  ctx.lineWidth = hairlineWidth(px) * MEDIUM_DETAIL;
  ctx.stroke();
  ctx.rotate(-BANGLE_TILT);
  ctx.translate(-BANGLE_CX, -BANGLE_CY);
  glint(ctx, BANGLE_GLINT[0], BANGLE_GLINT[1], BANGLE_GLINT_R);
}

// ---------------------------------------------------------------- penny

const PENNY_COPPER = '#c47b47';
const PENNY_EDGE = '#7c4220';
/** Face-on and flat: the edge is only a sliver down and right of the face, so it reads thin. */
const PENNY_CX = 0.48;
const PENNY_CY = 0.52;
const PENNY_R = 0.4;
const PENNY_EDGE_SHIFT = 0.025;
/** The punched hole sits near the top rim, where a thong would go, big enough to read as a hole at 24 px. */
const PENNY_HOLE_CY = 0.24;
const PENNY_HOLE_R = 0.065;
/**
 * A flat plane takes one straight terminator: two bands, never three, which
 * would round the face into a dome.
 */
const PENNY_FACE_SPLIT = 0.5;
const PENNY_FACE_LIGHT = 0.16;
const PENNY_FACE_DARK = -0.1;
/** The beaded rim: a ring of raised dots inset from the edge, the mark that says "coin" at slot size. */
const PENNY_BEAD_RING_INSET = 0.055;
const PENNY_BEADS = 18;
const PENNY_BEAD_R = 0.024;
/** A dark groove just inside the beads, so the rim ring holds its shape at 24 px. */
const PENNY_GROOVE_INSET = 0.1;
const PENNY_BEAD_LIGHT = 0.4;
/** Beads that would sit on the punched hole are skipped. */
const PENNY_BEAD_HOLE_CLEARANCE = 0.03;
/** The stamped bust faces right: head, nose, chin, neck and shoulders. */
const BUST_HEAD_CX = 0.47;
const BUST_HEAD_CY = 0.5;
const BUST_HEAD_R = 0.1;
const BUST: readonly IconPoint[] = [
  [0.53, 0.43],
  [0.6, 0.49],
  [0.565, 0.51],
  [0.57, 0.56],
  [0.53, 0.59],
  [0.53, 0.63],
  [0.64, 0.69, 0.04],
  [0.66, 0.76],
  [0.3, 0.76],
  [0.32, 0.69, 0.04],
  [0.43, 0.63],
  [0.42, 0.58],
];
/** How far the stamped bust's lit and shadowed copies sit from it: the relief. */
const EMBOSS_SHIFT = 0.022;
/** The bust's own face sits a step darker than the field, so the figure separates from it at slot size. */
const BUST_TONE = -0.2;
const EMBOSS_LIGHT = 0.4;
const EMBOSS_DARK = -0.45;
const PENNY_GLINT: readonly [number, number] = [0.27, 0.42];
const PENNY_GLINT_R = 0.055;

function tracePennyFace(ctx: CanvasRenderingContext2D, dx: number, dy: number): void {
  ctx.beginPath();
  ctx.arc(PENNY_CX + dx, PENNY_CY + dy, PENNY_R, 0, FULL_TURN);
  ctx.moveTo(PENNY_CX + dx + PENNY_HOLE_R, PENNY_HOLE_CY + dy);
  ctx.arc(PENNY_CX + dx, PENNY_HOLE_CY + dy, PENNY_HOLE_R, FULL_TURN, 0, true);
}

function tracePennyBust(ctx: CanvasRenderingContext2D, dx: number, dy: number): void {
  ctx.beginPath();
  ctx.arc(BUST_HEAD_CX + dx, BUST_HEAD_CY + dy, BUST_HEAD_R, 0, FULL_TURN);
  appendPoints(
    ctx,
    BUST.map(([x, y, r]): IconPoint => [x + dx, y + dy, r]),
  );
}

function paintPenny(ctx: CanvasRenderingContext2D, px: number): void {
  paintForm(ctx, px, () => tracePennyFace(ctx, PENNY_EDGE_SHIFT, PENNY_EDGE_SHIFT), PENNY_EDGE);
  paintForm(
    ctx,
    px,
    () => tracePennyFace(ctx, 0, 0),
    bandedFill(
      ctx,
      [PENNY_CX - PENNY_R, PENNY_CY - PENNY_R],
      [PENNY_CX + PENNY_R, PENNY_CY + PENNY_R],
      [
        [tone(PENNY_COPPER, PENNY_FACE_LIGHT), PENNY_FACE_SPLIT],
        [tone(PENNY_COPPER, PENNY_FACE_DARK), 1],
      ],
    ),
  );

  ctx.beginPath();
  ctx.arc(PENNY_CX, PENNY_CY, PENNY_R - PENNY_GROOVE_INSET, 0, FULL_TURN);
  ctx.strokeStyle = PENNY_EDGE;
  ctx.lineWidth = hairlineWidth(px);
  ctx.stroke();
  const beadRingR = PENNY_R - PENNY_BEAD_RING_INSET;
  const holeReach = PENNY_HOLE_R + PENNY_BEAD_HOLE_CLEARANCE;
  for (let bead = 0; bead < PENNY_BEADS; bead++) {
    const angle = (bead / PENNY_BEADS) * FULL_TURN;
    const x = PENNY_CX + Math.cos(angle) * beadRingR;
    const y = PENNY_CY + Math.sin(angle) * beadRingR;
    if (Math.hypot(x - PENNY_CX, y - PENNY_HOLE_CY) < holeReach) continue;
    disc(ctx, x + PENNY_BEAD_R / 2, y + PENNY_BEAD_R / 2, PENNY_BEAD_R, PENNY_EDGE);
    disc(ctx, x, y, PENNY_BEAD_R, tone(PENNY_COPPER, PENNY_BEAD_LIGHT));
  }

  tracePennyBust(ctx, EMBOSS_SHIFT, EMBOSS_SHIFT);
  ctx.fillStyle = tone(PENNY_COPPER, EMBOSS_DARK);
  ctx.fill();
  tracePennyBust(ctx, -EMBOSS_SHIFT, -EMBOSS_SHIFT);
  ctx.fillStyle = tone(PENNY_COPPER, EMBOSS_LIGHT);
  ctx.fill();
  tracePennyBust(ctx, 0, 0);
  ctx.fillStyle = tone(PENNY_COPPER, BUST_TONE);
  ctx.fill();

  glint(ctx, PENNY_GLINT[0], PENNY_GLINT[1], PENNY_GLINT_R);
}

// ---------------------------------------------------------------- fang

const FANG_IVORY = '#eee4c4';
const FANG_STAIN = '#c9b27a';
const WIRE = '#c3c7cf';
/**
 * A canine's crescent: a wide root at the top, the outer edge bowing out to
 * the right and the inner edge hollowing, down to a point at the lower left.
 */
const FANG_ROOT_LEFT: readonly [number, number] = [0.38, 0.27];
const FANG_ROOT_RIGHT: readonly [number, number] = [0.7, 0.3];
const FANG_TIP: readonly [number, number] = [0.24, 0.92];
const FANG_OUTER_CTRL: readonly [number, number] = [0.86, 0.8];
const FANG_INNER_CTRL: readonly [number, number] = [0.46, 0.66];
const FANG_LIGHT_FROM: readonly [number, number] = [0.36, 0.45];
const FANG_LIGHT_TO: readonly [number, number] = [0.72, 0.62];
/** The wire binding: turns laid across the root, each from the inner edge to the outer. */
const WIRE_TURNS: readonly (readonly [IconPoint, IconPoint])[] = [
  [
    [0.37, 0.32],
    [0.72, 0.36],
  ],
  [
    [0.38, 0.39],
    [0.74, 0.43],
  ],
];
const BAIL_CX = 0.54;
const BAIL_CY = 0.15;
const BAIL_R = 0.075;
const BAIL_THICKNESS = 0.035;
/** Old bone yellows toward the root, where it sat in the gum. */
const STAIN_UNTIL_Y = 0.46;
const FANG_GLINT: readonly [number, number] = [0.47, 0.55];
const FANG_GLINT_R = 0.06;

function traceFang(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(FANG_ROOT_RIGHT[0], FANG_ROOT_RIGHT[1]);
  ctx.quadraticCurveTo(FANG_OUTER_CTRL[0], FANG_OUTER_CTRL[1], FANG_TIP[0], FANG_TIP[1]);
  ctx.quadraticCurveTo(
    FANG_INNER_CTRL[0],
    FANG_INNER_CTRL[1],
    FANG_ROOT_LEFT[0],
    FANG_ROOT_LEFT[1],
  );
  ctx.closePath();
}

function paintFang(ctx: CanvasRenderingContext2D, px: number): void {
  strokeLoop(ctx, px, () => traceCircle(ctx, BAIL_CX, BAIL_CY, BAIL_R), BAIL_THICKNESS, WIRE);
  paintForm(
    ctx,
    px,
    () => traceFang(ctx),
    litFill(ctx, FANG_IVORY, FANG_LIGHT_FROM, FANG_LIGHT_TO),
  );
  withShapeClip(
    ctx,
    () => traceFang(ctx),
    () => {
      ctx.fillStyle = FANG_STAIN;
      ctx.fillRect(0, 0, 1, STAIN_UNTIL_Y);
    },
  );
  for (const [from, to] of WIRE_TURNS) {
    strokeLoop(
      ctx,
      px,
      () => {
        ctx.beginPath();
        ctx.moveTo(from[0], from[1]);
        ctx.lineTo(to[0], to[1]);
      },
      BAIL_THICKNESS,
      WIRE,
    );
  }
  glint(ctx, FANG_GLINT[0], FANG_GLINT[1], FANG_GLINT_R);
}

// ---------------------------------------------------------------- frost bead

const CORD = '#5b3a24';
const CORD_THICKNESS = 0.045;

const FROST_GLASS = '#9fd2ea';
const FROST_WHITE = '#f1fbff';
const BEAD_CX = 0.5;
const BEAD_CY = 0.6;
const BEAD_R = 0.29;
const BEAD_CORD_PEAK = 0.06;
const BEAD_CORD_SPREAD = 0.24;
const BEAD_HOLE_RX = 0.06;
const BEAD_HOLE_RY = 0.03;
const BEAD_SHADE_SHIFT = 0.09;
const BEAD_DEEP_SHIFT = 0.17;
const BEAD_LIGHT_SHIFT = -0.06;
const BEAD_SHADE = -0.3;
const BEAD_DEEP = -0.5;
const BEAD_LIGHT = 0.45;
/** Rime speckles on the lit shoulder: frosted, not polished. */
const FROST_SPECKS: readonly (readonly [number, number, number])[] = [
  [0.34, 0.5, 0.022],
  [0.4, 0.44, 0.016],
  [0.31, 0.6, 0.016],
  [0.46, 0.4, 0.012],
  [0.38, 0.66, 0.012],
];
const SNOWFLAKE_CX = 0.6;
const SNOWFLAKE_CY = 0.66;
const SNOWFLAKE_R = 0.1;
const SNOWFLAKE_ARMS = 6;

function paintFrostBead(ctx: CanvasRenderingContext2D, px: number): void {
  strokeLoop(
    ctx,
    px,
    () => {
      ctx.beginPath();
      ctx.moveTo(BEAD_CX - BEAD_CORD_SPREAD / 2, BEAD_CY - BEAD_R / 2);
      ctx.lineTo(BEAD_CX, BEAD_CORD_PEAK);
      ctx.lineTo(BEAD_CX + BEAD_CORD_SPREAD / 2, BEAD_CY - BEAD_R / 2);
    },
    CORD_THICKNESS,
    CORD,
  );
  const traceBead = (dx: number, dy: number): void => {
    ctx.beginPath();
    ctx.arc(BEAD_CX + dx, BEAD_CY + dy, BEAD_R, 0, FULL_TURN);
  };
  paintForm(ctx, px, () => traceBead(0, 0), tone(FROST_GLASS, BEAD_LIGHT));
  offsetShade(ctx, traceBead, [
    [FROST_GLASS, -BEAD_LIGHT_SHIFT, -BEAD_LIGHT_SHIFT],
    [tone(FROST_GLASS, BEAD_SHADE), BEAD_SHADE_SHIFT, BEAD_SHADE_SHIFT],
    [tone(FROST_GLASS, BEAD_DEEP), BEAD_DEEP_SHIFT, BEAD_DEEP_SHIFT],
  ]);
  traceEllipse(ctx, BEAD_CX, BEAD_CY - BEAD_R + BEAD_HOLE_RY * 2, BEAD_HOLE_RX, BEAD_HOLE_RY);
  ctx.fillStyle = ICON_OUTLINE;
  ctx.fill();
  for (const [x, y, r] of FROST_SPECKS) disc(ctx, x, y, r, FROST_WHITE);

  ctx.beginPath();
  for (let arm = 0; arm < SNOWFLAKE_ARMS / 2; arm++) {
    const angle = (arm / SNOWFLAKE_ARMS) * FULL_TURN;
    const dx = Math.cos(angle) * SNOWFLAKE_R;
    const dy = Math.sin(angle) * SNOWFLAKE_R;
    ctx.moveTo(SNOWFLAKE_CX - dx, SNOWFLAKE_CY - dy);
    ctx.lineTo(SNOWFLAKE_CX + dx, SNOWFLAKE_CY + dy);
  }
  ctx.strokeStyle = FROST_WHITE;
  ctx.lineWidth = hairlineWidth(px) * MEDIUM_DETAIL;
  ctx.stroke();
}

// ---------------------------------------------------------------- ember cage

const BRASS = '#c99d3e';
const COAL = '#3b2218';
const EMBER = '#ec5a1c';
const EMBER_CORE = '#ffd25a';
const CAGE_CX = 0.5;
const CAGE_TOP = 0.3;
const CAGE_BOTTOM = 0.84;
const CAGE_HALF = 0.2;
/** The bars bow out past the caps, so the cage reads as a round lantern rather than a box. */
const CAGE_BULGE = 0.07;
const CAP_HALF = 0.17;
const CAP_HEIGHT = 0.07;
const CAP_CORNER = 0.025;
/** The inner bars sit wide of centre so the coal shows through the middle window. */
const CAGE_BAR_OFFSETS = [-1, -0.5, 0.5, 1] as const;
const CAGE_BAR_THICKNESS = 0.034;
const CAGE_LOOP_CY = 0.17;
const CAGE_LOOP_R = 0.07;
const GLOW_R = 0.21;
const GLOW_ALPHA = 0.6;
const LIT_BAR = 0.2;
const CINDER: readonly IconPoint[] = [
  [0.37, 0.58, 0.03],
  [0.46, 0.44, 0.03],
  [0.61, 0.48, 0.03],
  [0.65, 0.64, 0.03],
  [0.53, 0.75, 0.03],
  [0.38, 0.7, 0.03],
];
const CINDER_LIGHT_FROM: readonly [number, number] = [0.4, 0.45];
const CINDER_LIGHT_TO: readonly [number, number] = [0.62, 0.74];
const CINDER_CRACKS: readonly (readonly IconPoint[])[] = [
  [
    [0.45, 0.54],
    [0.51, 0.6],
    [0.58, 0.57],
  ],
  [
    [0.51, 0.6],
    [0.5, 0.68],
  ],
];
/** The coal is lit from inside: hot at its upper-left heart, cooling to black at its far edge. */
const CINDER_HOT_UNTIL = 0.3;
const CINDER_EMBER_UNTIL = 0.7;
const CAGE_LIGHT_FROM: readonly [number, number] = [CAGE_CX - CAP_HALF, 0];
const CAGE_LIGHT_TO: readonly [number, number] = [CAGE_CX + CAP_HALF, 0];

function paintEmberCage(ctx: CanvasRenderingContext2D, px: number): void {
  const cageMidY = (CAGE_TOP + CAGE_BOTTOM) / 2;
  strokeLoop(
    ctx,
    px,
    () => traceCircle(ctx, CAGE_CX, CAGE_LOOP_CY, CAGE_LOOP_R),
    CAGE_BAR_THICKNESS,
    BRASS,
  );
  const baseAlpha = ctx.globalAlpha;
  ctx.globalAlpha = baseAlpha * GLOW_ALPHA;
  disc(ctx, CAGE_CX, cageMidY + CAP_HEIGHT / 2, GLOW_R, EMBER);
  ctx.globalAlpha = baseAlpha;
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, CINDER),
    bandedFill(ctx, CINDER_LIGHT_FROM, CINDER_LIGHT_TO, [
      [EMBER_CORE, CINDER_HOT_UNTIL],
      [EMBER, CINDER_EMBER_UNTIL],
      [COAL, 1],
    ]),
  );
  for (const crack of CINDER_CRACKS) {
    strokeDetail(ctx, px, crack, COAL, BOLD_DETAIL);
  }
  for (const offset of CAGE_BAR_OFFSETS) {
    const capX = CAGE_CX + offset * CAP_HALF;
    const bowX = CAGE_CX + offset * (CAGE_HALF + CAGE_BULGE);
    strokeLoop(
      ctx,
      px,
      () => {
        ctx.beginPath();
        ctx.moveTo(capX, CAGE_TOP);
        ctx.quadraticCurveTo(bowX, cageMidY, capX, CAGE_BOTTOM);
      },
      CAGE_BAR_THICKNESS,
      offset < 0 ? tone(BRASS, LIT_BAR) : BRASS,
    );
  }
  for (const capTop of [CAGE_TOP - CAP_HEIGHT / 2, CAGE_BOTTOM - CAP_HEIGHT / 2]) {
    paintForm(
      ctx,
      px,
      () =>
        tracePoints(ctx, [
          [CAGE_CX - CAP_HALF, capTop, CAP_CORNER],
          [CAGE_CX + CAP_HALF, capTop, CAP_CORNER],
          [CAGE_CX + CAP_HALF, capTop + CAP_HEIGHT, CAP_CORNER],
          [CAGE_CX - CAP_HALF, capTop + CAP_HEIGHT, CAP_CORNER],
        ]),
      litFill(ctx, BRASS, CAGE_LIGHT_FROM, CAGE_LIGHT_TO),
    );
  }
}

// ---------------------------------------------------------------- fae-iron nail ring

const IRON = '#34333c';
const RIME = '#dcf1ff';
const FAE_GLOW = '#ff8a2a';
const FAE_GLOW_CORE = '#ffd36a';
const NAIL_CX = 0.5;
const NAIL_CY = 0.54;
const NAIL_R = 0.28;
const NAIL_THICKNESS = 0.1;
/** The gap at the top where the nail's head and point nearly meet, either side of straight up. */
const NAIL_GAP = 0.42;
const NAIL_START = -QUARTER_TURN + NAIL_GAP;
const NAIL_END = -QUARTER_TURN - NAIL_GAP + FULL_TURN;
const NAIL_HEAD_HALF = 0.1;
const NAIL_HEAD_THICK = 0.055;
const NAIL_POINT_LENGTH = 0.17;
const RIME_SPIKES = 6;
/** Frost spikes stand off the ring's outer edge; the rimed half bristles where the glowing half is smooth. */
const RIME_SPIKE_LENGTH = 0.06;
const RIME_SHARE = 0.7;
const FAE_GLOW_SHARE = 0.55;
const HALF_STEP = 0.5;
const GLOW_HALO_EXTRA = 0.08;
const FAE_GLOW_ALPHA = 0.4;
const FAE_GLINT_ANGLE = HALF_TURN + QUARTER_TURN / 2;
const FAE_GLINT_R = 0.06;

function nailPoint(angle: number, radius: number): [number, number] {
  return [NAIL_CX + Math.cos(angle) * radius, NAIL_CY + Math.sin(angle) * radius];
}

function paintFaeIron(ctx: CanvasRenderingContext2D, px: number): void {
  const traceArc = (): void => {
    ctx.beginPath();
    ctx.arc(NAIL_CX, NAIL_CY, NAIL_R, NAIL_START, NAIL_END);
  };
  const rightHalf = (): void => {
    ctx.beginPath();
    ctx.rect(NAIL_CX, 0, 1, 1);
  };
  const leftHalf = (): void => {
    ctx.beginPath();
    ctx.rect(0, 0, NAIL_CX, 1);
  };

  withShapeClip(ctx, rightHalf, () => {
    const baseAlpha = ctx.globalAlpha;
    ctx.globalAlpha = baseAlpha * FAE_GLOW_ALPHA;
    traceArc();
    ctx.strokeStyle = FAE_GLOW;
    ctx.lineWidth = NAIL_THICKNESS + GLOW_HALO_EXTRA;
    ctx.stroke();
    ctx.globalAlpha = baseAlpha;
  });

  const [tipX, tipY] = nailPoint(NAIL_END, NAIL_R);
  const tangentX = -Math.sin(NAIL_END);
  const tangentY = Math.cos(NAIL_END);
  const normalX = Math.cos(NAIL_END);
  const normalY = Math.sin(NAIL_END);
  const halfThick = NAIL_THICKNESS / 2;
  paintForm(
    ctx,
    px,
    () =>
      tracePoints(ctx, [
        [tipX + normalX * halfThick, tipY + normalY * halfThick],
        [tipX + tangentX * NAIL_POINT_LENGTH, tipY + tangentY * NAIL_POINT_LENGTH],
        [tipX - normalX * halfThick, tipY - normalY * halfThick],
      ]),
    RIME,
  );
  strokeLoop(ctx, px, traceArc, NAIL_THICKNESS, IRON);

  withShapeClip(ctx, rightHalf, () => {
    traceArc();
    ctx.strokeStyle = FAE_GLOW;
    ctx.lineWidth = NAIL_THICKNESS * FAE_GLOW_SHARE;
    ctx.stroke();
    traceArc();
    ctx.strokeStyle = FAE_GLOW_CORE;
    ctx.lineWidth = hairlineWidth(px) * BOLD_DETAIL;
    ctx.stroke();
  });
  withShapeClip(ctx, leftHalf, () => {
    traceArc();
    ctx.strokeStyle = RIME;
    ctx.lineWidth = NAIL_THICKNESS * RIME_SHARE;
    ctx.stroke();
    ctx.beginPath();
    for (let spike = 0; spike < RIME_SPIKES; spike++) {
      const angle = QUARTER_TURN + ((spike + HALF_STEP) / RIME_SPIKES) * HALF_TURN;
      const [fromX, fromY] = nailPoint(angle, NAIL_R + NAIL_THICKNESS / 2);
      const [toX, toY] = nailPoint(angle, NAIL_R + NAIL_THICKNESS / 2 + RIME_SPIKE_LENGTH);
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
    }
    ctx.strokeStyle = RIME;
    ctx.lineWidth = hairlineWidth(px) * BOLD_DETAIL;
    ctx.stroke();
    const [gx, gy] = nailPoint(FAE_GLINT_ANGLE, NAIL_R);
    glint(ctx, gx, gy, FAE_GLINT_R);
  });

  const [headX, headY] = nailPoint(NAIL_START, NAIL_R);
  const headTangentX = -Math.sin(NAIL_START);
  const headTangentY = Math.cos(NAIL_START);
  const headNormalX = Math.cos(NAIL_START) * NAIL_HEAD_HALF;
  const headNormalY = Math.sin(NAIL_START) * NAIL_HEAD_HALF;
  const back = NAIL_HEAD_THICK;
  paintForm(
    ctx,
    px,
    () =>
      tracePoints(ctx, [
        [headX + headNormalX, headY + headNormalY],
        [headX + headNormalX - headTangentX * back, headY + headNormalY - headTangentY * back],
        [headX - headNormalX - headTangentX * back, headY - headNormalY - headTangentY * back],
        [headX - headNormalX, headY - headNormalY],
      ]),
    FAE_GLOW,
  );
}

// ---------------------------------------------------------------- hourglass

const HOURGLASS_WOOD = '#7d5331';
const HOURGLASS_GLASS = '#a7cbd6';
const SAND = '#e3bd6c';
const HG_CX = 0.5;
const HG_CAP_HALF = 0.22;
const HG_CAP_HEIGHT = 0.08;
const HG_TOP_CAP_Y = 0.2;
const HG_BOTTOM_CAP_Y = 0.82;
const HG_CAP_CORNER = 0.025;
const HG_BULB_HALF = 0.16;
const HG_NECK_HALF = 0.025;
const HG_POST_INSET = 0.035;
const HG_POST_THICKNESS = 0.03;
const HG_LOOP_CY = 0.1;
const HG_LOOP_R = 0.06;
const HG_LOOP_THICKNESS = 0.03;
/** The sand sits at the top of the upper bulb, held there, because it runs upward. */
const SAND_TOP_UNTIL = 0.38;
const SAND_PILE_FROM = 0.75;
const SAND_STREAM_WIDTH = 1.2;
const HG_GLINT: readonly [number, number] = [0.42, 0.66];
const HG_GLINT_R = 0.05;

function traceHourglassGlass(ctx: CanvasRenderingContext2D): void {
  const top = HG_TOP_CAP_Y + HG_CAP_HEIGHT;
  const bottom = HG_BOTTOM_CAP_Y;
  const mid = (top + bottom) / 2;
  const left = HG_CX - HG_BULB_HALF;
  const right = HG_CX + HG_BULB_HALF;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.bezierCurveTo(
    right,
    mid - HG_CAP_HEIGHT,
    HG_CX + HG_NECK_HALF,
    mid,
    HG_CX + HG_NECK_HALF,
    mid,
  );
  ctx.bezierCurveTo(HG_CX + HG_NECK_HALF, mid, right, mid + HG_CAP_HEIGHT, right, bottom);
  ctx.lineTo(left, bottom);
  ctx.bezierCurveTo(
    left,
    mid + HG_CAP_HEIGHT,
    HG_CX - HG_NECK_HALF,
    mid,
    HG_CX - HG_NECK_HALF,
    mid,
  );
  ctx.bezierCurveTo(HG_CX - HG_NECK_HALF, mid, left, mid - HG_CAP_HEIGHT, left, top);
  ctx.closePath();
}

function hourglassCap(top: number): readonly IconPoint[] {
  return [
    [HG_CX - HG_CAP_HALF, top, HG_CAP_CORNER],
    [HG_CX + HG_CAP_HALF, top, HG_CAP_CORNER],
    [HG_CX + HG_CAP_HALF, top + HG_CAP_HEIGHT, HG_CAP_CORNER],
    [HG_CX - HG_CAP_HALF, top + HG_CAP_HEIGHT, HG_CAP_CORNER],
  ];
}

function paintHourglass(ctx: CanvasRenderingContext2D, px: number): void {
  strokeLoop(
    ctx,
    px,
    () => traceCircle(ctx, HG_CX, HG_LOOP_CY, HG_LOOP_R),
    HG_LOOP_THICKNESS,
    BRASS,
  );
  const glassTop = HG_TOP_CAP_Y + HG_CAP_HEIGHT;
  const glassMid = (glassTop + HG_BOTTOM_CAP_Y) / 2;
  paintForm(
    ctx,
    px,
    () => traceHourglassGlass(ctx),
    litFill(ctx, HOURGLASS_GLASS, [HG_CX - HG_BULB_HALF, 0], [HG_CX + HG_BULB_HALF, 0]),
  );
  withShapeClip(
    ctx,
    () => traceHourglassGlass(ctx),
    () => {
      ctx.fillStyle = litFill(ctx, SAND, [HG_CX - HG_BULB_HALF, 0], [HG_CX + HG_BULB_HALF, 0]);
      ctx.fillRect(0, glassTop, 1, SAND_TOP_UNTIL - glassTop);
      ctx.beginPath();
      ctx.moveTo(HG_CX - HG_BULB_HALF, HG_BOTTOM_CAP_Y);
      ctx.quadraticCurveTo(
        HG_CX,
        SAND_PILE_FROM - HG_CAP_HEIGHT,
        HG_CX + HG_BULB_HALF,
        HG_BOTTOM_CAP_Y,
      );
      ctx.fill();
    },
  );
  strokeDetail(
    ctx,
    px,
    [
      [HG_CX, SAND_PILE_FROM],
      [HG_CX, glassMid],
    ],
    SAND,
    SAND_STREAM_WIDTH,
  );
  for (const side of [-1, 1] as const) {
    const postX = HG_CX + side * (HG_CAP_HALF - HG_POST_INSET);
    strokeLoop(
      ctx,
      px,
      () => {
        ctx.beginPath();
        ctx.moveTo(postX, glassTop);
        ctx.lineTo(postX, HG_BOTTOM_CAP_Y);
      },
      HG_POST_THICKNESS,
      HOURGLASS_WOOD,
    );
  }
  for (const capTop of [HG_TOP_CAP_Y, HG_BOTTOM_CAP_Y]) {
    paintForm(
      ctx,
      px,
      () => tracePoints(ctx, hourglassCap(capTop)),
      litFill(ctx, HOURGLASS_WOOD, [HG_CX - HG_CAP_HALF, 0], [HG_CX + HG_CAP_HALF, 0]),
    );
  }
  glint(ctx, HG_GLINT[0], HG_GLINT[1], HG_GLINT_R);
}

const TRINKET_PAINTERS: Record<GearTrinketIconId, Painter> = {
  nimble_bangle: paintBangle,
  lucky_penny: paintPenny,
  fang_charm: paintFang,
  frostward_charm: paintFrostBead,
  emberward_charm: paintEmberCage,
  fae_iron_charm: paintFaeIron,
  hourglass_charm: paintHourglass,
};

export function drawGearTrinketIcon(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  id: GearTrinketIconId,
): void {
  const paint: IconArtPainter = TRINKET_PAINTERS[id];
  paintIconArt(ctx, rect, paint);
}
