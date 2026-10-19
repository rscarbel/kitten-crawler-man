/**
 * Service icons for what taverns, farms and lounges pour and plate: a crawler
 * buys the meal or the round, not an item for the bag.
 */

import {
  bandedFill,
  FULL_TURN,
  glint,
  hairlineWidth,
  litFill,
  paintForm,
  strokeDetail,
  tone,
  traceEllipse,
  withShapeClip,
  type IconArtPainter,
  type IconPoint,
} from './iconPaint';
import {
  BRASS,
  DARK_WOOD,
  DEEP_SHADE,
  GOLD,
  HALF_LIGHT,
  HALF_SHADE,
  LIGHT,
  OAK,
  paintFoam,
  paintLitEllipse,
  paintLitPoints,
  paintLitRect,
  paintMug,
  paintSteam,
  SHADE,
  strokeOutlined,
  toIcon,
  traceCurvePath,
  type CurveSegment,
  type Vec,
} from './serviceIconKit';

const FOAM = '#f4ecd6';
const ALE = '#d89a2a';
const MILK = '#f6f2e8';
const CRUST = '#c98a3e';
const HONEY = '#f0a820';
const BROTH = '#8a4a22';
const CARROT = '#e87a2a';
const POTATO = '#e8d39a';
const HERB_GREEN = '#5aa040';

/** A dab of shine on wet or glazed surfaces: centre and reach. */
type GlintSpot = readonly [x: number, y: number, r: number];
/** A disc in a list of discs: centre and radius. */
type Blob = readonly [cx: number, cy: number, r: number];
/** A chunk floating in a broth: centre, radius and colour. */
type Chunk = readonly [cx: number, cy: number, r: number, color: string];
/** Chunks sit flat in the broth, wider than they are tall. */
const CHUNK_SQUASH = 0.75;

function paintGlintSpot(ctx: CanvasRenderingContext2D, [x, y, r]: GlintSpot): void {
  glint(ctx, x, y, r);
}

const ALE_MUG = { left: 0.16, right: 0.64, top: 0.34, bottom: 0.9, taper: 0.03 } as const;
const ALE_FOAM: readonly Blob[] = [
  [0.22, 0.32, 0.075],
  [0.33, 0.25, 0.1],
  [0.48, 0.24, 0.1],
  [0.6, 0.31, 0.08],
  [0.42, 0.34, 0.08],
];
const ALE_DRIP: readonly IconPoint[] = [
  [0.5, 0.36],
  [0.6, 0.36],
  [0.58, 0.52, 0.03],
  [0.53, 0.5, 0.02],
];

const paintAle: IconArtPainter = (ctx, px) => {
  paintMug(ctx, px, { ...ALE_MUG, body: OAK, contents: ALE, staved: true });
  paintLitPoints(ctx, px, ALE_DRIP, FOAM);
  paintFoam(ctx, px, ALE_FOAM, FOAM);
};

const JUG_CLAY = '#b5653a';
/** A pot-bellied clay jug, its milk sloshing up over the lip. */
const JUG = {
  cx: 0.46,
  rimY: 0.3,
  rimRx: 0.15,
  rimRy: 0.05,
  bellyY: 0.64,
  bellyRx: 0.31,
  baseY: 0.9,
  baseRx: 0.2,
} as const;
/** The neck flares into the belly this far down from the rim. */
const JUG_SHOULDER = 0.4;
const JUG_HANDLE: readonly IconPoint[] = [
  [0.6, 0.36],
  [0.86, 0.38, 0.1],
  [0.8, 0.66, 0.08],
  [0.72, 0.7],
];
const JUG_HANDLE_WIDTH = 6;
const JUG_SPOUT: readonly IconPoint[] = [
  [0.33, 0.28],
  [0.2, 0.24, 0.02],
  [0.32, 0.36],
];
const MILK_SLOSH: readonly IconPoint[] = [
  [0.3, 0.32],
  [0.22, 0.2, 0.05],
  [0.34, 0.18, 0.04],
  [0.4, 0.08, 0.05],
  [0.52, 0.16, 0.04],
  [0.62, 0.1, 0.05],
  [0.64, 0.3],
];
const MILK_DROPS: readonly Blob[] = [
  [0.74, 0.08, 0.035],
  [0.16, 0.1, 0.03],
  [0.8, 0.2, 0.022],
];
/** Milk spilled down the jug's front from the lip. */
const MILK_DRIBBLE: readonly IconPoint[] = [
  [0.36, 0.3],
  [0.44, 0.3],
  [0.43, 0.48, 0.03],
  [0.38, 0.48, 0.03],
];
const JUG_GLINT: GlintSpot = [0.29, 0.6, 0.05];

function traceJug(ctx: CanvasRenderingContext2D): void {
  const { cx, rimY, rimRx, bellyY, bellyRx, baseY, baseRx } = JUG;
  const shoulderY = rimY + (bellyY - rimY) * JUG_SHOULDER;
  ctx.beginPath();
  ctx.moveTo(cx - rimRx, rimY);
  ctx.quadraticCurveTo(cx - rimRx, shoulderY, cx - bellyRx, bellyY);
  ctx.quadraticCurveTo(cx - bellyRx, baseY, cx - baseRx, baseY);
  ctx.lineTo(cx + baseRx, baseY);
  ctx.quadraticCurveTo(cx + bellyRx, baseY, cx + bellyRx, bellyY);
  ctx.quadraticCurveTo(cx + rimRx, shoulderY, cx + rimRx, rimY);
  ctx.closePath();
}

const paintBoozyMilk: IconArtPainter = (ctx, px) => {
  strokeOutlined(ctx, px, JUG_HANDLE, tone(JUG_CLAY, HALF_SHADE), JUG_HANDLE_WIDTH);
  paintLitPoints(ctx, px, JUG_SPOUT, JUG_CLAY);
  paintForm(
    ctx,
    px,
    () => traceJug(ctx),
    litFill(ctx, JUG_CLAY, [JUG.cx - JUG.bellyRx, 0], [JUG.cx + JUG.bellyRx, 0]),
  );
  paintLitPoints(ctx, px, MILK_DRIBBLE, MILK);
  paintLitPoints(ctx, px, MILK_SLOSH, MILK);
  paintForm(ctx, px, () => traceEllipse(ctx, JUG.cx, JUG.rimY, JUG.rimRx, JUG.rimRy), MILK);
  for (const [dropX, dropY, r] of MILK_DROPS) paintLitEllipse(ctx, px, dropX, dropY, r, r, MILK);
  paintGlintSpot(ctx, JUG_GLINT);
};

const HORN_IVORY = '#ead8aa';
const MEAD = '#e0a030';
const CINNAMON = '#8a4a24';
/** A drinking horn, mouth up-right, curling down to a capped tip at the left. */
const HORN_START: Vec = [0.56, 0.3];
const HORN_PATH: readonly CurveSegment[] = [
  [0.52, 0.62, 0.12, 0.62],
  [0.08, 0.66, 0.12, 0.72],
  [0.62, 0.88, 0.88, 0.3],
];
/** Ivory at the mouth darkening to a brown tip, laid from mouth to tip. */
const HORN_SHADE_FROM: Vec = [0.84, 0.3];
const HORN_SHADE_TO: Vec = [0.12, 0.7];
const HORN_IVORY_UNTIL = 0.32;
const HORN_MID_UNTIL = 0.62;
const HORN_MOUTH = { cx: 0.72, cy: 0.3, rx: 0.16, ry: 0.06 } as const;
/** The mead's surface sits just inside the brass rim. */
const MEAD_SURFACE = { dx: 0.005, dy: 0.008, rxScale: 0.8, ryScale: 0.6 } as const;
const HORN_BAND: readonly IconPoint[] = [
  [0.5, 0.42],
  [0.9, 0.42],
];
const HORN_BAND_WIDTH = 4;
const HORN_SHEEN: readonly IconPoint[] = [
  [0.3, 0.7],
  [0.62, 0.66],
  [0.82, 0.44],
];
const HORN_SHEEN_WIDTH = 1.6;
const HORN_TIP_CAP = { cx: 0.12, cy: 0.67, r: 0.05 } as const;
const MEAD_STICK: readonly IconPoint[] = [
  [0.68, 0.3],
  [0.6, 0.06],
];
const MEAD_STICK_WIDTH = 4;
const MEAD_STEAM_XS = [0.78, 0.86] as const;
const MEAD_STEAM_BOTTOM = 0.22;
const MEAD_STEAM_TOP = 0.04;

const paintMead: IconArtPainter = (ctx, px) => {
  const horn = (): void => traceCurvePath(ctx, HORN_START, HORN_PATH);
  paintForm(
    ctx,
    px,
    horn,
    bandedFill(ctx, HORN_SHADE_FROM, HORN_SHADE_TO, [
      [HORN_IVORY, HORN_IVORY_UNTIL],
      [tone(HORN_IVORY, SHADE), HORN_MID_UNTIL],
      [tone(DARK_WOOD, HALF_SHADE), 1],
    ]),
  );
  withShapeClip(ctx, horn, () => {
    strokeOutlined(ctx, px, HORN_BAND, BRASS, HORN_BAND_WIDTH);
    strokeDetail(ctx, px, HORN_SHEEN, tone(HORN_IVORY, LIGHT), HORN_SHEEN_WIDTH);
  });
  const cap = HORN_TIP_CAP;
  paintLitEllipse(ctx, px, cap.cx, cap.cy, cap.r, cap.r, BRASS);
  strokeOutlined(ctx, px, MEAD_STICK, CINNAMON, MEAD_STICK_WIDTH);
  const mouth = HORN_MOUTH;
  paintForm(ctx, px, () => traceEllipse(ctx, mouth.cx, mouth.cy, mouth.rx, mouth.ry), BRASS);
  traceEllipse(
    ctx,
    mouth.cx + MEAD_SURFACE.dx,
    mouth.cy + MEAD_SURFACE.dy,
    mouth.rx * MEAD_SURFACE.rxScale,
    mouth.ry * MEAD_SURFACE.ryScale,
  );
  ctx.fillStyle = MEAD;
  ctx.fill();
  paintSteam(ctx, px, MEAD_STEAM_XS, MEAD_STEAM_BOTTOM, MEAD_STEAM_TOP);
};

const BOTTLE_GLASS = '#26382a';
const WAX_RED = '#a8202a';
const LABEL_CREAM = '#ece0c0';
/** A tall dark bottle: long neck, sloped shoulders, rounded heel. */
const BOTTLE_START: Vec = [0.44, 0.12];
const BOTTLE_PATH: readonly CurveSegment[] = [
  [0.56, 0.12],
  [0.56, 0.3],
  [0.7, 0.34, 0.7, 0.46],
  [0.7, 0.88],
  [0.7, 0.94, 0.64, 0.94],
  [0.36, 0.94],
  [0.3, 0.94, 0.3, 0.88],
  [0.3, 0.46],
  [0.3, 0.34, 0.44, 0.3],
];
const BOTTLE_LIGHT_FROM: Vec = [0.3, 0];
const BOTTLE_LIGHT_TO: Vec = [0.7, 0];
const WAX_SEAL: readonly IconPoint[] = [
  [0.41, 0.04, 0.02],
  [0.59, 0.04, 0.02],
  [0.59, 0.2],
  [0.57, 0.27, 0.01],
  [0.55, 0.2],
  [0.5, 0.2],
  [0.47, 0.24, 0.01],
  [0.44, 0.2],
  [0.41, 0.2],
];
const BOTTLE_LABEL = { left: 0.32, right: 0.68, top: 0.56, bottom: 0.8 } as const;
/** Two gilt rules frame the label, each this far in from its edge. */
const LABEL_RULE_INSET = 0.02;
const LABEL_RULE_HEIGHT = 0.025;
const LABEL_CREST = { cx: 0.5, cy: 0.68, r: 0.06 } as const;
const BOTTLE_SHINE: readonly IconPoint[] = [
  [0.36, 0.44],
  [0.36, 0.54],
];
const BOTTLE_SHINE_LOW: readonly IconPoint[] = [
  [0.36, 0.83],
  [0.36, 0.88],
];
/** Dark glass needs a stronger lift than a lit fill to show a shine at all. */
const GLASS_SHINE_LIFT = 0.75;
const GLASS_SHINE_LOW_LIFT = 0.6;
const SHINE_WIDTH = 3;
const BOTTLE_GLINT: GlintSpot = [0.37, 0.42, 0.05];

const paintGuildReserve: IconArtPainter = (ctx, px) => {
  const bottle = (): void => traceCurvePath(ctx, BOTTLE_START, BOTTLE_PATH);
  paintForm(ctx, px, bottle, litFill(ctx, BOTTLE_GLASS, BOTTLE_LIGHT_FROM, BOTTLE_LIGHT_TO));
  const label = BOTTLE_LABEL;
  withShapeClip(ctx, bottle, () => {
    paintLitRect(ctx, px, label.left, label.top, label.right, label.bottom, LABEL_CREAM);
    const width = label.right - label.left;
    ctx.fillStyle = GOLD;
    ctx.fillRect(label.left, label.top + LABEL_RULE_INSET, width, LABEL_RULE_HEIGHT);
    const lowerRuleTop = label.bottom - LABEL_RULE_INSET - LABEL_RULE_HEIGHT;
    ctx.fillRect(label.left, lowerRuleTop, width, LABEL_RULE_HEIGHT);
  });
  const crest = LABEL_CREST;
  paintLitEllipse(ctx, px, crest.cx, crest.cy, crest.r, crest.r, WAX_RED);
  strokeDetail(ctx, px, BOTTLE_SHINE, tone(BOTTLE_GLASS, GLASS_SHINE_LIFT), SHINE_WIDTH);
  strokeDetail(ctx, px, BOTTLE_SHINE_LOW, tone(BOTTLE_GLASS, GLASS_SHINE_LOW_LIFT), SHINE_WIDTH);
  paintLitPoints(ctx, px, WAX_SEAL, WAX_RED);
  paintGlintSpot(ctx, BOTTLE_GLINT);
};

/** A domed loaf with a slashed crust, honey pooled on top and running down. */
const LOAF_START: Vec = [0.1, 0.82];
const LOAF_PATH: readonly CurveSegment[] = [
  [0.06, 0.4, 0.5, 0.36],
  [0.94, 0.4, 0.9, 0.82],
  [0.5, 0.88, 0.1, 0.82],
];
const LOAF_LIGHT_FROM: Vec = [0.2, 0.36];
const LOAF_LIGHT_TO: Vec = [0.8, 0.86];
const LOAF_SLASHES: readonly (readonly IconPoint[])[] = [
  [
    [0.26, 0.6],
    [0.34, 0.5],
  ],
  [
    [0.46, 0.64],
    [0.54, 0.54],
  ],
  [
    [0.66, 0.62],
    [0.74, 0.52],
  ],
];
const SLASH_WIDTH = 3;
/** Each slash's near lip is lit, a hair to the left of its dark cut. */
const SLASH_LIP_SHIFT = 0.015;
const SLASH_LIP_LIFT = 0.45;
const HONEY_POOL: readonly IconPoint[] = [
  [0.22, 0.46, 0.04],
  [0.5, 0.36, 0.1],
  [0.78, 0.46, 0.04],
  [0.76, 0.6, 0.02],
  [0.72, 0.62, 0.02],
  [0.7, 0.5],
  [0.6, 0.48],
  [0.58, 0.72, 0.025],
  [0.53, 0.72, 0.025],
  [0.51, 0.5],
  [0.38, 0.5],
  [0.35, 0.58, 0.02],
  [0.31, 0.58, 0.02],
  [0.29, 0.5],
];
/** A drop about to fall: a little taller than wide. */
const HONEY_DROP = { cx: 0.555, cy: 0.79, rx: 0.03, ry: 0.036 } as const;
const HONEY_GLINT: GlintSpot = [0.36, 0.43, 0.055];

const paintHoneyBread: IconArtPainter = (ctx, px) => {
  const loaf = (): void => traceCurvePath(ctx, LOAF_START, LOAF_PATH);
  paintForm(ctx, px, loaf, litFill(ctx, CRUST, LOAF_LIGHT_FROM, LOAF_LIGHT_TO));
  withShapeClip(ctx, loaf, () => {
    for (const slash of LOAF_SLASHES) {
      strokeDetail(ctx, px, slash, tone(CRUST, DEEP_SHADE), SLASH_WIDTH);
      const lip = slash.map(([x, y]): IconPoint => [x - SLASH_LIP_SHIFT, y]);
      strokeDetail(ctx, px, lip, tone(CRUST, SLASH_LIP_LIFT), SLASH_WIDTH / 2);
    }
  });
  paintLitPoints(ctx, px, HONEY_POOL, HONEY);
  const drop = HONEY_DROP;
  paintLitEllipse(ctx, px, drop.cx, drop.cy, drop.rx, drop.ry, HONEY);
  paintGlintSpot(ctx, HONEY_GLINT);
};

/** A wooden bowl side-on, its stew surface seen from just above the rim. */
const BOWL = { cx: 0.5, rimY: 0.52, rx: 0.42, ry: 0.1, bottom: 0.88, footRx: 0.18 } as const;
const STEW_SURFACE = { drop: 0.01, rxScale: 0.88, ryScale: 0.75 } as const;
const BROTH_LIT_UNTIL = 0.4;
const STEW_CHUNKS: readonly Chunk[] = [
  [0.34, 0.5, 0.045, CARROT],
  [0.56, 0.47, 0.05, POTATO],
  [0.66, 0.53, 0.04, CARROT],
  [0.44, 0.55, 0.04, POTATO],
];
const STEW_HERBS: readonly (readonly [number, number])[] = [
  [0.48, 0.47],
  [0.6, 0.56],
  [0.28, 0.54],
];
const HERB_FLECK = { rx: 0.015, ry: 0.012 } as const;
const BOWL_GROOVE: readonly IconPoint[] = [
  [0.25, 0.72],
  [0.75, 0.72],
];
const BOWL_GROOVE_WIDTH = 1.2;
const SPOON: readonly IconPoint[] = [
  [0.66, 0.48],
  [0.9, 0.18],
];
const SPOON_WIDTH = 4;
const STEW_STEAM_XS = [0.36, 0.5] as const;
const STEW_STEAM_BOTTOM = 0.4;
const STEW_STEAM_TOP = 0.08;

function traceBowl(ctx: CanvasRenderingContext2D): void {
  const { cx, rimY, rx, bottom, footRx } = BOWL;
  ctx.beginPath();
  ctx.moveTo(cx - rx, rimY);
  ctx.quadraticCurveTo(cx - rx, bottom, cx - footRx, bottom);
  ctx.lineTo(cx + footRx, bottom);
  ctx.quadraticCurveTo(cx + rx, bottom, cx + rx, rimY);
  ctx.closePath();
}

function paintChunks(
  ctx: CanvasRenderingContext2D,
  px: number,
  chunks: readonly Chunk[],
  outlined: boolean,
): void {
  for (const [cx, cy, r, color] of chunks) {
    if (outlined) {
      paintLitEllipse(ctx, px, cx, cy, r, r * CHUNK_SQUASH, color);
      continue;
    }
    traceEllipse(ctx, cx, cy, r, r * CHUNK_SQUASH);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

const paintStew: IconArtPainter = (ctx, px) => {
  paintSteam(ctx, px, STEW_STEAM_XS, STEW_STEAM_BOTTOM, STEW_STEAM_TOP);
  strokeOutlined(ctx, px, SPOON, tone(OAK, LIGHT), SPOON_WIDTH);
  const { cx, rimY, rx, ry } = BOWL;
  paintForm(ctx, px, () => traceBowl(ctx), litFill(ctx, OAK, [cx - rx, 0], [cx + rx, 0]));
  paintForm(ctx, px, () => traceEllipse(ctx, cx, rimY, rx, ry), tone(OAK, HALF_LIGHT));
  const surface = (): void =>
    traceEllipse(
      ctx,
      cx,
      rimY + STEW_SURFACE.drop,
      rx * STEW_SURFACE.rxScale,
      ry * STEW_SURFACE.ryScale,
    );
  withShapeClip(ctx, surface, () => {
    ctx.fillStyle = bandedFill(
      ctx,
      [0, rimY - ry],
      [0, rimY + ry],
      [
        [tone(BROTH, LIGHT), BROTH_LIT_UNTIL],
        [BROTH, 1],
      ],
    );
    ctx.fillRect(0, 0, 1, 1);
    paintChunks(ctx, px, STEW_CHUNKS, true);
    for (const [herbX, herbY] of STEW_HERBS) {
      traceEllipse(ctx, herbX, herbY, HERB_FLECK.rx, HERB_FLECK.ry);
      ctx.fillStyle = HERB_GREEN;
      ctx.fill();
    }
  });
  strokeDetail(ctx, px, BOWL_GROOVE, tone(OAK, DEEP_SHADE), BOWL_GROOVE_WIDTH);
};

const PLATE = '#eef0f2';
const PLATE_RIM_BLUE = '#4a6aa8';
const PLATE_SHAPE = { cx: 0.5, cy: 0.72, rx: 0.45, ry: 0.17 } as const;
const PLATE_WELL_SCALE = 0.86;
const PLATE_RIM_WIDTH = 1.5;
const ROLL = { cx: 0.26, cy: 0.64, rx: 0.15, ry: 0.1 } as const;
const ROLL_SCORE: readonly IconPoint[] = [
  [0.22, 0.59],
  [0.29, 0.67],
];
const SCORE_WIDTH = 2;
/** A glazed crock of something hot, set beside the bread. */
const CROCK_GLAZE = '#4a6aa8';
const CROCK: readonly IconPoint[] = [
  [0.44, 0.56],
  [0.88, 0.56],
  [0.84, 0.76, 0.05],
  [0.48, 0.76, 0.05],
];
const CROCK_MOUTH = { cx: 0.66, cy: 0.56, rx: 0.22, ry: 0.07 } as const;
const CROCK_FILLING_SCALE = 0.84;
const CROCK_CHUNKS: readonly Chunk[] = [
  [0.58, 0.56, 0.035, CARROT],
  [0.7, 0.55, 0.035, POTATO],
  [0.76, 0.575, 0.025, HERB_GREEN],
];
const PEAS: readonly (readonly [number, number])[] = [
  [0.4, 0.8],
  [0.46, 0.82],
  [0.43, 0.77],
];
const PEA_R = 0.025;
const PLATE_STEAM_XS = [0.6, 0.74] as const;
const PLATE_STEAM_BOTTOM = 0.46;
const PLATE_STEAM_TOP = 0.12;

const paintHotPlate: IconArtPainter = (ctx, px) => {
  const plate = PLATE_SHAPE;
  paintLitEllipse(ctx, px, plate.cx, plate.cy, plate.rx, plate.ry, PLATE);
  traceEllipse(ctx, plate.cx, plate.cy, plate.rx * PLATE_WELL_SCALE, plate.ry * PLATE_WELL_SCALE);
  ctx.strokeStyle = PLATE_RIM_BLUE;
  ctx.lineWidth = hairlineWidth(px) * PLATE_RIM_WIDTH;
  ctx.stroke();
  paintSteam(ctx, px, PLATE_STEAM_XS, PLATE_STEAM_BOTTOM, PLATE_STEAM_TOP);
  paintLitPoints(ctx, px, CROCK, CROCK_GLAZE);
  const mouth = CROCK_MOUTH;
  paintForm(
    ctx,
    px,
    () => traceEllipse(ctx, mouth.cx, mouth.cy, mouth.rx, mouth.ry),
    tone(CROCK_GLAZE, LIGHT),
  );
  const filling = (): void =>
    traceEllipse(
      ctx,
      mouth.cx,
      mouth.cy,
      mouth.rx * CROCK_FILLING_SCALE,
      mouth.ry * CROCK_FILLING_SCALE,
    );
  withShapeClip(ctx, filling, () => {
    filling();
    ctx.fillStyle = BROTH;
    ctx.fill();
    paintChunks(ctx, px, CROCK_CHUNKS, false);
  });
  for (const [peaX, peaY] of PEAS) paintLitEllipse(ctx, px, peaX, peaY, PEA_R, PEA_R, HERB_GREEN);
  paintLitEllipse(ctx, px, ROLL.cx, ROLL.cy, ROLL.rx, ROLL.ry, CRUST);
  strokeDetail(ctx, px, ROLL_SCORE, tone(CRUST, DEEP_SHADE), SCORE_WIDTH);
};

const NIGHT_GLAZE = '#34477e';
const COCOA = '#c88a52';
const MOON_CREAM = '#f2e6b8';
const NIGHT_MUG = { left: 0.16, right: 0.66, top: 0.36, bottom: 0.9, taper: 0.02 } as const;
/** A crescent: a disc with a second, offset disc bitten out of it. */
const MOON = { cx: 0.4, cy: 0.62, r: 0.13, biteDx: 0.06, biteDy: -0.04 } as const;
const NIGHT_STARS: readonly GlintSpot[] = [
  [0.56, 0.5, 0.035],
  [0.58, 0.74, 0.025],
];
const NIGHT_STEAM_XS = [0.32, 0.46] as const;
const NIGHT_STEAM_BOTTOM = 0.3;
const NIGHT_STEAM_TOP = 0.06;

const paintNightcap: IconArtPainter = (ctx, px) => {
  paintSteam(ctx, px, NIGHT_STEAM_XS, NIGHT_STEAM_BOTTOM, NIGHT_STEAM_TOP);
  paintMug(ctx, px, { ...NIGHT_MUG, body: NIGHT_GLAZE, contents: COCOA });
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 1, 1);
  ctx.arc(MOON.cx + MOON.biteDx, MOON.cy + MOON.biteDy, MOON.r, 0, FULL_TURN);
  ctx.clip('evenodd');
  paintLitEllipse(ctx, px, MOON.cx, MOON.cy, MOON.r, MOON.r, MOON_CREAM);
  ctx.restore();
  for (const [starX, starY, r] of NIGHT_STARS) glint(ctx, starX, starY, r, MOON_CREAM);
};

const COCKTAIL_GLASS = '#cfe6ee';
const FIZZ = '#3ac0d0';
const LIME = '#8ccf3a';
/** A coupe: a wide shallow bowl on a slim stem and a round foot. */
const COUPE_START: Vec = [0.14, 0.3];
const COUPE_PATH: readonly CurveSegment[] = [
  [0.86, 0.3],
  [0.84, 0.56, 0.54, 0.56],
  [0.53, 0.82],
  [0.72, 0.84, 0.72, 0.9],
  [0.28, 0.9],
  [0.28, 0.84, 0.47, 0.82],
  [0.46, 0.56],
  [0.16, 0.56, 0.14, 0.3],
];
const COUPE_LIGHT_FROM: Vec = [0.14, 0];
const COUPE_LIGHT_TO: Vec = [0.86, 0];
const COUPE_BOWL_BOTTOM = 0.56;
const COUPE_RIM: readonly IconPoint[] = [
  [0.15, 0.3],
  [0.85, 0.3],
];
const GILT_RIM_WIDTH = 2.5;
const COCKTAIL_LIQUID_TOP = 0.34;
const FIZZ_LIT_UNTIL = 0.3;
const FIZZ_MID_UNTIL = 0.66;
const FIZZ_SURFACE_WIDTH = 2;
const COCKTAIL_BUBBLES: readonly Blob[] = [
  [0.4, 0.42, 0.02],
  [0.56, 0.46, 0.016],
  [0.66, 0.4, 0.018],
  [0.46, 0.24, 0.018],
  [0.58, 0.16, 0.022],
  [0.4, 0.1, 0.014],
];
const LIME_WHEEL = { cx: 0.8, cy: 0.27, r: 0.11, segments: 6 } as const;
/** The pale flesh inside the rind. */
const LIME_FLESH_SCALE = 0.72;
const LIME_FLESH_LIFT = 0.45;
const COCKTAIL_GLINT: GlintSpot = [0.24, 0.38, 0.05];

function paintLimeWheel(ctx: CanvasRenderingContext2D, px: number): void {
  const { cx, cy, r, segments } = LIME_WHEEL;
  const flesh = r * LIME_FLESH_SCALE;
  paintLitEllipse(ctx, px, cx, cy, r, r, LIME);
  traceEllipse(ctx, cx, cy, flesh, flesh);
  ctx.fillStyle = tone(LIME, LIME_FLESH_LIFT);
  ctx.fill();
  for (let segment = 0; segment < segments; segment++) {
    const angle = (segment / segments) * FULL_TURN;
    const spoke: readonly IconPoint[] = [
      [cx, cy],
      [cx + Math.cos(angle) * flesh, cy + Math.sin(angle) * flesh],
    ];
    strokeDetail(ctx, px, spoke, tone(LIME, HALF_SHADE));
  }
}

const paintVipCocktail: IconArtPainter = (ctx, px) => {
  const coupe = (): void => traceCurvePath(ctx, COUPE_START, COUPE_PATH);
  paintForm(ctx, px, coupe, litFill(ctx, COCKTAIL_GLASS, COUPE_LIGHT_FROM, COUPE_LIGHT_TO));
  const bubbleColor = tone(FIZZ, LIGHT * 2);
  withShapeClip(ctx, coupe, () => {
    ctx.fillStyle = bandedFill(ctx, COUPE_LIGHT_FROM, COUPE_LIGHT_TO, [
      [tone(FIZZ, LIGHT), FIZZ_LIT_UNTIL],
      [FIZZ, FIZZ_MID_UNTIL],
      [tone(FIZZ, SHADE), 1],
    ]);
    ctx.fillRect(0, COCKTAIL_LIQUID_TOP, 1, COUPE_BOWL_BOTTOM - COCKTAIL_LIQUID_TOP);
    const surface: readonly IconPoint[] = [
      [0, COCKTAIL_LIQUID_TOP],
      [1, COCKTAIL_LIQUID_TOP],
    ];
    strokeDetail(ctx, px, surface, bubbleColor, FIZZ_SURFACE_WIDTH);
  });
  strokeDetail(ctx, px, COUPE_RIM, GOLD, GILT_RIM_WIDTH);
  for (const [bubbleX, bubbleY, r] of COCKTAIL_BUBBLES) {
    traceEllipse(ctx, bubbleX, bubbleY, r, r);
    ctx.fillStyle = bubbleColor;
    ctx.fill();
  }
  paintLimeWheel(ctx, px);
  paintGlintSpot(ctx, COCKTAIL_GLINT);
};

export const FOOD_SERVICE_ICONS = {
  hot_plate: toIcon(paintHotPlate),
  ale: toIcon(paintAle),
  boozy_milk: toIcon(paintBoozyMilk),
  mead: toIcon(paintMead),
  guild_reserve: toIcon(paintGuildReserve),
  honey_bread: toIcon(paintHoneyBread),
  stew: toIcon(paintStew),
  nightcap: toIcon(paintNightcap),
  vip_cocktail: toIcon(paintVipCocktail),
} as const;
