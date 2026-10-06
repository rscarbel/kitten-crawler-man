import type { Rect } from '../../../ui/core/geom';
import { iconSquare } from '../../../ui/icons/iconSquare';
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
  offsetShade,
  outlineWidth,
  paintForm,
  paintIconArt,
  rivet,
  strokeDetail,
  tone,
  traceEllipse,
  tracePoints,
  withShapeClip,
  type IconPoint,
} from './iconPaint';

/**
 * Icons for the eight source-material enchanted pieces.
 *
 * Unlike the issue kit, these are not a matched set — they come from eight
 * different corners of the fiction and are worn by both crawlers — so each one
 * carries its own material and accent colour. At an inventory slot's size the
 * silhouette does the identifying and the material only confirms it.
 */

/** The eight ids this module can draw. Closed, so a new piece cannot ship iconless. */
export type EnchantedGearItemId =
  | 'nightgaunt_cloak'
  | 'slate_butterfly_talisman'
  | 'fae_scale_crupper'
  | 'bracelet_of_dex'
  | 'splatter_skunk_toe_ring'
  | 'shade_gnoll_kneepads'
  | 'grull_war_gauntlet'
  | 'slingshot';

const LIGHT = 0.3;
const SHADE = -0.32;
const DEEP_SHADE = -0.58;
const LIGHT_BAND_UNTIL = 0.32;
const MID_BAND_UNTIL = 0.68;
const DIAGONAL_FROM: readonly [number, number] = [0.1, 0.1];
const DIAGONAL_TO: readonly [number, number] = [0.9, 0.9];

const SILVER = '#c3cad4';
const GOLD = '#d6a23c';
const BRASS = '#c79a35';

/** Three hard bands across a horizontal span, lit on the left: the shading of anything round seen side-on. */
function cylinderFill(
  ctx: CanvasRenderingContext2D,
  base: string,
  left: number,
  right: number,
): CanvasGradient {
  return bandedFill(
    ctx,
    [left, 0],
    [right, 0],
    [
      [tone(base, LIGHT), LIGHT_BAND_UNTIL],
      [base, MID_BAND_UNTIL],
      [tone(base, SHADE), 1],
    ],
  );
}

const CLOAK = '#3f3b7c';
const CLOAK_LINING = '#7a1f3d';
const CLASP_GEM = '#6fe3ff';
const HOOD: readonly IconPoint[] = [
  [0.3, 0.3],
  [0.34, 0.12, 0.08],
  [0.5, 0.04, 0.1],
  [0.66, 0.12, 0.08],
  [0.7, 0.3],
];
const HOOD_LIGHT_FROM: readonly [number, number] = [0.3, 0.04];
const HOOD_LIGHT_TO: readonly [number, number] = [0.7, 0.3];
const HOOD_VOID_CX = 0.5;
const HOOD_VOID_CY = 0.2;
const HOOD_VOID_RX = 0.1;
const HOOD_VOID_RY = 0.1;
/** Bat-wing hem: points hang down, the edge between them arcs up. */
const CLOAK_HEM_POINTS: readonly (readonly [number, number])[] = [
  [0.05, 0.9],
  [0.27, 0.94],
  [0.5, 0.96],
  [0.73, 0.94],
  [0.95, 0.9],
];
const CLOAK_HEM_ARC_RISE = 0.11;
const CLOAK_LEFT_SHOULDER: IconPoint = [0.2, 0.3, 0.07];
const CLOAK_RIGHT_SHOULDER: IconPoint = [0.8, 0.3, 0.07];
const CLOAK_NECK_LEFT: IconPoint = [0.38, 0.26];
const CLOAK_NECK_RIGHT: IconPoint = [0.62, 0.26];
const CLOAK_FOLD_APEX: readonly [number, number] = [0.5, 0.3];
const CLOAK_FOLD_HALF = 0.035;
const CLOAK_OPENING: readonly IconPoint[] = [
  [0.5, 0.3],
  [0.57, 0.96],
  [0.5, 0.97],
  [0.43, 0.96],
];
const CLASP_CX = 0.5;
const CLASP_CY = 0.3;
const CLASP_R = 0.06;
const CLASP_GEM_R = 0.032;

const SLATE = '#5f6b7d';
const RING_CX = 0.5;
const RING_CY = 0.15;
const RING_R = 0.085;
const RING_BAND = 0.03;
const BUTTERFLY_UPPER_WING: readonly IconPoint[] = [
  [0.53, 0.4],
  [0.64, 0.17, 0.06],
  [0.95, 0.19, 0.06],
  [0.86, 0.5, 0.08],
  [0.53, 0.55],
];
const BUTTERFLY_LOWER_WING: readonly IconPoint[] = [
  [0.53, 0.57],
  [0.82, 0.6, 0.05],
  [0.79, 0.88, 0.08],
  [0.62, 0.9, 0.05],
  [0.53, 0.68],
];
const BUTTERFLY_BODY_CX = 0.5;
const BUTTERFLY_BODY_CY = 0.56;
const BUTTERFLY_BODY_RX = 0.04;
const BUTTERFLY_BODY_RY = 0.21;
const BUTTERFLY_BODY_SEGMENTS = [0.58, 0.65, 0.72] as const;
const BUTTERFLY_BODY_SEGMENT_HALF = 0.03;
const ANTENNAE: readonly (readonly IconPoint[])[] = [
  [
    [0.49, 0.37],
    [0.42, 0.26, 0.04],
    [0.37, 0.28],
  ],
  [
    [0.51, 0.37],
    [0.58, 0.26, 0.04],
    [0.63, 0.28],
  ],
];
const RING_LINK: readonly IconPoint[] = [
  [0.5, 0.235],
  [0.5, 0.36],
];
const WING_VEINS: readonly (readonly IconPoint[])[] = [
  [
    [0.55, 0.45],
    [0.84, 0.3],
  ],
  [
    [0.55, 0.5],
    [0.82, 0.5],
  ],
  [
    [0.55, 0.6],
    [0.72, 0.8],
  ],
];
const WING_RIM_SCALE = 2.2;
const TALISMAN_GLINT: readonly [number, number] = [0.24, 0.24];
const TALISMAN_GLINT_R = 0.06;

const FAE_STEEL_LIGHT = '#f4fbff';
const FAE_STEEL = '#86d6d2';
/** Teal in the light, turning pink in shade: fae steel's iridescence. */
const FAE_STEEL_SHADE = '#c97ec4';
const FAE_SCALE_EDGE = 'rgba(60,64,120,0.55)';
/**
 * The crupper as horse tack seen from behind: a broad upside-down U of scale
 * mail draped over the rump, a strap dropping from the top of the arch to the
 * tail loop at the bottom middle, and buckled straps running off to the sides.
 */
const ARCH_CX = 0.5;
const ARCH_BASE_Y = 0.86;
const ARCH_OUTER_RX = 0.45;
const ARCH_OUTER_RY = 0.64;
const ARCH_INNER_RX = 0.2;
const ARCH_INNER_RY = 0.34;
/** The whole arch is shaded as one rounded form: these shifts place its lit rim and its shaded flank. */
const CRUPPER_MID_SHIFT: readonly [number, number] = [0.05, 0.05];
const CRUPPER_SHADE_SHIFT: readonly [number, number] = [0.18, 0.12];
/** Scale rows run round the arch, between its inner and outer edges. */
const SCALE_ROW_FRACTIONS = [0.12, 0.36, 0.6, 0.84] as const;
const SCALE_R = 0.05;
const SCALE_STEPS_PER_ROW = 9;
const SIDE_STRAPS: readonly (readonly IconPoint[])[] = [
  [
    [0.0, 0.66],
    [0.12, 0.67],
    [0.12, 0.75],
    [0.0, 0.74],
  ],
  [
    [1.0, 0.66],
    [0.88, 0.67],
    [0.88, 0.75],
    [1.0, 0.74],
  ],
];
const SIDE_BUCKLE_XS = [0.06, 0.94] as const;
const SIDE_BUCKLE_Y = 0.705;
const SIDE_BUCKLE_HALF = 0.035;
const STRAP_LEATHER = '#5a3b26';
const DOCK_STRAP_HALF = 0.03;
/** The tail loop: a small padded ring at the bottom of the dock strap. */
const TAIL_LOOP_CX = 0.5;
const TAIL_LOOP_CY = 0.77;
const TAIL_LOOP_R = 0.075;
const TAIL_LOOP_BAND = 0.035;
const CRUPPER_GLINT: readonly [number, number] = [0.22, 0.4];
const CRUPPER_GLINT_R = 0.06;

/** A bangle lying flat, seen from above and in front: a short elliptical cylinder. */
const BANGLE_CX = 0.5;
const BANGLE_CY = 0.52;
const BANGLE_RX = 0.4;
const BANGLE_RY = 0.2;
const BANGLE_HEIGHT = 0.15;
const BANGLE_WALL = 0.07;
const BANGLE_GEM = '#38d0e6';
const BANGLE_GEM_CY_OFFSET = 0.04;
const BANGLE_GEM_RX = 0.075;
const BANGLE_GEM_RY = 0.06;
const BANGLE_GROOVE_INSET = 0.25;
/** A gem's lit face is the part of it nearest the light, this fraction of its radius toward the top-left. */
const GEM_LIT_FRACTION = 0.33;
const BANGLE_GEM_GLINT_R = 0.06;
/** The band's own glint, on its lit flank where the outer wall turns toward the light. */
const BANGLE_SIDE_GLINT: readonly [number, number] = [0.22, 0.56];
const BANGLE_SIDE_GLINT_R = 0.075;

const TOE_RING_CX = 0.44;
const TOE_RING_CY = 0.64;
const TOE_RING_RX = 0.26;
const TOE_RING_RY = 0.26;
const TOE_HOLE_RX = 0.16;
const TOE_HOLE_RY = 0.17;
const TOE_HOLE_SHIFT: readonly [number, number] = [0.02, 0.02];
/** The far inner wall shows as a crescent on the hole's right, where the light doesn't reach. */
const TOE_INNER_WALL_SHIFT = 0.05;
const SKUNK_STONE_CY = 0.38;
const SKUNK_STONE_RX = 0.13;
const SKUNK_STONE_RY = 0.09;
const SKUNK_STRIPE_HALF = 0.03;
const SKUNK_BLACK = '#17151a';
const SKUNK_GLINT: readonly [number, number] = [0.375, 0.35];
const SKUNK_GLINT_R = 0.063;
const TOE_RING_GLINT: readonly [number, number] = [0.245, 0.614];
const TOE_RING_GLINT_R = 0.078;
const SKUNK_WHITE = '#f4f2ee';
const STINK = 'rgba(150,214,70,0.9)';
const STINK_WIDTH_SCALE = 2.6;
const STINK_WISPS: readonly (readonly IconPoint[])[] = [
  [
    [0.6, 0.3],
    [0.66, 0.22, 0.04],
    [0.62, 0.15, 0.04],
    [0.7, 0.06],
  ],
  [
    [0.72, 0.4],
    [0.8, 0.33, 0.04],
    [0.76, 0.24, 0.04],
    [0.86, 0.15],
  ],
];

/**
 * Shade gnoll kneepad: a knee guard of blackened iron, matte, shaped like a
 * shield that curves over the knee — wide at the top, tapering to a rounded
 * point — with a raised ridge across the middle where the knee bends, straps
 * out to either side and a gnoll claw riveted on, pointing down.
 */
const GUARD_IRON = '#555c68';
const CLAW = '#e8dfc6';
const STRAP = '#4a3c33';
const BUCKLE = '#9aa1ab';
const GUARD_CX = 0.5;
const GUARD_SHAPE: readonly IconPoint[] = [
  [0.23, 0.14, 0.1],
  [0.77, 0.14, 0.1],
  [0.75, 0.58, 0.12],
  [0.5, 0.94, 0.06],
  [0.25, 0.58, 0.12],
];
/** Matte: a small, dull lit band and a broad shaded flank, curving across the guard's width. */
const GUARD_LIGHT = 0.22;
const GUARD_SHADE = -0.4;
const GUARD_LIGHT_UNTIL = 0.26;
const GUARD_MID_UNTIL = 0.62;
const GUARD_LEFT = 0.23;
const GUARD_RIGHT = 0.77;
/** The knee ridge: a raised band, lit along its top and shadowed under its bottom. */
const RIDGE_TOP = 0.45;
const RIDGE_BOTTOM = 0.53;
const RIDGE_LIGHT = 0.3;
const KNEE_STRAP_YS = [0.24, 0.6] as const;
const KNEE_STRAP_HEIGHT = 0.07;
const KNEE_STRAP_REACH = 0.17;
const STRAP_BUCKLE_HALF = 0.025;
const STRAP_BUCKLE_INSET = 0.07;
/** The strap fans down as it leaves the guard, so its buckle sits a little below the strap's root. */
const BUCKLE_DROP_FRACTION = 0.75;
/** One claw, riveted at its root just under the ridge, hooking down past the guard's point. */
const CLAW_ROOT: readonly [number, number] = [0.5, 0.58];
const CLAW_TIP: readonly [number, number] = [0.43, 0.98];
const CLAW_HALF_BASE = 0.055;
/** A claw hooks as it runs: its curve bulges this fraction of its length off the straight line. */
const CLAW_HOOK = 0.15;
const CLAW_LIT_UNTIL = 0.5;
const CLAW_RIVET_R = 0.03;
const TOP_RIVET_XS = [0.32, 0.68] as const;
const TOP_RIVET_Y = 0.2;
const RIVET_R = 0.028;

/**
 * Grull war gauntlet: a clenched fist in three-quarter view, knuckles toward
 * the viewer. Painted upright, then leaned back so the knuckle spikes point up
 * and left, over a cuff that flares toward the forearm.
 */
const ORC_STEEL = '#66737c';
const SPIKE = '#d7dde2';
const GAUNTLET_TILT = -0.42;
const GAUNTLET_PIVOT: readonly [number, number] = [0.5, 0.52];
const GAUNTLET_SCALE = 0.84;
const GAUNTLET_CUFF: readonly IconPoint[] = [
  [0.33, 0.62],
  [0.67, 0.62],
  [0.81, 0.94, 0.03],
  [0.19, 0.94, 0.03],
];
const CUFF_RIM_Y = 0.85;
const CUFF_RIVET_XS = [0.33, 0.5, 0.67] as const;
const CUFF_RIVET_Y = 0.74;
const CUFF_RIVET_R = 0.032;
const HAND_PLATE: readonly IconPoint[] = [
  [0.2, 0.3, 0.08],
  [0.8, 0.3, 0.08],
  [0.78, 0.68, 0.08],
  [0.24, 0.68, 0.08],
];
const FINGER_LEFT = 0.2;
const FINGER_RIGHT = 0.8;
const FINGER_COUNT = 4;
const FINGER_TOP = 0.37;
const FINGER_BOTTOM = 0.56;
const FINGER_CORNER = 0.05;
const FINGER_LAME_FRACTION = 0.5;
/** Knuckle plates overlap like shingles, each laid over the one to its right. */
const KNUCKLE_TOP = 0.22;
const KNUCKLE_BOTTOM = 0.39;
const KNUCKLE_OVERLAP = 0.03;
const KNUCKLE_CORNER = 0.06;
const SPIKE_LEAN = -0.08;
const SPIKE_HEIGHT = 0.17;
const SPIKE_HALF_BASE = 0.035;
const SPIKE_LIT_UNTIL = 0.5;
/** The thumb is its own two-lame plate, wrapped across the front of the curled fingers. */
const THUMB: readonly IconPoint[] = [
  [0.1, 0.45, 0.07],
  [0.64, 0.47, 0.07],
  [0.68, 0.66, 0.07],
  [0.14, 0.68, 0.07],
];
const THUMB_LAMES: readonly (readonly IconPoint[])[] = [
  [
    [0.3, 0.46],
    [0.31, 0.67],
  ],
  [
    [0.48, 0.47],
    [0.49, 0.67],
  ],
];
const THUMB_NAIL: readonly IconPoint[] = [
  [0.56, 0.49],
  [0.64, 0.5, 0.04],
  [0.66, 0.63, 0.04],
  [0.56, 0.64],
];
const GAUNTLET_GLINT: readonly [number, number] = [0.25, 0.28];
const GAUNTLET_GLINT_R = 0.05;

const ICON_CX = 0.5;
const OUTLINE_WIDTH = 1;
const WOOD = '#8a5a30';
const WOOD_SHADE = '#5c3b1e';
const BAND = '#3b3b3b';
const PEBBLE = '#9b9b9b';
const SLING_HANDLE_BOTTOM = 0.9;
const SLING_HANDLE_TOP = 0.56;
const SLING_HANDLE_HALF_WIDTH = 0.055;
const SLING_FORK_LEFT_X = 0.24;
const SLING_FORK_RIGHT_X = 0.76;
const SLING_FORK_TOP_Y = 0.24;
const SLING_PRONG_WIDTH = 0.09;
const SLING_BAND_SAG = 0.16;
/** A quadratic curve only reaches halfway to its control point, so the control sits twice the pouch's sag below the fork. */
const SLING_BAND_CONTROL_SAG = SLING_BAND_SAG * 2;
const SLING_BAND_WIDTH = 0.05;
const SLING_POUCH_R = 0.075;
const SLING_LOOSE_PEBBLE_R = 0.05;
const SLING_LOOSE_PEBBLE_Y = 0.9;
const SLING_LOOSE_PEBBLE_NEAR_X = 0.14;
const SLING_LOOSE_PEBBLE_FAR_X = 0.28;
const SLING_LOOSE_PEBBLE_XS = [SLING_LOOSE_PEBBLE_NEAR_X, SLING_LOOSE_PEBBLE_FAR_X] as const;

/** Draws one enchanted piece into the largest square centred in `rect`. */
export function drawEnchantedGearIcon(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  id: EnchantedGearItemId,
): void {
  if (id === 'slingshot') {
    const { x, y, size } = iconSquare(rect);
    drawSlingshot(ctx, x, y, size);
    return;
  }
  paintIconArt(ctx, rect, (art, px) => {
    switch (id) {
      case 'nightgaunt_cloak':
        paintNightgauntCloak(art, px);
        return;
      case 'slate_butterfly_talisman':
        paintButterflyTalisman(art, px);
        return;
      case 'fae_scale_crupper':
        paintFaeScaleCrupper(art, px);
        return;
      case 'bracelet_of_dex':
        paintBracelet(art, px);
        return;
      case 'splatter_skunk_toe_ring':
        paintToeRing(art, px);
        return;
      case 'shade_gnoll_kneepads':
        paintKneepads(art, px);
        return;
      case 'grull_war_gauntlet':
        paintWarGauntlet(art, px);
        return;
    }
  });
}

function traceCape(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(CLOAK_NECK_LEFT[0], CLOAK_NECK_LEFT[1]);
  ctx.arcTo(
    CLOAK_LEFT_SHOULDER[0],
    CLOAK_LEFT_SHOULDER[1],
    CLOAK_HEM_POINTS[0][0],
    CLOAK_HEM_POINTS[0][1],
    CLOAK_LEFT_SHOULDER[2] ?? 0,
  );
  ctx.lineTo(CLOAK_HEM_POINTS[0][0], CLOAK_HEM_POINTS[0][1]);
  for (let i = 1; i < CLOAK_HEM_POINTS.length; i++) {
    const [prevX, prevY] = CLOAK_HEM_POINTS[i - 1];
    const [hemX, hemY] = CLOAK_HEM_POINTS[i];
    ctx.quadraticCurveTo((prevX + hemX) / 2, (prevY + hemY) / 2 - CLOAK_HEM_ARC_RISE, hemX, hemY);
  }
  ctx.arcTo(
    CLOAK_RIGHT_SHOULDER[0],
    CLOAK_RIGHT_SHOULDER[1],
    CLOAK_NECK_RIGHT[0],
    CLOAK_NECK_RIGHT[1],
    CLOAK_RIGHT_SHOULDER[2] ?? 0,
  );
  ctx.lineTo(CLOAK_NECK_RIGHT[0], CLOAK_NECK_RIGHT[1]);
  ctx.closePath();
}

function paintNightgauntCloak(ctx: CanvasRenderingContext2D, px: number): void {
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, HOOD),
    litFill(ctx, tone(CLOAK, SHADE / 2), HOOD_LIGHT_FROM, HOOD_LIGHT_TO),
  );
  traceEllipse(ctx, HOOD_VOID_CX, HOOD_VOID_CY, HOOD_VOID_RX, HOOD_VOID_RY);
  ctx.fillStyle = ICON_OUTLINE;
  ctx.fill();

  paintForm(ctx, px, () => traceCape(ctx), litFill(ctx, CLOAK, DIAGONAL_FROM, DIAGONAL_TO));
  withShapeClip(
    ctx,
    () => traceCape(ctx),
    () => {
      for (let i = 1; i < CLOAK_HEM_POINTS.length; i++) {
        const valleyX = (CLOAK_HEM_POINTS[i - 1][0] + CLOAK_HEM_POINTS[i][0]) / 2;
        const valleyY = (CLOAK_HEM_POINTS[i - 1][1] + CLOAK_HEM_POINTS[i][1]) / 2;
        tracePoints(ctx, [
          [CLOAK_FOLD_APEX[0], CLOAK_FOLD_APEX[1]],
          [valleyX - CLOAK_FOLD_HALF, valleyY],
          [valleyX + CLOAK_FOLD_HALF * 2, valleyY],
        ]);
        ctx.fillStyle = tone(CLOAK, SHADE);
        ctx.fill();
      }
      tracePoints(ctx, CLOAK_OPENING);
      ctx.fillStyle = CLOAK_LINING;
      ctx.fill();
      ctx.strokeStyle = ICON_OUTLINE;
      ctx.lineWidth = hairlineWidth(px);
      ctx.stroke();
    },
  );
  paintForm(
    ctx,
    px,
    () => traceEllipse(ctx, CLASP_CX, CLASP_CY, CLASP_R, CLASP_R),
    litFill(
      ctx,
      SILVER,
      [CLASP_CX - CLASP_R, CLASP_CY - CLASP_R],
      [CLASP_CX + CLASP_R, CLASP_CY + CLASP_R],
    ),
  );
  disc(ctx, CLASP_CX, CLASP_CY, CLASP_GEM_R, CLASP_GEM);
  glint(ctx, CLASP_CX - CLASP_GEM_R / 2, CLASP_CY - CLASP_GEM_R / 2, CLASP_GEM_R);
}

function traceWings(ctx: CanvasRenderingContext2D, wing: readonly IconPoint[]): void {
  ctx.beginPath();
  appendPoints(ctx, wing);
  appendPoints(
    ctx,
    wing.map(([wx, wy, radius]): IconPoint => [2 * BUTTERFLY_BODY_CX - wx, wy, radius ?? 0]),
  );
}

function paintButterflyTalisman(ctx: CanvasRenderingContext2D, px: number): void {
  strokeDetail(ctx, px, RING_LINK, ICON_OUTLINE, WING_RIM_SCALE * 2);
  strokeDetail(ctx, px, RING_LINK, SILVER, WING_RIM_SCALE);
  ctx.beginPath();
  ctx.arc(RING_CX, RING_CY, RING_R, 0, FULL_TURN);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = RING_BAND + outlineWidth(px) * 2;
  ctx.stroke();
  ctx.strokeStyle = litFill(
    ctx,
    SILVER,
    [RING_CX - RING_R, RING_CY - RING_R],
    [RING_CX + RING_R, RING_CY + RING_R],
  );
  ctx.lineWidth = RING_BAND;
  ctx.stroke();

  for (const antenna of ANTENNAE) strokeDetail(ctx, px, antenna, ICON_OUTLINE, WING_RIM_SCALE);

  for (const wing of [BUTTERFLY_UPPER_WING, BUTTERFLY_LOWER_WING]) {
    const trace = (): void => traceWings(ctx, wing);
    paintForm(ctx, px, trace, litFill(ctx, SLATE, DIAGONAL_FROM, DIAGONAL_TO));
    withShapeClip(ctx, trace, () => {
      for (const vein of WING_VEINS) {
        strokeDetail(ctx, px, vein, tone(SLATE, DEEP_SHADE));
        strokeDetail(
          ctx,
          px,
          vein.map(([vx, vy]): IconPoint => [2 * BUTTERFLY_BODY_CX - vx, vy]),
          tone(SLATE, DEEP_SHADE),
        );
      }
    });
    trace();
    ctx.strokeStyle = SILVER;
    ctx.lineWidth = hairlineWidth(px) * WING_RIM_SCALE;
    ctx.stroke();
  }

  const traceBody = (dx: number, dy: number): void =>
    traceEllipse(
      ctx,
      BUTTERFLY_BODY_CX + dx,
      BUTTERFLY_BODY_CY + dy,
      BUTTERFLY_BODY_RX,
      BUTTERFLY_BODY_RY,
    );
  paintForm(ctx, px, () => traceBody(0, 0), tone(SILVER, LIGHT));
  offsetShade(ctx, traceBody, [[tone(SILVER, SHADE), BUTTERFLY_BODY_RX, 0]]);
  for (const segmentY of BUTTERFLY_BODY_SEGMENTS) {
    strokeDetail(
      ctx,
      px,
      [
        [BUTTERFLY_BODY_CX - BUTTERFLY_BODY_SEGMENT_HALF, segmentY],
        [BUTTERFLY_BODY_CX + BUTTERFLY_BODY_SEGMENT_HALF, segmentY],
      ],
      ICON_OUTLINE,
    );
  }
  glint(ctx, TALISMAN_GLINT[0], TALISMAN_GLINT[1], TALISMAN_GLINT_R);
}

function traceArch(ctx: CanvasRenderingContext2D, dx = 0, dy = 0): void {
  ctx.beginPath();
  ctx.ellipse(ARCH_CX + dx, ARCH_BASE_Y + dy, ARCH_OUTER_RX, ARCH_OUTER_RY, 0, Math.PI, 0);
  ctx.lineTo(ARCH_CX + ARCH_INNER_RX + dx, ARCH_BASE_Y + dy);
  ctx.ellipse(ARCH_CX + dx, ARCH_BASE_Y + dy, ARCH_INNER_RX, ARCH_INNER_RY, 0, 0, Math.PI, true);
  ctx.closePath();
}

function paintFaeScaleCrupper(ctx: CanvasRenderingContext2D, px: number): void {
  for (const strap of SIDE_STRAPS) paintForm(ctx, px, () => tracePoints(ctx, strap), STRAP_LEATHER);
  for (const buckleX of SIDE_BUCKLE_XS) {
    paintForm(
      ctx,
      px,
      () =>
        tracePoints(ctx, [
          [buckleX - SIDE_BUCKLE_HALF, SIDE_BUCKLE_Y - SIDE_BUCKLE_HALF * 2],
          [buckleX + SIDE_BUCKLE_HALF, SIDE_BUCKLE_Y - SIDE_BUCKLE_HALF * 2],
          [buckleX + SIDE_BUCKLE_HALF, SIDE_BUCKLE_Y + SIDE_BUCKLE_HALF * 2],
          [buckleX - SIDE_BUCKLE_HALF, SIDE_BUCKLE_Y + SIDE_BUCKLE_HALF * 2],
        ]),
      GOLD,
    );
  }

  paintForm(ctx, px, () => traceArch(ctx), FAE_STEEL_LIGHT);
  offsetShade(ctx, (dx, dy) => traceArch(ctx, dx, dy), [
    [FAE_STEEL, CRUPPER_MID_SHIFT[0], CRUPPER_MID_SHIFT[1]],
    [FAE_STEEL_SHADE, CRUPPER_SHADE_SHIFT[0], CRUPPER_SHADE_SHIFT[1]],
  ]);
  withShapeClip(
    ctx,
    () => traceArch(ctx),
    () => {
      ctx.strokeStyle = FAE_SCALE_EDGE;
      ctx.lineWidth = hairlineWidth(px);
      SCALE_ROW_FRACTIONS.forEach((fraction, row) => {
        const rx = ARCH_INNER_RX + (ARCH_OUTER_RX - ARCH_INNER_RX) * fraction;
        const ry = ARCH_INNER_RY + (ARCH_OUTER_RY - ARCH_INNER_RY) * fraction;
        const stagger = row % 2 === 0 ? 0 : 1 / 2;
        ctx.beginPath();
        for (let step = 0; step <= SCALE_STEPS_PER_ROW; step++) {
          const angle = Math.PI + ((step + stagger) / SCALE_STEPS_PER_ROW) * Math.PI;
          const sx = ARCH_CX + Math.cos(angle) * rx;
          const sy = ARCH_BASE_Y + Math.sin(angle) * ry;
          // Each scale's free edge faces down the slope, away from the arch's crown.
          ctx.moveTo(
            sx + Math.cos(angle - Math.PI / 2) * SCALE_R,
            sy + Math.sin(angle - Math.PI / 2) * SCALE_R,
          );
          ctx.arc(sx, sy, SCALE_R, angle - Math.PI / 2, angle + Math.PI / 2, true);
        }
        ctx.stroke();
      });
    },
  );
  traceArch(ctx);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = hairlineWidth(px) * BOLD_DETAIL;
  ctx.stroke();

  const dockTop = ARCH_BASE_Y - ARCH_INNER_RY;
  paintForm(
    ctx,
    px,
    () =>
      tracePoints(ctx, [
        [TAIL_LOOP_CX - DOCK_STRAP_HALF, dockTop],
        [TAIL_LOOP_CX + DOCK_STRAP_HALF, dockTop],
        [TAIL_LOOP_CX + DOCK_STRAP_HALF, TAIL_LOOP_CY - TAIL_LOOP_R],
        [TAIL_LOOP_CX - DOCK_STRAP_HALF, TAIL_LOOP_CY - TAIL_LOOP_R],
      ]),
    cylinderFill(
      ctx,
      STRAP_LEATHER,
      TAIL_LOOP_CX - DOCK_STRAP_HALF,
      TAIL_LOOP_CX + DOCK_STRAP_HALF,
    ),
  );
  ctx.beginPath();
  ctx.arc(TAIL_LOOP_CX, TAIL_LOOP_CY, TAIL_LOOP_R, 0, FULL_TURN);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = TAIL_LOOP_BAND + outlineWidth(px) * 2;
  ctx.stroke();
  ctx.strokeStyle = cylinderFill(
    ctx,
    STRAP_LEATHER,
    TAIL_LOOP_CX - TAIL_LOOP_R,
    TAIL_LOOP_CX + TAIL_LOOP_R,
  );
  ctx.lineWidth = TAIL_LOOP_BAND;
  ctx.stroke();
  glint(ctx, CRUPPER_GLINT[0], CRUPPER_GLINT[1], CRUPPER_GLINT_R);
}

function paintBracelet(ctx: CanvasRenderingContext2D, px: number): void {
  const topCy = BANGLE_CY - BANGLE_HEIGHT / 2;
  const bottomCy = BANGLE_CY + BANGLE_HEIGHT / 2;
  const innerRx = BANGLE_RX - BANGLE_WALL;
  const innerRy = BANGLE_RY - BANGLE_WALL / 2;
  const traceSilhouette = (): void => {
    ctx.beginPath();
    ctx.ellipse(BANGLE_CX, topCy, BANGLE_RX, BANGLE_RY, 0, Math.PI, 0);
    ctx.lineTo(BANGLE_CX + BANGLE_RX, bottomCy);
    ctx.ellipse(BANGLE_CX, bottomCy, BANGLE_RX, BANGLE_RY, 0, 0, Math.PI);
    ctx.closePath();
  };
  // The hole through the bangle: where the top opening and the bottom opening overlap.
  const traceHole = (): void =>
    traceEllipse(ctx, BANGLE_CX, BANGLE_CY, innerRx, innerRy - BANGLE_HEIGHT / 2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 1, 1);
  ctx.ellipse(BANGLE_CX, BANGLE_CY, innerRx, innerRy - BANGLE_HEIGHT / 2, 0, 0, FULL_TURN);
  ctx.clip('evenodd');

  paintForm(
    ctx,
    px,
    traceSilhouette,
    cylinderFill(ctx, GOLD, BANGLE_CX - BANGLE_RX, BANGLE_CX + BANGLE_RX),
  );
  traceEllipse(ctx, BANGLE_CX, topCy, BANGLE_RX, BANGLE_RY);
  ctx.fillStyle = tone(GOLD, LIGHT);
  ctx.fill();
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = hairlineWidth(px);
  ctx.stroke();
  traceEllipse(ctx, BANGLE_CX, topCy, innerRx, innerRy);
  ctx.fillStyle = cylinderFill(
    ctx,
    tone(GOLD, DEEP_SHADE),
    BANGLE_CX + innerRx,
    BANGLE_CX - innerRx,
  );
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(
    BANGLE_CX,
    BANGLE_CY + BANGLE_HEIGHT * BANGLE_GROOVE_INSET,
    BANGLE_RX,
    BANGLE_RY,
    0,
    0,
    Math.PI,
  );
  ctx.strokeStyle = tone(GOLD, SHADE);
  ctx.stroke();
  ctx.restore();

  traceHole();
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = hairlineWidth(px);
  ctx.stroke();

  const gemCx = BANGLE_CX;
  const gemCy = bottomCy + BANGLE_RY - BANGLE_GEM_CY_OFFSET;
  const traceGem = (dx: number, dy: number): void =>
    traceEllipse(ctx, gemCx + dx, gemCy + dy, BANGLE_GEM_RX, BANGLE_GEM_RY);
  paintForm(ctx, px, () => traceGem(0, 0), tone(BANGLE_GEM, LIGHT));
  offsetShade(ctx, traceGem, [
    [BANGLE_GEM, BANGLE_GEM_RX * GEM_LIT_FRACTION, BANGLE_GEM_RY * GEM_LIT_FRACTION],
    [tone(BANGLE_GEM, DEEP_SHADE), BANGLE_GEM_RX, BANGLE_GEM_RY],
  ]);
  glint(
    ctx,
    gemCx - BANGLE_GEM_RX * GEM_LIT_FRACTION,
    gemCy - BANGLE_GEM_RY * GEM_LIT_FRACTION,
    BANGLE_GEM_GLINT_R,
  );
  glint(ctx, BANGLE_SIDE_GLINT[0], BANGLE_SIDE_GLINT[1], BANGLE_SIDE_GLINT_R);
}

function paintToeRing(ctx: CanvasRenderingContext2D, px: number): void {
  for (const wisp of STINK_WISPS) {
    strokeDetail(ctx, px, wisp, ICON_OUTLINE, STINK_WIDTH_SCALE * 2);
    strokeDetail(ctx, px, wisp, STINK, STINK_WIDTH_SCALE);
  }
  const holeCx = TOE_RING_CX + TOE_HOLE_SHIFT[0];
  const holeCy = TOE_RING_CY + TOE_HOLE_SHIFT[1];
  const traceBand = (): void => {
    ctx.beginPath();
    ctx.ellipse(TOE_RING_CX, TOE_RING_CY, TOE_RING_RX, TOE_RING_RY, 0, 0, FULL_TURN);
    ctx.moveTo(holeCx + TOE_HOLE_RX, holeCy);
    ctx.ellipse(holeCx, holeCy, TOE_HOLE_RX, TOE_HOLE_RY, 0, 0, FULL_TURN);
  };
  traceBand();
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = outlineWidth(px) * 2;
  ctx.stroke();
  ctx.fillStyle = litFill(
    ctx,
    BRASS,
    [TOE_RING_CX - TOE_RING_RX, TOE_RING_CY - TOE_RING_RY],
    [TOE_RING_CX + TOE_RING_RX, TOE_RING_CY + TOE_RING_RY],
  );
  ctx.fill('evenodd');

  ctx.save();
  traceEllipse(ctx, holeCx, holeCy, TOE_HOLE_RX, TOE_HOLE_RY);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(holeCx, holeCy, TOE_HOLE_RX, TOE_HOLE_RY, 0, 0, FULL_TURN);
  ctx.moveTo(holeCx - TOE_INNER_WALL_SHIFT + TOE_HOLE_RX, holeCy);
  ctx.ellipse(holeCx - TOE_INNER_WALL_SHIFT, holeCy, TOE_HOLE_RX, TOE_HOLE_RY, 0, 0, FULL_TURN);
  ctx.fillStyle = tone(BRASS, SHADE);
  ctx.fill('evenodd');
  ctx.restore();

  const stoneCx = TOE_RING_CX;
  paintForm(
    ctx,
    px,
    () => traceEllipse(ctx, stoneCx, SKUNK_STONE_CY, SKUNK_STONE_RX, SKUNK_STONE_RY),
    SKUNK_BLACK,
    tone(BRASS, SHADE),
  );
  withShapeClip(
    ctx,
    () => traceEllipse(ctx, stoneCx, SKUNK_STONE_CY, SKUNK_STONE_RX, SKUNK_STONE_RY),
    () => {
      ctx.fillStyle = SKUNK_WHITE;
      ctx.fillRect(stoneCx - SKUNK_STRIPE_HALF, 0, SKUNK_STRIPE_HALF * 2, 1);
    },
  );
  glint(ctx, SKUNK_GLINT[0], SKUNK_GLINT[1], SKUNK_GLINT_R);
  glint(ctx, TOE_RING_GLINT[0], TOE_RING_GLINT[1], TOE_RING_GLINT_R);
}

function paintClaw(ctx: CanvasRenderingContext2D, px: number): void {
  const [baseX, baseY] = CLAW_ROOT;
  const [tipX, tipY] = CLAW_TIP;
  const length = Math.hypot(tipX - baseX, tipY - baseY);
  const normalX = -(tipY - baseY) / length;
  const normalY = (tipX - baseX) / length;
  const midX = (baseX + tipX) / 2 + normalX * length * CLAW_HOOK;
  const midY = (baseY + tipY) / 2 + normalY * length * CLAW_HOOK;
  const halfMid = CLAW_HALF_BASE / 2;
  paintForm(
    ctx,
    px,
    () => {
      ctx.beginPath();
      ctx.moveTo(baseX - normalX * CLAW_HALF_BASE, baseY - normalY * CLAW_HALF_BASE);
      ctx.quadraticCurveTo(midX - normalX * halfMid, midY - normalY * halfMid, tipX, tipY);
      ctx.quadraticCurveTo(
        midX + normalX * halfMid,
        midY + normalY * halfMid,
        baseX + normalX * CLAW_HALF_BASE,
        baseY + normalY * CLAW_HALF_BASE,
      );
      ctx.closePath();
    },
    bandedFill(
      ctx,
      [baseX - CLAW_HALF_BASE, 0],
      [baseX + CLAW_HALF_BASE, 0],
      [
        [tone(CLAW, LIGHT / 2), CLAW_LIT_UNTIL],
        [tone(CLAW, SHADE), 1],
      ],
    ),
  );
  rivet(ctx, px, baseX, baseY, CLAW_RIVET_R, BUCKLE);
}

function paintKneepads(ctx: CanvasRenderingContext2D, px: number): void {
  for (const strapY of KNEE_STRAP_YS) {
    for (const side of [-1, 1]) {
      const inner = GUARD_CX + side * (GUARD_RIGHT - GUARD_CX - STRAP_BUCKLE_INSET);
      const outer = GUARD_CX + side * (GUARD_RIGHT - GUARD_CX + KNEE_STRAP_REACH);
      paintForm(
        ctx,
        px,
        () =>
          tracePoints(ctx, [
            [inner, strapY],
            [outer, strapY + KNEE_STRAP_HEIGHT / 2],
            [outer, strapY + KNEE_STRAP_HEIGHT + KNEE_STRAP_HEIGHT / 2],
            [inner, strapY + KNEE_STRAP_HEIGHT],
          ]),
        STRAP,
      );
      const buckleX = GUARD_CX + side * (GUARD_RIGHT - GUARD_CX + STRAP_BUCKLE_INSET);
      const buckleY = strapY + KNEE_STRAP_HEIGHT * BUCKLE_DROP_FRACTION;
      paintForm(
        ctx,
        px,
        () =>
          tracePoints(ctx, [
            [buckleX - STRAP_BUCKLE_HALF, buckleY - STRAP_BUCKLE_HALF * 2],
            [buckleX + STRAP_BUCKLE_HALF, buckleY - STRAP_BUCKLE_HALF * 2],
            [buckleX + STRAP_BUCKLE_HALF, buckleY + STRAP_BUCKLE_HALF * 2],
            [buckleX - STRAP_BUCKLE_HALF, buckleY + STRAP_BUCKLE_HALF * 2],
          ]),
        BUCKLE,
      );
    }
  }

  const traceGuard = (): void => tracePoints(ctx, GUARD_SHAPE);
  paintForm(
    ctx,
    px,
    traceGuard,
    bandedFill(
      ctx,
      [GUARD_LEFT, 0],
      [GUARD_RIGHT, 0],
      [
        [tone(GUARD_IRON, GUARD_LIGHT), GUARD_LIGHT_UNTIL],
        [GUARD_IRON, GUARD_MID_UNTIL],
        [tone(GUARD_IRON, GUARD_SHADE), 1],
      ],
    ),
  );
  withShapeClip(ctx, traceGuard, () => {
    ctx.fillStyle = bandedFill(
      ctx,
      [0, RIDGE_TOP],
      [0, RIDGE_BOTTOM],
      [
        [tone(GUARD_IRON, RIDGE_LIGHT), LIGHT_BAND_UNTIL],
        [tone(GUARD_IRON, GUARD_SHADE / 2), 1],
      ],
    );
    ctx.fillRect(0, RIDGE_TOP, 1, RIDGE_BOTTOM - RIDGE_TOP);
    strokeDetail(
      ctx,
      px,
      [
        [0, RIDGE_TOP],
        [1, RIDGE_TOP],
      ],
      ICON_OUTLINE,
    );
    strokeDetail(
      ctx,
      px,
      [
        [0, RIDGE_BOTTOM],
        [1, RIDGE_BOTTOM],
      ],
      ICON_OUTLINE,
      BOLD_DETAIL,
    );
  });
  for (const rivetX of TOP_RIVET_XS) rivet(ctx, px, rivetX, TOP_RIVET_Y, RIVET_R, BUCKLE);
  paintClaw(ctx, px);
}

function paintWarGauntlet(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.save();
  ctx.translate(GAUNTLET_PIVOT[0], GAUNTLET_PIVOT[1]);
  ctx.rotate(GAUNTLET_TILT);
  ctx.scale(GAUNTLET_SCALE, GAUNTLET_SCALE);
  ctx.translate(-GAUNTLET_PIVOT[0], -GAUNTLET_PIVOT[1]);
  const unitPx = px / GAUNTLET_SCALE;

  paintForm(
    ctx,
    unitPx,
    () => tracePoints(ctx, GAUNTLET_CUFF),
    cylinderFill(ctx, ORC_STEEL, GAUNTLET_CUFF[3][0], GAUNTLET_CUFF[2][0]),
  );
  withShapeClip(
    ctx,
    () => tracePoints(ctx, GAUNTLET_CUFF),
    () => {
      ctx.fillStyle = tone(ORC_STEEL, SHADE);
      ctx.fillRect(0, CUFF_RIM_Y, 1, 1 - CUFF_RIM_Y);
      strokeDetail(
        ctx,
        unitPx,
        [
          [0, CUFF_RIM_Y],
          [1, CUFF_RIM_Y],
        ],
        ICON_OUTLINE,
      );
    },
  );
  for (const rivetX of CUFF_RIVET_XS) rivet(ctx, unitPx, rivetX, CUFF_RIVET_Y, CUFF_RIVET_R, BRASS);

  paintForm(ctx, unitPx, () => tracePoints(ctx, HAND_PLATE), tone(ORC_STEEL, SHADE));

  const fingerWidth = (FINGER_RIGHT - FINGER_LEFT) / FINGER_COUNT;
  const lameY = FINGER_TOP + (FINGER_BOTTOM - FINGER_TOP) * FINGER_LAME_FRACTION;
  for (let finger = 0; finger < FINGER_COUNT; finger++) {
    const left = FINGER_LEFT + finger * fingerWidth;
    const right = left + fingerWidth;
    paintForm(
      ctx,
      unitPx,
      () =>
        tracePoints(ctx, [
          [left, FINGER_TOP, FINGER_CORNER],
          [right, FINGER_TOP, FINGER_CORNER],
          [right, FINGER_BOTTOM, FINGER_CORNER],
          [left, FINGER_BOTTOM, FINGER_CORNER],
        ]),
      cylinderFill(ctx, ORC_STEEL, left, right),
    );
    strokeDetail(
      ctx,
      unitPx,
      [
        [left, lameY],
        [right, lameY],
      ],
      ICON_OUTLINE,
    );
  }

  for (let finger = FINGER_COUNT - 1; finger >= 0; finger--) {
    const left = FINGER_LEFT + finger * fingerWidth - KNUCKLE_OVERLAP;
    const right = FINGER_LEFT + (finger + 1) * fingerWidth + KNUCKLE_OVERLAP;
    const cx = (left + right) / 2;
    const spikeBaseY = KNUCKLE_TOP + SPIKE_HALF_BASE;
    paintForm(
      ctx,
      unitPx,
      () =>
        tracePoints(ctx, [
          [cx - SPIKE_HALF_BASE, spikeBaseY],
          [cx + SPIKE_LEAN, KNUCKLE_TOP - SPIKE_HEIGHT],
          [cx + SPIKE_HALF_BASE, spikeBaseY],
        ]),
      bandedFill(
        ctx,
        [cx - SPIKE_HALF_BASE, 0],
        [cx + SPIKE_HALF_BASE, 0],
        [
          [tone(SPIKE, LIGHT), SPIKE_LIT_UNTIL],
          [tone(SPIKE, SHADE), 1],
        ],
      ),
    );
    paintForm(
      ctx,
      unitPx,
      () =>
        tracePoints(ctx, [
          [left, KNUCKLE_TOP, KNUCKLE_CORNER],
          [right, KNUCKLE_TOP, KNUCKLE_CORNER],
          [right, KNUCKLE_BOTTOM, KNUCKLE_CORNER / 2],
          [left, KNUCKLE_BOTTOM, KNUCKLE_CORNER / 2],
        ]),
      litFill(ctx, tone(ORC_STEEL, LIGHT / 2), [left, KNUCKLE_TOP], [right, KNUCKLE_BOTTOM]),
    );
  }

  paintForm(
    ctx,
    unitPx,
    () => tracePoints(ctx, THUMB),
    litFill(ctx, ORC_STEEL, [THUMB[0][0], THUMB[0][1]], [THUMB[2][0], THUMB[2][1]]),
  );
  for (const lame of THUMB_LAMES) strokeDetail(ctx, unitPx, lame, ICON_OUTLINE, BOLD_DETAIL);
  paintForm(ctx, unitPx, () => tracePoints(ctx, THUMB_NAIL), tone(ORC_STEEL, LIGHT));
  glint(ctx, GAUNTLET_GLINT[0], GAUNTLET_GLINT[1], GAUNTLET_GLINT_R);
  ctx.restore();
}

function drawSlingshot(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const cx = x + size * ICON_CX;
  const forkY = y + size * SLING_FORK_TOP_Y;
  const leftForkX = x + size * SLING_FORK_LEFT_X;
  const rightForkX = x + size * SLING_FORK_RIGHT_X;
  const handleTop = y + size * SLING_HANDLE_TOP;

  ctx.fillStyle = WOOD;
  ctx.fillRect(
    cx - size * SLING_HANDLE_HALF_WIDTH,
    handleTop,
    size * SLING_HANDLE_HALF_WIDTH * 2,
    y + size * SLING_HANDLE_BOTTOM - handleTop,
  );

  ctx.strokeStyle = WOOD;
  ctx.lineWidth = size * SLING_PRONG_WIDTH;
  ctx.lineCap = 'round';
  for (const prongX of [leftForkX, rightForkX]) {
    ctx.beginPath();
    ctx.moveTo(cx, handleTop);
    ctx.lineTo(prongX, forkY);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  ctx.strokeStyle = WOOD_SHADE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(cx, handleTop);
  ctx.lineTo(cx, y + size * SLING_HANDLE_BOTTOM);
  ctx.stroke();

  // The sagging band plus a pebble in it is what says "loaded", not "wishbone".
  ctx.strokeStyle = BAND;
  ctx.lineWidth = size * SLING_BAND_WIDTH;
  ctx.beginPath();
  ctx.moveTo(leftForkX, forkY);
  ctx.quadraticCurveTo(cx, forkY + size * SLING_BAND_CONTROL_SAG, rightForkX, forkY);
  ctx.stroke();

  ctx.fillStyle = PEBBLE;
  ctx.beginPath();
  ctx.arc(cx, forkY + size * SLING_BAND_SAG, size * SLING_POUCH_R, 0, FULL_TURN);
  ctx.fill();

  for (const pebbleX of SLING_LOOSE_PEBBLE_XS) {
    ctx.beginPath();
    ctx.arc(
      x + size * pebbleX,
      y + size * SLING_LOOSE_PEBBLE_Y,
      size * SLING_LOOSE_PEBBLE_R,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }
}
