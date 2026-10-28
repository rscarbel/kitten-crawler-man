/**
 * Colours the title screen paints into its picture: the void behind the hall,
 * stone, flame, fog, spotlights and the logo. The menu and the sound hint are
 * chrome and take their looks from the shared skins instead.
 *
 * The darkest tone is the panel palette's `surface.sunken`, which the loading
 * screen fills with, so the screen that hands over to the title shows no seam.
 */

import { palette } from './tokens';

const voidInk = {
  /** Behind everything, before any layer paints. */
  clear: palette.surface.sunken,
  /** The far void's vertical falloff, top to floor. */
  top: '#0c0a10',
  bottom: '#020203',
  /** A faint warm bloom where the hall will be lit from, so the dark is never flat. */
  glow: 'rgba(196, 112, 48, 0.16)',
  glowFade: 'rgba(196, 112, 48, 0)',
  /** The vault's ribs overhead, barely caught by the torchlight below. */
  rib: '#3a3026',
} as const;

/** A colour as three 0–255 channels, for art blended or written pixel by pixel. */
export type TitleRgb = readonly [number, number, number];

/**
 * Fixed-point digits for an alpha: `node-canvas` drops an `rgba()` written in
 * the exponent notation a tiny float prints in, so an alpha is never printed raw.
 */
const ALPHA_DIGITS = 3;
const HEX_RADIX = 16;
const HEX_DIGITS_PER_CHANNEL = 2;
const HEX_PREFIX_LENGTH = 1;

/** The channels of a `#rrggbb` colour. */
function rgbOfHex(hex: string): TitleRgb {
  const channel = (index: number) => {
    const start = HEX_PREFIX_LENGTH + index * HEX_DIGITS_PER_CHANNEL;
    return parseInt(hex.slice(start, start + HEX_DIGITS_PER_CHANNEL), HEX_RADIX);
  };
  return [channel(0), channel(1), channel(2)];
}

/** `rgb` at `alpha`, for an ink whose opacity is decided at draw time. */
export function titleRgba(rgb: TitleRgb, alpha: number): string {
  const [red, green, blue] = rgb;
  const safeAlpha = Math.min(1, Math.max(0, alpha));
  return `rgba(${red}, ${green}, ${blue}, ${safeAlpha.toFixed(ALPHA_DIGITS)})`;
}

/** `rgb` as an opaque colour. */
export function titleRgb(rgb: TitleRgb): string {
  const [red, green, blue] = rgb.map((channel) => Math.round(channel));
  return `rgb(${red}, ${green}, ${blue})`;
}

/** The hall's stone, beyond what its masonry and floor art already carry. */
const hallInk = {
  /** Laid over stone with an alpha: distance, and the shadow behind a pilaster. */
  depthShade: '#030204',
  /** The dark line where the floor runs into each wall. */
  junctionShade: 'rgba(4, 3, 2, 0.62)',
  junctionShadeFade: 'rgba(4, 3, 2, 0)',
  /** A pilaster's face catches a little more light than the wall it stands proud of. */
  pilasterLight: '#fff0d6',
  /** The doorway's dressed-stone arch, its dark reveal, and the black beyond the last step. */
  doorFrame: '#6e6150',
  doorReveal: '#1a140f',
  doorVoid: '#000000',
  /** The stone of the stair passage beyond the doorway, before light and depth darken it. */
  passageStone: rgbOfHex('#7c705e'),
  /** The worn arris of the top step, the brightest edge inside the doorway. */
  passageNosing: rgbOfHex('#b8a98e'),
  /** A warm breath rising out of the stairwell, pulling the eye to where the dive goes. */
  doorGlow: 'rgba(214, 96, 36, 0.28)',
  doorGlowFade: 'rgba(214, 96, 36, 0)',
} as const;

/** The wall sconces' ironwork, and the coals in a torch that has not caught. */
const torchInk = {
  iron: '#1b1816',
  ironLight: '#4a423b',
  ember: '#ff5a1c',
  /** Laid over a brand that has not caught, so it reads as cold pitch rather than a burning rag. */
  unlitShade: '#0a0705',
} as const;

/**
 * The light map multiplied over the hall. The darkest ambient is a cool,
 * readable dusk at about half brightness, never black; the lit ambient is
 * warm, and the torch pools add a warm white on top of it.
 */
const lightInk = {
  ambientDarkest: rgbOfHex('#646884'),
  ambientLit: rgbOfHex('#aa988c'),
  pool: rgbOfHex('#ffce96'),
  /** Over a flame the light map is plain white, so multiplying it leaves the flame as painted. */
  flameHotspot: rgbOfHex('#ffffff'),
} as const;

/** Floor fog: a cool grey that the warm light map tints where the torches reach it. */
const fogInk = {
  rgb: rgbOfHex('#9696a4'),
} as const;

/** The edge darkening and film grain over the whole picture. */
const vignetteInk = {
  clear: 'rgba(0, 0, 0, 0)',
  mid: 'rgba(0, 0, 0, 0.28)',
  edge: 'rgba(0, 0, 0, 0.66)',
  grainLight: rgbOfHex('#fff4e2'),
  grainDark: rgbOfHex('#000000'),
  /** What the dive collapses the whole picture to, just before the next scene. */
  blackout: rgbOfHex('#000000'),
} as const;

/** The wordmark's effects; its gold face is the `titleLogo` skin. */
const logoInk = {
  /** The extrusion's step just behind the face, and its farthest step, darkening between. */
  extrusionNear: '#7a4a16',
  extrusionFar: '#140b05',
  /** The thin dark edge that keeps the gold off the stone behind it. */
  outline: '#1c1006',
  /** The halo round the letters, added over the dark. */
  glow: '#ff9a34',
  /** The light band that crosses the gold, brightest along its middle. */
  sheen: 'rgba(255, 248, 226, 0.9)',
  sheenFade: 'rgba(255, 248, 226, 0)',
  /** The thin rim of light along the top edges of the gold. */
  bevel: '#fff3c8',
} as const;

/**
 * The lighting rig: a warm-white key light on the heroes, and the cooler
 * searchlights that sweep the hall between beats. Added over the dark, so each
 * is a colour whose strength is chosen at draw time.
 */
const spotlightInk = {
  beam: rgbOfHex('#fff1d2'),
  pool: rgbOfHex('#ffe6b8'),
  sweep: rgbOfHex('#d8e4ff'),
} as const;

/** Embers, sparks, dust and motes, each a soft dot from its core out to nothing. */
const particleInk = {
  emberCore: '#fff0c4',
  emberBody: 'rgba(255, 150, 52, 0.85)',
  emberFade: 'rgba(255, 84, 20, 0)',
  sparkCore: '#fffbea',
  sparkBody: 'rgba(255, 214, 110, 0.9)',
  sparkFade: 'rgba(255, 170, 60, 0)',
  dustCore: 'rgba(156, 134, 110, 0.5)',
  dustFade: 'rgba(120, 100, 80, 0)',
  moteCore: 'rgba(232, 214, 186, 0.9)',
  moteFade: 'rgba(232, 214, 186, 0)',
} as const;

/** The two crawlers and the things that watch them from the dark. */
const castInk = {
  /** Laid over a figure the light has not reached; the hall's own shadow colour. */
  shadow: '#05040a',
  /** The soft pool of shade a figure stands in, so it sits on the floor. */
  contactShadow: 'rgba(0, 0, 0, 0.55)',
  contactShadowFade: 'rgba(0, 0, 0, 0)',
  /** A goblin's eyes throwing light back out of the black: the dungeon's own eye-shine yellow. */
  eyeShine: 'rgba(236, 226, 96, 1)',
  eyeGlow: 'rgba(214, 222, 92, 0.32)',
  eyeGlowFade: 'rgba(214, 222, 92, 0)',
} as const;

/** The loot box waiting in the shadows, and the glint that gives it away. */
const lootInk = {
  /** Oiled planks, their shaded flank and the seams between them. */
  body: '#5a3416',
  bodyShade: '#2c180a',
  plankSeam: '#1e1007',
  /** The domed lid, and the torchlight caught along its crown. */
  lid: '#6a3e1a',
  lidLight: 'rgba(255, 196, 120, 0.5)',
  lidLightFade: 'rgba(255, 196, 120, 0)',
  /** Gilded bands and rims: face, lit edge, shadowed edge. */
  trim: '#d3a03a',
  trimLight: '#ffe394',
  trimShade: '#6e4a12',
  /** The lock plate and its keyhole. */
  lock: '#efc456',
  keyhole: '#160b04',
  glintCore: 'rgba(255, 252, 232, 1)',
  glintBody: 'rgba(255, 220, 120, 0.75)',
  glintFade: 'rgba(255, 196, 80, 0)',
} as const;

export const TITLE_INK = {
  void: voidInk,
  hall: hallInk,
  torch: torchInk,
  light: lightInk,
  fog: fogInk,
  vignette: vignetteInk,
  spotlight: spotlightInk,
  logo: logoInk,
  particles: particleInk,
  cast: castInk,
  loot: lootInk,
} as const;
