/**
 * What every rock painter shares: the lithologies, the cell a rock is painted
 * into, the width budget that keeps a rock inside its one blocked tile, and the
 * quarry's dressed-stone palettes.
 *
 * **Art must never overhang its tile.** Only the anchor tile is non-walkable,
 * so every solid pixel outside it is ground the player can walk onto while
 * being drawn behind the stone. Every rock is built inside a half-width budget
 * of `MAX_HALF_WIDTH_TILES`, and `generate-rock-sprites.ts` fails the bake if a
 * solid pixel escapes anyway.
 *
 * Light comes from the upper left, matching every other prop in the repo.
 */

/**
 * Rock type. Each carries its own palette *and* its own surface treatment —
 * swapping only the colours produced four recolours of the same stone.
 */
export type Lithology = 'granite' | 'sandstone' | 'basalt' | 'limestone';

/** The cell a rock is painted into, in absolute sheet pixels. */
export interface RockFrame {
  /** Left edge of the anchor tile. */
  readonly originX: number;
  /** Top edge of the anchor tile. */
  readonly originY: number;
  /** Bottom edge of the cell — how much room the contact shadow has. */
  readonly bottomY: number;
  readonly tileScale: number;
}

export interface Palette {
  readonly shadow: string;
  readonly body: string;
  readonly light: string;
  readonly rim: string;
  readonly crack: string;
}

/**
 * The four rock palettes.
 *
 * Granite is sampled to sit beside the generated `scree` ground material rather
 * than beside anything hand-drawn — the quarry is a scree slope.
 *
 * Nothing else depends on these values. `drawRiverRock` in `decorationTiles.ts`
 * does not match granite — it has its own ramp, deliberately darker and bluer,
 * because a stone standing in a river is wet. These four palettes can be
 * retuned freely.
 *
 * The other three are spaced around it in *value* as much as in hue: basalt
 * darker than the ground it stands on, limestone lighter, sandstone warmer. Two
 * rocks that differ only in hue read as the same rock under different weather.
 */
const PALETTES: Readonly<Record<Lithology, Palette>> = {
  granite: {
    shadow: '#3b3a38',
    body: '#6a6862',
    light: '#8f8c83',
    rim: '#aba69a',
    crack: '#2c2b29',
  },
  sandstone: {
    shadow: '#54402e',
    body: '#96774f',
    light: '#bf9c6b',
    rim: '#d9bd90',
    crack: '#43331f',
  },
  basalt: {
    shadow: '#212328',
    body: '#42454b',
    light: '#61646b',
    rim: '#8a8e97',
    crack: '#14161a',
  },
  limestone: {
    shadow: '#6b6d64',
    body: '#9fa094',
    light: '#c5c5b7',
    rim: '#dfdecf',
    crack: '#585a51',
  },
};

/**
 * Lichen and moss, taken **literally** from `src/sprites/art/treeArt.ts`'s foliage ramps rather
 * than picked to look about right, so a boulder in a wood and the wood around it
 * are the same green. `MOSS_DARK` is `OAK_FOLIAGE.dark` and `MOSS_LIGHT` is
 * `OAK_FOLIAGE.mid`.
 *
 * Copied rather than imported because `src/sprites/art/treeArt.ts` keeps its ramps private, and
 * exporting a tree's palette so a rock can borrow it would make every future
 * change to the forest a change to the rocks as well. These values must stay
 * inside the 85°–120° hue band that file states its foliage is confined to.
 */
export const MOSS_DARK = '#2c4a1f';
export const MOSS_LIGHT = '#3e6529';

/**
 * Half-width budget, in tiles, and the only reason the player cannot stand
 * inside a boulder. `TILE_SIZE / 2` is 0.5 tiles; the margin below that is what
 * keeps antialiasing on the outermost edge from bleeding into the neighbouring
 * tile. Every stone in a cluster is placed and normalised inside this.
 */
export const MAX_HALF_WIDTH_TILES = 0.46;

function parseColor(hex: string): readonly [number, number, number] {
  const HEX_RADIX = 16;
  const RED_START = 1;
  const CHANNEL_DIGITS = 2;
  const red = Number.parseInt(hex.slice(RED_START, RED_START + CHANNEL_DIGITS), HEX_RADIX);
  const green = Number.parseInt(
    hex.slice(RED_START + CHANNEL_DIGITS, RED_START + CHANNEL_DIGITS * 2),
    HEX_RADIX,
  );
  const blue = Number.parseInt(
    hex.slice(RED_START + CHANNEL_DIGITS * 2, RED_START + CHANNEL_DIGITS * 3),
    HEX_RADIX,
  );
  return [red, green, blue];
}

const CHANNEL_MAX = 255;

function shadeChannels(hex: string, amount: number): readonly [number, number, number] {
  const [red, green, blue] = parseColor(hex);
  const target = amount >= 0 ? CHANNEL_MAX : 0;
  const weight = Math.abs(amount);
  const mix = (channel: number): number => Math.round(channel + (target - channel) * weight);
  return [mix(red), mix(green), mix(blue)];
}

/** Mixes toward white for `amount > 0` and toward black for `amount < 0`. */
export function shade(hex: string, amount: number): string {
  const [red, green, blue] = shadeChannels(hex, amount);
  return `rgb(${red},${green},${blue})`;
}

/**
 * The same colour at a chosen alpha.
 *
 * A gradient that fades to `rgba(0,0,0,0)` fades to transparent *black*, and
 * canvas interpolates the channels un-premultiplied — so the midpoint is a
 * half-opaque dark grey and the band reads as a dirty stripe rather than as a
 * fade. Fading to the same RGB at zero alpha is what makes it disappear.
 */
export function shadeAlpha(hex: string, amount: number, alpha: number): string {
  const [red, green, blue] = shadeChannels(hex, amount);
  return `rgba(${red},${green},${blue},${alpha})`;
}

/** One lithology's palette, for the quarry's dressed stone (`rockDepositArt.ts`). */
export function rockPalette(lithology: Lithology): Palette {
  return PALETTES[lithology];
}
