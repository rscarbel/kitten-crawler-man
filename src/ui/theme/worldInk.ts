/**
 * Colours and named styles for text, bars and plates painted into the game
 * world: nameplates, floating combat text, structure captions, build and
 * health bars over a creature. They sit on top of busy art rather than on a
 * glass panel, so they carry their own outline and are tuned for contrast
 * against floors, not for the UI's dark-glass look.
 *
 * World painters in `src/ui/world/` read these; a new world look is a new
 * entry here, never an inline colour at the call site.
 */

import { WORLD_FONT_STACK } from './fonts';

export const worldPalette = {
  ink: {
    primary: '#e2e8f0',
    bright: '#f1f5f9',
    secondary: '#cbd5e1',
    hint: '#94a3b8',
    muted: '#64748b',
    gold: '#facc15',
    success: '#4ade80',
    danger: '#ef4444',
    dangerSoft: '#fca5a5',
    ability: '#c084fc',
    human: '#93c5fd',
    cat: '#fb923c',
  },
  /** The dark edge every world label is stroked with so it reads on any tile. */
  outline: 'rgba(0,0,0,0.9)',
  shadow: 'rgba(0,0,0,0.75)',
  /** The colour a fade to or from darkness washes the scene in. */
  shade: '#000000',
  /** The frames and arrows that mark where a quest wants the party to go. */
  objective: {
    /** An objective the party can act on now. */
    ready: '#facc15',
    /** Orange rather than gold, so an objective still short of materials never reads as ready. */
    pending: '#fb923c',
  },
  /** Floating combat text, one colour per kind of hit. */
  combat: {
    miss: '#cbd5e1',
    buff: '#22d3ee',
    trigger: '#f97316',
    block: '#60a5fa',
    exposed: '#facc15',
    immune: '#bfe3ff',
    /** A soft leaf green, apart from the XP and success greens, so a heal never reads as a reward. */
    heal: '#7ae08a',
    /** The immune shield icon's dark rim and pale centre spine. */
    shieldRim: 'rgba(8, 18, 38, 0.95)',
    shieldSpine: 'rgba(255, 255, 255, 0.85)',
  },
  /** A pile on the floor: whose it is, in its glow and caption edge, and the caption itself. */
  loot: {
    bossGlow: '#ffd700',
    ownGlow: '#fbbf24',
    partnerGlow: '#60a5fa',
    bossLabel: '#fff8dc',
    ownLabel: '#fde68a',
    partnerLabel: '#93c5fd',
    plateFill: 'rgba(15,23,42,0.85)',
  },
  /** Countdowns hanging over a cast spell, and the barrier taking shape. */
  spell: {
    shellTimerFull: '#fbbf24',
    shellTimer: '#93c5fd',
    fogTimer: '#d0d0e0',
    barrierPlacing: '#60a5fa',
    barrierTrack: '#4b5563',
  },
  /** The spider lab's alarm, the scientist's line and the terminal's boot text. */
  spiderLab: {
    alarm: '#fbbf24',
    alarmOutline: 'rgba(0,0,0,0.8)',
    bubbleInk: '#1e293b',
    /** The console cyan the intrusion HUD is drawn in, so the boot line matches it. */
    console: '#4fc3f7',
  },
  /** Pulsing markers that say "the way on is here": stairwells, stairs, doors, a wreck to mend. */
  waymark: {
    stairwellEdge: '#a855f7',
    stairwellArrow: '#e9d5ff',
    /** Pale violet dust drawn toward a stairwell, echoing its glow. */
    stairwellDraft: '#d8c8eb',
    stairHint: '#ffdc50',
    doorArrow: '#fadc50',
    doorName: '#ffffdc',
    mendable: '#fbbf24',
    /** The `!reveal` cheat's arrow toward the spider lab. */
    cheatReveal: '#a855f7',
  },
  /** A crawler down and bleeding out, and the bar that brings them back. */
  knockout: {
    countdown: '#fbbf24',
    countdownCritical: '#ef4444',
    reviveEdge: '#ffffff',
    reviveInk: '#ffffff',
  },
  /** The destination named over a crawler channelling a recall, in the recall bar's sky blue. */
  recallInk: '#e0f2fe',
  safeRoom: {
    /** Warm parchment, the safe rooms' own signage. */
    ink: '#f0e4c8',
    /** The warm pool a standing lantern throws, at its centre and at its rim. */
    lanternPool: 'rgba(255,204,128,0.16)',
    lanternPoolRim: 'rgba(255,204,128,0)',
  },
  /** What the player typed into chat, floating over the active crawler: a pale lilac card. */
  chatBubble: {
    fill: 'rgba(245,243,255,0.9)',
    edge: 'rgba(100,80,180,0.45)',
    ink: '#18162a',
  },
  /** The club's dance floor washes, cycled tile by tile. */
  danceFloorLights: ['#ff2d78', '#2d9bff', '#a94dff', '#4dffb0', '#ffd23d'],
  /**
   * A krasue clue's glow and the arrow toward it. Witch-green rather than the
   * festival yellow every other marker in town uses: a clue is a krasue's
   * leavings, and should read as the same sickly light the creature trails.
   */
  clue: {
    glow: '#84ce5c',
    arrow: '#9ade63',
    arrowOutline: '#16300c',
  },
  /** The thin ring over a resource node being worked, showing how much it has left. */
  gatherArc: {
    track: 'rgba(0,0,0,0.45)',
    fill: '#facc15',
  },
  /** The marked-area outline: its drop shadow, the glint lapping it, and the corner brackets' shadow. */
  areaHighlight: {
    outlineShadow: 'rgba(0, 0, 0, 0.35)',
    spark: '#fffbe6',
    bracketShadow: 'rgba(0, 0, 0, 0.5)',
  },
  /** Midge's caption over her head on the escort. */
  escortCaption: '#fde68a',
  /** The nursery's wood pile caption, in the amber of the boards it hands out. */
  woodPileLabel: '#fbbf24',
  /** The "press any key to begin" line under a floor's intro card. */
  introPrompt: '#ffffff',
  /** The soul crystal's lilac, for the line urging the party to contain it. */
  soulCrystalInk: '#e9d5ff',
  /** The dark wipe that drains off a control still waiting out its cooldown. */
  cooldownWash: 'rgba(0,0,0,0.75)',
  /** The boss-battle title card: a gold marquee, then the party and the boss squared up. */
  bossIntro: {
    marquee: '#fbbf24',
    marqueeFlash: '#ffc800',
    marqueeLetter: '#f1f5f9',
    marqueeLetterFlash: '#ffffff',
    marqueeDash: '#94a3b8',
    partyPanelFill: 'rgba(10,20,40,0.9)',
    partyPanelEdge: '#60a5fa',
    /** A near-black maroon most bosses read against. */
    bossPanelFill: 'rgba(30,10,10,0.9)',
    /** For a near-black boss, who would vanish into the maroon. */
    bossPanelFillLight: 'rgba(96,74,66,0.95)',
    /** The Grotesque Spider's card, in the lab's toxic green. */
    spiderAccent: '#22c55e',
  },
  /** The Big Top: the hint over a stuck crawler, and the white-out of a failed act. */
  bigTop: {
    hint: '#ffe9a8',
    hintOutline: 'rgba(0,0,0,0.85)',
    burnoutFlash: '#ffe8c0',
  },
  /** Minimap marks beyond the shared dots in `MINIMAP_MARKER_COLORS`. */
  minimap: {
    unexplored: '#111111',
    spriteBuilding: '#3a3028',
    /** A tree burnt to charcoal, so a stand the player torched stays findable. */
    charredTree: '#2a221e',
    stairwell: '#ffffff',
    escape: '#4ade80',
    corpse: '#000000',
    hostile: '#ef4444',
    mordecai: '#ffffff',
    questOffer: '#fbbf24',
    questTurnIn: '#4ade80',
    questTarget: '#ef4444',
    eliteDisc: '#ffffff',
    eliteCross: '#000000',
    stationBacking: 'rgba(20, 16, 12, 0.85)',
    vendor: '#4ade80',
    vendorOutline: '#0a2010',
    districtLabel: '#e8d9a0',
  },
  bar: {
    track: 'rgba(0,0,0,0.5)',
    trackDeep: 'rgba(0,0,0,0.65)',
    hp: '#ef4444',
    mana: '#3b82f6',
    xp: '#facc15',
    stamina: '#4ade80',
    recall: '#38bdf8',
    recallTrack: 'rgba(0,0,0,0.6)',
    recallEdge: '#0ea5e9',
    boss: '#a855f7',
    bossEdge: '#7c3aed',
    hack: '#4fc3f7',
    hackTrack: 'rgba(2,10,18,0.85)',
    hackEdge: '#1e6f96',
    build: '#fbbf24',
    buildEdge: '#78350f',
    structureHp: '#65a30d',
    structureTrack: 'rgba(0,0,0,0.55)',
  },
  /** The tutorial's pointing arrows, hint box and the barriers that hold a crawler in place. */
  guide: {
    accent: '#f59e0b',
    accentEdge: '#78350f',
    plateFill: '#0d1117',
    ink: '#fde68a',
    /** A passing aside rather than the step's instruction: cool, so it reads as a different voice. */
    noticeEdge: '#38bdf8',
    noticeInk: '#e0f2fe',
    labelInk: '#ffffff',
    barrierFill: 'rgba(220, 60, 30, 0.42)',
    barrierEdge: 'rgba(255, 140, 80, 0.85)',
    barrierGlow: 'rgba(255, 100, 40, 0.25)',
  },
  plate: {
    readyFill: 'rgba(12,10,4,0.78)',
    readyEdge: '#facc15',
    pendingFill: 'rgba(8,10,16,0.72)',
    pendingEdge: 'rgba(251,146,60,0.7)',
    panelFill: 'rgba(8,15,30,0.88)',
    panelEdge: '#334155',
    dangerFill: 'rgba(127,29,29,0.9)',
    dangerEdge: '#ef4444',
    safeFill: 'rgba(20,83,45,0.9)',
    safeEdge: '#4ade80',
  },
  /** Briar Hollow's building ghosts, build zones, reach glows and engine pills. */
  village: {
    ghostValidFill: 'rgba(74,222,128,0.28)',
    ghostValidEdge: 'rgba(74,222,128,0.9)',
    ghostInvalidFill: 'rgba(248,113,113,0.28)',
    ghostInvalidEdge: 'rgba(248,113,113,0.9)',
    segmentHighlight: 'rgba(253,230,138,0.95)',
    noRoomTint: '#ef4444',
    buildZone: '#4ade80',
    /** Matches the sawmill's reach glow. */
    reachGlow: '#f0c85a',
    /** The pale disc a trebuchet pill's icon sits on, so grey stone and a white spanner both read. */
    pillIconDisc: 'rgba(226,232,240,0.9)',
    /** The necromancer's lantern soul-blue, for his boss intro. */
    necromancerIntro: '#7dd3fc',
  },
  /** The stand-in dungeon the UI gallery lays its screens over: a dark fade, faint tile lines and one torch's warm pool. */
  galleryBackdrop: {
    top: '#1d2433',
    bottom: '#07090e',
    tileLine: 'rgba(255, 255, 255, 0.035)',
    torch: 'rgba(255, 170, 70, 0.22)',
    torchFade: 'rgba(255, 170, 70, 0)',
  },
} as const;

/** How a piece of world text is set. Every field is optional on a call; a style fills the gaps. */
export interface WorldTextStyle {
  readonly size: number;
  readonly bold: boolean;
  readonly color: string;
  /** Stroke the glyphs with the world outline, or with this colour. */
  readonly outline: boolean | string;
  /** The CSS font-family stack. */
  readonly family: string;
  readonly lineHeight?: number;
}

const BASE_TEXT: WorldTextStyle = {
  size: 12,
  bold: false,
  color: worldPalette.ink.primary,
  outline: false,
  family: WORLD_FONT_STACK,
};

/** Builds a style from the base, so each entry below names only what sets it apart. */
function style(overrides: Partial<WorldTextStyle>): WorldTextStyle {
  return { ...BASE_TEXT, ...overrides };
}

const TOOLTIP_LINE_HEIGHT = 14;

/** Named looks for world text. Spread one into `worldText` options, or pass its name as `style`. */
export const WORLD_TEXT = {
  plain: BASE_TEXT,
  /** A small label outlined to read on any tile. */
  label: style({ size: 11, outline: true }),
  hint: style({ size: 10, color: worldPalette.ink.hint }),
  heading: style({ size: 13, bold: true }),
  /** XP, coins, a count the eye should catch. */
  value: style({ bold: true, color: worldPalette.ink.gold }),
  success: style({ color: worldPalette.ink.success }),
  danger: style({ bold: true, color: worldPalette.ink.danger }),
  title: style({ size: 20, bold: true, color: worldPalette.ink.bright, outline: true }),
  tooltip: style({
    size: 10,
    color: worldPalette.ink.secondary,
    lineHeight: TOOLTIP_LINE_HEIGHT,
  }),
  controls: style({ size: 9, color: worldPalette.ink.muted }),
  muted: style({ size: 10, color: worldPalette.ink.muted }),
  human: style({ color: worldPalette.ink.human }),
  cat: style({ color: worldPalette.ink.cat }),
  ability: style({ size: 11, color: worldPalette.ink.ability }),
  /** A requirement the party already meets: "Rope 15/15". */
  requirementMet: style({ size: 10, bold: true, color: worldPalette.ink.success, outline: true }),
  /** A requirement the party is still short of: "Boards 12/30". */
  requirementShort: style({
    size: 10,
    bold: true,
    color: worldPalette.ink.dangerSoft,
    outline: true,
  }),
  /** A job the party can do right now: "Ready to upgrade". */
  ready: style({ size: 11, bold: true, color: worldPalette.ink.gold, outline: true }),
  /** A tiny rank mark beside a health bar. */
  tacticsMark: style({ size: 7, bold: true, color: worldPalette.ink.gold, outline: true }),
} as const satisfies Record<string, WorldTextStyle>;

export type WorldTextStyleId = keyof typeof WORLD_TEXT;

/** A bar drawn over the world: a track, a fill clipped to the track's shape, an optional edge. */
export interface WorldBarStyle {
  readonly fill: string;
  readonly track: string;
  readonly border?: string;
  readonly borderWidth?: number;
  readonly radius: number;
}

const SMALL_BAR_RADIUS = 2;
const HACK_BAR_RADIUS = 1;

export const WORLD_BAR = {
  hp: { fill: worldPalette.bar.hp, track: worldPalette.bar.track, radius: SMALL_BAR_RADIUS },
  mana: { fill: worldPalette.bar.mana, track: worldPalette.bar.track, radius: SMALL_BAR_RADIUS },
  xp: { fill: worldPalette.bar.xp, track: worldPalette.bar.track, radius: SMALL_BAR_RADIUS },
  stamina: {
    fill: worldPalette.bar.stamina,
    track: worldPalette.bar.track,
    radius: SMALL_BAR_RADIUS,
  },
  /** A channelled fast travel: sky blue, so it reads as neither health nor threat. */
  recall: {
    fill: worldPalette.bar.recall,
    track: worldPalette.bar.recallTrack,
    border: worldPalette.bar.recallEdge,
    borderWidth: 1,
    radius: SMALL_BAR_RADIUS,
  },
  boss: {
    fill: worldPalette.bar.boss,
    track: worldPalette.bar.trackDeep,
    border: worldPalette.bar.bossEdge,
    borderWidth: 1,
    radius: 0,
  },
  /** An intrusion's progress through a system: console cyan on a near-black bus. */
  hack: {
    fill: worldPalette.bar.hack,
    track: worldPalette.bar.hackTrack,
    border: worldPalette.bar.hackEdge,
    borderWidth: 1,
    radius: HACK_BAR_RADIUS,
  },
  /** A build or repair in progress over its structure: fresh-planed timber on a dark edge. */
  build: {
    fill: worldPalette.bar.build,
    track: worldPalette.bar.trackDeep,
    border: worldPalette.bar.buildEdge,
    borderWidth: 1,
    radius: SMALL_BAR_RADIUS,
  },
  structureHp: {
    fill: worldPalette.bar.structureHp,
    track: worldPalette.bar.structureTrack,
    radius: SMALL_BAR_RADIUS,
  },
} as const satisfies Record<string, WorldBarStyle>;

export type WorldBarStyleId = keyof typeof WORLD_BAR;

/** A backing plate behind world text: a caption box, a speech bubble, an ammo pill. */
export interface WorldPlateStyle {
  readonly fill?: string;
  readonly border?: string;
  readonly borderWidth?: number;
  readonly radius?: number;
}

const CAPTION_RADIUS = 5;
const PLATE_BORDER_WIDTH = 1.5;

export const WORLD_PLATE = {
  /** Over a job the party can do right now: gold, so "ready" reads from across the screen. */
  captionReady: {
    fill: worldPalette.plate.readyFill,
    border: worldPalette.plate.readyEdge,
    borderWidth: PLATE_BORDER_WIDTH,
    radius: CAPTION_RADIUS,
  },
  /** Over a job still waiting on materials: a quieter edge, so the ready one stands out beside it. */
  captionPending: {
    fill: worldPalette.plate.pendingFill,
    border: worldPalette.plate.pendingEdge,
    borderWidth: 1,
    radius: CAPTION_RADIUS,
  },
  panel: {
    fill: worldPalette.plate.panelFill,
    border: worldPalette.plate.panelEdge,
    borderWidth: PLATE_BORDER_WIDTH,
  },
  danger: {
    fill: worldPalette.plate.dangerFill,
    border: worldPalette.plate.dangerEdge,
    borderWidth: PLATE_BORDER_WIDTH,
  },
  safe: {
    fill: worldPalette.plate.safeFill,
    border: worldPalette.plate.safeEdge,
    borderWidth: PLATE_BORDER_WIDTH,
  },
} as const satisfies Record<string, WorldPlateStyle>;

export type WorldPlateStyleId = keyof typeof WORLD_PLATE;
