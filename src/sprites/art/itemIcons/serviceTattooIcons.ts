/**
 * Service icons for the tattoo parlour's five designs. Each is a sheet of
 * flash pinned to the parlour wall — the same cream card, border and tack —
 * so the five read as one set and only the inked design tells them apart.
 */

import {
  FULL_TURN,
  glint,
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
  DEEP_SHADE,
  HALF_SHADE,
  LIGHT,
  paintLitEllipse,
  paintLitPoints,
  paintLitRect,
  rectPoints,
  SHADE,
  toIcon,
} from './serviceIconKit';

const FLASH_PAPER = '#eee2c2';
const FLASH_BORDER = '#a8322a';
const TACK_RED = '#c8322a';
const INK = '#16110e';
const SKIN = '#e8b088';
const INK_RED = '#b8302a';
const INK_GREEN = '#3f8a4a';
const INK_YELLOW = '#e8c040';

const CARD = {
  left: 0.12,
  right: 0.88,
  top: 0.08,
  bottom: 0.94,
  corner: 0.03,
  border: 0.05,
} as const;
const TACK = { cx: 0.5, cy: 0.12, r: 0.045 } as const;
const CARD_CURL = 0.06;
const BORDER_WIDTH = 1.6;
const BORDER_MIN = 0.0125;

function paintFlashCard(ctx: CanvasRenderingContext2D, px: number): void {
  const card: readonly IconPoint[] = [
    [CARD.left, CARD.top, CARD.corner],
    [CARD.right, CARD.top, CARD.corner],
    [CARD.right, CARD.bottom - CARD_CURL],
    [CARD.right - CARD_CURL, CARD.bottom],
    [CARD.left, CARD.bottom, CARD.corner],
  ];
  paintLitPoints(ctx, px, card, FLASH_PAPER);
  const curl: readonly IconPoint[] = [
    [CARD.right, CARD.bottom - CARD_CURL],
    [CARD.right - CARD_CURL, CARD.bottom],
    [CARD.right - CARD_CURL, CARD.bottom - CARD_CURL],
  ];
  paintForm(ctx, px, () => tracePoints(ctx, curl), tone(FLASH_PAPER, SHADE));
  tracePoints(
    ctx,
    rectPoints(
      CARD.left + CARD.border,
      CARD.top + CARD.border,
      CARD.right - CARD.border,
      CARD.bottom - CARD.border,
    ),
  );
  ctx.strokeStyle = FLASH_BORDER;
  ctx.lineWidth = Math.max(px * BORDER_WIDTH, BORDER_MIN);
  ctx.stroke();
  rivet(ctx, px, TACK.cx, TACK.cy, TACK.r, TACK_RED);
}

/** Inks a stroke the flash way: a heavy black line with a colour laid inside it. */
const INK_LINE = 5.5;
const INK_FILL_LINE = 3;
function inkStroke(
  ctx: CanvasRenderingContext2D,
  px: number,
  points: readonly IconPoint[],
  color: string,
  weight = 1,
): void {
  strokeDetail(ctx, px, points, INK, INK_LINE * weight);
  strokeDetail(ctx, px, points, color, INK_FILL_LINE * weight);
}

/** A fist knuckles-on, wrist wound with a red coil. */
const FIST_FINGERS = {
  left: 0.31,
  width: 0.095,
  count: 4,
  top: 0.3,
  bottom: 0.48,
  corner: 0.04,
} as const;
const FIST_PALM: readonly IconPoint[] = [
  [0.3, 0.4, 0.04],
  [0.7, 0.4, 0.04],
  [0.68, 0.68, 0.06],
  [0.34, 0.68, 0.06],
];
const FIST_THUMB: readonly IconPoint[] = [
  [0.32, 0.48, 0.04],
  [0.6, 0.5, 0.04],
  [0.6, 0.58, 0.04],
  [0.33, 0.58, 0.04],
];
const FIST_WRIST = { left: 0.4, right: 0.62, top: 0.66, bottom: 0.86 } as const;
const COIL_WEIGHT = 1.2;
const COIL_TURNS: readonly (readonly IconPoint[])[] = [
  [
    [0.38, 0.73],
    [0.64, 0.68],
  ],
  [
    [0.38, 0.81],
    [0.64, 0.76],
  ],
];

const paintCoiledFist: IconArtPainter = (ctx, px) => {
  paintFlashCard(ctx, px);
  paintLitRect(ctx, px, FIST_WRIST.left, FIST_WRIST.top, FIST_WRIST.right, FIST_WRIST.bottom, SKIN);
  for (const turn of COIL_TURNS) inkStroke(ctx, px, turn, INK_RED, COIL_WEIGHT);
  paintLitPoints(ctx, px, FIST_PALM, SKIN);
  for (let finger = 0; finger < FIST_FINGERS.count; finger++) {
    const left = FIST_FINGERS.left + finger * FIST_FINGERS.width;
    paintLitRect(
      ctx,
      px,
      left,
      FIST_FINGERS.top,
      left + FIST_FINGERS.width,
      FIST_FINGERS.bottom,
      SKIN,
      FIST_FINGERS.corner,
    );
  }
  paintLitPoints(ctx, px, FIST_THUMB, tone(SKIN, HALF_SHADE));
};

const IRON_INK = '#7d8792';
const RIB_SPINE: readonly IconPoint[] = [
  [0.5, 0.26],
  [0.5, 0.84],
];
const STERNUM: readonly IconPoint[] = [
  [0.5, 0.3],
  [0.5, 0.56],
];
/** Each rib, left side: from the spine out and down, mirrored for the right; they shorten toward the waist. */
const RIBS: readonly (readonly IconPoint[])[] = [
  [
    [0.47, 0.32],
    [0.3, 0.32, 0.08],
    [0.32, 0.42],
  ],
  [
    [0.47, 0.42],
    [0.26, 0.42, 0.1],
    [0.29, 0.54],
  ],
  [
    [0.47, 0.52],
    [0.28, 0.53, 0.1],
    [0.31, 0.64],
  ],
  [
    [0.47, 0.62],
    [0.34, 0.63, 0.08],
    [0.36, 0.7],
  ],
];
const RIB_WEIGHT = 0.9;
const SPINE_WEIGHT = 1.2;
const ICON_WIDTH = 1;

const paintIronRibs: IconArtPainter = (ctx, px) => {
  paintFlashCard(ctx, px);
  inkStroke(ctx, px, RIB_SPINE, IRON_INK, SPINE_WEIGHT);
  for (const rib of RIBS) {
    inkStroke(ctx, px, rib, IRON_INK, RIB_WEIGHT);
    inkStroke(
      ctx,
      px,
      rib.map(([x, y, corner]) => [ICON_WIDTH - x, y, corner] as const),
      tone(IRON_INK, HALF_SHADE),
      RIB_WEIGHT,
    );
  }
  inkStroke(ctx, px, STERNUM, tone(IRON_INK, LIGHT), SPINE_WEIGHT);
};

const IRIS = '#6a4ab0';
const EYE = {
  cx: 0.5,
  cy: 0.56,
  halfWidth: 0.3,
  halfHeight: 0.15,
  irisR: 0.1,
  pupilR: 0.045,
} as const;
const EYE_RAYS = 7;
const EYE_RAY_INNER = 0.22;
const EYE_RAY_OUTER = 0.34;
/** The rays fan across the upper half only, like a sunrise over the lid. */
const EYE_RAY_SPREAD = Math.PI * 0.8;
const EYE_RAY_FIRST = -Math.PI / 2 - EYE_RAY_SPREAD / 2;
const EYE_RAY_WEIGHT = 0.8;
const EYE_WHITE = '#f8f4ea';
const EYE_GLINT_OFFSET = 0.4;
const TEAR: readonly IconPoint[] = [
  [0.5, 0.74],
  [0.54, 0.82, 0.03],
  [0.5, 0.86, 0.02],
  [0.46, 0.82, 0.03],
];

function traceEye(ctx: CanvasRenderingContext2D): void {
  const { cx, cy, halfWidth, halfHeight } = EYE;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, cy);
  ctx.quadraticCurveTo(cx, cy - halfHeight * 2, cx + halfWidth, cy);
  ctx.quadraticCurveTo(cx, cy + halfHeight * 2, cx - halfWidth, cy);
  ctx.closePath();
}

const paintThirdEye: IconArtPainter = (ctx, px) => {
  paintFlashCard(ctx, px);
  const { cx, cy } = EYE;
  for (let ray = 0; ray < EYE_RAYS; ray++) {
    const angle = EYE_RAY_FIRST + (ray / (EYE_RAYS - 1)) * EYE_RAY_SPREAD;
    inkStroke(
      ctx,
      px,
      [
        [cx + Math.cos(angle) * EYE_RAY_INNER, cy + Math.sin(angle) * EYE_RAY_INNER],
        [cx + Math.cos(angle) * EYE_RAY_OUTER, cy + Math.sin(angle) * EYE_RAY_OUTER],
      ],
      INK_YELLOW,
      EYE_RAY_WEIGHT,
    );
  }
  paintForm(ctx, px, () => traceEye(ctx), EYE_WHITE);
  withShapeClip(
    ctx,
    () => traceEye(ctx),
    () => {
      paintLitEllipse(ctx, px, cx, cy, EYE.irisR, EYE.irisR, IRIS);
      traceEllipse(ctx, cx, cy, EYE.pupilR, EYE.pupilR);
      ctx.fillStyle = INK;
      ctx.fill();
    },
  );
  const glintShift = EYE.irisR * EYE_GLINT_OFFSET;
  glint(ctx, cx - glintShift, cy - glintShift, EYE.pupilR);
  paintLitPoints(ctx, px, TEAR, INK_RED);
};

/** A serpent in a tight S, head up-right, tongue flicking. */
const SERPENT_BODY: readonly IconPoint[] = [
  [0.3, 0.86],
  [0.62, 0.84, 0.1],
  [0.68, 0.7, 0.08],
  [0.34, 0.62, 0.1],
  [0.32, 0.46, 0.08],
  [0.62, 0.4, 0.08],
  [0.62, 0.3],
];
const SERPENT_WEIGHT = 3.2;
const TONGUE_WIDTH = 2;
/** A sheen line rides the body's upper-left edge, toward the light. */
const SERPENT_SHEEN_SHIFT = 0.012;
const BELLY_WEIGHT = 0.7;
const SERPENT_HEAD: readonly IconPoint[] = [
  [0.56, 0.3, 0.03],
  [0.62, 0.2, 0.04],
  [0.74, 0.22, 0.04],
  [0.72, 0.32, 0.04],
];
const SERPENT_TONGUE: readonly IconPoint[] = [
  [0.74, 0.25],
  [0.8, 0.22],
];
const SERPENT_FORKS: readonly (readonly IconPoint[])[] = [
  [
    [0.8, 0.22],
    [0.84, 0.18],
  ],
  [
    [0.8, 0.22],
    [0.85, 0.24],
  ],
];
const SERPENT_EYE: readonly [number, number] = [0.66, 0.24];
const SERPENT_EYE_R = 0.018;

const paintQuickSerpent: IconArtPainter = (ctx, px) => {
  paintFlashCard(ctx, px);
  strokeDetail(ctx, px, SERPENT_TONGUE, INK_RED, TONGUE_WIDTH);
  for (const fork of SERPENT_FORKS) strokeDetail(ctx, px, fork, INK_RED, TONGUE_WIDTH);
  inkStroke(ctx, px, SERPENT_BODY, INK_GREEN, SERPENT_WEIGHT);
  strokeDetail(
    ctx,
    px,
    SERPENT_BODY.map(([x, y, corner]): IconPoint => [
      x - SERPENT_SHEEN_SHIFT,
      y - SERPENT_SHEEN_SHIFT,
      corner,
    ]),
    tone(INK_GREEN, LIGHT),
    INK_FILL_LINE * BELLY_WEIGHT,
  );
  paintLitPoints(ctx, px, SERPENT_HEAD, INK_GREEN);
  traceEllipse(ctx, SERPENT_EYE[0], SERPENT_EYE[1], SERPENT_EYE_R, SERPENT_EYE_R);
  ctx.fillStyle = INK_YELLOW;
  ctx.fill();
};

/** A brass gorget: a crescent collar plate riveted across its face, a ring hung at the throat. */
const GORGET = { cx: 0.5, cy: 0.3, outerR: 0.33, innerR: 0.17 } as const;
/** The crescent's horns stop just short of level, and its inner edge flares past them. */
const GORGET_HORN_LIFT = 0.12;
const GORGET_INNER_FLARE = 0.25;
const GORGET_BAND = GORGET.outerR - GORGET.innerR;
const GORGET_MID_R = (GORGET.outerR + GORGET.innerR) / 2;
/** Light runs along the plate's middle, shade along its lower rim, a scored line between. */
const GORGET_LIT_WIDTH = GORGET_BAND / 3;
const GORGET_SHADE_WIDTH = GORGET_BAND / 2.5;
const GORGET_SCORE_DROP = 0.01;
const GORGET_RIVET_R = 0.03;
const GORGET_RIVET_DROP = 0.035;
const GORGET_RIVET_SPREAD = 0.45;
const GORGET_RIVET_ANGLES = [
  GORGET_RIVET_SPREAD,
  Math.PI / 2,
  Math.PI - GORGET_RIVET_SPREAD,
] as const;
const GORGET_RING = { cx: 0.5, cy: 0.76, r: 0.08, thickness: 4 } as const;
const GORGET_CHAIN_WIDTH = 3;

function traceGorget(ctx: CanvasRenderingContext2D): void {
  const { cx, cy, outerR, innerR } = GORGET;
  const from = GORGET_HORN_LIFT;
  const to = Math.PI - GORGET_HORN_LIFT;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, from, to);
  ctx.arc(cx, cy, innerR, to + GORGET_INNER_FLARE, from - GORGET_INNER_FLARE, true);
  ctx.closePath();
}

function strokeGorgetArc(
  ctx: CanvasRenderingContext2D,
  r: number,
  color: string,
  width: number,
): void {
  ctx.beginPath();
  ctx.arc(GORGET.cx, GORGET.cy, r, 0, FULL_TURN);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

const paintBrassGullet: IconArtPainter = (ctx, px) => {
  paintFlashCard(ctx, px);
  const { cx, cy } = GORGET;
  traceEllipse(ctx, GORGET_RING.cx, GORGET_RING.cy, GORGET_RING.r, GORGET_RING.r);
  ctx.strokeStyle = INK;
  ctx.lineWidth = px * GORGET_RING.thickness * 2;
  ctx.stroke();
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = px * GORGET_RING.thickness;
  ctx.stroke();
  strokeDetail(
    ctx,
    px,
    [
      [GORGET_RING.cx, cy + GORGET.outerR],
      [GORGET_RING.cx, GORGET_RING.cy - GORGET_RING.r],
    ],
    INK,
    GORGET_CHAIN_WIDTH,
  );
  paintForm(ctx, px, () => traceGorget(ctx), BRASS);
  withShapeClip(
    ctx,
    () => traceGorget(ctx),
    () => {
      strokeGorgetArc(ctx, GORGET_MID_R, tone(BRASS, LIGHT), GORGET_LIT_WIDTH);
      strokeGorgetArc(ctx, GORGET.outerR, tone(BRASS, SHADE), GORGET_SHADE_WIDTH);
      strokeGorgetArc(ctx, GORGET_MID_R + GORGET_SCORE_DROP, tone(BRASS, DEEP_SHADE), px);
    },
  );
  const rivetRing = GORGET_MID_R + GORGET_RIVET_DROP;
  for (const angle of GORGET_RIVET_ANGLES) {
    const rivetX = cx + Math.cos(angle) * rivetRing;
    const rivetY = cy + Math.sin(angle) * rivetRing;
    rivet(ctx, px, rivetX, rivetY, GORGET_RIVET_R, tone(BRASS, LIGHT));
  }
};

export const TATTOO_SERVICE_ICONS = {
  tattoo_coiled_fist: toIcon(paintCoiledFist),
  tattoo_iron_ribs: toIcon(paintIronRibs),
  tattoo_third_eye: toIcon(paintThirdEye),
  tattoo_quick_serpent: toIcon(paintQuickSerpent),
  tattoo_brass_gullet: toIcon(paintBrassGullet),
} as const;
