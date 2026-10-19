/**
 * Service icons for the smithy's edge work, the training yard's four drills
 * and the VIP lounge's hired escort.
 */

import {
  FULL_TURN,
  glint,
  ICON_OUTLINE,
  litFill,
  appendPoints,
  outlineWidth,
  paintForm,
  rivet,
  strokeDetail,
  tone,
  traceEllipse,
  tracePoints,
  withShapeClip,
  type IconArtPainter,
  type IconPoint,
} from './iconPaint';
import {
  BRASS,
  DARK_WOOD,
  DEEP_SHADE,
  FLAME_YELLOW,
  GOLD,
  HALF_LIGHT,
  HALF_SHADE,
  IRON,
  LIGHT,
  OAK,
  paintFlame,
  paintGlow,
  paintLitEllipse,
  paintLitPoints,
  paintLitRect,
  paintSpark,
  paintStar,
  paintStreak,
  paintSword,
  SHADE,
  STRAW,
  toIcon,
  withPlacement,
  type Vec,
} from './serviceIconKit';

const WHETSTONE = '#7d8794';

/** The hone: a long block seen from above and in front, its top face lit. */
const HONE_TOP: readonly IconPoint[] = [
  [0.08, 0.66],
  [0.74, 0.66],
  [0.92, 0.74],
  [0.26, 0.74],
];
const HONE_FRONT: readonly IconPoint[] = [
  [0.26, 0.74],
  [0.92, 0.74],
  [0.92, 0.88],
  [0.26, 0.88],
];
const HONE_SIDE: readonly IconPoint[] = [
  [0.08, 0.66],
  [0.26, 0.74],
  [0.26, 0.88],
  [0.08, 0.8],
];
const EDGE_SWORD_ORIGIN: readonly [number, number] = [0.46, 0.44];
/** The blade lies nearly level, tip to the right and rising, its edge drawn across the stone. */
const EDGE_SWORD_TURN = 1.25;
const EDGE_SWORD_SCALE = 0.92;
const EDGE_SPARKS: readonly (readonly [number, number, number])[] = [
  [0.62, 0.5, 0.075],
  [0.76, 0.42, 0.05],
  [0.52, 0.42, 0.04],
];
const EDGE_STREAKS: readonly (readonly [readonly [number, number], readonly [number, number]])[] = [
  [
    [0.66, 0.58],
    [0.84, 0.5],
  ],
  [
    [0.6, 0.6],
    [0.72, 0.62],
  ],
];

const paintEdge: IconArtPainter = (ctx, px) => {
  paintLitPoints(ctx, px, HONE_SIDE, tone(WHETSTONE, SHADE));
  paintLitPoints(ctx, px, HONE_FRONT, tone(WHETSTONE, HALF_SHADE));
  paintLitPoints(ctx, px, HONE_TOP, tone(WHETSTONE, HALF_LIGHT));
  withPlacement(ctx, EDGE_SWORD_ORIGIN, EDGE_SWORD_TURN, EDGE_SWORD_SCALE, () =>
    paintSword(ctx, px),
  );
  for (const [from, to] of EDGE_STREAKS) paintStreak(ctx, px, from, to);
  for (const [sx, sy, r] of EDGE_SPARKS) paintSpark(ctx, sx, sy, r);
};

const CROSSED_TURN = 0.72;
const CROSSED_SCALE = 0.9;
const CROSSED_CENTRE: readonly [number, number] = [0.5, 0.52];
const BACK_STEEL = '#8f97a3';
const PAIR_SPARK: readonly [number, number, number] = [0.5, 0.3, 0.09];
const PAIR_STREAKS: readonly (readonly [readonly [number, number], readonly [number, number]])[] = [
  [
    [0.42, 0.28],
    [0.3, 0.16],
  ],
  [
    [0.58, 0.28],
    [0.7, 0.16],
  ],
];

const paintEdgePair: IconArtPainter = (ctx, px) => {
  withPlacement(ctx, CROSSED_CENTRE, CROSSED_TURN, CROSSED_SCALE, () =>
    paintSword(ctx, px, BACK_STEEL, tone(BRASS, HALF_SHADE)),
  );
  withPlacement(ctx, CROSSED_CENTRE, -CROSSED_TURN, CROSSED_SCALE, () => paintSword(ctx, px));
  for (const [from, to] of PAIR_STREAKS) paintStreak(ctx, px, from, to);
  paintSpark(ctx, PAIR_SPARK[0], PAIR_SPARK[1], PAIR_SPARK[2]);
};

const BURLAP = '#b58a52';
const ROPE = '#6e4a26';
/** Pell dummy: a sacking head and body bound to a post, a straw-stuffed crossbar for arms. */
const DUMMY = {
  postCx: 0.5,
  postHalf: 0.045,
  postTop: 0.4,
  postBottom: 0.92,
  footHalf: 0.2,
  footHeight: 0.05,
  footCorner: 0.017,
  armTop: 0.4,
  armBottom: 0.49,
  armLeft: 0.12,
  armRight: 0.88,
  bodyLeft: 0.33,
  bodyRight: 0.67,
  bodyTop: 0.36,
  bodyBottom: 0.74,
  bodyCorner: 0.1,
  headCx: 0.5,
  headCy: 0.22,
  headR: 0.13,
  ropeYs: [0.62, 0.34],
  eyeY: 0.21,
  eyeXs: [0.45, 0.55],
  eyeHalf: 0.022,
} as const;
const STRAW_TUFTS: readonly (readonly IconPoint[])[] = [
  [
    [0.12, 0.42],
    [0.05, 0.38],
  ],
  [
    [0.12, 0.445],
    [0.04, 0.45],
  ],
  [
    [0.12, 0.47],
    [0.05, 0.52],
  ],
  [
    [0.88, 0.42],
    [0.95, 0.38],
  ],
  [
    [0.88, 0.445],
    [0.96, 0.45],
  ],
  [
    [0.88, 0.47],
    [0.95, 0.52],
  ],
  [
    [0.42, 0.74],
    [0.39, 0.8],
  ],
  [
    [0.5, 0.74],
    [0.5, 0.81],
  ],
  [
    [0.58, 0.74],
    [0.61, 0.8],
  ],
];
const TUFT_WIDTH = 2.2;
const TUFT_EDGE = 4.4;
const ROPE_WIDTH = 2.6;
const EYE_WIDTH = 1.8;
const PATCH: readonly IconPoint[] = [
  [0.54, 0.46],
  [0.62, 0.47],
  [0.61, 0.55],
  [0.53, 0.54],
];

const paintDrillStrength: IconArtPainter = (ctx, px) => {
  const { postCx } = DUMMY;
  paintLitRect(
    ctx,
    px,
    postCx - DUMMY.footHalf,
    DUMMY.postBottom - DUMMY.footHeight,
    postCx + DUMMY.footHalf,
    DUMMY.postBottom,
    DARK_WOOD,
    DUMMY.footCorner,
  );
  paintLitRect(
    ctx,
    px,
    postCx - DUMMY.postHalf,
    DUMMY.postTop,
    postCx + DUMMY.postHalf,
    DUMMY.postBottom - DUMMY.footHeight,
    OAK,
  );
  for (const tuft of STRAW_TUFTS) {
    strokeDetail(ctx, px, tuft, ICON_OUTLINE, TUFT_EDGE);
    strokeDetail(ctx, px, tuft, STRAW, TUFT_WIDTH);
  }
  paintLitRect(
    ctx,
    px,
    DUMMY.armLeft,
    DUMMY.armTop,
    DUMMY.armRight,
    DUMMY.armBottom,
    STRAW,
    (DUMMY.armBottom - DUMMY.armTop) / 2,
  );
  paintLitRect(
    ctx,
    px,
    DUMMY.bodyLeft,
    DUMMY.bodyTop,
    DUMMY.bodyRight,
    DUMMY.bodyBottom,
    BURLAP,
    DUMMY.bodyCorner,
  );
  paintLitPoints(ctx, px, PATCH, tone(BURLAP, SHADE));
  for (const ropeY of DUMMY.ropeYs) {
    strokeDetail(
      ctx,
      px,
      [
        [DUMMY.bodyLeft, ropeY],
        [DUMMY.bodyRight, ropeY - DUMMY.eyeHalf],
      ],
      ROPE,
      ROPE_WIDTH,
    );
  }
  paintLitEllipse(ctx, px, DUMMY.headCx, DUMMY.headCy, DUMMY.headR, DUMMY.headR, BURLAP);
  for (const eyeX of DUMMY.eyeXs) {
    strokeDetail(
      ctx,
      px,
      [
        [eyeX - DUMMY.eyeHalf, DUMMY.eyeY - DUMMY.eyeHalf],
        [eyeX + DUMMY.eyeHalf, DUMMY.eyeY + DUMMY.eyeHalf],
      ],
      ICON_OUTLINE,
      EYE_WIDTH,
    );
    strokeDetail(
      ctx,
      px,
      [
        [eyeX + DUMMY.eyeHalf, DUMMY.eyeY - DUMMY.eyeHalf],
        [eyeX - DUMMY.eyeHalf, DUMMY.eyeY + DUMMY.eyeHalf],
      ],
      ICON_OUTLINE,
      EYE_WIDTH,
    );
  }
};

/** A battered round shield: planks, an iron rim with a bite hacked out, a boss and fresh gouges. */
const SHIELD = { cx: 0.5, cy: 0.5, r: 0.42, rimWidth: 0.06, bossR: 0.1 } as const;
const SHIELD_PLANK_XS = [0.32, 0.5, 0.68] as const;
const SHIELD_NOTCH: readonly IconPoint[] = [
  [0.76, 0.14],
  [0.68, 0.24],
  [0.8, 0.26],
  [0.9, 0.22],
];
/** A diagonal band where the paint has been knocked off and bare oak shows. */
const SHIELD_CHIPPED: readonly IconPoint[] = [
  [0, 0.62],
  [0.62, 1],
  [1, 1],
  [1, 0.84],
  [0.18, 0.4],
  [0, 0.4],
];
const SHIELD_GOUGES: readonly (readonly IconPoint[])[] = [
  [
    [0.24, 0.34],
    [0.4, 0.42],
  ],
  [
    [0.6, 0.66],
    [0.74, 0.58],
  ],
  [
    [0.3, 0.68],
    [0.36, 0.76],
  ],
];
const GOUGE_WIDTH = 2;
/** A gouge's lower lip catches the light just below its dark cut. */
const GOUGE_LIP_SHIFT = 0.012;
const RIM_SEAM_WIDTH = 1.2;
const SHIELD_RIM_RIVETS = 8;
const SHIELD_RIVET_R = 0.025;
const SHIELD_PAINT = '#8a3a2a';
const BOSS_GLINT_FRACTION = 1 / 3;

const paintDrillConstitution: IconArtPainter = (ctx, px) => {
  const { cx, cy, r } = SHIELD;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 1, 1);
  appendPoints(ctx, SHIELD_NOTCH);
  ctx.clip('evenodd');
  paintShieldBody(ctx, px);
  ctx.restore();
  withShapeClip(
    ctx,
    () => traceEllipse(ctx, cx, cy, r, r),
    () => {
      tracePoints(ctx, SHIELD_NOTCH);
      ctx.strokeStyle = ICON_OUTLINE;
      ctx.lineWidth = outlineWidth(px) * 2;
      ctx.stroke();
    },
  );
  paintLitEllipse(ctx, px, cx, cy, SHIELD.bossR, SHIELD.bossR, IRON);
  const glintShift = SHIELD.bossR * BOSS_GLINT_FRACTION;
  glint(ctx, cx - glintShift, cy - glintShift, SHIELD.bossR / 2);
};

function paintShieldBody(ctx: CanvasRenderingContext2D, px: number): void {
  const { cx, cy, r } = SHIELD;
  const lightFrom: Vec = [cx - r, cy - r];
  const lightTo: Vec = [cx + r, cy + r];
  paintForm(ctx, px, () => traceEllipse(ctx, cx, cy, r, r), litFill(ctx, IRON, lightFrom, lightTo));
  const faceR = r - SHIELD.rimWidth;
  const face = (): void => traceEllipse(ctx, cx, cy, faceR, faceR);
  withShapeClip(ctx, face, () => {
    ctx.fillStyle = litFill(ctx, SHIELD_PAINT, lightFrom, lightTo);
    ctx.fillRect(0, 0, 1, 1);
    tracePoints(ctx, SHIELD_CHIPPED);
    ctx.fillStyle = litFill(ctx, OAK, lightFrom, lightTo);
    ctx.fill();
    for (const plankX of SHIELD_PLANK_XS) {
      strokeDetail(
        ctx,
        px,
        [
          [plankX, 0],
          [plankX, 1],
        ],
        tone(OAK, DEEP_SHADE),
      );
    }
    for (const gouge of SHIELD_GOUGES) {
      strokeDetail(ctx, px, gouge, tone(OAK, DEEP_SHADE), GOUGE_WIDTH);
      const lip = gouge.map(([x, y]): IconPoint => [x + GOUGE_LIP_SHIFT, y + GOUGE_LIP_SHIFT]);
      strokeDetail(ctx, px, lip, tone(OAK, LIGHT));
    }
  });
  face();
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = px * RIM_SEAM_WIDTH;
  ctx.stroke();
  const rivetRing = r - SHIELD.rimWidth / 2;
  const halfStep = Math.PI / SHIELD_RIM_RIVETS;
  for (let i = 0; i < SHIELD_RIM_RIVETS; i++) {
    const angle = (i / SHIELD_RIM_RIVETS) * FULL_TURN + halfStep;
    const rivetX = cx + Math.cos(angle) * rivetRing;
    const rivetY = cy + Math.sin(angle) * rivetRing;
    rivet(ctx, px, rivetX, rivetY, SHIELD_RIVET_R, IRON);
  }
}

const BOOT_LEATHER = '#8a5a34';
const BOOT_SOLE = '#3a2a1f';
const BOOT_LACE = '#e6dcc4';
/** A boot sprung up onto its toes, heel lifted, as if mid-sidestep. */
const RUN_BOOT: readonly IconPoint[] = [
  [0.4, 0.14],
  [0.64, 0.12],
  [0.64, 0.44, 0.04],
  [0.84, 0.62, 0.06],
  [0.9, 0.74, 0.04],
  [0.84, 0.8, 0.03],
  [0.5, 0.74],
  [0.3, 0.6, 0.04],
  [0.38, 0.4],
];
const RUN_SOLE: readonly IconPoint[] = [
  [0.29, 0.58],
  [0.52, 0.72],
  [0.86, 0.79, 0.03],
  [0.84, 0.86, 0.02],
  [0.48, 0.81],
  [0.25, 0.65, 0.02],
];
const RUN_CUFF: readonly IconPoint[] = [
  [0.38, 0.1, 0.01],
  [0.66, 0.08, 0.01],
  [0.66, 0.18],
  [0.39, 0.2],
];
const RUN_LACES: readonly (readonly IconPoint[])[] = [
  [
    [0.6, 0.3],
    [0.66, 0.36],
  ],
  [
    [0.62, 0.4],
    [0.7, 0.44],
  ],
  [
    [0.68, 0.48],
    [0.76, 0.52],
  ],
];
const LACE_WIDTH = 2;
const RUN_BOOT_GLINT = { x: 0.46, y: 0.28, r: 0.05 } as const;
const MOTION_LINES: readonly (readonly IconPoint[])[] = [
  [
    [0.04, 0.3],
    [0.26, 0.3],
  ],
  [
    [0.08, 0.44],
    [0.27, 0.44],
  ],
  [
    [0.02, 0.58],
    [0.2, 0.58],
  ],
];
const MOTION_WIDTH = 3;
const MOTION_EDGE = 5.4;
const MOTION_COLOR = '#d8e2ec';
const SAND = '#d8b878';
/** Kicked-up sand: each puff is a flattened ellipse, wider than tall. */
const SAND_PUFF_SQUASH = 0.7;
const SAND_PUFFS: readonly (readonly [number, number, number])[] = [
  [0.3, 0.86, 0.06],
  [0.2, 0.9, 0.045],
  [0.4, 0.92, 0.04],
];

const paintDrillDexterity: IconArtPainter = (ctx, px) => {
  for (const line of MOTION_LINES) {
    strokeDetail(ctx, px, line, ICON_OUTLINE, MOTION_EDGE);
    strokeDetail(ctx, px, line, MOTION_COLOR, MOTION_WIDTH);
  }
  for (const [sx, sy, r] of SAND_PUFFS)
    paintLitEllipse(ctx, px, sx, sy, r, r * SAND_PUFF_SQUASH, SAND);
  paintLitPoints(ctx, px, RUN_BOOT, BOOT_LEATHER);
  paintLitPoints(ctx, px, RUN_SOLE, BOOT_SOLE);
  paintLitPoints(ctx, px, RUN_CUFF, tone(BOOT_LEATHER, HALF_SHADE));
  for (const lace of RUN_LACES) strokeDetail(ctx, px, lace, BOOT_LACE, LACE_WIDTH);
  glint(ctx, RUN_BOOT_GLINT.x, RUN_BOOT_GLINT.y, RUN_BOOT_GLINT.r);
};

const STONE = '#8a8478';
const STAIR_DARK = '#0e0c10';
const LANTERN_IRON = '#3a3430';
/** A stone arch over a stair that drops away into the dark, a lantern hung from the keystone. */
const ARCH = {
  left: 0.1,
  right: 0.9,
  top: 0.12,
  bottom: 0.94,
  innerLeft: 0.24,
  innerRight: 0.76,
  innerTop: 0.24,
} as const;
const ARCH_JOINTS: readonly (readonly IconPoint[])[] = [
  [
    [ARCH.left, 0.62],
    [ARCH.innerLeft, 0.62],
  ],
  [
    [ARCH.innerRight, 0.62],
    [ARCH.right, 0.62],
  ],
  [
    [ARCH.left, 0.8],
    [ARCH.innerLeft, 0.8],
  ],
  [
    [ARCH.innerRight, 0.8],
    [ARCH.right, 0.8],
  ],
  [
    [0.18, 0.3],
    [0.28, 0.36],
  ],
  [
    [0.82, 0.3],
    [0.72, 0.36],
  ],
  [
    [0.44, 0.13],
    [0.45, 0.25],
  ],
  [
    [0.56, 0.13],
    [0.55, 0.25],
  ],
];
const JOINT_WIDTH = 1.4;
const STEP_COUNT = 4;
const STEP_TOP = 0.6;
const STEP_BOTTOM = 0.94;
/** Each step further down is narrower, so the flight reads as receding. */
const STEP_INSET_PER_STEP = 0.04;
/** Each step down sinks further into the dark. */
const NEAREST_STEP_TONE = -0.15;
const STEP_DARKENING = 0.17;
const RISER_DARKENING = 0.3;
const TREAD_FRACTION = 0.45;
const LANTERN = { cx: 0.5, top: 0.3, bottom: 0.46, half: 0.06, corner: 0.015 } as const;
const LANTERN_CAP = { overhang: 0.012, rise: 0.025, depth: 0.01 } as const;
const LANTERN_GLOW_R = 0.22;
const LANTERN_CHAIN_WIDTH = 1.5;
const LANTERN_FLAME = { lift: 0.02, widthOfLantern: 0.6, heightOfLantern: 0.75 } as const;

function traceArch(
  ctx: CanvasRenderingContext2D,
  left: number,
  right: number,
  top: number,
  bottom: number,
): void {
  const cx = (left + right) / 2;
  const half = (right - left) / 2;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(left, top + half);
  ctx.arc(cx, top + half, half, Math.PI, 0);
  ctx.lineTo(right, bottom);
  ctx.closePath();
}

function paintStairFlight(ctx: CanvasRenderingContext2D): void {
  const span = (STEP_BOTTOM - STEP_TOP) / STEP_COUNT;
  const tread = span * TREAD_FRACTION;
  for (let step = 0; step < STEP_COUNT; step++) {
    const stepsBelow = STEP_COUNT - 1 - step;
    const top = STEP_TOP + step * span;
    const inset = stepsBelow * STEP_INSET_PER_STEP;
    const left = ARCH.innerLeft + inset;
    const width = ARCH.innerRight - inset - left;
    const treadTone = NEAREST_STEP_TONE - stepsBelow * STEP_DARKENING;
    ctx.fillStyle = tone(STONE, treadTone);
    ctx.fillRect(left, top, width, tread);
    ctx.fillStyle = tone(STONE, treadTone - RISER_DARKENING);
    ctx.fillRect(left, top + tread, width, span - tread);
  }
}

function paintLantern(ctx: CanvasRenderingContext2D, px: number): void {
  const { cx, top, bottom, half } = LANTERN;
  strokeDetail(
    ctx,
    px,
    [
      [cx, ARCH.innerTop],
      [cx, top],
    ],
    ICON_OUTLINE,
    LANTERN_CHAIN_WIDTH,
  );
  paintLitRect(ctx, px, cx - half, top, cx + half, bottom, LANTERN_IRON, LANTERN.corner);
  const height = bottom - top;
  paintFlame(
    ctx,
    px,
    cx,
    bottom - LANTERN_FLAME.lift,
    half * LANTERN_FLAME.widthOfLantern,
    height * LANTERN_FLAME.heightOfLantern,
    false,
  );
  const capHalf = half + LANTERN_CAP.overhang;
  paintLitRect(
    ctx,
    px,
    cx - capHalf,
    top - LANTERN_CAP.rise,
    cx + capHalf,
    top + LANTERN_CAP.depth,
    BRASS,
  );
}

const paintDrillIntelligence: IconArtPainter = (ctx, px) => {
  const outer = (): void => traceArch(ctx, ARCH.left, ARCH.right, ARCH.top, ARCH.bottom);
  paintForm(ctx, px, outer, litFill(ctx, STONE, [ARCH.left, ARCH.top], [ARCH.right, ARCH.bottom]));
  withShapeClip(ctx, outer, () => {
    for (const joint of ARCH_JOINTS)
      strokeDetail(ctx, px, joint, tone(STONE, DEEP_SHADE), JOINT_WIDTH);
  });
  const opening = (): void =>
    traceArch(ctx, ARCH.innerLeft, ARCH.innerRight, ARCH.innerTop, ARCH.bottom);
  paintForm(ctx, px, opening, STAIR_DARK);
  withShapeClip(ctx, opening, () => {
    paintStairFlight(ctx);
    paintGlow(ctx, LANTERN.cx, (LANTERN.top + LANTERN.bottom) / 2, LANTERN_GLOW_R, FLAME_YELLOW);
  });
  paintLantern(ctx, px);
};

const SUIT = '#23262e';
const SHIRT = '#e8ecf2';
const SHADES = '#0e1014';
const SHADES_SHINE = '#6d7a8c';
const TIE_RED = '#7a1838';
const SKIN_LIGHT = '#d9a77c';
const SKIN_DARK = '#7a4f34';
/**
 * One hulking bodyguard, front-on: a slab of shoulders in a dark suit, a
 * small head, shades. Every x below is an offset from the figure's centre.
 */
const BOUNCER_BODY: readonly IconPoint[] = [
  [-0.08, 0.4],
  [0.08, 0.4],
  [0.24, 0.48, 0.08],
  [0.26, 0.98],
  [-0.26, 0.98],
  [-0.24, 0.48, 0.08],
];
const BOUNCER_SHIRT: readonly IconPoint[] = [
  [-0.07, 0.42],
  [0.07, 0.42],
  [0, 0.68],
];
const BOUNCER_TIE: readonly IconPoint[] = [
  [-0.025, 0.44],
  [0.025, 0.44],
  [0.03, 0.62],
  [0, 0.67],
  [-0.03, 0.62],
];
const BOUNCER_LAPEL: readonly IconPoint[] = [
  [-0.09, 0.44],
  [-0.04, 0.6],
];
const LAPEL_WIDTH = 1.4;
const BOUNCER_NECK = { half: 0.06, top: 0.32, bottom: 0.43 } as const;
const BOUNCER_HEAD = { cy: 0.24, rx: 0.11, ry: 0.12 } as const;
const BOUNCER_SHADES: readonly IconPoint[] = [
  [-0.1, 0.2, 0.01],
  [0.1, 0.2, 0.01],
  [0.09, 0.27, 0.03],
  [0.01, 0.26],
  [-0.01, 0.26],
  [-0.09, 0.27, 0.03],
];
const BOUNCER_SHADES_SHINE: readonly IconPoint[] = [
  [-0.07, 0.22],
  [-0.03, 0.22],
];
const SHADES_SHINE_WIDTH = 1.2;
const BACK_BOUNCER_X = 0.68;
const FRONT_BOUNCER_X = 0.32;
const ESCORT_BADGE = { cx: 0.5, cy: 0.82, outer: 0.13, inner: 0.055, points: 5 } as const;

function shifted(points: readonly IconPoint[], dx: number): IconPoint[] {
  return points.map(([x, y, corner]): IconPoint => [x + dx, y, corner]);
}

function paintBouncer(ctx: CanvasRenderingContext2D, px: number, cx: number, skin: string): void {
  paintLitPoints(ctx, px, shifted(BOUNCER_BODY, cx), SUIT);
  paintForm(ctx, px, () => tracePoints(ctx, shifted(BOUNCER_SHIRT, cx)), SHIRT);
  paintForm(ctx, px, () => tracePoints(ctx, shifted(BOUNCER_TIE, cx)), TIE_RED);
  strokeDetail(ctx, px, shifted(BOUNCER_LAPEL, cx), tone(SUIT, LIGHT * 2), LAPEL_WIDTH);
  const { half, top, bottom } = BOUNCER_NECK;
  paintLitRect(ctx, px, cx - half, top, cx + half, bottom, tone(skin, HALF_SHADE));
  paintLitEllipse(ctx, px, cx, BOUNCER_HEAD.cy, BOUNCER_HEAD.rx, BOUNCER_HEAD.ry, skin);
  paintForm(ctx, px, () => tracePoints(ctx, shifted(BOUNCER_SHADES, cx)), SHADES);
  strokeDetail(ctx, px, shifted(BOUNCER_SHADES_SHINE, cx), SHADES_SHINE, SHADES_SHINE_WIDTH);
}

const paintVipEscort: IconArtPainter = (ctx, px) => {
  paintBouncer(ctx, px, BACK_BOUNCER_X, SKIN_DARK);
  paintBouncer(ctx, px, FRONT_BOUNCER_X, SKIN_LIGHT);
  paintStar(ctx, px, ESCORT_BADGE, GOLD);
};

export const TRAINING_SERVICE_ICONS = {
  edge: toIcon(paintEdge),
  edge_pair: toIcon(paintEdgePair),
  drill_strength: toIcon(paintDrillStrength),
  drill_constitution: toIcon(paintDrillConstitution),
  drill_dexterity: toIcon(paintDrillDexterity),
  drill_intelligence: toIcon(paintDrillIntelligence),
  vip_escort: toIcon(paintVipEscort),
} as const;
