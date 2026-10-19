/**
 * Service icons for a place to sleep or a place to go: the farm's hayloft,
 * the inn's three rooms and the three anchor-travel destinations.
 */

import {
  bandedFill,
  glint,
  ICON_CENTER,
  ICON_OUTLINE,
  paintForm,
  strokeDetail,
  tone,
  tracePoints,
  withShapeClip,
  type IconArtPainter,
  type IconPoint,
} from './iconPaint';
import {
  DARK_WOOD,
  DEEP_SHADE,
  FLAME_YELLOW,
  GOLD,
  HALF_LIGHT,
  HALF_SHADE,
  LIGHT,
  OAK,
  paintBed,
  paintFlame,
  paintGlow,
  paintLitEllipse,
  paintLitPoints,
  paintLitRect,
  rectPoints,
  SHADE,
  STRAW,
  strokeOutlined,
  toIcon,
  type Vec,
} from './serviceIconKit';

const TWINE = '#8a5a2a';
const DOORWAY_DARK = '#1a1210';

/** A line of mortar, plank or thatch seam drawn across a face. */
const SEAM_WIDTH = 1.4;

/** Ruled seams across a rectangle at each of `ys`, clipped to it. */
function paintCourses(
  ctx: CanvasRenderingContext2D,
  px: number,
  box: readonly IconPoint[],
  ys: readonly number[],
  color: string,
): void {
  const xs = box.map(([x]) => x);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  withShapeClip(
    ctx,
    () => tracePoints(ctx, box),
    () => {
      for (const y of ys) {
        const seam: readonly IconPoint[] = [
          [left, y],
          [right, y],
        ];
        strokeDetail(ctx, px, seam, color, SEAM_WIDTH);
      }
    },
  );
}

/** A round-topped doorway, its foot on `bottom`. */
function traceArchedDoor(
  ctx: CanvasRenderingContext2D,
  cx: number,
  half: number,
  top: number,
  bottom: number,
): void {
  const springY = top + half;
  ctx.beginPath();
  ctx.moveTo(cx - half, bottom);
  ctx.lineTo(cx - half, springY);
  ctx.arc(cx, springY, half, Math.PI, 0);
  ctx.lineTo(cx + half, bottom);
  ctx.closePath();
}

const BALE_FRONT: readonly IconPoint[] = rectPoints(0.08, 0.5, 0.62, 0.9);
const BALE_TOP: readonly IconPoint[] = [
  [0.08, 0.5],
  [0.62, 0.5],
  [0.76, 0.4],
  [0.22, 0.4],
];
const BALE_SIDE: readonly IconPoint[] = [
  [0.62, 0.5],
  [0.76, 0.4],
  [0.76, 0.8],
  [0.62, 0.9],
];
const BALE_STRAW_YS = [0.6, 0.7, 0.8] as const;
/** Each twine runs up the bale's face and back across its top. */
const BALE_TWINES: readonly (readonly IconPoint[])[] = [
  [
    [0.24, 0.9],
    [0.24, 0.5],
    [0.38, 0.4],
  ],
  [
    [0.46, 0.9],
    [0.46, 0.5],
    [0.6, 0.4],
  ],
];
const TWINE_WIDTH = 2.4;
const LOOSE_STRAWS: readonly (readonly IconPoint[])[] = [
  [
    [0.3, 0.42],
    [0.22, 0.32],
  ],
  [
    [0.44, 0.42],
    [0.48, 0.3],
  ],
  [
    [0.12, 0.88],
    [0.04, 0.94],
  ],
];
const LOOSE_STRAW_WIDTH = 2;
const LADDER_LEFT_RAIL: readonly [Vec, Vec] = [
  [0.66, 0.96],
  [0.76, 0.06],
];
const LADDER_RIGHT_RAIL: readonly [Vec, Vec] = [
  [0.86, 0.96],
  [0.94, 0.06],
];
const LADDER_RUNG_COUNT = 6;
const LADDER_WIDTH = 4;
const RUNG_WIDTH = 2.8;

function along([from, to]: readonly [Vec, Vec], t: number): IconPoint {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

const paintHayloft: IconArtPainter = (ctx, px) => {
  paintLitPoints(ctx, px, BALE_SIDE, tone(STRAW, SHADE));
  paintLitPoints(ctx, px, BALE_FRONT, STRAW);
  paintLitPoints(ctx, px, BALE_TOP, tone(STRAW, HALF_LIGHT));
  paintCourses(ctx, px, BALE_FRONT, BALE_STRAW_YS, tone(STRAW, SHADE));
  for (const twine of BALE_TWINES) strokeDetail(ctx, px, twine, TWINE, TWINE_WIDTH);
  for (const straw of LOOSE_STRAWS)
    strokeDetail(ctx, px, straw, tone(STRAW, HALF_SHADE), LOOSE_STRAW_WIDTH);
  strokeOutlined(ctx, px, LADDER_LEFT_RAIL, OAK, LADDER_WIDTH);
  strokeOutlined(ctx, px, LADDER_RIGHT_RAIL, OAK, LADDER_WIDTH);
  for (let rung = 1; rung <= LADDER_RUNG_COUNT; rung++) {
    const t = rung / (LADDER_RUNG_COUNT + 1);
    const rungLine = [along(LADDER_LEFT_RAIL, t), along(LADDER_RIGHT_RAIL, t)];
    strokeOutlined(ctx, px, rungLine, tone(OAK, LIGHT), RUNG_WIDTH / 2);
  }
};

const ATTIC_BOARDS = '#4a3626';
const MOONLIGHT = '#bcd2ea';
const ATTIC_BLANKET = '#7a7050';
/** The space under the roof: a tall gable whose slopes are the rafters. */
const ATTIC_SPACE: readonly IconPoint[] = [
  [0.02, 0.66],
  [0.6, 0.08],
  [0.98, 0.46],
  [0.98, 0.96],
  [0.02, 0.96],
];
const ATTIC_RAFTERS: readonly (readonly IconPoint[])[] = [
  [
    [0, 0.66],
    [0.6, 0.06],
  ],
  [
    [0.6, 0.06],
    [1, 0.46],
  ],
];
const RAFTER_WIDTH = 7;
const ATTIC_WINDOW = { cx: 0.6, cy: 0.32, r: 0.08 } as const;
const WINDOW_MULLION_WIDTH = 1.5;
const ATTIC_PLANK_XS = [0.24, 0.42, 0.78] as const;
const ATTIC_BED = { left: 0.1, right: 0.9, top: 0.72, floor: 0.92, headboardTop: 0.62 } as const;

function paintRoundWindow(ctx: CanvasRenderingContext2D, px: number): void {
  const { cx, cy, r } = ATTIC_WINDOW;
  paintLitEllipse(ctx, px, cx, cy, r, r, MOONLIGHT);
  const mullions: readonly (readonly IconPoint[])[] = [
    [
      [cx, cy - r],
      [cx, cy + r],
    ],
    [
      [cx - r, cy],
      [cx + r, cy],
    ],
  ];
  for (const mullion of mullions)
    strokeDetail(ctx, px, mullion, ICON_OUTLINE, WINDOW_MULLION_WIDTH);
}

const paintRoomAttic: IconArtPainter = (ctx, px) => {
  const space = (): void => tracePoints(ctx, ATTIC_SPACE);
  paintLitPoints(ctx, px, ATTIC_SPACE, ATTIC_BOARDS);
  withShapeClip(ctx, space, () => {
    for (const plankX of ATTIC_PLANK_XS) {
      const plank: readonly IconPoint[] = [
        [plankX, 0],
        [plankX, 1],
      ];
      strokeDetail(ctx, px, plank, tone(ATTIC_BOARDS, DEEP_SHADE), SEAM_WIDTH);
    }
  });
  paintRoundWindow(ctx, px);
  for (const rafter of ATTIC_RAFTERS) strokeOutlined(ctx, px, rafter, OAK, RAFTER_WIDTH);
  paintBed(ctx, px, { ...ATTIC_BED, frame: OAK, blanket: ATTIC_BLANKET });
};

const HEARTH_STONE = '#8a8478';
const HEARTH_BLANKET = '#a8322a';
const HEARTH = {
  left: 0.46,
  right: 0.96,
  top: 0.22,
  bottom: 0.92,
  openLeft: 0.56,
  openRight: 0.86,
  openTop: 0.46,
} as const;
const HEARTH_COURSE_YS = [0.36, 0.52, 0.68, 0.84] as const;
/** The fire's warmth spills out round the hearth's lower half. */
const HEARTH_GLOW = { cy: 0.72, r: 0.4 } as const;
const HEARTH_FIRE = { lift: 0.04, halfWidth: 0.11, height: 0.3 } as const;
const MANTEL = { overhangLeft: 0.04, overhangRight: 0.02, rise: 0.06, depth: 0.02, corner: 0.01 };
const HEARTH_BED = { left: 0.02, right: 0.58, top: 0.66, floor: 0.92, headboardTop: 0.46 } as const;

const paintRoomHearth: IconArtPainter = (ctx, px) => {
  const openingCx = (HEARTH.openLeft + HEARTH.openRight) / 2;
  const openingHalf = (HEARTH.openRight - HEARTH.openLeft) / 2;
  paintGlow(ctx, openingCx, HEARTH_GLOW.cy, HEARTH_GLOW.r, FLAME_YELLOW);
  const chimney = rectPoints(HEARTH.left, HEARTH.top, HEARTH.right, HEARTH.bottom);
  paintLitPoints(ctx, px, chimney, HEARTH_STONE);
  paintCourses(ctx, px, chimney, HEARTH_COURSE_YS, tone(HEARTH_STONE, DEEP_SHADE));
  paintForm(
    ctx,
    px,
    () => traceArchedDoor(ctx, openingCx, openingHalf, HEARTH.openTop, HEARTH.bottom),
    DOORWAY_DARK,
  );
  const fireBase = HEARTH.bottom - HEARTH_FIRE.lift;
  paintFlame(ctx, px, openingCx, fireBase, HEARTH_FIRE.halfWidth, HEARTH_FIRE.height, false);
  paintLitRect(
    ctx,
    px,
    HEARTH.left - MANTEL.overhangLeft,
    HEARTH.top - MANTEL.rise,
    HEARTH.right + MANTEL.overhangRight,
    HEARTH.top + MANTEL.depth,
    DARK_WOOD,
    MANTEL.corner,
  );
  paintBed(ctx, px, { ...HEARTH_BED, frame: OAK, blanket: HEARTH_BLANKET });
};

const VELVET_PURPLE = '#6a4a9a';
const GILT_FRAME = '#b08a3a';
const CAT_ORANGE = '#e0903a';
const FEATHER_BED = {
  left: 0.04,
  right: 0.96,
  top: 0.58,
  floor: 0.92,
  headboardTop: 0.24,
} as const;
/** A ginger cat curled nose-to-tail on the pillow. */
const CAT = { cx: 0.32, cy: 0.42, rx: 0.17, ry: 0.1 } as const;
/** The head is a touch wider than tall, tucked down against the body. */
const CAT_HEAD = { cx: 0.2, cy: 0.38, rx: 0.075, ry: 0.064 } as const;
const CAT_EARS: readonly (readonly IconPoint[])[] = [
  [
    [0.14, 0.36],
    [0.13, 0.27],
    [0.19, 0.32],
  ],
  [
    [0.21, 0.31],
    [0.27, 0.27],
    [0.27, 0.35],
  ],
];
const CAT_TAIL: readonly IconPoint[] = [
  [0.47, 0.44],
  [0.44, 0.52, 0.06],
  [0.2, 0.48],
];
const CAT_TAIL_WIDTH = 4.5;
const CAT_STRIPES: readonly (readonly IconPoint[])[] = [
  [
    [0.3, 0.33],
    [0.32, 0.4],
  ],
  [
    [0.38, 0.34],
    [0.4, 0.41],
  ],
];
const CAT_STRIPE_WIDTH = 2;
/** Shut eyes: two short dark lids. */
const CAT_EYE_LIDS: readonly (readonly IconPoint[])[] = [
  [
    [0.16, 0.38],
    [0.19, 0.39],
  ],
  [
    [0.22, 0.385],
    [0.25, 0.38],
  ],
];
const CAT_LID_WIDTH = 1.3;
const BEDPOST_GLINT = { x: 0.84, y: 0.48, r: 0.04 } as const;

const paintRoomCatsOwn: IconArtPainter = (ctx, px) => {
  paintBed(ctx, px, {
    ...FEATHER_BED,
    frame: GILT_FRAME,
    blanket: VELVET_PURPLE,
    plush: true,
  });
  paintLitEllipse(ctx, px, CAT.cx, CAT.cy, CAT.rx, CAT.ry, CAT_ORANGE);
  for (const stripe of CAT_STRIPES)
    strokeDetail(ctx, px, stripe, tone(CAT_ORANGE, DEEP_SHADE), CAT_STRIPE_WIDTH);
  for (const ear of CAT_EARS) paintLitPoints(ctx, px, ear, CAT_ORANGE);
  paintLitEllipse(ctx, px, CAT_HEAD.cx, CAT_HEAD.cy, CAT_HEAD.rx, CAT_HEAD.ry, CAT_ORANGE);
  for (const lid of CAT_EYE_LIDS) strokeDetail(ctx, px, lid, ICON_OUTLINE, CAT_LID_WIDTH);
  strokeOutlined(ctx, px, CAT_TAIL, CAT_ORANGE, CAT_TAIL_WIDTH);
  glint(ctx, BEDPOST_GLINT.x, BEDPOST_GLINT.y, BEDPOST_GLINT.r, GOLD);
};

const TOWN_STONE = '#b0a28a';
const TOWN_ROOF = '#9a3a2a';
const SLATE = '#4a5468';
const WINDOW_LIGHT = '#ffd86a';
const CLOCK_FACE = '#f2ead2';
const TOWER = {
  left: 0.38,
  right: 0.62,
  top: 0.28,
  bottom: 0.92,
  spireTop: 0.04,
  clockCy: 0.4,
  clockR: 0.075,
} as const;
/** A roof hangs past the walls it covers by this much on each side, and sits this far onto them. */
const EAVE_OVERHANG = 0.03;
const EAVE_DROP = 0.01;
/** The houses' walls stand this far in from their roofs' eaves. */
const HOUSE_WALL_INSET = 0.02;
/** The far house's roof is in a little more shadow than the near one's. */
const FAR_ROOF_SHADE = -0.15;
interface House {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly peak: number;
  readonly roof: string;
}
const HOUSES: readonly House[] = [
  { left: 0.04, right: 0.36, top: 0.56, peak: 0.36, roof: TOWN_ROOF },
  { left: 0.64, right: 0.96, top: 0.6, peak: 0.42, roof: tone(TOWN_ROOF, FAR_ROOF_SHADE) },
];
const TOWN_WINDOWS: readonly (readonly [number, number])[] = [
  [0.14, 0.7],
  [0.26, 0.7],
  [0.74, 0.72],
  [0.86, 0.72],
  [0.5, 0.62],
];
const WINDOW_HALF_WIDTH = 0.03;
const WINDOW_HALF_HEIGHT = 0.042;
const CLOCK_MINUTE_REACH = 0.75;
const CLOCK_HOUR_REACH = 0.55;
const CLOCK_HOUR_DROP = 0.01;
const CLOCK_HAND_WIDTH = 1.6;
const TOWER_DOOR = { half: 0.05, top: 0.8, corner: 0.04 } as const;
const GROUND_LINE: readonly IconPoint[] = [
  [0.02, TOWER.bottom],
  [0.98, TOWER.bottom],
];
const GROUND_WIDTH = 2;

function paintClock(ctx: CanvasRenderingContext2D, px: number, cx: number): void {
  const { clockCy, clockR } = TOWER;
  paintLitEllipse(ctx, px, cx, clockCy, clockR, clockR, CLOCK_FACE);
  const hands: readonly (readonly IconPoint[])[] = [
    [
      [cx, clockCy],
      [cx, clockCy - clockR * CLOCK_MINUTE_REACH],
    ],
    [
      [cx, clockCy],
      [cx + clockR * CLOCK_HOUR_REACH, clockCy + CLOCK_HOUR_DROP],
    ],
  ];
  for (const hand of hands) strokeDetail(ctx, px, hand, ICON_OUTLINE, CLOCK_HAND_WIDTH);
}

const paintTravelTown: IconArtPainter = (ctx, px) => {
  const { left, right, top, bottom } = TOWER;
  const cx = (left + right) / 2;
  paintLitRect(ctx, px, left, top, right, bottom, TOWN_STONE);
  const spire: readonly IconPoint[] = [
    [left - EAVE_OVERHANG, top + EAVE_DROP],
    [cx, TOWER.spireTop],
    [right + EAVE_OVERHANG, top + EAVE_DROP],
  ];
  paintLitPoints(ctx, px, spire, SLATE);
  for (const house of HOUSES) {
    const houseCx = (house.left + house.right) / 2;
    const wallLeft = house.left + HOUSE_WALL_INSET;
    const wallRight = house.right - HOUSE_WALL_INSET;
    paintLitRect(ctx, px, wallLeft, house.top, wallRight, bottom, TOWN_STONE);
    const roof: readonly IconPoint[] = [
      [house.left, house.top + HOUSE_WALL_INSET],
      [houseCx, house.peak],
      [house.right, house.top + HOUSE_WALL_INSET],
    ];
    paintLitPoints(ctx, px, roof, house.roof);
  }
  paintClock(ctx, px, cx);
  for (const [windowX, windowY] of TOWN_WINDOWS) {
    const pane = rectPoints(
      windowX - WINDOW_HALF_WIDTH,
      windowY - WINDOW_HALF_HEIGHT,
      windowX + WINDOW_HALF_WIDTH,
      windowY + WINDOW_HALF_HEIGHT,
    );
    paintForm(ctx, px, () => tracePoints(ctx, pane), WINDOW_LIGHT);
  }
  const door = TOWER_DOOR;
  paintLitRect(ctx, px, cx - door.half, door.top, cx + door.half, bottom, DARK_WOOD, door.corner);
  strokeDetail(ctx, px, GROUND_LINE, ICON_OUTLINE, GROUND_WIDTH);
};

const TENT_RED = '#c8322a';
const TENT_WHITE = '#f2ece0';
const PENNANT = '#e8c040';
const TENT = {
  peakX: 0.5,
  peakY: 0.14,
  eaveY: 0.48,
  eaveLeft: 0.12,
  eaveRight: 0.88,
  baseLeft: 0.08,
  baseRight: 0.92,
  baseY: 0.88,
} as const;
/** The canvas sags between pole and eave: each slope bows through this control point's height. */
const TENT_SAG_Y = 0.36;
const TENT_SAG_REACH = 0.12;
const TENT_STRIPES = 8;
const VALANCE_SCALLOPS = 6;
const VALANCE_R = 0.065;
const FLAGPOLE_TOP = 0.03;
const FLAGPOLE_WIDTH = 2.5;
const PENNANT_SHAPE: readonly IconPoint[] = [
  [0.5, 0.03],
  [0.68, 0.07],
  [0.5, 0.11],
];
const TENT_ENTRANCE: readonly IconPoint[] = [
  [0.5, 0.6],
  [0.6, 0.9],
  [0.4, 0.9],
];
/** The round tent turns away from the light: a pale sheen on the left, shadow on the right. */
const TENT_SHEEN = '#ffffff33';
const TENT_CLEAR = '#00000000';
const TENT_SHADOW = '#0000004d';
const TENT_SHEEN_UNTIL = 0.3;
const TENT_CLEAR_UNTIL = 0.6;
const TENT_GLINT = { x: 0.42, y: 0.26, r: 0.04 } as const;

function traceTent(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(TENT.peakX, TENT.peakY);
  ctx.quadraticCurveTo(TENT.peakX + TENT_SAG_REACH, TENT_SAG_Y, TENT.eaveRight, TENT.eaveY);
  ctx.lineTo(TENT.baseRight, TENT.baseY);
  ctx.lineTo(TENT.baseLeft, TENT.baseY);
  ctx.lineTo(TENT.eaveLeft, TENT.eaveY);
  ctx.quadraticCurveTo(TENT.peakX - TENT_SAG_REACH, TENT_SAG_Y, TENT.peakX, TENT.peakY);
  ctx.closePath();
}

function paintTentStripes(ctx: CanvasRenderingContext2D): void {
  const span = (TENT.baseRight - TENT.baseLeft) / TENT_STRIPES;
  for (let stripe = 0; stripe < TENT_STRIPES; stripe += 2) {
    const footLeft = TENT.baseLeft + stripe * span;
    tracePoints(ctx, [
      [TENT.peakX, TENT.peakY],
      [footLeft + span, 1],
      [footLeft, 1],
    ]);
    ctx.fillStyle = TENT_RED;
    ctx.fill();
  }
  ctx.fillStyle = bandedFill(
    ctx,
    [0, 0],
    [1, 0],
    [
      [TENT_SHEEN, TENT_SHEEN_UNTIL],
      [TENT_CLEAR, TENT_CLEAR_UNTIL],
      [TENT_SHADOW, 1],
    ],
  );
  ctx.fillRect(0, 0, 1, 1);
  tracePoints(ctx, TENT_ENTRANCE);
  ctx.fillStyle = DOORWAY_DARK;
  ctx.fill();
}

const paintTravelCircus: IconArtPainter = (ctx, px) => {
  const pole: readonly IconPoint[] = [
    [TENT.peakX, TENT.peakY],
    [TENT.peakX, FLAGPOLE_TOP],
  ];
  strokeDetail(ctx, px, pole, ICON_OUTLINE, FLAGPOLE_WIDTH);
  paintForm(ctx, px, () => tracePoints(ctx, PENNANT_SHAPE), PENNANT);
  paintForm(ctx, px, () => traceTent(ctx), TENT_WHITE);
  withShapeClip(
    ctx,
    () => traceTent(ctx),
    () => paintTentStripes(ctx),
  );
  const valanceSpan = (TENT.eaveRight - TENT.eaveLeft) / VALANCE_SCALLOPS;
  for (let scallop = 0; scallop < VALANCE_SCALLOPS; scallop++) {
    const scallopX = TENT.eaveLeft + valanceSpan * (scallop + ICON_CENTER);
    const traceScallop = (): void => {
      ctx.beginPath();
      ctx.arc(scallopX, TENT.eaveY, VALANCE_R, 0, Math.PI);
      ctx.closePath();
    };
    paintForm(ctx, px, traceScallop, scallop % 2 === 0 ? PENNANT : TENT_RED);
  }
  glint(ctx, TENT_GLINT.x, TENT_GLINT.y, TENT_GLINT.r);
};

const THATCH = '#d0a24a';
const WATTLE = '#8a6038';
const BRIAR = '#3a5a2a';
const BERRY = '#b8203a';
const HUT = {
  left: 0.26,
  right: 0.74,
  wallTop: 0.56,
  bottom: 0.86,
  doorHalf: 0.07,
  doorTop: 0.66,
} as const;
const HUT_WATTLE_YS = [0.66, 0.76] as const;
const THATCH_ROOF: readonly IconPoint[] = [
  [0.5, 0.12, 0.04],
  [0.88, 0.6, 0.06],
  [0.12, 0.6, 0.06],
];
const THATCH_STREAKS: readonly (readonly IconPoint[])[] = [
  [
    [0.5, 0.18],
    [0.32, 0.58],
  ],
  [
    [0.5, 0.18],
    [0.5, 0.58],
  ],
  [
    [0.5, 0.18],
    [0.68, 0.58],
  ],
];
/** The thatch's trimmed lower edge, a darker band just above the eave. */
const THATCH_EAVE: readonly IconPoint[] = [
  [0.1, 0.54],
  [0.9, 0.54],
];
const THATCH_EAVE_WIDTH = 2;
const BRAMBLES: readonly (readonly IconPoint[])[] = [
  [
    [0, 0.96],
    [0.14, 0.7, 0.1],
    [0.3, 0.92],
  ],
  [
    [0.06, 0.98],
    [0.04, 0.74, 0.08],
    [0.18, 0.62],
  ],
  [
    [1, 0.94],
    [0.86, 0.68, 0.1],
    [0.7, 0.9],
  ],
  [
    [0.94, 0.98],
    [0.98, 0.72, 0.08],
    [0.84, 0.6],
  ],
];
const BRAMBLE_WIDTH = 3;
/** Each thorn: where it grows on a stem, and the angle it points. */
const THORNS: readonly (readonly [x: number, y: number, angle: number])[] = [
  [0.1, 0.74, -2.4],
  [0.22, 0.76, -0.6],
  [0.06, 0.8, 3],
  [0.9, 0.72, -0.7],
  [0.78, 0.76, -2.5],
  [0.96, 0.8, 0.2],
];
const THORN_LENGTH = 0.05;
const THORN_BASE_HALF = 0.015;
/** The thorn's base corners sit nearly square to the way it points. */
const THORN_BASE_SPREAD = 1.4;
const BERRIES: readonly (readonly [number, number])[] = [
  [0.16, 0.66],
  [0.88, 0.64],
  [0.27, 0.86],
];
const BERRY_R = 0.03;

function thornPoints(x: number, y: number, angle: number): readonly IconPoint[] {
  const corner = (turn: number, reach: number): IconPoint => [
    x + Math.cos(angle + turn) * reach,
    y + Math.sin(angle + turn) * reach,
  ];
  return [
    corner(THORN_BASE_SPREAD, THORN_BASE_HALF),
    corner(0, THORN_LENGTH),
    corner(-THORN_BASE_SPREAD, THORN_BASE_HALF),
  ];
}

const paintTravelBriarHollow: IconArtPainter = (ctx, px) => {
  const wall = rectPoints(HUT.left, HUT.wallTop, HUT.right, HUT.bottom);
  paintLitPoints(ctx, px, wall, WATTLE);
  paintCourses(ctx, px, wall, HUT_WATTLE_YS, tone(WATTLE, DEEP_SHADE));
  paintForm(
    ctx,
    px,
    () => traceArchedDoor(ctx, ICON_CENTER, HUT.doorHalf, HUT.doorTop, HUT.bottom),
    DOORWAY_DARK,
  );
  paintLitPoints(ctx, px, THATCH_ROOF, THATCH);
  withShapeClip(
    ctx,
    () => tracePoints(ctx, THATCH_ROOF),
    () => {
      for (const streak of THATCH_STREAKS)
        strokeDetail(ctx, px, streak, tone(THATCH, SHADE), SEAM_WIDTH);
      strokeDetail(ctx, px, THATCH_EAVE, tone(THATCH, DEEP_SHADE), THATCH_EAVE_WIDTH);
    },
  );
  for (const bramble of BRAMBLES) strokeOutlined(ctx, px, bramble, BRIAR, BRAMBLE_WIDTH);
  for (const [thornX, thornY, angle] of THORNS) {
    const thorn = thornPoints(thornX, thornY, angle);
    paintForm(ctx, px, () => tracePoints(ctx, thorn), tone(BRIAR, LIGHT));
  }
  for (const [berryX, berryY] of BERRIES)
    paintLitEllipse(ctx, px, berryX, berryY, BERRY_R, BERRY_R, BERRY);
};

export const PLACE_SERVICE_ICONS = {
  hayloft: toIcon(paintHayloft),
  room_attic: toIcon(paintRoomAttic),
  room_hearth: toIcon(paintRoomHearth),
  room_cats_own: toIcon(paintRoomCatsOwn),
  travel_town: toIcon(paintTravelTown),
  travel_circus: toIcon(paintTravelCircus),
  travel_briar_hollow: toIcon(paintTravelBriarHollow),
} as const;
