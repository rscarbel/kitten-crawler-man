/**
 * What every kind of light in the dungeon does: how far it reaches, what
 * colour it throws, how it flickers, and how big a glow it adds at the sharp
 * render preset.
 *
 * Pure data, so the placement code that decides where a light stands and the
 * lighting pass that draws it never have to know about each other. A new
 * fixture gets light by naming one of these kinds when it is registered.
 */

import type { GlowStop } from '../../sprites/radialGlow';
import type { LightColour, LightSourceKind } from '../../map/dungeon/roomCharacters';

/** A light that comes and goes with what makes it: a crawler, a missile, a blast. */
export type DynamicLightKind =
  | 'crawler'
  | 'companion'
  | 'magic_missile'
  | 'fireball'
  | 'lava_bolt'
  | 'explosion'
  | 'coals'
  | 'bolt'
  | 'lightning'
  | 'acid_spit';

/** Every colour a glow can be: a region's light colour, or one only effects throw. */
export type GlowColour = LightColour | 'arcane' | 'fire' | 'acid' | 'specimen';

/**
 * A light a boss room hangs for mood alone. A boss room is never darkened, so
 * these only colour it, and only at the sharp preset.
 */
export type MoodLightKind = 'hanging_bulb' | 'strip_light' | 'vat_glow' | 'flood_lamp';

/** Every kind of light the lighting pass knows how to draw. */
export type LightKind = LightSourceKind | DynamicLightKind | MoodLightKind | 'hearth';

/**
 * How a light's strength moves over time.
 *
 * - `steady`: never changes.
 * - `flame`: two sines beating against each other, like the nursery's sconces.
 * - `brazier`: a flame with a deeper, faster beat.
 * - `candle`: a slow, shallow sway.
 * - `faulty_tube`: steady, then dark in short bursts.
 * - `pulse`: a slow breath in and out, for emergency lights.
 */
export type FlickerProfile = 'steady' | 'flame' | 'brazier' | 'candle' | 'faulty_tube' | 'pulse';

export interface LightKindSpec {
  /** How far the light cuts the dark, in tiles. */
  readonly reachTiles: number;
  /** Radius of the additive colour glow drawn at the sharp preset, in tiles; 0 for none. */
  readonly glowRadiusTiles: number;
  /** Multiplies the glow's colour stops; 1 is the colour's own tune. */
  readonly glowStrength: number;
  /**
   * The light's own colour, or null for a light that takes the colour of the
   * region it stands in (a ceiling tube is whatever its room's tubes are).
   */
  readonly colour: GlowColour | null;
  readonly flicker: FlickerProfile;
}

/**
 * The reference tune is the goblin nursery's wall sconce: its warm pool has a
 * radius of 3.6 tiles, and every other flame is set against it.
 */
const SCONCE_GLOW_RADIUS_TILES = 3.6;
const SCONCE_REACH_TILES = 4;
const STANDING_TORCH_REACH_TILES = 3.5;
const STANDING_TORCH_GLOW_RADIUS_TILES = 3.2;
const BRAZIER_REACH_TILES = 5;
const BRAZIER_GLOW_RADIUS_TILES = 4.2;
const BRAZIER_GLOW_STRENGTH = 1.2;
const CANDLE_REACH_TILES = 2;
const CANDLE_GLOW_RADIUS_TILES = 1.8;
const CANDLE_GLOW_STRENGTH = 0.7;
const TUBE_REACH_TILES = 5;
const TUBE_GLOW_RADIUS_TILES = 3;
const TUBE_GLOW_STRENGTH = 0.5;
const SODIUM_REACH_TILES = 4;
const SODIUM_GLOW_RADIUS_TILES = 3;
const EMERGENCY_REACH_TILES = 2;
const EMERGENCY_GLOW_RADIUS_TILES = 1.6;
const EMERGENCY_GLOW_STRENGTH = 0.8;
const FAINT_GLOW_REACH_TILES = 1.5;
const FAINT_GLOW_RADIUS_TILES = 1.2;
const FAINT_GLOW_STRENGTH = 0.6;
const BOILER_WINDOW_REACH_TILES = 2.5;
const DESK_LAMP_REACH_TILES = 2.5;
const DESK_LAMP_GLOW_RADIUS_TILES = 2;
const HEARTH_REACH_TILES = 6;
const HEARTH_GLOW_RADIUS_TILES = 5;
const HEARTH_GLOW_STRENGTH = 0.6;

/*
 * Mood lights colour a fight that must read exactly as it was tuned, so every
 * one is held well under a torch's strength: warmth over the floor, never a
 * hot spot a telegraph could be lost in.
 */
const HANGING_BULB_REACH_TILES = 6;
const HANGING_BULB_GLOW_RADIUS_TILES = 5.5;
const HANGING_BULB_GLOW_STRENGTH = 0.55;
const STRIP_LIGHT_REACH_TILES = 5;
const STRIP_LIGHT_GLOW_RADIUS_TILES = 4;
const STRIP_LIGHT_GLOW_STRENGTH = 0.45;
const VAT_GLOW_REACH_TILES = 2;
const VAT_GLOW_RADIUS_TILES = 2.2;
const VAT_GLOW_STRENGTH = 0.5;
const FLOOD_LAMP_REACH_TILES = 7;
const FLOOD_LAMP_GLOW_RADIUS_TILES = 6;
const FLOOD_LAMP_GLOW_STRENGTH = 0.4;

/** Carl's light: soft, neutral, and always there, so a pitch-black room is never unfair. */
export const CRAWLER_LIGHT_REACH_TILES = 3.5;
const COMPANION_REACH_TILES = 2;
const MISSILE_REACH_TILES = 2.2;
const MISSILE_GLOW_RADIUS_TILES = 1.6;
const FIREBALL_REACH_TILES = 3;
const FIREBALL_GLOW_RADIUS_TILES = 2.2;
const EXPLOSION_REACH_TILES = 6;
const EXPLOSION_GLOW_RADIUS_TILES = 4;
const COALS_REACH_TILES = 1.5;
const COALS_GLOW_RADIUS_TILES = 1.2;
const BOLT_REACH_TILES = 1.8;
const BOLT_GLOW_RADIUS_TILES = 1.3;
const LIGHTNING_REACH_TILES = 3.5;
const LIGHTNING_GLOW_RADIUS_TILES = 2.5;
const NO_GLOW = 0;
const FULL = 1;

export const LIGHT_KINDS = {
  wall_sconce: {
    reachTiles: SCONCE_REACH_TILES,
    glowRadiusTiles: SCONCE_GLOW_RADIUS_TILES,
    glowStrength: FULL,
    colour: 'warm',
    flicker: 'flame',
  },
  standing_torch: {
    reachTiles: STANDING_TORCH_REACH_TILES,
    glowRadiusTiles: STANDING_TORCH_GLOW_RADIUS_TILES,
    glowStrength: FULL,
    colour: 'warm',
    flicker: 'flame',
  },
  brazier: {
    reachTiles: BRAZIER_REACH_TILES,
    glowRadiusTiles: BRAZIER_GLOW_RADIUS_TILES,
    glowStrength: BRAZIER_GLOW_STRENGTH,
    colour: 'warm',
    flicker: 'brazier',
  },
  candle_cluster: {
    reachTiles: CANDLE_REACH_TILES,
    glowRadiusTiles: CANDLE_GLOW_RADIUS_TILES,
    glowStrength: CANDLE_GLOW_STRENGTH,
    colour: 'tallow',
    flicker: 'candle',
  },
  fluorescent_tube: {
    reachTiles: TUBE_REACH_TILES,
    glowRadiusTiles: TUBE_GLOW_RADIUS_TILES,
    glowStrength: TUBE_GLOW_STRENGTH,
    colour: null,
    flicker: 'steady',
  },
  sodium_lamp: {
    reachTiles: SODIUM_REACH_TILES,
    glowRadiusTiles: SODIUM_GLOW_RADIUS_TILES,
    glowStrength: FULL,
    colour: 'sodium',
    flicker: 'steady',
  },
  emergency_light: {
    reachTiles: EMERGENCY_REACH_TILES,
    glowRadiusTiles: EMERGENCY_GLOW_RADIUS_TILES,
    glowStrength: EMERGENCY_GLOW_STRENGTH,
    colour: 'emergency_red',
    flicker: 'pulse',
  },
  glow_fungus: {
    reachTiles: FAINT_GLOW_REACH_TILES,
    glowRadiusTiles: FAINT_GLOW_RADIUS_TILES,
    glowStrength: FAINT_GLOW_STRENGTH,
    colour: 'cold',
    flicker: 'steady',
  },
  vending_glow: {
    reachTiles: FAINT_GLOW_REACH_TILES,
    glowRadiusTiles: FAINT_GLOW_RADIUS_TILES,
    glowStrength: FAINT_GLOW_STRENGTH,
    colour: 'cool_white',
    flicker: 'steady',
  },
  monitor_glow: {
    reachTiles: FAINT_GLOW_REACH_TILES,
    glowRadiusTiles: FAINT_GLOW_RADIUS_TILES,
    glowStrength: FAINT_GLOW_STRENGTH,
    colour: 'monitor',
    flicker: 'steady',
  },
  boiler_window: {
    reachTiles: BOILER_WINDOW_REACH_TILES,
    glowRadiusTiles: FAINT_GLOW_RADIUS_TILES,
    glowStrength: FULL,
    colour: 'sodium',
    flicker: 'brazier',
  },
  desk_lamp: {
    reachTiles: DESK_LAMP_REACH_TILES,
    glowRadiusTiles: DESK_LAMP_GLOW_RADIUS_TILES,
    glowStrength: FULL,
    colour: 'tallow',
    flicker: 'steady',
  },
  hearth: {
    reachTiles: HEARTH_REACH_TILES,
    glowRadiusTiles: HEARTH_GLOW_RADIUS_TILES,
    glowStrength: HEARTH_GLOW_STRENGTH,
    colour: 'warm',
    flicker: 'candle',
  },
  hanging_bulb: {
    reachTiles: HANGING_BULB_REACH_TILES,
    glowRadiusTiles: HANGING_BULB_GLOW_RADIUS_TILES,
    glowStrength: HANGING_BULB_GLOW_STRENGTH,
    colour: 'tallow',
    flicker: 'candle',
  },
  strip_light: {
    reachTiles: STRIP_LIGHT_REACH_TILES,
    glowRadiusTiles: STRIP_LIGHT_GLOW_RADIUS_TILES,
    glowStrength: STRIP_LIGHT_GLOW_STRENGTH,
    colour: 'cool_white',
    flicker: 'steady',
  },
  vat_glow: {
    reachTiles: VAT_GLOW_REACH_TILES,
    glowRadiusTiles: VAT_GLOW_RADIUS_TILES,
    glowStrength: VAT_GLOW_STRENGTH,
    colour: 'specimen',
    flicker: 'steady',
  },
  flood_lamp: {
    reachTiles: FLOOD_LAMP_REACH_TILES,
    glowRadiusTiles: FLOOD_LAMP_GLOW_RADIUS_TILES,
    glowStrength: FLOOD_LAMP_GLOW_STRENGTH,
    colour: 'sodium',
    flicker: 'steady',
  },
  crawler: {
    reachTiles: CRAWLER_LIGHT_REACH_TILES,
    glowRadiusTiles: NO_GLOW,
    glowStrength: FULL,
    colour: 'cool_warm',
    flicker: 'steady',
  },
  companion: {
    reachTiles: COMPANION_REACH_TILES,
    glowRadiusTiles: NO_GLOW,
    glowStrength: FULL,
    colour: 'cool_warm',
    flicker: 'steady',
  },
  magic_missile: {
    reachTiles: MISSILE_REACH_TILES,
    glowRadiusTiles: MISSILE_GLOW_RADIUS_TILES,
    glowStrength: FULL,
    colour: 'arcane',
    flicker: 'steady',
  },
  fireball: {
    reachTiles: FIREBALL_REACH_TILES,
    glowRadiusTiles: FIREBALL_GLOW_RADIUS_TILES,
    glowStrength: FULL,
    colour: 'fire',
    flicker: 'brazier',
  },
  lava_bolt: {
    reachTiles: FIREBALL_REACH_TILES,
    glowRadiusTiles: FIREBALL_GLOW_RADIUS_TILES,
    glowStrength: FULL,
    colour: 'fire',
    flicker: 'brazier',
  },
  explosion: {
    reachTiles: EXPLOSION_REACH_TILES,
    glowRadiusTiles: EXPLOSION_GLOW_RADIUS_TILES,
    glowStrength: FULL,
    colour: 'fire',
    flicker: 'steady',
  },
  coals: {
    reachTiles: COALS_REACH_TILES,
    glowRadiusTiles: COALS_GLOW_RADIUS_TILES,
    glowStrength: FULL,
    colour: 'fire',
    flicker: 'brazier',
  },
  bolt: {
    reachTiles: BOLT_REACH_TILES,
    glowRadiusTiles: BOLT_GLOW_RADIUS_TILES,
    glowStrength: FULL,
    colour: 'cold',
    flicker: 'steady',
  },
  acid_spit: {
    reachTiles: BOLT_REACH_TILES,
    glowRadiusTiles: BOLT_GLOW_RADIUS_TILES,
    glowStrength: FULL,
    colour: 'acid',
    flicker: 'steady',
  },
  lightning: {
    reachTiles: LIGHTNING_REACH_TILES,
    glowRadiusTiles: LIGHTNING_GLOW_RADIUS_TILES,
    glowStrength: FULL,
    colour: 'cool_white',
    flicker: 'steady',
  },
} as const satisfies Record<LightKind, LightKindSpec>;

export interface GlowColourSpec {
  /** The additive glow's colour stops at strength 1. */
  readonly stops: ReadonlyArray<GlowStop>;
  /**
   * The colour the region's darkness is filled with, as `r,g,b`. Dark is
   * never neutral black: a warm cellar sinks into brown, a sodium hall into
   * rust, so at the performance preset, which draws no glows, the shadows
   * alone still say which kind of light lives here.
   */
  readonly shadowRgb: string;
}

/** The nursery's warm sconce pool, the tune every warm light is held to. */
const WARM_GLOW_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: 'rgba(255,170,80,0.42)' },
  { offset: 0.35, color: 'rgba(255,140,60,0.2)' },
  { offset: 1, color: 'rgba(255,120,40,0)' },
];

export const GLOW_COLOURS = {
  warm: { stops: WARM_GLOW_STOPS, shadowRgb: '14,8,4' },
  tallow: {
    stops: [
      { offset: 0, color: 'rgba(255,200,120,0.4)' },
      { offset: 0.35, color: 'rgba(240,170,90,0.18)' },
      { offset: 1, color: 'rgba(220,150,70,0)' },
    ],
    shadowRgb: '12,8,5',
  },
  cool_warm: {
    stops: [
      { offset: 0, color: 'rgba(240,220,190,0.3)' },
      { offset: 0.4, color: 'rgba(220,200,180,0.12)' },
      { offset: 1, color: 'rgba(200,190,180,0)' },
    ],
    shadowRgb: '9,8,9',
  },
  cool_white: {
    stops: [
      { offset: 0, color: 'rgba(200,225,255,0.3)' },
      { offset: 0.45, color: 'rgba(180,210,240,0.12)' },
      { offset: 1, color: 'rgba(170,200,230,0)' },
    ],
    shadowRgb: '6,8,12',
  },
  sodium: {
    stops: [
      { offset: 0, color: 'rgba(255,150,40,0.4)' },
      { offset: 0.4, color: 'rgba(240,120,30,0.18)' },
      { offset: 1, color: 'rgba(220,100,20,0)' },
    ],
    shadowRgb: '14,7,2',
  },
  cold: {
    stops: [
      { offset: 0, color: 'rgba(120,220,200,0.3)' },
      { offset: 0.4, color: 'rgba(90,190,190,0.12)' },
      { offset: 1, color: 'rgba(70,170,180,0)' },
    ],
    shadowRgb: '4,8,13',
  },
  monitor: {
    stops: [
      { offset: 0, color: 'rgba(140,230,255,0.32)' },
      { offset: 0.4, color: 'rgba(110,200,240,0.12)' },
      { offset: 1, color: 'rgba(90,180,230,0)' },
    ],
    shadowRgb: '4,9,12',
  },
  emergency_red: {
    stops: [
      { offset: 0, color: 'rgba(255,60,50,0.42)' },
      { offset: 0.4, color: 'rgba(220,40,30,0.18)' },
      { offset: 1, color: 'rgba(200,30,20,0)' },
    ],
    shadowRgb: '12,4,4',
  },
  arcane: {
    stops: [
      { offset: 0, color: 'rgba(190,140,255,0.5)' },
      { offset: 0.4, color: 'rgba(150,110,255,0.2)' },
      { offset: 1, color: 'rgba(120,90,255,0)' },
    ],
    shadowRgb: '8,5,14',
  },
  fire: {
    stops: [
      { offset: 0, color: 'rgba(255,190,90,0.55)' },
      { offset: 0.35, color: 'rgba(255,130,40,0.25)' },
      { offset: 1, color: 'rgba(255,90,20,0)' },
    ],
    shadowRgb: '14,6,2',
  },
  acid: {
    stops: [
      { offset: 0, color: 'rgba(170,240,90,0.45)' },
      { offset: 0.4, color: 'rgba(130,210,60,0.18)' },
      { offset: 1, color: 'rgba(110,190,40,0)' },
    ],
    shadowRgb: '6,10,3',
  },
  specimen: {
    stops: [
      { offset: 0, color: 'rgba(255,110,190,0.36)' },
      { offset: 0.4, color: 'rgba(230,80,170,0.14)' },
      { offset: 1, color: 'rgba(200,60,150,0)' },
    ],
    shadowRgb: '12,4,9',
  },
} as const satisfies Record<GlowColour, GlowColourSpec>;

/** The spec of a light kind. */
export function lightKindSpec(kind: LightKind): LightKindSpec {
  return LIGHT_KINDS[kind];
}

/** Whether a kind's light comes from a flame, which a torch prop can stand in for. */
export function isFlameKind(kind: LightKind): boolean {
  const { flicker } = LIGHT_KINDS[kind];
  return flicker === 'flame' || flicker === 'brazier' || flicker === 'candle';
}
