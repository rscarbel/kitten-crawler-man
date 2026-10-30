/**
 * The Goblin High Security Prison's authored floor plans.
 *
 * Three hand-laid layouts, one picked per world by `pickPrisonLayout`. Each is
 * four sections walked in order, each a different stealth problem:
 *
 * 1. **Intake** — the entrance, the exit and a row of holding cells with flimsy
 *    doors. No light reaches it, so breaking out of a cell is never a catch.
 * 2. **Yard** — open ground with tall cover. Tower spotlights sweep over the
 *    cover; the perimeter guards' flashlights are stopped by it.
 * 3. **Cell block** — corridors lined with occupied cells, side alcoves to duck
 *    into, flashlight patrols that sweep at the ends, and one junction two
 *    patrols cross.
 * 4. **Vault** — a rotating spotlight over the approach, a guard who turns on a
 *    timer, and the key on its pedestal.
 *
 * Patrols and spotlight tracks are loops with known periods, all dividing the
 * layout's `cycleFrames`, so `npm run verify:prison-stealth` can search every
 * position at every moment of the cycle and prove a route exists that no light
 * ever touches — and that walking straight in does not.
 */

/**
 * The glyphs a layout's rows are written in.
 *
 * ```
 *  #  wall                         .  floor
 *  %  tall cover (crates, a hut, a wagon): stops a flashlight, not a spotlight
 *  =  iron bars                    ~  an occupied prisoner cell's floor
 *  ,  holding-cell floor           +  a holding cell's flimsy door
 *  $  the key's pedestal (the key is lifted from the floor tile south of it)
 *  @  the entry tile               &  an exit tile
 *  1–9  a spotlight tower's anchor, set in a wall
 *  a–z, A–Z  a named floor point the patrol scripts and spotlight tracks use
 * ```
 */
export const PRISON_CHAR = {
  wall: '#',
  floor: '.',
  cover: '%',
  bars: '=',
  prisonerFloor: '~',
  holdingFloor: ',',
  holdingDoor: '+',
  pedestal: '$',
  entry: '@',
  exit: '&',
} as const;

export const PRISON_ANCHOR_CHARS = '123456789';
export const PRISON_WAYPOINT_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export type PrisonSectionId = 'intake' | 'yard' | 'cellBlock' | 'vault';

/** Walking order: a route from the entry to the key passes through each in turn. */
export const PRISON_SECTION_ORDER: ReadonlyArray<PrisonSectionId> = [
  'intake',
  'yard',
  'cellBlock',
  'vault',
];

/** An inclusive tile rectangle. */
export interface PrisonRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface PrisonSection {
  readonly id: PrisonSectionId;
  readonly rect: PrisonRect;
}

/**
 * Which difficulties a guard or spotlight stands at: tier 0 at every
 * difficulty, 1 from normal up, 2 on hard only (`PRISON_TUNING[*].guardTier`).
 */
export type PrisonTier = 0 | 1 | 2;

/**
 * A patrol guard.
 *
 * `script` is a loop of space-separated commands; its first token is the
 * named point the guard starts on, and the loop must walk back to it:
 *
 * ```
 *  >b       walk straight to point b (turning to face along the walk first)
 *  p40      pause 40 frames
 *  s60/120  sweep the light 60° either side of its facing, over 120 frames
 *  l30      look back: turn about, hold 30 frames, turn back
 *  fN fE fS fW  turn to face north, east, south or west
 * ```
 */
export interface StealthGuardDef {
  readonly id: string;
  readonly tier: PrisonTier;
  readonly script: string;
}

/** A prison patrol guard: a {@link StealthGuardDef} that keeps to one section. */
export interface PrisonGuardDef extends StealthGuardDef {
  readonly section: PrisonSectionId;
}

/**
 * Where a spotlight's floor disc travels.
 *
 * `path` runs along named points and back (or round, when `loop`); `pivot`
 * swings around a named point at a fixed radius between two bearings
 * (degrees, 0 = east, 90 = south) and back.
 */
export type PrisonSpotlightTrack =
  | { readonly kind: 'path'; readonly points: string; readonly loop: boolean }
  | {
      readonly kind: 'pivot';
      readonly pivot: string;
      readonly radiusTiles: number;
      readonly fromDeg: number;
      readonly toDeg: number;
    };

export interface StealthSpotlightDef {
  readonly id: string;
  /** The tower anchor glyph (1–9) the beam is drawn from. */
  readonly anchor: string;
  readonly tier: PrisonTier;
  readonly track: PrisonSpotlightTrack;
}

/** A prison spotlight: a {@link StealthSpotlightDef} that shines on one section. */
export interface PrisonSpotlightDef extends StealthSpotlightDef {
  readonly section: PrisonSectionId;
}

/**
 * The patrols and lights of any floor crossed by stealth, as the patrol
 * compiler and the headless solver read them: the prison's layouts, and any
 * other floor that reuses its guards.
 */
export interface StealthLayout {
  readonly id: string;
  /** Every patrol and track period divides this, so the whole floor repeats on it. */
  readonly cycleFrames: number;
  readonly guards: ReadonlyArray<StealthGuardDef>;
  readonly spotlights: ReadonlyArray<StealthSpotlightDef>;
}

export interface PrisonLayout extends StealthLayout {
  readonly name: string;
  readonly rows: ReadonlyArray<string>;
  readonly sections: ReadonlyArray<PrisonSection>;
  readonly guards: ReadonlyArray<PrisonGuardDef>;
  readonly spotlights: ReadonlyArray<PrisonSpotlightDef>;
}

// ── Authored layouts ──────────────────────────────────────────────────────────

/**
 * The Stockade: a U through the prison.
 *
 * The intake opens east into a walled yard ringed by a slow perimeter patrol while
 * two beams sweep its width; pockets in the lee of the crate stacks are the only
 * places to stop. The far corner leads up into a cell block of three corridors
 * joined by a central shaft, where the shaft's patrol crosses the middle
 * corridor's, and recesses in the cell walls let a guard walk past. The vault at
 * the end of the top corridor keeps its edges dark and its middle swept: the key
 * is a dash timed against the turning guard and the swinging beam.
 */
const STOCKADE_LAYOUT: PrisonLayout = {
  id: 'stockade',
  name: 'The Stockade',
  cycleFrames: 2880,
  rows: [
    '############################################################',
    '############################################################',
    '##.........%%...############################################',
    '##.$.......%%...######~~~~~~~~~~~~~~~~~~#~~~~~~~~~~~~~~~~###',
    '##..............######==================#================###',
    '##....................u................v.................###',
    '##.......x......##########.#####.#######q###################',
    '##..............##########.#####.#######.###################',
    '##.w..%%...%%...########################...#################',
    '##....%%...%%...########################.###################',
    '##..............########################.###################',
    '#########4##############~~~~~~~~~~~~~~~=.=~~~~~~~~~~~~~~~###',
    '########################================.================###',
    '#######################.s...............................t###',
    '#######################.#####.#####.####.######.############',
    '#######################.=====.=====.====.======.=========###',
    '#######################.=~~~~#~~~~~#~~~=.=#~~~~#~~~~~~~~~###',
    '#######################.################...#################',
    '#######################.################.###################',
    '#######################.#~~~#~~~#~~~#~~=.=~~#~~~#~~~#~~~#~##',
    '#######################.#~~~#~~~#~~~#~~=.=~~#~~~#~~~#~~~#~##',
    '#######################.================r=================##',
    '#######################..................o...............p##',
    '###########################.#####.###########.#####.####.###',
    '###########################.#####.###########.#####.####.###',
    '########################################################.###',
    '##################################1#####################.###',
    '##########################................................##',
    '##########################.....................m..........##',
    '##########################..a..........................b..##',
    '##########################.....%%....e.......f..%%........##',
    '##########################.i...%%.%%%...........%%......j.##',
    '##,,#,,#,,#,,#,,##########.............%%%%%..............##',
    '##,,#,,#,,#,,#,,##########.............%%%%%.........%%...##',
    '###+##+##+##+##+##########...%%........%%%%%.........%%...3#',
    '##....................####...%%........%%%%%..............##',
    '##....................####.............%%%%%..............##',
    '##.@..###############.####.l............................k.##',
    '##.&&.###############.####........%%.h.......g.....%%.....##',
    '#####################.####........%%...............%%.....##',
    '#####################.....................................##',
    '##########################..d..........................c..##',
    '##########################....%%.............%%n..........##',
    '##########################....%%.............%%...........##',
    '################################################2###########',
    '############################################################',
  ],
  sections: [
    { id: 'intake', rect: { x0: 1, y0: 31, x1: 18, y1: 44 } },
    { id: 'yard', rect: { x0: 26, y0: 27, x1: 57, y1: 43 } },
    { id: 'cellBlock', rect: { x0: 21, y0: 2, x1: 58, y1: 24 } },
    { id: 'vault', rect: { x0: 1, y0: 1, x1: 16, y1: 11 } },
  ],
  guards: [
    { id: 'yard-perimeter', section: 'yard', tier: 0, script: 'a >b >c >d >a' },
    { id: 'yard-hut', section: 'yard', tier: 1, script: 'e >f >g >h >e' },
    { id: 'c1-east', section: 'cellBlock', tier: 1, script: 'o >p s50/90 >o s50/90' },
    { id: 'v-mid', section: 'cellBlock', tier: 0, script: 'q s45/80 >r s45/80 >q' },
    { id: 'c2', section: 'cellBlock', tier: 0, script: 's >t s45/80 >s s45/80' },
    { id: 'c3', section: 'cellBlock', tier: 2, script: 'u >v l40 >u l40' },
    { id: 'vault-turner', section: 'vault', tier: 0, script: 'w fN p160 fE p160' },
  ],
  spotlights: [
    {
      id: 'yard-north',
      section: 'yard',
      anchor: '1',
      tier: 0,
      track: { kind: 'path', points: 'i j', loop: false },
    },
    {
      id: 'yard-south',
      section: 'yard',
      anchor: '2',
      tier: 0,
      track: { kind: 'path', points: 'k l', loop: false },
    },
    {
      id: 'yard-cross',
      section: 'yard',
      anchor: '3',
      tier: 2,
      track: { kind: 'path', points: 'm n', loop: false },
    },
    {
      id: 'vault-pivot',
      section: 'vault',
      anchor: '4',
      tier: 0,
      track: { kind: 'pivot', pivot: 'x', radiusTiles: 3, fromDeg: 180, toDeg: 360 },
    },
  ],
};

/**
 * The Pit: the yard first, then a climb through stacked cells.
 *
 * The intake opens onto the yard's dark west end. A beam circles the guard hut,
 * another runs the east wall, and patrols walk the north and south walls, so the
 * way to the far corner is a hop through the gap between the hut and the east
 * beam. The cell block is three shafts of cells joined top and middle; the
 * first shaft is the short way up and its guard walks all of it, so the party
 * either times the side recesses or goes round through the crossing. The vault
 * is a long gallery: dark at the door end, watched at the key.
 */
const PIT_LAYOUT: PrisonLayout = {
  id: 'pit',
  name: 'The Pit',
  cycleFrames: 2880,
  rows: [
    '##################################################################',
    '##################################################################',
    '#######################.....................######################',
    '#######################..$...%%.....%%.........................###',
    '#######################.....................###m=======q======s###',
    '#######################..........v..........###.=~~~~~=.=~~~#=.###',
    '#######################.....................###.=~~~~#=.=~~#...###',
    '#######################...u..%%.....%%......###.=~~~#...=~~~#=.###',
    '#######################.....................#...=#####=.=####=.###',
    '#################################4#############.=~~~~~=.=~~~~=.###',
    '###############################################.=~~~~~=.=~~~~=.###',
    '###############################################.=======.======.###',
    '###############################################.o............p.###',
    '###############################################.=======.======.###',
    '###############################################.=~~~~~=.=~~~~=.###',
    '###############################################.=~~~~#=.=~~~~=.###',
    '###############################################.=~~~#...=~~~~=.###',
    '#############################################...=#####=.=####=.###',
    '###############################################.=~~~~~=.=~~#...###',
    '###############################################.=~~~~~=.=~~~#=.###',
    '###############################################.=~~~~~=r=~~~~=t###',
    '###############################################n=~~~~~=.=~~~~=.###',
    '###############################################.##################',
    '###############################################.##################',
    '###############################################.##################',
    '##################################1############.##################',
    '#####################............................#################',
    '#####################.a.......................b..#################',
    '#####################........................i...#################',
    '#####################...%%%%..e.......f..%%......#################',
    '####################3....................%%......#################',
    '#####################...........%%%%%............#################',
    '#####################..k........%%%%%..l.........#################',
    '###,,##,,##,,##,,##.............%%%%%............#################',
    '###,,##,,##,,##,,##.#...%%......%%%%%...%%.......2################',
    '####+###+###+###+##.#...%%......%%%%%............#################',
    '##..................#............................#################',
    '##................###......%%.h.......g....%%....#################',
    '##.@.#######+###+####......%%.......%%.....%%....#################',
    '##...######,,##,,####........................j...#################',
    '##&&.######,,##,,####.c.......................d..#################',
    '#####################............................#################',
    '##################################################################',
    '##################################################################',
  ],
  sections: [
    { id: 'intake', rect: { x0: 1, y0: 31, x1: 17, y1: 42 } },
    { id: 'yard', rect: { x0: 21, y0: 26, x1: 48, y1: 41 } },
    { id: 'cellBlock', rect: { x0: 44, y0: 2, x1: 64, y1: 24 } },
    { id: 'vault', rect: { x0: 22, y0: 1, x1: 43, y1: 9 } },
  ],
  guards: [
    { id: 'yard-north', section: 'yard', tier: 0, script: 'a >b s50/90 >a s50/90' },
    { id: 'yard-south', section: 'yard', tier: 1, script: 'd >c s50/90 >d s50/90' },
    { id: 'v1', section: 'cellBlock', tier: 0, script: 'm s45/80 >n l40 >m' },
    { id: 'h-mid', section: 'cellBlock', tier: 0, script: 'o >p s45/80 >o s45/80' },
    { id: 'v2', section: 'cellBlock', tier: 0, script: 'q >r s45/80 >q s45/80' },
    { id: 'v3', section: 'cellBlock', tier: 2, script: 's >t l40 >s l40' },
    { id: 'vault-turner', section: 'vault', tier: 0, script: 'u fE p180 fN p90 fE p180 fS p90' },
  ],
  spotlights: [
    {
      id: 'yard-ring',
      section: 'yard',
      anchor: '1',
      tier: 0,
      track: { kind: 'path', points: 'e f g h', loop: true },
    },
    {
      id: 'yard-east',
      section: 'yard',
      anchor: '2',
      tier: 0,
      track: { kind: 'path', points: 'i j', loop: false },
    },
    {
      id: 'yard-mid',
      section: 'yard',
      anchor: '3',
      tier: 2,
      track: { kind: 'path', points: 'k l', loop: false },
    },
    {
      id: 'vault-pivot',
      section: 'vault',
      anchor: '4',
      tier: 0,
      track: { kind: 'pivot', pivot: 'v', radiusTiles: 2, fromDeg: 90, toDeg: 270 },
    },
  ],
};

/**
 * The Keep: straight down through the prison.
 *
 * The intake runs along the top. The yard below it is a field of crates two
 * beams sweep across, inside a ring patrol that has to be slipped twice, in at
 * the north-east and out at the south-west. The cell block is a cross of
 * corridors: the west arm's patrol ends where the north-south shaft's patrol
 * crosses it, with recesses on both to wait in. The vault below is a round
 * chamber whose beam swings over the key while a guard beside it turns.
 */
const KEEP_LAYOUT: PrisonLayout = {
  id: 'keep',
  name: 'The Keep',
  cycleFrames: 2880,
  rows: [
    '##########################################################',
    '##########################################################',
    '##&&######################################################',
    '##.@#,,,##,,,##,,,##,,,##,,,##,,,#########################',
    '##..#,,,##,,,##,,,##,,,##,,,##,,,#########################',
    '##..##+####+####+####+####+####+##########################',
    '##.......................................#################',
    '##.......................................#################',
    '########################################.#################',
    '########################################.#################',
    '########################################.....#############',
    '######################1#####################.#############',
    '##############..................................##########',
    '##############..a.....e.............h........b..##########',
    '##############............%%....................##########',
    '##############.....%%.....%%............%%......##########',
    '##############.....%%............%%%....%%......##########',
    '##############.....%%...........................##########',
    '##############.i..............................j.3#########',
    '##############..........%%%%%...................##########',
    '##############..........%%%%%.........%%........##########',
    '##############...%%...................%%........##########',
    '##############...%%............%%..........%%...##########',
    '##############........%%.......%%..........%%...##########',
    '##############........%%.......%%...............##########',
    '##############..d.....f.............g........c..##########',
    '##############..................................##########',
    '###############.####################2#####################',
    '#########.......##########################################',
    '#########.################################################',
    '#########.#################~=.=~##########################',
    '#########.#################~=o=###########################',
    '#########.#################~=...##########################',
    '########=.#~~~~#~~~~#~~~~#~~=.=#~~~#~~~~#~~~~#~~~~########',
    '########=.===================.=====================#######',
    '#########.k..................l...m...............n.#######',
    '########====.=======.===.====.=======.======.======#######',
    '########~~##.#~#~~~#.#~#.#~~=.=~~~~##.#~#~~#.#~~~~########',
    '###########################~=.=###########################',
    '###########################~=...##########################',
    '###########################~=p=###########################',
    '#############################.############################',
    '#############################.############################',
    '##################.......................#################',
    '##################....%%...........%%....#################',
    '##################....%%.....r.....%%....4################',
    '##################...........$...q.......#################',
    '##################......%%.......%%......#################',
    '##################.......................#################',
    '##########################################################',
  ],
  sections: [
    { id: 'intake', rect: { x0: 1, y0: 1, x1: 39, y1: 9 } },
    { id: 'yard', rect: { x0: 14, y0: 12, x1: 47, y1: 26 } },
    { id: 'cellBlock', rect: { x0: 7, y0: 28, x1: 51, y1: 41 } },
    { id: 'vault', rect: { x0: 17, y0: 42, x1: 41, y1: 48 } },
  ],
  guards: [
    { id: 'yard-ring', section: 'yard', tier: 0, script: 'a >b >c >d >a' },
    { id: 'yard-gate', section: 'yard', tier: 2, script: 'd >a s40/90 >d s40/90' },
    { id: 'west-arm', section: 'cellBlock', tier: 0, script: 'k s45/80 >l s45/80 >k' },
    { id: 'east-arm', section: 'cellBlock', tier: 1, script: 'm >n s45/80 >m s45/80' },
    { id: 'ns-arm', section: 'cellBlock', tier: 0, script: 'o >p l40 >o l40' },
    { id: 'vault-turner', section: 'vault', tier: 0, script: 'q fW p160 fN p100 fE p160 fN p100' },
  ],
  spotlights: [
    {
      id: 'yard-west',
      section: 'yard',
      anchor: '1',
      tier: 0,
      track: { kind: 'path', points: 'e f', loop: false },
    },
    {
      id: 'yard-east',
      section: 'yard',
      anchor: '2',
      tier: 0,
      track: { kind: 'path', points: 'g h', loop: false },
    },
    {
      id: 'yard-cross',
      section: 'yard',
      anchor: '3',
      tier: 1,
      track: { kind: 'path', points: 'i j', loop: false },
    },
    {
      id: 'vault-pivot',
      section: 'vault',
      anchor: '4',
      tier: 0,
      track: { kind: 'pivot', pivot: 'r', radiusTiles: 2.5, fromDeg: 180, toDeg: 360 },
    },
  ],
};

export const PRISON_LAYOUTS: ReadonlyArray<PrisonLayout> = [
  STOCKADE_LAYOUT,
  PIT_LAYOUT,
  KEEP_LAYOUT,
];
