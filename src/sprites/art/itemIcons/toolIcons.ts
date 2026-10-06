/**
 * Icons for the axe and pickaxe upgrade ladders.
 *
 * One silhouette painter per kind, parameterised by the tier's {@link ToolTierLook}
 * so all six rungs share a shape and differ only in what the look table says —
 * the same table the in-world tool overlay reads, so the icon and the tool a
 * crawler is carrying always agree.
 */

import type { ItemId } from '../../../core/ItemDefs';
import {
  TOOL_TIER_BASIC,
  TOOL_TIER_DEEPWOOD,
  TOOL_TIER_GRAVEYARD,
  TOOL_TIER_HARDENED,
  TOOL_TIER_LONG_HAFT,
  TOOL_TIER_RATKIN_FORGE,
  TOOL_TIER_LOOKS,
  type ToolKind,
  type ToolTier,
  type ToolTierLook,
} from '../../../core/toolTiers';
import type { Rect } from '../../../ui/core/geom';
import {
  BOLD_DETAIL,
  FULL_TURN,
  glint,
  hairlineWidth,
  ICON_OUTLINE,
  litFill,
  paintForm,
  paintIconArt,
  strokeDetail,
  tone,
  tracePoints,
  withShapeClip,
  type IconPoint,
} from './iconPaint';

/** The twelve tool ids this module can draw. Closed, so a new tier cannot ship iconless. */
export type ToolIconId =
  | 'basic_axe'
  | 'hardened_axe'
  | 'lumberjacks_axe'
  | 'ratkin_forge_axe'
  | 'deepwood_cleaver'
  | 'graveyards_bane'
  | 'basic_pickaxe'
  | 'hardened_pickaxe'
  | 'quarrymans_pick'
  | 'ratkin_forge_pick'
  | 'stonebreaker'
  | 'worldscar_pick';

const TOOL_ICON_INFO: Record<ToolIconId, { kind: ToolKind; tier: ToolTier }> = {
  basic_axe: { kind: 'axe', tier: TOOL_TIER_BASIC },
  hardened_axe: { kind: 'axe', tier: TOOL_TIER_HARDENED },
  lumberjacks_axe: { kind: 'axe', tier: TOOL_TIER_LONG_HAFT },
  ratkin_forge_axe: { kind: 'axe', tier: TOOL_TIER_RATKIN_FORGE },
  deepwood_cleaver: { kind: 'axe', tier: TOOL_TIER_DEEPWOOD },
  graveyards_bane: { kind: 'axe', tier: TOOL_TIER_GRAVEYARD },
  basic_pickaxe: { kind: 'pickaxe', tier: TOOL_TIER_BASIC },
  hardened_pickaxe: { kind: 'pickaxe', tier: TOOL_TIER_HARDENED },
  quarrymans_pick: { kind: 'pickaxe', tier: TOOL_TIER_LONG_HAFT },
  ratkin_forge_pick: { kind: 'pickaxe', tier: TOOL_TIER_RATKIN_FORGE },
  stonebreaker: { kind: 'pickaxe', tier: TOOL_TIER_DEEPWOOD },
  worldscar_pick: { kind: 'pickaxe', tier: TOOL_TIER_GRAVEYARD },
};

/** Every id this module can draw, the single source of truth for the id set below and for the icon bake gate. */
export const TOOL_ICON_ID_LIST: readonly ToolIconId[] = [
  'basic_axe',
  'hardened_axe',
  'lumberjacks_axe',
  'ratkin_forge_axe',
  'deepwood_cleaver',
  'graveyards_bane',
  'basic_pickaxe',
  'hardened_pickaxe',
  'quarrymans_pick',
  'ratkin_forge_pick',
  'stonebreaker',
  'worldscar_pick',
];

const TOOL_ICON_IDS: ReadonlySet<string> = new Set<ToolIconId>(TOOL_ICON_ID_LIST);

/** Whether `id` is a tool, and so drawable by {@link drawToolIcon}. */
export function isToolIconId(id: ItemId): id is ToolIconId {
  return TOOL_ICON_IDS.has(id);
}

/**
 * The tool is painted upright in a local frame — haft running down the
 * centre, head at the top, blade or spike reaching left — then turned
 * clockwise about the icon centre, so the haft runs from bottom-left to
 * top-right and the working end reaches up and out to the left, the way a
 * tool lies in every inventory a player has seen.
 */
const TOOL_TILT = 0.72;
const TOOL_PIVOT = 0.5;
/** The tilted head reaches higher than the butt reaches low, so the whole tool sits this far below centre. */
const TOOL_DROP = 0.075;
/** The long-handled tier runs nearly corner to corner, so it sits closer to centre. */
const TOOL_DROP_LONG = 0.02;
/** Shrinks the upright tool about the pivot so the tilted head clears the cell corners. */
const TOOL_SCALE = 0.86;
/** The long-handled tier is shrunk a little more, so its extra haft fits and still reads as extra. */
const TOOL_SCALE_LONG = 0.66;

const HAFT_CX = 0.5;
const HAFT_TOP = 0.16;
const HAFT_BOTTOM = 0.96;
const HAFT_BOTTOM_LONG = 1.36;
const HAFT_HALF_TOP = 0.04;
/** A haft swells toward the hand, which is what makes it read as a turned handle, not a stick. */
const HAFT_HALF_BOTTOM = 0.05;
const KNOB_HALF = 0.064;
const KNOB_HEIGHT = 0.06;
const KNOB_CORNER = 0.03;
const HAFT_GRAIN_OFFSETS = [-0.014, 0.018] as const;
const HAFT_GRAIN_WAVE = 0.006;
const HAFT_GRAIN_STEPS = 6;
const HAFT_GRAIN_START = 0.38;
/** Grip wrap: leather turns near the butt, where a hand actually holds the tool. */
const GRIP_TOP_FROM_BOTTOM = 0.3;
const GRIP_BOTTOM_FROM_BOTTOM = 0.1;
const GRIP_TURNS = 4;
const GRIP_LEATHER = '#3a2617';
/** The lumberjack's grip is wrapped in red flannel, the one woodsman's touch that reads at slot size. */
const GRIP_BY_TOOL: Partial<Record<ToolIconId, string>> = { lumberjacks_axe: '#a3262a' };
/** A binding of the tier's accent colour just under the head, for the tiers whose look has one. */
const BINDING_TOP = 0.35;
const BINDING_HEIGHT = 0.07;
const BINDING_HALF = 0.055;

/** Lit/shaded halves of the round haft: light comes from the local left once the tool is tilted. */
const HAFT_LIGHT_FROM: readonly [number, number] = [HAFT_CX - HAFT_HALF_BOTTOM, 0];
const HAFT_LIGHT_TO: readonly [number, number] = [HAFT_CX + HAFT_HALF_BOTTOM, 0];

const SOCKET_AXE: readonly IconPoint[] = [
  [0.42, 0.13, 0.02],
  [0.6, 0.13, 0.02],
  [0.6, 0.35, 0.02],
  [0.42, 0.35, 0.02],
];
const SOCKET_PICK: readonly IconPoint[] = [
  [0.43, 0.12, 0.02],
  [0.57, 0.12, 0.02],
  [0.57, 0.33, 0.02],
  [0.43, 0.33, 0.02],
];
const POLL_BLOCK: readonly PathOp[] = [
  ['M', 0.58, 0.16],
  ['L', 0.67, 0.17],
  ['L', 0.67, 0.31],
  ['L', 0.58, 0.32],
];
/** Graveyard's Bane carries a back spike where the other axes have a hammer poll. */
const POLL_SPIKE: readonly PathOp[] = [
  ['M', 0.58, 0.17],
  ['L', 0.86, 0.25],
  ['L', 0.58, 0.32],
];

/** One path command in the tool's local frame: move, line, or quadratic curve (control, then end). */
type PathOp =
  | readonly [op: 'M' | 'L', x: number, y: number]
  | readonly [op: 'Q', controlX: number, controlY: number, x: number, y: number];

/**
 * A tool head's silhouette, drawn per tier so the rungs of the ladder differ in
 * shape and not only in colour — at hotbar size colour alone could not tell a
 * basic axe from a lumberjack's.
 */
interface HeadShape {
  /** The closed outline of the blade or pick bar. */
  readonly outline: readonly PathOp[];
  /** The ground edge, stroked along this open path inside the outline. */
  readonly bevel: readonly PathOp[];
  /** Where a soul-green glow runs, for the tier whose look has one. */
  readonly glowEdge: readonly PathOp[];
  readonly glint: readonly [number, number];
  readonly poll?: readonly PathOp[];
  /** A head that needs a taller or heavier eye than its kind's default. */
  readonly socket?: readonly IconPoint[];
  /** Reinforcing bands round the eye, at these heights. */
  readonly collarBands?: readonly number[];
  /** Overrides the kind's bevel depth, for a head whose edge is its whole point. */
  readonly bevelDepth?: number;
}

const BEARDED_EDGE: readonly PathOp[] = [
  ['M', 0.1, 0.06],
  ['Q', 0.0, 0.3, 0.13, 0.55],
];
const BEARDED_AXE: HeadShape = {
  outline: [
    ['M', 0.44, 0.16],
    ['Q', 0.27, 0.15, 0.1, 0.06],
    ['Q', 0.0, 0.3, 0.13, 0.55],
    ['Q', 0.3, 0.36, 0.44, 0.33],
  ],
  bevel: BEARDED_EDGE,
  glowEdge: BEARDED_EDGE,
  glint: [0.13, 0.16],
  poll: POLL_BLOCK,
};
/** The ratkin forge axe: a bearded head with notches hacked into its edge. */
const NOTCHED_EDGE: readonly PathOp[] = [
  ['M', 0.12, 0.06],
  ['L', 0.04, 0.17],
  ['L', 0.12, 0.22],
  ['L', 0.03, 0.31],
  ['L', 0.11, 0.36],
  ['L', 0.05, 0.45],
  ['L', 0.15, 0.57],
];
const NOTCHED_AXE: HeadShape = {
  outline: [
    ['M', 0.44, 0.16],
    ['Q', 0.27, 0.14, 0.12, 0.06],
    ...NOTCHED_EDGE.slice(1),
    ['Q', 0.3, 0.37, 0.44, 0.33],
  ],
  bevel: NOTCHED_EDGE,
  glowEdge: NOTCHED_EDGE,
  glint: [0.14, 0.15],
  poll: POLL_BLOCK,
};
/** The deepwood cleaver: a broad rectangular slab of a blade. */
const CLEAVER_EDGE: readonly PathOp[] = [
  ['M', 0.06, 0.08],
  ['L', 0.03, 0.54],
];
const CLEAVER_AXE: HeadShape = {
  outline: [
    ['M', 0.44, 0.12],
    ['L', 0.06, 0.08],
    ['L', 0.03, 0.54],
    ['L', 0.44, 0.5],
  ],
  bevel: CLEAVER_EDGE,
  glowEdge: CLEAVER_EDGE,
  glint: [0.12, 0.14],
  poll: POLL_BLOCK,
};
/** Graveyard's Bane: a crescent whose horns curl back toward the haft. */
const CRESCENT_EDGE: readonly PathOp[] = [
  ['M', 0.22, 0.02],
  ['Q', -0.14, 0.29, 0.22, 0.58],
];
const CRESCENT_AXE: HeadShape = {
  outline: [
    ['M', 0.44, 0.2],
    ['Q', 0.32, 0.16, 0.22, 0.02],
    ['Q', -0.14, 0.29, 0.22, 0.58],
    ['Q', 0.32, 0.42, 0.44, 0.34],
  ],
  bevel: CRESCENT_EDGE,
  glowEdge: CRESCENT_EDGE,
  glint: [0.14, 0.14],
  poll: POLL_SPIKE,
};

/** The hardened axe: bearded, the lower bit hooked well below the eye, with a wide bright bevel. */
const HOOKED_EDGE: readonly PathOp[] = [
  ['M', 0.14, 0.06],
  ['Q', 0.02, 0.34, 0.16, 0.7],
];
const HOOKED_AXE: HeadShape = {
  outline: [
    ['M', 0.44, 0.16],
    ['Q', 0.3, 0.14, 0.14, 0.06],
    ['Q', 0.02, 0.34, 0.16, 0.7],
    ['L', 0.25, 0.64],
    ['Q', 0.3, 0.42, 0.44, 0.34],
  ],
  bevel: HOOKED_EDGE,
  glowEdge: HOOKED_EDGE,
  glint: [0.14, 0.16],
  poll: POLL_BLOCK,
  bevelDepth: 0.1,
};
/**
 * The lumberjack's felling axe: a tall single bit, straight-sided, flaring
 * from the eye to a long, slightly convex edge — taller than the hatchet's,
 * with no beard.
 */
const FELLING_EDGE: readonly PathOp[] = [
  ['M', 0.12, -0.02],
  ['Q', 0.02, 0.32, 0.12, 0.66],
];
const FELLING_AXE: HeadShape = {
  outline: [
    ['M', 0.44, 0.15],
    ['L', 0.12, -0.02],
    ['Q', 0.02, 0.32, 0.12, 0.66],
    ['L', 0.44, 0.36],
  ],
  bevel: FELLING_EDGE,
  glowEdge: FELLING_EDGE,
  glint: [0.13, 0.08],
  poll: POLL_BLOCK,
  bevelDepth: 0.09,
};

const AXE_HEADS: Record<ToolTier, HeadShape> = {
  0: BEARDED_AXE,
  1: HOOKED_AXE,
  2: FELLING_AXE,
  3: NOTCHED_AXE,
  4: CLEAVER_AXE,
  5: CRESCENT_AXE,
};

/** Pick heads: an arched bar with a spike to the left, and a tier-specific back end to the right. */
const PICK_HEADS: Record<ToolTier, HeadShape> = {
  0: {
    outline: [
      ['M', 0.02, 0.44],
      ['Q', 0.42, -0.04, 0.92, 0.29],
      ['L', 0.88, 0.39],
      ['Q', 0.46, 0.21, 0.02, 0.44],
    ],
    bevel: [
      ['M', 0.92, 0.29],
      ['L', 0.88, 0.39],
    ],
    glowEdge: [
      ['M', 0.02, 0.44],
      ['Q', 0.42, -0.04, 0.92, 0.29],
    ],
    glint: [0.31, 0.23],
  },
  1: {
    outline: [
      ['M', 0.0, 0.38],
      ['Q', 0.5, 0.06, 1.0, 0.38],
      ['Q', 0.5, 0.3, 0.0, 0.38],
    ],
    bevel: [
      ['M', 0.0, 0.38],
      ['L', 0.1, 0.31],
    ],
    glowEdge: [
      ['M', 0.0, 0.38],
      ['Q', 0.5, 0.06, 1.0, 0.38],
    ],
    glint: [0.26, 0.26],
    socket: [
      [0.39, 0.08, 0.02],
      [0.61, 0.08, 0.02],
      [0.61, 0.38, 0.02],
      [0.39, 0.38, 0.02],
    ],
    collarBands: [0.13, 0.33],
  },
  2: {
    outline: [
      ['M', 0.0, 0.52],
      ['Q', 0.36, 0.0, 0.7, 0.2],
      ['L', 0.86, 0.17],
      ['L', 0.88, 0.37],
      ['L', 0.7, 0.34],
      ['Q', 0.4, 0.2, 0.0, 0.52],
    ],
    bevel: [
      ['M', 0.86, 0.17],
      ['L', 0.88, 0.37],
    ],
    glowEdge: [
      ['M', 0.0, 0.52],
      ['Q', 0.36, 0.0, 0.7, 0.2],
    ],
    glint: [0.28, 0.24],
  },
  3: {
    outline: [
      ['M', 0.03, 0.45],
      ['L', 0.11, 0.32],
      ['L', 0.17, 0.35],
      ['L', 0.24, 0.24],
      ['L', 0.31, 0.27],
      ['L', 0.38, 0.17],
      ['L', 0.62, 0.14],
      ['L', 0.8, 0.19],
      ['L', 0.84, 0.37],
      ['L', 0.64, 0.31],
      ['L', 0.46, 0.29],
      ['L', 0.33, 0.34],
      ['L', 0.2, 0.39],
    ],
    bevel: [
      ['M', 0.8, 0.19],
      ['L', 0.84, 0.37],
    ],
    glowEdge: [
      ['M', 0.03, 0.45],
      ['L', 0.38, 0.17],
    ],
    glint: [0.42, 0.21],
  },
  4: {
    outline: [
      ['M', 0.0, 0.5],
      ['Q', 0.3, 0.06, 0.62, 0.14],
      ['L', 0.62, 0.07],
      ['L', 0.82, 0.07],
      ['L', 0.82, 0.41],
      ['L', 0.62, 0.41],
      ['L', 0.62, 0.32],
      ['Q', 0.32, 0.24, 0.0, 0.5],
    ],
    bevel: [
      ['M', 0.82, 0.07],
      ['L', 0.82, 0.41],
    ],
    glowEdge: [
      ['M', 0.0, 0.5],
      ['Q', 0.3, 0.06, 0.62, 0.14],
    ],
    glint: [0.26, 0.24],
  },
  5: {
    outline: [
      ['M', 0.04, 0.54],
      ['Q', 0.42, -0.12, 0.9, 0.46],
      ['Q', 0.52, 0.12, 0.04, 0.54],
    ],
    bevel: [
      ['M', 0.8, 0.3],
      ['L', 0.9, 0.46],
    ],
    glowEdge: [
      ['M', 0.04, 0.54],
      ['Q', 0.42, -0.12, 0.9, 0.46],
    ],
    glint: [0.26, 0.24],
  },
};
/** The axe's ground edge is this deep; the pick's chisel face is a thin strip. */
const AXE_BEVEL_DEPTH = 0.075;
const PICK_BEVEL_DEPTH = 0.03;
/** The cheek's lower part drops into shade along a line that follows the head's own curve. */
const AXE_SHADE_DROP = 0.1;
const PICK_SHADE_DROP = 0.05;
const PICK_TOP_LIGHT_DROP = 0.022;
const AXE_GLINT_R = 0.065;
const PICK_GLINT_R = 0.06;

const SOCKET_RIVET_Y = 0.235;
/** The wedge pin through the socket, as a fraction of the socket's width. */
const SOCKET_RIVET_FRACTION = 0.2;

/** A dark head is outlined in a lifted tone of itself, or its silhouette merges with a dark slot. */
const DARK_HEAD_RIM_TONE = 0.42;
const DARK_HEAD_LIT_TONE = 0.4;
/** A head darker than this (0..1 luminance) gets a lit rim, or it vanishes into a dark slot. */
const DARK_HEAD_LUMINANCE = 0.22;
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;
const HEX_RADIX = 16;
const CHANNEL_MAX = 255;

const GLOW_BLUR_UNIT = 0.08;
const LIT_CHEEK_TONE = 0.3;
const SHADED_CHEEK_TONE = -0.35;

const WOOD_GRAIN_TONE = -0.32;
const SOCKET_TONE = -0.12;
const EDGE_SHADE_TONE = -0.2;

function luminance(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), HEX_RADIX);
  const g = Number.parseInt(hex.slice(3, 5), HEX_RADIX);
  const b = Number.parseInt(hex.slice(5, 7), HEX_RADIX);
  return (LUMA_RED * r + LUMA_GREEN * g + LUMA_BLUE * b) / CHANNEL_MAX;
}

function isDarkHead(look: ToolTierLook): boolean {
  return luminance(look.headColor) < DARK_HEAD_LUMINANCE;
}

function headOutline(look: ToolTierLook): string {
  return isDarkHead(look) ? tone(look.headColor, DARK_HEAD_RIM_TONE) : ICON_OUTLINE;
}

/** The lit face of the head; a near-black head needs a far stronger lift for its light side to register at all. */
function litHeadColor(look: ToolTierLook): string {
  return tone(look.headColor, isDarkHead(look) ? DARK_HEAD_LIT_TONE : LIT_CHEEK_TONE);
}

function traceHaft(ctx: CanvasRenderingContext2D, bottom: number): void {
  ctx.beginPath();
  ctx.moveTo(HAFT_CX - HAFT_HALF_TOP, HAFT_TOP);
  ctx.lineTo(HAFT_CX + HAFT_HALF_TOP, HAFT_TOP);
  ctx.lineTo(HAFT_CX + HAFT_HALF_BOTTOM, bottom - KNOB_HEIGHT);
  ctx.lineTo(HAFT_CX - HAFT_HALF_BOTTOM, bottom - KNOB_HEIGHT);
  ctx.closePath();
}

function traceKnob(ctx: CanvasRenderingContext2D, bottom: number): void {
  tracePoints(ctx, [
    [HAFT_CX - HAFT_HALF_BOTTOM, bottom - KNOB_HEIGHT],
    [HAFT_CX + HAFT_HALF_BOTTOM, bottom - KNOB_HEIGHT],
    [HAFT_CX + KNOB_HALF, bottom, KNOB_CORNER],
    [HAFT_CX - KNOB_HALF, bottom, KNOB_CORNER],
  ]);
}

function paintHaft(
  ctx: CanvasRenderingContext2D,
  px: number,
  look: ToolTierLook,
  bottom: number,
  grip: string,
): void {
  const woodFill = litFill(ctx, look.hafColor, HAFT_LIGHT_FROM, HAFT_LIGHT_TO);
  paintForm(ctx, px, () => traceKnob(ctx, bottom), woodFill);
  paintForm(ctx, px, () => traceHaft(ctx, bottom), woodFill);

  withShapeClip(
    ctx,
    () => traceHaft(ctx, bottom),
    () => {
      const grain = tone(look.hafColor, WOOD_GRAIN_TONE);
      for (const offset of HAFT_GRAIN_OFFSETS) {
        const points: IconPoint[] = [];
        for (let step = 0; step <= HAFT_GRAIN_STEPS; step++) {
          const t = step / HAFT_GRAIN_STEPS;
          const wave = step % 2 === 0 ? HAFT_GRAIN_WAVE : -HAFT_GRAIN_WAVE;
          points.push([
            HAFT_CX + offset + wave,
            HAFT_GRAIN_START + t * (bottom - HAFT_GRAIN_START),
          ]);
        }
        strokeDetail(ctx, px, points, grain);
      }

      const gripTop = bottom - GRIP_TOP_FROM_BOTTOM;
      const gripBottom = bottom - GRIP_BOTTOM_FROM_BOTTOM;
      ctx.fillStyle = litFill(ctx, grip, HAFT_LIGHT_FROM, HAFT_LIGHT_TO);
      ctx.fillRect(HAFT_CX - KNOB_HALF, gripTop, KNOB_HALF * 2, gripBottom - gripTop);
      const turn = (gripBottom - gripTop) / GRIP_TURNS;
      for (let i = 1; i < GRIP_TURNS; i++) {
        const turnY = gripTop + i * turn;
        strokeDetail(
          ctx,
          px,
          [
            [HAFT_CX - KNOB_HALF, turnY + turn / 2],
            [HAFT_CX + KNOB_HALF, turnY - turn / 2],
          ],
          ICON_OUTLINE,
        );
      }
    },
  );
  const gripTop = bottom - GRIP_TOP_FROM_BOTTOM;
  const gripBottom = bottom - GRIP_BOTTOM_FROM_BOTTOM;
  for (const edgeY of [gripTop, gripBottom]) {
    strokeDetail(
      ctx,
      px,
      [
        [HAFT_CX - HAFT_HALF_BOTTOM, edgeY],
        [HAFT_CX + HAFT_HALF_BOTTOM, edgeY],
      ],
      ICON_OUTLINE,
      BOLD_DETAIL,
    );
  }

  if (look.accent !== undefined) {
    const accent = look.accent;
    paintForm(
      ctx,
      px,
      () =>
        tracePoints(ctx, [
          [HAFT_CX - BINDING_HALF, BINDING_TOP],
          [HAFT_CX + BINDING_HALF, BINDING_TOP],
          [HAFT_CX + BINDING_HALF, BINDING_TOP + BINDING_HEIGHT],
          [HAFT_CX - BINDING_HALF, BINDING_TOP + BINDING_HEIGHT],
        ]),
      litFill(ctx, accent, HAFT_LIGHT_FROM, HAFT_LIGHT_TO),
    );
  }
}

function paintSocket(
  ctx: CanvasRenderingContext2D,
  px: number,
  points: readonly IconPoint[],
  look: ToolTierLook,
  outline: string,
): void {
  const steel = tone(look.headColor, SOCKET_TONE);
  paintForm(
    ctx,
    px,
    () => tracePoints(ctx, points),
    litFill(ctx, steel, [points[0][0], 0], [points[1][0], 0]),
    outline,
  );
  const cx = (points[0][0] + points[1][0]) / 2;
  const rivetR = (points[1][0] - points[0][0]) * SOCKET_RIVET_FRACTION;
  ctx.beginPath();
  ctx.arc(cx, SOCKET_RIVET_Y, rivetR, 0, FULL_TURN);
  ctx.fillStyle = tone(look.edgeColor, EDGE_SHADE_TONE);
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = hairlineWidth(px);
  ctx.stroke();
}

function tracePath(ctx: CanvasRenderingContext2D, ops: readonly PathOp[], dy = 0): void {
  ctx.beginPath();
  appendPath(ctx, ops, dy);
}

function appendPath(ctx: CanvasRenderingContext2D, ops: readonly PathOp[], dy: number): void {
  for (const op of ops) {
    if (op[0] === 'Q') ctx.quadraticCurveTo(op[1], op[2] + dy, op[3], op[4] + dy);
    else if (op[0] === 'M') ctx.moveTo(op[1], op[2] + dy);
    else ctx.lineTo(op[1], op[2] + dy);
  }
}

function traceClosed(ctx: CanvasRenderingContext2D, ops: readonly PathOp[], dy = 0): void {
  tracePath(ctx, ops, dy);
  ctx.closePath();
}

function paintHead(
  ctx: CanvasRenderingContext2D,
  px: number,
  look: ToolTierLook,
  head: HeadShape,
  socket: readonly IconPoint[],
  drops: { readonly light: number; readonly shade: number; readonly bevel: number },
): void {
  const outline = headOutline(look);
  if (head.poll !== undefined) {
    const poll = head.poll;
    paintForm(
      ctx,
      px,
      () => traceClosed(ctx, poll),
      litFill(ctx, look.headColor, [(head.socket ?? socket)[1][0], 0], [1, 0]),
      outline,
    );
  }
  paintForm(ctx, px, () => traceClosed(ctx, head.outline), litHeadColor(look), outline);
  withShapeClip(
    ctx,
    () => traceClosed(ctx, head.outline),
    () => {
      traceClosed(ctx, head.outline, drops.light);
      ctx.fillStyle = look.headColor;
      ctx.fill();
      traceClosed(ctx, head.outline, drops.shade);
      ctx.fillStyle = tone(look.headColor, SHADED_CHEEK_TONE);
      ctx.fill();
      tracePath(ctx, head.bevel);
      ctx.strokeStyle = look.edgeColor;
      ctx.lineWidth = (head.bevelDepth ?? drops.bevel) * 2;
      ctx.stroke();
    },
  );
  const eye = head.socket ?? socket;
  paintSocket(ctx, px, eye, look, outline);
  for (const bandY of head.collarBands ?? []) {
    strokeDetail(
      ctx,
      px,
      [
        [eye[0][0], bandY],
        [eye[1][0], bandY],
      ],
      ICON_OUTLINE,
      BOLD_DETAIL,
    );
  }
  if (look.glow !== undefined)
    paintEdgeGlow(ctx, px, look.glow, () => tracePath(ctx, head.glowEdge));
}

function paintEdgeGlow(
  ctx: CanvasRenderingContext2D,
  px: number,
  glow: string,
  traceEdge: () => void,
): void {
  ctx.save();
  // shadowBlur is in device pixels and ignores the unit-square transform.
  ctx.shadowBlur = GLOW_BLUR_UNIT / px;
  ctx.shadowColor = glow;
  traceEdge();
  ctx.strokeStyle = glow;
  ctx.lineWidth = hairlineWidth(px) * BOLD_DETAIL;
  ctx.stroke();
  ctx.restore();
}

/** Draws one tool's icon into the largest square centred in `rect`. */
export function drawToolIcon(ctx: CanvasRenderingContext2D, rect: Rect, id: ToolIconId): void {
  const { kind, tier } = TOOL_ICON_INFO[id];
  const look = TOOL_TIER_LOOKS[tier];
  const longHaft = look.longHaft === true;
  paintIconArt(ctx, rect, (art, px) => {
    const scale = longHaft ? TOOL_SCALE_LONG : TOOL_SCALE;
    art.translate(TOOL_PIVOT, TOOL_PIVOT + (longHaft ? TOOL_DROP_LONG : TOOL_DROP));
    art.rotate(TOOL_TILT);
    art.scale(scale, scale);
    art.translate(-TOOL_PIVOT, -TOOL_PIVOT);
    const unitPx = px / scale;
    paintHaft(
      art,
      unitPx,
      look,
      longHaft ? HAFT_BOTTOM_LONG : HAFT_BOTTOM,
      GRIP_BY_TOOL[id] ?? GRIP_LEATHER,
    );
    if (kind === 'axe') {
      const head = AXE_HEADS[tier];
      paintHead(art, unitPx, look, head, SOCKET_AXE, {
        light: AXE_SHADE_DROP,
        shade: AXE_SHADE_DROP * 2,
        bevel: AXE_BEVEL_DEPTH,
      });
      glint(art, head.glint[0], head.glint[1], AXE_GLINT_R);
    } else {
      const head = PICK_HEADS[tier];
      paintHead(art, unitPx, look, head, SOCKET_PICK, {
        light: PICK_TOP_LIGHT_DROP,
        shade: PICK_SHADE_DROP,
        bevel: PICK_BEVEL_DEPTH,
      });
      glint(art, head.glint[0], head.glint[1], PICK_GLINT_R);
    }
  });
}
