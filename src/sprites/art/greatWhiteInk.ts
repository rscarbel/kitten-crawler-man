/**
 * The pump room's great white, one palette for every way it is seen: the fin
 * cutting the flood, the head breaching under a crawler, and the carcass the
 * drain leaves on the floor. Sharing it keeps the three the same fish.
 *
 * A great white's back is a slate grey with a brown cast, not a blue one, and
 * the line where it meets the white belly is hard-edged and ragged.
 */
export const GREAT_WHITE_INK = {
  backShade: '#383b3a',
  back: '#5c605e',
  backLight: '#7f8380',
  backRim: '#9ca09b',
  belly: '#eeefeb',
  bellyShade: '#c0c3bd',
  bellyDeep: '#8f938d',
  /** The black tips on the underside of each pectoral fin. */
  finTip: '#1b1d1d',
  outline: '#151817',
  eye: '#050606',
  eyeGlint: '#c9d0d0',
  gill: '#232625',
  mouth: '#2a0b10',
  gum: '#a8485a',
  tooth: '#fbfaf4',
  /** A wet hide's specular: near white, so it reads as water on skin and not as paint. */
  wetSpecular: '#f4f8f6',
} as const;
