/**
 * Icons for the gear worn on the head: hats, face pieces and neck pieces.
 *
 * Every piece has its own silhouette, so two hats are told apart by shape
 * before colour: the hardhat is a domed shell on a brim, the top hat a tall
 * crown, the cap a cone, the hood has ears, the crest is a helm seen side-on.
 * Colours are the materials the pieces are made of, never their rarity.
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
  ICON_CENTER,
  ICON_OUTLINE,
  type IconPoint,
  litFill,
  MEDIUM_DETAIL,
  outlineWidth,
  paintForm,
  paintIconArt,
  rivet,
  strokeDetail,
  tone,
  traceEllipse,
  tracePoints,
  tracePolyline,
  withShapeClip,
} from './iconPaint';

export type GearHeadIconId =
  | 'foremans_hardhat'
  | 'hazard_goggles'
  | 'stargazers_cap'
  | 'moonmoth_pendant'
  | 'kaleidoscope_specs'
  | 'halo_of_the_ninth_life'
  | 'prowler_hood'
  | 'hearthguard_cap'
  | 'cockscomb_crest'
  | 'stoneheart_amulet'
  | 'sun_locket'
  | 'moon_locket'
  | 'showmans_top_hat'
  | 'gilded_monocle'
  | 'grinning_mask'
  | 'hushed_bell';

type Painter = (ctx: CanvasRenderingContext2D, px: number) => void;
type Point = readonly [number, number];
/** A glint or spark: centre and arm reach. */
type Spark = readonly [x: number, y: number, r: number];
type Polyline = readonly IconPoint[];

const LIGHT_FROM: Point = [0.15, 0.1];
const LIGHT_TO: Point = [0.85, 0.9];
const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;

const GOLD = '#d4a232';
const SILVER = '#b9c0c8';
const STEEL = '#8a929c';
const LEATHER = '#6e4a2c';

/** How far a seam, scratch or engraving is pushed from its base colour. */
const ENGRAVED = -0.45;
const SCRATCHED = 0.55;
/** A part that sits behind or under the main form is a step darker so the two separate. */
const SET_BACK = -0.15;
/** A rim or band that catches more light than the form it wraps. */
const RAISED = 0.15;
const LIT_EDGE = 0.35;

/** A cord or chain is drawn as an outline with the material laid down its middle. */
const CORD_OUTLINE_SCALE = 1.6;
const CHAIN_LINK_DASH = 0.035;

function paintCord(
  ctx: CanvasRenderingContext2D,
  px: number,
  points: Polyline,
  color: string,
  linked: boolean,
): void {
  tracePolyline(ctx, points);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = outlineWidth(px) * CORD_OUTLINE_SCALE + hairlineWidth(px) * BOLD_DETAIL;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = hairlineWidth(px) * BOLD_DETAIL;
  ctx.stroke();
  if (!linked) return;
  ctx.save();
  ctx.setLineDash([CHAIN_LINK_DASH, CHAIN_LINK_DASH]);
  ctx.strokeStyle = tone(color, ENGRAVED);
  ctx.lineWidth = hairlineWidth(px);
  ctx.stroke();
  ctx.restore();
}

function ellipseForm(
  ctx: CanvasRenderingContext2D,
  px: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: string | CanvasGradient,
): void {
  paintForm(ctx, px, () => traceEllipse(ctx, cx, cy, rx, ry), fill);
}

/** Paints `paint` at `alpha` times the current opacity. */
function withAlpha(ctx: CanvasRenderingContext2D, alpha: number, paint: () => void): void {
  const baseAlpha = ctx.globalAlpha;
  ctx.globalAlpha = baseAlpha * alpha;
  paint();
  ctx.globalAlpha = baseAlpha;
}

function glints(ctx: CanvasRenderingContext2D, sparks: readonly Spark[], color?: string): void {
  for (const [x, y, r] of sparks) glint(ctx, x, y, r, color);
}

const STAR_POINTS = 5;
const STAR_WAIST = 0.45;
function appendStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const corners: IconPoint[] = [];
  for (let i = 0; i < STAR_POINTS * 2; i++) {
    const angle = -QUARTER_TURN + (i / (STAR_POINTS * 2)) * FULL_TURN;
    const reach = i % 2 === 0 ? r : r * STAR_WAIST;
    corners.push([cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach]);
  }
  appendPoints(ctx, corners);
}

/** The upper half of a circle, closed along its diameter: a dome. */
function traceDome(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, HALF_TURN, FULL_TURN);
  ctx.closePath();
}

// ── Foreman's Hardhat ──────────────────────────────────────────────────
const HARDHAT_YELLOW = '#e8b81e';
const HARDHAT_BRIM_SHADE = -0.08;
const HARDHAT_DOME_CY = 0.64;
const HARDHAT_DOME_R = 0.33;
const HARDHAT_BRIM: Polyline = [
  [0.05, 0.62, 0.04],
  [0.95, 0.62, 0.04],
  [0.92, 0.76, 0.05],
  [0.08, 0.76, 0.05],
];
const HARDHAT_RIDGE: Polyline = [
  [0.44, 0.34, 0.03],
  [0.56, 0.34, 0.03],
  [0.57, 0.64],
  [0.43, 0.64],
];
const HARDHAT_RIDGE_FROM: Point = [0.44, 0];
const HARDHAT_RIDGE_TO: Point = [0.56, 0];
const HARDHAT_RIDGE_SPLIT = 0.5;
const HARDHAT_RIDGE_SHADE = -0.2;
const HARDHAT_SCUFFS: readonly Polyline[] = [
  [
    [0.27, 0.5],
    [0.33, 0.46],
  ],
  [
    [0.66, 0.42],
    [0.72, 0.47],
  ],
  [
    [0.22, 0.69],
    [0.3, 0.69],
  ],
];
/** The tally of finished jobs scratched into the brim. */
const HARDHAT_TALLY_X = [0.62, 0.66, 0.7, 0.74] as const;
const HARDHAT_TALLY_TOP = 0.665;
const HARDHAT_TALLY_BOTTOM = 0.715;
const HARDHAT_GLINT: Spark = [0.32, 0.4, 0.06];

const paintHardhat: Painter = (ctx, px) => {
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, HARDHAT_BRIM),
    litFill(ctx, tone(HARDHAT_YELLOW, HARDHAT_BRIM_SHADE), LIGHT_FROM, LIGHT_TO),
  );
  paintForm(
    ctx,
    px,
    () => traceDome(ctx, ICON_CENTER, HARDHAT_DOME_CY, HARDHAT_DOME_R),
    litFill(ctx, HARDHAT_YELLOW, LIGHT_FROM, LIGHT_TO),
  );
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, HARDHAT_RIDGE),
    bandedFill(ctx, HARDHAT_RIDGE_FROM, HARDHAT_RIDGE_TO, [
      [tone(HARDHAT_YELLOW, LIT_EDGE), HARDHAT_RIDGE_SPLIT],
      [tone(HARDHAT_YELLOW, HARDHAT_RIDGE_SHADE), 1],
    ]),
  );
  for (const scuff of HARDHAT_SCUFFS) strokeDetail(ctx, px, scuff, tone(HARDHAT_YELLOW, SCRATCHED));
  for (const x of HARDHAT_TALLY_X) {
    const tally: Polyline = [
      [x, HARDHAT_TALLY_TOP],
      [x, HARDHAT_TALLY_BOTTOM],
    ];
    strokeDetail(ctx, px, tally, tone(HARDHAT_YELLOW, ENGRAVED));
  }
  glints(ctx, [HARDHAT_GLINT]);
};

// ── Hazard Goggles ─────────────────────────────────────────────────────
/**
 * Welding goggles are told from the Kaleidoscope Specs by the broad rubber
 * strap running edge to edge behind deep steel cups; the specs have no strap.
 */
const GOGGLE_RUBBER = '#2b2724';
const GOGGLE_AMBER = '#e08a1c';
const GOGGLE_STRAP: Polyline = [
  [0, 0.42],
  [0.5, 0.38],
  [1, 0.42],
  [1, 0.64],
  [0.5, 0.6],
  [0, 0.64],
];
const GOGGLE_STRAP_FROM: Point = [0, 0.38];
const GOGGLE_STRAP_TO: Point = [0, 0.64];
const GOGGLE_BUCKLE: Polyline = [
  [0.02, 0.4, 0.01],
  [0.09, 0.4, 0.01],
  [0.09, 0.66, 0.01],
  [0.02, 0.66, 0.01],
];
const GOGGLE_LEFT_X = 0.31;
const GOGGLE_RIGHT_X = 0.69;
const GOGGLE_Y = 0.5;
const GOGGLE_CUP_R = 0.18;
const GOGGLE_LENS_R = 0.12;
const GOGGLE_LENS_LIT_UNTIL = 0.3;
const GOGGLE_LENS_MID_UNTIL = 0.65;
const GOGGLE_LENS_LIT = 0.4;
const GOGGLE_LENS_SHADE = -0.35;
const GOGGLE_GLINT_OFFSET = 0.4;
const GOGGLE_GLINT_R = 0.05;
const GOGGLE_CRACKS: readonly Polyline[] = [
  [
    [0.14, 0.44],
    [0.15, 0.5],
  ],
  [
    [0.9, 0.44],
    [0.88, 0.52],
  ],
];
const GOGGLE_CRACK_LIFT = 0.35;

function paintGoggleCup(ctx: CanvasRenderingContext2D, px: number, cx: number): void {
  const cupFrom: Point = [cx - GOGGLE_CUP_R, GOGGLE_Y - GOGGLE_CUP_R];
  const cupTo: Point = [cx + GOGGLE_CUP_R, GOGGLE_Y + GOGGLE_CUP_R];
  ellipseForm(
    ctx,
    px,
    cx,
    GOGGLE_Y,
    GOGGLE_CUP_R,
    GOGGLE_CUP_R,
    litFill(ctx, STEEL, cupFrom, cupTo),
  );
  const lensFrom: Point = [cx - GOGGLE_LENS_R, GOGGLE_Y - GOGGLE_LENS_R];
  const lensTo: Point = [cx + GOGGLE_LENS_R, GOGGLE_Y + GOGGLE_LENS_R];
  ellipseForm(
    ctx,
    px,
    cx,
    GOGGLE_Y,
    GOGGLE_LENS_R,
    GOGGLE_LENS_R,
    bandedFill(ctx, lensFrom, lensTo, [
      [tone(GOGGLE_AMBER, GOGGLE_LENS_LIT), GOGGLE_LENS_LIT_UNTIL],
      [GOGGLE_AMBER, GOGGLE_LENS_MID_UNTIL],
      [tone(GOGGLE_AMBER, GOGGLE_LENS_SHADE), 1],
    ]),
  );
  const glintReach = GOGGLE_LENS_R * GOGGLE_GLINT_OFFSET;
  glint(ctx, cx - glintReach, GOGGLE_Y - glintReach, GOGGLE_GLINT_R);
}

const paintGoggles: Painter = (ctx, px) => {
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, GOGGLE_STRAP),
    litFill(ctx, GOGGLE_RUBBER, GOGGLE_STRAP_FROM, GOGGLE_STRAP_TO),
  );
  for (const crack of GOGGLE_CRACKS)
    strokeDetail(ctx, px, crack, tone(GOGGLE_RUBBER, GOGGLE_CRACK_LIFT));
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, GOGGLE_BUCKLE),
    litFill(ctx, STEEL, LIGHT_FROM, LIGHT_TO),
  );
  paintGoggleCup(ctx, px, GOGGLE_LEFT_X);
  paintGoggleCup(ctx, px, GOGGLE_RIGHT_X);
};

// ── Stargazer's Cap ────────────────────────────────────────────────────
const CAP_INDIGO = '#3a3a8c';
const STARGAZER_BAND_SHADE = -0.2;
const STARGAZER_CONE: Polyline = [
  [0.14, 0.8],
  [0.32, 0.44],
  [0.48, 0.2, 0.06],
  [0.66, 0.08],
  [0.88, 0.14, 0.04],
  [0.78, 0.2],
  [0.66, 0.24, 0.05],
  [0.66, 0.44],
  [0.86, 0.8],
];
const STARGAZER_BAND: Polyline = [
  [0.1, 0.74, 0.04],
  [0.9, 0.74, 0.04],
  [0.92, 0.9, 0.04],
  [0.08, 0.9, 0.04],
];
const STARGAZER_BAND_FROM: Point = [0.1, 0.74];
const STARGAZER_BAND_TO: Point = [0.9, 0.9];
const STARGAZER_TRIM: Polyline = [
  [0.12, 0.82],
  [0.88, 0.82],
];
const STARGAZER_STARS: readonly Spark[] = [
  [0.44, 0.52, 0.07],
  [0.62, 0.62, 0.05],
  [0.56, 0.36, 0.045],
  [0.34, 0.66, 0.04],
];
const STARGAZER_TIP: Point = [0.88, 0.14];
const STARGAZER_TIP_R = 0.06;
const STARGAZER_GLINT: Spark = [0.44, 0.52, 0.06];

const paintStargazerCap: Painter = (ctx, px) => {
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, STARGAZER_CONE),
    litFill(ctx, CAP_INDIGO, LIGHT_FROM, LIGHT_TO),
  );
  ctx.beginPath();
  for (const [x, y, r] of STARGAZER_STARS) appendStar(ctx, x, y, r);
  ctx.fillStyle = SILVER;
  ctx.fill();
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, STARGAZER_BAND),
    litFill(ctx, tone(CAP_INDIGO, STARGAZER_BAND_SHADE), STARGAZER_BAND_FROM, STARGAZER_BAND_TO),
  );
  strokeDetail(ctx, px, STARGAZER_TRIM, SILVER, MEDIUM_DETAIL);
  ellipseForm(
    ctx,
    px,
    STARGAZER_TIP[0],
    STARGAZER_TIP[1],
    STARGAZER_TIP_R,
    STARGAZER_TIP_R,
    SILVER,
  );
  glints(ctx, [STARGAZER_GLINT]);
};

// ── Moonmoth Pendant ───────────────────────────────────────────────────
const MOTH_WING = '#e6ddc8';
const MOTH_EYE = '#8c7fb4';
interface Wing {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly tilt: number;
}
const FOREWING_TILT = 0.5;
const HINDWING_TILT = -0.5;
const MOTH_WINGS: readonly Wing[] = [
  { cx: 0.3, cy: 0.5, rx: 0.22, ry: 0.15, tilt: FOREWING_TILT },
  { cx: 0.7, cy: 0.5, rx: 0.22, ry: 0.15, tilt: -FOREWING_TILT },
  { cx: 0.35, cy: 0.74, rx: 0.15, ry: 0.11, tilt: HINDWING_TILT },
  { cx: 0.65, cy: 0.74, rx: 0.15, ry: 0.11, tilt: -HINDWING_TILT },
];
const MOTH_EYES: readonly Point[] = [
  [0.28, 0.5],
  [0.72, 0.5],
];
const MOTH_EYE_R = 0.045;
const MOTH_PUPIL_SHARE = 0.5;
const MOTH_BODY: Polyline = [
  [0.47, 0.42, 0.03],
  [0.53, 0.42, 0.03],
  [0.535, 0.82, 0.03],
  [0.465, 0.82, 0.03],
];
const MOTH_BODY_FROM: Point = [0.47, 0.4];
const MOTH_BODY_TO: Point = [0.53, 0.82];
const MOTH_ANTENNAE: readonly Polyline[] = [
  [
    [0.49, 0.43],
    [0.42, 0.33],
  ],
  [
    [0.51, 0.43],
    [0.58, 0.33],
  ],
];
const MOTH_CHAINS: readonly Polyline[] = [
  [
    [0.14, 0],
    [0.5, 0.4],
  ],
  [
    [0.86, 0],
    [0.5, 0.4],
  ],
];
const MOTH_GLINT: Spark = [0.22, 0.44, 0.05];

function traceWing(ctx: CanvasRenderingContext2D, wing: Wing): void {
  ctx.beginPath();
  ctx.ellipse(wing.cx, wing.cy, wing.rx, wing.ry, wing.tilt, 0, FULL_TURN);
}

const paintMoonmoth: Painter = (ctx, px) => {
  for (const chain of MOTH_CHAINS) paintCord(ctx, px, chain, SILVER, true);
  for (const wing of MOTH_WINGS) {
    const from: Point = [wing.cx - wing.rx, wing.cy - wing.ry];
    const to: Point = [wing.cx + wing.rx, wing.cy + wing.ry];
    paintForm(ctx, px, () => traceWing(ctx, wing), litFill(ctx, MOTH_WING, from, to));
  }
  for (const [x, y] of MOTH_EYES) {
    disc(ctx, x, y, MOTH_EYE_R, MOTH_EYE);
    disc(ctx, x, y, MOTH_EYE_R * MOTH_PUPIL_SHARE, ICON_OUTLINE);
  }
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, MOTH_BODY),
    litFill(ctx, SILVER, MOTH_BODY_FROM, MOTH_BODY_TO),
  );
  for (const antenna of MOTH_ANTENNAE) strokeDetail(ctx, px, antenna, ICON_OUTLINE);
  glints(ctx, [MOTH_GLINT]);
};

// ── Kaleidoscope Specs ─────────────────────────────────────────────────
const SPECS_RIM = '#c79a3a';
const SPECS_LEFT_X = 0.28;
const SPECS_RIGHT_X = 0.72;
const SPECS_Y = 0.54;
const SPECS_RIM_R = 0.2;
const SPECS_LENS_R = 0.165;
const PRISM_BANDS = ['#e8505a', '#f09a3a', '#f2d84a', '#5cc46a', '#4a8ee0', '#9a62d6'] as const;
const SPECS_BRIDGE: Polyline = [
  [0.44, 0.5],
  [0.5, 0.44, 0.05],
  [0.56, 0.5],
];
/** The arms are short stubs folded back behind the rims, the way glasses sit seen from the front. */
const SPECS_ARMS: readonly Polyline[] = [
  [
    [0.09, 0.5],
    [0.02, 0.5],
  ],
  [
    [0.91, 0.5],
    [0.98, 0.5],
  ],
];
const SPECS_GLINT_OFFSET = 0.4;
const SPECS_GLINT_R = 0.06;
/** The coloured glints the lenses throw on the wall around them. */
const SPECS_THROWN: readonly (readonly [x: number, y: number, r: number, color: string])[] = [
  [0.18, 0.18, 0.07, '#f2d84a'],
  [0.5, 0.2, 0.06, '#5cc46a'],
  [0.82, 0.18, 0.07, '#e8505a'],
  [0.5, 0.86, 0.06, '#4a8ee0'],
];

function paintPrismLens(ctx: CanvasRenderingContext2D, px: number, cx: number): void {
  ellipseForm(
    ctx,
    px,
    cx,
    SPECS_Y,
    SPECS_RIM_R,
    SPECS_RIM_R,
    litFill(ctx, SPECS_RIM, LIGHT_FROM, LIGHT_TO),
  );
  const step = 1 / PRISM_BANDS.length;
  const lensFrom: Point = [cx - SPECS_LENS_R, SPECS_Y - SPECS_LENS_R];
  const lensTo: Point = [cx + SPECS_LENS_R, SPECS_Y + SPECS_LENS_R];
  ellipseForm(
    ctx,
    px,
    cx,
    SPECS_Y,
    SPECS_LENS_R,
    SPECS_LENS_R,
    bandedFill(
      ctx,
      lensFrom,
      lensTo,
      PRISM_BANDS.map((color, i) => [color, (i + 1) * step]),
    ),
  );
  const glintReach = SPECS_LENS_R * SPECS_GLINT_OFFSET;
  glint(ctx, cx - glintReach, SPECS_Y - glintReach, SPECS_GLINT_R);
}

const paintKaleidoscopeSpecs: Painter = (ctx, px) => {
  for (const [x, y, r, color] of SPECS_THROWN) glint(ctx, x, y, r, color);
  for (const arm of SPECS_ARMS) paintCord(ctx, px, arm, SPECS_RIM, false);
  paintCord(ctx, px, SPECS_BRIDGE, SPECS_RIM, false);
  paintPrismLens(ctx, px, SPECS_LEFT_X);
  paintPrismLens(ctx, px, SPECS_RIGHT_X);
};

// ── Halo of the Ninth Life ─────────────────────────────────────────────
const HALO_CY = 0.46;
const HALO_OUTER_RX = 0.42;
const HALO_OUTER_RY = 0.19;
const HALO_INNER_RX = 0.3;
const HALO_INNER_RY = 0.1;
const HALO_GLOW = '#fff0a8';
const HALO_GLOW_ALPHA = 0.35;
const HALO_GLOW_GROW = 0.06;
/** The hole sits above centre so the near side of the ring shows thicker, the way a ring seen from above does. */
const HALO_HOLE_LIFT = 0.035;
const HALO_LIT_UNTIL = 0.3;
const HALO_MID_UNTIL = 0.7;
const HALO_LIT = 0.45;
const HALO_SHADE = -0.35;
const HALO_SPARKS: readonly Spark[] = [
  [0.14, 0.32, 0.08],
  [0.84, 0.62, 0.07],
  [0.5, 0.82, 0.06],
];

function traceHaloRing(ctx: CanvasRenderingContext2D, grow: number): void {
  const holeY = HALO_CY - HALO_HOLE_LIFT;
  const holeRx = Math.max(0, HALO_INNER_RX - grow);
  const holeRy = Math.max(0, HALO_INNER_RY - grow / 2);
  ctx.beginPath();
  ctx.ellipse(ICON_CENTER, HALO_CY, HALO_OUTER_RX + grow, HALO_OUTER_RY + grow, 0, 0, FULL_TURN);
  ctx.moveTo(ICON_CENTER + holeRx, holeY);
  ctx.ellipse(ICON_CENTER, holeY, holeRx, holeRy, 0, 0, FULL_TURN);
}

const paintHalo: Painter = (ctx, px) => {
  withAlpha(ctx, HALO_GLOW_ALPHA, () => {
    traceHaloRing(ctx, HALO_GLOW_GROW);
    ctx.fillStyle = HALO_GLOW;
    ctx.fill('evenodd');
  });
  traceHaloRing(ctx, 0);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = outlineWidth(px) * 2;
  ctx.stroke();
  ctx.fillStyle = bandedFill(
    ctx,
    [ICON_CENTER, HALO_CY - HALO_OUTER_RY],
    [ICON_CENTER, HALO_CY + HALO_OUTER_RY],
    [
      [tone(GOLD, HALO_LIT), HALO_LIT_UNTIL],
      [GOLD, HALO_MID_UNTIL],
      [tone(GOLD, HALO_SHADE), 1],
    ],
  );
  ctx.fill('evenodd');
  glints(ctx, HALO_SPARKS, HALO_GLOW);
};

// ── Prowler Hood ───────────────────────────────────────────────────────
const PROWLER_CHARCOAL = '#3b3d44';
const PROWLER_LINING = '#5a5d66';
const PROWLER_SHADOW = '#141417';
const PROWLER_STITCH = '#d2d6de';
const PROWLER_EYE = '#c8e05a';
/**
 * Ears rise from a crown that curves down between them; the cloth hugs the
 * cheeks, narrows at the neck and flares onto the shoulders.
 */
const PROWLER_HOOD: Polyline = [
  [0.04, 0.97, 0.03],
  [0.12, 0.84, 0.06],
  [0.27, 0.72, 0.06],
  [0.18, 0.5, 0.12],
  [0.2, 0.3],
  [0.16, 0.02, 0.02],
  [0.36, 0.2],
  [0.5, 0.15, 0.1],
  [0.64, 0.2],
  [0.84, 0.02, 0.02],
  [0.8, 0.3],
  [0.82, 0.5, 0.12],
  [0.73, 0.72, 0.06],
  [0.88, 0.84, 0.06],
  [0.96, 0.97, 0.03],
];
const PROWLER_INNER_EARS: readonly Polyline[] = [
  [
    [0.2, 0.1],
    [0.32, 0.22],
    [0.23, 0.29],
  ],
  [
    [0.8, 0.1],
    [0.68, 0.22],
    [0.77, 0.29],
  ],
];
const PROWLER_EAR_SHADE = -0.25;
/** The opening is about two fifths of the hood's width: a cat's face shape, not a doorway. */
const PROWLER_OPENING: Polyline = [
  [0.32, 0.4, 0.08],
  [0.5, 0.35, 0.12],
  [0.68, 0.4, 0.08],
  [0.65, 0.6, 0.1],
  [0.5, 0.69, 0.06],
  [0.35, 0.6, 0.1],
];
const PROWLER_LINING_WIDTH = 4;
const PROWLER_EYES: readonly Point[] = [
  [0.43, 0.5],
  [0.57, 0.5],
];
const PROWLER_EYE_RX = 0.035;
const PROWLER_EYE_RY = 0.025;
const PROWLER_EYE_GLINT_R = 0.045;
const PROWLER_FOLDS: readonly Polyline[] = [
  [
    [0.3, 0.76],
    [0.22, 0.92],
  ],
  [
    [0.7, 0.76],
    [0.78, 0.92],
  ],
];
const STITCH_DASH = 0.03;

const paintProwlerHood: Painter = (ctx, px) => {
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, PROWLER_HOOD),
    litFill(ctx, PROWLER_CHARCOAL, LIGHT_FROM, LIGHT_TO),
  );
  for (const ear of PROWLER_INNER_EARS) {
    tracePoints(ctx, ear);
    ctx.fillStyle = tone(PROWLER_CHARCOAL, PROWLER_EAR_SHADE);
    ctx.fill();
  }
  for (const fold of PROWLER_FOLDS) {
    strokeDetail(ctx, px, fold, tone(PROWLER_CHARCOAL, ENGRAVED), MEDIUM_DETAIL);
  }
  tracePoints(ctx, PROWLER_OPENING);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = hairlineWidth(px) * PROWLER_LINING_WIDTH + outlineWidth(px) * 2;
  ctx.stroke();
  ctx.strokeStyle = PROWLER_LINING;
  ctx.lineWidth = hairlineWidth(px) * PROWLER_LINING_WIDTH;
  ctx.stroke();
  ctx.fillStyle = PROWLER_SHADOW;
  ctx.fill();
  for (const [x, y] of PROWLER_EYES) {
    traceEllipse(ctx, x, y, PROWLER_EYE_RX, PROWLER_EYE_RY);
    ctx.fillStyle = PROWLER_EYE;
    ctx.fill();
    glint(ctx, x, y, PROWLER_EYE_GLINT_R);
  }
  ctx.save();
  ctx.setLineDash([STITCH_DASH, STITCH_DASH]);
  for (const ear of PROWLER_INNER_EARS) strokeDetail(ctx, px, ear, PROWLER_STITCH, MEDIUM_DETAIL);
  ctx.restore();
};

// ── Hearthguard Cap ────────────────────────────────────────────────────
/** A knitted trapper: ribbed cuff, rows of knit stitches and a wool bobble on top, so it never reads as leather. */
const HEARTH_WOOL = '#8a6440';
const HEARTH_FLAP_SHADE = -0.12;
const HEARTH_CAP_CY = 0.62;
const HEARTH_CAP_R = 0.33;
const HEARTH_FLAPS: readonly Polyline[] = [
  [
    [0.17, 0.58],
    [0.33, 0.58],
    [0.31, 0.88, 0.07],
    [0.19, 0.88, 0.07],
  ],
  [
    [0.67, 0.58],
    [0.83, 0.58],
    [0.81, 0.88, 0.07],
    [0.69, 0.88, 0.07],
  ],
];
const HEARTH_CUFF: Polyline = [
  [0.15, 0.55, 0.04],
  [0.85, 0.55, 0.04],
  [0.85, 0.7, 0.04],
  [0.15, 0.7, 0.04],
];
const HEARTH_CUFF_FROM: Point = [0.15, 0.55];
const HEARTH_CUFF_TO: Point = [0.85, 0.7];
const HEARTH_CUFF_TOP = 0.57;
const HEARTH_CUFF_BOTTOM = 0.68;
const HEARTH_RIB_COUNT = 9;
const HEARTH_RIB_LEFT = 0.2;
const HEARTH_RIB_RIGHT = 0.8;
/** Knit stitches are rows of small vees; each row is a horizontal line across the dome. */
const HEARTH_KNIT_ROWS: readonly (readonly [y: number, halfWidth: number])[] = [
  [0.48, 0.28],
  [0.4, 0.24],
  [0.33, 0.17],
];
const HEARTH_KNIT_PITCH = 0.07;
const HEARTH_KNIT_DEPTH = 0.035;
const HEARTH_BOBBLE_Y = 0.25;
const HEARTH_BOBBLE_R = 0.08;
const HEARTH_BOBBLE_LIGHT = 0.15;

function paintKnitRow(
  ctx: CanvasRenderingContext2D,
  px: number,
  y: number,
  halfWidth: number,
): void {
  const stitches = Math.floor((halfWidth * 2) / HEARTH_KNIT_PITCH);
  const left = ICON_CENTER - (stitches * HEARTH_KNIT_PITCH) / 2;
  for (let i = 0; i < stitches; i++) {
    const x = left + i * HEARTH_KNIT_PITCH;
    const vee: Polyline = [
      [x, y - HEARTH_KNIT_DEPTH],
      [x + HEARTH_KNIT_PITCH / 2, y],
      [x + HEARTH_KNIT_PITCH, y - HEARTH_KNIT_DEPTH],
    ];
    strokeDetail(ctx, px, vee, tone(HEARTH_WOOL, ENGRAVED));
  }
}

const paintHearthguardCap: Painter = (ctx, px) => {
  for (const flap of HEARTH_FLAPS) {
    paintForm(
      ctx,
      px,
      () => tracePoints(ctx, flap),
      litFill(ctx, tone(HEARTH_WOOL, HEARTH_FLAP_SHADE), LIGHT_FROM, LIGHT_TO),
    );
  }
  ellipseForm(
    ctx,
    px,
    ICON_CENTER,
    HEARTH_BOBBLE_Y,
    HEARTH_BOBBLE_R,
    HEARTH_BOBBLE_R,
    litFill(ctx, tone(HEARTH_WOOL, HEARTH_BOBBLE_LIGHT), LIGHT_FROM, LIGHT_TO),
  );
  paintForm(
    ctx,
    px,
    () => traceDome(ctx, ICON_CENTER, HEARTH_CAP_CY, HEARTH_CAP_R),
    litFill(ctx, HEARTH_WOOL, LIGHT_FROM, LIGHT_TO),
  );
  for (const [y, halfWidth] of HEARTH_KNIT_ROWS) paintKnitRow(ctx, px, y, halfWidth);
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, HEARTH_CUFF),
    litFill(ctx, tone(HEARTH_WOOL, RAISED), HEARTH_CUFF_FROM, HEARTH_CUFF_TO),
  );
  const ribGap = (HEARTH_RIB_RIGHT - HEARTH_RIB_LEFT) / (HEARTH_RIB_COUNT - 1);
  for (let i = 0; i < HEARTH_RIB_COUNT; i++) {
    const x = HEARTH_RIB_LEFT + i * ribGap;
    const rib: Polyline = [
      [x, HEARTH_CUFF_TOP],
      [x, HEARTH_CUFF_BOTTOM],
    ];
    strokeDetail(ctx, px, rib, tone(HEARTH_WOOL, ENGRAVED), MEDIUM_DETAIL);
  }
};

// ── Cockscomb Crest ────────────────────────────────────────────────────
/**
 * A steel helm seen side-on with a rooster's comb along its ridge: a row of
 * tall, round-topped spikes with deep notches between them, the tallest in
 * the middle. Flat matte red with one shade band, so it never reads as flame.
 */
const COMB_RED = '#b82430';
const COMB_SHADE = -0.28;
const COMB_SPLIT = 0.6;
/** Each spike's centre and the height of its rounded top. */
const COMB_SPIKES: readonly Point[] = [
  [0.29, 0.24],
  [0.405, 0.14],
  [0.52, 0.08],
  [0.635, 0.14],
  [0.75, 0.24],
];
const COMB_SPIKE_HALF = 0.05;
const COMB_NOTCH_Y = 0.36;
/** Below the dome's ridge, so the helm covers the comb's foot. */
const COMB_FOOT_Y = 0.56;
const HELM_CY = 0.74;
const HELM_R = 0.36;
const HELM_RIM: Polyline = [
  [0.08, 0.7, 0.03],
  [0.92, 0.7, 0.03],
  [0.92, 0.8, 0.03],
  [0.08, 0.8, 0.03],
];
const HELM_RIM_FROM: Point = [0.08, 0.7];
const HELM_RIM_TO: Point = [0.92, 0.8];
const HELM_RIVETS_X = [0.2, 0.4, 0.6, 0.8] as const;
const HELM_RIVET_Y = 0.75;
const HELM_RIVET_R = 0.03;
const HELM_GLINT: Spark = [0.3, 0.54, 0.06];

function combOutline(): Polyline {
  const first = COMB_SPIKES[0];
  const last = COMB_SPIKES[COMB_SPIKES.length - 1];
  const points: IconPoint[] = [[first[0] - COMB_SPIKE_HALF, COMB_FOOT_Y]];
  COMB_SPIKES.forEach(([x, top], i) => {
    points.push([x - COMB_SPIKE_HALF, top, COMB_SPIKE_HALF]);
    points.push([x + COMB_SPIKE_HALF, top, COMB_SPIKE_HALF]);
    const hasNext = i + 1 < COMB_SPIKES.length;
    if (hasNext) points.push([(x + COMB_SPIKES[i + 1][0]) / 2, COMB_NOTCH_Y]);
  });
  points.push([last[0] + COMB_SPIKE_HALF, COMB_FOOT_Y]);
  return points;
}
const COMB = combOutline();

const paintCockscomb: Painter = (ctx, px) => {
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, COMB),
    bandedFill(ctx, LIGHT_FROM, LIGHT_TO, [
      [COMB_RED, COMB_SPLIT],
      [tone(COMB_RED, COMB_SHADE), 1],
    ]),
  );
  paintForm(
    ctx,
    px,
    () => traceDome(ctx, ICON_CENTER, HELM_CY, HELM_R),
    litFill(ctx, STEEL, LIGHT_FROM, LIGHT_TO),
  );
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, HELM_RIM),
    litFill(ctx, tone(STEEL, SET_BACK), HELM_RIM_FROM, HELM_RIM_TO),
  );
  for (const x of HELM_RIVETS_X) rivet(ctx, px, x, HELM_RIVET_Y, HELM_RIVET_R, SILVER);
  glints(ctx, [HELM_GLINT]);
};

// ── Stoneheart Amulet ──────────────────────────────────────────────────
/** A cool grey, faceted lump: lit facets top-left, a dark face turned away, and a heart glowing through a crack. */
const STONE_GREY = '#7f8790';
const STONE_FACET_LIT = 0.3;
const STONE_FACET_DARK = -0.38;
const STONE_LUMP: Polyline = [
  [0.27, 0.42],
  [0.47, 0.32],
  [0.7, 0.38],
  [0.85, 0.6],
  [0.74, 0.86],
  [0.5, 0.94],
  [0.22, 0.84],
  [0.15, 0.6],
];
const STONE_LIT_FACET: Polyline = [
  [0.27, 0.42],
  [0.47, 0.32],
  [0.52, 0.48],
  [0.3, 0.62],
  [0.15, 0.6],
];
const STONE_DARK_FACET: Polyline = [
  [0.85, 0.6],
  [0.74, 0.86],
  [0.5, 0.94],
  [0.58, 0.74],
];
const STONE_RIDGES: readonly Polyline[] = [
  [
    [0.52, 0.48],
    [0.7, 0.38],
  ],
  [
    [0.3, 0.62],
    [0.22, 0.84],
  ],
];
const STONE_THONGS: readonly Polyline[] = [
  [
    [0.16, 0],
    [0.47, 0.4],
  ],
  [
    [0.84, 0],
    [0.53, 0.4],
  ],
];
/** The thong is tied on with one turn round the stone's shoulders, crossing it at a slant. */
const STONE_WRAP: Polyline = [
  [0.18, 0.54],
  [0.5, 0.42],
  [0.84, 0.58],
];
const STONE_KNOT: Point = [0.5, 0.42];
const STONE_KNOT_R = 0.03;
/** The heartbeat is a dim warm light seen only through the cracks; the stone stays the subject. */
const STONE_EMBER = '#d0643a';
const STONE_EMBER_GLOW_WIDTH = 3;
const STONE_EMBER_GLOW_ALPHA = 0.3;
const STONE_EMBER_CORE_ALPHA = 0.75;
const STONE_CRACKS: readonly Polyline[] = [
  [
    [0.36, 0.6],
    [0.44, 0.66],
    [0.5, 0.62],
    [0.56, 0.72],
    [0.64, 0.74],
  ],
  [
    [0.5, 0.62],
    [0.48, 0.52],
  ],
];

const paintStoneheart: Painter = (ctx, px) => {
  for (const thong of STONE_THONGS) paintCord(ctx, px, thong, LEATHER, false);
  paintForm(ctx, px, () => tracePoints(ctx, STONE_LUMP), STONE_GREY);
  withShapeClip(
    ctx,
    () => tracePoints(ctx, STONE_LUMP),
    () => {
      tracePoints(ctx, STONE_LIT_FACET);
      ctx.fillStyle = tone(STONE_GREY, STONE_FACET_LIT);
      ctx.fill();
      tracePoints(ctx, STONE_DARK_FACET);
      ctx.fillStyle = tone(STONE_GREY, STONE_FACET_DARK);
      ctx.fill();
      withAlpha(ctx, STONE_EMBER_GLOW_ALPHA, () => {
        for (const crack of STONE_CRACKS) {
          strokeDetail(ctx, px, crack, STONE_EMBER, STONE_EMBER_GLOW_WIDTH * BOLD_DETAIL);
        }
      });
    },
  );
  for (const ridge of STONE_RIDGES) strokeDetail(ctx, px, ridge, tone(STONE_GREY, ENGRAVED));
  for (const crack of STONE_CRACKS) {
    strokeDetail(ctx, px, crack, tone(STONE_GREY, ENGRAVED), BOLD_DETAIL);
  }
  withAlpha(ctx, STONE_EMBER_CORE_ALPHA, () => {
    for (const crack of STONE_CRACKS) strokeDetail(ctx, px, crack, STONE_EMBER);
  });
  paintCord(ctx, px, STONE_WRAP, LEATHER, false);
  ellipseForm(ctx, px, STONE_KNOT[0], STONE_KNOT[1], STONE_KNOT_R, STONE_KNOT_R, LEATHER);
};

// ── Sun and Moon Lockets ───────────────────────────────────────────────
const LOCKET_CY = 0.6;
const LOCKET_BAIL_Y = 0.26;
const LOCKET_BAIL_R = 0.06;
const LOCKET_CHAINS: readonly Polyline[] = [
  [
    [0.18, 0],
    [0.47, 0.22],
  ],
  [
    [0.82, 0],
    [0.53, 0.22],
  ],
];

function paintLocketHanger(ctx: CanvasRenderingContext2D, px: number, metal: string): void {
  for (const chain of LOCKET_CHAINS) paintCord(ctx, px, chain, metal, true);
  traceEllipse(ctx, ICON_CENTER, LOCKET_BAIL_Y, LOCKET_BAIL_R, LOCKET_BAIL_R);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = outlineWidth(px) * 2 + hairlineWidth(px) * BOLD_DETAIL;
  ctx.stroke();
  ctx.strokeStyle = metal;
  ctx.lineWidth = hairlineWidth(px) * BOLD_DETAIL;
  ctx.stroke();
}

const SUN_LOCKET_R = 0.27;
const SUN_RIM_SHARE = 0.86;
const SUN_RAYS = 12;
const SUN_RAY_INNER = 0.1;
const SUN_RAY_OUTER = 0.21;
const SUN_CORE_R = 0.075;
const SUN_CORE_LIGHT = 0.4;
const SUN_GLINT: Spark = [0.38, 0.47, 0.07];

const paintSunLocket: Painter = (ctx, px) => {
  paintLocketHanger(ctx, px, GOLD);
  ellipseForm(
    ctx,
    px,
    ICON_CENTER,
    LOCKET_CY,
    SUN_LOCKET_R,
    SUN_LOCKET_R,
    litFill(ctx, GOLD, LIGHT_FROM, LIGHT_TO),
  );
  const rimR = SUN_LOCKET_R * SUN_RIM_SHARE;
  traceEllipse(ctx, ICON_CENTER, LOCKET_CY, rimR, rimR);
  ctx.strokeStyle = tone(GOLD, ENGRAVED);
  ctx.lineWidth = hairlineWidth(px);
  ctx.stroke();
  for (let i = 0; i < SUN_RAYS; i++) {
    const angle = (i / SUN_RAYS) * FULL_TURN;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const ray: Polyline = [
      [ICON_CENTER + cos * SUN_RAY_INNER, LOCKET_CY + sin * SUN_RAY_INNER],
      [ICON_CENTER + cos * SUN_RAY_OUTER, LOCKET_CY + sin * SUN_RAY_OUTER],
    ];
    strokeDetail(ctx, px, ray, tone(GOLD, ENGRAVED), MEDIUM_DETAIL);
  }
  disc(ctx, ICON_CENTER, LOCKET_CY, SUN_CORE_R, tone(GOLD, SUN_CORE_LIGHT));
  glints(ctx, [SUN_GLINT]);
};

/** A bright crescent on a dark-blue enamel field, as bold as the sun locket's sunburst. */
const MOON_LOCKET_RX = 0.23;
const MOON_LOCKET_RY = 0.29;
const MOON_ENAMEL = '#1e2a5a';
const MOON_ENAMEL_RX = 0.17;
const MOON_ENAMEL_RY = 0.225;
const MOON_FACE = '#f2f0e4';
const MOON_CRESCENT_R = 0.14;
const MOON_CRESCENT_BITE_DX = 0.075;
const MOON_CRESCENT_BITE_DY = -0.04;
const MOON_CRESCENT_BITE_R = 0.115;
const MOON_GLINT: Spark = [0.36, 0.42, 0.06];

const paintMoonLocket: Painter = (ctx, px) => {
  paintLocketHanger(ctx, px, SILVER);
  ellipseForm(
    ctx,
    px,
    ICON_CENTER,
    LOCKET_CY,
    MOON_LOCKET_RX,
    MOON_LOCKET_RY,
    litFill(ctx, SILVER, LIGHT_FROM, LIGHT_TO),
  );
  ellipseForm(ctx, px, ICON_CENTER, LOCKET_CY, MOON_ENAMEL_RX, MOON_ENAMEL_RY, MOON_ENAMEL);
  withShapeClip(
    ctx,
    () => traceEllipse(ctx, ICON_CENTER, LOCKET_CY, MOON_CRESCENT_R, MOON_CRESCENT_R),
    () => {
      traceEllipse(ctx, ICON_CENTER, LOCKET_CY, MOON_CRESCENT_R, MOON_CRESCENT_R);
      ctx.fillStyle = MOON_FACE;
      ctx.fill();
      traceEllipse(
        ctx,
        ICON_CENTER + MOON_CRESCENT_BITE_DX,
        LOCKET_CY + MOON_CRESCENT_BITE_DY,
        MOON_CRESCENT_BITE_R,
        MOON_CRESCENT_BITE_R,
      );
      ctx.fillStyle = MOON_ENAMEL;
      ctx.fill();
    },
  );
  glints(ctx, [MOON_GLINT]);
};

// ── Showman's Top Hat ──────────────────────────────────────────────────
const TOPHAT_RED = '#b0242c';
const TOPHAT_CROWN: Polyline = [
  [0.28, 0.76],
  [0.24, 0.1, 0.03],
  [0.6, 0.1],
  [0.66, 0.16],
  [0.72, 0.1],
  [0.76, 0.1, 0.03],
  [0.72, 0.76],
];
const TOPHAT_CROWN_FROM: Point = [0.24, 0.1];
const TOPHAT_CROWN_TO: Point = [0.76, 0.5];
const TOPHAT_BAND: Polyline = [
  [0.265, 0.56],
  [0.735, 0.56],
  [0.728, 0.68],
  [0.272, 0.68],
];
const TOPHAT_BAND_FROM: Point = [0.26, 0.56];
const TOPHAT_BAND_TO: Point = [0.74, 0.68];
const TOPHAT_BRIM_CY = 0.78;
const TOPHAT_BRIM_RX = 0.44;
const TOPHAT_BRIM_RY = 0.1;
const TOPHAT_BRIM_FROM: Point = [0.06, 0.7];
const TOPHAT_BRIM_TO: Point = [0.94, 0.88];
/** The crease running down from the dent a lion left in the crown. */
const TOPHAT_DENT_CREASE: Polyline = [
  [0.6, 0.11],
  [0.64, 0.24],
];
const TOPHAT_GLINT: Spark = [0.34, 0.24, 0.07];

const paintTopHat: Painter = (ctx, px) => {
  ellipseForm(
    ctx,
    px,
    ICON_CENTER,
    TOPHAT_BRIM_CY,
    TOPHAT_BRIM_RX,
    TOPHAT_BRIM_RY,
    litFill(ctx, tone(TOPHAT_RED, SET_BACK), TOPHAT_BRIM_FROM, TOPHAT_BRIM_TO),
  );
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, TOPHAT_CROWN),
    litFill(ctx, TOPHAT_RED, TOPHAT_CROWN_FROM, TOPHAT_CROWN_TO),
  );
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, TOPHAT_BAND),
    litFill(ctx, GOLD, TOPHAT_BAND_FROM, TOPHAT_BAND_TO),
  );
  strokeDetail(ctx, px, TOPHAT_DENT_CREASE, tone(TOPHAT_RED, ENGRAVED));
  glints(ctx, [TOPHAT_GLINT]);
};

// ── Gilded Monocle ─────────────────────────────────────────────────────
const MONOCLE_CX = 0.4;
const MONOCLE_CY = 0.4;
const MONOCLE_RIM_R = 0.28;
const MONOCLE_GLASS_R = 0.21;
const MONOCLE_GLASS = '#a8d0dc';
const MONOCLE_GLASS_ALPHA = 0.75;
const MONOCLE_GLASS_LIT_UNTIL = 0.35;
const MONOCLE_GLASS_LIT = 0.5;
/** The chain leaves the rim at its side and droops in a slack loop to a clip at the icon's edge. */
const MONOCLE_CHAIN_START: Point = [0.68, 0.44];
const MONOCLE_CHAIN_SAG: Point = [0.74, 1.02];
const MONOCLE_CHAIN_END: Point = [0.96, 0.6];
const MONOCLE_CHAIN_LINKS = 8;
/** Links are drawn finer than other cords so the chain reads as chain, not a coiled tail. */
const MONOCLE_LINK_OUTLINE = 3;
const MONOCLE_LINK_METAL = 1.5;
const MONOCLE_LINK_R = 0.03;
const MONOCLE_CLIP_R = 0.035;
const MONOCLE_GLASS_GLINT: Spark = [0.32, 0.32, 0.09];
const MONOCLE_RIM_GLINT: Spark = [0.6, 0.2, 0.06];

/** A point `t` of the way along the chain's droop, a quadratic curve through its sag. */
function monocleChainAt(t: number): Point {
  const u = 1 - t;
  const [ax, ay] = MONOCLE_CHAIN_START;
  const [bx, by] = MONOCLE_CHAIN_SAG;
  const [cx, cy] = MONOCLE_CHAIN_END;
  return [u * u * ax + 2 * u * t * bx + t * t * cx, u * u * ay + 2 * u * t * by + t * t * cy];
}

function paintMonocleChain(ctx: CanvasRenderingContext2D, px: number): void {
  for (let i = 0; i <= MONOCLE_CHAIN_LINKS; i++) {
    const [x, y] = monocleChainAt(i / MONOCLE_CHAIN_LINKS);
    traceEllipse(ctx, x, y, MONOCLE_LINK_R, MONOCLE_LINK_R);
    ctx.strokeStyle = ICON_OUTLINE;
    ctx.lineWidth = hairlineWidth(px) * MONOCLE_LINK_OUTLINE;
    ctx.stroke();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = hairlineWidth(px) * MONOCLE_LINK_METAL;
    ctx.stroke();
  }
  const [clipX, clipY] = MONOCLE_CHAIN_END;
  ellipseForm(ctx, px, clipX, clipY, MONOCLE_CLIP_R, MONOCLE_CLIP_R, GOLD);
}

const paintMonocle: Painter = (ctx, px) => {
  ctx.beginPath();
  ctx.arc(MONOCLE_CX, MONOCLE_CY, MONOCLE_RIM_R, 0, FULL_TURN);
  ctx.moveTo(MONOCLE_CX + MONOCLE_GLASS_R, MONOCLE_CY);
  ctx.arc(MONOCLE_CX, MONOCLE_CY, MONOCLE_GLASS_R, FULL_TURN, 0, true);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = outlineWidth(px) * 2;
  ctx.stroke();
  ctx.fillStyle = litFill(ctx, GOLD, LIGHT_FROM, LIGHT_TO);
  ctx.fill();
  withAlpha(ctx, MONOCLE_GLASS_ALPHA, () => {
    traceEllipse(ctx, MONOCLE_CX, MONOCLE_CY, MONOCLE_GLASS_R, MONOCLE_GLASS_R);
    ctx.fillStyle = bandedFill(
      ctx,
      [MONOCLE_CX - MONOCLE_GLASS_R, MONOCLE_CY - MONOCLE_GLASS_R],
      [MONOCLE_CX + MONOCLE_GLASS_R, MONOCLE_CY + MONOCLE_GLASS_R],
      [
        [tone(MONOCLE_GLASS, MONOCLE_GLASS_LIT), MONOCLE_GLASS_LIT_UNTIL],
        [MONOCLE_GLASS, 1],
      ],
    );
    ctx.fill();
  });
  paintMonocleChain(ctx, px);
  glints(ctx, [MONOCLE_GLASS_GLINT, MONOCLE_RIM_GLINT]);
};

// ── Grinning Mask ──────────────────────────────────────────────────────
const PORCELAIN = '#ece6dc';
const MASK_MOUTH = '#3a1416';
const MASK_CY = 0.5;
const MASK_RX = 0.34;
const MASK_RY = 0.43;
const MASK_EYES: readonly Polyline[] = [
  [
    [0.25, 0.4],
    [0.34, 0.33, 0.04],
    [0.44, 0.4],
    [0.34, 0.45, 0.04],
  ],
  [
    [0.56, 0.4],
    [0.66, 0.33, 0.04],
    [0.75, 0.4],
    [0.66, 0.45, 0.04],
  ],
];
const MASK_GRIN: Polyline = [
  [0.2, 0.58],
  [0.5, 0.66],
  [0.8, 0.58],
  [0.66, 0.78, 0.1],
  [0.34, 0.78, 0.1],
];
const MASK_TEETH_Y = 0.7;
const MASK_TEETH_RISE = 0.06;
const MASK_TEETH_DROP = 0.02;
const MASK_TEETH_EDGE: Polyline = [
  [0.24, MASK_TEETH_Y - MASK_TEETH_RISE],
  [0.5, MASK_TEETH_Y],
  [0.76, MASK_TEETH_Y - MASK_TEETH_RISE],
];
const MASK_TEETH_X = [0.32, 0.41, 0.5, 0.59, 0.68] as const;
const MASK_CRACK: Polyline = [
  [0.68, 0.1],
  [0.64, 0.2],
  [0.7, 0.26],
];
const MASK_GLINT: Spark = [0.32, 0.22, 0.07];

const paintGrinningMask: Painter = (ctx, px) => {
  ellipseForm(
    ctx,
    px,
    ICON_CENTER,
    MASK_CY,
    MASK_RX,
    MASK_RY,
    litFill(ctx, PORCELAIN, LIGHT_FROM, LIGHT_TO),
  );
  for (const eye of MASK_EYES) paintForm(ctx, px, () => tracePoints(ctx, eye), ICON_OUTLINE);
  paintForm(ctx, px, () => tracePoints(ctx, MASK_GRIN), MASK_MOUTH);
  strokeDetail(ctx, px, MASK_TEETH_EDGE, PORCELAIN, BOLD_DETAIL);
  for (const x of MASK_TEETH_X) {
    const gap: Polyline = [
      [x, MASK_TEETH_Y - MASK_TEETH_RISE],
      [x, MASK_TEETH_Y + MASK_TEETH_DROP],
    ];
    strokeDetail(ctx, px, gap, MASK_MOUTH);
  }
  strokeDetail(ctx, px, MASK_CRACK, tone(PORCELAIN, ENGRAVED));
  glints(ctx, [MASK_GLINT]);
};

// ── Hushed Bell ────────────────────────────────────────────────────────
const BELL_BRASS = '#c9a23e';
const BELL_RIBBON = '#c4362e';
const BELL_FUR = '#c9c4bb';
/** The ribbon is a collar seen from the front: a loop sagging to the bell's ring. */
const BELL_RIBBON_LOOP: Polyline = [
  [0.1, 0.12],
  [0.5, 0.3, 0.2],
  [0.9, 0.12],
];
const BELL_RING_Y = 0.3;
const BELL_RING_R = 0.05;
const BELL_CY = 0.6;
const BELL_R = 0.26;
const BELL_SLOT_Y = 0.68;
const BELL_SLOT: Polyline = [
  [0.31, BELL_SLOT_Y],
  [0.69, BELL_SLOT_Y],
];
const BELL_HOLE_Y = 0.77;
const BELL_HOLE_R = 0.035;
/** The twist of fur stopping its clapper, bulging out of the slot. */
const BELL_FUR_X = 0.58;
const BELL_FUR_RX = 0.08;
const BELL_FUR_RY = 0.05;
const BELL_GLINT: Spark = [0.4, 0.48, 0.07];

const paintHushedBell: Painter = (ctx, px) => {
  paintCord(ctx, px, BELL_RIBBON_LOOP, BELL_RIBBON, false);
  traceEllipse(ctx, ICON_CENTER, BELL_RING_Y, BELL_RING_R, BELL_RING_R);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = outlineWidth(px) * 2 + hairlineWidth(px) * BOLD_DETAIL;
  ctx.stroke();
  ctx.strokeStyle = BELL_BRASS;
  ctx.lineWidth = hairlineWidth(px) * BOLD_DETAIL;
  ctx.stroke();
  ellipseForm(
    ctx,
    px,
    ICON_CENTER,
    BELL_CY,
    BELL_R,
    BELL_R,
    litFill(ctx, BELL_BRASS, LIGHT_FROM, LIGHT_TO),
  );
  strokeDetail(ctx, px, BELL_SLOT, tone(BELL_BRASS, ENGRAVED), BOLD_DETAIL);
  disc(ctx, ICON_CENTER, BELL_HOLE_Y, BELL_HOLE_R, tone(BELL_BRASS, ENGRAVED));
  ellipseForm(ctx, px, BELL_FUR_X, BELL_SLOT_Y, BELL_FUR_RX, BELL_FUR_RY, BELL_FUR);
  glints(ctx, [BELL_GLINT]);
};

const PAINTERS: Record<GearHeadIconId, Painter> = {
  foremans_hardhat: paintHardhat,
  hazard_goggles: paintGoggles,
  stargazers_cap: paintStargazerCap,
  moonmoth_pendant: paintMoonmoth,
  kaleidoscope_specs: paintKaleidoscopeSpecs,
  halo_of_the_ninth_life: paintHalo,
  prowler_hood: paintProwlerHood,
  hearthguard_cap: paintHearthguardCap,
  cockscomb_crest: paintCockscomb,
  stoneheart_amulet: paintStoneheart,
  sun_locket: paintSunLocket,
  moon_locket: paintMoonLocket,
  showmans_top_hat: paintTopHat,
  gilded_monocle: paintMonocle,
  grinning_mask: paintGrinningMask,
  hushed_bell: paintHushedBell,
};

export function drawGearHeadIcon(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  id: GearHeadIconId,
): void {
  paintIconArt(ctx, rect, PAINTERS[id]);
}
