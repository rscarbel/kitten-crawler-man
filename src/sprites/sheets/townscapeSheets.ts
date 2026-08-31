/**
 * Which pictures the town's street furniture sheets carry, and how they are
 * packed.
 *
 * The reusable half of the town's art: nothing here names a street or a shop, so
 * a second town or a later floor can hang the same lamps, signs and bunting. The
 * art that names *this* town — its fingerpost labels — is planned in
 * `overCitySheets.ts` instead, so this module never becomes the place every
 * town's one-off signage accumulates.
 *
 * **The art is not drawn here.** Every picture comes from the game's own
 * painters in `src/sprites/`. This module only decides which pictures exist and
 * how they are packed, so the sheet the game paints for itself and the sheet
 * `npm run gen:townscape` bakes for review are the same sheet.
 *
 * ## Geometry contract
 *
 * Frames are authored at `TOWNSCAPE_TILE_SCALE` px per tile — see the constant
 * for why that is 32 here rather than the 64 the creature sheets use.
 * `tileX`/`tileY` are where the prop's **anchor tile's top-left corner** sits
 * inside its frame, so `drawSprite` lands the art where the painter put it.
 *
 * The reach values below are the painters' own documented extents, plus slack.
 * An over-large frame costs a few transparent pixels; an under-sized one clips
 * the art, and the clip is what the frame's own cell enforces.
 */

import { SHOP_SIGN_EMBLEMS, createTownPlan, type ShopSignEmblem } from '../../map/town/townPlan';
import {
  STALL_RIPPLE_STEPS,
  STALL_VARIANTS,
  STALL_WIDTH_TILES,
  drawStallBack,
  drawStallCanopy,
  drawStallFront,
  stallPhaseForStep,
} from '../marketStall';
import { SIGN_SWAY_STEPS, drawShopSign, shopSignSwayForStep } from '../shopSign';
import { LAMP_FLICKER_STEPS, drawStreetLamp, streetLampFlickerForStep } from '../streetLamp';
import {
  LAUNDRY_SWAY_STEPS,
  TOWN_CLUTTER_KINDS,
  drawLaundryLine,
  drawTownClutter,
  laundryLineFrameForStep,
} from '../townClutter';
import { drawBench, drawNoticeBoard } from '../townFixtures';
import { drawBunting, drawGateArch, type GateArchAxis } from '../townWayfinding';
import {
  BUNTING_SPANS,
  LAUNDRY_ALLEY_NAMES,
  laundryLineSpanTiles,
} from '../../systems/townDecorPlan';
import { getManifestKeys, type SpriteKey } from '../../core/SpriteLoader';
import type { PropSheetPlan } from './propSheetPlan';

/**
 * Level 3's `mapSize`. Restated rather than imported because a level definition
 * pulls in every creature that floor can spawn, and a sheet layout has no
 * business dragging that behind it — `npm run gates:prop-sheets` asserts the two
 * still agree.
 */
export const OVERWORLD_MAP_SIZE_TILES = 280;

/**
 * Source pixels per tile — **32, not the 64 the creature sheets author at.**
 *
 * These painters are not resolution-independent. They mix tile fractions with
 * fixed pixel constants (`BRACKET_THICKNESS_PX`, `SHEET_HEM_PX`,
 * `ARCH_COURSE_HEIGHT_PX` and a dozen more), and those constants were tuned
 * against the 32 px tile the game actually draws. Baking at 64 and letting
 * `drawSprite` halve it shrinks every one of them: measured over the whole town,
 * that moved 4.1% of the frame's pixels — hairline brackets, thinner mortar
 * courses, a lighter rope. Baking at the size the art was tuned for takes the
 * same comparison to a zero-pixel shift with only anti-aliasing left over.
 *
 * So this is a fidelity choice, not an oversight, and it is the reason to leave
 * it alone: raising it to 64 silently redraws the whole town slightly thinner.
 * The way to get 2x art here is to make the painters scale their pixel constants
 * by `ts / 32` first.
 */
export const TOWNSCAPE_TILE_SCALE = 32;

/**
 * A span-keyed sheet's manifest key. Written as a function rather than inline so
 * the placement systems and the sheet plan cannot spell it differently — the two
 * meeting only at a string is how a prop silently stops drawing.
 */
export function gateArchKey(axis: GateArchAxis, spanTiles: number): SpriteKey {
  return asSpriteKey(`gate_arch_${axis}_${spanTiles}`);
}

export function buntingKey(spanTiles: number): SpriteKey {
  return asSpriteKey(`bunting_${spanTiles}`);
}

export function laundryLineKey(spanTiles: number): SpriteKey {
  return asSpriteKey(`laundry_line_${spanTiles}`);
}

/**
 * Narrows a composed key to a manifest key, failing loudly when the manifest has
 * no such entry — a span the town plans but no sheet declares would otherwise be
 * a prop that quietly never appears.
 */
function asSpriteKey(key: string): SpriteKey {
  const found = getManifestKeys().find((candidate) => candidate === key);
  if (found === undefined) throw new Error(`No sprite manifest entry named "${key}"`);
  return found;
}

/** Every prop's frame includes its own anchor tile below whatever reaches above it. */
const ANCHOR_TILE = 1;

/**
 * The sign's ink runs from 1.42 tiles above the anchor (the bracket arm) down to
 * the anchor row, and from the bracket tip at −0.5 tiles to the root at +0.5. The
 * slack covers the board's swing and its drop shadow.
 *
 * The west shift that the two wide doorways apply is deliberately *not* baked in:
 * it is a whole-sign translation, so the runtime subtracts it at blit time and
 * both doorway widths share one set of frames.
 */
const SIGN_UP_TILES = 1.7;
const SIGN_WEST_TILES = 1.2;
const SIGN_EAST_TILES = 0.8;

/** No clutter kind draws above its own anchor row — the tallest tops out on it. */
const CLUTTER_UP_TILES = 0;
/** The handcart's shaft is the widest piece of clutter, reaching 1.02 tiles east. */
const CLUTTER_SIDE_TILES = 1.2;

const LAMP_UP_TILES = 4;
const LAMP_SIDE_TILES = 2;
const LAMP_DOWN_TILES = 1;

/**
 * The gateway's two forms reach in different directions, so their frames differ:
 * the face-on arch rises 3.6 tiles over a span-wide opening, while the top-down
 * gatehouse is narrow and runs south past its span.
 */
const GATE_ACROSS_UP_TILES = 4;
const GATE_ALONG_DOWN_TILES = 2;
const GATE_MARGIN_TILES = 1;

/** Bunting hangs 1.5 tiles up and sags half a tile; two tiles clears both. */
const BUNTING_UP_TILES = 2;
/** A pennant reaches a fraction of a tile past the span's last tile centre. */
const SPAN_END_SLACK_TILES = 1;

/** The rope hangs 1.1 tiles up; the sheets drop half a tile below it. */
const LAUNDRY_UP_TILES = 2;

/**
 * The market stall's three layers all share one frame geometry, so a layer can
 * be blitted at the same anchor as the two it sandwiches without the runtime
 * knowing anything about how far each reaches.
 *
 * The tallest reach is the canopy's ridge, two tiles above the anchor; the
 * widest is its hem, overhanging 5% of the cart's width each side; the lowest is
 * the counter's apron and ground shadow, most of a tile below. Half a tile of
 * slack all round covers the hem's ripple and the ridge cap.
 */
const STALL_UP_TILES = 2.5;
const STALL_SIDE_TILES = 0.5;
const STALL_DOWN_TILES = 0.5;

/** The board rises 0.85 tiles above its anchor and overhangs it by 3 px a side. */
const NOTICE_BOARD_UP_TILES = 1.5;

/** Both fixtures sit inside their own tile; the margin is pure insurance. */
const FIXTURE_MARGIN_TILES = 0.5;

const px = (tiles: number): number => Math.ceil(tiles * TOWNSCAPE_TILE_SCALE);

/**
 * The town's laundry spans, derived from the `TownPlan` rather than restated.
 *
 * A hand-copied span here would be a silent failure: the sheet would carry
 * frames for a width no alley has, and the lines would draw nothing.
 */
function laundrySpans(): number[] {
  const plan = createTownPlan(OVERWORLD_MAP_SIZE_TILES);
  const spans = new Set<number>();
  for (const alleyName of LAUNDRY_ALLEY_NAMES) {
    const alley = plan.surfaces.find((surface) => surface.name === alleyName);
    if (alley === undefined) continue;
    spans.add(laundryLineSpanTiles(alley.bounds.w));
  }
  return [...spans].sort((a, b) => a - b);
}

/** The town's gateway forms, derived from the `TownPlan` for the same reason. */
function gateForms(): Array<{ axis: GateArchAxis; spanTiles: number }> {
  const plan = createTownPlan(OVERWORLD_MAP_SIZE_TILES);
  const forms = new Map<string, { axis: GateArchAxis; spanTiles: number }>();
  for (const gate of plan.gates) {
    const axis: GateArchAxis = gate.bounds.w >= gate.bounds.h ? 'across' : 'along';
    const spanTiles = Math.max(gate.bounds.w, gate.bounds.h);
    forms.set(`${axis}:${spanTiles}`, { axis, spanTiles });
  }
  return [...forms.values()];
}

function buntingSpans(): number[] {
  return [...new Set(BUNTING_SPANS.map((span) => span.spanTiles))].sort((a, b) => a - b);
}

/** How many colour phases the bunting sheet carries — every span gets all of them. */
const BUNTING_PHASE_COUNT = BUNTING_SPANS.length;

function shopSignSheet(): PropSheetPlan {
  return {
    key: 'shop_sign',
    file: 'shop_sign.png',
    tileScale: TOWNSCAPE_TILE_SCALE,
    tileX: px(SIGN_WEST_TILES),
    tileY: px(SIGN_UP_TILES),
    frameWidth: px(SIGN_WEST_TILES) + px(SIGN_EAST_TILES),
    frameHeight: px(SIGN_UP_TILES) + px(ANCHOR_TILE),
    // One row per sway angle, one column per emblem: the game knows its emblem
    // for the map's lifetime and its sway changes every few frames, so the state
    // is the thing that varies and the frame is the thing that does not.
    rows: Array.from({ length: SIGN_SWAY_STEPS }, (_unused, step) => ({
      state: `sway_${step}`,
      frames: SHOP_SIGN_EMBLEMS.map((emblem: ShopSignEmblem) => (ctx, originX, originY) => {
        drawShopSign(
          ctx,
          originX,
          originY,
          TOWNSCAPE_TILE_SCALE,
          emblem,
          shopSignSwayForStep(step),
        );
      }),
    })),
  };
}

function streetLampSheet(): PropSheetPlan {
  return {
    key: 'street_lamp',
    file: 'street_lamp.png',
    tileScale: TOWNSCAPE_TILE_SCALE,
    tileX: px(LAMP_SIDE_TILES),
    tileY: px(LAMP_UP_TILES),
    frameWidth: px(LAMP_SIDE_TILES) * 2,
    frameHeight: px(LAMP_UP_TILES) + px(ANCHOR_TILE + LAMP_DOWN_TILES),
    rows: [
      {
        state: 'idle',
        frames: Array.from({ length: LAMP_FLICKER_STEPS }, (_unused, step) => (ctx, ox, oy) => {
          drawStreetLamp(ctx, ox, oy, TOWNSCAPE_TILE_SCALE, streetLampFlickerForStep(step));
        }),
      },
    ],
  };
}

function townClutterSheet(): PropSheetPlan {
  return {
    key: 'town_clutter',
    file: 'town_clutter.png',
    tileScale: TOWNSCAPE_TILE_SCALE,
    tileX: px(CLUTTER_SIDE_TILES),
    tileY: px(CLUTTER_UP_TILES),
    frameWidth: px(CLUTTER_SIDE_TILES) * 2,
    frameHeight: px(CLUTTER_UP_TILES) + px(ANCHOR_TILE),
    rows: [
      {
        state: 'idle',
        frames: TOWN_CLUTTER_KINDS.map((kind) => (ctx, ox, oy) => {
          drawTownClutter(ctx, ox, oy, TOWNSCAPE_TILE_SCALE, kind);
        }),
      },
    ],
  };
}

/**
 * One entry per gateway form, because the frame's size depends on the span: a
 * single entry with a frame per span would have to size every frame for the
 * widest, and the manifest has one geometry per key.
 */
function gateArchSheets(): PropSheetPlan[] {
  return gateForms().map(({ axis, spanTiles }) => {
    const acrossFrame = {
      tileX: px(GATE_MARGIN_TILES),
      tileY: px(GATE_ACROSS_UP_TILES),
      frameWidth: px(GATE_MARGIN_TILES) + px(spanTiles + GATE_MARGIN_TILES),
      frameHeight: px(GATE_ACROSS_UP_TILES) + px(ANCHOR_TILE + GATE_MARGIN_TILES),
    };
    const alongFrame = {
      tileX: px(GATE_MARGIN_TILES),
      tileY: px(GATE_MARGIN_TILES),
      frameWidth: px(GATE_MARGIN_TILES) + px(GATE_MARGIN_TILES * 2),
      frameHeight: px(GATE_MARGIN_TILES) + px(ANCHOR_TILE + spanTiles + GATE_ALONG_DOWN_TILES),
    };
    const frame = axis === 'across' ? acrossFrame : alongFrame;
    return {
      key: gateArchKey(axis, spanTiles),
      file: `gate_arch_${axis}_${spanTiles}.png`,
      tileScale: TOWNSCAPE_TILE_SCALE,
      ...frame,
      rows: [
        {
          state: 'idle',
          frames: [
            (ctx, ox, oy) => {
              drawGateArch(ctx, ox, oy, TOWNSCAPE_TILE_SCALE, spanTiles, axis);
            },
          ],
        },
      ],
    };
  });
}

/** One entry per span, for the reason the gateways get one: the frame is span-wide. */
function buntingSheets(): PropSheetPlan[] {
  return buntingSpans().map((spanTiles) => ({
    key: buntingKey(spanTiles),
    file: `bunting_${spanTiles}.png`,
    tileScale: TOWNSCAPE_TILE_SCALE,
    tileX: 0,
    tileY: px(BUNTING_UP_TILES),
    frameWidth: px(spanTiles + SPAN_END_SLACK_TILES),
    frameHeight: px(BUNTING_UP_TILES) + px(ANCHOR_TILE),
    rows: [
      {
        state: 'idle',
        // Every span carries every colour phase. Which span uses which phase is
        // the placement's business, and baking only the pairing in use today
        // would break the moment a span moved.
        frames: Array.from({ length: BUNTING_PHASE_COUNT }, (_unused, phase) => (ctx, ox, oy) => {
          drawBunting(ctx, ox, oy, TOWNSCAPE_TILE_SCALE, spanTiles, phase);
        }),
      },
    ],
  }));
}

function laundryLineSheets(): PropSheetPlan[] {
  return laundrySpans().map((spanTiles) => ({
    key: laundryLineKey(spanTiles),
    file: `laundry_line_${spanTiles}.png`,
    tileScale: TOWNSCAPE_TILE_SCALE,
    tileX: 0,
    tileY: px(LAUNDRY_UP_TILES),
    frameWidth: px(spanTiles + SPAN_END_SLACK_TILES),
    frameHeight: px(LAUNDRY_UP_TILES) + px(ANCHOR_TILE),
    rows: [
      {
        state: 'idle',
        frames: Array.from({ length: LAUNDRY_SWAY_STEPS }, (_unused, step) => (ctx, ox, oy) => {
          drawLaundryLine(
            ctx,
            ox,
            oy,
            TOWNSCAPE_TILE_SCALE,
            spanTiles,
            laundryLineFrameForStep(step),
          );
        }),
      },
    ],
  }));
}

/**
 * The frame every stall layer is packed into. Shared so the runtime can blit the
 * back, the front and the canopy at one anchor: three geometries would mean three
 * offsets to keep in step, and a layer half a pixel out reads as a broken cart.
 */
const STALL_FRAME = {
  tileX: px(STALL_SIDE_TILES),
  tileY: px(STALL_UP_TILES),
  frameWidth: px(STALL_SIDE_TILES * 2 + STALL_WIDTH_TILES),
  frameHeight: px(STALL_UP_TILES + ANCHOR_TILE + STALL_DOWN_TILES),
} as const;

/**
 * The stall in three sheets rather than one picture, because the vendor stands
 * *inside* it: the game draws the back, then the person, then the front and the
 * canopy over both. Baking the cart whole would put the counter behind them.
 *
 * The canopy is the only layer that moves, so it is the only one with a row per
 * ripple step; all three carry one frame per entry in `STALL_VARIANTS`.
 */
function marketStallSheets(): PropSheetPlan[] {
  return [
    {
      key: 'market_stall_back',
      file: 'market_stall_back.png',
      tileScale: TOWNSCAPE_TILE_SCALE,
      ...STALL_FRAME,
      rows: [
        {
          state: 'idle',
          frames: STALL_VARIANTS.map((variant) => (ctx, ox, oy) => {
            drawStallBack(ctx, ox, oy, TOWNSCAPE_TILE_SCALE, variant.style, variant.motif);
          }),
        },
      ],
    },
    {
      key: 'market_stall_front',
      file: 'market_stall_front.png',
      tileScale: TOWNSCAPE_TILE_SCALE,
      ...STALL_FRAME,
      rows: [
        {
          state: 'idle',
          frames: STALL_VARIANTS.map((variant) => (ctx, ox, oy) => {
            drawStallFront(ctx, ox, oy, TOWNSCAPE_TILE_SCALE, variant.style, variant.motif);
          }),
        },
      ],
    },
    {
      key: 'market_stall_canopy',
      file: 'market_stall_canopy.png',
      tileScale: TOWNSCAPE_TILE_SCALE,
      ...STALL_FRAME,
      rows: Array.from({ length: STALL_RIPPLE_STEPS }, (_unused, step) => ({
        state: `ripple_${step}`,
        frames: STALL_VARIANTS.map((variant) => (ctx, ox, oy) => {
          drawStallCanopy(
            ctx,
            ox,
            oy,
            TOWNSCAPE_TILE_SCALE,
            variant.style,
            stallPhaseForStep(step),
          );
        }),
      })),
    },
  ];
}

function noticeBoardSheet(): PropSheetPlan {
  return {
    key: 'town_notice_board',
    file: 'notice_board.png',
    tileScale: TOWNSCAPE_TILE_SCALE,
    tileX: px(FIXTURE_MARGIN_TILES),
    tileY: px(NOTICE_BOARD_UP_TILES),
    frameWidth: px(FIXTURE_MARGIN_TILES * 2 + ANCHOR_TILE),
    frameHeight: px(NOTICE_BOARD_UP_TILES + ANCHOR_TILE + FIXTURE_MARGIN_TILES),
    rows: [
      {
        state: 'idle',
        frames: [
          (ctx, ox, oy) => {
            drawNoticeBoard(ctx, ox, oy, TOWNSCAPE_TILE_SCALE);
          },
        ],
      },
    ],
  };
}

function benchSheet(): PropSheetPlan {
  return {
    key: 'town_bench',
    file: 'bench.png',
    tileScale: TOWNSCAPE_TILE_SCALE,
    tileX: px(FIXTURE_MARGIN_TILES),
    tileY: px(FIXTURE_MARGIN_TILES),
    frameWidth: px(FIXTURE_MARGIN_TILES * 2 + ANCHOR_TILE),
    frameHeight: px(FIXTURE_MARGIN_TILES * 2 + ANCHOR_TILE),
    rows: [
      {
        state: 'idle',
        frames: [
          (ctx, ox, oy) => {
            drawBench(ctx, ox, oy, TOWNSCAPE_TILE_SCALE);
          },
        ],
      },
    ],
  };
}

/** Every reusable street-furniture sheet the town paints. */
export function townscapeSheetPlans(): PropSheetPlan[] {
  return [
    shopSignSheet(),
    streetLampSheet(),
    townClutterSheet(),
    ...gateArchSheets(),
    ...buntingSheets(),
    ...laundryLineSheets(),
    ...marketStallSheets(),
    noticeBoardSheet(),
    benchSheet(),
  ];
}
