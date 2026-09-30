/**
 * Where the Briar Hollow defense quest stands. Phases move forward in
 * {@link VILLAGE_QUEST_PHASE_ORDER}, except `declined` and the outcome
 * branches, which are exits off the normal path rather than steps on it.
 *
 * The guided build-up, in order:
 * - `need_tools` — Oren hands over the basic axe and pickaxe.
 * - `gather_wood` / `gather_stone` — chop in the lumber yard, then mine in the quarry.
 * - `report_tikka` — Tikka explains she needs boards and rope; Construction is learned.
 * - `see_fenna` — Fenna grants the saw and the rope walk.
 * - `processing` — process wood into boards and rope.
 * - `return_tikka` — Tikka hands over her plans; the Construction menu opens.
 * - `build_trebuchet` / `load_trebuchet` / `build_wall` — the guided first builds.
 * - `summoned_by_mayor` — the Mayor calls the crawlers over.
 * - `fortifying` — briefed; the militia takes orders; "I'm ready" starts the siege.
 *
 * A lost siege goes `repelled_failed` (speak with the Mayor) → `repair_bell`
 * (rebuild the bell tower) → back to `fortifying`.
 */
export type VillageQuestPhase =
  | 'unmet'
  | 'offered'
  | 'declined'
  | 'need_tools'
  | 'gather_wood'
  | 'gather_stone'
  | 'report_tikka'
  | 'see_fenna'
  | 'processing'
  | 'return_tikka'
  | 'build_trebuchet'
  | 'load_trebuchet'
  | 'build_wall'
  | 'summoned_by_mayor'
  | 'fortifying'
  | 'imminent'
  | 'assault'
  | 'repelled_failed'
  | 'repair_bell'
  | 'victory'
  | 'complete';

/**
 * Every phase in the order the questline reaches it. The post-siege branches
 * sit after `fortifying` so {@link phaseAtLeast} reads them as "past the
 * briefing", which every one of them is.
 */
export const VILLAGE_QUEST_PHASE_ORDER: readonly VillageQuestPhase[] = [
  'unmet',
  'offered',
  'declined',
  'need_tools',
  'gather_wood',
  'gather_stone',
  'report_tikka',
  'see_fenna',
  'processing',
  'return_tikka',
  'build_trebuchet',
  'load_trebuchet',
  'build_wall',
  'summoned_by_mayor',
  'fortifying',
  'imminent',
  'assault',
  'repelled_failed',
  'repair_bell',
  'victory',
  'complete',
];

/** Whether `phase` is `threshold` or any phase after it in {@link VILLAGE_QUEST_PHASE_ORDER}. */
export function phaseAtLeast(phase: VillageQuestPhase, threshold: VillageQuestPhase): boolean {
  return VILLAGE_QUEST_PHASE_ORDER.indexOf(phase) >= VILLAGE_QUEST_PHASE_ORDER.indexOf(threshold);
}

/** The quest's phases before the Mayor's offer has been accepted. */
const PHASES_BEFORE_MAYOR_ACCEPTED: ReadonlySet<VillageQuestPhase> = new Set([
  'unmet',
  'offered',
  'declined',
]);

/** Whether the party has agreed to help the Mayor yet. */
export function hasAcceptedMayorRequest(phase: VillageQuestPhase): boolean {
  return !PHASES_BEFORE_MAYOR_ACCEPTED.has(phase);
}

/** The two phases with the enemy at, or through, the gate. */
const SIEGE_PHASES: ReadonlySet<VillageQuestPhase> = new Set(['imminent', 'assault']);

/**
 * Whether Briar Hollow is under siege right now: the countdown or the waves.
 * Every other questline in the village stands down while it is.
 */
export function isVillageUnderSiege(phase: VillageQuestPhase): boolean {
  return SIEGE_PHASES.has(phase);
}
