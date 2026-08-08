/**
 * Colour ramps for material painters.
 *
 * Every palette here is anchored to colours sampled from art that already works —
 * the two hand-repaired overworld tiles and the dungeon sheet — so generated
 * ground sits next to the existing building PNGs without a hue clash. What the
 * generated versions add is *range*: the sampled grass spans only 91→110 red
 * across its 5th–95th percentile, which is exactly why it reads as flat colour.
 */

import type { RGB } from './raster.js';

export interface Ramp {
  /** Deepest shadow value. */
  readonly shadow: RGB;
  /** Bulk colour — most pixels land near here. */
  readonly mid: RGB;
  /** Lit value. */
  readonly light: RGB;
  /** Rare sparkle/bleached value, used sparingly for detail. */
  readonly accent: RGB;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Samples a ramp with `t` in [0, 1]: shadow → mid → light. */
export function sampleRamp(ramp: Ramp, t: number): RGB {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const MIDPOINT = 0.5;
  return clamped < MIDPOINT
    ? mix(ramp.shadow, ramp.mid, clamped / MIDPOINT)
    : mix(ramp.mid, ramp.light, (clamped - MIDPOINT) / MIDPOINT);
}

export function shade(color: RGB, factor: number): RGB {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

export const GRASS_RAMP: Ramp = {
  shadow: [58, 72, 30],
  mid: [99, 112, 50],
  light: [136, 150, 70],
  accent: [172, 182, 96],
};

export const DEAD_GRASS_RAMP: Ramp = {
  shadow: [92, 84, 44],
  mid: [140, 128, 68],
  light: [174, 160, 96],
  accent: [196, 182, 118],
};

export const STREET_STONE_RAMP: Ramp = {
  shadow: [84, 70, 52],
  mid: [140, 120, 90],
  light: [178, 156, 122],
  accent: [200, 180, 148],
};

export const COBBLE_RAMP: Ramp = {
  shadow: [72, 66, 60],
  mid: [124, 116, 106],
  light: [166, 158, 146],
  accent: [190, 182, 170],
};

export const FLAGSTONE_RAMP: Ramp = {
  shadow: [104, 98, 88],
  mid: [156, 148, 134],
  light: [192, 184, 168],
  accent: [212, 204, 188],
};

export const DIRT_RAMP: Ramp = {
  shadow: [62, 46, 32],
  mid: [108, 84, 58],
  light: [148, 120, 88],
  accent: [176, 148, 112],
};

export const GRAVEL_RAMP: Ramp = {
  shadow: [66, 60, 54],
  mid: [116, 108, 98],
  light: [162, 154, 142],
  accent: [188, 180, 168],
};

// ── the wilderness: river, uplands ─────────────────────────────────────────
//
// A river is read through its bank, not its surface, so the water ramp is kept
// dark and desaturated: the animated highlights `WaterAnimationSystem` lays over
// it are the only bright pixels the river gets, and a bright base would drown
// them. Green rather than blue because the river runs through a green field —
// a saturated blue channel next to hue-73° grass reads as a painted stripe.

export const RIVER_WATER_RAMP: Ramp = {
  shadow: [16, 40, 46],
  mid: [30, 68, 76],
  light: [48, 98, 104],
  accent: [86, 138, 140],
};

/**
 * Thin upland turf: the grass ramp desaturated and pushed toward straw, so the
 * highland bands read as drier and higher rather than as a different plant.
 */
export const HIGHLAND_GRASS_RAMP: Ramp = {
  shadow: [76, 78, 44],
  mid: [124, 122, 68],
  light: [162, 156, 96],
  accent: [192, 184, 126],
};

/** Frost-shattered rock rubble — the grey a cliff sheds downhill. */
export const SCREE_RAMP: Ramp = {
  shadow: [56, 54, 52],
  mid: [102, 99, 94],
  light: [146, 142, 136],
  accent: [176, 172, 164],
};

// ── floor 1: the cellars ───────────────────────────────────────────────────
//
// Everything down here was laid by hand a long time ago out of what the town
// had: quarried limestone, fired brick, sawn oak, and the ash of whatever was
// burned in it since. The whole set is **warm** — reds and browns over a
// yellow-grey stone — which is the single property floor 2 must not share, since
// hue is what a player reads before pattern at 32 px a tile.

/** Quarried limestone, sampled from `dungeon_tileset` floor_plain and warmed. */
export const CELLAR_STONE_RAMP: Ramp = {
  shadow: [82, 74, 62],
  mid: [140, 129, 110],
  light: [178, 166, 145],
  accent: [200, 189, 168],
};

/**
 * Sandstone cut to square flags — the surface a cellar's finished rooms are laid
 * in, as opposed to the rough tan flagstone of its passages.
 *
 * Deliberately ochre rather than red. The first cut of this role was fired brick
 * in a running bond, and a running bond is a *wall*: playtested in situ it read
 * as masonry laid flat, and no amount of joint softening fixes a pattern whose
 * whole job elsewhere is to say "you cannot walk through this". Square units on
 * ruled joints say floor; the warm cast is what survives of the brick, and it is
 * what keeps this apart from `CELLAR_STONE_RAMP` at a glance.
 */
export const CELLAR_DRESSED_STONE_RAMP: Ramp = {
  shadow: [112, 92, 62],
  mid: [176, 150, 104],
  light: [208, 184, 138],
  accent: [226, 206, 164],
};

/** Lime mortar between bricks and under flagstones: pale, never white. */
export const CELLAR_MORTAR_RAMP: Ramp = {
  shadow: [94, 88, 76],
  mid: [146, 139, 124],
  light: [182, 175, 159],
  accent: [202, 195, 180],
};

/**
 * Seasoned oak, and pale for oak on purpose.
 *
 * Read against the wall rather than on its own: `CELLAR_WALL_RAMP` is a dark
 * warm brown, and boarding dark enough to look oiled sits close enough to it in
 * both value and hue that a room stops reading as a room. Contrast against the
 * wall is what makes a dungeon legible at a glance, so every floor on this level
 * is held well clear of it — the first cut had this at a mid of 92 against the
 * wall's 50 and the two blurred together on screen.
 */
export const CELLAR_TIMBER_RAMP: Ramp = {
  shadow: [82, 56, 32],
  mid: [142, 104, 64],
  light: [178, 140, 94],
  accent: [202, 170, 124],
};

/**
 * Trodden ash. The darkest floor on the level and still nowhere near the wall:
 * see `CELLAR_TIMBER_RAMP` for why every floor here is held clear of
 * `CELLAR_WALL_RAMP`. Neutral grey rather than the flagstone's tan, so the two
 * stay apart by hue where they no longer differ much by value.
 */
export const CELLAR_CINDER_RAMP: Ramp = {
  shadow: [66, 59, 52],
  mid: [110, 100, 90],
  light: [144, 132, 118],
  accent: [170, 157, 141],
};

/**
 * Rubble masonry: rough warm stone in a lot of mortar.
 *
 * Much darker than any floor on the level, and deliberately so. A dungeon map is
 * mostly solid rock — in a framed screenshot of floor 1 the walls are four fifths
 * of the pixels — so a wall that carries anything like a floor's brightness stops
 * being a backdrop and starts competing with the rooms it is supposed to frame.
 * The first cut sat at a mid of 84 and turned every screenshot into a wall of
 * brickwork with a few pale rooms punched out of it.
 */
export const CELLAR_WALL_RAMP: Ramp = {
  shadow: [24, 20, 16],
  mid: [50, 42, 33],
  light: [72, 61, 48],
  accent: [92, 79, 63],
};

// ── floor 2: the service level ─────────────────────────────────────────────
//
// Machine-made, poured and bolted rather than laid: a plant room under a city
// block. Every ramp is pushed toward blue-grey, and the one colour in the set is
// an institutional green, so the floor reads cold at a glance where floor 1
// reads warm. Still unmistakably indoors — concrete slab, terrazzo, checker
// plate and painted blockwork are all building materials and none of them
// weather.

export const POURED_CONCRETE_RAMP: Ramp = {
  shadow: [86, 91, 98],
  mid: [136, 142, 150],
  light: [172, 178, 186],
  accent: [196, 201, 208],
};

export const TERRAZZO_RAMP: Ramp = {
  shadow: [134, 136, 134],
  mid: [184, 186, 182],
  light: [212, 214, 209],
  accent: [230, 232, 227],
};

/** The aggregate in terrazzo: mostly dark chips, a few bright ones. */
export const TERRAZZO_CHIP_RAMP: Ramp = {
  shadow: [54, 57, 62],
  mid: [94, 99, 104],
  light: [148, 151, 150],
  accent: [204, 206, 201],
};

export const STEEL_PLATE_RAMP: Ramp = {
  shadow: [56, 63, 73],
  mid: [97, 106, 118],
  light: [139, 150, 164],
  accent: [178, 189, 203],
};

/** Institutional vinyl: the one saturated colour on the floor, and a drab one. */
export const INSTITUTIONAL_VINYL_RAMP: Ramp = {
  shadow: [46, 58, 50],
  mid: [79, 97, 83],
  light: [110, 130, 112],
  accent: [140, 160, 140],
};

/**
 * Painted blockwork. Held to the same darkness as floor 1's wall — see
 * `CELLAR_WALL_RAMP` for why a wall has to recede — and separated from it by hue
 * and by unit size rather than by brightness.
 */
export const CINDERBLOCK_RAMP: Ramp = {
  shadow: [30, 35, 33],
  mid: [57, 65, 61],
  light: [81, 91, 85],
  accent: [101, 111, 103],
};

// ── town building interiors ────────────────────────────────────────────────
//
// Seen from inside, a town building is joinery and plaster, not quarried rock.
// These sit deliberately lighter and warmer than either dungeon floor's set:
// a shop is a lit room somebody sweeps, and it has to feel like one the moment
// the player steps in off the street.

/** Sawn and waxed boards — paler and finer than the cellar's structural oak. */
export const INTERIOR_BOARD_RAMP: Ramp = {
  shadow: [104, 72, 42],
  mid: [162, 122, 76],
  light: [196, 158, 108],
  accent: [216, 184, 140],
};

/** The tower's flagged stone: cool, cut square, and swept. */
export const INTERIOR_STONE_RAMP: Ramp = {
  shadow: [92, 92, 96],
  mid: [142, 142, 146],
  light: [176, 176, 180],
  accent: [198, 198, 202],
};

/**
 * Lime plaster over the timber frame.
 *
 * Light for a wall, which is the opposite of the rule the dungeon walls follow —
 * and right here for the same underlying reason. Down there a wall must recede
 * because rock is four fifths of the screen; in a room eighteen tiles across the
 * wall is a thin border and the job is to look like a plastered room rather than
 * to get out of the way. The mortar-dark joint and the contact shading under it
 * are what keep it reading as solid.
 */
export const INTERIOR_PLASTER_RAMP: Ramp = {
  shadow: [128, 116, 100],
  mid: [186, 172, 150],
  light: [216, 204, 184],
  accent: [232, 222, 206],
};

/** Oiled counter timber: the darkest thing in the room, and the only furniture. */
export const INTERIOR_COUNTER_RAMP: Ramp = {
  shadow: [52, 33, 20],
  mid: [96, 64, 38],
  light: [132, 94, 60],
  accent: [158, 120, 82],
};

/**
 * Cut rushes strewn over an inn's boards.
 *
 * Paler and greyer than `DEAD_GRASS_RAMP`, which is grass that died standing in
 * the weather; this is stalk cut green, dried under a roof and then walked flat.
 */
export const INTERIOR_RUSH_RAMP: Ramp = {
  shadow: [116, 98, 58],
  mid: [166, 146, 94],
  light: [204, 186, 132],
  accent: [226, 212, 166],
};

/**
 * A floor that was never boarded: earth trodden flat and swept.
 *
 * Darker and much greyer than the street's `DIRT_RAMP`. Street dirt is churned
 * and lit by the sky; this has lived under a roof for a generation, and the
 * difference between the two is what stops a cottage reading as a yard.
 */
export const INTERIOR_EARTH_RAMP: Ramp = {
  shadow: [56, 45, 35],
  mid: [95, 79, 62],
  light: [130, 112, 90],
  accent: [154, 136, 112],
};

/** Broom-swept dust, dragged into arcs across packed earth. */
export const INTERIOR_SWEEP_RAMP: Ramp = {
  shadow: [110, 96, 76],
  mid: [136, 120, 98],
  light: [160, 144, 120],
  accent: [178, 162, 138],
};

/**
 * Flagstones laid indoors: warmer and dimmer than the street's `FLAGSTONE_RAMP`,
 * because these are lit by hearth and candle rather than by open sky.
 */
export const INTERIOR_FLAG_RAMP: Ramp = {
  shadow: [86, 80, 74],
  mid: [136, 128, 118],
  light: [172, 163, 150],
  accent: [194, 186, 172],
};

/** The wide dark joints an interior flagstone floor is bedded in. */
export const INTERIOR_FLAG_MORTAR_RAMP: Ramp = {
  shadow: [38, 34, 30],
  mid: [56, 50, 44],
  light: [74, 67, 59],
  accent: [90, 82, 72],
};

/** Woad, sunk into an inking shop's boards and never coming out again. */
export const INK_WOAD_RAMP: Ramp = {
  shadow: [22, 34, 62],
  mid: [38, 58, 100],
  light: [60, 86, 136],
  accent: [88, 118, 168],
};

/** Oak-gall black: the darkest thing on an inking shop's floor. */
export const INK_GALL_RAMP: Ramp = {
  shadow: [14, 12, 14],
  mid: [30, 26, 28],
  light: [50, 44, 46],
  accent: [70, 62, 64],
};

/** Madder red, thinned and spilled — a rust rather than a blood colour. */
export const INK_MADDER_RAMP: Ramp = {
  shadow: [70, 20, 18],
  mid: [112, 36, 30],
  light: [148, 58, 46],
  accent: [176, 84, 68],
};

/**
 * The Bopca station's three floor ramps.
 *
 * Anchored to the art the floor has to sit next to rather than to the retired
 * hand-drawn safe-room checkerboard: the counter's oiled oak (`#6b452a`) and
 * grey-green work surface (`#8d9188`) in `src/sprites/safeRoomCounter.ts`, and
 * the chef's own warm skin and apron in `src/sprites/bopcaSprite.ts`. The old
 * checkerboard spanned `#f0e4c8`→`#e8d8b8` — eight levels of red across the whole
 * floor, which is why it read as painted card rather than as glazed tile.
 *
 * Warm but not *earthy*. Floors 1 and 2 are indoor dungeons, and a saturated
 * terracotta reads as a sunlit courtyard however it is laid; these sit a few
 * degrees toward grey so lamplight is doing the warming rather than the pigment.
 */
export const BOPCA_TILE_RAMP: Ramp = {
  shadow: [152, 138, 112],
  mid: [208, 194, 166],
  light: [234, 224, 202],
  accent: [246, 240, 226],
};

export const BOPCA_HEARTH_RAMP: Ramp = {
  shadow: [92, 62, 50],
  mid: [140, 98, 78],
  light: [174, 130, 106],
  accent: [196, 158, 134],
};

/** Bare screed under a worn-through threshold: grey, never sandy. */
export const BOPCA_SCUFF_RAMP: Ramp = {
  shadow: [74, 71, 66],
  mid: [118, 113, 105],
  light: [152, 146, 136],
  accent: [174, 168, 158],
};
