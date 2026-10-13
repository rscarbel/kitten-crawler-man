/**
 * Colours and type for the Wheel of Fortune's screens: the two danger
 * warnings, the wheel screen around the wheel, the outcome reveals and the
 * Nothing. The wheel itself is painted from `wheelPalette`, shared with the
 * upright prop on the club floor, so the wheel the player walks past and the
 * wheel they bet on are visibly the same object.
 */

import {
  WHEEL_BULB,
  WHEEL_GOLD,
  WHEEL_POINTER,
  WHEEL_TAPE,
  WHEEL_TONE_INK,
} from '../../sprites/art/wheelPalette';
import type { TypeStyle } from './tokens';

export const wheelInk = {
  tone: WHEEL_TONE_INK,
  gold: WHEEL_GOLD,
  pointer: WHEEL_POINTER,
  bulb: WHEEL_BULB,
  tape: WHEEL_TAPE,
  peg: { head: '#fbf3df', shade: '#8f7a52' },
  hub: { cap: '#2a1a08', star: '#f6d77a' },
  /**
   * The flag flown over a wedge too narrow to letter: crimson against the
   * gold rim, so the jackpot sliver is the one thing on the wheel that shouts.
   */
  flag: { fill: '#8a0c16', edge: WHEEL_GOLD.light, text: '#ffe08a' },
  /** The dark wedge left behind while a wedge turns over during a bet change. */
  flipBacking: '#120a04',

  /** The room behind the wheel: a dark velvet curtain under one warm spotlight. */
  stage: {
    top: '#1c0a12',
    bottom: '#060307',
    spot: 'rgba(255, 214, 140, 0.16)',
    spotEdge: 'rgba(255, 214, 140, 0)',
    plate: 'rgba(8, 4, 8, 0.72)',
    plateEdge: 'rgba(246, 215, 122, 0.35)',
    speech: 'rgba(255, 248, 232, 0.96)',
    speechText: '#2a1a10',
    speechName: '#8a2a1a',
    purse: '#f6d77a',
    purseDrained: '#ff6a5a',
  },

  /** The blaring warning and the "are you sure" prompt. */
  warning: {
    field: '#6a0409',
    fieldDeep: '#240003',
    pulse: '#c0101c',
    stripe: '#ffcc1a',
    stripeGap: '#120203',
    headline: '#ffffff',
    headlineHalo: '#ff1f2c',
    body: '#ffe4dc',
    bodyStrong: '#ffffff',
    /** The second prompt's field is darker, so the two never read as the same screen. */
    confirmField: '#3c0206',
    confirmPulse: '#8a0812',
  },

  /** The SPIN control's hold meter. */
  spin: {
    face: '#c4232c',
    faceLit: '#ff4a44',
    faceFree: '#1f9a4c',
    faceFreeLit: '#3fcf72',
    rim: '#f6d77a',
    rimDim: '#5a3c06',
    meter: '#fff4c8',
    meterTrack: 'rgba(0, 0, 0, 0.45)',
    label: '#ffffff',
    disabled: '#5c4a4a',
  },

  /** The banner an outcome lands with. */
  banner: {
    red: '#b0141e',
    redEdge: '#ff6a5a',
    good: '#1f7a3c',
    goodEdge: '#7cf0a0',
    gold: '#a8740a',
    goldEdge: '#ffe08a',
    purple: '#5a2496',
    purpleEdge: '#d2a8ff',
    neutral: '#3a3630',
    neutralEdge: '#f2eee4',
    text: '#ffffff',
    subtext: '#fff1dc',
  },

  /** The stab: a red slash across the screen and a red wash that fades. */
  slash: '#ff1a2a',
  slashCore: '#ffe0e0',
  slashWash: '#b00010',

  coin: { face: '#f5c84c', edge: '#8a5a0a', shine: '#fff6d0' },
  cowMoo: '#fff6ea',

  /** The Nothing: a black that swallows the screen and two lines of grey text. */
  void: '#000000',
  voidText: '#e6e0d6',
  voidMuted: '#6e685e',
} as const;

/** The warning's headline at its largest; it steps down until the screen fits it. */
export const WHEEL_HEADLINE_TYPE: TypeStyle = { size: 56, weight: 900, lineHeight: 60 };
/** The smallest the headline may become before the body scrolls instead. */
export const WHEEL_HEADLINE_MIN_SIZE = 22;
/** The landing banner's prize name. */
export const WHEEL_BANNER_TYPE: TypeStyle = { size: 34, weight: 900, lineHeight: 38 };
/**
 * The flag's lettering at its smallest, the floor that keeps it readable on a
 * phone; a bigger wheel scales it up.
 */
export const WHEEL_FLAG_TYPE: TypeStyle = { size: 13, weight: 900, lineHeight: 16 };
/** The SPIN label and the big bet readout. */
export const WHEEL_SPIN_TYPE: TypeStyle = { size: 22, weight: 900, lineHeight: 26 };
/** The Nothing's two lines. */
export const WHEEL_VOID_TYPE: TypeStyle = { size: 30, weight: 300, lineHeight: 38 };
