/**
 * The single source of truth for a generated building exterior.
 *
 * Everything downstream is derived from one of these: the painted frames, the
 * `blockedRegions` the manifest declares, the doorway `SpriteLoader` recovers
 * from those regions, and the `life` overlay's choreography. Nothing about a
 * building is authored twice — in particular the door's painted column and the
 * gap left in the blocked base course come from the same `door.col`, because
 * hand-tuning the second to match a picture of the first is how a player ends up
 * able to walk through a wall.
 *
 * ## Measures are tile-relative
 *
 * Every length here is in **tiles**, converted to pixels by multiplying by
 * `BUILDING_TILE_SCALE`. The townscape painters bolted fixed pixel constants to
 * a scale of 32 and can never be re-baked at another resolution; this kit can,
 * which makes the bake scale a knob rather than a rewrite if the memory budget
 * ever demands 32.
 */

import type { Ramp, RGB } from './ramps.js';

/**
 * Pixels per tile in the baked art: 1.5x the 32px display tile, so a Retina
 * backing store has real detail to sample. Frame sizes are always
 * `tiles * BUILDING_TILE_SCALE`, never authored directly, which keeps the
 * derived footprint (`ceil(frameWidth / tileScale)`) exact rather than rounded.
 */
export const BUILDING_TILE_SCALE = 48;

// ── materials ──────────────────────────────────────────────────────────────

export type WallMaterialId =
  | 'coursed_stone'
  | 'dressed_stone'
  | 'fieldstone'
  | 'plaster'
  | 'painted_plaster'
  | 'timber_frame'
  | 'plank';

export type RoofMaterialId = 'thatch' | 'slate' | 'clay_tile' | 'shake' | 'dome';

/** Named entry in the building ramp registry — see `ramps.ts`. */
export type RampId = string;

export interface WallSpec {
  readonly material: WallMaterialId;
  readonly ramp: RampId;
  /**
   * Second ramp the material needs: mortar for masonry, plaster infill for a
   * timber frame, the paint coat under `painted_plaster`. Materials that need
   * only one ramp ignore it, but every material states it so the palette gate
   * has the complete declared set for every building.
   */
  readonly trimRamp: RampId;
  /** Soot, damp and grime painted in facade space over the whole plane, 0..1. */
  readonly grime: number;
  /** Moss at ground contact and in shadowed creases, 0..1. */
  readonly moss: number;
}

export interface RoofSpec {
  readonly material: RoofMaterialId;
  readonly ramp: RampId;
  /** Ridge caps, half-round tiles, the rolled thatch roll. */
  readonly ridgeRamp: RampId;
  /** On-screen depth of the visible roof plane, in tiles. */
  readonly depthTiles: number;
  /** How far the eaves overhang the wall on each side, in tiles. */
  readonly overhangTiles: number;
  /** Downward bow of the ridge line, in tiles. A sagging roof reads as old. */
  readonly ridgeSagTiles: number;
  readonly chimneys: ReadonlyArray<ChimneySpec>;
  readonly dormers: ReadonlyArray<DormerSpec>;
  /** Green cast on the upslope courses. */
  readonly mossy: boolean;
  /** Slipped and missing tiles, patches of re-thatch. Higher on poorer buildings. */
  readonly disrepair: number;
}

export interface ChimneySpec {
  /** Column of the chimney stack, in tiles from the frame's left edge. */
  readonly col: number;
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly ramp: RampId;
  /** Where `life` smoke leaves the stack, derived by the animator from the pot. */
  readonly smokes: boolean;
}

export interface DormerSpec {
  readonly col: number;
  readonly widthTiles: number;
  readonly lit: boolean;
}

// ── openings ───────────────────────────────────────────────────────────────

export type DoorStyle = 'plank' | 'double' | 'arched' | 'gothic' | 'grand' | 'curtained';
export type DoorArch = 'flat_lintel' | 'round' | 'gothic' | 'none';

export interface DoorSpec {
  /**
   * Leftmost tile column of the *walkable* gap. The blocked base course is
   * emitted with a gap of exactly `[col, col + gapTiles)` and the door is
   * painted centred on that same gap, so one field decides both — hand-tuning
   * the second to match a picture of the first is how a player ends up able to
   * walk through a wall. Must leave at least one blocked column on each side.
   */
  readonly col: number;
  readonly gapTiles: 1 | 2;
  /**
   * How wide the *painted* opening is. May exceed `gapTiles`: the tiles either
   * side of the gap are blocked whatever the art does, so a grand double door
   * can read as twice the width of the slot the player actually walks through
   * without opening a pocket behind the facade.
   */
  readonly paintedWidthTiles: number;
  readonly style: DoorStyle;
  readonly arch: DoorArch;
  readonly ramp: RampId;
  /** Iron studs, hinge straps and a ring handle. */
  readonly hardware: boolean;
  /** Steps up (positive) or down (negative) to the threshold, in tiles. */
  readonly stepTiles: number;
}

export type WindowStyle = 'mullioned' | 'shuttered' | 'arched' | 'round' | 'shopfront';

export interface WindowSpec {
  /** Tile column of the window's left edge; fractional columns are allowed. */
  readonly col: number;
  /**
   * Height of the window's sill above the ground line, in tiles.
   *
   * One rule holds for windows, props and `life` effects alike: a vertical
   * position is the feature's **bottom edge, measured up from the ground line**.
   * Measured down from the frame's top edge instead — the obvious alternative —
   * it would be authored against something no building has: how far below the
   * frame's top the wall starts is derived from the roof's depth and the tallest
   * chimney, so every sill in town silently climbs onto the roof the first time
   * a roof is made steeper.
   */
  readonly baseAboveGroundTiles: number;
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly style: WindowStyle;
  /** Warm interior glow behind the glazing. Unlit windows read as dark glass. */
  readonly lit: boolean;
  /** Overrides the warm town glow — Blackwood's cold moonlit interior. */
  readonly glowRamp?: RampId;
  readonly shutters: boolean;
  readonly shutterRamp?: RampId;
  readonly flowerBox: boolean;
  /**
   * Silhouettes painted behind the glass: shop goods, a crowd, a sleeping cat.
   * Named rather than free-form so `props.ts` owns the drawing.
   */
  readonly interior?: WindowInterior;
}

export type WindowInterior = 'goods' | 'crowd' | 'bottles' | 'flash_art' | 'cat';

// ── facade-attached clutter ────────────────────────────────────────────────

export type PropKind =
  | 'barrel'
  | 'crate'
  | 'sack'
  | 'firewood'
  | 'wool_bale'
  | 'crook'
  | 'cart_wheel'
  | 'sawhorse'
  | 'plank_stack'
  | 'herb_bundle'
  | 'vine'
  | 'brazier'
  | 'lantern'
  | 'anvil'
  | 'quench_barrel'
  | 'tool_rack'
  | 'cauldron'
  | 'charm_string'
  | 'hay_bale'
  | 'pitchfork'
  | 'grain_sack'
  | 'weathervane'
  | 'rope_line'
  | 'suit_lantern'
  | 'awning'
  | 'letter_board'
  | 'relief_board'
  | 'bead_curtain'
  | 'boarded_window'
  | 'lean_to'
  | 'forge_mouth';

export interface PropSpec {
  readonly kind: PropKind;
  /** Tile column of the prop's left edge, from the frame's left edge. */
  readonly col: number;
  /**
   * Height of the prop's *base* above the ground line, in tiles. Zero for
   * anything standing on the ground; higher for anything hung on the wall.
   */
  readonly baseAboveGroundTiles: number;
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly ramp: RampId;
  /** Second colour the prop needs: strapping, cloth, flame, lettering. */
  readonly accentRamp: RampId;
  /** Text for `letter_board`; ignored by every other kind. */
  readonly label?: string;
  /**
   * Carved device for `relief_board`; ignored by every other kind.
   *
   * Named rather than seeded, because the whole job of a relief board is to say
   * what the building is: a crossed-weapons panel over the barracks door and a
   * sun disc over the temple's are the same object carrying different meanings,
   * and a device picked from a hash carries none.
   */
  readonly device?: ReliefDevice;
}

export type ReliefDevice =
  | 'crossed_weapons'
  | 'sun_disc'
  | 'mortar_and_pestle'
  | 'horn'
  | 'wheat_sheaf'
  | 'tankard'
  | 'wheel';

// ── the `life` overlay ─────────────────────────────────────────────────────

export type LifeEffectKind =
  | 'chimney_smoke'
  | 'window_breathe'
  | 'window_crowd'
  | 'brazier_flame'
  | 'forge_pulse'
  | 'spark_motes'
  | 'banner_sway'
  | 'awning_ripple'
  | 'hanging_sway'
  | 'lantern_flicker'
  | 'sleeping_cat'
  | 'finial_glint'
  | 'weathervane_swing'
  | 'suit_lantern_sequence'
  | 'bead_curtain_sway';

export interface LifeEffectSpec {
  readonly kind: LifeEffectKind;
  /** Tile column of the effect's anchor. */
  readonly col: number;
  /** Height of the effect rect's *bottom* above the ground line, in tiles. */
  readonly baseAboveGroundTiles: number;
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly ramp: RampId;
  /**
   * Cycles completed across the whole loop. Whole numbers only — a fractional
   * count leaves frame N-1 mid-stride from frame 0 and the loop visibly jumps.
   */
  readonly cycles: number;
  /** Fraction of a full cycle this effect starts ahead of the others, 0..1. */
  readonly phase: number;
  /**
   * `window_crowd` only: how many bodies walk clean past the opening, on top of
   * the ones standing at it. Absent means none.
   *
   * Stated per window rather than hashed from the seed because how busy a room
   * is is an art decision — a taproom has people crossing it and a private club
   * lounge does not, and that should not be decided by a hash. It is also the
   * knob with a cost: a walker only reads as occasional if the loop is long
   * enough to hold a visible pause, and loop length is decoded bytes.
   */
  readonly walkers?: number;
}

export interface LifeSpec {
  /**
   * 6–15. Varied across the town so the buildings do not pulse in lockstep on
   * the single shared 8 fps clock, and capped at 15 by the 16-frame radix
   * `decorationAnimationFrame` folds overlay indices with — at 16 two distinct
   * frame combinations fold to the same cache key and one building would draw
   * another's frame.
   *
   * Every frame is a whole frame of decoded sheet, so this is the most
   * expensive number in a spec. Spend it only where the loop's *length* is
   * doing something a shorter loop cannot: the pub's walkers need a pause
   * between passes, and a pause cannot outlast the loop it repeats in.
   */
  readonly frames: number;
  readonly effects: ReadonlyArray<LifeEffectSpec>;
}

// ── the building ───────────────────────────────────────────────────────────

/**
 * A horizontal band of contrasting material across the whole frontage: a string
 * course, a plinth cap, a soot band over an opening, a painted dado.
 *
 * Bands exist because a wall of one material across a whole elevation is the
 * thing that reads as a texture swatch rather than as a building. Real
 * frontages are divided horizontally — that is how a mason states which part
 * carries load — and the divisions are also where the light catches.
 */
export interface FacadeBandSpec {
  /** Height of the band's bottom above the ground line, in tiles. */
  readonly baseAboveGroundTiles: number;
  readonly heightTiles: number;
  readonly ramp: RampId;
  /** Stands proud of the wall, taking an edge light on top and dropping a shadow. */
  readonly projecting: boolean;
}

export interface FacadeSpec {
  readonly ground: WallSpec;
  /** Absent for a single-story building. */
  readonly upper?: WallSpec;
  /** Height of the ground story, in tiles, measured up from the ground line. */
  readonly groundStoryTiles: number;
  /** Taller, darker, mossier base course, in tiles. */
  readonly foundationTiles: number;
  /** Corner blocks in a lighter, larger bond. */
  readonly quoins: boolean;
  /**
   * Lean of the whole building, in tiles of horizontal displacement at the
   * eaves. The Sunken Stump has settled; everything else is plumb.
   */
  readonly leanTiles: number;
  /** How far the ground line sits below the base of the facade, in tiles. */
  readonly sinkTiles: number;
  /**
   * Horizontal courses of contrasting material across the frontage.
   *
   * A jetty is authored as one of these rather than as an overhang of its own.
   * Seen square on, an upper story that projects over the street shows the
   * viewer exactly one thing — the bressummer beam carrying it, standing proud
   * with its shadow on the wall below — and that is a projecting band. Modelling
   * the horizontal overhang would mean splitting the facade into two planes to
   * render something the projection cannot show.
   */
  readonly bands: ReadonlyArray<FacadeBandSpec>;
  /**
   * Vertical piers dividing the frontage, including one at each end.
   *
   * Zero for a plain wall. Two or more turn an elevation into bays, which is
   * what lets a wide building read as architecture rather than as one long
   * stretch of masonry — the Desperado's twelve tiles of dressed stone are
   * otherwise a cliff.
   */
  readonly pilasters: number;
  readonly pilasterRamp?: RampId;
}

export interface BuildingSpec {
  /** Manifest sprite key. */
  readonly key: string;
  /** PNG basename written into `src/images/environment/buildings/`. */
  readonly file: string;
  /** In-game name, for the review harness's labels only. */
  readonly title: string;
  /** Must equal the derived width of the asset this replaces — see `fixtures/`. */
  readonly tilesWide: number;
  readonly tilesHigh: number;
  /** Fixed per building, so a re-bake is byte-reproducible. */
  readonly seed: number;
  readonly stories: 1 | 2;
  /** Width of the visible side return, in tiles. */
  readonly sideReturnTiles: number;
  readonly facade: FacadeSpec;
  readonly roof: RoofSpec;
  readonly door: DoorSpec;
  readonly windows: ReadonlyArray<WindowSpec>;
  readonly props: ReadonlyArray<PropSpec>;
  readonly life: LifeSpec;
  /**
   * Manifest key of the PNG this replaces, for the texture-richness gate and
   * `--compare`. The gate measures the new art against the old art's own
   * number, because a fieldstone cottage and a dressed-stone club do not have
   * comparable amounts of detail and one global floor would either pass the
   * cottage trivially or fail the club unfairly.
   */
  readonly replaces: string;
}

/** Frame width in source pixels. Never author this — it is `tilesWide * scale`. */
export function frameWidthPx(spec: BuildingSpec): number {
  return spec.tilesWide * BUILDING_TILE_SCALE;
}

export function frameHeightPx(spec: BuildingSpec): number {
  return spec.tilesHigh * BUILDING_TILE_SCALE;
}

export type { Ramp, RGB };
