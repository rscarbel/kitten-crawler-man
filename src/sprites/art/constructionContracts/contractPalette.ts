/**
 * The colours construction-contract damage is painted in, per settlement.
 *
 * Damage sits on top of art that already exists — Taloncrest's ash-oak,
 * dressed ashlar and lime plaster, Briar Hollow's oiled walnut and grey-green
 * fieldstone — so every ramp here is resolved from the palette that art was
 * painted from rather than restated. A broken board in the village has to be
 * the village's walnut, or the break reads as a sticker.
 */

import { getTownRamp, TOWN_INK, type Ramp, type RGB } from '../town/townPalette';
import { CLOTH, INK, STONE, WOOD } from '../villageArt';
import type { TownId } from '../../../map/buildingIds';

export interface ContractPalette {
  /** Planks, posts, offcuts. */
  readonly wood: Ramp;
  /** The pale fibre of a fresh break, lighter than any weathered face. */
  readonly freshBreak: RGB;
  readonly stone: Ramp;
  readonly mortar: RGB;
  /** Plaster in the town, clay daub in the village. */
  readonly plaster: Ramp;
  /** The split battens behind a plaster skin. */
  readonly lath: Ramp;
  readonly rope: Ramp;
  readonly nail: Ramp;
  /** The darkest line in this settlement's art. */
  readonly ink: RGB;
  /** The pale chalk a builder marks a footprint out in. */
  readonly chalk: RGB;
  /** Dust raised by a finished job. */
  readonly dust: RGB;
  /** Which way a wall's boards run: the town's timber walls are boarded upright, the village's laid flat. */
  readonly wallBoardGrain: 'horizontal' | 'vertical';
  /**
   * Where a wall's masonry is. The town's stone walls are coursed ashlar top
   * to bottom; the village's walls are plank over a fieldstone footing, so
   * its stone damage belongs in the footing.
   */
  readonly wallMasonry: 'face' | 'footing';
}

const HEX_RADIX = 16;
const HEX_CHANNEL_DIGITS = 2;
const HEX_PREFIX_LENGTH = 1;

function hexRgb(hex: string): RGB {
  const channel = (index: number): number => {
    const start = HEX_PREFIX_LENGTH + index * HEX_CHANNEL_DIGITS;
    return Number.parseInt(hex.slice(start, start + HEX_CHANNEL_DIGITS), HEX_RADIX);
  };
  return [channel(0), channel(1), channel(2)];
}

function ramp(shadow: RGB, mid: RGB, light: RGB, accent: RGB): Ramp {
  return { shadow, mid, light, accent };
}

/** Hemp: the same hank in both towns, a little sun-bleached on its lit side. */
const HEMP_ROPE = ramp([92, 70, 40], [158, 126, 80], [204, 176, 124], [226, 204, 158]);
const IRON_NAIL = ramp([22, 22, 24], [52, 52, 56], [96, 96, 102], [150, 150, 158]);
const CHALK: RGB = [232, 230, 220];
const TALONCREST_FRESH_BREAK: RGB = [226, 206, 166];
const TALONCREST_MORTAR: RGB = [170, 166, 152];
const TALONCREST_DUST: RGB = [206, 196, 172];
const HOLLOW_FRESH_BREAK: RGB = [214, 178, 126];
const HOLLOW_MORTAR: RGB = [128, 120, 100];
const HOLLOW_DUST: RGB = [176, 156, 120];
/** Raw clay daub over wattle: the linen cloth's dun body, a shade warmer. */
const HOLLOW_DAUB = ramp([94, 76, 54], [150, 126, 92], [190, 168, 128], [210, 192, 156]);

const TALONCREST: ContractPalette = {
  wood: getTownRamp('oc_timber'),
  freshBreak: TALONCREST_FRESH_BREAK,
  stone: getTownRamp('oc_stone'),
  mortar: TALONCREST_MORTAR,
  plaster: getTownRamp('oc_plaster'),
  lath: getTownRamp('oc_timber'),
  rope: HEMP_ROPE,
  nail: IRON_NAIL,
  ink: TOWN_INK,
  chalk: CHALK,
  dust: TALONCREST_DUST,
  wallBoardGrain: 'vertical',
  wallMasonry: 'face',
};

const HOLLOW: ContractPalette = {
  wood: ramp(hexRgb(WOOD.deep), hexRgb(WOOD.body), hexRgb(WOOD.light), hexRgb(WOOD.highlight)),
  freshBreak: HOLLOW_FRESH_BREAK,
  stone: ramp(hexRgb(STONE.deep), hexRgb(STONE.body), hexRgb(STONE.light), hexRgb(STONE.highlight)),
  mortar: HOLLOW_MORTAR,
  plaster: HOLLOW_DAUB,
  lath: ramp(
    hexRgb(WOOD.dark),
    hexRgb(WOOD.mid),
    hexRgb(WOOD.highlight),
    hexRgb(CLOTH.linen.light),
  ),
  rope: HEMP_ROPE,
  nail: IRON_NAIL,
  ink: hexRgb(INK),
  chalk: CHALK,
  dust: HOLLOW_DUST,
  wallBoardGrain: 'horizontal',
  wallMasonry: 'footing',
};

/** Whose wood and stone the damage is cut from, by the town a spot stands in. */
const PALETTE_BY_TOWN: Readonly<Record<TownId, ContractPalette>> = {
  taloncrest: TALONCREST,
  briar_hollow: HOLLOW,
};

export function contractPalette(town: TownId): ContractPalette {
  return PALETTE_BY_TOWN[town];
}
