/**
 * The service level's versions of the dungeon's breakable props: what stands
 * where the cellars have a barrel, a crate, a bookshelf, a torch or a brazier.
 *
 * - a painted steel drum (standing and on its side) for the barrel, and an oil
 *   drum — black, with a yellow band — that some of those drums are instead
 * - a stacking plastic crate, stencilled, for the crate
 * - steel shelving loaded with supply boxes for the bookshelf
 * - an electric work lamp on a tripod for the torch
 * - a cut-down oil drum burning rubbish for the brazier
 *
 * Each family is painted by its own module in `floorTwoVariants/`; this one
 * dispatches by kind and draws what they share — the break, through the burst
 * engine in `propPaint.ts`, and the wreckage. Every one is drawn at the same
 * four wear stages as the cellars' props, on the same envelope. Metal dents
 * before it gives: a drum's damaged stage is its dented one.
 *
 * Only a prop's own emitter is bright — the lamp's bulb, the drum brazier's
 * fire and its punched holes. The light they throw is the lighting pass's.
 */

import { BRAZIER_FLAME_FRAMES, FLAME_FRAMES, type PropState } from './destructiblePropArt';
import {
  SHATTER_FRAMES,
  TWO_PI,
  drawDebrisBurst,
  drawWreckageField,
  pick,
  puff,
  radialDebris,
  signedUnit,
  speckle,
  verticalRamp,
  withRotation,
  wreckageField,
  wreckageShadow,
  type BurstCloud,
  type Ctx,
  type DebrisPiece,
} from './propPaint';
import { mulberry32 } from '../person/rng';
import { drawDrumBrazier } from './floorTwoVariants/drumBrazierArt';
import {
  BLACK_DRUM,
  BLUE_DRUM,
  CARD_SHADES,
  DEAD_COAL,
  DEAD_COAL_GREY,
  DRUM_LIGHT,
  DRUM_SHADES,
  FIRE_HOT,
  FIRE_OUTER,
  GLASS_GLINT,
  LAMP_YELLOW,
  LAMP_YELLOW_DARK,
  LAMP_YELLOW_LIGHT,
  OIL_BAND,
  OIL_LIGHT,
  OIL_MID,
  OIL_POOL,
  OIL_SHEEN,
  PLASTIC_EDGE,
  PLASTIC_MID,
  PLASTIC_SHADES,
  STEEL_DARK,
  STEEL_EDGE,
  STEEL_LIGHT,
  STEEL_MID,
  STEEL_SPEC,
  line,
  variantSeed,
  wash,
} from './floorTwoVariants/floorTwoPaint';
import { drawPlasticCrate } from './floorTwoVariants/plasticCrateArt';
import { burstDrumShell, drawSteelDrum, drawSteelDrumSide } from './floorTwoVariants/steelDrumArt';
import { drawSteelShelving, supplyBox } from './floorTwoVariants/steelShelvingArt';
import { drawWorkLamp } from './floorTwoVariants/workLampArt';

export type FloorTwoVariantKind =
  | 'steel_drum'
  | 'oil_drum'
  | 'steel_drum_side'
  | 'plastic_crate'
  | 'steel_shelving'
  | 'work_lamp'
  | 'drum_brazier';

/** The work lamp's rows run as long as the torch's, so one draw site animates both. */
export const WORK_LAMP_FRAMES = FLAME_FRAMES;
/** The drum brazier's rows run as long as the brazier's, for the same reason. */
export const DRUM_BRAZIER_FRAMES = BRAZIER_FLAME_FRAMES;

const SOOT_RGB = [40, 36, 34] as const;
const STEEL_DUST_RGB = [150, 156, 160] as const;
const PLASTIC_DUST_RGB = [120, 140, 156] as const;
const CARD_DUST_RGB = [168, 146, 112] as const;

// ── Shatter ───────────────────────────────────────────────────────────────────

const SHATTER_CENTER_Y_FRACTION = 0.5;
/** A shelving bay's mass is the middle of a frame that stands most of a tile above its own. */
const SHELVING_SHATTER_CENTER_Y_FRACTION = 0.1;
const LAMP_SHATTER_CENTER_Y_FRACTION = 0.2;
const DRUM_BRAZIER_SHATTER_CENTER_Y_FRACTION = 0.6;
const METAL_DEBRIS = {
  count: 14,
  spreadPx: 30,
  edge: STEEL_EDGE,
  curlPeriod: 3,
  lengthMin: 6,
  lengthSpread: 7,
  widthMin: 2.5,
  widthSpread: 3,
} as const;
/** A shelving bay throws its load with it: more pieces, and wider ones. */
const SHELVING_DEBRIS = { count: 16, lengthMin: 7, widthMin: 4 } as const;
/** A lamp is a slender thing; its pieces do not fly as far. */
const LAMP_DEBRIS_SPREAD_PX = 20;
/** The drum brazier's paler core of ash, inside its soot cloud. */
const SMOKE_CORE_FRACTION = 0.6;

/** Fixed seeds for each kind's burst, one literal per kind. */
const DEBRIS_SEEDS: Readonly<Record<FloorTwoVariantKind, number>> = {
  steel_drum: 0x1a01,
  oil_drum: 0x1a02,
  steel_drum_side: 0x1a03,
  plastic_crate: 0x1a04,
  steel_shelving: 0x1a05,
  work_lamp: 0x1a06,
  drum_brazier: 0x1a07,
};

function debrisFor(kind: FloorTwoVariantKind): DebrisPiece[] {
  const seed = DEBRIS_SEEDS[kind];
  if (kind === 'plastic_crate') {
    return radialDebris(seed, {
      ...METAL_DEBRIS,
      shades: [...PLASTIC_SHADES],
      edge: PLASTIC_EDGE,
      curlPeriod: 0,
      curlShade: PLASTIC_MID,
    });
  }
  if (kind === 'steel_shelving') {
    return radialDebris(seed, {
      ...METAL_DEBRIS,
      ...SHELVING_DEBRIS,
      shades: [...CARD_SHADES, STEEL_LIGHT],
      curlShade: STEEL_MID,
    });
  }
  if (kind === 'work_lamp') {
    return radialDebris(seed, {
      ...METAL_DEBRIS,
      spreadPx: LAMP_DEBRIS_SPREAD_PX,
      shades: [LAMP_YELLOW, LAMP_YELLOW_DARK, GLASS_GLINT, STEEL_MID],
      curlShade: STEEL_DARK,
    });
  }
  if (kind === 'drum_brazier') {
    return radialDebris(seed, {
      ...METAL_DEBRIS,
      shades: [OIL_MID, FIRE_OUTER, FIRE_HOT, DEAD_COAL],
      curlShade: OIL_LIGHT,
    });
  }
  const shades: readonly [string, ...string[]] =
    kind === 'oil_drum' ? [OIL_MID, OIL_LIGHT, OIL_BAND] : DRUM_SHADES;
  return radialDebris(seed, {
    ...METAL_DEBRIS,
    shades,
    curlShade: kind === 'oil_drum' ? OIL_LIGHT : DRUM_LIGHT,
  });
}

function cloudFor(kind: FloorTwoVariantKind): BurstCloud {
  if (kind === 'drum_brazier') {
    return (ctx, cx, cy, radius, alpha) => {
      puff(ctx, cx, cy, radius, alpha, SOOT_RGB);
      puff(ctx, cx, cy, radius * SMOKE_CORE_FRACTION, alpha, STEEL_DUST_RGB);
    };
  }
  const rgb =
    kind === 'plastic_crate'
      ? PLASTIC_DUST_RGB
      : kind === 'steel_shelving'
        ? CARD_DUST_RGB
        : STEEL_DUST_RGB;
  return (ctx, cx, cy, radius, alpha) => puff(ctx, cx, cy, radius, alpha, rgb);
}

function shatterCenterY(kind: FloorTwoVariantKind): number {
  if (kind === 'work_lamp') return LAMP_SHATTER_CENTER_Y_FRACTION;
  if (kind === 'steel_shelving') return SHELVING_SHATTER_CENTER_Y_FRACTION;
  if (kind === 'drum_brazier') return DRUM_BRAZIER_SHATTER_CENTER_Y_FRACTION;
  return SHATTER_CENTER_Y_FRACTION;
}

// ── Remains ───────────────────────────────────────────────────────────────────

const REMAINS_CENTER_Y_FRACTION = 0.6;
const REMAINS_SIZE = { lengthMin: 8, lengthSpread: 10, widthMin: 3, widthSpread: 3 } as const;
const REMAINS_PIECE_COUNT = 8;
const DRUM_SCRAP_COUNT = 4;
const REMAINS_SPECKLE_FRACTION = 0.3;

/** The oil drum's spill, and the cold sheen across it, in tiles from the wreckage centre. */
const OIL_SPILL = {
  dx: 2,
  dy: 3,
  rxFraction: 0.42,
  ryFraction: 0.2,
  tilt: 0.1,
  sheenDx: -6,
  sheenRxFraction: 0.14,
  sheenRyFraction: 0.04,
} as const;

/** The scorch and dead coals a felled drum brazier leaves. */
const BRAZIER_SCORCH = {
  rxFraction: 0.3,
  ryFraction: 0.15,
  colour: 'rgba(36,26,20,0.5)',
  coalCount: 9,
  coalSpreadX: 14,
  coalSpreadY: 6,
  coalRadiusMin: 1,
  coalRadiusSpread: 1.5,
} as const;

/** Bent shelving uprights lying across the tile: [x0, y0, x1, y1] from the wreckage centre. */
const SHELVING_UPRIGHTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [-22, -6, 20, 2],
  [-18, 8, 4, 4],
  [4, 4, 22, 10],
];
const SHELVING_UPRIGHT_LIT: readonly [number, number, number, number] = [-22, -7, 20, 1];
const SHELVING_UPRIGHT_WIDTH = 3.5;
const SPILLED_BOXES = {
  count: 4,
  spreadX: 16,
  drop: 6,
  spreadY: 5,
  maxTilt: 0.6,
  halfWidth: 5,
  widthMin: 10,
  widthSpread: 4,
  heightMin: 6,
  heightSpread: 3,
} as const;

/** The fallen work lamp: its tripod on its side, the reflector face down, and glass. */
const FALLEN_LAMP = {
  poleFrom: [-20, 2],
  poleTo: [14, -4],
  poleWidth: 3.4,
  poleLitFrom: [-20, 1],
  poleLitTo: [14, -5],
  legReach: -8,
  legSpread: [-6, 0, 6],
  legWidth: 2.6,
  headX: 16,
  headY: -3,
  headRx: 8,
  headRy: 5.5,
  headTilt: -0.3,
  headShadeTop: -10,
  headShadeBottom: 4,
  headShadeX: 14,
  glassCount: 7,
  glassX: 4,
  glassSpreadX: 12,
  glassY: 6,
  glassSpreadY: 5,
  glassWidth: 1.5,
  glassHeight: 1,
} as const;
const FALLEN_HEAD_STOPS = [
  [0, LAMP_YELLOW_LIGHT],
  [1, LAMP_YELLOW_DARK],
] as const;

const REMAINS_SEEDS: Readonly<Record<FloorTwoVariantKind, number>> = {
  steel_drum: 0x2b01,
  oil_drum: 0x2b02,
  steel_drum_side: 0x2b03,
  plastic_crate: 0x2b04,
  steel_shelving: 0x2b05,
  work_lamp: 0x2b06,
  drum_brazier: 0x2b07,
};

function drawFallenLamp(ctx: Ctx, cx: number, cy: number, rng: () => number): void {
  const f = FALLEN_LAMP;
  const [fromX, fromY] = f.poleFrom;
  const [toX, toY] = f.poleTo;
  line(ctx, cx + fromX, cy + fromY, cx + toX, cy + toY, LAMP_YELLOW, f.poleWidth);
  const [litFromX, litFromY] = f.poleLitFrom;
  const [litToX, litToY] = f.poleLitTo;
  line(ctx, cx + litFromX, cy + litFromY, cx + litToX, cy + litToY, LAMP_YELLOW_LIGHT, 1);
  for (const dy of f.legSpread) {
    line(
      ctx,
      cx + fromX,
      cy + fromY,
      cx + fromX + f.legReach,
      cy + fromY + dy,
      LAMP_YELLOW_DARK,
      f.legWidth,
    );
  }
  ctx.fillStyle = verticalRamp(
    ctx,
    cx + f.headShadeX,
    cy + f.headShadeTop,
    cy + f.headShadeBottom,
    FALLEN_HEAD_STOPS,
  );
  ctx.beginPath();
  ctx.ellipse(cx + f.headX, cy + f.headY, f.headRx, f.headRy, f.headTilt, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = STEEL_EDGE;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = GLASS_GLINT;
  for (let i = 0; i < f.glassCount; i++) {
    ctx.fillRect(
      cx + f.glassX + signedUnit(rng) * f.glassSpreadX,
      cy + f.glassY + signedUnit(rng) * f.glassSpreadY,
      f.glassWidth,
      f.glassHeight,
    );
  }
}

function drawServiceRemains(
  ctx: Ctx,
  kind: FloorTwoVariantKind,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
): void {
  const rng = mulberry32(REMAINS_SEEDS[kind] + variantSeed(variant));
  const cx = ox + ts / 2;
  const cy = oy + ts * REMAINS_CENTER_Y_FRACTION;

  if (kind === 'oil_drum') {
    // A glossy black pool with a cold sheen across it, for whatever sets spills alight.
    ctx.fillStyle = OIL_POOL;
    ctx.beginPath();
    ctx.ellipse(
      cx + OIL_SPILL.dx,
      cy + OIL_SPILL.dy,
      ts * OIL_SPILL.rxFraction,
      ts * OIL_SPILL.ryFraction,
      OIL_SPILL.tilt,
      0,
      TWO_PI,
    );
    ctx.fill();
    wash(
      ctx,
      cx + OIL_SPILL.sheenDx,
      cy,
      ts * OIL_SPILL.sheenRxFraction,
      ts * OIL_SPILL.sheenRyFraction,
      OIL_SHEEN,
    );
  } else {
    wreckageShadow(ctx, cx, cy, ts);
  }
  if (kind === 'drum_brazier') {
    const s = BRAZIER_SCORCH;
    wash(ctx, cx, cy, ts * s.rxFraction, ts * s.ryFraction, s.colour);
    for (let i = 0; i < s.coalCount; i++) {
      ctx.fillStyle = rng() < 0.5 ? DEAD_COAL : DEAD_COAL_GREY;
      ctx.beginPath();
      ctx.arc(
        cx + signedUnit(rng) * s.coalSpreadX,
        cy + signedUnit(rng) * s.coalSpreadY,
        s.coalRadiusMin + rng() * s.coalRadiusSpread,
        0,
        TWO_PI,
      );
      ctx.fill();
    }
  }

  if (
    kind === 'steel_drum' ||
    kind === 'oil_drum' ||
    kind === 'steel_drum_side' ||
    kind === 'drum_brazier'
  ) {
    const paint = kind === 'steel_drum' || kind === 'steel_drum_side' ? BLUE_DRUM : BLACK_DRUM;
    const scraps = wreckageField(
      REMAINS_SEEDS[kind],
      DRUM_SCRAP_COUNT,
      [paint.mid, paint.light],
      REMAINS_SIZE,
    );
    drawWreckageField(ctx, scraps, cx, cy, STEEL_EDGE);
    burstDrumShell(ctx, cx, cy, paint);
    speckle(ctx, cx, cy, ts * REMAINS_SPECKLE_FRACTION, rng, STEEL_LIGHT, STEEL_DARK);
    return;
  }
  if (kind === 'plastic_crate') {
    const pieces = wreckageField(
      REMAINS_SEEDS[kind] + variant,
      REMAINS_PIECE_COUNT,
      [...PLASTIC_SHADES],
      REMAINS_SIZE,
    );
    drawWreckageField(ctx, pieces, cx, cy, PLASTIC_EDGE);
    return;
  }
  if (kind === 'steel_shelving') {
    const [firstFromX, firstFromY, firstToX, firstToY] = SHELVING_UPRIGHTS[0] ?? [0, 0, 0, 0];
    line(
      ctx,
      cx + firstFromX,
      cy + firstFromY,
      cx + firstToX,
      cy + firstToY,
      STEEL_MID,
      SHELVING_UPRIGHT_WIDTH,
    );
    const [litX0, litY0, litX1, litY1] = SHELVING_UPRIGHT_LIT;
    line(ctx, cx + litX0, cy + litY0, cx + litX1, cy + litY1, STEEL_SPEC, 1);
    for (const [x0, y0, x1, y1] of SHELVING_UPRIGHTS.slice(1)) {
      line(ctx, cx + x0, cy + y0, cx + x1, cy + y1, STEEL_MID, SHELVING_UPRIGHT_WIDTH);
    }
    const b = SPILLED_BOXES;
    for (let i = 0; i < b.count; i++) {
      const x = cx + signedUnit(rng) * b.spreadX;
      const y = cy + b.drop + signedUnit(rng) * b.spreadY;
      withRotation(ctx, x, y, signedUnit(rng) * b.maxTilt, () => {
        supplyBox(
          ctx,
          x - b.halfWidth,
          y,
          b.widthMin + rng() * b.widthSpread,
          b.heightMin + rng() * b.heightSpread,
          pick(rng, [...CARD_SHADES]),
        );
      });
    }
    return;
  }
  drawFallenLamp(ctx, cx, cy, rng);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

/**
 * Paints one frame of one of the service level's props, with the anchor tile's
 * top-left corner at (`ox`, `oy`) and the tile `ts` pixels across.
 *
 * `frame` is the animation frame for the lamp's and drum brazier's idle and
 * damaged rows and for every shatter row; for the static props' idle, damaged
 * and remains rows it is the look.
 */
export function drawFloorTwoVariantProp(
  ctx: Ctx,
  kind: FloorTwoVariantKind,
  state: PropState,
  frame: number,
  ox: number,
  oy: number,
  ts: number,
): void {
  if (state === 'shatter') {
    const progress = frame / (SHATTER_FRAMES - 1);
    const cx = ox + ts / 2;
    const cy = oy + ts * shatterCenterY(kind);
    drawDebrisBurst(ctx, debrisFor(kind), cloudFor(kind), cx, cy, ts, progress);
    return;
  }
  const animated = kind === 'work_lamp' || kind === 'drum_brazier';
  const variant = animated ? 0 : frame;
  if (state === 'remains') {
    drawServiceRemains(ctx, kind, ox, oy, ts, variant);
    return;
  }
  const damaged = state === 'damaged';
  if (kind === 'steel_drum') drawSteelDrum(ctx, ox, oy, ts, damaged, variant, false);
  else if (kind === 'oil_drum') drawSteelDrum(ctx, ox, oy, ts, damaged, variant, true);
  else if (kind === 'steel_drum_side') drawSteelDrumSide(ctx, ox, oy, ts, damaged, variant);
  else if (kind === 'plastic_crate') drawPlasticCrate(ctx, ox, oy, ts, damaged, variant);
  else if (kind === 'steel_shelving') drawSteelShelving(ctx, ox, oy, ts, damaged, variant);
  else if (kind === 'work_lamp') drawWorkLamp(ctx, ox, oy, ts, damaged, frame);
  else drawDrumBrazier(ctx, ox, oy, ts, damaged, frame);
}
