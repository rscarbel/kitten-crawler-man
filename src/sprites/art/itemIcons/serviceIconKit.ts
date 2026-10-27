/**
 * Shared brushwork for the shop-service icons: the shapes several services
 * repeat (a sword, a mug, a flame, a bed, steam, sparks) painted once in the
 * item icons' unit-square style, so a whole menu of services reads as one set.
 */

import type { Rect } from '../../../ui/core/geom';
import {
  bandedFill,
  disc,
  FULL_TURN,
  glint,
  hairlineWidth,
  ICON_CENTER,
  ICON_OUTLINE,
  litFill,
  paintForm,
  paintIconArt,
  rivet,
  strokeDetail,
  tone,
  traceEllipse,
  tracePoints,
  withShapeClip,
  type IconArtPainter,
  type IconPoint,
} from './iconPaint';

/** Paints one service's picture into `rect`. Square art is centred in a non-square rect. */
export type ServiceIconPainter = (ctx: CanvasRenderingContext2D, rect: Rect) => void;

export type Vec = readonly [x: number, y: number];

/** Standard lift and drop for a form's lit rim and shaded side. */
export const LIGHT = 0.3;
export const SHADE = -0.34;
export const DEEP_SHADE = -0.6;
/** Half a step, for a secondary plane that must still separate from its neighbour. */
export const HALF_LIGHT = LIGHT / 2;
export const HALF_SHADE = SHADE / 2;

export const STEEL = '#a9b1bc';
export const IRON = '#6f7680';
export const OAK = '#8a5a32';
export const DARK_WOOD = '#5a3820';
export const STRAW = '#d9b65a';
export const BRASS = '#c9a24a';
export const GOLD = '#e8c25a';
export const LINEN = '#e6dcc4';
export const FLAME_ORANGE = '#f08a24';
export const FLAME_YELLOW = '#ffd45a';
export const FLAME_CORE = '#fff4c2';
export const STEAM = '#e8eef4';
export const SPARK_HOT = '#ffe08a';

/** Wraps a unit-square painter as a rect painter. */
export function toIcon(art: IconArtPainter): ServiceIconPainter {
  return (ctx, rect) => paintIconArt(ctx, rect, art);
}

/** The top-left and bottom-right corners of the box around `points`. */
function boundsOf(points: readonly IconPoint[]): readonly [Vec, Vec] {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}

/**
 * Paints a closed polygon outlined and lit from `from` toward `to`, by default
 * across its own box from the top-left corner, where the light comes from.
 */
export function paintLitPoints(
  ctx: CanvasRenderingContext2D,
  px: number,
  points: readonly IconPoint[],
  base: string,
  from?: Vec,
  to?: Vec,
): void {
  const [topLeft, bottomRight] = boundsOf(points);
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, points),
    litFill(ctx, base, from ?? topLeft, to ?? bottomRight),
  );
}

/** A rectangle as polygon points, optionally rounded. */
export function rectPoints(
  left: number,
  top: number,
  right: number,
  bottom: number,
  corner = 0,
): readonly IconPoint[] {
  return [
    [left, top, corner],
    [right, top, corner],
    [right, bottom, corner],
    [left, bottom, corner],
  ];
}

/** Paints a rectangle outlined and lit across its diagonal from the top-left corner. */
export function paintLitRect(
  ctx: CanvasRenderingContext2D,
  px: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  base: string,
  corner = 0,
): void {
  paintLitPoints(
    ctx,
    px,
    rectPoints(left, top, right, bottom, corner),
    base,
    [left, top],
    [right, bottom],
  );
}

/** Paints an ellipse outlined and lit along its top-left to bottom-right diagonal. */
export function paintLitEllipse(
  ctx: CanvasRenderingContext2D,
  px: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  base: string,
): void {
  paintForm(
    ctx,
    px,
    () => traceEllipse(ctx, cx, cy, rx, ry),
    litFill(ctx, base, [cx - rx, cy - ry], [cx + rx, cy + ry]),
  );
}

/** Runs `paint` translated to `origin`, turned clockwise by `rotation` and scaled, all about the icon centre. */
export function withPlacement(
  ctx: CanvasRenderingContext2D,
  origin: Vec,
  rotation: number,
  scale: number,
  paint: () => void,
): void {
  ctx.save();
  try {
    ctx.translate(origin[0], origin[1]);
    ctx.rotate(rotation);
    ctx.scale(scale, scale);
    ctx.translate(-ICON_CENTER, -ICON_CENTER);
    paint();
  } finally {
    ctx.restore();
  }
}

/** Steam rising from a hot dish: a few S-curved hairlines, every wisp leaning the same way. */
const STEAM_SWAY = 0.05;
const STEAM_WIDTH = 2.2;
const STEAM_FIRST_BEND = 1 / 3;
const STEAM_SECOND_BEND = 2 / 3;
export function paintSteam(
  ctx: CanvasRenderingContext2D,
  px: number,
  xs: readonly number[],
  bottom: number,
  top: number,
): void {
  const rise = bottom - top;
  ctx.strokeStyle = STEAM;
  ctx.lineWidth = hairlineWidth(px) * STEAM_WIDTH;
  for (const x of xs) {
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.bezierCurveTo(
      x + STEAM_SWAY,
      bottom - rise * STEAM_FIRST_BEND,
      x - STEAM_SWAY,
      bottom - rise * STEAM_SECOND_BEND,
      x,
      top,
    );
    ctx.stroke();
  }
}

/** A spark thrown off a grinding edge: a hot four-armed star with a white heart. */
const SPARK_CORE_FRACTION = 0.5;
export function paintSpark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  glint(ctx, cx, cy, r, SPARK_HOT);
  glint(ctx, cx, cy, r * SPARK_CORE_FRACTION);
}

/** A short streak flying from a spark's source, the dash that says "it's moving". */
const STREAK_WIDTH = 1.6;
export function paintStreak(
  ctx: CanvasRenderingContext2D,
  px: number,
  from: Vec,
  to: Vec,
  color: string = SPARK_HOT,
): void {
  strokeDetail(ctx, px, [from, to], color, STREAK_WIDTH);
}

/**
 * A straight sword painted upright in the unit square — tip at the top,
 * pommel at the bottom — for {@link withPlacement} to lay where it is wanted.
 */
const SWORD = {
  cx: 0.5,
  tip: 0.04,
  shoulder: 0.14,
  guard: 0.64,
  bladeHalf: 0.07,
  guardHalf: 0.21,
  guardHeight: 0.06,
  gripBottom: 0.86,
  gripHalf: 0.04,
  pommelY: 0.9,
  pommelR: 0.055,
  fullerHalf: 0.012,
  fullerTop: 0.2,
  wrapTurns: 3,
  glintY: 0.24,
  glintR: 0.05,
} as const;
const GRIP_LEATHER = '#4a2c18';
/** The blade's two bevels meet at its centre ridge: lit on the left, shaded on the right. */
const BLADE_RIDGE = 0.5;
const GRIP_WRAP_SLANT = 2;
export function paintSword(
  ctx: CanvasRenderingContext2D,
  px: number,
  steel: string = STEEL,
  hilt: string = BRASS,
): void {
  const { cx } = SWORD;
  const blade: readonly IconPoint[] = [
    [cx, SWORD.tip],
    [cx + SWORD.bladeHalf, SWORD.shoulder],
    [cx + SWORD.bladeHalf, SWORD.guard],
    [cx - SWORD.bladeHalf, SWORD.guard],
    [cx - SWORD.bladeHalf, SWORD.shoulder],
  ];
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, blade),
    bandedFill(
      ctx,
      [cx - SWORD.bladeHalf, 0],
      [cx + SWORD.bladeHalf, 0],
      [
        [tone(steel, LIGHT), BLADE_RIDGE],
        [tone(steel, SHADE), 1],
      ],
    ),
  );
  strokeDetail(
    ctx,
    px,
    [
      [cx, SWORD.fullerTop],
      [cx, SWORD.guard],
    ],
    tone(steel, DEEP_SHADE),
  );
  paintLitRect(
    ctx,
    px,
    cx - SWORD.gripHalf,
    SWORD.guard,
    cx + SWORD.gripHalf,
    SWORD.gripBottom,
    GRIP_LEATHER,
  );
  const gripSpan = SWORD.gripBottom - SWORD.guard;
  for (let turn = 1; turn <= SWORD.wrapTurns; turn++) {
    const y = SWORD.guard + (gripSpan * turn) / (SWORD.wrapTurns + 1);
    strokeDetail(
      ctx,
      px,
      [
        [cx - SWORD.gripHalf, y],
        [cx + SWORD.gripHalf, y - SWORD.fullerHalf * GRIP_WRAP_SLANT],
      ],
      tone(GRIP_LEATHER, LIGHT),
    );
  }
  paintLitRect(
    ctx,
    px,
    cx - SWORD.guardHalf,
    SWORD.guard,
    cx + SWORD.guardHalf,
    SWORD.guard + SWORD.guardHeight,
    hilt,
    SWORD.guardHeight / 2,
  );
  rivet(ctx, px, cx, SWORD.pommelY, SWORD.pommelR, hilt);
  glint(ctx, cx - SWORD.bladeHalf / 2, SWORD.glintY, SWORD.glintR);
}

/**
 * A three-tongued flame's outline as quadratic segments (control, then end),
 * x in half-widths from the centre and y in heights above the base.
 */
const FLAME_PATH: readonly (readonly [cx: number, cy: number, x: number, y: number])[] = [
  [-1.1, 0.55, -0.55, 0.7],
  [-0.45, 0.45, -0.2, 0.5],
  [-0.35, 0.85, 0, 1],
  [0.25, 0.6, 0.3, 0.55],
  [0.5, 0.62, 0.62, 0.78],
  [1.15, 0.4, 1, 0],
];
const FLAME_HEART = 0.66;
const FLAME_CORE_SCALE = 0.36;
/** A flame standing on `base`, its outer orange holding a yellow heart and a pale core. */
export function paintFlame(
  ctx: CanvasRenderingContext2D,
  px: number,
  cx: number,
  base: number,
  halfWidth: number,
  height: number,
  outlined = true,
): void {
  const trace = (scale: number): void => {
    const w = halfWidth * scale;
    const h = height * scale;
    ctx.beginPath();
    ctx.moveTo(cx - w, base);
    for (const [controlX, controlY, x, y] of FLAME_PATH)
      ctx.quadraticCurveTo(cx + w * controlX, base - h * controlY, cx + w * x, base - h * y);
    ctx.closePath();
  };
  if (outlined) paintForm(ctx, px, () => trace(1), FLAME_ORANGE);
  else {
    trace(1);
    ctx.fillStyle = FLAME_ORANGE;
    ctx.fill();
  }
  trace(FLAME_HEART);
  ctx.fillStyle = FLAME_YELLOW;
  ctx.fill();
  trace(FLAME_CORE_SCALE);
  ctx.fillStyle = FLAME_CORE;
  ctx.fill();
}

/** A drinking mug side-on, handle to the right: tapered body, contents showing at the rim. */
export interface MugLook {
  readonly body: string;
  readonly contents: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  /** How much narrower the base is than the rim on each side. */
  readonly taper: number;
  /** Staves and iron hoops, for a wooden tankard. */
  readonly staved?: boolean;
}
const MUG_RIM_RY = 0.05;
/** The drink sits a little below the rim and inside its wall. */
const MUG_CONTENTS_DROP = 1 / 3;
const MUG_CONTENTS_WIDTH = 0.84;
const MUG_CONTENTS_DEPTH = 0.7;
const MUG_HANDLE_REACH = 0.17;
const MUG_HANDLE_TOP = 0.2;
const MUG_HANDLE_BOTTOM = 0.75;
const MUG_HANDLE_WIDTH = 6;
const MUG_HANDLE_EDGE = 9;
const MUG_STAVES = 4;
const MUG_HOOP_FRACTIONS = [0.18, 0.82] as const;
const MUG_HOOP_HEIGHT = 0.05;
export function paintMug(ctx: CanvasRenderingContext2D, px: number, look: MugLook): void {
  const { left, right, top, bottom, taper } = look;
  const height = bottom - top;
  const handle: readonly IconPoint[] = [
    [right - taper * MUG_HANDLE_TOP, top + height * MUG_HANDLE_TOP],
    [right + MUG_HANDLE_REACH, top + height * MUG_HANDLE_TOP, MUG_HANDLE_REACH / 2],
    [right + MUG_HANDLE_REACH, top + height * MUG_HANDLE_BOTTOM, MUG_HANDLE_REACH / 2],
    [right - taper * MUG_HANDLE_BOTTOM, top + height * MUG_HANDLE_BOTTOM],
  ];
  strokeDetail(ctx, px, handle, ICON_OUTLINE, MUG_HANDLE_EDGE);
  strokeDetail(ctx, px, handle, tone(look.body, HALF_SHADE), MUG_HANDLE_WIDTH);

  const body: readonly IconPoint[] = [
    [left, top],
    [right, top],
    [right - taper, bottom, MUG_RIM_RY / 2],
    [left + taper, bottom, MUG_RIM_RY / 2],
  ];
  const trace = (): void => tracePoints(ctx, body);
  paintForm(ctx, px, trace, litFill(ctx, look.body, [left, 0], [right, 0]));
  if (look.staved) {
    withShapeClip(ctx, trace, () => {
      for (let stave = 1; stave < MUG_STAVES; stave++) {
        const t = stave / MUG_STAVES;
        strokeDetail(
          ctx,
          px,
          [
            [left + (right - left) * t, top],
            [left + taper + (right - left - taper * 2) * t, bottom],
          ],
          tone(look.body, DEEP_SHADE),
        );
      }
      for (const fraction of MUG_HOOP_FRACTIONS) {
        const y = top + height * fraction;
        ctx.fillStyle = litFill(ctx, IRON, [left, 0], [right, 0]);
        ctx.fillRect(left, y - MUG_HOOP_HEIGHT / 2, right - left, MUG_HOOP_HEIGHT);
        strokeDetail(
          ctx,
          px,
          [
            [left, y + MUG_HOOP_HEIGHT / 2],
            [right, y + MUG_HOOP_HEIGHT / 2],
          ],
          ICON_OUTLINE,
        );
      }
    });
  }
  const rimCx = (left + right) / 2;
  const rimRx = (right - left) / 2;
  paintForm(
    ctx,
    px,
    () => traceEllipse(ctx, rimCx, top, rimRx, MUG_RIM_RY),
    tone(look.body, HALF_SHADE),
  );
  traceEllipse(
    ctx,
    rimCx,
    top + MUG_RIM_RY * MUG_CONTENTS_DROP,
    rimRx * MUG_CONTENTS_WIDTH,
    MUG_RIM_RY * MUG_CONTENTS_DEPTH,
  );
  ctx.fillStyle = look.contents;
  ctx.fill();
}

/**
 * How far each lighter copy of the foam is pushed toward the light: the puffs'
 * own silhouette, shifted up-left, leaves a shaded crescent on their far side.
 */
const FOAM_MID_SHIFT = 0.02;
const FOAM_LIT_SHIFT = 0.05;
/** Puffs of foam heaped over a rim, lit top-left. */
export function paintFoam(
  ctx: CanvasRenderingContext2D,
  px: number,
  puffs: readonly (readonly [cx: number, cy: number, r: number])[],
  color: string,
): void {
  const trace = (dx: number, dy: number): void => {
    ctx.beginPath();
    for (const [cx, cy, r] of puffs) {
      ctx.moveTo(cx + dx + r, cy + dy);
      ctx.arc(cx + dx, cy + dy, r, 0, FULL_TURN);
    }
  };
  paintForm(ctx, px, () => trace(0, 0), tone(color, HALF_SHADE));
  withShapeClip(
    ctx,
    () => trace(0, 0),
    () => {
      trace(-FOAM_MID_SHIFT, -FOAM_MID_SHIFT);
      ctx.fillStyle = color;
      ctx.fill();
      trace(-FOAM_LIT_SHIFT, -FOAM_LIT_SHIFT);
      ctx.fillStyle = tone(color, LIGHT);
      ctx.fill();
    },
  );
}

/**
 * A bed side-on, head to the left: a wooden frame with a headboard, a
 * mattress, a pillow and a blanket turned down.
 */
export interface BedLook {
  readonly left: number;
  readonly right: number;
  /** Top of the mattress. */
  readonly top: number;
  /** Floor line the legs stand on. */
  readonly floor: number;
  readonly frame: string;
  readonly blanket: string;
  readonly headboardTop: number;
  /** A feather bed's mattress and pillow swell well above the frame. */
  readonly plush?: boolean;
}
const BED_RAIL_HEIGHT = 0.08;
const BED_POST_WIDTH = 0.07;
const BED_LEG_WIDTH = 0.05;
const BED_POST_CORNER = 0.017;
const BED_PILLOW_SINK = 1 / 3;
const BED_MATTRESS_HEIGHT = 0.07;
const BED_PLUSH_SWELL = 0.08;
const BED_PILLOW_WIDTH = 0.2;
const BED_PILLOW_HEIGHT = 0.08;
const BED_BLANKET_FROM = 0.36;
const BED_BLANKET_TURN = 0.05;
const BED_FOOTBOARD_RISE = 0.07;
export function paintBed(ctx: CanvasRenderingContext2D, px: number, look: BedLook): void {
  const { left, right, top, floor, frame } = look;
  const swell = look.plush ? BED_PLUSH_SWELL : 0;
  const railTop = top + BED_MATTRESS_HEIGHT;
  const railBottom = railTop + BED_RAIL_HEIGHT;
  paintLitRect(
    ctx,
    px,
    left + BED_POST_WIDTH,
    railBottom,
    left + BED_POST_WIDTH + BED_LEG_WIDTH,
    floor,
    tone(frame, SHADE),
  );
  paintLitRect(ctx, px, right - BED_LEG_WIDTH, railBottom, right, floor, tone(frame, SHADE));
  paintLitRect(
    ctx,
    px,
    left,
    look.headboardTop,
    left + BED_POST_WIDTH,
    floor,
    frame,
    BED_POST_CORNER,
  );
  paintLitRect(
    ctx,
    px,
    right - BED_POST_WIDTH,
    top - BED_FOOTBOARD_RISE,
    right,
    railBottom,
    frame,
    BED_POST_CORNER,
  );
  paintLitRect(ctx, px, left + BED_POST_WIDTH, railTop, right - BED_POST_WIDTH, railBottom, frame);

  const mattressLeft = left + BED_POST_WIDTH;
  const mattressRight = right - BED_POST_WIDTH;
  paintLitPoints(
    ctx,
    px,
    rectPoints(
      mattressLeft,
      top - swell,
      mattressRight,
      railTop,
      BED_MATTRESS_HEIGHT / 2 + swell / 2,
    ),
    LINEN,
    [0, top - swell],
    [0, railTop],
  );
  const blanketLeft = mattressLeft + (mattressRight - mattressLeft) * BED_BLANKET_FROM;
  const blanketTop = top - swell - BED_BLANKET_TURN / 2;
  const blanket: readonly IconPoint[] = [
    [blanketLeft, blanketTop, BED_BLANKET_TURN / 2],
    [mattressRight + BED_BLANKET_TURN / 2, blanketTop, BED_BLANKET_TURN],
    [mattressRight + BED_BLANKET_TURN / 2, railBottom],
    [blanketLeft, railBottom],
  ];
  paintLitPoints(ctx, px, blanket, look.blanket, [0, blanketTop], [0, railBottom]);
  paintLitRect(
    ctx,
    px,
    blanketLeft,
    blanketTop,
    blanketLeft + BED_BLANKET_TURN,
    railBottom,
    tone(look.blanket, LIGHT),
  );
  const pillowTop = top - swell - BED_PILLOW_HEIGHT;
  paintLitPoints(
    ctx,
    px,
    rectPoints(
      mattressLeft + BED_LEG_WIDTH / 2,
      pillowTop,
      mattressLeft + BED_PILLOW_WIDTH,
      top - swell + BED_MATTRESS_HEIGHT * BED_PILLOW_SINK,
      BED_PILLOW_HEIGHT / 2,
    ),
    tone(LINEN, HALF_LIGHT),
    [mattressLeft, pillowTop],
    [mattressLeft + BED_PILLOW_WIDTH, top],
  );
}

const GLOW_OUTER_ALPHA = 0.18;
const GLOW_INNER_ALPHA = 0.28;
const GLOW_INNER_SCALE = 0.62;
/** Flat soft glow behind a light source: two stepped discs, never a radial gradient. */
export function paintGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  ctx.save();
  ctx.globalAlpha = GLOW_OUTER_ALPHA;
  disc(ctx, cx, cy, r, color);
  ctx.globalAlpha = GLOW_INNER_ALPHA;
  disc(ctx, cx, cy, r * GLOW_INNER_SCALE, color);
  ctx.restore();
}

/** A straight run to a point, or a quadratic curve given as its control point then its end. */
export type CurveSegment =
  | readonly [x: number, y: number]
  | readonly [controlX: number, controlY: number, x: number, y: number];

/** Traces a closed outline from `start` through straight and curved segments. */
export function traceCurvePath(
  ctx: CanvasRenderingContext2D,
  start: Vec,
  segments: readonly CurveSegment[],
): void {
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  for (const segment of segments) {
    if (segment.length === 2) ctx.lineTo(segment[0], segment[1]);
    else ctx.quadraticCurveTo(segment[0], segment[1], segment[2], segment[3]);
  }
  ctx.closePath();
}

/** How much wider an outlined stroke's dark edge is than its colour. */
const OUTLINED_STROKE_EDGE = 1.8;
/** A thick coloured line with the icon outline round it: a rail, a handle, a stem. */
export function strokeOutlined(
  ctx: CanvasRenderingContext2D,
  px: number,
  points: readonly IconPoint[],
  color: string,
  width: number,
): void {
  strokeDetail(ctx, px, points, ICON_OUTLINE, width * OUTLINED_STROKE_EDGE);
  strokeDetail(ctx, px, points, color, width);
}
