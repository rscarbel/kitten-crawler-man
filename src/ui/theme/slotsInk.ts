/**
 * Colours for the Cloak & Dagger's slot machine: the lacquered cabinet and its
 * chrome, the marquee and its bulbs, the progressive meter's LED digits, the
 * reels behind glass, the lit SPIN button and lever, every win tier's banner,
 * the paylines and the symbols painted on the reel strips.
 *
 * A slot machine is the one loud thing in the casino, so these are saturated
 * and warm on purpose; the controls still take their shape from the shared
 * button skins and only borrow these colours.
 */

import { darken, lighten, withAlpha } from './color';
import type { ButtonSkin } from './skins';
import type { Theme } from './tokens';

const backdrop = {
  /** The velvet wall behind the cabinet. */
  top: '#2a0a16',
  bottom: '#07030a',
  /** The spotlight pooled behind the cabinet. */
  spot: 'rgba(255, 196, 110, 0.16)',
  spotFade: 'rgba(255, 196, 110, 0)',
} as const;

const cabinet = {
  /** The cabinet's red lacquer body. */
  body: '#7a0f1c',
  bodyLight: '#b8202f',
  bodyDark: '#2a0409',
  /** The chrome frame round the body and the glass. */
  chromeLight: '#ffffff',
  chrome: '#c3cbd6',
  chromeMid: '#7d8796',
  chromeDark: '#2c323d',
  /** Gold pin-striping along the body's edges. */
  trim: '#f5c84c',
  trimDark: '#8a6414',
  shadow: 'rgba(0, 0, 0, 0.6)',
  /** The deck the buttons sit on. */
  deck: '#1b0a10',
  deckEdge: '#3d1520',
} as const;

const marquee = {
  face: '#2b0b44',
  faceLight: '#5a1d86',
  title: '#ffe27a',
  titleGlow: '#ff9f1c',
  titleOutline: '#3a0d02',
  subtitle: '#ffd7f2',
  bulbOn: '#fff4b8',
  bulbGlow: 'rgba(255, 210, 90, 0.85)',
  bulbOff: '#5c4a26',
  bulbRim: '#21180c',
} as const;

const meter = {
  face: '#140306',
  frame: '#3b0b10',
  label: '#ffd25a',
  digits: '#ff3b2f',
  digitsGlow: 'rgba(255, 59, 47, 0.8)',
  /** The unlit segments behind the digits. */
  ghost: 'rgba(255, 59, 47, 0.13)',
  /** The meter in the jackpot's own colours while it is being won. */
  hot: '#ffe27a',
} as const;

const reel = {
  face: '#fbf6ea',
  faceShade: '#d7ccb5',
  divider: '#6f6555',
  /** The curve of the drum, darkening towards the top and bottom of the window. */
  curve: 'rgba(0, 0, 0, 0.42)',
  curveFade: 'rgba(0, 0, 0, 0)',
  /** The free-spin feature's dark purple backing. */
  freeFace: '#2c1048',
  freeFaceShade: '#12061f',
  freeDivider: '#5d2d8a',
  glassSheen: 'rgba(255, 255, 255, 0.2)',
  glassSheenFade: 'rgba(255, 255, 255, 0)',
  /** Dims the glass round a winning line so the line reads. */
  dim: 'rgba(8, 4, 10, 0.5)',
} as const;

const frame = {
  anticipation: '#ffd54a',
  anticipationGlow: 'rgba(255, 213, 74, 0.9)',
  /** The "so close" shimmer over a reel that missed. */
  shimmer: '#e9f6ff',
  shimmerFade: 'rgba(233, 246, 255, 0)',
  winCell: '#fff4b8',
  winCellGlow: 'rgba(255, 236, 150, 0.9)',
} as const;

const readout = {
  face: '#0c0306',
  border: '#4a1820',
  label: '#f5c84c',
  value: '#ffe9a8',
  win: '#7dff9a',
  winGlow: 'rgba(125, 255, 154, 0.75)',
  free: '#d9b8ff',
} as const;

const spin = {
  face: '#e01e2e',
  lit: '#ff6a55',
  dark: '#6e0911',
  rim: '#f5c84c',
  text: '#ffffff',
  glow: 'rgba(255, 70, 60, 0.85)',
  idle: '#7a2830',
  /** The button while autospin or free spins drive the machine. */
  auto: '#1f8a45',
  autoLit: '#5cf08c',
  autoGlow: 'rgba(92, 240, 140, 0.7)',
} as const;

const lever = {
  rod: '#d7dde6',
  rodDark: '#5e6878',
  ball: '#e01e2e',
  ballLight: '#ff9a8c',
  ballDark: '#5a070e',
  socket: '#262b33',
  socketLight: '#5a6270',
} as const;

/** Twenty line colours, cycled in payline order so neighbouring lines differ. */
const paylines = [
  '#ff3b3b',
  '#3bd2ff',
  '#7dff6a',
  '#ffcf3b',
  '#ff5ad1',
  '#a77bff',
  '#ff8a2a',
  '#2affc6',
  '#ffffff',
  '#ff6f91',
  '#6ab8ff',
  '#d4ff3b',
  '#ffa6f0',
  '#3bffe9',
  '#ffb36a',
  '#b0ff9e',
  '#ff4d6d',
  '#8ae6ff',
  '#ffe066',
  '#c79bff',
] as const;

const tier = {
  big: '#ffd54a',
  mega: '#ff4fd8',
  epic: '#59e1ff',
  jackpot: '#ff3b2f',
  freeSpins: '#c08cff',
  text: '#ffffff',
  outline: '#1a0614',
  /** The banner plate behind the words. */
  plate: 'rgba(20, 4, 24, 0.82)',
  rays: 'rgba(255, 236, 160, 0.12)',
  raysFade: 'rgba(255, 236, 160, 0)',
} as const;

const coin = {
  face: '#f5c84c',
  light: '#fff2b0',
  dark: '#9a6a12',
  spark: '#fffbe6',
} as const;

/** The jackpot's full-screen flash: a warm white, never a hard strobe. */
const flash = '#fff6dc';

const symbols = {
  outline: '#1c0f14',
  shine: 'rgba(255, 255, 255, 0.7)',
  shadow: 'rgba(0, 0, 0, 0.28)',
  cherry: '#d7263d',
  cherryLight: '#ff7a7a',
  cherryDark: '#6e0b1a',
  stem: '#3f7d2a',
  leaf: '#56b03a',
  leafDark: '#24561a',
  lemon: '#f9d423',
  lemonLight: '#fff59d',
  lemonDark: '#b98a00',
  bell: '#f5b83d',
  bellLight: '#ffe7a0',
  bellDark: '#8d5a0b',
  clapper: '#5a3a08',
  barPlate: '#16161b',
  barRim: '#d4dbe5',
  barText: '#ffffff',
  barStripe: '#e01e2e',
  /** The disc Deinonychus is framed on. */
  deinonychusDisc: '#f0d28a',
  deinonychusDiscLight: '#fff4d8',
  deinonychusDiscDark: '#a47a2c',
  /** His orange neck hackle, the same feathers as on his forearms and tail. */
  deinonychusHackle: '#ee7a22',
  deinonychusEye: '#fff8e8',
  deinonychusTooth: '#ffffff',
  tiaraMetal: '#eef2f8',
  tiaraMetalDark: '#8592a8',
  tiaraGem: '#ff4fa3',
  tiaraGemLight: '#ffc1e0',
  tiaraSide: '#5ac8ff',
  boot: '#7a4a26',
  bootLight: '#b07a46',
  bootDark: '#3a2212',
  bootSole: '#211a14',
  bootLace: '#ecdcb4',
  bootToe: '#9aa3ae',
  seven: '#e01e2e',
  sevenLight: '#ff8a7a',
  sevenDark: '#5c0610',
  sevenRim: '#f5c84c',
  sevenRimDark: '#7d5510',
  seal: '#f5c84c',
  sealLight: '#fff2b0',
  sealDark: '#8a5c0c',
  sealText: '#5a0e14',
  /** The hooded figure stamped into the wild's seal. */
  hood: '#2a1838',
  hoodLight: '#5a3a72',
  daggerBlade: '#dfe6ee',
  daggerBladeDark: '#7d8a9a',
  daggerGrip: '#5a2a16',
  box: '#7c4bc9',
  boxLight: '#c5a0ff',
  boxDark: '#32166a',
  boxBand: '#f5c84c',
  boxGlow: 'rgba(197, 160, 255, 0.95)',
  boxText: '#fff2b0',
} as const;

export const slotsInk = {
  backdrop,
  cabinet,
  marquee,
  meter,
  reel,
  frame,
  readout,
  spin,
  lever,
  paylines,
  tier,
  coin,
  flash,
  symbols,
} as const;

/** The machine's own control looks: the dark deck keys, the lit SPIN and an armed toggle. */
export interface SlotsSkins {
  readonly deck: ButtonSkin;
  readonly spin: ButtonSkin;
  readonly spinAuto: ButtonSkin;
  readonly maxBet: ButtonSkin;
  readonly toggleOn: ButtonSkin;
  readonly leave: ButtonSkin;
}

const HOVER_LIGHTEN = 0.1;
const PRESS_DARKEN = 0.2;
const GLOW_ALPHA = 0.55;
const DISABLED_DARKEN = 0.55;
const DISABLED_TEXT_ALPHA = 0.45;
const DECK_BORDER_WIDTH = 1.5;
const SPIN_BORDER_WIDTH = 3;

function litButton(fill: string, border: string, text: string, borderWidth: number): ButtonSkin {
  return {
    rest: { fill, border, text },
    hover: { fill: lighten(fill, HOVER_LIGHTEN), border: lighten(border, HOVER_LIGHTEN), text },
    press: { fill: darken(fill, PRESS_DARKEN), border, text },
    disabled: {
      fill: darken(fill, DISABLED_DARKEN),
      border: darken(border, DISABLED_DARKEN),
      text: withAlpha(text, DISABLED_TEXT_ALPHA),
    },
    borderWidth,
    glow: withAlpha(fill, GLOW_ALPHA),
  };
}

const skinCache = new WeakMap<Theme, SlotsSkins>();

export function slotsSkins(theme: Theme): SlotsSkins {
  const cached = skinCache.get(theme);
  if (cached !== undefined) return cached;
  const deck = litButton(cabinet.body, cabinet.trim, readout.value, DECK_BORDER_WIDTH);
  const skins: SlotsSkins = {
    deck: { ...deck, glow: null },
    spin: { ...litButton(spin.face, spin.rim, spin.text, SPIN_BORDER_WIDTH), glow: null },
    spinAuto: { ...litButton(spin.auto, spin.rim, spin.text, SPIN_BORDER_WIDTH), glow: null },
    maxBet: {
      ...litButton(tier.big, cabinet.trimDark, tier.outline, DECK_BORDER_WIDTH),
      glow: null,
    },
    toggleOn: { ...litButton(spin.auto, spin.autoLit, spin.text, DECK_BORDER_WIDTH), glow: null },
    leave: {
      ...litButton(cabinet.deck, cabinet.chromeMid, theme.palette.text.primary, 1),
      glow: null,
    },
  };
  skinCache.set(theme, skins);
  return skins;
}
