/**
 * Colours for the reward chest: the wood, metal, gems and light of each
 * rarity's chest, and the light it throws when it opens.
 *
 * Every rarity's own hue comes from `palette.rarity`, so a chest is always the
 * colour of its rarity frame in the tray below it. The neutral materials a
 * chest is built from (oak, iron, steel, gold leaf, gemstones) live here
 * beside them.
 */

import type { Rarity } from '../../core/items/defs/rarity';
import { darken, lighten, mix } from './color';
import { palette } from './tokens';

/** One material in three tones: lit, as it is, and in shadow. */
export interface ChestMaterial {
  readonly light: string;
  readonly base: string;
  readonly dark: string;
}

export interface ChestInk {
  /** The planks or panels of the body and the lid. */
  readonly body: ChestMaterial;
  /** The seams between planks and the grain running along them. */
  readonly grain: string;
  /** The straps that run over the lid and down the front. */
  readonly band: ChestMaterial;
  /** Corner caps, edge trims, the hasp and the lock plate. */
  readonly trim: ChestMaterial;
  readonly rivet: ChestMaterial;
  /** The keyhole plate's gem, where the chest has one. */
  readonly keyGem: ChestMaterial | null;
  /** Gems set along the straps, alternating in this order. */
  readonly studs: readonly ChestMaterial[];
  /** Inlaid runes that glow, where the chest has them. */
  readonly rune: string | null;
  /** Scrolled metal inlay over the panels, where the chest has it. */
  readonly filigree: ChestMaterial | null;
  /** Wings folded against the sides, where the chest has them. */
  readonly feather: ChestMaterial | null;
  /** The ring floating over the lid, where the chest has one. */
  readonly halo: ChestMaterial | null;
  /** The inside of the chest: its walls and the dark at the bottom. */
  readonly interiorWall: string;
  readonly interiorShadow: string;
  /** The heap of treasure inside. */
  readonly treasure: ChestMaterial;
  /** The light leaking from the seams and pouring out of the open chest. */
  readonly glow: string;
  /** The hottest part of that light. */
  readonly glowCore: string;
  /** The pool of shadow the chest sits in. */
  readonly groundShadow: string;
}

/** The weathered oak every wooden chest is built from. */
const OAK: ChestMaterial = { light: '#C08A52', base: '#8E5A2E', dark: '#4E2E14' };
const OAK_GRAIN = '#3A200C';
const IRON: ChestMaterial = { light: '#7A808C', base: '#454A54', dark: '#1C1F25' };
const STEEL: ChestMaterial = { light: '#F2F6FB', base: '#A9B5C4', dark: '#4F5A69' };
const VERDIGRIS: ChestMaterial = { light: '#9DEBD0', base: '#3FA68C', dark: '#1B5447' };
const COPPER: ChestMaterial = { light: '#F0B27A', base: '#B8733A', dark: '#5E3416' };
const GOLD: ChestMaterial = { light: '#FFF0B0', base: '#F2BE45', dark: '#8F5F12' };
const RUBY: ChestMaterial = { light: '#FF9AAE', base: '#E0284A', dark: '#6E0A1E' };
const EMERALD: ChestMaterial = { light: '#A6F7CE', base: '#1FBF78', dark: '#0A5E37' };
const SAPPHIRE: ChestMaterial = { light: '#B5D0FF', base: '#2E6BFF', dark: '#0D2878' };
const AMETHYST_CORE = '#FBF4FF';
const INTERIOR_WALL = '#2B170A';
const INTERIOR_SHADOW = '#0C0603';
const GROUND_SHADOW = '#000000';

/** How far a lacquer's lit and shaded tones sit from its rarity's own colour. */
const LACQUER_LIGHT_SHARE = 0.25;
const LACQUER_DARK_SHARE = 0.45;
/** How far a painted chest's grain, and the Epic chest's wood, sit from their hue toward black. */
const PAINTED_WOOD_DARK_SHARE = 0.55;
const VIOLET_WOOD_SHADOW_SHARE = 0.8;
/** The Legendary chest's gilding leans from plain gold toward its rarity's orange. */
const GILT_RARITY_SHARE = 0.35;
/** Pearl takes the faintest wash of its prismatic glow in its shadows. */
const PEARL_SHADOW_GLOW_SHARE = 0.25;
/** Green bands on the Uncommon chest are lacquered over the oak, a shade under their rarity colour. */
const BAND_LACQUER_DARK_SHARE = 0.2;

function lacquer(hue: string): ChestMaterial {
  return {
    light: lighten(hue, LACQUER_LIGHT_SHARE),
    base: hue,
    dark: darken(hue, LACQUER_DARK_SHARE),
  };
}

const { rarity } = palette;

export const REWARD_CHEST_INK: Readonly<Record<Rarity, ChestInk>> = {
  Common: {
    body: OAK,
    grain: OAK_GRAIN,
    band: IRON,
    trim: IRON,
    rivet: IRON,
    keyGem: null,
    studs: [],
    rune: null,
    filigree: null,
    feather: null,
    halo: null,
    interiorWall: INTERIOR_WALL,
    interiorShadow: INTERIOR_SHADOW,
    treasure: GOLD,
    glow: rarity.common.glow,
    glowCore: rarity.common.light,
    groundShadow: GROUND_SHADOW,
  },
  Uncommon: {
    body: OAK,
    grain: OAK_GRAIN,
    band: lacquer(darken(rarity.uncommon.base, BAND_LACQUER_DARK_SHARE)),
    trim: VERDIGRIS,
    rivet: COPPER,
    keyGem: null,
    studs: [],
    rune: null,
    filigree: null,
    feather: null,
    halo: null,
    interiorWall: INTERIOR_WALL,
    interiorShadow: INTERIOR_SHADOW,
    treasure: GOLD,
    glow: rarity.uncommon.glow,
    glowCore: rarity.uncommon.light,
    groundShadow: GROUND_SHADOW,
  },
  Rare: {
    body: {
      light: rarity.rare.base,
      base: rarity.rare.deep,
      dark: darken(rarity.rare.deep, LACQUER_DARK_SHARE),
    },
    grain: darken(rarity.rare.deep, PAINTED_WOOD_DARK_SHARE),
    band: STEEL,
    trim: STEEL,
    rivet: STEEL,
    keyGem: SAPPHIRE,
    studs: [],
    rune: null,
    filigree: null,
    feather: null,
    halo: null,
    interiorWall: INTERIOR_WALL,
    interiorShadow: INTERIOR_SHADOW,
    treasure: GOLD,
    glow: rarity.rare.glow,
    glowCore: rarity.rare.light,
    groundShadow: GROUND_SHADOW,
  },
  Epic: {
    body: {
      light: darken(rarity.epic.base, LACQUER_DARK_SHARE),
      base: darken(rarity.epic.deep, PAINTED_WOOD_DARK_SHARE),
      dark: darken(rarity.epic.deep, VIOLET_WOOD_SHADOW_SHARE),
    },
    grain: darken(rarity.epic.deep, VIOLET_WOOD_SHADOW_SHARE),
    band: IRON,
    trim: {
      light: rarity.epic.light,
      base: mix(IRON.base, rarity.epic.base, LACQUER_LIGHT_SHARE),
      dark: IRON.dark,
    },
    rivet: IRON,
    keyGem: lacquer(rarity.epic.base),
    studs: [],
    rune: rarity.epic.glow,
    filigree: null,
    feather: null,
    halo: null,
    interiorWall: darken(rarity.epic.deep, PAINTED_WOOD_DARK_SHARE),
    interiorShadow: INTERIOR_SHADOW,
    treasure: GOLD,
    glow: rarity.epic.glow,
    glowCore: AMETHYST_CORE,
    groundShadow: GROUND_SHADOW,
  },
  Legendary: {
    body: {
      light: GOLD.light,
      base: mix(GOLD.base, rarity.legendary.base, GILT_RARITY_SHARE),
      dark: mix(GOLD.dark, rarity.legendary.deep, GILT_RARITY_SHARE),
    },
    grain: rarity.legendary.deep,
    band: {
      light: rarity.legendary.light,
      base: rarity.legendary.deep,
      dark: darken(rarity.legendary.deep, LACQUER_DARK_SHARE),
    },
    trim: GOLD,
    rivet: GOLD,
    keyGem: RUBY,
    studs: [RUBY, EMERALD],
    rune: null,
    filigree: null,
    feather: null,
    halo: null,
    interiorWall: darken(rarity.legendary.deep, LACQUER_DARK_SHARE),
    interiorShadow: INTERIOR_SHADOW,
    treasure: GOLD,
    glow: rarity.legendary.glow,
    glowCore: rarity.legendary.light,
    groundShadow: GROUND_SHADOW,
  },
  Divine: {
    body: {
      light: rarity.divine.light,
      base: rarity.divine.base,
      dark: mix(rarity.divine.deep, rarity.divine.glow, PEARL_SHADOW_GLOW_SHARE),
    },
    grain: rarity.divine.deep,
    band: GOLD,
    trim: GOLD,
    rivet: GOLD,
    keyGem: lacquer(rarity.divine.glow),
    studs: [],
    rune: null,
    filigree: GOLD,
    feather: {
      light: rarity.divine.light,
      base: rarity.divine.base,
      dark: rarity.divine.deep,
    },
    halo: GOLD,
    interiorWall: rarity.divine.deep,
    interiorShadow: darken(rarity.divine.deep, LACQUER_DARK_SHARE),
    treasure: GOLD,
    glow: rarity.divine.glow,
    glowCore: rarity.divine.light,
    groundShadow: GROUND_SHADOW,
  },
};
