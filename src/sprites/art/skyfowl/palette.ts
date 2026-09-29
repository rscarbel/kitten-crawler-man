/**
 * Skyfowl plumage patterns, builds and the shared bare-part colours (beak,
 * cere, legs, talons, eye). One rig paints every skyfowl; a look differs only
 * in which ramp and build it is handed.
 */

import type { Ramp } from './paint';

// ── Plumage patterns ─────────────────────────────────────────────────────────

/**
 * A plumage pattern is two ramps (the body/wing colour and a secondary barring
 * or fleck colour) plus how strongly the secondary reads. The rig lays the
 * secondary down as bars across the wing and chest — never as an outline — so
 * the pattern is legible at 32px without competing with the silhouette ink.
 */
export interface PlumagePattern {
  readonly id: string;
  /** Back, crown, wing top. */
  readonly body: Ramp;
  /** Throat, breast, underwing — always a step lighter than `body`. */
  readonly breast: Ramp;
  /** Barring or speckle laid over the body/wing. */
  readonly marking: Ramp;
  /** 0 = no visible marking, 1 = strongest the rig will paint. */
  readonly markingStrength: number;
  readonly markingStyle: 'barring' | 'speckle';
}

function ramp(dark: string, mid: string, light: string): Ramp {
  return { dark, mid, light };
}

/** The town's most common look today; kept as the baseline so the redraw reads as a continuation. */
export const HAWKBROWN: PlumagePattern = {
  id: 'hawkbrown',
  body: ramp('#3c2c1a', '#6e4e2c', '#95713f'),
  breast: ramp('#6e5636', '#a3855c', '#cbae84'),
  marking: ramp('#241708', '#4a3115', '#6b4a20'),
  markingStrength: 0.7,
  markingStyle: 'barring',
};

/** Calm and understated: clerks, temple staff. */
export const DOVEGREY: PlumagePattern = {
  id: 'dovegrey',
  body: ramp('#3e434c', '#6c7480', '#93a0ac'),
  breast: ramp('#7c828c', '#aab2ba', '#d0d6dc'),
  marking: ramp('#2a2d33', '#484f58', '#666f78'),
  markingStrength: 0.35,
  markingStyle: 'speckle',
};

/** Glossy black with a blue sheen; reads as authoritative at a glance. */
export const CORVIDBLACK: PlumagePattern = {
  id: 'corvidblack',
  body: ramp('#0e1016', '#20242e', '#3a4356'),
  breast: ramp('#262a34', '#3c4250', '#585f70'),
  marking: ramp('#2f4a68', '#4a729c', '#6f9cc6'),
  markingStrength: 0.3,
  markingStyle: 'speckle',
};

/** The least showy pattern; the most numerous in a crowd scene. */
export const SPARROWFLECK: PlumagePattern = {
  id: 'sparrowfleck',
  body: ramp('#4a3a28', '#7c6547', '#a5906e'),
  breast: ramp('#a08e70', '#cdbe9e', '#ece2ca'),
  marking: ramp('#e4d8bc', '#f4ecd8', '#ffffff'),
  markingStrength: 0.55,
  markingStyle: 'speckle',
};

/** The rarest pattern; reserved for status the moment it appears. */
export const GOLDENBARRED: PlumagePattern = {
  id: 'goldenbarred',
  body: ramp('#5e3e12', '#9c6d22', '#c99a3e'),
  breast: ramp('#a67a34', '#d4a955', '#f0cd82'),
  marking: ramp('#7a2c14', '#a8451f', '#c86a38'),
  markingStrength: 0.6,
  markingStyle: 'barring',
};

/**
 * The fightable street tough's colour family. Bruised plum and rust-iron dye
 * over dulled, patchy plumage — no citizen wears this family, so the mob reads
 * as a target before the player is close enough to see the posture.
 */
export const STREETTOUGH_MARKING: Ramp = ramp('#3a0a18', '#7c1032', '#a82442');

export const PLUMAGE_PATTERNS: readonly PlumagePattern[] = [
  HAWKBROWN,
  DOVEGREY,
  CORVIDBLACK,
  SPARROWFLECK,
  GOLDENBARRED,
];

export type PlumageId = (typeof PLUMAGE_PATTERNS)[number]['id'];

export function plumageById(id: PlumageId): PlumagePattern {
  const found = PLUMAGE_PATTERNS.find((pattern) => pattern.id === id);
  if (found === undefined) throw new Error(`no skyfowl plumage pattern "${id}"`);
  return found;
}

// ── Bare parts ───────────────────────────────────────────────────────────────

/** The hooked beak; a warm horn colour shared by every look. */
export const BEAK: Ramp = ramp('#3a2c1c', '#6b5230', '#96774a');
/** The soft cere at the beak's base, a touch more saturated than the beak itself. */
export const CERE = '#c9832e';
/** Scaled digitigrade legs and talons. */
export const LEG_SCALE: Ramp = ramp('#4a3a24', '#7c6440', '#a3895e');
export const TALON = '#241a10';
export const EYE_IRIS = '#e8b830';
export const EYE_PUPIL = '#100c0a';
/** Cool bounce light along the figure's back edge, unifying the parts. */
export const RIM_LIGHT = '#d8e2e6';
export const RIM_ALPHA = 0.18;
export const RIM_WIDTH = 0.015;
export const CONTACT_SHADOW_ALPHA = 0.38;

// ── Builds ───────────────────────────────────────────────────────────────────

export type SkyfowlBuild = 'slight' | 'standard' | 'heavy' | 'fledgling';

/**
 * How a build departs from the standard rig. Every field is a multiplier (or,
 * for angles and crouch, an addition) that is exactly neutral on `standard`.
 */
export interface SkyfowlBuildSpec {
  readonly scale: number;
  readonly bodyWidth: number;
  readonly limbWidth: number;
  /** Head count is how size is read: a fledgling needs *more* head per body. */
  readonly headScale: number;
  /** Extra forward stoop, radians — the elder's hunch. */
  readonly stoop: number;
  readonly crouch: number;
  readonly wingSpan: number;
  /** A light speckle of down over the plumage; only the fledgling sets this. */
  readonly fluffy: boolean;
}

const NEUTRAL_BUILD: SkyfowlBuildSpec = {
  scale: 1,
  bodyWidth: 1,
  limbWidth: 1,
  headScale: 1,
  stoop: 0,
  crouch: 0,
  wingSpan: 1,
  fluffy: false,
};

const DEGREE = Math.PI / 180;

export const SKYFOWL_BUILDS: Readonly<Record<SkyfowlBuild, SkyfowlBuildSpec>> = {
  standard: NEUTRAL_BUILD,
  slight: { ...NEUTRAL_BUILD, bodyWidth: 0.86, limbWidth: 0.85, wingSpan: 0.94 },
  heavy: {
    ...NEUTRAL_BUILD,
    scale: 0.98,
    bodyWidth: 1.26,
    limbWidth: 1.22,
    headScale: 1.05,
    stoop: 9 * DEGREE,
    crouch: 0.06,
    wingSpan: 1.08,
  },
  fledgling: {
    ...NEUTRAL_BUILD,
    scale: 0.66,
    bodyWidth: 0.98,
    limbWidth: 0.92,
    headScale: 1.55,
    wingSpan: 0.8,
    fluffy: true,
  },
};
