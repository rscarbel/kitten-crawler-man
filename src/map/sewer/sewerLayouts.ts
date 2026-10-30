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
 * built, because a map's water is never saved. A sump is fed instead by a
 * pipe in the wall, which one wheel opens and another shuts; a pipe is always
 * found shut when the section is built, so a party arriving from either end
 * is never cut off by water left running behind it.
 *
 * Nobody walks through sewer water: every wet channel tile is shut to every
 * body until it has run dry.
 */

import type { MobKind } from '../../levels/mobKinds';

/**
 * The glyphs a section's rows are written in.
 *
 * ```
 *  #  brick wall                .  stone walkway
 *  ~  the main channel, running at full flow: never waded
 *  =  the spillway: a channel its valve can lower to a dry bed
 *  o  the nest basin: a dry sump its outlet pipe can flood
 *  n  the rat nest, choking the basin until the basin is flooded
 *  O  the drain mouth in the basin's floor, which the basin empties down
 *     and the washed-out nest is carried into: never walked
 *  P  the outlet pipe in the wall over a sump
 *  @  the foot of the ladder up to the street grate the party came down
 *  ^  walkway under a street grate, where daylight falls through
 *  C  walkway at the cistern culvert's mouth
 *  A, B, D  a valve wheel, set in the walkway
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
  drain: 'O',
  ladder: '@',
  streetGrate: '^',
  culvert: 'C',
  outlet: 'P',
} as const;

export const SEWER_VALVE_CHARS = ['A', 'B', 'D'] as const;
/** A valve wheel's glyph in a section's rows. */
type SewerValveChar = (typeof SEWER_VALVE_CHARS)[number];
export const SEWER_GUIDE_STOP_CHARS = '123456789';
export const SEWER_FIGHT_CHARS = 'rg';

/** Every section of the sewer. Each is one layout and one map. */
export const SEWER_SECTION_IDS = ['tower_drain'] as const;
export type SewerSectionId = (typeof SEWER_SECTION_IDS)[number];

/**
 * Every sluice wheel in the sewer, unique across sections: each lowers its
 * channel for good, so the run remembers each one turned.
 */
export const SEWER_SLUICE_VALVE_IDS = ['tower_drain_spillway_valve'] as const;
type SewerSluiceValveId = (typeof SEWER_SLUICE_VALVE_IDS)[number];

/**
 * Every wheel on an outlet pipe, unique across sections. Not remembered: a
 * pipe is found shut whenever its section is built, whatever was turned last.
 */
export type SewerOutletValveId = 'tower_drain_sump_open_valve' | 'tower_drain_sump_shut_valve';

type SewerValveId = SewerSluiceValveId | SewerOutletValveId;

/** Every outlet pipe in the sewer's walls, unique across sections. */
export type SewerOutletId = 'tower_drain_sump_outlet';

/** What the water has cleared for good, unique across sections: the run remembers each one. */
export const SEWER_CLEARING_IDS = ['tower_drain_nest_washed'] as const;
type SewerClearingId = (typeof SEWER_CLEARING_IDS)[number];

/** Every fight in the sewer, unique across sections: the run remembers each one won. */
export const SEWER_FIGHT_IDS = ['tower_drain_junction_rats', 'tower_drain_vault_ghouls'] as const;
export type SewerFightId = (typeof SEWER_FIGHT_IDS)[number];

/** What the run remembers of the sewer: a sluice lowered, a fight won or a blockage washed out. */
export type SewerWorkId = SewerSluiceValveId | SewerFightId | SewerClearingId;
export const SEWER_WORK_IDS: ReadonlyArray<SewerWorkId> = [
  ...SEWER_SLUICE_VALVE_IDS,
  ...SEWER_FIGHT_IDS,
  ...SEWER_CLEARING_IDS,
];

/** The guide's stops, named for what it says there. */
export type SewerGuideStopId = 'ladder' | 'spillway' | 'junction' | 'nest' | 'vault' | 'cistern';

/** The sewer's channels whose water a valve moves. */
export type SewerChannelId = 'spillway' | 'nest_basin';

/**
 * What keeps the guide at a stop: `work` until a fight is won or a valve
 * turned, `crossable` until every tile of a channel can be walked (run dry,
 * and nothing left choking it).
 */
export type SewerGuideHold =
  | { readonly kind: 'work'; readonly id: SewerWorkId }
  | { readonly kind: 'crossable'; readonly channel: SewerChannelId };

/**
 * One of the guide's stops, in walking order. A stop with a hold keeps the
 * guide there until the hold is met: the way on is shut, or not safe, until then.
 */
export interface SewerGuideStopDef {
  readonly id: SewerGuideStopId;
  readonly holdsUntil: SewerGuideHold | null;
}

/**
 * What turning a valve does: `lower` runs its channel down to its dry bed
 * for good; `open_outlet` sets an outlet pipe pouring, which floods its
 * channel and washes out whatever choked it; `shut_outlet` stops the pipe,
 * and the channel drains.
 */
type SewerSluiceEffect = { readonly kind: 'lower'; readonly channel: SewerChannelId };
type SewerOutletEffect =
  | { readonly kind: 'open_outlet'; readonly outlet: SewerOutletId }
  | { readonly kind: 'shut_outlet'; readonly outlet: SewerOutletId };
export type SewerValveEffect = SewerSluiceEffect | SewerOutletEffect;

/** A pipe in the wall over its nest's channel: running, it floods the channel to `depth`. */
export interface SewerOutletDef {
  readonly id: SewerOutletId;
  /** Marks the wall tile the pipe comes out of, directly over the channel. */
  readonly char: typeof SEWER_CHAR.outlet;
  readonly depth: number;
}

interface SewerValveDefOf<Id extends SewerValveId, Effect extends SewerValveEffect> {
  readonly id: Id;
  /** The valve glyph in the section's rows. */
  readonly char: SewerValveChar;
  readonly effect: Effect;
}

/** A sluice wheel, whose turn the run remembers. */
type SewerSluiceValveDef = SewerValveDefOf<SewerSluiceValveId, SewerSluiceEffect>;
/** A wheel on an outlet pipe, which the run forgets. */
type SewerOutletValveDef = SewerValveDefOf<SewerOutletValveId, SewerOutletEffect>;
export type SewerValveDef = SewerSluiceValveDef | SewerOutletValveDef;

/** Whether `def` is a sluice wheel, whose turn is remembered. */
export function isSluiceValve(def: SewerValveDef): def is SewerSluiceValveDef {
  return def.effect.kind === 'lower';
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

/**
 * A blockage choking a channel (the `n` glyphs) until running water carries it
 * off: `id` is what the run remembers once it has gone, and `channel` the
 * channel whose water washes it out and which stays shut while it stands.
 */
export interface SewerNestDef {
  readonly id: SewerClearingId;
  readonly channel: SewerChannelId;
  /**
   * The pipes over `channel` whose water carries the nest off. An outlet's
   * wheel is spent once the nest has gone, so a pipe exists only as part of
   * the nest it washes out.
   */
  readonly outlets: readonly [SewerOutletDef, ...SewerOutletDef[]];
}

export interface SewerSectionLayout {
  readonly id: SewerSectionId;
  readonly name: string;
  readonly rows: ReadonlyArray<string>;
  readonly connections: ReadonlyArray<SewerConnection>;
  readonly valves: ReadonlyArray<SewerValveDef>;
  readonly fights: ReadonlyArray<SewerFightDef>;
  /** The section's rat nest, or null for a section with none: marked by `n` glyphs exactly when present. */
  readonly nest: SewerNestDef | null;
  /** The guide's stops, one per stop glyph 1–9 in the rows, in order. */
  readonly guideStops: ReadonlyArray<SewerGuideStopDef>;
}

/** How deep the main channel and an open spillway run: as deep as water goes. */
export const SEWER_FULL_FLOW_DEPTH = 3;
/** The nest basin flooded by its outlet: deep enough to carry the nest off. */
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
 * choked by a rat nest in a dry sump under a pipe in the wall; the valve on
 * the junction's north wall sets the pipe pouring, which floods the sump and
 * carries the nest off down the drain in the sump's floor, and the valve by
 * the sump's mouth shuts it so the sump can drain. The sump is three tiles
 * deep so the way stays open on either side of the drain. Ghouls wait in the vault hall beyond, and the cistern
 * culvert is at its east end.
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
    '################==#............######P######......^.....####',
    '###........#####==#.........r.....oonnnoo...............C###',
    '###........#.A.#==#.....r.......4.oonOnoo.5.........6...C###',
    '###...@....#...#==#......^....D...oonnnoo.........g.....####',
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
      id: 'tower_drain_sump_open_valve',
      char: 'B',
      effect: { kind: 'open_outlet', outlet: 'tower_drain_sump_outlet' },
    },
    {
      id: 'tower_drain_sump_shut_valve',
      char: 'D',
      effect: { kind: 'shut_outlet', outlet: 'tower_drain_sump_outlet' },
    },
  ],
  nest: {
    id: 'tower_drain_nest_washed',
    channel: 'nest_basin',
    outlets: [
      { id: 'tower_drain_sump_outlet', char: SEWER_CHAR.outlet, depth: NEST_BASIN_FLOOD_DEPTH },
    ],
  },
  fights: [
    { id: 'tower_drain_junction_rats', char: 'r', kind: 'rat', level: JUNCTION_RAT_LEVEL },
    { id: 'tower_drain_vault_ghouls', char: 'g', kind: 'ruins_ghoul', level: VAULT_GHOUL_LEVEL },
  ],
  guideStops: [
    { id: 'ladder', holdsUntil: null },
    { id: 'spillway', holdsUntil: { kind: 'crossable', channel: 'spillway' } },
    { id: 'junction', holdsUntil: { kind: 'work', id: 'tower_drain_junction_rats' } },
    { id: 'nest', holdsUntil: { kind: 'crossable', channel: 'nest_basin' } },
    { id: 'vault', holdsUntil: { kind: 'work', id: 'tower_drain_vault_ghouls' } },
    { id: 'cistern', holdsUntil: null },
  ],
};

export const SEWER_SECTION_LAYOUTS = {
  tower_drain: TOWER_DRAIN,
} as const satisfies Record<SewerSectionId, SewerSectionLayout>;

/** Where the party comes down from the street: the tower drain's ladder. */
export const SEWER_ENTRY_SECTION: SewerSectionId = 'tower_drain';
