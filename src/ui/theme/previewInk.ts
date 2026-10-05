/**
 * Colours for the review scenes (`?goblin`, `?fairy`, `?tiles`, …): the
 * backdrops creatures are judged against, and the captions, frame counters
 * and cell frames of the review grids. These are dev scenes, not game UI;
 * the floor tones mirror the in-game floors so a figure is judged on what it
 * will really stand on.
 */

/** Floor mids the game's creatures stand on, from `src/map/tilegen/palette.ts`. */
const floor = {
  cellarStone: '#8c8170',
  dressedStone: '#b09668',
  pouredConcrete: '#888e96',
  /** Floor 2's concrete with the lights off: the dungeon tone the party mostly sees. */
  unlitConcrete: '#191720',
  grass: '#637032',
  road: '#6b5c46',
  /** The paler circus-grounds road the clowns walk. */
  circusRoad: '#8a7c60',
  dirtRoad: '#7a6244',
  dirtTrack: '#6b5638',
  rubble: '#6f6a5e',
  unlitCave: '#2a2f2b',
  /** The Krakaren's lair floor. */
  wetStone: '#3c4644',
  /** The Juicer's gym. */
  gymMat: '#3a3f46',
} as const;

/** The review grid every creature scene lays its animation rows out in. */
const grid = {
  /** Column and row headings, and captions under a demo. */
  caption: '#f4efe4',
  /** The frame number under a row heading. */
  frameCounter: '#cfd8c4',
  /** The frame and game-frame timing under a row heading, for timeline-driven rows. */
  timingReadout: '#e8dcd4',
  /** The attack name inside an attack cell. */
  moveName: '#e8dfc8',
  cellBorder: 'rgba(255,255,255,0.14)',
  /** The outline marking the frame a hit lands on. */
  impactFrame: '#ff8a5c',
  impactLabel: '#ffd9c0',
  /** The warning that a sprite manifest lacks a state the scene asks for. */
  missingState: '#ff9a76',
} as const;

export const previewInk = {
  floor,
  grid,
  bugaboo: { frameCounter: '#d8d2c4' },
  mantid: { frameCounter: '#e4e8d4' },
  rockGolem: {
    backdrops: ['#2b2b30', '#4a4034', '#6f7a5c', '#8d8477'],
    caption: '#f0e9da',
    cellBorder: 'rgba(255,255,255,0.1)',
  },
  cow: {
    /** The heart a cow shows when it is fed. */
    heart: '#ff5c7a',
  },
  status: {
    dungeonStone: '#3a3630',
    darkCorridor: '#191b21',
    grass: '#3f5b32',
    sand: '#b7a173',
    snow: '#d9e2ea',
    lavaRock: '#5c2317',
    panel: '#14161c',
    label: '#d6dde8',
  },
  bopca: {
    backdrop: '#1b2436',
    panel: '#232f47',
    sublabel: '#93a2c0',
    dishVessel: '#e8e0cc',
    dishContent: '#b4762e',
    dishGarnish: '#6f9f4a',
  },
  fairy: { backdrop: '#2a2f3d' },
  casino: {
    backdrop: '#151d18',
    panel: '#1e2a22',
    sublabel: '#93a2c0',
    pass: '#6ee87a',
    fail: '#e87a7a',
  },
  keyboardHero: {
    backdrop: '#0b0f14',
    panel: '#05070a',
    label: '#e8eef6',
    sublabel: '#8fa3bd',
    warning: '#f0b34a',
  },
  person: {
    backdrop: '#1b2436',
    ground: '#26324a',
    readout: '#a7f3d0',
  },
  human: {
    backdrop: '#12111a',
    sublabel: '#93a2c0',
  },
  necromancer: {
    backdrop: '#262b22',
    ground: '#3f4d31',
    label: '#c9d2e0',
  },
  /** Shared by the rat-kin and Shady scenes, which stand their figures on the same slate. */
  slate: {
    backdrop: '#20242e',
    ground: '#2c3342',
    label: '#c9d2e0',
  },
  /** The tile and paint benches. */
  bench: { backdrop: '#12161f' },
} as const;
