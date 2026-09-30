/**
 * Where "The Borrowed Blueprints" stands: Fenna's side quest to upgrade the
 * saw and the rope walk. Phases move forward in
 * {@link BLUEPRINTS_QUEST_PHASE_ORDER}, except `declined`, which is an exit
 * off the path that the offer can be picked back up from.
 *
 * The steps, in order:
 * - `unoffered` — Fenna has not asked yet; she asks once Construction is unlocked.
 * - `declined` — the party said "Not right now"; a topic on Fenna re-offers.
 * - `ask_wendell` — go ask Wendell at Plumbline Farm for the blueprints.
 * - `ask_merrit` — Wendell wants a dairy cow; ask Merrit for one.
 * - `build_fence` — Merrit wants her pasture fence rebuilt, section by section.
 * - `report_fence` — tell Merrit the fence is done.
 * - `harvest_grain` — Merrit wants grain harvested with her scythe.
 * - `deliver_grain` — hand the grain in; Merrit calls Midge.
 * - `escort_midge` — lead Midge across the wilds to Wendell's pasture.
 * - `midge_delivered` — Midge is settled; Wendell hands over the blueprints.
 * - `build_stations` — upgrade the saw and the rope walk from the blueprints.
 * - `complete` — both stations stand upgraded.
 */
export type BlueprintsQuestPhase =
  | 'unoffered'
  | 'declined'
  | 'ask_wendell'
  | 'ask_merrit'
  | 'build_fence'
  | 'report_fence'
  | 'harvest_grain'
  | 'deliver_grain'
  | 'escort_midge'
  | 'midge_delivered'
  | 'build_stations'
  | 'complete';

/** Every phase in the order the quest reaches it. `declined` sits before acceptance, where it belongs. */
export const BLUEPRINTS_QUEST_PHASE_ORDER: readonly BlueprintsQuestPhase[] = [
  'unoffered',
  'declined',
  'ask_wendell',
  'ask_merrit',
  'build_fence',
  'report_fence',
  'harvest_grain',
  'deliver_grain',
  'escort_midge',
  'midge_delivered',
  'build_stations',
  'complete',
];

/** Whether `phase` is `threshold` or any phase after it in {@link BLUEPRINTS_QUEST_PHASE_ORDER}. */
export function blueprintsPhaseAtLeast(
  phase: BlueprintsQuestPhase,
  threshold: BlueprintsQuestPhase,
): boolean {
  return (
    BLUEPRINTS_QUEST_PHASE_ORDER.indexOf(phase) >= BLUEPRINTS_QUEST_PHASE_ORDER.indexOf(threshold)
  );
}

/** Whether the party has taken Fenna's request: every phase from `ask_wendell` on. */
export function hasAcceptedBlueprintsQuest(phase: BlueprintsQuestPhase): boolean {
  return blueprintsPhaseAtLeast(phase, 'ask_wendell');
}

/** Whether the quest is under way and not yet finished: accepted, not `complete`. */
export function isBlueprintsQuestUnderWay(phase: BlueprintsQuestPhase): boolean {
  return hasAcceptedBlueprintsQuest(phase) && phase !== 'complete';
}

/**
 * The steps Wendell waits through with his "the pasture is ready" line: from
 * the moment he names his price until Midge is standing in his pasture.
 */
export function isWendellWaitingForCow(phase: BlueprintsQuestPhase): boolean {
  return (
    blueprintsPhaseAtLeast(phase, 'ask_merrit') && !blueprintsPhaseAtLeast(phase, 'midge_delivered')
  );
}

/** Grain Merrit wants before she parts with Midge. Grain is quest progress, never a party resource. */
export const BLUEPRINTS_GRAIN_TARGET = 100;

/** The two stations the blueprints upgrade, in the order the journal lists them. */
export const BLUEPRINTS_STATION_IDS = ['saw', 'ropeWalk'] as const;

export type BlueprintsStationId = (typeof BLUEPRINTS_STATION_IDS)[number];
