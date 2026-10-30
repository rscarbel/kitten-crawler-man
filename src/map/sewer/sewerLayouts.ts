/**
 * The sewer under Taloncrest, as authored floor plans.
 *
 * The sewer is a set of named sections joined by named connections. Each
 * section is one hand-laid layout, built as its own map; a crawler moves
 * between sections the way a tower moves between storeys. A later section is
 * a new layout plus its connections, and nothing else.
 *
 * Its water obeys sluices. A channel stands at one of two levels, set by the
 * valve wheel that works it, and a valve turned stays turned for the rest of
 * the run: the water is put back from that record whenever the section is
 * built, because a map's water is never saved.
 */

import type { MobKind } from '../../levels/mobKinds';

/**
 * The glyphs a section's rows are written in.
 *
 * ```
 *  #  brick wall                .  stone walkway
 *  ~  the main channel, running at full flow: never waded
 *  =  the spillway: a channel its valve can lower to a dry bed
 *  o  the nest basin: a dry sump its valve can flood
 *  n  the rat nest, choking the basin until the basin is flooded
 *  @  the foot of the ladder up to the street grate the party came down
 *  ^  walkway under a street grate, where daylight falls through
 *  C  walkway at the cistern culvert's mouth
 *  A–B  a valve wheel, set in the walkway
 *  r  a rat waiting in the junction     g  a ruins ghoul in the vault hall
 *  1–9  the guide's stops, walked in order
 * ```
 */
export const SEWER_CHAR = {
  wall: '#',
  walkway: '.',
  mainChannel: '~',
  spillway: '=',
  nestBasin: 'o',
  nest: 'n',
  ladder: '@',
  streetGrate: '^',
  culvert: 'C',
} as const;

export const SEWER_VALVE_CHARS = 'AB';
export const SEWER_GUIDE_STOP_CHARS = '123456789';
export const SEWER_FIGHT_CHARS = 'rg';

/** Every section of the sewer. Each is one layout and one map. */
export const SEWER_SECTION_IDS = ['tower_drain'] as const;
export type SewerSectionId = (typeof SEWER_SECTION_IDS)[number];

/** Every valve wheel in the sewer, unique across sections: the run remembers each one turned. */
export const SEWER_VALVE_IDS = ['tower_drain_spillway_valve', 'tower_drain_nest_valve'] as const;
export type SewerValveId = (typeof SEWER_VALVE_IDS)[number];

/** Every fight in the sewer, unique across sections: the run remembers each one won. */
export const SEWER_FIGHT_IDS = ['tower_drain_junction_rats', 'tower_drain_vault_ghouls'] as const;
export type SewerFightId = (typeof SEWER_FIGHT_IDS)[number];

/** What the run remembers of the sewer: a valve turned or a fight won. */
export type SewerWorkId = SewerValveId | SewerFightId;
export const SEWER_WORK_IDS: ReadonlyArray<SewerWorkId> = [...SEWER_VALVE_IDS, ...SEWER_FIGHT_IDS];

/** The guide's stops, named for what it says there. */
export type SewerGuideStopId = 'ladder' | 'spillway' | 'junction' | 'nest' | 'vault' | 'cistern';

/**
 * One of the guide's stops, in walking order. A stop that `holdsUntil` a
 * valve or a fight keeps the guide there until that is done: the way on is
 * shut, or not safe, until then.
 */
export interface SewerGuideStopDef {
  readonly id: SewerGuideStopId;
  readonly holdsUntil: SewerWorkId | null;
}

/** The sewer's channels whose water a valve moves. */
export type SewerChannelId = 'spillway' | 'nest_basin';

/**
 * What turning a valve does to its channel: `lower` runs it down to its dry
 * bed, which can then be walked; `raise` floods it to `depth`, which washes
 * out whatever was blocking it and leaves it to be waded.
 */
export type SewerValveEffect =
  | { readonly kind: 'lower'; readonly channel: SewerChannelId }
  | { readonly kind: 'raise'; readonly channel: SewerChannelId; readonly depth: number };

export interface SewerValveDef {
  readonly id: SewerValveId;
  /** The valve glyph (A–B) in the section's rows. */
  readonly char: string;
  readonly effect: SewerValveEffect;
}

/** One of the section's fights: who waits there, and at what authored level. */
export interface SewerFightDef {
  readonly id: SewerFightId;
  /** The spawn glyph (r, g) marking each body in the rows. */
  readonly char: string;
  readonly kind: Extract<MobKind, 'rat' | 'ruins_ghoul'>;
  readonly level: number;
}

/**
 * How a section joins the rest of the world.
 *
 * - `street_grate`: the ladder up to the grate the party came down, which
 *   leaves through the storm drain's own door on the street.
 * - `culvert`: a pipe big enough to walk, into another section, arriving at
 *   that section's matching culvert.
 * - `tower_cistern`: the culvert into the cistern under Town Center Tower,
 *   which hands the party into the tower at its cistern storey.
 */
export type SewerConnection =
  | { readonly kind: 'street_grate'; readonly char: typeof SEWER_CHAR.ladder }
  | {
      readonly kind: 'culvert';
      readonly char: string;
      readonly to: SewerSectionId;
      readonly arrivalChar: string;
    }
  | { readonly kind: 'tower_cistern'; readonly char: typeof SEWER_CHAR.culvert };

export interface SewerSectionLayout {
  readonly id: SewerSectionId;
  readonly name: string;
  readonly rows: ReadonlyArray<string>;
  readonly connections: ReadonlyArray<SewerConnection>;
  readonly valves: ReadonlyArray<SewerValveDef>;
  readonly fights: ReadonlyArray<SewerFightDef>;
  /** The guide's stops, one per stop glyph 1–9 in the rows, in order. */
  readonly guideStops: ReadonlyArray<SewerGuideStopDef>;
}

/** How deep the main channel and an open spillway run: as deep as water goes. */
export const SEWER_FULL_FLOW_DEPTH = 3;
/** The nest basin flooded by its valve: deep enough to carry the nest off, shallow enough to wade. */
const NEST_BASIN_FLOOD_DEPTH = 2;
/** The rats are the sewer's own vermin, fat on what comes down from the street. */
const JUNCTION_RAT_LEVEL = 9;
/** The ghouls came in from the ruins through the old culverts, and are as strong as they are up there. */
const VAULT_GHOUL_LEVEL = 11;

/**
 * The tower drain: from the storm drain's ladder east under the Civic
 * Terrace to the cistern culvert beneath Town Center Tower.
 *
 * The spillway cuts the walkway at full flow until its valve, in the alcove
 * west of it, lowers it. Past it, rats hold the junction. The way on is
 * choked by a rat nest in a dry sump; the valve on the junction's north wall
 * floods the sump and carries the nest off. Ghouls wait in the vault hall
 * beyond, and the cistern culvert is at its east end.
 */
const TOWER_DRAIN: SewerSectionLayout = {
  id: 'tower_drain',
  name: 'The Tower Drain',
  rows: [
    '############################################################',
    '############################################################',
    '############################################################',
    '############################################################',
    '################==##########################............####',
    '################==####.B.###################............####',
    '################==####...###################.........g..####',
    '################==#............#############......^.....####',
    '###........#####==#.........r.....oonnnoo...............C###',
    '###........#.A.#==#.....r.......4.oonnnoo.5.........6...C###',
    '###...@....#...#==#......^.....#############......g.....####',
    '###.....1..#...#==#........r...#############............####',
    '###...........2.==.3.r.........#############...g........####',
    '###.............==.............#############............####',
    '###~~~~~~~~~~~~~~~~~~~~~~~~~~~~#############################',
    '###~~~~~~~~~~~~~~~~~~~~~~~~~~~~#############################',
    '############################################################',
    '############################################################',
    '############################################################',
  ],
  connections: [
    { kind: 'street_grate', char: SEWER_CHAR.ladder },
    { kind: 'tower_cistern', char: SEWER_CHAR.culvert },
  ],
  valves: [
    { id: 'tower_drain_spillway_valve', char: 'A', effect: { kind: 'lower', channel: 'spillway' } },
    {
      id: 'tower_drain_nest_valve',
      char: 'B',
      effect: { kind: 'raise', channel: 'nest_basin', depth: NEST_BASIN_FLOOD_DEPTH },
    },
  ],
  fights: [
    { id: 'tower_drain_junction_rats', char: 'r', kind: 'rat', level: JUNCTION_RAT_LEVEL },
    { id: 'tower_drain_vault_ghouls', char: 'g', kind: 'ruins_ghoul', level: VAULT_GHOUL_LEVEL },
  ],
  guideStops: [
    { id: 'ladder', holdsUntil: null },
    { id: 'spillway', holdsUntil: 'tower_drain_spillway_valve' },
    { id: 'junction', holdsUntil: 'tower_drain_junction_rats' },
    { id: 'nest', holdsUntil: 'tower_drain_nest_valve' },
    { id: 'vault', holdsUntil: 'tower_drain_vault_ghouls' },
    { id: 'cistern', holdsUntil: null },
  ],
};

export const SEWER_SECTION_LAYOUTS = {
  tower_drain: TOWER_DRAIN,
} as const satisfies Record<SewerSectionId, SewerSectionLayout>;

/** Where the party comes down from the street: the tower drain's ladder. */
export const SEWER_ENTRY_SECTION: SewerSectionId = 'tower_drain';
