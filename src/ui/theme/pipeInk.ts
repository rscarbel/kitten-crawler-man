/**
 * Colours for the clogged bathroom's pipe board: the recessed wall panel,
 * white PVC, the water, brass fittings, leaks and puddles, the toilets and
 * sinks round the edge, the water main and its pressure gauge.
 *
 * Every state the board shows must also read in greyscale, so the pairs that
 * tell states apart differ in lightness as well as hue: a wet bore is bright
 * where a dry one is nearly black, and a full fixture's tick and a dry one's
 * cross differ in shape as well as colour.
 */

const panel = {
  /** The wall the access panel is cut into. */
  wall: '#262d36',
  /** The recess the pipes sit in. */
  recess: '#161b22',
  /** The grout lines between tile sockets. */
  socket: '#1d232b',
  /** The panel's lit top-left rim. */
  rimLight: '#46505d',
  /** The panel's shaded bottom-right rim. */
  rimDark: '#0b0e12',
  /** Screws at the panel's corners. */
  screw: '#59636f',
} as const;

const pvc = {
  body: '#ece8df',
  shade: '#c4bdaf',
  outline: '#5f584d',
  highlight: '#ffffff',
  /** The couplings at each tile edge. */
  collar: '#dcd6c9',
  /** The faint dust a dry pipe wears. */
  dust: '#a8987c',
  /** A dry pipe's empty bore. */
  boreDry: '#27221d',
  boreDryInner: '#3b342c',
  /** The chunky screw cap on a dead end. */
  capBody: '#8e98a3',
  capRidge: '#525b65',
  capHighlight: '#d3dae1',
} as const;

const water = {
  base: '#2e8bff',
  deep: '#1957c4',
  /** The light bands that travel downstream along a wet bore. */
  band: '#c4e6ff',
  /** The surge that runs through a solved board. */
  surge: '#ffffff',
  /** Droplets out of a leaking end. */
  spray: '#8fd0ff',
  puddle: '#2466c2',
  puddleEdge: '#7cc4ff',
} as const;

const brass = {
  light: '#f4d58a',
  base: '#c99a3e',
  dark: '#7a5418',
  bolt: '#5b3e10',
  boltHighlight: '#ffe7a8',
} as const;

const leak = {
  /** The small droplet badge on a leaking tile. */
  badge: '#e5484d',
  badgeEdge: '#ffffff',
} as const;

const fixture = {
  porcelain: '#f4f6f8',
  shade: '#c3cad3',
  outline: '#4d5661',
  /** An empty bowl or basin. */
  bowlEmpty: '#3a4048',
  /** The dull grey a fixture wears while it is out of order. */
  outOfOrderTint: '#6b6f75',
  tap: '#aeb8c2',
  tagPaper: '#f3ead2',
  tagInk: '#2a2622',
  tagString: '#8a8170',
  /** The red ✕ on a dry fixture's tag. */
  broken: '#e5484d',
  /** The green ✓ on a working fixture's tag. */
  working: '#2fbf71',
  markInk: '#ffffff',
} as const;

const main = {
  iron: '#7d8894',
  ironDark: '#434b54',
  ironLight: '#b7c0c9',
  /** The shutoff wheel on the water main: iron, never red, so it cannot be read as a broken tag. */
  valve: '#4a5562',
  valveDark: '#262d35',
} as const;

const gauge = {
  face: '#f2efe6',
  rim: '#5d6670',
  rimDark: '#2f353c',
  redZone: '#e5484d',
  greenZone: '#2fbf71',
  needle: '#1a1a1a',
  tick: '#55504a',
} as const;

const banner = {
  ribbon: '#2fbf71',
  ribbonDark: '#1b7a47',
  ribbonEdge: '#c9f5dc',
} as const;

const explainer = {
  /** The pointer and fingertip that show a turn on the explainer pages. */
  hand: '#ffffff',
  handOutline: '#14171c',
  /** The ring a fingertip tap leaves. */
  ripple: '#ffffff',
  /** The "before" and "after" captions' ink. */
  caption: '#e8edf3',
} as const;

/** The shadow every raised piece casts on the panel. */
const shadow = '#000000';

export const pipeInk = {
  panel,
  pvc,
  water,
  brass,
  leak,
  fixture,
  main,
  gauge,
  banner,
  explainer,
  shadow,
} as const;
