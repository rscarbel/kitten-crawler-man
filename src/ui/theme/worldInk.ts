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

import { UI_FONT_STACK, WORLD_FONT_STACK } from './fonts';

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
    /** The muted brass the casino rules sheets caption their illustrations in. */
    rulesCaption: '#9a8c68',
  },
  /** The dark edge every world label is stroked with so it reads on any tile. */
  outline: 'rgba(0,0,0,0.9)',
  shadow: 'rgba(0,0,0,0.75)',
  /** The colour a fade to or from darkness washes the scene in. */
  shade: '#000000',
  /** The bobbing badge over a Briar Hollow station or a shop, and the glyph frame it shares. */
  glyphBadge: {
    fill: 'rgba(30, 30, 30, 0.78)',
    border: 'rgba(200, 200, 200, 0.55)',
    /** The coin glyph's dark edge, so its emerald face separates from the badge's dark fill. */
    glyphOutline: 'rgba(0, 0, 0, 0.85)',
  },
  /**
   * The coin glyph in the badge over anyone who sells things. Emerald, deeper
   * and bluer than the quest `?`'s light green, so a shop never reads as a turn-in.
   */
  shopSign: {
    coin: '#10b981',
    /** Pale on the emerald face, since a dark mark sinks into the coin at badge size. */
    mark: '#ecfdf5',
  },
  /**
   * The cross glyph in the badge over a healer. Green on white because a red
   * cross on white is the Red Cross emblem, whose use is restricted by the
   * Geneva Conventions and national law; the first-aid green cross is not.
   */
  medicalSign: {
    disc: '#f8fafc',
    cross: '#16a34a',
  },
  /** The frames and arrows that mark where a quest wants the party to go. */
  objective: {
    /** An objective the party can act on now. */
    ready: '#facc15',
    /** Orange rather than gold, so an objective still short of materials never reads as ready. */
    pending: '#fb923c',
    /** The chevrons of the route painted on the ground toward an objective, in the ready gold. */
    trail: '#facc15',
    /** The dark edge round each trail chevron, so it reads on pale paving as well as grass. */
    trailOutline: 'rgba(0,0,0,0.4)',
    /** The soft glow under each trail chevron, so the route reads as light on the ground rather than paint. */
    trailHalo: 'rgba(250,204,21,0.16)',
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
    energyShieldTimerFull: '#fbbf24',
    energyShieldTimer: '#93c5fd',
    fogTimer: '#d0d0e0',
    barrierPlacing: '#60a5fa',
    barrierTrack: '#4b5563',
    /** The pulsing ring round a placed gym barrier, marking where it slows mobs. */
    barrierSlowZone: '#60a5fa',
  },
  /** Dr. Moult's speech bubble and the lab terminal's boot text. */
  spiderLab: {
    bubbleInk: '#1e293b',
    /** The console cyan the intrusion HUD is drawn in, so the boot line matches it. */
    console: '#4fc3f7',
  },
  /**
   * The Grotesque Spider's harmless marks: the pale violet rings of her
   * phase-change roar, kept unlike any attack, and the gold pool round her
   * legs while she is open to punishment.
   */
  grotesqueSpider: {
    roarRing: '#f3e8ff',
    roarRingUnder: '#581c87',
    exposedGlow: '#facc15',
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
  /** The circus high striker's power meter and the verdict called out after a swing. */
  highStriker: {
    /** Below the ring zone: the greasepaint red of the striker's own ticks. */
    meterFill: '#c0392b',
    /** In the ring zone: the bell's brass, lit near white so the moment to strike cannot be missed. */
    meterHotFill: '#ffe680',
    meterHotGlow: '#ffd23f',
    meterTrack: 'rgba(20,12,10,0.85)',
    meterEdge: '#e8dcc0',
    /** A fill drawn over a track already laid: no track of its own. */
    clear: 'rgba(0,0,0,0)',
    /** The ring zone, standing on the track from the ring line to the top at all times. */
    ringZone: 'rgba(245,197,66,0.65)',
    ringZoneEdge: '#f5c542',
    /** The line across the meter where a swing starts ringing the bell. */
    ringLine: '#fff4c2',
    /** The lamp capping the meter: dark brass until the fill is in the ring zone, then lit. */
    capOff: '#5a4a2a',
    capOn: '#fff2a8',
    rating: '#f1e3c4',
    ratingTop: '#ffd54a',
  },
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
  /** The Starlight Tent: the hint over a stuck crawler, the white-out of a failed act and the dust in a lantern's pool. */
  starlightTent: {
    hint: '#ffe9a8',
    hintOutline: 'rgba(0,0,0,0.85)',
    burnoutFlash: '#ffe8c0',
    /** The warm dust turning in a lantern's lit pool. */
    spotlightMote: '#ffb02e',
  },
  /**
   * The Goblin High Security Prison: the glyph over a guard whose suspicion is
   * rising and the one that means it has seen enough, the badge behind both,
   * and the tints a light takes on while it is catching someone.
   */
  prison: {
    suspicion: '#facc15',
    alarm: '#ef4444',
    badge: 'rgba(12,10,8,0.82)',
    badgeEdge: 'rgba(255,240,200,0.35)',
    /** The warm wash inside a flashlight cone or a spotlight disc nobody is caught in, as `r,g,b`. */
    lightWarmRgb: '255,206,132',
    /** The amber the same light turns while its suspicion rises, as `r,g,b`. */
    lightCatchingRgb: '255,150,40',
    /** A spotlight's bright rim, as `r,g,b`. */
    spotRimRgb: '255,246,214',
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
    /** A creature on the map that is not hostile right now: a hireling, a cow, a calm Hawkfolk. */
    friendly: '#ffffff',
    dave: '#ffffff',
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
  /**
   * Worn gear's marks painted with the world painters: the combo pips under a
   * crawler. The rest of gear's world art is painted in `gearFxArt`.
   */
  gear: {
    comboPipLit: '#ffd45a',
    comboPipDim: 'rgba(0,0,0,0.55)',
    comboPipEdge: 'rgba(0,0,0,0.85)',
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
  /**
   * The world re-rendering Dave as he teleports in or out: Caroline's own cyan
   * (`palette.caroline` in `tokens.ts`), so the player reads the light that
   * builds him as the same machine that speaks in her frame.
   */
  daveTeleport: {
    /** The white-hot heart of the scan column and the last flash round his edge. */
    core: '#e8f6fa',
    /** The column's body and the brighter data motes. */
    beam: '#8fe6fa',
    /** The glow round the column, the glitching slices' tint and the dimmer motes. */
    glow: '#5ed3f0',
  },
  /** The tutorial's pointing arrows and hint box. */
  guide: {
    accent: '#f59e0b',
    accentEdge: '#78350f',
    plateFill: '#0d1117',
    ink: '#fde68a',
    /** A passing aside rather than the step's instruction: cool, so it reads as a different voice. */
    noticeEdge: '#38bdf8',
    noticeInk: '#e0f2fe',
    labelInk: '#ffffff',
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
  /**
   * Every ground warning in the game: the marking that says "this floor is
   * about to hurt" or "this floor hurts now". It is always red, for every
   * creature, trap and hazard, so a player who has learned one warning can
   * read them all. A creature's own colour belongs on the attack's effect (its
   * arcs, flames or bile), never on the warning. Drawn through the painters in
   * `src/sprites/dangerTelegraph.ts`, which take no colour.
   */
  groundWarning: {
    fill: '#ff1020',
    stripe: '#ff0000',
    outline: '#ff1020',
    /** The pale core inside a locked outline, so it reads as lit rather than just thicker. */
    lockedCore: '#ffe0d0',
    /** The strike flash: a red wash under a white one, together reading as white-hot red. */
    strikeRed: '#ff3020',
    strikeWhite: '#fff4ee',
    /** A dark under-stroke laid beneath a red line, so the line reads on any floor. */
    deep: '#200000',
  },
  /**
   * The Current Goblin's attack effects: the crackle of the wave his slam sends
   * down the floor and the grenade itself. Electric blue and white; the ground
   * warnings under them are `groundWarning`'s red like everyone else's.
   */
  electricGoblin: {
    waveGlow: 'rgba(56, 189, 248, 0.45)',
    waveCore: '#f0f9ff',
    grenadeBody: '#1e293b',
    grenadeGlow: '#bae6fd',
    shadow: 'rgba(0, 0, 0, 0.35)',
    /** The flash and arcs of a grenade going off where it lands. */
    burstCore: '#ffffff',
    burstGlow: '#7dd3fc',
    burstArc: '#bae6fd',
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

/** The one ink every ground warning is drawn in. See `worldPalette.groundWarning`. */
export const GROUND_WARNING_INK = worldPalette.groundWarning;

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
  /** The caption over a prize the room is built around: "THE KEY". */
  prizeLabel: style({ size: 16, bold: true, color: worldPalette.ink.gold, outline: true }),
  /** The ? and ! over a guard in an explainer's illustration, drawn larger than in play to read at panel scale. */
  suspicionMark: style({
    size: 22,
    bold: true,
    color: worldPalette.prison.suspicion,
    outline: true,
  }),
  /**
   * The line under a casino rules-sheet illustration, blackjack's and poker's
   * alike: muted brass in the panel's own face.
   */
  rulesCaption: style({
    size: 12,
    color: worldPalette.ink.rulesCaption,
    family: UI_FONT_STACK,
  }),
  /** A hand's name beside or under its cards on the poker rules sheet. */
  rulesLabel: style({
    size: 13,
    bold: true,
    color: worldPalette.ink.primary,
    family: UI_FONT_STACK,
  }),
  /** The high striker's verdict on a swing that fell short: "Crawler Fodder". */
  strikerRating: style({
    size: 11,
    bold: true,
    color: worldPalette.highStriker.rating,
    outline: true,
  }),
  /** The verdict on a swing that rang the bell. */
  strikerRatingTop: style({
    size: 14,
    bold: true,
    color: worldPalette.highStriker.ratingTop,
    outline: true,
  }),
  /** A sound written into an explainer's illustration: "THUD". */
  soundWord: style({ size: 12, bold: true, color: worldPalette.ink.secondary, outline: true }),
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
  /** The high striker's power meter: its empty track and edge, laid under the ring zone and the fill. */
  strikerMeterTrack: {
    fill: worldPalette.highStriker.clear,
    track: worldPalette.highStriker.meterTrack,
    border: worldPalette.highStriker.meterEdge,
    borderWidth: 1,
    radius: SMALL_BAR_RADIUS,
  },
  /** The meter's fill below the ring zone. */
  strikerMeterFill: {
    fill: worldPalette.highStriker.meterFill,
    track: worldPalette.highStriker.clear,
    radius: SMALL_BAR_RADIUS,
  },
  /** The meter's fill inside the ring zone: strike now. */
  strikerMeterHot: {
    fill: worldPalette.highStriker.meterHotFill,
    track: worldPalette.highStriker.clear,
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
/** Half the meter lamp's size, so the lamp is round. */
const STRIKER_CAP_RADIUS = 5;

/**
 * The high striker's power meter's measurements, in world pixels: wide enough
 * to read the ring zone at a glance, its lamp a disc a little wider than the
 * bar, and the glow and pulse the fill wears inside the zone.
 */
export const STRIKER_METER_LOOK = {
  widthPx: 10,
  capSizePx: STRIKER_CAP_RADIUS * 2,
  /** The gap between the bar's top and the lamp's foot. */
  capGapPx: 1,
  ringLinePx: 2,
  ringLineOverhangPx: 2,
  hotGlowBlurPx: 14,
  /** The in-zone glow swells and shrinks by this share of itself, this many times a second. */
  hotPulseDepth: 0.45,
  hotPulseHz: 6,
} as const;
const PLATE_BORDER_WIDTH = 1.5;
/** Half a combo pip's size, so the pip is round. */
const COMBO_PIP_RADIUS = 2;

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
  /** The line across the high striker's meter where a swing starts ringing the bell. */
  strikerRingLine: { fill: worldPalette.highStriker.ringLine },
  /** The ring zone on the high striker's meter, from the ring line to the top. */
  strikerRingZone: {
    fill: worldPalette.highStriker.ringZone,
    border: worldPalette.highStriker.ringZoneEdge,
    borderWidth: 1,
  },
  /** The lamp capping the meter, unlit. */
  strikerCapOff: {
    fill: worldPalette.highStriker.capOff,
    border: worldPalette.highStriker.meterEdge,
    borderWidth: 1,
    radius: STRIKER_CAP_RADIUS,
  },
  /** The lamp capping the meter, lit while the fill is in the ring zone. */
  strikerCapOn: {
    fill: worldPalette.highStriker.capOn,
    border: worldPalette.highStriker.ringZoneEdge,
    borderWidth: 1,
    radius: STRIKER_CAP_RADIUS,
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
  /** A landed blow toward a combo, in the row of pips over the crawler. */
  comboPipLit: {
    fill: worldPalette.gear.comboPipLit,
    border: worldPalette.gear.comboPipEdge,
    borderWidth: 1,
    radius: COMBO_PIP_RADIUS,
  },
  /** A blow still to land before the combo goes off. */
  comboPipDim: {
    fill: worldPalette.gear.comboPipDim,
    border: worldPalette.gear.comboPipEdge,
    borderWidth: 1,
    radius: COMBO_PIP_RADIUS,
  },
} as const satisfies Record<string, WorldPlateStyle>;

export type WorldPlateStyleId = keyof typeof WORLD_PLATE;
