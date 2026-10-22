/**
 * The Trash Gremlin's colours.
 *
 * Its lair is olive linoleum under tan and tin junk, so the hide is a cool,
 * bruised slate-violet: the hue is what separates it from the floor, and the
 * hide sits a step darker than the linoleum so the value does too. The two
 * things that should catch the eye first are warm and bright against all of
 * that — the amber eyes and the glowing throat sac.
 */

/** A form's four tones: lit, base, turning away, and the deepest occlusion. */
export interface Ramp {
  readonly light: string;
  readonly mid: string;
  readonly dark: string;
  readonly deep: string;
}

export const OUTLINE = '#130e19';

export const HIDE: Ramp = {
  light: '#958ba8',
  mid: '#625876',
  dark: '#3f374f',
  deep: '#28222f',
};

/**
 * The legs, a half step under the hide: head-on the long arms hang in front of
 * the legs, and at 32 px only a value step keeps four thin limbs from reading
 * as four legs.
 */
export const HIDE_LEG: Ramp = {
  light: '#857b98',
  mid: '#574e69',
  dark: '#383146',
  deep: '#24202b',
};

/** The far limbs in profile, a step down so the near ones lead. */
export const HIDE_FAR: Ramp = {
  light: '#776e8a',
  mid: '#4f465f',
  dark: '#342d41',
  deep: '#211c28',
};

export const BELLY: Ramp = {
  light: '#cbc1c6',
  mid: '#a59aa6',
  dark: '#7a6e7f',
  deep: '#564c5b',
};
/** The grey bruising mottled over the pale belly. */
export const BELLY_MOTTLE = '#7d7183';
/** Darker bruises on the hide itself. */
export const BRUISE = '#3b3049';

export const EAR_MEMBRANE: Ramp = {
  light: '#c39aaf',
  mid: '#9b7088',
  dark: '#6c4a60',
  deep: '#4a3244',
};
export const EAR_RIB = '#4c3446';

export const CLAW = '#0f0c12';
export const CLAW_GLINT = '#5d566a';

export const EYE_IRIS = '#f4ac1c';
export const EYE_IRIS_DEEP = '#b5650a';
export const EYE_PUPIL = '#170b03';
export const EYE_GLINT = '#fffbe6';
export const EYE_SOCKET = '#1b1222';

export const MOUTH_INSIDE = '#2a0e1c';
export const TOOTH = '#ece3c9';
export const TOOTH_SHADE = '#a69c82';
export const NOSTRIL = '#1d1525';

/** The acid sac: a translucent organ lit from inside, never a skin colour. */
export const SAC_BRIGHT = '#eaf55a';
export const SAC_MID = '#b8d034';
export const SAC_DARK = '#6c8420';
export const SAC_CORE = '#fbffc4';
export const SAC_VEIN = '#5a6a1c';

export const STEEL: Ramp = {
  light: '#dfe6ea',
  mid: '#a3afb7',
  dark: '#66727b',
  deep: '#3d464e',
};
export const RUST = '#8a4b2b';

/**
 * A black plastic bin bag. Black rather than a brown sack: from behind, a pale
 * disc over a brown band is the one shape its back view would share with a
 * clothed figure.
 */
export const BIN_BAG: Ramp = {
  light: '#7c8496',
  mid: '#3c414d',
  dark: '#1d1f25',
  deep: '#111216',
};
export const BIN_BAG_SHEEN = '#a7b0c4';

export const TIN: Ramp = {
  light: '#eef0f1',
  mid: '#b2b8bc',
  dark: '#71787d',
  deep: '#474d52',
};
export const TIN_LABEL = '#a1392c';
export const STRING = '#d9c9a0';

export const BRASS: Ramp = {
  light: '#f5dc86',
  mid: '#c99f3e',
  dark: '#86651f',
  deep: '#553f12',
};

export const STRAP: Ramp = {
  light: '#7a5a3f',
  mid: '#56402d',
  dark: '#3a2a1d',
  deep: '#251a12',
};

export const SPRAY_BRIGHT = '#e3ef58';
export const SPRAY_MID = '#a9c02f';
export const SPRAY_DARK = '#6b7c1e';

export const CONTACT_SHADOW = '#000000';
